/**
 * Phase 9 — Detailed policy/privilege/trigger diagnostics (local DB only)
 */
const { Client } = require('pg');
const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: DB_URL });
  await c.connect();

  console.log('=== 1. FINANCIAL TABLE GRANTS (anon/authenticated) ===');
  const grants = await c.query(
    `SELECT table_name, grantee, privilege_type
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND grantee IN ('anon','authenticated')
     AND table_name IN ('admin_accounts','driver_payouts','journal_lines','journal_transactions',
       'ledger_accounts','ledger_entries','payment_refund_authorizations','payment_sessions',
       'payment_webhooks','payments','promotion_redemptions','promotions','wallets','wallet_transactions')
     ORDER BY table_name, grantee, privilege_type`
  );
  grants.rows.forEach(r => console.log(`  ${r.table_name} | ${r.grantee} | ${r.privilege_type}`));

  console.log('\n=== 2. FULL POLICY DETAIL WITH ROLES ===');
  const pol = await c.query(
    `SELECT pc.relname as tbl, pol.polname, pol.polcmd,
            pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
            pg_get_expr(pol.polwithcheck, pol.polrelid) as with_check,
            array_to_string(array_agg(DISTINCT COALESCE(rol.rolname, 'PUBLIC')), ',') as roles
     FROM pg_policy pol
     JOIN pg_class pc ON pc.oid = pol.polrelid
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname='public'
     LEFT JOIN LATERAL unnest(pol.polroles) r(oid) ON true
     LEFT JOIN pg_roles rol ON rol.oid = r.oid
     WHERE pc.relname IN ('admin_accounts','driver_payouts','journal_lines','journal_transactions',
       'ledger_accounts','ledger_entries','payment_refund_authorizations','payment_sessions',
       'payment_webhooks','payments','promotion_redemptions','promotions','dispatch_offers')
     GROUP BY pc.relname, pol.polname, pol.polcmd, using_expr, with_check, pol.polrelid
     ORDER BY pc.relname, pol.polname`
  );
  pol.rows.forEach(r => console.log(`  ${r.tbl} | ${r.polname} | cmd=${r.polcmd} | roles=[${r.roles}]\n      USING: ${r.using_expr}\n      WC: ${r.with_check}`));

  console.log('\n=== 3. OPEN USING(true) POLICIES WITH ROLES ===');
  const open = await c.query(
    `SELECT pc.relname as tbl, pol.polname, pol.polcmd,
            array_to_string(array_agg(DISTINCT COALESCE(rol.rolname, 'PUBLIC')), ',') as roles
     FROM pg_policy pol
     JOIN pg_class pc ON pc.oid = pol.polrelid
     JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname='public'
     LEFT JOIN LATERAL unnest(pol.polroles) r(oid) ON true
     LEFT JOIN pg_roles rol ON rol.oid = r.oid
     WHERE pg_get_expr(pol.polqual, pol.polrelid) = 'true'
        OR pg_get_expr(pol.polwithcheck, pol.polrelid) = 'true'
     GROUP BY pc.relname, pol.polname, pol.polcmd
     ORDER BY pc.relname`
  );
  open.rows.forEach(r => console.log(`  ${r.tbl}.${r.polname} | cmd=${r.polcmd} | roles=[${r.roles}]`));

  console.log('\n=== 4. FINANCIAL TABLE TRIGGERS ===');
  const trg = await c.query(
    `SELECT event_object_table as tbl, trigger_name, event_manipulation, action_timing
     FROM information_schema.triggers
     WHERE event_object_schema='public'
     AND event_object_table IN ('payments','driver_payouts','payment_refund_authorizations',
       'ledger_entries','journal_lines','journal_transactions','payment_webhooks','payment_sessions','admin_accounts')
     ORDER BY event_object_table, trigger_name`
  );
  trg.rows.forEach(r => console.log(`  ${r.tbl} | ${r.trigger_name} | ${r.event_manipulation} ${r.action_timing}`));

  console.log('\n=== 5. WALLET BALANCE COLUMNS & CONSTRAINTS ===');
  const cols = await c.query(
    `SELECT table_name, column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_schema='public'
     AND (column_name ILIKE '%wallet%' OR column_name ILIKE '%balance%')
     AND data_type IN ('numeric','integer','double precision','real','money')
     ORDER BY table_name`
  );
  cols.rows.forEach(r => console.log(`  ${r.table_name}.${r.column_name} (${r.data_type})`));

  console.log('\n=== 6. CHECK CONSTRAINTS ON MONEY COLUMNS ===');
  const chk = await c.query(
    `SELECT tc.table_name, tc.constraint_name, cc.check_clause
     FROM information_schema.table_constraints tc
     JOIN information_schema.check_constraints cc ON cc.constraint_name = tc.constraint_name
     WHERE tc.table_schema='public' AND tc.constraint_type='CHECK'
     AND (cc.check_clause ILIKE '%amount%' OR cc.check_clause ILIKE '%balance%' OR cc.check_clause ILIKE '%refund%' OR cc.check_clause ILIKE '%payout%')
     ORDER BY tc.table_name`
  );
  chk.rows.forEach(r => console.log(`  ${r.table_name}.${r.constraint_name}: ${r.check_clause}`));

  console.log('\n=== 7. FINANCIAL RPC EXECUTE PRIVILEGES ===');
  const rpc = await c.query(
    `SELECT p.proname, p.prosecdef as security_definer,
            array_to_string(array_agg(DISTINCT COALESCE(r.rolname,'<invalid>')), ',') as grantees
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     LEFT JOIN LATERAL aclexplode(p.proacl) a ON true
     LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE n.nspname='public'
     AND (p.proname ILIKE '%wallet%' OR p.proname ILIKE '%payment%' OR p.proname ILIKE '%refund%'
          OR p.proname ILIKE '%payout%' OR p.proname ILIKE '%ledger%' OR p.proname ILIKE '%settle%'
          OR p.proname ILIKE '%capture%')
     GROUP BY p.proname, p.prosecdef
     ORDER BY p.proname`
  );
  rpc.rows.forEach(r => console.log(`  ${r.proname} | definer=${r.security_definer} | EXECUTE grants: [${r.grantees}]`));

  await c.end();
  console.log('\n=== DONE ===');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
