const { supabaseAdmin, isLivePostgres } = require('../supabase');

// The columns migration 004 actually gives an advertisement. Everything the
// in-memory engine invented on top of them lives here as an explicit "this
// cannot be stored" answer rather than a silently dropped field.
const PLACEMENTS = ['HOME_BANNER', 'SEARCH_INLINE', 'CHECKOUT', 'DRIVER_IDLE'];
const STATUSES = ['ACTIVE', 'PAUSED', 'EXPIRED'];

// Client slot names that predate the schema's placement enum. The frozen CHECK
// constraint only knows the four values above, so several app slots deliberately
// collapse onto one placement — a limitation of the shape, not of this mapping.
const LEGACY_SLOT_ALIASES = {
  GROCERY_HERO_CAROUSEL: 'HOME_BANNER',
  FOOD_HOME_BANNER: 'HOME_BANNER',
  RIDE_HERO_BANNER: 'HOME_BANNER',
  PARCEL_HERO_BANNER: 'HOME_BANNER',
  GROCERY_IN_FEED_BANNER: 'SEARCH_INLINE',
  FOOD_IN_FEED_BANNER: 'SEARCH_INLINE',
  SEARCH_RESULTS_INLINE: 'SEARCH_INLINE',
  GROCERY_CHECKOUT_BANNER: 'CHECKOUT',
  CHECKOUT_BANNER: 'CHECKOUT',
  DRIVER_HOME_BANNER: 'DRIVER_IDLE'
};

// Campaign fields the apps used to receive from the in-memory engine and that
// `advertisements` has no column for. Writes naming them are rejected with
// ADVERTISEMENT_FIELD_UNSUPPORTED so an operator is never told a bid rate,
// priority or brand was saved when nothing recorded it.
const UNSUPPORTED_FIELDS = [
  'brand', 'tagline', 'industryCategory', 'sponsorBadge', 'service',
  'ctaText', 'bgGradient', 'accentColor', 'targetCategory',
  'bidRateCpm', 'priority'
];

const WRITABLE_FIELDS = [
  'title', 'placement', 'slot', 'merchantId', 'merchant_id', 'imageUrl',
  'image_url', 'targetUrl', 'target_url', 'ctaLink', 'status',
  'startDate', 'start_date', 'endDate', 'end_date'
];

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRowToDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    placement: row.placement,
    // `slot` is kept as a read alias so the apps that filter by slot keep working.
    slot: row.placement,
    merchantId: row.merchant_id || null,
    imageUrl: row.image_url,
    targetUrl: row.target_url || null,
    ctaLink: row.target_url || null,
    status: row.status,
    startDate: toIsoDate(row.start_date),
    endDate: toIsoDate(row.end_date),
    clicks: Number(row.clicks || 0),
    impressions: Number(row.impressions || 0),
    ctr: Number(row.impressions || 0) > 0
      ? Number(((Number(row.clicks || 0) / Number(row.impressions)) * 100).toFixed(2))
      : 0,
    createdAt: row.created_at,
    // These have no column. They are reported as absent-by-design instead of
    // being filled in with a plausible-looking default.
    priority: null,
    bidRateCpm: null,
    brand: null,
    tagline: null,
    service: 'ALL'
  };
}

function resolvePlacement(raw) {
  if (!raw) return { placement: null, aliasOf: null };
  const value = String(raw).trim().toUpperCase();
  if (PLACEMENTS.includes(value)) return { placement: value, aliasOf: null };
  if (LEGACY_SLOT_ALIASES[value]) {
    return { placement: LEGACY_SLOT_ALIASES[value], aliasOf: value };
  }
  return { placement: null, aliasOf: null, rejected: value };
}

function pickUnsupported(payload) {
  if (!payload || typeof payload !== 'object') return [];
  return UNSUPPORTED_FIELDS.filter(field => payload[field] !== undefined);
}

function pickUnknown(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const known = new Set([...WRITABLE_FIELDS, ...UNSUPPORTED_FIELDS]);
  return Object.keys(payload).filter(key => !known.has(key));
}

function toInsert(payload) {
  const placement = resolvePlacement(payload.placement || payload.slot).placement;
  const start = toIsoDate(payload.startDate || payload.start_date);
  const end = toIsoDate(payload.endDate || payload.end_date);
  const errors = [];
  if (!payload.title || !String(payload.title).trim()) {
    errors.push('title is required (max 150 characters).');
  } else if (String(payload.title).length > 150) {
    errors.push('title exceeds 150 characters.');
  }
  if (!placement) {
    errors.push(`placement must be one of ${PLACEMENTS.join(', ')}.`);
  }
  if (!payload.imageUrl && !payload.image_url) {
    errors.push('imageUrl is required.');
  }
  if (!start) errors.push('startDate is required and must be a valid date.');
  if (!end) errors.push('endDate is required and must be a valid date.');
  if (start && end && new Date(end) <= new Date(start)) {
    errors.push('endDate must be after startDate.');
  }
  const status = payload.status || 'ACTIVE';
  if (!STATUSES.includes(status)) {
    errors.push(`status must be one of ${STATUSES.join(', ')}.`);
  }
  if (errors.length) {
    const error = new Error(errors.join(' '));
    error.code = 'ADVERTISEMENT_VALIDATION_FAILED';
    error.details = { errors, supportedPlacements: PLACEMENTS };
    throw error;
  }
  return {
    title: String(payload.title).trim(),
    placement,
    merchant_id: payload.merchantId || payload.merchant_id || null,
    image_url: (payload.imageUrl || payload.image_url).trim(),
    target_url: (payload.targetUrl || payload.target_url || payload.ctaLink || null),
    status,
    start_date: start,
    end_date: end
  };
}

class AdvertisementRepository {
  constructor(db) {
    this.db = db;
  }

  get live() {
    return Boolean(isLivePostgres && supabaseAdmin);
  }

  list({ placement = null, status = null, withinDateWindow = false } = {}) {
    if (!this.live) return Promise.resolve(null);
    let query = supabaseAdmin.from('advertisements').select('*');
    if (placement) query = query.eq('placement', placement);
    if (status) query = query.eq('status', status);
    if (withinDateWindow) {
      const now = new Date().toISOString();
      query = query.lte('start_date', now).gte('end_date', now);
    }
    // No priority column exists, so the ordering is published rather than implied.
    query = query.order('start_date', { ascending: false }).order('created_at', { ascending: false });
    return query;
  }

  async fetchAdvertisements(options) {
    const { data, error } = await this.list(options);
    if (error) throw error;
    return (data || []).map(mapRowToDTO);
  }

  async getAdvertisement(id) {
    if (!this.live) return null;
    const { data, error } = await supabaseAdmin.from('advertisements')
      .select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return mapRowToDTO(data);
  }

  async createAdvertisement(payload) {
    if (!this.live) return null;
    const row = toInsert(payload);
    const { data, error } = await supabaseAdmin.from('advertisements')
      .insert(row).select('*').single();
    if (error) throw error;
    return mapRowToDTO(data);
  }

  async updateAdvertisement(id, patch) {
    if (!this.live) return null;
    const update = {};
    if (patch.title !== undefined) {
      if (!String(patch.title).trim() || String(patch.title).length > 150) {
        const error = new Error('title must be between 1 and 150 characters.');
        error.code = 'ADVERTISEMENT_VALIDATION_FAILED';
        throw error;
      }
      update.title = String(patch.title).trim();
    }
    if (patch.placement !== undefined || patch.slot !== undefined) {
      const resolved = resolvePlacement(patch.placement || patch.slot);
      if (!resolved.placement) {
        const error = new Error(
          `placement must be one of ${PLACEMENTS.join(', ')}.`
        );
        error.code = 'ADVERTISEMENT_VALIDATION_FAILED';
        error.details = { supportedPlacements: PLACEMENTS };
        throw error;
      }
      update.placement = resolved.placement;
    }
    if (patch.imageUrl !== undefined || patch.image_url !== undefined) {
      update.image_url = String(patch.imageUrl ?? patch.image_url).trim();
    }
    if (patch.targetUrl !== undefined || patch.target_url !== undefined || patch.ctaLink !== undefined) {
      update.target_url = patch.targetUrl ?? patch.target_url ?? patch.ctaLink ?? null;
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) {
        const error = new Error(`status must be one of ${STATUSES.join(', ')}.`);
        error.code = 'ADVERTISEMENT_VALIDATION_FAILED';
        throw error;
      }
      update.status = patch.status;
    }
    if (patch.startDate !== undefined || patch.start_date !== undefined) {
      update.start_date = toIsoDate(patch.startDate ?? patch.start_date);
    }
    if (patch.endDate !== undefined || patch.end_date !== undefined) {
      update.end_date = toIsoDate(patch.endDate ?? patch.end_date);
    }
    if (patch.merchantId !== undefined || patch.merchant_id !== undefined) {
      update.merchant_id = patch.merchantId ?? patch.merchant_id ?? null;
    }
    if (update.start_date && update.end_date && new Date(update.end_date) <= new Date(update.start_date)) {
      const error = new Error('endDate must be after startDate.');
      error.code = 'ADVERTISEMENT_VALIDATION_FAILED';
      throw error;
    }
    if (!Object.keys(update).length) {
      return this.getAdvertisement(id);
    }
    const { data, error } = await supabaseAdmin.from('advertisements')
      .update(update).eq('id', id).select('*').maybeSingle();
    if (error) throw error;
    return mapRowToDTO(data);
  }

  async deleteAdvertisement(id) {
    if (!this.live) return null;
    const existing = await this.getAdvertisement(id);
    if (!existing) return null;
    const { error } = await supabaseAdmin.from('advertisements').delete().eq('id', id);
    if (error) throw error;
    return existing;
  }

  /**
   * Counters are analytics, not money, and PostgREST cannot do `col = col + 1`
   * without an RPC (which would need a migration). So this is a best-effort
   * read-modify-write: two simultaneous impressions can lose one increment.
   */
  async bumpCounter(id, field) {
    if (!this.live) return null;
    const { data, error } = await supabaseAdmin.from('advertisements')
      .select('id, clicks, impressions').eq('id', id).maybeSingle();
    if (error || !data) return null;
    const next = Number(data[field] || 0) + 1;
    const { data: updated, error: updateError } = await supabaseAdmin.from('advertisements')
      .update({ [field]: next }).eq('id', id).select('*').maybeSingle();
    if (updateError) return null;
    return mapRowToDTO(updated);
  }
}

module.exports = AdvertisementRepository;
module.exports.PLACEMENTS = PLACEMENTS;
module.exports.STATUSES = STATUSES;
module.exports.LEGACY_SLOT_ALIASES = LEGACY_SLOT_ALIASES;
module.exports.UNSUPPORTED_FIELDS = UNSUPPORTED_FIELDS;
module.exports.resolvePlacement = resolvePlacement;
module.exports.pickUnsupported = pickUnsupported;
module.exports.pickUnknown = pickUnknown;
module.exports.mapRowToDTO = mapRowToDTO;
