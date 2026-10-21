/*
 * P6 — LOST_ITEM bounty RECIPIENT ATTRIBUTION: who actually got paid, read out of PostgreSQL.
 *
 * The defect this suite pins is not "is a bounty booked once" (E3 link 8 answers that) — it is WHOSE
 * wallet a bounty lands in. `SupportTicketRepository.resolveTicket()` used a second source for that
 * answer after the ticket's own job came up empty: the first message's driver reference. That
 * reference is written by `createTicket()` from `payload.driverId`, and `POST /api/support/ticket`
 * hands it `req.body` (server.js:2475) behind only `requireSupportCallerAuth` — so any signed-in
 * customer can name any driver, and a ticket with no trip behind it pays platform money to a person
 * the ticket cannot attribute. An already-designed refusal (`BOUNTY_DRIVER_UNRESOLVABLE`, the same
 * shape as the F-7 sanction refusal) is bypassed by that one source.
 *
 * Everything here is asserted against durable state: `drivers.wallet_balance`, `journal_transactions`
 * /`journal_lines`, `driver_payouts`, `support_tickets.status` and `audit_logs` — not response bodies,
 * because a 200 is exactly what the unfixed code answers while it credits the wrong person. The
 * global `journal_transactions` count is read before and after every refused attempt, so a refusal
 * that quietly books a posting cannot pass.
 *
 * Fixtures are minted by THIS run (P6B-prefixed drivers/customer/job/tickets), the attack path runs
 * through the same repository methods the routes call, and cleanup is scoped to those prefixes with
 * rowCount evidence. Append-only money and anything it pins is deliberately retained, never rewritten.
 * Local Docker only: the loopback guard below refuses a non-local database, and a mirror target cannot
 * prove durability, so the suite exits 1 rather than pretending.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('P6B REFUSED: non-loopback database');
  process.exit(1);
}

const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'SupportTicketRepository.js');
const STAMP = Date.now();
const BOUNTY = 250;

const results = [];
const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  check('P6B-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin, { isLivePostgres });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log(`\n=== P6B BOUNTY RECIPIENT ATTRIBUTION: 0/${results.length || 1} passed, 1 failed ===`);
    process.exitCode = 1;
    return;
  }

  const db = require('./src/database');
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // ---------------------------------------------------------------- owned fixtures (this run only)
  const owned = { drivers: [], userId: null, jobId: null, tickets: [] };

  async function mkDriver(label) {
    const { data, error } = await supabaseAdmin.from('drivers').insert({
      phone: `87${String(STAMP).slice(-8)}${label}`, name: `P6B ${label} driver ${STAMP}`,
      vehicle_type: 'AUTO', vehicle_number: `P6B${label}${String(STAMP).slice(-4)}`.slice(0, 16),
      operational_status: 'AVAILABLE', is_online: false, wallet_balance: 0
    }).select('id').single();
    if (error) throw new Error(`driver insert ${label}: ${error.message}`);
    owned.drivers.push(data.id);
    return data.id;
  }

  async function mkUser() {
    const { data, error } = await supabaseAdmin.from('users').insert({
      phone: `86${String(STAMP).slice(-8)}`, name: `P6B bounty customer ${STAMP}`, wallet_balance: 0
    }).select('id').single();
    if (error) throw new Error(`user insert: ${error.message}`);
    owned.userId = data.id;
    return data.id;
  }

  async function mkJob(customerId, driverId) {
    const { data, error } = await supabaseAdmin.from('jobs').insert({
      job_number: `JOB-P6B-${STAMP}`, service_type: 'RIDE', status: 'COMPLETED',
      customer_id: customerId, driver_id: driverId,
      pickup_address: 'P6B fixture pickup', drop_address: 'P6B fixture drop',
      distance_km: 1.0, fare_subtotal: 100, final_total: 100,
      driver_earnings: 85, platform_commission: 15,
      payment_method: 'WALLET', payment_status: 'PAID'
    }).select('id').single();
    if (error) throw new Error(`job insert: ${error.message}`);
    owned.jobId = data.id;
    return data.id;
  }

  // The attack path: the same repository method `POST /api/support/ticket` calls with `req.body`.
  async function openTicket(label, payload) {
    const ticket = await db.supportTicketRepo.createTicket(
      { id: owned.userId, name: 'P6B bounty customer', role: 'CUSTOMER' }, payload);
    owned.tickets.push(ticket.uuid);
    return ticket;
  }

  // The hand-shaped row: used where the ticket must carry a specific first message, the way a
  // customer-typed body leaves it. Only ever touches rows this run inserted.
  async function insertTicket(label, { jobId, metadataDriverId, userId }) {
    const number = `TCK-P6B-${label}-${STAMP}`;
    const { data, error } = await supabaseAdmin.from('support_tickets').insert({
      ticket_number: number,
      user_type: 'CUSTOMER',
      user_id: userId || owned.userId,
      subject: `P6B ${label} fixture`,
      description: 'Created by bounty_recipient_attribution_test; owned by this run; removed in teardown.',
      status: 'OPEN', priority: 'LOW', category: 'LOST_ITEM',
      job_id: jobId || null,
      messages: [{
        senderRole: 'CUSTOMER', senderName: 'P6B fixture', text: `P6B ${label} fixture message`,
        metadata: { jobId: jobId || null, driverId: metadataDriverId || null }
      }]
    }).select('id, ticket_number').single();
    if (error) throw new Error(`ticket insert ${label}: ${error.message}`);
    owned.tickets.push(data.id);
    return data;
  }

  const walletOf = async (id) => {
    const r = await one('SELECT wallet_balance::text b FROM drivers WHERE id=$1::uuid', [id]);
    return r ? Number(r.b) : null;
  };
  const moneyOf = async (id) => one(`SELECT
      (SELECT count(*) FROM journal_transactions t WHERE EXISTS
        (SELECT 1 FROM journal_lines l WHERE l.journal_id=t.id AND l.entity_id=$1::text)) txn,
      (SELECT count(*) FROM journal_lines WHERE entity_id=$1::text) lines,
      (SELECT count(*) FROM driver_payouts WHERE driver_id=$1::uuid) payouts`, [id]);
  const statusOf = async (id) => (await one('SELECT status FROM support_tickets WHERE id=$1::uuid', [id])).status;
  const resolvedAuditOf = async (number) => Number((await one(
    "SELECT count(*) n FROM audit_logs WHERE action='TICKET_RESOLVED' AND target_entity_id LIKE $1",
    [`%${number}%`])).n);
  const journalTotal = async () => Number((await one('SELECT count(*) n FROM journal_transactions')).n);

  const ADMIN = 'p6b-suite-admin'; // not a uuid: resolveTicket only writes assigned_admin_id for one
  const bountyData = (amount) => ({
    resolutionNotes: `P6B resolve ${STAMP}`, refundAmount: 0,
    specializedData: {
      retrievalStatus: 'RETURNED_TO_CUSTOMER', returnMethod: 'DIRECT_DRIVER_DROP',
      handoverOtpVerified: true, driverBounty: amount
    }
  });
  const attempt = async (fn) => {
    try { return { ok: true, r: await fn() }; }
    catch (e) { return { ok: false, code: e.code, status: e.statusCode || e.status, msg: (e.message || '').slice(0, 110) }; }
  };
  const pay = (number) => db.supportTicketRepo.resolveTicket(number, bountyData(BOUNTY), ADMIN, 'P6B Suite', 'SUPER_ADMIN');

  try {
    const victim = await mkDriver('vic');
    const decoy = await mkDriver('dec');
    const legit = await mkDriver('leg');
    const customer = await mkUser();
    const job = await mkJob(customer, legit);

    const t0victim = await walletOf(victim);
    const t0decoy = await walletOf(decoy);
    const t0legit = await walletOf(legit);
    const j0 = await moneyOf(victim);
    const fixturesReady = [victim, decoy, legit, customer, job].every(Boolean)
      && t0victim === 0 && t0decoy === 0 && t0legit === 0;
    check('P6B-01', 'three zero-balance fixture drivers, a customer and one job were minted',
      fixturesReady, { victim, decoy, legit, customer, job });
    if (!fixturesReady) throw new Error('fixture provisioning failed; refusing to assert against absent rows');

    // ============================================================= 1. the spoof: name a driver, no job
    const spoof = await openTicket('SPOOF', {
      title: `P6B lost wallet left in cab ${STAMP}`,
      description: 'Driver returned my wallet; pay the bounty.',
      category: 'LOST_ITEM', priority: 'HIGH',
      driverId: victim            // customer-controlled text on a route any signed-in customer can call
    });
    const spoofRow = await one(
      'SELECT job_id, messages->0->\'metadata\'->>\'driverId\' AS named FROM support_tickets WHERE id=$1::uuid',
      [spoof.uuid]);
    check('P6B-02', 'the minted ticket really has no job and does carry the customer-named driver',
      spoofRow && spoofRow.job_id === null && spoofRow.named === victim,
      { jobId: spoofRow && spoofRow.job_id, named: spoofRow && spoofRow.named, ticket: spoof.ticketNumber });

    const g0 = await journalTotal();
    const out1 = await attempt(() => pay(spoof.ticketNumber));
    const w1victim = await walletOf(victim);
    const j1 = await moneyOf(victim);
    const g1 = await journalTotal();

    check('P6B-03', 'a bounty whose only driver claim is customer-typed is refused, not paid',
      out1.ok === false, out1.ok ? { success: out1.r && out1.r.success, ticketStatus: out1.r && out1.r.ticket && out1.r.ticket.status } : { code: out1.code, status: out1.status });
    check('P6B-04', 'the refusal is the existing 400 BOUNTY_DRIVER_UNRESOLVABLE (no new payout rule)',
      out1.ok === false && out1.code === 'BOUNTY_DRIVER_UNRESOLVABLE' && out1.status === 400,
      { code: out1.code, status: out1.status });
    check('P6B-05', `the named driver's durable wallet did not move by ${BOUNTY}`,
      near(w1victim, t0victim), { before: t0victim, after: w1victim, moved: Number(w1victim) - Number(t0victim) });
    check('P6B-06', 'the named driver got no journal transaction, line or payout',
      Number(j1.txn) === Number(j0.txn) && Number(j1.lines) === Number(j0.lines)
        && Number(j1.payouts) === Number(j0.payouts),
      { txn: j1.txn, lines: j1.lines, payouts: j1.payouts });
    check('P6B-07', 'the refused request booked no posting anywhere in the global journal',
      g1 === g0, { before: g0, after: g1 });
    check('P6B-08', 'the refused ticket was not marked RESOLVED and no resolution audit was written',
      (await statusOf(spoof.uuid)) !== 'RESOLVED' && (await resolvedAuditOf(spoof.ticketNumber)) === 0,
      { status: await statusOf(spoof.uuid) });

    // =================================== 2. the customer changes the name between attempts: no change
    const rewrote = await supabaseAdmin.from('support_tickets')
      .update({ messages: [{ senderRole: 'CUSTOMER', senderName: 'P6B fixture',
        text: 'Second attempt names a different driver.',
        metadata: { jobId: null, driverId: decoy } }] })
      .eq('id', spoof.uuid);
    const namedNow = await one(
      "SELECT messages->0->'metadata'->>'driverId' AS named FROM support_tickets WHERE id=$1::uuid",
      [spoof.uuid]);
    check('P6B-09', 'the fixture now names a different driver on the same ticket',
      !rewrote.error && namedNow && namedNow.named === decoy, { named: namedNow && namedNow.named });

    const out2 = await attempt(() => pay(spoof.ticketNumber));
    const w2decoy = await walletOf(decoy);
    const w2victim = await walletOf(victim);
    const g2 = await journalTotal();
    check('P6B-10', 'renaming the driver does not turn the claim into a payment',
      out2.ok === false && out2.code === 'BOUNTY_DRIVER_UNRESOLVABLE',
      out2.ok ? { success: out2.r && out2.r.success } : { code: out2.code, status: out2.status });
    check('P6B-11', 'neither the newly named nor the first named driver was credited',
      near(w2decoy, t0decoy) && near(w2victim, t0victim), { decoy: w2decoy, victim: w2victim });
    check('P6B-12', 'and the global journal still booked nothing across both attempts',
      g2 === g0, { before: g0, after: g2 });

    // ===================== 3. a job-less ticket that names nobody keeps the existing refusal =========
    const bare = await openTicket('BARE', {
      title: `P6B lost item, no driver named ${STAMP}`,
      description: 'Item returned; the trip is not recorded on this ticket.',
      category: 'LOST_ITEM', priority: 'NORMAL'
    });
    const out3 = await attempt(() => pay(bare.ticketNumber));
    check('P6B-13', 'the existing refusal still fires when the recipient cannot be proven',
      out3.ok === false && out3.code === 'BOUNTY_DRIVER_UNRESOLVABLE' && out3.status === 400,
      out3.ok ? { success: out3.r && out3.r.success } : { code: out3.code, status: out3.status });

    // ============ 4. an unrelated ticket cannot borrow a driver identity that is proven elsewhere ====
    const borrowed = await insertTicket('BORROW', { jobId: null, metadataDriverId: legit });
    const l0 = await moneyOf(legit);
    const out4 = await attempt(() => pay(borrowed.ticket_number));
    const w4legit = await walletOf(legit);
    const l1 = await moneyOf(legit);
    check('P6B-14', "a driver provably entitled on another ticket is not paid on this one's word",
      out4.ok === false && out4.code === 'BOUNTY_DRIVER_UNRESOLVABLE',
      out4.ok ? { success: out4.r && out4.r.success } : { code: out4.code, status: out4.status });
    check('P6B-15', 'and that refused borrow moved no money for the borrowed driver',
      near(w4legit, t0legit) && Number(l1.txn) === Number(l0.txn) && Number(l1.lines) === Number(l0.lines),
      { wallet: w4legit, txn: l1.txn });

    // ======================================= 5. legitimate workflow: proven by the ticket's own job ===
    const entitled = await insertTicket('ENTITLED', { jobId: job, metadataDriverId: null });
    const le0 = await moneyOf(legit);
    const out5 = await attempt(() => pay(entitled.ticket_number));
    const w5legit = await walletOf(legit);
    const le1 = await moneyOf(legit);
    check('P6B-16', 'a bounty on a ticket whose own job names the driver is still paid',
      out5.ok === true && out5.r && out5.r.success === true,
      out5.ok ? { success: out5.r.success } : { code: out5.code, status: out5.status, msg: out5.msg });
    check('P6B-17', `the job's driver wallet moved exactly +${BOUNTY}, once`,
      near(Number(w5legit) - Number(t0legit), BOUNTY), { before: t0legit, after: w5legit });
    check('P6B-18', 'exactly one journal transaction and two lines were booked for that driver',
      Number(le1.txn) - Number(le0.txn) === 1 && Number(le1.lines) - Number(le0.lines) === 2,
      { txn_delta: Number(le1.txn) - Number(le0.txn), line_delta: Number(le1.lines) - Number(le0.lines) });
    check('P6B-19', 'the legitimate ticket is durably RESOLVED with its audit record',
      (await statusOf(entitled.id)) === 'RESOLVED' && (await resolvedAuditOf(entitled.ticket_number)) >= 1,
      { status: await statusOf(entitled.id), audit: await resolvedAuditOf(entitled.ticket_number) });

    // ================================================== 6. replay cannot credit the recipient twice
    const le2 = await moneyOf(legit);
    const out6 = await attempt(() => pay(entitled.ticket_number));
    const le3 = await moneyOf(legit);
    const w6legit = await walletOf(legit);
    check('P6B-20', 'a replayed claim on a resolved ticket is refused',
      out6.ok === false && out6.status === 400, { code: out6.code, status: out6.status, msg: out6.msg });
    check('P6B-21', 'and the replay moved no money and booked nothing',
      near(w6legit, w5legit) && Number(le3.txn) === Number(le2.txn) && Number(le3.lines) === Number(le2.lines),
      { wallet: w6legit, txn: le3.txn });

    // ================= 7. a job-linked ticket that ALSO names a decoy pays the job's driver only
    const both = await insertTicket('BOTH', { jobId: job, metadataDriverId: victim });
    const v1 = await moneyOf(victim);
    const out7 = await attempt(() => pay(both.ticket_number));
    const w7legit = await walletOf(legit);
    const w7victim = await walletOf(victim);
    const v2 = await moneyOf(victim);
    check('P6B-22', 'a ticket with a real job and a decoy reference pays the JOB driver',
      out7.ok === true && near(Number(w7legit) - Number(w5legit), BOUNTY),
      out7.ok ? { legitBefore: w5legit, legitAfter: w7legit } : { code: out7.code, status: out7.status });
    check('P6B-23', 'the decoy named in the message is credited neither money nor a posting',
      near(w7victim, t0victim) && Number(v2.txn) === Number(v1.txn) && Number(v2.lines) === Number(v1.lines),
      { victimWallet: w7victim, txn: v2.txn, lines: v2.lines });

    // =============================================================== 8. the untrusted source stays gone
    const src = fs.readFileSync(REPO_FILE, 'utf8');
    const from = src.indexOf("row.category === 'LOST_ITEM'");
    const to = src.indexOf('const isSafetyIncident');
    const window = from >= 0 && to > from ? src.slice(from, to) : '';
    check('P6B-24', 'the bounty window is readable in the source (the pin is not vacuous)',
      window.length > 400, { chars: window.length });
    check('P6B-25', 'no payout recipient is derived from the message thread in that window',
      window.length > 0 && !/\.metadata/.test(window) && !/messages\[0\]/.test(window),
      { hit: /\.metadata/.test(window) || /messages\[0\]/.test(window) });
    check('P6B-26', 'the refusal the fix relies on is still in the source (not deleted to pass tests)',
      /BOUNTY_DRIVER_UNRESOLVABLE/.test(window) && /row\.job_id/.test(window));
  } finally {
    // ------------------------------------------------- cleanup: this run's rows only, rowCount evidence
    for (const id of owned.tickets) {
      const r = await c.query('DELETE FROM support_tickets WHERE id=$1::uuid', [id]).catch(() => null);
      console.log(`  ticket ${id}: DELETE rowCount=${r ? r.rowCount : 'error'}`);
    }
    const tryDel = async (label, sql, p) => {
      try { const r = await c.query(sql, p); return `${label} deleted=${r.rowCount}`; }
      // A job paid by a real bounty is pinned by append-only journal money, so it MUST stay: deleting
      // it would strand a posting. Refusal here is the guard working, not a bug to force around.
      catch (e) { return `${label} RETAINED (${e.message.split('\n')[0].slice(0, 52)})`; }
    };
    const sweep = [];
    sweep.push(await tryDel('job', 'DELETE FROM jobs WHERE job_number=$1', [`JOB-P6B-${STAMP}`]));
    sweep.push(await tryDel('user', 'DELETE FROM users WHERE id=$1::uuid', [owned.userId]));
    for (const d of owned.drivers) {
      // Same rule E3 link 8 applies: a driver carrying append-only financial history is retained,
      // because deleting the account would strand the posting that names it.
      const hist = await one(`SELECT (
          (SELECT count(*) FROM journal_lines WHERE entity_id=$1::text) +
          (SELECT count(*) FROM driver_payouts WHERE driver_id=$1::uuid)) n`, [d]);
      if (Number(hist.n) > 0) { sweep.push(`driver ${d.slice(0, 8)} RETAINED (financial rows=${hist.n})`); continue; }
      sweep.push(await tryDel('driver', 'DELETE FROM drivers WHERE id=$1::uuid', [d]));
    }
    console.log('  cleanup -> ' + sweep.join(' | '));
    const leftovers = await one(`SELECT
        (SELECT count(*) FROM support_tickets WHERE ticket_number LIKE 'TCK-P6B-%') tickets,
        (SELECT count(*) FROM jobs WHERE job_number LIKE 'JOB-P6B-%') jobs,
        (SELECT count(*) FROM users WHERE name LIKE 'P6B bounty customer %') users,
        (SELECT count(*) FROM drivers WHERE name LIKE 'P6B % driver ${STAMP}') drivers_retained`);
    console.log(`  P6B residue after cleanup: ${JSON.stringify(leftovers)}`);
    await c.end();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== P6B BOUNTY RECIPIENT ATTRIBUTION TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => {
  console.error('FATAL', e.message);
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== P6B BOUNTY RECIPIENT ATTRIBUTION TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length + 1} failed ===`);
  process.exitCode = 1;
});
