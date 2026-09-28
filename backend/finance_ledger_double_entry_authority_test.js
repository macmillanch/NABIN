/*
 * F5 regression — GET /api/admin/finance/ledger-double-entry must answer from the durable
 * journal, not from the boot-time `ledgerEntries` projection.
 *
 * Measured contract this test pins (all of it read out of source, not assumed):
 *   one response element = ONE journal transaction header collapsed to a primary
 *   debit/credit pair, with keys id, transactionId, debitAccount, creditAccount, amount,
 *   currency, description, referenceId, timestamp
 *   - transactionId  <- journal_transactions.transaction_id (UNIQUE varchar business id)
 *   - amount         <- journal_transactions.total_debit (NOT a sum of lines)
 *   - debit/credit   <- FIRST DEBIT / FIRST CREDIT line's account_code, with the app's own
 *                       'CUSTOMER_RECEIVABLE' / 'DRIVER_PAYABLE' fallbacks preserved
 *   - lines join journal_lines.journal_id -> journal_transactions.id (a uuid), and there is
 *     NO journal_lines.transaction_id column at all
 *   - account filter      = exact match on EITHER side (debit or credit), never a substring
 *   - transactionId filter= transaction_id OR reference_id, both exact; reference_id is
 *     shared by 1,246 headers, so this branch is load-bearing and must not be dropped
 *
 * Today the projection is built at boot from `.limit(500)` newest-first while the durable
 * journal holds thousands of headers, so the endpoint silently understates the ledger.
 *
 * Assertions use direct durable SQL only. No historical financial row is touched: every
 * posting here belongs to a disposable probe driver created by this run.
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('F5 REFUSED: non-loopback target'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const STAMP = Date.now();
const KEY = `F5:${STAMP}:DRIVER_EARNINGS`;
const REF = `F5REF:${STAMP}`;
const AMOUNT = 313;
const ENTRY_KEYS = ['id', 'transactionId', 'debitAccount', 'creditAccount', 'amount',
  'currency', 'description', 'referenceId', 'timestamp'];
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''));
}
const api = async (method, path, token) => {
  const res = await fetch(BASE + path, { method, headers: token ? { 'Authorization': `Bearer ${token}` } : {} });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const many = async (sql, p) => (await c.query(sql, p)).rows;

  const lr = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'AdminPassword123!' })
  });
  const lj = await lr.json();
  const tok = lj.token;
  check('F5-01', 'a finance.view-capable session exists', lr.status === 200 && !!tok, { status: lr.status });
  if (!tok) process.exit(1);

  const anon = await api('GET', '/api/admin/finance/ledger-double-entry');
  check('F5-02', 'authorization is unchanged: anonymous is refused',
    anon.status === 401 || anon.status === 403, { status: anon.status });

  const base0 = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl`);
  console.log(`  durable journal at start: ${base0.jt} headers / ${base0.jl} lines`);

  const e0 = await api('GET', '/api/admin/finance/ledger-double-entry', tok);
  const list0 = e0.data.entries || [];
  check('F5-03', 'envelope and per-entry key contract are as built today',
    e0.status === 200 && Array.isArray(e0.data.entries) && e0.data.total === list0.length
      && (!list0.length || ENTRY_KEYS.every(k => k in list0[0])),
    { status: e0.status, rows: list0.length, total: e0.data.total, keys: list0[0] && Object.keys(list0[0]) });

  // ---------- a controlled durable posting this process cannot have mirrored ----------
  const drv = (await supabaseAdmin.from('drivers').insert({
    phone: `79${String(STAMP).slice(-8)}`, name: `F5 ledger probe ${STAMP}`, vehicle_type: 'AUTO',
    vehicle_number: `F5${String(STAMP).slice(-4)}`, operational_status: 'AVAILABLE', wallet_balance: 0
  }).select('id').single()).data;

  const post = await supabaseAdmin.rpc('adjust_wallet_atomic', {
    p_owner_id: drv.id, p_owner_type: 'DRIVER', p_amount: AMOUNT, p_category: 'RIDE_SETTLEMENT',
    p_description: 'F5 double-entry authority probe', p_reference_id: REF,
    p_debit_account: 'CUSTOMER_WALLET_LIABILITY', p_credit_account: 'DRIVER_EARNINGS_PAYABLE',
    p_idempotency_key: KEY
  });
  if (post.error) { console.log('  FATAL: probe posting failed: ' + post.error.message); process.exit(1); }

  const hdr = await one(`SELECT t.transaction_id, t.category, t.total_debit::text amt, t.description,
        t.reference_id, t.created_at::text ts,
        (SELECT l.account_code FROM journal_lines l WHERE l.journal_id = t.id AND l.entry_type = 'DEBIT'
          ORDER BY l.id LIMIT 1) debit,
        (SELECT l.account_code FROM journal_lines l WHERE l.journal_id = t.id AND l.entry_type = 'CREDIT'
          ORDER BY l.id LIMIT 1) credit,
        (SELECT count(*) FROM journal_lines l WHERE l.journal_id = t.id)::int nlines
      FROM journal_transactions t WHERE t.idempotency_key = $1`, [KEY]);
  check('F5-04', 'the probe posting is durable as ONE header with balanced legs',
    !!hdr && hdr.debit === 'CUSTOMER_WALLET_LIABILITY' && hdr.credit === 'DRIVER_EARNINGS_PAYABLE'
      && Number(hdr.amt) === AMOUNT && hdr.nlines === 2,
    hdr && { transaction_id: hdr.transaction_id, amt: hdr.amt, debit: hdr.debit, credit: hdr.credit, lines: hdr.nlines });
  if (!hdr) { console.log('  FATAL: no durable header found for the probe key'); process.exit(1); }

  const after = await api('GET', '/api/admin/finance/ledger-double-entry', tok);
  const list1 = after.data.entries || [];
  const found = list1.find(e => e.transactionId === hdr.transaction_id);
  check('F5-05', 'FRESH DURABLE POSTING: the endpoint exposes the transaction it just committed',
    !!found, { durable: hdr.transaction_id, listed: !!found, rows: list1.length });
  check('F5-06', 'its reported amount is the durable total_debit, not a re-derivation',
    !!found && Number(found.amount) === AMOUNT,
    found ? { reported: found.amount, durable: hdr.amt } : { note: 'transaction absent' });
  check('F5-07', 'its reported legs are the durable account codes',
    !!found && found.debitAccount === hdr.debit && found.creditAccount === hdr.credit,
    found ? { reported: [found.debitAccount, found.creditAccount], durable: [hdr.debit, hdr.credit] } : {});

  // ---------- incompleteness: durable headers exist that the projection never saw ----------
  const durableCount = Number((await one('SELECT count(*)::text n FROM journal_transactions')).n);
  check('F5-08', 'the endpoint does not understate the durable ledger (every header is reachable)',
    list1.length >= durableCount, { endpointRows: list1.length, durableHeaders: durableCount });

  // ---------- filter semantics, measured rather than assumed ----------
  const byAcct = await api('GET', `/api/admin/finance/ledger-double-entry?account=${encodeURIComponent('DRIVER_EARNINGS_PAYABLE')}`, tok);
  const acctList = byAcct.data.entries || [];
  check('F5-09', 'account filter matches on EITHER side, exactly as the projection did',
    acctList.length > 0 && acctList.every(e => e.debitAccount === 'DRIVER_EARNINGS_PAYABLE'
      || e.creditAccount === 'DRIVER_EARNINGS_PAYABLE'),
    { rows: acctList.length, sample: acctList[0] && [acctList[0].debitAccount, acctList[0].creditAccount] });
  const probeByAcct = acctList.find(e => e.transactionId === hdr.transaction_id);
  check('F5-10', 'account filter finds a durable posting whose credit leg is that account',
    !!probeByAcct, { looked: hdr.transaction_id, rows: acctList.length });

  const byTxn = await api('GET', `/api/admin/finance/ledger-double-entry?transactionId=${encodeURIComponent(hdr.transaction_id)}`, tok);
  check('F5-11', 'transactionId filter is exact-match and finds the durable header',
    (byTxn.data.entries || []).some(e => e.transactionId === hdr.transaction_id),
    { rows: (byTxn.data.entries || []).length });

  const byRef = await api('GET', `/api/admin/finance/ledger-double-entry?transactionId=${encodeURIComponent(REF)}`, tok);
  check('F5-12', 'the OR-on-reference_id branch of the transactionId filter is preserved',
    (byRef.data.entries || []).some(e => e.transactionId === hdr.transaction_id),
    { reference: REF, rows: (byRef.data.entries || []).length });

  const prefix = hdr.transaction_id.slice(0, Math.max(4, hdr.transaction_id.length - 3));
  const partial = await api('GET', `/api/admin/finance/ledger-double-entry?transactionId=${encodeURIComponent(prefix)}`, tok);
  const partialRows = partial.data.entries || [];
  check('F5-13', 'no silent switch to substring matching: a prefix must not match',
    !partialRows.some(e => e.transactionId === hdr.transaction_id),
    { prefix, rows: partialRows.length });

  // ---------- nothing else moved ----------
  const delta = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl`);
  check('F5-14', 'exactly one header and two legs were added in total; no duplicate posting',
    Number(delta.jt) - Number(base0.jt) === 1 && Number(delta.jl) - Number(base0.jl) === 2,
    { headers_added: Number(delta.jt) - Number(base0.jt), lines_added: Number(delta.jl) - Number(base0.jl) });

  // ---------- cleanup: probe driver carries journal history, so it is retained ----------
  const gone = await c.query(`DELETE FROM drivers WHERE id=$1::uuid
      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
      AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [drv.id]);
  console.log(`  cleanup DELETE drivers rowCount=${gone.rowCount}`
    + (gone.rowCount === 0 ? ' -> probe driver RETAINED (its journal legs are durable history)' : ' -> removed under the same guard'));

  await c.end();
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== F5 DOUBLE-ENTRY AUTHORITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
