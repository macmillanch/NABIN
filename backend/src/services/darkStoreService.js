/**
 * darkStoreService - the ONLY layer routes may call for dark stores and their inventory (DS-2).
 *
 * Three responsibilities, in this order, and none of them is data access:
 *   1. authorisation from the AUTHENTICATED principal,
 *   2. business validation (shape and lifecycle),
 *   3. delegation to the repositories.
 *
 * Authorisation rules, stated plainly because they are the security boundary:
 *   - An actor is built by the route from req.admin / req.merchant. Nothing in this file reads
 *     a dark_store_id, merchant_id, operated_by_merchant_id or inventory_id from a request body
 *     and treats it as identity. A client-supplied id is always a TARGET to be checked, never
 *     proof of permission.
 *   - ADMIN/SUPER_ADMIN holding the dark-store permission may manage any store, platform- or
 *     merchant-operated.
 *   - A MERCHANT may manage a store ONLY when that store's durable
 *     operated_by_merchant_id equals the merchant's own resolved uuid.
 *   - operated_by_merchant_id IS NULL means platform-operated. It is NOT "unowned, therefore
 *     free for every merchant": merchant actors are refused, which is what decision 9 requires.
 *
 * Lifecycle follows the JobRepository precedent (VALID_JOB_TRANSITIONS + NON_REPEATABLE):
 * ARCHIVED is terminal, ACTIVE is the only fulfilment-eligible state, and no transition is
 * invented beyond the agreed set. Only the store's status decides fulfilment eligibility -
 * flipping an inventory row to available cannot revive a CLOSED or ARCHIVED store.
 *
 * Reservations are intentionally absent: they depend on an order identity DS-3 has not settled.
 */
const DARK_STORE_STATUSES = ['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED'];

const VALID_DARK_STORE_TRANSITIONS = {
  DRAFT: ['ACTIVE'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: ['ARCHIVED'],
  ARCHIVED: [],
};

// Terminal in the sense JobRepository uses for COMPLETED: nothing ever leaves it.
const NON_RETURNABLE_STATUSES = new Set(['ARCHIVED']);

const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TIMEZONES = new Set(['Asia/Kolkata', 'Asia/Colombo', 'Asia/Dubai', 'Asia/Karachi', 'UTC']);

function fail(code, message, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.statusCode = status;
  return err;
}

function isAdminActor(actor) {
  return !!(actor && actor.type === 'ADMIN');
}

function isMerchantActor(actor) {
  return !!(actor && actor.type === 'MERCHANT' && actor.merchantId);
}

/**
 * Validate the shape the repository will persist. Coordinates and radius are checked here as
 * well as by the database CHECKs, so a caller gets a named field error instead of a raw
 * constraint message.
 */
function validateStorePayload(payload, { partial = false } = {}) {
  const v = payload || {};
  const need = (key) => { if (!partial) return true; return Object.prototype.hasOwnProperty.call(v, key); };

  if (need('name') && (!v.name || !String(v.name).trim() || String(v.name).length > 150)) {
    throw fail('DARK_STORE_INVALID_NAME', 'name is required and must be 1-150 characters.');
  }
  if (need('code') && (!v.code || !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,39}$/.test(String(v.code)))) {
    throw fail('DARK_STORE_INVALID_CODE', 'code is required: 2-40 characters, letters, digits, _ . - and not starting with a separator.');
  }
  if (need('address') && (!v.address || !String(v.address).trim())) {
    throw fail('DARK_STORE_INVALID_ADDRESS', 'address is required.');
  }
  if (need('latitude')) {
    const lat = Number(v.latitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw fail('DARK_STORE_INVALID_LATITUDE', 'latitude must be between -90 and 90.');
  }
  if (need('longitude')) {
    const lng = Number(v.longitude);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw fail('DARK_STORE_INVALID_LONGITUDE', 'longitude must be between -180 and 180.');
  }
  if (need('serviceRadiusM')) {
    const r = Number(v.serviceRadiusM);
    if (!Number.isInteger(r) || r <= 0 || r > 100000) {
      throw fail('DARK_STORE_INVALID_RADIUS', 'service_radius_m must be a whole number of metres between 1 and 100000.');
    }
  }
  if (need('timezone') && v.timezone !== undefined && !TIMEZONES.has(String(v.timezone))) {
    throw fail('DARK_STORE_INVALID_TIMEZONE', `timezone must be one of: ${[...TIMEZONES].join(', ')}.`);
  }
  const opens = need('opensAt') ? v.opensAt : undefined;
  const closes = need('closesAt') ? v.closesAt : undefined;
  for (const [label, value] of [['opens_at', opens], ['closes_at', closes]]) {
    if (value !== undefined && value !== null && !CLOCK_RE.test(String(value))) {
      throw fail('DARK_STORE_INVALID_HOURS', `${label} must be HH:MM (24-hour) or null.`);
    }
  }
  if (opens && closes && CLOCK_RE.test(String(opens)) && CLOCK_RE.test(String(closes))
    && String(opens) === String(closes)) {
    throw fail('DARK_STORE_INVALID_HOURS', 'opens_at and closes_at must differ; a zero-length window would silently fulfil nothing.');
  }
}

/**
 * The single authorisation decision, used by every read and write below.
 *
 * Scope: OWNERSHIP only. Whether a principal may use the dark-store feature at all is decided
 * by the existing route permission layer (authenticateAdmin + requirePermission, or
 * authenticateMerchant + requireMerchantService). This function must not grow a second
 * permission system - only a second identity check is a second chance to get it wrong.
 */
function authorize(actor, store, action) {
  if (!store) throw fail('DARK_STORE_NOT_FOUND', 'Dark store not found.', 404);
  if (!actor || !actor.type) {
    throw fail('DARK_STORE_AUTH_REQUIRED', 'A dark store operation requires an authenticated principal.', 401);
  }
  if (isAdminActor(actor)) return store;
  if (isMerchantActor(actor)) {
    if (!store.operated_by_merchant_id) {
      throw fail('DARK_STORE_PLATFORM_ONLY',
        'Forbidden: this dark store is platform-operated and cannot be managed by a merchant account.', 403);
    }
    if (String(store.operated_by_merchant_id) !== String(actor.merchantId)) {
      throw fail('DARK_STORE_NOT_MINE',
        `Forbidden: cannot ${action} another operator's dark store.`, 403);
    }
    return store;
  }
  throw fail('DARK_STORE_FORBIDDEN', 'Forbidden: this principal may not manage dark stores.', 403);
}

class DarkStoreService {
  constructor(db) {
    this.db = db;
  }

  get storeRepo() { return this.db.darkStoreRepo; }
  get inventoryRepo() { return this.db.darkStoreInventoryRepo; }

  async create(actor, payload = {}) {
    if (!isAdminActor(actor)) {
      throw fail('DARK_STORE_CREATE_FORBIDDEN', 'Forbidden: only platform administrators may create dark stores.', 403);
    }
    validateStorePayload(payload);
    const operator = payload.operatedByMerchantId || null;
    if (operator) {
      const merchant = await this.db.orderRepo.resolveMerchant(operator);
      if (!merchant) throw fail('DARK_STORE_OPERATOR_UNKNOWN', 'Unknown operated_by_merchant_id: no such merchant.', 400);
    }
    return this.storeRepo.create({
      code: String(payload.code).trim(),
      name: String(payload.name).trim(),
      status: 'DRAFT',
      operatedByMerchantId: operator,
      address: String(payload.address).trim(),
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
      serviceRadiusM: payload.serviceRadiusM === undefined ? 3000 : Number(payload.serviceRadiusM),
      timezone: payload.timezone || 'Asia/Kolkata',
      opensAt: payload.opensAt || null,
      closesAt: payload.closesAt || null,
    });
  }

  async get(actor, id) {
    const store = await this.storeRepo.findById(id);
    return authorize(actor, store, 'view');
  }

  /** Merchants see only their own stores; the filter is derived from the principal, never from a body field. */
  async list(actor, filters = {}) {
    if (isMerchantActor(actor)) {
      return this.storeRepo.list({
        status: filters.status || null,
        operatedByMerchantId: actor.merchantId,
      });
    }
    if (!isAdminActor(actor)) throw authorize(actor, { operated_by_merchant_id: 'x' }, 'list');
    return this.storeRepo.list({
      status: filters.status || null,
      operatedByMerchantId: filters.operatedByMerchantId || null,
    });
  }

  async update(actor, id, changes = {}) {
    const store = authorize(actor, await this.storeRepo.findById(id), 'edit');
    // status is not editable through update(); it has its own lifecycle gate.
    if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
      throw fail('DARK_STORE_STATUS_VIA_LIFECYCLE', 'status changes go through the lifecycle endpoint, not a free-form update.');
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'operated_by_merchant_id')) {
      throw fail('DARK_STORE_OPERATOR_IMMUTABLE', 'operated_by_merchant_id is reassigned only by an explicit platform operation, not by an edit.');
    }
    validateStorePayload(changes, { partial: true });
    const updated = await this.storeRepo.update(store.id, changes);
    return updated || store;
  }

  /**
   * Lifecycle. Illegal transitions are refused before any write, ARCHIVED is terminal, and the
   * repository write is compare-and-set on the state we authorised against.
   */
  async setStatus(actor, id, nextStatus) {
    const store = authorize(actor, await this.storeRepo.findById(id), 'status');
    const from = store.status;
    if (!DARK_STORE_STATUSES.includes(nextStatus)) {
      throw fail('DARK_STORE_INVALID_STATUS', `Unknown status '${nextStatus}'. Allowed: ${DARK_STORE_STATUSES.join(', ')}.`);
    }
    if (NON_RETURNABLE_STATUSES.has(from)) {
      throw fail('DARK_STORE_ARCHIVED', 'An ARCHIVED dark store is terminal and cannot return to any active state.', 409);
    }
    const allowed = VALID_DARK_STORE_TRANSITIONS[from] || [];
    if (!allowed.includes(nextStatus)) {
      throw fail('DARK_STORE_INVALID_TRANSITION',
        `Illegal dark store transition ${from} -> ${nextStatus}. Allowed from ${from}: ${allowed.length ? allowed.join(', ') : 'none'}.`, 409);
    }
    return this.storeRepo.setStatus(store.id, nextStatus, from);
  }

  // ---- inventory ----

  async listInventory(actor, darkStoreId, options = {}) {
    const store = authorize(actor, await this.storeRepo.findById(darkStoreId), 'view');
    return this.inventoryRepo.listByDarkStore(store.id, options);
  }

  async createInventory(actor, darkStoreId, payload = {}) {
    const store = authorize(actor, await this.storeRepo.findById(darkStoreId), 'edit');
    this.assertStoreAcceptsStock(store);
    this.validateInventoryPayload(payload, { creating: true });
    // Always resolved against the durable master catalog here. The previous form
    // (`await this.db.orderRepo.resolveMasterProduct ? ... : ...`) awaited a function
    // reference and would have called a method that does not exist.
    const product = await this.masterProductExists(payload.productId);
    if (!product) throw fail('DARK_STORE_UNKNOWN_PRODUCT', 'Unknown product_id: not present in the master grocery catalog.', 400);
    const existing = (await this.inventoryRepo.listByDarkStore(store.id))
      .find((row) => String(row.product_id) === String(payload.productId));
    if (existing) {
      throw fail('DARK_STORE_INVENTORY_DUPLICATE',
        'This dark store already lists that product; update the existing row instead.', 409);
    }
    return this.inventoryRepo.create({
      darkStoreId: store.id,
      productId: payload.productId,
      sellingPrice: Number(payload.sellingPrice),
      stockQuantity: payload.stockQuantity === undefined ? 0 : Number(payload.stockQuantity),
      reservedQuantity: payload.reservedQuantity === undefined ? 0 : Number(payload.reservedQuantity),
      lowStockThreshold: payload.lowStockThreshold === undefined ? 5 : Number(payload.lowStockThreshold),
      isAvailable: payload.isAvailable === undefined ? true : Boolean(payload.isAvailable),
      status: payload.status || 'AVAILABLE',
    });
  }

  async updateInventory(actor, darkStoreId, inventoryId, changes = {}) {
    const store = authorize(actor, await this.storeRepo.findById(darkStoreId), 'edit');
    const row = await this.inventoryRepo.findById(inventoryId);
    if (!row || String(row.dark_store_id) !== String(store.id)) {
      throw fail('DARK_STORE_INVENTORY_NOT_MINE',
        'Forbidden: that inventory row does not belong to this dark store.', 403);
    }
    this.assertStoreAcceptsStock(store);
    this.validateInventoryPayload(Object.assign({
      sellingPrice: row.selling_price,
      stockQuantity: row.stock_quantity,
      reservedQuantity: row.reserved_quantity,
      lowStockThreshold: row.low_stock_threshold,
    }, changes), { creating: false });
    return this.inventoryRepo.update(row.id, store.id, {
      selling_price: changes.sellingPrice === undefined ? undefined : Number(changes.sellingPrice),
      stock_quantity: changes.stockQuantity === undefined ? undefined : Number(changes.stockQuantity),
      low_stock_threshold: changes.lowStockThreshold === undefined ? undefined : Number(changes.lowStockThreshold),
      is_available: changes.isAvailable === undefined ? undefined : Boolean(changes.isAvailable),
      status: changes.status,
    });
  }

  async setAvailability(actor, darkStoreId, inventoryId, isAvailable, status = null) {
    const store = authorize(actor, await this.storeRepo.findById(darkStoreId), 'edit');
    this.assertStoreAcceptsStock(store);
    const row = await this.inventoryRepo.findById(inventoryId);
    if (!row || String(row.dark_store_id) !== String(store.id)) {
      throw fail('DARK_STORE_INVENTORY_NOT_MINE', 'Forbidden: that inventory row does not belong to this dark store.', 403);
    }
    return this.inventoryRepo.setAvailability(row.id, store.id, Boolean(isAvailable), status);
  }

  /**
   * Stock must attach to a store that can still operate. This is the rule that stops an
   * inventory edit from quietly making a CLOSED or ARCHIVED store look sellable.
   */
  assertStoreAcceptsStock(store) {
    if (!['DRAFT', 'ACTIVE', 'PAUSED'].includes(store.status)) {
      throw fail('DARK_STORE_NOT_STOCKABLE',
        `A dark store in status ${store.status} cannot take inventory changes.`, 409);
    }
  }

  validateInventoryPayload(v = {}, { creating = false } = {}) {
    const price = Number(v.sellingPrice);
    if (v.sellingPrice === undefined && !creating) { /* unchanged */ }
    else if (!Number.isFinite(price) || price <= 0) {
      throw fail('DARK_STORE_INVALID_PRICE', 'selling_price must be a positive number.');
    }
    const stock = Number(v.stockQuantity);
    if (v.stockQuantity !== undefined && (!Number.isInteger(stock) || stock < 0)) {
      throw fail('DARK_STORE_INVALID_STOCK', 'stock_quantity must be a whole number of units, zero or more.');
    }
    const reserved = Number(v.reservedQuantity);
    if (v.reservedQuantity !== undefined && (!Number.isInteger(reserved) || reserved < 0)) {
      throw fail('DARK_STORE_INVALID_RESERVED', 'reserved_quantity must be a whole number of units, zero or more.');
    }
    if (v.stockQuantity !== undefined && v.reservedQuantity !== undefined && reserved > stock) {
      throw fail('DARK_STORE_RESERVED_OVER_STOCK', 'reserved_quantity cannot exceed stock_quantity.');
    }
    const threshold = Number(v.lowStockThreshold);
    if (v.lowStockThreshold !== undefined && (!Number.isInteger(threshold) || threshold < 0)) {
      throw fail('DARK_STORE_INVALID_THRESHOLD', 'low_stock_threshold must be a whole number, zero or more.');
    }
    if (v.status !== undefined && !['AVAILABLE', 'LOW_STOCK', 'OUT_OF_STOCK', 'DISCONTINUED'].includes(v.status)) {
      throw fail('DARK_STORE_INVALID_ITEM_STATUS', `Unknown inventory status '${v.status}'.`);
    }
    // product_id identifies the catalogue entry a NEW listing points at. An update never
    // re-points it (the (dark_store_id, product_id) pair is the row's identity), so
    // requiring it here would reject every legitimate price/stock edit - which is exactly
    // the bug RT-19 caught.
    if (creating && !v.productId) throw fail('DARK_STORE_PRODUCT_REQUIRED', 'product_id is required.');
  }

  async masterProductExists(id) {
    const { supabaseAdmin, isLivePostgres } = require('../supabase');
    if (!isLivePostgres || !supabaseAdmin) throw fail('DARK_STORE_STORE_UNAVAILABLE', 'Master catalog unavailable.', 503);
    const { data, error } = await supabaseAdmin.from('master_grocery_catalog').select('id').eq('id', id).maybeSingle();
    if (error) throw error;
    return data || null;
  }
}

module.exports = DarkStoreService;
module.exports.DARK_STORE_STATUSES = DARK_STORE_STATUSES;
module.exports.VALID_DARK_STORE_TRANSITIONS = VALID_DARK_STORE_TRANSITIONS;
module.exports.validateStorePayload = validateStorePayload;
module.exports.authorize = authorize;
