/*
 * MRCH — GROCERY CHECKOUT MERCHANT SUBSTITUTION: which store an order is written against when the
 * request names none, read out of PostgreSQL.
 *
 * `POST /api/grocery/checkout/validate` (src/server.js:9328) is misnamed — it is the authoritative
 * grocery order-generation path: it writes the durable `checkouts` row, then the `orders` row through
 * `create_order_with_lines_atomic`, then broadcasts to the merchant socket, publishes the merchant
 * notification and dispatches the delivery job. Its first line of merchant selection was
 * `req.body.merchantId || req.body.restaurantId || req.body.storeId || 'mcht_1'` — so a request that
 * named no store was not refused: it was answered on behalf of a store the route picked, and `mcht_1`
 * is a legacy alias (`OrderRepository.js:13`, `LEGACY_MERCHANT_MAP`) which resolves on this target to
 * uuid 00000000-0000-0000-0000-000000000201, measured by SELECT to be "Dilli Darbar Authentic Mughlai",
 * merchant_type RESTAURANT, is_open true, approval_status APPROVED, 1,172 order rows already attached.
 *
 * That is the same class as the invented delivery address link 106 closed: the boundary completes a
 * request from its own defaults instead of refusing it, and the thing it invents here is the counterparty
 * of the money. Today the route's own `MERCHANT_TYPE_MISMATCH` gate happens to reject that particular
 * seed row, so no order lands — but the guard is the row's `merchant_type`, not the code, and the
 * RESTAURANT-vs-HYBRID_BOTH question for that exact row is an open owner decision. Change the seed and
 * the invented default silently becomes a durable order, a checkout, a merchant notification and a rider
 * dispatch against a store that never received the intent.
 *
 * The correction matches the platform's own precedent at this boundary: refuse at the boundary, before
 * any side effect, and name the field. `{ status: 400, code: 'MERCHANT_REQUIRED', field: 'merchantId' }`
 * now sits where the default was — after the pause/feature/auth gates, before the dark-store gate, and
 * before item resolution, coupon redemption and both writes. The accepted aliases (`restaurantId`,
 * `storeId`) still resolve, and `resolveMerchant`'s legacy map is untouched, because read paths outside
 * this route legitimately receive legacy ids; only this route's invented *default* is deleted.
 *
 * Both real clients already name a store, so nothing that works today breaks: the Flutter grocery
 * checkout derives one store from the cart's own merchantIds and refuses when that set is not exactly
 * one (mobile/.../grocery_checkout_screen.dart:179-195) and customer-web now gates a blank store before
 * it posts (customer-web/src/app/grocery/page.tsx, link 108). This route was reachable with no store only
 * by a hand-made request.
 *
 * Assertions are durable. A 400 is not evidence on its own — the refused attempts must also leave zero
 * `orders` and zero `checkouts` rows for this run's own customer, and the refusal must not burn the
 * idempotency key it arrived with. GROUP B is the over-broad-fix guard: the identical cart WITH a store
 * id still succeeds, and the persisted `orders.merchant_id` / `checkouts.merchant_id` are read back and
 * compared to the fixture store, so a fix that merely broke the route cannot pass. GROUP C pins the
 * source, including that the legacy alias map other readers depend on is still there.
 *
 * Local Docker only. `scripts/chain_target_guard` refuses a non-loopback declared store, and the split
 * -target check (#283) refuses a `SUPABASE_URL` that is not the same loopback the assertion handle
 * reads. Registered as an ISOLATED chain link: it writes `checkouts`, `orders` and `order_lines`, all
 * census-protected, so the writes must die in `chain_scratch`.
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

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'grocery_merchant_required_test' });
const PG = PG_TARGET.connectionString;
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('MRCH REFUSED: non-loopback PostgreSQL target'); process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !LOOPBACK.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('MRCH REFUSED: SUPABASE_URL points to a non-loopback host ('
    + new URL(process.env.SUPABASE_URL).hostname + `) while the assertion handle reads `
    + `${PG_TARGET.host}. That is the split-target class (#283). Run through scripts/with_local_target.js.`);
  process.exit(1);
}

const SERVER_FILE = path.join(__dirname, 'src', 'server.js');
const ORDER_REPO_FILE = path.join(__dirname, 'src', 'repositories', 'OrderRepository.js');
const ROUTE_PATH = '/api/grocery/checkout/validate';
const TYPED_ADDRESS = 'Fortipua Hnamte Veng, Aizawl 796001';
const INVENTED_ALIAS = 'mcht_1';
const LEGACY_UUID = '00000000-0000-0000-0000-000000000201';

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
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
  check('MRCH-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin,
    { isLivePostgres, declaredBy: PG_TARGET.source, host: PG_TARGET.host, database: PG_TARGET.database });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log(`\n=== GROCERY MERCHANT REQUIRED TEST: 0/${results.length || 1} passed, 1 failed ===`);
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
  // the store's history. The merchant column is read back too: which store an order ended up on is the
  // whole question this suite asks.
  const orderRows = async (customerId) => (await c.query(
    `SELECT id::text id, merchant_id::text merchant FROM orders WHERE customer_id = $1::uuid`,
    [customerId])).rows;
  const checkoutRows = async (customerId) => (await c.query(
    `SELECT id::text id, merchant_id::text merchant FROM checkouts WHERE customer_id = $1::uuid`,
    [customerId])).rows;

  try {
    fx = await openFixtures('mrch', { connectionString: PG });
    const store = await fx.merchant({ type: 'GROCERY', name: 'merchant required store' });
    const other = await fx.merchant({ type: 'GROCERY', name: 'the store nobody named' });
    const customer = await fx.customer({ name: 'merchant required customer' });
    const item = await fx.groceryItem(store.id, {
      name: 'merchant required rice', store_price: 120, stock_quantity: 40,
    });

    // What the invented default actually resolves to on THIS target. Read, not assumed: the suite's
    // severity claim ("a real, serviceable storefront") is only true if this row is open and approved.
    const legacy = await one(
      'SELECT id::text id, name, merchant_type, is_open, approval_status FROM merchants WHERE id = $1::uuid',
      [LEGACY_UUID]);
    console.log(`[context] the route's invented default '${INVENTED_ALIAS}' resolves to: `
      + JSON.stringify(legacy));

    proc = await bootServer();
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    check('MRCH-01', 'a backend this run started and will reap is healthy on its own private port',
      health.status === 200, { port });

    const login = createLogin({ baseUrl: BASE, request });
    const cust = await login(customer.phone, 'CUSTOMER');
    check('MRCH-02', 'the fixture customer authenticated through the real OTP path',
      Boolean(cust.token), cust.failure || {});
    if (!cust.token) throw new Error('no customer session — the suite cannot reach the checkout route');

    const cart = [{ inventoryId: item.id, quantity: 2 }];
    const post = (body, key) => request('POST', ROUTE_PATH, {
      cartItems: cart, deliveryAddress: TYPED_ADDRESS, paymentMethod: 'CASH', ...body,
    }, { ...bearer(cust.token), ...(key ? { 'Idempotency-Key': key } : {}) });

    const runTag = fx.runId.replace(/[^A-Za-z0-9]/g, '');

    // ---- GROUP A — a checkout naming no store must be refused and must write nothing ----
    const ordersBefore = (await orderRows(customer.id)).length;
    const checkoutsBefore = (await checkoutRows(customer.id)).length;

    const noMerchant = await post({}, `mrch_none_${runTag}`);
    const emptyMerchant = await post({ merchantId: '' }, `mrch_empty_${runTag}`);
    const blankMerchant = await post({ merchantId: '   ' }, `mrch_blank_${runTag}`);
    // The realistic attempt: the customer's own basket, no store field at all. Whatever the route does
    // with it, it must not do it on behalf of a store the request never named.
    const aliasOnly = await post({ storeId: '   ', restaurantId: '' }, `mrch_aliases_${runTag}`);

    check('MRCH-10', 'a checkout with no merchantId is refused, not completed on some store\'s behalf',
      noMerchant.status === 400 && noMerchant.data?.code === 'MERCHANT_REQUIRED'
        && noMerchant.data?.field === 'merchantId',
      { status: noMerchant.status, code: noMerchant.data?.code, field: noMerchant.data?.field,
        orderMerchant: noMerchant.data?.order?.merchantId ?? null });
    check('MRCH-11', 'an empty-string merchantId is refused with the same contract',
      emptyMerchant.status === 400 && emptyMerchant.data?.code === 'MERCHANT_REQUIRED',
      { status: emptyMerchant.status, code: emptyMerchant.data?.code });
    check('MRCH-12', 'a whitespace-only merchantId is refused rather than trimmed into some store',
      blankMerchant.status === 400 && blankMerchant.data?.code === 'MERCHANT_REQUIRED',
      { status: blankMerchant.status, code: blankMerchant.data?.code });
    check('MRCH-13', 'blank accepted aliases fall through to the same refusal, not to the route default',
      aliasOnly.status === 400 && aliasOnly.data?.code === 'MERCHANT_REQUIRED',
      { status: aliasOnly.status, code: aliasOnly.data?.code });

    const ordersAfter = await orderRows(customer.id);
    const checkoutsAfter = await checkoutRows(customer.id);
    check('MRCH-14', 'the four refused attempts wrote no order row',
      ordersAfter.length === ordersBefore,
      { before: ordersBefore, after: ordersAfter.length, merchants: ordersAfter.map((r) => r.merchant) });
    check('MRCH-15', 'the four refused attempts wrote no checkout row',
      checkoutsAfter.length === checkoutsBefore,
      { before: checkoutsBefore, after: checkoutsAfter.length });
    check('MRCH-16', 'nothing this run wrote landed on the store the route would have invented',
      [...ordersAfter, ...checkoutsAfter].every((r) => r.merchant !== LEGACY_UUID),
      { orderMerchants: ordersAfter.map((r) => r.merchant),
        checkoutMerchants: checkoutsAfter.map((r) => r.merchant) });
    check('MRCH-17', 'no refusal response hands the customer an order from a store they never named',
      [noMerchant, emptyMerchant, blankMerchant, aliasOnly]
        .every((r) => !r.data?.order || !r.data.order.id),
      { echoed: [noMerchant, emptyMerchant, blankMerchant, aliasOnly]
        .map((r) => r.data?.order?.id ?? null) });

    // Ordering proof from behaviour: the refused attempt's own idempotency key must still be free, so a
    // refusal placed before the writes cannot leave a half-registered checkout behind.
    const reuse = await post({ merchantId: store.id }, `mrch_none_${runTag}`);
    check('MRCH-18', 'a refusal does not burn the idempotency key — the same key with a store id then succeeds',
      reuse.status === 200 && reuse.data?.success === true && reuse.data?.duplicate !== true
        && Boolean(reuse.data?.order?.id),
      { status: reuse.status, code: reuse.data?.code, duplicate: reuse.data?.duplicate });

    // ---- GROUP B — the fix must not be over-broad: naming a store still checks out, on that store ----
    const named = await post({ merchantId: store.id }, `mrch_named_${runTag}`);
    const namedOrder = named.data?.order || {};
    check('MRCH-19', 'the same cart with a store id still completes the checkout',
      named.status === 200 && named.data?.success === true && Boolean(namedOrder.id),
      { status: named.status, code: named.data?.code, error: named.data?.error });
    const persistedOrder = await one(
      'SELECT merchant_id::text merchant FROM orders WHERE id = $1::uuid', [namedOrder.id]);
    check('MRCH-20', 'the persisted order row belongs to the store the request named',
      persistedOrder?.merchant === String(store.id),
      { expected: String(store.id), persisted: persistedOrder?.merchant ?? null });
    const persistedCheckout = await one(
      'SELECT merchant_id::text merchant FROM checkouts WHERE id = $1::uuid', [namedOrder.checkoutId]);
    check('MRCH-21', 'the persisted checkout row names the same store',
      Boolean(namedOrder.checkoutId) && persistedCheckout?.merchant === String(store.id),
      { checkoutId: namedOrder.checkoutId || null, persisted: persistedCheckout?.merchant ?? null });
    check('MRCH-22', 'the response snapshot reports that store, not a stand-in',
      String(namedOrder.merchantId || namedOrder.merchant_id || '') === String(store.id),
      { snapshot: namedOrder.merchantId ?? namedOrder.merchant_id ?? null });

    // The accepted aliases stay accepted — this suite removes a default, not a naming convention.
    const viaStoreId = await post({ storeId: store.id }, `mrch_storeid_${runTag}`);
    const viaRestaurantId = await post({ restaurantId: store.id }, `mrch_restid_${runTag}`);
    check('MRCH-23', 'the storeId alias still resolves to the named store',
      viaStoreId.status === 200 && viaStoreId.data?.success === true,
      { status: viaStoreId.status, code: viaStoreId.data?.code });
    check('MRCH-24', 'the restaurantId alias still resolves to the named store',
      viaRestaurantId.status === 200 && viaRestaurantId.data?.success === true,
      { status: viaRestaurantId.status, code: viaRestaurantId.data?.code });

    // Gates the refusal must not disturb, asserted by behaviour.
    const dark = await post({ merchantId: 'mcht_darkstore_1' }, `mrch_dark_${runTag}`);
    check('MRCH-25', 'the dark-store refusal still answers its own code (precedence unchanged)',
      dark.status === 400 && dark.data?.code === 'DARK_STORE_NOT_SUPPORTED',
      { status: dark.status, code: dark.data?.code });
    const unknown = await post({ merchantId: 'mcht-does-not-exist-anywhere' }, `mrch_unknown_${runTag}`);
    check('MRCH-26', 'an unknown store id is still 404 MERCHANT_NOT_FOUND, not swallowed by the new gate',
      unknown.status === 404 && unknown.data?.code === 'MERCHANT_NOT_FOUND',
      { status: unknown.status, code: unknown.data?.code });
    const anon = await request('POST', ROUTE_PATH,
      { cartItems: cart, deliveryAddress: TYPED_ADDRESS }, {});
    check('MRCH-27', 'an unauthenticated no-store request is still refused as unauthenticated',
      anon.status === 401, { status: anon.status, code: anon.data?.code });

    const durableOrders = await orderRows(customer.id);
    check('MRCH-28', 'exactly the accepted checkouts persisted, and every one on the store that was named',
      durableOrders.length === ordersBefore + 4
        && durableOrders.every((r) => r.merchant === String(store.id)),
      { expected: ordersBefore + 4, found: durableOrders.length,
        merchants: durableOrders.map((r) => r.merchant) });

    // ---- GROUP C — source pins: the default is gone and the refusal precedes the writes ----
    const src = fs.readFileSync(SERVER_FILE, 'utf8');
    const routeIdx = src.indexOf(`app.post('${ROUTE_PATH}'`);
    const nextRoute = src.indexOf("\napp.", routeIdx + 10);
    const window = src.slice(routeIdx, nextRoute > routeIdx ? nextRoute : routeIdx + 9000);
    check('MRCH-30', 'the checkout route window was located and read (the pin is not vacuous)',
      routeIdx > 0 && window.length > 800, { chars: window.length });
    check('MRCH-31', 'the route no longer reaches for a store the request did not name',
      window.indexOf(`'${INVENTED_ALIAS}'`) === -1,
      { occurrences: window.split(`'${INVENTED_ALIAS}'`).length - 1 });
    const fileWide = src.split(`'${INVENTED_ALIAS}'`).length - 1;
    check('MRCH-32', 'no server source anywhere still defaults an order to that invented store',
      fileWide === 0, { occurrences: fileWide });
    check('MRCH-33', 'the route refuses with a MERCHANT_REQUIRED contract that names the field',
      window.includes("'MERCHANT_REQUIRED'") && window.includes("field: 'merchantId'"), null);
    const refusalIdx = window.indexOf("'MERCHANT_REQUIRED'");
    const darkIdx = window.indexOf('DARK_STORE_NOT_SUPPORTED');
    const resolveIdx = window.indexOf('resolveGroceryItems(');
    const couponIdx = window.indexOf('redeemCoupon(');
    const checkoutIdx = window.indexOf('createCheckoutSession(');
    const orderIdx = window.indexOf('createOrderWithLinesAtomic(');
    check('MRCH-34', 'the refusal sits before item resolution, coupon redemption and both writes',
      refusalIdx !== -1 && refusalIdx < resolveIdx && refusalIdx < couponIdx
        && refusalIdx < checkoutIdx && refusalIdx < orderIdx,
      { refusalIdx, resolveIdx, couponIdx, checkoutIdx, orderIdx });
    check('MRCH-35', 'the refusal sits ahead of the dark-store gate it must not displace',
      refusalIdx !== -1 && darkIdx !== -1 && refusalIdx < darkIdx,
      { refusalIdx, darkIdx });
    // Minimality: the legacy alias map belongs to `resolveMerchant` and other read paths pass legacy ids
    // through it. Deleting the route default must not delete the alias resolution.
    const repoSrc = fs.readFileSync(ORDER_REPO_FILE, 'utf8');
    check('MRCH-36', 'the legacy merchant alias map other readers depend on is untouched',
      repoSrc.includes("'mcht_1'") && repoSrc.includes("'rest_1'") && repoSrc.includes(LEGACY_UUID),
      { hasMcht1: repoSrc.includes("'mcht_1'"), hasRest1: repoSrc.includes("'rest_1'") });

    // ---- residue report: what this run leaves behind, stated not assumed ----
    const keptOrders = await orderRows(customer.id);
    console.log(`[residue] orders=${keptOrders.length} checkouts=${(await checkoutRows(customer.id)).length} `
      + `merchants=${JSON.stringify([...new Set(keptOrders.map((r) => r.merchant))])} — retained, because `
      + 'orders are an append-only domain and the delete guard on them is a policy, not a cleanup hook '
      + '(link 123). They live in chain_scratch when run as an isolated link.');
  } catch (err) {
    check('MRCH-99', 'suite completed without an unexpected error', false,
      { error: err && err.message, stack: String(err && err.stack || '').split('\n')[1] });
  } finally {
    await stopProc(proc);
    try { if (fx) await fx.close(); } catch { /* fixture handle already closed */ }
    try { await c.end(); } catch { /* handle already closed */ }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log(`\n=== GROCERY MERCHANT REQUIRED TEST: ${passed}/${results.length} passed, ${failed} failed ===`);
  process.exitCode = failed ? 1 : 0;
})();
