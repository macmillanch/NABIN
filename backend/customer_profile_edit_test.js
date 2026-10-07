// =========================================================================
// CUSTOMER PROFILE EDIT CHECKS (local only)
//
// `PATCH /api/customer/profile` is the first route that lets a signed-in customer
// change their own `users.name` or `users.email`. Those two columns used to have
// exactly one writer each, and neither was the customer: sign-in minted a placeholder
// address (`<phone>@user.nabin.in`) and the identity submission copied whatever the
// applicant typed into both. So the profile screen showed a name and an address the
// person on the other end could not correct.
//
// The guarantees worth pinning here are the ones a profile write can break:
//
//   1. Only the caller's own row moves. Nothing in the route or the repository takes a
//      customer id from the request as authority — the row is the one the bearer token
//      resolved to. A body that names another account must change nothing there.
//   2. Only two columns move. `wallet_balance`, `account_status`, `identity_status`,
//      `phone`, `dob`, `address` and `rating` must be identical before and after,
//      including when the body claims to set them.
//   3. An address belongs to one account (migration 035), and the collision is answered
//      as a conflict rather than a retry-me outage.
//   4. The answer is the row, not the request: the response and `GET /api/auth/me` both
//      have to report what PostgreSQL actually stored, after trimming and lowercasing.
//   5. A refusal is a refusal — 400 for a value outside the domain, 401 for no session,
//      and no write behind any of them.
//
// Local-only by construction, and the fixture ownership rule is the reason it can be:
// this suite INSERTs nothing and deletes only rows it can prove this run minted. It
// refuses a non-loopback API target, refuses a non-loopback DATABASE_URL, refuses
// NODE_ENV=production, refuses to start if a probe phone already owns a `users` row,
// and refuses to delete a row that was not created after this process started. So the
// worst case is "the suite declined", never "a real customer lost their profile".
//
// It is NOT registered as a chain link — it provisions and destroys accounts, which the
// chain does not do. Run it on its own against a warm local backend:
//
//   node customer_profile_edit_test.js
//   NABIN_TEST_BASE_URL=http://127.0.0.1:4000 node customer_profile_edit_test.js
// =========================================================================
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet: true });

const http = require('http');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createLogin } = require('./testSessionCache');
const { trackServer, reapAndWait } = require('./scripts/spawned_server');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

// Mutable because the suite may either ride a backend the operator already started or
// spawn its own on a free port. Everything that talks to the server reads it at call
// time; nothing captures it at require time.
let baseUrl = process.env.NABIN_TEST_BASE_URL
  || `http://127.0.0.1:${process.env.PORT || 4000}`;

// Built once the server is known, because `createLogin` closes over the base URL.
let login = null;

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch (e) {
    return '';
  }
}

function isLoopback(url) {
  return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(hostnameOf(url));
}

function request(method, urlPath, body, headers = {}) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(urlPath, baseUrl); } catch (e) { return resolve({ status: 0, data: null, error: String(e) }); }
    const payload = body === null || body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: `${url.pathname}${url.search}`,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      },
      timeout: 20000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = { unparsed: raw.slice(0, 300) }; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (err) => resolve({ status: 0, data: null, error: err.code || String(err) }));
    if (payload) req.write(payload);
    req.end();
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });
const patchProfile = (token, body) => request('PATCH', '/api/customer/profile', body, auth(token));

// ---------------------------------------------------------------- durable reads

const USER_COLUMNS = 'id, name, phone, email, dob, address, rating, wallet_balance, '
  + 'identity_status, account_status, created_at, updated_at';

let pgClient = null;

async function connectStore() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (backend/.env) — this suite compares the API answer against the durable row, so it cannot run without one.');
  }
  if (!isLoopback(connectionString)) {
    throw new Error(`DATABASE_URL points at ${hostnameOf(connectionString)} — refusing to delete customer rows from a hosted database.`);
  }
  const { Client } = require('pg');
  pgClient = new Client({ connectionString });
  await pgClient.connect();
}

async function readUser(id) {
  const { rows } = await pgClient.query(
    `SELECT ${USER_COLUMNS} FROM public.users WHERE id = $1::uuid`, [id]
  );
  return rows[0] || null;
}

/** The columns a profile write must never touch, plus the ones it must. */
function snapshot(row) {
  if (!row) return null;
  return {
    id: row.id, name: row.name, phone: row.phone, email: row.email, dob: row.dob,
    address: row.address, rating: row.rating, wallet_balance: row.wallet_balance,
    identity_status: row.identity_status, account_status: row.account_status,
    created_at: String(row.created_at), updated_at: String(row.updated_at)
  };
}

function diffOf(before, after) {
  if (!before || !after) return ['<missing row>'];
  const changed = [];
  for (const key of Object.keys(before)) {
    if (String(before[key]) !== String(after[key])) changed.push(`${key}: ${before[key]} → ${after[key]}`);
  }
  return changed;
}

/** Only these may differ after a successful profile write. */
function unexpectedMovements(before, after) {
  return diffOf(before, after).filter(d =>
    !(d.startsWith('name:') || d.startsWith('email:') || d.startsWith('updated_at:')));
}

// Two sources serialise the same instant differently: PostgREST returns an ISO string and
// node-postgres returns a Date, so a string comparison would fail on every green run.
// Compare the instant, with a second of tolerance for the round trip.
function sameInstant(a, b) {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) <= 1000;
}

// ---------------------------------------------------------------- fixtures

// `runStamp` is the last 8 digits of the clock, so a probe phone is `9` + those 8 digits
// + a distinct final digit: ten digits, which the OTP path normalises to `+91…`. Seeded
// and hand-made accounts are not in that shape, and `assertPhonesUnclaimed` refuses the
// run if any of them is — this suite is not allowed to discover it owns somebody's row
// by signing into it.
const runStamp = String(Date.now()).slice(-8);
const PHONE_A = `9${runStamp}0`;
const PHONE_B = `9${runStamp}1`;
const ADDRESS_A = `cp-${runStamp}-a@probe.nabin.test`;
const ADDRESS_B = `cp-${runStamp}-b@probe.nabin.test`;
const PLACEHOLDER_SUFFIX = '@user.nabin.in';

async function assertPhonesUnclaimed() {
  const forms = [PHONE_A, PHONE_B, `+91${PHONE_A}`, `+91${PHONE_B}`];
  const { rows } = await pgClient.query(
    `SELECT phone FROM public.users WHERE phone = ANY($1::text[])`, [forms]
  );
  if (rows.length > 0) {
    throw new Error(`refusing to run: probe phone(s) ${rows.map(r => r.phone).join(', ')} already own a users row. `
      + 'Editing and then deleting that account would destroy somebody\'s profile.');
  }
}

const ownedProbeIds = [];
const startedAt = Date.now();

/**
 * Sign two probe phones in through the real OTP path, then prove the rows behind those
 * sessions are this run's own. The proof is what makes teardown safe: a row this suite
 * did not mint is a row this suite must not delete.
 */
async function provision() {
  const a = await login(PHONE_A, 'CUSTOMER');
  const b = await login(PHONE_B, 'CUSTOMER');
  if (!a.token || !b.token) {
    throw new Error(`customer sign-in failed — ${JSON.stringify(a.failure || b.failure)}`);
  }
  const idOf = (user) => String(user && (user.uuid || user.id) || '');
  const idA = idOf(a.user);
  const idB = idOf(b.user);
  if (!idA || !idB) throw new Error('the signed-in session did not carry a resolvable account id');

  for (const [label, id] of [['A', idA], ['B', idB]]) {
    const row = await readUser(id);
    if (!row) throw new Error(`probe ${label} signed in but has no users row (id ${id})`);
    const mintedThisRun = new Date(row.created_at).getTime() >= startedAt - 5000;
    if (!mintedThisRun || String(row.name) !== 'New NABIN Customer'
      || !String(row.email || '').endsWith(PLACEHOLDER_SUFFIX)) {
      throw new Error(`probe ${label} does not look like a row this run minted `
        + `(name ${JSON.stringify(row.name)}, email ${JSON.stringify(row.email)}, created ${row.created_at}); `
        + 'refusing to edit or delete it.');
    }
    ownedProbeIds.push(id);
  }
  return { tokenA: a.token, tokenB: b.token, idA, idB };
}

// ---------------------------------------------------------------- the checks

async function run(f) {
  const { tokenA, tokenB, idA, idB } = f;

  // --- the two writes that are the feature -------------------------------------
  const baselineA = snapshot(await readUser(idA));
  const renamed = await patchProfile(tokenA, { name: '  Priya Chakma  ' });
  const rowAfterRename = snapshot(await readUser(idA));
  check('CP-01', renamed.status === 200 && renamed.data && renamed.data.success === true
    && rowAfterRename.name === 'Priya Chakma'
    && unexpectedMovements(baselineA, rowAfterRename).length === 0,
    `name update: HTTP ${renamed.status}, stored name ${JSON.stringify(rowAfterRename.name)} (the padding was `
    + `trimmed by the server, not the client), unexpected columns moved [${unexpectedMovements(baselineA, rowAfterRename).join('; ') || 'none'}]`);

  const beforeEmail = snapshot(await readUser(idA));
  const emailed = await patchProfile(tokenA, { email: `  CP-Probe-${runStamp}@Example.Test  ` });
  const rowAfterEmail = snapshot(await readUser(idA));
  const expectedEmail = `cp-probe-${runStamp}@example.test`;
  check('CP-02', emailed.status === 200 && emailed.data && Array.isArray(emailed.data.changed)
    && emailed.data.changed.includes('email')
    && rowAfterEmail.email === expectedEmail
    && rowAfterEmail.name === 'Priya Chakma'
    && unexpectedMovements(beforeEmail, rowAfterEmail).length === 0,
    `email update: HTTP ${emailed.status}, stored ${JSON.stringify(rowAfterEmail.email)} against the expected `
    + `${JSON.stringify(expectedEmail)} (padding trimmed and case folded by the server), changed `
    + `${JSON.stringify(emailed.data && emailed.data.changed)}, and the name from CP-01 survived it`);

  // --- the answer is the row, not the request -----------------------------------
  const stored = await readUser(idA);
  const profile = emailed.data && emailed.data.profile;
  check('CP-03', Boolean(profile) && profile.id === stored.id
    && profile.name === stored.name && profile.email === stored.email
    && sameInstant(profile.updatedAt, stored.updated_at)
    && emailed.data.persisted === true && emailed.data.dataSource === 'postgres',
    `success body carries the persisted row: ${JSON.stringify(profile && { id: profile.id, name: profile.name, email: profile.email })} `
    + `and updatedAt matches the stored updated_at as an instant (${profile && profile.updatedAt} vs ${stored.updated_at})`);

  const me = await request('GET', '/api/auth/me', null, auth(tokenA));
  const meUser = me.data && me.data.user;
  check('CP-04', me.status === 200 && meUser && meUser.name === stored.name
    && meUser.email === stored.email,
    `/api/auth/me agrees without re-authenticating: ${JSON.stringify(meUser && { name: meUser.name, email: meUser.email })} `
    + `(a stale mint-time snapshot would still show the placeholder address)`);
  check('CP-05', me.status === 200 && meUser && !('rating' in meUser),
    'the self read still withholds `rating` — the profile write did not reopen the #140 ruling');

  // --- authentication is not optional ------------------------------------------
  const beforeAnon = snapshot(await readUser(idA));
  const noHeader = await request('PATCH', '/api/customer/profile', { name: 'Anonymous Edit' });
  const badToken = await patchProfile('not-a-session-anywhere-issued-this', { name: 'Anonymous Edit' });
  const afterAnon = snapshot(await readUser(idA));
  check('CP-06', noHeader.status === 401 && badToken.status === 401
    && noHeader.data && noHeader.data.success === false && diffOf(beforeAnon, afterAnon).length === 0,
    `no session and a forged token are both 401 with zero movement (got ${noHeader.status}/${badToken.status})`);

  // --- validation ---------------------------------------------------------------
  const badValues = [
    ['name blank', { name: '   ' }, 'name'],
    ['name 101 characters', { name: 'a'.repeat(101) }, 'name'],
    ['name not text', { name: 42 }, 'name'],
    ['email with no @', { email: 'priya.example.com' }, 'email'],
    ['email with no domain label', { email: 'priya@example' }, 'email'],
    ['email with a space', { email: 'priya chakma@example.com' }, 'email'],
    ['email 151 characters', { email: `${'p'.repeat(140)}@example.com` }, 'email'],
  ];
  for (const [label, body, field] of badValues) {
    const before = snapshot(await readUser(idA));
    const res = await patchProfile(tokenA, body);
    const after = snapshot(await readUser(idA));
    check(`CP-07/${label}`, res.status === 400 && res.data && res.data.success === false
      && res.data.code === 'INVALID_CUSTOMER_PROFILE' && res.data.field === field
      && diffOf(before, after).length === 0,
      `HTTP ${res.status} code ${res.data && res.data.code} field ${res.data && res.data.field}, `
      + `row unmoved: ${diffOf(before, after).length === 0}`);
  }

  const emptyPatch = await patchProfile(tokenA, {});
  const idOnly = await patchProfile(tokenA, { userId: idB });
  check('CP-08', emptyPatch.status === 400 && emptyPatch.data && emptyPatch.data.code === 'NO_PROFILE_FIELDS'
    && idOnly.status === 400 && idOnly.data && idOnly.data.code === 'NO_PROFILE_FIELDS',
    `an empty body and a body whose only key is somebody's id both refuse with NO_PROFILE_FIELDS `
    + `(got ${emptyPatch.status}/${idOnly.status}) — a name is not inferred from an id`);

  // --- only the caller's own row -------------------------------------------------
  const baselineB = snapshot(await readUser(idB));
  const impersonating = await patchProfile(tokenA, {
    userId: idB, id: idB, uuid: idB, customer_id: idB,
    name: 'Written Into Another Account'
  });
  const afterB = snapshot(await readUser(idB));
  const afterA = snapshot(await readUser(idA));
  check('CP-09', impersonating.status === 200 && impersonating.data
    && impersonating.data.profile.id === idA
    && diffOf(baselineB, afterB).length === 0
    && afterA.name === 'Written Into Another Account',
    `a body naming account B changed only A: B moved [${diffOf(baselineB, afterB).join('; ') || 'nothing'}], `
    + `A is now ${JSON.stringify(afterA.name)}, and the response is A's row (${impersonating.data.profile && impersonating.data.profile.id})`);
  // Put A back to the values the rest of the run reasons about.
  await patchProfile(tokenA, { name: 'Priya Chakma', email: ADDRESS_A });

  // --- unrelated fields cannot be reached ---------------------------------------
  const beforePrivileged = snapshot(await readUser(idA));
  const privileged = await patchProfile(tokenA, {
    name: 'Priya Chakma',
    email: ADDRESS_A,
    wallet_balance: 999999.00,
    walletBalance: 999999.00,
    account_status: 'BLOCKED',
    accountStatus: 'BLOCKED',
    identity_status: 'VERIFIED',
    identityStatus: 'VERIFIED',
    rating: 5.0,
    phone: '9999999999',
    dob: '1900-01-01',
    address: 'Somebody Else Street',
    role: 'SUPER_ADMIN'
  });
  const afterPrivileged = snapshot(await readUser(idA));
  const moved = unexpectedMovements(beforePrivileged, afterPrivileged);
  // String() on each pair, not `===`: `dob` and `created_at` come back from node-postgres as
  // Date objects, so two reads of one unchanged value are never reference-equal, and a
  // `===` here would fail on a row that did not move at all.
  const unchanged = [
    ['wallet_balance', afterPrivileged.wallet_balance, beforePrivileged.wallet_balance],
    ['account_status', afterPrivileged.account_status, 'ACTIVE'],
    ['identity_status', afterPrivileged.identity_status, 'PENDING'],
    ['phone', afterPrivileged.phone, beforePrivileged.phone],
    ['dob', afterPrivileged.dob, beforePrivileged.dob],
    ['address', afterPrivileged.address, beforePrivileged.address],
    ['rating', afterPrivileged.rating, beforePrivileged.rating]
  ].filter(([, actual, expected]) => String(actual) !== String(expected));
  check('CP-10', privileged.status === 200 && moved.length === 0 && unchanged.length === 0
    && afterPrivileged.email === ADDRESS_A,
    `thirteen privilege-carrying keys in the body moved exactly two columns; unexpected [${moved.join('; ') || 'none'}], `
    + `drifted [${unchanged.map(([k, a, e]) => `${k}: ${a} vs ${e}`).join('; ') || 'none'}] `
    + `(wallet ${afterPrivileged.wallet_balance}, status ${afterPrivileged.account_status}, `
    + `identity ${afterPrivileged.identity_status}, phone ${afterPrivileged.phone}, dob ${afterPrivileged.dob})`);

  // --- one address, one account --------------------------------------------------
  const bSetup = await patchProfile(tokenB, { email: ADDRESS_B });
  const beforeDup = snapshot(await readUser(idA));
  const duplicate = await patchProfile(tokenA, { email: ADDRESS_B });
  const afterDupA = snapshot(await readUser(idA));
  const afterDupB = snapshot(await readUser(idB));
  check('CP-11', bSetup.status === 200 && duplicate.status === 409
    && duplicate.data && duplicate.data.success === false
    && duplicate.data.code === 'EMAIL_ALREADY_USED'
    && diffOf(beforeDup, afterDupA).length === 0
    && afterDupB.email === ADDRESS_B,
    `an address held by B is refused for A as 409 ${duplicate.data && duplicate.data.code}: `
    + `${JSON.stringify(duplicate.data && duplicate.data.error)} with both rows unmoved`);

  // The index is the backstop for the case the pre-check cannot see: an address stored in
  // another case by a writer that does not normalise (the identity submission does exactly
  // that), so the route's lowercased equality test walks past it and only PostgreSQL stops
  // the write. Seeded here with SQL because no route in the app can produce it.
  const LEGACY_MIXED = `MixedCase-${runStamp}@probe.nabin.test`;
  await pgClient.query('UPDATE public.users SET email = $1 WHERE id = $2::uuid', [LEGACY_MIXED, idB]);
  const beforeBackstop = snapshot(await readUser(idA));
  const caseVariant = await patchProfile(tokenA, { email: LEGACY_MIXED.toLowerCase() });
  const afterBackstop = snapshot(await readUser(idA));
  check('CP-12', caseVariant.status === 409 && caseVariant.data && caseVariant.data.code === 'EMAIL_ALREADY_USED'
    && diffOf(beforeBackstop, afterBackstop).length === 0,
    `migration 035's index caught what the equality pre-check could not `
    + `(${JSON.stringify(LEGACY_MIXED)} stored vs ${JSON.stringify(LEGACY_MIXED.toLowerCase())} asked): `
    + `HTTP ${caseVariant.status}, A's row unmoved ${diffOf(beforeBackstop, afterBackstop).length === 0}`);

  // --- "not stated" is a representable state -------------------------------------
  const cleared = await patchProfile(tokenA, { email: '' });
  const clearedB = await patchProfile(tokenB, { email: '   ' });
  const rowClearedA = await readUser(idA);
  const rowClearedB = await readUser(idB);
  check('CP-13', cleared.status === 200 && clearedB.status === 200 && cleared.data
    && rowClearedA.email === null && rowClearedB.email === null
    && cleared.data.profile.email === null,
    `an emptied address means "not stated": both rows are NULL and two NULLs do not collide `
    + `(migration 035 keeps NULL and empty outside the uniqueness rule)`);

  // --- a refusal must not look like a success, or leak internals -----------------
  const storeShaped = await patchProfile(tokenA, { name: 'x'.repeat(300) });
  check('CP-14', storeShaped.status === 400 && storeShaped.data && storeShaped.data.success === false
    && storeShaped.data.code === 'INVALID_CUSTOMER_PROFILE'
    && !/stack|at Object\.|postgres|PostgREST|supabase/i.test(JSON.stringify(storeShaped.data)),
    `over-length input is a 400 with the caller's own reason and no internal detail: `
    + `${JSON.stringify(storeShaped.data && storeShaped.data.error)}`);

  // --- the trail exists, and holds no credential ---------------------------------
  const { rows: auditRows } = await pgClient.query(
    `SELECT action, role, module, target_entity_id, previous_state, new_state, metadata, reason
       FROM public.audit_logs
      WHERE target_entity_id = $1 AND action = 'CUSTOMER_PROFILE_UPDATED'`, [idA]
  );
  const trail = auditRows[0] || null;
  check('CP-15', auditRows.length > 0 && trail.role === 'CUSTOMER' && trail.module === 'CUSTOMER'
    && trail.previous_state && trail.new_state && String(trail.target_entity_id) === String(idA),
    `${auditRows.length} CUSTOMER_PROFILE_UPDATED audit row(s) for this account, `
    + `role ${trail && trail.role}, module ${trail && trail.module}, previous ${trail && trail.previous_state}`);
  const trailLeaksToken = auditRows.some(r => JSON.stringify(r).includes(tokenA));
  check('CP-16', !trailLeaksToken,
    trailLeaksToken ? 'a session token reached the audit trail'
      : 'no session token in any audit row this run wrote');

  return f;
}

// ---------------------------------------------------------------- server ownership

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function health() {
  const res = await request('GET', '/api/health');
  return res.status === 200;
}

async function healthOn(candidateBaseUrl) {
  const previous = baseUrl;
  baseUrl = candidateBaseUrl;
  const up = await health();
  baseUrl = previous;
  return up;
}

/**
 * The route must exist before any assertion runs against it. A backend the operator
 * started before this feature landed answers 404, and every check below would then read
 * as a product failure rather than a stale process.
 */
async function assertRouteExists() {
  const probe = await request('PATCH', '/api/customer/profile', { name: 'probe' });
  if (probe.status === 404 || probe.status === 0) {
    throw new Error(`the backend at ${baseUrl} has no PATCH /api/customer/profile (HTTP ${probe.status}). `
      + 'It predates this route — restart it, or let this suite spawn its own.');
  }
  return probe;
}

async function ensureServer() {
  if (await health()) {
    console.log(`using the backend already listening on ${baseUrl} (not spawned, so not reaped)`);
    return null;
  }
  const port = await freePort();
  const spawnedBaseUrl = `http://127.0.0.1:${port}`;
  const scratch = path.join(__dirname, 'scratch');
  if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  const outFd = fs.openSync(path.join(scratch, 'customer_profile_srv_out.log'), 'w');
  const errFd = fs.openSync(path.join(scratch, 'customer_profile_srv_err.log'), 'w');
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', outFd, errFd],
    detached: true,
    windowsHide: true
  }));
  proc.unref();
  baseUrl = spawnedBaseUrl;
  // Boot synchronises the authoritative directory before /api/health answers, so a fixed
  // short wait is a race this suite would lose and misread as a product failure.
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await health()) return proc;
  }
  throw new Error(`the backend on ${spawnedBaseUrl} never became healthy; see scratch/customer_profile_srv_err.log`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ refused: NODE_ENV=production. This is a local fixture-provisioning harness.');
    process.exit(3);
  }
  if (!isLoopback(baseUrl)) {
    console.error(`❌ refused: ${baseUrl} is not loopback. This suite edits and deletes customer rows.`);
    process.exit(3);
  }

  await connectStore();
  const proc = await ensureServer();
  if (!isLoopback(baseUrl)) {
    console.error(`❌ refused: the effective target ${baseUrl} is not loopback.`);
    process.exit(3);
  }
  await assertRouteExists();
  login = createLogin({ baseUrl, request });

  let fixtures = null;
  try {
    await assertPhonesUnclaimed();
    fixtures = await provision();
    await run(fixtures);
  } catch (err) {
    check('CP-00', false, `the run did not complete: ${err && err.message}`);
  }

  // Teardown is part of the assertion: a suite that leaves two customers and their
  // sessions behind reports a clean run while quietly changing the environment the next
  // one inherits. Only `ownedProbeIds` — rows proven minted above — are ever deleted.
  let residue = 'nothing to clean';
  try {
    const ids = [...new Set(ownedProbeIds)];
    if (ids.length) {
      await pgClient.query(
        `DELETE FROM public.backend_sessions WHERE role = 'CUSTOMER' AND entity_id = ANY($1::text[])`, [ids]);
      await pgClient.query(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, [ids]);
    }
    const { rows } = await pgClient.query(
      `SELECT count(*)::int AS n FROM public.users WHERE id = ANY($1::uuid[])`, [ids]);
    const sessions = await pgClient.query(
      `SELECT count(*)::int AS n FROM public.backend_sessions WHERE role = 'CUSTOMER' AND entity_id = ANY($1::text[])`, [ids]);
    const left = rows[0].n;
    const sessionsLeft = sessions.rows[0].n;
    if (left === 0 && sessionsLeft === 0) residue = 'none';
    else residue = `${left} probe user(s) and ${sessionsLeft} probe session(s) still present`;
  } catch (err) {
    residue = `teardown failed: ${err.message}`;
  }
  check('CP-20', residue === 'none', `probe customers and their sessions removed (${residue})`);

  try { await pgClient.end(); } catch (e) { /* already closed */ }
  if (proc) {
    const reaped = await reapAndWait(async () => await healthOn(baseUrl));
    check('CP-21', reaped === true, reaped
      ? `the backend this run spawned on ${baseUrl} is gone`
      : `the spawned backend on ${baseUrl} is still answering — the next run may not be able to bind`);
  } else {
    console.log('no server was spawned, so none was reaped');
  }

  const failed = results.filter(r => !r.ok);
  console.log(`📊 CUSTOMER PROFILE EDIT: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  if (failed.length) failed.forEach(x => console.log(`❌ ${x.id} ${x.detail}`));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL', err && err.message ? err.message : err);
  process.exit(1);
});
