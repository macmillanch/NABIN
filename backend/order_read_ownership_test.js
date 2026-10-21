'use strict';

// =========================================================================
// NABIN — P0 SECURITY: GET /api/customer/orders/:id + /api/orders/:id OWNERSHIP (MI-9)
//
// This is the route a customer app opens to show one order: its lines, its address snapshot,
// its totals, its state history. Reading it as somebody else is a direct data disclosure, so
// the ownership comparison is the whole authorization on this surface.
//
// The rule it enforces:
//   * a CUSTOMER reads ONLY an order whose `customer_id` is their own resolved uuid;
//   * a bearer whose own identity the store cannot resolve is refused — an ownership claim
//     nobody can prove is not ownership, which is the policy link 81 (`payment_session_role_test.js`),
//     link 83 (`support_ticket_thread_ownership_test.js`) and link 84
//     (`payment_verify_ownership_test.js`) already pin for their surfaces;
//   * a refusal puts no part of the order in the response body;
//   * the route's other answers stay what they were: 404 for an order with no row, 200 for the
//     owner, and the 503 channel for an unreadable store.
//
// Why this is a class, not a row: the guard read
// `if (customerUuid && order.customer_id !== customerUuid)`, so the check vanished whenever the
// CALLER side failed to resolve. `OrderRepository.resolveUserUuid` returns null for a handle that
// is neither a uuid nor a mapped/seeded account, and a persisted `backend_sessions` row is adopted
// verbatim by `restoreSession` as long as it carries an `entity`, while `authenticateUser`'s own
// account check falls back to matching the session's PHONE — so a session row naming no account
// still reaches the handler, with a `req.user` no resolver can name. Measured before this suite
// existed: such a bearer was answered 200 with another customer's whole order.
//
// Which half of the pair is reachable is a schema fact, not a guess, and this suite measures it:
// `orders.customer_id` is `UUID NOT NULL REFERENCES users(id)` (supabase migration 018), so the
// order side always names an owner and only the caller side can be unresolvable. ORO-24 asserts
// that from `pg_catalog` rather than from this file's reading of a migration, because the fix —
// refuse when the caller cannot be resolved — is only safe while that constraint holds.
//
// What is NOT claimed here: the sibling `GET /api/customer/activity` already fails closed on a
// null uuid (it answers 401 before any read). That is pinned (ORO-25/ORO-26) as the pattern this
// fix takes, so a later edit that softens either route shows up here, and so the two routes cannot
// drift apart again.
//
// Local/test only: refuses a non-loopback backend or database, and refuses a store that is not
// live PostgreSQL, because on the mock branch the ownership comparison is a plain id equality and
// these assertions would be about nothing. Every durable row this suite writes is a row it owns —
// the store, the two customers, the dish and the two orders come from `test_fixtures.js` and are
// deleted by recorded id, and the three ghost session rows are deleted by their own `token_hash`.
// Nothing shared is touched: no seeded account, no seeded order, and no row another suite owns.
// What it leaves is measured, not assumed: `backend_sessions` grows by 2 rows per run — the DRIVER
// session its role-boundary check mints by signing in as the SHARED seeded driver, whose token lives
// in `.nabin_test_sessions.json` for other links to reuse, and the SUPER_ADMIN session its own
// `/api/admin/login` persists. Deleting either would revoke another run's session to tidy a census,
// so the census names both. The summary prints both counts as the store reports them.
// =========================================================================

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('./testSessionCache');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const targetGuard = require('./scripts/chain_target_guard');
const { openFixtures } = require('./test_fixtures');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'order_read_ownership_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — order_read_ownership_test must run against a LIVE Postgres target so the');
  console.error('durable order-ownership assertions mean something. Run it under');
  console.error('`node scripts/with_local_target.js node order_read_ownership_test.js`.');
  process.exit(2);
}

const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const DRIVER_PHONE = '9810122910';                 // the seeded driver, for the role-boundary check

const STAMP = Date.now().toString(36);
// Handles that name no account. Run-unique so nothing here can alias a real users or drivers row:
// `resolveUserUuid` has to return null for them, and that null is the whole defect.
const GHOST = {
  WITH_PHONE: `ORO-GHOST-C-${STAMP}`,
  NO_PHONE: `ORO-GHOST-NOPHONE-${STAMP}`,
  DRIVER: `ORO-GHOST-D-${STAMP}`,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
// The disclosure this suite is about is the order object in the body, so "leaked" is measured by
// its presence rather than by the status code alone.
const leakedOrder = (res) => Boolean(res.data && (res.data.order || res.data.items || res.data.lines));

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
      name: 'Order Read Ownership Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return res.data && res.data.token;
}

let pg = null;
let fx = null;

// The order straight from the store: what the route is judged against, and what a read must never
// change. `orders` rows are immutable in this project, so a read leaving them identical is a
// property of the route, not an accident.
async function orderRow(id) {
  const r = await pg.query(
    `select id, order_number, customer_id, merchant_id, order_state, total_amount::numeric total_amount,
            currency, service_type
       from orders where id = $1::uuid or order_number = $2`, [id, id]);
  return r.rows[0] || null;
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN ORDER READ OWNERSHIP TEST — P0 MI-9 cross-customer IDOR guard');
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(process.env.DATABASE_URL)}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const beforeOrders = (await pg.query('select count(*)::int n from orders')).rows[0].n;
  const beforeSessions = (await pg.query('select count(*)::int n from backend_sessions')).rows[0].n;
  const beforeAudit = (await pg.query('select count(*)::int n from audit_logs')).rows[0].n;
  // The store's clock, not this process's, so the "rows this run left behind" query below cannot be
  // skewed by a client/server time difference.
  const dbNow = (await pg.query('select now() t')).rows[0].t;

  // ORO-24 needs the constraint as the store states it, so read it rather than quote the DDL.
  const notNull = (await pg.query(
    `select is_nullable from information_schema.columns
      where table_schema = current_schema() and table_name = 'orders' and column_name = 'customer_id'`
  )).rows[0] || {};

  // --- the fixture: one store, two customers, one order each, minted and reaped by this run ----
  fx = await openFixtures('orro', { connectionString: PG_TARGET.connectionString });
  const store = await fx.merchant({ type: 'RESTAURANT', name: 'order-read store' });
  const dish = await fx.foodProduct(store.id, { name: 'order-read thali', price: 240 });
  const owner = await fx.customer({ name: 'order-read owner' });
  const stranger = await fx.customer({ name: 'order-read stranger' });
  const ownedOrder = await fx.order({
    customerId: owner.id, merchantId: store.id, serviceType: 'FOOD', total_amount: 480,
    lines: [{ productId: dish.id, name: dish.name, quantity: 2, unit_price_snapshot: dish.price, unit: 'piece' }],
  });
  const otherOrder = await fx.order({
    customerId: stranger.id, merchantId: store.id, serviceType: 'FOOD', total_amount: 240,
    lines: [{ productId: dish.id, name: dish.name, quantity: 1, unit_price_snapshot: dish.price, unit: 'piece' }],
  });

  // --- ghost sessions: inserted BEFORE boot so the server hydrates them the way it hydrates any
  // session row an earlier build persisted. Each carries an `entity` (which is what makes
  // `restoreSession` adopt it, and therefore what puts an unresolvable handle on `req.user`) and an
  // `entity_id` that names no account. `WITH_PHONE` is the one that reaches the handler: its phone
  // matches an ACTIVE account, so `authenticateUser`'s own account check passes while
  // `resolveUserUuid` still answers null for the handle.
  const ghostTokens = {};
  const ghostHashes = [];
  for (const [key, handle] of Object.entries(GHOST)) {
    const token = `oro_ghost_${key.toLowerCase()}_${STAMP}_${crypto.randomBytes(16).toString('base64url')}`;
    const hash = sha256(token);
    ghostTokens[key] = token;
    ghostHashes.push(hash);
    const role = key === 'DRIVER' ? 'DRIVER' : 'CUSTOMER';
    const phone = key === 'WITH_PHONE' ? stranger.phone : null;
    await pg.query(`
      INSERT INTO backend_sessions (token_hash, role, entity_id, phone, entity, expires_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, now() + interval '1 day')
      ON CONFLICT (token_hash) DO NOTHING`,
      [hash, role, handle, phone, JSON.stringify({ id: handle, name: `Ghost ${role} Bearer` })]);
  }

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  const login = createLogin({ baseUrl: BASE, request });

  let proc = null;
  const read = (id, token) => request('GET', `/api/customer/orders/${id}`, null, bearer(token));
  const readAlias = (id, token) => request('GET', `/api/orders/${id}`, null, bearer(token));

  try {
    proc = await bootServer({ port, request });
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    assert('ORO-00 backend (this run started it) is healthy on its private port', health.status === 200, { port });

    const adminToken = await mintAdmin({ request });
    const ownerLogin = await login(owner.phone, 'CUSTOMER');
    const strangerLogin = await login(stranger.phone, 'CUSTOMER');
    const driverLogin = await login(DRIVER_PHONE, 'DRIVER');
    assert('ORO-01 admin session minted', Boolean(adminToken));
    assert('ORO-02 order owner authenticated through the real OTP path', Boolean(ownerLogin.token), ownerLogin.failure || {});
    assert('ORO-03 second customer authenticated through the real OTP path', Boolean(strangerLogin.token), strangerLogin.failure || {});
    assert('ORO-04 driver authenticated', Boolean(driverLogin.token), driverLogin.failure || {});
    if (!ownerLogin.token || !strangerLogin.token || !driverLogin.token || !adminToken) {
      throw new Error('identity setup incomplete; cannot test authorization');
    }

    const owned = await orderRow(ownedOrder.id);
    // The row must be bound to a resolvable owner before anything is refused for lacking one:
    // `orders.customer_id` is NOT NULL and the fixture wrote the owner's own uuid.
    assert('ORO-05 durable fixture order exists, bound to the owner uuid, untouched by the app',
      Boolean(owned) && String(owned.customer_id) === owner.id && UUID_RE.test(String(owned.customer_id))
      && owned.order_state === 'RECEIVED',
      owned);

    // ============================ the legitimate owner paths ============================
    const ownerByUuid = await read(ownedOrder.id, ownerLogin.token);
    assert('ORO-06 the OWNER reads their own order by uuid (HTTP 200)',
      ownerByUuid.status === 200 && ownerByUuid.data && ownerByUuid.data.success === true
      && String(ownerByUuid.data.order.id) === ownedOrder.id,
      { status: ownerByUuid.status, body: ownerByUuid.data });

    const ownerAlias = await readAlias(ownedOrder.id, ownerLogin.token);
    assert('ORO-07 the second registration of the same route answers identically for the owner',
      ownerAlias.status === 200 && String(ownerAlias.data.order.id) === ownedOrder.id,
      { status: ownerAlias.status });

    const ownerByNumber = await read(ownedOrder.order_number, ownerLogin.token);
    assert('ORO-08 the owner reads their order by ORDER NUMBER too (the repository accepts both)',
      ownerByNumber.status === 200 && String(ownerByNumber.data.order.id) === ownedOrder.id,
      { status: ownerByNumber.status, body: ownerByNumber.data });

    // ============================ a proven stranger ============================
    const strangerByUuid = await read(ownedOrder.id, strangerLogin.token);
    assert('ORO-09 another CUSTOMER reading by order uuid is refused (HTTP 403)',
      strangerByUuid.status === 403, { status: strangerByUuid.status, leaked: leakedOrder(strangerByUuid) });

    const strangerByNumber = await read(ownedOrder.order_number, strangerLogin.token);
    assert('ORO-10 another CUSTOMER reading by ORDER NUMBER is refused (HTTP 403)',
      strangerByNumber.status === 403, { status: strangerByNumber.status, leaked: leakedOrder(strangerByNumber) });

    assert('ORO-11 both stranger refusals put no order in the response body',
      !leakedOrder(strangerByUuid) && !leakedOrder(strangerByNumber),
      { byUuid: strangerByUuid.data, byNumber: strangerByNumber.data });

    const strangerOwn = await read(otherOrder.id, strangerLogin.token);
    assert('ORO-12 the stranger still reads the order that IS theirs (the guard is not a blanket refusal)',
      strangerOwn.status === 200 && String(strangerOwn.data.order.id) === otherOrder.id,
      { status: strangerOwn.status });

    // ============================ THE DEFECT: an unresolvable bearer ============================
    // A persisted session whose `entity_id` names no users row, whose phone matches an ACTIVE
    // account so the bearer gate lets it in. `resolveUserUuid(handle)` answers null, so the old
    // `if (customerUuid && ...)` comparison never ran and this bearer was handed the order.
    const ghostByUuid = await read(ownedOrder.id, ghostTokens.WITH_PHONE);
    assert('ORO-13 a bearer whose identity resolves to no account is refused (HTTP 403, fails closed)',
      ghostByUuid.status === 403, {
        status: ghostByUuid.status,
        code: ghostByUuid.data && ghostByUuid.data.code,
        note: 'a 200 here is the IDOR: the guard vanished because customerUuid was null',
        leaked: leakedOrder(ghostByUuid),
      });
    assert('ORO-14 that refusal hands back no part of another customer\'s order',
      !leakedOrder(ghostByUuid), { status: ghostByUuid.status, leaked: leakedOrder(ghostByUuid) });

    const ghostByNumber = await read(ownedOrder.order_number, ghostTokens.WITH_PHONE);
    assert('ORO-15 the same bearer is refused by ORDER NUMBER too (no second door)',
      ghostByNumber.status === 403 && !leakedOrder(ghostByNumber),
      { status: ghostByNumber.status, leaked: leakedOrder(ghostByNumber) });

    const ghostAlias = await readAlias(ownedOrder.id, ghostTokens.WITH_PHONE);
    assert('ORO-16 and refused on the alias registration too',
      ghostAlias.status === 403 && !leakedOrder(ghostAlias),
      { status: ghostAlias.status, leaked: leakedOrder(ghostAlias) });

    // The sibling half: a ghost naming no addressable account at all is refused by the bearer gate
    // itself, before the route is ever reached.
    const ghostNoPhone = await read(ownedOrder.id, ghostTokens.NO_PHONE);
    assert('ORO-17 a CUSTOMER session naming no addressable account is refused by the bearer gate (403/401)',
      ghostNoPhone.status === 403 || ghostNoPhone.status === 401,
      { status: ghostNoPhone.status, code: ghostNoPhone.data && ghostNoPhone.data.code });

    // ============================ the role and anonymous boundaries ============================
    const driverRead = await read(ownedOrder.id, driverLogin.token);
    assert('ORO-18 a real DRIVER bearer is refused (this route is customer-only)',
      driverRead.status === 403 && !leakedOrder(driverRead),
      { status: driverRead.status, error: driverRead.data && driverRead.data.error });

    const adminRead = await read(ownedOrder.id, adminToken);
    assert('ORO-19 an ADMIN bearer is refused here too (no customer route is reachable with an admin token)',
      adminRead.status === 403 || adminRead.status === 401, { status: adminRead.status });

    const anon = await read(ownedOrder.id);
    assert('ORO-20 anonymous read is refused (HTTP 401)', anon.status === 401, anon.data);

    const badToken = await read(ownedOrder.id, 'oro_not_a_real_session_token');
    assert('ORO-21 an invalid bearer is refused (HTTP 401)', badToken.status === 401, badToken.data);

    // ============================ the fix must not break the rest ============================
    const ownerAgain = await read(ownedOrder.id, ownerLogin.token);
    assert('ORO-22 the owner still reads after every refusal (no lockout side effect)',
      ownerAgain.status === 200 && String(ownerAgain.data.order.id) === ownedOrder.id,
      { status: ownerAgain.status });

    const missing = await read(crypto.randomUUID(), ownerLogin.token);
    assert('ORO-23 a genuinely absent order is still 404, not swept into the new 401/403',
      missing.status === 404, { status: missing.status, body: missing.data });

    const ownedAfter = await orderRow(ownedOrder.id);
    const otherAfter = await orderRow(otherOrder.id);
    assert('ORO-24 the orders are unchanged and the schema still forbids an unowned order',
      Boolean(ownedAfter) && Boolean(otherAfter)
      && String(ownedAfter.customer_id) === owner.id && String(otherAfter.customer_id) === stranger.id
      && ownedAfter.order_state === 'RECEIVED' && otherAfter.order_state === 'RECEIVED'
      && notNull.is_nullable === 'NO',
      { owned: ownedAfter, other: otherAfter, customerIdNullable: notNull.is_nullable });

    // ============================ the pattern the fix takes ============================
    // `GET /api/customer/activity` was already fail-closed on a null uuid. It is asserted here as
    // the reference the order route now matches, so the two cannot drift apart again.
    const ghostActivity = await request('GET', '/api/customer/activity', null, bearer(ghostTokens.WITH_PHONE));
    assert('ORO-25 the sibling activity route still refuses an unresolvable bearer (401) and shows nothing',
      ghostActivity.status === 401 && !leakedOrder(ghostActivity),
      { status: ghostActivity.status, code: ghostActivity.data && ghostActivity.data.code });

    const ownerActivity = await request('GET', '/api/customer/activity', null, bearer(ownerLogin.token));
    const activityIds = ((ownerActivity.data && ownerActivity.data.items) || []).map((i) => String(i.id));
    assert('ORO-26 the owner\'s activity feed holds their own order and not the stranger\'s',
      ownerActivity.status === 200 && activityIds.includes(ownedOrder.order_number)
      && !activityIds.includes(otherOrder.order_number),
      { status: ownerActivity.status, activityIds });

    console.log('\n--- RESULT ---');
  } finally {
    try {
      if (ghostHashes.length) {
        const del = await pg.query('delete from backend_sessions where token_hash = any($1)', [ghostHashes]);
        console.log(`\n[cleanup] deleted ${del.rowCount} of ${ghostHashes.length} ghost backend_sessions row(s) this run inserted`);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP FAILED] ghost rows may remain:', cleanupErr.message);
    }
    let removed = null;
    try {
      removed = await fx.close();
      console.log(`[cleanup] fixtures reaped: ${JSON.stringify(removed)}`);
    } catch (fixtureErr) {
      console.error('[CLEANUP FAILED] fixture rows may remain:', fixtureErr.message);
    }

    console.log('\n================ SUMMARY ================');
    const afterOrders = (await pg.query('select count(*)::int n from orders').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    const afterSessions = (await pg.query('select count(*)::int n from backend_sessions').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    const afterAudit = (await pg.query('select count(*)::int n from audit_logs').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    // Name the residue instead of describing it: whatever this run persisted after its own start
    // instant and did not delete is listed by role, so the census line and this line cannot disagree.
    const leftBehind = await pg.query(
      `select role, count(*)::int n from backend_sessions
        where created_at >= $1
        group by role order by role`,
      [dbNow]).then((r) => r.rows).catch(() => []);
    console.log(`orders rows: before ${beforeOrders}, after cleanup ${afterOrders}`);
    console.log(`backend_sessions rows: before ${beforeSessions}, after cleanup ${afterSessions}`);
    console.log(`audit_logs rows: before ${beforeAudit}, after cleanup ${afterAudit} (append-only since migration 022)`);
    console.log(`sessions left behind by this run: ${leftBehind.map((r) => `${r.role} x${r.n}`).join(', ') || 'none'}`);
    console.log(`(the DRIVER row is the SHARED seeded-driver token, keyed by host:port|role|phone in`
      + ` .nabin_test_sessions.json for other links to reuse — deleting it here would revoke another run's`
      + ` session to tidy a census; the SUPER_ADMIN row is this run's own \`/api/admin/login\` session, which`
      + ` no route in this suite revokes. The census names both)`);
    console.log(`=== ORDER READ OWNERSHIP: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed ===`);
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
  console.error('order_read_ownership_test harness error:', err && err.stack || err);
  try { if (fx) await fx.close(); } catch { /* noop */ }
  try { if (pg) await pg.end(); } catch { /* noop */ }
  process.exit(1);
});
