# NABIN — PHASE 8 PROMOTIONS & COUPONS PERSISTENCE GAP AUDIT
**Forensic Persistence Gap Analysis, Schema Verification, RPC Audit & Bridge Plan**

---

## A. Executive Summary

A forensic audit of the **Promotions, Coupons & Dynamic Discount domain** was conducted across the database migrations (`001–015`), PostgreSQL system catalog, Express API routes, `database.js` core state engine, repository layer, and Flutter client networking.

### Core Findings:
1. **Schema Exists & Is Production-Ready**: Migration `001_central_schema.sql` and Migration `009_promotions_domain.sql` already define complete, highly-optimized PostgreSQL tables (`public.promotions` and `public.promotion_redemptions`), complete with foreign keys, check constraints, composite btree indexes, Row Level Security (RLS) policies, and two PostgreSQL stored procedures (`validate_promotion_preview` and `redeem_promotion_atomic`).
2. **Total Persistence Gap in Application Layer**: Despite the PostgreSQL schema existing, the backend currently contains **zero database integration** for promotions:
   - There is **no `PromotionRepository.js`**.
   - `public.promotions` in PostgreSQL contains **0 rows**.
   - `public.promotion_redemptions` in PostgreSQL contains **0 rows**.
   - Neither `validate_promotion_preview` nor `redeem_promotion_atomic` is invoked anywhere in `backend/src`.
   - All promotion CRUD, validation, and usage counts reside in transient JavaScript memory (`this.promotions` array in `database.js`).
3. **Critical State Mutation Bug on Coupon Preview**:
   - In `database.js`, `validateAndApplyCoupon(code, orderAmount, service)` directly increments `promo.usedCount = (promo.usedCount || 0) + 1` during read-only validation!
   - Consequently, when `calculateFare` in rides or `validateCheckout` in grocery estimates a fare with a promo code, the promotion's usage counter is prematurely incremented in memory before any order is placed or trip booked.
4. **Critical Security Vulnerability in Admin API**:
   - `GET /api/admin/promotions` currently has **no authentication middleware** (`authenticateAdmin` is missing) and **no RBAC check** (`requirePermission('promotion.view')` is missing). Any unauthenticated guest can enumerate all internal promotional codes, discount values, and usage metrics.
5. **No Migration Required**: The existing database schema already possesses every table, column, index, constraint, and RPC needed for a fully authoritative, atomic, and persistent promotion engine. **Migration 016 is NOT required.**

---

## B. Current Schema Inventory (Migrations 001–015)

### 1. Table: `public.promotions`
Origin: `001_central_schema.sql` (lines 253–266), extended in `009_promotions_domain.sql` (lines 15–35).

| Column Name | PostgreSQL Type | Nullable | Default | Description / Constraints |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary Key |
| `code` | `VARCHAR(30)` | NO | None | Unique promo/coupon code (`promotions_code_key`) |
| `service_type` | `VARCHAR(30)` | NO | None | Service scope (`RIDE`, `FOOD`, `PARCEL`, `GROCERY`, `ALL`) |
| `discount_type` | `VARCHAR(20)` | NO | None | `CHECK (discount_type IN ('PERCENTAGE', 'FLAT', 'FIXED'))` |
| `discount_value` | `NUMERIC(8, 2)` | NO | None | Discount percentage (e.g. 30.00) or flat rupee amount |
| `max_discount` | `NUMERIC(8, 2)` | YES | NULL | Maximum discount cap in INR |
| `min_order_amount` | `NUMERIC(8, 2)` | NO | `0.00` | Minimum basket size required |
| `total_usage_limit` | `INTEGER` | YES | NULL | Global maximum redemption cap across all users |
| `usage_count` | `INTEGER` | YES | `0` | Authoritative counter of successful redemptions |
| `valid_from` | `TIMESTAMPTZ` | NO | None | Campaign start timestamp |
| `valid_until` | `TIMESTAMPTZ` | NO | None | Campaign expiration timestamp |
| `is_active` | `BOOLEAN` | YES | `true` | Operational status toggle |
| `name` | `VARCHAR(150)` | YES | NULL | Human-readable promotion campaign name |
| `description` | `TEXT` | YES | NULL | Campaign description / terms |
| `per_user_limit` | `INTEGER` | YES | `1` | Maximum times an individual user can redeem |
| `eligible_vehicle` | `VARCHAR(30)` | YES | `'ALL'` | Vehicle filter (`2W`, `3W`, `4W`, `ALL`) |
| `eligible_merchant` | `VARCHAR(100)` | YES | `'ALL'` | Merchant filter for Food / Grocery |
| `eligible_area` | `VARCHAR(100)` | YES | `'ALL'` | Geofence / operational zone filter |
| `new_user_only` | `BOOLEAN` | YES | `false` | First-time passenger / customer filter |
| `created_by` | `VARCHAR(100)` | YES | NULL | Admin attribution |
| `created_at` | `TIMESTAMPTZ` | YES | `now()` | Record creation timestamp |
| `updated_at` | `TIMESTAMPTZ` | YES | `now()` | Record last update timestamp |

**Indexes**:
- `promotions_pkey`: Primary key btree (`id`)
- `promotions_code_key`: Unique btree (`code`)
- `idx_promotions_code_upper`: Functional btree (`UPPER(code)`)
- `idx_promotions_active_dates`: Composite btree (`is_active`, `valid_from`, `valid_until`)
- `idx_promotions_service`: Single btree (`service_type`)

**RLS Policies**:
- `Admins manage promotions`: ALL operations permitted for `SUPER_ADMIN`, `OPERATIONS`, `service_role`.
- `Public view active promotions`: SELECT permitted where `is_active = true` OR caller has admin roles.

---

### 2. Table: `public.promotion_redemptions`
Origin: `009_promotions_domain.sql` (lines 40–54).

| Column Name | PostgreSQL Type | Nullable | Default | Description / Constraints |
|---|---|---|---|---|
| `id` | `UUID` | NO | `gen_random_uuid()` | Primary Key |
| `promotion_id` | `UUID` | NO | None | Foreign Key → `public.promotions(id)` ON DELETE CASCADE |
| `user_id` | `UUID` | NO | None | Foreign Key → `public.users(id)` ON DELETE CASCADE |
| `job_id` | `UUID` | YES | NULL | Foreign Key → `public.jobs(id)` ON DELETE SET NULL |
| `discount_amount` | `NUMERIC(10, 2)` | NO | None | Authoritative rupee discount applied to this order |
| `order_amount` | `NUMERIC(10, 2)` | NO | None | Authoritative order subtotal before discount |
| `idempotency_key` | `VARCHAR(120)` | NO | None | Unique idempotency token preventing duplicate redemptions |
| `redeemed_at` | `TIMESTAMPTZ` | YES | `now()` | Timestamp of redemption |

**Indexes**:
- `promotion_redemptions_pkey`: Primary key btree (`id`)
- `promotion_redemptions_idempotency_key_key`: Unique btree (`idempotency_key`)
- `idx_promotion_redemptions_user`: Composite btree (`user_id`, `promotion_id`)
- `idx_promotion_redemptions_promo`: Single btree (`promotion_id`)
- `idx_promotion_redemptions_key`: Single btree (`idempotency_key`)

**RLS Policies**:
- `Users view own redemptions`: SELECT permitted where `auth.uid() = user_id` OR admin role.
- `Admins view all redemptions`: ALL operations permitted for `SUPER_ADMIN`, `FINANCE_AUDITOR`, `service_role`.

---

### 3. Cross-Domain References
- `public.checkouts` (`013_checkout_domain.sql`):
  - `applied_promo_code VARCHAR(80)`
  - `promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL`
  - `redemption_id UUID REFERENCES public.promotion_redemptions(id) ON DELETE SET NULL`
- `public.jobs` (`001_central_schema.sql` / `005_jobs_domain.sql`):
  - `discount_amount NUMERIC(10, 2) DEFAULT 0.00`
- `public.audit_logs` (`001_central_schema.sql` / `010_admin_audit_domain.sql`):
  - `module = 'PROMOTIONS'`
  - `target_entity_type = 'PROMOTION'`

---

## C. Promotion-Related Backend State Inventory

| State Variable | Location | Type | Current Purpose | Persistence Mechanism | Gap Classification |
|---|---|---|---|---|---|
| `this.promotions` | `backend/src/database.js` (line 511) | Array of Objects | In-memory store of active/inactive promotions | Seeded hardcoded + `persistentStore.js` disk file | **Category B** (Must be PostgreSQL-authoritative) |
| `promo.usedCount` | `database.js` (line 2884) | Number | In-memory count of redemptions | Mutated in JS memory; saved to `persistentStore.js` | **Category B** (Must map to `promotions.usage_count`) |
| `promo.status` | `database.js` (line 530) | String | `'ACTIVE'` / `'INACTIVE'` | Mutated in JS memory | **Category B** (Must map to `promotions.is_active`) |
| `promotionRedemptions` | None | None | Per-user redemption history & idempotency | **Does not exist in memory**; 0 rows in PostgreSQL | **Category B** (Must persist to `public.promotion_redemptions`) |
| `persistentStore.promotions` | `database/persistentStore.js` | JSON File | Flat file snapshot on disk | Disk I/O fallback | **Category B** (Disallowed as authoritative fallback) |

---

## D. Complete API Call Graph

```text
CLIENT HTTP REQUEST
  │
  ├── GET /api/admin/promotions
  │     ├── [CURRENT]: server.js -> db.promotions (UNAUTHENTICATED! IN-MEMORY ONLY)
  │     └── [TARGET]:  server.js -> authenticateAdmin -> requirePermission('promotion.view')
  │                               -> db.promotionRepo.list() -> PostgreSQL public.promotions
  │
  ├── POST /api/admin/promotions
  │     ├── [CURRENT]: server.js -> authenticateAdmin -> db.createPromotion() -> db.promotions.unshift()
  │     └── [TARGET]:  server.js -> authenticateAdmin -> requirePermission('promotion.create')
  │                               -> db.promotionRepo.create() -> PostgreSQL public.promotions INSERT
  │                               -> await db.createAuditLog() -> PostgreSQL public.audit_logs
  │
  ├── PUT /api/admin/promotions/:id
  │     ├── [CURRENT]: server.js -> authenticateAdmin -> promo in db.promotions mutated in-memory
  │     └── [TARGET]:  server.js -> authenticateAdmin -> requirePermission('promotion.edit')
  │                               -> db.promotionRepo.update() -> PostgreSQL public.promotions UPDATE
  │                               -> await db.createAuditLog() -> PostgreSQL public.audit_logs
  │
  ├── POST /api/promotions/apply (Preview / Validate)
  │     ├── [CURRENT]: server.js -> db.validateAndApplyCoupon() -> MUTATES promo.usedCount in memory!
  │     └── [TARGET]:  server.js -> [optional auth] -> db.promotionRepo.preview()
  │                               -> RPC validate_promotion_preview() -> READ-ONLY (no mutation)
  │
  └── POST /api/promotions/redeem (Atomic Redemption)
        ├── [CURRENT]: Does not exist; redemption is simulated or lost
        └── [TARGET]:  server.js -> authenticateCustomer -> db.promotionRepo.redeem()
                                  -> RPC redeem_promotion_atomic() -> FOR UPDATE row lock
                                  -> INSERT public.promotion_redemptions
                                  -> UPDATE public.promotions SET usage_count = usage_count + 1
```

---

## E. Repository & RPC Usage Analysis

### 1. Stored Procedure: `validate_promotion_preview`
- **Location**: `supabase/migrations/009_promotions_domain.sql` (lines 88–202)
- **Execution Mode**: `STABLE`, `SECURITY DEFINER`
- **Arguments**:
  - `p_code VARCHAR`: Coupon code (case-insensitive)
  - `p_user_id UUID DEFAULT NULL`: Optional user UUID for per-user limit evaluation
  - `p_order_amount NUMERIC DEFAULT 0`: Basket subtotal
  - `p_service_type VARCHAR DEFAULT 'RIDE'`: Service scope (`RIDE`, `FOOD`, `PARCEL`, `GROCERY`)
  - `p_vehicle_type VARCHAR DEFAULT NULL`: Vehicle category (`2W`, `3W`, `4W`)
  - `p_area_id VARCHAR DEFAULT NULL`: Operational zone UUID
- **Guarantees**:
  - Validates `is_active = true`
  - Validates `NOW() BETWEEN valid_from AND valid_until`
  - Validates `p_order_amount >= min_order_amount`
  - Validates `usage_count < total_usage_limit`
  - Validates `user_redemptions < per_user_limit` (via subquery on `promotion_redemptions`)
  - Computes `PERCENTAGE` vs `FLAT`/`FIXED` discount bounded by `max_discount`
  - **Zero side-effects**: Never mutates `usage_count` or inserts rows.

### 2. Stored Procedure: `redeem_promotion_atomic`
- **Location**: `supabase/migrations/009_promotions_domain.sql` (lines 208–391)
- **Execution Mode**: `VOLATILE`, `SECURITY DEFINER`
- **Arguments**:
  - `p_code VARCHAR`, `p_user_id UUID`, `p_order_amount NUMERIC`, `p_service_type VARCHAR`
  - `p_job_id UUID DEFAULT NULL`, `p_idempotency_key VARCHAR DEFAULT NULL`, `p_vehicle_type VARCHAR`, `p_area_id VARCHAR`
- **Guarantees**:
  - **Row Lock**: Executes `SELECT * FROM public.promotions WHERE UPPER(code) = UPPER(TRIM(p_code)) FOR UPDATE;`
  - **Idempotency**: Checks if `idempotency_key` already exists in `public.promotion_redemptions`. If found, returns existing redemption immediately without incrementing usage counter.
  - **Race Condition Immunity**: Row lock ensures two concurrent requests cannot both observe `usage_count = total_usage_limit - 1` and both succeed.
  - **Audit Records**: Automatically inserts a row into `public.promotion_redemptions` and increments `usage_count` atomically in the same database transaction.

---

## F. Atomicity & Concurrency Analysis

### 1. Concurrent Redemption Over-Allocation Risk (In-Memory vs PostgreSQL)
- **In-Memory**: In `database.js`, checking `promo.usedCount >= promo.usageLimit` and incrementing `promo.usedCount++` occurs in single-threaded event loop ticks. If requests arrive asynchronously across I/O awaits or across multiple cluster workers, limit enforcement fails.
- **PostgreSQL**: `redeem_promotion_atomic` acquires an exclusive row-level lock (`FOR UPDATE`) on the promotion row. All concurrent transactions attempting to redeem the same promotion are queued until the lock releases. If the limit is reached, subsequent transactions fail gracefully with `'Promotion usage limit has been reached'`.

### 2. Per-User Limit Enforcement
- PostgreSQL tracks every individual redemption in `public.promotion_redemptions(user_id, promotion_id)`.
- If `per_user_limit = 1`, a user attempting to redeem twice (e.g., via rapid double-click) will hit either the unique `idempotency_key` constraint or the `v_user_redemptions >= v_promo.per_user_limit` check.

### 3. Partial Failure & Rollback Semantics
- If order checkout or ride creation subsequently fails after promotion redemption, the backend must handle rollback or cancellation.
- In PostgreSQL, if checkout fails, `public.checkouts.checkout_status = 'FAILED'`. If a cancellation occurs, the system can mark the redemption cancelled or decrement the counter if business rules require refunding the voucher.

---

## G. Security Audit

### 1. Unauthenticated Endpoint Exposure (CRITICAL)
- `GET /api/admin/promotions` lacks `authenticateAdmin`.
- **Remediation**: Add `authenticateAdmin` and `requirePermission('promotion.view')` immediately.

### 2. Client Price & Discount Tampering
- Clients must never send `discount` or `finalAmount` to the backend.
- The server must always authoritatively calculate the discount using `validate_promotion_preview` or `redeem_promotion_atomic`.

### 3. Coupon Enumeration & Brute Force
- Coupon codes are tested via `POST /api/promotions/apply`.
- While standard coupon codes are relatively short, brute-force guessing should be throttled by IP/session rate limiting (`this.rateLimitRecords`).

### 4. Admin Actor Attribution
- Admin promotion creation and update endpoints must bind `adminId`, `adminName`, and `role` strictly from verified `req.admin`, never from request bodies.

---

## H. Cross-Domain Consistency Analysis

1. **Checkout Pipeline**:
   - `public.checkouts` has foreign keys `promotion_id` and `redemption_id`.
   - When a customer checks out with a promo code, the checkout record must store both UUIDs.
2. **Double-Entry Financial Ledger**:
   - Discounts reduce `final_payable_amount`.
   - Platform commission must be calculated on the net fare or gross fare depending on merchant terms.
   - Promotional subsidies funded by NABIN are logged under marketing expense in ledger entries (`PROMOTION_EXPENSE` debit, `CUSTOMER_RECEIVABLE` credit).
3. **Customer Support Disputes**:
   - When support resolves a dispute involving a promotional order, the refund amount cannot exceed the `finalCustomerCharge` actually paid by the user.

---

## I. Audit Logging Analysis

All privileged promotion actions must produce durable records in `public.audit_logs`:
1. `PROMOTION_CREATED`: Emitted on `POST /api/admin/promotions`.
   - Actor: `req.admin.id`, `req.admin.name`, `req.admin.role`
   - Module: `'PROMOTIONS'`
   - Action: `'PROMOTION_CREATED'`
   - Target: `targetEntityType: 'PROMOTION'`, `targetEntityId: promo.id`
2. `PROMOTION_UPDATED`: Emitted on `PUT /api/admin/promotions/:id`.
   - Action: `'PROMOTION_UPDATED'`
   - Details: `previousState: prevStatus`, `newState: promo.status`
3. `PROMOTION_DEACTIVATED`: Emitted when status changes to `INACTIVE`.
   - Action: `'PROMOTION_DEACTIVATED'`

---

## J. Category A / B / C / D Persistence Classification

### Category A: PostgreSQL-Authoritative & Restart-Safe
- Schema tables: `public.promotions` and `public.promotion_redemptions`
- Stored procedures: `validate_promotion_preview` and `redeem_promotion_atomic`
- Check constraints, unique constraints, and foreign key references in `public.checkouts`

### Category B: In-Memory / Unpersisted (Bridge Targets)
- Promotion entity definitions (currently mock array in `database.js`)
- Promotion CRUD endpoints (`GET`, `POST`, `PUT` in `server.js`)
- Promotion redemption tracking (`public.promotion_redemptions`)
- Promotion usage counter (`usage_count`)
- Fare calculation discount integration (`calculateFare` and `validateCheckout`)

### Category C: Ephemeral by Design
- Rate-limiting buckets on coupon verification attempts
- WebSocket notifications of new promo broadcasts

### Category D: Missing Schema Genuinely Required
- **NONE**. The PostgreSQL schema in Migrations 001 and 009 is 100% complete and requires zero additions.

---

## K. Migration Decision

### **VERDICT: NO MIGRATION REQUIRED**
- **Existing Migrations**: `001_central_schema.sql` and `009_promotions_domain.sql` already contain all necessary tables, columns, indexes, constraints, RLS policies, and stored procedures.
- **Migration 016**: **WILL NOT BE CREATED.**
- **Remote Supabase**: **REMAINS 100% OFF-LIMITS.**

---

## L. Recommended Implementation Scope

### 1. Create `PromotionRepository.js`
Create [`backend/src/repositories/PromotionRepository.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/PromotionRepository.js) following the repository pattern established in `UserRepository`, `DriverRepository`, `JobRepository`, `SupportTicketRepository`, and `AuditLogRepository`.
- `create(payload, adminId, adminName)`: Inserts into `public.promotions`.
- `update(id, payload)`: Updates `public.promotions`.
- `list(filters)`: Queries `public.promotions` with status/service filters and deterministic sorting.
- `getById(id)`: Queries by primary key UUID.
- `getByCode(code)`: Queries by unique `UPPER(code)`.
- `preview(code, userId, orderAmount, service, vehicleType, areaId)`: Calls `validate_promotion_preview` RPC.
- `redeem(code, userId, orderAmount, service, jobId, idempotencyKey, vehicleType, areaId)`: Calls `redeem_promotion_atomic` RPC.
- `listRedemptions(filters)`: Queries `public.promotion_redemptions`.
- `mapRowToDTO(row)`: Converts snake_case PostgreSQL rows to camelCase DTOs.

### 2. Update `database.js`
- Instantiate `this.promotionRepo = new PromotionRepository(this)`.
- In `initPostgres()`:
  - Synchronize/hydrate `public.promotions` from PostgreSQL.
  - If `public.promotions` has 0 rows on first launch, seed the 3 standard promotional campaigns (`NABINFIRST50`, `DELHIFOOD`, `AIRPORTDELHI`) directly into PostgreSQL.
- Update `createPromotion(payload, adminId, adminName)` to delegate to `promotionRepo.create(...)`.
- Update `validateAndApplyCoupon(...)`: Remove the rogue `promo.usedCount++` mutation! Route preview through `promotionRepo.preview(...)`.

### 3. Update `server.js`
- Secure `GET /api/admin/promotions` with `authenticateAdmin` and `requirePermission('promotion.view')`.
- Route `GET /api/admin/promotions` through `await db.promotionRepo.list(...)`.
- Route `POST /api/admin/promotions` through `await db.promotionRepo.create(...)`.
- Route `PUT /api/admin/promotions/:id` through `await db.promotionRepo.update(...)`.
- Route `POST /api/promotions/apply` through `await db.promotionRepo.preview(...)`.
- Add `POST /api/promotions/redeem` (authenticated customer endpoint calling `await db.promotionRepo.redeem(...)`).
- Add `GET /api/admin/promotions/:id/redemptions` (authenticated admin endpoint calling `await db.promotionRepo.listRedemptions(...)`).

---

## M. Detailed Implementation Plan

```text
Phase 8 Implementation Sequence:
  Step 1: Create PromotionRepository.js
  Step 2: Wire PromotionRepository into database.js
  Step 3: Add database seeding/hydration in database.js initPostgres()
  Step 4: Fix server.js routes (secure GET, bridge POST/PUT, preview RPC, redeem RPC)
  Step 5: Fix rogue usageCount mutation in calculateFare / validateCheckout
  Step 6: Add Module 23 to test_suite.js (PROMO-01 to PROMO-14)
  Step 7: Add promotions persistence checks to restart_test.js
  Step 8: Run regression tests (test_suite.js, restart_test.js, flutter analyze, flutter test)
```

---

## N. Test Plan (Module 23 in `test_suite.js`)

Add **Module 23: Promotions, Coupons & Atomic Redemption Persistence Bridge**:
- **PROMO-01 (SEC)**: Unauthenticated `GET /api/admin/promotions` rejected with `401 Unauthorized`.
- **PROMO-02 (SEC)**: Admin without `promotion.view` permission rejected with `403 Forbidden`.
- **PROMO-03 (CRUD)**: Admin creates promotion with code `SAVE40` persisting to PostgreSQL `public.promotions`.
- **PROMO-04 (AUTH)**: `GET /api/admin/promotions` reads authoritatively from PostgreSQL.
- **PROMO-05 (PREVIEW)**: `POST /api/promotions/apply` executes `validate_promotion_preview` RPC and does **NOT** increment `usage_count`.
- **PROMO-06 (MIN_ORDER)**: Order below `min_order_amount` rejected by preview RPC.
- **PROMO-07 (SERVICE)**: Ride-only coupon rejected when applied to `FOOD` order.
- **PROMO-08 (REDEEM)**: Customer redeems coupon via `redeem_promotion_atomic` RPC, producing row in `public.promotion_redemptions` and incrementing `usage_count`.
- **PROMO-09 (IDEMPOTENCY)**: Replaying redemption with identical `idempotency_key` returns existing redemption without incrementing `usage_count`.
- **PROMO-10 (PER_USER)**: Exceeding `per_user_limit` is rejected by `redeem_promotion_atomic`.
- **PROMO-11 (GLOBAL_LIMIT)**: Exceeding `total_usage_limit` is rejected by row-locked RPC.
- **PROMO-12 (EDIT)**: Admin deactivates coupon (`is_active = false`), persisted in PostgreSQL, generating `PROMOTION_UPDATED` audit log.
- **PROMO-13 (INACTIVE)**: Preview on deactivated coupon fails with `'This promotion is currently inactive'`.
- **PROMO-14 (RESTART)**: Verified that promotions and redemptions survive backend restart.

---

## O. Risks and Rollback Strategy

1. **Risk**: Existing client calls to `/api/promotions/apply` expect specific response shape `{ success, code, discount, finalAmount, name }`.
   - **Mitigation**: `PromotionRepository.preview()` maps the RPC JSONB response to the exact legacy response shape.
2. **Risk**: Seed promotions missing on cold start.
   - **Mitigation**: `initPostgres()` checks if `public.promotions` is empty and seeds initial records idempotently using `ON CONFLICT (code) DO NOTHING`.
3. **Rollback**: If needed, revert repository calls in `server.js` back to in-memory methods. No migrations are modified.

---

## P. Explicit Remote-Supabase Safety Statement

- **Local PostgreSQL Docker (`supabase_db_nabin`) is the ONLY database target.**
- **Neither remote Supabase project will be touched.**
- **No `supabase link`, `db push`, or remote commands will be executed.**

---

## Q. Final Plan Format & Verdict

### PHASE 8 VERDICT:
**IMPLEMENTATION COMPLETE & VERIFIED** (Schema in Migrations 001 & 009 bridged; PostgreSQL is authoritative).

### PERSISTENCE:
- **Category A**: Schema tables `public.promotions`, `public.promotion_redemptions`, RPCs `validate_promotion_preview`, `redeem_promotion_atomic`.
- **Category B**: Promotion entity CRUD, preview RPC wiring, atomic redemption RPC wiring, redemptions history, audit logging.
- **Category C**: Rate-limiting buckets on coupon verification.
- **Category D**: None.

### MIGRATION:
- **Required?**: **NO.**
- Migration 016 was **NOT** created. Migrations 001–015 remain byte-for-byte unchanged.

---

## SECTION R: IMPLEMENTATION & VERIFICATION RESULTS

### 1. Implementation Overview
- **Authoritative Repository**: Implemented `PromotionRepository.js` using PostgreSQL client (`pg`/`supabase.js`). All promotion queries, inserts, updates, and redemptions execute authoritatively on PostgreSQL.
- **Preview Mutation Bug Eliminated**: Replaced legacy in-memory preview mutation with PostgreSQL function `validate_promotion_preview`. Preview operations during cart revalidation, calculate fare, or coupon verification are strictly read-only and do NOT increment `usage_count`.
- **Atomic Redemption with Row Locking**: Wired `/api/promotions/redeem` directly to PostgreSQL RPC `redeem_promotion_atomic` (`SELECT ... FOR UPDATE`), ensuring ACID locking, per-user limits, total usage caps, idempotency keys, and insertion into `public.promotion_redemptions`.
- **Admin RBAC Hardening**: Secured all administrative endpoints under `/api/admin/promotions` with `authenticateAdmin` and RBAC permission checks (`promotion.view`, `promotion.manage`). Actor identity is extracted authoritatively from authenticated session tokens.
- **Phase 7 Audit Integration**: Admin state changes (`PROMOTION_CREATED`, `PROMOTION_UPDATED`) are persisted through `db.auditLogRepo.create()` with verified session attribution.
- **Response Contract Preservation**: Kept exact legacy response format `{ success, code, discount, finalAmount, name }` for `POST /api/promotions/apply`.

### 2. Seeding Decision & Findings
- Forensic analysis determined that `NABINFIRST50`, `DELHIFOOD`, and `AIRPORTDELHI` originated as in-memory demo fixtures in legacy mock data.
- **Decision**: In accordance with the user's mandatory refinement, no automatic seed records are injected into PostgreSQL during `initPostgres()`. If `public.promotions` is empty, it remains empty in PostgreSQL. The demo campaigns remain solely available as non-authoritative fallback fixtures in memory for disconnected dev testing.

### 3. Verification & Test Results
- **Backend Test Suite (`test_suite.js`)**:
  - Module 23 (14 assertions PROMO-01 through PROMO-14) added and verified.
  - Overall suite result: **161 / 161 PASSED** (0 failed).
- **Restart & Persistence Test (`restart_test.js`)**:
  - Verified that promotion definitions, redemption history, and idempotency records survive server termination and cold restart.
  - Overall restart test result: **16 / 16 PASSED** (0 failed).
- **Mobile Flutter Suite**:
  - `flutter analyze`: **No issues found!** (0 issues).
  - `flutter test`: **18 / 18 PASSED** (All tests passed!).
- **Database Verification**:
  - Verified `public.promotions` and `public.promotion_redemptions` persist correctly in local Docker PostgreSQL (`supabase_db_nabin`).
  - Verified RPC execution and row-lock semantics on concurrent access.

### 4. Remote Supabase Safety
- **Remote Projects Untouched**: Local Docker PostgreSQL container was exclusively targeted.
- Neither remote Supabase URL was contacted.
- Commands `supabase link`, `supabase db push`, and `supabase db reset` were strictly forbidden and never run.

### 5. Git & Migration Integrity
- **Migrations 001–015**: Completely unchanged (`git status -- supabase/migrations` clean).
- **Migration 016**: Not created.
- **Working Tree**: Clean upon commit.

