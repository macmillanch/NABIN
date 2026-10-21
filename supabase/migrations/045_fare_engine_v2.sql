-- ============================================================================
-- NABIN MIGRATION 045: Fare Engine v2 — Waiting, Cancellation, Pass-Through
--
-- Decisions implemented:
--   DEC-020  Cancellation fee: ₹50 flat, 80% driver / 20% platform
--   DEC-021  Waiting charges: 3 min free, then ₹2/min
--   DEC-022  Zone surcharges excluded from commission base
--   DEC-023  Coupons platform-funded; driver earns on gross fare
--   DEC-026  First 300 m (0.3 km) included in base fare
--
-- DEC-024 (GST) deferred — tax: null placeholder in application layer only
-- DEC-025 (surge time-window enforcement) — application layer change only
--
-- Safety: additive and idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING)
--         no existing column altered, no existing table dropped
-- Rollback: see bottom of this file
-- ============================================================================


-- ============================================================================
-- 1. EXTEND pricing_configurations
-- ============================================================================

-- 1a. First-N-km included in base fare (DEC-026)
ALTER TABLE public.pricing_configurations
    ADD COLUMN IF NOT EXISTS included_km NUMERIC(5, 3) NOT NULL DEFAULT 0.3;

-- 1b. Waiting charge config (DEC-021)
ALTER TABLE public.pricing_configurations
    ADD COLUMN IF NOT EXISTS free_wait_mins       INTEGER        NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS wait_charge_per_min  NUMERIC(6, 2)  NOT NULL DEFAULT 2.00;

-- 1c. Cancellation fee config (DEC-020)
ALTER TABLE public.pricing_configurations
    ADD COLUMN IF NOT EXISTS cancellation_fee          NUMERIC(8, 2)  NOT NULL DEFAULT 50.00,
    ADD COLUMN IF NOT EXISTS cancellation_driver_pct   NUMERIC(5, 2)  NOT NULL DEFAULT 80.00;
--   driver share  = cancellation_fee * (cancellation_driver_pct / 100)
--   platform share = cancellation_fee * (1 - cancellation_driver_pct / 100)


-- 1d. Constraints
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_included_km_nonneg') THEN
        ALTER TABLE public.pricing_configurations
            ADD CONSTRAINT chk_included_km_nonneg CHECK (included_km >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_free_wait_nonneg') THEN
        ALTER TABLE public.pricing_configurations
            ADD CONSTRAINT chk_free_wait_nonneg CHECK (free_wait_mins >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_wait_charge_nonneg') THEN
        ALTER TABLE public.pricing_configurations
            ADD CONSTRAINT chk_wait_charge_nonneg CHECK (wait_charge_per_min >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cancel_fee_nonneg') THEN
        ALTER TABLE public.pricing_configurations
            ADD CONSTRAINT chk_cancel_fee_nonneg CHECK (cancellation_fee >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_cancel_driver_pct_range') THEN
        ALTER TABLE public.pricing_configurations
            ADD CONSTRAINT chk_cancel_driver_pct_range
                CHECK (cancellation_driver_pct BETWEEN 0 AND 100);
    END IF;
END $$;


-- 1e. Update seeded rows to carry explicit decision values
--     (DEFAULT already applied for new rows; UPDATE sets them on pre-existing rows)
UPDATE public.pricing_configurations SET
    included_km             = 0.3,
    free_wait_mins          = 3,
    wait_charge_per_min     = 2.00,
    cancellation_fee        = 50.00,
    cancellation_driver_pct = 80.00
WHERE id IN ('2W', '3W', '4W', 'PARCEL', 'FOOD', 'GLOBAL');


-- ============================================================================
-- 2. EXTEND jobs TABLE
-- ============================================================================

-- 2a. Waiting clock anchor (DEC-021)
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS driver_arrived_at TIMESTAMPTZ;

-- 2b. Immutable fare breakdown snapshot — stored at booking time (audit trail)
--     Shape: { grossFare, discount, customerCharge, driverEarnings, platformFee,
--              passThroughs, zoneSurcharge, waitingCharge, surgeMultiplier,
--              includedKm, commissionPercent, tax }
ALTER TABLE public.jobs
    ADD COLUMN IF NOT EXISTS fare_breakdown JSONB;


-- ============================================================================
-- 3. ROLLBACK INSTRUCTIONS (manual — never run automatically)
-- ============================================================================
-- To roll back:
--   ALTER TABLE public.pricing_configurations
--       DROP COLUMN IF EXISTS included_km,
--       DROP COLUMN IF EXISTS free_wait_mins,
--       DROP COLUMN IF EXISTS wait_charge_per_min,
--       DROP COLUMN IF EXISTS cancellation_fee,
--       DROP COLUMN IF EXISTS cancellation_driver_pct;
--   ALTER TABLE public.jobs
--       DROP COLUMN IF EXISTS driver_arrived_at,
--       DROP COLUMN IF EXISTS fare_breakdown;
-- ============================================================================
