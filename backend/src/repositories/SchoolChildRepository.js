const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class SchoolChildRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Resolve application user ID to PostgreSQL UUID
   */
  resolveOwnerUuid(userId) {
    if (!userId) return null;
    if (UUID_REGEX.test(userId)) return userId;
    if (this.db && this.db.userRepo && typeof this.db.userRepo.resolveUuid === 'function') {
      const resolved = this.db.userRepo.resolveUuid(userId);
      if (resolved) return resolved;
    }
    return null;
  }

  /**
   * Row mappers: PostgreSQL snake_case -> API camelCase
   */
  mapRowToSchool(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      address: row.address,
      latitude: parseFloat(row.latitude),
      longitude: parseFloat(row.longitude),
      photoUrl: row.photo_url || null,
      instructions: row.instructions || '',
      isFavorite: Boolean(row.is_favorite),
      generalTimingSummary: row.general_timing_summary || '8:30 AM – 2:30 PM • Mon–Fri',
      customDayTimings: row.custom_day_timings || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapRowToChild(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      fullName: row.full_name,
      photoUrl: row.photo_url || null,
      schoolId: row.school_id || null,
      schoolName: row.school_name || null,
      gradeClass: row.grade_class,
      section: row.section || '',
      guardianName: row.guardian_name,
      guardianPhone: row.guardian_phone,
      defaultPickupAddress: row.default_pickup_address,
      pickupLat: parseFloat(row.pickup_lat),
      pickupLng: parseFloat(row.pickup_lng),
      specialInstructions: row.special_instructions || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // =========================================================================
  // SCHOOLS DOMAIN
  // =========================================================================

  async getSchoolsByUser(userId) {
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return [];

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_schools')
        .select('*')
        .eq('user_id', ownerUuid)
        .order('is_favorite', { ascending: false })
        .order('name', { ascending: true });

      if (error) {
        throw new Error(`Database error fetching schools: ${error.message}`);
      }
      return (data || []).map(r => this.mapRowToSchool(r));
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedSchools)) {
      return this.db.savedSchools.filter(s => !s.userId || s.userId === userId || s.userId === ownerUuid);
    }
    return [];
  }

  async getSchoolById(schoolId, userId) {
    if (!schoolId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_schools')
        .select('*')
        .eq('id', schoolId)
        .eq('user_id', ownerUuid)
        .maybeSingle();

      if (error) {
        throw new Error(`Database error fetching school: ${error.message}`);
      }
      return data ? this.mapRowToSchool(data) : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedSchools)) {
      return this.db.savedSchools.find(s => s.id === schoolId && (!s.userId || s.userId === userId || s.userId === ownerUuid)) || null;
    }
    return null;
  }

  async createSchool(userId, payload) {
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) {
      const err = new Error('Unauthorized: Could not resolve owner account');
      err.statusCode = 401;
      throw err;
    }

    // Coordinate validation
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
      const err = new Error('Invalid latitude: must be a number between -90 and 90');
      err.statusCode = 400;
      throw err;
    }
    if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
      const err = new Error('Invalid longitude: must be a number between -180 and 180');
      err.statusCode = 400;
      throw err;
    }

    const schoolId = (payload.id && UUID_REGEX.test(payload.id)) ? payload.id : crypto.randomUUID();

    const row = {
      id: schoolId,
      user_id: ownerUuid,
      name: String(payload.name).trim(),
      address: String(payload.address).trim(),
      latitude: lat,
      longitude: lng,
      photo_url: payload.photoUrl || null,
      instructions: payload.instructions || null,
      is_favorite: Boolean(payload.isFavorite),
      general_timing_summary: payload.generalTimingSummary || '8:30 AM – 2:30 PM • Mon–Fri',
      custom_day_timings: Array.isArray(payload.customDayTimings) ? payload.customDayTimings : []
    };

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_schools')
        .insert(row)
        .select('*')
        .single();

      if (error) {
        throw new Error(`Database error creating school: ${error.message}`);
      }
      return this.mapRowToSchool(data);
    }

    // Offline dev fallback
    const newSchool = {
      ...payload,
      id: schoolId,
      userId: ownerUuid,
      latitude: lat,
      longitude: lng,
      isFavorite: Boolean(payload.isFavorite)
    };
    if (this.db && Array.isArray(this.db.savedSchools)) {
      this.db.savedSchools.push(newSchool);
      if (typeof this.db.save === 'function') this.db.save();
    }
    return newSchool;
  }

  async updateSchool(schoolId, userId, payload) {
    if (!schoolId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (payload.latitude !== undefined) {
      const lat = Number(payload.latitude);
      if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
        const err = new Error('Invalid latitude: must be a number between -90 and 90');
        err.statusCode = 400;
        throw err;
      }
    }
    if (payload.longitude !== undefined) {
      const lng = Number(payload.longitude);
      if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
        const err = new Error('Invalid longitude: must be a number between -180 and 180');
        err.statusCode = 400;
        throw err;
      }
    }

    if (isLivePostgres && supabaseAdmin) {
      const updates = { updated_at: new Date().toISOString() };
      if (payload.name !== undefined) updates.name = String(payload.name).trim();
      if (payload.address !== undefined) updates.address = String(payload.address).trim();
      if (payload.latitude !== undefined) updates.latitude = Number(payload.latitude);
      if (payload.longitude !== undefined) updates.longitude = Number(payload.longitude);
      if (payload.photoUrl !== undefined) updates.photo_url = payload.photoUrl || null;
      if (payload.instructions !== undefined) updates.instructions = payload.instructions || null;
      if (payload.isFavorite !== undefined) updates.is_favorite = Boolean(payload.isFavorite);
      if (payload.generalTimingSummary !== undefined) updates.general_timing_summary = payload.generalTimingSummary;
      if (payload.customDayTimings !== undefined) updates.custom_day_timings = Array.isArray(payload.customDayTimings) ? payload.customDayTimings : [];

      const { data, error } = await supabaseAdmin
        .from('saved_schools')
        .update(updates)
        .eq('id', schoolId)
        .eq('user_id', ownerUuid)
        .select('*')
        .maybeSingle();

      if (error) {
        throw new Error(`Database error updating school: ${error.message}`);
      }
      return data ? this.mapRowToSchool(data) : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedSchools)) {
      const idx = this.db.savedSchools.findIndex(s => s.id === schoolId && (!s.userId || s.userId === ownerUuid));
      if (idx !== -1) {
        this.db.savedSchools[idx] = { ...this.db.savedSchools[idx], ...payload };
        if (typeof this.db.save === 'function') this.db.save();
        return this.db.savedSchools[idx];
      }
    }
    return null;
  }

  async deleteSchool(schoolId, userId) {
    if (!schoolId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_schools')
        .delete()
        .eq('id', schoolId)
        .eq('user_id', ownerUuid)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new Error(`Database error deleting school: ${error.message}`);
      }
      return data ? { id: data.id } : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedSchools)) {
      const idx = this.db.savedSchools.findIndex(s => s.id === schoolId && (!s.userId || s.userId === ownerUuid));
      if (idx !== -1) {
        const removed = this.db.savedSchools.splice(idx, 1)[0];
        if (typeof this.db.save === 'function') this.db.save();
        return { id: removed.id };
      }
    }
    return null;
  }

  // =========================================================================
  // CHILDREN DOMAIN
  // =========================================================================

  async getChildrenByUser(userId) {
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return [];

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_children')
        .select('*')
        .eq('user_id', ownerUuid)
        .order('full_name', { ascending: true });

      if (error) {
        throw new Error(`Database error fetching children: ${error.message}`);
      }
      return (data || []).map(r => this.mapRowToChild(r));
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedChildren)) {
      return this.db.savedChildren.filter(c => !c.userId || c.userId === userId || c.userId === ownerUuid);
    }
    return [];
  }

  async getChildById(childId, userId) {
    if (!childId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_children')
        .select('*')
        .eq('id', childId)
        .eq('user_id', ownerUuid)
        .maybeSingle();

      if (error) {
        throw new Error(`Database error fetching child: ${error.message}`);
      }
      return data ? this.mapRowToChild(data) : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedChildren)) {
      return this.db.savedChildren.find(c => c.id === childId && (!c.userId || c.userId === userId || c.userId === ownerUuid)) || null;
    }
    return null;
  }

  async createChild(userId, payload) {
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) {
      const err = new Error('Unauthorized: Could not resolve owner account');
      err.statusCode = 401;
      throw err;
    }

    // Coordinate validation
    const lat = Number(payload.pickupLat);
    const lng = Number(payload.pickupLng);
    if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
      const err = new Error('Invalid pickup latitude: must be a number between -90 and 90');
      err.statusCode = 400;
      throw err;
    }
    if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
      const err = new Error('Invalid pickup longitude: must be a number between -180 and 180');
      err.statusCode = 400;
      throw err;
    }

    // School Ownership & Composite FK Pre-validation
    let validatedSchoolId = null;
    let resolvedSchoolName = payload.schoolName ? String(payload.schoolName).trim() : null;

    if (payload.schoolId) {
      const school = await this.getSchoolById(payload.schoolId, userId);
      if (!school) {
        const err = new Error('Invalid school_id: School does not exist or does not belong to you');
        err.statusCode = 400;
        throw err;
      }
      validatedSchoolId = school.id;
      resolvedSchoolName = school.name;
    }

    const childId = (payload.id && UUID_REGEX.test(payload.id)) ? payload.id : crypto.randomUUID();

    // Normalization check: explicitly DO NOT store schoolAddress, schoolLat, schoolLng
    const row = {
      id: childId,
      user_id: ownerUuid,
      full_name: String(payload.fullName).trim(),
      photo_url: payload.photoUrl || null,
      school_id: validatedSchoolId,
      school_name: resolvedSchoolName,
      grade_class: String(payload.gradeClass).trim(),
      section: payload.section ? String(payload.section).trim() : null,
      guardian_name: String(payload.guardianName).trim(),
      guardian_phone: String(payload.guardianPhone).trim(),
      default_pickup_address: String(payload.defaultPickupAddress).trim(),
      pickup_lat: lat,
      pickup_lng: lng,
      special_instructions: payload.specialInstructions ? String(payload.specialInstructions).trim() : null
    };

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_children')
        .insert(row)
        .select('*')
        .single();

      if (error) {
        throw new Error(`Database error creating child: ${error.message}`);
      }
      return this.mapRowToChild(data);
    }

    // Offline dev fallback
    const newChild = {
      id: childId,
      userId: ownerUuid,
      fullName: row.full_name,
      photoUrl: row.photo_url,
      schoolId: row.school_id,
      schoolName: row.school_name,
      gradeClass: row.grade_class,
      section: row.section,
      guardianName: row.guardian_name,
      guardianPhone: row.guardian_phone,
      defaultPickupAddress: row.default_pickup_address,
      pickupLat: lat,
      pickupLng: lng,
      specialInstructions: row.special_instructions
    };
    if (this.db && Array.isArray(this.db.savedChildren)) {
      this.db.savedChildren.push(newChild);
      if (typeof this.db.save === 'function') this.db.save();
    }
    return newChild;
  }

  async updateChild(childId, userId, payload) {
    if (!childId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (payload.pickupLat !== undefined) {
      const lat = Number(payload.pickupLat);
      if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
        const err = new Error('Invalid pickup latitude: must be a number between -90 and 90');
        err.statusCode = 400;
        throw err;
      }
    }
    if (payload.pickupLng !== undefined) {
      const lng = Number(payload.pickupLng);
      if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
        const err = new Error('Invalid pickup longitude: must be a number between -180 and 180');
        err.statusCode = 400;
        throw err;
      }
    }

    // Verify school if schoolId is being updated
    let validatedSchoolId = undefined;
    let resolvedSchoolName = undefined;
    if (payload.schoolId !== undefined) {
      if (payload.schoolId === null || payload.schoolId === '') {
        validatedSchoolId = null;
      } else {
        const school = await this.getSchoolById(payload.schoolId, userId);
        if (!school) {
          const err = new Error('Invalid school_id: School does not exist or does not belong to you');
          err.statusCode = 400;
          throw err;
        }
        validatedSchoolId = school.id;
        resolvedSchoolName = school.name;
      }
    }

    if (isLivePostgres && supabaseAdmin) {
      const updates = { updated_at: new Date().toISOString() };
      if (payload.fullName !== undefined) updates.full_name = String(payload.fullName).trim();
      if (payload.photoUrl !== undefined) updates.photo_url = payload.photoUrl || null;
      if (validatedSchoolId !== undefined) updates.school_id = validatedSchoolId;
      if (resolvedSchoolName !== undefined) updates.school_name = resolvedSchoolName;
      else if (payload.schoolName !== undefined && validatedSchoolId === undefined) updates.school_name = payload.schoolName;
      if (payload.gradeClass !== undefined) updates.grade_class = String(payload.gradeClass).trim();
      if (payload.section !== undefined) updates.section = payload.section ? String(payload.section).trim() : null;
      if (payload.guardianName !== undefined) updates.guardian_name = String(payload.guardianName).trim();
      if (payload.guardianPhone !== undefined) updates.guardian_phone = String(payload.guardianPhone).trim();
      if (payload.defaultPickupAddress !== undefined) updates.default_pickup_address = String(payload.defaultPickupAddress).trim();
      if (payload.pickupLat !== undefined) updates.pickup_lat = Number(payload.pickupLat);
      if (payload.pickupLng !== undefined) updates.pickup_lng = Number(payload.pickupLng);
      if (payload.specialInstructions !== undefined) updates.special_instructions = payload.specialInstructions ? String(payload.specialInstructions).trim() : null;

      const { data, error } = await supabaseAdmin
        .from('saved_children')
        .update(updates)
        .eq('id', childId)
        .eq('user_id', ownerUuid)
        .select('*')
        .maybeSingle();

      if (error) {
        throw new Error(`Database error updating child: ${error.message}`);
      }
      return data ? this.mapRowToChild(data) : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedChildren)) {
      const idx = this.db.savedChildren.findIndex(c => c.id === childId && (!c.userId || c.userId === ownerUuid));
      if (idx !== -1) {
        const existing = this.db.savedChildren[idx];
        const updated = { ...existing, ...payload };
        if (validatedSchoolId !== undefined) updated.schoolId = validatedSchoolId;
        if (resolvedSchoolName !== undefined) updated.schoolName = resolvedSchoolName;
        // Strip obsolete denormalized fields
        delete updated.schoolAddress;
        delete updated.schoolLat;
        delete updated.schoolLng;
        this.db.savedChildren[idx] = updated;
        if (typeof this.db.save === 'function') this.db.save();
        return updated;
      }
    }
    return null;
  }

  async deleteChild(childId, userId) {
    if (!childId) return null;
    const ownerUuid = this.resolveOwnerUuid(userId);
    if (!ownerUuid) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('saved_children')
        .delete()
        .eq('id', childId)
        .eq('user_id', ownerUuid)
        .select('id')
        .maybeSingle();

      if (error) {
        throw new Error(`Database error deleting child: ${error.message}`);
      }
      return data ? { id: data.id } : null;
    }

    // Offline dev fallback
    if (this.db && Array.isArray(this.db.savedChildren)) {
      const idx = this.db.savedChildren.findIndex(c => c.id === childId && (!c.userId || c.userId === ownerUuid));
      if (idx !== -1) {
        const removed = this.db.savedChildren.splice(idx, 1)[0];
        if (typeof this.db.save === 'function') this.db.save();
        return { id: removed.id };
      }
    }
    return null;
  }
}

module.exports = SchoolChildRepository;
