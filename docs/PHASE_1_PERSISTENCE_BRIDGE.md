# NABIN — PHASE 1: SUPABASE PERSISTENCE BRIDGE ARCHITECTURE & VERIFICATION

## 1. Executive Summary & Objective

Phase 1 established local PostgreSQL (`127.0.0.1:54322`, Supabase API `127.0.0.1:54321`) as the single authoritative persistence engine for the NABIN platform. In this phase, `users`, `drivers`, `jobs`, and `wallets/ledger` were migrated from transient in-memory and local JSON stores to live PostgreSQL tables and stored procedures without breaking existing API contracts, WebSocket interfaces, or the test suite.

Remote Supabase projects (`nabin-test`: `ywhxkzmbwppkdemvzlhv` and `NABIN`: `ouxvqmhuyueklnegvmxe`) remained strictly isolated and unmodified throughout this entire operation.

---

## 2. Architecture: Before vs. After Phase 1

### Before Phase 1
```
[ Client Apps: Mobile & Admin ]
              │
              ▼
    [ Express API & WebSocket ]
              │
    ┌─────────┴─────────┐
    │  In-Memory Arrays │  <-- Authoritative State (users, drivers, jobs, ledger)
    │  (this.users,etc) │
    └─────────┬─────────┘
              │ (Unsynchronized, fire-and-forget fallback)
              ▼
   [ data/store.json & Unused Postgres ]
```
- **Vulnerability**: Server restarts wiped runtime state or reloaded stale JSON files.
- **Race Hazards**: Balance mutations and job status changes were handled via non-atomic JavaScript arithmetic/reads (`read -> check -> write`).
- **Idempotency**: Webhook and payment verification records were vulnerable to memory wipes.
- **WebSocket**: Unauthenticated connections were permitted with default fallback identities.

### After Phase 1 (Authoritative PostgreSQL Bridge)
```
[ Client Apps: Mobile & Admin ]
              │
              ▼
    [ Express API & WebSocket Handshake ]
              │ (Validates Token against Auth Engine)
              ▼
  ┌─────────────────────────────────────────────────────────────┐
  │                    NABIN BACKEND ENGINE                     │
  │                                                             │
  │  [UserRepository] [DriverRepository] [JobRepository] [Ledger]│
  └───────────────┬───────────────────────────────┬─────────────┘
                  │                               │
  (PostgreSQL Write First)               (adjust_wallet_atomic RPC)
                  │                               │
                  ▼                               ▼
  ┌─────────────────────────────────────────────────────────────┐
  │            LOCAL DOCKER POSTGRESQL (AUTHORITATIVE)          │
  │                                                             │
  │  public.users         public.drivers      public.jobs       │
  │  journal_transactions journal_lines       ledger_accounts   │
  │  admin_accounts       active_sessions     audit_logs        │
  └───────────────────────────────┬─────────────────────────────┘
                                  │
      (Success Read / Cache Invalidation / Hydration on Boot)
                                  │
                                  ▼
                    [ Bounded Runtime Cache ]
```

---

## 3. Repository Migration Details

### 3.1 UserRepository (`backend/src/repositories/UserRepository.js`)
- **Authoritative Table**: `public.users`
- **Key Operations**:
  - `findByIdAsync(id)`: Authoritative lookup supporting UUIDs and legacy aliases (`usr_1`, `usr_2`, `usr_3`).
  - `findByPhoneAsync(phone)`: Authoritative query using normalized E.164 phone format.
  - `create(userData)`: Generates valid UUID primary key, persists to `public.users` with `account_status` (`ACTIVE`) and `identity_status` (`APPROVED`/`PENDING`).
  - `update(id, updateData)`: Atomic PostgreSQL update with camelCase/snake_case mapping.
  - `updateWalletBalance(id, newBalance)`: Automatically routes through `LedgerRepository` / `adjust_wallet_atomic` RPC to ensure double-entry compliance rather than raw balance overwrites.

### 3.2 DriverRepository (`backend/src/repositories/DriverRepository.js`)
- **Authoritative Table**: `public.drivers`
- **Key Operations**:
  - `findByIdAsync(id)` / `findByPhoneAsync(phone)`: Authoritative lookup mapped to user profiles and vehicle metadata.
  - `create(driverData)`: Persists driver records with UUIDs, linking `user_id` foreign key.
  - `update(id, updateData)`: Maps operational statuses (`is_online`, `operational_status`, `vehicle_type`).
  - `updateEarnings(driverId, netAmount)`: Updates driver balance via atomic RPC.
  - `updateTelemetry(driverId, coords)`: Updates durable PostgreSQL coordinates while high-frequency live tracking utilizes in-memory telemetry buffers to prevent database lock contention.

### 3.3 JobRepository (`backend/src/repositories/JobRepository.js`)
- **Authoritative Table**: `public.jobs`
- **Key Operations**:
  - `create(jobData)`: Persists authoritative job record with `job_number`, customer/driver UUIDs, service type (`RIDE`, `FOOD`, `PARCEL`), fare estimates, and dual-OTPs (`start_otp`, `delivery_otp`).
  - `findByIdAsync(id)` / `findByJobNumber(jobNumber)`: Authoritative query returning exact lifecycle state.
  - `updateStatus(id, newStatus, driverId, validPriorStates)`: **Race-Safe Atomic Conditional Update**. Evaluates `in('status', validPriorStates)` directly in PostgreSQL query criteria (`WHERE id = :id AND status IN (...)`). Eliminates JavaScript read-then-write race conditions.

### 3.4 LedgerRepository (`backend/src/repositories/LedgerRepository.js`)
- **Authoritative Schema**: `public.ledger_accounts`, `public.journal_transactions`, `public.journal_lines`
- **Atomic Mutation RPC**: Invokes `adjust_wallet_atomic` defined in migration `007_wallets_domain.sql`.
- **Key Invariants**:
  - Zero JavaScript balance arithmetic: mutations are evaluated inside the PostgreSQL transaction.
  - Automatic double-entry journal lines: exactly one DEBIT and one CREDIT per ledger transaction.
  - Foreign key safety: account codes normalized via `normalizeAccountCode` to match seeded `ledger_accounts` (`CUSTOMER_WALLET_LIABILITY`, `DRIVER_EARNINGS_PAYABLE`, `PAYMENT_GATEWAY_ESCROW`, etc.).

---

## 4. PostgreSQL Authority & Bounded Cache Rules

1. **Write Authority**: When `SUPABASE_POSTGRES_LIVE=true`, every persistent mutation is written to PostgreSQL **first**.
2. **Cache Updating**: In-memory cache structures (`this.users`, `this.drivers`, `this.jobs`, `this.ledgerEntries`) are updated **only after** PostgreSQL confirms successful write.
3. **Cache Invalidation on Failure**: If a PostgreSQL write fails or is rejected, memory state is invalidated or rolled back; no fallback to JSON store is attempted.
4. **Bootstrapping / Cold Hydration**: On server initialization, `database.js` executes `initPostgres()`, hydrating memory cache directly from PostgreSQL tables (`users`, `drivers`, `jobs`, `journal_transactions`, `admin_accounts`, `processedWebhookIds`).
5. **No Independent JSON Mutations**: `persistentStore.js` is explicitly gated: when `SUPABASE_POSTGRES_LIVE=true`, disk JSON writes are disabled to prevent state drift.

---

## 5. Wallet RPC Integration (`adjust_wallet_atomic`)

Migration `007_wallets_domain.sql` defines the authoritative wallet mutation function:
```sql
adjust_wallet_atomic(
  p_owner_id UUID,
  p_owner_type VARCHAR,      -- 'CUSTOMER' | 'DRIVER' | 'MERCHANT'
  p_amount NUMERIC,           -- Positive for credit, negative for debit
  p_idempotency_key VARCHAR,  -- Unique key for replay prevention
  p_category VARCHAR,         -- e.g. 'RIDE_PAYMENT', 'TOPUP', 'WITHDRAWAL'
  p_description TEXT,
  p_reference_id VARCHAR
) RETURNS jsonb
```

### Verification Highlights
- **Atomic Balance Updates**: Verified that credit of ₹1,000 sets balance to ₹1,000, and debit of ₹400 sets balance to ₹600.
- **Double-Entry Integrity**: Each transaction generates a `POSTED` row in `journal_transactions` and two balanced rows in `journal_lines` (`DEBIT` and `CREDIT`).
- **Overdraft Protection**: Attempting to deduct ₹1,500 from a ₹1,000 balance is rejected with rollback, preserving the ₹1,000 balance.
- **Idempotency**: Replaying an identical transaction returns `IDEMPOTENT_SKIPPED` without duplicating credits or debits.

---

## 6. WebSocket Authentication & Role Enforcement

- **Client (`mobile/lib/core/network/nabin_ws_service.dart`)**:
  - Emits connection request with authentication credentials via session token (`token`).
  - Listens for `AUTHENTICATED` confirmation event before dispatching telemetry or ride requests.
- **Backend (`backend/src/server.js`)**:
  - Parses incoming handshake tokens from query params or connection headers without exposing secrets in logs.
  - Resolves session against `db.activeSessions` / `db.users`.
  - Enforces roles (`CUSTOMER`, `DRIVER`, `ADMIN`).
  - Unauthenticated connections or invalid tokens are rejected with `{ type: 'AUTH_ERROR', message: 'Authentication required' }` and terminated.

---

## 7. Real PostgreSQL Verification Results

Verification script: `backend/scripts/verify_postgres_persistence.js`
Runs against live local Docker Supabase (`127.0.0.1:54322`).

| Domain | Tests | Status |
|--------|-------|--------|
| **User Persistence** (UUID primary key, async read, phone lookup, update, direct DB verification) | 5/5 | **PASSED** |
| **Driver Persistence** (UUID primary key, async read, online status, telemetry update, direct DB verification) | 5/5 | **PASSED** |
| **Job Persistence** (Job number, async read, conditional transitions `REQUESTED` -> `SEARCHING` -> `ASSIGNED`, invalid transition rejection, `COMPLETED`, direct DB verification) | 7/7 | **PASSED** |
| **Wallet & Ledger** (`adjust_wallet_atomic`, balance mutation, journal transaction, journal lines, debit/credit balance, idempotency skip, negative overdraft rollback, valid debit) | 14/14 | **PASSED** |
| **Total** | **31/31** | **PASSED** |

---

## 8. Full Platform Regression Test Results

All regression suites executed and verified green:

| Suite | Scope | Result |
|-------|-------|--------|
| `backend/scripts/verify_postgres_persistence.js` | Real local PostgreSQL integration | **31/31 PASSED** |
| `backend/restart_test.js` | Cold-restart data survival, ledger persistence, webhook deduplication, production fail-closed security | **12/12 PASSED** |
| `backend/bootstrap_test.js` | Admin bootstrap security, secret timing attacks, rate limiting, single-admin lockout | **8/8 PASSED** |
| `backend/test_suite.js` | Full platform QA (19 core modules: RBAC, Audit Logs, Support, Finance, Surge, Geofencing, dual-OTP, Parcel, Food, Webhooks) | **86/86 PASSED** |
| `backend/smoke_test.js` | Live service health, operational readiness, feature flags | **5/5 PASSED** |
| `backend/payment_sandbox_test.js` | Razorpay session creation, checkout signature verification, idempotency replay, cancel/failure handling, double-entry audit | **9/9 PASSED** |
| `backend/payment_production_readiness_test.js` | Production HMAC-SHA256 signatures, concurrent webhooks, ledger reversal audit | **11/11 PASSED** |
| `backend/cloudinary_test.js` | Media optimization, avatars, vehicle gallery, responsive variants, KYC rejection boundaries | **17/17 PASSED** |
| `mobile` (`flutter analyze`) | Flutter Dart static analysis across Customer, Driver, and Merchant apps | **0 issues** |
| `mobile` (`flutter test`) | Mobile widget & flow test suites | **18/18 PASSED** |

---

## 9. Security Verification & Secret Scanning

1. **Secret Scanning**:
   - Zero hardcoded Supabase service-role keys, private keys, or passwords committed to source control.
   - Credentials resolved via local `backend/.env` (excluded by `.gitignore`).
   - WebSocket tokens and authorization headers sanitized from server log output.
2. **Whitespace & Diff Verification**:
   - `git diff --check` executed with zero trailing whitespace or formatting defects.
3. **Production Fail-Closed Enforcement**:
   - Verified that running with `NODE_ENV=production` without valid Supabase credentials immediately fails closed with fatal error rather than defaulting to in-memory mode.

---

## 10. Remaining Phase 2 Gaps

Phase 1 completes the foundational persistence bridge. The following items remain scheduled for Phase 2:
1. **Full Dispatch State Engine**: Real-time driver spatial matchmaking via PostgreSQL PostGIS / spatial queries.
2. **Merchant & Menu Domain Persistence**: Migration of `restaurants` and `grocery_stores` catalogs from in-memory stores to migrations `003_extended_schema.sql` and `013_checkout_domain.sql`.
3. **Notification Persistence**: Supabase Realtime pub/sub notifications integration for multi-device synchronization (migration `012_notifications_domain.sql`).
4. **Automated Settlement Cron**: Background batch runner for driver and merchant bank payouts.
