// Phase 10 audit helper: capture exact error text for revoked client-role write
// privileges, so the Phase 10 suite asserts real strings instead of guesses.
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function asRole(c, role, sql) {
  const sp = 'sp_' + Math.random().toString(36).slice(2, 10);
  await c.query(`SAVEPOINT ${sp}`);
  await c.query(`SET LOCAL ROLE ${role}`);
  let msg = null;
  let rows = null;
  try {
    const r = await c.query(sql);
    rows = r.rowCount;
  } catch (e) {
    msg = e.message.split('\n')[0];
  }
  await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
  await c.query(`RELEASE SAVEPOINT ${sp}`);
  return { msg, rows };
}

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const tables = ['jobs', 'orders', 'users', 'drivers', 'active_sessions', 'order_transitions'];
  await c.query('BEGIN');
  for (const t of tables) {
    for (const op of ['TRUNCATE', 'INSERT', 'UPDATE', 'DELETE']) {
      const sql = op === 'TRUNCATE'
        ? `TRUNCATE TABLE public.${t}`
        : op === 'INSERT'
          ? `INSERT INTO public.${t} DEFAULT VALUES`
          : op === 'UPDATE'
            ? `UPDATE public.${t} SET created_at = created_at WHERE false`
            : `DELETE FROM public.${t} WHERE false`;
      const r = await asRole(c, 'anon', sql);
      console.log(`${t.padEnd(18)} ${op.padEnd(9)} -> ${r.msg ? 'ERR: ' + r.msg : 'NO ERROR rows=' + r.rows}`);
    }
  }

  const hasPriv = await c.query(
    `SELECT has_table_privilege('anon','public.jobs','TRUNCATE') AS trunc,
            has_table_privilege('anon','public.jobs','SELECT')   AS sel,
            has_table_privilege('anon','public.users','UPDATE')  AS upd,
            has_table_privilege('anon','public.users','SELECT')  AS usel`
  );
  console.log('has_table_privilege:', JSON.stringify(hasPriv.rows[0]));
  await c.query('ROLLBACK');

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });