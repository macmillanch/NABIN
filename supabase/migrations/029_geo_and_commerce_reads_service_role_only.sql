-- =========================================================================
-- 029 — LOCK THE GEOGRAPHY AND MARGIN READS TO service_role
-- =========================================================================
--
-- Owner decision implemented: Decision 1 choice A in
-- `docs/OWNER_SECURITY_DECISIONS.md` — "Revoke anonymous access; service-role-only
-- backend architecture", recorded 2026-09-24. This is the whole of Decision 1. It
-- does NOT implement Decision 1b (the `/api/geofence/evaluate` split), the geo-cache
-- TTL, the historical fence cleanup, or any pricing-route authentication change.
--
-- The boundary this installs:
--
--   CLIENT -> authorised application route -> BACKEND (service_role) -> DATABASE
--
-- and NOT
--
--   ANONYMOUS CALLER -> PostgREST -> geo_fences -> geometry + surcharge
--
-- The backend connects as `service_role`, which has BYPASSRLS and holds its own
-- `arwdDxt` privileges on every table below, so nothing a route does changes. The
-- access removed here is surface, not function: no application client in this
-- repository opens a Supabase session — `createClient`, `@supabase/supabase-js` and
-- `supabase_flutter` appear only under `backend/` — and every screen that shows a
-- boundary goes through an admin-gated REST route.
--
-- Scope: the six tables of Section A of `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql`
-- — geo_fences, surge_zones, pricing_configurations, platform_settings, promotions,
-- notification_templates. Section B (merchants, products, merchant_grocery_inventory,
-- master_grocery_catalog, advertisements — the public storefront) is deliberately
-- absent: that half was never an owner decision, and its exclusion is not a claim
-- that `merchants.lat/lng` being anonymous-readable is acceptable. It is recorded as
-- an open question in the Phase 1 report.
--
-- WHY BOTH HALVES ARE NEEDED, AND WHY THEY ARE NOT REDUNDANT
--
--   * The `DROP POLICY` half removes the door. Each of these tables carries a read
--     policy with no `TO` clause, which in PostgreSQL means "every role", so `anon`
--     matched it and saw active rows. Dropping a policy rather than leaving it
--     stranded matters because no table here uses `FORCE ROW LEVEL SECURITY` (0 of 51
--     do), so a surviving policy plus any future re-grant reopens the read with no
--     decision attached to it.
--   * The `REVOKE` half removes the privilege. With RLS enabled and no matching
--     policy, rows are already invisible to `anon`; the grant alone leaks no row. It
--     is removed anyway so that the refusal is `42501 permission denied` at the
--     privilege check — before the query is planned — rather than a `200` with an
--     empty array that reads as "there is no geography here" to a curious caller and
--     as "this is safe" to a future developer.
--
-- MEASURED, not assumed, before writing this file (local Docker Supabase,
-- 2026-09-24, `supabase_db_nabin`):
--
--   * `anon` and `authenticated` each saw every row of every table below: 447
--     geo_fences (all 447 with `coordinates`, 257 with `center_lat`/`radius_meters`),
--     445 surge_zones, 6 pricing_configurations, 21 platform_settings, 659 promotions,
--     17 notification_templates — over PostgREST with the anon key, and also with no
--     key at all on this local Kong.
--   * `relacl` on all six is `anon=r/postgres, authenticated=r/postgres` — table-level
--     SELECT only. No column-level grant exists, which is why one `REVOKE ALL` per
--     table is sufficient; a column-level grant survives a table-level REVOKE in
--     PostgreSQL, and had one existed this file would have needed to revoke it by
--     name. Step 4 below asserts that no such grant is left, on any database, so a
--     hosted environment with a different grant shape fails loudly instead of
--     half-closing.
--   * `service_role` holds `arwdDxt` (select/insert/update/delete/truncate) plus
--     BYPASSRLS on every one of the six, so the backend's reads and its admin writes
--     both continue.
--
-- ROLLBACK: forward-only file, as with 027. A `DROP POLICY` is a schema change, so
-- the rollback is a `pg_dump` taken before applying and a restore after. If a restore
-- is unavailable the manual path is to re-create the six dropped policies verbatim
-- from their originals — 011 §6 for `p_read_active_geofences` /
-- `p_read_active_surge_zones` / `p_read_pricing_configs`, and the quoted names below
-- for the other three — and re-grant SELECT to `anon, authenticated`.
--
-- APPLIED TO: the local Docker database only, on 2026-09-24. Nothing in this file has
-- been executed against the hosted test project or production, and this file makes no
-- claim about either.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. RESTATE THE INTENT: these tables are policy-governed.
--    Already true on all six, and on all 51 public tables, so this is a
--    no-op kept in the file so the desired state is written down.
-- -------------------------------------------------------------------------
ALTER TABLE public.geo_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

-- -------------------------------------------------------------------------
-- 2. DROP THE PUBLIC READ POLICIES — the mechanism the anonymous read travels on.
--    Each is `FOR SELECT` with no `TO` clause, i.e. every role including `anon`.
--    The `p_service_role_*` policies from 011 §6 are left alone; they are what
--    the writes were already governed by, and service_role bypasses them anyway.
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS p_read_active_geofences ON public.geo_fences;
DROP POLICY IF EXISTS p_read_active_surge_zones ON public.surge_zones;
DROP POLICY IF EXISTS p_read_pricing_configs ON public.pricing_configurations;
DROP POLICY IF EXISTS "Public read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Public view active promotions" ON public.promotions;
DROP POLICY IF EXISTS p_templates_public_read ON public.notification_templates;

-- -------------------------------------------------------------------------
-- 3. REVOKE THE PRIVILEGE from the two roles an application caller can present,
--    and restate what the backend's own role keeps.
-- -------------------------------------------------------------------------
REVOKE ALL ON public.geo_fences FROM anon, authenticated;
REVOKE ALL ON public.surge_zones FROM anon, authenticated;
REVOKE ALL ON public.pricing_configurations FROM anon, authenticated;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
REVOKE ALL ON public.promotions FROM anon, authenticated;
REVOKE ALL ON public.notification_templates FROM anon, authenticated;

-- service_role keeps what it already has. Restated so this file is a complete
-- description of the intended grant state rather than a diff. Note this is not a
-- ceiling: the backend also INSERTs, UPDATEs and DELETEs geo_fences, surge_zones,
-- pricing_configurations, platform_settings, promotions and notification_templates,
-- and those privileges come from the `arwdDxt` entries already in relacl.
GRANT SELECT ON public.geo_fences TO service_role;
GRANT SELECT ON public.surge_zones TO service_role;
GRANT SELECT ON public.pricing_configurations TO service_role;
GRANT SELECT ON public.platform_settings TO service_role;
GRANT SELECT ON public.promotions TO service_role;
GRANT SELECT ON public.notification_templates TO service_role;

-- -------------------------------------------------------------------------
-- 4. ASSERT THE BOUNDARY WAS ACTUALLY INSTALLED.
--    migrate.js runs one file in one transaction, so a failure here leaves the
--    previous grant state untouched rather than a half-locked store. Two checks,
--    both written to catch a difference between this database and a hosted one
--    rather than to re-confirm what the statements above just did:
--      a. no table-level SELECT left for anon/authenticated;
--      b. no column-level SELECT left either, which a table-level REVOKE would not
--         have removed had one existed (see the header).
-- -------------------------------------------------------------------------
DO $$
DECLARE
  tbl            text;
  col            text;
  bad_table      text[] := '{}';
  bad_column     text[] := '{}';
  role_name      text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH tbl IN ARRAY ARRAY[
      'geo_fences', 'surge_zones', 'pricing_configurations',
      'platform_settings', 'promotions', 'notification_templates'
    ] LOOP
      IF has_table_privilege(role_name, format('public.%I', tbl), 'SELECT') THEN
        bad_table := bad_table || format('%s.%s', role_name, tbl);
      END IF;
      FOR col IN
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = tbl
      LOOP
        -- Only a column-level grant can make this true once the table-level grant is
        -- gone, because has_column_privilege() inherits from the table.
        IF NOT has_table_privilege(role_name, format('public.%I', tbl), 'SELECT')
           AND has_column_privilege(role_name, format('public.%I', tbl), col, 'SELECT') THEN
          bad_column := bad_column || format('%s.%s.%s', role_name, tbl, col);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  IF array_length(bad_table, 1) IS NOT NULL OR array_length(bad_column, 1) IS NOT NULL THEN
    RAISE EXCEPTION
      '029 aborted: anonymous/authenticated read access survived. table-level=% column-level=%',
      coalesce(array_to_string(bad_table, ','), 'none'),
      coalesce(array_to_string(bad_column, ','), 'none');
  END IF;

  RAISE NOTICE '029 verified: anon and authenticated hold no table-level and no column-level READ on geo_fences, surge_zones, pricing_configurations, platform_settings, promotions or notification_templates.';
END
$$;

-- -------------------------------------------------------------------------
-- 5. WHAT THIS DOES NOT DO, recorded so nobody reads more into it.
--    * It does not protect a rider from a wrong price. The backend is service_role,
--      which bypasses RLS entirely, so `USING (is_active = TRUE)` has never been what
--      filtered a fence out of a quote. Express is that filter (GeoPolicyService),
--      and it stays the control. This file removes an information leak.
--    * It does not gate `/api/geofence/evaluate` or `POST /api/pricing/estimate`.
--      Those are Decision 1b and Clarification 5, separate phases.
--    * It leaves two PUBLIC write policies in place — "Admins write platform
--      settings" on platform_settings and "Admins manage promotions" on promotions.
--      They are not read doors, and the REVOKE above removes the privilege that made
--      them reachable to anon/authenticated. Narrowing them is not part of Decision 1.
--    * `notifications`-style realtime subscriptions on the six tables were checked
--      and none exists, so no subscription changes colour here.
-- -------------------------------------------------------------------------

-- Let PostgREST drop its cached view of the catalog so the new grant state is what
-- the wire answers with, not the schema cache from before this transaction.
NOTIFY pgrst, 'reload schema';
