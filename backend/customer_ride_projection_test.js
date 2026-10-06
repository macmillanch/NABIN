'use strict';

/*
 * CUSTOMER RIDE PROJECTION — task #138.
 *
 * A customer's active-ride card is built from two server writes and nothing else: the
 * `DRIVER_ASSIGNED` broadcast and `GET /api/tracking/:jobId`. Both used to fill a gap with a
 * value nobody measured:
 *
 *   - `rating: driver.rating`, where `drivers.rating NUMERIC(3,2) DEFAULT 5.00`
 *     (001_central_schema.sql:58) and no reviews or ratings table exists anywhere in this
 *     schema. The card printed "★ 5.00" for a driver who has never been rated — the same
 *     ruling migration 034 made for `merchants.rating`.
 *   - a driver identity of `'Rajesh Kumar' / '+91 98101 22334'` whenever the driver row could
 *     not be resolved. The app offers that number to dial.
 *   - a position of `lat 28.6853, lng 77.2185, heading 90.0, speed 28.5` whenever no telemetry
 *     had been reported. Raw telemetry is never written to PostgreSQL, so "nothing reported"
 *     is the state of every freshly started process — in a Mizoram app, that pin is Delhi.
 *
 * `active_ride_screen.dart` already renders the absence of all three (`_driverRating` returns
 * '' for null, `_buildPositionPanel` gates on `hasPosition`), so the fix is entirely in the
 * projection. The customer contract is now: a real value or null.
 *
 * A fourth gap was found while proving the third. Once the fabricated pin came out, the position
 * that arrived still carried the whole fleet record with it — a second `driverId` spelling, the
 * `isOnline`/`status` the driver asserted themselves, and the name and phone the store defaults
 * (`updateDriverLocation` filled an unseen driver with `'Rajesh Kumar' / '+91 98101 22334'`, and
 * `+919810122910` is the number on that driver's row). Same for the live trip-channel push. The
 * customer's feeds now carry a position and its age; the identity comes from the driver row.
 *
 * What each kind of check here proves, and its limit:
 *   CT-01…CT-06 are behavioural over a durable job: the customer's `driver` object carries no
 *   rating field, the name and phone in it are that driver row's own columns rather than a
 *   substituted constant, a position the driver actually reports arrives intact, and what arrives
 *   with it is a position rather than the admin's fleet record.
 *   CT-07…CT-13 are source guards, the FD-10d precedent. A fabricated value is a property of the
 *   code that wrote it, and a live read against seeded data cannot distinguish a seeded value from
 *   a substituted one — so the tracking handler, the telemetry pushes, the fleet write and every
 *   customer assignment broadcast are pinned in the source that produces them.
 *   CT-14…CT-18 are the same ruling turned on the job row's *customer*, added by task #144, and
 *   mix both kinds: CT-14/15 read a durable row back, CT-16/18 pin the two projections and the
 *   booking route in their source.
 *
 * Task #144 closed the customer side of the row that this file used to defer. `POST
 * /api/customer/book-ride` booked `customerRating: user.rating`, and both job projections answered
 * an absent value with `5.0` — `users.rating` being the same kind of `DEFAULT 5.00` column with no
 * ratings table behind it as `drivers.rating`. So a driver's dispatch card and an admin's job read
 * showed a score for a passenger nobody had ever rated. The row carries none now, and the guard
 * below reads a row whose metadata *does* hold the stale 5.0, so the projection is proven to
 * shadow stored fabrication rather than merely to stop writing it.
 *
 * Still another slice's to adjudicate: `drivers.rating` on the Driver app's own reads, and
 * `driver_app_shell.dart`'s `'Customer / Guardian: ${job['customerName']} (${job['customerRating']})'`
 * — which reads two keys the dispatch payload does not send, so it already prints `(null)` for
 * every driver, and fixing that display is the Driver slice's work, not this row's.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.NABIN_TEST_BASE || process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(new URL(BASE).hostname)
  || !/^(?:127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('REFUSED: non-loopback target'); process.exit(1);
}

const OTP = process.env.NABIN_TEST_OTP || '7729';
const ADMIN = { username: 'superadmin', password: 'AdminPassword123!' };

let pass = 0; let fail = 0;
const check = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` -- ${String(d).slice(0, 160)}` : ''}`); };

const api = async (method, p, { body, token } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {}; try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, data };
};

const login = async (phone, role) => {
  const send = await api('POST', '/api/auth/send-otp', { body: { phone, role, purpose: 'LOGIN' } });
  const otp = (send.data && send.data.testOtp) || OTP;
  const verify = await api('POST', '/api/auth/verify-otp', { body: { phone, otp, role } });
  return (verify.data && verify.data.token) || null;
};

(async () => {
  const health = await api('GET', '/api/health');
  check('CT-00 backend is reachable and healthy', health.status === 200, `status ${health.status}`);
  if (health.status !== 200) { console.log('FATAL: backend not running'); process.exitCode = 1; return; }

  // A real, durable trip that already has a driver on it. Read-only: this suite never books,
  // assigns or moves money, so it leaves no residue for the chain to clean up.
  let pg = null;
  let row = null;
  let durableRows = [];
  let staleCount = 0;
  let pgErr = null;
  try {
    pg = new Client({ connectionString: PG });
    await pg.connect();
    const found = await pg.query(`
      SELECT j.id AS job_id, cu.phone AS customer_phone,
             j.metadata->>'customerName' AS stored_name,
             d.name AS driver_name, d.phone AS driver_column_phone,
             du.phone AS driver_login_phone
        FROM jobs j
        JOIN drivers d ON d.id = j.driver_id
        JOIN users cu ON cu.id = j.customer_id
        LEFT JOIN users du ON du.id = d.user_id
       WHERE j.driver_id IS NOT NULL
       ORDER BY j.updated_at DESC
       LIMIT 1`);
    row = found.rows[0] || null;
    // The durable rows behind CT-14/15, read through the same window the boot hydrator mirrors
    // (`database.js`, `// 3. Hydrate Jobs from PostgreSQL`): newest 200 by created_at. The
    // `stores_rating` column is what makes the score check mean something — rows booked while the
    // route still copied `users.rating` into the job keep that 5.0 in their metadata, so the
    // projection has to shadow a stored value, not merely stop writing a new one.
    const durable = await pg.query(`
      SELECT j.id, j.job_number,
             j.metadata->>'customerName' AS stored_name,
             (j.metadata->>'customerRating' IS NOT NULL) AS stores_rating
        FROM jobs j
       ORDER BY j.created_at DESC
       LIMIT 200`);
    durableRows = durable.rows;
    staleCount = durable.rows.filter((r) => r.stores_rating).length;
  } catch (err) {
    pgErr = err.message;
  } finally {
    if (pg) { try { await pg.end(); } catch (e) { /* already closed */ } }
  }

  check('CT-00b a durable assigned job is readable for the projection probe', !!row,
    row ? `job ${row.job_id}` : (pgErr || 'no jobs row with a driver_id'));

  if (row) {
    const custToken = await login(row.customer_phone, 'CUSTOMER');
    check('CT-01 the trip\'s own customer authenticates through the OTP flow', !!custToken,
      `phone ${row.customer_phone}`);

    if (custToken) {
      const track = await api('GET', `/api/tracking/${row.job_id}`, { token: custToken });
      check('CT-01b that customer can read the trip they own', track.status === 200 && track.data.success === true,
        `status ${track.status}`);

      const driver = track.data.driver;
      // The whole point of #138: no field in the payload a customer sees may be a DDL default
      // wearing a measurement. Absence is the honest state until a reviews table exists.
      check('CT-02 the driver a customer is shown carries no rating field at all',
        driver === null || (typeof driver === 'object' && !('rating' in driver)),
        JSON.stringify(driver));

      // And what it does carry is the row: not a name and a dialable number the route made up.
      check('CT-03 the identity in the payload is that driver row\'s own, or null',
        driver === null
        || (driver.name === row.driver_name && driver.phone === row.driver_column_phone),
        `row ${row.driver_name}/${row.driver_column_phone} served ${driver && driver.name}/${driver && driver.phone}`);

      // --- CT-04/05: a position the driver really reported must reach the customer ----------
      //
      // Removing the fabricated pin exposed why nobody had noticed it was missing: the report is
      // keyed by the authenticated driver's own id and the read is keyed by `jobs.driver_id`, a
      // uuid, so every real report missed and the route answered with the Delhi constant. Now
      // that the constant is gone that mismatch would have shown up as "the customer can never
      // see a position" — so the pair below is the part of this ruling that is a feature, not
      // just an honesty fix. It writes to the in-memory fleet map only; nothing is persisted.
      const REPORTED = { lat: 23.7285, lng: 92.7198 };
      const drvToken = row.driver_login_phone ? await login(row.driver_login_phone, 'DRIVER') : null;
      let servedLocation = track.data.location || null;
      if (drvToken) {
        const post = await api('POST', '/api/driver/location', {
          token: drvToken,
          body: Object.assign({}, REPORTED, { jobId: row.job_id, heading: 45, speed: 12.5, isOnline: true, serviceType: 'RIDE' })
        });
        check('CT-04 the assigned driver can report a position against their own trip',
          post.status === 200 && post.data.success === true, `status ${post.status} ${String(post.data.code || post.data.error || '').slice(0, 60)}`);
        const after = await api('GET', `/api/tracking/${row.job_id}`, { token: custToken });
        servedLocation = after.data.location || null;
        check('CT-05 the customer read returns the position that was reported, not a default',
          !!servedLocation && Number(servedLocation.lat) === REPORTED.lat && Number(servedLocation.lng) === REPORTED.lng,
          JSON.stringify(servedLocation));
      } else {
        check('CT-04 the assigned driver can report a position against their own trip', false,
          row.driver_login_phone ? 'driver OTP login failed' : 'no drivers.user_id login phone');
        check('CT-05 the customer read returns the position that was reported, not a default', false,
          'no driver session to report with');
      }

      // What arrives with the position is as much of a ruling as the position itself. The map row
      // is the admin's view of the vehicle: a second `driverId` spelling, the driver's own
      // self-asserted `isOnline`/`status`, a `serviceType`, and the name and phone the store used
      // to default to `'Rajesh Kumar' / '+91 98101 22334'`. The customer's driver identity already
      // arrives in `driver`; a fleet record pasted underneath it is a second, weaker answer.
      const FORBIDDEN_KEYS = ['name', 'phone', 'vehicleType', 'driverId', 'isOnline', 'status', 'serviceType', 'activeJobId'];
      check('CT-06 the location the customer is shown is a position, not a fleet record',
        servedLocation === null || Object.keys(servedLocation).every((k) => !FORBIDDEN_KEYS.includes(k)),
        servedLocation ? Object.keys(servedLocation).join(',') : 'null');
    } else {
      check('CT-01b that customer can read the trip they own', false, 'no customer session');
      check('CT-02 the driver a customer is shown carries no rating field at all', false, 'no customer session');
      check('CT-03 the identity in the payload is that driver row\'s own, or null', false, 'no customer session');
      check('CT-06 the location the customer is shown is a position, not a fleet record', false, 'no customer session');
    }
  }

  // --- source guards ------------------------------------------------------------------
  //
  // CT-04/05 prove a reported position arrives. They cannot prove the *absence* of a
  // substituted one, because a passing echo and a fabricated pin are the same shape from the
  // outside. So the substituted position and the substituted identity are pinned in the handler
  // that writes them, exactly as FD-10d pins the rating column out of the restaurant read.
  const src = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  // Comments are stripped before any of this, on purpose: the ruling these guards protect is
  // written down as prose that *quotes* the literals being retired. Grepping prose would make
  // the suite red for documenting itself, and green for a real regression hidden in a comment.
  const codeOnly = (text) => text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const serverCode = codeOnly(src);
  const trackStart = serverCode.indexOf("app.get(['/api/v1/tracking");
  const trackingHandler = trackStart === -1
    ? null
    : serverCode.slice(trackStart, serverCode.indexOf('\napp.', trackStart + 10));
  check('CT-07 the tracking handler is located in the shipped source', trackingHandler !== null,
    trackStart === -1 ? 'route registration not found' : `at offset ${trackStart}`);

  if (trackingHandler) {
    check('CT-08 no driver the route cannot resolve is given a made-up name or phone',
      !/Rajesh Kumar/.test(trackingHandler) && !/98101 22334/.test(trackingHandler),
      (trackingHandler.match(/'[^']*Rajesh[^']*'|'\+91[^']*'/g) || []).join(' '));
    check('CT-09 no missing telemetry is answered with the Delhi pin it used to invent',
      !/28\.6853/.test(trackingHandler) && !/77\.2185/.test(trackingHandler),
      (trackingHandler.match(/2\d\.\d{4}|7\d\.\d{4}/g) || []).join(' '));
  } else {
    check('CT-08 no driver the route cannot resolve is given a made-up name or phone', false, 'handler not found');
    check('CT-09 no missing telemetry is answered with the Delhi pin it used to invent', false, 'handler not found');
  }

  // The customer's telemetry arrives twice — the read above and a trip-channel push underneath it —
  // and both must answer with a position. `admin:fleet` is the one channel whose subject *is* the
  // whole vehicle, so it is excluded from this rather than pruned by it.
  const telemetryPushes = serverCode.split("type: 'DRIVER_LOCATION_UPDATE'").slice(1)
    .map((seg) => seg.slice(0, 420));
  const tripPushes = telemetryPushes.filter((seg) => !/admin:fleet/.test(seg));
  check('CT-10 every customer-facing telemetry push projects a position, not the fleet record',
    telemetryPushes.length >= 3 && tripPushes.length >= 2
    && tripPushes.every((seg) => /projectLocationForCustomer\(/.test(seg)),
    `${telemetryPushes.length} pushes found, ${tripPushes.length} to a trip channel`);

  // And the store itself: this is where the substituted identity was manufactured, on the way into
  // a record that is broadcast to the customer's channel. Sliced the way DRV-05 slices it.
  const dbCode = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'database.js'), 'utf8'));
  const fleetWriteStart = dbCode.indexOf('  updateDriverLocation(');
  const fleetWrite = fleetWriteStart === -1 ? null
    : dbCode.slice(fleetWriteStart, dbCode.indexOf('\n  getFleetLocations', fleetWriteStart));
  check('CT-11 the fleet write invents no identity and no vehicle for a driver it has not seen',
    fleetWrite !== null
    && !/Rajesh Kumar/.test(fleetWrite) && !/98101 22334/.test(fleetWrite)
    && !/vehicleType: existing\.vehicleType \|\|/.test(fleetWrite),
    fleetWrite === null ? 'updateDriverLocation not found'
      : (fleetWrite.match(/(name|phone|vehicleType):[^,\n]*/g) || []).join(' | '));

  // Every customer-facing `DRIVER_ASSIGNED` broadcast, scoped to its own call so the
  // driver-facing assignment response (which may show its own row) is not swept up in this.
  const assignedBroadcasts = serverCode
    .split('broadcastToCustomer(')
    .slice(1)
    .map((seg) => seg.slice(0, 600))
    .filter((seg) => /DRIVER_ASSIGNED/.test(seg));
  check('CT-12 the suite is guarding a real number of customer assignment broadcasts',
    assignedBroadcasts.length >= 2, `found ${assignedBroadcasts.length}`);
  check('CT-13 none of them hands the customer a schema default dressed up as a score',
    assignedBroadcasts.length >= 2 && assignedBroadcasts.every((seg) => !/rating/.test(seg)),
    assignedBroadcasts.map((s) => (s.match(/rating[^\n]*/) || [])[0]).filter(Boolean).join(' | '));

  // --- CT-14…CT-18: the customer's own score on the job row (task #144) --------------------
  //
  // `app.get('/api/admin/jobs')` serialises the store exactly as the projection built it, so it is
  // the read that answers what a job really carries about its passenger — the driver's dispatch
  // card and the admin's screens both render that. The seed jobs are in the same array, which is
  // why the fixture `customerRating: 5.0` came out of `database.js` with the projection: a
  // fixture that prints a score teaches every reader that a score is a thing NABIN holds.
  const adminLogin = await api('POST', '/api/admin/login', { body: ADMIN });
  const adminToken = adminLogin.data && adminLogin.data.token;
  const jobsRead = adminToken
    ? await api('GET', '/api/admin/jobs', { token: adminToken })
    : { status: 0, data: {} };
  const servedJobs = Array.isArray(jobsRead.data.jobs) ? jobsRead.data.jobs : [];
  const scored = servedJobs.filter((j) => j.customerRating !== null && j.customerRating !== undefined);

  check('CT-14 no job the platform serves carries a customer score',
    jobsRead.status === 200 && servedJobs.length > 0 && scored.length === 0,
    `${servedJobs.length} row(s) served, ${scored.length} with a score, ${staleCount} durable row(s) still `
    + `store the retired value in metadata — a zero there means this run could not prove the projection `
    + `shadows a stored 5.0, only that the writer is gone`);

  const byRowKey = new Map();
  for (const r of durableRows) {
    if (r.id) byRowKey.set(String(r.id), r);
    if (r.job_number) byRowKey.set(String(r.job_number), r);
  }
  const matched = servedJobs
    .map((j) => ({ job: j, row: byRowKey.get(String(j.uuid)) || byRowKey.get(String(j.id)) }))
    .filter((m) => m.row);
  const wrongName = matched.filter((m) => (m.job.customerName || null) !== (m.row.stored_name || null));
  check('CT-15 a served job names its customer with the name the row holds, or with none',
    matched.length > 0 && wrongName.length === 0,
    wrongName.length
      ? `${wrongName[0].job.id} served ${JSON.stringify(wrongName[0].job.customerName)} for stored `
        + `${JSON.stringify(wrongName[0].row.stored_name)}`
      : `${matched.length} of ${servedJobs.length} served row(s) traced to a durable job, each name its row's own or null`);

  const repoCode = codeOnly(fs.readFileSync(path.join(__dirname, 'src', 'repositories', 'JobRepository.js'), 'utf8'));
  const ratingLines = repoCode.match(/customerRating:[^\n]*/g) || [];
  const nameLines = repoCode.match(/customerName:[^\n]*/g) || [];
  check('CT-16 the job projection answers a customer score with null and a missing name with null',
    ratingLines.length > 0 && nameLines.length > 0
    && ratingLines.every((l) => /\bnull\b/.test(l)) && nameLines.every((l) => !/'Customer'/.test(l)),
    [...ratingLines, ...nameLines].map((s) => s.trim()).join(' | '));

  check('CT-17 the booking route books no score and no dispatch names a passenger nobody gave',
    !/customerRating:/.test(serverCode) && !/Rahul Sharma/.test(serverCode) && !/★/.test(serverCode),
    (serverCode.match(/.{0,30}(customerRating:|Rahul Sharma|★).{0,30}/g) || []).join(' | ') || 'clean');

  // The boot mirror of the same rows, sliced by its own section markers. Raw text, not `codeOnly`:
  // the anchors are the comments that delimit the block.
  const dbText = fs.readFileSync(path.join(__dirname, 'src', 'database.js'), 'utf8');
  const hydrateStart = dbText.indexOf('// 3. Hydrate Jobs from PostgreSQL');
  const hydrateEnd = dbText.indexOf('// 4. Hydrate Ledger Entries', hydrateStart + 1);
  const jobsHydrator = hydrateStart === -1 || hydrateEnd === -1 ? null : dbText.slice(hydrateStart, hydrateEnd);
  check('CT-18 the boot mirror substitutes no place, no score and no name for a job row',
    jobsHydrator !== null
    && !/2\d\.\d{4}|7\d\.\d{4}/.test(jobsHydrator)
    && !/\|\|\s*5\.0\b/.test(jobsHydrator)
    && !/'Customer'/.test(jobsHydrator)
    && /coordinateOrNull\(row\.pickup_lat\)/.test(jobsHydrator)
    && /mapped\.customerRating = null/.test(jobsHydrator),
    jobsHydrator === null ? 'jobs hydrator block not found'
      : (jobsHydrator.match(/(lat|lng|customerRating|customerName|paymentMethod)[^\n]*/g) || []).slice(0, 8).join(' | '));

  console.log(`\ncustomer_ride_projection_test: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => { console.error('FATAL', err.stack || err.message); process.exitCode = 1; });
