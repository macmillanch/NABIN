// Phase 10 audit helper: determine whether the local Docker PostgreSQL provides
// the Supabase `auth` schema + auth.uid()/auth.role() helpers, and how RLS
// policies read the caller identity. Needed to build a faithful exploit proof.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const schemas = await c.query(
    `SELECT nspname FROM pg_namespace WHERE nspname IN ('auth','public') ORDER BY nspname`
  );
  console.log('schemas:', schemas.rows.map(r => r.nspname).join(', '));

  const fns = await c.query(
    `SELECT n.nspname || '.' || p.proname AS fn
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname IN ('uid','role','jwt','email') ORDER BY 1`
  );
  console.log('auth helpers:', fns.rows.map(r => r.fn).join(', ') || '(none)');

  const roles = await c.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres') ORDER BY 1`
  );
  console.log('roles:', roles.rows.map(r => r.rolname).join(', '));

  // Show the definition of auth.uid() so the exploit proof sets the right GUC.
  const def = await c.query(
    `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='auth' AND p.proname='uid' LIMIT 1`
  );
  console.log('\nauth.uid() definition:\n', def.rows.length ? def.rows[0].def : '(not present)');

  // Confirm the shape of the self-service policy that F6 abuses.
  const pol = await c.query(
    `SELECT tablename, policyname, cmd, roles::text AS roles, qual
       FROM pg_policies
      WHERE schemaname='public' AND tablename='users' AND cmd IN ('ALL','UPDATE')
      ORDER BY policyname`
  );
  console.log('\nusers write/ALL policies:');
  for (const r of pol.rows) {
    console.log(`  ${r.policyname} [${r.cmd}] roles=${r.roles}`);
    console.log(`    USING: ${String(r.qual || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });