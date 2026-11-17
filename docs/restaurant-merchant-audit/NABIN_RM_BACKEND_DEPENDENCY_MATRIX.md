# NABIN RESTAURANT MERCHANT — BACKEND DEPENDENCY MATRIX
## Technical Contract, Database Entities, API Endpoints & Service Dependencies

**Document ID:** NABIN-RM-BACKEND-007  
**Date:** November 18, 2026  
**Auditor Roles:** Backend Integration Architect, Database Engineer, Flutter Solution Architect  
**Underlying Architecture:** Node.js/TypeScript REST APIs (`backend/`), Supabase PostgreSQL, Realtime WebSockets  

---

## 1. BACKEND ARCHITECTURE & STATUS TAXONOMY

This matrix maps every functional capability of the **NABIN Restaurant Merchant (RMS + KDS)** to its backend contracts, categorizing readiness as:
* **`VERIFIED`**: Exists in repository, backed by live routes and database migrations, tested with passing automated tests.
* **`EXISTING_UNVERIFIED`**: Code or table exists in repository but requires end-to-end integration test execution.
* **`REQUIRED_MISSING`**: Endpoint or database column needed for advanced features not yet implemented in backend.
* **`EXTERNAL_REQUIRED`**: Relies on third-party provider (e.g. SMS gateway, Penny-Drop banking API).
* **`FUTURE_SCOPE`**: Slated for multi-outlet expansion.

---

## 2. TWELVE CORE FUNCTIONAL DOMAINS DEPENDENCY MATRIX

| # | Domain | Required Backend Contract | Database Entity / Table | Current Status | Operational Notes |
|---|---|---|---|:---:|---|
| **1** | **OTP Authentication** | `POST /api/auth/merchant/otp-request`<br>`POST /api/auth/merchant/otp-verify` | `merchants`, `auth.users` | **VERIFIED** | Live in `server.js`. Phone auth returns JWT session and merchant UUID. |
| **2** | **Merchant Verification** | `POST /api/merchant/onboard`<br>`GET /api/merchant/status` | `merchants.status`<br>`('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')` | **VERIFIED** | Status transitions enforce strict RBAC; unapproved merchants cannot access live orders. |
| **3** | **Document Storage** | `POST /api/merchant/documents/upload` | Supabase Storage bucket `merchant-documents` | **VERIFIED** | Stores FSSAI, GSTIN, PAN PDFs and images. RLS ensures strict merchant ownership. |
| **4** | **Bank Verification** | `POST /api/merchant/bank/verify` | `merchant_bank_accounts`<br>`('is_verified', 'ifsc', 'account_no')` | **EXTERNAL_REQUIRED** | Bank details storage is verified; automated ₹1 penny-drop API requires Cashfree/Razorpay integration. Fallback: manual admin approval. |
| **5** | **Order Lifecycle** | `GET /api/restaurant/orders`<br>`POST /api/restaurant/orders/:id/accept`<br>`POST /api/restaurant/orders/:id/reject`<br>`POST /api/restaurant/orders/:id/ready`<br>`POST /api/restaurant/orders/:id/handover` | `orders`<br>`('RECEIVED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED')` | **VERIFIED** | Backed by `OrderRepository.js` and tested in `test_rms_e2e_integration.js` & `restaurant_kds_orders_test.dart`. |
| **6** | **KDS Station Routing** | `GET /api/restaurant/stations`<br>`POST /api/restaurant/stations/route` | `kitchen_stations`<br>`orders.assigned_station` | **REQUIRED_MISSING** | Currently, KDS reads all orders in a single stream. Station routing (Wok, Tandoor, Bar) can be filtered client-side via category in Phase 1. |
| **7** | **Printer Jobs & Spooler**| `POST /api/restaurant/print-jobs`<br>`GET /api/restaurant/printers` | `merchant_printers`<br>`print_jobs` | **REQUIRED_MISSING** (Backend) / **CLIENT_LOCAL** | Thermal printing is designed to operate locally over Bluetooth/LAN from the Flutter tablet. A local SQLite/Hive print spooler suffices for MVP; cloud sync is optional. |
| **8** | **Financial Ledger** | `GET /api/restaurant/finance/ledger` | `order_financial_ledger`<br>`orders.final_total`, `orders.commission_amount` | **VERIFIED** | Integer paise calculations for Gross, Platform Fee, Gateway Fee, and Net Payables are active in `FinanceMetricsService.js`. |
| **9** | **Settlements & Payouts**| `GET /api/restaurant/finance/settlements`<br>`POST /api/restaurant/payout/request` | `merchant_settlements`<br>`('settlement_id', 'payout_status', 'net_amount_paise')` | **VERIFIED** | Scheduled daily T+1 settlement logic implemented in `settlementEngine.js`. |
| **10**| **Statutory Tax & GST** | `GET /api/restaurant/reports/gst` | `orders.tax_details`<br>`('cgst_paise', 'sgst_paise', 'section_9_5_eligible')` | **VERIFIED** | Tracks Section 9(5) CGST Act restaurant tax collections cleanly in JSON metadata. |
| **11**| **Staff Permissions & PIN**| `POST /api/restaurant/staff/pin-verify` | `restaurant_staff`<br>`('role', 'pin_hash', 'permissions')` | **FUTURE_SCOPE** | Slated for Phase 2 multi-staff expansion. |
| **12**| **Audit Logs** | `POST /api/audit/log` | `audit_logs`<br>`('actor_id', 'action', 'metadata', 'timestamp')` | **VERIFIED** | Handover supervisor overrides, order cancellations, and price adjustments generate immutable audit entries. |

---

## 3. ZERO-BREAKAGE DATABASE GOVERNANCE

* **Safety Compliance:** In strict accordance with Cardinal Rule 7, no migrations beyond `055` are required for Restaurant Merchant Phase 1.
* **Extensibility:** The existing PostgreSQL schema accommodates KDS metadata, modifier groups, and prep times inside JSONB columns (`orders.items`, `orders.metadata`, `merchants.operating_hours`). No disruptive schema alterations are required.
