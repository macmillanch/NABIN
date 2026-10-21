'use strict';

// =========================================================================
// NABIN CUSTOMER IDENTITY DURABILITY — KYC-P1
//
// The customer identity review path is the authentication decision for the whole
// Customer app, and it is mirror-only. `reviewIdentityApplication`
// (src/database.js:3981-4142) mutates the in-memory application and user records,
// writes a durable AUDIT row saying APPROVED, and returns `success:true` — while
// `users.identity_status` never changes. Measured on the local store before this
// suite existed: 499 rows PENDING, 1 VERIFIED, 1 RESUBMISSION_REQUIRED, and
// `identity_documents` 0 rows. The only durable writers of that column are
// `UserRepository.create()` and `UserRepository.updateIdentityStatus()`, and both have
// zero callers — measured over the whole of backend/ with the sole exception of the
// definition itself. The second one is not reusable as written: it also sets
// `account_status` to SUSPENDED for a REJECTED identity, a policy no route, migration
// or client asks for, and this suite's GROUP H pins that no identity decision touches
// the account column.
//
// The consequence is one production line. `src/server.js:4400` is the platform's
// only identity gate:
//     if (user && user.identityStatus !== 'VERIFIED') return res.status(403)
// — and `user` comes from the session, whose entity is rebuilt on every boot by
// `initPostgres()`'s user hydration (src/database.js:1815-1850) from
// `users.identity_status`. So an approved customer can be refused a ride by the next
// process start, while the durable audit trail says they were verified. Approving
// somebody is not a decision the store has ever heard about.
//
// The correction asked for is one write in one place, plus one field brought in line:
//   - `reviewIdentityApplication` puts the decision into `users.identity_status` through the store
//     BEFORE it moves the mirror, and refuses with 503 when that write is refused. An approval that
//     the store never heard about is not a decision.
//   - `verifyAuthOtp` already reads the durable account row and syncs `accountStatus` from it, but
//     left `identityStatus` at whatever this process hydrated. A live second process therefore keeps
//     disagreeing with the store even after the decision is durable. Group C (C10–C12) asserts that
//     against a server booted BEFORE the decision and never restarted, so the fix has to make a
//     running process agree, not only a restarting one.
//
// `submitIdentityApplication` is deliberately NOT made durable by this suite. Its mirror path
// already drops the account to pending, and the gate at `server.js:4400` cannot tell 'PENDING' from
// 'REJECTED' — both refuse — so a durable submission write closes no access gap. What it would do
// is put that change onto the seeded demo accounts that `test_phase7_security.js` and
// `test_phase11_feature_control.js` submit through the route on every chain run, which is a shared
// record rewritten to make a display cleaner. The stale verdict is reported as GAP-KYC-04 instead.
//
// What must NOT change here:
//   - the APPROVE checklist refusal (`IDENTITY_APPROVAL_CHECKLIST_REQUIRED`) and the
//     reason requirements on REJECT / REQUEST_RESUBMISSION — an approval still needs
//     the three confirmations before anything is written anywhere;
//   - MI-4: an application naming nobody resolves to no account, the decision is still
//     recorded, and no other account is touched (`getUserStrict`, never `users[0]`);
//   - `MARK_UNDER_REVIEW`'s mirror semantics and `account_status`'s vocabulary — the
//     shipped CHECK allows only ACTIVE / SUSPENDED / BLOCKED
//     (supabase/migrations/001_central_schema.sql), so the mirror's 'REJECTED' /
//     'RESUBMISSION_REQUIRED' / 'UNDER_REVIEW' account values must never reach a write;
//   - `findByIdAsync`'s cache-first contract (Owner Decision 11 choice B, HYD-03/04).
//
// Deliberately NOT asserted, and recorded as NOT MEASURED with the reason:
//   - GAP-KYC-01: 'UNDER_REVIEW' has no durable representation. The shipped
//     `identity_status` CHECK allows PENDING, SUBMITTED, VERIFIED,
//     RESUBMISSION_REQUIRED, REJECTED — so this suite can only prove the writer
//     smuggles nothing illegal, not that the state is durable. That is a migration and
//     vocabulary decision.
//   - GAP-KYC-02: the application record itself is mirror-only. No
//     `identity_applications` table exists and `users` has no `current_application_id`
//     column (grep over supabase/migrations/001–049 returns nothing), so after a
//     restart the queue row, its reviewer lock and its reasons are gone even when the
//     verdict survives. Closing that needs a new migration plus census protection of
//     `identity_documents`, and is out of scope for a code-only correction.
//   - GAP-KYC-03: a raw Aadhaar/Voter number lives in `aadhaarNumberRaw` on the mirror
//     record with no retention rule or deletion path. This suite asserts no document row
//     is invented; minimisation is an owner decision.
//   - GAP-KYC-04: a resubmission clears the queue row but not a stale durable verdict, so
//     after a restart an applicant who was REJECTED and re-submitted is still shown as
//     rejected. Closing it properly means making the submission path durable, which
//     rewrites the seeded demo accounts two shipped chain suites submit against — see the
//     scope paragraph above. It refuses nobody anything they can do today: 'PENDING' and
//     'REJECTED' both fail the one gate.
//
// Runs only on the disposable isolated lane (`scripts/with_local_target.js` +
// `scripts/lane_check.js`), because `users` is a census-protected table. It refuses a
// non-loopback target before any socket opens. It calls no PostgreSQL function: RPCs
// are pinned to `SET search_path = public`, so an isolated link reaching one would
// write a SHARED table.
// =========================================================================

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'customer_identity_durability_test' });

const STAMP = Date.now();
const IDENTITY_VOCAB = ['PENDING', 'SUBMITTED', 'VERIFIED', 'RESUBMISSION_REQUIRED', 'REJECTED'];
const ACCOUNT_VOCAB = ['ACTIVE', 'SUSPENDED', 'BLOCKED'];
// The mirror's spelling of a durable 'PENDING' (database.js:1842, UserRepository.js:34).
const MIRROR_PENDING = 'IDENTITY_VERIFICATION_PENDING';
const CHECKLIST = { infoMatches: true, aadhaarValid: true, voterIdValid: true };

const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(name);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
}
function notMeasured(id, why) {
  skipped.push(id);
  console.log(`NOT MEASURED  ${id} — ${why}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, raw: data }); } });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function bootServer({ port, request, attempts = 240, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0' },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; } catch { /* not up yet */ }
  }
  return proc;
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', { bootstrapSecret: BOOTSTRAP_SECRET, username: ADMIN_USER, password: ADMIN_PASSWORD, name: 'Identity Durability Bootstrap Admin' });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

let pg = null;
async function countOf(table) {
  const r = await pg.query(`select count(*)::int as n from ${table}`);
  return r.rows[0].n;
}
async function durableIdentity(uuid) {
  const r = await pg.query('select identity_status, account_status from users where id = $1', [uuid]);
  if (!r.rows.length) return null;
  return { identityStatus: r.rows[0].identity_status, accountStatus: r.rows[0].account_status };
}
async function durableUserSnapshot() {
  const r = await pg.query('select id, identity_status, account_status from users');
  return new Map(r.rows.map((row) => [String(row.id), `${row.identity_status}|${row.account_status}`]));
}

const createdUserIds = [];
async function insertUser({ name, identityStatus, accountStatus }) {
  const id = crypto.randomUUID();
  const phone = `+91${STAMP}${createdUserIds.length}`;
  await pg.query(
    `insert into users (id, phone, name, email, dob, address, rating, wallet_balance,
                        identity_status, account_status)
     values ($1,$2,$3,$4,'1995-04-0${(createdUserIds.length % 9) + 1}','Aizawl',4.60,0.00,$5,$6)`,
    [id, phone, name, `kyc${STAMP}_${createdUserIds.length}@test.nabin.in`, identityStatus, accountStatus]);
  createdUserIds.push(id);
  return { id, phone, name };
}

// The two identity numbers every fixture submits. NABIN accepts no document upload, so
// the numbers are the whole submission.
const AADHAAR = '222233334445';
const VOTER = 'NABIN99';

/**
 * Fail every write the store would take for one table, and nothing else.
 *
 * The point of the seam is the channel, not the transport: whatever the writer uses, an
 * outage on the durable account row must become a refusal. Reads stay available — the shipped
 * durable-write idiom reads the row before it writes it (see the merchant approval at
 * `database.js:4390`), so failing reads too would produce a `not enrolled` refusal and prove
 * nothing about the outage path. A write method returns a builder that rejects when awaited,
 * exactly the way `settleAuthoritative` meets a client that cannot reach the host at all.
 */
function rejectingBuilder(message) {
  const builder = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (_onF, onR) => onR(new Error(message));
      return () => builder;
    },
  });
  return builder;
}

const WRITE_METHODS = ['update', 'insert', 'upsert', 'delete'];

function makeWriteFailingClient(real, table) {
  return (name) => {
    const target = real(name);
    if (name !== table) return target;
    return new Proxy(target, {
      get(obj, prop) {
        if (WRITE_METHODS.includes(prop)) {
          return () => rejectingBuilder('simulated durable write outage');
        }
        const value = obj[prop];
        return typeof value === 'function' ? value.bind(obj) : value;
      },
      set(obj, prop, value) { obj[prop] = value; return true; },
    });
  };
}

async function withUsersWriteFailing(fn) {
  const { supabaseAdmin } = require('./src/supabase');
  const real = supabaseAdmin.from.bind(supabaseAdmin);
  supabaseAdmin.from = makeWriteFailingClient(real, 'users');
  try {
    return await fn();
  } finally {
    supabaseAdmin.from = real;
  }
}

async function main() {
  const masked = (() => { try { const u = new URL(PG_TARGET.connectionString); return `${u.protocol}//${u.hostname}:${u.port}${u.pathname}`; } catch { return '(masked)'; } })();
  console.log('========================================================================');
  console.log('NABIN CUSTOMER IDENTITY DURABILITY TEST — KYC-P1');
  console.log(`  TARGET : ${masked} (loopback, proven by scripts/chain_target_guard.js)`);
  console.log(`  SUITE  : STAMP=${STAMP}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const baseline = {
    users: await countOf('users'),
    identityDocuments: await countOf('identity_documents'),
    jobs: await countOf('jobs'),
    orders: await countOf('orders'),
    payments: await countOf('payments'),
    auditLogs: await countOf('audit_logs'),
  };
  console.log(`  durable baselines: ${JSON.stringify(baseline)}\n`);

  // --- fixtures written BEFORE anything hydrates, so the in-process mirror, this run's
  //     child server and the restart server all read the same durable rows. One fixture per
  //     verdict and per refusal, so no group's evidence depends on another group's write.
  const fxApprove = await insertUser({ name: `KYC approve ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxReject = await insertUser({ name: `KYC reject ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxResubmit = await insertUser({ name: `KYC resubmit ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxUnderReview = await insertUser({ name: `KYC under review ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxHttp = await insertUser({ name: `KYC http ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxRouteRefuse = await insertUser({ name: `KYC route refuse ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxOutage = await insertUser({ name: `KYC outage ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  // Already durably REJECTED, and then resubmitted by GROUP G: a fix that blanket-updated
  // every row it touched, or that rewrote a verdict on submission, would show up here as a
  // moved row outside the reviewed set.
  const fxStaleVerdict = await insertUser({ name: `KYC stale verdict ${STAMP}`, identityStatus: 'REJECTED', accountStatus: 'ACTIVE' });
  const fxNoChecklist = await insertUser({ name: `KYC no checklist ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxBlankReason = await insertUser({ name: `KYC blank reason ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxUnknown = await insertUser({ name: `KYC unknown decision ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });
  const fxUntouched = await insertUser({ name: `KYC untouched ${STAMP}`, identityStatus: 'PENDING', accountStatus: 'ACTIVE' });

  // Taken AFTER the fixtures, so a fixture the suite never reviews is expected to sit still,
  // and GROUP I's "at least five of my own rows moved" is a real diff rather than the inserts
  // themselves.
  const snapshotBefore = await durableUserSnapshot();

  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  const request = makeRequest(base);
  const bootPromise = bootServer({ port, request });

  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');
  await db.initPostgres();

  assert('P0 the lane store is live PostgreSQL, so durability is a real write and not a mock',
    Boolean(isLivePostgres && supabaseAdmin), { isLivePostgres });

  /**
   * Submit in-process against a hydrated mirror user, with a run-unique application id.
   * `submitIdentityApplication` reuses `user.currentApplicationId` when it is told this is
   * a resubmission, so pinning it first removes the `APP-####` random mint and with it any
   * chance of landing on a seeded demo application and mutating somebody else's account.
   */
  async function submitFor(user, { appTag, resubmission = true } = {}) {
    const mirror = db.getUserStrict(user.id);
    if (mirror) mirror.currentApplicationId = `KYCDUR-${STAMP}-${appTag}`;
    return await db.submitIdentityApplication({
      userId: user.id,
      name: user.name,
      phone: user.phone,
      email: `${user.phone.replace('+', '')}@test.nabin.in`,
      dob: '1995-04-01',
      address: 'Aizawl',
      aadhaarNumber: AADHAAR,
      voterIdNumber: VOTER,
      isResubmission: resubmission,
    });
  }

  // The fixtures' phones are already unique durable rows, so `verifyAuthOtp` matches the
  // number and never takes its auto-provision INSERT path — GROUP I's footprint stays exact.
  async function sessionFor(req, user) {
    const res = await req('POST', '/api/auth/verify-otp', { phone: user.phone, otp: '7729', role: 'CUSTOMER' });
    return { token: res.data && res.data.token, status: res.status, body: res.data };
  }

  /**
   * Submit through the real route, so the application exists in THAT process's mirror.
   * `submitIdentityApplication` mints `APP-####` randomly when it is not told this is a
   * resubmission, so the mint is re-asked while the record it returns names somebody else:
   * landing on a seeded demo application would put this run's numbers on another account,
   * and the assertion says so rather than quietly reviewing the wrong row.
   */
  async function submitOverHttp(req, user, token) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await req('POST', '/api/identity/submit',
        { aadhaarNumber: AADHAAR, voterIdNumber: VOTER, name: user.name, address: 'Aizawl' }, bearer(token));
      const app = res.data && res.data.application;
      if (!app) return { failed: { status: res.status, body: res.data } };
      if (app.userId === user.id) return app;
    }
    return { failed: 'no application owned by this fixture after 4 submission attempts' };
  }

  // =====================================================================
  // GROUP A — the decision lands in the store
  // =====================================================================
  console.log('--- GROUP A: an identity decision is durable ---');
  const appApprove = (await submitFor(fxApprove, { appTag: 'APPROVE' })).application;
  const rApprove = await db.reviewIdentityApplication(appApprove.id, 'APPROVE', 'Details matched and both numbers checked.', CHECKLIST, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('A1 APPROVE still answers success with the application record', Boolean(rApprove && rApprove.success && rApprove.application), { success: rApprove && rApprove.success, code: rApprove && rApprove.code });
  assert('A2 APPROVE still moves the mirror record to VERIFIED', rApprove && rApprove.application && rApprove.application.status === 'VERIFIED', { status: rApprove && rApprove.application && rApprove.application.status });
  assert('A3 APPROVE still moves the mirror user to VERIFIED', rApprove && rApprove.user && rApprove.user.identityStatus === 'VERIFIED', { mirror: rApprove && rApprove.user && rApprove.user.identityStatus });
  const durApprove = await durableIdentity(fxApprove.id);
  assert('A4 APPROVE writes identity_status=VERIFIED to the durable users row',
    durApprove && durApprove.identityStatus === 'VERIFIED', { durable: durApprove });

  const appReject = (await submitFor(fxReject, { appTag: 'REJECT' })).application;
  const rReject = await db.reviewIdentityApplication(appReject.id, 'REJECT', 'The declared name does not match the numbers supplied.', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('A5 REJECT still answers success', Boolean(rReject && rReject.success), { success: rReject && rReject.success, error: rReject && rReject.error });
  assert('A6 REJECT writes identity_status=REJECTED to the durable users row',
    (await durableIdentity(fxReject.id)).identityStatus === 'REJECTED', { durable: await durableIdentity(fxReject.id) });

  const appResubmit = (await submitFor(fxResubmit, { appTag: 'RESUBMIT' })).application;
  const rResubmit = await db.reviewIdentityApplication(appResubmit.id, 'REQUEST_RESUBMISSION', 'Re-submit the Voter ID, the number was unreadable.', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('A7 REQUEST_RESUBMISSION still answers success', Boolean(rResubmit && rResubmit.success), { success: rResubmit && rResubmit.success, error: rResubmit && rResubmit.error });
  assert('A8 REQUEST_RESUBMISSION writes identity_status=RESUBMISSION_REQUIRED to the durable row',
    (await durableIdentity(fxResubmit.id)).identityStatus === 'RESUBMISSION_REQUIRED', { durable: await durableIdentity(fxResubmit.id) });

  // A durable 'VERIFIED' must read back as the mirror's 'VERIFIED', and a durable 'PENDING'
  // as 'IDENTITY_VERIFICATION_PENDING' — the mapping the shipped hydration already applies.
  assert('A9 the approved account reads back VERIFIED through the same lookup the gate uses',
    db.getUserStrict(fxApprove.id).identityStatus === 'VERIFIED', { served: db.getUserStrict(fxApprove.id).identityStatus });
  assert('A10 the not-yet-decided account still reads back as verification pending',
    db.getUserStrict(fxUntouched.id).identityStatus === MIRROR_PENDING, { served: db.getUserStrict(fxUntouched.id).identityStatus });

  // =====================================================================
  // GROUP B — the truth survives a restart (the gate's own field)
  // =====================================================================
  console.log('\n--- GROUP B: a second process, built only from the store, agrees ---');
  const port2 = await findFreePort();
  const base2 = `http://127.0.0.1:${port2}`;
  const request2 = makeRequest(base2);
  await bootServer({ port: port2, request: request2 });

  const sessApprove = await request2('POST', '/api/auth/verify-otp', { phone: fxApprove.phone, otp: '7729', role: 'CUSTOMER' });
  assert('B0 a fresh session was minted for the approved fixture on the restarted process',
    sessApprove.status === 200 && Boolean(sessApprove.data && sessApprove.data.token), { status: sessApprove.status, body: sessApprove.data });
  const meApprove = await request2('GET', '/api/auth/me', null, bearer(sessApprove.data && sessApprove.data.token));
  assert('B1 the restarted process reports the approved account as VERIFIED',
    meApprove.status === 200 && meApprove.data && meApprove.data.user && meApprove.data.user.identityStatus === 'VERIFIED',
    { status: meApprove.status, served: meApprove.data && meApprove.data.user && meApprove.data.user.identityStatus });
  const statusApprove = await request2('GET', `/api/identity/status/${fxApprove.id}`, null, bearer(sessApprove.data && sessApprove.data.token));
  assert('B2 GET /api/identity/status/:userId reports VERIFIED after a restart',
    statusApprove.status === 200 && statusApprove.data && statusApprove.data.user && statusApprove.data.user.identityStatus === 'VERIFIED',
    { status: statusApprove.status, served: statusApprove.data && statusApprove.data.user && statusApprove.data.user.identityStatus });

  const sessPending = await request2('POST', '/api/auth/verify-otp', { phone: fxUntouched.phone, otp: '7729', role: 'CUSTOMER' });
  const mePending = await request2('GET', '/api/auth/me', null, bearer(sessPending.data && sessPending.data.token));
  assert('B3 an undecided account is NOT reported verified by the restarted process',
    mePending.status === 200 && mePending.data && mePending.data.user && mePending.data.user.identityStatus === MIRROR_PENDING,
    { served: mePending.data && mePending.data.user && mePending.data.user.identityStatus });

  const serverSource = require('fs').readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const gateLines = serverSource.split(/\r?\n/).filter((l) => /identityStatus\s*!==\s*'VERIFIED'/.test(l));
  assert('B4 the identity gate is still the one production site, keyed on the durable-backed field',
    gateLines.length === 1, { gateLines });

  // =====================================================================
  // GROUP C — the real route round trip
  // =====================================================================
  console.log('\n--- GROUP C: submit + review over HTTP land durably ---');
  const proc = await bootPromise;
  const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('C0 the lane backend is up', health.status === 200, { status: health.status });
  const admin = await mintAdmin({ request });
  assert('C1 an admin session is minted', Boolean(admin.token), { status: admin.status, body: admin.body });

  const sessHttp = await sessionFor(request, fxHttp);
  assert('C2 the fixture customer has a session on the lane backend',
    sessHttp.status === 200 && Boolean(sessHttp.token), { status: sessHttp.status, body: sessHttp.body });

  const httpApp = await submitOverHttp(request, fxHttp, sessHttp.token);
  assert('C3 POST /api/identity/submit accepted the two numbers and created this account\'s application',
    Boolean(httpApp && httpApp.id && httpApp.userId === fxHttp.id),
    { application: httpApp && { id: httpApp.id, userId: httpApp.userId, status: httpApp.status }, failed: httpApp && httpApp.failed });

  const reviewRes = await request('POST', `/api/admin/identity-verifications/${httpApp.id}/review`,
    { decision: 'APPROVE', reason: 'Examiner confirmed the declared details and both numbers.', checklist: CHECKLIST }, bearer(admin.token));
  assert('C4 the admin review route answers 200 for a complete APPROVE',
    reviewRes.status === 200 && reviewRes.data && reviewRes.data.success === true,
    { status: reviewRes.status, body: reviewRes.data });
  assert('C5 the reviewed-through-HTTP account is VERIFIED in the durable row',
    (await durableIdentity(fxHttp.id)).identityStatus === 'VERIFIED', { durable: await durableIdentity(fxHttp.id) });

  // A refusal needs its own application in THIS process's mirror: an id that only the parent
  // harness created would be answered with 'Application not found', which is a 400 and would
  // let the checklist assertion pass for the wrong reason.
  const sessRefuse = await sessionFor(request, fxRouteRefuse);
  const refuseApp = await submitOverHttp(request, fxRouteRefuse, sessRefuse.token);
  assert('C6 the refusal fixture has its own application on the lane backend',
    Boolean(refuseApp && refuseApp.id && refuseApp.userId === fxRouteRefuse.id),
    { application: refuseApp && { id: refuseApp.id, userId: refuseApp.userId }, failed: refuseApp && refuseApp.failed });

  const noChecklist = await request('POST', `/api/admin/identity-verifications/${refuseApp.id}/review`,
    { decision: 'APPROVE', reason: 'Examiner confirmed the details but sent no checklist.' }, bearer(admin.token));
  assert('C7 an APPROVE without the checklist is refused at the route with its code',
    noChecklist.status === 400 && noChecklist.data && noChecklist.data.code === 'IDENTITY_APPROVAL_CHECKLIST_REQUIRED',
    { status: noChecklist.status, body: noChecklist.data });
  assert('C8 and that refusal left the durable row on its PENDING verdict',
    (await durableIdentity(fxRouteRefuse.id)).identityStatus === 'PENDING', { durable: await durableIdentity(fxRouteRefuse.id) });

  const anonReview = await request('POST', `/api/admin/identity-verifications/${httpApp.id}/review`, { decision: 'APPROVE' });
  assert('C9 the review route is still admin-authenticated', anonReview.status === 401 || anonReview.status === 403, { status: anonReview.status });

  /**
   * The second half of the fix, and the reason a restart test is not enough.
   *
   * `verifyAuthOtp` reads the durable account row on every login and already brings
   * `accountStatus` in line with it (src/database.js:7317), but leaves `identityStatus` at
   * whatever this process hydrated at boot. Process 2 booted in GROUP B — before this review
   * existed — and has not restarted since, so it is the only way to ask whether a running
   * process can be made to agree. A customer approved by another container must not have to
   * wait for this one to be replaced before this one believes the approval, because the gate
   * at src/server.js:4400 reads exactly this field off exactly this entity.
   */
  const sessLive = await sessionFor(request2, fxHttp);
  assert('C10 the never-restarted second process mints a session for the account the first one reviewed',
    sessLive.status === 200 && Boolean(sessLive.token), { status: sessLive.status, body: sessLive.body });
  const meLive = await request2('GET', '/api/auth/me', null, bearer(sessLive.token));
  assert('C11 a login on that running process reports the durable VERIFIED verdict, with no restart',
    meLive.status === 200 && meLive.data && meLive.data.user && meLive.data.user.identityStatus === 'VERIFIED',
    { status: meLive.status, served: meLive.data && meLive.data.user && meLive.data.user.identityStatus });

  // The sync must follow the store, not upgrade it: an account this run never decided is still
  // pending on the second process, or the fix would be a verification mint in disguise.
  const sessLivePending = await sessionFor(request2, fxRouteRefuse);
  const meLivePending = await request2('GET', '/api/auth/me', null, bearer(sessLivePending.token));
  assert('C12 and the same login does not report verified for an account the store still holds PENDING',
    meLivePending.status === 200 && meLivePending.data && meLivePending.data.user
      && meLivePending.data.user.identityStatus === MIRROR_PENDING,
    { status: meLivePending.status, served: meLivePending.data && meLivePending.data.user && meLivePending.data.user.identityStatus });

  // =====================================================================
  // GROUP D — MARK_UNDER_REVIEW smuggles nothing illegal
  // =====================================================================
  console.log('\n--- GROUP D: an illegal durable value is never written ---');
  const appUnderReview = (await submitFor(fxUnderReview, { appTag: 'UNDERREVIEW' })).application;
  const rUnder = await db.reviewIdentityApplication(appUnderReview.id, 'MARK_UNDER_REVIEW', 'Queued for a second look.', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('D1 MARK_UNDER_REVIEW still answers success and moves the mirror record',
    Boolean(rUnder && rUnder.success) && rUnder.application.status === 'UNDER_REVIEW',
    { success: rUnder && rUnder.success, status: rUnder && rUnder.application && rUnder.application.status });
  const durUnder = await durableIdentity(fxUnderReview.id);
  assert('D2 the durable row holds a value the shipped CHECK allows',
    durUnder && IDENTITY_VOCAB.includes(durUnder.identityStatus), { durable: durUnder });
  assert('D3 an unrepresentable state is not smuggled into the durable row',
    durUnder && durUnder.identityStatus !== 'UNDER_REVIEW', { durable: durUnder });
  notMeasured('GAP-KYC-01', "'UNDER_REVIEW' has no durable representation: the shipped "
    + "users.identity_status CHECK allows PENDING, SUBMITTED, VERIFIED, RESUBMISSION_REQUIRED, REJECTED "
    + '(supabase/migrations/001_central_schema.sql). This suite can prove the writer smuggles nothing illegal, '
    + 'not that the queue state survives a restart — that needs a migration and a vocabulary decision.');

  const allDurable = await pg.query('select identity_status, account_status, count(*)::int as n from users group by 1,2');
  const illegal = allDurable.rows.filter((r) => !IDENTITY_VOCAB.includes(r.identity_status) || !ACCOUNT_VOCAB.includes(r.account_status));
  assert('D4 no row in the whole users table was left holding an out-of-vocabulary value',
    illegal.length === 0, { illegal: illegal.slice(0, 5) });

  // =====================================================================
  // GROUP E — a store that cannot answer is a refusal, not a verification
  // =====================================================================
  console.log('\n--- GROUP E: fail closed when the durable write is refused ---');
  const appOutage = (await submitFor(fxOutage, { appTag: 'OUTAGE' })).application;
  const mirrorBeforeOutage = db.getUserStrict(fxOutage.id);
  const identityBeforeOutage = mirrorBeforeOutage && mirrorBeforeOutage.identityStatus;
  let thrown = null;
  try {
    await withUsersWriteFailing(() => db.reviewIdentityApplication(
      appOutage.id, 'APPROVE', 'Store is unreachable for this attempt.', CHECKLIST, 'admin_kyc_dur', 'KYC Durability Admin'));
  } catch (err) {
    thrown = err;
  }
  assert('E1 a refused durable approval throws instead of answering success', Boolean(thrown), { threw: Boolean(thrown) });
  assert('E2 the refusal carries the 503 AUTH_STORE_UNAVAILABLE channel',
    Boolean(thrown) && thrown.status === 503 && thrown.code === 'AUTH_STORE_UNAVAILABLE',
    { status: thrown && thrown.status, code: thrown && thrown.code, message: thrown && thrown.message });
  assert('E3 the durable row is unchanged after the refusal',
    (await durableIdentity(fxOutage.id)).identityStatus === 'PENDING', { durable: await durableIdentity(fxOutage.id) });
  const mirrorAfterOutage = db.getUserStrict(fxOutage.id);
  assert('E4 the mirror user was not moved past the failed decision',
    mirrorAfterOutage && mirrorAfterOutage.identityStatus === identityBeforeOutage,
    { before: identityBeforeOutage, after: mirrorAfterOutage && mirrorAfterOutage.identityStatus });
  assert('E5 the application record was not marked VERIFIED by a write that did not land',
    (db.getIdentityApplicationById(appOutage.id) || {}).status !== 'VERIFIED',
    { status: (db.getIdentityApplicationById(appOutage.id) || {}).status });
  const rRecovered = await db.reviewIdentityApplication(appOutage.id, 'APPROVE', 'Store is answering again.', CHECKLIST, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('E6 with the store available the same approval lands durably',
    Boolean(rRecovered && rRecovered.success) && (await durableIdentity(fxOutage.id)).identityStatus === 'VERIFIED',
    { success: rRecovered && rRecovered.success, durable: await durableIdentity(fxOutage.id) });

  // =====================================================================
  // GROUP F — a refusal writes nothing, to anyone
  // =====================================================================
  console.log('\n--- GROUP F: refusals have no durable footprint ---');
  const appNoChecklist = (await submitFor(fxNoChecklist, { appTag: 'NOCHECKLIST' })).application;
  const rNoChecklist = await db.reviewIdentityApplication(appNoChecklist.id, 'APPROVE', 'Missing the checklist.', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('F1 an approval without the checklist is refused',
    Boolean(rNoChecklist) && rNoChecklist.success === false && rNoChecklist.code === 'IDENTITY_APPROVAL_CHECKLIST_REQUIRED',
    { code: rNoChecklist && rNoChecklist.code });
  assert('F2 and the durable row is still PENDING',
    (await durableIdentity(fxNoChecklist.id)).identityStatus === 'PENDING', { durable: await durableIdentity(fxNoChecklist.id) });

  const appBlank = (await submitFor(fxBlankReason, { appTag: 'BLANK' })).application;
  const rBlank = await db.reviewIdentityApplication(appBlank.id, 'REJECT', '   ', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('F3 a rejection with no reason is refused and writes nothing durable',
    Boolean(rBlank) && rBlank.success === false && (await durableIdentity(fxBlankReason.id)).identityStatus === 'PENDING',
    { refused: Boolean(rBlank) && rBlank.success === false, durable: await durableIdentity(fxBlankReason.id) });

  const appUnknown = (await submitFor(fxUnknown, { appTag: 'UNKNOWN' })).application;
  const rUnknown = await db.reviewIdentityApplication(appUnknown.id, 'ESCALATE_TO_SUPERVISOR', 'not a decision', null, 'admin_kyc_dur', 'KYC Durability Admin');
  assert('F4 an unknown decision is refused and writes nothing durable',
    Boolean(rUnknown) && rUnknown.success === false && (await durableIdentity(fxUnknown.id)).identityStatus === 'PENDING',
    { error: rUnknown && rUnknown.error, durable: await durableIdentity(fxUnknown.id) });

  // MI-4: an application that names nobody still records its decision, and touches no account.
  const mi4Id = `KYCDUR-${STAMP}-MI4`;
  db.identityApplications.push({
    id: mi4Id, userId: 'no-such-user-for-kyc-durability', userName: 'Nobody', phone: `+91${STAMP}999`,
    email: '', dob: '', address: '', aadhaarNumberRaw: AADHAAR, aadhaarNumberMasked: 'XXXX-XXXX-1234',
    aadhaarDocUrl: null, aadhaarDocStatus: 'NO_DOCUMENT', voterIdNumberRaw: VOTER, voterIdNumberMasked: 'XXXX-99',
    voterIdDocUrl: null, voterIdDocStatus: 'NO_DOCUMENT', status: 'IDENTITY_VERIFICATION_PENDING',
    overallDocumentStatus: 'NO_DOCUMENT', assignedReviewerId: null, assignedReviewerName: null,
    lockedByAdminId: null, lockedByAdminName: null, lockedAt: null, reviewNotes: '', rejectionReason: '',
    resubmissionReason: '', priority: 'NORMAL', submissionDate: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const snapshotForMi4 = await durableUserSnapshot();
  const rMi4 = await db.reviewIdentityApplication(mi4Id, 'APPROVE', 'Recorded against an account that does not exist.', CHECKLIST, 'admin_kyc_dur', 'KYC Durability Admin');
  const snapshotAfterMi4 = await durableUserSnapshot();
  assert('F5 MI-4 is preserved: the decision on an application naming nobody is still recorded',
    Boolean(rMi4 && rMi4.success) && rMi4.application.status === 'VERIFIED',
    { success: rMi4 && rMi4.success, status: rMi4 && rMi4.application && rMi4.application.status });
  assert('F6 and no account record moved, because there was no account to move',
    sameSnapshot(snapshotForMi4, snapshotAfterMi4), {
      changed: [...diffSnapshot(snapshotForMi4, snapshotAfterMi4)].slice(0, 5),
    });

  // =====================================================================
  // GROUP G — a resubmission verifies nobody
  // =====================================================================
  console.log('\n--- GROUP G: resubmission is not a silent re-verification ---');
  assert('G0 the stale fixture starts durably REJECTED',
    (await durableIdentity(fxStaleVerdict.id)).identityStatus === 'REJECTED', { durable: await durableIdentity(fxStaleVerdict.id) });
  const appStale = (await submitFor(fxStaleVerdict, { appTag: 'STALE' })).application;
  assert('G1 a resubmission does not hand the account back a verified status',
    db.getUserStrict(fxStaleVerdict.id).identityStatus !== 'VERIFIED', { served: db.getUserStrict(fxStaleVerdict.id).identityStatus });
  assert('G2 and the resubmitted application is queued, not verified',
    appStale.status === MIRROR_PENDING, { status: appStale.status });
  assert('G3 the durable row still holds a value the shipped CHECK allows',
    IDENTITY_VOCAB.includes((await durableIdentity(fxStaleVerdict.id)).identityStatus),
    { durable: await durableIdentity(fxStaleVerdict.id) });
  notMeasured('GAP-KYC-04', 'submitIdentityApplication is mirror-only, so a resubmission clears the queue row but not a '
    + 'stale durable verdict: after a restart an applicant who was REJECTED and re-submitted is still reported as '
    + 'rejected. It refuses nobody anything they can do today, because PENDING and REJECTED both fail the one gate at '
    + 'server.js:4400, and making the submission durable would rewrite the seeded demo accounts that '
    + 'test_phase7_security.js and test_phase11_feature_control.js submit through the route on every chain run. '
    + 'Rewriting a shared record to clean up a display is an owner decision, not this suite\'s.');

  // =====================================================================
  // GROUP H — account_status is not this fix's to change
  // =====================================================================
  console.log('\n--- GROUP H: the account status is still the store\'s own value ---');
  const accountRows = [fxApprove, fxReject, fxResubmit, fxHttp, fxOutage, fxUnderReview,
    fxRouteRefuse, fxNoChecklist, fxBlankReason, fxUnknown];
  const accountChanged = [];
  for (const fx of accountRows) {
    const row = await durableIdentity(fx.id);
    if (!row || row.accountStatus !== 'ACTIVE') accountChanged.push({ id: fx.id, row });
  }
  assert('H1 no identity decision or refusal changed a durable account_status',
    accountChanged.length === 0, { changed: accountChanged.slice(0, 4) });

  // =====================================================================
  // GROUP I — footprint: this suite's rows are its only footprint
  // =====================================================================
  console.log('\n--- GROUP I: footprint ---');
  const usersNow = await countOf('users');
  assert('I1 exactly the users this run minted appeared',
    usersNow === baseline.users + createdUserIds.length, { usersNow, baseline: baseline.users, created: createdUserIds.length });

  const snapshotAfter = await durableUserSnapshot();
  const unintended = [];
  for (const [id, value] of snapshotAfter) {
    if (createdUserIds.includes(id)) continue;
    const before = snapshotBefore.get(id);
    if (before === undefined) { unintended.push({ id, before: '(new row)', after: value }); continue; }
    if (before !== value) unintended.push({ id, before, after: value });
  }
  assert('I2 no row outside this run\'s own fixtures moved',
    unintended.length === 0, { offenders: unintended.slice(0, 6), total: unintended.length });

  const ownChanged = createdUserIds.filter((id) => (snapshotBefore.get(id) || '') !== (snapshotAfter.get(id) || ''));
  assert('I3 the reviewed fixtures DID move, so I2 is a real diff and not an empty table',
    ownChanged.length >= 5, { moved: ownChanged.length, expectedAtLeast: 5 });

  assert('I4 no identity_documents row was invented for a submission',
    (await countOf('identity_documents')) === baseline.identityDocuments,
    { now: await countOf('identity_documents'), baseline: baseline.identityDocuments });
  notMeasured('GAP-KYC-02', 'the application record itself has no table: no identity_applications relation and no '
    + 'users.current_application_id column exist in supabase/migrations/001-049, so after a restart the queue row, its '
    + 'reviewer lock and its reasons are gone even where the verdict survives. Closing it needs a new migration, and '
    + 'identity_documents is not in scripts/protected_tables.js, so a row-count census cannot see it either.');
  notMeasured('GAP-KYC-03', 'aadhaarNumberRaw / voterIdNumberRaw are held on the mirror record with no retention rule '
    + 'and no deletion path. This suite only proves no document row is invented; minimising the numbers themselves is '
    + 'an owner decision (data classification, retention, DSAR).');

  assert('I5 this suite wrote no job, order or payment row',
    (await countOf('jobs')) === baseline.jobs && (await countOf('orders')) === baseline.orders && (await countOf('payments')) === baseline.payments,
    { jobs: await countOf('jobs'), orders: await countOf('orders'), payments: await countOf('payments') });
  const auditNow = await countOf('audit_logs');
  assert('I6 the audit trail only ever grew — no decision record was swept away',
    auditNow > baseline.auditLogs, { auditNow, baseline: baseline.auditLogs });

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}   NOT MEASURED: ${skipped.length}`);
  if (failed.length) { console.log('Failed checks:'); for (const n of failed) console.log(`  - ${n}`); }
  if (skipped.length) { console.log('Not measured:'); for (const n of skipped) console.log(`  - ${n}`); }
  console.log(`CUSTOMER IDENTITY DURABILITY TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  void proc;
  process.exitCode = failed.length ? 1 : 0;
}

function sameSnapshot(a, b) {
  return diffSnapshot(a, b).length === 0;
}
function diffSnapshot(a, b) {
  const out = [];
  const ids = new Set([...a.keys(), ...b.keys()]);
  for (const id of ids) {
    if ((a.get(id) || '(absent)') !== (b.get(id) || '(absent)')) out.push(`${id}: ${a.get(id) || '(absent)'} -> ${b.get(id) || '(absent)'}`);
  }
  return out;
}

async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (createdUserIds.length) {
      await pg.query('delete from users where id = any($1::uuid[])', [createdUserIds]);
    }
    const left = await pg.query('select count(*)::int as n from users where id = any($1::uuid[])', [createdUserIds]);
    console.log(`[cleanup] this run's user rows still present: ${left.rows[0].n}`);
  } catch (e) {
    console.error('[CLEANUP FAILED] residue may remain:', e.message);
  }
}

(async function run() {
  try {
    await main();
  } catch (err) {
    console.error('[SUITE ERROR]', err && err.stack ? err.stack : err);
    process.exitCode = 1;
  } finally {
    await cleanup();
    process.exit(process.exitCode || 0);
  }
})();
