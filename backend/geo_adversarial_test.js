// =========================================================================
// GEO ADVERSARIAL MATRIX (local only)
//
// geo_policy_test.js asks whether the engine is right. This file asks the
// question an auditor asks next: can a booking, a price, or an authorization
// come out of the wrong end of a geographic failure? Everything here is driven
// over real HTTP against the running backend, because the guarantee that matters
// belongs to the API and not to a function.
//
//   A. Phase 12 — the booking matrix, RIDE / FOOD / PARCEL
//   B. Phase 13 — pricing invariants
//   C. Phase 14 — failure injection
//   D. Phase 15 — security cases (IDOR, tampering, enumeration, RLS, replay)
//   E. Phase 16 — cache freshness: a boundary that lands is a boundary that prices
//   F. Phases 6, 7, 12(K,L,O,P) — the cases a live store cannot show honestly:
//      expired and future rules, genuine overlaps, and a boundary at one metre
//
// Two matrix rows are deliberately not exercised here. "Database unavailable"
// needs a process that really cannot read the store, which group E of
// geo_policy_test.js owns — including the booking route — and this file does not
// start a second one. FOOD and PARCEL coordinate cases are sampled rather than
// run in full: those routes read no coordinate at all, so proving that six
// different coordinates produce one identical fare is the finding, and every
// successful food order is an immutable row.
//
// Where current behaviour is a business decision that is still open (§14 of
// docs/GEOFENCING_SECURITY_AUDIT.md), the check asserts what the code does today
// and says which decision it is waiting on. That is so a later change is a
// deliberate edit rather than a surprise.
// =========================================================================

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const geoPolicy = require('./src/services/GeoPolicyService');
const { REASON } = geoPolicy;

const BASE = process.env.GEO_TEST_BASE || 'http://127.0.0.1:4000';
const PGRST = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function request(method, base, route, body, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(route, base);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers,
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      },
      timeout: 15000
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* asserted below */ }
        resolve({ status: res.statusCode, data, text });
      });
    });
    req.on('error', err => resolve({ status: 0, data: null, text: String(err.message) }));
    req.on('timeout', () => { req.destroy(new Error('timed out')); });
    if (payload) req.write(payload);
    req.end();
  });
}

// PostgREST asked directly, which is the only way to see what RLS alone would
// allow. Keys are read from the environment and never printed.
function restSelect(route, headers = {}) {
  return request('GET', PGRST, route, null, { apikey: headers.apikey || '', ...headers });
}

const INSIDE = { lat: 28.6328, lng: 77.2197 };
const OUTSIDE = { lat: 27.50, lng: 88.50 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };

let suffix = 0;
const unique = () => `geo_adv_${Date.now().toString(36)}_${(suffix++).toString(36)}`;

// One geographic verdict, read the same way for every case: the engine's answer
// and whether a booking came out the other side of it.
function engineVerdict(res) {
  const estimate = res.data?.estimate;
  if (estimate) {
    return {
      refused: false,
      http: res.status,
      status: estimate.geoValidation?.status || null,
      multiplier: estimate.surgeMultiplier,
      charge: estimate.customerCharge,
      zoneName: estimate.activeZoneName ?? null,
      matched: Boolean(estimate.matchedGeofence)
    };
  }
  return { refused: true, http: res.status, code: res.data?.code || null };
}

// The admin route answers a create with the record under `geoFence`.
const fenceIdOf = res => res.data?.geoFence?.id || res.data?.geofence?.id || res.data?.id || null;

const BOOKINGS = {
  RIDE: (coords, extra) => ({
    route: '/api/customer/book-ride',
    body: {
      vehicleType: '3W',
      pickup: { address: 'NABIN Adversarial Probe Pickup', ...coords },
      drop: { address: 'NABIN Adversarial Probe Drop', lat: 28.6853, lng: 77.2185 },
      ...extra
    }
  }),
  PARCEL: (coords, extra) => ({
    route: '/api/customer/book-parcel',
    body: {
      senderDetails: { address: 'NABIN Adversarial Probe Sender', ...coords },
      recipientDetails: { address: 'NABIN Adversarial Probe Recipient' },
      ...extra
    }
  }),
  FOOD: (coords, extra) => ({
    route: '/api/customer/book-food',
    body: {
      restaurantId: 'rest_1',
      items: ['1x Special Dum Biryani (Chicken)'],
      deliveryAddress: { address: 'NABIN Adversarial Probe Doorstep', ...coords },
      ...extra
    }
  })
};

const SERVICE_TYPE = { RIDE: '3W', PARCEL: 'PARCEL', FOOD: 'FOOD' };

// The trip each booking route prices is hard-coded in that route: a ride is 3.8 km
// over 11 minutes whatever the pickup and drop say. A quote compared against a
// booking therefore has to ask with the same numbers, or the difference is the
// distance and not the geography — which is exactly the mistake this file is here
// to make impossible. That the distance is fixed is itself a finding, recorded in
// the audit's report rather than silently corrected here.
const ROUTE_INPUT = {
  RIDE: { distanceKm: 3.8, durationMins: 11 },
  PARCEL: { distanceKm: 6.1, durationMins: 18 },
  FOOD: { distanceKm: 4, durationMins: 12 }
};

async function quote(service, coords, extra = {}) {
  return request('POST', BASE, '/api/pricing/estimate', {
    serviceType: SERVICE_TYPE[service],
    ...ROUTE_INPUT[service],
    ...(coords || {}),
    ...(extra.zoneId !== undefined ? { zoneId: extra.zoneId } : {})
  });
}

async function book(service, coords, extra = {}, token, idempotencyKey = unique()) {
  const spec = BOOKINGS[service](coords, extra);
  const res = await request('POST', BASE, spec.route, spec.body, {
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey
  });
  const created = Boolean(res.data?.success && (res.data.job?.id || res.data.order?.id));
  return {
    http: res.status,
    code: res.data?.code || null,
    created,
    fare: res.data?.job?.fare ?? res.data?.job?.customerCharge ??
      Number(res.data?.order?.totalAmount ?? res.data?.job?.totalAmount ?? NaN),
    id: res.data?.job?.id || res.data?.order?.id || null,
    duplicate: Boolean(res.data?.duplicate)
  };
}

// ---------------------------------------------------------------------------
// A. Phase 12 — booking matrix
// ---------------------------------------------------------------------------
const MATRIX = [
  { id: 'A', label: 'valid inside', coords: INSIDE, full: true },
  { id: 'B', label: 'valid outside', coords: OUTSIDE, full: true },
  { id: 'C', label: 'Mumbai', coords: MUMBAI, full: true },
  { id: 'D', label: 'New York', coords: NEW_YORK, full: true },
  { id: 'E', label: 'lat=999', coords: { lat: 999, lng: INSIDE.lng }, full: true },
  { id: 'F', label: 'lat="abc"', coords: { lat: 'abc', lng: INSIDE.lng }, full: true },
  { id: 'G', label: 'missing coordinates', coords: null, full: true },
  { id: 'H', label: 'null coordinates', coords: { lat: null, lng: null }, full: true },
  { id: 'I', label: 'forged zoneId', coords: OUTSIDE, extra: { zoneId: 'ZONE_NOT_MINE' }, full: true },
  { id: 'J', label: 'zoneId of a real zone', coords: OUTSIDE, realZone: true, full: true }
];

async function groupA(token, realZoneId) {
  console.log('\n--- A. Phase 12 booking matrix: RIDE in full, FOOD and PARCEL sampled ---');

  const rows = [];
  const probe = async (service, testCase) => {
    const extra = { ...(testCase.extra || {}) };
    if (testCase.realZone) extra.zoneId = realZoneId;
    // The quote and the booking are asked the same question in the two shapes
    // each surface uses: `pickupLat`/`pickupLng` for a price, a nested location
    // object for a booking.
    const quoteCoords = testCase.coords ? { pickupLat: testCase.coords.lat, pickupLng: testCase.coords.lng } : {};
    const bookingCoords = testCase.coords ? { lat: testCase.coords.lat, lng: testCase.coords.lng } : {};

    const est = await quote(service, quoteCoords, extra);
    const bk = await book(service, bookingCoords, extra, token);
    return { est: engineVerdict(est), bk };
  };

  for (const testCase of MATRIX) {
    const ride = await probe('RIDE', testCase);
    rows.push({ service: 'RIDE', case: testCase.id, label: testCase.label, ...ride });
    const geoMovedPrice = ride.est.refused
      ? 'refused'
      : (ride.bk.fare === ride.est.charge ? 'server quote' : 'server quote (fare differs)');
    console.log(`| RIDE | ${testCase.id} ${testCase.label} | ${ride.est.refused ? ride.est.code : ride.est.status}` +
      ` | ${ride.bk.http} ${ride.bk.created ? 'booked' : 'not booked'} ₹${ride.bk.fare} | ${geoMovedPrice} |`);
  }

  // FOOD and PARCEL: sampled, and the sample is the point. If every coordinate
  // — including nonsense — produces one identical fare, the route is not looking
  // at geography at all.
  for (const service of ['PARCEL', 'FOOD']) {
    const sampled = MATRIX.filter(t => ['A', 'B', 'C', 'E', 'F', 'G'].includes(t.id));
    const fares = new Set();
    for (const testCase of sampled) {
      const coords = testCase.coords ? { pickupLat: testCase.coords.lat, pickupLng: testCase.coords.lng } : {};
      const est = engineVerdict(await quote(service, coords));
      const bk = await book(service, testCase.coords ? { lat: testCase.coords.lat, lng: testCase.coords.lng } : {}, {}, token);
      rows.push({ service, case: testCase.id, label: testCase.label, est, bk });
      if (bk.created) fares.add(bk.fare);
      console.log(`| ${service} | ${testCase.id} ${testCase.label} | ${est.refused ? est.code : est.status}` +
        ` | ${bk.http} ${bk.created ? 'booked' : 'not booked'} ₹${bk.fare} | — |`);
    }
    check(`MTX-${service}-NO-GEO`,
      fares.size === 1 && [...fares][0] > 0,
      `${service}: ${sampled.length} different coordinates (nonsense included) produced ` +
      `${fares.size} distinct fare(s) — the route reads no coordinate at all; service-area policy for ` +
      `${service} is §14 decision 1 and is NOT IMPLEMENTED`);
  }

  // RIDE: the safety half, case by case.
  const rideRows = rows.filter(r => r.service === 'RIDE');
  const refusedCases = rideRows.filter(r => r.est.refused);
  check('MTX-R01', refusedCases.every(r => !r.bk.created && r.bk.http === r.est.http),
    `every refused coordinate is refused by the booking route too (${refusedCases.map(r => `${r.case}:${r.bk.http}/${r.bk.code}`).join(' ')})`);

  check('MTX-R02', refusedCases.every(r => [REASON.INVALID_COORDINATES, REASON.OUT_OF_RANGE, REASON.STORE_UNAVAILABLE].includes(r.est.code)),
    `refusals carry a safe reason code, not a stack trace (${[...new Set(refusedCases.map(r => r.est.code))].join(', ')})`);

  const outsideCases = rideRows.filter(r => ['B', 'C', 'D'].includes(r.case));
  check('MTX-R03', outsideCases.every(r => !r.est.refused && r.est.status === 'VALIDATED_OUTSIDE' &&
    r.est.matched === false && r.est.zoneName === null),
    `outside coordinates are validated as outside, with no zone claimed and no boundary matched ` +
    `(${outsideCases.map(r => `${r.case}:${r.est.status}/${r.est.multiplier}`).join(' ')})`);

  check('MTX-R04', outsideCases.every(r => r.bk.created && r.bk.fare === r.est.charge),
    'an outside rider is still booked but pays a geography-free fare — rejecting the booking is ' +
    `§14 decision 1 and left open (${outsideCases.map(r => `₹${r.bk.fare}`).join(', ')})`);

  const insideRow = rideRows.find(r => r.case === 'A');
  check('MTX-R05', insideRow && !insideRow.est.refused && insideRow.est.status === 'VALIDATED_INSIDE' &&
    insideRow.est.matched && insideRow.bk.created && insideRow.bk.fare === insideRow.est.charge,
    `inside coordinates match a boundary and its modifier reaches the fare ` +
    `(zone="${insideRow?.est.zoneName}", m=${insideRow?.est.multiplier}, ₹${insideRow?.est.charge})`);

  check('MTX-R06', insideRow.bk.fare > rideRows.find(r => r.case === 'B').bk.fare,
    `the boundary is worth money on the server's own number (inside ₹${insideRow.bk.fare} vs outside ₹${rideRows.find(r => r.case === 'B').bk.fare}), so MTX-R05 is not a coincidence`);

  const zoneRows = rideRows.filter(r => ['I', 'J'].includes(r.case));
  const baseline = rideRows.find(r => r.case === 'B');
  check('MTX-R07', zoneRows.every(r => r.bk.created && r.bk.fare === baseline.bk.fare &&
    r.est.multiplier === baseline.est.multiplier),
    'naming a zone changes nothing, whichever zone is named (forged and real zone ids both priced ' +
    `the same as standing outside unnamed: ₹${zoneRows.map(r => r.bk.fare).join(' / ₹')})`);

  const missingRows = rideRows.filter(r => ['G', 'H'].includes(r.case));
  check('MTX-R08', missingRows.every(r => !r.est.refused && r.est.status === 'NOT_PROVIDED' && r.est.matched === false),
    `a quote with no location is labelled NOT_PROVIDED, not validated (${missingRows.map(r => `${r.case}:${r.est.status}`).join(' ')})`);
  check('MTX-R09', missingRows.every(r => r.bk.created),
    'a ride booked with no location is still booked, from the platform\'s own central-Delhi default; ' +
    'whether a booking may proceed without a client location is §14 decision 1 and left open');

  const nonsense = rideRows.filter(r => ['E', 'F'].includes(r.case));
  check('MTX-R10', nonsense.every(r => r.est.refused && !r.bk.created),
    `nonsense coordinates produce no quote and no booking (${nonsense.map(r => `${r.case}:${r.est.code}`).join(', ')})`);

  return rows;
}

// ---------------------------------------------------------------------------
// B. Phase 13 — pricing invariants
// ---------------------------------------------------------------------------
async function groupB(token) {
  console.log('\n--- B. Phase 13 pricing invariants ---');

  const noCoords = engineVerdict(await quote('RIDE', {}));
  const outside = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  const forged = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng, zoneId: 'ZONE_NOT_MINE' }));
  const inside = engineVerdict(await quote('RIDE', { pickupLat: INSIDE.lat, pickupLng: INSIDE.lng }));
  const invalid = engineVerdict(await quote('RIDE', { pickupLat: 'abc', pickupLng: INSIDE.lng }));

  check('INV-01', invalid.refused, `INVALID GEO → no quote at all, so no modifier either (${invalid.code})`);
  check('INV-02', !noCoords.refused && noCoords.matched === false && noCoords.zoneName === null && noCoords.multiplier === 1,
    `UNVALIDATED GEO → no modifier (no-location quote m=${noCoords.multiplier}, zone=${noCoords.zoneName})`);
  check('INV-03', outside.multiplier === noCoords.multiplier && outside.charge === noCoords.charge,
    `OUTSIDE → no boundary modifier (₹${outside.charge} m=${outside.multiplier}, same as no-location)`);
  check('INV-04', forged.charge === outside.charge && forged.multiplier === outside.multiplier,
    `FORGED ZONE → no modifier (₹${forged.charge}, identical to the same point unnamed)`);
  check('INV-05', inside.matched && inside.charge > outside.charge,
    `VALID INSIDE → the modifier does reach the price (₹${inside.charge} m=${inside.multiplier} vs ₹${outside.charge})`);

  // A client that sends the fields the server derives must be answered with the
  // server's numbers, not a merge. Same trip as `inside` above — a different
  // distance would be a different fare for a reason that has nothing to do with
  // the lies in the body.
  const tampered = await request('POST', BASE, '/api/pricing/estimate', {
    serviceType: SERVICE_TYPE.RIDE, ...ROUTE_INPUT.RIDE,
    pickupLat: INSIDE.lat, pickupLng: INSIDE.lng,
    surgeMultiplier: 0.01, activeZoneName: 'Standard Operational Area', totalSurcharge: 0,
    zoneId: 'ZONE_PREMIUM', fare: 5, driverEarnings: 1, platformFee: 0
  });
  const t = tampered.data?.estimate;
  check('INV-06', tampered.status === 200 && t && t.surgeMultiplier === inside.multiplier &&
    t.customerCharge === inside.charge && t.activeZoneName === inside.zoneName,
    `every tampered pricing field in the request is ignored (server m=${t?.surgeMultiplier} ` +
    `zone="${t?.activeZoneName}" ₹${t?.customerCharge})`);

  const ride = await book('RIDE', { lat: INSIDE.lat, lng: INSIDE.lng }, {
    fare: 1, surgeMultiplier: 9, activeZoneName: 'Standard Operational Area', discount: 999
  }, token);
  check('INV-07', ride.created && ride.fare === inside.charge,
    `the same lie at booking time changes nothing (job fare ₹${ride.fare} = server quote ₹${inside.charge})`);

  // Money stays server-authoritative across identical requests run in parallel.
  const parallel = await Promise.all(Array.from({ length: 8 }, () => quote('RIDE', { pickupLat: INSIDE.lat, pickupLng: INSIDE.lng })));
  const charges = new Set(parallel.map(r => r.data?.estimate?.customerCharge));
  check('INV-08', charges.size === 1 && [...charges][0] === inside.charge,
    `8 concurrent identical quotes agree exactly (${[...charges].join(', ')})`);
}

// ---------------------------------------------------------------------------
// C. Phase 14 — failure injection
// ---------------------------------------------------------------------------
async function groupC(adminHeaders) {
  console.log('\n--- C. Phase 14 failure injection ---');

  const before = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;

  const badPolygon = await request('POST', BASE, '/api/admin/geofences', {
    name: `GeoAdv Bad Ring ${unique()}`, type: 'POLYGON',
    coordinates: [{ lat: 28.6, lng: 77.2 }, { lat: 28.7, lng: 77.3 }],
    surcharge: 99, surgeMultiplier: 2.5
  }, adminHeaders);
  const afterBad = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('FI-01', badPolygon.status === 400 && badPolygon.data?.code === REASON.GEOMETRY_INVALID &&
    afterBad.fenceCount === before.fenceCount,
    `malformed geometry → 400 ${badPolygon.data?.code}, and the store still holds ${afterBad.fenceCount} fences ` +
    `(was ${before.fenceCount}): refused, not repaired`);

  const badCircle = await request('POST', BASE, '/api/admin/geofences', {
    name: `GeoAdv Centreless Ring ${unique()}`, type: 'CIRCLE', radiusMeters: 1200, surcharge: 5
  }, adminHeaders);
  check('FI-02', badCircle.status === 400 && badCircle.data?.code === REASON.GEOMETRY_INVALID,
    `a circle with no centre → ${badCircle.status} ${badCircle.data?.code} (it used to store a 3.5 km ring over Delhi)`);

  const badRule = await request('POST', BASE, '/api/admin/surgezones', {
    zoneId: 'ZONE_THERE_IS_NO_SUCH_PLACE', service: 'RIDE', surgeMultiplier: 1.1, maxMultiplier: 1.2
  }, adminHeaders);
  const afterBadRule = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('FI-03', badRule.status === 400 && badRule.data?.code === REASON.ZONE_UNRESOLVED &&
    afterBadRule.ruleCount === before.ruleCount,
    `a surge rule naming nothing → ${badRule.status} ${badRule.data?.code}, rules still ${afterBadRule.ruleCount} ` +
    `(was ${before.ruleCount}): no silent binding to somebody else's boundary`);

  const selfIntersect = await request('POST', BASE, '/api/admin/geofences', {
    name: `GeoAdv Bowtie ${unique()}`, type: 'POLYGON', surcharge: 10,
    coordinates: [
      { lat: 28.60, lng: 77.20 }, { lat: 28.64, lng: 77.24 },
      { lat: 28.64, lng: 77.20 }, { lat: 28.60, lng: 77.24 }
    ]
  }, adminHeaders);
  check('FI-04', selfIntersect.status === 400 && [REASON.GEOMETRY_SELF_INTERSECT, REASON.GEOMETRY_INVALID].includes(selfIntersect.data?.code),
    `a self-intersecting ring → ${selfIntersect.status} ${selfIntersect.data?.code} ` +
    '(a bowtie contains points twice over and would surcharge a rider who is nowhere inside it)');

  // Two writers, one boundary, concurrently: both may land, but the price must
  // move once. This is the runaway-pricing protection under a race.
  // Two writers, one boundary drawn twice, concurrently. This is the shape the
  // development store actually has — 421 duplicate rows — because `zone_code` is
  // UNIQUE while the *geometry* is not, so two identical shapes can and do land.
  // The claim under test is therefore about money, not about ids: whatever the
  // store accepts, a second copy of a boundary must not price a second time.
  const unpriced = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  const twin = {
    type: 'CIRCLE', center: { lat: OUTSIDE.lat, lng: OUTSIDE.lng }, radiusMeters: 4000,
    surcharge: 33, surgeMultiplier: 1.1, status: 'ACTIVE'
  };
  const [w1, w2] = await Promise.all([
    request('POST', BASE, '/api/admin/geofences', { ...twin, name: `GeoAdv Twin ${unique()}` }, adminHeaders),
    request('POST', BASE, '/api/admin/geofences', { ...twin, name: `GeoAdv Twin ${unique()}` }, adminHeaders)
  ]);
  const bothIds = [fenceIdOf(w1), fenceIdOf(w2)].filter(Boolean);
  const raced = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  // The surcharge is not simply added to the fare: it joins the subtotal and a
  // multiplier then sits on top of the sum, and that arithmetic belongs to the
  // engine. What duplicates must not do is stack, and that is comparable
  // directly — drop one of the two identical rows and the number is unchanged.
  const oneRemoved = bothIds.length === 2
    ? await request('DELETE', BASE, `/api/admin/geofences/${bothIds[0]}`, null, adminHeaders)
    : { status: 200 };
  const ids = bothIds.length === 2 ? bothIds.slice(1) : bothIds;
  const singleRow = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  check('FI-05', [w1.status, w2.status].every(s => s === 200) && bothIds.length === 2 &&
    oneRemoved.status === 200 && raced.charge > unpriced.charge && singleRow.charge === raced.charge,
    `two concurrent writes of one boundary both landed (${bothIds.length} ids, ${w1.status}/${w2.status}) and priced ` +
    `the point (₹${unpriced.charge} → ₹${raced.charge}); deleting one identical shape leaves the number unchanged ` +
    `(₹${singleRow.charge}) — a duplicate boundary cannot stack onto a price`);

  // The same door asked honestly: two writes that *name* one zone code. The first
  // is a create and the second is a conflict, and a conflict must not be reported
  // as an outage — "the store is down" tells an operator to go look at the
  // database and tells a caller to retry the request that just collided.
  const taken = { ...twin, name: `GeoAdv Codecheck ${unique()}`, code: `GEOADV_${unique()}`.slice(0, 32) };
  const firstWrite = await request('POST', BASE, '/api/admin/geofences', taken, adminHeaders);
  const secondWrite = await request('POST', BASE, '/api/admin/geofences', taken, adminHeaders);
  const takenId = fenceIdOf(firstWrite);
  if (takenId) await request('DELETE', BASE, `/api/admin/geofences/${takenId}`, null, adminHeaders);
  check('FI-10', firstWrite.status === 200 && secondWrite.status === 409 &&
    secondWrite.data?.code === REASON.ZONE_CODE_TAKEN,
    `a second write of one zone code answers ${secondWrite.status} ${secondWrite.data?.code} where the first ` +
    `answered ${firstWrite.status} — an infrastructure 5xx and a data conflict are different answers ` +
    `(${takenId ? 'and the created row was deleted again' : 'nothing was created, so nothing to clean up'})`);

  // Flip the store under a reader: every answer must stay a definite verdict.
  const mixed = await Promise.all([
    ...Array.from({ length: 6 }, () => quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng })),
    ...ids.map(id => request('DELETE', BASE, `/api/admin/geofences/${id}`, null, adminHeaders))
  ]);
  const survivors = mixed.filter(r => r.data?.estimate || r.data?.code);
  check('FI-06', survivors.every(r => r.status === 200 || r.status === 503) &&
    new Set(survivors.map(r => r.data?.estimate?.customerCharge ?? r.data?.code)).size <= 2,
    `6 quotes interleaved with ${ids.length} deletes: every response was a verdict, never a torn read ` +
    `(${[...new Set(survivors.map(r => r.status))].join('/')} with ${survivors.length} geo answers)`);

  const afterDelete = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  const afterInventory = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('FI-07', afterDelete.charge === unpriced.charge && afterDelete.matched === false,
    `a deleted boundary stops pricing at once (₹${afterDelete.charge} again, was ₹${raced.charge}, no matched fence)`);
  check('FI-08', afterInventory.fenceCount === before.fenceCount &&
    afterInventory.storeState.fences === 'VALIDATED',
    `the store is back where it started (${before.fenceCount} → ${afterInventory.fenceCount} fences, ${afterInventory.ruleCount} rules) — ` +
    'a delete that left a phantom fence behind would price strangers forever');

  // A database that answers but never replies: the honest answer is that this
  // process cannot start, because geography is read before the port opens.
  const hang = http.createServer(() => { /* accept and say nothing */ });
  await new Promise(resolve => hang.listen(0, '127.0.0.1', resolve));
  const hangPort = hang.address().port;
  const child = spawn(process.execPath, [path.join(__dirname, 'src', 'server.js')], {
    cwd: __dirname,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(hangPort + 1),
      SUPABASE_URL: `http://127.0.0.1:${hangPort}`,
      SUPABASE_ANON_KEY: 'hang-probe-not-a-secret',
      SUPABASE_SERVICE_ROLE_KEY: 'hang-probe-not-a-secret',
      SUPABASE_POSTGRES_LIVE: 'true'
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  const hungBase = `http://127.0.0.1:${hangPort + 1}`;
  let becameReady = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ready = await request('GET', hungBase, '/api/health/ready', null);
    if (ready.status === 200) { becameReady = true; break; }
  }
  child.kill('SIGKILL');
  hang.close();
  check('FI-09', becameReady === false,
    'DB timeout (accepts, never answers) → the process does not open its port within 6s, so no ' +
    'quote is served from a geography it has not read. Recorded risk: there is no timeout on the ' +
    'boot read, so an unresponsive store delays start rather than failing fast');
}

// ---------------------------------------------------------------------------
// D. Phase 15 — security
// ---------------------------------------------------------------------------
async function groupD(token, rahulToken, adminHeaders) {
  console.log('\n--- D. Phase 15 security cases ---');

  const idorRide = await request('POST', BASE, '/api/customer/book-ride', {
    customerId: 'usr_1', vehicleType: '3W',
    pickup: { address: 'Priya for Rahul', ...INSIDE }, drop: { address: 'Drop', lat: 28.6853, lng: 77.2185 }
  }, { Authorization: `Bearer ${token}` });
  const idorParcel = await request('POST', BASE, '/api/customer/book-parcel', {
    customerId: 'usr_1',
    senderDetails: { address: 'Priya for Rahul', ...INSIDE }, recipientDetails: { address: 'Drop' }
  }, { Authorization: `Bearer ${token}` });
  check('SEC-01', idorRide.status === 403 && idorParcel.status === 403 &&
    !idorRide.data?.job && !idorParcel.data?.job,
    `IDOR: booking for another customer refused on both routes (${idorRide.status}/${idorParcel.status})`);

  const anonymousAdmin = await Promise.all([
    request('GET', BASE, '/api/admin/geofences', null),
    request('GET', BASE, '/api/admin/surgezones', null),
    request('GET', BASE, '/api/admin/geofences', null, { Authorization: 'Bearer not-a-token' })
  ]);
  check('SEC-02', anonymousAdmin.every(r => r.status === 401),
    `anonymous enumeration of the fence inventory and the rule list: ${anonymousAdmin.map(r => r.status).join('/')}`);

  const publicEval = await request('POST', BASE, '/api/geofence/evaluate', { lat: INSIDE.lat, lng: INSIDE.lng, serviceType: 'RIDE' });
  // An echoed point is `{"lat":…,"lng":…}`; a boundary is an array of them. Only
  // the second one is the shape of a fence.
  const body = JSON.stringify(publicEval.data);
  const leaksVertices = /\[\s*\{\s*"lat"/.test(body) || /\{"lat":[0-9.,\s-]+\},\s*\{"lat"/.test(body);
  check('SEC-03', publicEval.status === 200 && !leaksVertices,
    `the anonymous evaluate route answers a verdict about the submitted point and never the vertices ` +
    `that produced it (${leaksVertices ? 'VERTICES PRESENT' : 'no ring in the response'}); whether it should ` +
    'require a session at all is §14 decision 8 and is NOT DECIDED');

  const reverseBad = await request('POST', BASE, '/api/geofence/reverse-geocode', { lat: 'abc', lng: 77.2197 });
  check('SEC-04', reverseBad.status === 400 && reverseBad.data?.code === REASON.INVALID_COORDINATES,
    `the locality resolver refuses nonsense instead of naming it (used to answer 200 "Live Location (NaN° N …)"): ` +
    `${reverseBad.status} ${reverseBad.data?.code}`);

  // Replay: one idempotency key, two requests, one job.
  const key = unique();
  const first = await book('RIDE', INSIDE, {}, token, key);
  const replay = await book('RIDE', INSIDE, {}, token, key);
  check('SEC-05', first.created && replay.created && replay.id === first.id && replay.duplicate === true,
    `replay with one idempotency key returns the same job (₹${first.fare} then ₹${replay.fare}, duplicate=${replay.duplicate})`);

  // Stale token from a second account cannot reach a third account's booking.
  const crossToken = await request('POST', BASE, '/api/customer/book-ride', {
    vehicleType: '3W', pickup: { address: 'Rahul for Priya', ...INSIDE }, drop: { address: 'Drop', lat: 28.6853, lng: 77.2185 }
  }, { Authorization: `Bearer ${rahulToken}` });
  check('SEC-06', crossToken.status === 403 || crossToken.status === 200,
    `an unverified account is gated by KYC before geography: ${crossToken.status} ` +
    `(${crossToken.data?.error ? 'identity gate' : 'booked'})`);

  // RLS is enabled on these tables, so what the anon key may read is a policy, not
  // an accident: `p_read_active_geofences` grants SELECT on active rows to
  // `public`, and the row carries its vertices and its surcharge. No client in
  // this repository reads the table directly, so the policy serves no feature.
  // Narrowing it is DDL, and Phase 20 of the order says a schema change is stopped
  // and reported, not applied — so this check pins the current state down so that
  // whoever drops the policy sees a passing suite change colour, and so that nobody
  // later writes "RLS protects fence geometry" as if it were true.
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    check('SEC-07-KNOWN-GAP', true, 'anon-key probe skipped: SUPABASE_ANON_KEY is not in the environment');
  } else {
    const anon = await restSelect('/rest/v1/geo_fences?select=*&limit=5', { apikey: anonKey });
    const rows = Array.isArray(anon.data) ? anon.data.length : 0;
    const withGeometry = rows > 0 && Boolean(anon.data[0]?.coordinates || anon.data[0]?.geometry);
    check('SEC-07-KNOWN-GAP', anon.status === 200 && rows > 0 && withGeometry,
      `OPEN FINDING, deliberately not fixed here: the anon key reads ${rows} of the active boundaries ` +
      `with geometry ${withGeometry ? 'and surcharge included' : 'but no geometry column'} (HTTP ${anon.status}). ` +
      'If a policy change removes that access this check fails, and it should then be rewritten to assert the refusal. ' +
      'Note the other half of the picture: the backend itself connects as service_role, whose policy is `true`, ' +
      'so RLS has never been what protects a rider from a price — Express is');
  }

  // A duplicate of an existing boundary is a pricing event, not a cosmetic one.
  const inv = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('SEC-08', inv.duplicateFenceRows > 0 && inv.distinctFenceShapes < inv.fenceCount,
    `the live store holds ${inv.fenceCount} fence rows in ${inv.distinctFenceShapes} distinct shapes ` +
    `(${inv.duplicateFenceRows} duplicates); counting them once is what keeps a probe run from compounding price`);
}

// ---------------------------------------------------------------------------
// E. Phase 16 — cache freshness
// ---------------------------------------------------------------------------
async function groupE(adminHeaders) {
  console.log('\n--- E. Phase 16 cache freshness: a boundary that lands is a boundary that prices ---');

  const before = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  // A point the live store covers with nothing, so any change here can only be
  // this boundary's doing.
  const baseline = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  const name = `GeoAdv Freshness ${unique()}`;
  const created = await request('POST', BASE, '/api/admin/geofences', {
    name, type: 'CIRCLE', center: { lat: OUTSIDE.lat, lng: OUTSIDE.lng }, radiusMeters: 6000,
    surcharge: 51, surgeMultiplier: 1.25, status: 'ACTIVE'
  }, adminHeaders);
  const id = fenceIdOf(created);

  const priced = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  // The verdict route reads the same in-process copy and names the amount, so
  // "the row landed whole" is checkable without re-deriving the fare formula —
  // the surcharge and the multiplier of one written boundary, both visible.
  const verdict = await request('POST', BASE, '/api/geofence/evaluate', {
    lat: OUTSIDE.lat, lng: OUTSIDE.lng, serviceType: 'RIDE'
  });
  check('CACHE-01', created.status === 200 && Boolean(id),
    `an admin write to a live store returned ${created.status}${id ? ' with an id' : ` (${JSON.stringify(created.data).slice(0, 80)})`}`);
  check('CACHE-02', priced.matched && priced.charge > baseline.charge && priced.multiplier === 1.25 &&
    verdict.data?.totalSurcharge === 51,
    `the very next quote sees it, with no restart (₹${baseline.charge} → ₹${priced.charge}, m=${priced.multiplier}, ` +
    `surcharge ₹${verdict.data?.totalSurcharge}) — ` +
    'the copy the process prices from is re-read after a write, so a configured boundary cannot be invisible');
  check('CACHE-03', priced.zoneName === name,
    `the claim in the answer is the row that was written ("${priced.zoneName}")`);

  const after = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('CACHE-04', after.fenceCount === before.fenceCount + 1 && after.storeState.source === 'postgres' &&
    new Date(after.storeState.readAt) >= new Date(before.storeState.readAt || 0),
    `the inventory moved with the write (${before.fenceCount} → ${after.fenceCount}) and says when it was read ` +
    `(${after.storeState.source}/${after.storeState.fences} at ${after.storeState.readAt})`);

  const deleted = await request('DELETE', BASE, `/api/admin/geofences/${id}`, null, adminHeaders);
  const afterDelete = engineVerdict(await quote('RIDE', { pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng }));
  const rest = (await request('GET', BASE, '/api/admin/geofences', null, adminHeaders)).data.inventory;
  check('CACHE-05', deleted.status === 200 && afterDelete.charge === baseline.charge && rest.fenceCount === before.fenceCount,
    `removing it is as immediate as adding it (₹${afterDelete.charge} again, ${rest.fenceCount} fences — back to the ${before.fenceCount} baseline)`);
}

// Anything this file wrote is named for it, and every check that writes is paired
// with a delete. A hardening harness that leaves boundaries behind has poisoned
// the store for every later run, so the sweep is the suite's own hygiene — and it
// is checked, because an unenforced cleanup is a cleanup that quietly stops
// working the day its id extraction changes.
async function adminFences(adminHeaders) {
  const list = await request('GET', BASE, '/api/admin/geofences', null, adminHeaders);
  return { body: list.data, rows: list.data?.geoFences || list.data?.data || [] };
}

async function sweepGeoAdv(adminHeaders, when = 'after') {
  const first = await adminFences(adminHeaders);
  const ours = (Array.isArray(first.rows) ? first.rows : []).filter(f => String(f.name || '').startsWith('GeoAdv '));
  for (const fence of ours) {
    await request('DELETE', BASE, `/api/admin/geofences/${fence.id}`, null, adminHeaders);
  }
  const again = await adminFences(adminHeaders);
  const inventory = again.body?.inventory;
  const left = (again.rows || []).filter(f => String(f.name || '').startsWith('GeoAdv ')).length;
  check(`HYGIENE-01-${when}`, left === 0,
    `swept ${ours.length} probe fence(s) ${when} this run; ${left} left behind. The store now holds ` +
    `${inventory?.fenceCount} rows in ${inventory?.distinctFenceShapes} distinct shapes ` +
    `(${inventory?.duplicateFenceRows} duplicate rows)`);
}

// ---------------------------------------------------------------------------
// F. Phases 6, 7, 12(K,L,O,P) over a controlled store
// ---------------------------------------------------------------------------
function makeStore() {
  const SQ = [
    { lat: 28.60, lng: 77.20 }, { lat: 28.60, lng: 77.30 },
    { lat: 28.70, lng: 77.30 }, { lat: 28.70, lng: 77.20 }
  ];
  const OVERLAP = [
    { lat: 28.65, lng: 77.25 }, { lat: 28.65, lng: 77.35 },
    { lat: 28.75, lng: 77.35 }, { lat: 28.75, lng: 77.25 }
  ];
  return {
    fences: [
      { id: 'sq', zoneCode: 'S_ADJ_SQ', name: 'Adjacent Sector', type: 'POLYGON', status: 'ACTIVE',
        category: 'TEST', surcharge: 10, surgeMultiplier: 1.1, coordinates: SQ },
      { id: 'ov', zoneCode: 'S_ADJ_OV', name: 'Overlapping Sector', type: 'POLYGON', status: 'ACTIVE',
        category: 'TEST', surcharge: 15, surgeMultiplier: 1.2, coordinates: OVERLAP },
      { id: 'off', zoneCode: 'S_ADJ_OFF', name: 'Closed Sector', type: 'POLYGON', status: 'INACTIVE',
        category: 'TEST', surcharge: 90, surgeMultiplier: 2.9, coordinates: SQ }
    ],
    rules: [
      { id: 'r_expired', zoneId: 'sq', zoneName: 'Adjacent Sector', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 2.6, maxMultiplier: 3.0, priority: 'HIGH', startTime: '01:00', endTime: '01:30' },
      { id: 'r_future', zoneId: 'ov', zoneName: 'Overlapping Sector', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 2.9, maxMultiplier: 3.0, priority: 'HIGH', startTime: '23:30', endTime: '23:59' }
    ],
    global: 1.0,
    state: { fences: 'VALIDATED', rules: 'VALIDATED', source: 'synthetic' }
  };
}

function groupF() {
  console.log('\n--- F. Phases 6, 7 and matrix cases K/L/O/P over a controlled store ---');

  const store = makeStore();
  geoPolicy.bind({
    fences: () => store.fences,
    rules: () => store.rules,
    globalSurgeMultiplier: () => store.global,
    storeState: () => store.state
  });

  // 12(P): one metre either side of a drawn edge is a definite answer, not a coin toss.
  const edgeLat = 28.60;
  const justInside = geoPolicy.evaluate({ latitude: edgeLat + 0.000009, longitude: 77.25, service: 'RIDE', operation: 'QUOTE' });
  const justOutside = geoPolicy.evaluate({ latitude: edgeLat - 0.000009, longitude: 77.25, service: 'RIDE', operation: 'QUOTE' });
  check('PH6-P', justInside.insideServiceArea === true && justOutside.insideServiceArea === false &&
    justOutside.totalSurcharge === 0 && justOutside.effectiveSurgeMultiplier === 1,
    `boundary at about a metre: ${justInside.insideServiceArea ? 'inside' : 'outside'} vs ` +
    `${justOutside.insideServiceArea ? 'inside' : 'outside'} (₹${justInside.totalSurcharge} m=${justInside.effectiveSurgeMultiplier} ` +
    `vs ₹${justOutside.totalSurcharge} m=${justOutside.effectiveSurgeMultiplier})`);

  // 12(O): two genuinely different boundaries covering one point. Asked as a
  // service no rule in this store is written for, so the arithmetic on display is
  // the fences' alone and not a surge rule's.
  const overlap = geoPolicy.evaluate({ latitude: 28.68, longitude: 77.28, service: 'PARCEL', operation: 'QUOTE' });
  check('PH6-O', overlap.matchedFences.length === 2 && overlap.totalSurcharge === 10 + 15 &&
    overlap.effectiveSurgeMultiplier === 1.2,
    `overlapping zones: ${overlap.matchedFences.length} boundaries, surcharge summed once each ` +
    `(₹${overlap.totalSurcharge}), multiplier the highest single value (${overlap.effectiveSurgeMultiplier}) ` +
    'rather than a product — the final overlap policy is §14 decision 3 and is NOT DECIDED');

  // 12(K) and 12(L): a window the clock has passed, and one not yet reached. With
  // the rules in play the multiplier also carries a rule's number, which is the
  // point of the check.
  const ruled = geoPolicy.evaluate({ latitude: 28.68, longitude: 77.28, service: 'RIDE', operation: 'QUOTE' });
  const expired = geoPolicy.evaluate({ latitude: 28.62, longitude: 77.25, service: 'RIDE', operation: 'QUOTE' })
    .applicableSurgeRules.find(r => r.id === 'r_expired');
  const future = ruled.applicableSurgeRules.find(r => r.id === 'r_future');
  check('PH6-K', expired && expired.window.inWindow === false && expired.window.code === REASON.RULE_EXPIRED &&
    expired.applied === true,
    `an expired rule says so (${expired?.window.code}) and is priced anyway ` +
    `(m=${expired?.effectiveMultiplier} applied=${expired?.applied}): enforcing windows is §14 decision 4, NOT DECIDED`);
  check('PH6-L', future && future.window.inWindow === false && future.window.code === REASON.RULE_NOT_YET_ACTIVE,
    `a rule that opens later today is measured as not yet active (${future?.window.code}) under the same open decision`);

  // Phase 6's own claim: ACTIVE in the table is not membership of anything.
  const outsideEverything = geoPolicy.evaluate({ latitude: 12.97, longitude: 77.59, service: 'RIDE', operation: 'QUOTE' });
  check('PH6-STATUS', outsideEverything.matchedFences.length === 0 &&
    outsideEverything.applicableSurgeRules.length === 0 &&
    outsideEverything.effectiveSurgeMultiplier === 1 &&
    outsideEverything.nonApplicable.activeRulesWithoutContainment === 2 &&
    outsideEverything.platformWideSurgeRule?.basis === 'STATUS_ONLY',
    `a point inside nothing gets no boundary modifiers at all (m=${outsideEverything.effectiveSurgeMultiplier}), ` +
    `while the engine still reports the ${outsideEverything.nonApplicable.activeRulesWithoutContainment} ACTIVE rules that ` +
    `could price it without containing it (basis=${outsideEverything.platformWideSurgeRule?.basis}) — ` +
    'containment cannot be reached by status, and the one door that bypasses it is labelled');

  const inactive = geoPolicy.evaluate({ latitude: 28.62, longitude: 77.22, service: 'RIDE', operation: 'QUOTE' });
  check('PH6-INACTIVE', inactive.matchedFences.length === 1 && inactive.totalSurcharge === 10 &&
    inactive.nonApplicable.inactiveFences === 1,
    `the INACTIVE twin contributes nothing (₹${inactive.totalSurcharge}, not ₹100) and is counted as skipped ` +
    `(${inactive.nonApplicable.inactiveFences})`);

  check('PH6-UNREADABLE', (() => {
    const broken = { fences: 'UNREADABLE', rules: 'UNREADABLE', source: 'postgres' };
    geoPolicy.bind({ fences: () => [], rules: () => [], globalSurgeMultiplier: () => 1, storeState: () => broken });
    const r = geoPolicy.evaluate({ latitude: 28.62, longitude: 77.22, service: 'RIDE', operation: 'RIDE_CREATE', requestedZoneId: 'sq' });
    return r.rejectionReason?.code === REASON.STORE_UNAVAILABLE && r.insideServiceArea === false &&
      r.effectiveSurgeMultiplier === 1 && r.matchedFences.length === 0;
  })(),
  'an unreadable store with a named zone id still refuses: no membership, no multiplier, no price');

  console.log('   (group F binds a synthetic store inside this test process only; the backend keeps its own)');
}

// ---------------------------------------------------------------------------
// G. Phase 11 — the driver lifecycle at the HTTP surface
// ---------------------------------------------------------------------------
// Phase 11's minimum is a negative: no lifecycle operation may *trust* a client's
// zoneId, activeZoneName, surge zone or "inside" flag. That is checkable from the
// source of each handler, which is stronger than probing one value. What follows
// it is the positive half — a real position posted through the one route that
// takes coordinates — and it records that containment is never consulted, which
// is §14 decision 1's territory and stays there.
async function groupG(driverHeaders) {
  console.log('\n--- G. Phase 11 driver lifecycle: what is trusted, what is checked ---');
  console.log('| Operation | Client geo trusted | Server geo check | Inside/outside/boundary | Invalid GPS | Stale GPS | Missing GPS |');
  console.log('|---|---|---|---|---|---|---|');

  const src = require('fs').readFileSync(`${__dirname}/src/server.js`, 'utf8');
  // Array-form registrations are the reason this scans with a parser rather than
  // a string search: `/api/driver/arrived` is registered as a two-path array and
  // a `indexOf("app.post('/api/driver/arrived'")` finds nothing and reports clean.
  const registrations = [];
  for (const m of src.matchAll(/app\.(post|put|patch)\(\s*(\[[^\]]*\]|[`"'][^`"']*[`"'])/g)) {
    for (const p of m[2].matchAll(/[`"']([^`"']+)[`"']/g)) {
      registrations.push({ method: m[1], path: p[1], start: m.index });
    }
  }
  const handlerOf = (path) => {
    const at = registrations.find(r => r.path === path);
    if (!at) return null;
    const next = src.indexOf('\napp.', at.start + 5);
    return { path, body: src.slice(at.start, next === -1 ? at.start + 8000 : next) };
  };
  const bodyFieldsOf = (handler) => {
    const names = new Set();
    for (const m of handler.matchAll(/(?:const|let)\s*\{([^}]*)\}\s*=\s*req\.body/g)) {
      for (const part of m[1].split(',')) {
        const name = part.split(':').pop().split('=')[0].trim();
        if (name) names.add(name);
      }
    }
    for (const m of handler.matchAll(/req\.body\.([A-Za-z0-9_]+)/g)) names.add(m[1]);
    return [...names];
  };

  const GEO_TRUSTED = ['zoneId', 'activeZoneName', 'surgeZone', 'surgeZoneId', 'surgeMultiplier',
    'inside', 'insideGeoFence', 'geoValidation', 'lat', 'lng', 'latitude', 'longitude'];
  const lifecycle = [
    ['go online', '/api/driver/:driverId/toggle-online'],
    ['accept offer', '/api/driver/offers/:offerId/accept'],
    ['accept job', '/api/driver/accept-job'],
    ['arrived', '/api/driver/arrived'],
    ['complete trip', '/api/driver/complete-trip']
  ];
  const scanned = [];
  for (const [label, path] of lifecycle) {
    const h = handlerOf(path);
    const geo = h ? bodyFieldsOf(h.body).filter(n => GEO_TRUSTED.includes(n)) : ['ROUTE NOT FOUND'];
    scanned.push({ label, path, geo });
    console.log(`| ${label} (${path}) | ${geo.length ? geo.join(', ') : 'none'} | none — no fence is consulted | ` +
      'not reached: no geographic input | n/a | n/a | n/a |');
  }
  check('DRV-01', scanned.length === 5 && scanned.every(s => s.geo.length === 0),
    `none of the ${scanned.length} lifecycle handlers reads a geographic field off the request body ` +
    `(parsed from the registrations, array forms included): ${scanned.map(s => `${s.label}=[${s.geo.join('|') || 'none'}]`).join(', ')}`);

  const location = handlerOf('/api/driver/location');
  const locationFields = bodyFieldsOf(location.body);
  console.log(`| store a position (/api/driver/location) | ${locationFields.filter(n => GEO_TRUSTED.includes(n)).join(', ')} | ` +
    'telemetry validity only | both stored | refused | refused | refused |');
  check('DRV-02', location && locationFields.includes('lat') &&
    !locationFields.some(n => ['zoneId', 'activeZoneName', 'inside', 'insideGeoFence', 'surgeMultiplier'].includes(n)),
    `the one driver route that takes a coordinate takes exactly the coordinate ` +
    `(${locationFields.filter(n => GEO_TRUSTED.includes(n)).join(', ')}); a zone name or an "inside" claim ` +
    'is not among the fields it reads, so there is nothing there for a driver to forge');

  // The same three points a customer quote is asked about, from the driver side.
  if (!driverHeaders) {
    check('DRV-03', false, 'no driver session could be opened, so the live half of Phase 11 was not run ' +
      'rather than skipped — the structural checks above stand on their own');
    return;
  }
  const stored = {};
  for (const [caseName, point] of [['inside', INSIDE], ['outside', OUTSIDE], ['boundary', { lat: 28.5562 + 0.000009, lng: 77.1 }]]) {
    const res = await request('POST', BASE, '/api/driver/location', { lat: point.lat, lng: point.lng }, driverHeaders);
    stored[caseName] = res;
    console.log(`| position ${caseName} | — | ${res.status === 200 ? 'stored, no zone named' : res.data?.code} | ` +
      `${JSON.stringify(Object.keys(res.data || {}))} | — | — | — |`);
  }
  const shapes = ['inside', 'outside', 'boundary'].map(k => Object.keys(stored[k].data || {}).sort().join(','));
  check('DRV-03', stored.inside.status === 200 && stored.outside.status === 200 && stored.boundary.status === 200 &&
    new Set(shapes).size === 1 && !/zone/i.test(shapes[0]),
    'a driver inside a boundary and a driver in Bengaluru get the same answer with the same fields ' +
    `(${shapes[0]}) — the position is stored and nothing asks what zone it is in (recorded gap; a containment ` +
    'gate is §14 decision 1 and is NOT DECIDED)');

  const bad = await Promise.all([
    ['string', { lat: 'abc', lng: 77.1 }],
    ['out of range', { lat: 999, lng: 77.1 }],
    ['missing', {}],
    ['stale', { lat: 28.6, lng: 77.1, timestamp: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() }],
    ['ahead of the clock', { lat: 28.6, lng: 77.1, timestamp: new Date(Date.now() + 3 * 60 * 1000).toISOString() }]
  ].map(([name, body]) => request('POST', BASE, '/api/driver/location', body, driverHeaders).then(r => ({ name, r }))));
  const refused = bad.map(({ name, r }) => `${name}=${r.status}/${r.data?.code}`);
  check('DRV-04', bad.every(({ r }) => r.status === 400 && r.data?.code),
    `nonsense and aged fixes are refused on the driver path the same way they are on the quote path: ${refused.join(' ')}`);

  // A client-asserted `isOnline` reaches the fleet map, because that is what the
  // field is for. It must not reach dispatch eligibility, which is a different
  // column with a different owner — so the two are named here rather than merged.
  const dbSrc = require('fs').readFileSync(`${__dirname}/src/database.js`, 'utf8');
  const fleetWrite = dbSrc.slice(dbSrc.indexOf('  updateDriverLocation('));
  const fleetBody = fleetWrite.slice(0, fleetWrite.indexOf('\n  getFleetLocations'));
  check('DRV-05', /isOnline: Boolean\(isOnline\)/.test(fleetBody) && !/operationalStatus/.test(fleetBody),
    'the location route can set the fleet map\'s own `isOnline` flag (a display claim), and cannot set ' +
    '`operationalStatus` — which is what suspends a driver and what dispatch reads');
}

// A zone id that exists, so "forged" and "real but not here" are separate cases.
async function realZoneId(adminHeaders) {
  const { rows } = await adminFences(adminHeaders);
  const first = Array.isArray(rows) ? rows[0] : null;
  return first?.id || first?.zoneCode || null;
}

async function main() {
  const adminLogin = await request('POST', BASE, '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  if (adminLogin.status !== 200) {
    await request('POST', BASE, '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing', username: 'superadmin', password: 'AdminPassword123!'
    });
  }
  const relogin = adminLogin.status === 200 ? adminLogin : await request('POST', BASE, '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const adminHeaders = { Authorization: `Bearer ${relogin.data.token}` };

  const otp = await request('POST', BASE, '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
  const verified = await request('POST', BASE, '/api/auth/verify-otp', { phone: '9845011982', otp: otp.data?.testOtp || '7729', role: 'CUSTOMER' });
  const token = verified.data?.token;
  const rahulOtp = await request('POST', BASE, '/api/auth/send-otp', { phone: '9876543210', role: 'CUSTOMER', purpose: 'LOGIN' });
  const rahul = await request('POST', BASE, '/api/auth/verify-otp', { phone: '9876543210', otp: rahulOtp.data?.testOtp || '7729', role: 'CUSTOMER' });
  // 9810122334 is the driver the main suite drives as well: its profile is linked
  // to a user account, which `authenticateDriver` requires. The neighbouring
  // fixture 9822233445 is a profile with no account behind it, so every driver
  // route answers 403 UNLINKED_DRIVER_ACCOUNT there — which is the right answer
  // and the wrong fixture for a lifecycle probe.
  const drvOtp = await request('POST', BASE, '/api/auth/send-otp', { phone: '9810122334', role: 'DRIVER', purpose: 'LOGIN' });
  const drv = await request('POST', BASE, '/api/auth/verify-otp', { phone: '9810122334', otp: drvOtp.data?.testOtp || '7729', role: 'DRIVER' });
  const driverHeaders = drv.data?.token ? { Authorization: `Bearer ${drv.data.token}` } : null;

  if (!token) {
    console.error('Cannot run the matrix without a verified customer session.');
    process.exit(2);
  }

  // Swept before as well as after: a run that dies part-way leaves its probe
  // boundaries in the local store, and every later suite's idea of a point
  // outside everything is then wrong through no fault of its own.
  await sweepGeoAdv(adminHeaders, 'before');

  console.log('### SERVICE-AREA ENFORCEMENT MATRIX (generated by geo_adversarial_test.js)');
  console.log('| Service | Case | Engine verdict | Booking | Price moved by geography? |');
  console.log('|---|---|---|---|---|');

  const zoneId = await realZoneId(adminHeaders);
  await groupA(token, zoneId);
  await groupB(token);
  await groupC(adminHeaders);
  await groupD(token, rahul.data?.token, adminHeaders);
  await groupE(adminHeaders);
  groupF();
  await groupG(driverHeaders);
  await sweepGeoAdv(adminHeaders);

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 GEO ADVERSARIAL: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  for (const failure of failed) console.log(`   ✗ ${failure.id}: ${failure.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('GEO ADVERSARIAL ABORTED:', err.stack || err.message);
  process.exit(3);
});
