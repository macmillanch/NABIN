const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_USER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003'
};

const LEGACY_MERCHANT_MAP = {
  'rest_1': '00000000-0000-0000-0000-000000000201',
  'mcht_1': '00000000-0000-0000-0000-000000000201'
};

const LEGACY_GROCERY_PROD_MAP = {
  'gprod_1': '00000000-0000-0000-0000-000000000401',
  'gprod_3': '00000000-0000-0000-0000-000000000402'
};

const APPROVED_REJECTION_REASONS = [
  'ITEM_UNAVAILABLE',
  'MERCHANT_CLOSED',
  'OUT_OF_STOCK',
  'UNABLE_TO_PREPARE',
  'INVALID_ORDER',
  'OTHER'
];

class OrderRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Resolve user UUID from session/identifier
   */
  resolveUserUuid(userId) {
    if (!userId) return null;
    if (UUID_REGEX.test(userId)) return userId;
    if (LEGACY_USER_MAP[userId]) return LEGACY_USER_MAP[userId];
    if (this.db && this.db.userRepo) {
      const resolved = this.db.userRepo.resolveUuid(userId);
      if (resolved) return resolved;
    }
    return null;
  }

  // An unreachable store and a genuinely-absent row are different answers, and only
  // one of them belongs to the caller. This mirrors `settleAuthoritative`/
  // `authStoreUnavailable` in the store: a connection rejection or a PostgREST error
  // both become a retryable 503, while a clean query that simply finds nothing still
  // resolves to `null` for the caller to turn into its business answer. Before this,
  // every resolver here swallowed the error and returned "not found", so a database
  // blip surfaced to checkout as MERCHANT_NOT_FOUND / ITEM_NOT_FOUND — a 4xx that
  // blames the customer for the platform's own outage and tells the client to stop
  // retrying. `storeReply` in supabase.js is the single classifier; the routes hand it
  // this error, whose `.status` of 503 is exactly what `isStoreUnreachable` reads.
  storeUnavailableError(what, cause) {
    const err = new Error(`Cannot complete ${what} right now because the database is not reachable. Please try again in a moment.`);
    err.code = 'STORE_UNAVAILABLE';
    err.status = 503;
    err.cause = cause && cause.message ? cause.message : String(cause);
    return err;
  }

  async settleStore(builder, what) {
    let result;
    try {
      result = await builder;
    } catch (err) {
      throw this.storeUnavailableError(what, err);
    }
    if (result && result.error) {
      throw this.storeUnavailableError(what, result.error);
    }
    return result ? result.data : null;
  }

  /**
   * Resolve merchant UUID and verify existence in PostgreSQL
   */
  async resolveMerchant(merchantId) {
    if (!merchantId) return null;
    let targetId = merchantId;
    if (LEGACY_MERCHANT_MAP[merchantId]) {
      targetId = LEGACY_MERCHANT_MAP[merchantId];
    }

    if (!UUID_REGEX.test(targetId)) {
      return null;
    }

    if (supabaseAdmin && isLivePostgres) {
      try {
        const data = await this.settleStore(
          supabaseAdmin.from('merchants').select('*').eq('id', targetId).maybeSingle(),
          'the merchant lookup'
        );
        if (data) {
          return data;
        }
      } catch (err) {
        if (this.db && this.db.restaurants) {
          const rest = this.db.restaurants.find(r => r.id === targetId || r.uuid === targetId);
          if (rest) {
            return {
              id: rest.uuid || rest.id,
              name: rest.name,
              merchant_type: rest.merchant_type || rest.merchantType || 'RESTAURANT',
              is_open: rest.isOpen !== false
            };
          }
        }
        throw err;
      }
    }

    if (this.db && this.db.restaurants) {
      const rest = this.db.restaurants.find(r => r.id === targetId || r.uuid === targetId || r.id === merchantId || r.uuid === merchantId);
      if (rest) {
        return {
          id: rest.uuid || rest.id,
          name: rest.name,
          merchant_type: rest.merchant_type || rest.merchantType || 'RESTAURANT',
          is_open: rest.isOpen !== false
        };
      }
    }
    return null;
  }

  /**
   * Resolve and validate Food restaurant products belonging to the merchant
   */
  async resolveFoodProducts(merchantId, items) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      const err = new Error('Items must be a non-empty array');
      err.code = 'INVALID_ITEMS';
      err.statusCode = 400;
      throw err;
    }

    // Resolve dishes using RestaurantCatalogRepository when available,
    // with database / live PostgreSQL fallback.
    let merchantProducts = [];
    if (this.db && this.db.restaurantCatalogRepo) {
      try {
        merchantProducts = await this.db.restaurantCatalogRepo.listDishes(merchantId, { includeArchived: true });
      } catch (e) {
        // fall through to settleStore
      }
    }

    if ((!merchantProducts || merchantProducts.length === 0) && supabaseAdmin) {
      try {
        merchantProducts = (await this.settleStore(
          supabaseAdmin.from('products').select('*').eq('merchant_id', merchantId),
          'the restaurant menu'
        )) || [];
      } catch (err) {
        if (!merchantProducts || merchantProducts.length === 0) throw err;
      }
    }

    // Fallback to local memory fixtures if still empty
    if ((!merchantProducts || merchantProducts.length === 0) && this.db && this.db.restaurantCatalog) {
      merchantProducts = this.db.restaurantCatalog.filter(d => {
        const m = d.merchant_id || d.merchantId;
        return m === merchantId;
      });
    }

    const resolvedLines = [];
    let computedTotal = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let quantity = 1;
      let matchedProduct = null;
      let reqVariantId = null;
      let rawAddOns = [];

      if (typeof item === 'string') {
        // Parse legacy string format: "1x Special Dum Biryani (Chicken)" or "Garlic Butter Naan"
        const match = item.match(/^(\d+)x\s*(.*)$/i);
        if (match) {
          quantity = parseInt(match[1], 10) || 1;
          const cleanName = match[2].trim().toLowerCase();
          matchedProduct = merchantProducts.find(p =>
            p.name.toLowerCase().includes(cleanName) || cleanName.includes(p.name.toLowerCase())
          );
        } else {
          const cleanName = item.trim().toLowerCase();
          matchedProduct = merchantProducts.find(p =>
            p.name.toLowerCase().includes(cleanName) || cleanName.includes(p.name.toLowerCase())
          );
        }
      } else if (typeof item === 'object' && item !== null) {
        quantity = Number(item.quantity !== undefined ? item.quantity : 1);
        const prodId = item.restaurant_product_id || item.productId || item.id;
        reqVariantId = item.variantId || item.variant_id || (item.variant && item.variant.id) || null;
        rawAddOns = item.selectedAddOns || item.selected_add_ons || item.addOns || item.add_ons || [];

        if (prodId && UUID_REGEX.test(prodId)) {
          matchedProduct = merchantProducts.find(p => p.id === prodId);
          if (!matchedProduct && supabaseAdmin) {
            // Check if product exists for ANOTHER merchant (cross-tenant check)
            const otherProd = await this.settleStore(
              supabaseAdmin.from('products').select('id, merchant_id, name').eq('id', prodId).maybeSingle(),
              'the restaurant menu'
            );

            if (otherProd && otherProd.merchant_id !== merchantId) {
              const err = new Error(`Product [${prodId}] belongs to another merchant.`);
              err.code = 'MERCHANT_MISMATCH';
              err.statusCode = 400;
              throw err;
            }
          }
        } else if (item.sku) {
          matchedProduct = merchantProducts.find(p => p.sku === item.sku);
        } else if (item.name || item.productName) {
          const cleanName = String(item.name || item.productName).trim().toLowerCase();
          matchedProduct = merchantProducts.find(p => p.name.toLowerCase() === cleanName || p.name.toLowerCase().includes(cleanName));
        }
      }

      if (!matchedProduct) {
        const err = new Error(`Product at line ${i + 1} not found in merchant catalog.`);
        err.code = 'PRODUCT_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      // 1. Archival check: fail closed
      if (matchedProduct.is_archived === true || matchedProduct.isArchived === true) {
        const err = new Error(`Product '${matchedProduct.name}' is archived and no longer available for ordering.`);
        err.code = 'ITEM_ARCHIVED';
        err.statusCode = 400;
        throw err;
      }

      // 2. Availability check: fail closed
      if (matchedProduct.is_available === false || matchedProduct.isAvailable === false || matchedProduct.inStock === false) {
        const err = new Error(`Product '${matchedProduct.name}' is currently out of stock.`);
        err.code = 'ITEM_UNAVAILABLE';
        err.statusCode = 400;
        throw err;
      }

      // 3. Quantity check: integer > 0
      if (!Number.isFinite(quantity) || quantity <= 0) {
        const err = new Error(`Quantity must be > 0 at line ${i + 1}.`);
        err.code = 'INVALID_QUANTITY';
        err.statusCode = 400;
        throw err;
      }

      // 4. Variant resolution: server authoritative
      const variants = Array.isArray(matchedProduct.variants) ? matchedProduct.variants : [];
      let selectedVariant = null;

      if (reqVariantId) {
        selectedVariant = variants.find(v => v.id === reqVariantId || v.sku === reqVariantId || (v.name && v.name.toLowerCase() === String(reqVariantId).toLowerCase()));
        if (!selectedVariant) {
          const err = new Error(`Variant [${reqVariantId}] not found for product '${matchedProduct.name}'.`);
          err.code = 'INVALID_VARIANT';
          err.statusCode = 400;
          throw err;
        }
        if (selectedVariant.isAvailable === false) {
          const err = new Error(`Variant '${selectedVariant.name}' for product '${matchedProduct.name}' is currently unavailable.`);
          err.code = 'VARIANT_UNAVAILABLE';
          err.statusCode = 400;
          throw err;
        }
      } else if (variants.length > 0) {
        const defaultVar = variants.find(v => v.isDefault);
        if (defaultVar && defaultVar.isAvailable !== false) {
          selectedVariant = defaultVar;
        }
      }

      const baseUnitPrice = selectedVariant ? Number(selectedVariant.price) : Number(matchedProduct.price || 0);

      // 5. Add-ons validation: server authoritative selection rules
      if (!Array.isArray(rawAddOns) && rawAddOns !== null && rawAddOns !== undefined) {
        const err = new Error(`Selected add-ons must be an array at line ${i + 1}.`);
        err.code = 'INVALID_ADDONS';
        err.statusCode = 400;
        throw err;
      }

      const selectedOptionIds = [];
      for (const a of (Array.isArray(rawAddOns) ? rawAddOns : [])) {
        const optId = typeof a === 'string' ? a : (a.id || a.optionId || a.option_id);
        if (optId) selectedOptionIds.push(optId);
      }

      const addOnGroups = Array.isArray(matchedProduct.addOnGroups || matchedProduct.add_on_groups)
        ? (matchedProduct.addOnGroups || matchedProduct.add_on_groups)
        : [];

      let addOnsTotal = 0;
      const selectedAddOnSnapshots = [];
      const recognizedOptionIds = new Set();

      for (const group of addOnGroups) {
        const options = Array.isArray(group.options) ? group.options : [];
        const optMap = new Map(options.map(o => [o.id, o]));

        const matchedSelections = selectedOptionIds.filter(id => optMap.has(id));

        if (!group.allowMultiple) {
          const uniq = new Set(matchedSelections);
          if (uniq.size !== matchedSelections.length) {
            const err = new Error(`Duplicate add-on options selected in group '${group.name}'.`);
            err.code = 'DUPLICATE_ADDON_SELECTION';
            err.statusCode = 400;
            throw err;
          }
        }

        const count = matchedSelections.length;
        const isRequired = Boolean(group.isRequired || group.minSelections > 0);
        const minSelections = Number(group.minSelections ?? (isRequired ? 1 : 0));
        const maxSelections = Number(group.maxSelections ?? (options.length || 1));

        if (count < minSelections) {
          const err = new Error(`Add-on group '${group.name}' requires at least ${minSelections} selection(s), but ${count} provided.`);
          err.code = 'REQUIRED_ADDON_MISSING';
          err.statusCode = 400;
          throw err;
        }

        if (maxSelections > 0 && count > maxSelections) {
          const err = new Error(`Add-on group '${group.name}' allows at most ${maxSelections} selection(s), but ${count} provided.`);
          err.code = 'ADDON_LIMIT_EXCEEDED';
          err.statusCode = 400;
          throw err;
        }

        for (const optId of matchedSelections) {
          recognizedOptionIds.add(optId);
          const opt = optMap.get(optId);
          if (opt.isAvailable === false) {
            const err = new Error(`Add-on option '${opt.name}' in group '${group.name}' is currently unavailable.`);
            err.code = 'ADDON_UNAVAILABLE';
            err.statusCode = 400;
            throw err;
          }
          const optPrice = Number(opt.price || 0);
          addOnsTotal += optPrice;
          selectedAddOnSnapshots.push({
            group_id: group.id,
            group_name: group.name,
            option_id: opt.id,
            option_name: opt.name,
            price: optPrice
          });
        }
      }

      // Check for extraneous options that do not belong to this dish
      for (const optId of selectedOptionIds) {
        if (!recognizedOptionIds.has(optId)) {
          const err = new Error(`Add-on option [${optId}] does not belong to any allowed group on product '${matchedProduct.name}'.`);
          err.code = 'INVALID_ADDON_OPTION';
          err.statusCode = 400;
          throw err;
        }
      }

      // 6. Calculate server-authoritative effective unit price and line total
      const effectiveUnitPrice = Math.round((baseUnitPrice + addOnsTotal) * 100) / 100;
      const lineTotal = Math.round(quantity * effectiveUnitPrice * 100) / 100;
      computedTotal += lineTotal;

      const customizationSnapshot = {
        dish_id: matchedProduct.id,
        dish_name: matchedProduct.name,
        variant: selectedVariant ? {
          id: selectedVariant.id,
          name: selectedVariant.name,
          price: Number(selectedVariant.price)
        } : null,
        add_ons: selectedAddOnSnapshots,
        base_unit_price: baseUnitPrice,
        add_ons_unit_total: Math.round(addOnsTotal * 100) / 100,
        effective_unit_price: effectiveUnitPrice
      };

      resolvedLines.push({
        catalog_kind: 'RESTAURANT_PRODUCT',
        restaurant_product_id: matchedProduct.id,
        product_name_snapshot: matchedProduct.name + (selectedVariant ? ` (${selectedVariant.name})` : ''),
        quantity: quantity,
        unit_price: effectiveUnitPrice,
        unit_price_snapshot: effectiveUnitPrice,
        unit_snapshot: 'piece',
        line_total: lineTotal,
        customization_snapshot: customizationSnapshot
      });
    }

    return {
      lines: resolvedLines,
      totalAmount: Math.round(computedTotal * 100) / 100
    };
  }

  /**
   * Resolve and validate Grocery inventory items belonging to the merchant
   */
  async resolveGroceryItems(merchantId, cartItems) {
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
      const err = new Error('Cart items must be a non-empty array');
      err.code = 'INVALID_ITEMS';
      err.statusCode = 400;
      throw err;
    }

    let merchantInventory = [];
    if (supabaseAdmin) {
      merchantInventory = (await this.settleStore(
        supabaseAdmin.from('merchant_grocery_inventory').select('*, master_grocery_catalog(*)').eq('merchant_id', merchantId),
        'the store inventory'
      )) || [];
    }

    const resolvedLines = [];
    let computedTotal = 0;

    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i];
      const invId = item.grocery_inventory_id || item.inventoryId || item.productId || item.id;
      let matchedInv = null;

      let targetInvId = invId;
      if (LEGACY_GROCERY_PROD_MAP[invId]) {
        targetInvId = LEGACY_GROCERY_PROD_MAP[invId];
      }

      if (targetInvId && UUID_REGEX.test(targetInvId)) {
        matchedInv = merchantInventory.find(inv => inv.id === targetInvId || inv.product_id === targetInvId);
        if (!matchedInv && supabaseAdmin) {
          // Check if inventory belongs to another merchant
          const otherInv = await this.settleStore(
            supabaseAdmin.from('merchant_grocery_inventory').select('id, merchant_id').or(`id.eq.${targetInvId},product_id.eq.${targetInvId}`).maybeSingle(),
            'the store inventory'
          );

          if (otherInv && otherInv.merchant_id !== merchantId) {
            const err = new Error(`Grocery inventory [${targetInvId}] belongs to another merchant.`);
            err.code = 'MERCHANT_MISMATCH';
            err.statusCode = 400;
            throw err;
          }
        }
      } else if (item.productName || item.name) {
        const cleanName = String(item.productName || item.name).trim().toLowerCase();
        matchedInv = merchantInventory.find(inv =>
          inv.master_grocery_catalog?.name?.toLowerCase().includes(cleanName)
        );
      }

      if (!matchedInv) {
        const err = new Error(`Grocery inventory item at line ${i + 1} not found for this merchant.`);
        err.code = 'INVENTORY_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      const quantity = Number(item.quantity || item.requestedQtyKg || item.requestedQty || 1);
      if (quantity <= 0) {
        const err = new Error(`Quantity must be > 0 at line ${i + 1}.`);
        err.code = 'INVALID_QUANTITY';
        err.statusCode = 400;
        throw err;
      }

      const unitPrice = Number(matchedInv.store_price);
      const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
      computedTotal += lineTotal;

      const unit = matchedInv.master_grocery_catalog?.standard_unit || item.unit || 'piece';
      const prodName = matchedInv.master_grocery_catalog?.name || item.productName || item.name || 'Grocery Item';

      resolvedLines.push({
        catalog_kind: 'GROCERY_INVENTORY',
        grocery_inventory_id: matchedInv.id,
        product_name_snapshot: prodName,
        quantity: quantity,
        unit_price: unitPrice,
        unit_snapshot: unit,
        line_total: lineTotal
      });
    }

    return {
      lines: resolvedLines,
      totalAmount: Math.round(computedTotal * 100) / 100
    };
  }

  /**
   * Execute Migration 019 create_order_with_lines_atomic RPC
   */
  async createOrderWithLinesAtomic({
    serviceType,
    customerId,
    merchantId,
    totalAmount,
    items,
    metadata = {},
    idempotencyKey = null,
    checkoutId = null
  }) {
    if (supabaseAdmin && isLivePostgres) {
      try {
        const { data, error } = await supabaseAdmin.rpc('create_order_with_lines_atomic', {
          p_service_type: serviceType,
          p_customer_id: customerId,
          p_merchant_id: merchantId,
          p_total_amount: totalAmount,
          p_items: items,
          p_metadata: metadata,
          p_idempotency_key: idempotencyKey,
          p_checkout_id: checkoutId
        });

        if (!error && data) return data;
        if (error) {
          if (isLivePostgres) throw error;
        }
      } catch (e) {
        if (isLivePostgres) throw e;
        // fall through to local fallback only in non-postgres test harness
      }
    }

    // Local / Offline fallback when Postgres is not live or unseeded
    if (idempotencyKey && this._idempotencyMap && this._idempotencyMap.has(idempotencyKey)) {
      const existing = this._idempotencyMap.get(idempotencyKey);
      return {
        ...existing,
        duplicate: true,
        message: 'Idempotent replay: returning existing order'
      };
    }
    const orderId = crypto.randomUUID();
    const orderNumber = 'ORD-' + Math.floor(10000000 + Math.random() * 90000000);
    const mockOrder = {
      success: true,
      order_id: orderId,
      order_number: orderNumber,
      order_state: 'RECEIVED',
      service_type: serviceType,
      customer_id: customerId,
      merchant_id: merchantId,
      total_amount: totalAmount,
      items,
      metadata,
      created_at: new Date().toISOString()
    };
    if (!this._idempotencyMap) this._idempotencyMap = new Map();
    if (idempotencyKey) this._idempotencyMap.set(idempotencyKey, mockOrder);
    if (!this.db.orders) this.db.orders = [];
    this.db.orders.push(mockOrder);
    return mockOrder;
  }

  /**
   * Execute Migration 018 _transition_order_state_internal RPC
   */
  async transitionOrderState({
    orderId,
    newState,
    actorRole,
    actorId,
    reason = null,
    idempotencyKey = null,
    metadata = {}
  }) {
    if (!supabaseAdmin) {
      throw new Error('Supabase client unconfigured: unable to invoke _transition_order_state_internal');
    }

    if (newState === 'REJECTED') {
      if (!reason || !APPROVED_REJECTION_REASONS.includes(reason)) {
        const err = new Error(`Rejection reason required. Must be one of: ${APPROVED_REJECTION_REASONS.join(', ')}`);
        err.code = 'INVALID_REJECTION_REASON';
        err.statusCode = 400;
        throw err;
      }
    }

    const { data, error } = await supabaseAdmin.rpc('_transition_order_state_internal', {
      p_order_id: orderId,
      p_new_state: newState,
      p_verified_caller_role: actorRole,
      p_verified_caller_id: actorId,
      p_reason: reason,
      p_idempotency_key: idempotencyKey,
      p_metadata: metadata
    });

    if (error) {
      const err = new Error(`State transition error: ${error.message}`);
      err.code = 'TRANSITION_ERROR';
      throw err;
    }

    return data;
  }

  /**
   * Execute Migration 018 expire_stale_orders RPC
   */
  async expireStaleOrders() {
    if (!supabaseAdmin) {
      throw new Error('Supabase client unconfigured: unable to invoke expire_stale_orders');
    }

    const { data, error } = await supabaseAdmin.rpc('expire_stale_orders');
    if (error) {
      throw new Error(`Error expiring stale orders: ${error.message}`);
    }
    return data || 0;
  }

  /**
   * Fetch order by ID or order_number with embedded order_lines
   */
  async getOrderById(orderId) {
    if (supabaseAdmin && isLivePostgres) {
      try {
        let query = supabaseAdmin
          .from('orders')
          .select('*, order_lines(*)');

        if (UUID_REGEX.test(orderId)) {
          query = query.eq('id', orderId);
        } else {
          query = query.eq('order_number', orderId);
        }

        const data = await this.settleStore(query.maybeSingle(), 'the order');
        if (data) {
          return {
            ...data,
            lines: (data.order_lines || []).map(l => this._normalizeOrderLine(l))
          };
        }
      } catch (err) {
        if (!this.db || !this.db.orders) throw err;
      }
    }

    if (this.db && this.db.orders) {
      const found = this.db.orders.find(o => o.order_id === orderId || o.id === orderId || o.order_number === orderId);
      if (found) {
        return {
          ...found,
          id: found.order_id || found.id,
          order_id: found.order_id || found.id,
          order_number: found.order_number || found.orderNumber,
          order_state: found.order_state || found.orderState || 'RECEIVED',
          service_type: found.service_type || found.serviceType || 'FOOD',
          customer_id: found.customer_id || found.customerId,
          merchant_id: found.merchant_id || found.merchantId,
          total_amount: Number(found.total_amount || found.totalAmount || 0),
          lines: (found.items || []).map(l => this._normalizeOrderLine(l))
        };
      }
    }
    return null;
  }

  /**
   * Helper to normalize database order line fields with legacy API client expectations
   */
  _normalizeOrderLine(line) {
    if (!line) return line;
    const unitPrice = line.unit_price !== undefined
      ? Number(line.unit_price)
      : (line.unit_price_snapshot !== undefined ? Number(line.unit_price_snapshot) : undefined);
    const lineTotal = line.line_total !== undefined
      ? Number(line.line_total)
      : (unitPrice !== undefined && line.quantity !== undefined ? Number((unitPrice * Number(line.quantity)).toFixed(2)) : undefined);
    return {
      ...line,
      unit_price: unitPrice,
      unit_price_snapshot: line.unit_price_snapshot !== undefined ? Number(line.unit_price_snapshot) : unitPrice,
      line_total: lineTotal,
      name: line.name || line.product_name_snapshot,
      product_name_snapshot: line.product_name_snapshot || line.name
    };
  }

  /**
   * Fetch customer orders from PostgreSQL
   */
  async getOrdersByCustomer(customerId, { limit = 50, offset = 0 } = {}) {
    if (!supabaseAdmin || !customerId) return [];

    // An empty history and an unreadable history both used to come back as `[]`, and every
    // caller sits inside a `try`, so the outage was a clean return:
    // `GET /api/customer/orders` answered `200 {success: true, count: 0}`. A customer whose
    // orders could not be read was told they had none. A read that succeeds with no rows is
    // still the empty array it always was; a read the store could not answer propagates.
    const data = await this.settleStore(
      supabaseAdmin
        .from('orders')
        .select('*, order_lines(*)')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1),
      'the customer order history'
    );
    return (data || []).map(o => ({ ...o, lines: (o.order_lines || []).map(l => this._normalizeOrderLine(l)) }));
  }

  /**
   * Fetch merchant orders from PostgreSQL
   */
  async getOrdersByMerchant(merchantId, { limit = 50, offset = 0, status = null } = {}) {
    if (!supabaseAdmin || !merchantId) return [];

    let query = supabaseAdmin
      .from('orders')
      .select('*, order_lines(*)')
      .eq('merchant_id', merchantId);

    if (status) {
      query = query.eq('order_state', status);
    }

    // An empty book and an unreadable book are different facts, and the callers here
    // cannot tell them apart from a `[]`. A quiet day is a successful zero-order read; a
    // store that cannot answer is the same 503 outage the resolvers above already raise,
    // so the dashboard and kitchen display refuse instead of painting 0 orders and 0
    // sales as if the day were genuinely over.
    const data = await this.settleStore(
      query.order('created_at', { ascending: false }).range(offset, offset + limit - 1),
      'the merchant order book'
    );
    return (data || []).map(o => ({ ...o, lines: (o.order_lines || []).map(l => this._normalizeOrderLine(l)) }));
  }

  /**
   * Submit packed weight for a grocery order line (merchant fulfillment)
   */
  async submitPackedWeight({ orderId, itemId, packedWeight, merchantId }) {
    if (!orderId || !itemId || !packedWeight) {
      throw new Error('orderId, itemId, and packedWeight are required');
    }
    const numericWeight = parseFloat(packedWeight);
    if (isNaN(numericWeight) || numericWeight <= 0) {
      throw new Error('Invalid packed weight');
    }

    const order = await this.getOrderById(orderId);
    if (!order) {
      throw new Error('Order not found');
    }
    if (merchantId) {
      const resolvedMerchant = await this.resolveMerchant(merchantId);
      const merchantUuid = resolvedMerchant ? resolvedMerchant.id : merchantId;
      if (order.merchant_id !== merchantUuid) {
        const err = new Error('Forbidden: Cannot submit packed weight for another merchant\'s order.');
        err.statusCode = 403;
        throw err;
      }
    }

    // Find the order line by line ID, grocery_inventory_id, or restaurant_product_id
    const line = (order.lines || []).find(l => l.id === itemId || l.grocery_inventory_id === itemId || l.restaurant_product_id === itemId);
    if (!line) {
      throw new Error('Order line not found');
    }

    if (numericWeight > Number(line.quantity)) {
      throw new Error(`Packed weight (${numericWeight}) cannot exceed requested quantity (${line.quantity})`);
    }

    // Update order_lines in PostgreSQL
    const { data: updatedLine, error: updateErr } = await supabaseAdmin
      .from('order_lines')
      .update({ packed_confirmed_quantity: numericWeight })
      .eq('id', line.id)
      .select()
      .single();

    if (updateErr) {
      throw new Error(`Failed to update packed weight in PostgreSQL: ${updateErr.message}`);
    }

    const updatedOrder = await this.getOrderById(orderId);
    return {
      success: true,
      order: updatedOrder,
      line: updatedLine
    };
  }

  /**
   * Fetch checkout record by ID or checkout_id
   */
  async getCheckoutById(checkoutId) {
    if (!supabaseAdmin || !checkoutId) return null;
    let query = supabaseAdmin.from('checkouts').select('*');
    if (UUID_REGEX.test(checkoutId)) {
      query = query.eq('id', checkoutId);
    } else {
      query = query.eq('checkout_id', checkoutId);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;
    return data;
  }

  /**
   * Create an authoritative checkout session in PostgreSQL
   */
  /**
   * Map a legacy fixture product reference (e.g. `gprod_3`) onto its PostgreSQL
   * UUID. Real clients already send UUIDs, which pass through untouched.
   */
  resolveGroceryRefId(id) {
    const clean = (id === undefined || id === null) ? '' : String(id).trim();
    return LEGACY_GROCERY_PROD_MAP[clean] || clean;
  }

  async createCheckoutSession({
    customerId,
    merchantId,
    serviceType = 'GROCERY',
    paymentMethod = 'WALLET',
    baseAmount = 0,
    finalPayableAmount = 0,
    checkoutStatus = 'CONFIRMED',
    discountAmount = 0,
    appliedPromoCode = null,
    promotionId = null,
    redemptionId = null,
    metadata = {}
  }) {
    if (!supabaseAdmin) {
      throw new Error('Supabase client unconfigured: unable to create checkout');
    }
    const checkoutCode = 'CHK-' + crypto.randomUUID().substring(0, 12);
    const { data, error } = await supabaseAdmin
      .from('checkouts')
      .insert({
        checkout_id: checkoutCode,
        customer_id: customerId,
        merchant_id: merchantId,
        service_type: serviceType,
        payment_method: paymentMethod,
        base_amount: baseAmount,
        discount_amount: Number(discountAmount) || 0,
        applied_promo_code: appliedPromoCode,
        promotion_id: promotionId && UUID_REGEX.test(promotionId) ? promotionId : null,
        redemption_id: redemptionId && UUID_REGEX.test(redemptionId) ? redemptionId : null,
        final_payable_amount: finalPayableAmount,
        checkout_status: checkoutStatus,
        metadata: metadata
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create checkout record: ${error.message}`);
    }
    return data;
  }

  /**
   * Fetch idempotency token record with joined order
   */
  async getIdempotencyToken(idempotencyKey) {
    if (!supabaseAdmin || !idempotencyKey) return null;
    const { data, error } = await supabaseAdmin
      .from('order_creation_tokens')
      .select('*, order:orders(*)')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }
}

module.exports = OrderRepository;
