-- =========================================================================
-- NABIN PLATFORM — MIGRATION 018
-- Domain: Food/Grocery Order State, Order Lines, Order Transitions,
--         Checkout Merchant Binding, Dispatch Offers UUID FK
-- Baseline: Migrations 001–016 Unchanged
-- =========================================================================

-- =========================================================================
-- 1. ORDERS TABLE (FOOD/GROCERY AUTHORITATIVE ORDER LIFECYCLE)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number VARCHAR(80) UNIQUE NOT NULL,
    checkout_id UUID UNIQUE REFERENCES public.checkouts(id) ON DELETE SET NULL,
    job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    service_type VARCHAR(30) NOT NULL CHECK (service_type IN ('FOOD', 'GROCERY')),
    order_state VARCHAR(30) NOT NULL DEFAULT 'RECEIVED'
        CHECK (order_state IN (
            'RECEIVED', 'ACCEPTED', 'PREPARING', 'PACKING',
            'READY_FOR_PICKUP', 'PICKED_UP', 'DELIVERED',
            'REJECTED', 'CANCELLED'
        )),
    previous_state VARCHAR(30),
    merchant_timeout_at TIMESTAMPTZ,
    timeout_reason VARCHAR(30) CHECK (timeout_reason IN ('MERCHANT_TIMEOUT')),
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    currency VARCHAR(10) DEFAULT 'INR',
    items_snapshot JSONB DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. ORDER_LINES TABLE (NATIVE UNIT PRESERVATION, MERCHANT OWNERSHIP)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    catalog_kind VARCHAR(20) NOT NULL CHECK (catalog_kind IN ('RESTAURANT_PRODUCT', 'GROCERY_INVENTORY')),
    restaurant_product_id UUID REFERENCES public.products(id) ON DELETE RESTRICT,
    grocery_inventory_id UUID REFERENCES public.merchant_grocery_inventory(id) ON DELETE RESTRICT,
    product_name_snapshot VARCHAR(200) NOT NULL,
    quantity NUMERIC(10, 3) NOT NULL CHECK (quantity > 0),
    unit_snapshot VARCHAR(30) NOT NULL CHECK (unit_snapshot IN ('g', 'kg', 'ml', 'litre', 'piece', 'dozen', 'pack')),
    unit_price_snapshot NUMERIC(10, 2) NOT NULL CHECK (unit_price_snapshot >= 0),
    line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
    fulfilled_quantity NUMERIC(10, 3) CHECK (fulfilled_quantity >= 0),
    unfulfilled_quantity NUMERIC(10, 3) CHECK (unfulfilled_quantity >= 0),
    packed_confirmed_quantity NUMERIC(10, 3) CHECK (packed_confirmed_quantity >= 0),
    is_partially_fulfilled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (
        (catalog_kind = 'RESTAURANT_PRODUCT' AND restaurant_product_id IS NOT NULL AND grocery_inventory_id IS NULL)
        OR
        (catalog_kind = 'GROCERY_INVENTORY' AND grocery_inventory_id IS NOT NULL AND restaurant_product_id IS NULL)
    ),
    CHECK (
        packed_confirmed_quantity IS NULL
        OR (packed_confirmed_quantity >= 0 AND packed_confirmed_quantity <= quantity)
    )
);

-- =========================================================================
-- 3. ORDER_TRANSITIONS TABLE (AUDIT HISTORY, IDEMPOTENCY)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.order_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    previous_state VARCHAR(30),
    new_state VARCHAR(30) NOT NULL,
    actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('CUSTOMER', 'MERCHANT', 'DRIVER', 'ADMIN', 'SYSTEM')),
    actor_id VARCHAR(80) NOT NULL,
    reason TEXT,
    idempotency_key VARCHAR(120) UNIQUE,
    request_fingerprint VARCHAR(64) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 4. CHECKOUT MERCHANT BINDING + ORDER LINKAGE
-- =========================================================================

ALTER TABLE public.checkouts
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL;

ALTER TABLE public.checkouts
    ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL;

-- =========================================================================
-- 5. DISPATCH_OFFERS BACKWARD-COMPATIBLE UUID FK
-- =========================================================================

ALTER TABLE public.dispatch_offers
    ADD COLUMN IF NOT EXISTS job_uuid UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

-- =========================================================================
-- 6. INDEXES
-- =========================================================================

-- orders
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant_id ON public.orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_job_id ON public.orders(job_id);
CREATE INDEX IF NOT EXISTS idx_orders_checkout_id ON public.orders(checkout_id);
CREATE INDEX IF NOT EXISTS idx_orders_state ON public.orders(order_state);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_timeout ON public.orders(merchant_timeout_at) WHERE merchant_timeout_at IS NOT NULL;

-- order_lines
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id ON public.order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_catalog_kind ON public.order_lines(catalog_kind);
CREATE INDEX IF NOT EXISTS idx_order_lines_restaurant_product ON public.order_lines(restaurant_product_id) WHERE restaurant_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_lines_grocery_inventory ON public.order_lines(grocery_inventory_id) WHERE grocery_inventory_id IS NOT NULL;

-- order_transitions
CREATE INDEX IF NOT EXISTS idx_order_transitions_order_id ON public.order_transitions(order_id);
CREATE INDEX IF NOT EXISTS idx_order_transitions_created_at ON public.order_transitions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_transitions_idempotency_key ON public.order_transitions(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- checkouts
CREATE INDEX IF NOT EXISTS idx_checkouts_order_id ON public.checkouts(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkouts_merchant_id ON public.checkouts(merchant_id) WHERE merchant_id IS NOT NULL;

-- dispatch_offers
CREATE INDEX IF NOT EXISTS idx_dispatch_offers_job_uuid ON public.dispatch_offers(job_uuid) WHERE job_uuid IS NOT NULL;

-- =========================================================================
-- 7. ROW LEVEL SECURITY
-- =========================================================================

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_transitions ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 7a. ORDERS RLS POLICIES
-- =========================================================================

-- Customers: SELECT own orders only
DROP POLICY IF EXISTS "Customers view own orders" ON public.orders;
CREATE POLICY "Customers view own orders"
    ON public.orders FOR SELECT
    USING (auth.uid() = customer_id);

-- Customers: no INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Customers cannot insert orders" ON public.orders;
CREATE POLICY "Customers cannot insert orders"
    ON public.orders FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot update orders" ON public.orders;
CREATE POLICY "Customers cannot update orders"
    ON public.orders FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot delete orders" ON public.orders;
CREATE POLICY "Customers cannot delete orders"
    ON public.orders FOR DELETE
    USING (FALSE);

-- Merchants: SELECT own orders only
DROP POLICY IF EXISTS "Merchants view own orders" ON public.orders;
CREATE POLICY "Merchants view own orders"
    ON public.orders FOR SELECT
    USING (auth.uid() = merchant_id);

-- Merchants: no direct INSERT/UPDATE/DELETE (mutation through backend RPC only)
DROP POLICY IF EXISTS "Merchants cannot insert orders" ON public.orders;
CREATE POLICY "Merchants cannot insert orders"
    ON public.orders FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot update orders" ON public.orders;
CREATE POLICY "Merchants cannot update orders"
    ON public.orders FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot delete orders" ON public.orders;
CREATE POLICY "Merchants cannot delete orders"
    ON public.orders FOR DELETE
    USING (FALSE);

-- Drivers: SELECT only orders linked to their assigned jobs
DROP POLICY IF EXISTS "Drivers view assigned orders" ON public.orders;
CREATE POLICY "Drivers view assigned orders"
    ON public.orders FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM jobs
             WHERE jobs.id = orders.job_id
               AND jobs.driver_id = auth.uid()
        )
    );

-- Admins: SELECT
DROP POLICY IF EXISTS "Admins manage orders select" ON public.orders;
CREATE POLICY "Admins manage orders select"
    ON public.orders FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: INSERT
DROP POLICY IF EXISTS "Admins insert orders" ON public.orders;
CREATE POLICY "Admins insert orders"
    ON public.orders FOR INSERT
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: UPDATE
DROP POLICY IF EXISTS "Admins update orders" ON public.orders;
CREATE POLICY "Admins update orders"
    ON public.orders FOR UPDATE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'))
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: DELETE
DROP POLICY IF EXISTS "Admins delete orders" ON public.orders;
CREATE POLICY "Admins delete orders"
    ON public.orders FOR DELETE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Service role: full access
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'service_role_orders_all') THEN
        CREATE POLICY service_role_orders_all ON public.orders FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- =========================================================================
-- 7b. ORDER_LINES RLS POLICIES
-- =========================================================================

-- Customers: SELECT only lines for their own orders
DROP POLICY IF EXISTS "Customers view own order lines" ON public.order_lines;
CREATE POLICY "Customers view own order lines"
    ON public.order_lines FOR SELECT
    USING (
        order_id IN (SELECT id FROM public.orders WHERE customer_id = auth.uid())
    );

-- Customers: no INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Customers cannot insert order lines" ON public.order_lines;
CREATE POLICY "Customers cannot insert order lines"
    ON public.order_lines FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot update order lines" ON public.order_lines;
CREATE POLICY "Customers cannot update order lines"
    ON public.order_lines FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot delete order lines" ON public.order_lines;
CREATE POLICY "Customers cannot delete order lines"
    ON public.order_lines FOR DELETE
    USING (FALSE);

-- Merchants: SELECT only lines for their own orders
DROP POLICY IF EXISTS "Merchants view own order lines" ON public.order_lines;
CREATE POLICY "Merchants view own order lines"
    ON public.order_lines FOR SELECT
    USING (
        order_id IN (SELECT id FROM public.orders WHERE merchant_id = auth.uid())
    );

-- Merchants: no direct INSERT/UPDATE/DELETE (mutation through backend RPC only)
DROP POLICY IF EXISTS "Merchants cannot insert order lines" ON public.order_lines;
CREATE POLICY "Merchants cannot insert order lines"
    ON public.order_lines FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot update order lines" ON public.order_lines;
CREATE POLICY "Merchants cannot update order lines"
    ON public.order_lines FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot delete order lines" ON public.order_lines;
CREATE POLICY "Merchants cannot delete order lines"
    ON public.order_lines FOR DELETE
    USING (FALSE);

-- Admins: SELECT
DROP POLICY IF EXISTS "Admins manage order lines select" ON public.order_lines;
CREATE POLICY "Admins manage order lines select"
    ON public.order_lines FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: INSERT
DROP POLICY IF EXISTS "Admins insert order lines" ON public.order_lines;
CREATE POLICY "Admins insert order lines"
    ON public.order_lines FOR INSERT
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: UPDATE
DROP POLICY IF EXISTS "Admins update order lines" ON public.order_lines;
CREATE POLICY "Admins update order lines"
    ON public.order_lines FOR UPDATE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'))
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: DELETE
DROP POLICY IF EXISTS "Admins delete order lines" ON public.order_lines;
CREATE POLICY "Admins delete order lines"
    ON public.order_lines FOR DELETE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Service role
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_lines' AND policyname = 'service_role_order_lines_all') THEN
        CREATE POLICY service_role_order_lines_all ON public.order_lines FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- =========================================================================
-- 7c. ORDER_TRANSITIONS RLS POLICIES
-- =========================================================================

-- Customers: SELECT only transitions for their own orders
DROP POLICY IF EXISTS "Customers view own order transitions" ON public.order_transitions;
CREATE POLICY "Customers view own order transitions"
    ON public.order_transitions FOR SELECT
    USING (
        order_id IN (SELECT id FROM public.orders WHERE customer_id = auth.uid())
    );

-- Customers: no INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "Customers cannot insert order transitions" ON public.order_transitions;
CREATE POLICY "Customers cannot insert order transitions"
    ON public.order_transitions FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot update order transitions" ON public.order_transitions;
CREATE POLICY "Customers cannot update order transitions"
    ON public.order_transitions FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Customers cannot delete order transitions" ON public.order_transitions;
CREATE POLICY "Customers cannot delete order transitions"
    ON public.order_transitions FOR DELETE
    USING (FALSE);

-- Merchants: SELECT only transitions for their own orders
DROP POLICY IF EXISTS "Merchants view own order transitions" ON public.order_transitions;
CREATE POLICY "Merchants view own order transitions"
    ON public.order_transitions FOR SELECT
    USING (
        order_id IN (SELECT id FROM public.orders WHERE merchant_id = auth.uid())
    );

-- Merchants: no direct mutation
DROP POLICY IF EXISTS "Merchants cannot insert order transitions" ON public.order_transitions;
CREATE POLICY "Merchants cannot insert order transitions"
    ON public.order_transitions FOR INSERT
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot update order transitions" ON public.order_transitions;
CREATE POLICY "Merchants cannot update order transitions"
    ON public.order_transitions FOR UPDATE
    USING (FALSE)
    WITH CHECK (FALSE);

DROP POLICY IF EXISTS "Merchants cannot delete order transitions" ON public.order_transitions;
CREATE POLICY "Merchants cannot delete order transitions"
    ON public.order_transitions FOR DELETE
    USING (FALSE);

-- Admins: SELECT
DROP POLICY IF EXISTS "Admins manage order transitions select" ON public.order_transitions;
CREATE POLICY "Admins manage order transitions select"
    ON public.order_transitions FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: INSERT
DROP POLICY IF EXISTS "Admins insert order transitions" ON public.order_transitions;
CREATE POLICY "Admins insert order transitions"
    ON public.order_transitions FOR INSERT
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: UPDATE
DROP POLICY IF EXISTS "Admins update order transitions" ON public.order_transitions;
CREATE POLICY "Admins update order transitions"
    ON public.order_transitions FOR UPDATE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'))
    WITH CHECK (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Admins: DELETE
DROP POLICY IF EXISTS "Admins delete order transitions" ON public.order_transitions;
CREATE POLICY "Admins delete order transitions"
    ON public.order_transitions FOR DELETE
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'OPERATIONS', 'SUPPORT_AGENT', 'KYC_SPECIALIST', 'FINANCE_AUDITOR', 'service_role'));

-- Service role
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'order_transitions' AND policyname = 'service_role_order_transitions_all') THEN
        CREATE POLICY service_role_order_transitions_all ON public.order_transitions FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- =========================================================================
-- 8. FUNCTIONS AND TRIGGERS
-- =========================================================================

-- =========================================================================
-- 8a. STATE MACHINE VALIDATION (EXPLICIT MATRIX, NO WILDCARDS)
-- =========================================================================

CREATE OR REPLACE FUNCTION is_valid_order_transition(
    p_from VARCHAR(30),
    p_to   VARCHAR(30)
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        -- RECEIVED outgoing (3 valid)
        WHEN p_from = 'RECEIVED'    AND p_to = 'ACCEPTED' THEN TRUE
        WHEN p_from = 'RECEIVED'    AND p_to = 'REJECTED' THEN TRUE
        WHEN p_from = 'RECEIVED'    AND p_to = 'CANCELLED' THEN TRUE
        -- ACCEPTED outgoing (3 valid)
        WHEN p_from = 'ACCEPTED'    AND p_to = 'PREPARING' THEN TRUE
        WHEN p_from = 'ACCEPTED'    AND p_to = 'PACKING' THEN TRUE
        WHEN p_from = 'ACCEPTED'    AND p_to = 'CANCELLED' THEN TRUE
        -- PREPARING outgoing (2 valid)
        WHEN p_from = 'PREPARING'   AND p_to = 'READY_FOR_PICKUP' THEN TRUE
        WHEN p_from = 'PREPARING'   AND p_to = 'CANCELLED' THEN TRUE
        -- PACKING outgoing (2 valid)
        WHEN p_from = 'PACKING'     AND p_to = 'READY_FOR_PICKUP' THEN TRUE
        WHEN p_from = 'PACKING'     AND p_to = 'CANCELLED' THEN TRUE
        -- READY_FOR_PICKUP outgoing (2 valid)
        WHEN p_from = 'READY_FOR_PICKUP' AND p_to = 'PICKED_UP' THEN TRUE
        WHEN p_from = 'READY_FOR_PICKUP' AND p_to = 'CANCELLED' THEN TRUE
        -- PICKED_UP outgoing (1 valid)
        WHEN p_from = 'PICKED_UP'   AND p_to = 'DELIVERED' THEN TRUE
        -- Terminal states: explicitly NO outgoing transitions
        WHEN p_from = 'DELIVERED'   THEN FALSE
        WHEN p_from = 'REJECTED'    THEN FALSE
        WHEN p_from = 'CANCELLED'   THEN FALSE
        -- All other combinations
        ELSE FALSE
    END;
$$;

-- =========================================================================
-- 8b. APPROVED MERCHANT REJECTION REASONS
-- =========================================================================

CREATE OR REPLACE FUNCTION is_valid_rejection_reason(
    p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_reason IN (
        'ITEM_UNAVAILABLE',
        'MERCHANT_CLOSED',
        'OUT_OF_STOCK',
        'UNABLE_TO_PREPARE',
        'INVALID_ORDER',
        'OTHER'
    );
$$;

-- =========================================================================
-- 8c. FINGERPRINT COMPUTATION (DETERMINISTIC)
-- =========================================================================

CREATE OR REPLACE FUNCTION compute_request_fingerprint(
    p_order_id UUID,
    p_new_state VARCHAR(30),
    p_actor_type VARCHAR(20),
    p_actor_id VARCHAR(80),
    p_reason TEXT,
    p_metadata JSONB
) RETURNS VARCHAR(64)
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(
        digest(
            p_order_id::text || '|' ||
            p_new_state || '|' ||
            p_actor_type || '|' ||
            p_actor_id || '|' ||
            COALESCE(p_reason, '') || '|' ||
            COALESCE(p_metadata::text, '{}'),
            'sha256'
        ),
        'hex'
    );
$$;

-- =========================================================================
-- 8d. ACTOR AUTHORIZATION (NO orders%ROWTYPE PARAMETER)
-- =========================================================================

CREATE OR REPLACE FUNCTION _is_authorized_order_actor(
    p_order_id UUID,
    p_actor_type VARCHAR(20),
    p_actor_id VARCHAR(80)
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_linked_driver_id UUID;
BEGIN
    SELECT * INTO v_order FROM orders WHERE id = p_order_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Customer: must own the order
    IF p_actor_type = 'CUSTOMER' AND v_order.customer_id::text = p_actor_id THEN
        RETURN v_order.order_state IN ('RECEIVED','ACCEPTED','PREPARING','PACKING','READY_FOR_PICKUP');
    END IF;

    -- Merchant: must own the order (auth.uid() = merchants.id verified in existing schema)
    IF p_actor_type = 'MERCHANT' AND v_order.merchant_id::text = p_actor_id THEN
        RETURN v_order.order_state IN ('RECEIVED','ACCEPTED','PREPARING','PACKING','READY_FOR_PICKUP');
    END IF;

    -- Driver: must be assigned to linked job
    IF p_actor_type = 'DRIVER' THEN
        SELECT driver_id INTO v_linked_driver_id
          FROM jobs
         WHERE id = v_order.job_id
           AND driver_id IS NOT NULL
         LIMIT 1;
        IF v_linked_driver_id IS NOT NULL AND v_linked_driver_id::text = p_actor_id THEN
            RETURN v_order.order_state = 'PICKED_UP';
        END IF;
        RETURN FALSE;
    END IF;

    -- Admin: full access (role already validated by backend before RPC call)
    IF p_actor_type = 'ADMIN' THEN
        RETURN TRUE;
    END IF;

    -- SYSTEM: not authorized via this helper (only expire_stale_orders uses internal RPC directly)
    RETURN FALSE;
END;
$$;

-- =========================================================================
-- 8e. INTERNAL TRANSITION IMPLEMENTATION
-- =========================================================================

CREATE OR REPLACE FUNCTION _transition_order_state_internal(
    p_order_id UUID,
    p_new_state VARCHAR(30),
    p_verified_caller_role VARCHAR(20),
    p_verified_caller_id VARCHAR(80),
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR(120) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_previous_state VARCHAR(30);
    v_transition_id UUID;
    v_fingerprint VARCHAR(64);
    v_existing_id UUID;
    v_existing_fp VARCHAR(64);
BEGIN
    -- 1. Lock authoritative order row
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'ORDER_NOT_FOUND');
    END IF;
    v_previous_state := v_order.order_state;

    -- 2. Compute deterministic fingerprint
    v_fingerprint := compute_request_fingerprint(p_order_id, p_new_state, p_verified_caller_role, p_verified_caller_id, p_reason, p_metadata);

    -- 3. Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, request_fingerprint INTO v_existing_id, v_existing_fp
          FROM order_transitions
         WHERE idempotency_key = p_idempotency_key
         FOR UPDATE;
        IF FOUND THEN
            IF v_existing_fp = v_fingerprint THEN
                RETURN json_build_object('success', true, 'duplicate', true, 'transitionId', v_existing_id, 'previousState', v_previous_state, 'newState', v_order.order_state);
            ELSE
                RETURN json_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Idempotency key used with different parameters.');
            END IF;
        END IF;
    END IF;

    -- 4. State validation
    IF NOT is_valid_order_transition(v_previous_state, p_new_state) THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', format('Cannot transition from %s to %s', v_previous_state, p_new_state));
    END IF;

    -- 5. Rejection reason enforcement (REJECTED requires valid approved reason)
    IF p_new_state = 'REJECTED' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'code', 'REJECTION_REASON_REQUIRED', 'error', 'REJECTED state requires a non-empty rejection reason.');
        END IF;
        IF NOT is_valid_rejection_reason(p_reason) THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_REJECTION_REASON', 'error', format('Rejection reason "%s" is not one of the approved values.', p_reason));
        END IF;
    END IF;

    -- 6. Actor authorization (defense-in-depth)
    IF NOT _is_authorized_order_actor(p_order_id, p_verified_caller_role, p_verified_caller_id) THEN
        RETURN json_build_object('success', false, 'code', 'FORBIDDEN_ACTOR');
    END IF;

    -- 7. Record transition
    INSERT INTO order_transitions(order_id, previous_state, new_state, actor_type, actor_id, reason, idempotency_key, request_fingerprint, metadata)
    VALUES (p_order_id, v_previous_state, p_new_state, p_verified_caller_role, p_verified_caller_id, p_reason, p_idempotency_key, v_fingerprint, p_metadata)
    RETURNING id INTO v_transition_id;

    -- 8. Mutate order state with timeout metadata
    UPDATE orders SET 
        order_state = p_new_state, 
        previous_state = v_previous_state, 
        updated_at = NOW(),
        timeout_reason = CASE WHEN p_new_state = 'CANCELLED' AND p_reason = 'MERCHANT_TIMEOUT' THEN 'MERCHANT_TIMEOUT' ELSE timeout_reason END,
        merchant_timeout_at = CASE WHEN p_new_state = 'CANCELLED' AND p_reason = 'MERCHANT_TIMEOUT' THEN NULL ELSE merchant_timeout_at END
    WHERE id = p_order_id;

    RETURN json_build_object('success', true, 'duplicate', false, 'transitionId', v_transition_id, 'previousState', v_previous_state, 'newState', p_new_state);
END;
$$;

-- =========================================================================
-- 8f. DEDICATED SYSTEM TRANSITION PATH (TIMEOUT ONLY)
-- =========================================================================

CREATE OR REPLACE FUNCTION _transition_order_state_system(
    p_order_id UUID,
    p_new_state VARCHAR(30),
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR(120) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_previous_state VARCHAR(30);
    v_transition_id UUID;
    v_fingerprint VARCHAR(64);
    v_existing_id UUID;
    v_existing_fp VARCHAR(64);
BEGIN
    -- 1. Lock authoritative order row
    SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'ORDER_NOT_FOUND');
    END IF;
    v_previous_state := v_order.order_state;

    -- 2. Compute deterministic fingerprint (SYSTEM actor)
    v_fingerprint := compute_request_fingerprint(p_order_id, p_new_state, 'SYSTEM', 'TIMEOUT_ENGINE', p_reason, p_metadata);

    -- 3. Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id, request_fingerprint INTO v_existing_id, v_existing_fp
          FROM order_transitions
         WHERE idempotency_key = p_idempotency_key
         FOR UPDATE;
        IF FOUND THEN
            IF v_existing_fp = v_fingerprint THEN
                RETURN json_build_object('success', true, 'duplicate', true, 'transitionId', v_existing_id, 'previousState', v_previous_state, 'newState', v_order.order_state);
            ELSE
                RETURN json_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT', 'error', 'Idempotency key used with different parameters.');
            END IF;
        END IF;
    END IF;

    -- 4. State validation
    IF NOT is_valid_order_transition(v_previous_state, p_new_state) THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_TRANSITION', 'error', format('Cannot transition from %s to %s', v_previous_state, p_new_state));
    END IF;

    -- 5. Rejection reason enforcement (REJECTED requires valid approved reason)
    IF p_new_state = 'REJECTED' THEN
        IF p_reason IS NULL OR trim(p_reason) = '' THEN
            RETURN json_build_object('success', false, 'code', 'REJECTION_REASON_REQUIRED', 'error', 'REJECTED state requires a non-empty rejection reason.');
        END IF;
        IF NOT is_valid_rejection_reason(p_reason) THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_REJECTION_REASON', 'error', format('Rejection reason "%s" is not one of the approved values.', p_reason));
        END IF;
    END IF;

    -- 6. Record transition
    INSERT INTO order_transitions(order_id, previous_state, new_state, actor_type, actor_id, reason, idempotency_key, request_fingerprint, metadata)
    VALUES (p_order_id, v_previous_state, p_new_state, 'SYSTEM', 'TIMEOUT_ENGINE', p_reason, p_idempotency_key, v_fingerprint, p_metadata)
    RETURNING id INTO v_transition_id;

    -- 7. Mutate order state with timeout metadata
    UPDATE orders SET 
        order_state = p_new_state, 
        previous_state = v_previous_state, 
        updated_at = NOW(),
        timeout_reason = CASE WHEN p_new_state = 'CANCELLED' AND p_reason = 'MERCHANT_TIMEOUT' THEN 'MERCHANT_TIMEOUT' ELSE timeout_reason END,
        merchant_timeout_at = CASE WHEN p_new_state = 'CANCELLED' AND p_reason = 'MERCHANT_TIMEOUT' THEN NULL ELSE merchant_timeout_at END
    WHERE id = p_order_id;

    RETURN json_build_object('success', true, 'duplicate', false, 'transitionId', v_transition_id, 'previousState', v_previous_state, 'newState', p_new_state);
END;
$$;

-- =========================================================================
-- 8f. BACKEND TRANSITION RPC (NORMAL ACTORS ONLY, REJECTS SYSTEM)
-- =========================================================================

CREATE OR REPLACE FUNCTION transition_order_state(
    p_order_id UUID,
    p_new_state VARCHAR(30),
    p_verified_caller_role VARCHAR(20),
    p_verified_caller_id VARCHAR(80),
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR(120) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions AS $$
BEGIN
    -- Reject SYSTEM attempts via backend RPC
    IF p_verified_caller_role = 'SYSTEM' THEN
        RETURN json_build_object('success', false, 'code', 'FORBIDDEN_SYSTEM_VIA_BACKEND_RPC');
    END IF;
    
    -- Delegate to internal implementation
    RETURN _transition_order_state_internal(
        p_order_id, p_new_state, p_verified_caller_role, p_verified_caller_id,
        p_reason, p_idempotency_key, p_metadata
    );
END;
$$;

-- =========================================================================
-- 8g. MERCHANT TIMEOUT HANDLER (SYSTEM-ONLY PATH)
-- =========================================================================

CREATE OR REPLACE FUNCTION expire_stale_orders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_processed INTEGER := 0;
    v_order_id UUID;
    v_prev_state VARCHAR(30);
    v_result JSON;
BEGIN
     FOR v_order_id, v_prev_state IN
        SELECT id, order_state
          FROM orders
         WHERE merchant_timeout_at IS NOT NULL
           AND merchant_timeout_at < NOW()
           AND order_state IN ('RECEIVED', 'ACCEPTED')
          ORDER BY merchant_timeout_at ASC
    LOOP
        v_result := _transition_order_state_system(
            p_order_id => v_order_id,
            p_new_state => 'CANCELLED',
            p_reason => 'MERCHANT_TIMEOUT',
            p_idempotency_key => 'timeout_' || v_order_id::text,
            p_metadata => jsonb_build_object('source', 'expire_stale_orders')
        );

        -- Count only actual successful new transitions
        IF (v_result->>'success')::boolean = TRUE AND (v_result->>'duplicate')::boolean IS DISTINCT FROM TRUE THEN
            v_processed := v_processed + 1;
        END IF;
    END LOOP;

    RETURN v_processed;
END;
$$;

-- =========================================================================
-- 9. MERCHANT OWNERSHIP TRIGGER (INSERT + UPDATE)
-- =========================================================================

CREATE OR REPLACE FUNCTION validate_order_line_merchant()
RETURNS TRIGGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_order_merchant_id UUID;
    v_catalog_merchant_id UUID;
BEGIN
    -- 1. Verify merchant_id matches parent order
    SELECT merchant_id INTO v_order_merchant_id
      FROM orders
     WHERE id = NEW.order_id;
    IF v_order_merchant_id IS NULL THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND for order_id %', NEW.order_id;
    END IF;
    IF NEW.merchant_id IS NULL OR NEW.merchant_id <> v_order_merchant_id THEN
        RAISE EXCEPTION 'MERCHANT_MISMATCH: order_lines.merchant_id % does not match orders.merchant_id %',
            NEW.merchant_id, v_order_merchant_id;
    END IF;

    -- 2. Verify catalog row belongs to the same merchant
    IF NEW.catalog_kind = 'RESTAURANT_PRODUCT' AND NEW.restaurant_product_id IS NOT NULL THEN
        SELECT merchant_id INTO v_catalog_merchant_id
          FROM products
         WHERE id = NEW.restaurant_product_id;
        IF v_catalog_merchant_id IS NULL THEN
            RAISE EXCEPTION 'PRODUCT_NOT_FOUND for restaurant_product_id %', NEW.restaurant_product_id;
        END IF;
        IF v_catalog_merchant_id <> NEW.merchant_id THEN
            RAISE EXCEPTION 'PRODUCT_MERCHANT_MISMATCH: product % belongs to merchant %, but order_line belongs to merchant %',
                NEW.restaurant_product_id, v_catalog_merchant_id, NEW.merchant_id;
        END IF;
    ELSIF NEW.catalog_kind = 'GROCERY_INVENTORY' AND NEW.grocery_inventory_id IS NOT NULL THEN
        SELECT merchant_id INTO v_catalog_merchant_id
          FROM merchant_grocery_inventory
         WHERE id = NEW.grocery_inventory_id;
        IF v_catalog_merchant_id IS NULL THEN
            RAISE EXCEPTION 'INVENTORY_NOT_FOUND for grocery_inventory_id %', NEW.grocery_inventory_id;
        END IF;
        IF v_catalog_merchant_id <> NEW.merchant_id THEN
            RAISE EXCEPTION 'INVENTORY_MERCHANT_MISMATCH: inventory % belongs to merchant %, but order_line belongs to merchant %',
                NEW.grocery_inventory_id, v_catalog_merchant_id, NEW.merchant_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_order_line_merchant
    BEFORE INSERT OR UPDATE ON public.order_lines
    FOR EACH ROW
    EXECUTE FUNCTION validate_order_line_merchant();

-- =========================================================================
-- 10. SNAPSHOT IMMUTABILITY TRIGGER
-- =========================================================================

CREATE OR REPLACE FUNCTION prevent_snapshot_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- On INSERT, allow everything
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;

    -- On UPDATE, prevent changes to immutable snapshot fields
    IF OLD.quantity IS DISTINCT FROM NEW.quantity OR
       OLD.unit_snapshot IS DISTINCT FROM NEW.unit_snapshot OR
       OLD.unit_price_snapshot IS DISTINCT FROM NEW.unit_price_snapshot OR
       OLD.line_total IS DISTINCT FROM NEW.line_total OR
       OLD.catalog_kind IS DISTINCT FROM NEW.catalog_kind OR
       OLD.restaurant_product_id IS DISTINCT FROM NEW.restaurant_product_id OR
       OLD.grocery_inventory_id IS DISTINCT FROM NEW.grocery_inventory_id OR
       OLD.merchant_id IS DISTINCT FROM NEW.merchant_id OR
       OLD.order_id IS DISTINCT FROM NEW.order_id OR
       OLD.product_name_snapshot IS DISTINCT FROM NEW.product_name_snapshot THEN
        RAISE EXCEPTION 'SNAPSHOT_MUTATION: immutable fields cannot be modified on order_lines.id = %', OLD.id;
    END IF;

    -- packed_confirmed_quantity can be set once (NULL -> value) but not changed after
    IF OLD.packed_confirmed_quantity IS NOT NULL AND NEW.packed_confirmed_quantity IS DISTINCT FROM OLD.packed_confirmed_quantity THEN
        RAISE EXCEPTION 'PACKED_QUANTITY_MUTATION: packed_confirmed_quantity cannot be changed once set on order_lines.id = %', OLD.id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_snapshot_mutation
    BEFORE UPDATE ON public.order_lines
    FOR EACH ROW
    EXECUTE FUNCTION prevent_snapshot_mutation();

-- =========================================================================
-- 11. FULFILLMENT INTEGRITY TRIGGER
-- =========================================================================

CREATE OR REPLACE FUNCTION compute_order_line_fulfillment()
RETURNS TRIGGER
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    -- Compute unfulfilled quantity in native unit
    NEW.unfulfilled_quantity := GREATEST(0, NEW.quantity - COALESCE(NEW.fulfilled_quantity, 0));

    -- Compute partial fulfillment flag
    NEW.is_partially_fulfilled :=
        (NEW.fulfilled_quantity IS NOT NULL AND NEW.fulfilled_quantity < NEW.quantity);

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_compute_order_line_fulfillment
    BEFORE INSERT OR UPDATE OF fulfilled_quantity ON public.order_lines
    FOR EACH ROW
    EXECUTE FUNCTION compute_order_line_fulfillment();

-- =========================================================================
-- 12. EXECUTE PRIVILEGE RESTRICTIONS
-- =========================================================================

-- transition_order_state (backend RPC, rejects SYSTEM)
REVOKE EXECUTE ON FUNCTION transition_order_state(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION transition_order_state(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION transition_order_state(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION transition_order_state(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) TO service_role;

-- _transition_order_state_internal (private, SYSTEM-capable)
REVOKE EXECUTE ON FUNCTION _transition_order_state_internal(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _transition_order_state_internal(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION _transition_order_state_internal(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION _transition_order_state_internal(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, VARCHAR(120), JSONB) TO service_role;

-- expire_stale_orders (privileged timeout path)
REVOKE EXECUTE ON FUNCTION expire_stale_orders() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expire_stale_orders() FROM authenticated;
REVOKE EXECUTE ON FUNCTION expire_stale_orders() FROM anon;
GRANT EXECUTE ON FUNCTION expire_stale_orders() TO service_role;

-- _transition_order_state_system (dedicated SYSTEM-only timeout path)
REVOKE EXECUTE ON FUNCTION _transition_order_state_system(UUID, VARCHAR(30), TEXT, VARCHAR(120), JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _transition_order_state_system(UUID, VARCHAR(30), TEXT, VARCHAR(120), JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION _transition_order_state_system(UUID, VARCHAR(30), TEXT, VARCHAR(120), JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION _transition_order_state_system(UUID, VARCHAR(30), TEXT, VARCHAR(120), JSONB) TO service_role;

-- Helper functions
REVOKE EXECUTE ON FUNCTION is_valid_order_transition(VARCHAR(30), VARCHAR(30)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_valid_order_transition(VARCHAR(30), VARCHAR(30)) FROM authenticated;
REVOKE EXECUTE ON FUNCTION is_valid_order_transition(VARCHAR(30), VARCHAR(30)) FROM anon;
GRANT EXECUTE ON FUNCTION is_valid_order_transition(VARCHAR(30), VARCHAR(30)) TO service_role;

REVOKE EXECUTE ON FUNCTION is_valid_rejection_reason(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION is_valid_rejection_reason(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION is_valid_rejection_reason(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION is_valid_rejection_reason(TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION _is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION _is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM authenticated;
REVOKE EXECUTE ON FUNCTION _is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM anon;
GRANT EXECUTE ON FUNCTION _is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) TO service_role;

REVOKE EXECUTE ON FUNCTION compute_request_fingerprint(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION compute_request_fingerprint(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, JSONB) FROM authenticated;
REVOKE EXECUTE ON FUNCTION compute_request_fingerprint(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION compute_request_fingerprint(UUID, VARCHAR(30), VARCHAR(20), VARCHAR(80), TEXT, JSONB) TO service_role;

-- Trigger functions
REVOKE EXECUTE ON FUNCTION validate_order_line_merchant() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION validate_order_line_merchant() FROM authenticated;
REVOKE EXECUTE ON FUNCTION validate_order_line_merchant() FROM anon;
GRANT EXECUTE ON FUNCTION validate_order_line_merchant() TO service_role;

REVOKE EXECUTE ON FUNCTION prevent_snapshot_mutation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION prevent_snapshot_mutation() FROM authenticated;
REVOKE EXECUTE ON FUNCTION prevent_snapshot_mutation() FROM anon;
GRANT EXECUTE ON FUNCTION prevent_snapshot_mutation() TO service_role;

REVOKE EXECUTE ON FUNCTION compute_order_line_fulfillment() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION compute_order_line_fulfillment() FROM authenticated;
REVOKE EXECUTE ON FUNCTION compute_order_line_fulfillment() FROM anon;
GRANT EXECUTE ON FUNCTION compute_order_line_fulfillment() TO service_role;
