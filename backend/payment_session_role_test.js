'use strict';

// =========================================================================
// NABIN — P0 SECURITY: GET /api/payments/session/:orderId AUTHORIZATION
//
// A payment session is the record immediately before money moves: it carries the
// customer's uuid, the amount, the service type, the job linkage, the gateway
// `key_id` and the whole `metadata` blob. This suite pins who may read it.
//
// The rule it enforces:
//   * an admin may read any session (support and reconciliation do this);
//   * a CUSTOMER may read ONLY a session bound to their own uuid;
//   * every other role is refused, and the refusal is by ROLE, not by luck;
//   * a session with no resolvable owner binding is refused too — ownership that
//     cannot be proven is not ownership;
//   * a refusal never puts the session in the response body.
//
// Why the "by luck" clause matters: the route used to compare the caller's uuid to
// the session's only `if (callerUuid && sessionCustomerUuid && ...)`. A DRIVER
// principal's id ('DRV-101') does not resolve through `resolveCustomerUserUuid` at
// all, so `callerUuid` was null, the comparison was skipped, and the route answered
// 200 with another customer's checkout. A MERCHANT whose id happens to be a uuid was
// refused — for the wrong reason (a customer mismatch, not a role gate), which is
// exactly the state that silently reopens when the id shape changes. Both are
// asserted here so the fix has to close the class, not the one observed instance.
//
// Targets LOCAL Docker Postgres only: `chain_target_guard` throws at load on a
// non-loopback target, and the live-Postgres check refuses a store where the durable
// assertions below would be about nothing. Every row this suite mints is deleted by
// its own `order_id` in the finally block; it touches no row it did not create.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('./testSessionCache');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const targetGuard = require('./scripts/chain_target_guard');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'payment_session_role_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — payment_session_role_test must run against a LIVE Postgres target so the');
  console.error('durable owner-binding assertions mean something. Run it under');
  console.error('`node scripts/with_local_target.js node payment_session_role_test.js`.');
  process.exit(2);
}

const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';

// Identities already seeded in the local development store.
const CUST_A_PHONE = '9845011982';                       // Priya Saxena
const CUST_A_UUID = '00000000-0000-0000-0000-000000000002';
const CUST_B_PHONE = '9876543210';                       // Rahul Sharma
const DRIVER_PHONE = '9810122910';
const MERCHANT_PHONE = '9811223344';

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

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
      name: 'Payment Session Guard Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return res.data && res.data.token;
}

let pg = null;
// The row the route actually reads back, straight from the store.
async function sessionRow(orderId) {
  const r = await pg.query(
    'select order_id, customer_id, amount, status, service_type from payment_sessions where order_id = $1',
    [orderId]);
  return r.rows[0] || null;
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN PAYMENT SESSION AUTHORIZATION TEST — P0 role + tenant isolation');
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(process.env.DATABASE_URL)}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const beforeCount = (await pg.query('select count(*)::int n from payment_sessions')).rows[0].n;

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  const login = createLogin({ baseUrl: BASE, request });

  // order_ids this suite mints, deleted by name in the finally block.
  const minted = [];

  let proc = null;
  try {
    proc = await bootServer({ port, request });
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    assert('PSR-00 backend (this run started it) is healthy on its private port', health.status === 200, { port });

    const adminToken = await mintAdmin({ request });
    assert('PSR-01 admin session minted', Boolean(adminToken));

    const custA = await login(CUST_A_PHONE, 'CUSTOMER');
    const custB = await login(CUST_B_PHONE, 'CUSTOMER');
    const drv = await login(DRIVER_PHONE, 'DRIVER');
    const mch = await login(MERCHANT_PHONE, 'MERCHANT');
    assert('PSR-02 customer A authenticated', Boolean(custA.token), custA.failure || {});
    assert('PSR-03 customer B authenticated', Boolean(custB.token), custB.failure || {});
    assert('PSR-04 driver authenticated', Boolean(drv.token), drv.failure || {});
    assert('PSR-05 merchant authenticated', Boolean(mch.token), mch.failure || {});
    if (!custA.token || !custB.token || !drv.token || !mch.token || !adminToken) {
      throw new Error('identity setup incomplete; cannot test authorization');
    }

    // --- the fixture: one real checkout session, owned by customer A ---------
    const created = await request('POST', '/api/payments/create-order', {
      amount: 250.0, currency: 'INR', serviceType: 'RIDE',
    }, bearer(custA.token));
    assert('PSR-06 customer A opens a payment session (HTTP 200)',
      created.status === 200 && created.data && created.data.success === true && Boolean(created.data.session && created.data.session.orderId),
      created.data);
    const orderId = created.data && created.data.session && created.data.session.orderId;
    if (orderId) minted.push(orderId);

    const fixture = await sessionRow(orderId);
    assert('PSR-07 durable row binds the session to customer A\'s uuid',
      Boolean(fixture) && String(fixture.customer_id) === CUST_A_UUID && fixture.status === 'INITIATED',
      fixture);

    // --- who may read it ----------------------------------------------------
    const owner = await request('GET', `/api/payments/session/${orderId}`, null, bearer(custA.token));
    assert('PSR-08 owner CUSTOMER reads own session (HTTP 200)',
      owner.status === 200 && owner.data && owner.data.session && owner.data.session.orderId === orderId,
      { status: owner.status, body: owner.data });

    const other = await request('GET', `/api/payments/session/${orderId}`, null, bearer(custB.token));
    assert('PSR-09 another CUSTOMER is refused (HTTP 403 CUSTOMER_MISMATCH)',
      other.status === 403 && other.data && other.data.code === 'CUSTOMER_MISMATCH',
      { status: other.status, code: other.data && other.data.code });

    // The defect. A DRIVER principal's id does not resolve as a customer, so the
    // route's guarded comparison used to be skipped entirely.
    const driverRead = await request('GET', `/api/payments/session/${orderId}`, null, bearer(drv.token));
    assert('PSR-10 a DRIVER bearer is refused (HTTP 403)', driverRead.status === 403,
      { status: driverRead.status, code: driverRead.data && driverRead.data.code });
    assert('PSR-11 the DRIVER refusal is by ROLE, not by an accidental id comparison',
      driverRead.data && driverRead.data.code === 'ROLE_NOT_AUTHORIZED',
      { status: driverRead.status, code: driverRead.data && driverRead.data.code });
    assert('PSR-12 the DRIVER refusal carries no session body',
      !(driverRead.data && driverRead.data.session), driverRead.data);

    const merchantRead = await request('GET', `/api/payments/session/${orderId}`, null, bearer(mch.token));
    assert('PSR-13 a MERCHANT bearer is refused (HTTP 403)', merchantRead.status === 403,
      { status: merchantRead.status, code: merchantRead.data && merchantRead.data.code });
    assert('PSR-14 the MERCHANT refusal is by ROLE, not by an accidental id comparison',
      merchantRead.data && merchantRead.data.code === 'ROLE_NOT_AUTHORIZED',
      { status: merchantRead.status, code: merchantRead.data && merchantRead.data.code });
    assert('PSR-15 the MERCHANT refusal carries no session body',
      !(merchantRead.data && merchantRead.data.session), merchantRead.data);

    const adminRead = await request('GET', `/api/payments/session/${orderId}`, null, bearer(adminToken));
    assert('PSR-16 admin still reads the session (HTTP 200 — support path preserved)',
      adminRead.status === 200 && adminRead.data && adminRead.data.session && adminRead.data.session.orderId === orderId,
      { status: adminRead.status, body: adminRead.data });

    const anon = await request('GET', `/api/payments/session/${orderId}`);
    assert('PSR-17 anonymous read is refused (HTTP 401)', anon.status === 401, anon.data);
    const bogus = await request('GET', `/api/payments/session/${orderId}`, null, bearer('not_a_real_session_token'));
    assert('PSR-18 invalid bearer is refused (HTTP 401)', bogus.status === 401, bogus.data);

    // --- ownership that cannot be proven is not ownership --------------------
    // A session row with no customer binding has no owner to authorize, so no
    // customer may read it — only an admin. This is the second half of the same
    // fail-open: the old guard skipped whenever EITHER side was unresolvable.
    const unboundId = `order_rzp_test_unbound_${Date.now()}`;
    minted.push(unboundId);
    await pg.query(`
      INSERT INTO payment_sessions (order_id, customer_id, amount, currency, service_type, status, provider, key_id)
      VALUES ($1, NULL, 199.0, 'INR', 'RIDE', 'INITIATED', 'RAZORPAY_SANDBOX', 'key_test')`, [unboundId]);

    const unboundByCustomer = await request('GET', `/api/payments/session/${unboundId}`, null, bearer(custA.token));
    assert('PSR-19 an ownerless session is refused to a CUSTOMER (HTTP 403, fails closed)',
      unboundByCustomer.status === 403 && !(unboundByCustomer.data && unboundByCustomer.data.session),
      { status: unboundByCustomer.status, code: unboundByCustomer.data && unboundByCustomer.data.code, leaked: Boolean(unboundByCustomer.data && unboundByCustomer.data.session) });
    const unboundByDriver = await request('GET', `/api/payments/session/${unboundId}`, null, bearer(drv.token));
    assert('PSR-20 an ownerless session is refused to a DRIVER (HTTP 403, no body)',
      unboundByDriver.status === 403 && !(unboundByDriver.data && unboundByDriver.data.session),
      { status: unboundByDriver.status, leaked: Boolean(unboundByDriver.data && unboundByDriver.data.session) });
    const unboundByAdmin = await request('GET', `/api/payments/session/${unboundId}`, null, bearer(adminToken));
    assert('PSR-21 an ownerless session stays readable by admin (HTTP 200)',
      unboundByAdmin.status === 200 && unboundByAdmin.data && unboundByAdmin.data.session,
      { status: unboundByAdmin.status });

    // --- refusals must not mutate ------------------------------------------
    const after = await sessionRow(orderId);
    assert('PSR-22 the refused reads changed nothing durable (same owner, amount, status)',
      Boolean(after) && String(after.customer_id) === CUST_A_UUID
      && Number(after.amount) === 250.0 && after.status === 'INITIATED', after);

    console.log('\n--- RESULT ---');
  } finally {
    try {
      if (minted.length) {
        const del = await pg.query('delete from payment_sessions where order_id = any($1)', [minted]);
        console.log(`\n[cleanup] deleted ${del.rowCount} of ${minted.length} tracked payment_sessions row(s) this run minted`);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP FAILED] residue may remain in payment_sessions:', cleanupErr.message);
    }

    console.log('\n================ SUMMARY ================');
    const afterCount = (await pg.query('select count(*)::int n from payment_sessions').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    console.log(`payment_sessions rows: before ${beforeCount}, after cleanup ${afterCount}`);
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
  console.error('payment_session_role_test harness error:', err && err.stack || err);
  try { if (pg) await pg.end(); } catch { /* noop */ }
  process.exit(1);
});
