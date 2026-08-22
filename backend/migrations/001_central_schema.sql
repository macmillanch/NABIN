-- =========================================================================
-- NABIN PLATFORM — CENTRAL POSTGRESQL / SUPABASE PRODUCTION SCHEMA
-- Migration: 001_central_schema.sql
-- Architecture: Zero-Trust Central DB, PostGIS Spatial Geofencing, RLS & Ledger
-- =========================================================================

-- Enable Required PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================================
-- 1. AUTH & USER IDENTITY PROFILES
-- =========================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150),
    dob DATE,
    address TEXT,
    rating NUMERIC(3, 2) DEFAULT 5.00,
    wallet_balance NUMERIC(10, 2) DEFAULT 0.00,
    identity_status VARCHAR(40) DEFAULT 'PENDING' CHECK (identity_status IN ('PENDING', 'SUBMITTED', 'VERIFIED', 'RESUBMISSION_REQUIRED', 'REJECTED')),
    account_status VARCHAR(30) DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'SUSPENDED', 'BLOCKED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS identity_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    aadhaar_number_raw VARCHAR(20),
    aadhaar_number_masked VARCHAR(20),
    aadhaar_doc_url TEXT,
    voter_id_number_raw VARCHAR(30),
    voter_id_number_masked VARCHAR(30),
    voter_id_doc_url TEXT,
    review_status VARCHAR(40) DEFAULT 'SUBMITTED',
    reviewed_by_admin_id VARCHAR(50),
    rejection_reason TEXT,
    resubmission_reason TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    verified_at TIMESTAMPTZ
);

-- =========================================================================
-- 2. DRIVERS & FLEET
-- =========================================================================

CREATE TABLE IF NOT EXISTS drivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    vehicle_type VARCHAR(20) NOT NULL CHECK (vehicle_type IN ('2W', '3W', '4W', 'AUTO', 'CAB')),
    vehicle_number VARCHAR(30) NOT NULL,
    license_number VARCHAR(50),
    rating NUMERIC(3, 2) DEFAULT 5.00,
    is_online BOOLEAN DEFAULT FALSE,
    operational_status VARCHAR(30) DEFAULT 'AVAILABLE' CHECK (operational_status IN ('AVAILABLE', 'BUSY', 'ON_TRIP', 'ON_DELIVERY', 'SUSPENDED')),
    wallet_balance NUMERIC(10, 2) DEFAULT 0.00,
    current_lat NUMERIC(10, 7),
    current_lng NUMERIC(10, 7),
    last_heartbeat TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 3. MERCHANTS (RESTAURANTS & GROCERY DARKSTORES)
-- =========================================================================

CREATE TABLE IF NOT EXISTS merchants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    merchant_type VARCHAR(40) NOT NULL CHECK (merchant_type IN ('RESTAURANT', 'GROCERY', 'HYBRID_BOTH')),
    phone VARCHAR(20) NOT NULL,
    address TEXT NOT NULL,
    lat NUMERIC(10, 7) NOT NULL,
    lng NUMERIC(10, 7) NOT NULL,
    fssai_license VARCHAR(50),
    is_open BOOLEAN DEFAULT TRUE,
    rating NUMERIC(3, 2) DEFAULT 4.80,
    wallet_balance NUMERIC(12, 2) DEFAULT 0.00,
    commission_rate NUMERIC(4, 2) DEFAULT 0.15,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 4. MASTER GROCERY CATALOG (ADMIN OWNED) & MERCHANT INVENTORY
-- =========================================================================

CREATE TABLE IF NOT EXISTS master_grocery_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    subcategory VARCHAR(50),
    brand VARCHAR(80),
    standard_unit VARCHAR(30) NOT NULL CHECK (standard_unit IN ('g', 'kg', 'ml', 'litre', 'piece', 'dozen', 'pack')),
    pack_size VARCHAR(50) NOT NULL,
    standard_image_url TEXT NOT NULL,
    description TEXT,
    pricing_model VARCHAR(30) DEFAULT 'FIXED_PRICE' CHECK (pricing_model IN ('FIXED_PRICE', 'VARIABLE_PRICE', 'WEIGHT_BASED_PRICE')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchant_grocery_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES master_grocery_catalog(id) ON DELETE CASCADE,
    store_price NUMERIC(10, 2) NOT NULL,
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    is_available BOOLEAN DEFAULT TRUE,
    status VARCHAR(30) DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'INACTIVE')),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, product_id)
);

CREATE TABLE IF NOT EXISTS grocery_price_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
    product_id UUID REFERENCES master_grocery_catalog(id) ON DELETE CASCADE,
    previous_price NUMERIC(10, 2) NOT NULL,
    new_price NUMERIC(10, 2) NOT NULL,
    unit VARCHAR(30) NOT NULL,
    changed_by VARCHAR(50) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 5. JOBS & ORDERS (RIDES, FOOD, PARCEL, GROCERY)
-- =========================================================================

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_number VARCHAR(50) UNIQUE NOT NULL,
    service_type VARCHAR(30) NOT NULL CHECK (service_type IN ('RIDE', 'FOOD', 'PARCEL', 'GROCERY')),
    customer_id UUID REFERENCES users(id),
    driver_id UUID REFERENCES drivers(id),
    merchant_id UUID REFERENCES merchants(id),
    status VARCHAR(40) NOT NULL,
    pickup_address TEXT NOT NULL,
    drop_address TEXT NOT NULL,
    pickup_lat NUMERIC(10, 7),
    pickup_lng NUMERIC(10, 7),
    drop_lat NUMERIC(10, 7),
    drop_lng NUMERIC(10, 7),
    distance_km NUMERIC(6, 2) NOT NULL DEFAULT 0.00,
    fare_subtotal NUMERIC(10, 2) NOT NULL,
    discount_amount NUMERIC(10, 2) DEFAULT 0.00,
    surge_multiplier NUMERIC(4, 2) DEFAULT 1.00,
    surge_amount NUMERIC(10, 2) DEFAULT 0.00,
    tax_amount NUMERIC(10, 2) DEFAULT 0.00,
    packaging_fee NUMERIC(10, 2) DEFAULT 0.00,
    final_total NUMERIC(10, 2) NOT NULL,
    driver_earnings NUMERIC(10, 2) NOT NULL,
    platform_commission NUMERIC(10, 2) NOT NULL,
    start_otp VARCHAR(10),
    pickup_otp VARCHAR(10),
    delivery_otp VARCHAR(10),
    payment_method VARCHAR(30) DEFAULT 'WALLET',
    payment_status VARCHAR(30) DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 6. ADMIN ACCOUNTS & RBAC
-- =========================================================================

CREATE TABLE IF NOT EXISTS admin_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    phone VARCHAR(20),
    role VARCHAR(40) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT')),
    department VARCHAR(50),
    password_hash VARCHAR(200) NOT NULL,
    password_salt VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 7. IMMUTABLE FINANCIAL LEDGER & AUDIT TRAILS
-- =========================================================================

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id VARCHAR(80) UNIQUE NOT NULL,
    job_id UUID REFERENCES jobs(id),
    category VARCHAR(50) NOT NULL,
    debit_account VARCHAR(80) NOT NULL,
    credit_account VARCHAR(80) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) DEFAULT 'INR',
    description TEXT,
    reference_id VARCHAR(100),
    recorded_by VARCHAR(50) DEFAULT 'SYSTEM_ESCROW',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(100) UNIQUE NOT NULL,
    event_type VARCHAR(60) NOT NULL,
    provider VARCHAR(40) DEFAULT 'RAZORPAY',
    amount NUMERIC(12, 2),
    status VARCHAR(30) NOT NULL,
    payload JSONB NOT NULL,
    is_processed BOOLEAN DEFAULT TRUE,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id VARCHAR(50) NOT NULL,
    admin_name VARCHAR(100) NOT NULL,
    role VARCHAR(40) NOT NULL,
    action VARCHAR(80) NOT NULL,
    module VARCHAR(50) NOT NULL,
    target_entity_type VARCHAR(50) NOT NULL,
    target_entity_id VARCHAR(100) NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    reason TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 8. GEOFENCES, SURGE ZONES & PROMOTIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS geo_fences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_name VARCHAR(100) NOT NULL,
    zone_code VARCHAR(40) UNIQUE NOT NULL,
    geometry_type VARCHAR(20) NOT NULL CHECK (geometry_type IN ('POLYGON', 'CIRCLE')),
    coordinates JSONB NOT NULL,
    surcharge_amount NUMERIC(8, 2) DEFAULT 0.00,
    surge_multiplier NUMERIC(4, 2) DEFAULT 1.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS promotions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(30) UNIQUE NOT NULL,
    service_type VARCHAR(30) NOT NULL,
    discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FLAT')),
    discount_value NUMERIC(8, 2) NOT NULL,
    max_discount NUMERIC(8, 2),
    min_order_amount NUMERIC(8, 2) NOT NULL DEFAULT 0.00,
    total_usage_limit INTEGER,
    usage_count INTEGER DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
);

-- =========================================================================
-- 9. ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_accounts ENABLE ROW LEVEL SECURITY;

-- Users RLS
CREATE POLICY "Users can only read and update own profile"
    ON users FOR ALL
    USING (auth.uid() = id);

-- Identity Documents RLS (Sensitive Government IDs)
CREATE POLICY "Users can view own identity documents"
    ON identity_documents FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can submit own identity documents"
    ON identity_documents FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Drivers RLS
CREATE POLICY "Drivers can view and update own record"
    ON drivers FOR ALL
    USING (auth.uid() = id);

-- Merchants RLS
CREATE POLICY "Merchants can view and manage own store"
    ON merchants FOR ALL
    USING (auth.uid() = id);

-- Jobs RLS
CREATE POLICY "Participants can view their own jobs"
    ON jobs FOR SELECT
    USING (auth.uid() = customer_id OR auth.uid() = driver_id OR auth.uid() = merchant_id);

-- Double-Entry Ledger RLS (Admins & Service Role only)
CREATE POLICY "Service role and admin full access to ledger"
    ON ledger_entries FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role' OR auth.jwt() ->> 'role' = 'SUPER_ADMIN' OR auth.jwt() ->> 'role' = 'FINANCE_AUDITOR');

-- Audit Logs RLS (Immutable write, read by admins)
CREATE POLICY "Audit logs viewable by authorized admins"
    ON audit_logs FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT'));

-- Indexes for High Performance
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON drivers(phone);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_driver ON jobs(driver_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_ledger_entry_id ON ledger_entries(entry_id);
CREATE INDEX IF NOT EXISTS idx_payment_webhooks_event ON payment_webhooks(event_id);
