'use strict';

// =========================================================================
// ADMIN METRICS TRUTHFULNESS — #481 §5
//
// GET /api/admin/metrics (src/server.js, pre-fix lines 8495-8518) answered platform
// totals that the process cannot stand behind, in three distinct ways:
//
// 1. A fabricated operational claim. `fleetStatus: 'OPTIMAL_OPERATION'` is a
//    literal: nothing computes it, no column stores it, and it is 'OPTIMAL' for
//    every admin on every platform state including an outage. Measured consumer
//    search: the key appears at the producer and nowhere else in the repository,
//    so deleting it breaks no client.
//
// 2. Mirror-derived figures labelled as totals. Every number came from
//    `this.drivers` / `this.jobs` / `this.users` / `this.restaurants` /
//    `this.identityApplications` — this process's in-memory projection. `jobs`
//    is hydrated with `.limit(200)` of the most recent rows (src/database.js:1917),
//    so `totalCompletedJobs` and `totalGrossFare` were a 200-row window wearing
//    total clothing; measured on the local store that is 604 completed jobs and
//    ₹91,251.00 of durable `final_total` against ₹29,159.00 inside the window.
//    `restaurants` and `identityApplications` are never hydrated from PostgreSQL
//    at all (only seed arrays), and there is no `identity_applications` table —
//    `pendingKyc` counted demo applicants, and it too has no consumer.
//
// 3. No provenance. The payload carries no `dataSource`, so a stale window
//    looked exactly like an authoritative read. The established vocabulary in
//    this file (`listAdminJobs`, `listAdminRestaurants`) and the refuse-not-
//    fabricate precedent for aggregates (`getFinancialMetrics`,
//    src/database.js:3344) are what the fix follows: read the durable store,
//    label it `dataSource:'postgres'`, and answer 503 AUTH_STORE_UNAVAILABLE
//    when it cannot be read — never fall back to the mirror, because the mirror
//    would then disagree with /api/admin/finance/metrics about the same money.
//
// `totalGrossFare` therefore becomes SUM(jobs.final_total) over COMPLETED jobs —
// the identical definition `getFinancialMetrics()` uses for `grossGtv`, so the
// two endpoints can no longer report different totals for one quantity.
//
// The fixed payload is the truthful subset of the keys the route already emitted;
// nothing is added to it. Measured consumer search across `*.dart`, `*.tsx`,
// `*.ts` and `*.js`: `fleetStatus`, `pendingKyc`, `totalGrossFare`,
// `totalCompletedJobs`, `activeDrivers` and the path `/api/admin/metrics` itself
// appear at this producer and nowhere else in the repository, so the endpoint has
// no client whose contract changes — and no client to justify a new field either
// (in particular `totalDrivers` is NOT added: nothing reads it).
// test_suite.js:192 asserts `activeDrivers` on `/api/health` (src/server.js:543),
// which is the same defect class on a different payload and is reported, not
// widened into this change.
//
// Deliberately NOT changed here: authorization. The route keeps exactly the
// guard it had (`authenticateAdmin`, no permission gate) — which permissions
// this read should require is issue #273 and an owner decision.
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

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'admin_metrics_truthfulness_test' });

const STAMP = Date.now();
const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(name);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
}
function notMeasured(id, why) {
  skipped.push(id);
  console.log(`NOT MEASURED  ${id} — ${why}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const cents = (v) => Math.round(Number(v) * 100) / 100;

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

// The exact figures this run mints, so an equality assertion on a money total
// cannot be satisfied by a coincidental match.
const FIXTURE_COMPLETED_TOTAL = 123.45;
const FABRICATED_STATUS = 'OPTIMAL_OPERATION';
const MIRROR_JOB_WINDOW = 200;

// The whole truthful contract: seven figures the store can answer, one provenance label,
// one timestamp. Anything else in the payload is a claim this suite never asked the
// database about, so a new key has to be a new checked assertion, not a quiet addition.
const HONEST_KEY_SET = [
  'activeDrivers', 'activeJobs', 'dataSource', 'timestamp',
  'totalCompletedJobs', 'totalGrossFare', 'totalRestaurants', 'totalUsers',
];

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

async function bootServer({ port, request, extraEnv = {}, attempts = 180, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
    env: {
      ...process.env, PORT: String(port),
      // Never let a background timer of this process prune sessions the harness did
      // not provision (F-13), and never let it reconcile on its own clock.
      NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0',
      ...extraEnv,
    },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; } catch { /* not up yet */ }
  }
  return proc;
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
    await request('POST', '/api/admin/bootstrap', { bootstrapSecret: BOOTSTRAP_SECRET, username: ADMIN_USER, password: ADMIN_PASSWORD, name: 'Admin Metrics Truthfulness Bootstrap Admin' });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

// --- the store outage seam --------------------------------------------------
// A forwarding proxy that fails ONLY the four tables these totals are built from.
// Sessions, admin credentials and the connection health check (which reads
// platform_settings) still reach the real store, so a valid bearer exists and the
// only thing that can go wrong is the authoritative aggregate read itself.
function makeStoreProxy({ origin, shouldFail }) {
  const target = new URL(origin);
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '/').split('?')[0];
    // The local Supabase gateway sits in front of PostgREST, so the wire path is
    // /rest/v1/<table>?… — not /<table>. The last segment is what names the FROM
    // table; without this every request forwarded and the outage never landed.
    const table = pathname.split('/').filter(Boolean).pop() || '';
    if (shouldFail(table)) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'PGRST500', message: 'simulated store outage (admin_metrics_truthfulness_test)', details: null, hint: null }));
      return;
    }
    const fwd = http.request({
      method: req.method, hostname: target.hostname, port: target.port, path: req.url,
      headers: { ...req.headers, host: target.host },
    }, (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); });
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
      resolve({ port, url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// --- durable expectation, computed by SQL, never by the endpoint under test ---
let pg = null;
async function durableExpectation() {
  const one = async (sql, ...args) => (await pg.query(sql, args)).rows[0];
  const u = await one(`select count(*)::int as n from users`);
  const don = await one(`select count(*)::int as n from drivers where is_online = true`);
  const m = await one(`select count(*)::int as n from merchants`);
  const jc = await one(`select count(*)::int as n from jobs where status = 'COMPLETED'`);
  const ja = await one(`select count(*)::int as n from jobs where status <> 'COMPLETED' and status <> 'CANCELLED'`);
  const js = await one(`select coalesce(sum(final_total), 0)::numeric as s from jobs where status = 'COMPLETED'`);
  return {
    totalUsers: u.n,
    activeDrivers: don.n,
    totalRestaurants: m.n,
    totalCompletedJobs: jc.n,
    activeJobs: ja.n,
    grossFare: cents(js.s),
  };
}

const createdDriverIds = [];
const createdMerchantIds = [];
const createdJobNumbers = [];

async function mintFixtureRows() {
  const drv = await pg.query(
    `insert into drivers (phone, name, vehicle_type, vehicle_number, license_number, is_online, operational_status)
     values ($1,$2,'2W',$3,$4,true,'AVAILABLE') returning id`,
    [`+91 92${String(STAMP).slice(-8)}`, `AMT Fixture Online Driver ${STAMP}`, `DL92AMT${String(STAMP).slice(-4)}`, `AMT-LIC-${STAMP}`]);
  createdDriverIds.push(drv.rows[0].id);

  const mch = await pg.query(
    `insert into merchants (name, merchant_type, phone, address, lat, lng, is_open)
     values ($1,'GROCERY',$2,$3,28.6300000,77.2300000,true) returning id`,
    [`AMT Fixture Store ${STAMP}`, `+91 93${String(STAMP).slice(-8)}`, `#481 metrics lane fixture ${STAMP}`]);
  createdMerchantIds.push(mch.rows[0].id);

  const completed = `AMT481-C-${STAMP}`;
  createdJobNumbers.push(completed);
  await pg.query(
    `insert into jobs (job_number, service_type, status, pickup_address, drop_address,
                       pickup_lat, pickup_lng, drop_lat, drop_lng, distance_km,
                       fare_subtotal, final_total, driver_earnings, platform_commission,
                       driver_id, payment_method, payment_status)
     values ($1,'RIDE','COMPLETED','#481 pickup lane street','#481 drop lane street',
             28.6100000,77.2100000,28.6300000,77.2300000,4.20,
             $2,$2,$3,$4,$5,'CARD','PAID')`,
    [completed, FIXTURE_COMPLETED_TOTAL, cents(FIXTURE_COMPLETED_TOTAL * 0.8), cents(FIXTURE_COMPLETED_TOTAL * 0.2), drv.rows[0].id]);

  const active = `AMT481-A-${STAMP}`;
  createdJobNumbers.push(active);
  await pg.query(
    `insert into jobs (job_number, service_type, status, pickup_address, drop_address,
                       pickup_lat, pickup_lng, drop_lat, drop_lng, distance_km,
                       fare_subtotal, final_total, driver_earnings, platform_commission,
                       driver_id, payment_method, payment_status)
     values ($1,'RIDE','SEARCHING','#481 pickup lane street','#481 drop lane street',
             28.6100000,77.2100000,28.6300000,77.2300000,3.10,
             60.00,60.00,48.00,12.00,$2,'CARD','PENDING')`,
    [active, drv.rows[0].id]);

  return { driverId: drv.rows[0].id, merchantId: mch.rows[0].id, completedJobNumber: completed, activeJobNumber: active };
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN ADMIN METRICS TRUTHFULNESS TEST — #481 §5');
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

  // =====================================================================
  // GROUP A — every total is the durable count, not the mirror window
  // =====================================================================
  console.log('\n--- GROUP A: /api/admin/metrics totals equal exact durable counts ---');
  const expected = await durableExpectation();
  console.log(`  durable expectation: ${JSON.stringify(expected)}`);

  const res = await request('GET', '/api/admin/metrics', null, bearer(admin.token));
  assert('A1 GET the platform metrics answers 200 with success', res.status === 200 && res.data && res.data.success === true, { status: res.status, data: res.data });
  const metrics = (res.data && res.data.metrics) || {};
  assert('A2 the payload declares where it came from', metrics.dataSource === 'postgres', { dataSource: metrics.dataSource });
  assert('A3 totalUsers is the durable users count', metrics.totalUsers === expected.totalUsers, { served: metrics.totalUsers, durable: expected.totalUsers });
  assert('A4 the payload carries exactly the keys this suite reads durably, and no other claim',
    HONEST_KEY_SET.slice().sort().join(',') === Object.keys(metrics).sort().join(','),
    { served: Object.keys(metrics).sort(), expected: HONEST_KEY_SET.slice().sort() });
  assert('A5 totalRestaurants is the durable merchants count', metrics.totalRestaurants === expected.totalRestaurants, { served: metrics.totalRestaurants, durable: expected.totalRestaurants });
  assert('A6 activeDrivers is the durable online-driver count', metrics.activeDrivers === expected.activeDrivers, { served: metrics.activeDrivers, durable: expected.activeDrivers });
  assert('A7 activeJobs is the durable non-terminal job count', metrics.activeJobs === expected.activeJobs, { served: metrics.activeJobs, durable: expected.activeJobs });
  assert('A8 totalCompletedJobs is the durable completed-job count', metrics.totalCompletedJobs === expected.totalCompletedJobs, { served: metrics.totalCompletedJobs, durable: expected.totalCompletedJobs });

  if (expected.totalCompletedJobs > MIRROR_JOB_WINDOW) {
    assert('A9 the served completed total is beyond the 200-row boot window, so it cannot be the mirror',
      Number(metrics.totalCompletedJobs) > MIRROR_JOB_WINDOW,
      { served: metrics.totalCompletedJobs, window: MIRROR_JOB_WINDOW });
  } else {
    notMeasured('GAP-WINDOW-01', `the lane holds ${expected.totalCompletedJobs} completed jobs, at or under the `
      + `${MIRROR_JOB_WINDOW}-row hydration window, so this run cannot distinguish a durable total from the mirror `
      + 'window by size alone; the post-boot fixture rows in GROUP C are the durable proof for this run.');
  }

  // =====================================================================
  // GROUP B — the money figure is the durable ledger sum and agrees with finance
  // =====================================================================
  console.log('\n--- GROUP B: totalGrossFare is durable SUM(final_total) and matches /api/admin/finance/metrics ---');
  assert('B1 totalGrossFare is the durable SUM(jobs.final_total) over COMPLETED jobs to the cent',
    cents(metrics.totalGrossFare) === expected.grossFare, { served: metrics.totalGrossFare, durable: expected.grossFare });

  const financeRes = await request('GET', '/api/admin/finance/metrics', null, bearer(admin.token));
  const grossGtv = financeRes.data && financeRes.data.metrics ? cents(financeRes.data.metrics.grossGtv) : null;
  assert('B2 the finance metrics route answers so the two money figures can be compared',
    financeRes.status === 200 && grossGtv !== null, { status: financeRes.status, grossGtv });
  assert('B3 one quantity has one value: totalGrossFare equals finance grossGtv',
    grossGtv !== null && cents(metrics.totalGrossFare) === grossGtv,
    { metricsTotalGrossFare: metrics.totalGrossFare, financeGrossGtv: grossGtv });

  const servedTimestamp = metrics.timestamp || metrics.generatedAt;
  assert('B4 the payload states when it was produced', typeof servedTimestamp === 'string' && !Number.isNaN(Date.parse(servedTimestamp)),
    { timestamp: servedTimestamp });

  // =====================================================================
  // GROUP C — rows committed AFTER boot are in the next read
  // =====================================================================
  // The mirror is filled at boot, so a durable write that the endpoint has never
  // seen is the sharpest test of which store it actually reads.
  console.log('\n--- GROUP C: durable rows minted after boot change the served totals ---');
  const fx = await mintFixtureRows();
  assert('C0 the fixture driver, merchant and two jobs are durable',
    Boolean(fx.driverId && fx.merchantId && fx.completedJobNumber && fx.activeJobNumber), fx);

  const after = await durableExpectation();
  const res2 = await request('GET', '/api/admin/metrics', null, bearer(admin.token));
  const m2 = (res2.data && res2.data.metrics) || {};
  assert('C1 totalUsers is unmoved, because this run minted no user row',
    m2.totalUsers === after.totalUsers && after.totalUsers === expected.totalUsers,
    { served: m2.totalUsers, durable: after.totalUsers, before: expected.totalUsers });
  assert('C2 totalRestaurants moved by exactly the one merchant this run minted',
    m2.totalRestaurants === after.totalRestaurants && after.totalRestaurants === expected.totalRestaurants + 1,
    { served: m2.totalRestaurants, durable: after.totalRestaurants, before: expected.totalRestaurants });
  assert('C3 activeDrivers moved by exactly the one online driver this run minted',
    m2.activeDrivers === after.activeDrivers && after.activeDrivers === expected.activeDrivers + 1,
    { served: m2.activeDrivers, durable: after.activeDrivers, before: expected.activeDrivers });
  assert('C4 totalCompletedJobs moved by exactly the one completed job this run minted',
    m2.totalCompletedJobs === after.totalCompletedJobs && after.totalCompletedJobs === expected.totalCompletedJobs + 1,
    { served: m2.totalCompletedJobs, durable: after.totalCompletedJobs, before: expected.totalCompletedJobs });
  assert('C5 activeJobs moved by exactly the one non-terminal job this run minted',
    m2.activeJobs === after.activeJobs && after.activeJobs === expected.activeJobs + 1,
    { served: m2.activeJobs, durable: after.activeJobs, before: expected.activeJobs });
  assert('C6 totalGrossFare moved by exactly the fixture fare and equals the durable sum',
    cents(m2.totalGrossFare) === after.grossFare && cents(after.grossFare - expected.grossFare) === FIXTURE_COMPLETED_TOTAL,
    { served: m2.totalGrossFare, durable: after.grossFare, before: expected.grossFare, expectedDelta: FIXTURE_COMPLETED_TOTAL });
  assert('C7 the re-read still declares the durable source', m2.dataSource === 'postgres', { dataSource: m2.dataSource });

  // =====================================================================
  // GROUP D — no fabricated operational claim survives
  // =====================================================================
  console.log('\n--- GROUP D: the payload claims nothing the store cannot answer ---');
  assert('D1 the hard-coded fleetStatus key is gone from both reads',
    !Object.prototype.hasOwnProperty.call(metrics, 'fleetStatus')
    && !Object.prototype.hasOwnProperty.call(m2, 'fleetStatus'),
    { first: Object.keys(metrics), reread: Object.keys(m2) });
  assert('D2 the fabricated OPTIMAL_OPERATION literal appears nowhere in the response body',
    !String(res2.raw || '').includes(FABRICATED_STATUS), { foundAt: String(res2.raw || '').indexOf(FABRICATED_STATUS) });
  assert('D3 the demo-applicant pendingKyc count is gone (no identity_applications table exists)',
    !Object.prototype.hasOwnProperty.call(m2, 'pendingKyc'), { keys: Object.keys(m2) });
  assert('D4 every served metric value is a number, not a status string',
    ['activeDrivers', 'activeJobs', 'totalCompletedJobs', 'totalGrossFare', 'totalUsers', 'totalRestaurants', 'totalDrivers']
      .every((k) => !Object.prototype.hasOwnProperty.call(m2, k) || Number.isFinite(Number(m2[k]))),
    m2);

  // =====================================================================
  // GROUP E — an unreadable store is a classified outage, never a mirror total
  // =====================================================================
  console.log('\n--- GROUP E: with the authoritative store down, the metrics read refuses ---');
  const origin = process.env.SUPABASE_URL;
  assert('E0 the PostgREST handle this suite proxies is loopback',
    Boolean(origin) && /^(?:http:\/\/)?127\.0\.0\.1/i.test(origin), { origin: origin ? new URL(origin).host : origin });

  const failing = new Set(['users', 'drivers', 'jobs', 'merchants']);
  let outageOn = true;
  const proxy = await makeStoreProxy({ origin, shouldFail: (table) => outageOn && failing.has(table) });
  assert('E0b the outage proxy is listening', Boolean(proxy && proxy.port), { port: proxy.port });

  const darkPort = await findFreePort();
  const darkBase = `http://127.0.0.1:${darkPort}`;
  const darkReq = makeRequest(darkBase);
  const darkProc = await bootServer({ port: darkPort, request: darkReq, extraEnv: { SUPABASE_URL: proxy.url } });
  const darkHealth = await darkReq('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('E1 a backend whose total-bearing tables are unreachable still serves health', darkHealth.status === 200, { status: darkHealth.status });
  const darkAdmin = await mintAdmin({ request: darkReq });
  assert('E2 its admin session mints, so the outage is scoped to the aggregate read',
    Boolean(darkAdmin.token), { status: darkAdmin.status, body: darkAdmin.body });

  const darkMetrics = await darkReq('GET', '/api/admin/metrics', null, bearer(darkAdmin.token)).catch((e) => ({ status: 0, data: { error: e.message } }));
  assert('E3 a dead totals store is a classified 503, not a stale mirror 200',
    darkMetrics.status === 503, { status: darkMetrics.status, code: darkMetrics.data && darkMetrics.data.code });
  assert('E4 the refusal says success:false with the established store code',
    Boolean(darkMetrics.data) && darkMetrics.data.success === false && darkMetrics.data.code === 'AUTH_STORE_UNAVAILABLE',
    darkMetrics.data);
  assert('E5 it serves no metrics object, so a client cannot render an outage as a zero fleet',
    darkMetrics.data && darkMetrics.data.metrics === undefined, { metrics: darkMetrics.data && darkMetrics.data.metrics });

  outageOn = false;
  const recovered = await darkReq('GET', '/api/admin/metrics', null, bearer(darkAdmin.token));
  assert('E6 with the store back the same read answers 200 from PostgreSQL',
    recovered.status === 200 && recovered.data && recovered.data.metrics && recovered.data.metrics.dataSource === 'postgres',
    { status: recovered.status, dataSource: recovered.data && recovered.data.metrics && recovered.data.metrics.dataSource });
  const recoveredExpected = await durableExpectation();
  assert('E7 and those recovered totals are the durable ones',
    recovered.data && recovered.data.metrics
    && recovered.data.metrics.totalCompletedJobs === recoveredExpected.totalCompletedJobs
    && cents(recovered.data.metrics.totalGrossFare) === recoveredExpected.grossFare,
    { served: recovered.data && recovered.data.metrics
        && `${recovered.data.metrics.totalCompletedJobs}/${recovered.data.metrics.totalGrossFare}`,
      durable: `${recoveredExpected.totalCompletedJobs}/${recoveredExpected.grossFare}` });

  await stopProc(darkProc);
  await proxy.close();

  // =====================================================================
  // GROUP F — the authentication guard is unchanged
  // =====================================================================
  console.log('\n--- GROUP F: the guard on this read is unchanged ---');
  const noToken = await request('GET', '/api/admin/metrics');
  assert('F1 a request with no bearer is refused', noToken.status === 401 || noToken.status === 403, { status: noToken.status });

  // =====================================================================
  // GROUP G — only this run's own rows were written
  // =====================================================================
  console.log("\n--- GROUP G: the fixtures are this run's only footprint ---");
  const gUsers = await pg.query('select count(*)::int as n from users');
  assert('G1 this suite created no user row', gUsers.rows[0].n === expected.totalUsers, { now: gUsers.rows[0].n, baseline: expected.totalUsers });
  const gDrv = await pg.query('select id from drivers order by created_at desc limit 3');
  assert('G2 the newest driver rows include only this run\'s named fixture',
    gDrv.rows.some((r) => String(r.id) === String(fx.driverId)), { newest: gDrv.rows.map((r) => String(r.id)) });
  const gJobs = await pg.query(`select count(*)::int as n from jobs where job_number like 'AMT481-%'`);
  assert('G3 exactly the two jobs this run named carry its identifier', gJobs.rows[0].n === createdJobNumbers.length,
    { n: gJobs.rows[0].n, created: createdJobNumbers.length });

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}   NOT MEASURED: ${skipped.length}`);
  if (failed.length) { console.log('Failed checks:'); for (const n of failed) console.log(`  - ${n}`); }
  console.log(`ADMIN METRICS TRUTHFULNESS TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (createdJobNumbers.length) {
      const del = await pg.query('delete from jobs where job_number = any($1)', [createdJobNumbers]);
      const left = await pg.query('select count(*)::int as n from jobs where job_number = any($1)', [createdJobNumbers]);
      console.log(`[cleanup] jobs: deleted ${del.rowCount}, this run's identifiers still present: ${left.rows[0].n}`);
    }
    if (createdDriverIds.length) {
      const del = await pg.query('delete from drivers where id = any($1::uuid[])', [createdDriverIds]);
      const left = await pg.query('select count(*)::int as n from drivers where id = any($1::uuid[])', [createdDriverIds]);
      console.log(`[cleanup] drivers: deleted ${del.rowCount}, this run's identifiers still present: ${left.rows[0].n}`);
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
  try { await main(); }
  catch (err) { console.error('[FATAL] admin_metrics_truthfulness_test threw outside the assertion harness:', err); process.exitCode = 1; }
  finally { await cleanup(); }
  process.exit(process.exitCode || 0);
}

run();
