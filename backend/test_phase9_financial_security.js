/**
 * NABIN — Phase 9 Financial Security Test Suite
 * Verifies all findings fixed by Migration 023 (Financial Ledger, Wallet &
 * Money-Movement Security Hardening) and the Phase 9 backend code fixes.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('assert');

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

/** Expect the async DB operation to fail with a message matching pattern. */
async function expectDbError(fn, pattern) {
  try {
    await fn();
    throw new Error(`Expected DB error matching /${pattern}/ but operation succeeded`);
  } catch (err) {
    if (!pattern.test(err.message)) {
      throw new Error(`Expected error matching /${pattern}/ but got: ${err.message}`);
    }
  }
}

const FINANCIAL_TABLES = [
  'admin_accounts', 'driver_payouts', 'journal_lines', 'journal_transactions',
  'ledger_accounts', 'ledger_entries', 'payment_refund_authorizations',
  'payment_sessions', 'payment_webhooks', 'payments', 'promotion_redemptions', 'promotions'
];

// Tables where client roles keep SELECT (row-scoped by RLS policies)
const READABLE_TABLES = [
  'payments', 'payment_sessions', 'driver_payouts', 'journal_transactions',
  'ledger_entries', 'promotions', 'promotion_redemptions'
];

const APPEND_ONLY_TABLES = [
  'ledger_entries', 'journal_transactions', 'journal_lines',
  'driver_payouts', 'payment_webhooks', 'payment_refund_authorizations'
];

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('  NABIN — Phase 9 Financial Security Test Suite');
  console.log('══════════════════════════════════════════════════════════\n');

  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 1: DML privilege revocation on financial tables (Finding F1: CRITICAL)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('GROUP 1: Financial Table DML Privilege Revocation');

  await test('anon/authenticated have NO INSERT/UPDATE/DELETE/TRUNCATE on any financial table', async () => {
    const res = await client.query(
      `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema='public'
       AND grantee IN ('anon','authenticated')
       AND table_name = ANY($1)
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')`,
      [FINANCIAL_TABLES]
    );
    assert.strictEqual(res.rows.length, 0,
      `Forbidden DML grants remain: ${JSON.stringify(res.rows)}`);
  });

  await test('Client roles retain SELECT only on tables with user-scoped RLS read policies', async () => {
    const res = await client.query(
      `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema='public'
       AND grantee IN ('anon','authenticated')
       AND table_name = ANY($1)
       AND privilege_type NOT IN ('SELECT')`,
      [READABLE_TABLES]
    );
    assert.strictEqual(res.rows.length, 0,
      `Non-SELECT grants on readable tables: ${JSON.stringify(res.rows)}`);
  });

  await test('SELECT is revoked from client roles on registry tables without read policies', async () => {
    const noReadTables = FINANCIAL_TABLES.filter(t => !READABLE_TABLES.includes(t));
    const res = await client.query(
      `SELECT grantee, table_name, privilege_type
       FROM information_schema.role_table_grants
       WHERE table_schema='public'
       AND grantee IN ('anon','authenticated')
       AND table_name = ANY($1)
       AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE')`,
      [noReadTables]
    );
    assert.strictEqual(res.rows.length, 0,
      `Grants remain on no-read tables: ${JSON.stringify(res.rows)}`);
  });

  await test('Functional proof: SET ROLE anon cannot UPDATE payments', async () => {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE anon');
      await expectDbError(
        () => client.query('UPDATE public.payments SET amount = 1 WHERE false'),
        /permission denied for table payments/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  await test('Functional proof: SET ROLE authenticated cannot TRUNCATE ledger_entries', async () => {
    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL ROLE authenticated');
      await expectDbError(
        () => client.query('TRUNCATE public.ledger_entries'),
        /permission denied for table ledger_entries/
      );
    } finally {
      await client.query('ROLLBACK');
    }
  });

  // GROUP 2 continues below.

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 2: Append-only enforcement on financial registries (Finding F2: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 2: Financial Registry Append-Only Enforcement');

  await test('Append-only triggers exist on all six financial registries (UPDATE + DELETE)', async () => {
    for (const table of APPEND_ONLY_TABLES) {
      const res = await client.query(
        `SELECT event_manipulation FROM information_schema.triggers
         WHERE event_object_schema='public' AND event_object_table=$1
         AND trigger_name = $2`,
        [table, `trg_${table}_append_only`]
      );
      const events = res.rows.map(r => r.event_manipulation).sort();
      assert.deepStrictEqual(events, ['DELETE', 'UPDATE'],
        `${table} trigger must fire on UPDATE and DELETE`);
    }
  });

  await test('ledger_entries: UPDATE is blocked (append-only)', async () => {
    await client.query(
      `INSERT INTO public.ledger_entries
         (entry_id, category, debit_account, credit_account, amount, description, reference_id)
       VALUES ($1, 'PHASE9_TEST', 'PAYMENT_GATEWAY_ESCROW', 'CUSTOMER_WALLET_LIABILITY', 1.00,
               'Phase 9 append-only probe', 'phase9_append_only_probe')`,
      [`PHASE9-LEDGER-${Date.now()}`]
    );
    await expectDbError(
      () => client.query("UPDATE public.ledger_entries SET amount = 99 WHERE reference_id = 'phase9_append_only_probe'"),
      /append-only/
    );
  });

  await test('ledger_entries: DELETE is blocked (append-only)', async () => {
    await expectDbError(
      () => client.query(`DELETE FROM public.ledger_entries WHERE reference_id = 'phase9_append_only_probe'`),
      /append-only/
    );
  });

  await test('journal_transactions: UPDATE is blocked (append-only)', async () => {
    const txnId = `phase9_txn_${Date.now()}`;
    const ins = await client.query(
      `INSERT INTO public.journal_transactions
         (transaction_id, category, total_debit, total_credit, description, reference_id, status)
       VALUES ($1, 'WALLET_TOPUP', 1.00, 1.00, 'Phase 9 append-only probe', 'phase9_probe', 'POSTED')
       RETURNING id`,
      [txnId]
    );
    await expectDbError(
      () => client.query('UPDATE public.journal_transactions SET status = $1 WHERE id = $2',
        ['VOIDED', ins.rows[0].id]),
      /append-only/
    );
  });

  await test('journal_lines: UPDATE is blocked (append-only)', async () => {
    const txnId = `phase9_ln_${Date.now()}`;
    const j = await client.query(
      `INSERT INTO public.journal_transactions
         (transaction_id, category, total_debit, total_credit, description, reference_id, status)
       VALUES ($1, 'WALLET_TOPUP', 1.00, 1.00, 'Phase 9 append-only probe', 'phase9_probe', 'POSTED')
       RETURNING id`,
      [txnId]
    );
    const line = await client.query(
      `INSERT INTO public.journal_lines (journal_id, account_code, entry_type, amount, notes)
       VALUES ($1, 'PAYMENT_GATEWAY_ESCROW', 'DEBIT', 1.00, 'phase9 probe line')
       RETURNING id`,
      [j.rows[0].id]
    );
    await expectDbError(
      () => client.query('UPDATE public.journal_lines SET amount = 5 WHERE id = $1', [line.rows[0].id]),
      /append-only/
    );
  });

  await test('driver_payouts: UPDATE is blocked (append-only)', async () => {
    const drv = await client.query('SELECT id FROM public.drivers ORDER BY created_at LIMIT 1');
    assert.ok(drv.rows.length > 0, 'At least one seeded driver must exist');
    const po = await client.query(
      `INSERT INTO public.driver_payouts (payout_id, driver_id, amount, upi_id, status)
       VALUES ($1, $2, 1.00, 'phase9.probe@upi', 'INITIATED') RETURNING id`,
      [`PHASE9-PO-${Date.now()}`, drv.rows[0].id]
    );
    await expectDbError(
      () => client.query('UPDATE public.driver_payouts SET amount = 999 WHERE id = $1', [po.rows[0].id]),
      /append-only/
    );
  });

  await test('payment_webhooks: DELETE is blocked (append-only)', async () => {
    const evt = await client.query(
      `INSERT INTO public.payment_webhooks (event_id, event_type, provider, amount, status, payload)
       VALUES ($1, 'phase9.probe', 'RAZORPAY', 1.00, 'PROBE', '{"phase9": true}'::jsonb)
       RETURNING id`,
      [`phase9_evt_${Date.now()}`]
    );
    await expectDbError(
      () => client.query('DELETE FROM public.payment_webhooks WHERE id = $1', [evt.rows[0].id]),
      /append-only/
    );
  });

  await test('payment_refund_authorizations: UPDATE is blocked (append-only)', async () => {
    const pay = await client.query('SELECT payment_id FROM public.payments ORDER BY created_at DESC LIMIT 1');
    assert.ok(pay.rows.length > 0, 'At least one payment row must exist');
    const auth = await client.query(
      `INSERT INTO public.payment_refund_authorizations
         (idempotency_key, payment_id, amount, reason, authorized_by, provider, payload_hash, ledger_entry_id)
       VALUES ($1, $2, 1.00, 'Phase 9 append-only probe', 'PHASE9_TEST', 'RAZORPAY_SANDBOX', $3, 'PHASE9-LEDGER-PROBE')
       RETURNING id`,
      [`phase9_refauth_${Date.now()}`, pay.rows[0].payment_id, '0'.repeat(64)]
    );
    await expectDbError(
      () => client.query('UPDATE public.payment_refund_authorizations SET amount = 5 WHERE id = $1', [auth.rows[0].id]),
      /append-only/
    );
  });

  // GROUP 3 continues below.

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 3: payments mutation invariants (Finding F3: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 3: payments Immutability & Refund Accounting Invariants');

  let testPaymentPk;
  let testCustomerId;

  await test('payments: setup test payment row (CAPTURED, amount=100)', async () => {
    const cust = await client.query('SELECT id FROM public.users ORDER BY created_at LIMIT 1');
    assert.ok(cust.rows.length > 0, 'At least one seeded user must exist');
    testCustomerId = cust.rows[0].id;
    const testPaymentId = `pay_phase9_${Date.now()}`;
    const res = await client.query(
      `INSERT INTO public.payments
         (payment_id, customer_id, amount, currency, method, status)
       VALUES ($1, $2, 100.00, 'INR', 'UPI', 'CAPTURED')
       RETURNING id`,
      [testPaymentId, testCustomerId]
    );
    testPaymentPk = res.rows[0].id;
    assert.ok(testPaymentPk, 'Test payment row inserted');
  });

  await test('payments: amount modification is blocked after creation', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payments SET amount = 999 WHERE id = $1', [testPaymentPk]),
      /payments\.amount is immutable/
    );
  });

  await test('payments: payment_id reassignment is blocked', async () => {
    await expectDbError(
      () => client.query("UPDATE public.payments SET payment_id = 'pay_hijacked' WHERE id = $1", [testPaymentPk]),
      /payments\.payment_id is immutable/
    );
  });

  await test('payments: customer ownership re-binding is blocked', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payments SET customer_id = $1 WHERE id = $2',
        ['00000000-0000-0000-0000-000000000099', testPaymentPk]),
      /payments\.customer_id is immutable/
    );
  });

  await test('payments: refunded_amount cannot exceed captured amount (over-refund blocked)', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payments SET refunded_amount = 150 WHERE id = $1', [testPaymentPk]),
      /cannot exceed captured amount/
    );
  });

  await test('payments: partial refund increase is permitted (monotonic accounting)', async () => {
    await client.query('UPDATE public.payments SET refunded_amount = 40, status = $1 WHERE id = $2',
      ['PARTIALLY_REFUNDED', testPaymentPk]);
    const row = await client.query('SELECT refunded_amount FROM public.payments WHERE id = $1', [testPaymentPk]);
    assert.strictEqual(Number(row.rows[0].refunded_amount), 40);
  });

  await test('payments: refunded_amount rewind (decrease) is blocked', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payments SET refunded_amount = 10 WHERE id = $1', [testPaymentPk]),
      /refunded_amount cannot decrease/
    );
  });

  await test('payments: status lifecycle update to REFUNDED at full amount is permitted', async () => {
    await client.query('UPDATE public.payments SET refunded_amount = 100, status = $1 WHERE id = $2',
      ['REFUNDED', testPaymentPk]);
    const row = await client.query('SELECT status FROM public.payments WHERE id = $1', [testPaymentPk]);
    assert.strictEqual(row.rows[0].status, 'REFUNDED');
  });

  await test('payments: test payment row cleanup (DELETE permitted on payments)', async () => {
    await client.query('DELETE FROM public.payments WHERE id = $1', [testPaymentPk]);
    const row = await client.query('SELECT id FROM public.payments WHERE id = $1', [testPaymentPk]);
    assert.strictEqual(row.rows.length, 0, 'Test payment row removed');
  });

  // GROUP 4 continues below.

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 4: payment_sessions mutation invariants (Finding F3: HIGH)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 4: payment_sessions Immutability Invariants');

  let testOrderId;

  await test('payment_sessions: setup test session (INITIATED, amount=77)', async () => {
    testOrderId = `phase9_order_${Date.now()}`;
    const res = await client.query(
      `INSERT INTO public.payment_sessions (order_id, customer_id, amount, currency, service_type, status)
       VALUES ($1, $2, 77.00, 'INR', 'RIDE', 'INITIATED') RETURNING id`,
      [testOrderId, testCustomerId]
    );
    assert.ok(res.rows[0].id, 'Test payment session inserted');
  });

  await test('payment_sessions: amount modification is blocked (capture-amount authority preserved)', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payment_sessions SET amount = 1 WHERE order_id = $1', [testOrderId]),
      /payment_sessions\.amount is immutable/
    );
  });

  await test('payment_sessions: order_id reassignment is blocked', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payment_sessions SET order_id = $1 WHERE order_id = $2',
        [`phase9_order_hijack_${Date.now()}`, testOrderId]),
      /payment_sessions\.order_id is immutable/
    );
  });

  await test('payment_sessions: customer_id re-binding is blocked', async () => {
    await expectDbError(
      () => client.query('UPDATE public.payment_sessions SET customer_id = $1 WHERE order_id = $2',
        ['00000000-0000-0000-0000-000000000099', testOrderId]),
      /payment_sessions\.customer_id is immutable/
    );
  });

  await test('payment_sessions: status lifecycle update is permitted', async () => {
    await client.query("UPDATE public.payment_sessions SET status = 'FAILED', failure_reason = 'phase9 probe' WHERE order_id = $1", [testOrderId]);
    const row = await client.query('SELECT status FROM public.payment_sessions WHERE order_id = $1', [testOrderId]);
    assert.strictEqual(row.rows[0].status, 'FAILED');
  });

  await test('payment_sessions: test session cleanup', async () => {
    await client.query('DELETE FROM public.payment_sessions WHERE order_id = $1', [testOrderId]);
    const row = await client.query('SELECT id FROM public.payment_sessions WHERE order_id = $1', [testOrderId]);
    assert.strictEqual(row.rows.length, 0, 'Test session removed');
  });

  // GROUP 5 continues below.

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 5: Wallet non-negative balance constraints (Finding F4: MEDIUM)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 5: Wallet Non-Negative Balance Constraints');

  await test('CHECK constraints exist on users, drivers, merchants wallet_balance', async () => {
    for (const table of ['users', 'drivers', 'merchants']) {
      const res = await client.query(
        `SELECT 1 FROM pg_constraint
         WHERE conname = $1 AND conrelid = $2::regclass AND contype = 'c'`,
        [`${table}_wallet_balance_nonnegative`, `public.${table}`]
      );
      assert.ok(res.rows.length > 0, `${table} wallet_balance CHECK constraint missing`);
    }
  });

  await test('users: negative wallet_balance UPDATE is blocked', async () => {
    const u = await client.query('SELECT id FROM public.users ORDER BY created_at LIMIT 1');
    await expectDbError(
      () => client.query('UPDATE public.users SET wallet_balance = -1 WHERE id = $1', [u.rows[0].id]),
      /wallet_balance_nonnegative|check constraint/
    );
  });

  await test('drivers: negative wallet_balance UPDATE is blocked', async () => {
    const d = await client.query('SELECT id FROM public.drivers ORDER BY created_at LIMIT 1');
    await expectDbError(
      () => client.query('UPDATE public.drivers SET wallet_balance = -1 WHERE id = $1', [d.rows[0].id]),
      /wallet_balance_nonnegative|check constraint/
    );
  });

  await test('merchants: negative wallet_balance UPDATE is blocked', async () => {
    const m = await client.query('SELECT id FROM public.merchants ORDER BY created_at LIMIT 1');
    await expectDbError(
      () => client.query('UPDATE public.merchants SET wallet_balance = -1 WHERE id = $1', [m.rows[0].id]),
      /wallet_balance_nonnegative|check constraint/
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 6: Financial RPC EXECUTE privileges (Phase 8 regression)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 6: Financial RPC EXECUTE Privileges');

  await test('anon/authenticated CANNOT execute financial RPCs; service_role CAN', async () => {
    for (const fn of ['adjust_wallet_atomic', 'capture_payment_atomic', 'refund_payment_atomic']) {
      const res = await client.query(
        `SELECT
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authn_exec,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_exec
         FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = $1 LIMIT 1`,
        [fn]
      );
      assert.ok(res.rows.length > 0, `${fn} must exist`);
      assert.strictEqual(res.rows[0].anon_exec, false, `${fn}: anon must NOT have EXECUTE`);
      assert.strictEqual(res.rows[0].authn_exec, false, `${fn}: authenticated must NOT have EXECUTE`);
      assert.strictEqual(res.rows[0].svc_exec, true, `${fn}: service_role must have EXECUTE`);
    }
  });

  // GROUP 7 continues below.

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 7: Phase 9 code-fix regression assertions (F1/F2/F3 endpoints)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 7: Phase 9 Code-Fix Regression Assertions');

  const serverSrc = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  const databaseSrc = fs.readFileSync(path.join(__dirname, 'src', 'database.js'), 'utf8');

  await test('driver self-payout no longer defaults to ₹500 when amount missing', async () => {
    assert.ok(!/Number\(amount\)\s*\|\|\s*500/.test(serverSrc),
      'server.js must not contain "Number(amount) || 500" fallback');
    assert.ok(/A positive numeric payout amount is required/.test(serverSrc),
      'driver payout route must require an explicit positive amount');
  });

  await test('admin settlement payout rejects malformed amounts instead of full-balance fallback', async () => {
    assert.ok(!/Number\(req\.body\.amount\)\s*\|\|\s*driver\.walletBalance/.test(serverSrc),
      'settlement payout must not fall back to full balance on malformed input');
    assert.ok(/INVALID_AMOUNT/.test(serverSrc),
      'settlement payout must return INVALID_AMOUNT for malformed input');
  });

  await test('admin financial adjustments route through the atomic ledger RPC (DEC-004)', async () => {
    const fnMatch = databaseSrc.match(/async processFinancialAdjustment\([\s\S]{0,6000}?\n  \}/);
    assert.ok(fnMatch, 'processFinancialAdjustment must exist as an async method');
    assert.ok(/this\.ledgerRepo\.adjustWallet\(/.test(fnMatch[0]),
      'processFinancialAdjustment must call this.ledgerRepo.adjustWallet (adjust_wallet_atomic RPC)');
    assert.ok(!/targetEntity\.walletBalance\s*\+=/.test(fnMatch[0]),
      'processFinancialAdjustment must not perform JavaScript balance arithmetic on the ledger path');
  });

  await test('admin adjustments route awaits the async adjustment handler', async () => {
    const routeMatch = serverSrc.match(/app\.post\('\/api\/admin\/finance\/adjustments'[\s\S]{0,700}?app\.post\(/);
    assert.ok(routeMatch, 'adjustments route must exist');
    assert.ok(/await db\.processFinancialAdjustment\(/.test(routeMatch[0]),
      'adjustments route must await db.processFinancialAdjustment');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TEST GROUP 8: RLS Coverage Integrity (regression)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\nGROUP 8: RLS Coverage Integrity');

  await test('All public tables still have RLS enabled after migration 023', async () => {
    const res = await client.query(
      `SELECT pt.tablename
       FROM pg_tables pt
       JOIN pg_class pc ON pc.relname = pt.tablename
       JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
       WHERE pt.schemaname = 'public'
       AND pc.relrowsecurity = false
       ORDER BY pt.tablename`
    );
    assert.strictEqual(res.rows.length, 0, `Tables without RLS: ${res.rows.map(r => r.tablename).join(', ')}`);
  });

  await client.end();

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err.message);
  process.exit(1);
});
