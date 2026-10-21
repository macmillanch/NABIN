/*
 * MI-5 (P0) — an unauthenticated merchant registration must not mint a trading storefront.
 *
 * The gap this suite holds shut, measured against the current source and the current local store
 * rather than against the earlier report:
 *   `POST /api/merchant/register` (server.js:5153) needs no credential of any kind, and
 *   `MerchantRepository.createMerchant` (repositories/MerchantRepository.js:174-189) writes
 *   `is_open: true` and `rating: 4.80` into the durable `merchants` row. There is no approval-shaped
 *   column on that table at all (measured: 27 columns, none of them approval/status/verification), so
 *   "approved" is not a state the store can even hold — the storefront is simply open from the first
 *   INSERT. From there every consumer follows the row: `GET /api/restaurants` lists it, the closure
 *   gates at server.js:4771 and server.js:9169 pass it because `is_open` is true, and a MERCHANT OTP
 *   sign-in (database.js:7168) issues a bearer carrying the store's own uuid with no approval check,
 *   which reaches all 41 merchant-authenticated write routes. So anyone with a phone number and a
 *   POST can stand up a store that takes real customer orders, sets its own UPI destination, and
 *   publishes its own menu — with a fabricated 4.80 rating on the way out.
 *
 * The project already knows how to express this lifecycle: `drivers.kyc_status VARCHAR DEFAULT
 * 'PENDING'` with a CHECK over ('PENDING','SUBMITTED','UNDER_REVIEW','VERIFIED','REJECTED','SUSPENDED'),
 * plus `kyc_verified_at` and `kyc_rejected_reason` (populated 1411 PENDING / 786 VERIFIED). This suite
 * pins the merchant equivalent — a durable pending state, an admin decision that writes it, and the
 * enforcement at every boundary that consumes it.
 *
 * What is proven here, against durable state and a second process, never from a response body alone:
 *   MOA-01..04   the new registration is durable and PENDING: not open, no fabricated rating, and the
 *                response says so instead of advertising a live store.
 *   MOA-05..08   a pending storefront is invisible to customers — both discovery lists, the detail
 *                read, and every merchants policy that is readable without an auth claim.
 *   MOA-09       a pending storefront cannot take a food order, and the refusal is the approval code,
 *                not the closure code: a pending store is not a "closed" one.
 *   MOA-10       legitimate sign-in is preserved: a pending merchant still gets a session. Being
 *                pending is not a lockout of the owner, it is a limit on what the store can do.
 *   MOA-11..14   the four operational write classes the owner named — catalogue, payment destination,
 *                order acceptance, grocery inventory — are refused, and nothing reaches the store
 *                behind them (asserted from `products`, `merchants.upi_id`, `merchant_grocery_inventory`).
 *   MOA-15       the route-completeness guard: every merchant-authenticated write registration in
 *                `src/server.js` carries the approval gate, re-derived from source at run time. This
 *                is what turns "did we miss an endpoint" from a hope into a measured check.
 *   MOA-16..17   the two alternate doors: the legacy `POST /api/admin/restaurants/:id/status` with
 *                `APPROVED`, and a profile PATCH carrying `isOpen`. Neither may open a pending store.
 *   MOA-18..22   the gate on the decision itself: unauthenticated refused, a role without
 *                `merchant.manage` refused by name, an authorized OPERATIONS approval writes the
 *                durable row and an audit line, and retrying it changes nothing twice.
 *   MOA-23..26   after a real approval the store is genuinely serviceable — discoverable, orderable,
 *                able to publish a dish — and still cannot rewrite its own approval through its profile.
 *   MOA-27..29   tenant isolation holds with the new state (a second approved merchant can neither
 *                read nor write the first one's dish), and the decision survives a process restart.
 *   MOA-30..31   the queue an admin works from: a pending store is in it, and an approved one is out
 *                of it with its listing genuinely customer-enumerable — the precondition for the
 *                rejection check below, so that "it disappeared" can only mean "the rejection did it".
 *   MOA-32..34   the REJECT half of the decision: durable and audited, and a rejected store's
 *                *existing* listing disappears from the grocery catalogue with its checkout refused
 *                before item resolution, leaving no order or checkout row.
 *   MOA-35..36   an id with no row behind it is not reported as approved, and a store that declines
 *                the write is an outage (typed 503, nothing durable), not a success.
 *   MOA-37..38   the fix must not demote an existing merchant or touch anything it did not create:
 *                every pre-existing `merchants` row stays APPROVED, the shared seeded store is
 *                byte-identical to its start-of-run snapshot, and no order or checkout row exists for
 *                the stores this run owns.
 *
 * In the RED run (before the fix) MOA-11..14 genuinely write through — a dish, a UPI destination, an
 * inventory listing — because that IS the defect. The cleanup at the bottom removes exactly the rows
 * this run created, by the handles it used: its merchants and their product/inventory/order/checkout
 * rows, its probe admin accounts together with the `backend_sessions` rows those accounts minted (an
 * admin session carries `phone IS NULL`, so the phone sweep cannot reach it and it has to be found
 * through its own account id), and every session and user keyed on this run's phone numbers. Two
 * residues are deliberate and are reported by the chain census instead of being deleted to look
 * clean: the `audit_logs` rows (append-only by migration 022) and the one `backend_sessions` row
 * minted by signing in as the SHARED seeded `superadmin`, whose only matching handle is that
 * username — deleting it would be writing to a record this run does not own.
 *
 * Local/test only: refuses a non-loopback backend or database. Run via scripts/with_local_target.js.
 */
const fs = require('fs');
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
  console.error('MI-5 REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
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
        resolve({ status: res.statusCode, data: json || {}, raw: String(data) });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, hung: true, data: {}, raw: '' }); });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, data: {}, raw: '' }));
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

/**
 * An OTP bearer for a number this run owns. CUSTOMER sign-in provisions the account; MERCHANT
 * sign-in resolves the registered store and carries its own uuid (database.js:7181-7186).
 * MOA-10 pins that a PENDING merchant can still sign in: pending limits the store, not the person.
 */
async function otpToken(base, rawPhone, role) {
  await request(base, 'POST', '/api/auth/send-otp', { phone: rawPhone, role, purpose: 'LOGIN' });
  const send = await request(base, 'POST', '/api/auth/send-otp', { phone: rawPhone, role, purpose: 'LOGIN' });
  const verify = await request(base, 'POST', '/api/auth/verify-otp', {
    phone: rawPhone, otp: (send.data && send.data.testOtp) || '7729', role, purpose: 'LOGIN'
  });
  return { token: verify.data && verify.data.token, status: verify.status, code: verify.data && verify.data.code };
}

const openGateReachesResolution = (r) => r.status === 400 && r.data.code === 'INVALID_ITEMS';
const reachesCartResolution = (r) => r.status === 400 && r.data.code === 'EMPTY_CART';

/**
 * Every merchant-authenticated WRITE registration in src/server.js, with its middleware chain.
 *
 * Re-derived from source on each run rather than counted once by hand: the owner's instruction was
 * "do not leave alternate endpoints that bypass the approval gate", and a fixed list in a test file
 * goes stale exactly when someone adds the route that bypasses it. The chain is the argument list up
 * to the handler's own `(req, res)`, so a handler body can never satisfy the guard by mentioning the
 * gate's name.
 */
function merchantWriteChains() {
  const src = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const out = [];
  const re = /app\.(post|put|patch|delete)[\s]*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const call = src.slice(re.lastIndex, i - 1);
    const handlerAt = call.search(/\(\s*req\s*,\s*res\s*[,)]/);
    const chain = handlerAt >= 0 ? call.slice(0, handlerAt) : call;
    if (!chain.includes('authenticateMerchant')) continue;
    const firstPath = /['"`]([^'"`]+)['"`]/.exec(call);
    out.push({ verb: m[1].toUpperCase(), path: firstPath ? firstPath[1] : '(?)', chain });
  }
  return out;
}

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('MOA-ALL', 'merchant pending-approval lifecycle', 'needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const all = async (sql, p) => (await c.query(sql, p)).rows;

  // Tolerant by necessity: the approval columns do not exist until migration 048, and a suite that
  // throws on an absent column reports a crash instead of the defect it was written to pin.
  const approvalCols = await all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'merchants'
       AND column_name IN ('approval_status','approval_decided_at','approval_decided_by','approval_reason')`);
  const hasApprovalColumns = approvalCols.length === 4;
  const APPROVAL_SELECT = hasApprovalColumns
    ? ', approval_status, approval_decided_at, approval_decided_by, approval_reason' : '';
  const readMerchant = (id) => one(
    `SELECT id, name, is_open, merchant_type, rating, upi_id${APPROVAL_SELECT}
     FROM merchants WHERE id = $1::uuid`, [id]);

  const STORE = {
    subject: `MOA Pending Kitchen ${SUFFIX}`,
    mart: `MOA Pending Mart ${SUFFIX}`,
    other: `MOA Other Kitchen ${SUFFIX}`,
  };
  const PHONES = {
    subject: `+9190${String(STAMP).slice(-8)}`,
    mart: `+9193${String(STAMP).slice(-8)}`,
    other: `+9192${String(STAMP).slice(-8)}`,
    customer: `+9191${String(STAMP).slice(-8)}`,
  };
  const SEED_MERCHANT = '00000000-0000-0000-0000-000000000201';

  const children = [];
  const ids = { subject: null, mart: null, other: null };
  const ownMerchantIds = () => Object.values(ids).filter(Boolean);
  let dishId = null;
  let probeAdmins = [];

  try {
    const first = await bootBackend();
    children.push(first);
    const BASE = first.base;

    // Snapshotted before anything this run writes, so MOA-38 can compare against what the shared
    // seeded store actually was rather than against a value this suite happens to expect today.
    const seedSnapshot = await one(
      'SELECT id, name, is_open, merchant_type, rating, phone FROM merchants WHERE id = $1::uuid',
      [SEED_MERCHANT]);

    const register = async (name, phone, businessType) => {
      const r = await request(BASE, 'POST', '/api/merchant/register', {
        name, phone, address: `7 MOA Test Road, Aizawl ${SUFFIX}`, businessType, lat: 23.7271, lng: 92.7176
      });
      return { id: r.data && r.data.merchant && r.data.merchant.id, response: r };
    };

    // ---- MOA-01 the precondition: registration mints a durable row ----
    // This check passes before and after the fix on purpose. Everything below is only meaningful
    // because an anonymous POST really does create a row in the store that every consumer reads.
    const regSubject = await register(STORE.subject, PHONES.subject, 'RESTAURANT');
    ids.subject = regSubject.id;
    const rowSubject = ids.subject ? await readMerchant(ids.subject) : null;
    check('MOA-01', 'an anonymous registration mints a durable RESTAURANT merchant row',
      regSubject.response.status === 201 && !!rowSubject && rowSubject.merchant_type === 'RESTAURANT',
      { status: regSubject.response.status, code: regSubject.response.data.code, id: ids.subject });
    if (!ids.subject) throw new Error('no storefront to test with: registration answered ' + regSubject.response.status);

    // ---- MOA-02..04 the new store must be PENDING, closed, and un-rated ----
    check('MOA-02', 'the new storefront is durably PENDING and not open (was: no approval column, is_open true)',
      hasApprovalColumns && rowSubject.approval_status === 'PENDING' && rowSubject.is_open === false,
      { hasApprovalColumns, approval_status: rowSubject.approval_status, is_open: rowSubject.is_open });
    check('MOA-03', 'the registration response reports the pending state instead of a live store',
      regSubject.response.data.merchant
      && regSubject.response.data.merchant.approvalStatus === 'PENDING'
      && regSubject.response.data.merchant.rating === undefined,
      { merchant: regSubject.response.data.merchant });
    check('MOA-04', 'a brand-new store carries no rating instead of a fabricated 4.80',
      !!rowSubject && rowSubject.rating === null, { rating: rowSubject && rowSubject.rating });

    // ---- MOA-05..07 a pending storefront is invisible to customers ----
    const listRestaurants = async (base, qs) => {
      const r = await request(base, 'GET', `/api/restaurants?${qs}`, null);
      return { status: r.status, ids: ((r.data && r.data.restaurants) || []).map(x => String(x.id)) };
    };
    const discoverOpen = await listRestaurants(BASE, `openNow=true&search=${SUFFIX}`);
    check('MOA-05', 'discovery with openNow=true does not list the pending storefront',
      discoverOpen.status === 200 && !discoverOpen.ids.includes(String(ids.subject)), discoverOpen);
    const discoverAll = await listRestaurants(BASE, `search=${SUFFIX}`);
    check('MOA-06', 'discovery without the openNow filter still hides a pending storefront',
      discoverAll.status === 200 && !discoverAll.ids.includes(String(ids.subject)), discoverAll);
    const detail = await request(BASE, 'GET', `/api/restaurants/${ids.subject}`, null);
    check('MOA-07', 'the customer detail read of a pending storefront is a 404, not its menu',
      detail.status === 404, { status: detail.status, code: detail.data.code, name: detail.data.restaurant && detail.data.restaurant.name });

    // ---- MOA-08 the durable-level read control, not just the app filter ----
    // Measured: every policy on `merchants` is created `TO public`, so `pg_policies.roles` reads
    // `{public}` for all three and a filter on `{anon,authenticated}` matches nothing. The roles
    // column therefore cannot separate a customer-readable policy from an owner-scoped one — the
    // predicate can. A policy whose `qual` never mentions `auth.` gates on nothing but the row's own
    // columns, which is exactly the shape an anonymous reader satisfies.
    const pubPolicies = await all(
      `SELECT policyname, cmd, roles::text AS roles, qual FROM pg_policies
       WHERE schemaname = current_schema() AND tablename = 'merchants'
         AND cmd IN ('SELECT', 'ALL')
       ORDER BY policyname`);
    const unscoped = pubPolicies.filter(p => !/auth\.\w+\(/i.test(String(p.qual || '')));
    const unscopedQuals = unscoped.map(p => String(p.qual || ''));
    check('MOA-08', 'every merchant policy readable without an auth claim requires the approved state',
      unscoped.length > 0 && unscopedQuals.every(q => /approval_status/i.test(q)),
      { allPolicies: pubPolicies.map(p => ({ name: p.policyname, cmd: p.cmd, roles: p.roles, qual: p.qual })),
        unscoped: unscoped.map(p => ({ name: p.policyname, qual: p.qual })) });

    // ---- MOA-09 the order gate refuses, and says why ----
    const cust = await otpToken(BASE, PHONES.customer, 'CUSTOMER');
    const custToken = cust.token;
    if (!custToken) throw new Error('no customer bearer: the customer-facing boundaries cannot be probed');
    const bookPending = await request(BASE, 'POST', '/api/customer/book-food', {
      restaurantId: ids.subject, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(custToken));
    check('MOA-09', 'a pending storefront is refused an order with the approval code, before menu resolution',
      bookPending.status === 403 && bookPending.data.code === 'MERCHANT_NOT_APPROVED',
      { status: bookPending.status, code: bookPending.data.code, error: bookPending.data.error });

    // ---- MOA-10 legitimate sign-in is preserved ----
    const subjLogin = await otpToken(BASE, PHONES.subject, 'MERCHANT');
    check('MOA-10', 'a pending merchant can still sign in — pending restricts the store, not its owner',
      subjLogin.status === 200 && !!subjLogin.token,
      { status: subjLogin.status, code: subjLogin.code, hasToken: !!subjLogin.token });

    // ---- MOA-11..14 the four operational write classes ----
    const dishWrite = await request(BASE, 'POST', `/api/merchant/${ids.subject}/dishes`, {
      name: `MOA Pending Dish ${SUFFIX}`, price: 199, category: 'Thali'
    }, bearer(subjLogin.token));
    const dishResidue = await one(
      'SELECT count(*) AS n FROM products WHERE merchant_id = $1::uuid', [ids.subject]);
    check('MOA-11', 'a pending merchant cannot publish a dish, and nothing reaches the products table',
      dishWrite.status === 403 && dishWrite.data.code === 'MERCHANT_NOT_APPROVED'
        && Number(dishResidue.n) === 0,
      { write: { status: dishWrite.status, code: dishWrite.data.code }, products: dishResidue.n });

    const upiBefore = await readMerchant(ids.subject);
    const paymentWrite = await request(BASE, 'PUT', `/api/merchant/${ids.subject}/rms/settings/payments`, {
      upiId: `moa.probe.${SUFFIX}@ybl`, upiMerchantName: STORE.subject
    }, bearer(subjLogin.token));
    const upiAfter = await readMerchant(ids.subject);
    check('MOA-12', 'a pending merchant cannot set its own payment destination, and upi_id is unchanged',
      paymentWrite.status === 403 && paymentWrite.data.code === 'MERCHANT_NOT_APPROVED'
        && String(upiAfter.upi_id) === String(upiBefore.upi_id),
      { write: { status: paymentWrite.status, code: paymentWrite.data.code },
        upi_before: upiBefore.upi_id, upi_after: upiAfter.upi_id });

    // An order id that exists for nobody: the 404 inside the handler is reached only when the gate
    // let the call through, so the code here distinguishes "gated" from "not gated".
    const orderWrite = await request(BASE, 'POST', `/api/merchant/${ids.subject}/orders/${crypto.randomUUID()}/status`,
      { status: 'ACCEPTED' }, bearer(subjLogin.token));
    check('MOA-13', 'a pending merchant cannot accept an order — refused at the gate, not inside the handler',
      orderWrite.status === 403 && orderWrite.data.code === 'MERCHANT_NOT_APPROVED',
      { status: orderWrite.status, code: orderWrite.data.code, error: orderWrite.data.error });

    const regMart = await register(STORE.mart, PHONES.mart, 'GROCERY');
    ids.mart = regMart.id;
    if (!ids.mart) throw new Error('no grocery storefront: the inventory boundary cannot be probed');
    const martLogin = await otpToken(BASE, PHONES.mart, 'MERCHANT');
    const activeMaster = await one(
      'SELECT id, name FROM master_grocery_catalog WHERE is_active = true ORDER BY id LIMIT 1');
    if (!activeMaster) throw new Error('no active master grocery product: the listing probe cannot be built');
    const inventoryWrite = await request(BASE, 'POST', '/api/merchant/inventory', {
      masterProductId: activeMaster.id, currentPrice: 49, stockQty: 10, isAvailable: true
    }, bearer(martLogin.token));
    const listingResidue = await one(
      'SELECT count(*) AS n FROM merchant_grocery_inventory WHERE merchant_id = $1::uuid', [ids.mart]);
    check('MOA-14', 'a pending merchant cannot stock its shelf, and no listing row is written',
      inventoryWrite.status === 403 && inventoryWrite.data.code === 'MERCHANT_NOT_APPROVED'
        && Number(listingResidue.n) === 0,
      { write: { status: inventoryWrite.status, code: inventoryWrite.data.code }, rows: listingResidue.n });

    // ---- MOA-15 the completeness guard ----
    const writes = merchantWriteChains();
    const ungated = writes.filter(w => !w.chain.includes('requireMerchantApproved'))
      .map(w => `${w.verb} ${w.path}`);
    // The floor is a scanner sanity check — it proves the source parse found the merchant writes at
    // all, so `ungated.length === 0` can never be satisfied by a regex that matched nothing. It is
    // deliberately not the measured count (41 at the time this was written), which moves with every
    // unrelated route addition and would turn this guard into a stale-number pin.
    check('MOA-15', 'every merchant-authenticated write route carries the approval gate',
      writes.length >= 30 && ungated.length === 0,
      { merchantWrites: writes.length, ungatedCount: ungated.length, ungated: ungated.slice(0, 8) });

    // ---- MOA-16..17 the alternate doors ----
    const adminLogin = await request(BASE, 'POST', '/api/admin/login', SUPER);
    const superToken = adminLogin.data && adminLogin.data.token;
    if (!superToken) throw new Error('SUPER_ADMIN login refused: ' + JSON.stringify(adminLogin.data).slice(0, 160));
    const legacyOpen = await request(BASE, 'POST', `/api/admin/restaurants/${ids.subject}/status`,
      { status: 'APPROVED', reason: `MOA harness legacy door ${SUFFIX}` }, bearer(superToken));
    const rowAfterLegacy = await readMerchant(ids.subject);
    const bookAfterLegacy = await request(BASE, 'POST', '/api/customer/book-food', {
      restaurantId: ids.subject, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(custToken));
    check('MOA-16', 'the legacy status route cannot turn a PENDING storefront into a tradeable one',
      hasApprovalColumns && rowAfterLegacy.approval_status === 'PENDING' && rowAfterLegacy.is_open === false
        && bookAfterLegacy.data.code === 'MERCHANT_NOT_APPROVED',
      { legacy: { status: legacyOpen.status, code: legacyOpen.data.code, success: legacyOpen.data.success },
        is_open: rowAfterLegacy.is_open, approval_status: rowAfterLegacy.approval_status,
        order: { status: bookAfterLegacy.status, code: bookAfterLegacy.data.code } });

    const profileOpen = await request(BASE, 'PATCH', `/api/merchant/${ids.subject}/profile`,
      { isOpen: true, is_open: true }, bearer(subjLogin.token));
    const rowAfterProfile = await readMerchant(ids.subject);
    check('MOA-17', 'a profile PATCH cannot open a pending store and bypass the approval gate',
      profileOpen.status >= 400 && rowAfterProfile.is_open === false,
      { patch: { status: profileOpen.status, code: profileOpen.data.code }, is_open: rowAfterProfile.is_open });

    // ---- MOA-18..22 the decision itself ----
    const APPROVAL_URL = `/api/admin/merchants/${ids.subject}/approval`;
    const anonApprove = await request(BASE, 'POST', APPROVAL_URL, { decision: 'APPROVE', reason: 'unauthenticated attempt' });
    check('MOA-18', 'an unauthenticated approval attempt is refused',
      anonApprove.status === 401,
      { status: anonApprove.status, code: anonApprove.data.code, error: anonApprove.data.error });

    // A role that genuinely lacks `merchant.manage` (adminPermissions.js: FINANCE_AUDITOR has finance
    // and audit grants only) — a real deny probe, not a made-up permission name.
    const sweep = await request(BASE, 'GET', '/api/admin/accounts', null, bearer(superToken));
    const isEnabled = (a) => String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
    for (const a of (sweep.data.accounts || []).filter(x => /^moa_/.test(String(x.username || '')) && isEnabled(x))) {
      await request(BASE, 'POST', `/api/admin/accounts/${a.id}/status`,
        { isActive: false, reason: 'MOA harness: sweeping an aborted run' }, bearer(superToken));
    }
    probeAdmins = [];
    const provisioned = [];
    for (const role of ['OPERATIONS', 'FINANCE_AUDITOR']) {
      const username = `moa_${role.toLowerCase().slice(0, 6)}_${SUFFIX}`;
      const password = crypto.randomBytes(18).toString('base64url');
      const created = await request(BASE, 'POST', '/api/admin/accounts', {
        username, name: `MOA ${role} probe`, email: `${username}@nabin.in`, role, password
      }, bearer(superToken));
      const login = created.status === 200
        ? await request(BASE, 'POST', '/api/admin/login', { username, password })
        : { status: created.status, data: {} };
      const token = login.data && login.data.token;
      if (token) provisioned.push({ role, username, token, accountId: created.data.account && created.data.account.id });
      else throw new Error(`no ${role} probe token (provision=${created.status} login=${login.status})`);
    }
    probeAdmins = provisioned;
    const opsToken = provisioned.find(p => p.role === 'OPERATIONS').token;
    const auditorToken = provisioned.find(p => p.role === 'FINANCE_AUDITOR').token;

    const auditorApprove = await request(BASE, 'POST', APPROVAL_URL,
      { decision: 'APPROVE', reason: `MOA harness deny probe ${SUFFIX}` }, bearer(auditorToken));
    check('MOA-19', 'a FINANCE_AUDITOR, which holds no merchant grant, is denied by name',
      auditorApprove.status === 403 && /merchant\.manage/.test(auditorApprove.raw || ''),
      { status: auditorApprove.status, code: auditorApprove.data.code, error: auditorApprove.data.error });

    const approve = await request(BASE, 'POST', APPROVAL_URL,
      { decision: 'APPROVE', reason: `MOA harness approval ${SUFFIX}` }, bearer(opsToken));
    const rowApproved = await readMerchant(ids.subject);
    check('MOA-20', 'an authorized OPERATIONS approval persists: durable APPROVED, open, decided by that admin',
      approve.status === 200 && approve.data.success === true
        && rowApproved.approval_status === 'APPROVED' && rowApproved.is_open === true
        && !!rowApproved.approval_decided_by && !!rowApproved.approval_decided_at,
      { answer: { status: approve.status, code: approve.data.code, dataSource: approve.data.dataSource },
        row: { approval_status: rowApproved.approval_status, is_open: rowApproved.is_open,
          decided_by: rowApproved.approval_decided_by, decided_at: rowApproved.approval_decided_at && String(rowApproved.approval_decided_at) } });

    const approvalTrail = await one(
      `SELECT id, action, admin_id, target_entity_id, previous_state, new_state, reason
       FROM audit_logs WHERE target_entity_id = $1 AND action = 'MERCHANT_APPROVED'
       ORDER BY created_at DESC LIMIT 1`, [ids.subject]);
    check('MOA-21', 'the approval is recorded in the durable audit trail against the merchant uuid',
      !!approvalTrail && approvalTrail.new_state === 'APPROVED'
        && String(approvalTrail.reason || '').includes(SUFFIX),
      { trail: approvalTrail && { action: approvalTrail.action, admin_id: approvalTrail.admin_id,
        previous_state: approvalTrail.previous_state, new_state: approvalTrail.new_state } });

    const retry = await request(BASE, 'POST', APPROVAL_URL,
      { decision: 'APPROVE', reason: `MOA harness approval retry ${SUFFIX}` }, bearer(opsToken));
    const rowRetry = await readMerchant(ids.subject);
    const trailCount = await one(
      `SELECT count(*) AS n FROM audit_logs WHERE target_entity_id = $1 AND action = 'MERCHANT_APPROVED'`,
      [ids.subject]);
    check('MOA-22', 'retrying the same approval is idempotent: one decision, one audit line',
      retry.status === 200 && Number(trailCount.n) === 1
        && String(rowRetry.approval_decided_at) === String(rowApproved.approval_decided_at),
      { retry: { status: retry.status, code: retry.data.code }, audit_rows: trailCount.n,
        decided_at_before: String(rowApproved.approval_decided_at), decided_at_after: String(rowRetry.approval_decided_at) });

    // ---- MOA-23..26 an approved store is genuinely serviceable ----
    const discoverApproved = await listRestaurants(BASE, `openNow=true&search=${SUFFIX}`);
    const detailApproved = await request(BASE, 'GET', `/api/restaurants/${ids.subject}`, null);
    check('MOA-23', 'the approved storefront appears in customer discovery and its detail opens',
      discoverApproved.ids.includes(String(ids.subject)) && detailApproved.status === 200,
      { listed: discoverApproved.ids.includes(String(ids.subject)), detail: detailApproved.status });

    const bookApproved = await request(BASE, 'POST', '/api/customer/book-food', {
      restaurantId: ids.subject, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(custToken));
    check('MOA-24', 'the order gate lets an approved storefront reach menu resolution instead of refusing it',
      openGateReachesResolution(bookApproved),
      { status: bookApproved.status, code: bookApproved.data.code, error: bookApproved.data.error });

    const dishCreate = await request(BASE, 'POST', `/api/merchant/${ids.subject}/dishes`, {
      name: `MOA Approved Dish ${SUFFIX}`, price: 249, category: 'Thali'
    }, bearer(subjLogin.token));
    dishId = dishCreate.data && dishCreate.data.dish && dishCreate.data.dish.id;
    const dishRow = dishId ? await one('SELECT id, price, merchant_id FROM products WHERE id = $1::uuid', [dishId]) : null;
    check('MOA-25', 'an approved merchant can publish a dish and the row is durable',
      dishCreate.status === 201 && !!dishRow && Number(dishRow.price) === 249
        && String(dishRow.merchant_id) === String(ids.subject),
      { status: dishCreate.status, code: dishCreate.data.code, dishId, row: dishRow });

    const selfApprove = await request(BASE, 'PATCH', `/api/merchant/${ids.subject}/profile`,
      { approval_status: 'REJECTED', approvalStatus: 'REJECTED', isOpen: true }, bearer(subjLogin.token));
    const rowAfterSelf = await readMerchant(ids.subject);
    check('MOA-26', 'an approved merchant still cannot rewrite its own approval through its profile',
      selfApprove.status === 400 && selfApprove.data.code === 'SELF_APPROVAL_NOT_PERMITTED'
        && rowAfterSelf.approval_status === 'APPROVED',
      { patch: { status: selfApprove.status, code: selfApprove.data.code },
        approval_status: rowAfterSelf.approval_status });

    // ---- MOA-27..29 tenant isolation and durability across processes ----
    const regOther = await register(STORE.other, PHONES.other, 'RESTAURANT');
    ids.other = regOther.id;
    if (!ids.other) throw new Error('no second storefront: the cross-tenant probes cannot run');
    await request(BASE, 'POST', `/api/admin/merchants/${ids.other}/approval`,
      { decision: 'APPROVE', reason: `MOA harness second store ${SUFFIX}` }, bearer(opsToken));
    const otherLogin = await otpToken(BASE, PHONES.other, 'MERCHANT');

    const crossWrite = await request(BASE, 'PUT', `/api/merchant/${ids.subject}/dishes/${dishId}`,
      { name: `MOA Hijacked ${SUFFIX}`, price: 1, category: 'Thali' }, bearer(otherLogin.token));
    const rowDishAfterCross = dishId ? await one('SELECT price, name FROM products WHERE id = $1::uuid', [dishId]) : null;
    check('MOA-27', 'a second approved merchant cannot rewrite the first one\'s dish, and the row is unchanged',
      crossWrite.status === 403 && !!rowDishAfterCross && Number(rowDishAfterCross.price) === 249,
      { status: crossWrite.status, code: crossWrite.data.code, dish: rowDishAfterCross });

    const crossRead = await request(BASE, 'GET', `/api/merchant/${ids.subject}/dishes/${dishId}`, null, bearer(otherLogin.token));
    check('MOA-28', 'a second merchant cannot read the first one\'s dish either',
      crossRead.status === 403, { status: crossRead.status, code: crossRead.data.code });

    const second = await bootBackend();
    children.push(second);
    const cust2 = await otpToken(second.base, PHONES.customer, 'CUSTOMER');
    const bookFromSecond = await request(second.base, 'POST', '/api/customer/book-food', {
      restaurantId: ids.subject, items: [], orderChannel: 'TAKEAWAY'
    }, bearer(cust2.token));
    const discoverSecond = await listRestaurants(second.base, `openNow=true&search=${SUFFIX}`);
    check('MOA-29', 'a freshly spawned backend gives the same answer — the decision lives in the store',
      openGateReachesResolution(bookFromSecond) && discoverSecond.ids.includes(String(ids.subject)),
      { order: { status: bookFromSecond.status, code: bookFromSecond.data.code },
        listed: discoverSecond.ids.includes(String(ids.subject)) });

    // ---- MOA-30..31 the queue an admin works from ----
    const queueBefore = await request(BASE, 'GET', '/api/admin/merchants/pending', null, bearer(opsToken));
    const queueIds = ((queueBefore.data && queueBefore.data.merchants) || []).map(m => String(m.id));
    check('MOA-30', 'the admin pending queue answers and contains the still-pending mart',
      queueBefore.status === 200 && queueIds.includes(String(ids.mart)),
      { status: queueBefore.status, code: queueBefore.data.code, listed: queueIds.includes(String(ids.mart)) });

    await request(BASE, 'POST', `/api/admin/merchants/${ids.mart}/approval`,
      { decision: 'APPROVE', reason: `MOA harness mart approval ${SUFFIX}` }, bearer(opsToken));
    const queueAfter = await request(BASE, 'GET', '/api/admin/merchants/pending', null, bearer(opsToken));
    const queueAfterIds = ((queueAfter.data && queueAfter.data.merchants) || []).map(m => String(m.id));
    const martLoginAfter = await otpToken(BASE, PHONES.mart, 'MERCHANT');
    const listing = await request(BASE, 'POST', '/api/merchant/inventory', {
      masterProductId: activeMaster.id, currentPrice: 49, stockQty: 10, isAvailable: true
    }, bearer(martLoginAfter.token));
    const productsForMart = async (base) => {
      const r = await request(base, 'GET', `/api/grocery/products?merchantId=${ids.mart}`, null);
      const items = (r.data && r.data.products) || [];
      return { status: r.status, count: items.length, mine: items.filter(p => String(p.merchantId) === String(ids.mart)).length };
    };
    const visibleWhileApproved = await productsForMart(BASE);
    // Pure precondition witness: MOA-33 requires this listing to vanish, and "it vanished" only means
    // something if it was actually enumerable a moment before. The queue half reads vacuously in the
    // RED run (that route does not exist yet, so the list is empty); it is the listing half that
    // carries the precondition, and it is expected to pass both before and after the fix.
    check('MOA-31', 'the approved mart has left the queue and its real listing is customer-enumerable',
      !queueAfterIds.includes(String(ids.mart)) && listing.status === 200
        && visibleWhileApproved.mine >= 1,
      { stillQueued: queueAfterIds.includes(String(ids.mart)),
        listing: { status: listing.status, code: listing.data.code }, browse: visibleWhileApproved });

    const reject = await request(BASE, 'POST', `/api/admin/merchants/${ids.mart}/approval`,
      { decision: 'REJECT', reason: `MOA harness rejection ${SUFFIX}` }, bearer(opsToken));
    const rowMart = await readMerchant(ids.mart);
    const rejectTrail = await one(
      `SELECT id, new_state, reason FROM audit_logs WHERE target_entity_id = $1 AND action = 'MERCHANT_REJECTED'
       ORDER BY created_at DESC LIMIT 1`, [ids.mart]);
    check('MOA-32', 'the rejection is durable: REJECTED, closed, and audited',
      reject.status === 200 && rowMart.approval_status === 'REJECTED' && rowMart.is_open === false
        && !!rejectTrail && String(rejectTrail.reason || '').includes(SUFFIX),
      { status: reject.status, code: reject.data.code,
        row: { approval_status: rowMart.approval_status, is_open: rowMart.is_open },
        trail: rejectTrail && { new_state: rejectTrail.new_state } });

    const hiddenAfterReject = await productsForMart(BASE);
    const groceryCheckout = await request(BASE, 'POST', '/api/grocery/checkout/validate',
      { merchantId: ids.mart, cartItems: [] }, bearer(custToken));
    check('MOA-33', 'a rejected store\'s existing listing disappears from the catalogue and its checkout is refused',
      hiddenAfterReject.mine === 0
        && groceryCheckout.status === 403 && groceryCheckout.data.code === 'MERCHANT_NOT_APPROVED',
      { browse: hiddenAfterReject, checkout: { status: groceryCheckout.status, code: groceryCheckout.data.code } });

    const checkoutWithCart = await request(BASE, 'POST', '/api/grocery/checkout/validate',
      { merchantId: ids.mart, cartItems: [{ productId: activeMaster.id, quantity: 1, requestedQtyKg: 1 }] },
      bearer(custToken));
    const martResidue = await one(
      `SELECT (SELECT count(*) FROM orders WHERE merchant_id = $1::uuid) AS orders,
              (SELECT count(*) FROM checkouts WHERE merchant_id = $1::uuid) AS checkouts`, [ids.mart]);
    check('MOA-34', 'the grocery refusal precedes item resolution and leaves no order or checkout row',
      checkoutWithCart.status === 403 && checkoutWithCart.data.code === 'MERCHANT_NOT_APPROVED'
        && Number(martResidue.orders) === 0 && Number(martResidue.checkouts) === 0,
      { refusal: { status: checkoutWithCart.status, code: checkoutWithCart.data.code }, residue: martResidue });

    // ---- MOA-35..36 refusal paths that must not become successes ----
    const ghost = crypto.randomUUID();
    const ghostApprove = await request(BASE, 'POST', `/api/admin/merchants/${ghost}/approval`,
      { decision: 'APPROVE', reason: `MOA harness ghost ${SUFFIX}` }, bearer(opsToken));
    const ghostTrail = await one(
      `SELECT id FROM audit_logs WHERE target_entity_id = $1 AND action IN ('MERCHANT_APPROVED','MERCHANT_REJECTED') LIMIT 1`,
      [ghost]);
    check('MOA-35', 'an id with no merchant row behind it is not reported as approved, and leaves no trail',
      ghostApprove.status !== 200 && ghostApprove.data.success !== true && !ghostTrail,
      { status: ghostApprove.status, code: ghostApprove.data.code, success: ghostApprove.data.success, trail: !!ghostTrail });

    // The seam every authority write in database.js goes through, so stubbing it is the store
    // declining the same code path rather than a different one (the MSD-13 precedent).
    const approvalMethod = typeof db.setMerchantApproval === 'function' ? 'setMerchantApproval' : null;
    const pendingBeforeOutage = await readMerchant(ids.other);
    const auditBeforeOutage = await one(
      `SELECT count(*) AS n FROM audit_logs WHERE target_entity_id = $1`, [ids.other]);
    let outage = null;
    const orig = db.settleAuthoritative;
    try {
      db.settleAuthoritative = async () => ({
        data: null, error: { message: 'MOA harness: simulated store refusal', code: 'PGRST1' }
      });
      // Positional, the way `setRestaurantStatus` is called: the decision, the reason, and the acting
      // admin — so this probe drives the real signature rather than an object the method ignores.
      outage = !approvalMethod
        ? { missing: true }
        : await db.setMerchantApproval(ids.other, 'REJECT', `MOA harness outage ${SUFFIX}`, 'admin-moa', 'MOA Admin')
          .then((r) => ({ threw: false, result: r }),
            (err) => ({ threw: true, code: err.code, status: err.status || err.statusCode, message: err.message }));
    } finally {
      db.settleAuthoritative = orig;
    }
    const rowAfterOutage = await readMerchant(ids.other);
    const auditAfterOutage = await one(
      `SELECT count(*) AS n FROM audit_logs WHERE target_entity_id = $1`, [ids.other]);
    check('MOA-36', 'a store that declines the approval decision is an outage: typed 503, nothing durable, no audit line',
      !!approvalMethod && outage && outage.threw === true && outage.status === 503 && !!outage.code
        && Number(auditAfterOutage.n) === Number(auditBeforeOutage.n)
        && String(rowAfterOutage.approval_status) === String(pendingBeforeOutage.approval_status)
        && rowAfterOutage.is_open === pendingBeforeOutage.is_open,
      { approvalMethod, outage,
        row: { before: { status: pendingBeforeOutage.approval_status, is_open: pendingBeforeOutage.is_open },
          after: { status: rowAfterOutage.approval_status, is_open: rowAfterOutage.is_open } },
        audit: { before: auditBeforeOutage.n, after: auditAfterOutage.n } });

    // ---- MOA-37..38 the blast radius of the fix, measured ----
    // The predicate only exists once migration 048 does: querying `approval_status` against the
    // pre-migration store aborts the run at the very check that is supposed to report it.
    const demoted = hasApprovalColumns ? await one(
      `SELECT count(*) AS n FROM merchants
       WHERE id <> ALL($1::uuid[]) AND approval_status IS DISTINCT FROM 'APPROVED'`,
      [ownMerchantIds()]) : null;
    check('MOA-37', 'no pre-existing merchant was demoted into pending by the change',
      hasApprovalColumns && Number(demoted.n) === 0,
      { columnPresent: hasApprovalColumns, notApproved: demoted && demoted.n });

    const seedNow = await one(
      'SELECT id, name, is_open, merchant_type, rating, phone FROM merchants WHERE id = $1::uuid', [SEED_MERCHANT]);
    const ownResidue = await one(
      `SELECT (SELECT count(*) FROM orders WHERE merchant_id = ANY($1::uuid[])) AS orders,
              (SELECT count(*) FROM checkouts WHERE merchant_id = ANY($1::uuid[])) AS checkouts,
              (SELECT count(*) FROM products WHERE merchant_id = ANY($1::uuid[])) AS products`,
      [ownMerchantIds()]);
    // Compared against this run's own opening snapshot, not against a hardcoded "should be open":
    // what matters is that nothing this suite did moved the shared seeded store.
    const seedDiff = seedSnapshot && seedNow
      ? Object.keys(seedNow).filter(k => String(seedNow[k]) !== String(seedSnapshot[k])) : null;
    check('MOA-38', 'the run touched nothing it did not create: the seeded store is unchanged and its own stores took no order',
      !!seedSnapshot && !!seedNow && seedDiff.length === 0
        && Number(ownResidue.orders) === 0 && Number(ownResidue.checkouts) === 0,
      { seed_columns_moved: seedDiff, own: ownResidue });
  } finally {
    // Exactly the rows this run made, by the handles it used. `audit_logs` is append-only (migration
    // 022): its rows and the seeded-superadmin sign-in sessions stay, and the census reports them.
    //
    // Dependency order is measured, not guessed: `order_lines` RESTRICTs deletes on both
    // `merchant_grocery_inventory` and `products`, and cascades from `orders`. So an order this run
    // minted (the RED run's grocery checkout) has to go before the listing that line points at, or the
    // whole cleanup deadlocks on the constraint and leaves residue behind. In the GREEN run there is no
    // such order — MOA-34 asserts that — so these statements are no-ops there by construction.
    const own = ownMerchantIds();
    if (own.length) {
      const ordersOfOwnStores = await all(
        'SELECT id FROM orders WHERE merchant_id = ANY($1::uuid[])', [own]);
      for (const o of ordersOfOwnStores) {
        try { await c.query('DELETE FROM order_lines WHERE order_id = $1::uuid', [o.id]); } catch (e) { console.log('  order_lines cleanup note: ' + e.message); }
      }
      try { await c.query('DELETE FROM orders WHERE merchant_id = ANY($1::uuid[])', [own]); } catch (e) { console.log('  orders cleanup note: ' + e.message); }
      try { await c.query('DELETE FROM checkouts WHERE merchant_id = ANY($1::uuid[])', [own]); } catch (e) { console.log('  checkouts cleanup note: ' + e.message); }
    }
    for (const id of own) {
      try { await c.query('DELETE FROM merchant_grocery_inventory WHERE merchant_id = $1::uuid', [id]); } catch (e) { console.log('  inventory cleanup note: ' + e.message); }
      try { await c.query('DELETE FROM products WHERE merchant_id = $1::uuid', [id]); } catch (e) { console.log('  products cleanup note: ' + e.message); }
    }
    for (const a of probeAdmins) {
      if (!a.accountId) continue;
      // The account is the handle, so its sign-in sessions are found through it: an admin session
      // carries `phone IS NULL` and `entity_id` = the admin account uuid, so the phone sweep below
      // cannot reach it and they would otherwise accumulate two per run. `entity_id` is TEXT not uuid,
      // and it is the only precision needed — this uuid was minted by this run minutes ago, so no
      // other record can own it. The role column is NOT usable as the filter: admin sessions store
      // their actual role name (`OPERATIONS`, `FINANCE_AUDITOR`), measured, not a shared `ADMIN`.
      try { await c.query('DELETE FROM backend_sessions WHERE entity_id = $1 AND phone IS NULL', [a.accountId]); } catch (e) { console.log('  admin session cleanup note: ' + e.message); }
      try { await c.query('DELETE FROM admin_accounts WHERE id = $1::uuid', [a.accountId]); } catch (e) { console.log('  admin cleanup note: ' + e.message); }
    }
    for (const id of ownMerchantIds()) {
      try { await c.query('DELETE FROM merchants WHERE id = $1::uuid', [id]); } catch (e) { console.log('  merchant cleanup note: ' + e.message); }
    }
    for (const p of Object.values(PHONES)) {
      try { await c.query('DELETE FROM backend_sessions WHERE phone = $1', [p]); } catch (e) { console.log('  session cleanup note: ' + e.message); }
      try { await c.query('DELETE FROM users WHERE phone = $1', [p]); } catch (e) { console.log('  user cleanup note: ' + e.message); }
    }
    for (const k of children) { try { k.child.kill(); } catch (e) {} }
    await c.end();
  }
  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; finish(); });

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== MI-5 MERCHANT PENDING-APPROVAL LIFECYCLE: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  // A crash has already put exitCode at 1; an all-passed-then-crashed run must not reset it to 0.
  if (failed.length) process.exitCode = 1;
  else process.exitCode = process.exitCode || 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
