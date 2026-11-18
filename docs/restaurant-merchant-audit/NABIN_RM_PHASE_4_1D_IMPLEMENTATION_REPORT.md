# NABIN PHASE 4.1D — RESTAURANT MERCHANT IMPLEMENTATION REPORT
## RM-007: Bank Account, Payout Verification & Settlement Details

**Document ID:** NABIN-RM-PHASE4-1D-REPORT-001  
**Date:** November 18, 2026  
**Authoritative Reviewer:** Senior Flutter & Backend Integration Lead (Kilo Code)  
**Milestone Scope:** RM-007 (Bank Account, Payout Verification & Settlement Details).  

---

## 1. Executive Summary

Phase 4.1D implements a bank settlement onboarding and financial account management workflow for restaurant merchants, fulfilling **RM-007** from the canonical Google Stitch project `6689743337313822856` (`RM-007_bank_and_settlement_details.html`).

This implementation cleanly separates three distinct financial domains:
1. **Merchant Bank Account for Automated Settlement Payouts:** Stored securely with AES-256-GCM encryption, masked numbers, HMAC-SHA256 hashes, and ACH / Penny-drop clearing verification.
2. **Customer-Facing Payment Settings (UPI QR):** Preserved in existing RMS settings (`rms/settings/payments`), keeping customer bill collection completely isolated from private merchant settlement bank accounts.
3. **Platform Settlement Readiness:** Evaluates bank verification status, compliance paperwork (FSSAI/Trade License), and administrative store approval to determine live payout eligibility.

---

## 2. Architecture & Cryptographic Data Model

### A. Database Migration: `058_merchant_bank_accounts.sql`
- **Table:** `public.merchant_bank_accounts`
- **Fields:**
  - `id`: UUID (Primary Key)
  - `merchant_id`: String (Unique per active settlement account)
  - `account_holder_name`: String (Beneficiary legal name)
  - `bank_name`: String (Designated commercial bank)
  - `encrypted_account_number`: Text (AES-256-GCM ciphertext, format: `iv:tag:ciphertext`)
  - `masked_account_number`: String (Safe masked format: `•••• •••• •••• 4910`)
  - `account_number_hash`: String (HMAC-SHA256 hash for duplicate detection)
  - `ifsc_code`: String (IFSC routing code)
  - `branch_name`: String
  - `account_type`: Enum string (`CURRENT`, `SAVINGS`, `OVERDRAFT`)
  - `payout_cadence`: Enum string (`DAILY_T1`, `WEEKLY_CONSOLIDATED`)
  - `cancelled_cheque_document_id`: UUID (Foreign key reference to `merchant_documents.id`)
  - `verification_status`: String (`NOT_SUBMITTED`, `PENDING_VERIFICATION`, `VERIFIED`, `REJECTED`, `ACTION_REQUIRED`)
  - `verification_provider`: String (`PENNY_DROP_ACH`)
  - `verified_at`: Timestamp
  - `metadata`: JSONB
- **Row Level Security (RLS):** Enabled on `public.merchant_bank_accounts`, granted only to `service_role`.

### B. Cryptographic Standard (`FinancialEncryptionService`)
- **Encryption Algorithm:** AES-256-GCM (Authenticated Encryption with Associated Data).
- **Key Derivation:** SHA-256 derived key from `FINANCIAL_ENCRYPTION_KEY` or server secret.
- **Masking:** Preserves only the last 4 digits (e.g. `•••• •••• •••• 4910`). All GET responses return the masked number by default.
- **Zero Plaintext Leakage:** Full account numbers are never logged in console outputs, never sent in GET payloads, and never saved unencrypted.

---

## 3. Separation from Customer UPI QR

| Financial Dimension | Target System / Route | Storage Table | Visibility |
| :--- | :--- | :--- | :--- |
| **Merchant Settlement Payout Account** | `/api/merchant/bank-account` | `merchant_bank_accounts` | Private to Merchant & Admin; AES-256-GCM Encrypted |
| **Customer Bill Payment (UPI QR)** | `/api/merchant/rms/settings/payments` | `restaurant_settings` (`rmsRepo`) | Customer-facing static QR image & counter UPI ID |
| **Driver Payout Rails** | `/api/driver/payout` | `driver_payouts` | Driver instant cashouts |

---

## 4. Backend API Contracts

### A. Register / Save Bank Account
- **Endpoint:** `POST /api/merchant/:restaurantId/bank-account` & `POST /api/merchant/bank-account`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Request:**
  ```json
  {
    "accountHolderName": "Himalayan Flavors Pvt Ltd",
    "bankName": "Nabil Bank Limited",
    "accountNumber": "0124982184910",
    "confirmAccountNumber": "0124982184910",
    "ifscCode": "NBLNPKTM01",
    "branchName": "Durbar Marg Branch",
    "accountType": "CURRENT",
    "payoutCadence": "DAILY_T1"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Merchant bank account registered successfully and pending verification.",
    "bankAccount": {
      "id": "uuid-v4",
      "merchantId": "rest_1",
      "accountHolderName": "Himalayan Flavors Pvt Ltd",
      "bankName": "Nabil Bank Limited",
      "maskedAccountNumber": "•••• •••• •••• 4910",
      "ifscCode": "NBLNPKTM01",
      "branchName": "Durbar Marg Branch",
      "accountType": "CURRENT",
      "payoutCadence": "DAILY_T1",
      "verificationStatus": "PENDING_VERIFICATION",
      "verificationProvider": "PENNY_DROP_ACH"
    }
  }
  ```

### B. Retrieve Bank Account
- **Endpoint:** `GET /api/merchant/:restaurantId/bank-account` & `GET /api/merchant/bank-account`
- **Response (200 OK):** Returns masked account number (`•••• •••• •••• 4910`), verification status, and cadence. Full account number is never exposed.

### C. Update Payout Schedule
- **Endpoint:** `PATCH /api/merchant/:restaurantId/bank-account` & `PATCH /api/merchant/bank-account`
- **Request:** `{ "payoutCadence": "WEEKLY_CONSOLIDATED" }`
- **Response (200 OK):** Updated bank account record.

### D. Settlement Readiness Status
- **Endpoint:** `GET /api/merchant/:restaurantId/settlement-readiness` & `GET /api/merchant/settlement-readiness`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "merchantId": "rest_1",
    "settlementReadiness": {
      "isReady": false,
      "status": "PENDING_VERIFICATION",
      "payoutCadence": "DAILY_T1",
      "bankAccountStatus": "PENDING_VERIFICATION",
      "maskedAccountNumber": "•••• •••• •••• 4910",
      "bankName": "Nabil Bank Limited",
      "checklist": {
        "bankDetailsSubmitted": true,
        "bankVerified": false,
        "fssaiDocumentAttached": true,
        "tradeLicenseAttached": true,
        "merchantApproved": false
      },
      "notice": "Settlement pipeline awaiting verification and store approval."
    }
  }
  ```

---

## 5. Bank Account Verification Strategy

- **Truthful Status Representation:** In strict adherence to project mandates, the platform returns `PENDING_VERIFICATION`. We do not simulate or fabricate immediate penny-drop success in the absence of an active banking API provider.
- **Provider Reference:** Registered as `PENNY_DROP_ACH` with notice that ACH batch verification runs during the scheduled 01:00 AM settlement window.

---

## 6. Files Created & Modified

### Backend:
- `supabase/migrations/058_merchant_bank_accounts.sql` (Created): Migration for `public.merchant_bank_accounts`.
- `backend/src/services/financialEncryptionService.js` (Created): Cryptographic service for AES-256-GCM encryption, masking, and HMAC hashing.
- `backend/src/repositories/MerchantBankAccountRepository.js` (Created): Repository with dual-store and masked DTO projections.
- `backend/src/database.js` (Modified): Registered `merchantBankAccountRepo`.
- `backend/src/server.js` (Modified): Registered bank account and settlement readiness endpoints.
- `backend/test_merchant_bank_settlement.js` (Created): 15 automated backend tests.

### Flutter:
- `mobile/lib/core/network/nabin_api_service.dart` (Modified): Added `saveMerchantBankAccount`, `getMerchantBankAccount`, `getMerchantSettlementReadiness`.
- `mobile/lib/features/restaurant/presentation/screens/restaurant_registration_screen.dart` (Modified): Implemented Step 4 (RM-007) with bank dropdown, mask toggle, confirmation check, cadence selector, cheque card, and penny-drop security callout.
- `mobile/test/restaurant_registration_bank_settlement_test.dart` (Created): Automated widget tests for RM-007.

---

## 7. Test Execution & Evidence

### Backend Automated Test Suite:
```bash
node test_merchant_bank_settlement.js
```
**Output:**
```
=== NABIN PHASE 4.1D — MERCHANT BANK SETTLEMENT TEST SUITE ===
[PASS] encryptAccountNumber and decryptAccountNumber roundtrip correctly
[PASS] maskAccountNumber masks preceding digits and retains last 4
[PASS] hashAccountNumber generates deterministic HMAC-SHA256 hash
[PASS] validateIfsc validates standard and regional clearing codes
[PASS] MerchantBankAccountRepository saves and returns masked bank account
[PASS] POST /api/merchant/bank-account refuses unauthenticated request (401)
[PASS] POST /api/merchant/bank-account refuses confirmation mismatch (400)
[PASS] POST /api/merchant/bank-account refuses invalid IFSC format (400)
[PASS] POST /api/merchant/bank-account registers bank account with masked output (201)
[PASS] POST /api/merchant/:restaurantId/bank-account enforces tenant isolation (403)
[PASS] GET /api/merchant/bank-account returns masked account details
[PASS] GET /api/merchant/bank-account for Merchant B returns NOT_SUBMITTED (tenant isolation)
[PASS] PATCH /api/merchant/bank-account updates payout cadence
[PASS] GET /api/merchant/settlement-readiness returns accurate readiness checklist
[PASS] Separation check: customer UPI QR settings remain isolated from bank payout

=== FINAL RESULTS: 15 passed, 0 failed ===
```

### Flutter Test Suite:
```bash
flutter test test/restaurant_merchant_profile_test.dart test/restaurant_registration_documents_test.dart test/restaurant_registration_bank_settlement_test.dart
```
**Output:**
```
00:04 +18: All tests passed!
```

---

## 8. Stitch Design Comparison

- **Design Reference:** `docs/restaurant-merchant-audit/stitch-html/RM-007_bank_and_settlement_details.html`
- **Verified Business Entity Notice:** Exact match. Shows "VERIFIED BUSINESS ENTITY", "Match Locked" badge, and registered legal name.
- **Designated Commercial Bank Dropdown:** Exact match. Supports commercial banking options with bank iconography.
- **Mask Toggle:** Exact match. Shows `•••• •••• •••• 4910` with interactive eye visibility toggle.
- **Confirmation Match:** Exact match. Shows "Numbers Match" check badge when numbers match.
- **Branch & Routing / IFSC:** Exact match. Displays branch location and formatted routing / IFSC code.
- **Payout Cadence Selector:** Exact match. Daily T+1 (Recommended) vs. Weekly Consolidated with "Zero Fees" tag.
- **Cancelled Cheque Card:** Exact match. Shows thumbnail, filename (`cancelled_cheque_himalayan.png`), size, "File Verified" badge, and view action.
- **Penny-Drop Security Box:** Exact match. Displays ₹1 test deposit penny-drop callout.
- **Submit CTA:** Exact match. "Submit Application for Review" with "256-bit Bank Grade Encrypted Settlement Pipeline" lock icon.

---

## 9. Known Limitations

- Direct automated penny-drop execution requires live integration with an Indian banking clearing partner (e.g. RazorpayX, Cashfree Payouts, or bank-direct API); accounts remain in `PENDING_VERIFICATION` until verified by the platform settlement operator.

---

## 10. Git Checkpoint & Remote Synchronization

- **Branch:** `main`
- **Committed Files:** Migration 058, encryption service, bank account repository, server endpoints, Flutter network methods, updated registration screen, test files, and report.

*End of Phase 4.1D Implementation Report.*
