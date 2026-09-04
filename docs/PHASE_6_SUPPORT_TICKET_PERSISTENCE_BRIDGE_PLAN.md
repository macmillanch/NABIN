# NABIN — PHASE 6: CUSTOMER SUPPORT & DISPUTE PERSISTENCE BRIDGE PLAN (REVISED)

**Date:** 2026-09-04  
**Author:** Antigravity Autonomous Pair Programmer  
**Baseline Commit:** `c59640f0bb12dbec367cf37d4109db318896b3d2`  
**Migration Baseline:** Migrations 001–015 (authoritative, verified)  
**Status:** PLAN REVISION COMPLETE — Awaiting Explicit Approval. No application code, migrations, or database modified.  
**Target Table:** `public.support_tickets` (Created in Migration 003, enhanced in Migration 008)  

---

## 1. VERIFIED EXISTING BEHAVIOR & CODEBASE AUDIT

### 1.1 Financial Ledger & Wallet RPC Infrastructure
- **`adjust_wallet_atomic` RPC (Migration `007_wallets_domain.sql`):**
  - Declared signature:
    ```sql
    adjust_wallet_atomic(
        p_owner_id UUID,
        p_owner_type VARCHAR,        -- 'CUSTOMER', 'DRIVER', 'MERCHANT'
        p_amount NUMERIC,            -- Positive for credit, negative for debit
        p_category VARCHAR,          -- e.g. 'WALLET_TOPUP', 'DISPUTE_REFUND'
        p_description TEXT,
        p_reference_id VARCHAR,
        p_debit_account VARCHAR,
        p_credit_account VARCHAR,
        p_idempotency_key VARCHAR DEFAULT NULL
    ) RETURNS JSON
    ```
  - **Engine-Level Idempotency:** If `p_idempotency_key` is non-null, the function queries `SELECT id FROM journal_transactions WHERE idempotency_key = p_idempotency_key`. If a record is found, it returns `{"success": true, "status": "IDEMPOTENT_SKIPPED", "balance": v_new_balance}` immediately without executing duplicate balance additions or writing duplicate journal lines.
  - **Overdraft Guard:** Ensures wallet deductions cannot drop balances below zero unless explicitly credited.
  - **Double-Entry Journal:** Automatically records balanced `DEBIT` and `CREDIT` entries in `public.journal_lines` and `public.journal_transactions`.
  - **Pre-Seeded Accounts (`002_finance_ledger_schema.sql`):** `DISPUTE_REFUND_EXPENSE` (Expense / Normal Debit) and `CUSTOMER_WALLET_LIABILITY` (Liability / Normal Credit) already exist in `ledger_accounts`.
  - **`LedgerRepository.js` Integration:** Lines 82 & 130 confirm that `idempotencyKey` is supported and passed as `p_idempotency_key: idempotencyKey ? String(idempotencyKey) : null`.
  - **Uniqueness in Financial Domain:** In `journal_transactions`, `reference_id VARCHAR(100)` is **NOT** unique; however, `idempotency_key VARCHAR(100) UNIQUE` is strictly enforced by a database unique constraint. Therefore, idempotency must be anchored on `p_idempotency_key = 'dispute_refund_' + ticket.id`.

### 1.2 Administrative RBAC Infrastructure
- **`authenticateAdmin` Middleware (`backend/src/server.js:332–362`):** Extracts Bearer token, validates against `activeAdminSessions` or `db.getSessionByToken(token)`, and attaches the authenticated administrator record to `req.admin`.
- **`req.admin` Structure:** `{ id, username, name, role, email, phone, department, permissions, status }`.
- **`admin_accounts` Schema (`001_central_schema.sql:172–188`):** Defines `id`, `username`, `name`, `email`, `role`, `department`, `password_hash`, `password_salt`, `is_active`.
  - Valid roles: `CHECK (role IN ('SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT'))`.
  - Note: `permissions` is **not** a database column on `admin_accounts`.
- **Permission Model in Application Code (`database.js:1923–1947`, `3644–3670`, `server.js:635–644`):**
  - Granular permissions are dynamically mapped in code from `defaultPermissionsMap[adm.role]`.
  - Existing permission assignments:
    - `support.view`: Held by `SUPER_ADMIN`, `OPERATIONS`, `SUPPORT_AGENT`.
    - `support.respond`: Held by `SUPER_ADMIN`, `OPERATIONS`, `SUPPORT_AGENT`.
    - `support.resolve`: Held by `SUPER_ADMIN`, `SUPPORT_AGENT`.
  - Middleware `requirePermission(perm)` checks `req.admin.role === 'SUPER_ADMIN' || req.admin.permissions.includes(perm)`.
- **Existing Admin Support Routes (`server.js:843–860`):**
  - Line 843: `app.get('/api/admin/support', authenticateAdmin, requirePermission('support.view'))`
  - Line 854: `app.post('/api/admin/support/:id/assign', authenticateAdmin, requirePermission('support.respond'))`
  - Line 860: `app.post('/api/admin/support/:id/resolve', authenticateAdmin, requirePermission('support.resolve'))`
- **Finding:** All required administrative permissions (`support.view`, `support.respond`, `support.resolve`) **ALREADY EXIST** and are actively enforced in `server.js`. No new permissions or schema migrations are required.

### 1.3 Audit Log Scope & Schema
- **`public.audit_logs` Schema (`010_admin_audit_domain.sql:7–31`):**
  - Columns: `id UUID PK`, `admin_id VARCHAR(50) NOT NULL`, `admin_name VARCHAR(100) NOT NULL`, `role VARCHAR(40) NOT NULL`, `action VARCHAR(80) NOT NULL`, `module VARCHAR(50) NOT NULL`, `target_entity_type VARCHAR(50) NOT NULL`, `target_entity_id VARCHAR(100) NOT NULL`, `previous_state TEXT`, `new_state TEXT`, `reason TEXT`, `ip_address VARCHAR(50)`, `details TEXT`, `metadata JSONB`, `created_at TIMESTAMPTZ`.
  - Crucial constraint: `admin_id`, `admin_name`, and `role` are **`NOT NULL`**.
- **Customer Tickets vs Admin Actions:**
  - Ticket creation by a customer/driver is an end-user activity, NOT an administrative audit event. Attempting to insert a customer ticket into `public.audit_logs` violates the non-null `admin_id` / `admin_name` / `role` constraints.
  - Ticket creation is already durably persisted in `public.support_tickets` (`id`, `user_id`, `user_type`, `created_at`, `status = 'OPEN'`).
  - Only privileged administrator actions (`TICKET_ASSIGNED`, `TICKET_RESOLVED`) represent compliance audit events and should write to `public.audit_logs`.
- **Durable Logging Without Scope Creep:**
  - In `SupportTicketRepository` (for `assignTicket` and `resolveTicket`), when `isLivePostgres` is active, a single insert into `supabaseAdmin.from('audit_logs').insert([...])` records the durable audit record.
  - In-memory `db.createAuditLog(...)` is simultaneously maintained for legacy test compatibility.
  - No new audit repository or migration is needed; this avoids prematurely triggering a full Audit Bridge.

### 1.4 PostgreSQL Table Schema (`public.support_tickets`)
- Tables and columns verified against `003_extended_schema.sql` and `008_support_domain.sql`:
  - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
  - `ticket_number VARCHAR(50) UNIQUE NOT NULL`
  - `user_type VARCHAR(30) NOT NULL` (Polymorphic: `'CUSTOMER'`, `'DRIVER'`, `'MERCHANT'`)
  - `user_id UUID NOT NULL` (Logical FK to `users(id)`, `drivers(id)`, or `merchants(id)`. **No direct FK constraint** to `users(id)` exists, allowing polymorphic association)
  - `job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL`
  - `category VARCHAR(50) DEFAULT 'GENERAL'`
  - `priority VARCHAR(20) DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'))`
  - `status VARCHAR(30) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'))`
  - `subject VARCHAR(200) NOT NULL` (Maps API `title`)
  - `description TEXT NOT NULL`
  - `assigned_admin_id UUID REFERENCES admin_accounts(id)`
  - `messages JSONB DEFAULT '[]'::jsonb`
  - `resolution_notes TEXT`
  - `resolved_at TIMESTAMPTZ`
  - `created_at TIMESTAMPTZ DEFAULT NOW()`
  - `updated_at TIMESTAMPTZ DEFAULT NOW()`
- **Preservation of Fields without Dedicated Columns:**
  - `evidenceUrls`: Preserved inside `messages[0].attachments` (array of URLs).
  - `driverId`, `driverName`, `merchantId`, `userName`: Preserved inside `messages[0].metadata` JSONB.
  - `mapRowToTicket(row)` extracts these fields back onto the ticket DTO, ensuring 100% field retention and zero API contract breakage.

### 1.5 Driver Sanctions & Operational State
- **`DriverRepository.update(driverId, updateData)` (`backend/src/repositories/DriverRepository.js:180–228`):**
  - Persists `operational_status`, `is_online`, `last_heartbeat` to PostgreSQL `drivers` table.
  - Sets runtime driver object state: `driver.operationalStatus = 'SUSPENDED'`, `driver.isOnline = false`, `driver.status = 'offline'`.

---

## 2. PROPOSED IMPLEMENTATION

### 2.1 Repository Architecture (`backend/src/repositories/SupportTicketRepository.js`)
The repository will follow the exact patterns established by `UserRepository.js` and `SchoolChildRepository.js`:
- Inject `db` instance in constructor.
- Read `isLivePostgres` and `supabaseAdmin` from `../supabase`.
- Methods:
  1. `resolveUserUuid(userId, userType = 'CUSTOMER')`: Resolves legacy IDs (e.g. `'usr_1'`, `'DRV-101'`) to PostgreSQL UUIDs via `userRepo` or `driverRepo`.
  2. `resolveJobUuid(jobId)`: Validates and resolves job UUIDs via `jobRepo.findByIdAsync(jobId)`.
  3. `mapRowToTicket(row)`: Losslessly reconstitutes PostgreSQL row to client camelCase format, restoring `title`, `evidenceUrls`, `driverId`, `driverName`, `merchantId`, `refundAmount`, and `resolutionType`.
  4. `createTicket(caller, payload)`: Generates collision-resistant ticket number, binds authenticated caller identity, stores attachments and metadata, and inserts into `public.support_tickets`.
  5. `getTicketsByUser(caller)`: Queries tickets belonging exclusively to `user_id = callerUuid AND user_type = caller.role`.
  6. `getTicketById(ticketIdOrNumber, caller = null)`: Fetches ticket by UUID or `ticket_number`. If `caller` is non-admin, enforces tenant isolation.
  7. `getTicketsAdmin(filters)`: Admin queue listing with filtering by `status`, `category`, `priority`, and text search.
  8. `addMessage(ticketIdOrNumber, messageData, caller)`: Enforces server-side attribution, appends sanitized message to `messages` JSONB array, and transitions `OPEN` tickets to `IN_PROGRESS` if replied by admin.
  9. `assignTicket(ticketIdOrNumber, adminId, adminName)`: Updates `assigned_admin_id`, writes admin audit log.
  10. `resolveTicket(ticketIdOrNumber, resolutionData, adminId, adminName)`: Executes deterministic resolution state machine with financial idempotency and optional driver sanctions.

### 2.2 Endpoint Authorization & Middleware Updates (`backend/src/server.js`)
1. **`POST /api/support/ticket`:**
   - Enforce customer/driver authentication: Caller must present valid session Bearer token.
   - Ignore any client-supplied `userId`, `userRole`, or `userName` in `req.body`. Extract strictly from `req.session` / `req.user` / `req.driver`.
   - Validate `jobId`: If supplied, verify the job exists and caller participated as customer or driver.
2. **`GET /api/support/user/:userId`:**
   - Authenticate caller. If caller is not an admin and `:userId` does not match `req.user.id`, return HTTP `403 Forbidden`.
3. **`POST /api/support/ticket/:id/message`:**
   - Authenticate caller (Customer, Driver, or Admin).
   - If non-admin: Verify ownership (`user_id = callerUuid`). Return HTTP `404 Not Found` if ticket belongs to another user (prevents enumeration).
   - Enforce server-side `senderRole` and `senderName`. Ignore user-supplied values.
4. **`GET /api/admin/support`:** Retain `authenticateAdmin` + `requirePermission('support.view')`.
5. **`POST /api/admin/support/:id/assign`:** Retain `authenticateAdmin` + `requirePermission('support.respond')`.
6. **`POST /api/admin/support/:id/resolve`:** Retain `authenticateAdmin` + `requirePermission('support.resolve')`.

---

## 3. FINANCIAL CONSISTENCY & IDEMPOTENCY ANALYSIS

### 3.1 Architectural Reality: Cross-Table Atomicity
> [!IMPORTANT]
> **Explicit Architectural Statement on Atomicity:**  
> The existing backend architecture communicates with PostgreSQL via Supabase PostgREST (`@supabase/supabase-js`). PostgREST runs individual REST calls and RPCs as separate, standalone database transactions.
> 
> Because updating `public.support_tickets` and executing the `adjust_wallet_atomic` RPC are two separate network operations, **the overall ticket-resolution + wallet-refund workflow is NOT a single distributed ACID atomic transaction.**
> 
> We must **NOT** falsely claim the entire multi-step process is "atomic." Instead, financial consistency is guaranteed via **idempotent state progression and safe execution ordering**.

### 3.2 Specific Inquiry Responses

#### A. Can existing `adjust_wallet_atomic` provide sufficient idempotency using the existing referenceId?
**No.** `adjust_wallet_atomic` checks idempotency using `p_idempotency_key`, NOT `p_reference_id`. In `journal_transactions`, `reference_id` is a non-unique descriptive string, whereas `idempotency_key VARCHAR(100)` is strictly unique. To achieve idempotency, the caller must pass `idempotencyKey: 'dispute_refund_' + ticket.id`.

#### B. Is `referenceId = ticket.ticket_number` already guaranteed unique in the financial domain?
`ticket_number` is unique within `public.support_tickets`, but `journal_transactions.reference_id` does NOT enforce uniqueness at the database level. Providing `idempotencyKey: 'dispute_refund_' + ticket.id` guarantees uniqueness in the financial domain because `journal_transactions(idempotency_key)` has a PostgreSQL `UNIQUE` constraint.

#### C. Can support ticket resolution be safely ordered around the wallet operation so a retry cannot create a second refund?
**Yes.** Safe ordering requires:
1. **Pre-Check:** Ensure ticket exists and `ticket.status !== 'RESOLVED'`.
2. **Step 1 (Financial Execution):** Call `adjust_wallet_atomic` with `idempotencyKey = 'dispute_refund_' + ticket.id`.
   - If this call fails (network drop, overdraft, invalid accounts), execution halts immediately. No ticket status is modified. Return HTTP 500/503.
   - If this call succeeds (or was previously posted and returns `IDEMPOTENT_SKIPPED`), proceed to Step 2.
3. **Step 2 (Ticket State Progression):** Update `support_tickets` setting `status = 'RESOLVED'`, `resolution_notes`, and `resolved_at = NOW()`.
   - If Step 2 fails (e.g. database hiccup after money moved): The ticket remains `IN_PROGRESS`.
   - On retry: Step 1 re-runs with the identical `idempotencyKey`. The PostgreSQL function detects the key in `journal_transactions` and returns `IDEMPOTENT_SKIPPED` without issuing a second refund. Step 2 then updates the ticket to `RESOLVED`.
   - Double-refunding is mechanically impossible.

#### D. Failure Mode Analysis

| Failure Scenario | Consequence | Recovery / Retry Behavior |
|:---|:---|:---|
| **Refund succeeds, but ticket update fails** | Customer wallet is credited; ticket remains `IN_PROGRESS`. | Admin retries resolve request. `adjust_wallet_atomic` encounters `p_idempotency_key`, returns `IDEMPOTENT_SKIPPED` (0 additional balance added), and Step 2 marks ticket `RESOLVED`. |
| **Ticket update succeeds, but refund fails** | Prevented by design: Refund is executed *before* ticket status update. | If refund fails, ticket is never marked `RESOLVED`. Admin can investigate and retry. |
| **Driver suspension succeeds, but ticket resolution fails** | Driver operational status set to `SUSPENDED`; ticket remains `IN_PROGRESS`. | Driver suspension is an idempotent state assignment (`operationalStatus = 'SUSPENDED'`). A retry re-applies the same state without adverse side effects. |
| **Audit log succeeds, but refund fails** | Prevented by design: Audit log is written *after* refund and ticket update succeed. | If financial operation fails, no false resolution audit record is created. |
| **Request times out after refund succeeds but before HTTP response** | Client experiences timeout/network error; database has processed refund. | Client/Admin retries resolve request. Idempotency key skips refund, updates ticket if needed, and returns clean HTTP 200 with current balance. |

### 3.3 Resolution State Machine & Order of Operations
The resolution state machine follows this exact sequence:

```text
[Ticket Status: OPEN or IN_PROGRESS]
       │
       ▼
1. Validate admin permission ('support.resolve')
       │
       ▼
2. Check ticket.status != 'RESOLVED' (if already RESOLVED -> Reject HTTP 400)
       │
       ▼
3. Execute Wallet Refund via adjust_wallet_atomic (if refundAmount > 0)
   - Category: 'DISPUTE_REFUND'
   - Debit: 'DISPUTE_REFUND_EXPENSE'
   - Credit: 'CUSTOMER_WALLET_LIABILITY'
   - Idempotency Key: 'dispute_refund_' + ticket.id
   - IF FAILS -> Return HTTP 500/503 (Ticket remains open/in-progress; no changes)
       │
       ▼
4. Apply Driver Sanctions (if SAFETY_INCIDENT & driverId present)
   - Call driverRepo.update(driverUuid, { operationalStatus: 'SUSPENDED', isOnline: false })
       │
       ▼
5. Persist Ticket Update in PostgreSQL (public.support_tickets)
   - status = 'RESOLVED'
   - resolution_notes = resolutionNotes
   - resolved_at = NOW()
   - updated_at = NOW()
   - assigned_admin_id = adminUuid
       │
       ▼
6. Record Privileged Audit Log (public.audit_logs + in-memory)
   - action = 'TICKET_RESOLVED'
   - target = ticket.id
   - admin = adminId / adminName
       │
       ▼
7. Broadcast WebSocket Events & Return HTTP 200
```

---

## 4. SECURITY CONTROLS & DATA VALIDATION

### 4.1 Anti-Spoofing on Message Append (`POST /api/support/ticket/:id/message`)
- **Sender Attribution Enforcement:**
  - `senderRole`, `senderName`, and `senderId` are strictly resolved server-side from session tokens.
  - Client-supplied `req.body.senderRole` and `req.body.senderName` are completely discarded.
  - A customer can **never** submit a message claiming to be an `ADMIN` or another user.
- **Message Payload Validation:**
  - `text`: Required, string, trimmed, 1–4000 characters.
  - `attachments`: Array of valid URL strings, maximum 10 items.
  - Total payload capped at 32 KB.

### 4.2 Job Ownership & Dispute Authorization
- When `jobId` is provided during ticket creation:
  - Repository looks up job via `jobRepo.findByIdAsync(jobId)`. If not found, return HTTP `400 Bad Request: Job not found`.
  - If caller is `CUSTOMER`: Job's `customer_id` must match caller's UUID.
  - If caller is `DRIVER`: Job's `driver_id` must match caller's UUID.
  - Cross-user job dispute hijacking is blocked.
  - Verified `driver_id` and `driver_name` are extracted directly from the authenticated job record, eliminating client injection.

### 4.3 Ticket Number Generation & Collision Handling
- Format: `TCK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`.
- Uniqueness is enforced by PostgreSQL constraint `support_tickets_ticket_number_key`.
- Repository wraps creation in a retry loop (up to 3 attempts). If error code `23505` (unique violation) occurs, a new ticket number is generated and retried.

### 4.4 Driver Sanction Validation
- Only accessible through `/api/admin/support/:id/resolve` (guarded by `requirePermission('support.resolve')`).
- Sanction values restricted to: `'WARNING_ISSUED'`, `'SUSPEND_48H'`, `'DEACTIVATE_PERMANENT'`.
- Driver suspension updates `operational_status = 'SUSPENDED'` and `is_online = false` authoritatively in PostgreSQL.

---

## 5. REVISED TEST PLAN

Expand test coverage in `backend/test_suite.js` under **Module 21: Customer Support & Dispute Resolution Persistence Bridge**:

### 5.1 Security Assertions (SEC-01 – SEC-08)
- **SEC-01:** Reject unauthenticated `POST /api/support/ticket` with 401.
- **SEC-02:** Reject unauthenticated `GET /api/support/user/:userId` with 401.
- **SEC-03:** Reject unauthenticated `POST /api/support/ticket/:id/message` with 401.
- **SEC-04:** Cross-tenant read: User A cannot read User B's tickets via `/api/support/user/:userId` (returns 403).
- **SEC-05:** Cross-tenant write: User A cannot append messages to User B's ticket (returns 404 to avoid ID enumeration).
- **SEC-06:** Anti-spoofing: Client-supplied `senderRole: 'ADMIN'` and `senderName` in message body are discarded; server-side identity is enforced.
- **SEC-07:** Dispute authorization: Customer cannot submit a dispute for a `jobId` belonging to another user (returns 403).
- **SEC-08:** Admin RBAC: Admin without `support.resolve` permission cannot resolve tickets or trigger refunds (returns 403).

### 5.2 Financial Integrity & Idempotency Assertions (FIN-01 – FIN-04)
- **FIN-01:** Authorized resolution with refund credits customer wallet authoritatively via `adjust_wallet_atomic`.
- **FIN-02:** Double-refund prevention: Second resolution attempt on resolved ticket is rejected with HTTP 400.
- **FIN-03:** Engine-level idempotency: Executing resolution with identical `idempotencyKey` triggers `IDEMPOTENT_SKIPPED` without duplicate wallet credits.
- **FIN-04:** Double-entry verification: Query `journal_transactions` and `journal_lines` to verify balanced entries for `'DISPUTE_REFUND'`.

### 5.3 Driver Sanctions & Operational State (SANC-01 – SANC-02)
- **SANC-01:** Resolving a `SAFETY_INCIDENT` with `SUSPEND_48H` updates driver's `operational_status = 'SUSPENDED'` and `is_online = false` in PostgreSQL.
- **SANC-02:** Customer ticket submission cannot influence driver suspension.

### 5.4 Persistence & Restart Verification (PERSIST-01 – PERSIST-02)
- **PERSIST-01:** Create ticket and append messages in PostgreSQL; query directly from database to verify persistence.
- **PERSIST-02:** Simulate backend restart; verify ticket, message thread, assignment, and resolution state are accurately restored.

### 5.5 Regression Suite
- All 111 existing test assertions across Modules 1–20 must continue passing (100%).
- `flutter analyze` must report 0 issues.

---

## 6. IMPLEMENTATION FILE SCOPE

### Files to CREATE (1):
1. [`backend/src/repositories/SupportTicketRepository.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/SupportTicketRepository.js) — PostgreSQL-authoritative repository for `public.support_tickets`.

### Files to MODIFY (3):
2. [`backend/src/server.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js) — Wire lines 820–891 to `SupportTicketRepository`, enforce authentication and anti-spoofing.
3. [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js) — Instantiate `this.supportTicketRepo = new SupportTicketRepository(this)`.
4. [`backend/test_suite.js`](file:///c:/Users/macmi/Documents/nabin/backend/test_suite.js) — Add Module 21 test assertions.

### Files That MUST NOT Change:
- Migrations 001–015 (No modifications permitted).
- Migration 016 (Must NOT be created).
- Flutter client applications (API contract is preserved).
- Remote Supabase configurations (Strictly off-limits).

---

## 7. MIGRATION REQUIREMENT DECISION

> ### **FINAL DECISION: NO MIGRATION REQUIRED**
> 
> Inspection of `supabase/migrations/003_extended_schema.sql` and `supabase/migrations/008_support_domain.sql` confirms that `public.support_tickets` already possesses all 16 required columns, check constraints, foreign keys, and indexes. Non-column attributes (`evidenceUrls`, `driverId`, `driverName`) are preserved within `messages` JSONB metadata.
> 
> **Migration 016 will NOT be created.**

---

## 8. RISKS & UNRESOLVED ITEMS

| Risk / Limitation | Impact | Mitigation Strategy |
|:---|:---:|:---|
| **Two-Phase Commit Absence** | Medium | Acknowledge that ticket update and wallet RPC are separate operations. Guarantee financial consistency via deterministic `idempotencyKey` on `adjust_wallet_atomic` and safe step ordering. |
| **Legacy User ID Resolution** | Low | Integrate `userRepo.resolveUuid` and `driverRepo.resolveUuid` to convert legacy identifiers (e.g. `'usr_1'`) into PostgreSQL UUIDs. |
| **Message Thread JSONB Race Condition** | Low | Optimistic concurrency check on `updated_at` prevents concurrent overwrites during arbitration conversations. |

---

## 9. EXPLICIT NON-GOALS

- **NO General Audit Log Persistence Bridge:** Audit logging for routine customer events is out of scope. Only privileged admin support actions write to `public.audit_logs`.
- **NO Flutter UI Modifications:** Flutter customer, driver, and merchant apps already consume these endpoints and will continue functioning unchanged.
- **NO Database Schema Changes:** No new tables, columns, indexes, or RPCs will be added to PostgreSQL.
