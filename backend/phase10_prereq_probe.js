// Phase 10 audit helper: verify test prerequisites — role existence, trusted-path
// privileges, and sample rows for the users/drivers/merchants guard proofs.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const roles = await c.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres') ORDER BY rolname`);
  console.log('roles present:', roles.rows.map(r => r.rolname).join(', '));

  const trusted = await c.query(
    `SELECT has_table_privilege('service_role','public.jobs','UPDATE') AS svc_jobs_upd,
            has_table_privilege('postgres','public.jobs','UPDATE')     AS owner_jobs_upd,
            has_table_privilege('service_role','public.users','UPDATE') AS svc_users_upd,
            has_table_privilege('service_role','public.order_transitions','INSERT') AS svc_ot_ins`
  );
  console.log('trusted-path privileges:', JSON.stringify(trusted.rows[0]));

  const samples = await c.query(
    `SELECT (SELECT count(*) FROM public.users) AS users,
            (SELECT count(*) FROM public.drivers) AS drivers,
            (SELECT count(*) FROM public.merchants) AS merchants,
            (SELECT count(*) FROM public.orders) AS orders,
            (SELECT count(*) FROM public.order_transitions) AS order_transitions`
  );
  console.log('row counts:', JSON.stringify(samples.rows[0]));

  const u = await c.query(`SELECT id, name FROM public.users LIMIT 1`);
  const d = await c.query(`SELECT id FROM public.drivers LIMIT 1`);
  const m = await c.query(`SELECT id, commission_rate FROM public.merchants LIMIT 1`);
  console.log('sample user:', JSON.stringify(u.rows[0]));
  console.log('sample driver:', JSON.stringify(d.rows[0]));
  console.log('sample merchant:', JSON.stringify(m.rows[0]));

  const trig = await c.query(
    `SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.prorettype='pg_catalog.trigger'::regtype
      ORDER BY p.proname`
  );
  console.log('trigger fns exec:');
  trig.rows.forEach(r => console.log(`  ${r.proname}: anon=${r.anon_exec} authenticated=${r.auth_exec}`));

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });