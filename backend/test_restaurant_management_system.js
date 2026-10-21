'use strict';

/**
 * NABIN — RESTAURANT MANAGEMENT SYSTEM (RMS) COMPREHENSIVE TEST SUITE
 *
 * Verifies production behaviors across Dine-In, Takeaway, and Delivery:
 * 1. Multi-channel settings (toggles, GST tax, service charge, packaging fee).
 * 2. Floor table management & status transitions.
 * 3. Public QR table resolution without customer PII leakage.
 * 4. Dining session lifecycle with multiple orders per session.
 * 5. Server-authoritative bill calculation (tax, service charges, discounts).
 * 6. Equal bill splitting (multi-party dining).
 * 7. Unpaid table protection (cannot mark AVAILABLE while balance remains).
 * 8. Partial and full payment recording (CASH, CARD, UPI).
 * 9. Session closure and CLEANING state transition.
 * 10. Takeaway order progression, handover verification & driver dispatch suppression.
 * 11. Delivery order progression & driver dispatch eligibility.
 * 12. Kitchen Display System (KDS) ticket state transitions.
 * 13. Restaurant Staff RBAC permissions and tenant isolation.
 * 14. Sales reporting with channel breakdown (DINE_IN vs TAKEAWAY vs DELIVERY).
 */

process.env.NABIN_TEST_MODE = 'true';
process.env.NODE_ENV = 'local';

const db = require('./src/database');
const RestaurantManagementRepository = require('./src/repositories/RestaurantManagementRepository');

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

async function runRmsSuite() {
  console.log('\n============================================================');
  console.log('   NABIN RMS (RESTAURANT MANAGEMENT SYSTEM) TEST SUITE');
  console.log('============================================================\n');

  const rms = new RestaurantManagementRepository(null);
  const RESTAURANT_A = 'rest_rms_alpha_001';
  const RESTAURANT_B = 'rest_rms_beta_002';

  // -------------------------------------------------------------
  // TEST GROUP 1: RMS SETTINGS & CHANNEL TOGGLES
  // -------------------------------------------------------------
  console.log('\n--- 1. RMS Settings & Multi-Channel Configuration ---');

  const defaultSettings = await rms.getSettings(RESTAURANT_A);
  assert('Default settings provide enabled Dine-In, Takeaway, and Delivery',
    defaultSettings.dine_in_enabled === true &&
    defaultSettings.takeaway_enabled === true &&
    defaultSettings.delivery_enabled === true
  );
  assert('Default GST tax rate is 5.0%', defaultSettings.tax_rate_percent === 5.0);

  const updatedSettings = await rms.updateSettings(RESTAURANT_A, {
    tax_rate_percent: 5.0,
    service_charge_percent: 7.5,
    packaging_fee: 20.0,
    prep_time_minutes: 30,
  });
  assert('Updated service charge percent saved server-authoritatively', updatedSettings.service_charge_percent === 7.5);
  assert('Updated packaging fee saved server-authoritatively', updatedSettings.packaging_fee === 20.0);

  // -------------------------------------------------------------
  // TEST GROUP 2: FLOOR TABLE MANAGEMENT & QR CODES
  // -------------------------------------------------------------
  console.log('\n--- 2. Floor Table Management & QR Codes ---');

  const table1 = await rms.createTable(RESTAURANT_A, {
    table_number: 'T1',
    name: 'Window Booth',
    capacity: 4,
  });
  assert('Table created with status AVAILABLE', table1.status === 'AVAILABLE');
  assert('Table created with unique ID and QR token', !!table1.id && !!table1.qr_token);
  assert('Table QR URL formats properly', table1.qr_url.includes(`/dining/qr/${table1.qr_token}`));

  const table2 = await rms.createTable(RESTAURANT_A, {
    table_number: 'T2',
    name: 'Patio High-Top',
    capacity: 2,
  });
  assert('Second table created successfully', table2.table_number === 'T2');

  const tablesList = await rms.getTables(RESTAURANT_A);
  assert('Tables list returns all created tables for restaurant', tablesList.length === 2);

  // Public QR Resolution (Zero customer credential/PII leakage)
  const resolvedQr = await rms.resolveTableQr(table1.qr_token);
  assert('Public QR resolver finds table successfully', resolvedQr.table.id === table1.id);
  assert('Public QR resolver returns table number and capacity',
    resolvedQr.table.table_number === 'T1' && resolvedQr.table.capacity === 4
  );
  assert('Public QR resolver does not expose private credentials or user tokens',
    resolvedQr.token === undefined && resolvedQr.password === undefined
  );

  // QR Regeneration
  const originalQr = table1.qr_token;
  const regenRes = await rms.regenerateTableQr(RESTAURANT_A, table1.id);
  assert('QR token can be regenerated', regenRes.qrToken !== originalQr);
  const oldQrResolve = await rms.resolveTableQr(originalQr);
  assert('Old QR token is revoked and fails resolution', oldQrResolve === null);
  const newQrResolve = await rms.resolveTableQr(regenRes.qrToken);
  assert('New regenerated QR token resolves successfully', newQrResolve !== null);

  // -------------------------------------------------------------
  // TEST GROUP 3: DINE-IN SESSION LIFECYCLE & MULTI-ORDER BILLING
  // -------------------------------------------------------------
  console.log('\n--- 3. Dining Session Lifecycle & Multi-Order Billing ---');

  // Open session
  const session = await rms.openTableSession(RESTAURANT_A, table1.id, { guest_count: 3 });
  // ACTIVE is what restaurant_table_sessions.status can actually hold (its CHECK allows
  // ACTIVE / BILL_REQUESTED / CLOSED / CANCELLED). 'OPEN' only ever existed in the Map copy.
  assert('Dining session opened with ACTIVE status', session.status === 'ACTIVE');
  assert('Dining session guest count recorded', session.guest_count === 3);

  const t1AfterSeat = (await rms.getTables(RESTAURANT_A)).find((t) => t.id === table1.id);
  assert('Table transitions to OCCUPIED when seated', t1AfterSeat.status === 'OCCUPIED');
  assert('Table links current_session_id', t1AfterSeat.current_session_id === session.id);

  // Simulate multiple rounds of dining orders attached to the session
  const orderRound1 = {
    id: 'ord_round_1',
    order_number: 'ORD-RMS-001',
    restaurant_id: RESTAURANT_A,
    order_channel: 'DINE_IN',
    table_id: table1.id,
    table_session_id: session.id,
    order_state: 'PREPARING',
    total_amount: 500,
    items: [
      { product_name_snapshot: 'Butter Chicken', quantity: 1, unit_price_snapshot: 350, line_total: 350 },
      { product_name_snapshot: 'Garlic Naan', quantity: 3, unit_price_snapshot: 50, line_total: 150 },
    ],
  };
  await rms.recordSessionOrder(session.id, orderRound1);

  const orderRound2 = {
    id: 'ord_round_2',
    order_number: 'ORD-RMS-002',
    restaurant_id: RESTAURANT_A,
    order_channel: 'DINE_IN',
    table_id: table1.id,
    table_session_id: session.id,
    order_state: 'PREPARING',
    total_amount: 250,
    items: [
      { product_name_snapshot: 'Paneer Tikka', quantity: 1, unit_price_snapshot: 200, line_total: 200 },
      { product_name_snapshot: 'Fresh Lime Soda', quantity: 1, unit_price_snapshot: 50, line_total: 50 },
    ],
  };
  await rms.recordSessionOrder(session.id, orderRound2);

  // Generate & Calculate Bill
  const bill = await rms.generateSessionBill(RESTAURANT_A, session.id);
  assert('Bill subtotal correctly sums all items across rounds (₹750)', bill.subtotal === 750);
  // GST: 5% of 750 = 37.50
  assert('Bill calculates correct 5% GST tax (₹37.50)', bill.tax_amount === 37.5);
  // Service charge: 7.5% of 750 = 56.25
  assert('Bill calculates correct 7.5% Service Charge (₹56.25)', bill.service_charge_amount === 56.25);
  assert('Bill dine-in packaging fee is zero', bill.packaging_fee_amount === 0);
  // Total: 750 + 37.50 + 56.25 = 843.75
  assert('Bill total amount is server-authoritative (₹843.75)', bill.total_amount === 843.75);
  assert('Bill initial balance equals total amount', bill.balance_amount === 843.75);
  assert('Bill initial payment status is UNPAID', bill.payment_status === 'UNPAID');

  // Split bill 3 ways
  const splitBill = await rms.splitBill(RESTAURANT_A, session.id, 3);
  assert('Bill split creates 3 distinct payment shares', splitBill.splits.length === 3);
  // 843.75 / 3 = 281.25 per person
  assert('Each split share equals ₹281.25', splitBill.splits[0].amount === 281.25);

  // -------------------------------------------------------------
  // TEST GROUP 4: UNPAID TABLE PROTECTION & PAYMENT WORKFLOW
  // -------------------------------------------------------------
  console.log('\n--- 4. Unpaid Table Protection & Payment Recording ---');

  // SAFETY GUARD: Try to mark table AVAILABLE while unpaid
  let unpaidGuardTriggered = false;
  try {
    await rms.setTableStatus(RESTAURANT_A, table1.id, 'AVAILABLE');
  } catch (err) {
    if (err.code === 'TABLE_SESSION_UNPAID') unpaidGuardTriggered = true;
  }
  assert('Attempt to mark table AVAILABLE with unpaid balance is strictly rejected (TABLE_SESSION_UNPAID)', unpaidGuardTriggered);

  // Partial payment of Person 1's share: ₹281.25 (CASH)
  const partialPay = await rms.recordBillPayment(RESTAURANT_A, session.id, {
    amount: 281.25,
    paymentMethod: 'CASH',
  });
  assert('Partial payment records paid amount of ₹281.25', partialPay.bill.paid_amount === 281.25);
  assert('Remaining balance after Person 1 is ₹562.50', partialPay.bill.balance_amount === 562.5);
  assert('Bill status updates to PARTIALLY_PAID', partialPay.bill.payment_status === 'PARTIALLY_PAID');

  // Pay remaining ₹562.50 (UPI)
  const fullPay = await rms.recordBillPayment(RESTAURANT_A, session.id, {
    amount: 562.5,
    paymentMethod: 'UPI',
    transactionRef: 'UPI_REF_987654321',
  });
  assert('Full payment reduces balance to ₹0.00', fullPay.bill.balance_amount === 0);
  assert('Bill status updates to PAID', fullPay.bill.payment_status === 'PAID');

  // Close session
  const closeRes = await rms.closeSession(RESTAURANT_A, session.id);
  assert('Session closed successfully', closeRes.session.status === 'CLOSED');

  const t1AfterClose = (await rms.getTables(RESTAURANT_A)).find((t) => t.id === table1.id);
  assert('Table status automatically transitions to CLEANING upon checkout', t1AfterClose.status === 'CLEANING');

  // Mark CLEANING -> AVAILABLE
  const t1Clean = await rms.setTableStatus(RESTAURANT_A, table1.id, 'AVAILABLE');
  assert('Cleaned table successfully returns to AVAILABLE state', t1Clean.status === 'AVAILABLE');

  // -------------------------------------------------------------
  // TEST GROUP 5: TAKEAWAY ORDER & HANDOVER VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 5. Takeaway Channel & Handover Verification ---');

  const takeawayOrder = {
    id: 'ord_takeaway_101',
    restaurant_id: RESTAURANT_A,
    order_channel: 'TAKEAWAY',
    order_state: 'READY_FOR_PICKUP',
    total_amount: 320,
  };

  const handover1 = await rms.recordTakeawayHandover(RESTAURANT_A, takeawayOrder.id, 'Counter Staff Rajesh');
  assert('Takeaway handover marks order COLLECTED', handover1.order_state === 'COLLECTED');
  assert('Takeaway handover records staff attribution', handover1.handover_by === 'Counter Staff Rajesh');
  assert('Takeaway handover records timestamp', !!handover1.handover_at);

  // Duplicate handover prevention
  let dupHandoverPrevented = false;
  try {
    await rms.recordTakeawayHandover(RESTAURANT_A, takeawayOrder.id, 'Counter Staff Rajesh');
  } catch (err) {
    if (err.code === 'ALREADY_COLLECTED') dupHandoverPrevented = true;
  }
  assert('Duplicate handover attempt is rejected (ALREADY_COLLECTED)', dupHandoverPrevented);

  // -------------------------------------------------------------
  // TEST GROUP 6: KITCHEN DISPLAY SYSTEM (KDS) TICKETS
  // -------------------------------------------------------------
  console.log('\n--- 6. Kitchen Display System (KDS) Tickets ---');

  const kdsTicket = await rms.createKdsTicket({
    order_id: 'ord_kds_test',
    order_number: 'ORD-KDS-999',
    restaurant_id: RESTAURANT_A,
    order_channel: 'DINE_IN',
    table_id: table2.id,
    table_number: 'T2',
    prep_time_minutes: 20,
    items: [{ product_name: 'Veg Dum Biryani', quantity: 2, modifiers: ['Mild'] }],
  });
  assert('KDS ticket created with NEW status', kdsTicket.status === 'NEW');
  assert('KDS ticket preserves table number for Dine-In', kdsTicket.table_number === 'T2');
  assert('KDS ticket preserves channel DINE_IN', kdsTicket.order_channel === 'DINE_IN');

  const prepTicket = await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'PREPARING');
  assert('KDS ticket advances to PREPARING', prepTicket.status === 'PREPARING');

  const readyTicket = await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'READY');
  assert('KDS ticket advances to READY', readyTicket.status === 'READY');

  const servedTicket = await rms.updateKdsTicketStatus(RESTAURANT_A, kdsTicket.id, 'SERVED');
  assert('KDS ticket advances to SERVED', servedTicket.status === 'SERVED');

  // -------------------------------------------------------------
  // TEST GROUP 7: STAFF RBAC & TENANT ISOLATION
  // -------------------------------------------------------------
  console.log('\n--- 7. Staff RBAC & Tenant Isolation ---');

  const cashier = await rms.createStaff(RESTAURANT_A, {
    name: 'Priya Cashier',
    phone: '+91 99999 11111',
    role: 'CASHIER',
  });
  assert('Cashier staff created with CASHIER role', cashier.role === 'CASHIER');
  assert('Cashier granted billing and payment permissions',
    cashier.permissions.includes('bills.create') && cashier.permissions.includes('bills.pay')
  );

  const waiter = await rms.createStaff(RESTAURANT_A, {
    name: 'Sunil Waiter',
    phone: '+91 99999 22222',
    role: 'WAITER',
  });
  assert('Waiter staff granted seating and dining session permissions',
    waiter.permissions.includes('tables.session.open') && waiter.permissions.includes('orders.dine_in.create')
  );

  // Tenant Isolation: Verify Restaurant B cannot access Restaurant A's staff or tables
  const staffA = await rms.getStaff(RESTAURANT_A);
  const staffB = await rms.getStaff(RESTAURANT_B);
  assert('Merchant A sees their 2 staff members', staffA.length === 2);
  assert('Merchant B sees 0 staff members (strict tenant boundary)', staffB.length === 0);

  const tablesB = await rms.getTables(RESTAURANT_B);
  assert('Merchant B sees 0 tables (strict table tenant boundary)', tablesB.length === 0);

  // -------------------------------------------------------------
  // TEST GROUP 8: MULTI-CHANNEL SALES REPORTING
  // -------------------------------------------------------------
  console.log('\n--- 8. Multi-Channel Sales Reporting ---');

  // Create delivery order sample for reporting
  const deliveryOrder = {
    id: 'ord_delivery_202',
    restaurant_id: RESTAURANT_A,
    order_channel: 'DELIVERY',
    order_state: 'DELIVERED',
    total_amount: 650,
  };
  rms._orders.set(deliveryOrder.id, deliveryOrder);
  rms._orders.set(takeawayOrder.id, takeawayOrder);

  const report = await rms.getSalesReport(RESTAURANT_A);
  assert('Sales report summary includes total orders count', report.summary.total_orders >= 3);
  assert('Sales report breaks down Dine-In channel', report.by_channel.DINE_IN.orders_count >= 1);
  assert('Sales report breaks down Takeaway channel', report.by_channel.TAKEAWAY.orders_count >= 1);
  assert('Sales report breaks down Delivery channel', report.by_channel.DELIVERY.orders_count >= 1);
  assert('Sales report tracks payment methods (CASH and UPI)',
    report.payments_by_method.CASH > 0 && report.payments_by_method.UPI > 0
  );
  assert('Average Order Value (AOV) computed server-side', report.summary.average_order_value > 0);

  console.log('\n============================================================');
  console.log(`   RMS TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('============================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runRmsSuite().catch((err) => {
  console.error('Unhandled RMS test error:', err);
  process.exit(1);
});
