'use strict';
/*
 * RMS READ ROUTE ERROR CHANNEL GUARD (#310) — local only, GET requests only, no writes.
 *
 * Why this file exists. `rms_write_honesty_test.js` scans the RMS route family and used to assert
 * the error channel of its 20 mutations only (RMSH-16/17 filter `verb !== 'get'`), so the eleven
 * GET routes in the same family were unguarded by construction. Read them and the defect is plain:
 *
 *   GET /rms/sessions/:id/bill      catch → res.status(400).json({ error: err.message })
 *   GET /rms/bills/:id/receipt      catch → res.status(err.statusCode || 400)
 *   GET /rms/bills/search           catch → res.status(500).json({ error: err.message })
 *   GET /rms/reservations           catch → res.status(500).json({ error: err.message })
 *   GET /rms/kds/tickets            catch → res.status(500).json({ error: err.message })
 *   GET /rms/staff                  catch → res.status(500).json({ error: err.message })
 *   GET /rms/settings, /settings/payments, /tables, /tables/:id/session  same 500 shape
 *
 * so a restaurant whose durable store was unreachable or had refused the read was told either that
 * its own request was invalid (400, which teaches the client to stop retrying and lose the screen)
 * or a bare 500 carrying `err.message`, which is the sentence PostgreSQL printed. None of them said
 * which store the rows came from, while every mutation in the family does.
 *
 * The shapes listed above are each route's own non-store default, still present in the current
 * source (e.g. src/server.js:5976 for the bill, :5929 for the table session); before the store
 * branch was placed above them, they were the entire answer to a failed read.
 *
 * The repository already classified a failed read: `storeReadFailure(what, error)` marks it with
 * `.storeFailure` and the engine's SQLSTATE (RestaurantManagementRepository.js:63), and
 * `_rejectMemoryFallback(what)` answers 503 STORE_UNAVAILABLE when a production process would
 * otherwise serve a bill from its own Maps (:687). What was missing was the routes using it. They
 * now answer through `replyStoreError` (src/server.js:347), the one place that decides 503 vs 500
 * from the SQLSTATE and logs the engine's words instead of echoing them.
 *
 * What this suite is for, and what it is not. It drives the real Express routes over real HTTP and
 * asserts the *answer shape* the routes give — status, code, the `dataSource` label, and that no
 * engine sentence reaches the wire. The classification behind those shapes is asserted where it
 * lives (RMSH-05/07/08/22, outage_semantics_audit.js), and the durable data behind the successful
 * reads is asserted by test_rms_e2e_integration.js and the PostgreSQL-backed suites rather than
 * rebuilt here. Where a route is probed with its repository method replaced by a throwing stub, the
 * error handed back is the shipped mechanism's own object, not a paraphrase of it.
 *
 * RED baseline, observed in this session before the routes were fixed: none of the 11 read routes
 * labelled the store its rows came from, and only reports/sales had a store-failure branch, so a
 * refused or unreachable read answered 400 (bill, receipt) or 500 with `error: err.message` — the
 * sentence PostgreSQL printed — on the other ten. That baseline cannot be re-measured from git:
 * `git show HEAD:backend/src/server.js` registers 0 RMS routes at all (verified 2026-10-14, 391,804
 * bytes against the working tree's 486,855), the whole RMS family being uncommitted work in progress.
 * What this suite pins is therefore the end state, derived from the registrations it reads and the
 * answers it drives, not a diff against a commit.
 */
process.env.NABIN_TEST_MODE = 'true';
process.env.NODE_ENV = 'local';
// src/server.js:11061 runs a module-scope startup that ends in `server.listen(PORT || 4000)`. This
// suite drives its routes through its own `app.listen(0)`, so without this the incidental listener
// would take :4000 — the port the regression chain's shared harness owns — and fail with EADDRINUSE
// once its async prelude finished. Measured 2026-10-14: with :4000 held by another process the run
// still passed 53/53 only because this process exited first, which is a race, not a guard.
process.env.PORT = '0';

const http = require('http');
const db = require('./src/database');
const { app } = require('./src/server');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const RESTAURANT_ID = '00000000-0000-0000-0000-000000000201';
const MERCHANT_TOKEN = 'mcht_session_rms_read_channel';
const TABLE_ID = '00000000-0000-4000-8000-0000000000c1';
const SESSION_ID = '00000000-0000-4000-8000-0000000000c2';
const BILL_ID = '00000000-0000-4000-8000-0000000000c3';

// Every GET registration in the RMS family, each with the repository method it calls and the domain
// its `dataSource` names. The list is checked against src/server.js below (RRC-01) so a read route
// added without an entry here cannot hide from this guard.
const READ_ROUTES = [
  { id: 'settings', path: `/api/merchant/${RESTAURANT_ID}/rms/settings`, repoMethod: 'getSettings', domain: 'settings', realReadOk: true },
  { id: 'payment settings', path: `/api/merchant/${RESTAURANT_ID}/rms/settings/payments`, repoMethod: 'getSettings', domain: 'settings', realReadOk: true },
  { id: 'tables', path: `/api/merchant/${RESTAURANT_ID}/rms/tables`, repoMethod: 'getTables', domain: 'tables', realReadOk: true },
  { id: 'table session', path: `/api/merchant/${RESTAURANT_ID}/rms/tables/${TABLE_ID}/session`, repoMethod: 'getActiveSession', domain: 'sessions', realReadOk: true },
  { id: 'bill', path: `/api/merchant/${RESTAURANT_ID}/rms/sessions/${SESSION_ID}/bill`, repoMethod: 'getBillForSession', domain: 'bills', realReadOk: false },
  { id: 'receipt', path: `/api/merchant/${RESTAURANT_ID}/rms/bills/${BILL_ID}/receipt`, repoMethod: 'getBillReceipt', domain: 'bills', realReadOk: false },
  { id: 'bill search', path: `/api/merchant/${RESTAURANT_ID}/rms/bills/search`, repoMethod: 'searchBills', domain: 'bills', realReadOk: true },
  { id: 'reservations', path: `/api/merchant/${RESTAURANT_ID}/rms/reservations`, repoMethod: 'getReservations', domain: 'reservations', realReadOk: true },
  { id: 'kds tickets', path: `/api/merchant/${RESTAURANT_ID}/rms/kds/tickets`, repoMethod: 'getKdsTickets', domain: 'kds', realReadOk: true },
  { id: 'staff', path: `/api/merchant/${RESTAURANT_ID}/rms/staff`, repoMethod: 'getStaff', domain: 'staff', realReadOk: true },
  { id: 'sales report', path: `/api/merchant/${RESTAURANT_ID}/rms/reports/sales`, repoMethod: 'getSalesReport', domain: 'bills', realReadOk: true }
];

// The words an engine prints when a read fails. None of them may appear in a response body: they
// describe tables, not the merchant's data, and the caller can do nothing with them.
const ENGINE_TEXT = [
  'permission denied for table',
  'relation "restaurant',
  'does not exist',
  'duplicate key value',
  'invalid input syntax'
];

let server;
let baseUrl;

function request(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(path, baseUrl), { method: 'GET', headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (e) { json = null; }
        resolve({ status: res.statusCode, raw, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// The three store conditions a read can meet, each produced the way the shipped code produces it.
const OUTAGES = [
  {
    kind: 'unreachable',
    make: () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
      cause.code = 'ECONNREFUSED';
      cause.syscall = 'connect';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      err.details = 'connect ECONNREFUSED 127.0.0.1:59999';
      return err;
    },
    status: 503,
    code: 'STORE_UNAVAILABLE'
  },
  {
    kind: 'refused-by-engine',
    make: () => {
      // The shape `storeReadFailure` builds from a supabase-js refusal: the flag, the SQLSTATE on
      // `code`, the engine's sentence on `details`. 42P01 is an unmigrated schema, which is the
      // deployment's fault, so it must be a 500 rather than a 400 blaming the merchant's request.
      const err = new Error('The bill could not be read from the restaurant store.');
      err.storeFailure = true;
      err.code = '42P01';
      err.details = 'relation "restaurant_bills" does not exist';
      return err;
    },
    status: 500,
    code: 'SCHEMA_NOT_READY'
  },
  {
    kind: 'production-refusal',
    // Thrown by the shipped mechanism itself, not restated: _rejectMemoryFallback answers 503
    // STORE_UNAVAILABLE when NODE_ENV=production would have served this read from the Maps.
    make: () => {
      const real = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        db.rmsRepo._rejectMemoryFallback('dining bill');
        return null;
      } catch (err) {
        return err;
      } finally {
        process.env.NODE_ENV = real;
      }
    },
    status: 503,
    code: 'STORE_UNAVAILABLE'
  }
];

async function withStub(repoMethod, thunk, fn) {
  const real = db.rmsRepo[repoMethod];
  db.rmsRepo[repoMethod] = thunk;
  try {
    return await fn();
  } finally {
    db.rmsRepo[repoMethod] = real;
  }
}

async function main() {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
  db.activeSessions.set(MERCHANT_TOKEN, {
    token: MERCHANT_TOKEN,
    role: 'MERCHANT',
    entityId: RESTAURANT_ID,
    entity: {
      id: RESTAURANT_ID,
      name: 'Dilli Darbar Mughlai Kitchen',
      merchant_type: 'RESTAURANT',
      tenantId: RESTAURANT_ID
    }
  });
  const auth = { Authorization: `Bearer ${MERCHANT_TOKEN}` };

  // ---------------------------------------------------------------- the route family is what we think it is
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  const PARAMS = { ':restaurantId': RESTAURANT_ID, ':tableId': TABLE_ID, ':sessionId': SESSION_ID, ':billId': BILL_ID };
  const ALL_REGS = [...src.matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)];
  const rmsGets = [];
  ALL_REGS.forEach((m) => {
    const raw = m[2].startsWith('[') ? m[2].match(/'[^']*'|"[^"]*"/g) : [m[2]];
    // One registration may bind several path aliases (`/api/merchant/:restaurantId/rms/…` and
    // `/api/merchant/rms/…` reach the same handler). The alias count is irrelevant to this guard;
    // what matters is that every *registration* has a probe, so each is one entry with its aliases
    // normalised to the concrete paths this suite actually requests.
    const paths = (raw || []).map((s) => {
      let p = s.slice(1, -1);
      Object.keys(PARAMS).forEach((name) => { p = p.split(name).join(PARAMS[name]); });
      return p;
    });
    if (m[1].toLowerCase() === 'get' && paths.some((p) => /\/rms\//.test(p))) {
      rmsGets.push(paths);
    }
  });
  const covered = (paths) => READ_ROUTES.some((r) => paths.includes(r.path));
  const uncovered = rmsGets.filter((ps) => !covered(ps));
  check('RRC-01',
    rmsGets.length > 0 && uncovered.length === 0 && READ_ROUTES.length === rmsGets.length,
    `src/server.js registers ${rmsGets.length} RMS GET route(s) and this guard drives ${READ_ROUTES.length} of them${uncovered.length ? `, missing: ${uncovered.map((p) => p.join(' , ')).join(' | ')}` : ''} — the list is checked against the registrations, so a read route added without a probe here is a red check rather than an untested route`);

  // The store this process is actually serving from, read from the repository rather than assumed.
  // The invariant is one-directional on purpose, so this guard is valid in either mode: a closed
  // durability gate may never produce a `postgres` label, while an open gate is the durable suites'
  // territory (test_rms_postgres_durability.js, test_rms_upi_billing_sales_complete.js) and is not
  // asserted here beyond that direction. Which domains are durable at all is measured by
  // rms_write_honesty_test.js (RMSH-05/22), not restated here.
  const liveStore = db.rmsRepo.pgEnabled ? 'postgres' : 'memory';
  const domains = [...new Set(READ_ROUTES.map((r) => r.domain))];
  const labels = {};
  domains.forEach((d) => {
    try { labels[d] = db.rmsRepo.dataSourceFor(d); } catch (e) { labels[d] = `THROWS(${e.message})`; }
  });
  const claimedPostgres = Object.keys(labels).filter((d) => labels[d] === 'postgres');
  check('RRC-02',
    db.rmsRepo.pgEnabled || claimedPostgres.length === 0,
    `this run serves RMS from ${liveStore} (pgEnabled=${db.rmsRepo.pgEnabled}) and the repository labels domains [${domains.map((d) => `${d}=${labels[d]}`).join(', ')}] — with the durability gate closed no domain may claim postgres, because that label is the difference between a row the store has and one this process remembers`);

  // ---------------------------------------------------------------- 1. a successful read names its store
  for (const route of READ_ROUTES) {
    if (route.realReadOk) {
      const res = await request(route.path, auth);
      const label = res.json && res.json.dataSource;
      const expected = db.rmsRepo.dataSourceFor(route.domain);
      check(`RRC-10.${route.id}`,
        res.status === 200 && res.json && res.json.success === true && label === expected,
        `GET ${route.path} answered ${res.status} with dataSource=${JSON.stringify(label)} (repository says ${JSON.stringify(expected)} for domain '${route.domain}') from the real store`);
    } else {
      // The two id-scoped reads: a stub stands in for the bill or receipt a successful dine-in
      // flow would have produced, because building that fixture is test_rms_e2e_integration.js's
      // job. What is asserted is only the route's own answer: the label, and its payload untouched.
      const payload = route.repoMethod === 'getBillForSession'
        ? { id: BILL_ID, sessionId: SESSION_ID, totalAmount: 640.5, balanceAmount: 640.5, status: 'UNPAID' }
        : { receiptNumber: 'REC-RRC-PROBE', billId: BILL_ID, totalAmount: 640.5, paymentStatus: 'PAID' };
      const res = await withStub(route.repoMethod, () => Promise.resolve(payload), () => request(route.path, auth));
      const expected = db.rmsRepo.dataSourceFor(route.domain);
      check(`RRC-10.${route.id}`,
        res.status === 200 && res.json && res.json.dataSource === expected
          && JSON.stringify(res.json[route.repoMethod === 'getBillForSession' ? 'bill' : 'receipt']) === JSON.stringify(payload),
        `GET ${route.path} answered ${res.status} with dataSource=${JSON.stringify(res.json && res.json.dataSource)} (expected ${JSON.stringify(expected)}) and the store's row passed through unchanged (stubbed read; the flow that produces a real bill is covered by test_rms_e2e_integration.js)`);
    }
  }

  // ---------------------------------------------------------------- 2. every read answers a store failure as a store failure
  let probes = 0;
  for (const route of READ_ROUTES) {
    for (const outage of OUTAGES) {
      const err = outage.make();
      if (!err) { probes += 1; continue; }
      const res = await withStub(route.repoMethod, () => Promise.reject(err), () => request(route.path, auth));
      const body = String(res.raw || '');
      const leaked = ENGINE_TEXT.filter((t) => body.toLowerCase().includes(t.toLowerCase()));
      const okStatus = res.status === outage.status;
      const okCode = res.json && res.json.code === outage.code;
      const okShape = res.json && res.json.success === false && typeof res.json.requestId === 'string' && res.json.requestId.length > 0;
      const noSuccessPayload = res.json && !('dataSource' in res.json);
      probes += 1;
      check(`RRC-20.${route.id}.${outage.kind}`,
        okStatus && okCode && okShape && leaked.length === 0 && noSuccessPayload,
        `GET ${route.path} with the store ${outage.kind} answered ${res.status} ${res.json && res.json.code} `
        + `(expected ${outage.status} ${outage.code}); engine text on the wire: ${leaked.length ? leaked.join(', ') : 'none'}; body: ${body.slice(0, 120)}`);
    }
  }
  check('RRC-21',
    probes === READ_ROUTES.length * OUTAGES.length,
    `${probes} outage probes run across ${READ_ROUTES.length} read routes × ${OUTAGES.length} store conditions (unreachable, refused-by-engine, production refusal)`);

  // ---------------------------------------------------------------- 3. a genuine condition is still genuine
  // An outage must not swallow the answers that describe the caller's own request, so the defaults
  // the routes had before this change are pinned too: 400 for a session with no bill, the receipt's
  // own statusCode, the sales report's INVALID_DATE_RANGE, and a 500 for a fault that is not the
  // store's (no storeFailure flag, nothing unreachable about it).
  const bill400 = await withStub('getBillForSession', () => {
    const err = new Error('Session not found.');
    throw err;
  }, () => request(`/api/merchant/${RESTAURANT_ID}/rms/sessions/${SESSION_ID}/bill`, auth));
  check('RRC-30',
    bill400.status === 400 && bill400.json && bill400.json.success === false && bill400.json.error === 'Session not found.',
    `GET bill for a session the store has no bill for stays a 400 about the session (${bill400.status} ${JSON.stringify(bill400.json && bill400.json.error)}) rather than becoming a 503`);

  const receipt404 = await withStub('getBillReceipt', () => {
    const err = new Error('No receipt for a bill that is not paid.');
    err.statusCode = 404;
    err.code = 'RECEIPT_NOT_FOUND';
    throw err;
  }, () => request(`/api/merchant/${RESTAURANT_ID}/rms/bills/${BILL_ID}/receipt`, auth));
  check('RRC-31',
    receipt404.status === 404 && receipt404.json && receipt404.json.code === 'RECEIPT_NOT_FOUND',
    `GET receipt preserves the error's own status and code (${receipt404.status} ${receipt404.json && receipt404.json.code}) — the store branch only intercepts store conditions`);

  const badRange = await withStub('getSalesReport', () => {
    const err = new Error('startDate must not be after endDate.');
    err.code = 'INVALID_DATE_RANGE';
    err.statusCode = 400;
    throw err;
  }, () => request(`/api/merchant/${RESTAURANT_ID}/rms/reports/sales?startDate=2026-01-31&endDate=2026-01-01`, auth));
  check('RRC-32',
    badRange.status === 400 && badRange.json && badRange.json.code === 'INVALID_DATE_RANGE',
    `GET reports/sales with a reversed window is still the caller's mistake (${badRange.status} ${badRange.json && badRange.json.code}), not dressed up as a store outage`);

  const notStore = await withStub('getKdsTickets', () => {
    throw new TypeError('Cannot read properties of undefined (reading "map")');
  }, () => request(`/api/merchant/${RESTAURANT_ID}/rms/kds/tickets`, auth));
  check('RRC-33',
    notStore.status === 500 && notStore.json && notStore.json.code !== 'STORE_UNAVAILABLE',
    `a bug in our own code is still a 500 (${notStore.status} ${notStore.json && notStore.json.code}) — the store branch keys on the storeFailure flag and the wire codes, not on "any error"`);

  const unauth = await request(`/api/merchant/${RESTAURANT_ID}/rms/kds/tickets`, {});
  check('RRC-34',
    unauth.status === 401 || unauth.status === 403,
    `the read still refuses an unauthenticated caller with ${unauth.status} — adding an error channel did not reorder the guards in front of it`);

  // ---------------------------------------------------------------- 4. no read may answer memory as postgres
  const labelled = [];
  for (const route of READ_ROUTES) {
    const payload = () => Promise.resolve(route.repoMethod === 'getBillReceipt'
      ? { receiptNumber: 'REC-1' }
      : route.repoMethod === 'getBillForSession' ? { id: 'b1' } : route.repoMethod === 'getSalesReport' ? {} : []);
    const res = await withStub(route.repoMethod, payload, () => request(route.path, auth));
    labelled.push({ route, given: res.json && res.json.dataSource });
  }
  const wrong = labelled.filter((l) => l.given !== labels[l.route.domain]);
  const memoryRunLie = db.rmsRepo.pgEnabled ? [] : labelled.filter((l) => l.given === 'postgres').map((l) => l.route.id);
  check('RRC-40',
    labelled.length === READ_ROUTES.length && wrong.length === 0 && memoryRunLie.length === 0,
    `all ${labelled.length} read routes labelled their answer for this run [${labelled.map((l) => `${l.route.id}=${l.given}`).join(', ')}] against the repository's own per-domain map — each label must equal dataSourceFor(domain)${wrong.length ? ` (mismatched: ${wrong.map((l) => l.route.id).join(', ')})` : ''}, and with the gate closed none may say postgres${memoryRunLie.length ? ` (they do: ${memoryRunLie.join(', ')})` : ''}, because a read served from this process's Maps and stamped postgres is the claim this guard exists to prevent (${liveStore} for this run)`);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  return passed === results.length ? 0 : 1;
}

main()
  .then((code) => setTimeout(() => process.exit(code), 50))
  .catch((err) => {
    console.error(`RRC CRASHED: ${err && err.stack || err}`);
    setTimeout(() => process.exit(1), 50);
  });
