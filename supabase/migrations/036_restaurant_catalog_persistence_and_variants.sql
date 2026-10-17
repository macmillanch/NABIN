-- =============================================================================
-- NABIN PLATFORM — RESTAURANT CATALOG PERSISTENCE, VARIANTS & ADD-ONS
-- Migration: 036_restaurant_catalog_persistence_and_variants.sql
-- Status: DESIGN ARTIFACT PENDING EXPLICIT USER APPROVAL.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY SHARED OR PRODUCTION DATABASE.
-- =============================================================================
-- Scope:
--   1. Additive attributes on `public.products` for restaurant dishes:
--      - dietary_type: 'VEG', 'NON_VEG', 'VEGAN', 'EGG'
--      - is_veg: boolean convenience flag
--      - prep_time_minutes: estimated preparation window
--      - photos: JSONB array of ordered photo assets [{ id, url, isPrimary, sortOrder }]
--      - variants: JSONB array of dish variants [{ id, name, price, isAvailable, isDefault, sku }]
--      - add_on_groups: JSONB array of add-on customization groups:
--        [{ id, name, isRequired, minSelections, maxSelections, allowMultiple,
--           options: [{ id, name, price, isAvailable, isDefault }] }]
--      - is_archived: boolean flag indicating soft-archived dish (hidden from menu & checkout)
--      - metadata: JSONB extensible metadata store
--   2. Additive customization snapshot on `public.order_lines`:
--      - customization_snapshot: JSONB immutable snapshot of selected variant, add-ons, and pricing
--   3. Partial indexes for performant active menu reads and filtering.
-- =============================================================================

-- 1. ADDITIVE COLUMNS ON PRODUCTS TABLE
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS dietary_type VARCHAR(30) DEFAULT 'VEG',
    ADD COLUMN IF NOT EXISTS is_veg BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 20,
    ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS add_on_groups JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- CHECK constraints for data hygiene
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_dietary_type'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT chk_products_dietary_type
            CHECK (dietary_type IN ('VEG', 'NON_VEG', 'VEGAN', 'EGG'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_prep_time_positive'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT chk_products_prep_time_positive
            CHECK (prep_time_minutes >= 0);
    END IF;
END $$;

-- 2. ADDITIVE CUSTOMIZATION SNAPSHOT ON ORDER_LINES TABLE
ALTER TABLE public.order_lines
    ADD COLUMN IF NOT EXISTS customization_snapshot JSONB DEFAULT '{}'::jsonb;

-- 3. INDEXES FOR PERFORMANCE AND TENANT FILTERING
CREATE INDEX IF NOT EXISTS idx_products_merchant_active
    ON public.products(merchant_id, category)
    WHERE is_archived = FALSE;

CREATE INDEX IF NOT EXISTS idx_products_merchant_available
    ON public.products(merchant_id, is_available)
    WHERE is_archived = FALSE;

-- Document schema intentions
COMMENT ON COLUMN public.products.variants IS
    'Structured dish variants (e.g., Half, Full). Server-authoritative prices and availability.';

COMMENT ON COLUMN public.products.add_on_groups IS
    'Structured add-on customization groups with selection rules (isRequired, minSelections, maxSelections) and options.';

COMMENT ON COLUMN public.products.is_archived IS
    'Soft deletion flag. Archived dishes must never appear in customer browse or new order checkouts.';

COMMENT ON COLUMN public.order_lines.customization_snapshot IS
    'Immutable snapshot of variant and add-on selections, unit prices, and applied rules at order creation.';

-- =============================================================================
-- ROLLBACK CONSIDERATIONS (DOCUMENTATION ONLY):
--   ALTER TABLE public.products DROP COLUMN IF EXISTS dietary_type;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS is_veg;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS prep_time_minutes;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS photos;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS variants;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS add_on_groups;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS is_archived;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS metadata;
--   ALTER TABLE public.order_lines DROP COLUMN IF EXISTS customization_snapshot;
--   DROP INDEX IF EXISTS idx_products_merchant_active;
--   DROP INDEX IF EXISTS idx_products_merchant_available;
-- =============================================================================
