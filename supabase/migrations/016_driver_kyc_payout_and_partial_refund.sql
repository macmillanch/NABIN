-- =========================================================================
-- NABIN PLATFORM — MIGRATION 016
-- Domain: Driver KYC, Authoritative Payout Destination, Partial Refunds &
--         Atomic Ride Cancellation Engine
-- Baseline: Migrations 001–015 Unchanged
-- =========================================================================

-- 1. DRIVER → USER LINKAGE & PERSISTENT KYC / PAYOUT DESTINATION COLUMNS
ALTER TABLE drivers 
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(30) DEFAULT 'PENDING' 
        CHECK (kyc_status IN ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED')),
    ADD COLUMN IF NOT EXISTS verified_upi_id VARCHAR(100) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS pending_upi_id VARCHAR(100) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS upi_cooling_until TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS payout_upi_verified BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS payout_upi_verified_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS vpa_verification_method VARCHAR(30) DEFAULT NULL 
        CHECK (vpa_verification_method IN ('ADMIN_MANUAL', 'BANK_PENNY_DROP', 'EXTERNAL_API')),
    ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS kyc_rejected_reason TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON drivers(user_id);
CREATE INDEX IF NOT EXISTS idx_drivers_kyc_status ON drivers(kyc_status);
CREATE INDEX IF NOT EXISTS idx_drivers_verified_upi ON drivers(verified_upi_id) WHERE verified_upi_id IS NOT NULL;

-- 2. SAFE CONSERVATIVE BACKFILL: LINK EXISTING DRIVERS ONLY WHERE MATCH EXISTS
-- Match based on normalized phone digits (digits only). Do NOT synthesize users.
UPDATE drivers d
SET user_id = u.id
FROM users u
WHERE regexp_replace(d.phone, '\D', '', 'g') = regexp_replace(u.phone, '\D', '', 'g')
  AND d.user_id IS NULL;

-- 3. CONSERVATIVE KYC STATUS BACKFILL: ONLY FROM AUTHORITATIVE IDENTITY DOCUMENTS
-- Default all drivers to 'PENDING'.
-- Only promote to 'VERIFIED' if a linked user has an authoritative, approved identity document.
UPDATE drivers d
SET kyc_status = 'VERIFIED',
    kyc_verified_at = doc.verified_at
FROM identity_documents doc
WHERE d.user_id IS NOT NULL 
  AND d.user_id = doc.user_id 
  AND doc.review_status = 'VERIFIED'
  AND d.kyc_status = 'PENDING';

-- NOTE: verified_upi_id REMAINS NULL AND payout_upi_verified REMAINS FALSE FOR ALL DRIVERS.
-- Zero financial destinations are fabricated in this migration.

-- 4. PAYMENTS TABLE: PARTIAL REFUND SUPPORT & CUMULATIVE BALANCE TRACKING
ALTER TABLE payments 
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) DEFAULT 0.00 CHECK (refunded_amount >= 0);

-- Update status check constraint safely
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
    CHECK (status IN ('INITIATED', 'PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'));

-- 5. JOBS TABLE: CANCELLATION FINANCIAL METADATA COLUMNS
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS driver_compensation NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) DEFAULT 'NONE'
        CHECK (refund_status IN ('NONE', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FEE_OFFSET', 'NOT_APPLICABLE')),
    ADD COLUMN IF NOT EXISTS cancelled_by_role VARCHAR(20) DEFAULT NULL;

-- =========================================================================
-- 6. RPC: UPGRADED refund_payment_atomic (STAGE B — PARTIAL & FULL REFUNDS)
-- =========================================================================
CREATE OR REPLACE FUNCTION refund_payment_atomic(
    p_order_or_payment TEXT,
    p_refund_event_id  TEXT,
    p_reason           TEXT DEFAULT NULL,
    p_authorized_by    TEXT DEFAULT 'SUPPORT_AGENT',
    p_provider         TEXT DEFAULT 'RAZORPAY_SANDBOX',
    p_declared_amount  NUMERIC DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_pay             payments%ROWTYPE;
    v_event_id        TEXT;
    v_ledger_id       TEXT;
    v_refund_amount   NUMERIC(12, 2);
    v_new_refunded    NUMERIC(12, 2);
    v_new_status      VARCHAR(30);
    v_refundable_left NUMERIC(12, 2);
BEGIN
    -- 1. Acquire exclusive row lock on canonical payment record
    SELECT * INTO v_pay FROM payments
     WHERE payment_id = p_order_or_payment OR gateway_order_id = p_order_or_payment
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'PAYMENT_NOT_FOUND');
    END IF;

    -- 2. Enforce Terminal State Protection
    IF v_pay.status = 'REFUNDED' THEN
        RETURN json_build_object('success', true, 'duplicate', true,
                                 'paymentId', v_pay.payment_id,
                                 'status', 'REFUNDED',
                                 'message', 'Payment is already fully refunded.');
    END IF;
    IF v_pay.status NOT IN ('CAPTURED', 'PARTIALLY_REFUNDED') THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_STATE',
                                 'status', v_pay.status);
    END IF;

    -- 3. Calculate and Validate Refund Amount
    v_refundable_left := v_pay.amount - COALESCE(v_pay.refunded_amount, 0.00);
    IF p_declared_amount IS NOT NULL THEN
        v_refund_amount := ROUND(p_declared_amount::NUMERIC, 2);
    ELSE
        v_refund_amount := v_refundable_left;
    END IF;

    IF v_refund_amount <= 0.00 THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_REFUND_AMOUNT',
                                 'amount', v_refund_amount);
    END IF;

    IF v_refund_amount > v_refundable_left THEN
        RETURN json_build_object('success', false, 'code', 'EXCEEDS_REFUNDABLE_BALANCE',
                                 'requested', v_refund_amount,
                                 'remaining', v_refundable_left);
    END IF;

    v_new_refunded := COALESCE(v_pay.refunded_amount, 0.00) + v_refund_amount;
    IF v_new_refunded >= v_pay.amount THEN
        v_new_status := 'REFUNDED';
    ELSE
        v_new_status := 'PARTIALLY_REFUNDED';
    END IF;

    -- 4. Durable Idempotency Claim via payment_webhooks.event_id UNIQUE constraint
    v_event_id := COALESCE(p_refund_event_id, 'evt_ref_' || v_pay.payment_id || '_' || extract(epoch from now())::bigint);
    BEGIN
        INSERT INTO payment_webhooks(event_id, event_type, provider, payment_id, amount,
                                     status, payload, is_processed, processed_at, signature_valid)
        VALUES (v_event_id, 'refund.processed', p_provider, v_pay.payment_id,
                v_refund_amount, 'PROCESSED',
                jsonb_build_object('order_id', v_pay.gateway_order_id,
                                   'reason', p_reason, 'authorized_by', p_authorized_by,
                                   'previous_status', v_pay.status, 'new_status', v_new_status),
                true, now(), true);
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', true, 'duplicate', true,
                                 'paymentId', v_pay.payment_id,
                                 'eventId', v_event_id);
    END;

    -- 5. Single Authoritative Ledger Reversal Row (Immutable Double-Entry)
    v_ledger_id := 'LEDGR-' || substr(md5(v_event_id), 1, 31);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id, 'DISPUTE_REFUND',
            'CUSTOMER_WALLET_LIABILITY',
            'PAYMENT_GATEWAY_ESCROW',
            v_refund_amount, COALESCE(v_pay.currency, 'INR'),
            v_pay.job_id, 'Atomic refund [' || COALESCE(p_reason, 'unspecified') || ']',
            COALESCE(v_pay.gateway_order_id, v_pay.payment_id));

    -- 6. Mutate Payment Record
    UPDATE payments 
       SET status = v_new_status,
           refunded_amount = v_new_refunded,
           refunded_at = now(),
           updated_at = now()
     WHERE id = v_pay.id;

    RETURN json_build_object(
        'success', true,
        'duplicate', false,
        'paymentId', v_pay.payment_id,
        'refundAmount', v_refund_amount,
        'totalRefunded', v_new_refunded,
        'status', v_new_status,
        'eventId', v_event_id
    );
END;
$$;

-- =========================================================================
-- 7. RPC: ATOMIC RIDE CANCELLATION ENGINE (cancel_ride_atomic)
-- =========================================================================
CREATE OR REPLACE FUNCTION cancel_ride_atomic(
    p_job_id              UUID,
    p_requester_id        UUID,
    p_requester_role      VARCHAR(20),
    p_reason              TEXT,
    p_is_delayed_override BOOLEAN DEFAULT FALSE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_job                 jobs%ROWTYPE;
    v_pay                 payments%ROWTYPE;
    v_elapsed_minutes     NUMERIC;
    v_assigned_time       TIMESTAMPTZ;
    v_fee_applies         BOOLEAN := FALSE;
    v_fee_amount          NUMERIC(10, 2) := 0.00;
    v_driver_comp         NUMERIC(10, 2) := 0.00;
    v_refund_amount       NUMERIC(10, 2) := 0.00;
    v_is_paid             BOOLEAN := FALSE;
    v_refund_status       VARCHAR(30) := 'NONE';
    v_cust_bal_after      NUMERIC(10, 2);
    v_drv_bal_after       NUMERIC(10, 2);
    v_ref_res             JSON;
BEGIN
    -- 1. Acquire exclusive lock on the job row (Serializes concurrent cancellations)
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'JOB_NOT_FOUND');
    END IF;

    -- 2. Terminal checks
    IF v_job.status = 'CANCELLED' THEN
        RETURN json_build_object('success', true, 'duplicate', true, 'message', 'Trip already cancelled.');
    END IF;
    IF v_job.status = 'COMPLETED' THEN
        RETURN json_build_object('success', false, 'code', 'JOB_ALREADY_COMPLETED');
    END IF;

    -- 3. Authorization check
    IF p_requester_role = 'CUSTOMER' AND v_job.customer_id <> p_requester_id THEN
        RETURN json_build_object('success', false, 'code', 'FORBIDDEN_NOT_OWNER');
    END IF;

    -- 4. Check payment state
    SELECT * INTO v_pay FROM payments WHERE job_id = p_job_id ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    v_is_paid := (FOUND AND v_pay.status IN ('CAPTURED', 'PARTIALLY_REFUNDED'));

    -- 5. Evaluate Cancellation Fee & Compensation
    IF v_job.driver_id IS NOT NULL THEN
        v_assigned_time := COALESCE(
            CASE WHEN (v_job.metadata ? 'assignedAt') THEN (v_job.metadata->>'assignedAt')::timestamptz ELSE NULL END,
            v_job.created_at
        );
        v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_assigned_time)) / 60.0;
        IF p_is_delayed_override OR v_elapsed_minutes > 2.0 THEN
            v_fee_applies := TRUE;
            v_fee_amount := 50.00;
            v_driver_comp := 40.00;
        END IF;
    END IF;

    -- 6. Customer Wallet Refund (Internal Transactional Mutation)
    IF v_is_paid THEN
        v_refund_amount := GREATEST(0.00, (v_pay.amount - COALESCE(v_pay.refunded_amount, 0.00)) - v_fee_amount);
        IF v_refund_amount > 0.00 THEN
            -- Credit customer wallet
            UPDATE users 
               SET wallet_balance = wallet_balance + v_refund_amount, updated_at = now()
             WHERE id = v_job.customer_id
             RETURNING wallet_balance INTO v_cust_bal_after;

            -- Flip payment status via internal partial refund RPC
            v_ref_res := refund_payment_atomic(
                v_pay.payment_id,
                'evt_cancel_ref_' || v_job.id,
                'Automated refund for cancelled trip: ' || COALESCE(p_reason, 'Customer cancelled'),
                p_requester_role,
                'RAZORPAY_SANDBOX',
                v_refund_amount
            );
            v_refund_status := (v_ref_res->>'status');
        ELSE
            v_refund_status := 'FEE_OFFSET';
        END IF;
    ELSE
        v_refund_status := 'NOT_APPLICABLE';
    END IF;

    -- 7. Driver Compensation (Internal Transactional Mutation)
    IF v_driver_comp > 0.00 AND v_job.driver_id IS NOT NULL THEN
        UPDATE drivers 
           SET wallet_balance = wallet_balance + v_driver_comp,
               operational_status = 'AVAILABLE',
               is_online = true
         WHERE id = v_job.driver_id
         RETURNING wallet_balance INTO v_drv_bal_after;

        -- Record authoritative double-entry ledger entry for driver compensation
        INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                                   currency, job_id, description, reference_id)
        VALUES ('LEDGR-CMP-' || substr(md5(v_job.id::text || now()::text), 1, 22),
                'RIDE_SETTLEMENT', 'PLATFORM_REVENUE', 'DRIVER_EARNINGS_PAYABLE',
                v_driver_comp, 'INR', v_job.id, 'Cancellation compensation for trip ' || v_job.id, v_job.id::text);
    ELSIF v_job.driver_id IS NOT NULL THEN
        UPDATE drivers SET operational_status = 'AVAILABLE', is_online = true WHERE id = v_job.driver_id;
    END IF;

    -- 8. Promotion Count Restoration
    IF v_job.metadata ? 'promo_code' THEN
        UPDATE promotions 
           SET usage_count = GREATEST(0, usage_count - 1), updated_at = now()
         WHERE code = (v_job.metadata->>'promo_code');
    END IF;

    -- 9. Mutate Job State
    UPDATE jobs
       SET status = 'CANCELLED',
           cancellation_fee = v_fee_amount,
           driver_compensation = v_driver_comp,
           refund_amount = v_refund_amount,
           refund_status = v_refund_status,
           cancelled_by_role = p_requester_role,
           metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{cancellation}', jsonb_build_object(
               'reason', p_reason,
               'fee', v_fee_amount,
               'driverComp', v_driver_comp,
               'refundAmount', v_refund_amount,
               'cancelledAt', now()
           )),
           updated_at = now()
     WHERE id = v_job.id;

    -- 10. Record Immutable Audit Event
    INSERT INTO audit_logs(admin_id, admin_name, role, action, module,
                           target_entity_type, target_entity_id, reason, metadata)
    VALUES (p_requester_id::text, 'Cancellation Engine', p_requester_role,
            'RIDE_CANCELLED', 'DISPATCH', 'JOB', v_job.id::text,
            p_reason, jsonb_build_object('fee', v_fee_amount, 'refund', v_refund_amount, 'driverComp', v_driver_comp));

    RETURN json_build_object(
        'success', true,
        'jobId', v_job.id,
        'status', 'CANCELLED',
        'cancellationFee', v_fee_amount,
        'driverCompensation', v_driver_comp,
        'refundAmount', v_refund_amount,
        'refundStatus', v_refund_status,
        'customerWalletBalance', v_cust_bal_after,
        'driverWalletBalance', v_drv_bal_after
    );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION refund_payment_atomic(text, text, text, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refund_payment_atomic(text, text, text, text, text, numeric) TO authenticated, service_role, anon;

REVOKE ALL ON FUNCTION cancel_ride_atomic(uuid, uuid, varchar, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_ride_atomic(uuid, uuid, varchar, text, boolean) TO authenticated, service_role, anon;
