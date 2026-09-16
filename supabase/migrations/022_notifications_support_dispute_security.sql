-- =============================================================================
-- Migration 022: Notifications, Support, Dispute, Audit Log Security Hardening
-- Phase 8 Forensic Security Audit
-- =============================================================================
-- Applies only to local Docker PostgreSQL (127.0.0.1:54322).
-- Remote Supabase is strictly untouched (DEC-013).
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 1: audit_logs — Append-Only Enforcement (Finding 1: CRITICAL)
-- audit_logs had no trigger preventing UPDATE or DELETE. Any authenticated
-- session could tamper with the immutable audit trail.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only: % operations are forbidden. Attempted on row id=%.',
    TG_OP,
    OLD.id
    USING ERRCODE = '23514';  -- check_violation
END;
$$;

-- Grant EXECUTE only to postgres/service_role (trigger will be owned by postgres)
REVOKE ALL ON FUNCTION public.prevent_audit_log_mutation() FROM PUBLIC;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

COMMENT ON FUNCTION public.prevent_audit_log_mutation() IS
  'Phase 8: Enforces append-only semantics on audit_logs. No UPDATE or DELETE is permitted.';

COMMENT ON TRIGGER trg_audit_logs_immutable ON public.audit_logs IS
  'Phase 8: Blocks UPDATE and DELETE on audit_logs to preserve immutable audit trail.';


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 2: Revoke EXECUTE on adjust_wallet_atomic from anon (Finding 2: CRITICAL)
-- adjust_wallet_atomic is SECURITY INVOKER (runs as caller). The anon role
-- had EXECUTE, allowing unauthenticated PostgREST callers to trigger wallet
-- mutations on arbitrary owner UUIDs.
-- ─────────────────────────────────────────────────────────────────────────────

-- First revoke PUBLIC (the '=' entry in proacl), then re-grant to authorized roles only
REVOKE EXECUTE ON FUNCTION public.adjust_wallet_atomic(
  p_owner_id uuid,
  p_owner_type character varying,
  p_amount numeric,
  p_category character varying,
  p_description text,
  p_reference_id character varying,
  p_debit_account character varying,
  p_credit_account character varying,
  p_idempotency_key character varying
) FROM PUBLIC;

-- Also revoke explicit authenticated grant (was present as authenticated=X/postgres in proacl)
REVOKE EXECUTE ON FUNCTION public.adjust_wallet_atomic(
  p_owner_id uuid,
  p_owner_type character varying,
  p_amount numeric,
  p_category character varying,
  p_description text,
  p_reference_id character varying,
  p_debit_account character varying,
  p_credit_account character varying,
  p_idempotency_key character varying
) FROM authenticated;

-- Re-grant to authorized roles only (service_role and postgres for backend use)
GRANT EXECUTE ON FUNCTION public.adjust_wallet_atomic(
  p_owner_id uuid,
  p_owner_type character varying,
  p_amount numeric,
  p_category character varying,
  p_description text,
  p_reference_id character varying,
  p_debit_account character varying,
  p_credit_account character varying,
  p_idempotency_key character varying
) TO service_role, postgres;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 3: Revoke EXECUTE on SECURITY DEFINER RPCs from authenticated/anon
-- (Finding 3: HIGH)
-- These SECURITY DEFINER functions run as the postgres owner. An authenticated
-- user who guesses another user's UUID can invoke the function acting as that
-- user. All calls are routed through the Node.js backend using service_role,
-- so revoking from authenticated/anon enforces least privilege at DB layer.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.accept_dispatch_offer_atomic(
  p_offer_id uuid,
  p_driver_id uuid,
  p_idempotency_key text
) FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.accept_job_assignment_atomic(
  p_job_identifier text,
  p_driver_id uuid,
  p_offer_id uuid,
  p_idempotency_key text
) FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.cancel_ride_atomic(
  p_job_id uuid,
  p_requester_id uuid,
  p_requester_role character varying,
  p_reason text,
  p_is_delayed_override boolean
) FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.redeem_promotion_atomic(
  p_code character varying,
  p_user_id uuid,
  p_order_amount numeric,
  p_service_type character varying,
  p_job_id uuid,
  p_idempotency_key character varying,
  p_vehicle_type character varying,
  p_area_id character varying
) FROM authenticated, anon;

REVOKE EXECUTE ON FUNCTION public.validate_promotion_preview(
  p_code character varying,
  p_user_id uuid,
  p_order_amount numeric,
  p_service_type character varying,
  p_vehicle_type character varying,
  p_area_id character varying
) FROM authenticated, anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 4: Tighten notifications SELECT policy (Finding 4: HIGH)
-- The legacy "Users view own notifications" policy includes
--   USING ((auth.uid() = user_id) OR (user_id IS NULL))
-- which exposes NULL-owner system/admin broadcast notifications to all
-- authenticated users. The newer p_user_read_own_notifications policy
-- correctly scopes via recipient_user_id and is the active policy.
-- Drop the legacy policy to eliminate the broadcast leak.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users view own notifications" ON public.notifications;


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 5: Tighten support_tickets admin policy (Finding 5: HIGH)
-- The "Admins view all support tickets" policy uses polcmd='*' (ALL) with
-- no WITH CHECK, allowing admin-role JWT holders to INSERT tickets on behalf
-- of arbitrary user_id values via direct PostgREST access.
-- Replace with explicit role-separated policies.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the overly broad ALL policy
DROP POLICY IF EXISTS "Admins view all support tickets" ON public.support_tickets;

-- Re-create: Admin SELECT policy (read all tickets)
CREATE POLICY "p_admin_select_support_tickets"
  ON public.support_tickets
  FOR SELECT
  USING (
    (auth.jwt() ->> 'role') = ANY (ARRAY['SUPER_ADMIN', 'SUPPORT_AGENT', 'service_role'])
    OR auth.role() = 'service_role'
  );

-- Re-create: Admin UPDATE policy (resolve/escalate tickets)
CREATE POLICY "p_admin_update_support_tickets"
  ON public.support_tickets
  FOR UPDATE
  USING (
    (auth.jwt() ->> 'role') = ANY (ARRAY['SUPER_ADMIN', 'SUPPORT_AGENT', 'service_role'])
    OR auth.role() = 'service_role'
  )
  WITH CHECK (
    (auth.jwt() ->> 'role') = ANY (ARRAY['SUPER_ADMIN', 'SUPPORT_AGENT', 'service_role'])
    OR auth.role() = 'service_role'
  );

-- INSERT is only permitted via service_role (Node.js backend)
-- This policy explicitly restricts all non-service_role INSERT.
-- No authenticated or anon policy for INSERT means INSERT is denied by default.
-- The service_role bypasses RLS entirely.

-- Ensure the existing user SELECT policy is preserved (it reads only own tickets)
-- "Users view own support tickets" policy already exists with polcmd='r'; no action needed.


-- ─────────────────────────────────────────────────────────────────────────────
-- SECTION 6: Record migration in audit_logs (using service_role privilege)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.audit_logs (
  admin_id,
  admin_name,
  role,
  action,
  module,
  target_entity_type,
  target_entity_id,
  metadata,
  success,
  created_at
) VALUES (
  'SYSTEM',
  'SYSTEM',
  'SYSTEM',
  'MIGRATION_APPLIED',
  'SECURITY',
  'MIGRATION',
  '022',
  jsonb_build_object(
    'migration', '022_notifications_support_dispute_security',
    'phase', 'Phase 8 — Forensic Security Audit',
    'findings_addressed', jsonb_build_array(
      'CRITICAL:audit_logs_append_only_trigger',
      'CRITICAL:adjust_wallet_atomic_anon_revoke',
      'HIGH:security_definer_rpcs_authenticated_anon_revoke',
      'HIGH:notifications_legacy_policy_removed',
      'HIGH:support_tickets_admin_policy_split'
    ),
    'applied_at', NOW()
  ),
  true,
  NOW()
);
