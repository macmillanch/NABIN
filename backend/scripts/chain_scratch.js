/*
 * Disposable `chain_scratch` schema for the regression chain (option 1, F3 follow-up).
 *
 * Why this exists
 * ---------------
 * The write-heavy phase suites (phase4/5/6/9/11) append rows the append-only triggers refuse to
 * delete, so running them against the durable `public` schema grows the very money data FIN15B-20
 * and IDENT-09/IDENT-10 measure - a chain that contaminates its own baselines. This clones `public`
 * into a sibling schema `chain_scratch`, serves it through a throwaway PostgREST plus a small
 * prefix/profile proxy, and redirects the backend at it. The source schema is read, never written.
 *
 * Measured before it was trusted (docs/AUTONOMOUS_BUILD_PROGRESS.md, checkpoint #49 follow-up):
 *   phase5 against the clone -> 62 PASSED / 0 FAILED; public orders/payments/sessions/ledger
 *   2730/1603/299/2272 unchanged before and after; clone -> 2731/1608/311/2277.
 *
 * Two measured facts shaped the design:
 *   1. The backend reaches the DB only through supabase-js -> PostgREST (0 direct `pg` in src/)
 *      pinned to `public` behind Kong, so isolation needs its own PostgREST and a proxy that both
 *      strips the `/rest/v1` prefix Kong normally strips and rewrites the `Accept-Profile` header
 *      supabase-js hardcodes as `public`.
 *   2. 67 RLS policies call `auth.uid()`, so the clone MUST live in the same database - a separate
 *      database would lose the auth schema. That is why this is a schema, not a DB.
 *
 * Loopback only; refuses production. Start and stop it explicitly - nothing here is automatic.
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');
const SCRATCH = path.join(BACKEND, 'scratch');
const STATE_DIR = path.join(BACKEND, '.chain-scratch');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SCHEMA = 'chain_scratch';
const DB_CONTAINER = 'supabase_db_nabin';
const REST_CONTAINER = 'supabase_rest_nabin';
const CHAIN_REST = 'nabin_chain_rest';
const CHAIN_REST_IMAGE = 'public.ecr.aws/supabase/postgrest:v16.1';
const PROXY_PORT = 54331;
const POSTGREST_HOST_PORT = 54332;
// Bulk accumulators: copying buys nothing (suites create their own rows) and would move
// 803 MB / 1.67M rows of dispatch junk on every provision.
const SKIP_COPY = "('dispatch_offers', 'audit_logs')";

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: BACKEND, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function psql(sql) {
  // backend/scratch is gitignored, so a fresh `git archive HEAD` checkout has no such directory and
  // the very first psql() write (provisionSchema step [2/4]) dies with ENOENT before startPostgrest()
  // ever creates it. Create it here — mkdirSync(recursive) only makes missing directories and never
  // touches existing files — so every temp write path is covered without assuming a pre-existing tree.
  fs.mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `_psql_${process.pid}.sql`);
  fs.writeFileSync(file, sql, 'utf8');
  sh(`docker cp "${file}" ${DB_CONTAINER}:/tmp/_psql.sql`);
  fs.rmSync(file, { force: true });
  try {
    return sh(`docker exec ${DB_CONTAINER} psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/_psql.sql`);
  } catch (e) {
    throw new Error(`psql failed:\n${String(e.stdout || '')}\n${String(e.stderr || e.message)}`);
  }
}


/** Clone `public` -> `chain_scratch`: dump, rename the schema, apply, grant the schema ACL. */
function provisionSchema() {
  console.log('[1/4] dumping public schema (schema-only)…');
  const dump = sh(`docker exec ${DB_CONTAINER} pg_dump -U postgres -d postgres --schema-only -n public`, {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  let sql = dump.toString('utf8');

  const qualified = (sql.match(/public\./g) || []).length;
  sql = sql.replace(/CREATE SCHEMA public;/g, `CREATE SCHEMA ${SCHEMA};`);
  sql = sql.replace(/public\./g, `${SCHEMA}.`);
  sql = sql.replace(/SET search_path TO 'public'/g, `SET search_path TO '${SCHEMA}'`);
  // Default ACLs are declared FOR ROLE supabase_admin, which this connection is not a member of
  // ("must be member of role supabase_admin"). They only affect future objects, so they cannot
  // clone today's schema and are dropped.
  const droppedAcls = (sql.match(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin.*$/gm) || []).length;
  sql = sql.replace(/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin.*\r?\n/gm, '');

  const left = (sql.match(/public\./g) || []).length;
  if (left !== 0) throw new Error(`schema rename left ${left} public.* references`);

  console.log(`[2/4] applying clone (${qualified} refs renamed, ${droppedAcls} supabase_admin ACLs dropped)…`);
  psql(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;\n${sql}`);

  // pg_dump omits the ACL of `public` itself, so a fresh schema has none and PostgREST answers
  // 42501 "permission denied for schema". Replicate what `public` grants, role for role.
  psql(
    `ALTER SCHEMA ${SCHEMA} OWNER TO pg_database_owner;
     GRANT USAGE ON SCHEMA ${SCHEMA} TO PUBLIC;
     GRANT USAGE ON SCHEMA ${SCHEMA} TO postgres, anon, authenticated, service_role;`
  );

  console.log('[3/4] copying reference data…');
  psql(
    `SET session_replication_role = replica;
     DO $$ DECLARE t text;
     BEGIN
       FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public'
                AND tablename NOT IN ${SKIP_COPY} ORDER BY tablename
       LOOP EXECUTE format('INSERT INTO ${SCHEMA}.%I SELECT * FROM public.%I', t, t); END LOOP;
     END $$;
     SET session_replication_role = origin;
     DO $$ DECLARE s text;
     BEGIN
       FOR s IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'
       LOOP EXECUTE format('SELECT setval(%L, (SELECT last_value FROM public.%I), (SELECT is_called FROM public.%I))',
                           '${SCHEMA}.'||s, s, s); END LOOP;
     END $$;`
  );

  const objects = psqlQuery(
    `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='${SCHEMA}') || '/' ||
            (SELECT count(*) FROM pg_policies WHERE schemaname='${SCHEMA}') || '/' ||
            (SELECT count(*) FROM information_schema.triggers WHERE trigger_schema='${SCHEMA}')`
  ).trim();
  const counts = psqlQuery(
    `SELECT (SELECT count(*) FROM ${SCHEMA}.users) || '/' ||
            (SELECT count(*) FROM ${SCHEMA}.orders) || '/' ||
            (SELECT count(*) FROM ${SCHEMA}.ledger_entries)`
  ).trim();
  console.log(`    clone tables/policies/triggers = ${objects}   users/orders/ledger = ${counts}`);
  return { objects, counts, renamedRefs: qualified };
}

/** Mirror the real PostgREST's config, pointed at the clone, and publish it on 54332. */
function startPostgrest() {
  console.log('[4/4] starting throwaway PostgREST + prefix/profile proxy…');
  try { sh(`docker rm -f ${CHAIN_REST}`); } catch (e) { /* not running */ }

  const restEnv = sh(`docker inspect ${REST_CONTAINER} --format "{{range .Config.Env}}{{println .}}{{end}}"`);
  const jwt = (restEnv.split('\n').find((l) => l.startsWith('PGRST_JWT_SECRET=')) || '')
    .replace('PGRST_JWT_SECRET=', '').trim();
  if (!jwt) throw new Error('could not read PGRST_JWT_SECRET from the real PostgREST container');

  const envFile = path.join(SCRATCH, 'chain_rest.env');
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(envFile, [
    `PGRST_DB_URI=postgresql://authenticator:postgres@${DB_CONTAINER}:5432/postgres`,
    `PGRST_DB_SCHEMA=${SCHEMA}`,
    `PGRST_DB_SCHEMAS=${SCHEMA}`,
    'PGRST_DB_ANON_ROLE=anon',
    `PGRST_DB_EXTRA_SEARCH_PATH=${SCHEMA},extensions`,
    'PGRST_DB_MAX_ROWS=1000',
    `PGRST_JWT_SECRET=${jwt}`
  ].join('\n') + '\n', 'utf8');

  sh(`docker run -d --name ${CHAIN_REST} --network supabase_network_nabin `
     + `-p ${POSTGREST_HOST_PORT}:3000 --env-file "${envFile}" ${CHAIN_REST_IMAGE}`);

  for (let i = 0; i < 20; i++) {
    const logs = sh(`docker logs ${CHAIN_REST} 2>&1`) || '';
    if (logs.includes('Schema cache loaded')) break;
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 500"');
  }
  const logs = sh(`docker logs ${CHAIN_REST} 2>&1`);
  const rels = (logs.match(/Schema cache loaded (\d+) Relations/) || [])[1] || '?';
  if (rels === '?') throw new Error(`PostgREST did not load a schema cache:\n${logs}`);
  console.log(`    PostgREST loaded ${rels} relations from ${SCHEMA}`);

  const proxyErrFile = path.join(SCRATCH, 'chain_proxy.err');
  const errFd = fs.openSync(proxyErrFile, 'w');
  const proxy = spawn(process.execPath, [path.join(__dirname, 'chain_scratch_proxy.js')], {
    cwd: BACKEND, detached: true, stdio: ['ignore', errFd, errFd],
    env: { ...process.env, FC_PROXY_PORT: String(PROXY_PORT), FC_POSTGREST_PORT: String(POSTGREST_HOST_PORT), FC_PROFILE_SCHEMA: SCHEMA }
  });
  proxy.unref();

  // A spawn succeeding proves nothing: if the port is already held (a leftover proxy), the child
  // exits within milliseconds with EADDRINUSE and the backend would silently talk to a stranger.
  // Verify liveness here so provision fails loudly instead of handing back a dead SUPABASE_URL.
  const startedAt = Date.now();
  let alive = true;
  while (Date.now() - startedAt < 3000) {
    try { process.kill(proxy.pid, 0); } catch (e) { alive = false; break; }
    execSync('powershell -NoProfile -Command "Start-Sleep -Milliseconds 500"');
  }
  const errText = (() => { try { return fs.readFileSync(proxyErrFile, 'utf8'); } catch (e) { return ''; } })();
  fs.closeSync(errFd);
  if (!alive) {
    fs.writeFileSync(STATE_FILE + '.failed', JSON.stringify({ proxyPid: proxy.pid }, null, 2));
    throw new Error(`chain-scratch proxy exited immediately on :${PROXY_PORT} - is another proxy holding it?\n${errText}`);
  }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ proxyPid: proxy.pid, schema: SCHEMA, chainRest: CHAIN_REST }, null, 2));
  console.log(`    proxy pid ${proxy.pid} on 127.0.0.1:${PROXY_PORT} (SUPABASE_URL for the harness)`);
  return { supabaseUrl: `http://127.0.0.1:${PROXY_PORT}`, proxyPid: proxy.pid };
}

function teardown() {
  console.log('teardown: removing chain-scratch artifacts (source schema is never touched)…');
  let state = null;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { /* no state */ }

  if (state && state.proxyPid) {
    try { process.kill(state.proxyPid); console.log(`  stopped proxy pid ${state.proxyPid}`); } catch (e) { console.log('  proxy already stopped'); }
  }
  try { sh(`docker rm -f ${CHAIN_REST}`); console.log(`  removed container ${CHAIN_REST}`); } catch (e) { console.log('  container not running'); }

  const exists = psqlQuery(`SELECT count(*) FROM pg_namespace WHERE nspname='${SCHEMA}'`).trim();
  if (exists === '1') {
    psql(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE;`);
    console.log(`  dropped schema ${SCHEMA}`);
  } else {
    console.log(`  schema ${SCHEMA} not present`);
  }
  fs.rmSync(STATE_FILE, { force: true });
  // link.env holds a real database password and snapshot.json records table sizes; neither should
  // outlive the run that needed them. (Measured: a stale link.env sat in .chain-scratch/ after a chain
  // run until this was added.)
  fs.rmSync(path.join(STATE_DIR, 'link.env'), { force: true });
  fs.rmSync(path.join(STATE_DIR, 'snapshot.json'), { force: true });
  console.log('  removed link.env + snapshot.json (no credential left on disk)');
}

/**
 * Direct-`pg` isolation (F3 owner decision).
 *
 * PostgREST redirection alone is not enough: write-heavy suites also open their own `pg` connection via
 * DATABASE_URL, and a default `search_path` resolves those unqualified table names to `public`. The
 * chosen mechanism is a per-LINK connection option - `options=-c search_path=chain_scratch` - rather than
 * ALTER ROLE / ALTER DATABASE, so nothing shared is reconfigured and no state survives teardown; only a
 * process that is handed this URL is scoped to the clone.
 *
 * The base URL is READ FROM THE ENVIRONMENT, never reconstructed here, so credentials/host are whatever
 * the project already uses. The result is written to a gitignored file and only a masked form is printed,
 * because this value carries a password and chain logs must not accumulate secrets.
 */
function realDbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim();
  const envFile = path.join(BACKEND, '.env');
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL\s*=\s*(.*)$/);
      if (m) return m[1].trim().replace(/^"(.*)"$/, '$1');
    }
  }
  throw new Error('cannot determine the real DATABASE_URL (not in env, not in backend/.env) - refusing to guess a connection target');
}

function isolatedDbUrl() {
  const base = realDbUrl();
  const opt = 'options=-c%20search_path%3Dchain_scratch';
  return base.includes('?') ? `${base}&${opt}` : `${base}?${opt}`;
}

function mask(url) {
  return url.replace(/:\/\/([^:/]+):[^@]*@/, '://$1:***@');
}

function writeLinkEnv() {
  const file = path.join(STATE_DIR, 'link.env');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(file, `SUPABASE_URL=http://127.0.0.1:${PROXY_PORT}\nDATABASE_URL=${isolatedDbUrl()}\n`, 'utf8');
  console.log(`wrote ${file}`);
  console.log(`  SUPABASE_URL=http://127.0.0.1:${PROXY_PORT}`);
  console.log(`  DATABASE_URL=${mask(isolatedDbUrl())}  (password withheld; the file holds the real value)`);
  return file;
}

/**
 * Tables an isolated link must not be able to move in the guarded schema.
 *
 * The list lives in `scripts/protected_tables.js` — the same module `scripts/test_store_census.js`
 * reads — so a census line that moves an uncovered name can be REPORTED as uncovered instead of
 * being a human inference. #329 widened it twice: first to the identity/catalogue/restaurant names a
 * link could restyle, then to the ten tables the 2026-10-15 census saw move with no per-link owner
 * (dispatch offers, backend sessions, drivers, notifications, notification deliveries, admin
 * accounts, refund authorizations and the promotion pair).
 *
 * Bulk accumulators are guarded by an append probe rather than a full COUNT, and the difference in
 * what each proves is written out in that module's comment. Detection is proven without touching
 * `public`: point NABIN_GUARD_SCHEMA at a disposable schema (see GUARD_SCHEMA below).
 *
 * Names are verified against information_schema before they are counted, never assumed to exist.
 */
const { PROTECTED, APPEND_PROBED } = require('./protected_tables');

// Which schema the guard reads. `public` in a real run; a proof run names a throwaway schema so
// detection can be demonstrated by writing there. This cannot redirect the guard off the local
// stack: every read below goes through `psqlQuery`, which execs into DB_CONTAINER, so the only
// degrees of freedom are the schema name and the table names, and both are validated.
const GUARD_SCHEMA = process.env.NABIN_GUARD_SCHEMA || 'public';
const SCHEMA_IDENT = /^[a-z_][a-z0-9_]*$/i;

function assertGuardSchema() {
  if (!SCHEMA_IDENT.test(GUARD_SCHEMA)) {
    console.error(`REFUSED: NABIN_GUARD_SCHEMA=${JSON.stringify(GUARD_SCHEMA)} is not a plain identifier`);
    process.exit(1);
  }
  if (GUARD_SCHEMA !== 'public') {
    // F-C1-3: a redirect must be stated TWICE — the schema it names and the intent to be in proof mode.
    // Both runners hand `process.env` straight to their children, so one value left in a reused shell by a
    // proof session re-aimed the per-link hard guard at that schema and the link still read CLEAN against a
    // store the run was never responsible for. The single declaration this file used to trust is the defect.
    if (process.env.NABIN_GUARD_PROOF !== '1') {
      console.error(`REFUSED: NABIN_GUARD_SCHEMA=${GUARD_SCHEMA} moves the hard guard off \`public\` while `
        + 'NABIN_GUARD_PROOF is not 1. An inherited value from an earlier proof session redirects the guard '
        + 'silently, which is what this refusal closes. Set NABIN_GUARD_PROOF=1 when the redirect is intended '
        + '(scripts/guard_detection_probe.js does), or unset NABIN_GUARD_SCHEMA to guard public.');
      process.exit(1);
    }
    console.log(`⚠ GUARD SCHEMA = ${GUARD_SCHEMA} — PROOF MODE (NABIN_GUARD_PROOF=1), this is NOT the shared \`public\` store`);
  }
}

// The baseline is taken from the database clock, never this process's: a host/container skew of even
// a second would either invent appended rows or hide real ones.
function dbNow() {
  return psqlQuery(`SELECT now()`).trim();
}

function safeStamp(iso) {
  return String(iso || '').replace(/[^0-9T:+. -]/g, '');
}

// Two docker/psql invocations per snapshot for the exact names regardless of list length: one to
// find which protected names actually exist, one to count them all in a single UNION ALL. The
// per-table loop this replaces cost one round-trip per name. Append probes cost one indexed COUNT
// each, against the baseline timestamp.
function publicCounts(appendBaseline) {
  const allNames = [...PROTECTED, ...APPEND_PROBED.map((p) => p.table)];
  const list = allNames.map((t) => `'${t}'`).join(',');
  const existing = psqlQuery(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='${GUARD_SCHEMA}' AND table_name IN (${list}) ORDER BY 1`
  ).split('\n').map((s) => s.trim()).filter(Boolean);
  const missing = allNames.filter((t) => !existing.includes(t));
  if (!existing.length) {
    // A guard that counted nothing still reports "CLEAN, 0 tables unchanged" unless it refuses here,
    // and a proof run aimed at a schema that does not exist looks exactly like a passing isolation
    // check. Measured 2026-10-15: NABIN_GUARD_SCHEMA pointing at a missing schema produced an empty
    // baseline and exit 0. Names legitimately absent (today: `wallets`) are still a NOTE, not a
    // refusal - only "not one protected name exists where you told me to look" is fatal.
    throw new Error(`guard REFUSED: no protected table exists in ${GUARD_SCHEMA} - `
      + 'the guard would have measured nothing');
  }
  const counts = {};
  const exact = existing.filter((t) => PROTECTED.includes(t));
  if (exact.length) {
    const query = exact
      .map((t) => `SELECT '${t}' t, count(*) n FROM ${GUARD_SCHEMA}.${t}`)
      .join(' UNION ALL ');
    for (const line of psqlQuery(query).split('\n')) {
      const m = /^([a-z_][a-z0-9_]*)\|(\d+)$/.exec(line.trim());
      if (m) counts[m[1]] = Number(m[2]);
    }
  }
  const at = safeStamp(appendBaseline) || dbNow();
  for (const probe of APPEND_PROBED) {
    if (!existing.includes(probe.table)) continue;
    const n = psqlQuery(
      `SELECT count(*) FROM ${GUARD_SCHEMA}.${probe.table} WHERE ${probe.column} > '${at}'`).trim();
    if (!/^\d+$/.test(n)) throw new Error(`append probe returned "${n}" for ${GUARD_SCHEMA}.${probe.table}`);
    counts[probe.table] = Number(n);
  }
  // A silent gap between the names asked for and the names answered would make the guard look
  // satisfied while it measured nothing.
  const unanswered = existing.filter((t) => !(t in counts));
  if (unanswered.length) throw new Error(`protected count missing for: ${unanswered.join(', ')}`);
  return { counts, missing, at };
}

function snapshot() {
  const at = dbNow();
  const { counts, missing } = publicCounts(at);
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'snapshot.json'),
    JSON.stringify({ at, appendBaseline: at, schema: GUARD_SCHEMA, counts, missing }, null, 2));
  for (const [t, n] of Object.entries(counts)) console.log(`  ${GUARD_SCHEMA}.${t} = ${n}`);
  if (missing.length) console.log(`  NOTE not present in ${GUARD_SCHEMA} (skipped): ${missing.join(', ')}`);
  const appended = APPEND_PROBED.map((p) => p.table).filter((t) => t in counts);
  if (appended.length) {
    console.log(`  NOTE ${appended.join(', ')} counted as rows created after ${at} (db clock), not absolute counts`);
  }
  console.log('SNAPSHOT taken');
}

/**
 * F-C1-5: drop the attribution baseline and nothing else.
 *
 * `snapshot()` writes to one fixed path, `.chain-scratch/snapshot.json`, so the file cannot tell a run
 * that is in flight from a run that ended — and `guard_detection_probe.js` refuses the second as if it
 * were the first (measured 2026-10-16: chain_20261016_080137_15108_4f72a0 exited 0 at 08:02:10 and left
 * a `public` baseline that was still refusing the probe at 09:44). The runner now calls this on its way
 * out. Deliberately narrower than teardown(): no container is removed, no schema is dropped, no proxy is
 * signalled, because those are legitimately reused across runs while the baseline never is.
 */
function dropBaseline() {
  const file = path.join(STATE_DIR, 'snapshot.json');
  let was = null;
  try { was = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).schema : null; }
  catch (e) { was = 'unreadable'; }
  fs.rmSync(file, { force: true });
  console.log(`baseline: ${was ? `removed (was a ${was} baseline)` : 'absent'} - ${path.relative(process.cwd(), file)}`);
}

function readSnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'snapshot.json'), 'utf8'));
  if (prev.schema !== GUARD_SCHEMA) {
    throw new Error(`snapshot was taken against schema ${JSON.stringify(prev.schema)}, guard now points at `
      + `${JSON.stringify(GUARD_SCHEMA)} — refusing to compare counts from two different schemas`);
  }
  // A baseline that parses is not therefore a baseline that measures. `verify` and `diff` both iterate
  // `prev.counts`, so an empty or unreadable counts object makes them compare nothing and print CLEAN -
  // the same failure mode publicCounts() refuses at source (see "no protected table exists" above),
  // reached from the other direction: a state file truncated, hand-edited, or written by an older tool.
  // Measured 2026-10-15 against a disposable schema BEFORE this check existed: `counts:{}` gave
  // `CLEAN: 0 protected … tables unchanged` exit 0, and a baseline with no timestamp field gave
  // `CLEAN: 2 …` exit 0 while an append-probed table really held one row more - losing `at` re-baselines
  // the append probe at verification time, which makes every append during the link invisible to it.
  if (!prev || typeof prev.counts !== 'object' || Array.isArray(prev.counts) || !Object.keys(prev.counts).length) {
    throw new Error(`guard REFUSED: snapshot.json carries no usable counts baseline `
      + `(${prev && prev.counts === undefined ? 'field missing' : JSON.stringify(prev.counts)}) - `
      + 'verify would compare nothing and report CLEAN');
  }
  for (const [t, n] of Object.entries(prev.counts)) {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`guard REFUSED: snapshot baseline for ${GUARD_SCHEMA}.${t} is ${JSON.stringify(n)}, `
        + 'not a non-negative integer count');
    }
  }
  const stamp = prev.appendBaseline || prev.at;
  if (typeof stamp !== 'string' || !safeStamp(stamp)) {
    throw new Error(`guard REFUSED: snapshot baseline has no usable timestamp (at=${JSON.stringify(prev.at)}, `
      + `appendBaseline=${JSON.stringify(prev.appendBaseline)}) - the append probe would count rows created `
      + 'after the moment of verification, i.e. nothing, and read a real append as CLEAN');
  }
  return prev;
}

function verifySnapshot() {
  const prev = readSnapshot();
  const { counts: now, missing } = publicCounts(prev.appendBaseline || prev.at);
  const drift = Object.entries(prev.counts).filter(([t, n]) => now[t] !== n).map(([t, n]) => [t, n, now[t]]);
  for (const [t, before, after] of drift) console.log(`  DRIFT ${GUARD_SCHEMA}.${t}: ${before} -> ${after}`);
  if (drift.length) {
    console.error(`CONTAMINATION: ${drift.length} protected ${GUARD_SCHEMA} table(s) changed during an isolated run - isolation FAILED`);
    process.exitCode = 1;
  } else {
    const note = missing.length ? ` (${missing.length} protected name(s) not in ${GUARD_SCHEMA}: ${missing.join(', ')})` : '';
    console.log(`CLEAN: ${Object.keys(prev.counts).length} protected ${GUARD_SCHEMA} tables unchanged${note}`);
  }
}

/**
 * F-3(a): report drift since the saved snapshot WITHOUT failing anything.
 *
 * Attribution, not enforcement: the runner calls this around ordinary non-isolated links, which are
 * allowed to mutate public state legitimately. Exit code therefore stays 0 even when tables moved - only
 * the isolated link's `verify` is allowed to fail a link. Missing baseline prints a marker and still exits
 * 0, because an attribution gap must never look like a product failure.
 *
 * For an append-probed table the numbers are "rows created since this link's baseline", so a
 * `0 -> 1741` line attributes 1,741 writes to exactly the one link that ran between the two counts.
 */
function diffSnapshot() {
  let prev;
  try {
    prev = readSnapshot();
  } catch (e) {
    console.log(`DRIFT ${GUARD_SCHEMA}: NO-BASELINE`);
    if (e.code !== 'ENOENT') console.error(`diff baseline unusable: ${e.message}`);
    return;
  }
  const now = publicCounts(prev.appendBaseline || prev.at).counts;
  const moved = Object.entries(prev.counts).filter(([t, n]) => Number(now[t]) !== Number(n));
  for (const [t, before] of moved) {
    const after = Number(now[t]);
    console.log(`DRIFT ${GUARD_SCHEMA}.${t}: ${before} -> ${after} (${after > before ? '+' : ''}${after - before})`);
  }
  if (!moved.length) console.log(`DRIFT ${GUARD_SCHEMA}: CLEAN (${Object.keys(prev.counts).length} protected tables unchanged)`);
}

function status() {
  const exists = psqlQuery(`SELECT count(*) FROM pg_namespace WHERE nspname='${SCHEMA}'`).trim() === '1';
  let rest = 'not running';
  try { rest = sh(`docker inspect -f '{{.State.Status}}' ${CHAIN_REST}`).trim(); } catch (e) { /* none */ }
  let proxy = 'unknown';
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); process.kill(s.proxyPid, 0); proxy = `running (pid ${s.proxyPid})`; }
  catch (e) { proxy = 'not running'; }
  console.log(`schema ${SCHEMA}: ${exists ? 'present' : 'absent'}`);
  console.log(`guard schema: ${GUARD_SCHEMA}${GUARD_SCHEMA === 'public' ? '' : ' (PROOF MODE — NABIN_GUARD_SCHEMA)'}`);
  console.log(`PostgREST ${CHAIN_REST}: ${rest}`);
  console.log(`proxy: ${proxy}`);
  console.log(`backend env to use: run \"node scripts/chain_scratch.js link-env\" and pass .chain-scratch/link.env to the isolated link only`);
  const existsSnap = fs.existsSync(path.join(STATE_DIR, 'snapshot.json'));
  console.log(`snapshot: ${existsSnap ? 'present' : 'none'}`);
}

function main() {
  const cmd = process.argv[2] || 'status';
  ensureNotProduction();
  assertGuardSchema();
  if (cmd === 'provision') {
    const a = provisionSchema();
    const b = startPostgrest();
    console.log(`\nPROVISIONED. Set SUPABASE_URL=${b.supabaseUrl} for the backend/harness.`);
    console.log(`Verify isolation before trusting it, then run: node scripts/chain_scratch.js teardown`);
    void a;
  } else if (cmd === 'teardown') {
    teardown();
  } else if (cmd === 'link-env') {
    writeLinkEnv();
  } else if (cmd === 'snapshot') {
    snapshot();
  } else if (cmd === 'verify') {
    verifySnapshot();
  } else if (cmd === 'diff') {
    diffSnapshot();
  } else if (cmd === 'drop-baseline') {
    dropBaseline();
  } else if (cmd === 'status') {
    status();
  } else {
    console.error('usage: node scripts/chain_scratch.js [provision|link-env|snapshot|verify|diff|drop-baseline|teardown|status]');
    process.exit(1);
  }
}

// A guard that cannot answer is worse than a guard that answers "dirty", because silence looks like
// a pass. Every throw below (missing baseline schema, an uncountable protected set, a psql failure)
// becomes one labelled line on stderr so the runner's contamination extract has something to name,
// and the exit code is non-zero: an isolated link whose guard broke is refused, not waved through.
try {
  main();
} catch (e) {
  console.error(`GUARD ERROR: ${e.message}`);
  process.exit(1);
}


function psqlQuery(sql) {
  // Must be one line: PowerShell's -c "…" swallows embedded newlines and truncates the query.
  const oneLine = sql.replace(/\s+/g, ' ').trim();
  return sh(`docker exec ${DB_CONTAINER} psql -U postgres -t -A -c "${oneLine.replace(/"/g, '\\"')}"`);
}

function ensureNotProduction() {
  if (process.env.NODE_ENV === 'production') {
    console.error('REFUSED: chain-scratch must never run with NODE_ENV=production.');
    process.exit(1);
  }
}
