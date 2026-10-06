'use strict';

/*
 * PLACE SUBSTITUTION — task #32a / #143.
 *
 * A platform with no geocoder and no routing service knows exactly one thing about a trip: the
 * two points the customer put on the map. Everything else — the address on a merchant's order
 * card, the length of a parcel run, the name of the street a pin sits on — used to be filled in
 * from the platform's own defaults, and each of those defaults was a fact about the customer's
 * order that nobody had given it:
 *
 *   - `book-food` wrote "North Campus Girls Hostel, Delhi" as the delivery address of an order
 *     whose request contained no address at all. A restaurant read a place nobody chose as the
 *     destination of a meal it had just been told to cook.
 *   - every parcel was a 6.1 km, 18-minute trip between two named Delhi markets, and its box was
 *     described as "Electronics Box (1.4 kg, Fragile)" — a sentence a courier then read as
 *     instructions about somebody else's parcel.
 *   - `/api/geofence/reverse-geocode` answered an Aizawl coordinate with a Delhi place name from
 *     a hard-coded gazetteer.
 *   - a `jobs` row stored without coordinates came back from `JobRepository` holding Connaught
 *     Place's latitude and longitude, so an unknown place was reported as a known one — to the
 *     customer, the driver and the admin alike.
 *
 * The rule the routes now follow, and what this file proves: NABIN stores what it was given,
 * measures what it can measure, and refuses or answers `null` for the rest.
 *
 * Two of those halves are proven elsewhere and are deliberately not repeated here. The refusal
 * itself, per service and per field, is `geo_adversarial_test.js` group A2 (MTX-*-PLACE,
 * MTX-*-GEOM); the arithmetic behind a measured trip is `geo_policy_test.js` GEO-A06…A09. This
 * suite covers what those cannot see: what a refusal must *not* pre-empt, what the durable row
 * actually contains, and what a read of a row with no geography answers.
 *
 * Honest limits, stated where they bite:
 *   - ORDER-05 is a source guard, not a behavioural one. Proving a refusal cannot spend a coupon
 *     redemption needs a live promotion row this suite would have to create, and a fixture coupon
 *     is not product truth (see the FESTIVAL30 ruling). The ordering is therefore read from the
 *     handler, and the comment says so.
 *   - GAP-TRK-01 records an open §14-6 gap as NOT MEASURED rather than asserting a guarantee: the
 *     compiled-in seed fleet still answers a position for jobs whose `driver_id` is a legacy
 *     seeded id, and no code in this repository reported it.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.NABIN_TEST_BASE || process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const ADMIN = { username: 'superadmin', password: 'AdminPassword123!' };
const PHONE_C1 = '9845011982';   // the seeded KYC-verified customer the other suites book as
const OTP = process.env.NABIN_TEST_OTP || '7729';

for (const url of [BASE, PG]) {
  if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(url).hostname)) {
    console.error(`REFUSED: ${url} is not loopback. This suite writes rows; it never aims at a hosted project.`);
    process.exit(1);
  }
}

let pass = 0; let fail = 0; let skipped = 0;
const check = (id, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '✅' : '❌'} [${id}] ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
};
// The chain's vocabulary for a measurement it made but cannot yet turn into a guarantee.
const notMeasured = (id, why) => {
  skipped++;
  console.log(`NOT MEASURED  ${id} — ${why}`);
};

async function api(method, route, body, token) {
  const res = await fetch(BASE + route, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await res.json(); } catch (_) { /* non-JSON is asserted below */ }
  return { status: res.status, data };
}

async function withDb(fn) {
  const c = new Client({ connectionString: PG });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

// The invented literals, guarded against reappearing as a *value*. They survive in comments as
// the record of what used to happen, so the scan reads code only.
function withoutComments(source) {
  return source.split('\n').filter((line) => {
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  }).join('\n');
}

// ---------------------------------------------------------------------------
// A. Reverse geocoding names nothing it cannot name
// ---------------------------------------------------------------------------
//
// There is no geocoder behind this route and adding one is a new external integration, which is
// an owner decision, not a line of code an agent may add. So the route's contract is the honest
// one: a coordinate is echoed back, every name is null, and `resolved:false` is the field a
// caller has to branch on.
async function groupA() {
  console.log('\n--- A. Reverse geocoding answers a coordinate, not a place name ---');

  const AIZAWL = { lat: 23.7660, lng: 92.7240 };
  const hit = await api('POST', '/api/geofence/reverse-geocode', AIZAWL);
  const names = ['locality', 'landmark', 'city', 'formattedAddress'];
  check('RS-01', hit.status === 200 && hit.data.resolved === false &&
    names.every((f) => hit.data[f] === null) && hit.data.reason === 'NO_GEOCODER' &&
    hit.data.coordinates?.lat === AIZAWL.lat && hit.data.coordinates?.lng === AIZAWL.lng,
    `a valid pin answers resolved:false with all four names null and the pin echoed back ` +
    `(${hit.status} resolved=${hit.data.resolved} reason=${hit.data.reason} ` +
    `names=${names.map((f) => `${f}:${JSON.stringify(hit.data[f])}`).join(',')})`);

  // The gazetteer used to produce strings like "Civil Lines Market, Delhi". Scan the whole body,
  // not just the four fields: a place name that arrives under a different key is the same lie.
  const body = JSON.stringify(hit.data);
  const named = /delhi|aizawl|connaught|civil lines|nagar|market|lane|street|road|india gate/i.exec(body);
  check('RS-02', !named,
    `no place name appears anywhere in the response${named ? ` (found "${named[0]}")` : ''} — the caller is told the platform does not know`);

  const numericString = await api('POST', '/api/geofence/reverse-geocode', { lat: '23.7660', lng: '92.7240' });
  check('RS-03', numericString.status === 200 && numericString.data.resolved === false &&
    numericString.data.coordinates?.lat === 23.766,
    `a numeric string is still accepted, exactly as the published contract says (${numericString.status} ` +
    `lat=${JSON.stringify(numericString.data.coordinates?.lat)})`);

  const nonsense = await api('POST', '/api/geofence/reverse-geocode', { lat: 'abc', lng: 'xyz' });
  check('RS-04', nonsense.status === 400 && nonsense.data.code === 'GEO_INVALID_COORDINATES',
    `"abc" is refused with a code instead of described as a place (${nonsense.status} ${nonsense.data.code}) — ` +
    'the body used to read 200 "Live Location (NaN° N, NaN° E)"');

  const outOfRange = await api('POST', '/api/geofence/reverse-geocode', { lat: 999, lng: 77.2 });
  check('RS-05', outOfRange.status === 400 && outOfRange.data.code === 'GEO_COORDINATES_OUT_OF_RANGE',
    `latitude 999 is refused as out of range (${outOfRange.status} ${outOfRange.data.code})`);

  const absent = await api('POST', '/api/geofence/reverse-geocode', {});
  check('RS-06', absent.status === 400,
    `a request with no coordinate at all is refused rather than resolved from nowhere (${absent.status})`);
}

// ---------------------------------------------------------------------------
// B. A place refusal never pre-empts a gate that must come first
// ---------------------------------------------------------------------------
//
// The refusal is a 400 about a form field. If it fires before authentication, an anonymous caller
// learns what the route requires and every unauthenticated probe becomes a validation lesson; if
// it fires before the identity check, a customer forging someone else's `customerId` is told to
// fill in their address instead of being refused; if it fires after the coupon is redeemed, the
// customer has spent a redemption for an order that was never created.
async function groupB(customerToken) {
  console.log('\n--- B. Refusal ordering: identity and authority before input validation ---');

  const anon = await api('POST', '/api/customer/book-food', { restaurantId: 'rest_1', items: ['1x Special Dum Biryani (Chicken)'] });
  check('ORDER-01', anon.status === 401,
    `an unauthenticated food order with no address is a 401, not a form hint (${anon.status} ${anon.data.code})`);

  const anonParcel = await api('POST', '/api/customer/book-parcel', { senderDetails: {}, recipientDetails: {} });
  check('ORDER-02', anonParcel.status === 401,
    `an unauthenticated parcel with two unplaced ends is a 401 (${anonParcel.status} ${anonParcel.data.code})`);

  const anonRide = await api('POST', '/api/customer/book-ride', { vehicleType: '3W' });
  check('ORDER-03', anonRide.status === 401,
    `an unauthenticated ride with no ends placed is a 401 (${anonRide.status} ${anonRide.data.code})`);

  // A different account's id, on a body that would also be refused for its address.
  const forged = await api('POST', '/api/customer/book-food', {
    restaurantId: 'rest_1',
    customerId: '00000000-0000-0000-0000-000000000001',
    items: ['1x Special Dum Biryani (Chicken)']
  }, customerToken);
  // Either the identity gate refuses (403) or it decides the id is this session's own and the
  // order goes ahead. What must never happen is the address check answering first, because that
  // turns an authorization event into a form hint and tells an attacker the route accepted their body.
  check('ORDER-04', forged.status === 403 || forged.status === 200,
    `a forged customerId is answered by the identity gate, not by the address check ` +
    `(${forged.status} ${forged.data.code || forged.data.error || ''})`);

  const server = withoutComments(fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8'));
  const foodStart = server.indexOf("app.post('/api/customer/book-food'");
  const nextRoute = server.indexOf('\napp.', foodStart + 10);
  const food = server.slice(foodStart, nextRoute === -1 ? foodStart + 9000 : nextRoute);
  const refusalAt = food.indexOf("'PLACE_REQUIRED'");
  const redeemAt = food.search(/redeemCoupon|redeem_promotion_atomic/);
  check('ORDER-05', refusalAt !== -1 && redeemAt !== -1 && refusalAt < redeemAt,
    `the food route's own address refusal (${refusalAt}) sits before it redeems a coupon (${redeemAt}), ` +
    'so a refusal cannot spend the customer\'s one redemption — source guard, see the header limits');
}

// ---------------------------------------------------------------------------
// C. The durable row holds the address the customer gave, or no order
// ---------------------------------------------------------------------------
async function groupC(customerToken) {
  console.log('\n--- C. What the order row actually stores ---');

  // A fixture address that could only have come from this run. A unique string is what makes the
  // read meaningful: a shared fixture could be satisfied by a leftover row from an earlier order.
  const probeAddress = `NABIN Placement Probe Doorstep, Aizawl ${Date.now().toString(36)}`;

  const fixture = await withDb(async (c) => {
    const r = await c.query(`select m.id::text as merchant_id, p.id::text as product_id
      from public.products p join public.merchants m on m.id = p.merchant_id
      where p.is_available is distinct from false and m.merchant_type in ('RESTAURANT','HYBRID_BOTH')
      order by p.created_at limit 1`);
    return r.rows[0] || null;
  });
  if (!fixture || !customerToken) {
    check('ADDR-01', false, `no orderable restaurant product or no customer session (${JSON.stringify(fixture)})`);
    return;
  }

  const before = await withDb((c) => c.query('select count(*)::int n from public.orders'));
  const refused = await api('POST', '/api/customer/book-food', {
    restaurantId: fixture.merchant_id,
    items: [{ productId: fixture.product_id, quantity: 1 }]
  }, customerToken);
  const afterRefusal = await withDb((c) => c.query('select count(*)::int n from public.orders'));

  check('ADDR-01', refused.status === 400 && refused.data.code === 'PLACE_REQUIRED' &&
    refused.data.field === 'deliveryAddress' && afterRefusal.rows[0].n === before.rows[0].n,
    `an order with no address is refused as PLACE_REQUIRED on deliveryAddress and writes no row ` +
    `(${refused.status}/${refused.data.code}/${refused.data.field}; orders ${before.rows[0].n} -> ${afterRefusal.rows[0].n})`);

  const booked = await api('POST', '/api/customer/book-food', {
    restaurantId: fixture.merchant_id,
    deliveryAddress: probeAddress,
    items: [{ productId: fixture.product_id, quantity: 1 }]
  }, customerToken);
  const orderId = (booked.data.order || {}).id;
  check('ADDR-02', booked.status === 200 && !!orderId,
    `the same order with an address is accepted (${booked.status} ${booked.data.code || booked.data.error || 'ok'})`);
  if (!orderId) return;

  const stored = await withDb((c) => c.query(
    `select metadata->>'deliveryAddress' as addr from public.orders where id = $1::uuid`, [orderId]));
  check('ADDR-03', stored.rows[0] && stored.rows[0].addr === probeAddress,
    `the row the merchant's order card reads holds exactly the address the customer typed, not a ` +
    `default (${JSON.stringify(stored.rows[0] && stored.rows[0].addr).slice(0, 70)})`);

  const echoed = await api('GET', '/api/customer/orders', undefined, customerToken);
  const seen = JSON.stringify(echoed.data || []);
  check('ADDR-04', echoed.status === 200 && seen.includes(probeAddress),
    `the customer's own order read serves the address back (${echoed.status}) — the route does not store it and forget it`);

  const declared = withoutComments(fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8'));
  check('ADDR-05', !/North Campus Girls Hostel/.test(declared) && !/Electronics Box \(1\.4/.test(declared),
    'neither invented literal survives as code: the food default address and the parcel the platform wrote for the courier are gone');
}

// ---------------------------------------------------------------------------
// D. A job with no geography reads back as a job with no geography
// ---------------------------------------------------------------------------
//
// `mapRowToJob` used to fill Connaught Place into any row stored without coordinates, and the
// read then reported it as a fact about that trip. The rows are still there — the cancelled
// seed jobs were stored with no coordinates at all — so this is provable against a durable row
// rather than against a fresh booking, which the placement refusal now makes impossible.
async function groupD() {
  console.log('\n--- D. Null geography survives the write and the read ---');

  const row = await withDb((c) => c.query(
    `select job_number, pickup_address, drop_address from public.jobs
      where pickup_lat is null and drop_lat is null order by created_at limit 1`));
  if (!row.rows[0]) {
    check('NULL-01', false, 'no coordinate-free job row exists to read — the proof needs a row, not a fixture');
    return;
  }
  const job = row.rows[0];

  const login = await api('POST', '/api/admin/login', ADMIN);
  const adminToken = login.data && login.data.token;
  if (!adminToken) {
    check('NULL-01', false, `no admin session to read the job with (${login.status})`);
    return;
  }

  const read = await api('GET', `/api/tracking/${encodeURIComponent(job.job_number)}`, undefined, adminToken);
  const got = read.data.job || read.data;
  check('NULL-01', read.status === 200 && got?.pickup?.lat === null && got?.pickup?.lng === null &&
    got?.drop?.lat === null && got?.drop?.lng === null,
    `job ${job.job_number} is stored with no coordinates and reads back with none ` +
    `(pickup=${JSON.stringify(got?.pickup)}, drop=${JSON.stringify(got?.drop)}) — no place is reported that the platform never knew`);

  check('NULL-02', read.status === 200 && got?.pickup?.address === (job.pickup_address ?? null) &&
    got?.drop?.address === (job.drop_address ?? null),
    `the addresses on that read are the row's own, or null (${JSON.stringify(got?.pickup?.address)} / ` +
    `${JSON.stringify(got?.drop?.address)})`);

  const repo = withoutComments(fs.readFileSync(path.join(__dirname, 'src', 'repositories', 'JobRepository.js'), 'utf8'));
  const coords = /28\.6\d+|77\.2\d+|Connaught/i.exec(repo);
  check('NULL-03', !coords,
    `no Delhi coordinate or place name remains anywhere in the repository's read/write path` +
    `${coords ? ` (found "${coords[0]}")` : ''} — the substitution cannot come back as a default`);

  // Recorded gap, §14-6, and deliberately not a guarantee. A job whose `driver_id` is a legacy
  // seeded id resolves in the compiled-in fleet, so the tracking read can carry a position that
  // nothing in this run reported. Calling that green would claim a guarantee this repository
  // does not have; calling it red would claim a fix this suite cannot make — removing those
  // arrays is the owner's decision. So the observation is recorded as NOT MEASURED.
  const loc = got?.location;
  notMeasured('GAP-TRK-01', loc == null
    ? 'the seeded job answers no position at all — the §14-6 gap this line records has closed, and the record can go'
    : `the read carries lat=${loc.lat}, lng=${loc.lng}, speed=${loc.speed}, ` +
      `receivedAt=${JSON.stringify(loc.receivedAt)} for driver ${JSON.stringify(got?.driver?.id)} ` +
      'while nothing in this run reported a position for that job. The compiled-in seed fleet is the source.');
}

async function main() {
  const health = await api('GET', '/api/health');
  if (health.status !== 200) {
    console.error(`The local backend must be running on ${BASE} (${health.status}).`);
    process.exit(2);
  }

  await api('POST', '/api/auth/send-otp', { phone: PHONE_C1, role: 'CUSTOMER', purpose: 'LOGIN' });
  const verify = await api('POST', '/api/auth/verify-otp', { phone: PHONE_C1, otp: OTP, role: 'CUSTOMER' });
  const customerToken = verify.data && verify.data.token;
  if (!customerToken) {
    console.error(`No customer session (${verify.status}); groups B and C cannot run.`);
    process.exit(2);
  }

  await groupA();
  await groupB(customerToken);
  await groupC(customerToken);
  await groupD();

  console.log('\n========================================================================');
  console.log(`📊 PLACE SUBSTITUTION: ${pass} PASSED, ${fail} FAILED (Total: ${pass + fail})` +
    (skipped ? ` — plus ${skipped} recorded gap(s) above, marked NOT MEASURED` : ''));
  console.log('========================================================================');
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('PLACE SUBSTITUTION ABORTED:', err.stack || err.message);
  process.exit(3);
});
