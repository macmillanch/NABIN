-- =========================================================================
-- 049 — A refund reverses the account its capture credited (P4-3) — LOCAL ONLY
--
-- Do NOT apply this to a hosted project. It targets the local Docker PostgreSQL
-- this repository's suites run against, and is applied with
-- backend/scripts/apply_local_migration.js (DEC-013: remote Supabase is never
-- touched without an explicit owner order).
--
-- THE DEFECT (measured, not inferred from the earlier report):
--   Migration 039 made `capture_payment_atomic` service-aware. A FOOD or GROCERY
--   capture books (039:141-186):
--       DEBIT  PAYMENT_GATEWAY_ESCROW   entity GATEWAY/<provider>
--       CREDIT MERCHANT_PAYABLE         entity MERCHANT/<metadata->>'merchant_id'>
--   while RIDE/PARCEL credit CUSTOMER_WALLET_LIABILITY. `refund_payment_atomic`
--   was left with the RIDE legs hardcoded in BOTH books (039:328-330 Book 1,
--   039:355-359 Book 2): it always debits CUSTOMER_WALLET_LIABILITY and always
--   credits PAYMENT_GATEWAY_ESCROW.
--   Proof before this migration, from backend/order_refund_reversal_symmetry_test.js
--   run 2026-10-19 against a FOOD capture of 350.00 that credited MERCHANT_PAYABLE:
--       refund legs   ["CREDIT:PAYMENT_GATEWAY_ESCROW:350.00","DEBIT:CUSTOMER_WALLET_LIABILITY:350.00"]
--       net paise     {MERCHANT_PAYABLE:-35000, PAYMENT_GATEWAY_ESCROW:0, CUSTOMER_WALLET_LIABILITY:+35000}
--   So the posting does two things at once that the books cannot explain: it debits a
--   customer liability this order never credited (a phantom ₹350 customer debit), and
--   it leaves MERCHANT_PAYABLE credited forever for money the platform no longer owes.
--   Reachable today: `/api/admin/finance/refund` (server.js, `finance.refund`) calls
--   `PaymentRepository.refundPaymentAtomic`, so a support agent settling a bad food
--   order mis-states both accounts while the HTTP call reports success.
--
-- WHY DERIVE FROM THE BOOKED CAPTURE RATHER THAN RE-BRANCH ON SERVICE TYPE:
--   The refund must reverse the entry that exists, not an entry this code re-computes.
--   A re-branch would still be wrong for any order whose capture predates 039 (Book 1
--   only, no journal) and for any capture whose legs were later corrected — and it
--   would silently disagree with the ledger it is reversing. Reading the posted capture
--   makes the reversal the arithmetic mirror by construction, which is what a
--   double-entry book requires: capture + refund nets to zero on every account touched.
--   Derivation order, each step evidenced by a check in the suite:
--     1. Book 2 — the CREDIT leg of this order's `PAYMENT_CAPTURE` journal (account +
--        entity, because entity follows account: a MERCHANT_PAYABLE debit carrying a
--        CUSTOMER entity is a fabrication of a different kind).
--     2. Book 1 — the `*_PAYMENT_CAPTURE` row's credit_account, for pre-039 captures
--        that have no journal. The entity type is inferred from the account, and the
--        merchant id is read back from the payment session's own metadata.
--     3. Neither — no capture evidence exists to mirror, so the posting stays exactly
--        what 039 writes today. Inventing a merchant leg from nothing would be a new
--        fabrication; the fallback is deliberately the unchanged behaviour.
--
-- WHAT THIS MIGRATION DOES NOT CHANGE (deliberate, and pinned by the suite):
--   * The RIDE/PARCEL legs: their capture credits CUSTOMER_WALLET_LIABILITY, so the
--     derived debit IS CUSTOMER_WALLET_LIABILITY. `ledger_double_entry_reconciliation_test.js`
--     REC-13/REC-15 pin that branch, and ORS-14/15/16 re-pin it here. A change there
--     would be a regression, not a repair.
--   * Idempotency, payload-hash conflict refusal, refundable-balance ceiling,
--     INVALID_PAYMENT_STATE / ALREADY_FULLY_REFUNDED refusals, the payment and job
--     status writes, the authorization record, the DISPUTE_REFUND category in both
--     books, the deterministic entry/transaction ids, and `FOR UPDATE` row locking —
--     all carried over verbatim from 039.
--   * No gateway call is added and no business rule about WHO must be refunded or HOW
--     MUCH is invented: this only corrects which accounts an already-agreed refund is
--     booked against. Whether a merchant-rejected or expired order refunds
--     automatically is still an owner decision, and no route here changes it.
--   * Money is never edited or deleted. Migration 033 makes journal/ledger/refund
--     rows immutable for client roles; a reversal stays a NEW balanced posting, and
--     the capture journal is asserted unchanged (ORS-22).
--
-- IDEMPOTENT: CREATE OR REPLACE on the same 7-arg signature, so re-running this file
-- rewrites the body and changes nothing else. The REVOKE/GRANT pair at the bottom is
-- repeated from 039:408-409 so the least-privilege boundary is stated in the file that
-- last defined the body.
-- =========================================================================

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
    v_ref_order         TEXT;
    -- 049: the reversal legs, derived from the capture this refund reverses.
    v_debit_account     TEXT;
    v_debit_entity_type TEXT;
    v_debit_entity_id   TEXT;
    v_credit_account    TEXT;
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

    -- 8b. (049) DERIVE THE REVERSAL LEGS FROM THE BOOKED CAPTURE.
    -- A capture writes its order id into journal/ledger reference_id and into
    -- payments.gateway_order_id, so either identifier reaches it.
    v_ref_order := COALESCE(v_pay.gateway_order_id, v_pay.payment_id);

    -- [1] Book 2 is authoritative: take the capture's CREDIT leg (account + entity) and its DEBIT leg.
    SELECT jl.account_code, jl.entity_type, jl.entity_id,
           (SELECT d.account_code FROM journal_lines d
             WHERE d.journal_id = jl.journal_id AND d.entry_type = 'DEBIT'
             ORDER BY d.created_at, d.id LIMIT 1)
      INTO v_debit_account, v_debit_entity_type, v_debit_entity_id, v_credit_account
      FROM journal_transactions jt
      JOIN journal_lines jl ON jl.journal_id = jt.id
     WHERE jt.category = 'PAYMENT_CAPTURE'
       AND jt.reference_id IN (v_pay.gateway_order_id, v_pay.payment_id)
       AND jl.entry_type = 'CREDIT'
     ORDER BY jt.created_at DESC, jl.id
     LIMIT 1;

    -- [2] Book 1 only: a capture booked before 039 has no journal, but the append-only row still
    -- names both accounts. Entity is inferred from the account (a MERCHANT_PAYABLE reversal is
    -- against a merchant, never a customer) and the merchant id is read from the session's own
    -- metadata — the same source capture_payment_atomic used to book it (039:144).
    IF v_debit_account IS NULL THEN
        SELECT le.credit_account, le.debit_account
          INTO v_debit_account, v_credit_account
          FROM ledger_entries le
         WHERE RIGHT(le.category, 16) = '_PAYMENT_CAPTURE'
           AND le.reference_id IN (v_pay.gateway_order_id, v_pay.payment_id)
         ORDER BY le.created_at DESC, le.entry_id
         LIMIT 1;

        IF v_debit_account IS NOT NULL THEN
            v_debit_entity_type := CASE WHEN v_debit_account = 'MERCHANT_PAYABLE'
                                        THEN 'MERCHANT' ELSE 'CUSTOMER' END;
        END IF;
    END IF;

    -- [3] No capture evidence in either book: keep 039's posting verbatim rather than invent a leg.
    IF v_debit_account IS NULL THEN
        v_debit_account     := 'CUSTOMER_WALLET_LIABILITY';
        v_debit_entity_type := 'CUSTOMER';
        v_debit_entity_id   := COALESCE(v_pay.customer_id::text, 'CUSTOMER');
    ELSIF v_debit_entity_id IS NULL THEN
        IF v_debit_entity_type = 'MERCHANT' THEN
            SELECT ps.metadata->>'merchant_id' INTO v_debit_entity_id
              FROM payment_sessions ps
             WHERE ps.order_id = v_ref_order;
            v_debit_entity_id := COALESCE(v_debit_entity_id, 'MERCHANT');
        ELSE
            v_debit_entity_id := COALESCE(v_pay.customer_id::text, 'CUSTOMER');
        END IF;
    END IF;

    -- The credit side is money leaving the clearing asset. The capture's debit leg names it; the
    -- escrow account is what 039 used, so an order with no capture evidence posts unchanged.
    v_credit_account := COALESCE(v_credit_account, 'PAYMENT_GATEWAY_ESCROW');

    -- 9. Book 1: Record Double-Entry Reversal (legacy append-only audit preservation)
    v_ledger_id := 'LEDGR-' || substr(md5(v_event_id), 1, 31);
    INSERT INTO ledger_entries(entry_id, category, debit_account, credit_account, amount,
                               currency, job_id, description, reference_id)
    VALUES (v_ledger_id, 'DISPUTE_REFUND',
            v_debit_account,
            v_credit_account,
            v_refund_amount, COALESCE(v_pay.currency, 'INR'),
            v_pay.job_id, 'Source Refund [' || COALESCE(p_reason, 'Unspecified') || ']',
            v_ref_order)
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
        v_ref_order, 'POSTED'
    )
    ON CONFLICT (transaction_id) DO NOTHING
    RETURNING id INTO v_journal_id;

    IF v_journal_id IS NOT NULL THEN
        -- Leg 1: Debit the account the capture credited (049) — merchant payable for FOOD/GROCERY,
        -- customer liability for RIDE/PARCEL, exactly as booked.
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, v_debit_account, 'DEBIT', v_refund_amount, v_debit_entity_type, v_debit_entity_id,
                'Reverses capture ' || v_debit_account);

        -- Leg 2: Credit Escrow Asset (clearing asset returned via gateway)
        INSERT INTO journal_lines(journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
        VALUES (v_journal_id, v_credit_account, 'CREDIT', v_refund_amount, 'GATEWAY', COALESCE(p_provider, 'GATEWAY'), 'Gateway refund payout');
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

-- Least-privilege boundary, restated from 039:408-409 so the file that defines the body also
-- states who may call it: service_role only, never anon or an authenticated client.
REVOKE ALL ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) TO service_role;
