# NABIN — Current Repository State

**Last Updated**: 2026-09-22
**Mode**: IMPLEMENTATION — verified work is committed LOCALLY only; `main` is ahead of
`origin/main` (`c974fc9`) and nothing newer has been pushed
**Status**: AUTHORITATIVE SNAPSHOT

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

---

## 1. GIT STATE

| Field | Value |
|-------|-------|
| **Current HEAD** | this docs commit, on top of the Phase 3 chain `a85ca6d` (027 + `CampaignRepository`), `2697038` (campaign API + config section), `daf82cf` (MODULE 33), `77dd9d6` (restart-run surge restore), `eb492c5` (admin login requires a username), `7a882e1` (campaign console), `2b0c55b` (Flutter renders the live campaign) — which sit on the Phase 2 chain `9da93cd`, `b4803e5`, `8e8a30e`, `80940c2`, `a0bd024` and on `d628d0c`, `5824f36`, `f759dd3`, `46ab58a`, `904acd2` |
| **origin/main** | `c974fc9` |
| **HEAD == origin/main** | NO — `main` is **18 commits ahead locally and NOT pushed** |
| **Branch** | main |

### Untracked files of record (re-verified 2026-09-22, `git status --porcelain`)

- `.kilo/agents/` — never commit (standing rule). `.kilo/` also holds two
  **registered git worktrees** (`bejewled-august`, `shiny-oboe`), so the folder
  cannot simply be deleted — that needs `git worktree remove` first.
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
| Repositories | User, Driver, Job, Ledger, Payment (Phase 13+), Promotion, SchoolChild, Advertisement, **Campaign** (`repositories/CampaignRepository.js`, 583 lines, added in Phase 3) |
| Server-driven config | `services/AppConfigService.js` composes `GET /api/app/config` sections: `services, features, offers, settings, theme, campaigns, advertisements`, 30s cache, invalidated by ad/campaign/settings/**coupon** writes |
| Test Suite | **352 passed / 1 failed of 353** (2026-09-22); the 1 is the pre-existing `gprod_5` revalidate seeding gap that also fails at older `HEAD`s |
| Cold Restart Tests | **34 passed / 0 failed** (includes the new step that restores `global_surge_multiplier` to 1.0) |
| Chaos / resilience | `chaos_audit.js` → `PASS=15 FINDING=1 BLOCKED=3 FAIL=2 NOTE=1`; CH-02 settlement race PASS; FI-01…FI-07 green; CH-08 and FI-08 open and owned |

### Flutter Mobile Apps
| App | Status |
|-----|--------|
| Customer App | Flutter 3.47, Stitch design system; reads the config feed's `campaigns` section for palette, festival logo, banner slot and gated popup (`core/widgets/nabin_campaign.dart`) — no festival content hard-coded |
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

---

## 6. KNOWN ISSUES

### Open from Phase 16 Forensic
1. **Hardcoded mock KYC** — `backend/src/database.js:440` seeds `kycStatus: 'VERIFIED'` for DRV-104 test fixture

### Open from Phase 13/14/15
2. **Mobile UI unwired** — Most mobile screens use local state rather than live API calls
3. **34 of 38 PostgreSQL tables unused** — Backend predominantly uses in-memory arrays
4. **Migration 016 formal approval workflow** — Present in authorized Git baseline via c0cdf47; explicit user approval record not yet documented (see DEC-017)
5. **Migration 017** — Absent; NOT approved for future implementation

### Open from the server-driven phases (2026-09-21/22)
6. **`gprod_5` seeding gap** — the only failing assertion in `test_suite.js`
   (`POST /api/grocery/cart/revalidate …`); it fails at older `HEAD`s too, so it is a
   fixture gap rather than a regression.
7. **CH-08** — REST `POST /api/driver/location` accepts impossible or stale fixes that
   the WebSocket path rejects with `COORDINATES_OUT_OF_RANGE` (medium).
8. **FI-08** — 3 jobs (`JOB-92412647-611`, `JOB-92768166-552`, `JOB-93587159-696`) carry
   over-entitlement bookings written by **pre-fix** chaos runs. The owner's decision is
   "leave it, report it", so the check stays red as evidence.
9. **Campaign reach** — only `CUSTOMER_HOME` renders a campaign on mobile; driver/merchant
   apps and other `surface` values store and publish but render nothing, and a campaign
   asset is a pasted URL (no in-admin Cloudinary picker).
10. **Nothing newer than `c974fc9` is pushed** and `027` is applied to the local Docker
    database only; running it against a hosted project needs explicit approval.

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
