# NABIN M0.7 — Full-Stack Integration, Local Services & Release Audit Report

**Date**: 2026-10-11  
**Mode**: AUDIT & VERIFICATION (Non-mutating, zero git mutations, isolated local database)  
**Evaluator**: Senior Backend, Database, Security & Release QA Agent  
**Repository**: `C:\Users\macmi\Documents\nabin`  
**Git HEAD**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Git Remote (`origin/main`)**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Git Status**: Clean tracked working tree. Untracked test harnesses, migrations, and design files preserved untouched.

---

## 1. Executive Summary & Verification State

This audit independently verified the entire NABIN development and integration stack. Rather than relying on previous milestone summaries, all local services were inspected, restored where safe, and tested directly against real containerized PostgreSQL instances and live Playwright browser sessions.

### Key Headline Verdicts
1. **Local Stack Restoration**: **SUCCESS**. Docker Desktop Linux Engine and the local Supabase stack (`supabase_db_nabin` on port `54322`, `supabase_kong_nabin` on `54321`, `supabase_inbucket_nabin`, `supabase_storage_nabin`, and `supabase_auth_nabin`) were brought from a stopped state to `healthy`.
2. **Local Backend Live Execution**: **SUCCESS**. Node.js/Express backend on port `4000` is online with real database connectivity (`mode: SUPABASE_POSTGRES_LIVE`), active WebSockets (`ws://localhost:4000`), and real-time state synchronization (1,363 drivers, 265 users, 201 jobs, 500 ledger entries, 2,032 sessions).
3. **Dedicated E2E Harness (`e2e-tests`)**: **24/24 PASSED (8 suites, 9.07s)**. All 5 Next.js web applications responded cleanly. However, static analysis confirms these tests currently assert **browser rendering and DOM navigation using localStorage mock tokens** rather than validating real end-to-end PostgreSQL mutations.
4. **Real Backend Integration Suites**:
   - `smoke_test.js`: **5/5 PASSED** (HTTP 200 across `/api/health`, `/api/ready`, `/api/services/status`, `/api/v1/features`).
   - `admin_identity_gates_test.js`: **74/74 PASSED** (Aadhaar masking, KYC approvals, driver suspensions, role segregation).
   - `driver_operations_test.js`: **66/66 PASSED** (offer races, live dispatch, arrival, OTP verification, wallet settlement).
   - `driver_earnings_test.js`: **29/29 PASSED** (recomputed against 262 real PostgreSQL completed rows to the paisa).
   - `test_phase7_security.js`: **46/46 PASSED** (RLS on all tables, `search_path` enforcement, IDOR guards, race safety).
   - `grocery_catalog_audit_integrity_test.js`: **15/15 PASSED** (master catalogue authority, actor spoof prevention).
   - `restaurant_catalog_checkout_test.js`: **27 PASSED, 1 FAILED** (27/28 passed; 1 assertion failed due to response property naming `unit_price` vs `unit_price_snapshot`).
   - `test_migration_019.js`: **17 PASSED, 1 FAILED** (**CRITICAL DATABASE DEFECT FOUND**: atomic order creation with `p_checkout_id` crashes with PostgreSQL error `column "status" does not exist` because `public.checkouts` defines `checkout_status`).
5. **Beta / Production Remote Deployments**: **OFFLINE / NOT DEPLOYED**.
   - Candidate beta frontend `https://nabin-sooty.vercel.app` returned `HTTP 404 Not Found`.
   - Domains `api.nabin.in`, `api-beta.nabin.in`, and `admin.nabin.in` have no active public DNS records.
6. **Mobile (Flutter / Android / iOS)**:
   - Flutter unit and widget tests run cleanly on Windows (e.g. `customer_splash_test.dart`: 6/6 passed).
   - Native Android builds/tests are **BLOCKED**: missing Android SDK `cmdline-tools` and unaccepted Android SDK licenses.
   - Native iOS builds/tests are **BLOCKED**: Requires macOS and Xcode host.

---

## 2. Environment & Repository Baseline

### Version Matrix
| Component | Detected Version | Target / Constraint | Status |
|---|---|---|---|
| OS | Windows 11 Pro 64-bit (Build 26300.9457) | Windows Development Host | Verified |
| Node.js | v26.10.0 | `>=22.0.0` | Compatible |
| npm | 11.2.0 | Standard | Compatible |
| Flutter SDK | 3.47.2 (Channel stable, Dart 3.13.2) | Stable | Verified |
| Docker Engine | Docker Desktop v29.7.2 (WSL 2 backend) | Local isolated containers | Restored & Healthy |
| Local PostgreSQL | PostgreSQL 15.8 (Debian, ECR Supabase image) | `127.0.0.1:54322` | Healthy |
| Local Supabase Kong | Kong 2.8.1 | `127.0.0.1:54321` | Healthy |
| Local Next.js Apps | Next.js 16.3.8, React 19.2.8 | Ports 3000–3004 | Listening |
| Local Backend | Express 4.21.2 | `http://127.0.0.1:4000` | Online (`SUPABASE_POSTGRES_LIVE`) |

### Git State
- `git rev-parse HEAD`: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`
- `git rev-parse origin/main`: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`
- `HEAD == origin/main`: **YES** (Zero diverged commits).
- Tracked working tree: **CLEAN** (Zero modified tracked files).
- Untracked artifacts preserved:
  - `e2e-tests/` (Dedicated Playwright/E2E harness)
  - `supabase/migrations/036_restaurant_catalog_persistence_and_variants.sql`
  - `supabase/migrations/037_order_creation_customization_snapshot_atomic.sql`
  - `stitch_designs/` (UI/UX Stitch design tokens and screen specifications)
  - `qa_screenshots/`

---

## 3. Local Infrastructure Restoration & Verification

### Docker Service Recovery
At start of audit, `docker info` failed with `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`, and WSL distribution `docker-desktop` was `Stopped`.
- Diagnostic: Process `Docker Desktop.exe` had exited after previous test runs; `com.docker.service` was not registered as an auto-start Windows Service.
- Action: Launched `com.docker.backend.exe` directly under the active user session.
- Result: WSL2 engine initialized, named pipe `\\.\pipe\dockerBackendApiServer` opened, and Docker daemon became fully responsive.

### Local Container Status
```text
CONTAINER ID   NAMES                    STATUS                   PORTS
176174e7e9ea   supabase_db_nabin        Up (healthy)             0.0.0.0:54322->5432/tcp
89caab731881   supabase_kong_nabin      Up (healthy)             0.0.0.0:54321->8000/tcp
3b626b8d8009   supabase_studio_nabin    Up (healthy)             0.0.0.0:54323->3000/tcp
4bca705e96ab   supabase_storage_nabin   Up (healthy)             5000/tcp
f12621a82fb4   supabase_inbucket_nabin  Up (healthy)             0.0.0.0:54324-54326
ab5ef2bc3ca9   supabase_auth_nabin      Up (healthy)             9999/tcp
```

### PostgreSQL Direct Connection & Migration Inspection
- Executed: `docker exec supabase_db_nabin psql -U postgres -d postgres -c "SELECT version();"`
  - Returned: `PostgreSQL 15.8 on x86_64-pc-linux-gnu, compiled by gcc (GCC) 13.2.0, 64-bit`
- Migration ledger: `SELECT version FROM supabase_migrations.schema_migrations;` confirmed **35 migrations applied**, ending in `037` and `036`.
- Schema Verification for M0.6:
  - Table `public.order_lines`: Column `customization_snapshot` is present with type `jsonb` and default `'{}'::jsonb`.
  - Database function `create_order_with_lines_atomic`: Inserts `COALESCE(line->'customization_snapshot', '{}'::jsonb)` into `public.order_lines`.
  - Trigger `trg_prevent_snapshot_mutation` is active on `order_lines`.

### Backend Service Health Check
Target: `http://127.0.0.1:4000/api/health`
Response:
```json
{
  "status": "ONLINE",
  "service": "NABIN Unified Multi-App Backend",
  "version": "1.1.0",
  "environment": "development",
  "database": {
    "configured": true,
    "connected": true,
    "mode": "SUPABASE_POSTGRES_LIVE"
  },
  "activeDrivers": 6,
  "activeJobs": 167,
  "pendingIdentityVerifications": 1
}
```

---

## 4. Verification of Previous Milestones (M0, M0.5, M0.6)

### Milestone Verification Matrix
| Milestone | Claim | Audited Execution | Truthful Outcome |
|---|---|---|---|
| **M0** | Migration 036 adds restaurant variants & catalog persistence | Direct psql inspect on `public.variants`, `public.add_on_groups`, `public.add_on_options` | **VERIFIED**: Tables and constraints exist on local database. |
| **M0.5** | Real Express backend communicates with local PostgreSQL without falling back to memory | Run `smoke_test.js` and `restaurant_catalog_checkout_test.js` with `with_local_target.js` | **VERIFIED**: `SUPABASE_POSTGRES_LIVE` connected. 27/28 tests passed. |
| **M0.6** | Migration 037 persists `customization_snapshot` atomically into `public.order_lines` | Inspected function `create_order_with_lines_atomic` and executed food checkout with variants/add-ons | **PARTIALLY VERIFIED**: DB column and insert function verified. API response contract has property discrepancy (`unit_price` vs `unit_price_snapshot`). |

---

## 5. Detailed Test Execution Evidence

### 1. Dedicated E2E Harness (`e2e-tests`)
- **Command**: `npx e2e run` (in `C:\Users\macmi\Documents\nabin\e2e-tests`)
- **Harness Details**: Framework `@e2e-dev/web v0.14.0`, engine Playwright Chromium headless.
- **Execution Summary**:
  ```text
  ✓ web tests/grocery.smoke.e2e.ts (3 tests) 3.92s
  ✓ web tests/admin.smoke.e2e.ts (3 tests) 4.01s
  ✓ web tests/customer.smoke.e2e.ts (3 tests) 4.05s
  ✓ web tests/flows.orders-idempotency.e2e.ts (3 tests) 5.26s
  ✓ web tests/flows.grocery-inventory-cart.e2e.ts (3 tests) 6.00s
  ✓ web tests/flows.restaurant-customer.e2e.ts (3 tests) 6.30s
  ✓ web tests/restaurant.smoke.e2e.ts (3 tests) 2.45s
  ✓ web tests/merchant.smoke.e2e.ts (3 tests) 3.45s

  Test Files  8 passed (8)
       Tests  24 passed (24)
    Duration  9.07s
  ```
- **Critical Architectural Finding**:
  - The E2E tests seed browser `localStorage` with synthetic demo tokens (e.g. `localStorage.setItem('nabin_customer_token', 'demo-customer-token')`).
  - Next.js frontends have an internal fallback layer in `src/lib/api.ts` that intercepts failed network calls and returns hardcoded synthetic arrays.
  - **Result**: The E2E suite verifies **page rendering, component mounting, client routing, and DOM structure**, but does **NOT** constitute proof of backend API connectivity or PostgreSQL transaction safety.

### 2. Backend & Database Integration Test Suites
All backend integration tests were executed using the authoritative local environment wrapper `node scripts/with_local_target.js`, ensuring zero connection to remote Supabase instances and strict loopback target enforcement (`127.0.0.1:54321` / `127.0.0.1:54322`).

#### A. Platform Smoke Suite
- **Command**: `node scripts/with_local_target.js node smoke_test.js`
- **Result**: **5 PASSED / 0 FAILED**
- **Covers**: Liveness (`/`), Health (`/api/health`), Readiness (`/api/ready`), Service Status (`/api/services/status`), Feature flags (`/api/v1/features`).

#### B. Admin Identity & RBAC Gates
- **Command**: `node scripts/with_local_target.js node admin_identity_gates_test.js`
- **Result**: **74 PASSED / 0 FAILED**
- **Covers**:
  - PII masking on applicant queues (Aadhaar `XXXX-XXXX-4892`, Voter ID masked).
  - Explicit role-based permissions (`identity_verification.view`, `approve`, `reject`, `request_resubmission`).
  - Driver status lifecycle validation (rejecting invalid strings against SQL CHECK constraints).
  - Immediate offline enforcement upon suspension (`is_online: false`).
  - Strict audit logging attributing every mutation to the authenticated operator.

#### C. Driver Operations & Ride Lifecycle
- **Command**: `node scripts/with_local_target.js node driver_operations_test.js`
- **Result**: **66 PASSED / 0 FAILED**
- **Covers**:
  - Online/offline durability surviving restarts.
  - Dispatch offer fan-out across candidates.
  - Multi-driver race concurrency: two drivers accepting the same ride simultaneously yield exactly 1 winner and 1 conflict (`409 Conflict`), never a split or double assignment.
  - Decline durability in PostgreSQL.
  - Telemetry validation and server-side coordinate acceptance.
  - Start OTP and Delivery OTP server-authoritative verification.
  - Wallet settlement with mathematical precision (`fare = earnings + commission` to the paisa).
  - Replay protection: second completion attempt results in 0 wallet movement.

#### D. Driver Earnings & Financial Authority
- **Command**: `node scripts/with_local_target.js node driver_earnings_test.js`
- **Result**: **29 PASSED / 0 FAILED**
- **Covers**:
  - Recalculation against 262 real PostgreSQL completed rows.
  - Payout destination security: only verified bank/UPI accounts presented.
  - Tenant scoping: zero cross-driver records returned.

#### E. Forensic Security Audit (Phase 7)
- **Command**: `node scripts/with_local_target.js node test_phase7_security.js`
- **Result**: **46 PASSED / 0 FAILED**
- **Covers**:
  - Row Level Security (RLS) enabled across 100% of public PostgreSQL tables.
  - Database functions enforce explicit `SET search_path = public, pg_temp`.
  - Sensitive RPCs revoked from `anon` Supabase role.
  - Cross-customer ride cancellation IDOR rejected (`403 FORBIDDEN_NOT_OWNER`).
  - Profile and vehicle media asset IDOR protection.
  - Production OTP fail-closed guards (no static OTP in production mode).

#### F. Grocery Catalog Audit Integrity
- **Command**: `node scripts/with_local_target.js node grocery_catalog_audit_integrity_test.js`
- **Result**: **15 PASSED / 0 FAILED**
- **Covers**:
  - Merchant inventory updates restricted strictly to active master catalog products.
  - Actor spoof prevention: client-supplied actor strings cannot mint `SUPER_ADMIN` audit authority.

#### G. Restaurant Catalog & Authoritative Checkout Suite
- **Command**: `node scripts/with_local_target.js node restaurant_catalog_checkout_test.js`
- **Result**: **27 PASSED / 1 FAILED (Total: 28)**
- **Passed**: Dish creation, variant creation, add-on groups, availability toggling, unauthenticated write rejection (401), cross-tenant write rejection (403), grocery merchant restaurant access rejection (403), required add-on enforcement (`REQUIRED_ADDON_MISSING`), max add-on limit enforcement (`ADDON_LIMIT_EXCEEDED`), out-of-stock item checkout rejection, unavailable variant rejection, price tampering rejection (client ₹1 override ignored, authoritative ₹320 charged), duplicate submission idempotency.
- **Failed**: TC-20 Variant pricing override + multiple add-ons.
  - Failure Detail: `Expected values to be strictly equal: undefined !== 270`
  - Cause: In PostgreSQL mode, `OrderRepository.getOrderById` returns lines directly from table `public.order_lines`, which stores `unit_price_snapshot`. The test expected `line.unit_price`.

#### H. Migration 019 / 037 Forensic Validation Suite
- **Command**: `node scripts/with_local_target.js node test_migration_019.js`
- **Result**: **17 PASSED / 1 FAILED**
- **Passed**: Tests 1–4 (initial creation of food order, duplicate idempotency replay, reordered metadata fingerprinting, conflicting request rejection with `IDEMPOTENCY_CONFLICT`).
- **Failed**: TEST 5 (Grocery order with authoritative checkout linkage).
  - Fatal SQL Error: `error: column "status" does not exist`
  - Origin: PostgreSQL function `create_order_with_lines_atomic` line 155 executes:
    `SELECT customer_id, merchant_id, service_type, job_id, order_id, status, cancelled_at FROM public.checkouts WHERE id = p_checkout_id`
  - Defect: Table `public.checkouts` has column `checkout_status`, not `status`. Passing any non-null `p_checkout_id` causes a fatal PostgreSQL runtime error.

---

## 6. Discovered Defect Register

### Critical Defects (Blockers)
1. **DEFECT-M07-01: `create_order_with_lines_atomic` column mismatch on `checkouts`**
   - **Severity**: Critical
   - **Location**: `supabase/migrations/019_create_order_with_lines_atomic.sql` and `037_order_creation_customization_snapshot_atomic.sql`
   - **Evidence**: `test_migration_019.js` TEST 5 fails with SQL error `42703 (undefined_column): column "status" does not exist`.
   - **Impact**: Any checkout session converted into an atomic order with a checkout linkage crashes the database transaction.
   - **Remediation**: Update query in `create_order_with_lines_atomic` to select `checkout_status` instead of `status`.

2. **DEFECT-M07-02: Public Beta and Production Endpoints Dead**
   - **Severity**: Critical (Release Blocker)
   - **Evidence**:
     - `https://nabin-sooty.vercel.app`: HTTP 404
     - `api.nabin.in`: DNS resolution failed
     - `api-beta.nabin.in`: DNS resolution failed
     - `admin.nabin.in`: DNS resolution failed
   - **Impact**: Zero external beta users, drivers, merchants, or pilots can access the platform over the internet.

### High Defects
3. **DEFECT-M07-03: Web Frontend Silent Demo / Mock Fallback**
   - **Severity**: High
   - **Location**: `customer-web/src/lib/api.ts`, `admin-web/src/lib/api.ts`, `merchant-web/src/lib/api.ts`
   - **Evidence**: 431 occurrences of fallback/mock data across web apps. When the backend is unreachable, frontends synthesize fake drivers, fake orders, and fake customers without warning the user.
   - **Impact**: Operators and QA testers may believe they are viewing real live production data when they are interacting with unpersisted in-memory mocks.

4. **DEFECT-M07-04: API Order Line Response Discrepancy (`unit_price` vs `unit_price_snapshot`)**
   - **Severity**: High
   - **Location**: `backend/src/server.js:4524` and `OrderRepository.js:650`
   - **Evidence**: `restaurant_catalog_checkout_test.js` TC-20 fails because `line.unit_price` is `undefined` on PostgreSQL reads.
   - **Impact**: Clients expecting `item.unit_price` receive `undefined` when reading orders backed by PostgreSQL.

---

## 7. Flutter & Mobile Readiness Findings

1. **SDK Availability**: Flutter 3.47.2 is installed at `C:\flutter` with Dart 3.13.2.
2. **Widget & Unit Tests**: Verified functional on host (e.g. `customer_splash_test.dart` passes 6/6).
3. **Android Native Builds**: **BLOCKED**.
   - `Android toolchain`: Android SDK 36.0.0 installed, but `cmdline-tools component is missing`.
   - Android SDK licenses not accepted (`Android license status unknown`).
   - No Android emulators running or devices connected.
4. **iOS Native Builds**: **BLOCKED**.
   - Host is Windows 11; compiling or signing iOS Flutter apps requires macOS with Xcode.

---

## 8. Recommended Next Technical Actions

1. **Immediate Database Fix**: Create an additive migration to correct `status` -> `checkout_status` in `create_order_with_lines_atomic`.
2. **Backend API Normalization**: In `server.js`, project both `unit_price` and `unit_price_snapshot` onto order line responses so clients and tests receive backward-compatible schemas.
3. **Android SDK Setup**: Install Android command-line tools via Android Studio SDK Manager and execute `flutter doctor --android-licenses`.
4. **Cloud Infrastructure Provisioning**: Configure public DNS records and deploy the containerized backend and Next.js applications to a verified staging environment.
