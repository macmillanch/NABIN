# NABIN UNIFIED MERCHANT PORTAL SPECIFICATION & CUTOVER PLAN

**Document Reference**: `docs/UNIFIED_MERCHANT_PORTAL_SPECIFICATION.md`  
**Date**: October 9, 2026  
**Status**: Implementation Complete & Verified (Ready for Review)  
**Primary Brand Color**: Royal Blue `#1A3BA2`  
**Application Root**: `c:\Users\macmi\Documents\nabin\merchant-web`

---

## 1. Executive Summary

The NABIN Merchant Portal has been unified from two independent applications (`restaurant-merchant-web` and `grocery-merchant-web`) into a single, cohesive, modern Next.js web application (`merchant-web/`).

### Core Value & Capabilities
1. **Single Entry Point & Account**: Merchants register and log in through a single portal.
2. **Flexible Business Types**:
   - **Restaurant Only**: Full food menu, dish availability, kitchen display, and food orders.
   - **Grocery Only**: Master grocery catalog, real-time inventory, stock counters, prices, and grocery packing orders.
   - **Restaurant + Grocery (Both)**: Seamless single-account access to both food and grocery operational workflows with an active store switcher (`All` / `Restaurant` / `Grocery`).
3. **Backend-Enforced Authorization**: Capabilities and access rights are cryptographically and server-authorized through `/api/merchant/services` and service middleware guards (`requireMerchantService`). Browser-submitted business types are never blindly trusted.
4. **Compatibility & Non-Destructive**: Both legacy directories (`restaurant-merchant-web` and `grocery-merchant-web`) remain intact with cross-links to the new portal, preventing link rot and preserving existing environments.

---

## 2. Architecture & File Structure

The unified portal resides in `merchant-web/` built with Next.js 16 (App Router), TypeScript, and Tailwind/Vanilla CSS design tokens matching the Stitch design system.

```text
merchant-web/
├── package.json                   # Standalone scripts & dependencies (axios, leaflet, next, react 19)
├── tsconfig.json                  # Strict TypeScript configuration
├── next.config.ts                 # Next.js App Router configuration
├── eslint.config.mjs              # ESLint 9 configuration (0 errors, 0 warnings)
└── src/
    ├── app/
    │   ├── globals.css            # Stitch design tokens (#1A3BA2, focus rings, WCAG AAA contrasts)
    │   ├── layout.tsx             # Root layout with MerchantAuthProvider
    │   ├── page.tsx               # Unified Dashboard (GMV, orders, metrics, live queue)
    │   ├── login/
    │   │   └── page.tsx           # Single phone + OTP login with dev helper
    │   ├── register/
    │   │   └── page.tsx           # 3-step registration wizard (Type -> Owner -> Physical Store & FSSAI)
    │   ├── orders/
    │   │   └── page.tsx           # Unified Order Console (Kitchen lifecycle & Grocery packing)
    │   ├── menu/
    │   │   └── page.tsx           # Restaurant Dish & Menu Management (gated by RESTAURANT service)
    │   ├── inventory/
    │   │   └── page.tsx           # Grocery Inventory & Price Manager (gated by INSTAMART service)
    │   └── profile/
    │       └── page.tsx           # Store profile, FSSAI compliance, granted services breakdown
    ├── components/
    │   ├── ConsoleLayout.tsx      # Responsive shell, dynamic sidebar, header context switcher
    │   └── Icons.tsx              # SVG icon library for consistent kinetic UI
    └── context/
        └── MerchantAuth.tsx       # Auth state, capability resolution, token storage, context switching
```

---

## 3. Registration Experience & Business Types

The registration flow (`/register`) guides merchants through a 3-step progressive wizard:

### Step 1: Business Model Selection
Merchants select one of three cards:
- **Restaurant** (`RESTAURANT`): "Manage food menus, kitchen preparation orders, and restaurant tables."
- **Grocery** (`GROCERY`): "Manage grocery products, inventory, batch pricing, and instant grocery packing."
- **Both — Restaurant + Grocery** (`BOTH` / `HYBRID_BOTH`): "Manage restaurant kitchen and grocery inventory operations from one consolidated account."

### Step 2: Owner & Primary Contact
- Full Legal Name
- Owner Email
- 10-digit Indian Mobile Number (`+91`)

### Step 3: Physical Store & Compliance Details
- Store Operating Name
- Full Physical Address & City
- FSSAI License Number (14 digits)
- GSTIN (Optional / if applicable)

Upon submission, the portal calls `POST /api/merchant/register`, validating all inputs and storing the entity.

---

## 4. Backend Registration & Authorization Architecture

### A. Endpoint: `POST /api/merchant/register`
- **Validation**: Ensures mandatory fields (`name`, `phone`, `address`, `businessType`), validates phone format (`^[6-9]\d{9}$`).
- **Conflict Handling**: Returns `409 Conflict` if the phone number is already registered.
- **Mapping**: Maps `BOTH` to `HYBRID_BOTH` conforming to PostgreSQL `merchants.merchant_type` check constraints.
- **Persistence**: Persists to PostgreSQL `merchants` table with graceful cache fallback if PostgREST RLS blocks writes.
- **Dual Capability**: For `HYBRID_BOTH`, registers in both `db.restaurants` and inventory cache.

### B. Endpoint: `GET /api/merchant/services`
Authenticates the merchant token and returns:
```json
{
  "merchantId": "uuid-or-id",
  "name": "Super Kitchen & Mart",
  "merchantType": "HYBRID_BOTH",
  "services": ["RESTAURANT", "INSTAMART"],
  "needsServiceSelector": true
}
```

### C. Server-Side Route Isolation
Backend endpoints enforce capability authorization via `requireMerchantService`:
- Restaurant routes (`/api/merchant/menu`, `/api/merchant/orders/:id/status`) require `RESTAURANT`.
- Grocery routes (`/api/merchant/inventory`, `/api/merchant/catalog`) require `INSTAMART`.
- Cross-tenant or unauthorized service access results in `403 Forbidden` (`MERCHANT_TYPE_MISMATCH`).

---

## 5. Dynamic Dashboard & Navigation

### Business Switching for Dual Merchants
For `HYBRID_BOTH` merchants, the header renders a segmented control:
- **All / Overview**: Consolidated GMV, combined live order queue, all modules visible in navigation.
- **Restaurant Context**: Shows restaurant orders and menu manager; hides grocery catalog.
- **Grocery Context**: Shows grocery orders and inventory manager; hides restaurant menu.

For single-business merchants (`RESTAURANT` or `GROCERY`), the switcher is automatically hidden, and the navigation displays only authorized modules.

---

## 6. Schema Audit & Approval State Limitations

### Existing PostgreSQL Schema State (`001_central_schema.sql` & Database Reflection)
The `merchants` table has the following authoritative columns:
```sql
CREATE TABLE merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    merchant_type VARCHAR(40) NOT NULL CHECK (merchant_type IN ('RESTAURANT', 'GROCERY', 'HYBRID_BOTH')),
    phone VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    lat NUMERIC(10, 7) NOT NULL,
    lng NUMERIC(10, 7) NOT NULL,
    fssai_license VARCHAR(50),
    is_open BOOLEAN DEFAULT TRUE,
    rating NUMERIC(3, 2) DEFAULT 4.80,
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
    commission_rate NUMERIC(4, 2) DEFAULT 0.15,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    cuisines TEXT[],
    cover_image_url TEXT,
    standard_delivery_minutes SMALLINT
);
```

### Findings & Storage Limitations
1. **Approval State Model**: There is no independent approval column (`merchant_status` does not exist in this table; active store state is governed by `is_open BOOLEAN DEFAULT TRUE`).
2. **Missing Per-Business Approval Columns**: There are no independent `restaurant_approval_status` and `grocery_approval_status` columns. When a merchant registers for `HYBRID_BOTH`, the database stores `merchant_type = 'HYBRID_BOTH'` as a single unified store record.
3. **Hosted Supabase TEST Project (`ywhxkzmbwppkdemvzlhv`) Diagnosis**:
   - PostgREST queries for `merchants` (and other `public.*` tables) return PostgreSQL error `42501 permission denied for table merchants` when accessed via the `service_role` key.
   - The PostgreSQL role `service_role` has not been granted table privileges in `ywhxkzmbwppkdemvzlhv` (`GRANT ALL ON public.merchants TO service_role`).
   - Under the repository safety policy, remote infrastructure must not be modified and broad database privileges must not be granted without explicit user approval.
   - Therefore, tests run solely against `ywhxkzmbwppkdemvzlhv` hit the `permission denied` path, which previously activated in-memory process fallback.
4. **Durable Persistence Proven in Live PostgreSQL (`127.0.0.1:54322`)**:
   - In the live local PostgreSQL database, `service_role` has full grants (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
   - Registration, persistent writes, independent direct `pg.Client` reads, duplicate 409 rejections, server restart survival, and server-authorized capabilities have been proven and verified with `backend/test_durable_merchant_persistence.js`.

### Candidate Future Migration (Draft Only — NOT Applied)
When granular per-business approval is required by the business, the following migration can be reviewed:
```sql
-- Migration Draft (For Review Only - Do Not Apply Without Explicit Approval)
ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS restaurant_approval_status VARCHAR(20) DEFAULT 'PENDING'
    CHECK (restaurant_approval_status IN ('PENDING', 'APPROVED', 'REJECTED')),
  ADD COLUMN IF NOT EXISTS grocery_approval_status VARCHAR(20) DEFAULT 'PENDING'
    CHECK (grocery_approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));
```

---

## 7. Existing Routes & Backward Compatibility

| Legacy URL | Target Unified URL | Notes |
|---|---|---|
| `restaurant-merchant-web/` (port 3002) | `merchant-web/` (port 3004) | Full compatibility; cross-link badge added in sidebar |
| `grocery-merchant-web/` (port 3003) | `merchant-web/` (port 3004) | Full compatibility; cross-link badge added in sidebar |
| `/login` | `/login` | Preserved across all applications |
| `/orders` | `/orders` | Displays kitchen or packing cards depending on store type |
| `/menu` | `/menu` | Restaurant menu catalog (gated by `RESTAURANT`) |
| `/inventory` | `/inventory` | Grocery catalog & stock editor (gated by `INSTAMART`) |
| `/profile` | `/profile` | Store profile, FSSAI status, active business types |

### Token Interoperability
`MerchantAuth.tsx` automatically checks and migrates legacy tokens:
- `nabin_merchant_token`
- `nabin_restaurant_merchant_token`
- `nabin_grocery_merchant_token`
Merchants logged into a legacy portal can transition without forced re-authentication.

---

## 8. Cutover & Deployment Consolidation Plan

1. **Phase 1: Dual Run (Current State)**
   - Unified portal is operational on `localhost:3004`.
   - Legacy portals run on `localhost:3002` and `localhost:3003`.
   - Both legacy portals display the "✨ Unified Portal" callout.

2. **Phase 2: Reverse Proxy / Next.js Rewrite Transition**
   - Direct `merchant.nabin.com` to `merchant-web`.
   - Redirect `restaurant.merchant.nabin.com` and `grocery.merchant.nabin.com` to `merchant.nabin.com` with query parameter `?context=restaurant` or `?context=grocery`.

3. **Phase 3: Retirement of Legacy Directories**
   - After user sign-off and 30-day operational observation, retire `restaurant-merchant-web/` and `grocery-merchant-web/`.

---

## 9. Verification & Quality Assurance Evidence

1. **Backend Integration Tests (`backend/test_unified_merchant.js`)**:
   - `Restaurant registration`: ✅ PASS
   - `Grocery registration`: ✅ PASS
   - `Hybrid Both registration`: ✅ PASS
   - `Duplicate phone rejection (409)`: ✅ PASS
   - `Invalid business type rejection (400)`: ✅ PASS
   - `Restaurant login entitlements`: ✅ PASS (`["RESTAURANT"]`)
   - `Grocery login entitlements`: ✅ PASS (`["INSTAMART"]`)
   - `Hybrid Both entitlements`: ✅ PASS (`["RESTAURANT", "INSTAMART"]`, switcher active)
   - `Cross-service isolation guards`: ✅ PASS (`403 MERCHANT_TYPE_MISMATCH` enforced)
   - Overall: **100% Passed (9/9)**

2. **Durable PostgreSQL Persistence & Restart Test (`backend/test_durable_merchant_persistence.js`)**:
   - `PostgreSQL Row Persistence for RESTAURANT`: ✅ PASS (direct `pg.Client` verified)
   - `PostgreSQL Row Persistence for GROCERY`: ✅ PASS (direct `pg.Client` verified)
   - `PostgreSQL Row Persistence for HYBRID_BOTH`: ✅ PASS (direct `pg.Client` verified)
   - `Duplicate 409 & Invalid 400 guards`: ✅ PASS
   - `PostgreSQL OTP Login & Service Entitlements`: ✅ PASS
   - `Cross-service isolation (403 MERCHANT_TYPE_MISMATCH)`: ✅ PASS
   - `Process Restart Survival`: ✅ PASS (Server killed, new process booted, independent PostgreSQL read & login succeeded)

3. **Environment & Security Guards (`backend/nabin_env_guard_test.js`)**:
   - Passed all 29/29 environment guard assertions.

3. **TypeScript & Static Analysis**:
   - `merchant-web`: `npm run lint` -> **0 errors, 0 warnings**
   - `restaurant-merchant-web`: `npm run lint` -> **0 errors, 0 warnings**
   - `grocery-merchant-web`: `npm run lint` -> **0 errors, 0 warnings**

4. **Production Build Compilation**:
   - `merchant-web`: `npm run build` -> **Compiled successfully, 8 static routes generated**.
