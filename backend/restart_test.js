// =========================================================================
// NABIN — MANDATORY BACKEND PERSISTENCE & RESTART INTEGRATION TEST
// =========================================================================
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync, execSync } = require('child_process');
const path = require('path');
process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

// The port this suite restarts. It defaults to 4000 for a human running the file
// directly, and the chain gives it a private port through NABIN_RESTART_PORT so that
// restarting "the backend" cannot mean "kill whichever process the harness owns".
const RESTART_PORT = Number(process.env.NABIN_RESTART_PORT || 4000);
const BASE_URL = `http://127.0.0.1:${RESTART_PORT}`;

// Every backend process this suite starts is tracked so it can be terminated and the port
// released. Nothing here is killed by port lookup: the previous version resolved the owner of
// :4000 and called Stop-Process on it, which in a chained run meant killing the shared harness
// server and then leaving this suite's own detached replacement bound to :4000 for whatever
// link ran next. That is how a green chain came to depend on an orphan, and why the second
// run of the same chain failed to bind the port at all.
const spawnedServers = [];

function trackServer(proc) {
  if (proc && proc.pid) spawnedServers.push(proc);
  return proc;
}

async function stopServer(proc) {
  if (!proc || !proc.pid || proc.killed) return;
  try {
    if (process.platform === 'win32') {
      // Windows detaches these children (`detached: true`, `unref()`), so a signal is not
      // reliable; ask the OS to terminate the process tree by pid and ignore an
      // already-exited one.
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch (e) { /* already gone */ }
}

async function stopAllServers() {
  for (const proc of spawnedServers.splice(0)) await stopServer(proc);
  // Confirm the port is genuinely free before the next suite is allowed to bind it.
  for (let i = 0; i < 40; i++) {
    try {
      await request('GET', '/api/health');
      await sleep(250);
    } catch (e) {
      return true;
    }
  }
  return false;
}

function webhookHeaders(body) {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) throw new Error('PAYMENT_WEBHOOK_SECRET must be configured for webhook tests.');
  return { 'x-razorpay-signature': crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex') };
}

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
  // This suite must own the process it restarts. If something is already answering on the
  // restart port, the run is contaminated and saying so is more useful than quietly
  // sharing-or-killing somebody else's server.
  try {
    const preexisting = await request('GET', '/api/health');
    if (preexisting.status === 200) {
      console.error(`✖ port ${RESTART_PORT} is already serving; run this suite with a free NABIN_RESTART_PORT`);
      process.exit(1);
    }
  } catch (e) { /* expected: nothing listening yet */ }

  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: { ...process.env, PORT: String(RESTART_PORT) }
  }));
  proc.unref();

  // Measured, not guessed: this backend takes ~13s to answer /api/health on an idle machine
  // (hydrating 1,709 admin accounts and the geo/pricing mirrors), and the old bound of
  // 40 x 250ms = 10s was therefore SHORTER than the boot it was waiting for. Under the chain
  // the second backend starts while a shared one is already serving, so it is slower still.
  // The bound is now a condition-poll with a deadline above the measurement; the deadline is
  // not a sleep - the suite proceeds the instant health answers.
  const READY_DEADLINE_MS = 60000;
  const deadline = Date.now() + READY_DEADLINE_MS;
  for (let waited = 0; Date.now() < deadline; waited += 250) {
    await sleep(250);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return proc;
    } catch (e) {}
  }
  // The previous version returned here as though the server were ready, and the suite then
  // died several assertions later with a bare `connect ECONNREFUSED`, which describes the
  // symptom and not the cause. Say what was actually observed, then stop.
  const stillThere = (() => { try { return !proc.killed; } catch (e) { return false; } })();
  throw new Error(
    `backend on port ${RESTART_PORT} did not become ready within ${READY_DEADLINE_MS / 1000}s ` +
    `(process ${stillThere ? 'is running but not answering /api/health' : 'exited before answering'}). ` +
    `Measured boot time on this machine is ~13s; this suite restarts a server it must own, so a ` +
    `refusal here is a startup/readiness fact, not a flake.`
  );
}

async function runRestartTest() {
  // The boundary and the rule below are created to survive a cold start, and
  // until now nothing ever removed them: one run left 1 `geo_fences` row and 1
  // `surge_zones` row behind, permanently. They are recorded by the id the store
  // answered with, and reaped after the report runs, so a restart that
  // successfully persisted a boundary also successfully cleans it up.
  const geoRun = { fences: [], rules: [], baseline: null, token: null };
  // The master catalogue product this run creates before the cold start, reaped by
  // id in the final teardown so a mid-run exception cannot leave a live catalogue row.
  const mcRun = { id: null };
  console.log('========================================================================');
  console.log('🔄 RUNNING NABIN MANDATORY BACKEND PERSISTENCE & RESTART TEST');
  console.log('========================================================================\n');

  try {
    const firstServer = await ensureServerRunning();
    // 1. Initial Health & Readiness Check
    const health = await request('GET', '/api/health');
    assert('Initial backend server is healthy & online', health.status === 200 && health.data.status === 'ONLINE');

    const ready = await request('GET', '/api/ready');
    assert('Initial backend readiness check returns 200 with operational status', ready.status === 200 && ready.data.ready === true);

    // Reset DRV-101 to unlinked baseline for clean repeatable test
    if (isLivePostgres && supabaseAdmin) {
      await supabaseAdmin.from('drivers')
        .update({ user_id: null, kyc_status: 'PENDING', verified_upi_id: null, pending_upi_id: null, payout_upi_verified: false, upi_cooling_until: null })
        .eq('id', '00000000-0000-0000-0000-000000000101');
      await supabaseAdmin.from('users').delete().eq('phone', '+919810122910');
    }

    // 2. Obtain Customer & Driver Session Tokens
    const custOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const custOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: custOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const customerToken = custOtpVerify.data.token || 'usr_session_priya';

    const drvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const drvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: drvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    let driverToken = drvOtpVerify.data.token || 'drv_session_rajesh';

    // Ensure admin is bootstrapped before login
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: 'superadmin',
      password: 'AdminPassword123!'
    });

    const adminLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const adminToken = adminLogin.data.token;

    // 2b. Phase 16: Verify unlinked driver fails closed (403 UNLINKED_DRIVER_ACCOUNT)
    const unlinkedProbe = await request('POST', '/api/driver/accept-job', { jobId: 'job_probe_fail_closed', driverId: 'DRV-101' }, { 'Authorization': `Bearer ${driverToken}` });
    assert('Unlinked driver fails closed with 403 UNLINKED_DRIVER_ACCOUNT', unlinkedProbe.status === 403 && unlinkedProbe.data.code === 'UNLINKED_DRIVER_ACCOUNT', JSON.stringify(unlinkedProbe.data));

    // 2c. Authenticate authentic user for 9810122910 to establish authentic driver-user link
    const linkUserOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'CUSTOMER', purpose: 'LOGIN' });
    const linkUserOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: linkUserOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    assert('Legitimate user account created/linked for driver phone', linkUserOtpVerify.status === 200 && linkUserOtpVerify.data.user);

    // Refresh driver session token now that user linkage exists
    const reDrvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const reDrvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: reDrvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    driverToken = reDrvOtpVerify.data.token || driverToken;

    // 2d. Admin verifies driver KYC
    const kycApprovalRes = await request('POST', '/api/admin/drivers/DRV-101/status', {
      kycStatus: 'APPROVED',
      operationalStatus: 'ACTIVE',
      reason: 'Driver license DL-04201992019 and Aadhaar verified'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Admin approves driver KYC status in PostgreSQL', kycApprovalRes.status === 200 && (kycApprovalRes.data.driver?.kycStatus === 'VERIFIED' || kycApprovalRes.data.driver?.kycStatus === 'APPROVED' || kycApprovalRes.data.driver?.status === 'VERIFIED' || kycApprovalRes.data.driver?.status === 'APPROVED'));

    // 2e. Driver requests payout VPA destination
    const vpaReqRes = await request('POST', '/api/driver/payout-destination/request', {
      upiId: 'rajesh.kumar@okhdfcbank'
    }, { 'Authorization': `Bearer ${driverToken}` });
    assert('Driver requests payout destination VPA', vpaReqRes.status === 200 && vpaReqRes.data.pendingUpiId === 'rajesh.kumar@okhdfcbank', JSON.stringify(vpaReqRes.data));

    // 2f. Admin verifies payout destination
    const vpaVerifyRes = await request('POST', '/api/admin/drivers/DRV-101/verify-payout-destination', {
      decision: 'APPROVE',
      evidenceUrl: 'https://bank.example.com/penny_drop_receipt_101.pdf',
      bankAccountHolderName: 'Rajesh Kumar',
      reason: 'Penny drop verification successful against HDFC account'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Admin verifies driver payout destination VPA in PostgreSQL', vpaVerifyRes.status === 200 && vpaVerifyRes.data.driver?.verifiedUpiId === 'rajesh.kumar@okhdfcbank', JSON.stringify(vpaVerifyRes.data));

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
    const acceptRes = await request('POST', '/api/driver/accept-job', { jobId: rideJob.id, driverId: 'DRV-101' }, { 'Authorization': `Bearer ${driverToken}` });
    await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'START', otp: rideJob.startOtp }, { 'Authorization': `Bearer ${driverToken}` });
    const completeRes = await request('POST', '/api/driver/verify-otp', { jobId: rideJob.id, otpType: 'DELIVERY', otp: rideJob.deliveryOtp || '4892' }, { 'Authorization': `Bearer ${driverToken}` });
    assert('Driver completes ride job and triggers double-entry ledger', completeRes.status === 200 && completeRes.data.status === 'COMPLETED', JSON.stringify({ accept: acceptRes.data, complete: completeRes.data }));

    // 5. Query driver balance before restart
    const driverPre = await request('GET', '/api/driver/DRV-101/dashboard', null, { 'Authorization': `Bearer ${driverToken}` });
    const expectedDriverBalance = driverPre.data?.driver?.walletBalance;
    assert('Driver wallet has recorded earnings before restart', typeof expectedDriverBalance === 'number' && expectedDriverBalance > 0);

    // 6. Record a persistent payment webhook
    const restartWebhookId = `evt_persist_restart_${Date.now()}`;
    const restartWebhookPayload = {
      id: restartWebhookId,
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_restart_${Date.now()}`, amount: 9900 } } }
    };
    await request('POST', '/api/payments/webhook', restartWebhookPayload, webhookHeaders(restartWebhookPayload));

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

    // 6c. Create persistent pricing config, geofence, and surge zone before restart
    const preRestartPricing = await request('POST', '/api/admin/pricing', {
      serviceType: '2W',
      baseFare: 28.0,
      perKmRate: 9.5,
      globalSurgeMultiplier: 1.18
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Custom 2W pricing configured before restart (baseFare = 28.0)', preRestartPricing.status === 200 && preRestartPricing.data.pricingConfig['2W'].baseFare === 28.0);

    // Counted immediately before this run's first geographic write so the
    // teardown can prove it returned the store to that mark. PostgREST computes
    // `count` before the row cap, so a head-only count is a true total.
    if (isLivePostgres && supabaseAdmin) {
      const { count: fencesBefore } = await supabaseAdmin
        .from('geo_fences').select('id', { count: 'exact', head: true });
      const { count: rulesBefore } = await supabaseAdmin
        .from('surge_zones').select('id', { count: 'exact', head: true });
      geoRun.baseline = { fences: fencesBefore, rules: rulesBefore };
    }
    // Either token addresses the delete: sessions are durable, which is the very
    // property this file exists to prove.
    geoRun.token = adminToken;

    const restartFenceCode = `ZONE_RST_${Date.now().toString().slice(-4)}`;
    const preRestartFence = await request('POST', '/api/admin/geofences', {
      name: 'Restart Test Aero City Zone',
      code: restartFenceCode,
      type: 'CIRCLE',
      centerLat: 28.5500,
      centerLng: 77.1200,
      radiusMeters: 2000,
      surcharge: 65.0,
      surgeMultiplier: 1.25
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Geofence created before restart', preRestartFence.status === 200 && preRestartFence.data.geoFence.id);
    const restartFenceId = preRestartFence.data.geoFence.id;
    geoRun.fences.push(restartFenceId);

    const preRestartSurge = await request('POST', '/api/admin/surgezones', {
      zoneId: restartFenceId,
      zoneName: 'Restart Test Aero City Zone',
      service: 'RIDE',
      surgeMultiplier: 1.35,
      maxMultiplier: 2.5
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Surge zone created before restart', preRestartSurge.status === 200 && preRestartSurge.data.surgeZone.id);
    geoRun.rules.push(preRestartSurge.data?.surgeZone?.id);

    console.log('\n--- 🛑 SIMULATING BACKEND TERMINATION & RESTART ---');
    // 6d. Publish an advertisement campaign before the restart so persistence is
    //     proven against the real `advertisements` table, not a memory map.
    const preRestartAd = await request('POST', '/api/admin/advertisements', {
      title: `Restart persistence campaign ${Date.now().toString().slice(-6)}`,
      placement: 'HOME_BANNER',
      imageUrl: 'https://nabin.example.com/ads/restart-probe.png',
      targetUrl: '/grocery',
      status: 'ACTIVE',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z'
    }, { 'Authorization': `Bearer ${adminToken}` });
    const preRestartAdId = preRestartAd.data?.advertisement?.id;
    assert('Advertisement campaign published before restart and labelled persisted',
      preRestartAd.status === 200 && preRestartAd.data.success
      && preRestartAd.data.dataSource === 'postgres' && preRestartAd.data.persisted === true && !!preRestartAdId);

    // 6e. Create and revise a master catalogue product before the restart, so the
    //     write-through to `master_grocery_catalog` is proven against a cold start
    //     rather than the memory array that used to evaporate with the process.
    const mcName = `Restart Master Item ${Date.now().toString().slice(-6)}`;
    const preRestartMaster = await request('POST', '/api/admin/master-catalog', {
      masterName: mcName, category: 'Grains', unit: 'kg', packSize: '5 kg',
      imageUrl: 'https://nabin.example.com/mc/restart.png', pricingModel: 'FIXED_PRICE'
    }, { 'Authorization': `Bearer ${adminToken}` });
    const preRestartMasterId = preRestartMaster.data?.product?.id;
    mcRun.id = preRestartMasterId || null;
    assert('Master catalogue product created before restart and persisted to PostgreSQL',
      preRestartMaster.status === 200 && preRestartMaster.data.success && !!preRestartMasterId,
      `status=${preRestartMaster.status} body=${JSON.stringify(preRestartMaster.data).slice(0, 160)}`);
    const preRestartMasterRevise = await request('PUT', `/api/admin/master-catalog/${preRestartMasterId}`,
      { masterName: `${mcName} Revised` }, { 'Authorization': `Bearer ${adminToken}` });
    assert('Master catalogue product revised before restart',
      preRestartMasterRevise.status === 200 && preRestartMasterRevise.data.product.masterName === `${mcName} Revised`,
      `status=${preRestartMasterRevise.status} body=${JSON.stringify(preRestartMasterRevise.data).slice(0, 160)}`);

    // Terminate the backend this suite started, so the cold start below restarts a process it
    // owns. This used to resolve the owner of :4000 and Stop-Process it, which in a chained
    // run meant killing the shared harness server and leaving this suite's detached
    // replacement bound to :4000 for whatever link executed next.
    await stopServer(firstServer);

    await sleep(2000);

    // Start a fresh backend instance from scratch
    console.log('🚀 Spawning fresh backend process from cold start...');
    const serverProcess = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: path.join(__dirname),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env, PORT: String(RESTART_PORT) }
    }));
    serverProcess.unref();

    // A fixed sleep used to be enough, and then the cold start grew past it:
    // PostgreSQL hydration runs before the port opens, so the assertions after
    // this point were racing the boot rather than testing the restart. Ask the
    // server when it is ready, and say so if it never is.
    let booted = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(500);
      try {
        const health = await request('GET', '/api/health');
        if (health.status === 200) { booted = true; console.log(`   …fresh backend answering after ${(attempt + 1) * 0.5}s`); break; }
      } catch (e) { /* still starting */ }
    }
    assert('Fresh backend from cold start answers on its port within 30s', booted,
      booted ? '' : 'the process never bound to :4000 — every assertion below would be meaningless');
    if (!booted) throw new Error('Cold start never came up; aborting rather than reporting connection refusals as data loss.');

    console.log('\n--- 🔍 VERIFYING DATA INTEGRITY AFTER RESTART ---');
    // 7. Re-check health & readiness
    const postHealth = await request('GET', '/api/health');
    assert('Post-restart backend server is healthy & online', postHealth.status === 200 && postHealth.data.status === 'ONLINE');

    const postReady = await request('GET', '/api/ready');
    assert('Post-restart backend database readiness verified', postReady.status === 200 && postReady.data.ready === true);

    // 8. Re-authenticate
    const postAdminLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const postAdminToken = postAdminLogin.data.token;
    geoRun.token = postAdminToken;

    // 9. Verify completed job STILL EXISTS after restart
    const postJobsRes = await request('GET', '/api/admin/jobs', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const persistedJob = postJobsRes.data.jobs ? postJobsRes.data.jobs.find(j => j.id === rideJob.id) : null;
    assert(`Completed ride ${rideJob.id} survived server restart with status COMPLETED`, persistedJob && persistedJob.status === 'COMPLETED');

    // 9b. The campaign must still be readable from PostgreSQL after a cold start,
    //     then be removed again so repeated runs do not accumulate rows.
    const postAds = await request('GET', '/api/advertisements?placement=HOME_BANNER');
    const survivedAd = (postAds.data?.advertisements || []).find(ad => ad.id === preRestartAdId);
    assert('Advertisement campaign survived the restart and is served from PostgreSQL',
      postAds.status === 200 && postAds.data.dataSource === 'postgres'
      && postAds.data.persisted === true && !!survivedAd && survivedAd.status === 'ACTIVE');
    const postAdCleanup = await request('DELETE', `/api/admin/advertisements/${preRestartAdId}`, null,
      { 'Authorization': `Bearer ${postAdminToken}` });
    assert('Restart-probe advertisement cleaned up', postAdCleanup.status === 200 && postAdCleanup.data.success);

    // 9c. The catalogue revision must be readable from PostgreSQL after the cold
    //     start, then the product must soft-delete out of the active list. The row is
    //     reaped straight from the store in teardown.
    const postMasterList = await request('GET', '/api/admin/master-catalog', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const survivedMaster = (postMasterList.data?.masterProducts || []).find(p => p.id === preRestartMasterId);
    assert('Master catalogue product survived the restart with its revision, served from PostgreSQL',
      postMasterList.status === 200 && !!survivedMaster && survivedMaster.masterName === `${mcName} Revised`,
      `found=${!!survivedMaster} name=${survivedMaster && survivedMaster.masterName}`);

    const postMasterDelete = await request('DELETE', `/api/admin/master-catalog/${preRestartMasterId}`, null, { 'Authorization': `Bearer ${postAdminToken}` });
    const postMasterAfterDelete = await request('GET', '/api/admin/master-catalog', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const stillListed = (postMasterAfterDelete.data?.masterProducts || []).find(p => p.id === preRestartMasterId);
    assert('Master catalogue delete is durable and the retired product leaves the active list',
      postMasterDelete.status === 200 && postMasterDelete.data.success && !stillListed,
      `delete=${postMasterDelete.status} stillListed=${!!stillListed}`);

    // 10. Verify Driver Balance STILL EXISTS after restart
    const postDrvOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
    const postDrvOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9810122910', otp: postDrvOtpSend.data.testOtp || '7729', role: 'DRIVER' });
    const postDriverToken = postDrvOtpVerify.data?.token || 'drv_session_rajesh';
    const postDriverDashboard = await request('GET', '/api/driver/DRV-101/dashboard', null, { 'Authorization': `Bearer ${postDriverToken}` });
    assert(`Driver wallet balance (₹${postDriverDashboard.data?.driver?.walletBalance}) survived server restart`, postDriverDashboard.data?.driver?.walletBalance === expectedDriverBalance);
    assert(`Driver KYC status (VERIFIED/APPROVED) survived server restart in PostgreSQL`, postDriverDashboard.data?.driver?.kycStatus === 'VERIFIED' || postDriverDashboard.data?.driver?.kycStatus === 'APPROVED');
    assert(`Driver verified UPI ID (${postDriverDashboard.data?.driver?.verifiedUpiId}) survived server restart in PostgreSQL`, postDriverDashboard.data?.driver?.verifiedUpiId === 'rajesh.kumar@okhdfcbank');

    // 11. Verify Double-Entry Ledger entries STILL EXIST after restart
    const postLedgerRes = await request('GET', '/api/admin/finance/ledger-double-entry', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const jobLedgerEntries = postLedgerRes.data.entries ? postLedgerRes.data.entries.filter(e => e.referenceId === rideJob.id) : [];
    assert(`Double-entry ledger records (${jobLedgerEntries.length}) survived server restart`, jobLedgerEntries.length >= 1 && jobLedgerEntries[0].referenceId === rideJob.id);

    // 12. Verify Webhook Idempotency registry STILL REJECTS DUPLICATES after restart
    const restartDuplicateWebhookPayload = {
      id: restartWebhookId,
      event: 'payment.captured'
    };
    const postDuplicateWebhook = await request('POST', '/api/payments/webhook', restartDuplicateWebhookPayload, webhookHeaders(restartDuplicateWebhookPayload));
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

    // 12c. Verify Pricing Configuration, Geofence, and Surge Zone SURVIVED restart
    const postPricingRes = await request('GET', '/api/admin/pricing', null, { 'Authorization': `Bearer ${postAdminToken}` });
    assert('Custom 2W pricing survived server restart in PostgreSQL (baseFare = 28.0)',
      postPricingRes.status === 200 &&
      postPricingRes.data.pricingConfig['2W'].baseFare === 28.0 &&
      postPricingRes.data.pricingConfig.globalSurgeMultiplier === 1.18
    );

    const postFencesRes = await request('GET', '/api/admin/geofences', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const persistedFence = postFencesRes.data.geoFences?.find(g => g.id === restartFenceId || g.code === restartFenceCode);
    assert('Geofence zone survived server restart in PostgreSQL',
      persistedFence &&
      persistedFence.surcharge === 65.0
    );

    const postSurgeRes = await request('GET', '/api/admin/surgezones', null, { 'Authorization': `Bearer ${postAdminToken}` });
    const persistedSurge = postSurgeRes.data.surgeZones?.find(s => s.zoneId === restartFenceId || s.zoneName === 'Restart Test Aero City Zone');
    assert('Surge zone survived server restart in PostgreSQL',
      persistedSurge &&
      persistedSurge.surgeMultiplier === 1.35
    );

    const postEstimate = await request('POST', '/api/pricing/estimate', {
      serviceType: '2W',
      distanceKm: 4.0,
      durationMins: 10,
      pickupLat: 28.5500,
      pickupLng: 77.1200
    });
    assert('Post-restart spatial fare calculation correctly integrates persisted geofence surcharge',
      postEstimate.status === 200 &&
      postEstimate.data.success &&
      postEstimate.data.estimate.customerCharge > 100
    );

    // 13. Test Production Fail-Closed Security Guard
    console.log('\n--- 🛡️ VERIFYING PRODUCTION FAIL-CLOSED SECURITY GUARD ---');
    const failClosedCheck = spawnSync('node', [
      '-e',
      'process.env.NODE_ENV="production"; process.env.SUPABASE_URL=""; process.env.SUPABASE_ANON_KEY=""; require("./src/supabase");'
    ], { cwd: path.join(__dirname) });

    assert('Production mode strictly fails closed when PostgreSQL/Supabase is unconfigured', failClosedCheck.status !== 0);

    // 14. Put back what the persistence check above borrowed. The 1.18 global multiplier is
    //     left in PostgreSQL on purpose until it has been read back after the cold start;
    //     leaving it there afterwards makes the next `test_suite.js` run fail its
    //     "outside every geofence: standard 1.0x surge" assertion for a reason that has
    //     nothing to do with geofencing.
    const restoredSurgeRes = await request('POST', '/api/admin/pricing', {
      globalSurgeMultiplier: 1.0
    }, { 'Authorization': `Bearer ${postAdminToken}` });
    assert('Restart test leaves the global surge multiplier at baseline for the next run',
      restoredSurgeRes.status === 200 &&
      restoredSurgeRes.data.pricingConfig.globalSurgeMultiplier === 1.0
    );

  } catch (err) {
    console.error('Fatal Restart Test Exception:', err);
    failed++;
  }

  // Teardown, after the report so it runs even when a check threw: the boundary
  // proved it survives a cold start, so it can be removed the same way an
  // operator removes one. The rule goes direct to the store because no admin
  // route deletes a surge rule — a gap recorded in the geofencing audit doc.
  if (isLivePostgres && supabaseAdmin && geoRun.baseline) {
    const ruleIds = geoRun.rules.filter(Boolean);
    if (ruleIds.length) {
      await supabaseAdmin.from('surge_zones').delete().in('id', ruleIds);
    }
    const deleteStatuses = [];
    for (const fenceId of geoRun.fences.filter(Boolean)) {
      const res = await request('DELETE', `/api/admin/geofences/${fenceId}`, null, {
        'Authorization': `Bearer ${geoRun.token}`
      });
      deleteStatuses.push(res.status);
    }
    const { count: fencesAfter } = await supabaseAdmin
      .from('geo_fences').select('id', { count: 'exact', head: true });
    const { count: rulesAfter } = await supabaseAdmin
      .from('surge_zones').select('id', { count: 'exact', head: true });
    assert('GEO-TEARDOWN: the restart fixtures are gone and the store is back to its baseline',
      deleteStatuses.every(s => s === 200) &&
      fencesAfter === geoRun.baseline.fences && rulesAfter === geoRun.baseline.rules,
      `fences ${geoRun.baseline.fences} → ${fencesAfter}, rules ${geoRun.baseline.rules} → ${rulesAfter}, ` +
      `deletes ${deleteStatuses.join('/') || 'none'}`);
  }

  // The master catalogue product is soft-deleted by the run; reap the row straight from
  // the store so repeat runs do not accumulate inactive catalogue rows.
  if (isLivePostgres && supabaseAdmin && mcRun.id) {
    await supabaseAdmin.from('master_grocery_catalog').delete().eq('id', mcRun.id);
  }

  // Release the backend this suite started, so the port is free for whatever runs next and no
  // orphaned server is left standing in for the harness. Done before the summary so it also
  // happens on a failed run.
  try { await stopAllServers(); } catch (e) { console.error('server teardown did not complete:', e.message); }

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
