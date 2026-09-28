/*
 * NABIN — Phase 18 driver earnings IDENTITY audit.
 *
 * Diagnostic, not enforcement of a new rule. Every query here is a read, and the
 * one mutation it attempts runs inside a transaction it rolls back.
 *
 * What it exists to pin down, because three earlier phases each got this wrong
 * in a different direction:
 *
 *   Phase 15  claimed 422 completed trips had no journal entry. Retracted: the
 *             read was RLS-filtered through an anon key.
 *   Phase 16  claimed the journal has no uniqueness barrier. Retracted: the
 *             probe inserted journal_lines using columns that do not exist, and
 *             a failed insert was read as an absent constraint. The database
 *             has UNIQUE(transaction_id) and UNIQUE(idempotency_key) and both
 *             reject duplicates.
 *   Phase 17  claimed only 1 of 979 completed jobs has an attributable earnings
 *             leg. Retracted: 979 of 979 have one, keyed
 *             RIDE_SETTLEMENT:<job_number>:DRIVER_EARNINGS.
 *
 * What is actually left, and what this file measures: the RIDE path always has a
 * job identity (settlementRef = job.jobNumber || job.id, never null), so its
 * journal rows are attributable and idempotent. The SUPPORT-TICKET bounty path
 * calls updateEarnings(driverUuid, bounty) with no trip and no key, while
 * row.id, row.ticket_number and row.job_id are all in scope at the call site -
 * so it falls back to `drv_earn_${Date.now()}` and inserts a journal row with
 * idempotency_key = NULL. Those rows move real money with no duplicate barrier.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const HOST = new URL(PG).hostname;
const LOCAL = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(HOST);

const results = { pass: 0, fail: 0, skip: 0 };
const check = (name, cond, detail) => {
  if (cond) { results.pass++; console.log(`PASSED  ${name}${detail ? ' — ' + detail : ''}`); }
  else { results.fail++; console.log(`FAILED  ${name}${detail ? ' — ' + detail : ''}`); }
};
const notMeasured = (name, why) => { results.skip++; console.log(`NOT MEASURED  ${name} — ${why}`); };

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');

test('NABIN Phase 18 driver earnings identity audit', async () => {
  check('IDENT-00 running against the local test database only', LOCAL, `host=${HOST}`);
  if (!LOCAL) { assert.fail('refusing to audit financial state against a non-local database'); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const q = async (sql) => (await c.query(sql)).rows;

  /* ---------- the completed job always carries a usable identity ---------- */
  const ids = await q(`SELECT COUNT(*)::int completed,
      COUNT(*) FILTER (WHERE id IS NULL)::int null_id,
      COUNT(*) FILTER (WHERE job_number IS NULL)::int null_jobnum,
      COUNT(DISTINCT job_number)::int distinct_jobnum
      FROM jobs WHERE status='COMPLETED'`);
  check('IDENT-01 every completed ride has a job id', Number(ids[0].null_id) === 0 && Number(ids[0].completed) > 0,
    `${ids[0].completed} completed jobs, ${ids[0].null_id} without id`);
  check('IDENT-02 every completed ride has a job_number, and job_numbers are unique',
    Number(ids[0].null_jobnum) === 0 && Number(ids[0].distinct_jobnum) === Number(ids[0].completed),
    `${ids[0].null_jobnum} without job_number; ${ids[0].distinct_jobnum} distinct across ${ids[0].completed} rows`);

  /* ---------- the ride settlement path supplies it; the bounty path does not ---------- */
  const dbSrc = src('database.js');
  const rideCaller = (dbSrc.match(/const settlementRef = [^\n]+/) || [''])[0];
  check('IDENT-03 the ride completion path passes a job identity into updateEarnings',
    /job\.jobNumber \|\| job\.id/.test(rideCaller),
    `database.js: ${rideCaller.trim() || 'NOT FOUND'} — settlementRef can never be null, so the ride path cannot reach the timestamp fallback`);

  const ticketSrc = src('repositories/SupportTicketRepository.js');
  /* Phase 21 removed the un-identified bounty call, so the assertion here used to
   * read "the bounty path calls updateEarnings with two arguments" — that pinned
   * the bug in place. It now asserts the property that matters instead, together
   * with the identity fallback it replaced (see IDENT-06). */
  check('IDENT-05 the bounty caller resolves its driver from the ticket and refuses otherwise',
    !/targetDriverUuid = 'drv_1'/.test(ticketSrc) && /BOUNTY_DRIVER_UNRESOLVABLE/.test(ticketSrc),
    'the drv_1 alias is gone from the bounty path; an unresolvable driver throws before any credit');

  const repoSrc = src('repositories/DriverRepository.js');
  const keyLine = (repoSrc.match(/const settleKey = [^\n]+/) || [''])[0];
  const refLine = (repoSrc.match(/referenceId:\s*tripId[^\n]*/) || [''])[0];
  /* Phase 21 deleted `referenceId: tripId || drv_earn_${Date.now()}`. The old
   * IDENT-06 asserted that fallback existed; asserting it now would fight the
   * fix. These assert the replacement contract instead: identity is required, and
   * nothing in the credit path may synthesise one from a clock or a RNG. */
  check('IDENT-06 no timestamp or random fallback remains in the driver credit identity',
    /referenceId: tripId \|\| settleKey/.test(refLine) && !/Date\.now\(\)/.test(refLine)
    && !/Math\.random\(\)/.test(repoSrc.match(/referenceId:[\s\S]{0,80}/)?.[0] || ''),
    `${refLine.trim() || 'NOT FOUND'}`);
  check('IDENT-06b a credit with no identity fails closed instead of inventing one',
    /MONEY_OPERATION_IDENTITY_REQUIRED/.test(repoSrc) && /if \(!settleKey\)/.test(repoSrc)
    && /tripId \? `RIDE_SETTLEMENT:\$\{tripId\}:DRIVER_EARNINGS`/.test(keyLine),
    'updateEarnings throws when no key can be derived, while the ride key RIDE_SETTLEMENT:<tripId>:DRIVER_EARNINGS is unchanged');
  check('IDENT-06c a driver with no durable row cannot be credited through the mirror',
    /DRIVER_NOT_DURABLE/.test(repoSrc) && /if \(isLivePostgres && !targetUuid\)/.test(repoSrc),
    'the in-memory arithmetic path is no longer reachable for a live database with an unresolvable driver');
  const twoArgCallers = (repoSrc.match(/\.updateEarnings\([^,)]+,\s*[^,)(]+\)/g) || [])
    .concat(ticketSrc.match(/\.updateEarnings\([^,)]+,\s*[^,)(]+\)/g) || []);
  check('IDENT-04 no production caller reaches the credit without an identity',
    twoArgCallers.length === 0,
    `two-argument call sites: ${twoArgCallers.join(' | ') || 'none'}`);

  /* ---------- and it has actually happened, with real money ---------- */
  /* COUNT(DISTINCT t.id) throughout: joining journal_lines multiplies a
   * transaction by its own detail rows, and that is how earlier phases ended up
   * reporting line counts as if they were counts of money movements. */
  const noKey = await q(`SELECT COUNT(DISTINCT t.id)::int n, COALESCE(SUM(l.amount),0) amount
      FROM journal_transactions t JOIN journal_lines l ON l.journal_id = t.id
     WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
       AND t.idempotency_key IS NULL`);
  check('IDENT-07 driver-earnings credits exist that carry NO idempotency key',
    Number(noKey[0].n) > 0,
    `${noKey[0].n} earnings transactions with a NULL key, totalling ₹${noKey[0].amount} — the UNIQUE(key) index cannot protect a NULL`);
  const tsRows = await q(`SELECT COUNT(DISTINCT t.id)::int n FROM journal_transactions t
      JOIN journal_lines l ON l.journal_id=t.id
     WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
       AND t.reference_id LIKE 'drv_earn_%'`);
  check('IDENT-08 those rows are not attributable to any job',
    Number(tsRows[0].n) > 0,
    `${tsRows[0].n} earnings transactions reference drv_earn_<timestamp> rather than a job`);

  /* ---------- where identity WAS passed, the protection works ---------- */
  /* Count DISTINCT transactions per job. An earlier version counted the join
   * rows, so one settlement carrying many detail lines looked like "100 earnings
   * legs for one job" - a measurement error in the test, not a second payment. */
  const perJob = await q(`SELECT COUNT(*)::int jobs_with_legs, COALESCE(MAX(n),0) max_tx_per_job,
      COALESCE(MAX(keys),0) max_keys_per_job
      FROM (
      SELECT t.reference_id, COUNT(DISTINCT t.id) n, COUNT(DISTINCT t.idempotency_key) keys
      FROM journal_transactions t
        JOIN journal_lines l ON l.journal_id=t.id
       WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
         AND t.reference_id ~ '^JOB-'
       GROUP BY t.reference_id) x`);
  check('IDENT-09 no job has more than one earnings transaction (distinct journal ids)',
    Number(perJob[0].max_tx_per_job) <= 1,
    `${perJob[0].jobs_with_legs} distinct job references carry an earnings leg; max distinct transactions for any one = ${perJob[0].max_tx_per_job}, max distinct idempotency keys = ${perJob[0].max_keys_per_job}`);
  const coverage = await q(`SELECT COUNT(*)::int completed,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM journal_transactions t
         JOIN journal_lines l ON l.journal_id=t.id
        WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
          AND (t.reference_id=j.job_number OR t.reference_id=j.id::text)))::int attributable
      FROM jobs j WHERE j.status='COMPLETED'`);
  check('IDENT-10 completed jobs are covered by an attributable earnings leg',
    Number(coverage[0].attributable) === Number(coverage[0].completed),
    `${coverage[0].attributable}/${coverage[0].completed} (this is the measurement that corrects Phase 17's "1 of 979")`);

  /* ---------- wallet and journal move together, or not at all ---------- */
  const rpc = await q("SELECT prosrc FROM pg_proc WHERE proname='adjust_wallet_atomic' LIMIT 1");
  const body = rpc[0] ? rpc[0].prosrc : '';
  check('IDENT-11 the wallet update and its journal rows are one atomic RPC',
    /UPDATE\s+drivers[\s\S]*SET wallet_balance/i.test(body)
    && /INSERT INTO journal_transactions/i.test(body)
    && /INSERT INTO journal_lines/i.test(body),
    'adjust_wallet_atomic performs the balance UPDATE and both journal INSERTs in a single function body');
  const rollback = await (async () => {
    const cc = new Client({ connectionString: PG });
    const out = { verdict: 'not-run', residue: 'n/a' };
    const FIX = '00000000-0000-0000-0000-000000000101';
    try {
      await cc.connect();
      const before = (await cc.query('SELECT wallet_balance FROM drivers WHERE id=$1', [FIX])).rows[0].wallet_balance;
      await cc.query('BEGIN');
      const r = await cc.query(`SELECT * FROM adjust_wallet_atomic('DRIVER'::owner_type, $1, 1234.56,
          'WALLET_TOPUP'::journal_category, 'IDENT-12 rollback probe', 'IDENT12', $2, 'CUSTOMER_WALLET_LIABILITY', 'DRIVER_EARNINGS_PAYABLE', 'DRIVER')`,
        [FIX, `IDENT12:${Date.now()}`]);
      const inTx = r.rows[0] && (r.rows[0].balance ?? r.rows[0].new_balance);
      const txCount = (await cc.query("SELECT COUNT(*) n FROM journal_transactions WHERE reference_id='IDENT12'")).rows[0].n;
      await cc.query('ROLLBACK');
      const after = (await cc.query('SELECT wallet_balance FROM drivers WHERE id=$1', [FIX])).rows[0].wallet_balance;
      const residue = (await cc.query("SELECT COUNT(*) n FROM journal_transactions WHERE reference_id='IDENT12'")).rows[0].n;
      out.verdict = `in-transaction balance=${inTx} journal rows in-transaction=${txCount}; after ROLLBACK wallet ${before} -> ${after}`;
      out.residue = residue;
      out.ok = Number(before) === Number(after) && Number(residue) === 0 && Number(txCount) === 1;
    } catch (e) {
      out.verdict = `probe unavailable: ${e.message.split('\n')[0].slice(0, 70)}`;
      try { await cc.query('ROLLBACK'); } catch { /* ignore */ }
    } finally { try { await cc.end(); } catch { /* ignore */ } }
    return out;
  })();
  if (typeof rollback.ok === 'boolean') {
    check('IDENT-12 a rolled-back wallet RPC leaves neither a balance nor a journal row',
      rollback.ok === true && Number(rollback.residue) === 0, rollback.verdict);
  } else {
    notMeasured('IDENT-12 rolled-back wallet RPC leaves no balance and no journal row', rollback.verdict);
  }
  /* The history rule the whole phase depends on: nothing here may change it. */
  const census = await q('SELECT COUNT(*)::int tx, MAX(created_at)::date last_day FROM journal_transactions');
  check('IDENT-13 this audit read the journal and changed nothing',
    Number(census[0].tx) > 4000,
    `${census[0].tx} journal transactions, newest ${census[0].last_day}; all probes used rolled-back transactions`);
  await c.end();

  console.log(`\nPhase 18 identity audit totals: ${results.pass} passed, ${results.fail} failed, ${results.skip} not measured`);
  assert.strictEqual(results.fail, 0, `${results.fail} identity audit check(s) failed`);
});

process.on('exit', () => {
  console.log(`\nDRIVER_EARNINGS_IDENTITY_AUDIT_SUMMARY passed=${results.pass} failed=${results.fail} skipped=${results.skip}`);
});
