-- 1. FEATURE CONTROL SYSTEM
-- =========================================================================

-- Insert default feature states into existing platform_settings
INSERT INTO platform_settings (setting_key, setting_value, description)
VALUES 
    -- RIDE and sub-features
    ('FEATURE_RIDE', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Master switch for RIDE service'),
    ('FEATURE_RIDE_BIKE', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: RIDE Bike'),
    ('FEATURE_RIDE_AUTO', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: RIDE Auto'),
    ('FEATURE_RIDE_TAXI', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: RIDE Taxi'),
    ('FEATURE_RIDE_SHARED', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: RIDE Shared'),
    ('FEATURE_RIDE_RENTAL', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: RIDE Rental'),

    -- FOOD and sub-features
    ('FEATURE_FOOD', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Master switch for FOOD service'),
    ('FEATURE_FOOD_ORDERING', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: FOOD Ordering'),
    ('FEATURE_FOOD_DELIVERY', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: FOOD Delivery'),

    -- GROCERY and sub-features
    ('FEATURE_GROCERY', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Master switch for GROCERY service'),
    ('FEATURE_GROCERY_MARKETPLACE', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: GROCERY Marketplace (Merchant Fulfillment)'),
    ('FEATURE_GROCERY_NABIN_FULFILLMENT', '{"enabled": false, "location_overrides": {}}'::jsonb, 'Sub-feature: GROCERY NABIN Fulfillment (Dark Store)'),

    -- PARCEL and sub-features
    ('FEATURE_PARCEL', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Master switch for PARCEL service'),
    ('FEATURE_PARCEL_BOOKING', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: PARCEL Booking'),
    ('FEATURE_PARCEL_DELIVERY', '{"enabled": true, "location_overrides": {}}'::jsonb, 'Sub-feature: PARCEL Delivery')
ON CONFLICT (setting_key) DO UPDATE SET 
    setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description;

-- =========================================================================
-- 2. ENFORCEMENT FUNCTIONS
-- =========================================================================

-- Helper function to evaluate feature state at the database level.
-- Evaluates location overrides and hierarchically checks the parent feature.
CREATE OR REPLACE FUNCTION is_feature_enabled(p_feature_key VARCHAR, p_location_id VARCHAR DEFAULT 'GLOBAL')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_setting_value JSONB;
    v_is_enabled BOOLEAN;
    v_parent_key VARCHAR;
    v_parent_enabled BOOLEAN;
BEGIN
    -- 1. Fetch the feature setting
    SELECT setting_value INTO v_setting_value 
    FROM platform_settings 
    WHERE setting_key = p_feature_key;

    -- If feature is completely missing, fail closed (false)
    IF v_setting_value IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 2. Evaluate location override or fallback to global enabled
    IF p_location_id != 'GLOBAL' AND v_setting_value->'location_overrides' ? p_location_id THEN
        v_is_enabled := (v_setting_value->'location_overrides'->>p_location_id)::BOOLEAN;
    ELSE
        v_is_enabled := (v_setting_value->>'enabled')::BOOLEAN;
    END IF;

    -- 3. If the feature itself is disabled, return false immediately
    IF NOT v_is_enabled THEN
        RETURN FALSE;
    END IF;

    -- 4. Check hierarchical parent
    -- Example: FEATURE_RIDE_TAXI parent is FEATURE_RIDE
    -- We assume standard naming convention: FEATURE_<SERVICE>_<SUBFEATURE>
    -- Where parent is FEATURE_<SERVICE>
    
    -- Does it have a parent? (Contains more than 2 underscores)
    IF p_feature_key LIKE 'FEATURE_%_%' THEN
        -- Extract the parent by finding the second underscore index
        -- e.g., from FEATURE_RIDE_TAXI extract FEATURE_RIDE
        v_parent_key := substring(p_feature_key from '^([^_]+_[^_]+)');
        
        -- Prevent infinite recursion if the regex matches itself
        IF v_parent_key != p_feature_key THEN
            -- Check parent status recursively
            -- Note: We only go one level deep for parent/child to prevent complex cycles.
            SELECT setting_value INTO v_setting_value 
            FROM platform_settings 
            WHERE setting_key = v_parent_key;
            
            IF v_setting_value IS NOT NULL THEN
                IF p_location_id != 'GLOBAL' AND v_setting_value->'location_overrides' ? p_location_id THEN
                    v_parent_enabled := (v_setting_value->'location_overrides'->>p_location_id)::BOOLEAN;
                ELSE
                    v_parent_enabled := (v_setting_value->>'enabled')::BOOLEAN;
                END IF;
                
                IF NOT v_parent_enabled THEN
                    RETURN FALSE;
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN TRUE;
END;
$$;

-- Grant execution to authenticated roles
GRANT EXECUTE ON FUNCTION is_feature_enabled(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION is_feature_enabled(VARCHAR, VARCHAR) TO service_role;
