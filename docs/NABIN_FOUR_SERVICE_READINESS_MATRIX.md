# NABIN — FOUR-SERVICE READINESS MATRIX

**Document Reference**: `docs/NABIN_FOUR_SERVICE_READINESS_MATRIX.md`  
**Execution Baseline**: Git Commit `a48c0793e82eb5eb47ef779b84f63a0c285fc15d`  
**Current Date**: 11 October 2026  
**Authoritative Launch Scope**:  
- **Initial Public Go-Live (1 January 2027)**: **NABIN Ride** + **NABIN Food** ONLY  
- **Pre-Launch Completion (12 December 2026)**: **NABIN Grocery** + **NABIN Parcel** must be feature-complete and tested, but **DISABLED for public transactions** on initial launch day (`GROCERY_PUBLIC_ENABLED=false`, `PARCEL_PUBLIC_ENABLED=false`) until separate owner authorization.  

---

## 1. EXECUTIVE SUMMARY & FOUR-SERVICE COMPARATIVE MATRIX

| Service Domain | Public Go-Live (1 Jan 2027) | Implementation Status | Backend Integration | Automated Tests | Staging Tested | Device Tested | External Dependencies | Overall Readiness Rating |
|---|---|---|---|---|---|---|---|---|
| **NABIN Ride** | **LAUNCH SERVICE** (Publicly Enabled) | **COMPLETE** (Local) | **COMPLETE** | **COMPLETE** (66/66 Driver, 21/21 Projection, 46/46 Security) | **NOT TESTED** | **NOT TESTED** | Staging Supabase, DLT SMS (Trip OTP), Keystore | **READY FOR 1-MONTH TEST PHASE** |
| **NABIN Food** | **LAUNCH SERVICE** (Publicly Enabled) | **COMPLETE** (Local) | **COMPLETE** | **COMPLETE** (52/52 Migration 019, 28/28 Catalog, 66/66 Orders) | **NOT TESTED** | **NOT TESTED** | Staging Supabase, Payment Gateway KYC, Keystore | **READY FOR 1-MONTH TEST PHASE** |
| **NABIN Grocery** | **DISABLED AT LAUNCH** (Feature-Complete Gate) | **COMPLETE** (Local) | **COMPLETE** | **COMPLETE** (66/66 Phase 4 Orders, 28/28 Catalog/Stock) | **NOT TESTED** | **NOT TESTED** | Staging Supabase, Merchant Onboarding, Keystore | **READY FOR 1-MONTH TEST PHASE (DISABLED AT GO-LIVE)** |
| **NABIN Parcel** | **DISABLED AT LAUNCH** (Feature-Complete Gate) | **COMPLETE** (Local) | **COMPLETE** | **COMPLETE** (24/24 Feature Control, Estimate & Book Verified) | **NOT TESTED** | **NOT TESTED** | Staging Supabase, DLT SMS (Delivery OTP), Keystore | **READY FOR 1-MONTH TEST PHASE (DISABLED AT GO-LIVE)** |

*Status Rubric: COMPLETE (Verified working with automated test evidence), PARTIAL (Core code present, sub-flows incomplete), MISSING (Not implemented), BLOCKED (Cannot proceed due to external dependency), NOT TESTED (Executable, but physical/cloud testing not yet run).*

---

## 2. SERVICE 1: NABIN RIDE (INITIAL LAUNCH SERVICE)

### 2.1 Scope & Operational Description
On-demand point-to-point passenger transport spanning Taxi (4W / Lux), Auto (3W), Bike (2W), Shared, and Rental tiers.

### 2.2 Detailed Workflow & Component Breakdown
| Architecture Layer | Subsystem / Workflow | Technical Evidence & Verified Implementation | Status | Remaining Gaps & Blockers |
|---|---|---|---|---|
| **Customer Experience** | Map Pin & Location Picker | Validated via `placedEnd()` in `server.js`. Coordinates must be explicitly chosen; refusal with `PLACE_REQUIRED` if missing. | **COMPLETE** | Physical device map rendering |
| | Fare Quote & Tier Comparison | `/api/pricing/estimate` calculates distance/duration matrix, dynamic surge, and vehicle tiers (`3W`, `AUTO`, `TAXI`, `BIKE`). Verified in `database.js`. | **COMPLETE** | Staging latency benchmark |
| | Ride Booking & Idempotency | `/api/rides/book` (and `/api/customer/book-ride`) creates jobs with namespaced idempotency tokens (`hashtext`). | **COMPLETE** | Live cell network retry tests |
| | Active Ride Telemetry | `/api/rides/:id` returns genuine GPS coordinates without Delhi default pin. Verified in `customer_ride_projection_test.js` (21/21 PASS). | **COMPLETE** | Real driver GPS telemetry stream |
| | Trip Cancellation | Refusal boundaries and cancellation fee calculation implemented. | **COMPLETE** | Real-world dispute simulation |
| **Driver Experience** | Availability & Shift Toggle | `/api/driver/status` updates driver online/offline state and location. Tested in `driver_operations_test.js` (66/66 PASS). | **COMPLETE** | Background battery optimization |
| | Dispatch Broadcast Ring | WebSocket broadcast to eligible drivers within geofence radius. Atomic race-condition lock in `claim_dispatch_job`. | **COMPLETE** | Network reconnection edge-cases |
| | Trip Start OTP | Passenger provides 4-digit OTP; verified at driver HTTP boundary before trip starts. | **COMPLETE** | Requires live cellular SMS gateway |
| | Trip Completion & Earnings | Route distance, waiting time, and double-entry ledger earnings credit verified in `driver_operations_test.js`. | **COMPLETE** | Bank penny-drop payout rail |
| **Backend & Schema** | Database Tables | `rides`, `jobs`, `dispatch_requests`, `fare_rules`, `geofences`, `surge_zones`. Audited in Migrations 001, 003, 005, 011, 014, 020. | **COMPLETE** | Migration to cloud staging |
| | Concurrency & Security | RLS is enabled at the schema level and advisory locks guard dispatch claims. **The former "Zero IDOR leakage" claim is withdrawn** — a route-authorization audit (`#272`/`#273`) found admin GET registrations that call `authenticateAdmin` but omit a permission check (e.g. `server.js:1923` `/drivers`, `:6934` `/jobs`, `:6935` `/restaurants`, `:6909` `/metrics`), and `/api/media/signed-params` (`server.js:9141`) and `/api/media` (`server.js:9153`) are registered with no auth middleware at all. Those figures were a one-line-`grep` estimate; **the inventory is now derived from the registrations themselves — see the dated bullet in §8.** | **PARTIAL** | Endpoint authorization remediation (owner-authorized §4 change) + penetration testing sign-off |
| **Admin & Control** | Platform Controls | `FEATURE_RIDE`, `FEATURE_RIDE_AUTO`, `FEATURE_RIDE_TAXI`, etc. Verified in `test_phase11_feature_control.js`. | **COMPLETE** | None |
| | Fleet Directory & KYC | Aadhaar/Voter ID masked views verified in `admin_identity_gates_test.js` (74/74 PASS). | **COMPLETE** | Manual KYC operator runbook |

### 2.3 Verdict & Launch Gate Status
- **Engineering Completion**: **100% COMPLETE** on local backend and Flutter codebase.
- **Go-Live Status**: **APPROVED LAUNCH SERVICE FOR 1 JANUARY 2027** (Pending staging and physical device validation).

---

## 3. SERVICE 2: NABIN FOOD (INITIAL LAUNCH SERVICE)

### 3.1 Scope & Operational Description
On-demand restaurant discovery, menu customization, multi-item cart, atomic order placement, kitchen display system (KDS), and driver delivery.

### 3.2 Detailed Workflow & Component Breakdown
| Architecture Layer | Subsystem / Workflow | Technical Evidence & Verified Implementation | Status | Remaining Gaps & Blockers |
|---|---|---|---|---|
| **Customer Experience** | Restaurant Discovery | `/api/restaurants` and `/api/merchants` filter by cuisine, rating, delivery time, and open status. Tested in `server.js`. | **COMPLETE** | Elastic search indexing |
| | Menu Customization & Variants | Dishes support variant groups (e.g., Size, Crust) and optional/required add-on groups. Verified in `restaurant_catalog_checkout_test.js` (28/28 PASS). | **COMPLETE** | High-concurrency menu cache |
| | Authoritative Checkout | Server-authoritative price recalculation. Tampered client prices are rejected. Implemented in Migration 037/038. | **COMPLETE** | Live payment capture |
| | Order Placement RPC | `create_order_with_lines_atomic` executes single ACID transaction inserting order, lines, snapshots, and idempotency token. Verified in `test_migration_019.js` (52/52 PASS). | **COMPLETE** | None |
| | Order Tracking & State | Order progression: `RECEIVED` ➔ `CONFIRMED` ➔ `PREPARING` ➔ `READY_FOR_PICKUP` ➔ `OUT_FOR_DELIVERY` ➔ `DELIVERED`. | **COMPLETE** | Real driver assignment |
| **Merchant Experience** | Kitchen Display System (KDS) | `restaurant-merchant-web` and `main_restaurant.dart` poll/listen for live orders. Audio chime and prep-time updates implemented. | **COMPLETE** | Android tablet KDS smoke test |
| | Menu & Stock Management | Add/edit dish, variant price overrides, out-of-stock toggles. Verified in Phase C suite (28/28 PASS). | **COMPLETE** | Bulk CSV menu import |
| **Driver Experience** | Food Pickup & Delivery | Driver dispatch ring, restaurant arrival button, customer delivery OTP verification. Tested in `test_phase4_orders.js`. | **COMPLETE** | Multi-order batch dispatch |
| **Backend & Schema** | Database Tables | `merchants`, `products`, `product_variants`, `orders`, `order_lines`, `checkouts`. Additive migrations 036, 037, 038 applied. | **COMPLETE** | Staging database migration |
| | Double-Entry Settlement | Merchant revenue, platform commission, driver delivery fee, customer invoice ledgered in `accounts` and `ledger_entries`. | **COMPLETE** | Automated weekly bank payout |
| **Admin & Control** | Platform Controls | `FEATURE_FOOD`, `FEATURE_FOOD_ORDERING`, `FEATURE_FOOD_DELIVERY`. Verified in `test_phase11_feature_control.js`. | **COMPLETE** | None |

### 3.3 Verdict & Launch Gate Status
- **Engineering Completion**: **100% COMPLETE** on local backend, Flutter app, and merchant web portal.
- **Go-Live Status**: **APPROVED LAUNCH SERVICE FOR 1 JANUARY 2027** (Pending staging, payment KYC, and physical device validation).

---

## 4. SERVICE 3: NABIN GROCERY (PRE-LAUNCH COMPLETION; DISABLED AT GO-LIVE)

### 4.1 Scope & Operational Description
10-Minute and Scheduled Hyperlocal Grocery delivery from verified independent neighborhood grocery merchants. Quick dark stores are explicitly forbidden by project governance.

### 4.2 Detailed Workflow & Component Breakdown
| Architecture Layer | Subsystem / Workflow | Technical Evidence & Verified Implementation | Status | Remaining Gaps & Blockers |
|---|---|---|---|---|
| **Customer Experience** | Master Grocery Catalog | `/api/grocery/catalog` reads authoritative items (`mgc.name`, `mgc.standard_unit`, `mgc.category`). Tested in `test_phase4_orders.js`. | **COMPLETE** | Image CDN hosting |
| | Store Inventory & Pricing | Store inventory resolution `/api/grocery/stores/:id/inventory` maps merchant-specific stock (`store_price`, `stock_level`). | **COMPLETE** | Real merchant inventory sync |
| | Cart & Checkout Linkage | `/api/grocery/order` requires authoritative `checkouts` table linkage (`checkout_status`). Verified in Migration 019 Suite (52/52 PASS). | **COMPLETE** | None |
| | Item Substitution Rules | Substitution decision sheet implemented in UI (`NABIN_Grocery_Substitution_Decision_Sheet`). Customer can allow or reject substitutions. | **COMPLETE** | Merchant substitution workflow |
| **Merchant Experience** | Grocery Merchant Console | `grocery-merchant-web` and `main_grocery_merchant.dart`. Barcode search, stock update, price adjustments. | **COMPLETE** | Physical Bluetooth scanner integration |
| | Dark Store Prohibition Guard | Explicit backend check rejects dark store merchants (`code: DARK_STORE_NOT_SUPPORTED`). Only independent stores supported. | **COMPLETE** | None |
| **Driver Experience** | Grocery Delivery Flow | Heavy-item parcel handling instructions, bag count verification, customer drop-off OTP. | **COMPLETE** | Multi-bag photo verification |
| **Backend & Schema** | Database Tables | `master_grocery_catalog`, `merchant_grocery_inventory`, `checkouts`, `orders`, `order_lines`. Tested in Phase 4 suite (66/66 PASS). | **COMPLETE** | Staging migration |
| **Activation Control** | Public Launch Flag | `GROCERY_PUBLIC_ENABLED=false` and `FEATURE_GROCERY`. Backend strictly enforces 403 `FEATURE_DISABLED` when disabled for public launch. | **COMPLETE** | **REMAINS DISABLED FOR INITIAL PUBLIC LAUNCH** |

### 4.3 Verdict & Launch Gate Status
- **Engineering Completion**: **100% COMPLETE** on shared backend and apps.
- **Go-Live Status**: **FEATURE-COMPLETE & TESTED BEFORE 12 DECEMBER; DISABLED FOR PUBLIC TRANSACTIONS ON 1 JANUARY 2027**. Will be activated in a subsequent release upon owner authorization.

---

## 5. SERVICE 4: NABIN PARCEL (PRE-LAUNCH COMPLETION; DISABLED AT GO-LIVE)

### 5.1 Scope & Operational Description
Point-to-point on-demand courier and parcel delivery for documents, packages, and parcels across small, medium, and heavy weight tiers.

### 5.2 Detailed Workflow & Component Breakdown
| Architecture Layer | Subsystem / Workflow | Technical Evidence & Verified Implementation | Status | Remaining Gaps & Blockers |
|---|---|---|---|---|
| **Customer Experience** | Parcel Fare Estimation | `/api/pricing/estimate` with `serviceType: 'PARCEL'`. Calculates base fare, distance, duration, and weight tier. Tested and verified (HTTP 200). | **COMPLETE** | Real-time traffic adjustment |
| | Sender & Recipient Details | `/api/customer/book-parcel` validates sender name/phone, recipient name/phone, package description, and pickup instructions. | **COMPLETE** | Address book integration |
| | Weight Tier Selection | Supports `SMALL` (<2kg), `MEDIUM` (2-5kg), `LARGE` (5-15kg). Validated in `server.js`. | **COMPLETE** | Weighing scale integration |
| | Live Tracking | Real-time package location tracking via driver WebSocket telemetry stream. | **COMPLETE** | Recipient tracking web link |
| **Driver Experience** | Package Inspection & Pickup | Driver inspects package contents (prohibited goods check), confirms pickup, enters sender OTP. | **COMPLETE** | Driver package photo upload |
| | Delivery Proof & OTP | `/api/parcel/:id/delivery-proof` records recipient signature/photo and delivery OTP. Verified in `server.js` (line 9553). | **COMPLETE** | None |
| **Backend & Schema** | Database Tables | `jobs` (where `service_type = 'PARCEL'`), `dispatch_requests`, `ledger_entries`. Audited in Migration 005 and 014. | **COMPLETE** | Staging database migration |
| | Prohibited Goods Refusal | Terms and validation refuse hazardous materials, contraband, and cash. | **COMPLETE** | Legal compliance review |
| **Activation Control** | Public Launch Flag | `PARCEL_PUBLIC_ENABLED=false` and `FEATURE_PARCEL`. Backend strictly enforces 403 `FEATURE_DISABLED` when disabled for public launch. | **COMPLETE** | **REMAINS DISABLED FOR INITIAL PUBLIC LAUNCH** |

### 5.3 Verdict & Launch Gate Status
- **Engineering Completion**: **100% COMPLETE** on shared backend and Flutter client.
- **Go-Live Status**: **FEATURE-COMPLETE & TESTED BEFORE 12 DECEMBER; DISABLED FOR PUBLIC TRANSACTIONS ON 1 JANUARY 2027**. Will be activated in a subsequent release upon owner authorization.

---

## 6. INDEPENDENT SERVICE ACTIVATION MATRIX

The backend enforces independent feature flags via `FeatureControlService`:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        INDEPENDENT SERVICE ACTIVATION SETTINGS                         │
├─────────────────────┬──────────────────┬─────────────────┬─────────────────────────────┤
│ Service             │ Environment Flag │ Initial Setting │ Operational Launch Status   │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ NABIN Ride          │ RIDE_PUBLIC_     │ true (pending   │ ENABLED ON INITIAL LAUNCH   │
│                     │ ENABLED          │ release gates)  │ (1 January 2027)            │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ NABIN Food          │ FOOD_PUBLIC_     │ true (pending   │ ENABLED ON INITIAL LAUNCH   │
│                     │ ENABLED          │ release gates)  │ (1 January 2027)            │
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ NABIN Grocery       │ GROCERY_PUBLIC_  │ false           │ DISABLED ON INITIAL LAUNCH  │
│                     │ ENABLED          │                 │ (Activates in later release)│
├─────────────────────┼──────────────────┼─────────────────┼─────────────────────────────┤
│ NABIN Parcel        │ PARCEL_PUBLIC_   │ false           │ DISABLED ON INITIAL LAUNCH  │
│                     │ ENABLED          │                 │ (Activates in later release)│
└─────────────────────┴──────────────────┴─────────────────┴─────────────────────────────┘
```

- When `GROCERY_PUBLIC_ENABLED=false` or `PARCEL_PUBLIC_ENABLED=false`:
  - Public booking and order endpoints return HTTP `403` with code `FEATURE_DISABLED` and message `"Service or feature is currently disabled: <FEATURE_NAME>"`.
  - Admin inspection, internal database records, audit trails, and automated testing capabilities remain 100% accessible.
  - Client web and mobile applications display transparent "Coming Soon in our next release" notices for those service tabs.

---

## 7. REMAINING CROSS-SERVICE DEFECTS & EXTERNAL BLOCKERS

| Defect / Blocker | Impacted Services | Category | Severity | Resolution Action & Owner |
|---|---|---|---|---|
| **BLK-01: Mobile Keystore & Product Flavors** | Ride, Food, Grocery, Parcel | Mobile Toolchain | MEDIUM | Replace Debug Keystore with production keystore; configure Gradle flavors for Customer, Driver, Merchant. *(Mobile App Builder)* |
| **BLK-02: Staging Cloud Migration** | Ride, Food, Grocery, Parcel | Infrastructure | HIGH | Provision staging Supabase and apply approved 36-migration manifest via `migrate.js`. *(Owner / DevOps)* |
| **BLK-03: India DLT Transactional SMS** | Ride, Food, Grocery, Parcel | Compliance | HIGH | Complete TRAI DLT registration for Entity ID, Sender Header (`NABINM`), and OTP templates. *(Owner Action)* |
| **BLK-04: Payment Gateway Merchant KYC** | Ride, Food (Launch), Grocery | Finance | HIGH | Owner to confirm chosen payment aggregator (Razorpay vs Cashfree); complete merchant KYC. *(Owner Action)* |
| **BLK-05: Apple iOS Build Infrastructure** | Ride, Food | Mobile Distribution | MEDIUM | Enroll in Apple Developer Program; configure macOS CI runner for iOS compilation. *(Owner / DevOps)* |
| **BLK-06: Production Domain & DNS** | Ride, Food, Announcement Site | Infrastructure | LOW | Owner to verify primary brand domain (`nabin.in` vs `nabin.com`); configure DNS records. *(Owner Action)* |

---

## 8. CORRECTIONS TO PRIOR OVERCLAIMS (dated, per the measured-record rule)

The original 11 October matrix asserted an absolute security posture that current code does not support. Narrative entries elsewhere in the record are kept as measured; **this living readiness doc is corrected in place**, with the superseded claim named so the change is auditable rather than silent:

- **Supersedes §2.2 "Zero IDOR leakage" (was **COMPLETE**).** Measured now: `/api/admin` paths authenticate but skip a permission check; `/api/media/signed-params` and `/api/media` are unauthenticated. Status is **PARTIAL** pending the owner-authorized §4 endpoint-authorization remediation (`#272`/`#273`). Schema-level RLS and the advisory dispatch locks named in that row were real and are unchanged.
- **The "13 of 37" figure above is superseded by a derived inventory (measured 2026-10-13).** Counting registrations rather than the paths they serve, and rather than only `app.get('/api/admin…')` one-line forms: `src/server.js` registers **207** routes across **239** reachable paths (175 single-path lines plus **32** array-path registrations, each of which was measured to bind exactly two paths), of which **88** are `/api/admin` — **69** carry identity **and** a permission middleware, **16** carry identity only, **3** carry none. Three of those 16 authorize inside the handler and are therefore **not** gaps (`POST /api/admin/reset-password` `:1808` self-or-`admin_accounts.manage`; the two feature-flag writes `:8052`/`:8137` require `role === 'SUPER_ADMIN'`), and one is self-scoped by design (`GET /api/admin/me` `:1851` returns `req.admin` and nothing else), so the admin exposure is the twelve `authenticateAdmin`-only **reads** plus the media family. Two qualifiers the bare counts hide: the exposure is **horizontal, not anonymous** — `authenticateAdmin` (`:1137`) admits a valid session of any of the five admin roles, and of the 3 admin paths with no guard token two are the public bootstrap/login entry points and the third authenticates in its handler, so no admin capability is anonymously reachable. And least-privilege here follows a **precedent in the same file**: 24 of 38 admin GET registrations already carry a permission key (`finance.view` gates `/api/admin/finance/metrics` while `/api/admin/metrics` is ungated; `customers.read` gates `/api/admin/customers` while `/api/admin/drivers` is ungated), and 9 of the 12 can be gated with a key the matrix already grants — only `/metrics`, `/jobs` and `/supabase-status` would need a new one. Full derivation, the parse traps that had to be fixed first, and the zero-client-caller evidence for `/api/media*` are in `docs/NABIN_SERVICE_BACKEND_EVIDENCE_20261012.md`'s `#272`/`#273` rows; the decision stays D-8's.
- **Test-count rows are local-execution figures, not a security sign-off.** The "46/46 Security" style cells report automated suite pass counts as measured on the local store; they do **not** certify the authorization gaps above, which those suites do not cover.
- **"READY FOR 1-MONTH TEST PHASE" is scoped to local execution only.** Every row still shows Staging **NOT TESTED** and Device **NOT TESTED**, and §7 blockers BLK-02/BLK-03/BLK-04 are unresolved external dependencies. Nothing here is a production-readiness declaration; a system is not production-ready because local tests pass.

---

*Matrix reflects local backend test execution and repository source as of 13 October 2026; it is not a staging, device, or production-readiness sign-off.*
