const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRowToOffer(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    jobUuid: row.job_uuid,
    driverId: row.driver_id,
    driverUuid: row.driver_uuid,
    status: row.status,
    offeredAt: row.offered_at,
    expiresAt: row.expires_at,
    respondedAt: row.responded_at,
    rejectionReason: row.rejection_reason,
    distanceToPickup: parseFloat(row.distance_to_pickup || 0.0),
    rankScore: parseFloat(row.rank_score || 0.0),
    attemptNumber: row.attempt_number || 1,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

class DispatchRepository {
  constructor(db) {
    this.db = db;
    this.offers = []; // In-memory fallback / cache
  }

  resolveDriverUuid(driverId) {
    if (!driverId) return null;
    if (this.db.driverRepo) {
      const resolved = this.db.driverRepo.resolveUuid(driverId);
      if (resolved) return resolved;
    }
    if (UUID_REGEX.test(driverId)) return driverId;
    return null;
  }

  async resolveJobUuid(jobId) {
    if (!jobId) return null;
    if (UUID_REGEX.test(jobId)) return jobId;

    // Check in-memory first
    const cachedJob = this.db.jobRepo?.findById(jobId);
    if (cachedJob && cachedJob.uuid) return cachedJob.uuid;

    if (isLivePostgres && supabaseAdmin) {
      const { data } = await supabaseAdmin
        .from('jobs')
        .select('id')
        .eq('job_number', jobId)
        .maybeSingle();
      if (data && data.id) return data.id;
    }

    return null;
  }

  /**
   * Create Authoritative Dispatch Offer in PostgreSQL
   */
  async createOffer({ jobId, driverId, ttlSeconds = 30, idempotencyKey = null, metadata = {} }) {
    const driverUuid = this.resolveDriverUuid(driverId);
    const jobUuid = await this.resolveJobUuid(jobId);

    if (isLivePostgres && supabaseAdmin && jobUuid && driverUuid) {
      const { data, error } = await supabaseAdmin.rpc('create_dispatch_offer_atomic', {
        p_job_uuid: jobUuid,
        p_driver_uuid: driverUuid,
        p_ttl_seconds: ttlSeconds,
        p_idempotency_key: idempotencyKey,
        p_metadata: metadata
      });

      if (error) {
        throw new Error(`Failed to create dispatch offer in PostgreSQL: ${error.message}`);
      }

      if (data && data.offer_id) {
        const offerObj = {
          id: data.offer_id,
          jobId: data.job_id || jobId,
          jobUuid,
          driverId,
          driverUuid,
          status: data.status || 'OFFERED',
          offeredAt: data.offered_at || new Date().toISOString(),
          expiresAt: data.expires_at || new Date(Date.now() + ttlSeconds * 1000).toISOString(),
          idempotencyKey,
          metadata
        };
        this.offers.unshift(offerObj);
        return { success: true, duplicate: !!data.duplicate, offer: offerObj };
      }
      return data;
    }

    // Fallback for non-postgres mode
    const now = new Date();
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    const fallbackOffer = {
      id: `off_${Date.now().toString().slice(-6)}_${Math.floor(100 + Math.random() * 900)}`,
      jobId,
      jobUuid: jobUuid || jobId,
      driverId,
      driverUuid: driverUuid || driverId,
      status: 'OFFERED',
      offeredAt: now.toISOString(),
      expiresAt: expires.toISOString(),
      idempotencyKey,
      metadata
    };
    this.offers.unshift(fallbackOffer);
    return { success: true, duplicate: false, offer: fallbackOffer };
  }

  /**
   * Authoritative Atomic Acceptance of a Dispatch Offer
   */
  async acceptOfferAtomic({ offerId, driverId, idempotencyKey = null }) {
    if (!offerId) {
      return { success: false, code: 'OFFER_ID_REQUIRED', error: 'offerId is required.' };
    }

    const driverUuid = this.resolveDriverUuid(driverId) || driverId;

    if (isLivePostgres && supabaseAdmin && UUID_REGEX.test(offerId) && UUID_REGEX.test(driverUuid)) {
      const { data, error } = await supabaseAdmin.rpc('accept_dispatch_offer_atomic', {
        p_offer_id: offerId,
        p_driver_id: driverUuid,
        p_idempotency_key: idempotencyKey
      });

      if (error) {
        throw new Error(`PostgreSQL atomic offer acceptance error: ${error.message}`);
      }

      if (data && data.success) {
        // Sync in-memory job state if present
        const targetJobId = data.job_id;
        const memJob = this.db.jobRepo?.findById(targetJobId) || this.db.jobRepo?.findById(data.job_uuid);
        if (memJob) {
          memJob.status = 'ASSIGNED';
          memJob.driverId = driverId;
          memJob.driverUuid = driverUuid;
          memJob.updatedAt = data.accepted_at || new Date().toISOString();
        }
        const memDriver = this.db.getDriver(driverId);
        if (memDriver) {
          memDriver.activeJobId = targetJobId || data.job_uuid;
        }
      }

      return data;
    }

    // Fallback for in-memory mode
    const offer = this.offers.find(o => o.id === offerId);
    if (!offer) {
      return { success: false, code: 'OFFER_NOT_FOUND', error: 'Dispatch offer not found.' };
    }
    if (offer.driverId !== driverId && offer.driverUuid !== driverUuid) {
      return { success: false, code: 'DRIVER_MISMATCH', error: 'Dispatch offer is not assigned to this driver.' };
    }
    if (offer.status === 'ACCEPTED') {
      return { success: true, duplicate: true, code: 'OFFER_ALREADY_ACCEPTED', offer_id: offer.id, status: 'ASSIGNED' };
    }
    if (new Date(offer.expiresAt) < new Date()) {
      offer.status = 'EXPIRED';
      return { success: false, code: 'OFFER_EXPIRED', error: 'Dispatch offer has expired.' };
    }

    const memJob = this.db.jobRepo?.findById(offer.jobId);
    if (memJob && memJob.status === 'ASSIGNED' && memJob.driverId !== driverId) {
      offer.status = 'CANCELLED';
      return { success: false, code: 'JOB_ALREADY_ASSIGNED', error: 'Job has already been assigned to another driver.' };
    }

    offer.status = 'ACCEPTED';
    offer.respondedAt = new Date().toISOString();
    if (memJob) {
      memJob.status = 'ASSIGNED';
      memJob.driverId = driverId;
    }
    return { success: true, duplicate: false, offer_id: offer.id, job_id: offer.jobId, status: 'ASSIGNED' };
  }

  /**
   * Decline one's own dispatch offer.
   *
   * `dispatch_offers` has carried a REJECTED state, a `rejection_reason` column and an RLS
   * policy described as "authenticated drivers can ONLY update their own offers (e.g.
   * reject/respond)" since migration 014/020, but no API ever implemented it — so the
   * driver app's Decline button had nothing honest to call and invented the offer locally.
   *
   * Concurrency, in one statement: the row is writable only while it is still an OPEN offer
   * addressed to THIS driver. PostgreSQL serialises the two writers on that row, so an
   * accept and a reject cannot both succeed, and a replayed decline matches zero rows and
   * is reported as a duplicate instead of rewriting history.
   */
  async rejectOfferAtomic({ offerId, driverId, reason = null }) {
    if (!offerId) {
      return { success: false, code: 'OFFER_ID_REQUIRED', error: 'offerId is required.' };
    }

    const driverUuid = this.resolveDriverUuid(driverId);
    if (!driverUuid) {
      // Refuse rather than fall back to a weaker filter: an unresolved identity here would
      // turn "decline my own offer" into "decline whichever offer this id happens to hit".
      const err = new Error('The driver identity for this session could not be resolved to a dispatch account.');
      err.code = 'DRIVER_IDENTITY_UNRESOLVED';
      err.status = 403;
      throw err;
    }

    if (isLivePostgres && supabaseAdmin && UUID_REGEX.test(offerId)) {
      const nowIso = new Date().toISOString();
      const { data: updated, error } = await supabaseAdmin
        .from('dispatch_offers')
        .update({
          status: 'REJECTED',
          rejection_reason: reason ? String(reason).slice(0, 120) : 'DRIVER_DECLINED',
          responded_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', offerId)
        .eq('driver_uuid', driverUuid)
        .eq('status', 'OFFERED')
        .select();

      if (error) {
        // A store that cannot answer is not "you have no offer to decline".
        throw this.db.orderRepo.storeUnavailableError('the offer you tried to decline', new Error(error.message));
      }

      if (updated && updated.length > 0) {
        const memOffer = this.offers.find(o => o.id === offerId || String(o.jobUuid) === String(updated[0].job_uuid));
        if (memOffer) {
          memOffer.status = 'REJECTED';
          memOffer.respondedAt = nowIso;
          memOffer.rejectionReason = updated[0].rejection_reason;
        }
        return { success: true, duplicate: false, offer_id: offerId, job_id: updated[0].job_id, status: 'REJECTED' };
      }

      // Zero rows: read the offer back and name the real reason, instead of reporting a
      // decline that did not happen.
      const { data: row, error: readErr } = await supabaseAdmin
        .from('dispatch_offers').select('*').eq('id', offerId).maybeSingle();
      if (readErr) {
        throw this.db.orderRepo.storeUnavailableError('the offer you tried to decline', new Error(readErr.message));
      }
      if (!row) {
        return { success: false, code: 'OFFER_NOT_FOUND', error: 'Dispatch offer not found.' };
      }
      if (String(row.driver_uuid) !== String(driverUuid)) {
        return { success: false, code: 'DRIVER_MISMATCH', error: 'Forbidden: this dispatch offer is not addressed to you.' };
      }
      if (row.status === 'REJECTED') {
        return { success: true, duplicate: true, offer_id: offerId, job_id: row.job_id, status: 'REJECTED' };
      }
      return {
        success: false,
        code: row.status === 'ACCEPTED' ? 'OFFER_ALREADY_ACCEPTED' : 'OFFER_CLOSED',
        status: row.status,
        error: row.status === 'ACCEPTED'
          ? 'This offer was already accepted and cannot be declined afterwards.'
          : `This offer is no longer open (status ${row.status}).`,
      };
    }

    // In-memory mode (no PostgreSQL configured): the same three conditions.
    const offer = this.offers.find(o => o.id === offerId);
    if (!offer) {
      return { success: false, code: 'OFFER_NOT_FOUND', error: 'Dispatch offer not found.' };
    }
    if (offer.driverId !== driverId && offer.driverUuid !== driverUuid) {
      return { success: false, code: 'DRIVER_MISMATCH', error: 'Forbidden: this dispatch offer is not addressed to you.' };
    }
    if (offer.status === 'REJECTED') {
      return { success: true, duplicate: true, offer_id: offerId, job_id: offer.jobId, status: 'REJECTED' };
    }
    if (offer.status !== 'OFFERED') {
      return { success: false, code: 'OFFER_CLOSED', status: offer.status, error: `This offer is no longer open (status ${offer.status}).` };
    }
    offer.status = 'REJECTED';
    offer.respondedAt = new Date().toISOString();
    offer.rejectionReason = reason ? String(reason).slice(0, 120) : 'DRIVER_DECLINED';
    return { success: true, duplicate: false, offer_id: offerId, job_id: offer.jobId, status: 'REJECTED' };
  }

  /**
   * Authoritative Atomic Acceptance of a Job Assignment
   * Supports acceptance by jobId / jobNumber or offerId.
   */
  async acceptJobAtomic({ jobId, driverId, offerId = null, idempotencyKey = null }) {
    if (!jobId && !offerId) {
      return { success: false, code: 'IDENTIFIER_REQUIRED', error: 'jobId or offerId is required.' };
    }

    const driverUuid = this.resolveDriverUuid(driverId) || driverId;

    if (isLivePostgres && supabaseAdmin && UUID_REGEX.test(driverUuid)) {
      const { data, error } = await supabaseAdmin.rpc('accept_job_assignment_atomic', {
        p_job_identifier: jobId ? String(jobId) : '',
        p_driver_id: driverUuid,
        p_offer_id: offerId && UUID_REGEX.test(offerId) ? offerId : null,
        p_idempotency_key: idempotencyKey
      });

      if (error) {
        throw new Error(`PostgreSQL atomic job acceptance error: ${error.message}`);
      }

      if (data && data.success) {
        // Sync in-memory job state
        const targetJobId = data.job_id || jobId;
        const memJob = this.db.jobRepo?.findById(targetJobId) || this.db.jobRepo?.findById(data.job_uuid);
        if (memJob) {
          memJob.status = 'ASSIGNED';
          memJob.driverId = driverId;
          memJob.driverUuid = driverUuid;
          memJob.updatedAt = data.accepted_at || new Date().toISOString();
        }
        const memDriver = this.db.getDriver(driverId);
        if (memDriver) {
          memDriver.activeJobId = targetJobId || data.job_uuid;
        }
      }

      return data;
    }

    // Fallback for in-memory mode
    return this.db.jobRepo.updateStatus(jobId, 'ASSIGNED', driverId);
  }

  /**
   * Get Active Offers strictly for an authenticated driver
   */
  async getOffersForDriver(driverId, options = {}) {
    const driverUuid = this.resolveDriverUuid(driverId);
    const nowIso = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
        .from('dispatch_offers')
        .select('*')
        .eq('status', 'OFFERED')
        .gt('expires_at', nowIso)
        .order('offered_at', { ascending: false });

      if (driverUuid) {
        query = query.or(`driver_uuid.eq.${driverUuid},driver_id.eq.${driverId},driver_id.eq.${driverUuid}`);
      } else {
        query = query.eq('driver_id', driverId);
      }

      const { data, error } = await query;
      if (!error && data) {
        return data.map(mapRowToOffer);
      }
    }

    // Fallback to in-memory
    // Owner Decision 11 (choice B): a read-through cache, not a fail-closed read.
    // When PostgreSQL cannot answer, active offers keep coming from memory rather
    // than failing with a 503. Preserve this; do not reverse it without a new order.
    const now = new Date();
    return this.offers.filter(o =>
      (o.driverId === driverId || (driverUuid && o.driverUuid === driverUuid)) &&
      o.status === 'OFFERED' &&
      new Date(o.expiresAt) > now
    );
  }

  /**
   * Get Active Job Assignment for a driver from PostgreSQL
   *
   * Two properties this method did not previously have, both of which matter now that a
   * driver-facing screen reads it:
   *
   * 1. The ownership filter is unconditional. It used to be applied only when the caller's
   *    id resolved, so an unresolved identity produced a query with NO driver filter and
   *    returned whichever job happened to be active — somebody else's job, on this driver's
   *    screen. An identity that cannot be resolved is refused instead of widened.
   * 2. It returns no OTP. `start_otp` / `delivery_otp` are the customer's proof that the
   *    person at the door is the assigned driver; echoing them to the driver's own app would
   *    let the partner read out the code they are supposed to be given. The caller is told
   *    an OTP is required, never what it is.
   */
  async getActiveAssignmentForDriver(driverId) {
    const driverUuid = this.resolveDriverUuid(driverId);
    if (!driverUuid) {
      const err = new Error('The driver identity for this session could not be resolved to a dispatch account.');
      err.code = 'DRIVER_IDENTITY_UNRESOLVED';
      err.status = 403;
      throw err;
    }

    if (isLivePostgres && supabaseAdmin) {
      const query = supabaseAdmin
        .from('jobs')
        .select('*')
        .eq('driver_id', driverUuid)
        .not('status', 'in', '("COMPLETED","CANCELLED")')
        .order('updated_at', { ascending: false });

      const { data, error } = await query.limit(1).maybeSingle();
      if (error) {
        throw this.db.orderRepo.storeUnavailableError('your current job', new Error(error.message));
      }
      if (data) {
        return {
          id: data.job_number || data.id,
          uuid: data.id,
          jobNumber: data.job_number,
          status: data.status,
          serviceType: data.service_type,
          customerId: data.customer_id,
          driverId: data.driver_id,
          pickupAddress: data.pickup_address,
          dropAddress: data.drop_address,
          pickupLat: data.pickup_lat !== null && data.pickup_lat !== undefined ? parseFloat(data.pickup_lat) : null,
          pickupLng: data.pickup_lng !== null && data.pickup_lng !== undefined ? parseFloat(data.pickup_lng) : null,
          dropLat: data.drop_lat !== null && data.drop_lat !== undefined ? parseFloat(data.drop_lat) : null,
          dropLng: data.drop_lng !== null && data.drop_lng !== undefined ? parseFloat(data.drop_lng) : null,
          distanceKm: data.distance_km !== null ? parseFloat(data.distance_km) : null,
          fare: parseFloat(data.final_total || 0),
          driverEarnings: data.driver_earnings !== null ? parseFloat(data.driver_earnings) : null,
          paymentStatus: data.payment_status || null,
          otpRequired: true,
          createdAt: data.created_at,
          updatedAt: data.updated_at
        };
      }
      return null;
    }

    if (this.db.jobRepo) {
      const activeJobs = this.db.jobRepo.getActiveJobsByDriverId(driverId);
      return activeJobs.length > 0 ? activeJobs[0] : null;
    }
    return null;
  }
}

module.exports = DispatchRepository;
