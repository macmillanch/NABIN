-- ============================================================================
-- NABIN MIGRATION 012: Notifications, Device Tokens, Preferences & Delivery Domain
--
-- Authoritative PostgreSQL persistence for:
--   1. public.notifications (extended schema with notification_type, related entity, priority, channel, event_key)
--   2. public.device_tokens (FCM/APNS device tokens per user & platform)
--   3. public.notification_preferences (granular user notification opt-ins / opt-outs)
--   4. public.notification_deliveries (multi-channel delivery tracking and audit history)
--   5. public.notification_templates (reusable localized operational message templates)
--
-- Safety Guarantees:
--   - Completely additive & idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
--   - Preserves all columns from Migration 003
--   - Row-Level Security (RLS) enabled on all tables
--   - Enforces strict user isolation (no cross-user notification leakage / IDOR)
-- ============================================================================

-- 1. EXTEND NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type VARCHAR(30) NOT NULL DEFAULT 'CUSTOMER' CHECK (user_type IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN', 'SYSTEM')),
    user_id UUID,
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS public.notifications
    ADD COLUMN IF NOT EXISTS recipient_user_id UUID,
    ADD COLUMN IF NOT EXISTS notification_type VARCHAR(60) DEFAULT 'GENERAL',
    ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(50),
    ADD COLUMN IF NOT EXISTS related_entity_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'NORMAL',
    ADD COLUMN IF NOT EXISTS channel VARCHAR(30) DEFAULT 'IN_APP',
    ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'UNREAD',
    ADD COLUMN IF NOT EXISTS event_key VARCHAR(150),
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Constraints for notifications
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_priority_valid'
    ) THEN
        ALTER TABLE public.notifications
            ADD CONSTRAINT chk_notifications_priority_valid CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_channel_valid'
    ) THEN
        ALTER TABLE public.notifications
            ADD CONSTRAINT chk_notifications_channel_valid CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL', 'ALL'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_notifications_status_valid'
    ) THEN
        ALTER TABLE public.notifications
            ADD CONSTRAINT chk_notifications_status_valid CHECK (status IN ('UNREAD', 'READ', 'ARCHIVED', 'DISMISSED', 'DELIVERED', 'FAILED'));
    END IF;
END $$;

-- Performance & Lookup Indexes for notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_user ON public.notifications (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON public.notifications (notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key ON public.notifications (event_key) WHERE event_key IS NOT NULL;


-- 2. CREATE DEVICE TOKENS TABLE
CREATE TABLE IF NOT EXISTS public.device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    device_token TEXT NOT NULL,
    platform VARCHAR(30) DEFAULT 'ANDROID' CHECK (platform IN ('ANDROID', 'IOS', 'WEB', 'OTHER')),
    app_type VARCHAR(30) DEFAULT 'CUSTOMER' CHECK (app_type IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN')),
    device_id VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique index to prevent duplicate tokens per user & app type
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_tokens_unique ON public.device_tokens (user_id, device_token, app_type);
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_active ON public.device_tokens (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_device_tokens_token ON public.device_tokens (device_token);


-- 3. CREATE NOTIFICATION PREFERENCES TABLE
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    rides_enabled BOOLEAN DEFAULT TRUE,
    driver_updates_enabled BOOLEAN DEFAULT TRUE,
    parcel_enabled BOOLEAN DEFAULT TRUE,
    food_enabled BOOLEAN DEFAULT TRUE,
    grocery_enabled BOOLEAN DEFAULT TRUE,
    payments_enabled BOOLEAN DEFAULT TRUE,
    promotions_enabled BOOLEAN DEFAULT TRUE,
    support_enabled BOOLEAN DEFAULT TRUE,
    system_enabled BOOLEAN DEFAULT TRUE,
    push_enabled BOOLEAN DEFAULT TRUE,
    in_app_enabled BOOLEAN DEFAULT TRUE,
    sms_enabled BOOLEAN DEFAULT TRUE,
    email_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON public.notification_preferences (user_id);


-- 4. CREATE NOTIFICATION DELIVERIES TABLE
CREATE TABLE IF NOT EXISTS public.notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID REFERENCES public.notifications(id) ON DELETE CASCADE,
    device_token_id UUID REFERENCES public.device_tokens(id) ON DELETE SET NULL,
    recipient_user_id UUID,
    channel VARCHAR(30) DEFAULT 'PUSH' CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL')),
    status VARCHAR(30) DEFAULT 'SENT' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED')),
    provider VARCHAR(50) DEFAULT 'MOCK_FCM',
    provider_message_id VARCHAR(150),
    attempt_count INT DEFAULT 1,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_notification_id ON public.notification_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_recipient ON public.notification_deliveries (recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON public.notification_deliveries (status);


-- 5. CREATE NOTIFICATION TEMPLATES TABLE
CREATE TABLE IF NOT EXISTS public.notification_templates (
    id VARCHAR(80) PRIMARY KEY,
    template_code VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    title_template VARCHAR(250) NOT NULL,
    body_template TEXT NOT NULL,
    channels TEXT[] DEFAULT ARRAY['IN_APP', 'PUSH'],
    is_active BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(100) DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Initial Operational Templates
INSERT INTO public.notification_templates (
    id, template_code, name, category, title_template, body_template, channels, is_active, created_by
) VALUES
    ('TMPL_RIDE_BOOKED', 'RIDE_BOOKED', 'Ride Confirmed', 'RIDE', 'Ride Booking Confirmed', 'Searching for nearby verified drivers for your trip.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_DRIVER_ASSIGNED', 'DRIVER_ASSIGNED', 'Driver Assigned', 'RIDE', 'Driver on the Way!', '{driverName} is arriving in {etaMins} mins in a {vehiclePlate}.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_DRIVER_ARRIVING', 'DRIVER_ARRIVING', 'Driver Arriving', 'RIDE', 'Driver Arrived at Pickup', 'Your driver is waiting at your pickup point. Share OTP {otp} to start.', ARRAY['IN_APP', 'PUSH', 'SMS'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_RIDE_STARTED', 'RIDE_STARTED', 'Ride in Transit', 'RIDE', 'Trip in Progress', 'Your trip to {destination} is underway. Have a safe journey!', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_RIDE_COMPLETED', 'RIDE_COMPLETED', 'Ride Completed', 'RIDE', 'Trip Completed Successfully', 'Your trip has ended. Total fare: ₹{amount}. Thank you for riding with NABIN!', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_PARCEL_PICKED', 'PARCEL_PICKED', 'Parcel Picked Up', 'PARCEL', 'Parcel En-Route', 'Courier has collected your package #{parcelId} and is heading to recipient.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_PARCEL_DELIVERED', 'PARCEL_DELIVERED', 'Parcel Delivered', 'PARCEL', 'Parcel Delivered Successfully', 'Package #{parcelId} was handed over with delivery OTP verification.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_FOOD_PREPARING', 'FOOD_PREPARING', 'Food in Kitchen', 'FOOD', 'Order Confirmed by Restaurant', '{restaurantName} is preparing your delicious meal.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_FOOD_OUT_FOR_DELIVERY', 'FOOD_OUT_FOR_DELIVERY', 'Food Out for Delivery', 'FOOD', 'Food is on the Way!', 'Delivery partner has picked up your food order from {restaurantName}.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_PAYMENT_SUCCESS', 'PAYMENT_SUCCESS', 'Payment Received', 'PAYMENT', 'Payment Successful', 'Payment of ₹{amount} for order {orderId} processed successfully.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_PAYMENT_FAILED', 'PAYMENT_FAILED', 'Payment Failed', 'PAYMENT', 'Payment Incomplete', 'Payment of ₹{amount} failed: {reason}. Please retry.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_WALLET_CREDIT', 'WALLET_CREDIT', 'Wallet Credited', 'WALLET', 'Wallet Balance Credited', '₹{amount} added to your NABIN wallet. New balance: ₹{balance}.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_WALLET_DEBIT', 'WALLET_DEBIT', 'Wallet Debited', 'WALLET', 'Wallet Payment Debited', '₹{amount} debited from your NABIN wallet. New balance: ₹{balance}.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_SUPPORT_CREATED', 'SUPPORT_CREATED', 'Support Ticket Created', 'SUPPORT', 'Support Request Logged', 'Ticket #{ticketNumber} created. Our customer support team will assist you shortly.', ARRAY['IN_APP', 'PUSH', 'EMAIL'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_SUPPORT_MESSAGE', 'SUPPORT_MESSAGE', 'Support Message Received', 'SUPPORT', 'New Support Message', '{senderName} replied to ticket #{ticketNumber}.', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_SUPPORT_RESOLVED', 'SUPPORT_RESOLVED', 'Support Ticket Resolved', 'SUPPORT', 'Dispute Resolved', 'Ticket #{ticketNumber} resolved. Resolution: {resolutionNotes}', ARRAY['IN_APP', 'PUSH', 'EMAIL'], TRUE, 'SYSTEM_SEED'),
    ('TMPL_PROMO_BROADCAST', 'PROMO_BROADCAST', 'Promotional Broadcast', 'PROMOTION', 'Exclusive Offer for You!', '{promoTitle} — Use code {promoCode} for instant savings!', ARRAY['IN_APP', 'PUSH'], TRUE, 'SYSTEM_SEED')
ON CONFLICT (id) DO UPDATE SET
    title_template = EXCLUDED.title_template,
    body_template = EXCLUDED.body_template,
    updated_at = NOW();


-- 6. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

-- Notifications RLS
DROP POLICY IF EXISTS p_user_read_own_notifications ON public.notifications;
CREATE POLICY p_user_read_own_notifications ON public.notifications
    FOR SELECT
    USING (
        auth.uid() = user_id
        OR auth.uid() = recipient_user_id
        OR user_id IS NULL -- Global broadcast
        OR auth.role() = 'service_role'
    );

DROP POLICY IF EXISTS p_user_update_own_notifications ON public.notifications;
CREATE POLICY p_user_update_own_notifications ON public.notifications
    FOR UPDATE
    USING (
        auth.uid() = user_id
        OR auth.uid() = recipient_user_id
        OR auth.role() = 'service_role'
    )
    WITH CHECK (
        auth.uid() = user_id
        OR auth.uid() = recipient_user_id
        OR auth.role() = 'service_role'
    );

DROP POLICY IF EXISTS p_service_role_notifications ON public.notifications;
CREATE POLICY p_service_role_notifications ON public.notifications
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Device Tokens RLS
DROP POLICY IF EXISTS p_user_manage_device_tokens ON public.device_tokens;
CREATE POLICY p_user_manage_device_tokens ON public.device_tokens
    FOR ALL
    USING (auth.uid() = user_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

-- Notification Preferences RLS
DROP POLICY IF EXISTS p_user_manage_preferences ON public.notification_preferences;
CREATE POLICY p_user_manage_preferences ON public.notification_preferences
    FOR ALL
    USING (auth.uid() = user_id OR auth.role() = 'service_role')
    WITH CHECK (auth.uid() = user_id OR auth.role() = 'service_role');

-- Notification Deliveries RLS
DROP POLICY IF EXISTS p_deliveries_service_and_admin ON public.notification_deliveries;
CREATE POLICY p_deliveries_service_and_admin ON public.notification_deliveries
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);

-- Notification Templates RLS
DROP POLICY IF EXISTS p_templates_public_read ON public.notification_templates;
CREATE POLICY p_templates_public_read ON public.notification_templates
    FOR SELECT
    USING (is_active = TRUE OR auth.role() = 'service_role');

DROP POLICY IF EXISTS p_templates_service_role ON public.notification_templates;
CREATE POLICY p_templates_service_role ON public.notification_templates
    FOR ALL
    TO service_role
    USING (TRUE)
    WITH CHECK (TRUE);
