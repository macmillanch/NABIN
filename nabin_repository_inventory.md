# NABIN — Repository Inventory (Tool-Verified)

**Status**: VERIFIED INVENTORY — EVIDENCE BASED
**Owner**: SYSTEM ARCHITECT (repository inspection)
**Date**: 2026-09-20
**Mode**: PLAN-ONLY (documentation only; no application code modified)
**Compiled by**: Cline agent executing real filesystem, Git, and code-search tools

---

## 0. HOW THIS INVENTORY WAS PRODUCED

Every statement below was produced by executing a real tool against the working tree at
`C:\Users\macmi\Documents\nabin`:

| Method | Tool | Purpose |
|--------|------|---------|
| Directory listing | `Get-ChildItem` (PowerShell) | Top-level layout, per-app file trees |
| File reads | `read_files` | Governance docs, manifests, `package.json`, `pubspec.yaml`, source files |
| Code search | `search_codebase` (regex) | Route registration, middleware, API usage |
| Git inspection | `git status / rev-parse / log` | HEAD, origin/main, working tree |

No claim in this document is derived from conversation memory. Where evidence was not
found, the item is explicitly marked **UNVERIFIED**.

---

## 1. GIT STATE (VERIFIED)

| Field | Value |
|-------|-------|
| **HEAD** | `9b2804cb3ca0b791f72e723ceff4d3a2f365b850` |
| **origin/main** | `9b2804cb3ca0b791f72e723ceff4d3a2f365b850` |
| **HEAD == origin/main** | **YES** |
| **Branch** | `main` |
| **Working tree** | **DIRTY** — untracked files only (no tracked modifications reported by `git status --short`) |

Most recent commits:

```text
9b2804c (HEAD -> main, origin/main) docs(stitch): add design freeze reports and handover artifacts for 234-screen canonical set
d0f9d00 chore: fix admin-web typescript and lint errors for production build
66ac806 chore: remove unintended analyze_output.txt
691cdb3 Phase 14: UI/UX Refinement & Design System
33e9e86 chore(phase13b): eradicate UI and auth simulated workflows
9e641ed feat(admin-web): scaffold Next.js admin dashboard foundation
0b9a4e0 security(audit): remove all legacy simulated workflows
60af41d feat(customer-web): implement orders history and profile pages
```

### 1.1 Untracked work present in the tree (loss-prevention risk)

`git status --short` reports untracked paths, including **source code from previous agent
sessions that is not yet committed**:

```text
?? IMPLEMENTATION_PLAN.md
?? admin-web/src/components/AdminLayout.tsx
?? customer-web/src/components/
?? mobile/lib/features/driver/presentation/widgets/
?? mobile/lib/features/restaurant/... (see §4.4)
```

Also present are non-source artifacts whose filenames are truncated shell command text
(e.g. `ersmacmiDocumentsnabin`, `"ion\n\n: 1.0.0"`, `"pacing scale"`, `"to Implement\n (38 total)"`,
`readme.txt`, `mcp_out.txt`, `.git_diff_full.txt`, `.git_diff_stat.txt`, `.git_status.txt`).
These are command-output dumps accidentally written to the repo root by earlier agents.

> **AGENTS.md §10.2 (Checkpoint Before Risky Work)** is directly applicable: coherent
> uncommitted work must be committed and pushed before new work starts.

---

## 2. TOP-LEVEL LAYOUT (VERIFIED)

```text
C:\Users\macmi\Documents\nabin\
├── .agents\            Governance + skills (AGENTS, GOVERNANCE, CURRENT_STATE,
│                       ARCHITECTURE, DECISIONS, PHASES, HANDOFF, skills\)
├── .git\
├── .github\            CI/CD workflows
├── .kilo\              Agent tooling scratch space (git-ignored) — contains a FULL
│                       DUPLICATE WORKTREE at .kilo\worktrees\shiny-oboe\
├── .qodo\              Agent tooling config
├── admin-web\          Next.js 16 admin dashboard
├── backend\            Node.js/Express unified backend + repositories + tests
├── customer-web\       Next.js 16 customer web
├── docs\               Phase audits, forensic records, legacy ARCHITECTURE/API docs
├── mobile\             SINGLE Flutter project containing all 5 (soon 7) mobile roles
├── scratch\            Stitch manifest + generator script
├── supabase\           Migration SQL (001..016)
└── (root files)        .env.*.example, render.yaml, vercel*.json, admin_dashboard.html,
                        nabin_234_visual_qa.*, nabin_stitch_* reports/freeze artifacts,
                        task.md, IMPLEMENTATION_PLAN.md (untracked)
```

### 2.1 Documentation map — IMPORTANT DISCREPANCY

The multi-agent continuation protocol instructs agents to read `FRD.md`, `ARCHITECTURE.md`,
`RULES.md`, `DESIGN.md`, `TASKS.md`, `MEMORY.md` **at the repository root**.

**Verified result: none of those six files exist at the repository root.**

The authoritative equivalents live in `.agents/`:

| Expected root file | Actual authoritative location | Exists |
|--------------------|-------------------------------|--------|
| `FRD.md` | no equivalent located | **MISSING** |
| `ARCHITECTURE.md` | `.agents/ARCHITECTURE.md` | EXISTS |
| `RULES.md` | `.agents/GOVERNANCE.md` + `.agents/AGENTS.md` | EXISTS (renamed) |
| `DESIGN.md` | no equivalent located (Stitch freeze reports at root) | **MISSING** |
| `TASKS.md` | no equivalent located | **MISSING** |
| `MEMORY.md` | `.agents/CURRENT_STATE.md` + `.agents/HANDOFF.md` | EXISTS (renamed) |
| — | `.agents/DECISIONS.md`, `.agents/PHASES.md` | EXISTS (no root counterpart) |

**Resolution applied:** `TASKS.md` and `MEMORY.md` were created at the repository root by
this inspection so that the continuation protocol has a working state handoff, and they
point to `.agents/` as the authoritative governance source.

### 2.2 Stale documents (verified)

`.agents/CURRENT_STATE.md` (Last Updated 2026-09-07) records `HEAD = 1d404a6e...` and phase
state "Phase 18 REJECTED". Reality at inspection time is `HEAD = 9b2804c` with commits for
admin-web scaffolding, Phase 14 UI/UX refinement, simulated-workflow eradication, and Stitch
design-freeze artifacts. The snapshot is therefore **materially out of date and must be
re-baselined** (see §8).

---

## 3. APPLICATION LAYER — VERIFIED STRUCTURE

### 3.1 Flutter: ONE project, FIVE role trees (critical architectural fact)

**Verified:** `Get-ChildItem -Recurse -Filter pubspec.yaml` returns exactly **one** file:

```text
C:\Users\macmi\Documents\nabin\mobile\pubspec.yaml
```

```yaml
name: mobile
description: "NABIN Multi-App Ecosystem (Customer, Driver, Restaurant)"
version: 1.0.0+1
environment: { sdk: '>=3.4.0 <4.0.0' }
dependencies:
  flutter_riverpod: ^2.5.1
  go_router: ^14.2.0
  google_fonts: ^6.2.1
  intl: ^0.19.0
  flutter_map: ^8.3.1
  latlong2: ^0.10.1
  url_launcher: ^6.3.2
  http: ^1.2.1
```

There is **no** `mobile/apps/` directory and **no** `mobile/packages/` directory (both
commands exited 1 — path not found). There is no Melos workspace.

**Consequence:** the "NABIN Customer App", "NABIN Driver App", "NABIN Restaurant Merchant
App", "NABIN Grocery Merchant App", and "NABIN Admin App" are **not five separate Flutter
projects**. They are five *role feature trees* + five *GoRouter route trees* inside the single
`mobile` project. Any plan that assumes `mobile/apps/<name>/pubspec.yaml` does not match reality.

Dart file counts per role feature tree (verified by recursive grouping):

| Feature tree | `.dart` files | Interpretation |
|--------------|---------------|----------------|
| `features/admin` | 15 | Admin mobile app (most complete role tree) |
| `features/grocery` | 13 | Customer grocery shopping |
| `features/auth` | 10 | Shared customer auth (phone entry, OTP, personalization, identity) |
| `features/grocery_merchant` | 9 | Grocery Merchant app |
| `features/restaurant` | 6 | Restaurant Merchant app |
| `features/food` | 4 | Customer food ordering |
| `features/driver` | 2 | Driver app (**shell + 1 widget only**) |
| `features/home` | 2 | Customer home |
| `features/ride` | 2 | Customer ride booking |
| `features/account`, `activity`, `earnings`, `job`, `parcel`, `profile`, `support`, `wallet` | 1 each | Scalar screens |

### 3.2 Shared Flutter core (`mobile/lib/core/`)

```text
models\      child_model.dart, passenger_booking_info.dart, school_child_repository.dart, school_model.dart
network\     nabin_api_service.dart, nabin_ws_service.dart, session_manager.dart
router\      admin_router.dart, app_router.dart, driver_router.dart,
             grocery_merchant_router.dart, restaurant_router.dart
theme\       app_theme.dart, driver_theme.dart, restaurant_theme.dart
widgets\     driver_button.dart, driver_card.dart, driver_map_view.dart, glass_container.dart,
             nabin_button.dart, nabin_card.dart, nabin_service_card.dart,
             nabin_status_chip.dart, nabin_text_field.dart
```

`nabin_api_service.dart` is a **real** HTTP client (verified): it sets
`Authorization: Bearer <token>`, implements `sendOtp` / `verifyOtp` against
`$effectiveUrl/auth/send-otp` and `/auth/verify-otp`, and fails closed in release builds
(`StateError('NABIN_API_URL must be provided for release builds.')`).

**Verified API base URL** in `nabin_api_service.dart`:

```dart
static const String baseUrl     = 'http://10.0.2.2:4000/api'; // Android emulator -> host
static const String webBaseUrl  = 'http://localhost:4000/api';
```

### 3.3 Registered route surface (GoRouter, verified by pattern extraction)

| Router file | Routes registered |
|-------------|-------------------|
| `app_router.dart` (Customer) | `/`, `/phone-entry`, `/otp-verification`, `/personalization`, `/identity-verification-submit`, `/identity-verification-status`, `/home`, `/ride-booking`, `/active-ride`, `/parcel-booking`, `/food-home`, `/restaurant-menu`, `/food-checkout`, `/food-tracking`, `/grocery-home`, `/grocery-cart`, `/grocery-checkout`, `/grocery-categories`, `/grocery-deals`, `/wallet`, `/activity`, `/profile`, `/support`, `/driver-dashboard`, `/restaurant-dashboard` → **26** |
| `driver_router.dart` | `/`, `/login`, `/otp`, `/kyc-registration`, `/home`, `/active-job`, `/earnings`, `/account` → **8** |
| `grocery_merchant_router.dart` | `/`, `/login`, `/otp`, `/dashboard`, `/orders`, `/orders/:orderId`, `/inventory` → **7** |
| `restaurant_router.dart` | `/`, `/login`, `/otp`, `/registration`, `/dashboard` → **5** |
| `admin_router.dart` | `/`, `/login`, `/otp`, `/dashboard`, `/features`, `/users`, `/drivers`, `/merchants`, `/orders` → **9** |

Total registered mobile routes: **55**, against 176 canonical mobile screens
(48 + 38 + 32 + 30 + 28).

### 3.4 Driver app — verified evidence of near-empty implementation

Complete file list of `mobile/lib/features/driver/`:

```text
mobile\lib\features\driver\presentation\screens\driver_app_shell.dart
mobile\lib\features\driver\presentation\widgets\driver_job_offer_card.dart   <-- UNTRACKED
```

The widgets directory is untracked (`?? mobile/lib/features/driver/presentation/widgets/`),
i.e. it exists only in the local working tree and is not in `origin/main`.

### 3.5 Restaurant merchant app (Flutter) — verified evidence

```text
mobile\lib\features\restaurant\presentation\screens\restaurant_app_shell.dart
mobile\lib\features\restaurant\presentation\screens\restaurant_main_shell.dart
mobile\lib\features\restaurant\presentation\screens\restaurant_splash_screen.dart
mobile\lib\features\restaurant\presentation\screens\restaurant_login_screen.dart
mobile\lib\features\restaurant\presentation\screens\restaurant_otp_screen.dart
mobile\lib\features\restaurant\presentation\screens\restaurant_registration_screen.dart
```

Authentication and shell only. **No** orders, menu-management, KDS, or merchant-settings
screens exist — despite backend endpoints for all of them (§5.2).

### 3.6 Grocery merchant app (Flutter) — verified evidence

```text
...\grocery_merchant\presentation\providers\grocery_merchant_auth_provider.dart
...\grocery_merchant\presentation\screens\grocery_merchant_splash_screen.dart
...\grocery_merchant\presentation\screens\grocery_merchant_login_screen.dart
...\grocery_merchant\presentation\screens\grocery_merchant_otp_screen.dart
...\grocery_merchant\presentation\screens\grocery_merchant_dashboard.dart
...\grocery_merchant\presentation\screens\grocery_merchant_orders_screen.dart
...\grocery_merchant\presentation\screens\grocery_merchant_order_detail_screen.dart
...\grocery_merchant\presentation\screens\grocery_merchant_inventory_screen.dart
...\grocery_merchant\presentation\theme\grocery_merchant_theme.dart
```

This is the most complete merchant role tree (dashboard + orders + order detail + inventory).

### 3.7 Admin mobile app — verified evidence

```text
providers\  admin_auth_provider.dart, admin_drivers_provider.dart, admin_jobs_provider.dart,
            admin_merchants_provider.dart, admin_metrics_provider.dart
screens\    admin_splash_screen.dart, admin_login_screen.dart, admin_otp_screen.dart,
            admin_dashboard_screen.dart, admin_feature_controls_screen.dart,
            admin_fleet_screen.dart, admin_merchants_screen.dart,
            admin_orders_screen.dart, admin_users_screen.dart
theme\      admin_theme.dart
```

---

## 4. WEB APPLICATION LAYER (VERIFIED)

Two Next.js applications are present. Both use **Next 16.3.5 / React 19.2.8 / TypeScript 5 /
ESLint 9 / axios**. `admin-web` additionally uses **Tailwind CSS 4** and `lucide-react`;
`customer-web` has **no Tailwind dependency** (inline styles + a shared stylesheet).

### 4.1 `customer-web` — complete file list (verified)

```text
src\app\layout.tsx          src\app\page.tsx      (service dashboard, live API)
src\app\login\page.tsx      src\app\ride\page.tsx
src\app\food\page.tsx       src\app\grocery\page.tsx
src\app\parcel\page.tsx     src\app\orders\page.tsx
src\app\profile\page.tsx    src\components\Header.tsx
src\context\AuthContext.tsx src\lib\api.ts
```

8 route pages (`/` + 7 pages) against 29 canonical Customer Web requirements.
`src\lib\api.ts` is a genuine axios client with a bearer-token interceptor and typed wrappers
(`authApi`, `servicesApi`, `bookingApi`); `src\app\page.tsx` was read and verified to call
`servicesApi.getStatus()` and render live service state.

### 4.2 `admin-web` — complete file list (verified)

```text
src\app\layout.tsx
src\app\page.tsx               (dashboard: metrics + service pause/resume, live API)
src\app\login\page.tsx
src\components\AdminLayout.tsx    <-- UNTRACKED (not in origin/main)
src\components\AuthProvider.tsx
src\lib\api.ts
```

2 route pages against 29 canonical Admin Web requirements. `src\app\page.tsx` was read and
verified to call `adminApi.getMetrics()` and `adminApi.getServiceStatus()` and to toggle
services via `pauseService` / `resumeService`.

### 4.3 MERCHANT WEB APPS — CONFIRMED MISSING

```text
PS> 'restaurant-merchant-web','grocery-merchant-web','merchant-web' | % { "$_ => $(Test-Path $_)" }
restaurant-merchant-web => False
grocery-merchant-web    => False
merchant-web            => False
```

`Get-ChildItem -Directory | Where-Object { $_.Name -match 'merchant|restaurant|grocery' }`
returned **no results**.

**Conclusion:** the two new web applications required by the 9-application architecture
(**Restaurant Merchant Web**, **Grocery Merchant Web**) exist in no form — no directory, no
`package.json`, no scaffold. Status: **MISSING**.

A legacy, untracked ~7,000-line `admin_dashboard.html` prototype exists at the repository
root (and is duplicated inside the `.kilo` worktree). It is not part of any Next.js app.

### 4.4 Verified web↔backend configuration defect

| Application | Verified base URL | Backend port | Result |
|-------------|-------------------|--------------|--------|
| `customer-web\src\lib\api.ts:5` | `http://localhost:3000/api` | 4000 | **All API calls fail** |
| `admin-web\src\lib\api.ts:5` | `http://localhost:3000/api` | 4000 | **All API calls fail** |
| `mobile\lib\core\network\nabin_api_service.dart` | `http://localhost:4000/api` | 4000 | Correct |

Backend port verified at `backend\src\server.js:5757`:

```js
const PORT = process.env.PORT || 4000;
```

Both web apps also hardcode the base URL instead of reading an environment variable
(`NEXT_PUBLIC_API_URL`), which will break deployed (Render/Vercel) environments.

---

## 5. BACKEND LAYER (VERIFIED)

### 5.1 Structure

`backend\package.json` (verified):

```json
{
  "name": "nabin-unified-backend",
  "description": "Shared real-time backend API and dispatch engine for NABIN Customer, Driver, and Restaurant apps",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "node --watch src/server.js",
    "test": "node test_suite.js && node restart_test.js",
    "smoke": "node smoke_test.js"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.112.3", "cloudinary": "^2.10.1", "cors": "^2.8.5",
    "dotenv": "^17.4.2", "express": "^4.21.2", "ws": "^8.18.0"
  },
  "engines": { "node": ">=22.0.0" }
}
```

Source tree (`backend\src\`, verified):

```text
server.js      (single Express app; PORT default 4000; routes continue past line 5757)
database.js    (in-memory domain model + seed data)
supabase.js
database\persistentStore.js
repositories\  AuditLogRepository.js, DispatchRepository.js, DriverRepository.js,
               JobRepository.js, LedgerRepository.js, NotificationRepository.js,
               OrderRepository.js, PaymentRepository.js, PricingRepository.js,
               PromotionRepository.js, SchoolChildRepository.js, SupportTicketRepository.js,
               UserRepository.js
services\      cloudinaryService.js, FeatureControlService.js,
               NotificationEventBus.js, PushNotificationService.js
```

Test entry points at `backend\`: `test_suite.js`, `restart_test.js`, `smoke_test.js`, plus
per-phase suites (`test_phase4_orders.js` … `test_phase11_feature_control.js`,
`test_phase10_security.js`, `real_world_validation.js`, `cloudinary_test.js`).

> **Note:** ~40 one-off `phase10_*_probe.js` / `phaseN_*_audit.js` diagnostic scripts are
> committed in `backend\`. These are audit tooling, not product code.

### 5.2 Merchant-facing API surface (verified by route-pattern extraction)

**Restaurant Merchant — all guarded by `authenticateMerchant` + `requireMerchantTenant`:**

| Method | Endpoint | Verified at |
|--------|----------|-------------|
| GET | `/api/merchant/:restaurantId/dashboard` | `server.js:2649` |
| GET | `/api/merchant/:restaurantId/orders` (alias `/api/merchant/orders`) | `server.js:2685` |
| POST | `/api/merchant/:restaurantId/orders/:orderId/status` (alias `/api/merchant/orders/:orderId/status`) | `server.js:2710` |
| POST | `/api/merchant/:restaurantId/menu/:itemId/toggle` | `server.js:2813` |
| POST | `/api/merchant/:restaurantId/media` (alias `/api/merchant/media`) | `server.js:5081` |
| POST | `/api/merchant/:restaurantId/menu/:itemId/photo` (alias `/api/merchant/menu/:itemId/photo`) | `server.js:5142` |

**Grocery Merchant:**

| Method | Endpoint | Verified at |
|--------|----------|-------------|
| GET | `/api/merchant/inventory` | `server.js:3868` |
| POST | `/api/merchant/inventory` | `server.js:3874` |
| GET | `/api/grocery/products` | `server.js:3792` |
| GET | `/api/grocery/products/:id/history` | `server.js:3798` |
| PUT | `/api/grocery/products/:id/price` | `server.js:3804` |
| POST | `/api/grocery/products/bulk-price-update` | `server.js:3884` |
| POST | `/api/grocery/orders/:id/packed-weight` | `server.js:4088` |

Customer-side grocery endpoints a merchant console must respect:
`POST /api/grocery/cart/revalidate` (3897) and `POST /api/grocery/checkout/validate` (3904).

### 5.3 Verified authentication model for merchants

- Login is **phone OTP**, not username/password:
  `POST /api/auth/send-otp` then `POST /api/auth/verify-otp` with `{ role: 'MERCHANT' }`.
  Verified in `backend\test_phase11_feature_control.js:140`:
  `request('POST', '/api/auth/verify-otp', { phone: '+917777777777', otp: '7729', role: 'MERCHANT' })`
- Session model verified in `backend\src\database.js:118`:
  `activeSessions.set('mcht_session_dilli', { role: 'MERCHANT', entityId: 'rest_1' })`.
- Tenant isolation is enforced by `requireMerchantTenant` (declared `server.js:672`); the route
  body comment states *"Phase 8: Fail-closed (DEC-005) — no fallback to first restaurant"*, and
  `backend\test_phase4_orders.js:391` asserts cross-tenant access is blocked when a `rest_1`
  session requests `rest_2`.
- Merchant money movements run through the double-entry ledger
  (`adjust_wallet_atomic(..., p_owner_type = 'MERCHANT')`, verified in
  `backend\migrations\007_wallets_domain.sql`).

### 5.4 Admin API surface (verified samples)

`/api/admin/services/status|pause|resume|emergency-killswitch`, `/api/admin/bootstrap`,
`/api/admin/login`, `/api/admin/reset-password`, `/api/admin/me`, `/api/admin/audit-logs`,
`/api/admin/drivers`, `/api/admin/drivers/:id`, `/api/admin/drivers/:id/status`,
`/api/admin/support`, `/api/admin/support/:id/assign`, `/api/admin/support/:id/resolve`,
`/api/admin/finance/metrics`, `/api/admin/finance/ledger`,
`/api/admin/finance/settlements/drivers`,
`/api/admin/finance/settlements/drivers/:id/payout`, `/api/admin/metrics`,
`/api/admin/jobs`, `/api/admin/restaurants`, `/api/admin/restaurants/:id/status`.

Per-route RBAC is enforced through `requirePermission('<scope>')` (verified scopes include
`services.pause`, `services.resume`, `services.emergency_killswitch`, `audit.view`,
`finance.view`, `finance.settlement`, `merchant.manage`, `support.view`, `support.respond`,
`support.resolve`).

> The **total** route count in `server.js` is **UNVERIFIED** — the counting command could not
> be completed through the shell integration. Every endpoint listed above has line-level
> source evidence.

---

## 6. DATABASE LAYER (VERIFIED)

| Item | Verified state |
|------|----------------|
| `supabase\migrations\` | Migration `016_driver_kyc_payout_and_partial_refund.sql` present (`.agents/CURRENT_STATE.md` §3, DEC-008); 001–015 baseline immutable |
| `backend\migrations\` | Second migration location — `002_finance_ledger_schema.sql`, `003_extended_schema.sql`, `007_wallets_domain.sql`, `012_notifications_domain.sql` verified |
| Financial RPCs | `adjust_wallet_atomic`, `capture_payment_atomic`, `refund_payment_atomic`, `redeem_promotion_atomic`, `validate_promotion_preview` (DEC-004) |
| Merchant wallet | `p_owner_type IN ('CUSTOMER','DRIVER','MERCHANT')` → `UPDATE merchants SET wallet_balance = wallet_balance + p_amount` |
| Entity typing | `user_type IN ('CUSTOMER','DRIVER','MERCHANT','ADMIN','SYSTEM')` across `active_sessions`, `notifications`, `device_tokens` |
| Migration 017 | **ABSENT** — reverted; NOT approved (DEC-P2) |
| Remote Supabase | **OFF LIMITS** without explicit authorization |

---

## 7. STITCH CANONICAL MANIFEST — VERIFIED CONTENTS

File: `scratch\stitch_canonical_manifest.json` (11,818 bytes, `generatedAt`
`2026-09-19T18:04:24Z`, `generatedBy: canonical_manifest_generator.js`).

Top-level counts **as recorded in the file**:

```json
"totalRequirements": 234,
"verifiedRequirements": 234,
"missingRequirements": 0,
"failedRequirements": 0,
"duplicateIds": 0
```

Per-project `screenCount` **as recorded in the file**:

| Project id | Name | Type | screenCount |
|------------|------|------|-------------|
| 8177350010716545885 | NABIN — Customer App | flutter | **48** |
| 8351986305462646918 | NABIN — Driver App | flutter | **38** |
| 6214000417822217011 | NABIN — Restaurant Merchant App | flutter | **32** |
| 14026068595233675473 | NABIN — Grocery Merchant App | flutter | **30** |
| 10226544365361646201 | NABIN — Admin App | flutter | **28** |
| 9754323984525516826 | NABIN — Customer Web | nextjs | **29** |
| 17357153901300306716 | NABIN — Admin Web | nextjs | **29** |
| | | **Total** | **234** ✔ |

Arithmetic verified: 48 + 38 + 32 + 30 + 28 + 29 + 29 = **234**. The 234 figure is confirmed
from the file itself.

### 7.1 Material defect discovered in the manifest

The `canonicalRequirements` array contains exactly **46** records (verified by regex count of
`"id": "req_..."`), and **all 46 belong to `8177350010716545885` (Customer App)**.

Every other project object has an empty array, e.g.:

```json
{ "id": "8351986305462646918", "name": "NABIN — Driver App", "type": "flutter",
  "screenCount": 38, "requirements": [] }
```

**Consequence:** only 46 of 234 canonical requirements have individually identifiable records
in the repository. Per-screen traceability for the Driver, Restaurant Merchant, Grocery
Merchant, Admin, Customer Web and Admin Web projects (186 screens) **exists in no committed
file**. A claim of "234/234 implemented" cannot be audited per requirement for those 186
screens without regenerating the manifest from Stitch or re-deriving it from the design-freeze
artifacts at the repository root.

Verified metadata quote from the manifest:

> "234 canonical requirements across 7 approved Stitch projects. Excludes 110 out-of-scope
> screens (Fleet Management, Merchant Web, Support Helpdesk, Family Apps, Dark Store,
> Warehouse, Picker, separate Driver apps)."

> **Governance flag:** this exclusion note conflicts with the 9-application target, which
> requires **Restaurant Merchant Web** and **Grocery Merchant Web**. Both were explicitly
> excluded from the 234-screen set and therefore have **no canonical Stitch baseline**. Their
> design manifests must be newly derived and USER-approved before implementation
> (delivered as `scratch\restaurant_merchant_web_manifest.json` and
> `scratch\grocery_merchant_web_manifest.json`).

The 46 verified Customer App requirement IDs:

```text
req_cus_onboarding_welcome            req_cus_onboarding_phone_entry
req_cus_onboarding_otp_verification   req_cus_onboarding_personalization
req_cus_home_dashboard                req_cus_ride_booking
req_cus_ride_booking_shared           req_cus_ride_booking_rental
req_cus_ride_tracking                 req_cus_ride_active
req_cus_ride_complete                 req_cus_food_home
req_cus_food_restaurant_menu          req_cus_food_cart
req_cus_food_checkout                 req_cus_food_tracking
req_cus_grocery_home                  req_cus_grocery_store
req_cus_grocery_product_detail        req_cus_grocery_cart
req_cus_grocery_checkout              req_cus_grocery_tracking
req_cus_parcel_booking                req_cus_parcel_tracking
req_cus_orders_history                req_cus_order_detail
req_cus_profile                       req_cus_wallet
req_cus_wallet_topup                  req_cus_support
req_cus_support_ticket                req_cus_notifications
req_cus_settings                      req_cus_promotions
req_cus_referral                      req_cus_ride_scheduled
req_cus_ride_fare_estimate            req_cus_payment_methods
req_cus_address_book                  req_cus_ride_cancel
req_cus_ride_sos                      req_cus_food_reorder
req_cus_grocery_reorder               req_cus_parcel_history
req_cus_loyalty                       req_cus_ride_vehicle_selection
```

---

## 8. THE 9 INTERFACES — EXISTS / PARTIAL / MISSING (VERIFIED)

| # | Interface | Required tech | Actual location | Canonical screens | Verified status | Evidence |
|---|-----------|---------------|-----------------|-------------------|-----------------|----------|
| 1 | **Customer App** | Flutter | `mobile\lib\features\{home,ride,food,grocery,parcel,wallet,activity,profile,support,auth}` + `core\router\app_router.dart` | 48 | **PARTIAL** | 26 routes registered; 55 Dart files across the customer trees; real API service; several screens still local-state per `.agents/CURRENT_STATE.md` §6 |
| 2 | **Driver App** | Flutter | `mobile\lib\features\driver\` + `core\router\driver_router.dart`, `core\theme\driver_theme.dart` | 38 | **PARTIAL (thin)** | 8 routes registered, but only **2** Dart files exist (shell + 1 untracked widget) |
| 3 | **Restaurant Merchant App** | Flutter | `mobile\lib\features\restaurant\` + `core\router\restaurant_router.dart`, `core\theme\restaurant_theme.dart` | 32 | **PARTIAL (auth only)** | 5 routes; 6 Dart files: splash/login/otp/registration + 2 shells. No orders, menu or KDS screens |
| 4 | **Grocery Merchant App** | Flutter | `mobile\lib\features\grocery_merchant\` + `core\router\grocery_merchant_router.dart` | 30 | **PARTIAL** | 7 routes; 9 Dart files incl. dashboard, orders, order detail, inventory |
| 5 | **Admin App** | Flutter | `mobile\lib\features\admin\` + `core\router\admin_router.dart` | 28 | **PARTIAL** | 9 routes; 15 Dart files incl. metrics/drivers/jobs/merchants providers |
| 6 | **Customer Web** | Next.js + TS | `customer-web\` | 29 | **PARTIAL** | 8 pages, live axios API client, but wrong base port (§4.4) |
| 7 | **Admin Web** | Next.js + TS | `admin-web\` | 29 | **PARTIAL** | 2 pages; `AdminLayout.tsx` untracked; wrong base port (§4.4) |
| 8 | **Restaurant Merchant Web** | Next.js + TS | — | no canonical baseline | **MISSING** | `Test-Path` = False; no directory, no `package.json` |
| 9 | **Grocery Merchant Web** | Next.js + TS | — | no canonical baseline | **MISSING** | `Test-Path` = False; no directory, no `package.json` |

**Supporting shared layers (all EXIST):**

| Layer | Location | Status |
|-------|----------|--------|
| Unified backend | `backend\src\server.js` + `database.js` + `repositories\` + `services\` | EXISTS |
| Database | `supabase\migrations\` (001–016) + `backend\migrations\` | EXISTS |
| Shared design/report artifacts | repository root (`nabin_stitch_*`, `nabin_234_visual_qa.*`) | EXISTS |
| Canonical manifest | `scratch\stitch_canonical_manifest.json` | EXISTS (partial — §7.1) |

**Score: 7 interface(s) EXIST (all PARTIAL) / 2 MISSING.**

---

## 9. ANOMALIES, RISKS & GOVERNANCE FLAGS (VERIFIED)

| # | Finding | Severity | Evidence |
|---|---------|----------|----------|
| 1 | **Duplicate repository worktree** at `.kilo\worktrees\shiny-oboe\` containing its own `backend\src\server.js`, `docs\` and `.agents\` copy. Git-ignored (absent from `git status`), but it pollutes every code search and can be mistaken for the real source tree. | HIGH | `search_codebase` returned results from this path for nearly every query |
| 2 | **Untracked source code in the working tree** — `mobile\lib\features\driver\presentation\widgets\`, `customer-web\src\components\`, `admin-web\src\components\AdminLayout.tsx`. If the working tree is lost, this work is lost. | HIGH | `git status --short` |
| 3 | **Web apps point at the wrong backend port** (3000 vs 4000) and hardcode it — both web apps currently cannot authenticate or load data. | HIGH | `customer-web\src\lib\api.ts:5`, `admin-web\src\lib\api.ts:5`, `server.js:5757` |
| 4 | **Manifest traceability gap** — only 46 of 234 requirements have records (§7.1). | HIGH | regex count = 46 |
| 5 | **Merchant web apps absent** although the target architecture is 9 applications. | HIGH | `Test-Path` False |
| 6 | **Stale governance snapshot** — `.agents\CURRENT_STATE.md` states HEAD `1d404a6`; actual HEAD is `9b2804c`, and newer work (admin-web scaffold, Phase 14 UI/UX refinement, simulated-workflow eradication) is absent from phase history. | MEDIUM | `git log` vs `CURRENT_STATE.md` §1/§5 |
| 7 | **Junk artifacts at repository root** with truncated shell-command names (`ersmacmiDocumentsnabin`, `"ion 1.0.0"`, `"pacing scale"`, `readme.txt`, `mcp_out.txt`, `.git_diff_*.txt`, `.git_status.txt`, `admin_dashboard.html`, `task.md`, `IMPLEMENTATION_PLAN.md`). | MEDIUM | `Get-ChildItem -Force` |
| 8 | **Untracked `IMPLEMENTATION_PLAN.md` at root** — an implementation plan from a previous agent, not in version control and not referenced by `.agents\PHASES.md`. | MEDIUM | `git status` |
| 9 | **Two migration locations** (`supabase\migrations\` and `backend\migrations\`) with overlapping numbering (002/003/007/012 exist in both). Governance restricts migrations but never states which directory is authoritative. | MEDIUM | directory listings |
| 10 | **No `FRD.md` / `DESIGN.md` anywhere** — the continuation protocol requires reading them; design intent exists only in Stitch freeze reports. | MEDIUM | `read_files` ENOENT |
| 11 | Legacy `docs\ARCHITECTURE.md` and `docs\IMPLEMENTATION_GAP_AUDIT.md` still contain DarkStore terminology contradicting DEC-010/DEC-R1 (already logged in `CURRENT_STATE.md` §7). | LOW | documented |
| 12 | `backend\` contains ~40 committed one-off probe/audit scripts mixed with product code. | LOW | directory listing |

---

## 10. EXACT NEXT ACTIONS (RECOMMENDED — NOT YET AUTHORIZED)

1. **Checkpoint the tree** (`AGENTS.md` §10.2): after USER approval, commit + push the
   coherent untracked work (`AdminLayout.tsx`, `customer-web\src\components\`,
   `driver_job_offer_card.dart`), then delete the truncated-filename junk artifacts.
2. **Fix the web↔backend port mismatch** (§4.4) and move both web apps to
   `NEXT_PUBLIC_API_URL`. Smallest possible, highest-leverage change; verifiable with
   `npm run build` + `npm run lint` in both web apps.
3. **Re-baseline `.agents\CURRENT_STATE.md`** so HEAD, phases and known issues match reality.
4. **USER decision required:** approve the derived Restaurant/Grocery Merchant Web manifests
   (`scratch\*_merchant_web_manifest.json`) before any scaffolding begins, because those two
   apps were explicitly excluded from the frozen 234-screen Stitch baseline.
5. **Largest genuine gaps** (need full phases, not ad-hoc patches): Driver Flutter app
   (38 canonical screens / 2 files) and Restaurant Merchant app (32 canonical screens /
   auth-only).

---

## 11. VERIFICATION STATEMENT

- Every path, count and code fragment in this document was read from the working tree during
  this inspection session.
- Two items are explicitly **UNVERIFIED**: the total route-definition count in
  `backend\src\server.js`, and the contents of `supabase\migrations\` beyond what
  `.agents\CURRENT_STATE.md` documents (files were not individually listed).
- No application source file was modified. No migration, commit, or push was performed.








