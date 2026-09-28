/*
 * F4 follow-up, NEXT 2 - the admin payout route must classify an idempotency conflict the way
 * the rest of the platform already does.
 *
 * Established elsewhere and NOT re-implemented here:
 *   - LedgerRepository (E2) throws code IDEMPOTENCY_CONFLICT when one key is reused with
 *     different financial semantics, and moves nothing while doing so.
 *   - POST /api/admin/finance/refund already answers that code with HTTP 409 (locked by
 *     finance_refund_amount_authority_test.js RAF-11).
 *   - the payout route wraps its service call in one catch that reports EVERY failure as
 *     503 PAYOUT_OUTCOME_UNKNOWN with "retry with the same Idempotency-Key" - which is wrong
 *     for this one class: the outcome is known (nothing moved) and retrying the same key with
 *     the same different semantics can never succeed. This suite proves the mismatch, then
 *     locks the corrected 409 while keeping 503 for genuine unknowns.
 *
 * Money-safety is asserted from durable state only: wallet, driver_payouts,
 * journal_transactions, journal_lines. Disposable driver created by this run; no historical
 * financial row is touched. Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('PAYOUT CONFLICT REFUSED: non-loopback target'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const STAMP = Date.now();
const KEY = `POCONF:${STAMP}`;
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''));
}
const api = async (method, path, body, token, idemKey) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const res = await fetch(BASE + path, { method, headers, body: JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const wallet = async () => Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [drvId])).w);
  const snapshot = async () => one(`SELECT
      (SELECT count(*) FROM driver_payouts WHERE driver_id = $1::uuid)::text po,
      (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text)::text jl,
      (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jll`, [drvId]);

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('PCC-01', 'a finance.settlement session exists', login.status === 200 && !!tok, { status: login.status });
  if (!tok) process.exit(1);

  const usr = await supabaseAdmin.from('users').insert({
    name: `Payout conflict user ${STAMP}`, phone: `72${String(STAMP).slice(-8)}`
  }).select('id').single();
  if (usr.error || !usr.data) { console.log('  FATAL: user insert refused: ' + JSON.stringify(usr.error)); process.exit(1); }
  const drv = await supabaseAdmin.from('drivers').insert({
    user_id: usr.data.id, name: `Payout conflict ${STAMP}`, phone: `71${String(STAMP).slice(-8)}`,
    vehicle_type: 'AUTO', vehicle_number: `PC${String(STAMP).slice(-6)}`, operational_status: 'AVAILABLE',
    wallet_balance: 5000, kyc_status: 'VERIFIED', payout_upi_verified: true,
    verified_upi_id: `poc.${STAMP}@okhdfcbank`
  }).select('id').single();
  if (drv.error || !drv.data) { console.log('  FATAL: driver insert refused: ' + JSON.stringify(drv.error)); process.exit(1); }
  const drvId = drv.data.id;

  const path = `/api/admin/finance/settlements/drivers/${drvId}/payout`;
  const first = await api('POST', path, { amount: 2000 }, tok, KEY);
  check('PCC-02', 'the first payout under key K succeeded and moved exactly 2000',
    first.status === 200 && first.data.success === true && await wallet() === 3000,
    { status: first.status, wallet: await wallet() });
  const afterFirst = await snapshot();

  // ---------- the defect: reuse K with different financial semantics ----------
  const clash = await api('POST', path, { amount: 2500 }, tok, KEY);
  check('PCC-03', 'reusing K with a different amount is classified IDEMPOTENCY_CONFLICT',
    clash.data.code === 'IDEMPOTENCY_CONFLICT', { status: clash.status, code: clash.data.code });
  check('PCC-04', 'and it is answered HTTP 409, matching the refund route, not 503 "outcome unknown"',
    clash.status === 409, { status: clash.status, code: clash.data.code });
  check('PCC-05', 'a 409 conflict must not tell the caller that the outcome is unknown',
    !/PAYOUT_OUTCOME_UNKNOWN/.test(String(clash.data.code || ''))
      && !/could not be completed or confirmed/i.test(String(clash.data.note || clash.data.error || '')),
    { note: String(clash.data.note || clash.data.error || '').slice(0, 90) });

  const afterClash = await snapshot();
  check('PCC-06', 'the conflict moved no money: wallet still 3000', await wallet() === 3000,
    { wallet: await wallet() });
  check('PCC-07', 'no second payout row was created',
    Number(afterClash.po) === Number(afterFirst.po), { payouts: [afterFirst.po, afterClash.po] });
  check('PCC-08', 'no additional journal transaction or line was created',
    Number(afterClash.jt) === Number(afterFirst.jt) && Number(afterClash.jll) === Number(afterFirst.jll),
    { heads: [afterFirst.jt, afterClash.jt], lines: [afterFirst.jll, afterClash.jll] });
  check('PCC-09', 'no journal line appeared for this driver either',
    Number(afterClash.jl) === Number(afterFirst.jl), { driverLines: [afterFirst.jl, afterClash.jl] });

  // ---------- the behaviour that must NOT change ----------
  const replay = await api('POST', path, { amount: 2000 }, tok, KEY);
  check('PCC-10', 'same key + same semantics still replays idempotently (200, no second movement)',
    replay.status === 200 && replay.data.success === true && replay.data.duplicate === true
      && await wallet() === 3000,
    { status: replay.status, duplicate: replay.data.duplicate, wallet: await wallet() });
  const afterReplay = await snapshot();
  check('PCC-11', 'the replay created no payout row and no journal movement',
    Number(afterReplay.po) === Number(afterFirst.po) && Number(afterReplay.jt) === Number(afterFirst.jt),
    { payouts: afterReplay.po, heads: afterReplay.jt });

  const noKey = await api('POST', path, { amount: 100 }, tok, `POFRESH:${STAMP}`);
  check('PCC-12', 'a DIFFERENT key is an independent payout and still executes (no over-blocking)',
    noKey.status === 200 && noKey.data.success === true && await wallet() === 2900,
    { status: noKey.status, code: noKey.data.code, wallet: await wallet() });

  // ---------- concurrency: same key, both in flight ----------
  const beforeConc = await wallet();
  const pair = await Promise.all([
    api('POST', path, { amount: 400 }, tok, `POCOC:${STAMP}`),
    api('POST', path, { amount: 400 }, tok, `POCOC:${STAMP}`)
  ]);
  const walletConc = await wallet();
  const movedOnce = walletConc === beforeConc - 400;
  // Exactly-once is the property. How the loser says so is an existing, deliberate choice
  // (duplicate / alreadyApplied / recordInconsistent on a 200, or the 409 this suite adds),
  // so the assertion forbids a SECOND booked success rather than one particular spelling.
  const booked = pair.filter(p => p.status === 200 && p.data.success === true
    && p.data.duplicate !== true && p.data.alreadyApplied !== true
    && p.data.recordInconsistent !== true).length;
  check('PCC-13', 'two concurrent same-key payouts move the 400 exactly once',
    movedOnce && booked === 1,
    { statuses: pair.map(p => p.status), bodies: pair.map(p => Object.keys(p.data)), booked, before: beforeConc, after: walletConc });
  const concRows = await one(`SELECT count(*)::text n FROM driver_payouts
      WHERE driver_id = $1::uuid AND amount = 400`, [drvId]);
  check('PCC-14', 'and exactly one payout row exists for that key', Number(concRows.n) === 1,
    { rows: concRows.n });

  // The 503-for-a-genuinely-unknown-outcome path is preserved by construction: the fix below
  // special-cases ONLY IDEMPOTENCY_CONFLICT and leaves every other store failure on the existing
  // 503 branch. Forcing a real store outage is what driver_operations_test OPS-5x already does
  // against the shared suites, so this run does not fake one; what it does check here is that an
  // ordinary, unrelated payout still succeeds with the original response shape.
  const ordinary = await api('POST', path, { amount: 50 }, tok, `POOK:${STAMP}`);
  check('PCC-15', 'an ordinary successful payout is unaffected and keeps its response shape',
    ordinary.status === 200 && typeof ordinary.data.payoutKey === 'string',
    { status: ordinary.status, keys: Object.keys(ordinary.data) });

  // ---------- drain the probe so no wallet balance residue accumulates ----------
  // Retained probe balances across earlier suites grew the durable wallet total enough to
  // cross a pre-existing aggregate check (FIN15B-20). The rows themselves are append-only
  // history and must stay, but their balance can be settled through the same audited path.
  const drainFrom = await wallet();
  const drain = await api('POST', path, {}, tok, `PODRAIN:${STAMP}`);
  check('PCC-16', 'the probe leaves with a zero wallet balance',
    drainFrom > 0 && drain.status === 200 && await wallet() === 0,
    { drained: drainFrom, status: drain.status, wallet: await wallet() });

  const totals = await snapshot();
  console.log(`  driver movement summary: payouts=${totals.po} driver_lines=${totals.jl}`);
  const del = await c.query(`DELETE FROM drivers WHERE id=$1::uuid
      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
      AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [drvId]);
  console.log(`  cleanup DELETE drivers rowCount=${del.rowCount}`
    + (del.rowCount === 0 ? ' -> RETAINED (its payouts are durable history)' : ' -> removed under the guard'));
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== PAYOUT CONFLICT ROUTE CLASSIFICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
