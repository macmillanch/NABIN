// Phase 10 audit helper: can the Phase 10 test suite exercise the OTP /
// completion guards behaviourally (in-process) instead of only asserting on
// source text? Probes module load cost and the two real method contracts.
process.env.NABIN_TEST_MODE = 'true';

(async () => {
  const t0 = Date.now();
  const mod = require('./src/database');
  const db = mod.db || mod;
  console.log('module loaded in', Date.now() - t0, 'ms');
  console.log('typeof validateAuthoritativeJobOtp:', typeof db.validateAuthoritativeJobOtp);
  console.log('typeof updateJobStatus:', typeof db.updateJobStatus);
  console.log('typeof getJob:', typeof db.getJob);

  const jobsKey = Array.isArray(db.jobs) ? db.jobs.slice(0, 1).map(j => ({ id: j.id, status: j.status, startOtp: j.startOtp, deliveryOtp: j.deliveryOtp })) : 'not-array';
  console.log('seed jobs sample:', JSON.stringify(jobsKey));

  // F10 behavioural probe: universal code must NOT verify an arbitrary seeded job
  const job = Array.isArray(db.jobs) ? db.jobs.find(j => j.startOtp && j.startOtp !== '7729') : null;
  console.log('job with non-universal startOtp:', job ? job.id + ' start=' + job.startOtp : '(none)');

  if (job) {
    for (const code of ['7729', '4892', '3184']) {
      try {
        const r = await db.validateAuthoritativeJobOtp({ jobId: job.id, otp: code, otpType: 'START', driverId: 'drv_1' });
        console.log(`F10 ${code}: UNEXPECTED SUCCESS status=${r.status}  <-- universal bypass still present`);
      } catch (e) {
        console.log(`F10 ${code}: rejected -> ${e.message.split('\n')[0]}`);
      }
    }
  }
})().catch(e => { console.error('PROBE_ERROR:', e.message); process.exit(1); });