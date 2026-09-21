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

    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('merchants')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (!error && data) {
        return data;
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

    // Fetch all products for this merchant from PostgreSQL
    let merchantProducts = [];
    if (supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('products')
        .select('*')
        .eq('merchant_id', merchantId);

      if (!error && data) {
        merchantProducts = data;
      }
    }

    const resolvedLines = [];
    let computedTotal = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let quantity = 1;
      let matchedProduct = null;

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
        quantity = Number(item.quantity || 1);
        const prodId = item.restaurant_product_id || item.productId || item.id;

        if (prodId && UUID_REGEX.test(prodId)) {
          // Check if this product exists in the merchant's catalog
          matchedProduct = merchantProducts.find(p => p.id === prodId);
          if (!matchedProduct && supabaseAdmin) {
            // Check if product exists for ANOTHER merchant (cross-tenant check)
            const { data: otherProd } = await supabaseAdmin
              .from('products')
              .select('id, merchant_id, name')
              .eq('id', prodId)
              .maybeSingle();

            if (otherProd && otherProd.merchant_id !== merchantId) {
              const err = new Error(`Product [${prodId}] belongs to another merchant.`);
              err.code = 'MERCHANT_MISMATCH';
              err.statusCode = 400;
              throw err;
            }
          }
        } else if (item.name || item.productName) {
          const cleanName = String(item.name || item.productName).trim().toLowerCase();
          matchedProduct = merchantProducts.find(p => p.name.toLowerCase().includes(cleanName));
        }
      }

      if (!matchedProduct) {
        const err = new Error(`Product at line ${i + 1} not found in merchant catalog.`);
        err.code = 'PRODUCT_NOT_FOUND';
        err.statusCode = 404;
        throw err;
      }

      if (quantity <= 0) {
        const err = new Error(`Quantity must be > 0 at line ${i + 1}.`);
        err.code = 'INVALID_QUANTITY';
        err.statusCode = 400;
        throw err;
      }

      const unitPrice = Number(matchedProduct.price);
      const lineTotal = Math.round(quantity * unitPrice * 100) / 100;
      computedTotal += lineTotal;

      resolvedLines.push({
        catalog_kind: 'RESTAURANT_PRODUCT',
        restaurant_product_id: matchedProduct.id,
        product_name_snapshot: matchedProduct.name,
        quantity: quantity,
        unit_price: unitPrice,
        unit_snapshot: 'piece',
        line_total: lineTotal
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
      const { data, error } = await supabaseAdmin
        .from('merchant_grocery_inventory')
        .select('*, master_grocery_catalog(*)')
        .eq('merchant_id', merchantId);

      if (!error && data) {
        merchantInventory = data;
      }
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
          const { data: otherInv } = await supabaseAdmin
            .from('merchant_grocery_inventory')
            .select('id, merchant_id')
            .or(`id.eq.${targetInvId},product_id.eq.${targetInvId}`)
            .maybeSingle();

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
    if (!supabaseAdmin) {
      throw new Error('Supabase client unconfigured: unable to invoke create_order_with_lines_atomic');
    }

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

    if (error) {
      const err = new Error(`PostgreSQL order creation error: ${error.message}`);
      err.code = 'DB_ERROR';
      throw err;
    }

    return data;
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
    if (!supabaseAdmin || !orderId) return null;

    let query = supabaseAdmin
      .from('orders')
      .select('*, order_lines(*)');

    if (UUID_REGEX.test(orderId)) {
      query = query.eq('id', orderId);
    } else {
      query = query.eq('order_number', orderId);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) return null;

    return {
      ...data,
      lines: data.order_lines || []
    };
  }

  /**
   * Fetch customer orders from PostgreSQL
   */
  async getOrdersByCustomer(customerId, { limit = 50, offset = 0 } = {}) {
    if (!supabaseAdmin || !customerId) return [];

    const { data, error } = await supabaseAdmin
      .from('orders')
      .select('*, order_lines(*)')
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !data) return [];
    return data.map(o => ({ ...o, lines: o.order_lines || [] }));
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

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error || !data) return [];
    return data.map(o => ({ ...o, lines: o.order_lines || [] }));
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
