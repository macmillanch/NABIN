const database = require('../database');
const supabaseHelper = require('../supabase');
class FeatureControlService {
    constructor() {
        this.cache = new Map();
        this.lastFetch = 0;
        this.CACHE_TTL = 30000; // 30 seconds cache to reduce DB load
    }

    async refreshCache() {
        const now = Date.now();
        if (now - this.lastFetch < this.CACHE_TTL && this.cache.size > 0) {
            return;
        }

        try {
            const { data, error } = await supabaseHelper.supabaseAdmin.from('platform_settings')
                .select('setting_key, setting_value')
                .like('setting_key', 'FEATURE_%');
                
            if (error) throw error;
                
            this.cache.clear();
            for (const row of data) {
                this.cache.set(row.setting_key, row.setting_value);
            }
            this.lastFetch = now;
        } catch (error) {
            console.error('FeatureControlService: Failed to fetch features', error);
            // Don't clear cache on error, keep stale data if DB is temporarily unreachable
        }
    }

    /**
     * Clear the cache. Useful for tests or when admin updates features.
     */
    invalidateCache() {
        this.cache.clear();
        this.lastFetch = 0;
    }

    /**
     * Checks if a feature is enabled, respecting location overrides and parent state.
     * @param {string} featureKey - e.g., 'FEATURE_RIDE_TAXI'
     * @param {string} locationId - Optional, defaults to 'GLOBAL'
     * @returns {Promise<boolean>}
     */
    async isFeatureEnabled(featureKey, locationId = 'GLOBAL') {
        await this.refreshCache();
        
        const settingValue = this.cache.get(featureKey);
        
        // Fail closed if feature doesn't exist
        if (!settingValue) {
            return false;
        }

        // 1. Check feature state
        let isEnabled = false;
        if (locationId !== 'GLOBAL' && settingValue.location_overrides && settingValue.location_overrides[locationId] !== undefined) {
            isEnabled = settingValue.location_overrides[locationId] === true || settingValue.location_overrides[locationId] === 'true';
        } else {
            isEnabled = settingValue.enabled === true || settingValue.enabled === 'true';
        }

        if (!isEnabled) {
            return false;
        }

        // 2. Check parent state if this is a sub-feature
        // We assume standard naming: FEATURE_<SERVICE>_<SUBFEATURE>
        // Example: FEATURE_RIDE_TAXI -> parent is FEATURE_RIDE
        const parts = featureKey.split('_');
        if (parts.length > 2 && parts[0] === 'FEATURE') {
            const parentKey = `FEATURE_${parts[1]}`;
            if (parentKey !== featureKey) {
                const parentValue = this.cache.get(parentKey);
                if (parentValue) {
                    let parentEnabled = false;
                    if (locationId !== 'GLOBAL' && parentValue.location_overrides && parentValue.location_overrides[locationId] !== undefined) {
                        parentEnabled = parentValue.location_overrides[locationId] === true || parentValue.location_overrides[locationId] === 'true';
                    } else {
                        parentEnabled = parentValue.enabled === true || parentValue.enabled === 'true';
                    }
                    
                    if (!parentEnabled) {
                        return false;
                    }
                }
            }
        }

        return true;
    }

    /**
     * Ensure a feature is enabled, throws a standard 403 error if disabled.
     */
    async requireFeature(featureKey, locationId = 'GLOBAL') {
        const isEnabled = await this.isFeatureEnabled(featureKey, locationId);
        if (!isEnabled) {
            const error = new Error(`Service or feature is currently disabled: ${featureKey}`);
            error.statusCode = 403;
            error.code = 'FEATURE_DISABLED';
            throw error;
        }
    }
}

module.exports = new FeatureControlService();
