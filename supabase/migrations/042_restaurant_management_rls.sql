-- =============================================================================
-- NABIN PLATFORM — RESTAURANT MANAGEMENT SYSTEM (RMS) TABLE HARDENING
-- Migration: 042_restaurant_management_rls.sql
-- Status: LOCAL VERIFICATION ONLY.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION DATABASE.
-- =============================================================================
-- Why: migration 041 creates seven `restaurant_*` tables and contains no RLS or
-- GRANT statement at all, while every other table in `public` is deny-by-default.
-- Measured on the local target before this file existed, all seven had
-- relrowsecurity = false AND held INSERT/UPDATE/DELETE/SELECT/TRUNCATE grants for
-- `anon` and `authenticated` — so an anon-key client could read and rewrite bills,
-- KDS tickets and table sessions directly, bypassing every server-side check.
--
-- Pattern: the 031 dark-store block (041's tables get the same treatment) —
-- enabled, no permissive policy, service_role granted. The backend reaches these
-- tables only through `RestaurantManagementRepository`, which uses the
-- service-role client, and `service_role` carries BYPASSRLS on this stack, so
-- deny-by-default costs no route its behaviour. Nothing here narrows `postgres`.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY and GRANT/REVOKE are all re-appliable.
-- =============================================================================

ALTER TABLE public.restaurant_sections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_tables       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_bills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_staff        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_kds_tickets  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_sections     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_tables       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_table_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_reservations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_bills        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_staff        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_kds_tickets  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_sections     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_tables       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_table_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_reservations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_bills        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_staff        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_kds_tickets  TO service_role;
