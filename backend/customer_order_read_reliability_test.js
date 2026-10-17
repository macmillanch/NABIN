// =========================================================================
// CUSTOMER ORDER-READ RELIABILITY (local only)
//
// Two customer reads answered a store failure with the same value they answer a
// successful read that found nothing:
//
//   * `getOrdersByCustomer()` returned `[]` when the query failed. Its callers sit inside
//     a `try`, so an empty array was a clean return: `GET /api/customer/orders` answered
//     `200 {success: true, count: 0, orders: []}` and `GET /api/customer/activity` folded
//     the missing orders into a history that looked complete. A customer whose orders could
//     not be read was told they had none.
//   * `getOrderById()` returned `null` for BOTH "no row matched" and "the query failed" —
//     one expression, `if (error || !data) return null`. `GET /api/customer/orders/:id`
//     reads that value as its not-found signal, so a database outage was served as a `404
//     Order not found`: the customer was told an order they placed does not exist.
//
// The correction is the convention already used elsewhere in this repository —
// `settleStore()`/`storeUnavailableError()` turn a store failure into a thrown
// `STORE_UNAVAILABLE` with `.status` 503, which `isStoreUnreachable()` recognises and the
// routes' `replyStoreError()` answers as a retryable 503. Nothing new is introduced. A
// successful read that finds nothing keeps exactly the shape it had: `[]` for the list,
// `null` for the detail, and the detail route's 404 stays a 404.
//
// Two techniques, because the two layers need different evidence:
//
//   * Repository — the real outage, no mocks. The same closed-port-on-127.0.0.1 method as
//     `checkout_store_semantics_test.js`: a child process whose SUPABASE_URL points at a
//     port nobody listens on. Nothing hosted is touched and nothing is destroyed.
//   * Routes — a failure injected at the repository boundary. A route-level outage cannot
//     be produced by pointing a server at a dead store, because customer auth reads that
//     same store and answers 401 before the order read ever runs (`campaign_outage_test.js`
//     documents the identical problem). So the server children on private ports replace the
//     two customer reads with functions that throw the very error the fixed repository now
//     throws — built by the repository's own `storeUnavailableError()` — and the routes are
//     exercised over real HTTP. What is proven is the wiring.
//
// Every identity is a real registered row that this suite mints itself and deletes again, and
// every customer is authenticated through the application's own deterministic test OTP.
//
// It used to DISCOVER those rows instead: a customer carrying at least six orders of which at
// least one was grocery from a grocery-capable merchant, plus a customer carrying none. On a
// store that had just been cleared of transactional residue no such customer existed (measured:
// 0 of 341 users qualified), so the suite printed `COR ABORT` and ran zero checks - red because
// the database was tidy, not because a customer read was untruthful. Provisioning the body of
// orders is what makes the paging, scope and newest-order assertions mean something on any store.
//
// Nothing this suite writes survives it. The routes under test still do not write: the two that
// would mutate (`/status`, `/packed-weight`) and the one that would open a payment session are
// called ONLY against an injected outage, where the order read throws before any write or session
// is reached. What this suite does write is its own fixture rows, removed by id through
// `test_fixtures.js`, never by a pattern that could match somebody else's order.
// =========================================================================

const path = require('path');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');
const { openFixtures } = require('./test_fixtures');

const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite writes and asserts through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into
// this file, which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'customer_order_read_reliability_test' });
const PG = PG_TARGET.connectionString;
const OTP = process.env.NABIN_TEST_OTP || '7729';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
const SUITE = path.join(__dirname, 'customer_order_read_reliability_test.js');
// Set once main() has provisioned its rows, so an unexpected throw still removes them.
let cleanupFixtures = null;

if (process.env.NODE_ENV === 'production') {
  console.error('COR REFUSED: this suite must not run against a production environment');
  process.exit(1);
}
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('COR REFUSED: non-loopback database target');
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
// credential, a JWT-looking value, or the shape of a stack trace.
const SECRET_MARKERS = ['password', 'postgres://', 'postgresql://', 'service_role', '54322',
  '54321', 'eyJ', '    at ', 'at Object.', '127.0.0.1'];
// An INTERNAL MECHANISM is what a FAILURE body must not narrate: the table it queried, the
// SQL it wrote, the wire-level reason it could not connect. A successful order payload
// legitimately carries the row shape (`order_lines` is part of the select), so asserting
// these against it would fail a correct response, not a leaking one.
const INTERNAL_MARKERS = ['select *', 'order_lines', 'connrefused', 'fetch failed', 'stack'];
function leaksIn(text, markers) {
  const lower = String(text || '').toLowerCase();
  return markers.filter(f => lower.includes(f.toLowerCase()));
}

// ---------------------------------------------------------------- children
// Every scenario prints exactly one `COR_VERDICT <json>` line. The repository scenarios
// print it and exit; the server scenarios print it once the backend answers /api/health and
// then stay alive, so the parent can drive real HTTP against the port they report.
async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');
  const fx = JSON.parse(process.env.NABIN_COR_FX || '{}');
  const verdict = (out) => console.log(`COR_VERDICT ${JSON.stringify(out)}`);

  // The list read's verdict: did it throw, or did it hand back an array.
  const listOf = (res) => ({
    threw: res.threw,
    isArray: !res.threw && Array.isArray(res.value),
    length: !res.threw && Array.isArray(res.value) ? res.value.length : null,
    status: res.status,
    code: res.code,
    unreachable: res.threw ? isStoreUnreachable(res) : false,
  });
  // The detail read's verdict. `isNull` is the value the routes read as "not found", which
  // is exactly why a failed read must not produce it.
  const detailOf = (res) => ({
    threw: res.threw,
    isNull: !res.threw && res.value === null,
    hasId: !res.threw && Boolean(res.value && res.value.id),
    id: !res.threw && res.value ? res.value.id : null,
    linesArray: !res.threw && Boolean(res.value && Array.isArray(res.value.lines)),
    status: res.status,
    code: res.code,
    unreachable: res.threw ? isStoreUnreachable(res) : false,
  });
  const rowsOf = (res) => (!res.threw && Array.isArray(res.value) ? res.value : []);

  if (scenario === 'repo_outage' || scenario === 'repo_live') {
    const out = { scenario, ok: false };
    const down = scenario === 'repo_outage';

    const listOutcome = await outcome(() => db.orderRepo.getOrdersByCustomer(fx.ordersCustomer));
    out.list = listOf(listOutcome);
    const windowOutcome = await outcome(() =>
      db.orderRepo.getOrdersByCustomer(fx.ordersCustomer, { limit: 5, offset: 0 }));
    out.window = listOf(windowOutcome);
    const byIdOutcome = await outcome(() => db.orderRepo.getOrderById(fx.ordersId));
    out.byId = detailOf(byIdOutcome);
    out.byNumber = detailOf(await outcome(() => db.orderRepo.getOrderById(fx.ordersNumber)));
    // An id with no row is the case the detail route reads as 404. Under an outage the store
    // cannot know either way, so it must not be allowed to answer the 404's value.
    out.notFound = detailOf(await outcome(() => db.orderRepo.getOrderById(fx.notFoundUuid)));

    if (down) {
      out.ok = out.list.threw === true && out.window.threw === true
        && out.byId.threw === true && out.byNumber.threw === true && out.notFound.threw === true;
      return verdict(out);
    }

    // Live store: every shape and scope the two routes depend on has to survive.
    const rows = rowsOf(listOutcome);
    const paged = rowsOf(windowOutcome);
    out.rowsShape = {
      length: rows.length,
      everyRowHasLinesArray: rows.length > 0 && rows.every(r => Array.isArray(r.lines)),
      everyRowHasId: rows.length > 0 && rows.every(r => Boolean(r && r.id)),
      everyRowScopedToCustomer: rows.every(r => r.customer_id === fx.ordersCustomer),
      everyRowHasRouteFields: rows.every(r => r.order_number !== undefined
        && r.order_state !== undefined && r.service_type !== undefined
        && r.total_amount !== undefined && r.currency !== undefined),
      descending: rows.every((r, i) => i === 0
        || new Date(rows[i - 1].created_at).getTime() >= new Date(r.created_at).getTime()),
    };
    out.windowShape = {
      length: paged.length,
      startsWhereTheUnboundedReadSkips: paged.length > 0 && paged[0].id === rows[0].id,
    };
    const offsetOutcome = await outcome(() =>
      db.orderRepo.getOrdersByCustomer(fx.ordersCustomer, { limit: 5, offset: 5 }));
    out.offsetWindow = listOf(offsetOutcome);
    const offsetRows = rowsOf(offsetOutcome);
    out.offsetAdvanced = offsetOutcome.threw === false && offsetRows.length === 5
      && rows.length > 5 && offsetRows[0].id === rows[5].id;
    out.zeroOrderCustomer = listOf(await outcome(() => db.orderRepo.getOrdersByCustomer(fx.zeroCustomer)));
    out.emptyCustomerId = listOf(await outcome(() => db.orderRepo.getOrdersByCustomer('')));
    out.emptyOrderId = detailOf(await outcome(() => db.orderRepo.getOrderById('')));
    // The not-found read, live: the representation must stay `null`, not become a throw.
    out.notFoundLive = out.notFound.threw === false && out.notFound.isNull === true;
    out.byIdMatchesRequestedRow = out.byId.threw === false && out.byId.id === fx.ordersId;
    out.byNumberIsTheSameOrder = out.byNumber.threw === false && out.byNumber.id === fx.ordersId;
    out.ok = true;
    return verdict(out);
  }

  if (scenario === 'serve_live' || scenario === 'serve_down') {
    const port = Number(process.env.PORT);
    if (scenario === 'serve_down') {
      db.orderRepo.getOrdersByCustomer = async () => {
        throw db.orderRepo.storeUnavailableError('the customer order history', new Error('harness-injected outage'));
      };
      db.orderRepo.getOrderById = async () => {
        throw db.orderRepo.storeUnavailableError('the order', new Error('harness-injected outage'));
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
    env: Object.assign({}, process.env, { NABIN_COR_CHILD: scenario }, env),
  });
  const line = String(res.stdout || '').split('\n').filter(l => l.startsWith('COR_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `child printed no verdict: ${String(res.stdout || '').slice(-200)}${String(res.stderr || '').slice(-300)}` };
  }
  try { return JSON.parse(line.slice('COR_VERDICT '.length)); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 300)}` }; }
}

function spawnServerChild(scenario, port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SUITE, scenario], {
      cwd: __dirname,
      windowsHide: true,
      env: Object.assign({}, process.env, { NABIN_COR_CHILD: scenario, PORT: String(port) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let buffer = '';
    let settled = false;
    proc.stderr.on('data', (d) => stderr.push(String(d)));
    proc.stdout.on('data', (d) => {
      buffer += String(d);
      const line = buffer.split('\n').find(l => l.startsWith('COR_VERDICT '));
      if (!line || settled) return;
      settled = true;
      try { resolve({ proc, verdict: JSON.parse(line.slice('COR_VERDICT '.length)), stderr }); }
      catch (e) { reject(new Error(`unparsable server verdict: ${String(e && e.message)}`)); }
    });
    proc.on('exit', (code) => {
      if (!settled) reject(new Error(`server child exited (${code}) before readiness: ${stderr.join('').slice(-400)}`));
    });
  });
}

async function mintTokens(baseUrl, fx) {
  const tokens = {};
  for (const [key, phone] of [
    ['orders', fx.ordersPhone], ['zero', fx.zeroPhone],
    ['groceryMerchant', fx.groceryPhone], ['restaurantMerchant', fx.restaurantPhone],
  ]) {
    const role = key.endsWith('Merchant') ? 'MERCHANT' : 'CUSTOMER';
    const mint = await request('POST', baseUrl, '/api/auth/verify-otp', {
      phone, otp: OTP, role, purpose: 'LOGIN',
    });
    tokens[key] = mint.data && mint.data.token;
  }
  return tokens;
}

// ---------------------------------------------------------------- main
async function main() {
  // The rows the checks read are minted here under this run's own marker and removed by id at the
  // end. See the header for what the old discovery cost on a store with no transactional residue.
  const fxh = await openFixtures('cor');
  const c = fxh.client;
  cleanupFixtures = () => fxh.close();

  const grocM = await fxh.merchant({ type: 'HYBRID_BOTH', name: 'grocery' });
  const restM = await fxh.merchant({ type: 'RESTAURANT', name: 'kitchen' });
  const shopper = await fxh.customer({ name: 'has orders' });
  const nobody = await fxh.customer({ name: 'no orders' });
  const grocItem = await fxh.groceryItem(grocM.id, { name: 'packed item', store_price: 56,
    standard_unit: 'kg', pack_size: '1 kg' });
  const dish = await fxh.foodProduct(restM.id, { name: 'fixture dish', price: 220 });

  // Twelve orders over the real state ladder. The count is not decoration: the window check reads
  // `limit 5, offset 5` and needs a full second page plus a row at index 5 to compare against, and
  // each row carries its own minute-old created_at because the read orders by created_at alone -
  // a block of equal timestamps would make "which row is at offset 5" an unspecified answer.
  // Six of them are grocery, so the packed-weight caller has a grocery line with a durable id.
  const LADDER = ['RECEIVED', 'ACCEPTED', 'PREPARING'];
  const ORDER_COUNT = 12;
  const mintFrom = Date.now();
  for (let i = 0; i < ORDER_COUNT; i++) {
    const at = new Date(mintFrom - i * 60000).toISOString();
    const isFood = i % 2 === 0;
    await fxh.order({
      customerId: shopper.id,
      merchantId: isFood ? restM.id : grocM.id,
      serviceType: isFood ? 'FOOD' : 'GROCERY',
      state: LADDER[i % LADDER.length],
      total_amount: isFood ? 220 : 56,
      payment_status: 'PAID',
      created_at: at,
      lines: isFood
        ? [{ productId: dish.id, name: dish.name, quantity: 1, unit_price_snapshot: 220 }]
        : [{ inventoryId: grocItem.id, name: grocItem.name, quantity: 1, unit: 'kg', unit_price_snapshot: 56 }],
    });
  }

  // Read the minted body back rather than trusting the inserts, because every fixture id below is
  // then the store's own value, exactly as the discovered version used to be.
  const counted = (await c.query(
    `SELECT u.id::text id, u.phone, u.name,
            (SELECT count(*) FROM orders o WHERE o.customer_id = u.id)::int n
       FROM users u WHERE u.id = $1::uuid`, [shopper.id])).rows[0];
  const withOrders = counted;
  const withoutOrders = (await c.query(
    `SELECT id::text id, phone, name FROM users WHERE id = $1::uuid`, [nobody.id])).rows[0];
  if (!withOrders || withOrders.n < ORDER_COUNT || !withoutOrders) {
    console.error(`COR ABORT: the fixtures this suite minted did not land (orders=${withOrders && withOrders.n})`);
    process.exitCode = 1; await fxh.cleanup(); await c.end(); return;
  }

  const newest = (await c.query(
    `SELECT id::text id, order_number, order_state, service_type, total_amount, currency
       FROM orders WHERE customer_id = $1::uuid ORDER BY created_at DESC, order_number DESC LIMIT 1`, [withOrders.id])).rows[0];
  if (!newest) {
    console.error('COR ABORT: could not read the newest order for the with-orders customer');
    process.exitCode = 1; await fxh.cleanup(); await c.end(); return;
  }

  // A GROCERY merchant that owns one of this customer's grocery orders, for the packed-weight
  // caller of getOrderById, and a RESTAURANT merchant for the order-status caller. Both are
  // only ever called under an injected outage, so neither can write.
  const grocery = (await c.query(
    `SELECT o.id::text oid, l.id::text lid, m.id::text mid, m.phone, m.merchant_type
       FROM orders o
       JOIN merchants m ON m.id = o.merchant_id
       JOIN order_lines l ON l.order_id = o.id
      WHERE o.customer_id = $1::uuid AND o.service_type = 'GROCERY'
        AND m.merchant_type IN ('GROCERY','HYBRID_BOTH')
      ORDER BY o.created_at DESC, o.order_number DESC LIMIT 1`, [withOrders.id])).rows[0];
  const restaurant = (await c.query(
    `SELECT m.id::text mid, m.phone, count(*)::int n
       FROM orders o JOIN merchants m ON m.id = o.merchant_id
      WHERE o.service_type = 'FOOD' AND m.id = $1::uuid
      GROUP BY 1, 2`, [restM.id])).rows[0];
  if (!grocery || !restaurant || Number(restaurant.n) < 1) {
    console.error('COR ABORT: the minted fixtures did not yield a grocery order-with-line and a restaurant with orders');
    process.exitCode = 1; await fxh.cleanup(); await c.end(); return;
  }

  // A uuid of a real shape that has no order row: the not-found fixture. Minted here and
  // proven absent, so the assertion is about a missing row and not about a stale id.
  const notFoundUuid = (await c.query('SELECT gen_random_uuid()::text u')).rows[0].u;
  const collide = await c.query('SELECT 1 FROM orders WHERE id = $1::uuid', [notFoundUuid]);
  if (collide.rows.length) {
    console.error('COR ABORT: the minted not-found uuid already has an order row');
    process.exitCode = 1; await fxh.cleanup(); await c.end(); return;
  }

  const fx = {
    ordersCustomer: withOrders.id, ordersPhone: withOrders.phone, orderCount: withOrders.n,
    zeroCustomer: withoutOrders.id, zeroPhone: withoutOrders.phone,
    ordersId: newest.id, ordersNumber: newest.order_number, ordersState: newest.order_state,
    notFoundUuid,
    groceryOrderId: grocery.oid, groceryLineId: grocery.lid,
    groceryMerchant: grocery.mid, groceryPhone: grocery.phone,
    restaurantMerchant: restaurant.mid, restaurantPhone: restaurant.phone,
  };
  console.log(`  fixtures: with-orders=${fx.ordersCustomer.slice(0, 13)} ${fx.orderCount} rows (${fx.ordersPhone}) | `
    + `no-orders=${fx.zeroCustomer.slice(0, 13)} (${fx.zeroPhone}) | newest ${fx.ordersId.slice(0, 13)} ${fx.ordersNumber} ${fx.ordersState} | `
    + `grocery merchant ${fx.groceryMerchant.slice(0, 13)} | restaurant merchant ${fx.restaurantMerchant.slice(0, 13)}`);
  const fxJson = JSON.stringify(fx);

  // ================================================= 1. repository against a real outage
  const down = spawnRepoChild('repo_outage', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
    NABIN_COR_FX: fxJson,
  });
  check('COR-01', 'with the store unreachable the customer order list does NOT answer an array',
    down.ok === true && down.list && down.list.threw === true && down.list.isArray === false,
    { threw: down.list && down.list.threw, isArray: down.list && down.list.isArray, length: down.list && down.list.length, detail: down.detail });
  check('COR-02', 'it throws the outage classification the platform already uses (503, isStoreUnreachable)',
    Boolean(down.list) && down.list.threw === true && down.list.status === 503 && down.list.unreachable === true,
    { status: down.list && down.list.status, unreachable: down.list && down.list.unreachable });
  check('COR-03', 'and it is the existing typed error code, not one invented for this fix',
    Boolean(down.list) && down.list.code === 'STORE_UNAVAILABLE',
    { code: down.list && down.list.code });
  check('COR-04', 'a caller-supplied window fails closed the same way instead of an empty page',
    Boolean(down.window) && down.window.threw === true && down.window.isArray === false,
    { threw: down.window && down.window.threw, length: down.window && down.window.length });
  check('COR-05', 'with the store unreachable the single order read does NOT answer null',
    Boolean(down.byId) && down.byId.threw === true && down.byId.isNull === false,
    { threw: down.byId && down.byId.threw, isNull: down.byId && down.byId.isNull });
  check('COR-06', 'the single order read throws the same typed 503 outage error',
    Boolean(down.byId) && down.byId.threw === true && down.byId.status === 503
    && down.byId.unreachable === true && down.byId.code === 'STORE_UNAVAILABLE',
    { status: down.byId && down.byId.status, code: down.byId && down.byId.code });
  check('COR-07', 'the order-number spelling of the same read fails closed too',
    Boolean(down.byNumber) && down.byNumber.threw === true && down.byNumber.isNull === false,
    { threw: down.byNumber && down.byNumber.threw, isNull: down.byNumber && down.byNumber.isNull });
  check('COR-08', 'an id with no row cannot be answered as not-found during an outage either',
    Boolean(down.notFound) && down.notFound.threw === true && down.notFound.isNull === false,
    { threw: down.notFound && down.notFound.threw, isNull: down.notFound && down.notFound.isNull });

  // ================================================= 2. repository against the live store
  const live = spawnRepoChild('repo_live', { NODE_ENV: 'development', NABIN_COR_FX: fxJson });
  const expectDefault = Math.min(50, fx.orderCount);
  check('COR-09', 'with the store reachable, a customer that owns orders still gets its rows',
    live.ok === true && live.list && live.list.threw === false && live.list.isArray === true
    && live.list.length === expectDefault,
    { length: live.list && live.list.length, expected: expectDefault, detail: live.detail });
  check('COR-10', 'each row keeps the shape the two routes read, including the `lines` array',
    live.rowsShape && live.rowsShape.everyRowHasLinesArray === true
    && live.rowsShape.everyRowHasId === true && live.rowsShape.everyRowHasRouteFields === true,
    live.rowsShape);
  check('COR-11', 'the customer ownership scoping is unchanged: every row belongs to the caller',
    live.rowsShape && live.rowsShape.everyRowScopedToCustomer === true, live.rowsShape);
  check('COR-12', 'the ordering the history feed depends on is unchanged: newest first',
    live.rowsShape && live.rowsShape.descending === true, live.rowsShape);
  check('COR-13', 'the caller-supplied limit and offset still bound and move the window',
    live.window && live.window.threw === false && live.window.length === 5
    && live.windowShape && live.windowShape.startsWhereTheUnboundedReadSkips === true
    && live.offsetWindow && live.offsetWindow.length === 5 && live.offsetAdvanced === true,
    { limit5: live.window && live.window.length, offset5: live.offsetWindow && live.offsetWindow.length, advanced: live.offsetAdvanced });
  check('COR-14', 'a customer with genuinely no orders is still an empty array, and not an outage',
    live.zeroOrderCustomer && live.zeroOrderCustomer.threw === false
    && live.zeroOrderCustomer.isArray === true && live.zeroOrderCustomer.length === 0,
    { threw: live.zeroOrderCustomer && live.zeroOrderCustomer.threw, length: live.zeroOrderCustomer && live.zeroOrderCustomer.length });
  check('COR-15', 'the single order read still returns the row it was asked for, by uuid',
    live.byId && live.byId.threw === false && live.byId.hasId === true
    && live.byId.linesArray === true && live.byIdMatchesRequestedRow === true,
    { threw: live.byId && live.byId.threw, linesArray: live.byId && live.byId.linesArray });
  check('COR-16', 'the same read by order_number resolves to the same order (contract kept)',
    live.byNumber && live.byNumber.threw === false && live.byNumberIsTheSameOrder === true,
    { threw: live.byNumber && live.byNumber.threw, id: live.byNumber && live.byNumber.id });
  check('COR-17', 'a successful read that finds no row keeps the established not-found value (null, no throw)',
    live.notFound && live.notFound.threw === false && live.notFound.isNull === true
    && live.notFoundLive === true,
    { threw: live.notFound && live.notFound.threw, isNull: live.notFound && live.notFound.isNull });
  check('COR-18', 'calls with no customer id and no order id keep their existing answers (no new throw)',
    live.emptyCustomerId && live.emptyCustomerId.threw === false && live.emptyCustomerId.isArray === true
    && live.emptyOrderId && live.emptyOrderId.threw === false && live.emptyOrderId.isNull === true,
    { list: live.emptyCustomerId, detail: live.emptyOrderId });

  // ================================================= 3. routes with the store working
  const livePort = await findFreePort();
  const liveServer = await spawnServerChild('serve_live', livePort);
  const liveBase = `http://127.0.0.1:${livePort}`;
  let ownDetail = null;
  try {
    const tokens = await mintTokens(liveBase, fx);
    check('COR-19', 'a backend with a reachable store authenticates both customer fixtures over real HTTP',
      Boolean(tokens.orders && tokens.zero), { minted: Object.values(tokens).filter(Boolean).length });

    const list = await request('GET', liveBase, '/api/customer/orders', undefined, tokens.orders);
    check('COR-20', 'the customer order list answers a success carrying the rows that exist',
      list.status === 200 && list.data.success === true && Array.isArray(list.data.orders)
      && list.data.orders.length === list.data.count && list.data.count === expectDefault,
      { status: list.status, count: list.data.count, success: list.data.success });

    const zeroList = await request('GET', liveBase, '/api/customer/orders', undefined, tokens.zero);
    check('COR-21', 'a customer whose history is genuinely empty gets a successful empty read, not a failure',
      zeroList.status === 200 && zeroList.data.success === true && zeroList.data.count === 0
      && Array.isArray(zeroList.data.orders) && zeroList.data.orders.length === 0,
      { status: zeroList.status, body: zeroList.data });

    ownDetail = await request('GET', liveBase, `/api/customer/orders/${fx.ordersId}`, undefined, tokens.orders);
    check('COR-22', 'the order detail endpoint answers the customer\'s own order with its lines',
      ownDetail.status === 200 && ownDetail.data.success === true && ownDetail.data.order
      && ownDetail.data.order.id === fx.ordersId && Array.isArray(ownDetail.data.order.lines),
      { status: ownDetail.status, id: ownDetail.data.order && ownDetail.data.order.id });

    const alias = await request('GET', liveBase, `/api/orders/${fx.ordersId}`, undefined, tokens.orders);
    check('COR-23', 'the id-free alias still serves the same row (caller compatibility)',
      alias.status === 200 && alias.data.success === true && alias.data.order
      && alias.data.order.id === fx.ordersId,
      { status: alias.status, id: alias.data.order && alias.data.order.id });

    const byNumber = await request('GET', liveBase, `/api/customer/orders/${fx.ordersNumber}`, undefined, tokens.orders);
    check('COR-24', 'the detail endpoint still resolves an order_number to the same order',
      byNumber.status === 200 && byNumber.data.order && byNumber.data.order.id === fx.ordersId,
      { status: byNumber.status, id: byNumber.data.order && byNumber.data.order.id });

    const missing = await request('GET', liveBase, `/api/customer/orders/${fx.notFoundUuid}`, undefined, tokens.orders);
    check('COR-25', 'an order id with no row is STILL a 404 — the fix must not move the not-found contract',
      missing.status === 404 && missing.data.success === false,
      { status: missing.status, body: missing.data });

    const cross = await request('GET', liveBase, `/api/customer/orders/${fx.ordersId}`, undefined, tokens.zero);
    check('COR-26', 'another customer reading this order is refused and carries no order',
      cross.status === 403 && cross.data.success === false && cross.data.order === undefined,
      { status: cross.status, body: cross.data });

    const noTokList = await request('GET', liveBase, '/api/customer/orders');
    const noTokDetail = await request('GET', liveBase, `/api/customer/orders/${fx.ordersId}`);
    const noTokActivity = await request('GET', liveBase, '/api/customer/activity');
    check('COR-27', 'customer authentication is still required on all three order reads',
      noTokList.status === 401 && noTokDetail.status === 401 && noTokActivity.status === 401,
      { list: noTokList.status, detail: noTokDetail.status, activity: noTokActivity.status });

    const activity = await request('GET', liveBase, '/api/customer/activity', undefined, tokens.orders);
    const actOrders = Array.isArray(activity.data.items)
      ? activity.data.items.filter(i => i.service === 'FOOD' || i.service === 'INSTAMART') : [];
    check('COR-28', 'the shared history feed still succeeds and still carries this customer\'s orders',
      activity.status === 200 && activity.data.success === true && actOrders.length > 0,
      { status: activity.status, items: activity.data.count, orderItems: actOrders.length });

    const statusMissing = await request('POST', liveBase,
      `/api/merchant/${fx.restaurantMerchant}/orders/${fx.notFoundUuid}/status`, { status: 'ACCEPTED' }, tokens.restaurantMerchant);
    check('COR-29', 'the merchant status route still answers 404 for an order with no row (no mutation reached)',
      statusMissing.status === 404 && statusMissing.data.success === false,
      { status: statusMissing.status, body: statusMissing.data });

    check('COR-30', 'a successful customer read leaks no credential, connection target or stack shape',
      leaksIn(list.text, SECRET_MARKERS).length === 0 && leaksIn(ownDetail.text, SECRET_MARKERS).length === 0
      && leaksIn(activity.text, SECRET_MARKERS).length === 0,
      { list: leaksIn(list.text, SECRET_MARKERS), detail: leaksIn(ownDetail.text, SECRET_MARKERS), activity: leaksIn(activity.text, SECRET_MARKERS) });
  } finally {
    liveServer.proc.kill();
  }

  // ================================================= 4. routes with the customer order read failing
  const downPort = await findFreePort();
  const downServer = await spawnServerChild('serve_down', downPort);
  const downBase = `http://127.0.0.1:${downPort}`;
  try {
    const tokens = await mintTokens(downBase, fx);
    check('COR-31', 'an order-read outage does not disable customer authentication (the outage is scoped)',
      Boolean(tokens.orders && tokens.zero), { minted: Object.values(tokens).filter(Boolean).length });

    const list = await request('GET', downBase, '/api/customer/orders', undefined, tokens.orders);
    check('COR-32', 'the list route refuses instead of answering success with an empty history',
      list.data.success !== true && list.status >= 500,
      { status: list.status, success: list.data.success, code: list.data.code });
    check('COR-33', 'it uses the existing outage convention: HTTP 503 with code STORE_UNAVAILABLE',
      list.status === 503 && list.data.code === 'STORE_UNAVAILABLE',
      { status: list.status, code: list.data.code });
    check('COR-34', 'and it presents neither an `orders` array nor `count: 0` as if the history were empty',
      list.data.orders === undefined && list.data.count === undefined,
      { keys: Object.keys(list.data) });

    const detail = await request('GET', downBase, `/api/customer/orders/${fx.ordersId}`, undefined, tokens.orders);
    check('COR-35', 'the detail route does NOT turn the outage into a 404 Order not found',
      detail.status !== 404 && detail.data.success !== true && detail.status >= 500,
      { status: detail.status, code: detail.data.code, error: detail.data.error });
    check('COR-36', 'the detail route answers the same typed 503 with the logged request id',
      detail.status === 503 && detail.data.code === 'STORE_UNAVAILABLE' && Boolean(detail.data.requestId),
      { status: detail.status, code: detail.data.code, requestId: detail.data.requestId });
    check('COR-37', 'the failed detail carries no `order` value for a client to render',
      detail.data.order === undefined, { keys: Object.keys(detail.data) });

    const activity = await request('GET', downBase, '/api/customer/activity', undefined, tokens.orders);
    check('COR-38', 'the history feed answers 503 as its own comment promises, not an empty history',
      activity.status === 503 && activity.data.code === 'STORE_UNAVAILABLE'
      && activity.data.items === undefined && activity.data.count === undefined,
      { status: activity.status, code: activity.data.code, keys: Object.keys(activity.data) });

    const pay = await request('POST', downBase, '/api/payments/create-order',
      { amount: 100, currency: 'INR', serviceType: 'FOOD', metadata: { orderId: fx.ordersId } }, tokens.orders);
    check('COR-39', 'the payment route refuses instead of skipping the order-ownership check it could not run',
      pay.status === 503 && pay.data.code === 'STORE_UNAVAILABLE' && pay.data.session === undefined,
      { status: pay.status, code: pay.data.code, keys: Object.keys(pay.data) });

    const statusChange = await request('POST', downBase,
      `/api/merchant/${fx.restaurantMerchant}/orders/${fx.ordersId}/status`, { status: 'ACCEPTED' }, tokens.restaurantMerchant);
    check('COR-40', 'the merchant status route answers the outage as 503, not as a missing order',
      statusChange.status === 503 && statusChange.data.code === 'STORE_UNAVAILABLE',
      { status: statusChange.status, code: statusChange.data.code });

    const packed = await request('POST', downBase,
      `/api/grocery/orders/${fx.groceryOrderId}/packed-weight`,
      { itemId: fx.groceryLineId, packedWeight: 0.5 }, tokens.groceryMerchant);
    check('COR-41', 'the packed-weight caller of the same read reports the outage, not "Order not found"',
      packed.status === 503 && packed.data.code === 'STORE_UNAVAILABLE'
      && !/not found/i.test(String(packed.data.error || '')),
      { status: packed.status, code: packed.data.code, error: packed.data.error });

    check('COR-42', 'authentication is still enforced during the outage (401 before any order read)',
      (await request('GET', downBase, '/api/customer/orders')).status === 401
      && (await request('GET', downBase, `/api/customer/orders/${fx.ordersId}`)).status === 401, undefined);

    const leakBodies = [list, detail, activity, pay, statusChange, packed];
    check('COR-43', 'no failure body leaks SQL, the schema it queried, the connection target, a credential or a stack trace',
      leakBodies.every(r => leaksIn(r.text, SECRET_MARKERS).length === 0
        && leaksIn(r.text, INTERNAL_MARKERS).length === 0),
      leakBodies.map(r => ({ s: r.status, leaks: [...leaksIn(r.text, SECRET_MARKERS), ...leaksIn(r.text, INTERNAL_MARKERS)] })));

    const me = await request('GET', downBase, '/api/auth/me', undefined, tokens.orders);
    check('COR-44', 'a customer route that does not read orders is untouched by this fix (no blanket outage)',
      me.status === 200, { status: me.status, code: me.data.code });
  } finally {
    downServer.proc.kill();
  }

  // ------------------------------------------------------------ own records only, then proof
  // The residue question this suite has to answer for itself: the orders it minted are read by
  // children through the same store, so they can only go once every check has run, and they must
  // go by id - not by "looks like a test order", which would reach into another suite's rows.
  // The allocated phone numbers are counted as well, because the store can mint a row this suite
  // never asked for: /api/auth/verify-otp auto-registers a customer for a phone shape it does not
  // already have, and that account's id is not in the registry. Measuring only recorded ids would
  // report a clean exit next to a leaked account.
  const contextIds = [fx.ordersCustomer, fx.zeroCustomer, fx.groceryMerchant, fx.restaurantMerchant];
  const phoneKeys = [fx.ordersPhone, fx.zeroPhone, fx.groceryPhone, fx.restaurantPhone]
    .map((p) => String(p || '').replace(/\D/g, '').slice(-10));
  const removed = await fxh.cleanup();
  const residue = (await c.query(
    `SELECT (SELECT count(*) FROM users WHERE id = ANY($1::uuid[]) OR right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($2::text[]))::text u,
            (SELECT count(*) FROM merchants WHERE id = ANY($1::uuid[]))::text m,
            (SELECT count(*) FROM orders WHERE customer_id = ANY($1::uuid[]) OR merchant_id = ANY($1::uuid[]))::text o,
            (SELECT count(*) FROM restaurant_kds_tickets WHERE merchant_id = ANY($1::uuid[]))::text k,
            (SELECT count(*) FROM backend_sessions WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($2::text[]))::text s`
    , [contextIds, phoneKeys])).rows[0];
  await c.end();
  cleanupFixtures = null;
  check('COR-45', 'this suite leaves no user, merchant, order, KDS ticket or session row behind',
    Number(residue.u) === 0 && Number(residue.m) === 0 && Number(residue.o) === 0
    && Number(residue.k) === 0 && Number(residue.s) === 0,
    { removed: Object.keys(removed).filter((key) => key !== 'blocked').map((key) => `${key}=${removed[key]}`).join(' '),
      residue, blocked: removed.blocked });

  const failed = results.filter(r => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 CUSTOMER ORDER-READ RELIABILITY: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed`);
  console.log('========================================================================');
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_COR_CHILD) {
  runChild(process.env.NABIN_COR_CHILD).catch(err => {
    console.log(`COR_VERDICT ${JSON.stringify({ scenario: process.env.NABIN_COR_CHILD, ok: false, crashed: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') })}`);
    process.exit(3);
  });
} else {
  main().catch(async (err) => {
    console.error('COR ABORTED:', err.stack || err.message);
    // An unexpected throw must not strand the rows this suite minted.
    if (cleanupFixtures) await cleanupFixtures().catch(e => console.error('COR fixture cleanup failed:', e.message));
    process.exit(2);
  });
}
