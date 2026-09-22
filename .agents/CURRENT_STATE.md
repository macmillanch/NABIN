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
| **Current HEAD** | this docs commit, on top of the Phase 4 chain `ea4c146` (a campaign edit carries the revision it was based on), `a551dd6` (a permission check in front of every admin write, durable credential reset), `31d0d62` (password login and provisioning stop trusting memory), `cdb63aa` (restart run asks the cold backend), `e994e44` (auth fails closed instead of falling back to fixtures), `c1f3d1d` (one telemetry validator for both transports) — which sit on the Phase 3 chain `97fb57f` (docs), `2b0c55b` (Flutter renders the live campaign), `7a882e1` (campaign console), `eb492c5` (admin login requires a username), `77dd9d6` (restart-run surge restore), `daf82cf` (MODULE 33), `2697038` (campaign API + config section), `a85ca6d` (027 + `CampaignRepository`) and on the Phase 2 chain `9da93cd`, `b4803e5`, `8e8a30e`, `80940c2`, `a0bd024` and on `d628d0c`, `5824f36`, `f759dd3`, `46ab58a`, `904acd2` |
| **origin/main** | `c974fc9` |
| **HEAD == origin/main** | NO — `main` is **27 commits ahead locally and NOT pushed** |
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
| Test Suite | **408 passed / 0 failed of 408** (2026-09-22, `ea4c146`) — MODULE 36 CC-00…CC-17 covers campaign concurrency; the previously chronic `gprod_5` revalidate failure is fixed at the fixture |
| Cold Restart Tests | **35 passed / 0 failed** (includes the step that restores `global_surge_multiplier` to 1.0) |
| Auth fail-closed | `backend/auth_failclosed_test.js` **15 passed / 0 failed** (AUTH-00…06, 10…17) |
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
| Server-driven Phase 4 | IN PROGRESS (local, unpushed) | Done: telemetry validated once for both transports (`c1f3d1d`), authentication fails closed on an unreachable store (`e994e44`, `31d0d62`), a permission check in front of every admin write with a durable credential reset (`a551dd6`), and campaign concurrency — touched-columns writes, mandatory revision guard (428/412/409/400), UNIQUE code answered as 409, outage as 503, `CAMPAIGN_PARTIALLY_APPLIED` naming what landed, and the CORS headers the conditional write needs (`ea4c146`). FI-08 documented, not corrected (`97578c4`). Open: the "Still open in this phase" list in `TASKS.md` — the codebase-wide 5xx/4xx sweep, driver/merchant campaign surfaces, the campaign asset decision, mobile offline matrix, env isolation + secret scan, financial re-verification, the public-website decision, and the Phase 4 verification chain A–O |

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
10. **Nothing newer than `c974fc9` is pushed** and `027` is applied to the local Docker
    database only; running it against a hosted project needs explicit approval.
11. **`POST /api/admin/promotions` upserts on `code`** — re-issuing a code resets
    `usage_count` and inherits the old row's redemption history, so a spent limited-use
    voucher comes back to life. Fixing it to refuse conflicts with `test_suite.js:270`,
    which re-creates fixed code `FESTIVAL30` every run and asserts 200 — reported, not
    chosen for, because which of the two is the requirement is the owner's call.
12. **`GET /api/admin/promotions` caps at 50 rows with no total and no search**, so an
    older coupon is invisible to the console on a local table that now holds 539.
13. **The campaign outage branch (503 `CAMPAIGNS_UNAVAILABLE`) has no test** — auth
    fails closed before any admin token can exist during an outage, so it is verified by
    code reading and the `CHAOS_DB_DOWN=1` audit only.
14. **`Idempotency-Key` is not CORS-allowed** (only `X-Idempotency-Key` is). No browser
    client sends it today; it is a trap for the next one.
15. **Local fixture rows accumulate with no reaper** — 539 promotions, 45 campaigns, 13
    orphan "Test Basmati Rice" catalogue rows. Hygiene only; nothing financial is deleted
    by a test run unasked.
16. **`test_phase7_security.js` is red (36/9)**, partly against a route that no longer
    exists; it is outside this phase's chain and repairing it must not mean loosening it.

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
