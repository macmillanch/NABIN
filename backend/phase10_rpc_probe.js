// Phase 10 audit helper: SECURITY DEFINER functions, search_path and EXECUTE grants.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const fns = await c.query(
    `SELECT p.proname,
            pg_get_function_identity_arguments(p.oid) AS args,
            p.prosecdef AS security_definer,
            COALESCE(array_to_string(p.proconfig, ';'), '') AS config,
            COALESCE(pg_get_userbyid(p.proowner), '?') AS owner,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
     ORDER BY p.prosecdef DESC, p.proname`
  );

  const definers = fns.rows.filter(r => r.security_definer);
  console.log(`=== SECURITY DEFINER functions: ${definers.length} ===`);
  for (const r of definers) {
    const sp = r.config || '(NO search_path SET)';
    const flags = [r.anon_exec ? 'anon' : null, r.auth_exec ? 'authenticated' : null].filter(Boolean).join(',');
    console.log(`${r.proname}(${r.args})`);
    console.log(`    owner=${r.owner} search_path=${sp} clientExecute=[${flags || 'none'}]`);
  }

  const invokers = fns.rows.filter(r => !r.security_definer);
  const clientCallable = invokers.filter(r => r.anon_exec || r.auth_exec);
  console.log(`\n=== SECURITY INVOKER functions client-callable: ${clientCallable.length} of ${invokers.length} ===`);
  for (const r of clientCallable.slice(0, 40)) {
    const flags = [r.anon_exec ? 'anon' : null, r.auth_exec ? 'authenticated' : null].filter(Boolean).join(',');
    console.log(`${r.proname}(${r.args}) [${flags}]`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });