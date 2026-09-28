-- =============================================================================
-- 031: Dark Store foundation (Instamart fulfilment domain)
-- =============================================================================
-- DS-2. Scope: durable domain foundation only - tables, invariants, indexes,
-- RLS. No repository, no routes, no customer selection algorithm, no money.
--
-- Decisions taken from DS-1 evidence, not preference:
--   * Dark Store is a NEW entity. Nothing named dark_store exists in the local
--     schema (DS-1B: no table/column/enum/FK/function/view). `001` only had a
--     prose comment claiming grocery merchants are dark stores, and
--     `database.js` has `mcht_darkstore_1` in-memory seeds. Neither is durable.
--   * `merchant_type` is NOT touched: it stays RESTAURANT|GROCERY|HYBRID_BOTH
--     and no Dark Store value is added (decision 4). A merchant is not a dark
--     store, and existing GROCERY merchants are not converted (decisions 5,7).
--   * Operated by a merchant is OPTIONAL and explicit: `operated_by_merchant_id`
--     nullable FK, so a platform-operated store is NULL (decisions 8,9).
--     ON DELETE SET NULL, deliberately NOT CASCADE: losing the operator link
--     must never delete a fulfilment location or its stock history, and a
--     platform-operated store is a legal state by design.
--   * `merchant_grocery_inventory` and `master_grocery_catalog` stay exactly as
--     they are (decisions 10-12). Dark store inventory REFERENCES the existing
--     master catalog; no second product table, no copied product rows.
--   * Migration 030 is untouched and is not duplicated: no constraint here
--     touches merchant_grocery_inventory, and no chk_mgi_* name is reused.
--
-- Conventions copied from the existing schema, not invented:
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid()      (001, every table)
--   created_at/updated_at TIMESTAMPTZ DEFAULT NOW()    (001)
--   status as VARCHAR(30) + CHECK, not a PostgreSQL enum
--       (merchants.merchant_type, merchant_grocery_inventory.status; the only
--        enums in this database are Supabase auth ones)
--   money NUMERIC(10,2), geo NUMERIC(10,7)             (001)
--   UNIQUE(store, product) pairing                     (001 merchant_grocery_inventory)
--   RLS enabled with NO permissive policy, reads granted to service_role only
--       (029's pattern: `ENABLE ROW LEVEL SECURITY` + GRANT, never USING (true))
--
-- Deliberate divergence, recorded because it is a safety choice:
--   dark_store_inventory FKs use ON DELETE RESTRICT, not 001's CASCADE. Deleting
--   a store or a catalogue product must not silently erase stock rows; with
--   RESTRICT the delete fails loudly instead. Availability is never stored: it
--   is `stock_quantity - reserved_quantity`, enforced by CHECK so a reservation
--   can never exceed stock and the derived figure cannot diverge.
--
-- Additive only: CREATE TABLE / CREATE INDEX / COMMENT. Nothing is dropped,
-- renamed or altered on any existing table.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. dark_stores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dark_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    -- ACTIVE is the only status eligible to fulfil. DRAFT is unlaunched,
    -- PAUSED stops new fulfilment, CLOSED is a shutdown that can be reopened,
    -- ARCHIVED is terminal and must never fulfil again.
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED')),

    -- NULL by design: a platform-operated dark store has no merchant operator.
    -- ON DELETE SET NULL (never CASCADE) so the store survives losing its
    -- operator link. No GROCERY-type requirement is enforced here; that rule,
    -- if the business wants one, belongs in service authorisation.
    operated_by_merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,

    address TEXT NOT NULL,
    latitude NUMERIC(10, 7) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude NUMERIC(10, 7) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    service_radius_m INTEGER NOT NULL DEFAULT 3000
        CHECK (service_radius_m > 0 AND service_radius_m <= 100000),

    -- Operating window is stored as local wall-clock time in `timezone`; the
    -- eligibility decision is DS-3's, and it must read these through the
    -- store's own timezone rather than the server's.
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    opens_at TIME,
    closes_at TIME,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.dark_stores IS
    'Instamart fulfilment centre. Separate from merchants: a merchant is not a dark store, and existing GROCERY merchants were NOT converted. operated_by_merchant_id IS NULL means platform-operated.';
COMMENT ON COLUMN public.dark_stores.status IS
    'DRAFT/PAUSED/CLOSED/ARCHIVED are all ineligible to fulfil; ACTIVE is the only fulfilling status. Enforced in DS-3 selection, never by client input.';
COMMENT ON COLUMN public.dark_stores.service_radius_m IS
    'Metres. Customer-to-store eligibility must reuse GeoPolicyService conventions; no second geospatial framework.';

-- ---------------------------------------------------------------------------
-- 2. dark_store_inventory
-- ---------------------------------------------------------------------------
-- References the existing master catalog; no product data is duplicated here.
-- `sku` is intentionally ABSENT: master_grocery_catalog models no SKU or
-- variant axis today (name/category/subcategory/brand/standard_unit/pack_size),
-- so a sku column here would be a field nothing can validate against.
CREATE TABLE IF NOT EXISTS public.dark_store_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- RESTRICT, not CASCADE: stock rows must never vanish because a store or a
    -- catalogue row was deleted. The delete fails loudly instead.
    dark_store_id UUID NOT NULL REFERENCES public.dark_stores(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.master_grocery_catalog(id) ON DELETE RESTRICT,

    selling_price NUMERIC(10, 2) NOT NULL CHECK (selling_price > 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
    low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (dark_store_id, product_id),
    -- The invariant that makes availability derivable without storing it:
    -- available = stock_quantity - reserved_quantity can never be negative.
    CONSTRAINT chk_dsi_reserved_within_stock
        CHECK (reserved_quantity <= stock_quantity)
);

COMMENT ON CONSTRAINT chk_dsi_reserved_within_stock ON public.dark_store_inventory IS
    'A reservation can never exceed physical stock, so available = stock_quantity - reserved_quantity is always >= 0 and is never stored separately.';
COMMENT ON COLUMN public.dark_store_inventory.selling_price IS
    'Store-level sell price. Any order line must snapshot this value the way create_order_with_lines_atomic already snapshots store_price - never re-read it after the fact.';

-- ---------------------------------------------------------------------------
-- 3. dark_store_reservations
-- ---------------------------------------------------------------------------
-- Reservation ledger: the durable record of "stock promised but not yet
-- consumed", so reserve/release/consume is idempotent and auditable rather than
-- an in-place decrement. No money moves here (financial authority stays with the
-- existing journal/ledger layer).
CREATE TABLE IF NOT EXISTS public.dark_store_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dark_store_id UUID NOT NULL REFERENCES public.dark_stores(id) ON DELETE RESTRICT,
    inventory_id UUID NOT NULL REFERENCES public.dark_store_inventory(id) ON DELETE RESTRICT,

    -- order_id is deliberately UUID with NO foreign key in this phase. The
    -- existing `orders` model has no instamart fulfilment identity yet, and a
    -- RESTRICT/CASCADE choice made now against the wrong entity would be a
    -- destructive constraint to undo. DS-3 decides the real order linkage
    -- (order vs order line vs a dedicated instamart order row) with evidence.
    order_id UUID,

    quantity INTEGER NOT NULL CHECK (quantity > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED', 'CANCELLED')),
    -- Only an ACTIVE reservation consumes reserved_quantity.
    idempotency_key VARCHAR(120) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.dark_store_reservations.order_id IS
    'No FK by design in DS-2: the instamart fulfilment order identity is not settled. Populated and constrained in DS-3 once the order model is decided.';
COMMENT ON COLUMN public.dark_store_reservations.idempotency_key IS
    'Same key + same operation replays; same key + different semantics must raise IDEMPOTENCY_CONFLICT, matching the existing money-identity convention.';

-- ---------------------------------------------------------------------------
-- 4. Indexes (only those not already implied by a UNIQUE constraint)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_dark_stores_status ON public.dark_stores (status);
CREATE INDEX IF NOT EXISTS idx_dark_stores_operator ON public.dark_stores (operated_by_merchant_id);
CREATE INDEX IF NOT EXISTS idx_dsi_store ON public.dark_store_inventory (dark_store_id);
CREATE INDEX IF NOT EXISTS idx_dsi_product ON public.dark_store_inventory (product_id);
CREATE INDEX IF NOT EXISTS idx_dsr_store_status ON public.dark_store_reservations (dark_store_id, status);
CREATE INDEX IF NOT EXISTS idx_dsr_inventory_status ON public.dark_store_reservations (inventory_id, status);
-- idempotency_key and (dark_store_id, product_id) already carry unique indexes.

-- ---------------------------------------------------------------------------
-- 5. RLS - the 029 pattern: enabled, no permissive policy, service_role granted.
--    Every new table is unreadable and unwritable to anon/authenticated; the
--    backend reaches it through its service-role repository, and every
--    authorisation decision stays server-side on the authenticated principal
--    rather than on a client-supplied dark_store_id.
-- ---------------------------------------------------------------------------
ALTER TABLE public.dark_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dark_store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dark_store_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dark_stores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dark_store_inventory FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dark_store_reservations FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dark_stores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dark_store_inventory TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dark_store_reservations TO service_role;
