// =========================================================================
// THE DATABASE CONNECTION EITHER VERIFIES, OR IT IS REFUSED
//
// `scripts/migrate.js` used to own its TLS decision, and the only setting that made a
// hosted Supabase connection succeed was `DATABASE_SSL=no-verify` — so that is what the
// staging config carried, and four documents recorded it as a requirement.
//
// That premise was measured and it is wrong. The Postgres endpoints for project
// ywhxkzmbwppkdemvzlhv chain to "Supabase Root 2021 CA", which is not in Node's bundled
// trust store; supplying it as a pinned anchor makes the same handshake complete with
// `authorized: true`, while pinning the wrong certificate (the intermediate alone) fails
// with UNABLE_TO_GET_ISSUER_CERT. So the bypass was never needed — it was an unverified
// session carrying `postgresql://postgres.<ref>:<password>@…`.
//
// This file pins the policy that replaced it, in the order that matters:
//   1. The local Docker loopback is untouched — no TLS, no declaration, no thrown error.
//      A guard that breaks the offline dev loop is a guard people route around.
//   2. A hosted target verifies: pinned anchor for Supabase hosts, system store otherwise.
//   3. Every bypass word on a hosted target is a refusal, and the refusal explains the fix.
//   4. The pinned anchor is checked by digest, and a missing bundle cannot silently widen
//      trust to "whatever the system happens to accept".
//   5. Nothing in any of these paths prints the password it was handed.
// =========================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dbTls = require('./src/services/dbTls');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const TEST_REF = 'ywhxkzmbwppkdemvzlhv';
const PASSWORD = 'SupaTestPw-do-not-echo';
const LOCAL_JDBC = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const LOCAL_NAMED = 'postgres://postgres:postgres@localhost:5432/postgres';
const LOCAL_DOCKER = 'postgresql://postgres:postgres@host.docker.internal:5432/postgres';
const DIRECT_JDBC = `postgresql://postgres:${PASSWORD}@db.${TEST_REF}.supabase.co:5432/postgres`;
const SESSION_POOLER = `postgresql://postgres.${TEST_REF}:${PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`;
const TRANSACTION_POOLER = `postgresql://postgres.${TEST_REF}:${PASSWORD}@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`;
const OTHER_HOSTED = `postgresql://nabin:${PASSWORD}@db.internal-partner.example:5432/nabin`;
const NO_TLS_HOSTED = `postgresql://nabin:${PASSWORD}@db.example.com:5432/nabin`;

const strip = (e) => (e && e.message ? e.message : String(e));
function throwsWith(fn, code) {
  try {
    fn();
    return { threw: false };
  } catch (e) {
    return { threw: true, code: e.code, message: strip(e) };
  }
}

// ------------------------------------------------------- 1. local stays as it was

check('TLS-01', dbTls.sslConfig(LOCAL_JDBC, {}) === false, 'loopback DSN: no TLS, as before');
check('TLS-02', dbTls.sslConfig(LOCAL_NAMED, {}) === false, '"localhost" host name is a local target');
check('TLS-03', dbTls.sslConfig(LOCAL_DOCKER, {}) === false, 'host.docker.internal is a local target');
check('TLS-04', dbTls.sslConfig(LOCAL_JDBC, { DATABASE_SSL: 'no-verify' }) === false,
  'a bypass word on a local target is inert, not a refusal — the dev loop must stay loadable');
check('TLS-05', dbTls.isLocalTarget('postgresql://postgres:pw@10.0.3.7:5432/postgres') === true,
  'a private-range host is local');
check('TLS-06', dbTls.isLocalTarget(SESSION_POOLER) === false,
  'the Supabase session pooler is never classified local');

// ------------------------------------- 2. a hosted Supabase target verifies to the pin

for (const [label, dsn] of [['direct', DIRECT_JDBC], ['session pooler', SESSION_POOLER], ['transaction pooler', TRANSACTION_POOLER]]) {
  const cfg = dbTls.sslConfig(dsn, {});
  check(`TLS-07.${label}`, cfg && cfg.rejectUnauthorized === true, `${label}: verification is on`);
  check(`TLS-08.${label}`, Boolean(cfg && /BEGIN CERTIFICATE/.test(cfg.ca || '')),
    `${label}: a trust anchor is supplied, so verification can complete`);
  check(`TLS-09.${label}`, cfg && cfg.rejectUnauthorized !== false,
    `${label}: nothing in the returned options disables authorisation`);
}

const other = dbTls.sslConfig(OTHER_HOSTED, {});
check('TLS-10', other && other.rejectUnauthorized === true,
  'a non-Supabase hosted target still verifies — against the system trust store');
check('TLS-11', other && other.ca === undefined,
  'the Supabase pin is not handed to an unrelated host, which would deny it its real CA');

// ------------------------------------------------- 3. a bypass on hosted is refused

const bypassWords = ['no-verify', 'insecure', 'allow', 'false', 'disable'];
bypassWords.forEach((word, i) => {
  const r = throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL: word }));
  const expected = (word === 'false' || word === 'disable') ? 'plain text' : 'verification';
  check(`TLS-12.${i}`, r.threw
    && r.code === 'DATABASE_TLS_BYPASS_REFUSED'
    && r.message.includes(expected),
    `DATABASE_SSL=${word} on a hosted target is refused, naming why (${expected})`);
});

// An unknown value is not allowed to fall through to a default either way.
const unknown = throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL: 'yes-please' }));
check('TLS-13', unknown.threw && unknown.code === 'DATABASE_TLS_MODE_UNKNOWN',
  'an unrecognised DATABASE_SSL is refused instead of silently treated as verification');

// The refusal has to be usable: it must name the supported values.
const bypassMessage = throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL: 'no-verify' })).message || '';
check('TLS-14', /DATABASE_SSL=require/.test(bypassMessage),
  'the bypass refusal states what to set instead of only saying no');

const unset = dbTls.sslConfig(DIRECT_JDBC, {});
check('TLS-15', unset && unset.rejectUnauthorized === true,
  'DATABASE_SSL unset on a hosted target defaults to verifying, not to plaintext');

// ------------------------------------------------------ 4. the pinned anchor itself

const caPath = dbTls.DEFAULT_CA_FILE;
check('TLS-16', fs.existsSync(caPath), `the shipped anchor exists at ${path.basename(caPath)}`);

let anchor = null;
try {
  anchor = new crypto.X509Certificate(fs.readFileSync(caPath, 'utf8'));
} catch (e) {
  check('TLS-17', false, `the anchor is not a parseable X.509 certificate: ${strip(e)}`);
}
if (anchor) {
  const pretty = crypto.createHash('sha256').update(anchor.raw).digest('hex').toUpperCase();
  const formatted = pretty.match(/.{2}/g).join(':');
  check('TLS-17', formatted === dbTls.EXPECTED_ROOT_SHA256.toUpperCase(),
    `the file's digest is the recorded one (${formatted.slice(0, 11)}…)`);
  check('TLS-18', /CN=Supabase Root 2021 CA/.test(anchor.subject), `subject is the Supabase root: ${anchor.subject}`);
  check('TLS-19', anchor.ca === true, 'the anchor is a CA certificate, so it can vouch for a chain');
  check('TLS-20', anchor.issuer === anchor.subject, 'the anchor is self-signed, i.e. a root not an intermediate');
  check('TLS-21', new Date(anchor.validTo) > new Date(), `the anchor is still valid (until ${anchor.validTo})`);
  check('TLS-22', new Date(anchor.validFrom) < new Date(), 'the anchor is already active');
}

const missing = throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL_CA_FILE: path.join(__dirname, 'no-such-bundle.pem') }));
check('TLS-23', missing.threw && /could not be read/.test(missing.message || ''),
  'a missing anchor is a hard refusal — trust never falls back to "whatever the system accepts"');

// TLS-24 needs a bundle that exists on disk and is not a certificate. The file used to be written
// into `backend/scratch/`, which is gitignored and so absent from any fresh checkout: the write died
// at ENOENT and the link reported a crash instead of the policy verdict. It now lives in its own
// `mkdtemp` directory — uniquely owned by this process, impossible to collide with a sibling run,
// removed in the `finally`, and never inside a directory any other session keeps state in.
let damagedDir = null;
const damaged = (() => {
  damagedDir = fs.mkdtempSync(path.join(os.tmpdir(), `nabin_tls_anchor_${process.pid}_`));
  const tmp = path.join(damagedDir, 'damaged_ca.pem');
  fs.writeFileSync(tmp, '-----BEGIN CERTIFICATE-----\nnot base64 at all\n-----END CERTIFICATE-----\n');
  try {
    return throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL_CA_FILE: tmp }));
  } finally {
    fs.rmSync(damagedDir, { recursive: true, force: true });
  }
})();
check('TLS-24', damaged.threw && damaged.code === 'DATABASE_TLS_ANCHOR_UNPARSEABLE',
  'a bundle that is not a certificate is refused at load, not handed to the handshake to fail over later');

// The cleanup is asserted, not assumed: the owned directory is gone, and no bundle file was ever
// planted in `scratch/` (which this suite must be able to run without).
const damagedScratch = (() => {
  const dir = path.join(__dirname, 'scratch');
  if (!fs.existsSync(dir)) return { exists: false, matching: 0 };
  return { exists: true, matching: fs.readdirSync(dir).filter((n) => /damaged_ca/.test(n)).length };
})();
check('TLS-24a', fs.existsSync(damagedDir) === false && damagedScratch.matching === 0,
  `the temporary anchor bundle is removed (dir left: ${fs.existsSync(damagedDir)}; `
  + `${damagedScratch.matching} damaged_ca file(s) in ${damagedScratch.exists ? 'scratch/' : 'an absent scratch/'})`);

const anchorShape = (() => {
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(dbTls.DEFAULT_CA_FILE, 'utf8'));
    return { checked: true, isCa: cert.ca };
  } catch (e) {
    return { checked: false };
  }
})();
check('TLS-24b', anchorShape.checked === true && anchorShape.isCa === true,
  'the shipped anchor parses as a CA through the same API the guard uses');

// ---------------------------------------------------- 5. no path echoes a credential

const leakTargets = [];
bypassWords.forEach((word) => {
  const r = throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL: word }));
  if (r.threw) leakTargets.push(r.message);
});
leakTargets.push(strip(throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL: 'nope' })).message));
leakTargets.push(strip(throwsWith(() => dbTls.sslConfig(DIRECT_JDBC, { DATABASE_SSL_CA_FILE: 'missing' })).message));
check('TLS-25', leakTargets.every((m) => !m.includes(PASSWORD)),
  `no refusal repeats the database password (${leakTargets.length} messages checked)`);
check('TLS-26', leakTargets.every((m) => !/postgres[.:][^@\s]*@/.test(m)),
  'no refusal reproduces a full connection string');

const view = dbTls.describe(SESSION_POOLER, {});
check('TLS-27', !JSON.stringify(view).includes(PASSWORD), 'describe() output carries no credential');
check('TLS-28', view.host === 'aws-0-ap-northeast-1.pooler.supabase.com'
  && view.local === false
  && /required/.test(view.verification)
  && /pinned/.test(view.trustAnchor),
  `describe() reports host, locality and anchor only (${JSON.stringify(view)})`);
const localView = dbTls.describe(LOCAL_JDBC, {});
check('TLS-29', localView.local === true && /local/.test(localView.verification),
  'describe() calls a loopback target local rather than unencrypted-hosted');

// A DSN node-postgres accepts but `new URL()` does not (libpq key/value form) must not be
// able to dodge the policy by being unparseable.
const kv = `host=db.${TEST_REF}.supabase.co user=postgres password=${PASSWORD} dbname=postgres`;
const kvResult = throwsWith(() => dbTls.sslConfig(kv, { DATABASE_SSL: 'no-verify' }));
check('TLS-30', kvResult.threw && kvResult.code === 'DATABASE_TLS_BYPASS_REFUSED',
  'a key/value DSN is matched against the same policy as a URL DSN');
check('TLS-31', dbTls.hostOf(kv) === `db.${TEST_REF}.supabase.co`, 'the host is readable from a key/value DSN');
check('TLS-32', dbTls.hostOf('total garbage') === null, 'an unreadable target returns no host instead of guessing one');

// ------------------------------------------- 6. the callers actually use this policy

const migrateSrc = fs.readFileSync(path.join(__dirname, 'scripts', 'migrate.js'), 'utf8');
check('TLS-33', /require\('\.\.\/src\/services\/dbTls'\)/.test(migrateSrc),
  'migrate.js takes its TLS decision from the shared policy');
check('TLS-34', !/rejectUnauthorized:\s*false/.test(migrateSrc) && !/no-verify/.test(migrateSrc),
  'migrate.js contains no local copy of the bypass');
check('TLS-35', /sslConfig\(connectionString\)/.test(migrateSrc) && /new Client\(\{ connectionString, ssl \}\)/.test(migrateSrc),
  'the decided config is the one handed to the client that runs DDL');

const moneySrc = fs.readFileSync(path.join(__dirname, 'money_idempotency_test.js'), 'utf8');
check('TLS-36', !/ssl: false/.test(moneySrc) && /dbTls\.sslConfig\(dbTarget\)/.test(moneySrc),
  'the money idempotency suite takes TLS from the shared policy instead of forcing ssl:false');
check('TLS-36b', /dbTls\.isLocalTarget\(dbTarget\)/.test(moneySrc),
  'the suite that writes money rows enforces the loopback-only promise its header states');

// `reset_local_test_data.js` clears tables, so its own loopback guard is the control that
// keeps it off a hosted project; the ssl:false it passes is only sound while that holds.
const resetSrc = fs.readFileSync(path.join(__dirname, 'scripts', 'reset_local_test_data.js'), 'utf8');
check('TLS-37', /LOOPBACK\.test\(host\)/.test(resetSrc) && /REFUSED: DATABASE_URL points at/.test(resetSrc),
  'the destructive local reset still refuses anything that is not loopback');

const envStaging = path.join(__dirname, '.env.staging');
if (fs.existsSync(envStaging)) {
  const line = (fs.readFileSync(envStaging, 'utf8').match(/^DATABASE_SSL=.*$/m) || ['(absent)'])[0];
  check('TLS-38', !/no-verify/.test(line), `the staging config no longer asks for a bypass (${line})`);
} else {
  check('TLS-38', true, 'no .env.staging on this host — nothing to carry the bypass');
}

// ---------------------------------------------------------------- report

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('✅ Database TLS policy holds: local unchanged, hosted verifies, bypass refused, anchor pinned, no credential echoed.');
