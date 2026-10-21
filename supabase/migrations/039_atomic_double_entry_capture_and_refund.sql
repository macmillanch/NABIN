-- Migration 039: Atomic Double-Entry Ledger Posting for Payment Captures and Refunds
-- Authoritative General Ledger Consolidation
--
-- Objectives:
-- 1. Ensure capture_payment_atomic writes balanced journal_transactions & journal_lines atomically with payment capture.
-- 2. Ensure refund_payment_atomic writes balanced journal_transactions & journal_lines atomically with refund authorization.
-- 3. Maintain 100% backward-compatibility with Book 1 (ledger_entries) and payment_refund_authorizations.
-- 4. Enforce fail-closed atomicity: any failure in accounting writes rolls back the entire financial operation.
-- 5. Revoke anon/public execution permissions on financial stored procedures.

-- ============================================================================
-- 1. ENHANCED ATOMIC CAPTURE WITH BALANCED GENERAL LEDGER POSTING
-- ============================================================================

CREATE OR REPLACE FUNCTION public.capture_payment_atomic(
    p_order_id text,
    p_payment_id text,
    p_customer uuid,
    p_service text DEFAULT NULL::text,
    p_method text DEFAULT 'WALLET'::text,
    p_signature_valid boolean DEFAULT true,
    p_provider text DEFAULT 'RAZORPAY_SANDBOX'::text,
    p_webhook_event_id text DEFAULT NULL::text,
    p_declared_amount numeric DEFAULT NULL::numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session           payment_sessions%ROWTYPE;
    v_job               jobs%ROWTYPE;
    v_payment           payments%ROWTYPE;
    v_ledger_id         TEXT;
    v_journal_id        UUID;
    v_transaction_id    VARCHAR(80);
    v_idempotency_key   VARCHAR(100);
    v_credit_account    VARCHAR(60);
    v_credit_entity_type VARCHAR(30);
    v_credit_entity_id   VARCHAR(60);
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

    -- [3] Customer authority: session.customer_id is authoritative.
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

    -- [4] Amount authority: persisted session amount wins.
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

    -- Determine credit account & entity based on service type
    IF v_session.service_type IN ('FOOD', 'GROCERY') THEN
        v_credit_account := 'MERCHANT_PAYABLE';
        v_credit_entity_type := 'MERCHANT';
        v_credit_entity_id := COALESCE(v_session.metadata->>'merchant_id', 'MERCHANT');
    ELSE
        v_credit_account := 'CUSTOMER_WALLET_LIABILITY';
        v_credit_entity_type := 'CUSTOMER';
        v_credit_entity_id := COALESCE(v_session.customer_id::text, 'CUSTOMER');
    END IF;

    -- [9] Book 1: Double-entry capture line (legacy append-only audit preservation)
    v_ledger_id := 'LEDG-' || substr(md5(p_order_id || ':' || p_payment_id), 1, 32);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id,
            COALESCE(v_session.service_type, 'OTHER') || '_PAYMENT_CAPTURE',
            'PAYMENT_GATEWAY_ESCROW',
            v_credit_account,
            v_session.amount, COALESCE(v_session.currency, 'INR'), v_session.job_id,
            'Atomic payment capture [' || p_payment_id || ']', p_order_id)
    ON CONFLICT (entry_id) DO NOTHING;

    -- [10] Book 2: Authoritative Double-Entry General Ledger (journal_transactions + journal_lines)
    v_idempotency_key := 'cap_' || p_order_id || ':' || p_payment_id;
    v_transaction_id := 'txn_cap_' || substr(md5(v_idempotency_key), 1, 24);

    INSERT INTO journal_transactions(
        transaction_id, idempotency_key, category, job_id, total_debit, total_credit,
        description, reference_id, status
    ) VALUES (
        v_transaction_id, v_idempotency_key, 'PAYMENT_CAPTURE', v_session.job_id,
        v_session.amount, v_session.amount,
        'Atomic payment capture [' || p_payment_id || ']', p_order_id, 'POSTED'
    )
    ON CONFLICT (transaction_id) DO NOTHING
    RETURNING id INTO v_journal_id;

    IF v_journal_id IS NOT NULL THEN
        -- Leg 1: Debit Clearing Asset
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, 'PAYMENT_GATEWAY_ESCROW', 'DEBIT', v_session.amount, 'GATEWAY', p_provider, 'Gateway clearing');

        -- Leg 2: Credit Liability / Merchant Payable
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, v_credit_account, 'CREDIT', v_session.amount, v_credit_entity_type, v_credit_entity_id, 'Escrow allocated');
    END IF;

    -- [11] Job -> PAID with authoritative payment id (same atomic transaction)
    IF v_session.job_id IS NOT NULL THEN
        UPDATE jobs SET payment_status = 'PAID', payment_id = p_payment_id
         WHERE id = v_session.job_id;
    END IF;

    -- [12] All-or-nothing success
    RETURN json_build_object('success', true, 'duplicate', false, 'orderId', p_order_id,
                             'paymentId', p_payment_id, 'amount', v_session.amount,
                             'jobId', v_session.job_id, 'ledgerEntryId', v_ledger_id,
                             'transactionId', v_transaction_id,
                             'serviceType', v_session.service_type);
END;
$function$;

-- ============================================================================
-- 2. ENHANCED ATOMIC REFUND WITH BALANCED GENERAL LEDGER POSTING
-- ============================================================================

-- Drop legacy 6-arg overload to eliminate PostgREST PGRST203 ambiguity (7-arg function has DEFAULT NULL for p_ticket_id)
DROP FUNCTION IF EXISTS public.refund_payment_atomic(text, text, text, text, text, numeric);

CREATE OR REPLACE FUNCTION public.refund_payment_atomic(
    p_order_or_payment text,
    p_refund_event_id text,
    p_reason text DEFAULT NULL::text,
    p_authorized_by text DEFAULT 'SUPPORT_AGENT'::text,
    p_provider text DEFAULT 'RAZORPAY_SANDBOX'::text,
    p_declared_amount numeric DEFAULT NULL::numeric,
    p_ticket_id text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_pay               payments%ROWTYPE;
    v_event_id          TEXT;
    v_auth              payment_refund_authorizations%ROWTYPE;
    v_refundable_left   NUMERIC;
    v_refund_amount     NUMERIC;
    v_new_refunded      NUMERIC;
    v_new_status        TEXT;
    v_payload_hash      TEXT;
    v_ledger_id         TEXT;
    v_journal_id        UUID;
    v_transaction_id    VARCHAR(80);
    v_idempotency_key   VARCHAR(100);
BEGIN
    -- 1. Deterministic Event / Idempotency Key
    v_event_id := COALESCE(p_refund_event_id, 'evt_refund_' || p_order_or_payment || '_' || extract(epoch FROM now())::bigint);

    -- 2. Lock Target Payment Row
    SELECT * INTO v_pay FROM payments
     WHERE payment_id = p_order_or_payment OR gateway_order_id = p_order_or_payment
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'code', 'PAYMENT_NOT_FOUND', 'identifier', p_order_or_payment);
    END IF;

    -- 3. Calculate Remaining Refundable Balance
    v_refundable_left := v_pay.amount - COALESCE(v_pay.refunded_amount, 0.00);

    -- 4. Amount Resolution
    IF p_declared_amount IS NOT NULL THEN
        v_refund_amount := p_declared_amount;
    ELSE
        v_refund_amount := v_refundable_left;
    END IF;

    v_payload_hash := md5(v_pay.payment_id || ':' || v_refund_amount::text || ':' || COALESCE(p_reason, '') || ':' || COALESCE(p_ticket_id, ''));

    -- 5. Idempotency Check (Case D1 vs D3)
    SELECT * INTO v_auth FROM payment_refund_authorizations WHERE idempotency_key = v_event_id;
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

    -- 9. Book 1: Record Double-Entry Reversal (legacy append-only audit preservation)
    v_ledger_id := 'LEDGR-' || substr(md5(v_event_id), 1, 31);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id, 'DISPUTE_REFUND',
            'CUSTOMER_WALLET_LIABILITY',
            'PAYMENT_GATEWAY_ESCROW',
            v_refund_amount, COALESCE(v_pay.currency, 'INR'),
            v_pay.job_id, 'Source Refund [' || COALESCE(p_reason, 'Unspecified') || ']',
            COALESCE(v_pay.gateway_order_id, v_pay.payment_id))
    ON CONFLICT (entry_id) DO NOTHING;

    -- 10. Book 2: Authoritative Double-Entry General Ledger (journal_transactions + journal_lines)
    v_idempotency_key := 'ref_' || v_event_id;
    v_transaction_id := 'txn_ref_' || substr(md5(v_idempotency_key), 1, 24);

    INSERT INTO journal_transactions(
        transaction_id, idempotency_key, category, job_id, total_debit, total_credit,
        description, reference_id, status
    ) VALUES (
        v_transaction_id, v_idempotency_key, 'DISPUTE_REFUND', v_pay.job_id,
        v_refund_amount, v_refund_amount,
        'Source Refund [' || COALESCE(p_reason, 'Unspecified') || ']',
        COALESCE(v_pay.gateway_order_id, v_pay.payment_id), 'POSTED'
    )
    ON CONFLICT (transaction_id) DO NOTHING
    RETURNING id INTO v_journal_id;

    IF v_journal_id IS NOT NULL THEN
        -- Leg 1: Debit Customer Liability (reversing customer prepaid liability)
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, 'CUSTOMER_WALLET_LIABILITY', 'DEBIT', v_refund_amount, 'CUSTOMER', COALESCE(v_pay.customer_id::text, 'CUSTOMER'), 'Customer refund debit');

        -- Leg 2: Credit Escrow Asset (clearing asset returned via gateway)
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, 'PAYMENT_GATEWAY_ESCROW', 'CREDIT', v_refund_amount, 'GATEWAY', COALESCE(p_provider, 'GATEWAY'), 'Gateway refund payout');
    END IF;

    -- 11. Persist Authoritative Authorization Record
    INSERT INTO payment_refund_authorizations(
        idempotency_key, payment_id, gateway_order_id, ticket_id, job_id,
        amount, currency, reason, authorized_by, provider,
        payload_hash, ledger_entry_id
    ) VALUES (
        v_event_id, v_pay.payment_id, v_pay.gateway_order_id, p_ticket_id, v_pay.job_id,
        v_refund_amount, COALESCE(v_pay.currency, 'INR'), p_reason, p_authorized_by, p_provider,
        v_payload_hash, v_ledger_id
    );

    -- 12. Mutate Payment Row
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
        'ledgerEntryId', v_ledger_id,
        'transactionId', v_transaction_id
    );
END;
$function$;

-- ============================================================================
-- 3. SECURITY HARDENING: REVOKE UNPRIVILEGED ACCESS (LEAST PRIVILEGE)
-- Sensitive financial functions must only be callable by backend service_role,
-- never by untrusted clients or arbitrary authenticated users via PostgREST.
-- ============================================================================

REVOKE ALL ON FUNCTION public.capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) TO service_role;
