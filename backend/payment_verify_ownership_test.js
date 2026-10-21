'use strict';

// =========================================================================
// NABIN — P0 SECURITY: POST /api/payments/verify-checkout OWNERSHIP (MI-8)
//
// A payment session is the record immediately before money moves, and this route can write
// its durable status. Two of its three branches — the client-reported FAILED and CANCELLED
// ones — require NO gateway signature at all: they are trusted reports about the customer's
// own checkout modal. That makes the ownership check the ONLY thing standing between one
// customer's session row and somebody else's pen.
//
// The rule it enforces:
//   * a CUSTOMER may report FAILED/CANCELLED on a session bound to their own resolved uuid;
//   * a session whose owner binding cannot be resolved is refused — ownership that cannot be
//     proven is not ownership, exactly the policy link 81 (`payment_session_role_test.js`)
//     pins for the READ half of the same record;
//   * a bearer whose own identity cannot be resolved is refused;
//   * a refusal writes nothing durable and leaves no audit row;
//   * the capture half stays signature-gated: ownership is checked before the HMAC, and no
//     client-supplied `success`/`status` field can make a session paid.
//
// Why this is a class, not a row: `PaymentRepository.verifyPaymentSession` guarded ownership
// with `if (callerUuid && sessionUuid && callerUuid !== sessionUuid)`, so the comparison was
// skipped whenever EITHER side failed to resolve — `resolveCustomerUuid` returns null for a
// handle that is neither a uuid nor a mapped/seeded account, and `payment_sessions.customer_id`
// is NULLABLE, so the store holds rows whose owner cannot be named. This is the third measured
// instance of the same shape (MI-1 read route, MI-7 support thread, here the money write), and
// it is why both the resolvable stranger and the unresolvable side are asserted below: a fix
// that only closes the pair that happened to be observable would leave the shape in place.
//
// What is NOT claimed here: this route's bearer gate is already role-bound — `authenticateUser`
// refuses any session whose role is not CUSTOMER, so unlike the MI-1 read route a DRIVER or
// MERCHANT token never reaches the repository. That is asserted (PVO-14/PVO-22) so the next
// reader does not re-open it. The SUCCESS branch is already fail-closed on `PAYMENT_KEY_SECRET`
// with a constant-time HMAC over `orderId|paymentId` and it is untouched by this fix; it is
// pinned (PVO-12/PVO-13) rather than re-derived, and this suite performs NO capture, so it
// mints no money rows — the paid path is link 48's job.
//
// Targets LOCAL Docker Postgres only: `chain_target_guard` throws at load on a non-loopback
// target and the live-Postgres check refuses a store where the durable assertions below would
// be about nothing (on the mock branch the ownership comparison is a plain id equality). Every
// row this suite mints is deleted by its own `order_id`, and its ghost session rows by their
// `token_hash`. What deliberately stays is the same residue link 81 and 83 keep and the census
// attributes: the `backend_sessions` rows minted by signing in as the SHARED seeded customers
// (their tokens live in `.nabin_test_sessions.json` and other links reuse them), and the
// append-only `audit_logs` rows the legitimate owner-reported FAILED/CANCELLED writes produce
// on this suite's own order ids (migration 022/001 make that trail insert-only).
// =========================================================================

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('./testSessionCache');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const targetGuard = require('./scripts/chain_target_guard');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'payment_verify_ownership_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — payment_verify_ownership_test must run against a LIVE Postgres target so the');
  console.error('durable session-status assertions mean something. Run it under');
  console.error('`node scripts/with_local_target.js node payment_verify_ownership_test.js`.');
  process.exit(2);
}

const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';

// Identities already seeded in the local development store (the same fixtures links 81 and 83 use).
const CUST_A_PHONE = '9845011982';                       // Priya Saxena — the session owner
const CUST_B_PHONE = '9876543210';                       // Rahul Sharma — a proven stranger

const STAMP = Date.now().toString(36);
// An `entity_id` that names no account, run-unique so nothing here can alias a real users row.
const GHOST_HANDLE = `PVO-GHOST-${STAMP}`;
// Text only the owner can cause to be stored, so a stranger's write is identifiable by content.
const OWNER_REASON = `PVO-${STAMP}-owner-declined`;
const GHOST_REASON = `PVO-${STAMP}-ghost-declined`;
const STRANGER_REASON = `PVO-${STAMP}-stranger-declined`;

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const normPhone = (v) => String(v || '').replace(/\D/g, '').slice(-10);

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

async function bootServer({ port, request, attempts = 60, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off' },
  }));
  proc.unref();
  const deadline = Date.now() + attempts * delayMs + 15000;
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) break;
  }
  return proc;
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Payment Verify Ownership Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return res.data && res.data.token;
}

let pg = null;
// The row the route actually wrote, straight from the store — the response body is not evidence.
async function sessionRow(orderId) {
  const r = await pg.query(
    'select order_id, customer_id, amount, status, failure_reason from payment_sessions where order_id = $1',
    [orderId]);
  return r.rows[0] || null;
}
// The audit trail is written fire-and-forget (`db.createAuditLog` is not awaited), so a check
// that it stayed empty has to wait for the race it is judging rather than assume it lost.
async function auditRowsFor(orderId, { waitMs = 2500 } = {}) {
  const deadline = Date.now() + waitMs;
  let rows = [];
  for (;;) {
    rows = (await pg.query('select id, action, admin_id, new_state from audit_logs where target_entity_id = $1', [orderId])).rows;
    if (rows.length || Date.now() >= deadline) return rows;
    await sleep(250);
  }
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN PAYMENT VERIFY OWNERSHIP TEST — P0 MI-8 session-status write guard');
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(process.env.DATABASE_URL)}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const beforeSessions = (await pg.query('select count(*)::int n from payment_sessions')).rows[0].n;

  // The two seeded customers' real bindings, discovered rather than assumed. A phone that names
  // more than one row cannot identify an owner, so only unambiguous ones are usable.
  const allUsers = (await pg.query('select id::text id, phone from users')).rows;
  const byPhone = new Map();
  for (const u of allUsers) byPhone.set(normPhone(u.phone), (byPhone.get(normPhone(u.phone)) || 0) + 1);
  const identity = (phone) => {
    if (byPhone.get(phone) !== 1) return null;
    return allUsers.filter(u => normPhone(u.phone) === phone)[0] || null;
  };
  const custA = identity(CUST_A_PHONE);
  const custB = identity(CUST_B_PHONE);
  if (!custA || !custB || custA.id === custB.id) {
    console.error('PVO ABORT: this store does not hold two distinct seeded customers to test against');
    process.exitCode = 1; await pg.end(); return;
  }
  // The phone exactly as the store holds it, because `customerSessionRefusal` matches on it.
  const custBPhoneRaw = custB.phone;

  // --- ghost session rows: inserted BEFORE boot so the server hydrates them the way it hydrates
  // any session an earlier build persisted. Each carries an `entity` (which is what makes
  // `restoreSession` adopt it) and an `entity_id` that names no account. `GHOST_WITH_PHONE` is the
  // one that reaches the repository: its phone matches an ACTIVE account, so the bearer gate's own
  // account check passes while `resolveCustomerUuid` still answers null for the handle.
  const ghostTokens = {};
  const ghostHashes = [];
  const GHOSTS = {
    WITH_PHONE: { handle: GHOST_HANDLE, phone: custBPhoneRaw },
    NO_PHONE: { handle: `PVO-GHOST-NOPHONE-${STAMP}`, phone: null },
  };
  for (const [key, g] of Object.entries(GHOSTS)) {
    const token = `pvo_ghost_${key.toLowerCase()}_${STAMP}_${crypto.randomBytes(16).toString('base64url')}`;
    const hash = sha256(token);
    ghostTokens[key] = token;
    ghostHashes.push(hash);
    await pg.query(`
      INSERT INTO backend_sessions (token_hash, role, entity_id, phone, entity, expires_at)
      VALUES ($1, 'CUSTOMER', $2, $3, $4::jsonb, now() + interval '1 day')
      ON CONFLICT (token_hash) DO NOTHING`,
      [hash, g.handle, g.phone, JSON.stringify({ id: g.handle, name: 'Ghost Customer Bearer' })]);
  }

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  const login = createLogin({ baseUrl: BASE, request });

  // order_ids this suite owns, deleted by name in the finally block.
  const minted = [];
  async function openSession({ token, amount }) {
    const res = await request('POST', '/api/payments/create-order', {
      amount, currency: 'INR', serviceType: 'RIDE',
    }, bearer(token));
    const orderId = res.data && res.data.session && res.data.session.orderId;
    if (orderId) minted.push(orderId);
    return { res, orderId };
  }

  let proc = null;
  try {
    proc = await bootServer({ port, request });
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    assert('PVO-00 backend (this run started it) is healthy on its private port', health.status === 200, { port });

    const adminToken = await mintAdmin({ request });
    const a = await login(CUST_A_PHONE, 'CUSTOMER');
    const b = await login(CUST_B_PHONE, 'CUSTOMER');
    assert('PVO-01 admin session minted', Boolean(adminToken));
    assert('PVO-02 customer A authenticated', Boolean(a.token), a.failure || {});
    assert('PVO-03 customer B authenticated', Boolean(b.token), b.failure || {});
    if (!a.token || !b.token || !adminToken) throw new Error('identity setup incomplete; cannot test authorization');

    // ============================ the legitimate owner path ============================
    const ownCancel = await openSession({ token: a.token, amount: 250.0 });
    assert('PVO-04 customer A opens a payment session (HTTP 200)',
      ownCancel.res.status === 200 && ownCancel.res.data.success === true && Boolean(ownCancel.orderId), ownCancel.res.data);
    const fixture = await sessionRow(ownCancel.orderId);
    assert('PVO-05 durable row binds the session to customer A\'s uuid and starts unpaid',
      Boolean(fixture) && String(fixture.customer_id) === custA.id && fixture.status === 'INITIATED', fixture);

    const ownerCancel = await request('POST', '/api/payments/verify-checkout', {
      orderId: ownCancel.orderId, status: 'CANCELLED',
    }, bearer(a.token));
    assert('PVO-06 the OWNER may report CANCELLED on their own session (HTTP 200, not success)',
      ownerCancel.status === 200 && ownerCancel.data && ownerCancel.data.success === false,
      { status: ownerCancel.status, body: ownerCancel.data });
    const afterOwnerCancel = await sessionRow(ownCancel.orderId);
    assert('PVO-07 the owner report is what wrote the durable CANCELLED status',
      Boolean(afterOwnerCancel) && afterOwnerCancel.status === 'CANCELLED', afterOwnerCancel);

    const ownFail = await openSession({ token: a.token, amount: 260.0 });
    const ownerFail = await request('POST', '/api/payments/verify-checkout', {
      orderId: ownFail.orderId, status: 'FAILED', failureReason: OWNER_REASON,
    }, bearer(a.token));
    const afterOwnerFail = await sessionRow(ownFail.orderId);
    assert('PVO-08 the OWNER may report FAILED on their own session and it lands durably',
      ownerFail.status === 200 && Boolean(afterOwnerFail) && afterOwnerFail.status === 'FAILED'
      && afterOwnerFail.failure_reason === OWNER_REASON,
      { status: ownerFail.status, row: afterOwnerFail });

    // ============================ a proven stranger ============================
    const target = await openSession({ token: a.token, amount: 270.0 });
    const strangerCancel = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, status: 'CANCELLED', failureReason: STRANGER_REASON,
    }, bearer(b.token));
    assert('PVO-09 another CUSTOMER reporting CANCELLED on A\'s session is refused (HTTP 403)',
      strangerCancel.status === 403 && !(strangerCancel.data && strangerCancel.data.session),
      { status: strangerCancel.status, code: strangerCancel.data && strangerCancel.data.code });

    const strangerFail = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, status: 'FAILED', failureReason: STRANGER_REASON,
    }, bearer(b.token));
    assert('PVO-10 another CUSTOMER reporting FAILED on A\'s session is refused (HTTP 403)',
      strangerFail.status === 403, { status: strangerFail.status, code: strangerFail.data && strangerFail.data.code });

    const afterStranger = await sessionRow(target.orderId);
    assert('PVO-11 the stranger refusals changed nothing durable (still INITIATED, no injected reason)',
      Boolean(afterStranger) && afterStranger.status === 'INITIATED' && afterStranger.failure_reason !== STRANGER_REASON,
      afterStranger);

    // ============================ capture stays signature-gated ============================
    const strangerCapture = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, paymentId: `pay_pvo_forged_${STAMP}`, signature: 'sig_forged', status: 'SUCCESS',
    }, bearer(b.token));
    assert('PVO-12 ownership is checked BEFORE the signature: a stranger gets 403, not 400',
      strangerCapture.status === 403,
      { status: strangerCapture.status, code: strangerCapture.data && strangerCapture.data.code });

    const ownerBadSig = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, paymentId: `pay_pvo_forged_${STAMP}`, signature: 'sig_forged', status: 'SUCCESS',
    }, bearer(a.token));
    assert('PVO-13 the owner cannot force capture without a valid HMAC (400 INVALID_SIGNATURE)',
      ownerBadSig.status === 400 && ownerBadSig.data && ownerBadSig.data.code === 'INVALID_SIGNATURE',
      { status: ownerBadSig.status, code: ownerBadSig.data && ownerBadSig.data.code });

    const adminVerify = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, status: 'CANCELLED',
    }, bearer(adminToken));
    assert('PVO-14 the checkout channel is customer-only: an admin bearer is refused (401/403)',
      adminVerify.status === 401 || adminVerify.status === 403,
      { status: adminVerify.status, body: adminVerify.data });

    const anonVerify = await request('POST', '/api/payments/verify-checkout', {
      orderId: target.orderId, status: 'CANCELLED',
    });
    assert('PVO-15 anonymous verify is refused (HTTP 401)', anonVerify.status === 401, anonVerify.data);

    // ============================ THE DEFECT: an unprovable owner ============================
    // `payment_sessions.customer_id` is NULLABLE, so the store does hold rows whose owner cannot
    // be named — the same fact link 81 pinned for reads. Ownership must fail closed there too.
    const ownerlessId = `order_rzp_test_ownerless_${STAMP}`;
    minted.push(ownerlessId);
    await pg.query(`
      INSERT INTO payment_sessions (order_id, customer_id, amount, currency, service_type, status, provider, key_id, metadata)
      VALUES ($1, NULL, 280.0, 'INR', 'RIDE', 'INITIATED', 'RAZORPAY_SANDBOX', 'key_test', '{}'::jsonb)`,
      [ownerlessId]);
    const ownerlessBefore = await sessionRow(ownerlessId);
    assert('PVO-16 the ownerless fixture row exists with no customer binding',
      Boolean(ownerlessBefore) && ownerlessBefore.customer_id === null && ownerlessBefore.status === 'INITIATED',
      ownerlessBefore);

    const ownerlessFail = await request('POST', '/api/payments/verify-checkout', {
      orderId: ownerlessId, status: 'FAILED', failureReason: STRANGER_REASON,
    }, bearer(b.token));
    assert('PVO-17 a CUSTOMER may not report FAILED on a session with no resolvable owner (HTTP 403)',
      ownerlessFail.status === 403, {
        status: ownerlessFail.status,
        code: ownerlessFail.data && ownerlessFail.data.code,
        body: ownerlessFail.status === 200 ? ownerlessFail.data : undefined,
      });
    const ownerlessAfter = await sessionRow(ownerlessId);
    assert('PVO-18 the refused ownerless write changed nothing durable',
      Boolean(ownerlessAfter) && ownerlessAfter.status === 'INITIATED' && ownerlessAfter.failure_reason !== STRANGER_REASON,
      ownerlessAfter);
    const ownerlessAudit = await auditRowsFor(ownerlessId);
    assert('PVO-19 the refused ownerless write left no audit trail naming that order',
      ownerlessAudit.length === 0, { rows: ownerlessAudit });

    // ============================ THE CLASS: an unresolvable bearer ============================
    // A persisted session row whose `entity_id` names no account: the bearer gate accepts it
    // because the row's phone matches an active account, while `resolveCustomerUuid` answers null
    // for the handle — so the old guard skipped and a stranger wrote into A's session.
    const ghostTarget = await openSession({ token: a.token, amount: 290.0 });
    const ghostFail = await request('POST', '/api/payments/verify-checkout', {
      orderId: ghostTarget.orderId, status: 'FAILED', failureReason: GHOST_REASON,
    }, bearer(ghostTokens.WITH_PHONE));
    assert('PVO-20 a bearer whose identity cannot be resolved is refused (HTTP 403)',
      ghostFail.status === 403, {
        status: ghostFail.status,
        code: ghostFail.data && ghostFail.data.code,
        note: 'if this is 200 the guard vanished because callerUuid was null',
        body: ghostFail.status === 200 ? ghostFail.data : undefined,
      });
    const ghostAfter = await sessionRow(ghostTarget.orderId);
    assert('PVO-21 the unresolvable bearer wrote nothing into customer A\'s session',
      Boolean(ghostAfter) && ghostAfter.status === 'INITIATED' && ghostAfter.failure_reason !== GHOST_REASON,
      ghostAfter);

    // The sibling half: a ghost with no phone at all is already refused by the bearer gate itself.
    const ghostNoPhone = await request('POST', '/api/payments/verify-checkout', {
      orderId: ghostTarget.orderId, status: 'FAILED', failureReason: GHOST_REASON,
    }, bearer(ghostTokens.NO_PHONE));
    assert('PVO-22 a session naming no addressable account is refused by the bearer gate (403/401)',
      ghostNoPhone.status === 403 || ghostNoPhone.status === 401,
      { status: ghostNoPhone.status, code: ghostNoPhone.data && ghostNoPhone.data.code });

    // ============================ the fix must not lock the door ============================
    const afterFix = await openSession({ token: a.token, amount: 300.0 });
    const ownerStillWorks = await request('POST', '/api/payments/verify-checkout', {
      orderId: afterFix.orderId, status: 'CANCELLED',
    }, bearer(a.token));
    const afterFixRow = await sessionRow(afterFix.orderId);
    assert('PVO-23 an owner with a resolvable binding still completes their own checkout report',
      ownerStillWorks.status === 200 && Boolean(afterFixRow) && afterFixRow.status === 'CANCELLED',
      { status: ownerStillWorks.status, row: afterFixRow });

    const paid = minted.filter(Boolean);
    const anyPaid = (await pg.query(
      "select order_id, status from payment_sessions where order_id = any($1) and status = 'SUCCESS'",
      [paid])).rows;
    assert('PVO-24 nothing this run touched reached a paid status (no capture without a valid HMAC)',
      anyPaid.length === 0, { anyPaid });

    console.log('\n--- RESULT ---');
  } finally {
    try {
      if (minted.length) {
        const del = await pg.query('delete from payment_sessions where order_id = any($1)', [minted]);
        console.log(`\n[cleanup] deleted ${del.rowCount} of ${minted.length} tracked payment_sessions row(s) this run minted`);
      }
      if (ghostHashes.length) {
        const del = await pg.query('delete from backend_sessions where token_hash = any($1)', [ghostHashes]);
        console.log(`[cleanup] deleted ${del.rowCount} of ${ghostHashes.length} ghost backend_sessions row(s) this run inserted`);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP FAILED] residue may remain:', cleanupErr.message);
    }

    console.log('\n================ SUMMARY ================');
    const afterSessions = (await pg.query('select count(*)::int n from payment_sessions').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    console.log(`payment_sessions rows: before ${beforeSessions}, after cleanup ${afterSessions}`);
    console.log(`=== PAYMENT VERIFY OWNERSHIP: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed ===`);
    console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const f of failed) console.log(`  - ${f}`);
    }

    stopProc(proc);
    await pg.end();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch(async (err) => {
  console.error('payment_verify_ownership_test harness error:', err && err.stack || err);
  try { if (pg) await pg.end(); } catch { /* noop */ }
  process.exit(1);
});
