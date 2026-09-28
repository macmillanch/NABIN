/*
 * E3 — support-bounty atomicity: what is durably true after every boundary, not what HTTP said.
 *
 * Verified call graph (POST /api/admin/support/:id/resolve -> supportTicketRepo.resolveTicket),
 * each step its OWN PostgreSQL transaction — there is no transaction spanning ticket state and
 * money:
 *   1 SELECT ticket            2 guard: RESOLVED -> 400
 *   3 UPDATE status=IN_PROGRESS (claim, .neq('RESOLVED'))
 *   4 refund   -> adjust_wallet_atomic            (money txn)
 *   5 bounty   -> updateEarnings -> adjust_wallet_atomic (money txn)
 *   6 sanction -> driverRepo.update
 *   7 UPDATE status=RESOLVED + messages + resolved_at   <- the divergence window
 *   8 auditAppliedChange
 *
 * So the questions this test answers with durable reads: can a bounty be paid while the ticket
 * claims nothing, can a ticket claim payment while nothing was booked, and does a retry after the
 * step-7 failure converge or post money twice.
 *
 * Failure injection is test-process-only monkey-patching of instance collaborators (and of the
 * supabase client builder for step 7), always restored in finally. No production seam, no backdoor,
 * no schema change. Local/test only.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('E3 REFUSED: non-loopback database'); process.exit(1);
}
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');

const STAMP = Date.now();
const BOUNTY = 150;
const results = [];
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 190)}` : ''));
}

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('SKIP: needs live PostgreSQL'); process.exit(1); }
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  const driver = (await supabaseAdmin.from('drivers').insert({
    phone: `89${String(STAMP).slice(-8)}`, name: `E3 bounty probe ${STAMP}`, vehicle_type: 'AUTO',
    vehicle_number: `E3${String(STAMP).slice(-4)}`, operational_status: 'AVAILABLE', wallet_balance: 0
  }).select('id').single()).data;
  const customer = (await supabaseAdmin.from('users').insert({
    phone: `88${String(STAMP).slice(-8)}`, name: `E3 bounty customer ${STAMP}`, wallet_balance: 0
  }).select('id').single()).data;
  const job = (await supabaseAdmin.from('jobs').insert({
    job_number: `JOB-E3-${STAMP}`, service_type: 'RIDE', status: 'COMPLETED',
    customer_id: customer.id, driver_id: driver.id,
    pickup_address: 'E3 a', drop_address: 'E3 b',
    fare_subtotal: 100, final_total: 100, driver_earnings: 89, platform_commission: 11,
    payment_method: 'WALLET', payment_status: 'SUCCESS'
  }).select('id').single()).data;

  const adminIds = new Set();
  const mkTicket = async (label) => (await supabaseAdmin.from('support_tickets').insert({
    ticket_number: `TCK-E3-${label}-${STAMP}`, user_type: 'CUSTOMER', user_id: customer.id,
    subject: `E3 ${label} probe`, description: 'temporary experiment fixture',
    category: 'LOST_ITEM', status: 'OPEN', priority: 'LOW', job_id: job.id
  }).select('id, ticket_number').single()).data;

  const resolve = (t, bounty) => db.supportTicketRepo.resolveTicket(t.ticket_number, {
    resolutionNotes: `E3 ${t.ticket_number}`, refundAmount: 0,
    specializedData: { retrievalStatus: 'RETURNED_TO_CUSTOMER', returnMethod: 'DIRECT_DRIVER_DROP',
      handoverOtpVerified: true, driverBounty: bounty }
  }, 'e3-admin', 'E3 probe admin', 'SUPER_ADMIN');
  const attempt = async (fn) => { try { return { ok: true, r: await fn() }; } catch (e) { return { ok: false, code: e.code, status: e.status || e.statusCode, msg: (e.message || '').slice(0, 90) }; } };

  const snap = async () => one(`SELECT
      (SELECT wallet_balance::text FROM drivers WHERE id=$1::uuid) wallet,
      (SELECT count(*) FROM journal_transactions t
        WHERE EXISTS (SELECT 1 FROM journal_lines l WHERE l.journal_id=t.id AND l.entity_id = $1::text)) txn,
      (SELECT count(*) FROM journal_lines WHERE entity_id = $1::text) lines,
      (SELECT count(*) FROM journal_transactions) jt_all,
      (SELECT count(*) FROM driver_payouts WHERE driver_id=$1::uuid) payouts,
      (SELECT count(*) FROM admin_accounts) admins`, [driver.id]);
  const statusOf = async (t) => (await one('SELECT status FROM support_tickets WHERE id=$1::uuid', [t.id])).status;
  const auditCount = async (t) => Number((await one(
    "SELECT count(*) n FROM audit_logs WHERE action = 'TICKET_RESOLVED' AND target_entity_id LIKE $1",
    [`%${t.ticket_number}%`])).n);

  // ================= 1. NORMAL SUCCESS =================
  console.log('=== 1. normal success: one posting, one transition ===');
  const t1 = await mkTicket('ok');
  const b0 = await snap();
  const r1 = await attempt(() => resolve(t1, BOUNTY));
  const a1 = await snap();
  check('E3-01', 'the request succeeded', r1.ok && r1.r && r1.r.success === true,
    r1.ok ? { success: r1.r.success } : { code: r1.code, msg: r1.msg });
  check('E3-02', `durable driver wallet moved exactly +${BOUNTY}, once`,
    near(Number(a1.wallet) - Number(b0.wallet), BOUNTY), { before: b0.wallet, after: a1.wallet });
  check('E3-03', 'exactly one journal transaction and two lines for this driver',
    Number(a1.txn) - Number(b0.txn) === 1 && Number(a1.lines) - Number(b0.lines) === 2,
    { txn_delta: Number(a1.txn) - Number(b0.txn), line_delta: Number(a1.lines) - Number(b0.lines) });
  const bal = await one(`SELECT count(*) n FROM (
      SELECT l.journal_id FROM journal_lines l
        JOIN journal_transactions t ON t.id = l.journal_id
       WHERE t.idempotency_key = $1 GROUP BY l.journal_id, t.total_credit, t.total_debit
        HAVING t.total_credit <> t.total_debit) x`, [`SUPPORT_BOUNTY:${t1.id}:DRIVER_EARNINGS`]);
  check('E3-04', 'the bounty journal transaction is balanced (credit = debit)', Number(bal.n) === 0, { unbalanced: bal.n });
  check('E3-05', 'the ticket is durably RESOLVED', (await statusOf(t1)) === 'RESOLVED', { status: await statusOf(t1) });
  check('E3-06', 'and the privileged audit record exists', (await auditCount(t1)) >= 1, { audit: await auditCount(t1) });

  // ================= 2. CONCURRENT DUPLICATE (same ticket, same bounty) =================
  console.log('\n=== 2. two concurrent resolves of one ticket ===');
  const t2 = await mkTicket('conc');
  const c0 = await snap();
  const pair = await Promise.all([attempt(() => resolve(t2, BOUNTY)), attempt(() => resolve(t2, BOUNTY))]);
  const c1 = await snap();
  const booked = pair.filter(p => p.ok && p.r && p.r.success).length;
  check('E3-07', 'exactly one bounty posting across the race',
    near(Number(c1.wallet) - Number(c0.wallet), BOUNTY) && Number(c1.txn) - Number(c0.txn) === 1,
    { wallet_delta: Number(c1.wallet) - Number(c0.wallet), txn_delta: Number(c1.txn) - Number(c0.txn), successes: booked });
  check('E3-08', 'no second journal line pair appeared', Number(c1.lines) - Number(c0.lines) === 2,
    { line_delta: Number(c1.lines) - Number(c0.lines) });
  check('E3-09', 'the ticket reached RESOLVED exactly once and never twice-paid',
    (await statusOf(t2)) === 'RESOLVED', { status: await statusOf(t2), outcomes: pair.map(p => (p.ok ? 'ok' : p.code)) });

  // ================= 3. LOST RESPONSE -> RETRY =================
  console.log('\n=== 3. retry after the response was lost ===');
  const d0 = await snap();
  const retry = await attempt(() => resolve(t1, BOUNTY));
  const d1 = await snap();
  check('E3-10', 'a retry after success is refused, not re-paid',
    retry.ok === false && retry.status === 400, { code: retry.code, status: retry.status, msg: retry.msg });
  check('E3-11', 'and it moved no money and booked nothing',
    Number(d1.wallet) === Number(d0.wallet) && Number(d1.txn) === Number(d0.txn),
    { wallet: d1.wallet, txn_delta: Number(d1.txn) - Number(d0.txn) });
  check('E3-12', 'the ticket is still RESOLVED (state is visible, not reverted)',
    (await statusOf(t1)) === 'RESOLVED');

  // ================= 4. DRIVER RESOLUTION FAILURE (typed) =================
  console.log('\n=== 4. driver earnings path fails with a typed error ===');
  const t4 = await mkTicket('drvfail');
  const e0 = await snap();
  const realUE = db.driverRepo.updateEarnings;
  let out4;
  try {
    db.driverRepo.updateEarnings = async () => {
      const e = new Error('E3 injected: driver not resolvable for earnings');
      e.code = 'DRIVER_NOT_FOUND'; e.status = 404; throw e;
    };
    out4 = await attempt(() => resolve(t4, BOUNTY));
  } finally { db.driverRepo.updateEarnings = realUE; }
  const e1 = await snap();
  check('E3-13', 'the failure propagates typed rather than becoming a success',
    out4.ok === false && out4.code === 'DRIVER_NOT_FOUND', { code: out4.code, status: out4.status });
  check('E3-14', 'no money moved and nothing was booked',
    Number(e1.wallet) === Number(e0.wallet) && Number(e1.txn) === Number(e0.txn), { wallet: e1.wallet });
  check('E3-15', 'the ticket did NOT claim resolution (it is left claimable)',
    (await statusOf(t4)) !== 'RESOLVED', { status: await statusOf(t4) });

  // ================= 4b. THE HISTORICAL SILENT NO-OP (returns nothing) =================
  console.log('\n=== 4b. earnings helper returns null (the Phase 32 cache-miss shape) ===');
  const t4b = await mkTicket('nullret');
  const n0 = await snap();
  let out4b;
  try {
    db.driverRepo.updateEarnings = async () => null;
    out4b = await attempt(() => resolve(t4b, BOUNTY));
  } finally { db.driverRepo.updateEarnings = realUE; }
  const n1 = await snap();
  check('E3-16', 'a null money result is refused as BOUNTY_NOT_BOOKED, not accepted',
    out4b.ok === false && out4b.code === 'BOUNTY_NOT_BOOKED', { code: out4b.code, status: out4b.status });
  check('E3-17', 'zero movement, zero bookings, no false resolution',
    Number(n1.wallet) === Number(n0.wallet) && Number(n1.txn) === Number(n0.txn)
      && (await statusOf(t4b)) !== 'RESOLVED', { status: await statusOf(t4b) });

  // ================= 5. WALLET / JOURNAL FAILURE =================
  console.log('\n=== 5. the financial operation itself fails ===');
  const t5 = await mkTicket('walletfail');
  const w0 = await snap();
  const realAW = db.ledgerRepo.adjustWallet;
  let out5;
  try {
    db.ledgerRepo.adjustWallet = async () => {
      const e = new Error('E3 injected: adjust_wallet_atomic unavailable');
      e.code = 'AUTH_STORE_UNAVAILABLE'; e.status = 503; throw e;
    };
    out5 = await attempt(() => resolve(t5, BOUNTY));
  } finally { db.ledgerRepo.adjustWallet = realAW; }
  const w1 = await snap();
  check('E3-18', 'a failed financial operation surfaces as a typed failure',
    out5.ok === false && out5.code === 'AUTH_STORE_UNAVAILABLE', { code: out5.code, status: out5.status });
  check('E3-19', 'no partial posting, and the ticket does not claim payment',
    Number(w1.wallet) === Number(w0.wallet) && Number(w1.jt_all) === Number(w0.jt_all)
      && (await statusOf(t5)) !== 'RESOLVED', { status: await statusOf(t5) });

  // ================= 6. MONEY BOOKED, TICKET UPDATE FAILS (the critical window) =================
  console.log('\n=== 6. money commits, then the RESOLVED update fails ===');
  const t6 = await mkTicket('split');
  const s0 = await snap();
  const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
  let armed = true;
  let out6;
  try {
    supabaseAdmin.from = (table) => {
      const b = realFrom(table);
      if (table !== 'support_tickets' || !armed) return b;
      const wrapper = new Proxy(b, { get(t, k) {
        if (k === 'update') {
          return (payload) => {
            if (payload && payload.status === 'RESOLVED') {
              armed = false;
              // A plain chainable whose TERMINAL call returns the rejected promise. Returning a
              // thenable from .update() itself made `await` resolve too early and produced a second,
              // unhandled rejection that crashed the process instead of surfacing at line 924.
              const err = new Error('E3 injected: ticket state write failed after the money committed');
              const fake = {};
              fake.eq = () => fake; fake.select = () => fake; fake.neq = () => fake;
              fake.single = () => Promise.reject(err);
              fake.maybeSingle = () => Promise.reject(err);
              return fake;
            }
            return t.update(payload);
          };
        }
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      } });
      return wrapper;
    };
    out6 = await attempt(() => resolve(t6, BOUNTY));
  } finally { supabaseAdmin.from = realFrom; }
  const s1 = await snap();
  const st6 = await statusOf(t6);
  const moneyBooked = Number(s1.wallet) - Number(s0.wallet) === BOUNTY && Number(s1.txn) - Number(s0.txn) === 1;
  console.log(`  observed: outcome=${out6.ok ? 'success' : out6.code} wallet_delta=${Number(s1.wallet) - Number(s0.wallet)} txn_delta=${Number(s1.txn) - Number(s0.txn)} ticket_status=${st6}`);
  check('E3-20', 'THE DIVERGENCE IS REAL: money durable while ticket is not RESOLVED',
    moneyBooked && st6 !== 'RESOLVED', { wallet_delta: Number(s1.wallet) - Number(s0.wallet), txn_delta: Number(s1.txn) - Number(s0.txn), status: st6 });
  check('E3-21', 'the response did not claim a resolved ticket',
    out6.ok === false || !(out6.r && out6.r.success && out6.r.ticket && out6.r.ticket.status === 'RESOLVED'),
    { ok: out6.ok, code: out6.code });

  // ================= 7. RETRY AFTER THAT DIVERGENCE =================
  console.log('\n=== 7. operator retries the same bounty ===');
  const s2 = await snap();
  const out7 = await attempt(() => resolve(t6, BOUNTY));
  const s3 = await snap();
  check('E3-22', 'the retry completed the ticket state',
    out7.ok === true && (await statusOf(t6)) === 'RESOLVED', { ok: out7.ok, code: out7.code, status: await statusOf(t6) });
  check('E3-23', 'and posted NO second movement (retry converges, does not re-pay)',
    Number(s3.wallet) === Number(s2.wallet) && Number(s3.txn) === Number(s2.txn),
    { wallet_delta: Number(s3.wallet) - Number(s2.wallet), txn_delta: Number(s3.txn) - Number(s2.txn) });
  check('E3-24', 'total money for the ticket across the crash and the retry = one bounty',
    Number(s3.wallet) - Number(s0.wallet) === BOUNTY, { total: Number(s3.wallet) - Number(s0.wallet) });

  // ================= 8. INVALID / NON-POSITIVE BOUNTY =================
  console.log('\n=== 8. zero and negative bounty cannot create money or state ===');
  for (const [label, amount] of [['zero', 0], ['negative', -50], ['garbage', 'abc']]) {
    const t8 = await mkTicket(`amt-${label}`);
    const g0 = await snap();
    const out8 = await attempt(() => resolve(t8, amount));
    const g1 = await snap();
    check(`E3-25-${label}`, `a ${label} bounty cannot move money or book anything`,
      Number(g1.wallet) === Number(g0.wallet) && Number(g1.txn) === Number(g0.txn),
      { ok: out8.ok, code: out8.code, wallet_delta: Number(g1.wallet) - Number(g0.wallet) });
  }

  // ================= 9. AUTHORIZATION =================
  console.log('\n=== 9. a role without finance.adjust cannot pay a bounty ===');
  const t9 = await mkTicket('authz');
  const h0 = await snap();
  const out9 = await attempt(() => db.supportTicketRepo.resolveTicket(t9.ticket_number, {
    resolutionNotes: 'E3 authz probe', refundAmount: 0,
    specializedData: { retrievalStatus: 'RETURNED_TO_CUSTOMER', returnMethod: 'DIRECT_DRIVER_DROP', driverBounty: BOUNTY }
  }, 'e3-support', 'E3 support agent', 'SUPPORT_AGENT'));
  const h1 = await snap();
  check('E3-30', 'resolving without finance authority is refused as BOUNTY_FINANCE_AUTHORITY_REQUIRED',
    out9.ok === false && out9.code === 'BOUNTY_FINANCE_AUTHORITY_REQUIRED', { code: out9.code, status: out9.status });
  check('E3-31', 'and no money moved for an unauthorized bounty',
    Number(h1.wallet) === Number(h0.wallet) && Number(h1.txn) === Number(h0.txn), { wallet: h1.wallet });

  // ================= cleanup (N2 hygiene; financial driver retained) =================
  console.log('\n=== cleanup: rowCount-verified, financial rows retained ===');
  for (const t of [t1, t2, t4, t4b, t5, t6, t9]) {
    const del = await c.query('DELETE FROM support_tickets WHERE id=$1::uuid', [t.id]);
    const gone = await one('SELECT count(*) n FROM support_tickets WHERE id=$1::uuid', [t.id]);
    console.log(`  ticket ${t.ticket_number}: DELETE rowCount=${del.rowCount} post-delete=${gone.n}`);
  }
  const tryDel = async (label, sql, p) => {
    try { const r = await c.query(sql, p); return `${label} rowCount=${r.rowCount}`; }
    // A job paid out by a bounty is pinned by journal_transactions.job_id, so it MUST stay:
    // deleting it would strand append-only money. Refusal here is the guard working, not a bug.
    catch (e) { return `${label} RETAINED (${e.message.split('\n')[0].slice(0, 60)})`; }
  };
  console.log('  ' + await tryDel('job', 'DELETE FROM jobs WHERE id=$1::uuid', [job.id]));
  console.log('  ' + await tryDel('user', 'DELETE FROM users WHERE id=$1::uuid', [customer.id]));
  const hist = await one(`SELECT (
      (SELECT count(*) FROM journal_lines WHERE entity_id=$1::text) +
      (SELECT count(*) FROM driver_payouts WHERE driver_id=$1::uuid)) n`, [driver.id]);
  console.log(`  driver financial rows=${hist.n} (retained when > 0)`);
  // Sweep every E3-owned row, including any left by an earlier aborted run of THIS file. The
  // 'TCK-E3-'/'JOB-E3-'/'E3 ' prefixes are used by no other code, so this deletes only what the
  // suite itself created; money and audit history are never touched.
  const sweep = [];
  for (const [label, sql] of [
    ['tickets', "DELETE FROM support_tickets WHERE ticket_number LIKE 'TCK-E3-%'"],
    ['jobs', "DELETE FROM jobs WHERE job_number LIKE 'JOB-E3-%'"],
    ['users', "DELETE FROM users WHERE name LIKE 'E3 bounty customer %'"]]) {
    try { const r = await c.query(sql); sweep.push(`${label}=${r.rowCount}`); }
    catch (e) { sweep.push(`${label}=retained(FK)`); }
  }
  console.log(`  sweep rowCount -> ${sweep.join(' ')}`);
  const finalAdmins = Number((await one('SELECT count(*) n FROM admin_accounts')).n);
  console.log(`  admin_accounts rows at end=${finalAdmins} (E3 created no admin rows)`);
  const leftovers = await one(`SELECT
      (SELECT count(*) FROM support_tickets WHERE ticket_number LIKE 'TCK-E3-%') tickets,
      (SELECT count(*) FROM jobs WHERE job_number LIKE 'JOB-E3-%') jobs,
      (SELECT count(*) FROM users WHERE name LIKE 'E3 bounty customer %') users,
      (SELECT count(*) FROM drivers WHERE name LIKE 'E3 bounty probe %') drivers_retained`);
  console.log(`  E3 residue after cleanup: ${JSON.stringify(leftovers)}`);
  await c.end();

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== E3 BOUNTY-ATOMICITY SUITE: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
