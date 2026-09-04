-- =========================================================================
-- NABIN PLATFORM — MISSING ENTITIES SCHEMA
-- Migration: 004_missing_entities_schema.sql
-- Architecture: Merchants, Products, Advertisements, User Locations
-- =========================================================================

-- Enable Required PostgreSQL Extensions (if not already enabled)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- 1. MERCHANTS & RESTAURANTS (Table defined in 001_central_schema.sql)
-- =========================================================================

-- =========================================================================
-- 2. PRODUCTS & INVENTORY
-- =========================================================================

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    sku VARCHAR(100),
    name VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    discount_price DECIMAL(10, 2),
    is_available BOOLEAN DEFAULT TRUE,
    in_stock_quantity INTEGER DEFAULT -1, -- -1 means unlimited (e.g. food)
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 3. ADVERTISEMENTS
-- =========================================================================

CREATE TABLE IF NOT EXISTS advertisements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
    placement VARCHAR(50) NOT NULL CHECK (placement IN ('HOME_BANNER', 'SEARCH_INLINE', 'CHECKOUT', 'DRIVER_IDLE')),
    image_url TEXT NOT NULL,
    target_url TEXT,
    status VARCHAR(30) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'EXPIRED')),
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    clicks INTEGER DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 4. SAVED LOCATIONS & DELEGATES (Child pickup)
-- =========================================================================

CREATE TABLE IF NOT EXISTS user_saved_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL, -- e.g., 'Home', 'School', 'Office'
    address TEXT NOT NULL,
    lat DECIMAL(10, 8),
    lng DECIMAL(11, 8),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_delegates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    relation VARCHAR(50), -- e.g., 'Child', 'Spouse'
    phone VARCHAR(20),
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE advertisements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_delegates ENABLE ROW LEVEL SECURITY;

-- Public can read active merchants and products
CREATE POLICY "Public read active merchants" ON merchants FOR SELECT USING (is_open = true);
CREATE POLICY "Public read available products" ON products FOR SELECT USING (is_available = true);
CREATE POLICY "Public read active ads" ON advertisements FOR SELECT USING (status = 'ACTIVE');

-- Users manage their own locations and delegates
CREATE POLICY "Users manage own locations" ON user_saved_locations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own delegates" ON user_delegates FOR ALL USING (auth.uid() = user_id);

-- Admins full access
CREATE POLICY "Admins full access merchants" ON merchants FOR ALL USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'service_role'));
CREATE POLICY "Admins full access products" ON products FOR ALL USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'service_role'));
CREATE POLICY "Admins full access ads" ON advertisements FOR ALL USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'service_role'));

-- Indexes
CREATE INDEX idx_merchants_is_open ON merchants(is_open);
CREATE INDEX idx_products_merchant ON products(merchant_id);
CREATE INDEX idx_ads_placement ON advertisements(placement);
