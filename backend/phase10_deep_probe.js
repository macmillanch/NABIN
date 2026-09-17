// Phase 10 audit helper: full write-policy + column-grant + mobile-client
// exposure analysis for the self-service profile path.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const fs = require('fs');

const out = [];
const log = (...a) => out.push(a.join(' '));

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  log('===== A. WRITE POLICIES (public schema) =====');
  const pol = await c.query(
    `SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
     FROM pg_policies WHERE schemaname='public' AND cmd IN ('ALL','INSERT','UPDATE','DELETE')
     ORDER BY tablename, cmd, policyname`
  );
  for (const r of pol.rows) {
    log(`\n[${r.tablename}] ${r.policyname} cmd=${r.cmd} roles=${r.roles}`);
    if (r.qual) log(`   USING: ${r.qual}`);
    if (r.with_check) log(`   CHECK: ${r.with_check}`);
  }

  log('\n\n===== B. COLUMN-LEVEL GRANTS on users (anon/authenticated) =====');
  const colGrants = await c.query(
    `SELECT grantee, column_name, privilege_type
     FROM information_schema.column_privileges
     WHERE table_schema='public' AND table_name='users'
       AND grantee IN ('anon','authenticated')
     ORDER BY grantee, privilege_type, column_name`
  );
  log(colGrants.rows.length
    ? colGrants.rows.map(r => `${r.grantee} ${r.privilege_type}(${r.column_name})`).join('\n')
    : '(no column-level grants)');

  log('\n\n===== C. TABLE-LEVEL GRANTS on users/drivers/merchants (anon/authenticated) =====');
  const tGrants = await c.query(
    `SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS p
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name IN ('users','drivers','merchants','active_sessions')
       AND grantee IN ('anon','authenticated')
     GROUP BY table_name, grantee ORDER BY table_name, grantee`
  );
  log(tGrants.rows.map(r => `${r.table_name} -> ${r.grantee}: ${r.p}`).join('\n') || '(none)');

  log('\n\n===== D. SECURITY DEFINER functions executable by anon/authenticated =====');
  const fn = await c.query(
    `SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid) AS args,
            array_to_string(p.proconfig, ',') AS config,
            (SELECT string_agg(DISTINCT g.grantee, ',' ORDER BY g.grantee)
               FROM information_schema.routine_privileges g
              WHERE g.specific_name = p.proname || '_' || p.oid
                AND g.privilege_type='EXECUTE' AND g.grantee IN ('anon','authenticated')) AS client_grantees
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef = true
     ORDER BY p.proname`
  );
  for (const r of fn.rows) {
    log(`\n${r.proname}(${r.args}) definer=true search_path=${r.config || '(NOT SET)'} clientExec=${r.client_grantees || 'NONE'}`);
  }

  fs.writeFileSync('phase10_probe_out.txt', out.join('\n'), 'utf8');
  console.log('WROTE phase10_probe_out.txt lines=' + out.length);
  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });