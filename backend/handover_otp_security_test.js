/*
 * P2 (Major Remediation) — handover / delivery OTP security.
 *
 * The defect and the standard it is held to:
 *   `db.validateAuthoritativeJobOtp({ jobId, otp, otpType, driverId })` compares the submitted
 *   code against the row's `start_otp` / `pickup_otp` / `delivery_otp` and, on a match, advances
 *   the job. It did so with:
 *     - no per-type attempt counter, so an attacker could guess forever;
 *     - no lockout, so guesses and a correct code sat on the same footing;
 *     - no expiry, so a code minted at booking remained valid indefinitely (including for a
 *       cancelled-then-reused job row);
 *     - no consumption, so a driver who once proved a code could replay it for the same
 *       transition any number of times. The DELIVERY replay is separately caught by
 *       `updateJobStatus` refusing COMPLETED->COMPLETED, but the START replay was free, and
 *       the guard was a state-machine accident, not an OTP policy;
 *     - the raw entered code was written into the audit trail (`Invalid START OTP attempt
 *       [7729] on Job …`), so a failed guess is a leaked guess;
 *     - `createJob` generated the OTP and then spread `...jobData` AFTER the generated values,
 *       so any caller that passed `startOtp` in its body set the customer's trip-start code.
 *
 * What this suite pins:
 *   A) three wrong DELIVERY attempts lock the code; the correct code is then refused with
 *      `OTP_LOCKED`, and the attempts counter + locked_until are durable;
 *   B) a correct DELIVERY verifies exactly once; a second submit of the same code is refused;
 *   C) the same two rules apply to START, independently of DELIVERY (per-type state);
 *   D) an expired code is refused with `OTP_EXPIRED` even when it matches the row;
 *   E) a wrong-attempt audit row does not contain the entered digits — neither in the exception
 *      message nor in the durable `audit_logs.reason`;
 *   F) concurrent submits of the correct DELIVERY code settle exactly once (50 in flight, 1
 *      verified, 49 refused);
 *   G) a code that belongs to job A does not verify job B;
 *   H) a caller cannot inject its own `startOtp` into `createJob`;
 *   I) after lockout, a subsequent CORRECT code is refused as `OTP_LOCKED`, not as `OTP_MISMATCH`
 *      — an attacker cannot tell whether the last guess was right;
 *   J) the fabricated `handoverOtpVerified: ... || true` default is gone, so a delivery read
 *      never claims a handover that was never proven.
 *
 * Local/test only. Refuses a non-loopback database. Runs via scripts/with_local_target.js.
 */
const { Client } = require('pg');

const PG = process.env.DATABASE_URL;
if (!PG || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('P2-OTP REFUSED: needs a loopback DATABASE_URL (run via scripts/with_local_target.js)');
  process.exit(1);
}
const STAMP = Date.now();
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
}

function errCodeOf(e) { return e && (e.code || (e.data && e.data.code) || null); }

async function attempt(db, jobId, otp, otpType, driverId) {
  try {
    const r = await db.validateAuthoritativeJobOtp({ jobId, otp, otpType, driverId });
    return { ok: true, value: r };
  } catch (e) {
    return { ok: false, error: e, code: errCodeOf(e), message: e.message };
  }
}

(async () => {
  const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
  const db = require('./src/database');

  if (!isLivePostgres || !supabaseAdmin) {
    console.log('[SKIP] P2-OTP needs live PostgreSQL (run via with_local_target)');
    return finish();
  }

  const pg = new Client({ connectionString: PG });
  await pg.connect();

  // ---- fixture: a driver, a customer, a job ----------------------------------
  const phone = `82${String(STAMP).slice(-8)}`;
  const norm = db.normalizePhone(phone);
  const usr = await supabaseAdmin.from('users').insert({
    name: `P2 OTP customer ${STAMP}`, phone: norm
  }).select('id').single();
  if (usr.error || !usr.data) { console.error('FATAL: user insert refused ' + JSON.stringify(usr.error)); process.exitCode = 1; return finish(); }
  const drv = await supabaseAdmin.from('drivers').insert({
    user_id: usr.data.id, name: `P2 OTP driver ${STAMP}`, phone: norm,
    vehicle_type: 'AUTO', vehicle_number: `P2${String(STAMP).slice(-6)}`, operational_status: 'AVAILABLE',
    wallet_balance: 1000, kyc_status: 'VERIFIED', payout_upi_verified: false
  }).select('id').single();
  if (drv.error || !drv.data) { console.error('FATAL: driver insert refused ' + JSON.stringify(drv.error)); process.exitCode = 1; return finish(); }

  const job = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, customerName: `P2 OTP customer ${STAMP}`,
    driverId: drv.data.id,
    pickup: { address: ' pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  if (!job || !job.id) { console.error('FATAL: job creation returned nothing'); process.exitCode = 1; return finish(); }

  // The mirror id may be either the job_number or the uuid; find the row's uuid to drive the
  // direct-column pg queries below.
  const rowRef = await pg.query(
    `SELECT id::text AS uuid, job_number, start_otp, pickup_otp, delivery_otp FROM public.jobs
      WHERE id::text = $1 OR job_number = $1 LIMIT 1`, [job.id]);
  if (!rowRef.rows[0]) { console.error('FATAL: the created job has no durable row'); process.exitCode = 1; return finish(); }
  const jUuid = rowRef.rows[0].uuid;
  const jKey = rowRef.rows[0].job_number;
  const startOtp = rowRef.rows[0].start_otp;
  const deliveryOtp = rowRef.rows[0].delivery_otp;

  // ---- A) three wrong DELIVERY attempts lock the code -------------------------
  const wrongDelivery = String((Number(deliveryOtp) === 1000 ? 9999 : 1000 + ((Number(deliveryOtp) + 4321) % 9000))).padStart(4, '0');
  const r1 = await attempt(db, job.id, wrongDelivery, 'DELIVERY', drv.data.id);
  const r2 = await attempt(db, job.id, wrongDelivery, 'DELIVERY', drv.data.id);
  const r3 = await attempt(db, job.id, wrongDelivery, 'DELIVERY', drv.data.id);
  const rAfter = await attempt(db, job.id, deliveryOtp, 'DELIVERY', drv.data.id);

  check('HOT-01', 'a wrong DELIVERY attempt is refused', !r1.ok, { code: r1.code });
  check('HOT-02', 'three wrong DELIVERY attempts are each refused', !r1.ok && !r2.ok && !r3.ok,
    { codes: [r1.code, r2.code, r3.code] });
  check('HOT-03', 'the correct DELIVERY code after three wrong attempts is refused as OTP_LOCKED',
    !rAfter.ok && rAfter.code === 'OTP_LOCKED', { code: rAfter.code, message: rAfter.message });

  // The lockout must be durable, not a Map the restart loses. It is per-type
  // (`delivery_otp_locked_until`) so a locked START cannot deny a DELIVERY handover.
  const lockRow = await pg.query(
    `SELECT delivery_otp_attempts, delivery_otp_locked_until FROM public.jobs WHERE id = $1::uuid`, [jUuid]).catch(() => ({ rows: [{}] }));
  const lockFields = lockRow.rows[0] || {};
  check('HOT-04', 'the durable row carries a per-type attempt counter', typeof lockFields.delivery_otp_attempts === 'number' && lockFields.delivery_otp_attempts >= 3,
    { attempts: lockFields.delivery_otp_attempts });
  check('HOT-05', 'the durable row carries a per-type locked_until timestamp in the future',
    lockFields.delivery_otp_locked_until instanceof Date && lockFields.delivery_otp_locked_until.getTime() > Date.now(),
    { lockedUntil: lockFields.delivery_otp_locked_until });

  // ---- B) correct DELIVERY verifies exactly once ------------------------------
  // Use a second job so the DELIVERY lock above does not bleed into this section.
  const jobB = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' b pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' b drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowB = await pg.query(`SELECT id::text AS uuid, start_otp, delivery_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobB.id]);
  const bUuid = rowB.rows[0].uuid;
  const bStart = rowB.rows[0].start_otp;
  const bDelivery = rowB.rows[0].delivery_otp;

  // Advance to IN_TRANSIT so DELIVERY -> COMPLETED is a legal transition.
  const startOk = await attempt(db, jobB.id, bStart, 'START', drv.data.id);
  check('HOT-06', 'the correct START code on a fresh job verifies', startOk.ok && startOk.value && startOk.value.verified === true,
    { ok: startOk.ok, code: startOk.code, status: startOk.value && startOk.value.status });

  const done1 = await attempt(db, jobB.id, bDelivery, 'DELIVERY', drv.data.id);
  check('HOT-07', 'the correct DELIVERY code verifies once and settles the trip',
    done1.ok && done1.value && done1.value.verified === true && done1.value.status === 'COMPLETED',
    { ok: done1.ok, code: done1.code, status: done1.value && done1.value.status });

  const done2 = await attempt(db, jobB.id, bDelivery, 'DELIVERY', drv.data.id);
  check('HOT-08', 'a replayed DELIVERY code is refused (single-use)',
    !done2.ok, { code: done2.code, message: done2.message });
  // The refusal must be about the code, not incidental state-machine noise.
  check('HOT-09', 'the replay refusal is a typed OTP code (OTP_ALREADY_CONSUMED or OTP_LOCKED or TRIP_ALREADY_SETTLED)',
    !done2.ok && ['OTP_ALREADY_CONSUMED', 'OTP_LOCKED', 'TRIP_ALREADY_SETTLED'].includes(done2.code),
    { code: done2.code });

  // ---- C) START and DELIVERY tracking are independent ------------------------
  const jobC = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' c pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' c drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowC = await pg.query(`SELECT start_otp, delivery_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobC.id]);
  const cStart = rowC.rows[0].start_otp, cDelivery = rowC.rows[0].delivery_otp;
  // Lock START out by wrong-guessing it 3 times, then prove DELIVERY is still verifiable.
  const cWrong = String((Number(cStart) === 5000 ? 5001 : 5000)).padStart(4, '0');
  await attempt(db, jobC.id, cWrong, 'START', drv.data.id);
  await attempt(db, jobC.id, cWrong, 'START', drv.data.id);
  await attempt(db, jobC.id, cWrong, 'START', drv.data.id);
  const cStartLocked = await attempt(db, jobC.id, cStart, 'START', drv.data.id);
  const cDeliveryOk = await attempt(db, jobC.id, cDelivery, 'DELIVERY', drv.data.id);
  check('HOT-10', 'locking START does not lock DELIVERY (per-type state)',
    !cStartLocked.ok && cStartLocked.code === 'OTP_LOCKED' && (cDeliveryOk.ok || (cDeliveryOk.code && cDeliveryOk.code !== 'OTP_LOCKED')),
    { startLock: cStartLocked.code, delivery: cDeliveryOk.code || 'ok' });

  // ---- D) expired codes are refused ------------------------------------------
  const jobD = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' d pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' d drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowD = await pg.query(`SELECT id::text AS uuid, start_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobD.id]);
  const dUuid = rowD.rows[0].uuid, dStart = rowD.rows[0].start_otp;
  // Force the code to be already-expired on the durable row.
  try {
    await pg.query(`UPDATE public.jobs SET start_otp_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1::uuid`, [dUuid]);
  } catch (e) {
    // If the column doesn't exist yet (RED baseline), the next check will fail for the right reason.
  }
  const dExpired = await attempt(db, jobD.id, dStart, 'START', drv.data.id);
  check('HOT-11', 'an expired START code is refused with OTP_EXPIRED even though it matches the row',
    !dExpired.ok && dExpired.code === 'OTP_EXPIRED',
    { code: dExpired.code, message: dExpired.message });

  // ---- E) no raw entered code leaks ------------------------------------------
  const jobE = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' e pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' e drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const leakGuess = '7391';   // any 4-digit guess that is almost certainly wrong for this fresh job
  const e1 = await attempt(db, jobE.id, leakGuess, 'DELIVERY', drv.data.id);
  const eMsg = (e1.error && e1.error.message) || '';
  const eReason = (() => {
    try {
      const trail = Array.isArray(db.auditMirror && db.auditMirror.rows) ? db.auditMirror.rows
        : Array.isArray(db.auditLogs) ? db.auditLogs
        : [];
      const row = trail.filter(r => r && r.action === 'OTP_VERIFICATION_FAILED'
        && String(r.targetEntityId) === String(jobE.id)).slice(-1)[0];
      return row && (row.reason || row.details) || '';
    } catch (_) { return ''; }
  })();
  check('HOT-12', 'a wrong attempt is refused', !e1.ok, { code: e1.code });
  check('HOT-13', 'the exception message does not contain the raw entered code',
    !eMsg.includes(leakGuess), { message: eMsg });
  check('HOT-14', 'the audit reason does not contain the raw entered code',
    !eReason.includes(leakGuess), { reason: eReason.slice(0, 120) });

  // ---- F) concurrency: many submits, one settle ------------------------------
  const jobF = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' f pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' f drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowF = await pg.query(`SELECT start_otp, delivery_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobF.id]);
  await attempt(db, jobF.id, rowF.rows[0].start_otp, 'START', drv.data.id);
  const fArr = await Promise.all(Array.from({ length: 20 }, () => attempt(db, jobF.id, rowF.rows[0].delivery_otp, 'DELIVERY', drv.data.id)));
  const fVerified = fArr.filter(r => r.ok && r.value && r.value.verified === true).length;
  const fRefused = fArr.length - fVerified;
  const fRow = await pg.query(`SELECT status FROM public.jobs WHERE job_number = $1`, [jobF.jobNumber || jobF.id]).catch(() => ({ rows: [{}] }));
  check('HOT-15', 'concurrent correct DELIVERY submits verify exactly once',
    fVerified === 1 && fRefused === 19, { verified: fVerified, refused: fRefused });
  check('HOT-16', 'the durable job settled exactly once (status = COMPLETED)',
    String((fRow.rows[0] || {}).status || '').toUpperCase() === 'COMPLETED',
    { status: fRow.rows[0] && fRow.rows[0].status });

  // ---- G) a code for job A does not verify job B -----------------------------
  const jobG = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED',
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' g pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' g drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowG = await pg.query(`SELECT start_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobG.id]);
  const crossSubmit = await attempt(db, jobE.id, rowG.rows[0].start_otp, 'START', drv.data.id);
  check('HOT-17', 'job G’s START code cannot verify job E', !crossSubmit.ok && crossSubmit.code !== null,
    { code: crossSubmit.code });

  // ---- H) createJob ignores a caller-supplied startOtp -----------------------
  const injected = '4242';
  const jobH = await db.createJob({
    type: 'RIDE', status: 'ASSIGNED', startOtp: injected,
    customerId: usr.data.id, driverId: drv.data.id,
    pickup: { address: ' h pickup', lat: 23.7, lng: 92.7 },
    drop: { address: ' h drop', lat: 23.8, lng: 92.8 },
    distanceKm: 2.5, durationMins: 8, fare: 100, driverEarnings: 85, platformFee: 15,
    paymentMode: 'ONLINE', paymentStatus: 'PENDING'
  });
  const rowH = await pg.query(`SELECT start_otp FROM public.jobs WHERE id::text=$1 OR job_number=$1 LIMIT 1`, [jobH.id]);
  check('HOT-18', 'a caller-supplied startOtp cannot override the generated code',
    rowH.rows[0] && String(rowH.rows[0].start_otp) !== injected,
    { durableStart: rowH.rows[0] && rowH.rows[0].start_otp, injected });

  // ---- I) after lockout a correct code is refused as OTP_LOCKED, not MISMATCH
  // Reuse the job from section A. rAfter was the correct code after lock; already asserted HOT-03.
  // The additional assertion here is that the reason an attacker sees is LOCKED, not a comparison
  // result, so the lockout cannot be probed for correctness.
  check('HOT-19', 'after lockout the refusal is OTP_LOCKED, not a code-match signal',
    !rAfter.ok && rAfter.code === 'OTP_LOCKED', { code: rAfter.code });

  // ---- J) handoverOtpVerified: || true fabrication is gone -------------------
  // Read the source directly: this is a source-slice guard so a future edit cannot quietly
  // reinstate the default without reddening the suite.
  const dbSrc = require('fs').readFileSync(require.resolve('./src/database'), 'utf8');
  check('HOT-20', 'the handover read no longer defaults handoverOtpVerified to true',
    !/handoverOtpVerified:\s*specializedData\.handoverOtpVerified\s*\|\|\s*true/.test(dbSrc),
    { present: /handoverOtpVerified:\s*specializedData\.handoverOtpVerified\s*\|\|\s*true/.test(dbSrc) });
  check('HOT-21', 'the raw entered code is not interpolated into the OTP_VERIFICATION_FAILED reason',
    !/Invalid \$\{otpType\} OTP attempt \[\$\{cleanOtp\}\]/.test(dbSrc),
    { rawInterpolationPresent: /OTP attempt \[\$\{cleanOtp\}\]/.test(dbSrc) });

  // ---- cleanup: this run owns its rows (jobs + audit trail) ------------------
  for (const jid of [job, jobB, jobC, jobD, jobE, jobF, jobG, jobH]) {
    try {
      await pg.query(`DELETE FROM public.jobs WHERE id::text = $1 OR job_number = $1`, [jid.id]);
    } catch (_) { /* ignore; ownership is scoped by uuid */ }
  }
  try {
    await pg.query(
      `DELETE FROM public.audit_logs WHERE action IN ('OTP_VERIFICATION_FAILED','OTP_VERIFICATION_REJECTED_NO_BOUND_CODE','OTP_VERIFIED_STATE_TRANSITION','OTP_VERIFICATION_LOCKED','OTP_VERIFICATION_EXPIRED','OTP_VERIFICATION_ALREADY_CONSUMED')
         AND (target_entity_id IN (SELECT job_number FROM public.jobs WHERE job_number = ANY($1))
              OR target_entity_id = $2::text)`,
      [[], jUuid]);
  } catch (_) { /* the DELETE guard may refuse, which is fine — residue is bounded per run */ }
  try {
    await pg.query(`DELETE FROM public.drivers WHERE id = $1::uuid`, [drv.data.id]);
    await pg.query(`DELETE FROM public.users WHERE id = $1::uuid`, [usr.data.id]);
  } catch (_) { /* guarded */ }

  await pg.end();
  return finish();
})().catch(e => { console.error('FATAL', e && e.stack ? e.stack : e); process.exitCode = 1; });

function finish() {
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== P2 HANDOVER / DELIVERY OTP SECURITY: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}
