// Phase 10 audit helper: verify no ACTIVE job/order would be blocked by the
// migration 024 settlement-precondition guard (NULL OTP + non-terminal state).
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const active = await c.query(
    `SELECT status, count(*) AS n,
            count(*) FILTER (WHERE delivery_otp IS NULL) AS null_delivery,
            count(*) FILTER (WHERE start_otp IS NULL) AS null_start
     FROM public.jobs
     WHERE status NOT IN ('COMPLETED','CANCELLED')
     GROUP BY status ORDER BY status`
  );
  console.log('--- non-terminal jobs by status (NULL-OTP risk) ---');
  console.table(active.rows);

  const risk = await c.query(
    `SELECT count(*) AS n FROM public.jobs
     WHERE status NOT IN ('COMPLETED','CANCELLED') AND delivery_otp IS NULL`
  );
  console.log('non-terminal jobs with NULL delivery_otp :', risk.rows[0].n);

  const orderActive = await c.query(
    `SELECT order_state, count(*) AS n FROM public.orders
     WHERE order_state NOT IN ('COMPLETED','CANCELLED') GROUP BY order_state ORDER BY order_state`
  );
  console.log('--- non-terminal orders by state ---');
  console.table(orderActive.rows);

  const jobIdNull = await c.query(
    `SELECT count(*) FILTER (WHERE job_id IS NULL) AS null_job, count(*) AS total FROM public.orders`
  );
  console.log('orders job_id NULL count :', JSON.stringify(jobIdNull.rows[0]));

  await c.end();
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });