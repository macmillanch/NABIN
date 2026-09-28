# NABIN — Current Repository State

**Last Updated**: 2026-09-24
**Mode**: IMPLEMENTATION — verified work is committed LOCALLY only; `main` is ahead of
`origin/main` (`0bd03ce`) and nothing newer has been pushed
**Status**: AUTHORITATIVE SNAPSHOT

> **Uncommitted working tree (2026-09-25, local only):** eleven verified slices sit
> on top of `HEAD` `8aa395f` — 24 tracked files modified, 5086 insertions / 1490
> deletions, plus 7 new test files (`checkout_store_semantics_test.js`,
> `hydration_fallback_test.js`, `campaign_outage_test.js`, `customer_activity_test.js`,
> `driver_earnings_test.js`, `driver_operations_test.js`, and
> `mobile/test/driver_login_screen_test.dart`) — none committed (this session's directive does
> not authorize commits). The only other untracked path is `.kilo/agents/data.md`,
> written by the tool environment rather than by this work. (1) The **admin master-catalogue persistence** slice (`database.js`,
> `server.js`, `test_suite.js` MODULE 38, `restart_test.js`) already recorded below.
> (2) The **codebase-wide 5xx/4xx outage-classification sweep** — the Phase 4 open
> item at the bottom of this record. `OrderRepository.js` gained `settleStore` +
> `storeUnavailableError`, so the three checkout resolvers (merchant lookup,
> restaurant menu, store inventory) now raise a `503` when PostgreSQL cannot answer
> instead of swallowing the error into a not-found; the nine checkout/merchant route
> catches in `server.js` hand that error to the shared `storeReply` classifier, and
> the food route's previously un-caught `resolveMerchant` is now wrapped. Verified
> green on the live local stack: full `npm test` chain (test_suite 427/0, session
> reconcile 26/0, boot mirror 20/0, geo policy 55/0, geo adversarial 60/0, geo anon
> 44/0, restart 40/0), `auth_failclosed_test.js` 15/0, and the new
> `checkout_store_semantics_test.js` 5/0 with a red-green proof.
>
> **Hydration-read outage semantics — OWNER DECISION 11 (choice B), implemented
> (2026-09-24, uncommitted):** the same sweep surfaced six sibling repository reads
> (`PaymentRepository.getPaymentSession`, `UserRepository.findByIdAsync`/
> `findByPhoneAsync`, `DriverRepository`, `JobRepository`, `DispatchRepository`)
> that are read-through caches answering from hydrated memory when PostgreSQL is
> unreachable (fail-OPEN) — the opposite failure mode. The owner chose **B: keep the
> memory fallback** (recorded in `docs/OWNER_SECURITY_DECISIONS.md` as a deliberate
> carve-out from the general fail-closed policy). No read behavior was changed; each
> site now carries an "Owner Decision 11 (choice B)" guard comment, and
> `backend/hydration_fallback_test.js` (8/0, sensitivity-checked) locks the
> semantics. `SupportTicketRepository`'s flagged line was confirmed to be a write,
> out of scope. `checkout_store_semantics_test.js`, `hydration_fallback_test.js`
> and `auth_failclosed_test.js` were added to the `npm test` chain — the whole
> 265-check chain is green.
>
> **Campaign outage coverage (2026-09-24, uncommitted):** the sweep's last untested
> guard — `CAMPAIGNS_UNAVAILABLE` → 503, previously verified only by reading the
> code because an outage also kills admin authentication — now has
> `backend/campaign_outage_test.js` (CAMP-01…05, 5/0). It drives
> `CampaignRepository` directly from a child process pointed at a closed port, so
> all three campaign reads are proven to throw `CAMPAIGNS_UNAVAILABLE`/503 rather
> than answer an empty list, and both not-live paths are proven to return `null`
> (the route's 503 branch). Sensitivity-checked: swallowing `settle()`'s store
> rejection reddens CAMP-01/02/03 while the two controls stay green. Added to the
> `npm test` chain and `npm run test:outage`; the full chain re-ran green afterwards
> (427 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 + 8 + 5 checks at that point, 0 failures —
> the suite has grown since, see the next paragraph).
>
> **Browser-reachable idempotency + a pageable coupon list (2026-09-24, uncommitted):**
> the two non-gated items left in `TASKS.md`'s Phase 4 list. `Idempotency-Key` — the
> canonical spelling that **six** routes read before the `X-` fallback (ride and parcel
> booking, grocery checkout, offer acceptance, food ordering, coupon redemption) — was
> missing from CORS `allowedHeaders`, so a browser sending it failed its own preflight
> and a retry without it could double-book; the list is now widened, not rewritten.
> `GET /api/admin/promotions` answered an unlabelled first 50 rows, which on a local
> table of 539 coupons meant an older voucher was invisible to the console;
> `PromotionRepository.list()` now pages (`limit` 1…100, `offset`), searches code/name/
> description through a filter-syntax-stripped term, orders on a stable `id`
> tiebreaker, and reports `{promotions, total, limit, offset, hasMore}`. The new tests
> caught a real defect in that implementation: PostgreSQL answers an out-of-range
> `.range()` with `416 Requested range not satisfiable`, so an offset past the end was a
> 500 — the count is now established with a head request first and the range clamped.
> `test_suite.js` MODULE 39 (CORS-01…05) and MODULE 40 (PL-00…PL-10 + PL-TEARDOWN,
> fixtures reaped) lock both, each reddened in isolation — CORS-01/04 alone with the
> header removed, the 11 paging assertions alone with the repository reverted while
> PROMO-01…13 stayed green. Full chain green afterwards: **722 checks, 0 failures,
> exit 0** (test_suite 444, session reconcile 26, boot mirror 20, geo policy 55, geo
> adversarial 60, anon geo 44, restart 40, auth fail-closed 15, checkout 5, hydration
> 8, campaign 5).
>
> **The dormant security suite is now armed (2026-09-24, uncommitted):**
> `test_phase7_security.js` was recorded here as red 36/9 and probing a route that no
> longer exists. Both halves of that note are false against the file as committed — it is
> **45/0 green** with no working change to it, and both its ride-booking probes already
> call the live `/api/customer/book-ride`. The genuine defect was that no command the
> project runs executed it: `npm test` stopped at eleven suites and CI runs three, so
> 45 authorization, privacy, RLS, `search_path`, OTP-leak and race assertions were
> protecting nothing. It is now the twelfth link of `npm test`, plus
> `npm run test:security`. Before wiring it in, two properties were verified rather than
> assumed: that it **bites** — weakening the media-asset ownership guard in `server.js`
> reddens that one assertion, 44/1 with exit code 1, so the chain aborts — and that it is
> **neutral** to what follows — two consecutive full chains, phase7 last both times, came
> back **767 checks / 0 failures / exit 0** each. No assertion was edited, loosened or
> skipped anywhere in this slice.
>
> **The five dormant admin suites are armed too (2026-09-24, uncommitted):** the same
> search found five more files in the same condition — `admin_identity_gates_test.js`
> (64 assertions), `admin_authorization_test.js` (113, the permission-matrix and
> session-revocation suite), `admin_customers_test.js` (83),
> `admin_settings_surface_test.js` (31) and `admin_audit_fail_closed_test.js` (79) — none
> of them named by any `npm` script or CI step. Run fresh, **all five were already green**,
> so this slice wires coverage rather than repairing anything: `npm test` now has
> seventeen links and `npm run test:admin` runs the family alone. Each file was checked
> for the two properties that make chaining safe — a non-zero exit when assertions fail,
> and deleting only rows it inserted. Load-bearing proof: dropping
> `requirePermission('admin_accounts.manage')` from `GET /api/admin/accounts` reddened
> **CAT-04** in the authorization suite, the ratchet that counts admin routes with no
> permission check (18 against a ceiling of 17), and the chain halted there with exit 1;
> the gate was restored and verified byte-identical. Two consecutive full chains after
> the restore: **1137 checks, 0 failures, exit 0 each**.
>
> **The customer Activity screen was fabricating trips (2026-09-24, uncommitted):**
> `mobile/lib/features/activity/` rendered a `const` list of journeys nobody had
> taken ("Auto Ride to Connaught Place" `TRIP-884910`, "Dilli Darbar Mughlai"
> `FOOD-294711`, "Instant Parcel to Karol Bagh" `PKG-110293`) and its receipt sheet
> asserted a payment mode ("NABIN Wallet (Instant Settlement)") the server had never
> reported — a §32 fake-UI violation on a screen that shows a customer their money.
> There was no endpoint to point it at: `GET /api/customer/orders` existed but no
> per-customer read of `jobs` did, and `JobRepository` had no such method. Backend now
> has `JobRepository.getJobsByCustomer()` and `GET /api/customer/activity`, which
> derives identity from the bearer token only (never a body/query id), reads RIDE+PARCEL
> legs from `jobs` and FOOD+INSTAMART legs from `orders` — deliberately not a naive
> merge, because a food or grocery purchase owns both an `orders` row and a delivery
> `jobs` row and merging them double-counts — and fails closed with a 503 through the
> existing `settleStore` helper rather than answering "no history" when PostgreSQL
> cannot be reached (Owner Decision 11's memory fallback is *not* extended here). The
> screen is rebuilt on that feed with loading / error+retry / empty states, an
> Instamart filter, In-progress and Earlier sections, and a receipt that shows only
> fields the server returned. `backend/customer_activity_test.js` (ACT-01…20, **20/0**)
> is the eighteenth link of `npm test`. Load-bearing proof: replacing the ownership
> filter with `.not('customer_id','is',null)` reddened exactly the two security
> assertions — ACT-08 named the foreign owners it had leaked and ACT-19 showed both
> feeds sharing 49 rows — with exit code 1 while the other 18 held; the filter was
> restored and re-verified. `dart analyze` on the two touched Dart paths reports **No
> issues found**. **Paging trap found while writing it:** an unbounded PostgREST read
> silently caps at 1000 rows and this fixture customer has 1305 orders, so a "read all
> of theirs and diff" probe reports false IDOR leaks — ownership is verified with
> `.in(...)` over the ids the feed itself returned, which also asserts every row's
> `customer_id` equals the caller. Full chain after arming: **1157 checks, 0 failures,
> exit 0** (444 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 + 8 + 5 + 45 + 64 + 113 + 83 +
> 31 + 79 + 20).
>
> **A driver's earnings did not survive a restart (2026-09-24, uncommitted):**
> `todayTrips`/`todayEarnings`/`weeklyEarnings`/`monthlyEarnings` were process-local
> counters that boot hydration pinned to `0` while restoring `wallet_balance` from
> PostgreSQL — so a partner's wallet outlived a restart and the earnings printed beside it
> did not. Both driver earnings routes now share one `buildDriverEarningsPayload()` fed by
> `JobRepository.getDriverCompletedRows()`, which totals durable `jobs` rows through the
> paging-safe `readAllRows` walk; identity comes from the bearer token alone, an
> unreadable ledger is a 503 rather than a zero, and a read that returns a foreign trip
> throws `EARNINGS_SCOPE_VIOLATION` instead of quietly dropping it (dropping under-reports
> money owed). `cashCollectedToday`/`onlinePaidToday` are now `null`, because every
> COMPLETED job still carries `payment_status = 'PENDING'` and `0` would assert a fact the
> database does not hold. `backend/driver_earnings_test.js` (EARN-01…29, **29/0**) is the
> nineteenth link of `npm test` and recomputes each window independently with `range()`
> paging, so a broken cursor walk cannot agree with itself. Four mutations reddened
> exactly their targets: widening the status filter inflated 30-day pay by ₹26,653 and
> leaked two foreign job numbers (EARN-16), restoring the counters reproduced the original
> ₹0 defect (EARN-09/10), swallowing an incomplete read failed EARN-27, dropping the
> mismatch guard failed EARN-20. Full chain on current source: **19/19 links exit 0, zero
> `[FAIL]`/`❌` marks** (444 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 + 8 + 5 + 45 + 64 +
> 113 + 83 + 31 + 79 + 20 + 29).
>
> **The standalone driver app had no backend at all (2026-09-24, uncommitted):**
> `driver_otp_screen.dart` "signed in" with `Future.delayed(600ms)` and a navigation —
> anyone pressing Verify became an authenticated driver with no credential sent and no
> token held — while `driver_earnings_screen.dart` was entirely literal: ₹1,420.00 /
> ₹9,850.00 / ₹38,400.00, a UPI address `rajesh.driver@okhdfcbank` present in no table, a
> "Platform Fee (10%)" row where the platform's own settlement rule is 15%, three invented
> trips, and a Withdraw button that only displayed a snack bar. No driver screen
> referenced `NabinApiService`; the four driver methods it does expose were called from
> nowhere. Login and the money surface are now real: driver-role OTP dispatch and
> verification through `/api/auth/*`, a session saved **only when the server issued a
> token**, a working resend behind a 30s countdown (the prefilled code and "Demo code:
> 7729" label are gone), and an earnings ledger rendered from
> `GET /api/driver/earnings` with loading / error-retry / empty states, a ledger-outage
> message distinct from "no trips", the server's own payout destination, and a real
> `POST /api/driver/payout` that repeats the platform's answer — where a payout is not
> allowed the card states the reason instead of offering a dead button.
> `driver_router.dart` no longer renders the console, ledger or account to an
> unauthenticated session, and `acceptJob`'s `driverId = 'drv_1'` default identity is
> removed. `dart analyze` on all five changed Dart paths: **No issues found** (the
> project-wide run still lists 67 pre-existing info-level lints, none in these files).
> A 17-check live probe, run against a server the harness spawned and verified, confirmed
> every field the Dart parser reads and proved three refused payouts leave the wallet at
> ₹1111 → ₹1111. **Not yet wired, recorded rather than glossed:**
> `driver_home_screen.dart`, `driver_account_screen.dart` and
> `active_job_execution_screen.dart` still contain zero API usage (online toggle, offers,
> accept/reject, trip OTP, complete flow), and `features/driver/…/driver_app_shell.dart`
> — the customer super-app's `/driver-dashboard` "Partner Mode Simulator", which holds the
> seeded `_walletBalance = 1420.0` and the Dart-side `fare * 0.1` commission — is flagged
> for an owner decision rather than deleted.
>
> **The driver console, trip screen and account page were theatre (2026-09-25, uncommitted):**
> finishing the driver app. Home kept availability in a Dart boolean, printed `₹1,420.00` and
> "8 Trips Done" as text, and had three **Simulator Trigger Buttons** that invented an offer on
> tap — addresses, fare and a customer's name — for a trip the platform never created; the trip
> screen was a local `_stage = 1..4` counter with the OTP field pre-filled `7729`, so arriving,
> starting and completing sent nothing anywhere; the account page invented the partner's name,
> phone, rating, licence plate and payout address, had two `onTap: () {}` rows (an emergency SOS
> and a helpline), and its Logout navigated without ending the session. All three now render
> `GET /api/driver/home` (new, token-only: identity, durable `is_online`, operational status,
> wallet, active assignment, offer list) plus the existing lifecycle endpoints, and Logout really
> revokes. Availability is a request whose **answer** is drawn — on refusal or timeout the last
> server-confirmed state goes back on screen.
> **Backend work and three latent defects found.** The online switch wrote memory only, though
> `drivers.is_online` is a column boot hydration reads back, so Online was silently undone by a
> restart while the app still said ONLINE; it now persists through `DriverRepository.setOnlineStatus`
> and 503s if the write fails. `POST /api/driver/offers/:offerId/reject` implements the REJECTED
> state and the "drivers can ONLY update their own offers (e.g. reject/respond)" RLS policy that
> migrations 014/020 declared with no endpoint behind it — one conditional `UPDATE`, so accept
> and decline cannot both win. Offers came back as ids, distance and rank, so both offer reads
> now hydrate the job behind each offer (fare, driver earning, addresses) through one shared
> function, with `detailsAvailable: false` instead of an invented fare.
> `getActiveAssignmentForDriver` had applied its ownership filter **only when the caller's id
> resolved** — an unresolvable identity produced a query with no filter and returned whichever job
> was active, somebody else's trip — and it returned `start_otp`/`delivery_otp`, letting a partner
> read out the code the customer is meant to give; both are now refused and replaced with
> `otpRequired`. `POST /api/driver/location` skipped its ownership check whenever the job was not
> in that process's memory, so "cannot find it" meant "nothing to authorise"; it now resolves via
> PostgreSQL and refuses an unidentified trip. `DriverRepository.update` raised an unclassifiable
> error on a store failure and now raises `STORE_UNAVAILABLE`.
> **Evidence.** `backend/driver_operations_test.js` **66/0** as chain link 20, including two
> drivers racing one job with `Promise.all` (exactly one wins, loser gets 409, replay is
> `duplicate: true`), cross-driver decline/arrival/telemetry refusals, a full
> ASSIGNED→DRIVER_ARRIVED→IN_TRANSIT→COMPLETED lifecycle paying exactly `driver_earnings` **once**
> with a replayed completion moving nothing, production refusal of the fixed OTP asserted in a
> `NODE_ENV=production` child, and three closed-store child checks failing closed while the offer
> list keeps only its approved Owner-Decision-11 fallback. Five mutations each reddened their own
> guard and were reverted: memory-only availability (OPS-13/16), dropped decline ownership
> (OPS-64/65 — B really did decline A's offer), restored telemetry skip (OPS-66 answered **200**
> to a nonexistent trip), removed hydration (OPS-21 `fare:null`), re-prefilled the OTP (client
> suite 3/4 red). Full backend chain on current source: **20/20 links exit 0, zero failure
> marks, 1105 explicit totals**. `dart analyze`: no issues. `flutter test`: **60 passed**, of
> which `mobile/test/driver_login_screen_test.dart` is 4 new deterministic no-fabrication checks.
> **Not faked, recorded:** the driver app has **no GPS at all** (no location provider in
> `pubspec.yaml`, nothing in `lib/` references one — `DriverMapView` animates hard-coded
> coordinates and invented "nearby drivers", now switched off), so these screens send no
> telemetry and say so rather than posting invented positions into the real, hardened server
> pipeline; there is no driver-initiated cancellation endpoint, so the trip screen offers none;
> and `requireSupportCallerAuth` labels any non-admin/non-merchant caller `CUSTOMER`, so a
> partner's help ticket is filed under the wrong role — reported, not silently patched.
> **§10 answer:** `/driver-dashboard` is **not** obsolete — the customer home's "Driver Mode"
> button and Profile's "Switch to Driver Partner Mode" tile both link to it, so it is a live
> customer-facing surface built as a fabrication that now duplicates the real driver app.
> Consolidation is blocked on an owner choice, because the partner screens need a `DRIVER`-role
> token that a customer session does not have. Left untouched.
>
> **Merchant audited; the web consoles are clean and the Flutter restaurant app was not
> (2026-09-25, uncommitted):** first establishing what exists, since the target is NABIN
> MERCHANT (Android) + NABIN MERCHANT PORTAL (Web/Desktop). `restaurant-merchant-web` and
> `grocery-merchant-web` are two ~2,200-line Next.js consoles audited for every fabrication
> class — mock/dummy/demo data, `setTimeout` as a fake call, hardcoded prices or merchant
> identity, fake auth or logout — with **zero matches**: both are genuinely axios-backed on
> `/api/merchant/*` with real `role: 'MERCHANT'` OTP auth, and the dashboard even states that
> its "today" figure is not a calendar-day figure because the endpoint has no date filter.
> Nothing there was rewritten. The Merchant app also already exists as Flutter entrypoints —
> `main_restaurant.dart` → `restaurantRouter`, `main_grocery_merchant.dart` →
> `groceryMerchantRouter`, seven entrypoints in one package (no `apps/`+`packages/` split, so
> §7 is packaging work, not missing capability).
> **Fixed:** `restaurant_otp_screen.dart` printed **`Demo OTP: 7729`** on the merchant UI and
> its resend was `onPressed: () {}` — label removed, resend made real behind a 30s countdown
> with the timer cancelled in `dispose`; `restaurantRouter` had **no auth gate** (the console
> holding a named store's orders, menu and money was reachable cold, with no bearer token) and
> defaulted the OTP target to the invented `9876543210` — both fixed as in `driverRouter`;
> `restaurant_registration_screen.dart` prefilled **nine** fields with a complete invented
> business identity (owner "Vikram Sethi", FSSAI `1002001928491`, GSTIN `07AAGCD1294F1Z8`, bank
> `50200049281092`, IFSC `HDFC0001092`, UPI `dillidarbar@okhdfcbank`) — all emptied.
> `dart analyze` clean on all three; `flutter test` still **60/60**. No `backend/src` file was
> touched in this step, so the 20-link chain result above stands unchanged.
> **Found, not fixed (see `TASKS.md` for the full list):** the **live API-backed** restaurant
> console `restaurant_main_shell.dart` renders `'Dilli Darbar Mughlai Kitchen'` and
> `'FSSAI: 1002001928491 • Verified Partner'` inside a `const Row` on its Profile tab — so
> whichever store signs in is shown as a different business holding a licence it never filed and
> a verified status the platform never granted, plus two more dead `onPressed: () {}` controls;
> `restaurant_app_shell.dart` (the customer app's `/restaurant-dashboard`) does
> `setState(() => order['status'] = 'PREPARING')`, i.e. **local-only order state**, alongside
> `₹28,450` as earnings; **there is no merchant onboarding endpoint at all**, so the
> registration flow cannot be wired honestly without building it; **merchant has zero IDOR or
> concurrency test coverage** (one dormant file logs in as MERCHANT, and no assertion anywhere
> checks cross-tenant refusal) even though `authenticateMerchant` and `requireMerchantTenant`
> look correct on inspection; and `database.js:5867` assigns `restaurants[0]` to any verified
> phone outside production, with `/api/merchant/:id/media` taking `restaurantId` from the body
> under the same convenience gate. Real fixtures exist for the security suite: `…000201`
> `+919811223344` (950 orders) and `2699ade3-…` `+919871133479`.
>
> **Attribution hazard that voided a green run (2026-09-24):** a "29 PASSED" result was
> produced against a `:4000` listener started *before* the last two edits, because the
> restart had died with `EADDRINUSE` while the HTTP probe still returned 200 from the old
> process. The claim was declared void and everything above was re-proven through a host
> that binds-and-releases the port first, starts the server as its own child, accepts the
> run only when **that child's stdout** prints its listen line, confirms `/api/health` 200,
> and kills exactly that pid — turning "did the test answer from this code?" into a check
> that fails loudly. `npm test` itself could not be used for this: `spawnSync('npm.cmd')`
> returns exit `null` with zero bytes in this sandbox, so the chain is walked per-link
> from `package.json` instead, which also attributes any failure to a named suite.
>
> **Harness precondition, learned the hard way this session:** `test_suite.js` sets
> `PAYMENT_WEBHOOK_SECRET` / `PAYMENT_KEY_SECRET` *in its own process* and signs the
> webhook fixtures with them, so a backend already listening on `:4000` must have been
> started with the matching values (`test_webhook_secret_not_for_deployment`,
> `test_key_secret_not_for_deployment`). A server started without them fails MODULE 18
> closed — two `503 WEBHOOK_NOT_CONFIGURED` — and that cascades into
> `NOTIF-API-14/15`. That is the no-default-secret behavior working as designed, not a
> product regression; restart the server with the two variables and the chain is green.
> A second, smaller trap on the same harness: liveness is `GET /api/health` (readiness
> is `/api/ready`) — probing `/health` returns 404 and reads as an outage that does not
> exist, which is how a healthy backend got reported as down earlier today.

> **Re-baseline note (2026-09-24):** the 2026-09-22 snapshot below-left stale.
> Verified live: HEAD = `a02971e`, origin/main = `0bd03ce`, `main` is **33 commits
> ahead of `origin/main` locally and NOT pushed** (`c974fc9..HEAD` = 33 commits).
> Between 2026-09-22 and 2026-09-24 the project ran two full passes that are
> committed but were never recorded here: the **admin surface pass** (`19c2ecf`
> customer suspension enforcement, `c6fba68` KYC gates on the routes that claimed
> them, `0d577fc` customer-accounts screen, `9eca93d` suspension trail fix,
> `30489e4` permission catalogue) and the **geofencing security pass** (`635b406`
> one authority — `GeoPolicyService` — behind every geographic decision,
> `c335709` docs correction, `0bd03ce` session-reconciliation row-cap removal,
> `a02971e` bounded boot geo read + fence naming + suite self-hygiene).
>
> **Geofencing closure (2026-09-24, local only, NOT pushed):** ten owner security
> decisions were recorded 2026-09-24 in `docs/OWNER_SECURITY_DECISIONS.md` (a
> decision decides *what* to build; each implementation, migration application,
> row deletion and push still needs its own separate order). Decision 1 choice A —
> "Revoke anonymous access; service-role-only backend architecture" — is
> implemented by `supabase/migrations/029_geo_and_commerce_reads_service_role_only.sql`
> (Section A only: `geo_fences`, `surge_zones`, `pricing_configurations`,
> `platform_settings`, `promotions`, `notification_templates` — public read
> policies dropped, `REVOKE ALL FROM anon, authenticated`, `GRANT SELECT TO
> service_role`). **Applied to the local Docker PostgreSQL only**; hosted test and
> production untouched. Measured before: anon read 447 fences / 445 surge rules
> with geometry and surcharge; after: HTTP 401, code 42501, zero rows, no
> `content-range`, while `service_role` still reads all six tables and the backend
> still boots "447 geofences, 445 surge zones" — the revocation that blinds the
> process would look identical from the anon side and different from the boot
> line, which is why the boot line is part of the check. `SEC-07-KNOWN-GAP` was
> rewritten as `SEC-07` asserting the refusal, and now **fails rather than skips**
> when the anon key is missing from the environment. New
> `backend/geo_anon_access_test.js` (44 checks: six tables, four geometry columns,
> no-credential, signed-in customer token, `service_role` read, and the neighbours
> `merchants`/`advertisements` that must keep answering) joined the `npm test`
> chain. What 029 deliberately does NOT close: `is_feature_enabled` is still
> `SECURITY DEFINER` with PUBLIC execute (one boolean, proven to carry no setting
> value), and `merchants.lat/lng` + the storefront tables (Section B of the
> proposed file) remain anonymous-readable — not a decided change. Chain run
> 2026-09-24 on the live local stack, no stubs: `geo_policy_test.js` **55/0**,
> `geo_adversarial_test.js` **60/0** (with HYGIENE-01 sweeping its own probe
> fences), `geo_anon_access_test.js` **44/0** (the same harness printed 41 in an
> earlier pass; the committed tree counts 44 stably). Still open in the geo record: the
> driver-containment gate (§14 decision 1, NOT DECIDED), `zoneId`-body pricing was
> deleted but the tokenless `/api/geofence/evaluate` session question stays a
> decision, and no spatial index exists yet.

> **Re-baseline note (2026-09-21):** the 2026-09-20 snapshot below-left stale.
> Verified live: HEAD = origin/main = `b13cdb3`, reached by a fast-forward
> `9b2804c..b13cdb3` carrying 8 commits — 7 made on 2026-09-21 (backend
> PostgreSQL-authority, mobile grocery/food live data, both merchant web consoles
> plus admin/customer-web token work, docs, web lint fix, two status notes) and
> `6494b25` which was already local on 2026-09-20. Working tree is clean apart
> from the
> 11 junk root artifacts and `.kilo/agents/`. `IMPLEMENTATION_PLAN.md` was
> deleted on 2026-09-21 after review: it was 0 bytes, had never been tracked
> (`git log --all --` returns nothing), shadowed nothing, and no code reads that
> path. The authoritative Phase 16 plan remains tracked at
> `docs/PHASE_16_IMPLEMENTATION_PLAN.md` (613 lines, frozen, PLAN-ONLY).
>
> **Milestone (2026-09-21):** `e463661` gives the Grocery Merchant App its
> master-catalogue stocking screen (`/catalogue`), closing the largest functional
> gap in `grocery_merchant_app_gap.md` — a store could previously only sell what
> had been seeded into `merchant_grocery_inventory` by hand. Verified against the
> live local PostgreSQL, not just compiled.
>
> **Follow-up (2026-09-21):** `1b128e7` + `239c134` close the two gaps that
> stocking exposed — an un-stock route for a line the store added, and merchant
> recipients in the notification bus with a socket push. Both were driven against
> the live database, including the refusal path for a line that has been sold.
>
> **Milestone (2026-09-21):** `c4eded7` consumes that backend: the Grocery Merchant
> App now has a `/notifications` feed screen and a `NOTIFICATION` socket case, so a
> store's orders land on-device instead of only in the database. Verified by
> rendering the live feed (two real grocery-order notifications, `Unread • 1`, the
> Unread filter returning only the unread row); `flutter analyze --no-pub` reports
> 69 issues with 0 errors and 0 warnings, `flutter test` is 18/18.
>
> **Phase 1 of the server-driven architecture (2026-09-21, committed locally as
> `904acd2` + this commit, not pushed):** grocery checkout coupons are now server-authoritative (discount
> computed by the server, validity/caps/per-user/duplicate enforced through the
> PostgreSQL RPCs, `checkouts.discount_amount` written), and `GET /api/app/config`
> publishes a data-only config feed composed from `platform_settings`,
> `promotions` and the service-state row with ETag/304, server-time authority and
> an `APP_CONFIG_` publish namespace behind a reserved-key guard — no migration,
> no new table. Advertisements now read and write the frozen 004 `advertisements`
> table through `src/repositories/AdvertisementRepository.js` (durable CRUD, server-clock
> date window, `INVALID_PLACEMENT` and `ADVERTISEMENT_FIELD_UNSUPPORTED` rejections,
> alias map for legacy client slots), still with no migration: what the shape cannot
> store — priority, brand, creative, service scope, bid rate — is refused or reported
> as absent rather than faked, and the fabricated third-party seed campaigns are gone
> from the in-memory fallback. `backend/chaos_audit.js` is new: a LOCAL-ONLY
> resilience harness (CH-00..CH-11) with eight financial invariants (FI-00..FI-08).
> Its headline finding is CRITICAL and unfixed by design in this phase:
> `POST /api/driver/complete-trip` is not serialized, so 50 concurrent completions
> of one ₹106 trip booked 98–100 settlement postings (~₹10,400) and credited the
> driver wallet ~50× the entitlement while the job row stayed correct (the three
> runs in the local books hold 98/98/100 postings at ₹10,388/₹10,388/₹10,600,
> against exactly 2 postings / ₹298 for a healthy job). Regression state on a solo
> clean run — fresh backend carrying the suite's test webhook secret, `GLOBAL`
> surge reset to 1.0, broadcast window expired: `test_suite.js` 307 passed / 1
> failed of 308 (the one being the pre-existing `gprod_5` data gap, which also
> fails at `HEAD` where the file reported 269/11), `restart_test.js` 30/30,
> `flutter test` 18/18, `flutter analyze --no-pub` 69 issues / 0 errors / 0
> warnings. Post-chaos books reconcile: 1,996 journal headers, 0 unbalanced,
> ₹270,069.00 both sides, 0 checkout/order arithmetic mismatches, 0 negative
> wallets, 0 promotion limit violations.
>
> **Phase 2 of the server-driven architecture (2026-09-22, committed locally as
> `a0bd024` + `b4803e5`, NOT pushed):** the client is now a renderer for what Phase 1 publishes. New
> `mobile/lib/core/config/` (validated snapshot, ETag/304 conditional GET, the
> live → validated-cache → cache → bundled fallback ladder, a `StateNotifier` that
> keeps the last good answer when a refresh fails, re-read on resume) with
> `shared_preferences` as the only new dependency; `NabinPalette` is a
> `ThemeExtension` installed by `NabinTheme.light/dark`, all 7 entrypoints resolve
> through `nabinPaletteOf(ref)`, and the shared widget kit plus the customer home
> paint from it. The customer home gained `NabinRemoteBanner` (renders stored
> campaigns, renders nothing when the slot is empty, loading or failed) and
> `NabinPlatformNotice` (the operator's own pause/lockdown words and the server's
> resume time), and every service tile is gated on its `FEATURE_*` flag **and** its
> lowercase service row **and** the platform killswitch. Two real defects fixed on
> the way: `NabinTheme.on()` had an inverted contrast test that returned white on
> nearly every light fill (light published accents now carry dark ink), and the
> killswitch gate was dead code — a lockdown is published as
> `summary.platformStatus: 'EMERGENCY_LOCKDOWN'`, never as an `EMERGENCY_STOP` row.
> Verified against the local stack with no stub: publishing three colour tokens made
> the home paint `#0F4C81` as both `palette.brand` and `ColorScheme.primary`, and a
> stored `HOME_BANNER` row painted a real campaign tile that disappears when the row
> is deleted. Backend `sections.theme` is allow-listed hex only, with AC-15..AC-19
> in `test_suite.js` proving rejection and unpublish. `flutter test` 41/41,
> `flutter analyze --no-pub` 67 issues / 0 errors / 0 warnings. What is still NOT
> remote, stated plainly: 450 `AppTheme.*` references across 17 files and 278 inline
> `Color(0x…)` literals outside `core/theme`, plus fonts, logos, icons, layout and
> every new screen — those still ship in an APK.
>
> **CRITICAL trip settlement race — fixed at the database level (2026-09-22,
> committed locally as `80940c2` + `8e8a30e`, NOT pushed):** the chaos audit's CH-02 was right, and the cause was
> not a missing lock. `JobRepository.updateStatus` built its compare-and-set as
> `WHERE status IN (prior states…, newStatus)` — listing the target state means the
> 2nd…50th concurrent completion each re-match the row the 1st one just settled under
> READ COMMITTED and each settles again. `COMPLETED` is now a non-repeatable
> transition whose allowlist excludes its own target, whose zero-row update throws
> `JOB_ALREADY_SETTLED`, and whose ledger movements carry job-derived idempotency
> keys (`RIDE_SETTLEMENT:<job>:DRIVER_EARNINGS` / `:PLATFORM_COMMISSION`) that
> PostgreSQL's UNIQUE `journal_transactions.idempotency_key` refuses twice. Two more
> money defects surfaced while proving it: both movements of a settlement shared one
> random `transaction_id` (UNIQUE), so the commission insert collided with the
> earnings insert and was swallowed — no trip ever booked
> `PLATFORM_COMMISSION_REVENUE` — and the redundant second header double credited
> `DRIVER_EARNINGS_PAYABLE`. `POST /api/driver/complete-trip` now answers an
> already-`COMPLETED` trip with `409 TRIP_ALREADY_SETTLED` before the OTP gate. No
> migration was involved; every primitive needed already exists in the frozen schema.
> Verified by driving 50 concurrent completions and reading PostgreSQL directly (1
> success, 49 conflicts, 2 postings, `booked == fare`, wallet moved once) and by
> MODULE 32 (CONC-00…CONC-09) in `test_suite.js`, which asserts on the ledger rather
> than on responses and prints its diagnostics on failure. Chain: `test_suite.js`
> 329/1 (the 1 being the pre-existing `gprod_5` gap that also fails at `HEAD`),
> `restart_test.js` 33/0, `chaos_audit.js` CH-02 PASS with FI-01…FI-07 green,
> `flutter test` 41/41, `flutter analyze --no-pub` 67 issues / 0 errors / 0 warnings.
> Still open and not this fix: FI-08's 3 jobs were over-booked by the *pre-fix* chaos
> runs (cleaning them deletes financial history — a decision, not a step), and CH-08
> shows the REST `/api/driver/location` path accepting fixes the socket rejects.
> Phase 3 was not started at that point.
>
> **Phase 3 — dynamic campaigns, festival themes and assets (2026-09-22, local only,
> NOT pushed):** a campaign now has rows of its own under approved migration **027**
> (`campaigns`, `campaign_assets`, `campaign_themes`, `campaign_offers`,
> `campaign_messages`, plus `campaign_effective_status()` and `resolve_live_campaigns()`),
> so a festival is data rather than a release: **PostgreSQL's clock** decides what is
> live, `EXPIRED` is derived and never stored, an offer references a `promotions` row
> instead of copying a discount, and the anonymous REST role is refused outright (RLS
> on with no policies *and* `REVOKE ALL FROM anon, authenticated`). `CampaignRepository`
> + the `/api/admin/campaigns*` routes (permissions `campaign.*`, audit module
> `CAMPAIGNS`, `CAMPAIGN_TRANSITION_REJECTED` listing what a state may become, delete ⇒
> archive) publish a `campaigns` section on the existing `GET /api/app/config` feed, the
> admin console gained a full campaign editor, and the Customer App renders the palette,
> logo, banner and popup from that feed — no festival string is hard-coded in Dart, and
> no APK rebuild is needed to run one. Three real defects were found on the way: the
> console could not log in (`authApi.login` omitted `username`, which
> `POST /api/admin/login` requires), the new editor's service chips dropped all but the
> last one clicked in a frame (fixed with a functional state updater before the file
> landed), and `restart_test.js` left
> `global_surge_multiplier` at 1.18, which broke the next suite run's geofence assertion
> for an unrelated reason. Two behaviour choices: an offer on a switched-off coupon is
> withheld from the feed, and coupon writes invalidate it. Chain (local, solo):
> `test_suite.js` **352/1 of 353** (MODULE 33 CP-00…CP-22 green; the 1 is the
> pre-existing `gprod_5` seeding gap), `restart_test.js` **34/0**, `chaos_audit.js`
> `PASS=15 FINDING=1 BLOCKED=3 FAIL=2` with CH-02 PASS and FI-01…FI-07 green,
> `flutter test` **56/56**, `flutter analyze --no-pub` 67 issues / 0 errors / 0
> warnings. 027 exists in Git and on the local Docker database only; no hosted project
> was touched, and only `CUSTOMER_HOME` is a wired mobile surface.
>
> **Phase 4 — production readiness (2026-09-22, local only, NOT pushed):** three
> items done. **CH-08** (`c1f3d1d`): `POST /api/driver/location` range-checked only
> that two fields were present, so a fix the socket refused — latitude past the pole,
> an 1899 timestamp, 1,000,000 km/h — reached the same fleet map dispatch reads. One
> `TelemetryValidator` now backs both transports and reports the same reason on each,
> and the stored row carries the server's receive time instead of a timestamp the
> device asserts. **Auth fail-closed** (`e994e44` + `31d0d62`): an OTP login for role
> `ADMIN` resolved to `adminUsers[0]`, so any number that could finish a challenge
> became SUPER_ADMIN; PostgREST errors read as "no such row" and fell through to a
> seeded account; six `NODE_ENV !== 'production' || NABIN_TEST_MODE === 'true'` gates
> let a leftover flag reopen fixed OTPs and unauthenticated media writes; login and
> OTP dispatch whose audit row could not be written answered 200 with an unhandled
> rejection; and password login trusted the in-memory copy taken at boot, so an admin
> disabled in the database kept signing in until a restart. Identity now comes from
> enrolled `admin_accounts` rows only, unreachable-store reads/writes throw 503
> `AUTH_STORE_UNAVAILABLE`, unauditable auth events are refused and rolled back, one
> `RuntimeMode` gate keyed on `NODE_ENV` alone replaces the six, and deactivation
> closes both doors including already-issued tokens. Three `[DEBUG]` admin-login logs
> printed the account object with salt and password hash — gone. `restart_test.js`
> (`cdb63aa`) now polls `/api/health` up to 30 s instead of `sleep(3500)`-and-hope.
> **FI-08** is documented at
> [`docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md`](../docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md)
> and deliberately **not corrected**: 3 jobs that the pre-fix chaos runs over-posted
> (₹31,058.00 of driver payable, ₹57.00 of commission never recognised, books still
> balancing because the error is symmetric). Fixing that writes new financial records
> against history and needs explicit approval. Chain (local, solo, fresh backend
> carrying the suite's test webhook secret): `auth_failclosed_test.js` **15/0**,
> `test_suite.js` **366/1 of 367** (the 1 is the pre-existing `gprod_5` gap that also
> fails at `HEAD`), `restart_test.js` **35/0**, `chaos_audit.js` DB-up
> `PASS=16 FINDING=1 BLOCKED=3 NOTE=1 FAIL=1` and with `CHAOS_DB_DOWN=1`
> `PASS=4 NOTE=2` — where CH-10c/CH-10e now report auth **failing closed**
> (`send-otp 503 AUTH_AUDIT_STORE_UNAVAILABLE`, `admin login 503`, no token) instead
> of the earlier in-memory fail-open finding, and CH-10f marks itself unexercised
> rather than passing on a session that no longer exists. **Admin permission
> checks + durable credential reset:** nine administrative writes (advertisement
> create/edit/delete, master-catalogue add/edit/remove, `orders/expire-stale`,
> grocery price review, driver status) required only *an* administrator, so a KYC
> Specialist token could delete a campaign or take a driver offline; each now names
> a permission and the guard runs before the handler. `POST
> /api/admin/drivers/:id/status` was registered twice and Express dispatched the
> ungated first copy, so the `fleet.manage` check below it never ran.
> `resetAdminPassword` wrote the new hash into memory only — the next restart handed
> the old password back — and its response body carried `salt` and `passwordHash`; it
> now writes `admin_accounts`, refuses an unenrolled account (409
> `ADMIN_NOT_ENROLLED`), restores the previous credential if the audit row fails, and
> answers with a projection holding no secret. MODULE 35 (RBAC-01…12) proves the
> refusals, the non-lockout, and durability by recomputing scrypt from the
> **PostgreSQL** row. Chain after this pass (same solo conditions):
> `test_suite.js` **388/1 of 389** (the 1 is still the `gprod_5` seeding gap),
> `restart_test.js` **35/0**, `auth_failclosed_test.js` **15/0**,
> `chaos_audit.js` unchanged at `PASS=16 FINDING=1 BLOCKED=3 NOTE=1 FAIL=1`.
>
> **Phase 4 — campaign concurrency (2026-09-22, local only, NOT pushed):** the
> directive's "no lost updates or duplicate unique records" now holds at three levels.
> **Write:** `updateCampaign` names only the columns the request actually sent —
> rewriting the merged row back is what un-did another operator's edit — and every
> section is validated *before* the first write, so a refused field leaves the campaign
> byte-identical. A child section that fails after the campaign row committed is
> reported as `CAMPAIGN_PARTIALLY_APPLIED` (500) naming what did land, not as a clean
> refusal. **Guard:** `guard` is mandatory (a write that read nothing throws
> `CAMPAIGN_GUARD_REQUIRED`); the row's own `updated_at` is the revision and goes into
> the UPDATE's WHERE, so a stale edit updates zero rows and answers **412**
> `CAMPAIGN_STALE_EDIT`; a state move is guarded on the status it was offered from and
> answers **409** `CAMPAIGN_STATE_CHANGED`; an edit with no `If-Match` is refused
> **428** before anything is read; a token that is not an instant is refused **400**
> `CAMPAIGN_REVISION_INVALID` at the edge, because passing one down reached PostgreSQL's
> own `invalid input syntax for type timestamp` (22007) — an infrastructure complaint
> wearing a validation error's clothes. `*` is refused for the same reason as anywhere
> else: it lets a writer claim a revision it never read. **Uniqueness:** one code, six
> simultaneous claims → exactly one 201 and five 409 `CAMPAIGN_CODE_TAKEN`, translated
> from the 027 UNIQUE constraint by `storeRejection` so the schema's wording never
> reaches a client. Reads distinguish an unreachable store from no rows
> (`settle`/`isStoreUnreachable` → 503 `CAMPAIGNS_UNAVAILABLE`), so a banner that failed
> to load never publishes as "no banner". **CORS was the blocker the suite could not
> see:** the console's conditional write failed only in a browser, because `If-Match`
> was not in `Access-Control-Allow-Headers` and `ETag` not in
> `Access-Control-Expose-Headers` — Node and Flutter clients never preflight, so 400+
> green assertions passed over it. `test_suite.js` gained MODULE 36 CC-00…CC-17
> (18 assertions; the last two pin the preflight and the exposed validator), `request()`
> now returns
> response headers because a contract can live in one, and fixture identifiers come from
> `fixtureSuffix()` because `POST /api/admin/promotions` **upserts on `code`**: a
> colliding fixture id overwrote a 2026-09-15 coupon, inherited its redemption history
> and reset `usage_count`, which is what made PROMO-04/05/08/09 go red here. Chain
> (local, solo, fresh backend carrying the suite's test webhook secret — restarting also
> clears the process-local 15-minute broadcast window): `test_suite.js` **408 PASSED /
> 0 FAILED**, `restart_test.js` **35/0**, `auth_failclosed_test.js` **15/0**, plus the
> admin console driven in a browser through create → stale-save refusal → reload →
> re-apply → archive, with the rival's write intact at every step.

---

## 1. GIT STATE

| Field | Value |
|-------|-------|
| **Current HEAD** | the 2026-09-24 geofencing-closure commits, on top of `a02971e` (bounded boot geo read, fence naming, suite self-hygiene), `0bd03ce` (session reconciliation row cap), `c335709` (geo docs correction), `635b406` (one geo authority — `GeoPolicyService`), `30489e4` (permission catalogue), `9eca93d` (suspension trail), `0d577fc` (customer accounts screen), `c6fba68` (KYC gates), `19c2ecf` (suspension reaches the door) — which sit on the Phase 4 chain `ea4c146`, `a551dd6`, `31d0d62`, `cdb63aa`, `e994e44`, `c1f3d1d`, on the Phase 3 chain `97fb57f`…`a85ca6d`, on the Phase 2 chain `9da93cd`, `b4803e5`, `8e8a30e`, `80940c2`, `a0bd024` and on `d628d0c`, `5824f36`, `f759dd3`, `46ab58a`, `904acd2` |
| **origin/main** | `0bd03ce` |
| **HEAD == origin/main** | NO — `main` is **33 commits ahead locally and NOT pushed** (`c974fc9..HEAD`) |
| **Branch** | main |

### Untracked files of record (re-verified 2026-09-24, `git status --porcelain`)

- `.kilo/agents/` — never commit (standing rule). `.kilo/` also holds two
  **registered git worktrees** (`bejewled-august`, `shiny-oboe`), so the folder
  cannot simply be deleted — that needs `git worktree remove` first.
- The 2026-09-24 geofencing-closure batch (migration 029, `geo_anon_access_test.js`,
  the `SEC-07` rewrite in `geo_adversarial_test.js`, the `npm test` chain update,
  the owner decision documents and the updated `GEOFENCING_SECURITY_AUDIT.md`) is
  being committed with this re-baseline; after it, only `.kilo/agents/` remains
  untracked.
- Everything else that used to litter the root is gone as of 2026-09-22: the 11
  mangled/pasted files and `mcp_out.txt`/`readme.txt` were **moved** to
  `C:/Users/macmi/Documents/nabin-quarantine-2026-09-21/` (with `MANIFEST.json`),
  not deleted, and `.git_diff_full.txt`, `.git_diff_stat.txt`, `.git_status.txt`
  and `mobile/p10_mobile.txt` were removed from Git in this commit.
- `scratch/` (live probes, manifests and the rice fixture backup) and
  `backend/data/` (the JSON store path `persistentStore.js` creates on demand) are
  gitignored at `.gitignore:31-32`, so they never appear here
- The 2026-09-20 list — `nabin_repository_inventory.md`,
  `nabin_234_implementation_gap.md`, `admin-web/src/components/AdminLayout.tsx`,
  `customer-web/src/components/`, `mobile/.../driver_job_offer_card.dart` — is now
  committed (docs in `19c9041`, web in `7c1fe53`, mobile in `c35306d`)

### Recent Git History
```
<new geofencing-closure commits, 2026-09-24>
a02971e fix(geo): bound what boot may believe, name a fence by a column that can hold it, and make the suites reap their boundaries
0bd03ce fix(auth): remove session reconciliation row cap
c335709 docs(geo): withdraw an attribution the next pass disproved, and record what was measured instead
635b406 feat(geo): put every geographic decision behind one authority, and make a silent store a loud one
30489e4 docs(admin): write the permission catalogue, and finish the two sweeps it found unfinished
9eca93d fix(admin): give a half-landed suspension its trail, and check what three lines claim
0d577fc feat(admin-web): give customer accounts a screen, and hide the actions its caller cannot take
c6fba68 feat(backend): put the KYC gates on the routes that claim them, and describe a fleet status change honestly
19c2ecf feat(backend): make a customer suspension reach the door, and prove it
ea4c146 fix(backend): make a campaign edit carry the revision it is based on
69202df docs: record the permission-check pass and the master-catalogue gap it found
a551dd6 fix(backend): put a permission check in front of every admin write
97578c4 docs: record the Phase 4 auth and telemetry work, and the FI-08 evidence
31d0d62 fix(backend): stop password login and admin provisioning trusting memory
cdb63aa test(backend): ask a cold-started backend whether it is up instead of guessing
e994e44 fix(backend): make authentication fail closed instead of falling back to fixtures
c1f3d1d fix(backend): validate driver telemetry once, for both transports
97fb57f docs: record Phase 3 — campaigns, the 027 approval, and the chain as run
2b0c55b feat(mobile): paint the campaign the server says is live
7a882e1 feat(admin-web): let an operator author a festival without a developer
eb492c5 fix(admin-web): send the username that POST /api/admin/login requires
77dd9d6 test(backend): stop the restart run from stranding a 1.18 global surge
daf82cf test(backend): pin the campaign lifecycle to the server clock in MODULE 33
2697038 feat(backend): publish campaigns through the admin API and the config section
a85ca6d feat(backend): give a campaign its own rows and let the database clock rule it
9da93cd docs: record the exactly-once settlement fix and the Phase 2 render pass
f759dd3 feat(backend): serve advertisement campaigns from PostgreSQL within the frozen schema
46ab58a test(backend): add a local-only chaos and resilience audit, and record its findings
904acd2 feat(backend): make checkout coupons server-authoritative and add a data-only app config feed
c4eded7 feat(mobile): give the grocery merchant app a notifications feed
d1381dc docs: record the rice fixture deactivation and the browse is_active fix
dc11941 fix(backend): make a retired grocery master product disappear from customer browse
9f0b4e9 docs: record the un-stock route and merchant notification pass
239c134 feat(mobile): give the grocery inventory screen a remove action
1b128e7 feat(backend): let a grocery store un-stock a line and receive its own notifications
51ad0ea docs: record the master-catalogue stocking milestone
e463661 feat(mobile): let grocery merchants stock products from the NABIN master catalogue
55a1836 chore(records): delete empty IMPLEMENTATION_PLAN.md and re-baseline git state
b13cdb3 docs: mark session memory as pushed
a03a28c docs: record the pushed commit range
dac61ec fix(web): clear the react-hooks lint errors in the merchant consoles
19c9041 docs: record the PG-authoritative pass, gap audits and corrected git/supabase state
7c1fe53 feat(web): add merchant consoles and bring the web apps onto shared tokens
c35306d feat(mobile): wire grocery and food browsing to live data with real checkout
e7a7d31 feat(backend): make customer browse and grocery checkout PostgreSQL-authoritative
6494b25 fix(mobile): resolve Flutter analyzer errors
9b2804c docs(stitch): add design freeze reports and handover artifacts for 234-screen canonical set
1d404a6 Revert "feat(database): add migration 017 for menu modifiers, tax configs, and tax invoicing with composite tenant constraints"
4c3ba35 feat(database): add migration 017 for menu modifiers, tax configs, and tax invoicing with composite tenant constraints
66c0718 chore(recovery): revert unauthorized Phase 18 commits to restore authorized baseline 8eb4f662
d62963f test(phase18): expand test suite to 295 passing tests with full kds and tax invoice verification
0842574 feat(api): implement food checkout, kds transitions, modifier crud, and tax invoice endpoints
8f0e9c4 feat(menu-kds-tax): implement tax calculation service, menu repository, and invoice repository
faa777f feat(database): add migration 017 for menu customization, kds workflow, and tax invoicing
8eb4f66 feat(notifications): wire lifecycle events to notification engine
c2e42ad feat(notifications): add notification REST APIs
4e57620 feat(notifications): add push provider abstraction and event bus
6bb6c17 feat(notifications): add PostgreSQL notification repository
7591f01 docs(governance): codify permanent Git safety and loss-prevention protocol in AGENTS.md
c0cdf47 feat(phase-16): implement PostgreSQL-authoritative driver KYC, verified VPA payout, refund idempotency, and atomic cancellation
409e2e9 chore(governance): restore codebase to approved baseline 8eb4f21 preserving forensic audit records
d7ef7f5 feat(phase-16): implement postgres kyc, verified vpa, partial refund and atomic cancellation
8e18c21 feat: bridge geofences and pricing to postgres persistence
```

---

## 2. APPROVED BASELINE

| Item | Value |
|------|-------|
| **Approved Git Baseline** | `8eb4f662...` (notifications phase) |
| **Phase 16 Authorized Baseline** | `8e18c216...` (Phase 14: geofences and pricing) |
| **Migration Baseline** | 001–015 approved |
| **Migration 016** | EXISTS and IS IN AUTHORIZED GIT BASELINE via commit c0cdf47; formal user approval workflow not yet documented |
| **Migration 017** | ABSENT — deleted by revert commits 66c0718 and 1d404a6; NOT approved for future implementation |

**Note**: User-stated current approved baseline is `8eb4f662`. Actual repository HEAD is `1d404a6` (revert of Phase 18). The repo has been restored past Phase 16 to baseline `8eb4f66`, then proceeded with Phase 18 (`4c3ba35`) which was reverted via `1d404a6`.

**Note on Migration 016**: Migration 016 is present in `supabase/migrations/` and is part of the authorized Git baseline through commit `c0cdf47`. However, a formal user approval record documenting explicit authorization is not present in the repository. Governance distinguishes between "authorized Git baseline" and "formal approval record" (see DEC-017 in DECISIONS.md).

---

## 3. DATABASE STATE

### Migrations
| Migration | Status | Notes |
|-----------|--------|-------|
| 001–015 | APPROVED / FROZEN | Baseline migrations, do not modify |
| 016 | AUTHORIZED IN GIT / FORMAL APPROVAL PENDING | Present at `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` only; added in authorized commit c0cdf47; does not exist in `backend/migrations/` |
| 017 | ABSENT / REVERTED | Deleted by revert commits 66c0718 and 1d404a6; does not exist in working tree or Git index; NOT approved for future implementation |
| 018–026 | APPROVED / FROZEN | `018` order state lines + checkout link, `019` atomic order creation, `020` dispatch security, `021` cross-domain hardening, `022` notifications/support/dispute security, `023` ledger security, `024` application-surface security, `025` feature control system, `026` backend session persistence. Do not modify. |
| 027 | OWNER-APPROVED ("Option A") / LOCAL ONLY | `supabase/migrations/027_dynamic_campaigns_and_themes.sql` — campaigns, assets, themes, offers, messages, `campaign_effective_status()`, `resolve_live_campaigns()`, RLS-on-with-no-policies plus `REVOKE ALL` from client roles. Applied to the **local Docker PostgreSQL only**; never pushed to a hosted project |
| 029 | OWNER DECIDED (Decision 1 choice A, 2026-09-24) / LOCAL ONLY | `supabase/migrations/029_geo_and_commerce_reads_service_role_only.sql` — Section A six tables (`geo_fences`, `surge_zones`, `pricing_configurations`, `platform_settings`, `promotions`, `notification_templates`): public read policies dropped, `REVOKE ALL FROM anon, authenticated`, `GRANT SELECT TO service_role`. Applied to the **local Docker PostgreSQL only** on 2026-09-24; hosted test/production each need their own approval. Section B (storefront: merchants, products, merchant_grocery_inventory, master_grocery_catalog, advertisements) deliberately NOT included |

### Authoritative PostgreSQL Persistence
- Migrations 001–015 establish: `users`, `drivers`, `jobs`, `payments`, `ledger_accounts`, `journal_transactions`, `journal_lines`, `geo_fences`, `surge_zones`, `promotions`, `support_tickets`, `audit_logs`, `notifications`, `checkouts`, `dispatch_offers`, `merchants`, `products`, `grocery_catalog`, etc.
- Migration 016 adds: `verified_upi_id`, `payout_upi_verified`, `kyc_status`, `user_id` on `drivers` table (present in authorized Git baseline via c0cdf47)
- Migration 017 is absent; menu customization, kitchen workflow, tax configs are NOT in current schema
- Migration 027 adds five campaign tables (`campaigns`, `campaign_assets`, `campaign_themes`, `campaign_offers`, `campaign_messages`) and two SQL functions; `campaign_offers.promotion_id` is `ON DELETE RESTRICT`, so a campaign never owns or destroys the coupon it advertises

### Local data changes made this session (2026-09-21/22, local Docker only)
- `master_grocery_catalog`: 11 duplicate "Test Basmati Rice" rows set to `is_active = false` with the
  owner's approval; `6e617e3a-e377-4d7b-ae2c-0e8de0208a77` left active because `Test Supermarket M2`
  sells it. No row was deleted — `order_lines` is `ON DELETE RESTRICT` and orders are immutable.
  Previous ids/flags: `scratch/rice_master_backup_2026-09-21.txt` (gitignored).
- 4 grocery orders were placed against the local database to prove the notification and un-stock
  paths (`ORD-00000318`, `ORD-00000319` and the earlier pair); they are permanent records by design.
- A stocking/un-stocking round trip ran through `POST`/`DELETE /api/merchant/inventory` only, and
  the test listing was removed, so `Test Supermarket M2` is back to its single seeded row.
- Campaign rows: 11 exist and **all are `ARCHIVED`**, so nothing is live for any client — the 5
  probe/UI rows from the browser pass (`XMAS_PROBE_*`, `XMAS-LIVE*`, `XMAS-UI-2026`) and 6 rows
  written by `MODULE 33` across three suite runs (`CP_FEST_*`, `CP_RIVAL_*`). They are archived
  rather than deleted because archive is the lifecycle under test and the tables keep history.
  13 of 412 `promotions` rows are test coupons from these runs. `pricing_configurations`
  `GLOBAL.global_surge_multiplier` was left at `1.00` (the value `restart_test.js` used to
  strand at `1.18`; it now restores it).

### Remote Supabase
- OFF LIMITS
- No `supabase link`, `supabase db push`, or `supabase db reset` executed
- All database operations confined to local Docker instance

---

## 4. APPLICATION STATE

### Backend (Node.js + Express)
| Component | Status |
|-----------|--------|
| `backend/src/server.js` | REST + WebSocket API |
| `backend/src/database.js` | In-memory + PostgreSQL bridge |
| Repositories | User, Driver, Job, Ledger, Payment (Phase 13+), Promotion, SchoolChild, Advertisement, **Campaign** (`repositories/CampaignRepository.js`, 685 lines — Phase 3, then given touched-column writes, a mandatory revision guard and store-rejection translation in Phase 4) |
| Server-driven config | `services/AppConfigService.js` composes `GET /api/app/config` sections: `services, features, offers, settings, theme, campaigns, advertisements`, 30s cache, invalidated by ad/campaign/settings/**coupon** writes; ETag/304 on the feed, `ETag` exposed to browsers |
| Campaign writes | Conditional: `PUT /api/admin/campaigns/:idOrCode` requires `If-Match` with the revision the reader was given (428 without it, 400 if it is not an instant, 412 if the row moved, 409 if the state moved, 409 `CAMPAIGN_CODE_TAKEN` on a duplicate code, 503 on an unreachable store) |
| Test Suite | **444 passed / 0 failed of 444** (2026-09-24, uncommitted) — MODULE 38 MC-01…07 proves `/api/admin/master-catalog` is read-through/write-through to PostgreSQL with a durable `is_active=false` soft delete, and that the legacy memory handle `mp_101` now 404s instead of editing a phantom; MODULE 39 CORS-01…05 proves the preflight grants the canonical `Idempotency-Key`, keeps every previously allowed header, still refuses one the API does not take, grants it on a second idempotent route, and still blocks an unknown origin; MODULE 40 PL-00…PL-10 + PL-TEARDOWN proves the coupon list is a real page — search total, one-row page, `hasMore`, offset paging without repeats or skips, empty page past the end, underscore-wildcard handling, syntax-character sanitization, clamped `limit`/`offset` — and reaps its own fixtures. (Prior baselines: 408 with MODULE 36 campaign concurrency, 427 after MODULE 38) |
| Cold Restart Tests | **40 passed / 0 failed** (adds a master-catalogue product created and revised before the cold start, read back from PostgreSQL afterwards, then durably soft-deleted; still restores `global_surge_multiplier` to 1.0) |
| Auth fail-closed | `backend/auth_failclosed_test.js` **15 passed / 0 failed** (AUTH-00…06, 10…17) |
| Checkout store-semantics | `backend/checkout_store_semantics_test.js` **5 passed / 0 failed** (CHK-01…05, uncommitted outage sweep) — with the store unreachable each order resolver now throws a `503` `isStoreUnreachable()` recognises (merchant lookup, restaurant menu, store inventory) instead of a `MERCHANT_NOT_FOUND`/`PRODUCT_NOT_FOUND`/`INVENTORY_NOT_FOUND` 4xx that blamed the customer for the platform's outage; with the store live a genuine miss is still `null` / a business 4xx and never a false 503. Red-green proven: with `OrderRepository.js` stashed to `HEAD`, CHK-01/02/03 fail (404/undefined) and the two live-miss controls still pass |
| Hydration-read fallback | `backend/hydration_fallback_test.js` **8 passed / 0 failed** (HYD-01…08, Owner Decision 11 / choice B) — money/identity hydration reads (`getPaymentSession`, user/driver `findByIdAsync`/`findByPhoneAsync`) keep answering from hydrated memory when the store is unreachable and never become a false 503, while a genuine not-found is still a `null`/miss against the live store. Sensitivity-checked: temporarily converting `getPaymentSession` to a fail-closed 503 makes HYD-01/02 FAIL, then reverting restores green |
| Campaign outage branch | `backend/campaign_outage_test.js` **5 passed / 0 failed** (CAMP-01…05) — the `CAMPAIGNS_UNAVAILABLE` → 503 guard in `CampaignRepository.settle()` is now proven by assertion, not by code-reading: store unreachable ⇒ `listCampaigns`/`getCampaign`/`liveCampaigns` all throw `CAMPAIGNS_UNAVAILABLE` with `status=503` (never an empty list dressed as "no campaigns"), and PostgreSQL-not-configured ⇒ both reads return `null`, which the route maps to 503. Sensitivity-checked: swallowing the store rejection reddens CAMP-01/02/03 and leaves the two not-live controls green |
| Coupon list paging | `GET /api/admin/promotions` is a real page: `limit` (default 50, clamped 1…100), `offset` ≥0, `search`/`q` over code/name/description, ordering `created_at desc, id desc`, and an answer of `{promotions, total, limit, offset, hasMore}` where `total` counts the filtered set. A range past the last row is answered as an empty page — PostgreSQL returns `416 Requested range not satisfiable` for one, so the count is established by a head request first and the range clamped. Search terms lose `,` `(` `)` `|` `%` `*` (PostgREST filter syntax) and an all-syntax term answers zero rows; `_` is kept so `SAVE40_ABC` stays findable. The memory fallback mirrors it. Proven by `test_suite.js` MODULE 40 |
| CORS header policy | `allowedHeaders` carries `Idempotency-Key` beside `X-Idempotency-Key`, because six routes read the canonical spelling first and the ledger/dispatch procedures deduplicate on it. Proven by `test_suite.js` MODULE 39, which also asserts the list is a policy (an unrelated header is refused) and that origins did not widen |
| Phase 7 security audit | `backend/test_phase7_security.js` **45 passed / 0 failed** (MODULE 1…9: admin password-reset boundaries and backdoor auto-provisioning, driver-earnings privacy, ride ownership/cancellation/idempotent replay, KYC and media-asset authorization, live RLS + `search_path` + `anon` grant catalog, production OTP never returning `testOtp`, cancellation race). It asserted nothing anywhere the project runs — not in `npm test`, not in CI — so it is now the **twelfth link of the chain**, with `npm run test:security` for solo use. Load-bearing proof: temporarily disabling the media-asset ownership guard in `server.js` reddens exactly that assertion (**44/1, exit 1**), guard then restored. Its reset writes the Super Admin credential back to the value every suite logs in with, so two consecutive full chains were run to prove neutrality: both **exit 0, 0 failures** |
| Admin surface suites | Five `backend/admin_*_test.js` suites — identity gates **64/64**, authorisation matrix **113/0** (permission-per-route, session revocation, lockout shape, the CAT-04 ungated-route ratchet at ceiling 17), customers **83/83**, settings surface **31/0** (refuses a secret-shaped value), audit fail-closed **79/0** (in-process, store replaced) — all green and now links 13–17 of `npm test`, also runnable together via `npm run test:admin` |
| Chaos / resilience | `chaos_audit.js` → `PASS=15 FINDING=1 BLOCKED=3 FAIL=2 NOTE=1`; CH-02 settlement race PASS; FI-01…FI-07 green; CH-08 and FI-08 open and owned |
| Customer activity feed | `GET /api/customer/activity` (uncommitted) — bearer-token identity only, RIDE+PARCEL from `jobs`, FOOD+INSTAMART from `orders`, newest first, 503 on an unreachable store. `backend/customer_activity_test.js` **20 passed / 0 failed** (ACT-01…20) as the eighteenth link of `npm test`: unauthenticated 401, every row exists in PostgreSQL, every returned row's `customer_id` equals the caller (verified with `.in(...)`, immune to the 1000-row page cap), no delivery-leg job doubles an order, amounts match the DB to the paisa, the newest ride and newest order both appear, and two customers' feeds are disjoint. Red-green proven on the ownership filter (ACT-08/19 fail, exit 1) |
| Chain totals | **1157 checks, 0 failures, exit 0** across eighteen links (re-measured 2026-09-24: 444 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 + 8 + 5 + 45 + 64 + 113 + 83 + 31 + 79 + 20) |

### Flutter Mobile Apps
| App | Status |
|-----|--------|
| Customer App | Flutter 3.47, Stitch design system; reads the config feed's `campaigns` section for palette, festival logo, banner slot and gated popup (`core/widgets/nabin_campaign.dart`) — no festival content hard-coded. `main.dart` boots `NabinCustomerSuperApp` on one GoRouter (`core/router/app_router.dart`) carrying Ride, Food, Grocery/Instamart, Parcel, wallet, activity, profile and support behind a single auth chain — the unified app the spec asks for already exists; `main_grocery.dart` / `main_restaurant.dart` are separate entrypoints, not separate customer products. Activity tab is now a real `GET /api/customer/activity` feed with an Instamart filter (uncommitted) |
| Driver App | Flutter, GPS telemetry, dispatch |
| Merchant App | Flutter, restaurant/grocery operations |
| Widget Tests | 56/56 passing (2026-09-22) |
| Static Analysis | 67 issues, **all `info`** (0 errors / 0 warnings); none in a campaign or config file |

### Admin Web
- Next.js app-router console (HTML/Tailwind/Leaflet dashboard alongside it)
- Live analytics, KYC queue, dispatch tracking, zone editors, advertisements, and a
  **campaign editor** (`app/campaigns/page.tsx`, `components/CampaignEditor.tsx`,
  `lib/campaigns.ts`): window, priority, service targeting, theme tokens, logo/banner
  asset rows, coupon-referenced offers picked from the live coupon list, announcements
  and popups, publish/pause/archive through the status route only
- Fixed 2026-09-22: the console could not log in at all — `authApi.login` omitted
  `username`, which `POST /api/admin/login` requires
- Saves are conditional since `ea4c146`: `adminApi.updateCampaign(idOrCode, body,
  revision)` sends the `updatedAt` the editor loaded as `If-Match`, and a refused edit
  shows the server's own words ("This campaign was edited after you loaded it …"), so a
  second console's save cannot be quietly overwritten. Verified in a browser, including
  the reload-and-re-apply path. `npm run lint` 0 errors and a production build pass

---

## 5. PHASE STATE

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1–9 | COMPLETE | Persistence bridges for users, drivers, jobs, wallets, payments, geofences, surge, promotions, support, audit, notifications |
| Phase 10–12 | COMPLETE | Identity/KYC audit, domain readiness, payments/payouts/booking security |
| Phase 13 | COMPLETE | Security hardening, 288/288 tests passing |
| Phase 14 | COMPLETE | Financial integrity audit |
| Phase 15 | COMPLETE | Authorization payout cancellation audit |
| Phase 16 | REJECTED | Unauthorized implementation; forensic audit completed; restoration committed |
| Phase 17 | DOES NOT EXIST | No approved plan |
| Phase 18 | REJECTED | Unauthorized implementation; reverted via `1d404a6` |
| Server-driven Phase 1 | COMPLETE (local, unpushed) | Advertisements on PostgreSQL, server-authoritative checkout coupons, `GET /api/app/config`, local chaos audit |
| Server-driven Phase 2 | COMPLETE (local, unpushed) | Client render pass (remote-config layer + cache + server-time authority, theme/offers/features sections, banner and feature gating in Flutter) and the CRITICAL trip settlement race fixed at database level with a 50-way ledger-asserting regression (MODULE 32) |
| Server-driven Phase 3 | COMPLETE (local, unpushed) | Dynamic campaigns / festival themes / assets on migration 027: PostgreSQL clock resolves what is live, admin campaign editor, `campaigns` section on the config feed, Customer App renders theme + logo + banner + popup with no rebuild. **Limits:** `CUSTOMER_HOME` is the only wired surface, assets are pasted URLs (no in-admin upload), 027 is not applied to any hosted project |
| Server-driven Phase 4 | IN PROGRESS (local, unpushed) | Done: telemetry validated once for both transports (`c1f3d1d`), authentication fails closed on an unreachable store (`e994e44`, `31d0d62`), a permission check in front of every admin write with a durable credential reset (`a551dd6`), campaign concurrency — touched-columns writes, mandatory revision guard (428/412/409/400), UNIQUE code answered as 409, outage as 503, `CAMPAIGN_PARTIALLY_APPLIED` naming what landed, and the CORS headers the conditional write needs (`ea4c146`) — **the admin surface pass** (`19c2ecf`…`30489e4`: suspension enforcement, KYC gates, customer-accounts screen, permission catalogue) and **the geofencing security pass** (`635b406`…`a02971e` + the 2026-09-24 closure commits: one `GeoPolicyService` authority, zoneId-body pricing deleted, bounded boot geo read, suite self-hygiene, Owner Decision 1 implemented as migration 029 — anon/authenticated reads of the six Section-A tables revoked on the local store). FI-08 documented, not corrected (`97578c4`). **Admin master-catalogue persistence** (2026-09-24, uncommitted checkpoint): the five memory-only `masterProducts` methods now read-through/write-through the migration-001 `master_grocery_catalog` table with the fixtures kept only as the dev fallback, a legacy-id resolver, and a durable `is_active=false` soft delete (a hard delete would cascade into merchant stock). Open: the "Still open in this phase" list in `TASKS.md` — driver/merchant campaign surfaces, the campaign asset decision, mobile offline matrix, env isolation + secret scan, financial re-verification, the public-website decision, the Phase 4 verification chain A–O, and the owner decisions from `docs/OWNER_SECURITY_DECISIONS.md` (each awaits its own implementation order). Closed since that list was written (2026-09-24, uncommitted): **the codebase-wide 5xx/4xx sweep** — the three checkout resolvers answer 503 when PostgreSQL cannot (`checkout_store_semantics_test.js` 5/0), the six money/identity hydration reads keep the memory fallback the owner accepted as Decision 11 / choice B (`hydration_fallback_test.js` 8/0), and the campaign 503 guard is proven by assertion (`campaign_outage_test.js` 5/0); and **browser/console reachability** — CORS allows the canonical `Idempotency-Key` that six routes read before the `X-` spelling (MODULE 39), and the admin coupon list is a real page with a search and a filtered total (MODULE 40). Full chain green: 722 checks, 0 failures, exit 0 at that point; `test_phase7_security.js` (45) and the five `admin_*_test.js` suites (370) were then armed as links 13–17, and two consecutive seventeen-link chains came back **1137 checks, 0 failures, exit 0** each. Two Phase 4 items are deliberately NOT auto-implemented: the promotion upsert-on-code `usage_count` reset and the audit-write semantics (36 `createAuditLog` call sites, 7 awaited, re-counted 2026-09-24). Since that count was taken, **the customer Activity screen was rebuilt on real data** (2026-09-24, uncommitted): `GET /api/customer/activity` + `JobRepository.getJobsByCustomer` (bearer-token identity, jobs/orders split to avoid double-counting, fail-closed 503) and `customer_activity_test.js` as link 18 — chain re-measured at **1157 checks / 0 failures / exit 0**, red-green proven on the ownership filter, `dart analyze` clean on both touched Dart paths. |

---

## 6. KNOWN ISSUES

### Open from Phase 16 Forensic
1. **Hardcoded mock KYC** — `backend/src/database.js:440` seeds `kycStatus: 'VERIFIED'` for DRV-104 test fixture

### Open from Phase 13/14/15
2. ~~**Mobile UI unwired** — Most mobile screens use local state rather than live API
   calls~~ — **overstated; re-measured 2026-09-24.** Across the 90 `.dart` files under
   `mobile/lib/features/` a case-sensitive scan finds **zero** `TODO`, `FIXME`, `mock`,
   `dummy`, `fake` or `hardcoded` markers (the 43 case-insensitive `TODO` hits are all
   `toDouble()`/`roundToDouble()`), and 37 of the 90 files make real API calls. The
   claim that survives measurement is narrower and real: individual screens render
   invented data. One is **fixed** in this tree — the customer Activity screen (see the
   activity-feed paragraph above). The rest are **open**, and the driver app is not one
   screen but the whole of it: `mobile/lib/features/driver/` contains exactly two files
   (`presentation/screens/driver_app_shell.dart`, `presentation/widgets/driver_job_offer_card.dart`)
   and **neither references `NabinApiService` at all**, while the four driver calls the
   API client does expose (`toggleDriverOnline`, `acceptJob`, `verifyTripOtp`,
   `getDriverEarnings`) are invoked from nowhere in `lib/`. In `driver_app_shell.dart`
   the wallet starts at a hard-coded `1420.0` (L31-32), trip completion adds a locally
   computed `fare - (fare * 0.1)` to it (L133-141) with a fabricated `?? 85.0` fallback
   fare, the OTP field is pre-filled with `'7729'`/`'4892'` (L113, L122-124), and
   "withdraw" sets the displayed balance to `0` in `setState` (L836-837). None of that
   reaches the server: settlement, commission and wallet balances are PostgreSQL
   authorities (`POST /api/driver/complete-trip` writes the ledger), so the driver app
   currently shows a driver money that does not exist. Not papered over here — this is
   recorded as the next P0-adjacent slice, not silently rewritten.
3. **34 of 38 PostgreSQL tables unused** — Backend predominantly uses in-memory arrays
4. **Migration 016 formal approval workflow** — Present in authorized Git baseline via c0cdf47; explicit user approval record not yet documented (see DEC-017)
5. **Migration 017** — Absent; NOT approved for future implementation

### Open from the server-driven phases (2026-09-21/22)
6. ~~**`gprod_5` seeding gap**~~ — **closed in `ea4c146`.** The revalidate fixture asked
   for a chip packet PostgreSQL has never stocked (only two products exist locally); it
   now uses those two and additionally asserts per-line availability, server/client price
   agreement and the ₹172 estimated total. The suite has no standing failure.
7. ~~**CH-08**~~ — **closed in `c1f3d1d`** (one `TelemetryValidator` behind REST and the
   socket, server receive time stored); see item 7 of §6 in `TASKS.md`.
8. **FI-08** — 3 jobs (`JOB-92412647-611`, `JOB-92768166-552`, `JOB-93587159-696`) carry
   over-entitlement bookings written by **pre-fix** chaos runs. The owner's decision is
   "leave it, report it", so the check stays red as evidence.
9. **Campaign reach** — only `CUSTOMER_HOME` renders a campaign on mobile; driver/merchant
   apps and other `surface` values store and publish but render nothing, and a campaign
   asset is a pasted URL (no in-admin Cloudinary picker).
10. **Nothing newer than `0bd03ce` is pushed** (`main` is 33 ahead locally) and
    `027`/`029` are applied to the local Docker database only; running either against
    a hosted project needs explicit approval. The anon/authenticated read of the six
    Section-A tables is **closed** by migration 029 (Owner Decision 1A, 2026-09-24);
    what that revocation deliberately left open: `is_feature_enabled` is still
    `SECURITY DEFINER` with PUBLIC execute (one boolean, no setting value — proven by
    `RPC-BOOLEAN-ONLY`/`RPC-NO-SETTING-VALUE`), and the Section-B storefront tables
    (`merchants.lat/lng` included) remain anonymous-readable because that half was
    never an owner decision.
11. **`POST /api/admin/promotions` upserts on `code`** — re-issuing a code resets
    `usage_count` and inherits the old row's redemption history, so a spent limited-use
    voucher comes back to life. Fixing it to refuse conflicts with `test_suite.js:270`,
    which re-creates fixed code `FESTIVAL30` every run and asserts 200 — reported, not
    chosen for, because which of the two is the requirement is the owner's call.
12. ~~**`GET /api/admin/promotions` caps at 50 rows with no total and no search**~~ —
    **closed 2026-09-24, uncommitted:** the route is a real page with a search, a filtered
    `total` and `hasMore`; `test_suite.js` MODULE 40 locks it and reaps its fixtures.
13. ~~**The campaign outage branch (503 `CAMPAIGNS_UNAVAILABLE`) has no test**~~ — **closed
    2026-09-24, uncommitted:** `backend/campaign_outage_test.js` drives the repository from
    a child process pointed at a closed port, so the 503 branch is proven by assertion.
14. ~~**`Idempotency-Key` is not CORS-allowed** (only `X-Idempotency-Key` is)~~ — **closed
    2026-09-24, uncommitted:** the canonical spelling is allowed and MODULE 39 asserts the
    grant, the unchanged origin policy and that the list is still a policy.
15. **Local fixture rows accumulate with no reaper** — 539 promotions, 45 campaigns, 13
    orphan "Test Basmati Rice" catalogue rows. Hygiene only; nothing financial is deleted
    by a test run unasked.
16. ~~**`test_phase7_security.js` is red (36/9)**, partly against a route that no longer
    exists~~ — **note was stale; closed 2026-09-24.** The suite is **45/0 green** with the
    file unmodified, and it contains no `/api/ride/book` probe (both bookings use the live
    `/api/customer/book-ride`). The real gap was that nothing ran it: it is now the twelfth
    link of `npm test` (with `npm run test:security`), proven load-bearing — disabling the
    media-asset ownership guard reddens exactly that assertion (44/1, exit 1) — and proven
    state-neutral across two consecutive full-chain runs.
17. **`backend/bootstrap_test.js` is the only unqualified table wipe in the repo and is
    NOT in the `npm test` chain — by design, not by oversight.** It deletes
    `backend/data/store.json` (L42-43) and then
    `.from('admin_accounts').delete().neq('id','00000000-…')` (L48) — every admin account,
    no fixture scoping, no `id LIKE 'authz_%'` guard like the other suites use — before
    spawning its own detached server on `:4000` with `ADMIN_BOOTSTRAP_SECRET:
    'test-secret'` and killing it in a `finally` (L132), which is how the shared harness
    got left down once already. A grep for
    `delete\(\)\.neq|delete\(\)\.not|\.delete\(\)\s*[;,\)]` across `backend/*.js` returns
    exactly this one hit, so the exclusion is evidence, not caution. It must not be
    chained (chain-hostile port + a wipe that never restores what it took), and must not
    be run while `.env` can reach a hosted project, where it would delete that project's
    administrators. Left as an owner decision; not disarmed, not wired.
18. **The local store is full of operations that never finish.** Reading the fixture
    customer's feed for the activity test measured **81 of its 100 newest rows in a
    non-terminal state** (the figure moves a few either way between runs because suites
    create and settle rows; it was 85 earlier the same day). Read straight from
    PostgreSQL with `pg` just now: `jobs` — SEARCHING 1158, COMPLETED 860, CANCELLED 470,
    ASSIGNED 72; `orders` — RECEIVED 1314, CANCELLED 35, REJECTED 34, READY_FOR_PICKUP 33,
    ACCEPTED 1. Ownership is concentrated almost entirely on one fixture —
    `00000000-0000-0000-0000-000000000002` owns 2513 of the 2560 jobs, the next customer
    29 — so the shape is seeding plus a missing lifecycle rule, not an endpoint defect.
    Abandoned
    searches and received-but-never-cooked orders have no expiry, so a real customer's
    "In progress" section would fill with trips that will never start. Two owner-level
    questions follow — whether a stale `SEARCHING`/`RECEIVED` row should be reaped by a
    TTL job, and whether the feed should hide non-terminal rows older than some window —
    and neither is answered here, because both change what a customer is told about money
    and both would need `orders/expire-stale` semantics extended beyond `checkouts`.
    Deliberately **not** papered over with an arbitrary filter in the new endpoint.

---

## 7. CONTRADICTIONS DISCOVERED

| Source | Contradiction | Resolution |
|--------|---------------|------------|
| `docs/ARCHITECTURE.md:23` | States "10-Minute DarkStore Grocery Engine" | NABIN does NOT operate dark stores. Grocery is marketplace model. Document is outdated. |
| `docs/ARCHITECTURE.md:23` | States "DarkStore-linked ultra-fast grocery delivery" | Same contradiction. Must be corrected. |
| `docs/IMPLEMENTATION_GAP_AUDIT.md` | References "DarkStore" in quick-commerce section | Same contradiction. |
| `.agents/AGENTS.md` (pre-existing) | Missing governance rules for multi-agent conflict resolution, approval hierarchy, database safety | Updated in this governance setup. |
| User-stated baseline `8eb4f66` vs actual HEAD `1d404a6` | Phase 18 was implemented and reverted after user-stated baseline | Documented; actual HEAD is authoritative. |

---

## 8. REMOTE INFRASTRUCTURE

| System | Status | Access |
|--------|--------|--------|
| Remote Supabase (nabin-test) | OFF LIMITS | No access without explicit authorization |
| Remote Supabase (NABIN) | OFF LIMITS | No access without explicit authorization |
| GitHub (macmillanch/NABIN) | READ/WRITE | Push only with explicit approval |
| Docker (local Supabase) | ACTIVE | Local development only |

---

## 9. NEXT ACTIONS REQUIRED

1. **Fix hardcoded mock KYC** — `backend/src/database.js:440` seeds `kycStatus: 'VERIFIED'`; requires explicit approval for implementation.
2. **Formalize Migration 016 approval record** — Migration 016 is in authorized Git baseline via c0cdf47; formal user approval documentation is pending (see DEC-017).
3. **Conduct Phase 18 forensic audit** — Phase 18 was unauthorized and reverted; formal forensic audit has not yet been completed.
4. **Correct DarkStore references in legacy docs** — `docs/ARCHITECTURE.md`, `docs/API.md`, and `docs/BETA_CHECKLIST.md` still contain DarkStore terminology contradicting DEC-010. These are deferred documentation cleanup items.
5. **Proceed with PostgreSQL persistence bridge** — Migrate remaining in-memory arrays to PostgreSQL (no change to this planned work).
