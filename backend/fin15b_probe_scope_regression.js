/*
 * FIN15B-14a/14b measurement-scope regression. Proves the probe-signature exclusion is exactly as narrow as
 * claimed, using a single transaction that is ALWAYS rolled back - nothing is committed, nothing is deleted.
 *
 * Asserts:
 *   1. rows carrying the exact Phase 9 probe signature are excluded from BOTH measured populations;
 *   2. a REAL zero-leg WALLET_TOPUP header (different reference_id/description) is still counted by 14b;
 *   3. a REAL one-leg (unbalanced) header is still counted by 14a;
 *   4. no other filtering exists: excluding on amount, category, transaction_id prefix or date would have
 *      silently swallowed the real rows above, and the test fails if it does.
 * Fixture columns are discovered from information_schema rather than assumed, per the project's fixture rule.
 */
process.env.PGSSLMODE = 'disable';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PG = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').match(/^DATABASE_URL=(.*)$/m)[1].trim().replace(/^"|"$/g, '');

const DERIVED = (extra = '') => `
  SELECT COUNT(*) n FROM (
    SELECT t.id, t.total_debit, t.total_credit,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type='DEBIT'),0)  AS line_debit,
           COALESCE(SUM(l.amount) FILTER (WHERE l.entry_type='CREDIT'),0) AS line_credit
      FROM journal_transactions t LEFT JOIN journal_lines l ON l.journal_id = t.id
      ${extra}
      GROUP BY t.id, t.total_debit, t.total_credit) h
    WHERE round(h.line_debit,2) <> round(h.total_debit,2)
       OR round(h.line_credit,2) <> round(h.total_credit,2)`;
const LINELESS = (extra = '') => `
  SELECT COUNT(*) n FROM journal_transactions t
   WHERE NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = t.id) ${extra}`;
const EXCL = `AND NOT (t.reference_id = 'phase9_probe' AND t.description = 'Phase 9 append-only probe')`;
// The derived query needs a real WHERE clause. Passing `AND NOT (...)` there appends it to the LEFT JOIN's ON
// condition, which is legal SQL that silently does NOT filter headers - that is what made this harness report a
// failure while the suite itself was correct. The suite uses `WHERE NOT (...)` before GROUP BY, so this mirrors
// it exactly.
const EXCL_WHERE = `WHERE NOT (t.reference_id = 'phase9_probe' AND t.description = 'Phase 9 append-only probe')`;

let failed = 0;
let baseDerived = -1;
let baseLineless = -1;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` ${detail}` : ''}`); if (!ok) failed++; };

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const cnt = async (sql) => Number((await c.query(sql)).rows[0].n);
  const cols = async (t) => (await c.query(`SELECT column_name, is_nullable, column_default, data_type
    FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`, [t])).rows;
  // Build an INSERT covering only NOT NULL columns without defaults.
  const insert = async (table, values) => {
    const required = (await cols(table)).filter((r) => r.is_nullable === 'NO' && !r.column_default);
    const missing = required.map((r) => r.column_name).filter((n) => !(n in values));
    if (missing.length) throw new Error(`cannot build ${table} fixture, no value for NOT NULL column(s): ${missing.join(', ')}`);
    const names = Object.keys(values).filter((k) => required.map((r) => r.column_name).includes(k));
    const ph = names.map((n, i) => `$${i + 1}`).join(', ');
    return (await c.query(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${ph}) RETURNING id`,
      names.map((n) => values[n]))).rows[0].id;
  };

  // A journal_line must be LINKED to its header. The generic insert() above only emits NOT-NULL columns, which
  // silently dropped `journal_id` and produced an orphan line - so a "one-leg" fixture was really zero-leg. Legs
  // are written explicitly here and verified by counting them back.
  const insertLine = async (journalId, amount, entryType) => {
    await c.query('INSERT INTO journal_lines (journal_id, amount, entry_type) VALUES ($1, $2, $3)',
      [journalId, amount, entryType]);
    return Number((await c.query('SELECT COUNT(*) n FROM journal_lines WHERE journal_id = $1', [journalId])).rows[0].n);
  };

  const tag = `scope-${Date.now()}`;
  await c.query('BEGIN');
  try {
    baseDerived = await cnt(DERIVED(EXCL_WHERE));
    baseLineless = await cnt(LINELESS(EXCL));
    console.log(`  baseline with probe excluded: derived=${baseDerived} lineless=${baseLineless}`);

    // (1) probe-signed bad rows must NOT move either measured population.
    await insert('journal_transactions', {
      transaction_id: `${tag}-probe-0leg`, category: 'WALLET_TOPUP', total_debit: 1.0, total_credit: 1.0,
      description: 'Phase 9 append-only probe', reference_id: 'phase9_probe', status: 'POSTED'
    });
    const probe0 = await insert('journal_transactions', {
      transaction_id: `${tag}-probe-1leg`, category: 'WALLET_TOPUP', total_debit: 1.0, total_credit: 1.0,
      description: 'Phase 9 append-only probe', reference_id: 'phase9_probe', status: 'POSTED'
    });
    await insert('journal_lines', { journal_id: probe0, amount: 1.0, entry_type: 'DEBIT' });
    check('F15S-01 probe-signed zero-leg header is excluded from the 14b population',
      (await cnt(LINELESS(EXCL))) === baseLineless, `now=${await cnt(LINELESS(EXCL))}`);
    const probeLegs = await insertLine(probe0, 1.0, 'DEBIT');
    console.log(`  diagnostic - probe-signed one-leg header really has ${probeLegs} leg(s)`);
    check('F15S-02 probe-signed one-leg header is excluded from the 14a population',
      (await cnt(DERIVED(EXCL_WHERE))) === baseDerived, `now=${await cnt(DERIVED(EXCL_WHERE))}`);

    // Without the exclusion those same rows WOULD be counted - proving the rows really are unbalanced and the
    // exclusion, not the data, is what removes them.
    check('F15S-03 the same rows are still detected when the exclusion is removed (scope is the only difference)',
      (await cnt(LINELESS())) > baseLineless && (await cnt(DERIVED())) > baseDerived);

    // (2)(3) REAL bad rows must be counted even WITH the exclusion in place.
    // Each assertion is a DELTA around one insert, so no arithmetic about how many earlier fixtures already sit in
    // a population is needed. That matters: a zero-leg header belongs to BOTH populations (its line sums are 0,
    // which differ from its header total), which is exactly what an earlier version of this harness assumed away.
    const before4 = await cnt(LINELESS(EXCL));
    await insert('journal_transactions', {
      transaction_id: `${tag}-real-0leg`, category: 'WALLET_TOPUP', total_debit: 1.0, total_credit: 1.0,
      description: 'FIN15B scope regression - genuine zero-leg posting', reference_id: `${tag}-real`, status: 'POSTED'
    });
    const after4Lineless = await cnt(LINELESS(EXCL));
    const after4Derived = await cnt(DERIVED(EXCL_WHERE));
    check('F15S-04 a genuine zero-leg WALLET_TOPUP header IS counted by 14b (not swallowed)',
      after4Lineless === before4 + 1, `before=${before4} after=${after4Lineless}`);
    check('F15S-04b the same genuine zero-leg header is also visible to the 14a population',
      after4Derived === baseDerived + 1, `derivedBase=${baseDerived} after=${after4Derived}`);

    const before5 = after4Derived;
    const real1 = await insert('journal_transactions', {
      transaction_id: `${tag}-real-1leg`, category: 'WALLET_TOPUP', total_debit: 5.0, total_credit: 5.0,
      description: 'FIN15B scope regression - genuine unbalanced posting', reference_id: `${tag}-real`, status: 'POSTED'
    });
    const realLegs = await insertLine(real1, 5.0, 'DEBIT');
    check('F15S-05a the genuine fixture really carries exactly ONE leg (linked by journal_id)',
      realLegs === 1, `legs=${realLegs}`);
    const after5 = await cnt(DERIVED(EXCL_WHERE));
    check('F15S-05 a genuine one-leg (unbalanced) header IS counted by 14a (not swallowed)',
      after5 === before5 + 1, `before=${before5} after=${after5}`);

    // (4) the exclusion must be the exact pair, never either half alone.
    const before6 = await cnt(LINELESS(EXCL));
    await insert('journal_transactions', {
      transaction_id: `${tag}-half`, category: 'WALLET_TOPUP', total_debit: 1.0, total_credit: 1.0,
      description: 'some other probe text', reference_id: 'phase9_probe', status: 'POSTED'
    });
    const after6 = await cnt(LINELESS(EXCL));
    // Print the measured population so any unexpected extra row is visible instead of being argued about.
    const pop = (await c.query(`SELECT t.transaction_id, t.reference_id, t.description
      FROM journal_transactions t
      WHERE NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id = t.id) ${EXCL}`)).rows;
    console.log(`  diagnostic - measured lineless population: ${JSON.stringify(pop.map((r) => r.transaction_id))}`);
    check('F15S-06 matching only reference_id (without the description) is NOT excluded',
      after6 === before6 + 1, `before=${before6} after=${after6} population=${pop.length}`);

    await c.query('ROLLBACK');
    console.log('  transaction rolled back (no rows committed)');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    failed++;
    console.log(`  ❌ unexpected error (rolled back): ${e.message}`);
  }
  const afterDerived = await cnt(DERIVED(EXCL_WHERE));
  const afterLineless = await cnt(LINELESS(EXCL));
  // COUNT(*) arrives as a bigint-backed STRING from pg, so `leftovers === 0` was false even when the printed
  // evidence said 0 - that is the verdict/evidence mismatch this pass is fixing.
  const leftovers = Number((await c.query(
    `SELECT COUNT(*) n FROM journal_transactions WHERE transaction_id LIKE 'scope-%'`)).rows[0].n);
  check('F15S-07 rollback left no fixture rows and restored the measured baseline exactly',
    leftovers === 0 && afterDerived === baseDerived && afterLineless === baseLineless,
    `leftovers=${leftovers} derived=${afterDerived}/${baseDerived} lineless=${afterLineless}/${baseLineless}`);
  check('F15S-08 both ratchets pass against current data with the probe excluded',
    baseLineless <= 11 && (baseDerived - baseLineless) <= 11,
    `derived=${baseDerived} lineless=${baseLineless} withLines=${baseDerived - baseLineless}`);
  await c.end();
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: FIN15B scope regression, ${failed} failure(s)`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.log(`ERR ${e.message}`); process.exit(1); });
