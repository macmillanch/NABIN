// Phase 10 audit helper: inspect local Docker PostgreSQL schema for the
// job/order money-movement + OTP columns that must be immutable after creation.
const { Client } = require('pg');

const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  for (const table of ['jobs', 'orders']) {
    const cols = await c.query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
      [table]
    );
    console.log(`\n=== ${table} (${cols.rows.length} columns) ===`);
    console.log(cols.rows.map(r => r.column_name).join(', '));

    const trg = await c.query(
      `SELECT tgname FROM pg_trigger t JOIN pg_class cl ON cl.oid=t.tgrelid
       WHERE cl.relname=$1 AND NOT t.tgisinternal ORDER BY tgname`,
      [table]
    );
    console.log(`triggers: ${trg.rows.map(r => r.tgname).join(', ') || '(none)'}`);
  }

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });