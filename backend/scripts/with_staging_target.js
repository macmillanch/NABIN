// Run a command against an EXPLICIT STAGING TARGET without risking accidental execution
// against local development or live production.
//
// Safety Guarantees:
// 1. Requires explicit staging configuration (via NABIN_STAGING_ENV_FILE or STAGING_* vars).
// 2. Fails closed: cannot silently fall back to local (loopback) or production endpoints.
// 3. Rejects production project references (including FORBIDDEN_PROD_REF).
// 4. Does not print secrets (masks URLs to protocol/host/port only).
// 5. Explicitly prints the target identity and database host before spawning child processes.
// 6. The operator's own environment wins over the loaded file — a harness that clobbers an
//    explicit `-e DATABASE_URL=…` with a stale `.env.staging` has run the wrong command while
//    printing the right label.
// 7. TLS is decided by the one shared policy (`src/services/dbTls.js`), so `DATABASE_SSL=no-verify`
//    against a hosted database is a refusal here rather than an inherited setting.
// 8. The effective project ref must be the sanctioned staging ref unless the operator names another
//    one on purpose (`NABIN_ALLOW_STAGING_REF`), and `nabinEnv.audit` runs on the final map before
//    anything is spawned.
// 9. A placeholder database password is refused with the owner action spelled out. This harness is
//    how migrations reach staging; an unfilled template used to produce a `28P01` several layers
//    away, which reads like a broken credential pipeline rather than a missing password.
//
// Usage: node scripts/with_staging_target.js <command> [args...]
//   NABIN_STAGING_ENV_FILE=./.env.staging node scripts/with_staging_target.js node scripts/test_chain.js

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const nabinEnv = require('../src/services/nabinEnv');
const dbTls = require('../src/services/dbTls');

// Production project ref. Under no circumstances may this harness point here.
const FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe';

// The hosted project this harness is allowed to reach. Staging is not "any non-production
// project" — that is how a second sandbox silently becomes the environment under test.
const SANCTIONED_STAGING_REF = 'ywhxkzmbwppkdemvzlhv';

// Required keys for staging target to be considered valid
const REQUIRED_KEYS = ['SUPABASE_URL', 'DATABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

// Unfilled template markers, matched against a credential and never printed.
// A well-formed JWT is exempt from the key scan: its base64 payload is arbitrary bytes as far
// as this pattern is concerned, and a three-part token is a credential someone issued rather
// than a blank someone left in.
const PLACEHOLDER_PATTERN = /(?:paste|your[_-]|change[_-]?me|replace|placeholder|todo|fixme|example|xxxx)/i;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+$/;

const isLoopbackHost = (host) =>
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1|0\.0\.0\.0|host\.docker\.internal)$/i.test(host);

class StagingRefused extends Error {
  constructor(reason) {
    super(reason);
    this.code = 'STAGING_TARGET_REFUSED';
  }
}

// Mask a value down to what is safe to log: scheme, host and port only.
function maskTarget(value) {
  if (value === undefined || value === '') return '(empty)';
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch (e) {
    return '(unparsable)';
  }
}

function loadStagingConfig(env) {
  const stagingEnvFile = env.NABIN_STAGING_ENV_FILE || path.resolve(__dirname, '../.env.staging');

  if (fs.existsSync(stagingEnvFile)) {
    const dotenv = require('dotenv');
    const parsed = dotenv.parse(fs.readFileSync(stagingEnvFile, 'utf8'));
    // Parent wins: only fill what the operator did not already set.
    const applied = [];
    for (const [key, val] of Object.entries(parsed)) {
      if (env[key] === undefined || env[key] === '') {
        env[key] = val;
        applied.push(key);
      }
    }
    const shadowed = Object.keys(parsed).filter((k) => !applied.includes(k));
    return {
      source: `file ${stagingEnvFile}`,
      keys: applied.length,
      // Which vars the file did NOT get to set is the information that tells an operator the
      // harness is running their command line rather than the file — names only, never values.
      overridden: shadowed,
    };
  }

  // If no staging file, check if STAGING_* variables are supplied directly in parent environment
  if (env.STAGING_SUPABASE_URL && env.STAGING_DATABASE_URL) {
    // One table, so a target credential cannot be mapped to itself and silently land in the
    // unset slot: `SUPABASE_ANON_KEY = SUPABASE_ANON_KEY` reads as correct and drops the key,
    // which makes the anon-slot checks (a service_role credential where a client reads, an
    // unfilled template) blind to exactly the variable the operator passed.
    const mapped = [
      ['SUPABASE_URL', 'STAGING_SUPABASE_URL'],
      ['DATABASE_URL', 'STAGING_DATABASE_URL'],
      ['SUPABASE_SERVICE_ROLE_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY'],
      ['SUPABASE_ANON_KEY', 'STAGING_SUPABASE_ANON_KEY'],
      ['NABIN_SUPABASE_REF', 'STAGING_SUPABASE_REF'],
    ].filter((pair) => env[pair[1]] !== undefined && env[pair[1]] !== '');
    for (const [to, from] of mapped) env[to] = env[from];
    return { source: 'STAGING_* parent variables', keys: mapped.length, overridden: [] };
  }

  throw new StagingRefused(
    `Staging env file not found at "${stagingEnvFile}" and STAGING_SUPABASE_URL/STAGING_DATABASE_URL `
    + 'are unset. Explicit staging configuration is mandatory.'
  );
}

function refuseProductionReferences(env) {
  const carrier = ['NABIN_SUPABASE_REF', 'SUPABASE_URL', 'DATABASE_URL']
    .filter((k) => (env[k] || '').includes(FORBIDDEN_PROD_REF));
  if (carrier.length > 0) {
    throw new StagingRefused(
      `The production project ref "${FORBIDDEN_PROD_REF}" was detected in: ${carrier.join(', ')}. `
      + 'Staging harness strictly prohibits production references.'
    );
  }

  // Reject prod keywords in hostnames
  for (const k of ['SUPABASE_URL', 'DATABASE_URL']) {
    const val = env[k] || '';
    if (/prod|production/i.test(val) && !/staging|test/i.test(val)) {
      throw new StagingRefused(`Potential production indicator detected in ${k} (${maskTarget(val)})`);
    }
  }
}

function refuseLoopbackTarget(env) {
  // Staging must NOT fall back to local Docker or loopback
  for (const k of ['SUPABASE_URL', 'DATABASE_URL']) {
    let host = '';
    try {
      host = new URL(env[k] || '').hostname;
    } catch (e) {
      throw new StagingRefused(`${k} is not a valid URL (${maskTarget(env[k])})`);
    }
    if (isLoopbackHost(host)) {
      throw new StagingRefused(
        `${k} points to a local loopback host (${host}). Staging harness strictly rejects local targets.`
      );
    }
  }
}

// The credential half that a hosted target is actually refused on first — measured as PostgreSQL
// 28P01 against the pooler on 12 Oct 2026 while `DATABASE_URL` still carried the template literal.
function refusePlaceholderCredential(env) {
  const offenders = [];
  for (const k of ['DATABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const value = env[k] || '';
    if (!value) continue;
    let probe = value;
    if (k === 'DATABASE_URL') {
      try {
        probe = decodeURIComponent(new URL(value).password || '');
      } catch (e) {
        probe = value;
      }
    } else if (JWT_SHAPE.test(value)) {
      continue;
    }
    if (PLACEHOLDER_PATTERN.test(probe)) offenders.push(k);
  }
  if (offenders.length > 0) {
    throw new StagingRefused(
      `${offenders.join(', ')} still holds an unfilled template value (matched by shape; the value is `
      + 'not printed). Owner action: Supabase Dashboard → Project Settings → Database → Database '
      + `Password for project ${SANCTIONED_STAGING_REF}, then paste it into the staging env file. `
      + 'This harness reaches the database over that credential, and a placeholder fails as an '
      + 'authentication error several layers away from the cause.'
    );
  }
}

// TLS decided by the shared policy, before anything connects. `sslConfig` returns the verified
// configuration for a hosted target and throws on a bypass word — so the harness cannot inherit one.
function enforceTlsPolicy(env) {
  let config;
  try {
    config = dbTls.sslConfig(env.DATABASE_URL, env);
  } catch (err) {
    throw new StagingRefused(`database TLS policy refused the target: ${err.message}`);
  }
  if (config === false) {
    throw new StagingRefused('database TLS policy resolved the target to a local connection.');
  }
  if (!env.DATABASE_SSL) env.DATABASE_SSL = 'require';
  return dbTls.describe(env.DATABASE_URL, env);
}

function pinStagingRef(env) {
  // Canonical NABIN_ENV is 'testing' for project nabin-test (ref ywhxkzmbwppkdemvzlhv)
  // per docs/SUPABASE_ENVIRONMENTS.md and src/services/nabinEnv.js
  env.NABIN_ENV = 'testing';
  if (!env.NODE_ENV || env.NODE_ENV === 'staging') env.NODE_ENV = 'production';
  env.NABIN_TARGET_LABEL = 'cloud-staging';

  const declared = (env.NABIN_SUPABASE_REF || '').trim().toLowerCase();
  const allowed = (env.NABIN_ALLOW_STAGING_REF || '').trim().toLowerCase();
  if (!declared) {
    env.NABIN_SUPABASE_REF = SANCTIONED_STAGING_REF;
    return { declared: SANCTIONED_STAGING_REF, defaulted: true };
  }
  if (declared === SANCTIONED_STAGING_REF) return { declared, defaulted: false };
  if (allowed && allowed === declared) {
    return { declared, defaulted: false, explicitlyAllowed: true };
  }
  throw new StagingRefused(
    `the staging configuration declares project ${declared}, which is not the sanctioned staging `
    + `project ${SANCTIONED_STAGING_REF}. If this other project is genuinely the staging target, say `
    + 'so on the command line: NABIN_ALLOW_STAGING_REF=' + declared
  );
}

function refuseAmbiguousConfiguration(env) {
  const missing = REQUIRED_KEYS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new StagingRefused(`Missing required staging configuration keys: ${missing.join(', ')}`);
  }
  const a = nabinEnv.audit(env);
  if (a.problems.length > 0) {
    throw new StagingRefused(
      `nabinEnv refused this configuration:\n  - ${a.problems.join('\n  - ')}`
    );
  }
  return a;
}

/**
 * Bring `env` to a verified staging target, or throw `StagingRefused` before anything spawns.
 * Exported so the refusals are testable without opening a socket or running a child.
 */
function establishStagingTarget(env) {
  const source = env || process.env;
  const loaded = loadStagingConfig(source);
  refuseProductionReferences(source);
  refuseLoopbackTarget(source);
  const tls = enforceTlsPolicy(source);
  const ref = pinStagingRef(source);
  const audit = refuseAmbiguousConfiguration(source);
  refusePlaceholderCredential(source);
  return { env: source, loaded, tls, ref, audit };
}

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    console.error('Usage: node scripts/with_staging_target.js <command> [args...]');
    process.exit(2);
  }

  let result;
  try {
    result = establishStagingTarget(process.env);
  } catch (err) {
    if (err.code === 'STAGING_TARGET_REFUSED') {
      console.error(`REFUSED — staging target could not be established: ${err.message}`);
      console.error('Nothing was spawned. Ensure an explicit staging environment is provided');
      console.error('and that it does not point to local loopback or production.');
      process.exit(2);
    }
    throw err;
  }

  const env = result.env;
  console.error('[STAGING HARNESS VERIFIED]');
  console.error(`  Config source:  ${result.loaded.source} (${result.loaded.keys} key(s) applied)`);
  if (result.loaded.overridden.length > 0) {
    console.error(`  Kept from the operator's environment instead of the file: ${result.loaded.overridden.join(', ')}`);
  }
  console.error(`  Target Label:   ${env.NABIN_TARGET_LABEL}`);
  console.error(`  NABIN_ENV:      ${env.NABIN_ENV}`);
  console.error(`  Supabase Ref:   ${result.ref.declared}`);
  console.error(`  Ref source:     ${result.ref.explicitlyAllowed ? 'operator-allowed non-sanctioned project'
    : result.ref.defaulted ? 'defaulted to the sanctioned staging project' : 'declared and sanctioned'}`);
  console.error(`  Supabase URL:   ${maskTarget(env.SUPABASE_URL)}`);
  console.error(`  Database URL:   ${maskTarget(env.DATABASE_URL)}`);
  console.error(`  TLS:            ${result.tls.verification} against ${result.tls.host} `
    + `(trust anchor: ${result.tls.trustAnchor}; DATABASE_SSL=${env.DATABASE_SSL})`);
  for (const note of result.audit.notes) console.error(`  Note:           ${note}`);
  console.error(`  Exec Command:   ${command} ${args.join(' ')}\n`);

  const child = cp.spawn(command, args, { stdio: 'inherit', env: { ...process.env }, cwd: process.cwd() });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
  child.on('error', (error) => {
    console.error(`[STAGING HARNESS] Spawn failed: ${error.message}`);
    process.exit(2);
  });
}

module.exports = {
  establishStagingTarget,
  loadStagingConfig,
  refuseProductionReferences,
  refuseLoopbackTarget,
  refusePlaceholderCredential,
  enforceTlsPolicy,
  pinStagingRef,
  refuseAmbiguousConfiguration,
  maskTarget,
  StagingRefused,
  FORBIDDEN_PROD_REF,
  SANCTIONED_STAGING_REF,
  REQUIRED_KEYS,
};
