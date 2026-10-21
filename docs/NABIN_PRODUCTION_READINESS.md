# NABIN — Production Readiness Audit & Release Assessment

**Audit Date**: 2026-10-11  
**Milestone**: M0.7 Release Readiness Gate  
**Lead Auditor**: Senior Backend, Database, Security & Release QA Agent  
**Repository**: `C:\Users\macmi\Documents\nabin`  
**Git HEAD**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` (clean tracked tree, matched to `origin/main`)  

---

## 1. Executive Summary & Release Decisions

Based on independent full-stack inspection, automated test suite execution against isolated local PostgreSQL infrastructure, and live DNS/endpoint probes:

| Gate | Verdict | Core Rationale |
|---|---|---|
| **Limited Pilot (10–50 users)** | **NO-GO** | Blocked by: (1) Fatal PostgreSQL error in `create_order_with_lines_atomic` when `p_checkout_id` is supplied; (2) Inability to build native Android APKs on host machine due to missing SDK `cmdline-tools`; (3) Absence of live public API and frontend deployments (Beta frontend 404, DNS not resolved). |
| **Public Launch** | **NO-GO** | Blocked by pilot blockers plus: (1) Third-party payment gateway keys in sandbox/test mode only; (2) SMS OTP gateway unconfigured; (3) Absence of production monitoring/alerting and multi-region disaster recovery runbooks. |

---

## 2. Platform Component Audit & Classification

Each platform component was classified according to the audit rubric:
- **Implemented and verified**: Functional, tested against real backend and database with zero mocks.
- **Implemented but not verified**: Code present and builds, but lacking full automated end-to-end database verification.
- **Partially implemented**: Features present, but key sub-flows or integration paths incomplete.
- **Mocked or simulated**: UI renders by falling back to synthetic mock records or local storage.
- **Blocked**: Cannot be built, tested, or run due to environmental or toolchain prerequisites.

### Web Applications (Next.js 16.3.8)
| Application | Port | State | Evidence & Reality Check |
|---|---|---|---|
| `customer-web/` | 3000 | **Partially Implemented / Mock Fallback** | Renders home, food, grocery, and ride booking. Passes Playwright smoke tests, but falls back to synthetic mock data in `src/lib/api.ts` when Express backend is unreachable. Real food checkout hindered by order line schema alias mismatch. |
| `admin-web/` | 3001 | **Partially Implemented / Mock Fallback** | 100% of admin identity, RBAC, and audit backend tests pass (74/74 assertions). However, frontend `src/lib/api.ts` contains 79 mock fallback occurrences simulating customer and driver directories when disconnected. |
| `restaurant-merchant-web/` | 3002 | **Partially Implemented** | Menu management, dish customizer, and order list render. Passes Playwright smoke suite. Backend integration verified for 27/28 dish and variant operations. |
| `grocery-merchant-web/` | 3003 | **Partially Implemented** | Inventory management, category filtering, and deal controls render. Master grocery catalogue authorization verified on backend (15/15 checks pass). |
| `merchant-web/` (Unified) | 3004 | **Partially Implemented / Mock Fallback** | Unified portal contains 175 mock fallback occurrences. Merchant tenant isolation verified on backend (83/93 checks pass). |

### Mobile Applications (Flutter 3.47.2 / Dart 3.13.2)
| Application | Target Architecture | State | Evidence & Blockers |
|---|---|---|---|
| NABIN Customer | Android / iOS | **Blocked on Android Tools / iOS Host** | Dart codebase comprehensive (`main_customer.dart`). Unit tests pass. Blocked from APK generation by missing Android `cmdline-tools` and unaccepted licenses. iOS blocked by Windows host. |
| NABIN Driver | Android / iOS | **Blocked on Android Tools / iOS Host** | `main_driver.dart`. Backend driver lifecycle (66/66) and earnings (29/29) fully proven against PostgreSQL. Native compilation blocked. |
| NABIN Restaurant | Android / iOS / Tablet | **Blocked on Android Tools / iOS Host** | `main_restaurant.dart`. KDS and dish management screens designed. Native compilation blocked. |
| NABIN Grocery | Android / iOS / Handheld | **Blocked on Android Tools / iOS Host** | `main_grocery.dart`. Inventory scanning and picking flows present. Native compilation blocked. |
| NABIN Admin | Mobile Web / Tablet | **Partially Implemented** | `main_admin.dart`. Implements administrative dashboards for mobile form-factors. |

### Shared Backend & Infrastructure
| Service | Technology | State | Evidence & Operational Findings |
|---|---|---|---|
| Node.js API | Express 4.21.2 | **Implemented and Verified (Local)** | Running on port 4000. Verified with 230+ passing integration checks across auth, dispatch, orders, earnings, and admin. |
| WebSockets | `ws` on `:4000` | **Implemented and Verified (Local)** | Dispatch real-time push and location telemetry active. |
| PostgreSQL Schema | PostgreSQL 15.8 (Supabase) | **Implemented with 1 Critical Defect** | 35 migrations applied. RLS enabled on 100% of public tables. Defect: `create_order_with_lines_atomic` references nonexistent column `checkouts.status`. |
| Auth & RBAC | Supabase GoTrue + JWT | **Implemented and Verified** | Token authentication, role segregation (Customer, Driver, Merchant, Admin, Operations, KYC Specialist), Aadhaar masking verified. |
| Media Storage | Cloudinary / Supabase Storage | **Partially Implemented / Sandbox** | IDOR guards and tenant isolation verified on backend (21/21 passed). Live production CDN storage buckets unconfigured. |
| Payments | Cash, Wallet, Razorpay Rails | **Simulated / Sandbox Mode** | Double-entry ledger logic and idempotency verified. Live production Razorpay credentials unconfigured (sandbox defaults active). |
| SMS & Notifications | Mailpit (Local) / External SMS | **Simulated / Local Only** | Mailpit capturing local development emails. Live production SMS gateway (DLT registered headers in India) unconfigured. |

---

## 3. Prioritized Release Blocker Register

| ID | Severity | Affected Service | Issue & Evidence | User / Operational Impact | Required Action | Effort Range | Prevents Pilot? | Prevents Launch? |
|---|---|---|---|---|---|---|---|---|
| **BLK-01** | **Critical** | Database / Checkout | Function `create_order_with_lines_atomic` queries non-existent column `status` on `public.checkouts`. Fails with SQL error `42703`. | Any order created with checkout linkage crashes during payment confirmation. | Patch SQL function to reference `checkout_status` via additive migration. | 2–4 hours | **YES** | **YES** |
| **BLK-02** | **Critical** | Cloud Deployments | Zero active public deployments. Beta frontend `https://nabin-sooty.vercel.app` returns 404. DNS records for `api.nabin.in`, `api-beta.nabin.in`, `admin.nabin.in` unrouted. | External testers, drivers, and customers cannot connect. | Provision cloud instances, configure Vercel deployments, and establish DNS records. | 1–2 days | **YES** | **YES** |
| **BLK-03** | **Critical** | Mobile (Android) | Android SDK missing `cmdline-tools` component; Android licenses unaccepted (`flutter doctor`). | Cannot compile, sign, or build Android APKs or AABs for driver/customer pilot devices. | Install Android command-line tools and accept SDK licenses (`flutter doctor --android-licenses`). | 1–3 hours | **YES** | **YES** |
| **BLK-04** | **High** | Backend API | Order lines returned from `getOrderById` omit `unit_price` alias (PostgreSQL table stores `unit_price_snapshot`). Fails test TC-20. | Clients expecting `unit_price` receive `undefined` upon reading order history. | Normalize line objects in `server.js` and `OrderRepository.js` to expose both `unit_price` and `unit_price_snapshot`. | 2–4 hours | **YES** | **YES** |
| **BLK-05** | **High** | Web Applications | Frontends automatically fall back to mock data when API is offline without displaying an error or degraded-mode banner. | Operators may unknowingly work with synthetic, unpersisted data. | Add explicit visual degraded-mode banners and disable write operations during offline fallback. | 1 day | NO | **YES** |
| **BLK-06** | **High** | Third-Party Rails | Payment keys are in sandbox mode (`PAYMENT_KEY_ID`); live SMS gateway for OTP dispatch is unconfigured. | Real financial transactions cannot occur; real customers cannot receive OTPs on physical phones. | Obtain live Razorpay production merchant keys and integrate production SMS provider (e.g. Twilio, MSG91). | 2–3 days | NO | **YES** |
| **BLK-07** | **Medium** | Mobile (iOS) | Host machine is Windows 11; cannot build or sign iOS ipa files locally. | iPhone users cannot participate in pilot. | Set up macOS CI runner (GitHub Actions macOS / Codemagic) or macOS build station. | 2–3 days | NO (Android only pilot) | **YES** |

---

## 4. Evidence-Based Milestone Release Plan

```text
M0.7 (Current Audit) ──→ M0.8 (Critical Fixes & Cloud Beta) ──→ M0.9 (Mobile Pilot) ──→ M1.0 (Public Launch)
```

### Milestone 0.8: Critical Fixes & Staging Deployment (Estimated: 3–5 Days)
- **Goal**: Resolve database and API defects; deploy live staging backend and web frontends.
- **Deliverables**:
  1. Additive database migration fixing `checkout_status` in `create_order_with_lines_atomic`.
  2. Backend order line response normalization (`unit_price` + `unit_price_snapshot`).
  3. Deploy Express backend container to cloud staging (e.g. Render / AWS / GCP).
  4. Deploy 5 Next.js frontends to Vercel connected to cloud staging API.
  5. Verify end-to-end HTTP calls and database persistence from live web apps.

### Milestone 0.9: Limited Android Field Pilot (Estimated: 1–2 Weeks)
- **Goal**: Run closed pilot with 10 drivers, 5 merchants, and 50 customers in a single geofenced operating zone.
- **Deliverables**:
  1. Fix Android `cmdline-tools` and build signed release APKs for Customer, Driver, and Merchant apps.
  2. Enable live SMS OTP gateway.
  3. Conduct live ride bookings, food deliveries, and grocery orders with physical drivers.
  4. Verify driver GPS telemetry and trip completion OTPs in real road conditions.
  5. Validate double-entry ledger balances and cash reconciliation at end-of-day.

### Milestone 1.0: Commercial Public Launch (Estimated: 3–4 Weeks Post-Pilot)
- **Goal**: Open platform to general public across supported cities.
- **Deliverables**:
  1. Switch payment rails from sandbox to live production Razorpay accounts.
  2. Publish apps to Google Play Store and Apple App Store (via macOS CI build pipeline).
  3. Deploy multi-region PostgreSQL replicas and automated point-in-time recovery (PITR).
  4. Establish 24/7 Sentry error monitoring, Datadog/CloudWatch metrics, and on-call escalation policies.

---

## 5. Realistic Launch Estimates & Confidence Levels

| Target Event | Realistic Date Window | Confidence Level | Key Assumptions |
|---|---|---|---|
| **Staging End-to-End Verification** | 5 business days | **95%** | Cloud hosting credentials available; no new schema mutations required beyond BLK-01. |
| **Limited Android Pilot (Single City)** | 12–15 business days | **85%** | Android build environment configured; physical pilot drivers recruited; SMS gateway DLT approval granted. |
| **Full Commercial Launch (Android + iOS + Web)** | 30–45 business days | **70%** | App Store review approval timelines (Apple/Google); live banking and payment gateway underwriting clearance. |

---

## 6. Single Highest-Priority Next Action

**Action**: Implement an additive database migration to correct the column reference in `public.create_order_with_lines_atomic` from `status` to `checkout_status` (resolving BLK-01), followed by running `test_migration_019.js` to achieve 18/18 green assertions against the isolated local database.
