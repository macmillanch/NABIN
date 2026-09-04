-- =========================================================================
-- NABIN PLATFORM — DOMAIN 6 PAYMENTS DOMAIN MIGRATION
-- Migration: 006_payments_domain.sql
-- Adds ONLY schema verified missing from the live TEST Supabase instance
-- (empirically probed: PGRST205 for payment_sessions; payment_webhooks lacks
--  payment_id/signature_valid/created_at; payments lacks gateway_order_id).
-- Target: TEST database ONLY. NEVER apply to production without review.
-- Idempotent: safe to run repeatedly (IF NOT EXISTS / DO-guarded blocks).
-- =========================================================================

-- 1. CHECKOUT SESSIONS / ORDERS (the authoritative amount + intent store)
CREATE TABLE IF NOT EXISTS payment_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(80) UNIQUE NOT NULL,
    customer_id UUID REFERENCES users(id),
    job_id UUID REFERENCES jobs(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(10) DEFAULT 'INR',
    service_type VARCHAR(30) CHECK (service_type IN ('RIDE', 'FOOD', 'PARCEL', 'GROCERY')),
    status VARCHAR(30) DEFAULT 'INITIATED'
        CHECK (status IN ('INITIATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED')),
    provider VARCHAR(40) DEFAULT 'RAZORPAY_SANDBOX',
    key_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Align payment_webhooks with runtime fields (do NOT duplicate existing cols)
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100);
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS signature_valid BOOLEAN;
ALTER TABLE payment_webhooks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- 2.5 Align jobs table to accept payment links
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS payment_id VARCHAR(100);

-- 3. Payments: gateway order linkage + refund tracking
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway_order_id VARCHAR(80);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_payment_sessions_job      ON payment_sessions(job_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_customer ON payment_sessions(customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_status   ON payment_sessions(status);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_order    ON payments(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_payment  ON payment_webhooks(payment_id);

-- 5. RLS parity: customers may read only their own sessions
ALTER TABLE payment_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers view only own payment sessions"
    ON payment_sessions FOR SELECT
    USING (auth.uid() = customer_id);

-- =========================================================================
-- 6a. ATOMIC CAPTURE RPC — the ONLY sanctioned successful-capture path.
--     payment + webhook(idempotency) + ledger + job-PAID commit or roll
--     back as ONE PostgreSQL transaction. No app-level "rollback".
--
-- Idempotency: concurrent/duplicate callers race on one row lock plus the
-- status-gated UPDATE below; exactly ONE flips INITIATED->SUCCESS.
-- Amount security: p_declared_amount (gateway claim) is NEVER trusted; it
-- must equal the persisted session amount, otherwise capture is rejected
-- and the rejection is durably recorded in payment_webhooks.
-- =========================================================================
CREATE OR REPLACE FUNCTION capture_payment_atomic(
    p_order_id          TEXT,
    p_payment_id        TEXT,
    p_customer          UUID,
    p_service           TEXT DEFAULT NULL,
    p_method            TEXT DEFAULT 'WALLET',
    p_signature_valid   BOOLEAN DEFAULT TRUE,
    p_provider          TEXT DEFAULT 'RAZORPAY_SANDBOX',
    p_webhook_event_id  TEXT DEFAULT NULL,
    p_declared_amount   NUMERIC DEFAULT NULL   -- gateway-declared amount (untrusted)
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
    v_session   payment_sessions%ROWTYPE;
    v_job       jobs%ROWTYPE;
    v_payment   payments%ROWTYPE;
    v_ledger_id TEXT;
BEGIN
    -- [1] Validate session exists + take single-flight row lock
    SELECT * INTO v_session FROM payment_sessions
     WHERE order_id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'SESSION_NOT_FOUND',
                                 'orderId', p_order_id);
    END IF;

    -- [2] Order-state idempotency gate
    IF v_session.status = 'SUCCESS' THEN
        RETURN json_build_object('success', true, 'duplicate', true,
                                 'orderId', p_order_id);
    END IF;
    IF v_session.status IN ('FAILED', 'CANCELLED', 'EXPIRED') THEN
        RETURN json_build_object('success', false, 'code', 'SESSION_NOT_PAYABLE',
                                 'status', v_session.status);
    END IF;

    -- [3] Customer authority: session.customer_id is authoritative. A
    --     caller-supplied customer that disagrees is rejected + logged.
    IF p_customer IS NOT NULL AND v_session.customer_id IS NOT NULL
       AND p_customer <> v_session.customer_id THEN
        INSERT INTO payment_webhooks(event_id, event_type, provider, amount, status,
                                     payload, is_processed)
        VALUES (COALESCE(p_webhook_event_id, 'evt_reject_cust_' || p_order_id || '_'
                         || extract(epoch FROM now())::bigint),
                'capture.customer_mismatch', p_provider, v_session.amount, 'REJECTED',
                jsonb_build_object('order_id', p_order_id,
                                   'session_customer', v_session.customer_id,
                                   'claimed_customer', p_customer), true);
        RETURN json_build_object('success', false, 'code', 'CUSTOMER_MISMATCH');
    END IF;

    -- [4] Amount authority: the persisted session amount wins. Any gateway-
    --     declared mismatch rejects capture + records the rejection durably.
    IF p_declared_amount IS NOT NULL AND p_declared_amount <> v_session.amount THEN
        INSERT INTO payment_webhooks(event_id, event_type, provider, amount, status,
                                     payload, is_processed)
        VALUES (COALESCE(p_webhook_event_id, 'evt_reject_amt_' || p_order_id || '_'
                         || extract(epoch FROM now())::bigint),
                'capture.amount_mismatch', p_provider, p_declared_amount, 'REJECTED',
                jsonb_build_object('order_id', p_order_id,
                                   'authoritative_amount', v_session.amount,
                                   'declared_amount', p_declared_amount), true);
        RETURN json_build_object('success', false, 'code', 'AMOUNT_MISMATCH',
                                 'expected', v_session.amount,
                                 'received', p_declared_amount);
    END IF;

    -- [5] Job ownership + lock (only when a platform job is attached)
    IF v_session.job_id IS NOT NULL THEN
        SELECT * INTO v_job FROM jobs WHERE id = v_session.job_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN json_build_object('success', false, 'code', 'JOB_NOT_FOUND',
                                     'jobId', v_session.job_id);
        END IF;
        IF v_job.customer_id IS NOT NULL AND v_session.customer_id IS NOT NULL
           AND v_job.customer_id <> v_session.customer_id THEN
            INSERT INTO payment_webhooks(event_id, event_type, provider, amount, status,
                                         payload, is_processed)
            VALUES ('evt_reject_job_' || p_order_id || '_' || extract(epoch FROM now())::bigint,
                    'capture.job_mismatch', p_provider, v_session.amount, 'REJECTED',
                    jsonb_build_object('order_id', p_order_id, 'job_customer', v_job.customer_id,
                                       'session_customer', v_session.customer_id), true);
            RETURN json_build_object('success', false, 'code', 'JOB_MISMATCH',
                                     'jobId', v_session.job_id);
        END IF;
    END IF;

    -- [6] Single-flight transition INITIATED/PENDING -> SUCCESS
    UPDATE payment_sessions SET status = 'SUCCESS', updated_at = now()
     WHERE order_id = p_order_id AND status IN ('INITIATED', 'PENDING');
    IF NOT FOUND THEN
        RETURN json_build_object('success', true, 'duplicate', true, 'orderId', p_order_id);
    END IF;

    -- [7] Canonical payment row (race-safe via UNIQUE(payment_id))
    INSERT INTO payments(payment_id, idempotency_key, gateway_order_id, job_id, customer_id,
                         amount, currency, method, status, gateway_transaction_id, gateway_signature)
    VALUES (p_payment_id, p_order_id || ':' || p_payment_id, p_order_id,
            v_session.job_id, v_session.customer_id, v_session.amount,
            COALESCE(v_session.currency, 'INR'), p_method, 'CAPTURED', p_payment_id,
            CASE WHEN p_signature_valid THEN 'VERIFIED' ELSE NULL END)
    ON CONFLICT (payment_id) DO NOTHING
    RETURNING * INTO v_payment;
    IF v_payment.id IS NULL THEN
        RETURN json_build_object('success', true, 'duplicate', true, 'paymentId', p_payment_id);
    END IF;

    -- [8] Webhook / replay-absorbing idempotency record
    INSERT INTO payment_webhooks(event_id, event_type, provider, payment_id, amount, status,
                                 payload, is_processed, processed_at, signature_valid)
    VALUES (COALESCE(p_webhook_event_id, 'evt_capture_' || p_payment_id),
            'payment.captured', p_provider, p_payment_id, v_session.amount, 'CAPTURED',
            jsonb_build_object('order_id', p_order_id, 'session_amount', v_session.amount,
                               'service_type', COALESCE(p_service, v_session.service_type)),
            true, now(), p_signature_valid)
    ON CONFLICT (event_id) DO NOTHING;

    -- [9] Double-entry capture line (balanced single-row convention)
    v_ledger_id := 'LEDG-' || substr(md5(p_order_id || ':' || p_payment_id), 1, 32);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id,
            COALESCE(v_session.service_type, 'OTHER') || '_PAYMENT_CAPTURE',
            'PAYMENT_GATEWAY_ESCROW',
            CASE WHEN v_session.service_type IN ('FOOD', 'GROCERY')
                 THEN 'MERCHANT_PAYABLE' ELSE 'CUSTOMER_WALLET_LIABILITY' END,
            v_session.amount, COALESCE(v_session.currency, 'INR'), v_session.job_id,
            'Atomic payment capture [' || p_payment_id || ']', p_order_id);

    -- [10]+[11] Job -> PAID with authoritative payment id (same transaction)
    IF v_session.job_id IS NOT NULL THEN
        UPDATE jobs SET payment_status = 'PAID', payment_id = p_payment_id
         WHERE id = v_session.job_id;
    END IF;

    -- [12] All-or-nothing success
    RETURN json_build_object('success', true, 'duplicate', false, 'orderId', p_order_id,
                             'paymentId', p_payment_id, 'amount', v_session.amount,
                             'jobId', v_session.job_id, 'ledgerEntryId', v_ledger_id,
                             'serviceType', v_session.service_type);
END $$;

-- Least privilege: RPC is a privileged financial primitive.
REVOKE ALL ON FUNCTION capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric)
    TO service_role;

-- =========================================================================
-- 6b. ATOMIC FULL-REFUND RPC — reversal mirrored against payment capture.
--     Idempotency claim is made by UNIQUELY claiming the refund event id in
--     payment_webhooks FIRST; the loser of that race returns duplicate.
--     Stage A semantics: FULL refund of a CAPTURED payment only.
--     Sandbox/simulation — does NOT call Razorpay HTTP endpoints.
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
    v_pay         payments%ROWTYPE;
    v_event_id    TEXT;
    v_ledger_id   TEXT;
BEGIN
    -- Resolve + single-flight lock on the canonical payment row
    SELECT * INTO v_pay FROM payments
     WHERE payment_id = p_order_or_payment OR gateway_order_id = p_order_or_payment
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'PAYMENT_NOT_FOUND');
    END IF;

    v_event_id := COALESCE(p_refund_event_id, 'evt_refund_' || v_pay.payment_id);

    -- Already refunded at all? -> plain duplicate
    IF v_pay.status = 'REFUNDED' THEN
        RETURN json_build_object('success', true, 'duplicate', true,
                                 'paymentId', v_pay.payment_id);
    END IF;
    IF v_pay.status <> 'CAPTURED' THEN
        RETURN json_build_object('success', false, 'code', 'INVALID_STATE',
                                 'status', v_pay.status);
    END IF;

    -- Amount authority for refunds mirrors capture
    IF p_declared_amount IS NOT NULL AND p_declared_amount <> v_pay.amount THEN
        INSERT INTO payment_webhooks(event_id, event_type, provider, amount, status,
                                     payload, is_processed)
        VALUES ('evt_reject_refamt_' || v_event_id || '_' || extract(epoch FROM now())::bigint,
                'refund.amount_mismatch', p_provider, p_declared_amount, 'REJECTED',
                jsonb_build_object('paymentId', v_pay.payment_id,
                                   'authoritative_amount', v_pay.amount,
                                   'declared_amount', p_declared_amount), true);
        RETURN json_build_object('success', false, 'code', 'REFUND_AMOUNT_MISMATCH',
                                 'expected', v_pay.amount, 'received', p_declared_amount);
    END IF;

    -- Claim the unique refund event id BEFORE mutating financial rows
    BEGIN
        INSERT INTO payment_webhooks(event_id, event_type, provider, payment_id, amount,
                                     status, payload, is_processed, processed_at, signature_valid)
        VALUES (v_event_id, 'refund.processed', p_provider, v_pay.payment_id,
                v_pay.amount, 'PROCESSED',
                jsonb_build_object('order_id', v_pay.gateway_order_id,
                                   'reason', p_reason, 'authorized_by', p_authorized_by),
                true, now(), true);
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', true, 'duplicate', true,
                                 'paymentId', v_pay.payment_id,
                                 'eventId', v_event_id);
    END;

    -- Financial reversal row (mirrors legacy memory-path account pairing)
    v_ledger_id := 'LEDGR-' || substr(md5(v_event_id), 1, 31);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id, 'DISPUTE_REFUND',
            'CUSTOMER_WALLET_LIABILITY',           -- liability restored
            'PAYMENT_GATEWAY_ESCROW',              -- escrow returned to gateway
            v_pay.amount, COALESCE(v_pay.currency, 'INR'),
            v_pay.job_id, 'Atomic refund reversal [' || COALESCE(p_reason,'unspecified') || ']',
            COALESCE(v_pay.gateway_order_id, v_pay.payment_id));

    -- Flip payment state last; row is locked so status can only be CAPTURED here
    UPDATE payments SET status = 'REFUNDED', refunded_at = now(), updated_at = now()
     WHERE id = v_pay.id;

    IF v_pay.job_id IS NOT NULL THEN
        UPDATE jobs SET payment_status = 'REFUNDED' WHERE id = v_pay.job_id;
    END IF;

    RETURN json_build_object('success', true, 'duplicate', false,
                             'paymentId', v_pay.payment_id, 'refundedAmount', v_pay.amount,
                             'eventId', v_event_id, 'ledgerEntryId', v_ledger_id);
END $$;

REVOKE ALL ON FUNCTION refund_payment_atomic(text, text, text, text, text, numeric)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refund_payment_atomic(text, text, text, text, text, numeric)
    TO service_role;


