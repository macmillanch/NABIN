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

/** Money/integrity tables to protect. Names are verified against information_schema, never assumed. */
const PROTECTED = ['orders', 'jobs', 'payments', 'payment_sessions', 'payment_webhooks',
  'ledger_entries', 'journal_transactions', 'journal_lines', 'driver_payouts', 'wallets', 'audit_logs'];

function publicCounts() {
  const existing = psqlQuery(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('${PROTECTED.join("','")}')`
  ).split('\n').map((s) => s.trim()).filter(Boolean);
  const missing = PROTECTED.filter((t) => !existing.includes(t));
  const counts = {};
  for (const t of existing) counts[t] = Number(psqlQuery(`SELECT count(*) FROM public.${t}`).trim());
  return { counts, missing };
}

function snapshot() {
  const { counts, missing } = publicCounts();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'snapshot.json'), JSON.stringify({ at: new Date().toISOString(), counts, missing }, null, 2));
  for (const [t, n] of Object.entries(counts)) console.log(`  public.${t} = ${n}`);
  if (missing.length) console.log(`  NOTE not present in public (skipped): ${missing.join(', ')}`);
  console.log('SNAPSHOT taken');
}

function verifySnapshot() {
  const prev = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'snapshot.json'), 'utf8')).counts;
  const now = publicCounts().counts;
  const drift = Object.entries(prev).filter(([t, n]) => now[t] !== n).map(([t, n]) => [t, n, now[t]]);
  for (const [t, before, after] of drift) console.log(`  DRIFT public.${t}: ${before} -> ${after}`);
  if (drift.length) {
    console.error(`CONTAMINATION: ${drift.length} protected public table(s) changed during an isolated run - isolation FAILED`);
    process.exitCode = 1;
  } else {
    console.log(`CLEAN: ${Object.keys(prev).length} protected public tables unchanged`);
  }
}

/**
 * F-3(a): report drift since the saved snapshot WITHOUT failing anything.
 *
 * Attribution, not enforcement: the runner calls this around ordinary non-isolated links, which are
 * allowed to mutate public state legitimately. Exit code therefore stays 0 even when tables moved - only
 * the isolated link's `verify` is allowed to fail a link. Missing baseline prints a marker and still exits
 * 0, because an attribution gap must never look like a product failure.
 */
function diffSnapshot() {
  let prev;
  try {
    prev = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'snapshot.json'), 'utf8')).counts;
  } catch (e) {
    console.log('DRIFT public: NO-BASELINE');
    return;
  }
  const now = publicCounts().counts;
  const moved = Object.entries(prev).filter(([t, n]) => Number(now[t]) !== Number(n));
  for (const [t, before] of moved) {
    const after = Number(now[t]);
    console.log(`DRIFT public.${t}: ${before} -> ${after} (${after > before ? '+' : ''}${after - before})`);
  }
  if (!moved.length) console.log(`DRIFT public: CLEAN (${Object.keys(prev).length} protected tables unchanged)`);
}

function status() {
  const exists = psqlQuery(`SELECT count(*) FROM pg_namespace WHERE nspname='${SCHEMA}'`).trim() === '1';
  let rest = 'not running';
  try { rest = sh(`docker inspect -f '{{.State.Status}}' ${CHAIN_REST}`).trim(); } catch (e) { /* none */ }
  let proxy = 'unknown';
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); process.kill(s.proxyPid, 0); proxy = `running (pid ${s.proxyPid})`; }
  catch (e) { proxy = 'not running'; }
  console.log(`schema ${SCHEMA}: ${exists ? 'present' : 'absent'}`);
  console.log(`PostgREST ${CHAIN_REST}: ${rest}`);
  console.log(`proxy: ${proxy}`);
  console.log(`backend env to use: run \"node scripts/chain_scratch.js link-env\" and pass .chain-scratch/link.env to the isolated link only`);
  const existsSnap = fs.existsSync(path.join(STATE_DIR, 'snapshot.json'));
  console.log(`snapshot: ${existsSnap ? 'present' : 'none'}`);
}

function main() {
  const cmd = process.argv[2] || 'status';
  ensureNotProduction();
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
  } else if (cmd === 'status') {
    status();
  } else {
    console.error('usage: node scripts/chain_scratch.js [provision|link-env|snapshot|verify|diff|teardown|status]');
    process.exit(1);
  }
}

main();


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
