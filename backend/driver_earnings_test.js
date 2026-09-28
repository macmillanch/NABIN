/**
 * Driver earnings — GET /api/driver/earnings and GET /api/driver/:driverId/earnings
 *
 * The driver app displayed ₹1,420.00 / ₹9,850.00 / ₹38,400.00 as literal text, with a
 * "NABIN Platform Fee (10%)" line and a UPI id that exist nowhere in the database. This is
 * the endpoint that has to replace those numbers, so it has to hold:
 *
 *   1. Every rupee is summed from `jobs` rows the driver actually completed. Nothing in the
 *      response is a client-supplied figure and nothing is a process-local counter — the
 *      pre-existing `driver.todayEarnings` was hardcoded to 0 for every PostgreSQL-hydrated
 *      driver, so a driver who had worked all week read back as ₹0 after any restart.
 *   2. Identity comes from the bearer token. A body or query `driverId` is ignored outright,
 *      and the path-scoped variant keeps refusing another driver.
 *   3. One implementation behind both routes, so the guarded path cannot drift from the one
 *      the app calls.
 *   4. An unreachable or unfinished read is a 503, never a zero. "You earned nothing" and
 *      "we could not read what you earned" are different answers.
 *
 * The expected money is recomputed here from PostgreSQL with its own `range()` paging, on
 * purpose: `getDriverCompletedRows` walks with an `id` cursor, so reusing it would let a
 * bug in the walk hide a bug in the sum. A test that reads the production reader proves the
 * reader agrees with itself, which is not the property worth locking.
 *
 * Requires the local backend on :4000 and the local Docker PostgreSQL.
 */
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { createLogin } = require('./testSessionCache');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const sharedLogin = createLogin({ baseUrl: BASE_URL, request });
const EARNINGS_PATH = '/api/driver/earnings';
const DRIVER_PHONE = '9810122910';      // fixture driver DRV-101 / ...000101
const DRIVER_UUID = '00000000-0000-0000-0000-000000000101';
const FOREIGN_UUID = '00000000-0000-0000-0000-000000000102'; // a different driver, no completed trips
const CUSTOMER_PHONE = '9845011982';
const DAY_MS = 24 * 60 * 60 * 1000;

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
    // A GET carrying a body without `Content-Length` is sent chunked, which this HTTP stack
    // refuses before Express ever sees it. Declaring the length is what a real client does,
    // and it is the only way to prove the route ignores a body-supplied identity rather than
    // merely never receiving one.
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function login(phone, role) {
  // Same reasoning as the other chained suites: the OTP buys a session to read earnings with,
  // it is not what this file asserts. Reuse a live session, re-authenticate only when the server
  // says it is gone, and keep the role confirmation inside the probe.
  const { token } = await sharedLogin(phone, role);
  return token;
}

/** Independent paging: `range()` windows driven by the store's own exact count. */
async function readCompletedJobs(store, driverUuid, sinceIso) {
  const rows = [];
  const PAGE = 500;
  let from = 0;
  let total = null;
  for (;;) {
    const { data, error, count } = await store.from('jobs')
      .select('id,job_number,service_type,driver_id,status,final_total,driver_earnings,platform_commission,payment_status,updated_at,created_at',
        { count: 'exact' })
      .eq('driver_id', driverUuid)
      .eq('status', 'COMPLETED')
      .gte('updated_at', sinceIso)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`recompute read failed: ${error.message}`);
    if (total === null) total = count;
    rows.push(...(data || []));
    from += PAGE;
    if (!data || data.length < PAGE || rows.length >= total) return { rows, total };
  }
}

function bucketize(rows, windowStarts) {
  const out = {};
  for (const key of Object.keys(windowStarts)) {
    out[key] = { trips: 0, grossFares: 0, platformFees: 0, netEarnings: 0 };
  }
  for (const r of rows) {
    const at = Date.parse(r.updated_at || r.created_at) || 0;
    for (const [key, start] of Object.entries(windowStarts)) {
      if (at >= start) {
        out[key].trips += 1;
        out[key].grossFares += Number(r.final_total || 0);
        out[key].platformFees += Number(r.platform_commission || 0);
        out[key].netEarnings += Number(r.driver_earnings || 0);
      }
    }
  }
  for (const t of Object.values(out)) {
    t.grossFares = Math.round(t.grossFares * 100) / 100;
    t.platformFees = Math.round(t.platformFees * 100) / 100;
    t.netEarnings = Math.round(t.netEarnings * 100) / 100;
  }
  return out;
}

const WINDOW_KEYS = ['last24h', 'last7d', 'last30d'];

async function main() {
  console.log('--- DRIVER EARNINGS TESTS ---');

  const { supabaseAdmin } = require('./src/supabase');
  if (!supabaseAdmin) {
    console.log('SKIP: PostgreSQL is not configured; these checks pin the PostgreSQL-derived figures.');
    return finish();
  }

  // --- the gate ------------------------------------------------------------------
  const anon = await request('GET', EARNINGS_PATH);
  assert('EARN-01 no token -> 401 and no earnings body',
    anon.status === 401 && anon.data.success !== true, { status: anon.status, body: anon.data });

  const bogus = await request('GET', EARNINGS_PATH, null, { Authorization: 'Bearer nabin_driver_tok_bogus_1' });
  assert('EARN-02 a made-up token -> 401, not somebody\'s wallet',
    bogus.status === 401, { status: bogus.status, body: bogus.data });

  const customerToken = await login(CUSTOMER_PHONE, 'CUSTOMER');
  if (customerToken) {
    const asCustomer = await request('GET', EARNINGS_PATH, null, { Authorization: `Bearer ${customerToken}` });
    assert('EARN-03 a customer session is refused on the driver earnings read',
      asCustomer.status === 401 || asCustomer.status === 403,
      { status: asCustomer.status, body: asCustomer.data });
  } else {
    assert('EARN-03 a customer session is refused on the driver earnings read', false,
      { reason: 'fixture customer could not sign in, so the role gate was not exercised' });
  }

  const token = await login(DRIVER_PHONE, 'DRIVER');
  assert('EARN-04 a real driver can sign in over OTP', !!token, { gotToken: !!token });
  if (!token) return finish();
  const auth = { Authorization: `Bearer ${token}` };

  const res0 = await request('GET', EARNINGS_PATH, null, auth);
  assert('EARN-05 authenticated read -> 200 with success',
    res0.status === 200 && res0.data.success === true, { status: res0.status, body: res0.data });
  const body = res0.data || {};

  assert('EARN-06 the figures came from PostgreSQL, not the memory fallback',
    body.source === 'postgres', { source: body.source });

  // --- independent recompute ------------------------------------------------------
  const now = Date.now();
  const windowStarts = { last24h: now - DAY_MS, last7d: now - 7 * DAY_MS, last30d: now - 30 * DAY_MS };
  const { rows, total } = await readCompletedJobs(supabaseAdmin, DRIVER_UUID, new Date(windowStarts.last30d).toISOString());
  const expected = bucketize(rows, windowStarts);
  console.log(`NOTE: recomputed from ${rows.length} of ${total} completed rows for ${DRIVER_UUID}.`);

  assert('EARN-07 the fixture driver really has completed trips to earn from',
    rows.length > 0 && expected.last30d.trips > 0, { rows: rows.length });

  let windowMismatch = [];
  for (const key of WINDOW_KEYS) {
    const got = (body.windows || {})[key] || {};
    const want = expected[key];
    if (got.trips !== want.trips) windowMismatch.push({ key, field: 'trips', got: got.trips, want: want.trips });
    if (!same(got.grossFares, want.grossFares)) windowMismatch.push({ key, field: 'grossFares', got: got.grossFares, want: want.grossFares });
    if (!same(got.platformFees, want.platformFees)) windowMismatch.push({ key, field: 'platformFees', got: got.platformFees, want: want.platformFees });
    if (!same(got.netEarnings, want.netEarnings)) windowMismatch.push({ key, field: 'netEarnings', got: got.netEarnings, want: want.netEarnings });
  }
  assert('EARN-08 every window equals an independent PostgreSQL recompute to the paisa',
    windowMismatch.length === 0, { mismatch: windowMismatch });

  assert('EARN-09 the legacy aliases carry the same durable figures the windows do',
    same(body.todayEarnings, expected.last24h.netEarnings)
    && body.todayTrips === expected.last24h.trips
    && same(body.weeklyEarnings, expected.last7d.netEarnings)
    && same(body.monthlyEarnings, expected.last30d.netEarnings),
    { todayEarnings: body.todayEarnings, todayTrips: body.todayTrips, weeklyEarnings: body.weeklyEarnings, monthlyEarnings: body.monthlyEarnings });

  assert('EARN-10 a driver with completed trips is never reported as having earned nothing',
    expected.last30d.netEarnings > 0 && body.monthlyEarnings > 0,
    { monthlyEarnings: body.monthlyEarnings, expectedNet: expected.last30d.netEarnings });

  const win = body.windows || {};
  assert('EARN-11 the windows are windows — a narrower one is not the whole table',
    expected.last24h.trips <= expected.last7d.trips && expected.last7d.trips <= expected.last30d.trips
    && ((win.last24h || {}).trips < (win.last30d || {}).trips || expected.last30d.trips === expected.last24h.trips),
    { last24h: (win.last24h || {}).trips, last7d: (win.last7d || {}).trips, last30d: (win.last30d || {}).trips });

  assert('EARN-12 commission reported today is the platform cut on rows, not a counter',
    same(body.commissionPaidToday, expected.last24h.platformFees),
    { got: body.commissionPaidToday, want: expected.last24h.platformFees });

  const walletRes = await supabaseAdmin.from('drivers')
    .select('wallet_balance,verified_upi_id,payout_upi_verified,pending_upi_id,upi_cooling_until,kyc_status,operational_status')
    .eq('id', DRIVER_UUID).maybeSingle();
  assert('EARN-13 the wallet balance equals the drivers column, which survives a restart',
    !walletRes.error && same(body.walletBalance, walletRes.data && walletRes.data.wallet_balance),
    { got: body.walletBalance, stored: walletRes.data && walletRes.data.wallet_balance });

  // --- trip rows are real and the caller's own --------------------------------------
  const recent = Array.isArray(body.recentTrips) ? body.recentTrips : [];
  assert('EARN-14 a recent-trip list is present and capped',
    Array.isArray(body.recentTrips) && recent.length <= 10 && recent.length > 0,
    { length: recent.length });

  const numbers = recent.map(t => t.jobNumber).filter(Boolean);
  const claimed = await supabaseAdmin.from('jobs')
    .select('job_number,driver_id,status,final_total,driver_earnings,platform_commission,payment_status,updated_at')
    .in('job_number', numbers);
  const byNumber = new Map((claimed.data || []).map(r => [r.job_number, r]));
  assert('EARN-15 every listed trip exists in PostgreSQL',
    !claimed.error && numbers.every(n => byNumber.has(n)), { numbers });

  const foreign = numbers.filter(n => {
    const r = byNumber.get(n);
    return !r || r.driver_id !== DRIVER_UUID || r.status !== 'COMPLETED';
  });
  assert('EARN-16 every listed trip is the caller\'s own and genuinely completed',
    foreign.length === 0, { foreign });

  const moneyWrong = recent.filter(t => {
    const r = byNumber.get(t.jobNumber);
    if (!r) return false;
    return !same(t.grossFare, r.final_total) || !same(t.driverEarnings, r.driver_earnings)
      || !same(t.platformCommission, r.platform_commission);
  });
  assert('EARN-17 each listed trip shows the stored rupees, to the paisa',
    moneyWrong.length === 0,
    { wrong: moneyWrong.map(t => ({ id: t.jobNumber, shown: t.driverEarnings, stored: (byNumber.get(t.jobNumber) || {}).driver_earnings })) });

  const stamps = recent.map(t => Date.parse(t.settledAt) || 0);
  assert('EARN-18 recent trips are newest first',
    stamps.every((s, i) => i === 0 || stamps[i - 1] >= s), { stamps });

  // --- no client-supplied identity, on either route ---------------------------------
  const spoofed = await request('GET', `${EARNINGS_PATH}?driverId=DRV-102`, { driverId: 'DRV-102', entityId: FOREIGN_UUID }, auth);
  assert('EARN-19 a spoofed driverId in query and body is ignored, not honoured',
    spoofed.status === 200 && same(spoofed.data.monthlyEarnings, body.monthlyEarnings)
    && spoofed.data.walletBalance === body.walletBalance
    && JSON.stringify(spoofed.data.recentTrips.map(t => t.jobNumber)) === JSON.stringify(recent.map(t => t.jobNumber)),
    { status: spoofed.status, monthly: spoofed.data.monthlyEarnings, own: body.monthlyEarnings });

  const otherPath = await request('GET', '/api/driver/DRV-102/earnings', null, auth);
  assert('EARN-20 the path-scoped route still refuses another driver',
    otherPath.status === 403 && otherPath.data.code === 'DRIVER_MISMATCH',
    { status: otherPath.status, body: otherPath.data });

  const ownPath = await request('GET', '/api/driver/DRV-101/earnings', null, auth);
  assert('EARN-21 the path-scoped route and the token route are one implementation',
    ownPath.status === 200 && same(ownPath.data.monthlyEarnings, body.monthlyEarnings)
    && same(ownPath.data.todayEarnings, body.todayEarnings)
    && ownPath.data.walletBalance === body.walletBalance,
    { status: ownPath.status, pathMonthly: ownPath.data.monthlyEarnings, tokenMonthly: body.monthlyEarnings });

  assert('EARN-22 the driver-scoped transactions array is still present for existing readers',
    Array.isArray(ownPath.data.transactions) && Array.isArray(body.transactions),
    { token: Array.isArray(body.transactions), path: Array.isArray(ownPath.data.transactions) });

  const callerIds = new Set([DRIVER_UUID, 'DRV-101', 'drv_1']);
  const foreignTx = (body.transactions || []).filter(t => {
    const owner = t.driverId || t.entityId;
    if (!owner) return false;
    return !callerIds.has(String(owner)) && !String(owner).includes(DRIVER_UUID) && !String(owner).includes('DRV-101');
  });
  assert('EARN-23 no listed transaction belongs to a different driver',
    foreignTx.length === 0, { foreignTx: foreignTx.map(t => ({ id: t.id, owner: t.driverId || t.entityId })) });

  // --- payout facts, nothing invented ------------------------------------------------
  const stored = walletRes.data || {};
  const wantDestination = stored.payout_upi_verified ? (stored.verified_upi_id || null) : null;
  assert('EARN-24 the payout destination is only a verified destination',
    (body.payout || {}).destination === wantDestination
    && (body.payout || {}).destinationVerified === Boolean(stored.payout_upi_verified),
    { got: body.payout, wantDestination, verified: stored.payout_upi_verified });

  assert('EARN-25 a pending destination is never presented as the usable one',
    (body.payout || {}).pendingDestination === (stored.pending_upi_id || null)
    && (body.payout || {}).destination !== (body.payout || {}).pendingDestination,
    { payout: body.payout, pending: stored.pending_upi_id });

  assert('EARN-26 collection-by-method is reported as unknown rather than as zero',
    body.cashCollectedToday === null && body.onlinePaidToday === null,
    { cash: body.cashCollectedToday, online: body.onlinePaidToday });

  // --- outage semantics, in a child pointed at a closed port --------------------------
  const down = spawnChild('store_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
  });
  assert('EARN-27 with the store unreachable the earnings read fails closed, it does not answer zero',
    down.threw === true && down.code === 'STORE_UNAVAILABLE' && down.status === 503 && down.storeUnreachable === true,
    { threw: down.threw, code: down.code, status: down.status, storeUnreachable: down.storeUnreachable, message: down.message });

  const empty = spawnChild('store_live', { NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'true' });
  assert('EARN-28 a different driver with no completed trips reads as a real empty set, not an outage',
    empty.threw === false && Array.isArray(empty.rows) && empty.rows.length === 0 && empty.notNull === true,
    { threw: empty.threw, rows: empty.rows && empty.rows.length, notNull: empty.notNull, message: empty.message });

  assert('EARN-29 and the caller\'s own read is a real set rather than the memory fallback',
    empty.callerThrew === false && Array.isArray(empty.callerRows) && empty.callerRows.length > 0
    && empty.callerEveryRowIsMine === true,
    { callerRows: empty.callerRows && empty.callerRows.length, every: empty.callerEveryRowIsMine });

  finish();
}

function mainCrash(err) {
  console.error('Unexpected error:', err);
  failed.push('HARNESS');
  finish();
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'driver_earnings_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_EARNINGS_CHILD: scenario, ...env },
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch (e) { /* reported as a failed check below */ }
  return { threw: true, code: 'CHILD_SILENT', status: 0, message: `${res.stdout || ''} ${res.stderr || ''}`.slice(0, 300) };
}

async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');
  const sinceIso = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const out = { scenario };

  const probe = async (uuid) => {
    try {
      const rows = await db.jobRepo.getDriverCompletedRows(uuid, { sinceIso });
      return { threw: false, rows, notNull: rows !== null };
    } catch (err) {
      return {
        threw: true,
        code: err && err.code,
        status: err && (err.status || err.statusCode),
        storeUnreachable: isStoreUnreachable(err),
        message: err && err.message,
      };
    }
  };

  if (scenario === 'store_down') {
    const r = await probe(DRIVER_UUID);
    Object.assign(out, r);
  } else {
    const foreign = await probe(FOREIGN_UUID);
    Object.assign(out, foreign);
    const mine = await probe(DRIVER_UUID);
    out.callerThrew = mine.threw;
    out.callerRows = mine.rows;
    out.callerEveryRowIsMine = Array.isArray(mine.rows) && mine.rows.length > 0
      && mine.rows.every(row => String(row.driver_id) === DRIVER_UUID && row.status === 'COMPLETED');
  }
  console.log(JSON.stringify(out));
}

if (process.env.NABIN_EARNINGS_CHILD) {
  runChild(process.env.NABIN_EARNINGS_CHILD).catch((err) => {
    console.log(JSON.stringify({ threw: true, code: 'CHILD_CRASHED', status: 0, message: err.message }));
    process.exit(3);
  });
} else {
  main().catch(mainCrash);
}

function finish() {
  console.log(`\nDRIVER EARNINGS: ${passed.length} PASSED, ${failed.length} FAILED`);
  if (failed.length) console.log('Failed: ' + failed.join(' | '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
