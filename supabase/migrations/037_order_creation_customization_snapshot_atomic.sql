-- =============================================================================
-- NABIN PLATFORM — ATOMIC ORDER CUSTOMIZATION SNAPSHOT PERSISTENCE
-- Migration: 037_order_creation_customization_snapshot_atomic.sql
-- Status: ISOLATED VALIDATION MIGRATION (Forward-compatible correction for Migration 036)
-- =============================================================================
-- Problem Addressed:
--   Migration 036 introduced `public.order_lines.customization_snapshot JSONB` to
--   capture immutable structured snapshots of dish variants, add-on selections,
--   and authoritative unit pricing during customer food checkout.
--   However, `create_order_with_lines_atomic` (defined in Migration 019) omitted
--   mapping `customization_snapshot` from input items into the `order_lines` INSERT,
--   causing order lines created via the atomic RPC to receive the default '{}'.
--
-- Solution:
--   Redefine `create_order_with_lines_atomic` to extract `customization_snapshot`
--   from each item in `p_items`, persist it directly into `public.order_lines`,
--   and embed it in `public.orders.items_snapshot`.
-- =============================================================================

CREATE OR REPLACE FUNCTION create_order_with_lines_atomic(
    p_service_type VARCHAR(30),
    p_customer_id UUID,
    p_merchant_id UUID,
    p_total_amount NUMERIC(12,2),
    p_items JSONB,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_idempotency_key VARCHAR(120) DEFAULT NULL,
    p_checkout_id UUID DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_order_id UUID;
    v_order_number VARCHAR(80);
    v_fingerprint TEXT;
    v_existing_order_id UUID;
    v_existing_fingerprint TEXT;
    v_existing_order_number VARCHAR(80);
    v_existing_order_state VARCHAR(30);
    v_existing_service_type VARCHAR(30);
    v_existing_customer_id UUID;
    v_existing_merchant_id UUID;
    v_existing_total_amount NUMERIC(12,2);
    v_existing_items JSONB;
    v_existing_metadata JSONB;
    v_existing_created_at TIMESTAMPTZ;
    v_merchant_type VARCHAR(30);
    v_checkout_customer_id UUID;
    v_checkout_merchant_id UUID;
    v_checkout_service_type VARCHAR(30);
    v_checkout_job_id UUID;
    v_checkout_order_id UUID;
    v_checkout_status VARCHAR(30);
    v_checkout_cancelled_at TIMESTAMPTZ;
    v_line JSONB;
    v_catalog_kind VARCHAR(20);
    v_restaurant_product_id UUID;
    v_grocery_inventory_id UUID;
    v_product_merchant_id UUID;
    v_product_name_db VARCHAR(200);
    v_product_price_db NUMERIC(10,2);
    v_inventory_merchant_id UUID;
    v_inventory_price_db NUMERIC(10,2);
    v_grocery_name_db VARCHAR(200);
    v_grocery_unit_db VARCHAR(30);
    v_line_merchant_id UUID;
    v_first_merchant_id UUID;
    v_line_count INTEGER;
    v_product_name_snapshot VARCHAR(200);
    v_quantity NUMERIC(10,3);
    v_unit_snapshot VARCHAR(30);
    v_unit_price_snapshot NUMERIC(10,2);
    v_line_total NUMERIC(12,2);
    v_customization_snapshot JSONB;
    v_order_items JSONB;
    v_validated_lines JSONB := '[]'::JSONB;
BEGIN
    -- =====================================================================
    -- 1. VALIDATE BASIC INPUTS
    -- =====================================================================
    IF p_service_type NOT IN ('FOOD', 'GROCERY') THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_SERVICE_TYPE', 'error', 'Service type must be FOOD or GROCERY');
    END IF;

    IF p_customer_id IS NULL THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_CUSTOMER', 'error', 'Customer ID is required');
    END IF;

    IF p_merchant_id IS NULL THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_MERCHANT', 'error', 'Merchant ID is required');
    END IF;

    IF p_total_amount IS NULL OR p_total_amount < 0 THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_AMOUNT', 'error', 'Total amount must be >= 0');
    END IF;

    IF p_items IS NULL OR NOT jsonb_typeof(p_items) = 'array' OR jsonb_array_length(p_items) = 0 THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_ITEMS', 'error', 'Items must be a non-empty JSONB array');
    END IF;

    -- Verify customer exists in authoritative users table
    PERFORM 1 FROM public.users WHERE id = p_customer_id;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'CUSTOMER_NOT_FOUND', 'error', 'Customer not found: ' || p_customer_id::TEXT);
    END IF;

    -- Verify merchant exists in authoritative merchants table and check merchant capability
    SELECT merchant_type INTO v_merchant_type
      FROM public.merchants
     WHERE id = p_merchant_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'MERCHANT_NOT_FOUND', 'error', 'Merchant not found: ' || p_merchant_id::TEXT);
    END IF;

    IF p_service_type = 'FOOD' AND v_merchant_type NOT IN ('RESTAURANT', 'HYBRID_BOTH') THEN
        RETURN json_build_object('success', false, 'code', 'MERCHANT_TYPE_MISMATCH', 'error', 'Merchant is not authorized for FOOD service');
    END IF;

    IF p_service_type = 'GROCERY' AND v_merchant_type NOT IN ('GROCERY', 'HYBRID_BOTH') THEN
        RETURN json_build_object('success', false, 'code', 'MERCHANT_TYPE_MISMATCH', 'error', 'Merchant is not authorized for GROCERY service');
    END IF;

    -- =====================================================================
    -- 2. IDEMPOTENCY CHECK WITH NAMESPACED ADVISORY LOCK
    -- =====================================================================
    IF p_idempotency_key IS NOT NULL THEN
        -- Acquire transaction-scoped advisory lock namespaced to order creation
        PERFORM pg_advisory_xact_lock(hashtext('order_creation:' || p_idempotency_key)::BIGINT);

        -- Check for existing token
        SELECT order_id, request_fingerprint
          INTO v_existing_order_id, v_existing_fingerprint
          FROM public.order_creation_tokens
         WHERE idempotency_key = p_idempotency_key;

        IF FOUND THEN
            -- Compute incoming fingerprint
            v_fingerprint := compute_request_fingerprint(
                p_service_type, p_customer_id, p_merchant_id, p_total_amount,
                p_items, p_checkout_id, p_metadata
            );

            -- Compare fingerprints
            IF v_existing_fingerprint = v_fingerprint THEN
                -- Same request: return existing order representation
                SELECT order_number, order_state, service_type, customer_id, merchant_id, total_amount, items_snapshot, metadata, created_at
                  INTO v_existing_order_number, v_existing_order_state, v_existing_service_type, v_existing_customer_id, v_existing_merchant_id, v_existing_total_amount, v_existing_items, v_existing_metadata, v_existing_created_at
                  FROM public.orders
                 WHERE id = v_existing_order_id;

                RETURN json_build_object(
                    'success', true,
                    'duplicate', true,
                    'order_id', v_existing_order_id,
                    'order_number', v_existing_order_number,
                    'order_state', v_existing_order_state,
                    'service_type', v_existing_service_type,
                    'customer_id', v_existing_customer_id,
                    'merchant_id', v_existing_merchant_id,
                    'total_amount', v_existing_total_amount,
                    'items', v_existing_items,
                    'metadata', v_existing_metadata,
                    'created_at', v_existing_created_at,
                    'message', 'Idempotent replay: returning existing order'
                );
            ELSE
                -- Different payload: reject conflict
                RETURN json_build_object(
                    'success', false,
                    'code', 'IDEMPOTENCY_CONFLICT',
                    'error', 'Idempotency key has already been used with different request parameters'
                );
            END IF;
        END IF;
    END IF;

    -- =====================================================================
    -- 3. VALIDATE CHECKOUT IF PROVIDED
    -- =====================================================================
    IF p_checkout_id IS NOT NULL THEN
        -- Advisory lock for checkout linkage
        PERFORM pg_advisory_xact_lock(hashtext('checkout_lock:' || p_checkout_id::TEXT)::BIGINT);

        SELECT customer_id, merchant_id, service_type, job_id, order_id, status, cancelled_at
          INTO v_checkout_customer_id, v_checkout_merchant_id, v_checkout_service_type,
               v_checkout_job_id, v_checkout_order_id, v_checkout_status, v_checkout_cancelled_at
          FROM public.checkouts
         WHERE id = p_checkout_id;

        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_CHECKOUT', 'error', 'Checkout not found');
        END IF;

        -- Status validation
        IF v_checkout_status IN ('CANCELLED', 'FAILED') OR v_checkout_cancelled_at IS NOT NULL THEN
            RETURN json_build_object('success', false, 'code', 'CHECKOUT_NOT_ACTIVE', 'error', 'Checkout is cancelled or failed');
        END IF;

        -- Ownership validation
        IF v_checkout_customer_id IS DISTINCT FROM p_customer_id THEN
            RETURN json_build_object('success', false, 'code', 'CHECKOUT_OWNERSHIP_MISMATCH', 'error', 'Checkout does not belong to this customer');
        END IF;

        IF v_checkout_merchant_id IS DISTINCT FROM p_merchant_id THEN
            RETURN json_build_object('success', false, 'code', 'CHECKOUT_OWNERSHIP_MISMATCH', 'error', 'Checkout does not belong to this merchant');
        END IF;

        -- Service type validation
        IF v_checkout_service_type IS DISTINCT FROM p_service_type THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_CHECKOUT', 'error', 'Checkout service type mismatch');
        END IF;

        -- Linkage validation
        IF v_checkout_job_id IS NOT NULL THEN
            RETURN json_build_object('success', false, 'code', 'CHECKOUT_ALREADY_LINKED', 'error', 'Checkout is already linked to a job');
        END IF;

        IF v_checkout_order_id IS NOT NULL THEN
            RETURN json_build_object('success', false, 'code', 'CHECKOUT_ALREADY_LINKED', 'error', 'Checkout is already linked to an order');
        END IF;
    END IF;

    -- =====================================================================
    -- 4. VALIDATE ORDER LINES AND CATALOG OWNERSHIP
    -- =====================================================================
    v_first_merchant_id := NULL;
    v_line_count := 0;
    v_order_items := '[]'::JSONB;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_line_count := v_line_count + 1;

        -- Validate catalog_kind
        v_catalog_kind := v_line->>'catalog_kind';
        IF v_catalog_kind NOT IN ('RESTAURANT_PRODUCT', 'GROCERY_INVENTORY') THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_CATALOG_KIND', 'error', 'Invalid catalog_kind at line ' || v_line_count);
        END IF;

        -- Enforce service type vs catalog kind consistency
        IF p_service_type = 'FOOD' AND v_catalog_kind <> 'RESTAURANT_PRODUCT' THEN
            RETURN json_build_object('success', false, 'code', 'SERVICE_CATALOG_MISMATCH', 'error', 'FOOD orders must contain RESTAURANT_PRODUCT lines only at line ' || v_line_count);
        END IF;

        IF p_service_type = 'GROCERY' AND v_catalog_kind <> 'GROCERY_INVENTORY' THEN
            RETURN json_build_object('success', false, 'code', 'SERVICE_CATALOG_MISMATCH', 'error', 'GROCERY orders must contain GROCERY_INVENTORY lines only at line ' || v_line_count);
        END IF;

        -- Extract catalog reference IDs and resolve snapshots
        IF v_catalog_kind = 'RESTAURANT_PRODUCT' THEN
            BEGIN
                v_restaurant_product_id := (v_line->>'restaurant_product_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                RETURN json_build_object('success', false, 'code', 'INVALID_CATALOG_REFERENCE', 'error', 'Invalid UUID for restaurant_product_id at line ' || v_line_count);
            END;
            v_grocery_inventory_id := NULL;

            IF v_restaurant_product_id IS NULL THEN
                RETURN json_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'error', 'restaurant_product_id is required for RESTAURANT_PRODUCT at line ' || v_line_count);
            END IF;

            -- Verify product exists and belongs to merchant
            SELECT merchant_id, name, price
              INTO v_product_merchant_id, v_product_name_db, v_product_price_db
              FROM public.products
             WHERE id = v_restaurant_product_id;

            IF NOT FOUND THEN
                RETURN json_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'error', 'Product ' || v_restaurant_product_id || ' not found at line ' || v_line_count);
            END IF;

            IF v_product_merchant_id IS DISTINCT FROM p_merchant_id THEN
                RETURN json_build_object('success', false, 'code', 'MERCHANT_MISMATCH', 'error', 'Product ' || v_restaurant_product_id || ' belongs to another merchant at line ' || v_line_count);
            END IF;

            v_line_merchant_id := v_product_merchant_id;

            -- Resolve snapshots defensively
            v_product_name_snapshot := COALESCE(NULLIF(v_line->>'product_name_snapshot', ''), v_product_name_db);
            v_unit_price_snapshot := COALESCE((v_line->>'unit_price')::NUMERIC, (v_line->>'unit_price_snapshot')::NUMERIC, v_product_price_db);
            v_unit_snapshot := COALESCE(NULLIF(v_line->>'unit_snapshot', ''), 'piece');

        ELSIF v_catalog_kind = 'GROCERY_INVENTORY' THEN
            BEGIN
                v_grocery_inventory_id := (v_line->>'grocery_inventory_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                RETURN json_build_object('success', false, 'code', 'INVALID_CATALOG_REFERENCE', 'error', 'Invalid UUID for grocery_inventory_id at line ' || v_line_count);
            END;
            v_restaurant_product_id := NULL;

            IF v_grocery_inventory_id IS NULL THEN
                RETURN json_build_object('success', false, 'code', 'INVENTORY_NOT_FOUND', 'error', 'grocery_inventory_id is required for GROCERY_INVENTORY at line ' || v_line_count);
            END IF;

            -- Verify inventory exists and belongs to merchant
            SELECT mg.merchant_id, mg.price, mg.unit, COALESCE(mc.name, 'Grocery Item')
              INTO v_inventory_merchant_id, v_inventory_price_db, v_grocery_unit_db, v_grocery_name_db
              FROM public.merchant_grocery_inventory mg
              LEFT JOIN public.master_grocery_catalog mc ON mc.id = mg.product_id
             WHERE mg.id = v_grocery_inventory_id;

            IF NOT FOUND THEN
                RETURN json_build_object('success', false, 'code', 'INVENTORY_NOT_FOUND', 'error', 'Inventory ' || v_grocery_inventory_id || ' not found at line ' || v_line_count);
            END IF;

            IF v_inventory_merchant_id IS DISTINCT FROM p_merchant_id THEN
                RETURN json_build_object('success', false, 'code', 'MERCHANT_MISMATCH', 'error', 'Inventory ' || v_grocery_inventory_id || ' belongs to another merchant at line ' || v_line_count);
            END IF;

            v_line_merchant_id := v_inventory_merchant_id;

            -- Resolve snapshots defensively
            v_product_name_snapshot := COALESCE(NULLIF(v_line->>'product_name_snapshot', ''), v_grocery_name_db, 'Grocery Item');
            v_unit_price_snapshot := COALESCE((v_line->>'unit_price')::NUMERIC, (v_line->>'unit_price_snapshot')::NUMERIC, v_inventory_price_db);
            v_unit_snapshot := COALESCE(NULLIF(v_line->>'unit_snapshot', ''), v_grocery_unit_db, 'piece');
        END IF;

        -- Extract customization snapshot (JSONB object, defaults to empty object)
        v_customization_snapshot := COALESCE(v_line->'customization_snapshot', '{}'::jsonb);

        -- Quantity extraction and numeric validation
        BEGIN
            v_quantity := (v_line->>'quantity')::NUMERIC;
        EXCEPTION WHEN OTHERS THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_QUANTITY', 'error', 'Numeric quantity is required at line ' || v_line_count);
        END;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_QUANTITY', 'error', 'Quantity must be > 0 at line ' || v_line_count);
        END IF;

        -- Unit price validation
        IF v_unit_price_snapshot IS NULL OR v_unit_price_snapshot < 0 THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_UNIT_PRICE', 'error', 'Unit price must be >= 0 at line ' || v_line_count);
        END IF;

        -- Unit snapshot validation against allowed enum in order_lines CHECK constraint
        IF v_unit_snapshot NOT IN ('g', 'kg', 'ml', 'litre', 'piece', 'dozen', 'pack') THEN
            RETURN json_build_object('success', false, 'code', 'INVALID_UNIT', 'error', 'Invalid unit_snapshot: ' || v_unit_snapshot || ' at line ' || v_line_count);
        END IF;

        -- Verify single-merchant order integrity
        IF v_first_merchant_id IS NULL THEN
            v_first_merchant_id := v_line_merchant_id;
        ELSIF v_first_merchant_id IS DISTINCT FROM v_line_merchant_id THEN
            RETURN json_build_object('success', false, 'code', 'MERCHANT_MISMATCH', 'error', 'All order lines must belong to the same merchant');
        END IF;

        v_line_total := ROUND(v_quantity * v_unit_price_snapshot, 2);

        -- Build canonical items snapshot (including customization_snapshot)
        v_order_items := v_order_items || jsonb_build_object(
            'catalog_kind', v_catalog_kind,
            'restaurant_product_id', v_restaurant_product_id,
            'grocery_inventory_id', v_grocery_inventory_id,
            'product_name_snapshot', v_product_name_snapshot,
            'quantity', v_quantity,
            'unit_snapshot', v_unit_snapshot,
            'unit_price_snapshot', v_unit_price_snapshot,
            'line_total', v_line_total,
            'customization_snapshot', v_customization_snapshot
        );

        -- Collect validated line data for batch insert (including customization_snapshot)
        v_validated_lines := v_validated_lines || jsonb_build_object(
            'catalog_kind', v_catalog_kind,
            'restaurant_product_id', v_restaurant_product_id,
            'grocery_inventory_id', v_grocery_inventory_id,
            'product_name_snapshot', v_product_name_snapshot,
            'quantity', v_quantity,
            'unit_snapshot', v_unit_snapshot,
            'unit_price_snapshot', v_unit_price_snapshot,
            'line_total', v_line_total,
            'customization_snapshot', v_customization_snapshot
        );
    END LOOP;

    -- =====================================================================
    -- 5. COMPUTE REQUEST FINGERPRINT
    -- =====================================================================
    v_fingerprint := compute_request_fingerprint(
        p_service_type, p_customer_id, p_merchant_id, p_total_amount,
        p_items, p_checkout_id, p_metadata
    );

    -- =====================================================================
    -- 6. INSERT ORDER
    -- =====================================================================
    v_order_number := 'ORD-' || lpad(nextval('public.order_number_seq')::TEXT, 8, '0');

    INSERT INTO public.orders (
        order_number, checkout_id, customer_id, merchant_id, service_type,
        order_state, previous_state, total_amount, currency,
        items_snapshot, metadata, created_at, updated_at
    ) VALUES (
        v_order_number,
        p_checkout_id,
        p_customer_id,
        p_merchant_id,
        p_service_type,
        'RECEIVED',
        NULL,
        p_total_amount,
        'INR',
        v_order_items,
        p_metadata,
        NOW(),
        NOW()
    ) RETURNING id INTO v_order_id;

    -- =====================================================================
    -- 7. INSERT ORDER LINES (WITH CUSTOMIZATION_SNAPSHOT PERSISTENCE)
    -- =====================================================================
    INSERT INTO public.order_lines (
        order_id, merchant_id, catalog_kind,
        restaurant_product_id, grocery_inventory_id,
        product_name_snapshot, quantity, unit_snapshot,
        unit_price_snapshot, line_total,
        customization_snapshot,
        created_at
    )
    SELECT
        v_order_id,
        p_merchant_id,
        line->>'catalog_kind',
        (line->>'restaurant_product_id')::UUID,
        (line->>'grocery_inventory_id')::UUID,
        line->>'product_name_snapshot',
        (line->>'quantity')::NUMERIC,
        line->>'unit_snapshot',
        (line->>'unit_price_snapshot')::NUMERIC,
        (line->>'line_total')::NUMERIC,
        COALESCE(line->'customization_snapshot', '{}'::jsonb),
        NOW()
    FROM jsonb_array_elements(v_validated_lines) AS t(line);

    -- =====================================================================
    -- 8. INSERT IDEMPOTENCY TOKEN
    -- =====================================================================
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.order_creation_tokens (idempotency_key, order_id, request_fingerprint)
        VALUES (p_idempotency_key, v_order_id, v_fingerprint);
    END IF;

    -- =====================================================================
    -- 9. LINK CHECKOUT IF SUPPLIED
    -- =====================================================================
    IF p_checkout_id IS NOT NULL THEN
        UPDATE public.checkouts
           SET order_id = v_order_id
         WHERE id = p_checkout_id;
    END IF;

    -- =====================================================================
    -- 10. RETURN CREATED ORDER
    -- =====================================================================
    RETURN json_build_object(
        'success', true,
        'duplicate', false,
        'order_id', v_order_id,
        'order_number', v_order_number,
        'order_state', 'RECEIVED',
        'service_type', p_service_type,
        'customer_id', p_customer_id,
        'merchant_id', p_merchant_id,
        'total_amount', p_total_amount,
        'items', v_order_items,
        'metadata', p_metadata,
        'created_at', NOW()
    );
END;
$$;

-- =========================================================================
-- EXECUTE PRIVILEGES & SECURITY HARDENING
-- =========================================================================
REVOKE EXECUTE ON FUNCTION create_order_with_lines_atomic(
    VARCHAR(30), UUID, UUID, NUMERIC(12,2), JSONB, JSONB, VARCHAR(120), UUID
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION create_order_with_lines_atomic(
    VARCHAR(30), UUID, UUID, NUMERIC(12,2), JSONB, JSONB, VARCHAR(120), UUID
) FROM authenticated;
REVOKE EXECUTE ON FUNCTION create_order_with_lines_atomic(
    VARCHAR(30), UUID, UUID, NUMERIC(12,2), JSONB, JSONB, VARCHAR(120), UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION create_order_with_lines_atomic(
    VARCHAR(30), UUID, UUID, NUMERIC(12,2), JSONB, JSONB, VARCHAR(120), UUID
) TO service_role;
