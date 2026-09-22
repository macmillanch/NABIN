const { isLivePostgres, supabaseAdmin, isStoreUnreachable } = require('../supabase');

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

// The campaign row's own columns, with every key spelling the API accepts for them.
// A write names only the fields the request actually sent. Rewriting the whole merged
// row back to PostgreSQL is how one admin's save silently un-does another's, and that
// is the lost update this file exists to prevent.
const CAMPAIGN_PATCH_FIELDS = [
  { field: 'code', column: 'code', aliases: ['code'] },
  { field: 'name', column: 'name', aliases: ['name'] },
  { field: 'status', column: 'status', aliases: ['status'] },
  { field: 'priority', column: 'priority', aliases: ['priority'] },
  { field: 'serviceTypes', column: 'service_types', aliases: ['serviceTypes', 'service_types'] },
  { field: 'startsAt', column: 'starts_at', aliases: ['startsAt', 'starts_at'] },
  { field: 'endsAt', column: 'ends_at', aliases: ['endsAt', 'ends_at'] },
  { field: 'isActive', column: 'is_active', aliases: ['isActive', 'is_active'] },
  { field: 'description', column: 'description', aliases: ['description'] }
];

function campaignError(code, message, status, details) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

// A store that is refusing and a store that is gone are different answers. An outage
// dressed up as a 4xx tells a client its data is wrong, so it retries with other data
// instead of backing off — and an operator waiting for a festival to publish learns
// nothing about which of the two happened.
//
// The test itself now lives in supabase.js next to the shared classifier, because the
// rest of the API needed the same judgement and two copies of it drift: this one did
// not know PostgREST's `PGRST001` wire code, so an unreachable database reached the
// admin campaign list as a 500 carrying that code in its body.

// PostgreSQL's rejection codes translated into something an operator can act on. The
// database's own wording is logged rather than sent: `duplicate key value violates
// unique constraint "campaigns_code_key"` is a schema diagram, not an error message.
function storeRejection(err) {
  if (isStoreUnreachable(err)) {
    return campaignError('CAMPAIGNS_UNAVAILABLE',
      'Campaign storage is not reachable, so nothing was written. Try again once PostgreSQL answers.', 503);
  }
  if (err && err.code === '23505') {
    const constraint = String((err.details && err.details.constraint) || err.message || '');
    if (constraint.includes('campaigns_code_key')) {
      return campaignError('CAMPAIGN_CODE_TAKEN',
        'Another campaign already uses that code. A code is how every client asks for one campaign, so two cannot share it — use a different code, or edit the campaign that already has this one.', 409);
    }
    return campaignError('CAMPAIGN_ROW_EXISTS',
      'The campaign already holds a row that must stay unique, so the change was refused.', 409);
  }
  return null;
}

// Thrown when the row moved out from under a guarded write. Deleting a campaign
// archives it rather than removing it, so the row is always there and zero rows
// updated can only mean the state this request read has already changed.
function staleWriteError(guard = {}) {
  if (guard.status !== undefined) {
    return campaignError('CAMPAIGN_STATE_CHANGED',
      `Someone else changed this campaign while you were deciding — it is no longer ${guard.status}. Read it again before moving it.`, 409);
  }
  return campaignError('CAMPAIGN_STALE_EDIT',
    `This campaign was edited after you loaded it (revision ${guard.updatedAt}). Read the current revision and re-apply your change, so the other edit survives.`, 412);
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

  // supabase-js answers a failed request two different ways: a PostgREST error sitting
  // in `.error`, or a thrown network failure. Both mean the write did not happen, and
  // a read that fails this way must never be reported as "no rows" — an unreachable
  // store and an empty campaign are not the same answer to give a client.
  async settle(builder) {
    let result;
    try {
      result = await builder;
    } catch (err) {
      throw (isStoreUnreachable(err)
        ? campaignError('CAMPAIGNS_UNAVAILABLE', 'Campaign storage is not reachable, so nothing was written.', 503)
        : storeRejection(err) || err);
    }
    if (result.error) throw storeRejection(result.error) || result.error;
    return result.data;
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
      throw campaignError('CAMPAIGNS_UNAVAILABLE', 'Campaigns are stored in PostgreSQL and it is not available.', 503);
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
      const promo = await this.settle(
        supabaseAdmin.from('promotions').select('id, code').eq('id', promotionId).maybeSingle()
      );
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
    // Two operators claiming one code at the same moment is answered by the database's
    // UNIQUE, not by a read-then-write that can both see "free".
    const created = await this.settle(supabaseAdmin.from('campaigns').insert({
      ...row,
      created_by: String(admin.id || admin.username || 'ADMIN').slice(0, 100)
    }).select().single());

    const campaignId = created.id;
    try {
      let savedAssets = [];
      if (assets && assets.length) {
        savedAssets = await this.settle(supabaseAdmin.from('campaign_assets')
          .insert(assets.map(a => ({ ...a, campaign_id: campaignId }))).select()) || [];
      }
      if (theme) {
        await this.settle(supabaseAdmin.from('campaign_themes')
          .insert({ campaign_id: campaignId, palette: theme, ...themeAssetLinks(payload.theme, savedAssets) }));
      }
      if (offers && offers.length) {
        await this.settle(supabaseAdmin.from('campaign_offers')
          .insert(offers.map(o => ({ ...o, campaign_id: campaignId }))));
      }
      if (messages && messages.length) {
        await this.settle(supabaseAdmin.from('campaign_messages')
          .insert(messages.map(m => ({ ...m, campaign_id: campaignId }))));
      }
    } catch (childErr) {
      // A campaign whose banner failed to save would publish a festival with half its
      // face. ON DELETE CASCADE takes the partial children with the parent.
      console.error(`[campaigns] create rolled back after a child write failed: ${childErr.message}`);
      await supabaseAdmin.from('campaigns').delete().eq('id', campaignId);
      // Whatever the real cause was, the answer stays in its own class: an unreachable
      // store is not reported as bad input, and a unique collision is not a typo.
      if (childErr.status) throw childErr;
      throw campaignError('CAMPAIGN_CHILD_REJECTED',
        'One of the campaign’s assets, offers or messages was refused, so nothing was kept. Check those sections and send the whole campaign again.', 400);
    }
    return this.getCampaign(campaignId);
  }

  /**
   * Write a campaign, and only the row fields the patch actually names.
   *
   * `guard` is not optional: an edit carries the revision it was based on
   * ({ updatedAt }, which the client echoes back in If-Match) and a state change
   * carries the status it was offered from ({ status }). The guard value goes into the
   * UPDATE's own WHERE clause, so a row that moved after the caller read it updates
   * zero rows and the request is refused rather than quietly un-writing an edit it
   * never saw.
   */
  async updateCampaign(idOrCode, patch, admin = {}, { guard } = {}) {
    if (!this.live) {
      throw campaignError('CAMPAIGNS_UNAVAILABLE', 'Campaigns are stored in PostgreSQL and it is not available.', 503);
    }
    const existing = await this.getCampaign(idOrCode);
    if (!existing) return null;
    // No guard means nothing was read, and a write that read nothing cannot know what
    // it is about to overwrite. This is a programming error, not an operator's.
    if (!guard || (guard.status === undefined && !guard.updatedAt)) {
      throw campaignError('CAMPAIGN_GUARD_REQUIRED',
        'A campaign write has to name the state it read, so that concurrent writes refuse each other instead of overwriting each other.', 500);
    }

    const errors = [];
    // Schedule and targeting changes are validated against the stored row so a partial
    // patch cannot blank the window it did not mention. Validating the merged view is
    // not the same as writing it back, though: the write below stays inside the patch.
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

    // Every section the patch touches is shaped before the first row is written, so a
    // request that fails validation leaves the campaign exactly as it was.
    const sections = {};
    if (patch.assets !== undefined) sections.assets = normalizeAssets(patch.assets, errors);
    if (patch.theme !== undefined) {
      sections.themeSource = patch.theme;
      sections.theme = toPalette(patch.theme.palette ?? patch.theme, errors);
    }
    if (patch.offers !== undefined) sections.offers = await this.shapeOffers(patch.offers, errors);
    if (patch.messages !== undefined) sections.messages = normalizeMessages(patch.messages, errors);
    if (errors.length) {
      fail(errors, 'CAMPAIGN_VALIDATION_FAILED', { statuses: STATUSES, serviceTypes: SERVICE_TYPES });
    }

    const body = { updated_at: new Date().toISOString() };
    for (const { column, aliases } of CAMPAIGN_PATCH_FIELDS) {
      if (aliases.some(alias => patch[alias] !== undefined)) body[column] = shaped[column];
    }

    // The compare-and-set. `updated_at` moves on every write to this row, so it is the
    // revision; a token taken from an older read can no longer match it.
    let write = supabaseAdmin.from('campaigns').update(body).eq('id', existing.id);
    if (guard && guard.status !== undefined) write = write.eq('status', guard.status);
    if (guard && guard.updatedAt) write = write.eq('updated_at', guard.updatedAt);
    const written = await this.settle(write.select('id'));
    if (!written || !written.length) throw staleWriteError(guard);

    const applied = [];
    let savedAssets = existing.assets || [];
    try {
      if ('assets' in sections) {
        await this.settle(supabaseAdmin.from('campaign_assets').delete().eq('campaign_id', existing.id));
        savedAssets = (sections.assets && sections.assets.length)
          ? (await this.settle(supabaseAdmin.from('campaign_assets')
            .insert(sections.assets.map(a => ({ ...a, campaign_id: existing.id }))).select())) || []
          : [];
        applied.push('assets');
      }
      if ('theme' in sections) {
        await this.settle(supabaseAdmin.from('campaign_themes').upsert({
          campaign_id: existing.id,
          palette: sections.theme || {},
          // Re-linked against the rows this campaign now has, so replacing the
          // wordmark asset replaces the wordmark rather than dangling a stale id.
          ...themeAssetLinks(sections.themeSource, savedAssets),
          updated_at: new Date().toISOString()
        }, { onConflict: 'campaign_id' }));
        applied.push('theme');
      } else if ('assets' in sections && savedAssets.length) {
        // Swapping an asset row SET NULLs the theme's pointer to it, so replacing a
        // logo would silently take it out of the app. Re-point it at the new row of
        // the same kind, which is what the operator who just uploaded one expects.
        const themeRow = await this.settle(supabaseAdmin.from('campaign_themes')
          .select('id').eq('campaign_id', existing.id).maybeSingle());
        if (themeRow) {
          await this.settle(supabaseAdmin.from('campaign_themes')
            .update({ ...themeAssetLinks(null, savedAssets), updated_at: new Date().toISOString() })
            .eq('id', themeRow.id));
          applied.push('theme links');
        }
      }
      if ('offers' in sections) {
        await this.settle(supabaseAdmin.from('campaign_offers').delete().eq('campaign_id', existing.id));
        if (sections.offers && sections.offers.length) {
          await this.settle(supabaseAdmin.from('campaign_offers')
            .insert(sections.offers.map(o => ({ ...o, campaign_id: existing.id }))));
        }
        applied.push('offers');
      }
      if ('messages' in sections) {
        await this.settle(supabaseAdmin.from('campaign_messages').delete().eq('campaign_id', existing.id));
        if (sections.messages && sections.messages.length) {
          await this.settle(supabaseAdmin.from('campaign_messages')
            .insert(sections.messages.map(m => ({ ...m, campaign_id: existing.id }))));
        }
        applied.push('messages');
      }
    } catch (childErr) {
      // The campaign row is already committed by the time a child can fail, so this is
      // not a refused request — it is a half-applied one. Naming the sections that did
      // land is the only way an operator learns to go and look instead of assuming
      // nothing changed.
      console.error(`[campaigns] ${existing.code}: the campaign row was written, then a section failed: ${childErr.message}`);
      throw campaignError(childErr.code || 'CAMPAIGN_PARTIALLY_APPLIED',
        `The campaign row was saved${applied.length ? ` and so did ${applied.join(', ')}` : ''}, but a later section was refused. This campaign is in a part-applied state — read it back before saving again.`,
        childErr.status || 500,
        { applied });
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
    const query = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-/.test(String(idOrCode))
      ? supabaseAdmin.from('campaigns').select('*').eq('id', idOrCode)
      : supabaseAdmin.from('campaigns').select('*').eq('code', code);
    return (await this.settle(query.maybeSingle())) || null;
  }

  async getCampaign(idOrCode) {
    const row = await this.findByCodeOrId(idOrCode);
    if (!row) return null;
    const campaign = mapCampaign(row);
    campaign.effectiveStatus = effectiveStatus(campaign);
    // A child section that fails to read is an error, not an empty list: publishing a
    // campaign with no banner because the banner query timed out would look like the
    // operator deleted it.
    const [themeRow, assetRows, offerRows, messageRows] = await Promise.all([
      this.settle(supabaseAdmin.from('campaign_themes').select('*').eq('campaign_id', campaign.id).maybeSingle()),
      this.settle(supabaseAdmin.from('campaign_assets').select('*').eq('campaign_id', campaign.id).order('priority', { ascending: false })),
      this.settle(supabaseAdmin.from('campaign_offers').select('id, service_type, copy, priority, promotion_id, promotions(code, name, discount_type, discount_value, max_discount, min_order_amount, is_active)').eq('campaign_id', campaign.id).order('priority', { ascending: false })),
      this.settle(supabaseAdmin.from('campaign_messages').select('*').eq('campaign_id', campaign.id).order('priority', { ascending: false }))
    ]);
    campaign.theme = themeRow ? { palette: themeRow.palette || {}, logoAssetId: themeRow.logo_asset_id, wordmarkAssetId: themeRow.wordmark_asset_id, splashAssetId: themeRow.splash_asset_id } : null;
    campaign.assets = (assetRows || []).map(a => ({
      id: a.id, kind: a.kind, url: a.url, cloudinaryPublicId: a.cloudinary_public_id,
      altText: a.alt_text, locale: a.locale, priority: Number(a.priority || 0)
    }));
    campaign.offers = (offerRows || []).map(o => ({
      id: o.id, serviceType: o.service_type, copy: o.copy, priority: Number(o.priority || 0),
      promotionId: o.promotion_id,
      coupon: o.promotions ? {
        code: o.promotions.code, name: o.promotions.name, discountType: o.promotions.discount_type,
        discountValue: Number(o.promotions.discount_value), maxDiscount: o.promotions.max_discount,
        minOrderAmount: Number(o.promotions.min_order_amount || 0), isActive: o.promotions.is_active !== false
      } : null
    }));
    campaign.messages = (messageRows || []).map(m => ({
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
    query = query.order('priority', { ascending: false }).order('starts_at', { ascending: false });
    const rows = (await this.settle(query)) || [];
    let campaigns = rows.map(row => {
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
    const rows = (await this.settle(supabaseAdmin.rpc('resolve_live_campaigns', {
      p_service_type: serviceType ? String(serviceType).toUpperCase() : null
    }))) || [];
    const limited = rows.slice(0, LIVE_PUBLICATION_LIMIT);
    const hydrated = [];
    for (const row of limited) {
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
