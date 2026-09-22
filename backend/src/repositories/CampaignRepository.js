const { isLivePostgres, supabaseAdmin } = require('../supabase');

// The campaign palette vocabulary is the same list the config feed publishes for the
// global theme. Two allow-lists that can drift apart would let a campaign publish a
// token no client can render, so the vocabulary lives here once.
const THEME_TOKENS = [
  'brand', 'brandTint', 'onBrand',
  'canvas', 'surface', 'surfaceMuted', 'surfaceEmphasized',
  'onSurface', 'onSurfaceMuted', 'divider',
  'success', 'warning', 'danger',
  'foodAccent', 'groceryAccent'
];

const SERVICE_TYPES = ['RIDE', 'FOOD', 'GROCERY', 'PARCEL'];
const STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ARCHIVED'];
const ASSET_KINDS = ['LOGO', 'WORDMARK', 'BANNER', 'PROMOTIONAL_IMAGE', 'POPUP_BACKGROUND', 'SPLASH', 'FAVICON'];
const MESSAGE_KINDS = ['ANNOUNCEMENT', 'POPUP', 'INLINE_BANNER', 'TOAST'];
const TRIGGER_EVENTS = ['APP_OPEN', 'HOME', 'POST_TRIP', 'IDLE', 'CART'];
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,39}$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const PRIORITY_LIMIT = 1000;
// A feed that carries every live campaign is not a design choice, it is a client
// rendering the first one and ignoring the rest.
const LIVE_PUBLICATION_LIMIT = 5;

function fail(errors, code = 'CAMPAIGN_VALIDATION_FAILED', details = {}) {
  const error = new Error(errors.join(' '));
  error.code = code;
  error.details = { errors, ...details };
  throw error;
}

function toTimestamp(value, field, errors, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) errors.push(`${field} is required.`);
    return null;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    errors.push(`${field} must be an ISO 8601 timestamp.`);
    return null;
  }
  return new Date(ms).toISOString();
}

function toPriority(value, errors) {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isInteger(n) || Math.abs(n) > PRIORITY_LIMIT) {
    errors.push(`priority must be an integer between -${PRIORITY_LIMIT} and ${PRIORITY_LIMIT}.`);
    return 0;
  }
  return n;
}

function toServiceList(value, field, errors) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  const clean = [];
  for (const item of list) {
    const up = String(item || '').trim().toUpperCase();
    if (!up) continue;
    if (!SERVICE_TYPES.includes(up)) {
      errors.push(`${field} accepts only ${SERVICE_TYPES.join(', ')}.`);
      continue;
    }
    if (!clean.includes(up)) clean.push(up);
  }
  return clean;
}

function toPalette(value, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    errors.push('theme.palette must be an object of token names to #RRGGBB colours.');
    return null;
  }
  const palette = {};
  const rejected = [];
  for (const [token, color] of Object.entries(value)) {
    if (!THEME_TOKENS.includes(token) || typeof color !== 'string' || !HEX_COLOR.test(color)) {
      rejected.push(token);
      continue;
    }
    palette[token] = color.toUpperCase();
  }
  if (rejected.length) {
    // Naming the offenders is the difference between an operator fixing a typo and
    // an operator wondering why a campaign looks unchanged.
    errors.push(`theme.palette rejected unknown tokens or non-hex colours: ${rejected.join(', ')}.`);
  }
  return palette;
}

// A campaign's logos are its own asset rows, linked by kind. An operator who
// uploads a WORDMARK asset is publishing a wordmark, so the theme row points at
// it here rather than waiting for a UUID to be pasted into a JSON blob — without
// that, the one thing the requirement asks for (a festival logo with no new
// build) would need a database round-trip to use.
function themeAssetLinks(theme, assets) {
  const source = theme && typeof theme === 'object' && !Array.isArray(theme) ? theme : {};
  const pick = (kind, explicit) => {
    if (explicit) return String(explicit);
    const matching = (assets || [])
      .filter(asset => asset.kind === kind)
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0));
    return matching.length ? String(matching[0].id) : null;
  };
  return {
    logo_asset_id: pick('LOGO', source.logoAssetId || source.logo_asset_id),
    wordmark_asset_id: pick('WORDMARK', source.wordmarkAssetId || source.wordmark_asset_id),
    splash_asset_id: pick('SPLASH', source.splashAssetId || source.splash_asset_id)
  };
}

function normalizeAssets(value, errors) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    errors.push('assets must be an array.');
    return null;
  }
  const rows = [];
  for (const asset of value) {
    const kind = String((asset && (asset.kind)) || '').toUpperCase();
    if (!ASSET_KINDS.includes(kind)) {
      errors.push(`Each asset needs a kind from ${ASSET_KINDS.join(', ')}.`);
      continue;
    }
    const url = String((asset && (asset.url || asset.imageUrl)) || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      errors.push('Each asset needs an http(s) url.');
      continue;
    }
    rows.push({
      kind,
      url,
      cloudinary_public_id: asset.cloudinaryPublicId || asset.cloudinary_public_id || null,
      alt_text: asset.altText ? String(asset.altText).slice(0, 200) : null,
      locale: String(asset.locale || 'en').slice(0, 10),
      priority: toPriority(asset.priority, errors)
    });
  }
  return rows;
}

function normalizeMessages(value, errors) {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    errors.push('messages must be an array.');
    return null;
  }
  const rows = [];
  for (const message of value) {
    const kind = String((message && message.kind) || '').toUpperCase();
    if (!MESSAGE_KINDS.includes(kind)) {
      errors.push(`Each message needs a kind from ${MESSAGE_KINDS.join(', ')}.`);
      continue;
    }
    const title = String((message && message.title) || '').trim();
    const body = String((message && message.body) || '').trim();
    if (!title || !body) {
      errors.push('Each message needs a title and a body.');
      continue;
    }
    const trigger = String((message && message.triggerEvent) || 'APP_OPEN').toUpperCase();
    if (!TRIGGER_EVENTS.includes(trigger)) {
      errors.push(`Each message needs a triggerEvent from ${TRIGGER_EVENTS.join(', ')}.`);
      continue;
    }
    rows.push({
      kind,
      title: title.slice(0, 150),
      body,
      surface: String((message && message.surface) || 'CUSTOMER_HOME').trim().slice(0, 40).toUpperCase(),
      trigger_event: trigger,
      dismissible: message.dismissible !== false,
      show_once: message.showOnce === true,
      locale: String((message && message.locale) || 'en').slice(0, 10),
      priority: toPriority(message.priority, errors)
    });
  }
  return rows;
}

function mapCampaign(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status,
    priority: Number(row.priority || 0),
    serviceTypes: row.service_types || [],
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    isActive: row.is_active !== false,
    description: row.description || null,
    createdBy: row.created_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// Mirrors public.campaign_effective_status() in PostgreSQL. Both exist because the
// admin list wants a status for every row while the client publication wants the
// database's own answer; the rules are written once in SQL and this copy is checked
// against it by the regression suite rather than trusted.
function effectiveStatus(campaign, at = new Date()) {
  const now = at instanceof Date ? at : new Date(at);
  if (['DRAFT', 'PAUSED', 'ARCHIVED'].includes(campaign.status)) return campaign.status;
  if (campaign.isActive === false) return 'PAUSED';
  if (now >= new Date(campaign.endsAt)) return 'EXPIRED';
  if (now < new Date(campaign.startsAt)) return 'SCHEDULED';
  return 'ACTIVE';
}

class CampaignRepository {
  constructor(db) {
    this.db = db;
  }

  get live() {
    return Boolean(isLivePostgres && supabaseAdmin);
  }

  // --- authoring -------------------------------------------------------------

  buildCampaignRow(payload, { errors, requireSchedule = true } = {}) {
    const code = String(payload.code || '').trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) {
      errors.push('code is required: 2-40 characters, A-Z 0-9 _ - and it must start with a letter or digit.');
    }
    const name = String(payload.name || '').trim();
    if (!name) errors.push('name is required.');
    if (name.length > 150) errors.push('name must be 150 characters or fewer.');

    const status = payload.status === undefined || payload.status === null ? 'DRAFT' : String(payload.status).toUpperCase();
    if (!STATUSES.includes(status)) {
      errors.push(`status must be one of ${STATUSES.join(', ')}.`);
    }

    const startsAt = toTimestamp(payload.startsAt ?? payload.starts_at, 'startsAt', errors, { required: requireSchedule });
    const endsAt = toTimestamp(payload.endsAt ?? payload.ends_at, 'endsAt', errors, { required: requireSchedule });
    if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      errors.push('endsAt must be after startsAt.');
    }

    return {
      code,
      name,
      status,
      priority: toPriority(payload.priority, errors),
      service_types: toServiceList(payload.serviceTypes ?? payload.service_types, 'serviceTypes', errors),
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: payload.isActive === undefined ? payload.is_active !== false : Boolean(payload.isActive),
      description: payload.description ? String(payload.description).slice(0, 2000) : null
    };
  }

  async validateAndShape(payload, { requireSchedule = true } = {}) {
    if (!this.live) {
      const error = new Error('Campaigns are stored in PostgreSQL and it is not available.');
      error.code = 'CAMPAIGNS_UNAVAILABLE';
      throw error;
    }
    const errors = [];
    const row = this.buildCampaignRow(payload, { errors, requireSchedule });
    const theme = payload.theme === undefined ? null : toPalette(payload.theme.palette ?? payload.theme, errors);
    const assets = normalizeAssets(payload.assets, errors);
    const messages = normalizeMessages(payload.messages, errors);
    const offers = payload.offers === undefined ? null : await this.shapeOffers(payload.offers, errors);
    if (errors.length) {
      fail(errors, 'CAMPAIGN_VALIDATION_FAILED', {
        statuses: STATUSES, serviceTypes: SERVICE_TYPES, assetKinds: ASSET_KINDS, themeTokens: THEME_TOKENS
      });
    }
    return { row, theme, assets, messages, offers };
  }

  // Offers are promotions by reference. Copying a discount onto the campaign would
  // put a second number in the system that checkout does not consult, so the coupon
  // row is verified to exist and is joined at read time instead.
  async shapeOffers(value, errors) {
    if (!Array.isArray(value)) {
      errors.push('offers must be an array.');
      return null;
    }
    const rows = [];
    for (const offer of value) {
      const promotionId = String((offer && (offer.promotionId || offer.promotion_id)) || '').trim();
      const serviceType = String((offer && offer.serviceType) || '').toUpperCase();
      if (!/^[0-9a-fA-F-]{36}$/.test(promotionId)) {
        errors.push('Each offer needs a promotionId (the coupon it points at).');
        continue;
      }
      if (!SERVICE_TYPES.includes(serviceType)) {
        errors.push(`Each offer needs a serviceType from ${SERVICE_TYPES.join(', ')}.`);
        continue;
      }
      const { data: promo, error: promoErr } = await supabaseAdmin.from('promotions')
        .select('id, code').eq('id', promotionId).maybeSingle();
      if (promoErr) throw promoErr;
      if (!promo) {
        errors.push(`offer references a promotion that does not exist: ${promotionId}.`);
        continue;
      }
      rows.push({
        promotion_id: promo.id,
        service_type: serviceType,
        copy: offer.copy ? String(offer.copy).slice(0, 150) : null,
        priority: toPriority(offer.priority, errors)
      });
    }
    const seen = new Set();
    return rows.filter(r => {
      if (seen.has(r.promotion_id)) return false;
      seen.add(r.promotion_id);
      return true;
    });
  }

  async createCampaign(payload, admin = {}) {
    const { row, theme, assets, messages, offers } = await this.validateAndShape(payload);
    const created = await supabaseAdmin.from('campaigns').insert({
      ...row,
      created_by: String(admin.id || admin.username || 'ADMIN').slice(0, 100)
    }).select().single();
    if (created.error) throw created.error;

    const campaignId = created.data.id;
    try {
      let savedAssets = [];
      if (assets && assets.length) {
        const inserted = await supabaseAdmin.from('campaign_assets')
          .insert(assets.map(a => ({ ...a, campaign_id: campaignId }))).select();
        if (inserted.error) throw inserted.error;
        savedAssets = inserted.data || [];
      }
      if (theme) {
        const inserted = await supabaseAdmin.from('campaign_themes')
          .insert({ campaign_id: campaignId, palette: theme, ...themeAssetLinks(payload.theme, savedAssets) });
        if (inserted.error) throw inserted.error;
      }
      if (offers && offers.length) {
        const inserted = await supabaseAdmin.from('campaign_offers')
          .insert(offers.map(o => ({ ...o, campaign_id: campaignId })));
        if (inserted.error) throw inserted.error;
      }
      if (messages && messages.length) {
        const inserted = await supabaseAdmin.from('campaign_messages')
          .insert(messages.map(m => ({ ...m, campaign_id: campaignId })));
        if (inserted.error) throw inserted.error;
      }
    } catch (childErr) {
      // A campaign whose banner failed to save would publish a festival with half its
      // face. ON DELETE CASCADE takes the partial children with the parent.
      await supabaseAdmin.from('campaigns').delete().eq('id', campaignId);
      const error = new Error(`Campaign could not be saved completely: ${childErr.message}`);
      error.code = 'CAMPAIGN_CHILD_REJECTED';
      throw error;
    }
    return this.getCampaign(campaignId);
  }

  async updateCampaign(idOrCode, patch, admin = {}) {
    if (!this.live) {
      const error = new Error('Campaigns are stored in PostgreSQL and it is not available.');
      error.code = 'CAMPAIGNS_UNAVAILABLE';
      throw error;
    }
    const existing = await this.getCampaign(idOrCode);
    if (!existing) return null;

    const errors = [];
    const body = {};
    // Schedule and targeting changes are merged with the stored row so a partial
    // patch cannot blank the window it did not mention.
    const merged = {
      code: patch.code ?? existing.code,
      name: patch.name ?? existing.name,
      status: patch.status ?? existing.status,
      priority: patch.priority ?? existing.priority,
      serviceTypes: patch.serviceTypes ?? existing.serviceTypes,
      startsAt: patch.startsAt ?? existing.startsAt,
      endsAt: patch.endsAt ?? existing.endsAt,
      isActive: patch.isActive ?? existing.isActive,
      description: patch.description ?? existing.description
    };
    const shaped = this.buildCampaignRow(merged, { errors });
    if (errors.length) {
      fail(errors, 'CAMPAIGN_VALIDATION_FAILED', { statuses: STATUSES, serviceTypes: SERVICE_TYPES });
    }
    Object.assign(body, {
      code: shaped.code,
      name: shaped.name,
      status: shaped.status,
      priority: shaped.priority,
      service_types: shaped.service_types,
      starts_at: shaped.starts_at,
      ends_at: shaped.ends_at,
      is_active: shaped.is_active,
      description: shaped.description,
      updated_at: new Date().toISOString()
    });
    // created_by is the author of the campaign, not the last person who edited it;
    // that history is what audit_logs carries.

    const updated = await supabaseAdmin.from('campaigns').update(body).eq('id', existing.id).select();
    if (updated.error) throw updated.error;
    if (!updated.data || !updated.data.length) return null;

    let savedAssets = existing.assets || [];
    if (patch.assets !== undefined) {
      const assetErrors = [];
      const assets = normalizeAssets(patch.assets, assetErrors);
      if (assetErrors.length) fail(assetErrors);
      await supabaseAdmin.from('campaign_assets').delete().eq('campaign_id', existing.id);
      savedAssets = [];
      if (assets && assets.length) {
        const inserted = await supabaseAdmin.from('campaign_assets').insert(
          assets.map(a => ({ ...a, campaign_id: existing.id }))
        ).select();
        if (inserted.error) throw inserted.error;
        savedAssets = inserted.data || [];
      }
    }
    if (patch.theme !== undefined) {
      const themeErrors = [];
      const palette = toPalette(patch.theme.palette ?? patch.theme, themeErrors);
      if (themeErrors.length) fail(themeErrors);
      const { error: themeErr } = await supabaseAdmin.from('campaign_themes')
        .upsert({
          campaign_id: existing.id,
          palette: palette || {},
          // Re-linked against the rows this campaign now has, so replacing the
          // wordmark asset replaces the wordmark rather than dangling a stale id.
          ...themeAssetLinks(patch.theme, savedAssets),
          updated_at: new Date().toISOString()
        }, { onConflict: 'campaign_id' });
      if (themeErr) throw themeErr;
    }
    if (patch.assets !== undefined && patch.theme === undefined && savedAssets.length) {
      // Swapping an asset row SET NULLs the theme's pointer to it, so replacing a
      // logo would silently take it out of the app. Re-point it at the new row of
      // the same kind, which is what the operator who just uploaded one expects.
      const { data: themeRow } = await supabaseAdmin.from('campaign_themes')
        .select('id').eq('campaign_id', existing.id).maybeSingle();
      if (themeRow) {
        const { error: relinkError } = await supabaseAdmin.from('campaign_themes')
          .update({ ...themeAssetLinks(null, savedAssets), updated_at: new Date().toISOString() })
          .eq('id', themeRow.id);
        if (relinkError) throw relinkError;
      }
    }
    if (patch.offers !== undefined) {
      const offerErrors = [];
      const offers = await this.shapeOffers(patch.offers, offerErrors);
      if (offerErrors.length) fail(offerErrors);
      await supabaseAdmin.from('campaign_offers').delete().eq('campaign_id', existing.id);
      if (offers && offers.length) {
        const inserted = await supabaseAdmin.from('campaign_offers').insert(
          offers.map(o => ({ ...o, campaign_id: existing.id }))
        );
        if (inserted.error) throw inserted.error;
      }
    }
    if (patch.messages !== undefined) {
      const messageErrors = [];
      const messages = normalizeMessages(patch.messages, messageErrors);
      if (messageErrors.length) fail(messageErrors);
      await supabaseAdmin.from('campaign_messages').delete().eq('campaign_id', existing.id);
      if (messages && messages.length) {
        const inserted = await supabaseAdmin.from('campaign_messages').insert(
          messages.map(m => ({ ...m, campaign_id: existing.id }))
        );
        if (inserted.error) throw inserted.error;
      }
    }
    return this.getCampaign(existing.id);
  }

  async deleteCampaign(idOrCode) {
    const existing = await this.getCampaign(idOrCode);
    if (!existing) return null;
    const { error } = await supabaseAdmin.from('campaigns').delete().eq('id', existing.id);
    if (error) throw error;
    return existing;
  }

  // --- reading ---------------------------------------------------------------

  async findByCodeOrId(idOrCode) {
    if (!this.live || !idOrCode) return null;
    const code = String(idOrCode).trim().toUpperCase();
    let query = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(String(idOrCode))
      ? supabaseAdmin.from('campaigns').select('*').eq('id', idOrCode)
      : supabaseAdmin.from('campaigns').select('*').eq('code', code);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async getCampaign(idOrCode) {
    const row = await this.findByCodeOrId(idOrCode);
    if (!row) return null;
    const campaign = mapCampaign(row);
    campaign.effectiveStatus = effectiveStatus(campaign);
    const [theme, assets, offers, messages] = await Promise.all([
      supabaseAdmin.from('campaign_themes').select('*').eq('campaign_id', campaign.id).maybeSingle(),
      supabaseAdmin.from('campaign_assets').select('*').eq('campaign_id', campaign.id).order('priority', { ascending: false }),
      supabaseAdmin.from('campaign_offers').select('id, service_type, copy, priority, promotion_id, promotions(code, name, discount_type, discount_value, max_discount, min_order_amount, is_active)').eq('campaign_id', campaign.id).order('priority', { ascending: false }),
      supabaseAdmin.from('campaign_messages').select('*').eq('campaign_id', campaign.id).order('priority', { ascending: false })
    ]);
    campaign.theme = theme.data ? { palette: theme.data.palette || {}, logoAssetId: theme.data.logo_asset_id, wordmarkAssetId: theme.data.wordmark_asset_id, splashAssetId: theme.data.splash_asset_id } : null;
    campaign.assets = (assets.data || []).map(a => ({
      id: a.id, kind: a.kind, url: a.url, cloudinaryPublicId: a.cloudinary_public_id,
      altText: a.alt_text, locale: a.locale, priority: Number(a.priority || 0)
    }));
    campaign.offers = (offers.data || []).map(o => ({
      id: o.id, serviceType: o.service_type, copy: o.copy, priority: Number(o.priority || 0),
      promotionId: o.promotion_id,
      coupon: o.promotions ? {
        code: o.promotions.code, name: o.promotions.name, discountType: o.promotions.discount_type,
        discountValue: Number(o.promotions.discount_value), maxDiscount: o.promotions.max_discount,
        minOrderAmount: Number(o.promotions.min_order_amount || 0), isActive: o.promotions.is_active !== false
      } : null
    }));
    campaign.messages = (messages.data || []).map(m => ({
      id: m.id, kind: m.kind, title: m.title, body: m.body, surface: m.surface,
      triggerEvent: m.trigger_event, dismissible: m.dismissible !== false,
      showOnce: m.show_once === true, locale: m.locale, priority: Number(m.priority || 0)
    }));
    return campaign;
  }

  async listCampaigns({ status = null, serviceType = null, includeArchived = true } = {}) {
    if (!this.live) return null;
    let query = supabaseAdmin.from('campaigns').select('*');
    if (status) query = query.eq('status', String(status).toUpperCase());
    if (!includeArchived) query = query.neq('status', 'ARCHIVED');
    const { data, error } = await query.order('priority', { ascending: false }).order('starts_at', { ascending: false });
    if (error) throw error;
    let campaigns = (data || []).map(row => {
      const campaign = mapCampaign(row);
      campaign.effectiveStatus = effectiveStatus(campaign);
      return campaign;
    });
    if (serviceType) {
      const wanted = String(serviceType).toUpperCase();
      campaigns = campaigns.filter(c => !c.serviceTypes.length || c.serviceTypes.includes(wanted));
    }
    return campaigns;
  }

  // What a client may be shown, decided by PostgreSQL's clock. The rows come back
  // already ordered by the same rule the admin preview reasons about: highest
  // priority wins, then the most recent schedule.
  async liveCampaigns(serviceType = null) {
    if (!this.live) return null;
    const { data, error } = await supabaseAdmin.rpc('resolve_live_campaigns', {
      p_service_type: serviceType ? String(serviceType).toUpperCase() : null
    });
    if (error) throw error;
    const rows = (data || []).slice(0, LIVE_PUBLICATION_LIMIT);
    const hydrated = [];
    for (const row of rows) {
      const campaign = await this.getCampaign(row.id);
      if (campaign) hydrated.push(campaign);
    }
    return hydrated;
  }
}

module.exports = {
  CampaignRepository,
  CAMPAIGN_THEME_TOKENS: THEME_TOKENS,
  CAMPAIGN_SERVICE_TYPES: SERVICE_TYPES,
  CAMPAIGN_STATUSES: STATUSES,
  CAMPAIGN_ASSET_KINDS: ASSET_KINDS,
  CAMPAIGN_MESSAGE_KINDS: MESSAGE_KINDS,
  effectiveStatus
};
