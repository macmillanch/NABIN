# NABIN — Authoritative Architecture Specification

**Status**: AUTHORITATIVE — PERMANENT  
**Owner**: SYSTEM ARCHITECT  
**Last Updated**: 2026-09-07

---

## 1. NABIN PLATFORM OVERVIEW

NABIN is a unified multi-service mobility, quick-commerce, and logistics platform built on a **Single Source of Truth** shared backend architecture.

```
┌─────────────────────────────────────────────────────────────┐
│                 NABIN CLIENT ECOSYSTEM                      │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Customer App    │ Driver App      │ Merchant App            │
│ (Flutter iOS/And)| (Flutter iOS/And)| (Flutter iOS/And)       │
├─────────────────┴─────────────────┴─────────────────────────┤
│ Admin Intelligence Control Center (Responsive Web)          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WSS (Bearer Auth)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             NABIN SHARED BACKEND ENGINE (Node.js)           │
├─────────────────────────────────────────────────────────────┤
│ • Universal Auth & Session Gateway (Cryptographic Hashing)   │
│ • Algorithmic Ride Dispatch & Geohash Spatial Radar         │
│ • Marketplace Grocery Engine & Dynamic Pricing              │
│ • Hyperlocal Food & Kitchen Order Management                │
│ • Dual-OTP Verified Parcel Express Courier                  │
│ • Double-Entry Financial Ledger & Escrow Settlement         │
│ • Role-Based Access Control (RBAC) & Audit Logging          │
└──────────────────────────────┬──────────────────────────────┘
                               │
             ┌──────────────────┴──────────────────┐
             ▼                                     ▼
┌──────────────────────────────┐    ┌─────────────────────────┐
│ PostgreSQL / Supabase Engine │    │ In-Memory / Redis Store │
│ • Central Relational Tables  │    │ • Live Driver GPS Telemetry│
│ • Strict Foreign Keys & RLS  │    │ • High-Frequency Radar  │
│ • Immutable Financial Ledger │    │ • Active OTP & Rate Lim │
└──────────────────────────────┘    └─────────────────────────┘
```

---

## 2. BUSINESS MODEL & DOMAIN RULES

### 2.1 NABIN Does NOT Operate Dark Stores

NABIN has no:
- Dark Store
- NABIN Warehouse
- Micro Warehouse
- Dark Store Picker
- Dark Store Manager
- NABIN-owned grocery warehouse
- Warehouse fulfillment model

### 2.2 Grocery is Marketplace Model

```
Customer → Grocery Merchant's physical store →
Merchant prepares order → NABIN Driver → Customer
```

The grocery domain connects customers to independent grocery merchants. NABIN provides the platform, discovery, cart, checkout, and delivery logistics. Merchants operate their own physical stores and inventory.

### 2.3 Restaurant Domain

Restaurant merchants operate independently. NABIN provides:
- Restaurant discovery
- Menu management
- Order routing
- Kitchen Display System (KDS)
- Delivery dispatch

### 2.4 NOT NABIN Features

The following are explicitly NOT NABIN features:
- Family Circle
- Family Vault
- Family Pool
- Junior Mode

### 2.5 ARE NABIN Features

- Normal orders
- Receipts
- Notifications
- Merchant operations
- Grocery inventory
- Restaurant operations

---

## 3. APPLICATION BOUNDARIES

### 3.1 Client Applications

| Application | Technology | Domain |
|-------------|-----------|--------|
| NABIN Customer App | Flutter (iOS/Android) | Ride booking, food ordering, grocery, parcel, wallet, profile |
| NABIN Driver App | Flutter (iOS/Android) | Job dispatch, GPS telemetry, earnings, KYC |
| NABIN Merchant App | Flutter (iOS/Android) | Restaurant KDS, grocery inventory, order management |
| NABIN Admin Web | Responsive Web (HTML5/Tailwind) | Platform analytics, KYC review, dispatch monitoring, finance |

### 3.2 Shared Backend Engine

All client applications interface with a single Node.js backend (`backend/src/server.js`):
- Single authentication system (phone OTP + JWT)
- Single payment engine (double-entry ledger)
- Single dispatch engine
- Single notification engine
- Single audit log

No duplicate databases, independent auth systems, or split payment engines.

---

## 4. CORE SERVICE PILLARS

### A. NABIN Ride (Mobility)
- Multi-tier transport: Bike (2W), Auto Rickshaw (3W), Economy Cab (4W), Premium SUV (4W Premium).
- Dynamic spatial surge pricing with polygon and radial corridor geofencing.
- Authoritative start-trip OTP verification (`7729` / cryptographic random).

### B. Marketplace Grocery Express (Quick Commerce)
- Customer browses grocery merchant catalogs.
- Merchant prepares order from their physical store.
- NABIN Driver picks up and delivers to customer.
- Authoritative server-side cart subtotal and weight calculation.
- Dynamic SKU pricing rules with historical audit trail.

### C. NABIN Food (Restaurants & Cloud Kitchens)
- Multi-cuisine restaurant discovery and menu customization.
- Live kitchen preparation countdown and rider dispatch.
- Kitchen Display System (KDS) for order lifecycle.

### D. NABIN Parcel Express (Hyperlocal Logistics)
- Sender-to-recipient courier flow.
- Dual-OTP verification: Pickup OTP from sender, Delivery OTP from recipient.

---

## 5. REAL-TIME TELEMETRY & FLEET STATE

- High-frequency GPS streams from Driver apps communicate over WebSocket `/` channel.
- GPS coordinates are processed in an isolated in-memory/Redis layer to prevent relational database write saturation.
- Spatial queries identify nearest available drivers within a 3-5 km operational radius.
- WebSocket handshake requires authenticated bearer token.

---

## 6. DATABASE ARCHITECTURE

### 6.1 Authority
PostgreSQL (via Supabase) is the single source of truth for all persistent data.

### 6.2 Migration Baseline
- Migrations 001–015: Approved baseline. Do not modify.
- Migration 016: Present in authorized Git baseline via commit c0cdf47; formal user approval record pending. Do not modify without re-approval.
- Migration 017: ABSENT (deleted by revert commits 66c0718 and 1d404a6). Do not create, apply, or modify unless a new approved plan and formal user approval are obtained.

### 6.3 Key Domains

| Domain | Primary Tables | Status |
|--------|---------------|--------|
| Authentication & Sessions | `users`, `active_sessions`, `admin_accounts` | APPROVED |
| Identity & KYC | `identity_documents` | APPROVED |
| Mobility & Dispatch | `drivers`, `jobs`, `geo_fences`, `surge_zones`, `dispatch_offers` | APPROVED |
| Finance & Ledger | `payments`, `payment_sessions`, `ledger_accounts`, `journal_transactions`, `journal_lines`, `driver_payouts`, `wallet_transactions` | APPROVED |
| Promotions | `promotions`, `promotion_redemptions` | APPROVED |
| Support & Disputes | `support_tickets` | APPROVED |
| Notifications | `notification_templates`, `notifications`, `device_tokens` | APPROVED |
| Media | Cloudinary-backed, metadata in DB | APPROVED |
| School/Child | `saved_schools`, `saved_children` | APPROVED (Migration 015) |
| Grocery | `master_grocery_catalog`, `merchant_grocery_inventory` | APPROVED |
| Restaurant | `merchants`, `products`, `menus` | APPROVED |
| Checkout | `checkouts`, `checkout_events` | APPROVED |

### 6.4 Stored RPC Functions
- `adjust_wallet_atomic` — Atomic wallet mutation with double-entry
- `capture_payment_atomic` — Atomic payment capture with idempotency
- `refund_payment_atomic` — Atomic refund with idempotency
- `redeem_promotion_atomic` — Atomic promotion redemption with constraints
- `validate_promotion_preview` — Promotion validation without mutation

### 6.5 RLS Policies
- 52 RLS policies enforce tenant isolation and role-based access.
- Backend uses `service_role` key; end-user JWTs are NOT forwarded to PostgREST.
- Authorization is enforced at Node.js middleware layer.

---

## 7. TECHNOLOGY STACK

| Tier | Technology |
|------|-----------|
| Mobile Apps | Flutter 3.47 (Customer, Driver, Merchant) |
| Admin Dashboard | HTML5, Vanilla CSS, JavaScript, Leaflet maps |
| Backend API | Node.js, Express.js, WebSocket |
| Database | PostgreSQL via Supabase (local Docker for dev) |
| Cache/Telemetry | In-memory buffers, Redis (optional) |
| Media | Cloudinary (auto-WebP, thumbnails, KYC guard) |
| Payments | Razorpay integration (sandbox/production) |
| Notifications | FCM/APNS push + in-app notification inbox |

---

## 8. SECURITY BOUNDARIES

- No query parameter tokens (strictly prohibited).
- All authenticated requests use `Authorization: Bearer <token>` header.
- Session expiration: 24 hours for administrators.
- Password hashing: `crypto.scryptSync` with 16-byte salt, 64-byte key.
- Timing-safe comparison: `crypto.timingSafeEqual`.
- Brute-force protection: 5 failed attempts → 15-minute lockout.
- Government identifiers masked in all API responses.
- HMAC-SHA256 webhook verification.
- No mock bypasses in production code paths.

---

## 9. DATA FLOW INVARIANTS

1. **Write Authority**: When `SUPABASE_POSTGRES_LIVE=true`, every persistent mutation is written to PostgreSQL first.
2. **Cache Update**: In-memory cache is updated only after PostgreSQL confirms successful write.
3. **Cache Invalidation on Failure**: If PostgreSQL write fails, memory state is invalidated; no fallback to JSON store.
4. **Bootstrapping**: On server initialization, memory cache hydrates from PostgreSQL tables.
5. **No Independent JSON Mutations**: When `SUPABASE_POSTGRES_LIVE=true`, disk JSON writes are disabled.

---

## 10. DEPLOYMENT ARCHITECTURE

- CI/CD: GitHub Actions
- Container: Docker
- Registry: GitHub Container Registry (GHCR)
- Hosting: Render.com (web service)
- Environments: Beta → Production (manual gate)
- Health checks: `/api/health` (liveness), `/api/ready` (dependency readiness)
- Rollback: Automatic via webhook on health/smoke test failure

---

## 11. CURRENT LIMITATIONS (DOCUMENTED, NOT BLOCKERS)

| Limitation | Description | Status |
|-----------|-------------|--------|
| Mobile UI unwired | Most mobile screens use local state rather than live API | Open |
| 34/38 PostgreSQL tables unused | Backend predominantly in-memory | Open |
| Migration 016 formal approval | Present in authorized Git baseline; explicit user approval record pending | Pending documentation |
| Migration 017 | Absent; NOT approved for future implementation | Pending approval |
