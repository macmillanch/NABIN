# NABIN Security & Compliance Specification

## 1. Authentication & Token Policy
- **No Query Parameter Tokens**: Tokens in URL query strings (`?auth_token=`, `?admin_token=`) are strictly prohibited and rejected by API gateways.
- **Authorization Header Standard**: All authenticated client requests must supply tokens in standard HTTP headers:
  ```http
  Authorization: Bearer <access_token>
  ```
- **Session Expiration**: All issued tokens carry an authoritative server-side `expiresAt` timestamp (24 hours for administrators).
- **No Mock Bypasses**: Development fallbacks (e.g. automatic assumption of `drv_1` or `restaurants[0]`) have been completely eliminated. Missing authorization returns `HTTP 401 Unauthorized`.

## 2. Password Security & Anti-Brute-Force Lockout
- **Cryptographic Hashing**: All administrator passwords are stored with a 16-byte unique cryptographic salt and hashed via `crypto.scryptSync` (64-byte key output).
- **Timing-Safe Verification**: Passwords are compared using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.
- **Brute-Force Protection**: 5 consecutive failed login attempts result in an automatic 15-minute account lockout.

## 3. Role-Based Access Control (RBAC)
Granular permissions govern all administrative operations:
- `SUPER_ADMIN`: Full platform configuration, killswitch, and provisioning.
- `KYC_SPECIALIST`: Review, approve, reject, or request resubmission of identity applications.
- `OPERATIONS`: Fleet tracking, driver activation/suspension, and geofencing.
- `FINANCE_AUDITOR`: Financial ledger inspection, settlements, adjustments, and refunds.
- `SUPPORT_AGENT`: Dispute resolution and customer communication.

## 4. Payment Gateway Webhook Verification & Idempotency
- **HMAC-SHA256 Signatures**: Incoming webhooks on `/api/payments/webhook` are validated against `PAYMENT_WEBHOOK_SECRET` using HMAC-SHA256 signatures.
- **Idempotency Guard**: Event IDs are stored in an idempotent processing set. Duplicate event deliveries return `{ success: true, duplicate: true }` without re-crediting balances.
- **Atomic Double-Entry Recording**: Verified payments create balanced ledger entries in `CUSTOMER_WALLET_LIABILITY` and `PAYMENT_GATEWAY_ESCROW`.

## 5. Sensitive Identity & KYC Masking
- Government identifiers are masked across all user and API responses:
  - Aadhaar Numbers: `XXXX-XXXX-4892`
  - Voter ID Numbers: `DLH***201`
  - Driving Licences: `DL-****4892`
  - Bank Accounts: `******4892`
- Unmasked document review requires explicit authorization permissions (`identity_documents.download`).
