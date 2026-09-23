// =========================================================================
// GEO POLICY CHECKS (local only)
//
// docs/GEOFENCING_SECURITY_AUDIT.md found that a price could be moved by a
// coordinate nobody validated, by a zone id the client typed, or by a database
// that had not answered at all. This file is the evidence that those three doors
// are shut, in the order an auditor asks about them:
//
//   A. the coordinate validator       — what is refused before geography is read
//   B. geometry at the write          — a boundary is stored as drawn or not at all
//   C. the engine over a synthetic    — containment, duplicates, inactive rows, and
//      store                          the one case a live store cannot show honestly:
//                                     a store that never answered
//   D. the public API over HTTP        — the same guarantees through real routes
//   E. a child process with the store  — the fail-closed half, which only exists
//      unreachable                     when the process really cannot read it
//
// Group E needs its own process because "unreachable" is a fact about how the
// backend was started, not something a healthy one can be told. The unreachable
// store is a closed port on 127.0.0.1. Nothing here reaches a hosted project.
// =========================================================================

const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const geoPolicy = require('./src/services/GeoPolicyService');
const { REASON } = geoPolicy;

const LIVE_BASE = process.env.GEO_TEST_BASE || 'http://127.0.0.1:4000';
const OUTAGE_PORT = Number(process.env.GEO_OUTAGE_PORT || 4199);
const OUTAGE_BASE = `http://127.0.0.1:${OUTAGE_PORT}`;

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
      path: url.pathname,
      method,
      headers: {
        ...headers,
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {})
      },
      timeout: 8000
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

// ---------------------------------------------------------------------------
// A. The coordinate validator
// ---------------------------------------------------------------------------
//
// The classes the audit named: a string that is not a number, an empty string,
// null, a lone half of a pair, NaN, both infinities, an out-of-range value, an
// object, an array, a boolean. Each must be refused with a reason code, and none
// may arrive at the other side as a usable coordinate — `Number('') === 0` and
// `Number(null) === 0` make latitude 0, the Gulf of Guinea, a real place.
const REJECTED_COORDINATES = [
  ['string', 'abc'],
  ['empty string', ''],
  ['whitespace', '  '],
  ['NaN literal', 'NaN'],
  ['NaN', NaN],
  ['positive Infinity', Infinity],
  ['negative Infinity', -Infinity],
  ['empty object', {}],
  ['array', [28.5, 77.2]],
  ['boolean', true],
  ['out of range 999', 999],
  ['out of range -999', -999],
  ['numeric string', '28.5562']
];

function groupA() {
  console.log('\n--- A. Coordinate validation (Phase 5) ---');

  let rejected = 0;
  for (const [label, value] of REJECTED_COORDINATES) {
    const pair = geoPolicy.validateCoordinatePair(value, 77.2185);
    const latOnly = geoPolicy.validateCoordinatePair(value, value);
    if (!pair.ok && !latOnly.ok) rejected++;
    else console.log(`   ↳ ${label} was not refused: ${JSON.stringify(pair.code || pair.value)}`);
  }
  check('GEO-A01', rejected === REJECTED_COORDINATES.length,
    `${rejected}/${REJECTED_COORDINATES.length} nonsense coordinate values refused, none coerced into a place`);

  const outOfRange = geoPolicy.validateCoordinatePair(28.5562, 190.0);
  check('GEO-A02', outOfRange.ok === false && outOfRange.code === REASON.OUT_OF_RANGE,
    `a valid-shaped latitude with longitude 190 is refused as out of range (code=${outOfRange.code})`);

  const halfPair = geoPolicy.evaluate({ latitude: 28.5562, service: 'RIDE', operation: 'QUOTE' });
  check('GEO-A03', halfPair.rejectionReason?.code === REASON.INVALID_COORDINATES &&
    halfPair.locationValidated === false,
    'a coordinate pair with only a latitude is refused, not treated as a longitude-free place');

  const allowed = [
    ['equator', 0, 0],
    ['south pole', -90, 0],
    ['north pole', 90, 180],
    ['date line', 0, -180],
    ['delhi', 28.5562, 77.1000]
  ].filter(([label, lat, lng]) => !geoPolicy.validateCoordinatePair(lat, lng).ok);
  check('GEO-A04', allowed.length === 0,
    `legitimate edge coordinates still pass${allowed.length ? ` (wrongly refused: ${allowed.map(a => a[0]).join(', ')})` : ''}`);

  const telemetryStrings = geoPolicy.validateCoordinatePair('28.5562', '77.1000', { numericStrings: true });
  check('GEO-A05', telemetryStrings.ok === true && telemetryStrings.value.lat === 28.5562,
    'a numeric string is accepted only where a published contract allows one, and parses exactly');
}

// ---------------------------------------------------------------------------
// B. Geometry at the write
// ---------------------------------------------------------------------------
//
// The audit's finding was a two-point polygon answered with HTTP 200 and stored
// as a hard-coded Delhi triangle. So the tests below are not "does validation
// exist" but "is the shape the operator sent the shape that is stored, and is
// every unsound shape a refusal that names itself".
const TRI = [
  { lat: 28.6250, lng: 77.3600 },
  { lat: 28.6350, lng: 77.3750 },
  { lat: 28.6150, lng: 77.3750 }
];
// Same triangle, different starting vertex: a different array, one boundary.
const TRI_ROTATED = [TRI[1], TRI[2], TRI[0]];
// Bowtie: edges cross, so "inside" has no consistent answer.
const BOWTIE = [
  { lat: 28.60, lng: 77.30 },
  { lat: 28.62, lng: 77.32 },
  { lat: 28.60, lng: 77.32 },
  { lat: 28.62, lng: 77.30 }
];

function groupB() {
  console.log('\n--- B. Geometry validation at the write (Phase 8) ---');

  const twoPoints = geoPolicy.validateFenceGeometry({ type: 'POLYGON', coordinates: TRI.slice(0, 2) });
  check('GEO-B01', twoPoints.ok === false && twoPoints.code === REASON.GEOMETRY_INVALID &&
    /three distinct vertices/.test(twoPoints.message || ''),
    `two points are refused, and the refusal says what is missing (${twoPoints.message})`);

  const nothing = geoPolicy.validateFenceGeometry({ type: 'POLYGON' });
  check('GEO-B02', nothing.ok === false && nothing.code === REASON.GEOMETRY_INVALID,
    'a polygon with no coordinates at all is refused rather than defaulted');

  const closed = geoPolicy.validateFenceGeometry({ type: 'POLYGON', coordinates: [...TRI, TRI[0]] });
  check('GEO-B03', closed.ok === true && closed.value.coordinates.length === 3 &&
    JSON.stringify(closed.value.coordinates) === JSON.stringify(TRI),
    'a ring closed by repeating its first vertex is stored as the three corners it describes');

  const crossing = geoPolicy.validateFenceGeometry({ type: 'POLYGON', coordinates: BOWTIE });
  check('GEO-B04', crossing.ok === false && crossing.code === REASON.GEOMETRY_SELF_INTERSECT,
    `a self-crossing ring is refused with its own reason code (${crossing.code})`);

  const farVertex = geoPolicy.validateFenceGeometry({
    type: 'POLYGON',
    coordinates: [{ lat: 200, lng: 77.36 }, TRI[1], TRI[2]]
  });
  check('GEO-B05', farVertex.ok === false && farVertex.code === REASON.GEOMETRY_INVALID,
    'one impossible vertex rejects the whole shape instead of being clipped into range');

  const unknownType = geoPolicy.validateFenceGeometry({ type: 'LINESTRING', coordinates: TRI });
  check('GEO-B06', unknownType.ok === false, 'a geometry type the engine cannot test is refused');

  const fromObject = geoPolicy.validateFenceGeometry({
    type: 'CIRCLE', coordinates: { center: { lat: 28.5562, lng: 77.1000 }, radiusMeters: 2500 }
  });
  const fromFields = geoPolicy.validateFenceGeometry({
    type: 'CIRCLE', centerLat: 28.5562, centerLng: 77.1000, radiusMeters: 2500
  });
  check('GEO-B07', fromObject.ok === true && fromFields.ok === true &&
    fromObject.value.radiusMeters === 2500 && fromFields.value.radiusMeters === 2500,
    'a circle arrives as {center,radiusMeters} or as flat fields and normalises to the same shape');

  const centreless = geoPolicy.validateFenceGeometry({ type: 'CIRCLE', radiusMeters: 1500 });
  const zeroRadius = geoPolicy.validateFenceGeometry({
    type: 'CIRCLE', center: { lat: 28.5562, lng: 77.1000 }, radiusMeters: 0
  });
  check('GEO-B08', centreless.ok === false && zeroRadius.ok === false &&
    /28\.55|77\.10|3500/.test(JSON.stringify(centreless)) === false,
    'a circle with no centre is refused instead of centred on Delhi, and a zero radius is refused');

  const badModifiers = [
    { type: 'POLYGON', coordinates: TRI, surcharge: -5 },
    { type: 'POLYGON', coordinates: TRI, surgeMultiplier: 0.5 },
    { type: 'POLYGON', coordinates: TRI, surgeMultiplier: 'abc' },
    { type: 'POLYGON', coordinates: TRI, allowedServices: ['BOAT'] },
    { type: 'POLYGON', coordinates: TRI, allowedServices: [] }
  ].filter(payload => geoPolicy.validateFenceGeometry(payload).ok !== false);
  check('GEO-B09', badModifiers.length === 0,
    `negative surcharge, a multiplier below 1.0, a nonsense multiplier and an unknown service are all refused${badModifiers.length ? ` (accepted: ${badModifiers.length})` : ''}`);

  const signatureDiffers = geoPolicy.fenceSignature({ type: 'POLYGON', coordinates: TRI }) !==
    geoPolicy.fenceSignature({ type: 'POLYGON', coordinates: TRI_ROTATED });
  check('GEO-B10', signatureDiffers === false,
    'the same boundary re-entered from another vertex is recognised as the same boundary');
}

// ---------------------------------------------------------------------------
// C. The engine over a synthetic store
// ---------------------------------------------------------------------------
//
// Synthetic on purpose. Against the live 420-fence store an inside point is
// easy to find and an unreadable store is impossible to produce honestly, and
// the half that matters most is the unreadable one.
const INSIDE_TRI = { lat: 28.6250, lng: 77.3700 };
// Somewhere no Delhi-NCR demonstration boundary can reach: used for the outside
// case in both the synthetic store and the live one, so "outside" means the same
// thing in both.
const OUTSIDE = { lat: 27.5000, lng: 88.5000 };

function makeStore() {
  return {
    fences: [
      { id: 'f_tri', zoneCode: 'F_TRI', name: 'Synthetic Sector', type: 'POLYGON', status: 'ACTIVE',
        category: 'TEST', surcharge: 20, surgeMultiplier: 1.2, coordinates: TRI },
      // Same boundary, second row, different starting vertex and a bigger price.
      { id: 'f_tri_dup', zoneCode: 'F_TRI_DUP', name: 'Synthetic Sector Copy', type: 'POLYGON', status: 'ACTIVE',
        category: 'TEST', surcharge: 40, surgeMultiplier: 1.6, coordinates: TRI_ROTATED },
      { id: 'f_circle', zoneCode: 'F_CIRCLE', name: 'Synthetic Ring', type: 'CIRCLE', status: 'ACTIVE',
        category: 'TEST', surcharge: 5, surgeMultiplier: 1.05,
        center: { lat: 28.5562, lng: 77.1000 }, radiusMeters: 2000 },
      { id: 'f_inactive', zoneCode: 'F_OFF', name: 'Synthetic Closed Zone', type: 'POLYGON', status: 'INACTIVE',
        category: 'TEST', surcharge: 500, surgeMultiplier: 3.0, coordinates: TRI },
      // A row that cannot be tested at all: no radius and no ring.
      { id: 'f_malformed', zoneCode: 'F_BAD', name: 'Synthetic Broken Zone', type: 'CIRCLE', status: 'ACTIVE',
        category: 'TEST', surcharge: 999, surgeMultiplier: 2.5, coordinates: [] },
      { id: 'f_elsewhere', zoneCode: 'F_FAR', name: 'Synthetic Far Zone', type: 'POLYGON', status: 'ACTIVE',
        category: 'TEST', surcharge: 12, surgeMultiplier: 1.1, coordinates: [
          { lat: 12.90, lng: 77.55 }, { lat: 12.92, lng: 77.58 }, { lat: 12.88, lng: 77.58 }
        ] }
    ],
    rules: [
      { id: 'r_tri', zoneId: 'f_tri', zoneName: 'Synthetic Sector', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 1.4, maxMultiplier: 2.0, priority: 'HIGH', startTime: null, endTime: null },
      // A second active rule on the same boundary: which one wins is a decision,
      // so the engine keeps the platform's existing answer and reports the clash.
      { id: 'r_tri_copy', zoneId: 'f_tri', zoneName: 'Synthetic Sector', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 1.9, maxMultiplier: 2.0, priority: 'HIGH', startTime: null, endTime: null },
      { id: 'r_unbound', zoneId: null, zoneName: 'Synthetic Platform Rule', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 1.3, maxMultiplier: 1.5, priority: 'MEDIUM', startTime: null, endTime: null },
      { id: 'r_expired', zoneId: 'f_circle', zoneName: 'Synthetic Ring', service: 'RIDE', status: 'ACTIVE',
        surgeMultiplier: 2.8, maxMultiplier: 3.0, priority: 'HIGH', startTime: '01:00', endTime: '01:30' },
      { id: 'r_off', zoneId: 'f_elsewhere', zoneName: 'Synthetic Far Zone', service: 'ALL', status: 'INACTIVE',
        surgeMultiplier: 2.2, maxMultiplier: 3.0, priority: 'LOW', startTime: null, endTime: null }
    ],
    global: 1.0,
    state: { fences: 'VALIDATED', rules: 'VALIDATED', source: 'synthetic' }
  };
}

function groupC() {
  console.log('\n--- C. Policy engine over a controlled store (Phases 1, 2, 3, 7) ---');

  const store = makeStore();
  geoPolicy.bind({
    fences: () => store.fences,
    rules: () => store.rules,
    globalSurgeMultiplier: () => store.global,
    storeState: () => store.state
  });

  const inside = geoPolicy.evaluate({
    latitude: INSIDE_TRI.lat, longitude: INSIDE_TRI.lng, service: 'RIDE', operation: 'QUOTE'
  });
  check('GEO-C01', inside.locationValidated === true && inside.insideServiceArea === true &&
    inside.matchedFences.length === 1 && inside.activeZoneName === 'Synthetic Sector' &&
    inside.totalSurcharge === 20,
    `one boundary matched for a point inside two copies of it (matched=${inside.matchedFences.length}, surcharge=${inside.totalSurcharge}, zone="${inside.activeZoneName}")`);

  check('GEO-C02', inside.nonApplicable.duplicateShapesExcluded === 1 &&
    inside.nonApplicable.inactiveFences >= 1 && inside.nonApplicable.malformedFences === 1,
    `the rows that did not apply are counted, not silently averaged in (duplicate=${inside.nonApplicable.duplicateShapesExcluded}, inactive=${inside.nonApplicable.inactiveFences}, malformed=${inside.nonApplicable.malformedFences})`);

  // Runaway protection: three fences cover this point — two copies of one and an
  // inactive one. The worst answer is the single highest legitimate multiplier,
  // and the surcharge is counted once per distinct boundary.
  check('GEO-C03', inside.effectiveSurgeMultiplier === 1.4 && inside.totalSurcharge === 20,
    `duplicate rows cannot compound price (multiplier=${inside.effectiveSurgeMultiplier}, surcharge=${inside.totalSurcharge})`);

  check('GEO-C04', inside.applicableSurgeRules.length === 1 &&
    inside.applicableSurgeRules[0].id === 'r_tri' &&
    inside.nonApplicable.duplicateRulesExcluded === 1,
    'a rule written twice for one boundary is applied once, and the exclusion is reported');

  const outside = geoPolicy.evaluate({
    latitude: OUTSIDE.lat, longitude: OUTSIDE.lng, service: 'RIDE', operation: 'QUOTE'
  });
  check('GEO-C05', outside.insideServiceArea === false && outside.matchedFences.length === 0 &&
    outside.activeZoneName === null && outside.totalSurcharge === 0,
    `an outside point matches nothing and is named nothing (zone="${outside.activeZoneName}")`);

  check('GEO-C06', outside.platformWideSurgeRule?.basis === 'STATUS_ONLY' &&
    outside.nonApplicable.activeRulesWithoutContainment >= 1,
    `a rule applied to a point outside its zone is labelled, not hidden (basis=${outside.platformWideSurgeRule?.basis}, uncontained active rules=${outside.nonApplicable.activeRulesWithoutContainment})`);

  const forged = geoPolicy.evaluate({
    latitude: OUTSIDE.lat, longitude: OUTSIDE.lng, service: 'RIDE', operation: 'RIDE_CREATE',
    requestedZoneId: 'f_tri'
  });
  check('GEO-C07', forged.requestedZoneIdIgnored === true && forged.totalSurcharge === 0 &&
    forged.matchedFences.length === 0 && forged.effectiveSurgeMultiplier === outside.effectiveSurgeMultiplier,
    `a client-named zone cannot move price: standing outside and asking for "f_tri" changes nothing (surcharge=${forged.totalSurcharge})`);

  const foodQuote = geoPolicy.evaluate({
    latitude: INSIDE_TRI.lat, longitude: INSIDE_TRI.lng, service: 'FOOD', operation: 'QUOTE'
  });
  check('GEO-C08', foodQuote.applicableSurgeRules.length === 0 &&
    foodQuote.effectiveSurgeMultiplier === 1.2 && foodQuote.totalSurcharge === 20,
    `a rule written for RIDE cannot price a FOOD quote at 1.4x: the boundary's own 1.2 applies (multiplier=${foodQuote.effectiveSurgeMultiplier})`);

  const expired = geoPolicy.evaluate({
    latitude: 28.5562, longitude: 77.1000, service: 'RIDE', operation: 'QUOTE',
    timestamp: '2026-09-23T09:00:00Z'
  });
  const expiredRule = (expired.applicableSurgeRules || []).find(r => r.id === 'r_expired');
  const expiredReported = (expired.nonApplicable.rulesOutsideWindow || [])
    .find(r => r.id === 'r_expired');
  check('GEO-C09', expiredReported?.code && expiredRule?.window?.inWindow === false &&
    expiredRule.wouldApplyIfEnforced === false,
    `a rule whose window has passed is named with a reason code and its in/out-of-window state, and the price it would move if windows bound is stated (code=${expiredReported?.code}, multiplier=${expired.effectiveSurgeMultiplier})`);

  const inventory = geoPolicy.inventory();
  // Three of the six rows are the same triangle (the active one, its rotated
  // copy, and the closed one), one cannot be tested at all, and a rule with no
  // boundary can never be contained. Counting them is the point: an operator
  // maintaining zones has to be able to see the pile.
  check('GEO-C10', inventory.duplicatedFenceShapes === 1 && inventory.duplicateFenceRows === 2 &&
    inventory.malformedFenceCount === 1 && inventory.activeRulesWithoutZoneBinding === 1 &&
    inventory.distinctFenceShapes === 3 && inventory.inactiveFenceCount === 1,
    `the store's own shape is reportable (fences=${inventory.fenceCount}, distinct=${inventory.distinctFenceShapes}, duplicate rows=${inventory.duplicateFenceRows}, malformed=${inventory.malformedFenceCount}, inactive=${inventory.inactiveFenceCount}, unbound active rules=${inventory.activeRulesWithoutZoneBinding})`);

  // The fail-closed half. The seed arrays are still in memory here — this is the
  // exact condition that used to answer "inside" from a copy taken before the
  // outage — and the engine must still refuse.
  store.state = { fences: 'UNREADABLE', rules: 'UNREADABLE', source: 'postgres' };
  const down = geoPolicy.evaluate({
    latitude: INSIDE_TRI.lat, longitude: INSIDE_TRI.lng, service: 'RIDE', operation: 'RIDE_CREATE',
    requestedZoneId: 'f_tri'
  });
  const downText = JSON.stringify(down);
  check('GEO-C11', down.rejectionReason?.code === REASON.STORE_UNAVAILABLE &&
    down.validCoordinates === true && down.locationValidated === false &&
    down.insideServiceArea === false && down.matchedFences.length === 0 &&
    down.effectiveSurgeMultiplier === 1.0 && down.totalSurcharge === 0 &&
    down.activeZoneName === null && down.requestedZoneIdIgnored === true,
    `with the store unreadable, a point inside a known boundary and a zone name from the client produce no location claim at all (code=${down.rejectionReason?.code})`);
  check('GEO-C12', /Standard Operational/i.test(downText) === false &&
    /Synthetic/i.test(downText) === false,
    'no placeholder name and no remembered boundary appears as proof of a validated location');

  const noLocation = geoPolicy.evaluate({ service: 'RIDE', operation: 'QUOTE' });
  check('GEO-C13', noLocation.coordinatesSupplied === false && noLocation.rejectionReason === null &&
    noLocation.locationValidated === false,
    'a quote with no coordinates is its own case: not a failure, not a validated location');

  store.state = { fences: 'VALIDATED', rules: 'VALIDATED', source: 'synthetic' };
}

// ---------------------------------------------------------------------------
// D. The public API against the live local store
// ---------------------------------------------------------------------------
async function groupD() {
  console.log('\n--- D. Public routes against the running backend (Phases 2, 3, 5) ---');

  // The same local fixture test_suite.js uses, because geofence.view is the only
  // way to read the inventory this file checks in GEO-D08.
  await request('POST', LIVE_BASE, '/api/admin/bootstrap', {
    bootstrapSecret: 'local-secret-for-testing',
    username: 'superadmin',
    password: 'AdminPassword123!'
  });
  const login = await request('POST', LIVE_BASE, '/api/admin/login', {
    username: 'superadmin',
    password: 'AdminPassword123!'
  });
  const adminHeaders = login.data?.token ? { Authorization: `Bearer ${login.data.token}` } : {};
  check('GEO-D00', Boolean(login.data?.token), `an operations console session for the admin-only reads (${login.status})`);

  const inside = await request('POST', LIVE_BASE, '/api/pricing/estimate', {
    serviceType: '4W', distanceKm: 10, durationMins: 25, pickupLat: 28.5562, pickupLng: 77.1000
  });
  const insideEstimate = inside.data?.estimate || {};
  check('GEO-D01', inside.status === 200 && insideEstimate.geoValidation?.status === 'VALIDATED_INSIDE' &&
    insideEstimate.matchedGeofence !== null && typeof insideEstimate.activeZoneName === 'string' &&
    insideEstimate.activeZoneName.length > 0,
    `a healthy store and a point inside a boundary answer 200 with the zone it matched (status=${insideEstimate.geoValidation?.status}, zone="${insideEstimate.activeZoneName}")`);

  const outside = await request('POST', LIVE_BASE, '/api/pricing/estimate', {
    serviceType: '3W', distanceKm: 5, durationMins: 15,
    pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng
  });
  const outsideEstimate = outside.data?.estimate || {};
  check('GEO-D02', outside.status === 200 && outsideEstimate.geoValidation?.status === 'VALIDATED_OUTSIDE' &&
    outsideEstimate.matchedGeofence === null && outsideEstimate.activeZoneName === null,
    `a point outside every boundary says so, and names no zone (status=${outsideEstimate.geoValidation?.status}, zone=${JSON.stringify(outsideEstimate.activeZoneName)})`);

  // A zone id the client types used to be a second door into pricing.
  const zones = await request('GET', LIVE_BASE, '/api/admin/geofences', null, adminHeaders);
  const realId = zones.data?.geoFences?.find(f => f.type === 'CIRCLE')?.id || 'zone_that_does_not_exist';
  const forgedOutside = await request('POST', LIVE_BASE, '/api/pricing/estimate', {
    serviceType: '3W', distanceKm: 5, durationMins: 15,
    pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng, zoneId: realId
  });
  const forgedEstimate = forgedOutside.data?.estimate || {};
  check('GEO-D03', forgedOutside.status === 200 &&
    forgedEstimate.geoValidation?.requestedZoneIdIgnored === true &&
    forgedEstimate.customerCharge === outsideEstimate.customerCharge &&
    forgedEstimate.surgeMultiplier === outsideEstimate.surgeMultiplier,
    `the same fare with and without a real zone id attached (₹${forgedEstimate.customerCharge} vs ₹${outsideEstimate.customerCharge}, ignored=${forgedEstimate.geoValidation?.requestedZoneIdIgnored})`);

  const cases = [
    ['string', { pickupLat: 'abc', pickupLng: '77.10' }, REASON.INVALID_COORDINATES],
    ['empty string', { pickupLat: '', pickupLng: '' }, REASON.INVALID_COORDINATES],
    ['out of range', { pickupLat: 999, pickupLng: -999 }, REASON.OUT_OF_RANGE],
    ['half pair', { pickupLat: 28.5562 }, REASON.INVALID_COORDINATES],
    ['NaN', { pickupLat: 'NaN', pickupLng: 77.1 }, REASON.INVALID_COORDINATES],
    ['infinities', { pickupLat: 'Infinity', pickupLng: '-Infinity' }, REASON.INVALID_COORDINATES],
    ['object', { pickupLat: { lat: 28.5 }, pickupLng: [77.1] }, REASON.INVALID_COORDINATES]
  ];
  for (const [label, coords, expectedCode] of cases) {
    const quote = await request('POST', LIVE_BASE, '/api/pricing/estimate', {
      serviceType: '3W', distanceKm: 5, durationMins: 15, ...coords
    });
    const evaluate = await request('POST', LIVE_BASE, '/api/geofence/evaluate', {
      lat: coords.pickupLat, lng: coords.pickupLng, serviceType: 'RIDE'
    });
    check(`GEO-D04[${label}]`, quote.status === 400 && quote.data?.code === expectedCode &&
      evaluate.status === 400 && evaluate.data?.code === expectedCode &&
      quote.data?.pricingAvailable === false && quote.data?.estimate === undefined,
      `estimate and evaluate both refuse ${label} input with ${expectedCode} (got ${quote.data?.code}/${evaluate.data?.code})`);
  }

  const noCoords = await request('POST', LIVE_BASE, '/api/pricing/estimate', {
    serviceType: '3W', distanceKm: 5, durationMins: 15
  });
  check('GEO-D05', noCoords.status === 200 &&
    noCoords.data?.estimate?.geoValidation?.status === 'NOT_PROVIDED' &&
    noCoords.data?.estimate?.activeZoneName === null,
    `the documented no-location quote stays available and is labelled, not validated (status=${noCoords.data?.estimate?.geoValidation?.status})`);

  const zero = await request('POST', LIVE_BASE, '/api/geofence/evaluate', { lat: 0, lng: 0, serviceType: 'RIDE' });
  check('GEO-D06', zero.status === 200 && zero.data?.locationValidated === true &&
    zero.data?.inside === false,
    'latitude 0 is a real coordinate, evaluated honestly rather than mistaken for a missing value');

  const evaluateShape = await request('POST', LIVE_BASE, '/api/geofence/evaluate', {
    lat: 28.5562, lng: 77.1000, serviceType: 'RIDE'
  });
  const evaluateText = JSON.stringify(evaluateShape.data);
  check('GEO-D07', evaluateShape.status === 200 &&
    /"coordinates":\s*\[\{/.test(evaluateText) === false &&
    /center_lat|centre|vertices|description|operating_hours|created_by/.test(evaluateText) === false &&
    Array.isArray(evaluateShape.data?.matchedZones) &&
    (evaluateShape.data.matchedZones || []).every(z => z.coordinates === undefined),
    'the tokenless evaluate route answers a verdict about one point, not a copy of the boundary that produced it');

  const inventory = await request('GET', LIVE_BASE, '/api/admin/geofences', null, adminHeaders);
  const live = inventory.data?.inventory || {};
  check('GEO-D08', inventory.status === 200 && live.storeState?.fences === 'VALIDATED' &&
    live.fenceCount > 0 && typeof live.duplicateFenceRows === 'number' &&
    typeof live.malformedFenceCount === 'number' &&
    typeof live.activeRulesWithoutZoneBinding === 'number',
    `the admin surface can see its own store (fences=${live.fenceCount}, active=${live.activeFenceCount}, malformed=${live.malformedFenceCount}, duplicate rows=${live.duplicateFenceRows}, unbound active rules=${live.activeRulesWithoutZoneBinding})`);

  const anonymous = await request('GET', LIVE_BASE, '/api/admin/geofences');
  check('GEO-D09', anonymous.status === 401,
    `and that inventory is behind geofence.view, not on the public route (${anonymous.status})`);

  // Phase 8's rule for geometry binds the name of a boundary too: what an
  // operator submits is what gets stored, or nothing does. The column is
  // `varchar(40)`, so an over-long code used to fail *after* the insert was
  // attempted — which the route reported as a 503 store failure, pointing an
  // operator at the database for a mistake in their own text box.
  const namedCode = `GEO_D10_${Date.now().toString(36).toUpperCase()}`;
  const fence = { type: 'POLYGON', coordinates: TRI, surcharge: 1 };
  const named = await request('POST', LIVE_BASE, '/api/admin/geofences', {
    ...fence, name: `GeoPolicy Named Boundary ${namedCode}`, code: namedCode
  }, adminHeaders);
  const namedId = named.data?.geoFence?.id || null;
  const tooLong = await request('POST', LIVE_BASE, '/api/admin/geofences', {
    ...fence, name: 'GeoPolicy Over-long Code', code: 'X'.repeat(45)
  }, adminHeaders);
  const blank = await request('POST', LIVE_BASE, '/api/admin/geofences', {
    ...fence, name: 'GeoPolicy Blank Code', code: '   '
  }, adminHeaders);
  if (namedId) await request('DELETE', LIVE_BASE, `/api/admin/geofences/${namedId}`, null, adminHeaders);
  check('GEO-D10', named.status === 200 && named.data?.geoFence?.zoneCode === namedCode &&
    tooLong.status === 400 && tooLong.data?.code === REASON.ZONE_CODE_INVALID &&
    blank.status === 400 && blank.data?.code === REASON.ZONE_CODE_INVALID,
    `a zone code an operator names is stored exactly as named (${JSON.stringify(named.data?.geoFence?.zoneCode)}), ` +
    `while one too long or blank is refused with ${REASON.ZONE_CODE_INVALID} (${tooLong.status}/${blank.status}) ` +
    'instead of being silently shortened to a prefix');
}

// ---------------------------------------------------------------------------
// E. A backend that cannot read its geo store
// ---------------------------------------------------------------------------
//
// The child runs the real server against a closed port, so hydration of
// geo_fences fails the way it fails in an outage. The parent only ever sees a
// verdict line, which keeps this file honest: nothing here pretends to be the
// store while it is testing what happens when the store is gone.
async function waitForServer(base, attempts = 100) {
  for (let i = 0; i < attempts; i++) {
    const res = await request('POST', base, '/api/pricing/estimate', { serviceType: '3W', distanceKm: 5, durationMins: 15 });
    if (res.status !== 0) return true;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  return false;
}

function spawnOutageChild() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'src', 'server.js')], {
      cwd: __dirname,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(OUTAGE_PORT),
        SUPABASE_URL: 'http://127.0.0.1:59998',
        SUPABASE_ANON_KEY: 'local-only-unreachable-key',
        SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let log = '';
    const collect = (buf) => {
      log += buf.toString();
      if (log.length > 200000) log = log.slice(-100000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    waitForServer(OUTAGE_BASE).then(async (up) => {
      const verdict = { up, log };
      if (up) {
        const inside = INSIDE_TRI;
        verdict.quoteInside = await request('POST', OUTAGE_BASE, '/api/pricing/estimate', {
          serviceType: '4W', distanceKm: 10, durationMins: 25, pickupLat: inside.lat, pickupLng: inside.lng
        });
        verdict.quoteOutside = await request('POST', OUTAGE_BASE, '/api/pricing/estimate', {
          serviceType: '4W', distanceKm: 10, durationMins: 25, pickupLat: OUTSIDE.lat, pickupLng: OUTSIDE.lng
        });
        verdict.quoteForged = await request('POST', OUTAGE_BASE, '/api/pricing/estimate', {
          serviceType: '4W', distanceKm: 10, durationMins: 25,
          pickupLat: inside.lat, pickupLng: inside.lng, zoneId: 'f_tri'
        });
        verdict.evaluate = await request('POST', OUTAGE_BASE, '/api/geofence/evaluate', {
          lat: inside.lat, lng: inside.lng, serviceType: 'RIDE'
        });
        verdict.invalid = await request('POST', OUTAGE_BASE, '/api/pricing/estimate', {
          serviceType: '4W', distanceKm: 10, durationMins: 25, pickupLat: 'abc', pickupLng: 77.1
        });
      }
      resolve(verdict);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000).unref();
    });
  });
}

async function groupE() {
  console.log('\n--- E. Store unreachable: the fail-closed proof (Phase 2) ---');

  const verdict = await spawnOutageChild();
  if (!verdict.up) {
    check('GEO-E00', false, 'a backend pointed at a closed port did not answer within 30s — the outage cases could not run');
    return;
  }

  for (const [label, res] of [['inside-looking', verdict.quoteInside], ['outside-looking', verdict.quoteOutside]]) {
    const text = res.text || '';
    check(`GEO-E01[${label}]`, res.status === 503 && res.data?.code === REASON.STORE_UNAVAILABLE &&
      res.data?.pricingAvailable === false && res.data?.estimate === undefined &&
      /Standard Operational/i.test(text) === false &&
      /relation|PostgreSQL|PostgREST|does not exist|ECONNREFUSED/i.test(text) === false,
      `a ${label} point during an outage answers 503 ${REASON.STORE_UNAVAILABLE} with no fare and no internal detail (status=${res.status}, code=${res.data?.code})`);
  }

  check('GEO-E02', verdict.quoteForged.status === 503 &&
    verdict.quoteForged.data?.code === REASON.STORE_UNAVAILABLE &&
    verdict.quoteForged.data?.estimate === undefined,
    'a client-supplied zone id cannot rescue a quote the store cannot vouch for');

  check('GEO-E03', verdict.evaluate.status === 503 &&
    verdict.evaluate.data?.code === REASON.STORE_UNAVAILABLE &&
    verdict.evaluate.data?.inside === undefined,
    `the public evaluate route reports unavailability instead of the remembered answer (status=${verdict.evaluate.status})`);

  check('GEO-E04', verdict.invalid.status === 400 &&
    [REASON.INVALID_COORDINATES, REASON.OUT_OF_RANGE].includes(verdict.invalid.data?.code),
    `nonsense coordinates are still a 400 about the coordinates, not a 503 about the store (status=${verdict.invalid.status}, code=${verdict.invalid.data?.code})`);

  check('GEO-E05', /geo_fences and surge_zones were not read|geo_fences could not be read/.test(verdict.log) === true,
    'and the operator log says geography specifically failed, rather than a 503 arriving from nowhere');

  // Phase 12's row M asks the same question of the booking route: can a ride
  // become real while the validator cannot answer? A child that cannot read the
  // geo store cannot read the session store either — that is the same fail-closed
  // decision, one layer up — so no customer token exists to book with. What that
  // proves about the route is that no door through it stays open during an
  // outage; what it cannot prove is the geo refusal specifically, so the wiring
  // is asserted structurally below, and the behavioural half is asserted here.
  const outageBooking = await request('POST', OUTAGE_BASE, '/api/customer/book-ride', {
    vehicleType: '3W',
    pickup: { address: 'Synthetic Sector', lat: INSIDE_TRI.lat, lng: INSIDE_TRI.lng },
    drop: { address: 'Elsewhere', lat: OUTSIDE.lat, lng: OUTSIDE.lng }
  }, { Authorization: 'Bearer a-token-the-outage-cannot-verify' });
  check('GEO-E06', outageBooking.status !== 200 && !outageBooking.data?.job,
    `a ride cannot be booked during an outage by any door: ${outageBooking.status} ` +
    `(${outageBooking.data?.code || outageBooking.data?.error || 'no job'})`);

  const source = require('fs').readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  const handlerOf = (route) => {
    const start = source.indexOf(route);
    const next = source.indexOf("\napp.", start + route.length);
    return start === -1 ? '' : source.slice(start, next === -1 ? start + 6000 : next);
  };
  const ride = handlerOf("app.post('/api/customer/book-ride'");
  const parcel = handlerOf("app.post('/api/customer/book-parcel'");
  const food = handlerOf("app.post('/api/customer/book-food'");
  check('GEO-E07', ride.includes('replyGeoRefusal(res, req, basePricing.geoValidation.refusal)'),
    'the ride route translates the engine refusal with the same helper the quote uses, so a booking ' +
    'cannot invent its own idea of what an unvalidated location is worth');
  // Recorded gap, not a passing guarantee. Parcel prices from a three-field input
  // with no coordinate in it; food never reaches the fare engine at all. Neither
  // can produce a geographic refusal today, which is what makes the gap provable
  // rather than a matter of reading a request body and hoping. Whether either
  // route must be inside a service area is §14 decision 1 and is NOT DECIDED here.
  const parcelInput = /const parcelPricingInput = \{([\s\S]*?)\}/.exec(parcel);
  check('GEO-E08', parcel.includes('db.calculateFareEstimate(parcelPricingInput)') &&
    !!parcelInput && !/[Ll]at|[Ll]ng/.test(parcelInput[1]) &&
    !food.includes('calculateFareEstimate'),
    'parcel prices through the engine from an input carrying no coordinate, and food does not reach the ' +
    'engine at all, so no geographic refusal can arise on either route (recorded, not fixed)');

  // Phase 11's outage row, same shape as GEO-E06: the driver's position route is
  // the only geo-adjacent door on that path, and an unreachable store closes it
  // for the same reason it closes the ride — the session cannot be read.
  const outageLocation = await request('POST', OUTAGE_BASE, '/api/driver/location',
    { lat: INSIDE_TRI.lat, lng: INSIDE_TRI.lng }, { Authorization: 'Bearer a-driver-token-the-outage-cannot-verify' });
  check('GEO-E09', outageLocation.status !== 200 && !outageLocation.data?.telemetryStored,
    `a driver cannot store a position during an outage by any door: ${outageLocation.status} ` +
    `(${outageLocation.data?.code || outageLocation.data?.error || 'nothing stored'})`);
}

async function main() {
  const health = await request('GET', LIVE_BASE, '/api/health');
  if (health.status === 0) {
    console.error(`The local backend must be running on ${LIVE_BASE} for groups D and E (${health.text}).`);
    process.exit(2);
  }

  groupA();
  groupB();
  groupC();
  await groupD();
  await groupE();

  // Group C replaced the bound source with its synthetic store. Re-hydration of
  // the real one belongs to the server process, not this one, so say plainly
  // what this file did to its own module state.
  console.log('\n   (group C binds a synthetic store inside this test process only; the backend keeps its own)');

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 GEO POLICY: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  for (const failure of failed) console.log(`   ✗ ${failure.id}: ${failure.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('GEO POLICY ABORTED:', err.stack || err.message);
  process.exit(3);
});
