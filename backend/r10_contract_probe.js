/**
 * R10 contract probe — READ-MOSTLY, one deliberate mutation that is restored.
 *
 * Answers the five questions the brief asks before any UI code:
 *   1. Which read is authoritative for a restaurant merchant's own dish rows?
 *   2. Does POST /api/merchant/:restaurantId/menu/:itemId/toggle survive a fresh read,
 *      and does it survive a read made DIRECTLY against PostgreSQL (i.e. is it durable,
 *      or is it only this server process remembering)?
 *   3. Does POST .../menu/:itemId/photo persist anything, and does products.image_url move?
 *   4. Can a RESTAURANT merchant reach ANY persistent write on `products` at all?
 *   5. Is ownership enforced, and does the client ever need to send a restaurant id?
 *
 * Local development backend only. No production data, no payment gateway, no trigger
 * bypass, no schema change. Run with: node r10_contract_probe.js   (from backend/)
 */
const http = require('http');
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const A = { phone: '9811223344', uuid: '00000000-0000-0000-0000-000000000201' };
const B = { phone: '9871133479', uuid: '2699ade3-e014-4731-95dc-c79b095def40' };

const log = (...a) => console.log(...a);
const line = (t) => log('\n================ ' + t + ' ================');

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const payload = body === null || body === undefined ? null : JSON.stringify(body);
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
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = { raw: data.slice(0, 200) }; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    if (payload) req.write(payload);
    req.end();
  });
}
const tok = (t) => ({ Authorization: `Bearer ${t}` });

async function login(phone, role) {
  const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
  if (!send.data || send.data.success !== true) return { token: null, failure: { stage: 'send', ...send } };
  const verify = await request('POST', '/api/auth/verify-otp', {
    phone, otp: send.data.testOtp || '7729', role, purpose: 'LOGIN',
  });
  return { token: verify.data && verify.data.token || null, failure: null, verify };
}

/** The row exactly as PostgreSQL holds it — the witness the server's own memory cannot influence. */
async function dbProduct(id) {
  if (!isLivePostgres || !supabaseAdmin) return { unavailable: true };
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('id, merchant_id, name, price, discount_price, is_available, image_url, updated_at')
    .eq('id', id)
    .maybeSingle();
  return error ? { error: error.message } : { row: data };
}

(async () => {
  line('0. TARGET PROOF');
  const health = await request('GET', '/api/health');
  log('host:', BASE_URL, '| db mode:', health.data && health.data.database && health.data.database.mode);
  log('isLivePostgres (this process, direct):', isLivePostgres);

  line('1. SESSION');
  const la = await login(A.phone, 'MERCHANT');
  if (!la.token) { log('MERCHANT A login FAILED', JSON.stringify(la.failure)); return; }
  log('merchant A session minted (no id sent by the client)');
  const services = await request('GET', '/api/merchant/services', null, tok(la.token));
  log('GET /api/merchant/services ->', services.status,
    JSON.stringify({
      merchantId: services.data.merchantId,
      services: services.data.services,
      profileName: services.data.profile && services.data.profile.name,
    }));

  line('2. READ: GET /api/merchant/catalog (authenticated, token-scoped)');
  const catalog = await request('GET', '/api/merchant/catalog', null, tok(la.token));
  const rows = (catalog.data && catalog.data.products) || [];
  log('status', catalog.status, '| keys', Object.keys(catalog.data || {}).join(','));
  log('count', catalog.data.count, '| merchantId', catalog.data.merchantId, '| degraded', catalog.data.degraded);
  if (!rows.length) { log('!! NO PRODUCTS for this merchant — probe stops for write tests'); return; }
  const first = rows[0];
  log('row field names:', Object.keys(first).join(','));
  log('row sample:', JSON.stringify(first));
  const nulls = Object.entries(first).filter(([, v]) => v === null).map(([k]) => k);
  log('columns that came back NULL:', nulls.join(',') || '(none)');

  line('3. READ: GET /api/restaurants/:id/menu (public customer projection of the same table)');
  const pubMenu = await request('GET', `/api/restaurants/${A.uuid}/menu`);
  log('status', pubMenu.status, '| keys', Object.keys(pubMenu.data || {}).join(','));
  log('count', pubMenu.data.count, '| dataSource', pubMenu.data.dataSource, '| degraded', pubMenu.data.degraded);
  log('projected item keys:', Object.keys((pubMenu.data.items || [])[0] || {}).join(','));
  log('projected item sample:', JSON.stringify((pubMenu.data.items || [])[0]));
  const byId = (pubMenu.data.items || []).find((i) => String(i.id) === String(first.id));
  log('same row present in both reads?', !!byId);

  const target = first;
  const targetId = String(target.id);

  line('4. WRITE: POST /api/merchant/:restaurantId/menu/:itemId/toggle');
  const before = { http: target.is_available, db: (await dbProduct(targetId)).row };
  log('BEFORE  http.is_available =', before.http, '| db.is_available =', before.db && before.db.is_available);
  const toggle = await request('POST', `/api/merchant/${A.uuid}/menu/${targetId}/toggle`,
    { inStock: !(target.is_available === true) }, tok(la.token));
  log('toggle ->', toggle.status, JSON.stringify(toggle.data).slice(0, 400));

  const afterHttp = await request('GET', '/api/merchant/catalog', null, tok(la.token));
  const afterRow = (afterHttp.data.products || []).find((p) => String(p.id) === targetId);
  const afterDb = await dbProduct(targetId);
  log('AFTER   fresh HTTP is_available =', afterRow && afterRow.is_available);
  log('AFTER   direct PostgreSQL is_available =', afterDb.row && afterDb.row.is_available);
  log('AFTER   db.updated_at moved?',
    before.db && afterDb.row ? String(before.db.updated_at) !== String(afterDb.row.updated_at) : 'n/a');
  const durable = !!(afterDb.row && afterRow && afterRow.is_available !== before.http
    && afterDb.row.is_available === afterRow.is_available);
  log('VERDICT toggle is durable:', durable);

  // Restore whatever the server believes, then confirm the DATABASE never moved.
  const restore = await request('POST', `/api/merchant/${A.uuid}/menu/${targetId}/toggle`,
    { inStock: before.http }, tok(la.token));
  log('restore ->', restore.status, 'inStock:', before.http);
  const finalDb = await dbProduct(targetId);
  log('FINAL   direct PostgreSQL is_available =', finalDb.row && finalDb.row.is_available,
    '(expected', before.db && before.db.is_available, ')');

  line('5. WRITE: POST /api/merchant/:restaurantId/menu/:itemId/photo');
  const tiny = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64').toString('base64');
  const photo = await request('POST', `/api/merchant/${A.uuid}/menu/${targetId}/photo`,
    { fileData: `data:image/png;base64,${tiny}`, mimeType: 'image/png' }, tok(la.token));
  log('photo (own store, real item) ->', photo.status, JSON.stringify(photo.data).slice(0, 300));
  const photoNoStore = await request('POST', `/api/merchant/menu/${targetId}/photo`,
    { fileData: `data:image/png;base64,${tiny}`, mimeType: 'image/png' }, tok(la.token));
  log('photo (id-less alias) ->', photoNoStore.status, JSON.stringify(photoNoStore.data).slice(0, 300));
  const imgAfter = await dbProduct(targetId);
  log('db.image_url after photo attempts =', imgAfter.row && imgAfter.row.image_url);
  const anon = await request('POST', `/api/merchant/${A.uuid}/menu/${targetId}/photo`, { fileData: 'x' });
  log('photo with NO token ->', anon.status, JSON.stringify(anon.data).slice(0, 200));

  line('6. OWNERSHIP: merchant A writing on merchant B\'s store id');
  const foreign = await request('POST', `/api/merchant/${B.uuid}/menu/${targetId}/toggle`,
    { inStock: false }, tok(la.token));
  log('A toggles under B\'s store id ->', foreign.status, foreign.data.code || foreign.data.error);

  line('7. IS THERE ANY PERSISTENT WRITE A RESTAURANT MERCHANT CAN REACH?');
  // Every probe below names an id that cannot exist (`PROBE_R10_ABSENT`), so a route that IS
  // wired can only fail validation — it can never touch a real row. What is being measured is
  // whether the ROUTE EXISTS (a 4xx from the handler) or not at all (Express' own 404 page,
  // which arrives as non-JSON and shows up here as `no-route`). The merchant's own profile
  // PATCH is deliberately NOT probed: it is a durable write and a stray body would erase the
  // cuisines this restaurant declared.
  const ABSENT = 'PROBE_R10_ABSENT';
  const probes = [
    ['PUT', `/api/grocery/products/${ABSENT}/price`, { newPrice: 1, reason: 'r10 route-existence probe' }],
    ['POST', '/api/merchant/inventory', { masterProductId: ABSENT, currentPrice: 1, stockQty: 1 }],
    ['DELETE', `/api/merchant/inventory/${ABSENT}`, null],
    ['POST', '/api/merchant/menu', { name: ABSENT }],
    ['PATCH', `/api/merchant/menu/${ABSENT}`, { name: ABSENT }],
    ['PUT', `/api/merchant/menu/${ABSENT}`, { name: ABSENT }],
    ['DELETE', `/api/merchant/menu/${ABSENT}`, null],
    ['POST', `/api/merchant/${A.uuid}/menu`, { name: ABSENT }],
    ['PATCH', `/api/merchant/${A.uuid}/menu/${ABSENT}`, { price: 1 }],
    ['PUT', `/api/merchant/${A.uuid}/menu/${ABSENT}`, { price: 1 }],
    ['DELETE', `/api/merchant/${A.uuid}/menu/${ABSENT}`, null],
    ['POST', `/api/merchant/${A.uuid}/menu/${ABSENT}/photo`, { fileData: 'x' }],
  ];
  for (const [m, p, b] of probes) {
    const r = await request(m, p, b, tok(la.token));
    const noRoute = !!r.data.raw;
    log(`${m} ${p} -> ${r.status}${noRoute ? ' [no-route: Express 404 page]' : ' [handler: ' + (r.data.code || r.data.error || JSON.stringify(r.data).slice(0, 80)) + ']'}`);
  }

  line('8. DOES THE WRITE LAND ANYWHERE? (products row untouched check)');
  const nameCheck = await dbProduct(targetId);
  log('name still', nameCheck.row && nameCheck.row.name, '| price still', nameCheck.row && nameCheck.row.price);

  process.exit(0);
})().catch((e) => { console.error('PROBE CRASHED:', e); process.exit(1); });
