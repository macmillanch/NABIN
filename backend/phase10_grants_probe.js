// Phase 10 audit helper: grant exposure + data sanity for jobs/orders hardening.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const grants = await c.query(
    `SELECT table_name, grantee, string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type) AS privs
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name IN ('jobs','orders')
       AND grantee IN ('anon','authenticated')
     GROUP BY table_name, grantee ORDER BY table_name, grantee`
  );
  console.log('=== client-role grants on jobs/orders ===');
  console.log(grants.rows.length ? grants.rows.map(r => `${r.table_name} -> ${r.grantee}: ${r.privs}`).join('\n') : '(none)');

  const rls = await c.query(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('jobs','orders') AND relkind='r'`
  );
  console.log('=== RLS enabled ===');
  console.log(rls.rows.map(r => `${r.relname}: ${r.relrowsecurity}`).join('\n'));

  const pol = await c.query(
    `SELECT tablename, policyname, cmd, roles::text FROM pg_policies WHERE tablename IN ('jobs','orders') ORDER BY tablename, policyname`
  );
  console.log('=== policies ===');
  console.log(pol.rows.length ? pol.rows.map(r => `${r.tablename}.${r.policyname} [${r.cmd}] roles=${r.roles}`).join('\n') : '(none)');

  const sanity = await c.query(
    `SELECT count(*) FILTER (WHERE final_total < 0) AS neg_final,
            count(*) FILTER (WHERE driver_earnings < 0) AS neg_earn,
            count(*) FILTER (WHERE platform_commission < 0) AS neg_comm,
            count(*) AS total FROM public.jobs`
  );
  console.log('=== jobs numeric sanity ===');
  console.log(JSON.stringify(sanity.rows[0]));

  const osanity = await c.query(
    `SELECT count(*) FILTER (WHERE total_amount < 0) AS neg_total, count(*) AS total FROM public.orders`
  );
  console.log('=== orders numeric sanity ===');
  console.log(JSON.stringify(osanity.rows[0]));

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });