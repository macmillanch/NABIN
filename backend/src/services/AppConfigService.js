const crypto = require('crypto');
const database = require('../database');
const { supabaseAdmin, isLivePostgres } = require('../supabase');
const featureControlService = require('./FeatureControlService');

// Remote configuration is published to clients as plain data only. Operator-owned
// keys are namespaced so a settings write can never overwrite state another
// subsystem controls (feature flags, the emergency killswitch, surge defaults).
const SETTINGS_PREFIX = 'APP_CONFIG_';
const RESERVED_PREFIXES = ['FEATURE_'];
const RESERVED_KEYS = ['PLATFORM_SERVICE_STATE', 'service_status', 'surge_multiplier'];

const CACHE_SECONDS = Math.max(1, Number(process.env.APP_CONFIG_CACHE_SECONDS) || 30);
const PUBLISHED_OFFER_LIMIT = 10;
const MAX_SETTING_KEY_LENGTH = 100;
const MAX_VALUE_BYTES = 16 * 1024;
const MAX_VALUE_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// Rejects anything that is not a JSON document: functions, symbols, bigints,
// cycles, non-finite numbers and oversized payloads fail here rather than
// reaching a client device.
function isPlainData(value, depth = 0) {
  if (value === null) return true;
  if (depth > MAX_VALUE_DEPTH) return false;
  const type = typeof value;
  if (type === 'string') return value.length <= MAX_STRING_LENGTH;
  if (type === 'number') return Number.isFinite(value);
  if (type === 'boolean') return true;
  if (type !== 'object') return false;
  if (Array.isArray(value)) return value.every(entry => isPlainData(entry, depth + 1));
  return Object.values(value).every(entry => isPlainData(entry, depth + 1));
}

function validateSettingKey(key) {
  if (typeof key !== 'string' || !key.length) {
    return 'setting_key is required.';
  }
  if (key.length > MAX_SETTING_KEY_LENGTH) {
    return `setting_key must be at most ${MAX_SETTING_KEY_LENGTH} characters.`;
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(key)) {
    return 'setting_key may only contain letters, digits, dot, dash and underscore.';
  }
  if (RESERVED_KEYS.includes(key) || RESERVED_PREFIXES.some(prefix => key.startsWith(prefix))) {
    return `setting_key [${key}] is managed by a dedicated control endpoint and cannot be written here.`;
  }
  return null;
}

function isPublishableKey(key) {
  return key.startsWith(SETTINGS_PREFIX) && !RESERVED_KEYS.includes(key);
}

function validateSettingValue(value) {
  if (value === undefined) {
    return 'A value is required. Send { "value": <json> }.';
  }
  if (!isPlainData(value)) {
    return 'Configuration values must be plain JSON data: objects, arrays, strings, finite numbers, booleans or null, at most 6 levels deep and 2000 characters per string.';
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_VALUE_BYTES) {
    return `Configuration values must be at most ${MAX_VALUE_BYTES} bytes when serialised.`;
  }
  return null;
}

class AppConfigService {
  constructor() {
    this.sections = null;
    this.fetchedAt = 0;
  }

  invalidate() {
    this.fetchedAt = 0;
  }

  buildServiceSection() {
    const status = database.getServicesStatus();
    return {
      summary: status.summary,
      // Which operator paused a service is internal; clients only need what to show.
      services: (status.services || []).map(service => ({
        id: service.id,
        name: service.name,
        category: service.category,
        icon: service.icon,
        badgeColor: service.badgeColor,
        description: service.description,
        status: service.status,
        resumeAt: service.resumeAt || null,
        broadcastNotice: service.broadcastNotice || null,
        affectedRegions: service.affectedRegions || ['ALL_REGIONS']
      }))
    };
  }

  async buildFeatureSection() {
    await featureControlService.refreshCache();
    const features = {};
    for (const [key, value] of featureControlService.cache.entries()) {
      features[key] = { enabled: value?.enabled === true };
    }
    return { source: 'platform_settings', features };
  }

  async loadOffers() {
    const now = new Date().toISOString();
    // Coupon codes are deliberately never selected: publishing one turns an
    // advertisement into a redemption any reader can spend.
    const { data, error } = await supabaseAdmin
      .from('promotions')
      .select('id, name, description, service_type, discount_type, discount_value, max_discount, min_order_amount, valid_from, valid_until')
      .eq('is_active', true)
      .lte('valid_from', now)
      .gte('valid_until', now)
      .order('valid_until', { ascending: true })
      .limit(PUBLISHED_OFFER_LIMIT);
    if (error) throw new Error(`Failed to read promotion copy: ${error.message}`);

    const { count, error: countError } = await supabaseAdmin
      .from('promotions')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .lte('valid_from', now)
      .gte('valid_until', now);
    if (countError) throw new Error(`Failed to count promotions: ${countError.message}`);

    return {
      available: true,
      source: 'promotions',
      totalActive: count ?? (data || []).length,
      // The schema has no curation column, so soonest-to-expire is the only
      // honest ranking available; publish how many offers were left out.
      truncated: Math.max(0, (count ?? 0) - (data || []).length),
      items: (data || []).map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        serviceType: row.service_type,
        discountType: row.discount_type,
        discountValue: Number(row.discount_value),
        maxDiscount: row.max_discount === null ? null : Number(row.max_discount),
        minOrderAmount: Number(row.min_order_amount),
        validFrom: row.valid_from,
        validUntil: row.valid_until
      }))
    };
  }

  async loadSettings() {
    const { data, error } = await supabaseAdmin
      .from('platform_settings')
      .select('setting_key, setting_value, updated_at')
      .like('setting_key', `${SETTINGS_PREFIX}%`);
    if (error) throw new Error(`Failed to read platform settings: ${error.message}`);

    const values = {};
    const rejected = [];
    for (const row of data || []) {
      if (!isPublishableKey(row.setting_key) || !isPlainData(row.setting_value)) {
        rejected.push(row.setting_key);
        continue;
      }
      values[row.setting_key] = row.setting_value;
    }

    return {
      available: true,
      source: 'platform_settings',
      prefix: SETTINGS_PREFIX,
      values,
      rejectedKeys: rejected
    };
  }

  async buildSections() {
    const sections = {
      services: this.buildServiceSection(),
      features: await this.buildFeatureSection()
    };

    if (!(isLivePostgres && supabaseAdmin)) {
      const reason = 'PostgreSQL is unavailable, so server-stored configuration could not be read.';
      sections.offers = { available: false, degraded: true, items: [], reason };
      sections.settings = { available: false, degraded: true, values: {}, reason };
      return sections;
    }

    const [offers, settings] = await Promise.all([this.loadOffers(), this.loadSettings()]);
    sections.offers = offers;
    sections.settings = settings;
    return sections;
  }

  async getConfig() {
    const now = Date.now();
    let stale = false;
    if (!this.sections || now - this.fetchedAt >= CACHE_SECONDS * 1000) {
      try {
        this.sections = await this.buildSections();
        this.fetchedAt = Date.now();
      } catch (error) {
        if (!this.sections) throw error;
        // Last known configuration beats a failed cold launch; say that it is stale.
        stale = true;
      }
    }

    // The advertisements section stays a pointer to its own endpoint: Phase 1
    // item 1 (durable ads) is not done, so duplicating ad payloads here would be
    // a second source of truth.
    const sections = {
      ...this.sections,
      advertisements: {
        available: true,
        durable: false,
        source: 'in_memory',
        endpoint: '/api/advertisements',
        reason: 'Advertisements are served from the existing endpoint but are not yet PostgreSQL-backed.'
      }
    };

    const serverTime = new Date();
    const version = crypto.createHash('sha256').update(stableStringify(sections)).digest('hex').slice(0, 16);

    return {
      etag: `W/"${version}"`,
      config: {
        configVersion: version,
        serverTime: serverTime.toISOString(),
        // A device clock must never decide whether an offer has started.
        serverTimeEpochMs: serverTime.getTime(),
        cacheSeconds: CACHE_SECONDS,
        expiresAt: new Date(serverTime.getTime() + CACHE_SECONDS * 1000).toISOString(),
        stale,
        dataSource: (isLivePostgres && supabaseAdmin) ? 'postgres' : 'degraded',
        sections
      }
    };
  }
}

const appConfigService = new AppConfigService();
appConfigService.validateSettingKey = validateSettingKey;
appConfigService.validateSettingValue = validateSettingValue;
appConfigService.isPlainData = isPlainData;
appConfigService.isPublishableKey = isPublishableKey;
appConfigService.SETTINGS_PREFIX = SETTINGS_PREFIX;

module.exports = appConfigService;
