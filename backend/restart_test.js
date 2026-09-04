// =========================================================================
// NABIN — MANDATORY BACKEND PERSISTENCE & RESTART INTEGRATION TEST
// =========================================================================
const http = require('http');
const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:4000';

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${description}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${description} -> ${details}`);
  }
}

async function ensureServerRunning() {
  try {
    const res = await request('GET', '/api/health');
    if (res.status === 200) return null;
  } catch (e) {}

  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  proc.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return proc;
    } catch (e) {}
  }
  return proc;
}

async function runRestartTest() {
  console.log('========================================================================');
  console.log('🔄 RUNNING NABIN MANDATORY BACKEND PERSISTENCE & RESTART TEST');
  console.log('========================================================================\n');

  try {
    await ensureServerRunning();
    // 1. Initial Health & Readiness Check
    const health = await request('GET', '/api/health');
    assert('Initial backend server is healthy & online', health.status === 200 && health.data.status === 'ONLINE');

    const ready = await request('GET', '/api/ready');
    assert('Initial backend readiness check returns 200 with operational status', ready.status === 200 && ready.data.ready === true);

    // 2. Obtain Customer & Driver Session Tokens
    const custOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const custOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: custOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const customerToken = custOtpVerify.data.token || 'usr_session_priya';

    const drvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const drvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: drvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const driverToken = drvOtpVerify.data.token || 'drv_session_rajesh';

    // Ensure admin is bootstrapped before login
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: 'superadmin',
      password: 'AdminPassword123!'
    });

    const adminLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const adminToken = adminLogin.data.token;

    // 3. Create a unique persistent ride booking
    const uniqueRideIdempotency = `idem_restart_test_${Date.now()}`;
    const bookRideRes = await request('POST', '/api/customer/book-ride', {
      customerId: 'usr_2',
      vehicleType: '3W',
      pickup: { address: 'Civil Lines Metro Station Gate 2, Delhi', lat: 28.6853, lng: 77.2185 },
      drop: { address: 'Connaught Place Block B, New Delhi', lat: 28.6328, lng: 77.2197 }
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': uniqueRideIdempotency
    });
    assert('Customer books persistent ride job', bookRideRes.status === 200 && bookRideRes.data.success);
    const rideJob = bookRideRes.data.job;

    // 4. Driver accepts and verifies OTPs to complete trip
    await request('POST', '/api/driver/accept-job', { jobId: rideJob.id, driverId: 'DRV-101' }, { 'Authorization': `Bearer ${driverToken}` });
    await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'START', otp: rideJob.startOtp }, { 'Authorization': `Bearer ${driverToken}` });
    const completeRes = await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'DELIVERY', otp: rideJob.deliveryOtp || '4892' }, { 'Authorization': `Bearer ${driverToken}` });
    assert('Driver completes ride job and triggers double-entry ledger', completeRes.status === 200 && completeRes.data.status === 'COMPLETED');

    // 5. Query driver balance before restart
    const driverPre = await request('GET', '/api/driver/DRV-101/dashboard', null, { 'Authorization': `Bearer ${driverToken}` });
    const expectedDriverBalance = driverPre.data?.driver?.walletBalance;
    assert('Driver wallet has recorded earnings before restart', typeof expectedDriverBalance === 'number' && expectedDriverBalance > 0);

    // 6. Record a persistent payment webhook
    const restartWebhookId = `evt_persist_restart_${Date.now()}`;
    await request('POST', '/api/payments/webhook', {
      id: restartWebhookId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_restart_${Date.now()}`, amount: 9900 } } }
    });

    // 6b. Create a persistent promotion and redeem it before restart
    const restartPromoCode = `RESTART_${Date.now().toString().slice(-4)}`;
    const createRestartPromo = await request('POST', '/api/admin/promotions', {
      code: restartPromoCode,
      name: 'Cold-start Persistence Test Coupon',
      discountType: 'FLAT',
      discountValue: 35.0,
      minOrderAmount: 50.0,
      serviceType: 'RIDE',
      totalUsageLimit: 10,
      perUserLimit: 2
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Persistent promotion created before restart', createRestartPromo.status === 200 && createRestartPromo.data.success);
    const restartPromoId = createRestartPromo.data.promotion.id;

    const restartPromoRedeemKey = `idem_restart_promo_${Date.now()}`;
    const redeemPreRestart = await request('POST', '/api/promotions/redeem', {
      code: restartPromoCode,
      orderAmount: 100.0,
      service: 'RIDE'
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': restartPromoRedeemKey
    });
    assert('Promotion redeemed before restart (usageCount = 1)', redeemPreRestart.status === 200 && redeemPreRestart.data.usageCount === 1);

    console.log('\n--- 🛑 SIMULATING BACKEND TERMINATION & RESTART ---');
    // Terminate existing server listening on port 4000 (do not kill test runner itself)
    try {
      execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
    } catch (e) {}

    await sleep(2000);

    // Start a fresh backend instance from scratch
    console.log('🚀 Spawning fresh backend process from cold start...');
    const serverProcess = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: path.join(__dirname),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    serverProcess.unref();

    await sleep(3500);

    console.log('\n--- 🔍 VERIFYING DATA INTEGRITY AFTER RESTART ---');
    // 7. Re-check health & readiness
    const postHealth = await request('GET', '/api/health');
    assert('Post-restart backend server is healthy & online', postHealth.status === 200 && postHealth.data.status === 'ONLINE');

    const postReady = await request('GET', '/api/ready');
    assert('Post-restart backend database readiness verified', postReady.status === 200 && postReady.data.ready === true);

    // 8. Re-authenticate
    const postAdminLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const postAdminToken = postAdminLogin.data.token;

    // 9. Verify completed job STILL EXISTS after restart
    const postJobsRes = await request('GET', '/api/admin/jobs', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const persistedJob = postJobsRes.data.jobs ? postJobsRes.data.jobs.find(j => j.id === rideJob.id) : null;
    assert(`Completed ride ${rideJob.id} survived server restart with status COMPLETED`, persistedJob && persistedJob.status === 'COMPLETED');

    // 10. Verify Driver Balance STILL EXISTS after restart
    const postDrvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const postDrvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: postDrvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const postDriverToken = postDrvOtpVerify.data.token || 'drv_session_rajesh';
    const postDriverDashboard = await request('GET', '/api/driver/DRV-101/dashboard', null, { 'Authorization': `Bearer ${postDriverToken}` });
    assert(`Driver wallet balance (₹${postDriverDashboard.data?.driver?.walletBalance}) survived server restart`, postDriverDashboard.data?.driver?.walletBalance === expectedDriverBalance);

    // 11. Verify Double-Entry Ledger entries STILL EXIST after restart
    const postLedgerRes = await request('GET', '/api/admin/finance/ledger-double-entry', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const jobLedgerEntries = postLedgerRes.data.entries ? postLedgerRes.data.entries.filter(e => e.referenceId === rideJob.id) : [];
    assert(`Double-entry ledger records (${jobLedgerEntries.length}) survived server restart`, jobLedgerEntries.length >= 2);

    // 12. Verify Webhook Idempotency registry STILL REJECTS DUPLICATES after restart
    const postDuplicateWebhook = await request('POST', '/api/payments/webhook', {
      id: restartWebhookId,
      event: 'payment.captured'
    });
    assert('Payment webhook idempotency memory survived server restart and rejected replay', postDuplicateWebhook.status === 200 && postDuplicateWebhook.data.duplicate === true);

    // 12b. Verify Promotion and Redemption STILL EXIST after restart
    const postPromosRes = await request('GET', '/api/admin/promotions', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const postRestartPromo = postPromosRes.data.promotions?.find(p => p.id === restartPromoId || p.code === restartPromoCode);
    assert(`Promotion ${restartPromoCode} survived server restart with usage_count = 1`,
      postRestartPromo &&
      postRestartPromo.code === restartPromoCode &&
      (postRestartPromo.usageCount === 1 || postRestartPromo.usedCount === 1)
    );

    // Re-authenticate customer after restart
    const postCustOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const postCustOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: postCustOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const postCustomerToken = postCustOtpVerify.data.token || 'usr_session_priya';

    // Verify redemption idempotency survived restart
    const postDuplicatePromoRedeem = await request('POST', '/api/promotions/redeem', {
      code: restartPromoCode,
      orderAmount: 100.0,
      service: 'RIDE'
    }, {
      'Authorization': `Bearer ${postCustomerToken}`,
      'Idempotency-Key': restartPromoRedeemKey
    });
    assert('Promotion redemption idempotency survived server restart and returned existing redemption',
      postDuplicatePromoRedeem.status === 200 &&
      (postDuplicatePromoRedeem.data.duplicate === true || postDuplicatePromoRedeem.data.idempotent === true)
    );

    // 13. Test Production Fail-Closed Security Guard
    console.log('\n--- 🛡️ VERIFYING PRODUCTION FAIL-CLOSED SECURITY GUARD ---');
    const failClosedCheck = spawnSync('node', [
      '-e',
      'process.env.NODE_ENV="production"; process.env.SUPABASE_URL=""; process.env.SUPABASE_ANON_KEY=""; require("./src/supabase");'
    ], { cwd: path.join(__dirname) });

    assert('Production mode strictly fails closed when PostgreSQL/Supabase is unconfigured', failClosedCheck.status !== 0);

  } catch (err) {
    console.error('Fatal Restart Test Exception:', err);
    failed++;
  }

  console.log('\n========================================================================');
  console.log(`📊 RESTART TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runRestartTest();
}

module.exports = { runRestartTest };
