// =========================================================================
// THE RUNNER MUST KNOW ITS OWN HARNESS IS STILL THERE, AND MUST NOT SHARE ONE
//
// `scripts/test_chain.js` proves the harness answers /api/health once, in startHarness, then runs
// every link against that child. If the child dies mid-run — crash, unhandled error, killed from
// outside the runner — nothing between links noticed: each later suite connects to a now-dead
// 127.0.0.1:<port> and fails, so ONE harness death was reported as dozens of test failures. That is
// the same "harness failure wearing a test failure's clothes" the boot-readiness fix in the runner
// already refuses to accept, just relocated from before-link-1 to before-link-N.
//
// The other half: the only guard against two runners was startHarness's `portInUse` probe, which is
// a TOCTOU check — two runners can both see the port free, then contend for it, and the loser can
// pass the readiness poll against the winner's harness and run its links through a server whose env
// it does not control, while the refusal message blamed "the manually-started backend".
//
// So the runner now (1) re-proves liveness before each link and stops on one HARNESS_UNREACHABLE,
// and (2) claims the harness port with an atomic single-runner lock keyed to that port.
//
// These checks exercise the REAL exported functions, not a copy (the `scanOutput` /
// `chain_throttle_heuristic_test.js` precedent): the pure liveness table, isPidAlive, and the full
// lock acquire / refuse / stale-reclaim / release cycle against a temp directory. No check binds a
// socket, starts a harness, or touches a database. The single executed probe spawns the real runner
// on port 4111 with a LOOPBACK fixture target and a live lock already held, so it refuses at the
// lock before spawning anything — it never reaches a store. No secret appears in any fixture.
// =========================================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const BACKEND = __dirname;
const RUNNER = path.join(BACKEND, 'scripts', 'test_chain.js');
const LOG_DIR = path.join(BACKEND, '.chain-logs');
const RUNS_DIR = path.join(LOG_DIR, 'runs');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

// ---------------------------------------------------------------- module surface (CRG-00/01)

const runsBefore = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;
const mod = require(RUNNER);
const runsAfterRequire = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;

check('CRG-00', runsAfterRequire === runsBefore,
  `requiring the runner started no chain run (${runsBefore} -> ${runsAfterRequire} run dirs)`);

const HELPERS = ['livenessVerdict', 'isolatedLinkVerdict', 'isolationFailureSummary', 'harnessLockPath', 'readHarnessLock', 'isPidAlive',
  'acquireHarnessLock', 'releaseHarnessLock', 'parseOnlyTokens', 'parseCliArgs', 'selectLinks', 'linkCatalog',
  // The lane primitives: scripts/lane_check.js boots a lane with THESE, so a suite that passes the
  // lane check is measured against the same code path a `laneServer` link gets in the chain.
  'spawnLane', 'stopLane'];
const missing = HELPERS.filter((k) => typeof mod[k] !== 'function');
check('CRG-01', missing.length === 0,
  `the runner exports every guard helper the chain needs (missing: ${missing.join(', ') || 'none'})`);

// ---------------------------------------------------------------- liveness table (CRG-02..07)

const lv = (p, h) => mod.livenessVerdict({ procExited: p, healthStatus: h });

const deadButAnswering = lv(true, 200);
check('CRG-02', deadButAnswering.state === 'DOWN',
  `our own child exiting is DOWN even if a 200 answers the port (a rebound foreign server must not read as alive)`);
check('CRG-03', /process exited/.test(deadButAnswering.reason || ''),
  `the DOWN reason names the dead process, not the HTTP result -> "${deadButAnswering.reason}"`);

const alive = lv(false, 200);
check('CRG-04', alive.state === 'UP', `a live child answering 200 is UP`);

const degraded = lv(false, 503);
check('CRG-05', degraded.state === 'UNKNOWN' && /HTTP 503/.test(degraded.reason || ''),
  `a live child answering non-200 is UNKNOWN with the status in the reason -> "${degraded.reason}"`);

const wedged = lv(false, null);
check('CRG-06', wedged.state === 'UNKNOWN' && /no answer/.test(wedged.reason || ''),
  `a live child that stops answering is UNKNOWN and says "no answer" -> "${wedged.reason}"`);

const deadNonHealth = lv(true, 503);
check('CRG-07', deadNonHealth.state === 'DOWN',
  `procExited takes precedence over any non-200 (DOWN, not UNKNOWN)`);

// ---------------------------------------------------------------- isPidAlive (CRG-08..11)

check('CRG-08', mod.isPidAlive(process.pid) === true,
  `this suite's own pid reports alive (pid ${process.pid})`);

// A pid that is certainly dead on this machine: scan upward from ours for the first the OS rejects.
let deadPid = null;
for (let cand = process.pid + 1; cand < process.pid + 50000 && deadPid === null; cand++) {
  if (mod.isPidAlive(cand) === false) deadPid = cand;
}
check('CRG-09', deadPid !== null && mod.isPidAlive(deadPid) === false,
  `a reclaimed pid the OS does not know reports not-alive (pid ${deadPid})`);

check('CRG-10', ['abc', null, undefined, {}, NaN].every((v) => mod.isPidAlive(v) === false),
  `non-integer pids are not-alive rather than throwing`);

check('CRG-11', mod.isPidAlive(0) === false && mod.isPidAlive(-7) === false,
  `pids <= 0 are not-alive (0 would signal the whole process group)`);

// ---------------------------------------------------------------- lock path (CRG-12)

check('CRG-12', mod.harnessLockPath('/tmp', 4111) === path.join('/tmp', 'harness-4111.lock'),
  `the lock is keyed to the harness port -> ${mod.harnessLockPath('/tmp', 4111)}`);

// ---------------------------------------------------------------- acquire / refuse / reclaim / release

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crg-'));
const ID = (runId) => ({ pid: process.pid, runId, host: '127.0.0.1', startedAt: new Date().toISOString() });
const PORT = 5599;

// fresh acquire
const token1 = mod.acquireHarnessLock(tmp, PORT, ID('crg-run-1'));
const owner1 = mod.readHarnessLock(mod.harnessLockPath(tmp, PORT));
check('CRG-13', typeof token1 === 'string' && token1.length > 0,
  `a fresh acquire returns a non-empty token`);
check('CRG-14', owner1 && owner1.token === token1 && owner1.pid === process.pid
  && owner1.runId === 'crg-run-1' && owner1.port === PORT,
  `the lock file records the owner (pid/runId/port/token) the refusal message will name`);

// refuse while a live owner holds it — must not overwrite
let refuseErr = null;
try {
  mod.acquireHarnessLock(tmp, PORT, ID('crg-run-2'));
} catch (e) {
  refuseErr = e;
}
check('CRG-15', refuseErr && refuseErr.code === 'HARNESS_LOCK_HELD',
  `a second acquire while the owner is live throws HARNESS_LOCK_HELD`);
check('CRG-16', refuseErr && /another chain run already owns harness port 5599/.test(refuseErr.message),
  `the refusal names the port and the live owner -> ${String((refuseErr || {}).message || '').slice(0, 120)}`);
const ownerStillFirst = mod.readHarnessLock(mod.harnessLockPath(tmp, PORT));
check('CRG-17', ownerStillFirst && ownerStillFirst.token === token1 && ownerStillFirst.runId === 'crg-run-1',
  `the refused acquire did not overwrite the live owner's lock`);

// stale reclaim: a lock whose recorded pid is gone gets taken over
fs.writeFileSync(mod.harnessLockPath(tmp, PORT), JSON.stringify({ token: 'dead', pid: deadPid, runId: 'ghost', host: '127.0.0.1', port: PORT }), 'utf8');
let reclaimed = null;
let reclaimErr = null;
try {
  reclaimed = mod.acquireHarnessLock(tmp, PORT, ID('crg-run-3'));
} catch (e) {
  reclaimErr = e;
}
check('CRG-18', reclaimed && reclaimErr === null,
  `a stale lock (dead owner pid ${deadPid}) is reclaimed instead of blocking forever`);
const owner3 = mod.readHarnessLock(mod.harnessLockPath(tmp, PORT));
check('CRG-19', owner3 && owner3.runId === 'crg-run-3' && owner3.token === reclaimed,
  `the reclaimed lock now records the new owner`);

// release: only our own claim comes off
check('CRG-20', mod.releaseHarnessLock(tmp, PORT, 'not-the-token') === false
  && fs.existsSync(mod.harnessLockPath(tmp, PORT)),
  `release with the wrong token is refused and leaves the live lock in place`);
check('CRG-21', mod.releaseHarnessLock(tmp, PORT, null) === false
  && fs.existsSync(mod.harnessLockPath(tmp, PORT)),
  `release with a null token (we never owned it) leaves the file untouched`);
check('CRG-22', mod.releaseHarnessLock(tmp, PORT, reclaimed) === true
  && !fs.existsSync(mod.harnessLockPath(tmp, PORT)),
  `release with the correct token removes our own claim`);

// readHarnessLock is forgiving
check('CRG-23', mod.readHarnessLock(path.join(tmp, 'nope.lock')) === null,
  `reading a missing or malformed lock returns null rather than throwing`);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* temp dir best effort */ }

// ---------------------------------------------------------------- executed probe (CRG-24..26)

const PROBE_PORT = '4111';
const probeLockPath = mod.harnessLockPath(LOG_DIR, PROBE_PORT);
const runsBeforeProbe = fs.existsSync(RUNS_DIR) ? new Set(fs.readdirSync(RUNS_DIR)) : new Set();

// A real, live owner (this suite's own pid) holds the probe port's lock.
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.writeFileSync(probeLockPath, JSON.stringify({
  token: 'probe-owner', pid: process.pid, runId: 'crg-probe-owner', host: '127.0.0.1', port: Number(PROBE_PORT), startedAt: new Date().toISOString(),
}), 'utf8');

// A LOOPBACK fixture target so the runner passes its remote-store guard and reaches the lock step.
const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crg-fixture-'));
const fixtureEnv = path.join(fixtureDir, '.env');
fs.writeFileSync(fixtureEnv, 'SUPABASE_URL=http://127.0.0.1:54321\nNABIN_ENV=development\n', 'utf8');

const shellEnv = Object.assign({}, process.env);
for (const k of ['SUPABASE_URL', 'DATABASE_URL', 'NABIN_ALLOW_REMOTE_TESTS', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']) {
  delete shellEnv[k];
}
const probe = spawnSync(process.execPath, [RUNNER], {
  cwd: BACKEND,
  encoding: 'utf8',
  timeout: 30000,
  env: Object.assign({}, shellEnv, {
    NABIN_CHAIN_ENV_FILE: fixtureEnv,
    NABIN_HARNESS_PORT: PROBE_PORT,
    // Double guard, same as CTG-21..23: a ref belonging to no project makes the app's own boot gate
    // throw if the nested runner ever reaches startHarness, so a lock regression cannot write at boot.
    NABIN_ENV: 'development',
    NABIN_SUPABASE_REF: 'nabinprobe0123456789',
    NODE_ENV: 'development',
  }),
});
const probeText = `${probe.stdout || ''}${probe.stderr || ''}`;

check('CRG-24', probe.status === 1,
  `the real runner refuses a second live runner on its port (exit=${probe.status}${probe.error ? ` ${probe.error.code || ''}` : ''})`);
check('CRG-25', /already owns harness port 4111/.test(probeText) && /no harness was started/.test(probeText),
  `the refusal is the lock message and no harness was spawned -> ${probeText.split(/\r?\n/).filter((l) => /owns harness|no harness was started/.test(l))[0] || '(no line)'}`.slice(0, 220));

// The nested run must NOT have deleted the foreign lock: release is token-guarded.
const foreignLock = mod.readHarnessLock(probeLockPath);
check('CRG-26', foreignLock && foreignLock.token === 'probe-owner',
  `the nested run left the other owner's lock intact (token-guarded release did not clobber it)`);

// Clean up: remove the live lock we planted, and any run directory the refused nested run minted.
try { fs.rmSync(probeLockPath, { force: true }); } catch (e) { /* best effort */ }
try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch (e) { /* best effort on a temp dir */ }
if (fs.existsSync(RUNS_DIR)) {
  for (const name of fs.readdirSync(RUNS_DIR)) {
    if (!runsBeforeProbe.has(name) && /^chain_/.test(name)) {
      try { fs.rmSync(path.join(RUNS_DIR, name), { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  }
}

// ---------------------------------------------------------------- isolated-link refusal (CRG-27..32)
//
// The runner used to spawn an `isolated: true` link and only THEN inspect `isolationError`. When scratch
// setup failed, the suite therefore ran anyway — with the env it would not have had, i.e. the shared
// harness on :4000 and the real `public` schema — while the run labelled it an isolated link. Measured
// consequence (chain_20261013_031424_85220_132dfb, link 48 of 72): that suite's own cold-restart step
// killed the shared harness and the chain aborted with links 49..72 unexecuted. The fix gates the SPAWN on
// the verdict, so these checks pin the table and the sequencing; the sequencing is a source-shape check
// because the defect IS sequencing, and CRG-31 proves the check bites on the pre-fix ordering rather than
// passing on an empty pattern.

const iv = (link, err) => mod.isolatedLinkVerdict(link, err);

const refused = iv({ file: 'x_test.js', isolated: true }, 'isolation setup failed: PostgREST did not bind :54331');
check('CRG-27', refused.execute === false && /PostgREST did not bind/.test(refused.reason || ''),
  `an isolated link whose scratch never came up is refused, with the setup reason carried -> "${String(refused.reason || '').slice(0, 90)}…"`);

const permitted = iv({ file: 'x_test.js', isolated: true }, null);
check('CRG-28', permitted.execute === true && permitted.reason === null,
  `an isolated link with a healthy setup still executes (the refusal cannot be widened into "never run isolated links")`);

const ordinary = iv({ file: 'y_test.js' }, 'a setup error an ordinary link cannot have');
// Derived from the shipped runner, not a literal: a hard-coded total was correct when this suite was
// written and went stale the moment a link was appended, which is the same rot this file exists to stop.
const registeredLinkCount = (fs.readFileSync(RUNNER, 'utf8').match(/^\s*\{ file: /gm) || []).length;
check('CRG-29', ordinary.execute === true && registeredLinkCount > 0,
  `a non-isolated link is never gated by this - the shipped runner registers ${registeredLinkCount} links and only the ones carrying \`isolated: true\` reach this verdict`);

// The link loop's header, spelled the way the runner spells it today and the way it was spelled at
// HEAD. An offset predicate that cannot find its anchor must NOT fall back to the whole file: the whole
// file contains `function runLink(link, env) {` (line 1460) and `function isolatedLinkVerdict(link,
// isolationError) {` (line 1102), so an unanchored slice reports "verdict before spawn" from the two
// DEFINITIONS and proves nothing about the loop. Measured: that is exactly how CRG-30 went vacuous when
// the lane-runner rename (`LINKS.entries()` -> `plan.entries()`) outran the single old anchor.
const LOOP_ANCHORS = [
  'for (const [position, entry] of plan.entries())',
  'for (const [index, link] of LINKS.entries())',
];

function linkLoop(text) {
  for (const anchor of LOOP_ANCHORS) {
    const at = text.indexOf(anchor);
    if (at !== -1) return { loop: text.slice(at), anchor, at };
  }
  return { loop: '', anchor: null, at: -1 };
}

function isolationCheckedBeforeSpawn(text) {
  const { loop, anchor } = linkLoop(text);
  const spawn = loop.indexOf('runLink(link, env)');
  const verdict = loop.indexOf('isolatedLinkVerdict(link, isolationError)');
  const gated = loop.indexOf('permit.execute ? runLink(link, env) : refusedLink(');
  // Offsets are relative to `loop`, so any evidence printed from them must be sliced out of `loop` too.
  return { loop, anchor, spawn, verdict, gated,
    ok: anchor !== null && spawn !== -1 && verdict !== -1 && verdict < spawn };
}

const runnerSrc = fs.readFileSync(RUNNER, 'utf8');
const seq = isolationCheckedBeforeSpawn(runnerSrc);
check('CRG-30', seq.ok,
  `the link loop (${seq.anchor ? `"${seq.anchor}"` : 'NO ANCHOR FOUND - the predicate is refusing, not proving'}) `
  + `consults isolatedLinkVerdict (offset ${seq.verdict}) BEFORE it spawns the link (offset ${seq.spawn})`);
check('CRG-31', seq.gated !== -1,
  `the spawn itself is gated on the verdict, not annotated after it -> "${seq.loop.slice(seq.gated, seq.gated + 78).split(/\r?\n/)[0]}"`);

// The pre-fix ordering, verbatim from the code this cycle replaced, must fail the same predicate.
const PREFIX_FIXTURE = [
  '    for (const [index, link] of LINKS.entries()) {',
  '      process.stdout.write(`[${index + 1}/${LINKS.length}] ${link.file} ... `);',
  '      const result = runLink(link, env);',
  '      if (isolationError) {',
  '        result.exit = result.exit || 1;',
  '        result.failLines = result.failLines.concat([`ISOLATION UNAVAILABLE: ${isolationError}`]);',
  "        scratchCli('teardown');",
  '        releasePrivatePort(isolationPort);',
  '      } else if (link.isolated) {',
].join('\n');
const prefixSeq = isolationCheckedBeforeSpawn(PREFIX_FIXTURE);
check('CRG-32', prefixSeq.ok === false && prefixSeq.spawn !== -1 && prefixSeq.verdict === -1,
  `the pre-fix source (spawn at ${prefixSeq.spawn}, no verdict consulted) is rejected by the same predicate — CRG-30 is not vacuous`);

// ------------------------------------------- the refusal must be READABLE (CRG-33..40)
//
// The probe that proved CRG-27/30/31 end-to-end (a full chain with DOCKER_HOST poisoned, so every
// `chain_scratch` step fails) came back with the right structure and the wrong sentence. What an operator
// was actually handed, from `.chain-logs/runs/chain_20261013_051226_55428_5fd073/test_phase5_payments.log`:
//
//   ISOLATION UNAVAILABLE - LINK NOT EXECUTED: isolation setup failed: 0, 116,  97, 105, 110,  101,
//   TEARDOWN FAILED: ''
//
// A guard that refuses four links and says nothing about why is a guard nobody can act on. The cause is in
// `chain_scratch.js`'s output — it dies by throwing out of `sh()`, so Node prints the step header on stdout
// and the `Error:` sentence on stderr, then a stack and the error object's JSON, whose `stderr` buffer
// serialises as an array of numbers. The old expression took `String(stderr || stdout)` (so stdout, with the
// step header, was discarded whenever stderr was non-empty) and then `.slice(-300)` — the tail of that array.
// `isolationFailureSummary` picks the lines that carry the cause; these checks pin it on the real captured
// shape, and CRG-40 pins that the runner actually calls it.

// Verbatim-shaped crash output: stdout step header, stderr exception print, buffer dump tail.
const CRASH_FIXTURE = [
  '[1/4] dumping public schema (schema-only)…',
  'node:child_process:1018',
  '    throw err;',
  '    ^',
  'Error: Command failed: docker exec supabase_db_nabin pg_dump -U postgres -d postgres --schema-only -n public',
  'error during connect: Get "http://127.0.0.1:1/v1.56/containers/supabase_db_nabin/json":'
    + ' dial tcp 127.0.0.1:1: connectex: No connection could be made because the target machine actively refused it.',
  '    at genericNodeError (node:internal/errors:999:15)',
  '    at sh (C:\\Users\\macmi\\Documents\\nabin\\backend\\scripts\\chain_scratch.js:46:10)',
  '  status: 1,',
  '  stderr: [',
  '    116,  97, 105, 110,  101,',
  '    ... 97 more items',
  '  ]',
  '}',
].join('\n');

const summary = mod.isolationFailureSummary(CRASH_FIXTURE);

check('CRG-33', /^\[1\/4\] dumping public schema/.test(summary),
  'the summary names the scratch STEP that died, which lives on stdout — the pre-fix "stderr || stdout" threw it away'
  + ` -> "${summary.slice(0, 60)}"`);
check('CRG-34', /pg_dump/.test(summary) && /docker exec supabase_db_nabin/.test(summary),
  'the summary names the failing command, so the operator knows what to fix');
check('CRG-35', /error during connect/.test(summary) && /actively refused/.test(summary),
  'the summary carries the cause line under the Error: header, not just the header');
check('CRG-36', !/more items/.test(summary) && !/^[\s\d,.]+$/.test(summary) && !/^\d+,\s*\d+,$/.test(summary),
  `no byte-dump residue is reported as the reason -> "${summary.slice(-70)}"`);
check('CRG-37', ['', '   \n \n ', null, undefined].every((v) => mod.isolationFailureSummary(v) === 'no output'),
  'an empty step cannot produce the blank reason the measured TEARDOWN FAILED: "" showed');

const allNoise = mod.isolationFailureSummary('    at foo (x.js:1:1)\n    116,  97, 105,\n}');
check('CRG-38', allNoise !== '}' && !/^[\s\d,.[\]{}]+$/.test(allNoise),
  `output that is only stack frames and buffers reports a fixed phrase, not a stray brace -> "${allNoise}"`);

const capped = mod.isolationFailureSummary(`Error: Command failed: ${'z'.repeat(5000)}`);
check('CRG-39', capped.length <= 400 && /\.\.\.$/.test(capped),
  `a one-line cause cannot flood the verdict line (${capped.length} chars, ellipsis-terminated)`);

// Comment-stripped view: this cycle's own doc comment quotes the `.slice(-300)` it replaced, and a
// wiring check must judge the code, not the prose that describes the old code.
const runnerCode = runnerSrc.split(/\r?\n/).filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
const wiredCount = (runnerCode.match(/isolationFailureSummary\(/g) || []).length;
check('CRG-40', wiredCount >= 4
  && !/String\((?:td|snap)\.stderr \|\| (?:td|snap)\.stdout/.test(runnerCode)
  && !/\.slice\(-(?:300|240)\)/.test(runnerCode),
  `the runner calls the summariser at every scratch-failure site (found ${wiredCount}, incl. its definition) and keeps no tail-slice of a step's output`);

// ---------------------------------------------------------------- subset filter (CRG-41..49)
//
// `--only` is the difference between a two-minute re-verification of one link and an hour-long chain,
// which is what makes it worth offering — and what makes an accidentally-broad filter dangerous. These
// checks run the REAL exported selector against the REAL registration table, not a stand-in list, so a
// link renamed in LINKS cannot silently drop out of the guard.

// The subset filter is tested against the runner's own registration table, exported for exactly this
// reason: a hand-copied list in this guard would keep passing after a link was renamed or removed.
const LINKS = mod.LINKS;
const TABLE_FROM_SRC = (runnerSrc.match(/^\s*\{ file: '/gm) || []).length;
const LINK_COUNT = Array.isArray(LINKS) ? LINKS.length : 0;

check('CRG-40b', LINK_COUNT > 0 && LINK_COUNT === TABLE_FROM_SRC,
  `the runner exports its registration table and it matches the source's link entries (${LINK_COUNT} vs ${TABLE_FROM_SRC})`);

const emptyTok = mod.parseOnlyTokens('');
check('CRG-41', Array.isArray(emptyTok) && emptyTok.length === 0 && mod.parseOnlyTokens(' a , b ').join(',') === 'a,b',
  `an empty --only= yields no tokens, and whitespace around real ones is stripped ("${emptyTok.join(',')}")`);

const badName = mod.selectLinks(LINKS, ['no_such_suite.js']);
check('CRG-42', badName.picked.length === 0 && badName.unknown.join() === 'no_such_suite.js',
  `a token naming no link is reported as unknown and selects nothing (never "0 links, exit 0, looked green")`);

const outOfRange = mod.selectLinks(LINKS, [String(LINK_COUNT + 1)]);
check('CRG-43', outOfRange.picked.length === 0 && outOfRange.unknown.join() === String(LINK_COUNT + 1),
  `a link number past the end of the ${LINK_COUNT}-link table refuses instead of wrapping or clamping`);

const withExt = mod.selectLinks(LINKS, ['test_phase4_orders.js']);
const noExt = mod.selectLinks(LINKS, ['test_phase4_orders']);
check('CRG-44', withExt.picked.length === 1 && noExt.picked.length === 1
  && withExt.picked[0].link === noExt.picked[0].link && withExt.unknown.length === 0,
  `basename with and without .js select the same single link (${withExt.picked[0].index} vs ${noExt.picked[0].index})`);

const byNumber = mod.selectLinks(LINKS, ['54']);
const byName = mod.selectLinks(LINKS, ['place_substitution_test.js']);
check('CRG-45', byNumber.picked.length === 1 && byName.picked.length === 1
  && byNumber.picked[0].link === byName.picked[0].link && byNumber.picked[0].index === 54,
  `the 1-based number printed in chain output resolves to the same link as its name, keeping its index (54 -> ${byNumber.picked[0].link.file})`);

const registered = mod.selectLinks(LINKS, ['test_phase4_orders.js']);
check('CRG-46', registered.picked[0].link.isolated === true && registered.picked[0].link.file === 'test_phase4_orders.js',
  `a selected link carries its registration options, so a subset run isolates exactly the way a full run does`);

const dupes = mod.selectLinks(LINKS, ['1', 'test_suite.js', '1']);
check('CRG-47', dupes.picked.length === 1 && dupes.unknown.length === 0,
  `the same link named three different ways runs once, not three times (${dupes.picked.length} selected)`);

const multi = mod.selectLinks(LINKS, ['3', 'boot_mirror_read_test.js', '54']);
check('CRG-48', multi.picked.length === 2 && multi.picked.map((p) => p.index).join(',') === '3,54'
  && multi.unknown.length === 0,
  `a mixed selection resolves to 2 distinct links and reports nothing unknown (selected: ${multi.picked.map((p) => p.index).join(',')})`);

const unknownMixed = mod.selectLinks(LINKS, ['3', 'typo.js']);
check('CRG-49', unknownMixed.unknown.join() === 'typo.js' && unknownMixed.picked.length === 1,
  `a partly-valid selection still names the bad token, so the runner refuses the whole request rather than silently dropping half a filter`);

// Wiring: the filter must be resolved before the run directory exists and before the harness port is
// claimed, and a subset must never be printed as though it were the chain.
const mainSrc = runnerSrc.slice(runnerSrc.indexOf('if (require.main === module)'));
const codeMain = mainSrc.split(/\r?\n/).filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
const atSelect = codeMain.indexOf('selectLinks(');
const atCreateRun = codeMain.indexOf('createRunDir()');
check('CRG-50', atSelect !== -1 && atCreateRun !== -1 && atSelect < atCreateRun,
  `the selection is validated before the run directory is created (offsets ${atSelect} < ${atCreateRun}) so a refusal leaves no empty run behind`);
check('CRG-51', /SUBSET RUN:/.test(codeMain) && /=== CHAIN RESULT:[\s\S]{0,320}SUBSET RUN/.test(codeMain),
  'a subset announces itself both above the per-link output and inside the CHAIN RESULT marker a script would grep');
check('CRG-52', /writeRunEvidence\(\{[\s\S]{0,400}subset/.test(codeMain)
  && /subset: subset \|\| null/.test(runnerCode),
  'the subset marker reaches metadata.json, not just the console (a later reader diffs runs by that file)');

const catalog = mod.linkCatalog([{ file: 'a_test.js' }, { file: 'b_test.js', isolated: true },
  { file: 'c_test.js', laneServer: true, privatePort: true }]);
check('CRG-53', catalog.length === 3 && !/\[/.test(catalog[0]) && /\[isolated lane\]/.test(catalog[1])
  && /\[lane backend\]/.test(catalog[2]) && /\[private port\]/.test(catalog[2]) && /^\s*1\. a_test\.js/.test(catalog[0]),
  `--list annotates the options that change how a link runs, so a subset is chosen with that visible (${catalog[2].trim()})`);

// ------------------------------------------------- explicit-target resolution (CRG-54..60)
//
// The lane a `laneServer`/`isolated` link gets is only real if the suite's OWN database handle
// resolves to the same target the runner handed it. A helper that reads a different variable than
// the harness sets verifies one schema while writing another — the #283 split, one level down.

const fixtures = require(path.join(BACKEND, 'test_fixtures.js'));
const saved = { DATABASE_URL: process.env.DATABASE_URL, NABIN_PG_NOTIFY: process.env.NABIN_PG_NOTIFY };

// F-C1-1 made the handle resolve through `scripts/chain_target_guard.js`, which reads the same env file
// the children load. So these checks must control THAT file as well as the shell: a real
// `backend/.env` carrying a live `DATABASE_URL` would otherwise decide the answer before the shell
// does, and the precedence being pinned here would no longer be the precedence being measured.
// The fixture declares no PostgreSQL target at all — which is also what makes the "absent target"
// case executable rather than described. (`fixtureDir` above is already torn down at line ~222, so
// these files need their own directory.)
const targetFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crg-target-'));
const NULL_TARGET_ENV = path.join(targetFixtureDir, 'null_target.env');
fs.writeFileSync(NULL_TARGET_ENV, '# no PostgreSQL target is declared in this file (CRG fixture)\n', 'utf8');
const FILE_TARGET_ENV = path.join(targetFixtureDir, 'file_target.env');
fs.writeFileSync(FILE_TARGET_ENV, 'DATABASE_URL=postgresql://postgres:pw@127.0.0.1:54324/postgres\n', 'utf8');

const withEnv = (db, notify, fn, envFile = NULL_TARGET_ENV) => {
  const savedEnvFile = process.env.NABIN_CHAIN_ENV_FILE;
  if (db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = db;
  if (notify === undefined) delete process.env.NABIN_PG_NOTIFY; else process.env.NABIN_PG_NOTIFY = notify;
  process.env.NABIN_CHAIN_ENV_FILE = envFile;
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (savedEnvFile === undefined) delete process.env.NABIN_CHAIN_ENV_FILE;
    else process.env.NABIN_CHAIN_ENV_FILE = savedEnvFile;
  }
};

const prec1 = withEnv('postgresql://postgres:pw@127.0.0.1:54322/postgres',
  'postgresql://postgres:pw@127.0.0.1:54323/postgres', () => fixtures.resolveTarget());
check('CRG-54', prec1.source === 'DATABASE_URL' && /:54322/.test(prec1.connectionString),
  `the fixture handle follows DATABASE_URL ahead of NABIN_PG_NOTIFY (source=${prec1.source}, port ${prec1.connectionString.match(/:(\d+)/)[1]})`);

const prec2 = withEnv(undefined, 'postgresql://postgres:pw@127.0.0.1:54323/postgres', () => fixtures.resolveTarget());
const prec4 = withEnv('postgresql://x:y@127.0.0.1:1/z', undefined,
  () => fixtures.resolveTarget({ connectionString: 'postgresql://postgres:pw@127.0.0.1:54399/postgres' }));
check('CRG-55', prec2.source === 'NABIN_PG_NOTIFY' && prec4.source === 'options',
  `precedence is options > DATABASE_URL > NABIN_PG_NOTIFY > the env file the children load `
  + `(${prec4.source} > DATABASE_URL > ${prec2.source}); there is no fourth source that invents an address`);

// F-C1-1: the file is a real source (so a suite booted the way `package.json` boots the chain still
// resolves), and the shell still wins over it — the dotenv rule `remoteStoreWarning` documents.
const fromFile = withEnv(undefined, undefined, () => fixtures.resolveTarget(), FILE_TARGET_ENV);
check('CRG-106', fromFile.source === 'DATABASE_URL' && /:54324/.test(fromFile.connectionString)
    && fromFile.declaredIn.includes(FILE_TARGET_ENV),
  `with the shell silent, the handle resolves DATABASE_URL from the declared env file `
  + `(port ${fromFile.connectionString.match(/:(\d+)/)[1]}, named from ${fromFile.declaredIn.replace(/^.*[\\/]/, '')})`);
const shellBeatsFile = withEnv('postgresql://postgres:pw@127.0.0.1:54322/postgres', undefined,
  () => fixtures.resolveTarget(), FILE_TARGET_ENV);
check('CRG-107', /:54322/.test(shellBeatsFile.connectionString),
  `a shell DATABASE_URL overrides the env-file declaration (port ${shellBeatsFile.connectionString.match(/:(\d+)/)[1]}, not the file's 54324), `
  + 'so the handle and the children resolve the same store');

// A clone lane carries its schema in the URL; the handle must keep it, not re-derive `public`.
const laneUrl = withEnv('postgresql://postgres:pw@127.0.0.1:54322/postgres?options=-c%20search_path%3Dchain_scratch',
  undefined, () => fixtures.resolveTarget());
check('CRG-56', /search_path%3Dchain_scratch/.test(laneUrl.connectionString),
  'a lane DATABASE_URL keeps its search_path option, so fixtures and the lane write one schema');

// Fail closed, and say which variable was wrong. Neither case may reach a socket.
// `openFixtures` is async, so a sync try/catch would miss the rejection entirely and Node would
// raise an unhandled rejection instead of the refusal this guard exists to prove. Everything before
// its first `await` - resolve, parse, loopback check - runs synchronously on call, so the promise is
// already rejected when it is returned and the env restore inside withEnv() still happens in order.
(async () => {
  const rejection = async (fn) => {
    try { await fn(); return '<no throw: the handle tried to connect>'; }
    catch (e) { return e.message; }
  };

  const hostedErr = await rejection(() => withEnv('postgres://postgres:pw@db.example.com:5432/postgres',
    undefined, () => fixtures.openFixtures('guard')));
  check('CRG-57', /REFUSED/.test(hostedErr) && /non-loopback/.test(hostedErr) && /DATABASE_URL/.test(hostedErr),
    `a hosted DATABASE_URL is refused by name, not silently replaced by the loopback default -> "${hostedErr.slice(0, 78)}"`);

  const unparsableErr = await rejection(() => withEnv('not a url', undefined,
    () => fixtures.openFixtures('guard')));
  check('CRG-58', /REFUSED/.test(unparsableErr) && /not a parsable/.test(unparsableErr),
    `an unparsable target is a refusal rather than a fallback to the shipped DSN -> "${unparsableErr.slice(0, 72)}"`);

  // ---------------------------------------- F-C1-1: no target declared is a refusal, everywhere
  //
  // The two places that used to invent an address: `test_fixtures.js` fell back to a hardcoded
  // loopback DSN (`postgres://<user>:<password>@127.0.0.1:54322/postgres`), and `scripts/test_store_census.js`
  // defaulted its connection string to the same DSN. Measured 2026-10-16, a bare census run exited 0
  // having counted 74 `public` lines from that hardcoded store — so the before/after residue evidence
  // a chain run publishes could describe a database no configuration named, and the fixture handle
  // could create and delete rows in one store while the application it fed used another (#283, one
  // level down). Both now refuse, and the refusals are proven by running the real CLI.
  const absentErr = await rejection(() => withEnv(undefined, undefined, () => fixtures.openFixtures('guard')));
  check('CRG-108', /REFUSED/.test(absentErr) && /no PostgreSQL target is declared/.test(absentErr)
    && /DATABASE_URL \/ NABIN_PG_NOTIFY/.test(absentErr) && /with_local_target\.js/.test(absentErr)
    && !/54322/.test(absentErr),
    `with nothing declared in the shell or the env file, openFixtures() refuses naming both keys, the file `
    + `and the wrapper instead of reaching the old loopback DSN -> "${absentErr.slice(0, 96)}"`);

  const prodRefLoopback = await rejection(() => withEnv(
    'postgresql://postgres:pw@127.0.0.1:54322/postgres.ouxvqmhuyueklnegvmxe', undefined,
    () => fixtures.openFixtures('guard')));
  check('CRG-109', /REFUSED/.test(prodRefLoopback) && /production project ref/.test(prodRefLoopback),
    `a LOOPBACK host carrying the production project ref is still refused (a proxy would otherwise pass `
    + `the host test) -> "${prodRefLoopback.slice(0, 92)}"`);

  const CENSUS = path.join(BACKEND, 'scripts', 'test_store_census.js');
  const runCensus = (dbUrl) => {
    const env = Object.assign({}, shellEnv, { NODE_ENV: 'development', NABIN_CHAIN_ENV_FILE: NULL_TARGET_ENV });
    delete env.DATABASE_URL; delete env.NABIN_PG_NOTIFY;
    if (dbUrl !== undefined) env.DATABASE_URL = dbUrl;
    return spawnSync(process.execPath, [CENSUS, 'count', 'public'], { cwd: BACKEND, encoding: 'utf8', timeout: 60000, env });
  };
  const censusBare = runCensus(undefined);
  const censusBareText = `${censusBare.stderr || ''}${censusBare.stdout || ''}`;
  check('CRG-110', censusBare.status === 1
    && /census REFUSED: no PostgreSQL target is declared/.test(censusBareText)
    && /^public\./m.test(censusBare.stdout || '') === false,
    `the real census CLI with no declared target exits ${censusBare.status} with a refusal and prints no `
    + `count line at all (stdout held ${(censusBare.stdout || '').split(/\r?\n/).filter((l) => /^public\./.test(l)).length} `
    + `public lines; it used to print 74 from a DSN baked into the file)`);

  const censusMalformed = runCensus('not a url');
  const censusMalformedText = `${censusMalformed.stderr || ''}${censusMalformed.stdout || ''}`;
  check('CRG-111', censusMalformed.status === 1 && /not a parsable PostgreSQL URL/.test(censusMalformedText)
    && /DATABASE_URL/.test(censusMalformedText) && !/not a url/.test(censusMalformedText),
    `a malformed DATABASE_URL reddens the census at exit ${censusMalformed.status} naming the key, and the `
    + 'refusal does not echo the value (a connection string can carry a password)');

  // ------------------------- F-C1-1 one level down: a SUITE may not hand the handle a fallback DSN
  //
  // `test_fixtures.js` refusing to invent a target is only half the guarantee. The merchant suite used
  // to compute its own store as `process.env.NABIN_PG_NOTIFY || 'postgres://<user>:<password>@`
  // `127.0.0.1:54322/postgres'` and pass it to `openFixtures('mch', { connectionString: PG })` — and an
  // explicit option outranks the handle's own guard, so the merchants, dishes, shelf rows and orders
  // that suite mints and deletes went into a store no configuration named even after the helper
  // learned to refuse. These checks are socket-level, not textual: the `--require` canary below
  // replaces `net.Socket.prototype.connect` with a recorder that refuses every attempt, so "no implicit
  // connection" is measured as zero connect attempts instead of asserted from the shape of a line.
  // Nothing here can reach a database: every target is either refused at load or a loopback port
  // nothing listens on, which the canary refuses anyway.
  const mchSuite = path.join(BACKEND, 'merchant_operations_test.js');
  const mchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crg-mch-target-'));
  const mchCanary = path.join(mchDir, 'connect_canary.js');
  fs.writeFileSync(mchCanary, [
    '// Written by CRG-128: record every TCP connect a child attempts and refuse it.',
    'const net = require("net");',
    'const fs = require("fs");',
    'const OUT = process.env.NABIN_CONNECT_CANARY;',
    'const attempts = [];',
    'function flush() { try { fs.writeFileSync(OUT, JSON.stringify(attempts)); } catch (e) { /* refusal is the point */ } }',
    'net.Socket.prototype.connect = function (...args) {',
    '  const first = args[0];',
    '  const opts = first && typeof first === "object" ? first : {};',
    '  const host = opts.host !== undefined ? opts.host : (typeof args[1] === "string" ? args[1] : "");',
    '  const port = opts.port !== undefined ? opts.port : (typeof first === "number" ? first : "");',
    '  attempts.push(String(host) + ":" + String(port));',
    '  flush();',
    '  const self = this;',
    '  const err = new Error("connect refused by the CRG-128 canary (this check counts sockets, it does not use one)");',
    '  err.code = "ECONNREFUSED_CANARY";',
    '  process.nextTick(() => self.emit("error", err));',
    '  return self;',
    '};',
    'flush();',
    '',
  ].join('\n'), 'utf8');
  const mchProbe = path.join(mchDir, 'resolve_probe.js');
  fs.writeFileSync(mchProbe, [
    '// Require the suite, never run it: the store is decided by top-level code, so a successful',
    '// require proves the guard accepted the declaration and a thrown refusal proves it did not.',
    'const suite = require(process.env.NABIN_MCH_SUITE);',
    'const t = suite.PG_TARGET;',
    'if (!t) { console.log("PROBE: the suite exports no PG_TARGET"); process.exit(4); }',
    'console.log(JSON.stringify({ source: t.source, host: t.host, port: t.port, database: t.database, keys: Object.keys(t) }));',
    '',
  ].join('\n'), 'utf8');

  let mchRun = 0;
  const runMch = (target, extraEnv) => {
    const attemptFile = path.join(mchDir, `attempts_${mchRun++}.json`);
    const env = Object.assign({}, shellEnv, {
      NODE_ENV: 'development',
      NABIN_CHAIN_ENV_FILE: NULL_TARGET_ENV,
      NABIN_CONNECT_CANARY: attemptFile,
      NABIN_MCH_SUITE: mchSuite,
    });
    delete env.DATABASE_URL; delete env.NABIN_PG_NOTIFY; delete env.NABIN_ALLOW_REMOTE_TESTS;
    Object.assign(env, extraEnv || {});
    const r = spawnSync(process.execPath, ['--require', mchCanary, target],
      { cwd: BACKEND, encoding: 'utf8', timeout: 60000, env });
    let attempts = null;
    try { attempts = JSON.parse(fs.readFileSync(attemptFile, 'utf8')); } catch (e) { attempts = null; }
    return { status: r.status, text: `${r.stdout || ''}${r.stderr || ''}`, attempts };
  };
  const socketCount = (run) => (Array.isArray(run.attempts) ? run.attempts.length : 'unreadable canary');
  const MCH_PW = 'crg-mch-canary-pw';
  const parseProbe = (text) => {
    try { return JSON.parse((text.match(/^\{.*\}$/m) || [''])[0]); } catch (e) { return null; }
  };

  const mchBare = runMch(mchSuite, {});
  check('CRG-128', mchBare.status === 1
    && /merchant_operations_test REFUSED: no PostgreSQL target is declared/.test(mchBare.text)
    && /DATABASE_URL \/ NABIN_PG_NOTIFY/.test(mchBare.text) && /with_local_target\.js/.test(mchBare.text)
    && Array.isArray(mchBare.attempts) && mchBare.attempts.length === 0
    && !/MERCHANT SECURITY:/.test(mchBare.text) && !/54322/.test(mchBare.text),
    `the real suite CLI with nothing declared exits ${mchBare.status} naming both keys and the wrapper, `
    + `opened ${socketCount(mchBare)} socket(s), printed no "MERCHANT SECURITY:" verdict line and no `
    + 'loopback fallback address — the DSN it used to hand the fixture handle outranked that handle\'s own guard');

  const mchGarbage = runMch(mchSuite, { DATABASE_URL: 'total garbage' });
  check('CRG-129', mchGarbage.status === 1 && /not a parsable PostgreSQL URL/.test(mchGarbage.text)
    && /DATABASE_URL/.test(mchGarbage.text) && !/total garbage/.test(mchGarbage.text)
    && (mchGarbage.attempts || []).length === 0,
    `an unparseable DATABASE_URL reddens the suite at exit ${mchGarbage.status}, naming the key without `
    + `echoing the value, after ${socketCount(mchGarbage)} socket(s) — a bad declaration is a refusal, not a fallback`);

  const mchHosted = runMch(mchSuite, { DATABASE_URL: `postgresql://postgres:${MCH_PW}@db.nabinhosted.example:5432/postgres` });
  check('CRG-130', mchHosted.status === 1 && /REFUSED/.test(mchHosted.text) && /is not loopback/.test(mchHosted.text)
    && (mchHosted.attempts || []).length === 0 && !mchHosted.text.includes(MCH_PW),
    `a hosted DATABASE_URL stops the suite at load with ${socketCount(mchHosted)} connection attempt(s) `
    + 'rather than minting fixture rows in it, and the refusal names the host but never the password');

  const mchProdRef = runMch(mchSuite, { DATABASE_URL: `postgresql://postgres:${MCH_PW}@127.0.0.1:54399/db.ouxvqmhuyueklnegvmxe` });
  check('CRG-131', mchProdRef.status === 1 && /production project ref/.test(mchProdRef.text)
    && (mchProdRef.attempts || []).length === 0 && !mchProdRef.text.includes(MCH_PW),
    `a LOOPBACK host carrying the production project ref is refused too (${socketCount(mchProdRef)} attempt(s)) `
    + '— a local proxy in front of production would otherwise pass the host test');

  const mchResolve = runMch(mchProbe, {
    DATABASE_URL: `postgresql://postgres:${MCH_PW}@127.0.0.1:54327/postgres`,
    NABIN_PG_NOTIFY: `postgresql://postgres:${MCH_PW}@127.0.0.1:54329/notifydb`,
  });
  const mchTarget = parseProbe(mchResolve.text);
  check('CRG-132', mchResolve.status === 0 && !!mchTarget && mchTarget.host === '127.0.0.1'
    && mchTarget.port === '54327' && mchTarget.source === 'shell DATABASE_URL'
    && (mchResolve.attempts || []).length === 0,
    `requiring the suite resolves its store to 127.0.0.1:${mchTarget ? mchTarget.port : '?'}`
    + ` from ${mchTarget ? mchTarget.source : '?'}, ahead of the NABIN_PG_NOTIFY store it used to read `
    + `first, and the require itself opened ${socketCount(mchResolve)} socket(s)`);

  check('CRG-133', !!mchTarget && (mchTarget.keys || []).join(',') === 'source,host,port,database'
    && !JSON.stringify(mchTarget).includes(MCH_PW) && !/postgres(?:ql)?:\/\//.test(mchResolve.text),
    `the exported target is ${mchTarget ? (mchTarget.keys || []).join('/') : 'nothing'} — it names the store `
    + 'a suite will write without carrying the connection string, so a guard can read a target without holding its password');

  const mchFile = runMch(mchProbe, { NABIN_CHAIN_ENV_FILE: FILE_TARGET_ENV });
  const mchFileTarget = parseProbe(mchFile.text);
  check('CRG-134', mchFile.status === 0 && !!mchFileTarget && mchFileTarget.port === '54324'
    && /file_target\.env/.test(mchFileTarget.source || '') && (mchFile.attempts || []).length === 0,
    `with the shell silent the suite takes its store from the declared env file (port `
    + `${mchFileTarget ? mchFileTarget.port : '?'}, ${mchFileTarget ? mchFileTarget.source : '?'}) and opens `
    + `${socketCount(mchFile)} socket(s), so a suite booted the way package.json boots the chain still resolves a real target`);

  // A DSN is a fallback because of the SYNTAX around it — it is the right-hand side of a default or an
  // assignment — not because of the characters inside it. The bare substring used to say "this file holds
  // a 54322 address" also matched link 57's COR-50/COR-51 decoys, which are fabricated secrets whose whole
  // job is to be caught and redacted in an error body (customer_order_read_reliability_test.js:694, :747).
  // Editing those literals to duck the scan would have gutted the positive controls, so the criterion
  // moved to the hazard shape instead. CRG-138 proves the narrowed test still catches a typed-back
  // fallback, and CRG-137 remains the executed proof: every suite here exits 1 with 0 socket(s) when
  // nothing declares a target, so a real fallback in any of them would connect and be caught anyway.
  const FALLBACK_DSN = /(?:\|\||[=:])\s*['"`]postgres(?:ql)?:\/\/[^'"]*54322/;

  // The executed proofs above cover the four refusal paths and the resolution order. This one keeps the
  // fallback from being typed back in — and reads CODE lines only, because the comment at
  // merchant_operations_test.js:44 quotes the removed DSN to explain why it is gone.
  const mchCode = fs.readFileSync(mchSuite, 'utf8').split(/\r?\n/)
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('CRG-135', /require\('\.\/scripts\/chain_target_guard'\)/.test(mchCode)
    && /requireLoopbackPgTarget\(\{ label: 'merchant_operations_test' \}\)/.test(mchCode)
    && !/NABIN_PG_NOTIFY\s*\|\|/.test(mchCode)
    && !FALLBACK_DSN.test(mchCode),
    'merchant_operations_test.js resolves its store through the shared guard and its code holds no '
    + 'fallback DSN, so the refusals executed above are proofs about the file that actually loads');

  // CRG-128..135 prove ONE file. The same fallback DSN was live in more suites that write fixture rows
  // through a direct `pg` handle, and a pin naming one file leaves the rest free to have the address
  // typed back in — so both the line check and the executed refusal walk the whole converted set.
  // Measured, not remembered: the set below is every suite IN THE PROPOSED C2 UNIT that had a fallback DSN
  // and was converted to guard resolution. The scan that sized it walks the worktree rather than `git grep`
  // (which cannot see the untracked new suites) and counts 45 executable fallback sites in `backend/` total.
  // 13 of them are on registered links this unit does NOT change — links 25-32, 35, 37, 40, 48, 52 — so they
  // are reported to the owner rather than pinned here: a check that fails on files outside the commit cannot
  // be made green by this change. Only link 48 of the 13 is `isolated`, and its run reports
  // `DRIFT public: CLEAN`, so the runner's declared `DATABASE_URL` outranks its `||` default and the #283
  // write/assert split does not occur in a chain run.
  const EXPLICIT_TARGET_SUITES = [
    'admin_authorization_test.js', 'cash_ride_audit_test.js', 'customer_order_read_reliability_test.js',
    'dark_store_foundation_test.js', 'dark_store_routes_rls_test.js', 'financial_authority_test.js',
    'finance_driver_settlements_authority_test.js', 'finance_ledger_double_entry_authority_test.js',
    'finance_refund_amount_authority_test.js', 'food_discovery_ordering_contract_test.js',
    'ledger_double_entry_reconciliation_test.js', 'merchant_auth_failclosed_test.js',
    'merchant_order_read_reliability_test.js', 'merchant_tenant_isolation_test.js',
    'notification_write_guard_test.js', 'place_substitution_test.js', 'support_ticket_write_guard_test.js',
    'test_phase4_orders.js', 'test_phase7_security.js',
    'test_rms_postgres_durability.js', 'test_rms_upi_billing_sales_complete.js',
  ];
  const unguarded = EXPLICIT_TARGET_SUITES.filter((f) => {
    const code = fs.readFileSync(path.join(BACKEND, f), 'utf8').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    const stem = f.replace(/\.js$/, '');
    // Both call shapes count: the single-line `{ label: 'stem' }` and the two RMS suites, which carry
    // their documented `LOCAL_POSTGRES_URL` operator override as a validated KEY instead of an address,
    // so they pass `keys:` and the label lands on its own line.
    const guardCall = new RegExp(`requireLoopbackPgTarget\\(\\s*\\{\\s*label:\\s*'${stem}'\\s*[,}]`);
    return !/require\('\.\/scripts\/chain_target_guard'\)/.test(code)
      || !guardCall.test(code)
      || /NABIN_PG_NOTIFY\s*\|\|/.test(code)
      || /LOCAL_POSTGRES_URL\s*\|\|/.test(code)
      || FALLBACK_DSN.test(code);
  });
  check('CRG-136', unguarded.length === 0,
    `${EXPLICIT_TARGET_SUITES.length} suites that hold their own pg handle resolve their store through the `
    + `shared guard and hold no fallback DSN in code (deficient: ${unguarded.join(', ') || 'none'}) — the `
    + 'refusal proven above for one suite is the rule for every suite that writes fixture rows');

  // CRG-138 — the non-vacuity proof for the narrowed criterion, and the record of what the narrowing cost.
  // It holds nothing but shapes, each one line of suite source as the scanner reads it: the two forms that
  // actually make a DSN load-bearing (a `||` default on an env read, a `connectionString:` property) must
  // match; the three decoy forms, which carry the IDENTICAL `postgres://…@127.0.0.1:54322/postgres`
  // characters but only as prose inside a string, must not. Delete the `||` arm and case 1 stops matching;
  // loosen the quote requirement and all three decoys fire again — so this check cannot be satisfied by a
  // regex too loose to discriminate or too tight to catch the hazard.
  //
  // What was measured, not assumed, when the criterion changed: across `backend/*.js` code lines the old
  // substring matched 66 sites and this one matches 57. Every site it stopped matching is either a decoy
  // payload in link 57 (3) or a positional `new Client('<dsn>')` in a scratch_* throwaway (5) — none is in
  // EXPLICIT_TARGET_SUITES, and all 5 `NABIN_PG_NOTIFY || '<dsn>'` fallbacks the check exists to catch still
  // match. The residual blind spot is stated rather than hidden: a DSN passed as a bare positional argument
  // is not flagged here. That shape cannot be a FALLBACK (it has no default operator), so CRG-137 remains
  // the guard against it — a suite holding one connects when nothing declares a target, and the executed
  // 0-socket refusal fails.
  const DSN = 'postgres://supabase:secret@127.0.0.1:54322/postgres';
  const HAZARD_SHAPES = [
    `const DB_URL = process.env.DATABASE_URL || '${DSN}';`,
    `pool = createPool({ connectionString: '${DSN}' });`,
  ];
  const DECOY_SHAPES = [
    `const PROSE_ID = 'password=${DSN} at Object.<anonymous> stack';`,
    `{ error: 'could not connect with password=${DSN}' }`,
    `const SECRET_MARKERS = ['password', '${DSN}', 'service_role'];`,
  ];
  const missed = HAZARD_SHAPES.filter((s) => !FALLBACK_DSN.test(s));
  const falsePos = DECOY_SHAPES.filter((s) => FALLBACK_DSN.test(s));
  check('CRG-138', missed.length === 0 && falsePos.length === 0,
    `the fallback test fires on all ${HAZARD_SHAPES.length} load-bearing shapes `
    + `(env `||` default, createPool property) and on none of the `
    + `${DECOY_SHAPES.length} decoy shapes (${missed.length} missed, ${falsePos.length} false positive(s)`
    + `${missed.length ? '; missed: ' + missed.join(' | ') : ''}`
    + `${falsePos.length ? '; fired on: ' + falsePos.join(' | ') : ''}) — a redaction decoy is not a `
    + 'connection default, and the scan tells them apart by the syntax around the literal, not its address');

  const bareRefusers = EXPLICIT_TARGET_SUITES.map((f) => {
    // `shellEnv` has SUPABASE_URL deleted, so a child would dotenv-load the hosted SECTION A pair and
    // be refused by the boot guard BEFORE reaching its own store declaration. Loopback here keeps the
    // one missing declaration under test the PostgreSQL target, which is what CRG-137 is about.
    const run = runMch(path.join(BACKEND, f), { SUPABASE_URL: 'http://127.0.0.1:54321' });
    const why = {
      exit1: run.status === 1,
      refusal: new RegExp(`${f.replace(/\.js$/, '')} REFUSED: no PostgreSQL target is declared`).test(run.text),
      bothKeys: /DATABASE_URL \/ NABIN_PG_NOTIFY/.test(run.text),
      wrapper: /with_local_target\.js/.test(run.text),
      noSockets: Array.isArray(run.attempts) && run.attempts.length === 0,
      noFallbackAddress: !/54322/.test(run.text),
      noConnectionString: !/postgres(?:ql)?:\/\//.test(run.text),
    };
    return { file: f, status: run.status, sockets: socketCount(run), why,
      ok: Object.values(why).every(Boolean) };
  });
  const badRefusers = bareRefusers.filter((r) => !r.ok);
  const refusedCleanly = bareRefusers.filter((r) => r.ok).length;
  check('CRG-137', badRefusers.length === 0,
    `${refusedCleanly}/${bareRefusers.length} suites exit 1 with 0 socket(s) when nothing declares a `
    + 'target, naming both keys and the wrapper without echoing an address (deficient: '
    + `${badRefusers.map((r) => `${r.file} ${Object.entries(r.why).filter(([, v]) => !v)
      .map(([k]) => k).join('+') || '?'}`).join(', ') || 'none'}) — `
    + 'a conversion that only changed the constant would still connect somewhere');

  const fxSrc = fs.readFileSync(path.join(BACKEND, 'test_fixtures.js'), 'utf8');
  check('CRG-59', /ns\.nspname = current_schema\(\)/.test(fxSrc) && !/nspname = 'public'/.test(fxSrc),
    'child-FK discovery reads the session schema instead of assuming public, so a lane cleans its own children');

  const laneTool = path.join(BACKEND, 'scripts', 'lane_check.js');
  const laneSrc = fs.existsSync(laneTool) ? fs.readFileSync(laneTool, 'utf8') : '';
  check('CRG-60', laneSrc.length > 0 && /require\('\.\/test_chain'\)/.test(laneSrc)
    && /spawnLane\(env, dir\)/.test(laneSrc) && /LANE VERDICT/.test(laneSrc) && /census=/.test(laneSrc),
    'scripts/lane_check.js exists outside gitignored scratch/ and boots the lane with the runner\'s own spawnLane, so a pre-registration check and a chain link measure the same thing');

  const recipe = fs.readFileSync(path.join(BACKEND, '..', 'docs', 'testing', 'TESTING_STRATEGY.md'), 'utf8');
  const recipeCommands = recipe.split(/\r?\n/).filter((l) => /^\s*node .*tmp_/.test(l));
  check('CRG-61', recipeCommands.length === 0,
    `the committed testing recipe runs no gitignored helper (found ${recipeCommands.length} "node …tmp_…" line(s): ${recipeCommands.map((l) => l.trim()).join(' | ').slice(0, 170)})`);

  const suiteTargets = [
    // F-C1-1 moved this suite off its own fallback DSN, so "takes its target from the env the runner
    // sets" now means "takes it from the shared guard, which reads that same declared env". Re-derive
    // the shape from the file, never from this comment.
    ['place_substitution_test.js', /require\('\.\/scripts\/chain_target_guard'\)[\s\S]{0,600}?requireLoopbackPgTarget\(\{ label: 'place_substitution_test' \}\)/],
    ['test_suite.js', /const BASE_URL = process\.env\.NABIN_TEST_BASE_URL \|\| process\.env\.NABIN_TEST_BASE/],
    ['geo_adversarial_test.js', /process\.env\.GEO_TEST_BASE/],
  ];
  const missingTarget = suiteTargets.filter(([f, re]) => !re.test(fs.readFileSync(path.join(BACKEND, f), 'utf8')));
  check('CRG-62', missingTarget.length === 0,
    `the three booking suites all take their base/target from the env the runner sets (missing: ${missingTarget.map((m) => m[0]).join(', ') || 'none'})`);

  // The defect the first geo lane run found: `chain_scratch verify` compares against
  // `.chain-scratch/snapshot.json`, and an omitted `snapshot` made verify die at ENOENT AFTER a green
  // suite — so the lane answered "did public move?" with a crash. Order is the whole check.
  const atBaseline = laneSrc.indexOf("scratchCli(['snapshot'])");
  const atSuiteSpawn = laneSrc.indexOf('spawnSync(process.execPath, [path.resolve(BACKEND, suite)]');
  check('CRG-63', atBaseline !== -1 && atSuiteSpawn !== -1 && atBaseline < atSuiteSpawn
    && /chain_scratch snapshot failed/.test(laneSrc.slice(atBaseline, atSuiteSpawn)),
    `the lane takes its protected-table baseline before the suite runs and refuses if that fails (offsets ${atBaseline} < ${atSuiteSpawn})`);

  // ------------------------------------------------ booking-lane registration + CLI accounting
  // #334 registered the three suites that used to book 8 durable orders into `public` on the clone lane,
  // with BOTH flags. `isolated` alone is the trap: it gives the suite's own pg handle the scratch schema
  // while its HTTP bookings still land in `public`. Dropping `laneServer` from any of them would put the
  // residue back with every link still green, so the registration itself is what this pins.
  const bookingSuites = ['test_suite.js', 'geo_adversarial_test.js', 'place_substitution_test.js'];
  const unflagged = bookingSuites.filter((f) => {
    const l = LINKS.find((x) => x.file === f);
    return !l || l.isolated !== true || l.laneServer !== true;
  });
  check('CRG-64', unflagged.length === 0,
    `the three booking suites are registered with isolated AND laneServer, so their writes and their `
    + `assertions target one schema (deficient: ${unflagged.join(', ') || 'none'})`);

  // Both spellings of the subset flag resolve to the same link. The space form is what the committed
  // testing recipe documents, and until parseCliArgs existed it parsed as "no subset" and ran the whole
  // chain - a bigger run than asked for, reported as if it had been intended.
  const eqForm = mod.parseCliArgs(['--only=54']);
  const spaceForm = mod.parseCliArgs(['--only', '54']);
  const spacePick = mod.selectLinks(LINKS, spaceForm.onlyTokens || []);
  check('CRG-65', !eqForm.error && !spaceForm.error
    && eqForm.onlyTokens.join() === '54' && spaceForm.onlyTokens.join() === '54'
    && spacePick.picked.length === 1 && spacePick.picked[0].link.file === 'place_substitution_test.js'
    && mod.parseCliArgs(['--list']).list === true && mod.parseCliArgs([]).onlyTokens === null,
    `--only=<v> and --only <v> select the same registered link, --list still parses, no args requests the full chain`);

  const typo = mod.parseCliArgs(['--onlyy', '54']);
  const positional = mod.parseCliArgs(['place_substitution_test.js']);
  const noValue = mod.parseCliArgs(['--only']);
  const twice = mod.parseCliArgs(['--only=1', '--only', '2']);
  check('CRG-66', [/unrecognised argument/.test(typo.error || '') && /--onlyy/.test(typo.error || ''),
    /unrecognised argument/.test(positional.error || ''),
    /needs a value/.test(noValue.error || ''),
    /more than once/.test(twice.error || ''),
  ].every(Boolean) && [typo, positional, noValue, twice].every((c) => c.onlyTokens === null && !c.list),
    `an unknown flag, a bare filename, a valueless --only and a doubled --only are each refused by name instead of ignored (${[typo, positional, noValue, twice].map((c) => (c.error || '').slice(0, 34)).join(' // ')})`);

  check('CRG-67', /const cli = parseCliArgs\(argv\)/.test(codeMain)
    && codeMain.indexOf('cli.error') < codeMain.indexOf('createRunDir()')
    && !/argv\.find\(\(a\) => a\.startsWith\('--only='\)\)/.test(codeMain),
    'main() routes every argument through parseCliArgs and refuses on cli.error before the run directory exists, so no argument can be silently ignored');

  // The number a reader cites is the number in the table. Printing the loop position showed test_suite.js
  // as [2/77] and place_substitution as [55/77] while metadata recorded them as 1 and 54 - and the
  // harness-unreachable refusal, which is the message a red run is triaged by, named the next link.
  check('CRG-68', /\[\$\{index\}\/\$\{LINKS\.length\}\]/.test(runnerSrc) && !/index \+ 1/.test(runnerSrc)
    && /index: i \+ 1/.test(runnerSrc),
    'the plan carries the 1-based registered number in `index`, every message prints that number, and nothing re-derives it by adding one');

  // The committed recipe documents `--only place_substitution`, a file-name FRAGMENT. Until this check the
  // runner only accepted an exact basename or a number, so that documented command exited 1 — a recipe line
  // that does not run is the same reproducibility defect as a flag that is silently ignored, in the other
  // direction. A fragment is honoured only when exactly one registered link matches it.
  const frag = mod.selectLinks(LINKS, ['place_substitution']);
  const num = mod.selectLinks(LINKS, ['54']);
  const amb = mod.selectLinks(LINKS, ['geo']);
  check('CRG-69', frag.picked.length === 1 && num.picked.length === 1
    && frag.picked[0].index === num.picked[0].index && frag.unknown.length === 0 && frag.ambiguous.length === 0
    && amb.picked.length === 0 && amb.unknown.length === 0 && amb.ambiguous.length === 1
    && amb.ambiguous[0].candidates.join(',').includes('geo_policy_test.js')
    && amb.ambiguous[0].candidates.join(',').includes('geo_adversarial_test.js')
    && mod.selectLinks(LINKS, ['.js']).unknown.join() === '.js' && mod.selectLinks(LINKS, ['']).unknown.join() === '',
    `a fragment naming exactly one link selects it (place_substitution -> ${frag.picked[0] && frag.picked[0].index}) and an `
    + `ambiguous one selects NOTHING while naming every candidate (${amb.ambiguous[0] ? amb.ambiguous[0].candidates.length : 0} for "geo"), `
    + `with degenerate tokens still unknown`);

  // An ambiguous token must be refused the same way an unknown one is: before the run directory exists, so
  // a refused subset leaves no partial evidence behind.
  const atAmbRefuse = codeMain.indexOf('ambiguous.length');
  check('CRG-70', /const \{ picked, unknown, ambiguous \} = selectLinks\(LINKS, onlyTokens\)/.test(codeMain)
    && atAmbRefuse !== -1 && atAmbRefuse < codeMain.indexOf('createRunDir()'),
    `main() destructures ambiguous and refuses it before createRunDir (refuse at ${atAmbRefuse} < run dir at ${codeMain.indexOf('createRunDir()')})`);

  // ------------------------------------------------ #329 coverage: one list, no silent omission
  // Before this, the hard per-link guard and the whole-run census kept their own table lists, and the
  // guard's list was the smaller one: 20 tables moved in a run and only 14 of them could redden a link.
  // `dispatch_offers` alone grew 10,446 rows per run and the guard never saw it. The fix was a single
  // source of truth, so what is pinned here is the WIRING — that neither consumer can drift back into
  // holding its own list, and that a table in neither list is reported rather than skipped.
  const pt = require(path.join(BACKEND, 'scripts', 'protected_tables.js'));
  const guardSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'chain_scratch.js'), 'utf8');
  const censusSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'test_store_census.js'), 'utf8');
  const probeSrc = fs.readFileSync(path.join(BACKEND, 'scripts', 'guard_detection_probe.js'), 'utf8');

  const uncoveredAddition = pt.ADDITIONS_2026_10_15.filter(
    (t) => !pt.PROTECTED.includes(t) && !pt.APPEND_PROBED.some((p) => p.table === t));
  check('CRG-71', uncoveredAddition.length === 0 && pt.APPEND_PROBED.length > 0,
    `every table #329 added is counted by exactly one mechanism (unassigned: ${uncoveredAddition.join(', ') || 'none'}; `
    + `${pt.PROTECTED.length} exact-count name(s), ${pt.APPEND_PROBED.map((p) => p.table).join(', ')} append-probed)`);

  check('CRG-72', /require\('\.\/protected_tables'\)/.test(guardSrc) && /require\('\.\/protected_tables'\)/.test(censusSrc)
    && !/const PROTECTED = \[/.test(guardSrc) && !/const PROBE_TABLES = \[/.test(censusSrc),
    'chain_scratch.js and test_store_census.js both read scripts/protected_tables.js and neither declares a list of its own, so the two guards cannot disagree');

  // A full COUNT(*) on the 3,084,895-row accumulator measured 1,121 ms; twice per isolated link across
  // the chain would have added ~170 s to every run. The append probe is the priced alternative, so the
  // price has to stay paid: the COUNT template must be fed only from PROTECTED, and no append-probed
  // name may also sit in PROTECTED (which would count it exactly, twice).
  const doubleCounted = pt.APPEND_PROBED.filter((p) => pt.PROTECTED.includes(p.table));
  check('CRG-73', doubleCounted.length === 0
    && /const exact = existing\.filter\(\(t\) => PROTECTED\.includes\(t\)\)/.test(guardSrc)
    && /count\(\*\) n FROM \$\{GUARD_SCHEMA\}\.\$\{t\}/.test(guardSrc)
    && /for \(const probe of APPEND_PROBED\)/.test(guardSrc)
    && /WHERE \$\{probe\.column\} > '\$\{at\}'/.test(guardSrc)
    && pt.ADDITIONS_2026_10_15.includes('dispatch_offers'),
    `dispatch_offers is counted as "rows with ${pt.APPEND_PROBED[0] ? pt.APPEND_PROBED[0].column : '?'} after the baseline", never as an absolute COUNT `
    + `(names in both lists: ${doubleCounted.join(', ') || 'none'})`);

  check('CRG-74', /\[UNPROTECTED - add it to scripts\/protected_tables\.js\]/.test(censusSrc)
    && /UNPROTECTED MOVERS:/.test(censusSrc) && /isCovered\(k\)/.test(censusSrc),
    'the census classifies every mover [protected] or [UNPROTECTED …] and summarizes the uncovered ones, so a moving table cannot be silently omitted again');

  // The two ways a count-based guard goes silently green: it measures a schema that has none of the
  // tables (a missing rename) and it compares a baseline from another schema. Both must refuse.
  check('CRG-75', /the guard would have measured nothing/.test(guardSrc)
    && /refusing to compare counts from two different schemas/.test(guardSrc)
    && /prev\.schema !== GUARD_SCHEMA/.test(guardSrc)
    && /throw new Error\(`guard REFUSED: no protected table exists/.test(guardSrc),
    'a guard that would measure nothing, and a baseline held from another schema, both throw instead of reporting CLEAN');

  // The refusal above is a THROW, and the runner harvested only DRIFT/CONTAMINATION lines: a thrown guard
  // would have reddened the isolated link with an empty failure list, which reads like a suite problem.
  check('CRG-76', /GUARD ERROR: \$\{e\.message\}/.test(guardSrc)
    && /DRIFT\|CONTAMINATION\|GUARD ERROR/.test(runnerSrc)
    && /try \{\s*main\(\);\s*\} catch/.test(guardSrc),
    'chain_scratch wraps main() so a guard fault exits 1 with "GUARD ERROR: <reason>", and the runner\'s verify filter captures that line into the link\'s failures');

  // Detection is only claimed by a measurement, and that measurement must never write `public`. The probe
  // runs the real guard under NABIN_GUARD_SCHEMA; these pin the two properties that make it safe to keep.
  check('CRG-77', /NABIN_GUARD_SCHEMA/.test(guardSrc) && /GUARD_SCHEMA = process\.env\.NABIN_GUARD_SCHEMA \|\| 'public'/.test(guardSrc)
    && /holds a live `public` baseline/.test(probeSrc) && /is not loopback/.test(probeSrc)
    && /refusing to probe against public/.test(probeSrc) && /DROP SCHEMA IF EXISTS \$\{s\} CASCADE/.test(probeSrc),
    'the guard defaults to `public` and only proof mode redirects it; scripts/guard_detection_probe.js refuses public and non-loopback targets and drops its own schemas');

  // ------------------------------------------------ the baseline FILE must be measurable (CRG-78)
  //
  // CRG-75 refuses a schema that contains none of the protected names and a baseline held from another
  // schema. A third way to go silently green is a baseline that parses but cannot be measured with, and
  // the guard had no check for it: measured 2026-10-15 against a disposable schema, `"counts": {}`
  // printed `CLEAN: 0 protected … tables unchanged` at exit 0, and stripping the timestamp fields
  // printed `CLEAN: 2 …` at exit 0 while an append-probed table really held one row more — losing `at`
  // re-baselines the append probe at verification time, so every append during the link is invisible.
  // A truncated, hand-edited or older-tool-written state file therefore reddened nothing.
  check('CRG-78', /guard REFUSED: snapshot\.json carries no usable counts baseline/.test(guardSrc)
    && /not a non-negative integer count/.test(guardSrc)
    && /guard REFUSED: snapshot baseline has no usable timestamp/.test(guardSrc)
    && /prev\.appendBaseline \|\| prev\.at/.test(guardSrc),
    'readSnapshot() validates the baseline it is about to compare (counts present and integer, a usable timestamp) instead of iterating nothing and printing CLEAN');

  // The proof of that refusal must stay executable, not become a comment: the probe plants each
  // malformed shape against a DB state whose VALID baseline reddens verify, so the refusal can only
  // come from the baseline being rejected. It also puts the guard's single state file back the way it
  // found it, because a leftover baseline naming a dropped schema would make the next run read a phantom.
  check('CRG-79', /MALFORMED_BASELINES/.test(probeSrc)
    && /control: a VALID baseline did not redden verify/.test(probeSrc)
    && /refused\.status === 0 \|\| !\/guard REFUSED\/\.test\(text\)/.test(probeSrc)
    && /if \(foundSnapshot === null\) fs\.rmSync\(STATE, \{ force: true \}\)/.test(probeSrc)
    && /else fs\.writeFileSync\(STATE, foundSnapshot\)/.test(probeSrc)
    && /NO-BASELINE/.test(probeSrc),
    'scripts/guard_detection_probe.js case 5 plants each malformed baseline (with a valid-baseline control) and restores .chain-scratch/snapshot.json to its found state');

  // ------------------------------------------------ an ordinary link's attribution must not be silent
  //
  // The runner snapshots `public` before every non-isolated link so each DRIFT line names exactly one
  // link. Before this, that snapshot's exit status was discarded: when it failed, the diff after the
  // link silently compared against the PREVIOUS link's baseline, and the evidence attributed one link's
  // writes to another while reading like a normal `DRIFT public: …` line. Same class as CRG-30/31, on the
  // reporting side instead of the enforcement side.
  function attributionBaselineIsGated(text) {
    const { loop, anchor } = linkLoop(text);
    const spawn = loop.indexOf('runLink(link, env)');
    const window = spawn === -1 ? loop : loop.slice(0, spawn);
    // The ISOLATED branch also snapshots, so "some snapshot call is status-checked somewhere in the loop"
    // would pass without the ordinary branch being fixed. Anchor on the LAST snapshot statement assigned
    // to a variable before the spawn — that is the ordinary-link one — and require that its own status
    // feeds `attributionGap`. The needle has to include the `const snap = ` binding: searching for the
    // bare call made `window.slice(lastSnap)` start mid-statement, so the binding the regex asks for was
    // always 12 characters behind the slice and the check failed on the fix it exists to prove.
    const lastSnap = window.lastIndexOf("const snap = scratchCli('snapshot')");
    const gated = /const snap = scratchCli\('snapshot'\);[\s\S]{0,400}?snap\.status !== 0[\s\S]{0,400}?attributionGap =/
      .test(window.slice(lastSnap));
    return { window, anchor, spawn, lastSnap, gated, ok: anchor !== null && lastSnap !== -1 && gated };
  }

  const attribution = attributionBaselineIsGated(runnerSrc);
  check('CRG-80', attribution.ok,
    `the ordinary-link branch (${attribution.anchor ? `"${attribution.anchor}"` : 'NO LOOP ANCHOR - refusing, not proving'}) `
    + `reads its own attribution snapshot's status into attributionGap `
    + `(snapshot at ${attribution.lastSnap}, gated ${attribution.gated}, spawn at ${attribution.spawn})`);

  const PRE_FIX_ATTRIBUTION = [
    '      for (const [index, link] of LINKS.entries()) {',
    '        if (link.isolated) {',
    "          const snap = scratchCli('snapshot');",
    '          if (snap.status !== 0) isolationError = "setup";',
    '        } else {',
    "        scratchCli('snapshot');",
    '        }',
    '        const result = runLink(link, env);',
  ].join('\n');
  const preFixAttribution = attributionBaselineIsGated(PRE_FIX_ATTRIBUTION);
  check('CRG-81', preFixAttribution.ok === false && preFixAttribution.spawn !== -1
    && preFixAttribution.lastSnap !== -1 && preFixAttribution.gated === false,
    `the pre-fix branch (isolated link gates its snapshot, ordinary link discards its status) is rejected by the same predicate — CRG-80 is not vacuous`);

  // And when the diff itself cannot produce lines, the gap must say WHY. The guard dies by throwing, so
  // its sentence is on stderr; harvesting stdout only turned a crash into an empty drift list.
  check('CRG-82', /const diff = scratchCli\('diff'\)/.test(runnerSrc)
    && /\$\{diff\.stdout \|\| ''\}\\n\$\{diff\.stderr \|\| ''\}/.test(runnerSrc)
    && /BASELINE UNAVAILABLE \(\$\{attributionGap\}\)/.test(runnerSrc)
    && /UNAVAILABLE \(\$\{detail\}\) - attribution failed, link status unaffected/.test(runnerSrc),
    'the ordinary-link diff reads both streams, labels a stale-baseline gap BASELINE UNAVAILABLE with its cause, and never leaves an unexplained empty drift list');

  // ------------------------------------------------ F-10: a census that never measured is not a clean run
  //
  // The whole-run census is the one guard that can see a table nobody has protected. Until F-10 its
  // failures were only *recorded*: a baseline snapshot that exited non-zero landed in `census.error`,
  // which nothing read, and a compare that crashed landed in nothing at all. Both left `failures` at 0,
  // so the run printed `77/77 links clean, 0 problem(s)` and exited 0 while the guard had never read the
  // store — the exact "skipped or unmeasured described as passed" the brief forbids. The decision now
  // lives in scripts/census_verdict.js because test_chain.js's census code is inside main() and cannot be
  // called with a failed child result; these checks exercise THAT module with real spawnSync shapes.
  const verdict = require(path.join(BACKEND, 'scripts', 'census_verdict.js'));
  const SNAP_OK = { status: 0, stdout: 'public.users=357\npublic.orders=0\n', stderr: '' };
  const STACK = ['Error: connect ECONNREFUSED 127.0.0.1:54322',
    '    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1742:16)',
    '    at main (C:\\Users\\macmi\\Documents\\nabin\\backend\\scripts\\test_store_census.js:96:18)'].join('\n');
  const ONLY_FIRST = (t) => `${t}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || 'no output';

  const base = verdict.baselineOutcome(SNAP_OK, ONLY_FIRST);
  const baseFail = verdict.baselineOutcome({ status: 1, stdout: '', stderr: STACK }, ONLY_FIRST);
  const baseInjected = verdict.baselineOutcome({ status: 1, stdout: '', stderr: STACK }, () => 'INJECTED-SUMMARY');
  check('CRG-83', base.ok === true && base.state === 'baselined' && base.drift.length === 0
    && base.reason === undefined,
    `a snapshot that exited 0 is a measurement (ok ${base.ok}, state ${base.state}) — the green path still works`);

  check('CRG-84', baseFail.ok === false && baseFail.state === 'unavailable'
    && /snapshot failed \(exit 1\)/.test(baseFail.reason)
    && baseFail.reason.includes('connect ECONNREFUSED')
    && !/at TCPConnectWrap/.test(baseFail.reason),
    `a snapshot that exited 1 is UNAVAILABLE, not a warning (${baseFail.reason}) — and the stack frames are summarised, not spewed`);

  check('CRG-85', baseInjected.reason.includes('INJECTED-SUMMARY') && !baseInjected.reason.includes('ECONNREFUSED'),
    'the summarizer is INJECTED (the runner passes its own isolationFailureSummary), so one stack reducer decides every census cause');

  const crashed = verdict.baselineOutcome({ status: null, error: { message: 'spawn node ENOENT' }, stdout: '', stderr: '' }, ONLY_FIRST);
  check('CRG-86', crashed.ok === false && /exit null \(the census child process never ran — spawn node ENOENT\)/.test(crashed.reason),
    `a census child that never started is reported as never having run (${crashed.reason}) rather than exit undefined`);

  const cmpClean = verdict.compareOutcome({ status: 0, stdout: 'CENSUS CLEAN: 74 census line(s) unchanged against ref\n', stderr: '' }, ONLY_FIRST);
  const cmpDrift = verdict.compareOutcome({ status: 0, stdout: 'DRIFT public.users: 357 -> 359 [protected]\n', stderr: '1 census line(s) changed since ref\n' }, ONLY_FIRST);
  const cmpRefused = verdict.compareOutcome({ status: 1, stdout: '', stderr: 'census REFUSED: PostgreSQL target host db.example.com is not loopback\n' }, ONLY_FIRST);
  const cmpSilent = verdict.compareOutcome({ status: 0, stdout: 'public.users=357\nwarning: something printed\n', stderr: '' }, ONLY_FIRST);
  const cmpStderrDrift = verdict.compareOutcome({ status: 0, stdout: '', stderr: 'DRIFT public.users: 1 -> 2\n' }, ONLY_FIRST);

  check('CRG-87', cmpClean.ok === true && cmpClean.state === 'clean' && cmpClean.clean === true && cmpDrift.ok === true
    && cmpDrift.state === 'drift' && cmpDrift.drift.length === 1 && cmpDrift.clean === false,
    'CENSUS CLEAN is a clean measurement and a DRIFT line at exit 0 is a MEASURED drift (report-only, ok:true) — F-10 must not redden a link for ordinary public writes');

  check('CRG-88', cmpRefused.ok === false && cmpRefused.state === 'unavailable'
    && /compare exited 1/.test(cmpRefused.reason) && cmpRefused.reason.includes('is not loopback'),
    `a compare that refused or crashed is UNAVAILABLE (${cmpRefused.reason}) — the --report-only flag means exit 0 on drift, so nonzero is never "the store moved"`);

  check('CRG-89', cmpSilent.ok === false && cmpSilent.state === 'unavailable' && cmpSilent.drift.length === 0
    && cmpStderrDrift.ok === false && cmpStderrDrift.state === 'unavailable',
    'an exit-0 compare that printed neither CENSUS CLEAN nor a stdout DRIFT line produces NO verdict and cannot be scored clean (stderr drift does not count)');

  // The module only helps if the runner actually routes through it and only if the result reaches the
  // verdict, the exit code and both evidence files.
  const censusWired = /const censusVerdict = require\('\.\/census_verdict'\)/.test(runnerSrc)
    && /censusVerdict\.baselineOutcome\(snap, isolationFailureSummary\)/.test(runnerSrc)
    && /censusVerdict\.compareOutcome\(cmp, isolationFailureSummary\)/.test(runnerSrc);
  check('CRG-90', censusWired,
    'test_chain.js requires scripts/census_verdict.js and calls BOTH outcomes with its own isolationFailureSummary, so the tested module is the runtime path');

  function failsClosedWhenUnmeasured(text) {
    const counts = /const problems = failures \+ censusProblems\.length;/.test(text);
    const exits = /const exitCode = problems \? 1 : 0;/.test(text);
    const prints = /CHAIN RESULT: \$\{passedLinks\}\/\$\{results\.length\} links clean, \$\{problems\} problem\(s\)/.test(text);
    return { counts, exits, prints, ok: counts && exits && prints };
  }
  const failClosed = failsClosedWhenUnmeasured(codeMain);
  const PRE_FIX_VERDICT = [
    '  const passedLinks = results.length - failures;',
    '  const problems = failures;',
    '  const exitCode = failures ? 1 : 0;',
    '  console.log(`\\n=== CHAIN RESULT: ${passedLinks}/${results.length} links clean, ${failures} problem(s)`',
  ].join('\n');
  check('CRG-91', failClosed.ok,
    `the verdict counts census problems alongside link failures (${JSON.stringify(failClosed)}) and the CHAIN RESULT marker prints the `
    + `combined total, so an unmeasured census cannot print "0 problem(s)" next to a clean link line`);
  check('CRG-92', failsClosedWhenUnmeasured(PRE_FIX_VERDICT).ok === false
    && /const exitCode = failures \? 1 : 0;/.test(PRE_FIX_VERDICT),
    'the pre-fix verdict (exit driven by failures alone, marker printing the link count) is rejected by the same predicate — CRG-91 is not vacuous');

  const evidenceCarries = [
    /censusProblems: censusProblems \|\| \[\]/.test(runnerSrc),
    /CENSUS UNAVAILABLE — \$\{censusProblems\.join/
      .test(runnerSrc),
    /for \(const p of censusProblems\) console\.log\(`    CENSUS UNAVAILABLE — \$\{p\}`\)/.test(runnerSrc),
    /function writeRunEvidence\(\{[^}]*censusProblems[^}]*\}\)/.test(runnerSrc),
  ];
  check('CRG-93', evidenceCarries.every(Boolean),
    `the census problem is written into metadata.json, chain-summary.txt and the console tail (${evidenceCarries.filter(Boolean).length}/4 channels) — `
    + 'no reader of the run evidence can take an unmeasured guard as a clean one');

  // A baseline that failed must never be compared against: `ref` stays null, and the compare is guarded
  // by the ref, so a phantom baseline cannot print "0 public line(s) moved".
  const noPhantom = /census = \{ ref: null, state: base\.state,[\s\S]{0,200}?censusProblems\.push\(`baseline census: \$\{base\.reason\}`\)/
    .test(codeMain) && /if \(census && census\.ref\) \{/.test(codeMain);
  check('CRG-94', noPhantom,
    'a failed baseline leaves census.ref null and the post-run compare only runs against a real baseline file');

  // The operator opt-out is a labelled gap, not a measurement failure and not a pass.
  const optOut = /census = \{ ref: null, state: 'skipped', lines: 0, skipped: true, drift: \[\] \}/.test(codeMain)
    && /census: SKIPPED \(--no-census\)/.test(runnerSrc)
    && /ISOLATION EVIDENCE INCOMPLETE/.test(runnerSrc);
  const optOutNotFatal = !/censusProblems\.push\(`--no-census/.test(codeMain);
  check('CRG-95', optOut && optOutNotFatal,
    '--no-census is recorded as a labelled SKIP in the summary and named as incomplete isolation evidence, while staying out of censusProblems '
    + '(an explicit operator choice is not a failed measurement)');

  // Independence from the append probe (brief §1): the append probe on dispatch_offers is blind to deletes
  // and back-dated inserts, so the whole-run census must stay a separate mechanism — own CLI, own schema
  // argument, snapshot before the first link, compare after the last child is stopped.
  const aCensusSnap = codeMain.indexOf("censusCli('snapshot', CENSUS_REF)");
  const aCensusCmp = codeMain.indexOf("censusCli('compare', CENSUS_REF)");
  const aFirstScratch = codeMain.indexOf('scratchCli(');
  const aStopHarness = codeMain.indexOf('await stopHarness()');
  check('CRG-96', aCensusSnap !== -1 && aCensusCmp !== -1 && aFirstScratch !== -1 && aStopHarness !== -1
    && aCensusSnap < aFirstScratch && aCensusCmp > aStopHarness
    && /const args = \[CENSUS_SCRIPT, mode, 'public'\]/.test(runnerSrc)
    && !/APPEND_PROBED/.test(runnerSrc)
    && /count\(\*\)/.test(censusSrc),
    `the census runs on public (args name it explicitly), is taken before any clone call (snapshot ${aCensusSnap} < scratch ${aFirstScratch}) `
    + `and compared after teardown (compare ${aCensusCmp} > stopHarness ${aStopHarness}); the runner holds no append-probe logic, so the `
    + 'delete/back-date blind spot of the dispatch_offers probe is not the census\'s blind spot');

  // ---- F-C1-2: an empty census must not be able to read as CLEAN.
  //
  // Measured 2026-10-16: `snapshot some_typo_schema` against a running store printed nothing, wrote
  // `"counts": {}`, exited 0, and the matching `compare` printed `CENSUS CLEAN: 0 census line(s)
  // unchanged` at exit 0 — the residue question answered by a guard that had measured nothing. The
  // executed proof of the four refusals plus the zero-row case is `selftest` (it runs them on disposable
  // schemas); these pins hold the SHIPPED code shape that proof depends on, so a later edit cannot delete
  // the check and leave the selftest green by forgetting to ask.
  //
  // Every refusal is about TABLES and none is about ROWS: an existing table holding zero rows must stay
  // a measurement (brief F-C1-2 point 4), so the predicate below fails if a row count ever appears inside
  // assertMeasurable's body.
  const amSrc = (censusSrc.match(/async function assertMeasurable[\s\S]*?\n\}/) || [''])[0];
  const refusesFourShapes = /does not exist in this database/.test(amSrc)
    && /exists but holds no base tables/.test(amSrc)
    && /none of the \$\{GUARDED_NAMES\.length\} guarded table names exists/.test(amSrc)
    && /--required table\(s\)/.test(amSrc);
  const countsRows = /count\(\*\)|rows\.length|rowCount/.test(
    amSrc.replace(/SELECT 1 FROM information_schema\.schemata[\s\S]*?\[schema\]\)\)\.rowCount/, ''));
  const measuresBeforeCounting = (src) => {
    const guardCall = src.indexOf('const measurable = await assertMeasurable(client, schema, rows)');
    const firstCount = src.indexOf('SELECT count(*)::bigint n FROM ${schema}.${tablename}');
    return guardCall !== -1 && firstCount !== -1 && guardCall < firstCount;
  };
  check('CRG-112', amSrc !== '' && refusesFourShapes && !countsRows
    && measuresBeforeCounting(censusSrc),
    `assertMeasurable refuses all four unmeasurable shapes (absent schema / no base tables / no guarded name / `
    + `--required absent), names no row count in its own body (row-count tokens found: ${countsRows ? 'yes' : 'none'}) `
    + `and runs before the first COUNT in census()`);
  const censusWithoutGuard = censusSrc
    .replace('const measurable = await assertMeasurable(client, schema, rows);', 'const measurable = { guardedPresent: 0 };');
  check('CRG-113', refusesFourShapes && measuresBeforeCounting(censusSrc)
    && !measuresBeforeCounting(censusWithoutGuard),
    'the pre-fix census (counts first, never asks whether the schema is measurable) is rejected by the same predicate — CRG-112 is not vacuous');

  // The two halves have to agree, or a run whose baseline measured nothing compares an empty object
  // against anything and prints CLEAN. F-10 classifies a nonzero compare as `unavailable`; a
  // zero-exit-no-verdict compare is the shape that still needed closing at the source.
  const evidenceRecords = /guardedTablesPresent: measurable\.guardedPresent/.test(censusSrc)
    && /requiredTables: REQUIRED/.test(censusSrc);
  const baselineRefused = /census REFUSED: --ref \$\{ref\} carries no counts baseline/.test(censusSrc);
  const guardedSetRefused = /the guarded set itself moved/.test(censusSrc);
  const cleanNamesScope = /CENSUS CLEAN: \$\{keys\.length\} census line\(s\) unchanged[\s\S]{0,120}\$\{measurable\.guardedPresent\} guarded table\(s\) measured/.test(censusSrc);
  check('CRG-114', evidenceRecords && baselineRefused && guardedSetRefused && cleanNamesScope,
    'a snapshot records how many guarded tables it measured, compare refuses a counts-less baseline and a moved guarded set, and the CLEAN line prints the measured scope — so "CLEAN" always names what was actually counted');

  // Brief F-C1-2 asks for five executed cases. Cases 1-4 run through expectRefusal inside selftest and
  // case 5 spawns the real CLI twice; pin that the selftest still exercises THAT list rather than a
  // narrower one, and that every schema it creates is dropped again.
  const selftestSrc = (censusSrc.match(/async function selftest[\s\S]*?\nmain\(\)/) || [''])[0];
  const fiveCases = [/zero-row schema IS a measurement/.test(selftestSrc),
    /expectRefusal\('nonexistent schema'/.test(selftestSrc),
    /schema with no guarded table name/.test(selftestSrc),
    /--required \$\{notInProbe\} absent/.test(selftestSrc),
    /censusVerdict\.compareOutcome\(cmp5/.test(selftestSrc)];
  const disposablesDropped = /DROP SCHEMA IF EXISTS \$\{s\} CASCADE/.test(selftestSrc)
    && /still present after DROP SCHEMA/.test(selftestSrc);
  check('CRG-115', selftestSrc !== '' && fiveCases.every(Boolean) && disposablesDropped,
    `selftest executes all five F-C1-2 cases (flags: ${fiveCases.filter(Boolean).length}/5) and its teardown drops `
    + 'each probe schema then re-reads information_schema to prove absence — the brief\'s "use disposable schemas '
    + 'only / do not modify shared public data" rule is enforced by the same run that reports PASS');

  // ---- F-13: no server this runner starts may perform a write of its own on a timer.
  //
  // Measured 2026-10-16 against a disposable `chain_scratch` clone: a bare boot of src/server.js,
  // with no suite attached and nobody calling reconcile, deleted 6 expired `backend_sessions` rows
  // 15,053 ms after it answered /api/health. The writer is the 15 s interval src/server.js arms at
  // boot, whose first statement is `delete … lte('expires_at', nowIso)` (src/database.js:7381, now
  // behind the `prune` guard below) against whatever store liveStore() points at — which for the
  // SHARED harness is `public`. So an isolated link's protected-count window contained a background
  // DELETE it never asked for, and the moment public holds an expired row that read as PUBLIC
  // CONTAMINATION on a clean link.
  // `scripts/guard_detection_probe.js` case 6 proves the guard reddens on exactly that write shape
  // (`backend_sessions: 1 -> 0`, verify exit 1); these pins hold the lifecycle half.
  const serverSpawns = [...runnerCode.matchAll(/spawn\(process\.execPath, \[path\.join\(BACKEND, 'src\/server\.js'\)\]/g)];
  const spawnGate = (src) => /spawn\(process\.execPath, \[path\.join\(BACKEND, 'src\/server\.js'\)\]/.test(src)
    && [...src.matchAll(/spawn\(process\.execPath, \[path\.join\(BACKEND, 'src\/server\.js'\)\]/g)]
      .every((m) => /NABIN_SESSION_RECONCILE_MS: '0'/.test(src.slice(m.index, m.index + 900)));
  check('CRG-97', serverSpawns.length === 2 && spawnGate(runnerCode)
    && (runnerCode.match(/NABIN_SESSION_RECONCILE_MS: '0'/g) || []).length === 2,
    `both src/server.js spawns (harness + lane; ${serverSpawns.length} site(s) found) disable the background reconciler`);
  const preFixSpawns = runnerCode.replace(/, NABIN_SESSION_RECONCILE_MS: '0'/g, '');
  check('CRG-98', serverSpawns.length === 2 && spawnGate(preFixSpawns) === false
    && !/NABIN_SESSION_RECONCILE_MS/.test(preFixSpawns),
    'the pre-fix spawn envs ({ ...env, PORT }) are rejected by the same predicate on the same 2 sites — CRG-97 is not vacuous');

  // The app side: the gate must live in src/server.js, keep 15000 as the unset default (a normal
  // deploy converges sessions exactly as before), and arm the timer only in the non-zero branch.
  const appBoot = fs.readFileSync(path.join(BACKEND, 'src', 'server.js'), 'utf8')
    .split(/\r?\n/).filter((l) => !/^\s*(?:\/\/|\*|\/\*)/.test(l)).join('\n');
  const bootTail = appBoot.slice(appBoot.lastIndexOf('await db.hydrateSessions()'));
  check('CRG-99', /let reconcileMs = 15000;/.test(bootTail)
    && /rawReconcileMs === '0' \|\| rawReconcileMs\.toLowerCase\(\) === 'off'/.test(bootTail)
    && /Number\.isInteger\(parsedReconcileMs\) && parsedReconcileMs > 0/.test(bootTail)
    && /Ignoring NABIN_SESSION_RECONCILE_MS/.test(bootTail),
    'unset keeps the 15000 ms production interval, 0/off disables it, and a value that is neither is warned about and defaulted rather than trusted');
  // The armed tick passes the write half explicitly, so `prune` cannot silently become the
  // default of a call that forgot it. `armIdx` is an index into the comment-stripped boot block,
  // not a file position — the pattern has to match the call src/server.js makes today.
  const armIdx = bootTail.search(/setInterval\(\(\) => \{\s*\n?\s*db\.reconcileSessions\(/);
  check('CRG-100', armIdx !== -1
    && /reconcileSessions\(\{ prune: !pruneOff \}\)/.test(bootTail.slice(armIdx, armIdx + 260))
    && /, reconcileMs\);/.test(bootTail.slice(armIdx, armIdx + 260))
    && /if \(reconcileMs === 0\)/.test(bootTail) && bootTail.indexOf('if (reconcileMs === 0)') < armIdx
    && !/}, 15000\);/.test(bootTail),
    `the interval is armed only behind the gate, on the parsed value, and with the store write named at the `
    + `call site (setInterval at ${armIdx}, reconcileSessions given prune: !pruneOff, delay \`reconcileMs\`, `
    + 'no unconditional literal 15000 timer left in the boot block)');

  // The contract between the defect and the guard: the table the reconciler deletes from must be
  // counted EXACTLY by the isolation guard, because a decrease is the only thing it can cause.
  const protectedMod = require(path.join(BACKEND, 'scripts', 'protected_tables.js'));
  check('CRG-101', protectedMod.PROTECTED.includes('backend_sessions')
    && !protectedMod.APPEND_PROBED.some((p) => p.table === 'backend_sessions')
    && /store\.from\('backend_sessions'\)\.delete\(\)\.lte\('expires_at', nowIso\)/
      .test(fs.readFileSync(path.join(BACKEND, 'src', 'database.js'), 'utf8')),
    'backend_sessions is an exact-count protected table (not append-probed), and reconcileSessions\' only store '
    + 'mutation is the delete that shape detects — a harness prune inside an isolated window cannot pass silently');

  // Turning the timer off stops the write; turning the write off while the timer runs is what lets
  // a suite still ask for cross-instance convergence from a supervised process. F-13 removed the
  // shared harness's tick, and `admin_authorization_test` RX / `admin_customers_test` INP-21/22
  // were waiting on that tick to adopt a `backend_sessions` row they inserted themselves —
  // `getSessionByToken` reads only this process's map, so adoption IS the tick and there is no
  // other bridge. Those suites now boot their own short-interval instance with the delete
  // switched off. The delete lives in `src/database.js` and is off by default, so the half that
  // stays must be pinned too: an inverted `prune`, a default flipped to off, or the statement
  // moved back above the guard would each hand the removed hazard straight back.
  const reconcileSrc = fs.readFileSync(path.join(BACKEND, 'src', 'database.js'), 'utf8');
  const reconcileBody = reconcileSrc.slice(reconcileSrc.indexOf('async reconcileSessions('));
  check('CRG-102', /async reconcileSessions\(\{[^}]*prune = true[^}]*\}\s*=\s*\{\}\)/.test(reconcileSrc)
    && /if \(prune\) \{/.test(reconcileBody)
    && reconcileBody.indexOf('if (prune) {')
        < reconcileBody.indexOf(".from('backend_sessions').delete().lte('expires_at', nowIso)")
    && /\.from\('backend_sessions'\)\.delete\(\)\.lte\('expires_at', nowIso\)/.test(reconcileBody),
    'reconcileSessions takes `prune = true` (an ordinary tick, in production or in a suite, still prunes), and its '
    + 'store delete sits inside `if (prune)` — the read-only half is the opt-in, never the default');
  check('CRG-103', /NABIN_SESSION_PRUNE/.test(bootTail)
    && /\[\s*'off',\s*'0'\s*\]\.includes/.test(bootTail)
    && bootTail.indexOf('NABIN_SESSION_PRUNE') < bootTail.indexOf('const sessionReconcileTimer = setInterval'),
    'the same boot block reads NABIN_SESSION_PRUNE, treats only off/0 as off (unset prunes exactly as shipped), '
    + 'and decides before the timer is armed');

  // ---- F-10's operator opt-out, executed rather than read ------------------
  // CRG-95 pins the SKIP label and the INCOMPLETE line by pattern, and it stayed green while
  // `node scripts/test_chain.js --no-census` answered `unrecognised argument` and exited 1. The cause:
  // parseCliArgs refuses every token it does not know (added so an ignored `--only 54` cannot boot 77
  // links behind an operator who asked for one), `no-census` was not in its accepted list, and the
  // census step reads the flag from argv further down — so the documented opt-out was unreachable and
  // no pin on the reader could see the parser refusing in front of it. These two cases run the real
  // code: the parser and the reader on the same literal, then the real binary on the documented command.
  const censusOff = mod.parseCliArgs(['--no-census']);
  const censusOffWithSubset = mod.parseCliArgs(['--no-census', '--only=54']);
  const censusOffTypo = mod.parseCliArgs(['--no-census=1']);
  check('CRG-104', !censusOff.error && censusOff.noCensus === true
    && censusOff.onlyTokens === null && !censusOff.list
    && !censusOffWithSubset.error && censusOffWithSubset.noCensus === true
    && censusOffWithSubset.onlyTokens.join() === '54'
    && mod.flagSet(['--no-census'], 'no-census') === true
    && /flagSet\(argv, 'no-census'\)/.test(codeMain)
    && censusOffTypo.error !== null && /unrecognised argument/.test(censusOffTypo.error || ''),
    '`--no-census` parses to noCensus:true, survives a --only beside it, and is the exact literal the census step '
    + 'reads (the exported flagSet agrees with the parser); an `--no-census=1` form is still refused by name, so '
    + 'the token is matched exactly rather than prefixed');

  // The command from the testing recipe, run for real. `--list` returns before the harness lock, the
  // target guards and the census, so this proves the parse without starting anything.
  const listed = spawnSync(process.execPath, [RUNNER, '--no-census', '--list'], {
    cwd: BACKEND, encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, shellEnv, {
      NABIN_CHAIN_ENV_FILE: fixtureEnv, NABIN_HARNESS_PORT: PROBE_PORT,
      NABIN_ENV: 'development', NABIN_SUPABASE_REF: 'nabinprobe0123456789', NODE_ENV: 'development',
    }),
  });
  const listedText = `${listed.stdout || ''}${listed.stderr || ''}`;
  check('CRG-105', listed.status === 0 && !/unrecognised argument/.test(listedText)
    && /registered links, in run order/.test(listedText) && /--no-census/.test(listedText),
    `the real runner takes \`node scripts/test_chain.js --no-census --list\` (exit=${listed.status}) and prints the `
    + `catalog with the --no-census help line, instead of the refusal that hid the opt-out -> `
    + `${listedText.split(/\r?\n/).filter((l) => /unrecognised|registered links/.test(l))[0] || '(no line)'}`
    .slice(0, 240));

  // ---- F-C1-3: a stale NABIN_GUARD_SCHEMA cannot re-aim the hard guard.
  //
  // Measured 2026-10-16 before the fix: neither scripts/test_chain.js nor scripts/with_local_target.js
  // named NABIN_GUARD_SCHEMA at all, and scripts/chain_scratch.js trusted that ONE declaration. A value
  // a disposable-schema proof session left in a reused shell therefore moved the per-link guard off
  // `public` for a whole run, and every isolated link still printed CLEAN — about a schema the run had
  // never owned, while `public` went unguarded. The rule is now TWO declarations (the schema AND
  // NABIN_GUARD_PROOF=1) enforced at all three layers from one shared predicate, and a full-chain run
  // may declare neither. Refusal, never sanitising: no layer rewrites a declared value to `public`.
  //
  // The guard cases below spawn the real CLI with a command name main() never dispatches, so the process
  // stops at the usage line instead of reaching psql — the refusals fire in assertGuardSchema(), before
  // the dispatch. Nothing here touches a store or a schema.
  const SCRATCH = path.join(BACKEND, 'scripts', 'chain_scratch.js');
  const WRAPPER = path.join(BACKEND, 'scripts', 'with_local_target.js');
  const GUARD_MODULE = path.join(BACKEND, 'scripts', 'chain_target_guard.js');
  const guardRun = (extra) => spawnSync(process.execPath, [SCRATCH, 'crg-not-a-command'], {
    cwd: BACKEND, encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, shellEnv, { NODE_ENV: 'development' }, extra),
  });
  const staleRun = guardRun({ NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin' });
  const proofRun = guardRun({ NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin', NABIN_GUARD_PROOF: '1' });
  const publicRun = guardRun({ NABIN_GUARD_SCHEMA: 'public' });
  const badIdentRun = guardRun({ NABIN_GUARD_SCHEMA: 'public; DROP TABLE orders', NABIN_GUARD_PROOF: '1' });
  const text = (r) => `${r.stdout || ''}${r.stderr || ''}`;
  const usageOnly = (r) => /usage: node scripts\/chain_scratch\.js/.test(text(r)) && !/REFUSED/.test(text(r));
  check('CRG-116', staleRun.status === 1
    && /REFUSED: NABIN_GUARD_SCHEMA=nabin_guard_probe_pin moves the hard guard off `public`/.test(text(staleRun))
    && !/PROOF MODE/.test(text(staleRun)) && !/usage:/.test(text(staleRun))
    && usageOnly(proofRun) && /PROOF MODE \(NABIN_GUARD_PROOF=1\)/.test(text(proofRun))
    && usageOnly(publicRun) && !/PROOF MODE|REFUSED/.test(text(publicRun))
    && /is not a plain identifier/.test(text(badIdentRun)),
    `the real guard refuses the half-declared redirect (exit=${staleRun.status}) where F-C1-3 used to print CLEAN, `
    + `accepts the stated one and labels it PROOF MODE (exit=${proofRun.status}), guards \`public\` quietly `
    + `(exit=${publicRun.status}), and still refuses an unparseable schema name even when proof is declared `
    + `(exit=${badIdentRun.status}) — the invalid-identifier refusal still wins, and every one of the four `
    + 'stopped inside assertGuardSchema before main() dispatched a command, so no store was reached');

  // The runner's own reading of the same pair of declarations, through the exported function, on the four
  // shapes an operator can actually arrive with. A canary password sits in DATABASE_URL to prove the
  // refusal names keys and schema names only.
  const canary = 'crg-canary-secret';
  const guardEnvCases = [
    { env: { NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin' }, want: 'refuse', why: 'stale redirect, intent undeclared' },
    { env: { NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin', NABIN_GUARD_PROOF: '1' }, want: 'refuse', why: 'proof mode inside a chain run' },
    { env: { NABIN_GUARD_SCHEMA: 'public' }, want: 'allow', why: 'explicit public' },
    { env: {}, want: 'allow', why: 'unset (the shipped default)' },
  ];
  const prevEnvFile = process.env.NABIN_CHAIN_ENV_FILE;
  process.env.NABIN_CHAIN_ENV_FILE = NULL_TARGET_ENV;
  const guardEnvOutcomes = guardEnvCases.map((c) => mod.chainGuardEnvConflict(Object.assign({}, {
    DATABASE_URL: `postgresql://postgres:${canary}@127.0.0.1:54322/postgres`, SUPABASE_URL: 'http://127.0.0.1:54321' }, c.env)));
  if (prevEnvFile === undefined) delete process.env.NABIN_CHAIN_ENV_FILE;
  else process.env.NABIN_CHAIN_ENV_FILE = prevEnvFile;
  const guardEnvWrong = guardEnvCases.filter((c, i) => Boolean(guardEnvOutcomes[i]) !== (c.want === 'refuse'))
    .map((c) => c.why);
  check('CRG-117', guardEnvWrong.length === 0
    && /NABIN_GUARD_PROOF=1 is not set/.test(guardEnvOutcomes[0] || '')
    && /a full-chain run must guard `public`/.test(guardEnvOutcomes[1] || '')
    && guardEnvOutcomes.every((m) => m === null || !m.includes(canary)),
    `chainGuardEnvConflict gets all four shapes right (${guardEnvCases.map((c, i) => `${c.why}=${guardEnvOutcomes[i] ? 'refused' : 'allowed'}`).join(', ')}), `
    + 'naming the schema it is guarding rather than the DSN it was given — no DATABASE_URL password appears in any message');

  // The wrapper refuses before it spawns, and the refusal is wired after the local block has been applied
  // (so a redirect declared in .env participates too) and before cp.spawn().
  const wrapperStale = spawnSync(process.execPath, [WRAPPER, 'node', '-e', 'console.log("CRG-118-SPAWNED")'], {
    cwd: BACKEND, encoding: 'utf8', timeout: 60000,
    env: Object.assign({}, shellEnv, { NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin' }),
  });
  const wrapperSrc = fs.readFileSync(WRAPPER, 'utf8');
  const callAt = wrapperSrc.indexOf('\nrefuseUnprovenGuardRedirect();');
  check('CRG-118', wrapperStale.status === 2
    && !/CRG-118-SPAWNED/.test(text(wrapperStale))
    && /NABIN_GUARD_SCHEMA=nabin_guard_probe_pin aims the hard isolation guard/.test(text(wrapperStale))
    && callAt !== -1
    && callAt > wrapperSrc.indexOf('validateEffectiveTarget();')
    && callAt < wrapperSrc.indexOf('cp.spawn(command, args'),
    `the real wrapper exits ${wrapperStale.status} with "Nothing was spawned" on a stale redirect `
    + `(child output absent: ${!/CRG-118-SPAWNED/.test(text(wrapperStale))}), and the call sits after the local `
    + 'block has been applied and before cp.spawn, so the run never starts against a redirected guard');

  // One shared predicate, and no layer that sanitises instead of refusing. The non-vacuity witness is a
  // mutated copy of the SHIPPED function with its two clauses switched off: that is F-C1-3's original code,
  // and it lets the stale redirect through — so a green CRG-116/117/118 above is not the test agreeing with
  // itself.
  const guardModSrc = fs.readFileSync(GUARD_MODULE, 'utf8');
  const predSrc = (guardModSrc.match(/function guardEnvConflict[\s\S]*?\n\}/) || [''])[0];
  const keys = [predSrc.includes('if (redirected && !proof) {'), predSrc.includes('if (!allowProof && (redirected || proof)) {')];
  const preFixSrc = predSrc
    .replace('if (redirected && !proof) {', 'if (false) {')
    .replace('if (!allowProof && (redirected || proof)) {', 'if (false) {');
  const preFixPredicate = keys.every(Boolean)
    ? new Function('GUARD_SCHEMA_KEY', 'GUARD_PROOF_KEY', `return (${preFixSrc})`)(
      'NABIN_GUARD_SCHEMA', 'NABIN_GUARD_PROOF') : null;
  const preFixLets = preFixPredicate
    ? [preFixPredicate({ NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin' }),
       preFixPredicate({ NABIN_GUARD_SCHEMA: 'nabin_guard_probe_pin', NABIN_GUARD_PROOF: '1' }, { allowProof: false })]
    : ['<predicate shape changed>', '<predicate shape changed>'];
  // "Prefer a clear refusal ... instead of silently sanitizing": a layer that overwrote or deleted the
  // declared key would produce a green run nobody asked for, so the write form must not exist anywhere.
  const sanitises = [RUNNER, WRAPPER, SCRATCH].map((f) => fs.readFileSync(f, 'utf8'))
    .filter((src) => /process\.env\.NABIN_GUARD_(?:SCHEMA|PROOF)\s*=|delete\s+\w*\.?NABIN_GUARD_(?:SCHEMA|PROOF)/.test(src));
  check('CRG-119', keys.every(Boolean) && preFixLets.every((m) => m === null)
    && typeof mod.chainGuardEnvConflict === 'function'
    && /targetGuard\.guardEnvConflict\(/.test(fs.readFileSync(RUNNER, 'utf8'))
    && /guardEnvConflict\(process\.env\)/.test(wrapperSrc)
    && /\|\| 'public'/.test(guardSrc) && sanitises.length === 0,
    `the three layers share one guardEnvConflict (runner via targetGuard, wrapper via process.env) and the `
    + `pre-fix copy of that same function answers null to both redirect shapes (${preFixLets.length} probes) — `
    + 'which is exactly the CLEAN-about-the-wrong-schema reading F-C1-3 removed; nothing rewrites a declared value');

  // The proof session's own cases must survive the new rule: the probe states both declarations, and it
  // keeps the section that proves the refusal happens BEFORE the guard does any work.
  const probeProofDecl = /NABIN_GUARD_SCHEMA: schema, NABIN_GUARD_PROOF: '1'/.test(probeSrc);
  const probeBareCase = /function guardBare\(schema, cmd\)/.test(probeSrc)
    && /delete env\.NABIN_GUARD_PROOF/.test(probeSrc)
    && /guardBare\(A, 'verify'\)/.test(probeSrc)
    && /stale redirect \(NABIN_GUARD_SCHEMA=/.test(probeSrc)
    && /baseline file byte-identical/.test(probeSrc);
  const probeCrossIntact = /compared by a guard aimed at/.test(probeSrc)
    && /guard aimed at a schema with no protected tables/.test(probeSrc);
  const runnerWiresBeforeRunDir = codeMain.indexOf('chainGuardEnvConflict()') !== -1
    && codeMain.indexOf('chainGuardEnvConflict()') < codeMain.indexOf('createRunDir()');
  check('CRG-120', probeProofDecl && probeBareCase && probeCrossIntact && runnerWiresBeforeRunDir,
    `the disposable-schema probe still declares both keys (proof session), still exercises the bare redirect `
    + `and proves the refusal leaves snapshot.json byte-identical (flags: ${[probeProofDecl, probeBareCase, probeCrossIntact].filter(Boolean).length}/3), `
    + `and the runner's own refusal is before createRunDir (idx ${codeMain.indexOf('chainGuardEnvConflict()')} `
    + `< ${codeMain.indexOf('createRunDir()')}) so a refused redirect leaves no partial evidence`);

  // F-C1-5 (measured 2026-10-16): the per-link attribution baseline is written to ONE fixed path,
  // `.chain-scratch/snapshot.json`, and nothing removed it when the run ended. So a finished run left a
  // file that is indistinguishable from a run in flight, and the guard probe refuses that shape on
  // principle: chain_20261016_080137_15108_4f72a0 exited 0 at 08:02:10 with a `public` baseline stamped
  // 08:02:08, and `node scripts/guard_detection_probe.js` was still refusing 90 minutes later (see
  // backend/scratch/review_20261016_c1/fc14_verification_sweep.log). The fix has to be the runner's, at
  // the end of its own finally, and the command it calls must be narrower than teardown() — a run that
  // ends is not a reason to drop a clone, a container or a proxy that the next run reuses.
  const dropFn = (guardSrc.match(/function dropBaseline\(\)[\s\S]*?\n\}/) || [''])[0];
  const dropWired = /else if \(cmd === 'drop-baseline'\)/.test(guardSrc) && /dropBaseline\(\);/.test(guardSrc);
  const dropIsNarrow = dropFn.includes('snapshot.json')
    && !/DROP SCHEMA|docker rm|process\.kill|link\.env/.test(dropFn);
  const usageListsDrop = /\[provision\|link-env\|snapshot\|verify\|diff\|drop-baseline\|teardown\|status\]/.test(guardSrc);
  const probeEscapeNarrowed = /clear just that baseline with: node scripts\/chain_scratch\.js drop-baseline/.test(probeSrc);
  const aSnap = codeMain.indexOf("const snap = scratchCli('snapshot')");
  const aFlag = codeMain.indexOf('attributionBaseline = true');
  const aDrop = codeMain.indexOf("scratchCli('drop-baseline')");
  const aCompare = codeMain.indexOf("censusCli('compare'");
  const aRelease = codeMain.indexOf('releaseHarnessLock(');
  const dropAfterLastUse = aDrop > aCompare && aDrop < aRelease;
  const dropPreFix = codeMain.replace("scratchCli('drop-baseline')", "scratchCli('nothing-at-all')");
  const dropPreFixRejected = dropPreFix !== codeMain && !/scratchCli\('drop-baseline'\)/.test(dropPreFix);
  check('CRG-121', dropWired && dropIsNarrow && usageListsDrop && probeEscapeNarrowed && dropPreFixRejected
    && aFlag > aSnap && aSnap !== -1 && dropAfterLastUse,
    `chain_scratch has a drop-baseline command that touches ONLY .chain-scratch/snapshot.json `
    + `(narrow: ${dropIsNarrow}, wired: ${dropWired}, usage: ${usageListsDrop}), the runner takes the flag `
    + `right after its attribution snapshot (snapshot ${aSnap} -> flag ${aFlag}) and drops the baseline inside `
    + `its finally after the census compare and before the lock release (compare ${aCompare} < drop ${aDrop} `
    + `< release ${aRelease}); the probe's own escape names that command instead of a full teardown `
    + `(${probeEscapeNarrowed}), and the pre-fix runner shape is rejected by the same predicate`);

  // ---- F-C1-6: the runner refuses a registry it cannot see (CRG-122..127)
  //
  // Measured 2026-10-16 while settling the commit boundary: the runner in this worktree registers
  // `mod.LINKS.length` links and 22 of those suite files do not exist at `a48c079`, so `HEAD + the
  // runner alone` was not a shorter chain — it was a chain that could not run. Before this fix the
  // runner booted a harness against the database, paid one `Cannot find module` spawn per missing
  // link, and left a reader to work out from the per-link logs that the coverage the registry claims
  // was never there. A missing registered file is missing coverage, so it is a REFUSAL before the
  // census, the scratch clone, the run directory and the harness — and the refusal names every one.
  //
  // Nothing here binds a socket or reaches a store: the executed cases run a COPY of the runner in a
  // temp checkout that holds only its four load-time files, so the refusal happens before any spawn,
  // against a synthetic loopback target that carries a canary password to prove the message names
  // files and not credentials.
  const fc16Tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crg-fc16-'));
  const synthPlan = [{ index: 1, link: { file: 'synth_one_test.js' } },
    { index: 2, link: { file: path.join('sub', 'synth_two_test.js') } }];
  const synthMissing = mod.missingChainFiles(synthPlan, path.join(fc16Tmp, 'empty-base'));
  check('CRG-122', typeof mod.missingChainFiles === 'function'
    && synthMissing.length === synthPlan.length + 2
    && synthMissing.includes('[1] synth_one_test.js (registered link)')
    && synthMissing.includes(`[2] ${path.join('sub', 'synth_two_test.js')} (registered link)`)
    && synthMissing.includes('scripts/chain_scratch.js (script this runner spawns)')
    && synthMissing.includes('scripts/test_store_census.js (script this runner spawns)'),
    `the exported predicate names every absent registered file with its 1-based link number AND both scripts `
    + `this runner spawns (${synthMissing.length} lines from a ${synthPlan.length}-link plan against a base `
    + 'directory that holds nothing) — the two spawned scripts are covered too, because a checkout with the '
    + 'suites but no census would fail at link 1 instead of here');

  // The gate must be file-existence driven, not a blanket refusal: the same plan against a directory
  // that does hold the files returns nothing at all.
  const fc16Full = path.join(fc16Tmp, 'full');
  fs.mkdirSync(path.join(fc16Full, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fc16Full, 'sub'), { recursive: true });
  for (const rel of ['synth_one_test.js', path.join('sub', 'synth_two_test.js'),
    path.join('scripts', 'chain_scratch.js'), path.join('scripts', 'test_store_census.js')]) {
    fs.writeFileSync(path.join(fc16Full, rel), '// CRG-123 placeholder file\n', 'utf8');
  }
  const presentMissing = mod.missingChainFiles(synthPlan, fc16Full);
  const realPlan = mod.LINKS.map((link, i) => ({ link, index: i + 1 }));
  const realMissing = mod.missingChainFiles(realPlan, BACKEND);
  check('CRG-123', presentMissing.length === 0 && realMissing.length === 0
    && mod.missingChainFiles(realPlan, path.join(fc16Tmp, 'empty-base')).length === mod.LINKS.length + 2,
    `the predicate answers empty for a plan whose files exist (${presentMissing.length} for the synthetic plan, `
    + `${realMissing.length} for this worktree's real ${mod.LINKS.length}-link registry) and `
    + `${mod.LINKS.length + 2} for that same registry against an empty base — so CRG-124's refusal is caused by `
    + 'absent files, not by a gate that always fires');

  // A checkout that holds only the runner and its four load-time files — exactly what a partial commit
  // would produce, and the case the brief asked to be made unmissable.
  const fc16Root = path.join(fc16Tmp, 'checkout');
  const fc16Scripts = path.join(fc16Root, 'scripts');
  fs.mkdirSync(fc16Scripts, { recursive: true });
  for (const rel of ['scripts/test_chain.js', 'scripts/chain_target_guard.js',
    'scripts/port_release.js', 'scripts/census_verdict.js']) {
    fs.copyFileSync(path.join(BACKEND, rel), path.join(fc16Scripts, path.basename(rel)));
  }
  const fc16Env = Object.assign({}, shellEnv, {
    NODE_ENV: 'development', NABIN_ENV: 'development', NABIN_SUPABASE_REF: 'nabinprobe0123456789',
    NABIN_HARNESS_PORT: '4112',
    // A loopback target with a canary in it: the run must pass the remote-store gate and reach the
    // file gate, and the canary proves the refusal never prints a credential.
    DATABASE_URL: 'postgresql://postgres:crg-fc16-canary@127.0.0.1:54322/postgres',
    SUPABASE_URL: 'http://127.0.0.1:54321',
  });
  // No env file is inherited: this checkout has no `backend/.env`, which is the F-C1-7 half — an
  // ABSENT file must not be reported as an unreadable one, or the refusal never gets reached.
  delete fc16Env.NABIN_CHAIN_ENV_FILE;
  const partialRun = spawnSync(process.execPath, [path.join(fc16Scripts, 'test_chain.js')], {
    cwd: fc16Root, encoding: 'utf8', timeout: 60000, env: fc16Env,
  });
  const partialText = `${partialRun.stdout || ''}${partialRun.stderr || ''}`;
  const partialMissingLines = partialText.split(/\r?\n/).filter((l) => /^\s*MISSING /.test(l));
  // The refusal is the whole output: header + one MISSING line per absent file + the remedy line.
  // Anything else (a run id, a census, a harness) would mean the gate fired too late.
  const partialLines = partialText.split(/\r?\n/).filter((l) => l.trim()).length;
  check('CRG-124', partialRun.status === 1
    && new RegExp(`✖ chain refused: ${mod.LINKS.length + 2} file\\(s\\) this run needs are not in this checkout `
      + `\\(.+\\) — ${mod.LINKS.length} of ${mod.LINKS.length} planned link file\\(s\\) and 2 script\\(s\\) `
      + 'this runner spawns').test(partialText)
    && partialMissingLines.length === mod.LINKS.length + 2
    && partialMissingLines.includes(`    MISSING [1] ${mod.LINKS[0].file} (registered link)`)
    && partialLines === mod.LINKS.length + 4
    && !fs.existsSync(path.join(fc16Root, '.chain-logs'))
    && !partialText.includes('crg-fc16-canary')
    && /Either commit the complete dependency set or drop these registrations/.test(partialText),
    `the real runner, copied into a checkout with only its load-time files, exits ${partialRun.status} and prints `
    + `${partialMissingLines.length} MISSING lines for its own ${mod.LINKS.length}-link registry (${partialMissingLines.length} `
    + `= ${mod.LINKS.length} links + 2 spawned scripts) as its ENTIRE output (${partialLines} lines: header + `
    + `${mod.LINKS.length + 2} + remedy) — so no run directory (no .chain-logs: `
    + `${!fs.existsSync(path.join(fc16Root, '.chain-logs'))}), census, scratch clone or harness was reached; the `
    + 'message names files only (canary password absent) and states both correct remedies');

  // A subset run is not an escape hatch: `--only 1` plans one missing link and must refuse the same way.
  const subsetRun = spawnSync(process.execPath,
    [path.join(fc16Scripts, 'test_chain.js'), '--only=1'], {
      cwd: fc16Root, encoding: 'utf8', timeout: 60000, env: fc16Env,
    });
  const subsetText = `${subsetRun.stdout || ''}${subsetRun.stderr || ''}`;
  check('CRG-125', subsetRun.status === 1
    && /✖ chain refused: 3 file\(s\) this run needs are not in this checkout \(.+\) — 1 of 1 planned link file\(s\) and 2 script\(s\) this runner spawns/.test(subsetText)
    && subsetText.split(/\r?\n/).filter((l) => /^\s*MISSING /.test(l)).length === 3
    && subsetText.split(/\r?\n/).filter((l) => l.trim()).length === 5
    && !fs.existsSync(path.join(fc16Root, '.chain-logs')),
    `the subset path is gated too: \`--only=1\` in the same partial checkout exits ${subsetRun.status} naming `
    + '1 of 1 planned links (5 lines total), so a one-link run cannot smuggle a missing file past the gate');

  // ...while the registry stays NAMEABLE on that same checkout, because printing it is how an operator
  // finds out which links are missing. The refusal must not make the runner unusable for triage.
  const listPartial = spawnSync(process.execPath,
    [path.join(fc16Scripts, 'test_chain.js'), '--list'], {
      cwd: fc16Root, encoding: 'utf8', timeout: 60000, env: fc16Env,
    });
  const listPartialText = `${listPartial.stdout || ''}${listPartial.stderr || ''}`;
  check('CRG-126', listPartial.status === 0
    && listPartialText.includes(`${mod.LINKS.length} registered links, in run order:`)
    && !/MISSING|chain refused/.test(listPartialText),
    `\`--list\` still answers on the partial checkout (exit=${listPartial.status}, ${mod.LINKS.length} links `
    + `printed, no refusal text) — F-C1-6 refuses to RUN an incomplete registry without making it unnameable`);

  // The wiring, not just the function: the gate sits after the three earlier refusals and before
  // `createRunDir()`, and no later code quietly forgives an absent file.
  const gateIdx = codeMain.indexOf('missingChainFiles(plan)');
  const guardIdx = codeMain.indexOf('chainGuardEnvConflict()');
  const runDirIdx = codeMain.indexOf('createRunDir()');
  const gateIfIdx = codeMain.indexOf('if (missingFiles.length)');
  const gateExitIdx = codeMain.indexOf('process.exit(1);', gateIfIdx);
  const gateExits = gateIfIdx !== -1 && gateExitIdx !== -1 && gateExitIdx < runDirIdx;
  const silentForgive = [...runnerCode.matchAll(/fs\.existsSync\([^)]*link\.file[^)]*\)/g)];
  check('CRG-127', gateIdx !== -1 && gateIdx > guardIdx && guardIdx !== -1 && gateIdx < runDirIdx
    && runDirIdx !== -1 && gateExits && silentForgive.length === 0,
    `the gate runs after the guard-env refusal (idx ${guardIdx}) and before the run directory (idx ${runDirIdx}), `
    + `exits 1 on its own refusal block (${gateExits}), and the runner contains ${silentForgive.length} `
    + 'existsSync(link.file) checks — an absent registered file is never skipped, downgraded or passed anywhere '
    + 'else in the run');

  const failed = results.filter((r) => !r.ok).length;
  try { fs.rmSync(fc16Tmp, { recursive: true, force: true }); } catch (e) { /* best effort on a temp dir */ }
  try { fs.rmSync(targetFixtureDir, { recursive: true, force: true }); } catch (e) { /* best effort on a temp dir */ }
  try { fs.rmSync(mchDir, { recursive: true, force: true }); } catch (e) { /* best effort on a temp dir */ }
  console.log(`\n${failed ? '❌' : '✅'} ${results.length - failed}/${results.length} passed, ${failed} failed`);
  for (const r of results.filter((x) => !x.ok)) console.log(`   FAILED ${r.id}: ${r.detail}`);
  process.exit(failed ? 1 : 0);
})();
