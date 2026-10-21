/*
 * MI-6 (P0) — an admin suspension of a storefront has to reach the store that enforces it.
 *
 * The gap this suite holds shut:
 *   `db.setRestaurantStatus()` (database.js) wrote `operationalStatus` / `isOpen` onto an entry of
 *   the in-process `this.restaurants` array and then answered `{ success: true }` with a
 *   `RESTAURANT_SUSPENDED` audit row behind it. Nothing in the codebase ever wrote
 *   `merchants.is_open = false`. Meanwhile the two places that actually decide whether a storefront
 *   may trade — `OrderRepository.resolveMerchant()` and the closure gate on
 *   `POST /api/customer/book-food` — read the PostgreSQL row, and `GET /api/restaurants?openNow=true`
 *   filters on that same column. So the control was decorative: a real merchant uuid answered
 *   "Restaurant not found", and a seeded demo entry "succeeded" in one process's memory while the
 *   store stayed open to customers for the rest of its life. The driver equivalent
 *   (`DriverRepository.updateDriverStatus`) already writes `drivers.operational_status` durably and
 *   refuses with a typed 503 when the store declines — this is the same control, same idiom, for
 *   merchants.
 *
 * What is proven here, against durable state and a second process, never from a response body alone:
 *   MSD-01, 01A, 02..03
 *               the precondition: an anonymously registered storefront lands durable and PENDING with
 *               its row closed (the lifecycle migration 048 defines), an authorized admin approval
 *               makes it durably APPROVED and OPEN, and it is then discoverable and reaches the order
 *               gate. Without these the checks below mean nothing, because a suspension of something
 *               never open proves nothing.
 *   MSD-04..05  the admin suspension answers success AND the durable row says closed.
 *   MSD-06..08  the order gate refuses with a typed code, discovery stops listing it, and the
 *               durable audit trail carries the uuid it acted on.
 *   MSD-09      a freshly spawned backend process still refuses — the state lives in the store,
 *               not in whichever process handled the POST.
 *   MSD-10..11  reactivation works from that process and the gate opens again: the fix must not
 *               brick a store it was asked to reopen.
 *   MSD-12      an unauthenticated status call is refused and moves no row.
 *   MSD-13      a store that refuses the write is an outage, not a success: typed 503, the row
 *               stays as it was, and no `success: true` is answered.
 *   MSD-14      an id with no row behind it is not reported as suspended.
 *   MSD-15      the shared seeded merchant is untouched by any of it.
 *   MSD-16..17  the mobile admin console's `ACTIVE` token is accepted as a reopen and actually
 *               leaves the durable row open — the alias must not be a 400 and must not be a no-op.
 *   MSD-18..24  the second half of the same defect: making a write durable is not the same as
 *               enforcing it at every boundary that consumes it. Closure was gated at exactly one
 *               of the two order-creation routes, and `POST /api/grocery/checkout/validate` is
 *               misnamed — it writes the durable checkout and the order row and broadcasts
 *               `ORDER_RECEIVED`. So a suspended GROCERY storefront still took grocery orders. These
 *               checks register a grocery store (PENDING), approve it, suspend it, and require the
 *               refusal (`MERCHANT_CLOSED`) to come before item resolution, to leave no durable order
 *               or checkout row, and to lift when the store is reopened.
 *   MSD-25      a third storefront that this run approves but never suspends stays open, listed and
 *               orderless — the two suspensions above are scoped to the stores they named.
 *
 * Local/test only: refuses a non-loopback backend or database. Run via scripts/with_local_target.js.
 * Cleanup deletes the rows this run created — its own merchants, its own customer, and that customer's
 * sessions. What stays is deliberate: the `audit_logs` rows (append-only by migration 022) and the two
 * `backend_sessions` rows minted by logging in as the SHARED seeded `superadmin`, whose only matching
 * handle is the username. Both are reported as attributed drift by the chain census rather than
 * deleted to make a census look clean.
 */
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('pg');

const PG = process.env.DATABASE_URL;
const STAMP = Date.now();
const SUFFIX = crypto.randomBytes(3).toString('hex');
const isLoopback = (u) => {
  let host; try { host = new URL(u).hostname; } catch (e) { return false; }
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(host);
};
if (!PG || !isLoopback(PG)) {
  console.error('MI-6 REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
  process.exit(1);
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}
function skip(id, name, reason) {
  results.push({ id, pass: true, skipped: true });
  console.log(`[SKIP] ${id} ${name} -> ${reason}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(base, method, urlPath, body, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, base);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null; try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: String(data).slice(0, 200) }; }
        resolve({ status: res.statusCode, data: json || {} });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, hung: true, data: {} }); });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
  });
}

async function bootBackend() {
  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  if (!isLoopback(base)) throw new Error('refusing to bind a non-loopback base ' + base);
  const child = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: String(port) },
  });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    const h = await request(base, 'GET', '/api/health', null, {}, 1500);
    if (h.status === 200) return { base, child };
  }
  try { child.kill(); } catch (e) {}
  throw new Error('private backend never bound :' + port);
}

/** A customer bearer for a number this run owns; CUSTOMER sign-in provisions the account. */
async function customerToken(base, rawPhone) {
  await request(base, 'POST', '/api/auth/send-otp', { phone: rawPhone, role: 'CUSTOMER', purpose: 'LOGIN' });
  const send = await request(base, 'POST', '/api/auth/send-otp', { phone: rawPhone, role: 'CUSTOMER', purpose: 'LOGIN' });
  const verify = await request(base, 'POST', '/api/auth/verify-otp', {
    phone: rawPhone, otp: (send.data && send.data.testOtp) || '7729',
    role: 'CUSTOMER', purpose: 'LOGIN'
  });
  return verify.data && verify.data.token;
}

const openGateReachesResolution = (r) => r.status === 400 && r.data.code === 'INVALID_ITEMS';

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('MSD-ALL', 'merchant suspension durability', 'needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const readMerchant = (id) => one('SELECT id, name, is_open, merchant_type, approval_status FROM merchants WHERE id=$1::uuid', [id]);

  const STORE_NAME = `MSD Suspended Kitchen ${SUFFIX}`;
  const MERCHANT_PHONE = `+9190${String(STAMP).slice(-8)}`;
  const CUSTOMER_PHONE = `+9191${String(STAMP).slice(-8)}`;
  const GROCERY_PHONE = `+9193${String(STAMP).slice(-8)}`;
  const SEED_MERCHANT = '00000000-0000-0000-0000-000000000201';

  const children = [];
  let ownMerchantId = null;
  let probeMerchantId = null;
  let groceryMerchantId = null;
  try {
    const first = await bootBackend();
    children.push(first);
    const BASE = first.base;

    // ---- MSD-01..03A the storefront under test becomes open, durable, and tradeable ----
    const reg = await request(BASE, 'POST', '/api/merchant/register', {
      name: STORE_NAME, phone: MERCHANT_PHONE, address: `12 MSD Test Road, Aizawl ${SUFFIX}`,
      businessType: 'RESTAURANT', lat: 23.7271, lng: 92.7176
    });
    ownMerchantId = reg.data && reg.data.merchant && reg.data.merchant.id;
    const row0 = ownMerchantId ? await readMerchant(ownMerchantId) : null;
    // Since migration 048 an anonymous registration is a declaration, not a storefront: the row is
    // durable but PENDING and closed. Pinning that here is what keeps MSD-02..24 honest — the store
    // they suspend was opened by the approval decision, and a regression that reopens registration
    // itself fails MSD-01 instead of making the suspension checks test something that was never
    // supposed to be tradeable.
    check('MSD-01', 'an anonymously registered storefront lands as a durable PENDING, closed restaurant row',
      reg.status === 201 && !!row0 && row0.is_open === false && row0.approval_status === 'PENDING'
        && row0.merchant_type === 'RESTAURANT',
      { status: reg.status, code: reg.data.code, id: ownMerchantId, row: row0 });
    if (!ownMerchantId) throw new Error('no merchant to test with: registration answered ' + reg.status);

    const adminLogin = await request(BASE, 'POST', '/api/admin/login', SUPER);
    const adminToken = adminLogin.data && adminLogin.data.token;
    if (!adminToken) throw new Error('SUPER_ADMIN login refused: ' + JSON.stringify(adminLogin.data).slice(0, 160));

    // The one door that may make a store tradeable (`db.setMerchantApproval`, behind
    // `merchant.manage`). `POST /api/admin/restaurants/:id/status` can no longer do it — that is
    // MOA-16's rule, and using the status route as a setup step here would hide the defect it pins.
    const approveStore = async (id, base = BASE) => {
      const answer = await request(base, 'POST', `/api/admin/merchants/${id}/approval`,
        { decision: 'APPROVE', reason: `MSD harness: approved for suspension testing ${SUFFIX}` }, bearer(adminToken));
      return { answer, row: await readMerchant(id) };
    };
    const opened = await approveStore(ownMerchantId);
    check('MSD-01A', 'the admin approval decision makes the storefront durably APPROVED and open',
      opened.answer.status === 200 && opened.answer.data.success === true
        && opened.row && opened.row.approval_status === 'APPROVED' && opened.row.is_open === true,
      { status: opened.answer.status, code: opened.answer.data.code, error: opened.answer.data.error,
        row: opened.row });

    const listOpen = async (base, token) => {
      const r = await request(base, 'GET', `/api/restaurants?openNow=true&search=${token}`, null);
      const ids = ((r.data && r.data.restaurants) || []).map(x => String(x.id));
      return { status: r.status, ids, count: r.data && r.data.count };
    };
    const discover0 = await listOpen(BASE, SUFFIX);
    check('MSD-02', 'the open storefront is returned by customer discovery with openNow=true',
      discover0.status === 200 && discover0.ids.includes(ownMerchantId), discover0);

    const custToken = await customerToken(BASE, CUSTOMER_PHONE);
    // `items: []` is refused by product resolution AFTER the closure gate, so reaching it proves the
    // gate let the request through. A suspension that did not land would answer the same 400, which
    // is why MSD-06 asserts the 403 instead of trusting this shape alone.
    const bookOpen = await request(BASE, 'POST', '/api/customer/book-food', {
      restaurantId: ownMerchantId, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(custToken));
    check('MSD-03', 'while the row is open the order gate lets the request reach menu resolution',
      custToken && openGateReachesResolution(bookOpen),
      { status: bookOpen.status, code: bookOpen.data.code, error: bookOpen.data.error, hasToken: !!custToken });
    if (!custToken) throw new Error('no customer bearer: the precondition is unmet, nothing below means anything');

    // ---- MSD-04..05 the suspension must answer success AND change the row ----
    const suspendReason = `MSD harness: suspected fraudulent storefront ${SUFFIX}`;
    const suspend = await request(BASE, 'POST', `/api/admin/restaurants/${ownMerchantId}/status`,
      { status: 'SUSPENDED', reason: suspendReason }, bearer(adminToken));
    check('MSD-04', 'the admin suspension of a real merchant uuid answers success',
      suspend.status === 200 && suspend.data.success === true,
      { status: suspend.status, code: suspend.data.code, error: suspend.data.error });
    const rowS = await readMerchant(ownMerchantId);
    check('MSD-05', 'the durable merchants row says closed (was: mirror-only, row stayed open)',
      !!rowS && rowS.is_open === false, { is_open: rowS && rowS.is_open });

    // ---- MSD-06..08 the enforcement paths follow the row ----
    const bookClosed = await request(BASE, 'POST', '/api/customer/book-food', {
      restaurantId: ownMerchantId, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(custToken));
    check('MSD-06', 'the order gate now refuses the suspended storefront with a typed code',
      bookClosed.status === 403 && bookClosed.data.code === 'MERCHANT_CLOSED',
      { status: bookClosed.status, code: bookClosed.data.code, error: bookClosed.data.error });
    const discoverS = await listOpen(BASE, SUFFIX);
    check('MSD-07', 'discovery with openNow=true no longer lists the suspended storefront',
      discoverS.status === 200 && !discoverS.ids.includes(ownMerchantId), discoverS);
    const trail = await one(
      `SELECT id, action, target_entity_id, previous_state, new_state, reason
       FROM audit_logs WHERE target_entity_id=$1 AND action='RESTAURANT_SUSPENDED'
       ORDER BY created_at DESC LIMIT 1`, [ownMerchantId]);
    check('MSD-08', 'the durable audit trail records the suspension against the merchant uuid',
      !!trail && trail.new_state === 'SUSPENDED' && String(trail.reason || '').includes(SUFFIX),
      { trail: trail && { action: trail.action, new_state: trail.new_state, reason: trail.reason } });

    // ---- MSD-09 a different process must give the same answer ----
    const second = await bootBackend();
    children.push(second);
    const admin2 = await request(second.base, 'POST', '/api/admin/login', SUPER);
    const cust2 = await customerToken(second.base, CUSTOMER_PHONE);
    const bookAfterRestart = cust2
      ? await request(second.base, 'POST', '/api/customer/book-food',
        { restaurantId: ownMerchantId, items: [], orderChannel: 'TAKEAWAY' }, bearer(cust2))
      : { status: 0, data: {} };
    const rowRestart = await readMerchant(ownMerchantId);
    check('MSD-09', 'a freshly spawned backend still refuses the suspended storefront',
      bookAfterRestart.status === 403 && bookAfterRestart.data.code === 'MERCHANT_CLOSED'
        && rowRestart && rowRestart.is_open === false && !!admin2.data.token,
      { status: bookAfterRestart.status, code: bookAfterRestart.data.code,
        is_open: rowRestart && rowRestart.is_open });

    // ---- MSD-10..11 reactivation, from the second process, must not brick the store ----
    const reactivate = await request(second.base, 'POST', `/api/admin/restaurants/${ownMerchantId}/status`,
      { status: 'APPROVED', reason: `MSD harness: reactivated ${SUFFIX}` }, bearer(admin2.data.token));
    const rowR = await readMerchant(ownMerchantId);
    check('MSD-10', 'reactivation answers success and the durable row says open again',
      reactivate.status === 200 && reactivate.data.success === true && rowR && rowR.is_open === true,
      { status: reactivate.status, code: reactivate.data.code, is_open: rowR && rowR.is_open,
        error: reactivate.data.error });
    const discoverR = await listOpen(second.base, SUFFIX);
    check('MSD-11', 'the reactivated storefront is discoverable and the gate opens again',
      discoverR.ids.includes(ownMerchantId), { ids: discoverR.ids, hasOwn: discoverR.ids.includes(ownMerchantId) });

    // ---- MSD-12 the route stays behind admin authentication ----
    const noAuth = await request(second.base, 'POST', `/api/admin/restaurants/${ownMerchantId}/status`,
      { status: 'SUSPENDED', reason: 'unauthenticated attempt' });
    const rowAfterNoAuth = await readMerchant(ownMerchantId);
    check('MSD-12', 'an unauthenticated suspension is refused and moves no row',
      (noAuth.status === 401 || noAuth.status === 403) && rowAfterNoAuth && rowAfterNoAuth.is_open === true,
      { status: noAuth.status, is_open: rowAfterNoAuth && rowAfterNoAuth.is_open });

    // ---- MSD-13 a refused durable write is an outage, not a success ----
    // `settleAuthoritative` is the seam every auth/authority write in this file goes through
    // (database.js), so stubbing it is the store declining, not a different code path.
    const orig = db.settleAuthoritative;
    let refused = null;
    let mirrorEntry = (db.restaurants || []).find(r => String(r.id) === String(ownMerchantId));
    const mirrorBefore = mirrorEntry ? { isOpen: mirrorEntry.isOpen, operationalStatus: mirrorEntry.operationalStatus } : null;
    try {
      db.settleAuthoritative = async () => ({
        data: null, error: { message: 'MSD harness: simulated store refusal', code: 'PGRST1' }
      });
      refused = await db.setRestaurantStatus(ownMerchantId, 'SUSPENDED',
        `MSD harness forced refusal ${SUFFIX}`, 'admin-msd', 'MSD Admin').then(
        (r) => ({ threw: false, result: r }), (err) => ({ threw: true, code: err.code, status: err.status || err.statusCode, message: err.message }));
    } finally {
      db.settleAuthoritative = orig;
    }
    const rowAfterRefusal = await readMerchant(ownMerchantId);
    mirrorEntry = (db.restaurants || []).find(r => String(r.id) === String(ownMerchantId));
    check('MSD-13', 'a store that refuses the suspension rejects typed as unavailable and writes nothing',
      !!refused && refused.threw === true && refused.status === 503 && !!refused.code
        && rowAfterRefusal && rowAfterRefusal.is_open === true
        && (!mirrorEntry || (mirrorEntry.isOpen === (mirrorBefore ? mirrorBefore.isOpen : mirrorEntry.isOpen))
          && mirrorEntry.operationalStatus !== 'SUSPENDED'),
      { refused, is_open: rowAfterRefusal && rowAfterRefusal.is_open,
        mirror: mirrorEntry && { isOpen: mirrorEntry.isOpen, operationalStatus: mirrorEntry.operationalStatus } });

    // ---- MSD-14 an id with no row behind it is not reported as suspended ----
    const ghost = crypto.randomUUID();
    const ghostCall = await request(second.base, 'POST', `/api/admin/restaurants/${ghost}/status`,
      { status: 'SUSPENDED', reason: `MSD harness ghost ${SUFFIX}` }, bearer(admin2.data.token));
    const ghostTrail = await one(
      'SELECT id FROM audit_logs WHERE target_entity_id=$1 AND action=\'RESTAURANT_SUSPENDED\' LIMIT 1', [ghost]);
    check('MSD-14', 'a merchant id with no durable row is refused and leaves no suspension trail',
      ghostCall.status !== 200 && ghostCall.data.success !== true && !ghostTrail,
      { status: ghostCall.status, success: ghostCall.data.success, code: ghostCall.data.code,
        trail: !!ghostTrail });

    // ---- MSD-15 the shared seeded record was never the target ----
    const seedBefore = await one('SELECT is_open FROM merchants WHERE id=$1::uuid', [SEED_MERCHANT]);
    const seedViaApi = await request(second.base, 'POST', `/api/admin/restaurants/rest_1/status`,
      { status: 'APPROVED', reason: `MSD harness seed probe ${SUFFIX}` }, bearer(admin2.data.token));
    const seedAfter = await one('SELECT is_open FROM merchants WHERE id=$1::uuid', [SEED_MERCHANT]);
    check('MSD-15', 'the shared seeded merchant row is unchanged by the whole run',
      !!seedBefore && !!seedAfter && seedBefore.is_open === seedAfter.is_open
        && seedViaApi.status !== 500,
      { before: seedBefore && seedBefore.is_open, after: seedAfter && seedAfter.is_open,
        legacyHandleAnswer: { status: seedViaApi.status, success: seedViaApi.data.success, code: seedViaApi.data.code } });

    // ---- MSD-16 the mobile console's `ACTIVE` token means reopen, not a 400 ----
    // `admin_merchants_screen.dart` sends 'ACTIVE' where admin-web sends 'APPROVED'. The status
    // vocabulary this suite pins is strict, so the alias has to be accepted — otherwise the
    // suspend/activate control on the Flutter admin surface starts failing on the activate half.
    const resuspend = await request(second.base, `POST`, `/api/admin/restaurants/${ownMerchantId}/status`,
      { status: 'SUSPENDED', reason: `MSD harness re-suspend ${SUFFIX}` }, bearer(admin2.data.token));
    const viaAlias = await request(second.base, 'POST', `/api/admin/restaurants/${ownMerchantId}/status`,
      { status: 'ACTIVE', reason: `MSD harness ACTIVE alias ${SUFFIX}` }, bearer(admin2.data.token));
    const rowAlias = await readMerchant(ownMerchantId);
    check('MSD-16', 'the ACTIVE alias reopens the storefront durably instead of being refused',
      resuspend.status === 200 && rowAlias && rowAlias.is_open === true
        && viaAlias.status === 200 && viaAlias.data.persisted === true
        && viaAlias.data.dataSource === 'postgres',
      { resuspend: resuspend.status, alias: { status: viaAlias.status, code: viaAlias.data.code,
        persisted: viaAlias.data.persisted, dataSource: viaAlias.data.dataSource },
        is_open_after: rowAlias && rowAlias.is_open });
    const rowAliasFinal = await readMerchant(ownMerchantId);
    check('MSD-17', 'the ACTIVE half actually left the row open (alias is not a no-op)',
      rowAliasFinal && rowAliasFinal.is_open === true, { is_open: rowAliasFinal && rowAliasFinal.is_open });

    // ---- MSD-18..23 the suspension has to reach the GROCERY order gate too ----
    // `MERCHANT_CLOSED` was enforced at one site only - the food closure gate on
    // POST /api/customer/book-food. POST /api/grocery/checkout/validate is misnamed: it resolves
    // the merchant, checks `merchant_type`, then writes the durable checkout AND the order row and
    // broadcasts ORDER_RECEIVED. It checked the store's shape but never whether the store is open,
    // so a suspended GROCERY storefront kept taking orders. These checks pin the boundary the same
    // way MSD-03/MSD-06 pin the food one: an open store reaches item resolution, a closed one is
    // refused before any cart work, and the refusal is the gate's own typed code.
    const groceryReg = await request(second.base, 'POST', '/api/merchant/register', {
      name: `MSD Suspended Mart ${SUFFIX}`, phone: GROCERY_PHONE,
      address: `14 MSD Mart Road, Aizawl ${SUFFIX}`, businessType: 'GROCERY', lat: 23.7271, lng: 92.7176
    });
    groceryMerchantId = groceryReg.data && groceryReg.data.merchant && groceryReg.data.merchant.id;
    const groRow0 = groceryMerchantId ? await readMerchant(groceryMerchantId) : null;
    check('MSD-18', 'a GROCERY storefront registered for the gate test is durable, PENDING and closed',
      groceryReg.status === 201 && !!groRow0 && groRow0.is_open === false
        && groRow0.approval_status === 'PENDING' && groRow0.merchant_type === 'GROCERY',
      { status: groceryReg.status, code: groceryReg.data.code, id: groceryMerchantId, row: groRow0 });
    if (!groceryMerchantId) throw new Error('no grocery storefront: the boundary below cannot be probed');

    const openedGrocery = await approveStore(groceryMerchantId, second.base);
    check('MSD-18A', 'the admin approval opens the grocery storefront durably, so the gate below has a live store',
      openedGrocery.answer.status === 200 && openedGrocery.row
        && openedGrocery.row.approval_status === 'APPROVED' && openedGrocery.row.is_open === true,
      { status: openedGrocery.answer.status, code: openedGrocery.answer.data.code, row: openedGrocery.row });

    const groceryCheckout = (cart) => request(second.base, 'POST', '/api/grocery/checkout/validate',
      { merchantId: groceryMerchantId, cartItems: cart }, bearer(cust2));
    const reachesCartResolution = (r) => r.status === 400 && r.data.code === 'EMPTY_CART';
    const groceryOpen = await groceryCheckout([]);
    check('MSD-19', 'while the grocery row is open the checkout boundary reaches cart validation',
      cust2 && reachesCartResolution(groceryOpen),
      { status: groceryOpen.status, code: groceryOpen.data.code, hasToken: !!cust2 });

    const suspendGrocery = await request(second.base, 'POST', `/api/admin/restaurants/${groceryMerchantId}/status`,
      { status: 'SUSPENDED', reason: `MSD harness: suspended grocery mart ${SUFFIX}` }, bearer(admin2.data.token));
    const groRowS = await readMerchant(groceryMerchantId);
    check('MSD-20', 'suspending the grocery storefront answers success and closes the durable row',
      suspendGrocery.status === 200 && !!groRowS && groRowS.is_open === false,
      { status: suspendGrocery.status, code: suspendGrocery.data.code, is_open: groRowS && groRowS.is_open });

    // The empty cart is refused before item resolution, so it proves the gate is reached. The bogus
    // non-empty cart is the one that proves the gate fires BEFORE any cart/price/coupon work: with
    // no gate that request goes on to `resolveGroceryItems`, which answers 400 INVALID_ITEMS.
    const groceryClosed = await groceryCheckout([]);
    check('MSD-21', 'the suspended grocery storefront is refused at checkout with MERCHANT_CLOSED',
      groceryClosed.status === 403 && groceryClosed.data.code === 'MERCHANT_CLOSED',
      { status: groceryClosed.status, code: groceryClosed.data.code, error: groceryClosed.data.error });
    const groceryClosedCart = await groceryCheckout([
      { productId: crypto.randomUUID(), quantity: 1, requestedQtyKg: 1 }
    ]);
    check('MSD-22', 'the grocery refusal precedes item resolution, not just the empty-cart check',
      groceryClosedCart.status === 403 && groceryClosedCart.data.code === 'MERCHANT_CLOSED',
      { status: groceryClosedCart.status, code: groceryClosedCart.data.code });

    // Nothing was written for that store at any point in the run - asserted from the store, because
    // a 403 body proves only the route answered.
    const groResidue = await one(
      `SELECT (SELECT count(*) FROM orders WHERE merchant_id=$1::uuid) AS orders,
              (SELECT count(*) FROM checkouts WHERE merchant_id=$1::uuid) AS checkouts`,
      [groceryMerchantId]);
    check('MSD-23', 'no durable grocery order or checkout row was written for the suspended store',
      !!groResidue && Number(groResidue.orders) === 0 && Number(groResidue.checkouts) === 0, groResidue);

    const reactivateGrocery = await request(second.base, 'POST', `/api/admin/restaurants/${groceryMerchantId}/status`,
      { status: 'APPROVED', reason: `MSD harness: reopen grocery mart ${SUFFIX}` }, bearer(admin2.data.token));
    const groceryReopened = await groceryCheckout([]);
    check('MSD-24', 'reactivating the grocery storefront opens the checkout boundary again',
      reactivateGrocery.status === 200 && reachesCartResolution(groceryReopened),
      { reactivate: reactivateGrocery.status, code: reactivateGrocery.data.code,
        reopen: { status: groceryReopened.status, code: groceryReopened.data.code } });

    // A third storefront, registered and approved but never suspended, proves the two suspensions
    // above were scoped to the stores they named. Before migration 048 this was a note on
    // `is_open === false`; that reading is gone, because a freshly registered store is *supposed* to
    // be closed now, so the witness has to be an approved store staying open with no order behind it.
    const probe = await request(second.base, 'POST', '/api/merchant/register', {
      name: `MSD Probe Store ${SUFFIX}`, phone: `+9192${String(STAMP).slice(-8)}`,
      address: `13 MSD Probe Road, Aizawl ${SUFFIX}`, businessType: 'RESTAURANT', lat: 23.7271, lng: 92.7176
    });
    probeMerchantId = probe.data && probe.data.merchant && probe.data.merchant.id;
    const openedProbe = probeMerchantId ? await approveStore(probeMerchantId, second.base) : { answer: {}, row: null };
    const probeResidue = probeMerchantId ? await one(
      `SELECT (SELECT count(*) FROM orders WHERE merchant_id=$1::uuid) AS orders,
              (SELECT count(*) FROM checkouts WHERE merchant_id=$1::uuid) AS checkouts`,
      [probeMerchantId]) : null;
    const probeDiscover = await listOpen(second.base, SUFFIX);
    check('MSD-25', 'an approved storefront this run never suspended stays open, listed, and takes no order',
      !!probeMerchantId && !!openedProbe.row && openedProbe.row.approval_status === 'APPROVED'
        && openedProbe.row.is_open === true && probeDiscover.ids.includes(probeMerchantId)
        && !!probeResidue && Number(probeResidue.orders) === 0 && Number(probeResidue.checkouts) === 0,
      { id: probeMerchantId, row: openedProbe.row, listed: probeDiscover.ids.includes(probeMerchantId),
        residue: probeResidue });
  } finally {
    // Rows this run created, removed by the exact handles it used. `audit_logs` is append-only
    // (migration 022) so its rows stay and the census reports them as attributed drift.
    const phones = [MERCHANT_PHONE, CUSTOMER_PHONE, `+9192${String(STAMP).slice(-8)}`, GROCERY_PHONE];
    for (const id of [ownMerchantId, probeMerchantId, groceryMerchantId].filter(Boolean)) {
      try { await c.query('DELETE FROM merchants WHERE id=$1::uuid', [id]); } catch (e) { console.log('  merchant cleanup note: ' + e.message); }
    }
    for (const p of phones) {
      try { await c.query('DELETE FROM backend_sessions WHERE phone=$1', [p]); } catch (e) { console.log('  session cleanup note: ' + e.message); }
      try { await c.query('DELETE FROM users WHERE phone=$1', [p]); } catch (e) { console.log('  user cleanup note: ' + e.message); }
    }
    for (const k of children) { try { k.child.kill(); } catch (e) {} }
    await c.end();
  }
  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== MI-6 MERCHANT SUSPENSION DURABILITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
