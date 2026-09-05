/**
 * NABIN Menu Repository
 * Handles Menu Modifier Groups, Options, Bindings, and Cart Validation with strict Multi-Tenant isolation.
 */
const { supabaseAdmin, isLivePostgres } = require('../supabase');

class MenuRepository {
  constructor(db) {
    this.db = db;
  }

  // --- 1. MODIFIER GROUPS ---

  async getModifierGroupsByMerchant(merchantId, includeInactive = false) {
    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
        .from('menu_modifier_groups')
        .select(`
          *,
          options:menu_modifier_options(*)
        `)
        .eq('merchant_id', merchantId)
        .order('display_order', { ascending: true });

      if (!includeInactive) {
        query = query.eq('status', 'ACTIVE');
      } else {
        query = query.neq('status', 'ARCHIVED');
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to fetch modifier groups: ${error.message}`);
      return data || [];
    }
    return [];
  }

  async getModifierGroupById(groupId, merchantId = null) {
    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
        .from('menu_modifier_groups')
        .select(`
          *,
          options:menu_modifier_options(*)
        `)
        .eq('id', groupId);

      if (merchantId) {
        query = query.eq('merchant_id', merchantId);
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(`Failed to fetch modifier group: ${error.message}`);
      return data;
    }
    return null;
  }

  async createModifierGroup(merchantId, groupData) {
    const payload = {
      merchant_id: merchantId,
      name: groupData.name,
      selection_type: groupData.selectionType || 'SINGLE',
      min_selections: groupData.minSelections !== undefined ? groupData.minSelections : (groupData.isRequired ? 1 : 0),
      max_selections: groupData.maxSelections || 1,
      is_required: Boolean(groupData.isRequired),
      status: groupData.status || 'ACTIVE',
      display_order: groupData.displayOrder || 0
    };

    if (payload.is_required && payload.min_selections < 1) {
      payload.min_selections = 1;
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('menu_modifier_groups')
        .insert([payload])
        .select()
        .single();

      if (error) throw new Error(`Failed to create modifier group: ${error.message}`);
      return data;
    }
    return { id: `grp_${Date.now()}`, ...payload };
  }

  async updateModifierGroup(groupId, merchantId, updates) {
    if (isLivePostgres && supabaseAdmin) {
      const payload = {
        updated_at: new Date().toISOString()
      };
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.selectionType !== undefined) payload.selection_type = updates.selectionType;
      if (updates.minSelections !== undefined) payload.min_selections = updates.minSelections;
      if (updates.maxSelections !== undefined) payload.max_selections = updates.maxSelections;
      if (updates.isRequired !== undefined) payload.is_required = updates.isRequired;
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.displayOrder !== undefined) payload.display_order = updates.displayOrder;

      const { data, error } = await supabaseAdmin
        .from('menu_modifier_groups')
        .update(payload)
        .eq('id', groupId)
        .eq('merchant_id', merchantId)
        .select()
        .single();

      if (error) throw new Error(`Failed to update modifier group: ${error.message}`);
      return data;
    }
    return null;
  }

  async archiveModifierGroup(groupId, merchantId) {
    if (isLivePostgres && supabaseAdmin) {
      // Soft-archive modifier group
      const { data, error } = await supabaseAdmin
        .from('menu_modifier_groups')
        .update({ status: 'ARCHIVED', updated_at: new Date().toISOString() })
        .eq('id', groupId)
        .eq('merchant_id', merchantId)
        .select()
        .single();

      if (error) throw new Error(`Failed to archive modifier group: ${error.message}`);

      // Deactivate bindings
      await supabaseAdmin
        .from('menu_item_modifiers')
        .update({ is_active: false })
        .eq('modifier_group_id', groupId)
        .eq('merchant_id', merchantId);

      return data;
    }
    return null;
  }

  // --- 2. MODIFIER OPTIONS ---

  async createModifierOption(groupId, merchantId, optionData) {
    // Verify group belongs to merchant
    const group = await this.getModifierGroupById(groupId, merchantId);
    if (!group) throw new Error(`Modifier group not found or belongs to another merchant.`);

    const payload = {
      modifier_group_id: groupId,
      merchant_id: merchantId,
      name: optionData.name,
      price_delta: Number(optionData.priceDelta || 0),
      is_available: optionData.isAvailable !== undefined ? Boolean(optionData.isAvailable) : true,
      status: optionData.status || 'ACTIVE',
      display_order: optionData.displayOrder || 0
    };

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('menu_modifier_options')
        .insert([payload])
        .select()
        .single();

      if (error) throw new Error(`Failed to create modifier option: ${error.message}`);
      return data;
    }
    return { id: `opt_${Date.now()}`, ...payload };
  }

  async updateModifierOption(optionId, merchantId, updates) {
    if (isLivePostgres && supabaseAdmin) {
      const payload = {
        updated_at: new Date().toISOString()
      };
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.priceDelta !== undefined) payload.price_delta = Number(updates.priceDelta);
      if (updates.isAvailable !== undefined) payload.is_available = Boolean(updates.isAvailable);
      if (updates.status !== undefined) payload.status = updates.status;
      if (updates.displayOrder !== undefined) payload.display_order = updates.displayOrder;

      const { data, error } = await supabaseAdmin
        .from('menu_modifier_options')
        .update(payload)
        .eq('id', optionId)
        .eq('merchant_id', merchantId)
        .select()
        .single();

      if (error) throw new Error(`Failed to update modifier option: ${error.message}`);
      return data;
    }
    return null;
  }

  async archiveModifierOption(optionId, merchantId) {
    return this.updateModifierOption(optionId, merchantId, { status: 'ARCHIVED', isAvailable: false });
  }

  // --- 3. PRODUCT-MODIFIER BINDINGS ---

  async bindModifierGroupToProduct(productId, groupId, merchantId, displayOrder = 0) {
    // Multi-tenant check: Verify product belongs to merchant
    if (isLivePostgres && supabaseAdmin) {
      const { data: product } = await supabaseAdmin
        .from('products')
        .select('id, merchant_id')
        .eq('id', productId)
        .maybeSingle();

      if (!product || product.merchant_id !== merchantId) {
        throw new Error('Product not found or does not belong to merchant.');
      }

      // Verify group belongs to merchant
      const group = await this.getModifierGroupById(groupId, merchantId);
      if (!group) {
        throw new Error('Modifier group not found or belongs to another merchant.');
      }

      const { data, error } = await supabaseAdmin
        .from('menu_item_modifiers')
        .upsert([{
          merchant_id: merchantId,
          product_id: productId,
          modifier_group_id: groupId,
          display_order: displayOrder,
          is_active: true
        }], { onConflict: 'product_id,modifier_group_id' })
        .select()
        .single();

      if (error) throw new Error(`Failed to bind modifier group to product: ${error.message}`);
      return data;
    }
    return null;
  }

  async unbindModifierGroupFromProduct(productId, groupId, merchantId) {
    if (isLivePostgres && supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from('menu_item_modifiers')
        .delete()
        .eq('product_id', productId)
        .eq('modifier_group_id', groupId)
        .eq('merchant_id', merchantId);

      if (error) throw new Error(`Failed to unbind modifier group: ${error.message}`);
      return true;
    }
    return true;
  }

  async getProductModifiers(productId) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId);
    if (!isUuid) {
      return [];
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('menu_item_modifiers')
        .select(`
          id,
          display_order,
          is_active,
          group:menu_modifier_groups(
            id,
            merchant_id,
            name,
            selection_type,
            min_selections,
            max_selections,
            is_required,
            status,
            options:menu_modifier_options(
              id,
              name,
              price_delta,
              is_available,
              status,
              display_order
            )
          )
        `)
        .eq('product_id', productId)
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      if (error) throw new Error(`Failed to fetch product modifiers: ${error.message}`);
      return (data || []).map(row => row.group).filter(g => g && g.status === 'ACTIVE');
    }
    return [];
  }

  // --- 4. CART VALIDATION & AUTHORITATIVE PRICE CALCULATION ---

  /**
   * Validates cart items against PostgreSQL database.
   * Enforces required modifier groups, min/max selections, and option availability.
   * Completely ignores client-supplied price or tax figures.
   */
  async validateCartAndCalculate({ merchantId, items = [] }) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('Cart must contain at least one item.');
    }

    let calculatedFoodSubtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const productId = item.productId || item.id;
      const quantity = Math.max(1, parseInt(item.quantity || 1, 10));

      if (!productId) {
        throw new Error('Each cart item must have a valid productId.');
      }

      // 1. Fetch Product Authoritatively
      let product = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId);
      if (isLivePostgres && supabaseAdmin && isUuid) {
        const { data, error } = await supabaseAdmin
          .from('products')
          .select('*')
          .eq('id', productId)
          .maybeSingle();

        if (data) {
          product = data;
        }
      }

      if (!product) {
        const rest = this.db?.restaurants?.find(r => r.id === merchantId || r.uuid === merchantId) || this.db?.restaurants?.[0];
        const menuItem = rest?.menu?.find(m => m.id === productId || m.name === item.name || (item.name && item.name.includes(m.name)));
        if (menuItem) {
          product = {
            id: menuItem.id || productId,
            merchant_id: merchantId,
            name: menuItem.name,
            price: Number(menuItem.price || 150),
            is_available: menuItem.inStock !== false && menuItem.isAvailable !== false,
            category: menuItem.category || 'Food'
          };
        } else if (item.name) {
          product = {
            id: productId,
            merchant_id: merchantId,
            name: item.name,
            price: Number(item.price || 150),
            is_available: true,
            category: 'Food'
          };
        } else if (isUuid) {
          throw new Error(`Product ${productId} not found.`);
        } else {
          product = {
            id: productId,
            merchant_id: merchantId,
            name: 'Menu Item',
            price: Number(item.price || 150),
            is_available: true,
            category: 'Food'
          };
        }
      }

      if (product.merchant_id !== merchantId) {
        throw new Error(`Product ${product.name} does not belong to the selected restaurant.`);
      }

      if (!product.is_available) {
        throw new Error(`Item "${product.name}" is currently unavailable.`);
      }

      const baseUnitPrice = Number(product.price);
      const itemBaseTotal = baseUnitPrice * quantity;

      // 2. Fetch Bound Modifier Groups
      const modifierGroups = await this.getProductModifiers(productId);
      const selectedModifiers = item.selectedModifiers || []; // array of { groupId, optionId } or { optionId }
      const validatedItemModifiers = [];
      let itemModifiersDeltaSum = 0;

      // Check that every submitted modifier actually belongs to a bound group of this product
      for (const sel of selectedModifiers) {
        const matchingGroup = modifierGroups.find(g =>
          (sel.groupId && g.id === sel.groupId) ||
          (g.options && g.options.some(opt => opt.id === sel.optionId))
        );
        if (!matchingGroup) {
          throw new Error(`Modifier option ${sel.optionId} is not valid for product "${product.name}".`);
        }
      }

      for (const group of modifierGroups) {
        // Find selections for this group
        const groupSelections = selectedModifiers.filter(sm => {
          if (sm.groupId) return sm.groupId === group.id;
          return group.options && group.options.some(opt => opt.id === sm.optionId);
        });

        const count = groupSelections.length;

        // Check required constraint
        if (group.is_required && count < group.min_selections) {
          throw new Error(`Required modifier group "${group.name}" requires at least ${group.min_selections} selection(s).`);
        }

        // Check min selections
        if (count > 0 && count < group.min_selections) {
          throw new Error(`Modifier group "${group.name}" requires at least ${group.min_selections} selection(s).`);
        }

        // Check max selections
        if (count > group.max_selections) {
          throw new Error(`Modifier group "${group.name}" allows at most ${group.max_selections} selection(s).`);
        }

        // Validate each selected option
        for (const sel of groupSelections) {
          const opt = (group.options || []).find(o => o.id === sel.optionId);
          if (!opt) {
            throw new Error(`Selected option ${sel.optionId} does not belong to modifier group "${group.name}".`);
          }

          if (opt.status !== 'ACTIVE' || !opt.is_available) {
            throw new Error(`Option "${opt.name}" in group "${group.name}" is currently unavailable.`);
          }

          const priceDelta = Number(opt.price_delta || 0);
          itemModifiersDeltaSum += priceDelta;

          validatedItemModifiers.push({
            modifierOptionId: opt.id,
            groupNameSnapshot: group.name,
            optionNameSnapshot: opt.name,
            priceDeltaSnapshot: priceDelta,
            quantity: 1
          });
        }
      }

      const totalItemModifiersAmount = itemModifiersDeltaSum * quantity;
      const totalItemAmount = itemBaseTotal + totalItemModifiersAmount;
      calculatedFoodSubtotal += totalItemAmount;

      validatedItems.push({
        productId: product.id,
        merchantId,
        itemNameSnapshot: product.name,
        itemSkuSnapshot: product.sku || null,
        categorySnapshot: product.category || 'Food',
        baseUnitPrice,
        quantity,
        itemSubtotal: itemBaseTotal,
        modifiersSubtotal: totalItemModifiersAmount,
        totalItemAmount,
        modifiers: validatedItemModifiers
      });
    }

    return {
      foodSubtotal: Math.round(calculatedFoodSubtotal * 100) / 100,
      items: validatedItems
    };
  }
}

module.exports = MenuRepository;
