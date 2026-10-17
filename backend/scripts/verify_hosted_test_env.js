// =============================================================================
// NABIN — HOSTED SUPABASE TEST ENVIRONMENT GUARD & VERIFIER
//
// Usage: node scripts/verify_hosted_test_env.js [--allow-pending]
//
// Validates that the active or configured environment strictly targets
// the approved hosted test project: ywhxkzmbwppkdemvzlhv (nabin-test).
//
// NEVER executes against production (ouxvqmhuyueklnegvmxe).
// FAILS CLOSED on any ambiguous or mismatched configuration.
// Writes nothing: no connection, no query, no file. It reads configuration only.
//
// Two fail-opens were measured here on 12 Oct 2026 and are now closed:
//
// 1. The PASS branch keyed on the two REST credentials. `hasDatabaseUrl` was computed and
//    printed with a ⚠️ and then used in no condition, so `backend/.env` — 16 keys, no
//    `DATABASE_URL` at all — was announced as "✅ PASS: Environment is safely and correctly
//    configured for Hosted TEST" with exit 0. A verifier whose verdict is read as permission
//    to run `migrate.js` cannot be silent about the credential `migrate.js` needs, so all
//    three slots are gated now and a gap is a named PENDING verdict with exit 2.
// 2. An env file was loaded at module scope with `override: true`, so a local
//    `backend/.env.test.local` replaced the project that `with_staging_target.js` had just
//    pinned and audited, and importing this module mutated the importer's environment. The
//    file is now chosen by `chooseEnvFile()` on the CLI path only, and never at all when the
//    harness pinned the target.
//
// `decide()`, `exitCodeFor()`, `finalLine()` and `chooseEnvFile()` are exported and pure so a
// verdict is observable in a test (`verify_hosted_test_env_guard_test.js`) without spawning,
// connecting, or depending on which files happen to be on the machine.
// =============================================================================

const path = require('path');
const fs = require('fs');

const nabinEnv = require('../src/services/nabinEnv');

const testEnvPath = path.resolve(__dirname, '../.env.test.local');
const defaultEnvPath = path.resolve(__dirname, '../.env');

const APPROVED_TEST_REF = 'ywhxkzmbwppkdemvzlhv';
const FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe';

// The three credentials this environment needs, in the order the operator is told about them.
// `DATABASE_URL` is not decorative: it is how `migrate.js` reaches DDL, so a verdict that
// ignores it authorises a step that cannot run.
const CREDENTIAL_SLOTS = [
  { key: 'SUPABASE_ANON_KEY', needsRef: false },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', needsRef: false },
  { key: 'DATABASE_URL', needsRef: true },
];

/**
 * Which configuration file, if any, gets to describe the target.
 *
 * Under `with_staging_target.js` the answer is none: the harness has already pinned and
 * audited the map it is about to spawn, and a file loaded with `override: true` here would
 * silently move the target out from under that audit.
 */
function chooseEnvFile(source) {
  const env = source || process.env;
  if (env.NABIN_TARGET_LABEL) return { loaded: null, reason: 'harness-pinned' };
  if (fs.existsSync(testEnvPath)) return { loaded: testEnvPath, reason: 'test-local-file' };
  return { loaded: defaultEnvPath, reason: 'default-env-file' };
}

/** A slot is configured only when it holds something real-shaped, never a template stub. */
function slotFilled(env, slot) {
  const raw = String(env[slot.key] || '').trim();
  if (raw.length <= 20) return false;
  // A DSN that names no project — or a different project — does not count as reaching the
  // test database, whatever else it is connected to.
  return !slot.needsRef || raw.includes(APPROVED_TEST_REF);
}

/**
 * The whole decision, over an explicit env map, without printing or exiting.
 *
 * `status` is one of PASS | PENDING | LOCAL | REFUSED | MISMATCH. Production and audit
 * problems precede the credential question: a missing key is not a reason to soften the word
 * "production" into "pending".
 */
function decide(source) {
  const env = source || process.env;
  const audit = nabinEnv.audit(env);
  const problems = Array.isArray(audit.problems) ? audit.problems : [];
  const view = audit.view || {};
  const observed = view.observedRefs || [];

  const credentials = {};
  const missing = [];
  for (const slot of CREDENTIAL_SLOTS) {
    const filled = slotFilled(env, slot);
    credentials[slot.key] = filled;
    if (!filled) missing.push(slot.key);
  }

  const base = { view, problems, notes: audit.notes || [], credentials, missing };

  if (observed.includes(FORBIDDEN_PROD_REF) || view.declaredRef === FORBIDDEN_PROD_REF) {
    return { ...base, status: 'REFUSED', reason: 'production' };
  }
  if (problems.length > 0) {
    return { ...base, status: 'REFUSED', reason: 'configuration' };
  }
  if (view.declaredRef === APPROVED_TEST_REF && view.env === 'testing') {
    if (missing.length === 0) return { ...base, status: 'PASS', reason: null };
    return { ...base, status: 'PENDING', reason: 'credentials' };
  }
  if (view.restLocal) return { ...base, status: 'LOCAL', reason: 'local-docker' };
  return { ...base, status: 'MISMATCH', reason: 'wrong-target' };
}

/** The one line an operator reads. Names what is missing; never echoes a credential value. */
function finalLine(verdict) {
  switch (verdict.status) {
    case 'PASS':
      return `\n✅ PASS: Environment is safely and correctly configured for Hosted TEST (${APPROVED_TEST_REF}).`;
    case 'PENDING':
      return `\n⚠️ PENDING CREDENTIALS: this environment is pinned to ${APPROVED_TEST_REF}, but `
        + `${verdict.missing.join(', ')} ${verdict.missing.length === 1 ? 'is' : 'are'} `
        + 'missing or still a template. Nothing was verified. Owner action: Supabase Dashboard → '
        + `Project Settings → Database → Database Password for project ${APPROVED_TEST_REF} for DATABASE_URL, `
        + 'and the anon / service_role keys for that same project, then paste them into the env file this script names.';
    case 'LOCAL':
      return '\nℹ️ NOTICE: Currently configured for Local Docker Supabase. To target Hosted TEST, '
        + 'populate backend/.env.test.local.';
    case 'REFUSED':
      return verdict.reason === 'production'
        ? `\n🚨 FATAL: Production Supabase reference detected (${FORBIDDEN_PROD_REF}). `
          + 'Automated tests and testing scripts are STRICTLY FORBIDDEN against production.'
        : `\n❌ FAIL: ${verdict.problems.length} environment configuration problem(s). Nothing was verified.`;
    default:
      return `\n❌ ERROR: Environment is not correctly targeting ${APPROVED_TEST_REF}.`;
  }
}

/**
 * PASS 0 · PENDING/LOCAL 2 (0 with the named `--allow-pending` escape) · REFUSED/MISMATCH 1.
 */
function exitCodeFor(verdict, argv) {
  const args = Array.isArray(argv) ? argv : [];
  const allowPending = args.includes('--allow-pending');
  switch (verdict.status) {
    case 'PASS': return 0;
    case 'PENDING':
    case 'LOCAL': return allowPending ? 0 : 2;
    default: return 1;
  }
}

/** Print the report for `env` and return the verdict, so the CLI and a caller share one truth. */
function verifyEnvironment(source) {
  const env = source || process.env;
  const verdict = decide(env);
  const view = verdict.view;

  console.log('------------------------------------------------------------');
  console.log('NABIN Hosted Supabase TEST Environment Safety Verification');
  console.log('------------------------------------------------------------');
  console.log(`Active Environment:   ${view.env}`);
  console.log(`Declared Project Ref: ${view.declaredRef || '(none)'}`);
  console.log(`Node Environment:     ${view.nodeEnv}`);
  console.log(`REST Gateway Host:    ${view.restHost || 'local loopback'}`);
  console.log(`Live PostgreSQL:      ${env.SUPABASE_POSTGRES_LIVE || 'false'}`);

  console.log('\nCredential Status for nabin-test:');
  for (const slot of CREDENTIAL_SLOTS) {
    console.log(`  - ${slot.key.padEnd(26)} ${verdict.credentials[slot.key] ? 'Configured ✅' : 'Missing / Placeholder ⚠️'}`);
  }

  if (verdict.status === 'REFUSED' && verdict.reason === 'configuration') {
    console.error('🚨 Environment configuration problems detected:');
    for (const p of verdict.problems) console.error(`  - ${p}`);
  }
  if (verdict.notes.length > 0) {
    console.log('\nNotes (not failures):');
    for (const n of verdict.notes) console.log(`  - ${n}`);
  }

  console.log(finalLine(verdict));
  return verdict;
}

if (require.main === module) {
  const choice = chooseEnvFile(process.env);
  if (choice.loaded) {
    // A deliberate `.env.test.local` still wins over `.env`; neither wins over the harness.
    require('dotenv').config({ path: choice.loaded, override: choice.reason === 'test-local-file' });
    console.log(`(configuration file: ${choice.loaded} — ${choice.reason})`);
  } else {
    console.log(`(configuration inherited from the ${process.env.NABIN_TARGET_LABEL} harness target; `
      + 'no env file was loaded, because a file must not move the target the harness audited)');
  }
  const verdict = verifyEnvironment(process.env);
  process.exit(exitCodeFor(verdict, process.argv.slice(2)));
}

module.exports = {
  verifyEnvironment, decide, exitCodeFor, finalLine, chooseEnvFile,
  APPROVED_TEST_REF, FORBIDDEN_PROD_REF, CREDENTIAL_SLOTS,
};
