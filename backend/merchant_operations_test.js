/**
 * Merchant tenant isolation, IDOR, authorization and order-transition concurrency.
 *
 * Everything here is proven with real HTTP against a running backend and real rows read
 * back from PostgreSQL afterwards, because the merchant surface is the one production-facing
 * area in this repository with no isolation coverage at all: across every suite exactly one
 * dormant file ever logs in as MERCHANT, and nothing anywhere asserts that one store cannot
 * read or move another store's orders. Reading `authenticateMerchant` and
 * `requireMerchantTenant` and concluding they look correct is not evidence — two guards in
 * this file (`menu toggle` and the grocery product photo route) read correctly in that shape
 * and are bypassable anyway.
 *
 * The identities are rows THIS FILE creates and deletes, through the shared isolated-fixture
 * helper, rather than seeded rows it hopes nobody else restyled:
 *   A  minted HYBRID_BOTH  (both services, plus its own dish and its own stocked shelf)
 *   B  minted RESTAURANT   (the cross-tenant pair and the attacker)
 *   GG minted GROCERY      (the instamart-only entitlement context)
 *   plus one minted customer and one dish per restaurant-capable tenant.
 *
 * They used to be three hard-coded phones resolved to whichever seeded merchant rows owned them,
 * which made this suite's verdict depend on state it did not own: the entitlement group asserts
 * `merchants.merchant_type` values, and the inventory group writes a grocery shelf, so one
 * restyled seed row or one overlapping suite turned a green run red on a fixture. `rest_1` and its
 * menu item `m1` are still named where a check is *about* the legacy in-memory store's ownership
 * guard (MCS-01, MCMD-04/05); those checks only ever attempt a refusal, and the in-memory seed is
 * reproduced by `database.js` on every boot, so nothing here mutates a shared row.
 *
 * Order of attack matters for honesty: cross-tenant attempts target the OTHER tenant's rows and
 * must leave them bit-identical, and the only orders this file mutates are ones it creates for
 * itself — which is why it also *creates* the orders it reads and attacks (see MCA-FX) rather
 * than relying on whatever a previous run left in the store. Client-controlled identifiers are
 * manipulated in path, body and query on every group, because "the route uses req.merchant.id"
 * is only true until a caller supplies the other one too.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { withSharedSession } = require('./testSessionCache');
const { openFixtures } = require('./test_fixtures');
const targetGuard = require('./scripts/chain_target_guard');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
// The store this suite mints its merchants, dishes, shelf rows and orders INTO. Until 2026-10-16
// this line was `process.env.NABIN_PG_NOTIFY || 'postgres://<user>:<password>@127.0.0.1:54322/...'`,
// so a run with nothing configured passed a fallback address to `openFixtures()` as an explicit
// option — ahead of the handle's own guard — and created and deleted real rows in a store no
// configuration named. That is the #283 split target one level down, and it is why the address is
// gone: the target now resolves through `scripts/chain_target_guard.js`, the same mechanism
// `test_fixtures.js` and the census use (shell first, because dotenv fills only keys the shell left
// undefined, then `backend/.env`), and an absent, unparsable, non-loopback or production-ref target
// is a refusal thrown at load, before any socket opens. `DATABASE_URL` leads `NABIN_PG_NOTIFY`
// because that is the key `scripts/chain_scratch.js link-env` redirects for an isolated link.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'merchant_operations_test' });
const PG = PG_TARGET.connectionString;

// Populated by `main()` from the rows this suite mints. In a spawned child (group 8) the same
// identities arrive through the environment, because the child has to name the stores the parent
// created — it cannot mint its own without changing what is being asserted.
const A = { phone: process.env.NABIN_MCH_A_PHONE || null, uuid: process.env.NABIN_MCH_A_ID || null, name: 'fixture hybrid store', type: 'HYBRID_BOTH' };
const B = { phone: process.env.NABIN_MCH_B_PHONE || null, uuid: process.env.NABIN_MCH_B_ID || null, name: 'fixture restaurant store', type: 'RESTAURANT' };
const GG = { phone: process.env.NABIN_MCH_G_PHONE || null, uuid: process.env.NABIN_MCH_G_ID || null, name: 'fixture instamart store', type: 'GROCERY' };
let CUSTOMER_PHONE = process.env.NABIN_MCH_C_PHONE || null; // the minted buyer
const REST_LEGACY = 'rest_1';              // legacy in-memory restaurant id
const DAY = Date.now();

let fx = null;          // the open fixture handle, when main() got as far as minting
let aDish = null;       // A's own orderable dish
let fixtureShelf = null; // A's own master-catalogue item, stocked on A's own shelf

const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
function skip(name, reason) { skipped.push(name); console.log(`[SKIP] ${name} -> ${reason}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mintSession(phone, role, attempts = 2) {
  // OTP dispatch is capped at 5 sends per phone per 10 minutes inside one server process, so
  // the chain must not spend that budget re-authenticating identities it already has a live
  // session for. Retry only for a transient failure; a rate-limit refusal is returned as-is.
  let last = null;
  for (let i = 0; i < attempts; i++) {
    const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
    if (send.data && send.data.success === true) {
      const verify = await request('POST', '/api/auth/verify-otp', {
        phone, otp: (send.data && send.data.testOtp) || '7729', role, purpose: 'LOGIN',
      });
      if (verify.data && verify.data.token) {
        return { token: verify.data.token, user: verify.data.user, failure: null };
      }
      last = { stage: 'verify', status: verify.status, body: verify.data };
    } else {
      last = { stage: 'send', status: send.status, body: send.data };
      if (send.data && send.data.code === 'OTP_DISPATCH_FAILED') break;
      await sleep(1500 * (i + 1));
    }
  }
  return { token: null, user: null, failure: last };
}

/**
 * A session for this identity, reused from the local harness cache when it is still valid.
 *
 * The reuse never substitutes for authentication: the cached token is presented to
 * `GET /api/auth/me` and only accepted if the server itself says "this is still a live
 * session and its role is the one asked for". Every role/tenant assertion in this file runs
 * against whatever token comes back, so if the server does not honour the session the tests
 * fail rather than quietly pass.
 */
async function login(phone, role) {
  // The mint's own failure is captured rather than re-minted. The previous version called
  // `mintSession` a second time just to build the `failure` field, which spent another OTP
  // dispatch at the exact moment the budget was already exhausted — the harness was making
  // the throttling it then reported worse.
  let mintFailure = null;
  const { token } = await withSharedSession({
    baseUrl: BASE_URL,
    phone,
    role,
    mint: async () => {
      const result = await mintSession(phone, role);
      mintFailure = result.failure;
      return result.token;
    },
    probe: async (candidate) => {
      const me = await request('GET', '/api/auth/me', null, tok(candidate));
      return me.status === 200 && me.data && me.data.success === true && me.data.user
        && String(me.data.role || (me.data.user && me.data.user.role) || '').toUpperCase() === role;
    },
  });
  if (!token) return { token: null, user: null, failure: mintFailure };
  const me = await request('GET', '/api/auth/me', null, tok(token));
  return { token, user: (me.data && me.data.user) || null, failure: null };
}

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {}, raw: data }); }
        catch (e) { resolve({ status: res.statusCode, data: {}, raw: data }); }
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: {}, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

const tok = (t) => ({ Authorization: `Bearer ${t}` });
const uniq = (p) => `${p}_${DAY}_${crypto.randomBytes(4).toString('hex')}`;

/** Read the columns of an order straight from PostgreSQL — the state the API cannot dress up. */
async function orderRow(store, id) {
  const { data, error } = await store.from('orders')
    .select('id,merchant_id,order_state,total_amount,updated_at')
    .eq('id', id).maybeSingle();
  return { row: data, error: error && error.message };
}

async function productRow(store, id) {
  const { data, error } = await store.from('products')
    .select('id,merchant_id,name,price,is_available,updated_at')
    .eq('id', id).maybeSingle();
  return { row: data, error: error && error.message };
}

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * One order for one tenant, created here through the customer checkout route.
 * Groups 2 and 3 need a live order owned by each tenant. They used to get one by discovering
 * whatever earlier runs had left in the store, which made the file measure its own residue: on
 * a database cleared of transactional rows B owned nothing, MCA-09 reported "B cannot read its
 * own orders" when the finding was "B has no orders", and the empty list then crashed the IDOR
 * group at `victim.id`. The line also promises that "the only orders this file mutates are ones
 * it creates for itself", so minting them here is what the file already claimed to do.
 *
 * The item comes from the tenant's own catalogue, so no product is invented.
 */
async function mintOrderFor(tenant, merchantToken, customerToken) {
  if (!customerToken) return { ok: false, why: 'no customer session to check out with' };
  const cat = await request('GET', '/api/merchant/catalog', null, tok(merchantToken));
  const prods = (cat.data || {}).products || [];
  const prod = prods.find((p) => p.is_available !== false) || prods[0];
  if (!prod) return { ok: false, why: 'the tenant has no catalogue row to order', s: cat.status };

  const selected_add_ons = [];
  const groups = Array.isArray(prod.addOnGroups || prod.add_on_groups) ? (prod.addOnGroups || prod.add_on_groups) : [];
  for (const group of groups) {
    const isRequired = Boolean(group.isRequired || (group.minSelections && group.minSelections > 0));
    if (isRequired && Array.isArray(group.options) && group.options.length > 0) {
      const opt = group.options.find((o) => o.isAvailable !== false) || group.options[0];
      if (opt && opt.id) selected_add_ons.push(opt.id);
    }
  }

  const booked = await request('POST', '/api/customer/book-food',
    {
      merchantId: tenant.uuid,
      deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi',
      items: [{ productId: prod.id, quantity: 1, selected_add_ons }]
    },
    { ...tok(customerToken), 'Idempotency-Key': uniq('mch_fixture') });
  const order = booked.data.order || booked.data.job || {};
  return {
    ok: booked.status === 200 && !!order.id,
    id: order.id || null,
    product: String(prod.id),
    status: booked.status,
    body: JSON.stringify(booked.data || {}).slice(0, 160),
  };
}

async function main() {
  console.log('--- MERCHANT SECURITY / TENANT ISOLATION TESTS ---');

  const { supabaseAdmin } = require('./src/supabase');
  if (!supabaseAdmin) {
    console.log('SKIP: PostgreSQL is not configured; these checks prove stored state.');
    return finish();
  }
  const store = supabaseAdmin;

  // ---- every merchant, customer, dish and shelf used below is minted here and removed on exit ----
  // The entitlement group (MES) reads `merchants.merchant_type` back from PostgreSQL and the
  // inventory group (MCP) writes a grocery shelf, so both need merchants whose stored type this
  // file chose. Minting them also means the orders, KDS tickets, sessions and price history this
  // run creates are rows the fixture cleanup owns and can delete.
  fx = await openFixtures('mch', { connectionString: PG });
  const mintMerchant = async (target) => {
    const m = await fx.merchant({ type: target.type, name: `${target.name} ${DAY}` });
    target.uuid = m.id;
    target.phone = m.phone;
    target.name = m.name;
    return target;
  };
  await mintMerchant(A);
  await mintMerchant(B);
  await mintMerchant(GG);
  CUSTOMER_PHONE = (await fx.customer({ name: 'buyer' })).phone;
  // One orderable dish per restaurant-capable tenant: the catalogue reads, the menu-photo group
  // and both order mints all take their item from these rows.
  aDish = await fx.foodProduct(A.uuid, { name: 'hybrid store dish', category: 'Fixture Menu', price: 210 });
  aDish.sku = `FIX-MCH-${DAY}-A`;
  await fx.query('UPDATE products SET sku = $2 WHERE id = $1::uuid', [aDish.id, aDish.sku]);
  await fx.foodProduct(B.uuid, { name: 'restaurant store dish', category: 'Fixture Menu', price: 180 });
  // A's instamart side: one master-catalogue row, stocked on A's own shelf. The inventory group
  // used to derive its product from the shared master catalogue's first row, which made every
  // price assertion depend on which other suite had run last.
  fixtureShelf = await fx.groceryItem(A.uuid, {
    name: 'fixture shelf item', category: 'Fixture Aisle', store_price: 56, stock_quantity: 50,
  });
  console.log(`  fixtures: A=${A.type} ${String(A.uuid).slice(0, 8)} | B=${B.type} ${String(B.uuid).slice(0, 8)}`
    + ` | G=${GG.type} ${String(GG.uuid).slice(0, 8)} | dish=${String(aDish.id).slice(0, 8)}`
    + ` | shelf=${String(fixtureShelf.id).slice(0, 8)} catalog=${String(fixtureShelf.catalogId).slice(0, 8)}`);

  const la = await login(A.phone, 'MERCHANT');
  const lb = await login(B.phone, 'MERCHANT');
  const lc = await login(CUSTOMER_PHONE, 'CUSTOMER');
  const A_T = la.token; const B_T = lb.token; const C_T = lc.token;

  // =============================== 1. authentication ===============================
  assert('MCA-01 merchant A has a real MERCHANT session', !!A_T, { failure: la.failure });
  assert('MCA-02 merchant B has a real MERCHANT session', !!B_T, { failure: lb.failure });
  // The buyer's phone was minted minutes ago, so the shared 10-minute OTP lockout that used to
  // make this a chain-order-dependent skip cannot apply to it. The branch is kept because the
  // lockout is a real limit of the endpoint: if it ever does answer, it is reported as SKIPPED
  // with the server's own reason rather than as a merchant defect, while any other failure mode
  // still fails the suite.
  const rateLimited = lc.failure && lc.failure.body && lc.failure.body.code === 'OTP_DISPATCH_FAILED';
  if (C_T) {
    assert('MCA-03a a customer session is available for the order-creation checks', true, null);
  } else if (rateLimited) {
    skip('MCA-03a a customer session is available for the order-creation checks',
      `OTP endpoint rate-limited in-chain: ${lc.failure.body.error}`);
  } else {
    assert('MCA-03a a customer session is available for the order-creation checks', false, { failure: lc.failure });
  }
  assert('MCA-03 the session resolves to A and to B, not to a shared account',
    la.user && lb.user && String(la.user.id) !== String(lb.user.id)
    && String(la.user.uuid || la.user.id) === String(A.uuid)
    && String(lb.user.uuid || lb.user.id) === String(B.uuid),
    { aUser: la.user && { id: la.user.id, uuid: la.user.uuid }, bUser: lb.user && { id: lb.user.id, uuid: lb.user.uuid } });

  const anon = {};
  for (const p of ['/api/merchant/orders', '/api/merchant/catalog', '/api/merchant/inventory']) {
    const r = await request('GET', p);
    anon[p] = r.status;
  }
  assert('MCA-04 no merchant read is reachable anonymously',
    Object.values(anon).every((s) => s === 401), anon);

  if (C_T) {
    const custOrders = await request('GET', '/api/merchant/orders', null, tok(C_T));
    assert('MCA-05 a customer token cannot read the merchant queue', custOrders.status === 403, { s: custOrders.status });
  } else {
    skip('MCA-05 a customer token cannot read the merchant queue', 'no customer session to test with');
  }

  const drv = await login('9810122910', 'DRIVER');
  if (drv.token) {
    const drvOrders = await request('GET', '/api/merchant/orders', null, tok(drv.token));
    assert('MCA-06 a driver token cannot read the merchant queue', drvOrders.status === 403, { s: drvOrders.status });
  } else {
    skip('MCA-06 a driver token cannot read the merchant queue',
      `no driver session to test with (${JSON.stringify(drv.failure)})`);
  }

  const noTokStatus = await request('POST', `/api/merchant/orders/does-not-exist/status`, { status: 'ACCEPTED' });
  assert('MCA-07 an order mutation without a token is refused before any lookup', noTokStatus.status === 401, { s: noTokStatus.status });

  // =============================== 2. own-tenant reads ===============================
  // Mint first, then read: "B can read its own orders" is a statement about the read path, and
  // it can only be proven against an order B actually owns.
  const fa = await mintOrderFor(A, A_T, C_T);
  const fb = await mintOrderFor(B, B_T, C_T);
  assert('MCA-FX this file created one order for each tenant through customer checkout',
    fa.ok && fb.ok, { a: fa, b: fb, customer: C_T ? 'session' : (lc.failure && lc.failure.body && lc.failure.body.code) || 'no session' });

  const aOrders = await request('GET', '/api/merchant/orders', null, tok(A_T));
  const bOrders = await request('GET', '/api/merchant/orders', null, tok(B_T));
  const aList = (aOrders.data || {}).orders || [];
  const bList = (bOrders.data || {}).orders || [];
  assert('MCA-08 A can read its own orders', aOrders.status === 200 && aList.length > 0,
    { s: aOrders.status, n: aList.length });
  assert('MCA-09 B can read its own orders', bOrders.status === 200 && bList.length > 0,
    { s: bOrders.status, n: bList.length });
  assert('MCI-01 every order A is served belongs to A',
    aList.every((o) => String(o.merchant_id) === A.uuid), { sample: aList.slice(0, 3).map((o) => o.merchant_id) });
  assert('MCI-02 every order B is served belongs to B',
    bList.every((o) => String(o.merchant_id) === B.uuid), { sample: bList.slice(0, 3).map((o) => o.merchant_id) });
  const bNumbers = new Set(bList.map((o) => o.order_number));
  assert('MCI-03 A is never handed one of B order numbers, and vice versa',
    !aList.some((o) => bNumbers.has(o.order_number)) && !bList.some((o) => aList.some((x) => x.order_number === o.order_number)),
    { a: aList.length, b: bList.length });

  // =============================== 3. IDOR: the other tenant's order ===============================
  // Attack the row this file just minted when it exists, so the target's whole history is known
  // here; fall back to any row of that tenant otherwise.
  const victim = bList.find((o) => String(o.id) === String(fb.id))
    || bList.find((o) => o.order_state === 'RECEIVED') || bList[0] || null;
  const victimA = aList.find((o) => String(o.id) === String(fa.id))
    || aList.find((o) => o.order_state === 'RECEIVED') || aList[0] || null;

  if (!victim || !victimA) {
    // Only reachable when MCA-FX has already failed: with no order owned by a tenant there is no
    // row to attack. It is reported per check name instead of crashing the file at `victim.id`,
    // which is exactly how an empty store used to end this run.
    for (const n of ['MCI-04', 'MCI-05', 'MCI-06', 'MCI-07', 'MCI-08', 'MCI-09', 'MCI-10',
      'MCI-11', 'MCI-12']) {
      skip(n, `no order to attack -> A=${JSON.stringify(fa)} B=${JSON.stringify(fb)}`);
    }
  } else {
    const before = await orderRow(store, victim.id);
    assert('MCI-04 the target row exists and is B\'s before the attack',
      before.row && String(before.row.merchant_id) === B.uuid, { before: before.row });

    const aReadB = await request('GET', `/api/merchant/${B.uuid}/orders`, null, tok(A_T));
    assert('MCI-05 A cannot list B\'s orders through B\'s own id in the path',
      aReadB.status === 403 && aReadB.data.success !== true, { s: aReadB.status, code: aReadB.data.code });

    const aMutB = await request('POST', `/api/merchant/orders/${victim.id}/status`, { status: 'ACCEPTED' }, tok(A_T));
    assert('MCI-06 A cannot move B\'s order forward',
      aMutB.status === 403 && aMutB.data.success !== true, { s: aMutB.status, body: aMutB.data });

    const aMutBPath = await request('POST', `/api/merchant/${B.uuid}/orders/${victim.id}/status`, { status: 'ACCEPTED' }, tok(A_T));
    assert('MCI-07 A cannot do it either by naming B\'s restaurant in the path',
      aMutBPath.status === 403 && aMutBPath.data.success !== true, { s: aMutBPath.status });

    const aMutBBody = await request('POST', '/api/merchant/orders', {
      merchantId: B.uuid, orders: [{ id: victim.id, status: 'ACCEPTED' }],
    }, tok(A_T));
    const aMutBBodyStatus = await request('POST', `/api/merchant/orders/${victim.id}/status`,
      { status: 'ACCEPTED', merchantId: B.uuid, restaurantId: B.uuid }, tok(A_T));
    assert('MCI-08 a merchantId/restaurantId in the body never overrides the token',
      aMutBBodyStatus.status === 403 && aMutBBody.data.success !== true,
      { list: aMutBBody.status, status: aMutBBodyStatus.status, code: aMutBBodyStatus.data.code });

    const qSpoof = await request('POST', `/api/merchant/orders/${victim.id}/status?merchantId=${B.uuid}&restaurantId=${B.uuid}`,
      { status: 'ACCEPTED' }, tok(A_T));
    assert('MCI-09 and neither does one in the query string',
      qSpoof.status === 403 && qSpoof.data.success !== true, { s: qSpoof.status });

    const after = await orderRow(store, victim.id);
    assert('MCI-10 five attacks left B\'s stored order byte-identical',
      !after.error && sameRow(before.row, after.row), { before: before.row, after: after.row });

    // and the same in the other direction, on A's rows
    const beforeA = await orderRow(store, victimA.id);
    const bMutA = await request('POST', `/api/merchant/orders/${victimA.id}/status`, { status: 'ACCEPTED' }, tok(B_T));
    const bReadA = await request('GET', `/api/merchant/${A.uuid}/orders`, null, tok(B_T));
    const afterA = await orderRow(store, victimA.id);
    assert('MCI-11 B cannot move A\'s order, nor list it through A\'s id',
      bMutA.status === 403 && bReadA.status === 403, { mut: bMutA.status, read: bReadA.status });
    assert('MCI-12 and A\'s stored row is untouched by the attempt',
      sameRow(beforeA.row, afterA.row), { before: beforeA.row, after: afterA.row });
  }

  // =============================== 4. products / catalogue ===============================
  const aCat = await request('GET', '/api/merchant/catalog', null, tok(A_T));
  const bCat = await request('GET', '/api/merchant/catalog', null, tok(B_T));
  const aProds = (aCat.data || {}).products || [];
  const bProds = (bCat.data || {}).products || [];
  assert('MCP-01 A sees its own catalogue', aCat.status === 200 && aProds.length > 0, { n: aProds.length });
  assert('MCP-02 B sees its own catalogue', bCat.status === 200 && bProds.length > 0, { n: bProds.length });
  assert('MCP-03 A\'s catalogue contains no B product, and B\'s contains no A product',
    aProds.every((p) => String(p.merchant_id ?? A.uuid) === A.uuid)
    && !aProds.some((p) => bProds.some((q) => q.id === p.id))
    && !bProds.some((q) => aProds.some((p) => p.id === q.id)),
    { a: aProds.map((p) => p.id), b: bProds.map((p) => p.id) });
  assert('MCP-04 B\'s known product never appears in A\'s list',
    !aProds.some((p) => p.id === bProds[0] && bProds[0].id), { leaked: bProds[0] && bProds[0].id });

  const bProduct = bProds[0];
  const pBefore = await productRow(store, bProduct.id);
  const invSpoof = await request('POST', '/api/merchant/inventory', {
    merchantId: B.uuid, productId: bProduct.id, price: 1, stock_quantity: 9999, is_available: false,
  }, tok(A_T));
  const pAfter = await productRow(store, bProduct.id);
  assert('MCP-05 A\'s inventory write cannot name B\'s product and change it',
    pAfter.row && sameRow(pBefore.row, pAfter.row) && invSpoof.data.merchantId !== B.uuid,
    { inv: { s: invSpoof.status, ok: invSpoof.data.success }, before: pBefore.row, after: pAfter.row });

  const masterRead = await request('GET', '/api/merchant/master-catalog', null, tok(A_T));
  const masterProducts = (masterRead.data || {}).products || [];
  assert('MCP-05b the master catalogue is a shared read, not a tenant leak of priced rows',
    masterRead.status === 200 && Array.isArray(masterRead.data.products)
    && !!fixtureShelf && masterProducts.some((p) => String(p.id) === String(fixtureShelf.catalogId)),
    { s: masterRead.status, n: masterProducts.length,
      stocked: masterProducts.some((p) => String(p.id) === String(fixtureShelf.catalogId)) });

  // --- inventory value integrity (money + stock) ---
  //
  // These replaced an assertion that was vacuous: it posted `price`/`stock_quantity`, but the
  // route's real fields are `currentPrice`/`stockQty`, so the server saw no known field and the
  // check passed by ignoring its own payload. Everything below speaks the real field names and
  // reads `merchant_grocery_inventory` back, because "a 400 came back" is not evidence that
  // nothing was written — the whole point of a money-integrity guard is the row.
  const masterId = (fixtureShelf || {}).catalogId;
  const invCols = 'store_price,stock_quantity,is_available,status,updated_at';
  const readInv = async () => (await store.from('merchant_grocery_inventory')
    .select(invCols).eq('merchant_id', A.uuid).eq('product_id', masterId).maybeSingle()).data;
  const postInv = (patch) => request('POST', '/api/merchant/inventory',
    { masterProductId: masterId, ...patch }, tok(A_T));

  const preExisting = masterId ? await readInv() : null;
  const createdListing = masterId && !preExisting;

  const good = masterId ? await postInv({ currentPrice: 49.5, stockQty: 10 }) : { data: {} };
  const goodRow = masterId ? await readInv() : null;
  assert('MCP-06 a legitimate price and stock update succeeds and is stored',
    good.data.success === true && goodRow && Number(goodRow.store_price) === 49.5 && Number(goodRow.stock_quantity) === 10,
    { s: good.status, code: good.data.code, err: good.data.error, row: goodRow });

  const baseline = goodRow;
  // Each entry: label, payload. All must be refused AND leave the row exactly as it was.
  const invalid = [
    ['negative price', { currentPrice: -1 }],
    ['large negative price', { currentPrice: -50 }],
    ['sub-negative price', { currentPrice: -0.01 }],
    ['negative stock', { stockQty: -1 }],
    ['large negative stock', { stockQty: -100 }],
    ['malformed price', { currentPrice: 'abc' }],
    ['malformed stock', { stockQty: 'abc' }],
    ['non-numeric object price', { currentPrice: {} }],
    ['null price', { currentPrice: null }],
    ['NaN as string', { currentPrice: 'NaN' }],
    ['Infinity as string', { currentPrice: 'Infinity' }],
    ['negative infinity as string', { stockQty: '-Infinity' }],
    ['overflow exponent becomes Infinity', { currentPrice: 1e999 }],
    ['price beyond NUMERIC(10,2)', { currentPrice: 100000000 }],
    ['stock beyond INTEGER range', { stockQty: 3000000000 }],
    ['fractional stock', { stockQty: 12.9 }],
    ['price with 3 decimal places', { currentPrice: 10.999 }],
    ['scientific notation string', { currentPrice: '1e2' }],
    ['zero price (no free-product rule exists)', { currentPrice: 0 }],
  ];
  const refusals = [];
  for (const [label, patch] of invalid) {
    const r = await postInv(patch);
    const persisted = await readInv();
    refusals.push({
      label, patch, status: r.status, code: r.data.code, ok: r.data.success === true,
      unchanged: sameRow(baseline, persisted), drifted: persisted,
    });
  }
  const badAccepts = refusals.filter((x) => x.ok);
  const badDrifts = refusals.filter((x) => !x.unchanged);
  assert('MCP-07 every invalid price or stock value is refused with 4xx and a code',
    badAccepts.length === 0, {
      accepted: badAccepts.map((x) => `${x.label} -> ${x.status} ${JSON.stringify(x.patch)}`),
    });
  assert('MCP-08 no refused value reached the stored row (row byte-identical after all 19 attempts)',
    badDrifts.length === 0, {
      drifted: badDrifts.map((x) => `${x.label}: ${JSON.stringify(x.drifted)}`),
    });
  assert('MCP-09 refusals name what was wrong rather than returning an opaque 500',
    refusals.every((x) => [400, 422].includes(x.status) && !!x.code),
    { shapes: refusals.map((x) => `${x.label}=${x.status}/${x.code}`).slice(0, 6) });

  // Zero stock is a real state (sold out), so it must still be accepted.
  const zeroStock = masterId ? await postInv({ stockQty: 0 }) : { data: {} };
  const zeroStockRow = masterId ? await readInv() : null;
  assert('MCP-10 zero stock is accepted, because sold out is a legitimate state',
    zeroStock.data.success === true && zeroStockRow && Number(zeroStockRow.stock_quantity) === 0,
    { s: zeroStock.status, code: zeroStock.data.code, row: zeroStockRow });

  // A partial update must not be forced to resend a price it did not mean to change.
  const partial = masterId ? await postInv({ stockQty: 25 }) : { data: {} };
  const partialRow = masterId ? await readInv() : null;
  assert('MCP-11 a stock-only update leaves the stored price alone',
    partial.data.success === true && partialRow && Number(partialRow.store_price) === 49.5
    && Number(partialRow.stock_quantity) === 25,
    { row: partialRow });

  // Identity still wins over the body, on this endpoint too.
  const bodyTenantSpoof = masterId ? await request('POST', '/api/merchant/inventory',
    { masterProductId: masterId, currentPrice: 5, stockQty: 5, merchantId: B.uuid }, tok(A_T)) : { data: {} };
  const bRows = masterId ? (await store.from('merchant_grocery_inventory')
    .select('id').eq('merchant_id', B.uuid).eq('product_id', masterId).maybeSingle()).data : null;
  assert('MCP-12 a merchantId in the body cannot plant a row on another merchant\'s shelf',
    bRows === null && (bodyTenantSpoof.data.success !== true || bodyTenantSpoof.data.merchantId !== B.uuid),
    { s: bodyTenantSpoof.status, bRow: bRows });

  // The route spreads the whole body into the repository, so an attacker (or a confused
  // client) can send column names the destructured parameters do not include. Those must be
  // inert, not a way around the validator.
  const altField = masterId ? await request('POST', '/api/merchant/inventory', {
    masterProductId: masterId, store_price: -5, stock_quantity: -7, price: -9, currentPrice: 49.5,
  }, tok(A_T)) : { data: {} };
  const altRow = masterId ? await readInv() : null;
  assert('MCP-13 database column names in the body cannot bypass the value validator',
    altRow && Number(altRow.store_price) === 49.5 && Number(altRow.stock_quantity) >= 0
    && altField.data.success === true,
    { s: altField.status, row: altRow });

  // Restore whatever these checks mutated, and prove the restore landed.
  //
  // This block used to issue its write and never read the result. That is how a shared fixture gets
  // poisoned invisibly: measured 2026-10-09, the `grocery_price_history` timeline shows five runs
  // that began at the seeded 56.00 and returned to it, then every run after 15:37Z beginning at
  // 49.50 — the restore had stopped landing, said nothing, and the next two links (test_suite's
  // `PRICE_CHANGED` cascade and test_phase4_orders' `₹112 (2 x 56)`) went red on a fixture, not on
  // a product defect. An unchecked restore is worse than no restore at all.
  if (masterId) {
    if (createdListing) {
      const removed = await store.from('merchant_grocery_inventory').delete()
        .eq('merchant_id', A.uuid).eq('product_id', masterId);
      const stillThere = await readInv();
      assert('MCP-14 the listing this suite created is gone again',
        !removed.error && stillThere === null, { error: removed.error || null, row: stillThere });
    } else if (preExisting) {
      const restore = await store.from('merchant_grocery_inventory').update({
        store_price: preExisting.store_price,
        stock_quantity: preExisting.stock_quantity,
        is_available: preExisting.is_available,
        status: preExisting.status,
      }).eq('merchant_id', A.uuid).eq('product_id', masterId);
      const restored = await readInv();
      assert('MCP-14 the inventory row this suite mutated reads back exactly the values it was found with',
        !restore.error && !!restored
        && Number(restored.store_price) === Number(preExisting.store_price)
        && Number(restored.stock_quantity) === Number(preExisting.stock_quantity)
        && restored.is_available === preExisting.is_available
        && restored.status === preExisting.status,
        { error: restore.error || null, found: preExisting, now: restored });
    }
  } else {
    skip('MCP-14', 'the master catalogue returned no product, so nothing was mutated to restore');
  }

  // =============================== 5. store / menu state ===============================
  // `rest_1` is the legacy in-memory restaurant and carries NO merchant link, and the
  // toggle guard only fired `if (rest.merchantId)`. An unowned store was therefore mutable by
  // any authenticated merchant. `m1` is a real item on its menu, so this cannot quietly pass
  // on a "menu item not found" 404 the way a made-up id would have.
  const menuToggleB = await request('POST', `/api/merchant/${REST_LEGACY}/menu/m1/toggle`,
    { inStock: false }, tok(B_T));
  assert('MCS-01 B cannot toggle a real menu item of a store it does not own',
    menuToggleB.data.success !== true && menuToggleB.status === 403 && menuToggleB.data.code === 'MERCHANT_MISMATCH',
    { s: menuToggleB.status, code: menuToggleB.data.code, body: menuToggleB.data });

  const menuForeign = await request('POST', `/api/merchant/${B.uuid}/menu/m1/toggle`,
    { inStock: false }, tok(A_T));
  assert('MCS-02 A cannot reach B\'s menu through B\'s store id either',
    menuForeign.data.success !== true && [403, 404].includes(menuForeign.status),
    { s: menuForeign.status, code: menuForeign.data.code });

  // =============================== 6. media authorization ===============================
  // An unauthenticated caller must be stopped at the door (401/403), never allowed to walk as
  // far as the storage call. Where a call has to go deeper than the door it carries a mime type
  // the service rejects before it touches the SDK. That discipline is not a comment about this
  // machine — the process measured on 2026-10-09 carried no `CLOUDINARY_*` value, so
  // `cloudinaryService.isConfigured` was false and uploads returned from the mock branch without a
  // network call. That is a fact about one process, not about this repository: `backend/.env*` is
  // gitignored and can gain real credentials at any time, and a checkout that *does* load them
  // writes with `overwrite: true` (services/cloudinaryService.js), so no suite may be capable of
  // overwriting a shared storage account on every run.
  const tinyImage = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64').toString('base64');
  const dataUrl = `data:image/png;base64,${tinyImage}`;

  const anonGroceryPhoto = await request('POST', `/api/grocery/products/gprod_probe_${DAY}/photo`,
    { fileData: dataUrl });
  assert('MCMD-01 an unauthenticated grocery product photo write is refused at the door',
    [401, 403].includes(anonGroceryPhoto.status),
    { s: anonGroceryPhoto.status, err: anonGroceryPhoto.data.error, note: '400 here means it reached Cloudinary' });

  const anonAdminPhotoAlias = await request('POST', `/api/admin/grocery/products/gprod_probe_${DAY}/photo`,
    { fileData: dataUrl });
  assert('MCMD-02 the admin alias of that route is not an unauthenticated back door',
    [401, 403].includes(anonAdminPhotoAlias.status), { s: anonAdminPhotoAlias.status });

  const custPhoto = await request('POST', `/api/grocery/products/gprod_probe_${DAY}/photo`,
    { fileData: dataUrl }, tok(C_T));
  assert('MCMD-03 a customer token cannot relabel a product image',
    [401, 403].includes(custPhoto.status), { s: custPhoto.status });

  const anonStoreMedia = await request('POST', `/api/merchant/${REST_LEGACY}/media`,
    { fileData: dataUrl, mediaType: 'COVER' });
  assert('MCMD-04 an unauthenticated store media upload is refused',
    [401, 403].includes(anonStoreMedia.status), { s: anonStoreMedia.status });

  const bBodyRestaurant = await request('POST', '/api/merchant/media',
    { fileData: dataUrl, restaurantId: REST_LEGACY, mediaType: 'COVER' }, tok(B_T));
  assert('MCMD-05 B cannot reach the legacy store by putting its id in the body',
    bBodyRestaurant.data.success !== true && [400, 403, 404].includes(bBodyRestaurant.status),
    { s: bBodyRestaurant.status, code: bBodyRestaurant.data.code });

  const menuPhotoNoAuth = await request('POST', '/api/merchant/menu/item_1/photo', { fileData: dataUrl });
  assert('MCMD-06 the menu-photo route authenticates too',
    [401, 403].includes(menuPhotoNoAuth.status), { s: menuPhotoNoAuth.status });

  // Nothing above may have left a row behind. `sku` is text, so the probe id is queried on a
  // column that will not error out and turn a broken assertion into a passing one.
  const orphanProduct = await store.from('products').select('id,sku,name')
    .eq('sku', `gprod_probe_${DAY}`).maybeSingle();
  assert('MCMD-07 no refused upload created a product row',
    !orphanProduct.error && !orphanProduct.data, { found: orphanProduct.data, err: orphanProduct.error });

  // ---- the menu-item photo route reaching its own gate ----
  // Three separate faults made this route unable to do its one job, and each produced a
  // different wrong answer:
  //   * the dish membership test read `rest.menu`, the in-memory mirror, which carries no menu
  //     rows for a live-PostgreSQL store — so every real dish was refused as `MENU_ITEM_NOT_FOUND`,
  //     a 404 about a dish that exists;
  //   * a request that did clear the membership test then named an undeclared `restaurantId` in
  //     the tag list and died on `ReferenceError: restaurantId is not defined`, which the catch
  //     answered as a 400 quoting that internal sentence to the caller;
  //   * the catch hard-coded 400, so a 403 `MERCHANT_MISMATCH` refusal arrived as a codeless 400.
  // A disallowed mime is the probe payload throughout: `uploadImage` validates the folder and the
  // mime before any SDK call, so "it answered the mime refusal" proves the request walked the
  // whole authorization path without writing anything.
  const badMime = 'application/x-msdownload';
  const readDishes = async (storeId) => {
    const r = await request('GET', `/api/restaurants/${storeId}/menu`);
    return (r.data && r.data.items) || [];
  };
  const ownDish = (await readDishes(A.uuid)).find((i) => i && i.id) || null;
  const foreignDish = (await readDishes(B.uuid)).find((i) => i && i.id && i.id !== (ownDish && ownDish.id)) || null;
  const mediaCountOf = async () => {
    const r = await request('GET', '/api/media');
    return r.data && r.data.count;
  };
  const mediaCountBefore = await mediaCountOf();

  // `products.image_url` is the only column on the dish's own row that a menu-photo write could
  // rewrite, and the route never updates it — `db.saveMediaAsset` records the asset, nothing writes
  // the product. Reading it across the whole refusal set is the side-effect assertion the media
  // count cannot make on its own: under live PostgreSQL the asset array is process-only and starts
  // at zero, so "count unchanged" is a weak witness while the stored dish row is a durable one.
  const readDishImage = async (itemId) => {
    const r = await store.from('products').select('id,sku,name,image_url').eq('id', itemId).maybeSingle();
    return r.error ? { error: r.error } : { row: r.data };
  };

  // A dish of A's own store, addressed by its uuid.
  if (!ownDish) {
    for (const n of ['MCMD-08', 'MCMD-09', 'MCMD-10', 'MCMD-11', 'MCMD-12', 'MCMD-13', 'MCMD-19']) {
      skip(n, 'merchant A has no menu rows to photograph');
    }
  } else {
    const dishImageBefore = await readDishImage(ownDish.id);

    // A NULL column cannot witness a preservation claim. Measured 2026-10-10: both of merchant A's
    // seeded dish rows store `image_url` NULL, so an unchanged-value assertion would hold even
    // against a route that overwrote a real photo with a fabricated CDN URL. Put a sentinel in the
    // column, run the whole refusal set against it, then restore — the refusals now have something
    // to lose. The write is this suite's own, against A's own row (`merchant_id` is in the filter),
    // on the target the wrapper applied, and MCMD-19 checks it went back.
    const sentinel = `nabin-sentinel/menu-photo-${crypto.randomBytes(4).toString('hex')}`;
    let sentinelWritten = false;
    let sentinelError = null;
    if (!dishImageBefore.error) {
      const w = await store.from('products').update({ image_url: sentinel })
        .eq('id', ownDish.id).eq('merchant_id', A.uuid).select('id,image_url');
      sentinelError = w.error || null;
      sentinelWritten = !w.error && (w.data || []).length === 1 && w.data[0].image_url === sentinel;
    } else {
      sentinelError = dishImageBefore.error;
    }
    if (!sentinelWritten) skip('MCMD-13', `no sentinel could stand in the column: ${JSON.stringify(sentinelError)}`);
    const ownPhoto = await request('POST', `/api/merchant/${A.uuid}/menu/${ownDish.id}/photo`,
      { fileData: dataUrl, mimeType: badMime }, tok(A_T));
    assert('MCMD-08 the photo route recognises one of A\'s own dishes and reaches its upload gate',
      ownPhoto.status === 400 && /Unsupported MIME type/.test(String(ownPhoto.data.error || '')),
      { s: ownPhoto.status, code: ownPhoto.data.code, err: ownPhoto.data.error, note: 'a 404 MENU_ITEM_NOT_FOUND here is the mirror read refusing a dish that exists' });

    // `products.id` is a uuid column, so a legacy or sku-shaped identifier compared against it is
    // a PostgreSQL 22P02 error surfaced as a store failure, not a refusal. The route matches the
    // caller's identifier on a column that can hold it; this assertion holds that behaviour.
    if (!ownDish.sku) {
      skip('MCMD-09', 'A\'s fixture dish carries no sku to photograph by');
    } else {
      const skuPhoto = await request('POST', `/api/merchant/${A.uuid}/menu/${ownDish.sku}/photo`,
        { fileData: dataUrl, mimeType: badMime }, tok(A_T));
      assert('MCMD-09 a non-uuid menu identifier is matched on a column that can hold it',
        skuPhoto.status === 400 && /Unsupported MIME type/.test(String(skuPhoto.data.error || '')),
        { s: skuPhoto.status, code: skuPhoto.data.code, err: skuPhoto.data.error });
    }

    // The dish id is caller-controlled, so the membership read must stay scoped to the caller's
    // own store — otherwise A can relabel one of B's dish images.
    if (!foreignDish) {
      skip('MCMD-10', 'merchant B has no menu row to aim A at');
    } else {
      const crossStoreItem = await request('POST', `/api/merchant/${A.uuid}/menu/${foreignDish.id}/photo`,
        { fileData: dataUrl, mimeType: badMime }, tok(A_T));
      assert('MCMD-10 A cannot photograph B\'s dish by addressing its own store',
        crossStoreItem.status === 404 && crossStoreItem.data.code === 'MENU_ITEM_NOT_FOUND',
        { s: crossStoreItem.status, code: crossStoreItem.data.code, err: crossStoreItem.data.error });
    }

    // The store resolver refuses before the dish is looked at, so this needs no fixture from B.
    const wrongStorePath = await request('POST', `/api/merchant/${B.uuid}/menu/${ownDish.id}/photo`,
      { fileData: dataUrl, mimeType: badMime }, tok(A_T));
    assert('MCMD-11 the photo route keeps a cross-store refusal as a 403 carrying its code',
      wrongStorePath.status === 403 && wrongStorePath.data.code === 'MERCHANT_MISMATCH',
      { s: wrongStorePath.status, code: wrongStorePath.data.code, err: wrongStorePath.data.error });

    const mediaCountAfter = await mediaCountOf();
    assert('MCMD-12 none of the menu-photo refusals persisted a media asset',
      mediaCountBefore === mediaCountAfter, { before: mediaCountBefore, after: mediaCountAfter });

    // The sentinel has to survive every refusal, then go back exactly as it was found.
    const dishImageAfter = await readDishImage(ownDish.id);
    if (!sentinelWritten) {
      skip('MCMD-19', 'the sentinel never landed, so there is nothing to restore');
    } else if (dishImageAfter.error) {
      skip('MCMD-13', `the dish row could not be read back: ${JSON.stringify(dishImageAfter.error)}`);
    } else {
      assert('MCMD-13 no menu-photo refusal overwrote the sentinel standing in the dish\'s image_url',
        (dishImageAfter.row || {}).image_url === sentinel,
        { found: (dishImageAfter.row || {}).image_url, expected: sentinel, note: 'a mock URL here means a refusal reached storage' });

      const restored = await store.from('products')
        .update({ image_url: (dishImageBefore.row || {}).image_url ?? null })
        .eq('id', ownDish.id).eq('merchant_id', A.uuid).select('id,image_url');
      assert('MCMD-19 the sentinel this suite wrote is restored to the value the row was found with',
        !restored.error && (restored.data || []).length === 1
        && ((restored.data || [])[0] || {}).image_url === ((dishImageBefore.row || {}).image_url ?? null),
        { wanted: (dishImageBefore.row || {}).image_url, got: (restored.data || [])[0] && restored.data[0].image_url, err: restored.error });
    }
  }

  // ---- the two identifier branches, aimed at a dish that does not exist ----
  // The route chooses its comparison column by shape: a uuid is matched on `products.id`, anything
  // else on `products.sku`. Both branches owe the caller the route's own refusal.
  // The uuid branch is the one worth minting for: `products.id` is a uuid column, so a malformed
  // value compared against it is SQLSTATE 22P02 — a store failure the catch answers as a codeless
  // 400 or a store-unreachable 503, quoting infrastructure at the caller. An absent-but-valid uuid
  // isolates the lookup from the column type, so a 404 here means the membership query refused, and
  // anything else means the request never got that far.
  const absentUuid = crypto.randomUUID();
  const absentUuidRes = await request('POST', `/api/merchant/${A.uuid}/menu/${absentUuid}/photo`,
    { fileData: dataUrl, mimeType: badMime }, tok(A_T));
  assert('MCMD-14 an absent uuid-shaped menu id is refused by the lookup, not by a store error',
    absentUuidRes.status === 404 && absentUuidRes.data.code === 'MENU_ITEM_NOT_FOUND',
    { s: absentUuidRes.status, code: absentUuidRes.data.code, err: absentUuidRes.data.error });

  const absentSku = `menu_probe_absent_${DAY}`;
  const absentSkuRes = await request('POST', `/api/merchant/${A.uuid}/menu/${absentSku}/photo`,
    { fileData: dataUrl, mimeType: badMime }, tok(A_T));
  assert('MCMD-15 an absent sku-shaped menu id is refused on a column that can hold it',
    absentSkuRes.status === 404 && absentSkuRes.data.code === 'MENU_ITEM_NOT_FOUND',
    { s: absentSkuRes.status, code: absentSkuRes.data.code, err: absentSkuRes.data.error });

  // ---- authenticated, but with no merchant context ----
  // A different fault from MCMD-06's anonymous caller: here `resolveMediaCaller` has a real session
  // in hand and must refuse on the role before it resolves a store, reads a dish, or reaches the
  // upload gate. A 404 instead of a 403 would mean the customer walked past the role check and got
  // an answer from the dish lookup.
  if (!C_T) {
    skip('MCMD-16', 'no customer session to test the role gate with');
  } else {
    const custMenuPhoto = await request('POST', `/api/merchant/${A.uuid}/menu/${absentSku}/photo`,
      { fileData: dataUrl, mimeType: badMime }, tok(C_T));
    assert('MCMD-16 a customer session is refused by the role gate before any dish lookup',
      custMenuPhoto.status === 403 && custMenuPhoto.data.code === 'FORBIDDEN',
      { s: custMenuPhoto.status, code: custMenuPhoto.data.code, err: custMenuPhoto.data.error });
  }

  if (!drv.token) {
    skip('MCMD-17', `no driver session to test the role gate with (${JSON.stringify(drv.failure)})`);
  } else {
    const drvMenuPhoto = await request('POST', `/api/merchant/${A.uuid}/menu/${absentSku}/photo`,
      { fileData: dataUrl, mimeType: badMime }, tok(drv.token));
    assert('MCMD-17 a driver session is refused by the same role gate',
      drvMenuPhoto.status === 403 && drvMenuPhoto.data.code === 'FORBIDDEN',
      { s: drvMenuPhoto.status, code: drvMenuPhoto.data.code, err: drvMenuPhoto.data.error });
  }

  // ---- the alias route: the store can be named in the body instead of the path ----
  // `req.params.restaurantId || req.body.restaurantId` means MCMD-11's path is only one of two ways
  // to aim this route at a foreign store, and the body one is what a client that read the alias
  // would send. The resolver takes the same `suppliedId` either way, so the refusal has to look the
  // same either way. A 404 here would mean the body name was dropped and the request resolved
  // against the caller's own store instead — which is the answer a *legitimate* alias caller gets.
  const aliasCrossStore = await request('POST', `/api/merchant/menu/${absentUuid}/photo`,
    { fileData: dataUrl, mimeType: badMime, restaurantId: B.uuid }, tok(A_T));
  assert('MCMD-20 the alias route refuses a foreign store named in the body, not just in the path',
    aliasCrossStore.status === 403 && aliasCrossStore.data.code === 'MERCHANT_MISMATCH',
    { s: aliasCrossStore.status, code: aliasCrossStore.data.code, err: aliasCrossStore.data.error });

  // And the other direction: an alias caller who names no store at all must land on their own,
  // because `mediaTargetStore` returns the resolved own store when `suppliedId` is absent. A 400
  // `MERCHANT_MISMATCH`/401 here would mean the missing context was read as a refusal, and a 404
  // would be the mirror bug back again — the alias refusing a dish that exists.
  if (!ownDish) {
    skip('MCMD-21', 'merchant A has no menu rows to photograph through the alias');
  } else {
    const aliasOwnStore = await request('POST', '/api/merchant/menu/' + ownDish.id + '/photo',
      { fileData: dataUrl, mimeType: badMime }, tok(A_T));
    assert('MCMD-21 an alias call with no store named falls back to the caller\'s own store',
      aliasOwnStore.status === 400 && /Unsupported MIME type/.test(String(aliasOwnStore.data.error || '')),
      { s: aliasOwnStore.status, code: aliasOwnStore.data.code, err: aliasOwnStore.data.error });
  }

  // What "no external upload was performed" can honestly mean from outside the server process:
  // every request above carried a mime the service rejects inside `uploadImage`, before any SDK
  // call, and the three durable witnesses stayed where they started — no product row (MCMD-07), no
  // dish image rewritten (MCMD-13), no media asset recorded (MCMD-18). This configuration makes the
  // stronger statement moot but not unprovable: measured 2026-10-09 the harness process reports
  // `cloudinaryService.isConfigured === false`, so even an accepted mime returns from the mock
  // branch without a network call. Do not read that as safety — `backend/.env*` is gitignored and
  // can gain real credentials at any time, at which point accepted uploads write with
  // `overwrite: true`. That is why the payload stays rejected.
  const mediaCountAfterNew = await mediaCountOf();
  assert('MCMD-18 none of the boundary refusals reached media storage',
    mediaCountBefore === mediaCountAfterNew, { before: mediaCountBefore, after: mediaCountAfterNew });

  // =============================== 7. transitions and concurrency ===============================
  // A brand-new order, created here, is the only thing this file mutates.
  if (!C_T) {
    // Reported as skipped, never as a pass: without a customer session there is no order to
    // create, and letting the whole group fall over with 404s would read as merchant guards
    // failing when the real cause is a throttled OTP endpoint in a shared environment.
    for (const n of ['MCO-01', 'MCO-02', 'MCO-03', 'MCO-04', 'MCO-05', 'MCO-06',
      'MCO-07', 'MCO-08', 'MCO-09', 'MCO-10', 'MCO-11', 'MCO-12']) {
      skip(n, `no customer session available (${JSON.stringify(lc.failure)})`);
    }
  } else {
  const bookKey = uniq('mch_book');
  const booked = await request('POST', '/api/customer/book-food',
    { merchantId: A.uuid, deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi',
      items: [{ productId: aDish.id, quantity: 1 }] },
    { ...tok(C_T), 'Idempotency-Key': bookKey });
  const order = booked.data.order || booked.data.job || {};
  assert('MCO-01 a fresh food order was created for the transition tests',
    booked.status === 200 && !!order.id, { s: booked.status, err: booked.data.error });
  const ownerId = String(order.merchant_id || A.uuid);
  const ownerToken = ownerId === B.uuid ? B_T : A_T;
  const notOwnerToken = ownerToken === A_T ? B_T : A_T;

  const illegal = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'READY_FOR_PICKUP' }, tok(ownerToken));
  assert('MCO-02 RECEIVED cannot jump straight to READY_FOR_PICKUP',
    illegal.data.success !== true, { s: illegal.status, code: illegal.data.code });

  const badStatus = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'DELIVERED' }, tok(ownerToken));
  assert('MCO-03 a state outside the KDS vocabulary is refused',
    badStatus.status === 400 && badStatus.data.code === 'INVALID_STATUS', { s: badStatus.status, code: badStatus.data.code });

  const noReason = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'REJECTED' }, tok(ownerToken));
  assert('MCO-04 rejecting without an approved reason is refused',
    noReason.status === 400 && noReason.data.code === 'INVALID_REJECTION_REASON', { s: noReason.status });

  const strangerAccept = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'ACCEPTED' }, tok(notOwnerToken));
  assert('MCO-05 the non-owner merchant is refused before the transition runs',
    strangerAccept.status === 403, { s: strangerAccept.status });
  const stateAfterStranger = await orderRow(store, order.id);
  assert('MCO-06 and the order is still in its original state',
    stateAfterStranger.row && stateAfterStranger.row.order_state === 'RECEIVED', { s: stateAfterStranger.row && stateAfterStranger.row.order_state });

  // Two genuine simultaneous attempts on one order, from the SAME owner (double tap, two
  // devices) and from a non-owner, run at once.
  const [r1, r2] = await Promise.all([
    request('POST', `/api/merchant/orders/${order.id}/status`, { status: 'ACCEPTED' }, tok(ownerToken)),
    request('POST', `/api/merchant/orders/${order.id}/status`, { status: 'ACCEPTED' }, tok(ownerToken)),
  ]);
  const okCount = [r1, r2].filter((r) => r.status === 200 && r.data.success === true).length;
  assert('MCO-07 two simultaneous ACCEPTED transitions do not both take effect',
    okCount <= 1 || [r1, r2].some((r) => r.data && (r.data.duplicate === true || r.data.code === 'INVALID_TRANSITION')),
    { r: [r1.status, r2.status], codes: [r1.data.code, r2.data.code], dups: [r1.data.duplicate, r2.data.duplicate] });

  const concRow = await orderRow(store, order.id);
  assert('MCO-08 the stored state after the race is exactly one ACCEPTED',
    concRow.row && concRow.row.order_state === 'ACCEPTED', { row: concRow.row });
  assert('MCO-10 the money on the order is untouched by all of this',
    concRow.row && Number(concRow.row.total_amount) === Number(order.total_amount ?? concRow.row.total_amount)
    && Number(concRow.row.total_amount) > 0,
    { sent: order.total_amount, stored: concRow.row && concRow.row.total_amount });

  const replayKey = uniq('mch_trans');
  const t1 = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'PREPARING' }, { ...tok(ownerToken), 'Idempotency-Key': replayKey });
  const t2 = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'PREPARING' }, { ...tok(ownerToken), 'Idempotency-Key': replayKey });
  assert('MCO-09 one idempotency key used twice yields one transition and a declared duplicate',
    t1.data.success === true && t2.data.success === true && t2.data.duplicate === true,
    { first: { s: t1.status, d: t1.data.duplicate }, second: { s: t2.status, d: t2.data.duplicate, code: t2.data.code } });

  const ready = await request('POST', `/api/merchant/orders/${order.id}/status`,
    { status: 'READY_FOR_PICKUP' }, tok(ownerToken));
  assert('MCO-11 the legitimate owner can walk the legal path PREPARING to READY_FOR_PICKUP',
    ready.status === 200 && ready.data.success === true, { s: ready.status, code: ready.data.code, err: ready.data.error });
  const readyRow = await orderRow(store, order.id);
  assert('MCO-12 PostgreSQL agrees the order is READY_FOR_PICKUP',
    readyRow.row && readyRow.row.order_state === 'READY_FOR_PICKUP', { row: readyRow.row });
  }

  // =============================== 7b. service entitlements ===============================
  //
  // Tenant isolation (groups 2-4) asks "is this somebody's row?". This group asks the
  // different question the Merchant architecture depends on: "is this merchant allowed to
  // operate this service at all?" A restaurant-only store has no grocery rows to steal, so
  // ownership checks pass it by and it could previously POST to /api/merchant/inventory and
  // simply create a shelf it was never granted. Hiding the module in Flutter would not have
  // changed that; only the server can.
  //
  // Three merchants, one per entitlement value the schema allows, each minted at the top of this
  // run: A HYBRID_BOTH (both services), B RESTAURANT (restaurant only), GG GROCERY (instamart only).
  const lg = await login(GG.phone, 'MERCHANT');
  const G_T = lg.token;
  assert('MES-00 the instamart-only fixture merchant has a real session', !!G_T, { failure: lg.failure });
  if (!G_T) { await done(); return; }

  const anonSvc = await request('GET', '/api/merchant/services');
  assert('MES-01 the entitlement read refuses an anonymous caller', anonSvc.status === 401, { s: anonSvc.status });

  const svcA = await request('GET', '/api/merchant/services', null, tok(A_T));
  assert('MES-02 a HYBRID_BOTH merchant is granted both services and needs a selector',
    svcA.status === 200 && svcA.data.merchantType === 'HYBRID_BOTH'
    && (svcA.data.services || []).includes('RESTAURANT') && (svcA.data.services || []).includes('INSTAMART')
    && svcA.data.needsServiceSelector === true, { s: svcA.status, body: svcA.data });

  const svcB = await request('GET', '/api/merchant/services', null, tok(B_T));
  assert('MES-03 a RESTAURANT merchant is granted restaurant only, with no selector needed',
    svcB.status === 200 && JSON.stringify(svcB.data.services) === JSON.stringify(['RESTAURANT'])
    && svcB.data.needsServiceSelector === false, { s: svcB.status, services: svcB.data.services });

  const svcC = await request('GET', '/api/merchant/services', null, tok(G_T));
  assert('MES-04 a GROCERY merchant is granted instamart only',
    svcC.status === 200 && JSON.stringify(svcC.data.services) === JSON.stringify(['INSTAMART']),
    { s: svcC.status, services: svcC.data.services });

  // The restaurant-only merchant against every instamart surface.
  const invRead = await request('GET', '/api/merchant/inventory', null, tok(B_T));
  assert('MES-05 a restaurant-only merchant cannot read instamart inventory',
    invRead.status === 403 && invRead.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: invRead.status, code: invRead.data.code });

  const invWrite = await request('POST', '/api/merchant/inventory',
    { masterProductId: '00000000-0000-0000-0000-000000000999', currentPrice: 10, stockQty: 5 }, tok(B_T));
  assert('MES-06 and cannot create one',
    invWrite.status === 403 && invWrite.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: invWrite.status, code: invWrite.data.code });

  const masterList = await request('GET', '/api/merchant/master-catalog', null, tok(B_T));
  assert('MES-07 it cannot browse the master grocery catalogue either',
    masterList.status === 403 && masterList.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: masterList.status, code: masterList.data.code });

  const pricePut = await request('PUT', '/api/grocery/products/prod_does_not_exist/price',
    { newPrice: 1 }, tok(B_T));
  assert('MES-08 it cannot set a grocery price',
    pricePut.status === 403 && pricePut.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: pricePut.status, code: pricePut.data.code });

  const packed = await request('POST', '/api/grocery/orders/ord_does_not_exist/packed-weight',
    { itemId: 'line_1', packedWeight: 1.2 }, tok(B_T));
  assert('MES-09 it cannot use grocery picking/packing',
    packed.status === 403 && packed.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: packed.status, code: packed.data.code });

  // And the instamart-only merchant against the restaurant-only control.
  const menuByGrocer = await request('POST', `/api/merchant/${A.uuid}/menu/m1/toggle`,
    { inStock: false }, tok(G_T));
  assert('MES-10 an instamart-only merchant cannot toggle a restaurant menu item',
    menuByGrocer.status === 403 && menuByGrocer.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: menuByGrocer.status, code: menuByGrocer.data.code });

  // The gate must be entitlement-shaped, not a blanket block: the same routes stay open to a
  // merchant who actually holds the service, or this would read as security and act as outage.
  const hybridInv = await request('GET', '/api/merchant/inventory', null, tok(A_T));
  assert('MES-11 a HYBRID_BOTH merchant still reads inventory (the gate is not a blanket block)',
    hybridInv.status === 200 && hybridInv.data.success === true,
    { s: hybridInv.status, body: JSON.stringify(hybridInv.data).slice(0, 140) });

  const hybridMenu = await request('POST', `/api/merchant/${A.uuid}/menu/m1/toggle`,
    { inStock: true }, tok(A_T));
  assert('MES-12 and still reaches its restaurant controls',
    hybridMenu.status !== 403 || hybridMenu.data.code !== 'MERCHANT_TYPE_MISMATCH',
    { s: hybridMenu.status, code: hybridMenu.data.code });

  // Self-declaration and id tampering must not move the decision to the client.
  const selfDeclared = await request('POST', '/api/merchant/inventory', {
    merchantId: A.uuid, restaurantId: A.uuid, storeId: A.uuid, service: 'GROCERY',
    merchantType: 'HYBRID_BOTH', masterProductId: 'x', currentPrice: 1, stockQty: 1,
  }, tok(B_T));
  assert('MES-13 body merchantId/service/type claims cannot buy a restaurant merchant grocery access',
    selfDeclared.status === 403 && selfDeclared.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: selfDeclared.status, code: selfDeclared.data.code });

  const pathTamper = await request('POST', `/api/grocery/orders/ord_x/packed-weight?merchantId=${A.uuid}&restaurantId=${A.uuid}`,
    { merchantId: A.uuid, itemId: 'line_1', packedWeight: 1 }, tok(B_T));
  assert('MES-14 a query or path id for an entitled merchant does not lend it entitlement',
    pathTamper.status === 403 && pathTamper.data.code === 'MERCHANT_TYPE_MISMATCH',
    { s: pathTamper.status, code: pathTamper.data.code });

  // Refused writes must have written nothing.
  const BShelf = await store.from('merchant_grocery_inventory')
    .select('id', { count: 'exact', head: true }).eq('merchant_id', B.uuid);
  assert('MES-15 the refused grocery writes left no inventory row for the restaurant merchant',
    !BShelf.error && (BShelf.count || 0) === 0, { count: BShelf.count, err: BShelf.error });

  const BEntRow = await store.from('merchants').select('merchant_type').eq('id', B.uuid).maybeSingle();
  assert('MES-16 the entitlements asserted here are the stored ones, not a fixture assumption',
    !BEntRow.error && BEntRow.data && BEntRow.data.merchant_type === 'RESTAURANT',
    { row: BEntRow.data, err: BEntRow.error });

  // =============================== 8. environment gating ===============================
  // The children answer questions about the identities this suite minted, so those ids travel to
  // them through the environment. A child cannot mint its own without changing what is asserted:
  // MCY-03 asks whether the number the parent authenticated with resolves to the parent's store.
  const fixtureEnv = {
    NABIN_MCH_A_PHONE: A.phone, NABIN_MCH_A_ID: A.uuid,
    NABIN_MCH_B_PHONE: B.phone, NABIN_MCH_B_ID: B.uuid,
  };

  const prod = spawnChild('production_no_merchant_for_phone', Object.assign({
    NODE_ENV: 'production',
    SUPABASE_POSTGRES_LIVE: 'true',
    NABIN_TEST_MODE: 'true', // must not re-open the door in production
  }, fixtureEnv));
  assert('MCY-01 in production an unregistered number cannot become the first seeded merchant',
    prod.threw === true && prod.assignedId == null,
    { threw: prod.threw, assignedId: prod.assignedId, code: prod.code, message: prod.message });

  const prodMedia = spawnChild('production_media_requires_token', {
    NODE_ENV: 'production',
    SUPABASE_POSTGRES_LIVE: 'true',
  });
  assert('MCY-02 in production a merchant media upload with no token is refused outright',
    prodMedia.requiredAuth === true,
    { requiredAuth: prodMedia.requiredAuth, message: prodMedia.message });

  const devPath = spawnChild('development_allows_registered_only', Object.assign({
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
  }, fixtureEnv));
  assert('MCY-03 the convenience path is confined to non-production, and registered numbers resolve to their own store in both',
    devPath.aResolvesToSelf === true && devPath.bResolvesToSelf === true,
    { a: devPath.aId, b: devPath.bId, message: devPath.message });

  await done();
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'merchant_operations_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_MCH_CHILD: scenario, ...env },
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch (e) { /* reported as a failed check below */ }
  return { threw: true, code: 'CHILD_SILENT', message: `${res.stdout || ''} ${res.stderr || ''}`.slice(0, 300) };
}

async function runChild(scenario) {
  const db = require('./src/database');
  const out = { scenario };

  if (scenario === 'production_no_merchant_for_phone') {
    // The exact question `database.js` answers with `restaurants[0]` outside production:
    // can an unregistered number ever be attached to a real store while running as production?
    try {
      const r = await db.verifyAuthOtp({ phone: '9899900123', otp: '7729', role: 'MERCHANT', purpose: 'LOGIN' });
      out.threw = false;
      out.assignedId = r && r.user && r.user.id;
      out.tokenIssued = Boolean(r && r.token);
    } catch (err) {
      out.threw = true;
      out.code = err && err.code;
      out.message = err && err.message;
      out.assignedId = null;
    }
  } else if (scenario === 'production_media_requires_token') {
    // The route's own gate, evaluated in production: does it demand authentication?
    const { allowsTestConvenience } = require('./src/services/RuntimeMode');
    out.convenienceAllowed = allowsTestConvenience('merchant media upload without a token');
    out.requiredAuth = out.convenienceAllowed === false;
  } else {
    // Registered numbers resolve to their own store, never to a shared one. The fixed code is
    // accepted here only because this child runs in development; MCY-01 pins the production
    // behaviour separately rather than relying on this branch.
    const a = await db.verifyAuthOtp({ phone: A.phone, otp: '7729', role: 'MERCHANT', purpose: 'LOGIN' });
    const b = await db.verifyAuthOtp({ phone: B.phone, otp: '7729', role: 'MERCHANT', purpose: 'LOGIN' });
    const aId = a && a.user && String(a.user.uuid || a.user.id);
    const bId = b && b.user && String(b.user.uuid || b.user.id);
    out.aId = aId; out.bId = bId;
    out.aResolvesToSelf = aId === A.uuid;
    out.bResolvesToSelf = bId === B.uuid;
    out.distinct = aId !== bId;
  }

  console.log(JSON.stringify(out));
}

/**
 * Remove the rows this file minted, prove they went, then report.
 *
 * The residue question is answered by id and by the phones allocated for them - never by "looks
 * like test data", which would reach into another suite's rows. The phones are counted as well as
 * the recorded ids because the store can mint a row this suite never asked for: `/api/auth/verify-otp`
 * auto-registers an account for a phone shape it does not already have, and that id is not in the
 * registry. And the KDS ticket is in scope because a booked order creates one under an id no
 * caller ever sees - which is exactly how twelve of them used to survive a chain run.
 */
async function done() {
  if (fx) {
    const handle = fx;
    fx = null;
    const contextIds = handle.created.merchants.concat(handle.created.users);
    const phoneKeys = handle.created.phones.map((p) => String(p || '').replace(/\D/g, '').slice(-10));
    let out = null;
    let cleanupError = null;
    try {
      out = await handle.cleanup();
    } catch (e) {
      cleanupError = e;
    }
    const blocked = (out && out.blocked) || [];
    const removed = Object.assign({}, out || {});
    delete removed.blocked;
    console.log(`  fixture cleanup: removed=${JSON.stringify(removed)} blocked=${JSON.stringify(blocked)}`);
    let residue = null;
    try {
      residue = (await handle.query(
        `SELECT (SELECT count(*) FROM users WHERE id = ANY($1::uuid[]) OR right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($2::text[]))::text u,
                (SELECT count(*) FROM merchants WHERE id = ANY($1::uuid[]))::text m,
                (SELECT count(*) FROM orders WHERE customer_id = ANY($1::uuid[]) OR merchant_id = ANY($1::uuid[]))::text o,
                (SELECT count(*) FROM restaurant_kds_tickets WHERE merchant_id = ANY($1::uuid[]))::text k,
                (SELECT count(*) FROM grocery_price_history WHERE merchant_id = ANY($1::uuid[]))::text h,
                (SELECT count(*) FROM backend_sessions WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($2::text[]))::text s`,
        [contextIds, phoneKeys])).rows[0];
    } catch (e) {
      residue = { error: String(e.message).slice(0, 160) };
    }
    assert('MCFX-01 every merchant, customer, order, KDS ticket, price-history and session row this suite minted is gone again',
      !cleanupError && !!residue && !residue.error
      && ['u', 'm', 'o', 'k', 'h', 's'].every((key) => Number(residue[key]) === 0)
      && blocked.length === 0,
      { residue, blocked, error: cleanupError && cleanupError.message });
    try { await handle.client.end(); } catch (e) { /* the client is already down */ }
  }
  finish();
}

function mainCrash(err) {

  console.error('Unexpected error:', err);
  failed.push('HARNESS');
  done().catch(() => finish());
}

function finish() {
  console.log(`\nMERCHANT SECURITY: ${passed.length} PASSED, ${failed.length} FAILED, ${skipped.length} SKIPPED`);
  if (failed.length) console.log('Failed: ' + failed.join(' | '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}

// `PG_TARGET` is exported so `chain_runner_guard_test.js` can prove by REQUIRING this suite which
// store it resolves to, instead of asserting from the text of a line. The exported value is a view —
// host, port, database and the key or file that declared it — never `PG_TARGET.connectionString`, so
// reading a suite's target cannot hand a guard the password that target is connected with.
const PG_TARGET_VIEW = {
  source: PG_TARGET.source, host: PG_TARGET.host, port: PG_TARGET.port, database: PG_TARGET.database,
};
module.exports = { request, login, tok, uniq, orderRow, productRow, sameRow, assert, A, B, REST_LEGACY, finish, PG_TARGET: PG_TARGET_VIEW };

if (require.main === module) {
  if (process.env.NABIN_MCH_CHILD) {
    runChild(process.env.NABIN_MCH_CHILD).catch((err) => {
      console.log(JSON.stringify({ threw: true, code: 'CHILD_CRASHED', message: err.message }));
      process.exit(3);
    });
  } else {
    main().catch(mainCrash);
  }
}
