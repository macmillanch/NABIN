-- =========================================================================
-- PROPOSED 028 — LOCK THE PRICING AND COMMERCE READS TO service_role
-- =========================================================================
--
-- THIS FILE HAS NOT BEEN APPLIED. It is deliberately in `docs/proposed/`, not
-- in `supabase/migrations/`, which is the directory `backend/scripts/migrate.js`
-- resolves (its default; `MIGRATIONS_DIR` overrides it). Nothing in this
-- repository has executed a statement below, and nothing should until the
-- decision recorded at the end of each section has been made by a human.
--
-- Why it exists: Order E, Phase 3 measured what the anonymous publishable key
-- can read directly from PostgREST, bypassing the backend entirely. The
-- preferred architecture is CLIENT -> BACKEND -> GeoPolicyService -> DATABASE,
-- and today a client can skip all three hops with one HTTP call.
--
-- =========================================================================
-- 1. WHAT WAS MEASURED (local Docker Supabase, 2026-09-23/24)
-- =========================================================================
--
-- Method: one `select('*', { count: 'exact' }).limit(2)` per table over 40
-- tables, issued with the anon key against http://127.0.0.1:54321 — never as
-- service_role. Reproduce with the scratch probe in this pass's notes.
--
--   table                       anon reads   rows at rest   what that gives away
--   geo_fences                  YES          447            every ACTIVE boundary's geometry
--                                                             (coordinates / center+radius),
--                                                             surcharge_amount, surge_multiplier,
--                                                             allowed_services, allowed_vehicles,
--                                                             operating_hours
--   surge_zones                 YES          445            every ACTIVE rule's multiplier,
--                                                             window, priority and reason
--   pricing_configurations      YES          6              base_fare, per_km_rate, per_min_rate,
--                                                             min_fare, booking_fee,
--                                                             commission_percent,
--                                                             global_surge_multiplier
--   platform_settings           YES          21             setting_key/value pairs, incl. the
--                                                             feature-flag and integration namespace
--   promotions                  YES          642            code, discount_type/value, caps,
--                                                             usage counts
--   merchants                   YES          39             incl. phone, fssai_license,
--                                                             wallet_balance, address, lat/lng
--   products                    YES          26             prices, stock, SKU
--   merchant_grocery_inventory  YES          14             store_price, stock_quantity
--   master_grocery_catalog      YES          3              catalogue rows
--   notification_templates      YES          17             title/body templates
--   advertisements              YES          1              campaign rows
--
--   31 of the 40 tables probed answer an anon SELECT at all. Of those, the
--   tables above return rows; the rest return zero rows because their policy
--   filters everything (users, drivers, jobs, payments, ledger_entries,
--   support_tickets, audit_logs, ...). The other 9 refuse with 42501
--   `permission denied` — campaigns, campaign_assets, campaign_offers,
--   campaign_messages, campaign_themes, backend_sessions, dispatch_offers,
--   journal_lines, payment_webhooks — and every one of those refusals is what
--   migration 027 §6 did on purpose:
--
--     ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
--     REVOKE ALL ON ... FROM anon, authenticated;
--     GRANT SELECT ON ... TO service_role;
--
--   So the pattern this proposal follows is not invented here. It is the
--   pattern already in the repository, and the 42501s prove it works.
--
-- Two facts make the change safe for the backend, and both were verified rather
-- than assumed:
--
--   a. `service_role` has BYPASSRLS (`rolbypassrls = true`) and holds its own
--      SELECT/INSERT/UPDATE/DELETE grants on every table below. Revoking from
--      `anon` and `authenticated` therefore cannot blind the Express server,
--      which connects as service_role.
--   b. No client in this repository opens a Supabase session. `createClient`,
--      `@supabase/supabase-js` and `supabase_flutter` appear only under
--      `backend/` (the server itself and its test probes). `admin-web`,
--      `customer-web`, `restaurant-merchant-web`, `grocery-merchant-web` and
--      `mobile/` talk to the platform only through the REST API. Every screen
--      that shows a boundary calls `GET /api/admin/geofences`, which is
--      admin-gated (geo_adversarial_test.js SEC-02: 401 unauthenticated).
--
--   i.e. the anon grants are not used by anything. They are surface, not
--   function.
--
-- One measurement is worth reading twice: the census above was taken while
-- `test_suite.js` was running, and the anon key saw 449 `geo_fences` rows where
-- the resting store holds 447. That is the Phase 7 test-leak finding visible
-- from the outside — the residue a suite leaves behind is residue an anonymous
-- caller can read.

-- =========================================================================
-- 2. SECTION A — GEOGRAPHY AND MARGIN. DECISION IS ALREADY DEFINED.
-- =========================================================================
--
-- Scope: geo_fences, surge_zones, pricing_configurations, platform_settings,
-- promotions, notification_templates.
--
-- Expected behaviour here is not an open question. Geography is a pricing
-- input and GeoPolicyService is its only authority; the operator's rate card is
-- margin; a feature flag is server-side control. None of them is client data,
-- and no client reads them directly (fact 1b above). This section changes no
-- behaviour anyone can observe: every route keeps answering exactly as it does
-- now, because every route answers from the backend.
--
-- The existing read policies are granted to `public` with no `TO` clause, which
-- in PostgreSQL means "to every role", so they are the door an anonymous caller
-- walks through. They are dropped here rather than left in place because a
-- policy that survives its grant is a loaded gun: the next migration that
-- re-grants SELECT — and Supabase's defaults do exactly that on new tables —
-- reopens the read without anyone deciding to.
--
-- AFTER APPLYING, geo_adversarial_test.js SEC-07-KNOWN-GAP will fail, which is
-- the behaviour that check's own text asks for: rewrite it to assert the 42501
-- refusal instead of the 200.

ALTER TABLE public.geo_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_read_active_geofences ON public.geo_fences;
DROP POLICY IF EXISTS p_read_active_surge_zones ON public.surge_zones;
DROP POLICY IF EXISTS p_read_pricing_configs ON public.pricing_configurations;
DROP POLICY IF EXISTS "Public read platform settings" ON public.platform_settings;
DROP POLICY IF EXISTS "Public view active promotions" ON public.promotions;
DROP POLICY IF EXISTS p_templates_public_read ON public.notification_templates;

REVOKE ALL ON public.geo_fences FROM anon, authenticated;
REVOKE ALL ON public.surge_zones FROM anon, authenticated;
REVOKE ALL ON public.pricing_configurations FROM anon, authenticated;
REVOKE ALL ON public.platform_settings FROM anon, authenticated;
REVOKE ALL ON public.promotions FROM anon, authenticated;
REVOKE ALL ON public.notification_templates FROM anon, authenticated;

-- service_role keeps what it already has; restated so the file is a complete
-- description of the intended grant state rather than a diff.
GRANT SELECT ON public.geo_fences TO service_role;
GRANT SELECT ON public.surge_zones TO service_role;
GRANT SELECT ON public.pricing_configurations TO service_role;
GRANT SELECT ON public.platform_settings TO service_role;
GRANT SELECT ON public.promotions TO service_role;
GRANT SELECT ON public.notification_templates TO service_role;

-- NOTE ON WHAT THIS DOES NOT FIX, and why it is out of scope here:
-- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` with no policies denies every
-- non-BYPASSRLS role, so an `authenticated` customer also loses these reads.
-- That is intended. It does not, however, protect a rider from a wrong price:
-- the backend connects as service_role, which bypasses RLS entirely, so
-- `USING (is_active = TRUE)` has never been what filtered a fence out of a
-- quote. Express is that filter (GeoPolicyService), and it stays the control
-- either way. This section removes an information leak, not a pricing hole.

-- =========================================================================
-- 3. SECTION B — THE PUBLIC STOREFRONT. DECISION IS OPEN. DO NOT APPLY.
-- =========================================================================
--
-- Scope: merchants, products, merchant_grocery_inventory,
-- master_grocery_catalog, advertisements.
--
-- These reads look public on purpose: a shopper browsing restaurants before
-- signing in is a real product journey, and the policies say so
-- (`USING (is_open = TRUE)`, `USING (is_available = TRUE)`). Whether the apps
-- are meant to keep reading them straight from PostgREST — they currently do
-- not — is a product decision about the storefront, not a security defect, so
-- it is NOT made in this file. Two things are certain regardless of that
-- decision, and both are recorded here rather than acted on:
--
--   1. `merchants` exposes `phone`, `fssai_license` and `wallet_balance` to an
--      anonymous caller. A public directory needs a name, a cuisine, an
--      address and a photo. It does not need a merchant's phone number, and a
--      wallet balance in particular is a financial field of a counterparty
--      appearing in an unauthenticated response. If Section B stays open, this
--      column set must be narrowed, and the narrow way is a column grant, not a
--      policy:
--
--        REVOKE SELECT ON public.merchants FROM anon, authenticated;
--        GRANT SELECT (id, name, merchant_type, address, lat, lng, is_open,
--                      rating, created_at, updated_at)
--          ON public.merchants TO anon, authenticated;
--
--      PostgREST honours column-level privileges and will not project a column
--      the role cannot read, so `select=*` then returns the allowed set rather
--      than refusing. (Untested here — apply on a scratch database and confirm
--      before relying on it.)
--
--   2. `merchant_grocery_inventory`'s policy admits `auth.uid() = merchant_id`,
--      which is a merchant-app path; if the merchant apps keep reading it
--      directly, the same treatment as above applies to `store_price` and
--      `stock_quantity` for the anon role only, not for `authenticated`.
--
-- The rest of the storefront columns are ordinary catalogue data and the
-- decision about them is genuinely open. Nothing below this line is proposed
-- for application in this pass.

-- =========================================================================
-- 4. HOW TO VERIFY, IN THIS ORDER, WHEN SOMEONE DECIDES TO APPLY SECTION A
-- =========================================================================
--
--   1. Apply to the LOCAL Docker database only:
--        psql -v ON_ERROR_STOP=1 -f docs/proposed/028_geo_and_commerce_reads_service_role_only.sql
--      (via `docker exec -i supabase_db_nabin psql -U postgres -d postgres`)
--   2. Re-run the anon census. Expected: geo_fences, surge_zones,
--      pricing_configurations, platform_settings, promotions and
--      notification_templates all answer 42501 `permission denied`, and every
--      table that returned 0 rows still returns 0 rows rather than erroring in
--      a new way.
--   3. Restart the backend and confirm the boot line still reports the geometry
--      it did before (447 geofences, 445 surge zones at rest). A service_role
--      regression shows up HERE, not in step 2.
--   4. Rewrite geo_adversarial_test.js SEC-07-KNOWN-GAP to assert the refusal,
--      then run, in order: geo_policy_test.js, geo_adversarial_test.js,
--      test_suite.js, restart_test.js, auth_failclosed_test.js,
--      session_reconcile_pagination_test.js, boot_mirror_read_test.js.
--   5. Only then consider the hosted test project — and separately, on its own
--      approval, production. This file makes no claim about either.
--
-- =========================================================================
-- 5. ROLLBACK
-- =========================================================================
-- Forward-only file, as with 027. To put Section A back on a local database,
-- re-create the six dropped policies verbatim from their originals — 011 §6 for
-- the geo trio (p_read_active_geofences / p_read_active_surge_zones /
-- p_read_pricing_configs), and the named policies quoted in section 2 above for
-- the other three — and re-grant SELECT to anon and authenticated. Because a
-- DROP POLICY is a schema change, take a pg_dump of the database before
-- applying, and treat the restore as the rollback rather than this comment.
