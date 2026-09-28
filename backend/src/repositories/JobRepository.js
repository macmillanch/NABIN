const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_JOB_TRANSITIONS = {
  'REQUESTED': [],
  'SEARCHING': ['REQUESTED'],
  'ASSIGNED': ['REQUESTED', 'SEARCHING'],
  'ACCEPTED': ['ASSIGNED'],
  'DRIVER_ARRIVING': ['ASSIGNED', 'ACCEPTED'],
  'DRIVER_ARRIVED': ['ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING'],
  'IN_TRANSIT': ['ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVED'],
  'OUT_FOR_DELIVERY': ['IN_TRANSIT'],
  // Phase 10: 'ASSIGNED' was removed as a valid prior state for COMPLETED.
  // Completion is the money-mutating transition (driver wallet credit plus
  // double-entry ledger posting), so it must only be reachable after the
  // OTP-verified lifecycle (START/PICKUP -> IN_TRANSIT/OUT_FOR_DELIVERY). This
  // enforces that invariant in the SQL WHERE allowlist itself, independently of
  // the route-level guard in server.js, so a future caller cannot reintroduce
  // settlement of a trip whose OTP proofs were never presented.
  'COMPLETED': ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  'CANCELLED': ['REQUESTED', 'SEARCHING', 'ASSIGNED', 'ACCEPTED', 'DRIVER_ARRIVING', 'DRIVER_ARRIVED']
};

// Transitions whose target state is a terminal money effect. For these the SQL
// allowlist must NOT contain the state being written to: `status IN
// ('IN_TRANSIT','OUT_FOR_DELIVERY','COMPLETED')` reads as idempotent but is the
// opposite — the 2nd…50th concurrent completion each re-match the row the 1st one
// just settled under READ COMMITTED, and each then settles a second time.
const NON_REPEATABLE_TRANSITIONS = new Set(['COMPLETED']);

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
    ...meta,
    id: row.job_number || row.id,
    uuid: row.id,
    jobNumber: row.job_number,
    type: row.service_type,
    serviceType: row.service_type,
    customerId: row.customer_id || meta.customerId,
    customerUuid: row.customer_id,
    customerName: meta.customerName || 'Customer',
    customerPhone: meta.customerPhone || null,
    customerRating: meta.customerRating || 5.0,
    driverId: row.driver_id || meta.driverId || null,
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
    updatedAt: row.updated_at || new Date().toISOString()
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

    // Owner Decision 11 (choice B): this is a read-through cache, not a
    // fail-closed read. Preserve the cached-row fallback; do not convert this
    // `if (!error && data)` shape into a 503 without a new owner order.
    if (isLivePostgres && supabaseAdmin) {
      const isUuid = UUID_REGEX.test(id);
      let query = supabaseAdmin.from('jobs').select('*');
      if (isUuid) {
        query = query.eq('id', id);
      } else {
        query = query.eq('job_number', id);
      }
      const { data, error } = await query.maybeSingle();

      if (!error && data) {
        const job = mapRowToJob(data);
        if (this.db.jobs) {
          const idx = this.db.jobs.findIndex(j => j.id === job.id || j.jobNumber === job.jobNumber);
          if (idx !== -1) {
            this.db.jobs[idx] = job;
          } else {
            this.db.jobs.unshift(job);
          }
        }
        return job;
      }
    }
    return cached;
  }

  findByJobNumber(jobNumber) {
    return this.findById(jobNumber);
  }

  // A customer's own ride/parcel history, filtered by the caller's resolved UUID so no
  // request can point it at another account. Unlike `findByIdAsync` this is NOT a
  // read-through cache: when PostgreSQL is unreachable it raises the shared
  // STORE_UNAVAILABLE/503 instead of answering `[]`, because "you have no history" and
  // "we could not read your history" are different answers to give a customer.
  // Only RIDE and PARCEL are listed: a FOOD or GROCERY order already owns a commerce
  // row in `orders` plus a delivery row in `jobs`, so including those types here would
  // show the same purchase twice once the caller merges the two feeds.
  async getJobsByCustomer(customerUuid, { limit = 50, serviceTypes = ['RIDE', 'PARCEL'] } = {}) {
    if (!supabaseAdmin || !customerUuid) return [];
    const rows = await this.db.orderRepo.settleStore(
      supabaseAdmin
        .from('jobs')
        .select('id,job_number,service_type,status,pickup_address,drop_address,final_total,payment_status,driver_id,metadata,created_at,updated_at')
        .eq('customer_id', customerUuid)
        .in('service_type', serviceTypes)
        .order('created_at', { ascending: false })
        .limit(limit),
      'your activity history'
    );
    return (rows || []).map(mapRowToJob);
  }

  // Every COMPLETED job owned by this driver whose row moved at or after `sinceIso`.
  //
  // The set is walked page by page instead of read once: `supabase/config.toml` caps any
  // single PostgREST response at 1000 rows with no error and no notice, and a driver who
  // has worked a month can pass that. A truncated set would not be a smaller answer, it
  // would be a smaller *sum* — the platform quietly under-reporting what it owes — so an
  // incomplete walk raises the same retryable 503 as an unreachable store rather than
  // publishing a partial total. Identity is the caller's resolved driver UUID, which is
  // why no request can point this at another driver's earnings.
  //
  // `jobs` has no `completed_at` column in the frozen schema, so `updated_at` is the
  // closest completion stamp available; that is sound because `COMPLETED` is terminal —
  // the settlement compare-and-set refuses a second transition — so the write that
  // stamped the row is the one that completed it.
  //
  // Returns `null` (not an empty array) when PostgreSQL is not configured at all, which
  // tells the caller to answer from the hydrated driver record the way it always did.
  //
  // `driver_id` is selected even though the query already filters on it, so the caller can
  // prove that the rows it is about to add up are the caller's own. A sum of somebody else's
  // trips is worse than no sum, and a predicate that silently stopped applying is exactly the
  // failure this catches.
  async getDriverCompletedRows(driverUuid, { sinceIso, maxPages = 40 } = {}) {
    if (!supabaseAdmin) return null;
    if (!driverUuid) {
      throw this.db.orderRepo.storeUnavailableError('your earnings history', new Error('No driver identity was resolved for this session.'));
    }
    const read = await this.db.readAllRows(supabaseAdmin, {
      table: 'jobs',
      select: 'id,job_number,service_type,driver_id,status,final_total,driver_earnings,platform_commission,payment_status,created_at,updated_at',
      maxPages,
      filter: (query) => query
        .eq('driver_id', driverUuid)
        .eq('status', 'COMPLETED')
        .gte('updated_at', sinceIso || new Date(0).toISOString()),
    });
    if (!read.complete) {
      throw this.db.orderRepo.storeUnavailableError('your earnings history', new Error(read.error || 'the earnings read did not finish'));
    }
    return read.rows;
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
    const discountAmount = Math.round((Number(jobData.discountAmount || 0)) * 100) / 100;
    // fare_subtotal stays the pre-discount charge so the row satisfies
    // final_total = fare_subtotal - discount_amount for settlement audits.
    const fareSubtotal = Math.round((fare + discountAmount) * 100) / 100;
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
      fare_subtotal: fareSubtotal,
      discount_amount: discountAmount,
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

    const repeatable = !NON_REPEATABLE_TRANSITIONS.has(newStatus);
    if (!repeatable && job.status === newStatus) {
      const settled = new Error(`Job ${jobId} is already ${newStatus}; its settlement has already been booked.`);
      settled.code = 'JOB_ALREADY_SETTLED';
      throw settled;
    }

    const targetDriverUuid = driverId ? (this.db.driverRepo?.resolveUuid(driverId) || null) : null;
    const nowIso = new Date().toISOString();
    const targetJobNumber = job.jobNumber || job.id;

    if (newStatus === 'ASSIGNED') {
      if (isLivePostgres && supabaseAdmin && targetDriverUuid) {
        const { data, error } = await supabaseAdmin.rpc('accept_job_assignment_atomic', {
          p_job_identifier: String(targetJobNumber),
          p_driver_id: targetDriverUuid
        });
        if (error) {
          throw new Error(`PostgreSQL job status update failed: ${error.message}`);
        }
        if (!data || !data.success) {
          throw new Error(`Atomic job transition rejected: ${data?.error || `Job ${jobId} could not transition to ASSIGNED`}`);
        }
        job.status = newStatus;
        if (driverId) job.driverId = driverId;
        job.updatedAt = data.accepted_at || nowIso;
        Object.assign(job, extraFields);
        return job;
      }
    }

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
        const allowed = new Set(validPriorStates);
        // A settlement transition may only fire from its prior states; letting it
        // also match its own target would make every duplicate request a winner.
        if (repeatable) allowed.add(newStatus);
        query = query.in('status', Array.from(allowed));
      } else if (validPriorStates && validPriorStates.length === 0) {
        query = query.eq('status', newStatus);
      }

      const { data, error } = await query.select();

      if (error) {
        throw new Error(`PostgreSQL job status update failed: ${error.message}`);
      }

      if (!data || data.length === 0) {
        // Zero rows updated means another request claimed the row between our read
        // and ours — or the trip was already settled. Either way this caller owns
        // no financial effect and must not create one.
        if (!repeatable) {
          const lost = new Error(`Job ${jobId} was already ${newStatus} when this request reached PostgreSQL; the transition was claimed elsewhere.`);
          lost.code = 'JOB_ALREADY_SETTLED';
          throw lost;
        }
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

  /**
   * Job summaries for a bounded set of job uuids.
   *
   * A dispatch offer row carries ids, distance and rank — nothing a partner can decide on.
   * The driver's offer list therefore has to join each offer to the job behind it, and this
   * is that read: the fare the partner will earn, the service, and the two addresses, with
   * no customer identity in it. Customer name and phone stay behind the acceptance, because
   * before a driver has taken a job they have no claim on who gave it.
   *
   * Returns null when PostgreSQL is not configured (memory-only mode) and throws a
   * store-unavailable error when the read did not finish, so a half-read list is never
   * rendered as "these are all your offers".
   */
  async getJobSummariesByUuids(uuids = []) {
    if (!supabaseAdmin) return null;
    const ids = [...new Set(uuids.filter(Boolean).map(String))];
    if (!ids.length) return [];

    const read = await this.db.readAllRows(supabaseAdmin, {
      table: 'jobs',
      select: 'id,job_number,service_type,status,pickup_address,drop_address,pickup_lat,pickup_lng,drop_lat,drop_lng,distance_km,final_total,driver_earnings,platform_commission,payment_status,created_at,updated_at',
      filter: (q) => q.in('id', ids),
    });
    if (!read.complete) {
      throw this.db.orderRepo.storeUnavailableError('the jobs behind your offers', new Error(read.error || 'the offers read did not finish'));
    }

    const byId = new Map();
    for (const row of read.rows) {
      byId.set(String(row.id), {
        jobUuid: row.id,
        jobNumber: row.job_number,
        serviceType: row.service_type,
        status: row.status,
        pickupAddress: row.pickup_address,
        dropAddress: row.drop_address,
        pickupLat: row.pickup_lat !== null && row.pickup_lat !== undefined ? parseFloat(row.pickup_lat) : null,
        pickupLng: row.pickup_lng !== null && row.pickup_lng !== undefined ? parseFloat(row.pickup_lng) : null,
        dropLat: row.drop_lat !== null && row.drop_lat !== undefined ? parseFloat(row.drop_lat) : null,
        dropLng: row.drop_lng !== null && row.drop_lng !== undefined ? parseFloat(row.drop_lng) : null,
        distanceKm: row.distance_km !== null && row.distance_km !== undefined ? parseFloat(row.distance_km) : null,
        fare: row.final_total !== null ? parseFloat(row.final_total) : null,
        driverEarnings: row.driver_earnings !== null ? parseFloat(row.driver_earnings) : null,
        platformCommission: row.platform_commission !== null ? parseFloat(row.platform_commission) : null,
        createdAt: row.created_at,
      });
    }
    return byId;
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
module.exports.mapRowToJob = mapRowToJob;
