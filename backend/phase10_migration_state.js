// Phase 10 audit helper: is the on-disk migration 024 fully reflected in the DB?
const { Client } = require('pg');
const PG = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();

  const expected = [
    'trg_users_privileged_column_guard',
    'trg_drivers_privileged_column_guard',
    'trg_merchants_privileged_column_guard',
    'trg_jobs_financial_record_guard',
    'trg_orders_financial_record_guard',
    'trg_order_transitions_append_only'
  ];

  const trg = await c.query(
    `SELECT t.tgname FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname = ANY($1)`,
    [expected]
  );
  const installed = trg.rows.map(r => r.tgname);
  console.log('=== expected guard triggers ===');
  for (const e of expected) console.log(`  ${installed.includes(e) ? 'INSTALLED' : 'MISSING  '}  ${e}`);

  const fns = await c.query(
    `SELECT p.proname, p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN
      ('prevent_client_privileged_column_mutation','prevent_client_financial_record_mutation')`
  );
  console.log('=== guard functions present ===');
  for (const r of fns.rows) console.log(`  ${r.proname}  (has account_status: ${r.prosrc.includes('account_status')})`);
  const names = fns.rows.map(r => r.proname);
  for (const want of ['prevent_client_privileged_column_mutation', 'prevent_client_financial_record_mutation']) {
    if (!names.includes(want)) console.log(`  MISSING   ${want}`);
  }

  const cols = await c.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='order_transitions' ORDER BY ordinal_position`
  );
  console.log('=== order_transitions columns ===');
  console.log('  ' + cols.rows.map(r => r.column_name).join(', '));

  await c.end();
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });