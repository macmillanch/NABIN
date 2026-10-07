# NABIN — Task Tracker

**Updated**: 2026-09-24
**State**: Phases 2–3 and most of Phase 4 (see below) are complete locally, and on
2026-09-23/24 two more passes landed: the **admin surface pass** (suspension
enforcement, KYC gates, customer-accounts screen, permission catalogue —
`19c2ecf`…`30489e4`) and the **geofencing security pass** (one `GeoPolicyService`
authority, zoneId-body pricing deleted, bounded boot geo read, suite self-hygiene —
`635b406`…`a02971e`), followed by the **2026-09-24 closure batch** (this commit):
ten owner security decisions recorded in `docs/OWNER_SECURITY_DECISIONS.md` and
Decision 1 choice A implemented as migration **029** — the six Section-A tables now
refuse anon/authenticated reads at the privilege check on the **local Docker store
only**, `SEC-07` asserts the refusal, and `geo_anon_access_test.js` (44 checks)
joined the `npm test` chain. `origin/main` = `0bd03ce`; `main` is **33 commits
ahead locally and NOT pushed**. Nothing was deployed and no hosted database was
touched; migrations `027` and `029` are applied to the **local Docker PostgreSQL
only**. The last full recorded chain: `test_suite.js` **408 PASSED / 0 FAILED**;
the geo groups re-run 2026-09-24: policy **55/0**, adversarial **60/0**, anon-access
**44/0**. The other nine owner decisions await their own implementation orders.
Earlier history: the 2026-09-20/21 work reached the remote by fast-forward
`9b2804c..b13cdb3`, `55a1836` re-baselined `.agents/CURRENT_STATE.md`, and the same day's
follow-ups (`1b128e7` un-stock + merchant notification backend, `239c134` mobile
catalogue/un-stock, `9f0b4e9` + `d1381dc` docs, `dc11941` browse `is_active` fix, `c4eded7`
mobile notifications feed, `c974fc9` docs) landed on top of it.

## DONE (2026-09-23/24 sessions — admin surface + geofencing security)

- [x] **Admin surface pass (2026-09-22/23, committed):** `19c2ecf` a customer
      suspension now reaches the door (and is proven to); `c6fba68` the KYC gates
      actually gate the routes that claim them, and a fleet status change is
      described honestly; `0d577fc` customer accounts got a console screen which
      hides actions its caller cannot take; `9eca93d` a half-landed suspension now
      carries its audit trail; `30489e4` the permission catalogue was written and
      the two unfinished sweeps it found were closed.
- [x] **Geofencing authority pass (2026-09-23, committed):** `635b406` every
      geographic decision (quote, price, dispatch, telemetry) now runs through one
      `GeoPolicyService`, and a silently unreachable store became a loud one;
      `c335709` an attribution the next pass disproved was withdrawn from the
      record and replaced with what was actually measured; `0bd03ce` the session
      reconciliation row cap was removed; `a02971e` the boot geo read is bounded
      (`GEO_READ_TIMEOUT_MS`, `FI-09` — a store that answers everything except
      geography now boots marked `UNREADABLE` and refuses to price rather than
      pricing from a remembered copy), a fence is named by a column that can hold
      it, and the adversarial suites reap their own probe rows (HYGIENE-01).
- [x] **Owner decisions + Decision 1 implementation (2026-09-24, this batch):**
      `docs/GEO_SECURITY_DECISION_GATE.md` (the evidence record, no recommendations
      by design), `docs/OWNER_SECURITY_DECISIONS.md` (**all ten decisions recorded
      2026-09-24; a recorded choice decides what to build, it does not build it —
      each implementation still needs its own order**), the clarification and
      implementation-plan docs, and Decision 1 choice A implemented:
      `supabase/migrations/029_geo_and_commerce_reads_service_role_only.sql`
      applied to the **local Docker store only** — public read policies dropped and
      `REVOKE ALL FROM anon, authenticated GRANT SELECT TO service_role` over
      `geo_fences`, `surge_zones`, `pricing_configurations`, `platform_settings`,
      `promotions`, `notification_templates`. Measured after: anon and customer
      tokens get HTTP 401 / code 42501 / zero rows / no `content-range` where anon
      used to read 447 fences and 445 surge rules with geometry and surcharge;
      `service_role` and the backend boot are unaffected. `SEC-07-KNOWN-GAP`
      rewritten as `SEC-07` asserting the refusal and **failing, not skipping**,
      without the key in the environment; new `backend/geo_anon_access_test.js`
      (44 checks incl. the `merchants`/`advertisements` neighbours that must keep
      answering) added to `npm test`. Verification run 2026-09-24 on the live local
      stack: `geo_policy_test.js` **55/0**, `geo_adversarial_test.js` **60/0**,
      `geo_anon_access_test.js` **44/0** (the same harness printed 41 in an earlier
      pass; the final committed tree counts 44 stably).
- [ ] **Not closed by 029, by design:** `is_feature_enabled` remains `SECURITY
      DEFINER` with PUBLIC execute (one boolean, proven to carry no setting value);
      Section B of the proposed file (storefront tables, `merchants.lat/lng`) was
      never an owner decision; the driver-containment gate (§14 decision 1) is NOT
      DECIDED; the remaining nine owner decisions have no implementation order yet.

## DONE (2026-09-20/21 sessions — grocery/food customer path + merchant apps)

- [x] `restaurant_merchant_web_gap.md` + `grocery_merchant_app_gap.md` — audits
      classified IMPLEMENTED / PARTIAL / MISSING / BLOCKED from actual code.
- [x] Backend made PostgreSQL-authoritative for the customer browse + cart paths:
      `/api/restaurants`, `/api/restaurants/:id`, `/api/restaurants/:id/menu`
      (27 real restaurants, was 1 fixture), `/api/grocery/products` (14 orderable
      rows from `merchant_grocery_inventory`, was 5 dark-store fixtures that
      `checkout/validate` rejects), `POST /api/grocery/cart/revalidate` (PG branch,
      echoes `productId`/`unit` back), `/api/advertisements` now labelled
      `dataSource: 'in_memory', persisted: false`.
- [x] Grocery checkout is store-scoped for real: `merchantId` threaded through
      cart lines → `grocery_checkout_screen.dart` payload (it previously sent
      none, so the server defaulted to `mcht_1` and no order could ever be
      placed). Multi-store baskets are blocked with an honest message.
- [x] Removed the fabricated demo basket + invented fees from the
      `/grocery-checkout` route; it now reads the live `groceryCartProvider`.
- [x] Zomato-style menu sections (grouped by real PG `category`) on
      `restaurant_menu_screen.dart`; Blinkit-style product grids + promo carousel
      on grocery. Veg markers hidden when PG has no veg column instead of
      defaulting every dish to non-veg; placeholder artwork (`example.com`,
      `placehold.co`, …) nulled out so no dead image frames.
- [x] Grocery Merchant dashboard was reading dashboard-only keys out of the
      orders endpoint → permanently `₹0`/`0`. Now calls
      `getMerchantDashboard()` and shows grocery-scoped, honestly labelled
      "Sales on record".
- [x] Live end-to-end proof against local PG: shelf → revalidate
      (`singleMerchant: true`, `dataSource: postgres`) → `CHECKOUT_SUCCESS`
      order `ORD-00000317` → closed through the merchant API
      (`RECEIVED → REJECTED`, reason `OTHER`, transition id returned).
- [x] Verification on the final tree: `flutter analyze --no-pub` → **68 issues,
      0 errors, 0 warnings** (all `prefer_const_constructors` /
      `deprecated_member_use` infos). `flutter test` → **18/18 passed**.

## DONE (2026-09-20 session)

- [x] Tool-verified repo inspection (git, routes, endpoints, manifests)
- [x] `nabin_repository_inventory.md` — 11 sections, evidence-based
- [x] `scratch/restaurant_merchant_web_manifest.json` — 20 screens, JSON-valid
- [x] `scratch/grocery_merchant_web_manifest.json` — 23 screens, JSON-valid
- [x] `nabin_234_implementation_gap.md` — COMPLETE (§0–§14), all 46 Customer IDs
      classified, 6 projects domain-classified, B1–B11 blocked register, M0 proposal

## PENDING USER APPROVAL (nothing below may start without explicit USER approval)

- [x] Commit the 2026-09-20/21 work in 4 atomic commits (approved 2026-09-21):
      backend → mobile → web (both merchant consoles + admin-web/customer-web) →
      docs. `backend/.env` and `.kilo/` were excluded; the 11 mangled/junk files at
      the repo root were deliberately left unstaged.
- [x] Fix the lint errors in the committed web apps (approved 2026-09-21): the 5
      `react-hooks/*` errors per merchant console, plus the same 3 in admin-web's new
      resource pages. Two were genuine code fixes (the session-restore effect set
      state synchronously; `useCallback` deps on `merchant?.id` made React Compiler
      bail on the whole component); the rest are explained narrow disables, because
      the rule cannot see through an `await`.
- [x] **Push** — done 2026-09-21: `9b2804c..dac61ec` fast-forwarded to
      `origin/main`, 5 commits (`e7a7d31` backend, `c35306d` mobile, `7c1fe53` web,
      `19c9041` docs, `dac61ec` lint fixes).
- [ ] admin-web logout still uses `window.location.href = '/'` (lint warning) — a
      hard redirect instead of `router.push`, left alone as out of scope.
- [ ] M0: web→backend port fix (`NEXT_PUBLIC_API_URL`, both merchant web apps) — §13.2 of gap report
- [x] Junk root artifact deletion (2026-09-22, approved): the 11 mangled/pasted
      root files and `mcp_out.txt`/`readme.txt` were moved out of the repo to
      `../nabin-quarantine-2026-09-21/` with a `MANIFEST.json`, not deleted, so
      the action is reversible. Also removed from Git: `.git_diff_full.txt`,
      `.git_diff_stat.txt`, `.git_status.txt` (committed `git status`/diff dumps
      that rot on the next commit) and `mobile/p10_mobile.txt` (0 bytes,
      referenced nowhere). `.kilo/` stays: it holds two registered worktrees.
- [ ] Dark-store/legacy fixture cleanup in `backend/src/database.js`
- [x] Reviewed and deleted `IMPLEMENTATION_PLAN.md` (2026-09-21, approved): 0 bytes,
      never tracked by git, no code reads the path, and it shadowed nothing — the
      authoritative plan is tracked at `docs/PHASE_16_IMPLEMENTATION_PLAN.md`
      (613 lines, frozen, PLAN-ONLY). `.agents/CURRENT_STATE.md` §1 re-baselined to
      match, since it had listed the file as a "file of record".
- [x] Grocery Merchant App can stock products from the master catalogue
      (`e463661`, 2026-09-21): new `/catalogue` screen diffs
      `GET /api/merchant/master-catalog` against the store's inventory and posts
      `{masterProductId, currentPrice, stockQty, isAvailable}` to
      `POST /api/merchant/inventory`, reached from the inventory app bar and its
      empty state. Verified live as `Test Supermarket M2` (1 of 14 rows stocked →
      adopted Amul Taaza Milk at 42.50/25 → re-read as `AVAILABLE` → row removed
      from the local database, since there is no un-stock route). Rendered via a
      temporary widget test against the running backend, which caught a 94px
      `RenderFlex` overflow in the filter chips (fixed with `Wrap`) and the
      "1 litre litre" label duplication; the harness was deleted afterwards
      because it needs a live seeded database.
- [x] Grocery Merchant App can un-stock a line it added (2026-09-21):
      `DELETE /api/merchant/inventory/:masterProductId` →
      `db.deleteMerchantInventoryItem`, scoped to the bearer token's store, plus the
      trash icon + confirm dialog on the inventory cards and
      `NabinApiService.deleteMerchantInventoryItem`. `order_lines.grocery_inventory_id`
      is `ON DELETE RESTRICT`, so a line that has actually been sold is refused with a
      count and the advice to switch availability off instead — verified live alongside
      the stock→remove round trip, the cross-store ("not stocked in your store") scope
      refusal, the unknown-product refusal and a 401 without a token.
- [x] Merchant notifications resolve end to end on the backend (2026-09-21): the event
      bus takes `event.merchantId` as the recipient (`notifications.user_type` already
      allows `MERCHANT`, so no migration), the subscriber forwards
      `relatedEntityType`/`relatedEntityId` — they were dropped for every notification
      type, not just merchant — and a fresh insert is pushed to the store's sockets as
      `{type: 'NOTIFICATION'}`; grocery checkout publishes
      `MERCHANT_NEW_GROCERY_ORDER`. Verified with a raw `ws` client plus a real order
      (`ORD-00000319`) and `GET /api/notifications` / `PUT /:id/read` under a merchant
      token. Consumed by the feed screen below.

- [x] Duplicate "Test Basmati Rice" fixtures (approved 2026-09-21, "Deactivate 11, keep the used
      one"): `is_active = false` on the 11 duplicates, `6e617e3a…` kept active because
      `Test Supermarket M2` sells it and 26 order lines sit behind the set. Deletion was not
      possible (see gap report NOTES). A fresh store's master-catalogue list went 14 rows → 3.
      This needed `GET /api/grocery/products` to start honouring the flag: without
      `master_grocery_catalog!inner(...)` PostgREST keeps the parent listing and only nulls the
      embed, which turned those rows into "Grocery item" tiles — caught by re-reading the live
      browse response, not by reading the query.

- [x] Grocery Merchant App notifications screen (2026-09-21): `/notifications`
      (`grocery_merchant_notifications_screen.dart`) reads `GET /api/notifications` with the store's
      own token as the recipient, and adds the All / Unread • n filter, "Load older" pagination off
      `total`, mark-all-read (shown only when the count is non-zero), and a tap that marks the row
      read before deep-linking `/orders/:relatedEntityId`. A failed mark-read leaves the row visibly
      unread. `NabinWsService` gains a `NOTIFICATION` case and an `onNotification` stream, which the
      screen uses to reload silently while it is open; pull-to-refresh stays as the fallback. The
      dashboard bell carries the feed's own `unreadCount` as its badge. Verified by rendering the live
      feed through a temporary widget test (two real `ORD-00000319`/`ORD-00000318` notifications,
      `Unread • 1`, Unread filter returning only the unread row), then deleted;
      `flutter analyze --no-pub` → 69 issues, 0 errors/0 warnings; `flutter test` → 18/18.

## BACKLOG (ranked, each needs its own approval — gap report §13.4)

1. ~~Durable advertising~~ — CLOSED 2026-09-21 (option (c), below). What remains open:
   a priority / bid-rate / creative column set would need an approved migration, and the
   client slot vocabulary (`GROCERY_HERO_CAROUSEL`, `FOOD_HOME_BANNER`, …) collapses onto
   four real placements, so grocery and food share one `HOME_BANNER`.
2. `grocery_price_history` read endpoint (data is written, never exposed).
3. Merchant notifications: the feed screen and the `NOTIFICATION` socket case both shipped
   2026-09-21. Still open: push the badge live on the dashboard (it currently re-reads on the
   30-second poll), and cover more event types — today a grocery store only ever receives
   `MERCHANT_NEW_GROCERY_ORDER`.
4. Grocery Merchant App: enforce `master_grocery_catalog.is_active` on the write path — reads
   honour it now, but `resolveMasterProductId` and revalidate/checkout do not, so a retired product
   is still adoptable and orderable by direct id. The 11 duplicate rice rows were deactivated on
   2026-09-21; the `Test Supermarket M2` store clones that own them are still to clean up.
5. Restaurant Merchant Web: `/orders/[id]` detail route + a persistent menu
   write path; no CI/Docker/deploy definition exists for either merchant web app.
6. Redis/table backing for OTP + rate limits (both in-memory, lost on restart).
7. Driver App phase plan (38 screens, largest surface gap).
8. Phase 16 remediation (mock KYC, VPA, atomic cancellation).
9. Per-screen manifest records for 186 screens (restores 234 auditability).
10. Real product/dish photography: `products.image_url` has 0 non-null rows and
    every `master_grocery_catalog.standard_image_url` is an `example.com`
    placeholder — the apps render letter tiles because there is nothing else.

## SUPABASE CONNECTION RECOVERY (2026-09-20)

- [x] Security: prior anon + service_role keys treated as compromised; user
      rotated keys via Dashboard → `backend/.env` directly. No secrets in
      chat/logs. `backend/.env` confirmed gitignored, untracked, no diff.
- [x] Masked probe: URL configured, anon set, service_role set (all
      non-placeholder). `SUPABASE_POSTGRES_LIVE=true`.
- [x] Network: DNS FAILURE (`ENOTFOUND`) → TCP 443 + HTTPS inherit failure.
      Case A (reachability), NOT auth. See
      `supabase_connection_recovery_report.md`.
- [x] Live check `backend/scripts/verify_supabase.js`: `configured: true,
      connected: false, error: 'TypeError: fetch failed',
      mode: 'POSTGRES_DISCONNECTED'` — consistent with DNS failure.
- Status: **BLOCKED — DNS FAILURE**. Do NOT rotate keys again yet.
- Next: user confirms project active/unpaused in Dashboard + Reference ID
  matches configured hostname; then re-run masked DNS → TCP → HTTPS → live
  check. Only after CONNECTED may Customer App work resume.
- Git note (corrected 2026-09-21): HEAD `6494b25` is **1 ahead / 0 behind**
  `origin/main` `9b2804c` — a normal fast-forward situation, not a divergence.
  Working tree has tracked modifications + many untracked files. No
  commit/push done (PLAN-ONLY).

## SUPABASE STATUS CORRECTION (2026-09-21)

The 2026-09-20 BLOCKED note above referred to the **hosted** Supabase project's
DNS. The **local Docker** stack (Supabase `:54321`, Postgres `:54322`) was
recovered that evening at the user's instruction and is now the working
database: backend `isLivePostgres` is true and `/api/restaurants`,
`/api/grocery/products`, `/api/grocery/cart/revalidate` all respond with
`dataSource: "postgres"`. The hosted test/production projects remain **not
touched** — per standing rule, never migrate or modify remote infrastructure
without explicit authorization.

## PHASE 1 (server-driven architecture) + REAL-WORLD CHAOS AUDIT — 2026-09-21

Scope agreed for this phase: Phase 1 items 1–3 only, then the chaos/resilience
audit. Phase 2 and Phase 3 were explicitly NOT started. No migration 027, no
change to frozen migrations 001–026, no festival/theme tables, no Flutter
festival code, no push, no deploy, no production or hosted-Supabase access.

- [x] **Phase 1 item 3 — server-authoritative coupons at checkout.**
      `POST /api/grocery/checkout/validate` no longer trusts the client: the
      discount is computed server-side, validity dates / global cap / per-user
      limit / duplicate redemption are enforced through the PostgreSQL RPCs
      (`validate_promotion_preview` for quotes, `redeem_promotion_atomic`, which
      takes a `FOR UPDATE` row lock, for redemption), and the accepted discount is
      now written into `checkouts.discount_amount` together with
      `applied_promo_code`, `promotion_id` and `redemption_id`. Legacy in-memory
      `validateAndApplyCoupon()` remains only on paths that are not yet
      PostgreSQL-backed; API compatibility was kept (same routes, additive fields).
      Verified over HTTP and directly in SQL: `orders.total_amount ==
      checkouts.base_amount - checkouts.discount_amount`, one redemption row per
      order, a spoofed `discount: 999 / finalTotal: 1` is ignored.
- [x] **Phase 1 item 2 — `GET /api/app/config`** (also `/api/v1/app/config`),
      composed only from existing tables (`platform_settings`, `promotions`, the
      service-state row) via `backend/src/services/AppConfigService.js`. Returns
      DATA only (plain-value validation, byte/depth/string-length caps, no
      functions, no markup), `serverTime` as the clock authority, ETag +
      `If-None-Match` → `304`, a short public cache, and `stale: true` on the
      last-known-good snapshot if composition fails. Admin side:
      `GET/PUT /api/admin/platform-settings[/:key]` restricted to SUPER_ADMIN,
      writing through the existing audit log, with an `APP_CONFIG_` publish
      namespace and `FEATURE_*` / `PLATFORM_SERVICE_STATE` / `service_status` /
      `surge_multiplier` reserved so a generic writer cannot reach a killswitch.
      No new table, no migration.
- [x] **Phase 1 item 1 — advertisements are PostgreSQL-backed (option (c)).** No
      migration and no metadata smuggled into `platform_settings`: the frozen 004
      shape is read and written as it actually is
      (`title, merchant_id, placement, image_url, target_url, status,
      start_date, end_date, clicks, impressions`) through the new
      `backend/src/repositories/AdvertisementRepository.js`. `GET /api/advertisements`,
      `POST /api/advertisements/:id/click` and the admin campaign CRUD all answer
      `dataSource: 'postgres', persisted: true`; the public feed filters on
      `status = 'ACTIVE'` **and** the `start_date`/`end_date` window using the server
      clock, orders by `start_date desc` and says so (`ordering`), and rejects an
      unknown placement with `INVALID_PLACEMENT` plus the four supported values.
      Client slot names that predate the schema (`GROCERY_HERO_CAROUSEL`,
      `FOOD_HOME_BANNER`, `RIDE_HERO_BANNER`, `GROCERY_IN_FEED_BANNER`, …) resolve to
      a real placement through a documented alias map and the response echoes both
      (`placement` + `requestedSlot`). Writes that name a field the table cannot
      store — `brand`, `tagline`, `service`, `ctaText`, `bgGradient`, `accentColor`,
      `targetCategory`, `bidRateCpm`, `priority`, `industryCategory`, `sponsorBadge` —
      fail with `ADVERTISEMENT_FIELD_UNSUPPORTED` and the list of offenders instead of
      reporting a save that recorded nothing; the fabricated `adRevenueEstimate`
      metric is gone and replaced by `monetization.available: false` with the reason.
      The 12 invented third-party campaigns (Samsung, Netflix, PolicyBazaar, upGrad,
      DLF, Sony, with fake 48k-impression counters) were deleted from the in-memory
      fallback and replaced by four NABIN-owned house rows that only serve when
      PostgreSQL is unreachable, labelled `dataSource: 'fixture', degraded: true,
      persisted: false`. MODULE 8 was retargeted from 6 assertions to 12 (AD-01..AD-12,
      self-seeding and self-cleaning), AC-14 now asserts the durable store, and
      `restart_test.js` proves a campaign published before a cold restart is still
      served afterwards (30 → 33 checks).
      What option (c) does NOT give us, stated plainly: no priority ranking, no
      per-service scoping, no brand/creative fields and no bid rate — those need an
      approved migration, and until then the apps render campaigns from title,
      placement and image only.
- [x] **New regression coverage**: `test_suite.js` grew from 280 to 314 assertions —
      MODULE 8 retargeted to the real `advertisements` shape (AD-01..AD-12), MODULE 23b
      (CHK-01..CHK-14, coupons at checkout) and MODULE 31 (AC-01..AC-14, app config).
      `restart_test.js` grew from 30 to 33 checks (campaign published, survives a cold
      restart, cleaned up). No existing assertion was weakened or removed; MODULE 8's
      six originals were rewritten to the schema's semantics under the approved
      option (c), which is a deliberate change of target, not a relaxed bar.
- [x] **`backend/chaos_audit.js`** — LOCAL-ONLY resilience harness. It refuses to
      run unless the configured database host is this machine, resolves every HTTP
      call without rejecting (so an induced outage cannot abort it), and reports
      CH-00..CH-11 plus eight data-level financial invariants FI-00..FI-08.
      Findings, in severity order:
      - **CRITICAL — settlement is not serialized.** 50 concurrent
        `POST /api/driver/complete-trip` calls on one ₹106-earning trip produced
        98–100 journal postings (₹10,388–₹10,600) and credited the driver wallet
        ~50× the entitlement, while `jobs.status` and `jobs.driver_earnings` stayed
        correct. A healthy job books exactly 2 postings. The double-entry remains
        internally balanced throughout, so header/line reconciliation cannot see
        this — only the per-job entitlement invariant (FI-08) catches it.
        Not fixed in this phase (Phase 2 money-path work).
      - **MEDIUM — telemetry validation parity.** REST `/api/driver/location`
        answers `{"success":true,"telemetryStored":true}` for `lat 999 / lng 400`,
        `lat 'abc' / lng null`, an 1899 timestamp and speed 1e9; the WebSocket path
        rejects identical input with `COORDINATES_OUT_OF_RANGE`. No DB corruption
        (driver row coordinates stayed NULL) and `/api/fleet/locations` is
        admin-authenticated.
      - **MEDIUM — auth fails OPEN during a database outage.** With PostgreSQL
        stopped, `send-otp`/`verify-otp` and admin login still return `200` and
        issue tokens from the in-memory fallback with no `degraded`/`persisted`
        flag, so those credentials vanish on restart and leave no audit trail.
      - **MEDIUM — outages are mislabelled as business errors.** With the database
        down, a wallet read and a grocery checkout both failed (correct) but
        reported `MERCHANT_NOT_FOUND`-style codes, so an infrastructure fault is
        indistinguishable from bad input in logs, metrics and retry logic.
        **Checkout/merchant half fixed (2026-09-24, uncommitted):** the three
        `OrderRepository` checkout resolvers now raise a `503`
        (`settleStore`/`storeUnavailableError`) when PostgreSQL cannot answer
        instead of swallowing it into not-found, and the nine checkout/merchant
        route catches plus the previously un-caught food `resolveMerchant` hand
        that to the shared `storeReply` classifier. Proven by
        `backend/checkout_store_semantics_test.js` (5/0, red-green): a stopped
        store yields retryable 503s, a live store's genuine miss is still
        `null`/a 4xx. The finding also named a "wallet read"; on investigation
        `GET /api/customer/wallet` is not a registered route in the current
        server (the probe was hitting a 404 for an endpoint that no longer
        exists), and no live wallet-balance read path swallows a PostgreSQL
        error into a business code, so there is no matching fix to make there —
        recorded as investigated, not open.
        - **Remaining sweep scope — RESOLVED by OWNER DECISION 11 (choice B),
          2026-09-24.** The same `if (!error && data)` shape exists in other
          repository reads — `PaymentRepository.getPaymentSession`,
          `UserRepository.findByIdAsync`/`findByPhoneAsync`, `DriverRepository`,
          `JobRepository`, `DispatchRepository` — but these are the *opposite*
          failure mode from the checkout resolvers: deliberate read-through
          caches that fall back to hydrated memory when PostgreSQL cannot answer
          (fail-OPEN), not fail-closed-with-a-bad-code. The owner was asked A
          (fail closed 503) vs B (keep the memory fallback) and chose **B**, so
          the existing fallback is **preserved, not changed**. Each site now
          carries an "Owner Decision 11 (choice B)" comment so a future sweep
          cannot silently reverse it, and
          `backend/hydration_fallback_test.js` (HYD-01…08, 8/0) locks the
          semantics — it was sensitivity-checked by temporarily converting
          `getPaymentSession` to a 503 (HYD-01/02 then FAIL) and reverting.
          `SupportTicketRepository`'s flagged line was verified to be a
          create/write, not a read, so it is out of scope and untouched. With
          this, the codebase-wide 5xx/4xx outage sweep is **complete**: the
          money-path checkout reads fail closed (503), the hydration reads keep
          their accepted cache fallback, both are tested, and both suites joined
          `npm test`.
      - **LOW — accept-job is not 409 on an assigned job.** 50/100 concurrent
        accepts of an already-ASSIGNED job returned 200; ownership stayed with one
        driver, so no double-assignment occurred.
      - Safe under race: idempotency (30 concurrent checkouts on one key → 1
        order), coupon caps (100 concurrent → exactly 10 redemptions,
        `usage_count` true), refunds (100 concurrent ₹200 on ₹500 → 2 honoured,
        cumulative and bounded, no reused key), RBAC/IDOR (0/5 cross-tenant reads
        answered, customer-impersonating-driver 403), invalid transitions and
        unsigned webhooks (all rejected).
      - Verified after all chaos traffic: FI-01 headers reconcile their lines,
        FI-02 books level at ₹254,818 both sides, FI-03 no over-refund,
        FI-04 checkout arithmetic, FI-05 order mirrors checkout, FI-06 no negative
        wallet, FI-07 promotion counters and caps true. FI-08 is the failing one
        above. FI-00 notes 8 journal headers / 4 lines / 4 refund authorisations
        inserted directly by hand-run Phase 9 probes on 2026-09-16; they are
        excluded from the app invariants and should be cleaned out of any
        environment that reports audited books.
      - CH-11 (hard `SIGKILL` mid-burst) was run by hand because the harness must
        not kill the server it is driving: 97 checkouts issued, 33 HTTP 200s, and
        PostgreSQL holds exactly 33 orders + 33 checkout rows + 33
        `order_creation_tokens` rows — no partial writes, no orphans, and grocery
        idempotency survives the restart because the token lives in
        `order_creation_tokens` (the `checkouts.idempotency_key` column stays NULL
        on this path).
      - CH-06 (concurrent payouts) is BLOCKED by environment, not by a defect: the
        suite re-verifies the driver VPA, which sets a 24h payout cooling-off, so
        the race cannot run within 24h of a suite pass. The harness now reports
        that honestly instead of scoring a vacuous pass.
      - CH-10 outage pass was executed against the stopped local container
        (`docker stop supabase_db_nabin`, `CHAOS_DB_DOWN=1 node chaos_audit.js`,
        `docker start`); the backend stayed reachable, disclosed
        `POSTGRES_DISCONNECTED`, served `/api/app/config` with `stale: true`, kept
        ads labelled `persisted: false`, failed the money path closed, and
        reconnected on its own after the container came back.
- [x] **Test-environment preconditions learned (not defects)**: reset
      `pricing_configurations` `GLOBAL.global_surge_multiplier` to 1.0 through
      `POST /api/admin/pricing {"serviceType":"GLOBAL",...}` before a clean run
      (the per-service reset is not enough); the admin broadcast route allows 1 per
      15 minutes, so NOTIF-API-14/15 fail on rapid re-runs; back-to-back harnesses
      on the same fixture phones hit the OTP rate limit. Two more found while
      chasing a definitive number: the backend process must carry
      `PAYMENT_WEBHOOK_SECRET=test_webhook_secret_not_for_deployment` (the value
      `test_suite.js:6` defaults to) or MODULE 18's two HMAC assertions fail with
      `INVALID_SIGNATURE` — the secret is not in `backend/.env` on purpose, so it
      belongs in the local process env, never committed; and two suites must never
      run concurrently, because they compete for the same broadcast window and OTP
      phones (a concurrent pair produced 305/3 where a solo clean run gives 307/1).
- [x] **Definitive regression, solo clean run 2026-09-21 18:5x IST** (fresh backend
      with the test webhook secret, `GLOBAL` surge reset to 1.0, broadcast window
      expired): `test_suite.js` → **307 passed / 1 failed (308)**, exit 1. The only
      failure is the pre-existing `gprod_5` revalidate assertion below. At `HEAD`
      without this phase's code the same file reported 269/11. Of those 10 other
      baseline failures, 6 (the server-side 30% coupon preview, PROMO-05/08/08b/09
      and Priya's single-use coupon) are fixed by this phase's work, and 4 (the
      GLOBAL surge leftover, both webhook HMACs and WS-07) were the environment
      preconditions above rather than code faults.
      `restart_test.js` 30/30 (exit 0); `flutter test` 18/18;
      `flutter analyze --no-pub` 69 issues with 0 errors / 0 warnings (exit 1).
- [ ] **Known pre-existing failure, unchanged by this phase**: `POST
      /api/grocery/cart/revalidate` cannot return `VALIDATED` for a cart containing
      `gprod_5`, because PostgreSQL stocks only `…0401` (Farm Fresh Tomatoes) and
      `…0402` (Amul Taaza Milk) while `gprod_1`/`gprod_3` are the only mapped
      legacy ids — re-confirmed directly in SQL: `master_grocery_catalog` holds zero
      rows matching `%lays%`, so "Lays Classic Salted Chips" exists only in the
      14-row in-memory fixture. The assertion already failed at `HEAD`
      (`269 passed / 11 failed`), so it is a data-seeding gap to schedule, not a
      regression to hide, and per instructions the assertion was not weakened.
- [x] **Financial invariants re-checked after the definitive runs** (read-only SQL
      against the local container): `journal_transactions` 1,996 headers with 0
      unbalanced ones and ₹270,069.00 debit == ₹270,069.00 credit; 4 headers carry
      no lines, and all 4 are the 2026-09-16 hand-run `phase9_probe` rows already
      disclosed in FI-00; 0 checkout arithmetic violations, 0 order↔checkout
      mismatches, 0 negative wallets across users/drivers/merchants, 0 promotion
      limit violations; per-job settlement still shows exactly 3 over-booked jobs —
      the 3 chaos runs at 98–100 postings (₹10,388/₹10,600) against a ₹106
      entitlement, next to healthy jobs at exactly 2 postings / ₹298.

## PHASE 2 (client render pass + cache package) — 2026-09-21 → 2026-09-22

Scope: make the Flutter client a renderer for what Phase 1 publishes, and give it
an on-device cache. No migration, no new table, no push, no deploy, no
production or hosted-Supabase access. Phase 3 (`campaigns` / themes / banners ⇒
migration 027) was NOT started.

- [x] **Server side of the theme (completes Phase 1 item 2).**
      `backend/src/services/AppConfigService.js` now composes `sections.theme`
      from the same `platform_settings` row the generic writer publishes
      (`APP_CONFIG_THEME`): a 15-token allow-list, `/^#[0-9a-fA-F]{6}$/` only,
      values uppercased, offenders named in `rejectedTokens`, and
      `remoteOnly: ['colours']` / `notRemote: ['fonts','logos','layout','icons']`
      so the feed cannot imply more than it delivers. Degraded branch when PG is
      down. Verified live: `test_suite.js` AC-15..AC-19 (publish mixed-valid
      object → only the 3 allow-listed hexes are exposed, `#0f4c81` →
      `#0F4C81`; `primaryTextColor: 'rgb(0, 0, 0)'` and `notARealToken` rejected
      and `rgb(` never appears in the payload; teardown `{}` →
      `available: false, tokens: {}`). No new table, no migration.
- [x] **Cache package.** `shared_preferences: ^2.5.5` is the only new dependency.
      New `mobile/lib/core/config/`: `nabin_app_config.dart` (parsed snapshot,
      every field optional, anything dropped is named in `rejected`),
      `nabin_config_repository.dart` (conditional `GET` with `if-none-match`,
      ETag reuse, fallback ladder live → `304`-validated cache → stored cache →
      bundled, `NabinConfigUnavailableException` when there is nothing to fall
      back to), `nabin_config_controller.dart` (Riverpod `StateNotifier` that
      keeps the last good answer when a refresh fails, plus `nabinPaletteOf(ref)`),
      `nabin_config_lifecycle.dart` (re-read on foreground resume, so a phone that
      slept through a pause does not keep selling it).
      `PreferencesNabinConfigStore` degrades to process lifetime when the plugin
      is absent — every widget test and desktop target — instead of throwing.
- [x] **Colours are runtime data.** `NabinPalette` is a `ThemeExtension`;
      `NabinTheme.light/dark` take a palette and install it as the extension; all
      7 entrypoints (`main* .dart`) are `ConsumerWidget`s that resolve their theme
      through `nabinPaletteOf(ref)`, so the five role apps and both merchant
      variants follow a publication. 9 files call `NabinPalette.of(context)`: the
      whole shared widget kit (`nabin_button`, `nabin_card`,
      `nabin_status_chip`, `nabin_text_field`, `glass_container`,
      `nabin_service_card`) plus the customer home and the two new banner
      surfaces. Proven end to end against the LOCAL stack with no stub:
      publishing `APP_CONFIG_THEME {brand:#0f4c81, canvas:#F4F7FB,
      groceryAccent:#1B7F4B}` made the customer home paint
      `brand=ff0f4c81`, `canvas=fff4f7fb`, `groceryAccent=ff1b7f4b`,
      `ColorScheme.primary=ff0f4c81`, `publishedTokens=[brand,canvas,groceryAccent]`,
      `source=remote`, `dataSource=postgres`, 15 feature flags, 6 service rows,
      `clockSkew≈14ms`, `rejected=[]`.
- [x] **A real contrast bug the remote palette exposed, and a visible behaviour
      change.** `NabinTheme.on()` compared `1/contrast` against `contrast`, so it
      returned white for nearly every light fill — the exact failure its own
      docstring says it exists to prevent. It now measures WCAG ratios against the
      palette in use. Consequence: a light brand or accent carries dark ink instead
      of white. `#FFFDE7` as brand renders `onPrimary = NabinColor.onSurface`.
- [x] **Banner slot + killswitch gating on the customer home**
      (`customer_home_screen.dart`, now a `ConsumerStatefulWidget`; the local
      `_features` fetch and `_handleServiceTap` are gone):
      `NabinRemoteBanner` renders up to 3 campaigns for a placement and nothing at
      all while loading, when the slot is empty and when the feed failed — an ad
      slot is not information the customer asked for, so a placeholder box would be
      a lie; the creative is a real `Image.network` with an `errorBuilder`, and the
      only label is `Promoted` because the frozen shape has no sponsor column.
      `NabinPlatformNotice` shows the published pause / degraded / lockdown state
      with the operator's own `broadcastNotice` and the server's `resumeAt`
      remaining minutes; nothing is inferred from a device timer. Each tile is
      gated on BOTH the uppercase `FEATURE_*` flag and its lowercase service row
      (`rides`/`food`/`grocery`/`parcel`) — checking only one would silently never
      fire — plus the platform killswitch. Verified live with a stored
      `HOME_BANNER` row (`dataSource: postgres, persisted: true`): the tile painted
      for a real campaign inside its window; after deleting it the slot renders
      nothing. Scratch harness deleted after the run per practice.
- [x] **The killswitch gate was dead code and is now not.** The client only
      looked for a row with status `EMERGENCY_STOP`, but the switchboard never
      writes that: a lockdown is `summary.platformStatus:
      'EMERGENCY_LOCKDOWN'` with every service row still present. `NabinAppConfig`
      now reads the published summary (`platformStatus`) as well as a row that
      spells it, and `NabinPlatformNotice` renders from either. The gate is a
      mirror of the server's own rather than a guess at it:
      `backend/src/database.js:2017` sets `platformStatus: 'EMERGENCY_LOCKDOWN'`
      exactly when `paused === total && total > 0`, and `backend/src/server.js:276`
      refuses work on that same field — so the client stops the tiles precisely
      when the platform stops answering them.
- [x] **Tests: 41 widget/unit cases, 23 of them new** — `test/remote_config_test.dart`
      (14: parsing, server-time authority, the fallback ladder, and 6 painted-pixel
      render assertions) and `test/customer_home_config_test.dart` (9: the
      lockdown rollup from the summary, an operational platform showing no notice
      and no offline tile, one paused service darkening only its own tile and
      quoting its own notice, a `FEATURE_*` flag overriding a running service, an
      emergency stop taking all 4 tiles offline, an unlisted service row staying
      on the flag, a campaign inside its window painting while an expired one
      does not, a dead banner feed leaving no placeholder, nothing published
      painting no slot). `flutter test` 41/41; `flutter analyze --no-pub` 67
      issues with 0 errors and 0 warnings (the pre-existing baseline was 69).
      No assertion was weakened; `app_flow_test.dart` needed no change.
- [x] **Honest limit (the part that must not be overstated).** A published theme
      changes what the surfaces listed above paint, and the copy/banners/flags
      that come from the feed change without a release. Everything else still
      needs an APK: `lib/` outside `core/theme` still carries 450 `AppTheme.*`
      compile-time references across 17 files and 278 inline `Color(0x…)`
      literals; fonts, logos, icons and layout are bundled by design (the feed
      says so in `notRemote`); campaign schedules and coupon rules are
      server-owned, but any new screen, new token or new interaction is a
      release. The customer home itself keeps 11 deliberate literals: the
      SafeRide amber ramp, the support slate gradient and the restaurant-pairing
      orange, none of which has a token in the published vocabulary.
- [ ] **Remaining render-pass work (not claimed as done)**: the driver, grocery,
      restaurant, grocery-merchant and admin screens still resolve compile-time
      constants; the checkout/search-banner placements are modelled
      (`SEARCH_INLINE`, `CHECKOUT`, `DRIVER_IDLE`) but not yet mounted on those
      surfaces; `sections.offers` is published but no screen renders offer copy
      from it yet.
- [ ] **No build has been produced for this refactor, and this machine cannot
      produce one.** `flutter doctor`: Android cmdline-tools are missing and the
      SDK licenses are unaccepted (so `flutter build apk` fails before compiling),
      Windows desktop needs Visual Studio (not installed), and the web target is
      closed to these apps because `core/network/nabin_api_service.dart` imports
      `dart:io`. `flutter analyze` (0 errors / 0 warnings) plus `flutter test`
      (41/41, including painted-pixel assertions from a live widget harness) are
      therefore the strongest gates available here — the statement that this
      code "ships in an APK" remains unverified until someone builds it.

## CRITICAL trip settlement race — root cause and database-level fix (2026-09-22)

The chaos audit's CH-02 flagged that concurrent `POST /api/driver/complete-trip`
requests could settle one trip many times. The guard existed but was built
wrong, and the money path behind it had two further defects. No migration was
needed: every primitive required already exists in the frozen schema.

- [x] **Root cause: a compare-and-set that accepted its own target state.**
      `JobRepository.updateStatus` wrote the new status with
      `.in('status', [...VALID_JOB_TRANSITIONS[newStatus], newStatus])`. The
      `newStatus` term is the bug: under READ COMMITTED the 2nd…50th concurrent
      request each re-match the row the 1st request had just settled, so each
      one "wins" the transition and settles again. `COMPLETED` is now in a
      `NON_REPEATABLE_TRANSITIONS` set whose SQL allowlist excludes the target
      state, whose pre-check throws `JOB_ALREADY_SETTLED` when the row is
      already there, and whose zero-row update throws the same code — that is
      the atomic claim: PostgreSQL matches the row once, and the loser sees 0
      updated rows. Repeatable transitions (e.g. `CANCELLED` from several
      parents) keep their idempotent allowlist untouched.
- [x] **Second defect, found in the local books: a settlement never recorded
      platform revenue.** Both movements of a settlement were posted under one
      randomly generated `journal_transactions.transaction_id`, which is UNIQUE,
      so the commission insert collided with the earnings insert and the error
      was swallowed. Net effect: no trip in the durable ledger has ever carried
      `PLATFORM_COMMISSION_REVENUE`, and the redundant second header double
      credited `DRIVER_EARNINGS_PAYABLE`. Fixed by dropping the duplicate
      posting and giving each movement a deterministic id
      (`RIDE-SETTLEMENT-<job>:NET` / `-COMMISSION`).
- [x] **Third layer: database idempotency rather than HTTP politeness.**
      `LedgerRepository.recordDoubleEntry` accepts an `idempotencyKey` and maps
      a `23505` unique violation on it to `{ duplicate: true }`; `adjustWallet`
      maps the same code to `IDEMPOTENT_SKIPPED`. `DriverRepository.updateEarnings`
      derives `RIDE_SETTLEMENT:<jobRef>:DRIVER_EARNINGS` and reports
      `{ driver, duplicate, posted }`, so `database.js` skips the in-memory
      wallet bump when `adjust_wallet_atomic` already posted the movement and
      returns the job without booking twice. Keys are derived from the job
      reference, not from a request id, so a duplicate cannot be re-keyed.
- [x] **HTTP surface states the truth.** `POST /api/driver/complete-trip`
      recognises an already-`COMPLETED` trip *before* the OTP gate and answers
      `409 TRIP_ALREADY_SETTLED` — a duplicate is not a missing OTP proof — and
      `verify-otp` distinguishes the same code from a genuine transition
      rejection. Both keep their previous shape for every other error.
- [x] **Regression test MODULE 32 (CONC-00…CONC-09): 50 concurrent completions
      of one real trip.** Books a ride, assigns it, verifies the START OTP,
      snapshots `jobs`/`drivers`, fires `Promise.all` of 50 completions, then
      asserts on the ledger rather than on responses: exactly one `200`, one
      settlement per intended movement, one `DRIVER_EARNINGS_PAYABLE` and one
      `PLATFORM_COMMISSION_REVENUE` credit, `total_debit == fare`, four balanced
      lines, the driver wallet moved by exactly one net earning, the job
      `COMPLETED`, and a replayed 9th request that changes nothing. Each
      assertion carries a `details` diagnostic (status/`code` histogram, ledger
      rows) so a future failure explains itself instead of just going red.
- [x] **Verified at the database level, not through the HTTP layer alone.** A
      standalone 50-way harness (deleted after the run) drove the race directly
      and read PostgreSQL itself: `{"200:success":1,"409:TRIP_ALREADY_SETTLED":49}`,
      `fare=144 booked=144 postings=2 lines=4`,
      `credits=[DRIVER_EARNINGS_PAYABLE=122, PLATFORM_COMMISSION_REVENUE=22]`,
      wallet `1022 → 1144` (delta exactly the net earning), replay
      `409 TRIP_ALREADY_SETTLED` with `postingsAfterReplay=2`.
- [x] **Full re-verification chain, solo clean runs (2026-09-21 20:31→20:41Z, local
      stack only).** `test_suite.js` → **329 passed / 1 failed of 330**, exit 1; the
      single failure is the pre-existing `gprod_5` revalidate seeding gap that also
      fails at `HEAD`, so every financial assertion is green including
      CONC-00…CONC-09 and the GEO-07 surge teardown. `restart_test.js` →
      **33 passed / 0 failed**, exit 0. `chaos_audit.js` → `PASS=15 FINDING=1
      BLOCKED=3 FAIL=2`: **CH-02 now PASSES** (`50 concurrent completions of one
      ₹89 trip → 1 accepted, 2 settlement postings totalling ₹105, status=COMPLETED`),
      CH-07 confirms the already-settled 409, and the financial invariants FI-01…FI-07
      are green (2,121 headers all reconciling, ₹287,704 both sides, 0 over-refunds,
      0 checkout/order arithmetic mismatches, 0 negative wallets, 0 promotion limit
      violations). `flutter test` 41/41; `flutter analyze --no-pub` 67 issues,
      0 errors / 0 warnings.
- [ ] **Two failures remain open and neither is this fix.** `FI-08` still reports
      exactly the same 3 jobs (`JOB-92412647-611`, `JOB-92768166-552`,
      `JOB-93587159-696`) over-booked at 98/98/100 postings — their ledger rows were
      written at 12:06, 12:12 and 12:26 UTC today by the *pre-fix* chaos runs, and
      cleaning them means deleting financial history, so it is a decision to make,
      not a step to take silently. `CH-08` remains a separate medium finding:
      `POST /api/driver/location` accepts impossible or stale fixes that the socket
      path rejects with `COORDINATES_OUT_OF_RANGE`.

## PHASE 3 (dynamic campaigns, festival themes and assets) — 2026-09-22

A campaign previously had to be assembled out of three unrelated stores — one
advertisement row per banner, one promotion row per coupon, one `platform_settings`
blob for the palette — and none of them could answer "what is running right now, and
when two overlap which one wins". This phase gives a campaign a row of its own, hangs
its theme/assets/offers/messages off it, and makes the **PostgreSQL clock** the only
thing that can open or close it.

### Approved migration
- [x] **`supabase/migrations/027_dynamic_campaigns_and_themes.sql` (268 lines) —
      approved as "Option A" by the owner, applied to the LOCAL Docker instance only.**
      Five tables: `campaigns` (unique `code`, `name`, operator-intent `status`
      CHECKed to `DRAFT|SCHEDULED|ACTIVE|PAUSED|ARCHIVED`, `priority`, `service_types
      TEXT[]` CHECKed against `RIDE|FOOD|GROCERY|PARCEL`, `starts_at`/`ends_at` with a
      `ends_at > starts_at` constraint, a non-destructive `is_active` off switch,
      `code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'`); `campaign_assets` (`kind` LOGO/WORDMARK/
      BANNER/PROMOTIONAL_IMAGE/POPUP_BACKGROUND/SPLASH/FAVICON, URL CHECKed to
      `https?://`, `cloudinary_public_id`, `alt_text`, `locale`, `priority`);
      `campaign_themes` (one per campaign by UNIQUE `campaign_id`, `palette JSONB`,
      logo/wordmark/splash asset FKs `ON DELETE SET NULL`); `campaign_offers`
      (`promotion_id` FK **RESTRICT**, so archiving a campaign never eats a coupon, and
      `UNIQUE (campaign_id, promotion_id)`); `campaign_messages` (`kind`
      ANNOUNCEMENT/POPUP/INLINE_BANNER/TOAST, `surface`, `trigger_event` CHECKed,
      `dismissible`, `show_once`, `locale`, `priority`). Indexes: window lookup, a
      **partial** `(priority DESC, starts_at DESC) WHERE status <> 'ARCHIVED'` for the
      live ordering, a GIN on `service_types`, and one per child lookup path.
      Two SQL functions: `campaign_effective_status(...)` derives
      `DRAFT|SCHEDULED|ACTIVE|PAUSED|EXPIRED|ARCHIVED` from the row's own intent plus
      `now()` — `EXPIRED` is never stored, and `is_active = false` resolves to `PAUSED`
      — and `resolve_live_campaigns(service, at)` returns only rows whose effective
      status is `ACTIVE`, in publication order. **RLS is enabled on all five tables with
      no policies *and* `REVOKE ALL FROM anon, authenticated`**, so the anonymous REST
      role is refused outright (`42501`) rather than being handed an empty list;
      `service_role` gets an explicit SELECT plus EXECUTE on the two functions, and
      writes reach it through the platform's default privileges for a `postgres`-owned
      table (verified live: `INSERT/SELECT/UPDATE/DELETE` for `service_role`, nothing
      for `anon`). No festival content is seeded — inventing one would put fake
      production data into a real catalogue.

### Backend
- [x] **`backend/src/repositories/CampaignRepository.js` (583 lines)** owns every
      campaign read and write: create/update in one request with the children replaced
      wholesale, `effectiveStatus` on every row that is surfaced, live reads through
      `resolve_live_campaigns`, `LIVE_PUBLICATION_LIMIT = 5`, and a status machine
      (`CAMPAIGN_STATUS_TRANSITIONS`: `ARCHIVED` terminal, `ACTIVE` reachable only via
      its own window or an explicit publish) that refuses a jump with
      `CAMPAIGN_TRANSITION_REJECTED` plus the list of states actually allowed.
      Wired into `database.js` as `this.campaignRepo`.
- [x] **Admin API** (`backend/src/server.js`, +219 lines):
      `GET/POST /api/admin/campaigns`, `GET/PUT /api/admin/campaigns/:idOrCode`,
      `POST /api/admin/campaigns/:idOrCode/status`, `DELETE` (⇒ archive, never
      destroy), `GET /api/admin/campaigns/live?serviceType=`. Permissions
      `campaign.view|create|edit|publish|delete`; every write leaves an audit row under
      module `CAMPAIGNS` naming the admin. `PUT` strips `status`, so a copy edit cannot
      publish anything.
- [x] **`campaigns` is now a section of the composed `GET /api/app/config` feed**
      (`AppConfigService.js`, +103 lines): theme palette, logo/wordmark/splash URLs,
      banners, offers **by coupon reference** (`couponCode` + the coupon's own
      `discountType`/`discountValue`, never a copied number), messages, plus
      `resolvedBy: 'postgresql clock (resolve_live_campaigns)'` and a 30-second cache
      that campaign, advertisement and settings writes invalidate.

### Admin console
- [x] **`admin-web/src/app/campaigns/page.tsx`, `components/CampaignEditor.tsx`
      (720 lines), `lib/campaigns.ts` (253 lines), nav entry in `AdminLayout`.**
      An operator writes Christmas 2026 → window → theme tokens → logo/banner URLs →
      per-service coupon offers picked from the real coupon list → announcement/popup,
      and presses publish. The server names every field it refuses; the editor never
      re-implements validation.
- [x] **Real blocker found while proving it in a browser: the admin console could not
      log in at all.** `authApi.login` posted only `{ password }` while
      `POST /api/admin/login` requires `username` — fixed across
      `lib/api.ts`, `AuthProvider.tsx`, `app/login/page.tsx`.
- [x] **A lost-update bug caught in the browser before this code ever landed.** Clicking
      three service chips in one frame left only the last one pressed, because the
      handler read the render closure (`draft.serviceTypes`) instead of deriving the next
      state from the updater argument. `toggleService` now uses
      `setDraft((d) => …)`; `RIDE + FOOD + PARCEL` all stay selected.
- [x] **Proved through a real browser against the local stack, not only by
      assertions.** Christmas 2026 (`XMAS-UI-2026`, priority 60, 20–27 Dec, brand
      `#0F5C2E` + food accent `#C0392B`, logo and banner URLs, RIDE 10% / FOOD 20% /
      PARCEL ₹30 chosen from the live coupon picker, one `CUSTOMER_HOME` announcement)
      was authored entirely in the console. Publishing it left the **server clock**
      holding it back as `SCHEDULED` with nothing live for any service on 22 Sep 2026;
      moving its start date put it into `GET /api/app/config` moments later with no
      rebuild; archiving it from the UI emptied the feed again.

### Flutter (no APK rebuild for a festival)
- [x] `mobile/lib/core/config/nabin_app_config.dart` (+454) parses the `campaigns`
      section into immutable models; `nabin_palette.dart` maps a published palette onto
      the existing theme extension; `core/widgets/nabin_campaign.dart` (459 lines)
      renders the campaign banner slot, the festival logo in place of the built-in
      wordmark, and a gated popup; `customer_home_screen.dart` consumes them. Nothing
      festival-specific is hard-coded in Dart.

### Two behaviour fixes that fell out of testing
- [x] **An offer on a dead coupon is no longer advertised.** `AppConfigService` drops
      campaign offers whose coupon row has been switched off (or deleted), so the feed
      never promises a discount the server would then refuse (CP-14).
- [x] **Coupon writes invalidate the composed feed.** `POST /api/admin/promotions` and
      `PUT /api/admin/promotions/:id` now call `appConfigService.invalidate()`, so
      switching a coupon off stops the advertisement in the same moment rather than one
      cache window later.

### Test-ordering fix (why the geofence assertion looked flaky)
- [x] `restart_test.js` deliberately sets `global_surge_multiplier = 1.18` to prove the
      value survives a cold start, and used to **leave it there**. Any `test_suite.js`
      run afterwards would fail `Point outside geofenced zones evaluates … standard
      1.0x surge` for a reason that has nothing to do with geofencing. The run now
      restores 1.0 through the admin pricing route after the persistence assertion has
      passed
      (`Restart test leaves the global surge multiplier at baseline for the next run`),
      and the suite passes when run directly after it. The assertion's condition was
      not touched; it only gained a diagnostic that names the observed multiplier.

### Verification (all local, 2026-09-22)
- [x] `test_suite.js` → **352 passed / 1 failed of 353**; the single failure is the
      pre-existing `gprod_5` revalidate seeding gap that also fails at the previous
      `HEAD`. New `MODULE 33` covers CP-00…CP-22: auth 401/403, one-request authoring,
      offer-by-reference, a full invalid-payload refusal that names every offender, no
      orphan rows after a refusal, edits cannot change state, illegal transition lists
      its options, ACTIVE-before-window resolves SCHEDULED and reaches no client,
      opening the window serves it with no rebuild, the feed carries colours/logo/
      banner/coupon terms, an internal operator note is never published, service
      targeting admits RIDE and refuses GROCERY, dead-coupon offers withheld, priority
      ordering, the database clock expiring a window, delete-archives-and-keeps-rows,
      ARCHIVED terminal, audit rows naming the admin, the anonymous REST role refused,
      duplicate codes refused, and a teardown that leaves no test campaign live.
- [x] `restart_test.js` → **34 passed / 0 failed** (33 previous + the surge restore).
- [x] `chaos_audit.js` → `PASS=15 FINDING=1 BLOCKED=3 FAIL=2 NOTE=1`. `CH-02` still
      passes (50 concurrent completions of one ₹105 trip → 1 accepted, 2 postings
      totalling ₹123); financial invariants `FI-01…FI-07` green (2,177 headers all
      reconciling, ₹293,557 both sides, 0 over-refunds, 0 checkout/order arithmetic
      mismatches, 0 negative wallets, 0 promotion limit violations). The two red lines
      are unchanged and both are already owned: `CH-08` (REST `/api/driver/location`
      accepts impossible fixes) and `FI-08` (3 jobs booked over-entitlement by
      **pre-fix** runs; the owner's decision is "leave it, report it").
- [x] `flutter test` → **56 passed / 0 failed**, including `campaign_config_test.dart`
      (450 lines: the customer home follows a live campaign, a popup asks once and
      remembers, a campaign with no logo keeps the wordmark, an expired campaign paints
      nothing). `flutter analyze --no-pub` → **67 issues, all `info`, 0 warnings, 0
      errors**, none in a campaign/config file.
- [x] `admin-web` → `tsc --noEmit` clean, `eslint .` **0 errors / 1 warning**, and the
      warning is the pre-existing `window.location.href` logout redirect in
      `src/lib/api.ts`, not campaign code.
- [x] **Local database state left behind (dev instance only).** 11 campaign rows exist
      and **every one is `ARCHIVED`**, so nothing is live for any client: the 5 probe/UI
      rows from the browser pass (`XMAS_PROBE_*`, `XMAS-LIVE*`, `XMAS-UI-2026`) and 6
      suite rows (`CP_FEST_*`/`CP_RIVAL_*` across three runs). Rows are archived rather
      than deleted because that is the lifecycle under test. 13 of the 412
      `promotions` rows are test coupons from these runs (`CP_*`, `XMAS_*`).
      `pricing_configurations.GLOBAL.global_surge_multiplier` is back to `1.00`.
- [ ] **Honest limits of this phase.** Only `CUSTOMER_HOME` is a wired Flutter surface —
      other `surface` values are stored and published but nothing renders them yet; the
      popup is proven by widget test, not on a device; the editor takes asset **URLs**,
      so there is no in-admin Cloudinary picker/upload for campaigns; `027` has not
      been applied to any hosted project, so campaigns are live only against the local
      database; the driver and merchant apps do not read the campaign section.

## PHASE 4 (production readiness) — 2026-09-22

Owner's directive: no UI polishing, no new implementations of working systems, no
weakened tests, local commits only, nothing pushed, no hosted database touched, no
LIVE payment credentials, migration 027 stays local, and **STOP and ask** before any
new migration, financial correction, production change or security tradeoff.

### Done and verified (local only, NOT pushed)

- [x] **CH-08 — one validator for both telemetry transports** (`c1f3d1d`).
      `src/services/TelemetryValidator.js` is now the only place a driver position is
      judged; REST `POST /api/driver/location` and the `LOCATION_UPDATE` socket frame
      call it and report the same code, and the stored row takes the server's receive
      time rather than the device's. `chaos_audit.js` CH-08 passes: 0/4 impossible or
      stale fixes accepted, `COORDINATES_OUT_OF_RANGE` on both paths, no poisoned row.
- [x] **Auth fails closed when the authoritative store cannot answer**
      (`e994e44` + `31d0d62`). Six granting paths were wrong: an `ADMIN`/`SUPER_ADMIN`
      OTP resolved to `adminUsers[0]` (role taken from the request body, so any
      enrollable number became SUPER_ADMIN); `authoritativeRead`/`Write` now turn a
      PostgREST `error` and a rejected connection into 503 `AUTH_STORE_UNAVAILABLE`
      instead of reading "unreachable" as "no such row"; the audit trail is on the
      critical path (a login or dispatch that cannot be evidenced is refused and
      rolled back, `AUTH_AUDIT_STORE_UNAVAILABLE`); one `RuntimeMode.allowsTestConvenience()`
      gate keyed on `NODE_ENV` replaces six `NODE_ENV !== 'production' ||
      NABIN_TEST_MODE === 'true'` gates, so a stray flag can only narrow access;
      deactivation closes password login, OTP login and already-issued tokens; and
      password login re-reads `admin_accounts` through
      `authoritativeAdminByUsername()` before granting, so an account disabled in
      PostgreSQL stops signing in without a restart. Three `[DEBUG]` logs that printed
      the admin object — salt and password hash included — are gone.
- [x] **`backend/auth_failclosed_test.js`** is new and passes **15/0**: AUTH-00…06
      against real `admin_accounts` enrolment state, AUTH-10…14 with the account store
      or the audit store made to reject, AUTH-15…17 for the password gate.
- [x] **`restart_test.js`** no longer `sleep(3500)`-and-hope: it polls `/api/health`
      for up to 30 s and asserts the port actually bound (**35/0**).
- [x] **FI-08 documented, not corrected** —
      [`docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md`](docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md).
      3 jobs the pre-fix chaos runs over-posted by **₹31,058.00** (commission of
      ₹57.00 never recognised; books still balance because the error is symmetric;
      no wallet balance was inflated). No reversal/adjustment routine exists in
      `backend/src`, so a correction is new work that **modifies the financial
      record** — stopped at the document, per the directive.
- [x] **Campaign concurrency — directive item 8, "no lost updates or duplicate unique
      records"** (`ea4c146`: `backend/src/repositories/CampaignRepository.js`,
      `backend/src/server.js`, `backend/test_suite.js` MODULE 36 CC-00…CC-17,
      `admin-web/src/lib/api.ts`, `admin-web/src/app/campaigns/page.tsx`).
      A campaign save used to write the whole merged row back, so two operators on one
      campaign silently un-did each other. It now writes **only the columns the request
      named**, validates every section it touches **before** the first write (a refused
      field leaves the row byte-identical), and requires a **guard**: the row's own
      `updated_at` is the revision and goes into the UPDATE's WHERE clause, so a stale
      edit matches zero rows and is refused — **428** `CAMPAIGN_REVISION_REQUIRED` when
      no `If-Match` was sent, **412** `CAMPAIGN_STALE_EDIT` on a revision the row no
      longer holds, **409** `CAMPAIGN_STATE_CHANGED` when a state move is no longer the
      state it was offered from, **500** `CAMPAIGN_GUARD_REQUIRED` for an unguarded
      write from inside the code. One code, six simultaneous claims → exactly one 201
      and five 409 `CAMPAIGN_CODE_TAKEN`, translated from the 027 UNIQUE by
      `storeRejection()` so the schema's own wording never reaches a client. Reads
      distinguish **503** `CAMPAIGNS_UNAVAILABLE` from "no rows" (`settle()` /
      `isStoreUnreachable()`), so a banner whose query failed never publishes as "no
      banner", and a section that fails *after* the campaign row committed answers 500
      `CAMPAIGN_PARTIALLY_APPLIED` naming what did land instead of pretending nothing
      happened. A revision that is not an instant is refused **400**
      `CAMPAIGN_REVISION_INVALID` at the edge, because passing it down returned
      PostgreSQL's `invalid input syntax for type timestamp` (22007) — an infrastructure
      complaint wearing a validation error's clothes; `*` is refused for the same reason
      as in any compare-and-set. **The blocker the suite could not see was CORS:** the
      console's conditional write worked from Node and Flutter and failed only in a
      browser, because `If-Match` was missing from `Access-Control-Allow-Headers` and
      `ETag` from `Access-Control-Expose-Headers` — 400+ green assertions passed over
      it. CC-16/CC-17 now pin the preflight and the exposed validator, `request()`
      returns response headers (a contract can live in one), and fixture identifiers
      come from `fixtureSuffix()`: `POST /api/admin/promotions` **upserts on `code`**, so
      a colliding fixture id had silently overwritten a 2026-09-15 coupon, inherited its
      redemption history and reset `usage_count` — that, not the campaign code, is what
      made PROMO-04/05/08/09 red. The `gprod_5` revalidate assertion is fixed at the
      fixture (it asked for a chip packet PostgreSQL has never stocked; it now uses the
      two products that exist, and asserts per-line availability, price agreement and
      the ₹172 estimated total).

### Chain as run (solo, fresh backend carrying the suite's test webhook secret)

- [x] `auth_failclosed_test.js` **15/0** · `test_suite.js` **366/1 of 367** (the 1 is
      the pre-existing `gprod_5` revalidate gap that fails identically at `HEAD`) ·
      `restart_test.js` **35/0**.
- [x] `chaos_audit.js` with the database up: `PASS=16 FINDING=1 BLOCKED=3 NOTE=1
      FAIL=1` — the finding is CH-01b (50/100 accepts of an already-assigned job
      returned success though ownership never slipped), the fail is FI-08 above.
- [x] Re-run after the permission/reset pass (`a551dd6`), on a fresh backend (the
      broadcast cooldown is process-local, so a restart clears it):
      `test_suite.js` **388/1 of 389** (22 new RBAC assertions, all green; the 1 is
      still `gprod_5`), `restart_test.js` **35/0**, `auth_failclosed_test.js`
      **15/0**, `chaos_audit.js` unchanged at `PASS=16 FINDING=1 BLOCKED=3 NOTE=1
      FAIL=1`.
- [x] `CHAOS_DB_DOWN=1 node chaos_audit.js` against a stopped local `supabase_db_nabin`
      (restarted immediately after; the backend recovered unaided): `PASS=4 NOTE=2`.
      CH-10c/CH-10e now record auth **refusing** — `send-otp 503
      AUTH_AUDIT_STORE_UNAVAILABLE`, `admin login 503`, `verify-otp` issued no token —
      where they previously recorded a medium fail-open finding; CH-10f marks itself
      unexercised instead of passing on a session that no longer exists.

- [x] Re-run after the concurrency/CORS pass (`ea4c146`), same solo conditions:
      `test_suite.js` **408 PASSED / 0 FAILED of 408** — the suite is green end to end
      for the first time in this phase, because the 18 CC assertions are new (+18) and
      the chronic `gprod_5` failure is fixed (+1) — `restart_test.js` **35/0**,
      `auth_failclosed_test.js` **15/0**. `chaos_audit.js` has **not** been re-run since
      `ea4c146`.
- [x] The admin console driven in a browser against the local backend: create (the
      server's own validation words surface verbatim), a save on a superseded revision
      refused with the 412 message shown to the operator, the rival's write still intact
      afterwards, reload-and-re-apply succeeding and moving the revision, then archive —
      and `GET /api/app/config` serving none of it.

### Still open in this phase

- [x] **Admin mutations now carry their own permission check, and a credential
      reset reaches PostgreSQL** (`backend/src/server.js`,
      `backend/src/database.js`, `backend/test_suite.js` MODULE 35 — RBAC-01…12).
      Nine administrative writes asked only "is this an administrator?": a KYC
      Specialist's or Support Agent's token could create and delete advertisement
      campaigns, add/edit/remove master-catalogue products, expire orders, review a
      grocery price and take a driver offline. Each now names a permission
      (`advertisement.create/edit/delete`, `catalog.manage`, `orders.manage`,
      `grocery.review`, `fleet.manage`) and the guard runs **before** the handler, so
      a refusal cannot have written anything. Those keys belong to no role but
      SUPER_ADMIN, so the practical effect is control-plane writes are SUPER_ADMIN
      only — a deliberate narrowing: an operator who had been using one of those
      screens with a non-super account will now need a Super Admin session.
      `POST /api/admin/drivers/:id/status` was also registered **twice**; Express
      dispatches the first match, so the copy that carried
      `requirePermission('fleet.manage')` never ran — the guard was decorative.
      `resetAdminPassword` wrote the new hash into **only this process's memory**, so
      the next restart handed the old password back, and its response returned the
      whole account object including `salt` and `passwordHash`. It now writes
      `admin_accounts`, refuses an account the directory has no row for
      (`ADMIN_NOT_ENROLLED`, 409), restores the previous credential if the audit row
      cannot be written, answers with a projection that holds no secret, and reports
      actor and target apart in the trail. RBAC-09 proves durability by recomputing
      scrypt from the **PostgreSQL** row, not from memory.
- [x] **`/api/admin/master-catalog` writes are now PostgreSQL-durable** (`src/database.js`,
      `src/server.js`, `test_suite.js` MODULE 38 MC-01…07, `restart_test.js` 9c/6e). The
      five memory-only methods (`getMasterProducts`/`addMasterProduct`/`updateMasterProduct`/
      `deleteMasterProduct`/`getMasterProductStoreMatrix`) are now async and read-through/
      write-through to the migration-001 `master_grocery_catalog` table — the same store the
      merchant stock (`getMerchantInventory`) and public browse already read — with the
      in-memory `masterProducts` fixtures kept only as the development fallback. Fields map
      `masterName↔name`, `unit↔standard_unit`, `packSize↔pack_size`,
      `imageUrl↔standard_image_url`; a legacy `gprod_*` path id resolves to its UUID through
      the existing `resolveMasterProductId`, and an id the store has no row for (including a
      phantom memory `mp_101`) now 404s instead of silently editing memory. **A delete is a
      soft `is_active = false`, not a hard DELETE**, because `merchant_grocery_inventory.product_id`
      is `ON DELETE CASCADE` — a hard delete would destroy every store's stock line, and the
      browse/merchant surfaces already filter on the flag. The five admin routes are now
      awaited; the list read answers an outage as 503 via `replyStoreError`, and mutations
      keep the advertisement-route idiom (`err.status || 400/404`). The permission gate stays
      in middleware, so RBAC-01/02 are unchanged. **Known limitation:** `master_grocery_catalog`
      has no `sku`/`emoji`/`mrp`/`barcode` columns, so those memory-only extras do not persist
      in live mode (documented in code and here, not papered over with a fake value). No
      migration was needed; nothing was applied to any hosted database.
- [ ] **Error semantics (item 4).** 34 `this.createAuditLog(` call sites still fire and
      forget, 9 are awaited; the highest-stakes is `validateAuthoritativeJobOtp`, where
      a trip's state transition can be committed and its audit write dropped. An outage
      must read 5xx and a business rule 4xx, and never name the fault to the client in a
      way that distinguishes a missing row from a missing database.
      **Two clauses of this item are stale, re-counted 2026-09-24.** The call sites are
      now 36 total with 7 awaited (`createAuditLog` in `backend/src`), which is the same
      shape one step further along, so the item stays open. The **hardcoded default
      Razorpay webhook secret is gone**: `POST /api/payments/webhook` reads
      `process.env.PAYMENT_WEBHOOK_SECRET` with no fallback at all, and when it is unset
      it answers `503 WEBHOOK_NOT_CONFIGURED` — deliberately a 5xx, because a 4xx would
      tell the gateway its legitimate webhook was refused on the merits and a gateway
      that believes that stops retrying, which loses the payment record. The comment at
      that site also records why the previous guard was insufficient: it only refused
      when `NODE_ENV` was exactly `production`, so beta, staging and a local
      `npm start` all ran fail-open. What remains open here is the audit-write
      semantics, which is an owner-gated decision, not a sweep item.
- [ ] **The rest of the phase: the other six apps' campaign surfaces (directive items
      5–6), campaign assets (10), the public website (11), the offline/recovery matrix
      (12), env isolation and secret scan (13), financial invariant re-verification
      (14–15), and the A–O verification chain with the A–M report.** None started.
      Items 7–9 (security) and 8 (concurrency) are done — see above.
- [ ] **`POST /api/admin/promotions` upserts on `code`, so re-issuing a code silently
      resets `usage_count`** and inherits the previous row's redemption history. That is
      a coupon-issuance accounting hazard (a limited-use voucher comes back to life), and
      it is what turned this phase's PROMO-04/05/08/09 red before the fixture identifiers
      were made collision-free. **Reported, not fixed:** changing it to refuse a
      duplicate conflicts with `test_suite.js:270`, which re-creates the fixed code
      `FESTIVAL30` on every run and asserts 200, so a fix needs the owner's call on
      which of the two is the requirement.
- [x] **`GET /api/admin/promotions` returned at most 50 rows with no total and no
      search,** so on a local database that has accumulated 539 promotion rows an older
      coupon is simply invisible to the console — a list assertion cannot distinguish
      "not there" from "not on this page".
      **Closed 2026-09-24:** `PromotionRepository.list()` is now a real page. It takes
      `limit` (default 50, clamped 1…100), `offset` (clamped to ≥0) and a search term
      (`search` or `q`) matched against code, name and description, and answers
      `{promotions, total, limit, offset, hasMore}` where `total` counts the rows the
      filters matched, not the rows in the table, so a page states what it is a page of.
      Ordering gained `id` as a stable secondary key after `created_at desc`: two coupons
      created in the same instant could otherwise land in heap order, and `offset` paging
      across such a tie shows one row twice and hides another. The term is stripped of
      the characters PostgREST reads as filter syntax (`,` `(` `)` `|`) and of the
      multi-character wildcards (`%` `*`) before it is embedded in the `or(...)` filter;
      a single underscore is deliberately kept, because it still matches the literal
      underscore inside a real code like `SAVE40_ABC` and blanket-stripping it would make
      the console find nothing for a coupon that exists. A term that is *only* syntax
      answers zero rows rather than the whole table. **Finding from the new tests:** a
      range that starts past the last row is not an empty page — PostgreSQL answers
      `416 Requested range not satisfiable`, which the route was turning into a 500, so
      `PL-04` failed with `total=undefined`. The boundary is now established first with a
      head count under the same filters, `offset >= total` short-circuits to an empty
      page, and the requested range is clamped. Covered by `test_suite.js` MODULE 40
      (PL-00…PL-10 + PL-TEARDOWN, 12 checks, run-scoped random prefix, fixtures reaped
      from PostgreSQL at the end); the in-memory fallback mirrors the same semantics.
      Red-green proven in isolation: with the repository reverted to `HEAD` and the route
      shape restored, the 11 paging assertions PL-01…PL-10 + PL-TEARDOWN all fail while
      PL-00 (creation, which does not read the page) and PROMO-01…13 stay green.
- [x] **The campaign outage branch has no test.** `CAMPAIGNS_UNAVAILABLE` → 503 is
      reachable only when PostgreSQL refuses, and authentication then fails closed
      first, so no admin token exists to make the request. Verified by reading the code
      and by the `CHAOS_DB_DOWN=1` audit, not by an assertion.
      **Closed 2026-09-24:** `backend/campaign_outage_test.js` (CAMP-01…05, 5/0) exercises
      the repository directly from a child process pointed at a closed port, so the branch
      is now proven by assertion rather than by reading: `listCampaigns`, `getCampaign` and
      `liveCampaigns` all throw `CAMPAIGNS_UNAVAILABLE`/503 when the store refuses, and both
      reads return `null` (the route's 503 branch, never a real empty list) when PostgreSQL
      is not the configured store at all. Sensitivity-checked: swallowing `settle()`'s store
      rejection turns CAMP-01/02/03 red and the two not-live controls stay green. Part of the
      `npm test` chain and `npm run test:outage`.
- [x] **`Idempotency-Key` is not in `Access-Control-Allow-Headers`** (only the
      `X-Idempotency-Key` spelling is), so a browser client cannot send it. No browser
      surface sends one today, so nothing is broken; it is a trap for the next one.
      **Closed 2026-09-24:** the canonical spelling joins the list in `src/server.js`.
      It was not cosmetic: six routes read `req.headers['idempotency-key']` **first**
      and only then the `x-` spelling — ride and parcel booking, grocery checkout, offer
      acceptance, food ordering, coupon redemption — and the ledger and dispatch
      procedures deduplicate on the value it carries, so a browser asking for the
      documented header failed its own preflight and a client that retried without it
      could double-book. A preflight probe confirmed the defect before the fix and the
      grant after it. Covered by `test_suite.js` MODULE 39 (CORS-01…05): the booking
      preflight is granted `idempotency-key`, every header allowed before is still
      allowed, an unrelated header is still refused — the list is a policy, not an echo
      of the request — a second idempotent route gets the same grant, and an unknown
      origin is still blocked, so widening headers did not widen origins. Red-green
      proven in isolation: with only the header removed, CORS-01 and CORS-04 fail and
      CORS-02/03/05 plus every paging check stay green.
- [ ] **Local fixture rows accumulate and nothing reaps them** — 539 promotions, 45
      campaigns, 13 orphan "Test Basmati Rice" catalogue rows from earlier sessions.
      Every one is a test fixture on the local Docker database, created by harnesses
      rather than by a customer; they are listed as hygiene, and deleting financial rows
      is not something a test run should do unasked.
- [x] **`test_phase7_security.js` is not part of this chain and is red** (36/9),
      including an assertion against a route that no longer exists. Repairing it is its
      own piece of work and must not be done by loosening it.
      **Closed 2026-09-24 — and the note was wrong on both counts.** Run fresh, the
      suite answers **45 PASSED / 0 FAILED**, and it does so with the file exactly as
      committed: `git status` shows no working change to `test_phase7_security.js`, so
      no assertion was touched here either to obtain that result or to keep it. The
      "assertion against a route that no longer exists" is not in the file — it calls
      the live `/api/customer/book-ride` in both places that book a ride. Either an
      earlier commit repaired it or the note mis-described it; which of the two is not
      worth more digging, because the observable state is a green suite. What was
      genuinely missing is **enforcement**: `npm test` ran eleven suites and this was
      not one of them, and CI runs only `test_suite.js`, `restart_test.js` and
      `smoke_test.js`, so 45 live security assertions (admin-token boundaries,
      driver-earnings privacy, ride ownership and cancellation, KYC and media-asset
      authorization, RLS on every public table, `search_path` on every
      `SECURITY DEFINER` function, financial RPCs revoked from `anon`, production OTP
      never leaking `testOtp`, the cancellation race) could go red without any command
      the project runs noticing. The suite is now the twelfth link of the chain, with a
      `npm run test:security` script for solo use. Two things had to be proven before
      wiring it in, and both were:
      **it bites** — temporarily disabling the media-asset ownership guard in
      `server.js` reddens exactly that assertion, 44/1 with exit code 1, so `&&` aborts
      the chain (the guard was then restored and the marker verified gone); and **it is
      neutral** — it resets the Super Admin credential to the value every suite logs in
      with, so two consecutive full-chain runs were executed and both came back
      **767 checks, 0 failures, exit 0** (444 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 +
      8 + 5 + 45). Its `ensureServerRunning()` reuses the healthy server, so it adds no
      port conflict to the chain.
- [x] No admin **deactivation route** exists at all — `is_active` can only be flipped
      in the database, which is the path the new gate now defends.
      **Closed, and the note was stale (verified 2026-09-24):** the route exists at
      `POST /api/admin/accounts/:id/status`, gated by
      `requirePermission('admin_accounts.manage')`, and it is the complete shape rather
      than a stub. A non-boolean `isActive` is refused with
      `ADMIN_STATUS_VALUE_REQUIRED` — "an account is never left in a state this request
      did not name" — `role` is deliberately not accepted here, the write is durable
      through `db.setAdminAccountStatus`, and disabling an account also ends its live
      sessions, including the actor's own if they signed themselves out
      (`dropLocalAdminSessionsForAccount`), because the in-process admin map is a second
      copy that would otherwise keep honouring the bearer this very response had just
      revoked. `authenticateAdmin` re-reads the enrollment on every request and answers a
      stale bearer as `ADMIN_ACCOUNT_DEACTIVATED`, so a token cannot outlive the account
      it was issued to; a store failure keeps its 5xx rather than reporting a save. The
      route is exercised by `admin_identity_gates_test.js`, `admin_customers_test.js` and
      the revocation checks in `admin_authorization_test.js`, and all three of those
      suites now run in `npm test` — before today none of them ran anywhere, which is the
      likeliest reason the record said the route did not exist.
- [x] `test_phase7_security.js` (45 assertions) fails 36/9 for a stale reason: it
      probes `POST /api/ride/book`, a route that does not exist (the live one is
      `/api/customer/book-ride`). Dead coverage, recorded rather than rewritten
      mid-phase.
      **Superseded by the entry above, and factually corrected 2026-09-24:** the file
      does not contain `/api/ride/book` — both ride-booking probes already use
      `/api/customer/book-ride` (lines 242 and 532), and the suite is 45/0 green. This
      duplicate record was the more misleading of the two, because it named a specific
      defect that a reader would go looking for and never find; a red note that is
      really a green suite also costs the opposite way, in that nobody re-checks the
      coverage it claims is dead.
- [x] `authenticateAdmin` permissions are a login-time snapshot; `getAdminAccounts()`
      still fabricates a display phone for accounts without one.
      **Verified 2026-09-24 — one half fixed, the other answered by a different design.**
      The invented phone is gone: the read answers `phone: a.phone || null`, and
      `test_suite.js` RBAC-17 asserts that every phone-less administrator is reported as
      having no phone, so it cannot quietly come back — which matters because a shared
      placeholder is not merely misleading on screen, it describes two accounts that the
      OTP path would then refuse as ambiguous. The permission snapshot is real, but it is
      not reachable by an operator action: there is **no route that edits an
      administrator's role or permissions in place** — provisioning, status, credential
      reset and session revocation exist, an in-place privilege edit does not — so the
      only way the store's grants can differ from a live token is a direct database
      change, and the shipped answer to that is
      `POST /api/admin/security/sessions/revoke`, which cuts one session or every session
      of an account across the store, memory and this process's admin map and is audited
      with an awaited write. Turning the snapshot into a per-request permission read on
      every admin route is a design change with a cost attached, not a defect to close
      quietly, so it is recorded here as *answered by revocation* instead of left listed
      as unfinished.
- [x] **415 security assertions were green and running nowhere.** `test_phase7_security.js`
      (45) plus the five `admin_*_test.js` suites — `admin_identity_gates_test.js` (64),
      `admin_authorization_test.js` (113), `admin_customers_test.js` (83),
      `admin_settings_surface_test.js` (31), `admin_audit_fail_closed_test.js` (79) —
      appeared in no `npm` script and no CI step, so each could go red without any command
      the project runs noticing. All six were executed fresh on 2026-09-24 and **all six
      were already green**; nothing was repaired, only wired. Two properties were checked
      per file before arming, rather than assumed: a failure ends the process with a
      non-zero code (`process.exit(failed.length ? 1 : 0)`, or
      `process.exitCode = 1`), so `&&` genuinely gates the chain; and the only rows the
      suites delete are the fixtures they insert, so joining a chain cannot destroy
      anything. **Load-bearing proof:** removing
      `requirePermission('admin_accounts.manage')` from `GET /api/admin/accounts` — the
      route that lists the entire control plane — reddened `admin_authorization_test.js`
      **CAT-04**, the ratchet that counts admin routes carrying no permission check (18
      against a ceiling of 17), and the chained run stopped there with exit code 1. The
      gate was restored, the `SENSITIVITY` marker scan returned zero hits, and
      `git diff --stat` for `src/server.js` came back at the same 72 insertions / 19
      deletions it held before the probe. Two consecutive full chains with all seventeen
      links then ran: **1137 checks, 0 failures, exit 0 each time** (444 + 26 + 20 + 55 +
      60 + 44 + 40 + 15 + 5 + 8 + 5 + 45 + 64 + 113 + 83 + 31 + 79).
      `npm run test:security` and `npm run test:admin` exist for solo use.
      **A harness precondition this surfaced, worth keeping:** `test_suite.js` signs
      payment webhooks with `PAYMENT_WEBHOOK_SECRET`, defaulting to its own test value
      *inside its own process* — so a backend already listening on `:4000` must have been
      started with the matching `PAYMENT_WEBHOOK_SECRET` and `PAYMENT_KEY_SECRET`. A
      server started without them fails MODULE 18 closed with two 503
      `WEBHOOK_NOT_CONFIGURED` answers and knocks on to the notification broadcast checks.
      That is a misconfigured harness, not a product regression: the route is refusing to
      verify money against a key it does not have, which is the behavior the
      no-default-secret decision requires.

- [x] **The customer app was showing trips nobody took.** `features/activity/`
      rendered a `const` list — "Auto Ride to Connaught Place", `FOOD-294711`,
      "Instant Parcel to Karol Bagh" — with its own filter chips (All/Rides/Food/Parcels,
      no Instamart), and its receipt sheet asserted `Payment Mode: NABIN Wallet (Instant
      Settlement)` for every entry regardless of what was actually paid. No request was
      ever made, so a real customer opening their own history saw fabricated orders and
      invented prices. This is the "fake UI that does not connect to the backend" class of
      defect, and it is worse than cosmetic because the screen is where a customer checks
      what they spent.
      **Fix, as one vertical slice.** `GET /api/customer/activity` now merges the two
      authoritative stores into one feed: rides and parcels from `jobs`, food and
      Instamart from `orders`. Identity comes only from the bearer token
      (`resolveUserUuid(req.user.uuid || req.user.id)`), so there is no customer id on the
      request to tamper with. `JobRepository.getJobsByCustomer` reads through
      `settleStore`, so an unreachable PostgreSQL is a 503 rather than an empty list —
      "you have no history" and "we could not read it" stay different answers, and the
      screen renders the second as a retryable failure instead of an empty state.
      **No double counting:** `jobs.service_type` covers all four services, so every food
      and grocery order also owns a delivery job; the new reader selects only
      `RIDE`/`PARCEL`, and ACT-13 proves a delivery leg never surfaces as its own item.
      `ActivityScreen` was rebuilt against the endpoint with loading, error+retry and
      genuinely-empty states, an Instamart filter, and an **In progress** section.
      `customer_activity_test.js` (ACT-01…20, 20/0) cross-checks each returned id back to
      PostgreSQL rather than to another API response, and asserts amount parity to the
      paisa. **Load-bearing proof:** replacing the ownership filter with
      `.not('customer_id','is',null)` reddened exactly the two security assertions —
      ACT-08 named the foreign owners (`29b8e041-…`, `53d101a0-…`) and ACT-19 showed both
      feeds sharing 49 rows — with exit code 1 while the other 18 held. Reverted, zero
      `SENSITIVITY` markers. `dart analyze` on the two touched Dart paths: **No issues
      found**. Now the eighteenth link of `npm test`; the full chain is
      **1157 checks, 0 failures, exit 0** (444 + 26 + 20 + 55 + 60 + 44 + 40 + 15 + 5 + 8
      + 5 + 45 + 64 + 113 + 83 + 31 + 79 + 20).

- [ ] **`bootstrap_test.js` must not be chained, and should not be run blind.** It is the
      only file in the backend that issues an unqualified table wipe:
      `admin_accounts.delete().neq('id', '00000000-…')` deletes **every admin account**,
      and it `fs.unlinkSync`s `backend/data/store.json` on the way in. Nothing in
      `package.json` or CI names it, which is the only reason that has not done damage.
      It is also chain-hostile for a second reason — it spawns its own server on
      `PORT: 4000` with `ADMIN_BOOTSTRAP_SECRET: 'test-secret'`, polls health for at most
      4 seconds (shorter than a cold hydration), and `proc.kill()`s in `finally`, so on
      2026-09-24 it left the shared backend with no listener at all and reported one
      failure that was `ECONNREFUSED`, not a product defect. Running it while `.env`
      pointed at a hosted project would delete that project's admins. **Left for an owner
      decision** — repairing it means deciding whether a bootstrap test may clear the
      shared admin table at all, and neither deleting nor weakening it is authorized.

- [ ] **The local store is full of operations that never finish.** The new feed reported
      **81 of its first 100 items as in-flight** for one fixture customer (the count moves
      a little between runs because the suites themselves create and settle rows — it read
      85 earlier the same day), and that turned out to be *accurate*, not a classification
      bug. Measured straight from PostgreSQL with `pg`: `jobs` holds SEARCHING 1158,
      COMPLETED 860, CANCELLED 470, ASSIGNED 72 (2560 rows across 20 distinct
      customers), and `orders` holds RECEIVED 1314, CANCELLED 35, REJECTED 34,
      READY_FOR_PICKUP 33, ACCEPTED 1 (1417 rows across 15 customers). Two-thirds of all
      jobs and 93% of all orders are in a state that can never be reached by a real
      customer abandoning a search or a kitchen never accepting an order — **nothing
      expires them**. A second local-data fact explains why one customer's feed carries
      the whole table: `00000000-0000-0000-0000-000000000002` (the `+919845011982`
      fixture) owns **2513 of the 2560 jobs**; the next largest owner has 29. So this is
      seeding plus a missing lifecycle rule, not a defect in the endpoint. Three separate
      questions follow, all owner-level: whether the platform should reap stale
      `SEARCHING`/`ASSIGNED` jobs and `RECEIVED` orders (destructive, and `orders` rows
      are immutable financial records), whether the feed should age or cap `active`, and
      whether seed data should be re-spread across fixture customers. Not papered over
      with an arbitrary filter here.

- [x] **A driver's earnings were process-local, so a restart made money they had earned
      read as zero.** `todayEarnings`/`todayTrips`/`weeklyEarnings`/`monthlyEarnings` were
      in-memory counters that `database.js` boot hydration hard-coded to `0`/`0.0` while
      `wallet_balance` was restored from PostgreSQL — so the wallet survived a restart and
      the earnings next to it did not. Fixed by deriving every figure from the durable
      `jobs` rows: `JobRepository.getDriverCompletedRows()` walks `driver_id` +
      `status='COMPLETED'` through `readAllRows` (id-cursor paging with a completeness
      check, because `max_rows = 1000` truncates silently — measured live, an unpaginated
      read of this driver returned exactly 1000 rows and 748 COMPLETED against a true 860),
      and one shared `buildDriverEarningsPayload()` now backs both `GET /api/driver/earnings`
      and `GET /api/driver/:driverId/earnings`. Identity comes from the bearer token only.
      An unreadable or unfinished ledger is a 503 `STORE_UNAVAILABLE`, never a zero, and a
      read that returns a trip belonging to somebody else throws
      `EARNINGS_SCOPE_VIOLATION` rather than silently dropping it — dropping would
      under-report what a driver is owed. `cashCollectedToday`/`onlinePaidToday` are `null`
      on purpose: every COMPLETED job still carries `payment_status = 'PENDING'`, so the
      platform does not know how the fare was collected, and `0` would be a claim.
      `driver_earnings_test.js` (29 checks, chain link 19) re-adds the totals independently
      using `range()` paging so a broken cursor walk cannot agree with itself. Four
      mutations each broke exactly the intended assertion: dropping the COMPLETED filter
      inflated 30-day pay by ₹26,653 and leaked two foreign job numbers (EARN-16);
      restoring the process-local counters reproduced the original ₹0-after-restart defect
      (EARN-09/10); swallowing an incomplete read failed EARN-27; removing the mismatch
      guard failed EARN-20.
      **Verification hazard found and corrected while doing this:** an earlier "29 PASSED"
      run was answered by a listener started *before* the last two edits, because the
      restart had died with `EADDRINUSE` while the request still returned 200. That claim
      was declared void and every result above was re-proven against a port the test host
      had bound-and-released itself, on a child process whose own stdout printed the listen
      line, with `/api/health` confirmed 200 before the first assertion.

- [x] **The real driver app had no backend at all — its login and money now come from the
      platform.** Measured before the fix: no driver screen referenced `NabinApiService`,
      and the four driver methods the client did expose (`toggleDriverOnline`, `acceptJob`,
      `verifyTripOtp`, `getDriverEarnings`) were referenced from nowhere in `lib/` — dead
      methods beside a live backend. The consequences were not cosmetic:
      `driver_otp_screen.dart` "verified" a partner with `Future.delayed(600ms)` followed by
      `context.go('/home')`, so **any tap on Verify logged anybody in as a driver with no
      credential sent, no response read and no token stored**, while `driver_login_screen.dart`
      prefilled `9876543210` and `driver_router.dart` defaulted the OTP target to the same
      invented number. `driver_earnings_screen.dart` was 100% literals: `₹1,420.00`,
      `₹9,850.00`, `₹38,400.00`, a payout address `rajesh.driver@okhdfcbank` that exists in
      no table, a "NABIN Platform Fee (10%)" row where the platform's own settlement rule is
      15% (`JobRepository.js:181`; the stored rows show fare 105 / earnings 89 / commission
      16), three fabricated trips, and a Withdraw button whose entire effect was a snack bar
      announcing a settlement that never happened.
      **Wired in this slice (login + money surface).** Login sends a real
      `POST /api/auth/send-otp` with `role: 'DRIVER'`; the OTP screen performs a real
      `POST /api/auth/verify-otp` and saves the session **only if the server issued a
      token** — a `success` without one is reported as the failure it is instead of
      navigating on; the prefilled code, the "Demo code: 7729" label and the dead
      `onPressed: () {}` resend are gone, replaced by a working resend behind a real 30s
      countdown. `driver_earnings_screen.dart` renders `GET /api/driver/earnings` with
      loading / error-retry / empty states, distinguishes a ledger outage from "no trips",
      shows the wallet as the period-independent figure it is, prints the commission the
      platform actually took per trip, says "Not reported yet" where the server says
      `null`, and takes the payout destination from the server instead of inventing one.
      Withdraw calls the real `POST /api/driver/payout` and repeats the platform's answer,
      and when the platform will not allow a payout the screen shows the reason as words
      (KYC, unverified address, cooling window, nothing to withdraw) rather than a disabled
      button with a dead handler. `driver_router.dart` now refuses to render the console,
      the ledger or the account page to an unauthenticated session.
      `acceptJob`'s `driverId = 'drv_1'` default — a fabricated identity in every request
      that omitted it — is gone; identity is the token's.
      **Proven live, moving no money:** a 17-check contract probe against a host-spawned
      server confirmed every field the Dart parser reads exists with the type it assumes
      (including that `walletBalance` is numeric, so the client errors rather than drawing
      ₹0), that `cashCollectedToday` really is `null`, and that an overdraw is refused with
      `PAYOUT_DESTINATION_COOLING_ACTIVE` while the balance stays ₹1111 → ₹1111.
      `dart analyze` on the five changed files: no issues found.
      **Still open in the driver app, recorded rather than silently half-done:**
      `driver_home_screen.dart`, `driver_account_screen.dart` and
      `active_job_execution_screen.dart` still contain **zero** `NabinApiService`
      references — the online toggle, live job offers, accept/reject, trip OTP and complete
      flow remain unwired, **which the next item closes**, and it needed the dispatch surface
      (`GET /api/driver/.../dashboard`, `/offers`, `/accept-job`, `/complete-trip`)
      inspected first. Separately, `features/driver/presentation/screens/driver_app_shell.dart`
      is not the driver app at all: the customer super-app routes it at
      `/driver-dashboard` under "Partner Mode Simulators", and it carries the seeded
      `_walletBalance = 1420.0` / `_todayEarnings = 1420.0`, the Dart-side
      `commission = fare * 0.1`, the prefilled `'7729'`, and a withdraw that sets the
      displayed balance to `0` in `setState`. Deleting a route the owner may still want as a
      demo is a product decision, so it is flagged here, not removed.
      **§10 answer, established after this note was written:** that route is **not** obsolete.
      Two live customer surfaces link to it — `customer_home_screen.dart`'s "Driver Mode"
      button and `profile_screen.dart`'s "Switch to Driver Partner Mode / Go online, accept
      rides, food & parcel deliveries" tile — so it is presented to end users as a feature,
      while "Simulator" appears only in a router comment. It is therefore category **B**
      (intentional customer-facing) built as a fabrication, and it now duplicates the real
      standalone driver app (`main_driver.dart` → `driverRouter`), which has genuine login,
      earnings, offers and trip execution behind it. Consolidating them is **not** mechanically
      possible without a product decision: the partner screens require a `DRIVER`-role token,
      and a customer session inside the super app does not have one, so "Driver Mode" cannot
      simply render the real screens for the person already holding the phone. The three
      options for the owner are (a) drop the entry points and ship the separate driver app
      only, (b) keep the entry points and make them a signed-in driver hand-off, or (c) keep a
      demo and label it explicitly as demo data on screen. Left untouched pending that choice.

- [x] **`mobile/build/reports/problems/problems-report.html` — diagnosed, and there is nothing
      in this repo to fix.** A Gradle *problems report* was found and read as if it were a build
      failure. It is not. Parsed the embedded `// begin-report-data` JSON: **23 diagnostics,
      every one `severity: WARNING`, zero errors** (the stale 2026-09-22 copy held 21 with
      `requestedTasks: ""`, i.e. a configuration-only run, and no APK was present).
      **Reproduced with a real build** — `flutter build apk --debug` on Flutter 3.47.2 / Dart
      3.13.2 / Gradle 9.7.0 / AGP 9.1.0 finished in 166.7s with exit 0 and produced
      `build\app\outputs\flutter-apk\app-debug.apk` (161,270,003 bytes). That build also had to
      **install Android SDK Platform 35 and CMake 3.22.1**, which were absent — the likely reason
      the earlier attempt produced a report and no APK.
      **Ownership, proven not assumed.** A scan of every diagnostic's `locations` for any path
      inside `documents/nabin` returned **0 matches**. The only file paths in the whole report sit
      in the global Pub cache (`jni-1.0.3`, `jni_flutter-1.0.2` `android/build.gradle`,
      `shared_preferences_android-2.4.28` `SharedPreferencesPlugin.kt:450`); everything else is a
      `pluginId` or task owned by upstream — `com.android.internal.application` /
      `com.android.internal.library` (Project-as-dependency-notation), the
      `dev.flutter.flutter-gradle-plugin` and its `:app:compileFlutterBuildDebug` task
      (execution-time `Task.project`), `kotlin-android`, and one Kotlin compiler lint in a plugin.
      The three classes are: 9× Project-object dependency notation ("will fail in Gradle 10"),
      7× Groovy space-assignment (`group 'x'` → `group = 'x'`), 5×
      `org.jetbrains.kotlin.android` "no longer required since AGP 9.0", plus 2 new in the full
      build. **None is ours.**
      **Rejected temptation, on evidence:** the 5× "deprecated kotlin-android plugin" reads like a
      cleanup, but `android/app/src/main/kotlin/com/nabin/mobile/MainActivity.kt` **exists**, and
      `android/gradle.properties` deliberately carries `android.builtInKotlin=false` with
      `android.newDsl=false` — the current Flutter template stance. Removing the plugin would
      break Kotlin compilation to silence a warning, so the file was left alone. Editing the
      Pub-cache `build.gradle` files is also refused: outside the repository, erased by the next
      `flutter pub get`, and a symptom patch.
      **What would actually clear them:** upstream version movement, not code edits — a newer
      Flutter point release (owns the flutter-gradle-plugin and `compileFlutterBuildDebug`
      deprecations and the AGP it pins), and `flutter pub upgrade` for the transitive
      `jni`/`jni_flutter`/`shared_preferences_android` packages (they are `dependency:
      transitive`, never chosen in `pubspec.yaml`). Both are whole-toolchain moves and were not
      taken unilaterally: this build is now green and the deadline prefers real defects over
      warning cosmetic. Note the incidental value here — that APK build is the first
      **end-to-end compile of the driver and merchant screen rewrites**, beyond `dart analyze`.

- [x] **Merchant audit: the two web consoles are honest; the Flutter restaurant app is not.**
      First determining what exists, because the target architecture (NABIN MERCHANT on
      Android + NABIN MERCHANT PORTAL on Web/Desktop) is not what the repo is named to suggest.
      **What exists:** `restaurant-merchant-web` and `grocery-merchant-web` are two small Next.js
      consoles (4 routes each, ~2,200 lines). Audited for every fabrication class — mock/dummy/
      demo data, `setTimeout` pretending to be a call, hardcoded prices, hardcoded merchant
      identity, fake auth, fake logout: **zero matches in either**, and they are genuinely
      axios-backed against `/api/merchant/*` with real OTP auth (`role: 'MERCHANT'`). One of
      them even labels its own weakness: the dashboard prints "Totals cover every food order
      stored for this merchant. The backend has no date filter on this endpoint yet, so this is
      not a calendar-day figure" instead of dressing an all-time sum up as today's sales.
      **These are today's portal; they are not the portal the architecture wants, and they are
      not fabrications — so nothing was rewritten here.**
      The Merchant **app** already exists as Flutter entrypoints in the same package as the
      customer and driver apps: `main_restaurant.dart` → `restaurantRouter`, and
      `main_grocery_merchant.dart` → `groceryMerchantRouter` (alongside `main.dart`,
      `main_customer`, `main_driver`, `main_admin`, `main_grocery` — seven entrypoints, one
      package, no `apps/` + `packages/` split). So the §7 workspace restructure is a real gap,
      but it is packaging, not missing capability.
      **Fixed in the Flutter restaurant app.** `restaurant_otp_screen.dart` printed
      **`Demo OTP: 7729`** on the merchant-facing UI and its "Resend Code" was
      `onPressed: () {}` — dead for a store whose code had just expired. The label is gone and
      the resend is real, behind a working 30-second countdown (`dart:async` timer, cancelled in
      `dispose`). `restaurantRouter` had **no authentication gate**: `/dashboard` — the console
      holding one named store's orders, menu and money — was reachable on a cold start with no
      bearer token, and it defaulted the OTP target to the invented `9876543210`; both fixed the
      way the driver router was. `restaurant_registration_screen.dart` prefilled **nine**
      fields with a complete invented business identity — restaurant name, address, owner
      "Vikram Sethi", FSSAI `1002001928491`, GSTIN `07AAGCD1294F1Z8`, bank account
      `50200049281092`, IFSC `HDFC0001092`, UPI `dillidarbar@okhdfcbank` — all now empty.
      Verification: `dart analyze` no issues on all three files, `flutter test` **60/60 still
      passing**.
      **Found and NOT fixed — these need decisions or room, not a quiet edit.**
      1. `restaurant_main_shell.dart` — the **live, API-backed** restaurant console — renders
         `Text('Dilli Darbar Mughlai Kitchen')` and
         `Text('FSSAI: 1002001928491 • Verified Partner')` inside a `const Row` on its Profile
         tab (L1094-1095), i.e. unconditionally, not as a loading fallback. Whichever store
         signs in — `Dilli Darbar Authentic Mughlai`, `Test Bistro M1`, a grocery store — is
         presented to itself as a different business holding an FSSAI licence it never filed and
         a "Verified Partner" status the platform did not grant. Two further
         `onPressed: () {}` controls sit at L814 and L1137. This is a fabricated compliance
         claim on a shipping surface and the highest-priority merchant item remaining.
      2. `restaurant_app_shell.dart` is the customer super-app's `/restaurant-dashboard`
         "Partner Mode Simulator", and it is the same defect class as the driver one, with an
         order-state lie added: `setState(() => order['status'] = 'PREPARING')` and
         `'READY'` (**local-only order state**), `setState(() => dish['inStock'] = val)`,
         `_isStoreOpen` in Dart, and `Text('₹28,450')` as earnings. Same owner decision as
         driver `/driver-dashboard`, and it should be decided once for both.
      3. **There is no merchant onboarding API at all** — no register/onboard/apply route
         anywhere in `backend/src`. So the registration screen above cannot be wired honestly
         without building the feature, and `_nextStep()` currently advances to an "Approval
         Status" step and navigates on, having submitted nothing.
      4. **Merchant security has no test coverage whatsoever.** Across every suite, exactly one
         *dormant* file logs in as `MERCHANT`, and greps for merchant-ownership/IDOR assertions
         return **zero** live checks. The code itself looks right on inspection —
         `authenticateMerchant` refuses a request with no token and requires `role MERCHANT`, and
         both order routes carry `requireMerchantTenant` plus an explicit
         `requestedMerchant.id !== merchant.id` refusal — but "looks right" is not evidence, and
         §4/§8/§9/§14 (cross-tenant orders/inventory/payouts/documents, concurrent accept,
         price and stock tampering) are unproven for merchant. A `merchant_operations_test.js`
         with real fixtures is the next piece of work: `…000201` "Dilli Darbar Authentic
         Mughlai" `+919811223344` holds 950 orders, `2699ade3-…` "Test Bistro M1"
         `+919871133479` holds its own, so two genuinely distinct tenants exist to test with.
      5. `database.js:5867` — merchant OTP login with no matching store **throws in production
         but silently assigns `this.restaurants[0]` everywhere else**, so in dev any verified
         phone becomes the first seeded merchant, with that merchant's orders and wallet. The
         media upload route has the sibling shape (`/api/merchant/:id/media` authenticates
         inline and, with no token, is refused only in production, then takes `restaurantId`
         **from the request body**, defaulting to `rest_1`). Both are `allowsTestConvenience`
         gated, so production is covered; they are listed here because the driver-style
         hardening (explicit opt-in, loud log, refuse by default) is the obvious next security
         task and it is entangled with fixtures many tests rely on.
   
- [x] **Merchant tenant isolation proved with real requests — and it found four authorisation
         holes, all now fixed.** `backend/merchant_operations_test.js` is chain link 21: two real
         TEST/local merchants (`…000201` Dilli Darbar Authentic Mughlai +919811223344, and
         `2699ade3-…` Test Bistro M1 +9871133479), no invented identities, and every claim checked
         against PostgreSQL rows rather than response bodies. **53 checks PASSED / 0 FAILED / 0
         SKIPPED standalone; in-chain 39/0 with the order group self-skipping** (see the OTP
         lockout note below). Proven: no merchant read reachable anonymously (401 on three routes);
         a customer token and a driver token both refused on the merchant queue (403); A sees only
         A's orders and B only B's, with each served list cross-checked row-by-row against
         `merchant_id`; **five separate IDOR vectors** on one of B's stored orders — path
         `restaurantId`, bare `orderId`, `merchantId`/`restaurantId` in the **body**, the same in the
         **query**, and both combined — each refused 403, and `MCI-10` then read the row back and
         proved it **byte-identical**; the mirror direction from B onto A likewise. Catalogue reads
         never surface the other store's product ids.
         **Four real vulnerabilities fixed, each found by a test that failed first.**
         1. **`POST /api/grocery/products/:id/photo` and its `/api/admin/...` alias had no
            authentication of any kind.** Unauthenticated callers got **200**: the route wrote to
            Cloudinary under the platform's credentials, overwrote any product's image by id, and
            when given an unknown id **pushed a fabricated "Grocery Product Item" into the
            catalogue** — an anonymous request could therefore create products. It now requires a
            merchant-or-admin session, resolves the product and refuses a cross-merchant
            `merchant_id` (403), and refuses an unknown product (404) instead of inventing one
            (MCMD-01, 02, 03, 07).
         2. **`/api/merchant/:restaurantId/media` and `/api/merchant/menu/:itemId/photo` let a
            request with no token proceed outside production** and then took the destination from
            the **body**, defaulting to `rest_1`. A token is now mandatory on all three media
            routes through one shared resolver, and the target store must resolve back to the
            caller's own identity (admins may act for a named store, which must still exist).
            Proven by MCMD-04/06, which previously measured 200/400 instead of 401.
         3. **The menu availability guard only ran `if (rest.merchantId)`**, so an unowned store —
            exactly seeded `rest_1` — had no check at all. `MUT-M3` demonstrated the hole rather
            than arguing about it: with the guard reverted, merchant B received **`200` and
            `{"id":"m1", … "inStock":false}`**, i.e. it really took another store's biryani out of
            stock. Ownership is now resolved through the same `resolveMerchant` the order reads use,
            so it must be positively established (MCS-01/02).
         4. **The merchant order-status route ignored the canonical `Idempotency-Key` header.**
            `_transition_order_state_internal` deduplicates *before* validating (confirmed against
            the deployed function, positions 1102 vs 1845) and returns `duplicate: true`, but the
            route read only `req.body.idempotencyKey`, so a client sending the documented header —
            the spelling the CORS allow-list already grants — got `400 INVALID_TRANSITION` on a
            retry instead of the duplicate it was. Both spellings are now accepted (MCO-09).
         **Concurrency and financial safety.** Two simultaneous `ACCEPTED` submissions on one order
         produce at most one effective transition (`Promise.all`, MCO-07) and the stored state is
         exactly `ACCEPTED` once (MCO-08); `total_amount` is untouched throughout (MCO-10); a
         non-owner is refused *before* the transition runs and the row is still `RECEIVED`
         afterwards (MCO-05/06); `RECEIVED → READY_FOR_PICKUP` is refused by the state machine, as
         is `DELIVERED` (not in the KDS vocabulary) and a `REJECTED` without an approved reason;
         the owner can still walk `ACCEPTED → PREPARING → READY_FOR_PICKUP`, confirmed in
         PostgreSQL (MCO-11/12).
         **Red-green evidence, with one guard proven redundant in the good sense.** `MUT-M1`
         removed the route-level order ownership check and **six** checks went red — and note what
         they went red *with*: `400 FORBIDDEN_ACTOR` from the PostgreSQL function, not a successful
         mutation, and `MCI-10`'s row stayed byte-identical. So tenant isolation for order mutation
         is enforced in two independent layers, and the route guard is what makes the HTTP contract
         correct rather than merely safe. `MUT-M2` restored the anonymous media bypass (two checks
         red), `MUT-M3` the unowned-store menu hole (one red, shown above), `MUT-M4` the ignored
         header (one red). All four reverted; the mutation-marker sweep over `src/` is clean.
         **Production isolation proven, not assumed.** `MCY-01` runs a child with
         `NODE_ENV=production` and `NABIN_TEST_MODE=true` and asserts that an unregistered number
         **cannot** be attached to any store — `database.js:5867`'s `restaurants[0]` convenience is
         therefore confined to non-production, and the same child confirms no token is issued.
         `MCY-02` asserts the media convenience gate is closed in production. `MCY-03` shows
         registered numbers resolve to their own store.
         **One regression I introduced and a guard caught.** Making the menu route `async` left
         awaits with no `catch`, and `admin_audit_fail_closed_test.js` **ST-04** (the static
         "async handlers that await with no catch" ceiling) failed the chain at 78/1, naming my
         route by path and line. The route now has a classifying `catch` — store-unreachable → 503,
         otherwise the error's own status — and the suite is back to **79/0**. That guard earned
         its keep; it was not touched.
         **Environment limit, recorded rather than hidden.** OTP dispatch is IP-throttled with a
         progressive lockout ("wait 10 minutes") and the chain's customer phone has already been
         used by several earlier suites, so in-chain the order group **self-skips with the server's
         own reason printed** instead of pretending to pass; standalone it runs in full (the 53/0
         result above). Naive retrying made this worse, so a rate-limit refusal now stops retrying.
         Also learned: `restart_test.js` leaves its replacement `:4000` server running, so a second
         chain run must clear that port first — the same mechanism behind the earlier
         `EADDRINUSE` mis-attribution scare.
         **Chain after the work: 21/21 links exit 0, zero failure marks, 1144 explicit totals.**
         `dart analyze lib` unchanged at 67 pre-existing infos (no Dart touched); `flutter test`
         **60/60**; `flutter build apk --debug` re-run against these fixes.
   

- [x] **The driver console, the trip screen and the account page were theatre.**
      `driver_home_screen.dart` kept availability in a Dart boolean,
      printed `₹1,420.00` and `8 Trips Done` as text, and carried three "Simulator Trigger
      Buttons" that manufactured an offer in Dart on tap — pickup, drop, distance, fare and a
      **customer's name** — for a trip the platform had never created;
      `active_job_execution_screen.dart` was a local `_stage = 1..4` counter with its OTP field
      pre-filled `7729`, so arriving, starting and completing a trip sent nothing anywhere;
      `driver_account_screen.dart` invented the partner's name, phone, rating, licence plate and
      payout address, had two rows wired to `onTap: () {}` (an emergency SOS and a helpline), and
      its "Logout" navigated to `/login` **without ending the session**, leaving the bearer token
      live on the platform. All three now render `GET /api/driver/home` and the existing
      lifecycle endpoints; the account page signs out for real through
      `POST /api/auth/logout` plus `clearSession()`, and the dead SOS row is removed rather than
      left decorative. Availability is a request whose **answer** is rendered: on refusal or
      timeout the screen puts back the last state the platform actually confirmed. Accept carries
      an idempotency key, and a lost race says "another partner took this trip".
      **Backend work it required.** `GET /api/driver/home` is new — identity, durable
      `is_online`, operational status, wallet, active assignment and offer list in one
      token-only read. `POST /api/driver/status` is the same switch with no partner id in the
      path. The online switch had been **memory-only**: `drivers.is_online` is a real column that
      boot hydration reads back, so pressing Online was silently undone by the next restart while
      the app still showed a green ONLINE; it now writes through
      `DriverRepository.setOnlineStatus` and answers 503 when the write cannot be persisted,
      because telling a partner they are online while the dispatcher cannot see them is the worse
      failure. `POST /api/driver/offers/:offerId/reject` implements the REJECTED state, the
      `rejection_reason` column and the RLS policy "authenticated drivers can ONLY update
      their own offers (e.g. reject/respond)" that migrations 014/020 declared with no endpoint
      behind them — a single conditional `UPDATE`, so accept and decline cannot both win and a
      replayed decline is a duplicate rather than a rewrite. Dispatch offers were also
      **undecideable as returned**: a `dispatch_offers` row carries ids, distance and rank, so
      both offer reads now hydrate each offer from its job (`fare`, `driverEarnings`,
      addresses) through one shared function, and an unreadable job yields
      `detailsAvailable: false` instead of an invented fare.
      **Three latent defects found on the way.**
      `DispatchRepository.getActiveAssignmentForDriver` applied its driver filter **only when
      the caller's id resolved**, so an unresolvable identity produced a query with no ownership
      filter and returned whichever job happened to be active — somebody else's trip, on this
      partner's screen — and it also returned `start_otp` / `delivery_otp`, letting a partner
      read out the code the customer is meant to hand over. Both are now refused
      (`DRIVER_IDENTITY_UNRESOLVED`) and the read exposes `otpRequired: true` instead. The
      method was dead code, so nothing leaks today; it would have started the moment this screen
      used it, which is when the fix belonged. `POST /api/driver/location` skipped its ownership
      check whenever the job was absent from that process's memory — every job created elsewhere,
      or not re-hydrated after a restart — treating "cannot find it" as "nothing to authorise";
      it now resolves the row through PostgreSQL and refuses a trip it cannot identify.
      `DriverRepository.update` raised an unclassifiable generic error on a PostgreSQL failure,
      so no caller could tell a refused write from a success; it now raises the shared
      `STORE_UNAVAILABLE`.
      **Tests.** `backend/driver_operations_test.js` (**66 checks, 0 failed**) is chain link 20:
      token-only identity with query and body `driverId` both ignored; a customer token refused
      on the driver API; production refusal of the fixed OTP asserted in a
      `NODE_ENV=production` child rather than by trusting dev convenience; availability read
      back from PostgreSQL behind the API's own answer; the offers endpoint and the console
      agreeing id-for-id; **two drivers racing one job with `Promise.all` — exactly one wins**,
      the loser gets 409, a replayed accept returns `duplicate: true` and moves nothing; an
      accepted offer cannot be declined; a declined offer cannot be accepted; one driver cannot
      decline another's open offer; cross-driver arrival and cross-driver telemetry refused; a
      wrong OTP refused with the stored status unchanged; the full
      ASSIGNED→DRIVER_ARRIVED→IN_TRANSIT→COMPLETED lifecycle paying **exactly
      `driver_earnings`, once**, with a replayed completion moving nothing; three unreachable-
      store child checks failing closed while the offer list keeps only its approved Owner
      Decision 11 fallback; and no OTP material in any driver-facing read. Five mutations each
      reddened their own guard and were all reverted: memory-only availability (OPS-13/16),
      dropping the decline ownership filter (OPS-64/65 — B really did decline A's offer,
      `success:true`), restoring the telemetry skip (OPS-66 answered **200** for a nonexistent
      trip), removing offer hydration (OPS-21 came back `fare:null`), and restoring the
      pre-filled OTP (client suite 3/4 red). `driver_router.dart` gates the console, ledger and
      account behind a session. `dart analyze`: no issues on any changed file. `flutter test`:
      **60 passed** — the 56 existing plus `mobile/test/driver_login_screen_test.dart` (4 new
      deterministic checks that no code is pre-filled, no demo code is printed, and an
      incomplete code is refused without contacting the platform). Backend chain after the
      work: **20 links, every one exit 0, zero failure marks, 1105 explicit totals**.
      **Still open, deliberately not faked.** There is **no GPS in the driver app at all**:
      `pubspec.yaml` carries no location provider and nothing in `lib/` references one, so
      `DriverMapView` animates a vehicle along hard-coded coordinates and draws invented "nearby
      drivers" (`showNearbyDrivers: false`, `animateVehicle: false` now, and the backdrop is
      labelled schematic). The server half is real and hardened — `validateDriverTelemetry`,
      a throttled memory store that never writes raw high-frequency fixes to PostgreSQL, and
      per-channel scoped broadcast; `POST /api/driver/location` is wired and tested. The client
      needs a permission-correct location provider verified on a device, and until then these
      screens **send no telemetry and say so**, rather than posting invented positions into the
      fleet view. No driver-initiated cancellation endpoint exists, so the trip screen offers
      none. And `requireSupportCallerAuth` labels any non-admin, non-merchant caller `CUSTOMER`,
      so a partner's help ticket is filed under the wrong `role` (the id is still the driver's
      own) — recorded, not patched here, because changing it affects every caller classification.

## PHASE 0 — APPLICATION VERIFICATION MATRIX (2026-09-25, read-only; nothing built here)

Inspected before writing any application code, as directed. Every row below is a file/line
observation, not an inference from a previous report.

- [x] **Flutter has SEVEN entrypoints, not four apps.** `mobile/lib/`: `main.dart` (32 lines) and
      `main_customer.dart` (29) are **the same customer super-app on the same `appRouter`** — two
      entrypoints, one app. `main_driver.dart` → `driverRouter`. `main_restaurant.dart` →
      `restaurantRouter`. `main_grocery_merchant.dart` → `groceryMerchantRouter`.
      `main_grocery.dart` → `M3GroceryApp`, which is **not router-based at all**
      (`home: const GrocerySplashScreen()`) — a sixth surface duplicating the customer app's
      Instamart. `main_admin.dart` → `adminRouter` (57 lines, 9 routes).
      **Architectural violation to resolve, not silently:** the target is ONE Merchant Android app
      with service entitlements; the repo has **two** merchant APKs, chosen at build time by which
      entrypoint you compile. Consolidating them is a product decision (it deletes a shipping
      entrypoint), so it is reported, not done.
- [x] **The service-entitlement model already exists in the database and is almost entirely
      unenforced.** `supabase/migrations/001_central_schema.sql:74` —
      `merchant_type VARCHAR(40) NOT NULL CHECK (merchant_type IN ('RESTAURANT','GROCERY','HYBRID_BOTH'))`
      is exactly restaurant-only / instamart-only / both. But across `backend/src/**` there are
      only **two** authorisation uses of it: `server.js:3851` (food **booking** refuses a
      non-RESTAURANT merchant, `MERCHANT_TYPE_MISMATCH`) and `server.js:6335` (grocery merchant
      must be GROCERY|HYBRID_BOTH). **Zero** of the 11 `/api/merchant/*` routes and 4
      `/api/grocery/*` merchant routes declare an entitlement check — all are
      `authenticateMerchant, requireMerchantTenant` only. So a RESTAURANT-only merchant can call
      `POST /api/merchant/inventory`, `/api/grocery/products/:id/price`,
      `/api/grocery/products/bulk-price-update` and `/api/grocery/orders/:id/packed-weight`, and an
      INSTAMART-only merchant can call `POST /api/merchant/:restaurantId/menu/:itemId/toggle`.
      Tenant isolation is intact (a merchant still cannot touch another merchant's rows); the
      missing layer is precisely the "AUTHORIZED SERVICE ENTITLEMENTS" rung of the required model.
- [x] **`authenticateMerchant` cannot support that layer as written, and fails open twice.**
      `server.js:897` resolves `session.entity || db.getMerchant(...)` — the same
      **session-snapshot** defect fixed for driver earnings this session. Worse,
      `server.js:901-903`: when no merchant profile resolves at all it **synthesises**
      `{ id: session.entityId, name: 'Partner Merchant' }` and proceeds. `requireMerchantTenant`
      (L927) then happily binds a tenant from that fabricated object. Any entitlement middleware
      must therefore resolve `merchant_type` authoritatively from PostgreSQL and **refuse** an
      unresolvable identity (`DRIVER_IDENTITY_UNRESOLVED` is the precedent), never default-allow.
- [x] **No Dart code anywhere consumes an entitlement.** `merchantType|merchant_type|
      MerchantService|entitlement` across `mobile/lib/**/*.dart`: **0 matches**. There is no
      service selector, no both-service state, and no gating of grocery modules for a restaurant
      merchant. UI-side entitlement awareness is entirely MISSING, not partial.
- [x] **The live restaurant console still shows fabricated business data.**
      `restaurant_main_shell.dart` — the screen `main_restaurant.dart` actually routes to:
      **L1094** `Text('Dilli Darbar Mughlai Kitchen')` and **L1095**
      `Text('FSSAI: 1002001928491 • Verified Partner')` are unconditional literals, so whichever
      store signs in is presented as somebody else's business with an invented food licence and an
      invented verification claim. **L55-102** `_menuItems` is a hardcoded five-dish list
      ("Special Dum Biryani (Chicken)", "Paneer Tikka Butter Masala", "Garlic Butter Naan (2 Pcs)",
      "Tandoori Malai Chaap Tikka", "Hot Gulab Jamun with Rabri") — the menu tab is a **SIMULATOR**.
      **L260-261** invent order line items. **L814** and **L1137** are `onPressed: () {}` dead
      buttons. Orders themselves *are* real (`L44 NabinApiService.getMerchantOrders`).
      Also unverified: `L33 _restaurantId = user['restaurantId'] as String` assumes a session field
      the merchant sign-in path may not supply. **This is the `NO FABRICATED BUSINESS DATA` rule
      being broken in a shipping screen and is the highest-priority non-blocked fix.**
- [x] **Web projects: four Next.js apps, one of which must not exist, and no public website.**
      `admin-web` (Next.js; target is Flutter Web + Android), `customer-web` (8 routes, real
      `AuthContext` + `api.ts` — but the directive states **there is NO Customer Web / PWA /
      browser app**: architectural violation, and deleting a working app is an owner decision),
      `restaurant-merchant-web` + `grocery-merchant-web` (the target is **ONE** Flutter Web portal;
      also two where the architecture wants one, and Next.js rather than Flutter). A **public
      website does not exist at all** — `PHASE 6 MISSING`. `mobile/web/index.html` exists, so the
      customer Flutter app is additionally buildable as a web target, which is the same forbidden
      category by another route.
- [x] **Driver GPS is still absent, confirmed by dependency, not by reading a screen.**
      `mobile/pubspec.yaml` has `flutter_map` (a renderer) and **no** `geolocator` / `location`
      plugin. There is no device position source to feed the real, hardened
      `POST /api/driver/location`, so the driver app correctly sends no telemetry.
      `k12` remains open.
- [x] **Admin Android is PARTIAL, not an app.** `adminRouter` exposes 9 routes
      (splash, login, otp, dashboard, features, users, drivers, merchants, orders) against roughly
      30 modules the target lists, and — unlike `driverRouter` and `restaurantRouter`, which now
      have `redirect` auth gates — **`adminRouter` has no auth redirect**, so `/dashboard` is
      reachable on a cold start without a session. `features/admin`: 15 files, 7 touching the API.

## PHASE 10 — MERCHANT SERVICE ENTITLEMENTS ENFORCED SERVER-SIDE (2026-09-25)

- [x] **`requireMerchantService()` — the missing rung of the authorisation chain, built and
      proved.** `backend/src/server.js` now resolves the caller's entitlement from
      `merchants.merchant_type` via `db.orderRepo.resolveMerchant()` on every gated request and
      refuses it closed: `MERCHANT_IDENTITY_UNRESOLVED` when the type cannot be established (a
      merchant the platform cannot read is not a merchant entitled to everything),
      `MERCHANT_TYPE_MISMATCH` 403 when the service is not granted, and a 503 shape when the
      store is unreachable rather than a default-allow. `HYBRID_BOTH` is allowed both; a typo in
      a route table throws at load instead of opening a door. Applied to 8 routes: restaurant
      menu toggle; grocery inventory GET/POST/DELETE; master-catalog; single and bulk grocery
      price writes; grocery packed-weight.
      `GET /api/merchant/services` is the new authoritative read the ONE Merchant app and the
      Portal consume — token-derived, accepting no client-declared service — returning
      `merchantType`, `services: [RESTAURANT|INSTAMART]` and `needsServiceSelector`.
- [x] **17 new security checks, `MES-00`…`MES-16`, in `merchant_operations_test.js` (now chain
      link 21 at 76/0, up from 60/0).** Three real merchants covering all three schema values —
      A `…000201` HYBRID_BOTH, B `2699ade3-…` RESTAURANT, C `02eb2b26-…` GROCERY — none invented.
      Proved: a restaurant-only merchant cannot read or create instamart inventory, cannot browse
      the master grocery catalogue, cannot set a grocery price, cannot use picking/packing; an
      instamart-only merchant cannot toggle a restaurant menu item; the entitlement read refuses
      an anonymous caller and grants exactly the stored services in each case. The gate is
      entitlement-shaped rather than a blanket block — `MES-11`/`MES-12` keep the same routes
      open to the HYBRID merchant, because a control that only ever says "no" reads as security
      and acts as outage. `MES-13`/`MES-14` attack the client-declared route: a body carrying
      `merchantId`, `restaurantId`, `storeId`, `service: 'GROCERY'` and `merchantType:
      'HYBRID_BOTH'`, and a query string naming an entitled merchant, still resolve to the
      bearer token and are still refused. `MES-15` reads `merchant_grocery_inventory` back to
      prove the refused writes wrote nothing, and `MES-16` re-reads `merchants.merchant_type` so
      the assertions test the stored entitlement rather than a fixture assumption.
- [x] **Red-green proved, then reverted.** `MUT-E1`: the `requireMerchantService('GROCERY')`
      gate was removed from `GET /api/merchant/inventory` and `MES-05` failed with
      **`{"s":200}`** — the restaurant-only merchant reading grocery inventory, which is exactly
      the hole. The gate was restored and the suite returns 76/0 with exit 0; a marker scan of
      `src/` for `MUT-E|if (false)` returns **0**.
- [ ] **One route deliberately left ungated, and why it is a finding rather than an oversight.**
      `/api/merchant/catalog` reads the grocery-shaped `products` table for the caller's tenant,
      and `restaurant-merchant-web/src/app/page.tsx:22` calls it (`merchantApi.catalog()`).
      Marking it GROCERY-only would have broken a working restaurant integration — the explicit
      constraint on this audit — so it is commented in place instead. What it exposes is the
      module-boundary question the entitlement rule is really asking: a restaurant console is
      being served from the grocery catalogue. Answering it means changing a shipping app, so it
      is escalated, not decided here.
- [x] **No regression introduced.** The full 21-link chain after the change: **19/21**, 1179
      explicit passing checks, **0 skips**, `teardown: :4000 free`. The two red links are the
      pre-existing money-state blocker (`EARN-13`/`EARN-24`, and `OPS-54`'s state-dependent
      `+178`), byte-for-byte the same failures recorded before this slice — not new ones. Every
      other link, including all four admin suites, the geo trio and `restart_test.js`, exits 0.
      `flutter test` re-run after the change: **60/60, exit 0** (no Dart was touched).

## RESTAURANT MERCHANT REAL-DATA CHECKPOINT — 2026-09-25

- [x] **Every fabricated business value in the shipping restaurant merchant app is gone.**
      `restaurant_main_shell.dart` (1273 lines, the screen `main_restaurant.dart` actually routes
      to) was the worst remaining instance of the no-fake-data rule, and it was not one bad
      label — it was the identity, the menu, the orders and the money of the app.
      **Identity.** `Text('Dilli Darbar Mughlai Kitchen')` and
      `Text('FSSAI: 1002001928491 • Verified Partner')` were unconditional, so whichever store
      signed in was presented as a business that does not exist, holding a food licence that
      belongs to nobody, with a verification claim nothing grants. It now renders
      `GET /api/merchant/services` → `profile`, falling back to **"Restaurant profile not
      configured"** or a distinct load-failure line. Note `merchants` has **no** verification or
      GSTIN column, so no badge is implied where there is no data, and a missing licence says
      "No FSSAI licence on this merchant record" instead of inventing a number.
      **Menu.** The `final` five-dish `_menuItems` list (biryani, paneer tikka, garlic naan,
      chaap, gulab jamun, each with a price, a description and an Unsplash URL) is deleted; the
      tab now loads `GET /api/merchant/catalog` with loading / **failed** / empty / real-rows
      states, so an outage is never shown as "you have no dishes". Two fields had to stop being
      casts: real `products` rows carry `is_available` and have **no** `is_veg` column, so the
      previous `item['isVeg'] as bool` would have thrown the moment the list came from the
      server rather than from the literal.
      **Fabricated order generator.** `_showIncomingOrderDialog` displayed "NEW INCOMING ORDER
      #1043", "Customer: David K. • Home Delivery", two line items and a customer note, and its
      Accept button **inserted all of it into `_orders` locally** with a `pickupOtp` of `5519`
      and a driver status string — a partner could manufacture a booked order the platform never
      created and then cook for it. It was wired to **two** live controls: a button labelled
      **"Simulate Order"**, and the AppBar **notification bell**. The dialog is deleted; the
      button is now a real `Refresh` (`_loadOrders`) and the bell re-reads orders and opens the
      order board. `_buildSettlementRow`, which existed only to render invented numbers, is gone.
      **Invented money.** The Finance tab printed `₹18,420.50` TOTAL PAYOUT BALANCE,
      "Auto-settles daily at 08:00 AM to **HDFC Bank (•••• 1092)**" and three dated
      "PAID TO BANK" settlements. There is **no merchant payout or settlement endpoint at all**,
      so the tab now states that plainly and shows no balance, no bank and no history. These were
      not stale figures — they were never real.
      **Dead buttons.** Both `onPressed: () {}` handlers are gone: the AppBar store icon now
      reports the store's actual name and granted services, and "Add Dish" says dish creation
      happens on the merchant portal (there is no merchant-facing create-item endpoint to call).

- [x] **The on-device service switch was never a control, and now it isn't either.**
      `_merchantMode` was a plain Dart string flipped by tapping the header, with no check, so
      any partner could put their own app into "Grocery" mode regardless of what they sell. It is
      now `_selectService()`, which consults the `_services` list the backend returned and
      refuses a service the account was not granted. This is UX only — the server enforcement
      from PHASE 10 is what actually protects anything — and the code says so.
      `_storeStatus` was the same class of lie in the other direction: pressing "Closed"
      rewrote a string, so the partner saw a closed store while the platform and every customer
      searching it still saw `is_open` unchanged. It is now derived from the merchant record,
      and because **no merchant open/close endpoint exists**, tapping the control states that
      rather than pretending to work.

- [x] **§5 catalog boundary question — answered, and it was not a violation.**
      Traced Flutter → API → table → ownership → service type. `GET /api/merchant/catalog`
      (`server.js:6948`) reads the `products` table filtered to `.eq('merchant_id', merchant.id)`
      of the **authenticated** caller. Independently, the customer-facing restaurant menu route
      `GET /api/restaurants/:id/menu` (`server.js:6782`) reads **the same `products` table**,
      scoped by `merchant_id`, additionally requiring `merchant_type IN ('RESTAURANT',
      'HYBRID_BOTH')`. So `products` is a genuine shared catalogue abstraction used by both
      services, distinguished by the owning merchant's type — not a grocery table leaking into
      the restaurant app. The restaurant console's use of it is correct; the PHASE 10 note
      warning against gating it stands, and no new endpoint was needed. **What the trace did
      expose:** the merchant menu-availability write
      (`POST /api/merchant/:restaurantId/menu/:itemId/toggle`) mutates the **legacy in-memory
      `db.restaurants[].menu`**, a different store from the `products` rows the list now renders.
      Toggling a real catalogue item therefore targets an id the legacy menu does not contain,
      and the UI shows the server's refusal and reverts. Recorded as the next backend gap
      rather than papered over with a client-side success.

- [x] **Regression: nothing moved except the fabrication.** Full 21-link chain after the change:
      **19/21, 1179 explicit passing checks, 0 skipped, `teardown: :4000 free`** — identical to
      the run before this slice, with the same three known money-state failures
      (`EARN-13`, `EARN-24`, `OPS-54`) left exactly as they are, not weakened or skipped.
      `merchant_operations_test.js` link still exits 0 with the entitlement group intact
      (**MES-00…MES-16**), so no merchant authorisation regressed. `dart analyze` on the two
      changed Dart files: **No issues found**. `flutter analyze`: 67 issues, 0 errors,
      0 warnings — baseline unchanged. `flutter test`: **60/60, exit 0**.
      `flutter build apk --debug`: see the build result recorded below.

- [ ] **Honesty note on what "complete" would mean here.** The restaurant app now shows only
      real data, but it is **not** complete: the menu-availability toggle cannot yet act on real
      catalogue rows (backend gap above), there is no merchant open/close, payout or settlement
      endpoint, no merchant-side create-dish endpoint, and the `restaurantId` a session carries
      is assumed rather than guaranteed by the login path. Each is reported as missing rather
      than filled with a constant.

## PHASE 12 — DRIVER WALLET AUTHORITY: ARCHITECTURE IS AMBIGUOUS (2026-09-26, investigation only — NO money logic modified)

**Conclusion: D — ARCHITECTURE CURRENTLY AMBIGUOUS.** Stopped before modifying money logic, as
directed. Four stores each claim to be a driver's balance and they differ by two orders of
magnitude; nothing in the schema, code or tests establishes which one wins.

- [x] **The four driver-money stores, measured on the local/TEST database (read-only).**
      `drivers.wallet_balance` = **1200.00**, which is byte-identical to the in-code driver seed
      at `database.js:497` (`walletBalance: 1200.0`). The immutable journal says otherwise:
      summing this driver's posted `DRIVER_EARNINGS_PAYABLE` lines gives **+84,143.00**
      (1,551 settlement credits totalling 163,593.00 less 454 payout debits totalling
      79,450.00). Summing `jobs.driver_earnings` over the driver's 945 COMPLETED rows gives
      **104,131.00**. And the in-process Node mirror — which is what the API actually returns —
      read **1022** in the failing run. Those are four answers to "what does this driver have",
      none reconcilable with another.
- [x] **The chart of accounts is decorative, and the append-only guarantees are real.**
      Every `ledger_accounts.current_balance` is **0.00** while its own journal lines net
      +146,000.00 (`DRIVER_EARNINGS_PAYABLE`), -69,975.00 (`CUSTOMER_WALLET_LIABILITY`) and
      -52,392.00 (`PAYMENT_GATEWAY_ESCROW`) — **all three DIVERGED**, because nothing maintains
      the column. Conversely `trg_journal_transactions_append_only` and
      `trg_journal_lines_append_only` do enforce immutability, with
      `chk_balanced_entry (total_debit = total_credit)`, a `UNIQUE` `idempotency_key`, and
      `VOIDED` as the reversal state. So the journal is genuinely designed as the audit trail,
      but it is not currently usable as *the* balance: **422 of the driver's COMPLETED trips
      have no settlement journal entry at all** (`RIDE_SETTLEMENT:<job_number>:DRIVER_EARNINGS`
      absent), i.e. earned-but-never-posted, so deriving a balance from it and discarding the
      column would silently drop money. That is the blocking ambiguity, not a detail.
- [x] **Migration 007 states the intent, and the code does not follow it.**
      `007_wallets_domain.sql:6-8`: *"We need a single RPC to reliably adjust a wallet balance and
      simultaneously write a double-entry ledger journal. **This replaces the in-memory Node
      arithmetic + fire-and-forget sync.**"* `adjust_wallet_atomic` does honour that — one
      statement sequence, `UPDATE ... RETURNING wallet_balance`, a `v_new_balance < 0` RAISE,
      idempotency short-circuit returning the live balance. But the in-memory mirror the RPC was
      meant to replace is still what several reads return, so the replacement is half done.
      Choosing "ledger is authoritative" therefore contradicts 007's own balance-column
      semantics; choosing "column is authoritative" leaves 84,143 of journal history unexplained.
      **Neither can be picked from the evidence without a decision.**
- [x] **EARN-13 root cause: cross-process invalidation of the in-memory mirror.**
      `drivers.wallet_balance` is hydrated into `db.drivers` at boot (`database.js:1694`/`1750`)
      and thereafter only the *same process's* mutations move it. The chain runs
      `restart_test.js` against **the same PostgreSQL on a private port**, so it settles and pays
      out DRV-101 in a second server process that the shared `:4000` harness cannot see. The
      harness's mirror therefore drifts from the column by exactly the amount that other process
      moved, which is the `got 1022 / stored 1111` gap (89 = one settlement). Not a duplicate
      earning, not a wrong commission, not settlement timing: a cache with no invalidation. In
      production with more than one instance the same divergence is permanent, so **EARN-13 is a
      real architectural defect that the test is correctly pinning** — it must not be "fixed" by
      changing the expected value.
- [x] **EARN-24 root cause: shared-fixture contamination, not an authorisation bug.**
      `test_suite.js:3498` writes `rajesh.verified.m4.${Date.now()}@okhdfcbank` as a *verified*
      UPI onto the same DRV-101 row that `driver_earnings_test.js:18` later asserts against.
      Proven by isolation: standalone and repeated runs pass (below); only after link 1 runs does
      it fail. The destination is stored on `drivers`, only `service_role` may write it
      (`trg_drivers_privileged_column_guard` from 024 blocks client roles on balance/identity
      columns), and no client-supplied UPI reaches it, so there is **no integrity or
      authorization defect** — the fixture is shared and the expectation is stale.
- [x] **OPS-54 root cause: the same mirror, read across two settlement sources.**
      `updateJobStatus` credits via `driverRepo.updateEarnings` → `adjustWallet`, and on
      `IDEMPOTENT_SKIPPED` or a posted result sets `driver.walletBalance` to the **absolute**
      balance returned by PostgreSQL; `database.js:3864-3870` adds `netEarnings` **relatively**
      but only `if (!earnings.posted)` — so the double-count guard is present and a trip is not
      paid twice (`OPS-55`/`OPS-56` pass, and `journal_transactions` has no duplicate
      idempotency key). The `+178` for an `89` trip is the mirror absorbing a second legitimate
      settlement belonging to another driver-paid movement in the same window on the same shared
      row. Its pass/fail flip between runs is the same statefulness, not different logic.
- [x] **Test isolation audit (§7) — done before any modification, as instructed.**
      On a clean local DB with a fresh server: `driver_earnings_test.js` **29 PASSED / 0 FAILED
      twice in a row** with `EARN-13` and `EARN-24` both `[PASS]`; `driver_operations_test.js`
      **66 PASSED / 0 FAILED** with `OPS-54`, `OPS-55`, `OPS-56` all `[PASS]`. In-chain all three
      fail. Classification: **E (multiple sources of truth) + D (stale persisted state) + B
      (test-order dependency) + C (shared fixture)**, in that order of severity. EARN-24 is
      purely B/C; EARN-13 and OPS-54 are B/C *exposing* A/E.
- [ ] **Two real idempotency defects found while mapping, deliberately left unfixed.**
      `database.js:2942` builds the admin financial-adjustment key as
      `` `admin_adj_..._${Date.now()}` `` and `database.js:4013` builds the payout key as
      `` `payout_${driver.id}_${Date.now()}` ``. A retry of either therefore carries a **new**
      key, so the ledger's only duplicate defence (`UNIQUE idempotency_key`) cannot fire: an
      operator repeating a payout request produces a second real money movement. Contrast the
      settlement path, `RIDE_SETTLEMENT:${tripId}:DRIVER_EARNINGS`, which is trip-derived and
      stable — proof the correct pattern already exists in this file and is applied
      inconsistently. Secondary finding in the same function: the insufficient-balance check
      compares `driver.walletBalance` (the possibly-stale mirror) while the actual debit is
      guarded by `adjust_wallet_atomic` against the durable column, so the pre-check can refuse a
      solvent payout or wave through one the database then rejects. Not fixed here because a
      stable key for payouts *is* a money-path design decision (what counts as "the same
      intent" — one tap, one invoice, one batch?) and §12 permits only the smallest correction
      **once authority is provable**.
- [x] **Financial security check (§13) is clean.** No route assigns `walletBalance`,
      `earningAmount`, `settlementAmount`, `commission` or `finalFare` from a request body into a
      mutation; `drivers` balance/identity columns are additionally write-protected against
      `anon`/`authenticated` by the 024 trigger, and payouts validate against the server-side
      balance. A client can request an operation; it cannot state an amount of money.
- [ ] **Questions that must be decided before any money logic changes.**
      (1) Is a driver's balance the `drivers.wallet_balance` column, or the net of posted
      `DRIVER_EARNINGS_PAYABLE` journal lines — and if the latter, what happens to the 422
      completed trips with no journal entry? (2) Should `ledger_accounts.current_balance` be
      maintained by trigger, dropped as dead, or treated as the account-level authority?
      (3) Is the Node mirror a cache that must be invalidated/re-read per request, or must all
      money reads go to PostgreSQL? (4) What is the natural idempotency identity for a payout —
      client-supplied key, payout request row, or `(driver, amount, window)`? — and the same for
      admin adjustments. (5) Which store does payout *eligibility* consult: the same one that
      gets debited, or nothing? Until these are answered, `EARN-13`, `EARN-24` and `OPS-54`
      stay red and reported, and the chain stands at **19/21** — not weakened, not skipped,
      not silently worked around.

## PHASE 13 — MONEY-SAFE IDEMPOTENCY (2026-09-26)

**Scope held exactly as set: operation identity only.** No wallet authority was decided, no
balance reconciled, no settlement semantics, eligibility rule, chart-of-account balance or
historical trip touched. Nothing was pushed or deployed, and no secret or `SUPER_ADMIN` was
created.

- [x] **Both clock-derived money identities are gone**, replaced by
      `backend/src/services/moneyIdentity.js`. `admin_adj_..._${Date.now()}` and
      `payout_${driver.id}_${Date.now()}` are now a durable identity composed from the operation
      namespace, the **account whose money moves**, and the caller's `Idempotency-Key` when one
      is supplied. A caller key is hashed rather than appended, so it cannot smuggle the
      separator to reach another account's namespace nor overflow the `VARCHAR(100)` column, and
      the composed key is bounded to 100 characters on both sides of the join. Threaded through
      `/api/driver/payout`, `/api/admin/finance/settlements/drivers/:id/payout` and
      `/api/admin/finance/adjustments` using the canonical
      `idempotency-key` / `x-idempotency-key` / body spelling the rest of this backend already
      uses and CORS already grants.
- [x] **The identity is deliberately NOT derived from amount, direction or reason.** Two
      legitimate ₹100 goodwill credits for the same reason are two operations; folding their
      values into the key would silently discard the second. With no caller key each request is
      therefore one fresh effect — the pre-existing behaviour, kept honestly, because nothing in
      the request distinguishes a retry from an intention and guessing wrong loses money either
      way.
- [x] **A second, sharper defect in the same lines: `Date.now()` also *collided*.** Two genuinely
      different payouts in one millisecond produced the SAME `payout_id`, which is UNIQUE, on an
      insert whose error was never checked — so the ledger had already debited the wallet while
      no payout record existed. `payout_id` is now derived from the operation identity, the
      insert's error is checked, and a refused record is reported as an explicit ledger/record
      inconsistency instead of being dropped.
- [x] **The database is the barrier, and it was already built to be one.**
      `journal_transactions.idempotency_key`, `driver_payouts.idempotency_key` and
      `driver_payouts.payout_id` are all UNIQUE; `adjust_wallet_atomic` checks the key before it
      moves anything and returns the live balance when it matches. What was missing was a stable
      identity for those constraints to compare. `LedgerRepository` now also reports
      `IDEMPOTENT_SKIPPED` *with* the resulting balance on the concurrent 23505 path — matching
      what the SQL function already does on its serial path — and no longer appends a second
      in-memory ledger entry for a movement PostgreSQL refused as a duplicate.
- [x] **`money_idempotency_test.js` — 24 checks, chain link 22, green in-chain and standalone.**
      Identity determinism across a clock tick, uniqueness without a key, account scoping,
      separator-smuggling and column-overflow resistance, and a stable `payout_id`. Database
      barrier proofs executed inside a transaction that is always rolled back, so no row
      survives — using a **real** driver id, because a fake one is rejected by the foreign key
      before the UNIQUE constraint is ever reached and the test would pass without proving
      anything. Then live: one adjustment booked, its retry reported as the existing operation
      with **exactly one** journal transaction, two different keys booked as two operations (a
      block is not an idempotency mechanism), two keyless requests as two operations, six
      simultaneous identical requests as one journal transaction with one booking, and the same
      key submitted through **two backend processes** on one PostgreSQL — again one transaction,
      which is the Phase 12 reality this has to survive. Refused payouts leave no record. The
      file reverses every credit it booked, counted back from the journal rather than by hand.
- [x] **Red-green proved twice, then reverted.** With the clock reintroduced into the identity,
      the live suite fell to **13 passed / 10 failed** and `IDE-21` caught the exact harm:
      `a=1419, b=1429` — the *same* caller key moving the balance twice. A second mutation
      (`MUT-T2`) drove the static ratchet in `admin_audit_fail_closed_test.js` red on its own.
      Both reverted; a `MUT-T*` scan of `src/` returns only the pre-existing `SKU-MUT-01` seed.
- [x] **`ST-06` was a ratchet guarding the old pairing, and Phase 13 dissolved its premise.**
      It asserted that `processFinancialAdjustment` stays un-awaited *while* its key ends in
      `Date.now()` — because a 503 invites a retry and a retry with a clock key was a second
      payment. Those were one decision, not two bugs. Left unchanged it would now stay green by
      describing a world that no longer exists, so it was restated to pin the invariant itself:
      no `Date.now()` anywhere in either money identity, both using the stable helper, payout
      included. That is stricter than what it replaced. It first failed on my own over-broad
      window matching an unrelated display id (`TXN-ADJ-${Date.now()...}`), which was narrowed
      to the identity assignment itself rather than relaxed. **79/79 again.**
- [ ] **Two findings surfaced, deliberately not fixed.** (1) Under six simultaneous writes to one
      account row, **2 of 6 requests did not answer 200-success** (reported as a `[note]`, not
      asserted away) — the ledger held exactly one transaction, so no money moved twice, but a
      loser's answer is a lock/deadlock refusal rather than the existing result, which is an
      availability problem for a retrying caller. (2) The admin settlement-payout route calls
      `db.recordPayout(...)` **without awaiting it**, so `result.success` is read off a Promise and
      the response serialises to `{}` while the `SETTLEMENT_EXECUTED` audit trail never runs; and
      `/api/admin/finance/refund` still falls back to `ref_adm_${Date.now()}` when no key is
      supplied. Both are recorded rather than folded into this phase.
- [x] **Regression.** Chain is now **22 links**: **20/22 clean, 1203 explicit passing checks,
      0 skipped, teardown released `:4000`**. Green links include the merchant entitlement suite
      (77) and the new idempotency suite (24). Still red, unchanged and unsilenced: the Phase 12
      money-state ambiguity — `EARN-13` and `EARN-24` in `driver_earnings_test.js`, and
      `OPS-54` in `driver_operations_test.js`. No test was weakened, skipped, deleted or
      re-expected to reach that result.

## MERCHANT INVENTORY INTEGRITY CHECKPOINT — 2026-09-25 (regression gate: OPEN, NOT clean)

- [x] **Inventory integrity is accepted and closed.** `merchant_grocery_inventory` accepted a
      negative `store_price` and persisted it: the vulnerability was reproduced RED before any
      fix, and the persistence of the bad row was observed, not inferred. The fix is both
      layers. Application: `backend/src/services/inventoryDomain.js` classifies every price and
      stock input before it reaches the store. Database: migration
      `030_merchant_inventory_integrity.sql` adds `chk_mgi_store_price_positive`
      (`store_price IS NOT NULL AND > 0 AND <= 99999999.99`) and
      `chk_mgi_stock_quantity_non_negative` (`>= 0 AND <= 2147483647`), so a caller that skips
      the application layer is still refused by PostgreSQL. Re-verified after this session's
      harness work, read-only: both constraints exist with `convalidated = true`, and the
      existing **14 rows remain clean** — 0 prices <= 0, 0 negative stocks, 0 overflows.
      `merchant_operations_test.js` **60 PASSED / 0 FAILED / 0 SKIPPED** standalone, with
      MCP-07 iterating the 20-value invalid matrix (negative, sub-negative, malformed `abc`,
      `{}`, `null`, `'NaN'`, `'Infinity'`, `'-Infinity'`, `1e999`, beyond `NUMERIC(10,2)`,
      beyond `INTEGER`, fractional stock, 3-decimal price, `'1e2'`, zero price), MCP-06 accepting
      a legitimate update, MCP-10 accepting zero stock because sold-out is legitimate, MCP-11
      leaving the stored price alone on a stock-only update, and the tenant-isolation group
      unchanged. **Nothing in the validation was edited to accommodate the harness**, and
      `inventoryDomain.js` / `030_*.sql` are untouched by this checkpoint.

- [x] **The chain was not trustworthy, and the stated cause was wrong.** The reported common
      cause was `OTP_DISPATCH_FAILED` / "wait 10 minutes". The actual first failure was
      `ECONNREFUSED 127.0.0.1:4000`: `driver/merchant/customer` suites talk HTTP to a backend on
      `:4000` and **nothing in the chain ever started one**. For months the chain was green
      because `restart_test.js` leaked a detached replacement server bound to `:4000` and every
      later link rode on that orphan — this file's own line above records it ("`restart_test.js`
      leaves its replacement `:4000` server running, so a second chain run must clear that port
      first"). Once the leak was fixed, the ports went quiet and the coupling showed. The two
      states were mutually exclusive before: with a server on `:4000`, `restart_test.js` refused
      to run because it cannot own a port already serving. Neither symptom was a product defect.
      Note also that `18/21` had come from an ad-hoc `node --test` invocation, which runs links
      concurrently and is not the sanctioned sequential chain; it is not a valid gate reading.

- [x] **`backend/scripts/test_chain.js` — the chain now owns its harness lifecycle.** One shared
      backend is started by the runner, waited for on a real `GET /api/health` (never an assumed
      bind), its base URL is handed to every link so no link falls back to a hardcoded default,
      and it is reaped **by the pid it started, never by port lookup**, with the port release
      proven before exit. `restart_test.js` is allocated a free private port at runtime
      (`NABIN_RESTART_PORT`) so it can restart a server it owns without touching the shared one.
      All 21 links run even after one fails, so a single run reports the whole matrix instead of
      stopping at the first red. Fail-closed: refuses `NODE_ENV=production`, refuses a
      non-loopback harness host, and refuses a non-loopback `DATABASE_URL`/`SUPABASE_URL` unless
      `NABIN_ALLOW_REMOTE_TESTS=1` is set deliberately. `npm test` is now `node scripts/test_chain.js`.
      Verified: standalone `restart_test.js` is **40 PASSED / 0 FAILED, exit 0, and `:4000` is
      free afterwards**.

- [x] **Test/OTP coupling removed by reusing authenticated sessions — throttling untouched.**
      `testSessionCache.js` existed for the two suites that broke; the remaining suites that used
      OTP as a *means to a session* now share it: `test_phase7_security.js`,
      `customer_activity_test.js`, `driver_earnings_test.js`, `geo_adversarial_test.js`,
      `geo_anon_access_test.js`, via one `createLogin()` helper. Evidence for the coupling, not
      inference: `sendAuthOtp` (`src/database.js`) allows **5 sends per phone per 10 minutes** in
      an in-process `Map`, and `9845011982` (Priya) was dispatched by `test_suite.js`,
      `geo_adversarial`, `geo_anon`, `test_phase7`, `customer_activity`, `driver_earnings`, then
      `driver_operations` — the 6th onward was refused, which is why the tail links went red
      while every one of them passed alone. Two things were deliberately **not** touched:
      `test_suite.js` MODULE 9 (its `send-otp` 200/`expiresInSeconds: 300`, invalid-OTP-rejected
      and valid-OTP-issues-token checks *are* the assertions) and `admin_customers_test.js`
      (its `FIXTURE_PHONE` is unique per run and enrols a fresh account through the real path).
      The rate limit was not raised, not disabled, not made configurable; no production OTP or
      token is used or hardcoded. A second harness bug went the same way: merchant's `login()`
      called `mintSession()` **again** just to build its `failure` field, spending a dispatch at
      the exact moment the budget was gone.
      **Authentication was not weakened anywhere.** Every cached token is re-probed with a real
      `GET /api/auth/me` and accepted only if the server says it is live *and* carries the role
      asked for. `driver_operations_test.js` also gained a guard that fails the suite when an
      identity is missing, because OPS-03 ("a customer token cannot reach the driver console")
      had been passing vacuously against `Bearer null` — a test passing because authentication
      was skipped. It now stops instead.

- [x] **Product defect found and fixed: the driver earnings wallet was served from a stale
      session snapshot.** `/api/driver/earnings` passed `req.driver` straight into
      `buildDriverEarningsPayload`, and `req.driver` can be the **`entity` snapshot frozen into
      the persisted session at sign-in** (`backend_sessions.entity`, sessions live 30 days).
      Measured on one live process: PostgreSQL held `wallet_balance = 1289.00`, a newly minted
      session was told `1289`, an older session was told **`1111`** — a driver who signed in
      before a settlement is shown the balance they had when they authenticated, not the balance
      they hold. The sibling route already resolved the live record (`db.getDriver(req.driver.id)
      || req.driver`); the token route now does the same, which is exactly what `EARN-21`
      ("path-scoped route and token route are one implementation") pins, and it is green.
      `POST /api/driver/payout` was checked for the same mistake and is **not** affected: it
      passes an amount and id to `db.recordPayout`, which validates against the durable record,
      so this is a wrong *display* of money, not an overdraw. Identity still comes only from the
      bearer token; no client-supplied driver id was introduced.

- [ ] **BLOCKER, not closed: the shared fixture driver's money state has two sources of truth, and
      the chain is therefore 20/21, not 21/21.** After the harness work the chain is deterministic
      and reproducible; one link is still red, `driver_earnings_test.js`, on two assertions.
      (a) **`EARN-13` — "the wallet balance equals the drivers column"**, failing with the API
      reporting `1022` against `drivers.wallet_balance = 1111`: the in-memory driver mirror and
      the durable column disagree by exactly one settlement. It is **state-dependent, not
      link-dependent**: the sibling assertion `OPS-54` ("the wallet moved by exactly this trip's
      driver earnings, once") measured **+178 for an 89 trip** in one chain run and passed in the
      next, with the same code between them. That variability is the symptom of the drift.
      The worse reading — a trip paid twice — was checked and ruled out before anything else:
      `journal_transactions` has **no duplicated `idempotency_key`** ("posted more than once:
      NONE"), `OPS-55` ("a replayed completion cannot pay the trip twice") and `OPS-56` ("the
      second attempt moved nothing") both pass, and the two +89 rows are distinct job numbers
      minutes apart. (b) **`EARN-24` — "the payout destination is only a verified destination"**,
      where the API returns `rajesh.verified.m4.<timestamp>@okhdfcbank` with
      `destinationVerified: true` while the assertion's `wantDestination` derives from
      `drivers.payout_upi_verified` / `verified_upi_id`. That VPA is written by **`test_suite.js`
      (link 1) at L3498** onto the *same* fixture driver DRV-101, so link 19 asserts a payout
      state that link 1 has already mutated: cross-suite fixture coupling plus a disagreement
      about what "verified" means.
      Neither is fixed here on purpose. (a) requires choosing the authority for a driver wallet
      and reconciling the mirror — a money-path decision this repository has consistently
      escalated rather than absorbed (`sl5`, "route-derived fare = gated financial decision");
      (b) requires either isolating the fixture driver or deciding the verification semantics,
      and either could be papered over by weakening the assertion, which is the exact failure
      this gate exists to prevent. **Needs an owner decision on both.** Consequence: no Flutter
      Merchant Portal, Order Detail, open/close, reports, promotions, payouts, staff or documents
      work until this resolves at 21/21.
      Evidence for the gate as it stands, four runs: the first (before session reuse reached the
      upstream suites) `20/21` with `driver_operations` red at `ECONNREFUSED`-adjacent `OPS-19`
      and merchant self-skipping 10 checks; then `19/21` twice with `driver_earnings` red on
      `EARN-13` + `EARN-24` and `driver_operations` red on `OPS-54` (`+178`); and the final run
      **`20/21`** with `driver_operations` **green at 66/0** and only `driver_earnings` red on
      `EARN-13` + `EARN-24`. The last two runs both report **1163 explicit passing checks,
      0 skips, `teardown: :4000 free`**.

- [x] **Migration history understood (TASK 7), nothing rolled back, nothing applied to
      production.** Local ledger and disk now match **exactly**: 28 files on disk, 28 rows in
      `supabase_migrations.schema_migrations`, `ON DISK but NOT recorded: none`,
      `RECORDED but NOT on disk: none`. Why 027 looked unapplied: **`scripts/apply_local_migration.js`
      executes a file and never writes the ledger** (its whole body is read-file, `client.query(sql)`,
      log) — so anything applied through it changes the schema while the ledger stays silent, and a
      later `npm run db:migrate` re-applies that version. The runner's ordering is correct:
      `discover()` filters `^\d{3}_.+\.sql$`, sorts ascending, skips recorded versions, and applies
      each pending file in its own transaction, so 027 was applied **before** 030, never after.
      027 is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
      `CREATE OR REPLACE FUNCTION`, `ENABLE ROW LEVEL SECURITY`), so re-applying it was a no-op on
      a schema that already had those objects — no data was at risk. **030 does not depend on 027**:
      it touches only `public.merchant_grocery_inventory`, created in **001**, and shares no object
      with the campaign tables; the two simply happened to be pending together. 027 is expected by
      the repository (committed at `a85ca6d`). On the numbering: **017 existed and was deliberately
      reverted** (`1d404a6`, after `4c3ba35`; `66c0718` also reverted unauthorised Phase 18 work),
      and **028 has never existed in any commit on any ref** — so the gaps are a reserved/skipped
      number and a backed-out migration, not lost migrations. Recorded rather than "fixed": writing
      a ledger row for a schema change applied out-of-band, or making `apply_local_migration.js`
      record what it applies, is a separate decision.

- [x] **Flutter verification, unchanged as a final sanity check (no Dart was touched).**
      `flutter analyze`: **67 issues, 0 errors, 0 warnings, 67 infos** — identical to the
      pre-existing baseline recorded above. `flutter test`: **60/60, "All tests passed!"**.
      `flutter build apk --debug`: **built successfully** —
      `build/app/outputs/flutter-apk/app-debug.apk` (`build\app\outputs\apk\debug\app-debug.apk`,
      153.8 MB), Gradle `assembleDebug` in 21.6s. The JDK `restricted method` /
      `--enable-native-access` warnings are pre-existing Gradle warnings, not errors, and were
      deliberately not chased.

- [ ] **Remaining risks carried forward.** (1) The wallet-authority blocker above. (2) Four admin
      suites and `test_suite.js` still hardcode `http://127.0.0.1:4000`, so `NABIN_HARNESS_PORT`
      is debugging-only; the runner warns rather than silently splitting the chain. (3) A stale
      `backend/.nabin_test_sessions.json` is harmless for correctness (the probe re-authenticates)
      but pins reuse to one host:port by design. (4) Session `entity` snapshots are a general
      hazard: this checkpoint fixed the one earnings read it could prove, and has not audited
      every read that touches `req.user` / `req.driver` / `req.merchant`. (5) `admin_identity_gates`
      and `admin_customers` report 0 parsed "passed" numbers because their markers differ; their
      exit codes are what the runner trusts, and both exit 0.

## PHASE 18 — DRIVER EARNINGS IDENTITY + FINANCIAL TEST CORRECTION (2026-09-26, local/test only)

No production change, no push, no deploy, no historical financial record modified. Phases 14,
15, 15B and 16 were never recorded here; this section carries their corrections because every
one of them contained a finding later disproved.

### PHASE 15/16/17 CORRECTIONS — read before trusting any earlier money number

| earlier claim | status | why it was wrong |
|---|---|---|
| Phase 15: "422 completed trips have no journal entry" | **RETRACTED** | measured through an anon key, so RLS hid rows (111 of 3,088 jobs visible) |
| Phase 15: "journal holds ~356 transactions / 80 settlements" | **RETRACTED** | same RLS-filtered read; true figures 4,348 and thousands |
| Phase 16: "journal has NO unique barrier on transaction_id" | **RETRACTED** | probe inserted `journal_lines` using columns that do not exist (`debit_account`, `transaction_id`); a failed insert was read as a missing constraint. `UNIQUE(transaction_id)` and `UNIQUE(idempotency_key)` both exist and reject duplicates with 23505 |
| Phase 16: "`journal_transactions` has no `idempotency_key` column" | **RETRACTED** | the column exists and is UNIQUE |
| Phase 16: "11 unbalanced line groups" | **SUPERSEDED** | bad join. Correct: 22 headers disagree with their line sums — 11 transactions have no lines at all, 11 have lines that do not add up |
| Phase 17: "only 1 of 979 completed jobs has an attributable earnings leg" | **RETRACTED** | wrong query; 979/979 have one, keyed `RIDE_SETTLEMENT:<job_number>:DRIVER_EARNINGS` |
| Phase 17: "`0 -NET` rows proves the earnings leg is missing" | **RETRACTED** | `-NET` is a naming convention. The earnings leg is durable: `adjust_wallet_atomic` credits `DRIVER_EARNINGS_PAYABLE` and updates the wallet in one atomic RPC |
| Phase 16: "TASKS.md updated with the Phase 16 section" | **FALSE** | no Phase 14/15/15B/16 section existed in this file until now |
| Phase 14: "DRV1029 = ₹50,601 durable fixture contamination" | **FALSE** | `drivers` has no `business_id` column and no driver holds that balance; the value came from a running server's in-memory cache read over HTTP. Max durable wallet is ₹1,850; Σ wallets ₹3,817 |

Established instead, with privileged local PostgreSQL (`db=postgres`, `role=postgres`, full-scope
aggregates): `journal_lines` is **single-leg** (`journal_id`, `account_code`, `entry_type`, `amount`,
`entity_type`, `entity_id`); `chk_balanced_entry` rejects an unbalanced header (23514); journal and
payout tables are append-only against every role; ride-completion settlement coverage is 979/979.

### The identity defect that survives all of that

`settlementRef = job.jobNumber || job.id` (`database.js:3868`) is never null, so the **ride** path
always supplies an identity and its rows are attributable and idempotent. The **support-ticket
bounty** path (`SupportTicketRepository.js:773`) calls `updateEarnings(targetDriverUuid, bounty)`
— two arguments — while `row.id`, `row.ticket_number` and `row.job_id` are all in scope at that
call site. So it reaches `DriverRepository.js:310` `referenceId: tripId || \`drv_earn_${Date.now()}\``
and writes a journal row with `idempotency_key = NULL`, which `UNIQUE(idempotency_key)` cannot
protect because NULLs never collide.

**New and unresolved:** the seeded demo trip identity `JOB-100` carries ~100 earnings transactions
of which **99 have no idempotency key** — repeated credits against one reused demo identity.
`IDENT-09` asserts the invariant "one earnings transaction per job" and is therefore **red on
purpose**; it was not relaxed.

### Files
`backend/driver_earnings_identity_audit_test.js` (new, IDENT-00…13, read-only plus one
rolled-back RPC probe), `backend/financial_authority_test.js` (corrected: both UNIQUE indexes,
savepoint-isolated enforcement probes, single-leg join fix, line-constraint probes, ratchets on
the 11/11 historical gaps), `backend/scripts/test_chain.js` (both suites wired, links 24–25;
check counter fixed for a third time — it had reported 2,814 from a duration line and then 0
for suites that print `444 PASSED, 0 FAILED`).

### Regression (actually run, 2026-09-26)
25 links. **24/25 clean; 1 problem** — `driver_earnings_identity_audit_test.js` red on `IDENT-09`
above. Notable: `driver_earnings_test.js` 29 passed and `driver_operations_test.js` 66 passed now
exit 0, so EARN-13/EARN-24/OPS-54 are **no longer failing** — they were state-dependent on shared
fixture money, which is itself evidence for the identity problem, not a fix for it. Cash audit 23
passed, financial authority 31 passed. `NPM_EXIT=1`.

### Identity decision
**C — pass the existing job/ticket identity into `updateEarnings`.** Not implemented: giving the
bounty path a deterministic key changes replay behaviour (a deliberate second bounty would collapse
into one), and Phase 18 forbids money-behaviour change. Requires an explicit owner decision.





