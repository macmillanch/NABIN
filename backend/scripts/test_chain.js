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
const crypto = require('crypto');
const { spawn, spawnSync, execFile } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const LOG_DIR = path.join(BACKEND, '.chain-logs');

// Evidence retention (#165). Every run used to write the same fixed paths — 55 files named
// `.chain-logs/<suite>.log` and one boot log opened in 'w' mode — so re-running the chain truncated the only
// record of why an intermittent link had gone red. That is how the failing run behind #159 was lost before it
// could be traced. A run now owns a directory nothing else writes into:
//
//   backend/.chain-logs/runs/chain_<YYYYMMDD>_<HHMMSS>_<pid>_<rand>/
//     <suite>.log          full stdout+stderr of that link, for this run only
//     harness-boot.log     the harness child's own output (masked before printing)
//     chain-summary.txt    the per-link table, as the console saw it
//     metadata.json        machine-readable facts about the run
//
// The flat `.chain-logs/<suite>.log` files are still written as a latest-run mirror because build docs cite
// that path; they are convenience, not evidence. The runner never prunes previous runs — deleting retained
// evidence is not this file's call to make.
const RUNS_DIR = path.join(LOG_DIR, 'runs');
let RUN_ID = null;
let RUN_DIR = null;
let RUN_STARTED_AT = null;
const MIRROR_LOGS = [];

function timestamp(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function gitRef(args) {
  try {
    const res = spawnSync('git', ['-C', BACKEND, 'rev-parse', ...args], { encoding: 'utf8', windowsHide: true });
    return res.status === 0 ? res.stdout.trim() : null;
  } catch (e) {
    return null;
  }
}

function createRunDir() {
  const now = new Date();
  // A timestamp alone is not unique — two chains can start in the same second — so the pid and a random
  // suffix are part of the id.
  RUN_ID = `chain_${timestamp(now)}_${process.pid}_${crypto.randomBytes(3).toString('hex')}`;
  RUN_DIR = path.join(RUNS_DIR, RUN_ID);
  RUN_STARTED_AT = now;
  fs.mkdirSync(RUN_DIR, { recursive: true });
  HARNESS_BOOT_LOG = path.join(RUN_DIR, 'harness-boot.log');
  return { commit: gitRef(['HEAD']), branch: gitRef(['--abbrev-ref', 'HEAD']) };
}

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
  { file: 'dark_store_routes_rls_test.js' },
  // OP-1: the data-driven operator authorization store. This link is the privilege gate - it
  // proves every existing admin account keeps exactly the effective permission set it had before
  // the store existed, so it belongs with the authorization suites and not with a feature.
  { file: 'operator_permissions_migration_test.js' },
  // TASK 4G: the KYC approval-evidence gate. Repository-level on purpose - it drives
  // reviewIdentityApplication against a synthetic application, so it asserts the contract
  // (APPROVE with no checklist, or with truthy non-booleans, must be refused and must leave the
  // application untouched) without mutating any applicant or depending on seeded KYC rows.
  { file: 'kyc_approve_checklist_test.js' },
  // TASK 3 (merchant authentication) and TASK 4J registration: an unregistered merchant phone must
  // never inherit another merchant's identity. It was only being run by hand, which is how a
  // fail-closed guarantee quietly regresses - so it is now a normal link beside the other
  // authentication gates.
  { file: 'merchant_auth_failclosed_test.js' },
  // Grocery catalog authority and price-audit privilege (TASK 4M). Locks in two proven defects: a
  // merchant must not write an inactive master_grocery_catalog row (while admin edit/reactivate still
  // works), and a merchant-supplied actor string must not mint ADM-EXEC / SUPER_ADMIN audit authority.
  // Asserts on durable rows, and fails when an expected audit row is absent rather than passing
  // vacuously.
  { file: 'grocery_catalog_audit_integrity_test.js' },
  // DECISION D1: merchant tenant isolation was only ever run by hand, which is how a boundary
  // guarantee quietly regresses. It consumes the shared harness backend via NABIN_TEST_BASE and does
  // not start its own server. Registered after A1 made MTI-25 reject an unknown :restaurantId.
  { file: 'merchant_tenant_isolation_test.js' },
  // TASK 4N: durable grocery price-history read. Proves merchant scoping comes from the token, that the
  // read returns only merchant-appropriate fields from `grocery_price_history`, that paging and date
  // filters behave, that a read mutates nothing and writes no audit row, and that degraded mode does
  // not fabricate durable history.
  { file: 'grocery_price_history_read_test.js' },
  // TASK F1: Food discovery and real menu ordering. Pins the contracts the rewritten customer Food page
  // depends on - durable restaurant discovery, catalogue menus with server prices and UUID product ids,
  // and checkout that requires a customer session while refusing another merchant's product and any
  // invented dish name. Every checkout assertion is a refusal path, so it places no orders.
  { file: 'food_discovery_ordering_contract_test.js' },
  // TASK F3: Phase-8 forensic security. DB-only - it speaks to PostgreSQL through the `pg`
  // client and never starts or kills the shared harness on :4000, so it is safe anywhere in the
  // chain without a private port. Its three audit_logs append-only probes insert inside
  // transactions that are rolled back, so they leave no residue on the durable append-only
  // table (measured: the phase8-test row count is unchanged across a run).
  { file: 'test_phase8_security.js' },
  // TASK F3: Phase-5 payment security & capture integrity (cross-customer payment IDOR, webhook replay,
  // fail-closed SESSION_NOT_PAYABLE). Marked `isolated` because its append-only ledger/payment rows cannot
  // be deleted, so running it against `public` would grow the exact money data FIN15B-20 and
  // IDENT-09/IDENT-10 measure. For this link only, the runner provisions the disposable chain_scratch
  // clone, snapshots protected public counts, hands it the isolated SUPABASE_URL + DATABASE_URL, then
  // verifies zero drift and tears the clone down; any drift or teardown failure marks the link FAILED.
  // It also gets a private port so its own restart logic cannot evict the shared harness on :4000.
  { file: 'test_phase5_payments.js', isolated: true },
  // F-3(b): Phase-4 food & grocery Postgres order suite (66 assertions), proven isolated standalone first:
  // 66 PASSED / 0 FAILED against the clone with the hard public guard CLEAN (10 protected tables unmoved),
  // including its cold-restart durability checks. It was adapted the same way Phase 5 was - it binds,
  // probes and cleans up NABIN_RESTART_PORT instead of killing whatever owns :4000 - because it owns a
  // backend, and an isolated link must never evict the shared harness. Its boot was measured at 26.5s,
  // so the old fixed 10s wait was a latent race, now a deadline poll.
  { file: 'test_phase4_orders.js', isolated: true },
  // F-3(b): Phase 11 is a B-class suite - zero pg connections and zero `public.` references, so all its
  // effects already travel through the backend and follow SUPABASE_URL into the clone. It needed only the
  // narrow private-port adaptation (own port, scoped sweep, explicit PORT for the child), then passed the
  // fail-fast standalone proof in scratch/p11_isolated_proof.js: exit 0, 25 [PASS] / 0 [FAIL], flag state
  // restored, guard CLEAN (10 protected public tables unchanged), full teardown. Placed last so the proven
  // links 48/49 keep their numbers.
  // Own subtotal (`Count: N`) is authoritative here; see the per-link rule in scanOutput.
  { file: 'test_phase11_feature_control.js', isolated: true, subtotalPattern: /^Count:\s*(\d+)\s*$/m },   // 50
  // F-2: the ad-click throttle is proven against the real PostgreSQL path, so it is isolated (its permitted
  // clicks would otherwise durably inflate `public.advertisements.clicks` on every chain run) and it runs in
  // strict live mode: `NABIN_F2_REQUIRE_LIVE` makes the suite refuse fixture data and read the durable row
  // with SQL instead of trusting the response body.
  { file: 'ad_click_rate_limit_test.js', isolated: true, env: { NABIN_F2_REQUIRE_LIVE: '1' } },           // 51
  // #138: the two writes a customer's active-ride card is built from must answer with a real
  // value or null — never a `DEFAULT 5.00` rating, a made-up driver name and phone, or a Delhi
  // pin standing in for telemetry that was never reported.
  { file: 'customer_ride_projection_test.js' },                                                          // 52
  // #139: the docs cite `server.js:N` for route facts, and an insert near the top of that file
  // silently invalidates every number below it. This derives them from the registrations and fails
  // while any derivable citation has drifted — including a fixture probe, so a scanner that stops
  // finding registrations cannot report a clean sweep.
  { file: 'doc_citation_guard_test.js' },                                                                // 53
  // #32a/#143: the platform may not complete a place, a trip length or a parcel description from
  // its own defaults. This pins the halves `geo_adversarial_test.js` group A2 cannot see — the
  // refusal never pre-empting auth, IDOR or a coupon redemption, the address the order row and the
  // customer's own read actually hold, and a coordinate-free job reading back coordinate-free.
  { file: 'place_substitution_test.js' },                                                                 // 54
  // #155: the admin console renders every queue by assigning a template literal to innerHTML, and
  // the fields it prints were typed by a customer, driver, merchant or operator. This asserts the
  // class over the whole shipped file — every interpolated value escaped, every inline-handler and
  // src slot shape-checked where escaping cannot protect it, the helpers executed against hostile
  // payloads, and no guard added to a copy the browser never runs. Row names and templates are read
  // off the file, so a queue added tomorrow is covered by the same rule.
  { file: 'admin_console_xss_test.js' }                                                                   // 55
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

// The harness child used to be spawned with `stdio: 'ignore'`, which threw away the only evidence of why a
// boot failed: seven chain runs aborted on "harness never answered /api/health" with nothing to inspect.
// Its output now goes here, and is echoed (masked) when readiness fails. `createRunDir()` re-points it into
// the current run's directory so a later run cannot truncate a boot failure that has not been read yet; the
// default only matters if the chain refuses before any run directory exists.
let HARNESS_BOOT_LOG = path.join(BACKEND, 'scratch', 'harness-boot.log');

function bootLogTail(chars = 1800) {
  try {
    const raw = fs.readFileSync(HARNESS_BOOT_LOG, 'utf8');
    // Credentials are masked before anything is printed: scheme://user:password@host -> scheme://***:***@host
    return raw.replace(/(\w+:\/\/)[^:\/@\s]+:[^@\s]+@/g, '$1***:***@').slice(-chars);
  } catch (e) {
    return `(no boot log yet: ${e.message})`;
  }
}

async function startHarness(env) {
  // Isolation environment must never reach the baseline chain. A previous proof loaded `.chain-scratch/link.env`
  // into a reused PowerShell session and every later run inherited `SUPABASE_URL` pointing at the scratch proxy
  // and a `search_path=chain_scratch` `DATABASE_URL`, so the harness booted against a dead proxy and the whole
  // chain silently tested nothing. Refusing is cheaper than a green-looking run against the wrong database.
  const leakedProxy = /:54331\b/.test(process.env.SUPABASE_URL || '');
  const leakedSchema = /search_path=chain_scratch/i.test(decodeURIComponent(process.env.DATABASE_URL || ''));
  if (leakedProxy || leakedSchema) {
    const reasons = [];
    if (leakedProxy) reasons.push('SUPABASE_URL points at the scratch proxy :54331');
    if (leakedSchema) reasons.push('DATABASE_URL carries search_path=chain_scratch');
    throw new Error(
      'refusing to start the harness: isolation (chain_scratch) environment has leaked into the parent '
      + `process (${reasons.join(' and ')})`
      + '. This chain must run against the normal local backend on the `public` schema; with chain_scratch '
      + 'inherited, every link - especially the ones that assert public contamination - would be meaningless. '
      + 'Clear SUPABASE_URL and DATABASE_URL (or open a fresh shell) and re-run.'
    );
  }

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
    stdio: ['ignore', fs.openSync(HARNESS_BOOT_LOG, 'w'), fs.openSync(HARNESS_BOOT_LOG, 'a')],
    windowsHide: true,
    env: { ...env, PORT: String(HARNESS_PORT) }
  });
  harnessProc.on('error', (err) => {
    // Without this listener a spawn failure is an unhandled 'error' event, and the run dies with no clue.
    if (!stoppingHarness) console.error(`! harness process failed to start: ${err.code || ''} ${err.message}`);
  });
  harnessProc.on('exit', (code, signal) => {
    // Only an *unintended* exit is news. The teardown below kills this process on purpose, and
    // reporting that as a crash would make a clean run look broken.
    if (!stoppingHarness) {
      console.error(`! harness process exited early (code=${code} signal=${signal})`);
      console.error(`--- ${HARNESS_BOOT_LOG} (masked) ---\n${bootLogTail(1200)}`);
    }
  });

  // Measured rather than assumed. Booting this backend takes roughly 7-21s locally - it hydrates a
  // ~1,700-account directory and the geo/pricing stores - so the old fixed 60 x 250ms = 15s window
  // could expire against a perfectly healthy process and abort the entire chain before a single
  // link ran, which reads as `-1/N links, 0 checks`: a harness failure wearing a test failure's
  // clothes. Same class of defect already fixed in restart_test.js. The condition is still polled
  // and the loop returns the instant it is satisfied; no fixed sleep has been substituted.
  const READY_DEADLINE_MS = 90000;
  const readyWaitedFrom = Date.now();
  let lastHealthAnswer = 'no attempt yet';
  for (;;) {
    await sleep(500);
    try {
      const health = await getJson('/api/health');
      if (health.status === 200) {
        console.log(`harness ready on :${HARNESS_PORT} after ${Date.now() - readyWaitedFrom}ms`);
        return;
      }
      lastHealthAnswer = `HTTP ${health.status}`;
    } catch (err) {
      lastHealthAnswer = err.message;
    }
    if (Date.now() - readyWaitedFrom > READY_DEADLINE_MS) {
      throw new Error(
        `harness never answered GET /api/health on :${HARNESS_PORT} within ${READY_DEADLINE_MS / 1000}s ` +
        `(last observed: ${lastHealthAnswer}; measured local boot time is 7-21s). No link executed, so this `
        + `is a harness/environment failure and must not be read as a test failure.\n`
        + `--- ${HARNESS_BOOT_LOG} (masked, last 1800 chars) ---\n${bootLogTail()}`
      );
    }
  }
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

function scanOutput(text, subtotalPattern) {
  // Advisory only: exit code decides. `[FAIL]` is the marker most suites in this chain use,
  // `Failed:` is the focused suites' summary line, `not ok` is TAP, and `^❌` is what the geo
  // suites print (`❌ [MTX-R04] FAIL  …`) - the closing bracket sits before the word there, so
  // `[FAIL]` never matched it and a link reporting five failures printed "0 failure mark(s)".
  // Anchored to the line start because a green suite's own summary also says FAILED ("0 FAILED").
  const failLines = text.split('\n').filter((line) => /\[FAIL\]|^Failed:|^not ok |^❌|WEBHOOK_NOT_CONFIGURED/.test(line));
  // A suite can exit 0 while having skipped the checks that mattered. Count them so "green"
  // and "ran everything" stay separate claims. `NOT MEASURED` is the audit suites' vocabulary
  // for a claim this database cannot carry, and a summary line like `1 not measured` is
  // deliberately not matched again — the marker line is the one that counts.
  const skipLines = text.split('\n').filter((line) => /\[SKIP\]|^SKIP:|self-skip|^NOT MEASURED/i.test(line));
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
    // NOTE (F-3(b) count reconciliation): phase 11 prints one `✅ [PASS] n.` line per check, which this
    // pattern does not match (`✅` is not `✔`, and the trimmed line does not start with `[PASS]`), so that
    // link reports `exit 0, 1 passed` while its own summary says `Count: 24`. Adding `✅` here is NOT the
    // fix - scratch/p11_count_regression.js measured it against the real per-link logs and it changes the
    // advisory count of 43 links (admin_authorization 0->115 vs its reported 35, test_suite 0->447), because
    // many suites print far more `✅` lines than they count as checks and the total takes max(markers,
    // summary). The count is advisory and the exit code still decides, so the correct narrow fix is to read
    // phase 11's own `Count: N` subtotal for this link only - an owner decision, not a global pattern change.
    return /^(PASSED\b|\[PASS\]|✔|PASS[:\s])/.test(t);
  }).length;
  const summaryCount = lines.reduce((sum, line) => {
    // `64/64 assertions passed` is that suite's own summary form; without this branch the link
    // reports `exit 0, 0 passed` and looks like it ran nothing. Advisory only - the exit code
    // still decides whether a link passed - and the pattern is specific enough that no other
    // suite's counting changes.
    const m = line.match(/(\d+)\s+(?:checks\s+)?PASSED\b/i) || line.match(/\bpassed[=: ]+(\d+)/i)
      || line.match(/(\d+)\/\d+\s+assertions?\s+passed/i);
    return m ? sum + Number(m[1]) : sum;
  }, 0);
  // Per-link subtotal rule (F-3(b)): a suite that maintains its own check subtotal is the authority on how
  // many checks it ran, so a link may declare a pattern for it. This is opt-in per link - `subtotalPattern`
  // is undefined for every other link, and those keep the max(marker, summary) behaviour byte-for-byte. It
  // exists because phase 11 prints `✅ [PASS] n.` lines the generic marker pattern cannot match (and making
  // it match `✅` globally would inflate 43 other links), while its own `Count: 24` line is exact.
  // Advisory only, as before: the exit code still decides whether the link passed.
  let passed = Math.max(markerCount, summaryCount);
  if (subtotalPattern) {
    const sub = text.match(subtotalPattern);
    if (sub) passed = Number(sub[1]);
  }
  const otpThrottled = /Too many OTP requests|OTP_DISPATCH_FAILED|try again in/i.test(text);
  return { failLines, skipLines, passed, otpThrottled };
}

// ---------------------------------------------------------------- isolated links (F-3)
// An `isolated: true` link runs against the disposable `chain_scratch` clone instead of `public`, so a
// write-heavy suite cannot grow the money/audit data that FIN15B-20 and IDENT-09/IDENT-10 measure.
// Scope is strictly that one link: it is provisioned, snapshotted, handed both isolated URLs, verified for
// contamination, and torn down around a single run. Every other link keeps the shared environment exactly
// as before. The contamination check is authoritative: drift marks the link FAILED, it never warns.
const SCRATCH_SCRIPT = path.join(BACKEND, 'scripts', 'chain_scratch.js');

function scratchCli(cmd) {
  return spawnSync(process.execPath, [SCRATCH_SCRIPT, cmd], {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { NODE_ENV: process.env.NODE_ENV || 'local' })
  });
}

// Both helpers live in scripts/port_release.js so the runner and its regression checks share one
// implementation - test_chain.js cannot be imported without starting a chain.
const { readLinkEnv, releasePrivatePort } = require('./port_release');

/**
 * Records the run's own evidence in its directory: a human-readable per-link table and a machine-readable
 * manifest. Written after teardown so the file exists whether the chain finished green, finished red, or was
 * aborted by the harness. It only reports what the links already returned - nothing here can influence a
 * verdict, an assertion, or the exit code.
 */
function writeRunEvidence({ results, passedLinks, problems, checks, skipped, exitCode, harnessPid, git }) {
  if (!RUN_DIR || !RUN_STARTED_AT) return;
  const finishedAt = new Date();
  const lines = [
    `NABIN chain run ${RUN_ID}`,
    `started ${RUN_STARTED_AT.toISOString()}  finished ${finishedAt.toISOString()}`
    + `  duration ${Math.round((finishedAt - RUN_STARTED_AT) / 1000)}s`,
    `harness ${HARNESS_HOST}:${HARNESS_PORT} pid ${harnessPid || 'never started'}`,
    `git ${git.branch || 'unknown'} ${git.commit || 'unknown'}`,
    `links ${LINKS.length}, clean ${passedLinks}, problems ${problems}, exit ${exitCode}`,
    `${checks} explicit passing checks reported, ${skipped} skipped line(s)`,
    'note: the passed= column is the runner\'s advisory parse of suite output; exit= is the authority.',
    '',
    ...results.map((r, i) => `[${i + 1}/${LINKS.length}] ${r.file} exit=${r.exit === null ? 'null' : r.exit}`
      + ` passed=${r.passed} failed=${r.failLines.length} skipped=${r.skipLines.length} ms=${r.durationMs}`
      + `${r.error ? ` error=${r.error}` : ''}${r.otpThrottled ? ' OTP_THROTTLED' : ''}`
      + `${r.contamination ? ' CONTAMINATION' : ''}`)
  ];
  // Suite messages are deliberately not copied in here - the per-link log in this directory already holds
  // them, and a machine-readable summary is one more place a printed credential would have to be scrubbed.
  const metadata = {
    runId: RUN_ID,
    startedAt: RUN_STARTED_AT.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - RUN_STARTED_AT,
    git,
    harness: { host: HARNESS_HOST, port: HARNESS_PORT, pid: harnessPid || null },
    linkCount: LINKS.length,
    verdict: {
      linksClean: passedLinks, problems, checksReported: checks, skippedLines: skipped, exitCode
    },
    links: results.map((r, i) => ({
      index: i + 1,
      file: r.file,
      exit: r.exit,
      passed: r.passed,
      failedMarks: r.failLines.length,
      skippedLines: r.skipLines.length,
      durationMs: r.durationMs,
      error: r.error,
      otpThrottled: r.otpThrottled === true,
      contamination: r.contamination === true,
      isolationPort: r.isolationPort || null,
      drift: r.drift || []
    }))
  };
  try {
    fs.writeFileSync(path.join(RUN_DIR, 'chain-summary.txt'), `${lines.join('\n')}\n`, 'utf8');
    fs.writeFileSync(path.join(RUN_DIR, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  } catch (e) {
    console.error(`! could not write run evidence: ${e.message}`);
  }
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
  // The per-run copy is the evidence and is never reused; the flat file is the latest-run mirror that the
  // build docs cite, so it still gets written but is never the thing a red run is traced from.
  // Separators are flattened because a link under a subdirectory would otherwise need that subdirectory to
  // exist inside the run directory, and a failed evidence write would abort the whole chain.
  const linkLogName = `${link.file.replace(/\.js$/, '')}.log`.replace(/[\\/]/g, '_');
  fs.writeFileSync(path.join(RUN_DIR, linkLogName), stdout, 'utf8');
  const mirrorPath = path.join(LOG_DIR, linkLogName);
  fs.writeFileSync(mirrorPath, stdout, 'utf8');
  MIRROR_LOGS.push(mirrorPath);
  const scan = scanOutput(stdout, link.subtotalPattern);
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

  const run = createRunDir();
  console.log(`run ${RUN_ID}`);
  console.log(`evidence for this run: ${path.relative(process.cwd(), RUN_DIR)}${path.sep}`);
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
  let kept = true;
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

      // Opt-in isolation, per link. See the helpers above.
      let isolationError = null;
      let isolationPort = null;
      if (link.isolated) {
        // Order matters, and every step is checked: provision (clone + throwaway PostgREST + proxy) ->
        // link-env (write the isolated env file) -> snapshot (protected public counts) -> read the file.
        // The first in-chain attempt died here because `link-env` was never invoked, so readLinkEnv()
        // threw ENOENT and that throw escaped into the harness-level catch, aborting the whole chain.
        const prov = scratchCli('provision');
        const le = prov.status === 0 ? scratchCli('link-env') : prov;
        const snap = le.status === 0 ? scratchCli('snapshot') : le;
        if (snap.status !== 0) {
          isolationError = `isolation setup failed: ${String(snap.stderr || snap.stdout || snap.error || '').slice(-300)}`;
        } else {
          try {
            Object.assign(env, readLinkEnv());
          } catch (e) {
            isolationError = `link.env unreadable after setup: ${e.message}`;
          }
        }
        if (!isolationError) {
          // A suite that spawns its own backend must not evict the shared harness on 4000.
          if (!env.NABIN_RESTART_PORT) {
            isolationPort = String(await findFreePort(restartPort + 1));
            env.NABIN_RESTART_PORT = isolationPort;
          } else {
            isolationPort = env.NABIN_RESTART_PORT;
          }
        }
      } else {
        // F-3(a): attribution baseline for an ordinary link. Nothing is enforced with it - the diff is
        // reported after the link runs. Snapshotting per link (rather than reusing an old file) is what
        // makes the attribution defensible: exactly one link executes between the two counts, and the
        // shared harness performs no write of its own in between.
        scratchCli('snapshot');
      }

      process.stdout.write(`[${index + 1}/${LINKS.length}] ${link.file} ... `);
      const result = runLink(link, env);
      if (isolationError) {
        result.exit = result.exit || 1;
        result.failLines = result.failLines.concat([`ISOLATION UNAVAILABLE: ${isolationError}`]);
        // Setup failed part-way, so a clone/proxy may already exist. Clean it up anyway: leaking the
        // throwaway schema and a bound :54331 across the rest of the chain would be worse than the
        // single failed link, and the isolated link itself is already marked failed.
        scratchCli('teardown');
        releasePrivatePort(isolationPort);
      } else if (link.isolated) {
        const ver = scratchCli('verify');
        if (ver.status !== 0) {
          const lines = `${ver.stdout || ''}${ver.stderr || ''}`.split(/\r?\n/).filter((l) => /DRIFT|CONTAMINATION/.test(l));
          result.exit = result.exit || 1;
          result.contamination = true;
          result.failLines = result.failLines.concat(lines.length ? lines : ['PUBLIC CONTAMINATION: guard exited non-zero without detail']);
        }
        const td = scratchCli('teardown');
        if (td.status !== 0) {
          result.exit = result.exit || 1;
          result.failLines = result.failLines.concat([`TEARDOWN FAILED: ${String(td.stderr || td.stdout || '').slice(-240)}`]);
        }
        if (!isolationError && !result.contamination) result.drift = ['DRIFT public: CLEAN (hard guard enforced)'];
        // The isolated link may have left its own backend running on the port we allocated (measured in
        // Checkpoint #50). Reap it here, and treat a foreign owner as a hard failure rather than killing it.
        const released = releasePrivatePort(isolationPort);
        result.isolationPort = isolationPort;
        if (/skipped:foreign/.test(released)) {
          result.exit = result.exit || 1;
          result.failLines = result.failLines.concat([
            `PORT ${isolationPort} HELD BY A FOREIGN PROCESS - not killed, link failed so the runner cannot evict unrelated services`
          ]);
        } else if (/released:/.test(released)) {
          console.log(`(reaped stranded backend on :${isolationPort}) `);
        }
      } else {
        // Report drift for ordinary links, without ever changing their verdict: a non-isolated link is
        // allowed to write public state, and a count moving is not evidence by itself that it should not.
        const diff = scratchCli('diff');
        result.drift = `${diff.stdout || ''}`.split(/\r?\n/).filter((l) => l.startsWith('DRIFT'));
        if (!result.drift.length) result.drift = ['DRIFT public: UNAVAILABLE (attribution failed, link status unaffected)'];
      }
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
      // Attribution output: printed after the verdict so it cannot influence pass/fail counting.
      for (const line of (result.drift || []).slice(0, 6)) console.log(`      ${line.trim().slice(0, 150)}`);
      if ((result.drift || []).length > 6) console.log(`      … ${result.drift.length - 6} more drift line(s)`);
    }
  } catch (err) {
    failures++;
    console.error(`✖ harness error: ${err.message}`);
  } finally {
    const stopped = await stopHarness();
    console.log(`\nteardown: ${stopped.note}`);
    if (!stopped.released) failures++;
    if (process.env.NABIN_KEEP_CHAIN_LOGS === '0') {
      // Explicit opt-out discards THIS run only. This used to remove the whole `.chain-logs` tree, which once
      // runs live inside it would have deleted every earlier run's evidence - the opposite of why #165 exists.
      try {
        fs.rmSync(RUN_DIR, { recursive: true, force: true });
        for (const mirror of MIRROR_LOGS) fs.rmSync(mirror, { force: true });
        kept = false;
      } catch (e) { /* best effort */ }
    }
  }

  const passedLinks = results.length - failures;
  const checks = results.reduce((sum, r) => sum + r.passed, 0);
  const exitCode = failures ? 1 : 0;
  if (kept) {
    writeRunEvidence({
      results, passedLinks, problems: failures, checks, skipped, exitCode,
      harnessPid: harnessProc ? harnessProc.pid : null, git: run
    });
  }
  console.log(`\n=== CHAIN RESULT: ${passedLinks}/${LINKS.length} links clean, ${failures} problem(s) ===`);
  console.log(`    ${checks} explicit passing checks reported, ${skipped} skipped line(s) across the chain`);
  if (skipped) console.log('    a skip is coverage this run did not get; the reason is in the per-link log');
  if (failures && kept) {
    console.log(`full output per link in ${path.relative(process.cwd(), RUN_DIR)}${path.sep}<link>.log`);
    console.log(`    the previous runs under ${path.relative(process.cwd(), RUNS_DIR)}${path.sep} are untouched`);
  }
  if (!kept) console.log('    NABIN_KEEP_CHAIN_LOGS=0: this run\'s directory was removed after teardown');
  process.exit(exitCode);
})().catch((err) => {
  console.error(`✖ ${err && err.message ? err.message : err}`);
  process.exit(1);
});
