-- =========================================================================
-- NABIN PLATFORM — MIGRATION 020
-- Domain: Dispatch Security, Driver Isolation & Atomic Assignment Primitive
-- Baseline: Migrations 001–016, 018, 019 Unchanged
-- =========================================================================

-- =========================================================================
-- 1. DISPATCH_OFFERS SCHEMA HARDENING (UUID DRIVER LINKAGE & INDEXES)
-- =========================================================================

-- Add backward-compatible driver_uuid FK linking to public.drivers(id)
ALTER TABLE public.dispatch_offers
    ADD COLUMN IF NOT EXISTS driver_uuid UUID REFERENCES public.drivers(id) ON DELETE SET NULL;

-- Partial and composite indexes for fast dispatch queries and tenant filtering
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_driver_uuid
    ON public.dispatch_offers(driver_uuid)
    WHERE driver_uuid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_offers_job_active
    ON public.dispatch_offers(job_uuid, status)
    WHERE status = 'OFFERED';

CREATE INDEX IF NOT EXISTS idx_dispatch_offers_driver_active
    ON public.dispatch_offers(driver_uuid, status)
    WHERE status = 'OFFERED';

CREATE INDEX IF NOT EXISTS idx_dispatch_offers_expires_active
    ON public.dispatch_offers(expires_at, status)
    WHERE status = 'OFFERED';

-- =========================================================================
-- 2. DISPATCH_OFFERS RLS TIGHTENING (ELIMINATE OVERLY BROAD USING(TRUE))
-- =========================================================================

ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;

-- Drop insecure, wide-open policies from Migration 014
DROP POLICY IF EXISTS driver_dispatch_select ON public.dispatch_offers;
DROP POLICY IF EXISTS driver_dispatch_update ON public.dispatch_offers;
DROP POLICY IF EXISTS driver_dispatch_insert ON public.dispatch_offers;
DROP POLICY IF EXISTS service_role_dispatch_all ON public.dispatch_offers;

-- Re-create authoritative service_role policy (full access)
CREATE POLICY service_role_dispatch_all ON public.dispatch_offers
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Authenticated drivers can ONLY view their own dispatch offers
-- Verified against auth.uid() mapped to public.drivers(user_id) or driver_uuid/driver_id
CREATE POLICY driver_dispatch_select ON public.dispatch_offers
    FOR SELECT
    TO authenticated
    USING (
        (driver_uuid IS NOT NULL AND driver_uuid IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
        OR (driver_id = auth.uid()::text)
        OR (driver_id IN (SELECT id::text FROM public.drivers WHERE user_id = auth.uid()))
    );

-- Authenticated drivers can ONLY update (e.g. reject/respond) their own offers
CREATE POLICY driver_dispatch_update ON public.dispatch_offers
    FOR UPDATE
    TO authenticated
    USING (
        (driver_uuid IS NOT NULL AND driver_uuid IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
        OR (driver_id = auth.uid()::text)
        OR (driver_id IN (SELECT id::text FROM public.drivers WHERE user_id = auth.uid()))
    )
    WITH CHECK (
        (driver_uuid IS NOT NULL AND driver_uuid IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()))
        OR (driver_id = auth.uid()::text)
        OR (driver_id IN (SELECT id::text FROM public.drivers WHERE user_id = auth.uid()))
    );

-- Direct client INSERT is strictly forbidden; dispatch offers are platform-generated via service_role
REVOKE ALL ON public.dispatch_offers FROM anon;
REVOKE ALL ON public.dispatch_offers FROM public;
GRANT SELECT, UPDATE ON public.dispatch_offers TO authenticated;
GRANT ALL ON public.dispatch_offers TO service_role;

-- =========================================================================
-- 3. AUTHORITATIVE ATOMIC OFFER ACCEPTANCE PRIMITIVE
-- =========================================================================

CREATE OR REPLACE FUNCTION public.accept_dispatch_offer_atomic(
    p_offer_id UUID,
    p_driver_id UUID,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_offer RECORD;
    v_job RECORD;
    v_driver RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_job_uuid UUID;
BEGIN
    -- 1. Inspect dispatch offer (read uncommitted metadata to identify parent job)
    SELECT * INTO v_offer
    FROM public.dispatch_offers
    WHERE id = p_offer_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'OFFER_NOT_FOUND',
            'error', 'Dispatch offer not found.'
        );
    END IF;

    -- 2. Strict Driver Ownership Verification (Fast reject before acquiring locks)
    IF v_offer.driver_uuid IS NOT NULL AND v_offer.driver_uuid <> p_driver_id THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DRIVER_MISMATCH',
            'error', 'Dispatch offer is not assigned to this driver.'
        );
    END IF;
    IF v_offer.driver_uuid IS NULL AND v_offer.driver_id <> p_driver_id::text THEN
        -- Check if driver_id matches driver's string ID or legacy format
        SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
        IF NOT FOUND OR (v_offer.driver_id <> v_driver.id::text AND v_offer.driver_id <> v_driver.phone) THEN
            RETURN jsonb_build_object(
                'success', false,
                'code', 'DRIVER_MISMATCH',
                'error', 'Dispatch offer is not assigned to this driver.'
            );
        END IF;
    END IF;

    -- 3. Resolve parent job UUID
    v_job_uuid := v_offer.job_uuid;
    IF v_job_uuid IS NULL THEN
        SELECT id INTO v_job_uuid FROM public.jobs WHERE job_number = v_offer.job_id;
    END IF;

    IF v_job_uuid IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_FOUND',
            'error', 'Associated job not found for this dispatch offer.'
        );
    END IF;

    -- 4. STRICT GLOBAL LOCK ACQUISITION ORDER:
    -- Parent job row is ALWAYS locked FIRST before any offer rows.
    -- This enforces single-queue serialization on the parent resource and eliminates cross-table deadlocks.
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = v_job_uuid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_FOUND',
            'error', 'Associated job not found.'
        );
    END IF;

    -- 5. Lock the dispatch offer row FOR UPDATE
    SELECT * INTO v_offer
    FROM public.dispatch_offers
    WHERE id = p_offer_id
    FOR UPDATE;

    -- 6. Idempotent Acceptance Replay Check (Same driver already accepted this offer)
    IF v_offer.status = 'ACCEPTED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'code', 'OFFER_ALREADY_ACCEPTED',
            'message', 'Dispatch offer already accepted by this driver.',
            'offer_id', v_offer.id,
            'job_id', COALESCE(v_job.job_number, v_offer.job_id),
            'job_uuid', v_offer.job_uuid,
            'driver_id', p_driver_id,
            'status', 'ASSIGNED'
        );
    END IF;

    -- 7. Offer Status & TTL Validity Checks
    IF v_offer.status <> 'OFFERED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'OFFER_NOT_AVAILABLE',
            'error', format('Dispatch offer is in %s status and cannot be accepted.', v_offer.status)
        );
    END IF;

    IF v_offer.expires_at < v_now THEN
        UPDATE public.dispatch_offers
        SET status = 'EXPIRED', updated_at = v_now
        WHERE id = p_offer_id;

        RETURN jsonb_build_object(
            'success', false,
            'code', 'OFFER_EXPIRED',
            'error', 'Dispatch offer has expired.'
        );
    END IF;

    -- 6. Check Job Status & Assignability (Race Condition Protection)
    -- If job is already assigned to THIS driver -> idempotent return
    IF v_job.status = 'ASSIGNED' AND v_job.driver_id = p_driver_id THEN
        UPDATE public.dispatch_offers
        SET status = 'ACCEPTED', responded_at = v_now, driver_uuid = p_driver_id, updated_at = v_now
        WHERE id = p_offer_id;

        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'code', 'JOB_ALREADY_ASSIGNED_TO_DRIVER',
            'message', 'Job is already assigned to this driver.',
            'offer_id', p_offer_id,
            'job_id', v_job.job_number,
            'job_uuid', v_job_uuid,
            'driver_id', p_driver_id,
            'status', 'ASSIGNED'
        );
    END IF;

    -- If job is already assigned to ANOTHER driver -> reject and cancel this offer
    IF v_job.status = 'ASSIGNED' AND (v_job.driver_id IS NOT NULL AND v_job.driver_id <> p_driver_id) THEN
        UPDATE public.dispatch_offers
        SET status = 'CANCELLED', rejection_reason = 'JOB_ALREADY_ASSIGNED', updated_at = v_now
        WHERE id = p_offer_id;

        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_ALREADY_ASSIGNED',
            'error', 'Job has already been assigned to another driver.'
        );
    END IF;

    -- Job must be in assignable state
    IF v_job.status NOT IN ('REQUESTED', 'SEARCHING', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP') THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_ASSIGNABLE',
            'error', format('Job cannot be assigned in status %s.', v_job.status)
        );
    END IF;

    -- 7. Driver Operational Eligibility Check
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DRIVER_NOT_FOUND',
            'error', 'Driver profile not found.'
        );
    END IF;

    IF v_driver.operational_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DRIVER_SUSPENDED',
            'error', 'Suspended driver cannot accept trips.'
        );
    END IF;

    -- 8. Authoritative Atomic Mutations:
    -- (a) Accept this offer
    UPDATE public.dispatch_offers
    SET status = 'ACCEPTED',
        responded_at = v_now,
        driver_uuid = COALESCE(driver_uuid, p_driver_id),
        job_uuid = COALESCE(job_uuid, v_job_uuid),
        updated_at = v_now
    WHERE id = p_offer_id;

    -- (b) Authoritatively assign job to this driver
    UPDATE public.jobs
    SET status = 'ASSIGNED',
        driver_id = p_driver_id,
        updated_at = v_now
    WHERE id = v_job_uuid;

    -- (c) Automatically cancel all other competing pending offers for this job
    UPDATE public.dispatch_offers
    SET status = 'CANCELLED',
        rejection_reason = 'JOB_ASSIGNED_TO_OTHER_DRIVER',
        updated_at = v_now
    WHERE (job_uuid = v_job_uuid OR job_id = v_job.job_number)
      AND id <> p_offer_id
      AND status = 'OFFERED';

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'code', 'OFFER_ACCEPTED',
        'offer_id', p_offer_id,
        'job_id', v_job.job_number,
        'job_uuid', v_job_uuid,
        'driver_id', p_driver_id,
        'status', 'ASSIGNED',
        'accepted_at', v_now
    );
END;
$$;

-- =========================================================================
-- 4. AUTHORITATIVE ATOMIC JOB ASSIGNMENT BY JOB IDENTIFIER
-- =========================================================================

CREATE OR REPLACE FUNCTION public.accept_job_assignment_atomic(
    p_job_identifier TEXT,
    p_driver_id UUID,
    p_offer_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job RECORD;
    v_driver RECORD;
    v_offer RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_job_uuid UUID;
BEGIN
    -- 1. If offer_id is explicitly provided, delegate directly to accept_dispatch_offer_atomic
    IF p_offer_id IS NOT NULL THEN
        RETURN public.accept_dispatch_offer_atomic(p_offer_id, p_driver_id, p_idempotency_key);
    END IF;

    -- 2. Resolve job UUID by id or job_number
    IF p_job_identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT id INTO v_job_uuid FROM public.jobs WHERE id = p_job_identifier::UUID;
    ELSE
        SELECT id INTO v_job_uuid FROM public.jobs WHERE job_number = p_job_identifier;
    END IF;

    IF v_job_uuid IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_FOUND',
            'error', 'Job not found.'
        );
    END IF;

    -- 3. Lock job row FOR UPDATE
    SELECT * INTO v_job
    FROM public.jobs
    WHERE id = v_job_uuid
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_FOUND',
            'error', 'Job not found.'
        );
    END IF;

    -- 4. Idempotent check: already assigned to this driver
    IF v_job.status = 'ASSIGNED' AND v_job.driver_id = p_driver_id THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'code', 'JOB_ALREADY_ASSIGNED_TO_DRIVER',
            'message', 'Job is already assigned to this driver.',
            'job_id', v_job.job_number,
            'job_uuid', v_job_uuid,
            'driver_id', p_driver_id,
            'status', 'ASSIGNED'
        );
    END IF;

    -- If assigned to another driver -> conflict
    IF v_job.status = 'ASSIGNED' AND (v_job.driver_id IS NOT NULL AND v_job.driver_id <> p_driver_id) THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_ALREADY_ASSIGNED',
            'error', 'Job has already been assigned to another driver.'
        );
    END IF;

    IF v_job.status NOT IN ('REQUESTED', 'SEARCHING', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP') THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'JOB_NOT_ASSIGNABLE',
            'error', format('Job cannot be assigned in status %s.', v_job.status)
        );
    END IF;

    -- 5. Driver eligibility check
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DRIVER_NOT_FOUND',
            'error', 'Driver profile not found.'
        );
    END IF;

    IF v_driver.operational_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'DRIVER_SUSPENDED',
            'error', 'Suspended driver cannot accept trips.'
        );
    END IF;

    -- 6. Lock and transition any matching dispatch offer for this driver and job if one exists
    SELECT * INTO v_offer
    FROM public.dispatch_offers
    WHERE (job_uuid = v_job_uuid OR job_id = v_job.job_number)
      AND (driver_uuid = p_driver_id OR driver_id = p_driver_id::text OR driver_id = v_driver.id::text)
      AND status = 'OFFERED'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        IF v_offer.expires_at < v_now THEN
            UPDATE public.dispatch_offers
            SET status = 'EXPIRED', updated_at = v_now
            WHERE id = v_offer.id;

            RETURN jsonb_build_object(
                'success', false,
                'code', 'OFFER_EXPIRED',
                'error', 'Dispatch offer has expired.'
            );
        END IF;

        UPDATE public.dispatch_offers
        SET status = 'ACCEPTED', responded_at = v_now, driver_uuid = p_driver_id, updated_at = v_now
        WHERE id = v_offer.id;
    END IF;

    -- 7. Atomically assign job to driver
    UPDATE public.jobs
    SET status = 'ASSIGNED',
        driver_id = p_driver_id,
        updated_at = v_now
    WHERE id = v_job_uuid;

    -- 8. Cancel competing offers for this job
    UPDATE public.dispatch_offers
    SET status = 'CANCELLED',
        rejection_reason = 'JOB_ASSIGNED_TO_OTHER_DRIVER',
        updated_at = v_now
    WHERE (job_uuid = v_job_uuid OR job_id = v_job.job_number)
      AND (v_offer.id IS NULL OR id <> v_offer.id)
      AND status = 'OFFERED';

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'offer_id', v_offer.id,
        'job_id', v_job.job_number,
        'job_uuid', v_job_uuid,
        'driver_id', p_driver_id,
        'status', 'ASSIGNED',
        'accepted_at', v_now
    );
END;
$$;

-- =========================================================================
-- 5. ATOMIC DISPATCH OFFER CREATION PRIMITIVE
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_dispatch_offer_atomic(
    p_job_uuid UUID,
    p_driver_uuid UUID,
    p_ttl_seconds INT DEFAULT 30,
    p_idempotency_key TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job RECORD;
    v_driver RECORD;
    v_now TIMESTAMPTZ := clock_timestamp();
    v_expires_at TIMESTAMPTZ;
    v_new_offer_id UUID;
    v_existing RECORD;
BEGIN
    v_expires_at := v_now + (COALESCE(p_ttl_seconds, 30) || ' seconds')::INTERVAL;

    -- 1. Idempotency check if key provided
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM public.dispatch_offers
        WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'offer_id', v_existing.id,
                'status', v_existing.status,
                'expires_at', v_existing.expires_at
            );
        END IF;
    END IF;

    -- 2. Verify Job exists and is in assignable state
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_uuid;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_FOUND', 'error', 'Job not found.');
    END IF;

    IF v_job.status NOT IN ('REQUESTED', 'SEARCHING', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP') THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_ASSIGNABLE', 'error', format('Job cannot receive dispatch offers in status %s.', v_job.status));
    END IF;

    -- 3. Verify Driver exists and is eligible
    SELECT * INTO v_driver FROM public.drivers WHERE id = p_driver_uuid;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'DRIVER_NOT_FOUND', 'error', 'Driver profile not found.');
    END IF;

    IF v_driver.operational_status = 'SUSPENDED' THEN
        RETURN jsonb_build_object('success', false, 'code', 'DRIVER_SUSPENDED', 'error', 'Suspended driver cannot receive dispatch offers.');
    END IF;

    -- 4. Check if active offer already exists for this driver and job
    SELECT * INTO v_existing
    FROM public.dispatch_offers
    WHERE job_uuid = p_job_uuid
      AND (driver_uuid = p_driver_uuid OR driver_id = p_driver_uuid::text)
      AND status = 'OFFERED'
      AND expires_at > v_now;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'offer_id', v_existing.id,
            'status', v_existing.status,
            'expires_at', v_existing.expires_at
        );
    END IF;

    -- 5. Insert new dispatch offer
    v_new_offer_id := gen_random_uuid();
    INSERT INTO public.dispatch_offers (
        id,
        job_id,
        job_uuid,
        driver_id,
        driver_uuid,
        status,
        offered_at,
        expires_at,
        idempotency_key,
        metadata,
        created_at,
        updated_at
    ) VALUES (
        v_new_offer_id,
        v_job.job_number,
        p_job_uuid,
        p_driver_uuid::text,
        p_driver_uuid,
        'OFFERED',
        v_now,
        v_expires_at,
        p_idempotency_key,
        p_metadata,
        v_now,
        v_now
    );

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'offer_id', v_new_offer_id,
        'job_id', v_job.job_number,
        'job_uuid', p_job_uuid,
        'driver_uuid', p_driver_uuid,
        'status', 'OFFERED',
        'offered_at', v_now,
        'expires_at', v_expires_at
    );
END;
$$;

-- =========================================================================
-- 6. SECURITY DEFINER PRIVILEGES
-- =========================================================================

GRANT EXECUTE ON FUNCTION public.accept_dispatch_offer_atomic TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_job_assignment_atomic TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.create_dispatch_offer_atomic TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_dispatch_offer_atomic FROM anon, public, authenticated;
REVOKE EXECUTE ON FUNCTION public.accept_dispatch_offer_atomic FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.accept_job_assignment_atomic FROM anon, public;
