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
// The target guard lives in its own module so `chain_target_guard_test.js` can check the real
// decision rather than a copy of it. Same reason `scripts/port_release.js` exists.
const targetGuard = require('./chain_target_guard');
const { isLoopback } = targetGuard;

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
  // #334: the three suites that used to leave 8 durable orders in `public` after every full run now
  // run on the clone lane. `isolated: true` gives them the schema; `laneServer: true` gives them a
  // backend spawned with that schema's env, which is the half an HTTP suite needs — otherwise its
  // bookings travel over HTTP to the shared harness and land in `public` while its own reads see
  // `chain_scratch`. Each of the three was registered only after
  // `node scripts/lane_check.js <suite> --lane-server` returned green on all three measurements
  // (suite exit, `chain_scratch verify`, and the full-schema public census).
  { file: 'test_suite.js', isolated: true, laneServer: true },
  { file: 'session_reconcile_pagination_test.js' },
  { file: 'boot_mirror_read_test.js' },
  { file: 'geo_policy_test.js' },
  { file: 'geo_adversarial_test.js', isolated: true, laneServer: true },
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
  { file: 'place_substitution_test.js', isolated: true, laneServer: true },                                // 54
  // #155: the admin console renders every queue by assigning a template literal to innerHTML, and
  // the fields it prints were typed by a customer, driver, merchant or operator. This asserts the
  // class over the whole shipped file — every interpolated value escaped, every inline-handler and
  // src slot shape-checked where escaping cannot protect it, the helpers executed against hostile
  // payloads, and no guard added to a copy the browser never runs. Row names and templates are read
  // off the file, so a queue added tomorrow is covered by the same rule.
  { file: 'admin_console_xss_test.js' },                                                                  // 55
  // Order-read reliability, merchant half: `getOrdersByMerchant()` answered a store failure with
  // `[]` — the same value a book that is genuinely empty returns — so
  // `GET /api/merchant/:id/orders` printed `200 {success:true, count:0}` and the dashboard
  // `activeOrdersCount: 0, todaySales: 0`. A restaurant whose store was unreachable was told the
  // day was quiet. This pins the correction at both layers with no mocks: the repository runs
  // against a real outage (a child whose SUPABASE_URL is the closed port 127.0.0.1:59999) and the
  // routes run over real HTTP on an ephemeral private port with the failure injected at the
  // repository boundary — the only way a route-level outage is reachable at all, because merchant
  // auth reads that same store and would answer 401 first. 31 checks. It only ever reads orders
  // that already exist, discovers its merchant fixtures from PostgreSQL rather than hardcoding
  // them, refuses `NODE_ENV=production` and a non-loopback PG target itself, and kills every
  // child it spawns — so it needs neither `isolated` nor `privatePort`, and it never touches :4000.
  { file: 'merchant_order_read_reliability_test.js' },                                                    // 56
  // Customer half of the same programme, on `getOrdersByCustomer()` and `getOrderById()`: a failed
  // list read was indistinguishable from "you have no orders", and a failed detail read from "no
  // such order". The finding the brief did not name was `POST /api/payments/create-order` — its
  // order-ownership and amount check is a `getOrderById()` read, so on an outage that read answered
  // `null`, the `if (order)` block was skipped, and a payment session was opened with ownership
  // never checked. It was failing open. Same harness shape, 44 checks, same self-imposed guards
  // and cleanup. Placed last so the proven links 53/54/55 keep their numbers.
  { file: 'customer_order_read_reliability_test.js' },                                                    // 57
  // Support-ticket write path, the same defect class on the other side of the API. A 300-character
  // title used to reach PostgreSQL and come back as `400 value too long for type character
  // varying(200)` — the schema drawn for a stranger, with no hint of which field to fix — and every
  // database failure in `SupportTicketRepository` was rethrown with no status, so a collision, an
  // unmigrated schema and an unreachable store all answered 400 and told the client to stop
  // retrying. Now the three writable fields are bounded at the boundary with named codes against the
  // REAL column lengths, and a genuine engine refusal is marked and handed to the platform's
  // existing `storeReply` classifier. 48 checks: the caps are compared against `information_schema`
  // (a constant that drifts from its column is a bug in either direction), the repository runs
  // against a real outage (closed port 127.0.0.1:59999) so a cap refusal and a store failure are
  // distinguishable with no mocks, and four private-port server children each fake one SQLSTATE
  // (fetch failure, 23505, 22001, 42P01) at the `support_tickets` wire to pin 503 / 409 / 400 / 500
  // over real HTTP on both write routes. It writes nothing — no request that would clear the gates
  // and reach a live insert is ever sent, and it fingerprints `support_tickets` before and after —
  // so it needs neither `isolated` nor `privatePort`, and it never touches :4000.
  { file: 'support_ticket_write_guard_test.js' },                                                          // 58
  // Notification write path, the same two defect classes on the tables that push to a phone. Five
  // fixes, all found by reading the REAL DDL rather than the constants: `notification_type` was
  // capped at 30 against a `varchar(60)` column and `device_id` at 50 against `varchar(100)` (both
  // refused valid input), a 200-character broadcast title was accepted and then rejected by
  // `notifications.title varchar(150)` as a bare engine sentence, every failure in
  // `NotificationRepository` was rethrown with no mark so `storeReply` read a 500 as a 400, and
  // `registerDeviceToken()` answered a 23505 whose recovery read found no row as a SUCCESSFUL
  // registration with no row behind it — over HTTP that was `200 {registered:true}`, a fabricated
  // one. The admin broadcast also reported `recipientCount` as the audience size even when fan-out
  // was capped, so an operator read "notified 5000" while 500 were skipped. Now the five caps are
  // compared against `information_schema`, the four CHECK sets against `pg_constraint`, the enum
  // guards answer the field they broke, the collision-with-no-row throws the marked store failure,
  // and the broadcast counts what it actually inserted. 60 checks: the repository runs against a
  // real outage (closed port 127.0.0.1:59999), and four private-port server children each fake one
  // SQLSTATE (fetch failure, 23505, 22001, 42P01) at the notification wires to pin 503 / 409 / 400 /
  // 500 over real HTTP on all eight routes. It writes nothing — no request that would clear the
  // gates and reach a live insert is ever sent, and it fingerprints the notification tables before
  // and after — so it needs neither `isolated` nor `privatePort`, and it never touches :4000.
  { file: 'notification_write_guard_test.js' },                                                              // 59
  // BOOKING FAN-OUT SHAPE: the audience shape `book-ride`/`book-parcel` hand to the dispatch
  // repository. The fan-out used to await one PostgreSQL round trip per driver in a row (measured
  // 11,840ms for one ride against 1,320 drivers, against the 15,000ms client timeout that made
  // link 5 intermittently red) and aborted at the first rejecting driver, truncating every offer
  // queued behind them — proven against a reconstruction of the old loop, where 4 of 20 drivers
  // were reached and the rest were silently skipped. `createOffer` is replaced with a recorder,
  // so this link writes nothing to any store and leaves no residue. Appended rather than placed
  // beside link 20 because every later link number is cited in docs, and renumbering them to
  // guard a shape check would itself be the drift this repository keeps having to repair.
  { file: 'dispatch_fanout_test.js' },                                                               // 60
  // DATABASE TLS: every direct Postgres client in this repo either verifies or is refused. This
  // link exists because `DATABASE_SSL=no-verify` had been written into the staging config and four
  // documents as a Supabase requirement; the measured cause was a missing trust anchor, and pinning
  // "Supabase Root 2021 CA" makes the same handshake complete with full verification. So the bypass
  // is now a refusal, and a bypass is no longer explainable as "the CA won't validate". Pure unit:
  // no socket, no database, no backend — it reads certificates and source text only.
  { file: 'db_tls_policy_test.js' },                                                               // 61
  // ONE PROJECT PER ENVIRONMENT: the boot guard that is supposed to make "a development build
  // cannot reach the production database" a property of the code rather than of which keys someone
  // pasted. It was in fact unreachable for the credential half — real Supabase keys carry the
  // project in a top-level `ref` claim with `iss: "supabase"` (decoded from `backend/.env` and
  // `backend/.env.staging` on 12 Oct 2026), while the guard read the ref out of `iss` and the suite
  // only ever fed it the `iss: "supabase:<ref>"` shape. Every legitimate configuration passed, and
  // so did a production service key pointed at the test project. Now both claim locations resolve,
  // the cross-environment refusal fires on the shape the real keys have, and a key that carries no
  // project claim at all is stated as an unverifiable note instead of passing silently. Pure unit
  // over explicit env maps: no network, no database, no backend, and no process env is read.
  { file: 'nabin_env_guard_test.js' },                                                            // 62
  // THE STAGING WRAPPER REFUSES BEFORE IT SPAWNS: `scripts/with_staging_target.js` is how a hosted
  // project gets put in front of `migrate.js` and how a hosted test run is launched, so it is the
  // last place a wrong target can be caught. Its header said "verified fail-closed" and the audit
  // found four claims that were not implemented plus one typo: the loaded file overwrote whatever
  // the operator named on the command line, an inherited `DATABASE_SSL=no-verify` was accepted,
  // any non-production ref counted as staging, `nabinEnv.audit` — the guard everything else boots
  // through — was never called, and `STAGING_SUPABASE_ANON_KEY` was assigned to itself, so an
  // operator-supplied anon credential landed in no slot at all and both anon checks (a
  // service_role key where a client reads, an unfilled template) had nothing to look at. Found by
  // this suite: SG-23 and SG-27 were red until the mapping was fixed. It also refuses while the
  // pooler password is still the template literal, which is the live state of
  // `backend/.env.staging` (measured 12 Oct 2026 — the placeholder reached the server as a 28P01
  // several layers away from the cause; the refusal now names the owner action and repeats no
  // credential). 40 checks, pure: no socket, no database, no child process, and every fixture
  // names an absent env file so the developer's own `.env.staging` cannot answer for it.
  { file: 'staging_target_guard_test.js' },                                                        // 63
  // THE HOSTED-TEST VERIFIER NEEDS THE CREDENTIAL IT CLAIMS TO HAVE CHECKED:
  // `scripts/verify_hosted_test_env.js` is the read-only gate the staging migration procedure
  // runs before it touches a hosted schema, and on 12 Oct 2026 it printed
  // `✅ PASS: Environment is safely and correctly configured for Hosted TEST` with exit 0 against
  // `backend/.env` — 16 keys and no `DATABASE_URL` at all. It computed `hasDatabaseUrl`, showed it
  // with a ⚠️, and used it in no condition; the PASS branch keyed on the two REST credentials only.
  // A verdict read as permission to run `migrate.js` cannot be silent about the credential
  // `migrate.js` needs, so all three slots are gated now, production and audit problems still
  // precede the credential question, and a harness-pinned target can no longer be replaced by a
  // local `.env.test.local` loaded with `override: true`. 27 checks, pure: `decide()`,
  // `exitCodeFor()`, `finalLine()` and `chooseEnvFile()` are exported over explicit env maps, so no
  // socket is opened, no database is contacted, no child is spawned, and the developer's own `.env`
  // cannot answer for a fixture.
  { file: 'verify_hosted_test_env_guard_test.js' },                                               // 64
  // #263: THE GROCERY PRICE WRITE PATH HAD TWO STORES AND NEITHER WAS THE ONE CUSTOMERS READ.
  // `PUT /api/grocery/products/:id/price` and `POST /api/grocery/products/bulk-price-update` answered
  // from `db.updateGroceryProductPrice`, which mutates the process-local `groceryProducts` mirror, while
  // `GET /api/grocery/products` and the checkout snapshot read `merchant_grocery_inventory.store_price`.
  // Measured consequence: every real listing id (the customer read projects only UUIDs) 400'd "Product
  // not found", so no live price could be set at all, while the mirror id `gprod_1` answered 200 and
  // minted a permanent `audit_logs` PRICE_UPDATE row for a change that touched no durable row — a silent
  // success in the permanent trail, which PHASE 4 forbids. Nothing compared the session's merchant with
  // the record, and `req.body.actor` was copied into that trail verbatim.
  // This link pins the durable ground: the write moves the row the customer read actually projects (by
  // listing id or master product id), is recorded in `grocery_price_history` with the previous and new
  // price and the SESSION's merchant as `changed_by`, refuses another merchant's listing with a 404 that
  // leaves the victim row bit-identical, refuses mirror ids and every invalid price with a 400 and a
  // `code` and no history row, reports bulk per item with `applied` equal to the rows that really moved,
  // and mints no `audit_logs` row for a durable merchant price change. Restaurant-only entitlement (403)
  // is re-checked so the rewrite did not widen who may price.
  // Chain-safe and appended last so links 45 and 50-64 keep the numbers docs cite: it starts no server,
  // speaks HTTP to the shared harness via NABIN_TEST_BASE_URL, and mints its OWN listing for the
  // GROCERY-only store `…0203` through the durable inventory route, deleting only that listing, its own
  // history rows and any audit row minted at or after its start. The seeded listing `…0601` is the
  // cross-tenant victim and is read before and after every attack, never written — deliberately, because
  // an earlier suite poking the seeded grocery row is what poisoned links 1 and 49. Live-Postgres only:
  // without a store it SKIPs rather than inventing passes. Proven standalone 2026-10-12: 25 PASSED /
  // 0 FAILED / 0 SKIPPED, exit 0, cleanup link GPW-90 green.
  { file: 'grocery_price_write_durability_test.js' },                                              // 65
  // Push delivery truthfulness (owner REAL-BACKEND-FIRST POLICY §2/§3). Two false successes at the
  // push boundary, both measured 2026-10-12: `FcmV1PushProvider.sendPush` returned
  // `success:true` with a `providerMessageId` minted from `Date.now()` while NO dispatch exists
  // anywhere under src/ (PDT-A0 proves it from the file), and `src/server.js` chose the adapter from
  // FIREBASE_* alone, so a production instance without credentials silently got
  // `MockSandboxPushProvider` and wrote DELIVERED rows for notifications no device received. Either
  // way `notification_deliveries` — an audit table — stored proof of an event that did not happen.
  // The fix refuses instead of inventing: `PUSH_DELIVERY_NOT_IMPLEMENTED` from the credential-only
  // FCM provider, `PUSH_GATEWAY_NOT_CONFIGURED` from the sandbox when `NODE_ENV=production`, and
  // `resolvePushProvider()` as the single adapter decision, matching the rule
  // `SmsGatewayService.resolveProvider` already enforces (PDT-F50 pins that as the convention).
  // Chain-safe by construction: it starts no server, opens no port, touches no store — the service
  // takes its repository as a constructor argument, so a recording fake is the whole harness. Group
  // D proves development push still works after the fix, so this link cannot be satisfied by
  // switching the feature off. Proven standalone 2026-10-12: RED 11/19 (8 failed, exit 1) before the
  // fix, GREEN 20/20 (exit 0) after.
  { file: 'push_delivery_truthfulness_test.js' },                                                   // 66
  // LEDGER WRITE HONESTY: a money write the store refused must not be reported as booked. Two
  // swallowed refusals in the settlement path, both measured rather than inferred. (a) The
  // double-entry repository inserted the `journal_transactions` header and read only one of the
  // engine's answers, so 42P01 (unmigrated schema), 23503 (dangling `job_id`), 22001 (VARCHAR(80)
  // `transaction_id`) and a keyless 23505 all fell through to a mirror entry stamped POSTED — and
  // the `journal_lines` insert was awaited with its result never read, so a header with no legs
  // was reported as a balanced posting. (b) `updateJobStatus` caught `driverRepo.updateEarnings`
  // and `console.warn`ed it, leaving `earnings` at `{duplicate:false, posted:false}` — exactly the
  // offline-mirror answer — so a refused wallet credit still booked the NET journal row the RPC
  // never made, added ₹425 to the cached wallet, counted the trip, debited the customer and
  // returned the job COMPLETED. Every throw out of `updateEarnings` is a deliberate refusal
  // (DRIVER_NOT_FOUND, MONEY_OPERATION_IDENTITY_REQUIRED, DRIVER_NOT_DURABLE, the idempotency
  // conflict, or the store's own failure), so the catch turned a guard into a bypass; the
  // settlement's own guard 40 lines earlier already states the rule a rejected persistence write
  // must abort rather than proceed on in-memory state.
  // Evidence shape: each SQLSTATE is faked at the wire in supabase-js' own `{data,error}` form,
  // because a refusal of a specific constraint cannot be provoked against a store this suite is
  // not allowed to write to. Nothing is persisted — the client points at a closed port, `db.save`
  // is a no-op, no HTTP request is sent and no table outside the two journal tables is addressed.
  // The positive controls (LWG-12, LWG-13, DEC-09) are what make the refusals meaningful: with a
  // cooperating store, and with no store configured at all, the same calls still post exactly once
  // and still settle exactly one trip. Proven standalone 2026-10-12: RED 23/32 (9 failed, exit 1)
  // before the fix, GREEN 32/32 (exit 0) after.
  { file: 'ledger_write_guard_test.js' },                                                            // 67
  // BOOKING WRITE HONESTY (#279): a customer's ride or parcel booking write that PostgreSQL
  // refused must never be reported as created. `NabinDatabase.createJob` caught every error from
  // `JobRepository.create`, logged a warning, and unshifted the job to `this.jobs` anyway — returning
  // a success object with id, OTP, and fare for a trip that was never in the database. Furthermore,
  // `JobRepository.create` previously wrote to `this.db.jobs` while `createJob` also unshifted, creating
  // duplicate mirror rows on accepted bookings.
  // This link pins: store refusals (42P01, 23503, 22001, 23505, network failure) fail closed,
  // no phantom mirror row is added, engine SQLSTATEs are propagated typed and classified, and
  // both routes (/api/customer/book-ride and /api/customer/book-parcel) classify store failures
  // through `replyStoreError`. Pure unit test: fakes the store at the wire in supabase-js's shape,
  // touches no live database, writes nothing to disk. Proven standalone: RED 3/20 before, GREEN 20/20 after.
  { file: 'booking_write_guard_test.js' },                                                           // 68
  // CHAIN-RUNNER SELF-GUARD (#289): the advisory `OTP_THROTTLED` column is the runner's own parse
  // of a link's stdout, and `#288` gave it a false positive it cannot see — the truthful audit action
  // `AUTH_OTP_DISPATCH_FAILED` (src/database.js:6570) contains the literal `OTP_DISPATCH_FAILED` the
  // heuristic greps for, so link 8 printed `OTP_THROTTLED` on a 22/22, exit-0 run, i.e. the run record
  // asserted a throttle nobody observed. This link calls the REAL `scanOutput` (the `require.main`
  // seam above exists so that requiring the runner starts no chain) over verbatim PASS lines lifted
  // from `chain_20261012_134303_53804_ee8534`: the action name must not flag, while the server's error
  // code (src/server.js:1221) and the limiter's own copy still must. Hermetic — no database, no
  // network, no port, nothing written; it asserts the evidence-directory count is unchanged across
  // the require. Proven standalone 2026-10-12: RED 12/16 (HTH-02..05, exit 1) before the narrowing,
  // GREEN 16/16 (exit 0) after, and its own log now parses as `16 passed, 0 failure marks`.
  { file: 'chain_throttle_heuristic_test.js' },                                                      // 69
  // AUTHORITATIVE DOUBLE-ENTRY LEDGER & RECONCILIATION AUDIT:
  // Mathematical balance invariant (total_debit == total_credit on 100% of journal transactions),
  // line item symmetry (sum(DEBIT) == sum(CREDIT)), referential integrity against ledger_accounts,
  // atomic rollback on constraint violation, fail-closed handling on store rejection,
  // duplicate request deduplication, idempotency conflict rejection (409), refund ceiling enforcement,
  // cross-process persistence durability, and reconciliation discrepancy detection between Book 1 and Book 2.
  // Connects directly to local Docker PostgreSQL; loopback guarded; cleans up disposable probes.
  { file: 'ledger_double_entry_reconciliation_test.js' },                                            // 70
  // CHAIN TARGET GUARD: the runner must refuse a store its links will actually reach, not only one
  // the shell happens to export. `src/server.js:2`/`src/supabase.js:2` fill any unset key from
  // `backend/.env`, whose SECTION A active default is the hosted dev project, so the old
  // `process.env`-only check was silent on exactly the invocation `package.json` ships
  // (`"test": "node scripts/test_chain.js"`). Measured: `chain_20261012_025418_25828_8f0de6` and
  // `chain_20261012_144509_6704_f5972d` both booted "environment: testing (project
  // ywhxkzmbwppkdemvzlhv)" while the guard printed nothing. Proven standalone 2026-10-13: RED with
  // the module absent, GREEN 25/25 (exit 0) after, and its one executed probe spawns the real
  // runner against a fixture host that cannot resolve, so it boots no harness and writes nothing.
  { file: 'chain_target_guard_test.js' },                                                            // 71
  // CHAIN RUNNER GUARD: the runner now proves its own harness child is alive before each link (a dead
  // child is reported once as HARNESS_UNREACHABLE, not as dozens of fabricated suite failures), and it
  // claims the harness port with an atomic single-runner lock (a second live runner is refused by name,
  // not blamed on "the manually-started backend"). Every check runs against the real exported helpers in
  // a temp directory — no harness, no database, no socket — so the suite is safe as an in-chain link.
  { file: 'chain_runner_guard_test.js' },                                                            // 72
  // ADMIN CAMPAIGN CONTRACT GUARD: the console's campaign surface claimed things the store never
  // confirmed. Measured in the shipped file before the fix: `ad.bidRateCpm.toFixed(2)` on a field
  // `mapRowToDTO` answers null threw a TypeError inside the row map, `loadPromotions` swallowed it in
  // its own catch, and the campaign table painted zero rows over 3 durable campaigns; the Revenue KPI
  // printed `₹NaN.00` from `adRevenueEstimate`, which the GET route deliberately never sends; and both
  // write payloads named keys on the repository's `UNSUPPORTED_FIELDS` list, so every create/edit was a
  // guaranteed 400 `ADVERTISEMENT_FIELD_UNSUPPORTED` the handler reported as live. This is the same
  // static-over-`admin_dashboard.html` shape as link 55, plus the repository module's own refusal
  // filters so the storable set is measured rather than restated from an export list. Proven
  // 2026-10-13 against the two real files: RED 3/11 (exit 1, 8 named failure sites) on the HEAD
  // snapshot, GREEN 11/11 (exit 0) on the fixed file. It starts no server, opens no socket and writes
  // nothing to any store — `require` of the repository builds a Supabase client but issues no query.
  { file: 'admin_campaign_contract_test.js' },                                                       // 73
  // RMS WRITE HONESTY GUARD: the restaurant merchant routes refused to fail. Measured in the shipped
  // repository before the fix, 4 durable write sites over 3 tables (the `merchants` UPDATE in
  // `_persistSettings`, the two `restaurant_sections` INSERTs in `_ensureSection`/`createSection`, the
  // `restaurant_tables` INSERT in `createTable`) discarded the engine's answer — supabase-js resolves
  // `{data, error}` rather than rejecting — so a refused insert printed `[RMS] … persistence failed …`
  // with `console.warn`, committed the row into the constructor's Map and the route answered
  // `{success: true}` for a row that exists only in that process. All 20 mutation routes of the family
  // at `src/server.js:5691-6159` (31 registrations, 11 of them reads) named neither the store that
  // holds the row nor a store-failure branch. And a blanket label would have been a new lie: migration
  // 041 creates 7 `restaurant_*` tables, 5 of which have zero `.from(…)` references anywhere in the
  // repository, so a bill, session, reservation, KDS ticket or staff row is in-memory whatever the
  // durability gate says — hence the per-domain `dataSourceFor()` map the guard reads back. Proven
  // 2026-10-13: RED 5/20 (exit 1) on the pre-fix source, GREEN 20/20 (exit 0) after, with the durable
  // branches actually executed against a store faked at the wire. It opens no real socket and writes
  // nothing: the child gets `SUPABASE_URL=http://127.0.0.1:59999` with `DATABASE_URL` blanked, and the
  // parent only reads three source files.
  // Re-measured 2026-10-14 at 24/24 (exit 0): RMSH-16/17 filter on `verb !== 'get'`, so the eleven GET
  // routes of the same family were unguarded by construction, and RMSH-24 now closes that by requiring
  // every RMS registration — reads included — to carry both `dataSourceFor(…)` and a `replyStoreError`
  // branch. The behavioral half of that read channel is link 75.
  { file: 'rms_write_honesty_test.js' },                                                             // 74
  // RMS READ ROUTE ERROR CHANNEL GUARD (#310): the read half of the family above. Eleven GET routes
  // answered a failed durable read as the caller's mistake — `bill` and `receipt` with 400, the other
  // nine with a bare 500 carrying `err.message`, which is the sentence PostgreSQL printed — while
  // every mutation in the family named its store. None of the eleven labelled `dataSource`, so a
  // restaurant could not tell a bill held in this process's Maps from one read out of PostgreSQL.
  // Each route now answers through `replyStoreError` (src/server.js:347), which classifies 503
  // STORE_UNAVAILABLE vs 500 SCHEMA_NOT_READY from the SQLSTATE and logs the engine's words instead
  // of echoing them, and stamps `dataSourceFor(domain)`. 53 checks: the real Express routes over real
  // HTTP on an ephemeral port, 11 routes × 3 injected store conditions (unreachable → 503, 42P01
  // refused → 500 SCHEMA_NOT_READY, `_rejectMemoryFallback` under NODE_ENV=production → 503), plus
  // the non-store conditions each route must keep (400 session-not-found, 404 RECEIPT_NOT_FOUND,
  // 400 INVALID_DATE_RANGE, 500 for our own bug, 401 unauthenticated) so an outage fix cannot swallow
  // them, and the dataSource of every read is compared against the repository's own per-domain map.
  // Chain-compatible as measured 2026-10-14: 53/53 exit 0 with the durability gate OPEN through
  // `scripts/with_local_target.js` (1,608 ms, every domain labelled postgres) and 53/53 exit 0 with
  // the gate CLOSED (48,356 ms, every domain labelled memory) — RRC-02/RRC-40 read the gate rather
  // than assume a mode, which is what keeps this green in both instead of green here and red there.
  // It writes nothing (GET only, and the 8 routes whose read the local store cannot serve are
  // stubbed at the repository), touches no fixture table, and sets `PORT=0` because
  // src/server.js:11061 ends a module-scope startup in `server.listen(PORT || 4000)` — without that
  // this link would race the shared harness for :4000.
  { file: 'rms_read_channel_test.js' },                                                              // 75
  // RMS POSTGRESQL DURABILITY SUITE, registered as an isolated link on 2026-10-15 once #283's split
  // target was closed. It was refused registration for the opposite reason: its direct-verification
  // client read `LOCAL_POSTGRES_URL || <fixed local DSN>` and never `DATABASE_URL`, so an isolated link
  // would have asserted against `public` while the repository wrote `chain_scratch`. Both halves of that
  // are now measured fixed — the handle reads `LOCAL_POSTGRES_URL || DATABASE_URL || <same default>`, and
  // every statement in the suite names its tables UNqualified. The qualification was the real defect and
  // it failed the other way round first: the first isolated run wrote `chain_scratch.merchants` through
  // the RPC and then reported `takeaway_enabled` unchanged, because the read still said
  // `FROM public.merchants` (45 read sites, plus the `UPDATE public.merchants` restore that silently
  // dirtied the seed merchant's rates in `public` and reddened a different suite's tax maths). Measured
  // 2026-10-15 on a freshly provisioned clone: 27/27, exit 0, `verify` CLEAN (10 protected public tables
  // unchanged), and the 26-line public census byte-identical before and after, including T-101's QR token
  // and the seed merchants' rate columns. It cannot report green without the durable path: `!isLivePostgres`
  // and `!(nabinEnv.restLocal)` both throw before the first check. Standalone on the guarded local store
  // stays green too: 27/27, exit 0.
  { file: 'test_rms_postgres_durability.js', isolated: true,                                          // 76
    subtotalPattern: /ALL (\d+)\/\d+ RMS POSTGRESQL DURABILITY TESTS PASSED/ },
  // RMS UPI / BILLING / SALES SPECIFICATION SUITE, registered next to it on the same evidence. This one
  // writes real rows and its own fixture hygiene deletes them again (measured per run: 10 fixture tables,
  // 10 orders with their lines and tickets, 11 dish rows, 1 customer, UPI settings cleared on the 2 seed
  // test restaurants), which is exactly what `isolated` exists to contain; its verification handle takes
  // the same `DATABASE_URL` now for the same reason. Test 16 was the last split: it asked the catalog with
  // `'public'` pinned in eight places, so on a clone it described a schema the run never touched. It asks
  // `current_schema()` and passes that to the pg_class/pg_namespace, pg_constraint, pg_indexes,
  // information_schema.tables/columns/sequences filters and the function `search_path=` pin check, and it
  // reads constraint labels from `pg_class.relname` rather than `conrelid::regclass::text` — regclass
  // shortens by search_path, so one constraint prints `restaurant_tables` in `public` and
  // `public.restaurant_tables` from a handle pinned elsewhere. Measured 2026-10-15: 17/17, exit 0 both
  // standalone on the guarded local store and as an isolated link on a fresh clone, `verify` CLEAN and
  // zero public census drift either way.
  { file: 'test_rms_upi_billing_sales_complete.js', isolated: true,                                  // 77
    subtotalPattern: /ALL (\d+)\/\d+ RMS SPECIFICATION TESTS PASSED/ },
  // FINANCIAL-FIXTURE KEEP RULE, registered as a link 2026-10-16 because a rule that protects rows has
  // to be run where it can break them. `test_fixtures.js` skips `payments` and `payment_sessions` by name
  // in cleanup() (KEPT_FINANCIAL) because the append-only ledger/journal rows documenting that money carry
  // a BEFORE DELETE OR UPDATE trigger that refuses 23514 for every role, so a money delete half-reaps the
  // audit (measured on the local store 2026-10-16: 170/170 job-carrying ledger rows and 85/587 journal
  // rows share a `job_id` with a `payments` row; 698/879 payments are additionally protected by
  // `payment_refund_authorizations.payment_id` NO ACTION, refused 23503). This suite clones `public` into
  // two disposable schemas, mints money under a fixture-owned customer, and calls the REAL cleanup()
  // against both — so it exercises the delete path that a refusal, not a policy, used to guard — and
  // asserts the money survives, the owning customer stays with it, no ledger or journal row is orphaned,
  // records this handle does not own are untouched, and FKP-26 compares a 9-table census of `public`
  // before and after (measured identical). It writes only into `nabin_fixture_keep_probe_*`, drops those
  // schemas itself, and resolves its target through the same `chain_target_guard` as every other handle,
  // so a non-loopback store is a refusal before the first socket.
  // Why the ordinary chain does not trigger the rule on its own — structural, not luck: of the nine suites
  // that call `openFixtures()`, exactly one reaches a money route (`customer_order_read_reliability_test.js`
  // COR-39) and it calls `/api/payments/create-order` against an injected store outage while asserting the
  // 503, so no `payment_sessions` row is ever minted for a fixture customer. Measured in
  // `chain_20261016_100446_29604_e5e519`: no link log carries a `kept` object. The suites that DO mint
  // money rows are not fixture consumers at all — `test_phase5_payments.js` and the four
  // `payment_*_test.js` suites each contain zero references to `test_fixtures` — and phase5 runs `isolated`,
  // so its rows are discarded with the clone schema rather than surviving into `public`. Deleting
  // KEPT_FINANCIAL would therefore have reddened no link: the chain's residue checks count users, merchants,
  // orders and tickets, not the audit rows a reaped money row would leave orphaned behind.
  { file: 'test_fixtures_keep_rule_selftest.js' },                                                    // 78
  // MEDIA SECURITY PHASE 2, registered as an ISOLATED link 2026-10-17. It is not a `test_rms_e2e_integration`
  // style exclusion: that suite is barred because it injects its tokens into `db.activeSessions` of its OWN
  // process and can therefore never answer on a harness it does not start. `media_security_test.js` instead
  // boots its own backend on an ephemeral `findFreePort` and authenticates through the REAL routes
  // (`/api/admin/login` + `/api/auth` OTP via `createLogin`), so it is harness-agnostic and isolatable.
  // Why `isolated` is the correct lane and not a split-target: the suite reads durable ownership through a
  // raw `pg` Client AND writes it through `supabaseAdmin` (PostgREST). `scripts/chain_scratch.js` points the
  // link at BOTH `DATABASE_URL=…options=-c search_path=chain_scratch` (so the unqualified `media_assets` in
  // `pgRow`/cleanup resolves to the clone) and `SUPABASE_URL=http://127.0.0.1:<proxy>` whose profile rewrite
  // sends PostgREST writes to the same `chain_scratch` schema. The two handles cannot diverge, which is the
  // exact #283 condition the brief sets as the gate for registering a media suite at all.
  // `media_assets` also joined `scripts/protected_tables.js` PROTECTED the same day, so this link is guarded
  // per-run: an isolated media write that did not restore the clone's media_assets count would redden `verify`.
  { file: 'media_security_test.js', isolated: true,                                                    // 79
    subtotalPattern: /PASSED: (\d+)\s+FAILED: (\d+)/ },
  // MI-6 (P0): an admin suspension of a storefront has to reach the store that enforces it.
  // `db.setRestaurantStatus()` used to write only the in-process `this.restaurants` mirror, answer
  // `success: true` and post a `RESTAURANT_SUSPENDED` audit row, while every place that decides
  // whether a storefront may trade — `OrderRepository.resolveMerchant()`, the closure gate on
  // `POST /api/customer/book-food` and `GET /api/restaurants?openNow=true` — reads `merchants.is_open`
  // from PostgreSQL. Nothing ever wrote that column, so the control was decorative. This is exactly
  // the guarantee the repo says must not live in a hand-run file (see the `merchant_auth_failclosed`
  // link above): a fail-closed privilege gate that only a person remembers to run is a gate that
  // quietly reopens. 24 checks, and the three halves that make it worth pinning: it asserts on the
  // DURABLE row and on a SECOND, freshly spawned process, so a fix that only moves one process's
  // memory cannot pass; it proves the refusal paths (typed 503 when the store declines the write,
  // 400 for an id with no row, no `success: true`, no audit trail) rather than only the happy path;
  // and since 2026-10-18 it pins the OTHER half of the same defect class — a write can be durable and
  // still not be enforced, because `MERCHANT_CLOSED` was gated at exactly one of the two order-creation
  // routes. `POST /api/grocery/checkout/validate` is misnamed: it writes the durable checkout AND the
  // order row, so a suspended GROCERY storefront kept taking orders. MSD-18..24 suspend a grocery store
  // and require the 403 to precede item resolution, to write no durable row, and to lift on reopen.
  // Re-measured 2026-10-19 at 27 checks, because MI-5 changed what "a store that may trade" means: a
  // registration now lands PENDING and closed, so this suite's own stores have to be approved before they
  // can be suspended. MSD-01/MSD-18 assert the durable PENDING-and-closed landing, and MSD-01A/18A/25
  // drive `POST /api/admin/merchants/:id/approval` — deliberately NOT the legacy
  // `POST /api/admin/restaurants/:id/status` route, because link 92 MOA-16 pins that route as unable to
  // open a pending store, and using it as setup here would hide the defect MOA-16 exists to catch.
  // It runs in the shared lane, not `isolated`: it needs the seeded merchant `…0201` to prove a
  // suspension does not disturb it (MSD-15), which a `chain_scratch` clone is not obliged to carry.
  // Its own rows are its own business — it creates three merchants (RESTAURANT + GROCERY + probe) and one
  // customer, boots its own backends on ephemeral `findFreePort` ports so it never touches :4000, and
  // deletes exactly those rows in a `finally` (re-measured 2026-10-19 on the local Docker target:
  // standalone run, 27/27, exit 0, `merchants` 83->83 net-zero, `users`/`products`/`orders`/`checkouts`/
  // `merchant_grocery_inventory`/`admin_accounts` unchanged). Two groups stay, and both are reported as
  // attributed per-link drift rather than hidden: +22 `audit_logs` rows (was +19 before the approval
  // lifecycle; the three extra are the `MERCHANT_APPROVED` decision lines the new setup writes), which
  // migration 022 makes append-only and undeleteable by design, and +2 `backend_sessions` minted by the
  // `/api/admin/login` calls. Those session rows belong to the SHARED seeded `superadmin`, not to this
  // run — the only handle that would match them is the username, and deleting by username would sweep
  // other runs' admin sessions. That is a shared-record delete performed to tidy a census, so the suite
  // leaves them and the census names them.
  { file: 'merchant_suspension_durability_test.js',                                                   // 80
    subtotalPattern: /MI-6 MERCHANT SUSPENSION DURABILITY: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-1 (P0): who may read a payment session. `GET /api/payments/session/:orderId` returned the row
  // to any authenticated bearer, because the ownership comparison only ran
  // `if (callerUuid && sessionCustomerUuid && …)` and a DRIVER principal's id never resolves through
  // `resolveCustomerUserUuid` — so `callerUuid` was null, the check was skipped, and the route answered
  // 200 with another customer's checkout: uuid, amount, service type, job linkage, gateway `key_id`
  // and the whole `metadata` blob. A MERCHANT whose id happened to be a uuid was refused for the wrong
  // reason (a customer mismatch, not a role gate), which is the state that silently reopens when the
  // id shape changes — so both halves are asserted, plus that an unprovable owner is a refusal and that
  // a refusal never puts the session in the body. 23 checks; measured 2026-10-18 in-chain exit 0,
  // 23 passed, and `payment_sessions` does not grow because every row it mints is deleted by its own
  // `order_id`. What it does leave is named by its per-link drift line: +5 `backend_sessions` and +14
  // append-only `audit_logs` rows.
  // It spawns its own backend on `findFreePort`, so it never touches :4000, and it loads
  // `scripts/chain_target_guard`, so a non-loopback target is a refusal at load rather than a read
  // against the hosted project.
  { file: 'payment_session_role_test.js',                                                            // 81
    subtotalPattern: /PASSED: (\d+)\s+FAILED: (\d+)/ },
  // MI-3 (P0): the driver-facing payout route had no failure channel at all. Express 4.22.2 does not
  // forward a rejected async handler to an error middleware, and `POST /api/driver/payout` awaited
  // `db.recordPayout(...)` with no try/catch — so when `LedgerRepository.adjustWallet` threw
  // `IDEMPOTENCY_CONFLICT` (one key, two different financial semantics) the request never got a
  // response and the caller was left holding a hung money socket with no way to know whether the
  // balance moved. The sibling admin payout route and `POST /api/finance/refund` already answer 409
  // for a conflict and 503 for a genuine outcome-unknown; this link holds the driver route to that
  // same channel, and asserts the movement from `drivers.wallet_balance` in the store, never from a
  // response body. 11 checks; measured 2026-10-18 standalone 11/11, exit 0. The 503 branch is present
  // by construction (only `IDEMPOTENCY_CONFLICT` is special-cased) and a real store outage is driven by
  // `driver_operations_test.js` OPS-5x, so this suite does not fake one. Its residue is the documented
  // money keep-rule, not an omission: it drains its disposable driver's wallet to 0 through the audited
  // path and then `DELETE FROM drivers … WHERE NOT EXISTS (journal_lines / driver_payouts)`, which
  // returns rowCount 0 for a driver whose payouts are durable history. Measured in-chain 2026-10-18,
  // exit 0, 11 passed: +1 `users`, +1 `drivers`, +3 `driver_payouts`, +3 `journal_transactions`,
  // +6 `journal_lines` — one probe's worth of money history per run, which the census attributes
  // rather than hides.
  { file: 'driver_payout_route_failure_channel_test.js',                                             // 82
    subtotalPattern: /DRIVER PAYOUT ROUTE FAILURE CHANNEL: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-7 (P0): the support-thread write route let an unresolvable identity reply inside — and read out
  // of — another customer's ticket. `SupportTicketRepository.addMessage` compared the caller to the
  // ticket owner only `if (callerUuid && ticketOwnerUuid && callerUuid !== ticketOwnerUuid)`, and
  // `resolveUserUuid` returns null for any handle that is neither a uuid nor a mapped/seeded account.
  // Because `restoreSession` adopts a persisted `backend_sessions` row with its `entity_id` verbatim as
  // long as the row carries an `entity`, a bearer whose handle names no account skipped the comparison
  // entirely: `POST /api/support/ticket/:id/message` has no route-level ownership check of its own and
  // answers with the whole updated thread, so the refusal never happened and the thread came back.
  // Measured 2026-10-18 before the fix: 20/28, and the three failures were all the same defect — one
  // ghost session per role (CUSTOMER, MERCHANT, DRIVER) each returned HTTP 200 with the thread in the
  // body and wrote into it, growing customer A's ticket from 2 messages to 5. The suite also records
  // what was ALREADY refused, so the class is closed rather than the instance: a proven stranger, and
  // a resolvable DRIVER and MERCHANT bearer (those two only by uuid inequality, never by a role gate —
  // the MI-1 lesson), plus the sibling `createTicket` boundary that already fails closed with 401.
  // After the inverted condition: 28/28, standalone, exit 0, and the durable thread ends at exactly the
  // four messages this run legitimately wrote. Local Docker only (it refuses a non-loopback backend or
  // store, and refuses a mock branch where the comparison is plain id equality); it owns and deletes
  // its ticket by id and its three ghost sessions by `token_hash`, and deliberately keeps the shared
  // seeded customer/driver/merchant sessions other links reuse — the census names both halves.
  { file: 'support_ticket_thread_ownership_test.js',                                                 // 83
    subtotalPattern: /SUPPORT TICKET THREAD OWNERSHIP: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-8 (P0): the same fail-open ownership comparison, on the WRITE half of the money record.
  // `PaymentRepository.verifyPaymentSession` guarded with `if (callerUuid && sessionUuid && callerUuid
  // !== sessionUuid)`, so the check vanished whenever EITHER side failed to resolve — `resolveCustomerUuid`
  // returns null for a handle that is neither a uuid nor a mapped/seeded account, and
  // `payment_sessions.customer_id` is NULLABLE. That matters more here than on the read route because two
  // of this method's three branches (client-reported FAILED and CANCELLED) require NO gateway signature
  // and write the row's durable status, so ownership was the only authorization layer on those writes.
  // Measured 2026-10-18 before the fix: 20/25, exit 1, and both null-side vectors were real — any
  // signed-in customer flipped an ownerless (`customer_id IS NULL`) session to FAILED with its own
  // `failureReason` and left an `audit_logs` row attributing the event to `usr_cust_anon`, the
  // `getPaymentSession` fallback handle; and a bearer whose `entity_id` named no account still passed
  // `authenticateUser` because `customerSessionRefusal` accepts a persisted `backend_sessions` row whose
  // `phone` matches an active account, and moved ANOTHER customer's INITIATED session to FAILED.
  // After the inverted condition (new 403 `SESSION_OWNER_UNRESOLVED` when either side is unresolvable,
  // existing `CUSTOMER_MISMATCH` when they disagree): 25/25, exit 0. It records rather than re-litigates
  // what was already closed — the SUCCESS branch is fail-closed on `PAYMENT_KEY_SECRET` with a
  // constant-time HMAC over `orderId|paymentId` (untouched, and this suite performs no capture so it
  // mints no money rows), and the route's bearer gate is already CUSTOMER-only, so a DRIVER/MERCHANT
  // token never reaches the repository. `payment_sessions` does not grow (6 rows minted, 6 deleted by
  // `order_id`; both ghost `backend_sessions` rows deleted by `token_hash`); what it leaves is the same
  // documented residue links 81/83 keep — the shared seeded customers' sessions and the append-only
  // `audit_logs` trail from the legitimate owner-reported refusals-that-didn't-happen. Local Docker only:
  // `chain_target_guard` refuses a non-loopback target at load, and the live-Postgres check refuses a
  // mock branch where the comparison is plain id equality.
  { file: 'payment_verify_ownership_test.js',                                                        // 84
    subtotalPattern: /PAYMENT VERIFY OWNERSHIP: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-9 (P0): the same fail-open ownership comparison on the customer ORDER read, at the fourth
  // measured instance of the class. `app.get(['/api/customer/orders/:id', '/api/orders/:id'])`
  // guarded with `if (customerUuid && order.customer_id !== customerUuid)`, so the IDOR check
  // vanished whenever the CALLER side failed to resolve: `OrderRepository.resolveUserUuid` returns
  // null for a handle that is neither a uuid nor a mapped/seeded account, `restoreSession` adopts a
  // persisted `backend_sessions` row's `entity_id` verbatim, and `authenticateUser`'s own account
  // check (`customerSessionRefusal`) falls back to the session's PHONE — so a session naming no
  // account still passed the bearer gate whenever its phone matched an active customer, and
  // `req.user = session.entity || …` handed the handler that unresolvable handle.
  // Measured 2026-10-18 before the fix: 23/27, exit 1, and all four failures were one defect — the
  // ghost bearer was answered HTTP 200 with another customer's whole order, leaked body included, on
  // all three doors (order uuid, ORDER NUMBER, and the second route registration). Which half of
  // the pair can be unresolvable is schema-dependent, so this suite measures it rather than
  // inheriting link 84's answer: `orders.customer_id` is `UUID NOT NULL` (read back from
  // `information_schema.columns`, not quoted from the DDL), so only the caller side is reachable —
  // there is no ownerless-order vector here. What was ALREADY correct is recorded, not re-litigated:
  // the resolvable stranger's 403 by both spellings, the owner's own read, the real DRIVER and ADMIN
  // bearer refusals, anonymous/invalid 401, a genuinely absent order still 404, and the sibling
  // `/api/customer/activity` boundary that already fails closed on a null uuid.
  // After the inverted condition (identity check FIRST, before any read, so a ghost gains no
  // existence oracle; 403 `CUSTOMER_IDENTITY_UNRESOLVED` for class consistency with MI-7/MI-8):
  // 27/27, standalone, exit 0, and 27/27 in-chain. Every durable row is fixture-owned and reaped by
  // id (`orders` measured net-zero across the run) and the three ghost sessions are deleted by
  // `token_hash`; the residue it prints and the census attributes is +2 `backend_sessions` (the
  // SHARED seeded driver's cached token and this run's own `/api/admin/login` session) and the
  // append-only `audit_logs` rows written in its window. Local Docker only: `chain_target_guard`
  // refuses a non-loopback target at load and the live-Postgres check refuses a mock branch where
  // the comparison is plain id equality.
  { file: 'order_read_ownership_test.js',                                                            // 85
    subtotalPattern: /ORDER READ OWNERSHIP: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-4 (P0), the half that originates at the mint: `verifyAuthOtp`'s DRIVER branch resolved the
  // entity by normalized phone and, when NOTHING matched, left `entity` undefined and issued a session
  // anyway — the MERCHANT and ADMIN branches of the same function already refused — storing
  // `entityId: 'anon'`. `authenticateDriver` then ran `session.entity || db.getDriver('anon')`, and
  // `getDriver` ends in `|| this.drivers[0]`, so an unregistered number was served as the first seeded
  // driver: his wallet, his earnings, his notification identity, and (because `backend_sessions` is
  // durable and `hydrateSessions` adopts any unexpired row) for the token's full 30-day TTL across a
  // restart. This suite holds the auth layer: unenrolled DRIVER phone refused with a typed 401 and no
  // token minted, no session registered for it, no live DRIVER session resolving to a driver it does
  // not name, a legitimately enrolled driver still signing in bound to ITS OWN id, `restoreSession`
  // declining a persisted entity-less row while still adopting one that carries its entity,
  // `getDriverStrict` answering null for `anon`/unknown/empty, the shared `getDriver` catch-all left
  // intact for its traced non-auth callers, and a role string outside the four branches ('driver',
  // 'ADMINISTRATOR') refused instead of minting an `anon` bearer. Measured 2026-10-18: 17/17, 0 failed.
  // In-process only (no spawned backend), owns and deletes its `drivers`/`users` fixture rows by id.
  { file: 'driver_unenrolled_phone_elevation_test.js',                                               // 86
    subtotalPattern: /MI-4 UNENROLLED DRIVER ELEVATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-4 (P0), the same bearer over HTTP, with the forged row written DURABLY before boot so the
  // boundary — not just the mint — is exercised: an unresolved DRIVER session is refused 401 by both
  // earnings routes and by the device-token route, causes no `device_tokens` write for anybody, an
  // unenrolled number gets neither a token nor a durable session row, a registered driver is served its
  // own ₹1,337 wallet instead of the fallback driver's ₹2,909.40, and the fallback driver's durable
  // wallet is unchanged across the whole run. Deliberately NOT exercised: the payout route with a
  // forged bearer, because the identity it would reach is a shared seeded record whose payout-destination
  // cooling window can lapse and make the call real — money safety over boundary completeness. Allocates
  // its own free port, spawns its own backend, refuses a non-loopback target, and reaps its own
  // `device_tokens`, `backend_sessions` (forged row by `token_hash`, minted rows by normalized phone)
  // and `drivers`/`users` fixture rows. Measured 2026-10-18: 10/10, 0 failed.
  { file: 'driver_identity_substitution_route_test.js',                                              // 87
    subtotalPattern: /MI-4 DRIVER IDENTITY SUBSTITUTION \(ROUTES\): (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-4 residual (P1): the same first-entity substitution one layer down, on the paths that aim an
  // effect at a person named by a PARAMETER rather than by the caller's bearer. `getDriver`/`getUser`
  // end in `|| this.drivers[0]` / `|| this.users[0]`, so neither can answer null and every `if (!user)`
  // written beneath them is unreachable — an id resolving to nobody was read as the first seeded
  // account of that kind. Measured 2026-10-18 at HEAD 23ee5d1 in a detached worktree: 7/21, exit 1,
  // and the failures were money, not reads — a ghost CUSTOMER adjustment returned success and moved
  // `users[0]` 450→500, a ghost DRIVER 2380→2430, ONE idempotency key spanned two different target
  // ids because the key is built from the resolved account's uuid, `setDriverStatus(GHOST)` suspended
  // `drivers[0]`, an unresolvable ticket refunded and paid its bounty into the fallback accounts, and
  // `POST /api/driver/vehicle/photo` answered 200 for `DRV-101`. After strict resolution at every
  // executable call site, plus the durable-aware `get*StrictAsync` pair so a real-but-unhydrated
  // account is served as ITSELF rather than refused (that refusal would have been a NEW outage):
  // 21/21, exit 0. It owns and deletes its fixture `users`/`drivers` rows and its own `media_assets`
  // rows by exact public id, books no money (ledger/audit repos detached in-process), and ISR-19
  // proves the run persisted exactly the assets it names. ISR-20/21 are the class guards: no
  // executable `getDriver(`/`getUser(` call survives in either production file, and the first-element
  // fallback inventory is exactly the five documented dev-mirror shapes. ISR-18 runs BY DEFAULT: the
  // fixed answer is a 404 that persists nothing, which is exactly what the chain has to measure. Under
  // the UNFIXED tree that route upserts `nabin/users/<users[0].id>/avatar`, so a before-fix run has to
  // opt out with `ISR_SKIP_CUSTOMER_ROUTE=1` rather than overwrite a seeded account's media row — and
  // that opt-out cannot be expressed as a per-link `env` here, because of the runner gap below. Starts
  // its own backend on a port it allocates itself, and refuses a non-loopback backend or store.
  // RUNNER GAP, measured 2026-10-18: `runLink` never reads a registry link's `env` map at all — the env
  // a suite is spawned with is baseEnv + the four base-URL variables (`NABIN_TEST_BASE_URL`,
  // `GEO_TEST_BASE`, `NABIN_API_URL`, `CHAOS_BASE_URL`), plus `NABIN_RESTART_PORT`, plus `readLinkEnv()`
  // for isolated links only (which is the `.chain-scratch/link.env` FILE, unrelated to this field). So
  // every `env: {...}` in this list is silently inert, including link 51's `NABIN_F2_REQUIRE_LIVE` — that
  // suite has been running in its permissive default mode in-chain. Anything a link must set therefore
  // has to be that suite's own default, which is why ISR-18 is default-on instead of flag-gated here.
  { file: 'identity_substitution_residual_test.js',                                                  // 88
    subtotalPattern: /MI-4 RESIDUAL IDENTITY SUBSTITUTION: (\d+)\/\d+ passed, (\d+) failed/ },
  // P2 (Major Remediation) — handover / delivery OTP security.
  // `db.validateAuthoritativeJobOtp({ jobId, otp, otpType, driverId })` compared a submitted
  // 4-digit code against the row's `start_otp` / `pickup_otp` / `delivery_otp` and advanced the
  // trip on a match, with no attempt counter (unlimited guesses), no lockout, no expiry (a code
  // minted at booking stayed valid forever), and no consumption (a code proven once could be
  // replayed for the same transition). The DELIVERY replay was incidentally blocked by
  // `updateJobStatus` refusing COMPLETED->COMPLETED, but the START replay was free and that guard
  // was a state-machine accident, not an OTP policy; the raw entered digits were also written into
  // the audit reason, so a failed guess leaked a guess. Migration 046 added per-type attempt /
  // lockout / expiry / consumption columns and `verify_job_otp_atomic` (one `SELECT … FOR UPDATE`
  // deciding lock → consumed → expired → compare → consume), and the JS now gates every live-PG
  // verify through that RPC with a fail-closed throw on any RPC error. 21 checks: three wrong
  // DELIVERY guesses durably lock the code (HOT-01..05); a correct DELIVERY settles exactly once and
  // a replay is refused by the consumed column, not the state machine (HOT-06..09); a locked START
  // leaves DELIVERY independently verifiable, which is why the lockout is per-type — a shared lock
  // would let an attacker who spams START guesses deny a legitimate handover (HOT-10); an expired
  // code is refused even when it matches (HOT-11); neither the exception message nor the audit
  // reason carries the entered digits (HOT-13/14/21); 20 concurrent correct DELIVERY submits verify
  // exactly once (HOT-15/16); a code for job G cannot verify job E (HOT-17); a caller-supplied
  // `startOtp` can no longer override the generated code — `createJob` used to spread `...jobData`
  // AFTER the minted values (HOT-18); and the fabricated `handoverOtpVerified: … || true` default is
  // gone (HOT-20). Measured 2026-10-18 standalone: before-fix 11/21, after 21/21, 0 failed.
  // In-process only (it calls the method directly, not over HTTP, so no spawned backend), like
  // link 86. It mints its own driver/customer/job fixtures through `db.createJob`, drives every
  // check through the loopback-guarded method, and deletes exactly its own `jobs`/`drivers`/`users`
  // rows by id in its cleanup; the append-only `audit_logs` rows it writes are the documented
  // undeleteable residue (migration 022) the census attributes. Local Docker only — it refuses a
  // non-loopback `DATABASE_URL` at load and skips (0/0) rather than passing on the mock branch,
  // because single-use and concurrency are properties of the durable `FOR UPDATE`, not of a Map.
  { file: 'handover_otp_security_test.js',                                                           // 89
    subtotalPattern: /P2 HANDOVER \/ DELIVERY OTP SECURITY: (\d+)\/\d+ passed, (\d+) failed/ },
  // P3 #436/#438 — the real FOOD and GROCERY delivery lifecycle, end to end. These two are the guard
  // behind the whole fix: before it, a DELIVERY-channel food or grocery order was written durably and
  // then stranded forever at READY_FOR_PICKUP, because no placement path created a `jobs` row or wrote
  // `orders.job_id`, and the KDS broadcast put the ORDER id in the `job.id` field. Measured on the local
  // store before these files existed: 0 of 1,354 orders named a job, `jobs` held 2,134 RIDE + 518 PARCEL
  // and zero FOOD/GROCERY rows, and 92 orders sat parked. 047's `create_delivery_job_atomic` mints the
  // job and the link in one transaction; `/api/driver/pickup-order` and `/api/driver/deliver-order` walk
  // the order PICKED_UP → DELIVERED. Both suites drive the SAME 12-condition scenario from
  // `scripts/delivery_lifecycle_harness.js` (two near-identical copies would drift, and the drift would
  // read as a service-specific pass) and every assertion reads PostgreSQL through the run's own `pg`
  // client — an offer set, an assignment, an OTP attempt counter and a settlement are not things a 200
  // body can vouch for. Measured standalone 2026-10-19: FOOD 20/20, GROCERY 20/20, 0 failed,
  // `residue named by this run's ids: orders 0, order_lines 0, jobs 0, dispatch_offers 0`.
  // `isolated: true`, and the reason is the row counts, not caution: one lifecycle run writes an order,
  // its two lines, an order_creation_token, 5 `order_transitions`, 4 backend sessions, its own 3 users
  // and 1 merchant, ONE `jobs` row plus (food) 1 KDS ticket or (grocery) 1 checkout, and 2,177
  // `dispatch_offers` rows — the #252 fan-out, one offer row per eligible driver (measured 2026-10-19:
  // `public.drivers` holds 2,186 rows, all AVAILABLE, and the single placement wrote 2,177 offers).
  // `orders` and `jobs` are
  // exact-counted protected names, and a settlement that ever carries earnings would write
  // `ledger_entries`/`journal_transactions`, which migration 033 makes undeleteable for every role.
  // Against `public` that is contamination the census can only attribute; against the clone it is
  // discarded with the lane. `chain_scratch` does NOT copy `dispatch_offers` (SKIP_COPY), so the lane
  // starts at zero offers and this link's own fan-out is the only set it mints — which is what makes
  // L03's "no duplicate (job, driver) pair" a clean measurement.
  // NOT `laneServer`, and that is a measured distinction rather than an omission: the harness spawns its
  // own backend from `{...process.env, PORT}` on `findFreePort()`, so the child inherits the link's
  // isolated `DATABASE_URL` (search_path=chain_scratch) AND its `SUPABASE_URL` (the throwaway PostgREST),
  // which is the exact split `laneServer` exists to close. It therefore never touches the shared :4000
  // harness — the same shape as link 79 `media_security_test.js`, whose registration note established
  // that a suite booting its own backend on an ephemeral port is isolatable by `isolated` alone.
  // Both files load `scripts/chain_target_guard` and refuse a non-loopback `DATABASE_URL` before the
  // first socket, and refuse a store that is not live PostgreSQL (exit 2), because on the mock branch the
  // job link, the offers and the OTP columns do not exist and twelve conditions would be assertions about
  // nothing. Cleanup is dependency-ordered by recorded id — offers by `job_uuid`, then jobs by id, then
  // the two drivers it inserted, then `test_fixtures`' own ownership scope — and a refused delete lands in
  // `blocked` as a red instead of being swallowed; measured `blocked: []` on both runs above.
  { file: 'food_delivery_lifecycle_test.js', isolated: true,                                          // 90
    subtotalPattern: /FOOD DELIVERY LIFECYCLE TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  { file: 'grocery_delivery_lifecycle_test.js', isolated: true,                                       // 91
    subtotalPattern: /GROCERY DELIVERY LIFECYCLE TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // MI-5 (P0): `POST /api/merchant/register` needs no credential of any kind, and until this link it
  // minted a TRADING storefront — `MerchantRepository.createMerchant` wrote `is_open: true` and a
  // fabricated `rating: 4.80` into the durable `merchants` row, there was no approval-shaped column on
  // that table at all, so `GET /api/restaurants` listed the store, both order-creation gates let it
  // take orders, and a MERCHANT OTP sign-in reached all 41 merchant-authenticated write routes. Anyone
  // with a phone number and a POST could stand up a store that publishes its own menu and sets its own
  // UPI payout destination. Migration 048 makes the decision a durable fact
  // (`approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'`, CHECK over PENDING/APPROVED/REJECTED,
  // `approval_decided_at/_by/_reason`, the 83 pre-existing rows backfilled to APPROVED), and 048 also
  // replaces the anon-readable "Public read active merchants" policy with one that requires
  // `is_open AND approval_status = 'APPROVED'`. `setMerchantApproval` is the ONLY writer of that column
  // — the profile PATCH refuses approval keys with `SELF_APPROVAL_NOT_PERMITTED`, and
  // `setRestaurantStatus` can now suspend freely but cannot open a store the platform has not approved
  // (`MERCHANT_NOT_APPROVED`), so the legacy admin status route is no longer an alternate door.
  // 38 checks, and the two halves that make it more than a happy-path test: MOA-15 re-parses
  // `src/server.js` at run time and asserts that EVERY merchant-authenticated write registration carries
  // the approval gate (`ungated.length === 0`), which turns "did we miss an endpoint" from a hope into a
  // measured check that fails the day someone adds an ungated one; and MOA-16..17 plus MOA-26 close the
  // three bypasses that would otherwise make the gate decorative. MOA-11..14 assert the refusal from the
  // store (`products`, `merchants.upi_id`, `merchant_grocery_inventory`), not from a response body, and
  // MOA-18..22 name the permission: an unauthenticated caller and a FINANCE_AUDITOR (no `merchant.manage`)
  // are both refused, an OPERATIONS approval writes the durable row and one audit line, and retrying it
  // lands the same `approval_decided_at` with `audit_rows = 1`. MOA-29 re-reads the decision from a
  // freshly spawned second process.
  // The RED half is real: before the fix MOA-11..14 wrote through, because that IS the defect.
  // Shared lane, NOT `isolated`, for the same measured reason as link 80: it snapshots the seeded
  // merchant `…0201` to prove the run demoted nothing (MOA-37/38) and it lists a real grocery product
  // from `master_grocery_catalog WHERE is_active = true` to get to the checkout gate (MOA-33), and a
  // schema-only `chain_scratch` clone carries neither. Like link 79/80 it boots its own backends on
  // `findFreePort`, so it never touches the shared :4000 harness, and it loads
  // `scripts/chain_target_guard` so a non-loopback target is a refusal at load.
  // Residue, re-measured 2026-10-19 on the local Docker target (standalone, 38/38, exit 0): net-zero on
  // `merchants` 83->83, `admin_accounts`, `users`, `products`, `orders`, `order_lines`, `checkouts` and
  // `merchant_grocery_inventory` — its three merchants, their dish, the two probe admin accounts and the
  // sessions those accounts minted are all deleted by their own ids in a `finally`. What stays is
  // deliberate: +39 `audit_logs` (append-only by migration 022 — registration, approval, rejection and
  // the admin permission refusals), and the ONE `backend_sessions` row minted by signing in as the
  // SHARED seeded `superadmin`, whose only matching handle is the username. The probe-admin sessions are
  // removed because the run owns their account id; the seeded one is not, so the census names it instead
  // of a shared record being deleted to tidy a census.
  { file: 'merchant_onboarding_approval_test.js',                                                     // 92
    subtotalPattern: /MI-5 MERCHANT PENDING-APPROVAL LIFECYCLE: (\d+)\/\d+ passed, (\d+) failed/ },
  // P4-3 (P1, customer money): migration 039 made the CAPTURE service-aware — a FOOD or GROCERY capture
  // books DEBIT PAYMENT_GATEWAY_ESCROW / CREDIT MERCHANT_PAYABLE, because the platform owes the merchant,
  // not the rider — but left `refund_payment_atomic` hardcoded to the RIDE legs, so it always debited
  // CUSTOMER_WALLET_LIABILITY. A refund of a captured food order therefore debits a liability the capture
  // never credited and leaves MERCHANT_PAYABLE credited for money the platform no longer owes. Reachable
  // today from `POST /api/admin/finance/refund`, which reports success while both accounts go wrong.
  // 23 checks, every one of them a durable read of journal_transactions/journal_lines/ledger_entries
  // rather than an RPC body: ORS-03/05/06/07/08 name the mirror (account, per-account net zero, no
  // phantom customer leg, merchant entity, Book 1 agreeing with Book 2); ORS-11/12/13 hold it across two
  // GROCERY partials; ORS-14/15/16 pin the RIDE legs UNCHANGED because REC-13/15 already pin that branch
  // and a repair that moves it is a regression; ORS-17 keeps replay idempotent; ORS-19/20 cover the two
  // derivations that must not invent anything (a pre-039 capture that exists in Book 1 only, and a
  // payment row with no capture record at all); ORS-21/22/23 prove the reversal is a NEW posting and that
  // nothing this run booked breaks the balance invariant.
  // `isolated: true`, and the reason is the immutability, not caution: every row it writes is a financial
  // posting that migration 033 makes undeleteable for every role, so against `public` the money is
  // permanent census drift, while against the clone it is discarded with the lane. It reaches the store
  // through the supabaseAdmin handle (RPC) and its own `pg` client (assertions), both resolved from one
  // declared loopback target via `scripts/chain_target_guard`, and it loads no backend of its own.
  { file: 'order_refund_reversal_symmetry_test.js', isolated: true,                                   // 93
    subtotalPattern: /ORDER REFUND REVERSAL SYMMETRY TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P5-B: `PAYMENT_MODE=live` used to be satisfied by two non-empty environment variables, after which
  // the repository minted `order_rzp_live_<epoch>_<random>` in-process, labelled it `RAZORPAY_LIVE`, and
  // wrote a durable `payment_sessions` row — a caller handed an identifier no gateway ever issued, against
  // which nothing can be paid. Measured RED 4/17 before the fix. The suite pins the two refusals
  // (`PAYMENT_PROVIDER_NOT_CONFIGURED`, `PAYMENT_MODE_UNCONFIGURED`, both 503 because the create-order
  // route answers from `err.statusCode || 400`), the absence of any live-labelled id or designation, zero
  // durable writes and zero ledger/RPC calls for a refused request, replay still refused, and that the
  // simulated sandbox stays available and is labelled `simulated: true`. LPT-15/16/17 are structural
  // tripwires: LPT-15 goes red on the day a real gateway client is added, which is the moment the live
  // path becomes servable — not before.
  // Not `isolated`, because it has no store to isolate: its child pins `SUPABASE_URL`/`DATABASE_URL` to an
  // unused loopback port and replaces `supabaseAdmin.from`/`.rpc` with counters, so the durable-insert
  // branch is observed rather than performed, and it makes no HTTP request of its own.
  { file: 'live_payment_truthfulness_test.js',                                                       // 94
    subtotalPattern: /LIVE PAYMENT TRUTHFULNESS TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // F-7: a SAFETY_INCIDENT sanction used to take its target from anywhere — first the ticket's durable
  // job, then `messages[0].metadata.driverId`, which a customer writes itself in the body of
  // `POST /api/support/ticket`, and finally a seed ticket number mapped to a demo driver. Measured RED
  // 7/19: with that code a customer naming `DRV-102` in a ticket that had no job suspended driver
  // 00000000-...-0102, wrote RESOLVED, and left an audit record claiming a suspension had been served.
  // The suite runs against real PostgreSQL with EMPTY in-memory mirrors, so every read has to reach the
  // store: it pins the refusal (`400 SANCTION_DRIVER_UNRESOLVABLE`), that the named driver is untouched,
  // that a refused ticket stays IN_PROGRESS and writes no audit row, that a job-linked sanction still
  // lands and is audited exactly once, and that `WARNING_ISSUED` (which changes no driver state) still
  // resolves — the gate must not become a blanket refusal. Its teardown deletes only its own ticket and
  // job rows and restores a driver only if this run changed one. Not `isolated`: the driver write is a
  // reversible UPDATE on a row it restores, its inserts net to zero, and the attribution it is testing
  // only exists when the ticket, the job and the driver are durable rows in the same store.
  { file: 'sanction_attribution_truthfulness_test.js',                                                // 95
    subtotalPattern: /SANCTION ATTRIBUTION TRUTHFULNESS TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P6: the LOST_ITEM bounty branch took its RECIPIENT from anywhere — the ticket's durable job first,
  // then `messages[0]` driver reference, which `createTicket` fills from `req.body` when no job driver
  // was verified, on a route any signed-in customer can call. Measured RED 13/27: a customer naming a
  // fresh fixture driver on a job-less ticket had that driver's durable `wallet_balance` rise by the
  // bounty, one journal transaction and two lines booked against that driver, the global
  // `journal_transactions` count rise 7143->7144, and the ticket read RESOLVED — the money was real,
  // only the attribution was the attacker's. This is F-7's defect class on the payout side, and it made
  // the already-designed `BOUNTY_DRIVER_UNRESOLVABLE` refusal unreachable. The fix deletes that one
  // source, so job attribution is the only authority and the existing refusal fires: no new payout
  // rule, no amount change, no touched wallet/ledger safeguards. The suite asserts durable state for
  // all seven mandated cases — named driver not credited, renaming the driver changes nothing, refusal
  // code preserved, refusal leaves wallet/journal/payout/ticket/audit unchanged, a job-linked bounty
  // still pays exactly once, a replay cannot double-credit, and neither a decoy on a job-linked ticket
  // nor a driver proven entitled elsewhere can satisfy the check. Its teardown deletes only its own
  // P6B-prefixed rows and retains any driver carrying append-only financial history, the same rule E3
  // link 8 follows. Not `isolated`: the attribution only exists when ticket, job and driver are durable
  // rows in the same store.
  { file: 'bounty_recipient_attribution_test.js',                                                     // 96
    subtotalPattern: /P6B BOUNTY RECIPIENT ATTRIBUTION TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P7: the customer-wallet refund leg of `resolveTicket` answered to `support.resolve` alone, while the
  // sibling bounty leg had been made a finance act in P6 — so a SUPPORT_AGENT, a role that cannot post one
  // rupee through /api/admin/finance/refund, could credit an admin-typed amount into any dispute ticket's
  // customer wallet. Measured RED 2/7 against `public` before the gate: `{success:true,status:"RESOLVED"}`,
  // wallet 0->150, 2 journal lines, global `journal_transactions` 7202->7203. The fix reuses the existing
  // `finance.refund` authority (no new grant, no amount or fare rule changed) and fails closed on a role
  // with no grant list at all. 27 checks, all of them durable reads: the refusal (403 + code), the wallet,
  // the per-customer lines and the GLOBAL journal count unchanged across three refusals, the ticket never
  // RESOLVED with no audit row, a moneyless resolve by the same role still succeeding (the gate is not
  // over-broad), OPERATIONS and an unrecognised role refused the same way, the legitimate
  // finance.refund path paying exactly +150 once as 1 transaction / 2 lines, and a replay refused with no
  // movement — plus the six source pins that keep the route gate, the grant list and P6's bounty gate from
  // being quietly deleted.
  // `isolated: true`, measured 2026-10-19 by `scripts/lane_check.js`: suite exit 0 at 27/27 with the
  // assertion handle in schema `chain_scratch`, `chain_scratch verify` CLEAN over 36 protected tables and a
  // full 75-line public census CLEAN, teardown deleting only its own two unfunded users and retaining the
  // funded one (`financial lines=2`). The reason is the same as link 93: one pass books a real refund that
  // migration 033 makes undeleteable, so against `public` it is additive per run and can never read
  // net-zero, while against the clone the posting is discarded with the lane. It resolves BOTH handles
  // through `scripts/chain_target_guard` (F-C1-1) — the money moves via the in-process repository and the
  // proof reads via its own `pg` client, and RFA-01b is the round trip that proves they are one store.
  // Not `laneServer`: the defect is inside the repository, so the suite issues no HTTP request of its own
  // and has no base URL to repoint.
  { file: 'refund_finance_authority_test.js', isolated: true,                                          // 97
    subtotalPattern: /RFA REFUND FINANCE AUTHORITY TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P8 Phase 3 candidate B — the third member of the provider-polarity family after SMS (#286) and push
  // (#276). Both media adapters decide "am I a real provider?" from credential presence alone, so a
  // deployment whose Cloudinary keys were dropped or never set answered 200 to an uploader, invented a
  // `res.cloudinary.com/nabin-media/...` URL with invented 800x600/45000-byte measurements, wrote them
  // into the durable `media_assets` ownership row, and answered `result: 'ok'` for a delete no provider
  // was ever asked to perform. The RED run measured exactly that: a production-polarity backend on the
  // lane returned 200 + a full row (the clone's table grew 13 -> 14) and its DELETE destroyed the row.
  // GREEN is 31/31: in production every mutating operation refuses with a coded 503
  // MEDIA_PROVIDER_NOT_CONFIGURED at the service seam, the polarity is read at CALL time because both
  // adapters are singletons that freeze `isConfigured` at construction, and the simulated branch survives
  // outside production but is labelled — `mock: true` plus a host that resolves nowhere
  // (`cloudinary-mock.nabin.local` / `supabase-mock.nabin.local`) so a fake URL cannot be mistaken for a
  // real cloud's. A refused upload writes no row and mints no id; a refused delete keeps the row and its
  // whole ownership tuple.
  // `isolated: true`, measured 2026-10-19 by `scripts/lane_check.js --lane-server`: suite exit 0 at 31/31,
  // `chain_scratch verify` CLEAN over 36 protected tables, full 75-line public census CLEAN. NOT
  // `laneServer` for the link-79 reason: it boots its OWN two backends (`NODE_ENV` differing only) from
  // `{...process.env, PORT}` on `findFreePort()`, so each child inherits the lane's scratch `DATABASE_URL`
  // and throwaway PostgREST — and D2 reads the row it just uploaded back through its own guard-resolved
  // `pg` handle, which is the proof the writes landed on the intended store. Teardown deletes exactly the
  // `public_id`s this run minted, awaited before exit; measured `[cleanup] deleted 0 of 1` because the
  // run's own D10 owner-delete had already removed that row. No journal, ledger, payment or audit record
  // is in scope, and nothing is rewritten to make the census clean.
  { file: 'storage_provider_polarity_test.js', isolated: true,                                        // 98
    subtotalPattern: /STORAGE PROVIDER POLARITY TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P9 — the admin job queue and merchant directory were answering from the boot-time process mirrors
  // (`db.jobs` hydrate-once with a `.limit(200)` newest-first slice, `db.restaurants` a single fabricated
  // seed object) instead of the durable store. So a job created after this process booted was invisible,
  // a status update never showed up, and 83 real merchants rendered as one storefront with a
  // `payableBalance` the ledger never booked, a `menu` lifted out of a sample JSON and a `deliveryTime`
  // no column stores. Both reads now go to `settleAuthoritative` on the store, projected through the
  // existing canonical helpers (`mapRowToJob`, a new `projectAdminMerchant` that serves `walletBalance`
  // instead of `payableBalance` and keeps the repository's commission-rate fraction), on the established
  // admin-list contract: `{ dataSource, total, limit, offset, degraded? }` with an exact count, newest-
  // first with `id` as tiebreak, page-size clamped to `ADMIN_DIRECTORY_MAX_PAGE`. An unreachable store
  // is now a classified 503 `AUTH_STORE_UNAVAILABLE` with no array in the body — a client cannot render
  // an outage as an empty queue — via the same `authStoreUnavailable` channel already used for the
  // customer directory. Authorization is unchanged (both routes still run behind `authenticateAdmin`
  // only, so the #273 owner decision on additional permissions is untouched).
  // `isolated: true`, measured 2026-10-19 by `scripts/lane_check.js --lane-server`: suite exit 0 at 64/64,
  // `chain_scratch verify` CLEAN over 36 protected tables, full 75-line public census CLEAN. The suite
  // needs the isolation for the same reason links 79/90/91/93/97/98 do: it mints its own fixture rows
  // (`P9-A-<stamp>` job, `P9 Fixture Kitchen <stamp>` merchant) so it can prove a durable row created
  // after boot is served, and its outage proof (Group F) boots a SECOND backend whose `SUPABASE_URL`
  // points at a loopback proxy that fails only `jobs`/`merchants` — the sessions and admin login still
  // need a live store, so the lane's throwaway PostgREST has to sit between them and `public`. It
  // resolves BOTH handles through `scripts/chain_target_guard` (F-C1-1): the fixture writes go through
  // `requireLoopbackPgTarget` so `chain_scratch` is the target the clone verify checks, and the
  // bootServer children inherit the lane `DATABASE_URL` + `SUPABASE_URL`. `laneServer` is NOT set
  // because the suite spawns its own servers on `findFreePort()` from `src/server.js`, so it never uses
  // the shared `:4000` harness anyway. Teardown deletes exactly the `P9-A-*` job number and the
  // `P9 Fixture Kitchen <stamp>` id this run minted, awaited before exit — measured `[cleanup] jobs:
  // deleted 0 (already removed by C3), merchants: deleted 1` — and Group H pins the pre/post row counts
  // for `jobs`, `merchants`, `orders` and `journal_transactions` so an over-broad delete would be caught.
  // Money, orders, and journal rows are asserted untouched (H4).
  { file: 'admin_stale_read_test.js', isolated: true,                                                 // 99
    subtotalPattern: /ADMIN STALE READ TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P10 / D-8 §3 — the admin job queue is a directory an operator scans, yet `listAdminJobs` projected
  // each durable row through the SHARED `JobRepository.mapRowToJob`, which carries the live handover
  // codes `startOtp`/`pickupOtp`/`deliveryOtp`. That mapper is correct for its other consumers: the
  // customer's and the assigned driver's own-job reads, where a handover code is exactly what completes a
  // pickup/delivery (migration 046, link 89). But the admin route runs behind `authenticateAdmin` with no
  // permission gate (#273, owner decision), so all five admin roles — SUPPORT_AGENT and KYC_SPECIALIST
  // included — read a *live* handover secret they have no duty to hold: a low-privilege admin token could
  // replay the code the directory just printed and complete someone else's parcel/food handover. The fix
  // is a response-field reduction, independent of who the owner later decides may read the route:
  // `listAdminJobs` now strips the three OTP fields on BOTH branches (the durable `(data||[]).map(mapRowToJob)`
  // projection and the degraded `this.jobs` mirror slice — a shallow copy before `delete`, so the in-process
  // store keeps its own codes), while `mapRowToJob` is left exactly as it was. Group C pins that half: the
  // shared mapper still returns all three OTPs, so no legitimate handover path lost anything. Group B pins
  // the directory is not over-stripped (pickup/drop address, fare/status/driverEarnings, customerName all
  // still served); Group D pins the 401 authentication guard is unchanged; H1 pins the OTP COLUMNS are
  // still on the durable row (only the read was reduced, never the stored secret).
  // `isolated: true`, measured 2026-10-19 by `scripts/lane_check.js`: suite exit 0 at 18/18, `chain_scratch
  // verify` CLEAN over 36 protected tables, full 75-line public census CLEAN. The isolation is for the
  // same reason links 79/90/91/93/97/98/99 is: it mints its own fixture row (`P10OTP-<stamp>` job carrying
  // sentinel OTPs 4127/5519/7731) so it can prove the served record drops them, and it boots its own
  // backend on `findFreePort()` from `src/server.js`. It resolves its PG handle through
  // `requireLoopbackPgTarget` so `chain_scratch` is the target the clone verify checks; the bootServer
  // child inherits the lane `DATABASE_URL` + `SUPABASE_URL`. `laneServer` is NOT set because the suite
  // spawns its own server, so it never touches the shared `:4000` harness. Teardown deletes exactly the
  // `P10OTP-*` job number this run minted, and H2 pins `jobs` back to its pre-run row count, so an
  // over-broad delete would be caught.
  { file: 'admin_job_otp_hygiene_test.js', isolated: true,                                            // 100
    subtotalPattern: /ADMIN JOB OTP HYGIENE TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P9 §2 — two admin grocery reads answered with things that were not true. (A)
  // `GET /api/admin/master-catalog/:id/stores` projected every linked store through
  // `merchant.address || 'DarkStore Location'` while its PostgREST embed asked for
  // `merchants(id, name)` only — an embed returns no column it was not told to select, so the
  // fallback branch was taken on EVERY row even though `merchants.address` is a real `TEXT NOT NULL`
  // durable column (migration 001_central_schema.sql:77). An operator reading a SKU's store matrix
  // saw the same invented place for every dark store. The embed now selects `address`, and the field
  // is emitted only when a durable address is actually present, so the shape stays truthful instead of
  // being filled in. The mirror branch carried a second copy of the same invented literal; it is gone
  // too. (B) `GET /api/admin/grocery/price-alerts` scanned `this.groceryPriceHistory` — a boot-time
  // seed plus rows only THIS process wrote — and answered with no source at all, next to the routes
  // that do say `dataSource: "postgres"`. There is no admin-facing durable read of
  // `grocery_price_history` (`getMerchantPriceHistory` is single-merchant-scoped), so a durable query
  // could not be implemented without inventing a cross-tenant scan; the honest half is the label, and
  // `getUnusualPriceAlerts` now returns `{ alerts, dataSource: 'memory', degraded: true }` with the
  // route passing both through. Group A pins the durable address and the absence of the literal;
  // Group B pins the source label; Group C pins that the only rows this run touched are the merchant,
  // catalogue and inventory link it minted, and that it wrote no price-history row at all.
  // Authorization is deliberately NOT touched: both routes keep exactly the guards they have
  // (`authenticateAdmin`, no permission gate) — that mapping is issue #273 and an owner decision.
  // `isolated: true`, measured 2026-10-19 by `scripts/lane_check.js`: suite exit 0 at 20/20 with 0 fail
  // markers, `chain_scratch verify` CLEAN over 36 protected tables, full 75-line public census CLEAN.
  // It needs the clone because it inserts a GROCERY merchant, an active `master_grocery_catalog` row and
  // a `merchant_grocery_inventory` link to have a store matrix that is provably its own, and it boots its
  // own backend on `findFreePort()` from `src/server.js` with its PG handle resolved by
  // `requireLoopbackPgTarget`. `laneServer` is NOT set — the suite spawns its own server, so it never
  // uses the shared `:4000` harness. Teardown deletes exactly the inventory link, merchant and catalogue
  // row this run minted (both FKs are `ON DELETE CASCADE`, so the link goes with its own parent) and
  // Group C re-counts against the baselines it took before writing.
  { file: 'admin_data_truthfulness_test.js', isolated: true,                                          // 101
    subtotalPattern: /ADMIN DATA TRUTHFULNESS TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // #481 — a driver that never reported a position was served one it did not have. Three sites
  // substituted the Delhi sentinel (28.6139, 77.2090) for a missing coordinate and `create()` also
  // PERSISTED it, so `drivers.current_lat` carried a claim no GPS ever made; `mapRowToDriver()` and
  // `initPostgres()`'s driver hydration then re-claimed it for every durable-NULL driver on every
  // boot, and the admin console painted `|| 28.6139`/`|| 'Delhi NCR'` over an honest blank.
  // `current_lat`/`current_lng` are nullable with NO DEFAULT (migration 001_central_schema.sql:62),
  // so the fix is the schema's own state: `coordinateOrNull()` — the same rule #32b introduced for
  // jobs — now decides "absent" in `create()`, `mapRowToDriver()` and the hydrator, and no `area`
  // label is invented because no `drivers.area` column exists. `updateLocation()` (the one legitimate
  // durable GPS writer), `update()` (sends no coordinate keys), the telemetry route's driver-scoped
  // validation and the fleet/ride broadcast channels are deliberately unchanged.
  // RED measured 2026-10-20 on the lane before the fix: 28/45, 17 failed — 1,918 served rows claimed
  // a position, 2,335 claimed the 'Delhi Operations Zone' area, and a positionless create() persisted
  // the sentinel. GREEN after: 45/45 with 0 failed and the same 2 NOT-MEASURED gaps as RED (nothing
  // was weakened to get there) — GAP-DIST-01 (`dispatch_offers.distance_to_pickup` is a schema
  // default with zero writers, a migration decision) and GAP-MOCK-01 (the in-memory demo fleet's
  // Delhi seed rows, #156/#157 owner decisions). Groups A/B/C pin durable-NULL-stays-NULL, honest
  // API/UI projection and a legitimate fix round-tripping exactly; D/E pin that no distance is ever
  // computed from a driver position (`getOnlineFleet()` is position-free); F pins the sentinel
  // literals out of the two repositories, the hydrator and the console; G pins that this suite minted
  // only its own driver rows and left the 416 pre-existing sentinel rows ALONE — the historical rows
  // are a separately reviewed repair (`scripts/repair_fabricated_driver_positions.js`, dry-run by
  // default), not something a test sweeps to make a census look clean.
  // `isolated: true`, measured 2026-10-20 by `scripts/lane_check.js`: suite exit 0, `chain_scratch
  // verify` CLEAN over 36 protected tables, full 75-line public census CLEAN — `drivers` is
  // census-protected, so this suite mints its own rows on the clone instead of the shared store.
  // `laneServer` is NOT set: it boots its own backend on `findFreePort()` from `src/server.js`. It
  // calls NO PostgreSQL function, because RPCs are pinned `SET search_path = public` in their own
  // definitions and would write a SHARED table from the lane; that is also why the dispatch case is
  // proven by source scan plus row-count footprint rather than by creating offer rows. Teardown
  // deletes exactly the driver ids this run minted.
  { file: 'driver_position_truthfulness_test.js', isolated: true,                                     // 102
    subtotalPattern: /DRIVER POSITION TRUTHFULNESS TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // 103 — #481 §5: GET /api/admin/metrics served this process's boot mirror as platform totals and
  // one hard-coded operational claim on top of it. RED measured 2026-10-20 on the lane before the fix:
  // 17/40, 23 failed — `totalRestaurants` 1 against 83 durable merchants, `activeDrivers` 6 against 3,
  // `totalCompletedJobs` 68 against 604, `totalGrossFare` ₹9,339 against ₹91,251 (and against the
  // ₹91,251 `/api/admin/finance/metrics` reports for the same quantity), `dataSource` absent,
  // `fleetStatus: 'OPTIMAL_OPERATION'` present, `pendingKyc` counting a table that does not exist, and
  // a backend whose totals-bearing tables were unreachable answering 200 with `totalCompletedJobs: 0`,
  // `totalGrossFare: 0` and `OPTIMAL_OPERATION`. GREEN after `getAdminPlatformMetrics()` + the route
  // rewrite: 40/40, 0 failed — 83/3/604/₹91,251 served, `dataSource: 'postgres'`, the outage read a
  // 503 AUTH_STORE_UNAVAILABLE with no metrics object, and rows minted after boot moving each total by
  // exactly the fixture that was written (`+1` completed job, +₹123.45 fare).
  // Nothing was weakened to get there: the key set is pinned by A4 to the seven durable figures plus
  // provenance and timestamp, so a future fabricated key has to arrive with its own assertion. The two
  // removed keys and every other key on the payload have zero consumers (measured across *.dart,
  // *.tsx, *.ts, *.js: the path and the key names appear at this producer and this suite only), which
  // is why the fix deletes them instead of relabelling them, and why no new key was added either.
  // `isolated: true`, measured 2026-10-20 by `scripts/lane_check.js`: suite exit 0, `chain_scratch
  // verify` CLEAN over 36 protected tables, full 75-line public census CLEAN — it writes `users`,
  // `drivers`, `jobs` and `merchants`, all census-protected, so it mints its own rows on the clone.
  // `laneServer` is NOT set: it boots its own backend on `findFreePort()`, and a second backend on a
  // `makeStoreProxy` that fails exactly those four tables, which is the outage seam for GROUP E. It
  // calls NO PostgreSQL function (`SET search_path = public` RPCs would write shared tables from the
  // lane). Teardown deletes exactly the job numbers, driver id and merchant id this run named.
  { file: 'admin_metrics_truthfulness_test.js', isolated: true,                                       // 103
    subtotalPattern: /ADMIN METRICS TRUTHFULNESS TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // 104 — KYC-P1: `reviewIdentityApplication` wrote the customer's identity verdict to this process's
  // mirror only. The durable `users.identity_status` column was never touched, so an approval that an
  // admin saw as VERIFIED was a fact about one backend's memory: the next boot re-hydrated 'PENDING',
  // and a login on the still-running process kept serving whatever it had hydrated at boot. A refused
  // store write answered 200. RED measured 2026-10-20 on the lane before the fix: 43/56, 13 failed —
  // A4/A6/A8 (the three durable verdict writes), B1/B2 (a restarted process and the status route both
  // reverted to the pre-decision value), C5 (the route-reviewed account stayed PENDING in the row),
  // C11 (login served the boot value, no restart needed), E1–E6 (the outage approval returned success
  // with nothing durable behind it) and I3 (the per-row diff had nothing to see). GREEN after
  // `persistIdentityDecision()` + its four callsites + `metadata: {...durability}` on every audit row
  // + the login `identityStatus` sync: 56/56, 0 failed — VERIFIED / REJECTED / RESUBMISSION_REQUIRED
  // read back off the durable row (A4/A6/A8), the same verdict served after a restart (B1/B2) and on a
  // login with no restart (C11), the outage a 503 AUTH_STORE_UNAVAILABLE that moved neither the mirror
  // (E4) nor the application record (E5) while the identical approval lands durably once the store
  // answers (E6), MI-4 and the checklist/blank-reason/unknown-decision refusals intact (F1–F6), and
  // `account_status` unchanged by every decision in this suite (H1 — REJECT's ability-to-trade
  // semantics stay the owner question they are). Nothing was weakened: the durable writes land before
  // the mirror mutates, and the two values the shipped CHECK does not allow were not invented.
  // `isolated: true`, measured 2026-10-20 by `scripts/lane_check.js`: suite exit 0, `chain_scratch
  // verify` CLEAN over 36 protected tables, full 75-line public census CLEAN, teardown exit 0,
  // `green=true` — it mints its own 12 `users` rows and moves 5 of them, all census-invisible by
  // count (an `identity_status` UPDATE changes no row count), which is exactly why GROUP I carries
  // its own per-row durable snapshot diff instead of trusting the census. It asserts on PostgreSQL
  // rows, not response text: I2 proves no row outside its own fixtures moved, I5 that it wrote no
  // job, order or payment row, I6 that the audit trail only grew.
  // `laneServer` is NOT set: the suite boots its own two backends (one plain, one on a store proxy
  // that refuses the four tables GROUP E needs) and needs a second process for the restart seam. It
  // calls NO PostgreSQL function (`SET search_path = public` RPCs would write shared tables from the
  // lane). Teardown deletes exactly the `users` rows this run minted — 0 of its own rows still
  // present after teardown, measured in the same lane log.
  { file: 'customer_identity_durability_test.js', isolated: true,                                   // 104
    subtotalPattern: /CUSTOMER IDENTITY DURABILITY TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // RPN — REFUND RECIPIENT ATTRIBUTION. `POST /api/admin/finance/refund` published its
  // `REFUND_PROCESSED` notification to a substituted recipient: `refund_payment_atomic` returns no
  // user identity at all (migration 039 contains no `user_id` token, pinned by RRA-02a/RRA-02),
  // `payments.customer_id` is nullable, and `db.getJob()` answers from the mirror only, so the
  // route's last leg fell back to `resolveCustomerUserUuid('usr_2')` and the bus wrote a durable
  // HIGH-priority notification for the seeded fixture account `00000000-0000-0000-0000-000000000002`
  // — a real, unrelated `users` row — for money that was not its customer's. Measured RED in this
  // lane 2026-10-20: exit 1, 13 pass / 5 fail, RRA-05/06/07 proving the fixture uuid written into
  // both `notifications.user_id` and `recipient_user_id`, RRA-13 proving the substitution in source,
  // RRA-14 proving nothing was logged about it. The fix is by deletion: no substitute recipient, and
  // an unresolvable one skips the publish with `[NOTIF_BUS_SKIPPED]` like the payout route already
  // does. The money leg, the audit log and the response body are untouched, so a refund that used to
  // notify the wrong person now notifies nobody and still succeeds. Measured GREEN 18/18.
  // `isolated: true`, measured 2026-10-20 by `scripts/lane_check.js`: `chain_scratch verify` CLEAN
  // over 36 protected tables, full 75-line public census CLEAN both before and after, teardown exit
  // 0, `green=true`. It mints its own CAPTURED payments with `customer_id: null` and asserts on
  // PostgreSQL rows rather than response text (RRA-03 the payment is durably what the fixture said,
  // RRA-04 the refund is durably REFUNDED at ₹400, RRA-08..RRA-11 the attributed refund reaches its
  // own customer exactly once and never the fixture). GROUP 4 is a positive control: it proves the
  // bus is live inside the same run, so GROUP 2's zero rows are a refusal and not a race.
  // `laneServer` is NOT set — the suite boots its own backend on a free port. Teardown deletes only
  // its own notification rows by its own payment ids and RETAINS the append-only payments and the
  // refunded user, which the cleanup line reports with rowCount evidence.
  { file: 'refund_recipient_attribution_test.js', isolated: true,                                   // 105
    subtotalPattern: /REFUND RECIPIENT ATTRIBUTION TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // GRO-ADDR: `POST /api/grocery/checkout/validate` used to COMPLETE an address-less DELIVERY checkout
  // and persist the invented literal into the durable `checkouts` row, the `orders` row and the response
  // snapshot — a place nobody chose, on a paid order, then handed to a rider gate that already knew the
  // literal was a fabrication and refused to use it. Food (`/api/customer/book-food`) answered the same
  // request with 400 PLACE_REQUIRED, and both real clients gate placement before posting, so the grocery
  // route was the only party that accepted it. The refusal now sits after the merchant/feature/empty-cart
  // gates (401/403/400 precedences unchanged) and before item resolution, coupon redemption and both
  // writes; the three substitutions are deleted, not defaulted to something else.
  // Assertions are durable, not response text: GA-11..GA-16 prove a refused attempt leaves zero `orders`
  // and zero `checkouts` rows for this run's customer and no row carries the literal; GA-17 re-uses the
  // refused attempt's idempotency key on a valid checkout, which only passes if the refusal precedes the
  // side effects; GA-18..GA-25 is the over-broad-fix guard — the identical cart WITH a typed address
  // still succeeds and persists exactly that string; GA-30..GA-35 pins the source contract (no literal
  // anywhere in server.js, the refusal index precedes each write index, the food window untouched).
  // `isolated: true` because every row it writes is in a census-protected table. `laneServer` is NOT
  // set — the suite boots its own backend on a free port via `scripts/spawned_server`. Measured
  // 2026-10-20 before registration: RED first (13 fail markers against the unfixed route, with the
  // literal read back out of PostgreSQL), then 23/23 exit 0 with `chain_scratch verify` CLEAN over 36
  // protected tables and the full 75-line public census CLEAN both before and after.
  { file: 'grocery_address_substitution_test.js', isolated: true,                                   // 106
    subtotalPattern: /GROCERY ADDRESS SUBSTITUTION TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // P11 §2: the customer-web login screen failed OPEN. On an unreachable API its `catch` matched the
  // typed phone number for a demo shape (`98765` / `demo`), advanced to the code step with `123456`
  // pre-typed, and on the verify step called `login("demo-customer-token", { … identityStatus:
  // "VERIFIED" })` and returned as if the server had minted a session — so an outage produced a
  // customer who looks verified and cannot read their own orders. The token reaches nowhere (measured:
  // `/api/auth/me` and `/api/customer/orders` both answer that bearer 401), which is why this is a
  // truthfulness guard, not an authorization hole — and WAF-14/15 assert the refusal rather than trust
  // it, so a backend that ever starts accepting a client-minted token reddens the link. The static half
  // reads the real client (login page, AuthContext, api.ts) with a string-aware scanner and fails if the
  // handlers/files are absent (no guard passes by finding nothing); the demo entry points are an
  // advertised feature, so WAF-07/08 keep them but require each to be a `type="button"` whose own label
  // says Demo. WAF-16/17 pin that the honest path is unchanged: exactly one `login(res.data.token)` and
  // one `setStep('otp')`, both gated on the backend's `res.data.success`.
  // NOT `isolated` and NOT `laneServer` and no shared :4000: the runtime half spawns this tree's own
  // backend on an ephemeral loopback port and sends nothing but GETs, so it writes no row and needs no
  // lane. 17 checks, measured 2026-10-20: RED against the fail-open (6 failures at WAF-02/03/08/09/16/17),
  // then 17/17 exit 0 after the two catch-block edits, and re-proven by reintroducing the fail-open and
  // watching it redden again.
  { file: 'web_auth_failopen_test.js',                                                               // 107
    subtotalPattern: /WEB AUTH FAIL-OPEN: (\d+)\/\d+ passed, (\d+) failed/ },
  // GROCERY-WEB: the customer-web grocery screen could complete a checkout without the backend. When the
  // store id began `mcht-demo`/`demo-` the submit handler ran a 500 ms `setTimeout`, called `setOrder({ …
  // id: 'DEMO-GRC-9912', order_number: 'DEMO-GROCERY-9912', status: 'CONFIRMED' })` and emptied the cart —
  // so the customer was shown a receipt for a row that exists in no database, under a reference support
  // cannot look up. `storeId` was pre-filled with `mcht-demo-grocery-1`, making that the DEFAULT behaviour
  // of the only primary submit control (not an advertised demo path: there is no demo button and no Demo
  // label on the order flow, unlike the Demo Catalog JSON import this guard separately protects at
  // WCF-13), and `deliveryAddress` was pre-filled with `'Flat 402, Civil Lines, Delhi'`, which is how the
  // client walked past the GRO-ADDR `400 PLACE_REQUIRED` refusal link 106 just installed. The screen also
  // claimed `'Paid from Wallet'` / `'Debited at checkout'`: WCF-11 reads the real route body (server.js
  // :9328, 298 lines) and every wallet-mutation name in the platform and proves the grocery checkout
  // mutates no wallet at all, so that wording recorded a payment that never happens — and it promised a
  // "Live Catalog Sync" while WCF-12 shows the page reads only this browser's stored catalog.
  // Handlers are located by what they CALL (`bookingApi.checkoutGrocery`), never by name, and every scan
  // reports what it found, so no check passes by finding nothing. WCF-08/09/13 are positive controls: one
  // durable checkout feeding the receipt, the empty-cart and blank-place gates still present, and the
  // advertised Demo Catalog transfer still behind a `type="button"` labelled Demo. WCF-14/15/16 boot this
  // tree's own backend on an ephemeral loopback port and POST the deleted branch's exact payload with no
  // session and with `Bearer demo-customer-token`: both are refused 401 with no order in the body, which
  // is the proof the fabricated completion could never have produced a real order.
  // NOT `isolated` and NOT `laneServer` and no shared :4000: it reads client sources and sends only those
  // two refused POSTs, so it writes no row and needs no lane. 16 checks, measured 2026-10-20: RED first
  // (7/16 — WCF-02..07, WCF-10, WCF-11, WCF-12), then 16/16 exit 0 after the page edits (demo branch
  // deleted, both invented defaults emptied, a blank-store gate added, the status badge and payment label
  // derived from durable/declared values, catalog wording corrected).
  { file: 'web_checkout_fabrication_test.js',                                                        // 108
    subtotalPattern: /WEB CHECKOUT FABRICATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // MRCH: the same grocery checkout route defaulted the STORE. `const requestedMerchant = req.body
  // .merchantId || req.body.restaurantId || req.body.storeId || 'mcht_1'` meant a request that named no
  // partner was placed on the seeded alias anyway — resolving through `LEGACY_MERCHANT_MAP` to
  // 00000000-0000-0000-0000-000000000201, a row this run never touched. Measured 2026-10-20 that row is
  // typed RESTAURANT in the seed and in PostgreSQL, so the type gate is what currently refuses it: this
  // is a LATENT fail-open, and the open owner decision over that row's `merchant_type` (the …201
  // RESTAURANT-vs-HYBRID_BOTH contestation, chain residue 2026-10-13) is exactly the switch that would
  // turn it into a durable order plus a delivery job on a store nobody chose. The refusal now answers
  // `400 MERCHANT_REQUIRED field:'merchantId'` after USER_NOT_FOUND and ahead of the dark-store gate, so
  // every existing precedence (401, 403 FEATURE_DISABLED/USER_NOT_FOUND/MERCHANT_NOT_APPROVED/
  // MERCHANT_CLOSED, 400 DARK_STORE/404/TYPE_MISMATCH/EMPTY_CART) is untouched, the `restaurantId` and
  // `storeId` aliases still work, and the legacy alias map other readers depend on stays in place.
  // Assertions are durable: MRCH-14..17 prove the four blank variants leave zero `orders` and zero
  // `checkouts` rows and that no row this run wrote names the invented store; MRCH-18 re-uses a refused
  // attempt's idempotency key, which only passes if the refusal precedes every side effect; MRCH-19..28
  // is the over-broad-fix guard (named store succeeds, persisted `orders.merchant_id` and
  // `checkouts.merchant_id` both equal the fixture store, aliases still 200, dark-store/unknown/anonymous
  // keep their own codes, and exactly 4 accepted checkouts all on the named store); MRCH-30..36 pin the
  // source (the alias token is gone from the route window and file-wide, the refusal index precedes
  // item resolution, coupon redemption, both writes and the dark-store gate, and OrderRepository.js still
  // carries the map).
  // `isolated: true` because every row it writes is in a census-protected table. `laneServer` is NOT
  // set — the suite boots its own backend on a free port via the link-106 idiom. Measured 2026-10-20
  // before registration: RED first (20/29 — MRCH-10..13 answered MERCHANT_TYPE_MISMATCH/MERCHANT_NOT_FOUND
  // instead of refusing, MRCH-31..35 found the literal and no gate), then 29/29 exit 0.
  { file: 'grocery_merchant_required_test.js', isolated: true,                                       // 109
    subtotalPattern: /GROCERY MERCHANT REQUIRED TEST: (\d+)\/\d+ passed, (\d+) failed/ },
  // FOOD-WEB: the food screen's order path. Four defects, one of them more expensive than the fabrication
  // it sits next to. (1) `setOrder(res.data.job)` at page.tsx:404 read a key the booking route never
  // sends — `res.json({ success, duplicate, order, deliveryJob })` at server.js:5154 — so a SUCCESSFUL,
  // durable, rider-dispatched order produced no receipt while the handler had already emptied the cart and
  // rotated the idempotency key: the customer's only way to see the order was to reorder, and the retry
  // carried a fresh key so the server could not dedupe it. (2) `active.id.startsWith("demo-")` finished the
  // order in the browser with `DEMO-ORD-8812`/`DEMO-FOOD-8812`. (3) The discovery `catch` answered an
  // unreachable backend with two invented Kolkata restaurants and `setListState("ready")`, and
  // `setListState("error")` appeared nowhere in the file, so the error+Retry branch the screen ships was
  // dead code — that fail-open is what let a REAL session reach a store id the order path then lied about.
  // (4) `{order.status ?? "RECEIVED"}` declared a lifecycle and "Total charged (server priced)" asserted a
  // payment, while an awk scan of the whole route body (server.js:4778-5164) for every wallet mutation
  // name the platform uses — adjust_wallet_atomic, adjustWallet, updateWalletBalance, debitWallet,
  // creditWallet — returned zero occurrences.
  // The correction is page.tsx only, and it preserves the advertised development functionality: the
  // labelled `type="button"` "📥 Import Demo Catalog (JSON)" and the declared demo persona's browsing path
  // (`restaurant.id.startsWith("demo-")` → stored catalog, flagged degraded) both stay; only the demo gate
  // on the ORDER path is deleted. WF-06 reddens a fix that erases the persona, and WF-15..WF-18 are the
  // positive controls that keep the durable booking, the three pre-submit gates and the degraded labels
  // intact. The receipt now reads the key the route sends, the badge renders the durable `order_state` with
  // no fallback, and the outage is reported as an outage.
  // NOT `isolated`, NOT `laneServer`, no shared :4000: it reads sources and sends three POSTs that carry
  // either no session or the client-minted `demo-customer-token`, all refused 401 (WF-20..22), so it writes
  // no row — placing a real order to prove the success path would break the chain's zero-order-residue
  // property (#314), and the contract check WF-02 is derived from the route's own success object instead.
  // Measured 2026-10-20: RED first (14/22 — WF-02, 04, 05, 06, 10, 11, 12, 13), then 22/22 exit 0 after the
  // page edits; `tsc --noEmit` over customer-web was run after them and exits 0.
  { file: 'web_food_fabrication_test.js',                                                            // 110
    subtotalPattern: /WEB FOOD FABRICATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // ID-WEB: the customer-web demo session claimed an identity check that never ran. `AuthContext.tsx:33`
  // rehydrated a user for ANY stored token starting with `demo-` and stamped it
  // `identityStatus: 'VERIFIED'` (now :40) — a status the backend only ever sets after an admin approves
  // documents — and `login/page.tsx:108` and `:160` minted the same claim on click. Two consumers read it:
  // `ride/page.tsx:56` (`user.identityStatus && user.identityStatus !== "VERIFIED"`) suppressed the
  // booking block, and `profile/page.tsx` rendered the success-tone "Verified" chip with "You can book
  // every NABIN service." The claim was false in both directions: the durable default is unverified
  // (`001_central_schema.sql:24` `identity_status VARCHAR(40) DEFAULT 'PENDING'`), the persona id
  // `customer-demo-01` is not a UUID (`001_central_schema.sql:15`) so no `users` row can carry it, and
  // sessions are minted at `database.js:7670` as `nabin_<role>_tok_<32 random bytes>` — a `demo-` string
  // cannot be one. IDW-19..22 measured the refusals rather than asserting them: `GET /api/auth/me`
  // (server.js:1675) with no credential → 401 "No session token provided.", with the app's own
  // `demo-customer-token` → 401 "Invalid or expired session token.", `GET
  // /api/identity/status/customer-demo-01` (server.js:4181) → 401, and `POST /api/customer/book-ride`
  // (server.js:4364) with that bearer → 401 with no job. So this is a truthfulness defect, NOT an
  // authorization hole, and the correction removes a claim rather than a capability.
  // The correction is three literals: `'IDENTITY_VERIFICATION_PENDING'` in the AuthContext demo branch and
  // `"IDENTITY_VERIFICATION_PENDING"` at both login mints. That value is not invented here — it is the
  // backend's own answer for an undecided identity (`server.js:4211`
  // `identityStatus: user.identityStatus || 'IDENTITY_VERIFICATION_PENDING'`, and `database.js:7444`
  // hydrates the store's `'PENDING'` to exactly it). The field is ASSIGNED, not deleted: `ride/page.tsx:56`
  // tests `user.identityStatus && …`, so an absent status reads as verified — deleting the field would have
  // failed open, which IDW-08 and IDW-12 pin. In this phase the authoritative path (`authApi.me()` →
  // `setUser(res.data.user)`), the `User` interface (`identityStatus?: string;`), `profile/page.tsx` and every
  // backend KYC gate are untouched: IDW-16 keeps the legitimate verified flow total and IDW-17 counts the
  // server's gate sites (1) so no verification requirement was loosened to make a test pass. IDW-09 preserves the
  // declared demo feature (persona fields + both `type="button"` Demo-labelled mints) per P11 requirement 4.
  // The guard does not hardcode its vocabulary: IDW-02/03/04/05 read the verified value from the server gate,
  // the unresolved value from the status route's own fallback, the client-visible set from the hydration map
  // and migration 001's CHECK, and the hydration mapping of PENDING, so a fix cannot pass by inventing a
  // fourth status and the guard cannot drift when one is renamed. IDW-12 extracts the ride predicate from
  // source and EVALUATES it against the real persona, an authoritative VERIFIED user, and a user with no
  // status; IDW-11 parses the profile badge map as data and proves the persona renders "Pending review"/
  // warning rather than "Verified"/success.
  // NOT `isolated`, NOT `laneServer`, no shared :4000: it reads sources and boots its own backend on a free
  // port (`scripts/spawned_server`) purely to send four credential-less or `demo-`-bearer requests, all
  // refused 401, so it writes no session, no job, no order and no ledger row (#314 zero residue).
  // Measured 2026-10-20: RED first (18/23 — IDW-06, 07, 10, 11, 12), then 23/23 exit 0 after the three
  // literals; `tsc --noEmit` over customer-web exits 0 and links 107 (17/17) and 104 (56/56) and 110
  // (22/22) stayed green with the edit in place.
  // SECOND PHASE, same suite (added checks IDW-24 / IDW-25 / IDW-26 / IDW-27, 23 → 27). The demo literals are
  // correct, so the remaining RUNTIME false-verification path was the gate itself: `ride/page.tsx:56` read
  // ABSENCE as verification (`user.identityStatus && user.identityStatus !== "VERIFIED"`), so a persona with
  // no status, `null` or `""` got an unlocked booking form the server then refused 403 at `server.js:4422`.
  // The gate is now `user.identityStatus !== "VERIFIED"` plus an `identityUnread` branch, so the two states
  // the old expression collapsed are said differently. IDW-24 evaluates that predicate over seven personas
  // (authoritative VERIFIED → allowed; PENDING, the app's own demo persona, absent, null, empty, out-of-
  // vocabulary → blocked); IDW-25 requires the notice to state a consequence for BOTH unread and pending.
  // IDW-26 walks `e2e-tests/` and finds the six localStorage demo seeds that paired a `demo-` token with
  // `identityStatus: 'VERIFIED'` — inert, because nothing in the tree reads `nabin_customer_user` and a
  // `demo-` token makes AuthContext rebuild the persona in code, and misleading because they documented the
  // demo state as verified; all six now seed the unresolved status. IDW-27 pins the four fixtures that
  // REQUIRE a verified user (the durable-KYC suite, the profile-edit adversarial payload asserting VERIFIED
  // does not move, the Flutter both-state identity widget test, and the corroborated `usr_2` seed) so the
  // correction cannot pass by flattening every fixture. Measured 2026-10-21: RED 24/27 (IDW-24 on
  // absent/null/empty ALLOWED, IDW-25 single-sentence notice, IDW-26 six lying seeds) then 27/27 exit 0.
  { file: 'web_identity_fabrication_test.js',                                                        // 111
    subtotalPattern: /WEB IDENTITY FABRICATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // WDW: the customer-web wallet screen authored its own money. `wallet/page.tsx` destructured the session
  // and never read it again: `useState(1450)` seeded AVAILABLE BALANCE, `DEMO_TRANSACTIONS` was four closed
  // rows (`DEMO-RECHARGE-101` ₹1,000, `DEMO-RD-9821` ₹220, `DEMO-ORD-4412` ₹380, `DEMO-PROMO-50` ₹50, each
  // `status: "COMPLETED"` painted in the success tone), and `handleTopup` did `setBalance((prev) => prev + amt)`,
  // prepended a fifth invented row and announced `Successfully credited ₹…`. None of it had a source: WDW-04
  // counts 180 registrations in `server.js` and 0 name a wallet, top-up, recharge, balance or statement, and
  // WDW-20 measured the two paths a customer would need (`GET /api/wallet`, `POST /api/wallet/topup`) answered
  // 404 by the running server. The journal is not reachable either — WDW-05 reads 023 revoking every grant on
  // `journal_lines` from `anon`/`authenticated` and making it append-only, with the seven ledger reads behind
  // `authenticateAdmin` + `requirePermission('finance.view')` (WDW-21 measured 401). The page's own `Transaction`
  // interface declared categories (`RIDE|FOOD|GROCERY|PARCEL|TOP_UP|REFUND`) that match none of migration 002's
  // eight legal ones, which is how WDW-06 shows the shape was authored rather than projected.
  // A balance DOES exist durably and needed no new endpoint: `users.wallet_balance NUMERIC(10,2)` (001:23),
  // hydrated onto the session entity as `walletBalance` (database.js:1841, re-read at login at :7432) and sent
  // whole by `/api/auth/me` through a projection that strips exactly one field (`rating`, server.js:1006). So
  // the card now renders `user?.walletBalance ?? null`. The tempting second fix — delete the literal and print
  // `inr(balance)` — would have swapped one false statement for another: `lib/format.ts:16` is
  // `format(amount ?? 0)`, and WDW-12 EVALUATES that function to show `inr(null)` and `inr(0)` are the same
  // string, so an unread balance must stay visibly unknown. The screen therefore branches on `authLoading`,
  // renders "Not available" for a null, and never routes a null through `inr`. The demo persona gains no
  // balance and is not deleted (WDW-14 re-reads the `demo-` branch, its persona fields and both `type="button"`
  // Demo-labelled login buttons; WDW-19 proves the backend refuses `demo-customer-token` a session, so there
  // was never a number for it to print). `walletBalance?: number` is added to the `User` interface as a type
  // declaration of what the server already sends — the authoritative path, the ride identity gate and every
  // backend KYC gate are untouched (WDW-15 re-evaluates the gate and still gets BLOCK).
  // Removed rather than relabelled, because no read backs them: the top-up buttons and custom-amount input
  // (client arithmetic on a ledger field is a claim, not a calculation — `database.js:3429` states the
  // platform rule and WDW-10 quotes it out of that file), the invented receipt list, and the "Payment Gateway
  // Integration / UNCONFIGURED (DEMO PREVIEW) / External Payment Gateway: Not Configured / Saved Payment
  // Instruments: None" card. That last one is not fixed by saying "configured" either: four payment routes do
  // exist, so WDW-16 asserts the page states nothing about infrastructure it never asked about — it says what
  // it can do instead. The screen itself survives the correction (WDW-13: file present, `useSession` gate,
  // AVAILABLE BALANCE card, and `/wallet` still in the nav at `Header.tsx:16`).
  // NOT `isolated`, NOT `laneServer`, no shared :4000: it reads sources and boots its own backend on a free
  // port (`scripts/spawned_server`) purely to send credential-less and `demo-`-bearer requests, every one
  // refused 401/404, so it writes no session, no balance, no journal line, no order and no job (#314 zero
  // residue). F-13: it boots with `NABIN_SESSION_PRUNE=off` so no shared row is pruned from under the chain.
  // Measured 2026-10-20: RED first (13/21 — WDW-06, 07, 08, 09, 10, 11, 12, 16), then 21/21 exit 0 with the
  // page at 122 lines; `npx tsc --noEmit` over customer-web exits 0.
  { file: 'web_wallet_fabrication_test.js',                                                          // 112
    subtotalPattern: /WEB WALLET FABRICATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // SSF: the emergency-killswitch switchboard invented how busy, fast and well-liked each platform
  // service is, and the ANONYMOUS `GET /api/services/status` handed the invention out as measurement.
  // Six of eighteen registry entries (database.js:1574 onward) carried `activeVolume` ('1,248 active
  // drivers • 942 on trip', '18 Darkstores Active • 4,810 SKUs Live', '620 Partner Kitchens • 850
  // Courier Fleet', '412 Courier Riders Active', 'UPI 2.0 Rails • 99.98% Gateway Success',
  // 'Sub-second Geo-Proximity Matcher (18,400 sockets)'), `latencyMs` (38/42/45/34/55/19) and
  // `metrics: { completedToday, satisfaction }` (3492/2180/1840/920/8432/8250 and '4.82★'/'4.91★'/
  // '4.78★'/'4.88★'/'99.9%'/'99.4%'). Nothing computed any of it — no component records a latency, a
  // socket count or an uptime percentage; there is no ratings table in the schema; and `jobs` has no
  // `completed_at`, so "completed today" has no definition to measure even if one wanted to infer it.
  // The admin dashboard then painted a fallback over the absence (`service.latencyMs || 40`,
  // `statusMap[...] || 'Active'`, a 'System OK' capsule), turning a fabricated number into a fabricated
  // number the operator never had to question.
  // The correction is removal plus honest absence, NOT a new derived metric: 18 fabricated field
  // assignments deleted from the constructor, the telemetry strip and the card bottom now read
  // "not measured"/"No telemetry source", and no volume or count was moved onto the public response,
  // because publishing platform-wide operational volumes is owner decision A and honest platform counts
  // already exist on `/api/admin/metrics` (`getAdminPlatformMetrics`: exact head counts,
  // `dataSource:'postgres'`, 503 `AUTH_STORE_UNAVAILABLE`). The allowlist SSF checks against is DERIVED
  // (A3) from the fields the backend's own control machinery writes (C1), the fields AppConfigService
  // keeps when projecting `/api/app/config`, and the fields the two type-pinned clients declare — the
  // dashboard that painted the fabrication is checked against the list, never used to build it.
  // Two invariants that a cleanup would break are pinned rather than "simplified": `getServicesStatus`
  // stays SYNCHRONOUS (C2 — it answers an anonymous public route, and docs/ADMIN_FEATURE_SPECIFICATION
  // .md:482 records that making it async lets a lost record 5xx the public endpoint), and the
  // killswitch control contract survives the deletion whole (C1 + the executed C6, which feeds a genuine
  // PAUSED suspension through the real boot merge and requires every control field to land, because
  // `isServicePaused` and the 423 booking gate read exactly those fields).
  // C4/C5 exist because the durable `PLATFORM_SERVICE_STATE` snapshot outlives the code that wrote it:
  // `restoreServiceState` used to `Object.assign` the stored object wholesale onto the seeded one, so a
  // snapshot written before this correction re-injects every retired field at every boot. Writing the
  // check exposed a second defect, in the guard itself: anchoring a method with a bare
  // `\bname\s*(` matched `await this.restoreServiceState()` at :2152 — 7,700 lines above its definition
  // at :9867 — so C4 inspected a 434-char call-site window, found no `Object.assign`, and reported a
  // PASS on a claim it had never measured. `methodDef` now anchors at the line start and matches the
  // parenthesis pair before the brace pair (a naive body grab on the destructured `pauseService`
  // signature captured the parameter object instead of the body), so every claim reads the body it names.
  // NOT `isolated`, NOT `laneServer`, no shared :4000: the static half reads sources; C5/C6 execute the
  // real `restoreServiceState` against a stubbed store and restore the in-process registry afterwards;
  // the runtime half boots THIS tree's backend on a free loopback port through
  // `scripts/chain_target_guard.requireLoopbackPgTarget` and issues only the four GETs
  // (`/api/services/status`, `/api/ready`, `/api/app/config`, and the credential-less
  // `/api/admin/services/status`, which F5 measures as a 4xx with no services payload), so it writes no
  // session, no job, no order and no ledger line. `GET /api/services/status` is the one read in this
  // tree that can WRITE — the auto-resume pass logs a `SERVICE_AUTO_RESUMED` audit row once a paused
  // service's `resumeAt` has passed — so F7 proves from the recomputed summary that nothing it observed
  // was paused, which is what makes #314 zero-residue a measured statement here instead of an
  // assumption; F-13's prune is disabled for the booted process (`NABIN_SESSION_PRUNE=off`).
  // Measured 2026-10-21: 29/29, exit 0. Its RED was produced by re-injecting the retired behaviour, not
  // assumed: with the raw `Object.assign` merge restored, the snapshot still holding
  // `rides.latencyMs: 38`, '1,248 active drivers • 942 on trip' and
  // `{"satisfaction":"4.82★","completedToday":3492}` put those fields back into the anonymous public
  // response, and the suite reddened C4, C5, F1 and F2 (25/29).
  { file: 'services_status_fabrication_test.js',                                                     // 113
    subtotalPattern: /SERVICES STATUS FABRICATION: (\d+)\/\d+ passed, (\d+) failed/ },
  // NOT REPRODUCIBLE FROM A FRESH CHECKOUT YET: links 80 through 113 are all still untracked, so a
  // `git archive HEAD` tree fails the runner's missing-link guard at 80/81/82/83/84/85/86/87/88/89/90/91/92/93/94/95/96/97/98/99/100/101/102/103/104/105/106/107/108/109/110/111/112/113
  // instead of silently skipping them. They must join the commit unit that carries the MI-1, MI-3,
  // MI-4, MI-5, MI-6, MI-7, MI-8, MI-9 fixes, the P2 handover-OTP hardening (migration 046), the P3
  // delivery-lifecycle work (migration 047), migration 048_merchant_approval_lifecycle.sql, the P9
  // admin stale-read fix (listAdminJobs / listAdminRestaurants + the two routes at server.js:8520/8521),
  // the P10/D-8 admin-OTP-strip in `listAdminJobs` (ADMIN_JOB_SECRET_FIELDS + redactAdminJobSecrets),
  // the P9 §2 store-matrix address and price-alerts source-label fixes, the #481 driver-position
  // truthfulness fix (DriverRepository create/mapRowToDriver + the database.js driver hydration +
  // the admin console's coordinate rendering), the #481 §5 admin-metrics truthfulness fix
  // (`getAdminPlatformMetrics` + the /api/admin/metrics route), and the KYC-P1 customer-identity
  // durability fix (`persistIdentityDecision` + its four callsites + the audit metadata + the login
  // `identityStatus` sync in `verifyAuthOtp`), and the RPN refund-recipient attribution fix (the
  // `usr_2` substitution removed from the /api/admin/finance/refund notification leg), and the GRO-ADDR
  // grocery checkout refusal (the `typedDeliveryAddress` gate plus the three deleted invented-address
  // substitutions on the /api/grocery/checkout/validate route, and the four test_phase4_orders.js
  // payloads that used to rely on the substitution), and the GROCERY-WEB client fabrication fix
  // (`customer-web/src/app/grocery/page.tsx`: the demo-prefix completion branch, both invented
  // `useState` defaults, the wallet payment option and the receipt's status/payment/catalog claims), and
  // the MRCH grocery merchant refusal (the `|| 'mcht_1'` default on the /api/grocery/checkout/validate
  // route replaced by a trim-then-refuse `400 MERCHANT_REQUIRED` gate ahead of the dark-store check), and
  // the FOOD-WEB food-order corrections (`customer-web/src/app/food/page.tsx`: the receipt reads the
  // `order` key the booking route actually sends instead of `job`, the demo-prefix completion branch and
  // its `DEMO-ORD-8812` reference are deleted, the discovery catch reports the outage instead of
  // substituting two invented restaurants, and the status badge and total row make no payment or
  // lifecycle claim the route does not), and the ID-WEB demo-identity correction
  // (`customer-web/src/context/AuthContext.tsx` demo rehydration plus the two demo mints in
  // `customer-web/src/app/login/page.tsx`: `identityStatus` 'VERIFIED' → 'IDENTITY_VERIFICATION_PENDING',
  // the backend's own undecided status; the `User` interface, the authoritative `authApi.me()` path,
  // `ride/page.tsx`, `profile/page.tsx` and every backend KYC gate are unchanged), and the SSF
  // service-status fabrication fix (the 18 deleted `activeVolume`/`latencyMs`/`metrics` assignments and
  // the bounded `restoreServiceState` merge in `backend/src/database.js`, plus the two
  // "not measured"/"No telemetry source" cells in `admin_dashboard.html` — the `getServicesStatus`
  // synchronicity, the pause/resume/killswitch authorization routes, the `/api/ready` semantics and the
  // `/api/app/config` projection are all unchanged).
  // DELIBERATELY NOT REGISTERED, measured 2026-10-14 and re-measured 2026-10-15, so the next reader does
  // not re-litigate it:
  //   test_rms_e2e_integration.js used to fail on its second run against one store: it asked for table
  //   T-101, which the seed merchant already carries, so Stage 1 died on 409 from
  //   restaurant_tables_merchant_id_table_number_key (measured exit 1 in 653 ms). Fixed 2026-10-15 by
  //   isolation instead of deletion — it now creates a run-unique table number it owns outright and
  //   removes exactly its own records in a `finally` (the table by the id the route returned, its KDS
  //   tickets by order id) behind a before/after snapshot of every RMS table. Measured over 3
  //   consecutive guarded local runs: 18/18, exit 0, restaurant_tables 1->1, sessions/bills/payments/
  //   receipts 0->0, kds_tickets 24->24, T-101 row unchanged, zero `E2E-*` residue; the gate-closed run
  //   reports its cleanup check NOT APPLICABLE instead of claiming a database path it did not take.
  //   Still not a chain link, for the structural reason: it authenticates by injecting its merchant and
  //   customer tokens into `db.activeSessions` of its OWN process, so it only answers on the server it
  //   starts itself on an ephemeral port and cannot be aimed at the shared harness. Its second, separate
  //   blocker was retired by F-C1-1 on 2026-10-16: the handle used to resolve a hardcoded default target
  //   rather than an isolated link's `chain_scratch`, so isolated it verified one store while writing
  //   another; `test_fixtures.js` now resolves shell `DATABASE_URL` first and has no default at all, so
  //   the authentication blocker is the one that stands. It also leaves 4 immutable order rows per run on
  //   the seed merchant, which is #314's open residue decision rather than a new one.
  //   test_restaurant_management_system.js is memory-mode only: it names its restaurants `rest_rms_alpha_001`,
  //   which the durable path rejects with 22P02 `invalid input syntax for type uuid` (measured exit 1 on
  //   the local target), and passes 59/59, exit 0, 223 ms with the gate closed.
];

// ---------------------------------------------------------------- link selection
//
// `--only` exists so a fix aimed at one or two links can be re-verified in minutes instead of an
// hour, and so a repeated-run residue proof (run the same lane twice, compare the census) is
// affordable. It is a subset of the SAME LINKS table, so a selected link keeps its registration
// options, its `isolated` lane, its private port and its original link number - the thing that
// cannot be done by invoking `node <suite>.js` by hand.
//
// Two rules make it safe to offer:
//   1. A token that does not name exactly one registered link is a refusal, not a filter.
//      `--only=typo.js` must not become "0 links, exit 0, looked green". Names match the basename with
//      or without `.js`, or a fragment of it — but only when exactly one link matches, so `--only
//      place_substitution` picks one link and `--only test` refuses and lists the candidates instead of
//      silently running a different set than was asked for. Numbers match the 1-based link number
//      already printed in the chain output and cited in comments.
//   2. The run never pretends to be the chain. `links N/M` uses M = the whole table, the console
//      and both evidence files carry SUBSET, and the final marker says so, because a partial run
//      read as a full-chain verdict is the worst possible outcome of a convenience flag.
function parseOnlyTokens(raw) {
  return String(raw).split(',').map((t) => t.trim()).filter(Boolean);
}

/**
 * Every CLI argument is accounted for, or refused by name. Before this, an argument the runner did not
 * recognise was ignored, and that is how `--only 54` (the space form, which is the form the committed
 * testing recipe documents) parsed as "no subset requested" and booted all 77 links while the operator
 * believed they had asked for one. An ignored flag is the dangerous direction for a subset filter: the
 * run is bigger than requested, and nothing on screen says so.
 *
 * Accepted: `--list`, `--only=<tokens>`, `--only <tokens>`, `--no-census`. Anything else comes back as
 * `error`. `--no-census` is in this list because it is read further down by `flagSet`, and a flag the
 * parser refuses never reaches the reader: `node scripts/test_chain.js --no-census` answered
 * `unrecognised argument` and exited 1 while the opt-out path printed nothing at all.
 */
function parseCliArgs(argv) {
  const out = { list: false, onlyTokens: null, noCensus: false, error: null };
  const setTokens = (raw, form) => {
    if (out.onlyTokens) return `--only given more than once ("${form}")`;
    out.onlyTokens = parseOnlyTokens(raw);
    return null;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i]);
    if (a === '--list') { out.list = true; continue; }
    if (a === '--no-census') { out.noCensus = true; continue; }
    if (a.startsWith('--only=')) {
      const e = setTokens(a.slice('--only='.length), a);
      if (e) return { list: false, onlyTokens: null, error: e };
      continue;
    }
    if (a === '--only') {
      const value = argv[i + 1];
      if (value === undefined || String(value).startsWith('--')) {
        return { list: false, onlyTokens: null,
          error: '--only needs a value: a comma-separated list of link names or 1-based link numbers' };
      }
      const e = setTokens(String(value), `--only ${value}`);
      if (e) return { list: false, onlyTokens: null, error: e };
      i++;
      continue;
    }
    return { list: false, onlyTokens: null,
      error: `unrecognised argument "${a}" (accepted: --list, --no-census, --only=<name|number>[,...], `
        + `--only <name|number>[,...])` };
  }
  return out;
}

function selectLinks(links, tokens) {
  const picked = [];
  const unknown = [];
  const ambiguous = [];
  const seen = new Set();
  const stem = (name) => String(name).replace(/\.js$/, '');
  for (const token of tokens) {
    const index = /^\d+$/.test(token) ? Number(token) : null;
    let at = index !== null
      ? links.findIndex((_, i) => i + 1 === index)
      : links.findIndex((l) => l.file === token || stem(l.file) === stem(token));
    // The documented recipe form is a file-name fragment (`--only place_substitution`). A fragment is
    // only a selection when exactly one link matches: accepting the first of several would run a
    // different link than the one named and still print a green line for the token that was typed.
    if (at === -1 && index === null && stem(token) !== '') {
      const matches = links.map((l, i) => ({ l, i })).filter((m) => stem(m.l.file).includes(stem(token)));
      if (matches.length === 1) at = matches[0].i;
      else if (matches.length > 1) {
        ambiguous.push({ token, candidates: matches.map((m) => `${m.i + 1}:${m.l.file}`) });
        continue;
      }
    }
    if (at === -1) { unknown.push(token); continue; }
    if (seen.has(at)) continue;
    seen.add(at);
    picked.push({ link: links[at], index: at + 1 });
  }
  return { picked, unknown, ambiguous };
}

function linkCatalog(lines) {
  return lines.map((l, i) => `${String(i + 1).padStart(3)}. ${l.file}`
    + `${l.isolated ? ' [isolated lane]' : ''}${l.laneServer ? ' [lane backend]' : ''}`
    + `${l.privatePort ? ' [private port]' : ''}`);
}

// ---------------------------------------------------------------- environment gate

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
 *
 * The target is resolved from the shell *and* `backend/.env`, because that is what the harness
 * and every link actually load: `src/server.js:2` runs `require('dotenv').config()` over
 * `../.env`, whose active SECTION A is hosted. Checking only `process.env` was how a bare
 * `npm test` ran 69 links against the hosted dev project on 12 Oct 2026 with this guard silent.
 */
function chainTargetWarning() {
  return targetGuard.remoteStoreWarning(targetGuard.resolveStoreEnv(process.env, targetGuard.readFileEnv()));
}

/**
 * F-C1-3: which schema will the per-link hard guard actually watch?
 *
 * `scripts/chain_scratch.js` reads `NABIN_GUARD_SCHEMA` at require time and this runner passes
 * `process.env` straight to every child, so one value a proof session left in a reused shell pointed the
 * guard at that throwaway schema for the WHOLE run — every isolated link then compared row counts in a
 * schema it had no responsibility for and still read CLEAN, while `public` went unguarded. A full-chain
 * run has exactly one correct answer (`public`) and proof mode exists for the standalone detection probe,
 * so `allowProof: false`: an ambiguous pair of declarations is refused here, before the run directory is
 * created, rather than silently sanitised into a green run.
 *
 * Resolved from the shell AND `backend/.env`, the same way the target above is — a child's dotenv load
 * can supply either key.
 */
function chainGuardEnvConflict(shellEnv = process.env) {
  return targetGuard.guardEnvConflict(
    targetGuard.resolveStoreEnv(shellEnv, targetGuard.readFileEnv()), { allowProof: false });
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

function getJsonOn(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host, port, path: urlPath, method: 'GET', timeout: 2000 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: JSON.parse(body), headers: res.headers });
          } catch (e) {
            resolve({ status: res.statusCode, raw: body, headers: res.headers });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// ---------------------------------------------------------------- harness lifecycle

let harnessProc = null;
let stoppingHarness = false;
// Set only on an *unintended* child exit (the teardown sets stoppingHarness first, so its kill is
// not news). The per-link liveness probe reads it: once our own harness child is gone, every later
// suite would "fail" by connecting to a dead port, and that must read as one harness problem.
let harnessDied = false;

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
    // F-13: this harness serves `public`, and src/server.js arms a 15 s timer whose first
    // statement is `delete from backend_sessions where expires_at <= now()`. Left armed, that
    // write lands between an isolated link's protected snapshot and its verify, and the link is
    // reddened as PUBLIC CONTAMINATION for a row it never touched (measured 2026-10-16: a bare
    // boot pruned 6 expired rows 15,053 ms after readiness). The runner's servers run no
    // background writes; a suite that needs a reconcile tick calls db.reconcileSessions() itself.
    env: { ...env, PORT: String(HARNESS_PORT), NABIN_SESSION_RECONCILE_MS: '0' }
  });
  harnessProc.on('error', (err) => {
    // Without this listener a spawn failure is an unhandled 'error' event, and the run dies with no clue.
    if (!stoppingHarness) console.error(`! harness process failed to start: ${err.code || ''} ${err.message}`);
  });
  harnessProc.on('exit', (code, signal) => {
    // Only an *unintended* exit is news. The teardown below kills this process on purpose, and
    // reporting that as a crash would make a clean run look broken.
    if (!stoppingHarness) {
      harnessDied = true;
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

// ---------------------------------------------------------------- lane backend (isolated HTTP links)

/**
 * An `isolated: true` link gets the disposable `chain_scratch` clone in its own process env, which is
 * enough for a suite that talks to PostgreSQL or Supabase directly. It is NOT enough for a suite whose
 * writes travel through HTTP: those reach the shared harness on :4000, a process whose env was fixed
 * before the clone existed, so the suite's rows land in `public` while its own verification reads
 * `chain_scratch`. That split is exactly why `place_substitution_test.js` and `geo_adversarial_test.js`
 * could not be isolated by `isolated: true` alone, and why they were the two links that booked 7 of the
 * 8 durable orders the 2026-10-15 77-link census attributed. All three booking suites now carry this
 * flag pair.
 *
 * `laneServer: true` closes the split for one link: the runner starts a SECOND backend, bound to its own
 * free port, spawned with the isolated env already applied, and repoints that link's base-URL variables
 * at it. The suite then writes where it is told to look, and the protected-public guard becomes a real
 * test of isolation instead of a formality. Only the marked link sees the lane; every other link keeps
 * talking to the shared harness.
 *
 * It is refused, not warned, when the lane cannot be proven: the clone must already be up, the backend
 * must answer `/api/health` on its own port, and a lane that never comes up must not silently fall back
 * to `public` (the same fail-closed rule D-7 #293 established for the clone itself).
 */
let laneProc = null;
let lanePort = null;

// Every base-URL variable a suite in this chain actually reads (test_suite.js, geo_adversarial_test.js,
// place_substitution_test.js and the four suites that hardcode :4000 are what this set was built from).
// Repointing all of them, rather than one, is deliberate: a suite that reads a variable this list omits
// would talk to the shared harness and write `public` while the run still called itself isolated.
const LANE_BASE_URL_KEYS = ['NABIN_TEST_BASE_URL', 'NABIN_TEST_BASE', 'GEO_TEST_BASE',
  'NABIN_API_URL', 'CHAOS_BASE_URL', 'API_BASE_URL', 'BASE_URL'];

async function spawnLane(env, logDir) {
  const port = await findFreePort(HARNESS_PORT + 200);
  // `logDir` is a parameter, not a fixed read of RUN_DIR, so scripts/lane_check.js can boot a lane
  // for ONE suite outside a chain run; inside the chain it stays in the run-evidence directory.
  const dir = logDir || RUN_DIR;
  if (!dir) throw new Error('spawnLane: no directory to write the lane boot log to');
  const logPath = path.join(dir, `lane-${RUN_ID || process.pid}.boot.log`);
  const proc = spawn(process.execPath, [path.join(BACKEND, 'src/server.js')], {
    cwd: BACKEND,
    stdio: ['ignore', fs.openSync(logPath, 'w'), fs.openSync(logPath, 'a')],
    windowsHide: true,
    // The lane gets the same gate as the harness. Its store is the disposable clone, so an
    // armed timer could not dirty `public` — but it would still delete rows behind the suite's
    // back inside its own measurement window, which is exactly the non-determinism isolation
    // exists to remove. A server this runner starts performs no write that the link did not ask for.
    env: { ...env, PORT: String(port), NABIN_SESSION_RECONCILE_MS: '0' }
  });
  proc.on('error', () => { /* surfaced by the readiness deadline below */ });
  // Measured local boot is 7-21s for this backend (it hydrates the account and geo stores), so this is
  // a polled deadline, not a fixed sleep - the same reasoning as startHarness's READY_DEADLINE_MS.
  const deadline = Date.now() + 90000;
  let last = 'no attempt yet';
  for (;;) {
    await sleep(500);
    try {
      const health = await getJsonOn(HARNESS_HOST, port, '/api/health');
      if (health.status === 200) {
        // Assigned only once the lane is proven healthy: a child that never came up is killed above, and
        // `stopLane` must not report a successful reap for a process that is not the lane.
        laneProc = proc;
        lanePort = port;
        console.log(`lane backend ready on :${port} (pid ${proc.pid})`);
        return { proc, port, url: `http://${HARNESS_HOST}:${port}`, logPath };
      }
      last = `HTTP ${health.status}`;
    } catch (err) {
      last = err.message;
    }
    if (!proc.killed && proc.exitCode !== null) {
      last = `child exited code=${proc.exitCode}; see ${path.relative(BACKEND, logPath)}`;
    }
    if (Date.now() > deadline) {
      try { proc.kill(); } catch (e) { /* already gone */ }
      throw new Error(`lane backend never answered GET /api/health on :${port} within 90s `
        + `(last: ${last}). The link is refused rather than run against the shared harness, because a `
        + `lane link measured against \`public\` would report isolation it did not get.`);
    }
  }
}

async function stopLane(port = lanePort) {
  if (!laneProc || !laneProc.pid) return `no-lane`;
  const pid = laneProc.pid;
  try {
    if (process.platform === 'win32') {
      // argv form, no shell string: the only input is a pid this runner assigned.
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }, () => {});
    } else {
      laneProc.kill('SIGTERM');
    }
  } catch (e) { /* already exited */ }
  laneProc = null;
  for (let i = 0; i < 60; i++) {
    if (!(await portInUse(port))) return `pid ${pid} reaped, :${port} free`;
    await sleep(250);
  }
  return `pid ${pid} stopped but :${port} is STILL bound`;
}

// ---------------------------------------------------------------- harness liveness

/**
 * The runner proves the harness answers /api/health once, in startHarness, then runs every link
 * against that child. If the child dies mid-run — crash, unhandled error, killed from outside the
 * runner — nothing between links noticed: each later suite connects to a now-dead
 * 127.0.0.1:<port> and fails, so one harness death was reported as dozens of test failures. That is
 * the same "harness failure wearing a test failure's clothes" the boot-readiness fix already refuses
 * to accept, just moved from before-link-1 to before-link-N.
 *
 * `livenessVerdict` is pure and exported so `chain_runner_guard_test.js` checks the real decision
 * table rather than a copy (the `scanOutput` precedent). `/api/health` is liveness-only —
 * `src/server.js:395` returns 200 even while PostgreSQL is unreachable — so a non-200 here while the
 * process is alive means the process stopped answering, never a database blip, and it consumes no
 * suite's route-scoped rate-limit budget.
 */
function livenessVerdict({ procExited, healthStatus }) {
  if (procExited) return { state: 'DOWN', reason: 'harness process exited' };
  if (healthStatus === 200) return { state: 'UP' };
  return {
    state: 'UNKNOWN',
    reason: `harness answered /api/health with ${healthStatus === null ? 'no answer' : `HTTP ${healthStatus}`}`,
  };
}

/**
 * A link that declares `isolated` may only be executed *inside* that isolation.
 *
 * Until now the runner spawned the link and only then looked at `isolationError`, so when scratch setup
 * failed the suite ran with the env it would not have had — the shared harness on :4000 and the real
 * `public` schema — while the run labelled it an isolated link. Measured consequence
 * (`chain_20261013_031424_85220_132dfb`, link 48 of 72): that suite's own cold-restart step killed the
 * shared harness, and the chain aborted with links 49..72 unexecuted. The failure was a *setup* failure
 * wearing a *test-run* clothes, the same family `livenessVerdict` above was written for.
 *
 * The honest options are "run it isolated" or "do not run it at all", so that is the decision extracted
 * here — pure and exported for `chain_runner_guard_test.js`, which pins the table and the call ordering.
 * A non-isolated link is never gated by this: it is allowed to touch `public`, and attribution reports it.
 *
 * How the harness actually died, read from source after the probe reproduced it: with dead isolation the
 * runner handed the link no `NABIN_RESTART_PORT`, so `test_phase5_payments.js:27` resolved `TEST_PORT` to
 * its bare-run default of **4000** — the shared harness's own port — and `:106` called
 * `releasePrivatePort(4000)`, which is *designed* to reap a process running `src/server.js`. The suite did
 * exactly what it is built to do to a port it believed was exclusively its own. Nothing in the suite is at
 * fault; the runner ran it outside the contract the suite's own port guard depends on.
 */
function isolatedLinkVerdict(link, isolationError) {
  if (!link || !link.isolated) return { execute: true, reason: null };
  if (isolationError) {
    return {
      execute: false,
      reason: `ISOLATION UNAVAILABLE - LINK NOT EXECUTED: ${isolationError}. Running it now would test the `
        + 'shared harness under a label claiming scratch isolation, and a suite that restarts the backend '
        + 'would evict the harness every later link depends on. Fix the scratch setup (see the per-link log '
        + 'for the setup output), then re-run.',
    };
  }
  return { execute: true, reason: null };
}

/**
 * The cause line of a failed scratch step, instead of the tail of its crash dump.
 *
 * `scripts/chain_scratch.js` dies by throwing out of `sh()`, so Node prints the step header
 * (`[1/4] dumping public schema (schema-only)…`) on **stdout** and then, on **stderr**, the
 * `Error: Command failed: …` sentence, its cause line, `at …` frames, and the error object's JSON —
 * whose `stderr`/`stdout` buffers serialise as arrays of numbers. The three call sites this replaced
 * each took `String(stderr || stdout).slice(-300)`, which therefore (a) discarded stdout whenever
 * stderr was non-empty, losing the step header, and (b) kept the *last* 300 characters — the middle
 * of a numeric buffer dump. Measured on `chain_20261013_051226_55428_5fd073`, the refusal an operator
 * was handed read `ISOLATION UNAVAILABLE - LINK NOT EXECUTED: isolation setup failed: 0, 116,  97,
 * 105, 110,  101,` and `TEARDOWN FAILED: ''`, i.e. a guard that correctly refuses the link cannot
 * tell you why. Same principle as `livenessVerdict`: a stop must name its own cause.
 *
 * Pure and exported so `chain_runner_guard_test.js` pins it against the real captured text.
 */
function isolationFailureSummary(text) {
  const lines = String(text === undefined || text === null ? '' : text)
    .split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length) return 'no output';
  // A line that carries no sentence: stack frames, the caret rule, `{`/`}` braces, and the
  // byte-array dump (`    116,  97, 105,` / `… 97 more items`) whose tail used to be the message.
  const noise = (l) => /^at\s/.test(l) || /^\^+$/.test(l) || /^[\s\d,.[\]{}-]+$/.test(l);
  const step = [...lines].reverse().find((l) => /^\[\d+\/\d+\]/.test(l));
  const causeIndex = lines.findIndex((l) => /^Error\b|Command failed|error during connect/.test(l));
  let parts;
  if (causeIndex === -1) {
    const lastReal = [...lines].reverse().find((l) => !noise(l) && l !== step);
    parts = [lastReal || '(no readable line — the step printed only stack frames and buffers)'];
  } else {
    parts = [lines[causeIndex]];
    const detail = lines[causeIndex + 1];
    if (detail && !noise(detail) && !/^Error\b/.test(detail) && !/^\[\d+\/\d+\]/.test(detail)) parts.push(detail);
  }
  const out = `${step ? `${step} — ` : ''}${parts.join(' — ')}`;
  return out.length > 400 ? `${out.slice(0, 397)}...` : out;
}

// A health GET must always settle: getJson's `timeout` option only emits a 'timeout' event without
// aborting the request, so a harness that accepts the TCP connection but stops answering HTTP would
// hang this await forever and stall the chain instead of aborting it once. Racing a bounded timer
// turns that wedge into a `null` (the "no answer" verdict) rather than a deadlocked run.
async function probeHealthStatus() {
  let timer = null;
  try {
    return await Promise.race([
      getJson('/api/health').then((r) => r.status),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), 2500); }),
    ]);
  } catch (e) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** True only while OUR harness child is running and answering. One confirmation probe before
 *  declaring a wedge so a single GC pause cannot abort an otherwise-healthy chain. */
async function harnessAlive() {
  const exited = () => harnessDied || !harnessProc
    || harnessProc.exitCode !== null || harnessProc.signalCode !== null;
  if (exited()) return { alive: false, reason: livenessVerdict({ procExited: true }).reason };
  const first = await probeHealthStatus();
  if (livenessVerdict({ procExited: false, healthStatus: first }).state === 'UP') return { alive: true };
  await sleep(500);
  if (exited()) return { alive: false, reason: livenessVerdict({ procExited: true }).reason };
  const second = await probeHealthStatus();
  if (livenessVerdict({ procExited: false, healthStatus: second }).state === 'UP') return { alive: true };
  return { alive: false, reason: livenessVerdict({ procExited: false, healthStatus: second }).reason };
}

// ---------------------------------------------------------------- single-runner lock

function harnessLockPath(dir, port) { return path.join(dir, `harness-${port}.lock`); }

function readHarnessLock(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

/** A pid exists (ours or another user's) unless the OS says there is no such process. EPERM means the
 *  process is present but not ours — treat it as alive, so we never start a second harness over a
 *  live owner. */
function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/**
 * Atomic single-writer claim, keyed to the harness port. startHarness's `portInUse` probe is a TOCTOU
 * check: two runners can both see the port free, then contend for it, and the loser can pass the
 * readiness poll against the winner's harness and run its links through a server whose env it does not
 * control. Writing the lock with `wx` (O_EXCL) before anything binds is the atomic version of that same
 * intent, and it names the owning run instead of blaming "the manually-started backend". A lock whose
 * recorded owner pid is gone is stale and gets reclaimed.
 *
 * The claim is per-port by design: this runner only owns the harness it spawns and the :4000-local-DB
 * traffic it creates. Serialising two deliberate runs on DIFFERENT ports against one shared database is
 * an operator/owner decision, not something a harness lock should silently impose.
 */
function acquireHarnessLock(dir, port, identity) {
  const p = harnessLockPath(dir, port);
  const token = crypto.randomBytes(8).toString('hex');
  const payload = JSON.stringify({
    token, pid: identity.pid, runId: identity.runId, host: identity.host, port, startedAt: identity.startedAt,
  });
  const write = () => {
    fs.writeFileSync(p, payload, { flag: 'wx' });
    return token;
  };
  try {
    return write();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = readHarnessLock(p);
    if (owner && isPidAlive(owner.pid)) {
      const err = new Error(
        `another chain run already owns harness port ${port} (run ${owner.runId || 'unknown'}, pid ${owner.pid},`
        + ` started ${owner.startedAt || 'unknown'}). This runner will not start a second harness on the same`
        + ` port/database. If that pid is gone, remove ${p}.`);
      err.code = 'HARNESS_LOCK_HELD';
      throw err;
    }
    try {
      fs.rmSync(p, { force: true });
    } catch (ignore) { /* best effort reclaim */ }
    return write();
  }
}

/** Release only OUR claim. If another runner reclaimed the lock after we were reaped, its token is in
 *  the file and we must not delete it. */
function releaseHarnessLock(dir, port, token) {
  if (!token) return false;
  const p = harnessLockPath(dir, port);
  const owner = readHarnessLock(p);
  if (owner && owner.token === token) {
    try {
      fs.rmSync(p, { force: true });
      return true;
    } catch (e) {
      return false;
    }
  }
  return false;
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
  // The throttle marker is an explanation for a RED link, so it must read events, not vocabulary.
  // `OTP_DISPATCH_FAILED` is both the server's error code (src/server.js:1221) and the tail of the
  // audit action name `AUTH_OTP_DISPATCH_FAILED` (src/database.js:6570) that a green link prints as
  // its own evidence. The word boundary keeps the code and drops the identifier.
  const otpThrottled = /Too many OTP requests|\bOTP_DISPATCH_FAILED\b|try again in/i.test(text);
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

// The full-schema public census (scripts/test_store_census.js) is the independent guard behind the
// protected-name list: it counts every base table in the schema, so a write to a table nobody has
// added to PROTECTED yet still shows up in the run evidence. It resolves its PostgreSQL target from
// the same DATABASE_URL the runner and `chain_scratch snapshot` already use, and refuses a
// non-loopback host - a hosted target would fail here loudly rather than be counted.
const CENSUS_SCRIPT = path.join(BACKEND, 'scripts', 'test_store_census.js');

function censusCli(mode, file) {
  const args = [CENSUS_SCRIPT, mode, 'public'];
  if (mode === 'snapshot') args.push('--out', file);
  if (mode === 'compare') args.push('--ref', file, '--report-only');
  return spawnSync(process.execPath, args, {
    cwd: BACKEND, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: Object.assign({}, process.env, { NODE_ENV: process.env.NODE_ENV || 'local' })
  });
}

function censusLineCount(stdout) {
  return `${stdout || ''}`.split(/\r?\n/).filter((l) => /^public\./.test(l)).length;
}

function flagSet(argv, name) {
  return argv.includes(`--${name}`);
}

// Both helpers live in scripts/port_release.js so the runner and its regression checks share one
// implementation - test_chain.js cannot be imported without starting a chain.
const { readLinkEnv, releasePrivatePort } = require('./port_release');

// Same reason for scripts/census_verdict.js: whether the census MEASURED the store or FAILED to measure
// it is F-10's whole question, and it must be decided by code the regression suite can import.
const censusVerdict = require('./census_verdict');

/**
 * Records the run's own evidence in its directory: a human-readable per-link table and a machine-readable
 * manifest. Written after teardown so the file exists whether the chain finished green, finished red, or was
 * aborted by the harness. It only reports what the links already returned - nothing here can influence a
 * verdict, an assertion, or the exit code.
 */
function writeRunEvidence({ results, passedLinks, problems, checks, skipped, exitCode, harnessPid, harnessFailure, lockRefused, git, subset, census, censusProblems }) {
  if (!RUN_DIR || !RUN_STARTED_AT) return;
  const finishedAt = new Date();
  const lines = [
    `NABIN chain run ${RUN_ID}`,
    `started ${RUN_STARTED_AT.toISOString()}  finished ${finishedAt.toISOString()}`
    + `  duration ${Math.round((finishedAt - RUN_STARTED_AT) / 1000)}s`,
    `harness ${HARNESS_HOST}:${HARNESS_PORT} pid ${harnessPid || 'never started'}`,
    `git ${git.branch || 'unknown'} ${git.commit || 'unknown'}`,
    // A subset run says so in the file a later reader diffs by, not only on the console. `links N/M`
    // keeps M as the registered total so a subset can never be mistaken for the chain.
    `links ${results.length}${subset ? ` of ${LINKS.length} registered (SUBSET: ${subset.requested.join(', ')})` : ` of ${LINKS.length} registered`},`
    + ` clean ${passedLinks}, problems ${problems}, exit ${exitCode}`,
    `${checks} explicit passing checks reported, ${skipped} skipped line(s)`,
    ...(harnessFailure
      ? [`HARNESS_UNREACHABLE before link ${harnessFailure.beforeLink} (${harnessFailure.file}) — ${harnessFailure.reason};`
        + ` links ${harnessFailure.beforeLink}..${LINKS.length} did not run and are not test failures.`]
      : []),
    // F-10: the missing-evidence line goes in the written summary, not only on the console. Worded so
    // `77/77 links clean` on the line above cannot be read as "the whole run was isolation-verified".
    ...(censusProblems && censusProblems.length
      ? [`CENSUS UNAVAILABLE — ${censusProblems.join('; ')}; the run's independent before/after public `
        + `guard produced no verdict, so this run is NOT full isolation verification even where every link reads clean.`]
      : []),
    ...(census && census.state === 'skipped'
      ? ['census: SKIPPED (--no-census) — the before/after full public census did not run; isolation of `public` is NOT proven by this run.']
      : []),
    ...(lockRefused ? ['SECOND RUNNER REFUSED — harness port already claimed by a live chain run; nothing started.'] : []),
    'note: the passed= column is the runner\'s advisory parse of suite output; exit= is the authority.',
    '',
    ...results.map((r) => `[${r.index || 1}/${LINKS.length}] ${r.file} exit=${r.exit === null ? 'null' : r.exit}`
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
    // Null for a full run; for a subset, what was asked and what it resolved to. Without this a
    // metadata.json from a 2-link run looks structurally identical to a 77-link one.
    subset: subset || null,
    // #329's independent guard: the full-schema public census this run took before link 1 and compared
    // after the last link, with every line that moved. `state` is the whole story — `clean` and `drift`
    // are measurements, `unavailable` is the guard failing to measure (see censusProblems), and
    // `skipped` is the operator's --no-census. A null census means no census object was built at all.
    census: census || null,
    // F-10: why this run is not full isolation evidence even when every link reads clean. Empty array =
    // the census either measured something or was explicitly skipped, and census.state says which.
    censusProblems: censusProblems || [],
    // A mid-run harness death stops the loop and is recorded here; a live-lock holder makes the whole
    // run refuse. Both are harness/runner problems, distinct from a suite reporting a product failure.
    harnessUnreachable: harnessFailure || null,
    secondRunnerRefused: lockRefused === true,
    verdict: {
      linksClean: passedLinks, problems, checksReported: checks, skippedLines: skipped, exitCode
    },
    links: results.map((r) => ({
      index: r.index || 0,
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
      laneServer: r.laneServer === true,
      lanePort: r.lanePort || null,
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
  writeLinkLog(link, stdout);
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

// The per-run copy is the evidence and is never reused; the flat file is the latest-run mirror that the
// build docs cite, so it still gets written but is never the thing a red run is traced from.
// Separators are flattened because a link under a subdirectory would otherwise need that subdirectory to
// exist inside the run directory, and a failed evidence write would abort the whole chain.
function writeLinkLog(link, stdout) {
  const linkLogName = `${link.file.replace(/\.js$/, '')}.log`.replace(/[\\/]/g, '_');
  fs.writeFileSync(path.join(RUN_DIR, linkLogName), stdout, 'utf8');
  const mirrorPath = path.join(LOG_DIR, linkLogName);
  fs.writeFileSync(mirrorPath, stdout, 'utf8');
  MIRROR_LOGS.push(mirrorPath);
}

// The shape a link returns when it was never run. `exit: 1` with a failure mark keeps it out of the clean
// count; `passed: 0` keeps it out of the check total rather than inventing coverage; and the evidence file
// says why, because a red link with no log is the finding #165 was raised about.
function refusedLink(link, reason) {
  writeLinkLog(link, `${reason}\n`);
  return {
    file: link.file,
    exit: 1,
    durationMs: 0,
    passed: 0,
    failLines: [reason],
    skipLines: [],
    otpThrottled: false,
    error: 'isolated link refused before execution',
    drift: ['DRIFT public: NOT RUN (isolated link refused before execution)']
  };
}

// ---------------------------------------------------------------- pre-flight: every file this run needs

/**
 * F-C1-6: a registered link whose file is not in this checkout is a REFUSAL, not a red link.
 *
 * Without it a partial checkout behaves like a store problem: the runner takes the before-census,
 * boots a harness against the database, and then pays one `Cannot find module` spawn per missing
 * link, so `HEAD + the runner alone` printed 22 module errors after mutating nothing but reading the
 * store it was never meant to read — and a reader had to work out from the per-link logs that the
 * chain was never runnable here. The measured case is exactly the commit-boundary question: the
 * runner registers 78 links and 22 of those files are absent at `a48c079`.
 *
 * Nothing here skips, downsgrades or counts a missing file as passed. An absent file means the
 * coverage the registry claims does not exist, so the run says so and exits before the census, the
 * scratch provisioning, the harness and the first link.
 *
 * `--list` deliberately stays available on a partial checkout: naming the registered links is how an
 * operator finds out which ones are missing.
 */
const RUNNER_SPAWNED_SCRIPTS = ['scripts/chain_scratch.js', 'scripts/test_store_census.js'];

function missingChainFiles(plan, baseDir = BACKEND) {
  const missing = [];
  for (const entry of plan) {
    const rel = entry.link.file;
    if (!fs.existsSync(path.join(baseDir, rel))) {
      missing.push(`[${entry.index}] ${rel} (registered link)`);
    }
  }
  for (const rel of RUNNER_SPAWNED_SCRIPTS) {
    if (!fs.existsSync(path.join(baseDir, rel))) missing.push(`${rel} (script this runner spawns)`);
  }
  return missing;
}

// ---------------------------------------------------------------- main

// Requiring this file must not start a chain run. `scanOutput` is the runner's parse of a
// link's own log, and a regression in an advisory column of that parse can only be pinned by
// calling the real function (`chain_throttle_heuristic_test.js`) — the alternative the repo
// used before was to copy the patterns into a scratch script, which guards the copy, not the
// runner. `npm test` launches this file as `node scripts/test_chain.js`, where require.main IS
// this module, so the CLI behaviour is byte-for-byte unchanged.
if (require.main === module) (async () => {
  const baseEnv = { ...process.env };
  const argv = process.argv.slice(2);
  const cli = parseCliArgs(argv);
  // An argument the runner cannot account for is a refusal, never something to ignore. `--only 54`
  // (space form) used to parse as "no subset requested", so a command meant to verify one link booted
  // the whole chain and printed 77/77 as if that had been asked for.
  if (cli.error) {
    console.error(`✖ chain refused: ${cli.error}`);
    process.exit(1);
  }
  const onlyTokens = cli.onlyTokens;

  if (cli.list) {
    console.log(`${LINKS.length} registered links, in run order:`);
    for (const line of linkCatalog(LINKS)) console.log(`  ${line}`);
    console.log('\nrun a subset with: node scripts/test_chain.js --only=<name|number>[,<name|number>...]');
    console.log('             or as a separate argument: node scripts/test_chain.js --only <name|number>[,...]');
    console.log('             (--no-census skips the before/after public census, and says so in the result)');
    process.exit(0);
  }
  // Resolved before the run directory exists, so a bad token refuses without leaving an empty run
  // behind and without touching the harness port.
  let plan = LINKS.map((link, i) => ({ link, index: i + 1 }));
  let subset = null;
  if (onlyTokens) {
    if (!onlyTokens.length) {
      console.error('✖ chain refused: --only needs at least one link name or link number');
      process.exit(1);
    }
    const { picked, unknown, ambiguous } = selectLinks(LINKS, onlyTokens);
    if (unknown.length) {
      console.error(`✖ chain refused: --only names no registered link: ${unknown.join(', ')}`
        + `\n  (use a basename like place_substitution_test.js, a fragment that names exactly one link,`
        + ` or the 1-based link number; --list prints all ${LINKS.length})`);
      process.exit(1);
    }
    if (ambiguous.length) {
      console.error(`✖ chain refused: --only names more than one registered link:`
        + ambiguous.map((a) => `\n  "${a.token}" matches ${a.candidates.join(', ')}`).join(''));
      process.exit(1);
    }
    plan = picked;
    subset = { requested: onlyTokens, selectedCount: picked.length, totalLinks: LINKS.length };
  }

  const blocked = refuseReason();
  if (blocked) {
    console.error(`✖ chain refused: ${blocked}`);
    process.exit(1);
  }
  const remote = chainTargetWarning();
  if (remote) {
    console.error(`✖ chain refused: ${remote}`);
    process.exit(1);
  }
  const guardEnv = chainGuardEnvConflict();
  if (guardEnv) {
    console.error(`✖ chain refused: ${guardEnv}`);
    process.exit(1);
  }
  // F-C1-6, before the run directory, the census, the scratch clone and the harness: a link the
  // registry names but this checkout does not have is not a link that can be run, and reporting it
  // here is what keeps `HEAD + runner` from looking like 22 database-suite failures.
  const missingFiles = missingChainFiles(plan);
  if (missingFiles.length) {
    const missingLinks = missingFiles.filter((m) => /\(registered link\)$/.test(m)).length;
    const missingScripts = missingFiles.length - missingLinks;
    console.error(`✖ chain refused: ${missingFiles.length} file(s) this run needs are not in this `
      + `checkout (${path.relative(process.cwd(), BACKEND) || '.'}) — ${missingLinks} of ${plan.length} `
      + `planned link file(s)` + (missingScripts ? ` and ${missingScripts} script(s) this runner spawns` : '')
      + '. Nothing was censused, provisioned or run: a registered file that does not exist is missing '
      + 'coverage, not a passing link.');
    for (const line of missingFiles) console.error(`    MISSING ${line}`);
    console.error('  Either commit the complete dependency set or drop these registrations; '
      + '`--list` prints the registry without needing the files.');
    process.exit(1);
  }

  const run = createRunDir();
  console.log(`run ${RUN_ID}`);
  console.log(`evidence for this run: ${path.relative(process.cwd(), RUN_DIR)}${path.sep}`);
  if (subset) {
    console.log(`SUBSET RUN: ${subset.selectedCount} of ${subset.totalLinks} links selected `
      + `(${plan.map((p) => `${p.index}:${p.link.file}`).join(', ')}) — `
      + 'this is NOT a full-chain verdict, and the skipped links were not run');
  }
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

  // #329's independent guard: the protected-name list can only answer questions about the names on
  // it, so the FULL schema census is snapshotted here and compared after the last link.
  //
  // F-10 separates two things this used to conflate. What the census MEASURES is report-only, because a
  // non-isolated link is allowed to write public state. What the census FAILS TO MEASURE is a run
  // problem: before this, a failed baseline or a compare that never produced a verdict was recorded in
  // `census.error` (or in nothing at all) while the run still printed `77/77 links clean`, exit 0 — a
  // reader could not tell "the whole public schema did not move" apart from "nobody looked".
  const CENSUS_REF = path.join(RUN_DIR, 'census-public.json');
  let census = null;
  const censusProblems = [];
  if (!flagSet(argv, 'no-census')) {
    const snap = censusCli('snapshot', CENSUS_REF);
    const base = censusVerdict.baselineOutcome(snap, isolationFailureSummary);
    if (base.ok) {
      census = { ref: path.relative(process.cwd(), CENSUS_REF), state: base.state, lines: censusLineCount(snap.stdout), drift: base.drift };
      console.log(`census: ${census.lines} line(s) of the full public snapshot taken -> ${census.ref}`);
    } else {
      // `ref` stays null on purpose: a compare against a baseline that was never written would print
      // "0 public line(s) moved" and read as the strongest possible result.
      census = { ref: null, state: base.state, lines: 0, drift: base.drift, error: base.reason };
      censusProblems.push(`baseline census: ${base.reason}`);
      console.log(`census: BASELINE FAILED - ${base.reason}`);
      console.log('census: the run\'s independent whole-public guard never started, so this run cannot claim full isolation verification');
    }
  } else {
    // An explicit operator opt-out, not a measurement failure: the links still ran and the per-link hard
    // guard is untouched, so this stays out of censusProblems. The final verdict names the gap instead.
    census = { ref: null, state: 'skipped', lines: 0, skipped: true, drift: [] };
    console.log('census: --no-census, the full public before/after guard did not run');
  }

  let failures = 0;
  let skipped = 0;
  let kept = true;
  let harnessLockToken = null;
  let harnessFailure = null;
  let lockRefused = false;
  // F-C1-5: set once this run has written the per-link attribution baseline. It goes in `.chain-scratch/
  // snapshot.json` at a FIXED path, so the file cannot distinguish this run from the next one, and a
  // baseline left behind reads to every other tool as "a chain run may be in flight".
  let attributionBaseline = false;
  const results = [];
  try {
    // Claim the harness port before anything binds it. A refusal here (a live owner holds the lock) is
    // one harness problem, counted once by the catch below, and the finally never deletes a lock we did
    // not create because harnessLockToken stays null.
    harnessLockToken = acquireHarnessLock(LOG_DIR, HARNESS_PORT, {
      pid: process.pid, runId: RUN_ID, host: HARNESS_HOST, startedAt: RUN_STARTED_AT.toISOString(),
    });
    await startHarness(baseEnv);
    console.log(`harness: ${baseUrl} (pid ${harnessProc.pid}), ${plan.length} links${subset ? ` of ${LINKS.length} registered` : ''}, sequential`);

    const restartPort = await findFreePort(HARNESS_PORT + 100);
    console.log(`restart_test.js will own private port ${restartPort}\n`);

    for (const [position, entry] of plan.entries()) {
      const { link, index } = entry;
      if (position > 0) {
        // Link 0 immediately follows the readiness poll; every later link re-proves the harness it is
        // about to test against. A dead child throws, which the outer catch records as ONE harness problem
        // instead of letting each remaining suite "fail" by connecting to a dead port.
        const alive = await harnessAlive();
        if (!alive.alive) {
          // `index` is already the 1-based registered number (see the plan mapping), so this cites the
          // link a reader finds in `--list` and in metadata - the same numbering CRG-45 pins.
          harnessFailure = { beforeLink: index, file: link.file, reason: alive.reason };
          throw new Error(
            `HARNESS_UNREACHABLE before link ${index}/${LINKS.length} (${link.file}): ${alive.reason}. `
            + `Links ${index}..${LINKS.length} did not run and are not test failures.`);
        }
      }
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
      let lane = null;
      let laneUrl = null;
      // Attribution bookkeeping for a NON-isolated link. The per-link baseline is what makes a `DRIFT`
      // line name exactly one link, so a baseline that could not be taken has to be said out loud:
      // otherwise this link is silently compared against the PREVIOUS link's counts and the two links'
      // writes are merged into one attribution that reads as though it belonged to this one.
      let attributionGap = null;
      if (link.isolated) {
        // Order matters, and every step is checked: provision (clone + throwaway PostgREST + proxy) ->
        // link-env (write the isolated env file) -> snapshot (protected public counts) -> read the file.
        // The first in-chain attempt died here because `link-env` was never invoked, so readLinkEnv()
        // threw ENOENT and that throw escaped into the harness-level catch, aborting the whole chain.
        const prov = scratchCli('provision');
        const le = prov.status === 0 ? scratchCli('link-env') : prov;
        const snap = le.status === 0 ? scratchCli('snapshot') : le;
        if (snap.status !== 0) {
          // Both streams: the step header that names the stage is on stdout, the cause on stderr.
          isolationError = `isolation setup failed: ${isolationFailureSummary(`${snap.stdout || ''}\n${snap.stderr || ''}`)}`;
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
        // The lane backend is the second half of isolation and it can only exist after the clone is
        // up: it is spawned with the isolated env, so its own writes go to `chain_scratch`, and the
        // link's base-URL variables are then repointed at it. Without this, a suite whose writes
        // travel over HTTP lands them in `public` while its reads see the clone.
        if (!isolationError && link.laneServer) {
          try {
            lane = await spawnLane(env);
            laneUrl = lane.url;
            for (const key of LANE_BASE_URL_KEYS) env[key] = lane.url;
          } catch (e) {
            isolationError = `lane backend unavailable: ${e.message}`;
          }
        }
      } else {
        // F-3(a): attribution baseline for an ordinary link. Nothing is enforced with it - the diff is
        // reported after the link runs. Snapshotting per link (rather than reusing an old file) is what
        // makes the attribution defensible: exactly one link executes between the two counts. That claim
        // rests on F-13, not on the harness being idle by nature - `src/server.js` arms a 15 s session
        // reconciler whose first statement deletes expired rows from `public`, and it used to run inside
        // every attribution window. Both servers this runner starts now carry
        // NABIN_SESSION_RECONCILE_MS=0, so "no write of its own in between" is enforced rather than assumed.
        // The status IS checked now, and only recorded: an ordinary link must not go red because the
        // guard had trouble, but its drift line must not be computed from a stale baseline either.
        const snap = scratchCli('snapshot');
        attributionBaseline = true;
        if (snap.status !== 0) {
          attributionGap = isolationFailureSummary(`${snap.stdout || ''}\n${snap.stderr || ''}`);
        }
      }

      // The registered link number, not the loop position: `--only` keeps each link's own number, and
      // the per-link drift attribution recorded in this file is cited by that number. Printing the
      // position here made test_suite.js appear as [2/77] and place_substitution as [55/77].
      process.stdout.write(`[${index}/${LINKS.length}] ${link.file} ... `);
      // The permit is consulted BEFORE the spawn, and that ordering is the whole fix: marking the link
      // failed after running it left the suite executing against the shared harness anyway, which is what
      // aborted chain_20261013_031424_85220_132dfb at link 48 of 72.
      const permit = isolatedLinkVerdict(link, isolationError);
      const result = permit.execute ? runLink(link, env) : refusedLink(link, permit.reason);
      // The registered link number, not the loop position: a `--only` subset run must not renumber link 54
      // as 1, because the per-link `drift` attribution records in this file are cited by link number.
      result.index = index;
      result.laneServer = !!link.laneServer;
      if (lane) result.lanePort = lane.port;
      if (!permit.execute) {
        // A lane spawned before the refusal is ours to reap: leaving a second backend bound while the
        // remaining links run would put an isolated server in front of suites that expect the harness.
        if (lane) {
          const laneStopped = await stopLane();
          if (/STILL bound/.test(laneStopped)) {
            result.failLines = result.failLines.concat([`LANE PORT ${lane.port} ${laneStopped}`]);
          }
        }
        // Setup failed part-way, so a clone/proxy may already exist. Clean it up anyway: leaking the
        // throwaway schema and a bound :54331 across the rest of the chain would be worse than the
        // single refused link.
        const td = scratchCli('teardown');
        if (td.status !== 0) {
          result.failLines = result.failLines.concat([
            `TEARDOWN FAILED: ${isolationFailureSummary(`${td.stdout || ''}\n${td.stderr || ''}`)}`
          ]);
        }
        const released = releasePrivatePort(isolationPort);
        result.isolationPort = isolationPort;
        if (/skipped:foreign/.test(released)) {
          result.failLines = result.failLines.concat([
            `PORT ${isolationPort} HELD BY A FOREIGN PROCESS - not killed, link refused so the runner cannot evict unrelated services`
          ]);
        }
      } else if (link.isolated) {
        // The lane must be stopped BEFORE `verify`: it is the process holding the clone's writes, and a
        // lane still serving would let a late request land after the contamination snapshot was taken.
        if (lane) {
          const laneStopped = await stopLane();
          if (/STILL bound/.test(laneStopped)) {
            result.exit = result.exit || 1;
            result.failLines = result.failLines.concat([`LANE PORT ${lane.port} ${laneStopped}`]);
          } else {
            console.log(`(lane backend on :${lane.port} stopped) `);
          }
        }
        const ver = scratchCli('verify');
        if (ver.status !== 0) {
          const lines = `${ver.stdout || ''}${ver.stderr || ''}`.split(/\r?\n/).filter((l) => /DRIFT|CONTAMINATION|GUARD ERROR/.test(l));
          result.exit = result.exit || 1;
          result.contamination = true;
          result.failLines = result.failLines.concat(lines.length ? lines : ['PUBLIC CONTAMINATION: guard exited non-zero without detail']);
        }
        const td = scratchCli('teardown');
        if (td.status !== 0) {
          result.exit = result.exit || 1;
          result.failLines = result.failLines.concat([
            `TEARDOWN FAILED: ${isolationFailureSummary(`${td.stdout || ''}\n${td.stderr || ''}`)}`
          ]);
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
        // Both streams, and the guard's own markers: `diff` prints its DRIFT lines on stdout and dies by
        // throwing on stderr (`GUARD ERROR: …`, exit 1). Reading only stdout recorded a guard crash as an
        // unexplained gap, which is the silence-this-runner-exists-to-remove, one level down.
        result.drift = `${diff.stdout || ''}\n${diff.stderr || ''}`.split(/\r?\n/)
          .filter((l) => /^(DRIFT|GUARD ERROR|CONTAMINATION)/.test(l.trim()));
        if (attributionGap) {
          result.drift = [`DRIFT public: BASELINE UNAVAILABLE (${attributionGap}) - the counts below are `
            + `relative to an earlier baseline, so this link is not proven to be their owner`, ...result.drift];
        }
        if (!result.drift.length) {
          const detail = isolationFailureSummary(`${diff.stdout || ''}\n${diff.stderr || ''}`);
          result.drift = [`DRIFT public: UNAVAILABLE (${detail}) - attribution failed, link status unaffected`];
        }
      }
      results.push(result);      skipped += result.skipLines.length;
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
    if (err && err.code === 'HARNESS_LOCK_HELD') lockRefused = true;
    console.error(`✖ harness error: ${err.message}`);
  } finally {
    // The lane is reaped before the census compare, in this block rather than only inside the loop: a
    // lane that came up but whose link threw would otherwise keep writing to its clone while the
    // run's final public census was being counted.
    if (laneProc) {
      const laneStopped = await stopLane();
      console.log(`lane teardown: ${laneStopped}`);
    }
    const stopped = await stopHarness();
    console.log(`\nteardown: ${stopped.note}`);
    if (!stopped.released) failures++;
    // #329's guard, second half: compare after EVERY child is stopped, so a write still in flight
    // cannot make the delta look smaller than it is. Drift is report-only, because a non-isolated link
    // is allowed to write public state; an ABSENT verdict is not, because that is the guard not running.
    if (census && census.ref) {
      const cmp = censusCli('compare', CENSUS_REF);
      const out = censusVerdict.compareOutcome(cmp, isolationFailureSummary);
      census.state = out.state;
      census.drift = out.drift;
      census.clean = out.clean;
      // The compare is run with `--report-only`, so it exits 1 on drift NEVER — a nonzero status here,
      // or a status-0 run that printed neither `CENSUS CLEAN` nor a `DRIFT` line, means no verdict was
      // produced. Both land in censusProblems; only real, counted movement stays advisory.
      if (!out.ok) {
        census.error = out.reason;
        censusProblems.push(`post-run census: ${out.reason}`);
        console.log(`census: UNAVAILABLE - ${out.reason}`);
        console.log('census: the before/after public guard produced no verdict, so this run cannot claim full isolation verification');
      } else if (out.drift.length) {
        console.log(`census: ${out.drift.length} public line(s) moved since the snapshot (measured; report-only, per-link cause is in the drift lines above)`);
      } else {
        console.log(`census: CLEAN against the run's snapshot (${census.lines} line(s) of the full public schema)`);
      }
      for (const line of census.drift.slice(0, 8)) console.log(`      ${line.trim().slice(0, 150)}`);
      if (census.drift.length > 8) console.log(`      ${census.drift.length - 8} more census line(s) in ${path.relative(process.cwd(), path.join(RUN_DIR, 'metadata.json'))}`);
    }
    // F-C1-5 (measured 2026-10-16): the attribution baseline outlived the run that wrote it.
    // chain_20261016_080137_15108_4f72a0 exited 0 at 08:02:10 and left `.chain-scratch/snapshot.json`
    // holding a `public` baseline taken 08:02:08; `scripts/guard_detection_probe.js` refuses exactly that
    // shape, because it cannot tell a finished run's residue from a run in flight, and was still refusing
    // at 09:44. The per-link drift attribution is already recorded in metadata.json by the time we get
    // here, so this file has no remaining owner — dropping it is what makes "no baseline" the honest
    // answer for the next tool instead of a phantom live one. A hard-killed run still leaves it, and the
    // documented escape for that is `node scripts/chain_scratch.js teardown`.
    if (attributionBaseline) {
      const drop = scratchCli('drop-baseline');
      console.log(drop.status === 0
        ? String(drop.stdout || '').trim().split(/\r?\n/).pop()
        : `! attribution baseline NOT dropped (exit ${drop.status}) - a later guard probe will refuse until teardown runs`);
    }
    // Release the single-runner claim. A null token means we never owned it (a live holder's lock made
    // us refuse), so this is a no-op and must not delete the other run's lock.
    const releasedLock = releaseHarnessLock(LOG_DIR, HARNESS_PORT, harnessLockToken);
    if (harnessLockToken && !releasedLock) {
      console.error(`! could not release harness lock ${harnessLockPath(LOG_DIR, HARNESS_PORT)}`);
    }
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
  // F-10: a census that could not measure the store fails the RUN even when every link is green. It is
  // counted outside `failures` on purpose, so `NNN/77 links clean` keeps describing links and the
  // problem line below names the missing evidence instead of a suite that never failed.
  const problems = failures + censusProblems.length;
  const exitCode = problems ? 1 : 0;
  if (kept) {
    writeRunEvidence({
      results, passedLinks, problems, checks, skipped, exitCode,
      harnessPid: harnessProc ? harnessProc.pid : null, harnessFailure, lockRefused, git: run,
      subset, census, censusProblems
    });
  }
  // The denominator is what this run actually executed. For the full chain that is LINKS.length; for
  // `--only` it reads 2/2, and the SUBSET clause below is what stops a reader (or a script grepping for
  // `77/77`) from taking it as a chain verdict. F-10: `problem(s)` is now links PLUS run-level evidence
  // problems, so a run whose census never measured cannot print `0 problem(s)` next to exit 1.
  console.log(`\n=== CHAIN RESULT: ${passedLinks}/${results.length} links clean, ${problems} problem(s)`
    + `${subset ? ` — SUBSET RUN, ${subset.selectedCount} of ${LINKS.length} registered links selected; `
      + 'the other links did not run and this is NOT a full-chain verdict' : ''} ===`);
  console.log(`    ${checks} explicit passing checks reported, ${skipped} skipped line(s) across the chain`);
  if (harnessFailure) {
    console.log(`    HARNESS_UNREACHABLE — ${harnessFailure.reason}: the run stopped before link `
      + `${harnessFailure.beforeLink}/${LINKS.length}; links ${harnessFailure.beforeLink}..${LINKS.length} `
      + `were not executed and are not test failures.`);
  }
  if (lockRefused) {
    console.log('    SECOND RUNNER REFUSED — the harness port was claimed by another live chain run; '
      + 'nothing was started and nothing was written.');
  }
  // F-10: named on the same screen as the `N/M links clean` marker, because that marker says nothing
  // about whether the independent whole-public guard ran. Links being green is not isolation evidence.
  for (const p of censusProblems) console.log(`    CENSUS UNAVAILABLE — ${p}`);
  if (censusProblems.length) {
    console.log(`    ${censusProblems.length} census problem(s): the before/after full public guard produced no verdict, `
      + 'so this run is NOT full isolation verification. Link verdicts and per-link hard-guard results are unaffected.');
  }
  if (census && census.state === 'skipped') {
    console.log('    ISOLATION EVIDENCE INCOMPLETE — --no-census: the full public before/after guard was not run, '
      + 'so isolation of `public` is not proven by this run.');
  }
  if (skipped) console.log('    a skip is coverage this run did not get; the reason is in the per-link log');
  if (problems && kept) {
    console.log(`full output per link in ${path.relative(process.cwd(), RUN_DIR)}${path.sep}<link>.log`);
    console.log(`    the previous runs under ${path.relative(process.cwd(), RUNS_DIR)}${path.sep} are untouched`);
  }
  if (!kept) console.log('    NABIN_KEEP_CHAIN_LOGS=0: this run\'s directory was removed after teardown');
  process.exit(exitCode);
})().catch((err) => {
  console.error(`✖ ${err && err.message ? err.message : err}`);
  process.exit(1);
});

module.exports = {
  scanOutput,
  livenessVerdict,
  isolatedLinkVerdict,
  isolationFailureSummary,
  harnessLockPath,
  readHarnessLock,
  isPidAlive,
  acquireHarnessLock,
  releaseHarnessLock,
  parseOnlyTokens,
  parseCliArgs,
  // Exported for the same reason as `parseCliArgs`: the F-10 opt-out broke because the parser refused
  // `--no-census` while the census step read it from argv, and a pin that can only see one of the two
  // halves cannot say whether the flag is reachable at all.
  flagSet,
  // Also exported for `chain_runner_guard_test.js` (F-C1-3): the refusal must be checked by CALLING the
  // runner's own predicate with a stale inherited redirect, because `--list` exits before this guard runs
  // and no test can otherwise reach it without starting a real chain run.
  chainGuardEnvConflict,
  // F-C1-6, for the same reason: the missing-file refusal is only pinned by calling the predicate the
  // run actually uses, against a synthetic plan and a base directory that does not hold the files.
  missingChainFiles,
  selectLinks,
  linkCatalog,
  // The lane primitives, exported so scripts/lane_check.js can boot the SAME lane a `laneServer`
  // link gets and prove a suite is isolatable BEFORE it is registered. Two implementations of
  // "start a backend on a free port with the isolated env" would drift, and the drift would show up
  // as a suite that passes the lane check and then contaminates `public` inside the chain.
  spawnLane,
  stopLane,
  LANE_BASE_URL_KEYS,
  // Exported so the subset filter is tested against the registration table the chain actually runs,
  // rather than a list the guard maintains by hand and that drifts from it.
  LINKS,
};
