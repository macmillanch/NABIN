# NABIN — 234 Canonical Requirements: Implementation Gap Report

**Status**: VERIFIED GAP REPORT — EVIDENCE BASED
**Date**: 2026-09-20
**Mode**: PLAN-ONLY (no application code modified)
**Companion document**: `nabin_repository_inventory.md` (repository evidence)

---

## 0. METHODOLOGY AND HONEST LIMITATIONS

### 0.1 What was inspected

Classification below is based on real inspection of the working tree:
`pubspec.yaml`, `package.json`, Dart feature trees, GoRouter route registrations,
Next.js page files, `src/lib/api.ts` clients, and `backend/src/server.js` route definitions.
No classification is derived from filenames alone where a stronger signal existed.

### 0.2 Hard limitation — per-screen traceability does not exist

`scratch/stitch_canonical_manifest.json` records `totalRequirements: 234` and
`verifiedRequirements: 234`, but its `canonicalRequirements` array contains **46** records, and
**all 46 belong to the Customer App**. The other six projects each carry
`"requirements": []`.

Therefore:

- For the **Customer App (48 screens)** — 46 requirement IDs are known by name and are mapped
  in §3.
- For the **Driver, Restaurant Merchant, Grocery Merchant, Admin, Customer Web and Admin Web
  projects (186 screens)** — no per-screen requirement list exists in any committed file.
  These are classified **at domain level** using verified route registrations, file presence,
  and backend endpoint availability. Per-screen status claims are impossible without either
  regenerating the manifest from Stitch or re-deriving per-screen records from the design
  freeze artifacts at the repository root.

Any statement in this document of the form "N of M screens implemented" would be unverifiable
and is deliberately not made.

### 0.3 Classification definitions

| Label | Meaning (evidence standard) |
|-------|-----------------------------|
| **IMPLEMENTED** | Screen/flow exists in code **and** is wired to a real backend endpoint. |
| **PARTIAL** | Screen/route exists but wiring, completeness, or depth is unverified/absent. |
| **MISSING** | No route, no file, no scaffold. |
| **BLOCKED** | Cannot reach IMPLEMENTED without a backend endpoint, migration, or a USER decision that does not currently exist. |

---

## 1. CANONICAL BASELINE FACTS (FROM THE FILE)

| Project | Type | Canonical screens | Percentage of 234 |
|---------|------|-------------------|-------------------|
| NABIN — Customer App | flutter | 48 | 20.5% |
| NABIN — Driver App | flutter | 38 | 16.2% |
| NABIN — Restaurant Merchant App | flutter | 32 | 13.7% |
| NABIN — Grocery Merchant App | flutter | 30 | 12.8% |
| NABIN — Admin App | flutter | 28 | 12.0% |
| NABIN — Customer Web | nextjs | 29 | 12.4% |
| NABIN — Admin Web | nextjs | 29 | 12.4% |
| **Total** | | **234** | **100%** |

Two applications required by the 9-application target — **Restaurant Merchant Web** and
**Grocery Merchant Web** — are **not in the 234**. They were explicitly excluded by the
manifest metadata. They therefore have **no canonical baseline and no screen budget**; the
derived manifests in `scratch/` must be approved to create one.

---

## 2. APPLICATION-LEVEL VERIFIED STATUS

| # | Application | Canonical | Verified status | Decisive evidence |
|---|-------------|-----------|-----------------|-------------------|
| 1 | Customer App (Flutter) | 48 | **PARTIAL** | 26 routes; 2 requirement IDs IMPLEMENTED, 21 PARTIAL, 23 MISSING (§3) |
| 2 | Driver App (Flutter) | 38 | **PARTIAL (thin)** | 8 routes but only 2 Dart files; `driver_job_offer_card.dart` untracked |
| 3 | Restaurant Merchant App (Flutter) | 32 | **PARTIAL (auth only)** | 5 routes; no orders/menu/KDS screens |
| 4 | Grocery Merchant App (Flutter) | 30 | **PARTIAL** | 7 routes; dashboard/orders/order-detail/inventory exist |
| 5 | Admin App (Flutter) | 28 | **PARTIAL** | 9 routes; 15 Dart files with real providers |
| 6 | Customer Web (Next.js) | 29 | **PARTIAL / functionally BLOCKED** | 8 pages + real axios client, but base URL points to port 3000 while backend serves 4000 |
| 7 | Admin Web (Next.js) | 29 | **PARTIAL / functionally BLOCKED** | 2 pages + real axios client, same port defect |
| 8 | Restaurant Merchant Web | — | **MISSING** | Directory/`package.json` do not exist |
| 9 | Grocery Merchant Web | — | **MISSING** | Directory/`package.json` do not exist |

---

## 3. CUSTOMER APP — 46 KNOWN REQUIREMENT IDS CLASSIFIED (48 screens)

Route evidence: `mobile/lib/core/router/app_router.dart` registers 26 routes.
File evidence: `features/auth` (10), `features/home` (2), `features/ride` (2), `features/food` (4),
`features/grocery` (13), `features/parcel` (1), `features/wallet` (1), `features/activity` (1),
`features/profile` (1), `features/support` (1).

### 3.1 Onboarding & identity

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_onboarding_welcome` | PARTIAL | `/` route exists; splash/welcome wiring unverified |
| `req_cus_onboarding_phone_entry` | **IMPLEMENTED** | `/phone-entry` route; documented as fully integrated with `NabinApiService.sendOtp` |
| `req_cus_onboarding_otp_verification` | **IMPLEMENTED** | `/otp-verification` route; documented as fully integrated with `NabinApiService.verifyOtp` |
| `req_cus_onboarding_personalization` | PARTIAL | `/personalization` route exists; API wiring unverified |
| (identity, no canonical ID) | PARTIAL | `/identity-verification-submit`, `/identity-verification-status` routes exist |

### 3.2 Home

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_home_dashboard` | PARTIAL | `/home` route; `features/home` has 2 files; service list wiring unverified |

### 3.3 Ride (11 requirements)

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_ride_booking` | PARTIAL | `/ride-booking` route exists but documented as **not** calling `NabinApiService.bookRide` (local object + navigation) |
| `req_cus_ride_vehicle_selection` | PARTIAL | Selection UI exists inside booking flow; `POST /api/pricing/estimate` documented as unused |
| `req_cus_ride_active` | PARTIAL — **contains mock data** | `/active-ride` renders hardcoded driver info (`Rajesh Kumar`, `DL 1RA 4892`) and opens WS with dummy user id `cust_active` (documented in `docs/PHASE_12_DOMAIN_READINESS_AUDIT.md:158`) |
| `req_cus_ride_fare_estimate` | PARTIAL | Hardcoded fares (₹45/₹85/₹160) documented instead of live estimate |
| `req_cus_ride_booking_shared` | **MISSING** | No route, no file |
| `req_cus_ride_booking_rental` | **MISSING** | No route, no file |
| `req_cus_ride_tracking` | **MISSING** | No dedicated route/file |
| `req_cus_ride_complete` | **MISSING** | No route/file |
| `req_cus_ride_scheduled` | **MISSING** | No route/file |
| `req_cus_ride_cancel` | **MISSING** | No route/file (backend `POST /api/customer/cancel-ride` exists → screen-side gap only) |
| `req_cus_ride_sos` | **MISSING** | No route/file |

### 3.4 Food (6 requirements)

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_food_home` | PARTIAL | `/food-home` route; `features/food` has 4 files; backend `POST /api/customer/book-food` exists |
| `req_cus_food_restaurant_menu` | PARTIAL | `/restaurant-menu` route exists |
| `req_cus_food_cart` | **MISSING** | No `/food-cart` route registered |
| `req_cus_food_checkout` | PARTIAL | `/food-checkout` route exists |
| `req_cus_food_tracking` | PARTIAL | `/food-tracking` route exists |
| `req_cus_food_reorder` | **MISSING** | No route/file |

### 3.5 Grocery (7 requirements)

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_grocery_home` | PARTIAL | `/grocery-home` route; `features/grocery` has 13 files |
| `req_cus_grocery_store` | PARTIAL | `/grocery-categories` route; backend `GET /api/grocery/products` exists |
| `req_cus_grocery_product_detail` | **MISSING** | No product-detail route registered |
| `req_cus_grocery_cart` | PARTIAL | `/grocery-cart` route; backend `POST /api/grocery/cart/revalidate` exists |
| `req_cus_grocery_checkout` | PARTIAL | `/grocery-checkout` route; backend `POST /api/grocery/checkout/validate` exists |
| `req_cus_grocery_tracking` | **MISSING** | No tracking route registered |
| `req_cus_grocery_reorder` | **MISSING** | No route/file |

### 3.6 Parcel, orders, wallet, account

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_parcel_booking` | PARTIAL | `/parcel-booking` route; backend `POST /api/customer/book-parcel` exists; no `/api/driver/verify-otp` dual-OTP UI verified |
| `req_cus_parcel_tracking` | **MISSING** | No route/file |
| `req_cus_parcel_history` | **MISSING** | No route/file |
| `req_cus_orders_history` | **MISSING (mobile)** | No `/orders` route in `app_router.dart` (backend `GET /api/customer/orders` exists; `customer-web` has an `/orders` page) |
| `req_cus_order_detail` | **MISSING (mobile)** | No order-detail route; backend `GET /api/customer/orders/:id` exists |
| `req_cus_wallet` | PARTIAL — **static data** | `/wallet` route; documented as rendering static balances instead of `GET /api/auth/me` |
| `req_cus_wallet_topup` | PARTIAL | Routed inside wallet; payment RPCs exist server-side |
| `req_cus_profile` | PARTIAL | `/profile` route exists |
| `req_cus_support` | PARTIAL | `/support` route; documented as integrated with `NabinApiService.submitSupportTicket` |
| `req_cus_support_ticket` | PARTIAL | Same screen; backend `POST /api/support/ticket` exists |

### 3.7 Marketing, settings, remaining domains (all MISSING in mobile)

| Requirement ID | Status | Evidence |
|----------------|--------|----------|
| `req_cus_notifications` | **MISSING** | No route/file although `GET /api/notifications*` and `NotificationRepository` exist server-side |
| `req_cus_settings` | **MISSING** | No route/file |
| `req_cus_promotions` | **MISSING** | No route/file (promotion RPCs exist server-side) |
| `req_cus_referral` | **MISSING** | No route/file |
| `req_cus_loyalty` | **MISSING** | No route/file |
| `req_cus_payment_methods` | **MISSING** | No route/file |
| `req_cus_address_book` | **MISSING** | No route/file |

### 3.8 Customer App totals

| Classification | Count |
|----------------|-------|
| IMPLEMENTED | **2** |
| PARTIAL | **21** |
| MISSING | **23** |
| BLOCKED (acceptance-blocking mock data) | **2** screens (`active-ride`, `wallet`) |
| **Total known IDs** | **46** |

> Remaining 2 of 48 canonical Customer App screens have no requirement record and could not be
> individually classified.

> **Governance note:** the two screens containing hardcoded mock data contradict the
> permanent rule *"No mock bypasses in production code paths"* (`.agents/ARCHITECTURE.md` §8)
> and the audit trigger *"Any synthetic data fallback in production paths"*
> (`.agents/GOVERNANCE.md` §10). They must not be counted as delivered.

---

## 4. DRIVER APP — DOMAIN-LEVEL CLASSIFICATION (38 screens, 8 routes)

Canonical screens: **38**. Routes: **8**. Dart files under `features/driver`: **2**.

| Domain | Status | Evidence |
|--------|--------|----------|
| Login / OTP | PARTIAL | `/login`, `/otp` routes; `driver_router.dart` |
| KYC registration | **BLOCKED** | `/kyc-registration` route exists, but Phase 16 forensics record hardcoded mock KYC (`kycStatus: 'VERIFIED'`) and synthetic VPA fallback; these must be remediated before driver KYC can be accepted |
| Duty / home shell | PARTIAL | `/home` route; `driver_app_shell.dart` |
| Job offers / dispatch accept | PARTIAL | `driver_job_offer_card.dart` exists but is **UNTRACKED**; backend `POST /api/driver/accept-job` verified |
| Active job + trip OTP | PARTIAL | `/active-job` route; backend `POST /api/driver/verify-otp` with `otpType` PICKUP/DELIVERY verified in `backend/real_world_validation.js` |
| Earnings | **BLOCKED** | `/earnings` route; `GET /api/driver/:id/earnings` is documented as secure, but `POST /api/driver/payout` payout-destination defect (DEC-015/DEC-016) is unremediated |
| Account / profile / vehicle photos | PARTIAL | `/account` route; backend `POST /api/driver/profile/photo`, `POST /api/driver/vehicle/photo` verified |
| Remaining ~30 canonical screens (navigation, ride/parcel/food/grocery delivery flows, proof-of-delivery, incentives, support, settings, history) | **MISSING** | No additional routes or files exist. Only 2 Dart files exist for the entire 38-screen app |

**Verdict:** PARTIAL (thin). Largest single implementation gap in the platform when measured
against canonical scope, and partly BLOCKED by unremediated Phase 16 security findings.

---

## 5. RESTAURANT MERCHANT APP (FLUTTER) — DOMAIN-LEVEL (32 screens, 5 routes)

Canonical screens: **32**. Routes: **5** (`/`, `/login`, `/otp`, `/registration`, `/dashboard`).
Files: **6** (splash, login, otp, registration, app shell, main shell).

| Domain | Status | Evidence |
|--------|--------|----------|
| Splash / login / OTP | PARTIAL | Routes + files exist |
| Registration / onboarding | PARTIAL | `/registration` route + file exist |
| Dashboard shell | PARTIAL | `/dashboard` route; `restaurant_main_shell.dart` |
| Live order queue + order detail | **MISSING (backend ready)** | Backend `GET /api/merchant/:restaurantId/orders` and `POST .../orders/:orderId/status` verified; no Flutter route or screen |
| KDS / kitchen workflow | **MISSING (backend ready)** | Order status transitions verified; no KDS screen |
| Menu management | **MISSING / BLOCKED** | Only `POST .../menu/:itemId/toggle` and `.../menu/:itemId/photo` verified; no menu read/CRUD endpoint exists, so a menu screen would be BLOCKED without a backend addition |
| Store profile / hours / status | **MISSING / BLOCKED** | No merchant store-config endpoint verified |
| Settlements / reports / promotions / reviews / notifications / settings | **MISSING / BLOCKED** | No merchant-side endpoints verified |

**Verdict:** PARTIAL (authentication and shell only). ~27 of 32 screens have no implementation,
and a meaningful subset cannot be implemented without backend additions.

---

## 6. GROCERY MERCHANT APP (FLUTTER) — DOMAIN-LEVEL (30 screens, 7 routes)

Canonical screens: **30**. Routes: **7** (`/`, `/login`, `/otp`, `/dashboard`, `/orders`,
`/orders/:orderId`, `/inventory`). Files: **9**. This is the most complete merchant tree.

| Domain | Status | Evidence |
|--------|--------|----------|
| Splash / login / OTP | PARTIAL | Routes + files; `grocery_merchant_auth_provider.dart` |
| Dashboard | PARTIAL | `grocery_merchant_dashboard.dart` |
| Order queue | PARTIAL | `grocery_merchant_orders_screen.dart` |
| Order detail / packing | PARTIAL | `grocery_merchant_order_detail_screen.dart`; backend `POST /api/grocery/orders/:id/packed-weight` verified |
| Inventory management | PARTIAL | `grocery_merchant_inventory_screen.dart`; backend `GET`/`POST /api/merchant/inventory` verified |
| Pricing governance (single + bulk + history) | **MISSING (backend ready)** | `PUT /api/grocery/products/:id/price`, `POST /api/grocery/products/bulk-price-update`, `GET /api/grocery/products/:id/history` verified; no Flutter screen |
| Catalog browse (master catalog) | **MISSING (backend ready)** | `GET /api/grocery/products` verified; no Flutter screen |
| Store profile / hours / status | **MISSING / BLOCKED** | No merchant store-config endpoint verified |
| Settlements / reports / notifications / settings | **MISSING / BLOCKED** | No merchant-side endpoints verified |

**Verdict:** PARTIAL — strongest merchant implementation, with an identified
"backend-ready but UI-missing" cluster (pricing governance + catalog browse) that is the
cheapest high-value increment in the whole platform.

> **Business-rule compliance:** no dark-store, warehouse, picker, or central-fulfillment
> construct was found in this feature tree. The merchant packs from its own shelf stock, which
> is consistent with `.agents/ARCHITECTURE.md` §2.2.

---

## 7. ADMIN APP (FLUTTER) — DOMAIN-LEVEL (28 screens, 9 routes)

Canonical screens: **28**. Routes: **9** (`/`, `/login`, `/otp`, `/dashboard`, `/features`,
`/users`, `/drivers`, `/merchants`, `/orders`). Files: **15**, including five real Riverpod
providers (`admin_metrics_provider`, `admin_drivers_provider`, `admin_jobs_provider`,
`admin_merchants_provider`, `admin_auth_provider`).

| Domain | Status | Evidence |
|--------|--------|----------|
| Auth (splash/login/OTP) | PARTIAL | Routes + files + `admin_auth_provider.dart` |
| Dashboard / metrics | PARTIAL | `/dashboard`; `admin_metrics_provider.dart`; backend `GET /api/admin/metrics` verified |
| Feature controls | PARTIAL | `/features`; backend `POST /api/admin/services/pause|resume|emergency-killswitch` verified |
| Users | PARTIAL | `/users` route + file |
| Drivers / fleet | PARTIAL | `/drivers`; backend `GET /api/admin/drivers`, `POST /api/admin/drivers/:id/status` verified |
| Merchants | PARTIAL | `/merchants`; backend `GET /api/admin/restaurants`, `POST /api/admin/restaurants/:id/status` verified |
| Orders / jobs | PARTIAL | `/orders`; backend `GET /api/admin/jobs` verified |
| Audit logs | **MISSING** | Backend `GET /api/admin/audit-logs` verified; no Flutter route/screen |
| Finance / settlements / payouts | **MISSING** | Backend `GET /api/admin/finance/metrics|ledger`, settlements and payout routes verified; no Flutter screen |
| Support console | **MISSING** | Backend `GET /api/admin/support`, assign/resolve verified; no Flutter screen |
| KYC / identity review | **MISSING** | No Flutter route; related backend flows exist |
| Geofences / surge / zones | **MISSING** | No Flutter route; pricing/geofence endpoints documented |
| Remaining canonical screens | **MISSING** | 9 of 28 routes present |

**Verdict:** PARTIAL — the mobile admin app covers roughly a third of its canonical scope,
while the backend already exposes substantially more admin capability than the app consumes.

---

## 8. CUSTOMER WEB (NEXT.JS) — DOMAIN-LEVEL (29 screens, 8 pages)

Routes: `/`, `/login`, `/ride`, `/food`, `/grocery`, `/parcel`, `/orders`, `/profile`.
Real axios client with bearer interceptor and typed `authApi` / `servicesApi` / `bookingApi`.

| Domain | Status | Evidence |
|--------|--------|----------|
| Service dashboard | PARTIAL | `src/app/page.tsx` verified calling `servicesApi.getStatus()` and rendering live service state and pause notices |
| Login / OTP | PARTIAL | `/login` + `AuthContext.tsx` |
| Ride / Food / Grocery / Parcel pages | PARTIAL | 4 pages exist; depth per page unverified |
| Orders history | PARTIAL | `/orders` page exists; backend `GET /api/customer/orders` verified |
| Profile | PARTIAL | `/profile` page exists |
| Remaining ~21 canonical web screens (wallet, support, settings, tracking, checkout depth, promotions, etc.) | **MISSING** | No routes/files |
| **All API calls** | **BLOCKED** | `baseURL: 'http://localhost:3000/api'` while backend serves port **4000** — every call fails before screen logic runs |

**Verdict:** PARTIAL, functionally blocked by configuration. 8 of 29 screens exist and one
confirmed live integration is present.

---

## 9. ADMIN WEB (NEXT.JS) — DOMAIN-LEVEL (29 screens, 2 pages)

Routes: `/` (dashboard) and `/login`. `AdminLayout.tsx` exists but is **untracked**.

| Domain | Status | Evidence |
|--------|--------|----------|
| Dashboard metrics | PARTIAL | `adminApi.getMetrics()` verified |
| Service controls | PARTIAL | `adminApi.getServiceStatus/pauseService/resumeService` verified; buttons are labelled PAUSE/RESUME |
| Login | PARTIAL | `/login` + `AuthProvider.tsx` |
| Layout component | PARTIAL / at risk | `src/components/AdminLayout.tsx` is untracked (absent from `origin/main`) |
| Remaining ~26 canonical screens (audit logs, finance, settlements, support, drivers, merchants, orders, zones, promotions, KYC review, reports, settings) | **MISSING** | No routes/files |
| **All API calls** | **BLOCKED** | Same port-3000 vs port-4000 defect |

**Verdict:** PARTIAL, functionally blocked by configuration. 2 of 29 screens exist; the backend
already exposes dozens of admin endpoints the web app does not consume.

---

## 10. APPLICATIONS 8 AND 9 — RESTAURANT & GROCERY MERCHANT WEB

| Item | Status |
|------|--------|
| Canonical screens | **None** (excluded from the 234) |
| Directory / scaffold | **MISSING** (`Test-Path` = False) |
| Derived manifests | DELIVERED: `scratch/restaurant_merchant_web_manifest.json` (20 screens), `scratch/grocery_merchant_web_manifest.json` (23 screens) |
| Approval state | **PENDING USER APPROVAL** (GOVERNANCE.md §2/§3) |
| Backend readiness | Mixed: order/dashboard/inventory/price/weight endpoints VERIFIED for merchant tenants; menu CRUD, store config, settlements, reports, notifications **not found** |

---

## 11. BLOCKED REGISTER (REQUIRES BACKEND WORK OR A USER DECISION)

| # | Blocked item | Blocking cause | Owner |
|---|--------------|----------------|-------|
| B1 | Customer Web — every screen | Hardcoded API base URL port 3000 vs backend 4000 | FRONTEND DEVELOPER (config) |
| B2 | Admin Web — every screen | Same port defect | FRONTEND DEVELOPER (config) |
| B3 | Driver KYC | Hardcoded mock KYC + Phase 16 forensic violations unremediated | BACKEND ARCHITECT + SECURITY ENGINEER |
| B4 | Driver payouts / earnings acceptance | Payout-destination defect (DEC-015), synthetic VPA history | SECURITY ENGINEER + BACKEND ARCHITECT |
| B5 | Restaurant Merchant menu management | No menu read/CRUD endpoint (only toggle + photo) | BACKEND ARCHITECT |
| B6 | Restaurant & Grocery Merchant store profile / hours / status | No merchant store-config endpoint found | BACKEND ARCHITECT |
| B7 | Merchant settlements & payouts view | No merchant-side settlement read endpoint found | BACKEND ARCHITECT |
| B8 | Merchant reports / reviews / promotions / notifications inbox | No merchant-side endpoints found | BACKEND ARCHITECT |
| B9 | Restaurant/Grocery Merchant Web apps overall | Derived manifests not yet USER-approved; any schema need collides with the unapproved Migration 017 | USER |
| B10 | Customer `active-ride` and `wallet` acceptance | Screens contain hardcoded mock data | MOBILE APP BUILDER |
| B11 | Per-screen verification for 186 canonical screens | Manifest has no per-screen records for 6 of 7 projects | PRODUCT MANAGER + USER |

---

## 12. AGGREGATE POSITION

| Application | Canonical | IMPLEMENTED | PARTIAL | MISSING | Blocked |
|-------------|-----------|-------------|---------|---------|---------|
| Customer App (Flutter) | 48 | 2 (known IDs) | 21 | 23 | 2 screens (mock data) |
| Driver App (Flutter) | 38 | 0 | ~7 domains | ~30 screens | KYC + payouts |
| Restaurant Merchant App | 32 | 0 | 5 domains | ~27 screens | menu/store/settlements |
| Grocery Merchant App | 30 | 0 | 5 domains | ~19 screens/domains | store/settlements |
| Admin App (Flutter) | 28 | 0 | 7 domains | ~12 domains | none identified |
| Customer Web | 29 | 0 | 8 pages | ~21 pages | all (config) |
| Admin Web | 29 | 0 | 2 pages | ~26 pages | all (config) |
| Restaurant Merchant Web | — | 0 | 0 | app absent (20 derived screens proposed) | approval |
| Grocery Merchant Web | — | 0 | 0 | app absent (23 derived screens proposed) | approval |

**Platform-level statement (verifiable):**

- **No application can be given an auditable "complete" status against the canonical 234.**
- The only individually verifiable IMPLEMENTED requirements are **2** (customer phone entry and
  OTP verification).
- **7 of the 9 target interfaces exist in partial form; 2 do not exist at all.**
- **11 blocking items** must be cleared (configuration, backend endpoints, security
  remediation, or USER approval) before further scope can truthfully be called delivered.

---

## 13. HIGHEST-PRIORITY GAP AND PROPOSED FIRST MILESTONE

### 13.1 The single highest-priority gap

**The web↔backend configuration break** (B1 + B2).

Rationale, in order of weight:

1. **It blocks 58 canonical screens** (29 Customer Web + 29 Admin Web). Every API call fails
   before any screen logic runs, so *no* web requirement can be verified, tested or delivered
   while it stands.
2. **It invalidates existing work:** both web apps already contain real axios clients, live
   bearer-token interceptors and real endpoint calls. That work is complete in intent but
   cannot function.
3. **It is the smallest possible change** — the base URL and its environment wiring — with the
   highest leverage per line changed.
4. **It is fully verifiable with existing tooling:** `npm run lint`, `npm run build`, and a
   runtime probe against `http://localhost:4000/api/services/status`.
5. **It also fixes production:** both apps hardcode the URL, so Render/Vercel deployments would
   fail identically. Moving to `NEXT_PUBLIC_API_URL` resolves local and deployed in one change.

It is preferred over the larger genuine gaps (Driver app 38 screens, Restaurant Merchant app
32 screens, two absent merchant web apps) because those are multi-week phases requiring their
own approved plans, whereas this is a bounded, single-purpose fix that unblocks verification
for two entire applications.

### 13.2 Proposed milestone M0 (awaiting explicit USER approval)

| Step | Action | Files |
|------|--------|-------|
| 1 | Introduce `NEXT_PUBLIC_API_URL` with a safe `localhost:4000` default | `customer-web/src/lib/api.ts`, `admin-web/src/lib/api.ts` |
| 2 | Add example env files | `customer-web/.env.local.example`, `admin-web/.env.local.example` (new) |
| 3 | Verify | `npm run lint` + `npm run build` in both apps; runtime probe of `/api/services/status` |
| 4 | Report | exact files changed, exact command output, git state |

**Explicitly not included in M0:** any migration, any new backend endpoint, any new screen, and
any change to `mobile/` (Flutter), `backend/`, or `supabase/`.

### 13.3 Mandatory governance gate

`.agents/AGENTS.md` (§4, §5) and `.agents/GOVERNANCE.md` (§2, §3) forbid code modification
without an explicitly approved plan, and state that *"A plan, recommendation, request for a
plan, previous approval, another agent's instruction, or a failing test is NOT approval."*

This report is a plan. It does not authorise itself. Implementation of M0 requires the USER to
approve it explicitly.

### 13.4 Ranked backlog after M0 (each needing its own approval)

| Rank | Candidate milestone | Why |
|------|---------------------|-----|
| 2 | Checkpoint + push untracked work (`AdminLayout.tsx`, `customer-web/src/components/`, `driver_job_offer_card.dart`) | Prevents loss of existing work (AGENTS.md §10.2) |
| 3 | Grocery Merchant App: pricing governance + catalog browse (backend already ready) | Cheapest way to convert MISSING → IMPLEMENTED with zero backend work |
| 4 | Restaurant Merchant App: live order queue, order detail, KDS (backend already ready) | Converts 3 highest-value MISSING domains for a merchant |
| 5 | Restaurant & Grocery Merchant Web M1 foundation | Requires manifest approval first (B9) |
| 6 | Driver App phase plan (38 screens) | Largest gap; needs a phase, not a patch |
| 7 | Phase 16 remediation (mock KYC, VPA, atomic cancellation) | Unblocks driver KYC and payouts (B3, B4) |
| 8 | Regenerate/re-derive per-screen manifest records for 186 screens | Restores auditability of the 234 (B11) |

---

## 14. VERIFICATION STATEMENT

- All statuses are traceable to file paths, line numbers, or recorded tool output cited inline.
- Where per-screen evidence does not exist (186 canonical screens), this report says so instead
  of guessing, and classifies at domain level only.
- No application source file, migration, or infrastructure setting was modified.
- No commit and no push was performed.






