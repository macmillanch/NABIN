'use strict';

/**
 * NABIN RMS — POSTGRESQL DURABILITY TEST
 *
 * Proves that the Restaurant Management System repository is genuinely backed by PostgreSQL
 * (migration 041 for the schema, 043 for the atomic functions), not just an in-memory store that
 * silently swallows write failures. Every RMS mutation this file exercises is checked twice: the
 * row exists in the store, and the refusal the Map could not make is made by the store. The three
 * cross-process children then read the billing, the kitchen/reservation/staff domains and the sales
 * report back from a second OS process that was handed only ids — the last one against a plain SQL
 * aggregate, so a money figure is shown to be summed from rows and not from one process's memory.
 *
 * MUST be run against local Docker Postgres, e.g.:
 *   node scripts/with_local_target.js node test_rms_postgres_durability.js
 */

const assert = require('assert');
const cp = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const RestaurantManagementRepository = require('./src/repositories/RestaurantManagementRepository');
const { isLivePostgres, supabaseAdmin, nabinEnv } = require('./src/supabase');

const RESTAURANT_A = '00000000-0000-0000-0000-000000000201';
// The verification handle must aim at the same schema the backend writes. An isolated chain link is
// handed a `DATABASE_URL` carrying `options=-c search_path=chain_scratch` (scripts/chain_scratch.js
// `link-env`), so reading it here is what keeps the direct SQL checks pointed at the clone instead of
// at `public` — the split target #283 recorded. With no isolation in play the value is the same local
// Docker store, so an ordinary run is unchanged; LOCAL_POSTGRES_URL stays the operator override.
// Every query below names its tables UNqualified for the same reason: a `public.`-qualified read or
// fixture insert would escape the search_path the link was given, so the suite would assert against
// `public` while the RPC writes landed in the clone. Measured that way round — the first isolated run
// wrote `chain_scratch.merchants` through the route and then failed its check because the read still
// said `FROM public.merchants`.
// F-C1-1: the same refusal applies to the DECLARATION itself — an address typed into this file is a
// store no configuration named, so nothing is inferred when the keys are unset. LOCAL_POSTGRES_URL
// stays the operator override, now validated by the guard instead of trusted, and
// scripts/test_chain.js:585 documents that this handle must follow the lane's DATABASE_URL.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({
  label: 'test_rms_postgres_durability',
  keys: ['LOCAL_POSTGRES_URL', 'DATABASE_URL', 'NABIN_PG_NOTIFY'],
});
const PG_URL = PG_TARGET.connectionString;

async function run() {
  console.log('========================================================================');
  console.log('📋 NABIN RMS: POSTGRESQL DURABILITY TEST (041 schema + 043 functions)');
  console.log('========================================================================\n');

  if (!isLivePostgres || !supabaseAdmin) {
    throw new Error('This test requires a live PostgreSQL target. Run via scripts/with_local_target.js');
  }
  if (!(nabinEnv && nabinEnv.restLocal === true)) {
    throw new Error('Refusing to run: RMS durability test writes to PostgreSQL and is only permitted against local Docker (127.0.0.1). Run via scripts/with_local_target.js');
  }

  const pg = new Client(PG_URL);
  await pg.connect();

  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  const sectionName = `Durability Floor ${suffix}`;
  const tableNumber = `D-${suffix}`;

  let passed = 0;
  let total = 0;
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

  const merchantBefore = (await pg.query(
    'SELECT dine_in_enabled, takeaway_enabled, delivery_enabled, tax_rate_percent, service_charge_percent, packaging_fee, upi_id, upi_qr_url, upi_merchant_name, gstin, rms_settings FROM merchants WHERE id = $1',
    [RESTAURANT_A]
  )).rows[0];
  assert.ok(merchantBefore, `Seed merchant ${RESTAURANT_A} must exist in local Postgres`);

  const mockDb = {
    merchants: [
      { id: RESTAURANT_A, name: 'Heritage Diner', address: '124 Station Road, Aizawl', phone: '+919876543210' }
    ]
  };

  let createdTableId = null;
  let createdQrTableId = null;
  let createdSectionId = null;
  let fixtureCustomerId = null;
  let fixtureOrderId = null;
  let sessionId = null;
  let billId = null;
  let billInvoice = null;
  let fixtureTicketId = null;
  let fixtureTicketNumber = null;
  let fixtureTakeawayOrderId = null;
  const fixtureReservationIds = [];
  const fixtureStaffIds = [];

  try {
    // --- Settings durability ---
    await testAsync('Settings update is persisted to the merchants row (booleans + rates)', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      await repo.updateSettings(RESTAURANT_A, {
        dine_in_enabled: true,
        takeaway_enabled: false,
        delivery_enabled: true,
        tax_rate_percent: 12.5,
        service_charge_percent: 3.25,
        packaging_fee: 7.5,
        prep_time_minutes: 25,
        upi_id: 'durability@okhdfcbank',
        gstin: '22AAAAA0000A1Z5'
      });
      const row = (await pg.query(
        'SELECT dine_in_enabled, takeaway_enabled, delivery_enabled, tax_rate_percent, service_charge_percent, packaging_fee, upi_id, gstin FROM merchants WHERE id = $1',
        [RESTAURANT_A]
      )).rows[0];
      assert.strictEqual(row.takeaway_enabled, false, 'takeaway_enabled should persist as false');
      assert.strictEqual(Number(row.tax_rate_percent), 12.5, 'tax_rate_percent should persist');
      assert.strictEqual(Number(row.service_charge_percent), 3.25, 'service_charge_percent should persist');
      assert.strictEqual(Number(row.packaging_fee), 7.5, 'packaging_fee should persist');
      assert.strictEqual(row.upi_id, 'durability@okhdfcbank', 'upi_id should persist');
      assert.strictEqual(row.gstin, '22AAAAA0000A1Z5', 'gstin should persist');
    });

    await testAsync('Extra settings (prep_time_minutes) are persisted in merchants.rms_settings JSONB', async () => {
      const row = (await pg.query(
        "SELECT rms_settings FROM merchants WHERE id = $1",
        [RESTAURANT_A]
      )).rows[0];
      assert.ok(row.rms_settings, 'rms_settings column must exist and be readable');
      assert.strictEqual(Number(row.rms_settings.prep_time_minutes), 25, 'prep_time_minutes should persist in rms_settings');
    });

    await testAsync('A fresh repository instance reads settings back from PostgreSQL', async () => {
      const fresh = new RestaurantManagementRepository(mockDb);
      const s = await fresh.getSettings(RESTAURANT_A);
      assert.strictEqual(Number(s.taxRatePercent), 12.5);
      assert.strictEqual(Number(s.serviceChargePercent), 3.25);
      assert.strictEqual(Number(s.prepTimeMinutes), 25);
      assert.strictEqual(s.upiId, 'durability@okhdfcbank');
    });

    // --- Table + section durability ---
    await testAsync('createTable writes a real row into restaurant_tables', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const t = await repo.createTable(RESTAURANT_A, {
        table_number: tableNumber,
        table_name: `Durability Table ${suffix}`,
        capacity: 6,
        section_name: sectionName
      });
      createdTableId = t.id;
      const row = (await pg.query(
        'SELECT id, table_number, table_name, capacity, status, qr_code_token, section_id FROM restaurant_tables WHERE table_number = $1 AND merchant_id = $2',
        [tableNumber, RESTAURANT_A]
      )).rows[0];
      assert.ok(row, 'Table row must exist in PostgreSQL after createTable');
      assert.strictEqual(row.table_name, `Durability Table ${suffix}`, 'table_name column must be populated');
      assert.strictEqual(Number(row.capacity), 6);
      assert.strictEqual(row.status, 'AVAILABLE');
      assert.ok(row.qr_code_token && row.qr_code_token.length > 0, 'qr_code_token column must be populated');
      assert.ok(row.section_id, 'section_id must be linked');
      createdSectionId = row.section_id;
    });

    await testAsync('Section is persisted and linked via restaurant_sections', async () => {
      const row = (await pg.query(
        'SELECT name FROM restaurant_sections WHERE id = $1',
        [createdSectionId]
      )).rows[0];
      assert.ok(row, 'Section row must exist in PostgreSQL');
      assert.strictEqual(row.name, sectionName);
    });

    await testAsync('A fresh repository instance reads the table back from PostgreSQL', async () => {
      const fresh = new RestaurantManagementRepository(mockDb);
      const list = await fresh.getTables(RESTAURANT_A);
      const found = list.find(t => t.table_number === tableNumber);
      assert.ok(found, 'Fresh instance must read the persisted table from PostgreSQL');
      assert.strictEqual(found.name, `Durability Table ${suffix}`);
      assert.strictEqual(found.sectionName, sectionName, 'Section name must resolve from restaurant_sections');
    });

    await testAsync('QR resolution reads from PostgreSQL (fresh instance, empty memory)', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const t = await repo.createTable(RESTAURANT_A, {
        table_number: `${tableNumber}-QR`,
        capacity: 2,
        section_name: sectionName
      });
      // Held for the reservation tests: a capacity-2 table is the one that can prove
      // PARTY_EXCEEDS_CAPACITY without a second table fixture.
      createdQrTableId = t.id;
      const qrToken = t.qr_code_token || t.qrToken;
      const fresh = new RestaurantManagementRepository(mockDb);
      const resolved = await fresh.getTableByQrToken(qrToken);
      assert.ok(resolved && resolved.table, 'QR token must resolve from PostgreSQL');
      assert.strictEqual(resolved.table.table_number, `${tableNumber}-QR`);
    });

    // --- Durable billing: the bill and its tenders as rows, not as this process's arithmetic ---
    // Money figures for the assertions below all derive from what the settings write stored: two
    // seeded dishes of ₹220 + 3 × ₹60 = ₹400 at 12.5% GST and 3.25% service charge, so 400+50+13=463.
    const SUBTOTAL = 400;
    const BILL_TOTAL = 463;
    const PARTIAL = 100;
    const REMAINDER = 363;
    // order_lines requires restaurant_product_id NOT NULL for a RESTAURANT_PRODUCT line, and the
    // trigger demands the product belong to the ordering merchant, so these are the seed merchant's
    // own seeded dishes.
    const LINES = [
      { product: '00000000-0000-0000-0000-000000000501', name: 'Special Dum Biryani (Chicken)', qty: 1, price: 220 },
      { product: '00000000-0000-0000-0000-000000000502', name: 'Garlic Butter Naan', qty: 3, price: 60 }
    ];

    await testAsync('A billed session writes restaurant_bills from real orders and order_lines rows', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const customer = await pg.query(
        'INSERT INTO users (phone, name, email) VALUES ($1, $2, $3) RETURNING id',
        [`77${suffix.slice(-8)}`.slice(0, 20), `RMS Durability Diner ${suffix}`, `rmsdur.${suffix}@example.invalid`]
      );
      fixtureCustomerId = customer.rows[0].id;
      const order = await pg.query(
        'INSERT INTO orders (order_number, customer_id, merchant_id, service_type, order_state, total_amount, items_snapshot)'
        + " VALUES ($1, $2, $3, 'FOOD', 'RECEIVED', $4, '[]'::jsonb) RETURNING id",
        [`RMSDUR-${suffix}`, fixtureCustomerId, RESTAURANT_A, SUBTOTAL]
      );
      fixtureOrderId = order.rows[0].id;
      for (const line of LINES) {
        await pg.query(
          'INSERT INTO order_lines (order_id, merchant_id, catalog_kind, restaurant_product_id,'
          + " product_name_snapshot, quantity, unit_snapshot, unit_price_snapshot, line_total)"
          + " VALUES ($1, $2, 'RESTAURANT_PRODUCT', $3, $4, $5, 'piece', $6, $7)",
          [fixtureOrderId, RESTAURANT_A, line.product, line.name, line.qty, line.price, line.qty * line.price]
        );
      }

      const session = await repo.openTableSession(RESTAURANT_A, createdTableId, { guest_count: 2 });
      sessionId = session.id;
      await repo.recordSessionOrder(sessionId, { id: fixtureOrderId }, RESTAURANT_A);

      const bill = await repo.getBillForSession(RESTAURANT_A, sessionId);
      billId = bill.id;
      billInvoice = bill.invoiceNumber;
      assert.ok(String(billInvoice).startsWith('INV-'), `invoice number must be minted, got ${billInvoice}`);
      assert.strictEqual(bill.subtotal, SUBTOTAL, 'subtotal must come from the persisted order_lines');
      assert.strictEqual(bill.taxAmount, 50, 'GST must use the rate persisted on the merchant');
      assert.strictEqual(bill.serviceCharge, 13, 'service charge must use the persisted rate');
      assert.strictEqual(bill.totalAmount, BILL_TOTAL);
      assert.strictEqual(bill.balanceAmount, BILL_TOTAL);
      assert.strictEqual(bill.status, 'UNPAID');
      assert.deepStrictEqual(bill.items.map(i => i.name), LINES.map(l => l.name),
        'the bill must freeze its lines from order_lines, in order');
      assert.strictEqual(bill.paymentInstructions.upiId, 'durability@okhdfcbank',
        'the payment instruction must be the merchant UPI id as persisted');

      const row = (await pg.query(
        'SELECT invoice_number, status, total_amount, paid_amount, refunded_amount FROM restaurant_bills WHERE id = $1',
        [bill.id]
      )).rows[0];
      assert.ok(row, 'the bill must exist as a restaurant_bills row');
      assert.strictEqual(row.invoice_number, billInvoice);
      assert.strictEqual(Number(row.total_amount), BILL_TOTAL);
      assert.strictEqual(row.status, 'UNPAID');
      assert.strictEqual(Math.round((Number(row.total_amount) - Number(row.paid_amount) + Number(row.refunded_amount)) * 100) / 100,
        BILL_TOTAL, 'the outstanding balance must derive from the row, not from this process');
    });

    await testAsync('Asking for the same session bill twice hands back the one row', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const again = await repo.getBillForSession(RESTAURANT_A, sessionId);
      assert.strictEqual(again.id, billId, 'a second read must not mint a second bill');
      assert.strictEqual(again.invoiceNumber, billInvoice,
        'the invoice number a restart would re-mint must be stable across reads');
      assert.strictEqual(again.totalAmount, BILL_TOTAL);
      const count = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_bills WHERE table_session_id = $1', [sessionId]
      )).rows[0].n;
      assert.strictEqual(count, 1, `one session must have exactly one bill row, found ${count}`);
    });

    await testAsync('Closing the session is refused while the durable balance is unpaid', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      let code = null;
      try {
        await repo.closeSession(RESTAURANT_A, sessionId, { closedBy: 'Manager Rajlami' });
      } catch (err) {
        code = err.code;
      }
      assert.strictEqual(code, 'UNPAID_BALANCE', 'an unpaid durable balance must refuse the close');
      const row = (await pg.query(
        'SELECT status, closed_at FROM restaurant_table_sessions WHERE id = $1', [sessionId]
      )).rows[0];
      assert.strictEqual(row.status, 'BILL_REQUESTED', 'the refused close must leave the session row open');
      assert.strictEqual(row.closed_at, null, 'the refused close must not stamp closed_at');
    });

    await testAsync('A recorded tender is a restaurant_bill_payments row that moves bill and session', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      let notFound = null;
      try {
        // An invoice number is not a uuid, so it cannot name the id column. Sending it to the engine
        // would raise 22P02 and reach the merchant as an outage instead of a typo.
        await repo.recordBillPayment(RESTAURANT_A, billInvoice, { amount: 10, paymentMethod: 'CASH' });
      } catch (err) {
        notFound = err.code;
      }
      assert.strictEqual(notFound, 'BILL_NOT_FOUND', 'an id that cannot name a bill must be refused, not credited');

      const paid = await repo.recordBillPayment(RESTAURANT_A, billId, {
        amount: PARTIAL,
        paymentMethod: 'CASH',
        collectedBy: 'Cashier Sunita',
        idempotencyKey: `RMSDUR-${suffix}-PAY1`
      });
      assert.strictEqual(paid.duplicate, false, 'a first tender is not a duplicate');
      assert.strictEqual(paid.paidAmount, PARTIAL);
      assert.strictEqual(paid.balanceAmount, REMAINDER);
      assert.strictEqual(paid.status, 'PARTIALLY_PAID');
      assert.strictEqual(paid.payments.length, 1, 'the bill document must carry its tender rows');
      assert.strictEqual(paid.payments[0].recordedBy, 'Cashier Sunita');
      assert.strictEqual(paid.payments[0].verificationStatus, 'RECORDED',
        'a staff-recorded tender is never verified by this backend');

      const prow = (await pg.query(
        'SELECT amount, payment_method, recorded_by, idempotency_key FROM restaurant_bill_payments WHERE bill_id = $1',
        [billId]
      )).rows[0];
      assert.ok(prow, 'the tender must exist as its own restaurant_bill_payments row');
      assert.strictEqual(Number(prow.amount), PARTIAL);
      assert.strictEqual(prow.idempotency_key, `RMSDUR-${suffix}-PAY1`);

      const srow = (await pg.query(
        'SELECT paid_amount, balance_amount FROM restaurant_table_sessions WHERE id = $1', [sessionId]
      )).rows[0];
      assert.strictEqual(Number(srow.paid_amount), PARTIAL, 'the session row must carry the collected money');
      assert.strictEqual(Number(srow.balance_amount), REMAINDER, 'the session row must carry the outstanding balance');
    });

    await testAsync('Replaying the same idempotency key answers the tender without re-crediting', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const replay = await repo.recordBillPayment(RESTAURANT_A, billId, {
        amount: PARTIAL,
        paymentMethod: 'CASH',
        idempotencyKey: `RMSDUR-${suffix}-PAY1`
      });
      assert.strictEqual(replay.duplicate, true, 'a replay must say it is a replay');
      assert.strictEqual(replay.paidAmount, PARTIAL, 'a replay must not double the collected amount');
      assert.strictEqual(replay.balanceAmount, REMAINDER, 'a replay must not halve the balance');
      const n = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_bill_payments WHERE bill_id = $1', [billId]
      )).rows[0].n;
      assert.strictEqual(n, 1, `a replayed request must leave exactly one tender row, found ${n}`);
    });

    await testAsync('A non-cash tender above the outstanding balance is refused, not over-credited', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      let code = null;
      try {
        await repo.recordBillPayment(RESTAURANT_A, billId, {
          amount: BILL_TOTAL,
          paymentMethod: 'UPI',
          transactionRef: `RMSDUR-${suffix}-OVER`
        });
      } catch (err) {
        code = err.code;
      }
      assert.strictEqual(code, 'OVERPAYMENT_NOT_ALLOWED',
        'a UPI tender cannot silently credit more than the bill is owed');
      const n = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_bill_payments WHERE transaction_ref = $1',
        [`RMSDUR-${suffix}-OVER`]
      )).rows[0].n;
      assert.strictEqual(n, 0, 'the refused tender must leave no row behind');
    });

    await testAsync('Settling the balance closes the session, and the money stays consistent', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const settled = await repo.recordBillPayment(RESTAURANT_A, billId, {
        amount: REMAINDER,
        paymentMethod: 'CASH',
        idempotencyKey: `RMSDUR-${suffix}-PAY2`
      });
      assert.strictEqual(settled.status, 'PAID');
      assert.strictEqual(settled.paidAmount, BILL_TOTAL);
      assert.strictEqual(settled.balanceAmount, 0);
      assert.strictEqual(settled.payments.length, 2, 'both tenders must be on the bill');

      const closed = await repo.closeSession(RESTAURANT_A, sessionId, { closedBy: 'Manager Rajlami' });
      assert.strictEqual(closed.session.status, 'CLOSED', 'a settled session closes');
      assert.strictEqual(closed.table.status, 'CLEANING');
    });

    await testAsync('A brand-new OS process reads the row back from PostgreSQL (restart persistence)', async () => {
      const res = cp.spawnSync(process.execPath, [__filename, '--restart-child', RESTAURANT_A, tableNumber, billInvoice], {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 90000,
        env: process.env
      });
      const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('RMS_RESTART_VERDICT ')).pop();
      assert.ok(line, `the restart child printed no verdict (exit ${res.status}): `
        + String(res.stderr || res.stdout || '').slice(-300));
      const v = JSON.parse(line.slice('RMS_RESTART_VERDICT '.length));
      // Two OS processes, not one process pretending: the verdict is only a read-back proof if the
      // reader had a heap this process never touched.
      assert.ok(Number.isInteger(v.pid) && v.pid !== process.pid,
        `the reader must be a different OS process (parent ${process.pid}, child ${v.pid})`);
      console.log(`      restart pair: writer pid ${process.pid} / reader pid ${v.pid}`);
      assert.strictEqual(v.refused, false, `the restart child refused its own target: ${v.reason}`);
      assert.strictEqual(Number(v.taxRatePercent), 12.5,
        'a process that wrote nothing must read the persisted tax rate from PostgreSQL');
      assert.strictEqual(v.upiId, 'durability@okhdfcbank', 'upi_id must survive into a fresh process');
      assert.ok(v.tableFound, `the ${tableNumber} row must be readable in a fresh process `
        + `(it saw ${v.tableCount} table(s) from ${v.tablesSource})`);
      assert.strictEqual(v.tablesSource, 'postgres', 'the tables domain must be labelled postgres under an open gate');
      assert.strictEqual(v.billsSource, 'postgres',
        'the bills domain is labelled postgres because getBillForSession now writes and reads restaurant_bills');
      // The point of the whole file, stated as a fact the child can contradict: a bill and the
      // tenders on it have to be readable by a process that was never given them.
      assert.strictEqual(v.billCount, 1, `exactly one bill should carry invoice ${billInvoice}, the child saw ${v.billCount}`);
      assert.strictEqual(v.billTotal, BILL_TOTAL, 'the billed total must survive into a fresh process');
      assert.strictEqual(v.billPaid, BILL_TOTAL, 'the collected total must survive into a fresh process');
      assert.strictEqual(v.billBalance, 0, 'a settled bill must still read as settled in a fresh process');
      assert.strictEqual(v.billStatus, 'PAID', 'the bill status must survive into a fresh process');
      assert.strictEqual(v.paymentCount, 2, 'both recorded tenders must be rows another process can read');
      assert.strictEqual(v.tenderSum, BILL_TOTAL, 'the tender rows must sum to what the writer collected');
      assert.deepStrictEqual(v.billItemNames, LINES.map(l => l.name),
        'the frozen item snapshot must come back with its original names');
    });

    await testAsync('A closed durable session keeps its bill, tenders and table row', async () => {
      const row = (await pg.query(
        'SELECT s.status AS session_status, t.status AS table_status, s.total_amount, s.paid_amount, s.balance_amount'
        + ' FROM restaurant_table_sessions s JOIN restaurant_tables t ON t.id = s.table_id'
        + ' WHERE s.id = $1',
        [sessionId]
      )).rows[0];
      assert.strictEqual(row.session_status, 'CLOSED');
      assert.strictEqual(row.table_status, 'CLEANING');
      assert.strictEqual(Number(row.total_amount), BILL_TOTAL);
      assert.strictEqual(Number(row.paid_amount), BILL_TOTAL);
      assert.strictEqual(Number(row.balance_amount), 0);
    });

    // --- The operations 043 moved last: kitchen, counter, host, staff ---
    //
    // Each of these was a Map collection until now, which means every assertion below has two halves:
    // the row exists in PostgreSQL, and the refusal the Map could not make (a second ticket for one
    // order, a booking that overlaps, a party of 20 on a table for 6) is made by the store.

    const OPS_TAKEAWAY_ORDER = `RMSDURTK-${suffix}`;

    await testAsync('A KDS ticket is a row whose items come from order_lines, not from the caller', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      // No `items` are passed at all. The Map required the caller to hand it a list, so the kitchen
      // board showed whatever the request body happened to carry; the function aggregates the order's
      // own order_lines rows.
      const ticket = await repo.createKdsTicket({
        orderId: fixtureOrderId,
        merchantId: RESTAURANT_A,
        channel: 'DINE_IN',
        tableNumber
      });
      fixtureTicketId = ticket.id;
      const number = ticket.ticket_number || ticket.ticketNumber;
      fixtureTicketNumber = number;
      assert.ok(String(number).startsWith('KBD-'), `ticket number must come from the sequence, got ${number}`);
      assert.strictEqual(ticket.status, 'NEW');
      assert.strictEqual(Number(ticket.prep_time_minutes), 20,
        'the repository default must reach the row, not stay in this process');
      assert.strictEqual(String(ticket.table_session_id), String(sessionId),
        'the ticket must carry the session its order is attached to');

      const items = Array.isArray(ticket.items) ? ticket.items : [];
      assert.strictEqual(items.length, LINES.length, 'the board must show both ordered lines');
      const names = items.map(i => i.name || i.dish_name).sort();
      assert.deepStrictEqual(names, LINES.map(l => l.name).sort(),
        'the items must be the order_lines themselves');
      const biryani = items.find(i => (i.name || i.dish_name) === LINES[0].name);
      assert.strictEqual(Number(biryani.lineTotal), 220, 'line totals come from the persisted lines');

      const row = (await pg.query(
        'SELECT ticket_number, channel, table_number, table_session_id, status, prep_time_minutes, items_snapshot'
        + ' FROM restaurant_kds_tickets WHERE id = $1',
        [fixtureTicketId]
      )).rows[0];
      assert.ok(row, 'the ticket must exist as a restaurant_kds_tickets row');
      assert.strictEqual(row.ticket_number, number);
      assert.strictEqual(row.channel, 'DINE_IN');
      assert.strictEqual(row.table_number, tableNumber);
      assert.strictEqual(String(row.table_session_id), String(sessionId));
      assert.strictEqual(row.status, 'NEW');
      assert.strictEqual(Number(row.prep_time_minutes), 20);
      assert.strictEqual(row.items_snapshot.length, LINES.length, 'the frozen item snapshot must be on the row');
    });

    await testAsync('A second ticket request for the same order replays the row instead of a new number', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const replay = await repo.createKdsTicket({
        orderId: fixtureOrderId,
        merchantId: RESTAURANT_A,
        channel: 'DINE_IN',
        tableNumber
      });
      assert.strictEqual(replay.duplicate, true, 'a replay must say it is a replay');
      assert.strictEqual(replay.id, fixtureTicketId, 'a replay must hand back the ticket that exists');
      const n = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_kds_tickets WHERE order_id = $1', [fixtureOrderId]
      )).rows[0].n;
      assert.strictEqual(n, 1, `one order must have exactly one kitchen ticket, found ${n}`);

      let code = null;
      try {
        // A made-up id is not an outage and not a ticket: the repository refuses it before the
        // engine can answer a 22P02 cast error.
        await repo.createKdsTicket({ orderId: billInvoice, merchantId: RESTAURANT_A });
      } catch (err) {
        code = err.code;
      }
      assert.strictEqual(code, 'ORDER_NOT_FOUND', 'an id that cannot name an order must be refused, not ticketed');
    });

    await testAsync('The kitchen ladder refuses NEW -> SERVED and stamps the moves it allows', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      let code = null;
      try {
        await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'SERVED');
      } catch (err) {
        code = err.code;
      }
      assert.strictEqual(code, 'INVALID_TICKET_TRANSITION',
        'a ticket cannot go from NEW to SERVED — that is a dish the kitchen was never told to cook');

      let bad = null;
      try {
        await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'BURNING');
      } catch (err) {
        bad = err.code;
      }
      assert.strictEqual(bad, 'INVALID_TICKET_STATUS', 'an undeclared status must be refused, not stored');

      const preparing = await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'PREPARING');
      assert.strictEqual(preparing.status, 'PREPARING');
      const ready = await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'READY');
      assert.strictEqual(ready.status, 'READY');
      const served = await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'SERVED');
      assert.strictEqual(served.status, 'SERVED');

      const row = (await pg.query(
        'SELECT status, prep_started_at, ready_at, served_at, status_changed_at FROM restaurant_kds_tickets WHERE id = $1',
        [fixtureTicketId]
      )).rows[0];
      assert.strictEqual(row.status, 'SERVED');
      assert.ok(row.prep_started_at, 'prep_started_at must be stamped on the row by the PREPARING move');
      assert.ok(row.ready_at, 'ready_at must be stamped on the row by the READY move');
      assert.ok(row.served_at, 'served_at must be stamped on the row by the SERVED move');
      assert.ok(row.status_changed_at, 'the last change must be timestamped');

      const again = await repo.updateKdsTicketStatus(RESTAURANT_A, fixtureTicketId, 'SERVED');
      assert.strictEqual(again.duplicate, true, 're-asserting the current status is a replay, not a transition');
    });

    await testAsync('Takeaway handover marks the order row and never writes a status the schema forbids', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const order = await pg.query(
        'INSERT INTO orders (order_number, customer_id, merchant_id, service_type, order_state, order_channel,'
        + " total_amount, items_snapshot) VALUES ($1, $2, $3, 'FOOD', 'READY_FOR_PICKUP', 'TAKEAWAY', $4, '[]'::jsonb)"
        + ' RETURNING id',
        [OPS_TAKEAWAY_ORDER, fixtureCustomerId, RESTAURANT_A, 320]
      );
      fixtureTakeawayOrderId = order.rows[0].id;

      const result = await repo.recordTakeawayHandover(RESTAURANT_A, fixtureTakeawayOrderId, 'Counter Staff Vanlalnrami');
      assert.strictEqual(result.status, 'COLLECTED', 'the handover is reported as collected');
      assert.strictEqual(result.order_state, 'READY_FOR_PICKUP',
        'and the real order_state is passed through, not overwritten with a value the 018 CHECK has never allowed');

      const row = (await pg.query(
        'SELECT handover_by, handover_at, order_state FROM orders WHERE id = $1', [fixtureTakeawayOrderId]
      )).rows[0];
      assert.strictEqual(row.handover_by, 'Counter Staff Vanlalnrami', 'who handed it over must be on the row');
      assert.ok(row.handover_at, 'handover_at must be stamped on the row');
      assert.strictEqual(row.order_state, 'READY_FOR_PICKUP',
        'COLLECTED is a derived view of handover_at, not a stored order_state');

      let code = null;
      try {
        await repo.recordTakeawayHandover(RESTAURANT_A, fixtureTakeawayOrderId, 'Counter Staff Vanlalnrami');
      } catch (err) {
        code = err.code;
      }
      assert.strictEqual(code, 'ALREADY_COLLECTED', 'a second handover of the same order must refuse, not re-stamp');

      const after = (await pg.query(
        'SELECT handover_at FROM orders WHERE id = $1', [fixtureTakeawayOrderId]
      )).rows[0];
      assert.strictEqual(String(after.handover_at), String(row.handover_at),
        'the refused handover must not move the original stamp');

      let missing = null;
      try {
        await repo.recordTakeawayHandover(RESTAURANT_A, '00000000-0000-0000-0000-000000000000', 'Staff');
      } catch (err) {
        missing = err.code;
      }
      assert.strictEqual(missing, 'ORDER_NOT_FOUND',
        'the Map invented a ₹320 order so the route could answer 200; the function has no order to mark');
    });

    await testAsync('A booking is a row, and the store refuses the overlap and the impossible party', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const res = await repo.createReservation(RESTAURANT_A, {
        customerName: 'Rochuma',
        customerPhone: '9876500101',
        partySize: 4,
        reservationTime: '2026-11-20T19:00:00+05:30',
        tableId: createdTableId,
        notes: 'Window seat if possible'
      });
      fixtureReservationIds.push(res.id);
      assert.strictEqual(res.status, 'CONFIRMED', 'the function mints the booking as CONFIRMED');
      assert.strictEqual(Number(res.party_size), 4);

      const row = (await pg.query(
        'SELECT table_id, customer_name, customer_phone, party_size, status, notes, status_changed_at'
        + ' FROM restaurant_reservations WHERE id = $1',
        [res.id]
      )).rows[0];
      assert.ok(row, 'the booking must exist as a restaurant_reservations row');
      assert.strictEqual(String(row.table_id), String(createdTableId));
      assert.strictEqual(row.customer_name, 'Rochuma');
      assert.strictEqual(row.status, 'CONFIRMED');
      assert.ok(row.status_changed_at, 'the minted status must carry a timestamp');

      let conflict = null;
      let conflictStatus = null;
      try {
        await repo.createReservation(RESTAURANT_A, {
          customerName: 'Zothanliana',
          customerPhone: '9876500102',
          partySize: 4,
          reservationTime: '2026-11-20T20:00:00+05:30',
          tableId: createdTableId
        });
      } catch (err) {
        conflict = err.code;
        conflictStatus = err.statusCode;
      }
      assert.strictEqual(conflict, 'RESERVATION_CONFLICT',
        'one hour apart on the same table is inside the two-hour window the function locks on');
      assert.strictEqual(conflictStatus, 400,
        'the refusal is the function answer at its status; the Map invented 409 here');

      let over = null;
      try {
        await repo.createReservation(RESTAURANT_A, {
          customerName: 'Fulledhouse',
          customerPhone: '9876500103',
          partySize: 20,
          reservationTime: '2026-11-25T19:00:00+05:30',
          tableId: createdTableId
        });
      } catch (err) {
        over = err.code;
      }
      assert.strictEqual(over, 'PARTY_EXCEEDS_CAPACITY', 'a party of 20 cannot be seated at a table for 6');

      let noTable = null;
      try {
        await repo.createReservation(RESTAURANT_A, {
          customerName: 'Ghost table',
          customerPhone: '9876500104',
          partySize: 2,
          reservationTime: '2026-11-26T19:00:00+05:30',
          tableId: '00000000-0000-0000-0000-000000000000'
        });
      } catch (err) {
        noTable = err.code;
      }
      assert.strictEqual(noTable, 'TABLE_NOT_FOUND', 'a booking cannot name a table that is not this restaurant\'s');

      const n = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_reservations WHERE table_id = $1', [createdTableId]
      )).rows[0].n;
      assert.strictEqual(n, 1, `three refused bookings must leave one row on that table, found ${n}`);
    });

    await testAsync('A booking early in the IST morning is listed for the day the host is reading', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const res = await repo.createReservation(RESTAURANT_A, {
        customerName: 'Khuallingma',
        customerPhone: '9876500105',
        partySize: 2,
        reservationTime: '2026-11-21T00:30:00+05:30',
        tableId: createdQrTableId
      });
      fixtureReservationIds.push(res.id);

      // The row is stamped in UTC, and half-past midnight in Mizoram is 19:00Z the previous day.
      // The Map filtered with `startsWith(dateStr)` on exactly that string, so this booking was
      // invisible on the 21st and visible on the 20th — the day the host was not looking at.
      const raw = (await pg.query(
        'SELECT reservation_time FROM restaurant_reservations WHERE id = $1', [res.id]
      )).rows[0];
      assert.ok(String(raw.reservation_time.toISOString()).startsWith('2026-11-20'),
        `fixture must sit on the previous UTC date, got ${raw.reservation_time.toISOString()}`);

      const onThe21st = await repo.getReservations(RESTAURANT_A, { date: '2026-11-21' });
      assert.ok(onThe21st.some(r => String(r.id) === String(res.id)),
        'the 21st list must contain the 00:30 IST booking');
      const onThe20th = await repo.getReservations(RESTAURANT_A, { date: '2026-11-20' });
      assert.ok(!onThe20th.some(r => String(r.id) === String(res.id)),
        'and it must not appear twice, on the day the party is not coming');
    });

    await testAsync('The reservation ladder is enforced, and SEATED moves the table row with it', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const seated = await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[0], 'SEATED');
      assert.strictEqual(seated.status, 'SEATED');
      const table = (await pg.query(
        'SELECT status FROM restaurant_tables WHERE id = $1', [createdTableId]
      )).rows[0];
      assert.strictEqual(table.status, 'OCCUPIED',
        'seating a party must occupy the table, from the CLEANING state the closed session left it in');

      let walkBack = null;
      try {
        await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[0], 'NO_SHOW');
      } catch (err) {
        walkBack = err.code;
      }
      assert.strictEqual(walkBack, 'INVALID_TRANSITION',
        'a party already seated cannot be reported as a no-show after the fact');

      const noShow = await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[1], 'NO_SHOW');
      assert.strictEqual(noShow.status, 'NO_SHOW', 'CONFIRMED -> NO_SHOW is a real outcome');
      const again = await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[1], 'NO_SHOW');
      assert.strictEqual(again.duplicate, true,
        'a host tapping the same outcome twice must be told the booking did not move again');
      let revived = null;
      try {
        await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[1], 'CONFIRMED');
      } catch (err) {
        revived = err.code;
      }
      assert.strictEqual(revived, 'INVALID_TRANSITION',
        'and the Map let a cancelled night be revived to CONFIRMED; the ladder does not');

      let nonsense = null;
      try {
        await repo.updateReservationStatus(RESTAURANT_A, fixtureReservationIds[1], 'ARRIVED');
      } catch (err) {
        nonsense = err.code;
      }
      assert.strictEqual(nonsense, 'INVALID_RESERVATION_STATUS',
        'a status no RMS state means must be refused before it is stored');

      let absent = null;
      try {
        await repo.updateReservationStatus(RESTAURANT_A, billInvoice, 'SEATED');
      } catch (err) {
        absent = err.code;
      }
      assert.strictEqual(absent, 'RESERVATION_NOT_FOUND',
        'an id that cannot name a reservation must be refused, not sent to the engine as a cast error');

      const row = (await pg.query(
        'SELECT status, updated_by FROM restaurant_reservations WHERE id = $1',
        [fixtureReservationIds[0]]
      )).rows[0];
      assert.strictEqual(row.status, 'SEATED');
      assert.strictEqual(row.updated_by, 'Staff',
        'the function supplies its own actor when the route passes no name; the repository sends null');
    });

    await testAsync('A staff record is a row, and its own constraints are the caller\'s problem', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const staffPhone = `9${Date.now()}`.slice(0, 12);
      const staff = await repo.createStaff(RESTAURANT_A, {
        name: 'Zodinghema',
        phone: staffPhone,
        role: 'CASHIER'
      });
      fixtureStaffIds.push(staff.id);
      assert.strictEqual(staff.role, 'CASHIER');
      assert.strictEqual(staff.is_active, true);
      assert.ok(staff.permissions.includes('process_payment'),
        'the role\'s permissions must be derived from the platform\'s own map, not stored per row');

      const row = (await pg.query(
        'SELECT merchant_id, name, phone, role, is_active, role_changed_at FROM restaurant_staff WHERE id = $1',
        [staff.id]
      )).rows[0];
      assert.ok(row, 'the staff member must exist as a restaurant_staff row');
      assert.strictEqual(String(row.merchant_id), String(RESTAURANT_A));
      assert.strictEqual(row.phone, staffPhone);
      assert.strictEqual(row.role, 'CASHIER');
      assert.strictEqual(row.is_active, true);
      assert.ok(row.role_changed_at, 'the role assignment must be timestamped on the row');

      // Three refusals that must be refusals and not a store outage: an undeclared role and an
      // over-long name are checked here because no column would catch them, and a duplicate phone
      // is caught by the table's own unique index.
      let badRole = null;
      try {
        await repo.createStaff(RESTAURANT_A, { name: 'Nobody', phone: '9999999991', role: 'CHEF' });
      } catch (err) { badRole = err; }
      assert.ok(/Invalid role/.test(badRole.message), `an undeclared role must be refused, got ${badRole.code}`);

      let tooLong = null;
      let tooLongStatus = null;
      try {
        await repo.createStaff(RESTAURANT_A, { name: 'N'.repeat(300), phone: '9999999992', role: 'WAITER' });
      } catch (err) { tooLong = err.code; tooLongStatus = err.statusCode; }
      assert.strictEqual(tooLong, 'INVALID_INPUT', 'a name longer than the column must be refused, not truncated');
      assert.strictEqual(tooLongStatus, 400);

      let taken = null;
      let takenStatus = null;
      try {
        await repo.createStaff(RESTAURANT_A, { name: 'Same Phone', phone: staffPhone, role: 'WAITER' });
      } catch (err) { taken = err.code; takenStatus = err.statusCode; }
      assert.strictEqual(taken, 'STAFF_PHONE_TAKEN',
        'the unique index is a rule about the form, not a broken store — 503 here would send the restaurant to IT');
      assert.strictEqual(takenStatus, 409);

      let badUser = null;
      try {
        await repo.createStaff(RESTAURANT_A, { name: 'Ghost User', phone: '9999999993', role: 'MANAGER', user_id: billInvoice });
      } catch (err) { badUser = err.code; }
      assert.strictEqual(badUser, 'INVALID_INPUT', 'a user_id that cannot name a user must be refused before the insert');

      const dupes = (await pg.query(
        'SELECT COUNT(*)::int AS n FROM restaurant_staff WHERE phone = $1', [staffPhone]
      )).rows[0].n;
      assert.strictEqual(dupes, 1, `the taken-phone attempt must add no row, found ${dupes}`);

      const refused = (await pg.query(
        "SELECT COUNT(*)::int AS n FROM restaurant_staff WHERE phone IN ('9999999991','9999999992','9999999993')"
      )).rows[0].n;
      assert.strictEqual(refused, 0, `the three input-refused staff writes must leave no rows, found ${refused}`);
    });

    await testAsync('Removing staff deactivates the row so the shifts it recorded keep a name', async () => {
      const repo = new RestaurantManagementRepository(mockDb);
      const removed = await repo.deleteStaff(RESTAURANT_A, fixtureStaffIds[0]);
      assert.strictEqual(removed, true);

      const row = (await pg.query(
        'SELECT name, is_active FROM restaurant_staff WHERE id = $1', [fixtureStaffIds[0]]
      )).rows[0];
      assert.ok(row, 'the row must survive — a delete here would erase who staffed a paid shift');
      assert.strictEqual(row.is_active, false);

      // A hand-made row that never answered the is_active question. The column is nullable with a
      // DEFAULT of true, so "not asked" is not "deactivated": the memory rule was `!== false` and a
      // durable `.eq(is_active,true)` would silently drop this person from the staff list.
      const undecided = await pg.query(
        "INSERT INTO restaurant_staff (merchant_id, name, phone, role) VALUES ($1, $2, $3, 'KITCHEN_STAFF')"
        + ' RETURNING id',
        [RESTAURANT_A, 'Never Asked', '9999999994']
      );
      fixtureStaffIds.push(undecided.rows[0].id);

      const fresh = await new RestaurantManagementRepository(mockDb).getStaff(RESTAURANT_A);
      assert.ok(!fresh.some(s => String(s.id) === String(fixtureStaffIds[0])),
        'a fresh instance must read the deactivation from PostgreSQL, not from this process');
      assert.ok(fresh.some(s => String(s.id) === String(undecided.rows[0].id)),
        'a row whose is_active was never set must still count as active staff');

      assert.strictEqual(await repo.deleteStaff(RESTAURANT_A, '00000000-0000-0000-0000-000000000000'), false,
        'an id that names no row of this merchant answers false, not an outage');
      assert.strictEqual(await repo.deleteStaff(RESTAURANT_A, billInvoice), false,
        'and so does an id that is not even a uuid');
    });

    await testAsync('A second OS process reads the ticket, the booking and the staff row back', async () => {
      const res = cp.spawnSync(process.execPath, [
        __filename, '--ops-child', RESTAURANT_A, fixtureTicketId,
        String(fixtureReservationIds[1]), String(fixtureStaffIds[1]), String(fixtureStaffIds[0]), fixtureTakeawayOrderId
      ], {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 90000,
        env: process.env
      });
      const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('RMS_OPS_VERDICT ')).pop();
      assert.ok(line, `the ops child printed no verdict (exit ${res.status}): `
        + String(res.stderr || res.stdout || '').slice(-300));
      const v = JSON.parse(line.slice('RMS_OPS_VERDICT '.length));
      assert.ok(Number.isInteger(v.pid) && v.pid !== process.pid,
        `the reader must be a different OS process (parent ${process.pid}, child ${v.pid})`);
      console.log(`      ops pair: writer pid ${process.pid} / reader pid ${v.pid}`);
      assert.strictEqual(v.refused, false, `the ops child refused its own target: ${v.reason}`);

      assert.strictEqual(v.kdsSource, 'postgres');
      assert.strictEqual(v.ticketFound, true, 'a process that minted no ticket must find it on the board');
      assert.strictEqual(v.ticketStatus, 'SERVED', 'the ladder the parent walked must be the stored status');
      assert.strictEqual(v.ticketItems, LINES.length, 'the frozen item snapshot must travel with the row');
      assert.strictEqual(v.ticketNumber, fixtureTicketNumber,
        'the sequence-minted number must be the one another process reads back');

      assert.strictEqual(v.reservationsSource, 'postgres');
      assert.strictEqual(v.bookingFound, true, 'the booking must be readable in a fresh process');
      assert.strictEqual(v.bookingStatus, 'NO_SHOW');

      assert.strictEqual(v.staffSource, 'postgres');
      assert.strictEqual(v.activeStaffFound, true,
        'the never-asked row must be active for a process that never saw the memory rule');
      assert.strictEqual(v.deactivatedFound, false, 'the removed staff member must stay removed across a restart');

      // The handover lives on the orders row, which this file already wrote durably for billing; what
      // is new is that the *handover columns* are written by an RPC instead of a Map entry. A reader
      // that was handed only the order id proves the columns are in the store.
      assert.strictEqual(v.handoverBy, 'Counter Staff Vanlalnrami');
      assert.strictEqual(v.handoverStamped, true);
      assert.strictEqual(v.handoverOrderState, 'READY_FOR_PICKUP',
        'a fresh process must read the real order_state back, not the COLLECTED the Map used to write');
    });

    // The last claim of this file, aimed at the one RMS read that answers with money. A sales report
    // a merchant prices a month by must be a count of rows, not of objects one process happened to
    // remember — so the child sums the same tables with plain SQL, under the rules 043:1844-1888
    // states, and the report has to land on the same numbers with nothing in its own Maps.
    await testAsync('A sales report is summed from rows by a process that holds none of them', async () => {
      const res = cp.spawnSync(process.execPath, [__filename, '--sales-child', RESTAURANT_A, billInvoice], {
        cwd: __dirname,
        encoding: 'utf8',
        timeout: 90000,
        env: process.env
      });
      const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('RMS_SALES_VERDICT ')).pop();
      assert.ok(line, `the sales child printed no verdict (exit ${res.status}): `
        + String(res.stderr || res.stdout || '').slice(-300));
      const v = JSON.parse(line.slice('RMS_SALES_VERDICT '.length));
      assert.ok(Number.isInteger(v.pid) && v.pid !== process.pid,
        `the reader must be a different OS process (parent ${process.pid}, child ${v.pid})`);
      console.log(`      sales pair: writer pid ${process.pid} / reader pid ${v.pid}`);
      assert.strictEqual(v.refused, false, `the sales child refused its own target: ${v.reason}`);

      assert.strictEqual(v.billsHeldBefore, 0, 'the reader must start with no bill in memory');
      assert.strictEqual(v.ordersHeldBefore, 0, 'and no order');
      assert.strictEqual(v.billsHeldAfter, 0, 'producing a report must not repopulate the bill Map from the store');
      assert.strictEqual(v.ordersHeldAfter, 0, 'nor the order Map');

      assert.ok(v.sql.billCount >= 1 && v.sql.gross > 0,
        `the store must hold a sale for this merchant to report, found ${v.sql.billCount} bill(s) totalling ${v.sql.gross}`);

      const s = v.report, q = v.sql;
      assert.strictEqual(s.grossSales, q.gross, 'gross_sales must equal SUM(bills)+SUM(non-dine-in orders) over the rows');
      assert.strictEqual(s.totalBills, q.billCount, 'total_bills must be the count of bill rows, voided ones aside');
      assert.strictEqual(s.paidBills, q.paidBills);
      assert.strictEqual(s.unpaidBills, q.unpaidBills);
      assert.strictEqual(s.partiallyPaidBills, q.partiallyPaidBills);
      assert.strictEqual(s.totalOrders, q.dineInOrders + q.orderCount,
        'total_orders must count the dine-in orders and the channelled ones, not the bills twice');
      assert.strictEqual(s.totalTax, q.tax, 'the GST figure must be the sum the rows carry, not a rate re-applied now');
      assert.strictEqual(s.totalServiceCharge, q.service);
      assert.strictEqual(s.totalPackagingFee, q.packaging);
      assert.strictEqual(s.netSales, q.net, 'net_sales must come out of the same sums');
      assert.strictEqual(s.averageOrderValue, q.aov);
      assert.strictEqual(s.collections, q.collections,
        'recorded collections must equal SUM(effective_credited) over restaurant_bill_payments');
      assert.strictEqual(s.outstanding, q.outstanding);
      assert.strictEqual(s.refunds, q.refunds);

      // The delta this run's own write makes. The invoice names the bill row the parent inserted and
      // nothing else, so putting its total back into the aggregate moves the report by exactly that.
      assert.strictEqual(v.ownInvoice, billInvoice, 'the bill this run billed must still be a row a year of restarts away');
      assert.strictEqual(v.ownTotal, BILL_TOTAL,
        `the durable bill must be found by invoice number and carry the ${BILL_TOTAL} it was billed at, got ${v.ownTotal}`);
      assert.strictEqual(Math.round((s.grossSales - v.ownTotal) * 100) / 100, v.grossWithoutOwn,
        'the report must contain exactly this bill once — no phantom second copy from a replayed request');

      assert.ok(v.report.itemNames.includes('Special Dum Biryani (Chicken)'),
        `item_sales must name the dish whose order_lines row was written, got ${JSON.stringify(v.report.itemNames)}`);
      assert.match(v.report.disclaimer, /^AUDIT NOTICE:/,
        'a durable report is still a record, and has to say so on the same page as the money');
      assert.strictEqual(v.report.upiVerificationNote, 'Staff recorded direct UPI payment; not bank verified',
        'the UPI line keeps the note that it is staff-recorded money, however durable the row is');
      assert.strictEqual(v.report.upiAmount, q.upiAmount,
        'the UPI figure must be the UPI tender rows, counted where they are stored');

      // A period that names no row answers zero. Without this, a date filter could be accepted,
      // ignored, and still report the whole history as though it were the month someone asked for.
      assert.strictEqual(v.window.startDate, v.gap.startDate, 'the report must say the period it was asked for');
      assert.strictEqual(v.window.grossSales, 0, `a window with no rows (${v.gap.startDate} .. ${v.gap.endDate}) must report 0, not the whole history`);
      assert.strictEqual(v.window.totalBills, 0);
      assert.strictEqual(v.window.collections, 0);
      assert.strictEqual(v.window.itemCount, 0);

      // A reversed period is the caller's mistake, not the store's: it is refused before the RPC is
      // reached, and it must not be reported to a merchant as an outage.
      assert.strictEqual(v.invalid.threw, true, 'a start after the end cannot produce a window');
      assert.strictEqual(v.invalid.code, 'INVALID_DATE_RANGE');
      assert.strictEqual(v.invalid.statusCode, 400);
      assert.strictEqual(v.invalid.storeFailure, false, 'a bad period is a bad request, not a store down');
      assert.strictEqual(v.invalid.storeCalls, 0, 'and it is refused before any call leaves the process');
      assert.strictEqual(v.fullStoreCalls, 1, 'one report is one read over the store');

      // The channel view is the same document, so the two halves must not diverge on a number.
      assert.strictEqual(v.channel.grossSales, s.grossSales,
        'getChannelSalesReport and getSalesReport must agree on gross sales, or a merchant gets two totals');
      assert.strictEqual(v.channel.dineInSales, q.billGross,
        'the DINE_IN line is the bill rows — an RMS bill is by definition a table');
      assert.strictEqual(v.channel.dineInCount, q.dineInOrders);
      assert.strictEqual(v.channel.methodsSum, q.collections,
        'the per-method money must add up to the tender rows, no more and no less');
    });

    console.log('\n========================================================================');
    console.log(`🎉 ALL ${passed}/${total} RMS POSTGRESQL DURABILITY TESTS PASSED!`);
    console.log('========================================================================');
  } finally {
    try {
      // Deleted by id, in dependency order, before their parents go: a reservation's table_id and a
      // staff row's user_id are both ON DELETE SET NULL, so deleting the table or the user first
      // would leave this suite's rows behind with no trace of who created them.
      if (fixtureTicketId) {
        await pg.query('DELETE FROM restaurant_kds_tickets WHERE id = $1', [fixtureTicketId]);
      }
      if (fixtureReservationIds.length) {
        await pg.query('DELETE FROM restaurant_reservations WHERE id = ANY($1::uuid[])', [fixtureReservationIds]);
      }
      if (fixtureStaffIds.length) {
        await pg.query('DELETE FROM restaurant_staff WHERE id = ANY($1::uuid[])', [fixtureStaffIds]);
      }
      if (createdTableId) {
        await pg.query('DELETE FROM restaurant_tables WHERE merchant_id = $1 AND (table_number = $2 OR table_number = $3)', [RESTAURANT_A, tableNumber, `${tableNumber}-QR`]);
      }
      if (createdSectionId) {
        await pg.query('DELETE FROM restaurant_sections WHERE id = $1', [createdSectionId]);
      }
      await pg.query('DELETE FROM restaurant_sections WHERE merchant_id = $1 AND name = $2', [RESTAURANT_A, sectionName]);
      // The fixture orders are not under the table: orders.table_session_id is ON DELETE SET NULL, so
      // deleting the table would leave this suite's order rows behind with a null session.
      if (fixtureOrderId) {
        await pg.query('DELETE FROM orders WHERE id = $1', [fixtureOrderId]);
      }
      if (fixtureTakeawayOrderId) {
        await pg.query('DELETE FROM orders WHERE id = $1', [fixtureTakeawayOrderId]);
      }
      if (fixtureCustomerId) {
        await pg.query('DELETE FROM users WHERE id = $1', [fixtureCustomerId]);
      }
      await pg.query(
        'UPDATE merchants SET dine_in_enabled = $1, takeaway_enabled = $2, delivery_enabled = $3, tax_rate_percent = $4, service_charge_percent = $5, packaging_fee = $6, upi_id = $7, upi_qr_url = $8, upi_merchant_name = $9, gstin = $10, rms_settings = $11 WHERE id = $12',
        [
          merchantBefore.dine_in_enabled,
          merchantBefore.takeaway_enabled,
          merchantBefore.delivery_enabled,
          merchantBefore.tax_rate_percent,
          merchantBefore.service_charge_percent,
          merchantBefore.packaging_fee,
          merchantBefore.upi_id,
          merchantBefore.upi_qr_url,
          merchantBefore.upi_merchant_name,
          merchantBefore.gstin,
          merchantBefore.rms_settings,
          RESTAURANT_A
        ]
      );
    } catch (cleanupErr) {
      console.error('Cleanup warning:', cleanupErr.message);
    }
    await pg.end();
  }
}

// ---------------------------------------------------------------- restart child
//
// A second process, never given the write, never given a populated Map. This is what a server
// restart actually is: the in-memory stores are per-instance, so anything this child reads back
// can only have come from the database.

// Both children answer the same question before they read anything: is this process pointed at the
// local Docker store? A child that quietly ran against a hosted project would report a read it never
// owed to the store it was supposed to prove.
function localTargetRefusal() {
  if (!isLivePostgres || !supabaseAdmin) return 'target is not live PostgreSQL with a REST client';
  if (!(nabinEnv && nabinEnv.restLocal === true)) return 'nabinEnv.restLocal is not true';
  let host = '';
  try { host = new URL(process.env.SUPABASE_URL).hostname; } catch (err) { host = `(unparsable: ${err.message})`; }
  if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/.test(host)) {
    return `SUPABASE_URL host ${host} is not loopback`;
  }
  return null;
}

async function runRestartChild(merchantId, tableNumber, invoiceNumber) {
  const reason = localTargetRefusal();
  if (reason) {
    console.log(`RMS_RESTART_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason })}`);
    process.exit(0);
  }
  const RestaurantManagementRepository = require('./src/repositories/RestaurantManagementRepository');
  const repo = new RestaurantManagementRepository({
    merchants: [{ id: merchantId, name: 'Heritage Diner' }]
  });
  const settings = await repo.getSettings(merchantId);
  const tables = await repo.getTables(merchantId);
  const found = tables.find((t) => (t.table_number || t.tableNumber) === tableNumber);
  // Search rather than fetch-by-id: the parent only hands over the invoice number, so a child that
  // reads the bill back has read it out of the store. Tenders come along on the same document, from
  // restaurant_bill_payments, because that is where 043 puts them.
  const bills = await repo.searchBills(merchantId, { invoiceNumber });
  const bill = bills[0] || null;
  console.log(`RMS_RESTART_VERDICT ${JSON.stringify({
    refused: false,
    pid: process.pid,
    taxRatePercent: settings && settings.taxRatePercent,
    upiId: settings && settings.upiId,
    tableCount: tables.length,
    tableFound: Boolean(found),
    tablesSource: repo.dataSourceFor('tables'),
    billsSource: repo.dataSourceFor('bills'),
    billCount: bills.length,
    billTotal: bill && bill.totalAmount,
    billPaid: bill && bill.paidAmount,
    billBalance: bill && bill.balanceAmount,
    billStatus: bill && bill.status,
    billItemNames: bill && bill.items.map(i => i.name),
    paymentCount: bill && bill.payments.length,
    tenderSum: bill && Math.round(bill.payments.reduce((s, p) => s + p.amount, 0) * 100) / 100
  })}`);
  process.exit(0);
}

// ------------------------------------------------------------------ ops child
//
// The four domains that were Map collections until this round: the kitchen board, the reservation
// book, the staff list, and the takeaway handover columns on an order row. Nothing here was handed
// a Map — only ids — so every finding below is a read out of PostgreSQL by a process the parent
// never gave the data to.

async function runOpsChild(merchantId, ticketId, bookingId, activeStaffId, deactivatedStaffId, takeawayOrderId) {
  const reason = localTargetRefusal();
  if (reason) {
    console.log(`RMS_OPS_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason })}`);
    process.exit(0);
  }
  const repo = new RestaurantManagementRepository({ merchants: [{ id: merchantId, name: 'Heritage Diner' }] });

  const tickets = await repo.getKdsTickets(merchantId);
  const ticket = tickets.find((t) => String(t.id) === String(ticketId)) || null;

  const bookings = await repo.getReservations(merchantId);
  const booking = bookings.find((r) => String(r.id) === String(bookingId)) || null;

  const staff = await repo.getStaff(merchantId);

  // The handover is columns on the orders row rather than a table of its own, and no RMS read
  // method projects them — so the row is read directly. That still proves the write: this process
  // never held the order.
  const pg = new Client(PG_URL);
  await pg.connect();
  const order = (await pg.query(
    'SELECT handover_by, handover_at, order_state FROM orders WHERE id = $1 AND merchant_id = $2',
    [takeawayOrderId, merchantId]
  )).rows[0] || {};
  await pg.end();

  console.log(`RMS_OPS_VERDICT ${JSON.stringify({
    refused: false,
    pid: process.pid,
    kdsSource: repo.dataSourceFor('kds'),
    reservationsSource: repo.dataSourceFor('reservations'),
    staffSource: repo.dataSourceFor('staff'),
    ticketFound: Boolean(ticket),
    ticketStatus: ticket && ticket.status,
    ticketNumber: ticket && (ticket.ticket_number || ticket.ticketNumber),
    ticketItems: ticket && ticket.items.length,
    bookingFound: Boolean(booking),
    bookingStatus: booking && booking.status,
    activeStaffFound: staff.some((s) => String(s.id) === String(activeStaffId)),
    deactivatedFound: staff.some((s) => String(s.id) === String(deactivatedStaffId)),
    handoverBy: order.handover_by ?? null,
    handoverStamped: Boolean(order.handover_at),
    handoverOrderState: order.order_state ?? null
  })}`);
  process.exit(0);
}

// ----------------------------------------------------------------- sales child
//
// A process handed a merchant id and an invoice number and nothing else. Its Maps start empty and
// are still empty when it prints, so every figure it reports was summed by PostgreSQL over rows —
// and the SQL it is compared against is written out here from 043:1844-1888, because an aggregate
// checked against itself proves nothing about the rows behind it.

async function runSalesChild(merchantId, invoiceNumber) {
  const reason = localTargetRefusal();
  if (reason) {
    console.log(`RMS_SALES_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason })}`);
    process.exit(0);
  }
  const repo = new RestaurantManagementRepository({ merchants: [{ id: merchantId, name: 'Heritage Diner' }] });
  const billsHeldBefore = repo._bills.size;
  const ordersHeldBefore = repo._orders.size;

  // Counting the calls that reach the store is what lets the reversed-period probe be shown to be
  // refused before one happens, rather than only claimed by the order of lines in the method body.
  let storeCalls = 0;
  const realRpc = repo._rpc;
  repo._rpc = function counted(what, name, args) {
    storeCalls += 1;
    return realRpc.call(this, what, name, args);
  };

  const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const pg = new Client(PG_URL);
  await pg.connect();
  const one = async (sql, params) => (await pg.query(sql, params)).rows[0];
  // The function's own three exclusions, restated: a VOIDED bill is not a sale, a REJECTED or
  // CANCELLED order is not a sale, and a created_at outside the window is not in the period.
  const bills = await one(
    'SELECT COUNT(*)::int AS n, ROUND(COALESCE(SUM(total_amount), 0), 2) AS gross,'
    + ' ROUND(COALESCE(SUM(tax_amount), 0), 2) AS tax,'
    + ' ROUND(COALESCE(SUM(service_charge), 0), 2) AS service,'
    + ' ROUND(COALESCE(SUM(packaging_fee), 0), 2) AS packaging,'
    + ' ROUND(COALESCE(SUM(GREATEST(total_amount - paid_amount + refunded_amount, 0)), 0), 2) AS outstanding,'
    + " COUNT(*) FILTER (WHERE status = 'PAID')::int AS paid,"
    + " COUNT(*) FILTER (WHERE status = 'UNPAID')::int AS unpaid,"
    + " COUNT(*) FILTER (WHERE status = 'PARTIALLY_PAID')::int AS partial"
    + ' FROM restaurant_bills WHERE merchant_id = $1 AND status <> \'VOIDED\''
    + " AND created_at >= TIMESTAMPTZ '1970-01-01T00:00:00+00'",
    [merchantId]
  );
  const orders = await one(
    'SELECT COUNT(*)::int AS n, ROUND(COALESCE(SUM(total_amount), 0), 2) AS gross,'
    + ' ROUND(COALESCE(SUM(COALESCE(tax_amount, 0)), 0), 2) AS tax,'
    + ' ROUND(COALESCE(SUM(COALESCE(service_charge_amount, 0)), 0), 2) AS service,'
    + ' ROUND(COALESCE(SUM(COALESCE(packaging_fee_amount, 0)), 0), 2) AS packaging'
    + ' FROM orders WHERE merchant_id = $1'
    + " AND COALESCE(order_channel, 'DELIVERY') <> 'DINE_IN'"
    + " AND order_state NOT IN ('REJECTED', 'CANCELLED')"
    + " AND created_at >= TIMESTAMPTZ '1970-01-01T00:00:00+00'",
    [merchantId]
  );
  const dineIn = await one(
    'SELECT COUNT(*)::int AS n FROM orders WHERE merchant_id = $1'
    + " AND order_channel = 'DINE_IN' AND order_state NOT IN ('REJECTED', 'CANCELLED')"
    + " AND created_at >= TIMESTAMPTZ '1970-01-01T00:00:00+00'",
    [merchantId]
  );
  const pay = await one(
    'SELECT ROUND(COALESCE(SUM(effective_credited), 0), 2) AS credited,'
    + " ROUND(COALESCE(SUM(effective_credited) FILTER (WHERE payment_method = 'UPI'), 0), 2) AS upi"
    + ' FROM restaurant_bill_payments WHERE merchant_id = $1'
    + " AND created_at >= TIMESTAMPTZ '1970-01-01T00:00:00+00'",
    [merchantId]
  );
  const refunds = await one(
    'SELECT ROUND(COALESCE(SUM(amount), 0), 2) AS n FROM restaurant_refunds'
    + ' WHERE merchant_id = $1 AND created_at >= TIMESTAMPTZ \'1970-01-01T00:00:00+00\'',
    [merchantId]
  );
  const own = await one(
    'SELECT total_amount FROM restaurant_bills'
    + " WHERE merchant_id = $1 AND invoice_number = $2 AND status <> 'VOIDED'",
    [merchantId, invoiceNumber]
  );
  // A window this merchant's rows cannot be inside, built from the store rather than from a
  // guessed calendar: nothing is ever created after the newest thing already there.
  const latest = await one(
    'SELECT (SELECT MAX(created_at) FROM restaurant_bills WHERE merchant_id = $1) AS b,'
    + ' (SELECT MAX(created_at) FROM orders WHERE merchant_id = $1) AS o',
    [merchantId]
  );
  await pg.end();

  const DAY = 86400000;
  const newest = Math.max(Number(new Date(latest.b)) || 0, Number(new Date(latest.o)) || 0);
  const gap = {
    startDate: new Date(newest + DAY).toISOString(),
    endDate: new Date(newest + 2 * DAY).toISOString()
  };

  const gross = r2(Number(bills.gross) + Number(orders.gross));
  const totalOrders = dineIn.n + orders.n;
  const sql = {
    billCount: bills.n,
    billGross: r2(bills.gross),
    gross,
    tax: r2(Number(bills.tax) + Number(orders.tax)),
    service: r2(Number(bills.service) + Number(orders.service)),
    packaging: r2(Number(bills.packaging) + Number(orders.packaging)),
    net: Math.max(0, r2(gross - Number(bills.tax) - Number(bills.service) - Number(orders.tax) - Number(orders.service))),
    aov: totalOrders > 0 ? r2(gross / totalOrders) : 0,
    outstanding: r2(bills.outstanding),
    collections: r2(pay.credited),
    refunds: r2(refunds.n),
    upiAmount: r2(pay.upi),
    orderCount: orders.n,
    dineInOrders: dineIn.n,
    paidBills: bills.paid,
    unpaidBills: bills.unpaid,
    partiallyPaidBills: bills.partial
  };

  const full = await repo.getSalesReport(merchantId, {});
  const fullStoreCalls = storeCalls;
  const windowed = await repo.getSalesReport(merchantId, gap);
  const beforeInvalid = storeCalls;
  let invalid = { threw: false, storeCalls: 0 };
  try {
    await repo.getSalesReport(merchantId, { startDate: gap.endDate, endDate: gap.startDate });
  } catch (err) {
    invalid = {
      threw: true,
      code: err.code,
      statusCode: err.statusCode,
      storeFailure: Boolean(err.storeFailure)
    };
  }
  invalid.storeCalls = storeCalls - beforeInvalid;
  const channel = await repo.getChannelSalesReport(merchantId);

  console.log(`RMS_SALES_VERDICT ${JSON.stringify({
    refused: false,
    pid: process.pid,
    billsHeldBefore,
    ordersHeldBefore,
    billsHeldAfter: repo._bills.size,
    ordersHeldAfter: repo._orders.size,
    sql,
    ownInvoice: own ? invoiceNumber : null,
    ownTotal: own ? r2(own.total_amount) : null,
    grossWithoutOwn: r2(gross - (own ? Number(own.total_amount) : 0)),
    fullStoreCalls,
    invalid,
    gap,
    report: {
      grossSales: full.summary.gross_sales,
      totalBills: full.summary.total_bills,
      paidBills: full.summary.paid_bills,
      unpaidBills: full.summary.unpaid_bills,
      partiallyPaidBills: full.summary.partially_paid_bills,
      totalOrders: full.summary.total_orders,
      totalTax: full.summary.total_tax,
      totalServiceCharge: full.summary.total_service_charge,
      totalPackagingFee: full.summary.total_packaging_fee,
      netSales: full.summary.net_sales,
      averageOrderValue: full.summary.average_order_value,
      collections: full.summary.total_recorded_collections,
      outstanding: full.summary.total_outstanding_balance,
      refunds: full.summary.total_refunds_recorded,
      itemNames: full.item_sales.map((i) => i.name),
      disclaimer: full.disclaimer,
      upiVerificationNote: full.payment_methods.UPI.verificationNote,
      upiAmount: full.payment_methods.UPI.recordedAmount
    },
    window: {
      startDate: windowed.startDate,
      grossSales: windowed.summary.gross_sales,
      totalBills: windowed.summary.total_bills,
      collections: windowed.summary.total_recorded_collections,
      itemCount: windowed.item_sales.length
    },
    channel: {
      grossSales: channel.summary.gross_sales,
      dineInCount: channel.by_channel.DINE_IN.orders_count,
      dineInSales: channel.by_channel.DINE_IN.total_amount,
      methodsSum: r2(Object.values(channel.payments_by_method).reduce((a, b) => a + Number(b || 0), 0))
    }
  })}`);
  process.exit(0);
}

if (process.argv[2] === '--restart-child') {
  runRestartChild(process.argv[3], process.argv[4], process.argv[5]).catch((err) => {
    console.log(`RMS_RESTART_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason: `child crashed: ${err && err.message}` })}`);
    process.exit(0);
  });
} else if (process.argv[2] === '--sales-child') {
  runSalesChild(process.argv[3], process.argv[4]).catch((err) => {
    console.log(`RMS_SALES_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason: `child crashed: ${err && err.message}` })}`);
    process.exit(0);
  });
} else if (process.argv[2] === '--ops-child') {
  runOpsChild(process.argv[3], process.argv[4], process.argv[5], process.argv[6], process.argv[7], process.argv[8]).catch((err) => {
    console.log(`RMS_OPS_VERDICT ${JSON.stringify({ refused: true, pid: process.pid, reason: `child crashed: ${err && err.message}` })}`);
    process.exit(0);
  });
} else {
  run().catch((err) => {
    console.error('Fatal Test Failure:', err.message);
    process.exit(1);
  });
}
