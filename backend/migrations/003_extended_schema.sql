-- =========================================================================
-- NABIN PLATFORM — EXTENDED SCHEMA FOR FULL PERSISTENCE
-- Migration: 003_extended_schema.sql
-- Architecture: Auth Sessions, Notifications, Support, Platform Settings
-- =========================================================================

-- Enable Required PostgreSQL Extensions (just in case they weren't)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- 1. AUTHENTICATION & SESSIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS active_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(30) NOT NULL CHECK (user_type IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN')),
    user_id UUID NOT NULL, -- Logical foreign key (could point to multiple tables)
    token_hash VARCHAR(200) NOT NULL,
    device_info TEXT,
    ip_address VARCHAR(50),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. NOTIFICATIONS
-- =========================================================================

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(30) NOT NULL CHECK (user_type IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN', 'SYSTEM')),
    user_id UUID, -- NULL if global broadcast
    title VARCHAR(150) NOT NULL,
    body TEXT NOT NULL,
    data JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 3. SUPPORT TICKETS
-- =========================================================================

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    user_type VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL,
    subject VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
    priority VARCHAR(20) DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    assigned_admin_id UUID REFERENCES admin_accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 4. PLATFORM SETTINGS & KILL SWITCHES
-- =========================================================================

CREATE TABLE IF NOT EXISTS platform_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_by VARCHAR(100),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-seed basic platform settings (simulating old in-memory feature flags)
INSERT INTO platform_settings (setting_key, setting_value, description)
VALUES 
    ('service_status', '{"RIDE": true, "FOOD": true, "GROCERY": true, "PARCEL": true}'::jsonb, 'Global kill switches for services'),
    ('surge_multiplier', '1.0'::jsonb, 'Global surge multiplier default')
ON CONFLICT (setting_key) DO NOTHING;

-- =========================================================================
-- 5. ROW-LEVEL SECURITY (RLS) POLICIES
-- =========================================================================

ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Active Sessions: User can only see their own sessions
CREATE POLICY "Users view own sessions"
    ON active_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- Notifications: User can only see their own notifications
CREATE POLICY "Users view own notifications"
    ON notifications FOR SELECT
    USING (auth.uid() = user_id OR user_id IS NULL);

-- Support Tickets: User can see own, Admins can see all
CREATE POLICY "Users view own support tickets"
    ON support_tickets FOR SELECT
    USING (auth.uid() = user_id);
CREATE POLICY "Admins view all support tickets"
    ON support_tickets FOR ALL
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'SUPPORT_AGENT', 'service_role'));

-- Platform Settings: Public read, Admin write
CREATE POLICY "Public read platform settings"
    ON platform_settings FOR SELECT
    USING (true);
CREATE POLICY "Admins write platform settings"
    ON platform_settings FOR ALL
    USING (auth.jwt() ->> 'role' = 'SUPER_ADMIN' OR auth.jwt() ->> 'role' = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_active_sessions_token ON active_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
