/**
 * MerchantRepository - Authoritative data access for `merchants` table.
 *
 * Provides persistent database operations for:
 *   - Merchant registration (RESTAURANT, GROCERY, HYBRID_BOTH)
 *   - Identity and phone resolution
 *   - Service entitlement evaluation
 *   - Tenant isolation verification
 *
 * Uses supabaseAdmin (service_role) against PostgreSQL `merchants` table with fail-closed semantics.
 */
const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_MERCHANT_TYPES = ['RESTAURANT', 'GROCERY', 'HYBRID_BOTH'];

class MerchantRepository {
  constructor(db) {
    this.db = db;
  }

  normalizePhone(phone) {
    if (!phone) return '';
    if (this.db && typeof this.db.normalizePhone === 'function') {
      return this.db.normalizePhone(phone);
    }
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
    return `+${digits}`;
  }

  isStoreUnreachable(err) {
    if (!err) return false;
    const msg = (err.message || String(err)).toLowerCase();
    const code = err.code || '';
    return (
      code === 'STORE_UNAVAILABLE' ||
      code === 'ECONNREFUSED' ||
      code === 'ETIMEDOUT' ||
      msg.includes('connection refused') ||
      msg.includes('network error') ||
      msg.includes('fetch failed')
    );
  }

  /**
   * Find a persistent merchant by UUID or ID
   */
  async findById(merchantId) {
    if (!merchantId) return null;
    let targetId = merchantId;

    if (!UUID_REGEX.test(targetId)) {
      // Legacy id mapping check
      if (this.db && this.db.restaurants) {
        const found = this.db.restaurants.find(r => r.id === targetId || r.restaurantId === targetId);
        if (found && found.uuid) targetId = found.uuid;
        else if (found) return found;
      }
    }

    if (isLivePostgres && supabaseAdmin && UUID_REGEX.test(targetId)) {
      const { data, error } = await supabaseAdmin
        .from('merchants')
        .select('*')
        .eq('id', targetId)
        .maybeSingle();

      if (error) {
        if (error.code === '42501' || (error.message && error.message.includes('permission denied'))) {
          // PostgREST permission denied on table (e.g. hosted test environment without table grants)
          console.warn(`[MerchantRepository] merchants table permission denied for ${targetId}; checking memory store`);
        } else {
          throw error;
        }
      } else if (data) {
        return data;
      }
    }

    if (this.db && this.db.restaurants) {
      return this.db.restaurants.find(r => r.id === merchantId || r.uuid === merchantId) || null;
    }

    return null;
  }

  /**
   * Find a persistent merchant by normalized 10-digit phone
   */
  async findByPhone(phone) {
    const normPhone = this.normalizePhone(phone);
    if (!normPhone) return null;
    const rawDigits = normPhone.replace(/\D/g, '').slice(-10);
    const e164 = `+91${rawDigits}`;

    if (isLivePostgres && supabaseAdmin) {
      // Search with both national and E.164 formats (+91)
      const { data, error } = await supabaseAdmin
        .from('merchants')
        .select('*')
        .or(`phone.eq.${rawDigits},phone.eq.${e164}`)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        if (error.code === '42501' || (error.message && error.message.includes('permission denied'))) {
          console.warn(`[MerchantRepository] merchants table permission denied for phone ${normPhone}; checking memory store`);
        } else {
          throw error;
        }
      } else if (data) {
        return data;
      }
    }

    if (this.db && this.db.restaurants) {
      return this.db.restaurants.find(r => {
        const p = this.normalizePhone(r.phone);
        return p === normPhone || p === e164 || r.phone === rawDigits;
      }) || null;
    }

    return null;
  }

  /**
   * Create a new merchant in the persistent database
   */
  async createMerchant(payload) {
    const {
      name,
      businessType,
      phone,
      address,
      lat = 23.7271,
      lng = 92.7176,
      fssaiLicense = null,
      cuisines = ['All'],
      coverImageUrl = null,
      standardDeliveryMinutes = 30
    } = payload;

    const normPhone = this.normalizePhone(phone);
    const rawDigits = normPhone.replace(/\D/g, '').slice(-10);
    const e164Phone = `+91${rawDigits}`;

    let mType = 'HYBRID_BOTH';
    const typeUpper = String(businessType || '').toUpperCase().trim();
    if (typeUpper === 'RESTAURANT') mType = 'RESTAURANT';
    else if (typeUpper === 'GROCERY') mType = 'GROCERY';
    else if (typeUpper === 'BOTH' || typeUpper === 'HYBRID_BOTH') mType = 'HYBRID_BOTH';
    else {
      const err = new Error("Business type must be 'RESTAURANT', 'GROCERY', or 'BOTH'.");
      err.code = 'INVALID_BUSINESS_TYPE';
      err.status = 400;
      throw err;
    }

    // Check duplicate existence
    const existing = await this.findByPhone(normPhone);
    if (existing) {
      const err = new Error('A merchant account is already registered for this phone number. Please sign in instead.');
      err.code = 'MERCHANT_ALREADY_REGISTERED';
      err.status = 409;
      throw err;
    }

    const fallbackId = crypto.randomUUID();
    // A registration is a request to be reviewed, not a decision to accept the partner.
    // Until this line changed, this was the whole onboarding funnel: `is_open: true` made
    // the store orderable the instant the insert landed (the public read policy keyed on
    // `is_open` alone), and `rating: 4.80` put a review score on a storefront that had
    // never served a customer. Neither value was derived from anything — both were
    // written here and read everywhere else as if the platform had decided them.
    // Migration 048 adds `approval_status`, and the gate is now PENDING/`is_open: false`
    // until an admin with `merchant.manage` decides otherwise through
    // `DatabaseService.setMerchantApproval`. `rating` stays NULL: a rating is an
    // aggregation of real reviews, and there are none yet.
    const insertData = {
      id: fallbackId,
      name: String(name || '').trim(),
      merchant_type: mType,
      phone: e164Phone,
      address: String(address || '').trim(),
      lat: Number(lat) || 23.7271,
      lng: Number(lng) || 92.7176,
      fssai_license: fssaiLicense ? String(fssaiLicense).trim() : null,
      is_open: false,
      approval_status: 'PENDING',
      rating: null,
      wallet_balance: 0.00,
      commission_rate: 0.15,
      cuisines: Array.isArray(cuisines) ? cuisines : ['All'],
      cover_image_url: coverImageUrl || null,
      standard_delivery_minutes: Number(standardDeliveryMinutes) || 30
    };

    let persistentRecord = null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('merchants')
        .insert(insertData)
        .select('*')
        .single();

      if (error) {
        if (error.code === '42501' || (error.message && error.message.includes('permission denied'))) {
          console.warn('⚠️ Supabase PostgREST table grant pending on merchants table; storing in memory fallback');
          persistentRecord = insertData;
        } else {
          throw error;
        }
      } else {
        persistentRecord = data;
      }
    } else {
      persistentRecord = insertData;
    }

    // Mirror in db.restaurants for memory-cached queries
    if (this.db && this.db.restaurants) {
      this.db.restaurants.push({
        id: persistentRecord.id,
        uuid: persistentRecord.id,
        name: persistentRecord.name,
        merchant_type: persistentRecord.merchant_type,
        merchantType: persistentRecord.merchant_type,
        phone: persistentRecord.phone,
        address: persistentRecord.address,
        lat: persistentRecord.lat,
        lng: persistentRecord.lng,
        fssai_license: persistentRecord.fssai_license,
        fssaiLicense: persistentRecord.fssai_license,
        is_open: Boolean(persistentRecord.is_open),
        // `|| 4.8` here re-fabricated the score on the degraded read path even after the
        // durable column stopped carrying it, so a memory-served listing could still claim
        // a rating for a store with no reviews.
        rating: persistentRecord.rating == null ? null : Number(persistentRecord.rating),
        approval_status: persistentRecord.approval_status || 'PENDING',
        approvalStatus: persistentRecord.approval_status || 'PENDING',
        walletBalance: Number(persistentRecord.wallet_balance) || 0,
        commissionRate: Number(persistentRecord.commission_rate) || 0.15,
        cuisines: persistentRecord.cuisines || ['All'],
        menu: []
      });
    }

    return persistentRecord;
  }

  /**
   * Derive server-authorized services from merchant record
   */
  getServices(merchant) {
    if (!merchant) return [];
    const mType = String(merchant.merchant_type || merchant.merchantType || '').toUpperCase();
    const services = [];
    if (['RESTAURANT', 'HYBRID_BOTH'].includes(mType)) services.push('RESTAURANT');
    if (['GROCERY', 'HYBRID_BOTH'].includes(mType)) services.push('INSTAMART');
    return services;
  }
}

module.exports = MerchantRepository;
