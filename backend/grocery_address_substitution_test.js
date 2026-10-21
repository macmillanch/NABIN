/*
 * GA — GROCERY DELIVERY-ADDRESS SUBSTITUTION: what the checkout persists when the customer typed
 * nothing, read out of PostgreSQL.
 *
 * `POST /api/grocery/checkout/validate` (src/server.js:9311) is misnamed — it is the authoritative
 * grocery order-generation path: it writes the durable `checkouts` row, then the `orders` row through
 * `create_order_with_lines_atomic`, then broadcasts and dispatches. Until the fix this suite pins,
 * three of its expressions fell back to a place nobody chose — the checkout metadata, the order
 * metadata and the response snapshot each read the request field `|| ` the invented literal.
 *
 * There was no address validation anywhere on this route. The sibling that takes the same money does
 * validate: `POST /api/customer/book-food` refuses at :4819-4829 with
 * `{ status: 400, code: 'PLACE_REQUIRED', field: 'deliveryAddress' }` and the error text says why —
 * "NABIN writes the address you give; it does not fill one in." Both of this platform's own clients
 * already behave as if the backend refused: the Flutter grocery checkout gates Place Order on
 * `_deliveryAddress.isNotEmpty` (mobile/.../grocery_checkout_screen.dart:149) and customer-web grocery
 * guards on `!deliveryAddress.trim()` before it posts (customer-web/src/app/grocery/page.tsx:142).
 * So the server was the only party that accepted an address-less delivery, and it accepted it by
 * inventing one — into a paid order row and into the checkout that bills it.
 *
 * The route already knew the literal was a fabrication: P3 #436 read the *typed* value separately and
 * refused to send a rider to it, calling it "a job the platform invented" — but it guarded only the
 * rider, so the order and the checkout still recorded the invented place and the customer was shown it
 * back as their own address.
 *
 * The correction is the food route's, applied here: `typedDeliveryAddress` and its refusal now sit at
 * :9415-9425, before any side effect (item resolution, coupon redemption, checkout write, order write)
 * and after the merchant gates, and all three substitutions are deleted, so what persists is what was
 * sent or nothing at all. No fare, distance or geo behaviour changes; the delivery handover is reached
 * only through a typed address now.
 *
 * Assertions are durable. A 400 is not evidence on its own — the refused attempt must also leave zero
 * `checkouts` rows and zero `orders` rows for this run's own customer, and no row this run created may
 * carry the literal. GROUP B is the over-broad-fix guard: the identical cart WITH a typed address still
 * succeeds and persists exactly that string, so a refusal cannot pass by breaking grocery checkout.
 * GA-17 additionally proves the refusal is placed before the side effects rather than merely early, by
 * re-using the refused attempt's idempotency key for a valid checkout.
 *
 * Local Docker only. `scripts/chain_target_guard` refuses a non-loopback declared store, and the split
 * -target check (#283) refuses a `SUPABASE_URL` that is not the same loopback the assertion handle
 * reads — otherwise the order would be written in one store and counted in another. Registered as an
 * ISOLATED chain link: it writes `checkouts`, `orders` and `order_lines`, all census-protected, so the
 * writes must die in `chain_scratch`.
 */

'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const { openFixtures } = require('./test_fixtures');
const { createLogin } = require('./testSessionCache');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'grocery_address_substitution_test' });
const PG = PG_TARGET.connectionString;
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('GA REFUSED: non-loopback PostgreSQL target'); process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !LOOPBACK.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('GA REFUSED: SUPABASE_URL points to a non-loopback host ('
    + new URL(process.env.SUPABASE_URL).hostname + `) while the assertion handle reads `
    + `${PG_TARGET.host}. That is the split-target class (#283). Run through scripts/with_local_target.js.`);
  process.exit(1);
}

const SERVER_FILE = path.join(__dirname, 'src', 'server.js');
const ROUTE_PATH = '/api/grocery/checkout/validate';
const TYPED_ADDRESS = 'Fortipua Hnamte Veng, Aizawl 796001';
const LITERAL = 'Default Address';

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        resolve({ status: res.statusCode, data: parsed, raw: data });
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

(async () => {
  check('GA-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin,
    { isLivePostgres, declaredBy: PG_TARGET.source, host: PG_TARGET.host, database: PG_TARGET.database });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log(`\n=== GROCERY ADDRESS SUBSTITUTION TEST: 0/${results.length || 1} passed, 1 failed ===`);
    process.exitCode = 1;
    return;
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const WHERE = await one('SELECT current_schema() AS schema, inet_server_addr()::text AS server, '
    + 'inet_server_port() AS port');
  console.log(`TARGET: declared by ${PG_TARGET.source} -> ${PG_TARGET.host}:${PG_TARGET.port}/`
    + `${PG_TARGET.database}, assertion handle searches schema "${WHERE.schema}", write handle is `
    + `SUPABASE_URL ${process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : '(unset)'}`);

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  let proc = null;
  let fx = null;

  async function bootServer() {
    const p = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
      env: {
        ...process.env, PORT: String(port),
        NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0',
      },
    }));
    p.unref();
    for (let i = 0; i < 180; i++) {
      await sleep(500);
      try { const h = await request('GET', '/api/health'); if (h.status === 200) return p; } catch { /* not up */ }
    }
    return p;
  }

  async function stopProc(p) {
    if (!p || !p.pid) return;
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' });
      } else p.kill('SIGTERM');
    } catch { /* already gone */ }
  }

  // Scoped to THIS run's own fixture customer, so a count is a fact about these requests and not about
  // the store's history.
  const orderRows = async (customerId) => (await c.query(
    `SELECT id::text id, metadata->>'deliveryAddress' AS addr FROM orders WHERE customer_id = $1::uuid`,
    [customerId])).rows;
  const checkoutRows = async (customerId) => (await c.query(
    `SELECT id::text id, metadata->>'deliveryAddress' AS addr FROM checkouts WHERE customer_id = $1::uuid`,
    [customerId])).rows;

  try {
    fx = await openFixtures('ga', { connectionString: PG });
    const store = await fx.merchant({ type: 'GROCERY', name: 'address substitution store' });
    const customer = await fx.customer({ name: 'address substitution customer' });
    const item = await fx.groceryItem(store.id, {
      name: 'address test rice', store_price: 120, stock_quantity: 40,
    });

    proc = await bootServer();
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    check('GA-01', 'a backend this run started and will reap is healthy on its own private port',
      health.status === 200, { port });

    const login = createLogin({ baseUrl: BASE, request });
    const cust = await login(customer.phone, 'CUSTOMER');
    check('GA-02', 'the fixture customer authenticated through the real OTP path',
      Boolean(cust.token), cust.failure || {});
    if (!cust.token) throw new Error('no customer session — the suite cannot reach the checkout route');

    const cart = [{ inventoryId: item.id, quantity: 2 }];
    const post = (body, key) => request('POST', ROUTE_PATH, {
      merchantId: store.id, cartItems: cart, paymentMethod: 'WALLET', ...body,
    }, { ...bearer(cust.token), ...(key ? { 'Idempotency-Key': key } : {}) });

    // ---- GROUP A — an address-less grocery delivery must be refused and must write nothing ----
    const keyA = `ga_nohost_${fx.runId.replace(/[^A-Za-z0-9]/g, '')}`;
    const ordersBefore = (await orderRows(customer.id)).length;
    const checkoutsBefore = (await checkoutRows(customer.id)).length;

    const noAddress = await post({}, keyA);
    const emptyAddress = await post({ deliveryAddress: '' }, `ga_empty_${fx.runId.replace(/[^A-Za-z0-9]/g, '')}`);
    const blankAddress = await post({ deliveryAddress: '   ' }, `ga_blank_${fx.runId.replace(/[^A-Za-z0-9]/g, '')}`);

    check('GA-10', 'a checkout with no deliveryAddress is refused, not filled in',
      noAddress.status === 400 && noAddress.data?.code === 'PLACE_REQUIRED'
        && noAddress.data?.field === 'deliveryAddress',
      { status: noAddress.status, code: noAddress.data?.code, field: noAddress.data?.field,
        echoedAddress: noAddress.data?.order?.deliveryAddress });
    check('GA-11', 'an empty-string deliveryAddress is refused with the same contract',
      emptyAddress.status === 400 && emptyAddress.data?.code === 'PLACE_REQUIRED'
        && emptyAddress.data?.field === 'deliveryAddress',
      { status: emptyAddress.status, code: emptyAddress.data?.code });
    check('GA-12', 'a whitespace-only deliveryAddress is refused rather than stored as a place',
      blankAddress.status === 400 && blankAddress.data?.code === 'PLACE_REQUIRED',
      { status: blankAddress.status, code: blankAddress.data?.code,
        persisted: blankAddress.data?.order?.deliveryAddress });

    const ordersAfter = await orderRows(customer.id);
    const checkoutsAfter = await checkoutRows(customer.id);
    check('GA-13', 'the three refused attempts wrote no order row',
      ordersAfter.length === ordersBefore,
      { before: ordersBefore, after: ordersAfter.length,
        addresses: ordersAfter.map((r) => r.addr).filter(Boolean) });
    check('GA-14', 'the three refused attempts wrote no checkout row',
      checkoutsAfter.length === checkoutsBefore,
      { before: checkoutsBefore, after: checkoutsAfter.length });
    check('GA-15', 'no row this run created records the invented literal',
      [...ordersAfter, ...checkoutsAfter].every((r) => r.addr !== LITERAL),
      { orders: ordersAfter.map((r) => r.addr), checkouts: checkoutsAfter.map((r) => r.addr) });
    check('GA-16', 'no refused response shows the customer back an address they did not type',
      [noAddress, emptyAddress, blankAddress].every((r) => r.data?.order?.deliveryAddress !== LITERAL),
      { echoed: [noAddress, emptyAddress, blankAddress].map((r) => r.data?.order?.deliveryAddress ?? null) });

    // Ordering proof from behaviour: the refused attempt's own idempotency key must still be free, so a
    // refusal placed before the writes cannot leave a half-registered checkout behind.
    const reuse = await post({ deliveryAddress: TYPED_ADDRESS }, keyA);
    check('GA-17', 'a refusal does not burn the idempotency key — the same key with a typed address then succeeds',
      reuse.status === 200 && reuse.data?.success === true && reuse.data?.duplicate !== true
        && Boolean(reuse.data?.order?.id),
      { status: reuse.status, code: reuse.data?.code, duplicate: reuse.data?.duplicate });

    // ---- GROUP B — the fix must not be over-broad: the same cart with a typed address still works ----
    const typed = await post({ deliveryAddress: TYPED_ADDRESS },
      `ga_typed_${fx.runId.replace(/[^A-Za-z0-9]/g, '')}`);
    const typedOrder = typed.data?.order || {};
    check('GA-20', 'the same cart with a typed address still completes the checkout',
      typed.status === 200 && typed.data?.success === true && Boolean(typedOrder.id),
      { status: typed.status, code: typed.data?.code, error: typed.data?.error });
    check('GA-21', 'the persisted order metadata holds exactly the address the customer sent',
      typed.data?.success === true && (await c.query(
        `SELECT metadata->>'deliveryAddress' AS addr FROM orders WHERE id = $1::uuid`, [typedOrder.id],
      )).rows[0]?.addr === TYPED_ADDRESS,
      { persisted: (await c.query(
        `SELECT metadata->>'deliveryAddress' AS addr FROM orders WHERE id = $1::uuid`, [typedOrder.id],
      )).rows[0]?.addr });
    const typedCheckoutId = typedOrder.checkoutId;
    check('GA-22', 'the persisted checkout metadata holds the same typed address, un-decorated',
      Boolean(typedCheckoutId) && (await c.query(
        `SELECT metadata->>'deliveryAddress' AS addr FROM checkouts WHERE id = $1::uuid`, [typedCheckoutId],
      )).rows[0]?.addr === TYPED_ADDRESS,
      { checkoutId: typedCheckoutId || null });
    check('GA-23', 'the response snapshot echoes the typed address instead of a stand-in',
      typedOrder.deliveryAddress === TYPED_ADDRESS,
      { echoed: typedOrder.deliveryAddress ?? null });
    check('GA-24', 'with a real address the route no longer reports the address as missing',
      typed.data?.success === true && typed.data?.deliveryJob?.code !== 'DELIVERY_ADDRESS_MISSING',
      { deliveryJob: typed.data?.deliveryJob || null });

    const durableOrders = await orderRows(customer.id);
    check('GA-25', 'exactly the successful checkouts persisted, one per accepted request',
      durableOrders.length === ordersBefore + 2,
      { expected: ordersBefore + 2, found: durableOrders.length });

    // ---- GROUP C — source pins: the substitution is gone and the refusal precedes the writes ----
    const src = fs.readFileSync(SERVER_FILE, 'utf8');
    const routeIdx = src.indexOf(`app.post('${ROUTE_PATH}'`);
    const nextRoute = src.indexOf("\napp.", routeIdx + 10);
    const window = src.slice(routeIdx, nextRoute > routeIdx ? nextRoute : routeIdx + 9000);
    check('GA-30', 'the checkout route window was located and read (the pin is not vacuous)',
      routeIdx > 0 && window.length > 800, { chars: window.length });
    check('GA-31', 'the grocery route contains no "Default Address" substitution at all',
      window.indexOf(LITERAL) === -1, { occurrences: window.split(LITERAL).length - 1 });
    const fileWide = src.split(LITERAL).length - 1;
    check('GA-32', 'no server source anywhere still writes that invented place',
      fileWide === 0, { occurrences: fileWide });
    check('GA-33', 'the route refuses with the food route\'s PLACE_REQUIRED contract, naming the field',
      window.includes("'PLACE_REQUIRED'") && window.includes("field: 'deliveryAddress'"),
      null);
    const refusalIdx = window.indexOf("'PLACE_REQUIRED'");
    const resolveIdx = window.indexOf('resolveGroceryItems(');
    const couponIdx = window.indexOf('redeemCoupon(');
    const checkoutIdx = window.indexOf('createCheckoutSession(');
    const orderIdx = window.indexOf('createOrderWithLinesAtomic(');
    check('GA-34', 'the refusal sits before item resolution, coupon redemption and both writes',
      refusalIdx !== -1 && refusalIdx < resolveIdx && refusalIdx < couponIdx
        && refusalIdx < checkoutIdx && refusalIdx < orderIdx,
      { refusalIdx, resolveIdx, couponIdx, checkoutIdx, orderIdx });
    // The food route's own refusal, read from its own window — not the first PLACE_REQUIRED token in
    // the file, which belongs to the `placedEnd` booking helper (server.js:80).
    const foodIdx = src.indexOf("app.post('/api/customer/book-food'");
    const foodWindow = src.slice(foodIdx, foodIdx + 4000);
    check('GA-35', 'the food route that already refuses an address-less delivery is untouched',
      foodIdx > 0 && foodWindow.includes("'PLACE_REQUIRED'")
        && foodWindow.includes("field: 'deliveryAddress'"),
      { foodIdx });

    // ---- residue report: what this run leaves behind, stated not assumed ----
    const keptOrders = await orderRows(customer.id);
    console.log(`[residue] orders=${keptOrders.length} checkouts=${(await checkoutRows(customer.id)).length} `
      + `addresses=${JSON.stringify(keptOrders.map((r) => r.addr))} — retained, because orders are an `
      + 'append-only domain and the delete guard on them is a policy, not a cleanup hook (link 123). '
      + 'They live in chain_scratch when run as an isolated link.');
  } catch (err) {
    check('GA-99', 'suite completed without an unexpected error', false,
      { error: err && err.message, stack: String(err && err.stack || '').split('\n')[1] });
  } finally {
    await stopProc(proc);
    try { if (fx) await fx.close(); } catch { /* fixture handle already closed */ }
    try { await c.end(); } catch { /* handle already closed */ }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== GROCERY ADDRESS SUBSTITUTION TEST: ${passed}/${results.length} passed, ${failed} failed ===`);
  process.exitCode = failed ? 1 : 0;
})();
