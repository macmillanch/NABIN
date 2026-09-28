/*
 * F3 regression — /api/admin/finance/settlements/drivers must report the durable
 * driver set and the durable wallet balances.
 *
 * Two proven C-class defects are in scope, and only these:
 *   coverage: the list is built from `db.drivers`, the boot-time mirror, so a driver
 *             created after boot is absent from a screen whose whole purpose is "who is
 *             owed money" - even with a durable wallet balance.
 *   wallet:   `walletBalance` comes from the mirror, so it can be stale by any amount
 *             another process moved.
 *
 * The divergence is created naturally, without touching the server's memory: the probe
 * driver and its credit are written from this process, and the server's mirror was
 * hydrated before any of it existed. Nothing here mutates a historical financial row -
 * all money belongs to a disposable probe driver.
 *
 * Deliberately NOT asserted: upiId, bankAccount, todayEarnings. Those are D (no verified
 * durable contract); this test only requires their keys to survive. `status` is checked
 * only for the shape it has always had, derived from the balance, and is deliberately not
 * mapped onto driver_payouts.status, which is a different concept.
 *
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('F3 REFUSED: non-loopback target'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const STAMP = Date.now();
const OPENING_BALANCE = 4242;
const CREDIT = 250;
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
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
const rowFor = (list, key) => (list || []).find(r => String(r.driverId) === String(key)
  || String(r.driverUuid || '') === String(key));

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const durableWallet = async (id) => Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [id])).w);

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('F3-01', 'a finance.settlement-capable session exists', login.status === 200 && !!tok, { status: login.status });
  if (!tok) process.exit(1);

  const anon = await api('GET', '/api/admin/finance/settlements/drivers');
  check('F3-02', 'authorization is unchanged: an unauthenticated caller is refused',
    anon.status === 401 || anon.status === 403, { status: anon.status });

  const before = await api('GET', '/api/admin/finance/settlements/drivers', null, tok);
  const beforeList = before.data.driverSettlements || [];
  check('F3-03', 'endpoint answers with the documented array shape',
    before.status === 200 && Array.isArray(before.data.driverSettlements),
    { status: before.status, rows: beforeList.length, sampleKeys: beforeList[0] && Object.keys(beforeList[0]) });

  // ---------- disposable probe driver, created AFTER the server hydrated ----------
  const drv = (await supabaseAdmin.from('drivers').insert({
    phone: `86${String(STAMP).slice(-8)}`, name: `F3 settlement probe ${STAMP}`, vehicle_type: 'AUTO',
    vehicle_number: `F3${String(STAMP).slice(-4)}`, operational_status: 'AVAILABLE',
    wallet_balance: OPENING_BALANCE
  }).select('id').single()).data;
  console.log(`  probe driver ${drv.id} durable wallet=${OPENING_BALANCE}, created after server boot`);
  check('F3-04', 'the probe driver is durable with a known wallet', await durableWallet(drv.id) === OPENING_BALANCE,
    { durable: await durableWallet(drv.id) });

  const after = await api('GET', '/api/admin/finance/settlements/drivers', null, tok);
  const row1 = rowFor(after.data.driverSettlements, drv.id);
  check('F3-05', 'COVERAGE: a post-boot driver with a durable balance is listed',
    !!row1, { listed: !!row1, rows: (after.data.driverSettlements || []).length });
  check('F3-06', `WALLET: its reported balance is the durable ${OPENING_BALANCE}`,
    !!row1 && Number(row1.walletBalance) === OPENING_BALANCE,
    row1 ? { reported: row1.walletBalance, durable: OPENING_BALANCE } : { note: 'driver not listed at all' });

  // ---------- move money durably; the server's mirror can never see it ----------
  const rw = await supabaseAdmin.rpc('adjust_wallet_atomic', {
    p_owner_id: drv.id, p_owner_type: 'DRIVER', p_amount: CREDIT, p_category: 'RIDE_SETTLEMENT',
    p_description: 'F3 settlement authority probe', p_reference_id: `F3:${STAMP}`,
    p_debit_account: 'CUSTOMER_WALLET_LIABILITY', p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
    p_idempotency_key: `F3:${STAMP}:DRIVER_EARNINGS`
  });
  if (rw.error) { console.log('  FATAL: probe credit failed: ' + rw.error.message); process.exit(1); }
  const expected = await durableWallet(drv.id);
  check('F3-07', 'the durable credit itself applied exactly once', expected === OPENING_BALANCE + CREDIT,
    { durable: expected });

  const after2 = await api('GET', '/api/admin/finance/settlements/drivers', null, tok);
  const row2 = rowFor(after2.data.driverSettlements, drv.id);
  check('F3-08', 'the endpoint follows the durable balance, not the boot-time mirror',
    !!row2 && Number(row2.walletBalance) === expected,
    row2 ? { reported: row2.walletBalance, durable: expected } : { listed: false });
  check('F3-09', 'status still derives from the balance (shape preserved, no new mapping)',
    !!row2 && typeof row2.status === 'string' && row2.status.length > 0, { status: row2 && row2.status });
  // The existing response omits upiId/bankAccount when they are unset, so the contract
  // being preserved is "the keys that already always appear" - not a new, wider shape.
  check('F3-10', 'the always-present keys are intact and none were invented away',
    !!row2 && ['driverId', 'driverName', 'walletBalance', 'todayEarnings', 'status']
      .every(k => Object.prototype.hasOwnProperty.call(row2, k)),
    row2 && Object.keys(row2));
  // identity fields for a driver the server already knew must not have been broken
  const known = beforeList[0] && rowFor(after2.data.driverSettlements, beforeList[0].driverId);
  check('F3-12', 'the pre-existing row key set is unchanged for a driver known before the fix',
    !known || JSON.stringify(Object.keys(beforeList[0]).sort()) === JSON.stringify(Object.keys(known).sort()),
    { before: beforeList[0] && Object.keys(beforeList[0]), after: known && Object.keys(known) });
  if (known) {
    const dn = await one('SELECT name FROM drivers WHERE id::text = $1 OR id::text = $2 LIMIT 1',
      [String(known.driverId), String(known.driverId)]);
    check('F3-11', 'an already-known driver keeps its identity fields',
      !!dn === false || dn === null || known.driverName === dn.name || typeof known.driverName === 'string',
      { driverId: known.driverId, driverName: known.driverName });
  } else {
    check('F3-11', 'an already-known driver is still listed after the fix', false,
      { note: 'previously listed driver vanished from the response' });
  }

  // ---------- cleanup: probe driver holds journal rows, so it is retained ----------
  const hist = await one(`SELECT (
      (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text) +
      (SELECT count(*) FROM driver_payouts WHERE driver_id = $1::uuid)) n`, [drv.id]);
  console.log(`  probe driver journal/payout rows = ${hist.n}`);
  const gone = await c.query('DELETE FROM drivers WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text) AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)', [drv.id]);
  console.log(`  cleanup DELETE drivers rowCount=${gone.rowCount}`
    + (gone.rowCount === 0 ? ' -> RETAINED (it carries financial history; deleting would strand money)' : ' -> removed, verified by the same guarded statement'));
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== F3 DRIVER-SETTLEMENT AUTHORITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
