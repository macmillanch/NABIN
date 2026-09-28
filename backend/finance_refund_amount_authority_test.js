/*
 * Finance sweep - POST /api/admin/finance/refund amount authority.
 *
 * This suite LOCKS a contract that already holds, rather than reproducing a defect: the
 * route delegates the money decision to the SECURITY DEFINER function
 * `refund_payment_atomic`, which computes
 *
 *   v_refundable_left := payments.amount - COALESCE(payments.refunded_amount, 0)
 *   declared amount  -> refund that, guarded by EXCEEDS_REFUNDABLE_BALANCE
 *   omitted amount   -> refund v_refundable_left  ("what is still refundable", not "the
 *                       original amount" once part has already gone back)
 *
 * so an omitted `amount` is NOT ambiguous and does not involve any in-memory mirror. Every
 * payment below is created by this run after the server booted, so the server has no memory
 * of it at all: if the route were consulting a cache to size the refund, these refunds could
 * not produce the durable figures asserted here. That is the mirror-independence proof.
 *
 * Refund identity/idempotency is asserted through payment_refund_authorizations, and the
 * double-entry reversal through durable ledger_entries counts, all as measured deltas - never
 * as absolute totals. No historical financial row is mutated; every payment is disposable.
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('REFUND AUTH REFUSED: non-loopback target'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const STAMP = Date.now();
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
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const pay = async (id, amount) => {
    const r = await supabaseAdmin.from('payments').insert({
      payment_id: id, amount, currency: 'INR', method: 'UPI', status: 'CAPTURED',
      gateway_order_id: `order_${id}`, created_at: new Date().toISOString()
    }).select('payment_id').single();
    if (r.error) { console.log(`  FATAL: payment ${id} could not be created: ` + JSON.stringify(r.error)); process.exit(1); }
    return id;
  };
  const dur = async (id) => one('SELECT amount::text a, refunded_amount::text r, status FROM payments WHERE payment_id=$1', [id]);
  const start = await one(`SELECT (SELECT count(*) FROM payment_refund_authorizations)::text auth,
      (SELECT count(*) FROM ledger_entries)::text le, (SELECT count(*) FROM payments)::text py`);
  console.log(`  at start: authorizations=${start.auth} ledger_entries=${start.le} payments=${start.py}`);

  const login = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = login.data.token;
  check('RAF-01', 'a finance.refund session exists', login.status === 200 && !!tok, { status: login.status });
  if (!tok) process.exit(1);
  const anon = await api('POST', '/api/admin/finance/refund', { paymentId: 'x' });
  check('RAF-02', 'authorization unchanged: anonymous is refused', anon.status === 401 || anon.status === 403,
    { status: anon.status });

  // ---------- omitted amount on a fresh payment = the whole refundable balance ----------
  const P1 = await pay(`pay_raf1_${STAMP}`, 1000);
  const r1 = await api('POST', '/api/admin/finance/refund',
    { paymentId: P1, reason: 'RAF probe 1', ticketId: `TKT-RAF1-${STAMP}`, idempotencyKey: `raf1:${STAMP}` }, tok);
  const d1 = await dur(P1);
  check('RAF-03', 'omitted amount refunded the FULL remaining balance (1000), decided durably',
    r1.status === 200 && Number((r1.data.refundAmount ?? r1.data.amount)) === 1000
      && Number(d1.r) === 1000 && d1.status === 'REFUNDED',
    { status: r1.status, reported: r1.data.refundAmount, durable_refunded: d1.r, durable_status: d1.status });

  // ---------- omitted amount after a partial = what is LEFT, not the original ----------
  const P2 = await pay(`pay_raf2_${STAMP}`, 800);
  const r2a = await api('POST', '/api/admin/finance/refund',
    { paymentId: P2, amount: 300, reason: 'RAF probe 2a', ticketId: `TKT-RAF2A-${STAMP}`, idempotencyKey: `raf2a:${STAMP}` }, tok);
  const d2a = await dur(P2);
  check('RAF-04', 'an explicit partial refund booked 300 and left the payment PARTIALLY_REFUNDED',
    r2a.status === 200 && Number(d2a.r) === 300 && d2a.status === 'PARTIALLY_REFUNDED',
    { status: r2a.status, durable_refunded: d2a.r, durable_status: d2a.status });
  const r2b = await api('POST', '/api/admin/finance/refund',
    { paymentId: P2, reason: 'RAF probe 2b', ticketId: `TKT-RAF2B-${STAMP}`, idempotencyKey: `raf2b:${STAMP}` }, tok);
  const d2b = await dur(P2);
  check('RAF-05', 'omitted amount after a partial refunded the REMAINING 500, not the original 800',
    Number((r2b.data.refundAmount ?? -1)) === 500 && Number(d2b.r) === 800 && d2b.status === 'REFUNDED',
    { reported: r2b.data.refundAmount, durable_refunded: d2b.r, durable_status: d2b.status });

  // ---------- refusals must move nothing ----------
  const P3 = await pay(`pay_raf3_${STAMP}`, 500);
  const over = await api('POST', '/api/admin/finance/refund',
    { paymentId: P3, amount: 600, reason: 'RAF over', ticketId: `TKT-RAF3-${STAMP}`, idempotencyKey: `raf3:${STAMP}` }, tok);
  const d3 = await dur(P3);
  check('RAF-06', 'a request above the refundable balance is refused with the canonical code',
    over.status === 400 && over.data.code === 'EXCEEDS_REFUNDABLE_BALANCE',
    { status: over.status, code: over.data.code });
  check('RAF-07', 'the refusal moved nothing: payment still CAPTURED with 0 refunded',
    Number(d3.r) === 0 && d3.status === 'CAPTURED', { refunded: d3.r, status: d3.status });

  const again = await api('POST', '/api/admin/finance/refund',
    { paymentId: P1, reason: 'RAF double', ticketId: `TKT-RAF1D-${STAMP}`, idempotencyKey: `raf1d:${STAMP}` }, tok);
  check('RAF-08', 'a second refund of an already-refunded payment is refused, not silently zero-sized',
    again.status === 400 && again.data.code === 'ALREADY_FULLY_REFUNDED',
    { status: again.status, code: again.data.code });

  // ---------- identity: replay, and the canonical conflict classification ----------
  const P4 = await pay(`pay_raf4_${STAMP}`, 400);
  const key4 = `raf4:${STAMP}`;
  const r4a = await api('POST', '/api/admin/finance/refund',
    { paymentId: P4, amount: 150, reason: 'RAF replay', ticketId: `TKT-RAF4-${STAMP}`, idempotencyKey: key4 }, tok);
  const r4b = await api('POST', '/api/admin/finance/refund',
    { paymentId: P4, amount: 150, reason: 'RAF replay', ticketId: `TKT-RAF4-${STAMP}`, idempotencyKey: key4 }, tok);
  const d4 = await dur(P4);
  const auth4 = await one('SELECT count(*)::text n FROM payment_refund_authorizations WHERE idempotency_key=$1', [key4]);
  check('RAF-09', 'replaying the same key and semantics is idempotent: one authorization, 150 refunded',
    Number(d4.r) === 150 && Number(auth4.n) === 1 && r4a.status === 200,
    { refunded: d4.r, authRows: auth4.n, first: r4a.status, second: r4b.status });

  const P5 = await pay(`pay_raf5_${STAMP}`, 900);
  const key5 = `raf5:${STAMP}`;
  await api('POST', '/api/admin/finance/refund',
    { paymentId: P5, amount: 200, reason: 'RAF conflict', ticketId: `TKT-RAF5-${STAMP}`, idempotencyKey: key5 }, tok);
  const clash = await api('POST', '/api/admin/finance/refund',
    { paymentId: P5, amount: 300, reason: 'RAF conflict, different', ticketId: `TKT-RAF5-${STAMP}`, idempotencyKey: key5 }, tok);
  const d5 = await dur(P5);
  check('RAF-10', 'same key with different semantics is classified IDEMPOTENCY_CONFLICT',
    clash.data.code === 'IDEMPOTENCY_CONFLICT', { status: clash.status, code: clash.data.code });
  check('RAF-11', 'that conflict is answered 409, the classification this route already uses',
    clash.status === 409, { status: clash.status });
  check('RAF-12', 'and it moved nothing beyond the original 200', Number(d5.r) === 200,
    { durable_refunded: d5.r });

  // ---------- financial trail: only the intended movements exist ----------
  const end = await one(`SELECT (SELECT count(*) FROM payment_refund_authorizations)::text auth,
      (SELECT count(*) FROM ledger_entries)::text le`);
  const dAuth = Number(end.auth) - Number(start.auth);
  const dLe = Number(end.le) - Number(start.le);
  console.log(`  deltas: authorizations=+${dAuth} ledger_entries=+${dLe}`);
  // Booked refunds this run: P1 full, P2 partial, P2 remainder, P4 replayed-once, P5 first.
  // Refused (P3 over, P1 again, P5 clash) and the P4 replay must add nothing.
  check('RAF-13', 'exactly the five booked refunds were authorized, no more',
    dAuth === 5, { authorizationsAdded: dAuth });
  check('RAF-14', 'each booked refund produced its durable double-entry reversal, and refusals produced none',
    dLe === 5, { ledgerEntriesAdded: dLe });

  // cleanup: refunds are durable history, so the payments stay; report what is pinned
  const mine = await one(`SELECT count(*)::text total,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM payment_refund_authorizations a
                                       WHERE a.payment_id = p.payment_id))::text with_history
      FROM payments p WHERE p.payment_id LIKE $1`, [`%${STAMP}%`]);
  console.log(`  probe payments created: ${mine.total}, carrying refund history: ${mine.with_history}`);
  console.log('  refund-bearing payments are RETAINED: they are append-only financial history');
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== REFUND AMOUNT AUTHORITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
