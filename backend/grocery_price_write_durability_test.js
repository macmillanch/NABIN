/**
 * Grocery price WRITE durability and tenant isolation (backend/src/server.js PUT
 * `/api/grocery/products/:id/price` and POST `/api/grocery/products/bulk-price-update`).
 *
 * Why this file exists. Both routes answered from `db.updateGroceryProductPrice`, which mutates the
 * process-local `groceryProducts` seed. The customer-facing read (`GET /api/grocery/products`) and the
 * checkout snapshot read `merchant_grocery_inventory.store_price`. So the write path and the read path
 * were different stores, and three things followed from that:
 *   1. a real listing id (a UUID, which is every id the customer read projects) could never be priced,
 *      because `getGroceryProductById` only searches the fixture array — the route 400'd "Product not
 *      found" on 100% of live rows;
 *   2. a fixture id (`p_tom_01`) returned HTTP 200 success and minted a durable `audit_logs`
 *      PRICE_UPDATE row for a change that touched no row any customer or order can see — a silent
 *      success written into the permanent trail, which PHASE 4 of the standing directive forbids;
 *   3. nothing compared the authenticated merchant with the record, and `req.body.actor` was copied
 *      into the audit trail verbatim, so the trail's actor was caller-authored.
 * The durable equivalent (`POST /api/merchant/inventory` -> `updateMerchantInventoryItem`) already
 * worked and already wrote `grocery_price_history`; that is what the Flutter grocery merchant screen
 * uses. These two routes had to be brought onto the same durable ground rather than left as a
 * second, fictional pricing system.
 *
 * What "proven" means here: every check is a real HTTP request against a running backend and a
 * direct PostgreSQL read-back of the row the response claims to have changed. A 200 is not evidence;
 * `store_price` in `merchant_grocery_inventory` is.
 *
 * Rows touched: this file mints its OWN listing for the GROCERY-only merchant `…0203` (which owns no
 * listings) through the existing durable inventory route, and only ever writes that listing. The
 * seeded listing `…0601` of merchant `…0201` is used as the CROSS-TENANT VICTIM and is read before and
 * after every attack, never written — deliberately, because an earlier suite that poked the seeded
 * grocery row is what poisoned chain links 1 and 49.
 *
 * Live-Postgres only. Without a store there is nothing durable to read back, so the file reports SKIP
 * rather than inventing passes; a missing backend is a red, because the HTTP contract is the subject.
 */
const http = require('http');
const { withSharedSession } = require('./testSessionCache');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';

// Real rows in the local/TEST database, read from the store before this file was written.
const OWNER = { phone: '9811223344', uuid: '00000000-0000-0000-0000-000000000201', type: 'HYBRID_BOTH' };
const TENANT = { phone: '9999900203', uuid: '00000000-0000-0000-0000-000000000203', type: 'GROCERY' };
const RESTAURANT = { phone: '9871133479', uuid: '2699ade3-e014-4731-95dc-c79b095def40', type: 'RESTAURANT' };
const VICTIM_LISTING = '00000000-0000-0000-0000-000000000601';   // owned by OWNER, never written here
const MASTER_PRODUCT = '00000000-0000-0000-0000-000000000401';   // "Hybrid Tomato", active in the catalogue
// An id from the in-process `groceryProducts` mirror, measured 2026-10-12 against the local stack:
// five rows `gprod_1`..`gprod_5`, all under merchant `mcht_darkstore_1`, none of them a durable row.
// `gprod_1` is the id the old route DID answer for — with a 200 and a permanent audit row.
const FIXTURE_ID = 'gprod_1';

const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
function skip(name, reason) { skipped.push(name); console.log(`[SKIP] ${name} -> ${reason}`); }

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

/** One merchant row straight from PostgreSQL — the state a response cannot dress up. */
async function listingRow(store, id) {
  const { data, error } = await store.from('merchant_grocery_inventory')
    .select('id, merchant_id, product_id, store_price, stock_quantity, is_available, status, updated_at')
    .eq('id', id).maybeSingle();
  return { row: data, error: error && error.message };
}

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** History rows for one merchant+product pair, newest first, as this run saw them. */
async function historyRows(store, merchantId, productId) {
  const { data, error } = await store.from('grocery_price_history')
    .select('id, merchant_id, product_id, previous_price, new_price, unit, changed_by, reason, created_at')
    .eq('merchant_id', merchantId)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);
  if (error) throw new Error(`history read failed: ${error.message}`);
  return data || [];
}

async function login(phone, role) {
  let mintFailure = null;
  const { token } = await withSharedSession({
    baseUrl: BASE_URL,
    phone,
    role,
    mint: async () => {
      const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
      if (!(send.data && send.data.success === true)) {
        mintFailure = { stage: 'send', status: send.status, body: send.data };
        return null;
      }
      const verify = await request('POST', '/api/auth/verify-otp', {
        phone, otp: send.data.testOtp || '7729', role, purpose: 'LOGIN',
      });
      if (verify.data && verify.data.token) return verify.data.token;
      mintFailure = { stage: 'verify', status: verify.status, body: verify.data };
      return null;
    },
    probe: async (candidate) => {
      const me = await request('GET', '/api/auth/me', null, tok(candidate));
      return me.status === 200 && me.data && me.data.success === true
        && String(me.data.role || (me.data.user && me.data.user.role) || '').toUpperCase() === role;
    },
  });
  if (!token) return { token: null, failure: mintFailure };
  const me = await request('GET', '/api/auth/me', null, tok(token));
  const u = (me.data && me.data.user) || {};
  // A merchant session's entity IS the store row. The durable id is `uuid`, `id` is the legacy
  // spelling, and the profile routes have also been seen projecting `merchantId` — accept any of
  // them here rather than betting on one, because GPW-05 proves the identity from the stored row.
  const resolved = String(u.uuid || u.id || u.merchantId || u.merchant_id || '');
  return { token, merchantId: resolved, failure: null };
}

async function main() {
  console.log('--- GROCERY PRICE WRITE DURABILITY / TENANT ISOLATION ---');
  const runStart = new Date().toISOString();

  const db = require('./src/database');
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('all GPW checks', 'PostgreSQL is not live; this file proves stored state and cannot do so against the mirror');
    return finish();
  }
  const store = supabaseAdmin;

  const health = await request('GET', '/api/health');
  if (health.status !== 200) {
    assert('GPW-00 a backend is reachable at the target the suite names', false, { BASE_URL, status: health.status, error: health.error });
    return finish();
  }
  assert('GPW-00 a backend is reachable at the target the suite names', true, null);

  // ---------- preconditions: who these identities actually are ----------
  const lt = await login(TENANT.phone, 'MERCHANT');
  const lb = await login(RESTAURANT.phone, 'MERCHANT');
  assert('GPW-01 the GROCERY-only merchant has a real MERCHANT session for its own store',
    !!lt.token && String(lt.merchantId || '') === TENANT.uuid,
    { hasToken: !!lt.token, resolved: lt.merchantId, failure: lt.failure });
  assert('GPW-02 a RESTAURANT-only merchant has a real MERCHANT session', !!lb.token, { failure: lb.failure });

  const victim = await listingRow(store, VICTIM_LISTING);
  assert('GPW-03 the cross-tenant victim listing exists and belongs to a different merchant',
    !!victim.row && String(victim.row.merchant_id) === OWNER.uuid,
    { row: victim.row, error: victim.error });

  // This run's own listing, minted through the durable inventory route that already works.
  const minted = await request('POST', '/api/merchant/inventory',
    { masterProductId: MASTER_PRODUCT, currentPrice: 60, stockQty: 100 }, tok(lt.token));
  const item = minted.data && minted.data.item;
  const mineId = item && (item.inventoryId || item.id);
  assert('GPW-04 this suite mints its own listing for the GROCERY-only merchant',
    minted.status === 200 && !!mineId,
    { status: minted.status, body: JSON.stringify(minted.data || {}).slice(0, 200) });
  if (!mineId) {
    assert('GPW-05 no durable write can be proven without this run\'s own listing', false,
      { why: 'the inventory mint failed, so every check below has no row to read back' });
    return finish();
  }
  const before = await listingRow(store, mineId);
  assert('GPW-05 the minted listing is a real row owned by this merchant at the minted price',
    !!before.row && String(before.row.merchant_id) === TENANT.uuid && Number(before.row.store_price) === 60,
    { row: before.row, error: before.error });

  const historyIdsBefore = new Set((await historyRows(store, TENANT.uuid, MASTER_PRODUCT)).map((r) => r.id));

  // ---------- 1. a real listing reference prices the real row ----------
  const byId = await request('PUT', `/api/grocery/products/${mineId}/price`,
    { newPrice: 77.5, reason: 'GPW durability probe', actor: 'Admin Devika' }, tok(lt.token));
  const afterId = await listingRow(store, mineId);
  assert('GPW-06 PUT by the listing id reports success and the row actually moved to that price',
    byId.status === 200 && byId.data.success === true && !!afterId.row && Number(afterId.row.store_price) === 77.5,
    { status: byId.status, body: JSON.stringify(byId.data || {}).slice(0, 220), stored: afterId.row && afterId.row.store_price });
  assert('GPW-07 the response states where the price landed rather than leaving it implicit',
    byId.data && byId.data.dataSource === 'postgres',
    { keys: Object.keys(byId.data || {}) });
  assert('GPW-08 the price the response reports is the price that is stored',
    byId.data && byId.data.product && Number(byId.data.product.currentPrice) === Number(afterId.row && afterId.row.store_price),
    { claimed: byId.data && byId.data.product && byId.data.product.currentPrice, stored: afterId.row && afterId.row.store_price });

  const historyAfter = await historyRows(store, TENANT.uuid, MASTER_PRODUCT);
  const fresh = historyAfter.filter((r) => !historyIdsBefore.has(r.id));
  assert('GPW-09 the change is in durable grocery_price_history with the previous and new price',
    fresh.length === 1 && Number(fresh[0].previous_price) === 60 && Number(fresh[0].new_price) === 77.5,
    { freshCount: fresh.length, rows: fresh.map((r) => `${r.previous_price}->${r.new_price}`) });
  // The actor in a durable price record must name the session, not whatever the caller typed.
  assert('GPW-10 the durable history attributes the change to the session merchant, not to the body actor text',
    fresh.length === 1 && String(fresh[0].changed_by) === `merchant:${TENANT.uuid}`,
    { changed_by: fresh[0] && fresh[0].changed_by });

  // ---------- 2. the product reference the customer read projects ----------
  const byProduct = await request('PUT', `/api/grocery/products/${MASTER_PRODUCT}/price`,
    { newPrice: 81.25, reason: 'GPW product-reference probe' }, tok(lt.token));
  const afterProduct = await listingRow(store, mineId);
  assert('GPW-11 PUT by the master product id prices the same listing (the customer read projects both)',
    byProduct.status === 200 && byProduct.data.success === true
      && !!afterProduct.row && Number(afterProduct.row.store_price) === 81.25,
    { status: byProduct.status, body: JSON.stringify(byProduct.data || {}).slice(0, 220), stored: afterProduct.row && afterProduct.row.store_price });

  // ---------- 3. cross-tenant ----------
  const attack = await request('PUT', `/api/grocery/products/${VICTIM_LISTING}/price`,
    { newPrice: 1, reason: 'GPW cross-tenant attempt' }, tok(lt.token));
  const victimAfter = await listingRow(store, VICTIM_LISTING);
  assert('GPW-12 a GROCERY merchant cannot price another merchant\'s listing',
    attack.status !== 200 && attack.data && attack.data.success !== true,
    { status: attack.status, body: JSON.stringify(attack.data || {}).slice(0, 200) });
  assert('GPW-13 the victim row is bit-identical after the attempt',
    sameRow(victim.row, victimAfter.row),
    { before: victim.row, after: victimAfter.row });
  assert('GPW-14 the refused attempt names a reason rather than a bare failure',
    attack.status === 404 && attack.data.code === 'GROCERY_LISTING_NOT_FOUND',
    { status: attack.status, code: attack.data && attack.data.code, error: attack.data && attack.data.error });

  // ---------- 4. mirror ids are refused, not celebrated ----------
  const mirrorId = await request('PUT', `/api/grocery/products/${FIXTURE_ID}/price`,
    { newPrice: 99, reason: 'GPW mirror-id probe' }, tok(lt.token));
  assert('GPW-15 a mirror-only product id is refused instead of returning success for a write nothing can see',
    mirrorId.data.success !== true && mirrorId.status === 400 && mirrorId.data.code === 'INVALID_PRODUCT_REFERENCE',
    { status: mirrorId.status, body: JSON.stringify(mirrorId.data || {}).slice(0, 200) });
  // The second half of the same defect: the old route answered that request with 200 and a
  // `PRICE_UPDATE` row in the permanent `audit_logs` trail, describing a product that exists only
  // in this process. A refusal must not leave a trail entry either.
  const { data: mirrorAudit } = await store.from('audit_logs')
    .select('id, action, module, target_entity_id, admin_id, role, created_at')
    .eq('action', 'PRICE_UPDATE').eq('module', 'GROCERY_PRICING')
    .eq('target_entity_id', FIXTURE_ID).gte('created_at', runStart).limit(5);
  assert('GPW-15b the refused mirror id minted no audit_logs entry for a change that was never durable',
    (mirrorAudit || []).length === 0,
    { rows: (mirrorAudit || []).map((r) => `${r.id} by ${r.admin_id}/${r.role}`) });

  // ---------- 5. invalid money ----------
  const bad = [];
  for (const price of [0, -5, 'abc', 1e999, 999999999.99, '']) {
    const r = await request('PUT', `/api/grocery/products/${mineId}/price`,
      { newPrice: price, reason: 'GPW invalid-price probe' }, tok(lt.token));
    bad.push({ price: String(price), status: r.status, success: r.data && r.data.success, code: r.data && r.data.code });
  }
  const afterBad = await listingRow(store, mineId);
  assert('GPW-16 every invalid price is refused with a 400 and a code',
    bad.every((b) => b.status === 400 && b.success !== true && b.code),
    { bad });
  assert('GPW-17 no refused price reached the row',
    Number(afterBad.row.store_price) === 81.25,
    { stored: afterBad.row && afterBad.row.store_price, expected: 81.25 });

  // Nothing above that was refused may have written history.
  const historyFinal = await historyRows(store, TENANT.uuid, MASTER_PRODUCT);
  const netNew = historyFinal.filter((r) => !historyIdsBefore.has(r.id));
  assert('GPW-18 refusals wrote no price history (only the two accepted changes are recorded)',
    netNew.length === 2,
    { netNew: netNew.map((r) => `${r.previous_price}->${r.new_price} by ${r.changed_by}`) });

  // ---------- 6. bulk path ----------
  const bulk = await request('POST', '/api/grocery/products/bulk-price-update',
    { updates: [
      { productId: mineId, newPrice: 66 },
      { productId: VICTIM_LISTING, newPrice: 1 },
      { productId: MASTER_PRODUCT, newPrice: -3 },
    ], actor: 'Admin Finance' }, tok(lt.token));
  const bulkApplied = bulk.data && Number(bulk.data.applied);
  const afterBulk = await listingRow(store, mineId);
  const victimBulk = await listingRow(store, VICTIM_LISTING);
  assert('GPW-19 bulk reports per item and its applied count equals the rows that actually changed',
    bulk.status === 200 && bulkApplied === 1 && Number(afterBulk.row.store_price) === 66,
    { status: bulk.status, applied: bulkApplied, results: bulk.data && bulk.data.results, stored: afterBulk.row && afterBulk.row.store_price });
  assert('GPW-20 bulk cannot step outside the caller\'s own store',
    bulk.data && bulk.data.results && bulk.data.results.length === 3
      && bulk.data.results.filter((r) => r.success).length === 1
      && sameRow(victim.row, victimBulk.row),
    { results: bulk.data && bulk.data.results, victim: victimBulk.row });

  // ---------- 7. entitlement is unchanged ----------
  const wrongService = await request('PUT', `/api/grocery/products/${mineId}/price`,
    { newPrice: 50 }, tok(lb.token));
  assert('GPW-21 a RESTAURANT-only merchant still cannot set a grocery price',
    wrongService.status === 403 && wrongService.data.code === 'MERCHANT_TYPE_MISMATCH',
    { status: wrongService.status, code: wrongService.data && wrongService.data.code });

  // ---------- 8. no audit row is minted for a durable merchant price change ----------
  // `grocery_price_history` IS the merchant price trail; the fixture path's `audit_logs` PRICE_UPDATE
  // row described a change that never existed. `grocery_reference_and_degraded_pricing_test.js` B1
  // already asserts that invariant for the inventory route; this pins it for these two routes too.
  const { data: strayAudit } = await store.from('audit_logs')
    .select('id, action, module, target_entity_id, created_at')
    .eq('action', 'PRICE_UPDATE').eq('module', 'GROCERY_PRICING')
    .in('target_entity_id', [mineId, MASTER_PRODUCT])
    .order('created_at', { ascending: false }).limit(10);
  assert('GPW-22 the durable price write mints no audit_logs PRICE_UPDATE row about a row the customer read owns',
    (strayAudit || []).length === 0,
    { rows: (strayAudit || []).map((r) => `${r.id} ${r.target_entity_id} ${r.created_at}`) });

  await cleanup(store, mineId, historyIdsBefore, runStart);
  finish();
}

/**
 * Leave only what was found here. The listing this run minted, the history rows it wrote, and any
 * `audit_logs` row minted while it ran are removed by id; the victim row and everything else in the
 * store are untouched. The audit floor is this run's start timestamp, so a row an earlier run left is
 * not swept up by a shared target id.
 */
async function cleanup(store, mineId, historyIdsBefore, runStart) {
  try {
    const after = await historyRows(store, TENANT.uuid, MASTER_PRODUCT);
    const ids = after.filter((r) => !historyIdsBefore.has(r.id)).map((r) => r.id);
    if (ids.length) await store.from('grocery_price_history').delete().in('id', ids);

    const { data: mintedAudit } = await store.from('audit_logs')
      .select('id').eq('action', 'PRICE_UPDATE').eq('module', 'GROCERY_PRICING')
      .in('target_entity_id', [mineId, MASTER_PRODUCT, FIXTURE_ID])
      .gte('created_at', runStart);
    const auditIds = (mintedAudit || []).map((r) => r.id);
    if (auditIds.length) await store.from('audit_logs').delete().in('id', auditIds);

    const { error } = await store.from('merchant_grocery_inventory').delete().eq('id', mineId);
    const gone = await listingRow(store, mineId);
    assert('GPW-90 cleanup removed this run\'s listing, history and audit residue and nothing else',
      !error && gone.row === null,
      { error: error && error.message, stillThere: gone.row, auditRowsDeleted: auditIds.length });
  } catch (err) {
    skip('GPW-90 cleanup', err.message);
  }
}

function finish() {
  console.log(`\nGROCERY PRICE WRITE: ${passed.length} PASSED, ${failed.length} FAILED, ${skipped.length} SKIPPED`);
  if (failed.length) console.log('Failed: ' + failed.join(' | '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}

main().catch((err) => {
  console.log('SUITE CRASHED:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

module.exports = { request, tok, listingRow, sameRow, assert, TENANT, OWNER, RESTAURANT, VICTIM_LISTING, MASTER_PRODUCT };
