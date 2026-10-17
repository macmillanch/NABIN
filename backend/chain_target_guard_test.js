// =========================================================================
// THE CHAIN MUST REFUSE A HOSTED TARGET IT CANNOT SEE, NOT ONLY ONE IT CAN
//
// `scripts/test_chain.js` refuses to run when `SUPABASE_URL`/`DATABASE_URL` point off
// loopback, because the suites read and write fixture rows and a hosted target turns a
// regression run into an incident. The check was run against `process.env` alone. That is
// exactly the value a bare run does NOT have: `src/server.js:2` and `src/supabase.js:2` call
// `require('dotenv').config({ path: '../.env' })`, so any key absent from the shell is filled
// from `backend/.env` SECTION A - which is the active default and is hosted.
//
// Measured, not reasoned. `package.json` ships `"test": "node scripts/test_chain.js"` with no
// target wrapper. Two runs on 12 Oct 2026 booted the chain against the hosted dev project:
// their `harness-boot.log` first lines read "environment: testing (project ywhxkzmbwppkdemvzlhv)",
// while the two green runs of the same day read "environment: development, target: local Docker
// (127.0.0.1)". In `chain_20261012_144509_6704_f5972d` 40 of 69 link logs carry the hosted
// hostname, 7 links were killed at exactly the 20-minute per-link timeout, and only the suites
// that carry their own split-target guard (#283) refused - the runner itself never did.
//
// So the guard's source of truth was the shell, and the target's source of truth was the file.
// The checks below pin the two together: the effective env is what a child will actually see,
// process.env first and `backend/.env` under it, with dotenv 17.4.2's measured semantics.
//
// Two things this suite deliberately is not: it never runs the chain (the `require.main` seam
// lets it require the shared module directly), and its one executed probe uses a fixture whose
// host is `nabin-chain-guard-probe.invalid` - a name that cannot resolve - so a mis-wired fix
// could not reach any real store. No secret appears in any fixture or any printed detail.
// =========================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BACKEND = __dirname;
const GUARD_MODULE = path.join(BACKEND, 'scripts', 'chain_target_guard.js');
const RUNS_DIR = path.join(BACKEND, '.chain-logs', 'runs');

// Requiring the guard must not start anything. Count the evidence dirs first, so the assertion
// below is about the seam's promise rather than a copy of a pattern.
const runsBefore = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

// ---------------------------------------------------------------- module surface (CTG-00/01)

const runsAfterRequire = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;
check('CTG-00', runsAfterRequire === runsBefore,
  `requiring the guard created no chain run (${runsBefore} -> ${runsAfterRequire} run dirs)`);

let guard = null;
let requireError = null;
try {
  guard = require(GUARD_MODULE);
} catch (e) {
  requireError = e.message;
}
check('CTG-01', Boolean(guard)
  && typeof guard.parseEnvAssignments === 'function'
  && typeof guard.resolveStoreEnv === 'function'
  && typeof guard.remoteStoreWarning === 'function'
  && typeof guard.isLoopback === 'function',
  requireError
    ? `scripts/chain_target_guard.js exports parseEnvAssignments, resolveStoreEnv, remoteStoreWarning, isLoopback (require failed: ${requireError})`
    : `exports present: ${guard ? Object.keys(guard).sort().join(',') : 'none'}`);

if (!guard || typeof guard.parseEnvAssignments !== 'function') {
  console.log(`\nCTG_SUMMARY passed=0 failed=${results.length} skipped=${0} reason=guard module or its functions are absent - every later check is unreachable`);
  process.exit(1);
}

const { parseEnvAssignments, resolveStoreEnv, remoteStoreWarning, isLoopback } = guard;
const HOSTED = 'https://nabin-chain-guard-probe.invalid';
const LOCAL_REST = 'http://127.0.0.1:54321';
const LOCAL_PG = 'postgresql://postgres:pw@127.0.0.1:54322/postgres';

// ---------------------------------------------------------------- file parsing (CTG-02..06)
// dotenv 17.4.2 semantics were measured against the installed package, not assumed: a
// commented line is skipped, the last uncommented assignment wins, surrounding quotes and
// spaces are stripped, and an `export ` prefix is accepted.

const parsedCommented = parseEnvAssignments('SUPABASE_URL=https://a.invalid\n# SUPABASE_URL=https://b.invalid\n');
check('CTG-02', parsedCommented.SUPABASE_URL === 'https://a.invalid',
  `a commented override is ignored (SECTION B of .env is commented) -> ${parsedCommented.SUPABASE_URL}`);

const parsedDup = parseEnvAssignments('SUPABASE_URL=https://a.invalid\nSUPABASE_URL=https://c.invalid\n');
check('CTG-03', parsedDup.SUPABASE_URL === 'https://c.invalid',
  `the last uncommented assignment wins, as measured from dotenv.parse -> ${parsedDup.SUPABASE_URL}`);

const parsedQuotes = parseEnvAssignments('SUPABASE_URL="https://q.invalid"\n  DATABASE_URL=  postgresql://u@127.0.0.1/d  \n');
check('CTG-04', parsedQuotes.SUPABASE_URL === 'https://q.invalid' && parsedQuotes.DATABASE_URL === 'postgresql://u@127.0.0.1/d',
  `quotes and surrounding spaces are stripped -> rest=${parsedQuotes.SUPABASE_URL}, pg=${parsedQuotes.DATABASE_URL}`);

const parsedExport = parseEnvAssignments('export SUPABASE_URL=https://e.invalid\n');
check('CTG-05', parsedExport.SUPABASE_URL === 'https://e.invalid',
  `an "export KEY=value" line is parsed, as dotenv does -> ${parsedExport.SUPABASE_URL}`);

const parsedNoise = parseEnvAssignments('\n# ===== header =====\nNODE_ENV=development\n\n# SECTION B: LOCAL DOCKER\n# DATABASE_URL=x\n');
check('CTG-06', parsedNoise.SUPABASE_URL === undefined && parsedNoise.NODE_ENV === 'development',
  `headers, blanks and comment-only sections yield no target keys (SUPABASE_URL=${String(parsedNoise.SUPABASE_URL)}, NODE_ENV=${parsedNoise.NODE_ENV})`);

// ---------------------------------------------------------------- precedence (CTG-07..09b)
// dotenv's default is non-overriding: a key the shell already carries (even empty) wins.

check('CTG-07', resolveStoreEnv({ SUPABASE_URL: LOCAL_REST }, { SUPABASE_URL: HOSTED }).SUPABASE_URL === LOCAL_REST,
  'a shell value wins over the file, which is what with_local_target.js relies on');

check('CTG-08', resolveStoreEnv({ SUPABASE_URL: '' }, { SUPABASE_URL: HOSTED }).SUPABASE_URL === '',
  'an empty shell value still wins (dotenv overrides only an undefined key) - pinned so the resolver cannot silently start preferring the file');

check('CTG-09', resolveStoreEnv({}, { SUPABASE_URL: HOSTED }).SUPABASE_URL === HOSTED,
  `a key absent from the shell is filled from the file - the bare-run case -> ${resolveStoreEnv({}, { SUPABASE_URL: HOSTED }).SUPABASE_URL}`);

// A caller may build the shell env as an object literal (`{ SUPABASE_URL: process.env.X }`), where
// an unset X arrives as a present key holding undefined. dotenv treats that as absent; a resolver
// that let it blank the file value would re-open the exact blindness this guard exists to close.
const undefinedShell = resolveStoreEnv({ SUPABASE_URL: undefined }, { SUPABASE_URL: HOSTED });
check('CTG-09b', undefinedShell.SUPABASE_URL === HOSTED,
  `a present-but-undefined shell key falls through to the file, as dotenv does -> ${undefinedShell.SUPABASE_URL}`);

// ---------------------------------------------------------------- guard decisions (CTG-10..16)

// THE defect: bare `npm test` shape - nothing in the shell, hosted in the file.
const bareEffective = resolveStoreEnv({}, { SUPABASE_URL: HOSTED, DATABASE_SSL: 'require' });
check('CTG-10', remoteStoreWarning(bareEffective) !== null,
  `bare-run shape (empty shell + hosted .env) now refuses; before the fix the guard saw no key at all (warning=${JSON.stringify(remoteStoreWarning(bareEffective))})`);

const bareWarning = remoteStoreWarning(bareEffective) || '';
check('CTG-11', /SUPABASE_URL/.test(bareWarning) && /with_local_target\.js/.test(bareWarning),
  `the refusal names the key and the wrapper that fixes it -> ${bareWarning.slice(0, 190)}`);

check('CTG-12', remoteStoreWarning(resolveStoreEnv(
  { SUPABASE_URL: LOCAL_REST, DATABASE_URL: LOCAL_PG }, { SUPABASE_URL: HOSTED, DATABASE_URL: HOSTED })) === null,
  'the documented local command still runs: loopback in the shell beats hosted in the file');

// The 14:45 fingerprint: PG on loopback while REST is hosted. A split target is still a remote target.
check('CTG-13', remoteStoreWarning(resolveStoreEnv(
  { DATABASE_URL: LOCAL_PG }, { SUPABASE_URL: HOSTED })) !== null,
  'a split target (loopback PG, hosted REST) is refused, not treated as local');

check('CTG-14', remoteStoreWarning(resolveStoreEnv(
  { SUPABASE_URL: LOCAL_REST, DATABASE_URL: LOCAL_PG }, {})) === null,
  'a fully loopback effective env is allowed with no flags');

check('CTG-15', remoteStoreWarning(resolveStoreEnv(
  { NABIN_ALLOW_REMOTE_TESTS: '1' }, { SUPABASE_URL: HOSTED })) === null,
  'NABIN_ALLOW_REMOTE_TESTS=1 stays the only escape hatch, unchanged');

check('CTG-16', remoteStoreWarning(resolveStoreEnv(
  { NABIN_ALLOW_REMOTE_TESTS: '1', SUPABASE_URL: `https://${guard.PRODUCTION_REF}.supabase.co` })) !== null,
  'the production project ref is refused even with the escape hatch set - the flag authorises a test store, not production');

// ---------------------------------------------------------------- output safety (CTG-17)

const secretFixture = { SUPABASE_URL: HOSTED, SUPABASE_SERVICE_ROLE_KEY: 'should-never-be-printed-xyz' };
const leakProbe = remoteStoreWarning(resolveStoreEnv({}, secretFixture));
check('CTG-17', typeof leakProbe === 'string' && !leakProbe.includes('should-never-be-printed-xyz') && !/:\w+@/.test(leakProbe),
  `the refusal carries key names and no credential material -> ${String(leakProbe).slice(0, 120)}`);

check('CTG-18', isLoopback(LOCAL_REST) && isLoopback(LOCAL_PG) && isLoopback('http://localhost:4000') && !isLoopback(HOSTED),
  'isLoopback reads the hostname of http(s):// and postgresql:// URLs alike');

// ---------------------------------------------------------------- the real repository (CTG-19/20)
// Read-only: this parses the committed .env and decides, it never boots anything.

let realParsed = {};
let realFileFound = false;
try {
  realParsed = parseEnvAssignments(fs.readFileSync(path.join(BACKEND, '.env'), 'utf8'));
  realFileFound = true;
} catch (e) {
  realFileFound = false;
}
const realEffective = resolveStoreEnv({}, realParsed);
const realWarning = remoteStoreWarning(realEffective);
const realHost = (() => {
  try { return new URL(realEffective.SUPABASE_URL).hostname; } catch (e) { return '(unset)'; }
})();
check('CTG-19', realFileFound && realWarning !== null,
  `with an empty shell the committed .env resolves to a non-loopback REST host, so a bare chain must refuse now (host=${realHost.replace(/^([^.]*)\./, '$1.')}...)`);

check('CTG-20', remoteStoreWarning(resolveStoreEnv(
  { SUPABASE_URL: LOCAL_REST, DATABASE_URL: LOCAL_PG }, realParsed)) === null,
  'the same committed .env does not block a wrapped local run - the fix refuses bare, it does not refuse local');

// ---------------------------------------------------------------- executed wiring proof (CTG-21..23)
// The pure checks above cannot show that the runner's own pre-flight uses the resolver. This
// spawns the real `node scripts/test_chain.js` with the target keys removed from its shell and
// NABIN_CHAIN_ENV_FILE aimed at a fixture. If the wiring is missing the runner proceeds to boot
// a harness - against a fixture host that cannot resolve - so the probe is safe either way and
// cannot touch a real store.

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nabin-chain-guard-'));
const fixtureEnv = path.join(fixtureDir, 'env');
fs.writeFileSync(fixtureEnv, `NODE_ENV=development\nSUPABASE_URL=${HOSTED}\n`, 'utf8');

const shellEnv = Object.assign({}, process.env);
delete shellEnv.SUPABASE_URL;
delete shellEnv.DATABASE_URL;
delete shellEnv.NABIN_ALLOW_REMOTE_TESTS;
delete shellEnv.SUPABASE_SERVICE_ROLE_KEY;
delete shellEnv.SUPABASE_ANON_KEY;

const probe = spawnSync(process.execPath, [path.join(BACKEND, 'scripts', 'test_chain.js')], {
  cwd: BACKEND,
  encoding: 'utf8',
  timeout: 30000,
  env: Object.assign({}, shellEnv, {
    NABIN_CHAIN_ENV_FILE: fixtureEnv,
    NABIN_HARNESS_PORT: '4111',
    // Second line of defence, and the reason it is here: this suite is the only place that spawns
    // the real runner. If the target guard ever regresses, the nested runner would load the *real*
    // backend/.env, whose SECTION A is hosted and *is* pinned to that project - so the app's own
    // boot gate (`src/services/nabinEnv.js:185-208`, `src/supabase.js:15`) would let it start and
    // write at boot. Pinning this probe to a ref that belongs to no project makes that gate throw
    // instead, so a regression here cannot reach a hosted store.
    NABIN_ENV: 'development',
    NABIN_SUPABASE_REF: 'nabinprobe0123456789',
    NODE_ENV: 'development'
  })
});
const probeText = `${probe.stdout || ''}${probe.stderr || ''}`;
const runsAfterProbe = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;

check('CTG-21', probe.status === 1,
  `the bare runner refuses a hosted effective target before any link (exit=${probe.status}${probe.error ? ` ${probe.error.code || ''}` : ''})`);

check('CTG-22', /chain refused/.test(probeText) && /SUPABASE_URL/.test(probeText),
  `the refusal is the runner's own pre-flight line, printed on stdout or stderr -> ${probeText.split(/\r?\n/).filter((l) => /refus/i.test(l))[0] || '(no refusal line)'}`.slice(0, 220));

check('CTG-23', runsAfterProbe === runsBefore,
  `no run directory was created for the refused run (${runsBefore} -> ${runsAfterProbe})`);

try {
  fs.rmSync(fixtureDir, { recursive: true, force: true });
} catch (e) { /* best effort on a temp dir */ }

// ---------------------------------------------------------------- absent vs unreadable env file (CTG-24..29)
//
// F-C1-7. `backend/.env` is untracked, so it does NOT exist in a fresh checkout — and until this
// change the guard read that as a refused read, so a fresh checkout could not run its own census, its
// own keep-rule selftest, or its own chain even with a loopback target declared in the shell. Absence
// has to mean "the children load nothing extra" (what `dotenv.config()` actually does), while a file
// that exists and cannot be read stays a refusal. Both halves are checked here, because the useful
// property is exactly the difference between them.

const missingEnv = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nabin-env-absent-')), 'nope.env');
const savedEnvFile = process.env.NABIN_CHAIN_ENV_FILE;
process.env.NABIN_CHAIN_ENV_FILE = missingEnv;

const absentRead = guard.readFileEnv();
check('CTG-24', Object.keys(absentRead).length === 0 && absentRead.__readError === undefined,
  `a missing env file reads as no declarations, not a read failure (${JSON.stringify(absentRead).slice(0, 60)})`);

let absentShell = null;
let absentThrew = null;
try {
  absentShell = guard.requireLoopbackPgTarget({
    label: 'CTG-24b', shellEnv: { DATABASE_URL: LOCAL_PG }, fileEnv: undefined
  });
} catch (e) { absentThrew = e.message; }
check('CTG-25', Boolean(absentShell) && absentShell.source === 'shell DATABASE_URL'
  && absentShell.host === '127.0.0.1' && absentShell.port === '54322',
  absentThrew ? `still refused a shell-declared loopback target with no env file: ${absentThrew.slice(0, 90)}`
    : `with the file absent the shell target is honoured (${absentShell.source} -> `
      + `${absentShell.host}:${absentShell.port}/${absentShell.database}); the value itself is not printed`);

let bareThrew = null;
try {
  guard.requireLoopbackPgTarget({ label: 'CTG-26', shellEnv: {}, fileEnv: undefined });
} catch (e) { bareThrew = e.message; }
check('CTG-26', Boolean(bareThrew) && /no PostgreSQL target is declared/.test(bareThrew),
  `absence is not an invented fallback: shell empty and file absent still refuses -> `
  + `${String(bareThrew || '(no refusal thrown!)').slice(0, 90)}`);

// A directory at the env-file path is the "exists but cannot be read" case: EISDIR, not ENOENT.
process.env.NABIN_CHAIN_ENV_FILE = BACKEND;
const badRead = guard.readFileEnv();
let dirThrew = null;
try {
  guard.requireLoopbackPgTarget({ label: 'CTG-27', shellEnv: { DATABASE_URL: LOCAL_PG } });
} catch (e) { dirThrew = e.message; }
check('CTG-27', badRead.__readError !== undefined && Boolean(dirThrew) && /REFUSED: cannot read/.test(dirThrew),
  `an env file that exists but cannot be read is still a refusal, not a licence to proceed (`
  + `${dirThrew ? 'thrown as expected' : 'NOT thrown'})`);

if (savedEnvFile === undefined) delete process.env.NABIN_CHAIN_ENV_FILE;
else process.env.NABIN_CHAIN_ENV_FILE = savedEnvFile;

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? '❌' : '✅'} ${results.length - failed}/${results.length} passed, ${failed} failed`);
for (const r of results.filter((x) => !x.ok)) console.log(`   FAILED ${r.id}: ${r.detail}`);
process.exit(failed ? 1 : 0);
