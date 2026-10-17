-- =============================================================================
-- NABIN PLATFORM — RESTAURANT MANAGEMENT SYSTEM (RMS) CORE SCHEMA
-- Migration: 041_restaurant_management_system_core.sql
-- Status: DESIGN ARTIFACT READY FOR CONTROLLED LOCAL VERIFICATION.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION DATABASE.
-- =============================================================================
-- Scope:
--   1. Additive channel configurations on `public.merchants`:
--      - dine_in_enabled: boolean (default true)
--      - takeaway_enabled: boolean (default true)
--      - delivery_enabled: boolean (default true)
--      - tax_rate_percent: numeric(5,2) (default 5.00)
--      - service_charge_percent: numeric(5,2) (default 0.00)
--      - packaging_fee: numeric(8,2) (default 0.00)
--      - rms_settings: jsonb (default '{}') for RMS-only extras (prep_time_minutes, etc.)
--   2. Additive fulfillment attributes on `public.orders`:
--      - order_channel: 'DINE_IN', 'TAKEAWAY', 'DELIVERY'
--      - table_id: UUID
--      - table_session_id: UUID
--      - pickup_time: TIMESTAMPTZ
--      - handover_by: VARCHAR(80)
--      - handover_at: TIMESTAMPTZ
--      - tax_amount: numeric(10,2)
--      - service_charge_amount: numeric(10,2)
--      - packaging_fee_amount: numeric(10,2)
--      - payment_method: 'ONLINE', 'CASH', 'SPLIT', 'WALLET'
--      - payment_status: 'PENDING', 'PAID', 'PARTIALLY_PAID', 'REFUNDED'
--   3. Tables for RMS Domain:
--      - `public.restaurant_sections`
--      - `public.restaurant_tables`
--      - `public.restaurant_table_sessions`
--      - `public.restaurant_reservations`
--      - `public.restaurant_bills`
--      - `public.restaurant_staff`
--      - `public.restaurant_kds_tickets`
-- =============================================================================

-- 1. ADDITIVE COLUMNS ON MERCHANTS TABLE
ALTER TABLE public.merchants
    ADD COLUMN IF NOT EXISTS dine_in_enabled BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS takeaway_enabled BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS delivery_enabled BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(5, 2) DEFAULT 5.00,
    ADD COLUMN IF NOT EXISTS service_charge_percent NUMERIC(5, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(8, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS rms_settings JSONB DEFAULT '{}'::jsonb;

-- 2. RESTAURANT SECTIONS (FLOORS / AREAS)
CREATE TABLE IF NOT EXISTS public.restaurant_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, name)
);

-- 3. RESTAURANT TABLES
CREATE TABLE IF NOT EXISTS public.restaurant_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    section_id UUID REFERENCES public.restaurant_sections(id) ON DELETE SET NULL,
    table_number VARCHAR(30) NOT NULL,
    table_name VARCHAR(80),
    capacity INTEGER NOT NULL DEFAULT 4 CHECK (capacity > 0),
    status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'ORDERING', 'BILL_REQUESTED', 'CLEANING')),
    qr_code_token VARCHAR(120) UNIQUE,
    current_session_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, table_number)
);

-- 4. RESTAURANT TABLE SESSIONS
CREATE TABLE IF NOT EXISTS public.restaurant_table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
    session_token VARCHAR(120) UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'BILL_REQUESTED', 'CLOSED', 'CANCELLED')),
    guest_count INTEGER DEFAULT 2 CHECK (guest_count >= 1),
    opened_by VARCHAR(80),
    opened_at TIMESTAMPTZ DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    total_amount NUMERIC(12, 2) DEFAULT 0.00 CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) DEFAULT 0.00 CHECK (paid_amount >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RESTAURANT RESERVATIONS
CREATE TABLE IF NOT EXISTS public.restaurant_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
    customer_name VARCHAR(120) NOT NULL,
    customer_phone VARCHAR(20) NOT NULL,
    party_size INTEGER NOT NULL DEFAULT 2 CHECK (party_size >= 1),
    reservation_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW')),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. ADDITIVE COLUMNS ON ORDERS TABLE
ALTER TABLE public.orders
    ADD COLUMN IF NOT EXISTS order_channel VARCHAR(30) DEFAULT 'DELIVERY',
    ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES public.restaurant_table_sessions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pickup_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS handover_by VARCHAR(80),
    ADD COLUMN IF NOT EXISTS handover_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS packaging_fee_amount NUMERIC(10, 2) DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT 'ONLINE',
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) DEFAULT 'PENDING';

-- 7. RESTAURANT BILLS (DINE-IN BILLING & SPLITTING)
CREATE TABLE IF NOT EXISTS public.restaurant_bills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    table_session_id UUID NOT NULL REFERENCES public.restaurant_table_sessions(id) ON DELETE CASCADE,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    service_charge NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (service_charge >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    status VARCHAR(30) NOT NULL DEFAULT 'UNPAID'
        CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'VOIDED')),
    split_type VARCHAR(30) NOT NULL DEFAULT 'NONE'
        CHECK (split_type IN ('NONE', 'EQUAL', 'BY_ITEM')),
    payments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. RESTAURANT STAFF (RBAC)
CREATE TABLE IF NOT EXISTS public.restaurant_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    name VARCHAR(120) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    role VARCHAR(30) NOT NULL
        CHECK (role IN ('OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN_STAFF', 'INVENTORY_STAFF')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(merchant_id, phone)
);

-- 9. KITCHEN DISPLAY SYSTEM TICKETS
CREATE TABLE IF NOT EXISTS public.restaurant_kds_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    ticket_number VARCHAR(50) NOT NULL,
    channel VARCHAR(30) NOT NULL CHECK (channel IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY')),
    table_number VARCHAR(30),
    status VARCHAR(30) NOT NULL DEFAULT 'NEW'
        CHECK (status IN ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED')),
    items_snapshot JSONB DEFAULT '[]'::jsonb,
    prep_started_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    served_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. INDEXES FOR HIGH-EFFICIENCY LOOKUPS & TENANT ISOLATION
CREATE INDEX IF NOT EXISTS idx_tables_merchant ON public.restaurant_tables(merchant_id);
CREATE INDEX IF NOT EXISTS idx_table_sessions_merchant ON public.restaurant_table_sessions(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_merchant_date ON public.restaurant_reservations(merchant_id, reservation_time);
CREATE INDEX IF NOT EXISTS idx_kds_tickets_merchant_status ON public.restaurant_kds_tickets(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.orders(merchant_id, order_channel);
CREATE INDEX IF NOT EXISTS idx_staff_merchant ON public.restaurant_staff(merchant_id);
