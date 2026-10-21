/*
 * NABIN Platform — Sanction Attribution Truthfulness Test (P5-D / F-7)
 *
 * The contract this suite pins, in one sentence: a driver may only be suspended by a support
 * resolution when the ticket itself proves which driver it is about, and a resolution that cannot
 * prove it must refuse instead of suspending someone and reporting that it did.
 *
 * The defect, as measured against the local store before the fix:
 *   1. `SupportTicketRepository.js:946-948` attributed ticket `TCK-9479` to `'drv_2'`, and
 *      `DriverRepository.js:8` maps `drv_2` to the real durable driver
 *      `00000000-0000-0000-0000-000000000102`. Measured in the dev store: that ticket exists with
 *      `job_id = null` and `status = OPEN`, and driver `…0102` exists. So the line was not a demo
 *      convenience — it was a suspending write against a named person, chosen by a string literal.
 *   2. `SupportTicketRepository.js:942-944` took the sanction target from
 *      `messages[0].metadata.driverId`, which `createTicket` fills from `payload.driverId`
 *      (`SupportTicketRepository.js:319`) whenever the caller did not supply a jobId — and the
 *      ticket route passes `req.body` straight through (`server.js:2475`). A CUSTOMER can therefore
 *      name the driver who is to be punished. Measured: `test_suite.js:1618-1642` does exactly that
 *      (`driverId: 'DRV-101'`, no jobId), asserts the suspension lands, and then `test_suite.js:1646`
 *      force-restores `0101/0102/0103` to AVAILABLE — the cleanup is the confession. The durable
 *      residue of that module is the row `TCK-261018-405619`: `category = SAFETY_INCIDENT`,
 *      `job_id = null`, `metadata.driverId = "DRV-101"`, `resolution_notes` reading "Driver suspended
 *      for 48 hours".
 *   3. When neither source produced a target, the branch skipped the sanction silently and STEP 3
 *      still wrote `status = RESOLVED` with those notes and returned `{success: true}`. The admin
 *      console and the audit trail then say a driver was frozen. Nobody was.
 *
 * The fix this suite demands: attribute a state-changing sanction ONLY from the ticket's durable job
 * (`row.job_id` -> job.driver_id, which `createTicket` already ownership-checks at 289-303), refuse
 * with 400 `SANCTION_DRIVER_UNRESOLVABLE` when the ticket cannot prove a driver — the same shape the
 * bounty gate in this very method already uses (`BOUNTY_DRIVER_UNRESOLVABLE`, 891-897) — and stop
 * claiming enforcement that did not happen. A sanction that changes nothing (`WARNING_ISSUED`) keeps
 * resolving, because nothing about a driver is being asserted.
 *
 * Method: the real local PostgreSQL target and the real repositories, with an empty in-memory mirror
 * so every read and write has to go through the store — "the driver was not touched" is a durable
 * read-back, not a counter. Fixtures (one job, three tickets, two drivers) are created by this run and
 * removed or restored by tracked id in `finally`. The refund leg uses a seam instead of the ledger so
 * the run books no permanent money: the assertion there is about ticket state and refusal, and wallet
 * authority is pinned by the money suites. `jobs.driver_id` is FK-constrained to `drivers` (measured),
 * so this suite does NOT test a "sanction target vanished mid-flight" branch — a guard for it could
 * not be reached, and nothing here asks for one that cannot fail.
 */

const fs = require('fs');
const path = require('path');

const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'SupportTicketRepository.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');

const DRIVER_0102 = '00000000-0000-0000-0000-000000000102';
const EXCLUDED_DRIVERS = [
  '00000000-0000-0000-0000-000000000101',
  DRIVER_0102,
  '00000000-0000-0000-0000-000000000103'
];

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

async function main() {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  check('F7-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin, { isLivePostgres });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log('');
    console.log(`📊 SANCTION ATTRIBUTION TRUTHFULNESS TEST: 0/1 passed, 1 failed`);
    process.exitCode = 1;
    return;
  }

  const SupportTicketRepository = require('./src/repositories/SupportTicketRepository');
  const DriverRepository = require('./src/repositories/DriverRepository');
  const JobRepository = require('./src/repositories/JobRepository');

  // ------------------------------------------------------------- test seam (not a mock of the defect)
  // `db` supplies only what resolveTicket collaborates with. The mirrors are deliberately EMPTY: a
  // driver answer then has to come from PostgreSQL, so a green "untouched" assertion is durable fact.
  const auditWrites = [];
  const ledgerCalls = [];
  const db = {
    users: [],
    drivers: [],
    jobs: [],
    supportTickets: [],
    driverRepo: null,
    jobRepo: null,
    userRepo: null,
    ledgerRepo: {
      adjustWallet: async (req) => { ledgerCalls.push(req); return { balance: 0 }; }
    },
    orderRepo: {
      storeUnavailableError: (what, cause) => {
        const err = new Error(`The ${what} could not be completed because the store is unreachable.`);
        err.storeFailure = true;
        err.code = 'STORE_UNAVAILABLE';
        return err;
      }
    },
    auditAppliedChange: async (entry) => { auditWrites.push(entry); return entry; }
  };
  db.driverRepo = new DriverRepository(db);
  db.jobRepo = new JobRepository(db);
  const ticketRepo = new SupportTicketRepository(db);

  // ------------------------------------------------------------------ owned fixtures
  const owned = { tickets: [], jobs: [], driverRestores: [] };
  const stamp = Date.now();

  async function readDriver(id) {
    const { data, error } = await supabaseAdmin.from('drivers')
      .select('id, operational_status, is_online').eq('id', id).maybeSingle();
    if (error) throw new Error(`driver read ${id}: ${error.message}`);
    return data;
  }

  async function mkTicket(label, { jobId, metadataDriverId }) {
    const number = `TCK-F7-${label}-${stamp}`;
    const { data, error } = await supabaseAdmin.from('support_tickets').insert({
      ticket_number: number,
      user_type: 'CUSTOMER',
      user_id: owned.customerId,
      subject: `F-7 focused fixture (${label})`,
      description: 'Created by sanction_attribution_truthfulness_test; owned by this run; removed in teardown.',
      status: 'OPEN',
      priority: 'CRITICAL',
      category: 'SAFETY_INCIDENT',
      job_id: jobId || null,
      messages: [{
        senderRole: 'CUSTOMER',
        senderName: 'F-7 fixture',
        text: 'Fixture ticket for the sanction attribution suite.',
        metadata: { jobId: jobId || null, driverId: metadataDriverId || null }
      }]
    }).select('id, ticket_number').single();
    if (error) throw new Error(`ticket insert ${label}: ${error.message}`);
    owned.tickets.push(data.id);
    return data.ticket_number;
  }

  try {
    // Two distinct real drivers: one legitimately tied to a job, one a decoy named only by the caller.
    const { data: quietCustomer } = await supabaseAdmin.from('users')
      .select('id').eq('wallet_balance', 0).order('id', { ascending: true }).limit(1).maybeSingle();
    const { data: driverA } = await supabaseAdmin.from('drivers')
      .select('id, operational_status, is_online').eq('wallet_balance', 0)
      .not('id', 'in', `(${EXCLUDED_DRIVERS.join(',')})`)
      .eq('operational_status', 'AVAILABLE').order('id', { ascending: true }).limit(1).maybeSingle();
    const { data: driverB } = await supabaseAdmin.from('drivers')
      .select('id, operational_status, is_online').eq('wallet_balance', 0)
      .not('id', 'in', `(${EXCLUDED_DRIVERS.concat(driverA ? [driverA.id] : []).join(',')})`)
      .eq('operational_status', 'AVAILABLE').order('id', { descending: true }).limit(1).maybeSingle();
    owned.customerId = quietCustomer ? quietCustomer.id : null;

    const fixtureReady = !!(owned.customerId && driverA && driverB);
    check('F7-01', 'isolated fixtures exist (a customer, a job driver, a distinct decoy driver)',
      fixtureReady, { customer: owned.customerId, driverA: driverA && driverA.id, driverB: driverB && driverB.id });
    if (!fixtureReady) throw new Error('fixture provisioning failed; refusing to assert against absent rows');

    const jobRes = await supabaseAdmin.from('jobs').insert({
      job_number: `JOB-F7-${stamp}`,
      service_type: 'RIDE',
      status: 'COMPLETED',
      customer_id: owned.customerId,
      driver_id: driverA.id,
      pickup_address: 'F-7 fixture pickup',
      drop_address: 'F-7 fixture drop',
      distance_km: 1.0, fare_subtotal: 100.0, final_total: 100.0,
      driver_earnings: 85.0, platform_commission: 15.0,
      payment_method: 'WALLET', payment_status: 'PAID'
    }).select('id').single();
    if (jobRes.error) throw new Error(`job insert: ${jobRes.error.message}`);
    owned.jobs.push(jobRes.data.id);
    owned.driverRestores.push({ id: driverA.id, operational_status: driverA.operational_status, is_online: driverA.is_online });
    owned.driverRestores.push({ id: driverB.id, operational_status: driverB.operational_status, is_online: driverB.is_online });
    // 0102 is only read here; it is restored if (and only if) the unfixed code writes to it.
    const seed0102 = await readDriver(DRIVER_0102);
    if (seed0102) owned.driverRestores.push({ id: DRIVER_0102, ...seed0102 });

    const ADMIN = 'f7-suite-admin'; // not a uuid: resolveTicket only writes assigned_admin_id for a uuid
    const suspend = { driverSanction: 'SUSPEND_48H', resolutionType: 'SAFETY_INCIDENT_RESOLVED' };

    // =================================================================
    // SCENE A — the caller-named decoy must not become the punishment
    // =================================================================
    const tDecoy = await mkTicket('DECOY', { jobId: null, metadataDriverId: 'DRV-102' });
    let refused = null;
    let refusedSuccess = null;
    try {
      const r = await ticketRepo.resolveTicket(tDecoy,
        { resolutionNotes: 'Driver suspended for 48 hours.', refundAmount: 0.0, specializedData: suspend },
        ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
      refusedSuccess = r; // unfixed code reaches here
    } catch (err) {
      refused = err;
    }
    check('F7-02', 'a sanction with no provable driver is refused rather than answered as success',
      !!refused && refusedSuccess === null,
      refusedSuccess ? { returned: refusedSuccess.success, driver: refusedSuccess.driver } : { code: refused && refused.code });

    check('F7-03', 'the refusal is a named, client-facing 400 SANCTION_DRIVER_UNRESOLVABLE',
      !!refused && refused.code === 'SANCTION_DRIVER_UNRESOLVABLE'
        && (refused.statusCode === 400 || refused.status === 400),
      refused ? { code: refused.code, statusCode: refused.statusCode, status: refused.status } : { wrong: refusedSuccess });

    const after0102 = await readDriver(DRIVER_0102);
    check('F7-04', 'the driver the customer named (DRV-102 -> …0102) is durably untouched',
      !!after0102 && after0102.operational_status === seed0102.operational_status
        && after0102.is_online === seed0102.is_online,
      { before: seed0102, after: after0102 });

    const { data: tDecoyRow } = await supabaseAdmin.from('support_tickets')
      .select('status').eq('ticket_number', tDecoy).maybeSingle();
    check('F7-05', 'the refused ticket is not flipped to RESOLVED',
      !!tDecoyRow && tDecoyRow.status !== 'RESOLVED', { status: tDecoyRow && tDecoyRow.status });

    check('F7-06', 'a refusal writes no privileged audit record',
      auditWrites.length === 0, { auditWrites: auditWrites.length });

    // A uuid decoy (not a legacy alias) has to be refused for the same reason.
    const tUuidDecoy = await mkTicket('UUIDDECOY', { jobId: null, metadataDriverId: driverB.id });
    let refusedB = null, okB = null;
    try {
      okB = await ticketRepo.resolveTicket(tUuidDecoy,
        { resolutionNotes: 'Suspended.', refundAmount: 0.0, specializedData: suspend },
        ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
    } catch (err) { refusedB = err; }
    const afterB = await readDriver(driverB.id);
    check('F7-07', 'a caller-named driver uuid is refused too, and that driver stays as found',
      !!refusedB && refusedB.code === 'SANCTION_DRIVER_UNRESOLVABLE'
        && afterB.operational_status === driverB.operational_status,
      refusedB ? { code: refusedB.code } : { returned: okB && okB.success });

    const tDeact = await mkTicket('DEACT', { jobId: null, metadataDriverId: 'DRV-102' });
    let refusedC = null, okC = null;
    try {
      okC = await ticketRepo.resolveTicket(tDeact, {
        resolutionNotes: 'Permanently deactivated.', refundAmount: 0.0,
        specializedData: { driverSanction: 'DEACTIVATE_PERMANENT' }
      }, ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
    } catch (err) { refusedC = err; }
    check('F7-08', 'DEACTIVATE_PERMANENT is gated by the same proof requirement',
      !!refusedC && refusedC.code === 'SANCTION_DRIVER_UNRESOLVABLE',
      refusedC ? { code: refusedC.code } : { returned: okC && okC.success });

    // =================================================================
    // SCENE B — the positive control: a ticket that CAN prove its driver
    // =================================================================
    const beforeB2 = await readDriver(driverB.id);
    const tProved = await mkTicket('PROVED', { jobId: jobRes.data.id, metadataDriverId: driverB.id });
    let provedErr = null, proved = null;
    try {
      proved = await ticketRepo.resolveTicket(tProved, {
        resolutionNotes: 'Reckless driving on the assigned trip. Driver suspended 48 hours.',
        refundAmount: 0.0, specializedData: suspend
      }, ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
    } catch (err) { provedErr = err; }
    check('F7-09', 'a sanction on a ticket whose job identifies the driver still resolves',
      !provedErr && proved && proved.success === true && !!proved.driver
        && (proved.driver.id === driverA.id || proved.driver.uuid === driverA.id),
      provedErr ? { err: provedErr.code || provedErr.message }
        : { success: proved.success, driver: proved.driver && (proved.driver.id || proved.driver.uuid), expect: driverA.id });

    const afterA = await readDriver(driverA.id);
    check('F7-10', 'the sanction is durable: PostgreSQL says that driver is SUSPENDED and offline',
      afterA.operational_status === 'SUSPENDED' && afterA.is_online === false, afterA);

    const afterB2 = await readDriver(driverB.id);
    check('F7-11', 'a job-linked ticket sanctions the job driver, not the driver its metadata names',
      afterB2.operational_status === beforeB2.operational_status
        && afterB2.is_online === beforeB2.is_online
        && afterA.id === driverA.id,
      { decoyBefore: beforeB2, decoyAfter: afterB2, job: afterA });

    const provedAudit = auditWrites.filter((w) => w && w.action === 'TICKET_RESOLVED'
      && w.targetEntityId === String(tProved));
    const refusedAudit = auditWrites.filter((w) => w && w.action === 'TICKET_RESOLVED'
      && [tDecoy, tUuidDecoy, tDeact].includes(w.targetEntityId));
    check('F7-12', 'the resolution that did happen is audited once and the refusals are not audited',
      provedAudit.length === 1 && refusedAudit.length === 0,
      { proved: provedAudit.length, refusedButAudited: refusedAudit.length });

    // =================================================================
    // SCENE C — the fix must not become a blanket refusal
    // =================================================================
    const tWarn = await mkTicket('WARN', { jobId: null, metadataDriverId: null });
    let warnErr = null, warn = null;
    try {
      warn = await ticketRepo.resolveTicket(tWarn, {
        resolutionNotes: 'Warning issued, verbal counselling recorded.', refundAmount: 0.0,
        specializedData: { driverSanction: 'WARNING_ISSUED' }
      }, ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
    } catch (err) { warnErr = err; }
    check('F7-13', 'a sanction that changes no driver state still resolves (gate is not over-broad)',
      !warnErr && warn && warn.success === true && warn.ticket && warn.ticket.status === 'RESOLVED',
      warnErr ? { err: warnErr.code || warnErr.message } : { success: warn && warn.success, status: warn && warn.ticket && warn.ticket.status });

    // A refusal after the refund leg must leave the ticket in the claim state, never RESOLVED.
    const tRefund = await mkTicket('REFUND', { jobId: null, metadataDriverId: 'DRV-102' });
    let refundErr = null, refundOk = null;
    try {
      refundOk = await ticketRepo.resolveTicket(tRefund, {
        resolutionNotes: 'Passenger credited, driver suspended.', refundAmount: 150.0,
        specializedData: suspend
      }, ADMIN, 'F-7 Suite', 'SUPER_ADMIN');
    } catch (err) { refundErr = err; }
    const { data: tRefundRow } = await supabaseAdmin.from('support_tickets')
      .select('status').eq('ticket_number', tRefund).maybeSingle();
    check('F7-14', 'a sanction refusal after the refund leg still refuses and never says RESOLVED',
      !!refundErr && !!tRefundRow && tRefundRow.status !== 'RESOLVED',
      refundErr ? { code: refundErr.code, status: tRefundRow && tRefundRow.status }
        : { returned: refundOk && refundOk.success, status: tRefundRow && tRefundRow.status });
    check('F7-15', 'the refund leg is what ran first, so the claim semantics stay documented',
      ledgerCalls.length >= 1, { ledgerCalls: ledgerCalls.length });

    // =================================================================
    // SCENE D — static pins for the two literals that made this possible
    // =================================================================
    const repoSrc = fs.readFileSync(REPO_FILE, 'utf8').replace(/\r\n/g, '\n');
    const sanctionStart = repoSrc.indexOf('const isSafetyIncident');
    const sanctionBlock = sanctionStart === -1 ? '' : repoSrc.slice(sanctionStart, sanctionStart + 1600);
    check('F7-16', 'STATIC: no ticket number is hard-coded to a driver anywhere in the repository',
      repoSrc.indexOf("'TCK-9479'") === -1 && repoSrc.indexOf('"TCK-9479"') === -1,
      { found: repoSrc.indexOf('TCK-9479') !== -1 });
    check('F7-17', 'STATIC: the sanction branch no longer reads a caller-supplied driver reference',
      sanctionBlock.length > 0 && sanctionBlock.indexOf('metadata?.driverId') === -1
        && sanctionBlock.indexOf("'drv_2'") === -1 && sanctionBlock.indexOf('LEGACY_DRIVER_MAP') === -1,
      { branchChars: sanctionBlock.length });

    const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
    const routeStart = serverSrc.indexOf("app.post('/api/admin/support/:id/resolve'");
    const routeBlock = routeStart === -1 ? '' : serverSrc.slice(routeStart, routeStart + 2600);
    check('F7-18', 'STATIC: the resolve route echoes the refusal code so a console can tell them apart',
      routeBlock.indexOf("err.code ? { code: err.code }") !== -1,
      { routeFound: routeStart !== -1 });

  } catch (fatal) {
    check('F7-99', 'suite completed without a fatal fixture error', false, { error: String(fatal && fatal.message || fatal) });
  } finally {
    // Teardown: exactly the rows this run created. No broad delete, no financial row is touched,
    // and a driver is only restored when this run changed it (the unfixed code does write 0102).
    for (const id of owned.tickets) {
      const { error } = await supabaseAdmin.from('support_tickets').delete().eq('id', id);
      if (error) console.log(`[teardown] ticket ${id}: ${error.message}`);
    }
    for (const id of owned.jobs) {
      const { error } = await supabaseAdmin.from('jobs').delete().eq('id', id);
      if (error) console.log(`[teardown] job ${id}: ${error.message}`);
    }
    for (const d of owned.driverRestores) {
      const now = await readDriver(d.id).catch(() => null);
      if (!now) continue;
      if (now.operational_status !== d.operational_status || now.is_online !== d.is_online) {
        await supabaseAdmin.from('drivers')
          .update({ operational_status: d.operational_status, is_online: d.is_online }).eq('id', d.id);
        console.log(`[teardown] driver ${d.id} restored to ${d.operational_status}`);
      }
    }
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log('');
  console.log('========================================================================');
  console.log(`📊 SANCTION ATTRIBUTION TRUTHFULNESS TEST: ${passed}/${results.length} passed, ${failed} failed`);
  console.log('========================================================================');
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error('SANCTION SUITE ERROR:', e && e.stack || e);
  process.exitCode = 2;
});
