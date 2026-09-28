/**
 * DarkStoreRepository - durable data access for `dark_stores` (DS-2).
 *
 * Follows the existing repository shape (constructor(db), supabaseAdmin, parameterized
 * queries only). It is deliberately DUMB: no authorisation, no business rules, no
 * client-trusted identity. Those live in services/darkStoreService.js, which is the only
 * layer routes may call. Nothing here accepts a where/orderBy/select fragment from a caller.
 *
 * RLS is enabled on this table with zero policies and service-role-only grants, so every
 * call here runs on the service-role client by construction; a non-service-role connection
 * would simply see nothing. That is the design (migration 031, mirroring 029's pattern)
 * and it is why authorisation must - and does - happen above this layer.
 */
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const STORE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED'];

class DarkStoreRepository {
  constructor(db) {
    this.db = db;
  }

  /** @returns {boolean} false when the durable store is unavailable, so callers fail closed. */
  available() {
    return Boolean(isLivePostgres && supabaseAdmin);
  }

  static unavailable() {
    const err = new Error('Dark stores are read from the authoritative dark_stores table, which is '
      + 'not available. Refusing to answer from memory.');
    err.code = 'DARK_STORE_STORE_UNAVAILABLE';
    err.status = 503;
    err.statusCode = 503;
    return err;
  }

  async create(payload) {
    if (!this.available()) throw DarkStoreRepository.unavailable();
    const { data, error } = await supabaseAdmin.from('dark_stores').insert({
      code: payload.code,
      name: payload.name,
      status: payload.status || 'DRAFT',
      operated_by_merchant_id: payload.operatedByMerchantId || null,
      address: payload.address,
      latitude: payload.latitude,
      longitude: payload.longitude,
      service_radius_m: payload.serviceRadiusM,
      timezone: payload.timezone,
      opens_at: payload.opensAt || null,
      closes_at: payload.closesAt || null,
    }).select('*').single();
    if (error) throw error;
    return data;
  }

  async findById(id) {
    if (!this.available()) throw DarkStoreRepository.unavailable();
    const { data, error } = await supabaseAdmin.from('dark_stores')
      .select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /** Only the two filters that exist today. No pagination contract has been requested. */
  async list({ status = null, operatedByMerchantId = null } = {}) {
    if (!this.available()) throw DarkStoreRepository.unavailable();
    let query = supabaseAdmin.from('dark_stores').select('*').order('created_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (operatedByMerchantId) query = query.eq('operated_by_merchant_id', operatedByMerchantId);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  /** Whitelist-only update: an unknown key is dropped rather than reaching the database. */
  async update(id, changes = {}) {
    if (!this.available()) throw DarkStoreRepository.unavailable();
    const allowed = ['name', 'address', 'latitude', 'longitude', 'service_radius_m',
      'timezone', 'opens_at', 'closes_at', 'operated_by_merchant_id'];
    const patch = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(changes, key)) patch[key] = changes[key];
    if (!Object.keys(patch).length) return this.findById(id);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('dark_stores').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return data;
  }

  /**
   * Status only, and only after the service has proved the transition is legal and that the
   * actor may perform it. `expectedFrom` makes the write compare-and-set: if the row moved
   * underneath us, zero rows change and we report a conflict instead of clobbering.
   */
  async setStatus(id, status, expectedFrom = null) {
    if (!this.available()) throw DarkStoreRepository.unavailable();
    if (!STORE_STATUSES.includes(status)) {
      const err = new Error(`Unknown dark store status '${status}'.`);
      err.code = 'DARK_STORE_INVALID_STATUS';
      throw err;
    }
    let query = supabaseAdmin.from('dark_stores').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    if (expectedFrom) query = query.eq('status', expectedFrom);
    const { data, error } = await query.select('*').maybeSingle();
    if (error) throw error;
    if (!data) {
      const err = new Error(`Dark store ${id} status did not change (it is no longer in the expected state).`);
      err.code = 'DARK_STORE_STATE_CONFLICT';
      err.status = 409;
      throw err;
    }
    return data;
  }
}

module.exports = DarkStoreRepository;
module.exports.STORE_STATUSES = STORE_STATUSES;
