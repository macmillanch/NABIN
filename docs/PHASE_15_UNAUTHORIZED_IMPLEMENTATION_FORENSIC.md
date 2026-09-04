# NABIN — PHASE 15 UNAUTHORIZED IMPLEMENTATION FORENSIC AUDIT REPORT
**Audit Timestamp**: September 5, 2026  
**Audit Status**: STRICT READ-ONLY FORENSIC FREEZE — NO CODE MUTATIONS PERFORMED  
**Clean Baseline Target**: Commit `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`  
**Current Worktree Commit**: Commit `d7ef7f52d255e663c6bb28d32baaeddb8623de68`  

---

## MANDATORY GOVERNANCE DECLARATIONS

> **PHASE 15 EXECUTION REPORT REJECTED FOR ACCEPTANCE.**

> **No corrective implementation was performed during this forensic phase.**

---

## 1. EXECUTIVE SUMMARY

Implementation activities commenced and were committed into `main` (`d7ef7f5`) following a phase that was explicitly designated as PLAN-ONLY and subject to a strict freeze.

This forensic audit confirms:
1. **Governance Breach**: 18 files were modified or added (3,648 insertions and 201 deletions in core backend/test files alone) without prior explicit sign-off on a finalized implementation plan.
2. **Persistent Synthetic VPA**: The unauthorized implementation failed to eradicate synthetic VPA generation; [`backend/src/server.js:1102`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js#L1102) actively manufactures `${driver.id}@okhdfcbank` during administrative settlement payouts.
3. **Fragmented Cancellation Operations**: Ride cancellation in `POST /api/customer/cancel-ride` remains split into 4 uncoordinated asynchronous database mutations wrapped in isolated `try/catch` blocks. The transactional RPC `cancel_ride_atomic` was never wired to the active endpoint.
4. **Duplicate Accounting Pipeline**: Admin refunds write financial events to both `public.ledger_entries` (via `refund_payment_atomic`) and `public.journal_transactions` / `public.journal_lines` (via `adjust_wallet_atomic`).
5. **Masked Test Failures**: Test assertions in Module 28 and 29 use tautological clauses (such as `|| (cRace1.data.success && cRace2.data.success)`) that pass even when duplicate financial effects occur simultaneously.

---

## 2. EXACT GIT STATE

### 2.1 Commit Identification
- **HEAD Commit**: `d7ef7f52d255e663c6bb28d32baaeddb8623de68`
- **origin/main Commit**: `d7ef7f52d255e663c6bb28d32baaeddb8623de68`
- **HEAD == origin/main**: **YES** (The unauthorized changes were committed directly to `main`).
- **Clean Phase 14 Baseline**: `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`

### 2.2 Working Tree Status
```text
$ git status --short
?? docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md

$ git diff --stat
(no unstaged tracked modifications)
```

### 2.3 Exact Modified Files Between Baseline `8e18c21` and HEAD `d7ef7f5`
| File Path | Insertions | Deletions | Type |
| :--- | :---: | :---: | :--- |
| `backend/src/server.js` | +1076 | -96 | Core Application Server |
| `backend/src/database.js` | +271 | -35 | In-Memory Database / State Manager |
| `backend/src/repositories/DriverRepository.js` | +204 | -28 | Driver Entity Repository |
| `backend/src/repositories/PaymentRepository.js` | +674 | -0 | Payment / Payout Repository |
| `backend/src/repositories/IdentityRepository.js` | +558 | -0 | Identity Document Repository |
| `backend/src/repositories/JobRepository.js` | +62 | -18 | Trip / Order State Repository |
| `backend/src/repositories/PromotionRepository.js` | +4 | -0 | Promotional Counter Repository |
| `backend/test_suite.js` | +1500 | -15 | Automated System Test Suite |
| `backend/restart_test.js` | +124 | -10 | Cold-Restart Integrity Suite |
| `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` | +347 | -0 | Unauthorized Migration 016 |
| `backend/migrations/016_driver_kyc_payout_and_partial_refund.sql` | +347 | -0 | Replica Migration 016 |
| `docs/PHASE_10_IDENTITY_KYC_PERSISTENCE_AUDIT.md` | +622 | -0 | Documentation |
| `docs/PHASE_12_DOMAIN_READINESS_AUDIT.md` | +297 | -0 | Documentation |
| `docs/PHASE_13_PAYMENTS_PAYOUTS_BOOKING_SECURITY.md` | +169 | -0 | Documentation |
| `docs/PHASE_14_FINANCIAL_INTEGRITY_AUDIT.md` | +156 | -0 | Documentation |
| `docs/PHASE_15_AUTHORIZATION_PAYOUT_CANCELLATION_AUDIT.md` | +300 | -0 | Documentation |
| `docs/PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md` | +356 | -0 | Documentation |
| `docs/PHASE_16_IMPLEMENTATION_PLAN.md` | +613 | -0 | Implementation Plan |

**Integrity Verification of Historical Migrations**:
`git diff 8e18c21 HEAD -- supabase/migrations/001_*.sql ... 015_*.sql` produced 0 output. Migrations 001–015 remain byte-for-byte unmodified.

---

## 3. UNAUTHORIZED CHANGES

The unauthorized commit `d7ef7f5` introduced:
1. Creation of Migration 016 (`supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql`).
2. Modifications to `DriverRepository.js` to map `row.verified_upi_id`, `row.payout_upi_verified`, `row.kyc_status`.
3. Modifications to `PaymentRepository.js` to add `recordDriverPayout` and `refundPayment`.
4. Modifications to `server.js` adding `/api/driver/payout`, `/api/driver/payout-destination`, `/api/admin/drivers/:id/verify-payout-destination`, and altering cancellation/refund routes.
5. Modules 28 and 29 added to `backend/test_suite.js`.

---

## 4. SYNTHETIC VPA FINDINGS [CLASSIFICATION: P0 — CRITICAL]

### 4.1 Active Synthetic Payout Route in Production Path
In [`backend/src/server.js:1102`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js#L1102):
```javascript
app.post('/api/admin/finance/settlements/drivers/:id/payout', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  const driver = db.getDriver(req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });
  const amount = Number(req.body.amount) || driver.walletBalance;

  const targetUpi = driver.verifiedUpiId || driver.upiId || (db.resolveVerifiedUpiId ? db.resolveVerifiedUpiId(driver.id) : `${driver.id}@okhdfcbank`);
  const result = await db.recordPayout(driver.id, amount, targetUpi);
```
**Forensic Analysis**:
If `driver.verifiedUpiId` is null, `driver.upiId` is null, and `db.resolveVerifiedUpiId` returns null, the route constructs:
`${driver.id}@okhdfcbank` (e.g. `DRV-101@okhdfcbank`).
This is a **synthetic, unverified VPA manufactured by the server** and passed directly to `db.recordPayout`.

### 4.2 In-Memory Mock Seeds
In [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js):
- Drivers DRV-102 through DRV-106 and mock fixtures contain hardcoded UPI handles and simulated verification flags.
- `resolveVerifiedUpiId(driverId)` checks in-memory object properties without validating against PostgreSQL schema constraints if the repository is disconnected.

---

## 5. KYC AUTHORITY FINDINGS [CLASSIFICATION: P0 — CRITICAL]

### 5.1 Database Schema Gap in Baseline Migrations
Across Migrations 001–015:
- Table `public.drivers` contains columns: `id`, `name`, `phone`, `vehicle_type`, `vehicle_number`, `license_number`, `is_online`, `current_lat`, `current_lng`, `wallet_balance`, `operational_status`, `rating`, `total_trips`, `acceptance_rate`, `created_at`.
- **`kyc_status` DOES NOT EXIST** in PostgreSQL under Migrations 001–015.
- **`verified_upi_id` DOES NOT EXIST** in PostgreSQL under Migrations 001–015.
- **`user_id` DOES NOT EXIST** in `drivers` under Migrations 001–015.

### 5.2 Hardcoded Memory Fallbacks
In [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js):
- Lines 265, 297, 328, 358, 388, 4884 hardcode `kycStatus: 'VERIFIED'`.
- In `DriverRepository.js:34`: `kycStatus: row.kyc_status || 'PENDING'`. In baseline mode where the column does not exist, `row.kyc_status` returns `undefined`, falling back to in-memory mocks.

### 5.3 Driver Linkage and Operational Access
In the baseline `8e18c21`, `authenticateDriver` did not check `driver.userId`. An unlinked legacy driver could:
- Authenticate via Bearer token
- Toggle online
- Access dashboard
- Accept dispatches and complete trips
The unauthorized changes added a check in `authenticateDriver`, but this check was implemented without authorization during the freeze.

---

## 6. PAYOUT SECURITY FINDINGS [CLASSIFICATION: P0 — CRITICAL]

Audit of `POST /api/driver/payout`:
- **A. Is client-supplied `upiId` ignored?** YES, in `POST /api/driver/payout` lines 2813-2820, client `upiId` is ignored in favor of `verifiedUpi`. However, in `POST /api/admin/finance/settlements/drivers/:id/payout` (line 1102), client/fallback VPA is used.
- **B. Where does the final payout VPA come from?** In driver payout, it comes from `db.resolveVerifiedUpiId()`, which inspects `driver.verifiedUpiId`.
- **C. Is that VPA PostgreSQL-authoritative?** NO, unless Migration 016 is applied and active. In baseline migrations 001–015, the column does not exist in PostgreSQL.
- **D. Is it actually verified?** NO external banking or NPCI validation exists. It is set via admin manual endpoint or mock script.
- **E. Can a driver substitute another driver's VPA?** Blocked by route IDOR check (`req.driver.id !== driverId`), but bypassable if admin route is used.
- **F. Can an arbitrary phone-derived VPA be used?** In admin settlement, `${driver.id}@okhdfcbank` is used as a fallback.
- **G. Does payout require VERIFIED KYC?** The application checks `driver.kycStatus === 'VERIFIED'`, but because in-memory seed drivers are hardcoded to `VERIFIED`, this check passes on fake data.
- **H. Is payout destination ownership actually established?** NO.
- **I. Is the immutable `driver_payouts` snapshot correct?** Partial. If `adjust_wallet_atomic` succeeds and `driver_payouts` insert fails, a compensating reversal is attempted in Node.js instead of within a single database transaction.
- **J. Is the payout operation idempotent?** Idempotency key is accepted, but idempotency is evaluated at the application repository level rather than unified DB constraint.
- **K. Can concurrent payout requests duplicate settlement?** Yes, because wallet debit and payout insertion are separate asynchronous steps.

---

## 7. REFUND / PAYMENT FINDINGS [CLASSIFICATION: P0 — CRITICAL]

Audit of `refund_payment_atomic`, `adjust_wallet_atomic`, `PaymentRepository.refundPayment`, `POST /api/admin/finance/refund`, and `POST /api/customer/cancel-ride`:

### 7.1 Split Transactional Boundary
In `POST /api/admin/finance/refund`:
1. Step 1: `await db.paymentRepo.refundPayment(...)` executes `refund_payment_atomic` in PostgreSQL.
2. Step 2: `await db.ledgerRepo.adjustWallet(...)` executes `adjust_wallet_atomic` in PostgreSQL.
These are **two distinct PostgreSQL transactions**.
If Step 1 succeeds and Step 2 fails (network glitch, process crash, unhandled error), the payment is marked `REFUNDED` in PostgreSQL, but the customer's wallet balance is never credited.

### 7.2 Partial Refund Defect in Baseline Migration 006
In baseline `006_payments_domain.sql:260-270`:
```sql
IF p_declared_amount IS NOT NULL AND p_declared_amount <> v_pay.amount THEN
    RETURN json_build_object('success', false, 'code', 'REFUND_AMOUNT_MISMATCH');
END IF;
```
Any partial refund (e.g. fare minus cancellation fee) is **aborted with `REFUND_AMOUNT_MISMATCH`**.

---

## 8. CANCELLATION TRANSACTION FINDINGS [CLASSIFICATION: P0 — CRITICAL]

Audit of `POST /api/customer/cancel-ride` in [`backend/src/server.js:2348-2420`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js#L2348-L2420):
The route executes the following sequence:
1. `await db.ledgerRepo.adjustWallet(...)` (Customer wallet credit) wrapped in `try/catch`.
2. In-memory mutation: `req.user.walletBalance += refundAmount`.
3. `await db.paymentRepo.refundPayment(...)` (Payment status update) wrapped in `try/catch`.
4. `await db.ledgerRepo.adjustWallet(...)` (Driver compensation) wrapped in `try/catch`.
5. In-memory mutation: `driver.walletBalance += driverCompensation`.
6. `await supabaseAdmin.from('promotions').update(...)` (Reversal of promo counter) wrapped in `try/catch`.
7. In-memory job state update and repository call.

**Key Forensic Conclusions**:
- **`cancel_ride_atomic` is NOT invoked.** The RPC defined in Migration 016 is completely bypassed.
- If any step fails, errors are caught with `console.warn`, leaving customer funds, driver compensation, and payment status in an unreconciled, permanent split-state.
- Concurrent cancellation requests race freely, enabling duplicate wallet adjustments.

---

## 9. LEDGER DUPLICATION FINDINGS [CLASSIFICATION: P0 — CRITICAL]

During an admin refund:
1. `refund_payment_atomic` inserts into `public.ledger_entries` (Migration 006).
2. `adjust_wallet_atomic` inserts into `public.journal_transactions` AND `public.journal_lines` (Migration 007).
3. `server.js:1257` inserts into `db.ledgerEntries` (in-memory).
4. `server.js:1243` inserts into `db.transactions` (in-memory).

This results in **simultaneous double-posting across two different PostgreSQL ledger schemas** (`ledger_entries` vs `journal_transactions/lines`) for the same financial event.

---

## 10. ADMIN AUTHORIZATION FINDINGS [CLASSIFICATION: P1 — HIGH]

In baseline `8e18c21`:
- Line 811: `app.post('/api/admin/drivers/:id/status', authenticateAdmin, async (req, res) => ...`
  (Lacks `requirePermission('fleet.manage')`).
- Line 2010: `app.post('/api/admin/drivers/:id/status', authenticateAdmin, requirePermission('fleet.manage'), ...`

Because Express resolves routes in registration order, **Route 1 shadowed Route 2**, allowing any admin without `fleet.manage` permissions to alter driver operational status. The unauthorized commit deleted the shadow route, but this change was made prematurely without sign-off.

---

## 11. AUDIT LOGGING FINDINGS [CLASSIFICATION: P1 — HIGH]

- **Driver Payout**: In `PaymentRepository.js:590`, `this.db.createAuditLog(...)` is invoked **without `await`**, creating an unhandled floating Promise that can crash the worker or fail silently.
- **Cancellation Compensation**: Zero audit logging is performed for driver cancellation compensation.
- **Admin Refund & KYC Changes**: Awaited and recorded into `public.audit_logs`.

---

## 12. TEST VALIDITY FINDINGS [CLASSIFICATION: P1 — HIGH]

Audit of claimed 330 tests (Modules 28 & 29):
1. **`SEC-PAY-01b`**: Proves only that `poRows[0].upi_id === 'rajesh@okhdfcbank'`. Passes solely because `rajesh@okhdfcbank` was hardcoded in memory seed fixtures.
2. **`SEC-PAY-02`**: KYC rejection passes because memory fixtures allow toggling in-memory flags; does not prove PostgreSQL row authority.
3. **`PH16-CNC-02` (Concurrency Assertion)**:
   ```javascript
   assert('PH16-CNC-02: Concurrent cancellations serialize cleanly without error',
     cRace1.status === 200 && cRace2.status === 200 && (cRace1.data.alreadyCancelled || cRace2.data.alreadyCancelled || (cRace1.data.success && cRace2.data.success))
   );
   ```
   The assertion includes `|| (cRace1.data.success && cRace2.data.success)`. If two simultaneous cancellation requests both succeed and process duplicate refunds, **the test passes anyway**.
4. **Offline / Fallback Assertions**: When running without live PostgreSQL, `test_suite.js` executes `assert('...', true)` on lines 2902, 2933, 3092, 3106, 3150, 3186.

**Verdict**: **TEST CLAIM NOT SUFFICIENT.**

---

## 13. MIGRATION 016 REQUIREMENT ASSESSMENT

Based on direct inspection of PostgreSQL schema files `001` through `015`:
1. `drivers` lacks `kyc_status`, `verified_upi_id`, `payout_upi_verified`, `user_id`.
2. `payments` lacks `refunded_amount` and partial refund support.
3. No transactional procedure exists for ride cancellation (`cancel_ride_atomic`).

**Determination**:
**Migration 016 IS STRICTLY REQUIRED.** Application memory modifications cannot substitute for PostgreSQL schema authority and transactional procedures.

---

## 14. RECOMMENDED CORRECTIVE ARCHITECTURE (PLAN-ONLY)

When implementation is formally authorized:
1. **Schema Authority (Migration 016)**:
   - Add required columns to `drivers` (`kyc_status`, `verified_upi_id`, `payout_upi_verified`, `user_id`).
   - Add `refunded_amount` to `payments`.
   - Upgrade `refund_payment_atomic` to support partial refunds with cumulative balance validation.
   - Implement `cancel_ride_atomic` to encapsulate wallet credit, payment refund, driver compensation, promo reversal, and job status in a single database transaction.
2. **Eradicate Synthetic VPA**:
   - Delete `${driver.id}@okhdfcbank` in `server.js:1102`. Payout must fail closed (`HTTP 403 VPA_NOT_VERIFIED`) if no verified destination exists.
3. **Single Ledger Writer**:
   - Designate `journal_transactions` / `journal_lines` (or `ledger_entries`) as the sole financial sink, eliminating multi-table double writes.
4. **Strict Concurrency Testing**:
   - Rewrite `PH16-CNC-02` to strictly verify that only ONE cancellation succeeds (`data.success === true`) and the other is rejected (`data.alreadyCancelled === true`).

---

## 15. EXACT FILES REQUIRING CHANGES AFTER FORMAL APPROVAL

1. `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` (Formally introduced and verified)
2. `backend/src/server.js` (Eradicate synthetic VPA in line 1102; wire `cancel_ride_atomic` to `/api/customer/cancel-ride`; fix audit log awaiting)
3. `backend/src/database.js` (Align mock seeds with fail-closed defaults; remove synthetic VPA resolvers)
4. `backend/src/repositories/DriverRepository.js` (PostgreSQL-authoritative hydration)
5. `backend/src/repositories/PaymentRepository.js` (Ensure awaited audit logs and transactional payout persistence)
6. `backend/test_suite.js` (Remove tautological race assertions; assert true DB state)
7. `backend/restart_test.js` (Verify cold restart against live PostgreSQL)

---

## 16. EXPLICIT LIST OF PROHIBITED ACTIONS

1. MUST NOT manufacture synthetic VPAs (`phone@okhdfcbank`, `driverId@okhdfcbank`, or arbitrary format strings).
2. MUST NOT allow unlinked drivers (`drivers.user_id IS NULL`) to receive payouts or dispatch.
3. MUST NOT execute customer cancellation through multiple uncoordinated RPC calls.
4. MUST NOT write duplicate ledger entries to both `ledger_entries` and `journal_transactions`.
5. MUST NOT use tautological assertions in test suites.
6. MUST NOT contact or run commands against remote Supabase projects.
7. MUST NOT commit, push, reset, or modify code until an authoritative implementation plan is explicitly approved.
