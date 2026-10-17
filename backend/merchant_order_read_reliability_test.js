// =========================================================================
// MERCHANT ORDER-READ RELIABILITY (local only)
//
// `getOrdersByMerchant()` used to answer a store failure with `[]` — the same value a
// successful query returns when a store genuinely has no orders. Both merchant reads
// built on it (`GET /api/merchant/:restaurantId/orders` and
// `GET /api/merchant/:restaurantId/dashboard`) sit inside a `try`, so an empty array was
// a clean return: the orders route answered `200 {success: true, count: 0}` and the
// dashboard answered `activeOrdersCount: 0, todaySales: 0`. A restaurant owner whose
// store could not be reached was told the day was quiet, and the merchant app had no way
// to tell the difference.
//
// The correction is the convention already used everywhere else in this repository:
// `settleStore()`/`storeUnavailableError()` turn a store failure into a thrown
// `STORE_UNAVAILABLE` with `.status` 503, which `isStoreUnreachable()` recognises, which
// the routes' existing `replyStoreError()` answers as a retryable 503. Nothing new is
// introduced, and a query that succeeds with no rows still returns `[]`.
//
// Two techniques, because the two layers need different evidence:
//
//   * Repository — the real outage, no mocks. The same closed-port-on-127.0.0.1 method as
//     `checkout_store_semantics_test.js`: a child process whose SUPABASE_URL points at a
//     port nobody listens on. Nothing hosted is touched and nothing is destroyed.
//   * Routes — a failure injected at the repository boundary. A route-level outage cannot
//     be produced by pointing a server at a dead store, because merchant auth reads that
//     same store and answers 401 before the order read ever runs
//     (`campaign_outage_test.js` documents the identical problem). So the server children
//     on private ports replace `getOrdersByMerchant` with a function that throws the very
//     error the fixed repository now throws — built by the repository's own
//     `storeUnavailableError()` — and the routes are then exercised over real HTTP. What
//     is proven is the wiring: given that error, the answer is a refusal, never a zero.
//
// Every identity is a real registered merchant row, discovered from PostgreSQL rather
// than hardcoded, and authenticated through the application's own deterministic test OTP
// — guessing which fixture survives in a dev database is this programme's recurring
// failure mode. Nothing here writes: the suite only reads orders that already exist.
// =========================================================================

const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');

const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite writes and asserts through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into
// this file, which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'merchant_order_read_reliability_test' });
const PG = PG_TARGET.connectionString;
const OTP = process.env.NABIN_TEST_OTP || '7729';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
const SUITE = path.join(__dirname, 'merchant_order_read_reliability_test.js');

if (process.env.NODE_ENV === 'production') {
  console.error('MOR REFUSED: this suite must not run against a production environment');
  process.exit(1);
}
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('MOR REFUSED: non-loopback database target');
  process.exit(1);
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A repository call reduced to the fields the verdict cares about: did it throw, and if it
// returned, what shape came back. Both branches matter here — the defect was a return.
function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      message: err && err.message,
    }));
}

async function request(method, baseUrl, urlPath, body, token) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* the raw text is kept for the leak check */ }
  return { status: res.status, data: data || {}, text };
}

async function findFreePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

// Two distinct leak questions, because one body shape cannot answer both.
//
// A SECRET LEAK is a leak in any response, successful or not: the connection target, a
// credential, a JWT-looking value, or the shape of a stack trace. Nothing about those
// belongs in a body a client reads.
const SECRET_MARKERS = ['password', 'postgres://', 'postgresql://', 'service_role', '54322',
  '54321', 'eyJ', '    at ', 'at Object.', '127.0.0.1'];
// An INTERNAL MECHANISM is what a FAILURE body must not narrate: the table it queried, the
// SQL it wrote, the wire-level reason it could not connect. A successful order payload
// legitimately carries the row shape (`order_lines` mapped to `lines`) with nothing wrong,
// so asserting these against it would fail a correct response, not a leaking one.
const INTERNAL_MARKERS = ['select *', 'order_lines', 'connrefused', 'fetch failed', 'stack'];
function leaksIn(text, markers) {
  const lower = String(text || '').toLowerCase();
  return markers.filter(f => lower.includes(f.toLowerCase()));
}

// ---------------------------------------------------------------- children
// Every scenario prints exactly one `MOR_VERDICT <json>` line. The repository scenarios
// print it and exit; the server scenarios print it once the backend answers /api/health and
// then stay alive, so the parent can drive real HTTP against the port they report.
async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');
  const fx = JSON.parse(process.env.NABIN_MOR_FX || '{}');
  const verdict = (out) => console.log(`MOR_VERDICT ${JSON.stringify(out)}`);

  if (scenario === 'repo_outage' || scenario === 'repo_live') {
    const out = { scenario, ok: false };
    const down = scenario === 'repo_outage';
    // Reduced to what the verdict cares about: did it throw, and if it returned, what shape
    // came back. `outcome` keeps `.status`, which is all the classifier needs.
    const describe = (res) => ({
      threw: res.threw,
      isArray: !res.threw && Array.isArray(res.value),
      length: !res.threw && Array.isArray(res.value) ? res.value.length : null,
      status: res.status,
      code: res.code,
      unreachable: res.threw ? isStoreUnreachable(res) : false,
    });
    const rowsOf = (res) => (!res.threw && Array.isArray(res.value) ? res.value : []);

    const plainOutcome = await outcome(() => db.orderRepo.getOrdersByMerchant(fx.ordersMerchant));
    out.plain = describe(plainOutcome);
    const filteredOutcome = await outcome(() =>
      db.orderRepo.getOrdersByMerchant(fx.ordersMerchant, { status: fx.stateWithRows }));
    out.filtered = describe(filteredOutcome);

    if (down) {
      out.ok = out.plain.threw === true && out.filtered.threw === true;
      return verdict(out);
    }

    // Live store: every shape and ordering the two callers depend on has to survive.
    const rows = rowsOf(plainOutcome);
    out.rowsShape = {
      length: rows.length,
      everyRowHasLinesArray: rows.length > 0 && rows.every(r => Array.isArray(r.lines)),
      everyRowHasId: rows.length > 0 && rows.every(r => Boolean(r && r.id)),
      descending: rows.every((r, i) => i === 0
        || new Date(rows[i - 1].created_at).getTime() >= new Date(r.created_at).getTime()),
    };
    out.emptyMerchant = describe(await outcome(() => db.orderRepo.getOrdersByMerchant(fx.emptyMerchant)));
    out.limited = describe(await outcome(() => db.orderRepo.getOrdersByMerchant(fx.ordersMerchant, { limit: 1 })));
    out.noSuchState = describe(await outcome(() =>
      db.orderRepo.getOrdersByMerchant(fx.ordersMerchant, { status: fx.stateWithoutRows })));
    out.noMerchantId = describe(await outcome(() => db.orderRepo.getOrdersByMerchant('')));
    const filteredRows = rowsOf(filteredOutcome);
    out.filteredOnlyOneState = filteredRows.length > 0 && filteredRows.every(r => r.order_state === fx.stateWithRows);
    out.ok = true;
    return verdict(out);
  }

  if (scenario === 'serve_live' || scenario === 'serve_down') {
    const port = Number(process.env.PORT);
    if (scenario === 'serve_down') {
      db.orderRepo.getOrdersByMerchant = async () => {
        throw db.orderRepo.storeUnavailableError('the merchant order book', new Error('harness-injected outage'));
      };
    }
    require('./src/server');
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90000;   // measured boot is ~13s idle, longer under load
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await request('GET', baseUrl, '/api/health')).status === 200; } catch (e) { /* not up yet */ }
    }
    return verdict({ scenario, ok: ready, port });
  }

  verdict({ scenario, ok: false, error: `unknown scenario ${scenario}` });
}

function spawnRepoChild(scenario, env) {
  const res = spawnSync(process.execPath, [SUITE, scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NABIN_MOR_CHILD: scenario }, env),
  });
  const line = String(res.stdout || '').split('\n').filter(l => l.startsWith('MOR_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `child printed no verdict: ${String(res.stdout || '').slice(-200)}${String(res.stderr || '').slice(-300)}` };
  }
  try { return JSON.parse(line.slice('MOR_VERDICT '.length)); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 300)}` }; }
}

function spawnServerChild(scenario, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SUITE, scenario], {
      cwd: __dirname,
      windowsHide: true,
      env: Object.assign({}, process.env, { NABIN_MOR_CHILD: scenario, PORT: String(port) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let buffer = '';
    let settled = false;
    proc.stderr.on('data', (d) => stderr.push(String(d)));
    proc.stdout.on('data', (d) => {
      buffer += String(d);
      const line = buffer.split('\n').find(l => l.startsWith('MOR_VERDICT '));
      if (!line || settled) return;
      settled = true;
      try { resolve({ proc, verdict: JSON.parse(line.slice('MOR_VERDICT '.length)), stderr }); }
      catch (e) { reject(new Error(`unparsable server verdict: ${String(e && e.message)}`)); }
    });
    proc.on('exit', (code) => {
      if (!settled) reject(new Error(`server child exited (${code}) before readiness: ${stderr.join('').slice(-400)}`));
    });
  });
}

async function mintTokens(baseUrl, fx) {
  const tokens = {};
  for (const key of ['orders', 'empty']) {
    const mint = await request('POST', baseUrl, '/api/auth/verify-otp', {
      phone: key === 'orders' ? fx.ordersPhone : fx.emptyPhone, otp: OTP, role: 'MERCHANT', purpose: 'LOGIN',
    });
    tokens[key] = mint.data && mint.data.token;
  }
  return tokens;
}

// ---------------------------------------------------------------- main
async function main() {
  // Fixtures discovered from the store this suite is pointed at, never assumed.
  const c = new Client({ connectionString: PG });
  await c.connect();
  const norm = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };
  const merchants = (await c.query(`SELECT m.id::text id, m.phone, m.name, m.merchant_type,
      (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id)::int AS n_orders
    FROM merchants m WHERE m.merchant_type = 'RESTAURANT'`)).rows;
  const phoneHits = new Map();
  for (const m of merchants) phoneHits.set(norm(m.phone), (phoneHits.get(norm(m.phone)) || 0) + 1);
  const unique = (m) => phoneHits.get(norm(m.phone)) === 1 && /^\d{10}$/.test(norm(m.phone));
  const withOrders = merchants
    .filter(m => m.n_orders >= 2 && m.n_orders <= 40 && unique(m))
    .sort((a, b) => a.n_orders - b.n_orders)[0];
  const withoutOrders = merchants.filter(m => m.n_orders === 0 && unique(m))[0];
  if (!withOrders || !withoutOrders) {
    console.error('MOR ABORT: this database has no unambiguous RESTAURANT merchant with orders, or none without');
    process.exitCode = 1; await c.end(); return;
  }
  const states = (await c.query(
    'SELECT order_state, count(*)::int n FROM orders WHERE merchant_id = $1::uuid GROUP BY 1', [withOrders.id])).rows;
  const vocabulary = (await c.query(
    "SELECT unnest(ARRAY['RECEIVED','ACCEPTED','PREPARING','READY_FOR_PICKUP','DELIVERED']) AS s")).rows.map(r => r.s);
  const stateWithRows = states.find(s => s.n >= 1);
  const stateWithoutRows = vocabulary.find(s => !states.some(x => x.order_state === s));
  if (!stateWithRows || !stateWithoutRows) {
    console.error('MOR ABORT: could not find both a state this merchant owns and a state it does not');
    process.exitCode = 1; await c.end(); return;
  }
  const fx = {
    ordersMerchant: withOrders.id, ordersPhone: norm(withOrders.phone),
    emptyMerchant: withoutOrders.id, emptyPhone: norm(withoutOrders.phone),
    stateWithRows: stateWithRows.order_state, stateWithoutRows,
  };
  console.log(`  fixtures: with-orders=${fx.ordersMerchant.slice(0, 13)} ${withOrders.n_orders} rows (${fx.ordersPhone}) | `
    + `no-orders=${fx.emptyMerchant.slice(0, 13)} (${fx.emptyPhone}) | states ${fx.stateWithRows}/${fx.stateWithoutRows}`);
  await c.end();
  const fxJson = JSON.stringify(fx);

  // ================================================= 1. repository against a real outage
  const down = spawnRepoChild('repo_outage', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
    NABIN_MOR_FX: fxJson,
  });
  check('MOR-01', 'with the store unreachable the merchant order read does NOT answer an array',
    down.ok === true && down.plain && down.plain.threw === true && down.plain.isArray === false,
    { threw: down.plain && down.plain.threw, isArray: down.plain && down.plain.isArray, detail: down.detail });
  check('MOR-02', 'it throws the outage classification the platform already uses (503, isStoreUnreachable)',
    Boolean(down.plain) && down.plain.threw === true && down.plain.status === 503 && down.plain.unreachable === true,
    { status: down.plain && down.plain.status, unreachable: down.plain && down.plain.unreachable });
  check('MOR-03', 'and it is the existing typed error code, not one invented for this fix',
    Boolean(down.plain) && down.plain.code === 'STORE_UNAVAILABLE',
    { code: down.plain && down.plain.code });
  check('MOR-04', 'a status-filtered merchant read fails closed the same way instead of an empty list',
    Boolean(down.filtered) && down.filtered.threw === true && down.filtered.isArray === false,
    { threw: down.filtered && down.filtered.threw, length: down.filtered && down.filtered.length });

  // ================================================= 2. repository against the live store
  const live = spawnRepoChild('repo_live', { NODE_ENV: 'development', NABIN_MOR_FX: fxJson });
  check('MOR-05', 'with the store reachable, a merchant that owns orders still gets its rows',
    live.ok === true && live.plain && live.plain.threw === false && live.plain.isArray === true && live.plain.length >= 2,
    { length: live.plain && live.plain.length, detail: live.detail });
  check('MOR-06', 'each row keeps the shape both callers read, including the `lines` array',
    live.rowsShape && live.rowsShape.everyRowHasLinesArray === true && live.rowsShape.everyRowHasId === true,
    live.rowsShape);
  check('MOR-07', 'the ordering the kitchen display depends on is unchanged: newest first',
    live.rowsShape && live.rowsShape.descending === true, live.rowsShape);
  check('MOR-08', 'a merchant with genuinely no orders is still an empty array, and not an outage',
    live.emptyMerchant && live.emptyMerchant.threw === false && live.emptyMerchant.isArray === true
    && live.emptyMerchant.length === 0,
    { threw: live.emptyMerchant && live.emptyMerchant.threw, length: live.emptyMerchant && live.emptyMerchant.length });
  check('MOR-09', 'the caller-supplied window still bounds the read',
    live.limited && live.limited.threw === false && live.limited.length === 1,
    { length: live.limited && live.limited.length });
  check('MOR-10', 'the status filter still selects one state, and a state with no orders is empty, not an error',
    live.filteredOnlyOneState === true && live.noSuchState && live.noSuchState.threw === false
    && live.noSuchState.isArray === true && live.noSuchState.length === 0,
    { onlyOneState: live.filteredOnlyOneState, noSuchState: live.noSuchState });
  check('MOR-11', 'a call with no merchant id keeps its existing answer (no new throw for an empty argument)',
    live.noMerchantId && live.noMerchantId.threw === false && live.noMerchantId.isArray === true,
    { threw: live.noMerchantId && live.noMerchantId.threw });

  // ================================================= 3. routes with the store working
  const livePort = await findFreePort();
  const liveServer = await spawnServerChild('serve_live', livePort);
  const liveBase = `http://127.0.0.1:${livePort}`;
  try {
    const tokens = await mintTokens(liveBase, fx);
    check('MOR-12', 'a backend with a reachable store authenticates both merchant fixtures over real HTTP',
      Boolean(tokens.orders && tokens.empty), { minted: Object.values(tokens).filter(Boolean).length });

    const own = await request('GET', liveBase, `/api/merchant/${fx.ordersMerchant}/orders`, undefined, tokens.orders);
    check('MOR-13', 'the orders endpoint answers a success carrying the rows that exist',
      own.status === 200 && own.data.success === true && Array.isArray(own.data.orders)
      && own.data.orders.length === own.data.count && own.data.count >= 2,
      { status: own.status, count: own.data.count, success: own.data.success });

    const empty = await request('GET', liveBase, `/api/merchant/${fx.emptyMerchant}/orders`, undefined, tokens.empty);
    check('MOR-14', "a merchant whose book is genuinely empty gets a successful empty read, not a failure",
      empty.status === 200 && empty.data.success === true && empty.data.count === 0
      && Array.isArray(empty.data.orders) && empty.data.orders.length === 0,
      { status: empty.status, body: empty.data });

    const bare = await request('GET', liveBase, '/api/merchant/orders', undefined, tokens.orders);
    check('MOR-15', 'the id-free alias still serves the caller its own book (caller compatibility)',
      bare.status === 200 && bare.data.success === true && Array.isArray(bare.data.orders) && bare.data.count >= 2,
      { status: bare.status, count: bare.data && bare.data.count });

    const dash = await request('GET', liveBase, `/api/merchant/${fx.ordersMerchant}/dashboard`, undefined, tokens.orders);
    const dRows = Array.isArray(dash.data.orders) ? dash.data.orders : [];
    const expectActive = dRows.filter(o => !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.order_state)).length;
    check('MOR-16', 'the dashboard still answers both metrics, with the definitions it had',
      dash.status === 200 && dash.data.success === true && typeof dash.data.activeOrdersCount === 'number'
      && typeof dash.data.todaySales === 'number' && dash.data.activeOrdersCount === expectActive,
      { status: dash.status, active: dash.data.activeOrdersCount, expected: expectActive, sales: dash.data.todaySales });

    const dashEmpty = await request('GET', liveBase, `/api/merchant/${fx.emptyMerchant}/dashboard`, undefined, tokens.empty);
    check('MOR-17', 'and a day that is genuinely quiet still reads 0 active and 0 sales as a success',
      dashEmpty.status === 200 && dashEmpty.data.success === true && dashEmpty.data.activeOrdersCount === 0
      && dashEmpty.data.todaySales === 0 && Array.isArray(dashEmpty.data.orders) && dashEmpty.data.orders.length === 0,
      { status: dashEmpty.status, active: dashEmpty.data.activeOrdersCount, sales: dashEmpty.data.todaySales });

    const noTokOrders = await request('GET', liveBase, `/api/merchant/${fx.ordersMerchant}/orders`);
    const noTokDash = await request('GET', liveBase, `/api/merchant/${fx.ordersMerchant}/dashboard`);
    check('MOR-18', 'merchant authentication is still required on both routes',
      noTokOrders.status === 401 && noTokDash.status === 401 && noTokOrders.data.success === false,
      { orders: noTokOrders.status, dashboard: noTokDash.status });

    const crossOrders = await request('GET', liveBase, `/api/merchant/${fx.emptyMerchant}/orders`, undefined, tokens.orders);
    const crossDash = await request('GET', liveBase, `/api/merchant/${fx.emptyMerchant}/dashboard`, undefined, tokens.orders);
    check('MOR-19', 'tenant ownership is still enforced, and a refused cross-tenant read carries no orders',
      crossOrders.status === 403 && crossDash.status === 403 && crossOrders.data.orders === undefined,
      { orders: crossOrders.status, dashboard: crossDash.status });

    check('MOR-20', 'a successful order read leaks no credential, connection target or stack shape',
      leaksIn(own.text, SECRET_MARKERS).length === 0 && leaksIn(dash.text, SECRET_MARKERS).length === 0,
      { orders: leaksIn(own.text, SECRET_MARKERS), dashboard: leaksIn(dash.text, SECRET_MARKERS) });
  } finally {
    liveServer.proc.kill();
  }

  // ================================================= 4. routes with the order read failing
  const downPort = await findFreePort();
  const downServer = await spawnServerChild('serve_down', downPort);
  const downBase = `http://127.0.0.1:${downPort}`;
  try {
    const tokens = await mintTokens(downBase, fx);
    check('MOR-21', 'an order-read outage does not disable merchant authentication (the outage is scoped)',
      Boolean(tokens.orders && tokens.empty), { minted: Object.values(tokens).filter(Boolean).length });

    const orders = await request('GET', downBase, `/api/merchant/${fx.ordersMerchant}/orders`, undefined, tokens.orders);
    const dash = await request('GET', downBase, `/api/merchant/${fx.ordersMerchant}/dashboard`, undefined, tokens.orders);
    check('MOR-22', 'the orders endpoint refuses instead of answering success with an empty book',
      orders.data.success !== true && orders.status >= 500,
      { status: orders.status, success: orders.data.success, code: orders.data.code });
    check('MOR-23', 'it uses the existing outage convention: HTTP 503 with code STORE_UNAVAILABLE',
      orders.status === 503 && orders.data.code === 'STORE_UNAVAILABLE',
      { status: orders.status, code: orders.data.code });
    check('MOR-24', 'and it presents neither an `orders` array nor `count: 0` as if the day were quiet',
      orders.data.orders === undefined && orders.data.count === undefined,
      { keys: Object.keys(orders.data) });
    check('MOR-25', 'the dashboard refuses too, instead of answering 0 active orders and 0 sales',
      dash.data.success !== true && dash.status >= 500,
      { status: dash.status, success: dash.data.success, code: dash.data.code });
    check('MOR-26', 'the failed dashboard carries neither metric field, so no client can paint an invented zero',
      dash.data.activeOrdersCount === undefined && dash.data.todaySales === undefined && dash.data.orders === undefined,
      { keys: Object.keys(dash.data) });
    check('MOR-27', 'both refusals carry the request id the platform logs',
      Boolean(orders.data.requestId) && Boolean(dash.data.requestId),
      { orders: orders.data.requestId, dashboard: dash.data.requestId });
    check('MOR-28', 'neither failure body leaks SQL, the schema it queried, the connection target, a credential or a stack trace',
      leaksIn(orders.text, SECRET_MARKERS).length === 0 && leaksIn(orders.text, INTERNAL_MARKERS).length === 0
        && leaksIn(dash.text, SECRET_MARKERS).length === 0 && leaksIn(dash.text, INTERNAL_MARKERS).length === 0,
      { orders: [...leaksIn(orders.text, SECRET_MARKERS), ...leaksIn(orders.text, INTERNAL_MARKERS)],
        dashboard: [...leaksIn(dash.text, SECRET_MARKERS), ...leaksIn(dash.text, INTERNAL_MARKERS)] });
    check('MOR-29', 'authentication is still enforced during the outage (401 before any order read)',
      (await request('GET', downBase, `/api/merchant/${fx.ordersMerchant}/orders`)).status === 401, undefined);
    check('MOR-30', 'cross-tenant access is still refused during the outage, before the order read runs',
      (await request('GET', downBase, `/api/merchant/${fx.emptyMerchant}/orders`, undefined, tokens.orders)).status === 403, undefined);
    check('MOR-31', 'a merchant route that does not read orders is untouched by this fix (no blanket outage)',
      (await request('GET', downBase, '/api/merchant/services', undefined, tokens.orders)).status === 200, undefined);
  } finally {
    downServer.proc.kill();
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 MERCHANT ORDER-READ RELIABILITY: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed`);
  console.log('========================================================================');
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_MOR_CHILD) {
  runChild(process.env.NABIN_MOR_CHILD).catch(err => {
    console.log(`MOR_VERDICT ${JSON.stringify({ scenario: process.env.NABIN_MOR_CHILD, ok: false, crashed: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') })}`);
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('MOR ABORTED:', err.message);
    process.exit(2);
  });
}
