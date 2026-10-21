# NABIN — STAGING TEST EXECUTION RESULTS & TRUTH MATRIX

**Document Reference**: `docs/NABIN_STAGING_TEST_RESULTS.md`  
**Current Date**: 11 October 2026  
**Target Release**: 1 January 2027  
**Governance Authority**: QA Lead & System Architect  

---

## 1. TEST ENVIRONMENT SCOPE & CLASSIFICATION

To maintain total transparency and adhere to NABIN governance rules, test results are explicitly categorized by their execution environment:

1. **Local Docker Environment (`127.0.0.1:54322`)**: Comprehensive multi-suite regression covering all business logic, database RPCs, and security models.
2. **Hosted Staging Cloud (`ywhxkzmbwppkdemvzlhv`)**: Real cloud PostgREST edge gateway verification and table availability.
3. **Physical Device Testing**: Real mobile hardware validation (camera, live hardware GPS, push notifications).

---

## 2. AUTOMATED REGRESSION TEST RESULTS (LOCAL STACK)

All automated test suites executed against the local PostgreSQL stack pass with zero failures. The run recorded below covered **32 suites**; two of its three numbers disagree with each other and neither is reproduced here:

- The prose total below the table says **1,309**, the table's own "Total" row says **1,309**, but summing the `Total Checks` column of its **32** suite rows gives **1,424** (measured 2026-10-12 with `awk -F'|'` over the table). An earlier revision of this section carried **1,056** in the intro line.
- Cause, as far as it can be established from the file alone: suite rows were appended across sessions without recomputing the total. The individual per-suite counts are what was printed by each run; the aggregate was maintained by hand and drifted.
- Treatment: the per-suite rows are left exactly as measured. **The aggregate is not trustworthy and must be replaced by the next full-chain run's own summary line**, not recomputed by adding these rows — several of these suites have grown since (e.g. `nabin_env_guard_test.js` is **42/42** today, and this table lists 29), so any sum of this table describes a run that no longer exists.
- **The next full-chain run arrived on 2026-10-13 and the cross-check is now measured, not asserted.** `chain_20261013_034615_84608_cd6acd` (HEAD `a48c079`, 03:46:15 → 03:58:28 IST, 732,456 ms) records a `passed` count for every link, so the **32** rows above were matched against it **by file name**. Of the **26** rows that are chain links: **21 agree exactly**; **3 have genuinely grown** — `nabin_env_guard_test.js` 29 → **42** (its own log line reads `42/42 checks passed`), `test_phase7_security.js` 46 → **48** (`📊 … 48 PASSED, 0 FAILED`), `admin_audit_fail_closed_test.js` 87 → **99** (`📊 … 99 PASSED, 0 FAILED`, by `#274`'s AR-01…AR-08 plus ST-07); and **2 differ only because the runner's own per-link count double-counts them** — `cash_ride_audit_test.js` (own summary `PHASE14_CASH_AUDIT_TEST_SUMMARY passed=22`, `metadata.json` says 44) and `financial_authority_test.js` (own `FINANCIAL_AUTHORITY_TEST_SUMMARY passed=31`, metadata says 62), so **those two rows are correct as written** and must not be "updated" to the inflated numbers. The double-count is the documented `max(markerCount, summaryCount)` behaviour in `backend/scripts/test_chain.js` and it inflates the chain aggregate too: the same replay finds a **third** affected link this run never listed here (`driver_earnings_identity_audit_test.js`, own 16, metadata 32), i.e. **69 checks of the reported 2,886 are repeats**, and 60 of the 72 links do match their own summary exactly. **6 rows are not chain links** (`smoke_test.js`, `restaurant_catalog_checkout_test.js`, `payment_production_readiness_test.js`, `test_migration_019.js`, `test_phase10_security.js`, `test_phase6_dispatch.js`), so this run establishes nothing about them, and the chain carries **46 links this table does not list at all**. The rows are deliberately **not** rewritten to today's numbers: that would present one run that never happened, which is the defect this section is about. The authoritative aggregate is now the runner's own summary row below the table, read with its inflation stated.
- **A later run the same day added a link, and it is the reason this table is now two runs deep rather than one.** `chain_20261013_064512_81908_484b69` (HEAD still `a48c079`, `durationMs` 740,272) registers **73 links** because `#294` added link 73, `admin_campaign_contract_test.js` — a new suite, so it has no earlier number to preserve and its row carries **11/11** from that run. Re-measured after the append rather than inherited: the table now holds **33** suite rows, **27** of which are links of the 73-link run and **6** of which are still not chain links at all (the same six named above), and the 73-link chain leaves **46** links this table does not list — the identical figure the cross-check reported for 72 links, because the one link added is also the one row added. **The "32 rows" and "26 rows that are chain links" above are left as written on purpose**: they describe the rows that existed when that cross-check ran, and rewriting them would make that paragraph claim a match it never performed. The two full-chain summary rows are kept separately, each labelled with its own run id, and the newer one is the current authority.
- **The newer run's aggregate carries the same inflation, and it is measured in that run rather than carried over.** It reports **2,911** checks; the three double-counting links were read back in *this* run and still print 44, 62 and 32 against their suites' own totals of 22, 31 and 16, so the same **69** repeats apply and **2,842** is the floor on the suites' own summaries. That is arithmetic on measured per-link counts, not a hand-maintained total, and it is recorded in the row.

| Test Suite / Script | Target Service / Domain | Total Checks | Result | Execution Details |
|---|---|---|---|---|
| `smoke_test.js` | Platform Connectivity & Health | 5 | **PASS (5/5)** | Probe `/`, `/api/health`, `/api/ready`, `/api/services/status`, `/api/v1/features`. |
| `admin_customers_test.js` | Admin CRM & User Directory | 87 | **PASS (87/87)** | Customer directory, balance checks, KYC status filters, audit logging. |
| `admin_authorization_test.js` | Admin RBAC & Session Security | 114 | **PASS (114/114)** | Role permission matrix, session revocation, durable state reconciliation. |
| `nabin_env_guard_test.js` | Environment Safety & Pins | 29 | **PASS (29/29)** | Cross-environment rejection, loopback safety, secret leak guards. |
| `test_phase11_feature_control.js` | Platform Governance | 24 | **PASS (24/24)** | Feature flags, independent public controls, parent-child inheritance, restart persistence. |
| `restaurant_catalog_checkout_test.js` | Restaurant Menus & Cart | 28 | **PASS (28/28)** | Menu CRUD, custom add-ons, atomic line persistence under migration 038. |
| `customer_ride_projection_test.js` | Ride Hailing Dispatch | 21 | **PASS (21/21)** | Ride fare estimation, driver job dispatch, active ride telemetry projection. |
| `driver_operations_test.js` | Driver Operations & Lifecycle | 66 | **PASS (66/66)** | Availability durability, concurrency race handling, trip start/end OTPs, earnings calculations. |
| `merchant_operations_test.js` | Merchant Security & Isolation | 93 | **PASS (93/93)** | Tenant isolation, KDS status transitions, catalog reads with variants and add-on groups. |
| `food_discovery_ordering_contract_test.js` | Food Discovery & Checkout | 52 | **PASS (52/52)** | Restaurant discovery, cart UUIDs, promo validation, zero residue on refusal. |
| `cash_ride_audit_test.js` | Financial Policy (Cash Rides) | 22 | **PASS (22/22)** | Zero cash rides allowed; all rides are online/wallet settled; server-authoritative pricing. |
| `dark_store_routes_rls_test.js` | Quick Commerce / Dark Stores | 29 | **PASS (29/29)** | Dark store lifecycle, inventory RLS, protected tables immutability. |
| `payment_production_readiness_test.js` | Payment Rails & Gateways | 11 | **PASS (11/11)** | Amount validation, HMAC-SHA256 signature, double-crediting prevention, ledger balance. |
| `support_ticket_write_guard_test.js` | Support Center Security | 48 | **PASS (48/48)** | Field bounds, SQLSTATE error classification, fail-closed database unreachability. |
| `dispatch_fanout_test.js` | Dispatch Engine Concurrency | 14 | **PASS (14/14)** | Driver offer fan-out concurrency, queue bounds, failure isolation. |
| `admin_identity_gates_test.js` | Admin Identity & PII Security | 74 | **PASS (74/74)** | PII masking (Aadhaar/Voter), KYC verification state machine, audit log immutability. |
| `admin_settings_surface_test.js` | Platform Settings Surface | 31 | **PASS (31/31)** | Setting namespacing, credential value rejection, public feed masking. |
| `geo_policy_test.js` | Geospatial Engine & Surge | 59 | **PASS (59/59)** | Coordinate validation, polygon containment, surge multiplier rules, outage fail-closed. |
| `test_migration_019.js` | Food & Grocery Checkout RPC | 52 | **PASS (52/52)** | Atomic order RPC `create_order_with_lines_atomic`, variant snapshots, fail-closed cart checks. |
| `financial_authority_test.js` | Double-Entry Accounting Ledger | 31 | **PASS (31/31)** | Append-only journal protection, balanced entry constraints, wallet balance RPC invariants. |
| `test_phase10_security.js` | Column Protection | 2 | **PASS (2/2)** | Users and drivers protected column modification blocking. |
| `test_phase7_security.js` | Platform Security / RLS | 46 | **PASS (46/46)** | Row-Level Security, search_path enforcement, IDOR prevention, fail-closed OTP checks. |
| `test_phase8_security.js` | Trigger & RPC Hardening | 28 | **PASS (28/28)** | Audit logs append-only trigger, RPC execution grants, notifications RLS. |
| `test_phase4_orders.js` | Multi-Service Orders | 66 | **PASS (66/66)** | Food and grocery order persistence, merchant KDS transitions, stale order auto-expiration. |
| `test_phase5_payments.js` | Payment & Capture Integrity | 62 | **PASS (62/62)** | HMAC-SHA256 signature verification, webhook idempotency, double-entry ledger balance invariance. |
| `test_phase6_dispatch.js` | Realtime Dispatch Security | 62 | **PASS (62/62)** | Driver offer acceptance races, start/delivery OTPs, WebSocket telemetry scoping. |
| `admin_audit_fail_closed_test.js` | Admin Fail-Closed Audit Trail | 87 | **PASS (87/87)** | Strict fail-closed audit log persistence across all admin actions. |
| `boot_mirror_read_test.js` | In-Memory Mirror Hydration | 29 | **PASS (29/29)** | In-memory cache hydration from PostgreSQL with safe pagination limits. |
| `money_idempotency_test.js` | Financial Idempotency & Concurrency | 24 | **PASS (24/24)** | Double-entry idempotency key derivation, collision prevention, concurrent RPC protection. |
| `session_reconcile_pagination_test.js` | Auth Session Reconciliation | 38 | **PASS (38/38)** | Bounded cursor pagination, active token preservation, prune racing safety. |
| `restart_test.js` | Mandatory Persistence & Server Cold Start | 40 | **PASS (40/40)** | Cold start simulation, ride/wallet/pricing persistence across termination. |
| `db_tls_policy_test.js` | Database TLS Policy & Cert Validation | 50 | **PASS (50/50)** | Local loopback plain, hosted strict TLS against pinned Supabase root CA, bypass refusal. |
| `admin_campaign_contract_test.js` | Admin Console Truthfulness (Campaigns) | 11 | **PASS (11/11)** | `#294`, added 2026-10-13 and registered as chain link 73 in the run below. Pins the console's campaign surface against the store's own contract: no `.toFixed` dereference on the by-design-null `bidRateCpm`, no revenue figure the GET route does not send, write payloads limited to keys the repository module's own refusal filters accept, success claims derived from `persisted`/`dataSource`, and the two placements that resolve `null`. Ran **RED 3/11 (8 named failure sites)** against the HEAD snapshot first, so the green is a change and not a tautology. |
| **Full-chain summary · `chain_20261013_034615_84608_cd6acd` (HEAD `a48c079`)** | **Every suite the chain runner registers, 72 links** | **2,886 as reported by the runner; 2,817 on the suites' own summaries (69 checks are repeats across 3 links — see the §2 intro)** | **PASS — 72/72 links clean, 0 problems, `verdict.exitCode: 0`, 2 skipped lines** | **The summary line the §2 intro calls for, taken from the runner's own `metadata.json`, not summed from the rows above. Wrapped against the local Docker store, 03:46:15 → 03:58:28 IST (732,456 ms). Links 48…51 ran isolated at `isolationPort: "4101"` and exited 0 with `DRIFT public: CLEAN (hard guard enforced)`; 0 non-zero exits, 0 failure marks, 0 contamination flags; the 2 skips are link 25 `driver_earnings_identity_audit_test.js` and link 54 `place_substitution_test.js`; only link 57 carries the advisory `OTP_THROTTLED` heuristic. Teardown `pid 60280 reaped`, and measured after the run: 0 listeners on `:4000`, 0 `chain_scratch` schemas, no `nabin_chain*` container** |
| ~~Total Automated Assertions (hand-maintained)~~ | **Full Platform Surface** | ~~**1,309 as written; 1,424 as summed**~~ | **SUPERSEDED by the row above** | **Retained only to record the defect: the aggregate did not equal the sum of its own rows. Nothing in this document should cite it as a total.** |
| **Full-chain summary · `chain_20261013_064512_81908_484b69` (HEAD `a48c079`)** | **Every suite the chain runner registers, 73 links** | **2,911 as reported by the runner; 2,842 on the suites' own summaries (the same 69 repeats — links 23, 24 and the `driver_earnings_identity_audit_test.js` link re-measured at 44/62/32 in this run)** | **PASS — 73/73 links clean, 0 problems, `verdict.exitCode: 0`, 2 skipped lines** | **The newest run, and the row the `#294` suite above is sourced from. Wrapped against the local Docker store, 01:15:12.828Z → 01:27:33.100Z (`durationMs` 740,272). Link 73 `admin_campaign_contract_test.js` `passed=11 failed=0`; `chain_runner_guard_test.js` 33 → **41**, which is `#293`'s CRG-33…40 and not this cycle's work, so the total moves by exactly **+19 = 11 + 8**. `harnessUnreachable: null`, `secondRunnerRefused: false`, 0 non-zero exits, 0 failure marks, 0 contamination flags, isolated links 48/49/50/51 on `4101`, the 2 skips are the same links 25 and 54 as every recent baseline, only link 57 carries the advisory OTP heuristic. Post-run, measured: 0 listeners on `:4000`, teardown `pid 11532 reaped`, no `nabin_chain*` container, read-only `pg` probe → `chain_scratch: ABSENT`, `public` 58 tables. **Caveat kept from the row above's own wording: the tree moved during this cycle** — a concurrent agent wrote `docs/` at 06:39/06:43/06:47 IST while the run was in flight and `backend/src/services/dbTls.js`, `reconcilerSecurity.js`, `reconciler_target_guard_test.js` at 06:58–07:01, after the run finished, so this is no-regression evidence for the campaign change on the tree as it stood at launch. |

---

## 3. HOSTED STAGING CLOUD TEST FINDINGS (`nabin-test`)

### Verified Working on Staging
- **Target Project Reference**: `ywhxkzmbwppkdemvzlhv` (verified via `nabinEnv.audit`, zero production refs).
- **PostgREST Edge API Gateway**: Responding with `HTTP 200 OK` using `service_role` key on `https://ywhxkzmbwppkdemvzlhv.supabase.co/rest/v1/`.
- **Database Catalog State**:
  - `platform_settings`: Verified active with 17 setting rows (HTTP 200).
  - `geo_fences`: Verified active with 3 spatial geofence rows (`zone_name` query, HTTP 200).
  - `pricing_configurations`: Verified active with 6 pricing rule rows (`service_type` query, HTTP 200).
- **Hosting Region Verified**: AWS **`ap-northeast-1`** (Tokyo), independently determined via automated cross-region discovery.
- **TLS Handshake & Certificate Verification**:
  - Pinned authoritative `backend/certs/supabase-root-2021-ca.pem` (SHA-256 `80:70:25:AD:...:CA:FA`).
  - Configured strict validation `DATABASE_SSL=require` via `backend/src/services/dbTls.js`.
  - Insecure `no-verify` workaround permanently removed and rejected for hosted targets.
- **Staging Harness (`with_staging_target.js`)**: Fail-closed on the production ref `ouxvqmhuyueklnegvmxe`, local loopback, an ambiguous configuration, a TLS bypass, and an unfilled credential. Re-measured 2026-10-12 against the real `backend/.env.staging`: exits **2** with the owner action and the line `Nothing was spawned.` — the placeholder password means the harness has never reached the pooler, so "verified active" in the sense of a completed staging run has never been true. Its checks are pinned by `backend/staging_target_guard_test.js`: **40/40**.
- **Safe Synthetic Staging Integration Tests (`test_hosted_staging_synthetic.js`)** — **reported result, no captured run artifact in the repository and not reproduced on 2026-10-12.** A repo-wide search for the script name and for `STG-11` returns only the two documents that report this run; no log file backs it. The script itself exists and is read-only for STG-01…STG-10 but STG-11/12 write to the hosted project, so reproducing the count requires an explicit owner authorisation for a hosted write. Recorded as reported, not as verified:
  - **12 / 12 checks (100%)**:
    - `STG-01` to `STG-04`: Test environment identity, prod isolation, GoTrue auth gateway (v2.197.0), OpenAPI surface.
    - `STG-05` to `STG-07`: Configuration table reads (`platform_settings`, `geo_fences`, `pricing_configurations`).
    - `STG-08` to `STG-09`: Anonymous access properly denied on `platform_settings` and `geo_fences` (Migration 029 holds).
    - `STG-10`: `platform_settings` write blocked under least-privilege (Migration 029 SELECT-only grant holds).
    - `STG-11` to `STG-12`: Synthetic `dark_stores` record inserted via `service_role` (Migration 031 DML grant verified on live staging), verified, and immediately reaped with zero residue.
  - Also found by reading the script: it loads `backend/.env.staging` directly and does **not** run through `with_staging_target.js`, so the harness gates above do not protect this path.

### Diagnostic Table Audit on Hosted Staging (service_role)
| Table | PostgREST Status | SQLSTATE | Root Cause & PostgreSQL Diagnostic Hint |
|---|---|---|---|
| `dark_stores` | **ACCESSIBLE (HTTP 200)** | — | Explicitly granted `ALL` to `service_role` in Migration 031. |
| `platform_settings` | **ACCESSIBLE (HTTP 200)** | — | Granted `SELECT` to `service_role` in Migration 029 (writes rejected with 42501). |
| `geo_fences` | **ACCESSIBLE (HTTP 200)** | — | Granted `SELECT` to `service_role` in Migration 029. |
| `pricing_configurations` | **ACCESSIBLE (HTTP 200)** | — | Granted `SELECT` to `service_role` in Migration 029. |
| `users` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.users TO service_role;` |
| `drivers` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.drivers TO service_role;` |
| `jobs` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.jobs TO service_role;` |
| `orders` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.orders TO service_role;` |
| `journal_transactions` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.journal_transactions TO service_role;` |
| `journal_lines` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.journal_lines TO service_role;` |
| `merchants` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.merchants TO service_role;` |
| `backend_sessions` | **DENIED (HTTP 403)** | `42501` | `Grant the required privileges to the current role with: GRANT SELECT ON public.backend_sessions TO service_role;` |

### Staging Blocker & Migration Synchronization Plan
- **Direct PostgreSQL Password**:
  - Target: `aws-0-ap-northeast-1.pooler.supabase.com:5432` (user `postgres.ywhxkzmbwppkdemvzlhv`).
  - Current Status: `PASTE_YOUR_DATABASE_PASSWORD_HERE` awaiting owner configuration in `backend/.env.staging`.
- **Grant Synchronization Required**:
  - Migrations 025–038 do NOT contain grants for foundational tables (`users`, `drivers`, `jobs`, `orders`, etc.).
  - Once database password is configured, the migration synchronization must include `GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;` to unblock full PostgREST accessibility on hosted staging.

---

## 4. FOUR-SERVICE WORKFLOW VERIFICATION TRUTH

| Service | Genuinely Tested & Verified | Local Test Suite | Staging Cloud Verified | Physical Device Verified | Launch Gate Status (1 Jan 2027) |
|---|---|---|---|---|---|
| **NABIN Ride** | Fare calculation, driver matching, OTP lifecycle, ledger earnings. | YES (66 + 21 pass) | REST active | NO (Hardware GPS pending) | **ACTIVE LAUNCH SERVICE** |
| **NABIN Food** | Menu browsing, customization add-ons, atomic checkout, KDS prep states. | YES (52 + 28 pass) | REST active | NO (Thermal printer pending) | **ACTIVE LAUNCH SERVICE** |
| **NABIN Grocery** | Master catalog browsing, inventory stock toggles, cart revalidation. | YES (66 pass) | REST active | NO | **DISABLED FOR TRANSACTIONS** (`GROCERY_PUBLIC_ENABLED=false`) |
| **NABIN Parcel** | Dynamic parcel fare estimate, booking endpoint, status transitions. | YES (HTTP 200) | REST active | NO | **DISABLED FOR TRANSACTIONS** (`PARCEL_PUBLIC_ENABLED=false`) |

---

## 5. DEFECTS FIXED DURING CURRENT SPRINT

1. **Admin Bootstrap Temporal Dead Zone Bug**:
   - *File*: `backend/src/server.js` (line 1620).
   - *Issue*: Duplicate block-scoped `const crypto = require('crypto')` shadowed module-level declaration, throwing `ReferenceError: Cannot access 'crypto' before initialization` during admin bootstrap attempts.
   - *Fix*: Removed redundant inner declaration.
   - *Regression Verification*: `test_phase11_feature_control.js` passed 24/24.
2. **Missing Android Location Permissions**:
   - *File*: `mobile/android/app/src/main/AndroidManifest.xml`.
   - *Issue*: Missing `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` prevented Android from granting runtime location access for maps and ride tracking.
   - *Fix*: Added required permissions.
   - *Regression Verification*: `flutter test test/widget_test.dart` passed.
3. **Android Release Keystore Integration**:
   - *File*: `mobile/android/app/build.gradle.kts`.
   - *Issue*: Hardcoded debug signing config in release builds with no mechanism to sign with production keys.
   - *Fix*: Implemented `key.properties` loading with safe debug fallback. Created `mobile/android/key.properties.example`.
