# NABIN PHASE 4.1C — RESTAURANT MERCHANT IMPLEMENTATION REPORT
## RM-006: Business Documents and Secure Upload Management

**Document ID:** NABIN-RM-PHASE4-1C-REPORT-001  
**Date:** November 18, 2026  
**Authoritative Reviewer:** Senior Flutter & Backend Integration Lead (Kilo Code)  
**Milestone Scope:** RM-006 (Business Documents & Secure Compliance Upload Management).  

---

## 1. Executive Summary

Phase 4.1C delivers real binary document uploads and secure tenant-isolated storage for restaurant merchant compliance documents, faithfully implementing **RM-006** from the canonical Google Stitch project `6689743337313822856` (`RM-006_business_documents.html`).

Prior to Phase 4.1C, the platform only accepted text numbers for FSSAI licenses. Phase 4.1C introduces private document storage in Supabase Storage (`merchant-documents` bucket), backed by binary magic number verification, strict MIME and extension validation, 10MB file size limits, short-lived signed URLs, SHA-256 checksums, and tenant-isolated PostgreSQL metadata (`public.merchant_documents`). Newly registered merchants with `approval_status = 'PENDING'` are fully authorized to upload and review their compliance documents without encountering unapproved-account route blocks.

---

## 2. Architecture & Data Flow

```mermaid
flowchart TD
    Client["Flutter Client (RestaurantRegistrationScreen)"] -->|POST /api/merchant/documents (Base64)| API["Express Backend (server.js)"]
    API -->|1. Validate Auth & Tenant| Guard["resolveMediaCaller / mediaTargetStore"]
    API -->|2. Sniff Magic Bytes & Validate (<=10MB)| Validator["MerchantDocumentStorageService"]
    Validator -->|3. Upload to Private Bucket| Storage["Supabase Storage ('merchant-documents')"]
    API -->|4. Persist Metadata + SHA-256| DB["PostgreSQL / PGlite (merchant_documents)"]
    API -->|5. Return Doc + Short-Lived Signed URL| Client
```

1. **Client Interaction:** The merchant interacts with the RM-006 compliance wizard step, reviewing attached FSSAI and PAN/VAT credentials and capturing/uploading their Restaurant Trade License.
2. **Authentication & Tenant Guard:** Handled via `resolveMediaCaller` and `mediaTargetStore`. Caller must have role `MERCHANT` and own the target store. Pending merchants (`approval_status = 'PENDING'`) are explicitly permitted to upload and view onboarding documents.
3. **Binary Content Inspection:** Binary magic numbers are parsed directly from file buffers (`%PDF-`, `FF D8 FF`, `89 50 4E 47`). Mismatches between declared MIME and true file signatures are rejected with 400 `MIME_TYPE_MISMATCH` or `INVALID_FILE_SIGNATURE`.
4. **Private Storage:** Uploaded into `merchant-documents` under predictable, tenant-isolated paths:
   `merchants/{merchantId}/documents/{docType}_{timestamp}_{nonce}.{ext}`
5. **Durable Tracking:** Saved in `public.merchant_documents` with document number, SHA-256 checksum, file size, MIME type, and `PENDING_REVIEW` status.
6. **Zero Public Access:** Documents cannot be read publicly. Viewing is permitted only through short-lived signed URLs (900 seconds) or authenticated backend streaming.

---

## 3. Files Created & Modified

### Backend:
- `supabase/migrations/057_merchant_compliance_documents.sql` (Created): Defines `public.merchant_documents` table, indices, check constraints, and RLS.
- `backend/src/services/merchantDocumentStorageService.js` (Created): Secure storage adapter for private compliance documents with buffer sniffing and signed URLs.
- `backend/src/repositories/MerchantDocumentRepository.js` (Created): Dual-store repository for document metadata with in-memory fallback.
- `backend/src/database.js` (Modified): Registered `merchantDocumentRepo`.
- `backend/src/server.js` (Modified): Implemented REST endpoints for upload, listing, streaming, and withdrawal.
- `backend/test_merchant_compliance_documents.js` (Created): Comprehensive test suite (18 automated tests).

### Flutter:
- `mobile/lib/core/network/nabin_api_service.dart` (Modified): Added `uploadMerchantDocument`, `getMerchantDocuments`, `deleteMerchantDocument`.
- `mobile/lib/features/restaurant/presentation/screens/restaurant_registration_screen.dart` (Modified): Implemented RM-006 Step 3 with FSSAI, PAN/VAT, and Trade License upload workflows, plus responsive overflow hardening.
- `mobile/test/restaurant_registration_documents_test.dart` (Created): Widget tests verifying RM-006 layout, drop zone interaction, and document attachment states.

---

## 4. API Contracts

### A. Upload Document
- **Endpoint:** `POST /api/merchant/:restaurantId/documents` and `POST /api/merchant/documents`
- **Headers:** `Authorization: Bearer <jwt_or_session_token>`, `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "documentType": "TRADE_LICENSE",
    "documentNumber": "TRD-KTM-2024-883",
    "expiryDate": "12 / 2026",
    "filename": "trade_license.pdf",
    "fileData": "data:application/pdf;base64,JVBERi0xLjQK...",
    "mimeType": "application/pdf"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Compliance document uploaded successfully and pending verification.",
    "document": {
      "id": "uuid-v4",
      "merchantId": "rest_1",
      "documentType": "TRADE_LICENSE",
      "documentNumber": "TRD-KTM-2024-883",
      "storageBucket": "merchant-documents",
      "storagePath": "merchants/rest_1/documents/trade_license_1731950000_a1b2.pdf",
      "originalFilename": "trade_license.pdf",
      "mimeType": "application/pdf",
      "fileSizeBytes": 184320,
      "fileHashSha256": "3a7b...",
      "status": "PENDING_REVIEW",
      "expiryDate": "12 / 2026",
      "viewUrl": "/api/merchant/documents/stream?path=..."
    }
  }
  ```

### B. List Documents
- **Endpoint:** `GET /api/merchant/:restaurantId/documents` and `GET /api/merchant/documents`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "merchantId": "rest_1",
    "count": 1,
    "documents": [ ... ]
  }
  ```

### C. Retrieve / Stream Document
- **Endpoint:** `GET /api/merchant/documents/:documentId?stream=true`
- **Response (200 OK):** Binary stream with `Content-Type` matching document and `Content-Disposition: inline`.

### D. Delete / Withdraw Document
- **Endpoint:** `DELETE /api/merchant/documents/:documentId`
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Compliance document withdrawn and deleted successfully.",
    "documentId": "uuid-v4"
  }
  ```

---

## 5. Security & Verification Evidence

1. **Tenant Isolation:** Merchant A cannot read, list, replace, or delete documents belonging to Merchant B. Verified via automated tests:
   - `deleteDocument refuses cross-tenant deletion attempt` (Passed).
   - `POST /api/merchant/:restaurantId/documents enforces tenant isolation (403)` (Passed).
   - `GET /api/merchant/documents for Merchant B returns empty list (tenant isolation)` (Passed).
2. **Buffer Magic Sniffing:** Files disguised with fake extensions (e.g. `.pdf` containing executable bytes) are strictly rejected with 400 `INVALID_FILE_SIGNATURE`.
3. **Size Limit Clamping:** Payloads > 10MB are rejected with 413 `FILE_TOO_LARGE`.
4. **Pending Merchant Onboarding:** Newly registered merchants with `approval_status = 'PENDING'` can upload documents without encountering `requireMerchantApproved` 403 blocks.
5. **Zero Public Leakage:** Private bucket configuration, short-lived signed URLs, and no service-role key exposed in client bundles.

---

## 6. Test Commands & Observed Outputs

### Backend Tests:
```bash
node test_merchant_compliance_documents.js
```
**Output:**
```
=== NABIN PHASE 4.1C — MERCHANT COMPLIANCE DOCUMENTS TEST SUITE ===
[PASS] detectBufferMime accurately detects PDF
[PASS] detectBufferMime accurately detects JPEG
[PASS] detectBufferMime accurately detects PNG
[PASS] detectBufferMime rejects arbitrary text or executable bytes
[PASS] validateBuffer throws on oversized payload (> 10MB)
[PASS] validateBuffer throws on invalid file extension
[PASS] validateBuffer throws on MIME type mismatch
[PASS] uploadDocument uploads valid PDF and generates private path
[PASS] deleteDocument refuses cross-tenant deletion attempt
[PASS] MerchantDocumentRepository saves and queries documents tenant-isolated
[PASS] POST /api/merchant/documents refuses unauthenticated request (401)
[PASS] POST /api/merchant/documents uploads PDF for pending merchant (201)
[PASS] POST /api/merchant/documents refuses invalid document type (400)
[PASS] POST /api/merchant/:restaurantId/documents enforces tenant isolation (403)
[PASS] GET /api/merchant/documents returns uploaded documents with signed URLs
[PASS] GET /api/merchant/documents for Merchant B returns empty list (tenant isolation)
[PASS] GET /api/merchant/documents/:documentId returns document and streams binary
[PASS] DELETE /api/merchant/documents/:documentId withdraws document (200)

=== FINAL RESULTS: 18 passed, 0 failed ===
```

### Flutter Tests:
```bash
flutter test test/restaurant_merchant_profile_test.dart test/restaurant_registration_documents_test.dart
```
**Output:**
```
00:04 +16: All tests passed!
```

---

## 7. Stitch Design Comparison

- **Design Reference:** `docs/restaurant-merchant-audit/stitch-html/RM-006_business_documents.html`
- **FSSAI Card:** Exact match. Shows Licence/Registration No. (`10021022000492`), Expiry Date (`12 / 2026`), attached file card (`fssai_cert_2024.pdf`), size (`2.4 MB`), and "Attached" badge.
- **PAN / VAT Card:** Exact match. Displays PAN/VAT number (`609123849`), "Tax Portal Synced", and verified thumbnail preview.
- **Trade License Card:** Exact match. Registration Number field (`TRD-KTM-2024-883`), upload drop-zone (Camera / Files up to 10MB), and real upload state transitions.
- **Why is this required? Callout:** Exact text and icon styling rendered.
- **Touch Targets & Typography:** Royal Blue `#1A3BA2`, Inter typography, minimum 48dp touch targets across mobile, tablet, and desktop viewports.

---

## 8. Known Limitations

- Optical Character Recognition (OCR) and automated barcode/QR validation are mocked/simulated on upload; real document intake is routed to the human operator admin verification queue (`PENDING_REVIEW`).

---

## 9. Git Status & Checkpoint

- **Branch:** `main`
- **Files Staged & Committed:** Migration 057, backend storage service, repository, server routes, Flutter API service, Flutter registration screen, test suites, and implementation report.

*End of Phase 4.1C Implementation Report.*
