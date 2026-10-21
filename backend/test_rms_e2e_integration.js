'use strict';

/**
 * NABIN RMS — END-TO-END INTEGRATION AUDIT SUITE
 * 
 * Verifies real HTTP request-response flows:
 * 1. Table Creation & QR Generation (Merchant).
 * 2. Public QR Resolution & Zero Customer PII Leakage.
 * 3. Dine-In Customer Order Booking via QR Token (No Delivery Address Required).
 * 4. KDS Ticket Generation with Table Number & Session Attachment.
 * 5. Multi-round Dining Bill Accumulation & Server-Authoritative Taxes.
 * 6. Bill Splitting (2-way equal split).
 * 7. Unpaid Balance Guard (Cannot close session or free table).
 * 8. Payment Recording (CASH / UPI / CARD).
 * 9. Session Closure & Automatic CLEANING Transition.
 * 10. Table Reset to AVAILABLE.
 * 11. Takeaway Channel Flow: Order without address, Zero Driver Dispatch, Staff Handover Verification.
 * 12. Delivery Channel Flow: Requires Address, Driver Dispatch Triggered on READY_FOR_PICKUP.
 * 13. Owned-record cleanup: the floor table this run inserted and the KDS tickets its bookings
 *     minted are removed again, and the RMS tables are proven back to their baseline row counts.
 *
 * Fixture isolation: the suite runs against the seed restaurant, which already carries a `T-101`
 * table, three floor sections and KDS tickets belonging to other suites. It therefore asks for a
 * run-unique table number it owns outright instead of a second `T-101` — the durable target refuses
 * a duplicate `(merchant_id, table_number)` with 409, so the old request was not deterministic — and
 * it never reads, changes or removes a record it did not create. The order rows its bookings write
 * stay in the store: orders are immutable in this project and no order-delete route exists, so the
 * cleanup reports them instead of deleting them.
 */

process.env.NABIN_TEST_MODE = 'true';
process.env.NODE_ENV = 'local';

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const db = require('./src/database');
const { app } = require('./src/server');
const { openFixtures } = require('./test_fixtures');

let server;
let baseUrl;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body !== null && typeof body === 'object') {
      reqHeaders['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

// The RMS tables this suite can move. Every name here was read from the live catalog
// (`information_schema.tables LIKE 'restaurant\_%'`), not guessed: the ten that exist are
// bill_payments, bills, kds_tickets, receipts, refunds, reservations, sections, staff,
// table_sessions, tables. The seven counted below are the ones a dine-in booking cycle writes;
// refunds/reservations/staff are never touched by these routes, so counting them would only add
// a way for the snapshot to be wrong.
const RMS_COUNTED_TABLES = ['restaurant_tables', 'restaurant_sections', 'restaurant_table_sessions',
  'restaurant_bills', 'restaurant_bill_payments', 'restaurant_receipts', 'restaurant_kds_tickets'];

// A whole-store snapshot, taken before the first request and again after the owned records are
// removed. Row counts alone would not prove the pre-existing `T-101` survived untouched - a count
// can be restored by replacing a row with a different one - so that row is pinned by identity.
async function rmsStoreSnapshot(pg, merchantId) {
  const counts = {};
  for (const table of RMS_COUNTED_TABLES) {
    const { rows } = await pg.query(`SELECT count(*)::int n FROM public.${table}`);
    counts[table] = rows[0].n;
  }
  const t101 = (await pg.query(
    `SELECT id::text id, table_number, table_name, capacity, status, qr_code_token
       FROM public.restaurant_tables
      WHERE merchant_id = $1::uuid AND table_number = 'T-101' ORDER BY id`,
    [merchantId]
  )).rows;
  const ordersForMerchant = (await pg.query(
    'SELECT count(*)::int n FROM public.orders WHERE merchant_id = $1::uuid', [merchantId]
  )).rows[0].n;
  return { counts, t101, ordersForMerchant };
}

async function runRmsE2eTests() {
  console.log('\n========================================================================');
  console.log('🍽️  NABIN RMS: END-TO-END HTTP INTEGRATION TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;
  let notApplicable = 0;

  function recordPass(testName) {
    passed++;
    console.log(`  ✅ [PASS] ${testName}`);
  }

  function recordFail(testName, err) {
    failed++;
    console.error(`  ❌ [FAIL] ${testName}: ${err.message || err}`);
  }

  // A check with no subject on this target. Counted apart from `passed` so the summary cannot read a
  // skipped check as one that ran.
  function recordNotApplicable(testName, why) {
    notApplicable++;
    console.log(`  ⚪ [NOT APPLICABLE] ${testName}: ${why}`);
  }

  // 1. Boot local HTTP server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  const restaurantId = '00000000-0000-0000-0000-000000000201'; // Dilli Darbar
  const merchantToken = 'mcht_session_dilli';
  const customerToken = 'usr_session_rahul';

  // Ensure active sessions exist
  if (!db.activeSessions) db.activeSessions = new Map();
  db.activeSessions.set(merchantToken, {
    token: merchantToken,
    role: 'MERCHANT',
    entityId: restaurantId,
    entity: {
      id: restaurantId,
      name: 'Dilli Darbar Mughlai Kitchen',
      merchant_type: 'RESTAURANT',
      tenantId: restaurantId
    }
  });

  db.activeSessions.set(customerToken, {
    token: customerToken,
    role: 'CUSTOMER',
    entityId: '00000000-0000-0000-0000-000000000001',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      uuid: '00000000-0000-0000-0000-000000000001',
      name: 'Rahul Sharma',
      phone: '+919876543210',
      role: 'CUSTOMER'
    },
    name: 'Rahul Sharma',
    phone: '+919876543210'
  });

  const mchtHeaders = { Authorization: `Bearer ${merchantToken}` };
  const custHeaders = { Authorization: `Bearer ${customerToken}` };

  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  if (supabaseAdmin && isLivePostgres) {
    try {
      await supabaseAdmin.from('merchants').update({
        merchant_type: 'RESTAURANT',
        is_open: true
      }).eq('id', '00000000-0000-0000-0000-000000000201');
    } catch (_) {}
  }

  // The floor table this run owns outright, and the bookings it placed — both collected so the
  // cleanup in the `finally` below can delete exactly these records and nothing else is in range.
  let ownedTableId = null;
  const bookedOrderIds = [];
  const trackOrder = (id) => { if (id) bookedOrderIds.push(String(id)); };

  // Isolation, not deletion: the merchant already carries a `T-101` that this suite did not create
  // and has no claim on, so asking for a second one was never deterministic. Against the durable
  // target the insert is refused by restaurant_tables_merchant_id_table_number_key and the stage dies
  // on 409 instead of 201; against the Maps it silently re-resolves to a row the assertions did not
  // create. A run-unique number owned by this run answers both: it cannot collide with anything that
  // already exists, and it is deletable by its own id afterwards. `T-101` is not read, changed or
  // removed by this suite.
  const tableNumber = `E2E-${String(crypto.randomInt(100000, 999999))}`;

  // A loopback-guarded connection to the durable store, used only to snapshot it and to remove the
  // records this run owns. Nothing is inserted through it, so its ownership registry stays empty.
  let fx = null;
  let snapshotBefore = null;

  // The cleanup half of the isolation, run from the `finally` so a mid-stage failure still gets it.
  // Its scope is exactly two sets, both owned by this run:
  //  - the floor table it inserted, deleted by the id the route returned. Its session, bill, tenders
  //    and receipt go with it: `restaurant_table_sessions` cascade from `restaurant_tables`, and
  //    bills, payments and receipts cascade down from the session.
  //  - the KDS tickets minted for the order ids this run booked, swept by order id. Deleting the
  //    table does NOT remove them: `restaurant_kds_tickets.order_id` cascades from `orders`, not from
  //    the table, and its `table_session_id` link is SET NULL.
  // The orders themselves stay: they are the rows this project treats as immutable, no order-delete
  // route exists, and the snapshot reports how many it left instead of pretending it was zero.
  async function removeOwnedRecords() {
    const label = 'E2E-18: Owned floor table and its KDS tickets removed again, RMS baseline restored';
    if (!isLivePostgres) {
      recordNotApplicable(label,
        'this run had no durable store - its table, session, bill and tickets lived in Maps that die '
        + 'with the process, so there was nothing to delete and no PostgreSQL cleanup path was exercised.');
      return;
    }
    if (!fx) {
      recordNotApplicable(label,
        'this run never reached the durable store, so it created no records to remove; the failed '
        + 'connection is already recorded as a failure above and no cleanup path was exercised.');
      return;
    }
    let problem = null;
    try {
      const parts = [];
      if (ownedTableId) {
        const { rowCount } = await fx.query(
          'DELETE FROM public.restaurant_tables WHERE id = $1::uuid', [ownedTableId]);
        assert.strictEqual(rowCount, 1,
          `this run owned exactly one floor table (${tableNumber}) and deleted ${rowCount} by id ${ownedTableId}`);
        parts.push(`its floor table ${tableNumber}`);
      } else {
        parts.push('no floor table (the run never got one created)');
      }

      const tickets = await fx.removeKdsTicketsFor(bookedOrderIds);
      assert.deepStrictEqual(tickets.blocked, [],
        `sweeping this run's own KDS tickets was refused: ${JSON.stringify(tickets.blocked)}`);
      parts.push(`${tickets.removed} KDS ticket(s) across its ${bookedOrderIds.length} booking(s)`);

      const orphans = (await fx.query(
        'SELECT count(*)::int n FROM public.restaurant_kds_tickets WHERE order_id = ANY($1::uuid[])',
        [bookedOrderIds]
      )).rows[0].n;
      assert.strictEqual(orphans, 0,
        `${orphans} KDS ticket(s) minted for this run's own orders survived the sweep`);

      const after = await rmsStoreSnapshot(fx, restaurantId);
      const moved = RMS_COUNTED_TABLES
        .filter((t) => after.counts[t] !== snapshotBefore.counts[t])
        .map((t) => `${t}: ${snapshotBefore.counts[t]} -> ${after.counts[t]}`);
      assert.deepStrictEqual(moved, [],
        `these RMS tables are not back to their baseline row counts: ${moved.join(', ')}`);
      assert.deepStrictEqual(after.t101, snapshotBefore.t101,
        'the pre-existing T-101 row this suite must never touch came back changed or missing');

      const ordersLeft = after.ordersForMerchant - snapshotBefore.ordersForMerchant;
      assert.strictEqual(ordersLeft, bookedOrderIds.length,
        `this run booked ${bookedOrderIds.length} order(s) but the store gained ${ordersLeft} `
        + `for the seed merchant - an order row appeared that the run did not account for`);

      console.log(`  🧹 [CLEANUP] Removed ${parts.join(' and ')}. Every RMS table is back to its `
        + `baseline row count; T-101 and the merchant's ${snapshotBefore.counts.restaurant_sections} `
        + `floor section(s) are identical to the before-snapshot. Left behind by design: `
        + `${ordersLeft} order row(s), because orders are immutable in this project.`);
    } catch (err) {
      problem = err;
    }

    // The connection closes whichever way the steps went. The helper's own scope is proven empty
    // first: with an empty registry `cleanup()` deletes nothing, so calling it cannot reach a row
    // this suite did not already name above.
    try {
      const claimed = Object.keys(fx.created).filter((key) => fx.created[key].length);
      assert.deepStrictEqual(claimed, [],
        `this suite inserted fixture rows the helper registry never accounted for: ${claimed.join(', ')}`);
      const tail = await fx.cleanup();
      assert.deepStrictEqual(tail.blocked, [],
        `fixture-connection cleanup was refused: ${JSON.stringify(tail.blocked)}`);
    } catch (err) {
      problem = problem || err;
    } finally {
      await fx.client.end().catch(() => {});
    }

    if (problem) recordFail(label, problem);
    else recordPass(label);
  }

  try {
    // The snapshot has to be taken before the first write, and the connection has to exist before
    // any stage can own a record, so both live at the top of the guarded block.
    if (isLivePostgres) {
      fx = await openFixtures('rms-e2e');
      snapshotBefore = await rmsStoreSnapshot(fx, restaurantId);
      console.log(`  Baseline RMS store: ${RMS_COUNTED_TABLES.map((t) => `${t}=${snapshotBefore.counts[t]}`).join(' ')}, `
        + `orders for this merchant=${snapshotBefore.ordersForMerchant}, `
        + `T-101 row(s)=${snapshotBefore.t101.length}`);
    }

    // -------------------------------------------------------------
    // STAGE 1: TABLE CREATION & QR GENERATION
    // -------------------------------------------------------------
    console.log('--- Stage 1: Merchant Creates Dine-In Table ---');

    const createTableRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/tables`, mchtHeaders, {
      table_number: tableNumber,
      name: 'Corner VIP Table',
      capacity: 4,
      section_name: 'Ground Floor'
    });

    assert.strictEqual(createTableRes.statusCode, 201, `Table creation should return 201 Created: ${JSON.stringify(createTableRes.body)}`);
    assert.strictEqual(createTableRes.body.success, true);
    const table = createTableRes.body.table;
    assert.ok(table.id, 'Table must have an ID');
    assert.ok(table.qr_token || table.qrCodeToken, 'Table must have a QR token');
    const qrToken = table.qr_token || table.qrCodeToken;
    ownedTableId = table.id;
    recordPass(`E2E-01: Merchant creates its own floor table ${tableNumber} with unique ID and QR code token`);

    // -------------------------------------------------------------
    // STAGE 2: CUSTOMER SCANS QR CODE (PUBLIC ENDPOINT)
    // -------------------------------------------------------------
    console.log('\n--- Stage 2: Customer Scans Table QR Code ---');

    const qrScanRes = await makeRequest('GET', `/api/food/table-qr/${qrToken}`);
    assert.strictEqual(qrScanRes.statusCode, 200, 'Public QR resolution must return 200 OK');
    assert.strictEqual(qrScanRes.body.success, true);
    assert.strictEqual(qrScanRes.body.table.tableNumber, tableNumber, 'QR must identify correct table number');
    assert.strictEqual(qrScanRes.body.table.capacity, 4);
    assert.strictEqual(qrScanRes.body.password, undefined, 'Must not leak credentials');
    assert.strictEqual(qrScanRes.body.tokens, undefined, 'Must not leak session tokens');
    recordPass('E2E-02: Customer successfully scans table QR with zero credential leakage');

    // -------------------------------------------------------------
    // STAGE 3: CUSTOMER SUBMITS DINE_IN ORDER
    // -------------------------------------------------------------
    console.log('\n--- Stage 3: Customer Places Dine-In Order ---');

    const dineInOrderRes = await makeRequest('POST', '/api/customer/book-food', custHeaders, {
      restaurantId,
      orderChannel: 'DINE_IN',
      qrToken,
      guestCount: 3,
      items: ['1x Special Dum Biryani (Chicken)', '2x Garlic Butter Naan (2 pcs)']
    });

    assert.strictEqual(dineInOrderRes.statusCode, 200, `Dine-In order creation must succeed: ${JSON.stringify(dineInOrderRes.body)}`);
    assert.strictEqual(dineInOrderRes.body.success, true);
    const order1 = dineInOrderRes.body.job || dineInOrderRes.body.order;
    assert.ok(order1.id, 'Created order must have an ID');
    trackOrder(order1.id);
    recordPass('E2E-03: Customer submits DINE_IN order via QR token without delivery address');

    // -------------------------------------------------------------
    // STAGE 4: VERIFY KDS TICKET & ACTIVE SESSION
    // -------------------------------------------------------------
    console.log('\n--- Stage 4: Verify KDS Queue & Table Session ---');

    const kdsRes = await makeRequest('GET', `/api/merchant/${restaurantId}/rms/kds/tickets`, mchtHeaders);
    assert.strictEqual(kdsRes.statusCode, 200);
    const kdsTickets = kdsRes.body.tickets || [];
    const ticket1 = kdsTickets.find(t => t.orderId === order1.id || t.order_id === order1.id);
    assert.ok(ticket1, 'KDS ticket must exist for order');
    assert.strictEqual(ticket1.tableNumber || ticket1.table_number, tableNumber,
      `KDS ticket must state this run's own table ${tableNumber}`);
    assert.strictEqual(ticket1.channel || ticket1.order_channel, 'DINE_IN');
    assert.strictEqual(ticket1.status, 'NEW');
    recordPass(`E2E-04: Order appears in KDS queue with table number ${tableNumber} and NEW status`);

    // Progress KDS ticket
    const prepRes = await makeRequest('PATCH', `/api/merchant/${restaurantId}/rms/kds/tickets/${ticket1.id}/status`, mchtHeaders, {
      status: 'PREPARING'
    });
    assert.strictEqual(prepRes.statusCode, 200);
    assert.strictEqual(prepRes.body.ticket.status, 'PREPARING');

    const readyRes = await makeRequest('PATCH', `/api/merchant/${restaurantId}/rms/kds/tickets/${ticket1.id}/status`, mchtHeaders, {
      status: 'READY'
    });
    assert.strictEqual(readyRes.statusCode, 200);
    assert.strictEqual(readyRes.body.ticket.status, 'READY');

    const servedRes = await makeRequest('PATCH', `/api/merchant/${restaurantId}/rms/kds/tickets/${ticket1.id}/status`, mchtHeaders, {
      status: 'SERVED'
    });
    assert.strictEqual(servedRes.statusCode, 200);
    assert.strictEqual(servedRes.body.ticket.status, 'SERVED');
    recordPass('E2E-05: Kitchen staff advances KDS ticket from PREPARING to READY to SERVED');

    // -------------------------------------------------------------
    // STAGE 5: SECOND ROUND OF DINING & BILL ACCUMULATION
    // -------------------------------------------------------------
    console.log('\n--- Stage 5: Second Order Round & Bill Accumulation ---');

    // Table now has an active session
    const tableSessionRes = await makeRequest('GET', `/api/merchant/${restaurantId}/rms/tables/${table.id}/session`, mchtHeaders);
    assert.strictEqual(tableSessionRes.statusCode, 200, `Expected 200 for table session, got ${tableSessionRes.statusCode}: ${JSON.stringify(tableSessionRes.body)}`);
    const activeSession = tableSessionRes.body.session;
    assert.ok(activeSession, 'Active session must be attached to table');

    // Customer places second round
    const round2Res = await makeRequest('POST', '/api/customer/book-food', custHeaders, {
      restaurantId,
      orderChannel: 'DINE_IN',
      qrToken,
      items: ['1x Garlic Butter Naan (2 pcs)']
    });
    assert.strictEqual(round2Res.statusCode, 200, `Expected 200 for round 2, got ${round2Res.statusCode}: ${JSON.stringify(round2Res.body)}`);
    const order2 = round2Res.body.job || round2Res.body.order;
    trackOrder(order2.id);
    recordPass('E2E-06: Customer orders second round on same table session');

    // -------------------------------------------------------------
    // STAGE 6: SERVER-AUTHORITATIVE BILL GENERATION & SPLITTING
    // -------------------------------------------------------------
    console.log('\n--- Stage 6: Server Bill Calculation & 2-Way Split ---');

    const billRes = await makeRequest('GET', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/bill`, mchtHeaders);
    assert.strictEqual(billRes.statusCode, 200);
    const bill = billRes.body.bill;
    assert.ok(bill.subtotal > 0, 'Bill subtotal must sum rounds');
    assert.ok(bill.gst_amount > 0, 'Bill must compute GST tax server-authoritatively');
    assert.strictEqual(bill.dine_in_packaging_fee, 0, 'Dine-In packaging fee must be zero');
    assert.strictEqual(bill.status, 'UNPAID');
    recordPass('E2E-07: Bill accurately accumulates both order rounds with server-authoritative GST');

    // Split bill 2 ways
    const splitRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/bill/split`, mchtHeaders, {
      ways: 2
    });
    assert.strictEqual(splitRes.statusCode, 200);
    assert.strictEqual(splitRes.body.splitWays, 2);
    assert.strictEqual(splitRes.body.shares.length, 2);
    const perPersonShare = splitRes.body.amountPerShare;
    assert.ok(perPersonShare > 0);
    recordPass('E2E-08: Bill successfully split 2 ways with exact per-person amounts');

    // -------------------------------------------------------------
    // STAGE 7: UNPAID TABLE PROTECTION
    // -------------------------------------------------------------
    console.log('\n--- Stage 7: Unpaid Table Protection Guard ---');

    // Trying to close session or reset table while unpaid must be rejected
    const illegalCloseRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/close`, mchtHeaders);
    assert.strictEqual(illegalCloseRes.statusCode, 400, 'Closing unpaid session must be rejected');
    assert.ok(['UNPAID_BALANCE', 'TABLE_SESSION_UNPAID'].includes(illegalCloseRes.body.code), `Closing unpaid session returned: ${illegalCloseRes.body.code}`);

    const illegalTableStatusRes = await makeRequest('PATCH', `/api/merchant/${restaurantId}/rms/tables/${table.id}/status`, mchtHeaders, {
      status: 'AVAILABLE'
    });
    assert.strictEqual(illegalTableStatusRes.statusCode, 400, 'Setting table to AVAILABLE with balance must be rejected');
    assert.strictEqual(illegalTableStatusRes.body.code, 'TABLE_SESSION_UNPAID');
    recordPass('E2E-09: Unpaid table protection prevents closing session or freeing table');

    // -------------------------------------------------------------
    // STAGE 8: PAYMENT RECORDING & SESSION CLOSURE
    // -------------------------------------------------------------
    console.log('\n--- Stage 8: Payments & Table Cleaning Cycle ---');

    // Person 1 pays their share via UPI
    const pay1Res = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/bill/pay`, mchtHeaders, {
      amount: perPersonShare,
      method: 'UPI',
      reference: 'UPI_REF_1001'
    });
    assert.strictEqual(pay1Res.statusCode, 200);
    assert.strictEqual(pay1Res.body.bill.status, 'PARTIALLY_PAID');
    recordPass('E2E-10: Person 1 pays their share via UPI; bill transitions to PARTIALLY_PAID');

    // Person 2 pays the rest in CASH
    const remainingBalance = pay1Res.body.bill.balanceAmount;
    const pay2Res = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/bill/pay`, mchtHeaders, {
      amount: remainingBalance,
      method: 'CASH',
      reference: 'CASH_REC_1002',
      autoCloseSession: false
    });
    assert.strictEqual(pay2Res.statusCode, 200);
    assert.strictEqual(pay2Res.body.bill.status, 'PAID');
    assert.strictEqual(pay2Res.body.bill.balanceAmount, 0);
    recordPass('E2E-11: Person 2 pays remaining balance via CASH; bill transitions to PAID');

    // Close session
    const closeRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/sessions/${activeSession.id}/close`, mchtHeaders);
    assert.strictEqual(closeRes.statusCode, 200);
    assert.strictEqual(closeRes.body.session.status, 'CLOSED');
    assert.strictEqual(closeRes.body.table.status, 'CLEANING', 'Table must automatically transition to CLEANING upon close');
    recordPass('E2E-12: Session closes cleanly; table transitions automatically to CLEANING');

    // Staff finishes cleaning table -> AVAILABLE
    const cleanRes = await makeRequest('PATCH', `/api/merchant/${restaurantId}/rms/tables/${table.id}/status`, mchtHeaders, {
      status: 'AVAILABLE'
    });
    assert.strictEqual(cleanRes.statusCode, 200);
    assert.strictEqual(cleanRes.body.table.status, 'AVAILABLE');
    recordPass('E2E-13: Table finishes CLEANING cycle and returns to AVAILABLE for next guests');

    // -------------------------------------------------------------
    // STAGE 9: TAKEAWAY CHANNEL VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- Stage 9: Takeaway Channel Verification ---');

    const takeawayOrderRes = await makeRequest('POST', '/api/customer/book-food', custHeaders, {
      restaurantId,
      orderChannel: 'TAKEAWAY',
      pickupTime: '15 mins',
      items: ['1x Special Dum Biryani (Chicken)']
    });
    assert.strictEqual(takeawayOrderRes.statusCode, 200);
    const takeawayOrder = takeawayOrderRes.body.job || takeawayOrderRes.body.order;
    assert.ok(takeawayOrder.id);
    trackOrder(takeawayOrder.id);
    recordPass('E2E-14: Takeaway order created without delivery address');

    // Verify Takeaway handover
    const handoverRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/orders/${takeawayOrder.id}/handover`, mchtHeaders, {
      staffId: 'staff_counter_01'
    });
    assert.strictEqual(handoverRes.statusCode, 200);
    assert.strictEqual(handoverRes.body.handover.status, 'COLLECTED');

    // Reject duplicate handover
    const dupHandoverRes = await makeRequest('POST', `/api/merchant/${restaurantId}/rms/orders/${takeawayOrder.id}/handover`, mchtHeaders, {
      staffId: 'staff_counter_01'
    });
    assert.strictEqual(dupHandoverRes.statusCode, 400);
    assert.strictEqual(dupHandoverRes.body.code, 'ALREADY_COLLECTED');
    recordPass('E2E-15: Takeaway handover verified; duplicate collection safely rejected');

    // -------------------------------------------------------------
    // STAGE 10: DELIVERY CHANNEL VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- Stage 10: Delivery Channel Address Guard ---');

    // Delivery WITHOUT address must fail with PLACE_REQUIRED
    const badDeliveryRes = await makeRequest('POST', '/api/customer/book-food', custHeaders, {
      restaurantId,
      orderChannel: 'DELIVERY',
      items: ['1x Special Dum Biryani (Chicken)']
    });
    assert.strictEqual(badDeliveryRes.statusCode, 400);
    assert.strictEqual(badDeliveryRes.body.code, 'PLACE_REQUIRED');
    recordPass('E2E-16: Delivery order without address is strictly rejected (PLACE_REQUIRED)');

    // Delivery WITH address succeeds
    const goodDeliveryRes = await makeRequest('POST', '/api/customer/book-food', custHeaders, {
      restaurantId,
      orderChannel: 'DELIVERY',
      deliveryAddress: 'House 42, Chanmari, Aizawl, Mizoram',
      items: ['1x Special Dum Biryani (Chicken)']
    });
    assert.strictEqual(goodDeliveryRes.statusCode, 200);
    const deliveryOrder = goodDeliveryRes.body.job || goodDeliveryRes.body.order;
    assert.ok(deliveryOrder.id);
    trackOrder(deliveryOrder.id);
    recordPass('E2E-17: Delivery order with validated address created successfully');
  } catch (err) {
    recordFail('E2E Integration flow', err);
  } finally {
    if (server) {
      server.close();
    }
    await removeOwnedRecords();
  }

  console.log('\n========================================================================');
  if (failed === 0 && notApplicable === 0) {
    console.log(`🎉 ALL ${passed} RMS END-TO-END INTEGRATION TESTS PASSED!`);
  } else {
    console.log(`RMS END-TO-END INTEGRATION: ${passed} passed, ${failed} failed, `
      + `${notApplicable} not applicable.`);
    if (notApplicable > 0) {
      console.log('   NOT APPLICABLE means the check had no subject on this target: this run had no '
        + 'durable PostgreSQL store, so its database cleanup path was NOT exercised or verified.');
    }
  }
  console.log('========================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runRmsE2eTests();
