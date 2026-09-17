// Phase 10 audit helper: OTP column format sanity + backend privilege model.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const otp = await c.query(
    `SELECT
       count(*) FILTER (WHERE start_otp IS NULL OR start_otp !~ '^[0-9]{4,6}$')    AS bad_start,
       count(*) FILTER (WHERE delivery_otp IS NULL OR delivery_otp !~ '^[0-9]{4,6}$') AS bad_deliv,
       count(*) FILTER (WHERE pickup_otp IS NOT NULL) AS pickup_set,
       count(*) AS total FROM public.jobs`
  );
  console.log('jobs OTP format (bad = NULL or not 4-6 digits):');
  console.log(JSON.stringify(otp.rows[0], null, 0));

  const roles = await c.query(
    `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin') ORDER BY rolname`
  );
  console.log('roles present:', roles.rows.map(r => r.rolname).join(', '));

  const svc = await c.query(
    `SELECT table_name, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name IN ('jobs','orders','users') AND grantee='service_role'
     GROUP BY table_name`
  );
  console.log('service_role grants:', svc.rows.length ? svc.rows.map(r => `${r.table_name}: ${r.privs}`).join(' | ') : '(none)');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });