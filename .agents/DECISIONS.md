# NABIN — Decision Register

**Status**: AUTHORITATIVE — PERMANENT  
**Format**: Decision ID | Date | Status | Decision | Rationale

---

## APPROVED DECISIONS

### DEC-001: Unified Backend Architecture
- **Date**: 2026-08-20
- **Status**: APPROVED
- **Decision**: All 4 client applications (Customer, Driver, Merchant, Admin) interface with a single Node.js backend (`backend/src/server.js`) and database instance.
- **Rationale**: Eliminates data fragmentation, duplicate authentication logic, and out-of-sync payment engines.

### DEC-002: Agency Agents Integration
- **Date**: 2026-08-20
- **Status**: APPROVED
- **Decision**: Installed `msitarzewski/agency-agents` at `.agents/agency_agents/` and mapped specialist skills under `.agents/skills/`.
- **Rationale**: Enforces skill-first development protocols for Product, System Architecture, UI/UX Design, Backend Engineering, Mobile Builder, Security Audit, QA Testing, and DevOps.

### DEC-003: PostgreSQL as Single Source of Truth
- **Date**: 2026-08-23
- **Status**: APPROVED
- **Decision**: PostgreSQL (via Supabase) is the authoritative persistence layer. In-memory arrays are bounded caches only, updated after PostgreSQL confirms writes.
- **Rationale**: Eliminates data loss on server restart, enables ACID transactions, supports RLS, and provides audit trail.

### DEC-004: Double-Entry Ledger for All Financial Operations
- **Date**: 2026-08-23
- **Status**: APPROVED
- **Decision**: All wallet mutations, payment captures, refunds, and payouts must use PostgreSQL stored RPC functions (`adjust_wallet_atomic`, `capture_payment_atomic`, `refund_payment_atomic`). No JavaScript balance arithmetic.
- **Rationale**: Ensures ACID compliance, prevents race conditions, maintains immutable audit trail, and enforces non-negative balance constraints.

### DEC-005: Fail-Closed Authentication
- **Date**: 2026-09-04
- **Status**: APPROVED
- **Decision**: All authenticated endpoints must fail closed with HTTP 401 on missing/invalid tokens. No fallback to first user in DB, no hardcoded `drv_1` or `restaurants[0]` bypasses.
- **Rationale**: Prevents unauthorized access, BOLA/IDOR vulnerabilities, and authentication bypass.

### DEC-006: Customer Identity Binding on Bookings
- **Date**: 2026-09-04
- **Status**: APPROVED
- **Decision**: Booking endpoints (`book-ride`, `book-food`, `book-parcel`) bind `req.user.id` as the customer ID. Reject request body `customerId` if it differs from authenticated user. Remove all `customerId || 'usr_1'` fallbacks.
- **Rationale**: Prevents cross-customer IDOR attacks.

### DEC-007: Migration 001–015 Are Immutable Baseline
- **Date**: 2026-09-04
- **Status**: APPROVED
- **Decision**: Migrations 001–015 are approved baseline. Do not modify, drop, or recreate.
- **Rationale**: Historical migrations represent verified production schema. Modification risks data loss and breaks foreign key chains.

### DEC-008: Migration 016 — Authorized in Git Baseline, Formal Approval Workflow Pending
- **Date**: 2026-09-05 (original unauthorized attempt)
- **Amended**: 2026-09-07 (post-independent-verification)
- **Status**: AUTHORIZED IN GIT BASELINE / FORMAL APPROVAL RECORD PENDING
- **Decision**: Migration 016 (`016_driver_kyc_payout_and_partial_refund.sql`) exists in the authorized Git baseline via commit c0cdf47 ("feat(phase-16): implement PostgreSQL-authoritative driver KYC..."). The migration file is present at `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` and is part of the current HEAD. However, a formal user approval record documenting explicit authorization is not present in the repository.
- **Rationale**: The original unauthorized Phase 16 implementation (d7ef7f5) was reverted via 409e2e9. A subsequent authorized implementation (c0cdf47) re-introduced Migration 016 with corrected code. The current repository state treats Migration 016 as part of the authorized baseline. Governance must distinguish between "present in authorized Git history" and "documented formal user approval."
- **Open Question**: Does c0cdf47 represent explicit user approval, or is a separate formal approval record required?

### DEC-009: Migration 017 — Absent / Reverted / Not Approved for Future Implementation
- **Date**: 2026-09-07
- **Status**: ABSENT / NOT APPROVED
- **Decision**: Migration 017 (`017_menu_customization_and_kitchen_workflow.sql`) does not exist in the current repository. It was created during unauthorized Phase 18 attempts and deleted by revert commits 66c0718 and 1d404a6. It is NOT approved for future implementation.
- **Rationale**: Phase 18 implementation was unauthorized and fully reverted. The migration file was removed from the working tree and Git index. Any future implementation would require a new approved plan, formal user approval, and a new migration file.

### DEC-010: NABIN Does Not Operate Dark Stores
- **Date**: 2026-09-07
- **Status**: APPROVED
- **Decision**: NABIN does not operate dark stores, warehouses, micro warehouses, or any fulfillment model. Grocery is a marketplace model connecting customers to grocery merchants' physical stores.
- **Rationale**: Business model clarification. All documentation and code must reflect marketplace, not warehouse/fulfillment model.

### DEC-011: Family Features Are NOT NABIN Features
- **Date**: 2026-09-07
- **Status**: APPROVED
- **Decision**: Family Circle, Family Vault, Family Pool, and Junior Mode are NOT NABIN features and must not be implemented or referenced as NABIN capabilities.
- **Rationale**: Product scope clarification.

### DEC-012: Multi-Agent Governance Required
- **Date**: 2026-09-07
- **Status**: APPROVED
- **Decision**: All development must follow multi-agent governance protocol. Every agent must read `.agents/` governance documents before work. PLAN-ONLY is the default mode for new work.
- **Rationale**: Prevents contradictory implementations, scope creep, and unauthorized changes across multiple AI agents and models.

### DEC-013: Remote Supabase Off Limits
- **Date**: 2026-09-07
- **Status**: APPROVED
- **Decision**: Remote Supabase projects are OFF LIMITS unless separately and explicitly authorized by USER. Local Docker Supabase is available for development.
- **Rationale**: Prevents accidental production data corruption.

### DEC-014: Forward-Only Recovery Preferred
- **Date**: 2026-09-05
- **Status**: APPROVED
- **Decision**: When recovering from unauthorized commits, use Option C: forward-only baseline restoration commit. Do NOT use `git reset --hard` or force push.
- **Rationale**: Preserves Git history immutability, maintains audit trail, avoids data loss, and satisfies compliance requirements.

### DEC-015: Synthetic VPA Generation Prohibited
- **Date**: 2026-09-05
- **Status**: APPROVED (as prohibition)
- **Decision**: Synthetic UPI/VPA generation (e.g., `${driver.id}@okhdfcbank`) is STRICTLY PROHIBITED in all code paths, including fallbacks.
- **Rationale**: Financial settlements must never use fabricated payment addresses. If `verifiedUpiId` is null, the payout must be rejected, not synthesized.

### DEC-016: Atomic Cancellation Required
- **Date**: 2026-09-05
- **Status**: APPROVED (as requirement)
- **Decision**: `POST /api/customer/cancel-ride` must invoke a single PostgreSQL stored procedure (`cancel_ride_atomic`) that unifies refund, wallet adjustment, compensation, promo restoration, and job status update in one ACID transaction.
- **Rationale**: Prevents state drift between payment status and wallet balance under error conditions.

### DEC-017: Authorized Git Baseline vs Formal Approval Record
- **Date**: 2026-09-07
- **Status**: PROPOSED — PENDING USER APPROVAL
- **Decision**: The repository distinguishes between:
  1. **Authorized Git Baseline**: Code present in `origin/main` from commits that are part of the authorized branch history.
  2. **Formal Approval Record**: Explicit user approval documented in governance artifacts (DECISIONS.md, phase reports, etc.).
  A commit being in `origin/main` does not automatically constitute a formal approval record. Conversely, a formal approval record without corresponding Git implementation does not make the code authorized.
- **Rationale**: Prevents agents from inferring approval from Git history alone, or from treating documented approval as implemented code. Migration 016 is currently in the authorized Git baseline via c0cdf47, but lacks a documented formal approval record.

---

## REJECTED DECISIONS

### DEC-R1: DarkStore Quick Commerce Model
- **Date**: 2026-09-07
- **Status**: REJECTED
- **Decision Considered**: Operate 10-minute dark store grocery delivery with NABIN-owned warehouses.
- **Reason for Rejection**: NABIN does not operate dark stores. Grocery is marketplace model (DEC-010).

### DEC-R2: Name Uniqueness on saved_schools and saved_children
- **Date**: 2026-09-04
- **Status**: REJECTED
- **Decision Considered**: Enforce `UNIQUE(user_id, name)` on `saved_schools` and `UNIQUE(user_id, full_name)` on `saved_children`.
- **Reason for Rejection**: Families may have twins, blended families, or multiple children with similar names. Parents may save multiple campuses of the same school chain. UUID primary keys provide sufficient uniqueness.

### DEC-R3: Full Denormalization of School Coordinates
- **Date**: 2026-09-04
- **Status**: REJECTED
- **Decision Considered**: Store `school_address`, `school_lat`, `school_lng` on both `saved_schools` and `saved_children`.
- **Reason for Rejection**: Creates two sources of truth for physical coordinates. If parent edits school gate location, child profile retains stale coordinates, causing dispatch errors. Single source of truth in `saved_schools` only.

---

## SUPERSEDED DECISIONS

### DEC-S1: In-Memory as Authoritative State
- **Date**: Pre-2026-08-23
- **Status**: SUPERSEDED by DEC-003
- **Decision**: In-memory arrays (`this.users`, `this.drivers`, `this.jobs`) were authoritative.
- **Reason for Supersession**: Phase 1 persistence bridge established PostgreSQL as authoritative. In-memory is now bounded cache only.

---

## PENDING DECISIONS

| ID | Topic | Status | Required Approvers |
|----|-------|--------|-------------------|
| DEC-P1 | Migration 016 formal approval record | PENDING | USER, SYSTEM ARCHITECT |
| DEC-P2 | Migration 017 future implementation | PENDING | USER, SYSTEM ARCHITECT, SECURITY ENGINEER |
| DEC-P3 | Phase 16 remediation plan | PENDING | USER, SYSTEM ARCHITECT, SECURITY ENGINEER, BACKEND ARCHITECT |
| DEC-P4 | WebSocket authentication fix | PENDING | SYSTEM ARCHITECT, MOBILE APP BUILDER, BACKEND ARCHITECT |
| DEC-P5 | Mobile UI wiring prioritization | PENDING | PRODUCT MANAGER, MOBILE APP BUILDER |
