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

  const created = await db.createAdminAccount({
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
  await db.createAdminAccount({
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
      // The send is not required to succeed. A production process with no
      // SMS_PROVIDER refuses delivery (SMS_GATEWAY_NOT_CONFIGURED) instead of
      // simulating it, and this file must not weaken that by declaring a fake
      // provider. The code decision happens before dispatch (database.js
      // sendAuthOtp) and the challenge is deliberately kept when delivery fails,
      // so whether the fixed code was minted is still observable from the store.
      let sent = null;
      try {
        sent = await db.sendAuthOtp({ phone: '9810122910', role: 'CUSTOMER' });
      } catch (err) {
        out.sendCode = err.code || 'SEND_FAILED';
      }
      let stored = otpCodeFor('+919810122910', 'CUSTOMER');
      // A random four-digit draw lands on 7729 about once in 9000 runs. One retry
      // tells that accident apart from the convenience branch actually being open.
      out.retriedAfterCollision = stored === '7729';
      if (out.retriedAfterCollision) {
        try {
          sent = await db.sendAuthOtp({ phone: '9810122910', role: 'CUSTOMER' });
        } catch (err) {
          out.sendCode = err.code || 'SEND_FAILED';
        }
        stored = otpCodeFor('+919810122910', 'CUSTOMER');
      }
      out.storedPresent = stored !== null;
      out.echoedTestCode = sent ? sent.testOtp !== undefined : false;
      out.usedFixedCode = stored === '7729';
      let fixedOpens = false;
      try {
        await db.verifyAuthOtp({ phone: '9810122910', otp: '7729', role: 'CUSTOMER' });
        fixedOpens = true;
      } catch (err) {
        out.refusedWith = err.message;
      }
      // A challenge is what makes the two refusals measurements rather than the
      // absence of anything to check: without one, `usedFixedCode === false` would
      // be true for a process that never decided anything.
      out.ok = out.storedPresent === true && !out.echoedTestCode && !out.usedFixedCode && !fixedOpens;
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
      let gateOutcome = null;
      try {
        await db.authoritativeAdminByUsername('superadmin');
        gateOutcome = 'answered';
      } catch (err) {
        gateOutcome = err.code;
      }
      out.gateCode = gateOutcome;
      out.ok = out.code === 'AUTH_STORE_UNAVAILABLE' && out.status === 503 &&
        out.adminCode === 'AUTH_STORE_UNAVAILABLE';
    } else if (scenario === 'admin_gate') {
      // Runs against the real local PostgreSQL: password login asks the store
      // whether the account is still there and still enabled, so these are the
      // three answers the login route can act on.
      const known = await db.authoritativeAdminByUsername('superadmin');
      out.known = { checked: known.checked, role: known.account && known.account.role, active: known.account && known.account.is_active };

      const missing = await db.authoritativeAdminByUsername('no_such_admin_zzz');
      out.missing = { checked: missing.checked, account: missing.account };
      out.ok = out.known.checked === true && out.known.role === 'SUPER_ADMIN' && out.known.active === true &&
        out.missing.checked === true && out.missing.account === null;
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
    } else if (scenario === 'mock_console_otp') {
      // A production process that declares CONSOLE — the provider whose whole job
      // is to print and send nothing — must be refused. Before the guard it
      // answered `delivered: true`, so the rider was told a code was on its way
      // while the only place that code existed was this process's stdout.
      let sent = null;
      try {
        sent = await db.sendAuthOtp({ phone: '+919876500077', role: 'CUSTOMER' });
      } catch (err) {
        out.sendCode = err.code || 'SEND_FAILED';
        out.sendStatus = err.status;
      }
      out.claimedSuccess = sent ? sent.success === true : false;
      out.echoedTestCode = sent ? sent.testOtp !== undefined : false;
      out.ok = out.sendCode === 'SMS_MOCK_PROVIDER_FORBIDDEN' && out.sendStatus === 503 &&
        out.claimedSuccess === false && out.echoedTestCode === false;
    } else if (scenario === 'dispatch_audit') {
      // What the durable trail is *told* about a send, against what actually happened.
      // The audit row used to be written before the SMS left, worded as though it had,
      // so every refused send (no provider, mock refused in production, a 502 from the
      // gateway) left a security record asserting a dispatch no handset ever saw — and
      // no record at all of the failure. Both outcomes are measured here through the
      // real gateway boundary rather than a stub: a production process that declares no
      // provider is refused for real, and a development process with the CONSOLE
      // adapter dispatches for real. The audit writer is wrapped, not replaced, so the
      // write the check reads is the write the store receives.
      const provider = process.env.SMS_PROVIDER || '';
      const phone = provider === 'CONSOLE' ? '+919876500066' : '+919876500088';
      const key = `${phone}_CUSTOMER_LOGIN`;

      // The code this process minted, captured as the challenge is stored, so the
      // leak check below always has something to look for — including on a path
      // that deletes the challenge before the parent can read it back.
      let minted = null;
      const realSet = db.otpStore.set.bind(db.otpStore);
      db.otpStore.set = (storeKey, value) => {
        if (storeKey === key && value && value.otp) minted = value.otp;
        return realSet(storeKey, value);
      };

      const written = [];
      const realCreate = db.createAuditLog.bind(db);
      db.createAuditLog = (entry) => {
        let blob = '';
        try {
          blob = JSON.stringify(entry);
        } catch (e) {
          blob = String(entry);
        }
        written.push({
          action: entry && entry.action,
          module: entry && entry.module,
          previous: entry && entry.previousState,
          next: entry && entry.newState,
          success: !(entry && entry.success === false),
          failureReason: (entry && (entry.failureReason || entry.failure_reason)) || null,
          reason: (entry && entry.reason) || '',
          blob
        });
        return realCreate(entry);
      };

      let sent = null;
      let refusal = null;
      try {
        sent = await db.sendAuthOtp({ phone, role: 'CUSTOMER' });
      } catch (err) {
        refusal = { code: err.code || 'SEND_FAILED', status: err.status };
      }

      const record = db.otpStore.get(key);
      out.env = process.env.NODE_ENV;
      out.provider = provider || '(unset)';
      out.phone = phone;
      out.actions = written.map(w => w.action);
      out.written = written;
      out.refusal = refusal;
      out.claimedSuccess = sent ? sent.success === true : false;
      out.challengeRetained = Boolean(record);
      out.mintedKnown = Boolean(minted);
      // No field of any row written for this send may carry the verification code.
      // Matched as a whole JSON string value, not a bare substring: a provider
      // receipt id embeds a millisecond clock whose digits could contain any
      // four-digit code by chance.
      out.codeLeakedToTrail = Boolean(minted) && written.some(w => (w.blob || '').includes(`"${minted}"`));
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
    `(echoed=${fixed.echoedTestCode}, fixed=${fixed.usedFixedCode}, ` +
    `challenge=${fixed.storedPresent ? 'minted, not the fixed code' : 'none — nothing was measured'}, ` +
    `send=${fixed.sendCode || 'delivered'})${fixed.detail ? ' ' + fixed.detail : ''}`);

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
  // audit gap would never be exercised. Not live PostgreSQL either, so the case
  // cannot leave a provisioned account behind in the dev database.
  const auditDown = spawnChild('audit_down', { NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'false' });
  check('AUTH-13', auditDown.dispatchCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' &&
    auditDown.dispatchStatus === 503 && auditDown.dispatchLeftAnOtp === false,
    `an OTP that cannot be audited is refused with 503 and leaves no challenge behind ` +
    `(code=${auditDown.dispatchCode}, status=${auditDown.dispatchStatus}, left=${auditDown.dispatchLeftAnOtp})`);
  check('AUTH-14', auditDown.verifyCode === 'AUTH_AUDIT_STORE_UNAVAILABLE' &&
    auditDown.verifyStatus === 503 && auditDown.granted === undefined && auditDown.sessionsGained === 0,
    `a correct OTP does not buy a session the audit trail cannot show — and no token is left live ` +
    `(code=${auditDown.verifyCode}, status=${auditDown.verifyStatus}, sessions gained=${auditDown.sessionsGained})`);

  // Against the real local store: the answers the password-login gate can act on.
  const gate = spawnChild('admin_gate', { NODE_ENV: 'development', SUPABASE_POSTGRES_LIVE: 'true' });
  check('AUTH-15', gate.known && gate.known.checked === true && gate.known.role === 'SUPER_ADMIN' &&
    gate.known.active === true,
    `password login re-reads the account from the store before granting it ` +
    `(known: ${JSON.stringify(gate.known)}${gate.detail ? ' ' + gate.detail : ''})`);
  check('AUTH-16', gate.missing && gate.missing.checked === true && gate.missing.account === null,
    `and a username the store has no record of is treated as no access, not as the ` +
    `copy this process booted with (missing: ${JSON.stringify(gate.missing)})`);
  check('AUTH-17', down.gateCode === 'AUTH_STORE_UNAVAILABLE',
    `with the store unreachable the password path refuses too, instead of answering ` +
    `from a copy taken before the outage (outcome: ${down.gateCode})`);

  // Declaring the dev/test CONSOLE provider is not the same as configuring a
  // gateway: the directive forbids a mock OTP adapter from running in production,
  // and the refusal has to happen before anyone is told the code was sent.
  const mockConsole = spawnChild('mock_console_otp', { NODE_ENV: 'production', SMS_PROVIDER: 'CONSOLE' });
  check('AUTH-18', mockConsole.ok === true,
    `a production process that declares SMS_PROVIDER=CONSOLE refuses the send with 503 ` +
    `SMS_MOCK_PROVIDER_FORBIDDEN instead of claiming delivery (code=${mockConsole.sendCode || 'answered'}, ` +
    `status=${mockConsole.sendStatus}, claimedSuccess=${mockConsole.claimedSuccess}, ` +
    `echoed=${mockConsole.echoedTestCode})${mockConsole.detail ? ' ' + mockConsole.detail : ''}`);

  // The trail must describe the send it is recording. Both halves run against the
  // real gateway boundary — no stubbed provider anywhere in these two children.
  const refusedSend = spawnChild('dispatch_audit', { NODE_ENV: 'production', SMS_PROVIDER: '' });
  const refusedRows = refusedSend.written || [];
  const refusedFail = refusedRows.find(w => w.action === 'AUTH_OTP_DISPATCH_FAILED');
  check('AUTH-19', (refusedSend.actions || []).includes('AUTH_OTP_REQUESTED') &&
    (refusedSend.actions || []).includes('AUTH_OTP_DISPATCH_FAILED') &&
    !(refusedSend.actions || []).includes('AUTH_OTP_DISPATCHED'),
    `a send the gateway refused is audited as refused: the trail for ${refusedSend.phone} got a ` +
    `challenge row and a failure row and never a dispatch row (actions=${JSON.stringify(refusedSend.actions)}` +
    `${refusedSend.detail ? ' ' + refusedSend.detail : ''})`);
  check('AUTH-20', Boolean(refusedFail) && refusedFail.success === false &&
    String(refusedFail.failureReason || '').includes('SMS_GATEWAY_NOT_CONFIGURED') &&
    refusedFail.next === 'OTP_PENDING' && refusedSend.challengeRetained === true,
    `and the failure row is an honest failure row: success=false, the refusal code in its ` +
    `failureReason, the state the process is actually in (row=${JSON.stringify(refusedFail || null)}, ` +
    `challenge retained=${refusedSend.challengeRetained})`);
  check('AUTH-21', refusedSend.refusal && refusedSend.refusal.code === 'SMS_GATEWAY_NOT_CONFIGURED' &&
    refusedSend.refusal.status === 503 && refusedSend.claimedSuccess === false,
    `while the caller still sees the SMS fault rather than an audit fault, with no success ` +
    `claimed (refusal=${JSON.stringify(refusedSend.refusal)}, claimedSuccess=${refusedSend.claimedSuccess})`);

  const sentSend = spawnChild('dispatch_audit', { NODE_ENV: 'development', SMS_PROVIDER: 'CONSOLE' });
  const sentActions = sentSend.actions || [];
  const sentRows = sentSend.written || [];
  const dispatchRow = sentRows.find(w => w.action === 'AUTH_OTP_DISPATCHED');
  check('AUTH-22', sentActions.includes('AUTH_OTP_REQUESTED') && sentActions.includes('AUTH_OTP_DISPATCHED') &&
    !sentActions.includes('AUTH_OTP_DISPATCH_FAILED') &&
    sentActions.indexOf('AUTH_OTP_REQUESTED') < sentActions.indexOf('AUTH_OTP_DISPATCHED'),
    `a send the gateway accepted is audited as accepted, and in that order: the dispatch row comes ` +
    `after the challenge row rather than standing in for the send (actions=${JSON.stringify(sentActions)}` +
    `${sentSend.detail ? ' ' + sentSend.detail : ''})`);
  check('AUTH-23', Boolean(dispatchRow) && dispatchRow.success === true &&
    String(dispatchRow.reason).includes('CONSOLE') && sentSend.claimedSuccess === true,
    `and the dispatch row names the provider that actually took the send, so the claim is ` +
    `checkable rather than bare (row=${JSON.stringify(dispatchRow || null)}, ` +
    `answered success=${sentSend.claimedSuccess})`);

  check('AUTH-24', refusedSend.mintedKnown === true && sentSend.mintedKnown === true &&
    refusedSend.codeLeakedToTrail === false && sentSend.codeLeakedToTrail === false,
    `neither trail copies the minted code into any field an administrator can read ` +
    `(codes known: refused=${refusedSend.mintedKnown}/accepted=${sentSend.mintedKnown}, ` +
    `leaked: refused=${refusedSend.codeLeakedToTrail}/accepted=${sentSend.codeLeakedToTrail})`);

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
