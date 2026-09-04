# NABIN — PHASE 4: DATABASE PERSISTENCE GAP AUDIT

**Date:** 2026-09-04  
**Author:** Antigravity Autonomous Pair Programmer  
**Baseline Commit:** `a2b240dbb3f9469033a7044a7a6225800452e804`  
**Migration Baseline:** 001–015 (authoritative)  
**Database Target:** Local Docker PostgreSQL `127.0.0.1:54322`  
**Status:** COMPLETED — AUDIT ONLY. No schema or code modifications made.

---

## 1. Executive Summary

Following the successful implementation of Migration 015 (School Commute & Child Safety Domain), this Phase 4 audit performs a comprehensive re-evaluation of **all remaining persistence gaps** across the NABIN backend, Flutter mobile clients, runtime in-memory state, and the PostgreSQL schema.

### Core Findings:

1. **Schema Coverage is Near-Complete (40 Tables / 545 Columns / 5 RPCs):**  
   After migrations 001–015, the PostgreSQL schema covers **100% of known business domains** with no outstanding Category D (new table required) gaps discovered. Every data model active in the backend and Flutter client maps to an existing table.

2. **The Dominant Remaining Problem Is NOT Schema Gaps — It Is Application Bridge Gaps:**  
   Approximately **20 of 40 tables** have complete DDL in PostgreSQL but still receive reads/writes exclusively through **in-memory JavaScript arrays** in `database.js`. PostgreSQL schema exists and is ready; what is missing is **repository wiring** (Category B — bridge incomplete).

3. **One Confirmed FUTURE Migration Candidate (Category D — PostGIS):**  
   The driver dispatch matching currently uses pure JavaScript Haversine calculations. This is intentional and architecturally justified for current fleet volumes. However, if fleet scale requires sub-second spatial queries at 10,000+ concurrent drivers, a PostGIS extension migration will be required. This is **NOT required now** and must not be created speculatively.

4. **One Confirmed Architectural Anomaly (Category E — Schema Insufficiency):**  
   The `saved_children` in-memory seed data in `database.js` (lines 1193–1212) still contains the **rejected denormalized fields** (`schoolAddress`, `schoolLat`, `schoolLng`) from before the normalization decision. These fields **do not exist in PostgreSQL** (correctly removed by Migration 015). This is a dead-code seed data anomaly, not a schema gap — the seeds only apply in offline-development mode when `SUPABASE_POSTGRES_LIVE=false`.

5. **No Previously Unknown Category D Gap Found:**  
   The Phase 2 audit identified exactly one Category D gap (School/Child Domain). Migration 015 resolved it. This Phase 4 audit found **no new Category D gaps** in the current codebase.

6. **PersistentStore JSON — Correctly Bypassed in Live Mode:**  
   `persistentStore.js` confirms: when `SUPABASE_POSTGRES_LIVE=true`, JSON file persistence is disabled and PostgreSQL is authoritative. The `store.json` fallback is development-only scaffolding.

---

## 2. Current Migration Baseline (001–015)

| # | Migration | Domain | Primary Tables / Objects |
|:---:|:---|:---|:---|
| 001 | `001_central_schema.sql` | Core Platform, Auth, Fleet, Grocery | `users`, `drivers`, `merchants`, `jobs`, `admin_accounts`, `geo_fences`, `promotions`, `ledger_entries`, `audit_logs`, `payment_webhooks`, `master_grocery_catalog`, `merchant_grocery_inventory`, `grocery_price_history`, `identity_documents` |
| 002 | `002_finance_ledger_schema.sql` | Double-Entry Accounting | `ledger_accounts`, `journal_transactions`, `journal_lines`, `payments`, `driver_payouts` |
| 003 | `003_extended_schema.sql` | Sessions, Support, Notifications | `active_sessions`, `notifications`, `support_tickets`, `platform_settings` |
| 004 | `004_missing_entities_schema.sql` | Products, Ads, Saved Locations | `products`, `advertisements`, `user_saved_locations`, `user_delegates` |
| 005 | `005_jobs_domain.sql` | Job Lifecycle | Enhances `jobs` (status constraints, timestamps, indexes) |
| 006 | `006_payments_domain.sql` | Checkout Sessions | `payment_sessions`, `capture_payment_atomic()`, `refund_payment_atomic()` |
| 007 | `007_wallets_domain.sql` | Atomic Wallets | `adjust_wallet_atomic()`, overdraft guard triggers |
| 008 | `008_support_domain.sql` | Support Escalation | Enhances `support_tickets` (resolution triggers, SLA indexes) |
| 009 | `009_promotions_domain.sql` | Coupons | `promotion_redemptions`, `validate_promotion_preview()`, `redeem_promotion_atomic()` |
| 010 | `010_admin_audit_domain.sql` | Immutable Audit | Enhances `audit_logs` (immutability triggers) |
| 011 | `011_geofences_surge_domain.sql` | Geo/Surge | `surge_zones`, `pricing_configurations`, extends `geo_fences` |
| 012 | `012_notifications_domain.sql` | Push Notifications | `device_tokens`, `notification_preferences`, `notification_deliveries`, `notification_templates` |
| 013 | `013_checkout_domain.sql` | Cart Locking | `checkouts`, `checkout_events` |
| 014 | `014_dispatch_domain.sql` | Driver Dispatch | `dispatch_offers` |
| **015** | **`015_school_child_domain.sql`** | **School Commute** | **`saved_schools`, `saved_children`** |

---

## 3. PostgreSQL Schema Inventory (Post-Migration 015)

**Live query results from local PostgreSQL `127.0.0.1:54322`:**

```
Total Tables:       40
Total Columns:      545
Total Indexes:      146
Total RLS Policies: 56
Total Functions:    5
```

### Complete Table Inventory (40 tables):

| Table | Cols | Created By | Domain |
|:---|:---:|:---|:---|
| `active_sessions` | 9 | 003 | Auth |
| `admin_accounts` | 15 | 001 | RBAC |
| `advertisements` | 12 | 004 | Monetization |
| `audit_logs` | 20 | 001, 010 | Compliance |
| `checkout_events` | 9 | 013 | Cart Analytics |
| `checkouts` | 31 | 013 | Cart Locking |
| `device_tokens` | 10 | 012 | Push Notifications |
| `dispatch_offers` | 15 | 014 | Driver Dispatch |
| `driver_payouts` | 10 | 002 | Settlements |
| `drivers` | 14 | 001 | Fleet |
| `geo_fences` | 19 | 001, 011 | Geofencing |
| `grocery_price_history` | 9 | 001 | Pricing Audit |
| `identity_documents` | 14 | 001 | KYC |
| `jobs` | 32 | 001, 005 | Trips/Dispatch |
| `journal_lines` | 9 | 002 | Double-Entry |
| `journal_transactions` | 11 | 002 | Double-Entry |
| `ledger_accounts` | 10 | 002 | Chart of Accounts |
| `ledger_entries` | 12 | 001 | Ledger |
| `master_grocery_catalog` | 12 | 001 | Grocery SKU |
| `merchant_grocery_inventory` | 8 | 001 | Store Inventory |
| `merchants` | 13 | 001 | Restaurants/Stores |
| `notification_deliveries` | 14 | 012 | Push Audit |
| `notification_preferences` | 17 | 012 | User Preferences |
| `notification_templates` | 11 | 012 | Push Templates |
| `notifications` | 19 | 003, 012 | Notifications |
| `payment_sessions` | 14 | 006 | Checkout Escrow |
| `payment_webhooks` | 12 | 001 | Gateway Events |
| `payments` | 17 | 002 | Settled Payments |
| `platform_settings` | 5 | 003 | Config/Feature Flags |
| `pricing_configurations` | 13 | 011 | Dynamic Pricing |
| `products` | 13 | 004 | Food/Menu Items |
| `promotion_redemptions` | 8 | 009 | Promo Usage |
| `promotions` | 22 | 001, 009 | Coupons |
| **`saved_children`** | **16** | **015** | **School Commute** |
| **`saved_schools`** | **13** | **015** | **School Commute** |
| `support_tickets` | 16 | 003, 008 | Customer Support |
| `surge_zones` | 15 | 011 | Dynamic Pricing |
| `user_delegates` | 7 | 004 | Proxy Auth |
| `user_saved_locations` | 7 | 004 | Saved Places |
| `users` | 12 | 001 | Customer Identity |

### Stored Procedures / RPCs (5):

| Function | Domain | Atomicity Guarantee |
|:---|:---|:---|
| `adjust_wallet_atomic()` | Wallets | ✅ Atomic double-entry |
| `capture_payment_atomic()` | Payments | ✅ Atomic capture + job settlement |
| `refund_payment_atomic()` | Payments | ✅ Atomic refund + ledger reversal |
| `validate_promotion_preview()` | Promotions | ✅ Preview-only, no side effects |
| `redeem_promotion_atomic()` | Promotions | ✅ Atomic redemption counter increment |

---

## 4. Backend Persistence Inventory

### 4.1 Confirmed PostgreSQL-Authoritative Repositories

Five production-grade repositories currently bridge between in-memory arrays and PostgreSQL when `SUPABASE_POSTGRES_LIVE=true`:

| Repository | Tables Used | Hydrated in `initPostgres()` | Write Path |
|:---|:---|:---:|:---|
| `UserRepository.js` | `users` | ✅ Yes | Supabase client UPSERT |
| `DriverRepository.js` | `drivers` | ✅ Yes | Supabase client UPSERT |
| `JobRepository.js` | `jobs` | ✅ Yes | Supabase client INSERT/UPDATE |
| `LedgerRepository.js` | `ledger_accounts`, `journal_transactions`, `journal_lines` | ✅ Yes | `adjust_wallet_atomic` RPC |
| `PaymentRepository.js` | `payment_sessions`, `payments` | ⚠️ Partial | Supabase client INSERT |

### 4.2 In-Memory Collections Without PostgreSQL Bridge

These 20 in-memory collections in `database.js` have **fully matching PostgreSQL tables** (created by migrations 001–015) but are NOT yet wired to write/read from PostgreSQL when in live mode:

| In-Memory Collection | Matching PostgreSQL Table | Migration | Data Survives Restart? | Bridge Status |
|:---|:---|:---|:---:|:---|
| `this.adminUsers` | `admin_accounts` | 001 | ✅ Hydrated in `initPostgres()` | ✅ Hydrated |
| `this.ledgerEntries` | `journal_transactions`, `journal_lines` | 002 | ✅ Hydrated in `initPostgres()` | ✅ Hydrated |
| `this.supportTickets` | `support_tickets` | 003, 008 | ❌ Memory only | ❌ Not bridged |
| `this.promotions` | `promotions` | 001, 009 | ❌ Memory only | ❌ Not bridged |
| `this.auditLogs` | `audit_logs` | 001, 010 | ❌ Memory only | ❌ Not bridged |
| `this.geoFences` | `geo_fences` | 001, 011 | ❌ Memory only | ❌ Not bridged |
| `this.surgeZones` | `surge_zones` | 011 | ❌ Memory only | ❌ Not bridged |
| `this.advertisements` | `advertisements` | 004 | ❌ Memory only | ❌ Not bridged |
| `this.restaurants` | `merchants` | 001 | ❌ Memory only | ❌ Not bridged |
| `this.masterProducts` | `master_grocery_catalog` | 001 | ❌ Memory only | ❌ Not bridged |
| `this.merchantInventory` | `merchant_grocery_inventory` | 001 | ❌ Memory only | ❌ Not bridged |
| `this.groceryProducts` | `master_grocery_catalog` + `merchant_grocery_inventory` | 001 | ❌ Memory only | ❌ Not bridged |
| `this.groceryOrders` | `checkouts` + `jobs` | 005, 013 | ❌ Memory only | ❌ Not bridged |
| `this.groceryPriceHistory` | `grocery_price_history` | 001 | ❌ Memory only | ❌ Not bridged |
| `this.transactions` | `journal_transactions` / `payments` | 002 | ❌ Memory only | ❌ Not bridged |
| `this.settlements` | `driver_payouts` | 002 | ❌ Memory only | ❌ Not bridged |
| `this.identityApplications` | `identity_documents` | 001 | ❌ Memory only (JSON fallback) | ❌ Not bridged |
| `this.savedSchools` | `saved_schools` | **015** | ❌ Memory only | ❌ Not bridged (NEW) |
| `this.savedChildren` | `saved_children` | **015** | ❌ Memory only | ❌ Not bridged (NEW) |
| `this.platformServices` | `platform_settings` | 003 | ❌ Memory only | ❌ Not bridged (partial) |

### 4.3 Intentionally Runtime-Only State (Do NOT Persist to PostgreSQL)

These collections are by design ephemeral and must remain so:

| In-Memory State | Why Ephemeral | Category |
|:---|:---|:---|
| `this.fleetLocations` (Map) | High-frequency GPS; isolating from DB writes is an explicit architectural decision | **C — Ephemeral (GPS telemetry)** |
| `this.activeSessions` (Map) | Stateless session tokens; JWT-based; never persisted to disk | **C — Ephemeral (active sessions)** |
| `this.otpStore` (Map) | Short-TTL OTP codes; deliberately non-persistent | **C — Ephemeral (OTP)** |
| `this.rateLimitRecords` (Map) | Per-IP request throttle counters; session-scoped | **C — Ephemeral (rate limiting)** |
| `this.failedLoginAttempts` (Map) | In-memory lockout counter; resets on restart by design | **C — Ephemeral (lockout counter)** |
| `this.processedWebhookIds` (Set) | Idempotency guard; hydrated from `journal_transactions` on startup | **C — Hybrid: Hydrated from PostgreSQL** |
| `this.processedPaymentIds` (Set) | Idempotency guard; hydrated from `payment_sessions` on startup | **C — Hybrid: Hydrated from PostgreSQL** |
| `this.servicePauseHistory` | Operational event log; sessions die with server | **B — Should bridge to `audit_logs`** |
| `this.pricingConfig` (Object) | Runtime pricing matrix; partially mirrors `pricing_configurations` table | **B — Should hydrate from PostgreSQL** |
| `this.featureFlags` (Map) | Feature toggle state; partially mirrors `platform_settings` table | **B — Should hydrate from PostgreSQL** |
| `this.appVersions` (Object) | Minimum version config; mirrors `platform_settings` | **B — Should hydrate from PostgreSQL** |
| WebSocket `clients` (Map) | Active WebSocket connections; inherently ephemeral socket state | **C — Ephemeral (socket connections)** |

---

## 5. Flutter/Mobile Persistence Inventory

The Flutter mobile apps (`mobile/lib/`) interact exclusively with the backend REST API and WebSocket. Flutter has no direct database connection.

### 5.1 Flutter Models Directory (`mobile/lib/core/models/`)

| File | Domain | API Endpoint | Server-Side Table | Persistence |
|:---|:---|:---|:---|:---|
| `school_model.dart` | School Commute | `/api/schools` | `saved_schools` | ✅ Now in PostgreSQL via Migration 015 |
| `child_model.dart` | School Commute | `/api/children` | `saved_children` | ✅ Now in PostgreSQL via Migration 015 |
| `school_child_repository.dart` | School Commute | `/api/schools`, `/api/children` | Both | ✅ Now in PostgreSQL via Migration 015 |
| `passenger_booking_info.dart` | School Ride | Job dispatch payload | `jobs` (JSONB metadata) | ✅ Via jobs table |

### 5.2 Flutter App-Level Local Persistence

Flutter uses `shared_preferences` and Flutter-local storage for:

| Flutter Data | Persistence Type | Should it be PostgreSQL? |
|:---|:---|:---|
| Auth token / session token | Device `SharedPreferences` | No — ephemeral, refreshed on login |
| Recently viewed addresses | Device `SharedPreferences` | No — UI convenience only |
| App theme / dark mode preference | Device `SharedPreferences` | No — device-local preference |
| Grocery cart (pre-checkout) | In-memory `Provider` state | No — volatile; committed at checkout |
| Notification permissions granted | Device OS storage | No — OS-managed |

**Conclusion:** No Flutter local persistence requires server-side PostgreSQL backing. All durable business state flows through API calls.

---

## 6. Runtime In-Memory State Classification

Full classification of every Map/Set/Array in `database.js` and `server.js`:

### Classification A — Correct: Already Persisted

| State | Authoritative Table | Notes |
|:---|:---|:---|
| `this.users` | `users` | Hydrated from PostgreSQL on startup |
| `this.drivers` | `drivers` | Hydrated from PostgreSQL on startup |
| `this.jobs` | `jobs` | Hydrated from PostgreSQL on startup (latest 200) |
| `this.ledgerEntries` | `journal_transactions` + `journal_lines` | Hydrated from PostgreSQL on startup |
| `this.adminUsers` | `admin_accounts` | Hydrated from PostgreSQL on startup |
| `this.processedWebhookIds` | `journal_transactions.reference_id` | Hydrated on startup for idempotency |

### Classification B — Bridge Incomplete (Schema Ready, No Repository)

> **These are the highest-priority candidates for the next Phase 5 application bridge work.**

| State | Matching Table | Migration | Priority | Restart Survival | RLS Ready? |
|:---|:---|:---|:---:|:---:|:---:|
| `this.supportTickets` | `support_tickets` | 003, 008 | **CRITICAL** | ❌ Lost | ✅ Yes |
| `this.auditLogs` | `audit_logs` | 001, 010 | **CRITICAL** | ❌ Lost | ✅ Yes |
| `this.promotions` | `promotions` | 001, 009 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.geoFences` | `geo_fences` | 001, 011 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.surgeZones` | `surge_zones` | 011 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.advertisements` | `advertisements` | 004 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.restaurants` | `merchants` | 001 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.masterProducts` | `master_grocery_catalog` | 001 | **HIGH** | ❌ Lost | ✅ Yes |
| `this.merchantInventory` | `merchant_grocery_inventory` | 001 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.groceryProducts` | `master_grocery_catalog` + `merchant_grocery_inventory` | 001 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.identityApplications` | `identity_documents` | 001 | **HIGH** | ❌ Lost (JSON fallback) | ✅ Yes |
| `this.savedSchools` | `saved_schools` | **015** | **HIGH** | ❌ Lost | ✅ Yes |
| `this.savedChildren` | `saved_children` | **015** | **HIGH** | ❌ Lost | ✅ Yes |
| `this.pricingConfig` | `pricing_configurations` | 011 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.featureFlags` | `platform_settings` | 003 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.appVersions` | `platform_settings` | 003 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.settlements` | `driver_payouts` | 002 | **MEDIUM** | ❌ Lost | ✅ Yes |
| `this.transactions` | `journal_transactions` / `payments` | 002 | **LOW** | ❌ Lost (redundant with ledger) | ✅ Yes |
| `this.groceryOrders` | `checkouts` + `jobs` | 005, 013 | **LOW** | ❌ Lost | ✅ Yes |
| `this.groceryPriceHistory` | `grocery_price_history` | 001 | **LOW** | ❌ Lost | ✅ Yes |
| `this.servicePauseHistory` | `audit_logs` | 001, 010 | **MEDIUM** | ❌ Lost | ✅ Yes |

### Classification C — Intentionally Ephemeral (Do NOT Persist)

| State | Reason |
|:---|:---|
| `this.fleetLocations` (Map) | Architecture mandates: "Never write raw GPS streams directly to PostgreSQL" |
| `this.activeSessions` (Map) | Stateless JWT sessions; session recovery not required |
| `this.otpStore` (Map) | 5-min TTL OTP codes; persistence would be a security risk |
| `this.rateLimitRecords` (Map) | Request throttle counters; server restart clears limit — by design |
| `this.failedLoginAttempts` (Map) | Lockout counter; restart amnesty is acceptable |
| `clients` WebSocket Map | Socket handles; inherently ephemeral |

---

## 7. API Persistence Audit

Inspecting all server.js API routes for state mutations that do NOT persist to PostgreSQL:

### 7.1 Routes Writing Only to In-Memory State (High Business Risk)

| Route | Method | In-Memory Target | PostgreSQL Target | Risk |
|:---|:---|:---|:---|:---|
| `/api/support/ticket` | POST | `this.supportTickets` | `support_tickets` | **CRITICAL** — Tickets lost on restart |
| `/api/support/ticket/:id/message` | POST | `this.supportTickets` | `support_tickets` | **CRITICAL** — Messages lost on restart |
| `/api/admin/support/:id/resolve` | POST | `this.supportTickets` | `support_tickets` | **CRITICAL** — Resolutions lost |
| `/api/admin/audit-logs` | GET | `this.auditLogs` | `audit_logs` | **CRITICAL** — Audit trail not durable |
| `/api/admin/promotions` | POST | `this.promotions` | `promotions` | **HIGH** — New promos lost |
| `/api/admin/geofences` | POST | `this.geoFences` | `geo_fences` | **HIGH** — New zones lost |
| `/api/admin/surgezones` | POST | `this.surgeZones` | `surge_zones` | **HIGH** — New rules lost |
| `/api/advertisements` | GET | `this.advertisements` | `advertisements` | **HIGH** — Ad campaigns not persisted |
| `/api/schools` | POST/PUT/DELETE | `this.savedSchools` | `saved_schools` ✅ | **HIGH** — Schema now exists; bridge missing |
| `/api/children` | POST/PUT/DELETE | `this.savedChildren` | `saved_children` ✅ | **HIGH** — Schema now exists; bridge missing |
| `/api/merchant/:id` | PUT | `this.restaurants` | `merchants` | **HIGH** — Merchant edits lost |
| `/api/merchant/:id/menu` | POST | `this.restaurants` | `merchants`, `products` | **HIGH** — Menu items lost |
| `/api/grocery/products` | GET | `this.groceryProducts` | `master_grocery_catalog` | **MEDIUM** — Static catalog data |
| `/api/grocery/checkout/validate` | POST | `this.groceryOrders` | `checkouts` | **MEDIUM** — Orders not persisted to DB |
| `/api/v1/features` | PUT | `this.featureFlags` | `platform_settings` | **MEDIUM** — Flag updates not persisted |
| `/api/services/status` | POST (pause/resume) | `this.platformServices` | `platform_settings`, `audit_logs` | **MEDIUM** — Pause state lost on restart |

### 7.2 Routes Correctly Writing to PostgreSQL

| Route | Method | PostgreSQL Table | Status |
|:---|:---|:---|:---|
| `/api/auth/send-otp`, `/api/auth/verify-otp` | POST | `users`, `active_sessions` | ✅ PostgreSQL |
| `/api/customer/book-ride`, `/api/customer/book-parcel` | POST | `jobs` | ✅ PostgreSQL |
| `/api/driver/accept-job`, `/api/driver/verify-otp` | POST | `jobs` | ✅ PostgreSQL |
| `/api/payments/webhook` | POST | `payment_webhooks`, `payment_sessions` via RPC | ✅ PostgreSQL |
| `/api/admin/finance/*` | GET | `journal_transactions`, `ledger_accounts` | ✅ PostgreSQL |
| `/api/admin/login`, `/api/admin/provision` | POST | `admin_accounts` | ✅ PostgreSQL |

---

## 8. Repository / Service Audit

### 8.1 Existing Repositories

| Repository | File | PostgreSQL Tables | Status |
|:---|:---|:---|:---|
| `UserRepository` | `repositories/UserRepository.js` | `users` | ✅ Production-ready |
| `DriverRepository` | `repositories/DriverRepository.js` | `drivers` | ✅ Production-ready |
| `JobRepository` | `repositories/JobRepository.js` | `jobs` | ✅ Production-ready |
| `LedgerRepository` | `repositories/LedgerRepository.js` | `ledger_accounts`, `journal_*` | ✅ Production-ready |
| `PaymentRepository` | `repositories/PaymentRepository.js` | `payment_sessions`, `payments` | ⚠️ Partial (webhook path uses `server.js` directly) |

### 8.2 Missing Repositories (No File Exists)

These repositories need to be built in Phase 5 to bridge in-memory arrays to PostgreSQL:

| Missing Repository | Domain | Priority | Target Tables |
|:---|:---|:---:|:---|
| `SupportRepository` | Customer Disputes | CRITICAL | `support_tickets` |
| `AuditRepository` | Compliance Logging | CRITICAL | `audit_logs` |
| `PromotionRepository` | Coupons | HIGH | `promotions`, `promotion_redemptions` |
| `GeoFenceRepository` | Operational Zones | HIGH | `geo_fences`, `surge_zones` |
| `MerchantRepository` | Food/Grocery | HIGH | `merchants`, `products` |
| `CatalogRepository` | Grocery SKU | HIGH | `master_grocery_catalog`, `merchant_grocery_inventory` |
| `AdvertisementRepository` | Monetization | HIGH | `advertisements` |
| `SchoolChildRepository` | School Commute | HIGH | `saved_schools`, `saved_children` |
| `NotificationRepository` | Push Messaging | MEDIUM | `notifications`, `device_tokens`, `notification_preferences`, `notification_deliveries`, `notification_templates` |
| `CheckoutRepository` | Cart Locking | MEDIUM | `checkouts`, `checkout_events` |
| `DispatchRepository` | Driver Matchmaking | MEDIUM | `dispatch_offers` |
| `PlatformSettingsRepository` | Config / Feature Flags | MEDIUM | `platform_settings` |
| `IdentityRepository` | KYC | HIGH | `identity_documents` |

---

## 9. Security / RLS Audit

### 9.1 RLS Coverage — Post-Migration 015

| Table Group | RLS Enabled | Policies | User Policy | Service Role Policy | Status |
|:---|:---:|:---:|:---:|:---:|:---|
| `users`, `drivers`, `merchants` | ✅ | ≥2 each | `auth.uid() = id` | `service_role` | ✅ Correct |
| `jobs` | ✅ | ≥2 | Customer + Driver FK | `service_role` | ✅ Correct |
| `ledger_accounts`, `journal_*` | ✅ | ≥2 each | No direct user access | `service_role` only | ✅ Locked down |
| `support_tickets` | ✅ | ≥2 | `auth.uid() = user_id` | `service_role` | ✅ Correct |
| `promotions`, `promotion_redemptions` | ✅ | ≥2 | Read-only users, admin write | `service_role` | ✅ Correct |
| `geo_fences`, `surge_zones` | ✅ | ≥2 | Admin-only create | `service_role` | ✅ Correct |
| `notifications`, `device_tokens` | ✅ | ≥2 each | `auth.uid() = user_id` | `service_role` | ✅ Correct |
| `checkouts`, `checkout_events` | ✅ | ≥2 each | `auth.uid() = customer_id` | `service_role` | ✅ Correct |
| `dispatch_offers` | ✅ | ≥2 | Driver-scoped | `service_role` | ✅ Correct |
| **`saved_schools`** | ✅ | **4** | `auth.uid() = user_id` | `service_role` | ✅ Correct (Migration 015) |
| **`saved_children`** | ✅ | **4** | `auth.uid() = user_id` | `service_role` | ✅ Correct (Migration 015) |
| `admin_accounts` | ✅ | ≥2 | Admin self-read | `service_role` | ✅ Correct |
| `audit_logs` | ✅ | ≥1 | Read-only for admins | Immutability trigger | ✅ Correct (no UPDATE/DELETE) |
| `advertisements` | ✅ | ≥1 | Public read | Admin/service write | ✅ Correct |

### 9.2 Security Gaps Found

| Finding | Severity | Nature | Recommendation |
|:---|:---:|:---|:---|
| Support tickets + audit logs written to memory, not PostgreSQL | **HIGH** | Data loss risk — not a security risk per se, but audit trail integrity is compromised | Wire to PostgreSQL in Phase 5 |
| `this.savedChildren` seed data in `database.js` (lines 1193–1212) still contains rejected denormalized fields `schoolAddress`, `schoolLat`, `schoolLng` | **LOW** | Dead-code seed data anomaly; only active in offline dev mode (`SUPABASE_POSTGRES_LIVE=false`); PostgreSQL schema correctly does NOT have these fields | Remove dead fields from seed data in Phase 5 cleanup |
| `identityApplications` KYC data including raw Aadhaar numbers in in-memory array | **MEDIUM** | Raw PII (masked in API responses, but held in process memory) | Wire to `identity_documents` PostgreSQL table with column-level encryption in future |
| Webhook idempotency relies on `processedWebhookIds` Set hydrated from DB on startup | **LOW** | Race condition window on cold start if two webhooks arrive simultaneously | Idempotency key constraint in `payment_webhooks` table provides database-level protection |

---

## 10. Complete Gap Classification Table

| # | Feature / Domain | App Status | PostgreSQL Table | Migration | Classification | Survives Restart | Priority |
|:---:|:---|:---:|:---|:---:|:---:|:---:|:---:|
| 1 | Users & Auth | ✅ Active | `users`, `identity_documents`, `active_sessions` | 001, 003 | **A — Complete** | ✅ Yes | — |
| 2 | Driver Fleet | ✅ Active | `drivers`, `driver_payouts` | 001, 002 | **A — Complete** | ✅ Yes | — |
| 3 | Admin Accounts & RBAC | ✅ Active | `admin_accounts` | 001 | **A — Complete** | ✅ Yes | — |
| 4 | Rides / Jobs | ✅ Active | `jobs` | 001, 005 | **A — Complete** | ✅ Yes | — |
| 5 | Double-Entry Ledger | ✅ Active | `ledger_accounts`, `journal_transactions`, `journal_lines` | 002 | **A — Complete** | ✅ Yes | — |
| 6 | Atomic Wallet RPC | ✅ Active | `adjust_wallet_atomic()` | 007 | **A — Complete** | ✅ Yes | — |
| 7 | Payment Sessions & Escrow | ✅ Active | `payment_sessions`, `payments`, `payment_webhooks` | 002, 006 | **A — Complete** | ✅ Yes | — |
| 8 | **School & Child Domain** | ✅ Active | `saved_schools`, `saved_children` | **015** | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 9 | Support & Disputes | ✅ Active | `support_tickets` | 003, 008 | **B — Bridge Incomplete** | ❌ No | **CRITICAL** |
| 10 | Admin Audit Trail | ✅ Active | `audit_logs` | 001, 010 | **B — Bridge Incomplete** | ❌ No | **CRITICAL** |
| 11 | Promotions & Coupons | ✅ Active | `promotions`, `promotion_redemptions` | 001, 009 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 12 | Geofences & Surge | ✅ Active | `geo_fences`, `surge_zones`, `pricing_configurations` | 001, 011 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 13 | Advertisements | ✅ Active | `advertisements` | 004 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 14 | KYC Applications | ✅ Active | `identity_documents` | 001 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 15 | Restaurants/Merchants | ✅ Active | `merchants`, `products` | 001, 004 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 16 | Grocery Catalog | ✅ Active | `master_grocery_catalog`, `merchant_grocery_inventory` | 001 | **B — Bridge Incomplete** | ❌ No | **HIGH** |
| 17 | Notifications | ✅ Active | `notifications`, `device_tokens`, `notification_preferences` | 003, 012 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 18 | Checkout / Cart | ✅ Active | `checkouts`, `checkout_events` | 013 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 19 | Driver Dispatch Offers | ✅ Active | `dispatch_offers` | 014 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 20 | Platform Settings & Feature Flags | ✅ Active | `platform_settings` | 003 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 21 | Service Pause History | ✅ Active | `audit_logs` | 001, 010 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 22 | Driver Payouts / Settlements | ✅ Active | `driver_payouts` | 002 | **B — Bridge Incomplete** | ❌ No | **MEDIUM** |
| 23 | Grocery Price History | ✅ Active | `grocery_price_history` | 001 | **B — Bridge Incomplete** | ❌ No | **LOW** |
| 24 | GPS Fleet Telemetry | ✅ Active | None (intentional) | — | **C — Intentionally Ephemeral** | ❌ By design | — |
| 25 | Active Sessions (JWT) | ✅ Active | None (intentional) | — | **C — Intentionally Ephemeral** | ❌ By design | — |
| 26 | OTP Store | ✅ Active | None (intentional) | — | **C — Intentionally Ephemeral** | ❌ By design | — |
| 27 | Rate Limiting Map | ✅ Active | None (intentional) | — | **C — Intentionally Ephemeral** | ❌ By design | — |
| 28 | WebSocket Client Map | ✅ Active | None (intentional) | — | **C — Intentionally Ephemeral** | ❌ By design | — |
| 29 | PostGIS Spatial Dispatch | 🔜 Future | None yet | — | **C — Future Feature** | — | When fleet scale requires it |
| 30 | Automated Bank Payout Batch | 🔜 Future | `driver_payouts` (ready) | 002 | **C — Future Feature** | — | When payout automation required |
| 31 | `saved_children` seed data with rejected fields | Dev-only | `saved_children` | 015 | **E — Dead-Code Anomaly** | N/A | LOW cleanup |

---

## 11. Recommended Priority Order for Phase 5 (Application Bridge Work)

No new migrations are required. The work ahead is **repository wiring** — connecting the 20 existing PostgreSQL tables to application code.

### Tier 1 — CRITICAL (Data Loss Risk to Existing Business Operations)

1. **`SupportRepository`** — Support ticket data lost on every backend restart. Active dispute investigations disappear.
2. **`AuditRepository`** — Immutable audit trail is mutable in memory; restarts erase compliance evidence.

### Tier 2 — HIGH (Core Business Data)

3. **`SchoolChildRepository`** (backend) — `saved_schools` and `saved_children` schema now exists (Migration 015), but the Node.js server still reads/writes `this.savedSchools`/`this.savedChildren` in-memory arrays. **This is the most logical next bridge given we just created the tables.**
4. **`IdentityRepository`** — KYC application data including Aadhaar held in in-memory array.
5. **`PromotionRepository`** — Coupon configuration lost on restart; discount campaigns cannot be durable.
6. **`GeoFenceRepository`** — Admin-created geofences and surge rules lost on restart.
7. **`AdvertisementRepository`** — Ad campaigns and impressions not persisted.
8. **`MerchantRepository`** — Merchant profiles and food menus lost on restart.
9. **`CatalogRepository`** — Grocery catalog inventory not persisted.

### Tier 3 — MEDIUM (Operational Completeness)

10. **`NotificationRepository`** — Push notification delivery logs and templates.
11. **`CheckoutRepository`** — Grocery cart checkout data.
12. **`DispatchRepository`** — Dispatch offer state (short-lived but affects active trips).
13. **`PlatformSettingsRepository`** — Feature flags and app version settings.
14. **Driver Payouts / Settlements** — Settlement records bridge to `driver_payouts`.

### Tier 4 — LOW (Analytics / History)

15. **`GroceryPriceHistory`** — Price change audit data.
16. **`GroceryOrders`** — Grocery order history.
17. **Seed data cleanup** — Remove rejected fields from `database.js` saved_children seed (lines 1193–1212).

---

## 12. Candidate for Migration 016

After exhaustive audit of:
- All 40 PostgreSQL tables (created by migrations 001–015)
- All 30+ in-memory collections in `database.js`
- All 60+ API endpoints in `server.js`
- All Flutter models in `mobile/lib/`
- The complete `persistentStore.js` serialization inventory

**No new Category D gap (new table required) has been identified.**

Every active data model in the backend and Flutter client maps to an existing PostgreSQL table. The question of "what database table should hold this data?" has been answered for all current features.

### IF Migration 016 Is Eventually Required, the Most Likely Candidate Is:

**PostGIS Spatial Extension (`016_postgis_spatial_dispatch.sql`)**

| Criterion | Current State | Threshold |
|:---|:---|:---|
| In-memory fleet matching performance | Haversine math in Node.js | Adequate at current simulated scale |
| Concurrent active drivers | < 100 (dev/staging) | Becomes relevant at 10,000+ real drivers |
| Spatial index requirements | None currently | Required for `ST_DWithin()` radius queries |
| Current tests requiring PostGIS | 0 | Must not add dependency without test coverage |

**Verdict:** Migration 016 for PostGIS **cannot be justified now**. It remains Category C.

---

## 13. Candidates That Should NOT Become Migrations

| Proposed Action | Why NOT a Migration |
|:---|:---|
| "Add `is_veg`, `prep_time_minutes` to `products` table" | Both can be stored in existing `metadata JSONB` column in `products`. No DDL required. |
| "Add an `impressions` counter table for ads" | `advertisements.impressions` column already exists (12-col table in Migration 004). No new table needed. |
| "Create a `vehicle_types` lookup table" | `drivers.vehicle_type` uses a check constraint enum. No separate table needed at current scale. |
| "Create a `payout_batches` table" | `driver_payouts` table (Migration 002) already has all required fields for payout tracking. |
| "Create a `restaurant_categories` table" | `merchants.cuisines` uses JSONB/text array. Normalization is premature optimization. |
| "Enable PostGIS now to prepare for future" | Never create schema for speculative future requirements. Add PostGIS only when a concrete code path requires `ST_` functions. |

---

## 14. Risks and Unresolved Product Decisions

### Risk 1: Audit Log Integrity (HIGH)
`audit_logs` is declared immutable in PostgreSQL (no UPDATE/DELETE triggers in Migration 010), but the in-memory `this.auditLogs` array is fully mutable and lost on restart. Until `AuditRepository` is wired, compliance audit evidence cannot be trusted to survive a deployment.

### Risk 2: Support Ticket Continuity (HIGH)
Active customer disputes in `this.supportTickets` survive only as long as the backend process stays alive. A backend restart mid-investigation would erase all unresolved tickets.

### Risk 3: School/Child Bridge Gap (HIGH — NEW)
Migration 015 created `saved_schools` and `saved_children` in PostgreSQL, but the API endpoints (`/api/schools`, `/api/children`) still read/write `this.savedSchools` and `this.savedChildren`. A parent's saved school and child profiles are currently **not stored in PostgreSQL** despite the schema existing. This is the most actionable next bridge.

### Risk 4: Dead Seed Data (LOW)
`database.js` lines 1193–1212 (`this.savedChildren` seed) contains `schoolAddress`, `schoolLat`, `schoolLng` — fields that were explicitly rejected during Migration 015 normalization. These fields do not exist in the `saved_children` table. In production mode this is harmless (seed not loaded), but creates developer confusion and should be cleaned up.

### Unresolved Product Decision: Offline-First Flutter
The Flutter mobile apps currently treat school and child data as purely API-fetched (network-dependent). If a parent needs to view their saved schools/children while offline, a local Flutter cache (e.g., `hive` or `sqflite`) would be required. **This is a product decision, not a database schema decision.** No migration required.

---

## 15. Recommended Next Step

The next action after this audit is NOT a new migration.

The next action is a **Phase 5 Application Bridge** — specifically the **School/Child Repository Bridge**, since:

1. Migration 015 was just committed and is live.
2. The `saved_schools` and `saved_children` tables exist with full RLS and correct constraints.
3. The backend endpoints `/api/schools` and `/api/children` are already defined in `server.js`.
4. The Flutter `SchoolChildRepository` already exists in `mobile/lib/`.
5. The only missing piece is a `SchoolChildRepository.js` on the backend that reads/writes to PostgreSQL.

This bridge requires **no new migration** — only a new repository file and wiring changes in `server.js`.

---

## Final Decision

> **MIGRATION 016 CANDIDATE IDENTIFIED**

However, the candidate is **NOT ready for implementation now**. The identified candidate is:

**`016_postgis_spatial_dispatch.sql`** — PostGIS spatial extension for sub-second driver proximity matching.

**Status**: Category C — Future Feature. Not currently required by any active code path, test, or business requirement.

**Condition for promotion to Category D**: Fleet operations exceed 10,000 concurrent active drivers AND JavaScript Haversine matching creates observable latency or incorrect matchmaking results in production.

**Immediate next recommended action**: No Migration 016. Proceed with Phase 5 — Application Bridge for School/Child Domain and high-priority Category B domains (Support, Audit, Promotions, Geofences).
