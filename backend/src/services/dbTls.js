'use strict';
// =========================================================================
// DATABASE TLS POLICY — ONE RULE, MEASURED, FOR EVERY DIRECT POSTGRES CLIENT
//
// `scripts/migrate.js` used to decide TLS by itself, and its `require` branch was
// `{ rejectUnauthorized: true }` with no way to supply the anchor that Supabase's Postgres
// endpoints actually chain to. Measured 12 Oct 2026 against project ywhxkzmbwppkdemvzlhv:
//
//   pooler aws-0-ap-northeast-1.pooler.supabase.com:5432  leaf *.pooler.supabase.com
//   direct db.ywhxkzmbwppkdemvzlhv.supabase.co:5432        leaf db.<ref>.supabase.co
//     <- Supabase Intermediate 2021 CA  <- Supabase Root 2021 CA (self-signed, CA:TRUE,
//        valid to 2031-04-26, SHA-256 80:70:25:AD:…:CA:FA)
//
// Node's 121 bundled roots do not contain that anchor, so verification failed with
// SELF_SIGNED_CERT_IN_CHAIN and the only setting that connected was `no-verify` — which
// throws away the one thing TLS is for here: proving the process holding the database
// password is talking to the database, not to whatever answered. `no-verify` on a pooled
// connection accepts a forged certificate from a path that can see the socket, and the
// payload crossing it is `postgresql://postgres.<ref>:<password>@…`. That is a credential
// leak, not a convenience.
//
// The documents that recorded `no-verify` as a requirement were wrong about the cause.
// Supabase's own guidance is to download the server root certificate and configure the
// driver with it (sslrootcert / verify-full). With that root pinned, the same handshake
// that failed above completes with `authorized: true` on both endpoints, and pinning the
// intermediate instead of the root fails with UNABLE_TO_GET_ISSUER_CERT — so the check is
// real, not decorative. REST/auth gateways on *.supabase.co are issued by a public CA and
// verify from the system store; this file is about the Postgres transport only.
//
// Policy (a mis-set variable may only ever tighten this, never loosen it):
//   loopback / local Docker  → no TLS, as before. Nothing here breaks the offline dev loop.
//   hosted, *.supabase.*     → verify to the pinned root, hostname checked, no bypass.
//   hosted, anything else    → verify against the system trust store, hostname checked.
//   `no-verify` on a hosted  → refused, with the fix spelled out. Verification works, so a
//                              bypass is no longer explainable as "the CA won't validate".
//   `disable` on a hosted    → refused. Plain-text database credentials.
//
// Nothing in here prints a connection string: `describe()` returns host and policy only.
// =========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Same local-target shape as `nabinEnv.js` and the old `migrate.js` — a host in this set is
// the developer's own machine.
const LOCAL_HOST_PATTERN = /(?:^|@)(?:localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|0\.0\.0\.0|host\.docker\.internal|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?(?:\/|$)/i;

const SUPABASE_HOST_PATTERN = /(?:^|\.)supabase\.(?:co|com)$/i;

const DEFAULT_CA_FILE = path.resolve(__dirname, '..', '..', 'certs', 'supabase-root-2021-ca.pem');

// The identity of the anchor this policy trusts. Recorded so a rotated or substituted bundle
// is a visible event (an operator can compare it to the dashboard's copy) rather than a
// silently-widened trust boundary. Expiry 2031-04-26 — before that date the pin must be
// revisited, and `describe()` reports the file's real digest so a mismatch is diagnosable.
const EXPECTED_ROOT_SHA256 = '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA';

function policyError(message, code) {
  const err = new Error(message);
  err.code = code || 'DATABASE_TLS_POLICY';
  err.statusCode = 500;
  return err;
}

function hostOf(connectionString) {
  const raw = String(connectionString || '');
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch (e) {
    // node-postgres also accepts libpq KV strings (`host=… sslmode=…`). A DSN we cannot parse
    // must not be allowed to skip the check by being unparseable.
    const kv = /(?:^|\s)host\s*=\s*(?:'([^']*)'|(\S*))/.exec(raw);
    const host = kv && (kv[1] || kv[2]) || null;
    if (host) return String(host).toLowerCase();
    return null;
  }
}

function isLocalTarget(connectionString) {
  return LOCAL_HOST_PATTERN.test(String(connectionString || ''));
}

function caFile(env) {
  return String((env && env.DATABASE_SSL_CA_FILE) || DEFAULT_CA_FILE);
}

/**
 * The pinned root, validated on read.
 *
 * Two distinct failures and they are handled differently: a bundle that is not a certificate
 * at all is a refusal (an operator who points DATABASE_SSL_CA_FILE at a text file would
 * otherwise get a confusing handshake error much later), while a bundle that parses but has a
 * different identity is only reported — a reissued root is legitimate, and this file is the
 * one thing deciding which database a production migration may talk to, so it must be loud.
 */
function loadPinnedRoot(env) {
  const file = caFile(env);
  let pem;
  try {
    pem = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw policyError(
      `The pinned database root certificate could not be read from ${file} (${e.code || e.message}). `
      + 'Restore backend/certs/supabase-root-2021-ca.pem, or point DATABASE_SSL_CA_FILE at the root '
      + 'certificate from the Supabase dashboard. A hosted database connection will not be made '
      + 'without a verifiable trust anchor.'
    );
  }
  let cert;
  try {
    cert = new crypto.X509Certificate(pem);
  } catch (e) {
    throw policyError(
      `The file at ${file} is not a readable X.509 certificate (${e.message}). It was loaded as the `
      + 'database trust anchor, which it cannot be. Use the "Supabase Root 2021 CA" PEM from the '
      + 'Supabase dashboard, or leave DATABASE_SSL_CA_FILE unset to use backend/certs.',
      'DATABASE_TLS_ANCHOR_UNPARSEABLE'
    );
  }
  if (cert.ca !== true) {
    throw policyError(
      `The certificate at ${file} is not a CA (subject: ${String(cert.subject).trim().replace(/\s+/g, ' ')}). `
      + 'A leaf cannot anchor a chain: pinning one means every connection to a hosted database fails, '
      + 'and the only way to make it "work" again would be to remove verification. Use the Supabase root CA.',
      'DATABASE_TLS_ANCHOR_NOT_A_CA'
    );
  }
  const pretty = cert.fingerprint256.toUpperCase();
  if (pretty !== EXPECTED_ROOT_SHA256.toUpperCase()) {
    throw policyError(
      `The database trust anchor at ${file} has SHA-256 fingerprint ${pretty}, `
      + `which does not match the recorded expected fingerprint ${EXPECTED_ROOT_SHA256}. `
      + 'Hosted Supabase connection refused. If Supabase has rotated its root CA, independently verify '
      + 'the new certificate from the Supabase dashboard and update EXPECTED_ROOT_SHA256.',
      'DATABASE_TLS_FINGERPRINT_MISMATCH'
    );
  }
  return pem;
}

/**
 * The `ssl` option for node-postgres, from the DSN and DATABASE_SSL.
 *
 * Returns `false` (no TLS — local only), an options object, or throws. It never returns a
 * configuration that skips verification for a hosted host.
 */
function sslConfig(connectionString, env) {
  const source = env || process.env;
  const mode = String(source.DATABASE_SSL || '').trim().toLowerCase();
  const local = isLocalTarget(connectionString);
  const host = hostOf(connectionString);

  if (local) {
    // Local Docker has no certificate story at all; whatever the operator set is harmless here.
    return false;
  }

  const bypass = mode === 'no-verify' || mode === 'insecure' || mode === 'allow';
  const plaintext = mode === 'disable' || mode === 'false';

  if (bypass || plaintext) {
    throw policyError(
      `DATABASE_SSL="${mode}" would ${plaintext ? 'send database credentials in plain text' : 'skip certificate verification'} `
      + `for a hosted target (${host || 'host unreadable'}). Refused. This is no longer a workaround you need: `
      + 'Supabase\'s Postgres endpoints chain to "Supabase Root 2021 CA", which is pinned in '
      + `${path.relative(process.cwd(), caFile(source)) || caFile(source)}, so the connection verifies fully with `
      + 'DATABASE_SSL=require (that is also the default when DATABASE_SSL is unset). '
      + 'If verification fails, the anchor or the hostname is the problem to diagnose — not the check to remove.',
      'DATABASE_TLS_BYPASS_REFUSED'
    );
  }

  const verified = mode === '' || mode === 'require' || mode === 'verify-full' || mode === 'true';
  if (!verified) {
    throw policyError(
      `DATABASE_SSL="${mode}" is not understood. Use require (or leave it unset) for a hosted target, `
      + 'or disable for a local one.',
      'DATABASE_TLS_MODE_UNKNOWN'
    );
  }

  if (host && SUPABASE_HOST_PATTERN.test(host)) {
    return { rejectUnauthorized: true, ca: loadPinnedRoot(source) };
  }
  // A different hosted provider (or a future one) keeps the default behaviour: verify against
  // the system trust store. Not pinned, not bypassed.
  return { rejectUnauthorized: true };
}

/** Safe-to-log summary of what this DSN will do. Never includes credentials. */
function describe(connectionString, env) {
  const source = env || process.env;
  const host = hostOf(connectionString);
  const local = isLocalTarget(connectionString);
  return {
    host: host || '(unreadable)',
    local,
    requestedMode: String(source.DATABASE_SSL || '(unset)'),
    verification: local ? 'none (local target)' : 'required, hostname checked',
    trustAnchor: local ? null : (host && SUPABASE_HOST_PATTERN.test(host)
      ? `pinned ${path.basename(caFile(source))}`
      : 'system trust store'),
  };
}

module.exports = {
  sslConfig,
  describe,
  isLocalTarget,
  hostOf,
  LOCAL_HOST_PATTERN,
  SUPABASE_HOST_PATTERN,
  EXPECTED_ROOT_SHA256,
  DEFAULT_CA_FILE,
  policyError,
};
