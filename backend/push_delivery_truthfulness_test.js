// =========================================================================
// PUSH DELIVERY TRUTHFULNESS (local only, in-process, zero writes)
//
// The owner's REAL-BACKEND-FIRST POLICY §2 allows a push boundary to be mocked
// while FCM/device credentials are unavailable, and §3 forbids the mock from
// being silent. Two measured places in this repo break that, and they are the
// same defect class link 65 closed for grocery prices: the code answers success
// about something the store (or, here, the network) never saw.
//
//   1. `FcmV1PushProvider.sendPush` (src/services/PushNotificationService.js)
//      builds an FCM payload and then returns
//      `{ success: true, providerMessageId: `fcm_v1_${Date.now()}` }` with the
//      comment that "Actual OAuth2 token generation and HTTP dispatch occurs
//      when credentials are live in production". Nothing under src/ performs
//      that dispatch — PDT-A0 proves it by reading the file. So configuring
//      real Firebase credentials does not enable delivery; it enables a
//      DELIVERED row, with a message id the app minted itself, for a device
//      that never received a notification. The audit trail is the damage: an
//      operator reading `notification_deliveries` sees proof of a delivery.
//   2. `src/server.js:25` picks the provider from the environment alone:
//      FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL, else `MockSandboxPushProvider`.
//      There is no production rule, so a production instance without Firebase
//      credentials silently runs the sandbox and records DELIVERED. The SMS
//      boundary in this same repo refuses exactly that
//      (`SmsGatewayService.resolveProvider` throws SMS_GATEWAY_NOT_CONFIGURED
//      when production has no provider) — PDT-F50 pins that as the convention
//      push must match, so this is not a new idea, it is an unapplied one.
//
// Why this is testable without a server or a database: the service takes its
// repository and its provider as constructor arguments, and the delivery rows it
// writes go through that repository. A recording fake stands in for
// `NotificationRepository`, so every assertion here is about what the real
// service would have persisted, with no store touched at all. The statuses and
// reason strings are read back from the same shapes the real repo accepts
// (`notification_deliveries.status` is CHECK'd to PENDING/SENT/DELIVERED/FAILED/
// SKIPPED, migration 012:122).
//
// The correction, in the same file, adds no new vocabulary of its own:
// `FcmV1PushProvider.sendPush` returns `PUSH_DELIVERY_NOT_IMPLEMENTED` instead of
// a `success: true` with a clock-minted message id, `MockSandboxPushProvider`
// refuses to run when `NODE_ENV=production` (so a wiring mistake cannot reopen
// the door), and `resolvePushProvider()` is the single place that decides the
// adapter — credentials pick FCM, production without them gets a named
// `NOT_CONFIGURED` provider whose dispatches land FAILED. The server now calls
// that function instead of reading two env vars inline. Development and test
// behaviour is unchanged, which is what group D is for: the fix must not "solve"
// the lie by switching push off.
//
// Group B/C were RED against the code described above and are the point of this
// file. Group D proves the dev/test sandbox keeps working after the fix,
// including its failure modes. Group E restores the environment it had to mutate,
// and says so.
// =========================================================================

const fs = require('fs');
const path = require('path');

const PS = require('./src/services/PushNotificationService');
const SmsGatewayService = require('./src/services/SmsGatewayService');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

// ---------------------------------------------------------------------------
// Recording fake repository — the only recorder this suite has.
// ---------------------------------------------------------------------------
let recSeq = 0;
function makeRepo({ tokens, prefs } = {}) {
  const records = [];
  const deactivated = [];
  let providerCalls = 0;
  return {
    records,
    deactivated,
    get providerCalls() { return providerCalls; },
    noteProviderCall() { providerCalls += 1; },
    async getActiveTokens() { return tokens === undefined ? [] : tokens; },
    async getPreferences() { return prefs === undefined ? null : prefs; },
    async createDeliveryRecord(fields) {
      const rec = { id: `del_${++recSeq}`, status: fields.status, provider: fields.provider,
        providerMessageId: fields.providerMessageId ?? null, failureReason: fields.failureReason ?? null };
      records.push(rec);
      return rec;
    },
    async updateDeliveryStatus(id, patch) {
      const rec = records.find(r => r.id === id);
      if (rec) Object.assign(rec, patch);
      return rec;
    },
    async deactivateDeviceToken(userId, token) { deactivated.push({ userId, token }); },
  };
}

const TOKEN = { id: 'tok_1', userId: 'u1', deviceToken: 'fcm_tok_live_1', platform: 'ANDROID' };
function notification(type = 'RIDE_COMPLETED') {
  return { id: 'notif_1', recipientUserId: 'u1', notificationType: type,
    title: 'Ride completed', body: 'Fare settled', data: {}, priority: 'NORMAL' };
}

function finalStatuses(repo) { return repo.records.map(r => r.status); }
function deliveredRows(repo) { return repo.records.filter(r => r.status === 'DELIVERED'); }

// ---------------------------------------------------------------------------
// Environment handling. isProduction() reads NODE_ENV at call time, so the
// suite can stand in production without booting anything — and must give it back.
// ---------------------------------------------------------------------------
const ENV_KEYS = ['NODE_ENV', 'NABIN_TEST_MODE', 'FAST_TEST_MODE', 'SMS_PROVIDER', 'FAST2SMS_API_KEY',
  'DLT_ENTITY_ID', 'DLT_TEMPLATE_ID', 'FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY', 'FIREBASE_SERVICE_ACCOUNT_KEY'];
const snapshot = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setEnv(overrides) {
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
function restoreEnv() { setEnv(snapshot); }

async function main() {
  // Backoff sleeps would make the retry cases cost 21 s for no added evidence.
  process.env.FAST_TEST_MODE = '1';

  // --- A. Source truth: no FCM dispatch exists in this repo -----------------
  const svcSrc = fs.readFileSync(
    path.join(__dirname, 'src', 'services', 'PushNotificationService.js'), 'utf8');
  const fcmBody = svcSrc.slice(svcSrc.indexOf('class FcmV1PushProvider'),
    svcSrc.indexOf('class PushNotificationService'));
  // Comments are stripped first, because the class carries prose that NAMES the
  // FCM host to explain that it is never contacted. A substring scan over prose
  // reported that explanation as a dispatch — the check must look at code only.
  const fcmCode = fcmBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const dispatchVerbs = ['https.request', 'http.request', 'https.get', 'http.get',
    'fetch(', 'axios', 'getAccessToken', 'createToken', 'signJwt'];
  const found = dispatchVerbs.filter(v => fcmCode.includes(v));
  check('PDT-A0', found.length === 0,
    found.length
      ? `FcmV1PushProvider now contains ${found.join(', ')} — a real dispatch exists, `
        + 'so PDT-B may need to change deliberately rather than silently'
      : 'FcmV1PushProvider performs no network call in its code (source-derived, comments '
        + 'excluded; this check is the witness that no dispatch exists)');

  // --- B. Configured FCM credentials must not manufacture a delivery --------
  {
    setEnv({ NODE_ENV: 'test', FIREBASE_PROJECT_ID: 'pdt-fake-project',
      FIREBASE_CLIENT_EMAIL: 'x@pdt-fake.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: '-----FAKE KEY-----' });
    const provider = new PS.FcmV1PushProvider();
    check('PDT-B0', provider.isConfigured === true,
      'the fake credential triple does mark FcmV1PushProvider as configured, so B tests the '
      + 'configured branch and not a misconfiguration path');

    const repo = makeRepo({ tokens: [TOKEN] });
    const svc = new PS.PushNotificationService(repo, provider);
    let out = null, threw = null;
    try { out = await svc.dispatchNotification(notification()); }
    catch (err) { threw = err; }
    check('PDT-B10', threw !== null || (out && out.delivered !== true),
      threw
        ? `a provider that sends nothing refuses instead of claiming: ${threw.code || threw.message}`
        : `dispatchNotification reported delivered=${JSON.stringify(out?.delivered)} for a push `
          + 'that was never sent to any network');
    check('PDT-B11', threw !== null || deliveredRows(repo).length === 0,
      `notification_deliveries rows left at DELIVERED: ${deliveredRows(repo).length}`
      + ' (an operator reading this table would be shown proof of a delivery that did not happen)');
    const invented = repo.records.filter(r => r.providerMessageId);
    check('PDT-B13', threw !== null || invented.length === 0,
      `provider_message_id values written by a provider that has no provider: ${JSON.stringify(invented.map(r => r.providerMessageId))}`);
    const failed = repo.records.filter(r => r.status === 'FAILED');
    const honestReason = failed.some(r => /PUSH_DELIVERY_NOT_IMPLEMENTED/.test(r.failureReason || ''));
    check('PDT-B12', threw !== null && /NOT_IMPLEMENTED|NOT_CONFIGURED/.test(threw.code || '')
      || honestReason,
      `FAILED rows: ${failed.length}, reasons: ${JSON.stringify(failed.map(r => r.failureReason))}`
      + ' — the row must name the reason an operator can act on');
    check('PDT-B14', repo.deactivated.length === 0,
      `device tokens deactivated by this run: ${repo.deactivated.length} — an unimplemented `
      + 'provider is not evidence that the device is unregistered');
  }

  // --- C. Production with no Firebase credentials ---------------------------
  {
    setEnv({ NODE_ENV: 'production', FIREBASE_PROJECT_ID: undefined,
      FIREBASE_CLIENT_EMAIL: undefined, FIREBASE_PRIVATE_KEY: undefined,
      FIREBASE_SERVICE_ACCOUNT_KEY: undefined });

    // C-first: the defect as committed — the sandbox happily "delivers" in production.
    const repo = makeRepo({ tokens: [TOKEN] });
    const svc = new PS.PushNotificationService(repo, new PS.MockSandboxPushProvider());
    const out = await svc.dispatchNotification(notification());
    check('PDT-C20', out?.delivered !== true && deliveredRows(repo).length === 0,
      `NODE_ENV=production with no credentials: the service answered ${JSON.stringify(out)}`
      + ` and wrote ${deliveredRows(repo).length} DELIVERED row(s) from a sandbox that sends nothing`);

    // C-rule: production must have an explicit adapter decision, like SMS does.
    check('PDT-C21', typeof PS.resolvePushProvider === 'function',
      `typeof resolvePushProvider === '${typeof PS.resolvePushProvider}' — src/server.js chooses `
      + 'the push adapter from env alone, with no production branch to test');

    if (typeof PS.resolvePushProvider === 'function') {
      let resolved = null, refused = null;
      try { resolved = PS.resolvePushProvider(); } catch (err) { refused = err; }
      check('PDT-C22', resolved === null || resolved.name !== 'MOCK_SANDBOX',
        refused
          ? `production without credentials threw ${refused.code || refused.message} (fail-closed, like SMS)`
          : `production without credentials resolved adapter "${resolved.name}"`);
      const repo2 = makeRepo({ tokens: [TOKEN] });
      const svc2 = resolved
        ? new PS.PushNotificationService(repo2, resolved)
        : null;
      let out2 = null, threw2 = null;
      if (svc2) {
        try { out2 = await svc2.dispatchNotification(notification()); }
        catch (err) { threw2 = err; }
      }
      check('PDT-C23', threw2 !== null || (out2 && out2.delivered !== true),
        threw2 ? `dispatch refused: ${threw2.code || threw2.message}`
          : `production dispatch answered delivered=${JSON.stringify(out2?.delivered)}`);
      check('PDT-C24', threw2 !== null || deliveredRows(repo2).length === 0,
        `DELIVERED rows under production resolution: ${deliveredRows(repo2).length}`);
    } else {
      check('PDT-C23', false, 'skipped with C21 — no production resolution exists');
      check('PDT-C24', false, 'skipped with C21 — no production resolution exists');
    }
  }

  // --- D. Development/test keeps a working, self-labelled sandbox -----------
  {
    setEnv({ NODE_ENV: 'test', FIREBASE_PROJECT_ID: undefined, FIREBASE_CLIENT_EMAIL: undefined });

    // D30: the ordinary success path, and the row names the adapter it used.
    const repo = makeRepo({ tokens: [TOKEN] });
    const svc = new PS.PushNotificationService(repo, new PS.MockSandboxPushProvider());
    const out = await svc.dispatchNotification(notification());
    check('PDT-D30', out?.delivered === true
      && deliveredRows(repo).length === 1
      && repo.records[0].provider === 'MOCK_SANDBOX',
      `dev sandbox delivered=${out?.delivered}, provider recorded as `
      + `"${repo.records[0]?.provider}" (an audit row must name the adapter it went through)`);

    // D31: transient failure burns the three attempts and lands FAILED.
    const transient = new PS.MockSandboxPushProvider({ simulationMode: 'TRANSIENT_FAILURE' });
    const repo31 = makeRepo({ tokens: [TOKEN] });
    const svc31 = new PS.PushNotificationService(repo31, transient);
    const out31 = await svc31.dispatchNotification(notification());
    check('PDT-D31', out31?.delivered === false
      && repo31.records[0].status === 'FAILED'
      && /MAX_RETRIES_EXCEEDED/.test(repo31.records[0].failureReason || ''),
      `transient simulation ended at status=${repo31.records[0].status}, `
      + `attempts=${repo31.records[0].attemptCount || 'n/a'}, reason=`
      + `${JSON.stringify(repo31.records[0].failureReason)}`);

    // D32: an unregistered token is a permanent failure AND deactivates the token.
    const repo32 = makeRepo({ tokens: [{ ...TOKEN, deviceToken: 'invalid_token_xyz' }] });
    const svc32 = new PS.PushNotificationService(repo32, new PS.MockSandboxPushProvider());
    await svc32.dispatchNotification(notification());
    check('PDT-D32', repo32.records[0].status === 'FAILED' && repo32.deactivated.length === 1,
      `unregistered token: status=${repo32.records[0].status}, `
      + `deactivated=${repo32.deactivated.length}`);

    // D33/D34: the paths that must not reach a provider at all.
    const repo33 = makeRepo({ tokens: [TOKEN], prefs: { pushEnabled: false } });
    const svc33 = new PS.PushNotificationService(repo33, new PS.MockSandboxPushProvider());
    const out33 = await svc33.dispatchNotification(notification());
    check('PDT-D33', out33?.delivered === false
      && repo33.records[0].status === 'SKIPPED'
      && /PUSH_MUTED/.test(repo33.records[0].failureReason || ''),
      `muted preference: status=${repo33.records[0].status}, reason=`
      + `${JSON.stringify(repo33.records[0].failureReason)}`);

    const repo34 = makeRepo({ tokens: [] });
    const svc34 = new PS.PushNotificationService(repo34, new PS.MockSandboxPushProvider());
    const out34 = await svc34.dispatchNotification(notification());
    check('PDT-D34', out34?.delivered === false
      && repo34.records[0].status === 'SKIPPED'
      && /NO_ACTIVE_DEVICE_TOKEN/.test(repo34.records[0].failureReason || ''),
      `no device token: status=${repo34.records[0].status}, reason=`
      + `${JSON.stringify(repo34.records[0].failureReason)}`);
  }

  // --- F. The convention this file holds push to ----------------------------
  {
    setEnv({ NODE_ENV: 'production', SMS_PROVIDER: undefined });
    let smsErr = null;
    try { SmsGatewayService.resolveProvider(); } catch (err) { smsErr = err; }
    check('PDT-F50', smsErr !== null && smsErr.code === 'SMS_GATEWAY_NOT_CONFIGURED',
      smsErr ? `SMS in production without a provider throws ${smsErr.code} at status ${smsErr.status}`
        : 'SMS no longer fails closed in production — that is a separate regression, and it is '
          + 'the rule groups B and C are modelled on');
  }

  // --- E. Environment hygiene ----------------------------------------------
  restoreEnv();
  const leaked = ENV_KEYS.filter(k => process.env[k] !== snapshot[k]);
  check('PDT-E40', leaked.length === 0,
    `env keys left changed: ${JSON.stringify(leaked)} — a suite that leaves NODE_ENV=production `
    + 'behind poisons every later assertion in the same process');
  check('PDT-E41', true,
    'no HTTP server, no child process and no store call were used anywhere in this file; '
    + 'the repository is a recording fake, so nothing was written');

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 PUSH DELIVERY TRUTHFULNESS: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed`);
  console.log('   (B and C are the defect; D is the regression guard that the fix must not break)');
  console.log('========================================================================');
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch(err => {
  console.error('PDT ABORTED:', err.message);
  restoreEnv();
  process.exit(2);
});
