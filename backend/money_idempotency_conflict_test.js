/*
 * E2 regression — an idempotency key must identify ONE operation.
 *
 * Contract being pinned:
 *   same key + same operation semantics -> duplicate, zero additional money
 *   same key + different semantics      -> IDEMPOTENCY_CONFLICT, zero additional money
 *
 * Before this phase both duplicate paths (`adjust_wallet_atomic`'s in-function skip and the
 * `23505` concurrent-collision handler in LedgerRepository.adjustWallet) classified a reused key
 * as a duplicate without comparing anything, so a request that reused a key for a different
 * amount, owner or account was silently swallowed: the caller saw success, no money moved, and
 * no one was told the key had been reused for a different operation.
 *
 * The PostgreSQL UNIQUE(idempotency_key) constraint remains the thing that prevents a second
 * movement; this test checks that the money really never moved, not just the status string.
 *
 * Local/test only; refuses any non-loopback database.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('IDEMPOTENCY-CONFLICT REGRESSION REFUSED: non-loopback database'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');

const STAMP = Date.now();
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
}
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const retained = [];

  const mkDriver = async (label) => {
    const d = (await supabaseAdmin.from('drivers').insert({
      phone: `92${String(STAMP).slice(-8)}${label}`, name: `E2 conflict probe ${label} ${STAMP}`,
      vehicle_type: 'AUTO', vehicle_number: `E2${label}${String(STAMP).slice(-3)}`,
      operational_status: 'AVAILABLE', wallet_balance: 0
    }).select('id').single()).data;
    retained.push(d.id);
    return d;
  };
  const walletOf = async (id) => Number((await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [id])).w);
  const journalCounts = async () => one('SELECT (SELECT count(*) FROM journal_transactions) jt, (SELECT count(*) FROM journal_lines) jl');
  const opRows = async (key) => (await c.query(`SELECT t.id::text, t.total_credit::text, t.total_debit::text,
        t.category, string_agg(l.account_code || ':' || l.entry_type, ',' ORDER BY l.entry_type) lines
      FROM journal_transactions t LEFT JOIN journal_lines l ON l.journal_id = t.id
      WHERE t.idempotency_key = $1 GROUP BY t.id, t.total_credit, t.total_debit, t.category`, [key])).rows;
  const credit = (ownerId, amount, key, extra = {}) => db.ledgerRepo.adjustWallet(Object.assign({
    ownerId, ownerType: 'DRIVER', amount, category: 'RIDE_SETTLEMENT',
    description: 'E2 conflict regression', referenceId: `E2:${STAMP}`, idempotencyKey: key
  }, extra));
  const run = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, code: e.code, status: e.status || e.statusCode, msg: (e.message || '').slice(0, 90) }; } };

  const A = await mkDriver('a');
  const B = await mkDriver('b');

  console.log('--- 1. identical replay: duplicate, exactly one movement ---');
  const K1 = `E2:${STAMP}:same`;
  const j0 = await journalCounts();
  const first = await run(() => credit(A.id, 500, K1));
  const w1 = await walletOf(A.id);
  const retry = await run(() => credit(A.id, 500, K1));
  const w2 = await walletOf(A.id);
  const j1 = await journalCounts();
  check('CONF-01', 'the first call books the money', first.ok && first.r && first.r.duplicate === false && near(w1, 500),
    { firstOk: first.ok, dup: first.r && first.r.duplicate, wallet: w1 });
  check('CONF-02', 'an identical replay reports duplicate', retry.ok && retry.r && retry.r.duplicate === true,
    retry.r ? { duplicate: retry.r.duplicate, status: retry.r.status } : { code: retry.code });
  check('CONF-03', 'the replay moved nothing and booked nothing',
    near(w2, w1) && Number(j1.jt) === Number(j0.jt) + 1 && Number(j1.jl) === Number(j0.jl) + 2,
    { wallet: w2, txn_delta: Number(j1.jt) - Number(j0.jt), line_delta: Number(j1.jl) - Number(j0.jl) });

  console.log('\n--- 2. same key, DIFFERENT AMOUNT: must be IDEMPOTENCY_CONFLICT, zero movement ---');
  const wBefore = await walletOf(A.id);
  const conflictAmt = await run(() => credit(A.id, 900, K1));
  const wAfter = await walletOf(A.id);
  const rowsAmt = await opRows(K1);
  check('CONF-04', 'a different amount under the same key is rejected as a conflict',
    conflictAmt.ok === false && conflictAmt.code === 'IDEMPOTENCY_CONFLICT',
    { code: conflictAmt.code, status: conflictAmt.status, msg: conflictAmt.msg });
  check('CONF-05', 'the conflicting request moved no money', near(wAfter, wBefore), { before: wBefore, after: wAfter });
  check('CONF-06', 'and it booked no additional journal row', rowsAmt.length === 1 && near(Number(rowsAmt[0].total_credit), 500),
    { rows: rowsAmt.length, credit: rowsAmt[0] && rowsAmt[0].total_credit });

  console.log('\n--- 3. same key, DIFFERENT OWNER: conflict, and the other owner is untouched ---');
  const bBefore = await walletOf(B.id);
  const conflictOwner = await run(() => credit(B.id, 500, K1));
  const bAfter = await walletOf(B.id);
  check('CONF-07', 'cross-owner reuse of a key is a conflict',
    conflictOwner.ok === false && conflictOwner.code === 'IDEMPOTENCY_CONFLICT',
    { code: conflictOwner.code, msg: conflictOwner.msg });
  check('CONF-08', 'the second driver received nothing', near(bAfter, bBefore), { before: bBefore, after: bAfter });

  console.log('\n--- 4. same key, DIFFERENT ACCOUNTS: conflict ---');
  // Both accounts are given explicitly on purpose. Passing only one is silently overwritten by
  // adjustWallet's derivation block (a real quirk, recorded as Q1), which would make this request
  // effectively identical and prove nothing about conflict detection.
  const conflictAcct = await run(() => credit(A.id, 500, K1, {
    debitAccount: 'DRIVER_EARNINGS_PAYABLE', creditAccount: 'PLATFORM_COMMISSION_REVENUE'
  }));
  check('CONF-09', 'a different posting pair under the same key is a conflict',
    conflictAcct.ok === false && conflictAcct.code === 'IDEMPOTENCY_CONFLICT',
    { code: conflictAcct.code, msg: conflictAcct.msg });

  console.log('\n--- 5. same key, DIFFERENT CATEGORY: conflict ---');
  const conflictCat = await run(() => credit(A.id, 500, K1, { category: 'WALLET_TOPUP' }));
  check('CONF-10', 'a different category under the same key is a conflict',
    conflictCat.ok === false && conflictCat.code === 'IDEMPOTENCY_CONFLICT',
    { code: conflictCat.code, msg: conflictCat.msg });
  check('CONF-11', 'none of the conflicting attempts changed the wallet', near(await walletOf(A.id), w2), { wallet: await walletOf(A.id) });

  console.log('\n--- 6. concurrent IDENTICAL: exactly one movement ---');
  const K2 = `E2:${STAMP}:conc-same`;
  const wA0 = await walletOf(A.id);
  const jA0 = await journalCounts();
  const both = await Promise.all([run(() => credit(A.id, 250, K2)), run(() => credit(A.id, 250, K2))]);
  const wA1 = await walletOf(A.id);
  const jA1 = await journalCounts();
  const booked = both.filter(b => b.ok && b.r && b.r.duplicate === false).length;
  const dupes = both.filter(b => b.ok && b.r && b.r.duplicate === true).length;
  const rejected = both.filter(b => !b.ok).length;
  check('CONF-12', 'concurrent identical calls produce exactly one booked movement',
    booked === 1 && (dupes + rejected) === 1 && near(wA1 - wA0, 250),
    { booked, dupes, rejected, delta: Number((wA1 - wA0).toFixed(2)) });
  check('CONF-13', 'and exactly one journal transaction (+2 lines)',
    Number(jA1.jt) === Number(jA0.jt) + 1 && Number(jA1.jl) === Number(jA0.jl) + 2,
    { txn_delta: Number(jA1.jt) - Number(jA0.jt), line_delta: Number(jA1.jl) - Number(jA0.jl) });

  console.log('\n--- 7. concurrent CONFLICTING: one books, the other conflicts, no extra money ---');
  const K3 = `E2:${STAMP}:conc-diff`;
  const wB0 = await walletOf(B.id);
  const pair = await Promise.all([run(() => credit(B.id, 300, K3)), run(() => credit(B.id, 400, K3))]);
  const wB1 = await walletOf(B.id);
  const jB = await opRows(K3);
  const okOnes = pair.filter(p => p.ok);
  const confOnes = pair.filter(p => !p.ok && p.code === 'IDEMPOTENCY_CONFLICT');
  check('CONF-14', 'exactly one of the two conflicting requests booked money', okOnes.length === 1,
    { booked: okOnes.length, codes: pair.map(p => (p.ok ? 'ok' : p.code)) });
  check('CONF-15', 'the other was refused as a conflict, not silently duplicated',
    confOnes.length === 1 && !pair.some(p => p.ok && p.r && p.r.duplicate === true),
    { outcomes: pair.map(p => (p.ok ? `dup=${p.r.duplicate}` : `${p.code}/${p.status}/${p.msg}`)) });
  check('CONF-16', 'the wallet moved once and the ledger holds one transaction for the key',
    (near(wB1 - wB0, 300) || near(wB1 - wB0, 400)) && jB.length === 1,
    { delta: Number((wB1 - wB0).toFixed(2)), rows: jB.length });

  console.log('\n--- 8. lost-response retry is a duplicate, not a conflict ---');
  const retryAfterLost = await run(() => credit(A.id, 250, K2));
  check('CONF-17', 'replaying a committed operation after a lost response reports duplicate',
    retryAfterLost.ok && retryAfterLost.r && retryAfterLost.r.duplicate === true,
    retryAfterLost.r ? { duplicate: retryAfterLost.r.duplicate } : { code: retryAfterLost.code });
  check('CONF-18', 'and the wallet is unchanged by that retry', near(await walletOf(A.id), wA1), { wallet: await walletOf(A.id) });

  console.log('\n--- 9. no key at all: behaviour must be unchanged (no comparison possible) ---');
  const keyless = await run(() => credit(A.id, 10, K2 + ':none-1'));
  check('CONF-19', 'a distinct new key still books normally', keyless.ok && keyless.r && keyless.r.duplicate === false,
    { ok: keyless.ok, dup: keyless.r && keyless.r.duplicate, code: keyless.code });

  console.log('\n=== teardown (rowCount-safe; probes with journal history are RETAINED) ===');
  for (const id of retained) {
    const hist = await one(`SELECT (
        (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text) +
        (SELECT count(*) FROM driver_payouts WHERE driver_id = $1::uuid)) n`, [id]);
    if (Number(hist.n) > 0) { console.log(`  RETAIN driver ${id}: ${hist.n} financial row(s) reference it`); continue; }
    const del = await c.query('DELETE FROM drivers WHERE id=$1::uuid', [id]);
    const gone = await one('SELECT count(*) n FROM drivers WHERE id=$1::uuid', [id]);
    console.log(`  DELETE drivers ${id} rowCount=${del.rowCount}; post-delete count=${gone.n}`
      + (del.rowCount === 1 && Number(gone.n) === 0 ? ' -> verified removed' : ' -> NOT VERIFIED'));
  }
  await c.end();
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== IDEMPOTENCY-CONFLICT REGRESSION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
