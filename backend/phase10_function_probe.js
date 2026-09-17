// Phase 10 audit helper: enumerate trigger functions + their EXECUTE grants.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const rows = await c.query(
    `SELECT p.proname,
            pg_get_function_identity_arguments(p.oid) AS args,
            COALESCE(array_to_string(p.proconfig, ','), '(no proconfig)') AS proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.prorettype = 'pg_catalog.trigger'::regtype
      ORDER BY p.proname`
  );

  console.log('=== trigger functions in public ===');
  for (const r of rows.rows) {
    console.log(`${r.proname}(${r.args}) search_path=${r.proconfig} anonExec=${r.anon_exec} authedExec=${r.authed_exec}`);
  }

  const secdef = await c.query(
    `SELECT p.proname,
            COALESCE(array_to_string(p.proconfig, ','), '(no proconfig)') AS proconfig,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_exec
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prosecdef
      ORDER BY p.proname`
  );
  console.log(`\n=== SECURITY DEFINER functions in public: ${secdef.rows.length} ===`);
  for (const r of secdef.rows) {
    console.log(`${r.proname} search_path=${r.proconfig} anonExec=${r.anon_exec} authedExec=${r.authed_exec}`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });