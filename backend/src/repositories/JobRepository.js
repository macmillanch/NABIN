const { supabaseAdmin, isLivePostgres } = require('../supabase');

const VALID_JOB_TRANSITIONS = {
  'REQUESTED': [],
  'SEARCHING': ['REQUESTED'],
  'ASSIGNED': ['REQUESTED', 'SEARCHING'],
  'ACCEPTED': ['ASSIGNED'],
  'DRIVER_ARRIVING': ['ASSIGNED', 'ACCEPTED'],
  'DRIVER_ARRIVED': ['ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING'],
  'IN_TRANSIT': ['ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVED'],
  'OUT_FOR_DELIVERY': ['IN_TRANSIT'],
  'COMPLETED': ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ASSIGNED'],
  'CANCELLED': ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']
};

function normalizeServiceType(type) {
  if (!type) return 'RIDE';
  const upper = String(type).toUpperCase();
  if (['FOOD', 'PARCEL', 'GROCERY'].includes(upper)) return upper;
  return 'RIDE';
}

function mapRowToJob(row) {
  if (!row) return null;
  const meta = row.metadata || {};
  return {
    id: row.job_number || row.id,
    uuid: row.id,
    jobNumber: row.job_number,
    type: row.service_type,
    serviceType: row.service_type,
    customerId: meta.customerId || row.customer_id,
    customerUuid: row.customer_id,
    customerName: meta.customerName || 'Customer',
    customerPhone: meta.customerPhone || null,
    customerRating: meta.customerRating || 5.0,
    driverId: meta.driverId || row.driver_id,
    driverUuid: row.driver_id,
    merchantId: row.merchant_id,
    status: row.status,
    pickup: {
      address: row.pickup_address,
      lat: parseFloat(row.pickup_lat || 28.6139),
      lng: parseFloat(row.pickup_lng || 77.2090)
    },
    drop: {
      address: row.drop_address,
      lat: parseFloat(row.drop_lat || 28.6250),
      lng: parseFloat(row.drop_lng || 77.2150)
    },
    distanceKm: parseFloat(row.distance_km || 0.0),
    fare: parseFloat(row.final_total || 0.0),
    fareSubtotal: parseFloat(row.fare_subtotal || row.final_total || 0.0),
    discountAmount: parseFloat(row.discount_amount || 0.0),
    surgeMultiplier: parseFloat(row.surge_multiplier || 1.0),
    packagingFee: parseFloat(row.packaging_fee || 0.0),
    driverEarnings: parseFloat(row.driver_earnings || 0.0),
    platformFee: parseFloat(row.platform_commission || 0.0),
    startOtp: row.start_otp,
    pickupOtp: row.pickup_otp,
    deliveryOtp: row.delivery_otp,
    paymentMethod: row.payment_method || 'WALLET',
    paymentStatus: row.payment_status || 'PENDING',
    paymentMode: meta.paymentMode || 'Online UPI',
    items: meta.items || [],
    restaurantId: meta.restaurantId || null,
    restaurantName: meta.restaurantName || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    ...meta
  };
}

class JobRepository {
  constructor(db) {
    this.db = db;
  }

  findById(id) {
    if (!id) return null;
    if (this.db.jobs) {
      const found = this.db.jobs.find(j => j.id === id || j.jobNumber === id || j.uuid === id);
      if (found) return found;
    }
    return null;
  }

  async findByIdAsync(id) {
    if (!id) return null;
    const cached = this.findById(id);
    if (cached) return cached;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('jobs')
        .select('*')
        .or(`job_number.eq.${id},id.eq.${id}`)
        .maybeSingle();

      if (!error && data) {
        const job = mapRowToJob(data);
        if (this.db.jobs) this.db.jobs.unshift(job);
        return job;
      }
    }
    return null;
  }

  findByJobNumber(jobNumber) {
    return this.findById(jobNumber);
  }

  /**
   * Authoritative Job Creation in PostgreSQL
   */
  async create(jobData) {
    const jobNumber = jobData.id || `JOB-${Date.now().toString().slice(-8)}-${Math.floor(100 + Math.random() * 900)}`;
    const serviceType = normalizeServiceType(jobData.type || jobData.serviceType);
    const status = jobData.status || 'REQUESTED';

    const customerUuid = this.db.userRepo?.resolveUuid(jobData.customerId) || null;
    const driverUuid = this.db.driverRepo?.resolveUuid(jobData.driverId) || null;

    const fare = Number(jobData.fare || 0);
    const packagingFee = Number(jobData.packagingFee || 0);
    const platformFee = Number(jobData.platformFee !== undefined ? jobData.platformFee : Math.round(fare * 0.15));
    const driverEarnings = Number(jobData.driverEarnings !== undefined ? jobData.driverEarnings : (fare - platformFee));

    const metadata = {
      customerId: jobData.customerId,
      customerName: jobData.customerName,
      customerPhone: jobData.customerPhone,
      customerRating: jobData.customerRating,
      driverId: jobData.driverId,
      paymentMode: jobData.paymentMode || 'Online UPI',
      items: jobData.items || [],
      restaurantId: jobData.restaurantId || null,
      restaurantName: jobData.restaurantName || null,
      vehicleType: jobData.vehicleType || null,
      notes: jobData.notes || null,
      ...jobData.metadata
    };

    const payload = {
      job_number: jobNumber,
      service_type: serviceType,
      customer_id: customerUuid,
      driver_id: driverUuid,
      status,
      pickup_address: jobData.pickup?.address || 'Pickup Locality',
      drop_address: jobData.drop?.address || 'Drop Locality',
      pickup_lat: jobData.pickup?.lat || 28.6139,
      pickup_lng: jobData.pickup?.lng || 77.2090,
      drop_lat: jobData.drop?.lat || 28.6250,
      drop_lng: jobData.drop?.lng || 77.2150,
      distance_km: Number(jobData.distanceKm || 0.0),
      fare_subtotal: fare,
      discount_amount: Number(jobData.discountAmount || 0.0),
      surge_multiplier: Number(jobData.surgeMultiplier || 1.0),
      surge_amount: Number(jobData.surgeAmount || 0.0),
      tax_amount: Number(jobData.taxAmount || 0.0),
      packaging_fee: packagingFee,
      final_total: fare,
      driver_earnings: driverEarnings,
      platform_commission: platformFee,
      start_otp: jobData.startOtp || Math.floor(1000 + Math.random() * 9000).toString(),
      pickup_otp: jobData.pickupOtp || null,
      delivery_otp: jobData.deliveryOtp || Math.floor(1000 + Math.random() * 9000).toString(),
      payment_method: jobData.paymentMethod || 'WALLET',
      payment_status: jobData.paymentStatus || 'PENDING',
      metadata
    };

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('jobs')
        .insert([payload])
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to create job in PostgreSQL: ${error.message}`);
      }

      const createdJob = mapRowToJob(data);
      if (this.db.jobs) {
        this.db.jobs.unshift(createdJob);
      }
      return createdJob;
    }

    // Fallback for non-postgres mode
    const fallbackJob = {
      id: jobNumber,
      jobNumber,
      ...jobData,
      fare,
      packagingFee,
      driverEarnings,
      platformFee,
      status,
      startOtp: payload.start_otp,
      deliveryOtp: payload.delivery_otp,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (this.db.jobs) this.db.jobs.unshift(fallbackJob);
    return fallbackJob;
  }

  /**
   * Atomic Conditional State Transition in PostgreSQL
   * Eliminates read-then-write race conditions.
   */
  async updateStatus(jobId, newStatus, driverId = null, extraFields = {}) {
    let job = this.findById(jobId);
    if (!job) {
      job = await this.findByIdAsync(jobId);
    }
    if (!job) return null;

    const validPriorStates = VALID_JOB_TRANSITIONS[newStatus];
    if (validPriorStates !== undefined && !validPriorStates.includes(job.status) && job.status !== newStatus) {
      throw new Error(`Atomic job transition rejected: Job ${jobId} could not transition to ${newStatus} from current state ${job.status}`);
    }

    const targetDriverUuid = driverId ? (this.db.driverRepo?.resolveUuid(driverId) || null) : null;
    const nowIso = new Date().toISOString();
    const targetJobNumber = job.jobNumber || job.id;

    if (isLivePostgres && supabaseAdmin) {
      const updatePayload = {
        status: newStatus,
        updated_at: nowIso
      };
      if (targetDriverUuid) {
        updatePayload.driver_id = targetDriverUuid;
      }
      if (extraFields.paymentStatus) {
        updatePayload.payment_status = extraFields.paymentStatus;
      }

      let query = supabaseAdmin
        .from('jobs')
        .update(updatePayload)
        .eq('job_number', targetJobNumber);

      // Atomic condition check in PostgreSQL WHERE clause
      if (validPriorStates && validPriorStates.length > 0) {
        const allowed = Array.from(new Set([...validPriorStates, newStatus]));
        query = query.in('status', allowed);
      } else if (validPriorStates && validPriorStates.length === 0) {
        query = query.eq('status', newStatus);
      }

      const { data, error } = await query.select();

      if (error) {
        throw new Error(`PostgreSQL job status update failed: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error(`Atomic job transition rejected: Job ${jobId} could not transition to ${newStatus} from current state ${job.status}`);
      }
    }

    // Update in-memory cache on confirmed PostgreSQL success
    job.status = newStatus;
    if (driverId) job.driverId = driverId;
    job.updatedAt = nowIso;
    Object.assign(job, extraFields);
    return job;
  }

  getActiveJobsByCustomerId(customerId) {
    if (!this.db.jobs) return [];
    return this.db.jobs.filter(j =>
      (j.customerId === customerId || j.customerUuid === customerId) &&
      j.status !== 'COMPLETED' &&
      j.status !== 'CANCELLED'
    );
  }

  getActiveJobsByDriverId(driverId) {
    if (!this.db.jobs) return [];
    return this.db.jobs.filter(j =>
      (j.driverId === driverId || j.driverUuid === driverId) &&
      j.status !== 'COMPLETED' &&
      j.status !== 'CANCELLED'
    );
  }
}

module.exports = JobRepository;
