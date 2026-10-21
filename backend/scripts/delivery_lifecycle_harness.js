'use strict';

// =========================================================================
// NABIN — P3 #436/#438: the FOOD and GROCERY DELIVERY lifecycle, end to end.
//
// The defect this file reproduces, in one sentence: a food or grocery order placed on the
// DELIVERY channel is written durably and then stranded. Neither `POST /api/customer/book-food`
// nor `POST /api/grocery/checkout/validate` created a delivery job or wrote `orders.job_id`, and
// the merchant KDS route's "dispatch" broadcast `{type:'NEW_JOB_DISPATCH', job:{id: <order id>}}` —
// an ORDER id wearing a job's name, with no `jobs` row behind it. Measured against the local store
// before this suite existed: 0 of the 1,354 orders carried a `job_id`, `jobs` held 2,134 RIDE and
// 518 PARCEL rows and no FOOD or GROCERY row at all, and 92 sat at READY_FOR_PICKUP forever. So the
// lifecycle could not reach PICKED_UP or DELIVERED, and the customer was shown a state the backend
// would never produce.
//
// What closes it (P3 #436/#439): 047's `create_delivery_job_atomic` mints the job and writes the
// link in one transaction, called from `dispatchDeliveryJob` (src/server.js:367) at placement and
// again from the READY_FOR_PICKUP advance (src/server.js:5445) as the retry; and
// `POST /api/driver/pickup-order` (src/server.js:7470) with `POST /api/driver/deliver-order`
// (src/server.js:7527) walk the order PICKED_UP → DELIVERED through 047's two handover RPCs. This
// scenario is what proves they still do — every id it asserts is read back from PostgreSQL.
//
// What each run asserts (brief §5, conditions 1-12) is read back from **PostgreSQL rows**, not
// from an HTTP body or the server's in-memory mirror, because a 200 whose row says otherwise is
// exactly the failure this suite exists to catch:
//   L01 one durable order, DELIVERY channel, bound to the placing customer and this store;
//   L02 that order links to exactly one durable job of the same service/customer/store;
//   L03 dispatch offers that reference the ACTUAL job (not the order id) and include the driver
//       who takes it, without a duplicate (job, driver) pair;
//   L04 the authorized driver's accept assigns the job durably; a second driver is refused and
//       the assignment does not move;
//   L05 the merchant advances only through the approved KDS states and stops at READY_FOR_PICKUP;
//   L06 a driver who is not the assigned driver is refused with an authorization verdict — and
//       that refusal has no state, transition or money side effect;
//   L07 the assigned driver's pickup puts the order at PICKED_UP durably, with a DRIVER-authored
//       `order_transitions` row;
//   L12 a process restart after pickup preserves the non-terminal order and its job;
//   L08 the delivery code is enforced per P2: a wrong code is refused and counted, a *correct*
//       code from the wrong driver is refused before any consumption, an expired code is refused
//       while it still matches, and the code verifies once;
//   L09 the assigned driver's delivery is accepted;
//   L10 order, job and both app reads agree on DELIVERED/COMPLETED;
//   L11 retry and replay produce no second order, job, offer set, transition, completion or
//       money row — with the money asserted as an invariant (the wallet delta equals the durable
//       `driver_earnings`, and a zero-earnings handover books nothing) rather than as a number
//       this file invents.
//
// The two driver-side routes asserted here — `POST /api/driver/pickup-order` and
// `POST /api/driver/deliver-order` — did not exist when this scenario was first run RED. A 404 on
// either is still reported as "no such route answered", which is a missing capability, not an
// authorization decision, and L06 deliberately distinguishes the two: a route that does not exist
// cannot be evidence that a driver was refused.
//
// The constraint found while writing L08, now closed: `validateAuthoritativeJobOtp` resolved the job
// with the SYNCHRONOUS `db.getJob(jobId)` alone, which only searches the in-memory mirror, so a job
// minted by a durable RPC the process never registered could not be OTP-verified through that path
// and L08 failed on a job the store did hold. It now falls back to the store read
// (`this.getJob(jobId) || await this.jobRepo?.findByIdAsync(jobId)`, src/database.js:9286), so the
// mirror is treated as the cache it is rather than the record.
//
// Local/test only. Refuses a non-loopback PostgreSQL target and refuses a store that is not live
// PostgreSQL, because on the mock branch there is no durable row to assert against and every
// assertion below would be about nothing. Everything it creates it reaps by recorded id — offers
// then the job then the drivers then `test_fixtures`' own ownership scope — and the rows it cannot
// reap (the append-only ledger/journal/audit guards) are counted and named in the summary, never
// silently left behind. No shared row is touched: no seeded account, no seeded order, no store
// another suite owns. The delivery OTP is read from this run's own job row and is never printed.
// =========================================================================

const http = require('http');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('../testSessionCache');
const { trackServer, findFreePort } = require('./spawned_server');
const { openFixtures } = require('../test_fixtures');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    else proc.kill('SIGTERM');
  } catch { /* already gone */ }
}

// The restart link (L12) needs the port back, and the runner will not bind while the old process
// still holds it. This waits for the socket to refuse instead of killing anything it did not start.
function waitForPortFree(port, { attempts = 80, delayMs = 250 } = {}) {
  return new Promise((resolve) => {
    let tries = 0;
    const probe = () => {
      const sock = net.connect({ host: '127.0.0.1', port });
      const done = (free) => { sock.destroy(); resolve(free); };
      sock.once('connect', () => { if (++tries >= attempts) return done(false); setTimeout(probe, delayMs); });
      sock.once('error', (e) => done(e.code === 'ECONNREFUSED' || e.code === 'EPERM' || ++tries >= attempts));
      sock.setTimeout(1000, () => sock.destroy());
    };
    probe();
  });
}

async function bootServer({ port, request, attempts = 60, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    cwd: path.join(__dirname, '..'),
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    // The suite owns this server; the session prune is off so a restart re-reads the sessions it
    // already persisted instead of having them deleted by a timer this run does not control (F-13).
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off' },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not listening yet */ }
  }
  return proc;
}

/**
 * @param {object} cfg
 * @param {string} cfg.suiteName    printed in the summary line
 * @param {string} cfg.prefix       assertion id namespace ('FDL' | 'GDL')
 * @param {string} cfg.label        fixture run marker ('fdl' | 'gdl')
 * @param {'RESTAURANT'|'GROCERY'} cfg.merchantType
 * @param {'FOOD'|'GROCERY'} cfg.serviceType
 * @param {{connectionString: string}} cfg.pgTarget  the loopback target the wrapper refused on
 * @param {Function} cfg.seed       (fx, store) => { cart, items }
 * @param {Function} cfg.place      ({request, token, store, cart, address, idempotencyKey}) => res
 */
async function runDeliveryLifecycle(cfg) {
  const P = cfg.prefix;
  const passed = [];
  const failed = [];
  const assert = (id, name, cond, detail) => {
    if (cond === true) { passed.push(id); console.log(`[PASS] ${id} ${name}`); }
    else {
      failed.push(id);
      console.log(`[FAIL] ${id} ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`);
    }
  };
  // A downstream check cannot run because an earlier one left no row to act on. That is reported
  // as a failure of the named check with its reason, never as a pass and never as a crash.
  const blocked = (id, name, reason) => assert(id, name, false, { notReachable: reason });
  // A refusal is only proven by its machine-readable code. Both response shapes the backend uses are
  // read (`{ code }` and `{ error: { code } }`), and anything else is NULL — the measured alternative
  // stringified `undefined` into the literal "undefined", which is truthy and would let a codeless 400
  // look like a coded refusal in a comparison.
  const codeOf = (res) => {
    const d = res && res.data;
    if (!d || typeof d !== 'object') return null;
    if (typeof d.code === 'string') return d.code;
    if (d.error && typeof d.error === 'object' && typeof d.error.code === 'string') return d.error.code;
    return null;
  };
  const body = (res) => ({ status: res.status, code: codeOf(res), error: res.data && res.data.error, raw: res.raw && String(res.raw).slice(0, 120) });

  console.log('========================================================================');
  console.log(`NABIN ${cfg.suiteName} — P3 delivery lifecycle (${cfg.serviceType} / DELIVERY channel)`);
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(cfg.pgTarget.connectionString)}`);
  console.log('========================================================================\n');

  const pg = new Client({ connectionString: cfg.pgTarget.connectionString });
  await pg.connect();

  let fx = null;
  let proc = null;
  let port = null;
  const driverIds = [];
  const jobIds = [];
  const trackedOrderIds = [];
  const measure = {};
  let abortError = null;

  // ---- durable reads: every assertion below goes through these ----------------
  // The channel is read from BOTH places, because they are not the same fact: `create_order_with_lines_atomic`
  // (migration 019:545) does not list `order_channel` among its INSERT columns, so the column always
  // takes its 041 DEFAULT of 'DELIVERY' — for a DINE_IN or TAKEAWAY order too. The channel the customer
  // actually chose lives in `metadata.orderChannel`. A lifecycle implementation that gated on the column
  // would therefore dispatch a dine-in table order, so these suites name both and assert the metadata one.
  // Reads accept either the uuid or the human number, because placement responses name both.
  // `id::text = $1::text` rather than `id = $1::uuid` is deliberate: the measured alternative
  // `id = $1::uuid or order_number = $1` made PostgreSQL infer ONE type for the shared parameter
  // (uuid, from the first comparison) and answer `operator does not exist: character varying = uuid`
  // — which aborted this suite inside condition 1, before a single lifecycle assertion ran.
  // Casting the column side instead keeps the parameter text on both halves, and a uuid rendered to
  // text still compares to the same 36-character string the caller holds.
  const orderRow = async (id) => (await pg.query(
    `select id::text id, order_number, customer_id::text customer_id, merchant_id::text merchant_id,
            order_state, previous_state, service_type, order_channel,
            metadata->>'orderChannel' as meta_channel,
            total_amount::numeric total_amount,
            job_id::text job_id, checkout_id::text checkout_id, created_at
       from orders where id::text = $1::text or order_number = $1::text`, [id])).rows[0] || null;
  const jobRow = async (id) => (await pg.query(
    `select id::text id, job_number, service_type, status, customer_id::text customer_id,
            merchant_id::text merchant_id, driver_id::text driver_id,
            driver_earnings::numeric driver_earnings, final_total::numeric final_total,
            delivery_otp_attempts, delivery_otp_consumed_at, delivery_otp_expires_at,
            delivery_otp_locked_until, created_at
       from jobs where id::text = $1::text or job_number = $1::text`, [id])).rows[0] || null;
  const offersForJob = async (jobUuid) => (await pg.query(
    `select id::text id, driver_uuid::text driver_uuid, status, job_uuid::text job_uuid
       from dispatch_offers where job_uuid = $1::uuid`, [jobUuid])).rows;
  const transitionsFor = async (orderId) => (await pg.query(
    `select id::text id, previous_state, new_state, actor_type, actor_id, reason, created_at
       from order_transitions where order_id = $1::uuid order by created_at`, [orderId])).rows;
  const ordersByCustomer = async (customerUuid) => (await pg.query(
    `select id::text id, order_state, created_at from orders where customer_id = $1::uuid`,
    [customerUuid])).rows;
  const walletOf = async (driverUuid) => (await pg.query(
    `select wallet_balance::numeric wallet from drivers where id = $1::uuid`, [driverUuid])).rows[0] || null;
  const moneyFor = async (jobUuid) => {
    if (!jobUuid) return { ledger: 0, journal: 0 };
    const r = await pg.query(
      `select (select count(*)::int from ledger_entries where job_id::text = $1::text) ledger,
              (select count(*)::int from journal_transactions where job_id::text = $1::text) journal`,
      [jobUuid]);
    return r.rows[0];
  };
  const snapshot = async (orderId, jobUuid, driverUuid) => {
    const o = await orderRow(orderId);
    return {
      orderState: o && o.order_state,
      jobStatus: jobUuid ? (await jobRow(jobUuid)).status : null,
      jobDriver: jobUuid ? (await jobRow(jobUuid)).driver_id : null,
      transitions: (await transitionsFor(orderId)).length,
      wallet: (await walletOf(driverUuid)) || null,
      money: await moneyFor(jobUuid),
    };
  };

  try {
    // ---- identities and catalog ------------------------------------------------
    fx = await openFixtures(cfg.label, { connectionString: cfg.pgTarget.connectionString });
    const store = await fx.merchant({ type: cfg.merchantType, name: `${cfg.serviceType.toLowerCase()} delivery store` });
    const customer = await fx.customer({ name: 'delivery customer' });
    const seeded = await cfg.seed(fx, store);

    // A driver identity that survives `authenticateDriver` needs a linked `users` row: a `drivers`
    // row with no `user_id` is refused 403 UNLINKED_DRIVER_ACCOUNT at the driver boundary, and the
    // DRIVER OTP login only sets that link when a `users` row shares the number (database.js:7138).
    // The phone is stored exactly as `db.normalizePhone` renders it, because the driver lookup is
    // a `.eq('phone', normPhone)` — a format mismatch there reads as DRIVER_PHONE_NOT_ENROLLED.
    //
    // `vehicle_type` is '2W' and not 'BIKE' because the real local CHECK constraint
    // `drivers_vehicle_type_check` admits only 2W / 3W / 4W / AUTO / CAB — read from `pg_constraint`
    // on the target, not assumed from a name. The coordinates are the same Aizawl point
    // `test_fixtures.merchant` writes, so a driver these suites call eligible is eligible by location
    // as well as by status, and an offer set that excludes a null-position driver cannot be mistaken
    // for the defect under test.
    const drivers = [];
    for (const tag of ['A', 'B']) {
      const account = await fx.customer({ name: `driver ${tag} account` });
      const ins = await pg.query(
        `INSERT INTO drivers (id, user_id, name, phone, vehicle_type, vehicle_number,
                              operational_status, is_online, wallet_balance, kyc_status,
                              payout_upi_verified, current_lat, current_lng, last_heartbeat)
         VALUES (gen_random_uuid(), $1::uuid, $2, $3, '2W', $4, 'AVAILABLE', TRUE, 0, 'VERIFIED',
                 false, 23.7176, 92.7176, now())
         RETURNING id::text id`,
        [account.id, fx.marker(`delivery driver ${tag}`), account.phone, `${P}${fx.runId}${tag}`]);
      drivers.push({ tag, account, id: ins.rows[0].id });
      driverIds.push(ins.rows[0].id);
    }

    port = await findFreePort();
    const BASE = `http://127.0.0.1:${port}`;
    const request = makeRequest(BASE);
    const login = createLogin({ baseUrl: BASE, request });
    proc = await bootServer({ port, request });

    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    assert(`${P}-00`, 'a backend this run started and will reap is healthy on its own private port',
      health.status === 200, { port });

    const merchantLogin = await login(store.phone, 'MERCHANT');
    const customerLogin = await login(customer.phone, 'CUSTOMER');
    const drvA = await login(drivers[0].account.phone, 'DRIVER');
    const drvB = await login(drivers[1].account.phone, 'DRIVER');
    const homeA = drvA.token ? await request('GET', '/api/driver/home', null, bearer(drvA.token)) : { status: 0 };
    const homeB = drvB.token ? await request('GET', '/api/driver/home', null, bearer(drvB.token)) : { status: 0 };

    assert(`${P}-01`, 'the fixture store authenticated as MERCHANT through the real OTP path',
      Boolean(merchantLogin.token), merchantLogin.failure || {});
    assert(`${P}-02`, 'the fixture customer authenticated through the real OTP path',
      Boolean(customerLogin.token), customerLogin.failure || {});
    // `GET /api/driver/home` is the boundary that resolves the driver entity, so a 200 here proves
    // the account linkage and not only that a token exists.
    assert(`${P}-03`, 'driver A authenticated and resolves as a linked driver at a driver boundary',
      Boolean(drvA.token) && homeA.status === 200, { token: Boolean(drvA.token), home: body(homeA), failure: drvA.failure || null });
    assert(`${P}-04`, 'driver B authenticated and resolves as a linked driver at a driver boundary',
      Boolean(drvB.token) && homeB.status === 200, { token: Boolean(drvB.token), home: body(homeB), failure: drvB.failure || null });

    const identitiesOk = Boolean(merchantLogin.token && customerLogin.token && drvA.token && drvB.token
      && homeA.status === 200 && homeB.status === 200);
    if (!identitiesOk) throw new Error('identity setup incomplete; the lifecycle cannot be driven');

    // ---- 1) placement: one durable DELIVERY-channel order ----------------------
    const address = 'Ridar Pani Vanni, RL Collection Point, Aizawl';
    const idemKey = `${P.toLowerCase()}_place_${fx.runId}`;
    const placed = await cfg.place({ request, token: customerLogin.token, store, cart: seeded.cart, address, idempotencyKey: idemKey });
    const placedId = placed && placed.data && placed.data.order
      ? (placed.data.order.id || placed.data.order.order_id || placed.data.order.order_number) : null;
    measure.placeStatus = placed.status;
    measure.placeBody = body(placed);

    let orderId = placedId ? String(placedId) : null;
    let order = orderId ? await orderRow(orderId) : null;
    if (order) orderId = order.id;
    if (orderId) trackedOrderIds.push(orderId);
    const ordersForCustomer = orderId ? await ordersByCustomer(customer.id) : [];

    assert(`${P}-L01`, '1) placement wrote exactly one durable order, on the DELIVERY channel, priced and bound to this customer and store',
      Boolean(order) && /^[0-9a-f-]{36}$/.test(order.id) && order.service_type === cfg.serviceType
      && order.order_channel === 'DELIVERY'
      && (cfg.metaChannel === undefined || String(order.meta_channel || '') === cfg.metaChannel)
      && Number(order.total_amount) > 0
      && order.customer_id === customer.id && order.merchant_id === store.id
      && ordersForCustomer.length === 1,
      { place: measure.placeBody, order, ordersForCustomer: ordersForCustomer.length,
        note: 'metadata.orderChannel is the channel that was actually chosen or written; the column is a 041 DEFAULT that no INSERT path lists' });
    measure.metaChannel = order ? order.meta_channel : null;
    measure.columnChannel = order ? order.order_channel : null;

    // ---- 2) the order→job link -------------------------------------------------
    let jobUuid = order && order.job_id ? order.job_id : null;
    let job = jobUuid ? await jobRow(jobUuid) : null;
    if (job) { jobUuid = job.id; jobIds.push(job.id); }
    assert(`${P}-L02`, '2) that order links to exactly one durable job naming the same service, customer and store',
      Boolean(job) && job.service_type === cfg.serviceType && job.customer_id === customer.id
      && job.merchant_id === store.id,
      jobUuid ? { jobUuid, job } : { jobIdFromOrder: order && order.job_id, note: 'orders.job_id is NULL — nothing created a delivery job' });

    // ---- 2b) nothing substitutes an order id for a job id --------------------
    // `book-food` used to answer `{ success, duplicate, order, job }` with `job` set to the ORDER
    // payload, and the KDS broadcast put that same order id in the `job.id` field — which is exactly
    // how a driver app came to be driven with an id no job table answers to. The fix names the
    // durable job instead, under `deliveryJob`, with that job's own uuid in `jobId`. The rule pinned
    // here is that rule: a response that names a job names the DURABLE job, by its own id, and never
    // the order's. A refusal to hand over carries no `jobId` at all, and then this check has nothing
    // to substitute — which is why the else branch is still a real assertion rather than a pass.
    const respJob = placed.data && (placed.data.job || (placed.data.order && placed.data.order.job) || placed.data.deliveryJob);
    const respJobId = respJob && (respJob.jobId || respJob.id || respJob.job_id);
    assert(`${P}-L02b`, '2b) the placement response names the durable job by its own id and never substitutes the order id for it',
      Boolean(respJobId) ? (Boolean(jobUuid) && String(respJobId) === String(jobUuid) && String(respJobId) !== String(orderId))
        : String((respJob && respJob.id) || '') !== String(orderId),
      { namesJob: Boolean(respJobId), namedJobId: respJobId || null, durableJobId: jobUuid, orderId,
        note: respJobId ? 'a job was named — it must be the durable one' : 'no job named in the response' });
    const offers = jobUuid ? await offersForJob(jobUuid) : [];
    const pairCounts = {};
    for (const o of offers) pairCounts[o.driver_uuid || '-'] = (pairCounts[o.driver_uuid || '-'] || 0) + 1;
    const dupDrivers = Object.entries(pairCounts).filter(([, n]) => n > 1).map(([d]) => d);
    measure.offerCount = offers.length;
    assert(`${P}-L03`, '3) dispatch offers exist for that job id, hold the accepting driver, and repeat no (job, driver) pair',
      offers.length > 0 && offers.every((o) => o.job_uuid === jobUuid)
      && offers.some((o) => o.driver_uuid === drivers[0].id) && dupDrivers.length === 0,
      { jobUuid, offerCount: offers.length, hasDriverA: offers.some((o) => o.driver_uuid === drivers[0].id), dupDrivers });

    // ---- 4) the authorized driver accepts, the second driver does not take it --
    if (!jobUuid) {
      blocked(`${P}-L04`, '4) the authorized driver is assigned the real job and a competing driver is refused',
        'no durable job exists to accept (L02)');
    } else {
      const acceptA = await request('POST', '/api/driver/accept-job', { jobId: jobUuid }, bearer(drvA.token));
      const jobAfterA = await jobRow(jobUuid);
      const offersAfterA = await offersForJob(jobUuid);
      const acceptB = await request('POST', '/api/driver/accept-job', { jobId: jobUuid }, bearer(drvB.token));
      const jobAfterB = await jobRow(jobUuid);
      assert(`${P}-L04`, '4) the authorized driver is assigned the real job durably and a second driver cannot take it',
        acceptA.status === 200 && acceptA.data && acceptA.data.success === true
        && jobAfterA && jobAfterA.status === 'ASSIGNED' && jobAfterA.driver_id === drivers[0].id
        && offersAfterA.filter((o) => o.status === 'ACCEPTED').length === 1
        && !(acceptB.status === 200 && acceptB.data && acceptB.data.success === true)
        && jobAfterB && jobAfterB.driver_id === drivers[0].id,
        { acceptA: body(acceptA), statusA: jobAfterA && jobAfterA.status, acceptedOffers: offersAfterA.filter((o) => o.status === 'ACCEPTED').length, acceptB: body(acceptB), driverAfterB: jobAfterB && jobAfterB.driver_id });
    }

    // ---- 5) the merchant advances to READY_FOR_PICKUP and no further ----------
    const kds = (status, key) => request('POST', `/api/merchant/orders/${orderId}/status`, { status },
      { ...bearer(merchantLogin.token), 'Idempotency-Key': key });
    const kdsSteps = [];
    if (!orderId) {
      blocked(`${P}-L05`, '5) the merchant reaches READY_FOR_PICKUP through the approved states and cannot self-advance to PICKED_UP',
        'no durable order was placed (L01)');
    } else {
      for (const st of ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) {
        const r = await kds(st, `${P}_kds_${st}_${fx.runId}`);
        kdsSteps.push({ st, ...body(r) });
      }
      const atReady = await orderRow(orderId);
      const overreach = await kds('PICKED_UP', `${P}_kds_PICKED_UP_${fx.runId}`);
      const afterOverreach = await orderRow(orderId);
      measure.kdsSteps = kdsSteps;
      assert(`${P}-L05`, '5) the merchant reaches READY_FOR_PICKUP through the approved states and cannot self-advance to PICKED_UP',
        atReady && atReady.order_state === 'READY_FOR_PICKUP'
        && overreach.status === 400 && codeOf(overreach) === 'INVALID_STATUS'
        && afterOverreach && afterOverreach.order_state === 'READY_FOR_PICKUP',
        { atReady: atReady && atReady.order_state, overreach: body(overreach), afterOverreach: afterOverreach && afterOverreach.order_state });
    }

    // ---- 6) an unassigned driver cannot take the order, with no side effect ----
    const before6 = orderId && jobUuid ? await snapshot(orderId, jobUuid, drivers[1].id) : null;
    if (!orderId) {
      blocked(`${P}-L06`, '6) a driver who is not the assigned driver is refused, with no state or financial side effect',
        'no durable order (L01)');
    } else {
      const notMine = await request('POST', '/api/driver/pickup-order', { orderId }, bearer(drvB.token));
      const after6 = await snapshot(orderId, jobUuid, drivers[1].id);
      assert(`${P}-L06`, '6) a driver who is not the assigned driver is refused, with no state or financial side effect',
        // 404 means no such route — a missing capability, not proof of an authorization decision.
        notMine.status === 403 && codeOf(notMine) === 'JOB_NOT_ASSIGNED_TO_DRIVER'
        && before6 && after6 && before6.orderState === after6.orderState
        && before6.jobStatus === after6.jobStatus && before6.jobDriver === after6.jobDriver
        && before6.transitions === after6.transitions
        && String(before6.wallet && before6.wallet.wallet) === String(after6.wallet && after6.wallet.wallet)
        && before6.money.ledger === after6.money.ledger && before6.money.journal === after6.money.journal,
        { refusal: body(notMine), unchanged: before6 && after6 && {
          orderState: before6.orderState === after6.orderState,
          jobStatus: before6.jobStatus === after6.jobStatus,
          transitions: before6.transitions === after6.transitions,
          money: before6.money.ledger === after6.money.ledger && before6.money.journal === after6.money.journal } });
    }

    // ---- 7) the assigned driver records pickup --------------------------------
    if (!orderId) {
      blocked(`${P}-L07`, '7) the assigned driver records pickup and the order durably reaches PICKED_UP', 'no durable order (L01)');
    } else {
      const pickup = await request('POST', '/api/driver/pickup-order', { orderId }, bearer(drvA.token));
      const pickedUp = await orderRow(orderId);
      const jobNow = jobUuid ? await jobRow(jobUuid) : null;
      const tr = pickedUp ? await transitionsFor(pickedUp.id) : [];
      measure.pickup = body(pickup);
      assert(`${P}-L07`, '7) the assigned driver records pickup and the order durably reaches PICKED_UP with a DRIVER-authored transition',
        pickup.status === 200 && pickedUp && pickedUp.order_state === 'PICKED_UP'
        && tr.some((t) => t.actor_type === 'DRIVER' && t.new_state === 'PICKED_UP')
        && jobNow && jobNow.status !== 'ASSIGNED',
        { response: body(pickup), orderState: pickedUp && pickedUp.order_state, jobStatus: jobNow && jobNow.status,
          driverTransitions: tr.filter((t) => t.actor_type === 'DRIVER').map((t) => t.new_state) });
    }

    // ---- 12) a restart cannot lose non-terminal work --------------------------
    if (!orderId) {
      blocked(`${P}-L12`, '12) a restart keeps the partially completed order and its job, and the reads still agree',
        'no durable order (L01)');
    } else {
      const beforeRestart = await orderRow(orderId);
      stopProc(proc); proc = null;
      const freed = await waitForPortFree(port);
      await sleep(250);
      proc = await bootServer({ port, request });
      const afterRestart = await orderRow(orderId);
      const jobAfterRestart = jobUuid ? await jobRow(jobUuid) : null;
      const readBack = await request('GET', `/api/customer/orders/${orderId}`, null, bearer(customerLogin.token));
      measure.freedPort = freed;
      assert(`${P}-L12`, '12) a restart keeps the partially completed order and its job, and the reads still agree',
        Boolean(freed && afterRestart && jobAfterRestart)
        && afterRestart.order_state === beforeRestart.order_state
        && String(afterRestart.job_id) === String(beforeRestart.job_id)
        && readBack.status === 200 && readBack.data && readBack.data.order
        && readBack.data.order.order_state === afterRestart.order_state,
        { portFreed: freed, before: beforeRestart.order_state, after: afterRestart && afterRestart.order_state,
          jobStillLinked: afterRestart && String(afterRestart.job_id) === String(beforeRestart.job_id),
          read: body(readBack), readState: readBack.data && readBack.data.order && readBack.data.order.order_state });
    }

    // ---- 8) the delivery code is enforced ------------------------------------
    // This exercises the mechanism the fix must REUSE: `verify_job_otp_atomic` behind
    // `POST /api/driver/verify-otp`, which checks the assignment before it consumes anything.
    if (!jobUuid) {
      blocked(`${P}-L08`, '8) the delivery code is enforced: wrong, wrong-driver, expired and then single-use',
        'no durable job to verify a code against (L02)');
    } else {
      const otpState = async () => (await pg.query(
        `select delivery_otp, delivery_otp_attempts, delivery_otp_consumed_at, delivery_otp_expires_at
           from jobs where id::text = $1::text`, [jobUuid])).rows[0] || null;

      const otpRow = await otpState();
      const otp = otpRow && otpRow.delivery_otp;
      const wrongOtp = otp ? String((Number(otp) === 1000 ? 9999 : 1000 + ((Number(otp) + 4321) % 9000))).padStart(4, '0') : null;
      const verify = (t, code) => request('POST', '/api/driver/verify-otp', { jobId: jobUuid, otp: code, otpType: 'DELIVERY' }, bearer(t));

      const wrong = otp ? await verify(drvA.token, wrongOtp) : { status: 0 };
      const afterWrong = await otpState();
      const wrongOk = wrong.status === 400 && codeOf(wrong) === 'OTP_MISMATCH'
        && Number(afterWrong.delivery_otp_attempts) >= 1 && !afterWrong.delivery_otp_consumed_at;

      const stranger = otp ? await verify(drvB.token, otp) : { status: 0 };
      const afterStranger = await otpState();
      const strangerOk = !(stranger.status === 200 && stranger.data && stranger.data.success === true)
        && !afterStranger.delivery_otp_consumed_at;

      // Force the code to be expired, then prove the store refuses it while it still matches.
      // 410 is the status #439 must give an expired handover code; the measured RED run never reached
      // this block (no job existed to verify against), so the code is pinned here and confirmed at GREEN.
      await pg.query(`update jobs set delivery_otp_expires_at = now() - interval '1 minute' where id::text = $1::text`, [jobUuid]);
      const expired = otp ? await verify(drvA.token, otp) : { status: 0 };
      const afterExpired = await otpState();
      await pg.query(`update jobs set delivery_otp_expires_at = now() + interval '24 hours' where id::text = $1::text`, [jobUuid]);
      const expiredOk = expired.status === 410 && codeOf(expired) === 'OTP_EXPIRED'
        && !afterExpired.delivery_otp_consumed_at;

      measure.otp = { wrong: body(wrong), stranger: body(stranger), expired: body(expired), attempts: Number(afterWrong && afterWrong.delivery_otp_attempts) };
      assert(`${P}-L08`, '8) the delivery code is enforced: a wrong guess counts, a correct code from the wrong driver consumes nothing, an expired code is refused',
        Boolean(otp) && wrongOk && strangerOk && expiredOk,
        { hasOtp: Boolean(otp), wrong: body(wrong), attempts: measure.otp.attempts, wrongDriver: body(stranger), expired: body(expired) });
    }

    // ---- 9) the assigned driver records delivery ------------------------------
    let delivered = false;
    if (!orderId || !jobUuid) {
      blocked(`${P}-L09`, '9) the assigned driver delivers with the customer\'s code', 'no durable order/job pair (L01, L02)');
    } else {
      const otpRow = await pg.query(`select delivery_otp from jobs where id::text = $1::text`, [jobUuid]);
      const otp = otpRow.rows[0] && otpRow.rows[0].delivery_otp;
      const deliver = await request('POST', '/api/driver/deliver-order', { orderId, otp }, bearer(drvA.token));
      measure.deliver = body(deliver);
      delivered = deliver.status === 200 && deliver.data && deliver.data.success === true;
      assert(`${P}-L09`, '9) the assigned driver delivers the order with the customer\'s code',
        Boolean(otp) && delivered, { response: body(deliver), hasOtp: Boolean(otp) });
    }

    // ---- 10) everything agrees on the completed state ------------------------
    if (!delivered) {
      blocked(`${P}-L10`, '10) the order, the job and both app reads agree the delivery happened',
        'delivery was never accepted (L09)');
    } else {
      const done = await orderRow(orderId);
      const doneJob = await jobRow(jobUuid);
      const custRead = await request('GET', `/api/customer/orders/${orderId}`, null, bearer(customerLogin.token));
      const merchantList = await request('GET', '/api/merchant/orders', null, bearer(merchantLogin.token));
      const merchantListAll = await request('GET', '/api/merchant/orders?status=DELIVERED', null, bearer(merchantLogin.token));
      const rows = []
        .concat((merchantList.data && merchantList.data.orders) || [])
        .concat((merchantListAll.data && merchantListAll.data.orders) || []);
      const seen = rows.find((o) => String(o.id) === orderId || String(o.order_id) === orderId);
      const tr = await transitionsFor(orderId);
      const money = await moneyFor(jobUuid);
      const wallet = await walletOf(drivers[0].id);
      measure.final = { orderState: done && done.order_state, jobStatus: doneJob && doneJob.status, money, wallet: wallet && wallet.wallet, earnings: doneJob && doneJob.driver_earnings };
      assert(`${P}-L10`, '10) the order is durably DELIVERED, its job COMPLETED, and the customer and merchant reads match the rows',
        done && done.order_state === 'DELIVERED' && doneJob && doneJob.status === 'COMPLETED'
        && tr.some((t) => t.new_state === 'DELIVERED' && t.actor_type === 'DRIVER')
        && custRead.status === 200 && custRead.data && custRead.data.order
        && custRead.data.order.order_state === 'DELIVERED'
        && Boolean(seen) && String(seen.order_state || seen.status) === 'DELIVERED',
        { orderState: done && done.order_state, jobStatus: doneJob && doneJob.status,
          customerRead: body(custRead), customerReadState: custRead.data && custRead.data.order && custRead.data.order.order_state,
          merchantSawRow: Boolean(seen), merchantReadState: seen && (seen.order_state || seen.status) });

      // The money half of the same condition: the driver is paid what the durable job says, and
      // nothing is booked for a handover whose job carries no earnings.
      const earned = Number(doneJob && doneJob.driver_earnings) || 0;
      const paid = Number(wallet && wallet.wallet) || 0;
      assert(`${P}-L10b`, '10b) the settlement is consistent with the durable job (a paid delivery moves the wallet by exactly its earnings; an unpriced handover books nothing)',
        earned > 0 ? paid === earned : (paid === 0 && money.ledger === 0 && money.journal === 0),
        { earnings: earned, walletBalance: paid, ledger: money.ledger, journal: money.journal,
          note: 'no delivery-fee rule exists in any migration or PricingRepository, so a handover job is priced 0 and its settlement is an open owner decision' });
    }

    // ---- 11) retry and replay produce nothing second -------------------------
    // Two separate facts, and they become measurable at different points. The measured first RED run
    // recorded the combined check as PASS with `pickupTransitions` 0, `offersNow.length === measure.offerCount`
    // as 0 === 0, and both money snapshots the empty pair — every clause satisfied by a run that had
    // nothing to duplicate. A replay proof only proves something against a completed lifecycle, so the
    // lifecycle half is blocked until a delivery landed, and the placement half that IS measurable today
    // is named on its own.
    if (!orderId) {
      blocked(`${P}-L11b`, '11b) replaying the placement with the same key reports a duplicate and writes no second order',
        'no durable order (L01)');
    } else {
      const replaced = await cfg.place({ request, token: customerLogin.token, store, cart: seeded.cart, address, idempotencyKey: idemKey });
      const ordersNow = await ordersByCustomer(customer.id);
      for (const o of ordersNow) if (!trackedOrderIds.includes(o.id)) trackedOrderIds.push(o.id);
      measure.replaced = body(replaced);
      assert(`${P}-L11b`, '11b) replaying the placement with the same idempotency key reports a duplicate and writes no second order',
        replaced.status === 200 && replaced.data && replaced.data.duplicate === true && ordersNow.length === 1,
        { replay: body(replaced), ordersForCustomer: ordersNow.length });
    }

    if (!orderId || !jobUuid || !delivered) {
      blocked(`${P}-L11`, '11) replay cannot duplicate a job, offer set, transition, completion or money row',
        !orderId ? 'no durable order (L01)'
          : !jobUuid ? 'no durable job (L02)'
            : 'no completed delivery to replay against (L09)');
    } else {
      const beforeReplay = await snapshot(orderId, jobUuid, drivers[0].id);
      const repickup = await request('POST', '/api/driver/pickup-order', { orderId }, bearer(drvA.token));
      const otpNow = (await pg.query(`select delivery_otp from jobs where id::text = $1::text`, [jobUuid])).rows[0];
      const redeliver = await request('POST', '/api/driver/deliver-order', { orderId, otp: otpNow && otpNow.delivery_otp }, bearer(drvA.token));
      const afterReplay = await snapshot(orderId, jobUuid, drivers[0].id);
      const orderNow = await orderRow(orderId);
      const offersNow = await offersForJob(jobUuid);
      const transitionsNow = await transitionsFor(orderId);
      const pickupTransitions = transitionsNow.filter((t) => t.new_state === 'PICKED_UP');
      measure.replay = { repickup: body(repickup), redeliver: body(redeliver) };
      assert(`${P}-L11`, '11) replay creates no second job link, offer set, PICKED_UP transition, completion or money row',
        !(redeliver.status === 200 && redeliver.data && redeliver.data.success === true)
        && pickupTransitions.length === 1
        && String(orderNow.job_id) === String(jobUuid)
        && afterReplay.orderState === beforeReplay.orderState
        && afterReplay.transitions === beforeReplay.transitions
        && afterReplay.money.ledger === beforeReplay.money.ledger
        && afterReplay.money.journal === beforeReplay.money.journal
        && String(afterReplay.wallet && afterReplay.wallet.wallet) === String(beforeReplay.wallet && beforeReplay.wallet.wallet)
        && offersNow.length === measure.offerCount
        && offersNow.filter((o) => o.status === 'ACCEPTED').length === 1,
        { repickup: body(repickup), redeliver: body(redeliver),
          jobStillLinked: String(orderNow.job_id) === String(jobUuid), offersNow: offersNow.length, offersAtL03: measure.offerCount,
          pickupTransitions: pickupTransitions.length, transitions: `${beforeReplay.transitions}->${afterReplay.transitions}`,
          walletBefore: beforeReplay.wallet && beforeReplay.wallet.wallet, walletAfter: afterReplay.wallet && afterReplay.wallet.wallet,
          moneyBefore: beforeReplay.money, moneyAfter: afterReplay.money });
    }

    console.log('\n--- RESULT ---');
  } catch (err) {
    // An aborted run is a FAILED run, never a shorter pass list. Without this branch the summary
    // printed the checks that happened to complete — the measured second FOOD run died in the
    // condition-1 durable read and reported "5/5 passed, 0 failed" while its exit code came only
    // from the caller's `.catch`. A reader must not be able to mistake a truncated run for green.
    abortError = err;
    failed.push(`${P}-ABORT`);
    console.log(`[FAIL] ${P}-ABORT the lifecycle aborted before its checks finished: ${err && err.message}`);
  } finally {
    // ---- teardown, in dependency order --------------------------------------
    // offers → job → drivers → the fixture handle's own ownership scope. `jobs` references
    // users/drivers/merchants with NO ACTION and `orders.job_id` is SET NULL, so the job has to
    // go before the identities, and nothing here deletes a row this run did not create.
    const reap = [];
    for (const [label, sql, param] of [
      ['dispatch_offers', 'delete from dispatch_offers where job_uuid = any($1::uuid[])', jobIds],
      ['jobs', 'delete from jobs where id = any($1::uuid[])', jobIds],
      ['drivers', 'delete from drivers where id = any($1::uuid[])', driverIds],
    ]) {
      if (!param.length) { reap.push({ label, deleted: 0 }); continue; }
      try { const r = await pg.query(sql, [param]); reap.push({ label, deleted: r.rowCount }); }
      catch (e) { reap.push({ label, error: e.code || e.message }); }
    }
    let fixtureRemoved = null;
    try { fixtureRemoved = await fx ? await fx.close() : null; }
    catch (e) { console.error('[CLEANUP FAILED] fixture rows may remain:', e.message); }
    console.log(`\n[cleanup] reaped by this run: ${JSON.stringify(reap)}`);
    if (fixtureRemoved) console.log(`[cleanup] fixtures reaped: ${JSON.stringify(fixtureRemoved)}`);

    console.log('\n================ SUMMARY ================');
    // Residue is measured against the ids this run recorded, not against "looks like test data":
    // after `fx.close()` the fixture customers and stores are gone, so an id list is the only
    // scope that can still name this run's rows.
    let residue = { orders: 0, lines: 0, jobs: 0, offers: 0 };
    try {
      const r = await pg.query(
        `select (select count(*)::int from orders where id = any($1::uuid[])) orders,
                (select count(*)::int from order_lines where order_id = any($1::uuid[])) lines,
                (select count(*)::int from jobs where id = any($2::uuid[])) jobs,
                (select count(*)::int from dispatch_offers where job_uuid = any($2::uuid[])) offers`,
        [trackedOrderIds.length ? trackedOrderIds : [], jobIds.length ? jobIds : []]);
      residue = r.rows[0] || residue;
    } catch (e) { console.log(`[residue] could not be measured: ${e.message}`); }
    console.log(`residue named by this run's ids: orders ${residue.orders}, order_lines ${residue.lines}, `
      + `jobs ${residue.jobs}, dispatch_offers ${residue.offers}`);
    console.log(`measured: place=${measure.placeStatus} offers=${measure.offerCount ?? 'n/a'} `
      + `pickup=${measure.pickup && measure.pickup.status} deliver=${measure.deliver && measure.deliver.status} `
      + `finalOrderState=${measure.final && measure.final.orderState} finalJobStatus=${measure.final && measure.final.jobStatus} `
      + `driverEarnings=${measure.final && measure.final.earnings} wallet=${measure.final && measure.final.wallet} `
      + `ledger=${measure.final && measure.final.money.ledger} journal=${measure.final && measure.final.money.journal}`);
    console.log(`rows this run could NOT reap: the append-only ledger/journal/audit guards (migrations 024/033) `
      + `refuse DELETE for every role, so any money row a settlement wrote here stays as a permanent census count.`);
    console.log(`=== ${cfg.suiteName}: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed ===`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const f of failed) console.log(`  - ${f}`);
    }
    if (abortError) console.log(`abort stack: ${abortError.stack || abortError}`);

    stopProc(proc);
    await pg.end().catch(() => {});
    process.exitCode = failed.length ? 1 : 0;
  }
}

module.exports = { runDeliveryLifecycle, makeRequest, bootServer, stopProc, waitForPortFree, maskTarget };
