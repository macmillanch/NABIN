/* Phase 21 Part A/M/O — financial safety snapshot. Loopback only; refuses otherwise. */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const HOST = new URL(PG).hostname;
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(HOST)) {
  console.error(`REFUSED: database host "${HOST}" is not loopback`);
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') { console.error('REFUSED: NODE_ENV=production'); process.exit(1); }
if (/^rzp_live/.test(process.env.RAZORPAY_KEY_ID || '')) { console.error('REFUSED: live payment key active'); process.exit(1); }

const label = process.argv[2] || 'before';
(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql) => (await c.query(sql)).rows[0];

  const counts = await one(`SELECT
    (SELECT COUNT(*) FROM journal_transactions) journal_transactions,
    (SELECT COUNT(*) FROM journal_lines) journal_lines,
    (SELECT COUNT(*) FROM driver_payouts) driver_payouts,
    (SELECT COUNT(*) FROM jobs) jobs,
    (SELECT COUNT(*) FROM jobs WHERE status='COMPLETED') completed_jobs,
    (SELECT COUNT(*) FROM support_tickets) support_tickets,
    (SELECT COALESCE(SUM(wallet_balance),0) FROM drivers) sum_drivers_wallet_balance`);

  const earnings = await one(`SELECT
      COUNT(DISTINCT t.id) driver_earnings_transactions,
      COUNT(DISTINCT t.id) FILTER (WHERE t.idempotency_key IS NULL) null_key_driver_earnings
    FROM journal_transactions t JOIN journal_lines l ON l.journal_id = t.id
   WHERE l.account_code = 'DRIVER_EARNINGS_PAYABLE' AND l.entry_type = 'CREDIT'`);

  /* Fingerprints of the historical rows this phase must not disturb. Append-only
   * means "unchanged" is provable by max(id)/max(created_at) plus counts, not by
   * a checksum of mutable rows. */
  const fp = await one(`SELECT
      (SELECT MAX(created_at) FROM journal_transactions) journal_last_created,
      (SELECT MAX(created_at) FROM driver_payouts) payouts_last_created,
      (SELECT MAX(updated_at) FROM support_tickets) tickets_last_updated,
      (SELECT status FROM support_tickets WHERE ticket_number='TCK-9481') tck_9481_status,
      (SELECT COUNT(*) FROM journal_transactions t JOIN journal_lines l ON l.journal_id=t.id
        WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND t.reference_id IN
        ('JOB-93587159-696','JOB-92768166-552','JOB-92412647-611')) historical_duplicate_rows`);

  const out = {
    phase: 'PHASE 21',
    label,
    taken_at: new Date().toISOString(),
    target: { host: HOST, database: 'postgres', privileged_local_connection: true },
    counts,
    driver_earnings: earnings,
    historical_fingerprints: fp,
  };
  const dir = path.join(__dirname, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `phase21_${label}_snapshot.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)}`);
  console.log(JSON.stringify(out, null, 2));
  await c.end();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
