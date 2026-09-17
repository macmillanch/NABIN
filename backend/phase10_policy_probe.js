// Phase 10 audit helper: dump RLS write policies for identity/money tables so we
// can distinguish RLS-mediated legitimate writes from privilege-escalation paths.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TABLES = ['users', 'drivers', 'merchants', 'identity_documents', 'devices_tokens'];

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const pol = await c.query(
    `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
     FROM pg_policies
     WHERE schemaname='public'
       AND tablename = ANY($1)
       AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
     ORDER BY tablename, cmd, policyname`,
    [TABLES]
  );

  for (const r of pol.rows) {
    console.log(`\n--- ${r.tablename} :: ${r.policyname} [${r.cmd}] roles=${r.roles}`);
    if (r.qual) console.log(`    USING      : ${String(r.qual).replace(/\s+/g, ' ').slice(0, 300)}`);
    if (r.with_check) console.log(`    WITH CHECK : ${String(r.with_check).replace(/\s+/g, ' ').slice(0, 300)}`);
  }
  if (!pol.rows.length) console.log('(no write policies found)');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });