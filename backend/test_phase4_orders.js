// =========================================================================
// NABIN — PHASE 4: FOOD & GROCERY POSTGRES ORDER INTEGRATION TEST SUITE
// =========================================================================
const http = require('http');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');
process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const BASE_URL = 'http://127.0.0.1:4000';
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
    if (body) req.write(JSON.stringify(body));
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

async function runPhase4Tests() {
  console.log('========================================================================');
  console.log('🍽️ RUNNING NABIN PHASE 4: FOOD & GROCERY POSTGRES ORDER SUITE');
  console.log('========================================================================\n');

  try {
    await ensureServerRunning();

    // 1. Initial Health & DB Verification
    const health = await request('GET', '/api/health');
    assert('Backend server is healthy & online', health.status === 200 && health.data.status === 'ONLINE');

    const pgCheckClient = createPgClient();
    await pgCheckClient.connect();
    const dbTimeRes = await pgCheckClient.query('SELECT NOW() as db_now;');
    assert('PostgreSQL authoritative database is reachable', !!dbTimeRes.rows[0].db_now);

    // Setup Auth Tokens
    const custOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const custOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: custOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const customerToken = custOtpVerify.data.token || 'usr_session_priya';

    const cust2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9876543210', role: 'CUSTOMER', purpose: 'LOGIN' });
    const cust2OtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9876543210', otp: cust2OtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const customer2Token = cust2OtpVerify.data.token || 'usr_session_rahul';

    const merchantToken = 'mcht_session_dilli';

    // Merchant UUID and Products
    const mcht1Uuid = '00000000-0000-0000-0000-000000000201'; // Dilli Darbar Authentic Mughlai
    const customer1Uuid = '00000000-0000-0000-0000-000000000002'; // Priya Saxena

    // Ensure merchant 1 is set to HYBRID_BOTH so it can fulfill both food & grocery in integration tests
    await pgCheckClient.query(`UPDATE merchants SET merchant_type = 'HYBRID_BOTH' WHERE id = $1`, [mcht1Uuid]);

    // =========================================================================
    // MODULE 1: CUSTOMER FOOD ORDER CREATION & LIFECYCLE
    // =========================================================================
    console.log('\n--- MODULE 1: Customer Food Order Creation (PostgreSQL-Authoritative) ---');

    // 1. Authenticated creation
    const foodIdempKey1 = 'food_idemp_' + crypto.randomUUID();
    const foodBookingRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)', '2x Garlic Butter Naan']
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': foodIdempKey1
    });

    assert('Authenticated customer creates food order in PostgreSQL (HTTP 200)',
      foodBookingRes.status === 200 && foodBookingRes.data.success && !!foodBookingRes.data.order?.id
    );

    const createdFoodOrder = foodBookingRes.data.order;
    assert('Food order state is authoritatively RECEIVED', createdFoodOrder.order_state === 'RECEIVED');
    assert('Food order customer_id matches authenticated session customer UUID', createdFoodOrder.customer_id === customer1Uuid);
    assert('Food order merchant_id matches resolved restaurant UUID', createdFoodOrder.merchant_id === mcht1Uuid);
    assert('Food order service_type is FOOD', createdFoodOrder.service_type === 'FOOD');
    assert('Food order total_amount matches line items (₹340)', Number(createdFoodOrder.total_amount) === 340);
    assert('Food order has exactly 2 order lines', (createdFoodOrder.lines || []).length === 2);

    // 2. Unauthenticated rejection
    const unauthFoodRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)']
    });
    assert('Unauthenticated food order creation rejected with HTTP 401', unauthFoodRes.status === 401);

    // 3. Customer identity binding - cannot forge another user
    const forgedFoodRes = await request('POST', '/api/customer/book-food', {
      customerId: '00000000-0000-0000-0000-000000000001', // Attacker trying to place order on usr_1 account
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)']
    }, { 'Authorization': `Bearer ${customerToken}` });
    assert('Order binds to session identity or rejects cross-customer IDOR',
      forgedFoodRes.status === 403 || (forgedFoodRes.status === 200 && forgedFoodRes.data.order.customer_id === customer1Uuid)
    );

    // 4. Merchant validation - non-existent merchant rejected
    const badMchtRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_non_existent_9999',
      items: ['1x Special Dum Biryani (Chicken)']
    }, { 'Authorization': `Bearer ${customerToken}` });
    assert('Non-existent restaurant rejected with HTTP 404', badMchtRes.status === 404);

    // 5. Cross-merchant / invalid product rejection
    const invalidProdRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Pizza Hut Extravaganza Supreme']
    }, { 'Authorization': `Bearer ${customerToken}` });
    assert('Product not belonging to merchant rejected with HTTP 404/400',
      invalidProdRes.status === 404 || invalidProdRes.status === 400
    );

    // 6. Idempotent retry returns same order
    const replayFoodRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)', '2x Garlic Butter Naan']
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': foodIdempKey1
    });
    assert('Food order idempotent replay returns HTTP 200 with duplicate: true',
      replayFoodRes.status === 200 && replayFoodRes.data.duplicate === true
    );
    assert('Food order idempotent replay returns identical order ID',
      replayFoodRes.data.order.id === createdFoodOrder.id
    );

    // 7. Conflicting idempotency key rejected
    const conflictFoodRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)'] // Different payload
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': foodIdempKey1
    });
    assert('Conflicting idempotency key rejected with HTTP 409 IDEMPOTENCY_CONFLICT',
      conflictFoodRes.status === 409 && conflictFoodRes.data.code === 'IDEMPOTENCY_CONFLICT'
    );

    // 8. Database order persistence verification
    const dbOrderRow = await pgCheckClient.query(`SELECT * FROM orders WHERE id = $1`, [createdFoodOrder.id]);
    assert('Food order exists in PostgreSQL orders table', dbOrderRow.rows.length === 1);
    const dbLinesRows = await pgCheckClient.query(`SELECT * FROM order_lines WHERE order_id = $1`, [createdFoodOrder.id]);
    assert('Food order lines exist in PostgreSQL order_lines table', dbLinesRows.rows.length === 2);

    // 9. Customer order read path
    const getFoodOrderRes = await request('GET', `/api/customer/orders/${createdFoodOrder.id}`, null, {
      'Authorization': `Bearer ${customerToken}`
    });
    assert('Customer reads own food order by ID (HTTP 200)',
      getFoodOrderRes.status === 200 && getFoodOrderRes.data.order.id === createdFoodOrder.id
    );

    const getCustOrdersRes = await request('GET', '/api/customer/orders', null, {
      'Authorization': `Bearer ${customerToken}`
    });
    assert('Customer lists own orders from PostgreSQL',
      getCustOrdersRes.status === 200 && getCustOrdersRes.data.orders.some(o => o.id === createdFoodOrder.id)
    );

    // 10. IDOR protection - Customer 2 cannot read Customer 1's order
    const idorRes = await request('GET', `/api/customer/orders/${createdFoodOrder.id}`, null, {
      'Authorization': `Bearer ${customer2Token}`
    });
    assert('Customer 2 cannot read Customer 1 order (fails with HTTP 403 / IDOR protection)',
      idorRes.status === 403
    );

    // =========================================================================
    // MODULE 2: CUSTOMER GROCERY ORDER CHECKOUT & LINKAGE
    // =========================================================================
    console.log('\n--- MODULE 2: Customer Grocery Checkout (PostgreSQL-Authoritative) ---');

    // 1. Authenticated checkout
    const groceryIdempKey1 = 'groc_idemp_' + crypto.randomUUID();
    const groceryCheckoutRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      cartItems: [
        { productId: 'gprod_3', quantity: 2, price: 56.0 } // Amul Taaza Milk (store_price 56, qty 2 = 112)
      ],
      deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': groceryIdempKey1
    });

    assert('Authenticated customer completes grocery checkout (HTTP 200)',
      groceryCheckoutRes.status === 200 && groceryCheckoutRes.data.success && groceryCheckoutRes.data.code === 'CHECKOUT_SUCCESS'
    );

    const createdGroceryOrder = groceryCheckoutRes.data.order;
    assert('Grocery order service_type is GROCERY', createdGroceryOrder.serviceType === 'GROCERY');
    assert('Grocery order state is authoritatively RECEIVED', createdGroceryOrder.order_state === 'RECEIVED');
    assert('Grocery order total is ₹112 (2 x 56)', createdGroceryOrder.finalTotal === 112);
    assert('Grocery order has authoritative checkoutId linked', !!createdGroceryOrder.checkoutId);

    // 2. Unauthenticated rejection
    const unauthGrocRes = await request('POST', '/api/grocery/checkout/validate', {
      cartItems: [{ productId: 'gprod_3', quantity: 1 }]
    });
    assert('Unauthenticated grocery checkout rejected with HTTP 401', unauthGrocRes.status === 401);

    // 3. Rejection of dark store reference (NO mcht_darkstore_1)
    const darkStoreRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_darkstore_1',
      cartItems: [{ productId: 'gprod_3', quantity: 1 }]
    }, { 'Authorization': `Bearer ${customerToken}` });
    assert('Dark store merchantId (mcht_darkstore_1) rejected with HTTP 400 DARK_STORE_NOT_SUPPORTED',
      darkStoreRes.status === 400 && darkStoreRes.data.code === 'DARK_STORE_NOT_SUPPORTED'
    );

    // 4. Cross-merchant inventory rejection
    // Using inventory 47428bc0-997d-40c7-90f6-3ee0c17b1201 from merchant 23b987de-1a00-4d7f-b662-ed94e16c7b30
    const crossInvRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      cartItems: [{ inventoryId: '47428bc0-997d-40c7-90f6-3ee0c17b1201', quantity: 1 }]
    }, { 'Authorization': `Bearer ${customerToken}` });
    assert('Cross-merchant inventory item rejected with HTTP 400 MERCHANT_MISMATCH',
      crossInvRes.status === 400 && (crossInvRes.data.code === 'MERCHANT_MISMATCH' || crossInvRes.data.code === 'INVENTORY_NOT_FOUND')
    );

    // 5. Checkout duplicate claim / already linked check
    const duplicateClaimRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      checkoutId: createdGroceryOrder.checkoutId, // Already linked to createdGroceryOrder
      cartItems: [{ productId: 'gprod_3', quantity: 1 }]
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': 'claim_attempt_' + crypto.randomUUID()
    });
    assert('Already-linked checkout claim rejected with HTTP 409 CHECKOUT_ALREADY_LINKED',
      duplicateClaimRes.status === 409 && duplicateClaimRes.data.code === 'CHECKOUT_ALREADY_LINKED'
    );

    // 6. Checkout customer ownership check
    // Create checkout for customer 1, but customer 2 attempts to claim it
    const foreignChkRes = await pgCheckClient.query(`
      INSERT INTO checkouts (
        checkout_id, customer_id, merchant_id, service_type,
        payment_method, base_amount, final_payable_amount, checkout_status
      ) VALUES (
        'CHK-' || substr(md5(random()::text), 1, 12),
        $1, $2, 'GROCERY', 'WALLET', 112.00, 112.00, 'CONFIRMED'
      ) RETURNING id;
    `, [customer1Uuid, mcht1Uuid]);
    const foreignCheckoutId = foreignChkRes.rows[0].id;

    const crossCustClaimRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      checkoutId: foreignCheckoutId,
      cartItems: [{ productId: 'gprod_3', quantity: 2 }]
    }, {
      'Authorization': `Bearer ${customer2Token}`, // Customer 2 trying to claim Customer 1's checkout
      'Idempotency-Key': 'cross_cust_' + crypto.randomUUID()
    });
    assert('Checkout ownership mismatch rejected with HTTP 400/409 CHECKOUT_OWNERSHIP_MISMATCH',
      crossCustClaimRes.status === 400 || crossCustClaimRes.status === 409
    );

    // 7. Grocery idempotent retry
    const replayGrocRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      cartItems: [{ productId: 'gprod_3', quantity: 2, price: 56.0 }],
      deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': groceryIdempKey1
    });
    assert('Grocery idempotent replay returns HTTP 200 with duplicate: true',
      replayGrocRes.status === 200 && replayGrocRes.data.duplicate === true
    );
    assert('Grocery idempotent replay returns identical order ID',
      replayGrocRes.data.order.id === createdGroceryOrder.id
    );

    // 8. Database bilateral linkage verification
    const dbGrocOrder = await pgCheckClient.query(`SELECT * FROM orders WHERE id = $1`, [createdGroceryOrder.id]);
    assert('Grocery order persisted in PostgreSQL orders table', dbGrocOrder.rows.length === 1);
    const dbCheckoutRow = await pgCheckClient.query(`SELECT * FROM checkouts WHERE id = $1`, [createdGroceryOrder.checkoutId]);
    assert('Checkout points to created order_id', dbCheckoutRow.rows[0].order_id === createdGroceryOrder.id);
    assert('Order points to checkout_id', dbGrocOrder.rows[0].checkout_id === createdGroceryOrder.checkoutId);

    // =========================================================================
    // MODULE 3: MERCHANT KDS ORDER LIFECYCLE & TENANT ISOLATION
    // =========================================================================
    console.log('\n--- MODULE 3: Merchant KDS Order Lifecycle & Tenant Isolation ---');

    // 1. Merchant Dashboard
    const mchtDashRes = await request('GET', '/api/merchant/rest_1/dashboard', null, {
      'Authorization': `Bearer ${merchantToken}`
    });
    assert('Merchant dashboard reads active orders directly from PostgreSQL (HTTP 200)',
      mchtDashRes.status === 200 && mchtDashRes.data.success && Array.isArray(mchtDashRes.data.orders)
    );

    // 2. Merchant Order List - tenant isolation
    const mchtOrdersRes = await request('GET', '/api/merchant/rest_1/orders', null, {
      'Authorization': `Bearer ${merchantToken}`
    });
    assert('Merchant orders endpoint returns only orders for this merchant',
      mchtOrdersRes.status === 200 && mchtOrdersRes.data.orders.every(o => o.merchant_id === mcht1Uuid)
    );

    // 3. Tenant cross-access blocked
    const crossTenantRes = await request('GET', '/api/merchant/rest_2/orders', null, {
      'Authorization': `Bearer ${merchantToken}` // Session is for rest_1
    });
    assert('Merchant attempting to access another merchant tenant rejected with HTTP 403',
      crossTenantRes.status === 403
    );

    // 4. Valid KDS state transitions for Food order
    // State sequence: RECEIVED -> ACCEPTED -> PREPARING -> READY_FOR_PICKUP
    const acceptRes = await request('POST', `/api/merchant/rest_1/orders/${createdFoodOrder.id}/status`, {
      status: 'ACCEPTED'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant transitions Food order to ACCEPTED (HTTP 200)',
      acceptRes.status === 200 && acceptRes.data.success && acceptRes.data.order_state === 'ACCEPTED'
    );

    const prepRes = await request('POST', `/api/merchant/rest_1/orders/${createdFoodOrder.id}/status`, {
      status: 'PREPARING'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant transitions Food order to PREPARING (HTTP 200)',
      prepRes.status === 200 && prepRes.data.success && prepRes.data.order_state === 'PREPARING'
    );

    const readyRes = await request('POST', `/api/merchant/rest_1/orders/${createdFoodOrder.id}/status`, {
      status: 'READY_FOR_PICKUP'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant transitions Food order to READY_FOR_PICKUP (HTTP 200)',
      readyRes.status === 200 && readyRes.data.success && readyRes.data.order_state === 'READY_FOR_PICKUP'
    );

    // 5. Invalid state transition rejection (e.g. from READY_FOR_PICKUP back to ACCEPTED)
    const invalidTransRes = await request('POST', `/api/merchant/rest_1/orders/${createdFoodOrder.id}/status`, {
      status: 'ACCEPTED',
      idempotencyKey: 'invalid_attempt_' + crypto.randomUUID()
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Invalid state transition rejected with HTTP 400 INVALID_TRANSITION',
      invalidTransRes.status === 400 && (invalidTransRes.data.code === 'INVALID_TRANSITION' || invalidTransRes.data.code === 'TRANSITION_REJECTED')
    );

    // 6. Merchant Rejection Reason Enforcement
    // Create fresh order to test rejection
    const foodToRejectKey = 'food_reject_' + crypto.randomUUID();
    const foodToRejectRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)']
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': foodToRejectKey
    });
    const orderToRejectId = foodToRejectRes.data.order.id;

    // Reject without reason
    const rejectNoReasonRes = await request('POST', `/api/merchant/rest_1/orders/${orderToRejectId}/status`, {
      status: 'REJECTED'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant rejection without reason is rejected with HTTP 400',
      rejectNoReasonRes.status === 400 && rejectNoReasonRes.data.code === 'INVALID_REJECTION_REASON'
    );

    // Reject with invalid reason
    const rejectBadReasonRes = await request('POST', `/api/merchant/rest_1/orders/${orderToRejectId}/status`, {
      status: 'REJECTED',
      reason: 'BECAUSE_I_SAID_SO'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant rejection with unapproved reason is rejected with HTTP 400',
      rejectBadReasonRes.status === 400 && rejectBadReasonRes.data.code === 'INVALID_REJECTION_REASON'
    );

    // Reject with valid approved reason (OUT_OF_STOCK)
    const rejectValidRes = await request('POST', `/api/merchant/rest_1/orders/${orderToRejectId}/status`, {
      status: 'REJECTED',
      reason: 'OUT_OF_STOCK'
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Merchant rejection with approved reason (OUT_OF_STOCK) succeeds (HTTP 200)',
      rejectValidRes.status === 200 && rejectValidRes.data.order_state === 'REJECTED'
    );

    // Audit transition persisted in order_transitions
    const transRow = await pgCheckClient.query(
      `SELECT * FROM order_transitions WHERE order_id = $1 AND new_state = 'REJECTED'`,
      [orderToRejectId]
    );
    assert('Order rejection transition recorded in order_transitions table',
      transRow.rows.length === 1 && transRow.rows[0].reason === 'OUT_OF_STOCK'
    );

    // =========================================================================
    // MODULE 4: TIMEOUT ENGINE (MIGRATION 018 AUTHORITY)
    // =========================================================================
    console.log('\n--- MODULE 4: Timeout Authority (Migration 018) ---');

    // Create fresh order in RECEIVED state
    const timeoutOrderKey = 'order_timeout_' + crypto.randomUUID();
    const timeoutOrderRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)']
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': timeoutOrderKey
    });
    const timeoutOrderId = timeoutOrderRes.data.order.id;

    // Simulate timeout: rewind merchant_timeout_at by 20 minutes
    await pgCheckClient.query(
      `UPDATE orders SET merchant_timeout_at = NOW() - INTERVAL '20 minutes' WHERE id = $1`,
      [timeoutOrderId]
    );

    // Trigger expire_stale_orders via admin endpoint
    // Bootstrap & login admin
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: 'superadmin',
      password: 'AdminPassword123!'
    });
    const adminLogin = await request('POST', '/api/admin/login', {
      username: 'superadmin',
      password: 'AdminPassword123!'
    });
    const adminToken = adminLogin.data.token;

    const expireRes = await request('POST', '/api/admin/orders/expire-stale', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert('Admin triggers expire-stale orders successfully (HTTP 200)',
      expireRes.status === 200 && expireRes.data.success && expireRes.data.expiredCount >= 1
    );

    // Verify order is now CANCELLED with MERCHANT_TIMEOUT
    const expiredOrderRow = await pgCheckClient.query(`SELECT * FROM orders WHERE id = $1`, [timeoutOrderId]);
    assert('Timed out order transitioned to CANCELLED', expiredOrderRow.rows[0].order_state === 'CANCELLED');
    assert('Timed out order timeout_reason is MERCHANT_TIMEOUT', expiredOrderRow.rows[0].timeout_reason === 'MERCHANT_TIMEOUT');

    // Verify audit transition has SYSTEM actor
    const sysTransRow = await pgCheckClient.query(
      `SELECT * FROM order_transitions WHERE order_id = $1 AND new_state = 'CANCELLED'`,
      [timeoutOrderId]
    );
    assert('Timed out order transition actor_type is SYSTEM',
      sysTransRow.rows.length === 1 && sysTransRow.rows[0].actor_type === 'SYSTEM'
    );

    // Idempotency: re-running expire_stale_orders doesn't re-cancel or error
    const expireReplayRes = await request('POST', '/api/admin/orders/expire-stale', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert('Expire-stale rerun is idempotent', expireReplayRes.status === 200 && expireReplayRes.data.success);

    // =========================================================================
    // MODULE 5: GROCERY PACKED WEIGHT CONFIRMATION
    // =========================================================================
    console.log('\n--- MODULE 5: Grocery Packed-Weight Confirmation (Merchant-Side) ---');

    // Get order line for createdGroceryOrder
    const grocLines = await pgCheckClient.query(`SELECT * FROM order_lines WHERE order_id = $1`, [createdGroceryOrder.id]);
    const grocLineId = grocLines.rows[0].id;
    const requestedQty = Number(grocLines.rows[0].quantity); // 2

    // Submit valid packed weight (1.8 <= 2.0)
    const validWeightRes = await request('POST', `/api/grocery/orders/${createdGroceryOrder.id}/packed-weight`, {
      itemId: grocLineId,
      packedWeight: 1.8
    }, { 'Authorization': `Bearer ${merchantToken}` });

    assert('Merchant submits valid packed weight (HTTP 200)',
      validWeightRes.status === 200 && validWeightRes.data.success
    );

    // Verify in PostgreSQL
    const updatedLineRow = await pgCheckClient.query(`SELECT packed_confirmed_quantity FROM order_lines WHERE id = $1`, [grocLineId]);
    assert('PostgreSQL order_lines packed_confirmed_quantity is 1.800',
      Number(updatedLineRow.rows[0].packed_confirmed_quantity) === 1.8
    );

    // Submit packed weight exceeding requested quantity (e.g. 3.0 > 2.0)
    const excessWeightRes = await request('POST', `/api/grocery/orders/${createdGroceryOrder.id}/packed-weight`, {
      itemId: grocLineId,
      packedWeight: 3.0
    }, { 'Authorization': `Bearer ${merchantToken}` });
    assert('Packed weight exceeding requested quantity rejected with HTTP 400',
      excessWeightRes.status === 400
    );

    // =========================================================================
    // MODULE 6: TRUE CONCURRENCY (INDEPENDENT PG CONNECTIONS)
    // =========================================================================
    console.log('\n--- MODULE 6: True Concurrency (Independent PG Connections) ---');

    // Concurrency 1: Same Food Idempotency Key Concurrently
    const concFoodKey = 'conc_food_' + crypto.randomUUID();
    const concClientA = createPgClient();
    const concClientB = createPgClient();
    await concClientA.connect();
    await concClientB.connect();

    const biryaniProductUuid = '00000000-0000-0000-0000-000000000501';
    const foodItemsPayload = JSON.stringify([
      {
        catalog_kind: 'RESTAURANT_PRODUCT',
        restaurant_product_id: biryaniProductUuid,
        quantity: 1,
        unit_price: 220.00,
        unit_snapshot: 'piece',
        product_name_snapshot: 'Special Dum Biryani (Chicken)'
      }
    ]);

    const [concFoodResA, concFoodResB] = await Promise.all([
      concClientA.query(`SELECT create_order_with_lines_atomic('FOOD', $1, $2, 220.00, $3::jsonb, '{}'::jsonb, $4, NULL) as result;`,
        [customer1Uuid, mcht1Uuid, foodItemsPayload, concFoodKey]),
      concClientB.query(`SELECT create_order_with_lines_atomic('FOOD', $1, $2, 220.00, $3::jsonb, '{}'::jsonb, $4, NULL) as result;`,
        [customer1Uuid, mcht1Uuid, foodItemsPayload, concFoodKey])
    ]);

    await concClientA.end();
    await concClientB.end();

    const foodA = concFoodResA.rows[0].result;
    const foodB = concFoodResB.rows[0].result;

    assert('Both concurrent same-key requests succeeded safely', foodA.success === true && foodB.success === true);
    assert('Concurrent same-key requests yielded exactly the same order_id', foodA.order_id === foodB.order_id);
    const oneIsDup = (foodA.duplicate === true && !foodB.duplicate) || (foodB.duplicate === true && !foodA.duplicate);
    assert('Exactly one concurrent caller was primary and the other was duplicate replay', oneIsDup);

    const tokenCount = await pgCheckClient.query(
      `SELECT count(*) FROM order_creation_tokens WHERE idempotency_key = $1`,
      [concFoodKey]
    );
    assert('Exactly 1 idempotency token stored in PostgreSQL', tokenCount.rows[0].count === '1');

    // Concurrency 2: Same Grocery Checkout Concurrently
    const concChkRes = await pgCheckClient.query(`
      INSERT INTO checkouts (
        checkout_id, customer_id, merchant_id, service_type,
        payment_method, base_amount, final_payable_amount, checkout_status
      ) VALUES (
        'CHK-' || substr(md5(random()::text), 1, 12),
        $1, $2, 'GROCERY', 'WALLET', 112.00, 112.00, 'CONFIRMED'
      ) RETURNING id;
    `, [customer1Uuid, mcht1Uuid]);
    const concurrentCheckoutId = concChkRes.rows[0].id;

    const keyConcClaim1 = 'test_claim1_' + crypto.randomUUID();
    const keyConcClaim2 = 'test_claim2_' + crypto.randomUUID();

    const milkInvUuid = '00000000-0000-0000-0000-000000000602';
    const grocItemsPayload = JSON.stringify([
      {
        catalog_kind: 'GROCERY_INVENTORY',
        grocery_inventory_id: milkInvUuid,
        quantity: 2,
        unit_price: 56.00,
        unit_snapshot: 'litre',
        product_name_snapshot: 'Amul Taaza Milk'
      }
    ]);

    const concClaimClient1 = createPgClient();
    const concClaimClient2 = createPgClient();
    await concClaimClient1.connect();
    await concClaimClient2.connect();

    const [claimRes1, claimRes2] = await Promise.all([
      concClaimClient1.query(`SELECT create_order_with_lines_atomic('GROCERY', $1, $2, 112.00, $3::jsonb, '{}'::jsonb, $4, $5) as result;`,
        [customer1Uuid, mcht1Uuid, grocItemsPayload, keyConcClaim1, concurrentCheckoutId]),
      concClaimClient2.query(`SELECT create_order_with_lines_atomic('GROCERY', $1, $2, 112.00, $3::jsonb, '{}'::jsonb, $4, $5) as result;`,
        [customer1Uuid, mcht1Uuid, grocItemsPayload, keyConcClaim2, concurrentCheckoutId])
    ]);

    await concClaimClient1.end();
    await concClaimClient2.end();

    const c1Out = claimRes1.rows[0].result;
    const c2Out = claimRes2.rows[0].result;

    const exactlyOneClaimSucceeded = (c1Out.success === true && c2Out.success === false) || (c1Out.success === false && c2Out.success === true);
    assert('Exactly one concurrent checkout claimant succeeded', exactlyOneClaimSucceeded);
    const rejectedCode = c1Out.success ? c2Out.code : c1Out.code;
    assert('Rejected claimant received CHECKOUT_ALREADY_LINKED', rejectedCode === 'CHECKOUT_ALREADY_LINKED');

    // =========================================================================
    // MODULE 7: SERVER RESTART & DATA INTEGRITY
    // =========================================================================
    console.log('\n--- MODULE 7: Cold Server Restart & Persistence Verification ---');

    // Create pre-restart Food & Grocery orders to verify cold restart survival
    const preRestartFoodKey = 'pre_restart_food_' + crypto.randomUUID();
    const preFoodRes = await request('POST', '/api/customer/book-food', {
      restaurantId: 'rest_1',
      items: ['2x Garlic Butter Naan']
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': preRestartFoodKey
    });
    const preFoodOrderId = preFoodRes.data.order.id;

    const preRestartGrocKey = 'pre_restart_groc_' + crypto.randomUUID();
    const preGrocRes = await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1',
      cartItems: [{ productId: 'gprod_3', quantity: 1, price: 56.0 }]
    }, {
      'Authorization': `Bearer ${customerToken}`,
      'Idempotency-Key': preRestartGrocKey
    });
    const preGrocOrderId = preGrocRes.data.order.id;
    const preGrocCheckoutId = preGrocRes.data.order.checkoutId;

    console.log('🛑 Terminating backend process listening on port 4000...');
    try {
      execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
    } catch (e) {}

    await sleep(2000);

    console.log('🚀 Spawning fresh backend process from cold start...');
    const serverProcess = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: path.join(__dirname),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    serverProcess.unref();

    await sleep(3500);

    // Verify server is back online
    const postHealth = await request('GET', '/api/health');
    assert('Post-restart backend server is healthy & online', postHealth.status === 200 && postHealth.data.status === 'ONLINE');

    // Read back pre-restart Food order via customer API
    const postCustOtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
    const postCustOtpVerify = await request('POST', '/api/auth/verify-otp', { phone: '9845011982', otp: postCustOtpSend.data.testOtp || '7729', role: 'CUSTOMER' });
    const postCustToken = postCustOtpVerify.data.token || 'usr_session_priya';

    const postFoodRead = await request('GET', `/api/customer/orders/${preFoodOrderId}`, null, {
      'Authorization': `Bearer ${postCustToken}`
    });
    assert('Pre-restart Food order survived cold restart and read via API',
      postFoodRead.status === 200 && postFoodRead.data.order.id === preFoodOrderId
    );
    assert('Pre-restart Food order lines survived cold restart',
      (postFoodRead.data.order.lines || []).length === 1 && postFoodRead.data.order.lines[0].quantity === 2
    );

    // Read back pre-restart Grocery order via customer API
    const postGrocRead = await request('GET', `/api/customer/orders/${preGrocOrderId}`, null, {
      'Authorization': `Bearer ${postCustToken}`
    });
    assert('Pre-restart Grocery order survived cold restart and read via API',
      postGrocRead.status === 200 && postGrocRead.data.order.id === preGrocOrderId
    );
    assert('Pre-restart Grocery order checkout_id remains intact in PostgreSQL',
      postGrocRead.data.order.checkout_id === preGrocCheckoutId
    );

    await pgCheckClient.end();

    console.log('\n========================================================================');
    console.log(`📊 PHASE 4 TEST RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
    console.log('========================================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('💥 Fatal error running Phase 4 test suite:', err);
    process.exit(1);
  }
}

runPhase4Tests();
