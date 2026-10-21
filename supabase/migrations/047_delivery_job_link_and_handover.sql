-- =========================================================================
-- 047_delivery_job_link_and_handover.sql
--
-- LOCAL ONLY. Applied to the local Docker PostgreSQL (127.0.0.1:54322) by
-- backend/scripts/apply_local_migration.js. Never applied to a hosted project.
--
-- WHAT IS WRONG TODAY (measured on the local target at HEAD 23ee5d1, 2026-10-18).
--
-- 1. No FOOD or GROCERY order has ever had a driver job. `orders` holds 1,354 rows and
--    `count(job_id)` is 0 — the column is not merely under-used, nothing writes it. `jobs`
--    holds 2,652 rows: RIDE 2,134 and PARCEL 518, and ZERO rows of the FOOD or GROCERY
--    service types the CHECK at 001 already allows. 92 orders sit at READY_FOR_PICKUP, all
--    92 with no job. A delivery order therefore has no rider to pick it up, and the lifecycle
--    a customer is shown ends at "ready for pickup" forever.
--
-- 2. Even if a job existed, the assigned driver could not record the pickup. The DRIVER branch
--    of `_is_authorized_order_actor` (018:537-547) reads:
--
--        IF v_linked_driver_id IS NOT NULL AND v_linked_driver_id::text = p_actor_id THEN
--            RETURN v_order.order_state = 'PICKED_UP';
--
--    That is the authorization for the transition OUT OF PICKED_UP. An assigned driver standing
--    at READY_FOR_PICKUP is refused (FORBIDDEN_ACTOR), so READY_FOR_PICKUP -> PICKED_UP — the
--    one transition that needs a driver and not the merchant — is unreachable by design.
--
-- 3. `orders.order_channel` cannot be used to decide what to dispatch. It carries
--    `DEFAULT 'DELIVERY'::character varying` and no INSERT writes it, so a dine-in order reads
--    as a delivery order in that column. The channel the customer actually chose lives in
--    `metadata.orderChannel`: measured 1,221 orders name none, 110 DELIVERY, 16 DINE_IN,
--    7 TAKEAWAY. The RPC below gates on the named value, not on the column default.
--
-- WHAT THIS MIGRATION ADDS.
--
--   * `_is_authorized_order_actor` DRIVER branch widened to
--     `v_order.order_state IN ('READY_FOR_PICKUP','PICKED_UP')`, so the assigned driver of the
--     linked job is authorized for pickup (READY_FOR_PICKUP -> PICKED_UP) and completion
--     (PICKED_UP -> DELIVERED). Every other branch is byte-identical.
--   * `jobs ((metadata->>'deliveryOrderId'))` UNIQUE partial index: one delivery job per order,
--     enforced by the database rather than by caller discipline.
--   * `create_delivery_job_atomic(p_order_id, p_idempotency_key)` — one transaction that mints
--     the durable job AND writes the order -> job link, is write-once (a retry returns the job
--     the order already names, or adopts an orphaned job that already names the order), and
--     refuses an order that is not a FOOD/GROCERY DELIVERY order in a dispatchable state, or
--     has no recorded delivery address, instead of substituting anything.
--   * `record_delivery_pickup_atomic(p_order_id, p_driver_id)` — assigned-driver check, then the
--     authoritative 018 transition, then the job's own status ladder. The idempotency key is
--     derived from (order, driver), so a re-sent pickup returns a duplicate instead of writing a
--     second `order_transitions` row.
--   * `record_delivery_completion_atomic(p_order_id, p_driver_id, p_otp)` — assigned-driver check
--     and state precheck BEFORE the OTP is touched, then 046's `verify_job_otp_atomic` (which
--     owns expiry, throttle, lockout, single-use and job binding — this migration reimplements
--     none of it), then the transition, then the job ladder. If the transition is refused after
--     the OTP was consumed, the function RAISES so the whole transaction rolls back: no
--     half-applied completion and no burned OTP.
--
-- WHAT IT DELIBERATELY DOES NOT DO.
--
--   * It moves no money. No delivery-fee or driver-earnings rule exists in any migration or in
--     PricingRepository, and `journal_lines_amount CHECK (amount > 0)` forbids posting a
--     zero-amount leg, so the handover job is priced 0 across fare_subtotal / final_total /
--     driver_earnings / platform_commission and none of the three RPCs touches a wallet, ledger
--     or journal row. Pricing the delivery leg is an owner decision, not a default to pick here.
--   * It invents no geography. pickup_address/lat/lng come from `merchants` (both columns are
--     NOT NULL, so the store's own record is durable); drop_address comes from the order's
--     recorded `deliveryAddress`. Drop coordinates stay NULL because the checkout records none
--     (measured: 1,005 of 1,030 FOOD orders carry a deliveryAddress, 0 carry a deliveryLat).
--   * It backfills nothing. The 92 parked orders are left exactly as they are: this migration
--     creates no row and updates no row outside the three RPCs, so a legacy order cannot be
--     silently assigned to an arbitrary driver.
--   * It does not touch `orders.handover_by` / `handover_at`. Nothing in the project writes
--     them today and their intended semantics are undocumented; `order_transitions` already
--     carries the durable DRIVER-authored record of both steps.
--   * It does not re-dispatch. Once an order names a job, that link is write-once, so a
--     CANCELLED delivery job cannot be replaced by a second job for the same order. That is a
--     deliberate limit, not an oversight — see the report.
--
-- SAFETY. All additive: one CREATE OR REPLACE of a helper whose only change is one boolean
-- expression, one CREATE INDEX, three new functions. Grants follow 018's idiom exactly —
-- revoked from PUBLIC/anon/authenticated, executable by service_role only, so these are
-- backend-authoritative operations and never a client-reachable surface. Nothing is dropped,
-- no trigger is changed, no existing row is touched. Re-running is a no-op.
-- =========================================================================


-- =========================================================================
-- 1. THE ASSIGNED DRIVER MUST BE ABLE TO PERFORM THE DRIVER'S OWN TRANSITIONS
-- =========================================================================

CREATE OR REPLACE FUNCTION public._is_authorized_order_actor(
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
            -- 018 returned `v_order.order_state = 'PICKED_UP'` here, which authorizes only the
            -- transition OUT of PICKED_UP. The pickup itself is the driver's transition, so the
            -- state the driver is authorized from is READY_FOR_PICKUP as well.
            RETURN v_order.order_state IN ('READY_FOR_PICKUP','PICKED_UP');
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

REVOKE EXECUTE ON FUNCTION public._is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public._is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) FROM anon;
GRANT EXECUTE ON FUNCTION public._is_authorized_order_actor(UUID, VARCHAR(20), VARCHAR(80)) TO service_role;

-- =========================================================================
-- 2. ONE DELIVERY JOB PER ORDER, ENFORCED BY THE DATABASE
-- =========================================================================

-- Measured before creation: 0 of 2,652 jobs carry a `deliveryOrderId`, so this index cannot
-- refuse to build because of pre-existing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_delivery_order_uniq
    ON public.jobs ((metadata->>'deliveryOrderId'))
    WHERE metadata ? 'deliveryOrderId';

-- =========================================================================
-- 3. CREATE THE DURABLE DELIVERY JOB AND LINK THE ORDER TO IT, ATOMICALLY
-- =========================================================================

CREATE OR REPLACE FUNCTION public.create_delivery_job_atomic(
    p_order_id UUID,
    p_idempotency_key VARCHAR(120) DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order        public.orders%ROWTYPE;
    v_job          public.jobs%ROWTYPE;
    v_merchant     public.merchants%ROWTYPE;
    v_channel      TEXT;
    v_drop_address TEXT;
    v_job_number   VARCHAR(50);
    v_attempt      INT;
    v_otp          TEXT;
BEGIN
    -- 1. Lock the order. Every later decision is taken against the locked row, so two
    --    concurrent requests for one order serialize here instead of both minting a job.
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'error', 'Order not found.');
    END IF;

    -- 2. Write-once link. An order that already names a job gets that job back; a retry never
    --    creates a second active job for the same order.
    IF v_order.job_id IS NOT NULL THEN
        SELECT * INTO v_job FROM public.jobs WHERE id = v_order.job_id;
        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', true, 'duplicate', true, 'code', 'ORDER_ALREADY_LINKED',
                'orderId', v_order.id, 'jobId', v_job.id, 'jobNumber', v_job.job_number,
                'jobStatus', v_job.status, 'orderState', v_order.order_state,
                'deliveryOtp', NULL,
                'note', 'This order already names a job; no second job was created.');
        END IF;
        -- job_id names a row that is gone. `orders.job_id` is ON DELETE SET NULL, so this is a
        -- store that was edited outside the application; relinking below is the recovery.
    END IF;

    -- 3. A delivery job that already names this order is adopted, not duplicated. This is the
    --    crash-recovery half: a job created by a retry that lost the link write is found here
    --    through the unique index rather than orphaned.
    SELECT * INTO v_job FROM public.jobs
     WHERE metadata->>'deliveryOrderId' = v_order.id::text
     ORDER BY created_at LIMIT 1;
    IF FOUND THEN
        UPDATE public.orders SET job_id = v_job.id, updated_at = NOW() WHERE id = v_order.id;
        RETURN jsonb_build_object(
            'success', true, 'duplicate', true, 'code', 'ORPHANED_DELIVERY_JOB_ADOPTED',
            'orderId', v_order.id, 'jobId', v_job.id, 'jobNumber', v_job.job_number,
            'jobStatus', v_job.status, 'orderState', v_order.order_state,
            'deliveryOtp', NULL,
            'note', 'The order was unlinked but a job already named it; the link was rewritten, no new job was created.');
    END IF;

    -- 4. Only a FOOD/GROCERY order on the DELIVERY channel gets a rider. The channel is read
    --    from metadata because `orders.order_channel` is a column default no INSERT writes.
    IF v_order.service_type NOT IN ('FOOD','GROCERY') THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_DELIVERY_SERVICE',
            'error', format('Service type %s has no delivery handover job.', v_order.service_type));
    END IF;

    v_channel := lower(btrim(coalesce(v_order.metadata->>'orderChannel', '')));
    IF v_channel <> 'delivery' THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_DELIVERY_CHANNEL',
            'error', CASE WHEN v_order.metadata->>'orderChannel' IS NULL
                          THEN 'This order records no delivery channel, so nothing was dispatched.'
                          ELSE format('Order channel %s is collected without a rider, so no job was created.',
                                      v_order.metadata->>'orderChannel') END);
    END IF;

    -- 5. Only an order the kitchen has not closed out can be dispatched to a rider.
    IF v_order.order_state NOT IN ('RECEIVED','ACCEPTED','PREPARING','PACKING','READY_FOR_PICKUP') THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_DISPATCHABLE',
            'error', format('An order at %s cannot be dispatched.', v_order.order_state));
    END IF;

    -- 6. Both ends of the route must already be durable records. A store with no address, or an
    --    order with no delivery address, is refused here rather than filled in with a place the
    --    platform guessed at.
    SELECT * INTO v_merchant FROM public.merchants WHERE id = v_order.merchant_id;
    IF NOT FOUND OR btrim(coalesce(v_merchant.address, '')) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'MERCHANT_ADDRESS_MISSING',
            'error', 'The store records no address, so no pickup point could be given to a rider.');
    END IF;

    v_drop_address := btrim(coalesce(v_order.metadata->>'deliveryAddress', ''));
    IF v_drop_address = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'DELIVERY_ADDRESS_MISSING',
            'error', 'This order records no delivery address, so no drop point could be given to a rider.');
    END IF;

    -- 7. Mint a job number in the shape the platform already uses (`JOB-39108053-192`), taking
    --    the first free one so a collision refuses rather than 500s.
    v_job_number := NULL;
    FOR v_attempt IN 1..8 LOOP
        v_job_number := 'JOB-' || lpad((floor(random() * 100000000))::text, 8, '0')
                             || '-' || lpad((100 + floor(random() * 900))::text, 3, '0');
        IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE job_number = v_job_number) THEN
            EXIT;
        END IF;
        v_job_number := NULL;
    END LOOP;
    IF v_job_number IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NUMBER_EXHAUSTED',
            'error', 'No unique job number could be minted for this order.');
    END IF;

    -- 8. The handover leg. Priced 0 because no delivery-fee or earnings rule exists anywhere in
    --    the project; `payment_method`/`payment_status` are written NULL rather than inheriting
    --    the column defaults, because a job that charges nothing has no instrument and no bill.
    --    Status is SEARCHING so 020's `accept_job_assignment_atomic` will accept it.
    --    The drop coordinates are NULL: the checkout records an address and no coordinate.
    v_otp := (1000 + floor(random() * 9000))::int::text;

    INSERT INTO public.jobs (
        job_number, service_type, customer_id, merchant_id, status,
        pickup_address, pickup_lat, pickup_lng,
        drop_address,  drop_lat,  drop_lng,
        distance_km, fare_subtotal, final_total, driver_earnings, platform_commission,
        packaging_fee, tax_amount, discount_amount, surge_multiplier, surge_amount,
        delivery_otp, delivery_otp_expires_at,
        payment_method, payment_status, metadata, created_at, updated_at
    ) VALUES (
        v_job_number, v_order.service_type, v_order.customer_id, v_order.merchant_id, 'SEARCHING',
        v_merchant.address, v_merchant.lat, v_merchant.lng,
        v_drop_address, NULL, NULL,
        0.00, 0.00, 0.00, 0.00, 0.00,
        0.00, 0.00, 0.00, 1.00, 0.00,
        v_otp, NOW() + INTERVAL '24 hours',
        NULL, NULL,
        jsonb_build_object(
            'deliveryOrderId', v_order.id::text,
            'orderNumber', v_order.order_number,
            'orderChannel', 'DELIVERY',
            'serviceType', v_order.service_type,
            'handoverPriced', false,
            'createdBy', 'create_delivery_job_atomic'),
        NOW(), NOW()
    ) RETURNING * INTO v_job;

    -- 9. The link. Same transaction as the job INSERT, so an order can never name a job that
    --    was not written, and a job can never exist unlinked unless the transaction aborted.
    UPDATE public.orders SET job_id = v_job.id, updated_at = NOW() WHERE id = v_order.id;

    RETURN jsonb_build_object(
        'success', true, 'duplicate', false, 'code', 'DELIVERY_JOB_CREATED',
        'orderId', v_order.id, 'orderState', v_order.order_state,
        'jobId', v_job.id, 'jobNumber', v_job.job_number, 'jobStatus', v_job.status,
        'deliveryOtp', v_otp,
        'deliveryOtpExpiresAt', v_job.delivery_otp_expires_at,
        'idempotencyKey', p_idempotency_key);
END;
$$;

-- =========================================================================
-- 4. THE ASSIGNED DRIVER RECORDS THE PICKUP
-- =========================================================================

CREATE OR REPLACE FUNCTION public.record_delivery_pickup_atomic(
    p_order_id UUID,
    p_driver_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order      public.orders%ROWTYPE;
    v_job        public.jobs%ROWTYPE;
    v_transition JSON;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'error', 'Order not found.');
    END IF;

    IF v_order.job_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_LINKED_TO_JOB',
            'error', 'This order names no delivery job, so no driver can take it.');
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = v_order.job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_FOUND',
            'error', 'The delivery job this order names does not exist.');
    END IF;

    -- The caller must be the driver the job was assigned to. This is the same rule the
    -- `/api/driver/verify-otp` route already states as JOB_NOT_ASSIGNED_TO_DRIVER.
    IF v_job.driver_id IS DISTINCT FROM p_driver_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_ASSIGNED_TO_DRIVER',
            'error', 'This job is not assigned to the calling driver.',
            'orderId', v_order.id, 'jobId', v_job.id);
    END IF;

    -- A pickup that has already landed is a duplicate, not a second transition. Checked before
    -- delegating, because 018's idempotency branch answers before it validates the state and
    -- would otherwise report success for an order that has since moved on.
    IF v_order.order_state = 'PICKED_UP' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'code', 'ORDER_ALREADY_PICKED_UP',
            'orderId', v_order.id, 'orderState', v_order.order_state,
            'jobId', v_job.id, 'jobStatus', v_job.status);
    END IF;

    IF v_order.order_state <> 'READY_FOR_PICKUP' THEN
        RETURN jsonb_build_object('success', false,
            'code', CASE WHEN v_order.order_state = 'DELIVERED' THEN 'ORDER_ALREADY_DELIVERED'
                         ELSE 'ORDER_NOT_READY_FOR_PICKUP' END,
            'error', format('An order at %s cannot be picked up.', v_order.order_state),
            'orderId', v_order.id, 'orderState', v_order.order_state);
    END IF;

    -- Authoritative 018 transition, authored as the driver, keyed deterministically to
    -- (order, driver) so a re-sent pickup cannot write a second transition row.
    v_transition := public._transition_order_state_internal(
        v_order.id, 'PICKED_UP', 'DRIVER', p_driver_id::text, NULL,
        'delivery-pickup:' || v_order.id::text || ':' || p_driver_id::text, '{}'::jsonb);

    IF COALESCE((v_transition->>'success')::BOOLEAN, false) THEN
        UPDATE public.jobs SET status = 'IN_TRANSIT', updated_at = NOW()
         WHERE id = v_job.id AND status IN ('ASSIGNED','ACCEPTED','DRIVER_ARRIVED');
        SELECT * INTO v_job FROM public.jobs WHERE id = v_job.id;
        RETURN jsonb_build_object('success', true, 'duplicate', false, 'code', 'ORDER_PICKED_UP',
            'orderId', v_order.id, 'orderState', 'PICKED_UP',
            'jobId', v_job.id, 'jobStatus', v_job.status,
            'transitionId', v_transition->'transitionId');
    END IF;

    RETURN (jsonb_build_object('orderId', v_order.id, 'jobId', v_job.id)
            || v_transition::JSONB);
END;
$$;

-- =========================================================================
-- 5. THE ASSIGNED DRIVER COMPLETES THE HANDOVER WITH THE 046 OTP
-- =========================================================================

CREATE OR REPLACE FUNCTION public.record_delivery_completion_atomic(
    p_order_id UUID,
    p_driver_id UUID,
    p_otp TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order      public.orders%ROWTYPE;
    v_job        public.jobs%ROWTYPE;
    v_otp_result JSONB;
    v_transition JSON;
BEGIN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND', 'error', 'Order not found.');
    END IF;

    IF v_order.job_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_LINKED_TO_JOB',
            'error', 'This order names no delivery job, so no driver can complete it.');
    END IF;

    SELECT * INTO v_job FROM public.jobs WHERE id = v_order.job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_FOUND',
            'error', 'The delivery job this order names does not exist.');
    END IF;

    IF v_job.driver_id IS DISTINCT FROM p_driver_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_ASSIGNED_TO_DRIVER',
            'error', 'This job is not assigned to the calling driver.',
            'orderId', v_order.id, 'jobId', v_job.id);
    END IF;

    -- The state precheck runs BEFORE the OTP is touched, so a replay of a completed delivery
    -- cannot burn the code, cannot write a second transition, and cannot move any money.
    IF v_order.order_state = 'DELIVERED' THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'code', 'ORDER_ALREADY_DELIVERED',
            'orderId', v_order.id, 'orderState', v_order.order_state,
            'jobId', v_job.id, 'jobStatus', v_job.status, 'otpConsumed', false);
    END IF;

    IF v_order.order_state <> 'PICKED_UP' THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_PICKED_UP',
            'error', format('An order at %s has not been handed to the rider yet.', v_order.order_state),
            'orderId', v_order.id, 'orderState', v_order.order_state, 'otpConsumed', false);
    END IF;

    -- 046 owns expiry, attempts, lockout, single-use and job binding. Its verdict code is passed
    -- through unchanged so the route can answer 410/429/409/400 exactly as `/api/driver/verify-otp`
    -- already does.
    v_otp_result := public.verify_job_otp_atomic(v_job.id, p_otp, 'DELIVERY');
    IF NOT COALESCE((v_otp_result->>'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object('success', false,
            'code', v_otp_result->>'code',
            'error', coalesce(v_otp_result->>'error', 'Handover verification failed.'),
            'orderId', v_order.id, 'jobId', v_job.id, 'otpConsumed', false);
    END IF;

    v_transition := public._transition_order_state_internal(
        v_order.id, 'DELIVERED', 'DRIVER', p_driver_id::text, NULL,
        'delivery-complete:' || v_order.id::text || ':' || p_driver_id::text, '{}'::jsonb);

    -- The OTP has been consumed at this point. If the order did not move, that consumption would
    -- be a claim with nothing behind it, so abort the transaction instead of returning: the code,
    -- the transition row and the state all roll back together.
    IF NOT COALESCE((v_transition->>'success')::BOOLEAN, false) THEN
        RAISE EXCEPTION 'delivery completion transition refused: %', coalesce(v_transition->>'code', 'UNKNOWN')
            USING ERRCODE = 'raise_exception';
    END IF;

    UPDATE public.jobs SET status = 'COMPLETED', updated_at = NOW()
     WHERE id = v_job.id AND status IN ('IN_TRANSIT','OUT_FOR_DELIVERY');
    SELECT * INTO v_job FROM public.jobs WHERE id = v_job.id;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'code', 'ORDER_DELIVERED',
        'orderId', v_order.id, 'orderState', 'DELIVERED',
        'jobId', v_job.id, 'jobStatus', v_job.status,
        'transitionId', v_transition->'transitionId',
        'otpCode', v_otp_result->>'code', 'moneyMovement', false);
END;
$$;

-- =========================================================================
-- 6. GRANTS — service_role only, in 018's idiom
-- =========================================================================

REVOKE EXECUTE ON FUNCTION public.create_delivery_job_atomic(UUID, VARCHAR(120)) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_delivery_job_atomic(UUID, VARCHAR(120)) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_delivery_job_atomic(UUID, VARCHAR(120)) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.create_delivery_job_atomic(UUID, VARCHAR(120)) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_delivery_pickup_atomic(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_delivery_pickup_atomic(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_delivery_pickup_atomic(UUID, UUID) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.record_delivery_pickup_atomic(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_delivery_completion_atomic(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_delivery_completion_atomic(UUID, UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_delivery_completion_atomic(UUID, UUID, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.record_delivery_completion_atomic(UUID, UUID, TEXT) TO service_role;
