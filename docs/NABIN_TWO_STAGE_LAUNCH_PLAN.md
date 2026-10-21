# NABIN — TWO-STAGE LAUNCH PLAN & OPERATIONAL ROADMAP

**Document Reference**: `docs/NABIN_TWO_STAGE_LAUNCH_PLAN.md`  
**Execution Baseline**: Commit `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Current Date**: 11 October 2026  
**Primary Brand Identity**: Royal Blue (`#1A3BA2`), Brand Indigo (`#4D5BBD`)  
**Status**: ACTIVE STRATEGIC ROADMAP  

---

## 1. EXECUTIVE SUMMARY & TWO-STAGE LAUNCH STRATEGY

To maximize brand impact, build merchant and driver supply, and safeguard customer trust and operational stability, NABIN decouples its public market entry into two distinct, governed milestones:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                 TWO-STAGE LAUNCH MODEL                                 │
├──────────────────────────────────────────┬─────────────────────────────────────────────┤
│   STAGE 1: PUBLIC ANNOUNCEMENT           │   STAGE 2: OFFICIAL PRODUCTION GO-LIVE      │
│   Target Date: 12 December 2026          │   Target Date: 1 January 2027 (Target Only) │
│   Nature: Marketing & Early Registration │   Nature: Operational Financial Launch      │
│   Gate: Truthful Communications Gate     │   Gate: Zero-Defect Operational Safety Gate │
└──────────────────────────────────────────┴─────────────────────────────────────────────┘
```

### Core Separation Principles
1. **The Announcement is NOT Go-Live**: The announcement on 12 December 2026 introduces the brand, explains the multi-service ecosystem (Ride Hailing, Food Delivery, Express Grocery, Parcel), opens early waitlist registration, and recruits initial merchant and driver cohorts. It does **not** process live bookings or real financial charges.
2. **Initial Public Launch Scope (Ride + Food ONLY)**: On 1 January 2027, **NABIN Ride** and **NABIN Food** are the sole public launch services, subject to passing all production acceptance gates.
3. **Four-Service Pre-Launch Completion Requirement**: Development and staging validation of **NABIN Grocery** and **NABIN Parcel** must be completed and tested before the announcement (12 December 2026). However, both services remain **DISABLED for public transactions** at initial go-live (`GROCERY_PUBLIC_ENABLED=false`, `PARCEL_PUBLIC_ENABLED=false`) until separate owner authorization in a later release.
4. **Go-Live is Operationally Gated**: The official go-live on 1 January 2027 will proceed **only if** all operational, legal, financial, and technical gates pass. If Ride or Food fails critical checks, a safe delay or separately approved contingency is recommended; Grocery and Parcel are never automatically substituted.
5. **Strict Truthfulness Standard**: Marketing communications must never claim services are already operating before 1 January 2027. No synthetic testimonials, fictitious order metrics, unsupported geographic coverage claims, or unconfirmed merchant partnerships may be publicized.
6. **No Feature Ready on Local/Mock Evidence**: A feature, application, or service line is never marked production-ready merely because a local build succeeded, unit tests passed on Windows, or mock fallback screens render. Real staging validation and physical device verification are mandatory.

---

## 2. TIMELINE & DATED COUNTDOWN

```
2026-10-11     2026-10-12            2026-11-12           2026-12-11          2026-12-12        2026-12-31       2027-01-01
    │              │                     │                    │                   │                 │                │
    ▼              ▼                     ▼                    ▼                   ▼                 ▼                ▼
Current        PHASE 1 CLOSES:       PHASE 2 CLOSES:      PHASE 3 CLOSES:     STAGE 1:          PHASE 5 CLOSES:  STAGE 2:
Baseline       Implementation        Dedicated Testing    Advertising,        PUBLIC            Controlled       INITIAL GO-LIVE:
(Milestone C.1 Completion Target     (1 Full Month:       Outreach & Partner  ANNOUNCEMENT      Pilot & Final    RIDE + FOOD ONLY
 Audit Passed) (All 4 Services)      Unit, E2E, Device)   Onboarding          (Coming-Soon)     Release Gate     (Grocery & Parcel
                                                                                                                 Disabled)
```

### Phase 1: Through 12 October 2026 — Implementation Completion Target (All 4 Services)
- **Focus**: Feature freeze and code completion across all four services (Ride, Food, Grocery, Parcel).
- **Deliverables**:
  1. Independent public activation flags enforced: `RIDE_PUBLIC_ENABLED`, `FOOD_PUBLIC_ENABLED`, `GROCERY_PUBLIC_ENABLED=false`, `PARCEL_PUBLIC_ENABLED=false`.
  2. Core backend endpoints, atomic database RPCs, and pricing calculations complete for Ride, Food, Grocery, and Parcel.
  3. Zero compilation errors across Flutter apps (`flutter analyze`) and Next.js web applications (`npm run build`).

### Phase 2: 13 October – 12 November 2026 — One Full Month Dedicated Testing & Validation
- **Focus**: Systematic four-week testing sweep across all four services without feature modifications.
- **Schedule**:
  - **Week 1 (13–19 Oct)**: Unit, API, and database integrity (394+ backend tests, 785 Flutter tests, migration dry-run).
  - **Week 2 (20–26 Oct)**: Cross-service E2E workflows, merchant catalog/stock operations, driver dispatch lifecycles.
  - **Week 3 (27 Oct – 02 Nov)**: Security, tenant isolation, concurrency locks, failover recovery, payment sandbox webhooks, cellular OTP.
  - **Week 4 (03–12 Nov)**: Physical device testing on Android hardware, staging acceptance via `with_staging_target.js`, release-blocker closure.

### Phase 3: 13 November – 11 December 2026 — Advertising, Outreach & Partner Onboarding
- **Focus**: Local merchant/driver recruitment, community outreach, and authentic marketing assets.
- **Deliverables**:
  1. Deploy official Coming-Soon Web Portal on confirmed domain featuring Royal Blue (`#1A3BA2`).
  2. DPDP-compliant customer waitlist intake; driver and restaurant partner pre-registration.
  3. Onboard initial cohort of 15–20 restaurants and 25–40 drivers in pilot cluster.
  4. Produce high-resolution marketing media strictly from working software; draft press materials.

### Milestone A Event: 12 December 2026 — Official Public Announcement
- **Action**: Launch public announcement campaigns across digital media.
- **Messaging**: Announce platform debut; declare initial launch of **Ride + Food on 1 January 2027** with Grocery & Parcel coming in subsequent releases.

### Phase 5: 13 December – 31 December 2026 — Final Operational Readiness & Critical Fixes
- **Focus**: Controlled physical pilot, live payment validation, production cutover, and final release gate review.
- **Deliverables**:
  1. Closed pilot transactions in designated cluster with onboarded restaurants and drivers.
  2. Single synthetic ₹1 live payment transaction, webhook processing, and ledger settlement test.
  3. Real SMS OTP dispatch verified on physical mobile phones via approved TRAI DLT templates.
  4. **30 December 2026**: Formal Executive & Technical Go/No-Go Gate Review.

### Milestone B Event: 1 January 2027 — Initial Public Go-Live (Ride + Food ONLY)
- **Action**: Activate public commercial transactions for **NABIN Ride** and **NABIN Food**.
- **Constraint**: **NABIN Grocery and NABIN Parcel remain disabled for public transactions** until separate owner authorization.

---

## 3. MILESTONE A — ANNOUNCEMENT READINESS CHECKLIST (12 DECEMBER 2026)

The public announcement on 12 December 2026 requires passing the **Truthful Communications Gate**:

| Checklist Item | Description & Scope | Acceptance Criteria | Responsible Role | Status |
|---|---|---|---|---|
| **A-01: Brand Identity & Palette** | Standardize brand visual design across all public touchpoints. | Primary Royal Blue (`#1A3BA2`), secondary Brand Indigo (`#4D5BBD`), clean neutral backgrounds, WCAG 2.1 AAA accessible contrast. | UI/UX Specialist | READY |
| **A-02: Coming-Soon Web Portal** | Public landing page deployed on confirmed web domain. | Responsive Next.js page showcasing NABIN vision, service lines, launch date (1 Jan 2027), and waitlist intake. Fast load (<1.5s), zero mock console errors. | Frontend Developer | PENDING DOMAIN |
| **A-03: Early Registration Portals** | Pre-launch intake for Customers, Drivers, and Merchants. | Secure form capturing: Customer waitlist (phone/email); Driver registration (license, vehicle type); Merchant intake (business name, category). | Frontend / Backend | READY IN REPO |
| **A-04: DPDP Privacy & Consent** | Compliance with Indian Digital Personal Data Protection Act. | Clear privacy notice displayed; explicit unbundled opt-in checkbox for pre-launch notifications; zero tracking cookies before consent; data stored securely. | Security Engineer | OPEN |
| **A-05: Authentic Feature Previews** | High-fidelity screenshots and screen recording videos. | Captured exclusively from verified functioning builds (Customer ride selection, Food menu customization, Grocery cart, Merchant KDS). No Figma mockups presented as real software. | UI/UX / QA | OPEN |
| **A-06: Confirmed Service Scope** | Plain-language description of four core service verticals. | Accurate descriptions of Ride Hailing, Restaurant Food, 10-Minute Express Grocery, and Parcel Delivery with clearly delineated launch cluster. | Product Manager | OPEN |
| **A-07: Launch Date Clarification** | Unambiguous communication of availability. | Copy clearly states: *"Coming to your city on 1 January 2027. Register today for priority access and exclusive launch incentives."* | Product Manager | OPEN |
| **A-08: Support & Contact Channels** | Inbound communication routing for press, merchants, drivers. | Verified email addresses configured (`hello@...`, `driver@...`, `merchant@...`) with monitored ticketing. | DevOps Automator | OPEN |

---

## 4. MILESTONE B — GO-LIVE ACCEPTANCE CHECKLIST (1 JANUARY 2027)

Commercial release on 1 January 2027 requires satisfying the **Zero-Defect Operational Safety Gate**:

| Checklist Item | Description & Scope | Acceptance Criteria | Responsible Role | Status |
|---|---|---|---|---|
| **B-01: Staging Cloud Validation** | Complete isolation dry-run on dedicated Supabase instance. | Staging Supabase provisioned; approved 36-migration manifest (`001–016`, `018–027`, `029–038`) applied cleanly via `migrate.js`; 394 backend tests pass with 0 errors. | Database / DevOps | BLOCKED ON PROVISIONING |
| **B-02: Database & RPC Integrity** | Atomic ordering, checkout linkage, and ledger constraints. | `create_order_with_lines_atomic` verified against `checkouts.checkout_status`; double-entry ledger immutability and balance checks verified; RLS active on 100% of tables. | Backend Specialist | VERIFIED LOCALLY |
| **B-03: Auth, RBAC & Tenant Security** | Customer, Driver, Merchant, Admin identity boundaries. | JWT token validation, role hierarchy, merchant store ID tenant isolation (no cross-store data leaks), Aadhaar/phone masking verified. | Security Engineer | VERIFIED LOCALLY |
| **B-04: Customer Booking & Checkout** | Full transaction lifecycle across Ride, Food, Grocery, Parcel. | End-to-end cart creation, item customization snapshots, checkout lock, fare calculation, order state progression (`RECEIVED` ➔ `CONFIRMED` ➔ `COMPLETED`). | Product / Backend | VERIFIED LOCALLY |
| **B-05: Driver Dispatch & Telemetry** | Broadcast rings, driver acceptance, GPS location updates. | WebSocket connection stability on port 4000; dispatch concurrency locks prevent double-assignment; GPS coordinate updates route to active trips. | Backend / Mobile | VERIFIED LOCALLY |
| **B-06: Merchant Operations & KDS** | Kitchen Display System, grocery picking, inventory toggles. | Live order reception, prep time updates, item stock out toggles, master catalogue authorization verified. | Frontend / Mobile | VERIFIED LOCALLY |
| **B-07: Admin Audit & Permissions** | Platform control, RBAC operator privileges, dispute triage. | Granular administrative operator privileges; full audit trail for refund and status overrides; zero unauthenticated administrative routes. | Frontend / Security | VERIFIED LOCALLY |
| **B-08: Production Payment Rails** | Live payment capture, webhooks, refunds, settlements. | Selected payment gateway active in live mode; webhook HMAC-SHA256 signature verification enforced; synthetic ₹1 live test successful; automated merchant payouts tested. | Backend / Finance | BLOCKED ON PROVIDER KYC |
| **B-09: India DLT Transactional SMS** | Real-world SMS OTP delivery on physical cellular devices. | TRAI DLT Entity ID and Sender Header approved; SMS gateway provider keys active; OTP delivers to physical devices within 10 seconds. | DevOps / Security | BLOCKED ON DLT REGISTRATION |
| **B-10: Production Mobile Signing** | Cryptographically signed release packages for Google Play. | Production release keystores generated; `key.properties` configured in Gradle; APKs signed with genuine production certificate; distinct package IDs for Customer, Driver, Merchant. | Mobile App Builder | BLOCKED ON KEYSTORE / FLAVORS |
| **B-11: Physical Device Smoke Tests** | Functional validation on real physical hardware. | App installed and exercised on physical Android hardware across Android 7 through 15; zero launch crashes, ANRs, or visual layout clipping. | QA Engineer | NOT TESTED |
| **B-12: Production Monitoring & DR** | Live operational observability, error alerts, backups. | Sentry error tracking active across backend and mobile; Prometheus/Grafana or CloudWatch metrics monitored; daily automated database backups verified with recovery dry-run. | DevOps Automator | OPEN |
| **B-13: Production Domains & TLS** | Authoritative public endpoints with automated SSL. | Confirmed production domain routed via Cloudflare/Route53; valid TLS certificates; strict CORS headers restricting API access to confirmed origins. | DevOps Automator | BLOCKED ON DOMAIN |
| **B-14: Terms, Legal & Compliance** | Enforceable legal agreements and regulatory filings. | Published Terms of Service, Customer Privacy Policy, Merchant Partner Agreements, Driver Terms, grievance officer contact details displayed. | Legal / Product | OPEN |

---

## 5. CRITICAL-PATH BLOCKERS & EVIDENCE REQUIREMENTS

To close each open release blocker, specific verifiable evidence must be documented:

| Blocker ID | Severity | Blocker Description | Responsible Party | Required Verifiable Evidence to Close |
|---|---|---|---|---|
| **BLK-01** | MEDIUM | Mobile product flavors unconfigured; Customer APK signed with Debug Keystore; no device tests. | Mobile App Builder & QA Lead | 1. `build.gradle.kts` updated with product flavors (`customer`, `driver`, `merchant`).<br>2. Production keystore generated and `apksigner verify --print-certs` confirms production DN.<br>3. Successful physical device install logs and video evidence on test hardware. |
| **BLK-02** | HIGH | Staging Supabase cloud environment unprovisioned; remote database drift. | Database Engineer & DevOps | 1. Staging Supabase project credentials populated in `backend/.env.staging`.<br>2. `with_staging_target.js node scripts/migrate.js` applies 36 migrations cleanly.<br>3. Automated test suite passes 394 backend tests against live staging URL. |
| **BLK-03** | HIGH | India DLT telecom registration & transactional SMS gateway unconfigured. | Product Owner & DevOps | 1. Approved Entity ID, Sender Header (e.g. `NABINM`), and Template IDs from Vilpower/Jio.<br>2. Live SMS API keys active in backend environment.<br>3. Successful OTP delivery receipt log on physical Indian phone number. |
| **BLK-04** | HIGH | Payment gateway provider selection & live merchant onboarding pending. | Product Owner & Backend Architect | 1. Owner written confirmation selecting provider (Razorpay vs Cashfree).<br>2. Approved merchant account with live API keys and webhook secret.<br>3. Verified ₹1 live transaction capture and refund receipt in database ledger. |
| **BLK-05** | MEDIUM | Apple iOS build infrastructure (macOS runner) & Apple Developer account absent. | Mobile App Builder & DevOps | 1. Active Apple Developer Organization membership.<br>2. GitHub Actions `macos-14` workflow producing signed `.ipa` build.<br>3. TestFlight internal build link verified. |
| **BLK-06** | LOW | Primary production domain unconfirmed (`nabin.in` vs `nabin.com`); DNS unrouted. | Product Owner & DevOps | 1. Owner written confirmation of primary brand domain.<br>2. Live DNS A/CNAME records resolving globally with valid TLS certificate.<br>3. Backend CORS whitelist updated to confirmed domain. |

---

## 6. GO/NO-GO CRITERIA & CONTINGENCY PLAN

### 6.1 Milestone A (12 December 2026) Go/No-Go Decision Gate
- **Decision Date**: 10 December 2026
- **Go Criteria**:
  - Confirmed domain resolved with active Coming-Soon Landing Page.
  - Early registration forms functional with DPDP-compliant privacy notice.
  - All marketing claims, service descriptions, and screenshots reflect genuine, verified platform features.
  - Public copy clearly announces services will become operational on 1 January 2027.
- **No-Go Action**:
  - If the domain or landing page is not ready by 10 December, postpone announcement to **18 December 2026**. Do not release marketing materials without an active destination website.

### 6.2 Milestone B (1 January 2027) Go/No-Go Decision Gate
- **Decision Date**: 30 December 2026
- **Strict Go Criteria (All Must Pass)**:
  - BLK-01, BLK-02, BLK-03, BLK-04, and BLK-06 are **RESOLVED and VERIFIED**.
  - 100% of staging database migrations applied and verified.
  - Live payment capture, webhook processing, and ledger settlements verified.
  - Real SMS OTP delivery verified on physical cellular devices.
  - Physical device smoke tests pass on target mobile devices without crash.
- **Strict No-Go Triggers (Any 1 Triggers No-Go)**:
  - Any unhandled SQL exception or data-loss defect in core ordering/ledger RPCs.
  - Absence of live payment provider credentials or broken webhook signature validation.
  - Inability to deliver OTPs to physical phones via authorized DLT templates.
  - Release APK signed with debug keystore or crashing on real hardware.

### 6.3 Phased / Scoped Launch Contingency Options
If full platform readiness is not achieved by 30 December 2026, the following governed contingency paths must be executed rather than postponing the entire venture or releasing unverified software:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               GOVERNED CONTINGENCY PATHS                               │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ OPTION 1: Geographically Scoped Launch                                                 │
│ • Activate live transactions strictly within the validated pilot cluster (e.g. North   │
│   Campus Delhi) with the 15 verified restaurants and 25 verified drivers.               │
│ • Geofence all other areas with "Coming Soon to your neighborhood" notices.            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ OPTION 2: Single-Service Phased Launch (Approved Launch Scope Only)                   │
│ • If Restaurant Food passes all gates but Ride requires tuning: Launch Food ONLY on    │
│   1 January 2027; defer Ride Hailing to 15 January.                                    │
│ • If Ride passes all gates but Food partner KYC is delayed: Launch Ride ONLY on        │
│   1 January 2027; defer Food Delivery.                                                 │
│ • STRICT RULE: Never substitute Grocery or Parcel. Both services remain disabled       │
│   for public transactions until separately authorized by the owner.                    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ OPTION 3: Android-First Launch                                                         │
│ • If Apple App Store review encounters delays but Google Play is approved:             │
│ • Launch Android app publicly on 1 January 2027; open iOS TestFlight beta for early    │
│   iPhone adopters; release iOS publicly upon store approval.                           │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. RESPONSIBILITY MATRIX (RACI)

| Milestone / Deliverable | Product Manager | Backend Architect | Mobile Builder | Frontend Dev | Security Eng | QA Lead | DevOps Auto |
|---|---|---|---|---|---|---|---|
| **Domain & Payment Confirmation** | **Accountable** | Consulted | Informed | Informed | Consulted | Informed | Responsible |
| **Android Product Flavors & Keystore** | Informed | Informed | **Responsible** | Informed | Consulted | Consulted | Consulted |
| **Staging Provisioning & Migrations** | Informed | **Responsible** | Informed | Informed | Consulted | Consulted | **Responsible** |
| **India DLT SMS Registration** | **Accountable** | Informed | Informed | Informed | Consulted | Informed | **Responsible** |
| **Payment Gateway KYC & Webhook** | **Accountable** | **Responsible** | Informed | Informed | Consulted | Consulted | Informed |
| **Coming-Soon Announcement Site** | Consulted | Informed | Informed | **Responsible** | Consulted | Consulted | Responsible |
| **Real-Device Smoke Testing** | Informed | Informed | Consulted | Informed | Informed | **Responsible** | Informed |
| **Production Launch Gate (1 Jan)** | **Accountable** | Responsible | Responsible | Responsible | Responsible | Responsible | Responsible |

---

*Authored in strict accordance with NABIN Agency Governance, safety protocols, and verified technical audit baselines.*
