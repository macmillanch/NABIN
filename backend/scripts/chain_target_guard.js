// =========================================================================
// CHAIN TARGET GUARD — the store a chain link will ACTUALLY reach
//
// Shared by `scripts/test_chain.js` and `chain_target_guard_test.js`, in the same spirit as
// `scripts/port_release.js`: the runner is awkward to import for a regression check, and a
// second copy of this logic in a test would guard the copy instead of the guard.
//
// Why the effective env and not `process.env`: `src/server.js:2` and `src/supabase.js:2` run
// `require('dotenv').config({ path: '../.env' })`, so the harness and every link fill any key
// the shell left undefined from `backend/.env` — whose SECTION A active default is a hosted
// Supabase project. A target check that reads only the shell therefore passes on precisely the
// invocation `package.json` ships (`"test": "node scripts/test_chain.js"`), which is how
// `chain_20261012_144509_6704_f5972d` and `chain_20261012_025418_25828_8f0de6` booted the chain
// against the hosted dev project while its loopback guard reported nothing.
// =========================================================================

const fs = require('fs');
const path = require('path');

// The production project, refused unconditionally. Same value `with_local_target.js`,
// `with_staging_target.js` and `verify_hosted_test_env.js` already carry.
const PRODUCTION_REF = 'ouxvqmhuyueklnegvmxe';

// The keys that decide where a read or a write lands.
const TARGET_KEYS = ['DATABASE_URL', 'SUPABASE_URL'];

// The keys a direct-`pg` harness resolves its own connection from. `NABIN_PG_NOTIFY` is the second
// because `test_fixtures.js` has always accepted it; it is read AFTER `DATABASE_URL` on purpose -
// reading it first is how a fixture link wrote `public` while the application it fed read the clone.
const PG_TARGET_KEYS = ['DATABASE_URL', 'NABIN_PG_NOTIFY'];

// The hard isolation guard's own redirection keys. `NABIN_GUARD_SCHEMA` decides which schema
// `scripts/chain_scratch.js` watches, and `NABIN_GUARD_PROOF=1` is the explicit statement that a
// run INTENDS to watch something other than `public`.
const GUARD_SCHEMA_KEY = 'NABIN_GUARD_SCHEMA';
const GUARD_PROOF_KEY = 'NABIN_GUARD_PROOF';

function isLoopback(url) {
  try {
    return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * F-C1-1: the value that DECLARES a PostgreSQL target, or null.
 *
 * Precedence is the one `remoteStoreWarning` already documents — the shell wins, even with an empty
 * string, because that is how dotenv behaves — and then the env file the children load. What it
 * deliberately does NOT have is a third step that invents an address. Measured 2026-10-16: a bare
 * `node scripts/test_store_census.js count public` with nothing configured exited 0 having counted
 * 74 `public` lines from a DSN hardcoded inside the script, i.e. from a store no configuration named.
 * A null result is the caller's cue to refuse.
 */
function declaredTarget({ keys = PG_TARGET_KEYS, shellEnv = process.env, fileEnv = null } = {}) {
  for (const key of keys) {
    const value = shellEnv && shellEnv[key] !== undefined ? `${shellEnv[key]}`.trim() : '';
    if (value) return { value, key, source: `shell ${key}` };
  }
  const file = fileEnv || {};
  for (const key of keys) {
    const value = file[key] ? `${file[key]}`.trim() : '';
    if (value) return { value, key, source: `${chainEnvFile()} ${key}` };
  }
  return null;
}

/**
 * An explicit, validated, loopback PostgreSQL target — or a thrown refusal, before any socket opens.
 *
 * The value is never printed: it carries a password. Refusals name the key and the file that should
 * declare it, and the success path returns host/port/database only.
 */
function requireLoopbackPgTarget({ label = 'target', keys = PG_TARGET_KEYS, shellEnv = process.env, fileEnv } = {}) {
  const file = fileEnv === undefined ? readFileEnv() : fileEnv;
  if (file && file.__readError) {
    throw new Error(`${label} REFUSED: cannot read ${chainEnvFile()} (${file.__readError}), so the `
      + 'target the children would load is unknown. Fix the file or pass NABIN_CHAIN_ENV_FILE.');
  }
  const declared = declaredTarget({ keys, shellEnv, fileEnv: file });
  if (!declared) {
    throw new Error(`${label} REFUSED: no PostgreSQL target is declared — ${keys.join(' / ')} are unset `
      + `in the shell and in ${chainEnvFile()}. Nothing was connected. Run under `
      + 'scripts/with_local_target.js for the local Docker stack, or export the key explicitly. '
      + 'A hardcoded fallback address is what this refusal removes.');
  }
  if (`${declared.value}`.includes(PRODUCTION_REF)) {
    throw new Error(`${label} REFUSED: ${declared.source} carries the production project ref `
      + `${PRODUCTION_REF} — a direct-connection harness must not aim at production.`);
  }
  let url;
  try {
    url = new URL(declared.value);
  } catch (e) {
    // The value is not echoed: it may carry a password.
    throw new Error(`${label} REFUSED: ${declared.source} is not a parsable PostgreSQL URL `
      + '(value not printed). Fix the declaration instead of falling back to another store.');
  }
  if (!isLoopback(declared.value)) {
    throw new Error(`${label} REFUSED: ${declared.source} host ${url.hostname} is not loopback — a `
      + 'direct-connection harness writes fixture rows and must not aim at a hosted database.');
  }
  return {
    connectionString: declared.value,
    source: declared.source,
    host: url.hostname,
    port: url.port || '5432',
    database: url.pathname.replace(/^\//, ''),
  };
}

/**
 * F-C1-3: is the hard guard watching the schema this run means it to watch?
 *
 * `NABIN_GUARD_SCHEMA` is read by `scripts/chain_scratch.js` at require time, and both runners pass
 * `process.env` straight through to their children — measured 2026-10-16: zero references to the key
 * in `scripts/test_chain.js` and `scripts/with_local_target.js`, so a value left in a reused shell by
 * a proof session re-aimed the per-link hard guard at the wrong schema and the link still read CLEAN.
 * Proof mode therefore needs two declarations, not one: the schema and the intent.
 *
 * `allowProof: false` is the ordinary-run reading — a chain run must guard `public` and must not
 * carry a proof flag at all. Returns a message naming keys and schema names only, or null.
 */
function guardEnvConflict(env = process.env, { allowProof = true } = {}) {
  const schema = `${env[GUARD_SCHEMA_KEY] || ''}`.trim();
  const proof = env[GUARD_PROOF_KEY] === '1';
  const redirected = schema !== '' && schema !== 'public';
  if (redirected && !proof) {
    return `${GUARD_SCHEMA_KEY}=${schema} aims the hard isolation guard at a schema that is not `
      + `\`public\` while ${GUARD_PROOF_KEY}=1 is not set. A stale value inherited from a proof session `
      + 'redirects the guard silently, which is the failure this refusal removes. Unset it for a normal '
      + `run, or set ${GUARD_PROOF_KEY}=1 as well when the redirect is intended.`;
  }
  if (!allowProof && (redirected || proof)) {
    return `a full-chain run must guard \`public\`: ${GUARD_SCHEMA_KEY}=${schema || '(unset)'} `
      + `and ${GUARD_PROOF_KEY}=${proof ? '1' : '(unset)'} declare proof mode, which exists for the `
      + 'disposable-schema detection probe only. Unset both to run the chain.';
  }
  return null;
}

/**
 * Parse `KEY=value` assignments out of an env file the way dotenv 17.4.2 does — semantics
 * measured against the installed package, not assumed: blank and `#` comment lines are
 * skipped, an `export ` prefix is accepted, surrounding quotes and whitespace are stripped,
 * and the last uncommented assignment to a key wins.
 */
function parseEnvAssignments(text) {
  const out = {};
  if (!text) return out;
  for (const rawLine of `${text}`.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    const inlineQuote = value.match(/^(["'])((?:\\.|(?!\1).)*)\1/);
    if (inlineQuote) {
      value = inlineQuote[2];
    } else {
      // Unquoted: dotenv ends the value at ` #`, so a trailing comment is not part of it.
      value = value.replace(/\s+#.*$/, '');
    }
    out[match[1]] = value.trim();
  }
  return out;
}

/**
 * The env a child process will end up with, for target purposes: dotenv fills only keys the
 * shell left `undefined`, so a shell value — including an empty string — always wins. That
 * precedence is what lets `with_local_target.js` override the hosted SECTION A default.
 */
function resolveStoreEnv(shellEnv, fileEnv) {
  const effective = Object.assign({}, fileEnv || {});
  for (const key of Object.keys(shellEnv || {})) {
    if (shellEnv[key] !== undefined) effective[key] = shellEnv[key];
  }
  return effective;
}

/**
 * Read the env file the children read. `NABIN_CHAIN_ENV_FILE` exists so a regression check can
 * exercise this path with an unresolvable fixture host instead of a real store; it is not a way
 * to run the chain against a target it would refuse, because the guard and the children resolve
 * the same path.
 */
function chainEnvFile() {
  return process.env.NABIN_CHAIN_ENV_FILE || path.join(__dirname, '..', '.env');
}

function readFileEnv() {
  try {
    return parseEnvAssignments(fs.readFileSync(chainEnvFile(), 'utf8'));
  } catch (e) {
    // F-C1-7: an ABSENT file is not an unreadable one. `src/server.js:2` and `src/supabase.js:2` call
    // `dotenv.config()`, which on a missing file loads nothing and is not an error — so the children's
    // target is exactly the shell's, which is known. Measured 2026-10-16 on a fresh `git archive HEAD`
    // checkout, where `backend/.env` cannot exist because it is untracked: treating absence as a read
    // failure made every guarded tool refuse a shell-declared loopback target, so no checkout of this
    // repository could run its own chain or its own regression suites.
    if (e.code === 'ENOENT') return {};
    // An unreadable file is not a licence to proceed: the children would fail just as loudly,
    // and a guard that defaults to "allowed" is the failure mode this module exists to remove.
    return { __readError: e.message };
  }
}

/**
 * Non-loopback means the suites would write fixture rows into a hosted project. Loopback runs
 * freely; an approved test store needs the explicit `NABIN_ALLOW_REMOTE_TESTS=1`; production
 * needs no flag that exists.
 *
 * Returns a message naming keys and hosts only — never key material.
 */
function remoteStoreWarning(effective) {
  const env = effective || {};
  const prodCarrier = TARGET_KEYS.concat(['NABIN_SUPABASE_REF'])
    .filter((key) => `${env[key] || ''}`.includes(PRODUCTION_REF));
  if (prodCarrier.length) {
    return `${prodCarrier.join(' and ')} carry the production project ref ${PRODUCTION_REF} — the chain `
      + 'writes fixture rows and refuses to aim them at production under any flag.';
  }
  if (env.__readError) {
    return `the chain cannot read ${chainEnvFile()} (${env.__readError}), so it cannot prove the `
      + 'target its links and harness would load. Fix the file or pass NABIN_CHAIN_ENV_FILE.';
  }
  if (env.NABIN_ALLOW_REMOTE_TESTS === '1') return null;
  const remote = TARGET_KEYS.filter((key) => env[key] && !isLoopback(env[key]));
  if (remote.length === 0) return null;
  return `${remote.join(' and ')} point at a non-loopback host — refusing to run the chain against it. `
    + 'This is the target backend/.env loads when the shell leaves the key unset, not only one you exported. '
    + 'Run through scripts/with_local_target.js for the local Docker stack, or set '
    + 'NABIN_ALLOW_REMOTE_TESTS=1 only if that store is an approved test environment and you intend it.';
}

module.exports = {
  PRODUCTION_REF,
  TARGET_KEYS,
  PG_TARGET_KEYS,
  GUARD_SCHEMA_KEY,
  GUARD_PROOF_KEY,
  isLoopback,
  parseEnvAssignments,
  resolveStoreEnv,
  chainEnvFile,
  readFileEnv,
  remoteStoreWarning,
  declaredTarget,
  requireLoopbackPgTarget,
  guardEnvConflict
};
