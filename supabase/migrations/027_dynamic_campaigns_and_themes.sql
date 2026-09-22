-- 027: DYNAMIC CAMPAIGNS, FESTIVAL THEMES AND CAMPAIGN ASSETS
-- Campaigns (a festival, a launch, a weekend sale) have so far had to be assembled
-- out of three unrelated stores: an advertisement row per banner, a promotion row per
-- coupon, and a platform_settings blob per colour. None of them could answer "which
-- campaign is running right now, and in what order should two overlapping ones win",
-- and a campaign had no identity, so nothing could say that a banner, a coupon and a
-- palette belonged to the same Christmas.
--
-- This migration gives a campaign a row of its own and hangs the rest off it. Two
-- rules are deliberate:
--   1. STATUS IS INTERPRETED AGAINST THE SERVER CLOCK, NEVER A CLIENT'S. `status`
--      stores what an operator intended (DRAFT/SCHEDULED/ACTIVE/PAUSED/ARCHIVED);
--      EXPIRED is not stored at all, because a campaign that has run out is a fact
--      about time, not a decision. campaign_effective_status() derives the answer
--      from PostgreSQL's own now(), so no client and no cron job can advance or
--      delay a campaign, and an expired row can never be served as live.
--   2. NOTHING IS COPIED FROM THE TABLES IT REFERENCES. An offer points at a
--      promotions row, so discount arithmetic, per-user limits and usage caps stay
--      in the one place that the checkout path already enforces; an asset points at
--      a stored URL, so no second source of truth about a coupon appears.
--
-- No festival content is seeded: a campaign is an operator's decision, and inventing
-- one here would put fake production data into a real catalogue.
-- =========================================================================

-- 1. THE CAMPAIGN ITSELF: identity, window, ordering, targeting.
CREATE TABLE IF NOT EXISTS public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    -- Operator intent only. ACTIVE here means "live once its window opens", not
    -- "live right now"; see campaign_effective_status().
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
    priority INTEGER NOT NULL DEFAULT 0,
    -- Empty means every service; a campaign that names services targets only those.
    -- The vocabulary is the one the rest of the platform already uses.
    service_types TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    -- A second, non-destructive off switch: pausing preserves the schedule, while
    -- status='PAUSED' is an operator action and ARCHIVED is a closed book.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    description TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT campaigns_window_ordered CHECK (ends_at > starts_at),
    CONSTRAINT campaigns_service_vocabulary CHECK (
        service_types <@ ARRAY['RIDE', 'FOOD', 'GROCERY', 'PARCEL']::TEXT[]
    ),
    -- Two campaigns cannot share a code and differ only by case, because the code is
    -- what a client asks for.
    CONSTRAINT campaigns_code_shape CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$')
);

CREATE INDEX IF NOT EXISTS idx_campaigns_window
    ON public.campaigns (status, starts_at, ends_at);

-- The tie-break an operator reasons about: highest priority first, then the most
-- recent schedule. Partial, because an archived campaign is history rather than a
-- candidate.
CREATE INDEX IF NOT EXISTS idx_campaigns_live_order
    ON public.campaigns (priority DESC, starts_at DESC)
    WHERE status <> 'ARCHIVED';

CREATE INDEX IF NOT EXISTS idx_campaigns_service_types
    ON public.campaigns USING GIN (service_types);

-- 2. THEMES: the palette and marks a campaign paints with.
CREATE TABLE IF NOT EXISTS public.campaign_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL
        CHECK (kind IN ('LOGO', 'WORDMARK', 'BANNER', 'PROMOTIONAL_IMAGE', 'POPUP_BACKGROUND', 'SPLASH', 'FAVICON')),
    url TEXT NOT NULL CHECK (url ~ '^https?://'),
    -- The Cloudinary public id is kept so a campaign can be re-issued or purged
    -- without guessing which stored object a URL came from.
    cloudinary_public_id TEXT,
    alt_text VARCHAR(200),
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_assets_lookup
    ON public.campaign_assets (campaign_id, kind, locale);

CREATE TABLE IF NOT EXISTS public.campaign_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- One theme per campaign: a campaign that wants two looks is two campaigns.
    campaign_id UUID UNIQUE NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- token name -> #RRGGBB. The server allow-lists both halves before publishing a
    -- word of it (AppConfigService.buildThemeSection already does exactly this for the
    -- global palette), so an unknown token or an rgb() string cannot reach a client.
    palette JSONB NOT NULL DEFAULT '{}'::jsonb,
    logo_asset_id UUID REFERENCES public.campaign_assets(id) ON DELETE SET NULL,
    wordmark_asset_id UUID REFERENCES public.campaign_assets(id) ON DELETE SET NULL,
    splash_asset_id UUID REFERENCES public.campaign_assets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. OFFERS: a campaign's coupons, by reference.
CREATE TABLE IF NOT EXISTS public.campaign_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- RESTRICT, not CASCADE: deleting a campaign must not silently delete a coupon
    -- that other campaigns or the checkout history still reference.
    promotion_id UUID NOT NULL REFERENCES public.promotions(id) ON DELETE RESTRICT,
    -- Which service the copy is shown against. Independent of the promotion's own
    -- service_type so a campaign can offer the same coupon on two surfaces.
    service_type VARCHAR(30) NOT NULL
        CHECK (service_type IN ('RIDE', 'FOOD', 'GROCERY', 'PARCEL')),
    copy VARCHAR(150),
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT campaign_offers_once_per_campaign UNIQUE (campaign_id, promotion_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_offers_lookup
    ON public.campaign_offers (campaign_id, service_type, priority DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_offers_promotion
    ON public.campaign_offers (promotion_id);

-- 4. MESSAGES: what a campaign says, and where it is allowed to say it.
CREATE TABLE IF NOT EXISTS public.campaign_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    kind VARCHAR(20) NOT NULL
        CHECK (kind IN ('ANNOUNCEMENT', 'POPUP', 'INLINE_BANNER', 'TOAST')),
    title VARCHAR(150) NOT NULL,
    body TEXT NOT NULL,
    -- Which surface may render it, so a driver-app prompt cannot be repurposed as a
    -- customer checkout interrupt.
    surface VARCHAR(40) NOT NULL DEFAULT 'CUSTOMER_HOME',
    trigger_event VARCHAR(30) NOT NULL DEFAULT 'APP_OPEN'
        CHECK (trigger_event IN ('APP_OPEN', 'HOME', 'POST_TRIP', 'IDLE', 'CART')),
    dismissible BOOLEAN NOT NULL DEFAULT TRUE,
    -- show_once is enforced per device by the client; the server only publishes the
    -- instruction, and an undisposable message stays within its campaign window.
    show_once BOOLEAN NOT NULL DEFAULT FALSE,
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_messages_lookup
    ON public.campaign_messages (campaign_id, kind, surface, priority DESC);

-- =========================================================================
-- 5. EFFECTIVE STATUS, RESOLVED BY THE SERVER CLOCK
-- =========================================================================

CREATE OR REPLACE FUNCTION public.campaign_effective_status(
    p_status VARCHAR,
    p_is_active BOOLEAN,
    p_starts_at TIMESTAMPTZ,
    p_ends_at TIMESTAMPTZ,
    p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS VARCHAR
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
        -- An operator decision always outranks the clock: a paused or drafted
        -- campaign does not become live just because its window arrived.
        WHEN p_status IN ('DRAFT', 'PAUSED', 'ARCHIVED') THEN p_status
        WHEN p_is_active IS FALSE THEN 'PAUSED'
        -- Not stored, because it is not a decision. Reopening a window that has
        -- passed is impossible: an expired campaign must be re-dated by an operator.
        WHEN p_at >= p_ends_at THEN 'EXPIRED'
        WHEN p_at < p_starts_at THEN 'SCHEDULED'
        ELSE 'ACTIVE'
    END;
$$;

-- The candidates for "what is live right now", in the order a client should use them.
-- Winning is decided in one place so the config feed, the admin preview and any future
-- surface cannot disagree about which campaign a customer sees.
CREATE OR REPLACE FUNCTION public.resolve_live_campaigns(
    p_service_type TEXT DEFAULT NULL,
    p_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS TABLE (
    id UUID,
    code VARCHAR,
    name VARCHAR,
    priority INTEGER,
    effective_status VARCHAR,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    service_types TEXT[]
)
LANGUAGE sql
STABLE
AS $$
    SELECT c.id,
           c.code,
           c.name,
           c.priority,
           public.campaign_effective_status(
               c.status, c.is_active, c.starts_at, c.ends_at, p_at
           )::VARCHAR AS effective_status,
           c.starts_at,
           c.ends_at,
           c.service_types
    FROM public.campaigns c
    WHERE (
        p_service_type IS NULL
        -- A campaign with no service named is platform-wide.
        OR cardinality(c.service_types) = 0
        OR p_service_type = ANY (c.service_types)
    )
    AND public.campaign_effective_status(
        c.status, c.is_active, c.starts_at, c.ends_at, p_at
    ) = 'ACTIVE'
    ORDER BY c.priority DESC, c.starts_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.campaign_effective_status(VARCHAR, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_live_campaigns(TEXT, TIMESTAMPTZ) TO service_role;

-- =========================================================================
-- 6. ROW-LEVEL SECURITY
-- =========================================================================
-- Enabled with no policies, and revoked from the client roles outright: a campaign is
-- published through the backend (service_role), and the apps read it from
-- GET /api/app/config, which already resolves it against the server clock. An
-- authenticated customer has no reason to enumerate campaigns that have not started,
-- and an anonymous caller least of all.

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.campaigns FROM anon, authenticated;
REVOKE ALL ON public.campaign_assets FROM anon, authenticated;
REVOKE ALL ON public.campaign_themes FROM anon, authenticated;
REVOKE ALL ON public.campaign_offers FROM anon, authenticated;
REVOKE ALL ON public.campaign_messages FROM anon, authenticated;

GRANT SELECT ON public.campaigns TO service_role;
GRANT SELECT ON public.campaign_assets TO service_role;
GRANT SELECT ON public.campaign_themes TO service_role;
GRANT SELECT ON public.campaign_offers TO service_role;
GRANT SELECT ON public.campaign_messages TO service_role;

-- =========================================================================
-- ROLLBACK
-- =========================================================================
-- Forward-only file; to back out on a local database:
--   DROP FUNCTION IF EXISTS public.resolve_live_campaigns(TEXT, TIMESTAMPTZ);
--   DROP FUNCTION IF EXISTS public.campaign_effective_status(VARCHAR, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ);
--   DROP TABLE IF EXISTS public.campaign_messages;
--   DROP TABLE IF EXISTS public.campaign_offers;
--   DROP TABLE IF EXISTS public.campaign_themes;
--   DROP TABLE IF EXISTS public.campaign_assets;
--   DROP TABLE IF EXISTS public.campaigns;
-- Nothing in 001-026 depends on these tables and no column was altered on an existing
-- table, so the drop order above is the whole story. The app layer treats their
-- absence as "no campaign published" rather than as an error, so a rollback leaves the
-- clients on their bundled look instead of failing them.
