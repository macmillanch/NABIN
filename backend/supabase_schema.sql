-- =============================================================================
-- NABIN PLATFORM — COMPLETE SUPABASE POSTGRESQL SCHEMA (DDL + SEED DATA)
-- Run this script in your Supabase SQL Editor (https://app.supabase.com -> SQL Editor)
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- -----------------------------------------------------------------------------
-- 1. PROFILES & USERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(100) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'CUSTOMER', -- CUSTOMER, DRIVER, MERCHANT, ADMIN
    avatar_url TEXT,
    is_identity_verified BOOLEAN DEFAULT FALSE,
    wallet_balance NUMERIC(10, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 2. DRIVERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.drivers (
    id VARCHAR(100) PRIMARY KEY,
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(20) NOT NULL, -- 2W, 3W, 4W
    category_name VARCHAR(100) NOT NULL,
    vehicle VARCHAR(255) NOT NULL,
    dl_number VARCHAR(100) NOT NULL,
    rating NUMERIC(3, 2) DEFAULT 4.90,
    status VARCHAR(50) DEFAULT 'VERIFIED', -- VERIFIED, PENDING_REVIEW, SUSPENDED
    driver_state VARCHAR(50) DEFAULT 'ONLINE', -- ONLINE, OFFLINE, IN_RIDE
    current_lat NUMERIC(10, 7) DEFAULT 28.6139,
    current_lng NUMERIC(10, 7) DEFAULT 77.2090,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 3. MERCHANTS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchants (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    merchant_type VARCHAR(50) NOT NULL DEFAULT 'GROCERY_DARKSTORE', -- GROCERY_DARKSTORE, RESTAURANT, PARCEL_HUB
    rating NUMERIC(3, 2) DEFAULT 4.85,
    address TEXT NOT NULL,
    city VARCHAR(100) DEFAULT 'New Delhi',
    is_open BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. GROCERY PRODUCTS TABLE (DYNAMIC PRICING ENGINE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grocery_products (
    id VARCHAR(100) PRIMARY KEY,
    merchant_id VARCHAR(100) REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    brand VARCHAR(100),
    emoji VARCHAR(20) DEFAULT '📦',
    unit VARCHAR(50) NOT NULL, -- kg, g, litre, pack, piece
    pack_size VARCHAR(100),
    mrp NUMERIC(10, 2) NOT NULL,
    current_price NUMERIC(10, 2) NOT NULL,
    previous_price NUMERIC(10, 2) NOT NULL,
    pricing_type VARCHAR(50) NOT NULL DEFAULT 'FIXED_PRICE', -- FIXED_PRICE, VARIABLE_PRICE, WEIGHT_BASED_PRICE
    price_status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, FROZEN, UNDER_REVIEW
    is_available BOOLEAN DEFAULT TRUE,
    last_price_update TIMESTAMPTZ DEFAULT NOW(),
    price_effective_time TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. GROCERY PRICE HISTORY AUDIT TRAIL
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grocery_price_history (
    id VARCHAR(100) PRIMARY KEY,
    product_id VARCHAR(100) REFERENCES public.grocery_products(id) ON DELETE CASCADE,
    product_name VARCHAR(255) NOT NULL,
    store_id VARCHAR(100) NOT NULL,
    previous_price NUMERIC(10, 2) NOT NULL,
    new_price NUMERIC(10, 2) NOT NULL,
    pricing_type VARCHAR(50) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    effective_from TIMESTAMPTZ DEFAULT NOW(),
    changed_by VARCHAR(100) NOT NULL,
    reason TEXT,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. GROCERY ORDERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.grocery_orders (
    id VARCHAR(100) PRIMARY KEY,
    customer_id VARCHAR(100) NOT NULL,
    merchant_id VARCHAR(100) REFERENCES public.merchants(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED', -- CONFIRMED, PACKING, OUT_FOR_DELIVERY, DELIVERED
    delivery_address TEXT NOT NULL,
    items JSONB NOT NULL,
    estimated_subtotal NUMERIC(10, 2) NOT NULL,
    final_subtotal NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(10, 2) DEFAULT 0.00,
    delivery_fee NUMERIC(10, 2) DEFAULT 0.00,
    handling_fee NUMERIC(10, 2) DEFAULT 2.00,
    final_total NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 7. IDENTITY APPLICATIONS TABLE (AADHAAR + VOTER ID COMPLIANCE)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_applications (
    id VARCHAR(100) PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    user_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255),
    aadhaar_number_masked VARCHAR(50) NOT NULL,
    voter_id_number_masked VARCHAR(50) NOT NULL,
    dob VARCHAR(50),
    address TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'IDENTITY_VERIFICATION_PENDING',
    submission_date TIMESTAMPTZ DEFAULT NOW(),
    assigned_reviewer_id VARCHAR(100),
    assigned_reviewer_name VARCHAR(255),
    locked_by_admin_name VARCHAR(255),
    locked_at TIMESTAMPTZ,
    review_notes TEXT,
    reviewed_at TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- 8. AUDIT LOGS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id VARCHAR(100) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    admin_id VARCHAR(100) NOT NULL,
    admin_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    module VARCHAR(100) NOT NULL,
    target_entity_type VARCHAR(100),
    target_entity_id VARCHAR(100),
    previous_state TEXT,
    new_state TEXT,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 9. ADMIN MASTER PRODUCTS CATALOG TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.master_products (
    id VARCHAR(100) PRIMARY KEY,
    sku VARCHAR(100) UNIQUE NOT NULL,
    master_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    brand VARCHAR(100) DEFAULT 'NABIN Select',
    emoji VARCHAR(20) DEFAULT '📦',
    image_url TEXT,
    unit VARCHAR(50) NOT NULL,
    pack_size VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 10. MERCHANT STORE INVENTORY TABLE (LINKED TO MASTER CATALOG)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_inventory (
    id VARCHAR(100) PRIMARY KEY,
    merchant_id VARCHAR(100) REFERENCES public.merchants(id) ON DELETE CASCADE,
    master_product_id VARCHAR(100) REFERENCES public.master_products(id) ON DELETE CASCADE,
    mrp NUMERIC(10, 2) NOT NULL,
    current_price NUMERIC(10, 2) NOT NULL,
    stock_quantity INT DEFAULT 100,
    is_available BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, master_product_id)
);

-- -----------------------------------------------------------------------------
-- ENABLE ROW LEVEL SECURITY (RLS) POLICIES
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grocery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_inventory ENABLE ROW LEVEL SECURITY;

-- Public read access for active master products and merchant inventory
CREATE POLICY "Public Read Access for Master Products" ON public.master_products FOR SELECT USING (true);
CREATE POLICY "Public Read Access for Merchant Inventory" ON public.merchant_inventory FOR SELECT USING (true);
CREATE POLICY "Public Read Access for Active Grocery Products" ON public.grocery_products FOR SELECT USING (is_available = TRUE);
CREATE POLICY "Public Read Access for Grocery Price History" ON public.grocery_price_history FOR SELECT USING (true);

-- -----------------------------------------------------------------------------
-- SEED DATA (MASTER CATALOG + MERCHANT INVENTORY)
-- -----------------------------------------------------------------------------
INSERT INTO public.merchants (id, name, merchant_type, rating, address)
VALUES 
    ('mcht_darkstore_1', 'NABIN Express DarkStore #84', 'GROCERY_DARKSTORE', 4.90, 'Civil Lines Hub, North Delhi')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.master_products (id, sku, master_name, category, brand, emoji, image_url, unit, pack_size)
VALUES
    ('mp_101', 'SKU-TOM-01', 'Farm Fresh Tomatoes', 'Fruits & Vegetables', 'Local Mandi', '🍅', 'https://images.unsplash.com/photo-1592924357228-91a4daadcfea?w=400&q=80', 'kg', '1 kg'),
    ('mp_102', 'SKU-BAN-01', 'Fresh Organic Bananas (Robusta)', 'Fruits & Vegetables', 'Organic Farms', '🍌', 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80', 'pack', '6 pcs'),
    ('mp_103', 'SKU-MLK-01', 'Amul Taaza Toned Milk', 'Dairy & Eggs', 'Amul', '🥛', 'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=400&q=80', 'pack', '1000ml'),
    ('mp_104', 'SKU-EGG-01', 'Farm Fresh White Eggs', 'Dairy & Eggs', 'FarmFresh', '🥚', 'https://images.unsplash.com/photo-1516448620398-c5f44bf9f441?w=400&q=80', 'pack', '6 pcs'),
    ('mp_105', 'SKU-MUT-01', 'Fresh Mutton Curry Cut', 'Meat & Seafood', 'FreshCut Meat', '🥩', 'https://images.unsplash.com/photo-1603048588665-791ca8aea617?w=400&q=80', 'kg', '500g')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.merchant_inventory (id, merchant_id, master_product_id, mrp, current_price, stock_quantity, is_available)
VALUES
    ('inv_84_1', 'mcht_darkstore_1', 'mp_101', 80.00, 60.00, 150, true),
    ('inv_84_2', 'mcht_darkstore_1', 'mp_102', 50.00, 35.00, 200, true),
    ('inv_84_3', 'mcht_darkstore_1', 'mp_103', 60.00, 56.00, 500, true),
    ('inv_84_4', 'mcht_darkstore_1', 'mp_104', 60.00, 48.00, 300, true),
    ('inv_84_5', 'mcht_darkstore_1', 'mp_105', 850.00, 720.00, 50, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.grocery_products (id, merchant_id, name, category, brand, emoji, unit, pack_size, mrp, current_price, previous_price, pricing_type, price_status, is_available)
VALUES
    ('gprod_1', 'mcht_darkstore_1', 'Farm Fresh Tomatoes', 'Fruits & Vegetables', 'Local Mandi', '🍅', 'kg', '1 kg', 80.00, 60.00, 50.00, 'WEIGHT_BASED_PRICE', 'ACTIVE', true),
    ('gprod_2', 'mcht_darkstore_1', 'Fresh Organic Bananas (Robusta)', 'Fruits & Vegetables', 'Organic Farms', '🍌', 'pack', '6 pcs', 50.00, 35.00, 35.00, 'FIXED_PRICE', 'ACTIVE', true),
    ('gprod_3', 'mcht_darkstore_1', 'Fresh Mutton Curry Cut', 'Meat & Seafood', 'FreshCut Meat', '🥩', 'kg', '500g', 850.00, 720.00, 680.00, 'WEIGHT_BASED_PRICE', 'ACTIVE', true),
    ('gprod_4', 'mcht_darkstore_1', 'Amul Taaza Toned Milk', 'Dairy & Eggs', 'Amul', '🥛', 'pack', '500ml', 28.00, 28.00, 28.00, 'FIXED_PRICE', 'ACTIVE', true),
    ('gprod_5', 'mcht_darkstore_1', 'Farm Fresh White Eggs', 'Dairy & Eggs', 'FarmFresh', '🥚', 'pack', '6 pcs', 60.00, 48.00, 42.00, 'VARIABLE_PRICE', 'ACTIVE', true)
ON CONFLICT (id) DO NOTHING;
