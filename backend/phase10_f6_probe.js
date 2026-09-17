// Phase 10 audit helper: inspect write policies on users/drivers/merchants and
// confirm whether auth.uid() exists locally, so the F6 proof can set valid claims.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const pol = await c.query(
    `SELECT tablename, policyname, cmd, qual, with_check
       FROM pg_policies
      WHERE schemaname='public' AND tablename IN ('users','drivers','merchants')
      ORDER BY tablename, cmd, policyname`
  );
  console.log('=== policies on users/drivers/merchants ===');
  for (const r of pol.rows) {
    console.log(`  ${r.tablename}.${r.policyname} [${r.cmd}]`);
    console.log(`      qual: ${r.qual || '(none)'}`);
    if (r.with_check) console.log(`      with_check: ${r.with_check}`);
  }

  const uid = await c.query(
    `SELECT n.nspname, p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE p.proname IN ('uid','role','jwt') ORDER BY n.nspname, p.proname`
  );
  console.log('=== auth helper functions ===');
  console.log(uid.rows.length ? uid.rows.map(r => `${r.nspname}.${r.proname}`).join(', ') : '(none)');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });