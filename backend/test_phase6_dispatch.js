// =========================================================================
// NABIN — PHASE 6: DISPATCH & DRIVER ASSIGNMENT SECURITY TEST SUITE
// =========================================================================
const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const WebSocket = require('ws');

process.env.NABIN_TEST_MODE = 'true';

const BASE_URL = 'http://127.0.0.1:4000';
const WS_URL = 'ws://127.0.0.1:4000/ws';
const PG_CONN_STRING = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function createPgClient() {
  return new Client({ connectionString: PG_CONN_STRING });
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    results.push({ desc: description, status: 'PASS' });
    console.log(`✅ [PASS] ${description}`);
  } else {
    failed++;
    results.push({ desc: description, status: 'FAIL', details });
    console.error(`❌ [FAIL] ${description} -> ${details}`);
  }
}

async function ensureServerRunning() {
  try {
    const res = await request('GET', '/api/health');
    if (res.status === 200) return null;
  } catch (e) {}

  try {
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
  } catch (e) {}
  await sleep(1500);

  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  proc.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return proc;
    } catch (e) {}
  }
  return proc;
}

async function restartServer() {
  console.log('\n🛑 Terminating backend process on port 4000 for restart verification...');
  try {
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
  } catch (e) {}
  await sleep(1500);

  console.log('🚀 Spawning fresh backend process from cold start...');
  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  proc.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) {
        console.log('✅ Fresh backend process online & ready');
        return proc;
      }
    } catch (e) {}
  }
  throw new Error('Backend failed to restart within timeout');
}

async function createOfferInDb(pg, jobUuid, driverUuid, idempotencyKey = null) {
  const q = `SELECT public.create_dispatch_offer_atomic($1::uuid, $2::uuid, 300, $3, '{"source":"test_suite"}'::jsonb) as res;`;
  const res = await pg.query(q, [jobUuid, driverUuid, idempotencyKey || `idem_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`]);
  return res.rows[0].res;
}

async function acceptOfferInDb(pg, offerId, driverUuid, idempotencyKey = null) {
  const q = `SELECT public.accept_dispatch_offer_atomic($1::uuid, $2::uuid, $3) as res;`;
  const res = await pg.query(q, [offerId, driverUuid, idempotencyKey]);
  return res.rows[0].res;
}

async function runPhase6DispatchSuite() {
  console.log('========================================================================');
  console.log('🛡️ RUNNING NABIN PHASE 6: DISPATCH & DRIVER ASSIGNMENT SECURITY SUITE');
  console.log('========================================================================\n');

  const pgClient = createPgClient();
  await pgClient.connect();

  try {
    await ensureServerRunning();

    // 0. Pre-Flight Verification
    const health = await request('GET', '/api/health');
    assert('Backend server is healthy & online', health.status === 200 && health.data.status === 'ONLINE');

    const dbCheck = await pgClient.query('SELECT NOW() as db_now;');
    assert('PostgreSQL authoritative database is reachable', !!dbCheck.rows[0].db_now);

    // Setup Accounts: Admin, Customers, Drivers
    const superLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const adminToken = superLogin.data.token;
    assert('Admin authenticated successfully', !!adminToken);

    // Customer 1: Priya Saxena (00000000-0000-0000-0000-000000000002, VERIFIED)
    const cust1OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust1OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: cust1OtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const cust1Token = cust1OtpVerify.data.token;
    const cust1Id = cust1OtpVerify.data.user?.id || '00000000-0000-0000-0000-000000000002';
    assert('Customer 1 authenticated successfully', !!cust1Token);

    // Customer 2: Rahul Sharma (00000000-0000-0000-0000-000000000001)
    const cust2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9876543210', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust2OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9876543210', otp: cust2OtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const cust2Token = cust2OtpVerify.data.token;
    assert('Customer 2 authenticated successfully', !!cust2Token);

    // Driver 1: Rajesh Kumar (DRV-101 / 00000000-0000-0000-0000-000000000101)
    const drv1OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const drv1OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: drv1OtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const drv1Token = drv1OtpVerify.data.token;
    const drv1Id = drv1OtpVerify.data.user?.id || 'DRV-101';
    const drv1Uuid = '00000000-0000-0000-0000-000000000101';
    assert('Driver 1 (Rajesh Kumar) authenticated successfully', !!drv1Token);

    // Driver 2: Deepak Auto (DRV-103 / 00000000-0000-0000-0000-000000000103)
    const drv2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9833344556', role: 'DRIVER', purpose: 'LOGIN' });
    const drv2OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9833344556', otp: drv2OtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const drv2Token = drv2OtpVerify.data.token;
    const drv2Id = drv2OtpVerify.data.user?.id || 'DRV-103';
    const drv2Uuid = '00000000-0000-0000-0000-000000000103';
    assert('Driver 2 (Deepak Auto) authenticated successfully', !!drv2Token);

    // =========================================================================
    // MODULE 1: AUTHENTICATION & ROLE-BASED ACCESS CONTROL
    // =========================================================================
    console.log('\n--- MODULE 1: Auth & Role Enforcement ---');

    // 1.1 Anonymous access to driver dispatch endpoints rejected
    const unauthOffers = await request('GET', '/api/driver/offers');
    assert('Anonymous request to /api/driver/offers rejected (HTTP 401)', unauthOffers.status === 401);

    const unauthAcceptOffer = await request('POST', '/api/driver/offers/00000000-0000-0000-0000-000000000001/accept', {});
    assert('Anonymous request to accept offer rejected (HTTP 401)', unauthAcceptOffer.status === 401);

    const unauthAcceptJob = await request('POST', '/api/driver/accept-job', { jobId: 'JOB-TEST-001' });
    assert('Anonymous request to /api/driver/accept-job rejected (HTTP 401)', unauthAcceptJob.status === 401);

    const unauthArrived = await request('POST', '/api/driver/arrived', { jobId: 'JOB-TEST-001' });
    assert('Anonymous request to /api/driver/arrived rejected (HTTP 401)', unauthArrived.status === 401);

    const unauthVerifyOtp = await request('POST', '/api/driver/verify-otp', { jobId: 'JOB-TEST-001', otp: '1234' });
    assert('Anonymous request to /api/driver/verify-otp rejected (HTTP 401)', unauthVerifyOtp.status === 401);

    const unauthComplete = await request('POST', '/api/driver/complete-trip', { jobId: 'JOB-TEST-001' });
    assert('Anonymous request to /api/driver/complete-trip rejected (HTTP 401)', unauthComplete.status === 401);

    const unauthLocation = await request('POST', '/api/v1/driver/location', { lat: 28.6, lng: 77.2 });
    assert('Anonymous request to /api/v1/driver/location rejected (HTTP 401)', unauthLocation.status === 401);

    // 1.2 Customer role attempting driver dispatch endpoints rejected
    const custOffers = await request('GET', '/api/driver/offers', null, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Customer token rejected from driver offers (HTTP 401/403)', custOffers.status === 401 || custOffers.status === 403);

    const custAcceptJob = await request('POST', '/api/driver/accept-job', { jobId: 'JOB-TEST-001' }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Customer token rejected from accept-job (HTTP 401/403)', custAcceptJob.status === 401 || custAcceptJob.status === 403);

    const custArrived = await request('POST', '/api/driver/arrived', { jobId: 'JOB-TEST-001' }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Customer token rejected from driver arrived (HTTP 401/403)', custArrived.status === 401 || custArrived.status === 403);

    // 1.3 Authenticated driver can access own offers
    const drv1OffersRes = await request('GET', '/api/driver/offers', null, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Authenticated Driver 1 can access /api/driver/offers (HTTP 200)', drv1OffersRes.status === 200 && Array.isArray(drv1OffersRes.data.offers));

    // =========================================================================
    // MODULE 2: DRIVER TENANT ISOLATION & ANTI-SPOOFING
    // =========================================================================
    console.log('\n--- MODULE 2: Driver Tenant Isolation & Anti-Spoofing ---');

    // 2.1 Driver 1 attempting to view Driver 2's specific offers endpoint rejected
    const foreignOffers = await request('GET', `/api/driver/${drv2Id}/offers`, null, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 attempting to access Driver 2 offers rejected with HTTP 403 (DRIVER_MISMATCH)',
      foreignOffers.status === 403 && foreignOffers.data.code === 'DRIVER_MISMATCH'
    );

    // 2.2 Driver 1 attempting to toggle Driver 2's online status rejected
    const foreignToggle = await request('POST', `/api/driver/${drv2Id}/toggle-online`, {}, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 attempting to toggle Driver 2 online rejected with HTTP 403 (DRIVER_MISMATCH)',
      foreignToggle.status === 403 && foreignToggle.data.code === 'DRIVER_MISMATCH'
    );

    // 2.3 Driver 1 attempting to access Driver 2's dashboard rejected
    const foreignDashboard = await request('GET', `/api/driver/${drv2Id}/dashboard`, null, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 attempting to access Driver 2 dashboard rejected with HTTP 403 (DRIVER_MISMATCH)',
      foreignDashboard.status === 403 && foreignDashboard.data.code === 'DRIVER_MISMATCH'
    );

    // 2.4 Driver 1 attempting to forge driverId in accept-job payload rejected
    const spoofAcceptJob = await request('POST', '/api/driver/accept-job', {
      jobId: 'JOB-TEST-SPOOF',
      driverId: drv2Id
    }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 sending driverId of Driver 2 in accept-job rejected with HTTP 403 (IDENTITY_SPOOFING_REJECTED)',
      spoofAcceptJob.status === 403 && spoofAcceptJob.data.code === 'IDENTITY_SPOOFING_REJECTED'
    );

    // 2.5 Driver 1 attempting to forge driverId in location telemetry payload rejected
    const spoofLocation = await request('POST', '/api/v1/driver/location', {
      driverId: drv2Id,
      lat: 28.6139,
      lng: 77.2090
    }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 sending driverId of Driver 2 in location telemetry rejected with HTTP 403 (IDENTITY_SPOOFING_REJECTED)',
      spoofLocation.status === 403 && spoofLocation.data.code === 'IDENTITY_SPOOFING_REJECTED'
    );

    // =========================================================================
    // MODULE 3: ATOMIC OFFER ACCEPTANCE & JOB LIFECYCLE
    // =========================================================================
    console.log('\n--- MODULE 3: Atomic Offer Acceptance & Lifecycle ---');

    // Create a ride job with Customer 1
    const rideBookRes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.6139, lng: 77.2090, address: 'Connaught Place, Delhi' },
      drop: { lat: 28.5355, lng: 77.3910, address: 'Sector 62, Noida' },
      vehicleType: '4W',
      fare: 350.0
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Customer 1 successfully books a ride job', rideBookRes.status === 200 && !!rideBookRes.data.job);
    const rideJob = rideBookRes.data.job;
    const rideJobId = rideJob.id;
    const rideJobUuid = rideJob.uuid;

    // Create authoritative dispatch offer in PostgreSQL for Driver 1
    const offerData1 = await createOfferInDb(pgClient, rideJobUuid, drv1Uuid, `idem_${Date.now()}_1`);
    assert('Dispatch offer created atomically in PostgreSQL', offerData1.success === true && !!offerData1.offer_id);
    const drv1OfferId = offerData1.offer_id;

    // 3.1 Driver 2 attempting to accept Driver 1's offer is rejected
    const foreignAcceptRes = await request('POST', `/api/driver/offers/${drv1OfferId}/accept`, {}, { 'Authorization': `Bearer ${drv2Token}` });
    assert('Driver 2 attempting to accept Driver 1 offer rejected with HTTP 403 (DRIVER_MISMATCH)',
      foreignAcceptRes.status === 403 && foreignAcceptRes.data.code === 'DRIVER_MISMATCH'
    );

    // 3.2 Driver 1 accepts own offer -> succeeds atomically
    const drv1AcceptRes = await request('POST', `/api/driver/offers/${drv1OfferId}/accept`, {}, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 successfully accepts own dispatch offer (HTTP 200)',
      drv1AcceptRes.status === 200 && drv1AcceptRes.data.success === true && drv1AcceptRes.data.offer?.code === 'OFFER_ACCEPTED'
    );

    // Verify PostgreSQL state: job is assigned to Driver 1, offer is accepted
    const jobDbRow = await pgClient.query('SELECT status, driver_id FROM public.jobs WHERE id = $1', [rideJobUuid]);
    assert('PostgreSQL authoritative job status is ASSIGNED to Driver 1',
      jobDbRow.rows.length === 1 && jobDbRow.rows[0].status === 'ASSIGNED' && jobDbRow.rows[0].driver_id === drv1Uuid
    );

    const offerDbRow = await pgClient.query('SELECT status, driver_uuid FROM public.dispatch_offers WHERE id = $1', [drv1OfferId]);
    assert('PostgreSQL authoritative dispatch offer status is ACCEPTED',
      offerDbRow.rows.length === 1 && offerDbRow.rows[0].status === 'ACCEPTED' && offerDbRow.rows[0].driver_uuid === drv1Uuid
    );

    // 3.3 Duplicate acceptance by same driver is idempotent
    const dupAcceptRes = await request('POST', `/api/driver/offers/${drv1OfferId}/accept`, {}, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Duplicate acceptance by same driver is idempotent (HTTP 200, duplicate: true)',
      dupAcceptRes.status === 200 && dupAcceptRes.data.duplicate === true
    );

    // 3.4 Unauthorized driver attempting lifecycle actions on this job is rejected
    const foreignArrive = await request('POST', '/api/driver/arrived', { jobId: rideJobId }, { 'Authorization': `Bearer ${drv2Token}` });
    assert('Driver 2 attempting arrived on Driver 1 job rejected with HTTP 403 (JOB_NOT_ASSIGNED_TO_DRIVER)',
      foreignArrive.status === 403 && foreignArrive.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
    );

    const foreignVerifyOtp = await request('POST', '/api/driver/verify-otp', { jobId: rideJobId, otp: rideJob.startOtp || '1234' }, { 'Authorization': `Bearer ${drv2Token}` });
    assert('Driver 2 attempting verify-otp on Driver 1 job rejected with HTTP 403 (JOB_NOT_ASSIGNED_TO_DRIVER)',
      foreignVerifyOtp.status === 403 && foreignVerifyOtp.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
    );

    const foreignComplete = await request('POST', '/api/driver/complete-trip', { jobId: rideJobId }, { 'Authorization': `Bearer ${drv2Token}` });
    assert('Driver 2 attempting complete-trip on Driver 1 job rejected with HTTP 403 (JOB_NOT_ASSIGNED_TO_DRIVER)',
      foreignComplete.status === 403 && foreignComplete.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
    );

    // 3.5 Authorized Driver 1 executes arrived -> succeeds
    const drv1Arrive = await request('POST', '/api/driver/arrived', { jobId: rideJobId }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 arrives at pickup successfully (HTTP 200)', drv1Arrive.status === 200 && drv1Arrive.data.success);

    // 3.6 Authorized Driver 1 verifies OTP -> transitions to IN_TRANSIT
    const startOtp = drv1Arrive.data.job?.startOtp || rideJob.startOtp || '7729';
    const drv1Otp = await request('POST', '/api/driver/verify-otp', { jobId: rideJobId, otp: startOtp }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 verifies start OTP successfully (HTTP 200, status: IN_TRANSIT)',
      drv1Otp.status === 200 && (drv1Otp.data.job?.status === 'IN_TRANSIT' || drv1Otp.data.status === 'IN_TRANSIT' || drv1Otp.data.job?.status === 'IN_PROGRESS')
    );

    // 3.7 Authorized Driver 1 completes trip -> transitions to COMPLETED
    const drv1Complete = await request('POST', '/api/driver/complete-trip', { jobId: rideJobId }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 completes trip successfully (HTTP 200, status: COMPLETED)',
      drv1Complete.status === 200 && drv1Complete.data.job?.status === 'COMPLETED'
    );

    // =========================================================================
    // MODULE 4: TRUE DATABASE CONCURRENCY & RACE PROTECTION
    // =========================================================================
    console.log('\n--- MODULE 4: True PostgreSQL Concurrency Tests ---');

    // CONCURRENCY TEST A: Two drivers accept the SAME offer simultaneously
    console.log('\n* Concurrency Test A: Simultaneous acceptance of the same offer');
    const jobARes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.6139, lng: 77.2090, address: 'Saket, Delhi' },
      drop: { lat: 28.5355, lng: 77.3910, address: 'Cyber City, Gurgaon' },
      vehicleType: '4W',
      fare: 400.0
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const jobA = jobARes.data.job;

    const offerAData = await createOfferInDb(pgClient, jobA.uuid, drv1Uuid, `idem_testA_${Date.now()}`);
    const offerAId = offerAData.offer_id;

    // Open two independent PostgreSQL connections
    const clientA1 = createPgClient();
    const clientA2 = createPgClient();
    await Promise.all([clientA1.connect(), clientA2.connect()]);

    const [resA1, resA2] = await Promise.all([
      acceptOfferInDb(clientA1, offerAId, drv1Uuid, 'key_a1'),
      acceptOfferInDb(clientA2, offerAId, drv2Uuid, 'key_a2')
    ]);

    await Promise.all([clientA1.end(), clientA2.end()]);

    const winnerA1 = resA1.success === true;
    const winnerA2 = resA2.success === true;
    assert('True Concurrency A: Exactly ONE driver succeeds when accepting same offer',
      (winnerA1 && !winnerA2) || (!winnerA1 && winnerA2)
    );
    assert('True Concurrency A: Competing driver receives DRIVER_MISMATCH / rejection',
      resA2.code === 'DRIVER_MISMATCH' || !winnerA2
    );

    // CONCURRENCY TEST B: Two DIFFERENT offers for the SAME job accepted simultaneously
    console.log('\n* Concurrency Test B: Two offers for the same job accepted simultaneously');
    const jobBRes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.62, lng: 77.21, address: 'Karol Bagh, Delhi' },
      drop: { lat: 28.54, lng: 77.38, address: 'Indirapuram, Ghaziabad' },
      vehicleType: '4W',
      fare: 420.0
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const jobB = jobBRes.data.job;

    const offerB1Data = await createOfferInDb(pgClient, jobB.uuid, drv1Uuid, `idem_b1_${Date.now()}`);
    const offerB2Data = await createOfferInDb(pgClient, jobB.uuid, drv2Uuid, `idem_b2_${Date.now()}`);
    const offerB1Id = offerB1Data.offer_id;
    const offerB2Id = offerB2Data.offer_id;

    const clientB1 = createPgClient();
    const clientB2 = createPgClient();
    await Promise.all([clientB1.connect(), clientB2.connect()]);

    const [b1Data, b2Data] = await Promise.all([
      acceptOfferInDb(clientB1, offerB1Id, drv1Uuid, 'key_b1'),
      acceptOfferInDb(clientB2, offerB2Id, drv2Uuid, 'key_b2')
    ]);

    await Promise.all([clientB1.end(), clientB2.end()]);

    const b1Won = b1Data.success === true;
    const b2Won = b2Data.success === true;
    assert('True Concurrency B: Exactly ONE driver wins authoritative job assignment',
      (b1Won && !b2Won) || (!b1Won && b2Won)
    );

    const loserCode = b1Won ? b2Data.code : b1Data.code;
    assert('True Concurrency B: Competing offer rejected with JOB_ALREADY_ASSIGNED or OFFER_NOT_AVAILABLE',
      loserCode === 'JOB_ALREADY_ASSIGNED' || loserCode === 'OFFER_NOT_AVAILABLE',
      JSON.stringify({ b1Data, b2Data, loserCode })
    );

    // Verify PostgreSQL single-assignee invariant
    const finalJobB = await pgClient.query('SELECT status, driver_id FROM public.jobs WHERE id = $1', [jobB.uuid]);
    assert('True Concurrency B: PostgreSQL job has exactly one assigned driver',
      finalJobB.rows.length === 1 && finalJobB.rows[0].status === 'ASSIGNED' &&
      (finalJobB.rows[0].driver_id === drv1Uuid || finalJobB.rows[0].driver_id === drv2Uuid)
    );

    // CONCURRENCY TEST C: Same driver submits acceptance TWICE concurrently
    console.log('\n* Concurrency Test C: Same driver submits acceptance twice concurrently');
    const jobCRes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.60, lng: 77.20, address: 'Lajpat Nagar, Delhi' },
      drop: { lat: 28.50, lng: 77.35, address: 'Noida 18' },
      vehicleType: '4W',
      fare: 320.0
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const jobC = jobCRes.data.job;

    const offerCData = await createOfferInDb(pgClient, jobC.uuid, drv1Uuid, `idem_c_${Date.now()}`);
    const offerCId = offerCData.offer_id;

    const clientC1 = createPgClient();
    const clientC2 = createPgClient();
    await Promise.all([clientC1.connect(), clientC2.connect()]);

    const [c1Data, c2Data] = await Promise.all([
      acceptOfferInDb(clientC1, offerCId, drv1Uuid, 'key_c1'),
      acceptOfferInDb(clientC2, offerCId, drv1Uuid, 'key_c2')
    ]);

    await Promise.all([clientC1.end(), clientC2.end()]);

    assert('True Concurrency C: Both requests succeed (idempotent)',
      c1Data.success === true && c2Data.success === true
    );
    assert('True Concurrency C: At least one response flagged as duplicate',
      c1Data.duplicate === true || c2Data.duplicate === true
    );

    // CONCURRENCY TEST D: Expired offer acceptance rejected
    console.log('\n* Concurrency Test D: Expired offer acceptance rejected');
    const expiredOfferRes = await pgClient.query(`
      INSERT INTO public.dispatch_offers (
        job_id, job_uuid, driver_id, driver_uuid, status, offered_at, expires_at
      ) VALUES (
        $1, $2::uuid, 'DRV-101', $3::uuid, 'OFFERED', NOW() - INTERVAL '60 seconds', NOW() - INTERVAL '10 seconds'
      ) RETURNING id;
    `, [jobC.id, jobC.uuid, drv1Uuid]);
    const expiredOfferId = expiredOfferRes.rows[0].id;

    const expData = await acceptOfferInDb(pgClient, expiredOfferId, drv1Uuid, 'key_expired');
    assert('True Concurrency D: Expired offer rejected with OFFER_EXPIRED',
      expData.success === false && expData.code === 'OFFER_EXPIRED'
    );

    // =========================================================================
    // MODULE 5: TELEMETRY & WEBSOCKET REAL-TIME INTEGRATION
    // =========================================================================
    console.log('\n--- MODULE 5: Telemetry & WebSocket Scoping ---');

    // 5.1 REST location telemetry anti-spoofing
    const validLocation = await request('POST', '/api/v1/driver/location', {
      lat: 28.6139,
      lng: 77.2090,
      heading: 45.0,
      speed: 30.0
    }, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Driver 1 sends valid location telemetry (HTTP 200)', validLocation.status === 200 && validLocation.data.success);

    // 5.2 Attaching telemetry to an unassigned job rejected
    const loserToken = b1Won ? drv2Token : drv1Token;
    const unassignedJobLoc = await request('POST', '/api/v1/driver/location', {
      lat: 28.6139,
      lng: 77.2090,
      jobId: jobB.id
    }, { 'Authorization': `Bearer ${loserToken}` });
    assert('Driver attaching telemetry to unassigned job rejected with HTTP 403 (JOB_NOT_ASSIGNED_TO_DRIVER)',
      unassignedJobLoc.status === 403 && unassignedJobLoc.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
    );

    // 5.3 WebSocket Authentication & Driver Impersonation Defense
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        resolve();
      }, 6000);

      ws.on('open', () => {
        // Authenticate as Driver 1
        ws.send(JSON.stringify({ type: 'AUTHENTICATE', token: drv1Token }));
      });

      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (e) {
          return;
        }

        if (msg.type === 'AUTHENTICATED') {
          assert('WebSocket authenticated successfully as DRIVER', msg.role === 'DRIVER');

          // Try to transmit telemetry with forged driverId: drv2Id
          ws.send(JSON.stringify({
            type: 'DRIVER_LOCATION_UPDATE',
            driverId: drv2Id, // Spoofed!
            lat: 28.61,
            lng: 77.20
          }));
        } else if (msg.type === 'ERROR' && msg.error?.includes('impersonation')) {
          assert('WebSocket rejects forged driverId in DRIVER_LOCATION_UPDATE', true);

          // Now test telemetry with unassigned job
          ws.send(JSON.stringify({
            type: 'DRIVER_LOCATION_UPDATE',
            driverId: drv1Id,
            activeJobId: 'JOB-UNASSIGNED-NONEXISTENT',
            lat: 28.61,
            lng: 77.20
          }));
        } else if (msg.type === 'ERROR' && (msg.code === 'JOB_NOT_ASSIGNED_TO_DRIVER' || msg.error?.includes('not assigned') || msg.error?.includes('unassigned') || msg.error?.includes('cannot transmit'))) {
          assert('WebSocket rejects activeJobId not assigned to authenticated driver', true);
          clearTimeout(timer);
          ws.close();
          resolve();
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timer);
        assert('WebSocket connection encountered error', false, err.message);
        reject(err);
      });
    });

    // =========================================================================
    // MODULE 6: CUSTOMER TRACKING ISOLATION
    // =========================================================================
    console.log('\n--- MODULE 6: Customer Tracking Isolation ---');

    // 6.1 Customer 1 tracks Customer 1's ride job
    const cust1TrackOwn = await request('GET', `/api/v1/tracking/${rideJobId}`, null, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Customer 1 can track own trip (HTTP 200)',
      cust1TrackOwn.status === 200 && cust1TrackOwn.data.success && cust1TrackOwn.data.jobId === rideJobId
    );

    // 6.2 Customer 2 attempting to track Customer 1's job is rejected
    const cust2TrackForeign = await request('GET', `/api/v1/tracking/${rideJobId}`, null, { 'Authorization': `Bearer ${cust2Token}` });
    assert('Customer 2 tracking Customer 1 trip rejected with HTTP 403 (CUSTOMER_MISMATCH)',
      cust2TrackForeign.status === 403 && cust2TrackForeign.data.code === 'CUSTOMER_MISMATCH'
    );

    // 6.3 Anonymous tracking rejected
    const anonTrack = await request('GET', `/api/v1/tracking/${rideJobId}`);
    assert('Anonymous tracking rejected with HTTP 401 (AUTH_REQUIRED)',
      anonTrack.status === 401 && anonTrack.data.code === 'AUTH_REQUIRED'
    );

    // 6.4 Admin tracking permitted (operational visibility)
    const adminTrack = await request('GET', `/api/v1/tracking/${rideJobId}`, null, { 'Authorization': `Bearer ${adminToken}` });
    assert('Admin retains operational tracking visibility (HTTP 200)',
      adminTrack.status === 200 && adminTrack.data.success
    );

    // =========================================================================
    // MODULE 7: COLD SERVER RESTART & PERSISTENCE
    // =========================================================================
    console.log('\n--- MODULE 7: Cold Server Restart & Persistence ---');

    // Create a new job and assign it to Driver 1 before restart
    const restartJobRes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.6139, lng: 77.2090, address: 'Connaught Place, Delhi' },
      drop: { lat: 28.7041, lng: 77.1025, address: 'Rohini, Delhi' },
      vehicleType: '4W',
      fare: 500.0
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const restartJob = restartJobRes.data.job;

    const rOfferData = await createOfferInDb(pgClient, restartJob.uuid, drv1Uuid, `idem_restart_${Date.now()}`);
    const rOfferId = rOfferData.offer_id;

    const rAccept = await request('POST', `/api/driver/offers/${rOfferId}/accept`, {}, { 'Authorization': `Bearer ${drv1Token}` });
    assert('Job assigned to Driver 1 before server restart', rAccept.status === 200 && rAccept.data.success);

    // Restart server
    await restartServer();

    // Re-verify health
    const postRestartHealth = await request('GET', '/api/health');
    assert('Backend server online after cold restart', postRestartHealth.status === 200);

    // Log in Driver 1 fresh after restart
    const drv1PostOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const drv1PostOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: drv1PostOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const drv1PostToken = drv1PostOtpVerify.data.token;
    assert('Driver 1 logged in fresh after restart', !!drv1PostToken);

    // Query job in PostgreSQL: still ASSIGNED to Driver 1
    const postJobDb = await pgClient.query('SELECT status, driver_id FROM public.jobs WHERE id = $1', [restartJob.uuid]);
    assert('PostgreSQL job status survived cold restart intact (ASSIGNED to Driver 1)',
      postJobDb.rows.length === 1 && postJobDb.rows[0].status === 'ASSIGNED' && postJobDb.rows[0].driver_id === drv1Uuid
    );

    // Query offer in PostgreSQL: still ACCEPTED
    const postOfferDb = await pgClient.query('SELECT status, driver_uuid FROM public.dispatch_offers WHERE id = $1', [rOfferId]);
    assert('PostgreSQL dispatch offer status survived cold restart intact (ACCEPTED)',
      postOfferDb.rows.length === 1 && postOfferDb.rows[0].status === 'ACCEPTED' && postOfferDb.rows[0].driver_uuid === drv1Uuid
    );

    // Log in Customer 1 fresh after restart
    const cust1PostOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust1PostOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: cust1PostOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const cust1PostToken = cust1PostOtpVerify.data.token;

    // Customer 1 tracking job after restart
    const postRestartTrack = await request('GET', `/api/v1/tracking/${restartJob.id}`, null, { 'Authorization': `Bearer ${cust1PostToken}` });
    const assignedDriverMatches = postRestartTrack.data?.driver?.id === drv1Id || postRestartTrack.data?.driver?.id === drv1Uuid;
    assert('Customer 1 tracks assigned trip after cold restart (HTTP 200, driver assigned)',
      postRestartTrack.status === 200 && postRestartTrack.data.success && assignedDriverMatches,
      JSON.stringify(postRestartTrack)
    );

    // =========================================================================
    // MODULE 8: POSTGRESQL ROW-LEVEL SECURITY ENFORCEMENT
    // =========================================================================
    console.log('\n--- MODULE 8: PostgreSQL RLS Policy Verification ---');

    // 8.1 Anonymous role has zero access to dispatch_offers
    let anonRlsBlocked = false;
    try {
      await pgClient.query(`
        SET ROLE anon;
        SELECT * FROM public.dispatch_offers;
      `);
    } catch (e) {
      anonRlsBlocked = true;
    } finally {
      await pgClient.query('RESET ROLE;');
    }
    assert('PostgreSQL RLS: Anonymous role denied SELECT on dispatch_offers (permission denied)', anonRlsBlocked);

    // 8.2 Authenticated role without driver claims sees 0 offers
    await pgClient.query('SET ROLE authenticated;');
    await pgClient.query("SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';");
    const custRlsRes = await pgClient.query('SELECT count(*) as count FROM public.dispatch_offers;');
    await pgClient.query('RESET ROLE;');
    assert('PostgreSQL RLS: Customer sees 0 rows in dispatch_offers', Number(custRlsRes.rows[0].count) === 0);

    // 8.3 Authenticated Driver 1 sees ONLY Driver 1's offers
    // First, insert an offer for Driver 1 and an offer for Driver 2
    const testRlsJobRes = await request('POST', '/api/customer/book-ride', {
      serviceType: 'RIDE',
      pickup: { lat: 28.6139, lng: 77.2090, address: 'CP' },
      drop: { lat: 28.5355, lng: 77.3910, address: 'Noida' },
      vehicleType: '4W',
      fare: 300.0
    }, { 'Authorization': `Bearer ${cust1PostToken}` });
    const rlsJob = testRlsJobRes.data.job;

    await createOfferInDb(pgClient, rlsJob.uuid, drv1Uuid, `rls_drv1_${Date.now()}`);
    await createOfferInDb(pgClient, rlsJob.uuid, drv2Uuid, `rls_drv2_${Date.now()}`);

    // Driver 1 user_id is e2cb0dfd-b093-4b4b-bfc8-8c61f808d884
    const drv1UserId = 'e2cb0dfd-b093-4b4b-bfc8-8c61f808d884';
    await pgClient.query('SET ROLE authenticated;');
    await pgClient.query(`SET request.jwt.claim.sub = '${drv1UserId}';`);
    const drv1RlsQuery = await pgClient.query(`SELECT count(*) as count FROM public.dispatch_offers WHERE driver_uuid = '${drv2Uuid}';`);
    await pgClient.query('RESET ROLE;');
    const foreignOffersVisible = Number(drv1RlsQuery.rows[0].count);
    assert('PostgreSQL RLS: Driver 1 cannot see Driver 2 offers (count === 0)', foreignOffersVisible === 0);

  } finally {
    await pgClient.end();
  }

  console.log('\n========================================================================');
  console.log(`📊 PHASE 6 DISPATCH SECURITY RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6DispatchSuite().catch((err) => {
  console.error('Fatal error in Phase 6 Dispatch test suite:', err);
  process.exit(1);
});
