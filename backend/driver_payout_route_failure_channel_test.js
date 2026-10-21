/*
 * MI-3 (P0) — the driver-facing payout route must answer a thrown store failure, not hang.
 *
 * The defect and the standard it is held to:
 *   - LedgerRepository.adjustWallet THROWS code IDEMPOTENCY_CONFLICT when one key is reused with
 *     different financial semantics (locked by money_idempotency_conflict_test.js), and throws
 *     storeFailure on a genuine outage. database.js:recordPayout awaits it with no catch
 *     (database.js:4664), so the rejection leaves recordPayout and propagates to the route.
 *   - POST /api/driver/payout awaited `db.recordPayout(...)` with NO try/catch. This backend runs
 *     Express 4.22.2, which does NOT forward a rejected async handler to an error middleware, so
 *     on that throw the request never gets a response: the money socket just hangs. The caller
 *     gets no status, no classification, and no way to know whether money moved.
 *   - The sibling admin payout route (server.js ~2417) already wraps the identical call and its
 *     comment states the hazard verbatim: "awaiting it without a guard would let a rejected store
 *     call hang the request - Express 4 does not forward async rejections." It answers 409 for a
 *     conflict and 503 for a genuine unknown. POST /api/finance/refund answers 409 too (RAF-11).
 *   - This suite proves the driver route reaches that same failure channel: a key reused with a
 *     different amount is ANSWERED (HTTP 409 IDEMPOTENCY_CONFLICT) within a bounded window rather
 *     than hanging, and it moves no money. The 503-for-a-real-outcome-unknown branch is present by
 *     construction — the route special-cases only IDEMPOTENCY_CONFLICT and leaves every other
 *     throw on the 503 path — and the repo-level outage is driven separately by
 *     driver_operations_test.js OPS-5x, so this run does not fake a store outage.
 *
 * Money-safety is asserted from durable state only (the `drivers.wallet_balance` row), never from
 * a response body. A disposable driver created by this run; no historical financial row touched.
 * Local/test only: refuses any non-loopback backend or database, and runs against the LOCAL store
 * via scripts/with_local_target.js.
 */
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

// The suite moves real money, so it must target an explicit, local store. DATABASE_URL comes
// from scripts/with_local_target.js; there is no hardcoded fallback credential.
const PG = process.env.DATABASE_URL;
const STAMP = Date.now();
const KEY = `DPF:${STAMP}`;
// A private, provably-free port. A pid-derived port can collide with an orphan backend from an
// earlier run (the Windows kill in the finally below is not always honored), and the health poll
// would then answer from that foreign server instead of the one this run spawned - which is
// exactly how a fresh, uncooled driver appeared to return PAYOUT_DESTINATION_COOLING_ACTIVE.
// Binding port 0 makes the OS hand back a free ephemeral port, so no other listener can be there.
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

// Fail-closed on the target before touching anything: this suite moves real money, so it must
// reach only the local Docker stack.
const isLoopback = (u) => {
  let host; try { host = new URL(u).hostname; } catch (e) { return false; }
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(host);
};
if (!PG || !isLoopback(PG)) {
  console.error('DRIVER PAYOUT ROUTE REFUSED: non-loopback target'); process.exit(1);
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 220)}` : ''));
}
function skip(id, name, reason) {
  results.push({ id, pass: true, skipped: true });
  console.log(`[SKIP] ${id} ${name} -> ${reason}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, urlPath, body, headers = {}, timeoutMs = 6000) {
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
        let json = null; try { json = data ? JSON.parse(data) : {}; } catch (e) { json = { raw: data.slice(0, 160) }; }
        resolve({ status: res.statusCode, data: json || {} });
      });
    });
    // The whole point of MI-3 is that a hang is indistinguishable from a slow success to a caller
    // that never set a deadline. So the harness MUST carry one: a timeout here resolves with
    // status 0 / hung true, which is what DPF proves the unfixed route does.
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, hung: true, data: {} }); });
    req.on('error', (e) => resolve({ status: 0, error: e.code || e.message, data: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('DPF-ALL', 'driver payout route failure channel', 'needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  // ---- boot a private backend against the local store (inherited env from the wrapper) ----
  let child = null;
  try {
    // Pick a free ephemeral port NOW and bind our own server to it, so the health poll below can
    // only ever be answered by the backend this run spawned - never an orphan from a prior run.
    PORT = await findFreePort();
    BASE = `http://127.0.0.1:${PORT}`;
    if (!isLoopback(BASE)) { console.error('DRIVER PAYOUT ROUTE REFUSED: non-loopback base ' + BASE); process.exit(1); }
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

    const c = new Client({ connectionString: PG });
    await c.connect();
    const one = async (sql, p) => (await c.query(sql, p)).rows[0];
    const wallet = async (id) => Number((await one(
      'SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [id])).w);

    // ---- a disposable VERIFIED driver that satisfies every recordPayout gate ----
    //
    // The phones are stored in the SAME shape database.js normalizePhone() produces for a login
    // (`+91` + 10 digits), because the OTP path looks the account up with
    // `.eq('phone', normPhone)`. A bare 10-digit row is not found, the session is minted with no
    // entity, and `getDriver('anon')` falls back to `this.drivers[0]` — the seeded demo driver. The
    // suite would then pay (or refuse) a historical driver while asserting on its own fixture, so
    // the hang it means to prove is never reached. DPF-01b below pins that resolution.
    const usrPhone = `+9172${String(STAMP).slice(-8)}`;
    const usr = await supabaseAdmin.from('users').insert({
      name: `Driver payout route user ${STAMP}`, phone: usrPhone
    }).select('id').single();
    if (usr.error || !usr.data) { console.error('FATAL: user insert refused: ' + JSON.stringify(usr.error)); process.exit(1); }
    const drvPhone = `+9171${String(STAMP).slice(-8)}`;
    const drv = await supabaseAdmin.from('drivers').insert({
      user_id: usr.data.id, name: `Driver payout route ${STAMP}`, phone: drvPhone,
      vehicle_type: 'AUTO', vehicle_number: `DP${String(STAMP).slice(-6)}`, operational_status: 'AVAILABLE',
      wallet_balance: 5000, kyc_status: 'VERIFIED', payout_upi_verified: true,
      verified_upi_id: `dpf.${STAMP}@okhdfcbank`
    }).select('id').single();
    if (drv.error || !drv.data) { console.error('FATAL: driver insert refused: ' + JSON.stringify(drv.error)); process.exit(1); }
    const drvId = drv.data.id;

    // ---- a real DRIVER session, minted over OTP exactly like the app (fixed dev OTP) ----
    const send = await request('POST', '/api/auth/send-otp', { phone: drvPhone, role: 'DRIVER', purpose: 'LOGIN' });
    let token = null;
    let sessionUser = null;
    if (send.data && send.data.success) {
      const v = await request('POST', '/api/auth/verify-otp', {
        phone: drvPhone, otp: (send.data.testOtp) || '7729', role: 'DRIVER', purpose: 'LOGIN'
      });
      token = v.data && v.data.token;
      sessionUser = (v.data && v.data.user) || null;
    }
    check('DPF-01', 'a driver session for the disposable driver exists', !!token, { status: send.status, hasToken: !!token });
    // The bearer has to address THIS fixture. Without it every money assertion below would be
    // made against the seeded demo driver that getDriver() falls back to, and the route would
    // answer a gate the fixture was built to satisfy.
    const resolvedToFixture = !!sessionUser
      && (sessionUser.uuid === drvId || sessionUser.id === drvId);
    check('DPF-01b', 'the session resolves to the disposable driver, not a fallback account',
      resolvedToFixture, { sessionId: sessionUser && sessionUser.id, sessionUuid: sessionUser && sessionUser.uuid, expected: drvId });
    if (!token || !resolvedToFixture) {
      check('DPF-ABORT', 'the suite cannot proceed without a session it can trust', false,
        { hasToken: !!token, resolvedToFixture });
      await c.query('DELETE FROM drivers WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text) AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)', [drvId]);
      await c.query('DELETE FROM users WHERE id=$1::uuid', [usr.data.id]);
      await c.end();
      console.error('ABORT: no trustworthy driver session for the fixture — refusing to move money on an unresolved identity');
      return finish();
    }

    // ---- sanity: an ordinary payout under a fresh key succeeds and moves exactly its amount ----
    const first = await request('POST', '/api/driver/payout', { amount: 2000 },
      { ...bearer(token), 'Idempotency-Key': KEY }, 6000);
    check('DPF-02', 'the first payout under key K succeeded and moved exactly 2000',
      first.status === 200 && first.data.success === true && await wallet(drvId) === 3000,
      { status: first.status, code: first.data.code, wallet: await wallet(drvId) });

    // ---- the defect: reuse K with a DIFFERENT amount ----
    // adjustWallet throws IDEMPOTENCY_CONFLICT (before any RPC, so nothing moves). With no failure
    // channel on the route, Express 4 leaves the socket unanswered — this request HANGS until the
    // client timeout fires (status 0). After the fix it must arrive as an answered 409.
    const clash = await request('POST', '/api/driver/payout', { amount: 2500 },
      { ...bearer(token), 'Idempotency-Key': KEY }, 5000);
    check('DPF-03', 'a same-key/different-amount payout is ANSWERED, not left hanging on the socket',
      clash.status !== 0 && !clash.hung && !clash.error,
      { status: clash.status, hung: clash.hung === true, error: clash.error });
    check('DPF-04', 'the answer classifies it IDEMPOTENCY_CONFLICT, not a fabricated outcome',
      clash.data && clash.data.code === 'IDEMPOTENCY_CONFLICT',
      { status: clash.status, code: clash.data && clash.data.code });
    check('DPF-05', 'and it is HTTP 409, matching the admin payout route and POST /api/finance/refund',
      clash.status === 409, { status: clash.status, code: clash.data && clash.data.code });
    check('DPF-06', 'a 409 conflict must NOT tell the caller the outcome is unknown (it never moved)',
      !/PAYOUT_OUTCOME_UNKNOWN/.test(String((clash.data && clash.data.code) || ''))
        && !/could not be completed or confirmed/i.test(String((clash.data && (clash.data.note || clash.data.error)) || '')),
      { note: String((clash.data && (clash.data.note || clash.data.error)) || '').slice(0, 90) });
    check('DPF-07', 'the conflict moved no money: wallet still 3000',
      await wallet(drvId) === 3000, { wallet: await wallet(drvId) });

    // ---- the behaviour that must NOT change: same key + SAME semantics still replays idempotently ----
    const replay = await request('POST', '/api/driver/payout', { amount: 2000 },
      { ...bearer(token), 'Idempotency-Key': KEY }, 6000);
    check('DPF-08', 'same key + same amount still replays idempotently (200, duplicate, no second movement)',
      replay.status === 200 && replay.data.success === true && replay.data.duplicate === true
        && await wallet(drvId) === 3000,
      { status: replay.status, duplicate: replay.data.duplicate, wallet: await wallet(drvId) });

    // ---- a different key remains an independent payout (the catch must not over-block) ----
    const fresh = await request('POST', '/api/driver/payout', { amount: 300 },
      { ...bearer(token), 'Idempotency-Key': `DPFRESH:${STAMP}` }, 6000);
    check('DPF-09', 'a DIFFERENT key is an independent payout and still executes',
      fresh.status === 200 && fresh.data.success === true && await wallet(drvId) === 2700,
      { status: fresh.status, code: fresh.data.code, wallet: await wallet(drvId) });

    // ---- drain the probe through the audited path so no wallet balance residue accumulates ----
    const drainFrom = await wallet(drvId);
    const drain = await request('POST', '/api/driver/payout', { amount: drainFrom },
      { ...bearer(token), 'Idempotency-Key': `DPDRAIN:${STAMP}` }, 6000);
    check('DPF-10', 'the probe leaves with a zero wallet balance',
      drainFrom > 0 && drain.status === 200 && await wallet(drvId) === 0,
      { drained: drainFrom, status: drain.status, wallet: await wallet(drvId) });

    const del = await c.query(`DELETE FROM drivers WHERE id=$1::uuid
        AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
        AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [drvId]);
    console.log(`  cleanup DELETE drivers rowCount=${del.rowCount}`
      + (del.rowCount === 0 ? ' -> RETAINED (its payouts are durable history)' : ' -> removed under the guard'));
    try {
      const dusr = await c.query('DELETE FROM users WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM drivers WHERE user_id=$1::uuid)', [usr.data.id]);
      console.log(`  cleanup DELETE users rowCount=${dusr.rowCount}`);
    } catch (e) { console.log('  cleanup users delete skipped: ' + e.message); }
    await c.end();
  } catch (e) {
    console.error('FATAL', e.message);
    check('DPF-HARNESS', 'the harness completed without an unexpected error', false, { error: e.message });
  } finally {
    if (child && child.pid) {
      try { require('child_process').execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }, () => {}); }
      catch (e) { /* already gone */ }
      await sleep(400);
    }
  }

  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  const ran = results.filter(r => !r.skipped);
  console.log(`\n=== DRIVER PAYOUT ROUTE FAILURE CHANNEL: ${ran.length - failed.length}/${ran.length} passed, ${failed.length} failed, ${results.length - ran.length} skipped ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
