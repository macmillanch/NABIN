/*
 * MI-4 residual (P1) — first-entity substitution on ids that resolve to nobody.
 *
 * The headline elevation (an unenrolled phone in a DRIVER OTP login becoming `drivers[0]`) is shut
 * and held by driver_unenrolled_phone_elevation_test.js + driver_identity_substitution_route_test.js.
 * What this suite covers is the rest of the same contract: `db.getDriver()` ends in
 * `|| this.drivers[0]` and `db.getUser()` in `|| this.users[0]`, so NEITHER can ever answer null —
 * every `if (!driver)` / `if (!user)` written under such a call is unreachable code, and any
 * unresolved or caller-supplied id is silently read as the first seeded account of that kind.
 * The routes already proved the session path. The remaining exposure is the paths that aim an
 * effect at a person named by a parameter rather than by the caller's own bearer:
 *
 *   - an admin financial adjustment (`processFinancialAdjustment`) — in the offline mirror branch
 *     it wrote the FIRST SEEDED CUSTOMER's/DRIVER's balance, and its idempotency identity is built
 *     from that account's uuid, so one caller key could collide across two different targets;
 *   - an admin driver status/KYC decision (`setDriverStatus`) — suspended the first seeded driver;
 *   - a support-ticket settlement (`resolveSupportTicket`) — refunded the wallet and paid the bounty
 *     to whichever account happened to be `users[0]` / `drivers[0]`;
 *   - `POST /api/driver/vehicle/photo` (and its profile sibling) — the `if (!driver)` 404 under
 *     `db.getDriver(requestedDriverId)` was dead code, so an unresolvable `driverId` was answered
 *     200 and persisted a durable `media_assets` row owned by an unrelated seeded driver.
 *
 * A strict resolver also has to keep serving accounts that are real but not hydrated into this
 * process's mirror, so the money checks demand the durable-aware answer, not just a refusal:
 * refusing a legitimate account would be a new outage, and HEAD's fallback answered those too.
 *
 * Money and census safety: nothing here books money. Checks that would otherwise post to the
 * ledger run with `db.ledgerRepo`/`db.auditLogRepo` detached from this process (the offline branch
 * mutates only this process's mirror, and `persistentStore` no-ops in live mode, so `db.save()`
 * writes nothing). The durable rows this run owns are its own fixture `users`/`drivers` records and
 * its own `media_assets` rows, deleted by their exact ids and guarded so a record with any
 * financial or journal linkage is never removed. No shared record is deleted or overwritten.
 *
 * Local/test only: refuses a non-loopback backend or database. Run via scripts/with_local_target.js.
 */
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const PG = process.env.DATABASE_URL;
const STAMP = Date.now();
const isLoopback = (u) => {
  let host; try { host = new URL(u).hostname; } catch (e) { return false; }
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(host);
};
if (!PG || !isLoopback(PG)) {
  console.error('MI-4 RESIDUAL REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
  process.exit(1);
}

// The customer photo route's substituted folder would be `nabin/users/<users[0].id>/avatar`: an
// upsert against a public id a seeded-account suite may already own. That is what a REGRESSED tree
// does, so measuring HEAD declined this one check rather than overwrite a shared record; the fixed
// route answers 404 and persists nothing, which is what a regression run has to prove. It therefore
// runs by default and is opted OUT only for a before-fix measurement.
const SKIP_CUSTOMER_ROUTE = process.env.ISR_SKIP_CUSTOMER_ROUTE === '1';

let PORT = 0;
let BASE = '';
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}
function skip(id, name, reason) {
  results.push({ id, pass: true, skipped: true });
  console.log(`[SKIP] ${id} ${name} -> ${reason}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, urlPath, body, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
      timeout: timeoutMs,
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null; try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: String(data).slice(0, 160) }; }
        resolve({ status: res.statusCode, data: json || {} });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, hung: true, data: {} }); });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const SAMPLE_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('ISR-ALL', 'identity substitution residual (money, status, ticket, media ownership)',
      'needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // Rows this run created, remembered by id so cleanup can only ever name its own records.
  const createdUsers = [];
  const createdDrivers = [];
  const createdPublicIds = [];

  // Every durable row removed here was created by this run and named by its own id. The guarded
  // deletes refuse any account with a journal line or a payout attached to it, so no financial
  // record can be swept away to make a check pass.
  async function scrub() {
    try {
      if (createdPublicIds.length) {
        await c.query('DELETE FROM media_assets WHERE public_id = ANY($1::text[])', [createdPublicIds]);
      }
    } catch (e) { console.log('  media cleanup note: ' + e.message); }
    try {
      await c.query('DELETE FROM backend_sessions WHERE phone = ANY($1::text[])', [[db.normalizePhone(ownRaw)]]);
    } catch (e) { console.log('  session cleanup note: ' + e.message); }
    for (const id of createdDrivers) {
      try {
        await c.query(`DELETE FROM drivers WHERE id=$1::uuid
          AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
          AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [id]);
      } catch (e) { console.log(`  driver ${id} kept: ` + e.message); }
    }
    for (const id of createdUsers) {
      try {
        await c.query('DELETE FROM users WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM drivers WHERE user_id=$1::uuid)', [id]);
      } catch (e) { console.log(`  user ${id} kept: ` + e.message); }
    }
  }

  const ownRaw = `73${String(STAMP).slice(-8)}`;
  const GHOST_USR = `USR-ISR-MISSING-${STAMP}`;
  const GHOST_DRV = `DRV-ISR-MISSING-${STAMP}`;
  const VEH_GHOST = `veh-isr-ghost-${STAMP}`;
  const VEH_OWN = `veh-isr-own-${STAMP}`;

  // ---- the accounts the fallback reaches: whatever [0] is in THIS process's mirror ----
  const usr0 = db.users[0];
  const drv0 = db.drivers[0];
  const usr0Id = usr0 && usr0.id;
  const drv0Id = drv0 && drv0.id;

  // ---- fixtures this run owns: real durable rows, deliberately NOT hydrated into the mirror ----
  const mkUser = async (name, phoneRaw, walletBalance) => {
    const r = await supabaseAdmin.from('users').insert({
      name, phone: db.normalizePhone(phoneRaw), ...(walletBalance === null ? {} : { wallet_balance: walletBalance })
    }).select('id').single();
    if (r.error || !r.data) { console.error(`FATAL: user insert refused for ${name} ` + JSON.stringify(r.error)); await scrub(); await c.end(); process.exit(1); }
    createdUsers.push(r.data.id);
    return r.data.id;
  };
  const mkDriver = async (name, phoneRaw, userId, opts) => {
    const r = await supabaseAdmin.from('drivers').insert({
      user_id: userId, name, phone: db.normalizePhone(phoneRaw),
      vehicle_type: opts.vehicleType, vehicle_number: opts.vehicleNumber, operational_status: 'AVAILABLE',
      wallet_balance: opts.walletBalance, kyc_status: 'VERIFIED', payout_upi_verified: false
    }).select('id').single();
    if (r.error || !r.data) { console.error(`FATAL: driver insert refused for ${name} ` + JSON.stringify(r.error)); await scrub(); await c.end(); process.exit(1); }
    createdDrivers.push(r.data.id);
    return r.data.id;
  };

  const uuidA = await mkUser(`ISR adjustment customer A ${STAMP}`, `61${String(STAMP).slice(-8)}`, 400);
  const uuidB = await mkUser(`ISR adjustment customer B ${STAMP}`, `62${String(STAMP).slice(-8)}`, 500);
  const uuidC = await mkUser(`ISR route driver user ${STAMP}`, ownRaw, null);
  const drvCUuid = await mkDriver(`ISR fixture driver ${STAMP}`, ownRaw, uuidC,
    { vehicleType: 'AUTO', vehicleNumber: `IS${String(STAMP).slice(-6)}`, walletBalance: 1337 });
  const uuidDUser = await mkUser(`ISR adjustment driver user ${STAMP}`, `63${String(STAMP).slice(-8)}`, null);
  const uuidD = await mkDriver(`ISR adjustment driver D ${STAMP}`, `64${String(STAMP).slice(-8)}`, uuidDUser,
    { vehicleType: '4W', vehicleNumber: `ID${String(STAMP).slice(-6)}`, walletBalance: 700 });

  // Detach the durable money and audit writers for every in-process money check. With no ledger
  // repository the adjustment takes its offline branch (mirror arithmetic only) and the ticket
  // settlement only touches this process's arrays, so a substitution is still observable while
  // nothing can be booked against a real account.
  const realLedger = db.ledgerRepo;
  const realAudit = db.auditLogRepo;
  const realDriverRepo = db.driverRepo;
  const realUserRepo = db.userRepo;
  const detachMoneyWriters = () => { db.ledgerRepo = null; db.auditLogRepo = null; };
  const restoreWriters = () => {
    db.ledgerRepo = realLedger; db.auditLogRepo = realAudit;
    db.driverRepo = realDriverRepo; db.userRepo = realUserRepo;
  };

  let child = null;
  try {
    // ================= Group A — admin financial adjustment aims at a person =================
    detachMoneyWriters();
    const before0 = { usr: usr0 && usr0.walletBalance, drv: drv0 && drv0.walletBalance };

    const ghostUsrRes = await db.processFinancialAdjustment('CUSTOMER', GHOST_USR, 'CREDIT', 50,
      'ISR ghost customer', 'adm_isr', 'ISR admin', {});
    check('ISR-01', 'an unresolvable CUSTOMER adjustment is refused with a typed code, not served as users[0]',
      ghostUsrRes.success === false && ghostUsrRes.code === 'CUSTOMER_NOT_FOUND',
      { success: ghostUsrRes.success, code: ghostUsrRes.code, error: ghostUsrRes.error });
    check('ISR-02', 'the refusal moved the fallback customer no money',
      !usr0 || usr0.walletBalance === before0.usr,
      { before: before0.usr, after: usr0 && usr0.walletBalance });
    check('ISR-03', 'the refusal is the resolver answer, not a raw PostgreSQL/ledger message',
      typeof ghostUsrRes.error === 'string' && !/postgres|authoritative|ledger|uuid/i.test(ghostUsrRes.error),
      { error: ghostUsrRes.error });

    const ghostDrvRes = await db.processFinancialAdjustment('DRIVER', GHOST_DRV, 'CREDIT', 50,
      'ISR ghost driver', 'adm_isr', 'ISR admin', {});
    check('ISR-04', 'an unresolvable DRIVER adjustment is refused with a typed code, not served as drivers[0]',
      ghostDrvRes.success === false && ghostDrvRes.code === 'DRIVER_NOT_FOUND',
      { success: ghostDrvRes.success, code: ghostDrvRes.code, error: ghostDrvRes.error });
    check('ISR-05', 'the refusal moved the fallback driver no money',
      !drv0 || drv0.walletBalance === before0.drv,
      { before: before0.drv, after: drv0 && drv0.walletBalance });

    // A real account this process never hydrated: the strict resolver has to go to PostgreSQL for
    // it. Refusing it would be a new outage; substituting it is the old bug.
    const hitA = await db.processFinancialAdjustment('CUSTOMER', uuidA, 'CREDIT', 100,
      'ISR real customer A', 'adm_isr', 'ISR admin', {});
    const mirrorA = db.users.find(u => u.uuid === uuidA || u.id === uuidA);
    check('ISR-06', 'a real but unhydrated CUSTOMER is served as ITSELF, not as users[0]',
      hitA.success === true && Number(hitA.updatedBalance) === 500 && (!usr0 || usr0.walletBalance === before0.usr),
      { success: hitA.success, updatedBalance: hitA.updatedBalance, expected: 500,
        fallbackBalance: usr0 && usr0.walletBalance, hydratedAs: mirrorA && mirrorA.id });

    const hitD = await db.processFinancialAdjustment('DRIVER', uuidD, 'DEBIT', 200,
      'ISR real driver D', 'adm_isr', 'ISR admin', {});
    const mirrorD = db.drivers.find(d => d.uuid === uuidD || d.id === uuidD);
    check('ISR-07', 'a real but unhydrated DRIVER is served as ITSELF, not as drivers[0]',
      hitD.success === true && Number(hitD.updatedBalance) === 500 && (!drv0 || drv0.walletBalance === before0.drv),
      { success: hitD.success, updatedBalance: hitD.updatedBalance, expected: 500,
        fallbackBalance: drv0 && drv0.walletBalance, hydratedAs: mirrorD && mirrorD.id });

    // The idempotency identity is built from the resolved account's uuid. Under the fallback both
    // mistargeted requests carried users[0]'s uuid, so one caller key collided across two people.
    const sharedKey = `ISR-shared-key-${STAMP}`;
    const k1 = await db.processFinancialAdjustment('CUSTOMER', uuidA, 'CREDIT', 10,
      'ISR collide 1', 'adm_isr', 'ISR admin', { idempotencyKey: sharedKey });
    const k2 = await db.processFinancialAdjustment('CUSTOMER', uuidB, 'CREDIT', 10,
      'ISR collide 2', 'adm_isr', 'ISR admin', { idempotencyKey: sharedKey });
    check('ISR-08', 'one caller idempotency key cannot span two different customers',
      k1.success === true && k2.success === true
        && !!k1.idempotencyKey && !!k2.idempotencyKey && k1.idempotencyKey !== k2.idempotencyKey,
      { k1: k1.idempotencyKey, k2: k2.idempotencyKey, same: k1.idempotencyKey === k2.idempotencyKey });
    restoreWriters();

    // ================= Group B — status and ticket effects aim at a person =================
    db.driverRepo = null; db.userRepo = null; db.auditLogRepo = null;
    const drv0StatusBefore = drv0 && drv0.operationalStatus;
    const auditLenBefore = db.auditLogs.length;

    const ghostStatus = await db.setDriverStatus(GHOST_DRV, 'SUSPENDED', 'ISR ghost suspend', 'adm_isr', 'ISR admin');
    check('ISR-09', 'an unresolvable driverId cannot suspend drivers[0] in the offline branch',
      ghostStatus && ghostStatus.success === false && ghostStatus.code === 'DRIVER_NOT_FOUND'
        && (!drv0 || drv0.operationalStatus === drv0StatusBefore),
      { result: ghostStatus && { success: ghostStatus.success, code: ghostStatus.code },
        before: drv0StatusBefore, after: drv0 && drv0.operationalStatus });

    const namedFallback = db.auditLogs.slice(auditLenBefore)
      .some(a => a && a.targetEntityId === drv0Id && /DRIVER_/.test(String(a.action || '')));
    check('ISR-10', 'the refused status change wrote no audit record naming the fallback driver',
      !namedFallback, { newAuditRows: db.auditLogs.length - auditLenBefore, fallbackDriver: drv0Id });

    const ticketId = `TCK-ISR-${STAMP}`;
    const txnLenBefore = db.transactions.length;
    db.supportTickets.unshift({
      id: ticketId, jobId: null, userId: GHOST_USR, driverId: GHOST_DRV,
      category: 'LOST_ITEM', status: 'OPEN', subject: `ISR residual ticket ${STAMP}`,
      message: 'identity substitution residual fixture', createdAt: new Date().toISOString()
    });
    const refundBefore = usr0 && usr0.walletBalance;
    const bountyBefore = drv0 && drv0.walletBalance;
    db.resolveSupportTicket(ticketId, 'ISR residual resolution', 75, 'adm_isr', 'ISR admin', { driverBounty: 25 });
    const newTxns = db.transactions.slice(txnLenBefore);
    const refundToFallback = newTxns.filter(t => t.type === 'WALLET_REFUND' && t.userId === usr0Id);
    const bountyToFallback = newTxns.filter(t => t.type === 'DRIVER_BOUNTY' && t.userId === drv0Id);
    check('ISR-11', 'a ticket whose customer does not resolve refunds nobody, and not users[0]',
      (!usr0 || usr0.walletBalance === refundBefore) && refundToFallback.length === 0,
      { before: refundBefore, after: usr0 && usr0.walletBalance, rowsToFallback: refundToFallback.length });
    check('ISR-12', 'a ticket whose driver does not resolve pays no bounty to drivers[0]',
      (!drv0 || drv0.walletBalance === bountyBefore) && bountyToFallback.length === 0,
      { before: bountyBefore, after: drv0 && drv0.walletBalance, rowsToFallback: bountyToFallback.length });

    // Drop this run's mirror rows so the in-process state stays as it was found.
    const ti = db.supportTickets.findIndex(t => t.id === ticketId);
    if (ti >= 0) db.supportTickets.splice(ti, 1);
    db.transactions.splice(txnLenBefore, db.transactions.length - txnLenBefore);
    db.auditLogs.splice(auditLenBefore, db.auditLogs.length - auditLenBefore);
    restoreWriters();

    // ================= Group C — media ownership is written durably =================
    PORT = await findFreePort();
    BASE = `http://127.0.0.1:${PORT}`;
    if (!isLoopback(BASE)) { console.error('MI-4 RESIDUAL REFUSED: non-loopback base ' + BASE); process.exit(1); }
    child = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname, stdio: 'ignore', windowsHide: true, env: { ...process.env, PORT: String(PORT) },
    });
    let up = false;
    for (let i = 0; i < 80; i++) {
      await sleep(250);
      const h = await request('GET', '/api/health', null, {}, 1500);
      if (h.status === 200) { up = true; break; }
    }
    if (!up) { console.error('FATAL: private backend never bound :' + PORT); process.exit(1); }

    const assetsBefore = await one('SELECT count(*)::int n FROM media_assets', []);

    const ghostVeh = await request('POST', '/api/driver/vehicle/photo', {
      driverId: GHOST_DRV, vehicleId: VEH_GHOST, photoType: 'exterior',
      fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png'
    });
    const ghostPid = ghostVeh.data && ghostVeh.data.asset && ghostVeh.data.asset.cloudinaryPublicId;
    // Under the unfixed tree this request answers 200 and persists a row naming an unrelated seeded
    // driver. Its public id carries this run's unique VEH_GHOST leaf, so it can only be this run's
    // own row — recorded here so cleanup deletes exactly what this call created.
    if (ghostPid && !createdPublicIds.includes(ghostPid)) createdPublicIds.push(ghostPid);
    const ghostWritten = (await one(
      'SELECT count(*)::int n FROM media_assets WHERE public_id LIKE $1', [`%${VEH_GHOST}%`])).n;
    check('ISR-13', 'POST /api/driver/vehicle/photo refuses a driverId that resolves to nobody',
      ghostVeh.status === 404, { status: ghostVeh.status, code: ghostVeh.data.code,
        echoedDriverId: ghostVeh.data.driver && ghostVeh.data.driver.id, fallbackDriver: drv0Id });
    check('ISR-14', 'that refused upload persisted no media asset',
      ghostWritten === 0, { rowsForThisVehicle: ghostWritten });

    // A legitimate driver session uploading its own vehicle photo must still work, and must be
    // resolved as itself rather than as whichever driver happens to be first in the fleet.
    await request('POST', '/api/auth/send-otp', { phone: ownRaw, role: 'DRIVER', purpose: 'LOGIN' });
    const ownSend = await request('POST', '/api/auth/send-otp', { phone: ownRaw, role: 'DRIVER', purpose: 'LOGIN' });
    const ownVerify = await request('POST', '/api/auth/verify-otp', {
      phone: ownRaw, otp: (ownSend.data && ownSend.data.testOtp) || '7729', role: 'DRIVER', purpose: 'LOGIN'
    });
    const ownToken = ownVerify.data && ownVerify.data.token;
    check('ISR-15', 'the fixture driver can still sign in over HTTP',
      ownVerify.status === 200 && !!ownToken, { status: ownVerify.status, code: ownVerify.data.code });

    const ownVeh = ownToken
      ? await request('POST', '/api/driver/vehicle/photo', {
          vehicleId: VEH_OWN, photoType: 'exterior', fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png'
        }, bearer(ownToken))
      : { status: 0, data: {} };
    const ownPid = ownVeh.data && ownVeh.data.asset && ownVeh.data.asset.cloudinaryPublicId;
    if (ownPid && !createdPublicIds.includes(ownPid)) createdPublicIds.push(ownPid);
    check('ISR-16', 'its own vehicle photo still succeeds and is resolved as itself, not drivers[0]',
      ownVeh.status === 200 && ownVeh.data.driver
        && String(ownVeh.data.driver.name || '').includes(String(STAMP))
        && ownVeh.data.driver.id !== drv0Id,
      { status: ownVeh.status, driverId: ownVeh.data.driver && ownVeh.data.driver.id,
        driverName: ownVeh.data.driver && ownVeh.data.driver.name, fallbackDriver: drv0Id });

    const otherVeh = ownToken
      ? await request('POST', '/api/driver/vehicle/photo', {
          driverId: drv0Id, vehicleId: VEH_OWN, photoType: 'interior',
          fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png'
        }, bearer(ownToken))
      : { status: 0, data: {} };
    check('ISR-17', 'a driver still cannot name another driver for a vehicle photo',
      otherVeh.status === 403 && otherVeh.data.code === 'DRIVER_MISMATCH',
      { status: otherVeh.status, code: otherVeh.data.code });

    if (SKIP_CUSTOMER_ROUTE) {
      skip('ISR-18', 'POST /api/customer/profile/photo refuses an unresolvable customerId',
        'opted out with ISR_SKIP_CUSTOMER_ROUTE=1. That is how a before-fix run avoids the upsert to '
        + 'nabin/users/<users[0].id>/avatar the unfixed route performs; the fixed answer is a 404 that '
        + 'persists nothing, which is what a regression run has to prove. The vehicle sibling is '
        + 'measured unconditionally at ISR-13/14.');
    } else {
      const ghostCust = await request('POST', '/api/customer/profile/photo', {
        customerId: GHOST_USR, fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png'
      });
      const custPid = ghostCust.data && ghostCust.data.asset && ghostCust.data.asset.cloudinaryPublicId;
      if (custPid && !createdPublicIds.includes(custPid)) createdPublicIds.push(custPid);
      check('ISR-18', 'POST /api/customer/profile/photo refuses a customerId that resolves to nobody',
        ghostCust.status === 404, { status: ghostCust.status, code: ghostCust.data.code,
          echoedUserId: ghostCust.data.user && ghostCust.data.user.id, fallbackUser: usr0Id });
    }

    const assetsAfter = await one('SELECT count(*)::int n FROM media_assets', []);
    check('ISR-19', 'the only media assets this run persisted are its own, by exact public id',
      assetsAfter.n - assetsBefore.n === createdPublicIds.length,
      { before: assetsBefore.n, after: assetsAfter.n, delta: assetsAfter.n - assetsBefore.n,
        owned: createdPublicIds.length });

    // ================= Group D — static guards on the sites left open =================
    // Honest label: these are source-shape assertions. The behavioural half of each is covered
    // above (money: ISR-01..08; status: ISR-09/10; ticket: ISR-11/12; media: ISR-13..19). The
    // guards hold the remaining read/uuid sites from reverting to the fallback helper.
    const serverSrc = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
    const dbSrc = fs.readFileSync(path.join(__dirname, 'src/database.js'), 'utf8');
    // Generalised, from the measured fact rather than a needle list. Nine specific spellings were
    // open when this group was written; what has to be pinned is the class — production code must
    // hold NO executable call of either fallback helper. Comment lines are dropped first (whole-line
    // and after an inline `//`), because the docs in both files describe the defect by name and must
    // not be counted as call sites. Line numbers are reported against the original file.
    const FALLBACK_CALL = /\b(?:db|this)\.(?:getDriver|getUser)\s*\(/;
    const fallbackCalls = (src) => {
      const lines = src.split('\n').map(l =>
        /^\s*(?:\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\/\/.*$/, ''));
      return lines.map((l, i) => FALLBACK_CALL.test(l) ? `${i + 1}: ${l.trim()}` : null)
        .filter(Boolean);
    };
    const offenders = [...fallbackCalls(serverSrc), ...fallbackCalls(dbSrc)];
    // The settlement's transaction row used to name a person by falling back to the seeded id
    // itself, so a ledger row could be booked to `usr_1` without anyone resolving to `usr_1`.
    const legacySentinel = dbSrc.includes("userId: user ? user.id : 'usr_1'");
    check('ISR-20', 'no parameter-resolved identity in server.js or database.js still uses the fallback helper',
      offenders.length === 0 && !legacySentinel, { offenders, legacySentinel });

    // The two documented dev-mirror read helpers each end in a first-element fallback, each also
    // answer `users[0]`/`drivers[0]` for an empty id, and one boot line binds the demo session
    // entity that way. Those five shapes are the whole inventory; anything else that resolves a
    // person by falling back to `[0]` is new exposure. Compared as trimmed text (not line numbers,
    // which drift) after comment lines are dropped.
    const ALLOWED_FALLBACKS = new Set([
      "this.activeSessions.set('usr_session_rahul', { token: 'usr_session_rahul', role: 'CUSTOMER', entityId: 'usr_1', entity: this.users[0] });",
      'if (!id) return this.drivers[0];',
      'return match || this.drivers[0];',
      'if (!id) return this.users[0];',
      'return found || this.users.find(u => u.id === id) || this.users[0];'
    ]);
    const fallbackLines = (src) => src.split('\n')
      .map(l => l.trim())
      .filter(l => /this\.(?:users|drivers)\[0\]/.test(l))
      .filter(l => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'));
    const dbFallbacks = fallbackLines(dbSrc);
    const serverFallbacks = fallbackLines(serverSrc);
    const unknown = [...dbFallbacks, ...serverFallbacks].filter(l => !ALLOWED_FALLBACKS.has(l));
    check('ISR-21', 'the first-element fallback inventory is exactly the five documented dev-mirror shapes',
      dbFallbacks.length === 5 && serverFallbacks.length === 0 && unknown.length === 0,
      { inDatabaseJs: dbFallbacks.length, inServerJs: serverFallbacks.length, unknown });
  } finally {
    restoreWriters();
    await scrub();
    await c.end();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  const skipped = results.filter(r => r.skipped);
  console.log(`\n=== MI-4 RESIDUAL IDENTITY SUBSTITUTION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed, ${skipped.length} skipped ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
