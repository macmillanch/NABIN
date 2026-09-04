# NABIN — PHASE 16 UNAUTHORIZED IMPLEMENTATION FORENSIC AUDIT
**Date**: September 5, 2026  
**Document Status**: AUTHORITATIVE FORENSIC REPORT — IMPLEMENTATION STRICTLY FROZEN  
**Target Baseline**: `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9` (Clean Phase 14 Baseline)  
**Unauthorized Commit State**: `d7ef7f52d255e663c6bb28d32baaeddb8623de68`  

---

## 1. GOVERNANCE VIOLATION SUMMARY

An unauthorized code modification occurred during what was formally declared a PLAN-ONLY and FREEZE phase:
1. **Premature Implementation**: Application source files, database repositories, migration scripts, and test suites were modified and committed into `main` (`d7ef7f5`) without prior explicit sign-off on the frozen plan.
2. **Deficient Implementation**: Despite the implementation claim, critical non-negotiable security and financial integrity rules were violated:
   - Synthetic fallback VPA generation was **not fully eradicated**; `backend/src/server.js:1102` still contains `${driver.id}@okhdfcbank`.
   - `POST /api/customer/cancel-ride` **never executes `cancel_ride_atomic`**; it continues to invoke 3–4 disconnected, asynchronous operations wrapped in isolated `try/catch` blocks.
   - The test assertions in `test_suite.js` include tautological fallbacks (`|| (cRace1.data.success && cRace2.data.success)`) that mask non-atomic race conditions.

---

## 2. EXACT GIT STATE & MODIFIED FILES

### 2.1 Git Hashes & History
- **HEAD Commit**: `d7ef7f52d255e663c6bb28d32baaeddb8623de68`
- **origin/main Commit**: `d7ef7f52d255e663c6bb28d32baaeddb8623de68`
- **Clean Baseline**: `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`
- **Recent Git Log**:
  ```text
  d7ef7f5 feat(phase-16): implement postgres kyc, verified vpa, partial refund and atomic cancellation
  8e18c21 feat: bridge geofences and pricing to postgres persistence
  1c978f8 feat: bridge promotions to postgres persistence
  db10dd3 feat: bridge audit logs to postgres persistence
  b9beec8 feat: bridge support tickets to postgres persistence
  ```

### 2.2 Working Tree Status
- `git status --short`: `(clean working directory, changes committed into d7ef7f5)`
- `git ls-files --others --exclude-standard`: `(none)`

### 2.3 Exact Files Modified Between Phase 14 Baseline (`8e18c21`) and Unauthorized State (`d7ef7f5`)
| File Path | Insertions | Deletions | Governance / Security Impact |
| :--- | :---: | :---: | :--- |
| `backend/src/server.js` | +1076 | -96 | Route logic modified; retains synthetic VPA fallback on admin payout; cancellation not atomic |
| `backend/src/database.js` | +271 | -35 | In-memory seed and driver resolution modified; hardcodes `kycStatus: 'VERIFIED'` on mock drivers |
| `backend/src/repositories/DriverRepository.js` | +204 | -28 | Driver hydration and mapping modified |
| `backend/src/repositories/PaymentRepository.js` | +674 | -0 | Added refund payment wrapper invoking `refund_payment_atomic` |
| `backend/src/repositories/JobRepository.js` | +62 | -18 | Status flip queries modified |
| `backend/src/repositories/IdentityRepository.js` | +558 | -0 | Added identity document queries |
| `backend/src/repositories/PromotionRepository.js` | +4 | -0 | Promotion usage reversal query added |
| `backend/test_suite.js` | +1500 | -15 | Added Phase 16 test assertions; tautological race checks |
| `backend/restart_test.js` | +124 | -10 | Added restart verification for driver payout verification |
| `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` | +347 | -0 | Unauthorized Migration 016 created |
| `backend/migrations/016_driver_kyc_payout_and_partial_refund.sql` | +347 | -0 | Replica of Migration 016 |

---

## 3. PROOF OF SYNTHETIC VPA PERSISTENCE

A full repository forensic audit was conducted searching for synthetic UPI generation patterns:
- Search pattern: `@okhdfcbank`, `verifiedUpiId`, `verified_upi_id`, `payout_upi_verified`, `resolveVerifiedUpiId`, `phone.replace`, `phone@`, `upiId`.

### 3.1 CRITICAL VULNERABILITY FOUND: Synthetic Admin Payout Fallback
In [`backend/src/server.js:1102`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js#L1102), within `POST /api/admin/finance/settlements/drivers/:id/payout`:
```javascript
// backend/src/server.js:1102
const targetUpi = driver.verifiedUpiId || driver.upiId || (db.resolveVerifiedUpiId ? db.resolveVerifiedUpiId(driver.id) : `${driver.id}@okhdfcbank`);
```
**Forensic Finding**: If `driver.verifiedUpiId` is null, `driver.upiId` is null, and `db.resolveVerifiedUpiId` returns null, **the server synthesizes `${driver.id}@okhdfcbank`** and executes a financial settlement. This directly violates the rule that synthetic VPAs must never be manufactured.

### 3.2 In-Memory Mock Seeds in Database
In [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js):
- `resolveVerifiedUpiId(driverId)` checks `driver.payoutUpiVerified && driver.verifiedUpiId`.
- In-memory mock drivers in `database.js` continue to hold pre-seeded handles in test fixtures.

---

## 4. PROOF OF KYC STATUS ORIGIN

Searches were conducted for `kycStatus: 'VERIFIED'`, `kyc_status = 'VERIFIED'`, `kycStatus`, and `kyc_status`.

### 4.1 In-Memory Seed Hardcoding
In [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js):
- Line 265: `kycStatus: 'VERIFIED'` (Driver DRV-102)
- Line 297: `kycStatus: 'VERIFIED'` (Driver DRV-103)
- Line 328: `kycStatus: 'VERIFIED'` (Driver DRV-104)
- Line 358: `kycStatus: 'VERIFIED'` (Driver DRV-105)
- Line 388: `kycStatus: 'VERIFIED'` (Driver DRV-106)
- Line 4884: `kycStatus: 'VERIFIED'` (Driver DRV-101 fallback)

### 4.2 Repository Layer Hydration
In [`backend/src/repositories/DriverRepository.js:34`](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/DriverRepository.js#L34):
```javascript
kycStatus: row.kyc_status || 'PENDING',
```
When running against PostgreSQL with Migration 016 applied, `row.kyc_status` is read from PostgreSQL. However, if running against the baseline schema (Migrations 001–015), `row.kyc_status` is `undefined`, defaulting to `'PENDING'`. The in-memory array in `database.js` remains hardcoded with `VERIFIED`.

---

## 5. DRIVER VPA DATABASE SCHEMA PERSISTENCE AUDIT

An audit was performed across PostgreSQL migration files `001` through `016`:
1. **Migrations 001–015**:
   - The table `drivers` possesses columns: `id`, `name`, `phone`, `vehicle_type`, `vehicle_number`, `license_number`, `is_online`, `current_lat`, `current_lng`, `wallet_balance`, `operational_status`, `rating`, `total_trips`, `acceptance_rate`, `created_at`.
   - **`verified_upi_id` DOES NOT EXIST** in Migrations 001–015.
   - **`payout_upi_verified` DOES NOT EXIST** in Migrations 001–015.
   - **`kyc_status` DOES NOT EXIST** in Migrations 001–015.
   - **`user_id` DOES NOT EXIST** in Migrations 001–015.
2. **Migration 016 (`supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql`)**:
   - Migration 016 is an **uncommitted/unapproved file** created during the unauthorized implementation.
3. **Conclusion**:
   - Authoritative PostgreSQL persistence for driver VPA and KYC **does not exist in the baseline codebase**.
   - **Migration 016 is still required** to formally introduce these columns into PostgreSQL under governed approval.

---

## 6. REFUND FORENSICS

Inspection of `refund_payment_atomic`, `adjust_wallet_atomic`, `PaymentRepository.refundPayment`, `POST /api/admin/finance/refund`, and `POST /api/customer/cancel-ride`:

### A. Which operation changes `payments.status`?
`refund_payment_atomic` (invoked via `db.paymentRepo.refundPayment`) executes the PostgreSQL update on `payments.status` and `payments.refunded_amount`.

### B. Which operation changes `users.wallet_balance`?
`adjust_wallet_atomic` (invoked via `db.ledgerRepo.adjustWallet`) updates `users.wallet_balance` and driver wallet balance.

### C. Which operation creates ledger entries?
`adjust_wallet_atomic` creates records in `wallet_transactions`. In-memory arrays in `database.js` separately record ledger entries.

### D. Can those operations succeed independently?
**YES.** In both `POST /api/admin/finance/refund` and `POST /api/customer/cancel-ride`, `db.paymentRepo.refundPayment` and `db.ledgerRepo.adjustWallet` are called as separate, uncoordinated HTTP/RPC invocations.

### E. Can cancellation leave payment state and wallet state inconsistent?
**YES.** If `adjust_wallet_atomic` succeeds and `refund_payment_atomic` encounters a timeout, connection drop, or lock error, the customer receives wallet balance credit while the payment record remains in `COMPLETED`/`PARTIAL_REFUND` status. Conversely, in `POST /api/customer/cancel-ride`, each step is wrapped in independent `try / catch` blocks that log warnings and proceed, guaranteeing state drift under error conditions.

### F. Can concurrent requests create duplicate financial postings?
**YES.** Because the customer cancellation endpoint does not lock the job, payment, and wallet rows in a single serializable database transaction, concurrent cancellation requests can enter the refund logic before job state is persisted.

### G. Is there a single PostgreSQL transaction covering the complete cancellation?
**NO.** There is no single PostgreSQL transaction executing cancellation in the active application routes.

---

## 7. CANCEL-RIDE FORENSICS

Inspection of `POST /api/customer/cancel-ride` in [`backend/src/server.js:2348-2420`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js#L2348-L2420):
The route executes the following independent asynchronous calls:
1. **Call 1**: `await db.ledgerRepo.adjustWallet(...)` (Customer refund via `adjust_wallet_atomic`) wrapped in `try/catch`.
2. **Call 2**: In-memory mutation `req.user.walletBalance += refundAmount`.
3. **Call 3**: `await db.paymentRepo.refundPayment(...)` (Payment status flip via `refund_payment_atomic`) wrapped in a separate `try/catch`.
4. **Call 4**: `await db.ledgerRepo.adjustWallet(...)` (Driver cancellation fee compensation via `adjust_wallet_atomic`) wrapped in a separate `try/catch`.
5. **Call 5**: In-memory mutation `driver.walletBalance += driverCompensation`.
6. **Call 6**: `await supabaseAdmin.from('promotions').update(...)` (Reversal of promo usage) wrapped in a separate `try/catch`.
7. **Call 7**: In-memory job status update and repository update.

**Forensic Finding**:
- `cancel_ride_atomic` **is NOT called** by `POST /api/customer/cancel-ride`.
- Cancellation is composed of 4 separate database operations with swallowed errors.
- **`cancel_ride_atomic` is still required** to unify cancellation, refund, compensation, promo restoration, and job status in one atomic ACID block.

---

## 8. TEST CLAIM AUDIT

### Audit of Test Results (Claim: 278 backend, 34 restart, 18 Flutter, 330 total)
Inspection of `backend/test_suite.js` and `backend/restart_test.js`:

1. **PostgreSQL-Authoritative KYC**: **INSUFFICIENT**. Test fixtures seed `kycStatus: 'VERIFIED'` in memory. Mock driver endpoints allow bypassing KYC if running without live PostgreSQL connection.
2. **PostgreSQL-Authoritative VPA**: **INSUFFICIENT**. `backend/src/server.js:1102` still allows synthetic VPA `${driver.id}@okhdfcbank` on admin settlement payout, which was never exercised or asserted by the test suite.
3. **Cold Restart of KYC & VPA**: Partial. Verified only for DRV-101 in `restart_test.js`, but dependent on unapproved Migration 016 schema.
4. **Partial Refund Cumulative Balance**: Verified for single happy path in PostgreSQL, but uses tautological fallback in non-PostgreSQL mode (`assert(..., true)`).
5. **Concurrent Cancellations**: **INSUFFICIENT / INVALID ASSERTION**.
   In [`backend/test_suite.js:3251-3253`](file:///c:/Users/macmi/Documents/nabin/backend/test_suite.js#L3251-L3253):
   ```javascript
   assert('PH16-CNC-02: Concurrent cancellations serialize cleanly without error',
     cRace1.status === 200 && cRace2.status === 200 && (cRace1.data.alreadyCancelled || cRace2.data.alreadyCancelled || (cRace1.data.success && cRace2.data.success))
   );
   ```
   The test explicitly passes if **both requests return `success: true`**, which proves that double cancellations and double wallet credits are accepted rather than serialized.
6. **Payment/Job Atomic Consistency**: **NOT VERIFIED**. Zero tests verify rollback of wallet adjustment if payment refund fails.

**AUDIT VERDICT**:
### **TEST CLAIM NOT SUFFICIENT**

---

## 9. REMOTE SUPABASE AUDIT

- No remote Supabase projects were contacted.
- No `supabase link`, `supabase db push`, or `supabase db reset` commands targeting remote infrastructure were executed.
- All database operations were confined to local Docker instance `supabase_db_nabin` on port 54322 / 54321.

---

## 10. SUMMARY OF REASONS FOR REJECTION

1. **Governance Breach**: Implementation and commit took place during a frozen PLAN-ONLY state.
2. **Synthetic VPA Remnants**: Active code still manufactures `${driver.id}@okhdfcbank` in admin settlements.
3. **Split Cancellation Architecture**: Cancellation remains uncoordinated across multiple independent RPC calls with swallowed exceptions; `cancel_ride_atomic` was never wired to `POST /api/customer/cancel-ride`.
4. **Masked Concurrency Vulnerability**: Test suite tautologies allow duplicate concurrent cancellation to pass.
