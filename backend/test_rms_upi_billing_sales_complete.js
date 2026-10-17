'use strict';

/**
 * NABIN RMS — COMPREHENSIVE VERIFICATION TEST SUITE
 * Tests all 17 automated criteria from user specification Section 11:
 * 01. Restaurant owner creates and edits UPI settings
 * 02. Restaurant uploads, replaces, and removes a static QR
 * 03. Restaurant A cannot view or edit Restaurant B's settings (Tenant Isolation)
 * 04. Bill generation displays the correct restaurant QR
 * 05. Bill generation works when no QR is configured
 * 06. Cash payment recording (with change calculation)
 * 07. UPI payment recording with an optional reference
 * 08. Split cash and UPI payment
 * 09. Partial payment and outstanding balance tracking
 * 10. Duplicate payment prevention
 * 11. Fully paid bill and receipt generation
 * 12. Unpaid bill cannot be incorrectly marked paid
 * 13. Historical bill and receipt remain unchanged after UPI settings change
 * 14. Sales reports match persisted bill and payment records
 * 15. Dine-In, Takeaway, and Delivery channel separation
 * 16. Persistence schema mapping and table constraints, proved against the live PostgreSQL catalog
 * 17. QR-to-order-to-KDS-to-bill-to-payment-record end-to-end integration
 *
 * Two modes, one set of fixtures. Against a target where the RMS durability gate is closed the
 * repository answers from its Maps; through scripts/with_local_target.js every one of these calls is
 * a PostgreSQL RPC. The order fixtures are therefore real rows (`users`, `products`, `orders`,
 * `order_lines`) attached through `recordSessionOrder` rather than hand-written onto the repository's
 * private `session.orders`, so the durable run proves the store and not this process's memory. The
 * assertions are identical in both modes and are not adjusted for either one, except Test 16: that is
 * a database-integration check, so with the gate closed it reports NOT APPLICABLE instead of reading
 * migration text and calling the live schema verified. What the suite creates is removed again at both
 * ends of the run (see fixture hygiene at the bottom).
 */

const assert = require('assert');
const crypto = require('crypto');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const RestaurantManagementRepository = require('./src/repositories/RestaurantManagementRepository');
const { isLivePostgres, supabaseAdmin, nabinEnv } = require('./src/supabase');

const RESTAURANT_A = '00000000-0000-0000-0000-000000000201';
const RESTAURANT_B = '00000000-0000-0000-0000-000000000202';
// Same reason as in test_rms_postgres_durability.js: an isolated chain link is handed a DATABASE_URL
// whose `options=-c search_path=chain_scratch` scopes it to the clone, and this suite's direct SQL
// checks and marker-scoped cleanup have to act on the schema the backend actually wrote. For that to
// hold, every statement below must name its tables UNqualified — a `public.` prefix would ignore the
// search_path the link was given and put the write/assert targets back on different schemas.
// F-C1-1: and the store must be DECLARED, not typed into this file — with the keys unset nothing is
// connected and no row is written. LOCAL_POSTGRES_URL stays the operator override, now guarded.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({
  label: 'test_rms_upi_billing_sales_complete',
  keys: ['LOCAL_POSTGRES_URL', 'DATABASE_URL', 'NABIN_PG_NOTIFY'],
});
const PG_URL = PG_TARGET.connectionString;

// Fixture identifiers. Every row this suite mints outside the RMS tables carries one of these markers
// and nothing else in the database does, which is what makes the cleanup at the bottom scoped instead
// of broad. The order-number prefix and the product category are patterns, so a run that died before
// its exit cleanup still has its residue found by the next one; the customer is keyed by its email.
const FIXTURE_RUN_TAG = String(crypto.randomInt(10000000, 99999999));
const FIXTURE_ORDER_PREFIX = `RMSSPEC-${FIXTURE_RUN_TAG}`;
const FIXTURE_ORDER_LIKE = 'RMSSPEC-%';
const FIXTURE_PRODUCT_CATEGORY = 'RMSSPEC';
const FIXTURE_CUSTOMER_PHONE = `9${FIXTURE_RUN_TAG}`;
const FIXTURE_CUSTOMER_EMAIL = `rmsspec-${FIXTURE_RUN_TAG}@example.invalid`;
const FIXTURE_CUSTOMER_LIKE = 'rmsspec-%@example.invalid';

async function runTestSuite(pg) {
  console.log('========================================================================');
  console.log('📋 NABIN RMS: COMPREHENSIVE UPI, BILLING & SALES VERIFICATION SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let total = 0;
  let notApplicable = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  const mockDb = {
    merchants: [
      { id: RESTAURANT_A, uuid: RESTAURANT_A, name: 'Heritage Diner', address: '124 Station Road, Aizawl', phone: '+919876543210' },
      { id: RESTAURANT_B, uuid: RESTAURANT_B, name: 'Blue Pearl Cafe', address: '45 Lake View, Shillong', phone: '+919876543211' }
    ]
  };

  const rms = new RestaurantManagementRepository(mockDb);

  // ------------------------------------------------------------------------
  // FIXTURES: an order is a row, not a field on this process's session object
  // ------------------------------------------------------------------------
  // `rms_bill_basis` (migration 043) builds a bill from `order_lines` joined to the orders whose
  // `table_session_id` points at the session, so a session whose orders were only ever assigned in
  // memory would be billed at zero and every money assertion below would have proved the Map, not the
  // store. `seedOrder` therefore writes the rows a real dine-in order has: a catalog `products` entry
  // per dish (so `order_lines.restaurant_product_id` is a foreign key to something, and the merchant
  // owns it), one `orders` row, one `order_lines` row per dish with the snapshot columns filled in,
  // and then it calls `recordSessionOrder` — which is `rms_attach_order_to_session_atomic` under the
  // gate and the Map push outside it. Memory mode goes through the same repository method, so the two
  // modes differ in where the rows live, not in how the suite fabricates them.
  const durable = Boolean(rms.pgEnabled);
  if (durable && !pg) {
    throw new Error('The RMS durability gate is open but this suite has no PostgreSQL client to seed '
      + 'its order fixtures with. Run it through scripts/with_local_target.js.');
  }

  // A check that can only be answered by the store. Outside the durability gate there is no connection
  // to ask, and the honest answer is NOT APPLICABLE: an assertion over migration 041's text would only
  // prove the file is on disk while reading as "PostgreSQL persistence verified". These checks are
  // counted separately from `total` so the summary cannot report them as passes.
  async function databaseIntegrationTest(name, fn) {
    if (!durable || !pg) {
      notApplicable++;
      console.log(`  ⚪ [NOT APPLICABLE] ${name}: the RMS durability gate is closed on this target, so `
        + 'there is no live PostgreSQL connection to verify the schema, the constraints or the rms_* '
        + 'RPCs against. This run did NOT check the database integration path.');
      return;
    }
    total++;
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  let fixtureCustomerId = null;
  let orderSeq = 0;

  async function seedOrder(sessionId, merchantId, dishes) {
    const lines = dishes.map(d => ({
      name: d.name,
      quantity: d.quantity,
      unitPrice: d.unitPrice,
      lineTotal: Math.round(d.quantity * d.unitPrice * 100) / 100
    }));
    const orderTotal = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;

    if (!durable) {
      const orderId = crypto.randomUUID();
      await rms.recordSessionOrder(sessionId, {
        id: orderId,
        total_amount: orderTotal,
        items: lines.map(l => ({
          dish_name: l.name,
          quantity: l.quantity,
          unit_price_snapshot: l.unitPrice,
          line_total: l.lineTotal
        }))
      }, merchantId);
      return { id: orderId, totalAmount: orderTotal };
    }

    if (!fixtureCustomerId) {
      const { rows } = await pg.query(
        'INSERT INTO users (phone, name, email) VALUES ($1, $2, $3)'
        + ' ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id',
        [FIXTURE_CUSTOMER_PHONE, 'RMS Spec Diner', FIXTURE_CUSTOMER_EMAIL]
      );
      fixtureCustomerId = rows[0].id;
    }
    orderSeq++;
    const orderNumber = `${FIXTURE_ORDER_PREFIX}-O${orderSeq}`;
    const order = await pg.query(
      'INSERT INTO orders (order_number, customer_id, merchant_id, service_type, order_state,'
      + " total_amount, items_snapshot) VALUES ($1, $2, $3, 'FOOD', 'RECEIVED', $4, '[]'::jsonb) RETURNING id",
      [orderNumber, fixtureCustomerId, merchantId, orderTotal]
    );
    const orderId = order.rows[0].id;

    for (const l of lines) {
      const product = await pg.query(
        'INSERT INTO products (merchant_id, name, category, price) VALUES ($1, $2, $3, $4) RETURNING id',
        [merchantId, l.name, FIXTURE_PRODUCT_CATEGORY, l.unitPrice]
      );
      await pg.query(
        'INSERT INTO order_lines (order_id, merchant_id, catalog_kind, restaurant_product_id,'
        + " product_name_snapshot, quantity, unit_snapshot, unit_price_snapshot, line_total)"
        + " VALUES ($1, $2, 'RESTAURANT_PRODUCT', $3, $4, $5, 'piece', $6, $7)",
        [orderId, merchantId, product.rows[0].id, l.name, l.quantity, l.unitPrice, l.lineTotal]
      );
    }

    await rms.recordSessionOrder(sessionId, { id: orderId }, merchantId);
    return { id: orderId, orderNumber, totalAmount: orderTotal };
  }

  // ------------------------------------------------------------------------
  // TEST 01: Restaurant owner creates and edits UPI settings
  // ------------------------------------------------------------------------
  await testAsync('Test 01: Restaurant owner creates and edits UPI settings', async () => {
    // Valid UPI ID creation
    const s1 = await rms.updatePaymentSettings(RESTAURANT_A, {
      upiId: 'heritagediner@okhdfcbank',
      upiMerchantName: 'Heritage Diner Enterprises',
      gstin: '15ABCDE1234F1Z5'
    }, 'OWNER');
    assert.strictEqual(s1.upi_id, 'heritagediner@okhdfcbank');
    assert.strictEqual(s1.upi_merchant_name, 'Heritage Diner Enterprises');
    assert.strictEqual(s1.gstin, '15ABCDE1234F1Z5');

    // Invalid UPI format rejected
    let rejected = false;
    try {
      await rms.updatePaymentSettings(RESTAURANT_A, { upiId: 'invalid-upi-no-at' }, 'OWNER');
    } catch (e) {
      rejected = e.code === 'INVALID_UPI_ID';
    }
    assert.ok(rejected, 'Invalid UPI ID format must be rejected');

    // Unauthorized role (KITCHEN_STAFF) rejected
    let forbidden = false;
    try {
      await rms.updatePaymentSettings(RESTAURANT_A, { upiId: 'hacker@paytm' }, 'KITCHEN_STAFF');
    } catch (e) {
      forbidden = e.code === 'FORBIDDEN_PAYMENT_SETTINGS';
    }
    assert.ok(forbidden, 'Kitchen staff must not be permitted to update payment settings');
  });

  // ------------------------------------------------------------------------
  // TEST 02: Restaurant uploads, replaces, and removes a static QR
  // ------------------------------------------------------------------------
  await testAsync('Test 02: Restaurant uploads, replaces, and removes a static QR', async () => {
    const fakeBase64Png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const s1 = await rms.updatePaymentSettings(RESTAURANT_A, {
      upiQrUrl: fakeBase64Png
    }, 'OWNER');
    assert.strictEqual(s1.upi_qr_url, fakeBase64Png);

    // Replace
    const fakeBase64Jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const s2 = await rms.updatePaymentSettings(RESTAURANT_A, {
      upiQrUrl: fakeBase64Jpeg
    }, 'OWNER');
    assert.strictEqual(s2.upi_qr_url, fakeBase64Jpeg);

    // Remove
    const s3 = await rms.updatePaymentSettings(RESTAURANT_A, {
      upiQrUrl: null
    }, 'OWNER');
    assert.strictEqual(s3.upi_qr_url, null);

    // Reject non-image mime type
    let badMime = false;
    try {
      await rms.updatePaymentSettings(RESTAURANT_A, {
        upiQrUrl: 'data:application/pdf;base64,JVBERi0xLjQK',
        mimeType: 'application/pdf'
      }, 'OWNER');
    } catch (_) {
      badMime = true;
    }
    assert.ok(badMime, 'Unsupported image format must be rejected');
  });

  // ------------------------------------------------------------------------
  // TEST 03: Restaurant A cannot view or edit Restaurant B's settings
  // ------------------------------------------------------------------------
  await testAsync("Test 03: Restaurant A cannot view or edit Restaurant B's settings (Tenant Isolation)", async () => {
    // Set Rest A
    await rms.updatePaymentSettings(RESTAURANT_A, {
      upiId: 'restA@okhdfcbank',
      upiQrUrl: 'data:image/png;base64,restAQR'
    }, 'OWNER');

    // Rest B has its own defaults
    const settingsB = await rms.getSettings(RESTAURANT_B);
    assert.notStrictEqual(settingsB.upi_id, 'restA@okhdfcbank');
    assert.strictEqual(settingsB.upi_qr_url, null);

    // Update Rest B
    await rms.updatePaymentSettings(RESTAURANT_B, {
      upiId: 'restB@icici',
      upiQrUrl: 'data:image/png;base64,restBQR'
    }, 'OWNER');

    // Verify Rest A is completely unaffected
    const settingsA = await rms.getSettings(RESTAURANT_A);
    assert.strictEqual(settingsA.upi_id, 'restA@okhdfcbank');
    assert.strictEqual(settingsA.upi_qr_url, 'data:image/png;base64,restAQR');
  });

  // ------------------------------------------------------------------------
  // TEST 04: Bill generation displays the correct restaurant QR
  // ------------------------------------------------------------------------
  let billA;
  let sessionA;
  await testAsync('Test 04: Bill generation displays the correct restaurant QR', async () => {
    const table = await rms.createTable(RESTAURANT_A, { tableNumber: '1', capacity: 4 });
    sessionA = await rms.openSession(RESTAURANT_A, table.id, { guestCount: 2 });
    await seedOrder(sessionA.id, RESTAURANT_A, [
      { name: 'Paneer Butter Masala', quantity: 1, unitPrice: 350 },
      { name: 'Garlic Naan', quantity: 3, unitPrice: 50 }
    ]);

    billA = await rms.getBillForSession(RESTAURANT_A, sessionA.id);
    assert.ok(billA.paymentInstructions, 'Bill must contain paymentInstructions snapshot');
    assert.strictEqual(billA.paymentInstructions.upiId, 'restA@okhdfcbank');
    assert.strictEqual(billA.paymentInstructions.upiQrUrl, 'data:image/png;base64,restAQR');
    assert.strictEqual(billA.paymentInstructions.instruction, 'Scan with your UPI app and enter the bill amount.');
    assert.ok(billA.invoiceNumber.startsWith('INV-'));
    assert.strictEqual(billA.items.length, 2);
  });

  // ------------------------------------------------------------------------
  // TEST 05: Bill generation works when no QR is configured
  // ------------------------------------------------------------------------
  await testAsync('Test 05: Bill generation works when no QR is configured', async () => {
    // Clear QR from Rest B
    await rms.updatePaymentSettings(RESTAURANT_B, { upiId: null, upiQrUrl: null }, 'OWNER');
    const tableB = await rms.createTable(RESTAURANT_B, { tableNumber: '1', capacity: 2 });
    const sessionB = await rms.openSession(RESTAURANT_B, tableB.id, { guestCount: 2 });
    await seedOrder(sessionB.id, RESTAURANT_B, [{ name: 'Fried Rice', quantity: 1, unitPrice: 300 }]);

    const billB = await rms.getBillForSession(RESTAURANT_B, sessionB.id);
    assert.strictEqual(billB.paymentInstructions.upiQrUrl, null, 'Must NOT generate or display fake QR');
    assert.strictEqual(billB.paymentInstructions.upiId, null);
    assert.strictEqual(billB.paymentInstructions.instruction, null);
  });

  // ------------------------------------------------------------------------
  // TEST 06: Cash payment recording (with change calculation)
  // ------------------------------------------------------------------------
  await testAsync('Test 06: Cash payment recording (with change calculation)', async () => {
    const tableC = await rms.createTable(RESTAURANT_A, { tableNumber: '3', capacity: 2 });
    const sessionC = await rms.openSession(RESTAURANT_A, tableC.id, { guestCount: 1 });
    await seedOrder(sessionC.id, RESTAURANT_A, [{ name: 'Thali', quantity: 1, unitPrice: 450 }]);

    const billC = await rms.getBillForSession(RESTAURANT_A, sessionC.id);
    // Bill total is subtotal 450 + 5% GST (22.50) = 472.50
    // Customer hands ₹500 note
    const payResult = await rms.recordBillPayment(RESTAURANT_A, billC.id, {
      amount: 500,
      paymentMethod: 'CASH',
      collectedBy: 'Cashier Sunita'
    });
    const updated = payResult.bill || payResult;
    assert.strictEqual(updated.status, 'PAID');
    assert.strictEqual(updated.balanceAmount, 0);

    const cashEntry = updated.payments[0];
    assert.strictEqual(cashEntry.paymentMethod, 'CASH');
    assert.strictEqual(cashEntry.amount, 500);
    assert.strictEqual(cashEntry.changeDue, 27.5); // 500 - 472.50 = 27.50
    assert.strictEqual(cashEntry.effectiveCredited, 472.5);
  });

  // ------------------------------------------------------------------------
  // TEST 07: UPI payment recording with an optional reference
  // ------------------------------------------------------------------------
  await testAsync('Test 07: UPI payment recording with an optional reference', async () => {
    const tableD = await rms.createTable(RESTAURANT_A, { tableNumber: '4', capacity: 2 });
    const sessionD = await rms.openSession(RESTAURANT_A, tableD.id, { guestCount: 2 });
    await seedOrder(sessionD.id, RESTAURANT_A, [{ name: 'Snacks', quantity: 1, unitPrice: 200 }]);

    const billD = await rms.getBillForSession(RESTAURANT_A, sessionD.id);
    const payResult = await rms.recordBillPayment(RESTAURANT_A, billD.id, {
      amount: 100,
      paymentMethod: 'UPI',
      transactionRef: 'UPI_TXN_9988771122'
    });
    const updated = payResult.bill || payResult;
    const upiEntry = updated.payments[0];
    assert.strictEqual(upiEntry.paymentMethod, 'UPI');
    assert.strictEqual(upiEntry.transactionRef, 'UPI_TXN_9988771122');
    assert.strictEqual(upiEntry.note, 'Staff recorded direct UPI payment (not bank verified)');
    assert.strictEqual(updated.status, 'PARTIALLY_PAID');
  });

  // ------------------------------------------------------------------------
  // TEST 08: Split cash and UPI payment
  // ------------------------------------------------------------------------
  await testAsync('Test 08: Split cash and UPI payment on single bill', async () => {
    const tableE = await rms.createTable(RESTAURANT_A, { tableNumber: '5', capacity: 4 });
    const sessionE = await rms.openSession(RESTAURANT_A, tableE.id, { guestCount: 2 });
    await seedOrder(sessionE.id, RESTAURANT_A, [{ name: 'Family Platter', quantity: 1, unitPrice: 600 }]);

    const billE = await rms.getBillForSession(RESTAURANT_A, sessionE.id);
    // Total is 600 + 5% GST = 630
    // Part 1: ₹300 via CASH
    await rms.recordBillPayment(RESTAURANT_A, billE.id, {
      amount: 300,
      paymentMethod: 'CASH',
      reference: 'CASH_RECEIPT_1'
    });

    // Part 2: ₹330 via UPI
    const pay2 = await rms.recordBillPayment(RESTAURANT_A, billE.id, {
      amount: 330,
      paymentMethod: 'UPI',
      reference: 'UPI_SPLIT_REF_2'
    });
    const updated = pay2.bill || pay2;
    assert.strictEqual(updated.status, 'PAID');
    assert.strictEqual(updated.balanceAmount, 0);
    assert.strictEqual(updated.paidAmount, 630);
    assert.strictEqual(updated.payments.length, 2);
    assert.strictEqual(updated.payments[0].paymentMethod, 'CASH');
    assert.strictEqual(updated.payments[1].paymentMethod, 'UPI');
  });

  // ------------------------------------------------------------------------
  // TEST 09: Partial payment and outstanding balance
  // ------------------------------------------------------------------------
  await testAsync('Test 09: Partial payment and outstanding balance', async () => {
    const tableF = await rms.createTable(RESTAURANT_A, { tableNumber: '6', capacity: 2 });
    const sessionF = await rms.openSession(RESTAURANT_A, tableF.id, { guestCount: 2 });
    await seedOrder(sessionF.id, RESTAURANT_A, [{ name: 'Buffet', quantity: 2, unitPrice: 500 }]);

    const billF = await rms.getBillForSession(RESTAURANT_A, sessionF.id);
    // Total = 1050
    const pay1 = await rms.recordBillPayment(RESTAURANT_A, billF.id, {
      amount: 400,
      paymentMethod: 'CARD'
    });
    const updated = pay1.bill || pay1;
    assert.strictEqual(updated.status, 'PARTIALLY_PAID');
    assert.strictEqual(updated.paidAmount, 400);
    assert.strictEqual(updated.balanceAmount, 650);

    // Session and table also track the exact unpaid balance
    const sess = rms._sessions.get(sessionF.id);
    assert.strictEqual(sess.balanceAmount, 650);
    const tbl = rms._tables.get(tableF.id);
    assert.strictEqual(tbl.unpaidBalance, 650);
  });

  // ------------------------------------------------------------------------
  // TEST 10: Duplicate payment prevention
  // ------------------------------------------------------------------------
  await testAsync('Test 10: Duplicate payment prevention', async () => {
    const tableG = await rms.createTable(RESTAURANT_A, { tableNumber: '7', capacity: 2 });
    const sessionG = await rms.openSession(RESTAURANT_A, tableG.id, { guestCount: 2 });
    await seedOrder(sessionG.id, RESTAURANT_A, [{ name: 'Meals', quantity: 1, unitPrice: 200 }]);

    const billG = await rms.getBillForSession(RESTAURANT_A, sessionG.id);
    await rms.recordBillPayment(RESTAURANT_A, billG.id, {
      amount: 100,
      paymentMethod: 'UPI',
      transactionRef: 'DUPLICATE_KEY_123'
    });

    // Submitting again with identical reference must be rejected
    let dupRejected = false;
    try {
      await rms.recordBillPayment(RESTAURANT_A, billG.id, {
        amount: 100,
        paymentMethod: 'UPI',
        transactionRef: 'DUPLICATE_KEY_123'
      });
    } catch (e) {
      dupRejected = e.code === 'DUPLICATE_PAYMENT';
    }
    assert.ok(dupRejected, 'Duplicate transaction reference must be strictly rejected');
  });

  // ------------------------------------------------------------------------
  // TEST 11: Fully paid bill and receipt generation
  // ------------------------------------------------------------------------
  await testAsync('Test 11: Fully paid bill and receipt generation', async () => {
    // Settle billA completely (Total is 525, pay 525)
    await rms.recordBillPayment(RESTAURANT_A, billA.id, {
      amount: billA.totalAmount,
      paymentMethod: 'UPI',
      transactionRef: 'RECEIPT_TEST_UPI_01'
    });

    const receipt = await rms.getBillReceipt(RESTAURANT_A, billA.id);
    assert.strictEqual(receipt.isFullyPaid, true);
    assert.strictEqual(receipt.paymentStatus, 'PAID');
    assert.strictEqual(receipt.statusText, 'PAID IN FULL');
    assert.ok(receipt.receiptNumber.startsWith('REC-'));
    assert.strictEqual(receipt.totalAmount, billA.totalAmount);
    assert.strictEqual(receipt.paidAmount, billA.totalAmount);
    assert.strictEqual(receipt.balanceAmount, 0);
    assert.strictEqual(receipt.paymentInstructions.upiId, 'restA@okhdfcbank');
  });

  // ------------------------------------------------------------------------
  // TEST 12: Unpaid bill cannot be incorrectly marked paid
  // ------------------------------------------------------------------------
  await testAsync('Test 12: Unpaid bill cannot be incorrectly marked paid', async () => {
    const tableH = await rms.createTable(RESTAURANT_A, { tableNumber: '8', capacity: 2 });
    const sessionH = await rms.openSession(RESTAURANT_A, tableH.id, { guestCount: 2 });
    await seedOrder(sessionH.id, RESTAURANT_A, [{ name: 'Curry', quantity: 1, unitPrice: 500 }]);

    const billH = await rms.getBillForSession(RESTAURANT_A, sessionH.id);
    const receiptH = await rms.getBillReceipt(RESTAURANT_A, billH.id);
    assert.strictEqual(receiptH.isFullyPaid, false);
    assert.strictEqual(receiptH.paymentStatus, 'UNPAID');
    assert.strictEqual(receiptH.statusText, `BALANCE DUE: ₹${billH.balanceAmount.toFixed(2)}`);

    // Cannot close session while unpaid
    let closeRejected = false;
    try {
      await rms.closeSession(RESTAURANT_A, sessionH.id);
    } catch (e) {
      closeRejected = e.code === 'UNPAID_BALANCE';
    }
    assert.ok(closeRejected, 'Session cannot be closed with unpaid balance');
  });

  // ------------------------------------------------------------------------
  // TEST 13: Historical bill and receipt remain unchanged after UPI settings change
  // ------------------------------------------------------------------------
  await testAsync('Test 13: Historical bill and receipt remain unchanged after UPI settings change', async () => {
    // Restaurant A modifies their UPI ID and removes their QR code
    await rms.updatePaymentSettings(RESTAURANT_A, {
      upiId: 'newOwnerAccount@kotak',
      upiQrUrl: null
    }, 'OWNER');

    // Retrieve old billA receipt: it MUST retain the original UPI ID and original QR image
    const oldReceipt = await rms.getBillReceipt(RESTAURANT_A, billA.id);
    assert.strictEqual(oldReceipt.paymentInstructions.upiId, 'restA@okhdfcbank', 'Historical UPI ID must not be overwritten');
    assert.strictEqual(oldReceipt.paymentInstructions.upiQrUrl, 'data:image/png;base64,restAQR', 'Historical QR image must not be erased');

    // Now generate a NEW bill on a new table: it MUST use the new settings!
    const tableNew = await rms.createTable(RESTAURANT_A, { tableNumber: '9', capacity: 2 });
    const sessionNew = await rms.openSession(RESTAURANT_A, tableNew.id, { guestCount: 1 });
    await seedOrder(sessionNew.id, RESTAURANT_A, [{ name: 'Tea', quantity: 1, unitPrice: 100 }]);
    const billNew = await rms.getBillForSession(RESTAURANT_A, sessionNew.id);

    assert.strictEqual(billNew.paymentInstructions.upiId, 'newOwnerAccount@kotak', 'New bill must use newly saved UPI ID');
    assert.strictEqual(billNew.paymentInstructions.upiQrUrl, null, 'New bill must not show deleted QR image');
  });

  // ------------------------------------------------------------------------
  // TEST 14: Sales reports match persisted bill and payment records
  // ------------------------------------------------------------------------
  await testAsync('Test 14: Sales reports match persisted bill and payment records', async () => {
    const report = await rms.getSalesReport(RESTAURANT_A);
    assert.ok(report.summary.total_bills > 0);
    assert.ok(report.summary.total_recorded_collections > 0);
    assert.ok(report.payment_methods.CASH.recordedAmount > 0);
    assert.ok(report.payment_methods.UPI.recordedAmount > 0);
    assert.strictEqual(report.payment_methods.UPI.verificationNote, 'Staff recorded direct UPI payment; not bank verified');
    assert.ok(report.disclaimer.includes('AUDIT NOTICE'));
    assert.ok(report.item_sales.length > 0);
  });

  // ------------------------------------------------------------------------
  // TEST 15: Dine-In, Takeaway, and Delivery channel separation
  // ------------------------------------------------------------------------
  await testAsync('Test 15: Dine-In, Takeaway, and Delivery channel separation', async () => {
    const report = await rms.getSalesReport(RESTAURANT_A);
    assert.ok(report.by_channel.DINE_IN);
    assert.ok(report.by_channel.TAKEAWAY);
    assert.ok(report.by_channel.DELIVERY);

    // Verify settings channels independently toggle
    const settings = await rms.updateSettings(RESTAURANT_A, {
      dine_in_enabled: true,
      takeaway_enabled: false,
      delivery_enabled: true
    });
    assert.strictEqual(settings.dine_in_enabled, true);
    assert.strictEqual(settings.takeaway_enabled, false);
    assert.strictEqual(settings.delivery_enabled, true);

    // Restore channel toggles so this spec suite does not leak persisted state into
    // the shared local database consumed by the integration suites.
    await rms.updateSettings(RESTAURANT_A, {
      dine_in_enabled: true,
      takeaway_enabled: true,
      delivery_enabled: true
    });
  });

  // ------------------------------------------------------------------------
  // TEST 16: the persistence schema and its constraints, as the store holds them
  // ------------------------------------------------------------------------
  // Every object name below was read out of the live local catalog (scratch/rms_schema_probe.js), not
  // out of a migration file: the assertion is what PostgreSQL answers, so a migration that was written
  // but never applied, applied to a different schema, or edited afterwards shows up here red.
  await databaseIntegrationTest('Test 16: PostgreSQL persistence schema mapping and table constraints', async () => {
    const rows = async (sql, params) => (await pg.query(sql, params)).rows;

    // The schema this run is actually working in, asked of the connection rather than assumed. Normally
    // that is `public`; an isolated chain link sets `search_path=chain_scratch` on the same handle the
    // repository writes through, and catalog assertions pinned to `'public'` would then be describing a
    // schema this run never touched.
    const liveSchema = (await rows('SELECT current_schema() AS s'))[0].s;

    // The relations the RMS write path targets. An absent one is a repository branch that would write
    // into nowhere; an unlisted one is a table no branch of the repository owns.
    const RMS_TABLES = [
      'restaurant_bill_payments', 'restaurant_bills', 'restaurant_kds_tickets', 'restaurant_receipts',
      'restaurant_refunds', 'restaurant_reservations', 'restaurant_sections', 'restaurant_staff',
      'restaurant_table_sessions', 'restaurant_tables'
    ];
    const liveTables = await rows(
      'SELECT table_name FROM information_schema.tables'
      + ' WHERE table_schema = $1 AND table_name LIKE \'restaurant\\_%\' ORDER BY table_name',
      [liveSchema]
    );
    assert.deepStrictEqual(liveTables.map(r => r.table_name), RMS_TABLES,
      `the live ${liveSchema} schema must hold exactly the restaurant_* relations the RMS repository writes`);

    // Migration 042 put row-level security on all ten. Without a policy behind it, RLS-off is the
    // difference between a tenant table and one the anon role can write.
    const rls = await rows(
      'SELECT c.relname, c.relrowsecurity FROM pg_class c'
      + ' JOIN pg_namespace n ON n.oid = c.relnamespace'
      + " WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = ANY($2::text[])"
      + ' ORDER BY c.relname', [liveSchema, RMS_TABLES]
    );
    assert.strictEqual(rls.length, RMS_TABLES.length, 'every RMS table must be visible in pg_class');
    assert.deepStrictEqual(rls.filter(r => !r.relrowsecurity).map(r => r.relname), [],
      'row-level security must be enabled on every restaurant_* table');

    // Column mappings the repository's row builders read and write by.
    const columnTypes = async (table, names) => asMap(await rows(
      'SELECT column_name, data_type FROM information_schema.columns'
      + ' WHERE table_schema = $1 AND table_name = $2 AND column_name = ANY($3::text[])'
      + ' ORDER BY column_name', [liveSchema, table, names]
    ));
    function asMap(list) {
      return list.reduce((m, r) => {
        m[r.column_name] = r.data_type;
        return m;
      }, {});
    }

    assert.deepStrictEqual(await columnTypes('merchants', [
      'dine_in_enabled', 'takeaway_enabled', 'delivery_enabled', 'tax_rate_percent',
      'service_charge_percent', 'packaging_fee', 'rms_settings'
    ]), {
      delivery_enabled: 'boolean',
      dine_in_enabled: 'boolean',
      packaging_fee: 'numeric',
      rms_settings: 'jsonb',
      service_charge_percent: 'numeric',
      takeaway_enabled: 'boolean',
      tax_rate_percent: 'numeric'
    }, 'the merchants RMS settings columns must exist with the types updateSettings writes');

    assert.deepStrictEqual(await columnTypes('orders', [
      'order_channel', 'table_id', 'table_session_id', 'pickup_time', 'handover_by', 'handover_at',
      'tax_amount', 'service_charge_amount', 'packaging_fee_amount', 'payment_method', 'payment_status'
    ]), {
      handover_at: 'timestamp with time zone',
      handover_by: 'character varying',
      order_channel: 'character varying',
      packaging_fee_amount: 'numeric',
      payment_method: 'character varying',
      payment_status: 'character varying',
      pickup_time: 'timestamp with time zone',
      service_charge_amount: 'numeric',
      table_id: 'uuid',
      table_session_id: 'uuid',
      tax_amount: 'numeric'
    }, 'the orders RMS columns that carry channel, table link, bill totals and handover must exist');

    // Named constraints: relation, kind, and the columns they cover.
    const EXPECTED_CONSTRAINTS = [
      ['restaurant_tables', 'u', 'restaurant_tables_merchant_id_table_number_key', 'merchant_id,table_number'],
      ['restaurant_tables', 'u', 'restaurant_tables_qr_code_token_key', 'qr_code_token'],
      ['restaurant_tables', 'c', 'restaurant_tables_capacity_check', 'capacity'],
      ['restaurant_tables', 'c', 'restaurant_tables_status_check', 'status'],
      ['restaurant_tables', 'f', 'restaurant_tables_merchant_id_fkey', 'merchant_id'],
      ['restaurant_table_sessions', 'u', 'restaurant_table_sessions_session_token_key', 'session_token'],
      ['restaurant_table_sessions', 'c', 'restaurant_table_sessions_status_check', 'status'],
      ['restaurant_table_sessions', 'f', 'restaurant_table_sessions_table_id_fkey', 'table_id'],
      ['restaurant_bills', 'f', 'restaurant_bills_table_session_id_fkey', 'table_session_id'],
      ['restaurant_bills', 'c', 'restaurant_bills_status_check', 'status'],
      ['restaurant_bill_payments', 'f', 'restaurant_bill_payments_bill_id_fkey', 'bill_id'],
      ['restaurant_bill_payments', 'c', 'restaurant_bill_payments_amount_check', 'amount'],
      ['restaurant_bill_payments', 'c', 'restaurant_bill_payments_check1', 'effective_credited,amount'],
      ['restaurant_bill_payments', 'u', 'restaurant_bill_payments_idempotency_key_key', 'idempotency_key'],
      ['restaurant_kds_tickets', 'f', 'restaurant_kds_tickets_order_id_fkey', 'order_id'],
      ['restaurant_kds_tickets', 'c', 'restaurant_kds_tickets_channel_check', 'channel'],
      ['restaurant_kds_tickets', 'c', 'restaurant_kds_tickets_status_check', 'status'],
      ['restaurant_sections', 'u', 'restaurant_sections_merchant_id_name_key', 'merchant_id,name'],
      ['restaurant_staff', 'u', 'restaurant_staff_merchant_id_phone_key', 'merchant_id,phone'],
      ['orders', 'f', 'orders_table_id_fkey', 'table_id'],
      ['orders', 'f', 'orders_table_session_id_fkey', 'table_session_id']
    ];
    const liveConstraints = await rows(
      // relname rather than `conrelid::regclass::text`: regclass shortens the label only when the
      // relation is reachable through the current search_path, so the same constraint renders as
      // `restaurant_tables` here and `public.restaurant_tables` from a handle pinned elsewhere. The
      // bare relation name is the thing the expected list names, so ask for exactly that.
      `SELECT tbl.relname AS tbl, con.contype::text AS kind, con.conname,
              COALESCE((SELECT string_agg(att.attname, ',' ORDER BY u.ord)
                FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
                JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum), '') AS cols
       FROM pg_constraint con
       JOIN pg_class tbl ON tbl.oid = con.conrelid
       WHERE con.connamespace = $1::regnamespace AND con.conname = ANY($2::text[])`,
      [liveSchema, EXPECTED_CONSTRAINTS.map(c => c[2])]
    );
    const constraintKey = r => `${r.tbl}|${r.kind}|${r.conname}|${r.cols}`;
    assert.deepStrictEqual(liveConstraints.map(constraintKey).sort(),
      EXPECTED_CONSTRAINTS.map(c => c.join('|')).sort(),
      'each RMS constraint the write path relies on must exist on the stated relation, of the stated '
      + 'kind, over the stated columns');

    // The definitions, for the constraints that hold money and state vocabulary.
    const constraintDefs = asMapKV(await rows(
      'SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint'
      + ' WHERE connamespace = $1::regnamespace AND conname = ANY($2::text[])',
      [liveSchema, ['restaurant_tables_capacity_check', 'restaurant_bill_payments_amount_check',
        'restaurant_bill_payments_check1', 'restaurant_bills_status_check',
        'restaurant_kds_tickets_channel_check', 'restaurant_kds_tickets_status_check']]
    ));
    function asMapKV(list) {
      return list.reduce((m, r) => {
        m[r.conname] = r.def;
        return m;
      }, {});
    }
    assert.match(constraintDefs.restaurant_tables_capacity_check, /capacity > 0/,
      'capacity must be positive in the store, not only in the route handler');
    assert.match(constraintDefs.restaurant_bill_payments_amount_check, /amount > \(0\)::numeric/,
      'a tender must credit a positive amount');
    assert.match(constraintDefs.restaurant_bill_payments_check1, /effective_credited <= amount/,
      'a tender can never credit more than it was paid — the over-record this guard exists for');
    for (const value of ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED']) {
      assert.ok(constraintDefs.restaurant_bills_status_check.includes(`'${value}'`),
        `bill status vocabulary must allow ${value}`);
    }
    for (const value of ['DINE_IN', 'TAKEAWAY', 'DELIVERY']) {
      assert.ok(constraintDefs.restaurant_kds_tickets_channel_check.includes(`'${value}'`),
        `KDS channel vocabulary must allow ${value}`);
    }
    for (const value of ['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']) {
      assert.ok(constraintDefs.restaurant_kds_tickets_status_check.includes(`'${value}'`),
        `KDS status vocabulary must allow ${value}`);
    }

    // The uniqueness guarantees 043 put on indexes rather than constraints, including the two partial
    // ones — a table can hold only one live session, and a bill can hold only one tender per UPI ref.
    const EXPECTED_INDEXES = [
      'restaurant_bill_payments_bill_ref_key', 'restaurant_bills_one_per_session',
      'restaurant_kds_tickets_one_per_order', 'restaurant_receipts_one_per_bill',
      'restaurant_table_sessions_one_active_per_table'
    ];
    const liveIndexes = await rows(
      'SELECT indexname, indexdef FROM pg_indexes'
      + ' WHERE schemaname = $1 AND indexname = ANY($2::text[]) ORDER BY indexname',
      [liveSchema, EXPECTED_INDEXES]
    );
    assert.deepStrictEqual(liveIndexes.map(r => r.indexname), EXPECTED_INDEXES,
      'the RMS one-row-per-owner indexes must exist in the live schema');
    const indexDef = name => (liveIndexes.find(r => r.indexname === name) || {}).indexdef || '';
    assert.match(indexDef('restaurant_table_sessions_one_active_per_table'), /WHERE/,
      'the one-active-session-per-table index must stay partial, or a closed session would block the table');
    assert.match(indexDef('restaurant_bill_payments_bill_ref_key'), /WHERE/,
      'the duplicate-tender index must stay partial, so cash tenders without a reference still record');

    // Invoice and KOT numbers come from sequences, so they are unique across a restart, not per process.
    const liveSequences = await rows(
      'SELECT sequence_name FROM information_schema.sequences'
      + " WHERE sequence_schema = $1 AND sequence_name LIKE 'restaurant\\_%' ORDER BY 1",
      [liveSchema]
    );
    assert.deepStrictEqual(liveSequences.map(r => r.sequence_name),
      ['restaurant_invoice_number_seq', 'restaurant_kds_ticket_number_seq'],
      'the RMS numbering sequences must exist');

    // The RPCs every durable RMS write goes through. SECURITY DEFINER and a pinned search_path are not
    // decoration: the repository calls these as the merchant, and the tables behind them have RLS on
    // with no policy, so an invoker-rights function would read and write nothing.
    const EXPECTED_FUNCTIONS = [
      'rms_attach_order_to_session_atomic', 'rms_bill_basis', 'rms_close_session_atomic',
      'rms_create_kds_ticket_atomic', 'rms_create_reservation_atomic', 'rms_generate_bill_atomic',
      'rms_get_bill_receipt_atomic', 'rms_open_table_session_atomic', 'rms_record_bill_payment_atomic',
      'rms_record_bill_refund_atomic', 'rms_record_takeaway_handover_atomic', 'rms_regenerate_table_qr_atomic',
      'rms_sales_report', 'rms_set_table_status_atomic', 'rms_split_bill_atomic', 'rms_transfer_session_atomic',
      'rms_update_kds_ticket_status_atomic', 'rms_update_reservation_status_atomic', 'rms_update_table_atomic'
    ];
    const liveFunctions = await rows(
      'SELECT p.proname, p.prosecdef AS security_definer, p.proconfig'
      + ' FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace'
      + " WHERE n.nspname = $1 AND p.proname LIKE 'rms\\_%' ORDER BY 1",
      [liveSchema]
    );
    assert.deepStrictEqual(liveFunctions.map(f => f.proname), EXPECTED_FUNCTIONS,
      'every rms_* RPC the repository names must exist in the live schema');
    for (const f of liveFunctions) {
      assert.strictEqual(f.security_definer, true, `${f.proname} must be SECURITY DEFINER`);
      // The pin has to name the schema this run works in, not the word `public`: an isolated link dumps
      // `public` and restores it as `chain_scratch`, and the rewrite carries the pin with it, so the
      // clone's functions correctly pin `search_path=chain_scratch`. Asserting the literal string here
      // would grade the clone against a schema it deliberately is not.
      assert.ok((f.proconfig || []).includes(`search_path=${liveSchema}`),
        `${f.proname} must pin search_path to ${liveSchema}, or a later schema could shadow its tables`);
    }

    // Names prove the catalog; they do not prove enforcement. Each write below is attempted in its own
    // transaction and rolled back, so the engine answers rather than the migration file, and the row
    // counts taken around the block prove the probe left nothing behind — including T-101, whose
    // (merchant_id, table_number) pair the first probe duplicates.
    const countsBefore = await rmsTableCounts();
    try {
      await refusedBy('23505', 'the tenant-scoped table-number key', () => pg.query(
        'INSERT INTO restaurant_tables (merchant_id, table_number, capacity) VALUES ($1, $2, 4)',
        [RESTAURANT_A, 'T-101']
      ));
      await refusedBy('23514', 'restaurant_tables_capacity_check', () => pg.query(
        'INSERT INTO restaurant_tables (merchant_id, table_number, capacity) VALUES ($1, $2, 0)',
        [RESTAURANT_A, 'RMS-PROBE']
      ));
      await refusedBy('23503', 'restaurant_tables_merchant_id_fkey', () => pg.query(
        'INSERT INTO restaurant_tables (merchant_id, table_number, capacity) VALUES ($1, $2, 4)',
        [crypto.randomUUID(), 'RMS-PROBE']
      ));
      await refusedBy('23505', 'the one-active-session-per-table index', async () => {
        const created = await pg.query(
          'INSERT INTO restaurant_tables (merchant_id, table_number, capacity) VALUES ($1, $2, 4) RETURNING id',
          [RESTAURANT_A, 'RMS-PROBE']
        );
        const open = 'INSERT INTO restaurant_table_sessions (merchant_id, table_id) VALUES ($1, $2)';
        await pg.query(open, [RESTAURANT_A, created.rows[0].id]);
        await pg.query(open, [RESTAURANT_A, created.rows[0].id]);
      });
    } finally {
      await pg.query('ROLLBACK').catch(() => {});
    }

    const countsAfter = await rmsTableCounts();
    const moved = RMS_TABLES.filter(t => countsBefore[t] !== countsAfter[t])
      .map(t => `${t}: ${countsBefore[t]} -> ${countsAfter[t]}`);
    assert.deepStrictEqual(moved, [],
      'the enforcement probe rolls every write back, so the store must hold what it held before: '
      + moved.join(', '));

    async function rmsTableCounts() {
      const counts = {};
      for (const table of RMS_TABLES) {
        counts[table] = (await rows(`SELECT count(*)::int AS n FROM ${table}`))[0].n;
      }
      return counts;
    }

    async function refusedBy(code, label, attempt) {
      await pg.query('BEGIN');
      let err = null;
      try {
        await attempt();
      } catch (e) {
        err = e;
      }
      await pg.query('ROLLBACK');
      assert.ok(err, `${label}: the write was accepted, so nothing in the store enforced it`);
      assert.strictEqual(err.code, code,
        `${label}: expected SQLSTATE ${code}, got ${err.code} (${err.message})`);
    }
  });

  // ------------------------------------------------------------------------
  // TEST 17: QR-to-order-to-KDS-to-bill-to-payment-record end-to-end flow
  // ------------------------------------------------------------------------
  await testAsync('Test 17: QR-to-order-to-KDS-to-bill-to-payment-record end-to-end flow', async () => {
    // 1. Table & QR created
    const t = await rms.createTable(RESTAURANT_A, { tableNumber: '10', capacity: 4 });
    const regen = await rms.regenerateTableQr(RESTAURANT_A, t.id);
    assert.ok(regen.qrToken);

    // 2. Customer scans QR
    const resolved = await rms.resolveTableQr(regen.qrToken);
    assert.strictEqual(resolved.table.table_number, '10');

    // 3. Customer places order
    const session = await rms.getOrCreateActiveSession(RESTAURANT_A, t.id);
    // The order is seeded before the kitchen ticket because `rms_create_kds_ticket_atomic` takes the
    // ticket's items from that order's `order_lines` rows: a ticket for an order that is not in the
    // store is not a ticket, it is a `ORDER_NOT_FOUND` refusal — and a non-uuid id like the
    // 'ord-final-01' this suite used to pass could never have named one.
    const finalOrder = await seedOrder(session.id, RESTAURANT_A, [
      { name: 'Chef Special', quantity: 1, unitPrice: 500 }
    ]);
    const kdsTicket = await rms.createKdsTicket({
      merchantId: RESTAURANT_A,
      orderId: finalOrder.id,
      orderNumber: finalOrder.orderNumber || 'ORD-FIN-01',
      channel: 'DINE_IN',
      tableNumber: '10',
      items: [{ name: 'Chef Special', quantity: 1, price: 500 }]
    });
    assert.strictEqual(kdsTicket.status, 'NEW');

    // 4. Kitchen advances KDS
    await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'PREPARING');
    await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'READY');
    await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'SERVED');

    // 5. Bill generated (from the order already attached above)
    const bill = await rms.getBillForSession(RESTAURANT_A, session.id);
    assert.strictEqual(bill.status, 'UNPAID');

    // 6. Payment recorded
    await rms.recordBillPayment(RESTAURANT_A, bill.id, {
      amount: bill.totalAmount,
      paymentMethod: 'UPI',
      reference: 'UPI_E2E_SETTLED_001'
    });

    // 7. Receipt generated
    const rec = await rms.getBillReceipt(RESTAURANT_A, bill.id);
    assert.strictEqual(rec.isFullyPaid, true);

    // 8. Session closed -> table to CLEANING
    const closed = await rms.closeSession(RESTAURANT_A, session.id);
    assert.strictEqual(closed.session.status, 'CLOSED');
    assert.strictEqual(closed.table.status, 'CLEANING');

    // 9. Cleaned -> AVAILABLE
    const cleaned = await rms.setTableStatus(RESTAURANT_A, t.id, 'AVAILABLE');
    assert.strictEqual(cleaned.status, 'AVAILABLE');
  });

  console.log('\n========================================================================');
  if (notApplicable === 0) {
    console.log(`🎉 ALL ${passed}/${total} RMS SPECIFICATION TESTS PASSED SUCCESSFULLY!`);
  } else {
    console.log(`✅ ${passed}/${total} RMS SPECIFICATION TESTS PASSED SUCCESSFULLY.`);
    console.log(`⚠️  ${notApplicable} DATABASE-INTEGRATION CHECK(S) WERE NOT APPLICABLE`);
    console.log('   (no live PostgreSQL on this target: the schema, constraints and rms_* RPCs were not verified.)');
  }
  console.log('========================================================================\n');
}

// ---------------------------------------------------------------- fixture hygiene
//
// This suite was written when the repository kept everything in Maps, so it assumes the two seed
// test restaurants start pristine and it never removes what it made. Both halves of that assumption
// broke once the RMS durability gate opened: createTable and openTableSession write real rows, so
// the next run is refused by restaurant_tables_merchant_id_table_number_key, and updatePayment-
// Settings writes the merchants row, so Test 03's `settingsB.upi_qr_url === null` reads the previous
// run's QR. Neither red reports this run; both report the last one. So the fixture scope is put
// back before and after: the exact table numbers these tests create (sessions, bills, tenders and
// receipts hang off those rows on CASCADE constraints, so they go with them), the order, line, dish
// and customer rows the fixtures mint (each found by a marker only this suite writes), and the four
// payment columns the suite writes, which the seed leaves empty. Nothing broader — never a merchant's
// whole floor, and never an order that is not tagged RMSSPEC.
const FIXTURE_MERCHANTS = [RESTAURANT_A, RESTAURANT_B];
const FIXTURE_TABLES = [
  { merchantId: RESTAURANT_A, tableNumbers: ['1', '3', '4', '5', '6', '7', '8', '9', '10'] },
  { merchantId: RESTAURANT_B, tableNumbers: ['1'] }
];

async function resetRmsFixtures(pg, phase) {
  let tables = 0;
  for (const fixture of FIXTURE_TABLES) {
    const { rowCount } = await pg.query(
      'DELETE FROM restaurant_tables WHERE merchant_id = $1 AND table_number = ANY($2::text[])',
      [fixture.merchantId, fixture.tableNumbers]
    );
    tables += rowCount;
  }

  // The order fixtures next, then the catalog rows they point at, then the customer that placed them.
  // That order is the FK topology, not a preference: `order_lines.restaurant_product_id` is
  // ON DELETE RESTRICT, so a product cannot go while a line still names it — but the lines themselves
  // cascade with their order, so deleting the orders first unlocks the products. The kitchen tickets
  // and the dine-in `orders.table_session_id` link go the same way (CASCADE and SET NULL).
  const orders = await pg.query(
    'DELETE FROM orders WHERE order_number LIKE $1', [FIXTURE_ORDER_LIKE]
  );
  const products = await pg.query(
    'DELETE FROM products WHERE category = $1', [FIXTURE_PRODUCT_CATEGORY]
  );
  const customers = await pg.query(
    'DELETE FROM users WHERE email LIKE $1', [FIXTURE_CUSTOMER_LIKE]
  );

  await pg.query(
    'UPDATE merchants SET upi_id = NULL, upi_qr_url = NULL, upi_merchant_name = NULL, gstin = NULL'
    + ' WHERE id = ANY($1::uuid[])',
    [FIXTURE_MERCHANTS]
  );
  console.log(`  Fixture hygiene (${phase}): removed ${tables} fixture table(s), `
    + `${orders.rowCount} fixture order(s) with their lines and tickets, `
    + `${products.rowCount} fixture dish row(s), ${customers.rowCount} fixture customer(s); cleared UPI `
    + `settings on ${FIXTURE_MERCHANTS.length} seed test restaurant(s).`);
}

async function main() {
  const writesDurable = Boolean(isLivePostgres && supabaseAdmin);
  if (writesDurable && !(nabinEnv && nabinEnv.restLocal === true)) {
    throw new Error('Refusing to run: this suite writes floor tables, dining sessions, order rows and '
      + 'merchant payment settings, and the live store it would write to is not local Docker. Run it '
      + 'through scripts/with_local_target.js, or against a target where the RMS durability gate is closed.');
  }
  const pg = writesDurable ? new Client(PG_URL) : null;
  if (pg) await pg.connect();
  try {
    if (pg) await resetRmsFixtures(pg, 'start');
    await runTestSuite(pg);
  } finally {
    if (pg) {
      try {
        await resetRmsFixtures(pg, 'exit');
      } catch (err) {
        console.error('Fixture cleanup warning:', err.message);
      }
      await pg.end();
    }
  }
}

main().catch((err) => {
  console.error('Fatal Test Failure:', err);
  process.exit(1);
});
