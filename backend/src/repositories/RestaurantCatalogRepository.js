/**
 * RestaurantCatalogRepository - Authoritative persistence for Restaurant Dishes,
 * Variants, Add-on Groups, and Customizations.
 *
 * Implements:
 *   - Persistent Dish CRUD (Create, Read, Update, Archive, Availability)
 *   - Dish Variants CRUD (Half/Full, prices, availability)
 *   - Add-on Groups & Options CRUD (selection rules: min/max, required/optional)
 *   - Tenant isolation & service entitlement verification
 *   - Dual-store resilience (Supabase products table + durable local mirror fallback)
 */

const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_DIETARY_TYPES = ['VEG', 'NON_VEG', 'VEGAN', 'EGG'];

class RestaurantCatalogRepository {
  constructor(db) {
    this.db = db;
    if (this.db && !this.db.restaurantCatalog) {
      this.db.restaurantCatalog = [];
      this._seedFromFixtures();
    }
  }

  _seedFromFixtures() {
    if (!this.db || !this.db.restaurants) return;
    for (const rest of this.db.restaurants) {
      const merchantId = rest.uuid || rest.id;
      if (Array.isArray(rest.menu)) {
        for (const item of rest.menu) {
          const dishId = item.uuid || (UUID_REGEX.test(item.id) ? item.id : crypto.randomUUID());
          const isVeg = item.isVeg !== undefined ? item.isVeg : true;
          const dietaryType = item.dietaryType || (isVeg ? 'VEG' : 'NON_VEG');
          const existing = this.db.restaurantCatalog.find(d => d.id === dishId || (d.sku && d.sku === item.id));
          if (!existing) {
            this.db.restaurantCatalog.push({
              id: dishId,
              merchant_id: merchantId,
              merchantId: merchantId,
              sku: item.id || `SKU-${dishId.slice(0, 8)}`,
              name: item.name,
              description: item.description || '',
              category: item.category || 'Main Course',
              price: Number(item.price || 0),
              discount_price: item.discount_price !== undefined ? item.discount_price : null,
              dietary_type: dietaryType,
              is_veg: isVeg,
              isVeg: isVeg,
              prep_time_minutes: Number(item.prepTimeMinutes || item.prep_time_minutes || 20),
              is_available: item.inStock !== false && item.is_available !== false,
              isAvailable: item.inStock !== false && item.is_available !== false,
              is_archived: false,
              isArchived: false,
              in_stock_quantity: -1,
              image_url: item.imageUrl || item.image_url || null,
              photos: item.photos || (item.imageUrl ? [{ id: crypto.randomUUID(), url: item.imageUrl, isPrimary: true, sortOrder: 0 }] : []),
              variants: Array.isArray(item.variants) ? item.variants.map(v => ({
                id: v.id || crypto.randomUUID(),
                name: v.name,
                price: Number(v.price || 0),
                isAvailable: v.isAvailable !== false,
                isDefault: Boolean(v.isDefault),
                sku: v.sku || null
              })) : [],
              add_on_groups: Array.isArray(item.addOnGroups || item.add_on_groups) ? (item.addOnGroups || item.add_on_groups).map(g => ({
                id: g.id || crypto.randomUUID(),
                name: g.name,
                isRequired: Boolean(g.isRequired),
                minSelections: Number(g.minSelections || 0),
                maxSelections: Number(g.maxSelections || (g.options ? g.options.length : 1)),
                allowMultiple: Boolean(g.allowMultiple),
                options: Array.isArray(g.options) ? g.options.map(o => ({
                  id: o.id || crypto.randomUUID(),
                  name: o.name,
                  price: Number(o.price || 0),
                  isAvailable: o.isAvailable !== false,
                  isDefault: Boolean(o.isDefault)
                })) : []
              })) : [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            });
          }
        }
      }
    }
  }

  resolveMerchantId(merchantId) {
    if (!merchantId) return null;
    if (this.db && this.db.restaurants) {
      const rest = this.db.restaurants.find(r => r.id === merchantId || r.uuid === merchantId);
      if (rest) return rest.uuid || rest.id;
    }
    return merchantId;
  }

  normalizeDish(raw) {
    if (!raw) return null;
    const isVeg = raw.is_veg !== undefined ? raw.is_veg : (raw.isVeg !== undefined ? raw.isVeg : true);
    const dietaryType = raw.dietary_type || raw.dietaryType || (isVeg ? 'VEG' : 'NON_VEG');
    const isAvailable = raw.is_available !== undefined ? raw.is_available : (raw.isAvailable !== undefined ? raw.isAvailable : true);
    const isArchived = Boolean(raw.is_archived || raw.isArchived);

    // Variants parsing
    let variants = [];
    if (Array.isArray(raw.variants)) {
      variants = raw.variants.map(v => ({
        id: v.id || crypto.randomUUID(),
        name: String(v.name || '').trim(),
        price: Number(v.price ?? 0),
        isAvailable: v.isAvailable !== false,
        isDefault: Boolean(v.isDefault),
        sku: v.sku ? String(v.sku) : null
      }));
    }

    // Add-on groups parsing
    let addOnGroups = [];
    const rawGroups = raw.add_on_groups || raw.addOnGroups;
    if (Array.isArray(rawGroups)) {
      addOnGroups = rawGroups.map(g => ({
        id: g.id || crypto.randomUUID(),
        name: String(g.name || '').trim(),
        isRequired: Boolean(g.isRequired),
        minSelections: Math.max(0, Number(g.minSelections ?? (g.isRequired ? 1 : 0))),
        maxSelections: Math.max(1, Number(g.maxSelections ?? (g.options ? g.options.length : 1))),
        allowMultiple: Boolean(g.allowMultiple),
        options: Array.isArray(g.options) ? g.options.map(o => ({
          id: o.id || crypto.randomUUID(),
          name: String(o.name || '').trim(),
          price: Number(o.price ?? 0),
          isAvailable: o.isAvailable !== false,
          isDefault: Boolean(o.isDefault)
        })) : []
      }));
    }

    // Photos parsing
    let photos = [];
    if (Array.isArray(raw.photos)) {
      photos = raw.photos.map((p, idx) => ({
        id: p.id || crypto.randomUUID(),
        url: p.url || p.secure_url || p.imageUrl,
        isPrimary: Boolean(p.isPrimary || idx === 0),
        sortOrder: Number(p.sortOrder ?? idx)
      }));
    } else if (raw.image_url || raw.imageUrl) {
      photos = [{
        id: crypto.randomUUID(),
        url: raw.image_url || raw.imageUrl,
        isPrimary: true,
        sortOrder: 0
      }];
    }

    const primaryPhotoUrl = photos.find(p => p.isPrimary)?.url || photos[0]?.url || raw.image_url || raw.imageUrl || null;

    return {
      id: raw.id,
      merchantId: raw.merchant_id || raw.merchantId,
      merchant_id: raw.merchant_id || raw.merchantId,
      sku: raw.sku || null,
      name: raw.name,
      description: raw.description || null,
      category: raw.category,
      price: Number(raw.price ?? 0),
      discountPrice: raw.discount_price !== undefined && raw.discount_price !== null ? Number(raw.discount_price) : null,
      discount_price: raw.discount_price !== undefined && raw.discount_price !== null ? Number(raw.discount_price) : null,
      dietaryType,
      dietary_type: dietaryType,
      isVeg,
      is_veg: isVeg,
      prepTimeMinutes: Number(raw.prep_time_minutes ?? raw.prepTimeMinutes ?? 20),
      prep_time_minutes: Number(raw.prep_time_minutes ?? raw.prepTimeMinutes ?? 20),
      isAvailable,
      is_available: isAvailable,
      isArchived,
      is_archived: isArchived,
      imageUrl: primaryPhotoUrl,
      image_url: primaryPhotoUrl,
      photos,
      variants,
      addOnGroups,
      add_on_groups: addOnGroups,
      createdAt: raw.created_at || raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updated_at || raw.updatedAt || new Date().toISOString()
    };
  }

  /**
   * List dishes for a merchant
   */
  async listDishes(merchantId, { category = null, includeArchived = false } = {}) {
    if (!merchantId) return [];
    const resolvedMerchantId = this.resolveMerchantId(merchantId);

    // Try Live Supabase first
    if (isLivePostgres && supabaseAdmin) {
      try {
        let query = supabaseAdmin
          .from('products')
          .select('*')
          .eq('merchant_id', resolvedMerchantId);

        if (!includeArchived) {
          query = query.or('is_archived.is.null,is_archived.eq.false');
        }
        if (category && category !== 'ALL') {
          query = query.eq('category', category);
        }

        const { data, error } = await query.order('category', { ascending: true }).order('name', { ascending: true });
        if (!error && data) {
          return data.map(d => this.normalizeDish(d));
        }
      } catch (err) {
        // Fallback to local memory on DB permission limits or disconnect
      }
    }

    // Memory Store Fallback
    let items = (this.db?.restaurantCatalog || []).filter(d => {
      const mId = d.merchantId || d.merchant_id;
      const matchMerchant = mId === resolvedMerchantId || mId === merchantId;
      if (!matchMerchant) return false;
      if (!includeArchived && (d.isArchived || d.is_archived)) return false;
      if (category && category !== 'ALL' && d.category !== category) return false;
      return true;
    });

    return items.map(d => this.normalizeDish(d));
  }

  /**
   * Get single dish by ID and merchant ID
   */
  async getDishById(merchantId, dishId) {
    if (!merchantId || !dishId) return null;
    const resolvedMerchantId = this.resolveMerchantId(merchantId);

    // Try live Supabase first
    if (isLivePostgres && supabaseAdmin) {
      try {
        let query = supabaseAdmin.from('products').select('*');
        query = UUID_REGEX.test(dishId) ? query.eq('id', dishId) : query.eq('sku', dishId);

        const { data, error } = await query.maybeSingle();
        if (!error && data) {
          const dish = this.normalizeDish(data);
          if (dish.merchantId !== resolvedMerchantId && dish.merchantId !== merchantId) {
            const err = new Error(`Forbidden: Dish [${dishId}] belongs to another merchant.`);
            err.code = 'MERCHANT_MISMATCH';
            err.statusCode = 403;
            throw err;
          }
          return dish;
        }
      } catch (err) {
        if (err.code === 'MERCHANT_MISMATCH') throw err;
      }
    }

    // Memory Store Fallback
    const found = (this.db?.restaurantCatalog || []).find(d => {
      const matchId = d.id === dishId || d.sku === dishId;
      return matchId;
    });

    if (!found) return null;
    const dish = this.normalizeDish(found);
    if (dish.merchantId !== resolvedMerchantId && dish.merchantId !== merchantId) {
      const err = new Error(`Forbidden: Dish [${dishId}] belongs to another merchant.`);
      err.code = 'MERCHANT_MISMATCH';
      err.statusCode = 403;
      throw err;
    }
    return dish;
  }

  /**
   * Create a new restaurant dish
   */
  async createDish(merchantId, dishData) {
    if (!merchantId) {
      const err = new Error('Merchant ID is required');
      err.code = 'MERCHANT_REQUIRED';
      err.statusCode = 400;
      throw err;
    }
    const resolvedMerchantId = this.resolveMerchantId(merchantId);

    const name = String(dishData.name || '').trim();
    if (!name) {
      const err = new Error('Dish name is required');
      err.code = 'INVALID_DISH_NAME';
      err.statusCode = 400;
      throw err;
    }

    const price = Number(dishData.price);
    if (isNaN(price) || price < 0) {
      const err = new Error('Base price must be a non-negative number');
      err.code = 'INVALID_PRICE';
      err.statusCode = 400;
      throw err;
    }

    const category = String(dishData.category || '').trim();
    if (!category) {
      const err = new Error('Dish category is required');
      err.code = 'INVALID_CATEGORY';
      err.statusCode = 400;
      throw err;
    }

    const dietaryType = String(dishData.dietaryType || (dishData.isVeg === false ? 'NON_VEG' : 'VEG')).toUpperCase();
    if (!VALID_DIETARY_TYPES.includes(dietaryType)) {
      const err = new Error(`Invalid dietary type. Must be one of: ${VALID_DIETARY_TYPES.join(', ')}`);
      err.code = 'INVALID_DIETARY_TYPE';
      err.statusCode = 400;
      throw err;
    }

    const prepTimeMinutes = Number(dishData.prepTimeMinutes || dishData.prep_time_minutes || 20);
    if (isNaN(prepTimeMinutes) || prepTimeMinutes < 0) {
      const err = new Error('Preparation time must be a non-negative number');
      err.code = 'INVALID_PREP_TIME';
      err.statusCode = 400;
      throw err;
    }

    // Validate Variants
    const variants = (dishData.variants || []).map((v, i) => {
      const vName = String(v.name || '').trim();
      if (!vName) {
        const err = new Error(`Variant at index ${i} must have a name`);
        err.code = 'INVALID_VARIANT_NAME';
        err.statusCode = 400;
        throw err;
      }
      const vPrice = Number(v.price);
      if (isNaN(vPrice) || vPrice < 0) {
        const err = new Error(`Variant '${vName}' price must be non-negative`);
        err.code = 'INVALID_VARIANT_PRICE';
        err.statusCode = 400;
        throw err;
      }
      return {
        id: v.id && UUID_REGEX.test(v.id) ? v.id : crypto.randomUUID(),
        name: vName,
        price: vPrice,
        isAvailable: v.isAvailable !== false,
        isDefault: Boolean(v.isDefault),
        sku: v.sku || null
      };
    });

    // Validate Add-on Groups
    const addOnGroups = (dishData.addOnGroups || dishData.add_on_groups || []).map((g, i) => {
      const gName = String(g.name || '').trim();
      if (!gName) {
        const err = new Error(`Add-on group at index ${i} must have a name`);
        err.code = 'INVALID_ADDON_GROUP_NAME';
        err.statusCode = 400;
        throw err;
      }
      const isReq = Boolean(g.isRequired);
      const minSel = Math.max(0, Number(g.minSelections ?? (isReq ? 1 : 0)));
      const options = (g.options || []).map((o, j) => {
        const oName = String(o.name || '').trim();
        if (!oName) {
          const err = new Error(`Option at index ${j} in group '${gName}' must have a name`);
          err.code = 'INVALID_ADDON_OPTION_NAME';
          err.statusCode = 400;
          throw err;
        }
        const oPrice = Number(o.price);
        if (isNaN(oPrice) || oPrice < 0) {
          const err = new Error(`Option '${oName}' price must be non-negative`);
          err.code = 'INVALID_ADDON_OPTION_PRICE';
          err.statusCode = 400;
          throw err;
        }
        return {
          id: o.id && UUID_REGEX.test(o.id) ? o.id : crypto.randomUUID(),
          name: oName,
          price: oPrice,
          isAvailable: o.isAvailable !== false,
          isDefault: Boolean(o.isDefault)
        };
      });

      const maxSel = Number(g.maxSelections ?? Math.max(1, options.length));
      if (minSel > maxSel) {
        const err = new Error(`Group '${gName}': minSelections (${minSel}) cannot exceed maxSelections (${maxSel})`);
        err.code = 'INVALID_SELECTION_BOUNDS';
        err.statusCode = 400;
        throw err;
      }

      return {
        id: g.id && UUID_REGEX.test(g.id) ? g.id : crypto.randomUUID(),
        name: gName,
        isRequired: isReq || minSel > 0,
        minSelections: minSel,
        maxSelections: maxSel,
        allowMultiple: Boolean(g.allowMultiple),
        options
      };
    });

    // Photos
    const photos = (dishData.photos || []).map((p, idx) => ({
      id: p.id || crypto.randomUUID(),
      url: p.url || p.secure_url || p.imageUrl,
      isPrimary: Boolean(p.isPrimary || idx === 0),
      sortOrder: Number(p.sortOrder ?? idx)
    }));

    const primaryImageUrl = photos.find(p => p.isPrimary)?.url || dishData.imageUrl || dishData.image_url || null;

    const dishRecord = {
      id: dishData.id && UUID_REGEX.test(dishData.id) ? dishData.id : crypto.randomUUID(),
      merchant_id: resolvedMerchantId,
      merchantId: resolvedMerchantId,
      sku: dishData.sku || `DISH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      name,
      description: dishData.description ? String(dishData.description).trim() : null,
      category,
      price,
      discount_price: dishData.discountPrice !== undefined ? dishData.discountPrice : (dishData.discount_price !== undefined ? dishData.discount_price : null),
      dietary_type: dietaryType,
      dietaryType,
      is_veg: dietaryType === 'VEG' || dietaryType === 'VEGAN',
      isVeg: dietaryType === 'VEG' || dietaryType === 'VEGAN',
      prep_time_minutes: prepTimeMinutes,
      prepTimeMinutes,
      is_available: dishData.isAvailable !== false && dishData.is_available !== false,
      isAvailable: dishData.isAvailable !== false && dishData.is_available !== false,
      is_archived: false,
      isArchived: false,
      in_stock_quantity: -1,
      image_url: primaryImageUrl,
      imageUrl: primaryImageUrl,
      photos,
      variants,
      add_on_groups: addOnGroups,
      addOnGroups,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Live Supabase persist if available
    if (isLivePostgres && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('products')
          .insert({
            id: dishRecord.id,
            merchant_id: resolvedMerchantId,
            sku: dishRecord.sku,
            name: dishRecord.name,
            description: dishRecord.description,
            category: dishRecord.category,
            price: dishRecord.price,
            discount_price: dishRecord.discount_price,
            dietary_type: dishRecord.dietary_type,
            is_veg: dishRecord.is_veg,
            prep_time_minutes: dishRecord.prep_time_minutes,
            is_available: dishRecord.is_available,
            is_archived: false,
            in_stock_quantity: -1,
            image_url: dishRecord.image_url,
            photos: dishRecord.photos,
            variants: dishRecord.variants,
            add_on_groups: dishRecord.add_on_groups
          })
          .select()
          .single();

        if (!error && data) {
          const normalized = this.normalizeDish(data);
          this._syncToMemory(normalized);
          return normalized;
        }
        if (error) {
          console.error('⚠️ [RestaurantCatalogRepository] PostgreSQL insert error:', error.message || error);
          if (process.env.NODE_ENV === 'production') {
            const dbErr = new Error(`DATABASE_WRITE_FAILED: ${error.message || 'PostgreSQL insert failed'}`);
            dbErr.code = 'DATABASE_WRITE_FAILED';
            dbErr.statusCode = 500;
            throw dbErr;
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('⚠️ [RestaurantCatalogRepository] PostgreSQL insert unavailable, falling back to local memory:', err.message || err);
      }
    }

    // Save to Memory
    this._syncToMemory(dishRecord);
    return this.normalizeDish(dishRecord);
  }

  /**
   * Update an existing dish
   */
  async updateDish(merchantId, dishId, updateData) {
    const existing = await this.getDishById(merchantId, dishId);
    if (!existing) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const updates = {};
    if (updateData.name !== undefined) {
      const name = String(updateData.name).trim();
      if (!name) {
        const err = new Error('Dish name cannot be empty');
        err.code = 'INVALID_DISH_NAME';
        err.statusCode = 400;
        throw err;
      }
      updates.name = name;
    }

    if (updateData.price !== undefined) {
      const price = Number(updateData.price);
      if (isNaN(price) || price < 0) {
        const err = new Error('Price must be a non-negative number');
        err.code = 'INVALID_PRICE';
        err.statusCode = 400;
        throw err;
      }
      updates.price = price;
    }

    if (updateData.discountPrice !== undefined || updateData.discount_price !== undefined) {
      const dp = updateData.discountPrice !== undefined ? updateData.discountPrice : updateData.discount_price;
      updates.discount_price = dp === null ? null : Math.max(0, Number(dp));
    }

    if (updateData.description !== undefined) {
      updates.description = updateData.description ? String(updateData.description).trim() : null;
    }

    if (updateData.category !== undefined) {
      const category = String(updateData.category).trim();
      if (!category) {
        const err = new Error('Category cannot be empty');
        err.code = 'INVALID_CATEGORY';
        err.statusCode = 400;
        throw err;
      }
      updates.category = category;
    }

    if (updateData.dietaryType !== undefined || updateData.dietary_type !== undefined) {
      const dt = String(updateData.dietaryType || updateData.dietary_type).toUpperCase();
      if (!VALID_DIETARY_TYPES.includes(dt)) {
        const err = new Error(`Invalid dietary type. Must be one of: ${VALID_DIETARY_TYPES.join(', ')}`);
        err.code = 'INVALID_DIETARY_TYPE';
        err.statusCode = 400;
        throw err;
      }
      updates.dietary_type = dt;
      updates.is_veg = dt === 'VEG' || dt === 'VEGAN';
    }

    if (updateData.prepTimeMinutes !== undefined || updateData.prep_time_minutes !== undefined) {
      const pt = Number(updateData.prepTimeMinutes ?? updateData.prep_time_minutes);
      if (isNaN(pt) || pt < 0) {
        const err = new Error('Prep time must be a non-negative number');
        err.code = 'INVALID_PREP_TIME';
        err.statusCode = 400;
        throw err;
      }
      updates.prep_time_minutes = pt;
    }

    if (updateData.isAvailable !== undefined || updateData.is_available !== undefined) {
      updates.is_available = (updateData.isAvailable ?? updateData.is_available) === true;
    }

    if (updateData.variants !== undefined && Array.isArray(updateData.variants)) {
      updates.variants = updateData.variants.map((v, i) => {
        const vName = String(v.name || '').trim();
        if (!vName) {
          const err = new Error(`Variant at index ${i} must have a name`);
          err.code = 'INVALID_VARIANT_NAME';
          err.statusCode = 400;
          throw err;
        }
        const vPrice = Number(v.price);
        if (isNaN(vPrice) || vPrice < 0) {
          const err = new Error(`Variant '${vName}' price must be non-negative`);
          err.code = 'INVALID_VARIANT_PRICE';
          err.statusCode = 400;
          throw err;
        }
        return {
          id: v.id && UUID_REGEX.test(v.id) ? v.id : crypto.randomUUID(),
          name: vName,
          price: vPrice,
          isAvailable: v.isAvailable !== false,
          isDefault: Boolean(v.isDefault),
          sku: v.sku || null
        };
      });
    }

    if (updateData.addOnGroups !== undefined || updateData.add_on_groups !== undefined) {
      const groups = updateData.addOnGroups || updateData.add_on_groups;
      if (Array.isArray(groups)) {
        updates.add_on_groups = groups.map((g, i) => {
          const gName = String(g.name || '').trim();
          if (!gName) {
            const err = new Error(`Add-on group at index ${i} must have a name`);
            err.code = 'INVALID_ADDON_GROUP_NAME';
            err.statusCode = 400;
            throw err;
          }
          const options = (g.options || []).map((o, j) => {
            const oName = String(o.name || '').trim();
            if (!oName) {
              const err = new Error(`Option at index ${j} in group '${gName}' must have a name`);
              err.code = 'INVALID_ADDON_OPTION_NAME';
              err.statusCode = 400;
              throw err;
            }
            const oPrice = Number(o.price);
            if (isNaN(oPrice) || oPrice < 0) {
              const err = new Error(`Option '${oName}' price must be non-negative`);
              err.code = 'INVALID_ADDON_OPTION_PRICE';
              err.statusCode = 400;
              throw err;
            }
            return {
              id: o.id && UUID_REGEX.test(o.id) ? o.id : crypto.randomUUID(),
              name: oName,
              price: oPrice,
              isAvailable: o.isAvailable !== false,
              isDefault: Boolean(o.isDefault)
            };
          });

          const isReq = Boolean(g.isRequired);
          const minSel = Math.max(0, Number(g.minSelections ?? (isReq ? 1 : 0)));
          const maxSel = Number(g.maxSelections ?? Math.max(1, options.length));
          if (minSel > maxSel) {
            const err = new Error(`Group '${gName}': minSelections (${minSel}) cannot exceed maxSelections (${maxSel})`);
            err.code = 'INVALID_SELECTION_BOUNDS';
            err.statusCode = 400;
            throw err;
          }

          return {
            id: g.id && UUID_REGEX.test(g.id) ? g.id : crypto.randomUUID(),
            name: gName,
            isRequired: isReq || minSel > 0,
            minSelections: minSel,
            maxSelections: maxSel,
            allowMultiple: Boolean(g.allowMultiple),
            options
          };
        });
      }
    }

    if (updateData.photos !== undefined && Array.isArray(updateData.photos)) {
      updates.photos = updateData.photos.map((p, idx) => ({
        id: p.id || crypto.randomUUID(),
        url: p.url || p.secure_url || p.imageUrl,
        isPrimary: Boolean(p.isPrimary || idx === 0),
        sortOrder: Number(p.sortOrder ?? idx)
      }));
      const primary = updates.photos.find(p => p.isPrimary)?.url || updates.photos[0]?.url;
      if (primary) updates.image_url = primary;
    }

    updates.updated_at = new Date().toISOString();

    // Live Supabase update if available
    if (isLivePostgres && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('products')
          .update(updates)
          .eq('id', existing.id)
          .select()
          .single();

        if (!error && data) {
          const normalized = this.normalizeDish(data);
          this._syncToMemory(normalized);
          return normalized;
        }
        if (error) {
          console.error('⚠️ [RestaurantCatalogRepository] PostgreSQL update error:', error.message || error);
          if (process.env.NODE_ENV === 'production') {
            const dbErr = new Error(`DATABASE_WRITE_FAILED: ${error.message || 'PostgreSQL update failed'}`);
            dbErr.code = 'DATABASE_WRITE_FAILED';
            dbErr.statusCode = 500;
            throw dbErr;
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('⚠️ [RestaurantCatalogRepository] PostgreSQL update unavailable, falling back to local memory:', err.message || err);
      }
    }

    // Update memory copy
    const merged = { ...existing, ...updates };
    this._syncToMemory(merged);
    return this.normalizeDish(merged);
  }

  /**
   * Safe Archival of a dish (soft delete)
   */
  async archiveDish(merchantId, dishId) {
    const existing = await this.getDishById(merchantId, dishId);
    if (!existing) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const updates = {
      is_archived: true,
      is_available: false,
      updated_at: new Date().toISOString()
    };

    if (isLivePostgres && supabaseAdmin) {
      try {
        const { error } = await supabaseAdmin.from('products').update(updates).eq('id', existing.id);
        if (error) {
          console.error('⚠️ [RestaurantCatalogRepository] PostgreSQL archive error:', error.message || error);
          if (process.env.NODE_ENV === 'production') {
            const dbErr = new Error(`DATABASE_WRITE_FAILED: ${error.message || 'PostgreSQL archive failed'}`);
            dbErr.code = 'DATABASE_WRITE_FAILED';
            dbErr.statusCode = 500;
            throw dbErr;
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('⚠️ [RestaurantCatalogRepository] PostgreSQL archive unavailable, falling back to local memory:', err.message || err);
      }
    }

    const merged = { ...existing, ...updates, isArchived: true, isAvailable: false };
    this._syncToMemory(merged);
    return this.normalizeDish(merged);
  }

  /**
   * Toggle Availability of a dish
   */
  async toggleAvailability(merchantId, dishId, isAvailable) {
    const existing = await this.getDishById(merchantId, dishId);
    if (!existing) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const newAvail = isAvailable !== undefined ? Boolean(isAvailable) : !existing.isAvailable;
    const updates = {
      is_available: newAvail,
      updated_at: new Date().toISOString()
    };

    if (isLivePostgres && supabaseAdmin) {
      try {
        const { error } = await supabaseAdmin.from('products').update(updates).eq('id', existing.id);
        if (error) {
          console.error('⚠️ [RestaurantCatalogRepository] PostgreSQL availability update error:', error.message || error);
          if (process.env.NODE_ENV === 'production') {
            const dbErr = new Error(`DATABASE_WRITE_FAILED: ${error.message || 'PostgreSQL availability update failed'}`);
            dbErr.code = 'DATABASE_WRITE_FAILED';
            dbErr.statusCode = 500;
            throw dbErr;
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV === 'production') throw err;
        console.warn('⚠️ [RestaurantCatalogRepository] PostgreSQL availability update unavailable, falling back to local memory:', err.message || err);
      }
    }

    const merged = { ...existing, ...updates, isAvailable: newAvail };
    this._syncToMemory(merged);
    return this.normalizeDish(merged);
  }

  /**
   * Variant Operations
   */
  async addVariant(merchantId, dishId, variantData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const vName = String(variantData.name || '').trim();
    if (!vName) {
      const err = new Error('Variant name is required');
      err.code = 'INVALID_VARIANT_NAME';
      err.statusCode = 400;
      throw err;
    }

    const vPrice = Number(variantData.price);
    if (isNaN(vPrice) || vPrice < 0) {
      const err = new Error('Variant price must be non-negative');
      err.code = 'INVALID_VARIANT_PRICE';
      err.statusCode = 400;
      throw err;
    }

    const newVariant = {
      id: variantData.id && UUID_REGEX.test(variantData.id) ? variantData.id : crypto.randomUUID(),
      name: vName,
      price: vPrice,
      isAvailable: variantData.isAvailable !== false,
      isDefault: Boolean(variantData.isDefault),
      sku: variantData.sku || null
    };

    const currentVariants = dish.variants || [];
    if (newVariant.isDefault) {
      currentVariants.forEach(v => { v.isDefault = false; });
    }
    const updatedVariants = [...currentVariants, newVariant];

    await this.updateDish(merchantId, dishId, { variants: updatedVariants });
    return newVariant;
  }

  async updateVariant(merchantId, dishId, variantId, variantData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const variants = [...(dish.variants || [])];
    const index = variants.findIndex(v => v.id === variantId);
    if (index === -1) {
      const err = new Error(`Variant [${variantId}] not found on dish [${dishId}].`);
      err.code = 'VARIANT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const target = { ...variants[index] };
    if (variantData.name !== undefined) {
      const name = String(variantData.name).trim();
      if (!name) {
        const err = new Error('Variant name cannot be empty');
        err.code = 'INVALID_VARIANT_NAME';
        err.statusCode = 400;
        throw err;
      }
      target.name = name;
    }

    if (variantData.price !== undefined) {
      const price = Number(variantData.price);
      if (isNaN(price) || price < 0) {
        const err = new Error('Variant price must be non-negative');
        err.code = 'INVALID_VARIANT_PRICE';
        err.statusCode = 400;
        throw err;
      }
      target.price = price;
    }

    if (variantData.isAvailable !== undefined) {
      target.isAvailable = Boolean(variantData.isAvailable);
    }

    if (variantData.isDefault !== undefined) {
      const isDef = Boolean(variantData.isDefault);
      target.isDefault = isDef;
      if (isDef) {
        variants.forEach((v, idx) => { if (idx !== index) v.isDefault = false; });
      }
    }

    variants[index] = target;
    await this.updateDish(merchantId, dishId, { variants });
    return target;
  }

  async deleteVariant(merchantId, dishId, variantId) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const filtered = (dish.variants || []).filter(v => v.id !== variantId);
    if (filtered.length === (dish.variants || []).length) {
      const err = new Error(`Variant [${variantId}] not found on dish [${dishId}].`);
      err.code = 'VARIANT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    await this.updateDish(merchantId, dishId, { variants: filtered });
    return { success: true, deletedVariantId: variantId };
  }

  /**
   * Add-on Group Operations
   */
  async addAddOnGroup(merchantId, dishId, groupData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const gName = String(groupData.name || '').trim();
    if (!gName) {
      const err = new Error('Add-on group name is required');
      err.code = 'INVALID_ADDON_GROUP_NAME';
      err.statusCode = 400;
      throw err;
    }

    const options = (groupData.options || []).map((o, idx) => {
      const oName = String(o.name || '').trim();
      if (!oName) {
        const err = new Error(`Option at index ${idx} must have a name`);
        err.code = 'INVALID_ADDON_OPTION_NAME';
        err.statusCode = 400;
        throw err;
      }
      const oPrice = Number(o.price);
      if (isNaN(oPrice) || oPrice < 0) {
        const err = new Error(`Option '${oName}' price must be non-negative`);
        err.code = 'INVALID_ADDON_OPTION_PRICE';
        err.statusCode = 400;
        throw err;
      }
      return {
        id: o.id && UUID_REGEX.test(o.id) ? o.id : crypto.randomUUID(),
        name: oName,
        price: oPrice,
        isAvailable: o.isAvailable !== false,
        isDefault: Boolean(o.isDefault)
      };
    });

    const isReq = Boolean(groupData.isRequired);
    const minSel = Math.max(0, Number(groupData.minSelections ?? (isReq ? 1 : 0)));
    const maxSel = Number(groupData.maxSelections ?? Math.max(1, options.length));
    if (minSel > maxSel) {
      const err = new Error(`Group '${gName}': minSelections (${minSel}) cannot exceed maxSelections (${maxSel})`);
      err.code = 'INVALID_SELECTION_BOUNDS';
      err.statusCode = 400;
      throw err;
    }

    const newGroup = {
      id: groupData.id && UUID_REGEX.test(groupData.id) ? groupData.id : crypto.randomUUID(),
      name: gName,
      isRequired: isReq || minSel > 0,
      minSelections: minSel,
      maxSelections: maxSel,
      allowMultiple: Boolean(groupData.allowMultiple),
      options
    };

    const updatedGroups = [...(dish.addOnGroups || []), newGroup];
    await this.updateDish(merchantId, dishId, { addOnGroups: updatedGroups });
    return newGroup;
  }

  async updateAddOnGroup(merchantId, dishId, groupId, groupData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const groups = [...(dish.addOnGroups || [])];
    const index = groups.findIndex(g => g.id === groupId);
    if (index === -1) {
      const err = new Error(`Add-on group [${groupId}] not found on dish [${dishId}].`);
      err.code = 'ADDON_GROUP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const target = { ...groups[index] };
    if (groupData.name !== undefined) {
      const name = String(groupData.name).trim();
      if (!name) {
        const err = new Error('Group name cannot be empty');
        err.code = 'INVALID_ADDON_GROUP_NAME';
        err.statusCode = 400;
        throw err;
      }
      target.name = name;
    }

    if (groupData.isRequired !== undefined) target.isRequired = Boolean(groupData.isRequired);
    if (groupData.minSelections !== undefined) target.minSelections = Math.max(0, Number(groupData.minSelections));
    if (groupData.maxSelections !== undefined) target.maxSelections = Math.max(1, Number(groupData.maxSelections));
    if (groupData.allowMultiple !== undefined) target.allowMultiple = Boolean(groupData.allowMultiple);

    if (target.minSelections > target.maxSelections) {
      const err = new Error(`minSelections (${target.minSelections}) cannot exceed maxSelections (${target.maxSelections})`);
      err.code = 'INVALID_SELECTION_BOUNDS';
      err.statusCode = 400;
      throw err;
    }

    groups[index] = target;
    await this.updateDish(merchantId, dishId, { addOnGroups: groups });
    return target;
  }

  async deleteAddOnGroup(merchantId, dishId, groupId) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const filtered = (dish.addOnGroups || []).filter(g => g.id !== groupId);
    if (filtered.length === (dish.addOnGroups || []).length) {
      const err = new Error(`Add-on group [${groupId}] not found on dish [${dishId}].`);
      err.code = 'ADDON_GROUP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    await this.updateDish(merchantId, dishId, { addOnGroups: filtered });
    return { success: true, deletedGroupId: groupId };
  }

  async addAddOnOption(merchantId, dishId, groupId, optionData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const groups = [...(dish.addOnGroups || [])];
    const group = groups.find(g => g.id === groupId);
    if (!group) {
      const err = new Error(`Add-on group [${groupId}] not found.`);
      err.code = 'ADDON_GROUP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const oName = String(optionData.name || '').trim();
    if (!oName) {
      const err = new Error('Option name is required');
      err.code = 'INVALID_ADDON_OPTION_NAME';
      err.statusCode = 400;
      throw err;
    }

    const oPrice = Number(optionData.price);
    if (isNaN(oPrice) || oPrice < 0) {
      const err = new Error('Option price must be non-negative');
      err.code = 'INVALID_ADDON_OPTION_PRICE';
      err.statusCode = 400;
      throw err;
    }

    const newOption = {
      id: optionData.id && UUID_REGEX.test(optionData.id) ? optionData.id : crypto.randomUUID(),
      name: oName,
      price: oPrice,
      isAvailable: optionData.isAvailable !== false,
      isDefault: Boolean(optionData.isDefault)
    };

    group.options = [...(group.options || []), newOption];
    await this.updateDish(merchantId, dishId, { addOnGroups: groups });
    return newOption;
  }

  async updateAddOnOption(merchantId, dishId, groupId, optionId, optionData) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const groups = [...(dish.addOnGroups || [])];
    const group = groups.find(g => g.id === groupId);
    if (!group) {
      const err = new Error(`Add-on group [${groupId}] not found.`);
      err.code = 'ADDON_GROUP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const options = [...(group.options || [])];
    const index = options.findIndex(o => o.id === optionId);
    if (index === -1) {
      const err = new Error(`Add-on option [${optionId}] not found in group [${groupId}].`);
      err.code = 'ADDON_OPTION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const target = { ...options[index] };
    if (optionData.name !== undefined) {
      const name = String(optionData.name).trim();
      if (!name) {
        const err = new Error('Option name cannot be empty');
        err.code = 'INVALID_ADDON_OPTION_NAME';
        err.statusCode = 400;
        throw err;
      }
      target.name = name;
    }

    if (optionData.price !== undefined) {
      const price = Number(optionData.price);
      if (isNaN(price) || price < 0) {
        const err = new Error('Option price must be non-negative');
        err.code = 'INVALID_ADDON_OPTION_PRICE';
        err.statusCode = 400;
        throw err;
      }
      target.price = price;
    }

    if (optionData.isAvailable !== undefined) target.isAvailable = Boolean(optionData.isAvailable);
    if (optionData.isDefault !== undefined) target.isDefault = Boolean(optionData.isDefault);

    options[index] = target;
    group.options = options;
    await this.updateDish(merchantId, dishId, { addOnGroups: groups });
    return target;
  }

  async deleteAddOnOption(merchantId, dishId, groupId, optionId) {
    const dish = await this.getDishById(merchantId, dishId);
    if (!dish) {
      const err = new Error(`Dish [${dishId}] not found.`);
      err.code = 'DISH_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const groups = [...(dish.addOnGroups || [])];
    const group = groups.find(g => g.id === groupId);
    if (!group) {
      const err = new Error(`Add-on group [${groupId}] not found.`);
      err.code = 'ADDON_GROUP_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    const filtered = (group.options || []).filter(o => o.id !== optionId);
    if (filtered.length === (group.options || []).length) {
      const err = new Error(`Option [${optionId}] not found in group [${groupId}].`);
      err.code = 'ADDON_OPTION_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }

    group.options = filtered;
    await this.updateDish(merchantId, dishId, { addOnGroups: groups });
    return { success: true, deletedOptionId: optionId };
  }

  _syncToMemory(dish) {
    if (!this.db || !this.db.restaurantCatalog) return;
    const index = this.db.restaurantCatalog.findIndex(d => d.id === dish.id || (d.sku && d.sku === dish.sku));
    if (index >= 0) {
      this.db.restaurantCatalog[index] = { ...this.db.restaurantCatalog[index], ...dish };
    } else {
      this.db.restaurantCatalog.push(dish);
    }

    // Also sync to legacy `db.restaurants.menu` if restaurant exists
    if (this.db.restaurants) {
      const rest = this.db.restaurants.find(r => r.id === dish.merchantId || r.uuid === dish.merchantId);
      if (rest) {
        if (!Array.isArray(rest.menu)) rest.menu = [];
        const menuIdx = rest.menu.findIndex(m => m.id === dish.id || m.id === dish.sku);
        const menuItem = {
          id: dish.id,
          sku: dish.sku,
          name: dish.name,
          description: dish.description,
          category: dish.category,
          price: dish.price,
          isVeg: dish.isVeg,
          inStock: dish.isAvailable,
          imageUrl: dish.imageUrl,
          variants: dish.variants,
          addOnGroups: dish.addOnGroups,
          photos: dish.photos
        };
        if (menuIdx >= 0) {
          rest.menu[menuIdx] = menuItem;
        } else {
          rest.menu.push(menuItem);
        }
      }
    }
    if (typeof this.db.save === 'function') {
      try { this.db.save(); } catch (e) {}
    }
  }
}

module.exports = RestaurantCatalogRepository;
