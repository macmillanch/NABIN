-- =============================================================================
-- 030: Merchant grocery inventory numeric integrity (money + stock)
-- =============================================================================
-- Layer two of the fix for the `POST /api/merchant/inventory` validation gap.
--
-- `merchant_grocery_inventory` was created in migration 001 with
--   store_price    NUMERIC(10, 2) NOT NULL
--   stock_quantity INTEGER NOT NULL DEFAULT 0
-- and no CHECK. A scan of the deployed schema (pg_constraint, contype='c') confirms
-- this table still carries zero CHECK constraints, so nothing stopped an application
-- path from storing a negative price. `store_price` is not cosmetic:
-- `create_order_with_lines_atomic` reads it and snapshots it into
-- `order_lines.unit_price_snapshot`, which is what a customer is charged and what the
-- merchant is later settled on. A negative row therefore inverts money in both
-- directions.
--
-- The API layer now validates (services/inventoryDomain.js). This migration makes the
-- same bounds true even if a future code path, a bulk job, or a direct service-role
-- write bypasses that validation, which is the only reason to have a database.
--
-- Bounds are taken from the columns themselves, not invented:
--   store_price    > 0 and <= 99999999.99  (NUMERIC(10,2); zero is excluded because
--                                            pricing_model holds only FIXED_PRICE and
--                                            no listing has ever had a zero price)
--   stock_quantity >= 0 and <= 2147483647   (int4; 0 is legitimate and means sold out)
--
-- Pre-flight: the 14 existing rows were inspected and all 14 are already inside these
-- bounds (0 negative prices, 0 zero prices, 0 negative stock, 0 out of range), so the
-- constraints are added VALIDATED and no historical row had to be touched. If this runs
-- somewhere that does contain invalid rows it will fail loudly rather than silently
-- rewrite somebody's prices -- that is deliberate; see the guard below.
-- =============================================================================

DO $$
DECLARE
  v_bad INTEGER;
BEGIN
    -- Fail loudly instead of altering a table whose data would violate the new rule.
    SELECT COUNT(*) INTO v_bad
      FROM public.merchant_grocery_inventory
     WHERE store_price IS NULL
        OR store_price <= 0
        OR store_price > 99999999.99
        OR stock_quantity IS NULL
        OR stock_quantity < 0
        OR stock_quantity > 2147483647;

    IF v_bad > 0 THEN
        RAISE EXCEPTION
          'merchant_inventory_integrity: % existing row(s) fall outside the new bounds. '
          'Refusing to add a constraint over live business data. Report the rows and agree '
          'a correction policy with the business before re-running this migration.', v_bad;
    END IF;
END $$;

-- store_price: positive, within NUMERIC(10,2), never null.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.merchant_grocery_inventory'::regclass
           AND conname = 'chk_mgi_store_price_positive'
    ) THEN
        ALTER TABLE public.merchant_grocery_inventory
            ADD CONSTRAINT chk_mgi_store_price_positive
            CHECK (store_price IS NOT NULL AND store_price > 0 AND store_price <= 99999999.99);
    END IF;
END $$;

-- stock_quantity: whole, non-negative, within int4, never null.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.merchant_grocery_inventory'::regclass
           AND conname = 'chk_mgi_stock_quantity_non_negative'
    ) THEN
        ALTER TABLE public.merchant_grocery_inventory
            ADD CONSTRAINT chk_mgi_stock_quantity_non_negative
            CHECK (stock_quantity IS NOT NULL AND stock_quantity >= 0 AND stock_quantity <= 2147483647);
    END IF;
END $$;

-- `is_available` is read as a boolean everywhere but was left nullable in 001, which
-- makes "unknown" a storable state for a listing's sellability. Only set the default;
-- existing rows are already non-null in this database, so no row is rewritten.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'merchant_grocery_inventory'
           AND column_name = 'is_available'
           AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE public.merchant_grocery_inventory
            ALTER COLUMN is_available SET DEFAULT TRUE;
    END IF;
END $$;

COMMENT ON CONSTRAINT chk_mgi_store_price_positive ON public.merchant_grocery_inventory IS
    'Merchant listing price: positive, NUMERIC(10,2) bounded. Snapshotted into order_lines.unit_price_snapshot by create_order_with_lines_atomic, so a negative value would invert what a customer pays and what a merchant is settled.';

COMMENT ON CONSTRAINT chk_mgi_stock_quantity_non_negative ON public.merchant_grocery_inventory IS
    'Merchant listing stock: whole units, 0 allowed (sold out), int4 bounded. Status is derived from this value (0 -> OUT_OF_STOCK, <=20 -> LOW_STOCK).';
