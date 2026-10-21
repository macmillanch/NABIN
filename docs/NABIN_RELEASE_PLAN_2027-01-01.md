# NABIN — PRODUCTION RELEASE MASTER PLAN (TARGET: 1 JANUARY 2027)

**Document Reference**: `docs/NABIN_RELEASE_PLAN_2027-01-01.md`  
**Baseline Commit**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Current Date**: 11 October 2026  
**Target Release Date**: 1 January 2027  
**Status**: ACTIVE EXECUTION — STABILIZATION PHASE  

---

## 1. EXECUTIVE SUMMARY & TWO-STAGE LAUNCH ARCHITECTURE

NABIN is a multi-service on-demand platform spanning Ride Hailing, Restaurant Food Delivery, Quick Grocery Delivery, and Parcel Courier across five web applications, three Flutter mobile applications, a shared Node.js/Express backend engine, and a PostgreSQL/Supabase database.

To balance market momentum with strict engineering safety, NABIN executes a **Master Execution Plan** governed by [`docs/NABIN_MASTER_EXECUTION_TIMELINE.md`](file:///C:/Users/macmi/Documents/nabin/docs/NABIN_MASTER_EXECUTION_TIMELINE.md) and [`docs/NABIN_TWO_STAGE_LAUNCH_PLAN.md`](file:///C:/Users/macmi/Documents/nabin/docs/NABIN_TWO_STAGE_LAUNCH_PLAN.md):
- **12 October 2026**: Target for completion of implementation across all four services (Ride, Food, Grocery, Parcel).
- **13 October – 12 November 2026**: One full month dedicated to testing, validation and defect fixing across all four services.
- **13 November – 11 December 2026**: Advertising, community outreach, partner onboarding and word-of-mouth promotion.
- **12 December 2026**: Official public announcement (Stage 1 marketing debut, coming-soon landing page, DPDP waitlist, zero commercial transactions).
- **13 December – 31 December 2026**: Final operational readiness, launch preparation and critical fixes only.
- **1 January 2027**: Initial public go-live target for **NABIN Ride** and **NABIN Food** ONLY (Stage 2 operational financial launch).

**Four-Service Launch Scope Governance**:
- **NABIN Ride**: Active commercial launch service on 1 January 2027.
- **NABIN Food**: Active commercial launch service on 1 January 2027.
- **NABIN Grocery**: Complete development and staging testing prior to 12 December; strictly **disabled for public transactions** on 1 January (`GROCERY_PUBLIC_ENABLED=false`) until separate owner authorization.
- **NABIN Parcel**: Complete development and staging testing prior to 12 December; strictly **disabled for public transactions** on 1 January (`PARCEL_PUBLIC_ENABLED=false`) until separate owner authorization.

In accordance with NABIN non-negotiable governance:
- **No live shortcuts**: Security, transaction atomicity, and customer privacy will never be bypassed to meet the release date.
- **Fail-closed operations**: All external outages and authorization failures must refuse transactions gracefully without falling back to mock or demo data.
- **Database integrity**: Remote Supabase and production systems remain untouched during local testing and development until explicit staging gates are authorized.
- **Truth in marketing**: Marketing communications will never claim unlaunched services are already operating, nor use fabricated testimonials or synthetic metrics.

---

## 2. MASTER SIX-PHASE EXECUTION TIMELINE

```
2026-10-11         2026-10-12       2026-10-13 ──► 2026-11-12    2026-11-13 ──► 2026-12-11    2026-12-12       2026-12-13 ──► 2026-12-31    2027-01-01
    │                  │                        │                           │                     │                       │                    │
Current Baseline  Implementation          Dedicated Testing             Outreach, Onboarding       PUBLIC            Controlled Pilot &       OFFICIAL
  (394 Local       Completion Target        & Defect Fixing             & Promo Campaign        ANNOUNCEMENT         Operational Readiness    GO-LIVE
  Tests Pass)    (4 Services Complete)   (All 4 Services Tested)        (Partner Acquisition)   (Coming-Soon Web)    (Final Security Gate)    (Ride + Food)
```

---

## 3. DETAILED MILESTONE SPECIFICATIONS

### MILESTONE A — Local Backend & Critical Checkout Stabilization
**Deadline**: 18 October 2026  
**Status**: **COMPLETED & VERIFIED (PASS)** (11 October 2026)  
**Lead Roles**: System Architect, Database Engineer, Backend Specialist  

#### Objectives & Acceptance Criteria
1. **Critical Checkout RPC Fix**:
   - Resolve SQLSTATE `42703` column mismatch in `public.create_order_with_lines_atomic`.
   - Replaced erroneous `checkouts.status` reference with authoritative `checkouts.checkout_status`.
   - Corrected grocery inventory catalog joins: `gi.store_price`, `gi.product_id`, `mgc.name`, `mgc.standard_unit`.
   - Enforce fail-closed check that food orders reject grocery checkout linkage (`INVALID_CHECKOUT_USAGE`).
   - Implemented via additive `supabase/migrations/038_order_creation_checkout_status_fix.sql`.
2. **Order API Response Contract Correction**:
   - Resolved response serialization defect where `order_lines` database snapshots (`unit_price_snapshot`) were missing explicit `unit_price` mapping in API responses.
   - Normalized `items` and `lines` in `OrderRepository.js` and `server.js` to expose both `unit_price` and `unit_price_snapshot`.
3. **Local Database Verification**:
   - `test_migration_019.js`: **52/52 PASSED (0 FAILED)**.
   - `restaurant_catalog_checkout_test.js`: **28/28 PASSED (0 FAILED)**.
   - Verified against local Docker PostgreSQL container (`supabase_db_nabin:54322`). Zero remote mutations.

---

### MILESTONE B — Backend, Security & Business Flow Stabilization
**Deadline**: 31 October 2026  
**Status**: **IN PROGRESS — SUBSTANTIALLY COMPLETE**  
**Lead Roles**: Backend Architect, Security Engineer, QA Lead  

#### Objectives & Acceptance Criteria
1. **Elimination of Silent Mock/Demo Fallbacks**:
   - Audited `OrderRepository.js`: Removed catch-block and fallback logic in `createOrderWithLinesAtomic` that minted synthetic mock orders on database rejections.
   - Ensured all database rejections (`CHECKOUT_ALREADY_LINKED`, `CHECKOUT_OWNERSHIP_MISMATCH`, `MERCHANT_MISMATCH`) propagate authoritative error codes directly to clients.
2. **Comprehensive Business Logic Verification**:
   - Driver Operations Suite (`driver_operations_test.js`): **66/66 PASSED**. Durability of availability, concurrency race resolution, telemetry validation, trip lifecycle OTPs, and double-entry driver earnings verified.
   - Admin Identity & Fleet Gates (`admin_identity_gates_test.js`): **74/74 PASSED**. PII Aadhaar/Voter masking, RBAC permission enforcement, KYC state transitions, and audit trail fidelity verified.
   - Orders & KDS Lifecycle (`test_phase4_orders.js`): **66/66 PASSED**. Food and grocery order persistence, merchant KDS transitions, stale order expiration, and cold restart durability verified.
   - Payment Integrity & Capture (`test_phase5_payments.js`): **62/62 PASSED**. HMAC-SHA256 signature enforcement, webhook replay protection, duplicate prevention, and ledger reconciliation verified.
   - Security Audit (`test_phase7_security.js`): **46/46 PASSED**. RLS enforcement, SECURITY DEFINER search_paths, IDOR prevention, and fail-closed production OTP verification confirmed.

---

### MILESTONE C — Staging & Android Readiness
**Deadline**: 15 November 2026  
**Status**: **IN PROGRESS — BUILDS & TESTS VERIFIED (785/785 PASS, RELEASE APK GENERATED)**  
**Lead Roles**: DevOps Automator, Mobile App Builder, Frontend Developer  

#### Objectives & Acceptance Criteria
1. **Web Production Bundles**:
   - Verified clean production builds across all 5 Next.js web applications:
     - `customer-web`: 13 routes prerendered, 0 TypeScript errors.
     - `admin-web`: 19 routes prerendered, 0 TypeScript errors.
     - `restaurant-merchant-web`: 7 routes prerendered, 0 TypeScript errors.
     - `grocery-merchant-web`: 7 routes prerendered, 0 TypeScript errors.
     - `merchant-web`: 11 routes prerendered, 0 TypeScript errors.
2. **Android Toolchain & Builds**:
   - `flutter analyze`: 0 compilation errors (64 linter info warnings).
   - `flutter test`: **785/785 tests passed (0 failed)** across customer, driver, merchant, and admin suites.
   - Release APK successfully generated: `mobile/build/app/outputs/flutter-apk/app-release.apk` (57.7 MB / 60,487,456 bytes, SHA-256: `87C4B992B5CD9CFF468178D6DFA1B37FCE6EDE23A9369506445B8D68EF508685`).
   - APK verified as genuine AOT release (`android:debuggable` is absent/false, contains `libapp.so`), signed with debug cert (`CN=Android Debug`), minSdk 24, targetSdk 36, application ID `com.nabin.mobile`.
   - Built using `-t lib/main_customer.dart`. Product flavors are not configured in `build.gradle.kts`; all mobile targets currently share `com.nabin.mobile`. Real device smoke-testing has NOT yet occurred.
   - Remaining toolchain task: Add `cmdline-tools` in Android Studio SDK Manager for headless license validation.
3. **Staging Environment Migration Plan**:
   - Approved 36-migration manifest (001-016, 018-027, 029-038; 017 skipped/unapproved, 028 missing) to be applied via `migrate.js` wrapped by `with_staging_target.js`.
   - Staging environment variables documented in sanitized template (`.env.staging.example`) without exposing secrets.
   - Backend test harness protected against production leakage and local loopback fallbacks.

---

### MILESTONE D — Staging & External Integrations Validation
**Deadline**: 30 November 2026  
**Status**: **SCHEDULED**  
**Lead Roles**: Release Manager, Backend Architect, DevOps Automator  

#### Objectives & Acceptance Criteria
1. **Staging Cloud Execution**:
   - Apply approved 36-migration manifest (`001–016`, `018–027`, `029–038`) via `with_staging_target.js` on dedicated Staging Supabase project.
   - Execute all 394 backend tests against live staging database with zero errors.
2. **External Integrations Submissions**:
   - Complete India DLT registration for SMS entity headers and transactional OTP templates.
   - Confirm Product Owner payment aggregator selection (Razorpay vs Cashfree vs other) and complete merchant KYC.
   - Confirm primary production domain (`nabin.in` vs `nabin.com`).
3. **Mobile Release Artifact Hardening**:
   - Configure Gradle product flavors (`customer`, `driver`, `merchant`) in `mobile/android/app/build.gradle.kts`.
   - Generate production signing keystore (`key.properties`) replacing debug keys.
   - Conduct physical device smoke tests across Android 7 through 15 hardware.

---

### MILESTONE E — Public Announcement & Coming-Soon Launch (Stage 1)
**Deadline**: 12 December 2026  
**Status**: **SCHEDULED (STAGE 1 MILESTONE)**  
**Lead Roles**: Product Manager, Frontend Developer, UI/UX Designer, Marketing Lead  

#### Objectives & Acceptance Criteria
1. **Official Coming-Soon Web Portal**:
   - Deploy responsive landing page on confirmed domain featuring Royal Blue (`#1A3BA2`) design system.
   - Implement customer waitlist intake and merchant/driver pre-registration forms.
   - Publish DPDP-compliant privacy notice with explicit consent collection.
2. **Authentic Marketing Deliverables**:
   - Product screenshots and video demonstrations captured strictly from working software builds.
   - Service descriptions for Ride, Food, Grocery, and Parcel with transparent launch zone disclosure.
   - Unambiguous statement that commercial operations commence on **1 January 2027**.
3. **Inquiry & Partner Communication**:
   - Active, monitored email channels (`support@...`, `partners@...`) for early inquiries.

---

### MILESTONE F — Controlled Pilot & Release Gate Review
**Deadline**: 30 December 2026  
**Status**: **SCHEDULED**  
**Lead Roles**: QA Engineer, Security Engineer, Operations Lead, Release Manager  

#### Objectives & Acceptance Criteria
1. **Controlled Pilot Verification**:
   - Conduct closed pilot in defined cluster (e.g. North Campus Delhi) with 15 verified restaurants and 25 verified drivers.
   - Perform live synthetic ₹1 payment transaction, webhook processing, and ledger payout reconciliation.
   - Validate live cellular SMS OTP delivery via approved DLT templates.
2. **Full-Stack Regression & Security Audit**:
   - Execute complete backend test suite and Playwright browser flows on Release Candidate images.
   - Verify zero unresolved high/critical security vulnerabilities.
   - Complete database backup and restore recovery dry-run (RTO < 15 min, RPO < 5 min).
3. **Formal Go/No-Go Decision (30 December 2026)**:
   - All critical-path blockers resolved; documented sign-off from all specialist leads.

---

### MILESTONE G — Official Production Go-Live (Stage 2)
**Deadline**: 1 January 2027 (Target Date, Not Guaranteed)  
**Status**: **SCHEDULED (STAGE 2 OPERATIONAL LAUNCH)**  
**Lead Roles**: Principal Engineer, System Architect, Executive Stakeholders  

#### Objectives & Acceptance Criteria
1. **Production Infrastructure Activation**:
   - Production Supabase database initialized and approved migrations applied.
   - Production DNS records mapped to live Vercel web apps and backend load balancers.
   - Confirmed payment gateway switched to live production mode.
2. **Operational Service Launch (Ride & Food Only)**:
   - Commercial booking activated for **NABIN Ride** (`RIDE_PUBLIC_ENABLED=true`).
   - Commercial ordering activated for **NABIN Food** (`FOOD_PUBLIC_ENABLED=true`).
   - **NABIN Grocery** remains strictly disabled for public transactions (`GROCERY_PUBLIC_ENABLED=false`) until subsequent owner authorization.
   - **NABIN Parcel** remains strictly disabled for public transactions (`PARCEL_PUBLIC_ENABLED=false`) until subsequent owner authorization.
   - Real-time Sentry and server telemetry actively monitored with on-call rotation.

---

## 4. RESPONSIBILITY MATRIX (RACI)

| Milestone | Product Mgr | Architect | Backend | Frontend | Mobile | Security | QA | DevOps |
|---|---|---|---|---|---|---|---|---|
| Milestone A (Checkout RPC Fix) | C | A | R | I | I | C | R | I |
| Milestone B (Security & APIs) | I | A | R | C | C | R | R | I |
| Milestone C (Staging & Android Toolchain)| C | A | C | R | R | C | R | R |
| Milestone D (Integrations & Staging Cloud)| A | C | R | C | R | C | R | R |
| Milestone E (Public Announcement - 12 Dec)| A | C | I | R | I | C | C | R |
| Milestone F (Controlled Pilot & Gate - 30 Dec)| A | A | R | C | C | R | R | R |
| Milestone G (Official Go-Live - 1 Jan) | A | A | R | R | R | A | A | A |

*R = Responsible, A = Accountable, C = Consulted, I = Informed*
