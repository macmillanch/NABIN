/*
 * E4 — is /api/admin/finance/metrics authoritative, or a memory projection?
 *
 * `getFinancialMetrics()` (database.js) computes grossGtv, totalCustomerPayments, driverEarnings,
 * platformRevenue, totalRefunds, pendingSettlements, completedSettlements and
 * `outstandingBalances = driverEarnings - completedSettlements` from `this.transactions` — an array
 * assigned once from a hardcoded seed (database.js:1165) and appended by `unshift`. It is never
 * re-read from PostgreSQL and never persisted. Meanwhile every real credit is booked durably by
 * `adjust_wallet_atomic` into `journal_lines`.
 *
 * This test measures both sides of the same quantity, before and after a fresh durable credit, and
 * reports the numbers. It asserts the DURABLE truth; a failure here is the defect, not a bad test.
 *
 * Local/test only. No historical row is modified; the credit it books belongs to a dedicated
 * driver, which is then retained because the journal references it.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('E4 REFUSED: non-loopback target'); process.exit(1);
}
const db = require('./src/database');
const STAMP = Date.now();
const AMOUNT = 250;
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''));
}
const api = async (method, path, body, token) => {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {}),
    body: method === 'GET' ? undefined : JSON.stringify(body || {})
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // Durable authority for "driver earnings booked": the CREDIT leg every wallet credit writes.
  const durable = async () => one(`SELECT
      (SELECT coalesce(sum(amount),0)::numeric(14,2) FROM journal_lines l
        JOIN journal_transactions t ON t.id = l.journal_id
       WHERE l.account_code = 'DRIVER_EARNINGS_PAYABLE' AND l.entry_type = 'CREDIT') driver_credits,
      (SELECT coalesce(sum(amount),0)::numeric(14,2) FROM journal_lines l
       WHERE l.account_code = 'PLATFORM_COMMISSION_REVENUE' AND l.entry_type = 'CREDIT') commission_credits,
      (SELECT coalesce(sum(amount),0)::numeric(14,2) FROM journal_lines l
       WHERE l.account_code = 'DISPUTE_REFUND_EXPENSE' AND l.entry_type = 'DEBIT') refunds,
      (SELECT coalesce(sum(final_total),0)::numeric(14,2) FROM jobs WHERE status='COMPLETED') completed_fare`);

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('E4-00', 'a finance-capable admin session exists', login.status === 200 && !!tok, { status: login.status });
  if (!tok) process.exit(1);

  const mem0 = (await api('GET', '/api/admin/finance/metrics', null, tok)).data.metrics;
  const dur0 = await durable();
  console.log(`\n  reported (memory): driverEarnings=${mem0 && mem0.driverEarnings} platformRevenue=${mem0 && mem0.platformRevenue} grossGtv=${mem0 && mem0.grossGtv} totalRefunds=${mem0 && mem0.totalRefunds}`);
  console.log(`  durable  (journal): driver_credits=${dur0.driver_credits} commission=${dur0.commission_credits} refunds=${dur0.refunds} completed_fare=${dur0.completed_fare}`);

  check('E4-01', 'the metrics endpoint answers at all', !!mem0 && typeof mem0.driverEarnings === 'number',
    { keys: mem0 && Object.keys(mem0) });
  check('E4-02', 'reported driver earnings equal the durable booked credits (authority test)',
    Number(mem0.driverEarnings) === Number(dur0.driver_credits),
    { reported: mem0.driverEarnings, durable: dur0.driver_credits,
      divergence: Number(dur0.driver_credits) - Number(mem0.driverEarnings) });
  check('E4-03', 'reported platform revenue equals the durable commission credits',
    Number(mem0.platformRevenue) === Number(dur0.commission_credits),
    { reported: mem0.platformRevenue, durable: dur0.commission_credits });
  check('E4-04', 'reported refunds equal the durable refund postings',
    Number(mem0.totalRefunds) === Number(dur0.refunds),
    { reported: mem0.totalRefunds, durable: dur0.refunds });

  // Now make an unambiguous durable credit and see whether the report can notice.
  const drv = (await (require('./src/supabase').supabaseAdmin).from('drivers').insert({
    phone: `87${String(STAMP).slice(-8)}`, name: `E4 metrics probe ${STAMP}`, vehicle_type: 'AUTO',
    vehicle_number: `E4${String(STAMP).slice(-4)}`, operational_status: 'AVAILABLE', wallet_balance: 0
  }).select('id').single()).data;
  const before = await durable();
  const mBefore = (await api('GET', '/api/admin/finance/metrics', null, tok)).data.metrics;
  await db.driverRepo.updateEarnings(drv.id, AMOUNT, null,
    { idempotencyKey: `E4:${STAMP}:DRIVER_EARNINGS`, purpose: 'E4 metrics authority probe' });
  const after = await durable();
  const mAfter = (await api('GET', '/api/admin/finance/metrics', null, tok)).data.metrics;

  const creditDelta = Number(after.driver_credits) - Number(before.driver_credits);
  const reportDelta = Number(mAfter.driverEarnings) - Number(mBefore.driverEarnings);
  console.log(`\n  booked ${AMOUNT} durably: journal driver-credit delta=${creditDelta} reported delta=${reportDelta}`);
  check('E4-05', 'the durable ledger records the credit exactly', creditDelta === AMOUNT, { creditDelta });
  check('E4-06', 'the report reflects the money it is reporting on', reportDelta === creditDelta,
    { reportDelta, creditDelta, before: mBefore.driverEarnings, after: mAfter.driverEarnings });

  // Restart-equivalence: the array is process-local, so a second process's view is not this one's.
  const memoryRows = db.transactions.length;
  const durableTxns = Number((await one('SELECT count(*) n FROM journal_transactions')).n);
  check('E4-07', 'the projection and the ledger are different orders of magnitude (scope of the gap)',
    memoryRows < durableTxns, { memory_rows: memoryRows, journal_transactions: durableTxns });
  console.log(`  note: this process's seed+runtime array holds ${memoryRows} rows; PostgreSQL holds ${durableTxns} transactions.`);

  // --- F1-E contract additions: shape, derived key, settlement statuses, no fallback ---
  const EXPECTED_KEYS = ['grossGtv', 'totalCustomerPayments', 'driverEarnings', 'platformRevenue',
    'totalRefunds', 'pendingSettlements', 'completedSettlements', 'outstandingBalances'];
  check('E4-08', 'the response carries exactly the eight original metric keys, unchanged',
    JSON.stringify(Object.keys(mAfter).sort()) === JSON.stringify(EXPECTED_KEYS.slice().sort())
      && Object.values(mAfter).every(v => typeof v === 'number' && Number.isFinite(v)),
    { keys: Object.keys(mAfter) });
  check('E4-09', 'outstandingBalances keeps its definition (earnings - settled), now durable',
    Math.abs(Number(mAfter.outstandingBalances)
      - (Number(mAfter.driverEarnings) - Number(mAfter.completedSettlements))) < 0.01,
    { outstanding: mAfter.outstandingBalances, earnings: mAfter.driverEarnings,
      settled: mAfter.completedSettlements });
  const pay = await one(`SELECT
      coalesce(sum(amount) FILTER (WHERE status='SETTLED'),0)::text settled,
      coalesce(sum(amount) FILTER (WHERE status='INITIATED'),0)::text initiated,
      coalesce(sum(amount) FILTER (WHERE status='PAID'),0)::text paid_status,
      coalesce(sum(amount) FILTER (WHERE status='PENDING'),0)::text pending_status
      FROM driver_payouts`);
  check('E4-10', 'settlement figures use the statuses the schema actually holds',
    Number(mAfter.completedSettlements) === Number(pay.settled)
      && Number(mAfter.pendingSettlements) === Number(pay.initiated),
    { reported_pending: mAfter.pendingSettlements, initiated: pay.initiated,
      reported_completed: mAfter.completedSettlements, settled: pay.settled,
      note: `old memory filters 'PENDING'/'PAID' match ${pay.pending_status}/${pay.paid_status}` });
  // The old calculation, run over this process's projection: if the endpoint were still
  // falling back to memory, it would land near this number instead of the ledger's.
  const memoryStyle = db.transactions
    .filter(t => t.type === 'TRIP_EARNING')
    .reduce((s, t) => s + (t.net || 0), 0);
  check('E4-11', 'stale in-memory state cannot suppress or replace the durable total',
    Math.abs(Number(mAfter.driverEarnings) - memoryStyle) > 1,
    { durable_report: mAfter.driverEarnings, memory_projection_would_say: memoryStyle });

  console.log('\n=== cleanup (dedicated driver retained: it has journal history) ===');
  const hist = await one('SELECT count(*) n FROM journal_lines WHERE entity_id=$1::text', [drv.id]);
  console.log(`  driver ${drv.id} journal lines=${hist.n} -> ${Number(hist.n) > 0 ? 'RETAINED (deleting would strand money)' : 'removable'}`);
  await c.end();
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== E4 METRICS-AUTHORITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
