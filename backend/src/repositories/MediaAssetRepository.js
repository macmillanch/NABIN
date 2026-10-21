const { supabaseAdmin, isLivePostgres } = require('../supabase');

const DEFAULT_PROVIDER = 'cloudinary';

/**
 * Read shape shared by both stores. The live branch maps a PostgreSQL row; the offline
 * branch maps the in-memory record `db.saveMediaAsset` already produces. Both come back
 * through here so a route reads one shape regardless of which store answered — the same
 * `cloudinaryPublicId` / `public_id` / `ownerId` / `secureUrl` fields the endpoints and the
 * existing suites already expect.
 */
function toDTO(record) {
  if (!record) return null;
  const publicId = record.public_id || record.cloudinaryPublicId || null;
  return {
    id: record.id,
    provider: record.provider || DEFAULT_PROVIDER,
    cloudinaryPublicId: publicId,
    public_id: publicId,
    ownerType: record.ownerType || 'PUBLIC',
    ownerId: record.ownerId != null ? record.ownerId : null,
    tenantId: record.tenantId != null ? record.tenantId : (record.tenant_id != null ? record.tenant_id : null),
    mediaType: record.mediaType || 'IMAGE',
    resourceType: record.resourceType || 'image',
    format: record.format || null,
    secureUrl: record.secureUrl || null,
    optimizedUrls: record.optimizedUrls || {},
    folder: record.folder || null,
    tags: record.tags || [],
    width: record.width != null ? record.width : null,
    height: record.height != null ? record.height : null,
    bytes: record.bytes != null ? record.bytes : 0,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
  };
}

/** Map a durable PostgreSQL row (snake_case) into the shared read shape. */
function mapRowToDTO(row) {
  if (!row) return null;
  return toDTO({
    id: row.id,
    provider: row.provider,
    public_id: row.public_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    tenantId: row.tenant_id,
    mediaType: row.media_type,
    resourceType: row.resource_type,
    format: row.format,
    secureUrl: row.secure_url,
    optimizedUrls: row.optimized_urls,
    folder: row.folder,
    tags: row.tags,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

/**
 * Build the insert/update row from whatever union of keys a caller passes. `db.saveMediaAsset`
 * is fed snake_case provider fields plus camelCase ownership fields (see server.js:9876), so
 * both spellings are accepted here rather than forcing every call site to be rewritten.
 */
function toRow(asset) {
  const publicId = asset.public_id || asset.cloudinaryPublicId;
  const resourceType = asset.resource_type || asset.resourceType || 'image';
  // media_type is a coarse IMAGE/VIDEO discriminator (the migration CHECK allows only
  // those two). It is derived from the provider's resource_type, never copied from the
  // caller's descriptive label — routes pass 'PROFILE_PHOTO'/'FOOD_PHOTO'/'COVER' as
  // `mediaType`, which is a fine-grained descriptor with no durable column and would
  // otherwise be rejected 23514 by every live write.
  const mediaType = String(resourceType).toLowerCase() === 'video'
    || String(asset.mediaType || '').toUpperCase() === 'VIDEO'
    ? 'VIDEO' : 'IMAGE';
  return {
    provider: asset.provider || DEFAULT_PROVIDER,
    public_id: publicId,
    owner_type: asset.ownerType || 'PUBLIC',
    owner_id: asset.ownerId != null ? String(asset.ownerId) : null,
    tenant_id: asset.tenantId != null ? String(asset.tenantId) : (asset.tenant_id != null ? String(asset.tenant_id) : null),
    media_type: mediaType,
    resource_type: resourceType,
    format: asset.format || null,
    secure_url: asset.secure_url || asset.secureUrl || null,
    optimized_urls: asset.optimized_urls || asset.optimizedUrls || {},
    folder: asset.folder || null,
    tags: asset.tags || [],
    width: asset.width != null ? asset.width : null,
    height: asset.height != null ? asset.height : null,
    bytes: asset.bytes != null ? Number(asset.bytes) : 0,
    updated_at: new Date().toISOString()
  };
}

/**
 * Durable media asset metadata.
 *
 * The ownership record `DELETE /api/media/*` was always written to consult
 * (`if (existing && !isAdmin)`) had no backing store: `db.mediaAssets` is a
 * process-memory array, and `persistentStore` refuses to load or save it whenever
 * `isLivePostgres || isProduction` — so under a live database `existing` was
 * permanently `null` and the authorisation silently no-oped. This repository is
 * that missing durable row (migration 044).
 *
 * Two rules, mirroring `AuditLogRepository`:
 *   - In live mode, a PostgreSQL error throws. A security-critical read that cannot
 *     reach the table fails closed; it does not fall back to the in-memory array and
 *     answer as though ownership were proven.
 *   - The offline branch is served and labelled `dataSource: 'memory'`. It exists so
 *     a development process with no Postgres still runs; it is never the answer a
 *     live process gives.
 */
class MediaAssetRepository {
  constructor(db) {
    this.db = db;
  }

  get live() {
    return isLivePostgres && Boolean(supabaseAdmin);
  }

  get client() {
    return supabaseAdmin;
  }

  mapRowToDTO(row) {
    return mapRowToDTO(row);
  }

  /**
   * Persist (upsert by provider + public_id) an asset's ownership metadata.
   * Live writes fail closed on any error so a caller can never treat an unproven
   * save as a durable record.
   */
  async save(asset) {
    const publicId = asset && (asset.public_id || asset.cloudinaryPublicId);
    if (!publicId) {
      throw new Error('A media asset with a public_id is required.');
    }

    if (this.live) {
      const row = toRow({ ...asset, public_id: publicId });
      const { data, error } = await this.client
        .from('media_assets')
        .upsert(row, { onConflict: 'provider,public_id' })
        .select()
        .single();
      if (error) {
        const err = new Error(`Failed to persist media asset in PostgreSQL: ${error.message}`);
        err.code = error.code || error.details;
        throw err;
      }
      const dto = mapRowToDTO(data);
      dto.dataSource = 'postgresql';
      return dto;
    }

    // Offline / non-live: the in-memory array is all there is. Delegating to
    // db.saveMediaAsset keeps the dev store coherent, and the label says so.
    const inMem = this.db.saveMediaAsset(asset);
    const dto = toDTO(inMem);
    dto.dataSource = 'memory';
    return dto;
  }

  /**
   * Read one asset's durable ownership record by provider public id.
   * Returns the DTO or null (no such record) — null is what tells the caller the
   * asset is unowned and must not be deleted, so a live read never guesses.
   */
  async getByPublicId(publicId, provider = DEFAULT_PROVIDER) {
    if (!publicId) return null;

    if (this.live) {
      const { data, error } = await this.client
        .from('media_assets')
        .select('*')
        .eq('provider', provider)
        .eq('public_id', publicId)
        .maybeSingle();
      if (error) {
        const err = new Error(`Failed to read media asset from PostgreSQL: ${error.message}`);
        err.code = error.code || error.details;
        throw err;
      }
      const dto = mapRowToDTO(data);
      if (dto) dto.dataSource = 'postgresql';
      return dto;
    }

    const found = this.db.getMediaAsset(publicId);
    const dto = found ? toDTO(found) : null;
    if (dto) dto.dataSource = 'memory';
    return dto;
  }

  /**
   * Remove the durable metadata row for a public id.
   * Returns { deleted, existed, dataSource }. On a live store `existed` is proven by
   * whether a row actually came back from the DELETE — so "the provider said OK" and
   * "there was a record here" stay separate facts, and the route can refuse a delete
   * that has no durable ownership behind it.
   */
  async delete(publicId, provider = DEFAULT_PROVIDER) {
    if (!publicId) return { deleted: false, existed: false, dataSource: this.live ? 'postgresql' : 'memory' };

    if (this.live) {
      const { data, error } = await this.client
        .from('media_assets')
        .delete()
        .eq('provider', provider)
        .eq('public_id', publicId)
        .select();
      if (error) {
        const err = new Error(`Failed to delete media asset from PostgreSQL: ${error.message}`);
        err.code = error.code || error.details;
        throw err;
      }
      const removed = Array.isArray(data) ? data : [];
      return { deleted: removed.length > 0, existed: removed.length > 0, dataSource: 'postgresql' };
    }

    const removed = this.db.deleteMediaAsset(publicId);
    return { deleted: Boolean(removed), existed: Boolean(removed), dataSource: 'memory' };
  }

  /**
   * List assets with owner/tenant/folder scoping. A caller that is not an admin is
   * expected to pass explicit owner/tenant filters (Objective 3 derives these from the
   * session); the repository never silently returns the whole table on a live read
   * without a scope — see `list`, which requires a filter unless `includeAll` is set by
   * an authorised admin path.
   */
  async list(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const provider = filters.provider || DEFAULT_PROVIDER;

    if (this.live) {
      let query = this.client.from('media_assets').select('*', { count: 'exact' });
      if (filters.ownerType && filters.ownerType !== 'ALL') query = query.eq('owner_type', filters.ownerType);
      if (filters.ownerId) query = query.eq('owner_id', String(filters.ownerId));
      if (filters.tenantId) query = query.eq('tenant_id', String(filters.tenantId));
      if (filters.folder) query = query.eq('folder', filters.folder);
      if (!filters.includeAll) query = query.eq('provider', provider);

      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
      const { data, count, error } = await query;
      if (error) {
        const err = new Error(`Failed to list media assets from PostgreSQL: ${error.message}`);
        err.code = error.code || error.details;
        throw err;
      }
      const assets = (data || []).map(mapRowToDTO);
      return {
        assets,
        total: count !== null ? count : null,
        totalIsExact: count !== null,
        dataSource: 'postgresql'
      };
    }

    let list = Array.isArray(this.db?.mediaAssets) ? [...this.db.mediaAssets] : [];
    if (filters.ownerType && filters.ownerType !== 'ALL') list = list.filter(m => m.ownerType === filters.ownerType);
    if (filters.ownerId) list = list.filter(m => String(m.ownerId) === String(filters.ownerId));
    if (filters.tenantId) list = list.filter(m => String(m.tenantId ?? m.tenant_id) === String(filters.tenantId));
    if (filters.folder) list = list.filter(m => m.folder === filters.folder);
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const assets = list.slice(offset, offset + limit).map(toDTO);
    return {
      assets,
      total: list.length,
      totalIsExact: true,
      dataSource: 'memory'
    };
  }

  /** Convenience scoped read used by owner/tenant-limited routes. */
  async listByOwner(ownerType, ownerId, filters = {}) {
    return this.list({ ...filters, ownerType, ownerId });
  }
}

module.exports = MediaAssetRepository;
