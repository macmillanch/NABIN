const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('=== NABIN PHASE 4.1D — MERCHANT BANK SETTLEMENT TEST SUITE ===');

  const { financialEncryptionService } = require('./src/services/financialEncryptionService');
  const db = require('./src/database');
  const { app } = require('./src/server');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

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

  // 1. Encryption, Decryption, Masking and Hashing Tests
  test('encryptAccountNumber and decryptAccountNumber roundtrip correctly', () => {
    const rawNumber = '0124982184910';
    const cipher = financialEncryptionService.encryptAccountNumber(rawNumber);
    assert.notStrictEqual(cipher, rawNumber);
    assert.strictEqual(cipher.split(':').length, 3); // iv:tag:ciphertext

    const decrypted = financialEncryptionService.decryptAccountNumber(cipher);
    assert.strictEqual(decrypted, rawNumber);
  });

  test('maskAccountNumber masks preceding digits and retains last 4', () => {
    assert.strictEqual(financialEncryptionService.maskAccountNumber('0124982184910'), '•••• •••• •••• 4910');
    assert.strictEqual(financialEncryptionService.maskAccountNumber('12345678'), '•••• •••• 5678');
    assert.strictEqual(financialEncryptionService.maskAccountNumber('1234'), '•••• 1234');
  });

  test('hashAccountNumber generates deterministic HMAC-SHA256 hash', () => {
    const h1 = financialEncryptionService.hashAccountNumber('0124982184910');
    const h2 = financialEncryptionService.hashAccountNumber('0124982184910');
    const h3 = financialEncryptionService.hashAccountNumber('9999999999999');
    assert.strictEqual(h1, h2);
    assert.notStrictEqual(h1, h3);
  });

  test('validateIfsc validates standard and regional clearing codes', () => {
    assert.strictEqual(financialEncryptionService.validateIfsc('SBIN0000123'), true);
    assert.strictEqual(financialEncryptionService.validateIfsc('HDFC0001234'), true);
    assert.strictEqual(financialEncryptionService.validateIfsc('NBLNPKTM01'), true);
    assert.strictEqual(financialEncryptionService.validateIfsc('INVALID!@#'), false);
    assert.strictEqual(financialEncryptionService.validateIfsc('12345'), false);
  });

  // 2. Repository Unit Tests
  await testAsync('MerchantBankAccountRepository saves and returns masked bank account', async () => {
    const account = await db.merchantBankAccountRepo.save({
      merchantId: 'rest_unit_test_1',
      accountHolderName: 'Himalayan Flavors Pvt Ltd',
      bankName: 'Nabil Bank Limited',
      encryptedAccountNumber: financialEncryptionService.encryptAccountNumber('0124982184910'),
      maskedAccountNumber: financialEncryptionService.maskAccountNumber('0124982184910'),
      accountNumberHash: financialEncryptionService.hashAccountNumber('0124982184910'),
      ifscCode: 'NBLNPKTM01',
      branchName: 'Durbar Marg Branch',
      accountType: 'CURRENT',
      payoutCadence: 'DAILY_T1',
      verificationStatus: 'PENDING_VERIFICATION'
    });

    assert.ok(account.id);
    assert.strictEqual(account.maskedAccountNumber, '•••• •••• •••• 4910');
    assert.strictEqual(account.encryptedAccountNumber, undefined); // DTO strips ciphertext by default

    const retrieved = await db.merchantBankAccountRepo.findByMerchantId('rest_unit_test_1');
    assert.strictEqual(retrieved.maskedAccountNumber, '•••• •••• •••• 4910');
    assert.strictEqual(retrieved.ifscCode, 'NBLNPKTM01');
  });

  // 3. HTTP Integration & Tenant Security Tests
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
  const tokenA = 'test_bank_token_a_' + Date.now();
  const tokenB = 'test_bank_token_b_' + Date.now();

  const testMerchantA = { id: 'rest_bank_a', uuid: 'rest_bank_a', name: 'Restaurant A', merchant_type: 'RESTAURANT', approval_status: 'PENDING' };
  const testMerchantB = { id: 'rest_bank_b', uuid: 'rest_bank_b', name: 'Restaurant B', merchant_type: 'RESTAURANT', approval_status: 'PENDING' };
  db.restaurants.push(testMerchantA, testMerchantB);

  const sessionA = { token: tokenA, role: 'MERCHANT', entityId: 'rest_bank_a', userId: 'usr_bank_a', phone: '+919999900011' };
  const sessionB = { token: tokenB, role: 'MERCHANT', entityId: 'rest_bank_b', userId: 'usr_bank_b', phone: '+919999900012' };

  db.activeSessions.set(tokenA, sessionA);
  db.activeSessions.set(db.hashSessionToken(tokenA), sessionA);
  db.activeSessions.set(tokenB, sessionB);
  db.activeSessions.set(db.hashSessionToken(tokenB), sessionB);

  await testAsync('POST /api/merchant/bank-account refuses unauthenticated request (401)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'POST',
      body: { accountHolderName: 'Test' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  await testAsync('POST /api/merchant/bank-account refuses confirmation mismatch (400)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        accountHolderName: 'Himalayan Flavors Pvt Ltd',
        bankName: 'Nabil Bank Limited',
        accountNumber: '0124982184910',
        confirmAccountNumber: '0124982189999', // Mismatch!
        ifscCode: 'NBLNPKTM01'
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'ACCOUNT_CONFIRMATION_MISMATCH');
  });

  await testAsync('POST /api/merchant/bank-account refuses invalid IFSC format (400)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        accountHolderName: 'Himalayan Flavors Pvt Ltd',
        bankName: 'Nabil Bank Limited',
        accountNumber: '0124982184910',
        confirmAccountNumber: '0124982184910',
        ifscCode: 'INVALID#IFSC'
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_IFSC_CODE');
  });

  await testAsync('POST /api/merchant/bank-account registers bank account with masked output (201)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        accountHolderName: 'Himalayan Flavors Pvt Ltd',
        bankName: 'Nabil Bank Limited',
        accountNumber: '0124982184910',
        confirmAccountNumber: '0124982184910',
        ifscCode: 'NBLNPKTM01',
        branchName: 'Durbar Marg Branch',
        accountType: 'CURRENT',
        payoutCadence: 'DAILY_T1'
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.bankAccount.maskedAccountNumber, '•••• •••• •••• 4910');
    assert.strictEqual(res.body.bankAccount.verificationStatus, 'PENDING_VERIFICATION');
    assert.strictEqual(res.body.bankAccount.accountNumber, undefined);
    assert.strictEqual(res.body.bankAccount.encryptedAccountNumber, undefined);
  });

  await testAsync('POST /api/merchant/:restaurantId/bank-account enforces tenant isolation (403)', async () => {
    // Merchant A attempting to write Merchant B's bank account
    const res = await makeRequest({
      path: '/api/merchant/rest_bank_b/bank-account',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        accountHolderName: 'Attacker Name',
        bankName: 'Attacker Bank',
        accountNumber: '9999999999',
        confirmAccountNumber: '9999999999',
        ifscCode: 'NBLNPKTM01'
      }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'MERCHANT_MISMATCH');
  });

  await testAsync('GET /api/merchant/bank-account returns masked account details', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.bankAccount.maskedAccountNumber, '•••• •••• •••• 4910');
    assert.strictEqual(res.body.bankAccount.bankName, 'Nabil Bank Limited');
    assert.strictEqual(res.body.bankAccount.ifscCode, 'NBLNPKTM01');
    assert.strictEqual(res.body.bankAccount.verificationStatus, 'PENDING_VERIFICATION');
  });

  await testAsync('GET /api/merchant/bank-account for Merchant B returns NOT_SUBMITTED (tenant isolation)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.bankAccount, null);
    assert.strictEqual(res.body.status, 'NOT_SUBMITTED');
  });

  await testAsync('PATCH /api/merchant/bank-account updates payout cadence', async () => {
    const res = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'PATCH',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        payoutCadence: 'WEEKLY_CONSOLIDATED'
      }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.bankAccount.payoutCadence, 'WEEKLY_CONSOLIDATED');
  });

  await testAsync('GET /api/merchant/settlement-readiness returns accurate readiness checklist', async () => {
    const res = await makeRequest({
      path: '/api/merchant/settlement-readiness',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.settlementReadiness.isReady, false); // Pending approval & verification
    assert.strictEqual(res.body.settlementReadiness.checklist.bankDetailsSubmitted, true);
    assert.strictEqual(res.body.settlementReadiness.status, 'PENDING_VERIFICATION');
  });

  await testAsync('Separation check: customer UPI QR settings remain isolated from bank payout', async () => {
    const bankRes = await makeRequest({
      path: '/api/merchant/bank-account',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.ok(bankRes.body.bankAccount);

    // Verify bank account has no upiQrUrl, and payment settings have no bank account number
    const paymentRes = await makeRequest({
      path: '/api/merchant/rms/settings/payments',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    // payment settings should not leak bank account details
    assert.strictEqual(paymentRes.body.payments?.accountNumber, undefined);
    assert.strictEqual(paymentRes.body.payments?.encryptedAccountNumber, undefined);
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
