/**
 * DarkStoreInventoryRepository - durable data access for `dark_store_inventory` (DS-2).
 *
 * Same discipline as DarkStoreRepository: parameterized queries, whitelisted columns, no
 * authorisation and no ownership decisions here. Ownership is resolved one layer up, by
 * loading the dark store and comparing its `operated_by_merchant_id` against the
 * AUTHENTICATED principal - never against an id that arrived in a request.
 *
 * Availability is never stored. `available = stock_quantity - reserved_quantity` and the
 * database CHECK `reserved_quantity <= stock_quantity` guarantees it is never negative,
 * so this layer computes it rather than letting a second copy drift.
 */
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const INVENTORY_STATUSES = ['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED'];

class DarkStoreInventoryRepository {
  constructor(db) {
    this.db = db;
  }

  available() {
    return Boolean(isLivePostgres && supabaseAdmin);
  }

  static unavailable() {
    const err = new Error('Dark store inventory is read from the authoritative dark_store_inventory '
      + 'table, which is not available. Refusing to answer from memory.');
    err.code = 'DARK_STORE_STORE_UNAVAILABLE';
    err.status = 503;
    err.statusCode = 503;
    return err;
  }

  async findById(id) {
    if (!this.available()) throw DarkStoreInventoryRepository.unavailable();
    const { data, error } = await supabaseAdmin.from('dark_store_inventory')
      .select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    return data || null;
  }

  /**
   * Scoped by dark_store_id always. There is no "list everything" call, because an
   * unscoped read is what turns a missing authorisation check into a data leak.
   */
  async listByDarkStore(darkStoreId, { includeUnavailable = true } = {}) {
    if (!this.available()) throw DarkStoreInventoryRepository.unavailable();
    let query = supabaseAdmin.from('dark_store_inventory').select('*')
      .eq('dark_store_id', darkStoreId)
      .order('created_at', { ascending: false });
    if (!includeUnavailable) query = query.eq('is_available', true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row) => Object.assign(row, {
      available_quantity: Number(row.stock_quantity) - Number(row.reserved_quantity),
    }));
  }

  async create(payload) {
    if (!this.available()) throw DarkStoreInventoryRepository.unavailable();
    const { data, error } = await supabaseAdmin.from('dark_store_inventory').insert({
      dark_store_id: payload.darkStoreId,
      product_id: payload.productId,
      selling_price: payload.sellingPrice,
      stock_quantity: payload.stockQuantity,
      reserved_quantity: payload.reservedQuantity === undefined ? 0 : payload.reservedQuantity,
      low_stock_threshold: payload.lowStockThreshold === undefined ? 5 : payload.lowStockThreshold,
      is_available: payload.isAvailable === undefined ? true : payload.isAvailable,
      status: payload.status || 'AVAILABLE',
    }).select('*').single();
    if (error) throw error;
    return data;
  }

  /**
   * `expectedDarkStoreId` is not decoration: the UPDATE is qualified by the store the caller
   * was authorised against, so an inventory id belonging to another dark store matches zero
   * rows and cannot be written even if the id was guessed.
   */
  async update(id, expectedDarkStoreId, changes = {}) {
    if (!this.available()) throw DarkStoreInventoryRepository.unavailable();
    const allowed = ['selling_price', 'stock_quantity', 'low_stock_threshold', 'is_available', 'status'];
    const patch = {};
    for (const key of allowed) if (Object.prototype.hasOwnProperty.call(changes, key)) patch[key] = changes[key];
    if (!Object.keys(patch).length) return this.findById(id);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin.from('dark_store_inventory').update(patch)
      .eq('id', id).eq('dark_store_id', expectedDarkStoreId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) {
      const err = new Error('Inventory row was not updated: it does not belong to the authorised '
        + 'dark store, or it no longer exists.');
      err.code = 'DARK_STORE_INVENTORY_NOT_MINE';
      err.status = 404;
      throw err;
    }
    return data;
  }

  async setAvailability(id, expectedDarkStoreId, isAvailable, status = null) {
    return this.update(id, expectedDarkStoreId, Object.assign(
      { is_available: isAvailable },
      status ? { status } : {}
    ));
  }
}

module.exports = DarkStoreInventoryRepository;
module.exports.INVENTORY_STATUSES = INVENTORY_STATUSES;
