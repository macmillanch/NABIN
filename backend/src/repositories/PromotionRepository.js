const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRowToDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    code: row.code,
    name: row.name || row.code,
    description: row.description || '',
    serviceType: row.service_type || 'ALL',
    eligibleService: row.service_type || 'ALL', // Legacy compatibility
    discountType: row.discount_type,
    discountValue: parseFloat(row.discount_value !== undefined ? row.discount_value : 0),
    maxDiscount: row.max_discount !== null && row.max_discount !== undefined ? parseFloat(row.max_discount) : null,
    minOrderAmount: parseFloat(row.min_order_amount !== undefined ? row.min_order_amount : 0),
    totalUsageLimit: row.total_usage_limit !== null ? Number(row.total_usage_limit) : null,
    usageLimit: row.total_usage_limit !== null ? Number(row.total_usage_limit) : null, // Legacy compatibility
    usageCount: Number(row.usage_count || 0),
    usedCount: Number(row.usage_count || 0), // Legacy compatibility
    validFrom: row.valid_from,
    startDate: row.valid_from ? new Date(row.valid_from).toISOString().slice(0, 10) : null,
    validUntil: row.valid_until,
    endDate: row.valid_until ? new Date(row.valid_until).toISOString().slice(0, 10) : null,
    isActive: Boolean(row.is_active),
    status: row.is_active ? 'ACTIVE' : 'INACTIVE', // Legacy compatibility
    perUserLimit: Number(row.per_user_limit || 1),
    eligibleVehicle: row.eligible_vehicle || 'ALL',
    eligibleMerchant: row.eligible_merchant || 'ALL',
    eligibleArea: row.eligible_area || 'ALL',
    newUserOnly: Boolean(row.new_user_only),
    createdBy: row.created_by || 'Admin',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRedemptionRowToDTO(row) {
  if (!row) return null;
  return {
    id: row.id,
    promotionId: row.promotion_id,
    userId: row.user_id,
    jobId: row.job_id,
    discountAmount: parseFloat(row.discount_amount),
    orderAmount: parseFloat(row.order_amount),
    idempotencyKey: row.idempotency_key,
    redeemedAt: row.redeemed_at
  };
}

class PromotionRepository {
  constructor(db) {
    this.db = db;
  }

  resolveUserUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (this.db && this.db.userRepo) {
      return this.db.userRepo.resolveUuid(id);
    }
    return null;
  }

  resolveJobUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (this.db && this.db.jobs) {
      const j = this.db.jobs.find(x => x.id === id || x.jobNumber === id || x.uuid === id);
      if (j && j.uuid) return j.uuid;
    }
    return null;
  }

  /**
   * Create a new promotion record.
   * In live PostgreSQL mode, this writes directly to public.promotions.
   */
  async create(payload, adminId, adminName) {
    if (!payload || !payload.code) {
      throw new Error('Promotion code is required');
    }

    const code = payload.code.toUpperCase().trim();
    const serviceType = (payload.serviceType || payload.eligibleService || 'ALL').toUpperCase();
    const discountType = (payload.discountType || 'PERCENTAGE').toUpperCase();
    const discountValue = Number(payload.discountValue) || 0;
    const maxDiscount = payload.maxDiscount !== undefined && payload.maxDiscount !== null ? Number(payload.maxDiscount) : null;
    const minOrderAmount = Number(payload.minOrderAmount) || 0;
    const totalUsageLimit = payload.totalUsageLimit !== undefined ? Number(payload.totalUsageLimit) : (payload.usageLimit !== undefined ? Number(payload.usageLimit) : null);
    const validFrom = payload.validFrom || (payload.startDate ? new Date(payload.startDate).toISOString() : new Date().toISOString());
    const validUntil = payload.validUntil || (payload.endDate ? new Date(payload.endDate).toISOString() : new Date(Date.now() + 365 * 86400000).toISOString());
    const isActive = payload.status !== undefined ? (payload.status === 'ACTIVE') : (payload.isActive !== undefined ? Boolean(payload.isActive) : true);
    const perUserLimit = Number(payload.perUserLimit) || 1;
    const eligibleVehicle = payload.eligibleVehicle || 'ALL';
    const eligibleMerchant = payload.eligibleMerchant || 'ALL';
    const eligibleArea = payload.eligibleArea || 'ALL';
    const newUserOnly = Boolean(payload.newUserOnly);
    const createdBy = adminName || 'Admin';

    if (isLivePostgres && supabaseAdmin) {
      const rowToInsert = {
        code,
        name: payload.name || code,
        description: payload.description || '',
        service_type: serviceType,
        discount_type: discountType,
        discount_value: discountValue,
        max_discount: maxDiscount,
        min_order_amount: minOrderAmount,
        total_usage_limit: totalUsageLimit,
        usage_count: 0,
        valid_from: validFrom,
        valid_until: validUntil,
        is_active: isActive,
        per_user_limit: perUserLimit,
        eligible_vehicle: eligibleVehicle,
        eligible_merchant: eligibleMerchant,
        eligible_area: eligibleArea,
        new_user_only: newUserOnly,
        created_by: createdBy
      };

      const { data, error } = await supabaseAdmin
        .from('promotions')
        .upsert(rowToInsert, { onConflict: 'code' })
        .select('*')
        .single();

      if (error) {
        throw new Error(`Failed to create promotion in PostgreSQL: ${error.message}`);
      }

      const dto = mapRowToDTO(data);
      if (this.db && this.db.promotions) {
        this.db.promotions.unshift(dto);
      }
      return dto;
    }

    // Non-live fallback
    const mockPromo = {
      id: `prm_${Date.now()}`,
      code,
      name: payload.name || code,
      description: payload.description || '',
      discountType,
      discountValue,
      maxDiscount,
      minOrderAmount,
      startDate: validFrom.slice(0, 10),
      endDate: validUntil.slice(0, 10),
      validFrom,
      validUntil,
      usageLimit: totalUsageLimit,
      totalUsageLimit,
      perUserLimit,
      eligibleService: serviceType,
      serviceType,
      eligibleVehicle,
      eligibleMerchant,
      eligibleArea,
      newUserOnly,
      status: isActive ? 'ACTIVE' : 'INACTIVE',
      isActive,
      usedCount: 0,
      usageCount: 0,
      createdBy,
      createdAt: new Date().toISOString()
    };

    if (this.db && this.db.promotions) {
      this.db.promotions.unshift(mockPromo);
    }
    return mockPromo;
  }

  /**
   * Update an existing promotion.
   */
  async update(id, payload) {
    if (!id) throw new Error('Promotion ID is required');

    if (isLivePostgres && supabaseAdmin) {
      const updates = {
        updated_at: new Date().toISOString()
      };

      if (payload.status !== undefined) updates.is_active = (payload.status === 'ACTIVE');
      if (payload.isActive !== undefined) updates.is_active = Boolean(payload.isActive);
      if (payload.discountValue !== undefined) updates.discount_value = Number(payload.discountValue);
      if (payload.maxDiscount !== undefined) updates.max_discount = Number(payload.maxDiscount);
      if (payload.name !== undefined) updates.name = payload.name;
      if (payload.description !== undefined) updates.description = payload.description;
      if (payload.totalUsageLimit !== undefined) updates.total_usage_limit = Number(payload.totalUsageLimit);
      else if (payload.usageLimit !== undefined) updates.total_usage_limit = Number(payload.usageLimit);
      if (payload.perUserLimit !== undefined) updates.per_user_limit = Number(payload.perUserLimit);
      if (payload.validUntil !== undefined) updates.valid_until = payload.validUntil;
      else if (payload.endDate !== undefined) updates.valid_until = new Date(payload.endDate).toISOString();

      let query = supabaseAdmin.from('promotions').update(updates);
      if (UUID_REGEX.test(id)) {
        query = query.eq('id', id);
      } else {
        query = query.or(`id.eq.${id},code.ilike.${id}`);
      }

      const { data, error } = await query.select('*').maybeSingle();
      if (error) {
        throw new Error(`Failed to update promotion in PostgreSQL: ${error.message}`);
      }
      if (!data) return null;

      const dto = mapRowToDTO(data);
      if (this.db && this.db.promotions) {
        const idx = this.db.promotions.findIndex(p => p.id === dto.id || p.code === dto.code);
        if (idx !== -1) this.db.promotions[idx] = { ...this.db.promotions[idx], ...dto };
      }
      return dto;
    }

    // Non-live fallback
    if (this.db && this.db.promotions) {
      const promo = this.db.promotions.find(p => p.id === id || p.code === id);
      if (!promo) return null;
      if (payload.status !== undefined) promo.status = payload.status;
      if (payload.isActive !== undefined) promo.status = payload.isActive ? 'ACTIVE' : 'INACTIVE';
      if (payload.discountValue !== undefined) promo.discountValue = Number(payload.discountValue);
      if (payload.maxDiscount !== undefined) promo.maxDiscount = Number(payload.maxDiscount);
      if (payload.name !== undefined) promo.name = payload.name;
      return promo;
    }
    return null;
  }

  /**
   * List promotions with optional filters.
   */
  async list(filters = {}) {
    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin.from('promotions').select('*');

      if (filters.serviceType && filters.serviceType !== 'ALL') {
        query = query.or(`service_type.eq.${filters.serviceType},service_type.eq.ALL`);
      }
      if (filters.status) {
        query = query.eq('is_active', filters.status === 'ACTIVE');
      }
      if (filters.activeOnly || filters.isActive === true) {
        query = query.eq('is_active', true);
      }

      query = query.order('created_at', { ascending: false });
      const limit = Math.min(parseInt(filters.limit, 10) || 50, 100);
      query = query.limit(limit);

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to query promotions from PostgreSQL: ${error.message}`);
      }
      return (data || []).map(mapRowToDTO);
    }

    // Non-live fallback
    let results = [...(this.db.promotions || [])];
    if (filters.serviceType && filters.serviceType !== 'ALL') {
      results = results.filter(p => p.eligibleService === filters.serviceType || p.eligibleService === 'ALL');
    }
    if (filters.status) {
      results = results.filter(p => p.status === filters.status);
    }
    return results;
  }

  /**
   * Find promotion by UUID or ID.
   */
  async getById(id) {
    if (!id) return null;
    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin.from('promotions').select('*');
      if (UUID_REGEX.test(id)) {
        query = query.eq('id', id);
      } else {
        query = query.or(`id.eq.${id},code.ilike.${id}`);
      }
      const { data, error } = await query.maybeSingle();
      if (error || !data) return null;
      return mapRowToDTO(data);
    }
    return (this.db.promotions || []).find(p => p.id === id || p.code === id) || null;
  }

  /**
   * Find promotion by Code.
   */
  async getByCode(code) {
    if (!code) return null;
    const cleanCode = code.trim().toUpperCase();
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('promotions')
        .select('*')
        .ilike('code', cleanCode)
        .maybeSingle();
      if (error || !data) return null;
      return mapRowToDTO(data);
    }
    return (this.db.promotions || []).find(p => p.code.toUpperCase() === cleanCode) || null;
  }

  /**
   * Read-only preview & validation of promotion coupon code.
   * In live mode, this invokes the validate_promotion_preview RPC.
   * CRITICAL: This is read-only and does NOT increment usage_count or insert rows.
   */
  async preview({ code, userId, orderAmount, service, vehicleType, areaId }) {
    if (!code) {
      return { success: false, error: 'Coupon code required' };
    }

    const cleanCode = code.trim().toUpperCase();
    const orderAmt = Number(orderAmount) || 0;
    const srv = (service || 'RIDE').toUpperCase();
    const userUuid = this.resolveUserUuid(userId);

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('validate_promotion_preview', {
        p_code: cleanCode,
        p_user_id: userUuid || null,
        p_order_amount: orderAmt,
        p_service_type: srv,
        p_vehicle_type: vehicleType || null,
        p_area_id: areaId || null
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data || !data.success) {
        return { success: false, error: data?.error || 'Invalid or expired promo code.' };
      }

      return {
        success: true,
        code: data.code,
        promotionId: data.promotion_id,
        name: data.name,
        discount: parseFloat(data.discount),
        finalAmount: parseFloat(data.final_amount),
        discountType: data.discount_type,
        discountValue: parseFloat(data.discount_value),
        maxDiscount: data.max_discount !== null ? parseFloat(data.max_discount) : null,
        usageCount: Number(data.usage_count || 0),
        totalUsageLimit: data.total_usage_limit !== null ? Number(data.total_usage_limit) : null
      };
    }

    // Non-live fallback: pure read-only check (NEVER increment usage)
    const promo = (this.db.promotions || []).find(p => p.code.toUpperCase() === cleanCode && p.status === 'ACTIVE');
    if (!promo) return { success: false, error: 'Invalid or expired promo code.' };

    if (promo.eligibleService && promo.eligibleService !== 'ALL' && promo.eligibleService !== srv) {
      return { success: false, error: `Coupon code is only valid for ${promo.eligibleService} orders.` };
    }

    if (orderAmt < (promo.minOrderAmount || 0)) {
      return { success: false, error: `Minimum order amount of ₹${promo.minOrderAmount} required for this coupon.` };
    }

    let discount = 0;
    if (promo.discountType === 'PERCENTAGE') {
      discount = Math.min(promo.maxDiscount || Infinity, Math.round((orderAmt * promo.discountValue) / 100));
    } else {
      discount = Math.min(promo.maxDiscount || Infinity, promo.discountValue);
    }

    return {
      success: true,
      code: promo.code,
      promotionId: promo.id,
      name: promo.name,
      discount,
      finalAmount: Math.max(0, orderAmt - discount)
    };
  }

  /**
   * Authoritative Atomic Redemption.
   * Invokes redeem_promotion_atomic RPC with PostgreSQL FOR UPDATE row locks.
   * Enforces idempotency, increments usage_count, and creates promotion_redemptions row.
   */
  async redeem({ code, userId, orderAmount, service, jobId, idempotencyKey, vehicleType, areaId }) {
    if (!code) throw new Error('Coupon code is required for redemption');
    if (!userId) throw new Error('User ID is required for redemption');

    const cleanCode = code.trim().toUpperCase();
    const orderAmt = Number(orderAmount) || 0;
    const srv = (service || 'RIDE').toUpperCase();
    const userUuid = this.resolveUserUuid(userId);
    const jobUuid = this.resolveJobUuid(jobId);

    if (!userUuid) {
      throw new Error(`Unable to resolve user UUID for redemption: ${userId}`);
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('redeem_promotion_atomic', {
        p_code: cleanCode,
        p_user_id: userUuid,
        p_order_amount: orderAmt,
        p_service_type: srv,
        p_job_id: jobUuid || null,
        p_idempotency_key: idempotencyKey || null,
        p_vehicle_type: vehicleType || null,
        p_area_id: areaId || null
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data || !data.success) {
        return { success: false, error: data?.error || 'Redemption failed' };
      }

      return {
        success: true,
        duplicate: Boolean(data.duplicate),
        idempotent: Boolean(data.idempotent),
        redemptionId: data.redemption_id,
        promotionId: data.promotion_id,
        code: data.code,
        name: data.name,
        discount: parseFloat(data.discount),
        finalAmount: parseFloat(data.final_amount),
        usageCount: Number(data.usage_count)
      };
    }

    // Non-live fallback
    const previewRes = await this.preview({ code: cleanCode, userId, orderAmount: orderAmt, service: srv, vehicleType, areaId });
    if (!previewRes.success) return previewRes;

    const promo = (this.db.promotions || []).find(p => p.code.toUpperCase() === cleanCode);
    if (promo) {
      promo.usedCount = (promo.usedCount || 0) + 1;
      promo.usageCount = promo.usedCount;
    }

    return {
      success: true,
      redemptionId: `red_${Date.now()}`,
      promotionId: promo?.id,
      code: cleanCode,
      name: promo?.name,
      discount: previewRes.discount,
      finalAmount: previewRes.finalAmount,
      usageCount: promo?.usedCount || 1
    };
  }

  /**
   * List promotion redemptions history.
   */
  async listRedemptions(filters = {}) {
    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin.from('promotion_redemptions').select('*');

      if (filters.promotionId) {
        query = query.eq('promotion_id', filters.promotionId);
      }
      if (filters.userId) {
        const u = this.resolveUserUuid(filters.userId);
        if (u) query = query.eq('user_id', u);
      }
      if (filters.jobId) {
        const j = this.resolveJobUuid(filters.jobId);
        if (j) query = query.eq('job_id', j);
      }

      query = query.order('redeemed_at', { ascending: false });
      const limit = Math.min(parseInt(filters.limit, 10) || 50, 100);
      query = query.limit(limit);

      const { data, error } = await query;
      if (error) {
        throw new Error(`Failed to query redemptions from PostgreSQL: ${error.message}`);
      }
      return (data || []).map(mapRedemptionRowToDTO);
    }

    return [];
  }
}

module.exports = PromotionRepository;
