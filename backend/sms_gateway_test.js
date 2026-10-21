// =============================================================================
// sms_gateway_test.js — NABIN SmsGatewayService Hermetic Test Suite
//
// All tests run WITHOUT network traffic. The HTTPS layer is stubbed via the
// process environment and module-level patching rather than rewiring require(),
// so the tests remain compatible with the repo's zero-external-test-framework
// convention.
//
// PASS criterion: every assertion prints [PASS], zero [FAIL], exit 0.
// RED proof: swap PASS/FAIL labels and re-run — every assertion inverts.
//
// RUN: node backend/sms_gateway_test.js
// =============================================================================

'use strict';

const assert = require('assert');

// ---------------------------------------------------------------------------
// Minimal test harness (same pattern as the existing chain suites)
// ---------------------------------------------------------------------------

let pass = 0;
let fail = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    pass++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
    fail++;
  }
}

function section(title) {
  console.log(`\n── ${title} ──`);
}

// ---------------------------------------------------------------------------
// Helpers to reset module cache between environment-sensitive tests
// ---------------------------------------------------------------------------

function freshGateway(env = {}) {
  // Wipe cached modules so env-var changes take effect
  const keys = Object.keys(require.cache).filter(k => k.includes('SmsGatewayService.js') || k.includes('RuntimeMode.js'));
  keys.forEach(k => delete require.cache[k]);

  // Apply test env (save originals)
  const saved = {};
  const ALL_KEYS = [
    'SMS_PROVIDER', 'NODE_ENV', 'NABIN_TEST_MODE',
    'FAST2SMS_API_KEY', 'DLT_ENTITY_ID', 'DLT_TEMPLATE_ID', 'DLT_SENDER_ID',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
    'NABIN_SMS_TEMPLATE'
  ];
  ALL_KEYS.forEach(k => {
    saved[k] = process.env[k];
    delete process.env[k];
  });
  Object.assign(process.env, env);

  const mod = require('./src/services/SmsGatewayService');
  return { mod, saved };
}

function restore(saved) {
  const ALL_KEYS = [
    'SMS_PROVIDER', 'NODE_ENV', 'NABIN_TEST_MODE',
    'FAST2SMS_API_KEY', 'DLT_ENTITY_ID', 'DLT_TEMPLATE_ID', 'DLT_SENDER_ID',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
    'NABIN_SMS_TEMPLATE'
  ];
  ALL_KEYS.forEach(k => {
    delete process.env[k];
    if (saved[k] !== undefined) process.env[k] = saved[k];
  });
  // Also wipe the cached module so the next test gets a fresh one
  const keys = Object.keys(require.cache).filter(k => k.includes('SmsGatewayService.js') || k.includes('RuntimeMode.js'));
  keys.forEach(k => delete require.cache[k]);
}

// ---------------------------------------------------------------------------
// SMS-001 to SMS-005: Provider resolution
// ---------------------------------------------------------------------------

section('SMS-001…005: Provider resolution');

{
  // SMS-001: defaults to CONSOLE in development
  const { mod, saved } = freshGateway({ NODE_ENV: 'development' });
  check('SMS-001 dev defaults to CONSOLE', mod.resolveProvider() === 'CONSOLE');
  restore(saved);
}

{
  // SMS-002: explicit CONSOLE is accepted
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'CONSOLE' });
  check('SMS-002 explicit CONSOLE accepted', mod.resolveProvider() === 'CONSOLE');
  restore(saved);
}

{
  // SMS-003: explicit FAST2SMS is accepted
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'FAST2SMS' });
  check('SMS-003 explicit FAST2SMS accepted', mod.resolveProvider() === 'FAST2SMS');
  restore(saved);
}

{
  // SMS-004: unknown provider throws SMS_PROVIDER_UNKNOWN
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'PIGEONMAIL' });
  try {
    mod.resolveProvider();
    check('SMS-004 unknown provider throws', false, 'expected throw');
  } catch (e) {
    check('SMS-004 unknown provider throws SMS_PROVIDER_UNKNOWN', e.code === 'SMS_PROVIDER_UNKNOWN');
  }
  restore(saved);
}

{
  // SMS-005: missing SMS_PROVIDER in production throws SMS_GATEWAY_NOT_CONFIGURED
  const { mod, saved } = freshGateway({ NODE_ENV: 'production' });
  try {
    mod.resolveProvider();
    check('SMS-005 production missing provider throws', false, 'expected throw');
  } catch (e) {
    check('SMS-005 production missing provider → SMS_GATEWAY_NOT_CONFIGURED', e.code === 'SMS_GATEWAY_NOT_CONFIGURED');
    check('SMS-005 status is 503', e.status === 503);
  }
  restore(saved);
}

// ---------------------------------------------------------------------------
// SMS-006 to SMS-009: CONSOLE provider dispatch
// ---------------------------------------------------------------------------

section('SMS-006…009: CONSOLE dispatch');

{
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'CONSOLE' });

  // Capture console.info output
  const captured = [];
  const orig = console.info;
  console.info = (...a) => captured.push(a.join(' '));

  let result;
  const run = async () => {
    result = await mod.dispatch('+919876543210', '4321');
    console.info = orig;
  };
  // Run synchronously via a trick: run the async and check in .then
  run().then(() => {
    check('SMS-006 CONSOLE dispatch returns provider=CONSOLE', result.provider === 'CONSOLE');
    check('SMS-007 CONSOLE dispatch returns delivered=true', result.delivered === true);
    check('SMS-008 CONSOLE dispatch logs to stdout', captured.some(m => m.includes('4321')));
    check('SMS-009 CONSOLE messageId contains CONSOLE prefix', result.messageId.startsWith('CONSOLE-'));
    restore(saved);
  }).catch((e) => {
    console.info = orig;
    check('SMS-006…009 CONSOLE dispatch threw unexpectedly', false, e.message);
    restore(saved);
  });
}

// ---------------------------------------------------------------------------
// SMS-010 to SMS-013: gatewayStatus()
// ---------------------------------------------------------------------------

section('SMS-010…013: gatewayStatus()');

{
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'CONSOLE' });
  const status = mod.gatewayStatus();
  check('SMS-010 status.provider is CONSOLE', status.provider === 'CONSOLE');
  check('SMS-011 status.ready is true for CONSOLE', status.ready === true);
  check('SMS-012 status.dltCompliant is null for CONSOLE', status.dltCompliant === null);
  restore(saved);
}

{
  // SMS-013: FAST2SMS configured — dltCompliant reflects vars
  const { mod, saved } = freshGateway({
    NODE_ENV: 'development',
    SMS_PROVIDER: 'FAST2SMS',
    FAST2SMS_API_KEY: 'test-key',
    DLT_ENTITY_ID: 'test-entity',
    DLT_TEMPLATE_ID: 'test-template',
    DLT_SENDER_ID: 'NABINM'
  });
  const status = mod.gatewayStatus();
  check('SMS-013 FAST2SMS with all vars → dltCompliant true', status.dltCompliant === true);
  restore(saved);
}

// ---------------------------------------------------------------------------
// SMS-014 to SMS-016: buildMessage() template substitution
// ---------------------------------------------------------------------------

section('SMS-014…016: Template assembly');

{
  const { mod, saved } = freshGateway({ NODE_ENV: 'development' });
  const msg = mod.buildMessage('5678');
  check('SMS-014 OTP is substituted', msg.includes('5678'));
  check('SMS-015 placeholder removed', !msg.includes('{otp}'));
  check('SMS-016 message is non-empty string', typeof msg === 'string' && msg.length > 5);
  restore(saved);
}

// ---------------------------------------------------------------------------
// SMS-017 to SMS-020: Invalid arguments guard
// ---------------------------------------------------------------------------

section('SMS-017…020: Argument validation');

{
  const { mod, saved } = freshGateway({ NODE_ENV: 'development' });

  let err1;
  const t1 = async () => { try { await mod.dispatch('', '1234'); } catch (e) { err1 = e; } };
  const t2Promise = t1().then(() => {
    check('SMS-017 dispatch with empty phone throws', !!err1);
    check('SMS-018 throw code is SMS_INVALID_ARGUMENTS', err1 && err1.code === 'SMS_INVALID_ARGUMENTS');
  });

  let err2;
  const t2 = async () => { try { await mod.dispatch('+919876543210', ''); } catch (e) { err2 = e; } };
  const t3Promise = t2().then(() => {
    check('SMS-019 dispatch with empty otp throws', !!err2);
    check('SMS-020 throw code is SMS_INVALID_ARGUMENTS', err2 && err2.code === 'SMS_INVALID_ARGUMENTS');
  });

  Promise.all([t2Promise, t3Promise]).then(() => restore(saved));
}

// ---------------------------------------------------------------------------
// SMS-021 to SMS-023: FAST2SMS credential guard (production)
// ---------------------------------------------------------------------------

section('SMS-021…023: FAST2SMS production credential guard');

{
  // Missing API key in production → requireEnv throws
  const { mod, saved } = freshGateway({
    NODE_ENV: 'production',
    SMS_PROVIDER: 'FAST2SMS'
    // deliberately NOT setting FAST2SMS_API_KEY
  });
  const run = async () => {
    try {
      await mod.dispatch('+919876543210', '1234');
      check('SMS-021 missing FAST2SMS_API_KEY in prod throws', false, 'expected throw');
    } catch (e) {
      check('SMS-021 missing key → SMS_GATEWAY_NOT_CONFIGURED', e.code === 'SMS_GATEWAY_NOT_CONFIGURED');
      check('SMS-022 status is 503', e.status === 503);
      check('SMS-023 message mentions FAST2SMS_API_KEY', e.message.includes('FAST2SMS_API_KEY'));
    }
  };
  run().then(() => restore(saved));
}

// ---------------------------------------------------------------------------
// SMS-024: FAST2SMS rejects non-10-digit Indian number
// ---------------------------------------------------------------------------

section('SMS-024: FAST2SMS number validation');

{
  const { mod, saved } = freshGateway({
    NODE_ENV: 'development',
    SMS_PROVIDER: 'FAST2SMS',
    FAST2SMS_API_KEY: 'test-key',
    DLT_ENTITY_ID: 'test-entity',
    DLT_TEMPLATE_ID: 'test-template'
  });

  // Patch the internal HTTPS call so we don't hit the network
  const origHttps = require('https');
  const requestSpy = origHttps.request;
  origHttps.request = () => {
    const err = new Error('network should not be called in test');
    throw err;
  };

  const run = async () => {
    try {
      // +1 555 number — not a 10-digit Indian number
      await mod.dispatch('+15551234567', '4321');
      check('SMS-024 non-Indian number should throw', false, 'expected throw');
    } catch (e) {
      check('SMS-024 non-Indian number → SMS_INVALID_RECIPIENT', e.code === 'SMS_INVALID_RECIPIENT');
    } finally {
      origHttps.request = requestSpy;
      restore(saved);
    }
  };
  run();
}

// ---------------------------------------------------------------------------
// SMS-025: TWILIO credential guard (production)
// ---------------------------------------------------------------------------

section('SMS-025: TWILIO production credential guard');

{
  const { mod, saved } = freshGateway({
    NODE_ENV: 'production',
    SMS_PROVIDER: 'TWILIO'
    // deliberately NOT setting TWILIO_ACCOUNT_SID
  });
  const run = async () => {
    try {
      await mod.dispatch('+919876543210', '1234');
      check('SMS-025 missing TWILIO creds in prod throws', false, 'expected throw');
    } catch (e) {
      check('SMS-025 missing TWILIO creds → SMS_GATEWAY_NOT_CONFIGURED', e.code === 'SMS_GATEWAY_NOT_CONFIGURED');
    }
  };
  run().then(() => restore(saved));
}

// ---------------------------------------------------------------------------
// SMS-026…031: a declared provider is not a real one in production
//
// CONSOLE prints and sends nothing. A production process that carries it would
// answer every OTP caller `delivered: true` about a message no handset received.
// ---------------------------------------------------------------------------

section('SMS-026…031: production refuses the CONSOLE mock');

{
  // SMS-026/027: resolveProvider refuses CONSOLE in production
  const { mod, saved } = freshGateway({ NODE_ENV: 'production', SMS_PROVIDER: 'CONSOLE' });
  try {
    mod.resolveProvider();
    check('SMS-026 production CONSOLE throws', false, 'expected throw');
  } catch (e) {
    check('SMS-026 production CONSOLE → SMS_MOCK_PROVIDER_FORBIDDEN', e.code === 'SMS_MOCK_PROVIDER_FORBIDDEN');
    check('SMS-027 refusal status is 503', e.status === 503);
  }
  restore(saved);
}

{
  // SMS-028/029: dispatch rejects instead of returning a delivery claim, and prints nothing
  // for this recipient. The phone is unique to this block because console.info is patched
  // globally while it runs, and the suite's other CONSOLE dispatches are still in flight.
  const mockPhone = '+919800011122';
  const { mod, saved } = freshGateway({ NODE_ENV: 'production', SMS_PROVIDER: 'CONSOLE' });
  const printed = [];
  const origInfo = console.info;
  console.info = (...args) => { printed.push(args.join(' ')); };
  mod.dispatch(mockPhone, '1234').then((res) => {
    check('SMS-028 production CONSOLE dispatch rejects', false, `answered ${JSON.stringify(res)}`);
  }, (e) => {
    check('SMS-028 production CONSOLE dispatch rejects with SMS_MOCK_PROVIDER_FORBIDDEN',
      e.code === 'SMS_MOCK_PROVIDER_FORBIDDEN');
    check('SMS-029 no CONSOLE "sent" line was printed for this recipient',
      printed.every(line => !line.includes('9800011122')), printed.join(' | '));
  }).finally(() => { console.info = origInfo; restore(saved); });
}

{
  // SMS-030: the guard is production-only — development still uses CONSOLE
  const { mod, saved } = freshGateway({ NODE_ENV: 'development', SMS_PROVIDER: 'CONSOLE' });
  mod.dispatch('+919876543210', '1234').then((res) => {
    check('SMS-030 development CONSOLE still dispatches', res.delivered === true && res.provider === 'CONSOLE',
      JSON.stringify(res));
  }, (e) => {
    check('SMS-030 development CONSOLE still dispatches', false, `rejected with ${e.code}`);
  }).finally(() => restore(saved));
}

{
  // SMS-031: the health report tells the operator about the refusal rather than ready:true
  const { mod, saved } = freshGateway({ NODE_ENV: 'production', SMS_PROVIDER: 'CONSOLE' });
  const st = mod.gatewayStatus();
  check('SMS-031 gatewayStatus reports ready:false with the refusal code',
    st.ready === false && st.error === 'SMS_MOCK_PROVIDER_FORBIDDEN', JSON.stringify(st));
  restore(saved);
}

// ---------------------------------------------------------------------------
// Final report
// ---------------------------------------------------------------------------

// Give all async assertions time to settle before printing
setTimeout(() => {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`SMS Gateway Suite: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.error(`\n❌ ${fail} assertion(s) failed. See [FAIL] lines above.`);
    process.exit(1);
  } else {
    console.log('\n✅ All SMS gateway assertions passed.');
    process.exit(0);
  }
}, 1500);
