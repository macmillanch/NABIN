// Phase 10 audit helper: full client-role (anon/authenticated) write-privilege
// surface across public tables, flagging RLS-protected vs unprotected tables.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const rows = await c.query(
    `SELECT g.table_name,
            bool_or(g.privilege_type = 'TRUNCATE') AS can_truncate,
            bool_or(g.privilege_type = 'INSERT')   AS can_insert,
            bool_or(g.privilege_type = 'UPDATE')   AS can_update,
            bool_or(g.privilege_type = 'DELETE')   AS can_delete,
            bool_or(g.privilege_type = 'SELECT')   AS can_select,
            COALESCE(cl.relrowsecurity, false)     AS rls,
            (SELECT count(*) FROM pg_policies p
              WHERE p.schemaname='public' AND p.tablename=g.table_name
                AND p.cmd IN ('INSERT','UPDATE','DELETE','ALL')) AS write_policies
     FROM information_schema.role_table_grants g
     LEFT JOIN pg_class cl ON cl.relname = g.table_name AND cl.relkind='r'
     WHERE g.table_schema='public' AND g.grantee IN ('anon','authenticated')
     GROUP BY g.table_name, cl.relrowsecurity
     ORDER BY can_truncate DESC, g.table_name`
  );

  const dangerous = rows.rows.filter(r => r.can_truncate || r.can_insert || r.can_update || r.can_delete);
  console.log(`=== tables writable by anon/authenticated: ${dangerous.length} ===`);
  for (const r of dangerous) {
    const flags = [
      r.can_truncate ? 'TRUNCATE' : null,
      r.can_insert ? 'INSERT' : null,
      r.can_update ? 'UPDATE' : null,
      r.can_delete ? 'DELETE' : null
    ].filter(Boolean).join(',');
    console.log(`${r.table_name.padEnd(34)} ${flags.padEnd(38)} rls=${r.rls} writePolicies=${r.write_policies}`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });