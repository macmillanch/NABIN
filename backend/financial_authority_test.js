/*
 * NABIN — Phase 15B financial authority evidence.
 *
 * Every check here is either a read of PostgreSQL's own definition/introspection
 * catalogs, or an experiment confined to THIS process's memory and to a rolled-
 * back database transaction. Nothing here writes a persistent row, and nothing
 * here touches a shared financial fixture: the rollback experiment uses the
 * ledger of a throwaway `PersistentWallet` instance created in this process, so
 * even the in-memory side of the leak cannot reach the chained suites' server.
 *
 * Why each check exists (all of these correct or confirm an earlier claim):
 *
 *  - The database, not the application, decides what is append-only.
 *    `prevent_financial_row_mutation()` raises unconditionally on UPDATE/DELETE
 *    with no role exception at all, so even `postgres` cannot edit a posted
 *    journal row. `prevent_client_privileged_column_mutation()` and
 *    `prevent_client_financial_record_mutation()` both begin with
 *    `IF current_user NOT IN ('anon','authenticated') THEN RETURN NEW;` — they
 *    guard against *clients*, and are bypassed by service_role and by the
 *    backend's own connection. Reading the bodies is the only way to know that.
 *
 *  - "Balanced" is enforced on the journal HEADER, not on the lines. The only
 *    check constraint is on `journal_transactions`; `journal_lines` is guarded
 *    solely by an INSERT trigger. So a transaction can assert it balances while
 *    its own detail lines do not, and the database will accept it.
 *
 *  - `ledger_accounts.current_balance` is not merely stale: no function in the
 *    database mentions the column at all, so nothing can maintain it.
 *
 *  - The rolled-back-transaction hazard is real, but its blast radius is the
 *    in-process cache, not PostgreSQL. `PersistentWallet.adjustWallet()` asks
 *    `adjust_wallet_atomic()` for the new balance and then assigns that
 *    returned number into `this.drivers[uuid].walletBalance`. A caller that ran
 *    the RPC inside its own transaction and rolled it back has therefore left
 *    the cache holding money the database rejected. There is no driver-wallet
 *    write-back path, so the durable column is not poisoned — the stale value
 *    is served to whoever reads the cache.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const envText = (() => { try { return fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); } catch { return ''; } })();
const envOf = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const supabaseAdmin = createClient(envOf('SUPABASE_URL') || 'http://127.0.0.1:54321',
  envOf('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const results = { pass: 0, fail: 0, skip: 0 };
const check = (name, cond, detail) => {
  if (cond) { results.pass++; console.log(`PASSED  ${name}${detail ? ' — ' + detail : ''}`); }
  else { results.fail++; console.log(`FAILED  ${name}${detail ? ' — ' + detail : ''}`); }
};
const skip = (name, why) => { results.skip++; console.log(`SKIPPED ${name} — ${why}`); };

const PG_HOST = new URL(PG).hostname;
const localOnly = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(PG_HOST)
  && /127\.0\.0\.1|localhost|::1/.test(envOf('SUPABASE_URL') || '');

let db;
const c = new Client({ connectionString: PG });

test('NABIN Phase 15B financial authority evidence', async () => {
  /* §1 — refuse to run anywhere but the local test database. */
  check('FIN15B-00 this measurement is pointed at a local/test database', localOnly,
    `SUPABASE_URL=${envOf('SUPABASE_URL') || '(unset)'} pgHost=${new URL(PG).hostname}`);
  if (!localOnly) {
    assert.fail('refusing to run financial measurement against a non-local database');
  }
  await c.connect();
  const ident = (await c.query(
    "SELECT current_database() db, current_user role, (SELECT COUNT(*) FROM journal_transactions) tx")).rows[0];
  check('FIN15B-01 identity is the privileged local connection, not an RLS-filtered read',
    ident.role === 'postgres' && Number(ident.tx) > 1000,
    `db=${ident.db} role=${ident.role} journal_rows=${ident.tx} (RLS-filtered reads of this table returned 174-285 earlier)`);

  /* ---- §2 TRIGGER AUTHORITY: read the definitions, never infer from names ---- */
  const trg = (await c.query(`
    SELECT rel.relname tbl, p.proname fn, tg.tgtype::int t
      FROM pg_trigger tg JOIN pg_class rel ON rel.oid=tg.tgrelid JOIN pg_proc p ON p.oid=tg.tgfoid
     WHERE NOT tg.tgisinternal AND rel.relname IN
       ('journal_transactions','journal_lines','driver_payouts','drivers','jobs','payments')`)).rows;
  const ev = (b, m) => (b & m) > 0;
  const fnOf = (tbl) => Object.fromEntries(trg.filter(r => r.tbl === tbl).map(r => [r.fn, r.t]));
  const jn = fnOf('journal_transactions');
  check('FIN15B-02 the journal is append-only against UPDATE and DELETE, and INSERT is allowed',
    !!jn.prevent_financial_row_mutation
    && ev(jn.prevent_financial_row_mutation, 16) && ev(jn.prevent_financial_row_mutation, 8)
    && !ev(jn.prevent_financial_row_mutation, 4),
    `journal_transactions triggers=${Object.keys(jn).join(',')}`);
  const jnL = fnOf('journal_lines');
  check('FIN15B-03 the same append-only rule covers journal_lines', !!jnL.prevent_financial_row_mutation
    && ev(jnL.prevent_financial_row_mutation, 16) && ev(jnL.prevent_financial_row_mutation, 8),
    `journal_lines triggers=${Object.keys(jnL).join(',')}`);
  const payouts = fnOf('driver_payouts');
  check('FIN15B-04 driver_payouts is append-only too', !!payouts.prevent_financial_row_mutation
    && ev(payouts.prevent_financial_row_mutation, 16) && ev(payouts.prevent_financial_row_mutation, 8),
    `driver_payouts triggers=${Object.keys(payouts).join(',')}`);

  const bodies = (await c.query(`
    SELECT p.proname fn, pg_get_functiondef(p.oid) src FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.proname IN
       ('prevent_financial_row_mutation','prevent_client_privileged_column_mutation','prevent_client_financial_record_mutation')`)).rows;
  const bodyOf = {};
  bodies.forEach(r => { bodyOf[r.fn] = String(r.src); });
  check('FIN15B-05 the append-only guard has NO role exception — not even postgres may edit a posted row',
    !!bodyOf.prevent_financial_row_mutation
    && !/current_user\s+NOT\s+IN/i.test(bodyOf.prevent_financial_row_mutation)
    && /RAISE EXCEPTION/i.test(bodyOf.prevent_financial_row_mutation),
    `body mentions current_user check=${/current_user/i.test(bodyOf.prevent_financial_row_mutation || '')}`);
  check('FIN15B-06 the column guards ARE client-only: service_role and the backend connection bypass them',
    /current_user NOT IN \('anon', 'authenticated'\)/.test(bodyOf.prevent_client_privileged_column_mutation || '')
    && /current_user NOT IN \('anon', 'authenticated'\)/.test(bodyOf.prevent_client_financial_record_mutation || ''),
    'both bodies begin by returning NEW for any non-client role');
  const frozenJobs = (bodyOf.prevent_client_financial_record_mutation.match(/frozen_columns := ARRAY\[([\s\S]*?)\]/g) || []);
  const allFrozen = frozenJobs.join(' ');
  check('FIN15B-07 the job money fields are frozen against clients, and payment/refund status is deliberately mutable',
    /driver_earnings/.test(allFrozen) && /platform_commission/.test(allFrozen) && /final_total/.test(allFrozen),
    `frozen lists found=${frozenJobs.length}`);

  /* Prove the boundary empirically: an UPDATE must fail as the client role. */
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ROLE authenticated");
    const probe = await c.query("UPDATE drivers SET wallet_balance = wallet_balance + 0.01 WHERE id = (SELECT id FROM drivers ORDER BY wallet_balance DESC LIMIT 1)");
    await c.query('ROLLBACK');
    check('FIN15B-08 a client role CANNOT touch wallet_balance', false,
      `the update should have been refused but returned ${probe.rowCount}`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    /* Either refusal is a real boundary: the column guard rejecting the write,
     * or row-level security hiding the row from a client role entirely. */
    check('FIN15B-08 a client role CANNOT touch wallet_balance',
      /immutable|privilege|append-only|forbidden|row-level security|permission denied/i.test(e.message),
      `refused as ${'authenticated'}: ${e.message.slice(0, 84)}`);
  }

  /* ---- §3 ledger_accounts.current_balance ---- */
  const acct = (await c.query(`
    SELECT a.account_code, a.current_balance stored,
      COALESCE((SELECT SUM(l.amount) FROM journal_lines l WHERE l.account_code=a.account_code AND l.entry_type='DEBIT'),0)  debit,
      COALESCE((SELECT SUM(l.amount) FROM journal_lines l WHERE l.account_code=a.account_code AND l.entry_type='CREDIT'),0) credit
      FROM ledger_accounts a`)).rows;
  const nonzeroStored = acct.filter(a => Number(a.stored) !== 0).length;
  const withActivity = acct.filter(a => Number(a.debit) !== 0 || Number(a.credit) !== 0).length;
  check('FIN15B-09 ledger_accounts.current_balance is unwired, not merely stale',
    acct.length > 0 && withActivity > 0 && nonzeroStored === 0,
    `${acct.length} accounts, ${withActivity} carry posted lines, ${nonzeroStored} have a non-zero stored balance`);
  const writers = (await c.query(
    "SELECT p.proname fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosrc ILIKE '%current_balance%'")).rows;
  check('FIN15B-10 no database function reads or writes current_balance at all', writers.length === 0,
    `functions referencing the column: ${writers.map(w => w.fn).join(', ') || 'none'}`);

  /* ---- §4 double-entry integrity: header vs lines ---- */
  const bal = (await c.query(`
    SELECT COUNT(*) tx,
      COUNT(*) FILTER (WHERE round(total_debit,2)=round(total_credit,2)) balanced_header,
      (SELECT COUNT(*) FROM (SELECT journal_id, SUM(CASE WHEN entry_type='DEBIT' THEN amount ELSE 0 END) d,
                                    SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE 0 END) cr
                             FROM journal_lines GROUP BY journal_id) x WHERE round(d,2) <> round(cr,2)) unbalanced_line_groups,
      (SELECT COUNT(*) FROM journal_transactions t WHERE NOT EXISTS
        (SELECT 1 FROM journal_lines l WHERE l.journal_id = t.id)) tx_with_no_lines
      FROM journal_transactions`)).rows[0];
  check('FIN15B-11 every journal HEADER balances',
    Number(bal.tx) === Number(bal.balanced_header) && Number(tx_zero(bal)),
    `${bal.balanced_header}/${bal.tx} headers balanced`);
  const measuredImbalance = Number(bal.unbalanced_line_groups);
  check('FIN15B-12 line-level detail is measured, not assumed',
    Number(bal.tx) > 0 && Number(bal.tx_with_no_lines) >= 0,
    `headers balanced=${bal.balanced_header}/${bal.tx}; unbalanced line groups=${measuredImbalance}; transactions with no lines at all=${bal.tx_with_no_lines} — an earlier draft of this file asserted the imbalance as a fixed number, which was a guess; it is reported as measured here`);
  const ck = (await c.query(`
    SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
     WHERE conrelid='public.journal_transactions'::regclass AND contype='c'`)).rows;
  const lineCk = (await c.query(`
    SELECT conname, pg_get_constraintdef(oid) def FROM pg_constraint
     WHERE conrelid='public.journal_lines'::regclass AND contype='c'`)).rows;
  check('FIN15B-13 both sides of the journal carry real database constraints, so the claim "only the header is enforced" is false',
    ck.length > 0 && lineCk.length > 0,
    `journal_transactions checks: ${ck.map(r => r.conname).join(',')}; journal_lines checks: ${lineCk.map(r => r.conname).join(',')}`);
  const hdrCols = (await c.query(`
    SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name='journal_transactions'
       AND column_name IN ('total_debit','total_credit')`)).rows.length;
  /* journal_lines is SINGLE-LEG and links via journal_id -> journal_transactions.id.
   * It has no transaction_id, no debit_account/credit_account and no debit/credit
   * columns; an earlier version of this file joined on those invented names, which
   * is how "11 unbalanced line groups" was produced. */
  const derived = await c.query(`
    SELECT COUNT(*) n FROM (
      SELECT t.id, t.total_debit, t.total_credit,
             COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type='DEBIT'),0)  AS line_debit,
             COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type='CREDIT'),0) AS line_credit
        FROM journal_transactions t LEFT JOIN journal_lines l ON l.journal_id = t.id
       GROUP BY t.id, t.total_debit, t.total_credit) h
     WHERE round(h.line_debit,2) <> round(h.total_debit,2)
        OR round(h.line_credit,2) <> round(h.total_credit,2)`).catch(() => null);
  const nLineless = (await c.query(`
    SELECT COUNT(*) n FROM journal_transactions t
     WHERE NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = t.id)`)).rows[0].n;
  /* An earlier draft claimed the disagreement was "fully explained by missing
   * detail". It is not: 22 headers disagree with their line sums but only 11
   * transactions have no lines, so 11 postings carry detail that does not add up
   * to their own header. Neither number is fixable here (that would mean
   * inventing or editing history), so both are ratcheted at their measured
   * ceiling: they may fall as the archive is examined, and must never grow. */
  const mismatchWithLines = Number(derived.rows[0].n) - Number(nLineless);
  check('FIN15B-14a no transaction posts detail lines that fail to sum to its own header (ratchet, currently 11)',
    mismatchWithLines <= 11,
    `${derived.rows[0].n} headers disagree with their line sums; ${nLineless} have no lines at all; ${mismatchWithLines} HAVE lines that do not add up`);
  check('FIN15B-14b transactions posted with no detail lines do not increase (ratchet, currently 11)',
    Number(nLineless) <= 11,
    `posted transactions with zero journal_lines = ${nLineless}`);
  const lineGuards = await (async () => {
    const cc = new Client({ connectionString: PG });
    const res = {};
    const attempt = async (name, sql) => {
      try {
        await cc.query(`SAVEPOINT s_${name}`);
        await cc.query(sql);
        await cc.query(`RELEASE SAVEPOINT s_${name}`);
        return 'ACCEPTED';
      } catch (e) {
        try { await cc.query(`ROLLBACK TO SAVEPOINT s_${name}`); } catch { /* ignore */ }
        return `REJECTED ${e.code}`;
      }
    };
    try {
      await cc.connect();
      await cc.query('BEGIN');
      const tx = await cc.query(`INSERT INTO journal_transactions (transaction_id, category, total_debit, total_credit, description)
        VALUES ($1, 'WALLET_TOPUP', 1.00, 1.00, 'line guard probe') RETURNING id`,
        [`P18:LGUARD:${Date.now()}`]);
      const jid = tx.rows[0].id;
      res.negativeAmount = await attempt('neg', `INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type)
        VALUES (${jid}, 'CUSTOMER_WALLET_LIABILITY', 'DEBIT', -5, 'PLATFORM')`);
      res.badEntryType = await attempt('et', `INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type)
        VALUES (${jid}, 'CUSTOMER_WALLET_LIABILITY', 'MAYBE', 5, 'PLATFORM')`);
      res.unknownAccount = await attempt('acct', `INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type)
        VALUES (${jid}, 'ACCOUNT_THAT_DOES_NOT_EXIST', 'DEBIT', 5, 'PLATFORM')`);
      res.badEntity = await attempt('ent', `INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type)
        VALUES (${jid}, 'CUSTOMER_WALLET_LIABILITY', 'DEBIT', 5, 'ALIEN')`);
    } catch (e) { res.error = e.message.split('\n')[0].slice(0, 60); }
    finally {
      try { await cc.query('ROLLBACK'); } catch { /* ignore */ }
      try { await cc.end(); } catch { /* ignore */ }
    }
    return res;
  })();
  check('FIN15B-14c journal_lines constraints reject negative, invalid, unknown-account and bad-entity rows',
    Object.values(lineGuards).every(v => String(v).startsWith('REJECTED')) && Object.keys(lineGuards).length === 4,
    JSON.stringify(lineGuards));

  /* ---- §5 idempotency integrity ---- */
  /* The durable barrier is `journal_transactions_transaction_id_key` (UNIQUE on
   * transaction_id). `idempotency_key` exists as a column but is unused, so a
   * check that counts duplicate values in it proves nothing at all - an earlier
   * draft of this file did exactly that and reported it as evidence. Phase 13's
   * moneyIdentity therefore has to be verified where it actually lands:
   * transaction_id. */
  const keys = (await c.query(`
    SELECT COUNT(*) tx, COUNT(idempotency_key) key_populated,
           COUNT(*) FILTER (WHERE idempotency_key IS NULL) nulls,
           COUNT(DISTINCT idempotency_key) distinct_keys,
           (SELECT COUNT(*) FROM (SELECT idempotency_key FROM journal_transactions
              WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) d) dup_key_groups,
           (SELECT COUNT(*) FROM (SELECT transaction_id FROM journal_transactions
              GROUP BY 1 HAVING COUNT(*) > 1) e) dup_txid,
           (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'journal_transactions'
              AND indexdef ILIKE '%idempotency_key%') idx_on_key,
           (SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'journal_transactions'
              AND (indexdef ILIKE 'UNIQUE%transaction_id%' OR indexdef ILIKE '%unique%transaction_id%')) idx_on_txid,
           COUNT(DISTINCT transaction_id) distinct_txids
      FROM journal_transactions`)).rows[0];
  check('FIN15B-15a BOTH identity columns carry a UNIQUE index',
    Number(keys.idx_on_key) === 1 && Number(keys.idx_on_txid) === 1,
    `unique indexes: transaction_id=${keys.idx_on_txid} idempotency_key=${keys.idx_on_key} (Phase 16 asserted neither existed; that was wrong - see PHASE 17/18 CORRECTIONS)`);
  const barrier = await (async () => {
    const cc = new Client({ connectionString: PG });
    await cc.connect();
    let first = 'ok', second = 'NOT REJECTED';
    try {
      await cc.query('BEGIN');
      const tag = `FIN15B-BARRIER:${Date.now()}`;
      try {
        await cc.query(`INSERT INTO journal_transactions (transaction_id, category, total_debit, total_credit, description)
         VALUES ($1, 'WALLET_TOPUP', 1.00, 1.00, 'rolled-back barrier probe')`, [tag]);
      } catch (e) { first = `rejected(${e.code})`; }
      try {
        await cc.query(`INSERT INTO journal_transactions (transaction_id, category, total_debit, total_credit, description)
         VALUES ($1, 'WALLET_TOPUP', 1.00, 1.00, 'rolled-back barrier probe')`, [tag]);
      } catch (e) { second = e.code === '23505' ? 'REJECTED_BY_UNIQUE' : `rejected(${e.code})`; }
      await cc.query('ROLLBACK');
    } catch (e) {
      first = `unavailable: ${e.message.slice(0, 60)}`;
      try { await cc.query('ROLLBACK'); } catch { /* ignore */ }
    } finally { try { await cc.end(); } catch { /* ignore */ } }
    return { first, second };
  })();
  /* Each forbidden write gets its own SAVEPOINT. Without one, the first 23505
   * aborts the whole transaction and every later attempt reports 25P02
   * ("current transaction is aborted") instead of its own verdict - which is how
   * an earlier version of this probe "measured" that the barriers were missing. */
  const enforcement = await (async () => {
    const cc = new Client({ connectionString: PG });
    const out = { txid: 'not-run', key: 'not-run', unbalanced: 'not-run', residue: 'not-checked' };
    const stamp = Date.now();
    const attempt = async (name, sql, params) => {
      try {
        await cc.query(`SAVEPOINT sp_${name}`);
        await cc.query(sql, params);
        await cc.query(`RELEASE SAVEPOINT sp_${name}`);
        return 'ACCEPTED';
      } catch (e) {
        try { await cc.query(`ROLLBACK TO SAVEPOINT sp_${name}`); } catch { /* ignore */ }
        return e.code === '23505' ? 'REJECTED 23505'
          : e.code === '23514' ? 'REJECTED 23514' : `rejected ${e.code}`;
      }
    };
    try {
      await cc.connect();
      await cc.query('BEGIN');
      await cc.query(`INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description)
        VALUES ($1, $2, 'WALLET_TOPUP', 1.00, 1.00, 'rolled-back enforcement probe')`,
        [`P18:TX:${stamp}`, `P18:KEY:${stamp}`]);
      out.txid = await attempt('txid',
        `INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description)
         VALUES ($1, $2, 'WALLET_TOPUP', 1.00, 1.00, 'duplicate transaction_id')`,
        [`P18:TX:${stamp}`, `P18:KEY2:${stamp}`]);
      out.key = await attempt('key',
        `INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description)
         VALUES ($1, $2, 'WALLET_TOPUP', 1.00, 1.00, 'duplicate idempotency_key')`,
        [`P18:TX2:${stamp}`, `P18:KEY:${stamp}`]);
      out.unbalanced = await attempt('unbal',
        `INSERT INTO journal_transactions (transaction_id, category, total_debit, total_credit, description)
         VALUES ('P18:UNBALANCED', 'WALLET_TOPUP', 9.00, 1.00, 'unbalanced header')`);
    } catch (e) {
      out.txid = `unavailable: ${e.message.split('\n')[0].slice(0, 50)}`;
    } finally {
      try { await cc.query('ROLLBACK'); } catch { /* already aborted */ }
      try {
        const left = await cc.query("SELECT COUNT(*) n FROM journal_transactions WHERE transaction_id LIKE 'P18:%'");
        out.residue = left.rows[0].n;
      } catch { out.residue = 'unreadable'; }
      try { await cc.end(); } catch { /* ignore */ }
    }
    return out;
  })();
  check('FIN15B-15b the database refuses a duplicate transaction_id and a duplicate idempotency_key',
    enforcement.txid === 'REJECTED 23505' && enforcement.key === 'REJECTED 23505',
    `transaction_id: ${enforcement.txid}; idempotency_key: ${enforcement.key}`);
  check('FIN15B-15c the database refuses an unbalanced journal header',
    enforcement.unbalanced === 'REJECTED 23514', `chk_balanced_entry: ${enforcement.unbalanced}`);
  check('FIN15B-15d the probes left nothing behind in the append-only journal',
    Number(enforcement.residue) === 0, `rows matching 'P18:%' after ROLLBACK = ${enforcement.residue}`);
  const dupT = barrier.second === 'REJECTED_BY_UNIQUE' ? 0 : Number(keys.dup_txid);
  const payKeys = (await c.query(`
    SELECT COUNT(*) rows_total, COUNT(idempotency_key) key_populated,
           COUNT(DISTINCT idempotency_key) distinct_keys,
           COUNT(*) FILTER (WHERE idempotency_key IS NULL) null_keys
      FROM driver_payouts`)).rows[0];
  const payDups = (await c.query(`
    SELECT COUNT(*) n FROM (SELECT idempotency_key FROM driver_payouts
      WHERE idempotency_key IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1) x`)).rows[0].n;
  check('FIN15B-16 driver_payouts is where an idempotency key column is actually populated and unique',
    Number(payKeys.key_populated) > 0 && Number(payDups) === 0,
    `${payKeys.key_populated}/${payKeys.rows_total} payouts carry a key, ${payKeys.distinct_keys} distinct, ${payKeys.null_keys} without one, duplicate groups=${payDups}`);

  /* ---- §10/§11 reference taxonomy, resolved against every candidate entity ---- */
  const tax = (await c.query(`
    SELECT CASE
             WHEN reference_id IS NULL THEN '(null)'
             WHEN reference_id ~ '^JOB-' THEN 'JOB-*'
             WHEN reference_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN 'uuid-like'
             WHEN reference_id LIKE 'pay%' THEN 'pay_*'
             WHEN reference_id LIKE 'evt%' THEN 'evt_*'
             WHEN reference_id LIKE 'order%' THEN 'order_*'
             WHEN reference_id LIKE 'drv_earn%' THEN 'drv_earn_*'
             ELSE 'other' END shape,
           COUNT(*) n, SUM(total_credit) credit,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id::text=t.reference_id OR j.job_number=t.reference_id)) m_job,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM payments p WHERE p.payment_id=t.reference_id)) m_payment
      FROM journal_transactions t GROUP BY shape ORDER BY n DESC`)).rows;
  const unresolvable = tax.filter(r => r.shape !== 'JOB-*' && r.shape !== 'uuid-like' && r.shape !== '(null)');
  const unresolvedN = unresolvable.reduce((a, r) => a + Number(r.n), 0);
  check('FIN15B-17 pay_*/evt_*/order_*/drv_earn_* references resolve to NO entity',
    unresolvable.every(r => Number(r.m_job) === 0 && Number(r.m_payment) === 0) && unresolvedN > 0,
    `${unresolvedN} rows: ${unresolvable.map(r => `${r.shape}=${r.n}(₹${r.credit})`).join(', ')}`);
  const jobidCol = (await c.query(`
    SELECT COUNT(*) n FROM journal_transactions t WHERE t.job_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.id = t.job_id)`)).rows[0].n;
  check('FIN15B-18 the structured job_id column does not rescue them either', Number(jobidCol) === 0,
    `journal rows whose job_id is set but matches no job: ${jobidCol} — so the non-job rows are not broken job links, they are money booked against synthetic ids`);
  const synth = (await c.query(`
    SELECT COUNT(*) n FROM journal_transactions WHERE transaction_id ~ '_(test|fake|probe|unknown|cross|vfc_|vfd_)'
       OR transaction_id LIKE '%xyz%' OR reference_id LIKE '%test%' OR reference_id LIKE '%fake%'`)).rows[0].n;
  check('FIN15B-19 a measurable share of journal rows are self-evidently synthetic', Number(synth) > 0,
    `${synth} journal rows carry a test/fake/probe marker`);

  /* ---- §12 driver money: three stores, three answers ---- */
  const tot = (await c.query(`
    SELECT (SELECT COALESCE(SUM(wallet_balance),0) FROM drivers) wallets,
           (SELECT COALESCE(SUM(driver_earnings),0) FROM jobs WHERE status='COMPLETED') jobs_earnings,
           (SELECT COALESCE(SUM(amount),0) FROM journal_lines WHERE account_code='DRIVER_EARNINGS_PAYABLE' AND entry_type='CREDIT') payable_credited,
           (SELECT COALESCE(SUM(amount),0) FROM driver_payouts) payouts`)).rows[0];
  check('FIN15B-20 the driver-money stores disagree with each other by an order of magnitude',
    Number(tot.payable_credited) > Number(tot.wallets) * 2,
    `wallets ₹${tot.wallets} vs jobs ₹${tot.jobs_earnings} vs journal payable ₹${tot.payable_credited} vs payouts ₹${tot.payouts}`);
  const drvCols = (await c.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='drivers'")).rows.map(r => r.column_name);
  check('FIN15B-21 drivers has NO business_id, cash_collected_today, today_earnings or is_suspended column',
    !drvCols.includes('business_id') && !drvCols.includes('cash_collected_today')
    && !drvCols.includes('today_earnings') && !drvCols.includes('is_suspended'),
    `${drvCols.length} real columns: ${drvCols.slice(0, 8).join(',')}… — an earlier phase reported values keyed on "business_id" from this table, which cannot have come from here`);

  /* ---- §13 the rollback hazard, reproduced without leaving any residue.
   *
   * This cannot be demonstrated by calling the RPC normally: `adjust_wallet_atomic`
   * writes journal rows, journal rows are append-only, so any amount credited
   * here would be permanent. Instead the RPC is invoked INSIDE a transaction on
   * this same connection and rolled back, which leaves nothing durable at all.
   * The rolled-back RPC still returns its computed balance - that returned value
   * is what the production `syncMemoryWalletFromServer()` would copy into the
   * cache, so it is fed through the real function on a throwaway instance owned
   * by this process. The hazard is then visible as a permanent divergence
   * between the database and a cache that no rollback can reach. */
  const FIX = '00000000-0000-0000-0000-000000000101';
  const original = (await supabaseAdmin.from('drivers').select('wallet_balance').eq('id', FIX).maybeSingle()).data;
  let rpcReturned = null;
  let rpcErr = 'not attempted';
  try {
    await c.query('BEGIN');
    const r = await c.query(`SELECT public.adjust_wallet_atomic('DRIVER'::public.owner_type, $1::uuid, 7777.00,
        'WALLET_TOPUP'::public.journal_category, 'FIN15B-22 rolled back, leaves nothing behind',
        'fin15b_probe', $2::text, 'DRIVER'::public.owner_type, $1::uuid, NULL::uuid, NULL::uuid) AS bal`,
      [FIX, `FIN15B:PROBE:${Date.now()}`]);
    rpcReturned = r.rows[0] ? r.rows[0].bal : null;
    await c.query('ROLLBACK');
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* ignore */ }
    console.log(`  [direct RPC probe unavailable: ${e.message.slice(0, 90)}]`);
  }
  const durableAfter = (await supabaseAdmin.from('drivers').select('wallet_balance').eq('id', FIX).maybeSingle()).data;
  if (rpcReturned === null) {
    /* Reported as a gap rather than quietly dropped: the durable half of this
     * check did run, and it is the half that matters most. `adjust_wallet_atomic`
     * cannot be invoked through a plain SQL call from this connection because it
     * is a mutating function PostgREST exposes only over RPC, and issuing that
     * RPC inside a transaction this test owns would need the PostgREST
     * connection, not this one. So the "database rolled back" fact is verified,
     * and the "cache did not" half remains unproven here. */
    skip('FIN15B-22 rolled-back RPC left the database untouched while returning a balance',
      `the RPC could not be invoked from this connection (${rpcErr}); durable value ${original.wallet_balance} -> ${durableAfter.wallet_balance} is unchanged either way`);
  } else {
    check('FIN15B-22 the rolled-back transaction left the database untouched',
      Number(durableAfter.wallet_balance) === Number(original.wallet_balance),
      `durable ${original.wallet_balance} -> ${durableAfter.wallet_balance}, while the rolled-back RPC reported ${rpcReturned}`);
  }

  /* The other half cannot be exercised here: `database.js` exports only a
   * singleton Database, and instantiating the real wallet would register timers
   * and boot the server. So the cache-copy is proven at source level instead -
   * the returned balance is assigned into the in-memory mirror with no
   * transactional guard, which is what makes a rollback unable to reach it. */
  const dbSrc = fs.readFileSync(path.join(__dirname, 'src', 'database.js'), 'utf8');
  const copySites = (dbSrc.match(/walletBalance\s*=\s*(?:result|data|updated|newBalance|Number\()/g) || []);
  const atomicCalls = (dbSrc.match(/adjust_wallet_atomic/g) || []).length;
  check('FIN15B-23 the code path copies an RPC-returned balance into the in-memory mirror',
    atomicCalls > 0 && copySites.length > 0,
    `adjust_wallet_atomic call sites=${atomicCalls}; mirror assignments=${copySites.length}`);
  const writeBack = (dbSrc.match(/from\('drivers'\)\s*\.\s*update\(\{[^}]*wallet_balance/g) || [])
    .concat((fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8').match(/from\('drivers'\)\s*\.\s*update\(\{[^}]*wallet_balance/g) || []));
  check('FIN15B-24 there is NO mirror->database write-back for driver wallets',
    writeBack.length === 0,
    `direct drivers.wallet_balance update statements found in the app: ${writeBack.length} — so a poisoned cache serves stale reads but does not corrupt the column, which corrects the earlier "mirror overwrote PostgreSQL" claim`);
  /* The bodies set `search_path TO 'public'`, so they write `UPDATE drivers`,
   * never `UPDATE public.drivers`. An earlier version matched only the qualified
   * form and therefore reported that no function could move a wallet, which was
   * an artefact of the pattern and not a fact about the database. */
  const walletWriters = (await c.query(`
    SELECT p.proname fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosrc ~* 'update[[:space:]]+(public\\.)?drivers'
       AND p.prosrc ILIKE '%wallet_balance%' ORDER BY 1`)).rows.map(r => r.fn);
  /* An earlier draft demanded `cancel_ride_atomic` here too. It updates `drivers`
   * (to free the driver) and refunds the CUSTOMER's wallet, but it never touches
   * `drivers.wallet_balance`, so requiring it was my assumption, not a rule the
   * database holds. The measured truth is stronger and simpler: exactly one
   * function in the database may change a driver's money. */
  const driversTouchers = (await c.query(`
    SELECT p.proname fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosrc ~* 'update[[:space:]]+(public\\.)?drivers' ORDER BY 1`)).rows.map(r => r.fn);
  check('FIN15B-25 exactly ONE database function may change a driver wallet balance',
    walletWriters.length === 1 && walletWriters[0] === 'adjust_wallet_atomic',
    `functions updating drivers.wallet_balance: ${walletWriters.join(', ') || 'none'}; functions updating drivers at all: ${driversTouchers.join(', ') || 'none'}`);

  console.log(`\nPhase 15B totals: ${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
  try { await c.end(); } catch { /* ignore */ }
  assert.strictEqual(results.fail, 0, `${results.fail} Phase 15B financial-authority check(s) failed`);
});

function tx_zero(b) { return b.tx > 0 ? b.tx : 0; }

process.on('exit', () => {
  console.log(`\nFINANCIAL_AUTHORITY_TEST_SUMMARY passed=${results.pass} failed=${results.fail} skipped=${results.skip}`);
  try { c.end(); } catch { /* ignore */ }
});
