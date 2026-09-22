/**
 * NABIN real-world failure & resilience audit.
 *
 * SAFETY: this harness drives destructive, concurrent traffic and is LOCAL-ONLY.
 * It refuses to run unless the configured Supabase URL points at this machine.
 *
 *   node chaos_audit.js            # HTTP/WS scenarios + financial invariants
 *   CHAOS_SKIP_RACES=1 node chaos_audit.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { URL } = require('url');


const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '::1', '0.0.0.0'];
function assertLocalTarget() {
  const raw = process.env.SUPABASE_URL || process.env.DATABASE_URL || '';
  if (!raw) throw new Error('No Supabase/DATABASE URL configured - refusing to run.');
  let host = '';
  try {
    host = new URL(raw).hostname;
  } catch (e) {
    throw new Error(`Cannot parse configured database URL: ${raw}`);
  }
  if (!LOCAL_HOSTS.includes(host)) {
    throw new Error(`REFUSING TO RUN: target host "${host}" is not this machine. This audit only runs against LOCAL infrastructure.`);
  }
  return host;
}

const BASE = process.env.CHAOS_BASE_URL || 'http://127.0.0.1:4000';

function request(method, urlPath, body = null, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlPath, BASE);
    const payload = body === null ? null : JSON.stringify(body);
    const req = require('http').request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = { raw: data.slice(0, 300) }; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    // Under a self-inflicted outage every socket errors; resolve, never reject,
    // so one dead connection cannot abort the whole audit.
    req.on('error', err => resolve({ status: 0, data: null, error: err.code || err.message }));
    req.setTimeout(30000, () => { req.destroy(new Error('timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

const race = (count, makeCall) => Promise.all(
  Array.from({ length: count }, (_, i) => Promise.resolve(makeCall(i)))
);

const results = [];
function record(id, verdict, detail, severity = 'info') {
  results.push({ id, verdict, detail, severity });
  const tag = { PASS: '✅', FAIL: '❌', FINDING: '🔎', BLOCKED: '⛔' }[verdict] || '•';
  console.log(`${tag} [${id}] ${verdict}${severity !== 'info' ? ` (${severity.toUpperCase()})` : ''}  ${detail}`);
}

// A scenario that did not behave as designed is a finding even when the platform
// degraded safely: severity says how much it matters.
function expectSafe(id, ok, detail, severityWhenBad) {
  if (ok) return record(id, 'PASS', detail);
  return record(id, 'FAIL', detail, severityWhenBad || 'high');
}

async function login(phone, role) {
  const sent = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
  const otp = sent.data?.testOtp || '7729';
  const verified = await request('POST', '/api/auth/verify-otp', { phone, otp, role });
  return verified.data?.token || null;
}

async function main() {
  const host = assertLocalTarget();
  console.log(`🔒 LOCAL-ONLY guard satisfied: database host is "${host}", API target ${BASE}`);

  // Under an induced outage the API cannot mint sessions or read state, so the
  // outage pass runs on its own before anything needs the database.
  if (process.env.CHAOS_DB_DOWN === '1') {
    await outageProbe();
    return report();
  }

  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  if (!isLivePostgres || !supabaseAdmin) {
    console.error('PostgreSQL is not live; the audit needs the real database to check invariants.');
    process.exit(2);
  }

  const adminLogin = await request('POST', '/api/admin/login', {
    username: 'superadmin', password: process.env.ADMIN_BOOTSTRAP_PASSWORD || 'AdminPassword123!'
  });
  const adminToken = adminLogin.data.token;
  if (!adminToken) { console.error('Admin login failed - cannot run.'); process.exit(2); }
  const admin = { 'Authorization': `Bearer ${adminToken}` };

  const customerToken = await login('+919845011982', 'CUSTOMER');
  const otherCustomerToken = await login('+919876543210', 'CUSTOMER');
  const driverAToken = await login('+919810122910', 'DRIVER');
  const driverBToken = await login('+919833344556', 'DRIVER');
  const customer = { 'Authorization': `Bearer ${customerToken}` };

  if (!customerToken) { console.error('Customer OTP login failed - cannot run.'); process.exit(2); }

  const runId = Date.now().toString(36);
  const RACES_ON = !process.env.CHAOS_SKIP_RACES;

  // ---------------------------------------------------------------- RIDE LIFECYCLE
  const booked = await request('POST', '/api/customer/book-ride', {
    vehicleType: '3W',
    pickup: { lat: 28.6853, lng: 77.2185, address: 'Civil Lines Hub, North Delhi' },
    drop: { lat: 28.6328, lng: 77.2197, address: 'Connaught Place Outer Circle, New Delhi' }
  }, { ...customer, 'Idempotency-Key': `chaos_ride_${runId}` });

  const chaosJobNumber = booked.data.job?.id || booked.data.job?.jobNumber || booked.data.job?.jobId;
  expectSafe('CH-00', booked.status === 200 && !!chaosJobNumber,
    `baseline ride booking for the lifecycle races: job=${chaosJobNumber || 'none'}`, 'high');
  if (!chaosJobNumber) return report();

  // The public API identifies jobs by job_number; PostgreSQL keys are UUIDs.
  const jobRef = await supabaseAdmin.from('jobs')
    .select('id, job_number, status, driver_id, start_otp, delivery_otp')
    .eq('job_number', chaosJobNumber).maybeSingle();
  const chaosJobId = jobRef.data?.id;
  if (!chaosJobId) {
    record('CH-00b', 'FAIL', `booked job ${chaosJobNumber} is not readable from PostgreSQL`, 'high');
    return report();
  }

  // The driver session resolves to a fixture id (DRV-101); the row is keyed by UUID.
  const driverByUuid = async uuid =>
    (await supabaseAdmin.from('drivers').select('id, user_id').eq('id', uuid).maybeSingle()).data;
  const driverA = await driverByUuid('00000000-0000-0000-0000-000000000101');
  const driverB = await driverByUuid('00000000-0000-0000-0000-000000000103');
  const tokenForDriverRow = uuid => (driverA && uuid === driverA.id ? driverAToken
    : (driverB && uuid === driverB.id ? driverBToken : null));

  if (RACES_ON) {
    // ------------------------------------------------------------- CH-01 accept race
    const acceptResults = await race(100, i => {
      const token = i % 2 === 0 ? driverAToken : driverBToken;
      if (!token) return Promise.resolve({ status: 0, data: null });
      return request('POST', '/api/driver/accept-job', { jobId: chaosJobNumber },
        { 'Authorization': `Bearer ${token}` });
    });
    const accepts = acceptResults.filter(r => r.status === 200 && r.data?.success);
    const claimedDrivers = new Set(accepts.map(r => r.data.job?.driverId || r.data.job?.driver_id).filter(Boolean));

    const afterAccept = await supabaseAdmin.from('jobs')
      .select('status, driver_id').eq('id', chaosJobId).single();
    const storedDriver = afterAccept.data?.driver_id;

    expectSafe('CH-01', claimedDrivers.size <= 1 && !!storedDriver &&
      afterAccept.data?.status !== 'AVAILABLE',
      `100 concurrent accepts from 2 drivers → ${accepts.length} accepted, ` +
      `distinct claimed drivers=${claimedDrivers.size}, stored driver=${storedDriver}, status=${afterAccept.data?.status}`,
      'critical');
    if (accepts.length > 1) {
      record('CH-01b', 'FINDING', `${accepts.length}/100 accept calls returned success for an already-assigned ` +
        `job instead of 409, although ownership stayed single-owner`, 'low');
    }

    // ------------------------------------- CH-02 start the trip, then race completion
    const winnerToken = tokenForDriverRow(storedDriver) || driverAToken || driverBToken;
    const started = await request('POST', '/api/driver/verify-otp', {
      jobId: chaosJobNumber, otp: jobRef.data?.start_otp, otpType: 'START'
    }, { 'Authorization': `Bearer ${winnerToken}` });
    const midStatus = await supabaseAdmin.from('jobs').select('status').eq('id', chaosJobId).single();

    if (started.status === 200 && ['IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(midStatus.data?.status)) {
      const settles = await race(50, () => request('POST', '/api/driver/complete-trip', {
        jobId: chaosJobNumber, otp: jobRef.data?.delivery_otp
      }, { 'Authorization': `Bearer ${winnerToken}` }));
      const accepted = settles.filter(r => r.status === 200 && r.data?.success);
      const finalJob = await supabaseAdmin.from('jobs')
        .select('status, driver_earnings, final_total').eq('id', chaosJobId).single();

      // The ledger is the money record: a single trip must produce one settlement
      // posting per intended movement, however many retries arrive at once.
      const { data: settleJournals } = await supabaseAdmin.from('journal_transactions')
        .select('id, description, total_debit')
        .like('description', `%${chaosJobNumber}%`);
      const postings = (settleJournals || []);
      const booked = postings.reduce((sum, j) => sum + Number(j.total_debit || 0), 0);
      const entitlement = Number(finalJob.data?.driver_earnings || 0);

      expectSafe('CH-02', accepted.length === 1 && postings.length <= 2 && booked <= entitlement * 2,
        `50 concurrent completions of one ${entitlement === 0 ? 'unsettled' : `₹${entitlement}`} trip → ` +
        `${accepted.length} accepted, ${postings.length} settlement postings totalling ₹${booked}, ` +
        `job status=${finalJob.data?.status}`,
        'critical');
    } else {
      record('CH-02', 'BLOCKED',
        `trip could not be put in-transit (verify-otp ${started.status}, status ${midStatus.data?.status}); ` +
        `completion race not run`,
        'medium');
    }
  } else {
    record('CH-01', 'BLOCKED', 'skipped via CHAOS_SKIP_RACES=1', 'medium');
    record('CH-02', 'BLOCKED', 'skipped via CHAOS_SKIP_RACES=1', 'medium');
  }

  // ------------------------------------------------------------- CH-03 duplicate order
  const sharedKey = `chaos_dup_${runId}`;
  const CART = [{ productId: 'gprod_3', quantity: 2, price: 56.0 }];
  const dupCalls = await race(30, () => request('POST', '/api/grocery/checkout/validate', {
    merchantId: 'mcht_1', cartItems: CART, deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
  }, { ...customer, 'Idempotency-Key': sharedKey }));
  const dupSuccess = dupCalls.filter(r => r.status === 200 && r.data?.order);
  const dupOrderIds = new Set(dupSuccess.map(r => r.data.order.order_id || r.data.order.id));

  expectSafe('CH-03', dupOrderIds.size <= 1,
    `30 concurrent checkouts sharing one Idempotency-Key → ${dupSuccess.length} responses, ${dupOrderIds.size} distinct order id(s)`,
    'critical');

  // ---------------------------------------------------------- CH-04 coupon limit race
  const couponCode = `CHAOS_${runId}`.toUpperCase().slice(0, 30);
  const GLOBAL_CAP = 10;
  const created = await request('POST', '/api/admin/promotions', {
    code: couponCode, name: 'Chaos coupon race', discountType: 'FLAT', discountValue: 5,
    minOrderAmount: 0, serviceType: 'GROCERY', totalUsageLimit: GLOBAL_CAP, perUserLimit: 100
  }, admin);
  const couponId = created.data.promotion?.id;

  if (created.status === 200 && couponId) {
    const attempts = await race(100, i => request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1', cartItems: CART, couponCode,
      deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
    }, { ...customer, 'Idempotency-Key': `chaos_coupon_${runId}_${i}` }));
    const won = attempts.filter(r => r.status === 200 && r.data?.success);
    const rows = await supabaseAdmin.from('promotion_redemptions')
      .select('id, discount_amount').eq('promotion_id', couponId);
    const promoRow = await supabaseAdmin.from('promotions')
      .select('usage_count, total_usage_limit').eq('id', couponId).single();

    const redeemed = (rows.data || []).length;
    const discountedOrders = await supabaseAdmin.from('orders')
      .select('id').eq('metadata->coupon->>code', couponCode).then(r => (r.data || []).length, () => -1);

    expectSafe('CH-04', redeemed === Math.min(GLOBAL_CAP, won.length) && promoRow.data.usage_count === redeemed,
      `100 concurrent redemptions against a global cap of ${GLOBAL_CAP} → ${won.length} checkouts accepted, ` +
      `${redeemed} redemption rows, usage_count=${promoRow.data?.usage_count}, discounted orders=${discountedOrders}`,
      'critical');
  } else {
    record('CH-04', 'BLOCKED', `chaos coupon could not be created: ${JSON.stringify(created.data).slice(0, 160)}`, 'medium');
  }

  // ------------------------------------------------------------- CH-05 refund race
  const payId = `pay_chaos_${runId}`;
  await supabaseAdmin.from('payments').insert({
    payment_id: payId, amount: 500.00, currency: 'INR', method: 'UPI', status: 'CAPTURED',
    gateway_order_id: `order_${payId}`, created_at: new Date().toISOString()
  });
  const refunds = await race(100, i => request('POST', '/api/admin/finance/refund', {
    paymentId: payId, amount: 200.00,
    idempotencyKey: `chaos_refund_${runId}_${i}`,
    ticketId: `TKT-CHAOS-${runId}-${i}`,
    reason: `Chaos refund race ${i}`
  }, admin));
  const refundWins = refunds.filter(r => r.status === 200 && r.data?.success);
  const payAfter = await supabaseAdmin.from('payments')
    .select('amount, refunded_amount, status').eq('payment_id', payId).single();
  const refundRows = await supabaseAdmin.from('payment_refund_authorizations')
    .select('amount, idempotency_key').eq('payment_id', payId);
  const recordedTotal = (refundRows.data || []).reduce((sum, r) => sum + Number(r.amount), 0);
  const distinctKeys = new Set((refundRows.data || []).map(r => r.idempotency_key)).size;
  const captured = Number(payAfter.data?.amount || 0);
  const refundedCol = Number(payAfter.data?.refunded_amount || 0);

  // Partial refunds are permitted cumulatively, so the invariant is not "only one
  // refund ever" but: the stored total equals the records, never exceeds capture,
  // and no idempotency key is honoured twice.
  expectSafe('CH-05', refundedCol === recordedTotal && recordedTotal <= captured &&
    distinctKeys === (refundRows.data || []).length,
    `100 concurrent refunds of ₹200 on a ₹${captured} payment → ${refundWins.length} accepted, ` +
    `${(refundRows.data || []).length} records totalling ₹${recordedTotal}, refunded_amount=₹${refundedCol}, ` +
    `distinct keys=${distinctKeys}, status=${payAfter.data?.status}`,
    'critical');

  // ------------------------------------------------------------- CH-06 wallet race
  const owningDriverUuid = (await supabaseAdmin.from('jobs').select('driver_id').eq('id', chaosJobId).single()).data?.driver_id;
  const payoutToken = tokenForDriverRow(owningDriverUuid) || driverAToken;
  if (owningDriverUuid && payoutToken) {
    // The wallet is the payout source of truth; earnings accrue through the ledger.
    const before = await supabaseAdmin.from('drivers').select('wallet_balance').eq('id', owningDriverUuid).single();
    const payouts = await race(20, () => request('POST', '/api/driver/payout', { amount: 50 },
      { 'Authorization': `Bearer ${payoutToken}` }));
    const paid = payouts.filter(r => r.status === 200 && r.data?.success);
    const after = await supabaseAdmin.from('drivers').select('wallet_balance').eq('id', owningDriverUuid).single();
    const balanceBefore = Number(before.data?.wallet_balance ?? 0);
    const balanceAfter = Number(after.data?.wallet_balance ?? 0);
    const guardCodes = [...new Set(payouts.map(r => r.data?.code).filter(Boolean))];

    if (paid.length === 0 && guardCodes.some(code => code !== 'INSUFFICIENT_BALANCE')) {
      // The guards did their job, but the concurrent debit path never ran, so this
      // is not evidence about payout races.
      record('CH-06', 'BLOCKED', `20 concurrent payouts of ₹50 were all refused by the payout guards ` +
        `(${guardCodes.join(', ') || 'unknown'}) before touching the wallet, so the race itself was not ` +
        `exercised; wallet stayed at ${balanceAfter}. A full test_suite pass re-verifies the driver VPA and ` +
        `sets a 24h cooling-off, so run this scenario more than 24h after the suite.`, 'medium');
    } else {
      expectSafe('CH-06', balanceAfter >= 0 &&
        (paid.length === 0 || balanceBefore - balanceAfter === paid.length * 50),
        `20 concurrent payouts of ₹50 → ${paid.length} accepted; ` +
        `wallet ${balanceBefore} → ${balanceAfter} (delta ${balanceBefore - balanceAfter}, ` +
        `never negative: ${balanceAfter >= 0})`,
        'critical');
    }
  } else {
    record('CH-06', 'BLOCKED', 'no driver account resolvable for the payout race', 'medium');
  }

  // ------------------------------------------------------- CH-07 invalid transitions
  const weirdTransitions = await Promise.all([
    request('POST', '/api/driver/complete-trip', { jobId: chaosJobId, deliveryOtp: '0000' },
      { 'Authorization': `Bearer ${driverAToken || customerToken}` }),
    request('POST', `/api/driver/${driverA?.id || 'DRV-101'}/toggle-online`, { isOnline: true },
      { 'Authorization': `Bearer ${customerToken}` }),
    request('POST', '/api/admin/finance/refund', { paymentId: payId, amount: -50, idempotencyKey: `neg_${runId}`, ticketId: 'TKT-NEG' }, admin),
    request('POST', '/api/payments/webhook', { event: 'payment.captured', payment_id: payId, signature: 'bogus' })
  ]);
  const allRejected = weirdTransitions.every(r => r.status >= 400);
  expectSafe('CH-07', allRejected,
    `already-settled completion, customer-impersonating-driver, negative refund and unsigned webhook → ` +
    `statuses ${weirdTransitions.map(r => r.status).join(', ')} (400+ expected)`,
    'critical');

  // ---------------------------------------------------------------- CH-08 stale GPS
  const gpsCases = [
    ['out-of-range lat 999/lng 400', { lat: 999, lng: 400 }],
    ['non-numeric lat / null lng', { lat: 'abc', lng: null }],
    ['timestamp from 1899', { lat: 28.61, lng: 77.2, timestamp: '1899-01-01T00:00:00Z' }],
    ['absurd speed', { lat: 28.61, lng: 77.2, speed: 1e9 }]
  ];
  const gpsResults = await Promise.all([
    ...gpsCases.map(([, body]) => request('POST', '/api/driver/location', body, { 'Authorization': `Bearer ${driverAToken}` })),
    request('POST', '/api/driver/location', { lat: 28.61, lng: 77.2 }, { 'Authorization': `Bearer ${customerToken}` }),
    request('POST', '/api/driver/location', { driverId: 'DRV-999', lat: 28.61, lng: 77.2 }, { 'Authorization': `Bearer ${driverAToken}` })
  ]);
  const telem = await supabaseAdmin.from('drivers').select('current_lat, current_lng').eq('id', owningDriverUuid).single();
  const storedLat = Number(telem.data?.current_lat);
  const dbPoisoned = Number.isFinite(storedLat) && (storedLat > 90 || storedLat < -90);
  const acceptedBad = gpsResults.slice(0, 4).filter(r => r.status === 200 && r.data?.telemetryStored).length;

  expectSafe('CH-08', acceptedBad === 0 && !dbPoisoned,
    `REST /api/driver/location accepted ${acceptedBad}/4 impossible or stale fixes ` +
    `(statuses ${gpsResults.map(r => r.status).join(', ')}); the WS path rejects the same input with ` +
    `COORDINATES_OUT_OF_RANGE, and the driver row still holds lat=${telem.data?.current_lat ?? 'null'} ` +
    `(poisoned: ${dbPoisoned})`,
    dbPoisoned ? 'critical' : 'medium');

  // ------------------------------------------------------------------- CH-09 IDOR
  const idorResults = await Promise.all([
    request('GET', `/api/orders/${chaosJobId}`, null, { 'Authorization': `Bearer ${otherCustomerToken}` }),
    request('GET', `/api/jobs/${chaosJobId}`, null, { 'Authorization': `Bearer ${otherCustomerToken}` }),
    request('GET', '/api/customer/wallet', null, { 'Authorization': `Bearer ${otherCustomerToken}` }),
    request('GET', '/api/notifications/unread-count', null, { 'Authorization': `Bearer ${otherCustomerToken}` }),
    request('POST', '/api/customer/cancel-job', { jobId: chaosJobId }, { 'Authorization': `Bearer ${otherCustomerToken}` })
  ]);
  const idorSuspect = idorResults.filter(r => r.status === 200);
  record('CH-09', idorSuspect.length === 0 ? 'PASS' : 'FINDING',
    `cross-tenant reads/mutations by an unrelated customer → ${idorSuspect.length}/5 answered 200 ` +
    `(statuses ${idorResults.map(r => r.status).join(', ')})`,
    idorSuspect.length === 0 ? 'info' : 'high');

  // ------------------------------------------------------ CH-10 outage fail-closed
  // Only meaningful when the caller has stopped the database container.
  if (process.env.CHAOS_DB_DOWN === '1') {
    const during = await Promise.all([
      request('GET', '/api/health'),
      request('GET', '/api/app/config'),
      request('POST', '/api/grocery/checkout/validate', {
        merchantId: 'mcht_1', cartItems: CART, deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
      }, { ...customer, 'Idempotency-Key': `chaos_outage_${runId}` }),
      request('GET', '/api/admin/audit-logs', null, admin)
    ]);
    const lying = during.filter(r => r.status === 200 && r.data?.success !== false && !r.data?.degraded && !r.data?.stale);
    expectSafe('CH-10', lying.length === 0,
      `with PostgreSQL stopped: health=${during[0].status} config=${during[1].status} ` +
      `checkout=${during[2].status} audit=${during[3].status}; responses claiming success without ` +
      `degraded/stale labels: ${lying.length}`,
      'critical');
  } else {
    record('CH-10', 'BLOCKED', 'run again with CHAOS_DB_DOWN=1 while the local database container is stopped', 'medium');
  }

  // ----------------------------------------------------- CH-11 restart mid-operation
  // Deliberately not automated: it SIGKILLs the server this audit is driving.
  record('CH-11', 'BLOCKED', 'kill the backend during sustained checkout traffic and re-run the ' +
    'row-level checks by hand: (1) burst /api/grocery/checkout/validate with unique Idempotency-Keys, ' +
    '(2) taskkill //F //PID <backend pid> mid-burst, (3) restart the server, (4) compare HTTP 200s with ' +
    'orders / checkouts / order_creation_tokens rows for those keys. restart_test.js covers committed ' +
    'state across a clean cold start.', 'medium');

  if (process.env.CHAOS_DB_DOWN !== '1') await invariants();

  report();
}

// --------------------------------------------------- CH-10 OUTAGE FAIL-CLOSED PROBE
// Run while the LOCAL database container is stopped:
//   docker stop supabase_db_nabin
//   CHAOS_DB_DOWN=1 node chaos_audit.js
//   docker start supabase_db_nabin
async function outageProbe() {
  const CART = [{ productId: 'gprod_3', quantity: 2, price: 56.0 }];
  const probes = {
    health: await request('GET', '/api/health'),
    config: await request('GET', '/api/app/config'),
    ads: await request('GET', '/api/advertisements?placement=home_banner'),
    adminLogin: await request('POST', '/api/admin/login', { username: 'superadmin', password: process.env.ADMIN_BOOTSTRAP_PASSWORD || 'AdminPassword123!' }),
    sendOtp: await request('POST', '/api/auth/send-otp', { phone: '+919845011982', role: 'CUSTOMER', purpose: 'LOGIN' }),
    checkout: await request('POST', '/api/grocery/checkout/validate', {
      merchantId: 'mcht_1', cartItems: CART, deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
    }, { 'Authorization': 'Bearer chaos-outage-token', 'Idempotency-Key': 'chaos_outage_token' }),
    fleet: await request('GET', '/api/fleet/locations')
  };
  const summary = Object.entries(probes)
    .map(([k, r]) => `${k}=${r.status}${r.error ? `/${r.error}` : ''}`).join(' ');
  console.log(`   ${summary}`);

  // The process must still answer over HTTP: an unreachable socket means the
  // backend died instead of degrading.
  const survived = Object.values(probes).every(r => r.status !== 0);
  expectSafe('CH-10a', survived, `backend stayed reachable while PostgreSQL was down (${summary})`, 'critical');

  const isHonest = r => r.status === 401 || r.status >= 400 || r.data?.degraded === true ||
    r.data?.stale === true || r.data?.persisted === false || r.data?.success === false;
  // Auth is judged by CH-10c/CH-10e, which describe the in-memory fallback in full.
  const dataProbes = Object.entries(probes).filter(([name]) => name !== 'health' && name !== 'adminLogin' && name !== 'sendOtp');
  const lying = dataProbes.filter(([, r]) => r.status === 200 && !isHonest(r));
  expectSafe('CH-10b', lying.length === 0,
    `data endpoints that answered 200 with an unqualified success while the database was down: ` +
    `${lying.map(([name, r]) => `${name}=${JSON.stringify(r.data).slice(0, 120)}`).join(' | ') || 'none'} ` +
    `(config=${JSON.stringify(probes.config.data?.stale)} ads persisted=${JSON.stringify(probes.ads.data?.persisted)})`,
    'critical');

  const credsIssued = !!probes.adminLogin.data?.token || !!probes.sendOtp.data?.token;
  if (!credsIssued) {
    record('CH-10c', 'PASS', `admin login ${probes.adminLogin.status} and send-otp ${probes.sendOtp.status} ` +
      `refused to issue credentials while the database was down`);
  }

  const dbOut = probes.health.data?.database?.connected === false ||
    probes.health.data?.database?.mode !== 'SUPABASE_POSTGRES_LIVE' ||
    probes.health.data?.status !== 'ONLINE';
  expectSafe('CH-10d', dbOut,
    `health reported ${JSON.stringify(probes.health.data?.database || probes.health.data).slice(0, 160)} ` +
    `while the database was down; it must disclose the outage so monitors do not see a green light`, 'high');

  // Does the in-memory fallback hand out sessions that cannot be persisted?
  const otp = probes.sendOtp.data?.testOtp;
  const verified = await request('POST', '/api/auth/verify-otp', { phone: '+919845011982', otp, role: 'CUSTOMER' });
  const liveToken = verified.data?.token;
  const headers = liveToken ? { 'Authorization': `Bearer ${liveToken}` } : {};
  const wallet = await request('GET', '/api/customer/wallet', null, headers);
  const moneyWrite = await request('POST', '/api/grocery/checkout/validate', {
    merchantId: 'mcht_1', cartItems: CART, deliveryAddress: 'Flat 402, Civil Lines Hub, North Delhi'
  }, { ...headers, 'Idempotency-Key': 'chaos_outage_money' });

  const outcome = `send-otp ${probes.sendOtp.status}` +
    `${probes.sendOtp.status !== 200 ? ` (${probes.sendOtp.data?.code || probes.sendOtp.data?.error})` : ''}, ` +
    `verify-otp ${verified.status} issued ${liveToken ? 'a session token' : 'no token'}, admin login ` +
    `${probes.adminLogin.status} issued ${probes.adminLogin.data?.token ? 'a token' : 'no token'}`;
  if (liveToken || probes.adminLogin.data?.token || probes.sendOtp.data?.testOtp) {
    record('CH-10e', 'FINDING',
      `auth kept working from the in-memory fallback while PostgreSQL was down: ${outcome}. ` +
      `None of those responses carries a degraded/persisted flag, yet no session or login record can ` +
      `reach PostgreSQL, so credentials minted in this window vanish on restart and leave no audit trail.`,
      'medium');
  } else {
    record('CH-10e', 'NOTE',
      `auth failed closed while PostgreSQL was down rather than signing anyone in from the ` +
      `in-memory copy: ${outcome}`, 'low');
  }

  const moneyClosed = !liveToken || (moneyWrite.status >= 400 && wallet.status >= 400);
  if (liveToken) {
    expectSafe('CH-10f', moneyClosed,
      `with a valid in-outage session, wallet read answered ${wallet.status} and a grocery checkout ` +
      `answered ${moneyWrite.status} (${JSON.stringify(moneyWrite.data?.code || moneyWrite.data?.error || '').slice(0, 60)}) - ` +
      `the money path must not complete without the database`, 'critical');
  } else {
    record('CH-10f', 'NOTE',
      `not exercised: auth already failed closed above, so no in-outage session existed to carry a ` +
      `wallet read (${wallet.status}) or a grocery checkout (${moneyWrite.status}) to the money path. ` +
      `The refusal happened one step earlier, at credential issue.`, 'low');
  }

  // Failing closed is correct; naming the fault is not. A missing merchant and a
  // missing database must not look the same to a client, a dashboard or an alert.
  // Only judge this when an in-outage session actually reached the data path.
  if (liveToken) {
    const mislabelled = [wallet, moneyWrite].filter(r => r.status >= 400 &&
      !/DATABASE|SERVICE_UNAVAILABLE|DEGRADED|UNAVAILABLE|TIMEOUT/i.test(String(r.data?.code || '')));
    record('CH-10g', mislabelled.length ? 'FINDING' : 'PASS',
      `${mislabelled.length} of 2 outage failures reported a business-rule code instead of an ` +
      `infrastructure one (checkout said "${moneyWrite.data?.code || 'none'}", wallet said ` +
      `"${wallet.data?.code || 'none'}"), so an outage is indistinguishable from bad input in logs, ` +
      `metrics and client retry logic`, mislabelled.length ? 'medium' : 'info');
  }
}

  // ------------------------------------------------- FINANCIAL INVARIANTS (whole DB)
// These are data-level assertions over everything the races and the suites have
// written, so a scenario that "degraded safely" still has to leave the books true.
async function invariants() {
  const { Client } = require('pg');
  const url = process.env.DATABASE_URL || '';
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { host = ''; }
  if (!LOCAL_HOSTS.includes(host)) {
    record('FI', 'BLOCKED', `refusing invariant queries against host "${host || 'unparseable'}"`, 'high');
    return;
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const one = async sql => (await client.query(sql)).rows[0];

  try {
    // Rows written by the older hand-run Phase 9 forensic probes are append-only
    // fixtures (₹1 lines and authorisations with no matching app-side bookkeeping).
    // They are excluded from the app invariants but counted and reported, so the
    // exclusion is visible rather than a way to hide a real imbalance.
    const probeHeaders = `select id from journal_transactions where lower(coalesce(description,'')) like '%probe%'`;
    const residue = await one(`
      select (select count(*) from journal_transactions where lower(coalesce(description,'')) like '%probe%') probe_headers,
             (select count(*) from journal_lines jl where lower(coalesce(jl.notes,'')) like '%probe%') probe_lines,
             (select count(*) from payment_refund_authorizations r
               where r.authorized_by = 'PHASE9_TEST' or lower(coalesce(r.reason,'')) like '%probe%') probe_auths`);
    record('FI-00', 'NOTE', `${residue.probe_headers} journal headers, ${residue.probe_lines} journal lines and ` +
      `${residue.probe_auths} refund authorisations were inserted directly by hand-run Phase 9 probes on ` +
      `2026-09-16; they are excluded from FI-01..FI-03 and should be cleaned out of any environment that ` +
      `reports audited books`, 'info');

    // ------------------------------------------------ FI-01 headers reconcile lines
    const journals = await one(`
      with sums as (
        select journal_id,
               coalesce(sum(case when entry_type='DEBIT'  then amount else 0 end),0) d,
               coalesce(sum(case when entry_type='CREDIT' then amount else 0 end),0) c
        from journal_lines group by journal_id
      )
      select count(*) filter (
               where abs(jt.total_debit - coalesce(s.d,0)) > 0.005
                  or abs(jt.total_credit - coalesce(s.c,0)) > 0.005
             ) as mismatched,
             count(*) as headers
      from journal_transactions jt left join sums s on s.journal_id = jt.id
      where jt.id not in (${probeHeaders})`);
    expectSafe('FI-01', Number(journals.mismatched) === 0,
      `${journals.headers} journal headers written by application paths: ${journals.mismatched} do not ` +
      `reconcile with their own lines`, 'critical');

    // ------------------------------------------------------- FI-02 books stay level
    const level = await one(`
      select (select coalesce(sum(total_debit),0) from journal_transactions
               where id not in (${probeHeaders})) hd,
             (select coalesce(sum(total_credit),0) from journal_transactions
               where id not in (${probeHeaders})) hc,
             (select coalesce(sum(amount),0) from journal_lines
               where entry_type='DEBIT' and journal_id not in (${probeHeaders})) ld,
             (select coalesce(sum(amount),0) from journal_lines
               where entry_type='CREDIT' and journal_id not in (${probeHeaders})) lc`);
    expectSafe('FI-02', Number(level.hd) === Number(level.hc) && Number(level.ld) === Number(level.lc),
      `application books balance: headers ₹${level.hd} debit vs ₹${level.hc} credit; ` +
      `lines ₹${level.ld} debit vs ₹${level.lc} credit`, 'critical');

    // ------------------------------------------------------ FI-03 refunds bounded
    const refunds = await one(`
      select count(*) filter (where coalesce(refunded_amount,0) > amount) over_refunded,
             count(*) filter (where coalesce(refunded_amount,0) < 0) negative,
             count(*) payments
      from payments`);
    const refundRecon = await one(`
      select count(*) disagree from (
        select p.payment_id, p.refunded_amount, coalesce(sum(r.amount),0) recorded
        from payments p
        left join payment_refund_authorizations r
          on r.payment_id = p.payment_id
         and not (r.authorized_by = 'PHASE9_TEST' or lower(coalesce(r.reason,'')) like '%probe%')
        group by p.payment_id, p.refunded_amount
        having abs(p.refunded_amount - coalesce(sum(r.amount),0)) > 0.005
      ) d`);
    const dupeKeys = await one(`
      select count(*) dupes from (
        select idempotency_key from payment_refund_authorizations
        where idempotency_key is not null
          and not (authorized_by = 'PHASE9_TEST' or lower(coalesce(reason,'')) like '%probe%')
        group by idempotency_key having count(*) > 1
      ) d`);
    expectSafe('FI-03', Number(refunds.over_refunded) === 0 && Number(refunds.negative) === 0 &&
      Number(refundRecon.disagree) === 0 && Number(dupeKeys.dupes) === 0,
      `${refunds.payments} payments: ${refunds.over_refunded} over-refunded, ${refunds.negative} negative, ` +
      `${refundRecon.disagree} whose refunded_amount disagrees with the authorisation ledger, ` +
      `${dupeKeys.dupes} reused refund keys`, 'critical');

    // ---------------------------------------------- FI-04 checkout arithmetic holds
    const checkout = await one(`
      select count(*) rows_total,
             count(*) filter (where discount_amount > base_amount) disc_over_base,
             count(*) filter (where final_payable_amount < 0) negative_payable,
             count(*) filter (where abs(final_payable_amount -
               (base_amount + coalesce(surcharge_amount,0) - coalesce(discount_amount,0))) > 0.005) formula_break
      from checkouts`);
    expectSafe('FI-04', Number(checkout.disc_over_base) === 0 && Number(checkout.negative_payable) === 0 &&
      Number(checkout.formula_break) === 0,
      `${checkout.rows_total} checkout rows: ${checkout.disc_over_base} discounts above the base, ` +
      `${checkout.negative_payable} negative payables, ${checkout.formula_break} where payable != ` +
      `base + surcharge - discount`, 'critical');

    // ------------------------------------------------- FI-05 order mirrors checkout
    const orderMirror = await one(`
      select count(*) linked,
             count(*) filter (where abs(o.total_amount - c.final_payable_amount) > 0.005) mismatched
      from orders o join checkouts c on c.id = o.checkout_id`);
    expectSafe('FI-05', Number(orderMirror.mismatched) === 0,
      `${orderMirror.linked} orders backed by a checkout row, ${orderMirror.mismatched} whose stored ` +
      `total_amount differs from the checkout payable`, 'critical');

    // -------------------------------------------------- FI-06 no negative balances
    const balances = await one(`
      select (select count(*) from users where wallet_balance < 0) cust_neg,
             (select count(*) from drivers where wallet_balance < 0) drv_neg,
             (select count(*) from merchants where wallet_balance < 0) mer_neg`);
    expectSafe('FI-06', Number(balances.cust_neg) + Number(balances.drv_neg) + Number(balances.mer_neg) === 0,
      `negative wallet balances: customers=${balances.cust_neg} drivers=${balances.drv_neg} ` +
      `merchants=${balances.mer_neg}`, 'critical');

    // ------------------------------------------------- FI-07 promotion counters true
    const promos = await one(`
      select count(*) filter (where p.usage_count <> coalesce(r.n,0)) counter_off,
             count(*) filter (where p.total_usage_limit is not null
                              and p.total_usage_limit > 0 and coalesce(r.n,0) > p.total_usage_limit) cap_broken,
             count(*) filter (where coalesce(r.per_user,0) > p.per_user_limit) per_user_broken,
             count(*) total
      from promotions p
      left join (
        select promotion_id, sum(c) n, max(c) per_user from (
          select promotion_id, user_id, count(*) c from promotion_redemptions
          group by promotion_id, user_id
        ) x group by promotion_id
      ) r on r.promotion_id = p.id`);
    expectSafe('FI-07', Number(promos.counter_off) === 0 && Number(promos.cap_broken) === 0 &&
      Number(promos.per_user_broken) === 0,
      `${promos.total} promotions: ${promos.counter_off} with usage_count out of step with redemption rows, ` +
      `${promos.cap_broken} past a global cap, ${promos.per_user_broken} past a per-user limit`, 'critical');

    // ---------------------------- FI-08 one settlement per trip, however many retries
    const settle = await one(`
      with posted as (
        select (regexp_match(description, 'JOB-[0-9]+-[0-9]+'))[1] job_no, sum(total_debit) booked
        from journal_transactions where description ~ 'JOB-[0-9]+-[0-9]+'
        group by 1
      )
      select count(*) filter (where p.job_no is not null) settled_jobs,
             count(*) filter (where p.job_no is not null and j.driver_earnings > 0
                              and p.booked > j.driver_earnings * 2 + 0.005) over_settled,
             string_agg(distinct case when p.job_no is not null and j.driver_earnings > 0
                   and p.booked > j.driver_earnings * 2 + 0.005 then p.job_no end, ',') offenders
      from jobs j left join posted p on p.job_no = j.job_number`);
    expectSafe('FI-08', Number(settle.over_settled) === 0,
      `${settle.settled_jobs} completed jobs with ledger activity: ${settle.over_settled} booked more than ` +
      `the driver's entitlement allows (jobs: ${settle.offenders || 'none'})`, 'critical');
  } finally {
    await client.end();
  }
}

function report() {
  const byVerdict = results.reduce((acc, r) => { acc[r.verdict] = (acc[r.verdict] || 0) + 1; return acc; }, {});
  const bad = results.filter(r => r.verdict === 'FAIL' || r.verdict === 'FINDING');

  console.log('\n================ CHAOS / RESILIENCE AUDIT ================');
  console.log(`scenarios: ${results.length}  |  ${Object.entries(byVerdict).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  if (bad.length) {
    console.log('\nFindings requiring attention:');
    for (const r of bad) console.log(`  - [${r.id}] (${r.severity}) ${r.detail}`);
  }
  console.log('\nA PASS here means only that the tested failure scenario behaved safely under the');
  console.log('injected fault. It is not evidence that no other fault mode exists.');
  console.log('==========================================================');

  process.exit(bad.some(r => r.severity === 'critical' || r.severity === 'high') ? 1 : 0);
}

main().catch(err => {
  console.error('CHAOS AUDIT ABORTED:', err.message);
  process.exit(2);
});
