// Phase 10 audit helper: determine HOW the F7 immutability control actually
// engages under client-role simulation, so the proof tests the real control
// instead of passing vacuously because RLS filtered the row to zero.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function trial(c, label, prelude, sql) {
  await c.query('BEGIN');
  let out;
  try {
    for (const s of prelude) await c.query(s);
    await c.query('SET LOCAL ROLE authenticated');
    const r = await c.query(sql);
    out = `SUCCEEDED rowCount=${r.rowCount}`;
  } catch (e) {
    out = `REJECTED (${e.code || '?'}) ${e.message}`;
  }
  await c.query('ROLLBACK');
  console.log(`  ${label}\n      -> ${out}`);
}

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const j = await c.query('SELECT job_number, status FROM public.jobs LIMIT 1');
  const o = await c.query('SELECT order_number FROM public.orders LIMIT 1');
  const jobNumber = j.rows[0]?.job_number;
  const orderNumber = o.rows[0]?.order_number;
  console.log(`job=${jobNumber} order=${orderNumber}\n`);

  const grantJ = 'GRANT UPDATE ON public.jobs TO authenticated';
  const grantO = 'GRANT UPDATE ON public.orders TO authenticated';
  const polJ = 'CREATE POLICY phase10_probe_upd ON public.jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  const polO = 'CREATE POLICY phase10_probe_upd ON public.orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true)';
  const polJdel = 'CREATE POLICY phase10_probe_del ON public.jobs FOR DELETE TO authenticated USING (true)';

  console.log('--- jobs: grant only (RLS active, SELECT-only policy) ---');
  await trial(c, 'UPDATE jobs SET final_total=0.01', [grantJ],
    `UPDATE public.jobs SET final_total = 0.01 WHERE job_number = '${jobNumber}'`);

  console.log('\n--- jobs: grant + permissive UPDATE policy (trigger must fire) ---');
  await trial(c, 'UPDATE jobs SET final_total=0.01', [grantJ, polJ],
    `UPDATE public.jobs SET final_total = 0.01 WHERE job_number = '${jobNumber}'`);
  await trial(c, 'UPDATE jobs SET delivery_otp=\'0000\'', [grantJ, polJ],
    `UPDATE public.jobs SET delivery_otp = '0000' WHERE job_number = '${jobNumber}'`);
  await trial(c, 'UPDATE jobs SET status=status (non-frozen CONTROL)', [grantJ, polJ],
    `UPDATE public.jobs SET status = status WHERE job_number = '${jobNumber}'`);

  console.log('\n--- jobs: grant + permissive DELETE policy ---');
  await trial(c, 'DELETE FROM jobs', ['GRANT DELETE ON public.jobs TO authenticated', polJdel],
    `DELETE FROM public.jobs WHERE job_number = '${jobNumber}'`);

  console.log('\n--- orders: grant + permissive UPDATE policy ---');
  await trial(c, 'UPDATE orders SET total_amount=0.01', [grantO, polO],
    `UPDATE public.orders SET total_amount = 0.01 WHERE order_number = '${orderNumber}'`);

  console.log('\n--- users: RLS ALL own-row policy (F6 path already worked) ---');
  const u = await c.query('SELECT id FROM public.users LIMIT 1');
  await trial(c, 'UPDATE users SET wallet_balance=999999',
    ['GRANT UPDATE ON public.users TO authenticated',
      `SELECT set_config('request.jwt.claims', '{"sub":"${u.rows[0]?.id}","role":"authenticated"}', true)`],
    `UPDATE public.users SET wallet_balance = 999999 WHERE id = '${u.rows[0]?.id}'`);

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });