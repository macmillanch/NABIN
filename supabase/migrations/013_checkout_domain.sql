-- =========================================================================
-- NABIN PLATFORM — CHECKOUT & TRANSACTION ORCHESTRATION DOMAIN
-- Migration: 013_checkout_domain.sql
-- Architecture: Single Authoritative Checkout Pipeline, Transaction Boundaries,
--               Idempotency Guarantees, Payment Separation, Event Outbox, RLS
-- =========================================================================

-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. CHECKOUT SESSIONS TABLE (THE AUTHORITATIVE CHECKOUT TRANSACTION ROOT)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.checkouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id VARCHAR(80) UNIQUE NOT NULL,
    idempotency_key VARCHAR(120) UNIQUE,
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    service_type VARCHAR(30) NOT NULL CHECK (service_type IN ('RIDE', 'FOOD', 'PARCEL', 'GROCERY')),
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    payment_method VARCHAR(30) NOT NULL CHECK (payment_method IN ('CASH', 'WALLET', 'RAZORPAY', 'EXTERNAL_GATEWAY')),
    payment_session_id VARCHAR(80),
    payment_id VARCHAR(100),
    payment_status VARCHAR(30) DEFAULT 'PENDING'
        CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CASH_COLLECTION_PENDING')),
    checkout_status VARCHAR(30) DEFAULT 'INITIATED'
        CHECK (checkout_status IN ('INITIATED', 'PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'FAILED')),
    base_amount NUMERIC(12, 2) NOT NULL CHECK (base_amount >= 0),
    surge_multiplier NUMERIC(4, 2) DEFAULT 1.0 CHECK (surge_multiplier >= 1.0),
    surcharge_amount NUMERIC(12, 2) DEFAULT 0.0 CHECK (surcharge_amount >= 0),
    discount_amount NUMERIC(12, 2) DEFAULT 0.0 CHECK (discount_amount >= 0),
    final_payable_amount NUMERIC(12, 2) NOT NULL CHECK (final_payable_amount >= 0),
    currency VARCHAR(10) DEFAULT 'INR',
    applied_promo_code VARCHAR(80),
    promotion_id UUID REFERENCES public.promotions(id) ON DELETE SET NULL,
    redemption_id UUID REFERENCES public.promotion_redemptions(id) ON DELETE SET NULL,
    pickup_data JSONB DEFAULT '{}',
    drop_data JSONB DEFAULT '{}',
    items_data JSONB DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    failure_reason TEXT,
    cancelled_at TIMESTAMPTZ,
    cancelled_reason TEXT,
    refunded_amount NUMERIC(12, 2) DEFAULT 0.0 CHECK (refunded_amount >= 0),
    refunded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. CHECKOUT TRANSACTIONAL EVENT OUTBOX
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.checkout_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    checkout_id UUID REFERENCES public.checkouts(id) ON DELETE CASCADE,
    event_type VARCHAR(80) NOT NULL,
    event_key VARCHAR(120) UNIQUE NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(30) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSED', 'FAILED')),
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 3. INDEXES FOR PERFORMANCE & FAST LOOKUPS
-- =========================================================================

CREATE INDEX IF NOT EXISTS idx_checkouts_customer_id ON public.checkouts(customer_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_job_id ON public.checkouts(job_id);
CREATE INDEX IF NOT EXISTS idx_checkouts_idempotency_key ON public.checkouts(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkouts_status ON public.checkouts(checkout_status);
CREATE INDEX IF NOT EXISTS idx_checkouts_payment_status ON public.checkouts(payment_status);
CREATE INDEX IF NOT EXISTS idx_checkouts_created_at ON public.checkouts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkouts_payment_session_id ON public.checkouts(payment_session_id) WHERE payment_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_events_checkout_id ON public.checkout_events(checkout_id);
CREATE INDEX IF NOT EXISTS idx_checkout_events_status ON public.checkout_events(status);
CREATE INDEX IF NOT EXISTS idx_checkout_events_created_at ON public.checkout_events(created_at DESC);

-- =========================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE public.checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_events ENABLE ROW LEVEL SECURITY;

-- Customers can view only their own checkouts
DROP POLICY IF EXISTS "Customers view own checkouts" ON public.checkouts;
CREATE POLICY "Customers view own checkouts"
    ON public.checkouts FOR SELECT
    USING (auth.uid() = customer_id OR auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'CUSTOMER_SUPPORT', 'service_role'));

-- Admin full access to checkouts
DROP POLICY IF EXISTS "Admins manage checkouts" ON public.checkouts;
CREATE POLICY "Admins manage checkouts"
    ON public.checkouts FOR ALL
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'service_role'));

-- Admin full access to checkout events outbox
DROP POLICY IF EXISTS "Admins view checkout events" ON public.checkout_events;
CREATE POLICY "Admins view checkout events"
    ON public.checkout_events FOR ALL
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'service_role'));
