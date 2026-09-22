const crypto = require('crypto');
const database = require('../database');
const { supabaseAdmin, isLivePostgres } = require('../supabase');
const featureControlService = require('./FeatureControlService');
const AdvertisementRepository = require('../repositories/AdvertisementRepository');
// The palette vocabulary is owned by the campaign repository (a leaf module) so an
// authoring rule and a publication rule cannot drift into two different lists.
const { CAMPAIGN_THEME_TOKENS: THEME_TOKENS } = require('../repositories/CampaignRepository');

// Remote configuration is published to clients as plain data only. Operator-owned
// keys are namespaced so a settings write can never overwrite state another
// subsystem controls (feature flags, the emergency killswitch, surge defaults).
const SETTINGS_PREFIX = 'APP_CONFIG_';
const RESERVED_PREFIXES = ['FEATURE_'];
const RESERVED_KEYS = ['PLATFORM_SERVICE_STATE', 'service_status', 'surge_multiplier'];

// A client theme is remote only if the server can say which tokens exist. An
// allow-list keeps an operator typo from silently repainting the wrong surface,
// and a hex pattern keeps the value data: no expression can survive either gate.
const THEME_SETTING_KEY = `${SETTINGS_PREFIX}THEME`;
const THEME_HEX = /^#[0-9a-fA-F]{6}$/;

// A theme names its marks by asset id; a client wants a URL. Resolved here rather
// than stored twice, so deleting an asset cannot leave a campaign pointing at a
// cached link.
function urlForAsset(campaign, assetId) {
  if (!assetId || !Array.isArray(campaign.assets)) return null;
  const asset = campaign.assets.find(a => a.id === assetId);
  return asset ? asset.url : null;
}

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

  // Composed from the same platform_settings row the generic writer publishes,
  // so a palette change needs no new table and no release. Colours only: font
  // files and logos stay bundled, and this section says so rather than implying
  // the whole visual identity is remote.
  buildThemeSection(settings) {
    const base = { source: `platform_settings:${THEME_SETTING_KEY}`, knownTokens: THEME_TOKENS };
    const raw = settings && settings.values ? settings.values[THEME_SETTING_KEY] : undefined;
    if (raw === undefined) {
      return {
        ...base,
        available: false,
        tokens: {},
        rejectedTokens: [],
        reason: 'No theme has been published, so clients render their bundled palette.'
      };
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        ...base,
        available: false,
        tokens: {},
        rejectedTokens: [THEME_SETTING_KEY],
        reason: `The ${THEME_SETTING_KEY} setting must be an object of token names to #RRGGBB colours.`
      };
    }

    const tokens = {};
    const rejectedTokens = [];
    for (const [key, value] of Object.entries(raw)) {
      if (!THEME_TOKENS.includes(key) || typeof value !== 'string' || !THEME_HEX.test(value)) {
        rejectedTokens.push(key);
        continue;
      }
      tokens[key] = value.toUpperCase();
    }

    return {
      ...base,
      available: Object.keys(tokens).length > 0,
      tokens,
      rejectedTokens,
      remoteOnly: ['colours'],
      notRemote: ['fonts', 'logos', 'layout', 'icons']
    };
  }

  // Which campaign is live is a fact about time, so it is answered by PostgreSQL's
  // clock through resolve_live_campaigns() rather than by this process. The 30-second
  // cache means a campaign can appear up to one cache window after it starts, which
  // is still server control: no client clock is consulted anywhere on this path.
  async buildCampaignSection() {
    const base = {
      source: 'postgres:campaigns',
      resolvedBy: 'postgresql clock (resolve_live_campaigns)',
      cacheSeconds: CACHE_SECONDS
    };
    const repo = database.campaignRepo;
    if (!repo || !repo.live) {
      return {
        ...base,
        available: false,
        degraded: true,
        campaigns: [],
        reason: 'PostgreSQL is unavailable, so no campaign could be resolved.'
      };
    }
    let live;
    try {
      live = await repo.liveCampaigns();
    } catch (error) {
      return {
        ...base,
        available: false,
        degraded: true,
        campaigns: [],
        reason: `Campaigns could not be resolved: ${error.message}`
      };
    }
    return {
      ...base,
      available: (live || []).length > 0,
      campaigns: (live || []).map(campaign => ({
        id: campaign.id,
        code: campaign.code,
        name: campaign.name,
        priority: campaign.priority,
        serviceTypes: campaign.serviceTypes,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        theme: campaign.theme ? {
          palette: campaign.theme.palette || {},
          logoUrl: urlForAsset(campaign, campaign.theme.logoAssetId),
          wordmarkUrl: urlForAsset(campaign, campaign.theme.wordmarkAssetId),
          splashUrl: urlForAsset(campaign, campaign.theme.splashAssetId)
        } : null,
        banners: campaign.assets
          .filter(a => a.kind === 'BANNER' || a.kind === 'PROMOTIONAL_IMAGE')
          .slice(0, 3)
          .map(a => ({ kind: a.kind, url: a.url, altText: a.altText, locale: a.locale, priority: a.priority })),
        // An offer is only worth publishing while checkout will honour it: a coupon
        // that has since been switched off, or whose row is gone, would otherwise be
        // advertised as a discount the server then refuses.
        offers: campaign.offers
          .filter(offer => offer.coupon && offer.coupon.isActive !== false)
          .map(offer => ({
            serviceType: offer.serviceType,
            copy: offer.copy,
            couponCode: offer.coupon.code,
            discountType: offer.coupon.discountType,
            discountValue: offer.coupon.discountValue
          })),
        messages: campaign.messages.map(message => ({
          kind: message.kind,
          title: message.title,
          body: message.body,
          surface: message.surface,
          triggerEvent: message.triggerEvent,
          dismissible: message.dismissible,
          showOnce: message.showOnce,
          locale: message.locale,
          priority: message.priority
        }))
      }))
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
      sections.theme = {
        source: `platform_settings:${THEME_SETTING_KEY}`,
        knownTokens: THEME_TOKENS,
        available: false,
        degraded: true,
        tokens: {},
        rejectedTokens: [],
        reason: 'PostgreSQL is unavailable, so no published theme could be read.'
      };
      sections.campaigns = {
        source: 'postgres:campaigns',
        available: false,
        degraded: true,
        campaigns: [],
        reason
      };
      return sections;
    }

    const [offers, settings, campaigns] = await Promise.all([
      this.loadOffers(), this.loadSettings(), this.buildCampaignSection()
    ]);
    sections.offers = offers;
    sections.settings = settings;
    sections.theme = this.buildThemeSection(settings);
    sections.campaigns = campaigns;
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

    // Advertisements stay a pointer to their own endpoint: the rows are durable in
    // PostgreSQL now, but duplicating the campaign payloads here would create a
    // second source of truth that this 30-second cache could serve stale.
    const sections = {
      ...this.sections,
      advertisements: {
        available: true,
        durable: true,
        source: 'postgres:advertisements',
        endpoint: '/api/advertisements',
        supportedPlacements: AdvertisementRepository.PLACEMENTS,
        limitation: 'The stored shape has no priority, brand, creative or bid-rate column, and several client slot names share one placement.'
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
