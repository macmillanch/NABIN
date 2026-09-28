/*
 * PHASE 34 regression test — a driver earnings credit must never disappear because
 * the in-memory cache has not seen the driver yet.
 *
 * Reproduces the Phase 32 defect: a driver created AFTER boot-time hydration is
 * durable in PostgreSQL but absent from `db.drivers`, and
 * `DriverRepository.updateEarnings()` used to `return null` at that point, before
 * its identity and durability guards. Both production callers read that null as
 * "no driver" and continued to report business success.
 *
 * Local/test only: refuses any non-loopback database.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('CACHE-MISS REGRESSION REFUSED: non-loopback database'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');

const STAMP = Date.now();
const KEY = `P34_REGRESSION:${STAMP}:DRIVER_EARNINGS`;
const AMOUNT = 150;
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, name, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}` + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
}

(async () => {
  if (!isLivePostgres || !supabaseAdmin) {
    console.log('SKIP: this regression asserts durable money behaviour and needs live PostgreSQL.');
    process.exit(1);
  }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // Hydrate first, exactly as a running server does, so the driver created below
  // is provably absent from the cache at call time.
  if (!Array.isArray(db.drivers) || db.drivers.length === 0) {
    try { await db.initialize(); } catch (e) { console.log('initialize(): ' + e.message.slice(0, 90)); }
  }
  console.log(`cache hydrated with ${db.drivers ? db.drivers.length : 0} drivers before the fixture exists`);

  const drv = (await supabaseAdmin.from('drivers').insert({
    phone: `94${String(STAMP).slice(-8)}`, name: `P34 cache-miss probe ${STAMP}`,
    vehicle_type: 'AUTO', vehicle_number: `P34${String(STAMP).slice(-4)}`,
    operational_status: 'AVAILABLE', wallet_balance: 0
  }).select('id').single()).data;

  console.log('\n--- precondition: durable row exists, cache does not know it ---');
  const durable = await one('SELECT id::text, wallet_balance::text FROM drivers WHERE id=$1::uuid', [drv.id]);
  check('CMISS-01', 'the probe driver is durable in PostgreSQL', !!durable && durable.wallet_balance === '0.00', { durable: durable && durable.id });
  const cachedNow = db.driverRepo.findById(drv.id);
  check('CMISS-02', 'findById() cannot see it (the cache miss is real)', cachedNow === null, { typeofCached: typeof cachedNow });

  const jt0 = Number((await one('SELECT count(*) n FROM journal_transactions')).n);
  const jl0 = Number((await one('SELECT count(*) n FROM journal_lines')).n);

  console.log('\n--- the money operation on a cache-missed driver ---');
  let outcome = null, failure = null;
  try {
    outcome = await db.driverRepo.updateEarnings(drv.id, AMOUNT, null,
      { idempotencyKey: KEY, purpose: 'P34 cache-miss regression' });
  } catch (e) { failure = e; }

  // The contract being restored: a money call returns a posted result, or fails
  // loudly. Returning null/undefined is the defect.
  check('CMISS-03', 'updateEarnings does not return null for a durable driver',
    outcome !== null && outcome !== undefined, { returnedNull: outcome === null, threw: failure && (failure.code || failure.message) });
  check('CMISS-04', 'the credit is reported as posted (not silently skipped)',
    !!outcome && outcome.posted === true, outcome ? { posted: outcome.posted, duplicate: outcome.duplicate } : { threw: failure && failure.code });

  const after = await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [drv.id]);
  check('CMISS-05', `durable wallet moved by exactly ${AMOUNT}`,
    Number(after.w) === AMOUNT, { wallet: after.w });
  const jt1 = Number((await one('SELECT count(*) n FROM journal_transactions')).n);
  const jl1 = Number((await one('SELECT count(*) n FROM journal_lines')).n);
  check('CMISS-06', 'exactly one journal transaction and two lines were created',
    jt1 - jt0 === 1 && jl1 - jl0 === 2, { txn_delta: jt1 - jt0, line_delta: jl1 - jl0 });
  const keyed = await one(`SELECT t.transaction_id, t.category, t.total_credit::text, t.total_debit::text,
      (SELECT count(*) FROM journal_lines l WHERE l.journal_id=t.id AND l.entity_id = $1::text
        AND l.entity_type='DRIVER') attributed
      FROM journal_transactions t WHERE t.idempotency_key = $2`, [drv.id, KEY]);
  // Both legs of a driver earnings movement name the driver as the entity, and the
  // transaction must be balanced to the paisa (chk_balanced_entry enforces it; this
  // asserts it rather than trusting the constraint name).
  check('CMISS-07', 'the deterministic key booked one balanced entry attributed to this driver',
    !!keyed && Number(keyed.attributed) === 2
      && keyed.total_credit === keyed.total_debit && Number(keyed.total_credit) === AMOUNT,
    keyed && { attributed: keyed.attributed, debit: keyed.total_debit, credit: keyed.total_credit, category: keyed.category });

  console.log('\n--- idempotent retry with the same key ---');
  const b0 = Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [drv.id])).w);
  let retry = null, retryErr = null;
  try {
    retry = await db.driverRepo.updateEarnings(drv.id, AMOUNT, null, { idempotencyKey: KEY, purpose: 'P34 retry' });
  } catch (e) { retryErr = e; }
  const b1 = Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [drv.id])).w);
  const jt2 = Number((await one('SELECT count(*) n FROM journal_transactions')).n);
  check('CMISS-08', 'retry moves no money and books no new transaction',
    b1 === b0 && jt2 === jt1, { wallet_before: b0, wallet_after: b1, txn_delta: jt2 - jt1,
      duplicate: retry && retry.duplicate, threw: retryErr && retryErr.code });

  console.log('\n--- a driver that does not exist anywhere must fail loudly, not return null ---');
  const ghost = '00000000-0000-0000-0000-00000000d3ad';
  let ghostOutcome = 'threw', ghostErr = null;
  try { ghostOutcome = await db.driverRepo.updateEarnings(ghost, 50, null, { idempotencyKey: `P34_GHOST:${STAMP}` }); }
  catch (e) { ghostErr = e; ghostOutcome = 'threw'; }
  const ghostMoney = await one('SELECT count(*) n FROM journal_transactions WHERE idempotency_key=$1', [`P34_GHOST:${STAMP}`]);
  check('CMISS-09', 'unknown driver raises a typed error instead of returning null',
    ghostErr !== null && !!ghostErr.code, { result: ghostOutcome === 'threw' ? '(threw)' : JSON.stringify(ghostOutcome).slice(0, 80), code: ghostErr && ghostErr.code });
  check('CMISS-10', 'the unknown-driver attempt booked nothing', Number(ghostMoney.n) === 0, { rows: ghostMoney.n });

  console.log('\n--- cache hydration side effect (documented behaviour, not assumed) ---');
  check('CMISS-11', 'the successful lookup hydrated the mirror so later reads hit cache',
    db.driverRepo.findById(drv.id) !== null);

  console.log('\n=== teardown (rowCount-safe) ===');
  // A probe driver may only be removed while no financial record names it. Once the
  // credit is booked, journal_lines.entity_id is NOT a foreign key, so deleting the
  // driver would strand the money and recreate the orphan problem this test guards.
  const history = await one(`SELECT (
        (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text) +
        (SELECT count(*) FROM driver_payouts WHERE driver_id = $1::uuid)
      ) n`, [drv.id]);
  if (Number(history.n) > 0) {
    console.log(`  RETAINING driver ${drv.id}: ${history.n} financial row(s) reference it`);
  } else {
    const del = await c.query('DELETE FROM drivers WHERE id=$1::uuid', [drv.id]);
    const gone = await one('SELECT count(*) n FROM drivers WHERE id=$1::uuid', [drv.id]);
    console.log(`  DELETE drivers id=${drv.id} rowCount=${del.rowCount}; post-delete SELECT count=${gone.n}`
      + (del.rowCount === 1 && gone.n === 0 ? '  -> verified removed' : '  -> NOT VERIFIED'));
  }
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== RESULTS: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
