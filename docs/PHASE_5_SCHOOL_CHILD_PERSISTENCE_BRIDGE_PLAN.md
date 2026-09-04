# NABIN — PHASE 5: SCHOOL & CHILD POSTGRESQL PERSISTENCE BRIDGE PLAN

**Date:** 2026-09-04  
**Author:** Antigravity Autonomous Pair Programmer  
**Baseline Commit:** `dcbf832a87de822564322cf71d2a22968bf0d867`  
**Status:** IMPLEMENTED & VERIFIED — Ready for Commit  

---

## 1. Objective

Connect the School & Child domain API (`/api/schools`, `/api/children`) to PostgreSQL-authoritative persistence using the `saved_schools` and `saved_children` tables created by Migration 015.

**After this bridge:**
- Schools and children saved by a parent survive a backend restart.
- Each parent sees only their own schools and children.
- `user_id` is derived exclusively from the authenticated session token — never trusted from the client.
- All CRUD operations fail loudly if PostgreSQL is unavailable.
- No migration 016 is required or created.

---

## 2. Current Architecture

### Current Flow (In-Memory Only)

```
Flutter App
  └─ SchoolChildRepository.instance (in-memory Dart list, seeded)
       └─ HTTP → /api/schools, /api/children  (NO auth header used/checked)
                    │
              server.js (NO authenticateUser middleware on these routes)
                    │
              database.js
                    ├─ getSchools()     → this.savedSchools[] (in-memory array)
                    ├─ addSchool()      → push to in-memory array
                    ├─ updateSchool()   → array find+replace
                    ├─ deleteSchool()   → array splice
                    ├─ getChildren()    → this.savedChildren[] (in-memory array)
                    ├─ addChild()       → push to in-memory array
                    ├─ updateChild()    → array find+replace
                    └─ deleteChild()    → array splice
```

### Deficiencies Identified

1. No authentication — any caller can read/write any school or child record.
2. No ownership enforcement — `getSchools()` returns ALL users' schools.
3. No PostgreSQL write — all data lost on backend restart.
4. `addSchool()` generates `sch_${Date.now()}` IDs, not UUIDs.
5. No field validation — invalid coordinates accepted silently.
6. `this.savedChildren` seed data contains rejected fields (`schoolAddress`, `schoolLat`, `schoolLng`) not present in PostgreSQL schema.

### Current In-Memory Collections

| Variable | Lines in database.js | State |
|:---|:---:|:---|
| `this.savedSchools` | 1152–1191 | 2 seeded dev schools; in-memory only |
| `this.savedChildren` | 1193–1212 | 1 seeded child; contains 3 rejected fields |

---

## 3. Target Architecture

### Target Flow (PostgreSQL-Authoritative)

```
Flutter App
  └─ SchoolChildRepository.instance (in-memory Dart cache only)
       └─ HTTP → /api/schools, /api/children  (Bearer token required)
                    │
              server.js (authenticateUser middleware now applied)
                    │
              SchoolChildRepository.js [NEW]
                    │                       │
            isLivePostgres=true         isLivePostgres=false (offline dev)
                    │                       │
          supabaseAdmin.*             in-memory array (dev fallback)
                    │
          saved_schools / saved_children (PostgreSQL via Migration 015)
```

### Authoritative Write Sequence

```
API Request (Bearer token) →
  authenticateUser middleware →
  extract authenticatedUserId from req.user (NEVER from req.body) →
  field validation (required fields, coordinate bounds) →
  ownership check (for PUT/DELETE) →
  PostgreSQL INSERT/UPDATE/DELETE via supabaseAdmin →
  verify successful DB response →
  return success response

On DB failure: return 503 — do NOT write to memory as fallback
```

---

## 4. API Contract Mapping

All 6 existing routes retain the same HTTP method, path, and response shape. The only changes are: (a) auth middleware added, (b) handlers become async, (c) data source changes from in-memory to PostgreSQL.

| Method | Route | Auth Required | Current Data Source | Target Data Source |
|:---|:---|:---:|:---|:---|
| `GET` | `/api/schools` | ✅ Now required | `this.savedSchools` | `saved_schools WHERE user_id = auth` |
| `POST` | `/api/schools` | ✅ Now required | Array push | `INSERT INTO saved_schools` |
| `PUT` | `/api/schools/:id` | ✅ Now required | Array find+replace | `UPDATE saved_schools WHERE id AND user_id` |
| `DELETE` | `/api/schools/:id` | ✅ Now required | Array splice | `DELETE FROM saved_schools WHERE id AND user_id` |
| `GET` | `/api/children` | ✅ Now required | `this.savedChildren` | `saved_children WHERE user_id = auth` |
| `POST` | `/api/children` | ✅ Now required | Array push | `INSERT INTO saved_children` |
| `PUT` | `/api/children/:id` | ✅ Now required | Array find+replace | `UPDATE saved_children WHERE id AND user_id` |
| `DELETE` | `/api/children/:id` | ✅ Now required | Array splice | `DELETE FROM saved_children WHERE id AND user_id` |

**Breaking change:** Auth header is now required. Flutter already sends tokens; this does not break the Flutter app.

---

## 5. Repository Design

### New File: `backend/src/repositories/SchoolChildRepository.js`

Follows the exact same pattern as `UserRepository.js` and `DriverRepository.js`:
- Constructor takes `db` reference
- `isLivePostgres` guard gates PostgreSQL vs in-memory path
- `supabaseAdmin` for all DB writes
- `resolveOwnerUuid(userId)` maps legacy IDs via `db.userRepo.resolveUuid()`
- Row mapper functions: `mapRowToSchool()`, `mapRowToChild()`

#### School Methods

| Method | Signature | PostgreSQL Operation |
|:---|:---|:---|
| `getSchoolsByUser` | `async (userId)` | `SELECT * FROM saved_schools WHERE user_id = $uuid` |
| `getSchoolById` | `async (schoolId, userId)` | `SELECT * WHERE id = $id AND user_id = $uuid` |
| `createSchool` | `async (userId, payload)` | `INSERT INTO saved_schools ... RETURNING *` |
| `updateSchool` | `async (schoolId, userId, payload)` | `UPDATE ... WHERE id = $id AND user_id = $uuid RETURNING *` |
| `deleteSchool` | `async (schoolId, userId)` | `DELETE WHERE id = $id AND user_id = $uuid RETURNING id` |

#### Child Methods

| Method | Signature | PostgreSQL Operation |
|:---|:---|:---|
| `getChildrenByUser` | `async (userId)` | `SELECT * FROM saved_children WHERE user_id = $uuid` |
| `getChildById` | `async (childId, userId)` | `SELECT * WHERE id = $id AND user_id = $uuid` |
| `createChild` | `async (userId, payload)` | Validates school cross-ownership; `INSERT INTO saved_children ... RETURNING *` |
| `updateChild` | `async (childId, userId, payload)` | Re-validates school if school_id changes; `UPDATE ... RETURNING *` |
| `deleteChild` | `async (childId, userId)` | `DELETE WHERE id = $id AND user_id = $uuid RETURNING id` |

---

## 6. Authentication & Ownership Design

### User Identity Source

```javascript
// In every route handler:
const authenticatedUser = req.user;          // Set by authenticateUser middleware
if (!authenticatedUser) return res.status(401).json({ ... });

const userId = authenticatedUser.id;          // Legacy ID (e.g. 'usr_1')
const ownerUuid = db.userRepo.resolveUuid(userId); // UUID for PostgreSQL queries
// NEVER: const userId = req.body.user_id;
```

### Ownership Enforcement Matrix

| Operation | Enforcement Method | Failure Response |
|:---|:---|:---|
| `GET /api/schools` | `WHERE user_id = authenticatedUserId` | Empty array (no leakage) |
| `GET /api/children` | `WHERE user_id = authenticatedUserId` | Empty array |
| `POST /api/schools` | `user_id` injected server-side | N/A |
| `POST /api/children` | `user_id` injected; `school_id` cross-checked for same owner | HTTP 400 if cross-user school |
| `PUT /api/schools/:id` | `WHERE id = $id AND user_id = $uuid` | HTTP 404 (no existence leak) |
| `PUT /api/children/:id` | `WHERE id = $id AND user_id = $uuid` | HTTP 404 |
| `DELETE /api/schools/:id` | `WHERE id = $id AND user_id = $uuid` | HTTP 404 |
| `DELETE /api/children/:id` | `WHERE id = $id AND user_id = $uuid` | HTTP 404 |
| No token | `authenticateUser` middleware | HTTP 401 |

### Cross-User School Reference Protection (Child Create/Update)

```javascript
if (payload.school_id) {
  const school = await schoolChildRepo.getSchoolById(payload.school_id, userId);
  if (!school) throw { status: 400, message: 'Invalid school_id: not found or does not belong to you' };
  childPayload.school_name = school.name; // Denormalize school_name
}
```

This provides a friendly error message for the composite FK constraint before hitting PostgreSQL.

### Why Service Role Access

`supabaseAdmin` (service role key) is used — same as all existing repositories. RLS is bypassed, therefore **application-level ownership enforcement via `WHERE user_id = $uuid` predicates is mandatory**. The service role key is never exposed to clients.

---

## 7. Field Mapping

### saved_schools

| Flutter | API JSON | PostgreSQL Column | Required | Validation |
|:---|:---|:---|:---:|:---|
| `id` | `id` | `id` UUID | Server-gen | Never from client body |
| — | — | `user_id` UUID | Server | From `req.user.id` |
| `name` | `name` | `name` VARCHAR(200) | ✅ | Non-empty, max 200 |
| `address` | `address` | `address` TEXT | ✅ | Non-empty |
| `latitude` | `latitude` | `latitude` NUMERIC(10,7) | ✅ | −90.0 to 90.0 |
| `longitude` | `longitude` | `longitude` NUMERIC(10,7) | ✅ | −180.0 to 180.0 |
| `photoUrl` | `photoUrl` | `photo_url` TEXT | ❌ | Optional |
| `instructions` | `instructions` | `instructions` TEXT | ❌ | Optional |
| `isFavorite` | `isFavorite` | `is_favorite` BOOLEAN | ❌ | Default false |
| `generalTimingSummary` | `generalTimingSummary` | `general_timing_summary` VARCHAR(150) | ❌ | Default '8:30 AM – 2:30 PM • Mon–Fri' |
| `customDayTimings` | `customDayTimings` | `custom_day_timings` JSONB | ❌ | Array of day objects; default `[]` |
| — | — | `created_at` TIMESTAMPTZ | DB default | |
| — | — | `updated_at` TIMESTAMPTZ | DB default | Set on UPDATE |

### saved_children

| Flutter | API JSON | PostgreSQL Column | Required | Notes |
|:---|:---|:---|:---:|:---|
| `id` | `id` | `id` UUID | Server-gen | Never from client body |
| — | — | `user_id` UUID | Server | From `req.user.id` |
| `fullName` | `fullName` | `full_name` VARCHAR(150) | ✅ | Non-empty, max 150 |
| `photoUrl` | `photoUrl` | `photo_url` TEXT | ❌ | Optional |
| `schoolId` | `schoolId` | `school_id` UUID | ❌ | Cross-ownership validated |
| `schoolName` | `schoolName` | `school_name` VARCHAR(200) | ❌ | Denormalized display fallback |
| `gradeClass` | `gradeClass` | `grade_class` VARCHAR(50) | ✅ | Non-empty |
| `section` | `section` | `section` VARCHAR(20) | ❌ | Optional |
| `guardianName` | `guardianName` | `guardian_name` VARCHAR(150) | ✅ | Non-empty |
| `guardianPhone` | `guardianPhone` | `guardian_phone` VARCHAR(20) | ✅ | Non-empty |
| `defaultPickupAddress` | `defaultPickupAddress` | `default_pickup_address` TEXT | ✅ | Non-empty |
| `pickupLat` | `pickupLat` | `pickup_lat` NUMERIC(10,7) | ✅ | −90.0 to 90.0 |
| `pickupLng` | `pickupLng` | `pickup_lng` NUMERIC(10,7) | ✅ | −180.0 to 180.0 |
| `specialInstructions` | `specialInstructions` | `special_instructions` TEXT | ❌ | Optional |
| `schoolAddress` ⛔ | `schoolAddress` ⛔ | _(no column)_ | — | STRIPPED on server — column does not exist |
| `schoolLat` ⛔ | `schoolLat` ⛔ | _(no column)_ | — | STRIPPED on server |
| `schoolLng` ⛔ | `schoolLng` ⛔ | _(no column)_ | — | STRIPPED on server |

---

## 8. Cache Strategy

- Schools and children are fetched on-demand per API request. No startup hydration.
- In PostgreSQL-live mode, `this.savedSchools` and `this.savedChildren` arrays are not populated at startup.
- In offline-dev mode, the in-memory arrays are used as before.
- The `persistentStore.js` JSON serialization does NOT need to include schools/children.

---

## 9. Failure Semantics

| Scenario | HTTP Status | Error Message |
|:---|:---:|:---|
| No auth token | 401 | Unauthorized |
| Invalid auth token | 401 | Invalid or expired session |
| PostgreSQL unavailable | 503 | Database unavailable. Please retry. |
| Missing required field | 400 | Missing required field: `<fieldName>` |
| Invalid latitude | 400 | Invalid latitude: must be between -90 and 90 |
| Invalid longitude | 400 | Invalid longitude: must be between -180 and 180 |
| School/child not found or not owned | 404 | School not found / Child not found |
| `school_id` belongs to another user | 400 | Invalid school_id: not found or does not belong to you |
| DB constraint violation | 409 | Database constraint error: `<message>` |
| Unexpected DB error | 503 | Unexpected database error. Please retry. |

**Rule: If PostgreSQL write fails, never claim success. Never write to in-memory as fallback.**

---

## 10. Migration Requirement

**NO NEW MIGRATION IS REQUIRED.**

Migration 015 is complete and provides all required schema:
- `public.saved_schools` (13 columns, indexes, RLS)
- `public.saved_children` (16 columns, composite FK, indexes, RLS)

---

## 11. Test Strategy

New tests to be added to `backend/test_suite.js`:

**School Tests (SC-01–SC-06):** Create, list, update, toggle favorite, delete, restart persistence.

**Child Tests (CC-01–CC-06):** Create with school, create without school, list, update, delete, restart persistence.

**Security Tests (SEC-01–SEC-10):** Unauthenticated access, cross-user school read/update/delete, cross-user child read/update/delete, cross-user school reference on child create.

**Validation Tests (VAL-01–VAL-10):** All required field checks, coordinate bounds, nonexistent record handling, rejected field stripping.

**Regression (REG-01–REG-02):** Full existing test suite (86 tests) must remain passing. School ride booking flow unaffected.

---

## 12. Files Expected to Change

### New Files

| File | Purpose |
|:---|:---|
| `backend/src/repositories/SchoolChildRepository.js` | New PostgreSQL-authoritative repository |
| `docs/PHASE_5_SCHOOL_CHILD_PERSISTENCE_BRIDGE_PLAN.md` | This plan |

### Modified Files

| File | What Changes |
|:---|:---|
| `backend/src/server.js` | Lines 1921–1944: add `authenticateUser`, make async, call `schoolChildRepo.*` |
| `backend/src/database.js` | (1) Remove 3 rejected seed fields from `this.savedChildren`; (2) register `this.schoolChildRepo` |
| `backend/test_suite.js` | Add School/Child test module (append to existing suite) |

### Files That MUST NOT Change

- All migration files (`001`–`015`)
- All Flutter model files (`school_model.dart`, `child_model.dart`, `school_child_repository.dart`, `passenger_booking_info.dart`)
- All Flutter screen files (`ride_booking_screen.dart`, `profile_screen.dart`, etc.)
- `supabase/migrations/015_school_child_domain.sql`

---

## 13. Rollback Strategy

Revert only application code (no schema rollback needed):

1. `git revert` changes to `server.js` (restore in-memory routes)
2. Delete `SchoolChildRepository.js`
3. `git revert` seed cleanup in `database.js`
4. `git revert` test additions

Schema (`saved_schools`, `saved_children`) remains intact. Data written during the bridge period is preserved.

---

## 14. Risks

| Risk | Severity | Mitigation |
|:---|:---|:---|
| Flutter `SavedChild` has rejected fields (`schoolAddress`, `schoolLat`, `schoolLng`) | MEDIUM | Backend strips silently on all writes |
| `authenticateUser` currently allows unauthenticated pass-through (sets `req.user = null`) | MEDIUM | Route handlers explicitly check `if (!req.user)` and return 401 |
| Legacy user IDs (`usr_1`) may not resolve to UUID via `userRepo.resolveUuid()` | LOW | Resolved: `resolveUuid()` has explicit `LEGACY_USER_MAP` for dev seeds |
| Composite FK race on simultaneous school delete + child create | LOW | FK `ON DELETE SET NULL (school_id)` handles atomically at DB level |

---

## 15. Explicit Statement — No Migration Required

> Migration 015 (`015_school_child_domain.sql`) created all schema objects required by this bridge.
> No new migration (016 or otherwise) is required for Phase 5.
> Do not create Migration 016.

---

## 16. Implementation & Verification Results

**Implementation Date:** 2026-09-04  
**Executed Scope:**
- Created [`backend/src/repositories/SchoolChildRepository.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/SchoolChildRepository.js) providing full CRUD, explicit user ownership enforcement via `WHERE user_id = $ownerUuid`, cross-user school attachment protection, and offline dev fallback.
- Updated [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js) to register `this.schoolChildRepo` and purged rejected denormalized school fields (`schoolAddress`, `schoolLat`, `schoolLng`) from the `this.savedChildren` seed.
- Updated [`backend/src/server.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js) replacing in-memory route handlers with `requireCustomerAuth`, async dispatch, input validation, and fail-closed persistence.
- Added **Module 20: School & Child Safe Commute Persistence Bridge** to [`backend/test_suite.js`](file:///c:/Users/macmi/Documents/nabin/backend/test_suite.js) covering 25 comprehensive tests across security, ownership isolation, field validations, composite FK nullification cascade, and test data cleanup.

**Test Suite Results:**
- **Total Tests:** 111 (86 existing regression tests + 25 new persistence & security tests)
- **Passed:** 111 (100%)
- **Failed:** 0
- **Regression:** Zero regressions across Ride, Delivery, Grocery, Dispute, Fleet, and Finance modules.

**Restart Persistence & Isolation Verification:**
- Created record written directly to PostgreSQL `public.saved_schools`.
- Simulated backend process restart; record successfully retrieved from PostgreSQL.
- Updated record committed to PostgreSQL; read preserved across simulated restart.
- Deleted record removed from PostgreSQL; absent after simulated restart.
- Database clean state confirmed (`saved_schools` count: 0, `saved_children` count: 0) with zero test artifacts remaining.

