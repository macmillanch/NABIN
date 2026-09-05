const { supabaseAdmin, isLivePostgres } = require('../supabase');

const LEGACY_DRIVER_MAP = {
  'DRV-101': '00000000-0000-0000-0000-000000000101',
  'DRV-102': '00000000-0000-0000-0000-000000000102',
  'DRV-103': '00000000-0000-0000-0000-000000000103',
  'drv_1': '00000000-0000-0000-0000-000000000101',
  'drv_2': '00000000-0000-0000-0000-000000000102',
  'drv_3': '00000000-0000-0000-0000-000000000103'
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\s+/g, '');
}

function mapRowToDriver(row, legacyId = null) {
  if (!row) return null;
  return {
    id: legacyId || row.id,
    uuid: row.id,
    name: row.name,
    phone: row.phone,
    category: row.vehicle_type,
    categoryName: row.vehicle_type === '4W' ? 'Cab Comfort (4W)' : (row.vehicle_type === '3W' ? 'Auto Rickshaw (3W)' : 'Bike Taxi (2W)'),
    vehicle: row.vehicle_number,
    vehicleModel: row.vehicle_number,
    vehiclePlate: row.vehicle_number,
    dl: row.license_number,
    rating: parseFloat(row.rating || 5.0),
    status: row.kyc_status || 'PENDING',
    kycStatus: row.kyc_status || 'PENDING',
    userId: row.user_id || null,
    verifiedUpiId: row.verified_upi_id || null,
    pendingUpiId: row.pending_upi_id || null,
    payoutUpiVerified: Boolean(row.payout_upi_verified),
    payoutUpiVerifiedAt: row.payout_upi_verified_at || null,
    vpaVerificationMethod: row.vpa_verification_method || null,
    upiCoolingUntil: row.upi_cooling_until || null,
    kycVerifiedAt: row.kyc_verified_at || null,
    kycRejectedReason: row.kyc_rejected_reason || null,
    driverState: row.is_online ? 'ONLINE' : 'OFFLINE',
    isOnline: Boolean(row.is_online),
    operationalStatus: row.operational_status || 'AVAILABLE',
    todayTrips: 0,
    todayEarnings: 0.0,
    walletBalance: parseFloat(row.wallet_balance || 0.0),
    currentLocation: {
      lat: parseFloat(row.current_lat || 28.6139),
      lng: parseFloat(row.current_lng || 77.2090),
      area: 'Delhi Operations Zone'
    },
    activities: [],
    tripHistory: [],
    createdAt: row.created_at || new Date().toISOString()
  };
}

class DriverRepository {
  constructor(db) {
    this.db = db;
  }

  resolveUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (LEGACY_DRIVER_MAP[id]) return LEGACY_DRIVER_MAP[id];
    if (this.db.drivers) {
      const d = this.db.drivers.find(x => x.id === id);
      if (d && d.uuid) return d.uuid;
    }
    return null;
  }

  findById(id) {
    if (!id) return null;
    const targetUuid = this.resolveUuid(id);

    if (this.db.drivers) {
      const found = this.db.drivers.find(d => d.id === id || (targetUuid && (d.uuid === targetUuid || d.id === targetUuid)));
      if (found) return found;
    }
    return null;
  }

  async findByIdAsync(id) {
    if (!id) return null;
    const cached = this.findById(id);
    if (cached) return cached;

    if (isLivePostgres && supabaseAdmin) {
      const targetUuid = this.resolveUuid(id) || id;
      const { data, error } = await supabaseAdmin
        .from('drivers')
        .select('*')
        .eq(UUID_REGEX.test(targetUuid) ? 'id' : 'phone', targetUuid)
        .maybeSingle();

      if (!error && data) {
        const driver = mapRowToDriver(data, id);
        if (this.db.drivers) this.db.drivers.push(driver);
        return driver;
      }
    }
    return null;
  }

  findByPhone(phone) {
    if (!phone) return null;
    const clean = normalizePhone(phone);
    if (this.db.drivers) {
      const found = this.db.drivers.find(d => normalizePhone(d.phone) === clean);
      if (found) return found;
    }
    return null;
  }

  /**
   * Authoritative Driver Creation in PostgreSQL
   */
  async create(driverData) {
    // Valid vehicle types: '2W', '3W', '4W', 'AUTO', 'CAB'
    let vType = driverData.vehicleType || driverData.category || '4W';
    if (!['2W', '3W', '4W', 'AUTO', 'CAB'].includes(vType)) {
      vType = '4W';
    }

    const payload = {
      name: driverData.name,
      phone: driverData.phone,
      vehicle_type: vType,
      vehicle_number: driverData.vehicleNumber || driverData.vehiclePlate || 'DL 1RA 0000',
      license_number: driverData.licenseNumber || driverData.dl || null,
      rating: driverData.rating || 5.0,
      is_online: Boolean(driverData.isOnline),
      operational_status: driverData.operationalStatus || 'AVAILABLE',
      wallet_balance: driverData.walletBalance || 0.0,
      current_lat: driverData.currentLocation?.lat || 28.6139,
      current_lng: driverData.currentLocation?.lng || 77.2090,
      last_heartbeat: new Date().toISOString()
    };

    if (driverData.uuid && UUID_REGEX.test(driverData.uuid)) {
      payload.id = driverData.uuid;
    } else if (driverData.id && UUID_REGEX.test(driverData.id)) {
      payload.id = driverData.id;
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('drivers')
        .insert([payload])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create driver in PostgreSQL: ${error.message}`);
      }

      const createdDriver = mapRowToDriver(data, driverData.id && !UUID_REGEX.test(driverData.id) ? driverData.id : null);
      if (this.db.drivers) {
        this.db.drivers.unshift(createdDriver);
      }
      return createdDriver;
    }

    const fallbackDriver = {
      id: driverData.id || `DRV-${Date.now().toString().slice(-4)}`,
      uuid: payload.id || null,
      ...driverData,
      walletBalance: Number(driverData.walletBalance || 0),
      createdAt: new Date().toISOString()
    };
    if (this.db.drivers) this.db.drivers.unshift(fallbackDriver);
    return fallbackDriver;
  }

  /**
   * Authoritative Driver Update in PostgreSQL
   */
  async update(driverId, updateData) {
    let driver = this.findById(driverId);
    if (!driver) {
      driver = await this.findByIdAsync(driverId);
    }
    if (!driver) return null;

    const targetUuid = this.resolveUuid(driverId) || (driver && driver.uuid) || (UUID_REGEX.test(driverId) ? driverId : null);
    const dbUpdates = {};
    if (updateData.name !== undefined) dbUpdates.name = updateData.name;
    if (updateData.phone !== undefined) dbUpdates.phone = normalizePhone(updateData.phone);
    if (updateData.vehicleType !== undefined || updateData.vehicle_type !== undefined) {
      let vType = updateData.vehicleType || updateData.vehicle_type;
      if (!['2W', '3W', '4W', 'AUTO', 'CAB'].includes(vType)) {
        vType = vType.toLowerCase() === 'bike' ? '2W' : (vType.toLowerCase() === 'auto' ? '3W' : '4W');
      }
      dbUpdates.vehicle_type = vType;
    }
    if (updateData.vehicleNumber !== undefined || updateData.vehicle_number !== undefined) {
      dbUpdates.vehicle_number = updateData.vehicleNumber || updateData.vehicle_number;
    }
    if (updateData.isOnline !== undefined || updateData.is_online !== undefined) {
      dbUpdates.is_online = Boolean(updateData.isOnline !== undefined ? updateData.isOnline : updateData.is_online);
    }
    if (updateData.status !== undefined) {
      if (updateData.status === 'online') dbUpdates.is_online = true;
      else if (updateData.status === 'offline') dbUpdates.is_online = false;
    }
    if (updateData.operationalStatus !== undefined || updateData.operational_status !== undefined) {
      dbUpdates.operational_status = updateData.operationalStatus || updateData.operational_status;
    }
    dbUpdates.last_heartbeat = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('drivers')
        .update(dbUpdates)
        .eq('id', targetUuid);

      if (error) {
        throw new Error(`Failed to update driver in PostgreSQL: ${error.message}`);
      }
    }

    Object.assign(driver, updateData);
    if (dbUpdates.is_online !== undefined) {
      driver.isOnline = dbUpdates.is_online;
      driver.status = dbUpdates.is_online ? 'online' : 'offline';
      driver.driverState = dbUpdates.is_online ? 'ONLINE' : 'OFFLINE';
    }
    if (dbUpdates.operational_status) {
      driver.operationalStatus = dbUpdates.operational_status;
    }
    return driver;
  }

  /**
   * Authoritative Driver Online Status Update in PostgreSQL
   */
  async setOnlineStatus(driverId, isOnline) {
    return this.update(driverId, { isOnline: Boolean(isOnline), status: isOnline ? 'online' : 'offline' });
  }

  /**
   * Authoritative Driver Earnings Mutation via adjust_wallet_atomic RPC
   */
  async updateEarnings(driverId, earningAmount, tripId = null) {
    const driver = this.findById(driverId);
    if (!driver) return null;

    const targetUuid = this.resolveUuid(driverId);
    const numAmount = Number(earningAmount);

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const rpcResult = await this.db.ledgerRepo.adjustWallet({
        ownerId: targetUuid,
        ownerType: 'DRIVER',
        amount: numAmount,
        category: 'RIDE_SETTLEMENT',
        description: `Trip earnings settlement: ${tripId || 'TRIP'}`,
        referenceId: tripId || `drv_earn_${Date.now()}`,
        debitAccount: 'CUSTOMER_WALLET_LIABILITY',
        creditAccount: 'DRIVER_EARNINGS_PAYABLE'
      });

      if (rpcResult && rpcResult.balance !== undefined) {
        driver.walletBalance = Number(rpcResult.balance);
        driver.todayEarnings = Math.round(((driver.todayEarnings || 0) + numAmount) * 100) / 100;
        return driver;
      }
    }

    driver.walletBalance = Math.round(((driver.walletBalance || 0) + numAmount) * 100) / 100;
    driver.todayEarnings = Math.round(((driver.todayEarnings || 0) + numAmount) * 100) / 100;
    return driver;
  }

  /**
   * High-Frequency Fleet Telemetry Location Update
   */
  async updateLocation(driverId, latOrObj, maybeLng) {
    let driver = this.findById(driverId);
    if (!driver) {
      driver = await this.findByIdAsync(driverId);
    }
    if (!driver) return null;

    let lat = latOrObj;
    let lng = maybeLng;
    if (typeof latOrObj === 'object' && latOrObj !== null) {
      lat = latOrObj.lat !== undefined ? latOrObj.lat : latOrObj.latitude;
      lng = latOrObj.lng !== undefined ? latOrObj.lng : latOrObj.longitude;
    }

    driver.location = {
      lat: Number(lat),
      lng: Number(lng)
    };
    driver.currentLocation = {
      ...driver.currentLocation,
      lat: Number(lat),
      lng: Number(lng)
    };

    // Keep high-frequency fleet telemetry in memory store
    if (this.db.fleetLocations) {
      this.db.fleetLocations.set(driver.id, {
        driverId: driver.id,
        name: driver.name,
        phone: driver.phone,
        lat: Number(lat),
        lng: Number(lng),
        isOnline: driver.isOnline,
        status: driver.operationalStatus,
        updatedAt: new Date().toISOString()
      });
    }

    // Periodic / asynchronous heartbeat to PostgreSQL
    const targetUuid = this.resolveUuid(driverId) || (driver && driver.uuid) || (UUID_REGEX.test(driverId) ? driverId : null);
    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('drivers')
        .update({
          current_lat: Number(lat),
          current_lng: Number(lng),
          last_heartbeat: new Date().toISOString()
        })
        .eq('id', targetUuid);

      if (error) {
        console.warn('⚠️ Driver heartbeat sync notice:', error.message);
      }
    }

    return driver;
  }

  getOnlineFleet(serviceType = null) {
    if (!this.db.drivers) return [];
    return this.db.drivers.filter(d => d.isOnline && (!serviceType || d.category === serviceType || d.vehicleType === serviceType));
  }

  async updateDriverStatus(driverId, { operationalStatus, kycStatus, reason, adminId, adminName }) {
    let driver = this.findById(driverId);
    if (!driver) {
      driver = await this.findByIdAsync(driverId);
    }
    if (!driver) return { success: false, error: 'Driver not found' };

    const targetUuid = this.resolveUuid(driverId) || driver.uuid || (UUID_REGEX.test(driverId) ? driverId : null);
    const updates = {};
    if (operationalStatus) {
      const normOpStatus = (operationalStatus === 'ACTIVE' ? 'AVAILABLE' : operationalStatus).toUpperCase();
      updates.operational_status = normOpStatus;
      driver.operationalStatus = normOpStatus;
      if (normOpStatus === 'SUSPENDED') {
        driver.isOnline = false;
        updates.is_online = false;
      }
    }
    if (kycStatus) {
      const normalizedKyc = (kycStatus === 'APPROVED' ? 'VERIFIED' : kycStatus).toUpperCase();
      updates.kyc_status = normalizedKyc;
      driver.kycStatus = normalizedKyc;
      driver.status = normalizedKyc;
      if (normalizedKyc === 'VERIFIED') {
        updates.kyc_verified_at = new Date().toISOString();
        driver.kycVerifiedAt = updates.kyc_verified_at;
      } else if (normalizedKyc === 'REJECTED') {
        updates.kyc_rejected_reason = reason || 'Compliance rejection';
        driver.kycRejectedReason = updates.kyc_rejected_reason;
      }
    }
    if (reason) {
      driver.suspensionReason = reason;
    }

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('drivers')
        .update(updates)
        .eq('id', targetUuid);

      if (error) {
        return { success: false, error: error.message };
      }

      await this.db.createAuditLog({
        adminId: adminId || 'admin',
        adminName: adminName || 'Admin',
        role: 'ADMIN',
        action: kycStatus ? `DRIVER_KYC_${updates.kyc_status || kycStatus}` : (operationalStatus === 'SUSPENDED' ? 'DRIVER_SUSPENDED' : 'DRIVER_ACTIVATED'),
        module: 'DRIVER_FLEET',
        targetEntityType: 'DRIVER',
        targetEntityId: targetUuid,
        previousState: driver.operationalStatus,
        newState: operationalStatus || updates.kyc_status || kycStatus,
        reason: reason || `Driver status updated to ${operationalStatus || updates.kyc_status || kycStatus}`
      });
    }

    return { success: true, driver };
  }

  async requestPayoutDestination(driverId, upiId) {
    let driver = this.findById(driverId);
    if (!driver) {
      driver = await this.findByIdAsync(driverId);
    }
    if (!driver) return { success: false, error: 'Driver not found' };

    const targetUuid = this.resolveUuid(driverId) || driver.uuid || driverId;
    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { data: dbDriver } = await supabaseAdmin.from('drivers').select('*').eq('id', targetUuid).maybeSingle();
      if (dbDriver) {
        driver.kycStatus = dbDriver.kyc_status;
        driver.status = dbDriver.kyc_status;
        driver.userId = dbDriver.user_id;
        driver.user_id = dbDriver.user_id;
        driver.verifiedUpiId = dbDriver.verified_upi_id;
        driver.pendingUpiId = dbDriver.pending_upi_id;
        driver.payoutUpiVerified = dbDriver.payout_upi_verified;
        driver.upiCoolingUntil = dbDriver.upi_cooling_until;
      }
    }

    if (!driver.userId && !driver.user_id) {
      return { success: false, error: 'Unlinked driver profile cannot request payout destination.', code: 'UNLINKED_DRIVER_ACCOUNT' };
    }
    if (driver.kycStatus !== 'APPROVED' && driver.kycStatus !== 'VERIFIED' && driver.status !== 'APPROVED' && driver.status !== 'VERIFIED') {
      return { success: false, error: 'KYC must be verified before adding a payout destination.', code: 'KYC_NOT_VERIFIED' };
    }

    const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
    if (!upiId || !upiRegex.test(upiId.trim())) {
      return { success: false, error: 'Invalid UPI VPA format.', code: 'INVALID_UPI_FORMAT' };
    }

    const cleanUpi = upiId.trim();

    if (isLivePostgres && supabaseAdmin && targetUuid) {
      const { error } = await supabaseAdmin
        .from('drivers')
        .update({
          pending_upi_id: cleanUpi,
          payout_upi_verified: false
        })
        .eq('id', targetUuid);

      if (error) {
        return { success: false, error: error.message };
      }
    }

    driver.pendingUpiId = cleanUpi;
    driver.payoutUpiVerified = false;
    return { success: true, pendingUpiId: cleanUpi, status: 'PENDING_VERIFICATION' };
  }

  async verifyPayoutDestination(driverId, { decision, evidenceUrl, bankAccountHolderName, reason, adminId, adminName }) {
    let driver = this.findById(driverId);
    if (!driver) {
      driver = await this.findByIdAsync(driverId);
    }
    if (!driver) return { success: false, error: 'Driver not found' };

    const targetUuid = this.resolveUuid(driverId) || driver.uuid;
    const isApprove = decision === 'APPROVE';

    if (isApprove) {
      const vpaToVerify = driver.pendingUpiId || driver.verifiedUpiId;
      if (!vpaToVerify) {
        return { success: false, error: 'No pending or existing VPA to verify.', code: 'NO_VPA_PENDING' };
      }
      const coolingUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const verifiedAt = new Date().toISOString();

      if (isLivePostgres && supabaseAdmin && targetUuid) {
        const { error } = await supabaseAdmin
          .from('drivers')
          .update({
            verified_upi_id: vpaToVerify,
            pending_upi_id: null,
            payout_upi_verified: true,
            payout_upi_verified_at: verifiedAt,
            vpa_verification_method: 'ADMIN_MANUAL',
            upi_cooling_until: coolingUntil
          })
          .eq('id', targetUuid);

        if (error) return { success: false, error: error.message };

        await this.db.createAuditLog({
          adminId: adminId || 'admin',
          adminName: adminName || 'Admin',
          role: 'ADMIN',
          action: 'PAYOUT_DESTINATION_VERIFIED',
          module: 'FINANCE_SETTLEMENT',
          targetEntityType: 'DRIVER',
          targetEntityId: targetUuid,
          reason: reason || 'Admin manual verification approved',
          metadata: { evidenceUrl, bankAccountHolderName, verifiedUpiId: vpaToVerify, coolingUntil }
        });
      }

      driver.verifiedUpiId = vpaToVerify;
      driver.pendingUpiId = null;
      driver.payoutUpiVerified = true;
      driver.payoutUpiVerifiedAt = verifiedAt;
      driver.vpaVerificationMethod = 'ADMIN_MANUAL';
      driver.upiCoolingUntil = coolingUntil;
      return { success: true, driver };
    } else {
      // REJECT
      if (isLivePostgres && supabaseAdmin && targetUuid) {
        const { error } = await supabaseAdmin
          .from('drivers')
          .update({
            pending_upi_id: null,
            payout_upi_verified: false
          })
          .eq('id', targetUuid);

        if (error) return { success: false, error: error.message };

        await this.db.createAuditLog({
          adminId: adminId || 'admin',
          adminName: adminName || 'Admin',
          role: 'ADMIN',
          action: 'PAYOUT_DESTINATION_REJECTED',
          module: 'FINANCE_SETTLEMENT',
          targetEntityType: 'DRIVER',
          targetEntityId: targetUuid,
          reason: reason || 'Admin manual verification rejected'
        });
      }

      driver.pendingUpiId = null;
      driver.payoutUpiVerified = false;
      return { success: true, driver };
    }
  }
}

module.exports = DriverRepository;
