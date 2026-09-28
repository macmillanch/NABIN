// =========================================================================
// HYDRATION-READ OUTAGE FALLBACK CHECKS (local only)
//
// This pins OWNER DECISION 11, choice B (docs/OWNER_SECURITY_DECISIONS.md):
// money / identity hydration reads may continue using hydrated memory when
// PostgreSQL is unavailable. That is the accepted semantics — deliberately NOT
// changed to a fail-closed 503 like the checkout resolvers were. These checks
// exist to lock that choice in, so a future "helpful" sweep that converts one
// of these read-through caches to 503 shows up here as a failure rather than
// silently reversing the owner's decision.
//
// Proof, using the same closed-port-on-127.0.0.1 technique as the auth suite so
// nothing touches a hosted environment:
//
//   1. store_down  — with the store unreachable, a row that IS hydrated in
//      memory still answers. It must come back from the cached copy, must not
//      throw, and must not surface a false 503. (PaymentRepository answers via
//      its try/catch -> memory fallback; the cache-first user/driver reads
//      answer before the store is ever consulted.)
//   2. store_live  — against the real local store, a genuine not-found is still
//      a null/miss, NOT an outage. Choice B never dresses an empty result up as
//      a 503; preserving genuine not-found is part of the decision.
// =========================================================================

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      message: err && err.message
    }));
}

async function runChild(scenario) {
  const out = { scenario, ok: false };
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');
  const isFalseOutage = (r) => r.threw && r.status === 503 && isStoreUnreachable(r);

  if (scenario === 'store_down') {
    // 1a. Payment session: the read is guarded by try/catch, so a store that
    // rejects falls through to the in-memory map — the money read keeps answering
    // from the hydrated copy instead of failing.
    const payId = crypto.randomUUID();
    db.paymentSessions = db.paymentSessions || new Map();
    db.paymentSessions.set(payId, { id: payId, orderId: payId, status: 'PAYMENT_PENDING', source: 'memory-sentinel' });
    const pay = await outcome(() => db.paymentRepo.getPaymentSession(payId));
    out.paymentFallback = {
      threw: pay.threw,
      answered: pay.threw === false && pay.value && pay.value.source === 'memory-sentinel',
      falseOutage: isFalseOutage(pay)
    };
    // 1b. A payment the memory does not hold, with the store down, must resolve to
    // a plain miss (null / undefined) — never a false 503.
    const payMiss = await outcome(() => db.paymentRepo.getPaymentSession(crypto.randomUUID()));
    out.paymentMiss = {
      threw: payMiss.threw,
      isMiss: payMiss.threw === false && (payMiss.value === null || payMiss.value === undefined),
      falseOutage: isFalseOutage(payMiss)
    };

    // 2a. Identity reads are cache-first: a hydrated user answers before the store
    // is touched, so an outage never turns it into a 503.
    const userUuid = crypto.randomUUID();
    const userPhone = '+9190000' + String(Math.floor(Math.random() * 90000) + 10000);
    db.users = db.users || [];
    db.users.push({ id: userUuid, uuid: userUuid, phone: userPhone, name: 'Hydration Sentinel' });
    const byId = await outcome(() => db.userRepo.findByIdAsync(userUuid));
    out.userById = {
      threw: byId.threw,
      answered: byId.threw === false && byId.value && byId.value.id === userUuid,
      falseOutage: isFalseOutage(byId)
    };
    const byPhone = await outcome(() => db.userRepo.findByPhoneAsync(userPhone));
    out.userByPhone = {
      threw: byPhone.threw,
      answered: byPhone.threw === false && byPhone.value && byPhone.value.phone &&
        String(byPhone.value.phone).replace(/\D/g, '').endsWith(userPhone.replace(/\D/g, '').slice(-5)),
      falseOutage: isFalseOutage(byPhone)
    };

    // 2b. Same guarantee for the driver identity read.
    const drvUuid = crypto.randomUUID();
    db.drivers = db.drivers || [];
    db.drivers.push({ id: drvUuid, uuid: drvUuid, name: 'Driver Sentinel' });
    const drv = await outcome(() => db.driverRepo.findByIdAsync(drvUuid));
    out.driverById = {
      threw: drv.threw,
      answered: drv.threw === false && drv.value && drv.value.id === drvUuid,
      falseOutage: isFalseOutage(drv)
    };

    out.ok =
      out.paymentFallback.answered === true && out.paymentFallback.threw === false && !out.paymentFallback.falseOutage &&
      out.paymentMiss.isMiss === true && !out.paymentMiss.falseOutage &&
      out.userById.answered === true && !out.userById.falseOutage &&
      out.userByPhone.answered === true && !out.userByPhone.falseOutage &&
      out.driverById.answered === true && !out.driverById.falseOutage;
  } else if (scenario === 'store_live') {
    // Against the real local PostgreSQL: a record that genuinely does not exist
    // is a null / a business miss, never an outage. Choice B preserves genuine
    // not-found and never invents a 503 for an empty result.
    const rand = crypto.randomUUID();
    const pay = await outcome(() => db.paymentRepo.getPaymentSession(rand));
    out.paymentGenuineMiss = {
      isMiss: pay.threw === false && (pay.value === null || pay.value === undefined),
      falseOutage: isFalseOutage(pay)
    };
    const user = await outcome(() => db.userRepo.findByIdAsync(rand));
    out.userGenuineMiss = {
      isNull: user.threw === false && user.value === null,
      falseOutage: isFalseOutage(user)
    };
    const drv = await outcome(() => db.driverRepo.findByIdAsync(rand));
    out.driverGenuineMiss = {
      isNull: drv.threw === false && drv.value === null,
      falseOutage: isFalseOutage(drv)
    };
    out.ok = out.paymentGenuineMiss.isMiss && !out.paymentGenuineMiss.falseOutage &&
      out.userGenuineMiss.isNull && !out.userGenuineMiss.falseOutage &&
      out.driverGenuineMiss.isNull && !out.driverGenuineMiss.falseOutage;
  }
  console.log(JSON.stringify(out));
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'hydration_fallback_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_HYDRATION_CHILD: scenario, ...env }
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch (e) { /* reported below */ }
  if (!parsed) {
    return { ok: false, detail: `child printed no verdict: ${(res.stdout || '') + (res.stderr || '')}`.slice(0, 400) };
  }
  return parsed;
}

async function main() {
  const down = spawnChild('store_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key'
  });
  check('HYD-01', down.paymentFallback && down.paymentFallback.answered && !down.paymentFallback.falseOutage,
    `with the store unreachable, a hydrated payment session still answers from memory (choice B), not a ` +
    `false 503 (threw=${down.paymentFallback && down.paymentFallback.threw})${down.detail ? ' ' + down.detail : ''}`);
  check('HYD-02', down.paymentMiss && down.paymentMiss.isMiss && !down.paymentMiss.falseOutage,
    `a payment the memory does not hold, store down, is a plain miss and never a false outage ` +
    `(threw=${down.paymentMiss && down.paymentMiss.threw})`);
  check('HYD-03', down.userById && down.userById.answered && !down.userById.falseOutage,
    `a hydrated user read by id answers from memory during an outage (id=${!!down.userById})`);
  check('HYD-04', down.userByPhone && down.userByPhone.answered && !down.userByPhone.falseOutage,
    `and a hydrated user read by phone does too (answered=${down.userByPhone && down.userByPhone.answered})`);
  check('HYD-05', down.driverById && down.driverById.answered && !down.driverById.falseOutage,
    `and a hydrated driver read by id keeps answering during an outage (answered=${down.driverById && down.driverById.answered})`);

  const live = spawnChild('store_live', { NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'true' });
  check('HYD-06', live.paymentGenuineMiss && live.paymentGenuineMiss.isMiss && !live.paymentGenuineMiss.falseOutage,
    `against the live store a genuinely absent payment session is a miss, not an outage ` +
    `(isMiss=${live.paymentGenuineMiss && live.paymentGenuineMiss.isMiss})${live.detail ? ' ' + live.detail : ''}`);
  check('HYD-07', live.userGenuineMiss && live.userGenuineMiss.isNull && !live.userGenuineMiss.falseOutage,
    `and a genuinely absent user read is null, not an outage (isNull=${live.userGenuineMiss && live.userGenuineMiss.isNull})`);
  check('HYD-08', live.driverGenuineMiss && live.driverGenuineMiss.isNull && !live.driverGenuineMiss.falseOutage,
    `and a genuinely absent driver read is null, not an outage (isNull=${live.driverGenuineMiss && live.driverGenuineMiss.isNull})`);

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 HYDRATION-READ FALLBACK (Decision 11 / choice B): ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  process.exit(failed.length ? 1 : 0);
}

if (process.env.NABIN_HYDRATION_CHILD) {
  runChild(process.env.NABIN_HYDRATION_CHILD).catch(err => {
    console.log(JSON.stringify({ scenario: process.env.NABIN_HYDRATION_CHILD, ok: false, crashed: err.message }));
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('HYDRATION-READ FALLBACK ABORTED:', err.message);
    process.exit(2);
  });
}
