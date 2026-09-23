# NABIN — PostgREST `max_rows` Audit

Audited 2026-09-24 against the working tree at `main` (`635b406` plus uncommitted work). Environment: local Docker Supabase (`supabase_db_nabin`, Kong on `:54321`) and the Express backend on `:4000`/`:4101`, started fresh for each measurement. **Nothing was pushed, deployed, or pointed at a hosted project. No migration was written or applied. No test was weakened.**

This document answers one question the `backend_sessions` bug forced: **was that an isolated issue, or one instance of a broader architectural pattern?**

Answer: a pattern. Six of the platform's reads required a complete set and were silently capped; five were fixed in this pass alongside the sessions fix, and their `REQUIRES INVESTIGATION` siblings are recorded below with today's measured row count against the cap.

---

## 0. Verdict summary

| # | Area | Verdict |
|---|---|---|
| 1 | The cap itself, and its failure mode | **CONFIRMED** — silent, returns exactly 1000 rows, no error, no notice (`## 1`) |
| 2 | Boot state mirrors (`users`, `drivers`, `admin_accounts`, `promotions`, `geo_fences`, `surge_zones`) | **CONFIRMED pattern, FIXED** — all six now walk to a short page (`## 4.1`) |
| 3 | `backend_sessions` (auth path) | **FIXED** in the previous pass; still bounded (`## 4.1`) |
| 4 | Admin list reads that publish a newest-first window as a whole (`promotions` 815, `support_tickets` 751, `geo_fences` 445, `surge_zones` 443, `campaigns` 198) | **CAP-SENSITIVE** — recorded, deliberately not changed (`## 4.2`) |
| 5 | Per-owner reads whose owner can itself hold hundreds of rows (one customer's sessions 254, one user's tickets 561) | **CAP-SENSITIVE**, headroom measured (`## 4.2`) |
| 6 | Full-table point lookups on `admin_accounts` (`resolveAdminByPhone`, `setAdminAccountStatus`) | **REQUIRES BUSINESS DECISION** — the design comment relies on the table being staff-sized (`## 4.3`) |
| 7 | In-memory fallback mirrors with explicit `.limit()` (`jobs` 200/1821, `audit_logs` 204/26752, `ledger_entries` 500/1210, `support_tickets` 205/751) | **BOUNDED, but a labelled window** — see the outage question in `## 4.4` |
| 8 | Every remaining unbounded read (36 sites) | **SAFE / BOUNDED** by a unique-key filter, a per-parent maximum, a small domain, or an explicit limit (`## 4.5`) |
| 9 | `authoritativeRead` — the "loud store" wrapper | **CONFIRMED gap**: it turns a store *failure* into a 503; it does **not** detect a *truncated* set (`## 4.6`) |
| 10 | Is `backend_sessions` isolated? | **NO — REPRODUCED as a pattern** (`## 5`) |

---

## 1. The cap, and why it is the dangerous kind

`supabase/config.toml:8` sets `[api] max_rows = 1000`. PostgREST enforces it by answering with the first 1000 rows **and nothing else**:

```
GET backend_sessions?expires_at=gt.<now>        → 1000 rows, error = null
```

There is no error, no warning header in the client's destructured result, and no exception — the response is a perfectly valid, perfectly incomplete set. Measured live in this pass (`boot_mirror_read_test.js` **BM-00**): `orders` holds **1063** rows and a plain `.select('*')` returns **1000** of them with `error === null`.

Two properties of the cap matter for the audit:

1. **It is applied after ordering, before anything the caller does.** A `.order('created_at', desc)` read that wants "every open ticket" gets the newest 1000 and cannot tell.
2. **`count` is computed before the cap.** `count: 'exact'` and the `Content-Range` header report the true total, so the server *does* know it truncated — it just says so in a field `supabase-js` puts on `count`, not on `data`. **BM-06** proves the two disagree in one response: the client asked for 5 rows and the same reply said `count: 445`. That is why `readAllRows` asks for the count on its first page and refuses to publish a set whose length disagrees with it.

The failure mode that matters is therefore not "a query returns fewer rows" — it is "**a query returns a set that looks complete and is used as if it were**".

---

## 2. Method

1. `backend/src` was machine-scanned for every `.from('table')` chain: **167 chains, 122 reads** (the other 45 are `.update/.insert/.delete` with `.select()` — a mutation's returning set is bounded by its own `WHERE`, so the cap cannot truncate it into a lie).
2. **49 reads carry no `.limit()/.range()/.single()/.head`**, of which the scanner flagged **9 as full-table** (no filter token in the chain).
3. All 49 were then read by hand, because the scanner cannot see three shapes, each verified in the source:
   - **split builders** — `let query = store.from(t).select('*'); if (x) query = query.eq(...); await query;`. The filter is real but lives outside the chain the scanner walks (`SupportTicketRepository.getTicketsAdmin`, `OrderRepository.getOrdersByMerchant`).
   - **terminal calls after the filter** — `.limit(1).maybeSingle()` applied after an `.or()` (`DispatchRepository.getActiveAssignmentForDriver` at `jobs:283` reads as unbounded; it is a one-row read).
   - **filters applied to a builder the scanner does see but cannot judge** — `.or('id.eq.X,ticket_number.eq.Y')` + `.maybeSingle()` on a primary key (`SupportTicketRepository.getTicketById`, `attribution`, `assignTicket`, `resolveTicket`).
4. Every candidate was joined to a **live row count** (`count: 'exact', head: true`) and, where the read is per-owner, to the **maximum single-owner set size**, because "table has 156,942 rows" says nothing about a read that filters to one driver.

Scanner: `scan_reads.js` (scratch, outside the repo). Census: `census9.js`. Line numbers below are from the current working tree — this pass edited `backend/src/database.js`, which shifted everything after `readAllRows` by ~128 lines, so each citation was re-derived from the tree rather than carried over from the pass-8 notes.

---

## 3. Live census (local Docker store, 2026-09-24)

**A snapshot, and most of its tables move on their own.** Whole-store re-measurement at the close of
pass 6: `geo_fences` **447** / `surge_zones` **445** — flat from here, because the two suites that wrote
them now reap what they create (`## 6.2`) — while `promotions` **838** (652 active, was 815),
`support_tickets` **763** (was 751), `admin_accounts` **428** (was 390), `campaigns` **210**, `users` 49,
`notifications` 11,658, `audit_logs` 28,780, `dispatch_offers` 168,354, `jobs` 1,886. `backend_sessions`
measured 1,530–1,536 across pass 6's three RX/INP repeats, against 1,473 below. Only the geography pair
is under a teardown assertion; everything else in this table is a fixture counter that runs up while the
suite is run. So read every percentage in `## 4.2` and `## 4.3` as "at the time of measurement, on a
store that grows while it is tested", and the two rows the leak feeds directly — `list()` at 84% of the
cap and `getTicketsAdmin()` at 76% — as schedules rather than forecasts.

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `dispatch_offers` | 156,942 | | `geo_fences` | 445 |
| `audit_logs` | 26,752 | | `surge_zones` | 443 |
| `notifications` | 11,346 | | `admin_accounts` | 390 |
| `notification_deliveries` | 7,067 | | `device_tokens` | 372 (2 active) |
| `journal_lines` | 6,333 | | `campaigns` | 198 (0 unarchived) |
| `journal_transactions` | 3,180 | | `jobs` | 1,821 (744 non-terminal) |
| `backend_sessions` | 1,473 (1,445 active) | | `users` | 48 |
| `order_lines` | 1,219 | | `drivers` | 183 |
| `ledger_entries` | 1,210 | | `merchants` / `products` / `catalog` | 39 / 26 / 14 |
| `checkouts` | 1,078 | | `platform_settings` | 21 |
| `orders` | 1,063 | | `pricing_configurations` | 6 |
| `promotions` | 815 (632 active) | | `advertisements` | 1 |
| `support_tickets` | 751 (9 OPEN, 733 RESOLVED) | | `saved_schools` / `saved_children` | 0 |
| `promotion_redemptions` | 626 | | `payment_webhooks` | 292 |

Per-owner maxima — the numbers that decide whether a *filtered* read is at risk:

| Grouped by | Max rows in one group | Owner |
|---|---:|---|
| `support_tickets` by `user_id` | **561** | a seeded test identity |
| `backend_sessions` by `entity_id` | **254** | `usr_2` |
| `notifications` by `user_id` | 667 | a seeded test identity |
| `promotion_redemptions` by `promotion_id` | 10 | |
| `journal_lines` by `journal_id` | (column is `journal_id`, not `transaction_id`) | |
| `notification_deliveries` by `notification_id` | 4 | |
| `campaign_assets` by `campaign_id` | 4 | |
| `device_tokens` by `user_id` (`is_active`) | 2 | |
| `products` / `merchant_grocery_inventory` by `merchant_id` | 2 | |
| `order_lines` by `order_id` | 2 | |
| `dispatch_offers` where `status='OFFERED'` and unexpired | **0** (89,469 are OFFERED-but-expired) | |

---

## 4. The audit

`Potential Rows` = what this read can be asked to return on a production-shaped store. `Bounded?` = how the answer is kept finite today. `Risk` names the harm of a truncated answer, not the size of the table. Line numbers are as of this document's write-up, and `PricingRepository.js` has grown ~17 lines above `listGeoFences()` since (the `fenceIdFilter` fix) — so the **function name is the citation** and the number is a convenience.

### 4.1 Fixed: reads that require a complete set

| File | Function | Table | Potential Rows | Bounded? | Risk | Action |
|---|---|---|---:|---|---|---|
| `backend/src/database.js:5796+` | `readAllActiveSessions`, `hydrateSessions`, `reconcileSessions` | `backend_sessions` | 1,445 active | **keyset walk on `token_hash`, `pageSize 500`** | a session past row 1000 was never reconciled: it stayed live in the store after a revoke | PAGINATED — fixed in the previous pass, regression test `session_reconcile_pagination_test.js` |
| `backend/src/database.js:1674` | `initPostgres` boot mirror | `users` | 48 → unbounded | **`readAllRows` (`:5912`)** | the in-memory identity directory published a page as the whole store | PAGINATED — fixed this pass |
| `backend/src/database.js:1709` | `initPostgres` boot mirror | `drivers` | 183 → unbounded | **`readAllRows`** | a driver past row 1000 disappears from dispatch's view of the fleet | PAGINATED — fixed this pass |
| `backend/src/database.js:1866` | `initPostgres` boot mirror | `admin_accounts` | 390 → unbounded | **`readAllRows`** | an administrator whose row fell outside the page cannot sign in, and the boot log calls the store healthy | PAGINATED — fixed this pass |
| `backend/src/database.js:1962` | `initPostgres` boot mirror | `promotions` | 815 → unbounded | **`readAllRows` + `orderDesc` re-applied in memory** | coupon validation fell back to "no such code" for a real, live promotion | PAGINATED — fixed this pass |
| `backend/src/database.js:2331` | `hydrateGeoStore` (boot **and** every admin geo write) | `geo_fences` | 445 → unbounded | **`readAllRows`, inside `withDeadline`** | pricing is decided by a boundary set that silently stops at 1000; the first 1000 fences are Delhi-NCR fixtures, so the missing ones are the real ones | PAGINATED — fixed this pass. **CAP-SENSITIVE until the fixture purge in `## 6.2`** |
| `backend/src/database.js:2332` | `hydrateGeoStore` | `surge_zones` | 443 → unbounded | **`readAllRows`, inside `withDeadline`** | a surge rule the engine never loaded cannot apply — the cheapest direction to fail in | PAGINATED — fixed this pass |

`readAllRows` terminates on a short page, refuses on a repeated row, a non-advancing cursor, a page ceiling (`maxPages 40`), or a length/`count` disagreement, and in every one of those cases logs `⚠️ <table> read INCOMPLETE` and **returns nothing** — a boot that cannot get a complete set says so in its summary line rather than publishing a page. Covered by `boot_mirror_read_test.js` (20 checks, BM-00…BM-19).

### 4.2 CAP-SENSITIVE — recorded, deliberately not changed

These are all *lists a human or a screen reads*, not complete-set authorities. Each is under the cap today; each is a silent 1000-row ceiling the next time its table grows. The order's instruction was "do not automatically paginate every query", so none of these were touched; the number that should trigger the change is recorded instead.

| File | Function | Table | Potential Rows | Bounded? | Risk | Action |
|---|---|---|---:|---|---|---|
| `backend/src/repositories/PromotionRepository.js:261` | `list()` | `promotions` | **838 at pass 6's close = 84% of the cap** (815 when this table was written, and about +7 per `test_suite.js` run); every filter is optional | no | the marketing list and the coupon-browse surface quietly drop the oldest promotions | REQUIRES INVESTIGATION — `readAllRows` fits, or an explicit page size; 838/1000 says decide before the next campaign seeding. The growth rate is not organic: see `## 6.2` |
| `backend/src/repositories/SupportTicketRepository.js:441` | `getTicketsAdmin()` | `support_tickets` | **763 today = 76%** (751 at writing time, about +4 per suite run); default filter `ALL` reads the ~740 resolved tickets too, newest-first | no | a ticket older than the newest 1000 vanishes from the queue with no error | REQUIRES INVESTIGATION — the honest fix is pagination *plus* a default non-terminal filter; page size is a product decision, not applied |
| `backend/src/repositories/PricingRepository.js:260` | `listGeoFences()` | `geo_fences` | 447 today, and **flat from here** — the two suites that wrote it now reap what they create (`GEO-TEARDOWN`); 441 of the rows are still historical leaked fixtures | no | the admin map draws "every boundary" and would draw the first 1000 | CAP-SENSITIVE — growth stopped, residue not purged; ~6 real fences after the proposed purge (`## 6.2`) |
| `backend/src/repositories/PricingRepository.js:494` | `listSurgeZones()` | `surge_zones` | 445 today, all `status='ACTIVE'`, flat for the same reason | no | same | CAP-SENSITIVE — same |
| `backend/src/repositories/CampaignRepository.js:634` | `listCampaigns()` | `campaigns` | 198 today, 0 unarchived | no | the campaign console omits campaigns | CAP-SENSITIVE — 5× headroom; revisit with the campaign list's page size |
| `backend/src/database.js:6376` | `listCustomerSessions()` (`in` on `entity_id`) | `backend_sessions` | **254 for one customer today** | filtered, not limited | the security centre lists a customer's sessions so an admin can revoke them; past 1000 it lists a page and offers to revoke a page | CAP-SENSITIVE — keyset on `token_hash` is already available in this file; take it when the per-customer maximum approaches the cap |
| `backend/src/database.js:6376` | `listCustomerSessions()` (`eq phone`) | `backend_sessions` | same shape, by phone | filtered | same | CAP-SENSITIVE — same |
| `backend/src/repositories/SupportTicketRepository.js:367` | per-user ticket history | `support_tickets` | **561 for one user today = 56%** | filtered | a customer's own history truncates; they cannot see tickets they filed | CAP-SENSITIVE — a seeded identity holds 561; a real customer will not, so re-measure before deciding |

### 4.3 Full-table point lookups — a design premise, stated as a number

| File | Function | Table | Potential Rows | Bounded? | Risk | Action |
|---|---|---|---:|---|---|---|
| `backend/src/database.js:5279` | `resolveAdminByPhone()` | `admin_accounts` | **all 428 rows** (390 at write time), then filter in memory | no | identity resolution reads the whole enrolment list to answer "whose phone is this" | REQUIRES BUSINESS DECISION — the code comment states the premise out loud ("administrator tables are staff-sized, so normalising in one place costs nothing and cannot miss"), and it is a *deliberate* choice: `phone` is free-text, so `+91 98765 00000` and `+919876500000` are equal to NABIN and different to PostgREST. The premise holds at 428 and falsifies at 1000 — and this table grew 38 rows while these passes ran, which is the `## 6.2` leak reaching the identity path. Recorded, not changed: changing it means either a normalised `phone_digits` generated column (DDL → **would need a migration, which this pass does not apply**) or the same read through `readAllRows`, which fixes truncation but keeps the cost. |
| `backend/src/database.js:6978` | `setAdminAccountStatus()` | `admin_accounts` | all 428 rows | no | same | same |

### 4.4 BOUNDED windows: the in-memory fallback mirrors

`initPostgres` also hydrates four legacy in-memory arrays with explicit limits. The limit is *in the code*, so this is a stated window, not a silent page — which is the distinction the rest of this audit is about.

| File | Function | Table | Limit vs store | Verdict |
|---|---|---|---|---|
| `backend/src/database.js:1773` | jobs mirror | `jobs` | 200 of 1,821 | **BOUNDED** (explicit `.limit(200)`, newest first) |
| `backend/src/database.js:1834` | ledger mirror | `ledger_entries` | 500 of 1,210 | **BOUNDED** |
| `backend/src/database.js:1909` | support-ticket mirror | `support_tickets` | 205 of 751 | **BOUNDED** |
| `backend/src/database.js:1947` | audit-log mirror | `audit_logs` | 204 of **26,752** (0.8%) | **BOUNDED — REQUIRES INVESTIGATION**: these mirrors are what the code falls back to when the store is unreachable. A 0.8% window of the audit trail is fine as a cache and wrong as an answer; the open question is whether any read path serves them as "the audit log" during an outage rather than refusing. That is the same fail-open shape `authoritativeRead` was written to close, on the mirror side. |

### 4.5 SAFE / BOUNDED — the other 36 unbounded-flagged reads

Grouped by why the cap cannot bite. No action; changing any of these would be the "paginate everything" mistake.

| File:line | Function | Table | Bound that actually holds | Verdict |
|---|---|---|---|---|
| `SupportTicketRepository.js:401,525,622,701` | `getTicketById`, `attribution`, `assignTicket`, `resolveTicket` | `support_tickets` | `.or('id.eq.X,ticket_number.eq.Y')` / `.eq('ticket_number')` + `.maybeSingle()` on a unique column | BOUNDED (scanner artifact) |
| `DispatchRepository.js:283` | `getActiveAssignmentForDriver` | `jobs` | `.limit(1).maybeSingle()` after the filter | BOUNDED |
| `DispatchRepository.js:248` | `getOffersForDriver` | `dispatch_offers` | one driver + `status='OFFERED'` + unexpired = **0 rows today**; the table's 156,942 rows are 89,469 expired offers nobody deletes | SAFE as a read; the undeleted-expired-offers growth is a data-retention question, not a cap question |
| `OrderRepository.js:390` | `getOrderById` | `orders` | `eq id` (PK) / `eq order_number` (unique) | BOUNDED |
| `OrderRepository.js:432` | `getOrdersByMerchant` | `orders` | `.range()` with a caller `limit` (max 1,013 orders for one merchant → pagination is load-bearing and already correct) | PAGINATED |
| `OrderRepository.js:509` | `getCheckoutById` | `checkouts` | `eq id`/`checkout_id` + `.maybeSingle()` | BOUNDED |
| `CampaignRepository.js:591,592` | `findByCodeOrId` | `campaigns` | `eq id`/`code` + `.maybeSingle()` | BOUNDED |
| `CampaignRepository.js:605-608` | `getCampaign` sub-reads | `campaign_assets/offers/messages` | per campaign; max 4 rows | SAFE |
| `PricingRepository.js:139`, `database.js:1980` | `getPricingMatrix`, pricing boot mirror | `pricing_configurations` | 6 rows, and the domain is closed by a `CHECK` on service × vehicle type — it cannot grow without a migration | SAFE — **deliberately not paginated** |
| `server.js:6301`, `AppConfigService.js:332`, `FeatureControlService.js:17` | settings reads | `platform_settings` | 21 rows; bounded by the `setting_key` namespace | SAFE |
| `server.js:5290,5433` | merchant browse | `merchants` | 39 rows total, filtered by `merchant_type` | SAFE |
| `server.js:5497,5612`, `OrderRepository.js:93` | product browse | `products` | 26 rows total; max 2 per merchant | SAFE |
| `server.js:5305,5675`, `database.js:4317`, `OrderRepository.js:202`, `server.js:5632` | grocery browse | `merchant_grocery_inventory`, `master_grocery_catalog` | 14 rows each; max 2 per merchant | SAFE |
| `AdvertisementRepository.js:153` | `list()` | `advertisements` | 1 row; `eq` slot/status filters | SAFE |
| `JobRepository.js:110` | `findByIdAsync` | `jobs` | PK filter + single row | BOUNDED |
| `DriverRepository.js:437` | `updateDriverStatus` pre-read | `drivers` | `eq id` (PK) | BOUNDED |
| `NotificationRepository.js:276` | active tokens for a user | `device_tokens` | `eq user_id` + `is_active`; max 2 | SAFE |
| `NotificationRepository.js:809` | deliveries of one notification | `notification_deliveries` | `eq notification_id`; max 4 | SAFE |
| `NotificationRepository.js:846` | active templates | `notification_templates` | 17 rows | SAFE |
| `SchoolChildRepository.js:78,292` | a user's schools / children | `saved_schools`, `saved_children` | `eq user_id`; 0 rows in the store, and a user's list is a handfull by design | SAFE |
| `PromotionRepository.js:303` | `getById` | `promotions` | PK/`code` + single row | BOUNDED |
| `PromotionRepository.js:491` | `listRedemptions` | `promotion_redemptions` | `eq promotion_id`; max 10 | SAFE |

### 4.6 The gap the audit found in the wrapper itself

`authoritativeRead` / `settleAuthoritative` (`backend/src/database.js:5213`, `:5228`) is the fix from "make a silent store a loud one": a store failure becomes a 503 instead of an empty `data`. Its body is `try { return await builder } catch { throw 503 }`. **It never inspects `data.length`.** So a call site that reads a whole table through it — `resolveAdminByPhone:5279`, `setAdminAccountStatus:6978`, `listCustomerSessions:6376` — gets a *truncated* set with the same confidence as a complete one, and 4 of the 8 CAP-SENSITIVE rows above sit behind exactly that wrapper.

Verdict: **CONFIRMED gap, NOT FIXED** — the honest fix is per call site (a walk, or a filter), not a size check inside `authoritativeRead`: "more than 1000 rows came back" is only a signal when the caller's semantics are a complete set, and for the list reads in `## 4.2` a page is an acceptable answer as long as the page is *labelled*.

---

## 5. Isolated issue or architectural pattern?

**Pattern**, in three parts.

1. **The shape repeats wherever boot publishes state into memory.** Every `initPostgres` mirror wanted a complete set and none of them bounded the read: `users`, `drivers`, `admin_accounts`, `promotions`, `geo_fences`, `surge_zones` (fixed), plus four mirrors that use explicit limits and so at least state their window (`## 4.4`). `backend_sessions` was the first one *measured* to bite (1,459 rows), not the first one wrong.
2. **The shape repeats in the repository layer**, but there it is mostly harmless: 36 of 49 flagged reads are bounded by a unique key, a per-parent maximum, or a closed domain. The platform's filters are generally good; `getOrdersByMerchant` was paginated from the start.
3. **The one genuinely architectural problem is the cap's failure mode, not any single query.** A store that answers with a page and `error === null` is indistinguishable, at the call site, from a store that answers completely — and the codebase's own answer to "is the store lying" (`authoritativeRead`) was written for a different lie (`## 4.6`). Anything that reads `data` and not `count` inherits this.

---

## 6. What should happen next (not applied in this pass)

### 6.1 By priority, for the reads

1. `promotions list()` 838/1000 and `getTicketsAdmin()` 763/1000 — the two that will cross the cap under normal growth, and growing from test runs rather than users. Decide page size (product) or walk (engineering). `## 4.2`, `## 6.2`
2. `admin_accounts` full-table identity resolution — decide between a normalised phone column (needs DDL → a migration, which this pass does not apply) or a walk. `## 4.3`
3. Whether the 0.8% `audit_logs` mirror may answer a request during a store outage. `## 4.4`
4. `listCustomerSessions` when the per-customer maximum approaches 1000. `## 4.2`

### 6.2 The fixture leakage that made these numbers lie — now half fixed

Original finding, and it still holds as the reason to read the census as a *range*: `geo_fences`,
`surge_zones`, `support_tickets` and `promotions` are dominated by test fixtures no teardown removed —
`docs/GEOFENCING_SECURITY_AUDIT.md` §R8 item 5 and §R10 record the measured per-run deltas.

**What pass 6 changed.** The geography half is stopped: `test_suite.js` and `restart_test.js` now
register the ids their own creates returned and reap them, and `GEO-TEARDOWN` asserts it — pass 6's
census reads **447 → 447 fences and 445 → 445 rules across both suites**, with the three leaked family
tallies (188 Noida / 185 Hospital / 71 Restart) identical before and after each run. So
`listGeoFences()` and `listSurgeZones()` are now flat lines rather than rising ones, and their row counts
in this document stopped meaning "the leak is inflating this table" for *growth*; they still mean it for
the **441 historical duplicates already in the store**, which pass 6 proposed a purge for and did not
run.

**What pass 6 did not change.** The `promotions` and `support_tickets` leaks are open, and the drift is
visible: this document's census read 815 promotions / 751 tickets; re-measured at the close of pass 6
the same store holds **838 / 763** after three further suite runs — about +7 promotions and +4 tickets a
run. That is not a rounding difference on a cosmetic table: `list()` is at **84% of the cap** and
`getTicketsAdmin()` at 76%, and both are §6.1 priority 1 precisely because normal growth crosses 1000.
**The fixture leak and the cap audit are the same finding two ways** — a table whose rows arrive as a
side effect of running the tests is a table whose cap risk is not a forecast but a schedule.

---

## 7. Reproduction

```bash
# the cap, the walk, and the store behaviours, against the live local store:
cd backend && node boot_mirror_read_test.js            # BM-00…BM-19, 20 checks
cd backend && node session_reconcile_pagination_test.js # RC-00…RC-07, sessions family
# the census used by ## 3 (count-only, head:true): 29 tables + per-owner maxima
node <scratch>/census9.js
# the read inventory used by ## 4 (167 chains → 122 reads → 49 unbounded → 9 "full-table")
node <scratch>/scan_reads.js backend/src
```

`boot_mirror_read_test.js` and `session_reconcile_pagination_test.js` are wired into `npm test` (`backend/package.json:10`). The scratch scripts are deliberately outside the repository: they count rows and are not assertions.
