// Phase 10 audit helper: verify why the proof-script probes reported SUCCEEDED.
// Hypothesis: no exception != vulnerable. RLS filters rows to zero, and a
// same-value write is a no-op for the column-change guard.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const u = await c.query(
    `SELECT id, account_status, identity_status, wallet_balance FROM public.users LIMIT 1`
  );
  console.log('=== sample users row ===');
  console.log(JSON.stringify(u.rows[0]));

  const checks = await c.query(
    `SELECT rel.relname, con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
      WHERE n.nspname='public' AND rel.relname IN ('users','drivers','merchants')
        AND con.contype='c'
        AND pg_get_constraintdef(con.oid) ~* 'account_status|identity_status|kyc_status|merchant_type'
      ORDER BY rel.relname, con.conname`
  );
  console.log('=== relevant CHECK constraints ===');
  for (const r of checks.rows) console.log(`  ${r.relname}.${r.conname}: ${r.def}`);

  // Prove the "0 rows affected" hypothesis under RLS as anon.
  await c.query('BEGIN');
  try {
    await c.query('GRANT UPDATE ON public.jobs TO anon');
    await c.query('SET LOCAL ROLE anon');
    const upd = await c.query(`UPDATE public.jobs SET final_total = 1.00 WHERE job_number = (SELECT job_number FROM public.jobs LIMIT 1)`);
    console.log('=== anon UPDATE public.jobs (no jwt claims) ===');
    console.log(`  rowCount = ${upd.rowCount}   <-- 0 means RLS filtered the row; statement "succeeded" but changed nothing`);
    await c.query('RESET ROLE');
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  const pol = await c.query(
    `SELECT tablename, policyname, cmd, qual FROM pg_policies
      WHERE tablename IN ('jobs','orders','order_transitions') AND cmd IN ('UPDATE','DELETE','ALL')
      ORDER BY tablename, policyname`
  );
  console.log('=== UPDATE/DELETE/ALL policies (qual is the RLS filter) ===');
  for (const r of pol.rows) console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}] ${r.qual || ''}`);

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });