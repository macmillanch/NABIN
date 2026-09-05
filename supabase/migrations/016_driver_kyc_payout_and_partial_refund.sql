-- =========================================================================
-- NABIN PLATFORM — MIGRATION 016
-- Domain: Driver KYC, Authoritative Payouts, Business Refund Idempotency,
--         Atomic Ride Cancellation & Double-Entry Ledger Rebalancing
-- Baseline: Migrations 001–015 Unchanged
-- =========================================================================

-- 1. DRIVERS TABLE EXTENSIONS
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

-- 2. SAFE CONSERVATIVE USER LINKAGE (NO SYNTHETIC USERS)
-- Link only where normalized 10-digit phone strictly matches an existing user.
UPDATE drivers d
SET user_id = u.id
FROM users u
WHERE regexp_replace(d.phone, '\D', '', 'g') = regexp_replace(u.phone, '\D', '', 'g')
  AND d.user_id IS NULL;

-- 3. PAYMENTS TABLE EXTENSIONS
ALTER TABLE payments 
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) DEFAULT 0.00 CHECK (refunded_amount >= 0);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check 
    CHECK (status IN ('INITIATED', 'PENDING', 'CAPTURED', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED'));

-- 4. JOBS TABLE EXTENSIONS
ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS driver_compensation NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) DEFAULT 'NONE'
        CHECK (refund_status IN ('NONE', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FEE_OFFSET', 'NOT_APPLICABLE')),
    ADD COLUMN IF NOT EXISTS cancelled_by_role VARCHAR(20) DEFAULT NULL;

-- 5. PAYMENT REFUND AUTHORIZATIONS TABLE
CREATE TABLE IF NOT EXISTS payment_refund_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(100) UNIQUE NOT NULL,
    payment_id VARCHAR(80) NOT NULL REFERENCES payments(payment_id),
    gateway_order_id VARCHAR(100),
    ticket_id VARCHAR(80),
    job_id UUID REFERENCES jobs(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    reason TEXT,
    authorized_by VARCHAR(80) NOT NULL,
    provider VARCHAR(40) NOT NULL DEFAULT 'RAZORPAY_SANDBOX',
    payload_hash VARCHAR(64) NOT NULL,
    ledger_entry_id VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_payment_id ON payment_refund_authorizations(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_refunds_idempotency_key ON payment_refund_authorizations(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_ticket_refund 
    ON payment_refund_authorizations(payment_id, ticket_id) 
    WHERE ticket_id IS NOT NULL;

ALTER TABLE payment_refund_authorizations ENABLE ROW LEVEL SECURITY;

-- 6. CANONICAL 7-ARGUMENT REFUND RPC
CREATE OR REPLACE FUNCTION refund_payment_atomic(
    p_order_or_payment TEXT,
    p_refund_event_id  TEXT,
    p_reason           TEXT,
    p_authorized_by    TEXT,
    p_provider         TEXT,
    p_declared_amount  NUMERIC,
    p_ticket_id        TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_pay             payments%ROWTYPE;
    v_auth            payment_refund_authorizations%ROWTYPE;
    v_event_id        TEXT;
    v_ledger_id       TEXT;
    v_refund_amount   NUMERIC(12, 2);
    v_new_refunded    NUMERIC(12, 2);
    v_new_status      VARCHAR(30);
    v_refundable_left NUMERIC(12, 2);
    v_payload_hash    VARCHAR(64);
BEGIN
    -- 1. Lock payment row exclusively
    SELECT * INTO v_pay FROM payments
     WHERE payment_id = p_order_or_payment OR gateway_order_id = p_order_or_payment
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'PAYMENT_NOT_FOUND');
    END IF;

    -- 2. Idempotency Key Resolution
    v_event_id := COALESCE(p_refund_event_id, 'ref_auto_' || v_pay.payment_id || '_' || extract(epoch from now())::bigint);

    -- 3. Calculate Requested Refund Amount
    v_refundable_left := v_pay.amount - COALESCE(v_pay.refunded_amount, 0.00);
    IF p_declared_amount IS NOT NULL THEN
        v_refund_amount := ROUND(p_declared_amount::NUMERIC, 2);
    ELSE
        v_refund_amount := v_refundable_left;
    END IF;

    -- 4. Compute Payload Hash
    v_payload_hash := encode(extensions.digest(
        v_pay.payment_id || '|' || 
        v_refund_amount::text || '|' || 
        COALESCE(p_ticket_id, 'NONE') || '|' || 
        COALESCE(p_reason, 'NONE'), 
        'sha256'
    ), 'hex');

    -- 5. Business Idempotency Check (Case A & D1)
    SELECT * INTO v_auth FROM payment_refund_authorizations 
     WHERE idempotency_key = v_event_id FOR UPDATE;
    IF FOUND THEN
        IF v_auth.payment_id = v_pay.payment_id AND 
           v_auth.amount = v_refund_amount AND 
           v_auth.payload_hash = v_payload_hash THEN
            RETURN json_build_object(
                'success', true, 
                'duplicate', true,
                'paymentId', v_pay.payment_id,
                'refundAmount', v_auth.amount,
                'eventId', v_auth.idempotency_key,
                'message', 'Idempotent replay of previously authorized refund.'
            );
        ELSE
            RETURN json_build_object(
                'success', false, 
                'code', 'IDEMPOTENCY_CONFLICT',
                'error', 'Idempotency key has already been used with different parameters.'
            );
        END IF;
    END IF;

    -- 6. Ticket-Level Exclusivity Check (Case D2)
    IF p_ticket_id IS NOT NULL THEN
        PERFORM 1 FROM payment_refund_authorizations
         WHERE payment_id = v_pay.payment_id AND ticket_id = p_ticket_id;
        IF FOUND THEN
            RETURN json_build_object(
                'success', false, 
                'code', 'TICKET_ALREADY_REFUNDED',
                'error', 'This support ticket has already been used for a refund on this payment.'
            );
        END IF;
    END IF;

    -- 7. Cumulative Balance Validation (Case C)
    IF v_pay.status = 'REFUNDED' OR v_refundable_left <= 0.00 THEN
        RETURN json_build_object('success', false, 'code', 'ALREADY_FULLY_REFUNDED');
    END IF;
    IF v_pay.status NOT IN ('CAPTURED', 'PARTIALLY_REFUNDED') THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_PAYMENT_STATE', 'status', v_pay.status);
    END IF;
    IF v_refund_amount <= 0.00 THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_REFUND_AMOUNT', 'amount', v_refund_amount);
    END IF;
    IF v_refund_amount > v_refundable_left THEN
        RETURN json_build_object(
            'success', false, 
            'code', 'EXCEEDS_REFUNDABLE_BALANCE',
            'requested', v_refund_amount,
            'remaining', v_refundable_left
        );
    END IF;

    -- 8. Compute New Payment Status
    v_new_refunded := COALESCE(v_pay.refunded_amount, 0.00) + v_refund_amount;
    IF v_new_refunded >= v_pay.amount THEN
        v_new_status := 'REFUNDED';
    ELSE
        v_new_status := 'PARTIALLY_REFUNDED';
    END IF;

    -- 9. Record Double-Entry Reversal (Model A: source refund)
    v_ledger_id := 'LEDGR-' || substr(md5(v_event_id), 1, 31);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id, 'DISPUTE_REFUND',
            'CUSTOMER_WALLET_LIABILITY',
            'PAYMENT_GATEWAY_ESCROW',
            v_refund_amount, COALESCE(v_pay.currency, 'INR'),
            v_pay.job_id, 'Source Refund [' || COALESCE(p_reason, 'Unspecified') || ']',
            COALESCE(v_pay.gateway_order_id, v_pay.payment_id));

    -- 10. Persist Authoritative Authorization Record
    INSERT INTO payment_refund_authorizations(
        idempotency_key, payment_id, gateway_order_id, ticket_id, job_id,
        amount, currency, reason, authorized_by, provider,
        payload_hash, ledger_entry_id
    ) VALUES (
        v_event_id, v_pay.payment_id, v_pay.gateway_order_id, p_ticket_id, v_pay.job_id,
        v_refund_amount, COALESCE(v_pay.currency, 'INR'), p_reason, p_authorized_by, p_provider,
        v_payload_hash, v_ledger_id
    );

    -- 11. Mutate Payment Row
    UPDATE payments 
       SET status = v_new_status,
           refunded_amount = v_new_refunded,
           refunded_at = now(),
           updated_at = now()
     WHERE id = v_pay.id;

    IF v_pay.job_id IS NOT NULL AND v_new_status = 'REFUNDED' THEN
        UPDATE jobs SET payment_status = 'REFUNDED' WHERE id = v_pay.job_id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'duplicate', false,
        'paymentId', v_pay.payment_id,
        'refundAmount', v_refund_amount,
        'totalRefunded', v_new_refunded,
        'status', v_new_status,
        'eventId', v_event_id,
        'ledgerEntryId', v_ledger_id
    );
END;
$$;

-- 7. BACKWARD-COMPATIBLE 6-ARGUMENT OVERLOAD WRAPPER
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
BEGIN
    RETURN refund_payment_atomic(
        p_order_or_payment, p_refund_event_id, p_reason, p_authorized_by, p_provider, p_declared_amount, NULL
    );
END;
$$;

-- 8. ATOMIC RIDE CANCELLATION ENGINE
CREATE OR REPLACE FUNCTION cancel_ride_atomic(
    p_job_id              UUID,
    p_requester_id        UUID,
    p_requester_role      VARCHAR(20),
    p_reason              TEXT,
    p_is_delayed_override BOOLEAN DEFAULT FALSE
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_job                 jobs%ROWTYPE;
    v_pay                 payments%ROWTYPE;
    v_elapsed_minutes     NUMERIC;
    v_assigned_time       TIMESTAMPTZ;
    v_fee_amount          NUMERIC(10, 2) := 0.00;
    v_driver_comp         NUMERIC(10, 2) := 0.00;
    v_platform_fee        NUMERIC(10, 2) := 0.00;
    v_refund_amount       NUMERIC(10, 2) := 0.00;
    v_is_paid             BOOLEAN := FALSE;
    v_refund_status       VARCHAR(30) := 'NONE';
    v_ref_res             JSON;
    v_drv_wallet_res      JSON;
    v_drv_bal_after       NUMERIC(10, 2);
BEGIN
    -- 1. Lock job row exclusively
    SELECT * INTO v_job FROM jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'JOB_NOT_FOUND';
    END IF;

    -- 2. Validate terminal status
    IF v_job.status = 'CANCELLED' THEN
        RETURN json_build_object('success', true, 'duplicate', true, 'message', 'Trip already cancelled.');
    END IF;
    IF v_job.status = 'COMPLETED' THEN
        RAISE EXCEPTION 'JOB_ALREADY_COMPLETED';
    END IF;

    -- 3. Requester authorization
    IF p_requester_role = 'CUSTOMER' AND v_job.customer_id <> p_requester_id THEN
        RAISE EXCEPTION 'FORBIDDEN_NOT_OWNER';
    END IF;

    -- 4. Lock payment row exclusively
    SELECT * INTO v_pay FROM payments 
     WHERE job_id = p_job_id 
     ORDER BY created_at DESC LIMIT 1 
     FOR UPDATE;
    v_is_paid := (FOUND AND v_pay.status = 'CAPTURED');

    -- 5. Evaluate Cancellation Business Rules
    IF v_job.driver_id IS NOT NULL THEN
        v_assigned_time := COALESCE(v_job.assigned_at, v_job.created_at);
        v_elapsed_minutes := EXTRACT(EPOCH FROM (now() - v_assigned_time)) / 60.0;
        IF p_is_delayed_override OR v_elapsed_minutes > 2.0 THEN
            v_fee_amount := 50.00;
            v_driver_comp := 40.00;
            v_platform_fee := 10.00;
        END IF;
    END IF;

    -- 6. Financial Mutation: Execute Source Refund First (Model A)
    IF v_is_paid THEN
        v_refund_amount := GREATEST(0.00, v_pay.amount - v_fee_amount);
        
        v_ref_res := refund_payment_atomic(
            v_pay.payment_id,
            'cancel_pay_ref_' || v_job.id,
            'Cancellation source refund for job ' || v_job.id,
            p_requester_role,
            'RAZORPAY_SANDBOX',
            v_refund_amount,
            'TICKET-CNC-' || v_job.id
        );
        IF (v_ref_res->>'success')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'REFUND_OPERATION_FAILED: %', (v_ref_res->>'code');
        END IF;
        v_refund_status := (v_ref_res->>'status');
    ELSE
        v_refund_status := 'NOT_APPLICABLE';
    END IF;

    -- 7. Financial Mutation: Driver Compensation (Model A Double-Entry)
    IF v_driver_comp > 0.00 AND v_job.driver_id IS NOT NULL THEN
        v_drv_wallet_res := adjust_wallet_atomic(
            v_job.driver_id,
            'DRIVER',
            v_driver_comp,
            'RIDE_SETTLEMENT',
            'Driver cancellation compensation for job ' || v_job.id,
            v_job.id::text,
            'CUSTOMER_WALLET_LIABILITY',      -- Extinguishes remaining trip liability
            'DRIVER_EARNINGS_PAYABLE',        -- Accrues payable to driver
            'idemp_cancel_drv_comp_' || v_job.id
        );
        IF (v_drv_wallet_res->>'success')::boolean IS NOT TRUE THEN
            RAISE EXCEPTION 'DRIVER_COMPENSATION_ADJUSTMENT_FAILED: %', (v_drv_wallet_res->>'error');
        END IF;
        v_drv_bal_after := (v_drv_wallet_res->>'balance')::numeric;
    END IF;

    -- 8. Financial Mutation: Retained Platform Fee (Model A Double-Entry)
    IF v_platform_fee > 0.00 THEN
        INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                                   currency, job_id, description, reference_id)
        VALUES ('LEDGR-FEE-' || substr(md5(v_job.id::text || now()::text), 1, 22),
                'RIDE_SETTLEMENT',
                'CUSTOMER_WALLET_LIABILITY',      -- Extinguishes final trip liability
                'PLATFORM_COMMISSION_REVENUE',    -- Earned platform commission
                v_platform_fee, 'INR', v_job.id,
                'Platform cancellation fee retained for job ' || v_job.id, v_job.id::text);
    END IF;

    -- 9. Mutate Driver Operational State
    IF v_job.driver_id IS NOT NULL THEN
        UPDATE drivers 
           SET operational_status = 'AVAILABLE',
               is_online = true
         WHERE id = v_job.driver_id;
    END IF;

    -- 10. Restore Promo Usage
    IF v_job.metadata ? 'promo_code' THEN
        UPDATE promotions 
           SET usage_count = GREATEST(0, usage_count - 1), updated_at = now()
         WHERE code = (v_job.metadata->>'promo_code');
    END IF;

    -- 11. Mutate Job State
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
               'platformFee', v_platform_fee,
               'refundAmount', v_refund_amount,
               'cancelledAt', now()
           )),
           updated_at = now()
     WHERE id = v_job.id;

    -- 12. Record Authoritative Audit Event
    INSERT INTO audit_logs(admin_id, admin_name, role, action, module,
                           target_entity_type, target_entity_id, reason, metadata)
    VALUES (p_requester_id::text, 'Cancellation Engine', p_requester_role,
            'RIDE_CANCELLED', 'DISPATCH', 'JOB', v_job.id::text,
            p_reason, jsonb_build_object(
                'fee', v_fee_amount, 
                'driverComp', v_driver_comp, 
                'platformFee', v_platform_fee,
                'refund', v_refund_amount
            ));

    RETURN json_build_object(
        'success', true,
        'jobId', v_job.id,
        'status', 'CANCELLED',
        'cancellationFee', v_fee_amount,
        'driverCompensation', v_driver_comp,
        'platformFee', v_platform_fee,
        'refundAmount', v_refund_amount,
        'refundStatus', v_refund_status,
        'driverWalletBalance', v_drv_bal_after
    );
END;
$$;
