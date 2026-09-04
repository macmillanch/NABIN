-- ============================================================================
-- NABIN MIGRATION 011: Geo-Fencing, Dynamic Surge Zones & Spatial Pricing Domain
--
-- Authoritative PostgreSQL persistence for:
--   1. public.geo_fences (extended schema with category, center coords, operating bounds)
--   2. public.surge_zones (dynamic time-scheduled surge rules with max cap)
--   3. public.pricing_configurations (rate cards for 2W, 3W, 4W, PARCEL, FOOD, GLOBAL)
--
-- Safety Guarantees:
--   - Completely additive & idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING)
--   - Preserves all columns from Migration 001
--   - Row-Level Security (RLS) enabled on all tables
--   - Read-only access for public/authenticated clients; write-locked to service role & admins
-- ============================================================================

-- 1. EXTEND GEO_FENCES TABLE
ALTER TABLE IF EXISTS public.geo_fences
    ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'GENERAL',
    ADD COLUMN IF NOT EXISTS center_lat NUMERIC(10, 7),
    ADD COLUMN IF NOT EXISTS center_lng NUMERIC(10, 7),
    ADD COLUMN IF NOT EXISTS radius_meters INTEGER,
    ADD COLUMN IF NOT EXISTS allowed_services TEXT[] DEFAULT ARRAY['RIDE','PARCEL','FOOD'],
    ADD COLUMN IF NOT EXISTS allowed_vehicles TEXT[] DEFAULT ARRAY['2W','3W','4W'],
    ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100) DEFAULT '24x7 Open',
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(100),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add constraints if not already present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_geo_fences_surcharge_nonneg'
    ) THEN
        ALTER TABLE public.geo_fences
            ADD CONSTRAINT chk_geo_fences_surcharge_nonneg CHECK (surcharge_amount >= 0);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_geo_fences_surge_min1'
    ) THEN
        ALTER TABLE public.geo_fences
            ADD CONSTRAINT chk_geo_fences_surge_min1 CHECK (surge_multiplier >= 1.00);
    END IF;
END $$;

-- Indexes for geo_fences
CREATE INDEX IF NOT EXISTS idx_geo_fences_active ON public.geo_fences (is_active);
CREATE INDEX IF NOT EXISTS idx_geo_fences_category ON public.geo_fences (category);
CREATE INDEX IF NOT EXISTS idx_geo_fences_zone_code ON public.geo_fences (zone_code);


-- 2. CREATE DYNAMIC SURGE ZONES TABLE
CREATE TABLE IF NOT EXISTS public.surge_zones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zone_id UUID REFERENCES public.geo_fences(id) ON DELETE CASCADE,
    zone_name VARCHAR(100) NOT NULL,
    service VARCHAR(30) DEFAULT 'ALL',
    vehicle_type VARCHAR(30) DEFAULT 'ALL',
    surge_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
    max_multiplier NUMERIC(4, 2) NOT NULL DEFAULT 3.00,
    start_time TIME,
    end_time TIME,
    priority VARCHAR(20) DEFAULT 'NORMAL',
    status VARCHAR(20) DEFAULT 'ACTIVE',
    reason TEXT,
    created_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_surge_multiplier_min CHECK (surge_multiplier >= 1.00),
    CONSTRAINT chk_max_multiplier_min CHECK (max_multiplier >= 1.00),
    CONSTRAINT chk_surge_not_exceed_max CHECK (surge_multiplier <= max_multiplier),
    CONSTRAINT chk_surge_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE', 'SCHEDULED', 'EXPIRED')),
    CONSTRAINT chk_surge_priority_valid CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL'))
);

-- Indexes for surge_zones
CREATE INDEX IF NOT EXISTS idx_surge_zones_lookup ON public.surge_zones (status, service, vehicle_type);
CREATE INDEX IF NOT EXISTS idx_surge_zones_zone_id ON public.surge_zones (zone_id);
CREATE INDEX IF NOT EXISTS idx_surge_zones_priority ON public.surge_zones (priority);


-- 3. CREATE PRICING CONFIGURATIONS TABLE
CREATE TABLE IF NOT EXISTS public.pricing_configurations (
    id VARCHAR(50) PRIMARY KEY,
    service_type VARCHAR(30) NOT NULL,
    name VARCHAR(100) NOT NULL,
    base_fare NUMERIC(10, 2) NOT NULL,
    per_km_rate NUMERIC(10, 2) NOT NULL,
    per_min_rate NUMERIC(10, 2) NOT NULL,
    min_fare NUMERIC(10, 2) NOT NULL,
    booking_fee NUMERIC(10, 2) NOT NULL,
    commission_percent NUMERIC(5, 2) NOT NULL,
    global_surge_multiplier NUMERIC(4, 2) DEFAULT 1.00,
    active_surge_zone VARCHAR(80) DEFAULT 'NONE',
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_base_fare_nonneg CHECK (base_fare >= 0),
    CONSTRAINT chk_per_km_nonneg CHECK (per_km_rate >= 0),
    CONSTRAINT chk_per_min_nonneg CHECK (per_min_rate >= 0),
    CONSTRAINT chk_min_fare_nonneg CHECK (min_fare >= 0),
    CONSTRAINT chk_booking_fee_nonneg CHECK (booking_fee >= 0),
    CONSTRAINT chk_commission_percent_range CHECK (commission_percent >= 0 AND commission_percent <= 100),
    CONSTRAINT chk_global_surge_min CHECK (global_surge_multiplier >= 1.00)
);

-- Index for pricing_configurations
CREATE INDEX IF NOT EXISTS idx_pricing_configs_service ON public.pricing_configurations (service_type);


-- 4. SEED DEFAULT PRICING CONFIGURATIONS
INSERT INTO public.pricing_configurations (
    id, service_type, name, base_fare, per_km_rate, per_min_rate, min_fare, booking_fee, commission_percent, global_surge_multiplier, active_surge_zone, updated_by
) VALUES
    ('2W', '2W', 'Bike Taxi', 25.00, 8.00, 1.00, 35.00, 5.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED'),
    ('3W', '3W', 'Auto Rickshaw', 35.00, 12.00, 1.50, 50.00, 8.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED'),
    ('4W', '4W', 'Cab Comfort', 70.00, 18.00, 2.00, 100.00, 15.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED'),
    ('PARCEL', 'PARCEL', 'Instant Parcel Delivery', 40.00, 10.00, 1.00, 50.00, 10.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED'),
    ('FOOD', 'FOOD', 'Restaurant Delivery', 30.00, 9.00, 1.00, 40.00, 5.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED'),
    ('GLOBAL', 'GLOBAL', 'Global Pricing Matrix Defaults', 0.00, 0.00, 0.00, 0.00, 0.00, 15.00, 1.00, 'NONE', 'SYSTEM_SEED')
ON CONFLICT (id) DO NOTHING;


-- 5. SEED INITIAL OPERATIONAL GEOFENCES
INSERT INTO public.geo_fences (
    zone_name, zone_code, geometry_type, coordinates, center_lat, center_lng, radius_meters,
    surcharge_amount, surge_multiplier, is_active, category, allowed_services, allowed_vehicles,
    operating_hours, description, created_by
) VALUES
(
    'IGI Airport Terminal 3 Zone',
    'ZONE_AIRPORT_IGI_T3',
    'CIRCLE',
    '{"center": {"lat": 28.5562, "lng": 77.1000}, "radiusMeters": 3500}'::jsonb,
    28.5562,
    77.1000,
    3500,
    150.00,
    1.00,
    TRUE,
    'AIRPORT',
    ARRAY['RIDE', 'PARCEL'],
    ARRAY['3W', '4W'],
    '24x7 Open',
    'Airport Toll & Priority Terminal Queue',
    'Devika Singhania'
),
(
    'Connaught Place CBD Boundary',
    'ZONE_CBD_CONNAUGHT_PLACE',
    'POLYGON',
    '[{"lat": 28.6350, "lng": 77.2150}, {"lat": 28.6350, "lng": 77.2250}, {"lat": 28.6250, "lng": 77.2250}, {"lat": 28.6250, "lng": 77.2150}]'::jsonb,
    NULL,
    NULL,
    NULL,
    0.00,
    1.40,
    TRUE,
    'CBD_HIGH_DEMAND',
    ARRAY['RIDE', 'PARCEL', 'FOOD'],
    ARRAY['2W', '3W', '4W'],
    '08:00 AM – 11:00 PM',
    'Central Commercial District High Demand',
    'Karan Patel'
),
(
    'Cyber City DLF Phase 2 Corridor',
    'ZONE_TECH_CYBERCITY_DLF',
    'POLYGON',
    '[{"lat": 28.4900, "lng": 77.0850}, {"lat": 28.4950, "lng": 77.0950}, {"lat": 28.4850, "lng": 77.0950}, {"lat": 28.4800, "lng": 77.0850}]'::jsonb,
    NULL,
    NULL,
    NULL,
    20.00,
    1.25,
    TRUE,
    'TECH_PARK',
    ARRAY['RIDE', 'PARCEL', 'FOOD'],
    ARRAY['2W', '3W', '4W'],
    '09:00 AM – 09:00 PM',
    'Peak Hour Corporate IT Corridor Surcharge',
    'Devika Singhania'
)
ON CONFLICT (zone_code) DO NOTHING;


-- 6. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.geo_fences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.surge_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_configurations ENABLE ROW LEVEL SECURITY;

-- Read policies: Public / Authenticated read for active geofences & pricing configurations
DROP POLICY IF EXISTS p_read_active_geofences ON public.geo_fences;
CREATE POLICY p_read_active_geofences ON public.geo_fences
    FOR SELECT
    USING (is_active = TRUE);

DROP POLICY IF EXISTS p_read_active_surge_zones ON public.surge_zones;
CREATE POLICY p_read_active_surge_zones ON public.surge_zones
    FOR SELECT
    USING (status = 'ACTIVE');

DROP POLICY IF EXISTS p_read_pricing_configs ON public.pricing_configurations;
CREATE POLICY p_read_pricing_configs ON public.pricing_configurations
    FOR SELECT
    USING (TRUE);

-- Service-role full access policies
DROP POLICY IF EXISTS p_service_role_geofences ON public.geo_fences;
CREATE POLICY p_service_role_geofences ON public.geo_fences
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

DROP POLICY IF EXISTS p_service_role_surge_zones ON public.surge_zones;
CREATE POLICY p_service_role_surge_zones ON public.surge_zones
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

DROP POLICY IF EXISTS p_service_role_pricing_configs ON public.pricing_configurations;
CREATE POLICY p_service_role_pricing_configs ON public.pricing_configurations
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);
