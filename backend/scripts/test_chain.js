/**
 * LOCAL/TEST regression chain runner.
 *
 * Why this exists
 * ---------------
 * `npm test` was a shell one-liner of `node a.js && node b.js && …`. Twenty of those links talk
 * HTTP to a backend on `:4000`, and none of them started one, so the chain only worked if a
 * server happened to already be listening. For a long time one did — by accident.
 * `restart_test.js` used to resolve the owner of `:4000`, `Stop-Process` it, and leave its own
 * detached replacement bound to that port. The suites after it then silently rode on that
 * orphan, which is how a green 21/21 chain came to depend on a leaked process (recorded in
 * TASKS.md: "`restart_test.js` leaves its replacement `:4000` server running, so a second chain
 * run must clear that port first"). Once that leak was fixed — correctly, by making the suite
 * own and reap its own children — the ports went quiet and the downstream links began failing
 * with `ECONNREFUSED 127.0.0.1:4000`, which had been mis-read as OTP throttling.
 *
 * The two states are mutually exclusive under the old design: with a server on `:4000`,
 * `restart_test.js` refuses to run because it cannot own the port it restarts; without one,
 * everything else fails to connect. Neither is a product defect. This runner removes the
 * ambiguity by owning the harness lifecycle explicitly:
 *
 *   1. boot ONE shared backend on a port this runner chooses and tracks,
 *   2. wait until it actually answers `/api/health` (never assume a bind),
 *   3. hand every link the base URL, so no link guesses where the backend is,
 *   4. give `restart_test.js` its own free private port so it can restart a server it owns
 *      without touching the shared one,
 *   5. reap the harness by the pid it started (never by port lookup), and prove the port is
 *      released before exiting.
 *
 * Links run sequentially and every link runs even after one fails, so one run reports the whole
 * matrix instead of stopping at the first red and hiding the rest. Exit code is the authority;
 * the `[FAIL]` line count is printed alongside as a cross-check, because a suite that exits 0
 * while printing failures is exactly the kind of lie this gate exists to catch.
 *
 * Fail-closed
 * -----------
 * Refuses `NODE_ENV=production`. Refuses a non-loopback harness port. Refuses to run against a
 * remote `DATABASE_URL`/`SUPABASE_URL` unless `NABIN_ALLOW_REMOTE_TESTS=1` is set deliberately.
 * Starts no production server and applies no migration. Nothing here changes OTP throttling,
 * authentication, or any assertion; it only decides where the test backend lives and makes sure
 * the process it started is the process it stops.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn, spawnSync, execFile } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const LOG_DIR = path.join(BACKEND, '.chain-logs');

// Must match the values the suites default to inside their own processes
// (`restart_test.js`, `test_suite.js`, `driver_earnings_test.js`), otherwise the webhook
// signature checks fail closed with WEBHOOK_NOT_CONFIGURED and MODULE 18 reddens for a
// harness reason rather than a product one. Test-only values; never a deployed secret.
const TEST_WEBHOOK_SECRET = 'test_webhook_secret_not_for_deployment';
const TEST_KEY_SECRET = 'test_key_secret_not_for_deployment';

const HARNESS_HOST = '127.0.0.1';
const HARNESS_PORT = Number(process.env.NABIN_HARNESS_PORT || 4000);

/**
 * The chain, in order. `privatePort: true` marks the link that must own and restart its own
 * backend process; the runner allocates it a free port so it never collides with the shared
 * harness it would otherwise kill.
 */
const LINKS = [
  { file: 'test_suite.js' },
  { file: 'session_reconcile_pagination_test.js' },
  { file: 'boot_mirror_read_test.js' },
  { file: 'geo_policy_test.js' },
  { file: 'geo_adversarial_test.js' },
  { file: 'geo_anon_access_test.js' },
  { file: 'restart_test.js', privatePort: true },
  { file: 'auth_failclosed_test.js' },
  { file: 'checkout_store_semantics_test.js' },
  { file: 'hydration_fallback_test.js' },
  { file: 'campaign_outage_test.js' },
  { file: 'test_phase7_security.js' },
  { file: 'admin_identity_gates_test.js' },
  { file: 'admin_authorization_test.js' },
  { file: 'admin_customers_test.js' },
  { file: 'admin_settings_surface_test.js' },
  { file: 'admin_audit_fail_closed_test.js' },
  { file: 'customer_activity_test.js' },
  { file: 'driver_earnings_test.js' },
  { file: 'driver_operations_test.js' },
  { file: 'merchant_operations_test.js' },
  { file: 'money_idempotency_test.js' },
  // Phase 14: cash-ride and driver-obligation audit. Books one real ride and
  // cancels it; the remainder are reads of schema, settings and function
  // definitions that pin which cash capabilities deliberately do NOT exist.
  { file: 'cash_ride_audit_test.js' },
  // Phase 15B: financial authority evidence. Reads PostgreSQL's own catalogs and
  // its only mutation probe runs inside a rolled-back transaction, so it leaves
  // no ledger residue; it is deliberately last so an authority change is heard
  // here before anywhere else.
  { file: 'financial_authority_test.js' },
  // Phase 18: driver-earnings identity audit. Reads PostgreSQL's catalogs and the
  // source of the two earnings call sites; its only mutation runs inside a
  // rolled-back transaction, so it leaves no journal residue.
  { file: 'driver_earnings_identity_audit_test.js' },
  // Phase 34: a driver earnings credit must survive a cold cache. This path hydrates
  // the same mirror links 19/20 read, so it stays durable-money asserting.
  { file: 'driver_cache_miss_test.js' },
  // Phase 38: the earnings read must report durable PostgreSQL state, and the read fix must
  // stay inert with respect to money (no journal, no wallet write).
  { file: 'driver_earnings_durable_read_test.js' },
  // Phase 41: a provisioned administrator must be revocable. PostgREST truncation of a
  // whole-table read made ADMIN_NOT_ENROLLED fire on a real, enabled, sign-in-capable account.
  { file: 'admin_account_revocability_test.js' },
  // E2: a reused idempotency key must be compared, not absorbed. Conflicting reuse is refused as
  // IDEMPOTENCY_CONFLICT with no movement, concurrently as well as sequentially.
  { file: 'money_idempotency_conflict_test.js' },
  // T1: an admin identity decision must be taken on the complete directory, never on PostgREST's
  // first 1000 rows, and both failure modes must fail closed with their established codes.
  { file: 'admin_directory_completeness_test.js' },
  // E3: bounty money and ticket state commit separately; these durable-state checks prove the
  // crash/retry path converges to exactly one posting and never reports a false resolution.
  { file: 'support_bounty_atomicity_test.js' },
  // F1: /api/admin/finance/metrics must be computed from the durable ledger, not the
  // process-local seed arrays; its eight-key contract is asserted too.
  { file: 'finance_metrics_authority_test.js' },
  // F3: the settlement screen must enumerate the durable drivers table and report durable
  // wallet balances — previously a post-boot driver was invisible to it entirely, and a
  // balance could be stale by anything another process moved.
  { file: 'finance_driver_settlements_authority_test.js' },
  // F5: /api/admin/finance/ledger-double-entry must answer from the durable journal. It used to
  // return the boot-time ledgerEntries projection - 500 of 5,747 headers - while its name
  // advertised double-entry authority.
  { file: 'finance_ledger_double_entry_authority_test.js' },
  // F4: the admin payout route must address the driver the caller named and derive the
  // full-balance default from the durable wallet. `getDriver()` never returned null, so an
  // unknown id was answered with a DIFFERENT real driver, and the default amount came from
  // the process mirror.
  { file: 'finance_driver_payout_authority_test.js' },
  // Finance sweep: the admin refund route must size an omitted `amount` from the durable
  // refundable balance (payments.amount - payments.refunded_amount), refuse over-requests with
  // zero movement, and classify a key reused with different semantics as IDEMPOTENCY_CONFLICT/409.
  { file: 'finance_refund_amount_authority_test.js' },
  // F4 follow-up: the payout route must answer that same conflict as 409 rather than 503
  // "outcome unknown", while keeping exactly-once money movement.
  { file: 'payout_idempotency_conflict_route_test.js' },
  // DS-2 dark store foundation: schema invariants, repository/service ownership rules and the
  // duplicate reservation-idempotency proof, against disposable local fixtures.
  { file: 'dark_store_foundation_test.js' },
  // DS-2 closure: the admin dark-store HTTP surface (authentication, merchant.manage
  // permission, lifecycle, ownership and id-substitution rejection) plus RLS behaviour observed
  // through the real anon / authenticated / service_role database roles.
  { file: 'dark_store_routes_rls_test.js' }
];

// ---------------------------------------------------------------- environment gate

function isLoopback(url) {
  try {
    return /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

function refuseReason() {
  if (process.env.NODE_ENV === 'production') {
    return 'NODE_ENV=production — this is a local regression harness and refuses to run there';
  }
  if (!isLoopback(`http://${HARNESS_HOST}:${HARNESS_PORT}`)) {
    return `harness host ${HARNESS_HOST} is not loopback`;
  }
  return null;
}

/**
 * The suites read and write fixture rows, so pointing them at a hosted project is how a
 * "regression run" becomes an incident. Loopback is fine; anything else needs an explicit flag.
 */
function remoteStoreWarning(env) {
  if (env.NABIN_ALLOW_REMOTE_TESTS === '1') return null;
  const remote = ['DATABASE_URL', 'SUPABASE_URL'].filter((key) => env[key] && !isLoopback(env[key]));
  if (remote.length === 0) return null;
  return `${remote.join(' and ')} point at a non-loopback host — refusing to run the chain `
    + 'against it. Set NABIN_ALLOW_REMOTE_TESTS=1 only if that store is an approved test '
    + 'environment and you intend it.';
}

// ---------------------------------------------------------------- small async helpers

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HARNESS_HOST, port: HARNESS_PORT, path: urlPath, method: 'GET', timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body) });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

/** True when something is already bound. Used to refuse, and to prove release. */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = net.connect({ host: HARNESS_HOST, port });
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
    probe.setTimeout(700, () => { probe.destroy(); resolve(false); });
  });
}

async function findFreePort(start) {
  for (let port = start; port < start + 100; port++) {
    if (!(await portInUse(port))) return port;
  }
  throw new Error(`no free port found in ${start}..${start + 99}`);
}

// ---------------------------------------------------------------- harness lifecycle

let harnessProc = null;
let stoppingHarness = false;

async function startHarness(env) {
  if (await portInUse(HARNESS_PORT)) {
    // Reusing a server we did not start is the exact contamination this runner exists to
    // remove: its env, its in-memory rate-limit counters, and its lifetime are unknown here.
    throw new Error(
      `port ${HARNESS_PORT} is already bound. Stop the manually-started backend first `
      + `(this runner will not kill a process it did not start), or choose NABIN_HARNESS_PORT.`
    );
  }

  harnessProc = spawn(process.execPath, [path.join(BACKEND, 'src/server.js')], {
    cwd: BACKEND,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...env, PORT: String(HARNESS_PORT) }
  });
  harnessProc.on('exit', (code, signal) => {
    // Only an *unintended* exit is news. The teardown below kills this process on purpose, and
    // reporting that as a crash would make a clean run look broken.
    if (!stoppingHarness) {
      console.error(`! harness process exited early (code=${code} signal=${signal})`);
    }
  });

  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const health = await getJson('/api/health');
      if (health.status === 200) return;
    } catch (e) { /* still binding */ }
  }
  throw new Error(`harness never answered GET /api/health on :${HARNESS_PORT} within 15s`);
}

async function stopHarness() {
  if (!harnessProc || !harnessProc.pid) return { released: true, note: 'no harness was started' };
  const pid = harnessProc.pid;
  stoppingHarness = true;
  try {
    if (process.platform === 'win32') {
      // The child is not detached, but Windows needs the tree gone including whatever it
      // spawned; still addressed by the pid we own, never by "whoever holds :4000".
      // argv form, no shell string: the only input is a pid Node itself assigned.
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }, () => {});
    } else {
      harnessProc.kill('SIGTERM');
    }
  } catch (e) { /* already exited */ }

  for (let i = 0; i < 60; i++) {
    if (!(await portInUse(HARNESS_PORT))) return { released: true, note: `pid ${pid} reaped, :${HARNESS_PORT} free` };
    await sleep(250);
  }
  return { released: false, note: `pid ${pid} stopped but :${HARNESS_PORT} is STILL bound` };
}

// ---------------------------------------------------------------- link execution

function scanOutput(text) {
  // Advisory only: exit code decides. `[FAIL]` is the marker every suite in this chain uses,
  // `Failed:` is the focused suites' summary line, `not ok` is TAP.
  const failLines = text.split('\n').filter((line) => /\[FAIL\]|^Failed:|^not ok |WEBHOOK_NOT_CONFIGURED/.test(line));
  // A suite can exit 0 while having skipped the checks that mattered. Count them so "green"
  // and "ran everything" stay separate claims.
  const skipLines = text.split('\n').filter((line) => /\[SKIP\]|^SKIP:|self-skip/i.test(line));
  // Advisory count only: the exit code decides whether a link passed.
  // Suites report in two different shapes, and three earlier versions of this
  // counter each got one of them wrong. A pattern that let `\s+` span newlines
  // read `# duration_ms 2814` as 2,814 checks; a version that only counted
  // summary lines reported 31 for one suite and 444 for another; a version that
  // only counted per-check marker lines reported 0 for every suite that prints
  // `444 PASSED, 0 FAILED` on a single summary line.
  // So measure both ways per LINE (never across lines) and take the larger:
  // neither method double-counts the other, and neither can silently report 0.
  const lines = text.split('\n');
  const markerCount = lines.filter((line) => {
    const t = line.trim();
    return /^(PASSED\b|\[PASS\]|✔|PASS[:\s])/.test(t);
  }).length;
  const summaryCount = lines.reduce((sum, line) => {
    const m = line.match(/(\d+)\s+(?:checks\s+)?PASSED\b/i) || line.match(/\bpassed[=: ]+(\d+)/i);
    return m ? sum + Number(m[1]) : sum;
  }, 0);
  const passed = Math.max(markerCount, summaryCount);
  const otpThrottled = /Too many OTP requests|OTP_DISPATCH_FAILED|try again in/i.test(text);
  return { failLines, skipLines, passed, otpThrottled };
}

function runLink(link, env) {
  const startedAt = Date.now();
  const res = spawnSync(process.execPath, [path.join(BACKEND, link.file)], {
    cwd: BACKEND,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env,
    timeout: Number(process.env.NABIN_LINK_TIMEOUT_MS || 20 * 60 * 1000)
  });
  const stdout = `${res.stdout || ''}${res.stderr || ''}`;
  fs.writeFileSync(path.join(LOG_DIR, `${link.file.replace(/\.js$/, '')}.log`), stdout, 'utf8');
  const scan = scanOutput(stdout);
  return {
    file: link.file,
    exit: res.status,
    durationMs: Date.now() - startedAt,
    passed: scan.passed,
    failLines: scan.failLines,
    skipLines: scan.skipLines,
    otpThrottled: scan.otpThrottled,
    error: res.error ? res.error.message : null
  };
}

// ---------------------------------------------------------------- main

(async () => {
  const baseEnv = { ...process.env };
  const blocked = refuseReason();
  if (blocked) {
    console.error(`✖ chain refused: ${blocked}`);
    process.exit(1);
  }
  const remote = remoteStoreWarning(baseEnv);
  if (remote) {
    console.error(`✖ chain refused: ${remote}`);
    process.exit(1);
  }

  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (HARNESS_PORT !== 4000) {
    // Four of the admin suites still hardcode http://127.0.0.1:4000 rather than reading
    // NABIN_TEST_BASE_URL, so moving the harness makes them fail to connect. Loud on purpose:
    // they refuse rather than passing against some other server.
    console.log(`note: harness on :${HARNESS_PORT} — suites with a hardcoded :4000 will refuse to connect`);
  }

  // The harness needs the same test signing secrets the suites assume; setting them here is
  // what stops MODULE 18 failing closed for a missing-secret reason.
  baseEnv.PAYMENT_WEBHOOK_SECRET = baseEnv.PAYMENT_WEBHOOK_SECRET || TEST_WEBHOOK_SECRET;
  baseEnv.PAYMENT_KEY_SECRET = baseEnv.PAYMENT_KEY_SECRET || TEST_KEY_SECRET;
  const baseUrl = `http://${HARNESS_HOST}:${HARNESS_PORT}`;

  let failures = 0;
  let skipped = 0;
  const results = [];
  try {
    await startHarness(baseEnv);
    console.log(`harness: ${baseUrl} (pid ${harnessProc.pid}), ${LINKS.length} links, sequential`);

    const restartPort = await findFreePort(HARNESS_PORT + 100);
    console.log(`restart_test.js will own private port ${restartPort}\n`);

    for (const [index, link] of LINKS.entries()) {
      const env = {
        ...baseEnv,
        // Every link is told where the backend is, so none of them can quietly fall back to a
        // hardcoded default and talk to a different server than the runner started.
        NABIN_TEST_BASE_URL: baseUrl,
        GEO_TEST_BASE: baseUrl,
        NABIN_API_URL: baseUrl,
        CHAOS_BASE_URL: baseUrl
      };
      if (link.privatePort) env.NABIN_RESTART_PORT = String(restartPort);

      process.stdout.write(`[${index + 1}/${LINKS.length}] ${link.file} ... `);
      const result = runLink(link, env);
      results.push(result);
      skipped += result.skipLines.length;
      const skipNote = result.skipLines.length ? `, ${result.skipLines.length} skipped` : '';
      if (result.exit === 0 && result.failLines.length === 0) {
        console.log(`exit 0, ${result.passed} passed${skipNote}, ${Math.round(result.durationMs / 1000)}s`);
        for (const line of result.skipLines.slice(0, 4)) {
          console.log(`      SKIPPED: ${line.trim().slice(0, 155)}`);
        }
      } else {
        failures++;
        console.log(`EXIT ${result.exit}${result.error ? ` (${result.error})` : ''}, `
          + `${result.failLines.length} failure mark(s)${skipNote}, ${Math.round(result.durationMs / 1000)}s`
          + `${result.otpThrottled ? ' [OTP throttle seen]' : ''}`);
        for (const line of result.failLines.slice(0, 12)) console.log(`      ${line.trim().slice(0, 160)}`);
        if (result.failLines.length > 12) console.log(`      … ${result.failLines.length - 12} more`);
      }
    }
  } catch (err) {
    failures++;
    console.error(`✖ harness error: ${err.message}`);
  } finally {
    const stopped = await stopHarness();
    console.log(`\nteardown: ${stopped.note}`);
    if (!stopped.released) failures++;
    if (process.env.NABIN_KEEP_CHAIN_LOGS === '0') {
      try { fs.rmSync(LOG_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    }
  }

  const passedLinks = results.length - failures;
  const checks = results.reduce((sum, r) => sum + r.passed, 0);
  console.log(`\n=== CHAIN RESULT: ${passedLinks}/${LINKS.length} links clean, ${failures} problem(s) ===`);
  console.log(`    ${checks} explicit passing checks reported, ${skipped} skipped line(s) across the chain`);
  if (skipped) console.log('    a skip is coverage this run did not get; the reason is in the per-link log');
  if (failures) console.log(`full output per link in ${path.relative(process.cwd(), LOG_DIR)}<link>.log`);
  process.exit(failures ? 1 : 0);
})().catch((err) => {
  console.error(`✖ ${err && err.message ? err.message : err}`);
  process.exit(1);
});
