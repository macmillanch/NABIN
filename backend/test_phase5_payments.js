// =========================================================================
// NABIN — PHASE 5: PAYMENT SECURITY & CAPTURE INTEGRITY TEST SUITE
// =========================================================================
const http = require('http');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');

// Phase 9 note: aligned with the webhook secret used by test_suite.js,
// restart_test.js, and test_phase4_orders.js so a server spawned by a
// preceding suite can be safely reused by this suite (test isolation fix).
process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const BASE_URL = 'http://127.0.0.1:4000';
const PG_CONN_STRING = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const KEY_SECRET = process.env.PAYMENT_KEY_SECRET;

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

function generateSignature(orderId, paymentId) {
  return crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
}

function generateWebhookSignature(payloadObj) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(payloadObj)).digest('hex');
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
  console.log('\n🛑 Terminating backend process listening on port 4000...');
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

async function runPhase5SecuritySuite() {
  console.log('========================================================================');
  console.log('🛡️ RUNNING NABIN PHASE 5: PAYMENT SECURITY & CAPTURE INTEGRITY SUITE');
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

    // Setup Customers
    const cust1OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust1OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: cust1OtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const cust1Token = cust1OtpVerify.data.token;
    const cust1Uuid = '00000000-0000-0000-0000-000000000002'; // Priya Saxena

    const cust2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9876543210', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust2OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9876543210', otp: cust2OtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const cust2Token = cust2OtpVerify.data.token;
    const cust2Uuid = '00000000-0000-0000-0000-000000000001'; // Rahul Sharma

    const superLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const adminToken = superLogin.data.token;

    // =========================================================================
    // MODULE 1: AUTHENTICATION & TENANT ISOLATION
    // =========================================================================
    console.log('\n--- MODULE 1: Authentication & Tenant Isolation ---');

    // 1.1 Unauthenticated payment session creation rejected
    const unauthCreate = await request('POST', '/api/payments/create-order', {
      amount: 250.0,
      serviceType: 'RIDE'
    });
    assert('Unauthenticated payment session creation rejected with HTTP 401', unauthCreate.status === 401);

    // 1.2 Invalid bearer token rejected
    const invalidTokenCreate = await request('POST', '/api/payments/create-order', {
      amount: 250.0,
      serviceType: 'RIDE'
    }, { 'Authorization': 'Bearer invalid_garbage_token_xyz' });
    assert('Invalid bearer token rejected with HTTP 401', invalidTokenCreate.status === 401);

    // 1.3 Authenticated customer creates own payment session
    const cust1CreateRes = await request('POST', '/api/payments/create-order', {
      amount: 250.0,
      currency: 'INR',
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Authenticated customer creates payment session (HTTP 200)',
      cust1CreateRes.status === 200 && cust1CreateRes.data.success && !!cust1CreateRes.data.session?.orderId
    );
    const cust1OrderId = cust1CreateRes.data.session?.orderId;

    // Verify session in PostgreSQL binds strictly to Customer 1 UUID
    const sessionDbCheck = await pgClient.query('SELECT * FROM payment_sessions WHERE order_id = $1', [cust1OrderId]);
    assert('Session in PostgreSQL binds strictly to authenticated customer UUID',
      sessionDbCheck.rows.length === 1 && sessionDbCheck.rows[0].customer_id === cust1Uuid && sessionDbCheck.rows[0].status === 'INITIATED'
    );

    // 1.4 Customer 1 attempting to create session spoofing Customer 2's ID
    const spoofCustomerCreate = await request('POST', '/api/payments/create-order', {
      customerId: cust2Uuid,
      amount: 300.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Client attempting to spoof another customerId is rejected with HTTP 403', spoofCustomerCreate.status === 403);

    // 1.5 Unauthenticated session query rejected
    const unauthSessionQuery = await request('GET', `/api/payments/session/${cust1OrderId}`);
    assert('Unauthenticated payment session query rejected with HTTP 401', unauthSessionQuery.status === 401);

    // 1.6 Customer 1 reads own payment session
    const ownSessionQuery = await request('GET', `/api/payments/session/${cust1OrderId}`, null, {
      'Authorization': `Bearer ${cust1Token}`
    });
    assert('Customer reads own payment session (HTTP 200)',
      ownSessionQuery.status === 200 && ownSessionQuery.data.session?.orderId === cust1OrderId
    );

    // 1.7 Customer 2 attempting to read Customer 1's payment session
    const crossCustomerQuery = await request('GET', `/api/payments/session/${cust1OrderId}`, null, {
      'Authorization': `Bearer ${cust2Token}`
    });
    assert('Customer 2 querying Customer 1 session rejected with HTTP 403 CUSTOMER_MISMATCH',
      crossCustomerQuery.status === 403 && crossCustomerQuery.data.code === 'CUSTOMER_MISMATCH'
    );

    // 1.8 Unauthenticated checkout verification rejected
    const unauthVerify = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: 'pay_unauth_test',
      signature: 'sig_test',
      status: 'SUCCESS'
    });
    assert('Unauthenticated checkout verification rejected with HTTP 401', unauthVerify.status === 401);

    // 1.9 Customer 2 attempting to verify Customer 1's checkout
    const crossCustomerVerify = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: 'pay_cross_test',
      signature: 'sig_cross_test',
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust2Token}` });
    assert('Customer 2 verifying Customer 1 session rejected with HTTP 403 CUSTOMER_MISMATCH',
      crossCustomerVerify.status === 403 && crossCustomerVerify.data.code === 'CUSTOMER_MISMATCH'
    );

    // 1.10 Customer 2 attempting to report CANCELLED/FAILED for Customer 1's session
    const crossCustomerCancel = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      status: 'CANCELLED'
    }, { 'Authorization': `Bearer ${cust2Token}` });
    assert('Customer 2 reporting CANCELLED for Customer 1 session rejected with HTTP 403',
      crossCustomerCancel.status === 403 && crossCustomerCancel.data.code === 'CUSTOMER_MISMATCH'
    );

    // =========================================================================
    // MODULE 2: CLIENT FORGERY & TAMPER RESISTANCE
    // =========================================================================
    console.log('\n--- MODULE 2: Client Forgery & Tamper Resistance ---');

    // 2.1 success=true cannot force payment success without valid signature
    const forgerySuccessFlag = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: `pay_fake_${Date.now()}`,
      success: true,
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('success=true payload without signature rejected with HTTP 400 INVALID_SIGNATURE',
      forgerySuccessFlag.status === 400 && forgerySuccessFlag.data.code === 'INVALID_SIGNATURE'
    );

    // 2.2 status=success with arbitrary signature cannot force success
    const forgeryStatusSuccess = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: `pay_fake_${Date.now()}`,
      signature: 'fake_tampered_signature_sha256_abcd1234',
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Arbitrary signature cannot force capture (rejected with HTTP 400 INVALID_SIGNATURE)',
      forgeryStatusSuccess.status === 400 && forgeryStatusSuccess.data.code === 'INVALID_SIGNATURE'
    );

    // 2.3 verified=true cannot force capture
    const forgeryVerifiedFlag = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: `pay_fake_${Date.now()}`,
      verified: true,
      signature: 'wrong_signature'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('verified=true cannot bypass cryptographic signature check',
      forgeryVerifiedFlag.status === 400 && forgeryVerifiedFlag.data.code === 'INVALID_SIGNATURE'
    );

    // 2.4 Arbitrary transaction ID without valid HMAC signature rejected
    const forgeryArbitraryTx = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: 'TXN_CLIENT_SUPPLIED_FABRICATED_123',
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Arbitrary transaction ID without signature rejected with HTTP 400',
      forgeryArbitraryTx.status === 400 && forgeryArbitraryTx.data.code === 'INVALID_SIGNATURE'
    );

    // 2.5 Zero/negative amount rejected on creation
    const negativeAmtRes = await request('POST', '/api/payments/create-order', {
      amount: -100.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Negative amount rejected with HTTP 400', negativeAmtRes.status === 400);

    const zeroAmtRes = await request('POST', '/api/payments/create-order', {
      amount: 0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Zero amount rejected with HTTP 400', zeroAmtRes.status === 400);

    // 2.6 Amount mismatch against existing order
    // First create a food order as Customer 1
    const foodOrderRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)']
    }, {
      'Authorization': `Bearer ${cust1Token}`,
      'Idempotency-Key': 'phase5_food_' + crypto.randomUUID()
    });
    const foodOrder = foodOrderRes.data.order;
    const foodOrderTotal = Number(foodOrder.total_amount);

    // Try to create payment session declaring mismatched amount
    const mismatchedOrderPayment = await request('POST', '/api/payments/create-order', {
      amount: foodOrderTotal + 50.0, // tampered amount
      serviceType: 'FOOD',
      metadata: { orderId: foodOrder.id }
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Amount mismatch against order total rejected with HTTP 400 AMOUNT_MISMATCH',
      mismatchedOrderPayment.status === 400 && mismatchedOrderPayment.data.code === 'AMOUNT_MISMATCH'
    );

    // 2.7 Payment session creation for another customer's order rejected
    const crossOrderPayment = await request('POST', '/api/payments/create-order', {
      amount: foodOrderTotal,
      serviceType: 'FOOD',
      metadata: { orderId: foodOrder.id }
    }, { 'Authorization': `Bearer ${cust2Token}` }); // Customer 2 trying to pay for Customer 1's order
    assert('Customer attempting to pay for another customer order rejected with HTTP 403',
      crossOrderPayment.status === 403 && crossOrderPayment.data.code === 'ORDER_CUSTOMER_MISMATCH'
    );

    // =========================================================================
    // MODULE 3: CRYPTOGRAPHIC CHECKOUT VERIFICATION & IDEMPOTENCY
    // =========================================================================
    console.log('\n--- MODULE 3: Cryptographic Checkout Verification & Idempotency ---');

    const paymentId1 = `pay_rzp_phase5_${Date.now()}`;
    const validSignature1 = generateSignature(cust1OrderId, paymentId1);

    // 3.1 Valid signature transitions session to PAYMENT_SUCCESS
    const validVerifyRes = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: paymentId1,
      signature: validSignature1,
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Valid cryptographic HMAC-SHA256 signature accepted (HTTP 200)',
      validVerifyRes.status === 200 && validVerifyRes.data.success && validVerifyRes.data.status === 'PAYMENT_SUCCESS'
    );

    // Verify session status updated in PostgreSQL
    const postCaptureSession = await pgClient.query('SELECT * FROM payment_sessions WHERE order_id = $1', [cust1OrderId]);
    assert('Session status in PostgreSQL authoritatively transitioned to SUCCESS',
      postCaptureSession.rows[0].status === 'SUCCESS'
    );

    // 3.2 Canonical payment record inserted into payments table
    const paymentRowCheck = await pgClient.query('SELECT * FROM payments WHERE payment_id = $1', [paymentId1]);
    assert('Canonical payment record inserted into payments table',
      paymentRowCheck.rows.length === 1 && paymentRowCheck.rows[0].status === 'CAPTURED' && Number(paymentRowCheck.rows[0].amount) === 250.0
    );

    // 3.3 Double-entry ledger entry inserted into ledger_entries
    const ledgerRowCheck = await pgClient.query('SELECT * FROM ledger_entries WHERE reference_id = $1', [cust1OrderId]);
    assert('Double-entry ledger entry inserted into ledger_entries table',
      ledgerRowCheck.rows.length === 1 && ledgerRowCheck.rows[0].debit_account === 'PAYMENT_GATEWAY_ESCROW' && Number(ledgerRowCheck.rows[0].amount) === 250.0
    );

    // 3.4 Duplicate checkout verification replay is idempotent
    const duplicateVerifyRes = await request('POST', '/api/payments/verify-checkout', {
      orderId: cust1OrderId,
      paymentId: paymentId1,
      signature: validSignature1,
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Duplicate checkout replay returns duplicate: true without double capture',
      duplicateVerifyRes.status === 200 && duplicateVerifyRes.data.duplicate === true
    );

    // Verify no extra payment or ledger row was created
    const postDupPaymentCount = await pgClient.query('SELECT count(*) as count FROM payments WHERE payment_id = $1', [paymentId1]);
    const postDupLedgerCount = await pgClient.query('SELECT count(*) as count FROM ledger_entries WHERE reference_id = $1', [cust1OrderId]);
    assert('Duplicate verification did NOT create duplicate payment row', Number(postDupPaymentCount.rows[0].count) === 1);
    assert('Duplicate verification did NOT create duplicate ledger entry', Number(postDupLedgerCount.rows[0].count) === 1);

    // 3.5 Verification on cancelled session rejected
    const cancelOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 180.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const cancelOrderId = cancelOrderRes.data.session.orderId;

    // Customer cancels
    await request('POST', '/api/payments/verify-checkout', {
      orderId: cancelOrderId,
      status: 'CANCELLED'
    }, { 'Authorization': `Bearer ${cust1Token}` });

    // Attempting to verify cancelled session
    const verifyCancelledRes = await request('POST', '/api/payments/verify-checkout', {
      orderId: cancelOrderId,
      paymentId: `pay_cancelled_${Date.now()}`,
      signature: generateSignature(cancelOrderId, `pay_cancelled_${Date.now()}`),
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Verification on CANCELLED session rejected with HTTP 400 SESSION_NOT_PAYABLE',
      verifyCancelledRes.status === 400 && verifyCancelledRes.data.code === 'SESSION_NOT_PAYABLE'
    );

    // 3.6 Verification on failed session rejected
    const failOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 190.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const failOrderId = failOrderRes.data.session.orderId;

    // Customer reports failed
    await request('POST', '/api/payments/verify-checkout', {
      orderId: failOrderId,
      status: 'FAILED',
      failureReason: 'Card issuer decline'
    }, { 'Authorization': `Bearer ${cust1Token}` });

    const verifyFailedRes = await request('POST', '/api/payments/verify-checkout', {
      orderId: failOrderId,
      paymentId: `pay_failed_${Date.now()}`,
      signature: generateSignature(failOrderId, `pay_failed_${Date.now()}`),
      status: 'SUCCESS'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    assert('Verification on FAILED session rejected with HTTP 400 SESSION_NOT_PAYABLE',
      verifyFailedRes.status === 400 && verifyFailedRes.data.code === 'SESSION_NOT_PAYABLE'
    );

    // =========================================================================
    // MODULE 4: WEBHOOK SECURITY & EVENT HANDLING (A THROUGH N)
    // =========================================================================
    console.log('\n--- MODULE 4: Webhook Security & Event Handling (A-N) ---');

    // Create fresh session for webhook capture
    const whOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 420.0,
      currency: 'INR',
      serviceType: 'FOOD'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const whOrderId = whOrderRes.data.session.orderId;
    const whEventId1 = `evt_phase5_wh_${Date.now()}`;
    const whPaymentId1 = `pay_wh_${Date.now()}`;

    const validWhPayload = {
      event: 'payment.captured',
      eventId: whEventId1,
      payload: {
        payment: {
          entity: {
            id: whPaymentId1,
            order_id: whOrderId,
            amount: 42000, // 420.0 in paise
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    const validWhSig = generateWebhookSignature(validWhPayload);

    // 4.1 [E] Missing signature rejected
    const missingSigWh = await request('POST', '/api/payments/webhook', validWhPayload);
    assert('Missing webhook signature rejected with HTTP 400 MISSING_SIGNATURE',
      missingSigWh.status === 400 && missingSigWh.data.code === 'MISSING_SIGNATURE'
    );

    // 4.2 [F] Invalid / tampered signature rejected
    const invalidSigWh = await request('POST', '/api/payments/webhook', validWhPayload, {
      'x-razorpay-signature': 'tampered_fake_signature_hex_00000000000000000000000000000000'
    });
    assert('Invalid webhook signature rejected with HTTP 400 INVALID_SIGNATURE',
      invalidSigWh.status === 400 && invalidSigWh.data.code === 'INVALID_SIGNATURE'
    );

    // 4.3 [A] Successful webhook once
    const validWhRes = await request('POST', '/api/payments/webhook', validWhPayload, {
      'x-razorpay-signature': validWhSig
    });
    assert('Successful webhook once accepted with HTTP 200 duplicate: false',
      validWhRes.status === 200 && validWhRes.data.success && validWhRes.data.duplicate === false
    );

    // Verify PostgreSQL payment session transitioned to SUCCESS
    const postWhSession = await pgClient.query('SELECT status FROM payment_sessions WHERE order_id = $1', [whOrderId]);
    assert('Session status in PostgreSQL transitioned to SUCCESS via webhook', postWhSession.rows[0].status === 'SUCCESS');

    // Verify payments and ledger_entries
    const whPaymentCheck = await pgClient.query('SELECT * FROM payments WHERE payment_id = $1', [whPaymentId1]);
    assert('Payment record inserted into payments table via webhook',
      whPaymentCheck.rows.length === 1 && Number(whPaymentCheck.rows[0].amount) === 420.0
    );

    // 4.4 [B] Same webhook twice (idempotent replay)
    const duplicateWhRes = await request('POST', '/api/payments/webhook', validWhPayload, {
      'x-razorpay-signature': validWhSig
    });
    assert('Same webhook twice returns HTTP 200 duplicate: true',
      duplicateWhRes.status === 200 && duplicateWhRes.data.duplicate === true
    );

    // 4.5 [C] Same event with changed payload
    const changedPayload = {
      event: 'payment.captured',
      eventId: whEventId1, // SAME EVENT ID
      payload: {
        payment: {
          entity: {
            id: whPaymentId1,
            order_id: whOrderId,
            amount: 99900, // CHANGED AMOUNT
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    };
    const changedPayloadSig = generateWebhookSignature(changedPayload);
    const changedPayloadWhRes = await request('POST', '/api/payments/webhook', changedPayload, {
      'x-razorpay-signature': changedPayloadSig
    });
    assert('Same event with changed payload handled idempotently as duplicate without ledger modification',
      changedPayloadWhRes.status === 200 && changedPayloadWhRes.data.duplicate === true
    );

    // Verify stored amount was NOT mutated
    const postChangedAmount = await pgClient.query('SELECT amount FROM payments WHERE payment_id = $1', [whPaymentId1]);
    assert('Payment amount remains original ₹420 and was not overwritten by tampered payload',
      Number(postChangedAmount.rows[0].amount) === 420.0
    );

    // 4.6 [D] Failed webhook
    const failWhOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 310.0,
      currency: 'INR',
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const failWhOrderId = failWhOrderRes.data.session.orderId;
    const failWhEventId = `evt_fail_wh_${Date.now()}`;
    const failWhPaymentId = `pay_fail_wh_${Date.now()}`;

    const failedWhPayload = {
      event: 'payment.failed',
      eventId: failWhEventId,
      payload: {
        payment: {
          entity: {
            id: failWhPaymentId,
            order_id: failWhOrderId,
            amount: 31000,
            currency: 'INR',
            status: 'failed',
            error_description: 'Issuer card verification failed'
          }
        }
      }
    };
    const failedWhSig = generateWebhookSignature(failedWhPayload);
    const failedWhRes = await request('POST', '/api/payments/webhook', failedWhPayload, {
      'x-razorpay-signature': failedWhSig
    });
    assert('Failed webhook acknowledged with HTTP 200 status: FAILED',
      failedWhRes.status === 200 && failedWhRes.data.status === 'FAILED'
    );

    // Verify failed webhook did NOT create ledger entry
    const failLedgerCheck = await pgClient.query('SELECT * FROM ledger_entries WHERE reference_id = $1', [failWhOrderId]);
    assert('Failed webhook did NOT create double-entry ledger record', failLedgerCheck.rows.length === 0);

    // Verify failed webhook did NOT insert into payments table
    const failPaymentsCheck = await pgClient.query('SELECT * FROM payments WHERE payment_id = $1', [failWhPaymentId]);
    assert('Failed webhook did NOT insert into payments table', failPaymentsCheck.rows.length === 0);

    // Verify session marked FAILED in PostgreSQL
    const failSessionCheck = await pgClient.query('SELECT status FROM payment_sessions WHERE order_id = $1', [failWhOrderId]);
    assert('Payment session marked FAILED in PostgreSQL', failSessionCheck.rows[0].status === 'FAILED');

    // 4.7 [G] Webhook after session expiration
    const expOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 150.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const expOrderId = expOrderRes.data.session.orderId;
    // Mark EXPIRED in PostgreSQL
    await pgClient.query("UPDATE payment_sessions SET status = 'EXPIRED' WHERE order_id = $1", [expOrderId]);

    const expWhPayload = {
      event: 'payment.captured',
      eventId: `evt_exp_wh_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_exp_${Date.now()}`,
            order_id: expOrderId,
            amount: 15000,
            status: 'captured'
          }
        }
      }
    };
    const expWhSig = generateWebhookSignature(expWhPayload);
    const expWhRes = await request('POST', '/api/payments/webhook', expWhPayload, { 'x-razorpay-signature': expWhSig });
    assert('Webhook after session expiration fails closed with HTTP 400 SESSION_NOT_PAYABLE',
      expWhRes.status === 400 && expWhRes.data.code === 'SESSION_NOT_PAYABLE'
    );

    // 4.8 [H] Webhook after session cancellation
    const canOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 160.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const canOrderId = canOrderRes.data.session.orderId;
    // Mark CANCELLED in PostgreSQL
    await pgClient.query("UPDATE payment_sessions SET status = 'CANCELLED' WHERE order_id = $1", [canOrderId]);

    const canWhPayload = {
      event: 'payment.captured',
      eventId: `evt_can_wh_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_can_${Date.now()}`,
            order_id: canOrderId,
            amount: 16000,
            status: 'captured'
          }
        }
      }
    };
    const canWhSig = generateWebhookSignature(canWhPayload);
    const canWhRes = await request('POST', '/api/payments/webhook', canWhPayload, { 'x-razorpay-signature': canWhSig });
    assert('Webhook after session cancellation fails closed with HTTP 400 SESSION_NOT_PAYABLE',
      canWhRes.status === 400 && canWhRes.data.code === 'SESSION_NOT_PAYABLE'
    );

    // 4.9 [I] Webhook for another customer's payment (tenant mismatch)
    const custIsoOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 275.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` }); // owned by Customer 1
    const custIsoOrderId = custIsoOrderRes.data.session.orderId;

    const crossCustWhPayload = {
      event: 'payment.captured',
      eventId: `evt_cross_wh_${Date.now()}`,
      customerId: cust2Uuid, // Claims Customer 2
      payload: {
        payment: {
          entity: {
            id: `pay_cross_cust_${Date.now()}`,
            order_id: custIsoOrderId,
            amount: 27500,
            status: 'captured',
            notes: { customerId: cust2Uuid }
          }
        }
      }
    };
    const crossCustWhSig = generateWebhookSignature(crossCustWhPayload);
    const crossCustWhRes = await request('POST', '/api/payments/webhook', crossCustWhPayload, { 'x-razorpay-signature': crossCustWhSig });
    assert('Webhook declaring mismatched customer rejected with HTTP 403 CUSTOMER_MISMATCH',
      crossCustWhRes.status === 403 && crossCustWhRes.data.code === 'CUSTOMER_MISMATCH'
    );

    // Verify rejection recorded in payment_webhooks
    const custMismatchDb = await pgClient.query("SELECT * FROM payment_webhooks WHERE event_type = 'capture.customer_mismatch' ORDER BY created_at DESC LIMIT 1");
    assert('Customer mismatch rejection durably recorded in payment_webhooks', custMismatchDb.rows.length === 1);

    // 4.10 [J] Webhook for another / non-existent order
    const unknownOrderPayload = {
      event: 'payment.captured',
      eventId: `evt_unknown_order_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_unknown_${Date.now()}`,
            order_id: 'order_nonexistent_999999999',
            amount: 10000,
            status: 'captured'
          }
        }
      }
    };
    const unknownOrderSig = generateWebhookSignature(unknownOrderPayload);
    const unknownOrderRes = await request('POST', '/api/payments/webhook', unknownOrderPayload, { 'x-razorpay-signature': unknownOrderSig });
    assert('Webhook for non-existent order returns HTTP 404 SESSION_NOT_FOUND',
      unknownOrderRes.status === 404 && unknownOrderRes.data.code === 'SESSION_NOT_FOUND'
    );

    // 4.11 [K & L] capture_payment_atomic called twice directly
    const directOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 135.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const directOrderId = directOrderRes.data.session.orderId;
    const directPayId = `pay_direct_${Date.now()}`;

    const rpc1 = await pgClient.query(`
      SELECT capture_payment_atomic(
        $1::text, $2::text, $3::uuid, 'RIDE'::text, 'UPI'::text, true, 'RAZORPAY_SANDBOX'::text, null, 135.0::numeric
      ) as result
    `, [directOrderId, directPayId, cust1Uuid]);
    assert('Direct capture_payment_atomic call 1 succeeds with duplicate: false',
      rpc1.rows[0].result.success === true && rpc1.rows[0].result.duplicate === false
    );

    const rpc2 = await pgClient.query(`
      SELECT capture_payment_atomic(
        $1::text, $2::text, $3::uuid, 'RIDE'::text, 'UPI'::text, true, 'RAZORPAY_SANDBOX'::text, null, 135.0::numeric
      ) as result
    `, [directOrderId, directPayId, cust1Uuid]);
    assert('Direct capture_payment_atomic call 2 returns duplicate: true',
      rpc2.rows[0].result.success === true && rpc2.rows[0].result.duplicate === true
    );

    // 4.12 [M] Payment amount mismatch
    const amtMismatchOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 250.0,
      serviceType: 'RIDE'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const amtMismatchOrderId = amtMismatchOrderRes.data.session.orderId;

    const amtMismatchPayload = {
      event: 'payment.captured',
      eventId: `evt_amt_mismatch_${Date.now()}`,
      payload: {
        payment: {
          entity: {
            id: `pay_amt_mismatch_${Date.now()}`,
            order_id: amtMismatchOrderId,
            amount: 50000, // ₹500 vs session ₹250
            status: 'captured'
          }
        }
      }
    };
    const amtMismatchSig = generateWebhookSignature(amtMismatchPayload);
    const amtMismatchRes = await request('POST', '/api/payments/webhook', amtMismatchPayload, { 'x-razorpay-signature': amtMismatchSig });
    assert('Webhook with amount mismatch rejected with HTTP 400 AMOUNT_MISMATCH',
      amtMismatchRes.status === 400 && amtMismatchRes.data.code === 'AMOUNT_MISMATCH'
    );

    // Verify rejection recorded in payment_webhooks
    const amtMismatchDb = await pgClient.query("SELECT * FROM payment_webhooks WHERE event_type = 'capture.amount_mismatch' ORDER BY created_at DESC LIMIT 1");
    assert('Amount mismatch rejection durably recorded in payment_webhooks', amtMismatchDb.rows.length === 1);

    // 4.13 [N] Unknown payment/session ID
    const unknownSessionRes = await pgClient.query(`
      SELECT capture_payment_atomic(
        'order_unknown_random_session_xyz', 'pay_xyz', $1::uuid, 'RIDE'::text, 'UPI'::text, true, 'RAZORPAY_SANDBOX'::text, null, 100.0::numeric
      ) as result
    `, [cust1Uuid]);
    assert('Unknown session ID returns SESSION_NOT_FOUND',
      unknownSessionRes.rows[0].result.success === false && unknownSessionRes.rows[0].result.code === 'SESSION_NOT_FOUND'
    );

    // =========================================================================
    // MODULE 5: TRUE CONCURRENCY (INDEPENDENT POSTGRES CONNECTIONS)
    // =========================================================================
    console.log('\n--- MODULE 5: True Concurrency (Independent PG Connections) ---');

    const concurrentOrderId = `order_conc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const concurrentPayId = `pay_conc_${Date.now()}`;

    // Create session in PostgreSQL
    await pgClient.query(`
      INSERT INTO payment_sessions (order_id, customer_id, amount, currency, service_type, status, provider, key_id)
      VALUES ($1, $2, 350.0, 'INR', 'FOOD', 'INITIATED', 'RAZORPAY_SANDBOX', 'key_test')
    `, [concurrentOrderId, cust1Uuid]);

    // Open two distinct PostgreSQL connections
    const connA = createPgClient();
    const connB = createPgClient();
    await Promise.all([connA.connect(), connB.connect()]);

    const [resA, resB] = await Promise.all([
      connA.query(`
        SELECT capture_payment_atomic(
          $1::text, $2::text, $3::uuid, 'FOOD'::text, 'UPI'::text, true, 'RAZORPAY_SANDBOX'::text, null, 350.0::numeric
        ) as result
      `, [concurrentOrderId, concurrentPayId, cust1Uuid]),
      connB.query(`
        SELECT capture_payment_atomic(
          $1::text, $2::text, $3::uuid, 'FOOD'::text, 'UPI'::text, true, 'RAZORPAY_SANDBOX'::text, null, 350.0::numeric
        ) as result
      `, [concurrentOrderId, concurrentPayId, cust1Uuid])
    ]);

    await Promise.all([connA.end(), connB.end()]);

    const resultA = resA.rows[0].result;
    const resultB = resB.rows[0].result;

    assert('Both concurrent capture calls returned successfully without SQL error',
      resultA.success === true && resultB.success === true
    );

    const winnerCount = (resultA.duplicate === false ? 1 : 0) + (resultB.duplicate === false ? 1 : 0);
    const followerCount = (resultA.duplicate === true ? 1 : 0) + (resultB.duplicate === true ? 1 : 0);

    assert('Exactly ONE concurrent connection became winner (duplicate: false)', winnerCount === 1);
    assert('Exactly ONE concurrent connection became duplicate follower (duplicate: true)', followerCount === 1);

    // Verify financial table mutation is exactly 1 row
    const concPaymentsCount = await pgClient.query('SELECT count(*) as count FROM payments WHERE gateway_order_id = $1', [concurrentOrderId]);
    const concLedgerCount = await pgClient.query('SELECT count(*) as count FROM ledger_entries WHERE reference_id = $1', [concurrentOrderId]);

    assert('Exactly ONE row written to payments table under concurrency race', Number(concPaymentsCount.rows[0].count) === 1);
    assert('Exactly ONE row written to ledger_entries table under concurrency race', Number(concLedgerCount.rows[0].count) === 1);

    // =========================================================================
    // MODULE 6: PERSISTENCE & COLD SERVER RESTART
    // =========================================================================
    console.log('\n--- MODULE 6: Persistence & Cold Server Restart ---');

    // Create and capture a session before restart
    const preRestartOrderRes = await request('POST', '/api/payments/create-order', {
      amount: 499.0,
      currency: 'INR',
      serviceType: 'FOOD'
    }, { 'Authorization': `Bearer ${cust1Token}` });
    const preRestartOrderId = preRestartOrderRes.data.session.orderId;
    const preRestartPayId = `pay_prerestart_${Date.now()}`;
    const preRestartEventId = `evt_prerestart_${Date.now()}`;

    const preRestartWhPayload = {
      event: 'payment.captured',
      eventId: preRestartEventId,
      payload: {
        payment: {
          entity: {
            id: preRestartPayId,
            order_id: preRestartOrderId,
            amount: 49900,
            status: 'captured'
          }
        }
      }
    };
    const preRestartSig = generateWebhookSignature(preRestartWhPayload);
    const preRestartWhRes = await request('POST', '/api/payments/webhook', preRestartWhPayload, { 'x-razorpay-signature': preRestartSig });
    assert('Pre-restart payment webhook captured successfully', preRestartWhRes.status === 200 && preRestartWhRes.data.success);

    // Terminate and restart server from cold start
    await restartServer();

    // Verify post-restart server health
    const postRestartHealth = await request('GET', '/api/health');
    assert('Post-restart backend server is healthy & online', postRestartHealth.status === 200 && postRestartHealth.data.status === 'ONLINE');

    // Query session via API after restart
    const postRestartCustOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const postRestartCustOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: postRestartCustOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const postRestartCust1Token = postRestartCustOtpVerify.data.token || 'usr_session_priya';

    const postRestartSessionQuery = await request('GET', `/api/payments/session/${preRestartOrderId}`, null, {
      'Authorization': `Bearer ${postRestartCust1Token}`
    });
    assert('Pre-restart payment session survived cold restart and read via API',
      postRestartSessionQuery.status === 200 && postRestartSessionQuery.data.session?.status === 'PAYMENT_SUCCESS'
    );

    // Replay pre-restart webhook against fresh backend process
    const postRestartReplayRes = await request('POST', '/api/payments/webhook', preRestartWhPayload, {
      'x-razorpay-signature': preRestartSig
    });
    assert('Pre-restart webhook event replay is recognized as duplicate in PostgreSQL after restart',
      postRestartReplayRes.status === 200 && postRestartReplayRes.data.duplicate === true
    );

    // Verify double-entry ledger endpoint retains records
    const postRestartSuperLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    const postRestartAdminToken = postRestartSuperLogin.data.token;
    const postRestartLedgerRes = await request('GET', '/api/admin/finance/ledger-double-entry', null, {
      'Authorization': `Bearer ${postRestartAdminToken}`
    });
    assert('Double-entry ledger records survived server restart',
      postRestartLedgerRes.status === 200 && postRestartLedgerRes.data.entries.length > 0
    );

    console.log('\n========================================================================');
    console.log(`📊 PHASE 5 TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('========================================================================\n');

  } finally {
    await pgClient.end();
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5SecuritySuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
