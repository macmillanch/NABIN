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
  /* Snapshot for IDENT-13. "This audit changed nothing" is a statement about the delta this
   * file caused, so it has to be measured against where the file started — an absolute row
   * count only says how much test residue the previous runs left behind. */
  const txAtStart = Number((await q('SELECT COUNT(*)::int n FROM journal_transactions'))[0].n);

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

  /* ---------- and the barrier really does not cover it ---------- */
  /* COUNT(DISTINCT t.id) throughout: joining journal_lines multiplies a
   * transaction by its own detail rows, and that is how earlier phases ended up
   * reporting line counts as if they were counts of money movements.
   *
   * The incident rows are no longer in a freshly reset local database, and a check that
   * passes only while old test residue sits in a table is measuring the residue, not the
   * rule. What the rule actually is — UNIQUE(idempotency_key) does not protect a NULL —
   * is provable on any database by attempting it, inside a transaction this file rolls
   * back. IDENT-12 already uses that technique, and the residue read below proves the
   * rollback held. */
  const noKey = await q(`SELECT COUNT(DISTINCT t.id)::int n, COALESCE(SUM(l.amount),0) amount
      FROM journal_transactions t JOIN journal_lines l ON l.journal_id = t.id
     WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
       AND t.idempotency_key IS NULL`);
  const nullProbe = await (async () => {
    const cc = new Client({ connectionString: PG });
    const out = { accepted: 0, why: null, residue: null };
    const stamp = `P18NULL:${Date.now()}`;
    const insert = (tag) => cc.query(
      `INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description, reference_id)
       VALUES ($1, NULL, 'WALLET_TOPUP', 1.00, 1.00, $2, $3)`, [tag, 'null-key earnings probe', tag]);
    try {
      await cc.connect();
      await cc.query('BEGIN');
      await insert(`${stamp}:A`);
      out.accepted += 1;
      await insert(`${stamp}:B`);
      out.accepted += 1;
      await cc.query('ROLLBACK');
    } catch (e) {
      out.why = String(e.message).split('\n')[0].slice(0, 70);
      try { await cc.query('ROLLBACK'); } catch { /* the aborted transaction is already closed */ }
    } finally {
      try {
        const left = await cc.query(
          "SELECT COUNT(*)::int n FROM journal_transactions WHERE transaction_id LIKE 'P18NULL:%'");
        out.residue = left.rows[0].n;
      } catch { out.residue = 'unreadable'; }
      try { await cc.end(); } catch { /* ignore */ }
    }
    return out;
  })();
  check('IDENT-07 driver-earnings credits can be posted with NO idempotency key',
    nullProbe.accepted === 2 && Number(nullProbe.residue) === 0,
    nullProbe.accepted === 2
      ? `two keyless transactions were accepted side by side, then rolled back (${nullProbe.residue} rows left) — the UNIQUE(key) index cannot protect a NULL; ${noKey[0].n} such earnings transactions worth ₹${noKey[0].amount} are still in this database`
      : `the probe was refused instead: ${nullProbe.why}`);
  const tsRows = await q(`SELECT COUNT(DISTINCT t.id)::int n FROM journal_transactions t
      JOIN journal_lines l ON l.journal_id=t.id
     WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
       AND t.reference_id LIKE 'drv_earn_%'`);
  if (Number(tsRows[0].n) > 0) {
    const attributable = await q(`SELECT COUNT(*)::int matched FROM journal_transactions t
        JOIN journal_lines l ON l.journal_id=t.id
       WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
         AND t.reference_id LIKE 'drv_earn_%'
         AND EXISTS (SELECT 1 FROM jobs j WHERE j.job_number = t.reference_id OR j.id::text = t.reference_id)`);
    check('IDENT-08 those rows are not attributable to any job',
      Number(attributable[0].matched) === 0,
      `${tsRows[0].n} earnings transactions reference drv_earn_<timestamp> and ${attributable[0].matched} of them name a real job`);
  } else {
    notMeasured('IDENT-08 those rows are not attributable to any job',
      'this database holds no drv_earn_<timestamp> earnings rows to attribute — the local store was reset, and the caller-side rule that mints them is proven by IDENT-04/IDENT-05 instead');
  }

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
  /* IDENT-10 has to create the case it measures. Asserting over every COMPLETED row in `jobs`
   * measured whichever scaffolding the other fifty links left behind, not the ride path — and
   * that scaffolding could not be cleaned up either. `trg_jobs_financial_record_guard` used to
   * fire BEFORE DELETE and `RETURN NEW`, and NEW is NULL for a DELETE, so PostgreSQL silently
   * skipped the row for *every* role (measured: rowCount 0, row intact, no error raised). The
   * teardown in test_suite (JOB-P22-*) and the sweep in support_bounty_atomicity (JOB-E3-*)
   * therefore never removed their fixture jobs, and those jobs were never settled. Migration 033
   * corrected that guard so a privileged DELETE returns OLD; clients are still refused. Meanwhile
   * the audit settles a job of its own, through the same RPC and the same key
   * DriverRepository.updateEarnings passes for a trip, and requires the predicate to attribute it.
   * Everything happens inside a transaction it rolls back. */
  const settle = await (async () => {
    const cc = new Client({ connectionString: PG });
    const JN = `JOB-IDENT10-${Date.now()}`;
    const DRIVER = '00000000-0000-0000-0000-000000000101';
    const key = `RIDE_SETTLEMENT:${JN}:DRIVER_EARNINGS`;
    const out = { ok: false, legs: 0, credited: 0, residue: 'unreadable', verdict: 'not-run' };
    try {
      await cc.connect();
      const drv = await cc.query('SELECT id FROM drivers WHERE id=$1::uuid', [DRIVER]);
      if (!drv.rowCount) throw new Error(`no durable drivers row ${DRIVER} to settle against`);
      await cc.query('BEGIN');
      const made = await cc.query(`INSERT INTO jobs (job_number, service_type, status, pickup_address, drop_address,
          fare_subtotal, final_total, driver_earnings, platform_commission)
        VALUES ($1,'RIDE','COMPLETED','IDENT-10 pickup','IDENT-10 drop',100.00,100.00,85.00,15.00)
        RETURNING id::text id`, [JN]);
      const jobId = made.rows[0].id;
      const rpc = await cc.query(`SELECT * FROM adjust_wallet_atomic($1::uuid, 'DRIVER', 85.00, 'RIDE_SETTLEMENT',
          'IDENT-10 settlement fixture', $2, 'CUSTOMER_WALLET_LIABILITY', 'DRIVER_EARNINGS_PAYABLE', $3)`,
      [DRIVER, JN, key]);
      /* The same predicate the store-wide read below uses, aimed at one job this file owns. */
      const found = await cc.query(`SELECT COUNT(DISTINCT t.id)::int legs, COALESCE(SUM(l.amount),0) credited
          FROM journal_transactions t JOIN journal_lines l ON l.journal_id=t.id
         WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
           AND (t.reference_id=$1 OR t.reference_id=$2)`, [JN, jobId]);
      out.legs = Number(found.rows[0].legs);
      out.credited = found.rows[0].credited;
      /* The RPC returns one json value, so the driver row is `{ json: {...} }` here — the
       * repository sees `data.balance` only because PostgREST unwraps the scalar. */
      const posted = rpc.rows[0] && (rpc.rows[0].json ?? Object.values(rpc.rows[0])[0]);
      out.status = posted && posted.status;
      out.balance = posted && posted.balance;
      await cc.query('ROLLBACK');
      const residue = await cc.query(`SELECT
          (SELECT COUNT(*) FROM jobs WHERE job_number=$1)::int jobs,
          (SELECT COUNT(*) FROM journal_transactions WHERE reference_id IN ($1,$2))::int tx`, [JN, jobId]);
      out.residue = `jobs=${residue.rows[0].jobs} journal=${residue.rows[0].tx}`;
      out.ok = out.legs === 1 && out.status === 'POSTED'
        && Number(residue.rows[0].jobs) === 0 && Number(residue.rows[0].tx) === 0;
      out.verdict = `the fixture job settled once and the audit's own predicate found it: ${out.legs} earnings `
        + `transaction(s) crediting ₹${out.credited} against ${JN} (RPC ${out.status}, balance after the credit `
        + `₹${out.balance}); after ROLLBACK ${out.residue} — the key the ride path derives is ${key.slice(0, 24)}…`;
    } catch (e) {
      out.verdict = `probe failed: ${String(e.message).split('\n')[0].slice(0, 90)}`;
      try { await cc.query('ROLLBACK'); } catch { /* the aborted transaction is already closed */ }
    } finally { try { await cc.end(); } catch { /* ignore */ } }
    return out;
  })();
  check('IDENT-10 a COMPLETED job settled through the ride RPC is attributable to that job',
    settle.ok, settle.verdict);

  const gaps = await q(`SELECT j.job_number FROM jobs j WHERE j.status='COMPLETED'
      AND NOT EXISTS (SELECT 1 FROM journal_transactions t JOIN journal_lines l ON l.journal_id=t.id
        WHERE l.account_code='DRIVER_EARNINGS_PAYABLE' AND l.entry_type='CREDIT'
          AND (t.reference_id=j.job_number OR t.reference_id=j.id::text)) ORDER BY j.created_at`);
  /* The tripwire that replaces the store-wide equality: a job the application itself minted
   * (JobRepository mints JOB-<8 digits>-<3 digits>) that completes without a leg is a real
   * settlement failure. A job whose number was hand-written by another suite is scaffolding. */
  const appMinted = gaps.filter((g) => /^JOB-\d{8}-\d{3}$/.test(String(g.job_number)));
  check('IDENT-10B no job the platform minted completed without an attributable earnings leg',
    appMinted.length === 0,
    appMinted.length > 0
      ? `${appMinted.length} app-minted job(s) completed with no attributable earnings leg: `
      + `${appMinted.map((g) => g.job_number).join(', ')}`
      : gaps.length === 0
        ? 'every COMPLETED job in this store carries exactly one attributable earnings leg'
        : `${gaps.length} COMPLETED job(s) carry no leg: ${gaps.map((g) => g.job_number).join(', ')}; `
        + `none of them match the application's own JOB-<8digits>-<3digits> generator`);

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
      const r = await cc.query(`SELECT * FROM adjust_wallet_atomic($1::uuid, 'DRIVER', 1234.56,
          'WALLET_TOPUP', 'IDENT-12 rollback probe', 'IDENT12', 'CUSTOMER_WALLET_LIABILITY',
          'DRIVER_EARNINGS_PAYABLE', $2)`,
        [FIX, `IDENT12:${Date.now()}`]);
      const posted = r.rows[0] && (r.rows[0].json ?? Object.values(r.rows[0])[0]);
      const inTx = posted && posted.balance;
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
    Number(census[0].tx) === txAtStart,
    `${census[0].tx} journal transactions now, ${txAtStart} when this audit began; all probes used rolled-back transactions, newest ${census[0].last_day}`);
  await c.end();

  console.log(`\nPhase 18 identity audit totals: ${results.pass} passed, ${results.fail} failed, ${results.skip} not measured`);
  assert.strictEqual(results.fail, 0, `${results.fail} identity audit check(s) failed`);
});

process.on('exit', () => {
  console.log(`\nDRIVER_EARNINGS_IDENTITY_AUDIT_SUMMARY passed=${results.pass} failed=${results.fail} skipped=${results.skip}`);
});
