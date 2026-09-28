/*
 * F4 regression — POST /api/admin/finance/settlements/drivers/:id/payout
 *
 * CONTRACT, read out of the source and not invented here:
 *   the route's own Phase 9 comment says "the full-balance default applies only when no
 *   amount is provided at all". So an omitted `amount` MEANS "pay the driver's entire
 *   available wallet balance", and a supplied amount is allowed with positive-number
 *   validation. The service then refreshes KYC / UPI / cooling / wallet_balance from the
 *   durable `drivers` row and refuses INSUFFICIENT_BALANCE, books `driver_payouts`
 *   (status SETTLED) with UNIQUE payout_id + idempotency_key, and moves the wallet through
 *   the authoritative ledger. It returns { success, balance, verifiedUpiId, payoutKey }.
 *
 * WHAT IS WRONG: the default amount is taken from `db.getDriver(...)`, this process's
 * mirror, BEFORE the service ever looks at the database. So "the driver's entire available
 * wallet balance" is answered with a number that may be from another era - and the same
 * mirror-only lookup 404s a driver that exists durably with money in it, which the
 * settlement screen fixed in F3 now happily lists.
 *
 * WHY THE TEST DRIVES THE MONEY OUTWARD (mirror-behind) RATHER THAN INWARD: to show a
 * mirror that is HIGHER than durable you would need a wallet decreased outside the ledger
 * (forbidden: unexplained financial movement) or a mid-test server restart (no safe seam).
 * The same safety property is therefore proven directly: a requested amount above the
 * authoritative durable balance must be refused with ZERO movement, which holds whether or
 * not the mirror is stale, because the service re-reads durable state and
 * `drivers_wallet_balance_nonnegative` stands behind it.
 *
 * Every rupee here belongs to a disposable driver this run creates, together with its own
 * user. No historical row is read as an assertion target or mutated. Local/test only;
 * refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('F4 REFUSED: non-loopback target'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const STAMP = Date.now();
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
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const wallet = async (id) => Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [id])).w);

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('F4-01', 'a finance.settlement session exists', login.status === 200 && !!tok, { status: login.status });
  if (!tok) process.exit(1);

  const anon = await api('POST', '/api/admin/finance/settlements/drivers/00000000-0000-0000-0000-000000000001/payout', {});
  check('F4-02', 'authorization unchanged: anonymous cannot execute a payout',
    anon.status === 401 || anon.status === 403, { status: anon.status });

  const start = await one(`SELECT (SELECT count(*) FROM driver_payouts)::text po,
      (SELECT count(*) FROM journal_transactions)::text jt, (SELECT count(*) FROM journal_lines)::text jl`);
  console.log(`  at start: payouts=${start.po} journal=${start.jt}/${start.jl}`);

  // a disposable, payout-eligible driver: own user, KYC verified, destination verified.
  // `users` is inserted with name+phone only - there is no `role` column in the PostgREST
  // schema, and a failed write must stop the run rather than become a null dereference.
  const usrRes = await supabaseAdmin.from('users').insert({
    name: `F4 payout user ${STAMP}`, phone: `94${String(STAMP).slice(-8)}`
  }).select('id').single();
  if (usrRes.error || !usrRes.data) {
    console.log('  FATAL: probe user could not be created: ' + JSON.stringify(usrRes.error)); process.exit(1);
  }
  const usr = usrRes.data;
  // Snapshot of every payout booked against a driver that is NOT this run's, so mis-addressing
  // can be measured as a delta rather than as an absolute count (earlier runs of this suite
  // legitimately left their own probe payouts behind).
  const foreign0 = await one(`SELECT count(*)::text n FROM driver_payouts p
      WHERE p.driver_id NOT IN (SELECT id FROM drivers WHERE user_id = $1::uuid)`, [usr.id]);
  const mkDriver = async (balance, tag) => {
    const r = await supabaseAdmin.from('drivers').insert({
      user_id: usr.id, name: `F4 payout ${tag} ${STAMP}`, phone: `88${String(STAMP).slice(-7)}${tag}`,
      vehicle_type: 'AUTO', vehicle_number: `F4${tag}${String(STAMP).slice(-3)}`,
      operational_status: 'AVAILABLE', wallet_balance: balance, kyc_status: 'VERIFIED',
      payout_upi_verified: true, verified_upi_id: `f4.${tag}.${STAMP}@okhdfcbank`
    }).select('id').single();
    if (r.error || !r.data) {
      console.log(`  FATAL: probe driver ${tag} could not be created: ` + JSON.stringify(r.error)); process.exit(1);
    }
    return r.data;
  };

  const D1 = await mkDriver(5000, 'a');
  console.log(`  driver ${D1.id} created AFTER this server booted, durable wallet 5000`);

  // ---------- CASE 1: a driver the mirror never met, holding real money ----------
  const p1Key = `F4A1:${STAMP}`;
  const p1 = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`, {}, tok, p1Key);
  check('F4-03', 'CASE1 existence: a durable driver with a balance is payable (not 404 from the mirror)',
    p1.status === 200 && p1.data.success === true, { status: p1.status, body: p1.data });
  check('F4-04', 'CASE1 response keeps the established shape { success, balance, verifiedUpiId, payoutKey }',
    ['success', 'balance', 'verifiedUpiId', 'payoutKey'].every(k => k in p1.data), Object.keys(p1.data));
  const po1 = await one(`SELECT amount::text amt, status, upi_id FROM driver_payouts WHERE idempotency_key = $1`, [p1.data.payoutKey || `ns:${p1Key}`]);
  check('F4-05', 'CASE1 omitted amount paid the ENTIRE durable balance (5000), nothing less',
    !!po1 && Number(po1.amt) === 5000 && po1.status === 'SETTLED', po1 || { note: 'no payout row' });
  check('F4-06', 'CASE1 the durable wallet is now zero', await wallet(D1.id) === 0, { wallet: await wallet(D1.id) });

  // ---------- CASE 2: mirror BEHIND durable -> must not suppress or under-pay ----------
  const credit = await supabaseAdmin.rpc('adjust_wallet_atomic', {
    p_owner_id: D1.id, p_owner_type: 'DRIVER', p_amount: 625, p_category: 'RIDE_SETTLEMENT',
    p_description: 'F4 payout authority probe', p_reference_id: `F4CREDIT:${STAMP}`,
    p_debit_account: 'CUSTOMER_WALLET_LIABILITY', p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
    p_idempotency_key: `F4CREDIT:${STAMP}:DRIVER_EARNINGS`
  });
  if (credit.error) { console.log('  FATAL: probe credit failed: ' + credit.error.message); process.exit(1); }
  console.log(`  durable wallet credited to ${await wallet(D1.id)}; this server's mirror cannot know that`);
  const p2Key = `F4A2:${STAMP}`;
  const p2 = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`, {}, tok, p2Key);
  const po2 = await one(`SELECT amount::text amt FROM driver_payouts WHERE idempotency_key = $1`,
    [p2.data.payoutKey || `ns:${p2Key}`]);
  check('F4-07', 'CASE2 mirror-behind: the full durable balance (625) is paid, not a stale number',
    p2.status === 200 && !!po2 && Number(po2.amt) === 625,
    { status: p2.status, code: p2.data.code, booked: po2 && po2.amt, durable: await wallet(D1.id) });
  check('F4-08', 'CASE2 the wallet is settled to zero with no residue left behind',
    await wallet(D1.id) === 0, { wallet: await wallet(D1.id) });

  // ---------- CASE 3: mirror AHEAD is impossible; an over-amount must not create money ----
  const credit2 = await supabaseAdmin.rpc('adjust_wallet_atomic', {
    p_owner_id: D1.id, p_owner_type: 'DRIVER', p_amount: 1200, p_category: 'RIDE_SETTLEMENT',
    p_description: 'F4 payout authority probe 2', p_reference_id: `F4CREDIT2:${STAMP}`,
    p_debit_account: 'CUSTOMER_WALLET_LIABILITY', p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
    p_idempotency_key: `F4CREDIT2:${STAMP}:DRIVER_EARNINGS`
  });
  if (credit2.error) { console.log('  FATAL: probe credit 2 failed: ' + credit2.error.message); process.exit(1); }
  const before3 = await wallet(D1.id);
  const over = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`,
    { amount: before3 + 5000 }, tok, `F4OVER:${STAMP}`);
  const walletAfterOver = await wallet(D1.id);
  check('F4-09', 'CASE3 an amount above the authoritative balance is refused, not honoured',
    over.status === 400 && over.data.success !== true, { status: over.status, code: over.data.code });
  check('F4-10', 'CASE3 refusal moved NO money and created no payout row',
    walletAfterOver === before3 && !over.data.payoutKey,
    { before: before3, after: walletAfterOver });

  // ---------- CASE 4: explicit amount keeps working exactly as before ----------
  const ex = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`,
    { amount: 500 }, tok, `F4EXPL:${STAMP}`);
  const poEx = await one(`SELECT amount::text amt FROM driver_payouts WHERE idempotency_key = $1`,
    [ex.data.payoutKey || `ns:F4EXPL:${STAMP}`]);
  check('F4-11', 'CASE4 an explicit amount still pays that amount (500 of the balance)',
    ex.status === 200 && !!poEx && Number(poEx.amt) === 500,
    { status: ex.status, booked: poEx && poEx.amt, wallet: await wallet(D1.id) });
  check('F4-12', 'CASE4 the remainder is untouched (700 left)', await wallet(D1.id) === 700,
    { wallet: await wallet(D1.id) });

  // ---------- CASE 5: replay protection on the payout identity ----------
  // (a) the SAME key with the SAME semantics must replay, not pay twice
  const replay = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`,
    { amount: 500 }, tok, `F4EXPL:${STAMP}`);
  const walletAfterReplay = await wallet(D1.id);
  check('F4-13', 'CASE5a replaying the same key and amount reports the original without paying twice',
    walletAfterReplay === 700 && (replay.data.duplicate === true || replay.data.alreadyApplied === true
      || replay.status === 400),
    { status: replay.status, duplicate: replay.data.duplicate, wallet: walletAfterReplay });
  // (b) the SAME key with DIFFERENT semantics must be refused, and must not move money:
  //     here an omitted amount would derive 700 against a key already booked for 500.
  const clash = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`,
    {}, tok, `F4EXPL:${STAMP}`);
  const walletAfterClash = await wallet(D1.id);
  check('F4-13B', 'CASE5b same key, different amount is refused rather than silently re-paid',
    walletAfterClash === 700 && clash.status >= 400,
    { status: clash.status, code: clash.data.code, wallet: walletAfterClash });

  // ---------- CASE 6: unknown driver keeps its 404 ----------
  const ghost = await api('POST', '/api/admin/finance/settlements/drivers/00000000-dead-beef-0000-000000000000/payout',
    { amount: 100 }, tok, `F4GHOST:${STAMP}`);
  check('F4-14', 'a driver that exists nowhere answers 404 and is not silently re-addressed',
    ghost.status === 404, { status: ghost.status, code: ghost.data.code });

  // ---------- CASE 7: mis-addressing must not move anyone else's money ----------
  // `getDriver()` used to end in `match || this.drivers[0]`, so an unknown id resolved to a
  // DIFFERENT real driver and the payout would have been booked against that driver's wallet
  // and paid to that driver's verified UPI. These two checks are the P0 part of F4.
  const foreign1 = await one(`SELECT count(*)::text n FROM driver_payouts p
      WHERE p.driver_id NOT IN (SELECT id FROM drivers WHERE user_id = $1::uuid)`, [usr.id]);
  check('F4-18', 'no payout was booked against any driver other than the ones this run created',
    Number(foreign1.n) === Number(foreign0.n),
    { before: foreign0.n, after: foreign1.n });
  const walletSum = await one('SELECT coalesce(sum(wallet_balance),0)::text s FROM drivers');
  console.log(`  note: durable wallet sum now = ${walletSum.s}`);
  const d1Final = await wallet(D1.id);
  // Started at 5000, credited 625 + 1200, paid out 5000 + 625 + 500 = 6125 => 700 expected.
  check('F4-19', 'this run is the only thing that moved: probe wallet ends at the arithmetic 700',
    d1Final === 700, { expected: 700, durable: d1Final });

  // ---------- drain: leave no balance residue behind ----------
  // Earlier suites in this programme left every probe driver's wallet balance in the durable
  // table, and the append-only guard is right to refuse deleting those rows - so the balances
  // accumulated until they crossed a pre-existing aggregate check (FIN15B-20). Settling the
  // probe through the same audited payout path is a real balanced movement, costs nothing this
  // run did not already have, and keeps this suite's residue at zero.
  const drainFrom = await wallet(D1.id);
  const drain = await api('POST', `/api/admin/finance/settlements/drivers/${D1.id}/payout`,
    {}, tok, `F4DRAIN:${STAMP}`);
  check('F4-20', 'the probe leaves with a zero balance, so no wallet residue accumulates',
    drainFrom === 700 && drain.status === 200 && await wallet(D1.id) === 0,
    { drained: drainFrom, status: drain.status, code: drain.data.code, wallet: await wallet(D1.id) });

  // ---------- integrity: only the intended money moved ----------
  const end = await one(`SELECT (SELECT count(*) FROM driver_payouts)::text po,
      (SELECT count(*) FROM journal_transactions)::text jt, (SELECT count(*) FROM journal_lines)::text jl`);
  const dPo = Number(end.po) - Number(start.po);
  const dJt = Number(end.jt) - Number(start.jt);
  const dJl = Number(end.jl) - Number(start.jl);
  console.log(`  deltas: payouts=+${dPo} journal=+${dJt}/${dJl}`);
  check('F4-15', 'payout rows created match the payouts this run booked (4 intended)',
    dPo === 4, { payoutRowsAdded: dPo });
  // 4 payouts + the 2 controlled credits, each one balanced header with exactly two legs.
  check('F4-16', 'every movement is one balanced journal transaction with exactly two legs',
    dJt === dPo + 2 && dJl === 2 * (dPo + 2),
    { journalHeads: dJt, journalLines: dJl, expected: `${dPo + 2} heads / ${2 * (dPo + 2)} lines` });
  check('F4-17', 'no negative wallet was ever produced (durable CHECK intact)',
    walletAfterReplay >= 0 && walletAfterOver >= 0 && walletAfterClash >= 0,
    { walletAfterOver, walletAfterReplay, walletAfterClash });

  // cleanup: probes carry financial history, so deletion is expected to be refused
  const gone = await c.query(`DELETE FROM drivers WHERE user_id=$1::uuid
      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id = drivers.id::text)
      AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id = drivers.id)`, [usr.id]);
  const goneUsers = await c.query(`DELETE FROM users WHERE id=$1::uuid AND NOT EXISTS
      (SELECT 1 FROM drivers d WHERE d.user_id = users.id)`, [usr.id]);
  console.log(`  cleanup: drivers=${gone.rowCount} users=${goneUsers.rowCount}`
    + (gone.rowCount === 0 ? ' -> probe rows RETAINED (append-only financial history pins them)' : ''));
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== F4 PAYOUT AUTHORITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
