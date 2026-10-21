/*
 * MI-4 (P0) — an unresolved DRIVER identity must be refused, not served as somebody else.
 *
 * The elevation this suite holds shut, end to end over HTTP:
 *   1. verifyAuthOtp's DRIVER branch (database.js) resolves a driver by normalized phone in the
 *      mirror and then in PostgreSQL. When NEITHER answers, it left `entity` undefined and fell
 *      through to the token mint anyway, storing `entityId: 'anon'` — while the MERCHANT and ADMIN
 *      branches of the same function refuse with a typed error. So an OTP for a number that is not
 *      enrolled produced a bearer token.
 *   2. Every driver-authorized boundary then runs `session.entity || db.getDriver(session.entityId)`,
 *      and getDriver() ends in `|| this.drivers[0]` (database.js). It therefore NEVER returns null,
 *      so the `if (!driver)` guard under it is unreachable: 'anon' resolves to the first seeded
 *      driver, and the request is served as that person — their wallet, their earnings, their
 *      notification identity.
 *   3. `backend_sessions` carries `entity_id TEXT NOT NULL` and hydrateSessions() adopted any row
 *      whose expires_at was in the future, so an identity-less row was not only an in-process hazard:
 *      a token minted before the fix survived a restart and kept resolving to drivers[0] for its
 *      full 30-day TTL. This suite therefore FORGES such a row in the durable store before booting
 *      the backend, which is how the boundary (not just the mint) gets exercised.
 *
 * What is proven here, at the boundary and in the durable state, never from a response body alone:
 *   MIS-01..03  a DRIVER session with no resolvable identity is refused by authenticateDriver
 *               (both earnings routes) instead of being served as the fallback driver.
 *   MIS-04..05  the same bearer is refused by the notification boundary and causes NO protected
 *               write (no device_tokens row for anyone).
 *   MIS-06..07  an unenrolled number cannot obtain a session at all: typed 401, no token, and no
 *               durable session row for that phone.
 *   MIS-08..09  a genuinely enrolled driver still signs in over HTTP and is served ITS OWN wallet,
 *               not the fallback driver's — the guard must not break or mis-aim legitimate login.
 *   MIS-10      the fallback driver's durable wallet is untouched across the whole run: a failed or
 *               unresolved authentication moves no money.
 *
 * Money safety: this run never posts a payout. The driver payout route is deliberately NOT
 * exercised with a forged bearer, because the identity it would reach is a shared seeded record
 * whose payout-destination cooling window can lapse and make the call real. The boundary is
 * proven on a read route and a non-financial write route, and the shared record's wallet is
 * asserted unchanged.
 *
 * Local/test only: refuses a non-loopback backend or database. Run via scripts/with_local_target.js.
 */
const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('pg');

const PG = process.env.DATABASE_URL;
const STAMP = Date.now();
const isLoopback = (u) => {
  let host; try { host = new URL(u).hostname; } catch (e) { return false; }
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(host);
};
if (!PG || !isLoopback(PG)) {
  console.error('MI-4 REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
  process.exit(1);
}

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
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
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

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');
  if (!isLivePostgres || !supabaseAdmin) {
    skip('MIS-ALL', 'driver identity substitution at the route boundaries',
      'needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];

  // ---- the identity the bug reaches: whatever `this.drivers[0]` is in this boot ----
  const fallback = db.drivers && db.drivers[0] ? db.drivers[0] : null;
  const fallbackUuid = fallback
    ? (db.driverRepo?.resolveUuid(fallback.id) || fallback.uuid || fallback.id) : null;
  const fallbackWalletRow = fallbackUuid
    ? await one('SELECT wallet_balance::text w, user_id FROM drivers WHERE id=$1::uuid', [fallbackUuid])
    : null;
  const fallbackWallet = fallbackWalletRow ? Number(fallbackWalletRow.w) : null;
  const fallbackUserId = fallbackWalletRow && fallbackWalletRow.user_id;

  // ---- a forged identity-less DRIVER session, written BEFORE the backend boots ----
  // This is how a pre-fix token looks to a fresh process: a bearer whose entity_id is 'anon' and
  // whose entity is NULL, in a store hydrateSessions() used to adopt on any future expires_at.
  // Nothing in this run minted it, which is the point — the boundary has to refuse it.
  // Measured layering, because it changes WHICH refusal answers: once hydration declines the row
  // (fix 3), the bearer is no longer in the session map, so the boundary answers its missing-session
  // refusal (`UNAUTHORIZED`) rather than `DRIVER_IDENTITY_UNRESOLVED`. Both are 401s that serve
  // nobody, and this suite holds the end-to-end property — refused, typed, no write, no wallet. The
  // identity-resolution branch itself is pinned directly in driver_unenrolled_phone_elevation_test.js
  // (MI4-10..12), where an in-process session with `entity: null` does reach getDriverStrict.
  const FORGED_TOKEN = `mi4forged${STAMP}`;
  const forgedHash = crypto.createHash('sha256').update(FORGED_TOKEN).digest('hex');
  // Deliberately NOT the same number as `ghostRaw` below. The forged row's phone is inert - no code
  // path reads it, resolution goes through entity_id - but MIS-07 counts durable sessions BY PHONE,
  // so sharing a number made this run's own forged row look like a session the unenrolled login had
  // just minted. Measured that way on the first GREEN pass: MIS-07 reported rows=1 for a refusal
  // that wrote nothing.
  const forgedPhone = `+9190${String(STAMP).slice(-8)}`;
  await c.query(
    `INSERT INTO backend_sessions (token_hash, role, entity_id, phone, entity, created_at, expires_at)
     VALUES ($1, 'DRIVER', 'anon', $2, NULL, now(), now() + interval '10 minutes')
     ON CONFLICT (token_hash) DO UPDATE SET role = 'DRIVER', entity_id = 'anon',
       phone = EXCLUDED.phone, entity = NULL, expires_at = now() + interval '10 minutes'`,
    [forgedHash, forgedPhone]
  );

  // ---- a legitimately enrolled driver this run owns (normalized like normalizePhone() does) ----
  const ownRaw = `71${String(STAMP).slice(-8)}`;
  const ownNorm = db.normalizePhone(ownRaw);
  const usr = await supabaseAdmin.from('users').insert({
    name: `MI-4 route driver user ${STAMP}`, phone: ownNorm
  }).select('id').single();
  if (usr.error || !usr.data) { console.error('FATAL: user insert refused ' + JSON.stringify(usr.error)); process.exit(1); }
  const drv = await supabaseAdmin.from('drivers').insert({
    user_id: usr.data.id, name: `MI-4 route driver ${STAMP}`, phone: ownNorm,
    vehicle_type: 'AUTO', vehicle_number: `MI${String(STAMP).slice(-6)}`, operational_status: 'AVAILABLE',
    wallet_balance: 1337, kyc_status: 'VERIFIED', payout_upi_verified: false
  }).select('id').single();
  if (drv.error || !drv.data) { console.error('FATAL: driver insert refused ' + JSON.stringify(drv.error)); process.exit(1); }
  const drvId = drv.data.id;

  // Declared here because the finally block cleans the session rows it mints, by this number.
  const ghostRaw = `99${String(STAMP).slice(-8)}`;

  // ---- boot a private backend that hydrates the forged row at startup ----
  let child = null;
  try {
    PORT = await findFreePort();
    BASE = `http://127.0.0.1:${PORT}`;
    if (!isLoopback(BASE)) { console.error('MI-4 REFUSED: non-loopback base ' + BASE); process.exit(1); }
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

    // ---- MIS-01..03 the earnings boundaries must refuse an unresolved DRIVER bearer ----
    const earnings = await request('GET', '/api/driver/earnings', null, bearer(FORGED_TOKEN));
    check('MIS-01', 'GET /api/driver/earnings refuses a DRIVER session with no resolvable identity',
      earnings.status === 401, { status: earnings.status, code: earnings.data.code,
        walletBalance: earnings.data.walletBalance, fallbackWallet });
    const leakedFallback = earnings.status === 200
      && fallbackWallet !== null && Number(earnings.data.walletBalance) === fallbackWallet;
    check('MIS-02', 'the refusal carries a code, and no response hands out the fallback driver\'s wallet',
      earnings.status === 401 ? !!earnings.data.code : !leakedFallback,
      { status: earnings.status, code: earnings.data.code, leakedFallback });
    const byId = await request('GET', '/api/driver/DRV-101/earnings', null, bearer(FORGED_TOKEN));
    check('MIS-03', 'GET /api/driver/:driverId/earnings refuses the same unresolved bearer',
      byId.status === 401, { status: byId.status, code: byId.data.code });

    // ---- MIS-04..05 the notification boundary, and no protected write ----
    const DEVICE_TOKEN = `mi4-forged-device-${STAMP}`;
    const notif = await request('POST', '/api/notifications/device-token',
      { deviceToken: DEVICE_TOKEN, platform: 'ANDROID', appType: 'DRIVER' }, bearer(FORGED_TOKEN));
    check('MIS-04', 'POST /api/notifications/device-token refuses the unresolved DRIVER bearer',
      notif.status === 401, { status: notif.status, code: notif.data.code });
    const deviceRows = (await c.query(
      'SELECT user_id FROM device_tokens WHERE device_token=$1', [DEVICE_TOKEN])).rows;
    check('MIS-05', 'the refused bearer caused no device-token registration for anyone',
      deviceRows.length === 0, { rows: deviceRows.length, fallbackUserId });

    // ---- MIS-06..07 an unenrolled number cannot get a session through the real client path ----
    const ghostSend = await request('POST', '/api/auth/send-otp',
      { phone: ghostRaw, role: 'DRIVER', purpose: 'LOGIN' });
    const ghostVerify = await request('POST', '/api/auth/verify-otp', {
      phone: ghostRaw, otp: (ghostSend.data && ghostSend.data.testOtp) || '7729',
      role: 'DRIVER', purpose: 'LOGIN'
    });
    check('MIS-06', 'an unenrolled DRIVER login is a typed 401, not a token',
      ghostVerify.status === 401 && !ghostVerify.data.token,
      { status: ghostVerify.status, code: ghostVerify.data.code, hasToken: !!ghostVerify.data.token });
    const ghostSessions = (await c.query(
      'SELECT token_hash FROM backend_sessions WHERE phone=$1', [db.normalizePhone(ghostRaw)])).rows;
    check('MIS-07', 'no durable session row was written for the unenrolled number',
      ghostSessions.length === 0, { rows: ghostSessions.length });

    // ---- MIS-08..09 a real enrolled driver still signs in, and reaches only its own data ----
    await request('POST', '/api/auth/send-otp', { phone: ownRaw, role: 'DRIVER', purpose: 'LOGIN' });
    const ownSend = await request('POST', '/api/auth/send-otp', { phone: ownRaw, role: 'DRIVER', purpose: 'LOGIN' });
    const ownVerify = await request('POST', '/api/auth/verify-otp', {
      phone: ownRaw, otp: (ownSend.data && ownSend.data.testOtp) || '7729',
      role: 'DRIVER', purpose: 'LOGIN'
    });
    const ownToken = ownVerify.data && ownVerify.data.token;
    check('MIS-08', 'a correctly registered DRIVER still signs in over HTTP',
      ownVerify.status === 200 && !!ownToken,
      { status: ownVerify.status, code: ownVerify.data.code, error: ownVerify.data.error });
    const ownEarnings = ownToken
      ? await request('GET', '/api/driver/earnings', null, bearer(ownToken)) : { status: 0, data: {} };
    check('MIS-09', 'that session is served ITS OWN wallet, not the fallback driver\'s',
      ownEarnings.status === 200 && Number(ownEarnings.data.walletBalance) === 1337
        && Number(ownEarnings.data.walletBalance) !== fallbackWallet,
      { status: ownEarnings.status, walletBalance: ownEarnings.data.walletBalance, fallbackWallet });

    // ---- MIS-10 the shared seeded record was never touched by any of it ----
    const fallbackAfter = fallbackUuid
      ? await one('SELECT wallet_balance::text w FROM drivers WHERE id=$1::uuid', [fallbackUuid]) : null;
    check('MIS-10', 'the fallback driver\'s durable wallet is unchanged by the refused traffic',
      fallbackWalletRow && fallbackAfter && fallbackAfter.w === fallbackWalletRow.w,
      { before: fallbackWalletRow && fallbackWalletRow.w, after: fallbackAfter && fallbackAfter.w });
  } finally {
    // This run owns both rows it deletes: the forged session by its own hash, its own fixture driver
    // only while nothing financial points at it. No shared record is removed.
    try { await c.query('DELETE FROM device_tokens WHERE device_token=$1', [`mi4-forged-device-${STAMP}`]); } catch (e) {}
    try { await c.query('DELETE FROM backend_sessions WHERE token_hash=$1', [forgedHash]); } catch (e) {}
    // Sessions this run's logins minted, removed by the exact phone each one used. Both numbers are
    // derived from this run's stamp, so no pre-existing row matches - and leaving the enrolled
    // driver's bearer behind after deleting its driver row would put a dangling identity in the
    // shared store for the next run to hydrate.
    try {
      await c.query('DELETE FROM backend_sessions WHERE phone = ANY($1::text[])', [[ownNorm, db.normalizePhone(ghostRaw)]]);
    } catch (e) { console.log('  session cleanup note: ' + e.message); }
    try {
      await c.query(`DELETE FROM drivers WHERE id=$1::uuid
        AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.entity_id=$1::text)
        AND NOT EXISTS (SELECT 1 FROM driver_payouts p WHERE p.driver_id=$1::uuid)`, [drvId]);
      await c.query('DELETE FROM users WHERE id=$1::uuid AND NOT EXISTS (SELECT 1 FROM drivers WHERE user_id=$1::uuid)', [usr.data.id]);
    } catch (e) { console.log('  cleanup note: ' + e.message); }
    await c.end();
    if (child) { try { child.kill(); } catch (e) {} }
  }
  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== MI-4 DRIVER IDENTITY SUBSTITUTION (ROUTES): ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
