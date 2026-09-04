# NABIN Phase 10: Identity & KYC Persistence Gap Forensic Audit & Implementation Plan

**Author:** Master System Architect & Security Engineer Agents  
**Date:** September 2026  
**Status:** FORENSIC AUDIT & PLAN ONLY — AWAITING EXPLICIT USER APPROVAL  
**Git Baseline:** `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9` (`HEAD == origin/main`, Clean Working Tree)  
**Database Authority:** Local Docker PostgreSQL (`supabase_db_nabin` on port 54322 / 54321)  
**Remote Supabase Status:** STRICTLY UNTOUCHED & OFF-LIMITS  

---

## A. Executive Summary

This forensic audit evaluates the persistence, security, correctness, and architectural durability of Identity and KYC (Know Your Customer) workflows across the NABIN ecosystem.

### Current Baseline & Test Metrics
- **Git HEAD:** `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9` (origin/main, clean tree)
- **Backend Test Suite:** 180 / 180 passing
- **Restart Persistence Suite:** 23 / 23 passing
- **Flutter Analysis:** 0 issues found across all packages
- **Flutter Test Suite:** 18 / 18 passing
- **Migrations:** 001–015 immutable and byte-identical to baseline

### Key Forensic Findings
1. **Schema Exists in PostgreSQL:** Migration `001_central_schema.sql` already defined table `public.identity_documents` with columns for raw & masked Aadhaar/Voter ID numbers, document URLs, review status, reviewer ID, rejection/resubmission reasons, and timestamps. Furthermore, `public.users` contains `identity_status` and `account_status` columns. **Existing schema is 100% sufficient; NO Migration 016 is required.**
2. **Current Backend Persistence Gap:**
   - In `backend/src/database.js`, identity applications are stored purely in an in-memory array (`this.identityApplications = [ APP-9021, APP-9019, APP-9018 ]`).
   - The method `submitIdentityApplication(...)` mutates this in-memory array and never touches PostgreSQL `identity_documents`.
   - The method `reviewIdentityApplication(...)` updates in-memory application status and mutates `user.identityStatus` in memory, but **never persists the change to `public.identity_documents` or `public.users`**.
   - `initPostgres()` currently hydrates users, drivers, jobs, ledger entries, admin accounts, support tickets, audit logs, promotions, pricing configurations, geofences, and surge zones—**but completely omits `identity_documents`**.
   - Upon server restart, all submitted identity documents and review decisions (approvals, rejections, resubmission notes) are completely lost from memory.
3. **Critical Security / IDOR Vulnerabilities Identified:**
   - `POST /api/identity/submit` lacks caller authentication middleware. It accepts `userId` from `req.body`, allowing any unauthenticated or malicious caller to submit or overwrite identity documentation for any arbitrary user.
   - `GET /api/identity/status/:userId` lacks caller authentication or ownership verification. Anyone can view any user's identity verification status, masked Aadhaar, masked Voter ID, and internal review notes.
4. **Zero Test Coverage:** Neither `/api/identity/*` nor `/api/admin/identity-verifications/*` is tested in `test_suite.js` or `restart_test.js`.

---

## B. Schema Inventory

Forensic inspection of migrations 001–015 and the live PostgreSQL catalog (`supabase_db_nabin`) confirms:

### 1. `public.identity_documents`
Created in `001_central_schema.sql` (lines 30–45):

```sql
CREATE TABLE IF NOT EXISTS identity_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    aadhaar_number_raw VARCHAR(20),
    aadhaar_number_masked VARCHAR(20),
    aadhaar_doc_url TEXT,
    voter_id_number_raw VARCHAR(30),
    voter_id_number_masked VARCHAR(30),
    voter_id_doc_url TEXT,
    review_status VARCHAR(40) DEFAULT 'SUBMITTED',
    reviewed_by_admin_id VARCHAR(50),
    rejection_reason TEXT,
    resubmission_reason TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);
```

#### Detailed Column & Constraint Matrix
| Column | Data Type | Nullable | Default | Constraints / Notes |
|---|---|---|---|---|
| `id` | `UUID` | `NO` | `gen_random_uuid()` | Primary Key (`identity_documents_pkey`) |
| `user_id` | `UUID` | `YES` | `NULL` | Foreign Key (`identity_documents_user_id_fkey`) -> `users(id)` ON DELETE CASCADE |
| `aadhaar_number_raw` | `VARCHAR(20)` | `YES` | `NULL` | Raw 12-digit Aadhaar number |
| `aadhaar_number_masked` | `VARCHAR(20)` | `YES` | `NULL` | Masked Aadhaar format (`XXXX-XXXX-1234`) |
| `aadhaar_doc_url` | `TEXT` | `YES` | `NULL` | Document URI / path reference |
| `voter_id_number_raw` | `VARCHAR(30)` | `YES` | `NULL` | Raw Voter ID / EPIC number |
| `voter_id_number_masked` | `VARCHAR(30)` | `YES` | `NULL` | Masked Voter ID (`DLH***201`) |
| `voter_id_doc_url` | `TEXT` | `YES` | `NULL` | Document URI / path reference |
| `review_status` | `VARCHAR(40)` | `YES` | `'SUBMITTED'` | Application lifecycle status |
| `reviewed_by_admin_id` | `VARCHAR(50)` | `YES` | `NULL` | ID of reviewing administrator |
| `rejection_reason` | `TEXT` | `YES` | `NULL` | Formal compliance rejection reason |
| `resubmission_reason` | `TEXT` | `YES` | `NULL` | Corrective instructions for user |
| `submitted_at` | `TIMESTAMPTZ`| `YES` | `NOW()` | Timestamp of document submission |
| `verified_at` | `TIMESTAMPTZ`| `YES` | `NULL` | Timestamp of admin verification approval |

#### Indexes
- `identity_documents_pkey` (btree on `id`)

#### Row Level Security (RLS)
- `ALTER TABLE identity_documents ENABLE ROW LEVEL SECURITY;`
- `POLICY "Users can view own identity documents"`: `ON identity_documents FOR SELECT USING (auth.uid() = user_id)`
- `POLICY "Users can submit own identity documents"`: `ON identity_documents FOR INSERT WITH CHECK (auth.uid() = user_id)`
- In Node.js backend environment (`isLivePostgres = true`), queries execute via `supabaseAdmin` (service role) which safely acts across all rows with explicit server-side RBAC.

### 2. `public.users`
Created in `001_central_schema.sql` (lines 15–28):

```sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150),
    dob DATE,
    address TEXT,
    rating NUMERIC(3, 2) DEFAULT 5.00,
    wallet_balance NUMERIC(10, 2) DEFAULT 0.00,
    identity_status VARCHAR(40) DEFAULT 'PENDING' CHECK (identity_status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'RESUBMISSION_REQUIRED', 'REJECTED')),
    account_status VARCHAR(30) DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Check Constraints on `users`
- `users_identity_status_check`: `CHECK (identity_status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'RESUBMISSION_REQUIRED', 'REJECTED'))`
- `users_account_status_check`: `CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED'))`

### 3. `public.drivers`
- Contains `license_number VARCHAR(50)`, `operational_status`, `is_online`.
- Drivers in the existing platform are assumed pre-verified upon registration. `DriverRepository` DTO sets `kycStatus: 'VERIFIED'`.

---

## C. Backend State Inventory

| State Holder | Location | Current Type | Classification | Required Treatment |
|---|---|---|---|---|
| `db.identityApplications` | `backend/src/database.js:121` | In-Memory Array of mock objects | **CATEGORY B** | Must be bridged to `public.identity_documents` via `IdentityRepository` |
| `user.identityStatus` | `backend/src/database.js:23-65` & `users` in memory | In-Memory String on User object | **CATEGORY B** | Mutations during review must call `userRepo.updateIdentityStatus` to update `public.users.identity_status` in PostgreSQL |
| `user.currentApplicationId` | `backend/src/database.js:35` | In-Memory String (`APP-9021`) | **CATEGORY B** | Must resolve deterministically from most recent `identity_documents` record for user |
| Review Locks (`lockedByAdminId`, `lockedAt`) | `db.identityApplications[i]` | In-Memory fields | **CATEGORY C** | Ephemeral 15-minute operational lock to prevent concurrent admin collision; safe in memory |
| `db.activeSessions` | `backend/src/database.js:70` | In-Memory Map | **CATEGORY C** | Ephemeral authentication tokens |
| `db.otpStore` | `backend/src/database.js:69` | In-Memory Map | **CATEGORY C** | Ephemeral 5-minute SMS OTPs |
| `db.failedLoginAttempts` | `backend/src/database.js:18` | In-Memory Map | **CATEGORY C** | Ephemeral brute-force rate limiter |
| Missing Schema | N/A | None | **CATEGORY D** | **NONE.** All required tables exist |

---

## D. Complete API Call Graph

### 1. Customer Document Submission Path
```text
HTTP POST /api/identity/submit
  │
  ├── [GAP FOUND: Missing Authentication]
  │   └── Caller must be authenticated via Bearer token (Customer session)
  │
  ├── Payload Validation
  │   ├── Aadhaar: Must be 12 numeric digits
  │   └── Voter ID: Must be valid alphanumeric EPIC (>= 5 chars)
  │
  ├── Authorization / IDOR Protection
  │   └── Bind userId strictly to authenticated session `req.user.id`
  │       (Client-supplied userId CANNOT impersonate another user)
  │
  ├── Database Execution: `db.identityRepo.submitApplication(...)`
  │   ├── Upsert / Insert row into `public.identity_documents`:
  │   │   ├── user_id = userUuid
  │   │   ├── aadhaar_number_raw, aadhaar_number_masked, aadhaar_doc_url
  │   │   ├── voter_id_number_raw, voter_id_number_masked, voter_id_doc_url
  │   │   ├── review_status = 'SUBMITTED'
  │   │   └── submitted_at = NOW()
  │   │
  │   ├── Update User State: `db.userRepo.updateIdentityStatus(userUuid, 'SUBMITTED')`
  │   │   └── UPDATE public.users SET identity_status = 'SUBMITTED', updated_at = NOW()
  │   │
  │   └── Immutable Audit Logging:
  │       └── `await db.auditLogRepo.create({
  │             module: 'IDENTITY_VERIFICATION',
  │             action: isResubmission ? 'RESUBMITTED' : 'SUBMITTED',
  │             adminId: user.id,
  │             adminName: user.name,
  │             role: 'CUSTOMER',
  │             targetEntityType: 'APPLICATION',
  │             targetEntityId: appId
  │           })`
  │
  ├── Real-time Notification:
  │   └── `broadcastToAdmins({ type: 'NEW_IDENTITY_APPLICATION', applicationId, userName })`
  │
  └── Response: HTTP 200 { success: true, application, user }
```

### 2. Customer Status Retrieval Path
```text
HTTP GET /api/identity/status/:userId
  │
  ├── [GAP FOUND: Missing Authentication]
  │   └── Require authenticated session
  │
  ├── Authorization Check:
  │   └── req.user.id === req.params.userId OR req.admin.permissions.includes('identity_verification.view')
  │       (Else return HTTP 403 Forbidden - Prevents BOLA/IDOR)
  │
  ├── Query: `db.identityRepo.getLatestByUserId(userId)`
  │   └── SELECT * FROM identity_documents WHERE user_id = :userId ORDER BY submitted_at DESC LIMIT 1
  │
  └── Response: HTTP 200 { success: true, user: { identityStatus }, application: { maskedData, status, reasons } }
      (RAW UNMASKED NUMBERS ARE NEVER EXPOSED TO CUSTOMER ENDPOINTS)
```

### 3. Administrator Queue & Application Inspection Path
```text
HTTP GET /api/admin/identity-verifications
  │
  ├── Middleware: `authenticateAdmin` (Verifies Admin Bearer token)
  ├── RBAC: `requirePermission('identity_verification.view')`
  ├── Query: `db.identityRepo.listApplications(filters)`
  │   └── SELECT * FROM identity_documents [WHERE review_status = :status] ORDER BY submitted_at DESC
  └── Response: HTTP 200 { success: true, applications, metrics: { total, pending, underReview, ... } }

HTTP GET /api/admin/identity-verifications/:id
  │
  ├── Middleware: `authenticateAdmin` + `requirePermission('identity_verification.view')`
  ├── Query: `db.identityRepo.findById(id)`
  ├── Privacy / Masking Check:
  │   └── Can view unmasked ONLY IF `req.admin.role === 'SUPER_ADMIN'` OR `permissions.includes('identity_documents.view')`
  │       (Otherwise raw Aadhaar & raw Voter ID are stripped/undefined)
  ├── Audit Trail Retrieval:
  │   └── `await db.auditLogRepo.list({ applicationId: id })`
  └── Response: HTTP 200 { success: true, application, auditLogs }
```

### 4. Administrator Application Lock / Unlock Path
```text
HTTP POST /api/admin/identity-verifications/:id/lock
  │
  ├── Middleware: `authenticateAdmin` + `requirePermission('identity_verification.review')`
  ├── Concurrency Check: If application already locked by another admin within 15 mins -> HTTP 409 Conflict
  ├── Mutate Lock State: Assign `lockedByAdminId = req.admin.id`, `lockedAt = NOW()`
  ├── Audit Log: `await db.auditLogRepo.create({ action: 'LOCKED', adminId: req.admin.id, ... })`
  └── Response: HTTP 200 { success: true, application }
```

### 5. Administrator Review Decision Path (Approve / Reject / Resubmission)
```text
HTTP POST /api/admin/identity-verifications/:id/review
  │
  ├── Middleware: `authenticateAdmin` + `requirePermission('identity_verification.review')`
  │
  ├── Granular RBAC Validation:
  │   ├── APPROVE: Requires `identity_verification.approve` or `SUPER_ADMIN` (Else 403)
  │   ├── REJECT: Requires `identity_verification.reject` or `SUPER_ADMIN` (Else 403)
  │   └── REQUEST_RESUBMISSION: Requires `identity_verification.request_resubmission` or `SUPER_ADMIN` (Else 403)
  │
  ├── Decision Validation:
  │   ├── APPROVE: Requires verification checklist (`infoMatches`, `aadhaarValid`, `voterIdValid`)
  │   ├── REJECT: Requires non-empty mandatory `reason`
  │   └── REQUEST_RESUBMISSION: Requires non-empty mandatory `reason`
  │
  ├── Persistence in PostgreSQL:
  │   ├── `await db.identityRepo.updateStatus(id, { review_status, reviewed_by_admin_id, verified_at, rejection_reason, resubmission_reason })`
  │   │   └── UPDATE identity_documents SET ... WHERE id = :id
  │   │
  │   └── User Table Synchronization:
  │       └── `await db.userRepo.updateIdentityStatus(userUuid, mappedUserStatus, req.admin.id)`
  │           └── UPDATE users SET identity_status = :status, updated_at = NOW() WHERE id = :userUuid
  │
  ├── Immutable Audit Log:
  │   └── `await db.auditLogRepo.create({
  │         module: 'IDENTITY_VERIFICATION',
  │         action: decision === 'APPROVE' ? 'APPROVED' : (decision === 'REJECT' ? 'REJECTED' : 'RESUBMISSION_REQUESTED'),
  │         adminId: req.admin.id,
  │         adminName: req.admin.name,
  │         role: req.admin.role,
  │         targetEntityType: 'APPLICATION',
  │         targetEntityId: id,
  │         previousState,
  │         newState,
  │         reason
  │       })`
  │
  ├── Real-time Customer Event:
  │   └── `broadcastToCustomer(userId, { type: 'IDENTITY_STATUS_UPDATED', status, applicationId, reason })`
  │
  └── Response: HTTP 200 { success: true, application, user }
```

---

## E. Authentication vs KYC Separation

A strict boundary is maintained between transient session authentication and permanent identity compliance:

| Domain | Characteristic | Examples | Storage Target |
|---|---|---|---|
| **Authentication State** | Ephemeral, session-bound, short-lived | Bearer session tokens, SMS OTP verification codes, failed login counters, WebSocket socket handles | In-memory `Map` / Redis cache (NEVER persisted to permanent identity tables) |
| **Operational Review Locks** | Short-lived coordination lease (15 mins) | `lockedByAdminId`, `lockedAt` | In-memory operational state (resets gracefully on restart) |
| **Durable Identity / KYC** | Permanent legal record, regulatory compliance | Raw & masked government document numbers, document reference URLs, verified compliance status, admin reviewer ID, rejection reasons, resubmission instructions | Authoritative PostgreSQL tables: `public.identity_documents`, `public.users`, `public.audit_logs` |

---

## F. Security, IDOR & BOLA Analysis

### 1. Existing Vulnerability Assessment
- **VULN-KYC-01 (CRITICAL IDOR on Submission):** `POST /api/identity/submit` currently does not enforce caller authentication. An attacker can send `{ userId: 'target_victim_id', aadhaarNumber: '...', ... }` and overwrite the target user's identity status.
- **VULN-KYC-02 (CRITICAL Information Disclosure / BOLA on Status):** `GET /api/identity/status/:userId` allows any unauthenticated caller to retrieve the compliance status, masked Aadhaar, masked Voter ID, and reviewer notes for any `userId`.
- **VULN-KYC-03 (Missing Self-Approval Block in API):** While the review endpoint checks admin permissions, customer tokens must be explicitly forbidden from calling any administrative identity endpoint.

### 2. Security Enforcements to Apply
1. **Mandatory Authenticated Session for Customer Identity APIs:**
   - In `POST /api/identity/submit`: Require valid customer token. If unauthenticated, return `HTTP 401`.
   - Bind `userId` strictly to `req.user.id`. If a caller supplies a `userId` in `req.body` that differs from the authenticated `req.user.id`, the server **ignores or rejects** the spoofed `userId` and uses `req.user.id`.
2. **Strict Ownership Check for Status API:**
   - In `GET /api/identity/status/:userId`: Require authentication.
   - If caller is a customer: verify `req.user.id === req.params.userId`. If not equal, return `HTTP 403 Forbidden`.
   - If caller is an admin: verify admin has `'identity_verification.view'` permission.
3. **Actor Attribution & Anti-Spoofing:**
   - In admin review and lock endpoints, `adminId`, `adminName`, and `role` are extracted exclusively from the verified server-side session `req.admin`.
   - Any client-supplied actor fields in `req.body` are ignored.
4. **Data Masking & PII Protection:**
   - Customers and non-privileged admins never receive raw Aadhaar or Voter ID numbers.
   - Only administrators with `SUPER_ADMIN` role or `'identity_documents.view'` permission can view unmasked government numbers.

---

## G. Document Storage Analysis

1. **Storage Mechanism:**
   - The PostgreSQL table `public.identity_documents` stores document URIs in columns `aadhaar_doc_url TEXT` and `voter_id_doc_url TEXT`.
   - Actual document binaries are **NOT** stored as byte arrays in PostgreSQL, maintaining optimal database performance.
2. **Cloudinary Policy:**
   - As audited in `backend/src/services/cloudinaryService.js` (lines 53–55):
     ```javascript
     if (lower.includes('kyc') || lower.includes('aadhaar') || lower.includes('voter') || lower.includes('license') || lower.includes('passport') || lower.includes('identity')) {
       throw new Error('Sensitive identity documents (Aadhaar, Voter ID, Driver License) are strictly prohibited from public Cloudinary storage and must use private encrypted storage.');
     }
     ```
   - Cloudinary is strictly prohibited from holding government IDs.
3. **Mock Document Previews:**
   - In development and test environments, document URLs point to `/docs/:filename` (e.g. `/docs/mock_aadhaar_rahul.png`).
   - `server.js` renders safe, non-PII watermarked SVG preview cards on demand.
4. **Preservation Directive:**
   - In compliance with Phase 10 guidelines, media storage architecture is maintained without premature redesign. Document URIs are safely persisted in PostgreSQL.

---

## H. KYC Workflow Analysis

### Valid Lifecycle State Machine
```text
                 ┌──────────────────────────────────────────────┐
                 │                                              │
                 ▼                                              │
           [ SUBMITTED ] ──────────────► [ UNDER_REVIEW ]       │
           (Initial Submit)             (Admin Lock/Claim)      │
                 │                               │              │
                 │                               ├──────────────┼─────────────┐
                 │                               │              │             │
                 ▼                               ▼              ▼             ▼
           [ VERIFIED ]                    [ REJECTED ]   [ RESUBMISSION ]    │
          (Admin Approve)                (Admin Reject)     (Admin Ask)       │
                 │                                              │             │
                 │                                              ▼             │
          Account Activated                              [ Customer Re- ] ────┘
         (Rides Unblocked)                                 [ Submits ]
```

### State Transition Rules
1. `SUBMITTED` / `PENDING` -> `UNDER_REVIEW`: Triggered by admin claiming review lock.
2. `UNDER_REVIEW` -> `VERIFIED`: Triggered by admin approval. Requires complete checklist (`infoMatches`, `aadhaarValid`, `voterIdValid`). Updates user's `identity_status` in `users` table to `'VERIFIED'`.
3. `UNDER_REVIEW` -> `REJECTED`: Triggered by admin rejection. Requires non-empty `reason`. Updates user's `identity_status` to `'REJECTED'`.
4. `UNDER_REVIEW` -> `RESUBMISSION_REQUIRED`: Triggered by admin requesting revised documents. Requires non-empty corrective instructions. Updates user's `identity_status` to `'RESUBMISSION_REQUIRED'`.
5. `RESUBMISSION_REQUIRED` -> `SUBMITTED`: Triggered when customer uploads corrected documents via `POST /api/identity/submit` with `isResubmission: true`. Updates user's `identity_status` to `'SUBMITTED'`.

---

## I. Administrator RBAC Analysis

All identity verification operations are protected by canonical administrative permissions defined in `001_central_schema.sql` and `backend/src/server.js`:

| Canonical Permission | Description | Allowed Roles |
|---|---|---|
| `identity_verification.view` | View identity verification queue, metrics, and application details | `SUPER_ADMIN`, `KYC_SPECIALIST`, `OPERATIONS` |
| `identity_verification.review` | Acquire review locks, release locks, and mark under review | `SUPER_ADMIN`, `KYC_SPECIALIST` |
| `identity_verification.approve` | Formally approve identity application and verify user | `SUPER_ADMIN`, `KYC_SPECIALIST` |
| `identity_verification.reject` | Formally reject identity application with mandatory reason | `SUPER_ADMIN`, `KYC_SPECIALIST` |
| `identity_verification.request_resubmission` | Request revised identity documents with instructions | `SUPER_ADMIN`, `KYC_SPECIALIST` |
| `identity_documents.view` | View unmasked government ID numbers (raw Aadhaar & Voter ID) | `SUPER_ADMIN`, `KYC_SPECIALIST` |
| `identity_documents.download` | Download attached document media files | `SUPER_ADMIN` |

*Unauthorized roles (e.g. `SUPPORT_AGENT`, `FINANCE_AUDITOR`, or unprivileged `OPERATIONS`) attempting review decisions receive `HTTP 403 Forbidden`.*

---

## J. Audit Log Analysis

Phase 7 successfully migrated `audit_logs` to PostgreSQL authority. Every identity verification lifecycle event must log through `await db.auditLogRepo.create(...)`:

| Event Trigger | Module | Action | Previous State | New State | Target Entity |
|---|---|---|---|---|---|
| User Initial Submission | `IDENTITY_VERIFICATION` | `SUBMITTED` | `'DRAFT'` / `'PENDING'` | `'SUBMITTED'` | `APPLICATION` (`appId`) |
| User Document Resubmission | `IDENTITY_VERIFICATION` | `RESUBMITTED` | `'RESUBMISSION_REQUIRED'` | `'SUBMITTED'` | `APPLICATION` (`appId`) |
| Admin Review Lock | `IDENTITY_VERIFICATION` | `LOCKED` | `'SUBMITTED'` | `'UNDER_REVIEW'` | `APPLICATION` (`appId`) |
| Admin Approval | `IDENTITY_VERIFICATION` | `APPROVED` | `'UNDER_REVIEW'` | `'VERIFIED'` | `APPLICATION` (`appId`) |
| Admin Rejection | `IDENTITY_VERIFICATION` | `REJECTED` | `'UNDER_REVIEW'` | `'REJECTED'` | `APPLICATION` (`appId`) |
| Admin Resubmission Request | `IDENTITY_VERIFICATION` | `RESUBMISSION_REQUESTED` | `'UNDER_REVIEW'` | `'RESUBMISSION_REQUIRED'` | `APPLICATION` (`appId`) |

**Audit Rules:**
- Sourced from authenticated session context (`req.admin` or `req.user`).
- No duplicate audit logs per action.
- Directly persisted and verified in `public.audit_logs`.

---

## K. Cross-Domain Relationships

1. **User Identity <-> Mobility Dispatch:**
   - In `backend/src/server.js` (lines 1707–1714) and `POST /api/customer/book-ride`:
     ```javascript
     const user = (customerId ? db.getUser(customerId) : req.user) || db.getUser('usr_1');
     if (user && user.identityStatus !== 'VERIFIED') {
       return res.status(403).json({
         success: false,
         error: 'Account identity verification pending. Your Aadhaar & Voter ID are currently awaiting manual verification by NABIN Admin.'
       });
     }
     ```
   - If user is not `VERIFIED`, all passenger ride bookings are rejected with `HTTP 403`.
   - Synchronizing user identity status to PostgreSQL ensures approved users remain unblocked across server restarts.
2. **User Identity <-> Support Disputes & Payments:**
   - Verified identity status is displayed on customer profiles and audit records, mitigating fraud in refund and dispute resolution.

---

## L. Restart Safety Analysis

### What Must Survive Server Restart
1. **Application Document Records:** All rows in `public.identity_documents` (IDs, raw/masked Aadhaar & Voter ID numbers, URLs, review status, reviewer ID, reasons, timestamps).
2. **User Identity Status:** Column `identity_status` in `public.users` must reflect the latest review decision (`'VERIFIED'`, `'REJECTED'`, `'RESUBMISSION_REQUIRED'`).
3. **Audit History:** Full log trail in `public.audit_logs`.

### Hydration in `initPostgres()`
Upon startup, `initPostgres()` must query `public.identity_documents` and hydrate `db.identityApplications`. If an approved user's status was set to `VERIFIED` in PostgreSQL, upon restart the user will immediately load with `identityStatus: 'VERIFIED'`, allowing ride bookings to succeed without regression.

---

## M. Concurrency & Collision Protection

1. **Simultaneous Admin Review Collisions:**
   - Mitigated by review claim lock (`/lock`). If Admin A locks an application, Admin B receives `HTTP 409 Conflict` if attempting to acquire the lock within the 15-minute lease window.
2. **Approval / Rejection Race:**
   - Updating the application status in PostgreSQL will check that the record is in an actionable state (`SUBMITTED` or `UNDER_REVIEW`). Once transitioned to `VERIFIED` or `REJECTED`, subsequent attempts to review are rejected.
3. **Duplicate User Submissions:**
   - If a customer submits while an application is already `SUBMITTED` or `UNDER_REVIEW`, the repository handles the submission idempotently (updating the existing pending application or rejecting duplicate submissions).

---

## N. Category A/B/C/D Classification

### CATEGORY A: PostgreSQL-Authoritative and Restart-Safe
- `public.identity_documents` table schema and historical constraints.
- `public.users.identity_status` and `public.users.account_status`.
- `public.audit_logs` persistence via `AuditLogRepository`.

### CATEGORY B: In-Memory But Must Be Persisted
- `db.identityApplications` array in `backend/src/database.js`.
- Updates to `user.identityStatus` in `reviewIdentityApplication(...)` and `submitIdentityApplication(...)`.
- Hydration of `identity_documents` during `initPostgres()`.

### CATEGORY C: Ephemeral and Safe in Memory
- Reviewer operational locks (`lockedByAdminId`, `lockedByAdminName`, `lockedAt` - 15-minute lease).
- Active user and admin session tokens (`activeSessions`).
- Short-lived OTP codes (`otpStore`).
- Brute-force rate limiting counters (`failedLoginAttempts`, `rateLimitRecords`).

### CATEGORY D: Missing Schema Genuinely Required
- **NONE.** All necessary tables (`identity_documents`, `users`, `audit_logs`) are already present in PostgreSQL.

---

## O. Migration Decision

**Migration 016 Required:** **NO**

### Technical Rationale
1. Migration `001_central_schema.sql` (lines 30–45) already created `public.identity_documents` with all required fields:
   `id`, `user_id`, `aadhaar_number_raw`, `aadhaar_number_masked`, `aadhaar_doc_url`, `voter_id_number_raw`, `voter_id_number_masked`, `voter_id_doc_url`, `review_status`, `reviewed_by_admin_id`, `rejection_reason`, `resubmission_reason`, `submitted_at`, `verified_at`.
2. Migration `001_central_schema.sql` (lines 15–28) already created `public.users` with `identity_status` having a valid check constraint:
   `CHECK (identity_status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'RESUBMISSION_REQUIRED', 'REJECTED'))`.
3. The table has proper foreign keys referencing `users(id)` with `ON DELETE CASCADE`.
4. Therefore, no schema changes or migrations are needed. Existing PostgreSQL schema is 100% complete and authoritative.

---

## P. Required Fixes

1. **Create `backend/src/repositories/IdentityRepository.js`:**
   - Implement `createApplication(data)`, `updateApplication(id, updates)`, `findById(id)`, `findByUserId(userId)`, `list(filters)`.
   - Implement DTO mapping between PostgreSQL snake_case columns and backend camelCase properties.
   - Support UUID resolution for legacy test IDs (`APP-9021` -> `00000000-0000-0000-0000-000000009021`).
2. **Wire Repository & Hydration in `backend/src/database.js`:**
   - Instantiate `this.identityRepo = new IdentityRepository(this);`.
   - In `initPostgres()`, hydrate `this.identityApplications` from `public.identity_documents`.
   - In `submitIdentityApplication(...)`, persist document metadata to PostgreSQL via `identityRepo` and update user's `identity_status` via `userRepo.updateIdentityStatus(...)`.
   - In `reviewIdentityApplication(...)`, persist review decision and notes to `identity_documents` via `identityRepo` and update user's `identity_status` via `userRepo.updateIdentityStatus(...)`.
   - Ensure `db.createAuditLog(...)` is awaited and records verified actor context.
3. **Security & IDOR Hardening in `backend/src/server.js`:**
   - Secure `POST /api/identity/submit`: Require caller authentication (`authenticateUser`), bind `userId` to `req.user.id`, prevent client from submitting on behalf of another user.
   - Secure `GET /api/identity/status/:userId`: Require authentication, verify `req.user.id === req.params.userId` or admin has `identity_verification.view`.
   - Make endpoints `async` to properly await database repository and audit log writes.
4. **Automated Test Coverage in `backend/test_suite.js` & `backend/restart_test.js`:**
   - Add Module 25: Identity & KYC Verification Persistence Suite (covering KYC-01 through KYC-14).
   - Add restart verification asserting that submitted identity documents, review decisions, and user verification status survive full server reboot.

---

## Q. Optional Hardening (Non-Blocking)

- Add a secondary index on `identity_documents(user_id)` in a future maintenance window if document query volume exceeds standard load.
- Implement Verhoeff algorithm validation on raw Aadhaar numbers for immediate client-side and server-side syntax verification.

---

## R. Future Enhancements (Out of Scope for Phase 10)

- Automated Government API e-KYC integration (UIDAI / DigiLocker APIs).
- Automated OCR extraction from document images using server-side computer vision.
- Multi-document expansion for commercial driver fleet onboarding (Driving License, Commercial Badge, Vehicle RC, Fitness Certificate).

---

## S. Detailed Implementation Plan

```
Step 1: Create IdentityRepository.js
  ├── Path: backend/src/repositories/IdentityRepository.js
  ├── Map columns: id, user_id, aadhaar_*, voter_id_*, review_status, ...
  ├── Implement CRUD with live PostgreSQL client (supabaseAdmin)
  └── Preserve in-memory caching fallback for offline/test environments

Step 2: Update NabinDatabase in database.js
  ├── Require and instantiate IdentityRepository
  ├── In initPostgres(): Hydrate db.identityApplications from public.identity_documents
  ├── In submitIdentityApplication(): Persist to PostgreSQL + update user identity_status
  └── In reviewIdentityApplication(): Persist review decision to PostgreSQL + update user identity_status

Step 3: Harden Identity REST Endpoints in server.js
  ├── In POST /api/identity/submit: Require authentication, bind userId to session, await persistence
  ├── In GET /api/identity/status/:userId: Require authentication, enforce ownership (IDOR prevention)
  └── In POST /api/admin/identity-verifications/:id/review: Await async database and audit operations

Step 4: Expand Test Baseline
  ├── In test_suite.js: Add Module 25 (KYC-01 to KYC-13)
  └── In restart_test.js: Add KYC-14 (Restart verification)
```

---

## T. Test Plan (Minimum KYC-01 to KYC-14)

### Module 25: Identity & KYC Persistence & Security Suite

- **KYC-01: Unauthenticated KYC Submission Rejected**
  - Call `POST /api/identity/submit` without Authorization header.
  - Verify HTTP 401 Unauthorized.
- **KYC-02: Unauthorized Admin Review Rejected**
  - Call `POST /api/admin/identity-verifications/:id/review` with customer token or unauthorized admin role (`SUPPORT_AGENT`).
  - Verify HTTP 403 Forbidden.
- **KYC-03: IDOR Prevention: User Cannot Access Another User's KYC**
  - Authenticate as User B (`usr_3`). Call `GET /api/identity/status/usr_1`.
  - Verify HTTP 403 Forbidden (cross-user access blocked).
- **KYC-04: IDOR Prevention: User Cannot Submit KYC for Another User**
  - Authenticate as User B (`usr_3`). Call `POST /api/identity/submit` with `userId: 'usr_1'` in body.
  - Verify server binds submission to `usr_3` and rejects/ignores attempt to overwrite `usr_1`.
- **KYC-05: KYC Submission Persists to PostgreSQL**
  - Authenticate as unverified user. Call `POST /api/identity/submit`.
  - Verify HTTP 200 and query PostgreSQL `identity_documents` table to verify row exists with `review_status = 'SUBMITTED'`.
- **KYC-06: Document Metadata & Masking Persists**
  - Verify `aadhaar_number_masked` (`XXXX-XXXX-4892`) and `voter_id_number_masked` are stored accurately in PostgreSQL.
- **KYC-07: Admin Review Lock Persists**
  - Authenticate as KYC specialist. Call `POST /api/admin/identity-verifications/:id/lock`.
  - Verify application is marked `UNDER_REVIEW`. A second admin attempting to lock receives HTTP 409 Conflict.
- **KYC-08: Approval Persists to PostgreSQL & Activates User**
  - KYC specialist calls `POST /api/admin/identity-verifications/:id/review` with decision `'APPROVE'`.
  - Verify PostgreSQL `identity_documents.review_status = 'VERIFIED'`.
  - Verify PostgreSQL `users.identity_status = 'VERIFIED'`.
  - Verify user is now able to book rides without receiving 403.
- **KYC-09: Rejection and Mandatory Reason Persist**
  - Call review endpoint with decision `'REJECT'` and reason `'Photo mismatch with government database'`.
  - Verify PostgreSQL `identity_documents.rejection_reason` is stored.
  - Verify PostgreSQL `users.identity_status = 'REJECTED'`.
- **KYC-10: Invalid Status Transition Rejected**
  - Attempt to approve application without completing verification checklist.
  - Attempt to reject without providing a non-empty reason.
  - Verify HTTP 400 Bad Request.
- **KYC-11: Admin Actor Attribution Cannot Be Spoofed**
  - Admin calls review endpoint with forged `adminId: 'MALICIOUS_IMPOSTOR'` in request body.
  - Verify PostgreSQL `identity_documents.reviewed_by_admin_id` and `audit_logs.admin_id` match the authenticated admin session (`adm_kyc`), ignoring client forgery.
- **KYC-12: Exactly One Audit Record Created Per KYC Action**
  - Verify submission and review decisions each produce exactly one immutable audit log record in `public.audit_logs` with module `IDENTITY_VERIFICATION`.
- **KYC-13: Duplicate Submission / Resubmission Behavior Is Safe**
  - When user resubmits documents with `isResubmission: true`, verify previous historical audit trail is retained and application updates cleanly.
- **KYC-14: KYC State Survives Full Backend Termination & Restart (`restart_test.js`)**
  - Submit identity application and approve it prior to restart.
  - Terminate server process on port 4000.
  - Spawn clean server instance from cold start (`initPostgres()`).
  - Verify application record exists with status `VERIFIED`.
  - Verify user profile retains `identityStatus: 'VERIFIED'`.
  - Verify user can book a ride post-restart without verification blocks.

---

## U. Rollback Strategy

1. If any defects occur during implementation, the working tree can be restored to `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9` via `git checkout`.
2. Since **NO** database migrations are created or executed, PostgreSQL schema remains byte-for-byte identical to baseline.
3. In-memory fallback in `IdentityRepository` ensures full offline operation if PostgreSQL connection is interrupted.

---

## V. Remote Supabase Safety

- **Remote Supabase status:** STRICTLY UNTOUCHED & OFF-LIMITS.
- No commands such as `supabase db push`, `supabase db reset`, or `supabase link` will be executed.
- All testing and execution remains confined strictly to local Docker container `supabase_db_nabin`.

---

## Summary Verdict

- **PHASE 10 VERDICT:** FORENSIC AUDIT COMPLETE — IMPLEMENTATION READY
- **MIGRATION REQUIRED:** **NO** (Existing migrations 001–015 are completely sufficient)
- **APPROVAL STATUS:** WAITING FOR EXPLICIT USER APPROVAL BEFORE PROCEEDING
