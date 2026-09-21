# NABIN — Task Tracker

**Updated**: 2026-09-21
**State**: `HEAD` = this docs commit, on top of `f759dd3` (advertisements →
PostgreSQL), `46ab58a` (chaos harness) and `904acd2` (coupons + app config);
`origin/main` = `c974fc9`, so `main` is **4 commits ahead locally and NOT pushed**.
The approved **advertisements option (c)** work (new
`backend/src/repositories/AdvertisementRepository.js` + `database.js`/`server.js`/
`AppConfigService.js`/`test_suite.js`/`restart_test.js`) is committed in `f759dd3`;
these three docs land in the commit after it.
Earlier history: the 2026-09-20/21 work reached the remote by fast-forward
`9b2804c..b13cdb3`, `55a1836` re-baselined `.agents/CURRENT_STATE.md`, and the same day's
follow-ups (`1b128e7` un-stock + merchant notification backend, `239c134` mobile
catalogue/un-stock, `9f0b4e9` + `d1381dc` docs, `dc11941` browse `is_active` fix, `c4eded7`
mobile notifications feed, `c974fc9` docs) landed on top of it.

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

