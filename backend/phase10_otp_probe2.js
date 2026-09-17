const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const r = await c.query(
    `SELECT service_type,
            count(*) AS n,
            count(*) FILTER (WHERE start_otp IS NULL) AS start_null,
            count(*) FILTER (WHERE start_otp IS NOT NULL AND start_otp !~ '^[0-9]{4,6}$') AS start_weird,
            count(*) FILTER (WHERE delivery_otp IS NULL) AS deliv_null,
            count(*) FILTER (WHERE delivery_otp IS NOT NULL AND delivery_otp !~ '^[0-9]{4,6}$') AS deliv_weird
     FROM public.jobs GROUP BY service_type ORDER BY service_type`
  );
  console.log('by service_type:'); console.table(r.rows);
  const d = await c.query(
    `SELECT DISTINCT start_otp FROM public.jobs
      WHERE start_otp IS NULL OR start_otp !~ '^[0-9]{4,6}$' LIMIT 10`
  );
  console.log('sample odd start_otp:', JSON.stringify(d.rows.map(x => x.start_otp)));
  const d2 = await c.query(
    `SELECT id, job_number, status, service_type FROM public.jobs
      WHERE start_otp IS NULL OR start_otp !~ '^[0-9]{4,6}$' LIMIT 5`
  );
  console.log('sample rows:', JSON.stringify(d2.rows, null, 0));
  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });