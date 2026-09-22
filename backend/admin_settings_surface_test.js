// =========================================================================
// THE SETTINGS SURFACE IS CONFIGURATION, NOT A SECRET STORE (local only)
//
// `platform_settings` is one table holding four different kinds of thing: the
// `APP_CONFIG_*` rows this project publishes to every client device, the `FEATURE_*`
// flags another endpoint owns, the emergency service state another control owns, and —
// because nothing ever said otherwise — any key an operator types at
// `PUT /api/admin/platform-settings/:key`. Two properties were missing, and both were
// reachable from the same pair of routes:
//
//   1. The write surface was an open key/value editor over a table whose contents other
//      controls read. §5 row 37 asked for an allow-list instead of a block-list.
//   2. `GET` returned every row's `setting_value` verbatim, and `/api/app/config` published
//      every `APP_CONFIG_*` value verbatim, so a credential that ever landed in a row was
//      served to an admin screen and shipped to phones. §5 row 36's whole requirement is
//      that integrations show *presence*, never a value.
//
// Both now run through one gate in `AppConfigService`, and this file proves the gate from
// three directions: the pure policy, the routes over HTTP, and the published feed.
//
// What "never rendered" has to survive: a refusal reports the *name* of an offending field
// and never its contents, so the error path cannot become the leak it is guarding against.
// A row seeded outside the write gate — the case that already exists in a deployed table —
// is masked on the way out of both reads.
//
// LOCAL ONLY. It writes two `APP_CONFIG_SS_*` rows through the API and one directly into
// the local store to stand in for legacy data, and deletes all three before it finishes.
// Every "secret" here is a fabricated string assembled at runtime, so neither this file nor
// a commit carries anything a scanner could read as a real credential. The platform's own
// SUPER_ADMIN signs in as itself; no other account is provisioned, disabled or touched.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

// A server this file spawns carries these, because the payment verifiers refuse to be
// configured from a value in the source (see project memory: suite preconditions).
process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const appConfigService = require('./src/services/AppConfigService');

const BASE_URL = 'http://127.0.0.1:4000';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };

const PROBE = {
  stripe: ['sk', 'live', 'HARNESSNOTAREALSECRET00001'].join('_'),
  aws: ['AKIA', 'HARNESSPROBE1234'].join(''),
  jwt: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'aHJfbm90X2EgcmVhbCBzZWNyZXQ', 'c2lnbmF0dXJlLW5vdC1yZWFs'].join('.'),
  pem: ['-----BEGIN RSA PRIVATE KEY-----', 'aHJOb3RBUmVhbEtleQ', '-----END RSA PRIVATE KEY-----'].join('\n'),
  hook: ['https://hooks.invalid/nabin?token=', 'HARNESSNOTAREALSECRET0123456789'].join('')
};

const ALL_PROBES = Object.values(PROBE);
const KEYS = {
  config: 'APP_CONFIG_SS_SURFACE',
  badge: 'APP_CONFIG_SS_BADGE',
  legacy: 'APP_CONFIG_SS_LEGACY_PARTNER',
  outside: 'SS_SURFACE_PROBE_OUTSIDE',
  namedSecret: 'APP_CONFIG_SS_PARTNER_SECRET_KEY'
};

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function request(method, route, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, BASE_URL);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, data: {} });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function serverIsUp() {
  try {
    return (await request('GET', '/api/health')).status === 200;
  } catch (e) {
    return false;
  }
}

async function ensureServerRunning() {
  if (await serverIsUp()) return { proc: null, up: true };
  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true
  });
  proc.unref();
  // Boot hydration copies every promotion, driver and order into memory before the
  // socket opens, and on a warm local database that takes far longer than a few seconds.
  for (let i = 0; i < 60; i++) {
    if (await serverIsUp()) return { proc, up: true };
    await new Promise(r => setTimeout(r, 500));
  }
  return { proc, up: false };
}

const canonical = obj => JSON.stringify(Object.keys(obj).sort().reduce((acc, k) => { acc[k] = obj[k]; return acc; }, {}));
const containsNoProbe = text => !ALL_PROBES.some(probe => String(text).includes(probe));

// --- The pure policy, in this process, with no server and no table ----------------
function policySuite() {
  const allowed = { value: { headline: 'Festival week', accentColor: '#22A447', slots: 3 } };

  check('SS-01', appConfigService.validateSettingWrite(KEYS.config, allowed.value) === null,
    'a plain-data key inside the published namespace writes normally (no refusal)');

  const outside = appConfigService.validateSettingWrite(KEYS.outside, allowed.value);
  check('SS-02', outside && outside.code === 'SETTING_KEY_NOT_ALLOWED',
    `a key outside that namespace is refused, not quietly stored: ${outside && outside.code}`);
  check('SS-03', ['THEME_LABEL', 'payments.stripe.key', 'razorpay_mode', 'FEATURE_RIDE', 'PLATFORM_SERVICE_STATE', 'service_status', 'surge_multiplier']
    .every(key => {
      const refusal = appConfigService.validateSettingWrite(key, allowed.value);
      // The four another control already owned keep the code the suite proved before.
      return refusal && (refusal.code === 'SETTING_KEY_NOT_ALLOWED' || refusal.code === 'INVALID_SETTING_KEY');
    }),
    'every other key in that table — another control\'s or a stranger\'s — is refused by the write gate');

  const secretNames = ['APP_CONFIG_STRIPE_SECRET_KEY', 'APP_CONFIG_apiKey', 'APP_CONFIG_ACCESS_TOKEN',
    'APP_CONFIG_basic_auth', 'APP_CONFIG_private_key', 'APP_CONFIG_credentials'].map(key =>
      appConfigService.validateSettingWrite(key, allowed.value));
  check('SS-04', secretNames.every(r => r && r.code === 'SETTING_NAME_IS_CREDENTIAL'),
    `a credential-shaped *name* is refused whatever namespace it sits in (${secretNames.map(r => r && r.code).join(', ')})`);

  const innocent = ['APP_CONFIG_THEME', 'APP_CONFIG_AC_REGRESSION', 'APP_CONFIG_HEADLINE_COLOR',
    'APP_CONFIG_API_BASE_URL', 'APP_CONFIG_SALTY_STAFF_PICK', 'APP_CONFIG_DISPLAY_KEY_LABEL',
    'APP_CONFIG_CERT_BANNER', 'APP_CONFIG_KEYNOTE_SLOT', 'APP_CONFIG_RID_TOKEN'].map(key =>
      appConfigService.validateSettingWrite(key, allowed.value));
  check('SS-05', innocent.every(r => r === null),
    `ordinary configuration names are not refused (false positives: ${JSON.stringify(innocent.filter(Boolean).map(r => r.code))})`);

  // The palette is full of the word "token", and this project publishes one, so the exact
  // theme payload the suite writes has to pass the gate untouched or the gate is broken.
  const themePayload = {
    brand: '#0f4c81', canvas: '#ffffff', groceryAccent: '#1B7F4B',
    primaryTextColor: 'rgb(0, 0, 0)', notARealToken: '#12345'
  };
  check('SS-05b', appConfigService.validateSettingWrite('APP_CONFIG_THEME', themePayload) === null,
    'a published theme — token-named fields and an expression-bearing value included — is not refused as a credential');

  const secretValues = [
    { partner: 'ACME', apiKey: PROBE.stripe },
    { accessKeyId: PROBE.aws },
    { token: PROBE.jwt },
    { note: PROBE.pem },
    { webhook: PROBE.hook },
    [PROBE.stripe]
  ].map(value => appConfigService.validateSettingWrite(KEYS.config, value));
  check('SS-06', secretValues.every(r => r && r.code === 'SETTING_VALUE_IS_CREDENTIAL'),
    `a credential under an innocent field name, at any depth or in an array, is refused (${secretValues.map(r => r && r.code).join(', ')})`);

  check('SS-07', secretValues.every(r => containsNoProbe(JSON.stringify(r))),
    'a refusal names the field and never echoes the value it rejected');

  const badShape = appConfigService.validateSettingWrite(KEYS.config, { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  check('SS-08', badShape && badShape.code === 'INVALID_SETTING_VALUE',
    `the plain-data rules still answer first for a bad value: ${badShape && badShape.code}`);

  const legacyRow = {
    setting_key: KEYS.legacy,
    setting_value: { name: 'ACME', apiKey: PROBE.stripe, deep: { keep: 'visible', token: PROBE.jwt } },
    description: 'Seeded outside the gate'
  };
  const masked = appConfigService.redactSettingRow(legacyRow);
  check('SS-09', masked.valueRedacted === true &&
    masked.setting_value.name === 'ACME' && masked.setting_value.deep.keep === 'visible' &&
    masked.setting_value.apiKey === '__REDACTED__' && masked.setting_value.deep.token === '__REDACTED__',
    `a legacy row reads back as its shape, with the sensitive leaves masked and the rest left alone (${JSON.stringify(masked.redactedPaths)})`);
  check('SS-10', containsNoProbe(JSON.stringify(masked)),
    'and nothing credential-shaped survives the mask');

  const benignRow = { setting_key: KEYS.config, setting_value: allowed.value };
  check('SS-11', appConfigService.redactSettingRow(benignRow) === benignRow,
    'a row with nothing sensitive in it is returned untouched, not rewritten with markers');

  const namedSecretRow = { setting_key: KEYS.namedSecret, setting_value: { any: 'shape' } };
  const maskedKey = appConfigService.redactSettingRow(namedSecretRow);
  check('SS-12', maskedKey.setting_value === null && maskedKey.valueRedacted === true &&
    maskedKey.redactedReason,
    `a row whose own name is a credential is served with no value at all, and a reason (${JSON.stringify(maskedKey.redactedPaths)})`);
}

// --- The same rules through the wire and into the published feed ------------------
async function httpSuite() {
  const superLogin = await request('POST', '/api/admin/login', SUPER);
  check('SS-13', superLogin.status === 200 && !!superLogin.data.token,
    `the platform SUPER_ADMIN signs in for the probes (${superLogin.status})`);
  if (superLogin.status !== 200) return;
  const token = superLogin.data.token;

  const anonymous = await request('PUT', `/api/admin/platform-settings/${KEYS.config}`, { value: { x: 1 } });
  check('SS-14', anonymous.status === 401,
    `the gate did not become the door: an unauthenticated write is still refused (${anonymous.status})`);

  const outside = await request('PUT', `/api/admin/platform-settings/${KEYS.outside}`,
    { value: { headline: 'not mine to write' }, reason: 'Phase A settings probe' }, bearer(token));
  const outsideRead = await request('GET', `/api/admin/platform-settings?key=${KEYS.outside}`, null, bearer(token));
  check('SS-15', outside.status === 400 && outside.data.code === 'SETTING_KEY_NOT_ALLOWED' &&
    (outsideRead.data.settings || []).length === 0,
    `a key outside the published namespace answers ${outside.status} ${outside.data.code} and stores nothing`);

  const namedSecret = await request('PUT', `/api/admin/platform-settings/${KEYS.namedSecret}`,
    { value: { any: 'value' }, reason: 'Phase A settings probe' }, bearer(token));
  check('SS-16', namedSecret.status === 400 && namedSecret.data.code === 'SETTING_NAME_IS_CREDENTIAL' &&
    containsNoProbe(namedSecret.raw),
    `a credential-named key answers ${namedSecret.status} ${namedSecret.data.code} without repeating itself`);

  const valuedSecret = await request('PUT', `/api/admin/platform-settings/${KEYS.badge}`,
    { value: { partner: 'ACME', apiKey: PROBE.stripe }, reason: 'Phase A settings probe' }, bearer(token));
  const valuedRead = await request('GET', `/api/admin/platform-settings?key=${KEYS.badge}`, null, bearer(token));
  check('SS-17', valuedSecret.status === 400 && valuedSecret.data.code === 'SETTING_VALUE_IS_CREDENTIAL' &&
    containsNoProbe(valuedSecret.raw) && (valuedRead.data.settings || []).length === 0,
    `a credential in the value answers ${valuedSecret.status} ${valuedSecret.data.code}, names the field, and writes nothing`);

  // The path an operator actually uses, unchanged by any of the above.
  const badge = { headline: 'Fresh produce in 30 minutes', accentColor: '#22A447', slots: 3, runId: Date.now().toString() };
  const first = await request('PUT', `/api/admin/platform-settings/${KEYS.badge}`,
    { value: badge, description: 'Settings surface harness row', reason: 'Phase A settings probe' }, bearer(token));
  check('SS-18', first.status === 200 && first.data.success &&
    canonical(first.data.setting.setting_value) === canonical(badge) &&
    first.data.setting.description === 'Settings surface harness row',
    `an allowed write still works and reports what it wrote (${first.status}${first.data.code ? ' ' + first.data.code : ''})`);

  // An update that sends no description used to erase the one on the row, because the
  // route read the existing row without that column and then upserted `null` over it.
  const second = await request('PUT', `/api/admin/platform-settings/${KEYS.badge}`,
    { value: { ...badge, slots: 4 }, reason: 'Phase A settings probe, second write' }, bearer(token));
  check('SS-19', second.status === 200 && second.data.setting.description === 'Settings surface harness row',
    `a follow-up write with no description keeps the description it has (${JSON.stringify(second.data.setting && second.data.setting.description)})`);

  const seeded = await supabaseAdmin.from('platform_settings').upsert({
    setting_key: KEYS.legacy,
    setting_value: { name: 'ACME Integration', apiKey: PROBE.stripe, homepage: 'https://acme.invalid' },
    description: 'Seeded directly, to stand in for a row written before this gate existed',
    updated_by: 'settings_surface_harness',
    updated_at: new Date().toISOString()
  }, { onConflict: 'setting_key' });
  check('SS-20', !seeded.error,
    `a legacy row with a credential in it was seeded outside the gate${seeded.error ? ` (${seeded.error.message})` : ''}`);

  // The feed is cached for 30 seconds in the server's own process, which a harness in this
  // process cannot invalidate — so the row an operator *can* write is written again, and
  // that write is what makes the next anonymous read reflect what is in the table now.
  const nudge = await request('PUT', `/api/admin/platform-settings/${KEYS.badge}`,
    { value: { ...badge, slots: 5 }, description: 'Settings surface harness row', reason: 'Phase A settings probe, cache refresh' }, bearer(token));
  check('SS-20b', nudge.status === 200,
    `a write after the direct seed refreshes the server's cached feed (${nudge.status}${nudge.data.code ? ' ' + nudge.data.code : ''})`);

  const adminRead = await request('GET', '/api/admin/platform-settings', null, bearer(token));
  const legacyAsAdmin = (adminRead.data.settings || []).find(row => row.setting_key === KEYS.legacy);
  check('SS-21', adminRead.status === 200 && legacyAsAdmin &&
    legacyAsAdmin.valueRedacted === true && legacyAsAdmin.setting_value.apiKey === '__REDACTED__' &&
    legacyAsAdmin.setting_value.homepage === 'https://acme.invalid' &&
    (adminRead.data.redactedKeys || []).includes(KEYS.legacy),
    `the admin read masks it and says so, beside the fields the operator does need (${JSON.stringify(legacyAsAdmin && legacyAsAdmin.redactedPaths)})`);
  check('SS-22', containsNoProbe(adminRead.raw),
    'and the whole settings listing carries no credential, redacted row or not');

  // The published feed is the dangerous read: it is anonymous, and it ships to devices.
  const feed = await request('GET', '/api/app/config');
  const published = feed.data.sections && feed.data.sections.settings;
  check('SS-23', feed.status === 200 && published &&
    published.values[KEYS.legacy] && published.values[KEYS.legacy].apiKey === '__REDACTED__' &&
    published.values[KEYS.legacy].name === 'ACME Integration' &&
    (published.redactedKeys || []).includes(KEYS.legacy),
    `the anonymous config feed masks it too and names the key rather than dropping the row silently (${JSON.stringify(published && published.redactedKeys)})`);
  check('SS-24', containsNoProbe(feed.raw),
    'and nothing credential-shaped reaches an unauthenticated client through the feed');

  // A theme write goes through the same gate and must still be published as before.
  const theme = await request('GET', '/api/app/config');
  check('SS-25', theme.status === 200 && theme.data.sections && theme.data.sections.theme &&
    theme.data.sections.theme.source === `platform_settings:${appConfigService.SETTINGS_PREFIX}THEME`,
    `the theme section is still composed from its setting (${theme.data.sections && theme.data.sections.theme && theme.data.sections.theme.source})`);

  for (const key of [KEYS.badge, KEYS.legacy, KEYS.config]) {
    await supabaseAdmin.from('platform_settings').delete().eq('setting_key', key);
  }
  appConfigService.invalidate();
  const afterCleanup = await request('GET', '/api/admin/platform-settings', null, bearer(token));
  const left = (afterCleanup.data.settings || []).map(row => row.setting_key).filter(k => k.startsWith('APP_CONFIG_SS_'));
  check('SS-26', left.length === 0,
    `the harness left no rows behind (APP_CONFIG_SS_* remaining: ${JSON.stringify(left)})`);
  check('SS-27', containsNoProbe(afterCleanup.raw),
    'and the table reads back with no credential in it once the legacy row is gone');
}

async function main() {
  const { proc, up } = await ensureServerRunning();
  check('PRE-01', up, up
    ? `a backend is answering on ${BASE_URL}${proc ? ' (spawned by this harness)' : ' (reused)'}`
    : `no backend answered ${BASE_URL}/api/health within 30s${proc ? ' — this harness spawned one and it never came up' : ''}, so the wire half cannot run`);
  if (!up) {
    policySuite();
    const failed = results.filter(r => !r.ok).length;
    console.log('\n========================================================================');
    console.log(`📊 SETTINGS SURFACE: ${results.length - failed} PASSED, ${failed + 1} FAILED — the server half did not run, which is not a pass`);
    console.log('========================================================================\n');
    process.exitCode = 1;
    return;
  }
  if (!isLivePostgres || !supabaseAdmin) {
    check('PRE-02', false, 'PostgreSQL is unavailable, so the wire and feed halves cannot be proven — this run is not a pass');
  } else {
    check('PRE-02', true, 'the local store is live, which is what the seeded-legacy-row half needs');
  }

  policySuite();
  if (isLivePostgres && supabaseAdmin) await httpSuite();

  const failed = results.filter(r => !r.ok).length;
  console.log('\n========================================================================');
  console.log(`📊 SETTINGS SURFACE: ${results.length - failed} PASSED, ${failed} FAILED (Total: ${results.length})`);
  console.log('========================================================================\n');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('❌ [SS-99] harness threw:', err);
  process.exitCode = 1;
});
