/*
 * NABIN Platform — Refund Reversal Symmetry Test (P4-3)
 *
 * The contract this suite pins, in one sentence: a refund must book the exact mirror of the capture it
 * reverses, because a ledger that reverses a different account than it credited never settles.
 *
 * Migration 039 made `capture_payment_atomic` service-aware: a FOOD or GROCERY capture books
 *   DEBIT  PAYMENT_GATEWAY_ESCROW   (the clearing asset the gateway actually funded)
 *   CREDIT MERCHANT_PAYABLE        (the platform now owes the merchant, not the customer)
 * while a RIDE/PARCEL capture credits CUSTOMER_WALLET_LIABILITY. `refund_payment_atomic` was left
 * hardcoded to the RIDE legs — it always debits CUSTOMER_WALLET_LIABILITY and credits the escrow. For a
 * FOOD/GROCERY capture that is two errors in one posting: it debits a liability the capture never
 * credited (a phantom customer debit), and it leaves MERCHANT_PAYABLE credited forever for money the
 * platform no longer owes. `/api/admin/finance/refund` reaches that path today through
 * `PaymentRepository.refundPaymentAtomic`, so a support agent settling a bad food order mis-states both
 * accounts while the HTTP call reports success.
 *
 * Every assertion below reads PostgreSQL durable rows (journal_transactions/journal_lines/
 * ledger_entries), never an RPC response body, and the suite refuses a non-loopback target at load.
 * RIDE legs are asserted unchanged on purpose: they are the branch the existing reconciliation suite
 * (REC-13/REC-15) already pins, so the fix must be a no-op there or it is a regression, not a repair.
 */
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite books and reverses money through the supabaseAdmin handle and asserts through its
// own pg handle, so BOTH must resolve to one declared loopback store — never an address typed into this
// file, which is what let a run write one store and read another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'order_refund_reversal_symmetry_test' });
const PG = PG_TARGET.connectionString;
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;

if (!LOOPBACK.test(new URL(PG).hostname) || !LOOPBACK.test(new URL(BASE).hostname)) {
  console.error('ORS REFUSED: non-loopback target');
  process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !LOOPBACK.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('ORS REFUSED: SUPABASE_URL points to a non-loopback host ('
    + new URL(process.env.SUPABASE_URL).hostname + '), while PG reads 127.0.0.1. Run through scripts/with_local_target.js.');
  process.exit(1);
}

const STAMP = Date.now();
const results = [];

function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''));
}

// Money compared in whole paise: NUMERIC comes back as a string and float addition must never decide
// whether a ledger balances.
const paise = (v) => Math.round(Number(v) * 100);

(async () => {
  if (!isLivePostgres || !supabaseAdmin) {
    console.error('SKIP: requires live PostgreSQL connection');
    process.exit(1);
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const many = async (sql, p) => (await c.query(sql, p)).rows;
  const run = async (sql, p) => c.query(sql, p);

  const legsFor = (refId, category) => many(`
    SELECT jt.transaction_id, jl.account_code, jl.entry_type, jl.amount::text AS amount,
           jl.entity_type, jl.entity_id
    FROM journal_transactions jt
    JOIN journal_lines jl ON jl.journal_id = jt.id
    WHERE jt.reference_id = $1 AND jt.category = $2
    ORDER BY jt.created_at, jl.entry_type, jl.account_code`, [refId, category]);

  const book1For = (refId, category) => many(`
    SELECT entry_id, category, debit_account, credit_account, amount::text AS amount
    FROM ledger_entries WHERE reference_id = $1 AND category = $2
    ORDER BY created_at`, [refId, category]);

  const debitOf = (rows, account) => rows.filter(r => r.entry_type === 'DEBIT' && r.account_code === account);
  const creditOf = (rows, account) => rows.filter(r => r.entry_type === 'CREDIT' && r.account_code === account);
  const creditLegs = (rows) => rows.filter(r => r.entry_type === 'CREDIT');
  const netByAccount = (rows) => rows.reduce((acc, r) => {
    acc[r.account_code] = (acc[r.account_code] || 0) + (r.entry_type === 'DEBIT' ? paise(r.amount) : -paise(r.amount));
    return acc;
  }, {});

  async function newSession(suffix, serviceType, amount, merchantId) {
    const orderId = `order_ors_${STAMP}_${suffix}`;
    await run(`
      INSERT INTO payment_sessions (order_id, amount, currency, service_type, status, provider, key_id, metadata)
      VALUES ($1, $2, 'INR', $3, 'INITIATED', 'RAZORPAY_SANDBOX', 'key_test', $4::jsonb)`,
      [orderId, amount, serviceType, merchantId ? JSON.stringify({ merchant_id: merchantId }) : '{}']);
    return orderId;
  }

  async function capture(orderId, suffix, extra = {}) {
    const res = await supabaseAdmin.rpc('capture_payment_atomic', {
      p_order_id: orderId,
      p_payment_id: `pay_ors_${STAMP}_${suffix}`,
      p_customer: null,
      p_service: extra.service || null,
      p_method: 'UPI',
      p_signature_valid: true,
      p_provider: 'RAZORPAY_SANDBOX',
      p_declared_amount: null,
      ...extra.rpc
    });
    if (res.error) throw new Error(`capture failed for ${suffix}: ${res.error.message}`);
    return res.data;
  }

  async function refund(identifier, eventId, amount, ticketId) {
    const res = await supabaseAdmin.rpc('refund_payment_atomic', {
      p_order_or_payment: identifier,
      p_refund_event_id: eventId,
      p_reason: 'Paid order refunded',
      p_authorized_by: 'TEST_SUITE',
      p_provider: 'RAZORPAY_SANDBOX',
      p_declared_amount: amount === null ? null : amount,
      p_ticket_id: ticketId || null
    });
    if (res.error) throw new Error(`refund failed for ${eventId}: ${res.error.message}`);
    return res.data;
  }

  const MERCHANT_FOOD = `ors_merchant_food_${STAMP}`;
  const MERCHANT_GROCERY = `ors_merchant_gro_${STAMP}`;
  let foodOrder, foodPay, foodCaptureLegs, refundLegs, refundBook1;

  try {
    // ======================================================================
    // SCENE A — a captured FOOD order is refunded in full
    // ======================================================================
    foodOrder = await newSession('food', 'FOOD', 350.00, MERCHANT_FOOD);
    const capA = await capture(foodOrder, 'food', { service: 'FOOD' });
    foodPay = capA.paymentId;
    foodCaptureLegs = await legsFor(foodOrder, 'PAYMENT_CAPTURE');

    // ORS-01 Precondition, and the reason the rest of the suite means anything: the FOOD capture booked
    // the merchant leg. If this is false the fixture is wrong, not the refund.
    check('ORS-01', 'FOOD capture books DEBIT escrow / CREDIT MERCHANT_PAYABLE with the merchant entity',
      capA.success === true && debitOf(foodCaptureLegs, 'PAYMENT_GATEWAY_ESCROW').length === 1
      && creditLegs(foodCaptureLegs).length === 1
      && creditLegs(foodCaptureLegs)[0].account_code === 'MERCHANT_PAYABLE'
      && Number(creditLegs(foodCaptureLegs)[0].amount) === 350
      && creditLegs(foodCaptureLegs)[0].entity_type === 'MERCHANT'
      && creditLegs(foodCaptureLegs)[0].entity_id === MERCHANT_FOOD,
      { captureLegs: foodCaptureLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`) });

    const refA = await refund(foodPay, `evt_ors_full_${STAMP}`, null);

    // ORS-02 The refund itself succeeded and returned the whole captured amount.
    check('ORS-02', 'full refund of a captured FOOD payment succeeds for the whole amount',
      refA.success === true && refA.duplicate === false && Number(refA.refundAmount) === 350
      && refA.status === 'REFUNDED',
      { success: refA.success, refundAmount: refA.refundAmount, status: refA.status });

    refundLegs = await legsFor(foodOrder, 'DISPUTE_REFUND');
    refundBook1 = await book1For(foodOrder, 'DISPUTE_REFUND');

    // ORS-03 THE DEFECT: the reversal must debit the account the capture credited.
    check('ORS-03', 'FOOD refund DEBITs the account its capture CREDITed (MERCHANT_PAYABLE)',
      debitOf(refundLegs, 'MERCHANT_PAYABLE').length === 1
      && creditOf(refundLegs, 'PAYMENT_GATEWAY_ESCROW').length === 1,
      { refundLegs: refundLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`),
        captureCredit: creditLegs(foodCaptureLegs)[0] && creditLegs(foodCaptureLegs)[0].account_code });

    // ORS-04 The escrow leg is the money leaving the clearing account; it stays a credit either way.
    const refundEscrowCredit = creditOf(refundLegs, 'PAYMENT_GATEWAY_ESCROW')[0];
    check('ORS-04', 'FOOD refund credits the gateway escrow for exactly the captured 350.00',
      creditOf(refundLegs, 'PAYMENT_GATEWAY_ESCROW').length === 1
      && paise(refundEscrowCredit && refundEscrowCredit.amount) === paise(350),
      { escrowCredit: refundEscrowCredit && refundEscrowCredit.amount });

    // ORS-05 The accounting payoff: capture and refund cancel to zero on every account they touched.
    const netA = netByAccount([...foodCaptureLegs, ...refundLegs]);
    check('ORS-05', 'FOOD capture plus its full refund net to zero on every account',
      Object.keys(netA).length > 0 && Object.values(netA).every(v => v === 0),
      { netPaise: netA });

    // ORS-06 No phantom: a FOOD order must leave the customer liability untouched. It was never credited
    // by this capture, so debiting it is a posting the books cannot explain.
    check('ORS-06', 'FOOD refund writes no CUSTOMER_WALLET_LIABILITY leg',
      refundLegs.every(l => l.account_code !== 'CUSTOMER_WALLET_LIABILITY')
      && (await legsFor(foodOrder, 'PAYMENT_CAPTURE')).every(l => l.account_code !== 'CUSTOMER_WALLET_LIABILITY'),
      { accounts: [...new Set(refundLegs.map(l => l.account_code))] });

    // ORS-07 The entity follows the account: the reversal is against the merchant the capture named.
    const refundMerchantDebit = debitOf(refundLegs, 'MERCHANT_PAYABLE')[0];
    check('ORS-07', 'FOOD refund DEBIT leg carries the merchant entity the capture credited',
      Boolean(refundMerchantDebit) && refundMerchantDebit.entity_type === 'MERCHANT'
      && refundMerchantDebit.entity_id === MERCHANT_FOOD,
      { entity: refundMerchantDebit && `${refundMerchantDebit.entity_type}/${refundMerchantDebit.entity_id}` });

    // ORS-08 Book 1 must mirror Book 2 or the two books disagree about who is owed.
    const capBook1 = await book1For(foodOrder, 'FOOD_PAYMENT_CAPTURE');
    check('ORS-08', 'Book 1 refund row debits the same account Book 1 capture credited',
      capBook1.length === 1 && refundBook1.length === 1
      && refundBook1[0].debit_account === capBook1[0].credit_account
      && refundBook1[0].credit_account === 'PAYMENT_GATEWAY_ESCROW'
      && paise(refundBook1[0].amount) === paise(capBook1[0].amount),
      { capture: capBook1[0] && `${capBook1[0].debit_account}->${capBook1[0].credit_account}`,
        refund: refundBook1[0] && `${refundBook1[0].debit_account}->${refundBook1[0].credit_account}` });

    // ORS-09 The category stays what the reconciliation and authority suites read.
    check('ORS-09', 'FOOD refund posts two balanced lines plus one Book 1 row under DISPUTE_REFUND',
      refundLegs.length === 2 && refundBook1.length === 1
      && refundBook1[0].category === 'DISPUTE_REFUND',
      { journalLines: refundLegs.length, book1Category: refundBook1[0] && refundBook1[0].category });

    // ======================================================================
    // SCENE B — GROCERY, refunded in two partials
    // ======================================================================
    const groOrder = await newSession('gro', 'GROCERY', 220.00, MERCHANT_GROCERY);
    const capB = await capture(groOrder, 'gro', { service: 'GROCERY' });
    const groCaptureLegs = await legsFor(groOrder, 'PAYMENT_CAPTURE');
    const groCreditAccount = creditLegs(groCaptureLegs)[0] && creditLegs(groCaptureLegs)[0].account_code;

    // ORS-10 GROCERY behaves exactly like FOOD (the capture branches on IN ('FOOD','GROCERY')).
    check('ORS-10', 'GROCERY capture credits MERCHANT_PAYABLE under the grocery merchant entity',
      capB.success === true && groCreditAccount === 'MERCHANT_PAYABLE'
      && creditLegs(groCaptureLegs)[0].entity_id === MERCHANT_GROCERY,
      { creditAccount: groCreditAccount });

    await refund(capB.paymentId, `evt_ors_gro_p1_${STAMP}`, 90.00);
    const partial1 = await legsFor(groOrder, 'DISPUTE_REFUND');

    // ORS-11 A partial reverses the same account for only the partial amount.
    check('ORS-11', 'GROCERY partial refund debits MERCHANT_PAYABLE for exactly the partial amount',
      debitOf(partial1, 'MERCHANT_PAYABLE').length === 1
      && paise(debitOf(partial1, 'MERCHANT_PAYABLE')[0].amount) === 9000
      && partial1.every(l => l.account_code !== 'CUSTOMER_WALLET_LIABILITY'),
      { legs: partial1.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`) });

    await refund(capB.paymentId, `evt_ors_gro_p2_${STAMP}`, 130.00);
    const partialsAll = await legsFor(groOrder, 'DISPUTE_REFUND');
    const netB = netByAccount([...groCaptureLegs, ...partialsAll]);

    // ORS-12 Two partials that sum to the capture settle the order to zero on every account.
    check('ORS-12', 'two GROCERY partial refunds settle the order to zero across all accounts',
      partialsAll.length === 4 && Object.values(netB).every(v => v === 0),
      { netPaise: netB, refundLines: partialsAll.length });

    // ORS-13 The merchant is owed the un-refunded remainder and nothing more: 220 booked, 90 reversed.
    const owedPaise = partialsAll.filter(l => l.entry_type === 'DEBIT' && l.account_code === 'MERCHANT_PAYABLE')
      .reduce((s, l) => s + paise(l.amount), 0);
    check('ORS-13', 'reversed merchant payable equals the refunded total (220 booked - 130-90 reversed)',
      paise(220) - owedPaise === 0 && owedPaise === 22000,
      { reversedPaise: owedPaise });

    // ======================================================================
    // SCENE C — RIDE must be unchanged (the branch REC-13/15 already pins)
    // ======================================================================
    const rideOrder = await newSession('ride', 'RIDE', 175.00, null);
    const capC = await capture(rideOrder, 'ride', { service: 'RIDE' });
    const rideCaptureLegs = await legsFor(rideOrder, 'PAYMENT_CAPTURE');
    const refC = await refund(capC.paymentId, `evt_ors_ride_${STAMP}`, null);
    const rideRefundLegs = await legsFor(rideOrder, 'DISPUTE_REFUND');

    // ORS-14 RIDE refunds debit customer liability, exactly as today: this fix must not touch it.
    check('ORS-14', 'RIDE refund legs are unchanged (DEBIT CUSTOMER_WALLET_LIABILITY / CREDIT escrow)',
      capC.success === true && refC.success === true
      && creditLegs(rideCaptureLegs)[0].account_code === 'CUSTOMER_WALLET_LIABILITY'
      && debitOf(rideRefundLegs, 'CUSTOMER_WALLET_LIABILITY').length === 1
      && creditOf(rideRefundLegs, 'PAYMENT_GATEWAY_ESCROW').length === 1
      && paise(debitOf(rideRefundLegs, 'CUSTOMER_WALLET_LIABILITY')[0].amount) === 17500,
      { legs: rideRefundLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`) });

    // ORS-15 The RIDE order settles to zero on both accounts it touched.
    const netC = netByAccount([...rideCaptureLegs, ...rideRefundLegs]);
    check('ORS-15', 'RIDE capture plus its refund nets to zero on every account',
      Object.values(netC).every(v => v === 0) && Object.keys(netC).length === 2,
      { netPaise: netC });

    // ORS-16 The RIDE reversal still carries the customer entity, not a merchant one.
    const rideDebit = debitOf(rideRefundLegs, 'CUSTOMER_WALLET_LIABILITY')[0];
    check('ORS-16', 'RIDE refund DEBIT leg keeps entity CUSTOMER',
      Boolean(rideDebit) && rideDebit.entity_type === 'CUSTOMER',
      { entity: rideDebit && `${rideDebit.entity_type}/${rideDebit.entity_id}` });

    // ======================================================================
    // SCENE D — addressing, replay, and the two derivation fallbacks
    // ======================================================================
    const lineCount = (refId) => one(`SELECT count(*)::int AS n FROM journal_lines jl
      JOIN journal_transactions jt ON jt.id = jl.journal_id WHERE jt.reference_id = $1`, [refId]);

    // One fixture serves three checks: a GROCERY order refunded by its gateway ORDER id with an explicit
    // partial amount. Addressing by order id is the route a support agent reaches, and the explicit amount
    // is what makes the replay below a replay rather than a different request.
    const groOrder2 = await newSession('gro2', 'GROCERY', 500.00, MERCHANT_GROCERY);
    const capD = await capture(groOrder2, 'gro2', { service: 'GROCERY' });
    const refByOrder = await refund(groOrder2, `evt_ors_byorder_${STAMP}`, 125.00);
    const byOrderLegs = await legsFor(groOrder2, 'DISPUTE_REFUND');

    // ORS-17 Derivation must work from either identifier — this one resolves the payment through
    // gateway_order_id, so the merchant leg has to come off the same capture journal.
    check('ORS-17', 'refunding by gateway order id derives the merchant leg the capture credited',
      capD.success === true && refByOrder.success === true
      && debitOf(byOrderLegs, 'MERCHANT_PAYABLE').length === 1
      && paise(debitOf(byOrderLegs, 'MERCHANT_PAYABLE')[0].amount) === 12500,
      { legs: byOrderLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`) });

    // ORS-18 The identical request replayed under the same event id is a duplicate: it reports the
    // original amount and adds no leg. Replaying here by PAYMENT id (the first call used the order id)
    // also proves both identifiers resolve to the one authorization record.
    const linesBeforeReplay = await lineCount(groOrder2);
    const replayD = await refund(capD.paymentId, `evt_ors_byorder_${STAMP}`, 125.00);
    const linesAfterReplay = await lineCount(groOrder2);
    check('ORS-18', 'replaying a refund with its original event id and amount returns duplicate:true and adds zero lines',
      replayD.success === true && replayD.duplicate === true
      && Number(replayD.refundAmount) === 125 && replayD.paymentId === capD.paymentId
      && linesBeforeReplay.n === linesAfterReplay.n,
      { duplicate: replayD.duplicate, refundAmount: replayD.refundAmount,
        lines: [linesBeforeReplay.n, linesAfterReplay.n] });

    // ORS-19 And the mirror of that: the SAME event id replayed with a DIFFERENT amount must be refused.
    // The FOOD refund was booked as "whatever remains" (350.00) and the balance is now drained, so a NULL
    // replay recomputes to 0.00 — a different request, and the idempotency record is the only thing
    // standing between a support agent and a second posting for one event.
    const linesBeforeConflict = await lineCount(foodOrder);
    const replayNull = await refund(foodPay, `evt_ors_full_${STAMP}`, null);
    const linesAfterConflict = await lineCount(foodOrder);
    check('ORS-19', 'replaying the same event id with a different amount refuses with IDEMPOTENCY_CONFLICT and books nothing',
      replayNull.success === false && replayNull.code === 'IDEMPOTENCY_CONFLICT'
      && linesBeforeConflict.n === linesAfterConflict.n,
      { code: replayNull.code, success: replayNull.success,
        lines: [linesBeforeConflict.n, linesAfterConflict.n] });

    // ORS-20 A capture booked before migration 039 exists in Book 1 only. The reversal has to read the
    // account from there rather than invent the RIDE default.
    const legacyOrder = `order_ors_legacy_${STAMP}`;
    const legacyPay = `pay_ors_legacy_${STAMP}`;
    const legacyEntry = `LEDGL_ORS_${STAMP}`;
    await run(`
      INSERT INTO payment_sessions (order_id, amount, currency, service_type, status, provider, key_id, metadata)
      VALUES ($1, 260.00, 'INR', 'FOOD', 'SUCCESS', 'RAZORPAY_SANDBOX', 'key_test', $2::jsonb)`,
      [legacyOrder, JSON.stringify({ merchant_id: MERCHANT_FOOD })]);
    await run(`
      INSERT INTO payments (payment_id, idempotency_key, gateway_order_id, amount, currency, method, status)
      VALUES ($1, $2, $3, 260.00, 'INR', 'UPI', 'CAPTURED')`, [legacyPay, `${legacyOrder}:${legacyPay}`, legacyOrder]);
    await run(`
      INSERT INTO ledger_entries (entry_id, category, debit_account, credit_account, amount, currency, description, reference_id)
      VALUES ($1, 'FOOD_PAYMENT_CAPTURE', 'PAYMENT_GATEWAY_ESCROW', 'MERCHANT_PAYABLE', 260.00, 'INR',
              'pre-039 capture, Book 1 only', $2)`, [legacyEntry, legacyOrder]);
    const refE = await refund(legacyPay, `evt_ors_legacy_${STAMP}`, null);
    const legacyLegs = await legsFor(legacyOrder, 'DISPUTE_REFUND');
    check('ORS-20', 'refund of a Book-1-only FOOD capture derives MERCHANT_PAYABLE from Book 1',
      refE.success === true && debitOf(legacyLegs, 'MERCHANT_PAYABLE').length === 1
      && paise(debitOf(legacyLegs, 'MERCHANT_PAYABLE')[0].amount) === 26000
      && debitOf(legacyLegs, 'MERCHANT_PAYABLE')[0].entity_type === 'MERCHANT',
      { legs: legacyLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}:${l.entity_type}`) });

    // ORS-21 With no capture record in either book there is nothing to mirror, and the refund must stay
    // exactly what it is today rather than failing on a derivation that has no evidence.
    const bareOrder = `order_ors_bare_${STAMP}`;
    const barePay = `pay_ors_bare_${STAMP}`;
    await run(`
      INSERT INTO payments (payment_id, idempotency_key, gateway_order_id, amount, currency, method, status)
      VALUES ($1, $2, $3, 80.00, 'INR', 'UPI', 'CAPTURED')`, [barePay, `${bareOrder}:${barePay}`, bareOrder]);
    const refF = await refund(barePay, `evt_ors_bare_${STAMP}`, null);
    const bareLegs = await legsFor(bareOrder, 'DISPUTE_REFUND');
    check('ORS-21', 'refund with no capture record falls back to CUSTOMER_WALLET_LIABILITY and balances',
      refF.success === true && debitOf(bareLegs, 'CUSTOMER_WALLET_LIABILITY').length === 1
      && creditOf(bareLegs, 'PAYMENT_GATEWAY_ESCROW').length === 1,
      { legs: bareLegs.map(l => `${l.entry_type}:${l.account_code}:${l.amount}`) });

    // ORS-22 A reversal is a NEW posting, never an edit: the capture journal is byte-identical after it.
    const capLegsAfter = await legsFor(foodOrder, 'PAYMENT_CAPTURE');
    check('ORS-22', 'the capture journal is unchanged by the refund that reverses it',
      capLegsAfter.length === foodCaptureLegs.length
      && capLegsAfter.every((l, i) => l.transaction_id === foodCaptureLegs[i].transaction_id
        && l.account_code === foodCaptureLegs[i].account_code
        && l.entry_type === foodCaptureLegs[i].entry_type
        && paise(l.amount) === paise(foodCaptureLegs[i].amount)),
      { before: foodCaptureLegs.length, after: capLegsAfter.length });

    // ORS-23 Nothing this suite booked may violate the balance invariant the CHECK enforces.
    const unbalanced = await one(`
      SELECT count(*)::int AS n FROM journal_transactions
      WHERE reference_id LIKE $1 AND total_debit <> total_credit`, [`%${STAMP}%`]);
    const asymm = await one(`
      SELECT count(*)::int AS n FROM (
        SELECT jl.journal_id FROM journal_lines jl
        JOIN journal_transactions jt ON jt.id = jl.journal_id
        WHERE jt.reference_id LIKE $1
        GROUP BY jl.journal_id
        HAVING sum(CASE WHEN jl.entry_type='DEBIT' THEN jl.amount ELSE 0 END)
            <> sum(CASE WHEN jl.entry_type='CREDIT' THEN jl.amount ELSE 0 END)) s`, [`%${STAMP}%`]);
    check('ORS-23', 'every journal this run posted balances on both levels',
      unbalanced.n === 0 && asymm.n === 0,
      { unbalancedTransactions: unbalanced.n, asymmetricalJournals: asymm.n });

    // ORS-24 The payment rows agree with the money: every refunded payment is REFUNDED with
    // refunded_amount equal to the captured amount.
    const payStates = await many(`SELECT payment_id, status, refunded_amount::text AS refunded, amount::text AS amount
      FROM payments WHERE payment_id = ANY($1::text[])`, [[foodPay, capB.paymentId, capC.paymentId]]);
    check('ORS-24', 'refunded payments carry REFUNDED with the refunded total equal to the captured amount',
      payStates.length === 3 && payStates.every(p => p.status === 'REFUNDED' && paise(p.refunded) === paise(p.amount)),
      { states: payStates.map(p => `${p.status}/${p.refunded} of ${p.amount}`) });


  } catch (err) {
    check('ORS-99', 'suite ran without an unexpected error', false, { error: String(err.message || err) });
  } finally {
    // The chain runs this link `isolated: true`, so its money rows die with the clone. Standalone it
    // books into `public`, and migration 033 makes journal/ledger/refund-authorization rows undeleteable
    // by design — a booked reversal is not test residue to sweep, it is accounting history. So this
    // reports what it wrote instead of deleting it.
    try {
      const written = await one(`
        SELECT (SELECT count(*) FROM journal_transactions WHERE reference_id LIKE $1)::int AS journals,
               (SELECT count(*) FROM journal_lines jl JOIN journal_transactions jt ON jt.id = jl.journal_id
                 WHERE jt.reference_id LIKE $1)::int AS lines,
               (SELECT count(*) FROM payment_refund_authorizations WHERE idempotency_key LIKE $1)::int AS auths,
               (SELECT count(*) FROM payments WHERE payment_id LIKE $1)::int AS payments`,
        [`%${STAMP}%`]);
      console.log(`\n[ORS] rows booked under stamp ${STAMP}: ${JSON.stringify(written)}`);
    } catch (e) {
      console.log(`[ORS] residue count unavailable: ${String(e.message || e)}`);
    }
    await c.end().catch(() => {});
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 ORDER REFUND REVERSAL SYMMETRY TEST: ${passed}/${results.length} passed, ${failed} failed`);
  console.log('='.repeat(72));
  process.exit(failed === 0 ? 0 : 1);
})();
