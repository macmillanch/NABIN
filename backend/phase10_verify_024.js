// Phase 10 audit helper: verify migration 024 took effect on local PostgreSQL.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const leftover = await c.query(
    `SELECT count(*)::int AS n
       FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
        AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES')`
  );
  console.log(`leftover client-role write grants: ${leftover.rows[0].n} (expect 0)`);

  const sel = await c.query(
    `SELECT count(*)::int AS n FROM information_schema.role_table_grants
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
        AND privilege_type='SELECT'`
  );
  console.log(`retained client-role SELECT grants: ${sel.rows[0].n} (read path preserved)`);

  const guards = await c.query(
    `SELECT tgname FROM pg_trigger
      WHERE NOT tgisinternal
        AND (tgname LIKE '%privileged_column_guard%' OR tgname LIKE '%financial_record_guard%'
             OR tgname LIKE '%order_transitions_append_only%')
      ORDER BY tgname`
  );
  console.log('phase-10 guard triggers:', guards.rows.map(r => r.tgname).join(', ') || '(none)');

  const fnAcl = await c.query(
    `SELECT p.proname,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.prorettype = 'pg_catalog.trigger'::regtype
      ORDER BY p.proname`
  );
  const exposed = fnAcl.rows.filter(r => r.anon_exec);
  console.log(`trigger functions callable by anon: ${exposed.length} (expect 0)`);
  if (exposed.length) console.log('  exposed:', exposed.map(r => r.proname).join(', '));

  await c.end();
})().catch(e => { console.error('VERIFY_ERROR:', e.message); process.exit(1); });