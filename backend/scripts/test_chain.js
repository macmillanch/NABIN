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
