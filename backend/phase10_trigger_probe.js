// Phase 10 audit helper: enumerate NON-internal triggers on the public tables
// touched by Phase 10, plus the columns still writable by anon/authenticated.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const trg = await c.query(
    `SELECT cl.relname AS table_name, t.tgname, p.proname, t.tgenabled
       FROM pg_trigger t
       JOIN pg_class cl ON cl.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE n.nspname='public' AND NOT t.tgisinternal
        AND cl.relname IN ('users','drivers','merchants','jobs','orders','audit_logs')
      ORDER BY cl.relname, t.tgname`
  );
  console.log('=== live triggers on key tables ===');
  for (const r of trg.rows) {
    console.log(`${r.table_name.padEnd(12)} ${r.tgname.padEnd(46)} ${r.proname} enabled=${r.tgenabled}`);
  }

  // Column-level privileges still held by client roles
  const colPriv = await c.query(
    `SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',') AS privs
       FROM information_schema.column_privileges
      WHERE table_schema='public' AND grantee IN ('anon','authenticated')
        AND privilege_type IN ('INSERT','UPDATE','REFERENCES')
        AND table_name IN ('users','drivers','merchants','jobs','orders')
      GROUP BY table_name, grantee ORDER BY table_name, grantee`
  );
  console.log('\n=== column-level write privileges held by client roles ===');
  console.log(colPriv.rows.length
    ? colPriv.rows.map(r => `${r.table_name}.${r.grantee}: ${r.privs}`).join('\n')
    : '(none)');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });