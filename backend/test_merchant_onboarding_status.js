const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('=== NABIN PHASE 4.1E — MERCHANT ONBOARDING STATUS TEST SUITE ===');

  const db = require('./src/database');
  const { app } = require('./src/server');

  let passed = 0;
  let failed = 0;

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;

  function makeRequest({ path, method = 'GET', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => { resBody += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(resBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, rawBody: resBody });
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  // Seed test merchant sessions
  const tokenA = 'test_status_token_a_' + Date.now();
  const tokenB = 'test_status_token_b_' + Date.now();

  const merchantA = {
    id: 'rest_status_a',
    uuid: 'rest_status_a',
    name: 'Himalayan Flavors Pvt Ltd',
    phone: '+919999900021',
    address: 'Durbar Marg Commercial Avenue, Kathmandu',
    lat: 27.7128,
    lng: 85.3180,
    merchant_type: 'RESTAURANT',
    approval_status: 'PENDING'
  };

  const merchantB = {
    id: 'rest_status_b',
    uuid: 'rest_status_b',
    name: '',
    phone: '',
    address: '',
    lat: null,
    lng: null,
    merchant_type: 'RESTAURANT',
    approval_status: 'PENDING'
  };

  db.restaurants.push(merchantA, merchantB);

  const sessionA = { token: tokenA, role: 'MERCHANT', entityId: 'rest_status_a', userId: 'usr_status_a', phone: '+919999900021' };
  const sessionB = { token: tokenB, role: 'MERCHANT', entityId: 'rest_status_b', userId: 'usr_status_b', phone: '+919999900022' };

  db.activeSessions.set(tokenA, sessionA);
  db.activeSessions.set(db.hashSessionToken(tokenA), sessionA);
  db.activeSessions.set(tokenB, sessionB);
  db.activeSessions.set(db.hashSessionToken(tokenB), sessionB);

  await testAsync('GET /api/merchant/onboarding/status refuses unauthenticated request (401)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/onboarding/status',
      method: 'GET'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  await testAsync('Incomplete Merchant B calculates 0% completion with outstanding actions', async () => {
    const res = await makeRequest({
      path: '/api/merchant/onboarding/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.completionPercentage, 0);
    assert.strictEqual(res.body.overallStatus, 'ONBOARDING_IN_PROGRESS');
    assert.ok(res.body.outstandingActions.some(a => a.code === 'PROFILE_INCOMPLETE'));
    assert.ok(res.body.outstandingActions.some(a => a.code === 'LOCATION_INCOMPLETE'));
  });

  await testAsync('Partially complete Merchant A (Profile + Address, no docs or bank) calculates 50%', async () => {
    const res = await makeRequest({
      path: '/api/merchant/onboarding/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.completionPercentage, 50);
    assert.strictEqual(res.body.compliancePipeline.step1Profile.status, 'Verified');
    assert.strictEqual(res.body.compliancePipeline.step2Location.status, 'Verified');
    assert.strictEqual(res.body.compliancePipeline.step3Documents.status, 'Pending');
    assert.strictEqual(res.body.compliancePipeline.step4BankSettlement.status, 'Pending');
    assert.ok(res.body.outstandingActions.some(a => a.code === 'FSSAI_REQUIRED'));
  });

  await testAsync('Attaching FSSAI, Trade License and Bank Account transitions Merchant A to 100% PENDING_REVIEW', async () => {
    // 1. Attach FSSAI and Trade License
    await db.merchantDocumentRepo.save({
      merchantId: 'rest_status_a',
      documentType: 'FSSAI_LICENSE',
      documentNumber: '10021022000492',
      storageBucket: 'merchant-documents',
      storagePath: 'merchants/rest_status_a/documents/fssai.pdf',
      originalFilename: 'fssai.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      status: 'PENDING_REVIEW'
    });

    await db.merchantDocumentRepo.save({
      merchantId: 'rest_status_a',
      documentType: 'TRADE_LICENSE',
      documentNumber: 'TRD-KTM-2024-883',
      storageBucket: 'merchant-documents',
      storagePath: 'merchants/rest_status_a/documents/trade.pdf',
      originalFilename: 'trade.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      status: 'PENDING_REVIEW'
    });

    // 2. Attach Bank Account
    await db.merchantBankAccountRepo.save({
      merchantId: 'rest_status_a',
      accountHolderName: 'Himalayan Flavors Pvt Ltd',
      bankName: 'Nabil Bank Limited',
      encryptedAccountNumber: 'dummy_cipher',
      maskedAccountNumber: '•••• •••• •••• 4910',
      accountNumberHash: 'dummy_hash',
      ifscCode: 'NBLNPKTM01',
      branchName: 'Durbar Marg Branch',
      verificationStatus: 'PENDING_VERIFICATION'
    });

    const res = await makeRequest({
      path: '/api/merchant/onboarding/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.completionPercentage, 100);
    assert.strictEqual(res.body.overallStatus, 'PENDING_REVIEW');
    assert.strictEqual(res.body.headline, 'Application In Review');
    assert.ok(res.body.trackingToken.startsWith('NAB-REG-2024-'));
    assert.strictEqual(res.body.compliancePipeline.step4BankSettlement.maskedAccountNumber, '•••• •••• •••• 4910');
  });

  await testAsync('Tenant Isolation: Merchant A cannot query Merchant B status via path param (403)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rest_status_b/onboarding/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'MERCHANT_MISMATCH');
  });

  await testAsync('Approved merchant transitions overallStatus to APPROVED', async () => {
    merchantA.approval_status = 'APPROVED';
    const res = await makeRequest({
      path: '/api/merchant/onboarding/status',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.overallStatus, 'APPROVED');
    assert.strictEqual(res.body.headline, 'Store Activated & Live');
  });

  console.log(`\n=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
  testServer.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
