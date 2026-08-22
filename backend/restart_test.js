// =========================================================================
// NABIN — MANDATORY BACKEND PERSISTENCE & RESTART INTEGRATION TEST
// =========================================================================
const http = require('http');
const { spawn, execSync } = require('child_process');
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

async function runRestartTest() {
  console.log('========================================================================');
  console.log('🔄 RUNNING NABIN MANDATORY BACKEND PERSISTENCE & RESTART TEST');
  console.log('========================================================================\n');

  try {
    // 1. Initial Health Check
    const health = await request('GET', '/api/health');
    assert('Initial backend server is healthy & online', health.status === 200 && health.data.status === 'ONLINE');

    // 2. Obtain Customer & Driver Session Tokens
    const custOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const custOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: custOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const customerToken = custOtpVerify.data.token;

    const drvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122334', role: 'DRIVER', purpose: 'LOGIN' });
    const drvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122334', otp: drvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const driverToken = drvOtpVerify.data.token;

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
    await request('POST', '/api/driver/accept-job', { jobId: rideJob.id, driverId: 'drv_1' }, { 'Authorization': `Bearer ${driverToken}` });
    await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'START', otp: rideJob.startOtp }, { 'Authorization': `Bearer ${driverToken}` });
    const completeRes = await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'DELIVERY', otp: rideJob.deliveryOtp || '4892' }, { 'Authorization': `Bearer ${driverToken}` });
    assert('Driver completes ride job and triggers double-entry ledger', completeRes.status === 200 && completeRes.data.status === 'COMPLETED');

    // 5. Query driver balance before restart
    const driverPre = await request('GET', '/api/driver/drv_1/dashboard', null, { 'Authorization': `Bearer ${driverToken}` });
    const expectedDriverBalance = driverPre.data.driver.walletBalance;
    assert('Driver wallet has positive balance before restart', expectedDriverBalance > 0);

    // 6. Record a persistent payment webhook
    const restartWebhookId = `evt_persist_restart_${Date.now()}`;
    await request('POST', '/api/payments/webhook', {
      id: restartWebhookId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_restart_${Date.now()}`, amount: 9900 } } }
    });

    console.log('\n--- 🛑 SIMULATING BACKEND TERMINATION & RESTART ---');
    // Terminate existing server listening on port 4000 (do not kill test runner itself)
    try {
      execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
    } catch (e) {}

    await sleep(2000);

    // Start a fresh backend instance from scratch
    console.log('🚀 Spawning fresh backend process from cold start...');
    const serverProcess = spawn('node', [path.join(__dirname, 'src/server.js')], {
      cwd: path.join(__dirname),
      detached: true,
      stdio: 'ignore'
    });
    serverProcess.unref();

    await sleep(3500);

    console.log('\n--- 🔍 VERIFYING DATA INTEGRITY AFTER RESTART ---');
    // 7. Re-check health
    const postHealth = await request('GET', '/api/health');
    assert('Post-restart backend server is healthy & online', postHealth.status === 200 && postHealth.data.status === 'ONLINE');

    // 8. Re-authenticate
    const postAdminLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const postAdminToken = postAdminLogin.data.token;

    // 9. Verify completed job STILL EXISTS after restart
    const postJobsRes = await request('GET', '/api/admin/jobs', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const persistedJob = postJobsRes.data.jobs ? postJobsRes.data.jobs.find(j => j.id === rideJob.id) : null;
    assert(`Completed ride ${rideJob.id} survived server restart with status COMPLETED`, persistedJob && persistedJob.status === 'COMPLETED');

    // 10. Verify Driver Balance STILL EXISTS after restart
    const postDrvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122334', role: 'DRIVER', purpose: 'LOGIN' });
    const postDrvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122334', otp: postDrvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const postDriverToken = postDrvOtpVerify.data.token;
    const postDriverDashboard = await request('GET', '/api/driver/drv_1/dashboard', null, { 'Authorization': `Bearer ${postDriverToken}` });
    assert(`Driver wallet balance (₹${postDriverDashboard.data.driver.walletBalance}) survived server restart`, postDriverDashboard.data.driver.walletBalance === expectedDriverBalance);

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
