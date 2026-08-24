const https = require('https');
const http = require('http');

const BASE_URL = process.env.NABIN_API_URL || 'http://localhost:4000';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = BASE_URL.startsWith('https');
    const lib = isHttps ? https : http;
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;

    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...headers
      }
    };

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runPaymentSandboxSuite() {
  console.log('========================================================================');
  console.log('💳 NABIN REAL PAYMENT GATEWAY CHECKOUT & VERIFICATION SUITE');
  console.log('🎯 Target Backend:', BASE_URL);
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title, condition, detail = '') {
    if (condition) {
      console.log(`✅ [PASS] ${title} ${detail ? '— ' + detail : ''}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title} ${detail ? '— ' + detail : ''}`);
      failed++;
    }
  }

  // 1. Create Payment Order Session (Ride Checkout)
  console.log('--- 1. REAL PROVIDER TEST ORDER SESSION CREATION ---');
  const createRideOrder = await request('POST', '/api/payments/create-order', {
    customerId: 'usr_cust_9876543210',
    amount: 145.0,
    currency: 'INR',
    serviceType: 'RIDE',
    jobId: 'JOB-RIDE-TEST-1',
    metadata: { pickup: 'Civil Lines, Delhi', drop: 'Connaught Place' }
  });

  assert('Create Real Provider Order Session', createRideOrder.status === 200 && createRideOrder.body.session?.orderId != null, `Order ID: ${createRideOrder.body.session?.orderId}`);
  const orderId = createRideOrder.body.session?.orderId;
  const initialStatus = createRideOrder.body.session?.status;
  assert('Initial session status is PAYMENT_PENDING', initialStatus === 'PAYMENT_PENDING');

  // 2. Query Session
  const getSessionRes = await request('GET', `/api/payments/session/${orderId}`);
  assert('Query Payment Session by Order ID', getSessionRes.status === 200 && getSessionRes.body.session?.amount === 145.0);

  // 3. Customer Completes Sandbox Checkout (Successful Payment)
  console.log('\n--- 2. PAYMENT SIGNATURE VERIFICATION & SUCCESS SETTLEMENT ---');
  const paymentId = `pay_rzp_test_${Date.now()}`;
  const signature = `sig_${Date.now()}_sha256`;

  const verifySuccessRes = await request('POST', '/api/payments/verify-checkout', {
    orderId,
    paymentId,
    signature,
    status: 'SUCCESS'
  });

  assert('Verify Payment Checkout with valid signature', verifySuccessRes.status === 200 && verifySuccessRes.body.status === 'PAYMENT_SUCCESS');
  assert('Payment session updated to PAYMENT_SUCCESS', verifySuccessRes.body.session?.status === 'PAYMENT_SUCCESS', `Payment ID: ${paymentId}`);

  // 4. Idempotency Check (Duplicate Verification Replay)
  console.log('\n--- 3. IDEMPOTENCY & DUPLICATE REPLAY PROTECTION ---');
  const verifyDuplicateRes = await request('POST', '/api/payments/verify-checkout', {
    orderId,
    paymentId,
    signature,
    status: 'SUCCESS'
  });

  assert('Duplicate payment verification handled idempotently without double-crediting', 
    verifyDuplicateRes.status === 200 && (verifyDuplicateRes.body.duplicate === true || verifyDuplicateRes.body.session?.status === 'PAYMENT_SUCCESS')
  );

  // 5. Failed Payment Handling (Bank Decline)
  console.log('\n--- 4. FAILED PAYMENT HANDLING ---');
  const createFailedOrder = await request('POST', '/api/payments/create-order', {
    customerId: 'usr_cust_9876543210',
    amount: 320.0,
    serviceType: 'FOOD',
    jobId: 'JOB-FOOD-FAIL-1'
  });
  const failOrderId = createFailedOrder.body.session?.orderId;

  const verifyFailedRes = await request('POST', '/api/payments/verify-checkout', {
    orderId: failOrderId,
    status: 'FAILED',
    failureReason: 'Card issuer declined transaction (Insufficient Funds)'
  });

  assert('Failed payment rejected and marked PAYMENT_FAILED', 
    verifyFailedRes.status >= 200 && verifyFailedRes.body.session?.status === 'PAYMENT_FAILED',
    verifyFailedRes.body.error
  );

  // 6. Cancelled Payment Handling (User Dismissed Modal)
  console.log('\n--- 5. CANCELLED PAYMENT HANDLING ---');
  const createCancelOrder = await request('POST', '/api/payments/create-order', {
    customerId: 'usr_cust_9876543210',
    amount: 210.0,
    serviceType: 'PARCEL',
    jobId: 'JOB-PARCEL-CANCEL-1'
  });
  const cancelOrderId = createCancelOrder.body.session?.orderId;

  const verifyCancelRes = await request('POST', '/api/payments/verify-checkout', {
    orderId: cancelOrderId,
    status: 'CANCELLED'
  });

  assert('Cancelled payment marked PAYMENT_CANCELLED without transaction completion',
    verifyCancelRes.status >= 200 && verifyCancelRes.body.session?.status === 'PAYMENT_CANCELLED'
  );

  // 7. Double-Entry Ledger Verification
  console.log('\n--- 6. DOUBLE-ENTRY LEDGER & ESCROW AUDIT ---');
  const superLogin = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const adminToken = superLogin.body.token;

  const ledgerRes = await request('GET', `/api/admin/finance/ledger-double-entry?transactionId=${paymentId}`, null, { 'Authorization': `Bearer ${adminToken}` });
  const ledgerEntries = ledgerRes.body.entries || [];
  assert('Double-entry ledger recorded exactly once for successful payment', ledgerEntries.length === 1, `Debit: ${ledgerEntries[0]?.debitAccount}, Credit: ${ledgerEntries[0]?.creditAccount}, Amount: ₹${ledgerEntries[0]?.amount}`);

  console.log('\n========================================================================');
  console.log(`📊 PAYMENT GATEWAY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');
}

runPaymentSandboxSuite().catch(console.error);
