// Run a command against the LOCAL Docker Supabase block of backend/.env without changing which
// block that file keeps active. Needed because `src/supabase.js` loads `../.env` with plain dotenv,
// so every harness that requires it re-reads the active section itself: a server started against one
// target and a harness whose read-back resolves to another produces reds that are not code faults.
//
// Precedence, stated because it is the whole point of this wrapper: the local block is AUTHORITATIVE
// for the keys it declares, and any pre-existing value for those keys is replaced and reported by
// name. Keys the block does not declare pass through untouched, so an operator can still set
// NABIN_TEST_BASE_URL, NABIN_HARNESS_PORT, or a suite-specific variable in the parent shell.
//
// Usage: node scripts/with_local_target.js <command> [args...]
//   node scripts/with_local_target.js node src/server.js
//   node scripts/with_local_target.js node merchant_operations_test.js
//   node scripts/with_local_target.js node scripts/test_chain.js

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
// The guard-schema agreement lives in scripts/chain_target_guard.js so this wrapper, the chain runner
// and scripts/chain_scratch.js cannot each hold a different rule about when a redirect is legitimate.
const { guardEnvConflict } = require('./chain_target_guard');

const LOCAL_BLOCK_MARKER = /SECTION B:/;
const COMMENTED_PAIR = /^\s*#\s*([A-Za-z0-9_]+)=(.*)$/;
// A section rule in backend/.env is written as "# ------" or "# ======" — the space after the hash is
// part of the file's style, so the pattern must allow it or no boundary is ever found.
const HEADER_RULE = /^\s*#[ \t]*[=\-]{10,}\s*$/;

// The production project. This wrapper is the fail-closed boundary for "tests must never reach
// prod", so it is named here on purpose: no value of the child's environment may carry it.
const FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe';

// Keys that must be present and loopback for the result to honestly be called a local target.
const REQUIRED_KEYS = ['SUPABASE_URL', 'DATABASE_URL'];

const isLoopbackHost = (host) =>
  /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/.test(host);

// Mask a value down to what is safe to put in a log line: scheme, host and port only.
function maskTarget(value) {
  if (value === undefined || value === '') return '(empty)';
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    return '(unparsable)';
  }
}

function refuse(reason) {
  console.error(`REFUSED — local target could not be established: ${reason}`);
  console.error('Nothing was spawned. Fix the configuration, or run the command without this');
  console.error('wrapper when you genuinely mean a non-local target.');
  process.exit(2);
}

function localTargetEnv() {
  const envFile = path.resolve(__dirname, '../.env');
  // Measured 2026-10-16 on a fresh `git archive HEAD` checkout: `backend/.env` is untracked, so it
  // does not exist there, and this line threw an uncaught ENOENT stack. The wrapper's refusal path is
  // the contract — a bare `exit 2` naming the file and the template — not a Node stack trace.
  if (!fs.existsSync(envFile)) {
    refuse(`${envFile} does not exist. It is untracked, so a fresh checkout has none: copy the `
      + 'repository env template to it (with the SECTION B local-Docker block) before wrapping a run, '
      + 'or export DATABASE_URL/SUPABASE_URL for a loopback store yourself and run without this wrapper.');
  }
  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => LOCAL_BLOCK_MARKER.test(line));
  if (start < 0) refuse('backend/.env has no "SECTION B:" local-Docker block to apply');

  // Read only the local block: from the marker to the next header rule after the first pair. Without
  // the bound, any commented key further down the file (the shared-secrets block, a parked section)
  // would silently join the target, which is exactly the split-brain this wrapper exists to remove.
  const applied = [];
  let sawPair = false;
  for (const line of lines.slice(start + 1)) {
    if (HEADER_RULE.test(line) && sawPair) break;
    const match = COMMENTED_PAIR.exec(line);
    if (!match) continue;
    sawPair = true;
    const previous = process.env[match[1]];
    if (previous !== undefined && previous !== match[2].trim()) {
      applied.push({ key: match[1], value: match[2].trim(), overridden: true });
    } else {
      applied.push({ key: match[1], value: match[2].trim(), overridden: false });
    }
    process.env[match[1]] = match[2].trim();
  }
  if (!sawPair) throw new Error('the "SECTION B:" block declares no key=value pairs to apply');

  // A development boot declares no project ref, and the local stack speaks plain TCP. Clearing it is
  // only honest when the block itself declares it empty or omits it: a "local" block that carries a
  // project ref means the file and the label disagree, and silently blanking the ref would hide that.
  const declaredRef = applied.find((entry) => entry.key === 'NABIN_SUPABASE_REF');
  if (declaredRef && declaredRef.value !== '') {
    refuse(`the "SECTION B:" block declares NABIN_SUPABASE_REF=${declaredRef.value}, so a run applied `
      + 'from it is not unambiguously local');
  }
  if (!declaredRef) process.env.NABIN_SUPABASE_REF = '';
  delete process.env.DATABASE_SSL;
  return applied;
}

// Measured 2026-10-09: an isolation proof loaded `.chain-scratch/link.env` into a reused shell and
// every later run inherited the scratch proxy and a `chain_scratch` search_path. The local block
// overwrites both keys, so the leak is invisible by the time the child reads them — check the
// inherited values, before they are replaced, so a contaminated shell is reported as such.
function refuseInheritedIsolationLeak() {
  const leakedProxy = /:54331\b/.test(process.env.SUPABASE_URL || '');
  const leakedSchema = /search_path=chain_scratch/i.test(decodeURIComponent(process.env.DATABASE_URL || ''));
  if (!leakedProxy && !leakedSchema) return;
  const reasons = [];
  if (leakedProxy) reasons.push('SUPABASE_URL points at the scratch proxy :54331');
  if (leakedSchema) reasons.push('DATABASE_URL carries search_path=chain_scratch');
  refuse(`isolation (chain_scratch) environment has leaked into the parent process (${reasons.join(' and ')})`);
}

function refuseProdTarget() {
  const carrier = ['NABIN_SUPABASE_REF', 'SUPABASE_URL', 'DATABASE_URL']
    .filter((k) => (process.env[k] || '').includes(FORBIDDEN_PROD_REF));
  if (carrier.length === 0) return;
  refuse(`the production project ref ${FORBIDDEN_PROD_REF} appears in ${carrier.join(', ')}; `
    + 'this wrapper only ever aims a run at the local Docker stack');
}

// F-C1-3: the hard isolation guard reads NABIN_GUARD_SCHEMA at require time and the children inherit
// this wrapper's environment, so one value a proof session left in a reused shell moves the guard off
// `public` for the whole run — and the run then prints CLEAN about a schema it never owned. Refuse the
// half-declared redirect (schema without NABIN_GUARD_PROOF=1) here, before anything is spawned. An
// explicit proof session still passes, which is what scripts/guard_detection_probe.js is.
function refuseUnprovenGuardRedirect() {
  const conflict = guardEnvConflict(process.env);
  if (!conflict) return;
  refuse(conflict);
}

function validateEffectiveTarget() {
  const missing = REQUIRED_KEYS.filter((k) => !process.env[k]);
  if (missing.length) refuse(`the local block left these required keys unset: ${missing.join(', ')}`);

  const bad = [];
  for (const key of REQUIRED_KEYS) {
    let host = '';
    try {
      host = new URL(process.env[key]).hostname;
    } catch {
      bad.push(`${key} is not a URL (${maskTarget(process.env[key])})`);
      continue;
    }
    if (!isLoopbackHost(host)) bad.push(`${key} resolves to a non-loopback host (${host})`);
  }
  if (bad.length) refuse(`${bad.join('; ')} — a test labelled "local" must not reach a hosted database`);

  const ref = process.env.NABIN_SUPABASE_REF;
  if (ref !== '') refuse(`NABIN_SUPABASE_REF is set (${ref}) after a local apply, so the target is ambiguous`);
}

refuseInheritedIsolationLeak();
const applied = localTargetEnv();
refuseProdTarget();
validateEffectiveTarget();
// After the apply, not before: the .env block is part of the effective environment the child inherits,
// so a redirect is only fully known once both the shell and the applied block have been read.
refuseUnprovenGuardRedirect();

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: node scripts/with_local_target.js <command> [args...]');
  process.exit(2);
}

const overrides = applied.filter((entry) => entry.overridden).map((entry) => entry.key);

// Marked before the log line so a child can prove which target the wrapper resolved, and so this
// file's own output names that target without carrying a key, token, or password.
const TARGET_LABEL = 'local-docker';
process.env.NABIN_TARGET_LABEL = TARGET_LABEL;
process.env.NABIN_LOCAL_TARGET_APPLIED = '1';

console.error(`local target applied: ${applied.map((entry) => entry.key).join(', ')} | ref emptied | DATABASE_SSL dropped`);
if (overrides.length) {
  console.error(`inherited values replaced by the local block (names only): ${overrides.join(', ')}`);
}
console.error(`effective target label=${TARGET_LABEL}`
  + ` | env=${process.env.NABIN_ENV || '(unset)'} | ref=${process.env.NABIN_SUPABASE_REF || '(empty)'}`
  + ` | supabase=${maskTarget(process.env.SUPABASE_URL)}`
  + ` | database=${maskTarget(process.env.DATABASE_URL)}`);

const child = cp.spawn(command, args, { stdio: 'inherit', env: { ...process.env }, cwd: process.cwd() });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on('error', (error) => {
  console.error(`spawn failed: ${error.message}`);
  process.exit(2);
});
