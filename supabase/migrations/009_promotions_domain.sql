-- =========================================================================
-- NABIN PLATFORM — PROMOTIONS, COUPONS & DYNAMIC DISCOUNT DOMAIN
-- Migration: 009_promotions_domain.sql
-- Architecture: Atomic Concurrency, Row-Locked Redemptions, Per-User Limits, Idempotency
-- =========================================================================

-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. EXTEND PROMOTIONS TABLE
-- =========================================================================

ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS name VARCHAR(150);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS per_user_limit INTEGER DEFAULT 1;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS eligible_vehicle VARCHAR(30) DEFAULT 'ALL';
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS eligible_merchant VARCHAR(100) DEFAULT 'ALL';
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS eligible_area VARCHAR(100) DEFAULT 'ALL';
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS new_user_only BOOLEAN DEFAULT FALSE;
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS created_by VARCHAR(100);
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.promotions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Safely expand discount_type constraint to accept 'PERCENTAGE', 'FLAT', 'FIXED'
ALTER TABLE public.promotions DROP CONSTRAINT IF EXISTS promotions_discount_type_check;
ALTER TABLE public.promotions ADD CONSTRAINT promotions_discount_type_check 
    CHECK (discount_type IN ('PERCENTAGE', 'FLAT', 'FIXED'));

-- Add indexes for high-frequency promotion lookups
CREATE INDEX IF NOT EXISTS idx_promotions_code_upper ON public.promotions (UPPER(code));
CREATE INDEX IF NOT EXISTS idx_promotions_active_dates ON public.promotions (is_active, valid_from, valid_until);
CREATE INDEX IF NOT EXISTS idx_promotions_service ON public.promotions (service_type);

-- =========================================================================
-- 2. PROMOTION REDEMPTIONS TABLE (PER-USER TRACKING & IDEMPOTENCY)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.promotion_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    discount_amount NUMERIC(10, 2) NOT NULL,
    order_amount NUMERIC(10, 2) NOT NULL,
    idempotency_key VARCHAR(120) UNIQUE NOT NULL,
    redeemed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_user ON public.promotion_redemptions(user_id, promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_promo ON public.promotion_redemptions(promotion_id);
CREATE INDEX IF NOT EXISTS idx_promotion_redemptions_key ON public.promotion_redemptions(idempotency_key);

-- =========================================================================
-- 3. ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_redemptions ENABLE ROW LEVEL SECURITY;

-- Promotions RLS
DROP POLICY IF EXISTS "Public view active promotions" ON public.promotions;
CREATE POLICY "Public view active promotions"
    ON public.promotions FOR SELECT
    USING (is_active = true OR auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE_AUDITOR', 'service_role'));

DROP POLICY IF EXISTS "Admins manage promotions" ON public.promotions;
CREATE POLICY "Admins manage promotions"
    ON public.promotions FOR ALL
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'service_role'));

-- Redemptions RLS
DROP POLICY IF EXISTS "Users view own redemptions" ON public.promotion_redemptions;
CREATE POLICY "Users view own redemptions"
    ON public.promotion_redemptions FOR SELECT
    USING (auth.uid() = user_id OR auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'service_role'));

DROP POLICY IF EXISTS "Admins view all redemptions" ON public.promotion_redemptions;
CREATE POLICY "Admins view all redemptions"
    ON public.promotion_redemptions FOR ALL
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'service_role'));

-- =========================================================================
-- 4. PREVIEW / VALIDATION RPC (READ-ONLY, NO USAGE INCREMENT)
-- =========================================================================

CREATE OR REPLACE FUNCTION validate_promotion_preview(
    p_code VARCHAR,
    p_user_id UUID DEFAULT NULL,
    p_order_amount NUMERIC DEFAULT 0,
    p_service_type VARCHAR DEFAULT 'RIDE',
    p_vehicle_type VARCHAR DEFAULT NULL,
    p_area_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_promo public.promotions%ROWTYPE;
    v_user_redemptions INTEGER := 0;
    v_calculated_discount NUMERIC(10, 2);
    v_final_discount NUMERIC(10, 2);
    v_final_amount NUMERIC(10, 2);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coupon code required');
    END IF;

    SELECT * INTO v_promo
    FROM public.promotions
    WHERE UPPER(code) = UPPER(TRIM(p_code));

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired promo code.');
    END IF;

    IF NOT v_promo.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion is currently inactive.');
    END IF;

    IF v_promo.valid_from IS NOT NULL AND v_now < v_promo.valid_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion has not started yet.');
    END IF;

    IF v_promo.valid_until IS NOT NULL AND v_now > v_promo.valid_until THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion has expired.');
    END IF;

    IF v_promo.service_type IS NOT NULL AND UPPER(v_promo.service_type) <> 'ALL' THEN
        IF UPPER(v_promo.service_type) <> UPPER(p_service_type) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is only valid for ' || v_promo.service_type || ' orders.');
        END IF;
    END IF;

    IF v_promo.eligible_vehicle IS NOT NULL AND UPPER(v_promo.eligible_vehicle) <> 'ALL' AND p_vehicle_type IS NOT NULL THEN
        IF UPPER(v_promo.eligible_vehicle) <> UPPER(p_vehicle_type) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is not valid for vehicle type ' || p_vehicle_type);
        END IF;
    END IF;

    IF v_promo.eligible_area IS NOT NULL AND UPPER(v_promo.eligible_area) <> 'ALL' AND p_area_id IS NOT NULL THEN
        IF UPPER(v_promo.eligible_area) <> UPPER(p_area_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is not valid in this operational zone');
        END IF;
    END IF;

    IF v_promo.min_order_amount IS NOT NULL AND p_order_amount < v_promo.min_order_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum order amount of ₹' || v_promo.min_order_amount || ' required for this coupon.');
    END IF;

    IF v_promo.total_usage_limit IS NOT NULL AND v_promo.total_usage_limit > 0 THEN
        IF v_promo.usage_count >= v_promo.total_usage_limit THEN
            RETURN jsonb_build_object('success', false, 'error', 'Promotion usage limit has been reached.');
        END IF;
    END IF;

    IF p_user_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_user_redemptions
        FROM public.promotion_redemptions
        WHERE promotion_id = v_promo.id AND user_id = p_user_id;

        IF v_promo.per_user_limit IS NOT NULL AND v_promo.per_user_limit > 0 THEN
            IF v_user_redemptions >= v_promo.per_user_limit THEN
                RETURN jsonb_build_object('success', false, 'error', 'You have reached the maximum redemption limit for this coupon.');
            END IF;
        END IF;
    END IF;

    IF UPPER(v_promo.discount_type) = 'PERCENTAGE' THEN
        v_calculated_discount := ROUND((p_order_amount * v_promo.discount_value) / 100.0, 2);
    ELSE
        v_calculated_discount := ROUND(v_promo.discount_value, 2);
    END IF;

    IF v_promo.max_discount IS NOT NULL AND v_promo.max_discount > 0 THEN
        v_final_discount := LEAST(v_promo.max_discount, v_calculated_discount);
    ELSE
        v_final_discount := v_calculated_discount;
    END IF;

    v_final_discount := LEAST(p_order_amount, v_final_discount);
    v_final_amount := GREATEST(0.00, p_order_amount - v_final_discount);

    RETURN jsonb_build_object(
        'success', true,
        'code', v_promo.code,
        'promotion_id', v_promo.id,
        'name', COALESCE(v_promo.name, v_promo.code),
        'discount', v_final_discount,
        'final_amount', v_final_amount,
        'discount_type', v_promo.discount_type,
        'discount_value', v_promo.discount_value,
        'max_discount', v_promo.max_discount,
        'usage_count', v_promo.usage_count,
        'total_usage_limit', v_promo.total_usage_limit
    );
END;
$$;

-- =========================================================================
-- 5. ATOMIC REDEMPTION RPC (FOR UPDATE ROW LOCK, COUNTER INCREMENT, IDEMPOTENT)
-- =========================================================================

CREATE OR REPLACE FUNCTION redeem_promotion_atomic(
    p_code VARCHAR,
    p_user_id UUID,
    p_order_amount NUMERIC,
    p_service_type VARCHAR DEFAULT 'RIDE',
    p_job_id UUID DEFAULT NULL,
    p_idempotency_key VARCHAR DEFAULT NULL,
    p_vehicle_type VARCHAR DEFAULT NULL,
    p_area_id VARCHAR DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_promo public.promotions%ROWTYPE;
    v_existing_redemption public.promotion_redemptions%ROWTYPE;
    v_user_redemptions INTEGER := 0;
    v_calculated_discount NUMERIC(10, 2);
    v_final_discount NUMERIC(10, 2);
    v_final_amount NUMERIC(10, 2);
    v_new_redemption_id UUID;
    v_effective_key VARCHAR(120);
    v_now TIMESTAMPTZ := NOW();
BEGIN
    IF p_code IS NULL OR TRIM(p_code) = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Coupon code required');
    END IF;

    IF p_order_amount IS NULL OR p_order_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valid order amount required');
    END IF;

    -- 1. Idempotency Check: if identical key was already redeemed, return existing result
    IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
        v_effective_key := TRIM(p_idempotency_key);
        SELECT * INTO v_existing_redemption 
        FROM public.promotion_redemptions 
        WHERE idempotency_key = v_effective_key;

        IF FOUND THEN
            SELECT * INTO v_promo FROM public.promotions WHERE id = v_existing_redemption.promotion_id;
            RETURN jsonb_build_object(
                'success', true,
                'duplicate', true,
                'idempotent', true,
                'redemption_id', v_existing_redemption.id,
                'promotion_id', v_promo.id,
                'code', v_promo.code,
                'name', COALESCE(v_promo.name, v_promo.code),
                'discount', v_existing_redemption.discount_amount,
                'final_amount', GREATEST(0.00, p_order_amount - v_existing_redemption.discount_amount),
                'usage_count', v_promo.usage_count
            );
        END IF;
    ELSE
        v_effective_key := 'red_' || encode(gen_random_bytes(12), 'hex');
    END IF;

    -- 2. Row Lock on Promotion record to prevent concurrent usage over-allocation
    SELECT * INTO v_promo
    FROM public.promotions
    WHERE UPPER(code) = UPPER(TRIM(p_code))
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid or non-existent coupon code');
    END IF;

    -- 3. Check is_active
    IF NOT v_promo.is_active THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion is currently inactive');
    END IF;

    -- 4. Check dates
    IF v_promo.valid_from IS NOT NULL AND v_now < v_promo.valid_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion has not started yet');
    END IF;

    IF v_promo.valid_until IS NOT NULL AND v_now > v_promo.valid_until THEN
        RETURN jsonb_build_object('success', false, 'error', 'This promotion has expired');
    END IF;

    -- 5. Check service restriction
    IF v_promo.service_type IS NOT NULL AND UPPER(v_promo.service_type) <> 'ALL' THEN
        IF UPPER(v_promo.service_type) <> UPPER(p_service_type) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is only valid for ' || v_promo.service_type || ' orders');
        END IF;
    END IF;

    -- 6. Check vehicle restriction
    IF v_promo.eligible_vehicle IS NOT NULL AND UPPER(v_promo.eligible_vehicle) <> 'ALL' AND p_vehicle_type IS NOT NULL THEN
        IF UPPER(v_promo.eligible_vehicle) <> UPPER(p_vehicle_type) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is not valid for vehicle type ' || p_vehicle_type);
        END IF;
    END IF;

    -- 7. Check area restriction
    IF v_promo.eligible_area IS NOT NULL AND UPPER(v_promo.eligible_area) <> 'ALL' AND p_area_id IS NOT NULL THEN
        IF UPPER(v_promo.eligible_area) <> UPPER(p_area_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Coupon code is not valid in this operational zone');
        END IF;
    END IF;

    -- 8. Check minimum order amount
    IF v_promo.min_order_amount IS NOT NULL AND p_order_amount < v_promo.min_order_amount THEN
        RETURN jsonb_build_object('success', false, 'error', 'Minimum order amount of ₹' || v_promo.min_order_amount || ' required for this coupon');
    END IF;

    -- 9. Check global usage limit
    IF v_promo.total_usage_limit IS NOT NULL AND v_promo.total_usage_limit > 0 THEN
        IF v_promo.usage_count >= v_promo.total_usage_limit THEN
            RETURN jsonb_build_object('success', false, 'error', 'Promotion usage limit has been reached');
        END IF;
    END IF;

    -- 10. Check per-user redemption limit
    IF p_user_id IS NOT NULL THEN
        SELECT COUNT(*) INTO v_user_redemptions
        FROM public.promotion_redemptions
        WHERE promotion_id = v_promo.id AND user_id = p_user_id;

        IF v_promo.per_user_limit IS NOT NULL AND v_promo.per_user_limit > 0 THEN
            IF v_user_redemptions >= v_promo.per_user_limit THEN
                RETURN jsonb_build_object('success', false, 'error', 'You have reached the maximum redemption limit (' || v_promo.per_user_limit || ') for this coupon');
            END IF;
        END IF;
    END IF;

    -- 11. Calculate authoritative discount
    IF UPPER(v_promo.discount_type) = 'PERCENTAGE' THEN
        v_calculated_discount := ROUND((p_order_amount * v_promo.discount_value) / 100.0, 2);
    ELSE
        v_calculated_discount := ROUND(v_promo.discount_value, 2);
    END IF;

    IF v_promo.max_discount IS NOT NULL AND v_promo.max_discount > 0 THEN
        v_final_discount := LEAST(v_promo.max_discount, v_calculated_discount);
    ELSE
        v_final_discount := v_calculated_discount;
    END IF;

    v_final_discount := LEAST(p_order_amount, v_final_discount);
    v_final_amount := GREATEST(0.00, p_order_amount - v_final_discount);

    -- 12. Record redemption entry
    IF p_user_id IS NOT NULL THEN
        INSERT INTO public.promotion_redemptions (
            promotion_id,
            user_id,
            job_id,
            discount_amount,
            order_amount,
            idempotency_key,
            redeemed_at
        ) VALUES (
            v_promo.id,
            p_user_id,
            p_job_id,
            v_final_discount,
            p_order_amount,
            v_effective_key,
            v_now
        ) RETURNING id INTO v_new_redemption_id;
    END IF;

    -- 13. Increment usage_count exactly once
    UPDATE public.promotions
    SET usage_count = usage_count + 1,
        updated_at = v_now
    WHERE id = v_promo.id;

    RETURN jsonb_build_object(
        'success', true,
        'redemption_id', v_new_redemption_id,
        'promotion_id', v_promo.id,
        'code', v_promo.code,
        'name', COALESCE(v_promo.name, v_promo.code),
        'discount', v_final_discount,
        'final_amount', v_final_amount,
        'usage_count', v_promo.usage_count + 1
    );
END;
$$;
