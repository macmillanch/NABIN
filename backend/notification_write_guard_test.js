// =========================================================================
// NOTIFICATION READ/WRITE GUARD (local only)
//
// The eight notification routes were the largest remaining block of the defect
// link 58 fixed on `POST /api/support/ticket`: a store refusal was rethrown as
// the engine's own sentence, and the route pasted that sentence into `error`.
//
//   * `throw new Error(`Failed to persist notification in PostgreSQL: ${insErr.message}`)`
//     sent `duplicate key value violates unique constraint "idx_device_tokens_unique"`
//     or `value too long for type character varying(60)` to whoever triggered it —
//     a schema diagram, to a caller who has no business reading one.
//   * Wrapping destroyed the SQLSTATE, so `storeReply` — which chooses the status
//     from the code — saw no code: a duplicate device token that should have been a
//     409, an unmigrated schema that should have been SCHEMA_NOT_READY and an
//     unreachable store that should have been a retryable 503 were all one
//     unclassified 500 (or, on the routes with `err.statusCode || 400`, a 400 that
//     told the client to stop retrying).
//   * Nothing bounded `notification_type`, `title` or `device_id` against the
//     columns they land in (`varchar(60)`, `varchar(150)`, `varchar(100)`), so the
//     engine was the only thing that noticed. The admin route's own title cap said
//     255 — a number that is not the column.
//   * The broadcast answered `recipientCount: targetUsers.length`, the size of the
//     audience rather than the number of rows written, and quietly filed a
//     misspelled `priority` as NORMAL.
//   * `registerDeviceToken()` recovered from a 23505 by reading for the row it had
//     lost the race to, and when that read found nothing it fell through and
//     returned `null` — which the route printed as `200 {registered:true}`. A
//     caller was told a push token was saved when no row exists. NWG-60 pins that
//     an unconfirmed registration is a refusal.
//
// The correction adds no new vocabulary. `NotificationRepository` now marks a
// genuine engine refusal with `storeFailure = true` plus the SQLSTATE, parks the
// engine's text in `details` (which `replyStoreError` logs and never echoes), and
// leaves `status` unset on the way in so a store failure cannot be answered as a
// 4xx. All eight routes hand that to the platform's existing classifier
// (`storeReply`/`isStoreUnreachable` in src/supabase.js). Over-cap inputs are
// refused at the boundary with a named code, and the admin broadcast states what
// was actually delivered.
//
// Three techniques, because the three claims need different evidence:
//
//   * Schema truth — the declared caps and the allowlists are read out of the two
//     source files and compared with `information_schema`/`pg_constraint`. A
//     constant or an enum that drifts from the column it claims to bound is a bug
//     in either direction, and the admin route's 255 is exactly that bug.
//   * Repository against a real outage — a child whose SUPABASE_URL is a port
//     nobody listens on. A cap refusal proves itself by arriving BEFORE the store,
//     so the two families are distinguishable with no mocks at all, and a
//     value exactly at the limit proves the gate accepts it by reaching the store.
//   * Routes over real HTTP with the store's answer faked at the wire. A
//     route-level outage cannot be produced by pointing a server at a dead store
//     (the session read in `requireNotificationAuth` uses that same store and
//     answers 401 first), so each server child replaces
//     `supabaseAdmin.from(<table>)` for the three notification tables with a
//     builder that resolves — or rejects — exactly the way supabase-js does for one
//     PostgreSQL code. What is proven is the repository's marking AND the route's
//     classification, over real HTTP, with no row anywhere. The wire answer is
//     injected, so some pairings are artificial combinations (a 409 on a read)
//     rather than things the engine would really say for that query.
//
// Nothing in this suite writes. No request that would clear the gates and reach a
// live insert is ever sent: the device-token and preferences writes only run
// against a faked store, and the two routes that seed a row on a plain read
// (`GET /api/notifications/preferences` inserts defaults) are exercised only
// there. The final checks fingerprint `notifications`, `device_tokens`,
// `notification_preferences`, `users`, `merchants` and `drivers` and require every
// one to be identical; the authentication side effects the run cannot avoid
// (`backend_sessions`, `audit_logs`) are measured and printed, not deleted.
//
// One guarantee is asserted against the source rather than over HTTP, and says so:
// the broadcast's delivered-count. Proving `recipientCount === (rows written)`
// needs either an audience larger than the 500-recipient fan-out cap (this
// database has 245 users) or a store that accepts half an audience and rejects the
// rest (which is not a wire shape supabase-js produces). Both would mean writing
// notifications for real, so NWG-55..57 read the response construction instead.
// =========================================================================

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');

const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite writes and asserts through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into
// this file, which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'notification_write_guard_test' });
const PG = PG_TARGET.connectionString;
const OTP = process.env.NABIN_TEST_OTP || '7729';
// The local dev fixture every committed admin suite already signs in with. Read from the
// environment when the runner supplies it, so this file is not the place a password lives.
const ADMIN_USER = process.env.NABIN_ADMIN_USERNAME || 'superadmin';
const ADMIN_PASS = process.env.NABIN_ADMIN_PASSWORD || 'AdminPassword123!';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
const SUITE = path.join(__dirname, 'notification_write_guard_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'NotificationRepository.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');
// The tables the notification path writes. A read of `notifications` also goes through
// them, so one replacement covers every route in this suite.
const NOTIF_TABLES = ['notifications', 'device_tokens', 'notification_preferences'];

if (process.env.NODE_ENV === 'production') {
  console.error('NWG REFUSED: this suite must not run against a production environment');
  process.exit(1);
}
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('NWG REFUSED: non-loopback database target');
  process.exit(1);
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const repeat = (n) => 'x'.repeat(n);

// A repository call reduced to what the verdict cares about. `storeFailure` is the
// mark the fixed repository puts on a genuine engine refusal, and `unreachable` is
// what `isStoreUnreachable()` answers for it — the two things the routes read.
function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      storeFailure: Boolean(err && err.storeFailure),
      message: err && err.message,
      details: err && err.details,
    }));
}

// Node's fetch refuses a body on GET, and the suite reads a null body as "absent".
async function request(method, baseUrl, urlPath, body, token) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined || body === null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* the raw text is kept for the leak check */ }
  return { status: res.status, data: data || {}, text };
}

async function findFreePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

// Two leak questions, two marker sets.
//
// A SECRET LEAK is a leak in any body: the connection target, a credential, a
// JWT-looking value, or the shape of a stack frame.
const SECRET_MARKERS = ['password', 'postgres://', 'postgresql://', 'service_role', '54322',
  '54321', 'eyJ', '    at ', 'at Object.', 'at async', '127.0.0.1'];
// The SCHEMA WORDS are what the defect actually printed: PostgreSQL naming a column
// type, a constraint, a relation, one of its own columns or SQLSTATEs, or the reason
// it could not be reached. None of them appear in the copy this repository writes.
const SCHEMA_MARKERS = ['varchar', 'character varying', 'duplicate key', 'violates unique constraint',
  'relation "', 'does not exist', 'null value in column', '22001', '23505', '23502', '22p02', '42p01',
  'invalid input syntax', 'postgrest', 'econnrefused', 'connrefused', 'fetch failed',
  'notification_type', 'idx_notifications', 'idx_device_tokens'];
function leaksIn(text, markers) {
  const lower = String(text || '').toLowerCase();
  return markers.filter(m => lower.includes(m.toLowerCase()));
}

// ---------------------------------------------------------------- source truth
// The caps are only honest if they equal the columns. Read the declared values out
// of the files rather than re-typing them here, so this is a check of the source and
// not of this suite's own memory.
function declaredCap(name) {
  const src = fs.readFileSync(REPO_FILE, 'utf8');
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*(\\d+)\\s*;'));
  return m ? Number(m[1]) : null;
}
// `['LOW', 'NORMAL'].includes(priority?.toUpperCase())` — the list that guards a column.
// The anchor matters: `channel` is guarded twice in this file (notifications accept `ALL`,
// deliveries do not), so the first match in the file is not necessarily the one under test.
function listGuarding(src, ident, anchor) {
  const from = anchor === undefined ? 0 : src.indexOf(anchor);
  if (from < 0) return null;
  const m = src.slice(from).match(new RegExp('\\[([^\\]]*)\\]\\.includes\\(\\s*' + ident));
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
}
// `const validPriorities = ['LOW', ...]` — the list a route refuses against.
function declaredList(src, name) {
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]'));
  if (!m) return null;
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
}
// `'ANDROID'::character varying` repeated — the set PostgreSQL itself will accept.
function checkValues(def) {
  const out = [];
  const re = /'([^']*)'::character varying/g;
  let m;
  while ((m = re.exec(String(def || '')))) out.push(m[1]);
  return out.sort();
}
const sameSet = (a, b) => Boolean(a) && Boolean(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------------------------------------------------------------- children
async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable, supabaseAdmin } = require('./src/supabase');
  const fx = JSON.parse(process.env.NABIN_NWG_FX || '{}');
  const verdict = (out) => console.log(`NWG_VERDICT ${JSON.stringify(out)}`);
  const shaped = (res) => Object.assign({}, res, {
    unreachable: res.threw ? isStoreUnreachable(res) : false,
    leaked: res.threw && res.code && String(res.code).endsWith('_TOO_LONG')
      ? leaksIn(res.message, SCHEMA_MARKERS) : [],
  });

  if (scenario === 'repo_down') {
    const repo = db.notificationRepo;
    const NIL = '00000000-0000-0000-0000-000000000000';
    const out = { scenario, ok: false, caps: {}, atLimit: {}, methods: {} };

    // Payloads are built from the MEASURED column lengths, not from the constants
    // under test: a wrong constant must not be able to change what this suite sends,
    // or the refusal it produces would be the JSON body limit rather than the gate.
    out.caps.typeOver = shaped(await outcome(() => repo.createNotification({
      recipientUserId: fx.customerUuid, title: 'nwg probe', body: 'probe body',
      notificationType: repeat(fx.typeBound + 1).toUpperCase() })));
    out.caps.titleOver = shaped(await outcome(() => repo.createNotification({
      recipientUserId: fx.customerUuid, title: repeat(fx.titleBound + 1), body: 'probe body',
      notificationType: 'GENERAL' })));
    out.caps.deviceIdOver = shaped(await outcome(() => repo.registerDeviceToken({
      userId: fx.customerUuid, deviceToken: 'nwg-probe-token', platform: 'ANDROID',
      appType: 'CUSTOMER', deviceId: repeat(fx.deviceIdBound + 1) })));

    // Exactly at the limit: the gate must let these through, which an unreachable
    // store proves — the call reached the wire instead of being refused.
    out.atLimit.typeAt = shaped(await outcome(() => repo.createNotification({
      recipientUserId: fx.customerUuid, title: 'nwg probe', body: 'probe body',
      notificationType: repeat(fx.typeBound).toUpperCase() })));
    out.atLimit.titleAt = shaped(await outcome(() => repo.createNotification({
      recipientUserId: fx.customerUuid, title: repeat(fx.titleBound), body: 'probe body',
      notificationType: 'GENERAL' })));
    out.atLimit.deviceIdAt = shaped(await outcome(() => repo.registerDeviceToken({
      userId: fx.customerUuid, deviceToken: 'nwg-probe-token', platform: 'ANDROID',
      appType: 'CUSTOMER', deviceId: repeat(fx.deviceIdBound) })));
    out.atLimit.valid = shaped(await outcome(() => repo.createNotification({
      recipientUserId: fx.customerUuid, title: 'nwg probe', body: 'probe body',
      notificationType: 'GENERAL', priority: 'HIGH' })));

    // Every method that talks to the store, under one real outage. The routes read
    // two facts from each: that it is a store condition, and that it is retryable.
    const calls = {
      registerDeviceToken: () => repo.registerDeviceToken({
        userId: fx.customerUuid, deviceToken: 'nwg-outage-token', platform: 'ANDROID', appType: 'CUSTOMER' }),
      deactivateDeviceToken: () => repo.deactivateDeviceToken(fx.customerUuid, 'nwg-outage-token'),
      getActiveTokens: () => repo.getActiveTokens(fx.customerUuid),
      createNotification: () => repo.createNotification({
        recipientUserId: fx.customerUuid, title: 'nwg outage probe', body: 'probe body', notificationType: 'GENERAL' }),
      getNotifications: () => repo.getNotifications(fx.customerUuid, { limit: 5 }),
      getUnreadCount: () => repo.getUnreadCount(fx.customerUuid),
      markAsRead: () => repo.markAsRead(fx.customerUuid, NIL),
      markAllAsRead: () => repo.markAllAsRead(fx.customerUuid),
      getPreferences: () => repo.getPreferences(fx.customerUuid),
      updatePreferences: () => repo.updatePreferences(fx.customerUuid, { push_enabled: false }),
      createDeliveryRecord: () => repo.createDeliveryRecord({ notificationId: NIL, recipientUserId: fx.customerUuid }),
      updateDeliveryStatus: () => repo.updateDeliveryStatus(NIL, { status: 'DELIVERED' }),
      getDeliveriesByNotification: () => repo.getDeliveriesByNotification(NIL),
      getTemplate: () => repo.getTemplate('NWG_TEMPLATE'),
      listActiveTemplates: () => repo.listActiveTemplates(),
    };
    for (const [name, fn] of Object.entries(calls)) {
      out.methods[name] = shaped(await outcome(fn));
    }

    // A malformed uuid is the caller's condition and must stay 4xx-shaped.
    out.badUuid = shaped(await outcome(() => repo.markAsRead(fx.customerUuid, 'nwg-not-a-uuid')));

    // The device-token collision recovery, on the one answer that used to make the route lie.
    // The insert is refused with 23505 and the recovery read that follows it finds no row —
    // a real race between two devices, and the only state in which the old unconditional
    // `return mapRowToDeviceToken(conflictRow)` produced `200 {success: true, deviceToken: null}`.
    // `from` is patched for the duration of this one call and restored right after it.
    const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
    const chain = (settle) => {
      const b = {};
      ['select', 'eq', 'neq', 'order', 'limit', 'range', 'in', 'is', 'or', 'upsert', 'delete', 'patch'].forEach(m => { b[m] = () => b; });
      b.insert = () => b;
      b.update = () => b;
      b.single = async () => settle;
      b.maybeSingle = async () => settle;
      // Awaiting the builder directly is how supabase-js hands back a plain insert.
      b.then = (res, rej) => Promise.resolve().then(() => res(settle)).catch(rej);
      return b;
    };
    const collInsert = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_device_tokens_unique"', details: 'Key (user_id, device_token, app_type)=(a, b, c) already exists.', hint: null } };
    const collRecoveryEmpty = { data: null, error: null };
    let fromCalls = 0;
    supabaseAdmin.from = (table) => {
      if (table !== 'device_tokens') return realFrom(table);
      fromCalls += 1;
      // call 1: the pre-check `select().maybeSingle()` — no existing row.
      // call 2: the `insert()` — refused with 23505.
      // call 3: the collision recovery `update().select().single()` — resolves with NO row.
      if (fromCalls === 1) return chain({ data: null, error: null });
      if (fromCalls === 2) return chain(collInsert);
      return chain(collRecoveryEmpty);
    };
    out.collisionNull = shaped(await outcome(() => repo.registerDeviceToken({
      userId: fx.customerUuid, deviceToken: 'nwg-collision-probe', platform: 'ANDROID', appType: 'CUSTOMER' })));
    supabaseAdmin.from = realFrom;

    const CAP = (r) => r && String(r.code || '').endsWith('_TOO_LONG');
    out.ok = out.caps.typeOver.code === 'TYPE_TOO_LONG'
      && out.caps.titleOver.code === 'TITLE_TOO_LONG'
      && out.caps.deviceIdOver.code === 'DEVICE_ID_TOO_LONG'
      && [out.caps.typeOver, out.caps.titleOver, out.caps.deviceIdOver].every(r => r.threw === true
        && r.status === 400 && r.unreachable === false && r.leaked.length === 0)
      && Object.values(out.atLimit).every(r => r.threw === true && r.unreachable === true && !CAP(r))
      && Object.values(out.methods).every(r => r.threw === true && r.unreachable === true
        && !(Number(r.status) >= 400 && Number(r.status) < 500));
    return verdict(out);
  }

  if (scenario === 'serve_live' || scenario === 'serve_fake') {
    const port = Number(process.env.PORT);
    const kind = process.env.NABIN_NWG_FAKE;

    // The engine's answer for one SQLSTATE, shaped the way supabase-js shapes it: a
    // resolved `{data:null, error}` for a refusal, a rejected TypeError with the
    // syscall `cause` for a store that is not there.
    const ENGINE_ERRORS = {
      '23505': { code: '23505', message: 'duplicate key value violates unique constraint "idx_device_tokens_unique"', details: 'Key already exists.', hint: null },
      '22001': { code: '22001', message: 'value too long for type character varying(60)', details: null, hint: null },
      '42P01': { code: '42P01', message: 'relation "notifications" does not exist', details: null, hint: null },
    };
    function fakeBuilder() {
      const settle = () => {
        if (kind === 'fetch') {
          const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
          cause.code = 'ECONNREFUSED';
          cause.syscall = 'connect';
          const err = new TypeError('fetch failed');
          err.cause = cause;
          return Promise.reject(err);
        }
        return Promise.resolve({ data: null, error: ENGINE_ERRORS[kind] });
      };
      const self = {};
      ['insert', 'update', 'delete', 'upsert', 'select', 'eq', 'neq', 'or', 'in', 'is', 'not',
        'gte', 'lte', 'like', 'ilike', 'order', 'range', 'filter'].forEach((m) => {
        self[m] = () => self;
      });
      self.single = settle;
      self.maybeSingle = settle;
      self.then = (onOk, onErr) => settle().then(onOk, onErr);
      return self;
    }

    require('./src/server');
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90000;   // measured boot is ~13s idle, longer under load
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await request('GET', baseUrl, '/api/health')).status === 200; } catch (e) { /* not up yet */ }
    }
    if (!ready) return verdict({ scenario, ok: false, port });

    // Installed only after boot, so seeding and authentication keep the real client:
    // the fake covers exactly the three tables this change is about.
    if (scenario === 'serve_fake') {
      const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
      supabaseAdmin.from = (table) => (NOTIF_TABLES.includes(table) ? fakeBuilder() : realFrom(table));
    }
    return verdict({ scenario, ok: true, port, fake: scenario === 'serve_fake' ? kind : null });
  }

  verdict({ scenario, ok: false, error: `unknown scenario ${scenario}` });
}

function spawnRepoChild(scenario, env) {
  const res = spawnSync(process.execPath, [SUITE, scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NABIN_NWG_CHILD: scenario }, env),
    maxBuffer: 16 * 1024 * 1024,
  });
  const line = String(res.stdout || '').split('\n').filter(l => l.startsWith('NWG_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `child printed no verdict: ${String(res.stdout || '').slice(-200)}${String(res.stderr || '').slice(-300)}` };
  }
  try { return JSON.parse(line.slice('NWG_VERDICT '.length)); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 300)}` }; }
}

function spawnServerChild(scenario, port, extraEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SUITE, scenario], {
      cwd: __dirname,
      windowsHide: true,
      env: Object.assign({}, process.env, { NABIN_NWG_CHILD: scenario, PORT: String(port) }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let buffer = '';
    let settled = false;
    proc.stderr.on('data', (d) => stderr.push(String(d)));
    proc.stdout.on('data', (d) => {
      buffer += String(d);
      const line = buffer.split('\n').find(l => l.startsWith('NWG_VERDICT '));
      if (!line || settled) return;
      settled = true;
      try { resolve({ proc, verdict: JSON.parse(line.slice('NWG_VERDICT '.length)), stderr }); }
      catch (e) { reject(new Error(`unparsable server verdict: ${String(e && e.message)}`)); }
    });
    proc.on('exit', (code) => {
      if (!settled) reject(new Error(`server child exited (${code}) before readiness: ${stderr.join('').slice(-400)}`));
    });
  });
}

async function mintCustomerToken(baseUrl, fx) {
  const mint = await request('POST', baseUrl, '/api/auth/verify-otp', {
    phone: fx.customerPhone, otp: OTP, role: 'CUSTOMER', purpose: 'LOGIN',
  });
  return mint.data && mint.data.token;
}

async function mintAdminToken(baseUrl) {
  const mint = await request('POST', baseUrl, '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASS });
  return mint.data && mint.data.token;
}

// One faked store answer, asserted through the notification routes.
const FAKE_KINDS = [
  { kind: 'fetch', status: 503, code: 'STORE_UNAVAILABLE' },
  { kind: '23505', status: 409, code: 'ALREADY_EXISTS' },
  { kind: '22001', status: 400, code: 'INVALID_VALUE' },
  { kind: '42P01', status: 500, code: 'SCHEMA_NOT_READY' },
];

// ---------------------------------------------------------------- main
async function main() {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const norm = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

  // ============================================ 1. the caps and enums match the columns
  const caps = {
    typeCap: declaredCap('NOTIFICATION_TYPE_MAX_LENGTH'),
    titleCap: declaredCap('NOTIFICATION_TITLE_MAX_LENGTH'),
    deviceIdCap: declaredCap('DEVICE_ID_MAX_LENGTH'),
  };
  const notifCols = (await c.query(
    `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications'`)).rows;
  const dtCols = (await c.query(
    `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'device_tokens'`)).rows;
  const col = (rows, name) => rows.find(x => x.column_name === name);
  const typeCol = col(notifCols, 'notification_type');
  const titleCol = col(notifCols, 'title');
  const deviceIdCol = col(dtCols, 'device_id');
  const varcharOf = (candidate, name) => Boolean(candidate) && candidate.data_type === 'character varying'
    && candidate.character_maximum_length === name;

  const checks = (await c.query(
    `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE contype = 'c' AND conrelid IN ('public.notifications'::regclass, 'public.device_tokens'::regclass)`)).rows;
  const ddl = (tbl, field) => {
    // `conrelid::regclass::text` prints `notifications`, not `public.notifications`,
    // because the connection's search_path holds `public` — so compare the bare name.
    const row = checks.find(x => String(x.tbl).replace(/^.*\./, '') === String(tbl).replace(/^.*\./, '')
      && x.conname.includes(field));
    return row ? checkValues(row.def) : null;
  };

  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  // `channel` is guarded twice in this repository — notifications accept `ALL`, deliveries do
  // not — so the list under test has to be located inside `createNotification`, not at the
  // first match in the file.
  const CREATE_NOTIF = 'async createNotification({';
  const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
  const regionStart = serverSrc.indexOf('NOTIFICATION REST API ENDPOINTS');
  const regionEnd = serverSrc.indexOf('Centralized Asynchronous Error Handler');
  const routeSrc = regionStart > 0 && regionEnd > regionStart
    ? serverSrc.slice(regionStart, regionEnd) : '';

  check('NWG-01', 'the three notification caps are declared as numeric constants in the repository source',
    Object.values(caps).every(v => Number.isInteger(v) && v > 0) && routeSrc.length > 2000,
    Object.assign({ regionChars: routeSrc.length }, caps));
  check('NWG-02', 'NOTIFICATION_TYPE_MAX_LENGTH equals the live notification_type column (varchar(60))',
    varcharOf(typeCol, caps.typeCap), { column: typeCol, declared: caps.typeCap });
  check('NWG-03', 'NOTIFICATION_TITLE_MAX_LENGTH equals the live notifications.title column (varchar(150))',
    varcharOf(titleCol, caps.titleCap), { column: titleCol, declared: caps.titleCap });
  check('NWG-04', 'DEVICE_ID_MAX_LENGTH equals the live device_tokens.device_id column (varchar(100))',
    varcharOf(deviceIdCol, caps.deviceIdCap), { column: deviceIdCol, declared: caps.deviceIdCap });

  // The admin route had its own title cap of 255. 255 is not this column.
  const routeTitleCap = (routeSrc.match(/title\.trim\(\)\.length\s*>\s*(\d+)/) || [])[1];
  check('NWG-05', 'the broadcast route\'s own title cap is the column length, not a number invented beside it',
    Number(routeTitleCap) === caps.titleCap, { routeCap: Number(routeTitleCap) || null, column: titleCol });

  const ddlPriority = ddl('public.notifications', 'priority');
  const ddlChannel = ddl('public.notifications', 'channel');
  const ddlUserType = ddl('public.notifications', 'user_type');
  const ddlPlatform = ddl('public.device_tokens', 'platform');
  const ddlAppType = ddl('public.device_tokens', 'app_type');
  check('NWG-06', 'the broadcast route refuses exactly the priorities the CHECK constraint allows',
    sameSet(declaredList(routeSrc, 'validPriorities'), ddlPriority),
    { route: declaredList(routeSrc, 'validPriorities'), ddl: ddlPriority });
  check('NWG-07', 'the repository\'s priority set guarding createNotification is the CHECK set, so its silent default is always a value the store accepts',
    sameSet(listGuarding(repoSrc, 'priority', CREATE_NOTIF), ddlPriority),
    { repo: listGuarding(repoSrc, 'priority', CREATE_NOTIF), ddl: ddlPriority });
  check('NWG-08', 'the repository\'s channel set inside createNotification, not the deliveries one, is the CHECK set',
    sameSet(listGuarding(repoSrc, 'channel', CREATE_NOTIF), ddlChannel),
    { repo: listGuarding(repoSrc, 'channel', CREATE_NOTIF), ddl: ddlChannel });
  check('NWG-09', 'the repository\'s userType set inside createNotification is the notifications.user_type CHECK set',
    sameSet(listGuarding(repoSrc, 'userType', CREATE_NOTIF), ddlUserType),
    { repo: listGuarding(repoSrc, 'userType', CREATE_NOTIF), ddl: ddlUserType });
  const routePlatforms = declaredList(routeSrc, 'validPlatforms');
  const routeAppTypes = declaredList(routeSrc, 'validAppTypes');
  check('NWG-10', 'the registration route can only offer platforms and app types the CHECK constraints accept',
    Boolean(routePlatforms) && Boolean(routeAppTypes) && ddlPlatform && ddlAppType
    && routePlatforms.every(v => ddlPlatform.includes(v)) && sameSet(routeAppTypes, ddlAppType),
    { platforms: routePlatforms, ddlPlatforms: ddlPlatform, appTypes: routeAppTypes, ddlAppTypes: ddlAppType });

  // Comments describe the defect this file used to have, so a leak scan has to look at
  // what executes. Block comments first, then whole-line `//` comments.
  const executable = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const repoCode = executable(repoSrc);
  check('NWG-11', 'no repository throw still prints PostgreSQL\'s sentence about itself',
    !/in PostgreSQL/.test(repoCode) && !/Database error/.test(repoCode)
    && !/new Error\(\s*`[^`]*\$\{\s*(?:error|err|insErr|selErr|updateErr)\.message/.test(repoCode)
    && !/throw new Error\([^)]*\$\{\s*(?:error|err|insErr|selErr|updateErr)\.message/.test(repoCode),
    { pgPhrase: (repoCode.match(/in PostgreSQL/g) || []).length });
  check('NWG-12', 'every database refusal is marked with the storeFailure flag the routes read',
    (repoSrc.match(/throw storeFailure\(/g) || []).length >= 17,
    { sites: (repoSrc.match(/throw storeFailure\(/g) || []).length });
  const notifLabels = ['device token registration', 'device token deactivation', 'notification feed',
    'notification read state', 'notification read-all', 'notification preferences', 'notification broadcast'];
  check('NWG-13', 'the eight notification routes hand store failures to the platform\'s existing classifier',
    (routeSrc.match(/err\.storeFailure/g) || []).length >= 8
    && notifLabels.every(label => routeSrc.includes(`replyStoreError(res, req, err, '${label}')`)),
    { markers: (routeSrc.match(/err\.storeFailure/g) || []).length,
      classifyCalls: (routeSrc.match(/replyStoreError\(/g) || []).length });

  // ============================================ fixtures, discovered not assumed
  const phones = new Map();
  for (const r of (await c.query('SELECT phone FROM public.users')).rows) {
    phones.set(norm(r.phone), (phones.get(norm(r.phone)) || 0) + 1);
  }
  const customer = (await c.query('SELECT id::text id, phone, name FROM public.users')).rows
    .filter(u => phones.get(norm(u.phone)) === 1 && /^\d{10}$/.test(norm(u.phone)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (!customer) {
    console.error('NWG ABORT: this database has no unambiguously-registered customer');
    process.exitCode = 1; await c.end(); return;
  }
  // A notification owned by somebody else, for the ownership check. Reading a row id
  // is not a write, and the mark-read UPDATE carries the owner predicate, so it can
  // never touch this row.
  const foreign = (await c.query(
    `SELECT id::text id FROM notifications WHERE recipient_user_id IS NOT NULL AND recipient_user_id <> $1::uuid
      ORDER BY created_at DESC LIMIT 1`, [customer.id])).rows[0];

  // One row, seven measurements. The three notification tables are fingerprinted with a
  // digest over the columns this path could write, so an added OR edited row cannot
  // hide behind an unchanged count.
  const FINGERPRINT = `SELECT
      (SELECT count(*)::int || ':' || coalesce(md5(string_agg(
          n.id::text || '|' || coalesce(n.title, '') || '|' || coalesce(n.body, '')
            || '|' || coalesce(n.notification_type, '') || '|' || coalesce(n.priority, '')
            || '|' || coalesce(n.is_read::text, ''), ',' ORDER BY n.id)), 'empty')
         FROM notifications n) AS notifications,
      (SELECT count(*)::int || ':' || coalesce(md5(string_agg(
          d.id::text || '|' || coalesce(d.device_token, '') || '|' || coalesce(d.platform, '')
            || '|' || coalesce(d.app_type, '') || '|' || coalesce(d.device_id, '')
            || '|' || coalesce(d.is_active::text, ''), ',' ORDER BY d.id)), 'empty')
         FROM device_tokens d) AS tokens,
      (SELECT count(*)::int || ':' || coalesce(md5(string_agg(
          p.id::text || '|' || coalesce(p.user_id::text, '') || '|' || coalesce(p.push_enabled::text, '')
            || '|' || coalesce(p.sms_enabled::text, '') || '|' || coalesce(p.email_enabled::text, '')
            || '|' || coalesce(p.in_app_enabled::text, ''), ',' ORDER BY p.id)), 'empty')
         FROM notification_preferences p) AS prefs,
      (SELECT count(*) FROM public.users)::int AS users,
      (SELECT count(*) FROM public.merchants)::int AS merchants,
      (SELECT count(*) FROM public.drivers)::int AS drivers,
      (SELECT count(*) FROM backend_sessions)::int AS sessions,
      (SELECT count(*) FROM audit_logs)::int AS audit`;
  const before = await c.query(FINGERPRINT);
  const base = before.rows[0];
  console.log(`  baseline residue: notifications=${String(base.notifications).slice(0, 16)}… `
    + `device_tokens=${String(base.tokens).slice(0, 16)}… prefs=${String(base.prefs).slice(0, 16)}… `
    + `users=${base.users} merchants=${base.merchants} drivers=${base.drivers} `
    + `sessions=${base.sessions} audit_logs=${base.audit}`);

  const bounds = {
    typeBound: typeCol ? typeCol.character_maximum_length : null,
    titleBound: titleCol ? titleCol.character_maximum_length : null,
    deviceIdBound: deviceIdCol ? deviceIdCol.character_maximum_length : null,
  };
  const fx = Object.assign({
    customerUuid: customer.id, customerPhone: norm(customer.phone), customerName: customer.name,
    foreignNotificationId: foreign ? foreign.id : null,
  }, caps, bounds);
  const fxJson = JSON.stringify(fx);
  await c.end();

  if (!Number.isInteger(bounds.typeBound) || !Number.isInteger(bounds.titleBound)
    || !Number.isInteger(bounds.deviceIdBound)) {
    console.error('NWG ABORT: the notification columns are not readable, so no bound can be built');
    process.exitCode = 1; return;
  }

  // ============================================ 2. repository, store unreachable
  const down = spawnRepoChild('repo_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
    NABIN_NWG_FX: fxJson,
  });
  const isCap = (r) => r && String(r.code || '').endsWith('_TOO_LONG');
  check('NWG-14', 'a notification_type one character over the column limit is refused with TYPE_TOO_LONG before the wire',
    down.ok === true && down.caps && down.caps.typeOver.threw === true
    && down.caps.typeOver.code === 'TYPE_TOO_LONG' && down.caps.typeOver.status === 400
    && down.caps.typeOver.unreachable === false,
    { code: down.caps && down.caps.typeOver.code, status: down.caps && down.caps.typeOver.status,
      unreachable: down.caps && down.caps.typeOver.unreachable, detail: down.detail });
  check('NWG-15', 'an over-limit title is refused with TITLE_TOO_LONG, not left to the engine',
    Boolean(down.caps) && down.caps.titleOver.threw === true && down.caps.titleOver.code === 'TITLE_TOO_LONG'
    && down.caps.titleOver.status === 400 && down.caps.titleOver.unreachable === false,
    { code: down.caps && down.caps.titleOver.code, status: down.caps && down.caps.titleOver.status });
  check('NWG-16', 'an over-limit deviceId is refused instead of being stored cut in half',
    Boolean(down.caps) && down.caps.deviceIdOver.threw === true
    && down.caps.deviceIdOver.code === 'DEVICE_ID_TOO_LONG' && down.caps.deviceIdOver.status === 400
    && down.caps.deviceIdOver.unreachable === false,
    { code: down.caps && down.caps.deviceIdOver.code });
  check('NWG-17', 'the three refusals name their field and its limit, and no column type',
    [down.caps.typeOver, down.caps.titleOver, down.caps.deviceIdOver].every(r => r
      && /exceeds maximum allowed length/.test(r.message) && /characters/.test(r.message)
      && r.leaked.length === 0),
    [down.caps.typeOver, down.caps.titleOver, down.caps.deviceIdOver].map(r => r && r.leaked));
  check('NWG-18', 'a value of exactly the column limit is NOT refused by the gate (it reaches the store)',
    Object.values(down.atLimit || {}).every(r => r.threw === true && r.unreachable === true && !isCap(r)),
    Object.entries(down.atLimit || {}).map(([k, r]) => `${k}:${r.code}`));
  check('NWG-19', 'an in-bounds notification is not answered as a caller error when the store is unreachable',
    Boolean(down.atLimit) && down.atLimit.valid.threw === true && down.atLimit.valid.unreachable === true
    && !(Number(down.atLimit.valid.status) >= 400 && Number(down.atLimit.valid.status) < 500),
    { status: down.atLimit && down.atLimit.valid.status, code: down.atLimit && down.atLimit.valid.code });
  check('NWG-20', 'no store failure on this path carries a 4xx status, so no route can blame the caller for it',
    Object.values(down.atLimit || {}).every(r => r.threw === true
      && (r.status === undefined || Number(r.status) >= 500)),
    Object.entries(down.atLimit || {}).map(([k, r]) => `${k}:${r.status}`));
  const methodNames = Object.keys(down.methods || {});
  check('NWG-21', 'all fifteen store-touching repository methods report an outage as an outage',
    methodNames.length === 15 && methodNames.every(n => down.methods[n].threw === true
      && down.methods[n].unreachable === true),
    methodNames.filter(n => !(down.methods[n].threw && down.methods[n].unreachable))
      .map(n => `${n}:${down.methods[n].code}/${down.methods[n].status}`));
  check('NWG-22', 'and not one of them is marked a caller error while the store is gone',
    methodNames.every(n => !(Number(down.methods[n].status) >= 400 && Number(down.methods[n].status) < 500)),
    methodNames.filter(n => Number(down.methods[n].status) >= 400 && Number(down.methods[n].status) < 500));
  check('NWG-23', 'the refusal wording is ours in every case: no engine sentence reaches the message',
    methodNames.concat(['valid']).every(n => {
      const r = (n === 'valid' ? down.atLimit.valid : down.methods[n]);
      return Boolean(r) && !/Failed to .*: /.test(String(r.message || ''));
    }),
    methodNames.filter(n => /Failed to .*: /.test(String((down.methods[n] || {}).message || ''))));
  // Numbered last because it was added with the repository evidence above; it prints here so the
  // store-side claims stay together. The collision recovery read is the one state where the route
  // used to answer `200 {success: true, deviceToken: null}` — a registration nothing confirmed.
  check('NWG-60', 'a 23505 whose recovery read finds no row is a refusal, never an unconfirmed success',
    Boolean(down.collisionNull) && down.collisionNull.threw === true
    && down.collisionNull.storeFailure === true && down.collisionNull.code === '23505'
    && down.collisionNull.unreachable === false,
    { threw: down.collisionNull && down.collisionNull.threw,
      code: down.collisionNull && down.collisionNull.code,
      value: down.collisionNull && down.collisionNull.value === undefined
        ? 'undefined' : (down.collisionNull && down.collisionNull.value === null ? 'null' : 'a row'),
      message: down.collisionNull && String(down.collisionNull.message || '').slice(0, 90) });

  // ============================================ 3. routes, store working (reads and refusals only)
  const livePort = await findFreePort();
  const liveChild = await spawnServerChild('serve_live', livePort);
  const liveBase = `http://127.0.0.1:${livePort}`;
  let liveRefusals = [];
  try {
    const token = await mintCustomerToken(liveBase, fx);
    const adminToken = await mintAdminToken(liveBase);
    check('NWG-24', 'a real registered customer and a real administrator authenticate over HTTP',
      liveChild.verdict.ok === true && Boolean(token) && Boolean(adminToken), { port: livePort });

    const feed = await request('GET', liveBase, '/api/notifications?limit=2&offset=0', null, token);
    check('NWG-25', 'GET /api/notifications still answers the real feed contract over a live store',
      feed.status === 200 && feed.data.success === true && Array.isArray(feed.data.notifications)
      && Number.isInteger(feed.data.total) && Number.isInteger(feed.data.unreadCount)
      && feed.data.limit === 2 && feed.data.offset === 0,
      { status: feed.status, keys: Object.keys(feed.data), total: feed.data.total });

    const clamped = await request('GET', liveBase, '/api/notifications?limit=5000', null, token);
    check('NWG-26', 'the feed cap is still clamped at 100 rather than passed to the store',
      clamped.status === 200 && clamped.data.limit === 100, { limit: clamped.data.limit });

    const malformed = await request('PUT', liveBase, '/api/notifications/nwg-not-a-uuid/read', {}, token);
    check('NWG-27', 'a malformed notification id is the caller\'s problem (400 INVALID_VALUE), never a store failure',
      malformed.status === 400 && malformed.data.code === 'INVALID_VALUE' && malformed.data.success === false,
      { status: malformed.status, code: malformed.data.code, error: String(malformed.data.error || '').slice(0, 90) });

    const foreignRes = fx.foreignNotificationId
      ? await request('PUT', liveBase, `/api/notifications/${fx.foreignNotificationId}/read`, {}, token)
      : { status: 0, data: {} };
    check('NWG-28', 'a notification belonging to another account is refused (404) and its row is not marked read',
      Boolean(fx.foreignNotificationId) && foreignRes.status === 404 && foreignRes.data.code === 'NOT_FOUND',
      { status: foreignRes.status, code: foreignRes.data.code, lookedFor: fx.foreignNotificationId });

    const anon = [
      await request('POST', liveBase, '/api/notifications/device-token', { deviceToken: 'nwg-anon' }),
      await request('GET', liveBase, '/api/notifications', null),
      await request('PUT', liveBase, '/api/notifications/read-all', {}),
      await request('GET', liveBase, '/api/notifications/preferences', null),
      await request('PUT', liveBase, '/api/notifications/preferences', { pushEnabled: false }),
    ];
    check('NWG-29', 'authentication is required on all five self-scoped routes, before any validation',
      anon.every(r => r.status === 401), anon.map(r => r.status));

    const BCAST = '/api/admin/notifications/broadcast';
    const refusals = [
      await request('POST', liveBase, BCAST, { body: 'no title here', audience: 'ALL' }, adminToken),
      await request('POST', liveBase, BCAST, { title: repeat(fx.titleBound + 1), body: 'x', audience: 'ALL' }, adminToken),
      await request('POST', liveBase, BCAST, { title: 'nwg probe', audience: 'ALL' }, adminToken),
      await request('POST', liveBase, BCAST, { title: 'nwg probe', body: repeat(2001), audience: 'ALL' }, adminToken),
      await request('POST', liveBase, BCAST, { title: 'nwg probe', body: 'x', audience: 'PARTNERS' }, adminToken),
      await request('POST', liveBase, BCAST, { title: 'nwg probe', body: 'x', audience: 'ALL', priority: 'MEGA' }, adminToken),
      await request('POST', liveBase, BCAST, { title: 'nwg probe', body: 'password: hunter2', audience: 'ALL' }, adminToken),
      await request('POST', liveBase, BCAST, {
        title: 'nwg probe', body: 'x', audience: 'ALL',
        notificationType: repeat(fx.typeBound + 1).toUpperCase() }, adminToken),
      await request('POST', liveBase, '/api/notifications/device-token',
        { deviceToken: 'nwg-probe', platform: 'WINDOWS' }, token),
      await request('POST', liveBase, '/api/notifications/device-token',
        { deviceToken: repeat(1025) }, token),
      await request('POST', liveBase, '/api/notifications/device-token',
        { deviceToken: 'nwg-probe', platform: 'ANDROID', appType: 'ROBOT' }, token),
      await request('POST', liveBase, '/api/notifications/device-token',
        { deviceToken: 'nwg-probe', platform: 'ANDROID', appType: 'CUSTOMER', deviceId: repeat(fx.deviceIdBound + 1) }, token),
    ];
    liveRefusals = refusals;
    const codes = refusals.map(r => r.data.code);
    check('NWG-30', 'the broadcast refuses each invalid field with its own named code and a 400',
      refusals.slice(0, 8).every(r => r.status === 400 && r.data.success === false)
      && codes[0] === 'MISSING_TITLE' && codes[1] === 'TITLE_TOO_LONG' && codes[2] === 'MISSING_BODY'
      && codes[3] === 'BODY_TOO_LONG' && codes[4] === 'INVALID_AUDIENCE' && codes[5] === 'INVALID_PRIORITY'
      && codes[6] === 'SENSITIVE_CONTENT_DETECTED' && codes[7] === 'TYPE_TOO_LONG',
      { codes, statuses: refusals.map(r => r.status) });
    check('NWG-31', 'the device-token route refuses a bad platform, an over-long token, a bad appType and an over-long deviceId',
      refusals.slice(8).every(r => r.status === 400) && codes[8] === 'INVALID_PLATFORM'
      && codes[9] === 'TOKEN_TOO_LONG' && codes[10] === 'INVALID_APP_TYPE'
      && codes[11] === 'DEVICE_ID_TOO_LONG',
      { codes: codes.slice(8), statuses: refusals.slice(8).map(r => r.status) });
    check('NWG-32', 'the refusals that name a limit state the limit they used, which is the column',
      String(refusals[1].data.error || '').includes(String(fx.titleBound))
      && String(refusals[11].data.error || '').includes(String(fx.deviceIdBound)),
      { title: refusals[1].data.error, deviceId: refusals[11].data.error });
    check('NWG-33', 'no refusal body leaks a column type, a constraint, an SQLSTATE, a relation or an index name',
      liveRefusals.every(r => leaksIn(r.text, SCHEMA_MARKERS).length === 0),
      liveRefusals.map(r => ({ status: r.status, leaks: leaksIn(r.text, SCHEMA_MARKERS) })));
    check('NWG-34', 'no refusal body leaks a credential, the connection target or a stack frame',
      liveRefusals.every(r => leaksIn(r.text, SECRET_MARKERS).length === 0),
      liveRefusals.map(r => ({ status: r.status, leaks: leaksIn(r.text, SECRET_MARKERS) })));
  } finally {
    liveChild.proc.kill();
  }

  // ============================================ 4. routes, the store refusing in four different ways
  const perKind = [];
  for (let i = 0; i < FAKE_KINDS.length; i++) {
    const spec = FAKE_KINDS[i];
    const base = 35 + i * 5;
    const port = await findFreePort();
    const child = await spawnServerChild('serve_fake', port, { NABIN_NWG_FAKE: spec.kind });
    const baseUrl = `http://127.0.0.1:${port}`;
    const token = await mintCustomerToken(baseUrl, fx);
    const adminToken = await mintAdminToken(baseUrl);
    const rows = [];
    try {
      // Every route in the region, one store answer at a time. `what` is the label the
      // route gives the classifier, so the copy that comes back identifies the route.
      const routes = [
        { name: 'device-token register', method: 'POST', path: '/api/notifications/device-token',
          body: { deviceToken: 'nwg-probe-token', platform: 'ANDROID', appType: 'CUSTOMER' },
          what: 'device token registration', absent: 'deviceToken' },
        { name: 'device-token deactivate', method: 'DELETE', path: '/api/notifications/device-token',
          body: { deviceToken: 'nwg-probe-token' }, what: 'device token deactivation', absent: 'deactivated' },
        { name: 'feed', method: 'GET', path: '/api/notifications?limit=2',
          what: 'notification feed', absent: 'notifications' },
        { name: 'mark read', method: 'PUT', path: '/api/notifications/00000000-0000-0000-0000-000000000000/read',
          body: {}, what: 'notification read state', absent: 'notification' },
        { name: 'mark all read', method: 'PUT', path: '/api/notifications/read-all',
          body: {}, what: 'notification read-all', absent: 'updatedCount' },
        { name: 'preferences read', method: 'GET', path: '/api/notifications/preferences',
          what: 'notification preferences', absent: 'preferences' },
        { name: 'preferences write', method: 'PUT', path: '/api/notifications/preferences',
          body: { pushEnabled: false }, what: 'notification preferences', absent: 'preferences' },
        { name: 'broadcast', method: 'POST', path: '/api/admin/notifications/broadcast',
          body: { title: 'nwg probe', body: 'probe body', audience: 'ALL', priority: 'HIGH' },
          what: 'notification broadcast', absent: 'recipientCount' },
      ];
      const answers = [];
      for (const r of routes) {
        const res = await request(r.method, baseUrl, r.path, r.body, token || adminToken ? (r.name === 'broadcast' ? adminToken : token) : undefined);
        rows.push(res);
        answers.push({
          route: r.name, status: res.status, code: res.data.code,
          classified: res.status === spec.status && res.data.code === spec.code && res.data.success === false,
          labelled: String(res.data.error || '').includes(r.what),
          fabricated: res.data[r.absent] !== undefined,
        });
      }
      check(`NWG-${base}`, `store answer ${spec.kind} is classified as ${spec.status} ${spec.code} on all eight notification routes`,
        child.verdict.ok === true && Boolean(token) && Boolean(adminToken)
        && answers.length === 8 && answers.every(a => a.classified),
        answers.filter(a => !a.classified));
      check(`NWG-${base + 1}`, `with store ${spec.kind} each route names itself, so the reply says which call failed`,
        answers.every(a => a.labelled), answers.filter(a => !a.labelled).map(a => a.route));
      check(`NWG-${base + 2}`, `with store ${spec.kind} no route reports the success fields it did not earn`,
        answers.every(a => !a.fabricated), answers.filter(a => a.fabricated).map(a => a.route));
      check(`NWG-${base + 3}`, `with store ${spec.kind} a gate refusal still fires first, so the boundary is not bypassed`,
        (await request('POST', baseUrl, '/api/admin/notifications/broadcast',
          { title: 'nwg probe', body: 'x', audience: 'ALL', priority: 'MEGA' }, adminToken)).status === 400
        && (await request('POST', baseUrl, '/api/notifications/device-token',
          { deviceToken: 'nwg-probe', platform: 'WINDOWS' }, token)).status === 400
        && (await request('POST', baseUrl, '/api/notifications/device-token',
          { deviceToken: 'nwg-probe', deviceId: repeat(fx.deviceIdBound + 1) }, token)).status === 400
        && (await request('POST', baseUrl, '/api/notifications/device-token',
          { deviceToken: repeat(1025), platform: 'ANDROID' }, token)).status === 400,
        { note: '400 expected on all four refusals' });
      check(`NWG-${base + 4}`, `no ${spec.kind} failure body carries PostgreSQL's words, a stack frame or the target`,
        rows.every(r => leaksIn(r.text, SCHEMA_MARKERS).length === 0
          && leaksIn(r.text, SECRET_MARKERS).length === 0),
        rows.map(r => ({ status: r.status,
          leaks: [...leaksIn(r.text, SCHEMA_MARKERS), ...leaksIn(r.text, SECRET_MARKERS)] })));
    } finally {
      child.proc.kill();
      perKind.push(spec.kind);
    }
  }

  // ============================================ 5. the fan-out states what was delivered
  // Source-level by necessity — see the header. Read off the broadcast route itself.
  const region = routeSrc;
  check('NWG-55', 'the broadcast answers the count of rows the store confirmed, not the size of the audience',
    /recipientCount:\s*notifiedCount/.test(region) && !/recipientCount:\s*targetUsers\.length/.test(region)
    && /const notifiedCount = dispatchResults\.filter\(r => r && r\.success === true\)\.length;/.test(region),
    { recipientCount: (region.match(/recipientCount:[^,\n]*/) || [''])[0].trim() });
  check('NWG-56', 'the fan-out cap is a named constant that is applied, and the response discloses both numbers',
    /const BROADCAST_MAX_RECIPIENTS = (\d+);/.test(region)
    && /targetUsers\.slice\(0, BROADCAST_MAX_RECIPIENTS\)/.test(region)
    && /audienceSize:\s*targetUsers\.length/.test(region) && /truncated,/.test(region),
    { cap: (region.match(/const BROADCAST_MAX_RECIPIENTS = (\d+)/) || [])[1] || null });
  check('NWG-57', 'the audit record states notified-of-total, so the trail matches the answer the admin got',
    /Recipients notified: \$\{notifiedCount\} of \$\{targetUsers\.length\}/.test(region),
    { reason: (region.match(/Recipients notified:[^`]*/) || [''])[0].slice(0, 120) });

  // ============================================ 6. residue: measured, and proven to be only auth
  const c2 = new Client({ connectionString: PG });
  await c2.connect();
  const after = (await c2.query(FINGERPRINT)).rows[0];
  await c2.end();
  check('NWG-58', 'notifications, device_tokens and notification_preferences are byte-for-byte identical after the whole run',
    after.notifications === base.notifications && after.tokens === base.tokens && after.prefs === base.prefs,
    { notifications: `${String(base.notifications).slice(0, 12)}… -> ${String(after.notifications).slice(0, 12)}…`,
      tokens: `${String(base.tokens).slice(0, 12)}… -> ${String(after.tokens).slice(0, 12)}…`,
      prefs: `${String(base.prefs).slice(0, 12)}… -> ${String(after.prefs).slice(0, 12)}…` });
  check('NWG-59', 'no identity row appeared either — the only growth is the sessions and audit this run authenticated',
    after.users === base.users && after.merchants === base.merchants && after.drivers === base.drivers,
    { users: `${base.users} -> ${after.users}`, merchants: `${base.merchants} -> ${after.merchants}`,
      sessions: `${base.sessions} -> ${after.sessions}`, audit: `${base.audit} -> ${after.audit}`,
      fakesExercised: perKind });

  const failed = results.filter(r => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 NOTIFICATION WRITE GUARD: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed`);
  console.log(`   residue: notification tables unchanged=${after.notifications === base.notifications
    && after.tokens === base.tokens && after.prefs === base.prefs}, `
    + `backend_sessions +${Number(after.sessions) - Number(base.sessions)}, `
    + `audit_logs +${Number(after.audit) - Number(base.audit)} `
    + `(${1 + FAKE_KINDS.length} customer OTP logins and ${1 + FAKE_KINDS.length} admin logins over ${1 + FAKE_KINDS.length} server children)`);
  console.log('========================================================================');
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_NWG_CHILD) {
  runChild(process.env.NABIN_NWG_CHILD).catch(err => {
    console.log(`NWG_VERDICT ${JSON.stringify({ scenario: process.env.NABIN_NWG_CHILD, ok: false, crashed: err.message })}`);
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('NWG ABORTED:', err.message);
    process.exit(2);
  });
}
