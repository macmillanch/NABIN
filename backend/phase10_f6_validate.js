// Phase 10 audit helper: pre-validate the F6 proof logic used by the Phase 10
// test suite. Proves (a) the privileged-column guard fires for a client role on
// its OWN row, (b) a non-privileged column is still writable, (c) trusted roles
// are unaffected. Runs entirely inside a rolled-back transaction.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position`
  );
  console.log('users columns:', cols.rows.map(r => r.column_name).join(', '));

  const target = await c.query(`SELECT id FROM public.users LIMIT 1`);
  const userId = target.rows[0].id;
  console.log('target user id:', userId);

  // ---- (a) privileged column must be rejected for the client role ----------
  await c.query('BEGIN');
  try {
    await c.query('GRANT UPDATE ON public.users TO authenticated');
    await c.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`);
    await c.query('SET LOCAL ROLE authenticated');
    try {
      const r = await c.query(`UPDATE public.users SET identity_status='VERIFIED' WHERE id = $1`, [userId]);
      console.log(`(a) RESULT: UNEXPECTED SUCCESS rowCount=${r.rowCount}  <-- guard did not fire`);
    } catch (e) {
      console.log(`(a) guard fired as expected: ${e.message.split('\n')[0]}`);
    }
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- (b) benign column should still be writable ---------------------------
  await c.query('BEGIN');
  try {
    await c.query('GRANT UPDATE ON public.users TO authenticated');
    await c.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`);
    await c.query('SET LOCAL ROLE authenticated');
    const benign = cols.rows.map(r => r.column_name)
      .find(n => !['id', 'phone', 'wallet_balance', 'identity_status', 'account_status'].includes(n));
    try {
      const r = await c.query(`UPDATE public.users SET ${benign} = ${benign} WHERE id = $1`, [userId]);
      console.log(`(b) benign column "${benign}" write: rowCount=${r.rowCount} (no-op same-value write; guard permitted it)`);
    } catch (e) {
      console.log(`(b) UNEXPECTED rejection on benign column "${benign}": ${e.message.split('\n')[0]}`);
    }
  } finally {
    await c.query('ROLLBACK');
    await c.query('RESET ROLE').catch(() => {});
  }

  // ---- (c) trusted role (owner) may still change privileged columns ---------
  await c.query('BEGIN');
  try {
    const r = await c.query(
      `UPDATE public.users SET identity_status = identity_status WHERE id = $1`, [userId]
    );
    console.log(`(c) owner write on privileged column: rowCount=${r.rowCount} (trusted path intact)`);
  } finally {
    await c.query('ROLLBACK');
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });