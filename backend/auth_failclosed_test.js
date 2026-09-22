// =========================================================================
// AUTH FAIL-CLOSED CHECKS (local only)
//
// These cover the two things an HTTP suite cannot reach, because both depend on
// how the process was started:
//
//   1. A developer convenience that survives into production. A fixed OTP of
//      7729 is fine on a laptop and is a master key in a deployed backend, so
//      the tests below run a real production-mode process and ask whether the
//      fixed code still opens the door.
//   2. An account store that cannot answer. When PostgREST is unreachable, the
//      old code saw "no rows" — the same shape as "this number is not a driver"
//      — and fell through to a seeded account, so an outage logged people in as
//      somebody else. Refusing with 503 is the whole point.
//
// Nothing here touches a hosted environment: the "unreachable store" is a closed
// port on 127.0.0.1.
// =========================================================================

const path = require('path');
const { spawnSync } = require('child_process');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const OPS_PHONE = '+919800000011';
const OPS_ENROLLED_AS = '+91 98000 00011';

function otpCodeFor(phone, role) {
  const record = require('./src/database').otpStore.get(`${phone}_${role}_LOGIN`);
  return record ? record.otp : null;
}

// --------------------------------------------------------------- in-process
async function convenienceModeChecks() {
  // Set before the first require: supabase.js reads these once, and dotenv does
  // not overwrite what is already set. Without this the resolver would take the
  // PostgreSQL branch and these cases would depend on rows this file does not own.
  process.env.NODE_ENV = '';
  process.env.SUPABASE_POSTGRES_LIVE = 'false';
  const db = require('./src/database');

  const created = db.createAdminAccount({
    username: 'otp_failclosed_ops',
    name: 'Fail Closed Ops',
    email: 'otp-failclosed-ops@nabin.in',
    phone: OPS_ENROLLED_AS,
    role: 'OPERATIONS',
    password: 'Str0ngPassphrase!23'
  });
  check('AUTH-00', created.success === true, `enrolled an OPERATIONS admin against ${OPS_ENROLLED_AS}`);

  // 1. A number nobody enrolled must not become an administrator.
  await db.sendAuthOtp({ phone: '+919800000022', role: 'ADMIN' });
  const strangerCode = otpCodeFor('+919800000022', 'ADMIN');
  let unenrolled = null;
  try {
    unenrolled = await db.verifyAuthOtp({ phone: '+919800000022', otp: strangerCode, role: 'ADMIN' });
  } catch (err) {
    unenrolled = { refused: true, code: err.code, message: err.message };
  }
  check('AUTH-01', unenrolled && unenrolled.refused === true && !unenrolled.token &&
    unenrolled.code === 'ADMIN_PHONE_NOT_ENROLLED',
    'an OTP over an unenrolled number is refused instead of minting an admin session');

  // 2. The refusal is about the admin claim, not the OTP flow itself.
  await db.sendAuthOtp({ phone: '+919800000033', role: 'CUSTOMER' });
  const asCustomer = await db.verifyAuthOtp({
    phone: '+919800000033', otp: otpCodeFor('+919800000033', 'CUSTOMER'), role: 'CUSTOMER'
  });
  check('AUTH-02', asCustomer.success === true && asCustomer.user &&
    db.normalizePhone(asCustomer.user.phone) === '+919800000033',
    'the same number still signs in as the customer it actually is');

  // 3. The account decides the role, not the request body.
  await db.sendAuthOtp({ phone: OPS_PHONE, role: 'ADMIN' });
  const asAdmin = await db.verifyAuthOtp({ phone: OPS_PHONE, otp: otpCodeFor(OPS_PHONE, 'ADMIN'), role: 'ADMIN' });
  check('AUTH-03', asAdmin.success === true && asAdmin.role === 'OPERATIONS' &&
    asAdmin.user && asAdmin.user.username === 'otp_failclosed_ops',
    `a number enrolled as OPERATIONS asking for ADMIN is granted ${asAdmin.role}, not the role it asked for`);

  // 4. Disabling an account has to close both doors it is named for.
  const opsAccount = db.adminUsers.find(a => a.username === 'otp_failclosed_ops');
  opsAccount.status = 'INACTIVE';
  await db.sendAuthOtp({ phone: OPS_PHONE, role: 'ADMIN' });
  let disabled = null;
  try {
    disabled = await db.verifyAuthOtp({ phone: OPS_PHONE, otp: otpCodeFor(OPS_PHONE, 'ADMIN'), role: 'ADMIN' });
  } catch (err) {
    disabled = { refused: true, code: err.code };
  }
  check('AUTH-04', disabled && disabled.refused === true && disabled.code === 'ADMIN_ACCOUNT_DISABLED',
    'a deactivated admin cannot sign in over OTP');

  const byPassword = db.verifyAdminCredentials('otp_failclosed_ops', 'Str0ngPassphrase!23');
  check('AUTH-05', byPassword.success === false,
    'and the correct password does not open the other door either');

  // 5. Two accounts on one number is refused, not resolved to whichever sorts first.
  opsAccount.status = 'ACTIVE';
  db.createAdminAccount({
    username: 'otp_failclosed_ops_two',
    name: 'Second Ops',
    email: 'otp-failclosed-ops-two@nabin.in',
    phone: OPS_ENROLLED_AS,
    role: 'FINANCE_AUDITOR',
    password: 'Str0ngPassphrase!23'
  });
  await db.sendAuthOtp({ phone: OPS_PHONE, role: 'ADMIN' });
  let ambiguous = null;
  try {
    ambiguous = await db.verifyAuthOtp({ phone: OPS_PHONE, otp: otpCodeFor(OPS_PHONE, 'ADMIN'), role: 'ADMIN' });
  } catch (err) {
    ambiguous = { refused: true, code: err.code };
  }
  check('AUTH-06', ambiguous && ambiguous.refused === true &&
    ambiguous.code === 'ADMIN_PHONE_ENROLMENT_AMBIGUOUS',
    'one phone enrolled as two administrators is refused rather than guessed at');
}

// ------------------------------------------------------- child processes
function runChild(scenario) {
  const out = { scenario, ok: false };
  (async () => {
    const db = require('./src/database');
    if (scenario === 'fixed_otp') {
      const sent = await db.sendAuthOtp({ phone: '9810122910', role: 'CUSTOMER' });
      const stored = otpCodeFor('+919810122910', 'CUSTOMER');
      out.echoedTestCode = sent.testOtp !== undefined;
      out.usedFixedCode = stored === '7729';
      let fixedOpens = false;
      try {
        await db.verifyAuthOtp({ phone: '9810122910', otp: '7729', role: 'CUSTOMER' });
        fixedOpens = true;
      } catch (err) {
        out.refusedWith = err.message;
      }
      out.ok = !out.echoedTestCode && !out.usedFixedCode && !fixedOpens;
    } else if (scenario === 'store_down') {
      // The challenge is placed by hand rather than through sendAuthOtp, because
      // dispatch writes an audit row and an outage fails that write first. This
      // scenario is about the verification step choosing an identity.
      const phone = '+919876500099';
      db.otpStore.set(`${phone}_CUSTOMER_LOGIN`, {
        phone, otp: '4242', role: 'CUSTOMER', purpose: 'LOGIN',
        attempts: 0, maxAttempts: 3, expiresAt: Date.now() + 300000, lockedUntil: null
      });
      try {
        await db.verifyAuthOtp({ phone, otp: '4242', role: 'CUSTOMER' });
        out.opened = true;
      } catch (err) {
        out.code = err.code;
        out.status = err.status;
        out.message = err.message;
      }
      out.opened = out.opened === true;
      let adminOutcome = null;
      try {
        await db.resolveAdminByPhone('+919800000011');
        adminOutcome = 'answered';
      } catch (err) {
        adminOutcome = err.code;
      }
      out.adminCode = adminOutcome;
      out.ok = out.code === 'AUTH_STORE_UNAVAILABLE' && out.status === 503 &&
        out.adminCode === 'AUTH_STORE_UNAVAILABLE';
    } else if (scenario === 'audit_down') {
      // The audit store alone is down: identity resolves from memory, but every
      // audit write rejects exactly the way AuditLogRepository.create does when
      // PostgreSQL refuses it. A login that cannot be evidenced is not a login.
      db.createAuditLog = async () => {
        throw new Error('Failed to persist audit log in PostgreSQL: injected outage');
      };

      const dispatchPhone = '+919876500044';
      try {
        out.dispatched = await db.sendAuthOtp({ phone: dispatchPhone, role: 'CUSTOMER' });
      } catch (err) {
        out.dispatchCode = err.code;
        out.dispatchStatus = err.status;
      }
      out.dispatchLeftAnOtp = db.otpStore.has(`${dispatchPhone}_CUSTOMER_LOGIN`);

      const loginPhone = '+919876500055';
      const loginKey = `${loginPhone}_CUSTOMER_LOGIN`;
      db.otpStore.set(loginKey, {
        phone: loginPhone, otp: '7321', role: 'CUSTOMER', purpose: 'LOGIN',
        attempts: 0, maxAttempts: 3, expiresAt: Date.now() + 300000, lockedUntil: null
      });
      const sessionsBefore = db.activeSessions.size;
      try {
        out.granted = await db.verifyAuthOtp({ phone: loginPhone, otp: '7321', role: 'CUSTOMER' });
      } catch (err) {
        out.verifyCode = err.code;
        out.verifyStatus = err.status;
      }
      out.sessionsGained = db.activeSessions.size - sessionsBefore;

      out.ok = out.dispatchCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' && out.dispatchStatus === 503 &&
        out.dispatchLeftAnOtp === false &&
        out.verifyCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' && out.verifyStatus === 503 &&
        out.granted === undefined && out.sessionsGained === 0;
    }
    console.log(JSON.stringify(out));
  })().catch(err => {
    console.log(JSON.stringify({ scenario, ok: false, crashed: err.message }));
    process.exit(3);
  });
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'auth_failclosed_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_AUTH_CHILD: scenario, ...env }
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch (e) { /* reported below */ }
  if (!parsed) {
    return { ok: false, detail: `child printed no verdict: ${(res.stdout || '') + (res.stderr || '')}`.slice(0, 300) };
  }
  return parsed;
}

async function main() {
  await convenienceModeChecks();

  // NABIN_TEST_MODE is deliberately set alongside production: that combination is
  // the one the old `||` gate let through, and it is a realistic mistake.
  const fixed = spawnChild('fixed_otp', { NODE_ENV: 'production', NABIN_TEST_MODE: 'true' });
  check('AUTH-10', fixed.ok === true,
    `a production process with NABIN_TEST_MODE=true: fixed code refused, nothing echoed ` +
    `(echoed=${fixed.echoedTestCode}, fixed=${fixed.usedFixedCode})${fixed.detail ? ' ' + fixed.detail : ''}`);

  const down = spawnChild('store_down', {
    NODE_ENV: 'production',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key'
  });
  check('AUTH-11', down.ok === true,
    `with the account store unreachable, sign-in refuses with 503 AUTH_STORE_UNAVAILABLE rather than ` +
    `answering as somebody else (opened=${down.opened}, code=${down.code}, status=${down.status})` +
    `${down.detail ? ' ' + down.detail : ''}`);
  check('AUTH-12', down.ok === true && down.adminCode === 'AUTH_STORE_UNAVAILABLE',
    `and the administrator lookup fails closed the same way (admin outcome: ${down.adminCode})`);

  // An audit write that rejects is the outage AuditLogRepository.create throws on,
  // so these cases hold that one call up rather than trusting the whole store down
  // to reach it — with the store down, identity resolution fails first and the
  // audit gap would never be exercised.
  const auditDown = spawnChild('audit_down', { NODE_ENV: 'production', SUPABASE_POSTGRES_LIVE: 'false' });
  check('AUTH-13', auditDown.dispatchCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' &&
    auditDown.dispatchStatus === 503 && auditDown.dispatchLeftAnOtp === false,
    `an OTP that cannot be audited is refused with 503 and leaves no challenge behind ` +
    `(code=${auditDown.dispatchCode}, status=${auditDown.dispatchStatus}, left=${auditDown.dispatchLeftAnOtp})`);
  check('AUTH-14', auditDown.verifyCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' &&
    auditDown.verifyStatus === 503 && auditDown.granted === undefined && auditDown.sessionsGained === 0,
    `a correct OTP does not buy a session the audit trail cannot show — and no token is left live ` +
    `(code=${auditDown.verifyCode}, status=${auditDown.verifyStatus}, sessions gained=${auditDown.sessionsGained})`);

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 AUTH FAIL-CLOSED: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  process.exit(failed.length ? 1 : 0);
}

if (process.env.NABIN_AUTH_CHILD) {
  runChild(process.env.NABIN_AUTH_CHILD);
} else {
  main().catch(err => {
    console.error('AUTH FAIL-CLOSED ABORTED:', err.message);
    process.exit(2);
  });
}
