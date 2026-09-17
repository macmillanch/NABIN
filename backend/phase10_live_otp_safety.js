// Phase 10 audit helper: prove the fail-closed OTP change in
// validateAuthoritativeJobOtp() cannot strand a live trip.
//
// The Phase 10 fix rejects verification when a job has no bound verification
// code. That is only safe if every job that can still be advanced (i.e. every
// non-terminal status) actually carries both codes. This script asserts that.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TERMINAL = ['COMPLETED', 'CANCELLED', 'CUSTOMER_CANCELLED', 'SYSTEM_CANCELLED', 'DRIVER_CANCELLED', 'FAILED'];

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const r = await c.query(
    `SELECT status,
            count(*)::int                          AS n,
            count(*) FILTER (WHERE start_otp IS NULL)    ::int AS null_start,
            count(*) FILTER (WHERE delivery_otp IS NULL) ::int AS null_deliv,
            count(*) FILTER (WHERE pickup_otp IS NULL)   ::int AS null_pickup
       FROM public.jobs
      GROUP BY status ORDER BY status`
  );
  console.log('jobs by status (null OTP exposure):');
  for (const row of r.rows) {
    const live = !TERMINAL.includes(String(row.status).toUpperCase());
    console.log(`  ${String(row.status).padEnd(20)} n=${String(row.n).padStart(4)}  nullStart=${row.null_start} nullDeliv=${row.null_deliv} nullPickup=${row.null_pickup}${live ? '   <-- NON-TERMINAL' : ''}`);
  }

  const live = await c.query(
    `SELECT count(*)::int AS n,
            count(*) FILTER (WHERE start_otp IS NULL)    ::int AS null_start,
            count(*) FILTER (WHERE delivery_otp IS NULL) ::int AS null_deliv
       FROM public.jobs
      WHERE upper(status) NOT IN ('COMPLETED','CANCELLED','CUSTOMER_CANCELLED',
                                  'SYSTEM_CANCELLED','DRIVER_CANCELLED','FAILED')`
  );
  const l = live.rows[0];
  console.log(`\nnon-terminal jobs: ${l.n}, of which nullStart=${l.null_start}, nullDeliv=${l.null_deliv}`);
  console.log(l.null_start === 0 && l.null_deliv === 0
    ? 'SAFE: every advanceable job carries both verification codes.'
    : 'REGRESSION RISK: an advanceable job lacks a bound code.');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });