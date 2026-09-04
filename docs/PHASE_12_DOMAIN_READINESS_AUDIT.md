# NABIN — PHASE 12: MARKETPLACE & BUSINESS DOMAIN READINESS AUDIT

> **Audit Execution Date:** September 4, 2026  
> **Baseline Commit:** `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`  
> **Test Baseline Status:**  
> - Backend Integration: **210 passed / 0 failed**  
> - Backend Cold Restart: **27 passed / 0 failed**  
> - Flutter Analyze: **0 issues**  
> - Flutter Tests: **18 passed / 0 failed**  
> - Total Automated Tests: **255 passed / 0 failed**  
> **Database Baseline:** Migrations 001–015 (strictly preserved, untouched, no Migration 016)

---

## 1. EXECUTIVE SUMMARY

Following the successful completion and production hardening of Phase 10 (Identity & KYC Persistence Bridge) and Phase 11 (Hardening & Regression Verification), this forensic audit evaluated the entire NABIN codebase to identify architectural completeness, data durability, security posture, financial safety, and client integration readiness across all business domains.

### Key Audit Findings

1. **Dual-Tier Architecture Discrepancy**:
   - **Tier 1 (PostgreSQL-Authoritative & Durable)**: Users, Driver core registry, Jobs (Rides), Identity Documents / KYC, Support Tickets, Audit Logs, Promotions & Redemptions, Pricing Configurations, Geofences, Surge Zones, Double-Entry General Ledger, and School & Child profiles. These survive cold reboots and are covered by automated integration and restart suites.
   - **Tier 2 (Volatile / In-Memory Mock Persistence)**: Payment Checkout Sessions (`db.paymentSessions`), Driver Payouts (`db.recordPayout`), Driver Earnings & Transaction Histories (`db.transactions`), Grocery Catalog & Darkstore Inventory (`db.masterProducts`, `db.merchantInventory`, `db.groceryOrders`), Merchant Food Menus (`db.restaurants`), and Platform Service Controls (`db.platformServices`). When the server restarts, checkout sessions vanish, driver payouts are erased from history, and grocery/merchant updates reset to hard-coded seed arrays.

2. **Critical Security & IDOR Vulnerabilities**:
   - **Fail-Open User Authentication**: `authenticateUser` middleware sets `req.user = null` when the `Authorization` header is missing, allowing `POST /api/customer/book-ride`, `/book-food`, and `/book-parcel` to fall back to `db.getUser('usr_1')` or client-supplied `customerId`. An unauthenticated attacker can book rides under arbitrary customer accounts.
   - **Zero Authentication on Driver Financials**: `POST /api/driver/payout` and `GET /api/driver/:driverId/earnings` have no authentication middleware. Any caller can trigger instant payouts to arbitrary UPI IDs or inspect confidential driver balances without credentials.
   - **Driver IDOR / BOLA Exposure**: Driver endpoints (`/api/driver/:driverId/toggle-online`, `/api/driver/:driverId/dashboard`) do not verify if `req.driver.id === req.params.driverId`. Any authenticated driver can manipulate or read another driver's account.

3. **Financial Safety & Database Gap**:
   - Migrations 002, 006, and 007 created sophisticated PostgreSQL financial infrastructure (`payment_sessions`, `payments`, `driver_payouts`, `capture_payment_atomic`, `adjust_wallet_atomic`). However, the Node runtime (`PaymentRepository.js` and `database.js`) currently bypasses these tables and RPCs, mutating in-memory arrays instead.
   - **Missing Cancellation & Refund Lifecycle**: There is no ride cancellation endpoint (`cancelJob` is unimplemented), meaning customer ride cancellations, cancellation fee rules, and escrow/wallet refund reversals cannot execute.

4. **Flutter Super-App Integration Gap**:
   - While Flutter features 38 polished screens and `NabinApiService` provides 21 client methods, core booking screens (`ride_booking_screen.dart`, `parcel_booking_screen.dart`, `active_ride_screen.dart`, `wallet_screen.dart`) currently transition via local in-memory navigation state rather than calling the live backend APIs.

---

## 2. DOMAIN INVENTORY

Every discovered business domain classified according to its operational readiness:

| Domain | Implemented Components | Current Classification | Primary Risk / Notes |
| :--- | :--- | :--- | :--- |
| **Authentication & RBAC** | OTP verify, JWT sessions, Admin accounts, 5 RBAC roles | **DATABASE-BACKED** | Robust against brute force; `authenticateUser` middleware has fail-open flaw on public ride routes. |
| **Users / Customers** | Profile, wallet balance, identity status, session tokens | **DATABASE-BACKED** | Authoritative in `users` table; synced on startup. |
| **Identity / KYC** | Submission, reviewer locking, PII masking, approval/rejection | **COMPLETE** | Phase 10/11 benchmark: 100% PostgreSQL-backed, audited, restart-safe. |
| **Driver Registry** | Profile, vehicle plate, category, license number, status | **DATABASE-BACKED** | Authoritative in `drivers` table; online/offline toggle is memory-cached. |
| **Fleet Tracking (GPS)** | High-frequency GPS updates, WebSocket telemetry broadcast | **PARTIALLY COMPLETE** | In-memory `fleetLocations` Map (by design to avoid DB write exhaustion); Redis bridge pending. |
| **Ride Booking & Dispatch** | Pricing calculation, OTP generation, driver matching | **PARTIALLY COMPLETE** | Authoritative jobs created in `jobs` table, but cancellation endpoint is missing and Flutter uses local mock navigation. |
| **Ride State Machine** | REQUESTED → ASSIGNED → IN_TRANSIT → COMPLETED | **PARTIALLY COMPLETE** | Happy path verified; CANCELLED terminal state lacks API routes and refund mechanics. |
| **Payments (Checkout)** | Order session creation, client signature verification | **MOCK / IN-MEMORY** | Stored in in-memory Map; does not write to `payment_sessions` or call `capture_payment_atomic`. |
| **Payments (Webhooks)** | HMAC validation, replay protection, double-entry ledger | **DATABASE-BACKED** | Verified in `test_suite.js` and `restart_test.js`; writes to `journal_transactions`. |
| **Wallets & Payouts** | Driver earnings, instant UPI payout, balance checks | **MOCK / IN-MEMORY** | `POST /api/driver/payout` is unauthenticated; mutations bypass `adjust_wallet_atomic` and disappear on reboot. |
| **Pricing & Dynamic Surge** | Distance/time fare calculation, 2W/3W/4W base fares, surge | **COMPLETE** | Persisted in `pricing_configurations`, dynamic calculations zero-trust validated. |
| **Geofencing & Spatial** | Point-in-polygon, circle zones, zone surcharges | **COMPLETE** | Persisted in `geo_fences` & `surge_zones`; verified in restart suite. |
| **Promotions & Coupons** | Code validation, percentage/flat discounts, atomic redemptions | **COMPLETE** | Authoritative in `promotions` and `promotion_redemptions`; limits enforced via row locks. |
| **Customer Support** | Support tickets, threaded agent responses, status lifecycle | **DATABASE-BACKED** | Authoritative in `support_tickets`; verified in restart suite. |
| **Audit Logs** | Security event logging, reviewer attribution, tamper checks | **COMPLETE** | Immutable audit trail in `audit_logs`; covers all admin operations. |
| **School & Child Commute** | Saved schools, children profiles, guardian linkage | **DATABASE-BACKED** | Direct PostgreSQL queries via `SchoolChildRepository` (Migration 015). |
| **Grocery (Quick Commerce)** | Master catalog, merchant inventory, price alerts, order cart | **MOCK / IN-MEMORY** | Schema exists in Migrations 001/013, but Node runtime runs entirely on hardcoded in-memory arrays. |
| **Food & Restaurants** | Merchant restaurant profiles, menu item availability toggles | **MOCK / IN-MEMORY** | `restaurants` array in `database.js` is volatile; updates reset on server restart. |
| **Platform Controls** | Service pauses, emergency killswitches, resume timers | **MOCK / IN-MEMORY** | Maintained in `platformServices` memory object; reset to active on reboot. |
| **Media / CDN** | Cloudinary uploads, signed upload params, photo URLs | **PARTIALLY COMPLETE** | Functional wrapper for Cloudinary; metadata kept in-memory. |

---

## 3. PERSISTENCE MATRIX

Audit of all business entities against PostgreSQL durability and restart safety:

| Entity / Collection | PostgreSQL Table | In-Memory Cache | Survives Restart? | Authoritative Source |
| :--- | :--- | :--- | :--- | :--- |
| **Users** | `public.users` | `this.users` | **Yes** | PostgreSQL |
| **Identity Documents** | `public.identity_documents` | `this.identityApplications` | **Yes** | PostgreSQL |
| **Drivers** | `public.drivers` | `this.drivers` | **Yes** | PostgreSQL |
| **Jobs (Rides/Orders)** | `public.jobs` | `this.jobs` | **Yes** | PostgreSQL |
| **Double-Entry Ledger** | `public.journal_transactions`, `lines` | `this.ledgerEntries` | **Yes** | PostgreSQL |
| **Promotions** | `public.promotions` | `this.promotions` | **Yes** | PostgreSQL |
| **Promo Redemptions** | `public.promotion_redemptions` | None (Direct RPC) | **Yes** | PostgreSQL |
| **Pricing Configurations**| `public.pricing_configurations` | `this.pricingConfig` | **Yes** | PostgreSQL |
| **Geofences** | `public.geo_fences` | `this.geoFences` | **Yes** | PostgreSQL |
| **Surge Zones** | `public.surge_zones` | `this.surgeZones` | **Yes** | PostgreSQL |
| **Support Tickets** | `public.support_tickets` | `this.supportTickets` | **Yes** | PostgreSQL |
| **Audit Logs** | `public.audit_logs` | `this.auditLogs` | **Yes** | PostgreSQL |
| **Saved Schools** | `public.saved_schools` | `this.savedSchools` (fallback) | **Yes** | PostgreSQL |
| **Saved Children** | `public.saved_children` | `this.savedChildren` (fallback) | **Yes** | PostgreSQL |
| **Admin Accounts** | `public.admin_accounts` | `this.adminUsers` | **Yes** | PostgreSQL |
| **Payment Sessions** | `public.payment_sessions` | `this.paymentSessions` (Map) | ❌ **No** | In-Memory Map |
| **Driver Payout Records**| `public.driver_payouts` | `this.transactions` (Array) | ❌ **No** | In-Memory Array |
| **Payment Webhook Cache**| `public.payment_webhooks` | `this.processedWebhookIds` | **Yes** (Hydrated) | PostgreSQL |
| **Grocery Catalog** | `public.master_grocery_catalog` | `this.masterProducts` | ❌ **No** | In-Memory Array |
| **Merchant Inventory** | `public.merchant_grocery_inventory`| `this.merchantInventory` | ❌ **No** | In-Memory Array |
| **Grocery Orders** | `public.checkouts` | `this.groceryOrders` | ❌ **No** | In-Memory Array |
| **Restaurants / Menus** | `public.merchants`, `products` | `this.restaurants` | ❌ **No** | In-Memory Array |
| **Platform Service State**| `public.platform_settings` | `this.platformServices` | ❌ **No** | In-Memory Object |
| **Fleet Telemetry (GPS)**| None (Redis design target) | `this.fleetLocations` (Map) | ❌ **No** | In-Memory Map |

---

## 4. DATABASE AUDIT (MIGRATIONS 001–015)

Inspection of migrations 001–015 confirmed that the underlying schema is robust and comprehensive:

* **001_central_schema.sql**: Created core tables (`users`, `identity_documents`, `drivers`, `merchants`, `jobs`, `admin_accounts`, `geo_fences`, `promotions`, `audit_logs`).
* **002_finance_ledger_schema.sql**: Created full chart of accounts, `journal_transactions`, `journal_lines`, `payments`, and `driver_payouts`.
* **003_extended_schema.sql**: Created `active_sessions`, `notifications`, `support_tickets`, `platform_settings`.
* **004_missing_entities_schema.sql**: Created `products`, `advertisements`, `user_saved_locations`, `user_delegates`.
* **006_payments_domain.sql**: Created `payment_sessions` table with RLS and the critical `capture_payment_atomic(p_order_id, ...)` RPC.
* **007_wallets_domain.sql**: Created `adjust_wallet_atomic(p_owner_id, ...)` RPC guaranteeing row locking, balance constraints, and double-entry synchronization.
* **009_promotions_domain.sql**: Created `promotion_redemptions` table and `redeem_promotion_atomic` RPC.
* **010_admin_audit_domain.sql**: Added immutable constraints and indexes on `audit_logs`.
* **011_geofences_surge_domain.sql**: Created `pricing_configurations` and `surge_zones`.
* **012_notifications_domain.sql**: Created notification preferences, device tokens, and deliveries.
* **013_checkout_domain.sql**: Created `checkouts` and `checkout_events`.
* **014_dispatch_domain.sql**: Created `dispatch_offers` for driver assignment tracking.
* **015_school_child_domain.sql**: Created `saved_schools` and `saved_children`.

> **CRITICAL VERIFICATION**: No new database migration (016) is required. Migrations 001–015 already define `payment_sessions`, `payments`, `driver_payouts`, `capture_payment_atomic`, and `adjust_wallet_atomic`. The entire gap lies in connecting the backend repository layer to these existing database tables and stored procedures.

---

## 5. API ROUTE COVERAGE & AUDIT

Of **120** declared API routes in `server.js`:
- **76 routes (63.3%)** are actively validated in `test_suite.js`.
- **44 routes (36.7%)** are currently untested in automated suites.

### Key Route Vulnerabilities & Exposure

| Route | Method | Middleware | Database-Backed? | Security / Functional Assessment |
| :--- | :--- | :--- | :--- | :--- |
| `/api/customer/book-ride` | `POST` | `authenticateUser` | Yes (`jobs`) | **FAIL-OPEN AUTH**: If header is omitted, `req.user = null` and server defaults to `usr_1`. Accepts arbitrary `customerId` in body (IDOR). |
| `/api/customer/book-food` | `POST` | `authenticateUser` | In-memory | Same fail-open and IDOR vulnerability as ride booking. |
| `/api/customer/book-parcel` | `POST` | `authenticateUser` | Yes (`jobs`) | Same fail-open and IDOR vulnerability as ride booking. |
| `/api/driver/payout` | `POST` | **NONE** | ❌ In-memory | **CRITICAL P0**: Unauthenticated route allowing arbitrary UPI payout triggers and in-memory wallet deductions. |
| `/api/driver/:driverId/earnings` | `GET` | **NONE** | ❌ In-memory | **CRITICAL P0**: Unauthenticated route allowing public leakage of any driver's earnings and wallet balance. |
| `/api/driver/:driverId/toggle-online`| `POST` | `authenticateDriver` | ❌ In-memory | **IDOR**: Fails to verify whether `req.driver.id === req.params.driverId`. |
| `/api/driver/:driverId/dashboard` | `GET` | `authenticateDriver` | ❌ In-memory | **IDOR**: Any driver can view any other driver's dashboard and trip history. |
| `/api/payments/create-order` | `POST` | **NONE** | ❌ In-memory | Public session creation; stores session in ephemeral Map without writing to `payment_sessions`. |
| `/api/payments/verify-checkout` | `POST` | **NONE** | ❌ In-memory | Verification modifies ephemeral Map; does not invoke `capture_payment_atomic` RPC. |
| `/api/payments/webhook` | `POST` | Signature Check | **Yes** | Correctly validates HMAC signature, checks idempotency, and records ledger entries. |
| `/api/schools`, `/api/children` | `*` | `requireCustomerAuth`| **Yes** | Properly authenticates customer and isolates records to `req.user.id`. |

---

## 6. FLUTTER INTEGRATION AUDIT

The Flutter project contains **46** feature Dart files and **38** distinct screens across Customer, Driver, Grocery, and Restaurant shells:

* **Centralized API Client (`mobile/lib/core/network/nabin_api_service.dart`)**:
  - Implements 21 client functions including `sendOtp`, `verifyOtp`, `getProfile`, `calculateFareEstimate`, `bookRide`, `bookFood`, `bookParcel`, `revalidateCart`, `validateGroceryCheckout`, `getIdentityStatus`, `submitIdentity`, `applyPromoCoupon`, `submitSupportTicket`, `toggleDriverOnline`, `acceptJob`, `verifyTripOtp`, and `getDriverEarnings`.
  - Attaches Bearer authentication tokens via `_attachAuthHeader`.
* **Current UI Disconnect**:
  - `phone_entry_screen.dart` and `otp_verification_screen.dart`: Fully integrated with `NabinApiService`.
  - `customer_support_screen.dart`: Fully integrated with `NabinApiService.submitSupportTicket`.
  - `ride_booking_screen.dart`: Does **not** invoke `NabinApiService.bookRide`. Instead, it constructs a local `PassengerBookingInfo` object and navigates via `context.push('/active-ride', extra: {...})`.
  - `active_ride_screen.dart`: Renders hardcoded mock driver info (`Rajesh Kumar`, `DL 1RA 4892`) and connects to `NabinWsService` with a dummy user ID (`cust_active`).
  - `wallet_screen.dart`: Renders static wallet balances rather than fetching from `GET /api/auth/me`.

---

## 7. SECURITY AUDIT FINDINGS

### P0 — Critical (Immediate Remediation Required)

1. **Broken Authentication on Ride/Food/Parcel Booking**:
   - `authenticateUser` middleware does not reject requests when the `Authorization` header is omitted (`req.user = null; return next();`).
   - `server.js` route handlers contain fallback code: `const user = (customerId ? db.getUser(customerId) : req.user) || db.getUser('usr_1');`.
   - **Impact**: Unauthenticated users can book trips and charge rides to `usr_1` or any arbitrary `customerId` passed in JSON.
2. **Unauthenticated Driver Payout Trigger (`POST /api/driver/payout`)**:
   - Route has zero middleware. Anyone can POST `{ driverId: 'DRV-101', amount: 500, upiId: 'attacker@upi' }`.
3. **Unauthenticated Driver Earnings Disclosure (`GET /api/driver/:driverId/earnings`)**:
   - Route exposes driver wallet balances, daily/weekly earnings, and entire platform transactions list to any unauthenticated caller.

### P1 — High (Production Blockers)

1. **Driver BOLA/IDOR on Status & Dashboard**:
   - `POST /api/driver/:driverId/toggle-online` and `GET /api/driver/:driverId/dashboard` accept a URL parameter without checking if `req.driver.id === req.params.driverId`.
2. **Payment Session Ephemerality & Gateway Decoupling**:
   - `POST /api/payments/create-order` and `POST /api/payments/verify-checkout` store and verify orders in an in-memory `Map`.
   - Restarting the server while a customer is completing checkout in Razorpay causes verification to fail with `Payment session not found in database`.
   - Successful checkout does not invoke the authoritative `capture_payment_atomic` PostgreSQL procedure.

### P2 — Moderate

1. **Volatile Platform Emergency Controls**:
   - Admin service pause toggles (`db.platformServices`) are stored in-memory. If an emergency killswitch is engaged and the container restarts, the service silently resumes.
2. **Grocery & Restaurant Darkstore State Loss**:
   - Product stock and restaurant operating hours modified via admin/merchant APIs are not persisted in PostgreSQL.

---

## 8. FINANCIAL SAFETY AUDIT

* **Server-Side Pricing Engine**:
  - Ride booking pricing (`db.calculateFareEstimate`) is calculated strictly on the backend. Tests `SEC: Client fare tampering rejected` confirm that client-supplied fares, surge multipliers, and discounts are overridden by server calculations.
* **Double-Entry Ledger Integrity**:
  - Webhook captures and completed ride jobs properly trigger `recordLedgerEntry`, inserting balanced `DEBIT` and `CREDIT` rows into `journal_transactions` and `journal_lines`.
* **Driver Payout Financial Leakage**:
  - `db.recordPayout` decrements `driver.walletBalance` in-memory and prepends to `db.transactions`. It **never** calls `adjust_wallet_atomic` or writes to `driver_payouts`. On server restart, the driver's PostgreSQL wallet balance remains unchanged, allowing infinite payout drain.
* **Missing Cancellation & Refund Workflow**:
  - Ride jobs cannot be transitioned to `CANCELLED`. If a driver fails to arrive or a customer cancels, there is no ledger entry to reverse customer wallet deductions or handle cancellation fee distributions.

---

## 9. RIDE / BOOKING STATE MACHINE

### Documented Transitions in `updateJobStatus`:

```text
REQUESTED ──────────► SEARCHING ──────────► ASSIGNED ──────────► ACCEPTED
    │                     │                     │                    │
    ▼                     ▼                     ▼                    ▼
[CANCELLED]           [CANCELLED]           [CANCELLED]      DRIVER_ARRIVING
                                                                     │
                                                                     ▼
                                                              DRIVER_ARRIVED
                                                                     │
                                                                     ▼
                                                                IN_TRANSIT
                                                                     │
                                                                     ▼
                                                             OUT_FOR_DELIVERY
                                                                     │
                                                                     ▼
                                                                 COMPLETED
```

* **Terminal Enforcement**:
  - Once a job reaches `COMPLETED` or `CANCELLED`, `updateJobStatus` throws an error if any subsequent state transition is attempted.
* **State Machine Defect**:
  - There is **no API endpoint** exposed to trigger `CANCELLED` status. Neither customer nor driver can cancel a ride once created.

---

## 10. TEST COVERAGE GAP ANALYSIS

Existing tests in `test_suite.js` (210 tests) and `restart_test.js` (27 tests) provide thorough coverage for:
- Identity & KYC review locks and PII masking (Module 25)
- Spatial geofencing & dynamic pricing (Module 24)
- Promotions and atomic redemptions (Module 23)
- Audit log query and immutable constraints (Module 22)
- Customer support ticket persistence (Module 21)
- School & child commute persistence (Module 20)
- Payment webhook HMAC verification (Module 18)

### High-Priority Test Gaps:
1. **Unauthenticated Ride Booking Guard**: Test asserting unauthenticated `POST /api/customer/book-ride` returns `401 Unauthorized` (currently returns `200` and charges `usr_1`).
2. **Cross-Customer Ride Booking Guard (IDOR)**: Test asserting User A passing `customerId: 'usr_2'` cannot book on behalf of User B.
3. **Driver Payout Authentication & Authorization**: Test asserting `POST /api/driver/payout` requires driver authentication, verifies driver ownership, and fails on insufficient balance.
4. **Driver Dashboard & Status IDOR**: Test asserting Driver A cannot toggle online status or view earnings for Driver B.
5. **Payment Checkout Order Persistence & Atomic Capture**: Test verifying `POST /api/payments/create-order` inserts a row into `payment_sessions` and that checkout verification invokes `capture_payment_atomic`.
6. **Ride Cancellation API & Ledger Reversal**: Test verifying customer/driver cancellation transitions job to `CANCELLED` and triggers refund ledger entries.

---

## 11. PRIORITIZATION & ROADMAP

### P0 — Critical Security & Financial Hardening (Recommended Phase 13)
1. **Secure Customer Booking Endpoints**:
   - Fix `authenticateUser` to fail closed (return `401 Unauthorized` if no valid Bearer token).
   - Enforce server session identity: eliminate `customerId` body override and `usr_1` fallback in `POST /api/customer/book-ride`, `/book-food`, and `/book-parcel`.
2. **Secure Driver Financial Endpoints**:
   - Add `authenticateDriver` to `POST /api/driver/payout` and `GET /api/driver/:driverId/earnings`.
   - Enforce driver IDOR check: reject requests where authenticated `req.driver.id !== req.params.driverId`.
3. **Persist Payment Checkout Sessions & Atomic Capture**:
   - Upgrade `PaymentRepository.js` to persist order sessions into PostgreSQL `payment_sessions`.
   - Update `verifyPaymentSession` to invoke `capture_payment_atomic` RPC.
4. **Persist Driver Payouts & Atomic Wallet Deduction**:
   - Refactor `db.recordPayout` to execute `adjust_wallet_atomic` RPC and insert records into `public.driver_payouts`.

### P1 — Core Business Functionality (Phase 14)
1. **Ride Cancellation & Refund Engine**:
   - Implement `POST /api/customer/cancel-ride` and `POST /api/driver/cancel-job`.
   - Connect cancellation fee policy and double-entry wallet refund reversals.
2. **Wire Flutter Booking to Live Backend API**:
   - Update `ride_booking_screen.dart` to call `NabinApiService.bookRide` and receive the real job entity.
   - Update `active_ride_screen.dart` to subscribe to the real dispatched driver and job ID.

### P2 — Marketplace & Quick Commerce Completeness (Phase 15)
1. Connect Grocery Catalog, Inventory, and Darkstore Orders to PostgreSQL `master_grocery_catalog` and `merchant_grocery_inventory`.
2. Connect Merchant Restaurants & Menus to PostgreSQL `merchants` and `products`.
3. Persist Platform Emergency Service Controls to `platform_settings`.

---

## 12. CONCLUSION & RECOMMENDATION

The audit confirms that the Phase 10 & 11 Identity/KYC persistence bridges and core platform services (promotions, geofences, audit logs, ledger) are stable and reliable.

The **single highest-priority implementation area** for the next phase is:

> **Phase 13: Core Payments, Payouts & Booking Security Hardening**  
> 1. Close the critical fail-open authentication and IDOR gaps on `/api/customer/book-ride`, `/book-food`, `/book-parcel`.  
> 2. Protect `/api/driver/payout` and `/api/driver/:driverId/earnings` with strict driver authentication and authorization.  
> 3. Connect checkout sessions and driver payouts to their existing PostgreSQL tables (`payment_sessions`, `driver_payouts`) and RPCs (`capture_payment_atomic`, `adjust_wallet_atomic`) to guarantee cold-restart financial durability.
