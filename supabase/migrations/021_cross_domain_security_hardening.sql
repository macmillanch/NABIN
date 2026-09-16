-- =========================================================================
-- NABIN PLATFORM — PHASE 7: CROSS-DOMAIN SECURITY HARDENING
-- Migration: 021_cross_domain_security_hardening.sql
-- Objectives:
-- 1. Enable RLS on remaining tables: master_grocery_catalog,
--    merchant_grocery_inventory, grocery_price_history
-- 2. Restrict SECURITY DEFINER search_path on promotion functions
-- 3. Revoke dangerous PUBLIC / anon EXECUTE privileges on financial RPCs
-- =========================================================================

-- =========================================================================
-- 1. ROW LEVEL SECURITY ON GROCERY CATALOG & INVENTORY TABLES
-- =========================================================================

ALTER TABLE IF EXISTS public.master_grocery_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.merchant_grocery_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.grocery_price_history ENABLE ROW LEVEL SECURITY;

-- 1.1 master_grocery_catalog Policies
-- Anyone (authenticated users, customers, drivers, merchants) can read active master catalog items
DROP POLICY IF EXISTS "master_catalog_read_all" ON public.master_grocery_catalog;
CREATE POLICY "master_catalog_read_all"
    ON public.master_grocery_catalog FOR SELECT
    USING (is_active = true OR auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'service_role'));

-- Only Admins and service_role can mutate master catalog
DROP POLICY IF EXISTS "master_catalog_admin_manage" ON public.master_grocery_catalog;
CREATE POLICY "master_catalog_admin_manage"
    ON public.master_grocery_catalog FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 1.2 merchant_grocery_inventory Policies
-- Public/customers can view in-stock merchant inventory
DROP POLICY IF EXISTS "inventory_customer_read" ON public.merchant_grocery_inventory;
CREATE POLICY "inventory_customer_read"
    ON public.merchant_grocery_inventory FOR SELECT
    USING (is_available = true OR auth.uid() = merchant_id OR auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'service_role'));

-- Merchants can update ONLY their own inventory
DROP POLICY IF EXISTS "inventory_merchant_update" ON public.merchant_grocery_inventory;
CREATE POLICY "inventory_merchant_update"
    ON public.merchant_grocery_inventory FOR UPDATE
    TO authenticated
    USING (auth.uid() = merchant_id)
    WITH CHECK (auth.uid() = merchant_id);

DROP POLICY IF EXISTS "inventory_merchant_insert" ON public.merchant_grocery_inventory;
CREATE POLICY "inventory_merchant_insert"
    ON public.merchant_grocery_inventory FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = merchant_id);

DROP POLICY IF EXISTS "inventory_service_role_all" ON public.merchant_grocery_inventory;
CREATE POLICY "inventory_service_role_all"
    ON public.merchant_grocery_inventory FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 1.3 grocery_price_history Policies
-- Historical price logs can only be read by authorized roles
DROP POLICY IF EXISTS "price_history_read" ON public.grocery_price_history;
CREATE POLICY "price_history_read"
    ON public.grocery_price_history FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'OPERATIONS', 'service_role'));

DROP POLICY IF EXISTS "price_history_service_role_all" ON public.grocery_price_history;
CREATE POLICY "price_history_service_role_all"
    ON public.grocery_price_history FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Revoke direct anonymous mutations from grocery tables
REVOKE INSERT, UPDATE, DELETE ON public.master_grocery_catalog FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.merchant_grocery_inventory FROM anon, public;
REVOKE INSERT, UPDATE, DELETE ON public.grocery_price_history FROM anon, public;

-- =========================================================================
-- 2. HARDEN SECURITY DEFINER SEARCH_PATH ON PROMOTION FUNCTIONS
-- =========================================================================

-- Set search_path = public, extensions on validate_promotion_preview
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'validate_promotion_preview'
    ) THEN
        ALTER FUNCTION public.validate_promotion_preview SET search_path = public, extensions;
    END IF;
END $$;

-- Set search_path = public, extensions on redeem_promotion_atomic
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'redeem_promotion_atomic'
    ) THEN
        ALTER FUNCTION public.redeem_promotion_atomic SET search_path = public, extensions;
    END IF;
END $$;

-- =========================================================================
-- 3. REVOKE BROAD EXECUTE PERMISSIONS ON SENSITIVE RPCs
-- =========================================================================

-- 3.1 cancel_ride_atomic
-- Revoke from PUBLIC and anon; only authenticated callers and service_role may execute
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'cancel_ride_atomic'
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.cancel_ride_atomic(%s) FROM PUBLIC, anon;', r.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.cancel_ride_atomic(%s) TO service_role, authenticated;', r.args);
    END LOOP;
END $$;

-- 3.2 refund_payment_atomic (All overloads)
-- Sensitive financial refund function must NEVER be executable by anon or arbitrary authenticated users
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'refund_payment_atomic'
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.refund_payment_atomic(%s) FROM PUBLIC, anon, authenticated;', r.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.refund_payment_atomic(%s) TO service_role;', r.args);
    END LOOP;
END $$;

-- 3.3 redeem_promotion_atomic & validate_promotion_preview
-- Revoke from anon; only authenticated users and service_role can redeem/validate
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname IN ('redeem_promotion_atomic', 'validate_promotion_preview')
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon;', (SELECT proname FROM pg_proc WHERE oid = r.oid), r.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role, authenticated;', (SELECT proname FROM pg_proc WHERE oid = r.oid), r.args);
    END LOOP;
END $$;

-- 3.4 create_dispatch_offer_atomic
-- Revoke from PUBLIC, anon, authenticated; only service_role dispatches offers
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT p.oid, pg_catalog.pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'create_dispatch_offer_atomic'
    ) LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.create_dispatch_offer_atomic(%s) FROM PUBLIC, anon, authenticated;', r.args);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.create_dispatch_offer_atomic(%s) TO service_role;', r.args);
    END LOOP;
END $$;
