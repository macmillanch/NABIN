'use strict';

// =========================================================================
// ADMIN DATA TRUTHFULNESS — P9 §2 (two narrow admin-data defects)
//
// A. GET /api/admin/master-catalog/:id/stores
//   `getMasterProductStoreMatrix` reads the durable `merchant_grocery_inventory`
//   rows and embeds their merchant as `merchants(id, name)` — the address column
//   is NOT in that embed. So `merchant.address` is always undefined on the
//   PostgreSQL branch and `merchantAddress: merchant.address || 'DarkStore
//   Location'` reported the fabricated literal for every store, while
//   `merchants.address` (migration 001:77, TEXT NOT NULL) actually holds a real
//   durable value. The fix selects the real address and returns it; it never
//   invents one — if a row genuinely has no address the field is omitted, not
//   defaulted to a made-up place.
//
// B. GET /api/admin/grocery/price-alerts
//   `getUnusualPriceAlerts` scans the process-memory mirror
//   `this.groceryPriceHistory`, which is boot-seeded (database.js:1490) plus
//   this-process `adminReviewPrice` unshifts (:6181). It is never hydrated from
//   the durable `grocery_price_history` table, and the only durable read that
//   exists (`getMerchantPriceHistory` :5692) is merchant-scoped, not an admin
//   cross-tenant scan. The route answered `{success, count, alerts}` with no
//   source label, so a stale mirror looked like a current authoritative feed.
//   The fix labels it honestly with `dataSource:'memory'` and `degraded:true` —
//   the established vocabulary (`listAdminJobs`, `listAdminRestaurants`) — and
//   makes no PostgreSQL-backed claim it cannot support.
//
// Deliberately NOT changed here: authorization. Both routes keep exactly the
// guards they have (`authenticateAdmin`, no permission gate). Widening or
// inventing role grants is issue #273 and stays an owner decision.
//
// Runs only on the disposable isolated lane (`scripts/with_local_target.js`,
// `scripts/lane_check.js`). It refuses a non-loopback target before any socket
// opens, so it can never write a hosted project. Fixtures are inserted with the
// privileged role into the lane schema; teardown deletes exactly the identifiers
// this run minted.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'admin_data_truthfulness_test' });

const STAMP = Date.now();
const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(name);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

const FABRICATED_ADDRESS = 'DarkStore Location';
const FIXTURE_ADDRESS = `P9A fixture lane ${STAMP}, test district`;

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, raw: data }); } });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function bootServer({ port, request, attempts = 180, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0' },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; } catch { /* not up yet */ }
  }
  return proc;
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', { bootstrapSecret: BOOTSTRAP_SECRET, username: ADMIN_USER, password: ADMIN_PASSWORD, name: 'Admin Data Truthfulness Bootstrap Admin' });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

let pg = null;
async function countOf(table) {
  const r = await pg.query(`select count(*)::int as n from ${table}`);
  return r.rows[0].n;
}

const createdMerchantIds = [];
const createdProductIds = [];

async function insertMerchantAndInventory() {
  const m = await pg.query(
    `insert into merchants (name, merchant_type, phone, address, lat, lng, is_open)
     values ($1,'GROCERY',$2,$3,28.6200000,77.2200000,true)
     returning id, name, address`, [`P9A Fixture Store ${STAMP}`, `+91 91${String(STAMP).slice(-8)}`, FIXTURE_ADDRESS]);
  createdMerchantIds.push(m.rows[0].id);
  const p = await pg.query(
    `insert into master_grocery_catalog (name, category, subcategory, brand, standard_unit, pack_size, standard_image_url, pricing_model, is_active)
     values ($1,'Grocery','Fixture','P9A Select','kg','1 kg','https://fixtures.invalid/p9a.png','FIXED_PRICE',true)
     returning id, name`, [`P9A Fixture Product ${STAMP}`]);
  createdProductIds.push(p.rows[0].id);
  await pg.query(
    `insert into merchant_grocery_inventory (merchant_id, product_id, store_price, stock_quantity, is_available, status)
     values ($1,$2,42.50,7,true,'AVAILABLE')`, [m.rows[0].id, p.rows[0].id]);
  return { merchant: m.rows[0], product: p.rows[0] };
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN ADMIN DATA TRUTHFULNESS TEST — P9 §2');
  const masked = (() => { try { const u = new URL(PG_TARGET.connectionString); return `${u.protocol}//${u.hostname}:${u.port}/${u.database}`; } catch { return '(masked)'; } })();
  console.log(`  TARGET : ${masked} (loopback, proven by scripts/chain_target_guard.js)`);
  console.log(`  SUITE  : STAMP=${STAMP}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  const request = makeRequest(base);
  const proc = await bootServer({ port, request });
  const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('S0 the lane backend is up', health.status === 200, { status: health.status });
  const admin = await mintAdmin({ request });
  assert('S1 an admin session is minted', Boolean(admin.token), { status: admin.status, body: admin.body });

  const baseline = {
    merchants: await countOf('merchants'),
    products: await countOf('master_grocery_catalog'),
    inventory: await countOf('merchant_grocery_inventory'),
    priceHistory: await countOf('grocery_price_history'),
  };
  console.log(`  durable baselines: ${JSON.stringify(baseline)}`);

  // =====================================================================
  // GROUP A — the store matrix reports the real durable merchant address
  // =====================================================================
  console.log('\n--- GROUP A: /api/admin/master-catalog/:id/stores address is durable, never invented ---');
  const { merchant: fxMerchant, product: fxProduct } = await insertMerchantAndInventory();
  assert('A0 the fixture merchant/inventory/product are durable', Boolean(fxMerchant && fxMerchant.id && fxProduct && fxProduct.id), { fxMerchant, fxProduct });

  const matrixRes = await request('GET', `/api/admin/master-catalog/${fxProduct.id}/stores`, null, bearer(admin.token));
  assert('A1 GET the store matrix answers 200 with success', matrixRes.status === 200 && matrixRes.data && matrixRes.data.success === true, { status: matrixRes.status, data: matrixRes.data });
  const stores = (matrixRes.data && matrixRes.data.stores) || [];
  const served = stores.find((s) => String(s.merchantId) === String(fxMerchant.id));
  assert('A2 the fixture store row is served for the product', Boolean(served), { product: fxProduct.id, servedCount: stores.length });
  assert('A3 the served store name is the durable merchant name', Boolean(served) && served.merchantName === fxMerchant.name, { served: served && served.merchantName, durable: fxMerchant.name });
  assert('A4 the served store address is the real durable merchants.address value',
    Boolean(served) && served.merchantAddress === FIXTURE_ADDRESS,
    { served: served && served.merchantAddress, durable: FIXTURE_ADDRESS });
  assert('A5 no served store carries the fabricated "DarkStore Location" literal',
    !stores.some((s) => s.merchantAddress === FABRICATED_ADDRESS),
    { fabricated: stores.filter((s) => s.merchantAddress === FABRICATED_ADDRESS).map((s) => s.merchantId) });
  assert('A6 the durable price and stock are served as themselves',
    Boolean(served) && Number(served.currentPrice) === 42.5 && Number(served.stockQty) === 7 && served.isAvailable === true,
    { served: served && { currentPrice: served.currentPrice, stockQty: served.stockQty, isAvailable: served.isAvailable } });

  const noToken = await request('GET', `/api/admin/master-catalog/${fxProduct.id}/stores`);
  assert('A7 the guard on this read is unchanged: no bearer is refused', noToken.status === 401 || noToken.status === 403, { status: noToken.status });

  // =====================================================================
  // GROUP B — the price-alert feed declares its memory source honestly
  // =====================================================================
  console.log('\n--- GROUP B: /api/admin/grocery/price-alerts declares dataSource:memory + degraded ---');
  const alertsRes = await request('GET', '/api/admin/grocery/price-alerts', null, bearer(admin.token));
  const alertsBody = alertsRes.data || {};
  assert('B1 GET the price alerts answers 200 with success', alertsRes.status === 200 && alertsBody.success === true, { status: alertsRes.status, data: alertsBody });
  assert('B2 the feed states where it came from', typeof alertsBody.dataSource === 'string' && alertsBody.dataSource.length > 0, { dataSource: alertsBody.dataSource });
  assert('B3 that source is the in-memory mirror, not a PostgreSQL claim',
    alertsBody.dataSource === 'memory', { dataSource: alertsBody.dataSource });
  assert('B4 a boot-time mirror is declared degraded', alertsBody.degraded === true, { degraded: alertsBody.degraded });
  assert('B5 the alerts are still an array and the count matches them',
    Array.isArray(alertsBody.alerts) && alertsBody.count === alertsBody.alerts.length,
    { count: alertsBody.count, length: Array.isArray(alertsBody.alerts) ? alertsBody.alerts.length : null });

  const alertsNoToken = await request('GET', '/api/admin/grocery/price-alerts');
  assert('B6 the guard on this read is unchanged: no bearer is refused', alertsNoToken.status === 401 || alertsNoToken.status === 403, { status: alertsNoToken.status });

  // =====================================================================
  // GROUP C — only this run\'s own rows were written
  // =====================================================================
  console.log('\n--- GROUP C: the fixtures are this run\'s only footprint ---');
  const merchantsNow = await countOf('merchants');
  const productsNow = await countOf('master_grocery_catalog');
  const inventoryNow = await countOf('merchant_grocery_inventory');
  const priceHistoryNow = await countOf('grocery_price_history');
  assert('C1 exactly the merchants this run named appeared', merchantsNow === baseline.merchants + createdMerchantIds.length, { merchantsNow, baseline: baseline.merchants, created: createdMerchantIds.length });
  assert('C2 exactly the catalogue rows this run named appeared', productsNow === baseline.products + createdProductIds.length, { productsNow, baseline: baseline.products, created: createdProductIds.length });
  assert('C3 exactly one inventory link was written', inventoryNow === baseline.inventory + 1, { inventoryNow, baseline: baseline.inventory });
  assert('C4 this suite wrote no grocery price-history row', priceHistoryNow === baseline.priceHistory, { priceHistoryNow, baseline: baseline.priceHistory });

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
  if (failed.length) { console.log('Failed checks:'); for (const n of failed) console.log(`  - ${n}`); }
  console.log(`ADMIN DATA TRUTHFULNESS TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    // Inventory cascades from both merchants and master_grocery_catalog, so removing
    // the merchant and the product this run minted removes its inventory link too.
    if (createdMerchantIds.length) {
      await pg.query('delete from merchant_grocery_inventory where merchant_id = any($1::uuid[])', [createdMerchantIds]);
      await pg.query('delete from merchants where id = any($1::uuid[])', [createdMerchantIds]);
    }
    if (createdProductIds.length) {
      await pg.query('delete from merchant_grocery_inventory where product_id = any($1::uuid[])', [createdProductIds]);
      await pg.query('delete from master_grocery_catalog where id = any($1::uuid[])', [createdProductIds]);
    }
    const leftM = await pg.query('select count(*)::int as n from merchants where id = any($1::uuid[])', [createdMerchantIds]);
    const leftP = await pg.query('select count(*)::int as n from master_grocery_catalog where id = any($1::uuid[])', [createdProductIds]);
    console.log(`[cleanup] this run's merchant rows still present: ${leftM.rows[0].n}, catalogue rows still present: ${leftP.rows[0].n}`);
  } catch (e) {
    console.error('[CLEANUP FAILED] residue may remain:', e.message);
  }
  try { await pg.end(); } catch { /* already closed */ }
}

async function run() {
  try { await main(); }
  catch (err) { console.error('[FATAL] admin_data_truthfulness_test threw outside the assertion harness:', err); process.exitCode = 1; }
  finally { await cleanup(); }
  process.exit(process.exitCode || 0);
}

run();
