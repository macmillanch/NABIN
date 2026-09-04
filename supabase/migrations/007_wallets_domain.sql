-- =========================================================================
-- NABIN PLATFORM — WALLETS & FINANCIAL PERSISTENCE MIGRATION
-- Migration: 007_wallets_domain.sql
-- =========================================================================

-- We need a single RPC to reliably adjust a wallet balance and simultaneously
-- write a double-entry ledger journal. This replaces the in-memory Node
-- arithmetic + fire-and-forget sync.

CREATE OR REPLACE FUNCTION adjust_wallet_atomic(
    p_owner_id UUID,
    p_owner_type VARCHAR,        -- 'CUSTOMER', 'DRIVER', 'MERCHANT'
    p_amount NUMERIC,            -- Positive for credit, negative for debit
    p_category VARCHAR,          -- e.g. 'WALLET_TOPUP', 'RIDE_SETTLEMENT'
    p_description TEXT,
    p_reference_id VARCHAR,
    p_debit_account VARCHAR,
    p_credit_account VARCHAR,
    p_idempotency_key VARCHAR DEFAULT NULL
) RETURNS JSON AS $$
DECLARE
    v_transaction_id VARCHAR;
    v_journal_id UUID;
    v_new_balance NUMERIC;
    v_abs_amount NUMERIC;
BEGIN
    -- 1. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_journal_id FROM journal_transactions WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            -- Find what the balance is now, to return safely
            IF p_owner_type = 'CUSTOMER' THEN
                SELECT wallet_balance INTO v_new_balance FROM users WHERE id = p_owner_id;
            ELSIF p_owner_type = 'DRIVER' THEN
                SELECT wallet_balance INTO v_new_balance FROM drivers WHERE id = p_owner_id;
            ELSIF p_owner_type = 'MERCHANT' THEN
                SELECT wallet_balance INTO v_new_balance FROM merchants WHERE id = p_owner_id;
            END IF;
            
            RETURN json_build_object(
                'success', true,
                'status', 'IDEMPOTENT_SKIPPED',
                'balance', v_new_balance
            );
        END IF;
    END IF;

    -- 2. Lock and Update Wallet Balance
    IF p_owner_type = 'CUSTOMER' THEN
        UPDATE users
        SET wallet_balance = wallet_balance + p_amount, updated_at = NOW()
        WHERE id = p_owner_id
        RETURNING wallet_balance INTO v_new_balance;
    ELSIF p_owner_type = 'DRIVER' THEN
        UPDATE drivers
        SET wallet_balance = wallet_balance + p_amount
        WHERE id = p_owner_id
        RETURNING wallet_balance INTO v_new_balance;
    ELSIF p_owner_type = 'MERCHANT' THEN
        UPDATE merchants
        SET wallet_balance = wallet_balance + p_amount
        WHERE id = p_owner_id
        RETURNING wallet_balance INTO v_new_balance;
    ELSE
        RAISE EXCEPTION 'Invalid owner_type: %', p_owner_type;
    END IF;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Wallet owner not found for ID %', p_owner_id;
    END IF;

    -- Prevent negative balance on deductions, unless specifically allowed by rules.
    -- Assuming a zero-trust model: do not allow wallet balance to drop below zero.
    IF v_new_balance < 0 THEN
        RAISE EXCEPTION 'Insufficient wallet balance for % (ID: %). Attempted change: %, Resulting: %', 
            p_owner_type, p_owner_id, p_amount, v_new_balance;
    END IF;

    -- 3. Write Double-Entry Ledger
    v_transaction_id := 'txn_' || extract(epoch from now())::bigint || '_' || substring(md5(random()::text) from 1 for 6);
    v_abs_amount := abs(p_amount);

    INSERT INTO journal_transactions (
        transaction_id, idempotency_key, category, total_debit, total_credit, description, reference_id, status
    ) VALUES (
        v_transaction_id, p_idempotency_key, p_category, v_abs_amount, v_abs_amount, p_description, p_reference_id, 'POSTED'
    ) RETURNING id INTO v_journal_id;

    INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
    VALUES (v_journal_id, p_debit_account, 'DEBIT', v_abs_amount, p_owner_type, p_owner_id, p_description);

    INSERT INTO journal_lines (journal_id, account_code, entry_type, amount, entity_type, entity_id, notes)
    VALUES (v_journal_id, p_credit_account, 'CREDIT', v_abs_amount, p_owner_type, p_owner_id, p_description);

    RETURN json_build_object(
        'success', true,
        'status', 'POSTED',
        'balance', v_new_balance,
        'transaction_id', v_transaction_id
    );

EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Wallet update failed: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;
