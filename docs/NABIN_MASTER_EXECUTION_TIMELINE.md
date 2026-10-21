# NABIN — MASTER EXECUTION TIMELINE & GOVERNANCE ROADMAP

**Document Reference**: `docs/NABIN_MASTER_EXECUTION_TIMELINE.md`  
**Execution Baseline**: Git Commit `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Current Date**: 11 October 2026  
**Authoritative Schedule Status**: APPROVED BY PROJECT OWNER  

---

## 1. OWNER'S DEFINITIVE MASTER SCHEDULE

The NABIN platform adheres strictly to the Owner's authoritative execution calendar:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              NABIN MASTER SCHEDULE CALENDAR                            │
├─────────────────────────┬──────────────────────────────────────────────────────────────┤
│ 12 October 2026         │ Implementation Completion Target across all 4 services       │
│                         │ (Ride, Food, Grocery, Parcel feature freeze)                 │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 13 Oct – 12 Nov 2026    │ Dedicated Testing Phase (One Full Month of Multi-Layer Tests)│
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 13 Nov – 11 Dec 2026    │ Advertising, Community Outreach & Partner Onboarding         │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 12 December 2026        │ Official Public Announcement (Marketing Milestone)           │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 13 Dec – 31 Dec 2026    │ Final Operational Readiness, Pilot Verification & Freeze     │
├─────────────────────────┼──────────────────────────────────────────────────────────────┤
│ 1 January 2027          │ Initial Public Go-Live: NABIN Ride & NABIN Food ONLY         │
│                         │ (Grocery & Parcel remain DISABLED for public transactions)   │
└─────────────────────────┴──────────────────────────────────────────────────────────────┘
```

---

## 2. PHASE 1: IMPLEMENTATION COMPLETION (THROUGH 12 OCTOBER 2026)

**Objective**: Complete and verify all remaining implementation details across all four services before entering the dedicated testing month.

### 2.1 Scope & Delivery Matrix
1. **Critical Shared Platform & Backend**:
   - Atomic checkout RPC alignment (`checkouts.checkout_status`) verified in Migration 038.
   - Independent public service activation controls implemented in `FeatureControlService`:
     - `RIDE_PUBLIC_ENABLED`
     - `FOOD_PUBLIC_ENABLED`
     - `GROCERY_PUBLIC_ENABLED` (initial launch: `false`)
     - `PARCEL_PUBLIC_ENABLED` (initial launch: `false`)
   - Fail-closed error propagation enforced; zero synthetic mock fallbacks in order paths.
2. **NABIN Ride**:
   - Location coordinate validation (`placedEnd`), fare estimation, ride booking, driver assignment, trip tracking, and driver earnings verified.
3. **NABIN Food**:
   - Restaurant catalog, dish customization snapshots, server-authoritative pricing, atomic order creation, and KDS workflows verified.
4. **NABIN Grocery**:
   - Master grocery catalog, merchant store inventory, checkout linkage, dark store prohibition guard, and merchant inventory updating verified.
5. **NABIN Parcel**:
   - Parcel fare estimation, sender/recipient contact validation, weight tier selection, booking, and delivery proof verified.

### 2.2 Realistic Assessment of 12 October Completion Target
- **Local Engineering Baseline**: **COMPLETED**. The shared Express backend, PostgreSQL migrations (`001–038`), Flutter client entry points, and Next.js web applications are substantially implemented and passing 100% of local automated test suites.
- **Remaining Engineering Work**:
  - Gradle product flavor configuration in `mobile/android/app/build.gradle.kts`.
  - Android production signing keystore generation (`key.properties`).
- **External Blockers Beyond Autonomous Control**:
  - Owner must confirm chosen Payment Gateway provider (Razorpay vs Cashfree).
  - Owner must confirm primary production domain (`nabin.in` vs `nabin.com`).
  - Owner must authorize dedicated Staging Supabase project provisioning.

---

## 3. PHASE 2: DEDICATED TESTING & VALIDATION (13 OCTOBER – 12 NOVEMBER 2026)

**Objective**: One full month of rigorous, multi-tiered validation across all four services without introducing new features.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FOUR-WEEK DEDICATED TESTING BREAKDOWN                           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEK 1 (13 Oct – 19 Oct): Unit, API, Database & Schema Integrity                       │
│ • Run full backend test suite (394+ assertions) daily.                                 │
│ • Execute migration dry-run on isolated database container using migrate.js.          │
│ • Verify schema constraints, foreign key cascades, and double-entry ledger balance.   │
│ • Flutter analyze and flutter test (785 tests) regression sweep.                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEK 2 (20 Oct – 26 Oct): Cross-Service E2E, Merchant & Driver Operations             │
│ • End-to-end Ride lifecycle: customer request ➔ driver WebSocket match ➔ OTP ➔ receipt.│
│ • End-to-end Food lifecycle: restaurant menu ➔ customizer ➔ KDS chime ➔ pickup.        │
│ • End-to-end Grocery lifecycle: catalog ➔ store inventory ➔ checkout ➔ bag delivery.   │
│ • End-to-end Parcel lifecycle: sender quote ➔ driver pickup ➔ recipient proof of drop. │
│ • Merchant catalog updates, stock toggles, and business suspension fail-safes.        │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEK 3 (27 Oct – 02 Nov): Security, Concurrency, Recovery, Payments & OTP              │
│ • RLS security definer search_path verification on all PostgreSQL functions.           │
│ • True concurrent booking and checkout race-condition stress tests.                    │
│ • Disaster recovery simulation: cold restart, crash recovery, database dump & restore.│
│ • Payment gateway sandbox signature verification (HMAC-SHA256) and webhook replays.   │
│ • Test mode cellular OTP verification vs fail-closed production mode guards.           │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ WEEK 4 (03 Nov – 12 Nov): Real-Device Testing, Staging Acceptance & Blocker Closure    │
│ • Install and exercise release APK on physical Android hardware (Android 7 to 15).     │
│ • Execute with_staging_target.js on isolated cloud staging Supabase instance.          │
│ • Verify zero client-side mock fallbacks across all five web applications.             │
│ • Final defect triage and closure of all open Phase 2 bug tickets.                     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. PHASE 3: ADVERTISING, OUTREACH & PARTNER ONBOARDING (13 NOVEMBER – 11 DECEMBER 2026)

**Objective**: Build local awareness, onboard initial merchant and driver cohorts, and prepare announcement assets while engineering maintains code stability.

### 4.1 Partner Recruitment & Onboarding
1. **Restaurant Merchant Cohort**:
   - Onboard initial pilot cohort of 15–20 high-quality local restaurants.
   - Digitize menus, take verified food photos, and train staff on KDS tablet operation.
   - Execute formal partner merchant agreements with transparent commission terms.
2. **Driver Partner Cohort**:
   - Recruit and onboard initial pilot fleet of 25–40 delivery and cab drivers.
   - Document intake: Driver license, commercial insurance, vehicle registration, and Aadhaar.
   - Conduct app walkthrough training (accepting trips, OTP entry, cash/wallet settlements).
3. **Grocery Merchant Network**:
   - Pre-register local grocery store partners for subsequent phased activation.
   - Map inventory categories and establish SKU pricing baselines.

### 4.2 Marketing Deliverables & Authentic Outreach
1. **Coming-Soon Web Landing Page**:
   - Deploy responsive coming-soon landing page on confirmed domain featuring Royal Blue (`#1A3BA2`).
   - Implement customer waitlist intake form with explicit DPDP Act consent checkboxes.
   - Display transparent countdown to 12 December announcement and 1 January go-live.
2. **Authentic Demonstration Media**:
   - Produce promotional videos, high-resolution screenshots, and UI walkthroughs strictly recorded from working staging builds.
   - Zero fabricated testimonials, synthetic usage statistics, or false coverage claims.
3. **Local Community Awareness**:
   - Targeted local digital ads and offline flyers in the designated pilot cluster (e.g. North Campus Delhi).
   - Driver referral incentive structure and early-bird customer promo codes (`WELCOME50`).

---

## 5. PHASE 4: PUBLIC ANNOUNCEMENT (12 DECEMBER 2026)

**Objective**: Execute official public brand debut and media announcement.

### Deliverables
- Official press release published announcing NABIN's multi-service platform.
- Public coming-soon website live with customer waitlist and driver/merchant application portals.
- Clear public messaging: **NABIN Ride and NABIN Food launch on 1 January 2027; Grocery and Parcel to follow in subsequent releases.**
- Active media and partner communication channels (`press@...`, `support@...`, `partners@...`).

---

## 6. PHASE 5: FINAL OPERATIONAL READINESS & PILOT (13 DECEMBER – 31 DECEMBER 2026)

**Objective**: Controlled live testing, final release gate sign-off, and production deployment preparation. Critical fixes only; zero feature changes.

### Key Milestones
1. **Closed Physical Pilot (15 Dec – 24 Dec)**:
   - Execute closed pilot transactions with onboarded restaurants and drivers.
   - Test single synthetic ₹1 live payment transaction, webhook processing, and bank settlement.
   - Verify cellular SMS OTP delivery on physical phones via approved TRAI DLT templates.
2. **Production Infrastructure Preparation (25 Dec – 29 Dec)**:
   - Initialize production Supabase database; apply approved 36-migration manifest.
   - Map production DNS records and verify SSL certificates for all web applications and APIs.
   - Switch payment gateway from sandbox to live production mode.
3. **Formal Go/No-Go Decision Gate (30 December 2026)**:
   - Formally review all Release Gate criteria with specialist leads.
   - Verify Ride and Food have passed 100% of production acceptance gates.
   - Confirm Grocery and Parcel remain disabled for public transactions (`GROCERY_PUBLIC_ENABLED=false`, `PARCEL_PUBLIC_ENABLED=false`).

---

## 7. PHASE 6: INITIAL PUBLIC GO-LIVE (1 JANUARY 2027)

**Objective**: Open live commercial operations for public customers.

### Authoritative Launch Scope
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          1 JANUARY 2027 LAUNCH SCOPE MATRIX                            │
├─────────────────────┬──────────────────┬─────────────────┬─────────────────────────────┤
│ Service Line        │ Public Status    │ Flag Setting    │ Operational State           │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ **NABIN Ride**      │ **LIVE**         │ RIDE_PUBLIC_    │ Full public booking active  │
│                     │                  │ ENABLED=true    │ (Taxi, Auto, Bike)          │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ **NABIN Food**      │ **LIVE**         │ FOOD_PUBLIC_    │ Full restaurant ordering &  │
│                     │                  │ ENABLED=true    │ delivery active             │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ **NABIN Grocery**   │ **DISABLED**     │ GROCERY_PUBLIC_ │ Disabled for public orders; │
│                     │                  │ ENABLED=false   │ tab shows "Coming Soon"     │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ **NABIN Parcel**    │ **DISABLED**     │ PARCEL_PUBLIC_  │ Disabled for public orders; │
│                     │                  │ ENABLED=false   │ tab shows "Coming Soon"     │
└─────────────────────┴──────────────────┴─────────────────┴─────────────────────────────┘
```

- **Contingency Rule**: If Ride or Food encounters critical defects during the 30 December review, recommend a safe launch delay or an approved contingency. Do not automatically substitute Grocery or Parcel.

---

## 8. RESPONSIBILITY & OWNER DEPENDENCIES MATRIX

| Action Item | Responsible Party | Deadline | Status |
|---|---|---|---|
| Four-Service Implementation Completion | All Engineering Specialists | 12 October 2026 | **IN FINAL REVIEW** |
| Payment Provider Selection (Razorpay vs Cashfree) | **Project Owner** | 20 October 2026 | **PENDING OWNER** |
| India DLT Telecom Entity & Sender Registration | **Project Owner** | 20 October 2026 | **PENDING OWNER** |
| Production Keystore & Gradle Product Flavors | Mobile App Builder | 25 October 2026 | **SCHEDULED** |
| Dedicated Staging Supabase Provisioning | **Project Owner** & DevOps | 25 October 2026 | **PENDING OWNER** |
| Authoritative Domain & DNS Confirmation | **Project Owner** | 01 November 2026 | **PENDING OWNER** |
| One-Month Dedicated Testing Phase | QA Lead & Backend Architect | 12 November 2026 | **SCHEDULED** |
| Marketing & Partner Onboarding Phase | Product Manager & Operations | 11 December 2026 | **SCHEDULED** |
| Official Public Announcement | Executive Leadership | 12 December 2026 | **SCHEDULED** |
| Controlled Pilot & Synthetic Live Payment Test | QA Lead & DevOps Automator | 24 December 2026 | **SCHEDULED** |
| Formal Go/No-Go Decision Meeting | All Specialist Leads & Owner | 30 December 2026 | **SCHEDULED** |
| Initial Public Go-Live (Ride + Food) | Platform Lead | 01 January 2027 | **TARGET** |

---

*Master timeline certified against owner decisions and technical governance.*
