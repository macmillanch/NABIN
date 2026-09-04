# NABIN — PHASE 9 FORENSIC AUDIT & PERSISTENCE BRIDGE IMPLEMENTATION PLAN
## Geofencing, Dynamic Surge Zones & Spatial Pricing Persistence Domain

---

### Executive Summary

Phase 8 established PostgreSQL-authoritative persistence for Promotions, Coupons, and Atomic Redemptions (`public.promotions`, `public.promotion_redemptions`).
Phase 9 performs a forensic persistence, security, and correctness audit of:
- Geofencing (`public.geo_fences`)
- Dynamic Surge Zones (`public.surge_zones`)
- Centralized Pricing Matrix (`public.pricing_configurations`)
- Live Geofence Evaluation (`evaluateLocationGeofences`)
- Spatial Fare Calculation Engine (`calculateFareEstimate`)
- Ride, Parcel, and Food booking fare derivation
- Administrative security, RBAC authorization, and Phase 7 audit logging

**Key Audit Findings**:
1. **Schema Fully Present**: Migration 011 (`011_geofences_surge_domain.sql`) defined and deployed the complete database schema for `geo_fences`, `surge_zones`, and `pricing_configurations`, complete with CHECK constraints, foreign keys (`ON DELETE CASCADE`), indexes, and RLS policies. Local Docker PostgreSQL has 6 rows in `pricing_configurations` and 3 operational rows in `geo_fences`.
2. **Application Completely Disconnected**: The running backend (`backend/src/server.js`, `backend/src/database.js`) does NOT read or write from these PostgreSQL tables. `this.pricingConfig`, `this.geoFences`, and `this.surgeZones` are 100% in-memory mock arrays/objects.
3. **Severe Administrative Vulnerabilities**:
   - `GET /api/admin/geofences` is **completely unauthenticated** (lacks `authenticateAdmin` and `requirePermission`).
   - `GET /api/admin/surgezones` is **completely unauthenticated** (lacks `authenticateAdmin` and `requirePermission`).
   - `GET /api/admin/pricing` has `authenticateAdmin` but lacks RBAC permission enforcement.
4. **Data Loss on Restart**: Any pricing updates (`POST /api/admin/pricing`), geofence additions (`POST /api/admin/geofences`), or surge zone creations (`POST /api/admin/surgezones`) modify only in-memory objects and are completely wiped when the backend process terminates or restarts.
5. **No Migration 016 Required**: The existing relational schema in Migration 011 is 100% sufficient to support all geofencing, dynamic surge rules, rate cards, and spatial fare calculations.

---

## A. Executive Summary & Verification Baseline

### Baseline Verification
- **Repository**: `C:\Users\macmi\Documents\nabin`
- **Branch**: `main`
- **Verified Commit**: `1c978f8dede06e855fa280dd82601ac27d62a4d3`
- **origin/main**: `1c978f8dede06e855fa280dd82601ac27d62a4d3`
- **Working Tree**: Clean
- **Backend Test Suite**: 161 / 161 PASSED
- **Restart Test**: 16 / 16 PASSED
- **Flutter Analyze**: 0 issues
- **Flutter Tests**: 18 / 18 PASSED
- **Remote Supabase**: STRICTLY UNTOUCHED

---

## B. Current Schema Inventory (Migrations 001–015)

### 1. Table `public.geo_fences`
Created in `001_central_schema.sql` (lines 241–251) and extended in `011_geofences_surge_domain.sql` (lines 17–51):

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Authoritative primary key |
| `zone_name` | VARCHAR(100) | NOT NULL | Human-readable name |
| `zone_code` | VARCHAR(40) | UNIQUE NOT NULL | Unique programmatic zone code |
| `geometry_type` | VARCHAR(20) | NOT NULL, CHECK (`geometry_type IN ('POLYGON', 'CIRCLE')`) | Spatial geometry type |
| `coordinates` | JSONB | NOT NULL | Vertices for polygon or `{center, radiusMeters}` |
| `surcharge_amount`| NUMERIC(8,2)| DEFAULT 0.00, CHECK (`surcharge_amount >= 0`) | Fixed entry surcharge |
| `surge_multiplier`| NUMERIC(4,2)| DEFAULT 1.00, CHECK (`surge_multiplier >= 1.00`) | Base zone multiplier |
| `is_active` | BOOLEAN | DEFAULT TRUE | Operational flag |
| `category` | VARCHAR(50) | DEFAULT 'GENERAL' | Operational tag (`AIRPORT`, `CBD_HIGH_DEMAND`, `TECH_PARK`) |
| `center_lat` | NUMERIC(10,7)| NULLABLE | Center latitude for circles |
| `center_lng` | NUMERIC(10,7)| NULLABLE | Center longitude for circles |
| `radius_meters` | INTEGER | NULLABLE | Radius in meters for circles |
| `allowed_services`| TEXT[] | DEFAULT `ARRAY['RIDE','PARCEL','FOOD']` | Whitelisted services |
| `allowed_vehicles`| TEXT[] | DEFAULT `ARRAY['2W','3W','4W']` | Whitelisted vehicles |
| `operating_hours`| VARCHAR(100)| DEFAULT '24x7 Open' | Operating schedule string |
| `description` | TEXT | NULLABLE | Operational description |
| `created_by` | VARCHAR(100) | NULLABLE | Creator admin attribution |
| `created_at` | TIMESTAMPTZ | DEFAULT `NOW()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT `NOW()` | Record update timestamp |

**Indexes**:
- `idx_geo_fences_active` on (`is_active`)
- `idx_geo_fences_category` on (`category`)
- `idx_geo_fences_zone_code` on (`zone_code`)

**RLS Policies**:
- `p_read_active_geofences`: `FOR SELECT USING (is_active = TRUE)`
- `p_service_role_geofences`: `FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE)`

---

### 2. Table `public.surge_zones`
Created in `011_geofences_surge_domain.sql` (lines 54–81):

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | UUID | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Authoritative primary key |
| `zone_id` | UUID | REFERENCES `public.geo_fences(id)` ON DELETE CASCADE | Associated geofence foreign key |
| `zone_name` | VARCHAR(100) | NOT NULL | Surge zone name |
| `service` | VARCHAR(30) | DEFAULT 'ALL' | Target service (`RIDE`, `PARCEL`, `FOOD`, `ALL`) |
| `vehicle_type` | VARCHAR(30) | DEFAULT 'ALL' | Target vehicle (`2W`, `3W`, `4W`, `ALL`) |
| `surge_multiplier`| NUMERIC(4,2)| NOT NULL DEFAULT 1.00, CHECK (`>= 1.00`) | Multiplier to apply |
| `max_multiplier` | NUMERIC(4,2)| NOT NULL DEFAULT 3.00, CHECK (`>= 1.00`) | Hard upper cap |
| `start_time` | TIME | NULLABLE | Daily scheduled start time |
| `end_time` | TIME | NULLABLE | Daily scheduled end time |
| `priority` | VARCHAR(20) | DEFAULT 'NORMAL', CHECK IN (`'LOW', 'NORMAL', 'HIGH', 'CRITICAL'`) | Overlap resolution priority |
| `status` | VARCHAR(20) | DEFAULT 'ACTIVE', CHECK IN (`'ACTIVE', 'INACTIVE', 'SCHEDULED', 'EXPIRED'`) | Operational status |
| `reason` | TEXT | NULLABLE | Justification for surge rule |
| `created_by` | VARCHAR(100) | NULLABLE | Creator admin attribution |
| `created_at` | TIMESTAMPTZ | DEFAULT `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | DEFAULT `NOW()` | Update timestamp |

**Additional Constraints**:
- `chk_surge_not_exceed_max`: `CHECK (surge_multiplier <= max_multiplier)`

**Indexes**:
- `idx_surge_zones_lookup` on (`status`, `service`, `vehicle_type`)
- `idx_surge_zones_zone_id` on (`zone_id`)
- `idx_surge_zones_priority` on (`priority`)

**RLS Policies**:
- `p_read_active_surge_zones`: `FOR SELECT USING (status = 'ACTIVE')`
- `p_service_role_surge_zones`: `FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE)`

---

### 3. Table `public.pricing_configurations`
Created in `011_geofences_surge_domain.sql` (lines 84–121):

| Column | Type | Constraints | Description |
| :--- | :--- | :--- | :--- |
| `id` | VARCHAR(50) | PRIMARY KEY | Service code (`2W`, `3W`, `4W`, `PARCEL`, `FOOD`, `GLOBAL`) |
| `service_type` | VARCHAR(30) | NOT NULL | Service type discriminator |
| `name` | VARCHAR(100) | NOT NULL | Display name |
| `base_fare` | NUMERIC(10,2)| NOT NULL, CHECK (`base_fare >= 0`) | Flag-drop starting fare |
| `per_km_rate` | NUMERIC(10,2)| NOT NULL, CHECK (`per_km_rate >= 0`) | Distance metering rate per km |
| `per_min_rate` | NUMERIC(10,2)| NOT NULL, CHECK (`per_min_rate >= 0`) | Time metering rate per minute |
| `min_fare` | NUMERIC(10,2)| NOT NULL, CHECK (`min_fare >= 0`) | Minimum charge floor |
| `booking_fee` | NUMERIC(10,2)| NOT NULL, CHECK (`booking_fee >= 0`) | Flat platform booking fee |
| `commission_percent`| NUMERIC(5,2)| NOT NULL, CHECK (`0 <= commission_percent <= 100`) | Platform commission rate % |
| `global_surge_multiplier`| NUMERIC(4,2)| DEFAULT 1.00, CHECK (`>= 1.00`) | Global surge multiplier fallback |
| `active_surge_zone`| VARCHAR(80)| DEFAULT 'NONE' | Currently broadcasted active zone |
| `updated_by` | VARCHAR(100) | NULLABLE | Last admin modifier |
| `updated_at` | TIMESTAMPTZ | DEFAULT `NOW()` | Last modification timestamp |

**Indexes**:
- `idx_pricing_configs_service` on (`service_type`)

**RLS Policies**:
- `p_read_pricing_configs`: `FOR SELECT USING (TRUE)`
- `p_service_role_pricing_configs`: `FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE)`

---

## C. Backend State Inventory

| State Variable | Location | Current Type | Classification | Target PostgreSQL Table |
| :--- | :--- | :--- | :--- | :--- |
| `this.pricingConfig` | `database.js:404` | In-memory Object | **CATEGORY B** | `public.pricing_configurations` |
| `this.geoFences` | `database.js:415` | In-memory Array | **CATEGORY B** | `public.geo_fences` |
| `this.surgeZones` | `database.js:478` | In-memory Array | **CATEGORY B** | `public.surge_zones` |
| `this.jobs[].fare` | `database.js:1239` | In-memory Array | **CATEGORY A** | `public.jobs (fare_subtotal, final_total)` |
| `reverse-geocode` | `server.js:1391` | Stateless function | **CATEGORY C** | Ephemeral by design |
| Spatial raycasting | `database.js:2301` | Pure static functions | **CATEGORY C** | Ephemeral algorithms in memory |

---

## D. API & Call Graph Analysis

```text
[ Admin Client ] ──→ GET /api/admin/geofences          ──→ ❌ UNPROTECTED ──→ reads db.geoFences (Memory)
[ Admin Client ] ──→ POST /api/admin/geofences         ──→ authenticateAdmin ──→ db.addGeoFence (Memory only)
[ Admin Client ] ──→ DELETE /api/admin/geofences/:id    ──→ authenticateAdmin ──→ db.geoFences.splice (Memory only)
[ Admin Client ] ──→ GET /api/admin/surgezones         ──→ ❌ UNPROTECTED ──→ reads db.surgeZones (Memory)
[ Admin Client ] ──→ POST /api/admin/surgezones        ──→ authenticateAdmin ──→ db.addSurgeZone (Memory only)
[ Admin Client ] ──→ GET /api/admin/pricing            ──→ authenticateAdmin ──→ ❌ NO RBAC CHECK ──→ reads db.pricingConfig (Memory)
[ Admin Client ] ──→ POST /api/admin/pricing           ──→ authenticateAdmin ──→ mutates db.pricingConfig (Memory only)

[ Mobile/Client ] ──→ POST /api/geofence/evaluate       ──→ db.evaluateLocationGeofences (Evaluates in-memory fences)
[ Mobile/Client ] ──→ POST /api/pricing/estimate        ──→ db.calculateFareEstimate (Evaluates in-memory rate cards)
[ Mobile/Client ] ──→ POST /api/customer/book-ride      ──→ db.calculateFareEstimate ──→ db.createJob (Persisted)
[ Mobile/Client ] ──→ POST /api/customer/book-parcel    ──→ db.calculateFareEstimate ──→ db.createJob (Persisted)
[ Mobile/Client ] ──→ POST /api/food/order              ──→ db.calculateFareEstimate ──→ db.createJob (Persisted)
```

---

## E. Fare Calculation Analysis

### 1. Formula Analysis
The authoritative calculation implemented in `calculateFareEstimate({ serviceType, distanceKm, durationMins, pickupLat, pickupLng, zoneId, promoCode })`:

$$\text{Distance Cost} = \max(1, \text{distanceKm}) \times \text{perKmRate}$$
$$\text{Time Cost} = \max(1, \text{durationMins}) \times \text{perMinRate}$$
$$\text{Subtotal} = \max(\text{minFare}, \text{baseFare} + \text{Distance Cost} + \text{Time Cost})$$

**Geofence & Surcharge Application**:
If `(pickupLat, pickupLng)` falls inside active geofences:
$$\text{Subtotal} = \text{Subtotal} + \sum \text{zone.surcharge}$$
$$\text{Surge Multiplier} = \max(\text{globalSurgeMultiplier}, \max_{\text{zones}}(\text{zone.surgeMultiplier}), \max_{\text{dynamic}}(\text{activeSurge.surgeMultiplier}))$$

**Customer Fare**:
$$\text{Customer Fare} = \text{round}(\text{Subtotal} \times \text{Surge Multiplier} + \text{bookingFee})$$

**Promotions Integration**:
If `promoCode` is supplied:
$$\text{Discount} = \text{validatePromotion}(\text{promoCode}, \text{Customer Fare}, \text{serviceType}).\text{discount}$$
$$\text{Final Customer Charge} = \max(\text{minFare}, \text{Customer Fare} - \text{Discount})$$

**Platform Split**:
$$\text{Platform Fee} = \text{round}\left(\text{Final Customer Charge} \times \frac{\text{commissionPercent}}{100}\right)$$
$$\text{Driver Earnings} = \text{Final Customer Charge} - \text{Platform Fee}$$

### 2. Correctness Assessment
- **Surge Order**: Surge is applied to the metered trip subtotal before promotional discount. This is industry standard and mathematically sound.
- **Minimum Fare Floor**: Enforced twice: once before surge to ensure minimum metered base, and once after discount to guarantee trips are never below platform minimum operating costs.
- **Rounding**: `Math.round()` prevents fractional paise discrepancies across the ledger.

---

## F. Dynamic Surge Pricing Analysis

1. **Active Rule Selection**:
   In `evaluateLocationGeofences` and `calculateFareEstimate`, active rules are filtered by `status === 'ACTIVE'` and matched against `zoneId` or `service === serviceType || service === 'ALL'`.
2. **Cap Enforcement**:
   The multiplier is capped by `Math.min(rule.maxMultiplier, rule.surgeMultiplier)`.
3. **Multi-Zone Overlap**:
   When multiple geofences or dynamic surge zones cover the same geographic point, the highest surge multiplier wins (`Math.max(...)`), while fixed surcharges (e.g. airport tolls) are additive.
4. **Scheduled Surge**:
   `public.surge_zones` provides `start_time` and `end_time` (TIME). Time-window evaluation should be verified against current time when evaluating active rules.

---

## G. Geofence Correctness Analysis

1. **Circle Geofences**:
   Calculated using Haversine Great Circle distance:
   $$d = 2 R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
   If $d \le \text{radiusMeters}$, the point is inside.
2. **Polygon Geofences**:
   Calculated using standard Ray-Casting Algorithm (`pnpoly`). Handles arbitrary concave or convex boundary shapes.
3. **No PostGIS Dependency**:
   Because NABIN operates on dozens of curated operational zones (airports, CBDs, IT corridors) rather than millions of arbitrary parcels, executing Haversine and Ray-Casting in memory against PostgreSQL-hydrated geometries provides sub-millisecond evaluation without requiring PostGIS extension overhead.

---

## H. Security Analysis & Admin RBAC

### Identified Vulnerabilities
1. **UNAUTHENTICATED ENDPOINTS**:
   - `GET /api/admin/geofences`: Lacks any authentication. Leaks internal geofence boundaries, categories, toll surcharges, and operator names to unauthorized actors.
   - `GET /api/admin/surgezones`: Lacks any authentication. Leaks operational surge schedules, priorities, and multipliers.
2. **MISSING PERMISSION ENFORCEMENT**:
   - `GET /api/admin/pricing`: Uses `authenticateAdmin` but does not enforce `requirePermission('pricing.view')` or `pricing.edit`.
3. **ACTOR ATTRIBUTION FORGING**:
   - In `POST /api/admin/geofences` and `POST /api/admin/surgezones`, actor name is passed as `req.admin.name` (good), but `addGeoFence` and `addSurgeZone` did not persist to PostgreSQL.

---

## I. Client Trust Boundary

- The client sends: `serviceType`, `distanceKm`, `durationMins`, `pickupLat`, `pickupLng`, `zoneId`, `promoCode`.
- The client CANNOT specify: `fare`, `finalCustomerCharge`, `driverEarnings`, `platformFee`, `surgeMultiplier`, `baseFare`, `perKmRate`.
- All monetary calculations are performed server-side.
- Client-supplied coordinates are validated against NaN and coordinate range bounds.

---

## J. Promotions Integration

- Phase 8 wired `db.promotionRepo.preview` (using `validate_promotion_preview` RPC).
- Previews do not alter `usage_count`.
- Fare estimation calls preview in read-only mode.
- Surge multipliers apply before coupon discounts.

---

## K. Payment & Wallet Integration

- `POST /api/customer/book-ride` stores authoritative `fare`, `driverEarnings`, and `platformFee` into `jobs`.
- When trip completes, `verify-otp` (DELIVERY) triggers double-entry ledger debiting `CUSTOMER_RECEIVABLE` and crediting `DRIVER_PAYABLE` and `PLATFORM_REVENUE` using the authoritative job fare figures.
- No discrepancy exists between estimated fare and settled transaction.

---

## L. Restart Safety

### Current Flaw
`initPostgres()` in `backend/src/database.js` hydrates users, drivers, jobs, ledger entries, admins, tickets, audit logs, and promotions, but DOES NOT hydrate:
- `pricingConfig`
- `geoFences`
- `surgeZones`

### Required Fix
1. In `initPostgres()`, hydrate:
   - `pricing_configurations` into `this.pricingConfig`
   - `geo_fences` into `this.geoFences`
   - `surge_zones` into `this.surgeZones`
2. Writes to pricing, geofences, and surge zones must commit authoritatively to PostgreSQL before returning HTTP 200.

---

## M. Concurrency & Overwrite Protection

- `pricing_configurations` rows have fixed primary keys (`2W`, `3W`, `4W`, `PARCEL`, `FOOD`, `GLOBAL`).
- Updates use parameterized SQL updates targeting specific columns.
- Concurrent admin updates will serialize at the PostgreSQL row level.
- Geofence and Surge Zone creations use UUID primary keys, preventing ID collision.

---

## N. Audit Log Integration (Phase 7 Authoritative Path)

Every administrative mutation must invoke `db.auditLogRepo.create(...)` using session-derived admin credentials:
1. `GEOFENCE_CREATED`: Target `GEOFENCE`, ID = new fence UUID.
2. `GEOFENCE_UPDATED`: Target `GEOFENCE`, ID = fence UUID.
3. `GEOFENCE_DELETED`: Target `GEOFENCE`, ID = deleted fence UUID.
4. `SURGE_CREATED`: Target `SURGE_ZONE`, ID = surge UUID.
5. `SURGE_UPDATED`: Target `SURGE_ZONE`, ID = surge UUID.
6. `SURGE_DELETED`: Target `SURGE_ZONE`, ID = deleted surge UUID.
7. `PRICING_UPDATED`: Target `PRICING_CONFIG`, ID = service code or `'PRICING_GLOBAL'`.

---

## O. Category A / B / C / D Classification Table

| Component | Current State | Classification | Target Architecture |
| :--- | :--- | :--- | :--- |
| `public.pricing_configurations` | Defined in DB; unlinked in app | **CATEGORY A** | PostgreSQL authoritative rate cards |
| `public.geo_fences` | Defined in DB; unlinked in app | **CATEGORY A** | PostgreSQL authoritative operational boundaries |
| `public.surge_zones` | Defined in DB; unlinked in app | **CATEGORY A** | PostgreSQL authoritative dynamic surge rules |
| `db.pricingConfig` (in-memory) | Runtime object in `database.js` | **CATEGORY B** | Hydrated from `pricing_configurations` |
| `db.geoFences` (in-memory) | Runtime array in `database.js` | **CATEGORY B** | Hydrated from `geo_fences` |
| `db.surgeZones` (in-memory) | Runtime array in `database.js` | **CATEGORY B** | Hydrated from `surge_zones` |
| `Reverse-geocode` dictionary | Static spatial lookup in `server.js` | **CATEGORY C** | Ephemeral, stateless helper |
| Haversine & Raycasting algorithms| Static methods in `database.js` | **CATEGORY C** | Ephemeral mathematical utilities |
| Missing Schema Requirements | None | **CATEGORY D** | **NONE** (Migration 011 is complete) |

---

## P. Migration Decision

### Verdict: NO MIGRATION REQUIRED
- Migrations 001–015 remain byte-for-byte unchanged.
- Migration 016 will **NOT** be created.
- `public.geo_fences`, `public.surge_zones`, and `public.pricing_configurations` in Migration 011 contain all columns, constraints, foreign keys, and indexes required for Phase 9.

---

## Q. Required Fixes (Scope Boundary)

1. **Create `PricingRepository.js`**:
   - Manages CRUD operations for `pricing_configurations`, `geo_fences`, and `surge_zones` on PostgreSQL.
   - Provides DTO mappers between DB snake_case and application camelCase.
2. **Database Integration (`database.js`)**:
   - Instantiate `this.pricingRepo = new PricingRepository(this)`.
   - Hydrate `pricingConfig`, `geoFences`, and `surgeZones` from PostgreSQL during `initPostgres()`.
   - Fail closed if PostgreSQL connection fails in live mode.
3. **Admin Security Hardening (`server.js`)**:
   - Add `authenticateAdmin` and `requirePermission('geofence.view')` to `GET /api/admin/geofences`.
   - Add `authenticateAdmin` and `requirePermission('surge.view')` to `GET /api/admin/surgezones`.
   - Add `requirePermission('pricing.edit')` (or view) to `GET /api/admin/pricing`.
   - Update `POST /api/admin/pricing` to persist to `pricing_configurations` via `PricingRepository`.
   - Update `POST /api/admin/geofences` and `DELETE /api/admin/geofences/:id` to persist to `geo_fences` via `PricingRepository`.
   - Update `POST /api/admin/surgezones` to persist to `surge_zones` via `PricingRepository`.
   - Add `PUT /api/admin/surgezones/:id` and `DELETE /api/admin/surgezones/:id` with RBAC and audit logging.
4. **Audit Log Integration**:
   - Ensure all admin pricing, geofence, and surge mutations write to `db.auditLogRepo.create(...)` with verified admin identity.
5. **Test Suite Module 24**:
   - Add Module 24 in `backend/test_suite.js` covering GEO-01 through GEO-14.
6. **Restart Test Extension**:
   - Verify pricing changes, geofence additions, and surge zones survive server restarts in `backend/restart_test.js`.

---

## R. Optional Hardening (Future Candidates)

- Real-time Redis/PubSub cache invalidation across distributed server nodes.
- Polygon vertex simplification algorithms for complex boundary maps.
- Time-zone aware cron daemon to transition `SCHEDULED` surge zones to `ACTIVE` automatically.

---

## S. Future Enhancements

- PostGIS extension integration for complex spatial intersection queries when operational zones scale into thousands.
- Driver heatmap visualization based on live demand and dynamic surge multipliers.

---

## T. Detailed Implementation Plan

### 1. New File: `backend/src/repositories/PricingRepository.js`
- Authoritative PostgreSQL interface for:
  - `pricing_configurations`: `getMatrix()`, `updateConfig(serviceType, fields, admin)`
  - `geo_fences`: `list()`, `create(payload, admin)`, `update(id, payload, admin)`, `delete(id, admin)`
  - `surge_zones`: `list()`, `create(payload, admin)`, `update(id, payload, admin)`, `delete(id, admin)`

### 2. Modify: `backend/src/database.js`
- Import and instantiate `PricingRepository`.
- Extend `initPostgres()` to hydrate `pricingConfig`, `geoFences`, and `surgeZones` from PostgreSQL.
- Update `addGeoFence`, `addSurgeZone`, `updatePricing` to persist via `pricingRepo`.

### 3. Modify: `backend/src/server.js`
- Protect `GET /api/admin/geofences` with `authenticateAdmin, requirePermission('geofence.view')`.
- Protect `GET /api/admin/surgezones` with `authenticateAdmin, requirePermission('surge.view')`.
- Protect `GET /api/admin/pricing` with `authenticateAdmin, requirePermission('pricing.edit')`.
- Ensure write routes await `pricingRepo` and write audit logs.

### 4. Modify: `backend/test_suite.js`
- Add Module 24 (14 assertions: GEO-01 to GEO-14).

### 5. Modify: `backend/restart_test.js`
- Validate pricing, geofence, and surge zone survival across restart.

---

## U. Test Plan (Module 24 Assertions)

- **GEO-01 (SEC)**: Unauthenticated `GET /api/admin/geofences` rejected with 401.
- **GEO-02 (SEC)**: Admin without `geofence.view` rejected from `GET /api/admin/geofences` with 403.
- **GEO-03 (SEC)**: Unauthenticated `GET /api/admin/surgezones` rejected with 401.
- **GEO-04 (SEC)**: Admin without `surge.view` rejected from `GET /api/admin/surgezones` with 403.
- **GEO-05 (PERSIST)**: Admin creates Circle Geofence; persists in `public.geo_fences` with UUID.
- **GEO-06 (PERSIST)**: Admin creates Polygon Geofence; persists in `public.geo_fences`.
- **GEO-07 (PERSIST)**: Admin updates Pricing Matrix (e.g., 4W base fare); persists in `public.pricing_configurations`.
- **GEO-08 (PERSIST)**: Admin creates Surge Zone linked to Geofence; persists in `public.surge_zones`.
- **GEO-09 (SPATIAL)**: Coordinate evaluation inside circle zone triggers zone surcharge and multiplier.
- **GEO-10 (SPATIAL)**: Coordinate evaluation outside all geofences uses standard operational pricing.
- **GEO-11 (FARE)**: `calculateFareEstimate` calculates authoritative fare integrating distance, time, geofence, surge, and minimum fare.
- **GEO-12 (AUDIT)**: Administrative pricing update creates exactly one `PRICING_UPDATED` audit record in PostgreSQL.
- **GEO-13 (AUDIT)**: Administrative geofence deletion creates exactly one `GEOFENCE_DELETED` audit record.
- **GEO-14 (RESTART)**: Custom pricing configuration and geofence survive server termination and cold restart.

---

## V. Rollback Strategy

1. All new repository methods fallback safely if `SUPABASE_POSTGRES_LIVE=false`.
2. Git commit history allows instantaneous reversion (`git revert`).
3. No schema modifications or migrations are being applied, guaranteeing zero database migration rollback risk.

---

## W. Remote Supabase Safety Confirmation

- Neither remote Supabase URL is referenced or contacted.
- All testing and validation target local Docker PostgreSQL exclusively (`127.0.0.1:54321` / `supabase_db_nabin`).
- `supabase link`, `supabase db push`, and `supabase db reset` are strictly forbidden and will not be run.

---

## X. Phase 9 Implementation & Verification Report

### 1. Implementation Summary
- **PricingRepository Created**: Implemented `PricingRepository.js` providing authoritative PostgreSQL persistence for `pricing_configurations`, `geo_fences`, and `surge_zones`.
- **Database Integration**: Instantiated `this.pricingRepo` in `database.js`. Extended `initPostgres()` to hydrate `pricingConfig`, `geoFences`, and `surgeZones` from PostgreSQL on cold start.
- **RBAC Hardening**:
  - `GET /api/admin/geofences` secured with `authenticateAdmin, requirePermission('geofence.view')`.
  - `GET /api/admin/surgezones` secured with `authenticateAdmin, requirePermission('surge.view')`.
  - `GET /api/admin/pricing` secured with `authenticateAdmin, requirePermission('pricing.edit')`.
  - `POST /api/admin/pricing` secured with `authenticateAdmin, requirePermission('pricing.edit')`.
  - `POST /api/admin/geofences` secured with `authenticateAdmin, requirePermission('geofence.create')`.
  - `DELETE /api/admin/geofences/:id` secured with `authenticateAdmin, requirePermission('geofence.delete')`.
  - `POST /api/admin/surgezones` secured with `authenticateAdmin, requirePermission('surge.create')`.
- **Audit Log Verification**: Privileged administrative state changes are written directly to `db.auditLogRepo.create(...)` with verified admin identity.
- **Client Trust Boundary Enforcement**: Verified that client attempts to tamper with fares, surge multipliers, discounts, or platform fees in booking requests are strictly rejected; the server-side calculated fare is enforced.

### 2. Verification & Test Tallies
- **Backend Test Suite (`test_suite.js`)**: **180 / 180 PASSED** (0 failed). All 19 assertions in Module 24 passed.
- **Restart Test (`restart_test.js`)**: **23 / 23 PASSED** (0 failed). Proved custom pricing, geofences, surge zones, and spatial fare estimations survive process termination and cold restart.
- **Flutter Analyze (`mobile/`)**: **No issues found!** (0 issues).
- **Flutter Tests (`mobile/`)**: **18 / 18 PASSED** (All tests passed!).

### 3. Database & Migration Verification
- `public.pricing_configurations`, `public.geo_fences`, and `public.surge_zones` persist authoritatively in local Docker PostgreSQL.
- Migrations 001–015 remain byte-for-byte unchanged.
- Migration 016 was not created.

### 4. Optional Hardening Deferred
- Scheduled surge cron evaluations, polygon vertex simplification, and PostGIS remain deferred as optional future work.

