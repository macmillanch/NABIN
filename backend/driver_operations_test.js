/**
 * Driver operations — console state, availability, offers, accept/reject, trip lifecycle,
 * telemetry, and the authorization boundaries around all of them.
 *
 * The driver app used to render none of this. Its home screen kept availability in a Dart
 * boolean, printed "₹1,420.00 / 8 Trips Done" as text, and had three buttons that invented a
 * ride, a parcel and a food order — pickup, drop, fare and a customer name included — for the
 * partner to "accept". Declining did nothing, arriving did nothing, and completing a trip
 * added money to a local counter. Every one of those actions has a real endpoint, and this
 * file is what pins the difference down.
 *
 * The properties locked here:
 *
 *   1. Identity is the bearer token's. No path, query or body id chooses whose console,
 *      whose offers, whose wallet, or which job is being worked.
 *   2. Availability is durable. `drivers.is_online` is a real column that boot hydration
 *      reads back, and the route used to mutate the in-memory object only — so a partner who
 *      pressed Online was undispatchable after the next restart while their app still said
 *      ONLINE. These checks read PostgreSQL behind the API's back.
 *   3. One job, one driver. Two drivers racing on one job produce exactly one winner, and the
 *      loser gets a conflict rather than a silent steal. A replayed accept is a duplicate, not
 *      a second assignment.
 *   4. Declining is real and cannot overwrite an acceptance.
 *   5. Trip OTP is validated by the server, and no driver-facing read ever carries the code
 *      the customer is supposed to speak.
 *   6. Money follows the ledger: completing a trip changes the wallet by exactly that trip's
 *      `driver_earnings`, once, and the earnings read shows it.
 *   7. Telemetry cannot be attached to somebody else's trip, and a job that cannot be found
 *      is not the same thing as a job that is authorised.
 *   8. An unreachable store is a 503, never an empty list or an "offline" that was never
 *      written. (Owner Decision 11 keeps the *offer* read on its memory fallback; that
 *      carve-out is asserted separately so it cannot spread by accident.)
 *
 * Requires the local backend and the local Docker PostgreSQL. Books real rides and completes
 * one real trip against the fixture driver, exactly as the existing lifecycle suites do.
 */
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');
const { withSharedSession } = require('./testSessionCache');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';

const DRIVER_A_PHONE = '9810122910';              // DRV-101 Rajesh Kumar
const DRIVER_A_UUID = '00000000-0000-0000-0000-000000000101';
const DRIVER_B_PHONE = '9833344556';              // DRV-103 Deepak Auto
const DRIVER_B_UUID = '00000000-0000-0000-0000-000000000103';
const CUSTOMER_PHONE = '9845011982';              // Priya Saxena, KYC verified

const HOME_PATH = '/api/driver/home';
const PICKUP = { address: 'Civil Lines Metro Gate 2, Delhi', lat: 28.6853, lng: 77.2185 };
const DROP = { address: 'Connaught Place Block B, New Delhi', lat: 28.6328, lng: 77.2197 };

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const near = (a, b, eps = 0.02) => Math.abs(Number(a) - Number(b)) < eps;

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const payload = body ? JSON.stringify(body) : null;
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
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {}, raw: data }); }
        catch (e) { resolve({ status: res.statusCode, raw: data, data: {} }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function mintSession(phone, role) {
  const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
  if (!send.data || !send.data.success) return null;
  const verify = await request('POST', '/api/auth/verify-otp', {
    phone, otp: (send.data && send.data.testOtp) || '7729', role, purpose: 'LOGIN',
  });
  return verify.data && verify.data.token;
}

/**
 * Reuses a still-valid local harness session instead of spending another OTP dispatch, which
 * the chain cannot afford: the limit is 5 sends per phone per 10 minutes inside one server
 * process. The cached token is only trusted once `GET /api/auth/me` confirms it is live and
 * carries the requested role, so no assertion here ever runs on an unauthenticated request.
 */
async function login(phone, role) {
  // The mint's failure is captured, not re-minted: asking for the reason must never cost a
  // second OTP dispatch, which is how a harness under throttle makes the throttle worse.
  let mintFailure = null;
  const { token } = await withSharedSession({
    baseUrl: BASE_URL,
    phone,
    role,
    mint: async () => {
      const sent = await mintSession(phone, role);
      if (sent) return sent;
      mintFailure = mintFailure || { stage: 'send', body: { error: 'send-otp or verify-otp refused' } };
      return null;
    },
    probe: async (candidate) => {
      const me = await request('GET', '/api/auth/me', null, auth(candidate));
      return me.status === 200 && me.data && me.data.success === true && me.data.user
        && String(me.data.role || (me.data.user && me.data.user.role) || '').toUpperCase() === role;
    },
  });
  if (!token) return { token: null, user: null, failure: mintFailure };
  const me = await request('GET', '/api/auth/me', null, auth(token));
  return { token, user: (me.data && me.data.user) || null, failure: null };
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** True when anything OTP-shaped appears as a key anywhere in the payload. */
function findOtpKeys(node, found = []) {
  if (Array.isArray(node)) { node.forEach((n) => findOtpKeys(n, found)); return found; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/otp$/i.test(k) && !/required/i.test(k)) found.push(`${k}=${JSON.stringify(v)}`);
      findOtpKeys(v, found);
    }
  }
  return found;
}

/** True when anything customer-identifying appears in the node. */
function findCustomerIdentityKeys(node, found = []) {
  if (Array.isArray(node)) { node.forEach((n) => findCustomerIdentityKeys(n, found)); return found; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (/customer(name|phone|mobile|email)/i.test(k) || (/^customerId$/i.test(k) && v)) found.push(k);
      findCustomerIdentityKeys(v, found);
    }
  }
  return found;
}

async function main() {
  console.log('--- DRIVER OPERATIONS TESTS ---');

  const { supabaseAdmin } = require('./src/supabase');
  if (!supabaseAdmin) {
    console.log('SKIP: PostgreSQL is not configured; these checks pin PostgreSQL-backed state.');
    return finish();
  }

  const a = await login(DRIVER_A_PHONE, 'DRIVER');
  const b = await login(DRIVER_B_PHONE, 'DRIVER');
  const cust = await login(CUSTOMER_PHONE, 'CUSTOMER');
  const A = a.token; const B = b.token; const C = cust.token;

  // Every check in this file is about what a role may or may not do with a session the server
  // issued. Without a session, a refusal assertion such as OPS-03 ("a customer token cannot
  // reach the driver console") would pass against `Bearer null` and prove nothing at all — a
  // test passing because authentication was skipped. So the suite stops here and says which
  // identity is missing and what the server said, rather than reporting green it has not
  // earned. This is the harness failing, not the product.
  const missingIdentities = [['driver A', a], ['driver B', b], ['customer', cust]]
    .filter(([, session]) => !session.token)
    .map(([who, session]) => `${who}: ${session.failure
      ? `${session.failure.stage} -> ${JSON.stringify(session.failure.body).slice(0, 160)}`
      : 'no session issued'}`);
  if (missingIdentities.length) {
    assert('HARNESS every identity this suite signs in as is authenticated', false, { missingIdentities });
    return finish();
  }

  // ============================== A. the gate ==============================
  const anon = await request('GET', HOME_PATH);
  assert('OPS-01 an anonymous console read is refused', anon.status === 401, { status: anon.status });

  const junk = await request('GET', HOME_PATH, null, auth('driver_token_that_nobody_issued'));
  assert('OPS-02 a made-up token is refused', junk.status === 401, { status: junk.status });

  const custOnDriverApi = await request('GET', HOME_PATH, null, auth(C));
  assert('OPS-03 a customer token cannot reach the driver console', custOnDriverApi.status !== 200 && [401, 403].includes(custOnDriverApi.status),
    { status: custOnDriverApi.status, code: custOnDriverApi.data.code });

  // What matters is not whether a customer's number can be typed into a driver login form —
  // in development a fixed OTP is deliberately accepted for any role, and this harness runs
  // in development — but whether that convenience can ever mint a driver session in
  // production. Asserted in a child that boots with NODE_ENV=production.
  const prodConvenience = spawnChild('production_fixed_otp_driver_login', {
    NODE_ENV: 'production',
    SUPABASE_POSTGRES_LIVE: 'true',
    NABIN_TEST_MODE: 'true', // the bypass this flag is meant to refuse
  });
  assert('OPS-04 in production a fixed OTP cannot mint a driver session for a customer number',
    prodConvenience.tokenIssued === false && prodConvenience.threw === true,
    { tokenIssued: prodConvenience.tokenIssued, code: prodConvenience.code, message: prodConvenience.message });

  const homeA = await request('GET', HOME_PATH, null, auth(A));
  assert('OPS-05 the fixture driver reads their own console', homeA.status === 200 && homeA.data.success === true,
    { status: homeA.status, body: homeA.data });

  const d = homeA.data.driver || {};
  assert('OPS-06 the console identity is the token’s driver, not a parameter',
    d.uuid === DRIVER_A_UUID, { uuid: d.uuid, id: d.id });

  const steered = await request('GET', `${HOME_PATH}?driverId=${DRIVER_B_UUID}`, null, auth(A));
  assert('OPS-07 a query driverId cannot steer whose console is returned',
    steered.status === 200 && (steered.data.driver || {}).uuid === DRIVER_A_UUID,
    { uuid: (steered.data.driver || {}).uuid });

  const steeredBody = await request('GET', HOME_PATH, { driverId: DRIVER_B_UUID }, auth(A));
  assert('OPS-08 and neither can a body driverId',
    steeredBody.status === 200 && (steeredBody.data.driver || {}).uuid === DRIVER_A_UUID,
    { uuid: (steeredBody.data.driver || {}).uuid });

  const otpLeak = findOtpKeys(homeA.data);
  assert('OPS-09 no trip OTP is disclosed to a driver-facing read', otpLeak.length === 0, { otpLeak });

  // ============================== B. availability ==============================
  const badAvail = await request('POST', '/api/driver/status', { isOnline: 'yes please' }, auth(A));
  assert('OPS-10 a non-boolean availability is rejected rather than guessed',
    badAvail.status === 400 && badAvail.data.code === 'INVALID_AVAILABILITY', { status: badAvail.status, code: badAvail.data.code });

  const anonAvail = await request('POST', '/api/driver/status', { isOnline: true });
  assert('OPS-11 availability cannot be set anonymously', anonAvail.status === 401, { status: anonAvail.status });

  const goOffline = await request('POST', '/api/driver/status', { isOnline: false }, auth(A));
  assert('OPS-12 going offline answers with the server’s state',
    goOffline.status === 200 && goOffline.data.success === true && goOffline.data.isOnline === false,
    { status: goOffline.status, body: goOffline.data });

  const pgOffline = await supabaseAdmin.from('drivers').select('is_online').eq('id', DRIVER_A_UUID).maybeSingle();
  assert('OPS-13 going offline is written to PostgreSQL, so it survives a restart',
    !pgOffline.error && pgOffline.data && pgOffline.data.is_online === false,
    { stored: pgOffline.data && pgOffline.data.is_online, error: pgOffline.error && pgOffline.error.message });

  const homeAfterOffline = await request('GET', HOME_PATH, null, auth(A));
  assert('OPS-14 the console reads availability back from the store, not from what was last asked',
    (homeAfterOffline.data.driver || {}).isOnline === false && (homeAfterOffline.data.availability || {}).isOnline === false,
    { driver: homeAfterOffline.data.driver && homeAfterOffline.data.driver.isOnline });

  const goOnline = await request('POST', '/api/driver/status', { isOnline: true }, auth(A));
  const pgOnline = await supabaseAdmin.from('drivers').select('is_online').eq('id', DRIVER_A_UUID).maybeSingle();
  assert('OPS-15 going back online is durable too',
    goOnline.status === 200 && goOnline.data.isOnline === true && pgOnline.data && pgOnline.data.is_online === true,
    { api: goOnline.data, stored: pgOnline.data && pgOnline.data.is_online });

  const legacyToggle = await request('POST', `/api/driver/DRV-101/toggle-online`, { isOnline: false }, auth(A));
  const pgLegacy = await supabaseAdmin.from('drivers').select('is_online').eq('id', DRIVER_A_UUID).maybeSingle();
  assert('OPS-16 the legacy path-scoped switch writes the same durable state (no second source of truth)',
    legacyToggle.status === 200 && legacyToggle.data.isOnline === false && pgLegacy.data && pgLegacy.data.is_online === false,
    { api: legacyToggle.data, stored: pgLegacy.data && pgLegacy.data.is_online });

  await request('POST', '/api/driver/status', { isOnline: true }, auth(A));

  const foreignToggle = await request('POST', `/api/driver/${DRIVER_B_UUID}/toggle-online`, { isOnline: false }, auth(A));
  assert('OPS-17 driver A cannot change driver B’s availability',
    foreignToggle.status === 403 && foreignToggle.data.code === 'DRIVER_MISMATCH',
    { status: foreignToggle.status, code: foreignToggle.data.code });

  const pgStillOnline = await supabaseAdmin.from('drivers').select('is_online').eq('id', DRIVER_B_UUID).maybeSingle();
  assert('OPS-18 and the refused attempt left B’s stored availability untouched',
    pgStillOnline.data && pgStillOnline.data.is_online === true,
    { stored: pgStillOnline.data && pgStillOnline.data.is_online });

  // ============================== C. offers ==============================
  const bookKey = `ops_book_${Date.now()}`;
  const booked = await request('POST', '/api/customer/book-ride',
    { vehicleType: '3W', pickup: PICKUP, drop: DROP }, { ...auth(C), 'Idempotency-Key': bookKey });
  const job1 = booked.data.job || {};
  assert('OPS-19 a real ride is booked to dispatch offers against',
    booked.status === 200 && !!job1.id, { status: booked.status, error: booked.data.error });

  const offersA = await request('GET', '/api/driver/offers', null, auth(A));
  const offersB = await request('GET', '/api/driver/offers', null, auth(B));
  const listA = (offersA.data || {}).offers || [];
  const listB = (offersB.data || {}).offers || [];
  const mine1 = listA.find((o) => String(o.jobId) === String(job1.id) || String(o.jobUuid) === String(job1.uuid));
  const theirs1 = listB.find((o) => String(o.jobId) === String(job1.id) || String(o.jobUuid) === String(job1.uuid));

  assert('OPS-20 both candidate drivers hold a live offer for the same job (a real race, not a rigged one)',
    !!mine1 && !!theirs1, { aHas: !!mine1, bHas: !!theirs1, aCount: listA.length });

  assert('OPS-21 the offer carries the job behind it — a fare, an earning and two addresses',
    !!mine1 && mine1.detailsAvailable === true && Number(mine1.fare) > 0
    && Number(mine1.driverEarnings) > 0 && !!mine1.pickupAddress && !!mine1.dropAddress
    && mine1.serviceType === 'RIDE',
    { offer: mine1 });

  assert('OPS-22 the earning is the platform’s figure, not the customer charge minus an invented percentage',
    !!mine1 && near(Number(mine1.fare), Number(mine1.driverEarnings) + Number(mine1.platformCommission)),
    { fare: mine1.fare, earnings: mine1.driverEarnings, commission: mine1.platformCommission });

  assert('OPS-23 the offer reports real time left, within the dispatch TTL',
    !!mine1 && Number.isFinite(mine1.secondsLeft) && mine1.secondsLeft > 0 && mine1.secondsLeft <= 75,
    { secondsLeft: mine1 && mine1.secondsLeft });

  const offered = await supabaseAdmin.from('dispatch_offers')
    .select('id,driver_uuid,status').in('id', [mine1.offerId, theirs1.offerId]);
  assert('OPS-24 what the API lists matches the offers PostgreSQL addressed to each driver',
    !offered.error && (offered.data || []).length === 2
    && (offered.data || []).every((r) => r.status === 'OFFERED'),
    { rows: offered.data, error: offered.error && offered.error.message });

  const offerIdentity = findCustomerIdentityKeys({ offers: listA });
  assert('OPS-25 an offer carries no customer identity before acceptance',
    offerIdentity.length === 0, { leakedKeys: offerIdentity });

  const homeOffers = (await request('GET', HOME_PATH, null, auth(A))).data.offers || [];
  assert('OPS-26 the console list and the offers endpoint are one implementation, not two opinions',
    JSON.stringify(homeOffers.map((o) => o.offerId).sort()) === JSON.stringify(listA.map((o) => o.offerId).sort()),
    { home: homeOffers.length, offers: listA.length });

  // ============================== D. the race, replays, decline ==============================
  const [raceA, raceB] = await Promise.all([
    request('POST', `/api/driver/offers/${mine1.offerId}/accept`, {}, auth(A)),
    request('POST', `/api/driver/offers/${theirs1.offerId}/accept`, {}, auth(B)),
  ]);
  const wins = [raceA, raceB].filter((r) => r.status === 200 && r.data.success === true);
  const loses = [raceA, raceB].filter((r) => !(r.status === 200 && r.data.success === true));

  assert('OPS-27 two drivers racing on one job produce exactly one winner',
    wins.length === 1 && loses.length === 1,
    { A: { s: raceA.status, c: raceA.data.code }, B: { s: raceB.status, c: raceB.data.code } });

  const loser = raceA === wins[0] ? raceB : raceA;
  assert('OPS-28 the loser is told it is a conflict, not given a fake success or a 500',
    [403, 409].includes(loser.status) && loser.data.success === false && !!loser.data.code,
    { status: loser.status, code: loser.data.code, error: loser.data.error });

  const winnerToken = raceA === wins[0] ? A : B;
  const winnerOffer = raceA === wins[0] ? mine1 : theirs1;
  const loserToken = raceA === wins[0] ? B : A;

  const jobRow = await supabaseAdmin.from('jobs').select('status,driver_id').eq('job_number', job1.id).maybeSingle();
  const winnerUuid = winnerToken === A ? DRIVER_A_UUID : DRIVER_B_UUID;
  assert('OPS-29 PostgreSQL shows the job assigned to the winner and to nobody else',
    jobRow.data && jobRow.data.status === 'ASSIGNED' && String(jobRow.data.driver_id) === winnerUuid,
    { stored: jobRow.data });

  const replay = await request('POST', `/api/driver/offers/${winnerOffer.offerId}/accept`, {}, auth(winnerToken));
  assert('OPS-30 a replayed accept is a duplicate, not a second assignment',
    replay.status === 200 && replay.data.success === true && replay.data.duplicate === true,
    { status: replay.status, body: replay.data });

  const jobRow2 = await supabaseAdmin.from('jobs').select('status,driver_id').eq('job_number', job1.id).maybeSingle();
  assert('OPS-31 and the replay did not move the job',
    jobRow2.data && jobRow2.data.status === 'ASSIGNED' && String(jobRow2.data.driver_id) === winnerUuid,
    { stored: jobRow2.data });

  const loserReject = await request('POST', `/api/driver/offers/${(raceA === wins[0] ? theirs1 : mine1).offerId}/reject`,
    { reason: 'NOT_MINE' }, auth(loserToken));
  assert('OPS-32 the losing driver cannot decline the winner out of the job',
    loserReject.status !== 200 || loserReject.data.success !== true,
    { status: loserReject.status, code: loserReject.data.code, body: loserReject.data });

  const winnerReject = await request('POST', `/api/driver/offers/${winnerOffer.offerId}/reject`,
    { reason: 'CHANGED_MIND' }, auth(winnerToken));
  assert('OPS-33 an accepted offer cannot be declined afterwards',
    winnerReject.status === 409
    && ['OFFER_ALREADY_ACCEPTED', 'OFFER_CLOSED'].includes(winnerReject.data.code)
    && winnerReject.data.success !== true,
    { status: winnerReject.status, code: winnerReject.data.code });

  const afterRejects = await supabaseAdmin.from('jobs').select('status,driver_id').eq('job_number', job1.id).maybeSingle();
  assert('OPS-34 neither rejection attempt changed the assignment',
    afterRejects.data && afterRejects.data.status === 'ASSIGNED' && String(afterRejects.data.driver_id) === winnerUuid,
    { stored: afterRejects.data });

  // A genuine decline on a job nobody has taken yet.
  const booked2 = await request('POST', '/api/customer/book-ride',
    { vehicleType: '3W', pickup: PICKUP, drop: DROP }, { ...auth(C), 'Idempotency-Key': `ops_book2_${Date.now()}` });
  const job2 = booked2.data.job || {};
  const offersA2 = ((await request('GET', '/api/driver/offers', null, auth(A))).data.offers || [])
    .find((o) => String(o.jobId) === String(job2.id) || String(o.jobUuid) === String(job2.uuid));

  // B reaches for A's still-open offer. Ownership is the whole question here: the row is
  // addressed to A, and a decline that lands on it would take a willing partner out of a
  // trip they never declined.
  const crossDecline = await request('POST', `/api/driver/offers/${offersA2.offerId}/reject`,
    { reason: 'NOT_MINE' }, auth(B));
  assert('OPS-64 a driver cannot decline another driver’s open offer',
    crossDecline.status === 403 && crossDecline.data.code === 'DRIVER_MISMATCH' && crossDecline.data.success !== true,
    { status: crossDecline.status, code: crossDecline.data.code, body: crossDecline.data });

  const aOfferStillOpen = await supabaseAdmin.from('dispatch_offers').select('status')
    .eq('id', offersA2.offerId).maybeSingle();
  assert('OPS-65 and the refused attempt left A’s offer open, untouched',
    aOfferStillOpen.data && aOfferStillOpen.data.status === 'OFFERED',
    { stored: aOfferStillOpen.data });

  const declined = await request('POST', `/api/driver/offers/${offersA2.offerId}/reject`, { reason: 'TOO_FAR' }, auth(A));
  assert('OPS-35 declining an open offer works and says so',
    declined.status === 200 && declined.data.success === true && declined.data.status === 'REJECTED',
    { status: declined.status, body: declined.data });

  const declRow = await supabaseAdmin.from('dispatch_offers').select('status,rejection_reason,driver_uuid')
    .eq('id', offersA2.offerId).maybeSingle();
  assert('OPS-36 the decline is in PostgreSQL, addressed to the driver who made it',
    declRow.data && declRow.data.status === 'REJECTED' && String(declRow.data.driver_uuid) === DRIVER_A_UUID,
    { stored: declRow.data });

  const replayDecline = await request('POST', `/api/driver/offers/${offersA2.offerId}/reject`, { reason: 'TOO_FAR' }, auth(A));
  assert('OPS-37 a replayed decline is a duplicate and does not rewrite the row',
    replayDecline.status === 200 && replayDecline.data.success === true && replayDecline.data.duplicate === true,
    { status: replayDecline.status, body: replayDecline.data });

  const reAccept = await request('POST', `/api/driver/offers/${offersA2.offerId}/accept`, {}, auth(A));
  assert('OPS-38 an offer cannot be accepted after it was declined',
    reAccept.data.success !== true && [400, 403, 404, 409].includes(reAccept.status),
    { status: reAccept.status, code: reAccept.data.code });

  const spoofAccept = await request('POST', '/api/driver/accept-job',
    { jobId: job2.id, driverId: DRIVER_A_UUID }, auth(B));
  assert('OPS-39 accepting a job while claiming another driver’s identity is refused outright',
    spoofAccept.status === 403 && spoofAccept.data.code === 'IDENTITY_SPOOFING_REJECTED',
    { status: spoofAccept.status, code: spoofAccept.data.code });

  const ghostAccept = await request('POST', '/api/driver/accept-job',
    { jobId: `JOB-NOT-REAL-${Date.now()}` }, auth(A));
  assert('OPS-40 a job that does not exist is refused, and does not become a 500 or a success',
    ghostAccept.data.success !== true && [400, 404].includes(ghostAccept.status),
    { status: ghostAccept.status, code: ghostAccept.data.code });

  const job2Owner = await supabaseAdmin.from('jobs').select('status,driver_id').eq('job_number', job2.id).maybeSingle();
  assert('OPS-41 and that refused job is still unassigned',
    job2Owner.data && !job2Owner.data.driver_id && job2Owner.data.status !== 'ASSIGNED',
    { stored: job2Owner.data });

  // ============================== E. lifecycle on the winner's job ==============================
  const homeWinner = (await request('GET', HOME_PATH, null, auth(winnerToken))).data;
  assert('OPS-42 the console now shows the job the winner actually holds, with no code in it',
    !!homeWinner.activeJob && String(homeWinner.activeJob.jobNumber) === String(job1.id)
    && findOtpKeys(homeWinner.activeJob).length === 0,
    { activeJob: homeWinner.activeJob });

  assert('OPS-43 the active job belongs to this driver in the server’s own words',
    !!homeWinner.activeJob && String(homeWinner.activeJob.driverId) === winnerUuid,
    { driverId: homeWinner.activeJob && homeWinner.activeJob.driverId });

  const crossArrive = await request('POST', '/api/driver/arrived', { jobId: job1.id }, auth(loserToken));
  assert('OPS-44 the losing driver cannot announce arrival on the winner’s job',
    crossArrive.status === 403 && crossArrive.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER',
    { status: crossArrive.status, code: crossArrive.data.code });

  const crossTelemetry = await request('POST', '/api/driver/location',
    { jobId: job1.id, lat: PICKUP.lat, lng: PICKUP.lng, heading: 90, speed: 10, timestamp: new Date().toISOString() },
    auth(loserToken));
  assert('OPS-45 nor can the loser attach GPS telemetry to it',
    crossTelemetry.status === 403 && crossTelemetry.data.code === 'JOB_NOT_ASSIGNED_TO_DRIVER',
    { status: crossTelemetry.status, code: crossTelemetry.data.code });

  const bogusTelemetry = await request('POST', '/api/driver/location',
    { lat: 999, lng: -500, timestamp: new Date().toISOString() }, auth(winnerToken));
  assert('OPS-46 an impossible coordinate is refused by the shared telemetry validator',
    bogusTelemetry.status >= 400 && bogusTelemetry.data.success !== true && !!bogusTelemetry.data.code,
    { status: bogusTelemetry.status, code: bogusTelemetry.data.code });

  const goodTelemetry = await request('POST', '/api/driver/location',
    { jobId: job1.id, lat: PICKUP.lat, lng: PICKUP.lng, heading: 90, speed: 12, accuracy: 6, timestamp: new Date().toISOString() },
    auth(winnerToken));
  assert('OPS-47 a valid fix on their own trip is accepted',
    goodTelemetry.status === 200 && goodTelemetry.data.success === true && goodTelemetry.data.telemetryStored === true,
    { status: goodTelemetry.status, body: goodTelemetry.data });

  // A job the platform cannot resolve is not the same thing as a job the driver is cleared
  // for. The authorization used to be skipped entirely when the trip was absent from this
  // process's memory — every job created elsewhere, or not re-hydrated after a restart —
  // which meant the guard vanished exactly when it was needed.
  const ghostTelemetry = await request('POST', '/api/driver/location',
    { jobId: `JOB-NO-SUCH-TRIP-${Date.now()}`, lat: PICKUP.lat, lng: PICKUP.lng, timestamp: new Date().toISOString() },
    auth(winnerToken));
  assert('OPS-66 telemetry cannot be attached to a trip that cannot be resolved',
    ghostTelemetry.data.success !== true && [403, 404].includes(ghostTelemetry.status),
    { status: ghostTelemetry.status, code: ghostTelemetry.data.code });

  const arrived = await request('POST', '/api/driver/arrived', { jobId: job1.id }, auth(winnerToken));
  assert('OPS-48 arrival is recorded by the server',
    arrived.status === 200 && arrived.data.success === true, { status: arrived.status, body: arrived.data });

  const badOtp = await request('POST', '/api/driver/verify-otp',
    { jobId: job1.id, otp: '0000', otpType: 'START' }, auth(winnerToken));
  assert('OPS-49 a wrong start OTP does not start the trip',
    badOtp.status === 400 && badOtp.data.verified === false, { status: badOtp.status, body: badOtp.data });

  const statusAfterBad = await supabaseAdmin.from('jobs').select('status').eq('job_number', job1.id).maybeSingle();
  assert('OPS-50 and the stored state did not move',
    ['DRIVER_ARRIVED', 'ASSIGNED', 'DRIVER_ARRIVING'].includes(statusAfterBad.data && statusAfterBad.data.status),
    { stored: statusAfterBad.data });

  const started = await request('POST', '/api/driver/verify-otp',
    { jobId: job1.id, otp: job1.startOtp, otpType: 'START' }, auth(winnerToken));
  assert('OPS-51 the customer’s code, verified server-side, starts the trip',
    started.status === 200 && started.data.verified === true && started.data.status === 'IN_TRANSIT',
    { status: started.status, body: started.data });

  // ---- money: the settlement has to be one movement, derived and re-read ----
  const earnBefore = (await request('GET', '/api/driver/earnings', null, auth(winnerToken))).data;
  const completed = await request('POST', '/api/driver/verify-otp',
    { jobId: job1.id, otp: job1.deliveryOtp, otpType: 'DELIVERY' }, auth(winnerToken));
  assert('OPS-52 completing the trip needs the delivery code and settles it',
    completed.status === 200 && completed.data.verified === true && completed.data.status === 'COMPLETED',
    { status: completed.status, code: completed.data.code, body: completed.data });

  const storedJob = await supabaseAdmin.from('jobs')
    .select('status,final_total,driver_earnings,platform_commission').eq('job_number', job1.id).maybeSingle();
  assert('OPS-53 the settled row keeps fare = earnings + commission to the paisa',
    storedJob.data && near(Number(storedJob.data.final_total),
      Number(storedJob.data.driver_earnings) + Number(storedJob.data.platform_commission)),
    { stored: storedJob.data });

  const earnAfter = (await request('GET', '/api/driver/earnings', null, auth(winnerToken))).data;
  assert('OPS-54 the wallet moved by exactly this trip’s driver earnings, once',
    near(Number(earnAfter.walletBalance) - Number(earnBefore.walletBalance), Number(storedJob.data.driver_earnings)),
    { before: earnBefore.walletBalance, after: earnAfter.walletBalance, expected: storedJob.data && storedJob.data.driver_earnings });

  const dupComplete = await request('POST', '/api/driver/verify-otp',
    { jobId: job1.id, otp: job1.deliveryOtp, otpType: 'DELIVERY' }, auth(winnerToken));
  const earnAfterDup = (await request('GET', '/api/driver/earnings', null, auth(winnerToken))).data;
  assert('OPS-55 a replayed completion cannot pay the trip twice',
    dupComplete.data.success !== true || dupComplete.data.duplicate === true || dupComplete.data.code === 'TRIP_ALREADY_SETTLED',
    { status: dupComplete.status, code: dupComplete.data.code });
  assert('OPS-56 and the wallet proves it: the second attempt moved nothing',
    near(earnAfterDup.walletBalance, earnAfter.walletBalance),
    { after: earnAfter.walletBalance, afterDuplicate: earnAfterDup.walletBalance });

  const earnWindows = earnAfter.windows || {};
  assert('OPS-57 the earnings read counts the new trip in the 24-hour window',
    (earnWindows.last24h || {}).trips >= ((earnBefore.windows || {}).last24h || {}).trips + 1,
    { before: (earnBefore.windows || {}).last24h, after: earnWindows.last24h });

  const homeDone = (await request('GET', HOME_PATH, null, auth(winnerToken))).data;
  assert('OPS-58 once settled, the console no longer shows an active job for it',
    !homeDone.activeJob || String(homeDone.activeJob.jobNumber) !== String(job1.id),
    { activeJob: homeDone.activeJob });

  // ============================== F. outage semantics ==============================
  const down = spawnChild('store_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
  });
  assert('OPS-59 an unreachable store fails the current-job read closed, instead of saying "no job"',
    down.assignmentThrew === true && down.assignmentCode === 'STORE_UNAVAILABLE' && down.assignmentStatus === 503,
    { threw: down.assignmentThrew, code: down.assignmentCode, status: down.assignmentStatus, message: down.message });

  assert('OPS-60 and it fails the offer hydration closed, instead of offering a shorter list',
    down.summariesThrew === true && down.summariesCode === 'STORE_UNAVAILABLE' && down.summariesStatus === 503,
    { threw: down.summariesThrew, code: down.summariesCode, status: down.summariesStatus, message: down.message });

  assert('OPS-61 and going online refuses to claim a write it could not make',
    down.availabilityThrew === true && down.availabilityCode === 'STORE_UNAVAILABLE'
    && down.availabilityStatus === 503 && down.availabilityStoreUnreachable === true,
    { threw: down.availabilityThrew, code: down.availabilityCode, status: down.availabilityStatus, unreachable: down.availabilityStoreUnreachable });

  // Owner Decision 11 (choice B): the offer LIST read is a deliberate read-through cache.
  // Asserted as still-memory so the carve-out is visible and cannot silently widen to the
  // reads above, which are not covered by it.
  assert('OPS-62 the offer list alone keeps its approved memory fallback (Owner Decision 11, choice B)',
    down.offersThrew === false && Array.isArray(down.offers),
    { threw: down.offersThrew, isArray: Array.isArray(down.offers), message: down.offersMessage });

  const live = spawnChild('store_live_unrelated_driver', { NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'true' });
  assert('OPS-63 an identity that resolves to no driver is refused, not handed somebody else’s job',
    live.threw === true && live.code === 'DRIVER_IDENTITY_UNRESOLVED' && !live.assignment,
    { threw: live.threw, code: live.code, assignment: live.assignment, message: live.message });

  finish();
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'driver_operations_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_OPS_CHILD: scenario, ...env },
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch (e) { /* reported below as a failed check */ }
  return { message: `${res.stdout || ''} ${res.stderr || ''}`.slice(0, 300) };
}

async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');
  const probe = async (fn) => {
    try { const value = await fn(); return { value, threw: false }; }
    catch (err) {
      return {
        threw: true,
        code: err && err.code,
        status: err && (err.status || err.statusCode),
        storeUnreachable: isStoreUnreachable(err),
        message: err && err.message,
      };
    }
  };

  const out = { scenario };

  if (scenario === 'store_down') {
    const assignment = await probe(() => db.dispatchRepo.getActiveAssignmentForDriver('DRV-101'));
    out.assignmentThrew = assignment.threw; out.assignmentCode = assignment.code;
    out.assignmentStatus = assignment.status; out.message = assignment.message;

    const summaries = await probe(() => db.jobRepo.getJobSummariesByUuids(
      ['00000000-0000-0000-0000-000000000101', DRIVER_B_UUID]));
    out.summariesThrew = summaries.threw; out.summariesCode = summaries.code;
    out.summariesStatus = summaries.status;

    const offers = await probe(() => db.dispatchRepo.getOffersForDriver('DRV-101'));
    out.offersThrew = offers.threw;
    out.offers = offers.value;
    out.offersMessage = offers.message;

    // The durable availability write, attempted against the unreachable store. Whatever the
    // repository raises is reported as-is: the check that matters is that it raises at all,
    // and that what it raises is classifiable as a store failure rather than a generic one.
    const avail = await probe(() => db.driverRepo.setOnlineStatus('DRV-101', true));
    out.availabilityThrew = avail.threw;
    out.availabilityCode = avail.code;
    out.availabilityStatus = avail.status;
    out.availabilityStoreUnreachable = avail.storeUnreachable;
  } else if (scenario === 'production_fixed_otp_driver_login') {
    // No HTTP, no session: ask the authoritative verifier directly whether a fixed
    // development code can open a driver door while running as production.
    const res = await probe(() => db.verifyAuthOtp({
      phone: CUSTOMER_PHONE, otp: '7729', role: 'DRIVER', purpose: 'LOGIN',
    }));
    out.threw = res.threw;
    out.code = res.code;
    out.message = res.message;
    out.tokenIssued = Boolean(!res.threw && res.value && res.value.token);
  } else {
    // A driver id that resolves to nobody in particular must not surface a stranger's job.
    const res = await probe(() => db.dispatchRepo.getActiveAssignmentForDriver('DRV-DOES-NOT-EXIST'));
    out.threw = res.threw;
    out.assignment = res.value;
    out.code = res.code;
    out.message = res.message;
  }

  console.log(JSON.stringify(out));
}

function mainCrash(err) {
  console.error('Unexpected error:', err);
  failed.push('HARNESS');
  finish();
}

if (process.env.NABIN_OPS_CHILD) {
  runChild(process.env.NABIN_OPS_CHILD).catch((err) => {
    console.log(JSON.stringify({ threw: true, code: 'CHILD_CRASHED', message: err.message }));
    process.exit(3);
  });
} else {
  main().catch(mainCrash);
}

function finish() {
  console.log(`\nDRIVER OPERATIONS: ${passed.length} PASSED, ${failed.length} FAILED`);
  if (failed.length) console.log('Failed: ' + failed.join(' | '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
