# NABIN REST & Real-Time API Reference

All requests must include `Content-Type: application/json` and `Authorization: Bearer <token>` when accessing protected endpoints.

---

## 1. Authentication & Session Endpoints

### `POST /api/auth/send-otp`
Send 4-digit verification code to mobile number.
- **Request Body**: `{ "phone": "+919876543210", "role": "CUSTOMER", "purpose": "LOGIN" }`
- **Response**: `{ "success": true, "phone": "+919876543210", "message": "OTP sent successfully" }`

### `POST /api/auth/verify-otp`
Verify OTP and receive session token.
- **Request Body**: `{ "phone": "+919876543210", "otp": "7729", "role": "CUSTOMER" }`
- **Response**: `{ "success": true, "token": "usr_session_...", "role": "CUSTOMER", "user": { ... } }`

### `POST /api/admin/login`
Administrator login with cryptographic verification.
- **Request Body**: `{ "username": "superadmin", "password": "AdminPassword123!" }`
- **Response**: `{ "success": true, "token": "adm_token_...", "expiresAt": "...", "admin": { ... } }`

---

## 2. Mobility & Dispatch Endpoints

### `POST /api/rides/estimate`
Calculate authoritative fare estimate with live geofencing surge.
- **Request Body**: `{ "serviceType": "3W", "pickupLat": 28.6139, "pickupLng": 77.2090, "distanceKm": 5.2 }`
- **Response**: `{ "serviceType": "3W", "customerCharge": 115, "driverEarnings": 98, "platformFee": 17, "surgeMultiplier": 1.2 }`

### `POST /api/driver/jobs/:id/verify-otp`
Authoritative driver OTP verification to start or complete trip.
- **Headers**: `Authorization: Bearer <driver_token>`
- **Request Body**: `{ "otp": "7729", "otpType": "START" }`
- **Response**: `{ "success": true, "verified": true, "status": "IN_TRANSIT", "job": { ... } }`

---

## 3. Quick-Commerce Grocery Express Endpoints

### `GET /api/grocery/catalog`
Retrieve DarkStore catalog with live inventory and dynamic prices.
- **Query Params**: `?storeId=store_84&category=ALL`
- **Response**: `{ "success": true, "products": [ ... ], "total": 24 }`

### `POST /api/grocery/cart/revalidate`
Authoritatively revalidate cart items, dynamic pricing, and stock.
- **Request Body**: `{ "storeId": "store_84", "items": [{ "productId": "GROC-01", "quantity": 2 }] }`
- **Response**: `{ "valid": true, "subtotal": 140, "itemCount": 2, "items": [ ... ] }`

### `POST /api/grocery/checkout/validate`
Lock order total with authoritative delivery slot.
- **Request Body**: `{ "storeId": "store_84", "cartItems": [ ... ], "deliverySlot": "10-Min Express" }`
- **Response**: `{ "locked": true, "finalCharge": 175, "orderId": "ORD-GROC-..." }`

---

## 4. Finance, Webhooks & Ledger Endpoints

### `POST /api/payments/webhook`
Idempotent payment capture webhook with signature verification.
- **Headers**: `X-Razorpay-Signature: <hmac_hex>`, `X-Event-Id: <event_id>`
- **Request Body**: `{ "event": "payment.captured", "payload": { "payment": { "entity": { "id": "pay_123", "amount": 17500 } } } }`
- **Response**: `{ "success": true, "record": { ... } }`

### `GET /api/admin/finance/ledger-double-entry`
Inspect immutable double-entry ledger entries.
- **Headers**: `Authorization: Bearer <admin_token>`
- **Response**: `{ "success": true, "entries": [ ... ], "total": 48 }`
