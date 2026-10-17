/*
 * Detection proof for the HARD isolation guard (scripts/chain_scratch.js `verify`).
 *
 * `chain_scratch verify` only means something if a write it is supposed to refuse actually reddens
 * it, and proving that against the shared `public` schema would mean deliberately contaminating it -
 * which is the one thing this harness must never do. So the probe runs the real guard with
 * NABIN_GUARD_SCHEMA aimed at a throwaway schema that has the same protected tables in it, together
 * with the matching NABIN_GUARD_PROOF=1 the guard requires before it will leave `public` (F-C1-3):
 *
 *   A = nabin_guard_probe_a  - stands in for `public`, the schema the guard watches
 *   B = nabin_guard_probe_b  - stands in for `chain_scratch`, what an isolated link legitimately writes
 *
 * Six things get measured, all of them by running the guard rather than reading it:
 *   1. every #329 table the guard now claims to cover reddens `verify` when a row lands in A;
 *   2. a row with a back-dated timestamp does NOT - the documented price of counting a 3M-row
 *      accumulator by "created after the baseline" instead of COUNT (*), and the case the whole-run
 *      census still catches;
 *   3. writes to B leave `verify` CLEAN, i.e. legitimate isolated-clone writes stay permitted;
 *   4. a baseline from one schema cannot be compared by a guard pointed at another, and a guard
 *      aimed at a schema with no protected tables in it refuses instead of reporting CLEAN;
 *   4b. F-C1-3: `NABIN_GUARD_SCHEMA` on its own (the shape a stale shell has) is REFUSED before the
 *       guard reads the store or its baseline file, while the same schema plus `NABIN_GUARD_PROOF=1`
 *       runs and is labelled PROOF MODE;
 *   5. a baseline file that cannot be measured against (no counts, no timestamp, a non-integer
 *      count) refuses too, instead of comparing nothing and printing `CLEAN: 0 … tables unchanged`;
 *   6. a row DELETED from a guarded exact-count table in A reddens `verify` (F-13: the session
 *      reconciler's only write is a delete, and it lands from a background timer no test asked
 *      for), while the same delete inside B stays CLEAN.
 *
 * What neither guard sees, by construction: both compare ROW COUNTS (plus the census's named row
 * probes). An UPDATE that adds and removes no row - a rate column, a flag, a status - moves no count,
 * so it is invisible to `verify`, to `diff`, and to the census. Documents must not claim otherwise.
 *
 * `public` is read for table definitions and for one copyable row per table, never written. Targets
 * come from the environment and must be loopback; NODE_ENV=production is refused.
 *
 * Usage (from backend/, under the local target):
 *   node scripts/with_local_target.js node scripts/guard_detection_probe.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { PROTECTED, APPEND_PROBED, ADDITIONS_2026_10_15, tableOf } = require('./protected_tables');

const A = 'nabin_guard_probe_a';
const B = 'nabin_guard_probe_b';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
const BACKEND = path.resolve(__dirname, '..');
const GUARD = path.join(__dirname, 'chain_scratch.js');
const STATE = path.join(BACKEND, '.chain-scratch', 'snapshot.json');
const appendColumn = (t) => (APPEND_PROBED.find((p) => p.table === t) || {}).column || null;

function guard(schema, cmd) {
  return spawnSync(process.execPath, [GUARD, cmd], {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    // F-C1-3: the redirect needs both declarations. This file IS the intended proof session — it aims the
    // real guard at a throwaway schema precisely so detection can be proven without contaminating `public`
    // — so it states the schema AND the intent. A bare NABIN_GUARD_SCHEMA in a reused shell is refused.
    env: Object.assign({}, process.env, { NABIN_GUARD_SCHEMA: schema, NABIN_GUARD_PROOF: '1' })
  });
}

// The shape a stale shell actually has: the schema, and no statement of intent. Section 4b proves the
// guard refuses this instead of reporting CLEAN about a schema the run does not own.
function guardBare(schema, cmd) {
  const env = Object.assign({}, process.env, { NABIN_GUARD_SCHEMA: schema });
  delete env.NABIN_GUARD_PROOF;
  return spawnSync(process.execPath, [GUARD, cmd], {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env
  });
}

function fail(msg) { throw new Error(`${msg}\n  (probe schemas are dropped in the finally block)`); }

/** One copyable INSERT for any table: real values, minus columns PostgreSQL owns. */
async function insertTemplate(client, fromSchema, table, toSchema, override) {
  const cols = (await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 AND is_generated='NEVER' AND is_identity='NO'
      ORDER BY ordinal_position`, [fromSchema, table])).rows.map((r) => r.column_name);
  if (!cols.length) throw new Error(`${table} has no insertable columns`);
  const list = cols.map((c) => `"${c}"`).join(', ');
  const select = cols.map((c) => (override && c === override ? 'now()' : `"${c}"`)).join(', ');
  return client.query(
    `INSERT INTO ${toSchema}.${table} (${list}) SELECT ${select} FROM ${fromSchema}.${table} LIMIT 1`);
}

async function main(client) {
  for (const name of [A, B]) {
    if (name === 'public') throw new Error('refusing to probe against public');
    const exists = (await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [name])).rowCount;
    if (exists) throw new Error(`${name} already exists - an earlier probe did not clean up`);
  }
  if (fs.existsSync(STATE)) {
    let live = '';
    try { live = JSON.parse(fs.readFileSync(STATE, 'utf8')).schema; } catch (e) { live = 'unreadable'; }
    if (live === 'public') {
      throw new Error('refusing: .chain-scratch/snapshot.json holds a live `public` baseline, so a chain '
        + 'run may be in flight. Let it finish; if no run is live (a hard-killed run can leave the file '
        + 'behind) clear just that baseline with: node scripts/chain_scratch.js drop-baseline');
    }
  }

  const publicTables = (await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows.map((r) => r.tablename);
  const covered = [...new Set([...PROTECTED, ...APPEND_PROBED.map((p) => p.table)])]
    .filter((t) => publicTables.includes(t));
  const missing = PROTECTED.filter((t) => !publicTables.includes(t));
  console.log(`probe: guarded schema=${A}, legitimate-write schema=${B}`);
  console.log(`probe: ${covered.length} protected table definition(s) copied into each (public is read, never written)`
    + `${missing.length ? `; not in public, so not copyable: ${missing.join(', ')}` : ''}`);

  for (const s of [A, B]) {
    await client.query(`CREATE SCHEMA ${s}`);
    for (const t of covered) await client.query(`CREATE TABLE ${s}.${t} (LIKE public.${t} INCLUDING ALL)`);
  }

  // ---- 1. every newly protected name reddens the hard guard
  const snap = guard(A, 'snapshot');
  if (snap.status !== 0) fail(`baseline snapshot on ${A} failed (exit ${snap.status}): ${snap.stderr}`);
  const baseNames = String(snap.stdout).split(/\r?\n/).filter((l) => new RegExp(`^\\s*${A}\\.`).test(l));
  if (baseNames.length !== covered.length) {
    fail(`baseline counted ${baseNames.length} of ${covered.length} protected tables in ${A}`);
  }
  for (const t of ADDITIONS_2026_10_15) {
    const col = appendColumn(t);
    const res = await insertTemplate(client, 'public', t, A, col);
    if (res.rowCount !== 1) fail(`could not seed a probe row into ${A}.${t} (${res.rowCount})`);
  }
  const diff = guard(A, 'diff');
  const ver = guard(A, 'verify');
  const driftLines = String(diff.stdout).split(/\r?\n/).filter((l) => l.startsWith(`DRIFT ${A}.`));
  const verLines = `${ver.stdout}${ver.stderr}`.split(/\r?\n/).filter((l) => /DRIFT|CONTAMINATION/.test(l));
  const notRed = ADDITIONS_2026_10_15.filter(
    (t) => !verLines.some((l) => l.includes(`${A}.${t}:`)));
  console.log(`  writes to ${A}: ${driftLines.length} diff line(s), verify exit=${ver.status}`);
  for (const l of driftLines.slice(0, 12)) console.log(`    ${l.trim()}`);
  if (driftLines.length > 12) console.log(`    … ${driftLines.length - 12} more`);
  if (ver.status === 0) fail(`verify stayed green after a row landed in ${verLines.length ? '?' : ''}${A} - the hard guard does not detect it`);
  if (notRed.length) fail(`verify reddened on OTHER tables but stayed silent on ${notRed.join(', ')}`);
  if (!/CONTAMINATION/.test(`${ver.stdout}${ver.stderr}`)) fail('verify exited non-zero without naming CONTAMINATION');

  // ---- 2. the documented limit of the append probe, measured rather than asserted
  // Phase 1 seeded one `dispatch_offers` row with `created_at = now()`. Drop it and re-baseline, so
  // what follows is a table whose only row is written with the SOURCE row's old timestamp.
  const bulk = APPEND_PROBED[0];
  await client.query(`DELETE FROM ${A}.${bulk.table}`);
  const re = guard(A, 'snapshot');
  if (re.status !== 0) fail(`re-baseline on ${A} failed (exit ${re.status})`);
  const backdated = await insertTemplate(client, 'public', bulk.table, A);
  const afterBackdated = guard(A, 'diff');
  const bulkMoved = String(afterBackdated.stdout).split(/\r?\n/).filter((l) => l.includes(`${A}.${bulk.table}:`));
  const exact = (await client.query(
    `SELECT count(*)::int n FROM ${A}.${bulk.table}`)).rows[0].n;
  console.log(`  append-probe limit: 1 ${bulk.table} row inserted with a pre-baseline ${bulk.column} `
    + `(${backdated.rowCount} row, ${exact} row(s) really in the table) -> diff reports `
    + `${bulkMoved.length ? `DRIFT (${bulkMoved[0].trim()})` : 'NO drift'}`);
  if (bulkMoved.length) {
    console.log('    UNEXPECTED: the probe asserted this row would be INVISIBLE to a timestamp probe; it was counted anyway');
  } else {
    // The same row, deleted, is equally invisible. The whole-run census counts rows exactly and is what
    // closes both holes, which is why the two guards are complementary rather than redundant.
    await client.query(`DELETE FROM ${A}.${bulk.table}`);
    const afterDelete = guard(A, 'diff');
    const delMoved = String(afterDelete.stdout).split(/\r?\n/).filter((l) => l.includes(`${A}.${bulk.table}:`));
    console.log(`    and deleting that row: diff reports ${delMoved.length ? `DRIFT (${delMoved[0].trim()})` : 'NO drift'} `
      + `while an exact COUNT would see both - scripts/test_store_census.js is the whole-run guard for that`);
  }

  // ---- 3. legitimate writes to the isolated target stay permitted
  const snapB = guard(A, 'snapshot');
  if (snapB.status !== 0) fail(`re-baseline on ${A} failed (exit ${snapB.status})`);
  for (const t of ADDITIONS_2026_10_15) {
    const res = await insertTemplate(client, 'public', t, B, appendColumn(t));
    if (res.rowCount !== 1) fail(`could not seed a legitimate row into ${B}.${t}`);
  }
  const verB = guard(A, 'verify');
  console.log(`  ${ADDITIONS_2026_10_15.length} row(s) written to ${B} (the stand-in clone): verify exit=${verB.status}`);
  if (verB.status !== 0) fail(`guard reddened an isolated link for writing its OWN target ${B}: ${verB.stdout}${verB.stderr}`);
  if (!/^CLEAN/m.test(String(verB.stdout).split(/\r?\n/).map((l) => l.trim()).join('\n'))) {
    fail(`guard did not report CLEAN after clone-only writes: ${verB.stdout}`);
  }

  // ---- 4. the two ways a guard can go silently blind
  const cross = guard(B, 'verify');
  if (cross.status === 0 || !/refusing to compare/.test(`${cross.stdout}${cross.stderr}`)) {
    fail(`comparing an ${A} baseline with counts from ${B} should REFUSE, got exit ${cross.status}`);
  }
  console.log(`  baseline from "${A}" compared by a guard aimed at "${B}": refused, exit=${cross.status}`);
  const empty = guard('nabin_guard_probe_absent', 'snapshot');
  if (empty.status === 0 || !/measured nothing/.test(`${empty.stdout}${empty.stderr}`)) {
    fail(`guard aimed at a schema with no protected tables should REFUSE, got exit ${empty.status}`);
  }
  console.log(`  guard aimed at a schema with no protected tables: refused, exit=${empty.status}`);

  // ---- 4b. F-C1-3: a stale inherited redirect must not be able to print CLEAN.
  //
  // Before this check the guard accepted `NABIN_GUARD_SCHEMA` on its own, so one value a proof session
  // left in a reused shell pointed the per-link hard guard at that schema for every later run: each
  // isolated link then compared row counts in a store it had no responsibility for and still read CLEAN,
  // while `public` went unguarded. Proof mode now requires the intent as well, and the refusal happens in
  // assertGuardSchema() before the guard reads the store or the baseline file — which is what the
  // byte-identical baseline below proves, rather than asserting.
  const readState = () => (fs.existsSync(STATE) ? fs.readFileSync(STATE, 'utf8') : null);
  const stateBeforeStale = readState();
  const stale = guardBare(A, 'verify');
  const staleText = `${stale.stdout}${stale.stderr}`;
  if (stale.status === 0 || !/REFUSED: NABIN_GUARD_SCHEMA=/.test(staleText)) {
    fail(`guard aimed at ${A} with no NABIN_GUARD_PROOF exited ${stale.status} instead of refusing: `
      + `${staleText.split(/\r?\n/).filter(Boolean)[0] || '(no output)'}`);
  }
  if (readState() !== stateBeforeStale) {
    fail('the refused redirect still touched .chain-scratch/snapshot.json — the refusal is not before the work');
  }
  console.log(`  stale redirect (NABIN_GUARD_SCHEMA=${A}, no proof): refused, exit=${stale.status}, `
    + 'baseline file byte-identical');
  const proofOk = guard(A, 'verify');
  if (!/PROOF MODE \(NABIN_GUARD_PROOF=1\)/.test(`${proofOk.stdout}${proofOk.stderr}`)) {
    fail('the intended proof session (schema + NABIN_GUARD_PROOF=1) was not labelled as proof mode — '
      + 'the refusal would then also block legitimate detection proofs');
  }
  console.log(`  same redirect with NABIN_GUARD_PROOF=1: allowed and labelled PROOF MODE (exit=${proofOk.status})`);

  // ---- 5. a baseline the guard cannot measure against must REFUSE, not report CLEAN
  //
  // Measured 2026-10-15 against a disposable schema, BEFORE readSnapshot() validated the file's shape:
  // a baseline with `"counts": {}` printed `CLEAN: 0 protected … tables unchanged` at exit 0, and a
  // baseline with its timestamp fields stripped printed `CLEAN: 2 …` at exit 0 while an append-probed
  // table really held one row more than its baseline. Same defect class as section 4 — a guard that
  // measures nothing still looks green — but section 4 only covers the schema, not the file. Each
  // variant below is planted against a database state whose VALID baseline reddens `verify`, so the
  // refusal proves the guard looked at the baseline and rejected it, not that nothing had moved.
  const rebase = guard(A, 'snapshot');
  if (rebase.status !== 0) fail(`case 5 baseline on ${A} failed (exit ${rebase.status})`);
  const appended = await insertTemplate(client, 'public', bulk.table, A, appendColumn(bulk.table));
  if (appended.rowCount !== 1) fail(`case 5 could not append a ${A}.${bulk.table} row (${appended.rowCount})`);
  const control = guard(A, 'verify');
  const controlText = `${control.stdout}${control.stderr}`;
  if (control.status === 0 || !/CONTAMINATION/.test(controlText)) {
    fail(`case 5 control: a VALID baseline did not redden verify on the appended ${bulk.table} row `
      + `(exit ${control.status}) - the refusals below would then prove nothing`);
  }
  console.log(`  control - valid baseline + 1 appended ${A}.${bulk.table} row: verify exit=${control.status}, CONTAMINATION`);

  const goodBaseline = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const MALFORMED_BASELINES = [
    ['counts emptied', (s) => { s.counts = {}; }],
    ['both timestamp fields stripped', (s) => { delete s.appendBaseline; delete s.at; }],
    ['a count replaced by null', (s) => { s.counts[Object.keys(s.counts)[0]] = null; }],
  ];
  for (const [label, mutate] of MALFORMED_BASELINES) {
    const broken = JSON.parse(JSON.stringify(goodBaseline));
    mutate(broken);
    fs.writeFileSync(STATE, JSON.stringify(broken));
    const refused = guard(A, 'verify');
    const text = `${refused.stdout}${refused.stderr}`;
    if (refused.status === 0 || !/guard REFUSED/.test(text)) {
      fail(`baseline with ${label} exited ${refused.status} instead of refusing: ${text.slice(0, 160)}`);
    }
    // `diff` is attribution, not enforcement: it must still exit 0 and say NO-BASELINE, because an
    // attribution gap must never redden a link that is allowed to write public.
    const attribution = guard(A, 'diff');
    if (attribution.status !== 0 || !/NO-BASELINE/.test(String(attribution.stdout))) {
      fail(`diff with ${label} should print NO-BASELINE at exit 0, got exit ${attribution.status}`);
    }
    console.log(`  baseline with ${label}: verify refused (exit=${refused.status}), `
      + `diff reported the gap at exit=${attribution.status}`);
  }
  fs.writeFileSync(STATE, JSON.stringify(goodBaseline));

  // ---- 6. F-13: the reconciler's write is a DELETE, so a DECREASE in a guarded table must redden verify
  //
  // `reconcileSessions()` is armed on a 15 s timer by every `src/server.js` process and its one store
  // mutation is `delete from backend_sessions where expires_at <= now()` (src/database.js:7373).
  // Measured 2026-10-16: booted against a disposable clone with no suite attached and nothing calling
  // reconcile, it pruned 6 expired rows 15,053 ms after it answered `/api/health`. Sections 1 and 3
  // only ever ADD rows, so without this case the hard guard's answer to F-13's exact write shape - a
  // row disappearing from the guarded schema from no test's action - would be unmeasured.
  const delTable = 'backend_sessions';
  const snap6 = guard(A, 'snapshot');
  if (snap6.status !== 0) fail(`case 6 baseline on ${A} failed (exit ${snap6.status})`);
  const beforeCount = (await client.query(`SELECT count(*)::int n FROM ${A}.${delTable}`)).rows[0].n;
  if (beforeCount < 1) fail(`case 6 needs a row in ${A}.${delTable} to delete; baseline counted ${beforeCount} `
    + `- a delete-to-zero on an empty table would prove nothing`);
  const del6 = await client.query(
    `DELETE FROM ${A}.${delTable} WHERE token_hash = (SELECT token_hash FROM ${A}.${delTable} LIMIT 1)`);
  if (del6.rowCount !== 1) fail(`case 6 deleted ${del6.rowCount} row(s) from ${A}.${delTable}, expected exactly 1`);
  const ver6 = guard(A, 'verify');
  const ver6Text = `${ver6.stdout}${ver6.stderr}`;
  const line6 = ver6Text.split(/\r?\n/).find((l) => l.includes(`${A}.${delTable}:`));
  console.log(`  F-13 delete shape: 1 ${A}.${delTable} row removed with no test asking -> verify exit=${ver6.status}`
    + `${line6 ? ` (${line6.trim()})` : ''}`);
  if (ver6.status === 0) {
    fail(`verify stayed GREEN after a ${A}.${delTable} row was deleted - the hard guard does not detect the `
      + 'write reconcileSessions performs, so an isolated link could be silently contaminated by it');
  }
  if (!line6 || !/CONTAMINATION/.test(ver6Text)) fail(`verify reddened but did not name ${A}.${delTable}: ${ver6Text.slice(0, 200)}`);
  const [baseN, nowN] = line6.split(':').pop().split('->').map((s) => Number(s.trim()));
  if (!(Number.isInteger(baseN) && Number.isInteger(nowN) && nowN < baseN)) {
    fail(`verify named ${A}.${delTable} but not as a count decrease: ${line6.trim()}`);
  }
  // `diff` is the non-isolated attribution path: it must name the same decrease and still exit 0,
  // because an ordinary link is allowed to move public and the number is for the report, not the verdict.
  const diff6 = guard(A, 'diff');
  const diffLine6 = String(diff6.stdout).split(/\r?\n/).find((l) => l.startsWith(`DRIFT ${A}.${delTable}:`));
  console.log(`    the same delete through diff (attribution, not enforcement): exit=${diff6.status}`
    + `${diffLine6 ? ` (${diffLine6.trim()})` : ' (not reported)'}`);
  if (diff6.status !== 0 || !diffLine6) {
    fail(`diff should report the ${A}.${delTable} decrease at exit 0, got exit ${diff6.status}`);
  }
  // And the legitimate direction: a DELETE inside the link's OWN clone must stay CLEAN, which is
  // what the fixed lifecycle keeps true - a lane's server pruning the clone cannot redden anything.
  const snap6b = guard(A, 'snapshot');
  if (snap6b.status !== 0) fail(`case 6 re-baseline on ${A} failed (exit ${snap6b.status})`);
  const delB = await client.query(
    `DELETE FROM ${B}.${delTable} WHERE token_hash = (SELECT token_hash FROM ${B}.${delTable} LIMIT 1)`);
  if (delB.rowCount !== 1) fail(`case 6 could not delete 1 row from the stand-in clone ${B} (${delB.rowCount})`);
  const ver6b = guard(A, 'verify');
  console.log(`    the same delete inside ${B} (the stand-in clone): verify exit=${ver6b.status}`);
  if (ver6b.status !== 0) {
    fail(`guard reddened a DELETE in its own clone ${B}: ${ver6b.stdout}${ver6b.stderr}`);
  }

  console.log(`PROBE PASS: ${ADDITIONS_2026_10_15.length} newly protected table(s) reddened the hard guard, `
    + `writes to the stand-in clone stayed CLEAN, the cross-schema and empty-schema guards refuse, `
    + `a stale NABIN_GUARD_SCHEMA with no NABIN_GUARD_PROOF refuses before touching the baseline `
    + `(proof mode with both stays allowed), `
    + `${MALFORMED_BASELINES.length} malformed-baseline shapes refuse instead of reporting CLEAN, `
    + `and a ${delTable} row DELETED from the guarded schema reddens verify while the same delete inside the clone does not`);
}

async function run() {
  if (process.env.NODE_ENV === 'production') throw new Error('probe REFUSED: NODE_ENV=production');
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('probe needs DATABASE_URL (run it under scripts/with_local_target.js)');
  const host = new URL(connectionString).hostname;
  if (!LOOPBACK.test(host)) throw new Error(`probe REFUSED: PostgreSQL host ${host} is not loopback`);
  const client = new Client({ connectionString });
  await client.connect();
  // The guard has one state file, so the probe necessarily overwrites it. Whatever was there before
  // (usually nothing - a chain run cleans it up) goes back exactly as found, because a leftover
  // baseline pointing at a dropped schema would make the next `status`/`verify` read a phantom.
  const foundSnapshot = fs.existsSync(STATE) ? fs.readFileSync(STATE) : null;
  try {
    await main(client);
  } finally {
    if (foundSnapshot === null) fs.rmSync(STATE, { force: true });
    else fs.writeFileSync(STATE, foundSnapshot);
    console.log(`  teardown: ${STATE} restored to ${foundSnapshot === null ? 'absent (as found)' : 'its found contents'}`);
    for (const s of [A, B]) {
      await client.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
      const gone = (await client.query(
        `SELECT 1 FROM information_schema.schemata WHERE schema_name=$1`, [s])).rowCount;
      if (gone) console.error(`TEARDOWN FAILED: ${s} still present`);
      else console.log(`  teardown: DROP SCHEMA ${s} CASCADE, confirmed absent`);
    }
    await client.end();
  }
}

run().catch((e) => {
  console.error(`GUARD DETECTION PROBE FAILED: ${e.message}`);
  process.exitCode = 1;
});
