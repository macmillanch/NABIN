-- =============================================================================
-- Migration 023: Financial Ledger, Wallet & Money-Movement Security Hardening
-- Phase 9 Forensic Security Audit
-- =============================================================================
-- Applies only to local Docker PostgreSQL (127.0.0.1:54322).
-- Remote Supabase is strictly untouched (DEC-013).
--
-- Findings addressed:
--   F1 (CRITICAL): anon/authenticated hold INSERT/UPDATE/DELETE/TRUNCATE grants
--      on all financial tables. RLS does NOT cover TRUNCATE, and full DML
--      grants violate least privilege. Money mutations must flow exclusively
--      through the backend service_role and the atomic financial RPCs.
--   F2 (HIGH): No immutability enforcement on the double-entry ledger and
--      financial registries (ledger_entries, journal_transactions,
--      journal_lines, driver_payouts, payment_webhooks,
--      payment_refund_authorizations could be UPDATEd or DELETEd).
--   F3 (HIGH): payments.amount and payment_sessions.amount could be altered
--      after creation; payments.refunded_amount could be rewound or set above
--      the captured amount (partial-refund accounting corruption).
--   F4 (MEDIUM): No database-level non-negative CHECK on wallet_balance
--      columns (users, drivers, merchants). Negative balances relied solely
--      on application logic (DEC-004 defense in depth).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: DML privilege revocation on financial tables (Finding F1)
-- Mutations on financial tables are only permitted for service_role/postgres
-- (the backend's privileged connection). Direct read grants are kept only for
-- tables with user-scoped SELECT RLS policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- Tables with NO row-scoped read policies: revoke everything from client roles.
REVOKE ALL ON TABLE public.admin_accounts                FROM anon, authenticated;
REVOKE ALL ON TABLE public.journal_lines                 FROM anon, authenticated;
REVOKE ALL ON TABLE public.ledger_accounts               FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_refund_authorizations FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_webhooks              FROM anon, authenticated;

-- Tables with user-scoped SELECT policies: revoke mutations, keep reads
-- (RLS policies continue to scope every row returned).
REVOKE ALL ON TABLE public.payments                     FROM anon, authenticated;
GRANT SELECT ON TABLE public.payments                   TO anon, authenticated;

REVOKE ALL ON TABLE public.payment_sessions             FROM anon, authenticated;
GRANT SELECT ON TABLE public.payment_sessions           TO anon, authenticated;

REVOKE ALL ON TABLE public.driver_payouts               FROM anon, authenticated;
GRANT SELECT ON TABLE public.driver_payouts             TO anon, authenticated;

REVOKE ALL ON TABLE public.journal_transactions         FROM anon, authenticated;
GRANT SELECT ON TABLE public.journal_transactions       TO anon, authenticated;

REVOKE ALL ON TABLE public.ledger_entries               FROM anon, authenticated;
GRANT SELECT ON TABLE public.ledger_entries             TO anon, authenticated;

REVOKE ALL ON TABLE public.promotions                   FROM anon, authenticated;
GRANT SELECT ON TABLE public.promotions                 TO anon, authenticated;

REVOKE ALL ON TABLE public.promotion_redemptions        FROM anon, authenticated;
GRANT SELECT ON TABLE public.promotion_redemptions      TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Append-only enforcement on the financial audit trail (Finding F2)
-- These tables must never be UPDATEd or DELETEd once written:
--   - ledger_entries                (double-entry capture/refund reversals)
--   - journal_transactions          (wallet journal headers; balanced registry)
--   - journal_lines                 (wallet journal debit/credit legs)
--   - driver_payouts                (payout disbursement register)
--   - payment_webhooks              (webhook idempotency + integrity registry)
--   - payment_refund_authorizations (refund authorization register)
-- NOTE: journal_transactions.status includes a 'VOIDED' state in its CHECK
-- constraint. No voiding workflow exists today; if one is approved later, a
-- follow-up migration must narrow this trigger to permit the sanctioned
-- status transition only.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_financial_row_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only: % operations are forbidden. Attempted on row id=%.',
    TG_TABLE_NAME,
    TG_OP,
    COALESCE(OLD.id::text, 'unknown')
    USING ERRCODE = '23514';  -- check_violation
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_financial_row_mutation() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

DROP TRIGGER IF EXISTS trg_journal_transactions_append_only ON public.journal_transactions;
CREATE TRIGGER trg_journal_transactions_append_only
  BEFORE UPDATE OR DELETE ON public.journal_transactions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

DROP TRIGGER IF EXISTS trg_journal_lines_append_only ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_append_only
  BEFORE UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

DROP TRIGGER IF EXISTS trg_driver_payouts_append_only ON public.driver_payouts;
CREATE TRIGGER trg_driver_payouts_append_only
  BEFORE UPDATE OR DELETE ON public.driver_payouts
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

DROP TRIGGER IF EXISTS trg_payment_webhooks_append_only ON public.payment_webhooks;
CREATE TRIGGER trg_payment_webhooks_append_only
  BEFORE UPDATE OR DELETE ON public.payment_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

DROP TRIGGER IF EXISTS trg_payment_refund_authorizations_append_only ON public.payment_refund_authorizations;
CREATE TRIGGER trg_payment_refund_authorizations_append_only
  BEFORE UPDATE OR DELETE ON public.payment_refund_authorizations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_financial_row_mutation();

COMMENT ON FUNCTION public.prevent_financial_row_mutation() IS
  'Phase 9: Enforces append-only semantics on financial ledger/registry tables. No UPDATE or DELETE is permitted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Financial field immutability guards (Finding F3)
-- payments and payment_sessions are mutable tables (status lifecycle), but
-- their identity/amount columns must never change after creation, and
-- refunds must be monotonic and capped at the captured amount.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.enforce_payment_mutation_invariants()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.amount <> OLD.amount THEN
    RAISE EXCEPTION
      'payments.amount is immutable after creation (payment_id=%).', OLD.payment_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.payment_id <> OLD.payment_id THEN
    RAISE EXCEPTION
      'payments.payment_id is immutable after creation (id=%).', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION
      'payments.customer_id is immutable after creation (payment_id=%).', OLD.payment_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key THEN
    RAISE EXCEPTION
      'payments.idempotency_key is immutable after creation (payment_id=%).', OLD.payment_id
      USING ERRCODE = '23514';
  END IF;
  IF COALESCE(NEW.refunded_amount, 0) < COALESCE(OLD.refunded_amount, 0) THEN
    RAISE EXCEPTION
      'payments.refunded_amount cannot decrease (payment_id=%): % -> %.',
      OLD.payment_id, COALESCE(OLD.refunded_amount, 0), COALESCE(NEW.refunded_amount, 0)
      USING ERRCODE = '23514';
  END IF;
  IF COALESCE(NEW.refunded_amount, 0) > NEW.amount THEN
    RAISE EXCEPTION
      'payments.refunded_amount cannot exceed captured amount (payment_id=%): % > %.',
      OLD.payment_id, COALESCE(NEW.refunded_amount, 0), NEW.amount
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_payment_mutation_invariants() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_payments_mutation_invariants ON public.payments;
CREATE TRIGGER trg_payments_mutation_invariants
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_mutation_invariants();

COMMENT ON FUNCTION public.enforce_payment_mutation_invariants() IS
  'Phase 9: payments.amount/payment_id/customer_id/idempotency_key are immutable; refunded_amount is monotonic and capped at the captured amount.';

CREATE OR REPLACE FUNCTION public.enforce_payment_session_mutation_invariants()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  IF NEW.amount <> OLD.amount THEN
    RAISE EXCEPTION
      'payment_sessions.amount is immutable after creation (order_id=%).', OLD.order_id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION
      'payment_sessions.order_id is immutable after creation (id=%).', OLD.id
      USING ERRCODE = '23514';
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id THEN
    RAISE EXCEPTION
      'payment_sessions.customer_id is immutable after creation (order_id=%).', OLD.order_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_payment_session_mutation_invariants() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_payment_sessions_mutation_invariants ON public.payment_sessions;
CREATE TRIGGER trg_payment_sessions_mutation_invariants
  BEFORE UPDATE ON public.payment_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_session_mutation_invariants();

COMMENT ON FUNCTION public.enforce_payment_session_mutation_invariants() IS
  'Phase 9: payment_sessions.amount/order_id/customer_id are immutable after creation; only status lifecycle fields may change.';

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Wallet non-negative balance constraints (Finding F4)
-- DEC-004: wallet mutations are atomic and non-negative. This CHECK enforces
-- the invariant at the storage layer as defense in depth. Validated against
-- live data before creation (0 negative balances across users/drivers/
-- merchants at migration time).
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_wallet_balance_nonnegative'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_wallet_balance_nonnegative CHECK (wallet_balance >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'drivers_wallet_balance_nonnegative'
      AND conrelid = 'public.drivers'::regclass
  ) THEN
    ALTER TABLE public.drivers
      ADD CONSTRAINT drivers_wallet_balance_nonnegative CHECK (wallet_balance >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'merchants_wallet_balance_nonnegative'
      AND conrelid = 'public.merchants'::regclass
  ) THEN
    ALTER TABLE public.merchants
      ADD CONSTRAINT merchants_wallet_balance_nonnegative CHECK (wallet_balance >= 0);
  END IF;
END $$;

COMMENT ON CONSTRAINT users_wallet_balance_nonnegative ON public.users IS
  'Phase 9: Wallet balances can never go negative at the storage layer (DEC-004 defense in depth).';
COMMENT ON CONSTRAINT drivers_wallet_balance_nonnegative ON public.drivers IS
  'Phase 9: Wallet balances can never go negative at the storage layer (DEC-004 defense in depth).';
COMMENT ON CONSTRAINT merchants_wallet_balance_nonnegative ON public.merchants IS
  'Phase 9: Wallet balances can never go negative at the storage layer (DEC-004 defense in depth).';
