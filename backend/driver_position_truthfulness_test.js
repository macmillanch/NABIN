'use strict';

// =========================================================================
// DRIVER POSITION TRUTHFULNESS — #481
//
// A driver whose position is unknown was served a position it never had. Three
// production sites substitute the Delhi sentinel for a missing coordinate, and one
// of them PERSISTS it:
//   - src/repositories/DriverRepository.js:177-178  create() writes
//     `current_lat: driverData.currentLocation?.lat || 28.6139` into the insert
//     payload, so a driver created without a position gets a durable row claiming
//     28.6139, 77.2090. This is the only durable writer of the sentinel.
//   - src/repositories/DriverRepository.js:83-87    mapRowToDriver() reads a NULL
//     coordinate back as the same pair and labels it `area: 'Delhi Operations
//     Zone'`.
//   - src/database.js:1898-1902                     initPostgres()'s driver
//     hydration maps the fleet mirror the same way, so every boot re-claims a
//     Delhi position for all 1,916 durable-NULL drivers.
// `current_lat`/`current_lng` are nullable with NO DEFAULT (supabase/migrations/
// 001_central_schema.sql:62), so durable NULL is the schema's own answer to
// "position unknown" — filling it in is a code defect, not a data policy.
//
// The read/write paths that must NOT change: `updateLocation()` is the only
// legitimate durable GPS writer and must keep persisting exactly what the device
// reported, including `last_heartbeat`; `update()` never sends coordinates and
// must not start to; the telemetry route keeps its driver-scoped validation and
// the fleet/ride broadcasts keep their existing channels.
//
// Deliberately NOT asserted here, and recorded as NOT MEASURED with the reason:
//   - GAP-DIST-01: `dispatch_offers.distance_to_pickup NUMERIC(8,2) DEFAULT 0.00`
//     (supabase/migrations/014_dispatch_domain.sql:16) has zero writers, so an
//     offer row claims "0.00 km to pickup" for every driver. That is a schema
//     default needing a migration decision, not a code fallback this suite can pin.
//   - GAP-MOCK-01: the in-memory demo fleet (src/database.js:409 and the admin
//     console's own seed records) carries Delhi coordinates as mock-layer demo
//     data. Removing demo seeds is issue #156/#157 and an owner decision.
//
// This suite also never rewrites history: the 416 pre-existing sentinel rows in
// the clone are asserted to be LEFT ALONE (G4). The repair is a separate,
// reviewed script with its own dry-run default.
//
// Runs only on the disposable isolated lane (`scripts/with_local_target.js` +
// `scripts/lane_check.js`), because `drivers` is a census-protected table. It
// refuses a non-loopback target before any socket opens. It calls no PostgreSQL
// function: RPCs are pinned to `SET search_path = public` in their own definitions,
// so an isolated link that reached one would write a SHARED table — which is why
// the dispatch case below is proven by source scan and footprint, not by creating
// an offer row.
// =========================================================================

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'driver_position_truthfulness_test' });

const STAMP = Date.now();
const SENTINEL_LAT = 28.6139;
const SENTINEL_LNG = 77.2090;
const SENTINEL_AREA = 'Delhi Operations Zone';
// A durable position that is provably not the sentinel, so a blanket "null every
// coordinate" edit cannot pass this suite.
const FIXTURE_LAT = 21.1546;
const FIXTURE_LNG = 79.0935;
// The device-reported fix written through the legitimate telemetry writer.
const TELEM_LAT = 22.5726;
const TELEM_LNG = 88.3639;
// The provenance signature measured on the local store before this suite existed:
// every sentinel row carries this name and plate, minted by the MI-4 fixture at
// test_suite.js:3766. Counted to prove this suite did not rewrite them.
const SENTINEL_SIGNATURE = "name = 'Unlinked M4 Driver' AND vehicle_number = 'DL01UNLINKED'";

const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) passed.push(name);
  else failed.push(name);
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
}
function notMeasured(id, why) {
  skipped.push(id);
  console.log(`NOT MEASURED  ${id} — ${why}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const isFixed = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
function claimsPosition(record) {
  const loc = record && record.currentLocation;
  return Boolean(loc && isFixed(loc.lat) && isFixed(loc.lng));
}
function claimsArea(record) {
  const loc = record && record.currentLocation;
  return Boolean(loc && typeof loc.area === 'string' && loc.area.trim().length > 0);
}
function servedSentinel(record) {
  const loc = record && record.currentLocation;
  return Boolean(loc && Number(loc.lat) === SENTINEL_LAT && Number(loc.lng) === SENTINEL_LNG);
}

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, raw: data }); } });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function bootServer({ port, request, attempts = 240, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0' },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; } catch { /* not up yet */ }
  }
  return proc;
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', { bootstrapSecret: BOOTSTRAP_SECRET, username: ADMIN_USER, password: ADMIN_PASSWORD, name: 'Driver Position Truthfulness Bootstrap Admin' });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

let pg = null;
async function countOf(table) {
  const r = await pg.query(`select count(*)::int as n from ${table}`);
  return r.rows[0].n;
}
async function durablePosition(id) {
  const r = await pg.query('select current_lat, current_lng, last_heartbeat from drivers where id = $1', [id]);
  if (!r.rows.length) return null;
  const row = r.rows[0];
  return {
    lat: row.current_lat === null ? null : Number(row.current_lat),
    lng: row.current_lng === null ? null : Number(row.current_lng),
    heartbeat: row.last_heartbeat,
  };
}
async function durablePositionMap() {
  const r = await pg.query('select id, current_lat, current_lng from drivers');
  return new Map(r.rows.map((row) => [String(row.id), row]));
}

const createdDriverIds = [];
async function insertDriver({ name, lat, lng }) {
  const id = crypto.randomUUID();
  await pg.query(
    `insert into drivers (id, name, phone, vehicle_type, vehicle_number, license_number,
                          rating, is_online, operational_status, wallet_balance,
                          current_lat, current_lng, last_heartbeat)
     values ($1,$2,$3,'4W',$4,null,5.00,false,'AVAILABLE',0.00,$5,$6,now())`,
    [id, name, `+91${STAMP}${createdDriverIds.length}`, `Z481${String(STAMP).slice(-6)}${createdDriverIds.length}`, lat, lng]);
  createdDriverIds.push(id);
  return id;
}

function positionViolations(mirror, byUuid) {
  const fabricated = [];
  const mismatched = [];
  let orphans = 0;
  for (const d of mirror) {
    const key = String(d.uuid || d.id);
    const row = byUuid.get(key);
    if (!row) { orphans += 1; continue; }
    const durableHasPos = row.current_lat !== null && row.current_lng !== null;
    if (!durableHasPos && claimsPosition(d)) {
      fabricated.push({ key, name: d.name, served: d.currentLocation });
    }
    if (durableHasPos && claimsPosition(d)
      && (Number(d.currentLocation.lat) !== Number(row.current_lat) || Number(d.currentLocation.lng) !== Number(row.current_lng))) {
      mismatched.push({ key, durable: [Number(row.current_lat), Number(row.current_lng)], served: [d.currentLocation.lat, d.currentLocation.lng] });
    }
  }
  return { fabricated, mismatched, orphans };
}

async function main() {
  const masked = (() => { try { const u = new URL(PG_TARGET.connectionString); return `${u.protocol}//${u.hostname}:${u.port}${u.pathname}`; } catch { return '(masked)'; } })();
  console.log('========================================================================');
  console.log('NABIN DRIVER POSITION TRUTHFULNESS TEST — #481');
  console.log(`  TARGET : ${masked} (loopback, proven by scripts/chain_target_guard.js)`);
  console.log(`  SUITE  : STAMP=${STAMP}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  // --- baselines taken BEFORE any mint, so the footprint check below can name exactly
  //     the rows this run added.
  const baseline = {
    drivers: await countOf('drivers'),
    jobs: await countOf('jobs'),
    orders: await countOf('orders'),
    dispatchOffers: await countOf('dispatch_offers'),
    sentinelRows: (await pg.query(`select count(*)::int as n from drivers where ${SENTINEL_SIGNATURE}`)).rows[0].n,
    nullCoordRows: (await pg.query('select count(*)::int as n from drivers where current_lat is null or current_lng is null')).rows[0].n,
  };
  console.log(`  durable baselines: ${JSON.stringify(baseline)}\n`);

  // --- fixtures written BEFORE anything reads the fleet, so both the in-process
  //     hydration and the child server's boot hydration see them as durable rows.
  const fxNoPos = await insertDriver({ name: `#481 positionless ${STAMP}`, lat: null, lng: null });
  const fxPos = await insertDriver({ name: `#481 positioned ${STAMP}`, lat: FIXTURE_LAT, lng: FIXTURE_LNG });
  const fxTelem = await insertDriver({ name: `#481 telemetry ${STAMP}`, lat: null, lng: null });

  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;
  const request = makeRequest(base);
  const bootPromise = bootServer({ port, request });

  // =====================================================================
  // GROUP B — boot hydration and the read map must not invent a position
  // =====================================================================
  console.log('--- GROUP B: hydration + read map (in-process, same code the server runs) ---');
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  assert('B0 the lane store is live PostgreSQL, so hydration is the real code path', Boolean(isLivePostgres && supabaseAdmin), { isLivePostgres });
  const db = require('./src/database');
  await db.initPostgres();
  const mirror = db.drivers || [];
  assert('B1 boot hydration loaded the fleet from the lane store', mirror.length > 0, { mirrorLength: mirror.length });

  const byUuid = await durablePositionMap();
  assert('B2 the durable fleet read is the same size class as the mirror', byUuid.size > 0, { durableRows: byUuid.size });

  const hydr = positionViolations(mirror, byUuid);
  assert('B3 no hydrated driver reports a position its durable row does not have',
    hydr.fabricated.length === 0,
    { violations: hydr.fabricated.length, baselineNullCoordRows: baseline.nullCoordRows, examples: hydr.fabricated.slice(0, 3) });
  assert('B4 no hydrated driver reports another position than its own durable coordinates',
    hydr.mismatched.length === 0,
    { violations: hydr.mismatched.length, examples: hydr.mismatched.slice(0, 3) });
  assert('B5 no hydrated driver claims an area label nothing derived',
    mirror.filter((d) => byUuid.has(String(d.uuid || d.id)) && claimsArea(d)).length === 0,
    { claimingArea: mirror.filter((d) => byUuid.has(String(d.uuid || d.id)) && claimsArea(d)).length });

  const noPosMirror = mirror.find((d) => String(d.uuid || d.id) === fxNoPos);
  assert('B6 the positionless fixture hydrates claiming no coordinate', Boolean(noPosMirror) && !claimsPosition(noPosMirror), { served: noPosMirror && noPosMirror.currentLocation });
  const posMirror = mirror.find((d) => String(d.uuid || d.id) === fxPos);
  assert('B7 the positioned fixture hydrates to exactly its own coordinates',
    Boolean(posMirror) && Number(posMirror.currentLocation?.lat) === FIXTURE_LAT && Number(posMirror.currentLocation?.lng) === FIXTURE_LNG,
    { served: posMirror && posMirror.currentLocation, durable: [FIXTURE_LAT, FIXTURE_LNG] });

  // A row that lands AFTER hydration goes through mapRowToDriver, not the boot loop.
  const fxLate = await insertDriver({ name: `#481 late ${STAMP}`, lat: null, lng: null });
  const late = await db.driverRepo.findByIdAsync(fxLate);
  assert('B8 findByIdAsync on a positionless row inserted after hydration invents nothing',
    Boolean(late) && !claimsPosition(late), { served: late && late.currentLocation });
  assert('B9 that read did not write the invented position back to the store',
    (await durablePosition(fxLate)).lat === null, { durable: await durablePosition(fxLate) });
  notMeasured('GAP-MOCK-01', `${hydr.orphans} mirror entries have no durable row: the in-memory demo fleet `
    + '(src/database.js:409 and the admin console seed records) carries Delhi coordinates as mock-layer demo data. '
    + 'This suite runs live PostgreSQL, where hydration is the path under test; deleting demo seeds is #156/#157, an owner decision.');

  // =====================================================================
  // GROUP A — the durable write path
  // =====================================================================
  console.log('\n--- GROUP A: create/update persist unknown position as unknown ---');
  const createUuid = crypto.randomUUID();
  const created = await db.driverRepo.create({
    uuid: createUuid,
    name: `#481 created ${STAMP}`,
    phone: `+91 98${String(STAMP).slice(-8)}4`,
    vehicleType: '4W',
    vehicleNumber: `Z481C${String(STAMP).slice(-6)}`,
  });
  createdDriverIds.push(createUuid);
  const createdDurable = await durablePosition(createUuid);
  assert('A1 creating a driver with no position leaves the durable coordinates NULL',
    createdDurable && createdDurable.lat === null && createdDurable.lng === null,
    { durable: createdDurable });
  assert('A2 the created record claims no position', Boolean(created) && !claimsPosition(created), { served: created && created.currentLocation });
  assert('A3 the created record claims no area', Boolean(created) && !claimsArea(created), { served: created && created.currentLocation });

  const renamed = await db.driverRepo.update(fxNoPos, { name: `#481 positionless renamed ${STAMP}` });
  const afterRename = await durablePosition(fxNoPos);
  assert('A4 updating unrelated fields cannot replace a missing position with the Delhi sentinel',
    afterRename && afterRename.lat === null && afterRename.lng === null, { durable: afterRename });
  assert('A5 that update did not put a coordinate claim on the in-memory record either',
    Boolean(renamed) && !claimsPosition(renamed), { served: renamed && renamed.currentLocation });

  const telemBefore = await durablePosition(fxTelem);
  const telemHeartbeatBefore = telemBefore && telemBefore.heartbeat ? new Date(telemBefore.heartbeat).getTime() : 0;
  const updatedLoc = await db.driverRepo.updateLocation(fxTelem, { latitude: TELEM_LAT, longitude: TELEM_LNG });
  const telemAfter = await durablePosition(fxTelem);
  assert('A6 a legitimate GPS update persists exactly the reported coordinates',
    telemAfter && telemAfter.lat === TELEM_LAT && telemAfter.lng === TELEM_LNG,
    { before: telemBefore, after: telemAfter });
  assert('A7 a legitimate GPS update is returned accurately, not rounded through a default',
    Number(updatedLoc && updatedLoc.currentLocation && updatedLoc.currentLocation.lat) === TELEM_LAT
    && Number(updatedLoc && updatedLoc.currentLocation && updatedLoc.currentLocation.lng) === TELEM_LNG,
    { served: updatedLoc && updatedLoc.currentLocation });
  assert('A8 a legitimate GPS update still advances the freshness timestamp',
    telemAfter && new Date(telemAfter.heartbeat).getTime() >= telemHeartbeatBefore,
    { before: telemBefore && telemBefore.heartbeat, after: telemAfter && telemAfter.heartbeat });
  assert('A9 a legitimate fix carries no invented area label',
    !claimsArea(updatedLoc), { served: updatedLoc && updatedLoc.currentLocation });

  // =====================================================================
  // GROUP C — the admin projection over HTTP
  // =====================================================================
  console.log('\n--- GROUP C: API projections answer unknown as unknown ---');
  const proc = await bootPromise;
  const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('C0 the lane backend is up', health.status === 200, { status: health.status });
  const admin = await mintAdmin({ request });
  assert('C1 an admin session is minted', Boolean(admin.token), { status: admin.status, body: admin.body });

  const singleRes = await request('GET', `/api/admin/drivers/${fxNoPos}`, null, bearer(admin.token));
  const single = singleRes.data && singleRes.data.driver;
  assert('C2 GET /api/admin/drivers/:id answers 200 for the positionless fixture', singleRes.status === 200 && Boolean(single), { status: singleRes.status });
  assert('C3 the served positionless record carries no coordinate', Boolean(single) && !claimsPosition(single), { served: single && single.currentLocation });
  assert('C4 the served positionless record carries no area', Boolean(single) && !claimsArea(single), { served: single && single.currentLocation });

  const posRes = await request('GET', `/api/admin/drivers/${fxPos}`, null, bearer(admin.token));
  const posServed = posRes.data && posRes.data.driver;
  assert('C5 the positioned fixture is served exactly its durable coordinates',
    Number(posServed && posServed.currentLocation && posServed.currentLocation.lat) === FIXTURE_LAT
    && Number(posServed && posServed.currentLocation && posServed.currentLocation.lng) === FIXTURE_LNG,
    { status: posRes.status, served: posServed && posServed.currentLocation });

  const listRes = await request('GET', '/api/admin/drivers', null, bearer(admin.token));
  const servedList = (listRes.data && listRes.data.drivers) || [];
  const httpViolations = positionViolations(servedList, byUuid);
  assert('C6 no record in the fleet listing reports a position its durable row does not have',
    httpViolations.fabricated.length === 0,
    { violations: httpViolations.fabricated.length, served: servedList.length, examples: httpViolations.fabricated.slice(0, 3) });
  assert('C7 the fleet listing does not smear the sentinel over the unknown-position fleet',
    servedList.filter(servedSentinel).length <= baseline.sentinelRows,
    { sentinelClaimed: servedList.filter(servedSentinel).length, durableSentinelRows: baseline.sentinelRows });

  const noToken = await request('GET', '/api/admin/drivers');
  assert('C8 the admin guard on this read is unchanged: no bearer is refused', noToken.status === 401 || noToken.status === 403, { status: noToken.status });

  // =====================================================================
  // GROUP D — dispatch must not treat a missing location as a GPS fix
  // =====================================================================
  console.log('\n--- GROUP D: nothing position-derived enters dispatch ---');
  const scanned = ['src/server.js', 'src/database.js', 'src/repositories/DriverRepository.js', 'src/repositories/DispatchRepository.js']
    .map((rel) => ({ rel, lines: fs.readFileSync(path.join(__dirname, rel), 'utf8').split(/\r?\n/) }));
  const positionLines = [];
  for (const file of scanned) {
    file.lines.forEach((line, i) => {
      if (!/currentLocation|current_lat|fleetLocations/.test(line)) return;
      if (/distance|haversine|geoPolicy|tripDistance|nearby/i.test(line)) positionLines.push(`${file.rel}:${i + 1} ${line.trim().slice(0, 120)}`);
    });
  }
  assert('D1 no line that reads a driver position also computes a distance from it',
    positionLines.length === 0, { offenders: positionLines });

  const dispatchSource = fs.readFileSync(path.join(__dirname, 'src/repositories/DispatchRepository.js'), 'utf8');
  assert('D2 the dispatch offer row is built from the job and driver ids only',
    !/currentLocation|current_lat/.test(dispatchSource),
    { mentionsPosition: /currentLocation|current_lat/.test(dispatchSource) });

  const offersNow = await countOf('dispatch_offers');
  assert('D3 this suite wrote no dispatch offer row (no RPC reached the shared store)',
    offersNow === baseline.dispatchOffers, { offersNow, baseline: baseline.dispatchOffers });
  notMeasured('GAP-DIST-01', 'dispatch_offers.distance_to_pickup is `NUMERIC(8,2) DEFAULT 0.00` '
    + '(supabase/migrations/014_dispatch_domain.sql:16) and has ZERO writers, so every offer row claims "0.00 km to pickup" '
    + 'whatever the driver position is — including the positionless ones. Making it NULL-unless-computed is a schema '
    + 'migration decision (owner), not a code fallback this suite can pin.');

  // =====================================================================
  // GROUP E — location authorization and broadcast scope are unchanged
  // =====================================================================
  console.log('\n--- GROUP E: telemetry authorization + broadcast scope untouched ---');
  const anonTelemetry = await request('POST', '/api/driver/location', { lat: TELEM_LAT, lng: TELEM_LNG });
  assert('E1 POST /api/driver/location without a token is still refused', anonTelemetry.status === 401 || anonTelemetry.status === 403, { status: anonTelemetry.status });
  const anonFleet = await request('GET', '/api/fleet/locations');
  assert('E2 GET /api/fleet/locations without a token is still refused', anonFleet.status === 401 || anonFleet.status === 403, { status: anonFleet.status });

  const serverSource = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  assert('E3 driver telemetry still validates before writing',
    /validateDriverTelemetry/.test(serverSource), {});
  assert('E4 the anti-spoofing refusal is still in the telemetry path',
    /IDENTITY_SPOOFING_REJECTED/.test(serverSource), {});
  assert('E5 the fleet broadcast is still scoped to the admin channel',
    /channel:\s*'admin:fleet'/.test(serverSource), {});
  // server.js:783 derives the trip channel name; it is not passed as a `channel:` literal.
  assert('E6 ride/delivery location broadcasts are still per-job channels',
    /`ride:\$\{jobId\}`/.test(serverSource) && /`delivery:\$\{jobId\}`/.test(serverSource)
      && /broadcastRideLocation\(/.test(serverSource), {});

  // =====================================================================
  // GROUP F — the sentinel literal is gone from the position paths
  // =====================================================================
  console.log('\n--- GROUP F: no sentinel substitution left in the read/write paths ---');
  const repoSource = fs.readFileSync(path.join(__dirname, 'src/repositories/DriverRepository.js'), 'utf8');
  assert('F1 DriverRepository contains no coordinate fallback literal',
    !/28\.6139|77\.2090|Delhi Operations Zone/.test(repoSource),
    { matches: (repoSource.match(/28\.6139|77\.2090|Delhi Operations Zone/g) || []) });

  const dbSource = fs.readFileSync(path.join(__dirname, 'src/database.js'), 'utf8');
  const hydrationSlice = dbSource.slice(dbSource.indexOf('// 2. Hydrate Drivers'), dbSource.indexOf('// 3. Hydrate Jobs'));
  assert('F2 the driver hydration slice contains no coordinate fallback literal',
    hydrationSlice.length > 0 && !/28\.6139|77\.2090|Delhi Operations Zone/.test(hydrationSlice),
    { sliceLength: hydrationSlice.length, matches: (hydrationSlice.match(/28\.6139|77\.2090|Delhi Operations Zone/g) || []) });

  const dashboardPath = path.join(__dirname, '..', 'admin_dashboard.html');
  const dash = fs.readFileSync(dashboardPath, 'utf8');
  const dashPatterns = ["|| 28.6139", "|| 77.2090", "|| 'Delhi NCR'", "|| 'Connaught Place Radial Corridor, New Delhi'"];
  assert('F3 the admin console paints no Delhi fallback for a driver with no position',
    dashPatterns.every((p) => !dash.includes(p)),
    { present: dashPatterns.filter((p) => dash.includes(p)) });

  // =====================================================================
  // GROUP G — footprint: this suite minted rows and rewrote no history
  // =====================================================================
  console.log('\n--- GROUP G: the fixtures are this run\'s only footprint ---');
  const driversNow = await countOf('drivers');
  assert('G1 exactly the drivers this run minted appeared',
    driversNow === baseline.drivers + createdDriverIds.length,
    { driversNow, baseline: baseline.drivers, created: createdDriverIds.length });
  assert('G2 this suite wrote no job row', (await countOf('jobs')) === baseline.jobs, { now: await countOf('jobs'), baseline: baseline.jobs });
  assert('G3 this suite wrote no order row', (await countOf('orders')) === baseline.orders, { now: await countOf('orders'), baseline: baseline.orders });
  const sentinelNow = (await pg.query(`select count(*)::int as n from drivers where ${SENTINEL_SIGNATURE}`)).rows[0].n;
  assert('G4 the pre-existing sentinel rows were left untouched, not swept to make a count clean',
    sentinelNow === baseline.sentinelRows, { sentinelNow, baseline: baseline.sentinelRows });
  const givenSentinel = (await pg.query(
    `select count(*)::int as n from drivers
      where id = any($1::uuid[]) and current_lat = ${SENTINEL_LAT} and current_lng = ${SENTINEL_LNG}`,
    [createdDriverIds])).rows[0].n;
  assert('G5 none of this run\'s own rows was given the sentinel', givenSentinel === 0, { offenders: givenSentinel });

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}   NOT MEASURED: ${skipped.length}`);
  if (failed.length) { console.log('Failed checks:'); for (const n of failed) console.log(`  - ${n}`); }
  if (skipped.length) { console.log('Not measured:'); for (const n of skipped) console.log(`  - ${n}`); }
  console.log(`DRIVER POSITION TRUTHFULNESS TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  void proc;
  process.exitCode = failed.length ? 1 : 0;
}

async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (createdDriverIds.length) {
      await pg.query('delete from drivers where id = any($1::uuid[])', [createdDriverIds]);
    }
    const left = await pg.query('select count(*)::int as n from drivers where id = any($1::uuid[])', [createdDriverIds]);
    console.log(`[cleanup] this run's driver rows still present: ${left.rows[0].n}`);
  } catch (e) {
    console.error('[CLEANUP FAILED] residue may remain:', e.message);
  }
  try { await pg.end(); } catch { /* already closed */ }
}

async function run() {
  try { await main(); }
  catch (err) { console.error('[FATAL] driver_position_truthfulness_test threw outside the assertion harness:', err); process.exitCode = 1; }
  finally { await cleanup(); }
  process.exit(process.exitCode || 0);
}

run();
