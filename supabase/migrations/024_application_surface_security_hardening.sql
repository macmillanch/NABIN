-- =============================================================================
-- NABIN — PHASE 10: APPLICATION SURFACE SECURITY HARDENING
-- =============================================================================
-- Migration: 024
-- Predecessor: 023_financial_ledger_security_hardening.sql
--
-- Forensic audit findings addressed here (all reproduced on local PostgreSQL
-- before any change was written — see backend/phase10_exploit_proof.js):
--
--   F5 (CRITICAL) Client-facing roles kept full table-level write privilege on
--      32 public tables, including TRUNCATE. RLS does NOT filter TRUNCATE, so
--      the row-security model was bypassed for a total-destruction primitive.
--      Verified: has_table_privilege('anon','public.jobs','TRUNCATE') = true,
--      and 'anon' indeed reaches PostgreSQL as a role that can issue TRUNCATE
--      (the local attempt only stopped early because jobs is FK-referenced,
--      i.e. the privilege itself was granted). Phase 9 (023) closed this for
--      the twelve financial tables only; the operational tables that feed those
--      financial records were still exposed.
--
--   F6 (CRITICAL) Self-service RLS policies of the shape
--      USING (auth.uid() = id) with cmd = ALL, combined with full table-level
--      UPDATE grants, let any authenticated holder of the anon/authenticated
--      key read AND REWRITE privileged columns on their own row. Reproduced
--      exactly:
--        UPDATE users   SET identity_status='VERIFIED', wallet_balance=+999999
--        UPDATE drivers SET wallet_balance = wallet_balance + 999999
--      i.e. KYC self-approval and self-issued wallet credit with no payment,
--      no ledger entry and no audit trail. This defeats Phase 9's DEC-004
--      atomic-wallet control by writing the balance column directly.
--
--   F7 (HIGH) jobs.final_total / driver_earnings / platform_commission and
--      orders.total_amount / items_snapshot were mutable after creation, so the
--      authoritative money figures consumed by settlement, the double-entry
--      ledger and refunds could be rewritten post-hoc.
--
--   F8 (LOW) Trigger function prevent_audit_log_mutation() carried a default
--      PUBLIC EXECUTE grant, exposing it to anon/authenticated. Trigger
--      functions never need to be callable by clients.
--
-- Design constraints honoured:
--   * No business/legal value is introduced. No commission rate, platform fee,
--     tax treatment, payout schedule, settlement rule, refund bearer or
--     cancellation penalty is defined or changed here. Existing stored values
--     (e.g. merchants.commission_rate) are treated as data, not policy.
--   * The Node backend is unaffected: it accesses PostgreSQL either as the
--     database owner (DATABASE_URL) or as service_role (Supabase admin client).
--     The Flutter client holds no Supabase dependency and talks only to the
--     Node API, so no application flow relies on client-role direct writes.
--   * Historical migrations are untouched. 023 and all earlier migrations remain
--     authoritative for what they already fixed.
-- =============================================================================

-- =============================================================================
-- SECTION 1 — F5: remove client write privilege from the application surface
-- =============================================================================
-- RLS mediates INSERT/UPDATE/DELETE row visibility, but it cannot restrict
-- TRUNCATE, TRIGGER or REFERENCES — those are pure privilege decisions. The
-- least-privilege posture for this architecture is therefore: client roles may
-- read (still row-filtered by RLS) and may never write.
--
-- SELECT is deliberately NOT touched by this section, so every read-side RLS
-- policy and every existing read-restriction test keeps its current behaviour.
--
-- Idempotent: REVOKE is a no-op when the privilege is already absent, and the
-- loop covers tables created by earlier migrations as well as any future table
-- added before this migration is re-run.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY c.relname
  LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.%I FROM anon, authenticated',
      t.relname
    );
  END LOOP;
END;
$$;

COMMENT ON SCHEMA public IS
  'NABIN public schema. Phase 10 (migration 024): anon/authenticated hold no '
  'INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on any public table. '
  'Clients read through RLS-scoped SELECT or, preferably, through the Node API.';

-- =============================================================================
-- SECTION 2 — F6: durable guard against privileged-column self-mutation
-- =============================================================================
-- Section 1 removes the grant that made F6 reachable. This section makes the
-- protection durable: if a future migration re-grants UPDATE for a legitimate
-- self-service profile flow, the existing USING (auth.uid() = id) policies would
-- otherwise silently restore privilege escalation and money creation.
--
-- The guard is deliberately role-scoped rather than unconditional, so that
-- service-role, the database owner and every SECURITY DEFINER routine keep
-- working untouched. Only the two client-facing roles are constrained, and only
-- on the columns that carry identity, verification or money.

CREATE OR REPLACE FUNCTION public.prevent_client_privileged_column_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  protected_columns text[];
  col               text;
  old_value         jsonb;
  new_value         jsonb;
BEGIN
  -- Trusted server-side callers: database owner, service_role, migration runner,
  -- and any SECURITY DEFINER function (whose current_user is its owner).
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'users' THEN
    protected_columns := ARRAY[
      'id', 'phone', 'wallet_balance', 'identity_status', 'account_status'
    ];
  ELSIF TG_TABLE_NAME = 'drivers' THEN
    protected_columns := ARRAY[
      'id', 'user_id', 'phone', 'wallet_balance', 'kyc_status',
      'operational_status', 'license_number', 'vehicle_number',
      'verified_upi_id', 'pending_upi_id', 'payout_upi_verified',
      'payout_upi_verified_at', 'vpa_verification_method',
      'upi_cooling_until', 'kyc_verified_at', 'kyc_rejected_reason'
    ];
  ELSIF TG_TABLE_NAME = 'merchants' THEN
    protected_columns := ARRAY[
      'id', 'wallet_balance', 'commission_rate', 'merchant_type',
      'fssai_license'
    ];
  ELSE
    -- Unmapped table: deny the write rather than fail open.
    RAISE EXCEPTION
      'Client role % may not modify %.% : no column policy is registered for this table.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME;
  END IF;

  old_value := to_jsonb(OLD);
  new_value := to_jsonb(NEW);

  FOREACH col IN ARRAY protected_columns
  LOOP
    IF new_value -> col IS DISTINCT FROM old_value -> col THEN
      RAISE EXCEPTION
        'Privileged column %.%.% is not client-writable (attempted by role %).',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, col, current_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_client_privileged_column_mutation() FROM PUBLIC;

COMMENT ON FUNCTION public.prevent_client_privileged_column_mutation() IS
  'Phase 10 (migration 024): blocks anon/authenticated from altering identity, '
  'verification or balance columns on their own users/drivers/merchants row. '
  'Closes the F6 self-escalation and self-credit path.';

DROP TRIGGER IF EXISTS trg_users_privileged_column_guard ON public.users;
CREATE TRIGGER trg_users_privileged_column_guard
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_privileged_column_mutation();

DROP TRIGGER IF EXISTS trg_drivers_privileged_column_guard ON public.drivers;
CREATE TRIGGER trg_drivers_privileged_column_guard
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_privileged_column_mutation();

DROP TRIGGER IF EXISTS trg_merchants_privileged_column_guard ON public.merchants;
CREATE TRIGGER trg_merchants_privileged_column_guard
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_privileged_column_mutation();

-- =============================================================================
-- SECTION 3 — append-only audit trail + immutable money/OTP columns
-- =============================================================================
-- Same role-scoped design as Section 2. This preserves the Postgres-primary
-- business flow untouched (searching -> assigned -> in transit -> completed) and
-- only freezes the fields that represent a committed financial or OTP fact.

CREATE OR REPLACE FUNCTION public.prevent_client_financial_record_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public
AS $$
DECLARE
  frozen_columns text[];
  col            text;
  old_value      jsonb;
  new_value      jsonb;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Client role % may not delete from %.% : this record is append-only.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_TABLE_NAME = 'order_transitions' THEN
    RAISE EXCEPTION
      'Client role % may not modify %.% : order transition history is append-only.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_TABLE_NAME = 'jobs' THEN
    -- Write-once columns. Every entry is set by JobRepository.create() and is
    -- never reassigned by any later application path (verified by audit):
    --   identity  -> job_number, service_type, customer_id, driver_id, merchant_id
    --   money     -> final_total, fare_subtotal, driver_earnings,
    --                platform_commission, packaging_fee, tax_amount,
    --                surge_amount, surge_multiplier, discount_amount
    --   OTP proof -> start_otp, pickup_otp, delivery_otp
    -- Status/driver lifecycle, payment_status, refund_* and cancellation_* stay
    -- mutable: those are legitimate progressions, not committed financial facts.
    frozen_columns := ARRAY[
      'job_number', 'service_type', 'customer_id', 'driver_id', 'merchant_id',
      'final_total', 'fare_subtotal', 'driver_earnings', 'platform_commission',
      'packaging_fee', 'tax_amount', 'surge_amount', 'surge_multiplier',
      'discount_amount', 'start_otp', 'pickup_otp', 'delivery_otp'
    ];
  ELSIF TG_TABLE_NAME = 'orders' THEN
    frozen_columns := ARRAY[
      'order_number', 'job_id', 'checkout_id', 'customer_id', 'merchant_id',
      'total_amount', 'currency', 'items_snapshot'
    ];
  ELSE
    RAISE EXCEPTION
      'Client role % may not modify %.% : no column policy is registered for this table.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  old_value := to_jsonb(OLD);
  new_value := to_jsonb(NEW);

  FOREACH col IN ARRAY frozen_columns
  LOOP
    IF new_value -> col IS DISTINCT FROM old_value -> col THEN
      RAISE EXCEPTION
        'Financial/OTP column %.%.% is immutable after creation (attempted by role %).',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, col, current_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_client_financial_record_mutation() FROM PUBLIC;

COMMENT ON FUNCTION public.prevent_client_financial_record_mutation() IS
  'Phase 10 (migration 024): freezes job/order money and OTP columns and makes '
  'order_transitions append-only for anon/authenticated, so a client can neither '
  'rewrite a settled amount nor forge/alter a proof-of-delivery code.';

DROP TRIGGER IF EXISTS trg_jobs_financial_record_guard ON public.jobs;
CREATE TRIGGER trg_jobs_financial_record_guard
  BEFORE UPDATE OR DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_financial_record_mutation();

DROP TRIGGER IF EXISTS trg_orders_financial_record_guard ON public.orders;
CREATE TRIGGER trg_orders_financial_record_guard
  BEFORE UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_financial_record_mutation();

DROP TRIGGER IF EXISTS trg_order_transitions_append_only ON public.order_transitions;
CREATE TRIGGER trg_order_transitions_append_only
  BEFORE UPDATE OR DELETE ON public.order_transitions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_client_financial_record_mutation();

-- =============================================================================
-- SECTION 3b — F8: trigger functions are not client-callable
-- =============================================================================
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. A trigger function is
-- never invoked directly by a client, so that default grant is pure exposed
-- surface. Revoking it removes the callable endpoint without affecting trigger
-- firing (trigger invocation does not check EXECUTE).

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prorettype = 'pg_catalog.trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END;
$$;

-- =============================================================================
-- SECTION 4 — post-migration verification
-- =============================================================================

DO $$
DECLARE
  leftover integer;
BEGIN
  SELECT count(*) INTO leftover
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee IN ('anon', 'authenticated')
    AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES');

  IF leftover > 0 THEN
    RAISE EXCEPTION
      'Migration 024 incomplete: % client-role write privilege(s) remain on public tables.',
      leftover;
  END IF;

  RAISE NOTICE 'Migration 024 verified: anon/authenticated hold SELECT-only on public tables.';
END;
$$;
