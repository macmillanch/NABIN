# NABIN — PHASE 2 PROPOSED MIGRATION ROADMAP

**Document Purpose:** Architectural design and roadmap for new database migrations beyond historical baseline migrations `001` through `014`.  
**Baseline Verification:** Migrations `001–014` are authoritative and immutable. Numbering for new migrations starts strictly at **`015`**.  
**Execution Guard:** This is a DESIGN DOCUMENT ONLY. No SQL DDL is executed during this phase.

---

## Migration 015: School & Child Safe Commute Domain

### 1. General Metadata
- **Migration Number:** `015`
- **Proposed Filename:** `015_school_child_domain.sql`
- **Architectural Domain:** Mobility / School Rides & Child Safety
- **Prerequisites / Dependencies:** `001_central_schema.sql` (depends on `public.users` table)
- **Implementation Order:** First new migration to be created in Phase 3.

---

### 2. Objective & Motivation
The NABIN mobile customer application (`mobile/lib/features/ride/presentation/screens/ride_booking_screen.dart`, `mobile/lib/features/profile/presentation/screens/profile_screen.dart`), the Flutter core model package (`SchoolChildRepository`), and the backend API (`/api/schools`, `/api/children`) support a specialized **School Ride Commute** feature. Parents can save verified school destinations (with gate instructions and opening/closing schedules) and register child profiles (with grade, section, school link, and guardian emergency contacts).

Currently, this data is held in transient in-memory arrays (`this.savedSchools` and `this.savedChildren` in `database.js`). Historical migrations `001–014` do not provide tables capable of storing this relational data. Migration 015 establishes durable, secure PostgreSQL tables with complete foreign keys and Row-Level Security (RLS).

---

### 3. Proposed Schema & Declared Objects

```sql
-- =========================================================================
-- NABIN MIGRATION 015: SAVED SCHOOLS & CHILD PROFILES DOMAIN
-- =========================================================================

-- 1. SAVED SCHOOLS TABLE
CREATE TABLE IF NOT EXISTS public.saved_schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    address TEXT NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL,
    longitude NUMERIC(10, 7) NOT NULL,
    is_favorite BOOLEAN DEFAULT false,
    general_timing_summary VARCHAR(150),
    instructions TEXT,
    custom_day_timings JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. SAVED CHILDREN PROFILES TABLE
CREATE TABLE IF NOT EXISTS public.saved_children (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    full_name VARCHAR(150) NOT NULL,
    photo_url TEXT,
    school_id UUID REFERENCES public.saved_schools(id) ON DELETE SET NULL,
    school_name VARCHAR(200),
    school_address TEXT,
    school_lat NUMERIC(10, 7),
    school_lng NUMERIC(10, 7),
    grade_class VARCHAR(50),
    section VARCHAR(20),
    guardian_name VARCHAR(150) NOT NULL,
    guardian_phone VARCHAR(20) NOT NULL,
    default_pickup_address TEXT,
    pickup_lat NUMERIC(10, 7),
    pickup_lng NUMERIC(10, 7),
    special_instructions TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. INDEXES FOR FAST GUARDIAN & SCHOOL LOOKUPS
CREATE INDEX IF NOT EXISTS idx_saved_schools_user_id ON public.saved_schools(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_children_user_id ON public.saved_children(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_children_school_id ON public.saved_children(school_id);

-- 4. ROW-LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.saved_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_children ENABLE ROW LEVEL SECURITY;

-- Guardian owns and manages their saved schools
CREATE POLICY "Users manage own saved schools"
    ON public.saved_schools
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Guardian owns and manages their saved children
CREATE POLICY "Users manage own saved children"
    ON public.saved_children
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service Role full access for backend APIs
CREATE POLICY "Service role full access saved_schools"
    ON public.saved_schools
    FOR ALL
    USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access saved_children"
    ON public.saved_children
    FOR ALL
    USING (auth.role() = 'service_role');
```

---

### 4. Impacted Codebase & Modules

1. **Backend Source (`backend/src/`):**
   - [`backend/src/server.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js): Wire `/api/schools` and `/api/children` endpoints from `db.getSchools()` / `db.getChildren()` to a new `SchoolChildRepository`.
   - [`backend/src/database.js`](file:///c:/Users/macmi/Documents/nabin/backend/src/database.js): Hydrate `this.savedSchools` and `this.savedChildren` from PostgreSQL on startup if in live mode.
   - New Repository: `backend/src/repositories/SchoolChildRepository.js` (standard Supabase CRUD repository pattern).
2. **Flutter Mobile (`mobile/lib/`):**
   - [`mobile/lib/core/models/school_child_repository.dart`](file:///c:/Users/macmi/Documents/nabin/mobile/lib/core/models/school_child_repository.dart): Continues using `/api/schools` and `/api/children` with zero UI code breaks.
3. **Tests (`backend/`):**
   - Add automated test assertions in `backend/test_suite.js` or dedicated `backend/school_child_persistence_test.js` verifying CRUD operations persist to PostgreSQL across reboots.

---

### 5. Security & Privacy Review

- **Minor Data Protection:** Children's personal information (names, school names, pickup gates, photos) is protected with strict Row-Level Security. Unauthenticated users receive HTTP 401. Other customers cannot query or view another customer's children (`auth.uid() = user_id`).
- **Driver Dispatch Scoping:** During active trip dispatch, only the minimal necessary operational details (`childName`, `schoolName`, `pickupAddress`, `specialInstructions`, `startOtp`) are sent to the assigned driver's WebSocket channel; the full database record remains shielded.

---

### 6. Rollback & Reversibility Strategy

Clean down-migration script:
```sql
-- Rollback Migration 015
DROP TABLE IF EXISTS public.saved_children CASCADE;
DROP TABLE IF EXISTS public.saved_schools CASCADE;
```
Because no other tables depend on `saved_schools` or `saved_children`, rolling back Migration 015 carries zero risk of cascading schema corruption.

---

## Future Phased Candidates (Evaluated but NOT Immediately Required)

### Migration 016 (Candidate C): PostGIS Spatial Dispatch
- **Status:** **NOT REQUIRED YET** (Category C — Future Feature).
- **Reasoning:** Driver matchmaking currently evaluates distance and geofence containment in high-performance Node.js memory (`fleetLocations` Map with Haversine and ray-casting algorithms). High-frequency GPS updates are purposefully isolated from database disk writes. PostGIS should only be introduced if fleet volume exceeds in-memory processing capacity.

### Migration 017 (Candidate C): Automated Bank Payout Batch Engine
- **Status:** **NOT REQUIRED YET** (Category C — Future Feature).
- **Reasoning:** The `driver_payouts` table already exists in `002_finance_ledger_schema.sql`. Scheduled payout cron jobs can interact directly with the existing table via backend workers without requiring additional database DDL.

---

## Summary of Migration Action Plan

```text
Historical Migrations:  001 — 014 (VERIFIED HISTORICAL & LOCKED)
Proposed Migration 015: 015_school_child_domain.sql (READY FOR PHASE 3)
Subsequent Migrations:  None currently justified (Defends against unnecessary schema inflation)
```
