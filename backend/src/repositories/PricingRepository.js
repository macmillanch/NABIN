const { supabaseAdmin, isLivePostgres } = require('../supabase');

/**
 * PricingRepository
 * PostgreSQL-authoritative repository for:
 *   - public.pricing_configurations (rate cards for 2W, 3W, 4W, PARCEL, FOOD, GLOBAL)
 *   - public.geo_fences (spatial operating boundaries, circles, polygons, surcharges)
 *   - public.surge_zones (dynamic surge rules, multipliers, priority, status)
 */
class PricingRepository {
  constructor(database) {
    this.db = database;
  }

  // =========================================================================
  // 1. DTO MAPPERS
  // =========================================================================

  mapPricingRowToDTO(row) {
    if (!row) return null;
    return {
      id: row.id,
      serviceType: row.service_type,
      name: row.name,
      baseFare: parseFloat(row.base_fare || 0),
      perKmRate: parseFloat(row.per_km_rate || 0),
      perMinRate: parseFloat(row.per_min_rate || 0),
      minFare: parseFloat(row.min_fare || 0),
      bookingFee: parseFloat(row.booking_fee || 0),
      commissionPercent: parseFloat(row.commission_percent || 0),
      globalSurgeMultiplier: parseFloat(row.global_surge_multiplier || 1.0),
      activeSurgeZone: row.active_surge_zone || 'NONE',
      updatedBy: row.updated_by,
      updatedAt: row.updated_at
    };
  }

  mapGeoFenceRowToDTO(row) {
    if (!row) return null;
    let coords = row.coordinates;
    if (typeof coords === 'string') {
      try { coords = JSON.parse(coords); } catch (_) {}
    }

    const centerLat = row.center_lat !== null && row.center_lat !== undefined ? parseFloat(row.center_lat) : (coords?.center?.lat ? parseFloat(coords.center.lat) : null);
    const centerLng = row.center_lng !== null && row.center_lng !== undefined ? parseFloat(row.center_lng) : (coords?.center?.lng ? parseFloat(coords.center.lng) : null);
    const radiusMeters = row.radius_meters || coords?.radiusMeters || 3500;

    return {
      id: row.id,
      name: row.zone_name,
      zoneName: row.zone_name,
      zoneCode: row.zone_code,
      code: row.zone_code,
      type: row.geometry_type,
      geometryType: row.geometry_type,
      category: row.category || 'GENERAL',
      coordinates: coords,
      center: (centerLat !== null && centerLng !== null) ? { lat: centerLat, lng: centerLng } : null,
      centerLat,
      centerLng,
      radiusMeters,
      surcharge: parseFloat(row.surcharge_amount || 0),
      surchargeAmount: parseFloat(row.surcharge_amount || 0),
      surgeMultiplier: parseFloat(row.surge_multiplier || 1.0),
      status: row.is_active ? 'ACTIVE' : 'INACTIVE',
      isActive: Boolean(row.is_active),
      allowedServices: row.allowed_services || ['RIDE', 'PARCEL', 'FOOD'],
      allowedVehicles: row.allowed_vehicles || ['2W', '3W', '4W'],
      operatingHours: row.operating_hours || '24x7 Open',
      description: row.description || '',
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  mapSurgeZoneRowToDTO(row) {
    if (!row) return null;
    return {
      id: row.id,
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      service: row.service || 'ALL',
      vehicleType: row.vehicle_type || 'ALL',
      surgeMultiplier: parseFloat(row.surge_multiplier || 1.0),
      maxMultiplier: parseFloat(row.max_multiplier || 3.0),
      startTime: row.start_time || null,
      endTime: row.end_time || null,
      priority: row.priority || 'NORMAL',
      status: row.status || 'ACTIVE',
      reason: row.reason || '',
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  // =========================================================================
  // 2. PRICING CONFIGURATION OPERATIONS
  // =========================================================================

  async getPricingMatrix() {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('pricing_configurations')
        .select('*');

      if (error) {
        throw new Error(`Failed to fetch pricing configurations from PostgreSQL: ${error.message}`);
      }

      if (data && data.length > 0) {
        const matrix = {};
        let globalSurge = 1.0;
        let activeZone = 'NONE';

        for (const row of data) {
          const dto = this.mapPricingRowToDTO(row);
          if (dto.id === 'GLOBAL') {
            globalSurge = dto.globalSurgeMultiplier;
            activeZone = dto.activeSurgeZone;
          } else {
            matrix[dto.id] = {
              name: dto.name,
              baseFare: dto.baseFare,
              perKmRate: dto.perKmRate,
              perMinRate: dto.perMinRate,
              minFare: dto.minFare,
              bookingFee: dto.bookingFee,
              commissionPercent: dto.commissionPercent
            };
          }
        }
        matrix.globalSurgeMultiplier = globalSurge;
        matrix.activeSurgeZone = activeZone;
        return matrix;
      }
    }

    // Non-live fallback
    return this.db ? this.db.pricingConfig : {};
  }

  async updatePricingConfig(payload, admin = {}) {
    const { globalSurgeMultiplier, activeSurgeZone, serviceType, baseFare, perKmRate, commissionPercent } = payload;
    const adminName = admin.name || admin.username || 'SUPER_ADMIN';

    if (isLivePostgres && supabaseAdmin) {
      // 1. Update global surge or active zone
      if (globalSurgeMultiplier !== undefined || activeSurgeZone !== undefined) {
        const updates = {
          updated_by: adminName,
          updated_at: new Date().toISOString()
        };
        if (globalSurgeMultiplier !== undefined) updates.global_surge_multiplier = Number(globalSurgeMultiplier);
        if (activeSurgeZone !== undefined) updates.active_surge_zone = activeSurgeZone;

        const { error: gErr } = await supabaseAdmin
          .from('pricing_configurations')
          .update(updates)
          .eq('id', 'GLOBAL');

        if (gErr) {
          throw new Error(`Failed to update global pricing configuration: ${gErr.message}`);
        }
      }

      // 2. Update service-specific configuration if provided
      if (serviceType) {
        const serviceUpdates = {
          updated_by: adminName,
          updated_at: new Date().toISOString()
        };
        if (baseFare !== undefined) serviceUpdates.base_fare = Number(baseFare);
        if (perKmRate !== undefined) serviceUpdates.per_km_rate = Number(perKmRate);
        if (commissionPercent !== undefined) serviceUpdates.commission_percent = Number(commissionPercent);

        const { error: sErr } = await supabaseAdmin
          .from('pricing_configurations')
          .update(serviceUpdates)
          .eq('id', serviceType);

        if (sErr) {
          throw new Error(`Failed to update service pricing configuration for ${serviceType}: ${sErr.message}`);
        }
      }
    }

    // Keep in-memory cache synchronized
    if (this.db && this.db.pricingConfig) {
      if (globalSurgeMultiplier !== undefined) this.db.pricingConfig.globalSurgeMultiplier = Number(globalSurgeMultiplier);
      if (activeSurgeZone !== undefined) this.db.pricingConfig.activeSurgeZone = activeSurgeZone;
      if (serviceType && this.db.pricingConfig[serviceType]) {
        if (baseFare !== undefined) this.db.pricingConfig[serviceType].baseFare = Number(baseFare);
        if (perKmRate !== undefined) this.db.pricingConfig[serviceType].perKmRate = Number(perKmRate);
        if (commissionPercent !== undefined) this.db.pricingConfig[serviceType].commissionPercent = Number(commissionPercent);
      }
    }

    return await this.getPricingMatrix();
  }

  // =========================================================================
  // 3. GEO-FENCES OPERATIONS
  // =========================================================================

  async listGeoFences(query = {}) {
    if (isLivePostgres && supabaseAdmin) {
      let q = supabaseAdmin.from('geo_fences').select('*').order('created_at', { ascending: false });
      if (query.activeOnly === true || query.status === 'ACTIVE') {
        q = q.eq('is_active', true);
      }
      const { data, error } = await q;
      if (error) {
        throw new Error(`Failed to list geofences from PostgreSQL: ${error.message}`);
      }
      return (data || []).map(r => this.mapGeoFenceRowToDTO(r));
    }

    // Non-live fallback
    return (this.db ? this.db.geoFences : []) || [];
  }

  async getGeoFenceById(id) {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('geo_fences')
        .select('*')
        .or(`id.eq.${id},zone_code.eq.${id}`)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to get geofence by id ${id}: ${error.message}`);
      }
      return this.mapGeoFenceRowToDTO(data);
    }

    return this.db?.geoFences?.find(g => g.id === id || g.code === id || g.zoneCode === id) || null;
  }

  async createGeoFence(payload, admin = {}) {
    const adminName = admin.name || admin.username || 'SUPER_ADMIN';
    const type = (payload.type || payload.geometryType || 'POLYGON').toUpperCase();
    const name = payload.name || payload.zoneName || 'New Operational Zone';

    // Generate unique zone code if not provided
    const baseCode = (payload.code || payload.zoneCode || ('ZONE_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_'))).slice(0, 32);
    const zoneCode = `${baseCode}_${Date.now().toString().slice(-4)}`;

    let centerLat = null;
    let centerLng = null;
    let radiusMeters = null;
    let coordinates = payload.coordinates || [];

    if (type === 'CIRCLE') {
      centerLat = payload.center?.lat !== undefined ? parseFloat(payload.center.lat) : (payload.centerLat !== undefined ? parseFloat(payload.centerLat) : 28.5562);
      centerLng = payload.center?.lng !== undefined ? parseFloat(payload.center.lng) : (payload.centerLng !== undefined ? parseFloat(payload.centerLng) : 77.1000);
      radiusMeters = payload.radiusMeters ? parseInt(payload.radiusMeters, 10) : 3500;
      if (!payload.coordinates || !Array.isArray(payload.coordinates)) {
        coordinates = { center: { lat: centerLat, lng: centerLng }, radiusMeters };
      }
    } else if (type === 'POLYGON') {
      if (!Array.isArray(coordinates) || coordinates.length < 3) {
        coordinates = [
          { lat: 28.6250, lng: 77.3600 },
          { lat: 28.6350, lng: 77.3750 },
          { lat: 28.6150, lng: 77.3750 }
        ];
      }
    }

    const surchargeAmount = Number(payload.surcharge !== undefined ? payload.surcharge : (payload.surchargeAmount || 0));
    const surgeMultiplier = Number(payload.surgeMultiplier || 1.0);
    const category = payload.category || 'HIGH_DEMAND';
    const allowedServices = payload.allowedServices || ['RIDE', 'PARCEL', 'FOOD'];
    const allowedVehicles = payload.allowedVehicles || ['2W', '3W', '4W'];
    const operatingHours = payload.operatingHours || '24x7 Open';
    const description = payload.description || '';

    let createdRecord = null;

    if (isLivePostgres && supabaseAdmin) {
      const rowToInsert = {
        zone_name: name,
        zone_code: zoneCode,
        geometry_type: type,
        coordinates,
        surcharge_amount: surchargeAmount,
        surge_multiplier: surgeMultiplier,
        is_active: payload.status !== 'INACTIVE' && payload.isActive !== false,
        category,
        center_lat: centerLat,
        center_lng: centerLng,
        radius_meters: radiusMeters,
        allowed_services: allowedServices,
        allowed_vehicles: allowedVehicles,
        operating_hours: operatingHours,
        description,
        created_by: adminName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabaseAdmin
        .from('geo_fences')
        .insert([rowToInsert])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create geofence in PostgreSQL: ${error.message}`);
      }

      createdRecord = this.mapGeoFenceRowToDTO(data);
    } else {
      // Non-live in-memory creation
      createdRecord = {
        id: `zone_${Date.now()}`,
        name,
        zoneName: name,
        zoneCode,
        code: zoneCode,
        type,
        geometryType: type,
        category,
        coordinates,
        center: (centerLat !== null && centerLng !== null) ? { lat: centerLat, lng: centerLng } : null,
        centerLat,
        centerLng,
        radiusMeters,
        surcharge: surchargeAmount,
        surchargeAmount,
        surgeMultiplier,
        status: 'ACTIVE',
        isActive: true,
        allowedServices,
        allowedVehicles,
        operatingHours,
        description,
        createdBy: adminName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }

    // Synchronize memory cache
    if (this.db && Array.isArray(this.db.geoFences)) {
      const existingIdx = this.db.geoFences.findIndex(g => g.id === createdRecord.id || g.code === createdRecord.code);
      if (existingIdx !== -1) {
        this.db.geoFences[existingIdx] = createdRecord;
      } else {
        this.db.geoFences.unshift(createdRecord);
      }
    }

    return createdRecord;
  }

  async deleteGeoFence(id, admin = {}) {
    let deleted = null;

    if (isLivePostgres && supabaseAdmin) {
      // Fetch before delete for return object and audit log
      const { data: existing, error: getErr } = await supabaseAdmin
        .from('geo_fences')
        .select('*')
        .or(`id.eq.${id},zone_code.eq.${id}`)
        .maybeSingle();

      if (getErr) {
        throw new Error(`Failed to find geofence ${id}: ${getErr.message}`);
      }

      if (!existing) {
        return null;
      }

      const { error: delErr } = await supabaseAdmin
        .from('geo_fences')
        .delete()
        .eq('id', existing.id);

      if (delErr) {
        throw new Error(`Failed to delete geofence from PostgreSQL: ${delErr.message}`);
      }

      deleted = this.mapGeoFenceRowToDTO(existing);
    } else if (this.db && Array.isArray(this.db.geoFences)) {
      const idx = this.db.geoFences.findIndex(g => g.id === id || g.code === id || g.zoneCode === id);
      if (idx !== -1) {
        deleted = this.db.geoFences.splice(idx, 1)[0];
      }
    }

    // Remove from in-memory cache if present
    if (deleted && this.db && Array.isArray(this.db.geoFences)) {
      const idx = this.db.geoFences.findIndex(g => g.id === deleted.id || g.code === deleted.code);
      if (idx !== -1) {
        this.db.geoFences.splice(idx, 1);
      }
    }

    return deleted;
  }

  // =========================================================================
  // 4. SURGE ZONES OPERATIONS
  // =========================================================================

  async listSurgeZones(query = {}) {
    if (isLivePostgres && supabaseAdmin) {
      let q = supabaseAdmin.from('surge_zones').select('*').order('created_at', { ascending: false });
      if (query.status) {
        q = q.eq('status', query.status);
      }
      const { data, error } = await q;
      if (error) {
        throw new Error(`Failed to list surge zones from PostgreSQL: ${error.message}`);
      }
      return (data || []).map(r => this.mapSurgeZoneRowToDTO(r));
    }

    return (this.db ? this.db.surgeZones : []) || [];
  }

  async createSurgeZone(payload, admin = {}) {
    const adminName = admin.name || admin.username || 'SUPER_ADMIN';
    const surgeMultiplier = Number(payload.surgeMultiplier || 1.25);
    const maxMultiplier = Number(payload.maxMultiplier || Math.max(3.0, surgeMultiplier));

    if (surgeMultiplier < 1.0) {
      throw new Error('surgeMultiplier must be >= 1.00');
    }
    if (surgeMultiplier > maxMultiplier) {
      throw new Error('surgeMultiplier cannot exceed maxMultiplier');
    }

    let resolvedZoneUuid = null;
    let zoneName = payload.zoneName || 'High Demand Zone';

    if (isLivePostgres && supabaseAdmin) {
      // Resolve zone_id foreign key if given slug or code
      if (payload.zoneId) {
        // Check if payload.zoneId is UUID
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.zoneId);
        if (isUuid) {
          resolvedZoneUuid = payload.zoneId;
        } else {
          // Look up in geo_fences table
          const { data: matchedFence } = await supabaseAdmin
            .from('geo_fences')
            .select('id, zone_name')
            .or(`zone_code.eq.${payload.zoneId},zone_name.ilike.%${payload.zoneId}%`)
            .maybeSingle();

          if (matchedFence) {
            resolvedZoneUuid = matchedFence.id;
            zoneName = matchedFence.zone_name;
          }
        }
      }

      // If still no zone UUID, fallback to first available geofence
      if (!resolvedZoneUuid) {
        const { data: anyFence } = await supabaseAdmin
          .from('geo_fences')
          .select('id, zone_name')
          .limit(1)
          .maybeSingle();
        if (anyFence) {
          resolvedZoneUuid = anyFence.id;
          if (!payload.zoneName) zoneName = anyFence.zone_name;
        }
      }

      const rowToInsert = {
        zone_id: resolvedZoneUuid,
        zone_name: zoneName,
        service: payload.service || 'RIDE',
        vehicle_type: payload.vehicleType || 'ALL',
        surge_multiplier: surgeMultiplier,
        max_multiplier: maxMultiplier,
        start_time: payload.startTime || '17:00',
        end_time: payload.endTime || '21:00',
        priority: payload.priority || 'HIGH',
        status: payload.status || 'ACTIVE',
        reason: payload.reason || 'Peak hour surge deployment',
        created_by: adminName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabaseAdmin
        .from('surge_zones')
        .insert([rowToInsert])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create surge zone in PostgreSQL: ${error.message}`);
      }

      const createdDTO = this.mapSurgeZoneRowToDTO(data);

      // Synchronize in-memory cache
      if (this.db && Array.isArray(this.db.surgeZones)) {
        this.db.surgeZones.unshift(createdDTO);
      }

      return createdDTO;
    } else {
      // Non-live in-memory fallback
      const surge = {
        id: `surge_${Date.now()}`,
        zoneId: payload.zoneId || 'zone_connaught',
        zoneName,
        service: payload.service || 'RIDE',
        vehicleType: payload.vehicleType || 'ALL',
        surgeMultiplier,
        maxMultiplier,
        startTime: payload.startTime || '17:00',
        endTime: payload.endTime || '21:00',
        priority: payload.priority || 'HIGH',
        status: 'ACTIVE',
        reason: payload.reason || 'Peak hour surge deployment',
        createdBy: adminName,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (this.db && Array.isArray(this.db.surgeZones)) {
        this.db.surgeZones.unshift(surge);
      }

      return surge;
    }
  }
}

module.exports = PricingRepository;
