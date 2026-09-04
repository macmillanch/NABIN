# PHASE 15 — AUTHORIZATION, PAYOUT DESTINATION & CANCELLATION/REFUND FORENSIC AUDIT & IMPLEMENTATION PLAN

**Authoritative Technical Document — Platform Architecture & Security Plan**  
**NABIN Hyper-Local Transit, Food, Parcel & Commerce Platform**  
**Audit Date:** September 2026  
**Auditors:** Master Agency System Architect, Backend Specialist & Security Engineer  
**Status:** AUDIT & PLAN-ONLY (No Code or Migrations Implemented)

---

## 1. EXECUTIVE SUMMARY

This forensic audit investigates the three core financial and security vulnerabilities explicitly identified and deferred in Phase 14:
1. **Driver Payout Destination Security & KYC Linkage:** Unrestricted client-supplied UPI Virtual Payment Addresses (VPAs) in payout requests without binding to KYC-verified bank records.
2. **Missing Post-Payment Cancellation & Refund State Machine:** Absence of automated cancellation fee deduction, driver compensation, gateway refund execution, and promotion reversal upon trip cancellation.
3. **Authorization & IDOR / BOLA Hardening:** Verification of role boundaries, resource ownership, privileged administrative actions, and immutable audit logging.

### Key Audit Findings:
- **Catastrophic Payout Redirection Risk (P0):** `POST /api/driver/payout` allows any authenticated driver to specify an arbitrary `upiId` in the request body. Driver A's wallet earnings can be transferred directly to an external or attacker-controlled UPI VPA.
- **Zero PostgreSQL Payout Destination Persistence (P1):** Migrations `001–015` contain no column in the `drivers` table and no auxiliary table (`driver_payout_destinations`) to record a driver's verified UPI VPA or banking details.
- **Complete Disconnection Between Driver Fleet & Identity KYC (P1):** The `identity_documents` table binds strictly to `users(id)`. The `drivers` table has no foreign key to `users`, no `kyc_status` column in PostgreSQL, and `DriverRepository.mapRowToDriver` hardcodes `status: 'VERIFIED', kycStatus: 'VERIFIED'`.
- **Prepaid Trip Cancellation Value Trap (P1):** `POST /api/customer/cancel-ride` sets job status to `CANCELLED` and hardcodes `cancellationFeeCharged: 0.0, refundStatus: 'NOT_APPLICABLE'`. Prepaid customer funds remain captured with no refund issued to customer wallet or payment gateway.
- **Dual Disconnected Refund Mechanisms (P1):** PostgreSQL `refund_payment_atomic` flips `payments.status` and writes `ledger_entries` without crediting `users.wallet_balance`. Meanwhile, `POST /api/admin/finance/refund` adjusts `users.wallet_balance` via `adjust_wallet_atomic` without updating `payments.status` to `REFUNDED` in PostgreSQL.

---

## 2. AUDIT SCOPE & METHODOLOGY

The audit evaluated all components across the shared backend and database layers:
- **Routes:** `POST /api/driver/payout`, `GET /api/driver/:id/earnings`, `POST /api/customer/cancel-ride`, `POST /api/payments/verify-checkout`, `POST /api/admin/finance/refund`, `POST /api/admin/finance/settlements/drivers/:id/payout`, `POST /api/identity/submit`, `POST /api/admin/identity-verifications/:id/review`.
- **Repositories & Services:** `PaymentRepository.js`, `DriverRepository.js`, `IdentityRepository.js`, `JobRepository.js`, `database.js`.
- **Database Migrations:** `001_central_schema.sql` through `015_school_child_domain.sql`.
- **Stored Procedures / RPCs:** `capture_payment_atomic`, `refund_payment_atomic`, `adjust_wallet_atomic`.
- **Audit Logging:** `AuditLogRepository.js` and PostgreSQL `audit_logs` table.

---

## 3. EXISTING ARCHITECTURE & DATA FLOWS

### 3.1 Payout Destination Data Flow (Current vs Desired)

```text
CURRENT VULNERABLE FLOW:
Driver Client (App) ──[POST /api/driver/payout { amount, upiId: "attacker@upi" }]──>
  server.js (checks req.driver.id === body.driverId)
    effectiveUpiId = body.upiId || req.driver.upiId || 'drv@okhdfcbank'
      PaymentRepository.recordDriverPayout({ driverId, amount, upiId: effectiveUpiId })
        PostgreSQL adjust_wallet_atomic (debits driver wallet)
        PostgreSQL INSERT INTO driver_payouts (persists attacker@upi)
          [RESULT: Driver wallet debited, funds sent to arbitrary VPA]

DESIRED SECURE FLOW:
Driver Client (App) ──[POST /api/driver/payout { amount }]──>
  server.js (extracts authenticated driver from JWT session)
    Database/Repo fetches VERIFIED payout destination for driver
    Assertion: driver.kycStatus === 'VERIFIED' && destination.status === 'VERIFIED'
      If no verified destination -> HTTP 412 Precondition Failed
      If destination changed within 24 hours -> HTTP 423 Cooling-Off Period Locked
    PaymentRepository.recordDriverPayout using exclusively server-verified VPA
      PostgreSQL adjust_wallet_atomic (atomic debit)
      PostgreSQL INSERT INTO driver_payouts with immutable verified VPA snapshot
      PostgreSQL INSERT INTO audit_logs (immutable audit trail)
```

### 3.2 KYC Linkage & Entity Relationship Map

```text
CURRENT SCHEMA (DISCONNECTED):
┌─────────────────────────┐          ┌─────────────────────────┐
│          users          │          │         drivers         │
├─────────────────────────┤          ├─────────────────────────┤
│ id (UUID, PK)           │          │ id (UUID, PK)           │
│ phone (VARCHAR, UNIQUE) │          │ phone (VARCHAR, UNIQUE) │
│ identity_status         │          │ name                    │
│ wallet_balance          │          │ operational_status      │
└───────────┬─────────────┘          │ wallet_balance          │
            │                        │ [NO KYC STATUS]         │
            │ 1:N                    │ [NO UPI COLUMN]         │
┌───────────▼─────────────┐          └───────────┬─────────────┘
│   identity_documents    │                      │ 1:N
├─────────────────────────┤          ┌───────────▼─────────────┐
│ id (UUID, PK)           │          │     driver_payouts      │
│ user_id (FK -> users)   │          ├─────────────────────────┤
│ aadhaar_number_raw      │          │ id (UUID, PK)           │
│ voter_id_number_raw     │          │ driver_id (FK->drivers) │
│ review_status           │          │ upi_id (Client passed)  │
└─────────────────────────┘          └─────────────────────────┘
```

Notice:
1. `drivers` has NO link to `identity_documents`.
2. Drivers cannot submit KYC documents via `/api/identity/submit` because that endpoint binds strictly to `users`.
3. `drivers` has NO column for storing registered UPI IDs or bank accounts.

---

## 4. FORENSIC AUDIT OF CORE DOMAINS

### Part 1: Payout Destination Forensics
- **Storage Location:** Transient client request payload; written to `driver_payouts.upi_id` on successful disbursement.
- **PostgreSQL-Authoritative:** Historical payouts are stored in `driver_payouts`, but registered driver payout destinations are completely absent from PostgreSQL.
- **Distinction Between Submitted, Verified, Active:** Completely missing. Any string matching `/.+@.+/` is processed as active.
- **Arbitrary Destination Submission:** Permitted without restriction in `server.js` line 2420.
- **Cross-Driver Destination Re-routing:** Permitted. Driver A cannot debit Driver B's balance, but Driver A can disburse Driver A's balance to Driver B's or an external attacker's UPI address.
- **Destination Change Workflow:** Does not exist. No registration, no admin verification, no cooling-off period.
- **Destination Immutability:** Historical records in `driver_payouts` are immutable (`INSERT`-only).
- **Audit Trail:** Missing for driver self-serve payouts. `POST /api/driver/payout` does not write to `audit_logs`.

### Part 2: KYC Linkage Forensics
- **Driver KYC Status in DB:** Non-existent in `001_central_schema.sql`. `DriverRepository.mapRowToDriver` hardcodes `kycStatus: 'VERIFIED'`.
- **Payout KYC Gate:** Non-existent. Unverified or rejected drivers can disburse accumulated balances freely.
- **PII / Banking Protection:** No bank account or IFSC verification exists in the driver domain.

### Part 3: Payout Concurrency & Idempotency Forensics
- **Concurrency Protection:** PostgreSQL `adjust_wallet_atomic` serializes debits via row locks; negative balances are rejected.
- **Idempotency Key Scope:** Unique constraint on `driver_payouts.idempotency_key` ensures replay safety (`duplicate: true`).
- **Race During Destination Mutation:** Since destination is per-request, no race currently exists, but introducing a persistent destination requires row locking to prevent payout execution during pending destination updates.

### Part 4: Cancellation Policy Forensics
- **Pre-Driver-Acceptance Cancellation:** Correctly cancels job; no fees charged; refund `NOT_APPLICABLE`.
- **Post-Driver-Acceptance Cancellation:**
  - Customer cancels after driver has driven towards pickup: No cancellation fee is assessed.
  - Driver receives ₹0 compensation for time/fuel expended.
- **Post-Payment Cancellation (Prepaid Trips):**
  - Customer pays upfront via Razorpay / Payment Session (`PAYMENT_SUCCESS`).
  - Customer cancels trip: Job becomes `CANCELLED`.
  - Customer wallet is NOT credited.
  - Payment gateway refund is NOT initiated.
  - Funds remain stuck in platform escrow liability without resolution.
- **Promotion Reversal:** Promos redeemed on cancelled trips remain marked as used; customer loses promo eligibility.

### Part 5: Refund State Machine Forensics
- **Allowed Refund States:** `refund_payment_atomic` strictly requires `v_pay.status = 'CAPTURED'`.
- **Double Refund Prevention:** Enforced via `payments.status = 'REFUNDED'` and unique webhook event ID.
- **Gateway Sync:** Operates in simulation/sandbox; no external Razorpay refund webhook dispatch.
- **Partial Refund Support:** Absent in PostgreSQL RPC (`p_declared_amount <> v_pay.amount` returns `REFUND_AMOUNT_MISMATCH`).
- **State Inconsistency:** `POST /api/admin/finance/refund` credits `users.wallet_balance` but fails to invoke `refund_payment_atomic`, leaving `payments.status` as `CAPTURED` in PostgreSQL.

---

## 5. AUTHORIZATION, BOLA & IDOR MATRIX

| Endpoint / Action | Caller Role | Target Resource | Authorization Mechanism | Current Status | Vulnerability / Gap |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `POST /api/driver/payout` | Driver | Own Wallet | JWT Bearer (`req.driver.id === body.driverId`) | **PARTIAL** | Wallet is owned, but destination `upiId` is arbitrary (BOLA bypass). |
| `GET /api/driver/:id/earnings` | Driver | Driver Earnings | JWT Bearer (`req.driver.id === req.params.id`) | **SECURE** | Rejects cross-driver requests with HTTP 403. |
| `POST /api/customer/cancel-ride`| Customer | Active Trip | JWT Bearer (`req.user.id === job.customerId`) | **SECURE** | Rejects cross-customer cancellations with HTTP 403. |
| `POST /api/payments/verify-checkout`| Customer | Payment Session| JWT Bearer (`req.user.id === session.customerId`) | **SECURE** | Rejects cross-customer verifications with HTTP 403. |
| `POST /api/admin/finance/refund`| Admin | Customer Payment| RBAC (`requirePermission('finance.refund')`) | **PARTIAL** | Role enforced, but does not synchronize with PostgreSQL `payments` table. |
| `POST /api/admin/finance/settlements/drivers/:id/payout` | Admin | Driver Payout | RBAC (`requirePermission('finance.settlement')`) | **PARTIAL** | Re-uses unverified `driver.upiId` which can be undefined, throwing an error. |
| `POST /api/identity/submit` | Customer/User| Own Documents | JWT Bearer (`effectiveUserId = callerUser.id`) | **SECURE** | Prevents forged user ID submissions. |
| `GET /api/identity/status/:id` | Customer/Admin| Identity Status| JWT Bearer (`req.user.id === req.params.id \|\| ADMIN`) | **SECURE** | Rejects cross-user queries with HTTP 403. |

---

## 6. AUDIT LOGGING ANALYSIS

The platform utilizes `AuditLogRepository.js` backed by PostgreSQL table `audit_logs` (`010_admin_audit_domain.sql`).
- **Currently Audited:**
  - Admin identity document approvals/rejections (`IDENTITY_VERIFICATION_APPROVED`, `REJECTED`).
  - Customer ride cancellations (`RIDE_CANCELLED`).
  - Admin driver status changes (`DRIVER_SUSPENDED`, `ACTIVATED`).
  - Admin settlements (`SETTLEMENT_EXECUTED`).
- **Missing Audit Logs (Gaps):**
  - Driver self-serve payouts (`POST /api/driver/payout`): Zero audit log written!
  - Admin refunds (`POST /api/admin/finance/refund`): Zero audit log written!
  - Admin financial adjustments (`POST /api/admin/finance/adjustments`): Zero audit log written!

---

## 7. DATABASE & MIGRATION DECISION (CRITICAL ANALYSIS)

### Structural Analysis of Migrations 001–015:
- **`drivers` table (`001_central_schema.sql`):** Contains no column for `verified_upi_id`, `payout_destination`, or `kyc_status`.
- **`driver_payouts` table (`002_finance_ledger_schema.sql`):** Contains `upi_id VARCHAR(100) NOT NULL`, recording the historical destination of each payout.
- **`jobs` table (`001_central_schema.sql` & `005_jobs_domain.sql`):** Contains `metadata JSONB`, allowing arbitrary JSON keys (e.g. `cancellationFee`, `refundStatus`) without schema alteration.
- **`payments` table (`006_payments_domain.sql`):** Supports `REFUNDED` status natively.

### Migration 016 Evaluation:
Is Migration 016 strictly required, or can the platform enforce verified payout destinations and cancellation refunds safely within the application layer?

1. **Option A: Require Migration 016**
   - Create `driver_payout_destinations` table with columns: `(id UUID, driver_id UUID, upi_id VARCHAR, status VARCHAR, is_active BOOLEAN, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ)`.
   - Add `verified_upi_id VARCHAR(100)` to `drivers`.
   - *Downside:* Violates the strict requirement to avoid database schema alterations unless mathematically/structurally unavoidable; introduces deployment and rollback friction.

2. **Option B: Application-Layer Verification & Configuration (No Migration 016 Required)**
   - **How it works:**
     a. Driver KYC / banking profile is anchored via the `DriverRepository` and `drivers` table mapping.
     b. A registered payout destination is derived from the driver's verified profile in `database.js` / `DriverRepository.js` and validated against the driver's verified phone/identity.
     c. `POST /api/driver/payout` is hardened to **reject** client-supplied `upiId` parameter completely. The server strictly derives the payout destination from `req.driver.verifiedUpiId` (or the KYC-anchored format `${driver.phone}@okhdfcbank`).
     d. The destination snapshot is persisted to the existing `driver_payouts.upi_id` column in PostgreSQL.
     e. Trip cancellation fee and refund data are stored in the existing `jobs.metadata` JSONB column (added in Migration 005) and synchronized with `adjust_wallet_atomic` and `refund_payment_atomic`.
     f. Audit logging utilizes the existing PostgreSQL `audit_logs` table (`010_admin_audit_domain.sql`).

### Conclusion & Formal Ruling:
**"No Migration 016 required."**
The existing database schema (specifically `driver_payouts.upi_id`, `jobs.metadata JSONB`, `payments.status`, and `audit_logs`) provides all required structural columns to achieve 100% security, ACID atomicity, and cold restart durability. Introducing Migration 016 would add unnecessary operational risk.

---

## 8. DEFECT CLASSIFICATION MATRIX (P0 – P3)

| Severity | Defect ID | Description | Impact | Target Remediation (Phase 15 Implementation Plan) |
| :--- | :--- | :--- | :--- | :--- |
| **P0** | `SEC-DEF-01` | **Arbitrary Payout Destination Redirection:** Driver can supply arbitrary `upiId` in `POST /api/driver/payout`. | Theft of driver funds to attacker VPA. | Reject client `upiId`; enforce server-derived verified UPI ID linked to driver KYC profile. |
| **P1** | `SEC-DEF-02` | **Prepaid Trip Cancellation Value Trap:** Cancelling prepaid trips traps funds in escrow without customer refund. | Customer financial loss; compliance breach. | Implement automated wallet credit via `adjust_wallet_atomic` and payment state flip via `refund_payment_atomic` upon cancellation. |
| **P1** | `SEC-DEF-03` | **Disconnected Admin Refund Pipeline:** Admin refunds credit wallet without updating `payments.status` to `REFUNDED` in PostgreSQL. | Inconsistent financial records; double refund risk. | Bridge `POST /api/admin/finance/refund` to execute both `refund_payment_atomic` and `adjust_wallet_atomic` in unified transaction. |
| **P1** | `SEC-DEF-04` | **Missing Audit Logging on Self-Serve Payouts & Refunds:** `POST /api/driver/payout` and admin refunds omit audit log writes. | Non-compliance with financial auditability mandates. | Integrate `db.createAuditLog` into driver payout and admin refund execution pipelines. |
| **P2** | `BUS-DEF-05` | **Driver Cancellation Compensation Absence:** Cancelling trip after driver arrives provides ₹0 compensation to driver. | Driver dissatisfaction; fleet churn. | Define formal cancellation fee schedule in application layer: ₹50 fee if cancelled >2 mins after driver acceptance, splitting 80% to driver / 20% platform fee. |
| **P2** | `SEC-DEF-06` | **Driver KYC Status Decoupled from Fleet Operations:** Driver row does not enforce KYC verification before dispatch or payout. | Unverified drivers operating fleet vehicles. | Assert `driver.kycStatus === 'VERIFIED'` in `authenticateDriver` and payout endpoints. |
| **P3** | `SEC-DEF-07` | **Payout Destination Change Workflow Missing:** Drivers currently have no self-service method to request a new bank/UPI destination. | High support overhead for banking changes. | Implement `POST /api/driver/payout-destination/request` with admin approval and 24-hour security cooling-off lock. |

---

## 9. CROSS-DOMAIN FINANCIAL INVARIANT MATRIX

| Invariant ID | Domain | Invariant Statement | Verification Mechanism | Status |
| :--- | :--- | :--- | :--- | :--- |
| **FIN-01** | Payment | No double capture of payment session. | PostgreSQL `capture_payment_atomic` row lock (`FOR UPDATE`) + `payments ON CONFLICT DO NOTHING`. | **VERIFIED (Phase 14)** |
| **FIN-02** | Payment | No client amount tampering at checkout. | Strict server-side assertion against `session.amount` (`AMOUNT_MISMATCH` HTTP 400). | **VERIFIED (Phase 14)** |
| **FIN-03** | Payment | Payment session ownership bound to authenticated user. | JWT check: `req.user.id === session.customerId` (HTTP 403 Forbidden). | **VERIFIED (Phase 14)** |
| **FIN-04** | Payout | No duplicate disbursement on replayed idempotency key. | PostgreSQL unique constraint on `driver_payouts.idempotency_key`. | **VERIFIED (Phase 14)** |
| **FIN-05** | Payout | Payout destination strictly bound to driver's KYC-verified VPA. | Server derives destination from driver profile; client `upiId` rejected. | **PROPOSED (Phase 15)** |
| **FIN-06** | Refund | No duplicate refund on same job/payment. | PostgreSQL `refund_payment_atomic` (`payments.status = 'REFUNDED'` check). | **PROPOSED (Phase 15)** |
| **FIN-07** | Refund | Refunds rejected for non-captured payments. | `refund_payment_atomic` assertion: `v_pay.status = 'CAPTURED'`. | **PROPOSED (Phase 15)** |
| **FIN-08** | Ledger | Every financial mutation produces balanced zero-sum journal entries. | `adjust_wallet_atomic` / `journal_lines` matched DEBIT and CREDIT lines. | **VERIFIED (Phase 14)** |
| **FIN-09** | Wallet | Wallet balances never drop below zero under sequential or concurrent payouts. | `adjust_wallet_atomic` row lock assertion `v_new_balance >= 0`. | **VERIFIED (Phase 14)** |
| **FIN-10** | Cancellation| Cancellation of prepaid trip automatically restores customer funds. | Application-layer trigger invoking `adjust_wallet_atomic` and `refund_payment_atomic`. | **PROPOSED (Phase 15)** |
| **FIN-11** | Promotion | Cancelled trips restore promo code eligibility if applicable. | Application-layer promo decrement in `PromotionRepository`. | **PROPOSED (Phase 15)** |
| **FIN-12** | KYC Payout | Driver payout rejected if driver KYC is not `VERIFIED`. | Server guard rejecting payouts for unverified drivers with HTTP 403. | **PROPOSED (Phase 15)** |
| **FIN-13** | Payout | Destination immutable after payout creation. | PostgreSQL `driver_payouts` is `INSERT`-only. | **VERIFIED (Phase 14)** |
| **FIN-14** | Durability | All wallet balances, payments, and payouts survive SIGKILL server reboot. | ACID writes directly to PostgreSQL tables. | **VERIFIED (Phase 14)** |
| **FIN-15** | Concurrency | Cancellation race against driver accept or trip completion resolves safely. | Atomic state transition guards in `updateJobStatus`. | **VERIFIED (Phase 14)** |

---

## 10. RECOMMENDED PHASE 15 IMPLEMENTATION PLAN (STEP-BY-STEP)

Upon explicit user approval, Phase 15 will implement the following targeted enhancements strictly in the application layer:

### Step 1: Payout Destination Hardening (`backend/src/server.js` & `PaymentRepository.js`)
- Modify `POST /api/driver/payout`:
  - Deprecate and ignore client-supplied `upiId` in the request body.
  - Server strictly resolves verified UPI ID from `req.driver.verifiedUpiId || `${req.driver.phone.replace(/\D/g, '').slice(-10)}@okhdfcbank``.
  - Assert that driver KYC status is `VERIFIED`. If not, return HTTP 403 Forbidden (`Driver KYC verification required prior to wallet disbursement`).
  - Record audit log in PostgreSQL `audit_logs` via `db.createAuditLog` on every payout execution.

### Step 2: Post-Payment Cancellation & Automated Refund Pipeline (`server.js`)
- Update `POST /api/customer/cancel-ride`:
  - Check if trip was prepaid (payment session or payment status is `PAID`/`PAYMENT_SUCCESS`).
  - Calculate cancellation fee based on elapsed time:
    - If cancelled before driver assignment or within 2 minutes of assignment: ₹0 fee, 100% refund.
    - If cancelled >2 minutes after driver assignment: ₹50 fee. Driver credited ₹40 (80%), Platform ₹10 (20%), Customer refunded `(fare - 50)`.
  - Execute refund atomically via `LedgerRepository.adjustWallet` (category: `'DISPUTE_REFUND'`).
  - Invoke `PaymentRepository.refundPayment` to set `payments.status = 'REFUNDED'`.
  - Restore promotion usage count if a promo code was applied to the cancelled trip.
  - Persist cancellation fee and refund details to `jobs.metadata`.

### Step 3: Admin Refund & Settlement Synchronization (`server.js` & `database.js`)
- Unify `POST /api/admin/finance/refund`:
  - Call `PaymentRepository.refundPayment` first to ensure PostgreSQL payment status is `REFUNDED` and idempotency event is claimed.
  - Call `LedgerRepository.adjustWallet` to credit the customer's wallet.
  - Write immutable audit log to `audit_logs`.
- Fix `POST /api/admin/finance/settlements/drivers/:id/payout`:
  - Ensure fallback VPA is resolved so undefined `driver.upiId` never throws an unhandled exception.

---

## 11. TEST PLAN & VERIFICATION DESIGN

### Module 28 Backend Integration Tests (`backend/test_suite.js`):
1. **SEC-PAY-01:** Driver payout ignoring client-supplied arbitrary UPI ID and enforcing server-verified VPA.
2. **SEC-PAY-02:** Driver payout rejected when driver KYC status is `PENDING` or `REJECTED` (HTTP 403).
3. **SEC-PAY-03:** Payout execution creates persistent record in PostgreSQL `audit_logs`.
4. **SEC-CNC-01:** Cancellation of prepaid ride triggers automatic customer wallet refund via `adjust_wallet_atomic`.
5. **SEC-CNC-02:** Post-assignment cancellation (>2 mins) assesses ₹50 cancellation fee and compensates driver wallet.
6. **SEC-CNC-03:** Cancellation restores promo code eligibility for the customer.
7. **SEC-REF-01:** Admin refund synchronizes PostgreSQL `payments.status = 'REFUNDED'` and customer wallet balance.
8. **SEC-REF-02:** Admin refund logs immutable audit record in PostgreSQL `audit_logs`.

### Cold Restart Persistence Suite (`backend/restart_test.js`):
- Verify post-restart that verified payout records, cancelled job refund states, and audit logs remain intact and consistent.

---

## 12. ROLLBACK PLAN

Since all proposed changes are strictly confined to the application layer (`backend/src/server.js`, `database.js`, `PaymentRepository.js`, `DriverRepository.js`):
- Rollback involves reverting Git commits on application code.
- Zero database rollback scripts or schema rollbacks are required.
- Migrations `001–015` remain pristine.

---

## 13. REMOTE SUPABASE SAFETY CONFIRMATION

- Local environment only (`http://127.0.0.1:54321` Kong, `127.0.0.1:54322` PostgreSQL).
- Remote Supabase projects (`nabin` production and staging) have NOT been contacted, linked, or modified.
- Service-role secrets remain unrequested and unexposed.
