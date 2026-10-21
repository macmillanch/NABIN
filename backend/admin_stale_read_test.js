'use strict';

// =========================================================================
// ADMIN STALE READS — P9
//
// `GET /api/admin/jobs` answered `db.jobs` and `GET /api/admin/restaurants`
// answered `db.restaurants`. Both are process memory. The measured facts this
// suite is built on:
//
//   - `persistentStore.loadState()` returns null whenever the run is production
//     or live-PostgreSQL, so the disk snapshot is an offline-dev path only.
//   - At boot, ONE hydration step reads `jobs` newest-first with `.limit(200)`
//     and merges it into the mirror. Nothing re-reads it afterwards.
//   - No boot step reads the `merchants` list at all (every `from('merchants')`
//     call is a per-id or lookup read), so the restaurant mirror stays the
//     single seeded object — which carries `payableBalance`, `operationalStatus`,
//     `rating`, `menu` and `deliveryTime`, three of which have no column in
//     `merchants` at all.
//
// So an operator's two queues were a boot-time photograph: a job another process
// created, completed or deleted was invisible until restart, the directory showed
// one storefront against a table of many, and no answer could state a total.
//
// What it pins — each group names the §4 requirement it covers:
//   A  a durable job committed after boot is served (requirement 1)
//   B  a durable update is reflected (requirement 2)
//   C  a record with no durable row is not advertised, and a deleted durable row
//      is not resurrected by the mirror (requirement 3)
//   D  ordering, filters, a stated total and bounded pagination (requirement 5)
//   E  restaurants come from authoritative `merchants` rows (requirement 4)
//   F  an unreachable store is a classified 503, never a fabricated list
//      (requirement 6)
//   G  the authentication guard is unchanged (requirement 7)
//   H  this run touches only its own fixture rows (requirement 8)
//
// Deliberately NOT changed here: authorization. Both routes keep exactly the
// guards they have (`authenticateAdmin`, no permission gate). Widening or
// inventing role grants is issue #273 and stays an owner decision.
//
// Runs only on the disposable isolated lane (`scripts/with_local_target.js`,
// `scripts/lane_check.js`). It refuses a non-loopback target before any socket
// opens, so it can never write to a hosted project. Fixtures are inserted with
// the privileged role into the lane schema, and teardown deletes exactly the
// identifiers this run minted.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'admin_stale_read_test' });

const STAMP = Date.now();
const JOBN = (tag) => `P9-${tag}-${STAMP}`;
const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(name);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

// The page ceiling the fix is allowed to serve. A caller asking for more gets the
// ceiling plus an honest `total`, never the whole table.
const MAX_PAGE = 200;

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function bootServer({ port, request, extraEnv = {}, attempts = 180, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      // Never let a background timer of this process prune sessions the harness
      // did not provision (F-13), and never let it reconcile on its own clock.
      NABIN_SESSION_PRUNE: 'off',
      NABIN_SESSION_RECONCILE_MS: '0',
      ...extraEnv,
    },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
  }
  return proc; // caller reports readiness via the next health probe
}

async function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Admin Stale Read Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

// --- the store outage seam --------------------------------------------------
// A forwarding proxy that fails ONLY the tables under test. This is what makes
// requirement 6 testable over HTTP: sessions, admin credentials and every other
// read still reach the real store, so a valid bearer exists, and the only thing
// that can go wrong is the authoritative list read itself.
function makeStoreProxy({ origin, shouldFail }) {
  const target = new URL(origin);
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    // The local Supabase gateway sits in front of PostgREST, so the wire path is
    // /rest/v1/<table>?… — not /<table>. Splitting on '/' and taking the last
    // segment is what actually names the FROM table; without this every request
    // forwarded and the outage never landed.
    const table = pathname.split('/').filter(Boolean).pop() || '';
    if (shouldFail(table)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'PGRST500', message: 'simulated store outage (admin_stale_read_test)', details: null, hint: null }));
      return;
    }
    const fwd = http.request({
      method: req.method,
      hostname: target.hostname,
      port: target.port,
      path: req.url,
      headers: { ...req.headers, host: target.host },
    }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    fwd.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'PROXY_ERROR', message: 'forward failed' }));
    });
    req.pipe(fwd);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// --- durable helpers --------------------------------------------------------
let pg = null;
async function countOf(table) {
  const r = await pg.query(`select count(*)::int as n from ${table}`);
  return r.rows[0].n;
}
async function durableJob(jobNumber) {
  const r = await pg.query(
    `select id, job_number, service_type, status, pickup_address, drop_address, final_total,
            payment_status, payment_method, driver_earnings, platform_commission, created_at
       from jobs where job_number = $1`, [jobNumber]);
  return r.rows[0] || null;
}
async function durableMerchant(id) {
  const r = await pg.query(
    `select id, name, merchant_type, phone, address, lat, lng, is_open, rating, wallet_balance,
            commission_rate, approval_status, cuisines, created_at
       from merchants where id = $1`, [id]);
  return r.rows[0] || null;
}

// Identifiers this run minted, so teardown deletes exactly these and nothing wider.
const createdJobNumbers = [];
const createdMerchantIds = [];

async function insertJob(jobNumber, fields = {}) {
  createdJobNumbers.push(jobNumber);
  const r = await pg.query(
    `insert into jobs (job_number, service_type, status, pickup_address, drop_address,
                       pickup_lat, pickup_lng, drop_lat, drop_lng, distance_km,
                       fare_subtotal, final_total, driver_earnings, platform_commission,
                       payment_method, payment_status, metadata, created_at)
     values ($1,'RIDE',$2,'P9 pickup lane street',$3,28.6100000,77.2100000,28.6300000,77.2300000,4.20,
             120.00,150.00,128.00,22.00,'WALLET','PENDING',$4, now())
     returning id, job_number`,
    [jobNumber, fields.status || 'SEARCHING', fields.drop || 'P9 drop lane avenue',
     JSON.stringify({ customerName: 'P9 fixture customer', vehicleType: '3W' })]);
  return r.rows[0];
}

async function insertMerchant(name) {
  const r = await pg.query(
    `insert into merchants (name, merchant_type, phone, address, lat, lng, is_open, rating,
                            wallet_balance, commission_rate, approval_status, cuisines)
     values ($1,'RESTAURANT',$2,'P9 fixture lane, test district',28.6200000,77.2200000,false,3.40,
             777.50,0.17,'APPROVED',array['North Indian'])
     returning id, name`, [name, `+91 90${String(STAMP).slice(-8)}`]);
  createdMerchantIds.push(r.rows[0].id);
  return r.rows[0];
}

const byJobKey = (list, jobNumber) => (list || []).find((j) => String(j.jobNumber || j.id || '') === jobNumber);
const byUuid = (list, uuid) => (list || []).find((m) => String(m.uuid || m.id || '') === String(uuid));

async function main() {
  console.log('========================================================================');
  console.log('NABIN ADMIN STALE READ TEST — P9');
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

  // Baselines, taken before this suite writes anything, so Group H can account for
  // every row that appeared.
  const baseline = {
    jobs: await countOf('jobs'),
    merchants: await countOf('merchants'),
    orders: await countOf('orders'),
    journal: (await pg.query('select count(*)::int as n from journal_transactions')).rows[0].n,
  };
  console.log(`  durable baselines: ${JSON.stringify(baseline)}`);

  // The seed identities the mirror carries, measured for whether the durable store
  // knows them at all. This is the "mirror advertises a record that no longer
  // exists" witness, and it is chosen by measurement rather than by a list copied
  // from a brief.
  const seedCandidates = ['JOB-101', 'JOB-102', 'JOB-103', 'JOB-900', 'rest_1'];
  const seedPresence = {};
  for (const key of seedCandidates) {
    const j = await pg.query('select count(*)::int as n from jobs where job_number = $1', [key]);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
    const m = isUuid
      ? await pg.query('select count(*)::int as n from merchants where id = $1::uuid or name = $2', [key, key])
      : await pg.query('select count(*)::int as n from merchants where name = $1', [key]);
    seedPresence[key] = { jobs: j.rows[0].n, merchants: m.rows[0].n };
  }
  console.log('  seed identity presence in the durable store: ' + JSON.stringify(seedPresence));

  const SEED_MIRROR_RESTAURANT_UUID = '00000000-0000-0000-0000-000000000201';
  const durableSeedMerchant = await durableMerchant(SEED_MIRROR_RESTAURANT_UUID);

  // =====================================================================
  // GROUP A — a durable row committed after boot must be visible
  // =====================================================================
  console.log('\n--- GROUP A: a job durable after this process booted is served ---');
  const jobA = JOBN('A');
  const rowA = await insertJob(jobA);
  assert('A0 the fixture job is durable (read back from PostgreSQL)', Boolean(rowA && rowA.id), { rowA });

  const jobsRes = await request('GET', '/api/admin/jobs', null, bearer(admin.token));
  assert('A1 GET /api/admin/jobs answers 200 with success', jobsRes.status === 200 && jobsRes.data && jobsRes.data.success === true, { status: jobsRes.status, data: jobsRes.data });
  const servedA = (jobsRes.data && jobsRes.data.jobs) || [];
  const recA = byJobKey(servedA, jobA);
  assert('A2 the durable row created after boot is served (not a boot-time photograph)', Boolean(recA),
    { jobA, served: servedA.length, firstServedId: servedA[0] && servedA[0].id });
  assert('A3 its status is the durable status', Boolean(recA) && recA.status === (await durableJob(jobA)).status, { served: recA && recA.status });
  assert('A4 it is identified both ways: job_number as id, uuid as the row id',
    Boolean(recA) && String(recA.id) === jobA && String(recA.uuid) === String(rowA.id), { served: recA && { id: recA.id, uuid: recA.uuid } });
  assert('A5 its money and place fields are the durable values, mapped as the repository maps them',
    Boolean(recA) && Number(recA.fare) === 150 && recA.pickup && recA.pickup.address === 'P9 pickup lane street'
    && recA.drop && recA.drop.address === 'P9 drop lane avenue' && Number(recA.driverEarnings) === 128
    && recA.paymentStatus === 'PENDING' && recA.paymentMethod === 'WALLET',
    { served: recA && { fare: recA.fare, pickup: recA.pickup && recA.pickup.address, drop: recA.drop && recA.drop.address, driverEarnings: recA.driverEarnings, paymentStatus: recA.paymentStatus, paymentMethod: recA.paymentMethod } });
  assert('A6 the served record carries no invented customer rating',
    Boolean(recA) && (recA.customerRating === null || recA.customerRating === undefined), { customerRating: recA && recA.customerRating });
  assert('A7 the read says where it came from',
    Boolean(jobsRes.data) && jobsRes.data.dataSource === 'postgres', { dataSource: jobsRes.data && jobsRes.data.dataSource });

  // =====================================================================
  // GROUP B — a durable update must be reflected
  // =====================================================================
  console.log('\n--- GROUP B: a durable update is reflected without a restart ---');
  await pg.query("update jobs set status = 'ASSIGNED', payment_status = 'PAID', updated_at = now() where job_number = $1", [jobA]);
  const afterUpdate = await request('GET', '/api/admin/jobs?limit=5', null, bearer(admin.token));
  const recB = byJobKey((afterUpdate.data && afterUpdate.data.jobs) || [], jobA);
  assert('B1 the durable status change is served', Boolean(recB) && recB.status === 'ASSIGNED',
    { served: recB && recB.status, durable: (await durableJob(jobA)).status });
  assert('B2 the durable payment change is served', Boolean(recB) && recB.paymentStatus === 'PAID', { served: recB && recB.paymentStatus });
  assert('B3 the mirror did not keep answering with the boot value',
    Boolean(recB) && recB.status !== 'SEARCHING', { served: recB && recB.status });

  // =====================================================================
  // GROUP C — no resurrection, no phantoms
  // =====================================================================
  console.log('\n--- GROUP C: a record with no durable row is not advertised ---');
  const wide = await request('GET', `/api/admin/jobs?limit=${MAX_PAGE}`, null, bearer(admin.token));
  const wideJobs = (wide.data && wide.data.jobs) || [];
  const servedKeys = wideJobs.map((j) => String(j.jobNumber || j.id || '')).filter(Boolean);
  const orphanProbe = seedCandidates.filter((k) => /^JOB-/.test(k) && seedPresence[k].jobs === 0);
  const servedOrphans = servedKeys.filter((k) => orphanProbe.includes(k));
  assert('C1 the seeded mirror jobs that exist in no durable table are not served',
    servedOrphans.length === 0, { orphanProbe, servedOrphans });

  if (servedKeys.length) {
    const found = await pg.query('select job_number from jobs where job_number = any($1)', [servedKeys]);
    const durableKeys = new Set(found.rows.map((r) => String(r.job_number)));
    const phantoms = servedKeys.filter((k) => !durableKeys.has(k));
    assert('C2 every served job has a durable row (structural: no phantom identities)',
      phantoms.length === 0, { served: servedKeys.length, phantoms: phantoms.slice(0, 8) });
  } else {
    assert('C2 every served job has a durable row (structural: no phantom identities)', false, 'no jobs served at all');
  }

  await pg.query('delete from jobs where job_number = $1', [jobA]);
  const afterDelete = await request('GET', '/api/admin/jobs?limit=5', null, bearer(admin.token));
  const goneRow = await durableJob(jobA);
  assert('C3 the fixture row really is gone from the durable store', goneRow === null, { goneRow });
  assert('C4 a deleted durable record is not resurrected by the mirror',
    !byJobKey((afterDelete.data && afterDelete.data.jobs) || [], jobA), { served: (afterDelete.data && afterDelete.data.jobs || []).map((j) => j.id).slice(0, 5) });

  // =====================================================================
  // GROUP D — ordering, filters, total, bounded pages
  // =====================================================================
  console.log('\n--- GROUP D: ordering, filters and a stated total ---');
  const durableJobsBefore = await countOf('jobs');
  const page1 = await request('GET', '/api/admin/jobs', null, bearer(admin.token));
  const durableJobsAfter = await countOf('jobs');
  const body1 = page1.data || {};
  assert('D0 nothing else wrote during the measurement window', durableJobsBefore === durableJobsAfter,
    { durableJobsBefore, durableJobsAfter });
  assert('D1 the response states a total', typeof body1.total === 'number', { total: body1.total });
  assert('D2 that total is the durable row count, not the length of the page',
    body1.total === durableJobsBefore, { total: body1.total, durable: durableJobsBefore });
  assert('D3 the response states the page it served',
    typeof body1.limit === 'number' && typeof body1.offset === 'number', { limit: body1.limit, offset: body1.offset });

  const times = (body1.jobs || []).map((j) => String(j.createdAt || ''));
  const outOfOrder = times.slice(1).map((t, i) => (t > times[i] ? { i, prev: times[i], next: t } : null)).filter(Boolean);
  assert('D4 the page is deterministically ordered newest-first', outOfOrder.length === 0, { outOfOrder: outOfOrder.slice(0, 3) });

  const p1 = await request('GET', '/api/admin/jobs?limit=5&offset=0', null, bearer(admin.token));
  const p2 = await request('GET', '/api/admin/jobs?limit=5&offset=5', null, bearer(admin.token));
  const ids1 = ((p1.data && p1.data.jobs) || []).map((j) => String(j.id));
  const ids2 = ((p2.data && p2.data.jobs) || []).map((j) => String(j.id));
  assert('D5 limit is respected', ids1.length === 5 && p1.data.limit === 5, { served: ids1.length, limit: p1.data && p1.data.limit });
  assert('D6 offset moves the window and pages do not overlap',
    ids1.length === 5 && ids2.length === 5 && ids1.every((id) => !ids2.includes(id)), { ids1, ids2 });
  assert('D7 the total is the same on every page',
    p1.data.total === p2.data.total && p1.data.total === durableJobsBefore, { p1: p1.data.total, p2: p2.data.total, durable: durableJobsBefore });

  const clamped = await request('GET', `/api/admin/jobs?limit=${MAX_PAGE * 5}`, null, bearer(admin.token));
  const clampExpected = Math.min(MAX_PAGE, durableJobsBefore);
  assert('D8 an over-large limit is clamped rather than served whole',
    ((clamped.data && clamped.data.jobs) || []).length === clampExpected && clamped.data.total === durableJobsBefore,
    { served: ((clamped.data && clamped.data.jobs) || []).length, expected: clampExpected, total: clamped.data && clamped.data.total });

  const rideTotal = (await pg.query("select count(*)::int as n from jobs where service_type = 'RIDE'")).rows[0].n;
  const filtered = await request('GET', '/api/admin/jobs?type=RIDE&limit=10', null, bearer(admin.token));
  const filteredJobs = (filtered.data && filtered.data.jobs) || [];
  assert('D9 a service-type filter is applied in the store, not client-side',
    filteredJobs.length > 0 && filteredJobs.every((j) => j.type === 'RIDE'), { served: filteredJobs.length, types: [...new Set(filteredJobs.map((j) => j.type))] });
  assert('D10 the filtered total is the durable filtered count',
    filtered.data && filtered.data.total === rideTotal, { total: filtered.data && filtered.data.total, durableRide: rideTotal });
  const badFilter = await request('GET', '/api/admin/jobs?type=NOT_A_SERVICE', null, bearer(admin.token));
  assert('D11 an unknown service type is refused, not answered with everything',
    badFilter.status === 400 || (badFilter.data && badFilter.data.total === 0),
    { status: badFilter.status, total: badFilter.data && badFilter.data.total });

  // =====================================================================
  // GROUP E — restaurants from authoritative merchants
  // =====================================================================
  console.log('\n--- GROUP E: the merchant directory comes from PostgreSQL ---');
  const merchantName = `P9 Fixture Kitchen ${STAMP}`;
  const rowM = await insertMerchant(merchantName);
  assert('E0 the fixture merchant is durable', Boolean(rowM && rowM.id), { rowM });
  const durableMerchantsBefore = await countOf('merchants');
  const restRes = await request('GET', '/api/admin/restaurants', null, bearer(admin.token));
  const durableMerchantsAfter = await countOf('merchants');
  const restBody = restRes.data || {};
  const servedRestaurants = restBody.restaurants || [];
  assert('E1 GET /api/admin/restaurants answers 200 with success',
    restRes.status === 200 && restBody.success === true, { status: restRes.status, data: restRes.data });
  assert('E2 the merchant created after boot is served', Boolean(byUuid(servedRestaurants, rowM.id)),
    { merchantId: rowM.id, served: servedRestaurants.length, servedNames: servedRestaurants.map((m) => m.name).slice(0, 5) });
  assert('E3 the stated total is the durable merchants count, not one seed object',
    typeof restBody.total === 'number' && restBody.total === durableMerchantsBefore && durableMerchantsBefore === durableMerchantsAfter,
    { total: restBody.total, durable: durableMerchantsBefore, after: durableMerchantsAfter });
  assert('E4 the read is labelled with its source', restBody.dataSource === 'postgres', { dataSource: restBody.dataSource });

  const fixtureRec = byUuid(servedRestaurants, rowM.id);
  const fixtureRow = await durableMerchant(rowM.id);
  assert('E5 the served merchant carries the durable name, type, address and phone',
    Boolean(fixtureRec) && fixtureRec.name === fixtureRow.name && (fixtureRec.merchantType || fixtureRec.merchant_type) === fixtureRow.merchant_type
    && fixtureRec.address === fixtureRow.address && fixtureRec.phone === fixtureRow.phone,
    { served: fixtureRec && { name: fixtureRec.name, type: fixtureRec.merchantType || fixtureRec.merchant_type, address: fixtureRec.address, phone: fixtureRec.phone }, durable: fixtureRow && { name: fixtureRow.name, type: fixtureRow.merchant_type } });
  assert('E6 closed storefront reads as closed: is_open drives isOpen and the established operational vocabulary',
    Boolean(fixtureRec) && fixtureRec.isOpen === false && fixtureRec.operationalStatus === 'SUSPENDED',
    { served: fixtureRec && { isOpen: fixtureRec.isOpen, operationalStatus: fixtureRec.operationalStatus }, durableIsOpen: fixtureRow && fixtureRow.is_open });
  assert('E7 the durable approval column is reported as itself',
    Boolean(fixtureRec) && fixtureRec.approvalStatus === fixtureRow.approval_status,
    { served: fixtureRec && fixtureRec.approvalStatus, durable: fixtureRow && fixtureRow.approval_status });
  assert('E8 rating and wallet balance are the durable numbers, and commission keeps the repository fraction convention',
    Boolean(fixtureRec) && Number(fixtureRec.rating) === 3.4 && Number(fixtureRec.walletBalance) === 777.5
    && Number(fixtureRec.commissionRate) === 0.17,
    { served: fixtureRec && { rating: fixtureRec.rating, walletBalance: fixtureRec.walletBalance, commissionRate: fixtureRec.commissionRate } });
  assert('E9 coordinates are the durable latitude and longitude',
    Boolean(fixtureRec) && Number(fixtureRec.location && fixtureRec.location.lat) === 28.62 && Number(fixtureRec.location && fixtureRec.location.lng) === 77.22,
    { served: fixtureRec && fixtureRec.location });

  // The fields the seed object carried that no column can hold. Serving them from
  // PostgreSQL means one of two things: they are derived from a real column, or
  // they are gone. A fabricated balance is the one a money screen would read.
  const fabricated = ['payableBalance', 'menu', 'deliveryTime'];
  const carriers = servedRestaurants.filter((m) => fabricated.some((k) => m[k] !== undefined && m[k] !== null));
  assert('E10 no served merchant carries a payable balance, a menu or a delivery window the schema cannot store',
    carriers.length === 0, { carriers: carriers.slice(0, 3).map((m) => ({ id: m.id, keys: fabricated.filter((k) => m[k] != null) })) });

  if (durableSeedMerchant) {
    const seedRec = byUuid(servedRestaurants, SEED_MIRROR_RESTAURANT_UUID);
    assert('E11 the seeded storefront is served with the durable name, not the stale mirror copy',
      Boolean(seedRec) && seedRec.name === durableSeedMerchant.name,
      { served: seedRec && seedRec.name, durableName: durableSeedMerchant.name });
    assert('E12 and its operational status follows its durable is_open',
      Boolean(seedRec) && seedRec.isOpen === durableSeedMerchant.is_open
      && seedRec.operationalStatus === (durableSeedMerchant.is_open ? 'APPROVED' : 'SUSPENDED'),
      { served: seedRec && { isOpen: seedRec.isOpen, operationalStatus: seedRec.operationalStatus }, durableIsOpen: durableSeedMerchant.is_open });
  }

  const restaurantTypeTotal = (await pg.query("select count(*)::int as n from merchants where merchant_type = 'RESTAURANT'")).rows[0].n;
  const filteredM = await request('GET', '/api/admin/restaurants?merchant_type=RESTAURANT&limit=10', null, bearer(admin.token));
  const filteredRows = (filteredM.data && filteredM.data.restaurants) || [];
  assert('E13 a merchant-type filter is applied in the store',
    filteredRows.length > 0 && filteredRows.every((m) => (m.merchantType || m.merchant_type) === 'RESTAURANT') && filteredM.data.total === restaurantTypeTotal,
    { served: filteredRows.length, total: filteredM.data && filteredM.data.total, durable: restaurantTypeTotal });

  const restTimes = servedRestaurants.map((m) => String(m.createdAt || m.id || ''));
  const restOrdered = restTimes.slice(1).every((t, i) => !(t > restTimes[i]));
  assert('E14 the merchant directory is deterministically ordered (newest first, id as tiebreak)',
    restOrdered, { head: restTimes.slice(0, 4) });

  const phantomRestaurants = [];
  if (servedRestaurants.length) {
    const ids = servedRestaurants.map((m) => String(m.uuid || m.id || '')).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    const present = await pg.query('select id from merchants where id = any($1::uuid[])', [ids]);
    const presentIds = new Set(present.rows.map((r) => String(r.id)));
    for (const m of servedRestaurants) {
      const key = String(m.uuid || m.id || '');
      if (/^[0-9a-f-]{36}$/i.test(key) && !presentIds.has(key)) phantomRestaurants.push(key);
    }
  }
  assert('E15 no served merchant names a row the store does not have',
    phantomRestaurants.length === 0, { phantomRestaurants: phantomRestaurants.slice(0, 5) });

  // =====================================================================
  // GROUP F — an unreachable store is an outage, never a list
  // =====================================================================
  console.log('\n--- GROUP F: with the authoritative store down, both reads refuse ---');
  const origin = process.env.SUPABASE_URL;
  assert('F0 the PostgREST handle this suite proxies is loopback',
    Boolean(origin) && /^(?:http:\/\/)?127\.0\.0\.1/i.test(origin), { origin: origin ? new URL(origin).host : origin });

  const failing = new Set(['jobs', 'merchants']);
  let outageOn = true;
  const proxy = await makeStoreProxy({ origin, shouldFail: (table) => outageOn && failing.has(table) });
  assert('F0b the outage proxy is listening', Boolean(proxy && proxy.port), { port: proxy.port });

  const darkPort = await findFreePort();
  const darkBase = `http://127.0.0.1:${darkPort}`;
  const darkReq = makeRequest(darkBase);
  const darkProc = await bootServer({ port: darkPort, request: darkReq, extraEnv: { SUPABASE_URL: proxy.url } });
  const darkHealth = await darkReq('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('F1 a backend whose jobs/merchants store is unreachable still serves health', darkHealth.status === 200, { status: darkHealth.status });
  const darkAdmin = await mintAdmin({ request: darkReq });
  assert('F2 its admin session mints, so the outage is scoped to the two reads under test',
    Boolean(darkAdmin.token), { status: darkAdmin.status, body: darkAdmin.body });

  const darkJobs = await darkReq('GET', '/api/admin/jobs', null, bearer(darkAdmin.token)).catch((e) => ({ status: 0, data: { error: e.message } }));
  assert('F3 a dead jobs store is a classified 503, not a stale 200 list',
    darkJobs.status === 503, { status: darkJobs.status, code: darkJobs.data && darkJobs.data.code });
  assert('F4 the refusal says success:false with the established store code',
    Boolean(darkJobs.data) && darkJobs.data.success === false && darkJobs.data.code === 'AUTH_STORE_UNAVAILABLE',
    darkJobs.data);
  assert('F5 it serves no job array, so a client cannot render an outage as an empty queue',
    darkJobs.data && darkJobs.data.jobs === undefined, { jobs: darkJobs.data && darkJobs.data.jobs });

  const darkRest = await darkReq('GET', '/api/admin/restaurants', null, bearer(darkAdmin.token)).catch((e) => ({ status: 0, data: { error: e.message } }));
  assert('F6 a dead merchants store is a classified 503 too',
    darkRest.status === 503 && darkRest.data && darkRest.data.success === false && darkRest.data.code === 'AUTH_STORE_UNAVAILABLE',
    { status: darkRest.status, data: darkRest.data });
  assert('F7 and it serves no restaurant array', darkRest.data && darkRest.data.restaurants === undefined,
    { restaurants: darkRest.data && darkRest.data.restaurants });

  outageOn = false;
  const backUp = await darkReq('GET', '/api/admin/jobs?limit=2', null, bearer(darkAdmin.token));
  assert('F8 with the store answering again the same route serves again — the refusal was the outage, not the route',
    backUp.status === 200 && Array.isArray(backUp.data && backUp.data.jobs), { status: backUp.status, data: backUp.data });
  const backUpRest = await darkReq('GET', '/api/admin/restaurants?limit=2', null, bearer(darkAdmin.token));
  assert('F9 and the merchant directory recovers with it',
    backUpRest.status === 200 && Array.isArray(backUpRest.data && backUpRest.data.restaurants), { status: backUpRest.status });

  await stopProc(darkProc);
  await proxy.close();

  // =====================================================================
  // GROUP G — the authorization boundary is untouched
  // =====================================================================
  console.log('\n--- GROUP G: the guard on these two reads is the one that was already there ---');
  const noTokenJobs = await request('GET', '/api/admin/jobs');
  assert('G1 /api/admin/jobs without a bearer is refused', noTokenJobs.status === 401 || noTokenJobs.status === 403,
    { status: noTokenJobs.status });
  const badTokenJobs = await request('GET', '/api/admin/jobs?limit=5', null, bearer('not-a-session-token'));
  assert('G2 a forged bearer is refused on the paginated form of the route too',
    badTokenJobs.status === 401 || badTokenJobs.status === 403, { status: badTokenJobs.status });
  const noTokenRest = await request('GET', '/api/admin/restaurants');
  assert('G3 /api/admin/restaurants without a bearer is refused',
    noTokenRest.status === 401 || noTokenRest.status === 403, { status: noTokenRest.status });
  const withToken = await request('GET', '/api/admin/restaurants?limit=2', null, bearer(admin.token));
  assert('G4 an admin bearer is still served (no new gate was invented here)',
    withToken.status === 200, { status: withToken.status, data: withToken.data });

  // =====================================================================
  // GROUP H — only this run's own rows were written
  // =====================================================================
  console.log('\n--- GROUP H: the fixtures are this run\'s only footprint ---');
  // Accounting against the baselines taken before this suite wrote anything.
  // jobA was inserted in A and deleted in C3, so by here every job this run minted
  // is already gone; rowM is still present and only cleanup() removes it. So the
  // honest expectation is: jobs back to baseline, merchants exactly baseline + the
  // merchants this run named, and no movement at all in the money tables.
  const p9JobsNow = (await pg.query("select count(*)::int as n from jobs where job_number like 'P9-%'")).rows[0].n;
  const p9MerchantsNow = (await pg.query("select count(*)::int as n from merchants where name like 'P9 Fixture%'")).rows[0].n;
  const p9MerchantIdsNow = (await pg.query('select id from merchants where name like $1', ['P9 Fixture%'])).rows.map((r) => String(r.id));
  const jobsNow = await countOf('jobs');
  const merchantsNow = await countOf('merchants');
  assert('H1 the only P9-marked jobs still present are zero — this run\'s one job fixture was already deleted',
    p9JobsNow === 0, { p9JobsNow, created: createdJobNumbers });
  assert('H2 the jobs table is back to its pre-run row count: no job this run did not mint was deleted',
    jobsNow === baseline.jobs, { jobsNow, baselineJobs: baseline.jobs });
  assert('H3 the only merchants that appeared are the ones this run named, and it names every one of them',
    merchantsNow === baseline.merchants + createdMerchantIds.length &&
    p9MerchantsNow === createdMerchantIds.length &&
    p9MerchantIdsNow.every((id) => createdMerchantIds.some((c) => String(c) === id)),
    { merchantsNow, baselineMerchants: baseline.merchants, p9MerchantsNow, created: createdMerchantIds });
  const ordersNow = await countOf('orders');
  const journalNow = (await pg.query('select count(*)::int as n from journal_transactions')).rows[0].n;
  assert('H4 this suite wrote no order and no journal row — both counts are unchanged from the baseline',
    ordersNow === baseline.orders && journalNow === baseline.journal,
    { orders: { now: ordersNow, baseline: baseline.orders }, journal: { now: journalNow, baseline: baseline.journal } });

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
  if (failed.length) {
    console.log('Failed checks:');
    for (const name of failed) console.log(`  - ${name}`);
  }
  console.log(`ADMIN STALE READ TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

// Teardown deletes exactly the identifiers this run minted. No shared job,
// merchant, order, wallet or ledger row is in scope.
async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (createdJobNumbers.length) {
      const del = await pg.query('delete from jobs where job_number = any($1)', [createdJobNumbers]);
      const left = await pg.query('select count(*)::int as n from jobs where job_number = any($1)', [createdJobNumbers]);
      console.log(`[cleanup] jobs: deleted ${del.rowCount}, this run's identifiers still present: ${left.rows[0].n}`);
    }
    if (createdMerchantIds.length) {
      const del = await pg.query('delete from merchants where id = any($1::uuid[])', [createdMerchantIds]);
      const left = await pg.query('select count(*)::int as n from merchants where id = any($1::uuid[])', [createdMerchantIds]);
      console.log(`[cleanup] merchants: deleted ${del.rowCount}, this run's identifiers still present: ${left.rows[0].n}`);
    }
  } catch (e) {
    console.error('[CLEANUP FAILED] residue may remain:', e.message);
  }
  try { await pg.end(); } catch { /* already closed */ }
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error('[FATAL] admin_stale_read_test threw outside the assertion harness:', err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(process.exitCode || 0);
}

run();
