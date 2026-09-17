// Phase 10 audit helper: privileged-column discovery + definitive privilege proof.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  for (const t of ['users', 'drivers', 'merchants']) {
    const cols = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t]
    );
    console.log(`\n=== ${t} columns ===`);
    console.log(cols.rows.map(r => `${r.column_name}:${r.data_type}`).join(', '));
  }

  console.log('\n=== definitive privilege test (has_table_privilege as anon/authenticated) ===');
  const t = await c.query(
    `SELECT tablename,
            has_table_privilege('anon', 'public.'||tablename, 'TRUNCATE') AS anon_trunc,
            has_table_privilege('authenticated', 'public.'||tablename, 'TRUNCATE') AS auth_trunc,
            has_table_privilege('anon', 'public.'||tablename, 'UPDATE') AS anon_upd
     FROM (VALUES ('jobs'),('orders'),('users'),('drivers'),('merchants'),('advertisements'),('audit_logs'),('active_sessions')) AS v(tablename)`
  );
  for (const r of t.rows) {
    console.log(`  ${r.tablename.padEnd(18)} anon.TRUNCATE=${r.anon_trunc}  authenticated.TRUNCATE=${r.auth_trunc}  anon.UPDATE=${r.anon_upd}`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });