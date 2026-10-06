/**
 * Customer unified activity feed — GET /api/customer/activity
 *
 * The customer app previously rendered a hard-coded list of trips its user had never
 * taken. This feed is the replacement, so it has to earn four properties:
 *
 *   1. It contains only the caller's own rows. Identity comes from the bearer token, and
 *      every returned id is checked back to PostgreSQL here — not to another API call.
 *   2. The money shown is the money the database holds, never a client-supplied value.
 *   3. A food or grocery purchase appears exactly once. `jobs` carries a delivery leg
 *      beside those orders, so a naive merge would list every meal twice.
 *   4. It is not silently truncated: the caller's newest ride and newest order must both
 *      appear.
 *   5. Alongside it, the customer's own record from `GET /api/auth/me` (the other read the
 *      Profile screen makes) carries no `rating` — that column is a DDL default with no
 *      ratings table behind it, so a score there would be a number nobody measured (#140).
 *
 * Ownership is verified with `.in(...)` over the ids the feed itself returned rather than
 * by re-reading the customer's table, because PostgREST caps an unbounded read at 1000
 * rows and this fixture customer has 1305 orders — a naive "read theirs, compare" probe
 * reports false leaks from its own paging.
 *
 * Requires the local backend on :4000 and the local Docker PostgreSQL.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createLogin } = require('./testSessionCache');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const FEED_PATH = '/api/customer/activity';
const PHONE = '9845011982';
const OTHER_PHONE = '9845011983';
const sharedLogin = createLogin({ baseUrl: BASE_URL, request });

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}

function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loginCustomer(phone) {
  // The OTP is a means to a customer session here, not the subject of any assertion, so it goes
  // through the local harness cache. A cached token is honoured only after `GET /api/auth/me`
  // reports it live and carrying the CUSTOMER role, so no check in this file can pass on an
  // unauthenticated request; the chain simply stops re-dispatching OTPs it does not need.
  const { token } = await sharedLogin(phone, 'CUSTOMER');
  return token;
}

async function uuidForPhone(phone) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,phone,name').like('phone', `%${phone}`).limit(1);
  if (error || !data || !data.length) return null;
  return data[0].id;
}

const TERMINAL_JOB = ['COMPLETED', 'CANCELLED'];
const TERMINAL_ORDER = ['DELIVERED', 'REJECTED', 'CANCELLED'];
let supabaseAdmin = null;

(async () => {
  console.log('--- CUSTOMER ACTIVITY FEED TESTS ---');

  ({ supabaseAdmin } = require('./src/supabase'));
  if (!supabaseAdmin) {
    console.log('SKIP: PostgreSQL is not configured; this feed is a database read.');
    return finish();
  }

  // --- auth gate ------------------------------------------------------------------
  const anon = await request('GET', FEED_PATH);
  assert('ACT-01 no token -> 401, never a leaked list',
    anon.status === 401, { status: anon.status, body: anon.data });

  const token = await loginCustomer(PHONE);
  assert('ACT-02 a real customer can sign in for the probe', !!token, { gotToken: !!token });
  if (!token) return finish();

  const callerUuid = await uuidForPhone(PHONE);
  assert('ACT-03 the probe customer resolves in PostgreSQL', !!callerUuid, { callerUuid });
  if (!callerUuid) return finish();

  const feed = await request('GET', FEED_PATH, null, { Authorization: `Bearer ${token}` });
  assert('ACT-04 authenticated read -> 200 with an items array',
    feed.status === 200 && feed.data.success === true && Array.isArray(feed.data.items),
    { status: feed.status, body: feed.data });

  const items = (feed.data && feed.data.items) || [];
  assert('ACT-05 this fixture customer really has history to show',
    items.length > 0, { count: items.length });

  const ids = items.map(i => i.id);

  // --- authority: look up exactly the ids the feed claimed -------------------------
  const jobsRes = await supabaseAdmin.from('jobs')
    .select('job_number,customer_id,service_type,final_total,status').in('job_number', ids);
  const ordersRes = await supabaseAdmin.from('orders')
    .select('order_number,customer_id,service_type,total_amount,order_state').in('order_number', ids);
  assert('ACT-06 authoritative lookups succeeded',
    !jobsRes.error && !ordersRes.error, { jobs: jobsRes.error, orders: ordersRes.error });

  const jobBy = new Map((jobsRes.data || []).map(r => [r.job_number, r]));
  const orderBy = new Map((ordersRes.data || []).map(r => [r.order_number, r]));

  const unmatched = ids.filter(id => !jobBy.has(id) && !orderBy.has(id));
  assert('ACT-07 every returned item exists in PostgreSQL (nothing fabricated)',
    unmatched.length === 0, { unmatched });

  const foreign = [
    ...[...jobBy.values()].filter(r => r.customer_id !== callerUuid),
    ...[...orderBy.values()].filter(r => r.customer_id !== callerUuid),
  ];
  assert('ACT-08 no item belongs to another customer (IDOR)',
    foreign.length === 0,
    { leaked: foreign.map(r => ({ id: r.job_number || r.order_number, owner: r.customer_id })) });

  const dual = ids.filter(id => jobBy.has(id) && orderBy.has(id));
  assert('ACT-09 no id is claimed as both a job and an order',
    dual.length === 0, { dual });

  assert('ACT-10 ids are unique — a purchase is not listed twice',
    new Set(ids).size === ids.length,
    { duplicates: ids.filter((id, ix) => ids.indexOf(id) !== ix) });

  // --- service projection --------------------------------------------------------
  const SERVICES = ['RIDE', 'FOOD', 'INSTAMART', 'PARCEL'];
  assert('ACT-11 every item carries one of the four service labels',
    items.every(i => SERVICES.includes(i.service)),
    { odd: items.filter(i => !SERVICES.includes(i.service)).map(i => ({ id: i.id, service: i.service })) });

  const expectedLabel = (r) => {
    if (r.order_number !== undefined) return r.service_type === 'GROCERY' ? 'INSTAMART' : 'FOOD';
    return r.service_type === 'PARCEL' ? 'PARCEL' : 'RIDE';
  };
  const mislabelled = items.filter(i => {
    const row = orderBy.get(i.id) || jobBy.get(i.id);
    return row && expectedLabel(row) !== i.service;
  });
  assert('ACT-12 the label matches the stored service_type (Food and Instamart are distinct)',
    mislabelled.length === 0,
    { mislabelled: mislabelled.map(i => ({ id: i.id, shown: i.service, stored: (orderBy.get(i.id) || jobBy.get(i.id)).service_type })) });

  // A food/grocery order owns a delivery job; that leg must never appear as its own row.
  const orderBackedJobs = await supabaseAdmin.from('jobs')
    .select('job_number,service_type').eq('customer_id', callerUuid)
    .in('service_type', ['FOOD', 'GROCERY']).limit(400);
  const legNumbers = new Set((orderBackedJobs.data || []).map(r => r.job_number));
  const legsShown = ids.filter(id => legNumbers.has(id));
  assert('ACT-13 a food/grocery delivery leg is never shown as its own item',
    legsShown.length === 0,
    { legsShown, sampledLegs: legNumbers.size });

  // --- money authority -----------------------------------------------------------
  const badAmount = items.filter(i => {
    const row = orderBy.get(i.id) || jobBy.get(i.id);
    if (!row) return false;
    const stored = Number(row.order_number !== undefined ? row.total_amount : row.final_total);
    return !(Math.abs(Number(i.amount) - stored) < 0.005);
  });
  assert('ACT-14 every amount equals the stored value to the paisa',
    badAmount.length === 0,
    { bad: badAmount.map(i => { const r = orderBy.get(i.id) || jobBy.get(i.id); return { id: i.id, shown: i.amount, stored: r.order_number !== undefined ? r.total_amount : r.final_total }; }) });

  // --- lifecycle flag ------------------------------------------------------------
  const wrongActive = items.filter(i => {
    const row = orderBy.get(i.id) || jobBy.get(i.id);
    if (!row) return false;
    const st = row.order_number !== undefined ? row.order_state : row.status;
    const shouldActive = !(TERMINAL_JOB.includes(st) || TERMINAL_ORDER.includes(st));
    return i.active !== shouldActive;
  });
  assert('ACT-15 `active` is false exactly for terminal states',
    wrongActive.length === 0,
    { wrong: wrongActive.map(i => ({ id: i.id, active: i.active })) });

  const activeCount = items.filter(i => i.active).length;
  console.log(`NOTE: ${activeCount} of ${items.length} items are in-flight for this customer.`);

  // --- completeness: the newest rows must be present ------------------------------
  const newestJob = await supabaseAdmin.from('jobs')
    .select('job_number,service_type').eq('customer_id', callerUuid)
    .in('service_type', ['RIDE', 'PARCEL']).order('created_at', { ascending: false }).limit(1);
  const newestOrder = await supabaseAdmin.from('orders')
    .select('order_number').eq('customer_id', callerUuid)
    .order('created_at', { ascending: false }).limit(1);
  const nj = newestJob.data && newestJob.data[0] && newestJob.data[0].job_number;
  const no = newestOrder.data && newestOrder.data[0] && newestOrder.data[0].order_number;
  assert('ACT-16 the newest ride/parcel is present (feed is not silently stale)',
    !nj || ids.includes(nj), { expected: nj, count: ids.length });
  assert('ACT-17 the newest food/instamart order is present',
    !no || ids.includes(no), { expected: no, count: ids.length });

  // --- ordering ------------------------------------------------------------------
  const times = items.map(i => new Date(i.placedAt).getTime());
  assert('ACT-18 sorted newest first across the merged feed',
    times.every((t, ix) => ix === 0 || times[ix - 1] >= t), { head: times.slice(0, 4) });

  const servicesSeen = new Set(items.map(i => i.service));
  console.log(`NOTE: services represented in this customer's history: ${[...servicesSeen].join(', ')}`);

  // --- a second account sees only its own ----------------------------------------
  const otherUuid = await uuidForPhone(OTHER_PHONE);
  const otherToken = otherUuid ? await loginCustomer(OTHER_PHONE) : null;
  if (otherToken) {
    const feed2 = await request('GET', FEED_PATH, null, { Authorization: `Bearer ${otherToken}` });
    const ids2 = ((feed2.data && feed2.data.items) || []).map(i => i.id);
    const overlap = ids2.filter(id => ids.includes(id));
    assert('ACT-19 a second customer\'s feed shares no row with the first',
      overlap.length === 0, { overlap });
    const theirs = await supabaseAdmin.from('orders').select('order_number,customer_id').in('order_number', ids2);
    const wrongOwner = (theirs.data || []).filter(r => r.customer_id === callerUuid);
    assert('ACT-20 the second feed contains none of the first customer\'s orders',
      wrongOwner.length === 0, { wrongOwner: wrongOwner.map(r => r.order_number) });
  } else {
    assert('ACT-19 second fixture customer unavailable — cross-tenant check not exercised', false,
      { otherUuid: !!otherUuid, otherToken: !!otherToken });
    assert('ACT-20 second fixture customer unavailable — cross-tenant check not exercised', false);
  }

  // --- the customer's own record: ACT-21…23 (#140) ---------------------------------------
  //
  // The Profile screen reads this same route, and it used to render "⭐ 5.00 User Rating".
  // That number is `users.rating NUMERIC(3,2) DEFAULT 5.00` (001_central_schema.sql:22): no
  // reviews or ratings table exists in this schema, so every account's score is the column
  // default. The hydrator made it worse than the DDL — `parseFloat(row.rating || 5.0)`
  // (database.js:1704) turns a NULL into 5.0 before any route sees the row. Same ruling
  // migration 034 made for `merchants.rating` and #138 made for `drivers.rating`.
  //
  // Unlike the driver rating, this one is provable from the live response alone: a field that
  // is absent cannot be mistaken for a measurement. The source guard after it is not proof,
  // it is protection — it stops a third self-read being added that hands out `session.entity`
  // whole again.
  const me = await request('GET', '/api/auth/me', null, { Authorization: `Bearer ${token}` });
  const meUser = me.data && me.data.user;
  assert('ACT-21 the customer\'s own record carries no rating field',
    me.status === 200 && meUser && typeof meUser === 'object' && !('rating' in meUser),
    { status: me.status, keys: meUser ? Object.keys(meUser).join(',') : null });
  // Absence must not cost the customer anything they actually own.
  assert('ACT-22 the same record still carries the identity the profile renders',
    !!meUser && !!meUser.id && !!meUser.name && !!meUser.phone,
    meUser ? { id: meUser.id, name: meUser.name, phone: meUser.phone } : { meUser: null });

  const refreshed = await request('POST', '/api/auth/refresh-token', { token });
  const echoEntity = refreshed.data && refreshed.data.session && refreshed.data.session.entity;
  assert('ACT-23 the refresh echo of that same record carries no rating either',
    refreshed.status === 200 && (echoEntity === undefined || echoEntity === null || !('rating' in echoEntity)),
    { status: refreshed.status, keys: echoEntity ? Object.keys(echoEntity).join(',') : 'no entity echoed' });

  // Source guard, FD-10d / CT-07 precedent. Comments are stripped first: the ruling is written
  // down as prose that quotes the very shapes being retired.
  const serverSrc = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  const codeOnly = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const code = codeOnly(serverSrc);
  const handlerAfter = (marker) => {
    const at = code.indexOf(marker);
    return at === -1 ? null : code.slice(at, code.indexOf('\napp.', at + marker.length));
  };
  const meHandler = handlerAfter("app.get('/api/auth/me'");
  const refreshHandler = handlerAfter("app.post('/api/auth/refresh-token'");
  assert('SELF-01 both self-reads are located in the shipped source',
    !!meHandler && !!refreshHandler,
    { me: !!meHandler, refresh: !!refreshHandler });
  assert('SELF-02 both of them project the own-record instead of echoing it whole',
    !!meHandler && !!refreshHandler
      && /projectUserForSelf\(/.test(meHandler) && /projectUserForSelf\(/.test(refreshHandler),
    { me: meHandler ? 'found' : 'missing', refresh: refreshHandler ? 'found' : 'missing' });

  finish();
})().catch((err) => {
  console.error('Unexpected error:', err);
  failed.push('HARNESS');
  finish();
});

function finish() {
  console.log(`\nACTIVITY FEED: ${passed.length} PASSED, ${failed.length} FAILED`);
  if (failed.length) console.log('Failed: ' + failed.join(' | '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
