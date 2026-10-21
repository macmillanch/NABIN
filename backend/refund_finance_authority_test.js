/*
 * P7 — DISPUTE REFUND FINANCE AUTHORITY: who is allowed to move a customer's wallet, read out of
 * PostgreSQL.
 *
 * The defect this suite pins is an authority asymmetry inside one function.
 * `SupportTicketRepository.resolveTicket()` has two money legs. The LOST_ITEM bounty leg was made a
 * finance act in P6: `support.resolve` is not enough, `finance.adjust` is required, and a role that
 * lacks it is refused (`BOUNTY_FINANCE_AUTHORITY_REQUIRED`). The STEP 1 customer-wallet refund leg
 * directly above it is the same kind of act — it credits `CUSTOMER_WALLET_LIABILITY` from
 * `DISPUTE_REFUND_EXPENSE` through the durable ledger — and it still answers to `support.resolve`
 * alone. `POST /api/admin/support/:id/resolve` (server.js) is gated only by
 * `requirePermission('support.resolve')` and passes `req.body.refundAmount` straight through, and
 * `SUPPORT_AGENT_GRANTS` (adminPermissions.js) holds `support.resolve` with no finance grant. So a
 * support agent, a role that may not post a single rupee through /api/admin/finance/refund or
 * /api/admin/finance/adjustments, can move an unlimited amount into a wallet by resolving a dispute.
 *
 * Everything is asserted against durable state: `users.wallet_balance`, `journal_transactions` /
 * `journal_lines`, `support_tickets.status` and `audit_logs`. Response bodies are not the evidence,
 * because a 200 is exactly what the unfixed code answers while it books the posting. The global
 * `journal_transactions` count is read before and after every refused attempt, so a refusal that
 * quietly booked a posting cannot pass.
 *
 * Fixtures are minted by THIS run (RFA-prefixed customer/tickets). No driver is involved, so this
 * suite moves no driver money. Cleanup is scoped to those prefixes with rowCount evidence, and
 * append-only financial rows are retained rather than deleted — the keep rule the ledger suites
 * already apply. Local Docker only: the target guard below refuses a non-local database, and a
 * mirror target cannot prove durability, so the suite exits 1 rather than pretending.
 *
 * The suite takes its store from `scripts/chain_target_guard`, never from an address typed into this
 * file, which is what makes it runnable in the disposable `chain_scratch` lane: an isolated link is
 * handed a `DATABASE_URL` whose `search_path` is the clone and a `SUPABASE_URL` for the throwaway
 * PostgREST in front of it, and a suite that ignored those would write `public` while the run labelled
 * it isolated. Same reason as #283 for the money suites.
 */

const path = require('path');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: money moves through the in-process repository (the supabaseAdmin handle) and every assertion
// reads through this suite's own pg handle, so BOTH must resolve to one declared loopback store.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'refund_finance_authority_test' });
const PG = PG_TARGET.connectionString;
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !LOOPBACK.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('RFA REFUSED: SUPABASE_URL points to a non-loopback host ('
    + new URL(process.env.SUPABASE_URL).hostname + `) while the assertion handle reads `
    + `${PG_TARGET.host}. That is the split-target class (#283): the refund would be booked in one store `
    + 'and asserted in another. Run through scripts/with_local_target.js.');
  process.exit(1);
}

const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'SupportTicketRepository.js');
const PERM_FILE = path.join(__dirname, 'src', 'adminPermissions.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');
const STAMP = Date.now();
const REFUND = 150;

const results = [];
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}

(async () => {
  const fs = require('fs');
  check('RFA-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin,
    { isLivePostgres, declaredBy: PG_TARGET.source, host: PG_TARGET.host, database: PG_TARGET.database });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log(`\n=== RFA REFUND FINANCE AUTHORITY TEST: 0/${results.length || 1} passed, 1 failed ===`);
    process.exitCode = 1;
    return;
  }

  const db = require('./src/database');
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  // Which store this run actually reached, printed before the first write and with the credential
  // withheld. In an isolated link the expected schema is `chain_scratch`; a run that silently resolved
  // to `public` while the chain believed it was on the clone is the failure this line makes visible.
  const WHERE = await one('SELECT current_schema() AS schema, inet_server_addr()::text AS server, '
    + 'inet_server_port() AS port');
  console.log(`TARGET: declared by ${PG_TARGET.source} -> ${PG_TARGET.host}:${PG_TARGET.port}/`
    + `${PG_TARGET.database}, assertion handle searches schema "${WHERE.schema}"`
    + `, write handle is SUPABASE_URL `
    + `${process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : '(unset)'}`);
  const owned = { tickets: [] };
  let attacker = null, winner = null, bystander = null;

  async function mkUser(label) {
    const { data, error } = await supabaseAdmin.from('users').insert({
      phone: `85${String(STAMP).slice(-8)}${label}`, name: `RFA ${label} customer ${STAMP}`,
      wallet_balance: 0
    }).select('id').single();
    if (error) throw new Error(`user insert ${label}: ${error.message}`);
    return data.id;
  }

  async function mkTicket(label, userId) {
    const number = `TCK-RFA-${label}-${STAMP}`;
    const { data, error } = await supabaseAdmin.from('support_tickets').insert({
      ticket_number: number,
      user_type: 'CUSTOMER',
      user_id: userId,
      subject: `RFA ${label} fixture`,
      description: 'Created by refund_finance_authority_test; owned by this run; removed in teardown.',
      status: 'OPEN', priority: 'LOW', category: 'FARE_DISPUTE', job_id: null,
      messages: [{ senderRole: 'CUSTOMER', senderName: 'RFA fixture', text: `RFA ${label} fixture message`,
        metadata: { jobId: null, driverId: null } }]
    }).select('id, ticket_number').single();
    if (error) throw new Error(`ticket insert ${label}: ${error.message}`);
    owned.tickets.push(data.id);
    return data;
  }

  const walletOf = async (id) => {
    const r = await one('SELECT wallet_balance::text b FROM users WHERE id=$1::uuid', [id]);
    return r ? Number(r.b) : null;
  };
  const moneyOf = async (id) => one(
    'SELECT (SELECT count(*) FROM journal_transactions) txn,'
    + ' (SELECT count(*) FROM journal_lines WHERE entity_id=$1::text) lines', [id]);
  const statusOf = async (id) => (await one('SELECT status FROM support_tickets WHERE id=$1::uuid', [id])).status;
  const resolvedAuditOf = async (number) => Number((await one(
    "SELECT count(*) n FROM audit_logs WHERE action='TICKET_RESOLVED' AND target_entity_id LIKE $1",
    [`%${number}%`])).n);
  const journalTotal = async () => Number((await one('SELECT count(*) n FROM journal_transactions')).n);

  const ADMIN = 'rfa-suite-admin'; // not a uuid: assigned_admin_id is only written for one
  const withRefund = (amount) => ({ resolutionNotes: `RFA resolve ${STAMP}`, refundAmount: amount,
    specializedData: { resolutionType: 'FARE_DISPUTE_RESOLVED' } });
  const noRefund = () => ({ resolutionNotes: `RFA no-money resolve ${STAMP}`, refundAmount: 0,
    specializedData: { resolutionType: 'FARE_DISPUTE_RESOLVED' } });
  const attempt = async (fn) => {
    try { return { ok: true, r: await fn() }; }
    catch (e) { return { ok: false, code: e.code, status: e.statusCode || e.status, msg: (e.message || '').slice(0, 110) }; }
  };

  try {
    attacker = await mkUser('atk');
    winner = await mkUser('win');
    bystander = await mkUser('byst');
    const ready = [attacker, winner, bystander].every(Boolean)
      && (await walletOf(attacker)) === 0 && (await walletOf(winner)) === 0 && (await walletOf(bystander)) === 0;
    check('RFA-01', 'three zero-balance fixture customers were minted', ready, { attacker, winner, bystander });
    if (!ready) throw new Error('fixture provisioning failed; refusing to assert against absent rows');

    // The split-target guard (#283) as a measurement rather than a comment: the rows the write handle
    // (supabaseAdmin -> repository -> RPC) inserted have to be found by the read handle (this pg client).
    // If the two resolved to different stores or schemas, this is 0 and every durable assertion below
    // would be about a store the refund never touched.
    const seen = Number((await one('SELECT count(*) n FROM users WHERE id = ANY($1::uuid[])',
      [[attacker, winner, bystander]])).n);
    check('RFA-01b', 'the write handle and the assertion handle are the same store and schema',
      seen === 3, { seen, schema: WHERE.schema, server: `${WHERE.server}:${WHERE.port}` });

    // ===================================== 1. the low-privilege role attempts a refund
    const tAgent = await mkTicket('AGENT', attacker);
    const w0 = await walletOf(attacker);
    const g0 = await journalTotal();
    const m0 = await moneyOf(attacker);
    const out1 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tAgent.ticket_number, withRefund(REFUND), ADMIN, 'RFA Suite', 'SUPPORT_AGENT'));
    const w1 = await walletOf(attacker);
    const g1 = await journalTotal();
    const m1 = await moneyOf(attacker);

    check('RFA-02', 'a refund booked by a support.resolve-only role is refused',
      out1.ok === false, out1.ok ? { success: out1.r && out1.r.success, status: out1.r && out1.r.ticket && out1.r.ticket.status }
        : { code: out1.code, status: out1.status });
    check('RFA-03', 'the refusal is a 403 naming the missing finance authority',
      out1.ok === false && out1.status === 403 && /FINANCE_AUTHORITY_REQUIRED/.test(String(out1.code)),
      { code: out1.code, status: out1.status });
    check(`RFA-04`, `the customer's durable wallet did not move by ${REFUND}`,
      near(w1, w0), { before: w0, after: w1 });
    check('RFA-05', 'no journal lines were booked for that customer',
      Number(m1.lines) === Number(m0.lines), { lines: m1.lines });
    check('RFA-06', 'the refused request booked no posting anywhere in the global journal',
      g1 === g0, { before: g0, after: g1 });
    check('RFA-07', 'the refused ticket was never marked RESOLVED and no resolution audit exists',
      (await statusOf(tAgent.id)) !== 'RESOLVED' && (await resolvedAuditOf(tAgent.ticket_number)) === 0,
      { status: await statusOf(tAgent.id) });

    // ============================ 2. the gate is not over-broad: no money, no finance needed
    const tZero = await mkTicket('ZERO', bystander);
    const g2 = await journalTotal();
    const out2 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tZero.ticket_number, noRefund(), ADMIN, 'RFA Suite', 'SUPPORT_AGENT'));
    check('RFA-08', 'a moneyless resolution by the same role still succeeds (gate is not over-broad)',
      out2.ok === true && out2.r && out2.r.success === true && (await statusOf(tZero.id)) === 'RESOLVED',
      out2.ok ? { success: out2.r.success, status: await statusOf(tZero.id) }
        : { code: out2.code, status: out2.status, msg: out2.msg });
    check('RFA-09', 'and that moneyless resolution booked no posting',
      (await journalTotal()) === g2 && (await walletOf(bystander)) === 0,
      { wallet: await walletOf(bystander) });

    // ========================= 3. other non-finance roles are refused the same way
    const tOps = await mkTicket('OPS', attacker);
    const g3 = await journalTotal();
    const out3 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tOps.ticket_number, withRefund(REFUND), ADMIN, 'RFA Suite', 'OPERATIONS'));
    check('RFA-10', 'OPERATIONS (support.respond but no finance grant) cannot book the refund either',
      out3.ok === false && out3.status === 403, { code: out3.code, status: out3.status });
    check('RFA-11', 'and that refusal booked nothing globally', (await journalTotal()) === g3,
      { before: g3, after: await journalTotal() });

    const tBogus = await mkTicket('BOGUS', attacker);
    const g4 = await journalTotal();
    const out4 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tBogus.ticket_number, withRefund(REFUND), ADMIN, 'RFA Suite', 'NOT_A_REAL_ROLE'));
    check('RFA-12', 'an unrecognised role fails closed on a refund instead of inheriting a grant',
      out4.ok === false && out4.status === 403, { code: out4.code, status: out4.status });
    check('RFA-13', 'and the unrecognised-role refusal booked nothing globally',
      (await journalTotal()) === g4, { before: g4, after: await journalTotal() });

    // ============================ 4. the legitimate finance-authority workflow still pays
    const tFin = await mkTicket('FIN', winner);
    const l0 = await moneyOf(winner);
    const wB0 = await walletOf(winner);
    const out5 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tFin.ticket_number, withRefund(REFUND), ADMIN, 'RFA Suite', 'FINANCE_AUDITOR'));
    const wB1 = await walletOf(winner);
    const l1 = await moneyOf(winner);
    check('RFA-14', 'a role that holds finance.refund still resolves with the refund',
      out5.ok === true && out5.r && out5.r.success === true,
      out5.ok ? { success: out5.r.success } : { code: out5.code, status: out5.status, msg: out5.msg });
    check(`RFA-15`, `that customer's wallet moved exactly +${REFUND}, once`,
      near(Number(wB1) - Number(wB0), REFUND), { before: wB0, after: wB1 });
    check('RFA-16', 'exactly one journal transaction and two lines were booked',
      Number(l1.txn) - Number(l0.txn) === 1 && Number(l1.lines) - Number(l0.lines) === 2,
      { txn_delta: Number(l1.txn) - Number(l0.txn), line_delta: Number(l1.lines) - Number(l0.lines) });
    check('RFA-17', 'the legitimate ticket is durably RESOLVED with its audit record',
      (await statusOf(tFin.id)) === 'RESOLVED' && (await resolvedAuditOf(tFin.ticket_number)) >= 1,
      { status: await statusOf(tFin.id) });

    // ============================================= 5. replay cannot pay twice
    const l2 = await moneyOf(winner);
    const out6 = await attempt(() => db.supportTicketRepo.resolveTicket(
      tFin.ticket_number, withRefund(REFUND), ADMIN, 'RFA Suite', 'FINANCE_AUDITOR'));
    const l3 = await moneyOf(winner);
    check('RFA-18', 'a replayed claim on the resolved ticket is refused',
      out6.ok === false && out6.status === 400, { code: out6.code, status: out6.status });
    check('RFA-19', 'and the replay moved no money and booked nothing',
      near(await walletOf(winner), wB1) && Number(l3.txn) === Number(l2.txn)
        && Number(l3.lines) === Number(l2.lines),
      { wallet: await walletOf(winner), txn: l3.txn, lines: l3.lines });

    // ================================ 6. the policy is the one the routes already use
    const permSrc = fs.readFileSync(PERM_FILE, 'utf8');
    const supportAgentLine = permSrc.match(/const SUPPORT_AGENT_GRANTS = Object\.freeze\(\[([^\]]*)\]/);
    check('RFA-20', 'SUPPORT_AGENT really does hold support.resolve and no finance grant',
      !!supportAgentLine && /'support\.resolve'/.test(supportAgentLine[1])
        && !/finance\./.test(supportAgentLine[1]),
      { grants: supportAgentLine ? supportAgentLine[1].replace(/\s+/g, ' ').trim().slice(0, 180) : null });

    const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
    const routeLine = serverSrc.match(/app\.post\('\/api\/admin\/support\/:id\/resolve'([^\n]*)/);
    check('RFA-21', 'the route that reaches this leg is gated by support.resolve alone (the entry point is real)',
      !!routeLine && /requirePermission\('support\.resolve'\)/.test(routeLine[1])
        && !/finance\./.test(routeLine[1]),
      { route: routeLine ? routeLine[1].trim().slice(0, 140) : null });

    const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
    const from = repoSrc.indexOf('// STEP 1: Process Customer Wallet Refund');
    const to = repoSrc.indexOf('// STEP 2: Category-Specific Actions');
    const window = from >= 0 && to > from ? repoSrc.slice(from, to) : '';
    check('RFA-22', 'the refund window is readable in the source (the pin is not vacuous)',
      window.length > 300, { chars: window.length });
    check('RFA-23', 'the refund leg consults the real grant list before moving money',
      /grantsForRole/.test(window) && /finance\.refund/.test(window), { hit: /grantsForRole/.test(window) });
    check('RFA-24', 'the refusal was not deleted to make this suite pass',
      /FINANCE_AUTHORITY_REQUIRED/.test(window));
    check('RFA-25', "the bounty leg's existing P6 gate is untouched by this change",
      /BOUNTY_FINANCE_AUTHORITY_REQUIRED/.test(repoSrc) && /'finance\.adjust'/.test(repoSrc));
  } finally {
    for (const id of owned.tickets) {
      const r = await c.query('DELETE FROM support_tickets WHERE id=$1::uuid', [id]).catch(() => null);
      console.log(`  ticket ${id}: DELETE rowCount=${r ? r.rowCount : 'error'}`);
    }
    const sweep = [];
    for (const u of [attacker, winner, bystander].filter(Boolean)) {
      // A customer whose wallet was actually refunded is pinned by append-only journal money: the
      // account stays, because deleting it would strand the posting that names it.
      const hist = await one('SELECT count(*) n FROM journal_lines WHERE entity_id=$1::text', [u]);
      if (Number(hist.n) > 0) { sweep.push(`user ${u.slice(0, 8)} RETAINED (financial lines=${hist.n})`); continue; }
      try { const r = await c.query('DELETE FROM users WHERE id=$1::uuid', [u]); sweep.push(`user deleted=${r.rowCount}`); }
      catch (e) { sweep.push(`user ${u.slice(0, 8)} RETAINED (${e.message.split('\n')[0].slice(0, 52)})`); }
    }
    console.log('  cleanup -> ' + sweep.join(' | '));
    const leftovers = await one(`SELECT
        (SELECT count(*) FROM support_tickets WHERE ticket_number LIKE 'TCK-RFA-%') tickets,
        (SELECT count(*) FROM journal_transactions WHERE idempotency_key LIKE 'dispute_refund_%'
           AND id IN (SELECT journal_id FROM journal_lines WHERE entity_id IN
             (SELECT id::text FROM users WHERE name LIKE 'RFA % customer ${STAMP}'))) refund_postings`);
    console.log(`  RFA residue after cleanup: ${JSON.stringify(leftovers)}`);
    await c.end();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== RFA REFUND FINANCE AUTHORITY TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => {
  console.error('FATAL', e.message);
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== RFA REFUND FINANCE AUTHORITY TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length + 1} failed ===`);
  process.exitCode = 1;
});
