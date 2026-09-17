/** Phase 10 diagnostic: count jobs/orders with NULL OTPs (fail-closed impact check) */
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await c.connect();
  const r1 = await c.query(
    `SELECT count(*) FILTER (WHERE start_otp IS NULL) AS null_start,
            count(*) FILTER (WHERE delivery_otp IS NULL) AS null_deliv,
            count(*) AS total FROM jobs`
  );
  console.log('jobs OTP nulls:', JSON.stringify(r1.rows[0]));
  const r2 = await c.query(
    `SELECT count(*) FILTER (WHERE start_otp IS NULL) AS null_start,
            count(*) FILTER (WHERE delivery_otp IS NULL) AS null_deliv,
            count(*) AS total FROM orders`
  );
  console.log('orders OTP nulls:', JSON.stringify(r2.rows[0]));
  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
