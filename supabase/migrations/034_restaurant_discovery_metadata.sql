-- =============================================================================
-- 034: Restaurant discovery metadata (cuisines, cover image, delivery window)
-- =============================================================================
-- Scope: three nullable columns on the existing `merchants` table, one GIN
-- index, and the removal of one default. Nothing is dropped, renamed or
-- backfilled. No existing row loses a value.
--
-- Why these three columns and no others (evidence, not preference):
--
--   `GET /api/restaurants` projects `cuisines`, `deliveryTime` and `rating`
--   (backend/src/server.js, projectRestaurantForCustomer), and the Customer app
--   renders all three on the restaurant card. Against live PostgreSQL the
--   schema supports none of them:
--     * `grep -rin cuisine supabase/migrations/` returns zero hits. There is no
--       cuisine, category or tag column on `merchants` at all.
--     * There is no image column on `merchants` either - the only `image_url`
--       columns in this domain are `products.image_url` and
--       `advertisements.image_url` (004), which are dish and campaign artwork,
--       not restaurant artwork.
--     * There is no delivery-time or delivery-window column anywhere on
--       `merchants`. `011` added `operating_hours VARCHAR(100) DEFAULT '24x7
--       Open'`, which is an opening window, not an ETA, and is not projected.
--   So every one of those three fields arrived as the projection's fallback:
--   `cuisines: []`, `deliveryTime: null`. The card could only ever be filled
--   from the in-memory fixture (`Dilli Darbar`, `cuisines: ['North Indian',
--   'Biryani', 'Mughlai'], deliveryTime: '25-35 mins'`), which is why the Food
--   slice was recorded as fixture-only.
--
-- The fourth field, `rating`, gets the opposite treatment - a DEFAULT removal,
-- not a column. `merchants.rating NUMERIC(3,2) DEFAULT 4.80` (001) means an
-- operator who never rated anyone is stored as 4.80, and a customer reading the
-- card reads that as a measured score. It is not one: this database has no
-- reviews table, no ratings table and no order-feedback column
-- (`supabase/migrations` = 57 tables, none of them reviews), so there is no
-- source a restaurant rating could be aggregated from. The column stays - a
-- deployed value is data and dropping it would destroy it - but a NEW row is
-- born NULL instead of born with a fabricated score. Existing rows keep what
-- they hold; the customer projection stops reading `rating` at all, so no row
-- (default or otherwise) reaches a customer card. Restoring a real rating needs
-- a real rating source, which is a domain decision, not a column.
--
-- Adding nullable columns would be dead schema if nothing could fill them, and
-- this repository already has one dead table (`advertisements`) to learn from.
-- These three ship with their write path in the same change:
-- `PATCH /api/merchant/:restaurantId/profile`, guarded by the merchant session,
-- the tenant match and `requireMerchantService('RESTAURANT')`, validated by
-- `services/restaurantProfileDomain.js`. A merchant declares what their kitchen
-- is; the app never guesses it.
--
-- Conventions copied from the existing schema, not invented:
--   ALTER TABLE public.<table> ADD COLUMN IF NOT EXISTS  (011, 024, 030)
--   status/text columns as VARCHAR/TEXT with CHECK, not enums (001)
--   idx_<table>_<qualifier> index naming                   (001:322-328)
--   COMMENT ON COLUMN for the contract a reader needs      (011, 031)
--
-- Deliberate choices worth a second read:
--   * `cuisines TEXT[]`, not a join table. The read is a containment test
--     (`@>`) on a short, self-declared label list with no per-cuisine
--     attributes; a many-to-many table would be three migrations and a
--     customer-visible taxonomy nobody owns. 12 elements max, enforced here and
--     at the API, so the card's one-line label and the filter wheel stay bounded.
--   * `standard_delivery_minutes SMALLINT`, not a `VARCHAR(20)` like the
--     fixture's '25-35 mins'. A string cannot be compared, sorted or rendered
--     without parsing, and the customer copy differs per locale. The merchant
--     declares ONE number: their normal kitchen-to-door window. The UI renders
--     it as `${n} min` and nothing else - there is no second delivery-time
--     algorithm here to conflict with the driver-side ETA.
--   * Both CHECKs are range/format bounds, not content judgements. Postgres
--     CHECK expressions cannot contain subqueries, so the per-element rules
--     (trimmed, non-empty, <=40 chars, no duplicates) live in the domain
--     validator that owns the only write path.
--   * Nullable with no default. A restaurant that has not declared its cuisine
--     shows no cuisine, which is the truth the card was built to tell.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS cuisines TEXT[],
    ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
    ADD COLUMN IF NOT EXISTS standard_delivery_minutes SMALLINT;

-- Bounds that hold for every writer, including a future bulk job or a direct
-- service-role write that skips the API. `cardinality()` is used rather than
-- `array_length()` because both NULL and '{}' must stay legal: an empty list
-- means "not declared", not "invalid".
ALTER TABLE public.merchants
    DROP CONSTRAINT IF EXISTS chk_merchants_cuisines_cardinality;
ALTER TABLE public.merchants
    ADD CONSTRAINT chk_merchants_cuisines_cardinality
    CHECK (cuisines IS NULL OR cardinality(cuisines) <= 12);

-- The URL is fetched by the customer's device, so a non-HTTP scheme in the
-- column is a bug at rest, not a display problem. The application validator
-- applies the same grammar, and the Flutter model drops anything that fails it
-- before it reaches `Image.network`.
ALTER TABLE public.merchants
    DROP CONSTRAINT IF EXISTS chk_merchants_cover_image_url_scheme;
ALTER TABLE public.merchants
    ADD CONSTRAINT chk_merchants_cover_image_url_scheme
    CHECK (
        cover_image_url IS NULL
        OR (cover_image_url ~ '^https?://' AND char_length(cover_image_url) <= 2048)
    );

-- 5 to 180 minutes: below a bike-and-kitchen realistic window above, and the
-- upper bound is the point at which "delivery time" stops being a promise
-- anyone should print on a card.
ALTER TABLE public.merchants
    DROP CONSTRAINT IF EXISTS chk_merchants_standard_delivery_minutes;
ALTER TABLE public.merchants
    ADD CONSTRAINT chk_merchants_standard_delivery_minutes
    CHECK (standard_delivery_minutes IS NULL
           OR (standard_delivery_minutes BETWEEN 5 AND 180));

-- ---------------------------------------------------------------------------
-- 2. No born-fabricated rating on new rows
-- ---------------------------------------------------------------------------
-- Definition change only: `DROP DEFAULT` touches no stored value, so this is
-- not a data migration and no row is rewritten. Rows inserted from now on hold
-- NULL until someone measures something.
--
-- Verified safe against the test suite: no link asserts a merchant rating
-- default (`grep -rn "4\.80\|4\.8" backend/*_test.js` matches the ride/parcel
-- fee fixtures, not `merchants.rating`).

ALTER TABLE public.merchants
    ALTER COLUMN rating DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Index for the containment filter
-- ---------------------------------------------------------------------------
-- `GET /api/restaurants?cuisine=Biryani` compiles to `cuisines @> ARRAY['Biryani']`.
-- A sequential scan is fine at current volume and wrong at marketplace volume,
-- and GIN is the access method for array containment.

CREATE INDEX IF NOT EXISTS idx_merchants_cuisines
    ON public.merchants USING GIN (cuisines);

-- ---------------------------------------------------------------------------
-- 4. Contract comments
-- ---------------------------------------------------------------------------

COMMENT ON COLUMN public.merchants.cuisines IS
    'Self-declared cuisine labels, merchant-owned, max 12. NULL means the merchant has not declared any: customer projections must render no cuisine rather than a guessed one. No cuisine taxonomy table exists in this schema.';
COMMENT ON COLUMN public.merchants.cover_image_url IS
    'Restaurant banner artwork served by the merchant, absolute http(s) URL, max 2048 chars. Never a dish image (products.image_url) and never a campaign image (advertisements.image_url). NULL means the card renders its letter plate.';
COMMENT ON COLUMN public.merchants.standard_delivery_minutes IS
    'The merchant''s normal kitchen-to-door window in whole minutes, 5-180, declared not measured. NULL means no delivery time may be shown. This is not an ETA for a specific order and not an SLA.';
COMMENT ON COLUMN public.merchants.rating IS
    'Legacy NUMERIC(3,2) column whose DEFAULT 4.80 was removed by 034. No reviews/ratings table exists in this schema, so no value here is an aggregate of customer feedback. Not projected to customers.';
