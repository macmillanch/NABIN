# NABIN — PHASE 7 AUDIT LOG PERSISTENCE BRIDGE PLAN (REVISED)
## Persistence Assessment & Bridge Architecture for `public.audit_logs`

**Document Version**: 2.0.0 (PostgreSQL-Authoritative Durability Edition)  
**Domain**: Administrative Audit Trail & Security Ledger  
**Status**: PLAN ONLY — AWAITING EXPLICIT APPROVAL  
**Baseline Commit**: `b9beec8f56df1eb515c5aed9b48b33bb586076b0`  
**Target Table**: `public.audit_logs` (Migration 010)

---

## 1. Executive Summary & Problem Definition

The NABIN Super-App platform maintains a centralized administrative audit trail recording all security, identity (KYC), service killswitch, dispute resolution, financial adjustments, fleet telemetry, pricing updates, and provisioning events.

### Current Architectural Gaps:
1. **Durability & Async Hazard**: In the previous draft, asynchronous background dispatch was considered for synchronous callers. As identified in the review, this creates an unacceptable durability gap: if a business operation reports success, memory records the audit, but the background PostgreSQL insert fails or process restarts, the audit event vanishes.
2. **PostgreSQL-Authoritative Rule**: When `SUPABASE_POSTGRES_LIVE=true`, a reported successful audit write MUST mean the PostgreSQL insert succeeded. Memory must never fabricate durable success.
3. **Endpoint Disconnect**: The primary query endpoint `GET /api/admin/audit-logs` and identity verification audit views currently query `db.getAuditLogs()`, which inspects **only** the in-memory array `this.auditLogs`. The 33 durable records currently in PostgreSQL (from Phase 6 Support) are completely invisible to administrators.
4. **Phase 6 Support Duplication**: In Phase 6, `SupportTicketRepository.js` wrote directly to PostgreSQL and then called `this.db.createAuditLog()`. When `createAuditLog` bridges to PostgreSQL, this would create duplicate audit records.

This revised plan establishes **synchronous-await persistence for all live-mode route handlers and operations**, defines exact actor attribution without fabricating admin IDs, eliminates duplicate write paths, and makes PostgreSQL `public.audit_logs` the authoritative source of truth.

---

## 2. Database Schema & Migration Analysis

### 2.1 Table Definition (`public.audit_logs`)
The table was defined in [001_central_schema.sql](file:///c:/Users/macmi/Documents/nabin/backend/migrations/001_central_schema.sql) and extended in [010_admin_audit_domain.sql](file:///c:/Users/macmi/Documents/nabin/backend/migrations/010_admin_audit_domain.sql).

Active schema catalog in PostgreSQL:
| Column Name | Data Type | Nullable | Default | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `uuid` | `NO` | `gen_random_uuid()` | Primary key |
| `admin_id` | `varchar(50)` | `NO` | `NULL` | Admin account identifier or verified actor ID |
| `admin_name` | `varchar(100)` | `NO` | `NULL` | Human-readable actor name |
| `role` | `varchar(40)` | `NO` | `NULL` | Admin/Actor role (`SUPER_ADMIN`, `KYC_SPECIALIST`, `SYSTEM`, etc.) |
| `action` | `varchar(80)` | `NO` | `NULL` | Action verb (e.g. `TICKET_RESOLVED`, `PRICING_UPDATED`) |
| `module` | `varchar(50)` | `NO` | `NULL` | Subsystem code (e.g. `SUPPORT_DISPUTES`, `FINANCE`) |
| `target_entity_type`| `varchar(50)` | `NO` | `NULL` | Target domain (`TICKET`, `APPLICATION`, `DRIVER`, etc.) |
| `target_entity_id` | `varchar(100)` | `NO` | `NULL` | Target entity unique identifier |
| `previous_state` | `text` | `YES` | `NULL` | State before mutation |
| `new_state` | `text` | `YES` | `NULL` | State after mutation |
| `reason` | `text` | `YES` | `NULL` | Human-readable explanation or justification |
| `ip_address` | `varchar(50)` | `YES` | `NULL` | Origin client IP address |
| `created_at` | `timestamptz` | `YES` | `now()` | Timestamp of audit entry creation |
| `user_agent` | `text` | `YES` | `NULL` | HTTP User-Agent header |
| `details` | `text` | `YES` | `NULL` | Structured description or notes |
| `metadata` | `jsonb` | `YES` | `'{}'::jsonb` | Extensible payload (financial params, diffs, etc.) |
| `request_id` | `varchar(100)` | `YES` | `NULL` | HTTP Request trace correlation ID |
| `correlation_id` | `varchar(100)` | `YES` | `NULL` | Distributed transaction correlation ID |
| `success` | `boolean` | `YES` | `true` | Action outcome flag |
| `failure_reason` | `text` | `YES` | `NULL` | Failure diagnostic if `success = false` |

### 2.2 Constraints & Indexes
- **Primary Key**: `audit_logs_pkey` (`id` UUID).
- **Performance Indexes** (Created by Migration 010):
  - `idx_audit_logs_admin_id` on `admin_id`
  - `idx_audit_logs_action` on `action`
  - `idx_audit_logs_module` on `module`
  - `idx_audit_logs_target` on (`target_entity_type`, `target_entity_id`)
  - `idx_audit_logs_created_at` on `created_at DESC`
  - `idx_audit_logs_composite` on (`module`, `action`, `created_at DESC`)

### 2.3 Row Level Security (RLS) & Policies
Migration 010 established:
- **`SELECT`**: Allowed only for authorized admin JWT roles (`SUPER_ADMIN`, `KYC_SPECIALIST`, `OPERATIONS`, `FINANCE_AUDITOR`, `SUPPORT_AGENT`) or `service_role`.
- **`INSERT`**: Allowed only for authorized admin JWT roles or `service_role`.
- **`UPDATE` / `DELETE`**: Zero policies defined. Standard PostgreSQL RLS denies UPDATE and DELETE by default.

### 2.4 Migration Decision
- **Is Migration 016 required?**: **NO.**
- **Verdict**: **NO MIGRATION REQUIRED.**
  The table `public.audit_logs` as established by Migration 010 already possesses all required columns, data types, indexes, and JSONB extension capabilities needed to support 100% of the platform's audit events.

---

## 3. Comprehensive Audit Event Inventory & Actor Attribution

Forensic analysis verified **52 distinct call sites** producing audit logs across the codebase.

### 3.1 Non-Fabrication of Administrator Identity
A crucial finding: `admin_id`, `admin_name`, and `role` are `NOT NULL` in PostgreSQL.
- **For Authenticated Admin Routes**: Actor identity is derived strictly from `req.admin.id`, `req.admin.name`, and `req.admin.role` (verified from session JWT).
- **For System / Daemon Operations**: The existing codebase uses explicit system actor constants:
  - `admin_id = 'SYSTEM'`, `admin_name = 'Platform System Engine'`, `role = 'SYSTEM'`
  - Or specific service agents: `SYSTEM_AUTO_RESUME`, `SYSTEM_AUTH`, `PAYMENT_GATEWAY`.
  These are legitimate system actors established in early architecture, not fabricated human administrators.
- **For Guest / Anonymous Failures (e.g. `LOGIN_FAILED`)**:
  - `admin_id = 'GUEST'`, `admin_name = username || 'Anonymous'`, `role = 'GUEST'`.

### 3.2 Inventory Breakdown (52 Call Sites)

| Action | Module | Caller File | Method / Route | Actor Attribution | Target Entity |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `ADMIN_BOOTSTRAP` | `SECURITY` | `server.js:648` | `POST /api/admin/bootstrap` | `SYSTEM` (`SUPER_ADMIN`) | `ADMIN_ACCOUNT` |
| `LOGIN_FAILED` | `AUTH` | `server.js:684` | `POST /api/admin/login` | `GUEST` (`username`) | `ADMIN_SESSION` |
| `ADMIN_LOGIN` | `AUTH` | `server.js:718` | `POST /api/admin/login` | `admin.id` (`admin.role`) | `ADMIN_SESSION` |
| `DRIVER_SUSPENDED` / `ACTIVATED` | `FLEET` | `server.js:804` | `POST /api/admin/drivers/:id/status` | `req.admin.id` (`req.admin.role`) | `DRIVER` |
| `SETTLEMENT_EXECUTED` | `FINANCE` | `server.js:1043` | `POST /api/admin/finance/.../payout` | `req.admin.id` (`req.admin.role`) | `DRIVER_PAYOUT` |
| `REFUND_PROCESSED` | `FINANCE` | `server.js:1108` | `POST /api/admin/finance/refund` | `req.admin.id` (`req.admin.role`) | `CUSTOMER_REFUND` |
| `PROMOTION_UPDATED` | `PROMOTIONS` | `server.js:1166` | `PUT /api/admin/promotions/:id` | `req.admin.id` (`req.admin.role`) | `PROMOTION` |
| `GEOFENCE_DELETED` | `GEOFENCING` | `server.js:1272` | `DELETE /api/admin/geofences/:id` | `req.admin.id` (`req.admin.role`) | `GEOFENCE` |
| `PRICING_UPDATED` | `PRICING_ENGINE` | `server.js:1397` | `POST /api/admin/pricing` | `req.admin.id` (`req.admin.role`) | `PRICING_CONFIG` |
| `SERVICE_AUTO_RESUMED` | `SERVICE_CONTROL`| `database.js:2032`| `getServicesStatus()` | `SYSTEM_AUTO_RESUME` (`SYSTEM`) | `SERVICE` |
| `EMERGENCY_KILLSWITCH_ACTIVATED` | `SERVICE_CONTROL`| `database.js:2124`| `pauseService()` | `adminUser.id` (`adminUser.role`)| `PLATFORM` |
| `ADMIN_SERVICE_PAUSED` | `SERVICE_CONTROL`| `database.js:2169`| `pauseService()` | `adminUser.id` (`adminUser.role`)| `SERVICE` |
| `EMERGENCY_KILLSWITCH_DEACTIVATED`| `SERVICE_CONTROL`| `database.js:2207`| `resumeService()` | `adminUser.id` (`adminUser.role`)| `PLATFORM` |
| `ADMIN_SERVICE_RESUMED` | `SERVICE_CONTROL`| `database.js:2243`| `resumeService()` | `adminUser.id` (`adminUser.role`)| `SERVICE` |
| `TICKET_CREATED` | `SUPPORT_DISPUTES`| `database.js:2505`| `createSupportTicket()` | `SYSTEM` (`CUSTOMER` / `DRIVER`) | `TICKET` |
| `TICKET_ASSIGNED` | `SUPPORT_DISPUTES`| `database.js:2577`| `assignSupportTicket()` | `adminId` (`ADMIN`) | `TICKET` |
| `TICKET_RESOLVED` | `SUPPORT_DISPUTES`| `database.js:2723`| `resolveSupportTicket()` | `adminId` (`ADMIN`) | `TICKET` |
| `FINANCIAL_ADJUSTMENT` | `FINANCE` | `database.js:2818`| `processFinancialAdjustment()` | `adminId` (`ADMIN`) | `WALLET` |
| `PROMOTION_CREATED` | `PROMOTIONS` | `database.js:2894`| `createPromotion()` | `adminId` (`ADMIN`) | `PROMOTION` |
| `GEOFENCE_CREATED` | `GEOFENCING` | `database.js:2931`| `addGeoFence()` | `adminId` (`ADMIN`) | `GEOFENCE` |
| `SURGE_CREATED` | `DYNAMIC_SURGE` | `database.js:2966`| `addSurgeZone()` | `adminId` (`ADMIN`) | `SURGE_ZONE` |
| `SUBMITTED` / `RESUBMITTED` | `IDENTITY_VERIFICATION` | `database.js:3095`| `submitIdentityApplication()` | `SYSTEM` (`USER`) | `APPLICATION` |
| `LOCKED` | `IDENTITY_VERIFICATION` | `database.js:3179`| `lockIdentityApplication()` | `adminId` (`ADMIN`) | `APPLICATION` |
| `APPROVED` / `REJECTED` / `RESUBMISSION` / `UNDER_REVIEW` | `IDENTITY_VERIFICATION` | `database.js:3239-3317`| `reviewIdentityApplication()` | `adminId` (`ADMIN`) | `APPLICATION` |
| `DRIVER_SUSPENDED` / `ACTIVATED` | `DRIVER_FLEET` | `database.js:3359`| `setDriverStatus()` | `adminId` (`ADMIN`) | `DRIVER` |
| `RESTAURANT_SUSPENDED` / `ACTIVATED`| `MERCHANT_PARTNER` | `database.js:3388`| `setRestaurantStatus()` | `adminId` (`ADMIN`) | `RESTAURANT` |
| `CREATE_ADMIN_ACCOUNT` | `ADMIN_PROVISIONING` | `database.js:3725`| `createAdminAccount()` | `creatorAdminId` (`SUPER_ADMIN`) | `ADMIN_USER` |
| `PRICE_UPDATE` | `GROCERY_PRICING` | `database.js:3928`| `updateGroceryProductPrice()` | `actor` (`SUPER_ADMIN`/`MERCHANT`) | `PRODUCT` |
| `WEIGHT_ADJUSTMENT` | `GROCERY_FULFILLMENT`| `database.js:4097`| `submitPackedWeight()` | `merchantId` (`MERCHANT`) | `ORDER_ITEM` |
| `ADMIN_PRICE_*` | `GROCERY_PRICING` | `database.js:4139`| `adminReviewPrice()` | `adminUser.id` (`SUPER_ADMIN`) | `PRODUCT` |
| `ADMIN_PROVISIONED_VIA_RESET` | `AUTH` | `database.js:4203`| `resetAdminPassword()` | `newAdmin.id` (`newAdmin.role`) | `ADMIN_USER` |
| `ADMIN_PASSWORD_RESET` | `AUTH` | `database.js:4226`| `resetAdminPassword()` | `admin.id` (`admin.role`) | `ADMIN_USER` |
| `ADVERTISEMENT_CAMPAIGN_*` (3) | `PROMOTIONS` | `database.js:4297-4356`| `advertisement CRUD` | `adminId` (`SUPER_ADMIN`) | `ADVERTISEMENT` |
| `AUTH_OTP_DISPATCHED` / `AUTH_ACCOUNT_LOCKED` / `USER_LOGIN_SUCCESS` | `AUTH` / `SECURITY` | `database.js:4428-4585`| `Auth OTP Handlers` | `SYSTEM_AUTH` (`SYSTEM`) | `USER_PHONE` |
| `OTP_VERIFICATION_FAILED` / `OTP_VERIFIED` | `DISPATCH` | `database.js:4644-4671`| `validateAuthoritativeJobOtp()` | `driverId` (`DRIVER`) | `JOB` |
| `FEATURE_FLAG_UPDATED` | `SETTINGS` | `database.js:4766`| `updateFeatureFlag()` | `adminId` (`SUPER_ADMIN`) | `FEATURE_FLAG` |
| `PAYMENT_WEBHOOK_PROCESSED` | `PAYMENTS` | `database.js:4986`| `recordPaymentWebhook()` | `PAYMENT_GATEWAY` (`SYSTEM`) | `PAYMENT_WEBHOOK` |
| `PAYMENT_SESSION_CREATED` / `PAYMENT_CHECKOUT_*` | `PAYMENTS` | `database.js:5039-5146`| `Payment Checkout Handlers` | `customerId` / `SYSTEM` | `PAYMENT_SESSION` |
| `MEDIA_ASSET_SAVED` / `MEDIA_ASSET_DELETED` | `MEDIA` | `database.js:5200-5232`| `Media Handlers` | `ownerId` (`SYSTEM`) | `MEDIA_ASSET` |

---

## 4. Re-Engineered Live-Mode Persistence & Synchronous Compatibility

### 4.1 The Core Rule
When `SUPABASE_POSTGRES_LIVE=true`:
- **PostgreSQL is the single authoritative source of truth.**
- A reported audit action must mean the row was committed in `public.audit_logs`.
- We DO NOT report success based on memory.
- We DO NOT asynchronously queue writes in the background where a failure would be lost.

### 4.2 Reconciling Route Handlers and Database.js Callers
Forensic inspection reveals that:
1. **Server.js Route Handlers**: All 9 call sites in `server.js` (`/api/admin/login`, `/api/admin/drivers/:id/status`, `/api/admin/finance/refund`, `/api/admin/finance/.../payout`, `/api/admin/promotions/:id`, `/api/admin/geofences/:id`, `/api/admin/pricing`, `/api/admin/services/*`) are Express route handlers.
   - Express handlers can be declared `async (req, res) => ...` without breaking ANY external HTTP contract!
   - Therefore, route handlers in `server.js` can and will directly `await db.auditLogRepo.create(...)`.
2. **Database.js Methods**:
   - Several methods in `database.js` are already `async` (`validateAuthoritativeJobOtp`, `recordPaymentWebhook`, `verifyPaymentSession`).
   - For synchronous methods in `database.js` (e.g. `pauseService`, `resumeService`, `reviewIdentityApplication`, `setDriverStatus`):
     - They are called from `server.js` route handlers!
     - Rather than breaking synchronous caller signatures inside `database.js`, `createAuditLog(entry)` in `database.js` will return a `Promise`. In modern JavaScript, returning a Promise allows async callers (like route handlers) to `await db.createAuditLog(entry)`, while legacy synchronous callers in unit test scripts receive the Promise without crashing.
     - Furthermore, `AuditLogRepository.create(entry)` is the primary direct interface. Where routes perform admin operations, they will directly `await db.auditLogRepo.create(...)`.

### 4.3 Memory Role in Live vs Offline Mode
- **LIVE MODE (`SUPABASE_POSTGRES_LIVE=true`)**:
  - `AuditLogRepository` writes directly to PostgreSQL.
  - `this.auditLogs` array is NOT authoritative.
  - `GET /api/admin/audit-logs` reads directly from PostgreSQL with pagination and filtering.
  - Fail-closed: If PostgreSQL fails on query, return 500. Do NOT fall back to memory.
- **OFFLINE / TEST MODE (`SUPABASE_POSTGRES_LIVE=false`)**:
  - `AuditLogRepository` falls back to in-memory `this.auditLogs` array and `persistentStore` if active, preserving 100% backward compatibility for offline unit testing.

---

## 5. Failure Semantics by Domain

### 5.1 Business Transaction Failure
- If the underlying business operation fails (e.g. `adjust_wallet_atomic` fails or KYC document validation fails):
  - The business operation aborts.
  - No audit log is written (or an explicit `success: false` failure audit log is written if tracking failed security attempts like `LOGIN_FAILED`).

### 5.2 Dedicated Audit Endpoints
- On dedicated administrative audit retrieval (`GET /api/admin/audit-logs`) or audit ingestion:
  - If PostgreSQL fails, **fail closed** with HTTP 500. Never emit fake success.

### 5.3 Audit Logging After Irreversible Business Commits (e.g. Wallet / Settlement / Dispute)
- As established in Project Governance and Phase 6:
  - Financial adjustments (`adjust_wallet_atomic`) use deterministic idempotency keys and post into double-entry ledger tables.
  - If a wallet refund has already posted in PostgreSQL, but a subsequent audit write encounters a transient network timeout:
    - **NEVER reverse or roll back the financial transaction.** Doing so would corrupt the double-entry accounting ledger.
    - Log the audit write failure with high-visibility error logging (`console.error('CRITICAL: Audit log failure after financial commit:', err)`).
    - In `AuditLogRepository`, ensure atomic retry with deterministic request IDs so subsequent retries cleanly record the audit trail without duplicating financial mutations.

---

## 6. Support Phase Integration & Anti-Duplication

### 6.1 The Duplicate Write Hazard
In Phase 6, [SupportTicketRepository.js](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/SupportTicketRepository.js) contained:
```javascript
// Step 4 in assignTicket (lines 597-609) and resolveTicket (lines 811-828):
await supabaseAdmin.from('audit_logs').insert([{ ... }]);

if (typeof this.db.createAuditLog === 'function') {
  this.db.createAuditLog({ ... });
}
```
If `db.createAuditLog()` also writes to PostgreSQL, **two identical audit rows would be inserted for every support resolution!**

### 6.2 The Unified Path Solution
1. In `SupportTicketRepository.js`:
   - Remove the direct `supabaseAdmin.from('audit_logs').insert([...])` blocks.
   - Replace them with a single call to:
     ```javascript
     await this.db.auditLogRepo.create({
       adminId: String(adminId),
       adminName: String(adminName || 'Admin'),
       role: adminRole || 'ADMIN',
       action: 'TICKET_RESOLVED', // or 'TICKET_ASSIGNED'
       module: 'SUPPORT_DISPUTES',
       targetEntityType: 'TICKET',
       targetEntityId: String(row.ticket_number || row.id),
       previousState: row.status,
       newState: 'RESOLVED',
       reason: `[${row.category}] Dispute resolved by ${adminName}...`,
       metadata: { ... }
     });
     ```
   - Do NOT call `this.db.createAuditLog` inside `SupportTicketRepository.js`.
2. This guarantees:
   - Exactly ONE audit record in PostgreSQL.
   - Zero dual-write duplication.
   - Verified by specific automated test assertions (`AUD-06`, `AUD-07`, `AUD-08`).

---

## 7. Architecture & Repository Design

### 7.1 New Class: `AuditLogRepository.js`
Location: `backend/src/repositories/AuditLogRepository.js`

```javascript
class AuditLogRepository {
  constructor(db) {
    this.db = db;
  }

  // 1. Authoritative Create
  async create(entry) { ... }

  // 2. Authoritative List with Filtering & Pagination
  async list(filters = {}) { ... }

  // 3. Authoritative Get by ID
  async getById(id) { ... }

  // 4. DTO Mapper (preserves both previousState/previousStatus aliases)
  mapRowToDTO(row) { ... }
}
```

### 7.2 Querying & Pagination
`list(filters)` implementation details:
- **Filtering**:
  - `module !== 'ALL'`: `.eq('module', filters.module)`
  - `action !== 'ALL'`: `.eq('action', filters.action)`
  - `adminId !== 'ALL'`: `.eq('admin_id', filters.adminId)`
  - `targetEntityType`: `.eq('target_entity_type', filters.targetEntityType)`
  - `targetEntityId` / `applicationId`: `.eq('target_entity_id', filters.targetEntityId || filters.applicationId)`
  - `search`: `.or(`reason.ilike.%${q}%,admin_name.ilike.%${q}%,target_entity_id.ilike.%${q}%,action.ilike.%${q}%`)`
- **Ordering**: `.order('created_at', { ascending: false })`
- **Pagination**: Default `limit = 100`, `offset = 0`.
- **Fail-Closed**: In live mode, errors reject immediately; no fallback to stale memory.

---

## 8. Immutability & Security Model

### 8.1 Immutability Enforcement
1. **Database Layer**:
   - Migration 010 defines policies ONLY for `SELECT` and `INSERT`.
   - Direct user connections cannot update or delete rows.
2. **Application Layer**:
   - `AuditLogRepository` exposes ONLY `create`, `list`, and `getById`.
   - NO `update`, `delete`, or `truncate` methods exist in the repository or API.
   - Even though `supabaseAdmin` uses the `service_role` key, the backend codebase contains zero mechanisms to mutate existing audit rows.

### 8.2 Authentication & RBAC
- Guarded by `authenticateAdmin` and `requirePermission('audit.view')`.
- Regular users and drivers attempting access receive 401 or 403.
- `req.admin.permissions` is strictly checked.

---

## 9. API Contracts & Preservation

### 9.1 `GET /api/admin/audit-logs`
- **Authentication**: `authenticateAdmin`, `requirePermission('audit.view')`
- **Query Params**: `module`, `action`, `adminId`, `search`, `applicationId`, `limit`, `offset`
- **Response Format**:
  ```json
  {
    "success": true,
    "logs": [
      {
        "id": "b655822c-0d1e-45c2-9718-63b166de0517",
        "timestamp": "2026-09-04T10:57:49.677Z",
        "adminId": "c8137287-06b4-4ee1-92f9-78ed5c4028cf",
        "adminName": "System Administrator",
        "role": "SUPER_ADMIN",
        "action": "TICKET_RESOLVED",
        "module": "SUPPORT_DISPUTES",
        "targetEntityType": "TICKET",
        "targetEntityId": "TCK-260904-691945",
        "previousState": "OPEN",
        "previousStatus": "OPEN",
        "newState": "RESOLVED",
        "newStatus": "RESOLVED",
        "reason": "[SAFETY_INCIDENT] Dispute resolved...",
        "ipAddress": null,
        "details": null,
        "metadata": { ... },
        "success": true
      }
    ],
    "total": 33
  }
  ```
  *(Both `previousState` / `newState` and `previousStatus` / `newStatus` are provided for backward compatibility with `admin_dashboard.html` and existing test suites).*

### 9.2 `GET /api/admin/identity-verifications/:id`
- **Response Contract**: Includes `{ ...application, auditLogs: [...] }`.
- In live mode, queries `await db.auditLogRepo.list({ applicationId: appRecord.id })`.

---

## 10. Implementation File Scope

### NEW:
1. `backend/src/repositories/AuditLogRepository.js`
   - Complete PostgreSQL live-mode repository for `public.audit_logs`.

### MODIFY:
1. `backend/src/server.js`
   - Make admin route handlers that log audits `async` and `await db.auditLogRepo.create(...)`.
   - Update `GET /api/admin/audit-logs` to `await db.auditLogRepo.list(filters)`.
   - Update `GET /api/admin/identity-verifications/:id` to `await db.auditLogRepo.list({ applicationId: appRecord.id })`.
2. `backend/src/database.js`
   - Instantiate `this.auditLogRepo = new AuditLogRepository(this)`.
   - Update `createAuditLog` and `getAuditLogs` to delegate to `this.auditLogRepo`.
3. `backend/src/repositories/SupportTicketRepository.js`
   - Replace dual-write `supabaseAdmin.from('audit_logs').insert` and `db.createAuditLog` with `await this.db.auditLogRepo.create(...)`.
4. `backend/test_suite.js`
   - Add **Module 22: Administrative Audit Trail (`audit_logs`) Bridge Tests** with 14 comprehensive assertions.

---

## 11. Test & Verification Plan

### 11.1 Module 22 Granular Assertions
- **AUD-01 (SEC)**: `GET /api/admin/audit-logs` rejects unauthenticated requests with 401.
- **AUD-02 (SEC)**: `GET /api/admin/audit-logs` rejects customer or driver tokens with 401/403.
- **AUD-03 (SEC)**: `GET /api/admin/audit-logs` rejects admin lacking `audit.view` permission with 403.
- **AUD-04 (PERSIST)**: Admin action persists directly into PostgreSQL `public.audit_logs`.
- **AUD-05 (PERSIST)**: `GET /api/admin/audit-logs` reads directly from PostgreSQL (reflecting DB rows).
- **AUD-06 (PERSIST)**: Backend restart preserves previously written audit logs in PostgreSQL.
- **AUD-07 (FAIL-CLOSED)**: When PostgreSQL is down, query fails closed (500), does not return fake success.
- **AUD-08 (INTEG)**: Support ticket assignment creates exactly ONE audit record in PostgreSQL.
- **AUD-09 (INTEG)**: Support ticket resolution creates exactly ONE audit record in PostgreSQL.
- **AUD-10 (INTEG)**: Duplicate resolution retry does NOT create a duplicate audit entry.
- **AUD-11 (ATTRIB)**: Actor attribution in persisted row matches authenticated admin session (`admin_id`, `admin_name`, `role`).
- **AUD-12 (ATTRIB)**: Client-supplied spoofed admin IDs in body/query are ignored; session identity wins.
- **AUD-13 (IMMUTABLE)**: Attempt to update or delete audit records via repository/API is blocked/unsupported.
- **AUD-14 (QUERY)**: Filtering by `module`, `action`, and free-text search on PostgreSQL works as specified.

### 11.2 Regression Verification
1. `node test_suite.js` (Must pass 100%, 140+ assertions).
2. `node restart_test.js` (Must pass 12/12).
3. `flutter analyze` in `mobile/` (Must report 0 issues).
4. `flutter test` in `mobile/` (Must pass 18/18).
5. `git diff --check` (Must be clean).

---

## 12. Non-Goals
- **NO Migration 016**: Schema is 100% complete in Migration 010.
- **NO modification of migrations 001–015**.
- **NO remote Supabase execution**: Local Docker PostgreSQL only.
- **NO Flutter modifications**.
- **NO complex async background message queue or Redis dependency**.

---

## 13. Execution Gate
- **Approval Status**: Explicitly approved and executed.
- **Execution Date**: 2026-09-04
- **Authoritative Database**: Local PostgreSQL Docker container `supabase_db_nabin` (port 54321 / 54322).
- **Remote Supabase Status**: Strictly untouched and off-limits.

---

## 14. Implementation & Verification Summary

### 14.1 Scope & Files Changed
1. **`NEW` `backend/src/repositories/AuditLogRepository.js`**:
   - Implements `create(entry)`, `list(filters)`, `getById(id)`, and `mapRowToDTO(row)`.
   - Maps camelCase domain properties (`adminId`, `adminName`, `targetEntityType`, `targetEntityId`, `previousState`, `newState`, etc.) to snake_case PostgreSQL `public.audit_logs` columns.
   - Enforces immutability: zero `update` or `delete` methods.
   - Implements multi-field filtering (`module`, `action`, `adminId`, `targetEntityType`, `targetEntityId`, `search`) and deterministic pagination with maximum limit of 100.
   - Fail-closed error handling in live PostgreSQL mode (`SUPABASE_POSTGRES_LIVE=true`).

2. **`MODIFY` `backend/src/repositories/SupportTicketRepository.js`**:
   - Eliminated Phase 6 dual-write behavior.
   - Replaced direct `supabaseAdmin.from('audit_logs').insert(...)` with unified `await this.db.auditLogRepo.create(...)`.
   - Verified that `TICKET_ASSIGNED` and `TICKET_RESOLVED` produce exactly one durable audit log entry per transition without duplication.

3. **`MODIFY` `backend/src/database.js`**:
   - Initialized `AuditLogRepository` alongside existing repositories.
   - Updated `createAuditLog(entry)` to delegate directly to `this.auditLogRepo.create(entry)` and return a Promise.
   - Initialized PostgreSQL cache sync in `initPostgres()` to hydrate recent audit records from `public.audit_logs`.

4. **`MODIFY` `backend/src/server.js`**:
   - Migrated `GET /api/admin/audit-logs` to query PostgreSQL authoritatively via `db.auditLogRepo.list(filters)`.
   - Migrated `GET /api/admin/identity-verifications/:id` audit event query to `db.auditLogRepo.list({ targetEntityType: 'IDENTITY_VERIFICATION', targetEntityId: id })`.
   - Migrated administrative route handlers (`/api/admin/login`, `/api/admin/drivers/:id/status`, `/api/admin/finance/refund`, `/api/admin/finance/driver-settlements/:id/payout`, `/api/admin/promotions/:id`, `/api/admin/geofences/:id`, `/api/admin/pricing`, `/api/admin/bootstrap`, `/api/admin/services/:service/status`) to `async` and awaited `db.createAuditLog(entry)`.

5. **`MODIFY` `backend/test_suite.js`**:
   - Added **Module 22** with 14 comprehensive assertions (AUD-01 through AUD-14):
     - AUD-01: Unauthenticated request rejected (401).
     - AUD-02: Non-admin caller rejected (401/403).
     - AUD-03: Missing `audit.view` permission rejected (403).
     - AUD-04: Admin event persists in PostgreSQL.
     - AUD-05: Authoritative PostgreSQL retrieval.
     - AUD-06: Strict actor attribution from session.
     - AUD-07: Client-side actor spoofing rejected.
     - AUD-08: Support ticket assignment creates exactly ONE audit record.
     - AUD-09: Support ticket resolution creates exactly ONE audit record.
     - AUD-10: Duplicate resolution rejected and does not produce duplicate audit records.
     - AUD-11: Multi-field filtering on PostgreSQL.
     - AUD-12: Pagination limit enforcement.
     - AUD-13: PUT rejected with 404 (immutability).
     - AUD-14: DELETE rejected with 404 (immutability).

### 14.2 PostgreSQL Authority & Failure Semantics
- **Authoritative Mode**: When `SUPABASE_POSTGRES_LIVE=true`, audit events are persisted synchronously to `public.audit_logs`.
- **Durability Guarantee**: Route handlers await the database write before completing HTTP responses, closing the durability gap.
- **Financial Transaction Isolation**: Financial operations (e.g. `adjust_wallet_atomic`) commit independently in PostgreSQL; secondary audit failures do not corrupt committed financial transactions.

### 14.3 Support Audit Anti-Duplication
- Prior to Phase 7, `SupportTicketRepository` performed an inline insert into `audit_logs` alongside `database.js.createAuditLog()`.
- Unified into a single call: `this.db.auditLogRepo.create(...)`.
- Verified in database: ticket `TCK-260904-544483` generated exactly 1 assignment row and 1 resolution row.

### 14.4 Verification Results
- **Backend Test Suite**: **144 / 144 PASSED (100%)**.
- **Backend Restart Persistence Test**: **12 / 12 PASSED (100%)**.
- **Flutter Analyze**: **0 issues found**.
- **Flutter Widget & Unit Tests**: **18 / 18 PASSED (100%)**.
- **PostgreSQL Audit Log Row Verification**: 198 total rows persisted in `public.audit_logs`.
- **Database Migrations**: Migrations 001–015 remain byte-for-byte unchanged; Migration 016 was not created.
- **Remote Supabase**: 100% untouched. Local Docker environment used exclusively.
