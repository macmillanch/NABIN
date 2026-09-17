// Phase 10 audit helper: pre-validate the F7/F8 immutability-trigger proofs used
// by the Phase 10 test suite. jobs/orders carry no client UPDATE policy, so RLS
// would silently filter rows to zero and mask the trigger. The test therefore
// disables RLS inside a rolled-back transaction so the BEFORE UPDATE trigger is
// genuinely reached and its verdict is observable.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function attempt(client, label, sql, params) {
  try {
    await client.query(sql, params);
    console.log(`${label}: UNEXPECTED SUCCESS  <-- guard did not fire`);
  } catch (e) {
    console.log(`${label}: guard fired -> ${e.message.split('\n')[0]}`);
  }
}

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const jobRow = await c.query(
    `SELECT id, job_number FROM public.jobs WHERE start_otp IS NOT NULL LIMIT 1`
  );
  console.log('sample job:', JSON.stringify(jobRow.rows[0]));
  const jobId = jobRow.rows[0].id;

  // ---- F7: jobs.final_total immutable for client role ----------------------
  await c.query('BEGIN');
  try {
    await c.query('ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY');
    await c.query('GRANT UPDATE ON public.jobs TO authenticated');
    await c.query('SET LOCAL ROLE authenticated');
    await attempt(c, 'jobs.final_total',
      `UPDATE public.jobs SET final_total = final_total + 5000 WHERE id = $1`, [jobId]);
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- F8: jobs.start_otp immutable for client role -----------------------
  await c.query('BEGIN');
  try {
    await c.query('ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY');
    await c.query('GRANT UPDATE ON public.jobs TO authenticated');
    await c.query('SET LOCAL ROLE authenticated');
    await attempt(c, 'jobs.start_otp',
      `UPDATE public.jobs SET start_otp = '0000' WHERE id = $1`, [jobId]);
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- F7: benign lifecycle column still writable -------------------------
  await c.query('BEGIN');
  try {
    await c.query('ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY');
    await c.query('GRANT UPDATE ON public.jobs TO authenticated');
    await c.query('SET LOCAL ROLE authenticated');
    try {
      const r = await c.query(`UPDATE public.jobs SET updated_at = updated_at WHERE id = $1`, [jobId]);
      console.log(`jobs.updated_at (benign): rowCount=${r.rowCount} (guard permitted the lifecycle write)`);
    } catch (e) {
      console.log(`jobs.updated_at UNEXPECTED rejection: ${e.message.split('\n')[0]}`);
    }
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- order_transitions append-only (UPDATE + DELETE) --------------------
  await c.query('BEGIN');
  try {
    await c.query('ALTER TABLE public.order_transitions DISABLE ROW LEVEL SECURITY');
    await c.query('GRANT UPDATE, DELETE ON public.order_transitions TO authenticated');
    await c.query('SET LOCAL ROLE authenticated');
    await attempt(c, 'order_transitions UPDATE',
      `UPDATE public.order_transitions SET reason = 'tampered' WHERE id = (SELECT id FROM public.order_transitions LIMIT 1)`, []);
    await attempt(c, 'order_transitions DELETE',
      `DELETE FROM public.order_transitions WHERE id = (SELECT id FROM public.order_transitions LIMIT 1)`, []);
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- owner path unaffected ---------------------------------------------
  await c.query('BEGIN');
  try {
    const r = await c.query(`UPDATE public.jobs SET updated_at = updated_at WHERE id = $1`, [jobId]);
    console.log(`owner jobs lifecycle write: rowCount=${r.rowCount} (trusted path intact)`);
  } finally {
    await c.query('ROLLBACK');
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });