-- =============================================================================
-- NABIN PLATFORM — DURABLE PUBLIC MEDIA ASSET METADATA
-- Migration: 044_media_assets.sql
-- Status: LOCAL VERIFICATION ONLY.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION DATABASE.
-- =============================================================================
-- Why this table exists (measured, not assumed):
--   `db.saveMediaAsset` / `getMediaAsset` / `deleteMediaAsset`
--   (backend/src/database.js:9379-9461) read and write a plain in-memory array
--   `this.mediaAssets`. `persistentStore` (database/persistentStore.js:29,53,91)
--   returns `null` on load and no-ops on save whenever `isProduction ||
--   isLivePostgres`, and no `media_assets` relation existed anywhere in
--   `supabase/migrations` (grep of the whole tree hit only two docs). So under
--   live PostgreSQL a media asset's ownership record exists only in the
--   process's RAM and is gone at the next restart.
--
--   That is exactly the defect `DELETE /api/media/*` (server.js:9933) depends on:
--   its owner check is guarded by `if (existing && !isAdmin)`, so when the
--   durable record is absent — which is *always*, under live Postgres — the
--   authorisation is skipped and the provider delete runs on any bearer's
--   say-so. A media permission cannot be decided from a record that does not
--   survive the process that reads it. This migration gives DELETE the durable
--   row its check was already written to consult.
--
-- Scope discipline (additive only):
--   CREATE TABLE / CREATE INDEX / COMMENT / RLS. Nothing is dropped, renamed or
--   altered on any existing table, and no existing route's behaviour is changed
--   here. Wiring the endpoints onto this repository is Objective 3, not this file.
--
-- Conventions copied from the existing schema, not invented:
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid()      (001, every table)
--   created_at/updated_at TIMESTAMPTZ DEFAULT NOW()    (001)
--   status/type as VARCHAR + CHECK, not a PG enum      (031's note: the only
--       enums in this database are Supabase auth ones)
--   provider+public_id as the durable dedup identity   (the in-memory upsert
--       already keys on public_id/id; database.js:9406)
--   RLS enabled with NO permissive policy, writes granted to service_role only
--       (031/042 pattern: ENABLE ROW LEVEL SECURITY + GRANT, never USING(true));
--       the backend reaches this table only through MediaAssetRepository's
--       service-role client, which carries BYPASSRLS on this stack.
--
-- Deliberate design choices, recorded because they are safety decisions:
--   * `owner_type`+`owner_id` is polymorphic and carries NO foreign key. Media
--     belongs to five different principals (customer/driver/merchant/grocery/
--     platform), so a single FK would be wrong, and owner_id values are text in
--     the current model ('usr_1', 'DRV-101', 'rest_1'). This matches how the
--     durable audit layer already stores a cross-entity reference as text
--     (`audit_logs.target_entity_id`); authorisation is decided server-side from
--     the authenticated session, never trusted from these columns alone.
--   * `tenant_id` is a nullable scope column, not an FK, for the same reason:
--     it lets a merchant/grocery read be scoped to one store without forcing a
--     referential link onto whichever entity happens to own the store.
--   * `owner_id`/`tenant_id` are VARCHAR, not UUID, so a PUBLIC asset (owner
--     NULL by design) and legacy text identities both fit without a cast.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. media_assets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Provider-qualified identity. The unique key is (provider, public_id), not
    -- public_id alone: Cloudinary and Supabase Storage can hand out colliding
    -- public paths, and the durable row must never silently overwrite the other
    -- provider's asset.
    provider VARCHAR(40) NOT NULL DEFAULT 'cloudinary',
    public_id VARCHAR(255) NOT NULL,

    -- Who the asset belongs to, decided from the authenticated principal at
    -- write time. NULL owner_id is a legal PUBLIC asset (seed/demo imagery,
    -- platform banners); it is NOT an "unknown owner" the DELETE route may use
    -- to skip authorisation.
    --
    -- The vocabulary below is the one the existing write routes already produce
    -- (server.js: CUSTOMER/DRIVER profile photos, VEHICLE photos, RESTAURANT logo/cover,
    -- MENU_ITEM dish photos, GROCERY_PRODUCT photos, PARCEL_PROOF), plus MERCHANT/ADMIN/
    -- PUBLIC/GROCERY for the generic /api/media/upload and the seed/demo assets. It is a
    -- descriptor recorded from the session, never a client-authorised claim — the
    -- authorisation answer stays on owner_id against the session principal. Widened from
    -- the original six-value list because that list rejected the descriptors the routes
    -- legitimately write, which would have failed every driver-vehicle, restaurant, menu
    -- and grocery photo upload closed on a live database.
    owner_type VARCHAR(30) NOT NULL DEFAULT 'PUBLIC'
        CHECK (owner_type IN ('CUSTOMER', 'DRIVER', 'VEHICLE', 'RESTAURANT', 'MENU_ITEM',
                              'GROCERY', 'GROCERY_PRODUCT', 'PARCEL_PROOF', 'MERCHANT',
                              'ADMIN', 'PUBLIC')),
    owner_id VARCHAR(120),

    -- Optional tenant scope for merchant/grocery reads so one store cannot list
    -- another's assets. No FK by design (see header).
    tenant_id VARCHAR(120),

    media_type VARCHAR(20) NOT NULL DEFAULT 'IMAGE'
        CHECK (media_type IN ('IMAGE', 'VIDEO')),
    resource_type VARCHAR(20) NOT NULL DEFAULT 'image',
    format VARCHAR(20),
    secure_url TEXT,
    optimized_urls JSONB NOT NULL DEFAULT '{}'::jsonb,
    folder VARCHAR(255),
    tags JSONB NOT NULL DEFAULT '[]'::jsonb,
    width INTEGER,
    height INTEGER,
    bytes BIGINT NOT NULL DEFAULT 0 CHECK (bytes >= 0),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_media_assets_provider_public_id UNIQUE (provider, public_id)
);

COMMENT ON TABLE public.media_assets IS
    'Durable metadata for uploaded media assets. Backs the ownership decision DELETE /api/media/* already reads: an asset with no row here is unowned and must be refused, never deleted on a bearer''s word alone.';
COMMENT ON COLUMN public.media_assets.owner_id IS
    'Text identity from the authenticated session (users/drivers/merchants/grocery). NULL means a deliberate PUBLIC asset, not an unattributed one. Never trusted from client input as authorisation on its own.';
COMMENT ON COLUMN public.media_assets.tenant_id IS
    'Store/scope id for merchant and grocery assets so a read can be scoped to one tenant. Nullable; no FK by design (polymorphic ownership).';

-- ---------------------------------------------------------------------------
-- 2. Indexes (only those not already implied by the UNIQUE constraint)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_media_assets_owner ON public.media_assets (owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_tenant ON public.media_assets (tenant_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_folder ON public.media_assets (folder);
CREATE INDEX IF NOT EXISTS idx_media_assets_created ON public.media_assets (created_at DESC);
-- (provider, public_id) already carries the unique index above; lookups by
-- public_id — the shape DELETE and getMediaAsset use — are served by it.

-- ---------------------------------------------------------------------------
-- 3. RLS - the 031/042 pattern: enabled, no permissive policy, service_role only.
--    anon and authenticated can neither read nor write this table; the backend
--    reaches it exclusively through MediaAssetRepository's service-role client,
--    and every ownership/tenant decision stays server-side on the authenticated
--    principal rather than on a client-supplied owner_id or public_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.media_assets FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_assets TO service_role;
