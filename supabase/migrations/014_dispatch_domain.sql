-- =========================================================================
-- NABIN PLATFORM — DOMAIN 14: DRIVER DISPATCH, MATCHING & ASSIGNMENT SCHEMA
-- Migration: 014_dispatch_domain.sql
-- Description: Authoritative dispatch offers, matching history & race condition protection.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.dispatch_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) NOT NULL,
    driver_id VARCHAR(100) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED')),
    offered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    responded_at TIMESTAMPTZ,
    rejection_reason TEXT,
    distance_to_pickup NUMERIC(8, 2) DEFAULT 0.00,
    rank_score NUMERIC(10, 2) DEFAULT 0.00,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    idempotency_key VARCHAR(100) UNIQUE,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bounded Query & Fast Filtering Indexes
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_job_id ON public.dispatch_offers(job_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_driver_id ON public.dispatch_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_status ON public.dispatch_offers(status);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_expires_at ON public.dispatch_offers(expires_at);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_idempotency ON public.dispatch_offers(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_created_at ON public.dispatch_offers(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE public.dispatch_offers ENABLE ROW LEVEL SECURITY;

-- Service Role full access
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'dispatch_offers' AND policyname = 'service_role_dispatch_all'
    ) THEN
        CREATE POLICY service_role_dispatch_all ON public.dispatch_offers
            FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Public / Authenticated driver access (view and respond to own offers)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'dispatch_offers' AND policyname = 'driver_dispatch_select'
    ) THEN
        CREATE POLICY driver_dispatch_select ON public.dispatch_offers
            FOR SELECT USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'dispatch_offers' AND policyname = 'driver_dispatch_update'
    ) THEN
        CREATE POLICY driver_dispatch_update ON public.dispatch_offers
            FOR UPDATE USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'dispatch_offers' AND policyname = 'driver_dispatch_insert'
    ) THEN
        CREATE POLICY driver_dispatch_insert ON public.dispatch_offers
            FOR INSERT WITH CHECK (true);
    END IF;
END $$;
