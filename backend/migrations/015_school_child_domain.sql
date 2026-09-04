-- ============================================================================
-- NABIN MIGRATION 015: SCHOOL COMMUTE & CHILD SAFETY DOMAIN
-- Migration: 015_school_child_domain.sql
-- Description: Authoritative persistence for saved schools and child profiles.
-- Domain: Mobility / School Safe Commute
-- Prerequisites: 001_central_schema.sql (public.users)
-- Author: Antigravity Autonomous Pair Programmer
-- Date: 2026-09-04
-- Baseline: 331879c3bc4d5a3707ad3eefe805760126813891
-- ============================================================================

-- 1. CREATE SAVED SCHOOLS TABLE
-- Stores a parent/guardian's list of saved school destinations.
-- Physical coordinates (latitude, longitude) are the SINGLE SOURCE OF TRUTH
-- for driver dispatch. No duplicate coordinates exist on saved_children.
CREATE TABLE IF NOT EXISTS public.saved_schools (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID            NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name                    VARCHAR(200)    NOT NULL,
    address                 TEXT            NOT NULL,
    latitude                NUMERIC(10, 7)  NOT NULL CHECK (latitude BETWEEN -90.0 AND 90.0),
    longitude               NUMERIC(10, 7)  NOT NULL CHECK (longitude BETWEEN -180.0 AND 180.0),
    photo_url               TEXT,
    instructions            TEXT,
    is_favorite             BOOLEAN         NOT NULL DEFAULT false,
    general_timing_summary  VARCHAR(150)    DEFAULT '8:30 AM – 2:30 PM • Mon–Fri',
    custom_day_timings      JSONB           NOT NULL DEFAULT '[]'::jsonb,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    -- Composite unique constraint required for the cross-user composite FK on saved_children
    CONSTRAINT uq_saved_schools_id_user UNIQUE (id, user_id)
);

-- 2. CREATE SAVED CHILDREN TABLE
-- Stores child profiles owned by a parent/guardian.
-- Normalization: Physical school location (lat/lng/address) is stored ONLY in
-- saved_schools. saved_children retains only school_name as a resilient display
-- fallback in case the linked school record is later deleted (ON DELETE SET NULL).
-- Speculative columns rejected: school_address, school_lat, school_lng,
-- child_aadhaar_number, blood_group.
CREATE TABLE IF NOT EXISTS public.saved_children (
    id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID            NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    full_name               VARCHAR(150)    NOT NULL,
    photo_url               TEXT,
    school_id               UUID,
    school_name             VARCHAR(200),
    grade_class             VARCHAR(50)     NOT NULL,
    section                 VARCHAR(20),
    guardian_name           VARCHAR(150)    NOT NULL,
    guardian_phone          VARCHAR(20)     NOT NULL,
    default_pickup_address  TEXT            NOT NULL,
    pickup_lat              NUMERIC(10, 7)  NOT NULL CHECK (pickup_lat BETWEEN -90.0 AND 90.0),
    pickup_lng              NUMERIC(10, 7)  NOT NULL CHECK (pickup_lng BETWEEN -180.0 AND 180.0),
    special_instructions    TEXT,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    -- Composite FK: mathematically prevents User B from referencing User A's school.
    -- PostgreSQL 15: ON DELETE SET NULL (school_id) nullifies only school_id,
    -- preserving user_id and the child profile record intact.
    CONSTRAINT fk_saved_children_school_owner
        FOREIGN KEY (school_id, user_id)
        REFERENCES public.saved_schools (id, user_id)
        ON DELETE SET NULL (school_id)
);

-- 3. INDEXES
-- idx_saved_schools_user_id: primary access pattern — load all schools for a user
CREATE INDEX IF NOT EXISTS idx_saved_schools_user_id ON public.saved_schools(user_id);
-- idx_saved_children_user_id: primary access pattern — load all children for a user
CREATE INDEX IF NOT EXISTS idx_saved_children_user_id ON public.saved_children(user_id);
-- idx_saved_children_school_id: FK resolution for composite key lookups and cascade
CREATE INDEX IF NOT EXISTS idx_saved_children_school_id ON public.saved_children(school_id);

-- 4. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.saved_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_children ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    -- Saved Schools: User can manage ONLY their own records
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'saved_schools' AND policyname = 'users_manage_own_schools'
    ) THEN
        CREATE POLICY users_manage_own_schools ON public.saved_schools
            FOR ALL
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;

    -- Saved Schools: Service role has full access for backend server endpoints
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'saved_schools' AND policyname = 'service_role_saved_schools'
    ) THEN
        CREATE POLICY service_role_saved_schools ON public.saved_schools
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;

    -- Saved Children: User can manage ONLY their own child profiles
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'saved_children' AND policyname = 'users_manage_own_children'
    ) THEN
        CREATE POLICY users_manage_own_children ON public.saved_children
            FOR ALL
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;

    -- Saved Children: Service role has full access for backend server endpoints
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'saved_children' AND policyname = 'service_role_saved_children'
    ) THEN
        CREATE POLICY service_role_saved_children ON public.saved_children
            FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;
