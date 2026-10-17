/*
 * Lane check — does ONE suite really stay off the shared `public` store?
 *
 * Promoted from `scratch/tmp_isolated_suite_runner.js` (2026-10-15) because the committed testing
 * recipe in docs/testing/TESTING_STRATEGY.md told people to run files that live in a gitignored
 * directory: a lane anyone has to reconstruct from memory is a lane nobody checks before
 * registering a link, and registering an isolatable-looking link is how a suite ends up writing
 * `public` inside the chain.
 *
 * It runs the same sequence `scripts/test_chain.js` runs for an `isolated` link, for one suite, and
 * adds the two things the chain does not do per link:
 *   - `--lane-server`: boot a SECOND backend with the isolated env and point the suite's base-URL
 *     variables at it, which is the only way an HTTP suite's writes land in the clone at all.
 *     This uses the runner's own `spawnLane`/`stopLane` (exported for exactly this reason), so a
 *     suite that passes here gets the lane the chain would give it.
 *   - a full-schema public census before and after (`scripts/test_store_census.js`), because
 *     `chain_scratch verify` only guards a curated list of protected tables and cannot answer
 *     "what else moved?".
 *
 * Verdict is the AND of three measurements — suite exit, clone contamination, public drift — and it
 * fails closed at every step: no clone, no suite run; no lane, no HTTP suite run; no census, no
 * "clean" claim. Nothing here deletes or updates a row in `public`.
 *
 * Usage (from backend/, under the local target so the base env is the authoritative one):
 *   node scripts/with_local_target.js node scripts/lane_check.js <suite.js> [--lane-server] [--keep]
 *   --keep   leave the clone and the raw log up for a follow-up read (teardown is then on you)
 *   --no-census  skip the before/after public census (only when the store is being written by another run)
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');

const { readLinkEnv, releasePrivatePort } = require('./port_release');
const { spawnLane, stopLane, LANE_BASE_URL_KEYS } = require('./test_chain');

const BACKEND = path.resolve(__dirname, '..');
const SCRATCH = path.join(BACKEND, 'scratch');
const SUITES_DIR = path.join(BACKEND, '.chain-logs', 'lane');
const CENSUS = path.join(__dirname, 'test_store_census.js');
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;

const argv = process.argv.slice(2);
const suite = argv.find((a) => !a.startsWith('--'));
const wantLane = argv.includes('--lane-server');
const keep = argv.includes('--keep');
const noCensus = argv.includes('--no-census');
const mask = (v) => String(v || '').replace(/:[^:@/]*@/, ':***@');

function refuse(reason) {
  console.error(`LANE CHECK REFUSED: ${reason}`);
  process.exit(2);
}

if (!suite) refuse('no suite named — usage: node scripts/lane_check.js <suite.js> [--lane-server] [--keep]');
if (!fs.existsSync(path.resolve(BACKEND, suite))) refuse(`${suite} does not exist under ${BACKEND}`);

function scratchCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, 'chain_scratch.js'), ...args], {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024
  });
}

function censusCli(mode, file) {
  const args = [CENSUS, mode, 'public'];
  if (mode === 'snapshot') args.push('--out', file);
  if (mode === 'compare') args.push('--ref', file);
  return spawnSync(process.execPath, args, {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { NODE_ENV: process.env.NODE_ENV || 'local' })
  });
}

async function main() {
  // Fail closed before anything is provisioned: a suite that resolves its own target would write
  // wherever this shell points, and the whole check would measure the wrong store.
  const probe = scratchCli(['status']);
  if (probe.status !== 0 && !/not running|absent|no state/i.test(`${probe.stdout}${probe.stderr}`)) {
    refuse(`chain_scratch status failed: ${String(probe.stderr || probe.stdout).trim().slice(0, 300)}`);
  }
  const prov = scratchCli(['provision']);
  if (prov.status !== 0) {
    refuse(`clone could not be provisioned (is the local Docker stack up?) — `
      + `${String(prov.stderr || prov.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' / ')}`);
  }
  const le = scratchCli(['link-env']);
  if (le.status !== 0) refuse(`link-env failed: ${String(le.stderr || le.stdout).trim().slice(0, 300)}`);

  const linkEnv = readLinkEnv();
  if (!LOOPBACK.test(new URL(linkEnv.DATABASE_URL).hostname)) {
    refuse(`link.env points at a non-loopback host — this is not a local lane`);
  }

  // The protected-public-table baseline that `verify` compares against. `test_chain.js` takes this
  // before every isolated link; missing it here made `verify` die at ENOENT on
  // `.chain-scratch/snapshot.json`, so the first geo lane run reported the suite green while the
  // clone check never ran at all. A lane check that cannot answer "did public move?" is not a pass.
  const baseline = scratchCli(['snapshot']);
  if (baseline.status !== 0) {
    scratchCli(['teardown']);
    refuse(`chain_scratch snapshot failed (exit ${baseline.status}): `
      + `${String(baseline.stderr || baseline.stdout).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' / ')}`);
  }
  const baseLines = String(baseline.stdout || '').split(/\r?\n/).filter((l) => /^\s*public\./.test(l));
  console.log(`protected baseline: ${baseLines.length} public table(s) counted -> .chain-scratch/snapshot.json`);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  const dir = path.join(SUITES_DIR, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const rawLog = path.join(dir, `${path.basename(suite)}.raw.log`);

  // A suite that restarts its own backend must not evict whatever the operator has on :4000.
  const srv = net.createServer();
  await new Promise((res, rej) => { srv.once('error', rej); srv.listen(0, '127.0.0.1', res); });
  const privatePort = String(srv.address().port);
  await new Promise((res) => srv.close(res));

  const env = {
    ...process.env, ...linkEnv,
    NABIN_RESTART_PORT: process.env.NABIN_RESTART_PORT || privatePort
  };

  let lane = null;
  if (wantLane) {
    try {
      lane = await spawnLane(env, dir);
    } catch (e) {
      scratchCli(['teardown']);
      refuse(`lane backend unavailable: ${e.message}`);
    }
    for (const key of LANE_BASE_URL_KEYS) env[key] = lane.url;
  }

  const beforeFile = path.join(dir, 'census-public-before.json');
  let census = null;
  if (!noCensus) {
    const snap = censusCli('snapshot', beforeFile);
    if (snap.status !== 0) {
      if (lane) await stopLane();
      scratchCli(['teardown']);
      refuse(`public census snapshot failed (exit ${snap.status}): ${String(snap.stderr || snap.stdout).trim().slice(0, 300)}`);
    }
    census = { beforeFile, lines: (snap.stdout || '').split(/\r?\n/).filter(Boolean).length };
    console.log(`census: ${census.lines} public line(s) baselined -> ${path.relative(BACKEND, beforeFile)}`);
  }

  console.log(`=== lane check ${suite}`);
  console.log(`    suite DATABASE_URL = ${mask(env.DATABASE_URL)}`);
  console.log(`    suite SUPABASE_URL = ${env.SUPABASE_URL}`);
  console.log(`    suite base URL     = ${env.NABIN_TEST_BASE_URL || env.GEO_TEST_BASE || '(unset — suite default)'}`);
  console.log(`    lane backend       = ${lane ? `${lane.url} (pid ${lane.proc.pid})` : 'none (--lane-server not passed)'}`);
  console.log(`    NABIN_RESTART_PORT = ${env.NABIN_RESTART_PORT}`);

  const run = spawnSync(process.execPath, [path.resolve(BACKEND, suite)], {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env
  });
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  fs.writeFileSync(rawLog, out, 'utf8');
  const passMarkers = (out.match(/\[PASS\]|PASS\b/g) || []).length;
  const failMarkers = (out.match(/\[FAIL\]|❌/g) || []).length;
  console.log(`--- suite exit=${run.status}  pass markers=${passMarkers}  fail markers=${failMarkers}`);
  console.log(`    raw output -> ${path.relative(BACKEND, rawLog)}`);
  console.log(out.split(/\r?\n/).filter((l) => /\[FAIL\]|❌|ALL \d+\/\d+|Passed:|Failed:|RESIDUE|CONTAMINAT|REFUSED|Error:/.test(l)).slice(-12).join('\n'));

  if (lane) {
    const stopped = await stopLane();
    console.log(`--- lane teardown: ${stopped}`);
    if (/STILL bound/.test(stopped)) console.error('LANE PORT NOT RELEASED');
  }

  const ver = scratchCli(['verify']);
  console.log(`--- clone verify exit=${ver.status}`);
  console.log(`${String(ver.stdout || '').trim()}\n${String(ver.stderr || '').trim()}`);

  let drift = null;
  if (census) {
    const cmp = censusCli('compare', beforeFile);
    const lines = String(cmp.stdout || '').split(/\r?\n/).filter((l) => /^DRIFT |^CENSUS CLEAN/.test(l));
    drift = { exit: cmp.status, clean: /^CENSUS CLEAN/.test(lines.join('\n')), lines: lines.filter((l) => l.startsWith('DRIFT')) };
    console.log(`--- public census exit=${cmp.status}`);
    console.log(lines.join('\n') || '(no census output)');
  } else {
    console.log('--- public census: SKIPPED (--no-census) — isolation of `public` is NOT proven by this run');
  }

  if (!keep) {
    const td = scratchCli(['teardown']);
    console.log(`--- teardown exit=${td.status}`);
    if (td.status !== 0) console.error(String(td.stderr || td.stdout).trim());
  } else {
    console.log('--- teardown: --keep, the clone is still up (scripts/chain_scratch.js teardown)');
  }
  const portRelease = releasePrivatePort(env.NABIN_RESTART_PORT === privatePort ? privatePort : null);
  console.log(`--- private port release: ${portRelease}`);

  const suiteGreen = run.status === 0 && failMarkers === 0;
  const cloneClean = ver.status === 0;
  const publicClean = census ? drift && drift.clean : null;
  console.log(`=== LANE VERDICT ${suite} suiteExit=${run.status} failMarkers=${failMarkers} `
    + `verifyExit=${ver.status} census=${census ? (drift.clean ? 'CLEAN' : `DRIFT(${drift.lines.length})`) : 'SKIPPED'} `
    + `lane=${lane ? lane.port : 'none'} green=${suiteGreen && cloneClean && publicClean !== false} ===`);
  process.exit(suiteGreen && cloneClean && publicClean !== false ? 0 : 1);
}

main().catch((e) => {
  console.error(`LANE CHECK FAILED ${e.message}`);
  process.exit(1);
});
