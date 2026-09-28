/*
 * PHASE 38 regression — the driver earnings read must report durable PostgreSQL state.
 *
 * Phase 37 proved by direct measurement that the ride money-WRITING path is correct (one
 * adjust_wallet_atomic credit per completion, mirror and durable agreeing immediately after),
 * and that the failures are read-side: a long-lived process answers from `db.drivers`, a mirror
 * hydrated at boot, which can lag durable by a settlement (EARN-13: mirror 1022 vs durable 1111)
 * or lead it on the payout columns (EARN-24: API returned a per-run
 * `rajesh.verified.m4.<ms>@okhdfcbank` while `drivers.verified_upi_id` is
 * `rajesh.kumar@okhdfcbank`).
 *
 * So this test asserts the read-side contract and, just as importantly, that the fix is inert
 * with respect to money: it must not create journal rows, move wallets or write payouts.
 *
 * Local/test only; refuses any non-loopback database.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('DURABLE-READ REGRESSION REFUSED: non-loopback database'); process.exit(1);
}
const fs = require('fs');
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');

const STAMP = Date.now();
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 180)}` : ''));
}

(async () => {
  if (!isLivePostgres || !supabaseAdmin) {
    console.log('SKIP: this regression compares durable PostgreSQL against the mirror.');
    process.exit(1);
  }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  const drv = (await supabaseAdmin.from('drivers').insert({
    phone: `93${String(STAMP).slice(-8)}`, name: `P38 durable-read probe ${STAMP}`,
    vehicle_type: 'AUTO', vehicle_number: `P38${String(STAMP).slice(-4)}`,
    operational_status: 'AVAILABLE', wallet_balance: 777,
    verified_upi_id: `p38.durable.${STAMP}@okhdfcbank`, payout_upi_verified: true,
    pending_upi_id: null
  }).select('id').single()).data;

  const money0 = await one(`SELECT
      (SELECT count(*) FROM journal_transactions) jt,
      (SELECT count(*) FROM journal_lines) jl,
      (SELECT count(*) FROM driver_payouts) po`);

  console.log('--- CASE 1: mirror diverges from durable, and is stale in BOTH directions ---');
  const mirror = {
    id: drv.id, uuid: drv.id,
    walletBalance: 1022,                       // durable says 777 -> mirror is ahead
    verifiedUpiId: `rajesh.verified.m4.${STAMP}@okhdfcbank`,  // the EARN-24 shape
    verified_upi_id: `rajesh.verified.m4.${STAMP}@okhdfcbank`,
    payoutUpiVerified: false,                  // durable says true -> mirror is behind
    pending_upi_id: 'stale.pending@ok',        // durable says null
    upi_cooling_until: '2020-01-01T00:00:00.000Z'
  };
  const out = await db.reconcileDriverFromDurable(mirror);
  check('DREAD-01', 'wallet reports the durable column, not the mirror',
    Number(out && out.walletBalance) === 777, out && { wallet: out.walletBalance });
  check('DREAD-02', 'verified UPI reports the durable value, not the in-memory one',
    out && out.verifiedUpiId === `p38.durable.${STAMP}@okhdfcbank`,
    out && { camel: out.verifiedUpiId, snake: out.verified_upi_id });
  check('DREAD-03', 'payout_upi_verified follows durable', out && out.payoutUpiVerified === true);
  check('DREAD-04', 'pending_upi_id follows durable (null, not a stale value)',
    out && (out.pendingUpiId === null || out.pendingUpiId === undefined), out && { pending: out.pendingUpiId });
  check('DREAD-05', 'both mirror key spellings are kept in sync (database.js precedent)',
    out && out.verified_upi_id === out.verifiedUpiId
      && out.payout_upi_verified === out.payoutUpiVerified,
    out && { camel: out.verifiedUpiId, snake: out.verified_upi_id });
  check('DREAD-06', 'the same object is mutated and returned (routes hold one reference)',
    out === mirror);

  console.log('\n--- CASE 2: mirror already agrees with durable -> no change ---');
  const same = { id: drv.id, uuid: drv.id, walletBalance: 777,
    verifiedUpiId: `p38.durable.${STAMP}@okhdfcbank`, payoutUpiVerified: true, pendingUpiId: null };
  const out2 = await db.reconcileDriverFromDurable(same);
  check('DREAD-07', 'an in-sync record is unchanged', Number(out2.walletBalance) === 777
    && out2.verifiedUpiId === `p38.durable.${STAMP}@okhdfcbank` && out2.payoutUpiVerified === true);

  console.log('\n--- CASE 3: nothing durable to read -> cache is kept, no throw (HYD-05 shape) ---');
  const ghost = { id: 'not-a-driver-id', uuid: 'not-a-driver-id', walletBalance: 55 };
  let threw = null, out3 = null;
  try { out3 = await db.reconcileDriverFromDurable(ghost); } catch (e) { threw = e; }
  check('DREAD-08', 'unresolvable identity does not throw and leaves the cached record alone',
    threw === null && out3 && Number(out3.walletBalance) === 55,
    threw ? { code: threw.code || threw.message.slice(0, 60) } : { wallet: out3 && out3.walletBalance });
  check('DREAD-09', 'a null/undefined record is returned as-is',
    (await db.reconcileDriverFromDurable(null)) === null);

  console.log('\n--- CASE 4: the fix must be inert with respect to money ---');
  const money1 = await one(`SELECT
      (SELECT count(*) FROM journal_transactions) jt,
      (SELECT count(*) FROM journal_lines) jl,
      (SELECT count(*) FROM driver_payouts) po,
      (SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid) wallet`, [drv.id]);
  check('DREAD-10', 'reconciling created no journal transaction, no line and no payout',
    Number(money1.jt) === Number(money0.jt) && Number(money1.jl) === Number(money0.jl)
      && Number(money1.po) === Number(money0.po), { jt_delta: Number(money1.jt) - Number(money0.jt),
      jl_delta: Number(money1.jl) - Number(money0.jl), po_delta: Number(money1.po) - Number(money0.po) });
  check('DREAD-11', 'reconciling did not write the durable wallet (read only)',
    Number(money1.wallet) === 777, { durable_wallet: money1.wallet });

  console.log('\n--- CASE 5: ONE shared implementation for both earnings routes (EARN-21) ---');
  const srv = fs.readFileSync('src/server.js', 'utf8');
  const defAt = srv.indexOf('async function buildDriverEarningsPayload');
  const body = srv.slice(defAt, srv.indexOf('\napp.', defAt));
  const calls = (srv.match(/buildDriverEarningsPayload\(/g) || []).length;
  check('DREAD-12', 'the reconcile call lives inside the shared builder, not in a route',
    body.includes('reconcileDriverFromDurable'), { inBody: body.includes('reconcileDriverFromDurable') });
  check('DREAD-13', 'neither route reconciles the driver on its own (one implementation)',
    (srv.match(/reconcileDriverFromDurable/g) || []).length === 1,
    { totalOccurrences: (srv.match(/reconcileDriverFromDurable/g) || []).length, builderCalls: calls });

  console.log('\n=== teardown (rowCount-safe; this probe moved no money) ===');
  const hist = await one(`SELECT (
      (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text) +
      (SELECT count(*) FROM driver_payouts WHERE driver_id = $1::uuid)) n`, [drv.id]);
  if (Number(hist.n) > 0) {
    console.log(`  RETAINING driver ${drv.id}: ${hist.n} financial row(s) reference it`);
  } else {
    const del = await c.query('DELETE FROM drivers WHERE id=$1::uuid', [drv.id]);
    const gone = await one('SELECT count(*) n FROM drivers WHERE id=$1::uuid', [drv.id]);
    console.log(`  DELETE drivers id=${drv.id} rowCount=${del.rowCount}; post-delete count=${gone.n}`
      + (del.rowCount === 1 && Number(gone.n) === 0 ? ' -> verified removed' : ' -> NOT VERIFIED'));
  }
  await c.end();
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== RESULTS: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
