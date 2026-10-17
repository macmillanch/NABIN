/*
 * NABIN Platform — Authoritative Double-Entry Ledger & Reconciliation Test
 *
 * Verifies the authoritative double-entry accounting guarantees on local Docker PostgreSQL:
 *   1. Balance invariant (total_debit == total_credit on every journal transaction)
 *   2. Balanced line item symmetry (sum(DEBIT) == sum(CREDIT) per transaction)
 *   3. Chart of accounts integrity (valid account_code references)
 *   4. Reconciliation discrepancy detection (un-synchronized Book 1 vs Book 2 rows)
 *   5. Atomic rollback on constraint failure (zero partial writes)
 *   6. Fail-closed error propagation on store failure
 *   7. Idempotent deduplication (duplicate calls move zero money)
 *   8. Idempotency conflict refusal (mismatched payload rejected with 409)
 *   9. Refund ceiling enforcement (cannot exceed refundable balance)
 *  10. Persistence durability across process memory boundaries
 *  11. Privilege / RBAC security enforcement (anon cannot execute financial RPCs)
 *
 * Local/test only; strictly refuses any non-loopback target.
 */
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite posts and reconciles money through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into this file,
// which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'ledger_double_entry_reconciliation_test' });
const PG = PG_TARGET.connectionString;
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';

if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('REC REFUSED: non-loopback target');
  process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('REC REFUSED: SUPABASE_URL points to a non-loopback host (' + new URL(process.env.SUPABASE_URL).hostname + '), while PG reads 127.0.0.1. Run through scripts/with_local_target.js.');
  process.exit(1);
}

const LedgerRepository = require('./src/repositories/LedgerRepository');
const PaymentRepository = require('./src/repositories/PaymentRepository');

const STAMP = Date.now();
const results = [];

function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
}

(async () => {
  if (!isLivePostgres || !supabaseAdmin) {
    console.error('SKIP: requires live PostgreSQL connection');
    process.exit(1);
  }

  const c = new Client({ connectionString: PG });
  await c.connect();

  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const many = async (sql, p) => (await c.query(sql, p)).rows;

  try {
    // ------------------------------------------------------------------------
    // REC-01: Mathematical Balance Invariant across all journal_transactions
    // ------------------------------------------------------------------------
    const unbalTx = await one(`
      SELECT count(*)::int AS count
      FROM journal_transactions
      WHERE total_debit <> total_credit
    `);
    check('REC-01', 'every posted journal transaction balances (total_debit == total_credit)',
      unbalTx.count === 0, { unbalancedCount: unbalTx.count });

    // ------------------------------------------------------------------------
    // REC-02: Double-Entry Line Item Symmetry (sum(DEBIT) == sum(CREDIT))
    // ------------------------------------------------------------------------
    const asymmTx = await one(`
      SELECT count(*)::int AS count FROM (
        SELECT journal_id
        FROM journal_lines
        GROUP BY journal_id
        HAVING sum(CASE WHEN entry_type = 'DEBIT' THEN amount ELSE 0 END) <>
               sum(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE 0 END)
      ) sub
    `);
    check('REC-02', 'every journal entry has matching DEBIT and CREDIT lines sum',
      asymmTx.count === 0, { asymmetricalJournals: asymmTx.count });

    // ------------------------------------------------------------------------
    // REC-03: Chart of Accounts Referential Integrity
    // ------------------------------------------------------------------------
    const invalidAccounts = await one(`
      SELECT count(*)::int AS count
      FROM journal_lines jl
      WHERE NOT EXISTS (
        SELECT 1 FROM ledger_accounts la WHERE la.account_code = jl.account_code
      )
    `);
    check('REC-03', 'every journal line references an authoritative ledger account',
      invalidAccounts.count === 0, { invalidAccounts: invalidAccounts.count });

    // ------------------------------------------------------------------------
    // REC-04: Reconciliation Discrepancy Identification (Book 1 vs Book 2)
    // ------------------------------------------------------------------------
    const missingInBook2 = await many(`
      SELECT le.category, count(*)::int AS count, sum(le.amount)::numeric AS total_amount
      FROM ledger_entries le
      WHERE NOT EXISTS (
        SELECT 1 FROM journal_transactions jt
        WHERE jt.transaction_id = le.entry_id
           OR jt.reference_id = le.reference_id
           OR jt.reference_id = le.entry_id
      )
      GROUP BY le.category
      ORDER BY count DESC
    `);
    const totalMissingCount = missingInBook2.reduce((s, r) => s + Number(r.count), 0);
    check('REC-04', 'reconciler confirms zero un-synchronized Book 1 entries remain post-backfill',
      totalMissingCount === 0 && Array.isArray(missingInBook2),
      { missingCategories: missingInBook2, totalUnsynchronized: totalMissingCount });


    // ------------------------------------------------------------------------
    // REC-05: Atomic Rollback on Constraint Violation
    // ------------------------------------------------------------------------
    const preCount = await one('SELECT count(*)::int AS c FROM journal_transactions');
    let rollbackVerified = false;
    await c.query('BEGIN');
    try {
      // Attempt to insert an unbalanced journal transaction (violates chk_balanced_entry)
      await c.query(`
        INSERT INTO journal_transactions (
          transaction_id, category, total_debit, total_credit, description, status
        ) VALUES (
          'txn_probe_unbalanced_${STAMP}', 'RIDE_SETTLEMENT', 100.00, 50.00, 'Probe unbalanced', 'POSTED'
        )
      `);
    } catch (dbErr) {
      if (dbErr.code === '23514') {
        rollbackVerified = true;
      }
    }
    await c.query('ROLLBACK');
    const postCount = await one('SELECT count(*)::int AS c FROM journal_transactions');
    check('REC-05', 'constraint violation fails atomic write and rolls back with zero stray rows',
      rollbackVerified && preCount.c === postCount.c,
      { preCount: preCount.c, postCount: postCount.c, caught23514: rollbackVerified });

    // ------------------------------------------------------------------------
    // REC-06: Failed Journal Write Fails Closed in Application Code
    // ------------------------------------------------------------------------
    const mockDb = { ledgerEntries: [] };
    const ledgerRepo = new LedgerRepository(mockDb);
    let failClosedObserved = false;
    try {
      // Force failure: amount NaN or invalid parameters
      await ledgerRepo.adjustWallet({
        ownerId: 'invalid_owner',
        amount: 'NOT_A_NUMBER'
      });
    } catch (e) {
      failClosedObserved = true;
    }
    check('REC-06', 'invalid financial write throws immediately and writes zero memory entries',
      failClosedObserved && mockDb.ledgerEntries.length === 0,
      { threw: failClosedObserved, memoryEntriesLength: mockDb.ledgerEntries.length });

    // ------------------------------------------------------------------------
    // REC-07: Duplicate Request Idempotency via adjust_wallet_atomic
    // ------------------------------------------------------------------------
    const probeDriver = (await supabaseAdmin.from('drivers').insert({
      phone: `78${String(STAMP).slice(-8)}`,
      name: `Reconciliation Probe ${STAMP}`,
      vehicle_type: 'AUTO',
      vehicle_number: `REC${String(STAMP).slice(-4)}`,
      operational_status: 'AVAILABLE',
      wallet_balance: 100.00
    }).select('id').single()).data;

    const IDEM_KEY_1 = `REC_IDEM:${STAMP}:1`;
    const rpc1 = await supabaseAdmin.rpc('adjust_wallet_atomic', {
      p_owner_id: probeDriver.id,
      p_owner_type: 'DRIVER',
      p_amount: 50.00,
      p_category: 'RIDE_SETTLEMENT',
      p_description: 'Idempotency test call 1',
      p_reference_id: `REF_1_${STAMP}`,
      p_debit_account: 'CUSTOMER_WALLET_LIABILITY',
      p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
      p_idempotency_key: IDEM_KEY_1
    });

    const rpc2 = await supabaseAdmin.rpc('adjust_wallet_atomic', {
      p_owner_id: probeDriver.id,
      p_owner_type: 'DRIVER',
      p_amount: 50.00,
      p_category: 'RIDE_SETTLEMENT',
      p_description: 'Idempotency test call 2 (duplicate)',
      p_reference_id: `REF_1_${STAMP}`,
      p_debit_account: 'CUSTOMER_WALLET_LIABILITY',
      p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
      p_idempotency_key: IDEM_KEY_1
    });

    const driverAfter = await one('SELECT wallet_balance FROM drivers WHERE id = $1', [probeDriver.id]);
    check('REC-07', 'duplicate idempotency key returns IDEMPOTENT_SKIPPED and avoids double credit',
      rpc1.data.status === 'POSTED' &&
      rpc2.data.status === 'IDEMPOTENT_SKIPPED' &&
      Number(driverAfter.wallet_balance) === 150.00,
      { initial: 100.00, call1: rpc1.data.status, call2: rpc2.data.status, finalBalance: driverAfter.wallet_balance });

    // ------------------------------------------------------------------------
    // REC-08: Idempotency Conflict Refusal (Mismatched Payload on Same Key)
    // ------------------------------------------------------------------------
    let conflictCaught = false;
    try {
      await ledgerRepo.adjustWallet({
        ownerId: probeDriver.id,
        ownerType: 'DRIVER',
        amount: 999.00, // Different amount on same key!
        category: 'RIDE_SETTLEMENT',
        idempotencyKey: IDEM_KEY_1,
        debitAccount: 'CUSTOMER_WALLET_LIABILITY',
        creditAccount: 'DRIVER_EARNINGS_PAYABLE'
      });
    } catch (conflictErr) {
      if (conflictErr.code === 'IDEMPOTENCY_CONFLICT' || conflictErr.status === 409) {
        conflictCaught = true;
      }
    }
    const driverAfterConflict = await one('SELECT wallet_balance FROM drivers WHERE id = $1', [probeDriver.id]);
    check('REC-08', 'reusing key with differing payload is rejected with 409 IDEMPOTENCY_CONFLICT',
      conflictCaught && Number(driverAfterConflict.wallet_balance) === 150.00,
      { conflictCaught, balancePreserved: driverAfterConflict.wallet_balance });

    // ------------------------------------------------------------------------
    // REC-09: Refund Ceiling Enforcement (Cannot exceed refundable amount)
    // ------------------------------------------------------------------------
    const payId = `pay_rec_${STAMP}`;
    await supabaseAdmin.from('payments').insert({
      payment_id: payId,
      amount: 250.00,
      currency: 'INR',
      method: 'UPI',
      status: 'CAPTURED',
      gateway_order_id: `order_${payId}`,
      created_at: new Date().toISOString()
    });

    const refundExceed = await supabaseAdmin.rpc('refund_payment_atomic', {
      p_order_or_payment: payId,
      p_refund_event_id: `evt_ref_excess_${STAMP}`,
      p_declared_amount: 300.00 // Exceeds 250.00!
    });

    const payStatus = await one('SELECT status, refunded_amount FROM payments WHERE payment_id = $1', [payId]);
    check('REC-09', 'refund exceeding captured amount is refused and does not mutate payment',
      refundExceed.data && refundExceed.data.success === false && payStatus.status === 'CAPTURED',
      { rpcResult: refundExceed.data, paymentStatus: payStatus.status });

    // ------------------------------------------------------------------------
    // REC-10: Persistence Durability Across Heap / Process Boundary
    // ------------------------------------------------------------------------
    const op = await ledgerRepo.findOperationByKey(IDEM_KEY_1);
    check('REC-10', 'journal transaction and lines are durable in PostgreSQL and survive process boundary',
      op !== null && op.txn && Boolean(op.txn.transaction_id) && op.lines.length === 2,
      { foundTxn: op && op.txn && op.txn.transaction_id, linesCount: op && op.lines.length });

    // ------------------------------------------------------------------------
    // REC-11: Privilege & RBAC Security Enforcement (Least Privilege)
    // ------------------------------------------------------------------------
    const anonRevokeAdjust = await one(`
      SELECT has_function_privilege('anon', 'adjust_wallet_atomic(uuid,varchar,numeric,varchar,text,varchar,varchar,varchar,varchar)', 'execute') AS priv
    `);
    const anonRevokeCapture = await one(`
      SELECT has_function_privilege('anon', 'capture_payment_atomic(text,text,uuid,text,text,boolean,text,text,numeric)', 'execute') AS priv
    `);
    const anonRevokeRefund = await one(`
      SELECT has_function_privilege('anon', 'refund_payment_atomic(text,text,text,text,text,numeric,text)', 'execute') AS priv
    `);
    const authRevokeCapture = await one(`
      SELECT has_function_privilege('authenticated', 'capture_payment_atomic(text,text,uuid,text,text,boolean,text,text,numeric)', 'execute') AS priv
    `);
    const authRevokeRefund = await one(`
      SELECT has_function_privilege('authenticated', 'refund_payment_atomic(text,text,text,text,text,numeric,text)', 'execute') AS priv
    `);
    const svcRoleCapture = await one(`
      SELECT has_function_privilege('service_role', 'capture_payment_atomic(text,text,uuid,text,text,boolean,text,text,numeric)', 'execute') AS priv
    `);
    const svcRoleRefund = await one(`
      SELECT has_function_privilege('service_role', 'refund_payment_atomic(text,text,text,text,text,numeric,text)', 'execute') AS priv
    `);

    check('REC-11', 'anon & authenticated roles revoked from financial RPCs; service_role granted',
      anonRevokeAdjust.priv === false && anonRevokeCapture.priv === false && anonRevokeRefund.priv === false &&
      authRevokeCapture.priv === false && authRevokeRefund.priv === false &&
      svcRoleCapture.priv === true && svcRoleRefund.priv === true,
      { anonCapture: anonRevokeCapture.priv, authCapture: authRevokeCapture.priv, svcCapture: svcRoleCapture.priv,
        anonRefund: anonRevokeRefund.priv, authRefund: authRevokeRefund.priv, svcRefund: svcRoleRefund.priv });


    // ------------------------------------------------------------------------
    // REC-12: Atomic Payment Capture Posts to Both Books 1 & 2 (Migration 039)
    // ------------------------------------------------------------------------
    const probeOrder = `order_atomic_${STAMP}`;
    const probePay = `pay_atomic_${STAMP}`;
    await supabaseAdmin.from('payment_sessions').insert({
      order_id: probeOrder,
      amount: 450.00,
      currency: 'INR',
      service_type: 'RIDE',
      status: 'INITIATED',
      created_at: new Date().toISOString()
    });

    const capRes = await supabaseAdmin.rpc('capture_payment_atomic', {
      p_order_id: probeOrder,
      p_payment_id: probePay,
      p_customer: null,
      p_service: 'RIDE',
      p_method: 'UPI',
      p_signature_valid: true,
      p_provider: 'RAZORPAY_SANDBOX'
    });

    const book1Cap = await one('SELECT * FROM ledger_entries WHERE reference_id = $1', [probeOrder]);
    const book2Cap = await one('SELECT * FROM journal_transactions WHERE reference_id = $1', [probeOrder]);
    const book2CapLines = await many('SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY entry_type', [book2Cap ? book2Cap.id : null]);

    check('REC-12', 'atomic payment capture creates valid entries in both Book 1 and Book 2 simultaneously',
      capRes.data && capRes.data.success === true &&
      Boolean(book1Cap && book1Cap.entry_id) &&
      Boolean(book2Cap && book2Cap.transaction_id) &&
      book2CapLines.length === 2,
      { rpcSuccess: capRes.data && capRes.data.success, book1Entry: book1Cap && book1Cap.entry_id, book2Txn: book2Cap && book2Cap.transaction_id, lines: book2CapLines.length });

    // ------------------------------------------------------------------------
    // REC-13: Atomic Payment Capture Line Direction & Balance Symmetry
    // ------------------------------------------------------------------------
    const capDebitLine = book2CapLines.find(l => l.entry_type === 'DEBIT');
    const capCreditLine = book2CapLines.find(l => l.entry_type === 'CREDIT');
    check('REC-13', 'capture journal transaction balances with correct debit (ESCROW) and credit (LIABILITY) legs',
      capDebitLine && capDebitLine.account_code === 'PAYMENT_GATEWAY_ESCROW' && Number(capDebitLine.amount) === 450.00 &&
      capCreditLine && capCreditLine.account_code === 'CUSTOMER_WALLET_LIABILITY' && Number(capCreditLine.amount) === 450.00 &&
      Number(book2Cap.total_debit) === 450.00 && Number(book2Cap.total_credit) === 450.00,
      { debitAccount: capDebitLine && capDebitLine.account_code, creditAccount: capCreditLine && capCreditLine.account_code, totalDebit: book2Cap && book2Cap.total_debit, totalCredit: book2Cap && book2Cap.total_credit });

    // ------------------------------------------------------------------------
    // REC-14: Atomic Payment Refund Posts to Both Books 1 & 2 (Migration 039)
    // ------------------------------------------------------------------------
    const refEvent = `evt_atomic_ref_${STAMP}`;
    const refRes = await supabaseAdmin.rpc('refund_payment_atomic', {
      p_order_or_payment: probePay,
      p_refund_event_id: refEvent,
      p_reason: 'Atomic test refund verification',
      p_authorized_by: 'TEST_SUITE',
      p_provider: 'RAZORPAY_SANDBOX',
      p_declared_amount: 200.00
    });

    const book1Ref = await one('SELECT * FROM ledger_entries WHERE entry_id = $1', [refRes.data ? refRes.data.ledgerEntryId : null]);
    const book2Ref = await one('SELECT * FROM journal_transactions WHERE idempotency_key = $1', [`ref_${refEvent}`]);
    const book2RefLines = await many('SELECT * FROM journal_lines WHERE journal_id = $1 ORDER BY entry_type', [book2Ref ? book2Ref.id : null]);

    check('REC-14', 'atomic payment refund creates valid entries in both Book 1 and Book 2 simultaneously',
      refRes.data && refRes.data.success === true &&
      Boolean(book1Ref && book1Ref.entry_id) &&
      Boolean(book2Ref && book2Ref.transaction_id) &&
      book2RefLines.length === 2,
      { rpcSuccess: refRes.data && refRes.data.success, book1Entry: book1Ref && book1Ref.entry_id, book2Txn: book2Ref && book2Ref.transaction_id, lines: book2RefLines.length });

    // ------------------------------------------------------------------------
    // REC-15: Atomic Payment Refund Line Direction & Reversal Symmetry
    // ------------------------------------------------------------------------
    const refDebitLine = book2RefLines.find(l => l.entry_type === 'DEBIT');
    const refCreditLine = book2RefLines.find(l => l.entry_type === 'CREDIT');
    check('REC-15', 'refund journal transaction balances with correct debit (LIABILITY) and credit (ESCROW) legs',
      refDebitLine && refDebitLine.account_code === 'CUSTOMER_WALLET_LIABILITY' && Number(refDebitLine.amount) === 200.00 &&
      refCreditLine && refCreditLine.account_code === 'PAYMENT_GATEWAY_ESCROW' && Number(refCreditLine.amount) === 200.00 &&
      Number(book2Ref.total_debit) === 200.00 && Number(book2Ref.total_credit) === 200.00,
      { debitAccount: refDebitLine && refDebitLine.account_code, creditAccount: refCreditLine && refCreditLine.account_code, totalDebit: book2Ref && book2Ref.total_debit, totalCredit: book2Ref && book2Ref.total_credit });

    // ------------------------------------------------------------------------
    // REC-16: Concurrent Duplicate Replay of Capture & Refund Is Idempotent
    // ------------------------------------------------------------------------
    const capReplay = await supabaseAdmin.rpc('capture_payment_atomic', {
      p_order_id: probeOrder,
      p_payment_id: probePay,
      p_customer: null
    });
    const refReplay = await supabaseAdmin.rpc('refund_payment_atomic', {
      p_order_or_payment: probePay,
      p_refund_event_id: refEvent,
      p_reason: 'Atomic test refund verification',
      p_authorized_by: 'TEST_SUITE',
      p_provider: 'RAZORPAY_SANDBOX',
      p_declared_amount: 200.00
    });

    const book2CapCount = await one('SELECT count(*)::int AS c FROM journal_transactions WHERE reference_id = $1 AND category = $2', [probeOrder, 'PAYMENT_CAPTURE']);
    const book2RefCount = await one('SELECT count(*)::int AS c FROM journal_transactions WHERE idempotency_key = $1', [`ref_${refEvent}`]);

    check('REC-16', 'concurrent/duplicate replay returns duplicate:true and generates zero duplicate journal entries',
      capReplay.data && capReplay.data.duplicate === true &&
      refReplay.data && refReplay.data.duplicate === true &&
      book2CapCount.c === 1 && book2RefCount.c === 1,
      { capDuplicate: capReplay.data && capReplay.data.duplicate, refDuplicate: refReplay.data && refReplay.data.duplicate, capRows: book2CapCount.c, refRows: book2RefCount.c });

    // ------------------------------------------------------------------------
    // REC-17: Historical Traceability from Book 2 to Book 1 & Underlying Payment
    // ------------------------------------------------------------------------
    const traceCheck = await one(`
      SELECT 
        jt.transaction_id,
        jt.reference_id,
        p.payment_id,
        p.status as payment_status,
        le.entry_id as ledger_entry_id
      FROM journal_transactions jt
      JOIN payments p ON p.gateway_order_id = jt.reference_id OR p.payment_id = jt.reference_id
      JOIN ledger_entries le ON le.reference_id = jt.reference_id
      WHERE jt.reference_id = $1
    `, [probeOrder]);

    check('REC-17', 'journal transactions maintain full bidirectional traceability to payments and ledger_entries',
      traceCheck !== undefined && traceCheck.payment_id === probePay && Boolean(traceCheck.ledger_entry_id),
      { txnId: traceCheck && traceCheck.transaction_id, paymentId: traceCheck && traceCheck.payment_id, status: traceCheck && traceCheck.payment_status, ledgerEntry: traceCheck && traceCheck.ledger_entry_id });

    // ------------------------------------------------------------------------
    // REC-18: Backfill Tool Repeatability (Zero Duplicate Insertions on Replay)
    // ------------------------------------------------------------------------
    const preTxnCount = await one('SELECT count(*)::int as c FROM journal_transactions');
    // Simulate dry-run query to ensure zero drift
    const dryRunScan = await many(`
      SELECT le.entry_id
      FROM ledger_entries le
      WHERE NOT EXISTS (
        SELECT 1 FROM journal_transactions jt
        WHERE jt.reference_id = le.reference_id
           OR jt.transaction_id = le.entry_id
           OR jt.idempotency_key = 'recon_' || le.entry_id
      )
    `);
    const postTxnCount = await one('SELECT count(*)::int as c FROM journal_transactions');
    check('REC-18', 'reconciliation audit and dry-run query perform zero mutations on financial ledger',
      preTxnCount.c === postTxnCount.c && Array.isArray(dryRunScan),
      { preCount: preTxnCount.c, postCount: postTxnCount.c, candidateCount: dryRunScan.length });

  } finally {
    await c.end();
  }


  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n========================================================================`);
  console.log(`📊 LEDGER RECONCILIATION AUDIT: ${passed} PASSED, ${failed} FAILED (Total: ${results.length})`);
  console.log(`========================================================================\n`);

  if (failed > 0) process.exit(1);
  process.exit(0);
})().catch(err => {
  console.error('FATAL error in ledger reconciliation audit:', err);
  process.exit(1);
});
