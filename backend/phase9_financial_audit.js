/**
 * NABIN Phase 9 — Comprehensive Financial Security Forensic Audit Script
 * Runs against local PostgreSQL 127.0.0.1:54322
 */
const { Client } = require('pg');
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('  NABIN — Phase 9 Financial Security Forensic DB Audit');
  console.log('════════════════════════════════════════════════════════════\n');

  // ── A. Financial Table Inventory ──────────────────────────────────────────
  console.log('=== A. FINANCIAL TABLE INVENTORY ===');
  const tables = await c.query(
    `SELECT t.table_name,
            pc.relrowsecurity as rls_enabled,
            (SELECT COUNT(*) FROM pg_policy pp JOIN pg_class pc2 ON pp.polrelid = pc2.oid
             WHERE pc2.relname = t.table_name AND pc2.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname='public')) as policy_count
     FROM information_schema.tables t
     JOIN pg_class pc ON pc.relname = t.table_name
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
     WHERE t.table_schema = 'public'
     AND t.table_type = 'BASE TABLE'
     ORDER BY t.table_name`
  );
  const financialKeywords = ['payment','wallet','ledger','transaction','journal','refund','payout','settlement','commission','fee','balance','amount','charge','credit','debit','earning','account','promo','redemption','kyc','dispute'];
  const financialTables = tables.rows.filter(r => financialKeywords.some(kw => r.table_name.toLowerCase().includes(kw)));
  financialTables.forEach(r => console.log(`  ${r.rls_enabled ? '✅' : '❌'} RLS | policies=${r.policy_count} | ${r.table_name}`));

  // ── B. All financial tables — RLS + UPDATE/DELETE exposure ───────────────
  console.log('\n=== B. FINANCIAL TABLE MUTATION EXPOSURE ===');
  for (const t of financialTables) {
    const upd = await c.query(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
       WHERE table_schema='public' AND table_name=$1
       AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')
       AND grantee NOT IN ('postgres','service_role','supabase_admin')
       ORDER BY grantee`,
      [t.table_name]
    );
    if (upd.rows.length > 0) {
      console.log(`  ⚠️  ${t.table_name}:`);
      upd.rows.forEach(r => console.log(`       ${r.grantee} has ${r.privilege_type}`));
    }
  }

  // ── C. RLS Policy audit on financial tables ───────────────────────────────
  console.log('\n=== C. FINANCIAL TABLE RLS POLICIES ===');
  for (const t of financialTables) {
    const policies = await c.query(
      `SELECT polname, polcmd,
              pg_get_expr(polqual, polrelid) as using_expr,
              pg_get_expr(polwithcheck, polrelid) as with_check_expr,
              polroles::text as roles
       FROM pg_policy
       JOIN pg_class ON pg_class.oid = pg_policy.polrelid
       WHERE pg_class.relname = $1
       ORDER BY polname`,
      [t.table_name]
    );
    if (policies.rows.length > 0) {
      console.log(`\n  [${t.table_name}]`);
      policies.rows.forEach(r => {
        const riskFlag = (r.using_expr === 'true' || r.with_check_expr === 'true') ? ' *** USING(true) ***' : '';
        console.log(`    ${r.polname} | cmd=${r.polcmd} | roles=${r.roles}${riskFlag}`);
        if (r.using_expr) console.log(`      USING: ${r.using_expr}`);
        if (r.with_check_expr) console.log(`      WITH CHECK: ${r.with_check_expr}`);
      });
    } else if (!t.rls_enabled) {
      console.log(`  ❌ ${t.table_name}: NO RLS AND NO POLICIES`);
    }
  }

  // ── D. Financial RPC Privilege Audit ─────────────────────────────────────
  console.log('\n=== D. FINANCIAL RPC PRIVILEGE AUDIT ===');
  const financialFns = await c.query(
    `SELECT p.proname,
            pg_get_function_identity_arguments(p.oid) as args,
            p.prosecdef as secdef,
            p.proacl,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as svc_exec
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
     AND p.proname IN ('adjust_wallet_atomic','capture_payment_atomic','refund_payment_atomic',
                       'cancel_ride_atomic','redeem_promotion_atomic','validate_promotion_preview',
                       'accept_dispatch_offer_atomic','accept_job_assignment_atomic',
                       'create_dispatch_offer_atomic','transition_order_state',
                       'create_order_with_lines_atomic')
     ORDER BY p.proname, args`
  );
  financialFns.rows.forEach(r => {
    const risk = (r.anon_exec || (r.auth_exec && r.secdef)) ? ' *** RISK ***' : '';
    console.log(`  ${r.proname}(${r.args.substring(0,60)}...) | secdef=${r.secdef} | anon=${r.anon_exec} | auth=${r.auth_exec} | svc=${r.svc_exec}${risk}`);
  });

  // ── E. Journal/Ledger Immutability ────────────────────────────────────────
  console.log('\n=== E. LEDGER/JOURNAL IMMUTABILITY TRIGGERS ===');
  const immutableTables = ['journal_transactions', 'journal_lines', 'ledger_entries', 'payments', 'driver_payouts', 'payment_refund_authorizations'];
  for (const tbl of immutableTables) {
    const triggers = await c.query(
      `SELECT trigger_name, event_manipulation
       FROM information_schema.triggers
       WHERE event_object_schema='public' AND event_object_table=$1
       AND event_manipulation IN ('UPDATE','DELETE')`,
      [tbl]
    );
    const hasTrigger = triggers.rows.length > 0;
    console.log(`  ${hasTrigger ? '✅' : '⚠️ '} ${tbl}: ${hasTrigger ? triggers.rows.map(t => t.event_manipulation).join(',') + ' triggers' : 'NO immutability trigger'}`);
  }

  // ── F. Double-entry balance check ────────────────────────────────────────
  console.log('\n=== F. JOURNAL TRANSACTION BALANCE INTEGRITY ===');
  const unbalanced = await c.query(
    `SELECT COUNT(*) as cnt FROM journal_transactions WHERE total_debit != total_credit`
  );
  console.log(`  Unbalanced journal entries: ${unbalanced.rows[0].cnt} (should be 0)`);

  // ── G. Wallet negative balance check ─────────────────────────────────────
  console.log('\n=== G. WALLET NEGATIVE BALANCE CHECK ===');
  const negUsers = await c.query(`SELECT COUNT(*) as cnt FROM users WHERE wallet_balance < 0`);
  const negDrivers = await c.query(`SELECT COUNT(*) as cnt FROM drivers WHERE wallet_balance < 0`);
  const negMerchants = await c.query(`SELECT COUNT(*) as cnt FROM merchants WHERE wallet_balance < 0`);
  console.log(`  Users with negative balance: ${negUsers.rows[0].cnt}`);
  console.log(`  Drivers with negative balance: ${negDrivers.rows[0].cnt}`);
  console.log(`  Merchants with negative balance: ${negMerchants.rows[0].cnt}`);

  // ── H. Refund ceiling check ───────────────────────────────────────────────
  console.log('\n=== H. REFUND AMOUNT CEILING CHECK ===');
  const exceededRefunds = await c.query(
    `SELECT COUNT(*) as cnt FROM payments WHERE refunded_amount > amount`
  );
  console.log(`  Payments where refunded_amount > amount: ${exceededRefunds.rows[0].cnt} (should be 0)`);

  const partialFullRefunds = await c.query(
    `SELECT COUNT(*) as cnt FROM payments WHERE status = 'REFUNDED' AND refunded_amount < amount`
  );
  console.log(`  Payments REFUNDED but refunded_amount < amount: ${partialFullRefunds.rows[0].cnt} (possible data issue)`);

  // ── I. Payout destination ownership check ───────────────────────────────
  console.log('\n=== I. DRIVER PAYOUT DESTINATION CHECK ===');
  const payoutsRls = await c.query(
    `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
     FROM pg_policy
     JOIN pg_class ON pg_class.oid = pg_policy.polrelid
     WHERE pg_class.relname = 'driver_payouts'`
  );
  payoutsRls.rows.forEach(r => console.log(`  ${r.polname} | cmd=${r.polcmd} | USING: ${r.using_expr}`));

  // ── J. Check search_path on all SECURITY DEFINER functions ──────────────
  console.log('\n=== J. SECURITY DEFINER search_path AUDIT ===');
  const secdefFns = await c.query(
    `SELECT p.proname, p.prosecdef, p.proconfig
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public' AND p.prosecdef = true
     ORDER BY p.proname`
  );
  secdefFns.rows.forEach(r => {
    const config = r.proconfig ? r.proconfig.join(',') : 'NONE';
    const hasSearchPath = config.includes('search_path');
    console.log(`  ${hasSearchPath ? '✅' : '❌'} ${r.proname} | proconfig: ${config}`);
  });

  // ── K. Check for USING(true)/WITH CHECK(true) RLS policies ──────────────
  console.log('\n=== K. OPEN RLS POLICIES (USING/WITH CHECK = true) ===');
  const openPolicies = await c.query(
    `SELECT pg_class.relname as table_name, polname,
            pg_get_expr(polqual, polrelid) as using_expr,
            pg_get_expr(polwithcheck, polrelid) as with_check_expr
     FROM pg_policy
     JOIN pg_class ON pg_class.oid = pg_policy.polrelid
     JOIN pg_namespace pn ON pn.oid = pg_class.relnamespace AND pn.nspname = 'public'
     WHERE pg_get_expr(polqual, polrelid) = 'true'
        OR pg_get_expr(polwithcheck, polrelid) = 'true'
     ORDER BY pg_class.relname, polname`
  );
  if (openPolicies.rows.length === 0) {
    console.log('  ✅ No USING(true)/WITH CHECK(true) policies found');
  } else {
    openPolicies.rows.forEach(r => console.log(`  ⚠️  ${r.table_name}.${r.polname} | using=${r.using_expr} | with_check=${r.with_check_expr}`));
  }

  // ── L. Orphaned financial records check ──────────────────────────────────
  console.log('\n=== L. ORPHANED FINANCIAL RECORDS ===');
  const orphanLedger = await c.query(
    `SELECT COUNT(*) as cnt FROM ledger_entries WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM jobs)`
  );
  console.log(`  Ledger entries with invalid job_id: ${orphanLedger.rows[0].cnt}`);

  const orphanJournalLines = await c.query(
    `SELECT COUNT(*) as cnt FROM journal_lines WHERE journal_id NOT IN (SELECT id FROM journal_transactions)`
  );
  console.log(`  Journal lines with invalid journal_id: ${orphanJournalLines.rows[0].cnt}`);

  // ── M. Check wallet balance constraint ───────────────────────────────────
  console.log('\n=== M. WALLET BALANCE CONSTRAINTS (DB LEVEL) ===');
  const walletConstraints = await c.query(
    `SELECT tc.table_name, tc.constraint_name, cc.check_clause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc ON cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema = 'public'
     AND tc.table_name IN ('users', 'drivers', 'merchants')
     AND cc.check_clause ILIKE '%wallet%'`
  );
  if (walletConstraints.rows.length === 0) {
    console.log('  ⚠️  NO CHECK constraint on wallet_balance columns (negative balance relies on application logic only)');
  } else {
    walletConstraints.rows.forEach(r => console.log(`  ✅ ${r.table_name}.${r.constraint_name}: ${r.check_clause}`));
  }

  // ── N. Check driver_payouts upi_id exposure ───────────────────────────────
  console.log('\n=== N. SENSITIVE DATA COLUMNS ===');
  const sensitiveColumns = await c.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
     AND (column_name ILIKE '%upi%' OR column_name ILIKE '%bank_account%'
          OR column_name ILIKE '%ifsc%' OR column_name ILIKE '%vpa%'
          OR column_name ILIKE '%aadhaar%' OR column_name ILIKE '%pan%')
     ORDER BY table_name, column_name`
  );
  sensitiveColumns.rows.forEach(r => console.log(`  ${r.table_name}.${r.column_name}`));

  // ── O. Check payment_sessions RLS for INSERT protection ──────────────────
  console.log('\n=== O. PAYMENT SESSIONS INSERT PROTECTION ===');
  const psPolicies = await c.query(
    `SELECT polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr
     FROM pg_policy
     JOIN pg_class ON pg_class.oid = pg_policy.polrelid
     WHERE pg_class.relname = 'payment_sessions'
     ORDER BY polname`
  );
  psPolicies.rows.forEach(r => console.log(`  ${r.polname} | cmd=${r.polcmd} | USING: ${r.using_expr}`));
  const psInsertPolicy = psPolicies.rows.filter(r => r.polcmd === 'a' || r.polcmd === '*');
  if (psInsertPolicy.length === 0) {
    console.log('  ⚠️  No INSERT policy on payment_sessions — clients cannot directly insert (OK if service_role only)');
  }

  await c.end();
  console.log('\n════════════════════════════════════════════════════════════\n');
})().catch(e => { console.error('AUDIT FATAL:', e.message); process.exit(1); });
