require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const cols = await c.query(
    "select column_name, data_type, character_maximum_length, is_nullable, column_default " +
    "from information_schema.columns " +
    "where table_schema='public' and table_name='drivers' " +
    "and (column_name like '%upi%' or column_name like '%payout%' or column_name in ('kyc_status','user_id','wallet_balance')) " +
    "order by ordinal_position");
  console.table(cols.rows);

  const checks = await c.query(
    "select conname, pg_get_constraintdef(oid) as def from pg_constraint " +
    "where conrelid = 'public.drivers'::regclass and contype in ('c','u','f') order by conname");
  console.table(checks.rows);

  const trg = await c.query(
    "select tgname, tgtype, pg_get_triggerdef(oid) as def from pg_trigger " +
    "where tgrelid in ('public.drivers'::regclass, 'public.driver_payouts'::regclass) and not tgisinternal order by tgname");
  console.table(trg.rows);

  const dp = await c.query(
    "select column_name, data_type, character_maximum_length from information_schema.columns " +
    "where table_schema='public' and table_name='driver_payouts' order by ordinal_position");
  console.table(dp.rows);

  const dpCount = await c.query('select count(*)::int as n from public.driver_payouts');
  console.log('driver_payouts ROWS:', dpCount.rows[0].n);

  const drv = await c.query(
    "select id, name, kyc_status, user_id is not null as linked, " +
    "(verified_upi_id is not null) as has_verified, (pending_upi_id is not null) as has_pending, " +
    "payout_upi_verified, upi_cooling_until from public.drivers where id in " +
    "(select id from public.drivers order by created_at limit 5)");
  console.log('DRIVERS (upi presence only, values not selected):');
  console.table(drv.rows);

  await c.end();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
