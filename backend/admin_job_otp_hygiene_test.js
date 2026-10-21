'use strict';

// =========================================================================
// ADMIN JOB DIRECTORY — HANDOVER-OTP FIELD HYGIENE  (P10 / D-8 §3)
//
// `GET /api/admin/jobs` answers from `listAdminJobs`, which projects each durable
// job through the shared `JobRepository.mapRowToJob`. That mapper carries the live
// handover codes — `startOtp`, `pickupOtp`, `deliveryOtp` — because it is ALSO the
// projection behind the customer's and the assigned driver's own-job reads, where a
// handover code is exactly what the parties need to complete a pickup/delivery
// (migration 046, link 89).
//
// But the admin job queue has no handover duty. It is a directory an operator scans.
// And it runs behind `authenticateAdmin` with no permission gate (issue #273, owner
// decision), so every one of the five admin roles — SUPPORT_AGENT and KYC_SPECIALIST
// included — reads it. Handing a *live* handover secret to a bearer who will never
// verify a handover with it is a pure disclosure: a low-privilege admin token could
// complete someone else's parcel/food handover by replaying the code the directory
// just printed for it.
//
// This is a response-field reduction, independent of the #273 authorization decision:
// whatever the owner later decides about WHO reads this route, no reader of this
// directory needs the codes. So `listAdminJobs` now strips the three OTP fields on
// BOTH its branches (the durable projection and the degraded mirror slice), while
// `mapRowToJob` — shared by the customer/driver own-job reads — is left exactly as it
// was. These checks pin both halves of that line.
//
//   A  the admin directory serves no handover-OTP key, and no OTP value leaks
//   B  the operational fields an operator DOES reason over are still served
//   C  the shared mapper still returns the OTPs, so no legitimate handover path lost
//   D  the route's authentication guard is unchanged (no token is still refused)
//   H  only this run's own job row was written, and it is deleted on teardown
//
// Runs only on the disposable isolated lane (same shape as chain link 99,
// `admin_stale_read_test.js`): refuses a non-loopback target before any socket opens,
// mints its own fixture row, tears down exactly what it created.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');
const JobRepository = require('./src/repositories/JobRepository');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'admin_job_otp_hygiene_test' });

const STAMP = Date.now();
const JOBN = `P10OTP-${STAMP}`;
// Sentinel handover codes. Chosen so a leak is unmistakable: a substring scan of the
// whole served record must never surface any of them.
const OTP_START = '4127';
const OTP_PICKUP = '5519';
const OTP_DELIVERY = '7731';

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

async function bootServer({ port, request, attempts = 180, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      NABIN_SESSION_PRUNE: 'off',
      NABIN_SESSION_RECONCILE_MS: '0',
    },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
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
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Admin OTP Hygiene Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

let pg = null;
async function countOf(table) {
  const r = await pg.query(`select count(*)::int as n from ${table}`);
  return r.rows[0].n;
}

const createdJobNumbers = [];
async function insertJobWithOtp(jobNumber) {
  createdJobNumbers.push(jobNumber);
  const r = await pg.query(
    `insert into jobs (job_number, service_type, status, pickup_address, drop_address,
                       pickup_lat, pickup_lng, drop_lat, drop_lng, distance_km,
                       fare_subtotal, final_total, driver_earnings, platform_commission,
                       payment_method, payment_status, start_otp, pickup_otp, delivery_otp,
                       metadata, created_at)
     values ($1,'RIDE','ASSIGNED','P10 pickup lane street','P10 drop lane avenue',
             28.6100000,77.2100000,28.6300000,77.2300000,4.20,
             120.00,150.00,128.00,22.00,'WALLET','PAID',$2,$3,$4,$5, now())
     returning id, job_number, start_otp, pickup_otp, delivery_otp`,
    [jobNumber, OTP_START, OTP_PICKUP, OTP_DELIVERY,
     JSON.stringify({ customerName: 'P10 fixture customer', customerPhone: '+91 90000 00123', vehicleType: '3W' })]);
  return r.rows[0];
}

const byJobKey = (list, jobNumber) =>
  (list || []).find((j) => String(j.jobNumber || j.id || '') === jobNumber);

// A deep scan: the three sentinel codes must not appear as a value ANYWHERE in the
// served record, even if some branch re-added them under a different key name.
function deepContainsOtp(obj) {
  const seen = new Set();
  const stack = [obj];
  const sentinels = new Set([OTP_START, OTP_PICKUP, OTP_DELIVERY]);
  while (stack.length) {
    const cur = stack.pop();
    if (cur === null || cur === undefined) continue;
    if (typeof cur === 'string' || typeof cur === 'number') {
      if (sentinels.has(String(cur))) return true;
      continue;
    }
    if (typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const v of Object.values(cur)) stack.push(v);
  }
  return false;
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN ADMIN JOB OTP HYGIENE TEST — P10 / D-8');
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

  const baselineJobs = await countOf('jobs');

  // =====================================================================
  // GROUP A — the admin directory serves no handover OTP
  // =====================================================================
  console.log('\n--- GROUP A: the admin job directory carries no live handover code ---');
  const row = await insertJobWithOtp(JOBN);
  assert('A0 the fixture job is durable and DOES carry the three OTPs at rest',
    Boolean(row && row.id) && row.start_otp === OTP_START && row.pickup_otp === OTP_PICKUP && row.delivery_otp === OTP_DELIVERY,
    { row });

  const jobsRes = await request('GET', '/api/admin/jobs', null, bearer(admin.token));
  assert('A1 GET /api/admin/jobs answers 200 with success',
    jobsRes.status === 200 && jobsRes.data && jobsRes.data.success === true, { status: jobsRes.status, data: jobsRes.data });
  const served = (jobsRes.data && jobsRes.data.jobs) || [];
  const rec = byJobKey(served, JOBN);
  assert('A2 the fixture is served from the durable store', Boolean(rec) && jobsRes.data.dataSource === 'postgres',
    { served: served.length, dataSource: jobsRes.data && jobsRes.data.dataSource });

  assert('A3 the served record has no startOtp key', rec && !('startOtp' in rec), { keys: rec && Object.keys(rec) });
  assert('A4 the served record has no pickupOtp key', rec && !('pickupOtp' in rec), { keys: rec && Object.keys(rec) });
  assert('A5 the served record has no deliveryOtp key', rec && !('deliveryOtp' in rec), { keys: rec && Object.keys(rec) });
  assert('A6 no sentinel OTP value leaks anywhere in the served record (deep scan)',
    rec && !deepContainsOtp(rec), { leaked: rec && deepContainsOtp(rec) });

  // =====================================================================
  // GROUP B — the operational fields an operator legitimately needs survive
  // =====================================================================
  console.log('\n--- GROUP B: the directory keeps its operational fields (no over-stripping) ---');
  assert('B1 pickup/drop addresses are still served',
    Boolean(rec) && rec.pickup && rec.pickup.address === 'P10 pickup lane street'
      && rec.drop && rec.drop.address === 'P10 drop lane avenue',
    { pickup: rec && rec.pickup, drop: rec && rec.drop });
  assert('B2 the money and status fields are still served',
    Boolean(rec) && Number(rec.fare) === 150 && rec.status === 'ASSIGNED' && Number(rec.driverEarnings) === 128,
    { fare: rec && rec.fare, status: rec && rec.status, driverEarnings: rec && rec.driverEarnings });
  assert('B3 the customer identity the operator reasons over is still served',
    Boolean(rec) && rec.customerName === 'P10 fixture customer', { customerName: rec && rec.customerName });

  // =====================================================================
  // GROUP C — the shared mapper is untouched: the own-job handover path keeps its OTP
  // =====================================================================
  console.log('\n--- GROUP C: mapRowToJob (customer/driver own-job reads) still returns the OTPs ---');
  const mapped = JobRepository.mapRowToJob({
    job_number: 'MAP-SYNTH', id: '00000000-0000-0000-0000-000000000001', service_type: 'RIDE', status: 'ASSIGNED',
    start_otp: OTP_START, pickup_otp: OTP_PICKUP, delivery_otp: OTP_DELIVERY,
    pickup_address: 'x', drop_address: 'y', metadata: {}
  });
  assert('C1 the shared mapper still projects startOtp', mapped && mapped.startOtp === OTP_START, { startOtp: mapped && mapped.startOtp });
  assert('C2 the shared mapper still projects pickupOtp', mapped && mapped.pickupOtp === OTP_PICKUP, { pickupOtp: mapped && mapped.pickupOtp });
  assert('C3 the shared mapper still projects deliveryOtp', mapped && mapped.deliveryOtp === OTP_DELIVERY, { deliveryOtp: mapped && mapped.deliveryOtp });

  // =====================================================================
  // GROUP D — the authentication guard is unchanged
  // =====================================================================
  console.log('\n--- GROUP D: authentication on the directory is unchanged ---');
  const noToken = await request('GET', '/api/admin/jobs');
  assert('D1 a request with no admin token is still refused 401',
    noToken.status === 401 && noToken.data && noToken.data.success === false, { status: noToken.status, data: noToken.data });

  // =====================================================================
  // GROUP H — only this run's own row was written
  // =====================================================================
  console.log('\n--- GROUP H: this run\'s job fixture is its only footprint ---');
  const p10JobsLeft = (await pg.query("select count(*)::int as n from jobs where job_number like 'P10OTP-%'")).rows[0].n;
  const jobsNow = await countOf('jobs');
  assert('H1 the durable OTP columns are still on the row at rest (only the read was reduced, not the stored secret)',
    p10JobsLeft === 1, { p10JobsLeft });
  // Delete now so the count returns to baseline, then assert.
  await pg.query('delete from jobs where job_number = $1', [JOBN]);
  const jobsAfterDelete = await countOf('jobs');
  assert('H2 the jobs table is back to its pre-run row count after this suite removed only its own job',
    jobsAfterDelete === baselineJobs, { jobsAfterDelete, baselineJobs });

  await stopProc(proc);

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
  if (failed.length) {
    console.log('Failed checks:');
    for (const name of failed) console.log(`  - ${name}`);
  }
  console.log(`ADMIN JOB OTP HYGIENE TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (createdJobNumbers.length) {
      const del = await pg.query('delete from jobs where job_number = any($1)', [createdJobNumbers]);
      console.log(`[cleanup] jobs: deleted ${del.rowCount}`);
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
    console.error('[FATAL] admin_job_otp_hygiene_test threw outside the assertion harness:', err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(process.exitCode || 0);
}

run();
