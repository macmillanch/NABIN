// =========================================================================
// NABIN PLATFORM — PAYMENT REPOSITORY (PostgreSQL-Authoritative)
// Governs payment sessions, atomic capture, webhook idempotency, and refunds.
// Migration 006 & 018 authoritative integration.
// =========================================================================
const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');
const { isProduction } = require('../services/RuntimeMode');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH'];

/**
 * The store refused a financial write, and PostgreSQL's sentence about itself is not the
 * caller's to read.
 *
 * Both payment writes used to `console.error` the refusal and continue as though it had
 * succeeded. A checkout then answered 200 with a session that had no row behind it, and a
 * refused webhook event booked ledger money while answering `duplicate: false`. Money is the
 * one place a refusal cannot be an opinion, so the refusal travels with the parts `storeReply`
 * (supabase.js) classifies — the engine's own `code`, the wire `status` when there is one, and
 * the engine's text as `details`, which the route logs and never echoes. The status stays unset
 * on purpose: a store failure is not a 400, and `storeReply` decides what it is (503 when the
 * store is gone, 409 on a collision, 500 when the schema is not ready) from the code.
 */
function storeFailure(what, error) {
  const err = new Error(`The ${what} could not be completed because the payment store refused it.`);
  err.storeFailure = true;
  err.code = (error && error.code) || 'STORE_ERROR';
  err.details = error ? String(error.message || error.code || error) : 'unknown store failure';
  if (error && error.hint) err.hint = String(error.hint);
  const wireStatus = error && (error.status || error.statusCode);
  if (wireStatus) err.status = Number(wireStatus);
  if (error && error.cause) err.cause = error.cause;
  return err;
}

class PaymentRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Check in-memory processed sets for fast deduplication
   */
  isProcessed(paymentIdOrEventId) {
    if (!paymentIdOrEventId) return false;
    return (
      (this.db.processedPaymentIds && this.db.processedPaymentIds.has(paymentIdOrEventId)) ||
      (this.db.processedWebhookIds && this.db.processedWebhookIds.has(paymentIdOrEventId))
    );
  }

  /**
   * Helper: Resolve UUID for customer
   */
  resolveCustomerUuid(customerId) {
    if (!customerId) return null;
    if (UUID_REGEX.test(customerId)) return customerId;
    if (this.db && this.db.userRepo) {
      const resolved = this.db.userRepo.resolveUuid(customerId);
      if (resolved && UUID_REGEX.test(resolved)) return resolved;
    }
    return null;
  }

  /**
   * 1. Create a Payment Session
   *
   * Persists to PostgreSQL payment_sessions with status INITIATED. This is a *simulated* checkout:
   * it records the intent to pay and nothing else. No gateway is contacted, because no gateway
   * integration exists in this repository, so the returned id is not a provider order id and
   * `simulated: true` travels with the record. A request that names `PAYMENT_MODE=live` is refused
   * rather than answered with a simulated order wearing a live label.
   */
  async createPaymentSession({ customerId, amount, currency = 'INR', serviceType = 'RIDE', jobId = null, metadata = {} }) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Valid transaction amount is required to create a payment session.');
    }

    // A live checkout can only be offered by an integration that actually reaches a gateway, and this
    // repository has none: an inventory of every file under `backend/src` for a Razorpay SDK import, an
    // `api.razorpay.com` request or any other payment client returns zero hits (pinned by LPT-15).
    // `PAYMENT_MODE=live` used to be satisfied by two non-empty environment variables, after which the
    // "gateway order id" was minted here from Date.now() and Math.random() and the row labelled
    // RAZORPAY_LIVE. The caller was handed an identifier nothing can charge, and no webhook or
    // reconciliation could ever settle against it. Until a provider is chosen by the owner and its
    // integration exists, the truthful answer is a refusal — raised before an id is minted, so nothing
    // is persisted, cached, audited or booked, and a retry of the same request cannot manufacture the
    // success this one refused. Both `status` and `statusCode` are set because the route below answers
    // from `statusCode`, while the rest of the platform's typed refusals carry `.status`.
    const paymentMode = (process.env.PAYMENT_MODE || '').trim().toLowerCase();
    if (paymentMode === 'live') {
      const err = new Error(
        'Live payment processing is not configured on this server: PAYMENT_MODE=live names a payment '
        + 'provider this deployment has no integration for, so no gateway order can be created. '
        + 'Set PAYMENT_MODE=sandbox or test for a simulated checkout, or provision the provider '
        + 'integration and its credentials before retrying.'
      );
      err.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
      err.status = err.statusCode = 503;
      throw err;
    }

    // The same fabrication ran the other way: anything that was not `live` fell through to the sandbox
    // branch, including production with PAYMENT_MODE never declared, which answered with a simulated
    // order while saying nothing about it being simulated. Simulation is the intended rail here
    // (backend/.env.production.example:47 declares `PAYMENT_MODE=sandbox` on purpose), so an explicit
    // declaration keeps working and now labels itself; what is refused is an undeclared one.
    if (!paymentMode && isProduction()) {
      const err = new Error(
        'PAYMENT_MODE is not configured, and this server will not default a payment rail. '
        + 'Set PAYMENT_MODE=sandbox or test for a simulated checkout; live is refused until a real '
        + 'provider integration exists.'
      );
      err.code = 'PAYMENT_MODE_UNCONFIGURED';
      err.status = err.statusCode = 503;
      throw err;
    }

    const orderId = `order_rzp_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const customerUuid = this.resolveCustomerUuid(customerId);
    const jobUuid = (jobId && UUID_REGEX.test(jobId)) ? jobId : null;
    // The key id belongs to the gateway account, not to this file. It used to fall back to a literal
    // written here, which told a client that some account would be charged.
    const keyId = process.env.PAYMENT_KEY_ID || null;

    const sessionRecord = {
      orderId,
      customerId: customerUuid || customerId || 'usr_cust_anon',
      amount: numAmount,
      currency,
      serviceType,
      jobId: jobUuid || jobId || null,
      status: 'PAYMENT_PENDING',
      provider: 'RAZORPAY_SANDBOX',
      simulated: true,
      paymentMode,
      keyId,
      metadata: { ...metadata, callerCustomerId: customerId, simulated: true, paymentMode },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 1. Authoritative PostgreSQL Insert
    // The row is the checkout. `payment_sessions.order_id` is UNIQUE
    // (migrations/006_payments_domain.sql:14), so a refusal here means the durable session does
    // not exist — and a session that does not exist cannot be captured later. Cache and audit
    // below are reachable only once the store has accepted the row; the degraded (non-live) path
    // keeps answering from memory, which is the owner-approved outage semantics for this map.
    if (isLivePostgres && supabaseAdmin) {
      let data, error;
      try {
        ({ data, error } = await supabaseAdmin
          .from('payment_sessions')
          .insert({
            order_id: orderId,
            customer_id: customerUuid,
            job_id: jobUuid,
            amount: numAmount,
            currency,
            service_type: serviceType,
            status: 'INITIATED',
            provider: sessionRecord.provider,
            key_id: keyId,
            metadata: sessionRecord.metadata
          })
          .select()
          .single());
      } catch (dbErr) {
        throw storeFailure('payment order session', dbErr);
      }

      if (error) throw storeFailure('payment order session', error);
      if (!data) {
        throw storeFailure('payment order session', {
          code: 'STORE_ERROR',
          message: 'the payment_sessions insert answered with no row and no error',
        });
      }

      sessionRecord.id = data.id;
      sessionRecord.createdAt = data.created_at;
      sessionRecord.updatedAt = data.updated_at;
    }

    // 2. Cache in memory
    if (!this.db.paymentSessions) this.db.paymentSessions = new Map();
    this.db.paymentSessions.set(orderId, sessionRecord);

    // 3. Audit log & save
    if (this.db.createAuditLog) {
      this.db.createAuditLog({
        adminId: customerId || 'CUSTOMER_CHECKOUT',
        adminName: 'Simulated Payment Checkout',
        role: 'CUSTOMER',
        action: 'PAYMENT_SESSION_CREATED',
        module: 'PAYMENTS',
        targetEntityType: 'PAYMENT_ORDER',
        targetEntityId: orderId,
        previousState: 'NONE',
        newState: 'PAYMENT_PENDING',
        reason: `Created simulated payment order for ${serviceType} (PAYMENT_MODE=${paymentMode || 'unset'}, no gateway contacted). Amount: ₹${numAmount}`
      });
    }

    if (this.db.save) this.db.save();
    return sessionRecord;
  }

  /**
   * 2. Query Payment Session by Order ID
   */
  async getPaymentSession(orderId) {
    if (!orderId) return null;

    if (isLivePostgres && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
          .from('payment_sessions')
          .select('*')
          .eq('order_id', orderId)
          .maybeSingle();

        if (!error && data) {
          const mapped = {
            id: data.id,
            orderId: data.order_id,
            customerId: data.customer_id || data.metadata?.callerCustomerId || 'usr_cust_anon',
            customer_id: data.customer_id,
            amount: Number(data.amount),
            currency: data.currency,
            serviceType: data.service_type,
            service_type: data.service_type,
            status: data.status === 'INITIATED' || data.status === 'PENDING'
              ? 'PAYMENT_PENDING'
              : (data.status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : (data.status === 'FAILED' ? 'PAYMENT_FAILED' : (data.status === 'CANCELLED' ? 'PAYMENT_CANCELLED' : data.status))),
            dbStatus: data.status,
            provider: data.provider,
            keyId: data.key_id,
            jobId: data.job_id,
            metadata: data.metadata || {},
            failureReason: data.failure_reason,
            createdAt: data.created_at,
            updatedAt: data.updated_at
          };
          if (!this.db.paymentSessions) this.db.paymentSessions = new Map();
          this.db.paymentSessions.set(orderId, mapped);
          return mapped;
        }
      } catch (e) {
        console.error('⚠️ [PaymentRepository.getPaymentSession] DB error:', e.message);
      }
    }

    // In-memory fallback
    // Owner Decision 11 (choice B, docs/OWNER_SECURITY_DECISIONS.md): when
    // PostgreSQL is unreachable a hydrated payment session keeps answering from
    // memory rather than failing closed with a 503. This cache fallback is the
    // accepted outage semantics — do NOT convert it to a 503 without a new owner
    // order. backend/hydration_fallback_test.js (HYD-01/02) locks this in.
    return this.db.paymentSessions ? this.db.paymentSessions.get(orderId) : null;
  }

  /**
   * 3. Authoritative Atomic Payment Capture via Migration 006 RPC capture_payment_atomic
   */
  async capturePaymentAtomic({
    orderId,
    paymentId,
    customerId = null,
    serviceType = null,
    method = 'UPI',
    signatureValid = true,
    provider = 'RAZORPAY_SANDBOX',
    webhookEventId = null,
    declaredAmount = null
  }) {
    if (!orderId) {
      return { success: false, code: 'INVALID_ORDER_ID', error: 'Order ID is required' };
    }

    const normMethod = ALLOWED_PAYMENT_METHODS.includes(method) ? method : 'UPI';
    let customerUuid = this.resolveCustomerUuid(customerId);
    if (customerId && !customerUuid) {
      customerUuid = '00000000-0000-0000-0000-000000000000';
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('capture_payment_atomic', {
        p_order_id: orderId,
        p_payment_id: paymentId,
        p_customer: customerUuid,
        p_service: serviceType || null,
        p_method: normMethod,
        p_signature_valid: Boolean(signatureValid),
        p_provider: provider || 'RAZORPAY_SANDBOX',
        p_webhook_event_id: webhookEventId || null,
        p_declared_amount: declaredAmount !== null ? Number(declaredAmount) : null
      });

      if (error) {
        // A rejected capture is the store's sentence about itself, not the customer's bug.
        // Wrapping it in a plain Error used to strip the engine code, so an unreachable database
        // reached the route as a codeless Error and was answered 400 — a client-error report of
        // a server outage.
        throw storeFailure('payment capture', error);
      }

      if (data && data.success) {
        // Sync in-memory cache
        if (this.db.paymentSessions) {
          const cached = this.db.paymentSessions.get(orderId);
          if (cached) {
            cached.status = 'PAYMENT_SUCCESS';
            cached.paymentId = paymentId;
            cached.updatedAt = new Date().toISOString();
          }
        }
        if (data.jobId && this.db.getJob) {
          const job = this.db.getJob(data.jobId);
          if (job) {
            job.paymentStatus = 'PAID';
            job.paymentId = paymentId;
          }
        }
        if (paymentId && this.db.processedPaymentIds) {
          this.db.processedPaymentIds.add(paymentId);
        }
        if (webhookEventId && this.db.processedWebhookIds) {
          this.db.processedWebhookIds.add(webhookEventId);
        }
        if (this.db.recordLedgerEntry && !data.duplicate) {
          // Awaited: an un-awaited call here used to mean a rejected journal posting became an
          // unhandled rejection with no trace, and a store outage was invisible to the caller.
          await this.db.recordLedgerEntry({
            transactionId: paymentId,
            debitAccount: 'PAYMENT_GATEWAY_ESCROW',
            creditAccount: (serviceType === 'FOOD' || data.serviceType === 'FOOD' || data.serviceType === 'GROCERY') ? 'MERCHANT_PAYABLE' : 'CUSTOMER_WALLET_LIABILITY',
            amount: Number(data.amount),
            description: `Atomic payment capture [${paymentId}]`,
            referenceId: orderId
          });
        }
        if (this.db.save) this.db.save();
      }

      return data;
    }

    // In-memory fallback (when Postgres is offline)
    const session = this.db.paymentSessions ? this.db.paymentSessions.get(orderId) : null;
    if (!session) {
      return { success: false, code: 'SESSION_NOT_FOUND', orderId };
    }
    if (session.status === 'PAYMENT_SUCCESS') {
      return { success: true, duplicate: true, orderId };
    }
    if (['PAYMENT_FAILED', 'PAYMENT_CANCELLED'].includes(session.status)) {
      return { success: false, code: 'SESSION_NOT_PAYABLE', status: session.status };
    }
    if (declaredAmount !== null && Number(declaredAmount) !== Number(session.amount)) {
      return { success: false, code: 'AMOUNT_MISMATCH', expected: session.amount, received: declaredAmount };
    }

    session.status = 'PAYMENT_SUCCESS';
    session.paymentId = paymentId;
    session.updatedAt = new Date().toISOString();

    if (session.jobId && this.db.getJob) {
      const job = this.db.getJob(session.jobId);
      if (job) {
        job.paymentStatus = 'PAID';
        job.paymentId = paymentId;
      }
    }

    await this.db.recordLedgerEntry({
      transactionId: paymentId,
      debitAccount: 'PAYMENT_GATEWAY_ESCROW',
      creditAccount: session.serviceType === 'FOOD' ? 'RESTAURANT_SETTLEMENT_ESCROW' : 'CUSTOMER_WALLET_LIABILITY',
      amount: session.amount,
      description: `Payment checkout verified [${session.serviceType}]: ${paymentId}`,
      referenceId: orderId
    });

    if (this.db.save) this.db.save();
    return {
      success: true,
      duplicate: false,
      orderId,
      paymentId,
      amount: session.amount,
      jobId: session.jobId,
      serviceType: session.serviceType
    };
  }

  /**
   * 4. Verify Payment Session (Client-Side Checkout Modal Completion)
   * Enforces cryptographic HMAC signature and atomic capture.
   */
  async verifyPaymentSession({ orderId, paymentId, signature, customerId = null, status = 'SUCCESS', failureReason = null }) {
    const session = await this.getPaymentSession(orderId);
    if (!session) {
      const err = new Error(`Payment session [${orderId}] not found in database.`);
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    // Enforce customer ownership — on both sides, because two branches below (the client-reported
    // FAILED and CANCELLED ones) write this row's durable status and require NO gateway signature,
    // so this comparison is the only thing between one customer's checkout and somebody else's pen.
    // It used to run only `if (callerUuid && sessionUuid && callerUuid !== sessionUuid)`, which
    // vanished whenever EITHER side failed to resolve: `resolveCustomerUuid` answers null for a
    // handle that is neither a uuid nor a mapped account, and `payment_sessions.customer_id` is
    // NULLABLE. Measured 2026-10-18 before the fix (`payment_verify_ownership_test.js`, 20/25): a
    // persisted session row whose `entity_id` named no account still passed the bearer gate because
    // its phone matched an active customer, and it moved ANOTHER customer's INITIATED session to
    // FAILED carrying the caller's own `failureReason` text; a row with `customer_id IS NULL` was
    // flipped the same way by any signed-in customer, and left an `audit_logs` row naming
    // `usr_cust_anon` — a person who does not exist — as the actor. Third measured instance of the
    // same shape (MI-1 read half of this record, MI-7 support thread), which is why both halves are
    // pinned: ownership that cannot be resolved is not ownership, so both sides must resolve AND agree.
    const callerUuid = this.resolveCustomerUuid(customerId);
    const sessionUuid = this.resolveCustomerUuid(session.customerId || session.customer_id);
    if (!callerUuid || !sessionUuid) {
      const err = new Error('This payment session has no verifiable owner, so its status cannot be reported.');
      err.statusCode = 403;
      err.code = 'SESSION_OWNER_UNRESOLVED';
      throw err;
    }
    if (callerUuid !== sessionUuid) {
      const err = new Error('Customer does not own payment session.');
      err.statusCode = 403;
      err.code = 'CUSTOMER_MISMATCH';
      throw err;
    }

    // Idempotency: Already verified?
    if (session.status === 'PAYMENT_SUCCESS' || session.dbStatus === 'SUCCESS') {
      return { success: true, session, message: 'Payment already verified (Idempotent bypass)', duplicate: true, status: 'PAYMENT_SUCCESS' };
    }

    // Cannot verify an already failed/cancelled session
    if (['PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(session.dbStatus || session.status)) {
      const err = new Error(`Payment session is no longer payable (status: ${session.dbStatus || session.status}).`);
      err.statusCode = 400;
      err.code = 'SESSION_NOT_PAYABLE';
      throw err;
    }

    // Handle Client-Reported FAILED
    if (status === 'FAILED') {
      session.status = 'PAYMENT_FAILED';
      session.failureReason = failureReason || 'Payment declined by card issuer.';
      session.updatedAt = new Date().toISOString();

      if (isLivePostgres && supabaseAdmin) {
        await supabaseAdmin
          .from('payment_sessions')
          .update({ status: 'FAILED', failure_reason: session.failureReason, updated_at: new Date().toISOString() })
          .eq('order_id', orderId);
      }

      if (session.jobId && this.db.getJob) {
        const job = this.db.getJob(session.jobId);
        if (job) job.paymentStatus = 'PAYMENT_FAILED';
      }

      if (this.db.createAuditLog) {
        this.db.createAuditLog({
          adminId: session.customerId,
          adminName: 'Payment Gateway Engine',
          role: 'SYSTEM',
          action: 'PAYMENT_CHECKOUT_FAILED',
          module: 'PAYMENTS',
          targetEntityType: 'PAYMENT_ORDER',
          targetEntityId: orderId,
          previousState: 'PAYMENT_PENDING',
          newState: 'PAYMENT_FAILED',
          reason: session.failureReason
        });
      }

      if (this.db.save) this.db.save();
      return { success: false, session, error: session.failureReason };
    }

    // Handle Client-Reported CANCELLED
    if (status === 'CANCELLED') {
      session.status = 'PAYMENT_CANCELLED';
      session.failureReason = 'Payment session cancelled by user.';
      session.updatedAt = new Date().toISOString();

      if (isLivePostgres && supabaseAdmin) {
        await supabaseAdmin
          .from('payment_sessions')
          .update({ status: 'CANCELLED', failure_reason: session.failureReason, updated_at: new Date().toISOString() })
          .eq('order_id', orderId);
      }

      if (session.jobId && this.db.getJob) {
        const job = this.db.getJob(session.jobId);
        if (job) job.paymentStatus = 'PAYMENT_CANCELLED';
      }

      if (this.db.createAuditLog) {
        this.db.createAuditLog({
          adminId: session.customerId,
          adminName: 'Payment Gateway Engine',
          role: 'CUSTOMER',
          action: 'PAYMENT_CHECKOUT_CANCELLED',
          module: 'PAYMENTS',
          targetEntityType: 'PAYMENT_ORDER',
          targetEntityId: orderId,
          previousState: 'PAYMENT_PENDING',
          newState: 'PAYMENT_CANCELLED',
          reason: 'User dismissed payment modal.'
        });
      }

      if (this.db.save) this.db.save();
      return { success: false, session, error: 'Payment cancelled.' };
    }

    // Handle SUCCESS: Cryptographic HMAC Signature Verification
    // The key is read from the environment and nowhere else. It used to fall back to a
    // value written in this file whenever NODE_ENV was anything but 'production' — so
    // the sandbox, beta and a developer laptop all verified "this ride is paid for"
    // against a secret any reader of the repository could sign with, and a client could
    // mark a trip paid without money moving.
    const paymentSecret = process.env.PAYMENT_KEY_SECRET;
    if (!paymentSecret) {
      // 503, not 400: the server is the thing that cannot verify, and answering
      // INVALID_SIGNATURE would blame the customer's payment for the operator's missing
      // configuration.
      const err = new Error('This server cannot verify a payment right now, because the payment key secret is not configured.');
      err.statusCode = 503;
      err.code = 'PAYMENT_VERIFIER_UNCONFIGURED';
      throw err;
    }

    const verificationPayload = `${orderId}|${paymentId}`;
    const expectedSignature = crypto.createHmac('sha256', paymentSecret).update(verificationPayload).digest('hex');

    const suppliedSignature = Buffer.from(signature || '', 'utf8');
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

    if (
      suppliedSignature.length !== expectedSignatureBuffer.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignatureBuffer)
    ) {
      const err = new Error('Payment signature verification failed.');
      err.statusCode = 400;
      err.code = 'INVALID_SIGNATURE';
      throw err;
    }

    // Signature verified! Atomically capture in PostgreSQL
    const resolvedPaymentId = paymentId || `pay_rzp_${Date.now()}`;
    const captureResult = await this.capturePaymentAtomic({
      orderId,
      paymentId: resolvedPaymentId,
      customerId: session.customer_id || session.customerId,
      serviceType: session.serviceType || 'RIDE',
      method: 'UPI',
      signatureValid: true,
      provider: session.provider || 'RAZORPAY_SANDBOX',
      declaredAmount: session.amount
    });

    if (!captureResult.success) {
      const err = new Error(captureResult.error || `Payment capture failed: ${captureResult.code}`);
      err.statusCode = 400;
      err.code = captureResult.code;
      throw err;
    }

    session.status = 'PAYMENT_SUCCESS';
    session.paymentId = resolvedPaymentId;
    session.signature = signature;
    session.updatedAt = new Date().toISOString();

    if (this.db.createAuditLog) {
      this.db.createAuditLog({
        adminId: session.customerId,
        adminName: 'Payment Gateway Engine',
        role: 'SYSTEM',
        action: 'PAYMENT_CHECKOUT_VERIFIED',
        module: 'PAYMENTS',
        targetEntityType: 'PAYMENT_ORDER',
        targetEntityId: orderId,
        previousState: 'PAYMENT_PENDING',
        newState: 'PAYMENT_SUCCESS',
        reason: `Payment verified authoritatively for ${session.serviceType}. Amount: ₹${session.amount}`
      });
    }

    if (this.db.save) this.db.save();
    return {
      success: true,
      session,
      status: 'PAYMENT_SUCCESS',
      duplicate: captureResult.duplicate
    };
  }

  /**
   * 5. Record Webhook Event (Server-to-Server)
   * Enforces HMAC-SHA256 signature, idempotency, and atomic capture.
   */
  async recordPaymentWebhook({ eventId, eventType, paymentId, orderId = null, amount, status, signature, payload = {}, rawBody = null }) {
    if (!eventId) {
      const err = new Error('Event ID is required for idempotent webhook processing.');
      err.statusCode = 400;
      err.code = 'MISSING_EVENT_ID';
      throw err;
    }

    // 1. Idempotency Check in Memory
    if (this.isProcessed(eventId)) {
      return { success: true, message: 'Webhook already processed (Idempotent bypass)', duplicate: true };
    }

    // 2. Idempotency Check in PostgreSQL payment_webhooks
    if (isLivePostgres && supabaseAdmin) {
      try {
        const { data: existingWh } = await supabaseAdmin
          .from('payment_webhooks')
          .select('id, event_id, status')
          .eq('event_id', eventId)
          .maybeSingle();

        if (existingWh) {
          if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);
          return { success: true, message: 'Webhook already processed (Idempotent bypass)', duplicate: true };
        }
      } catch (e) {
        console.warn('⚠️ [PaymentRepository.recordPaymentWebhook] Event lookup error:', e.message);
      }
    }

    // Resolve nested entities (supports Razorpay webhook payload format or flat test payloads)
    const nestedPayload = payload?.payload || payload || {};
    const paymentEntity = nestedPayload?.payment?.entity || nestedPayload?.payment || payload?.payment?.entity || payload?.payment || payload || {};
    const refundEntity = nestedPayload?.refund?.entity || nestedPayload?.refund || payload?.refund?.entity || payload?.refund || {};

    // 3. Process by Event Type
    const isRefund = eventType === 'refund.processed' || eventType === 'refund.created';

    if (isRefund) {
      const refundTarget = refundEntity.payment_id || paymentId || payload?.payment_id;
      const refundAmt = refundEntity.amount
        ? (refundEntity.amount > 100 && Number.isInteger(refundEntity.amount) ? refundEntity.amount / 100 : refundEntity.amount)
        : amount;

      // In-memory dev fallback (Postgres offline): there is no atomic store to consult, so
      // recordStandaloneWebhook is the refund authority. This is the mock path only — never the
      // production money path, which is the live branch below.
      if (!(isLivePostgres && supabaseAdmin)) {
        await this.recordStandaloneWebhook({
          eventId,
          eventType,
          paymentId: refundTarget || paymentId,
          amount: refundAmt,
          status: status || 'REFUNDED',
          signature,
          payload
        });
        if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);
        return { success: true, duplicate: false, message: 'Refund webhook processed' };
      }

      // refund_payment_atomic (migrations/006_payments_domain.sql:223-309) is the sole authority for a
      // durable refund: under a FOR UPDATE lock it claims the event id, writes the payment_webhooks row
      // AND the DISPUTE_REFUND ledger entry, and flips payments/jobs to REFUNDED — or refuses with
      // {success:false, code} and writes NOTHING under this event id. Its verdict, not the payload's
      // say-so, decides the response. The previous code awaited it, discarded the result, then journaled
      // a refund and answered 200 regardless — so a refund the store refused booked ledger money that
      // never moved and consumed the event id, dropping a corrected delivery as a duplicate.
      if (!refundTarget) {
        // A refund event that names no payment. Refusing leaves the event unclaimed for a corrected
        // delivery; journaling it would claim REFUNDED for a reversal of money that cannot be located.
        return {
          success: false,
          code: 'REFUND_TARGET_MISSING',
          error: 'Refund event carried no payment reference.',
          duplicate: false
        };
      }

      // refundPaymentAtomic throws storeFailure when the store rejects the call. An outage is not a
      // refused refund, so it propagates here rather than being swallowed: the route answers a
      // retryable 503 and the event stays unclaimed until the gateway redelivers.
      const verdict = await this.refundPaymentAtomic({
        orderOrPayment: refundTarget,
        refundEventId: eventId,
        reason: 'Webhook refund notification',
        authorizedBy: 'GATEWAY_WEBHOOK',
        provider: 'RAZORPAY',
        declaredAmount: refundAmt
      });

      if (!verdict || verdict.success !== true) {
        // PAYMENT_NOT_FOUND / INVALID_STATE / REFUND_AMOUNT_MISMATCH: the RPC journaled nothing under
        // this event id, so nothing here may either — no webhook row, no ledger entry, event left
        // replayable. The refusal is returned typed so the route reports it truthfully.
        const refusal = {
          success: false,
          code: (verdict && verdict.code) || 'REFUND_FAILED',
          error: (verdict && verdict.error) || `Refund refused by the payment store (${(verdict && verdict.code) || 'UNKNOWN'}).`,
          duplicate: false
        };
        if (verdict && verdict.expected !== undefined) {
          refusal.expected = verdict.expected;
          refusal.received = verdict.received;
        }
        return refusal;
      }

      // Granted (or already a duplicate): the RPC did the journaling and the claim, so this path books
      // no money and re-claims nothing — only reports what the store actually did.
      if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);
      return {
        success: true,
        duplicate: Boolean(verdict.duplicate),
        paymentId: verdict.paymentId || refundTarget,
        amount: verdict.refundedAmount !== undefined ? Number(verdict.refundedAmount) : refundAmt,
        message: verdict.duplicate ? 'Refund already processed' : 'Refund webhook processed'
      };
    }

    // Check if this is a payment failure event
    const isFailed = eventType === 'payment.failed' || status === 'FAILED';
    const resolvedOrderId = orderId || paymentEntity.order_id || paymentEntity.orderId || payload?.order_id || payload?.orderId || null;
    const resolvedPaymentId = paymentEntity.id || paymentId || `pay_wh_${Date.now()}`;
    let declaredAmt = null;
    if (amount !== undefined && amount !== null) {
      declaredAmt = Number(amount);
    } else if (paymentEntity.amount !== undefined) {
      declaredAmt = paymentEntity.amount > 100 && Number.isInteger(paymentEntity.amount) ? paymentEntity.amount / 100 : Number(paymentEntity.amount);
    }
    const declaredCustomer = payload?.customer_id || payload?.customerId || paymentEntity.notes?.customerId || payload?.notes?.customerId || null;
    const failureReason = paymentEntity.error_description || payload?.error_description || 'Payment failed at gateway';

    if (isFailed) {
      if (resolvedOrderId) {
        if (isLivePostgres && supabaseAdmin) {
          try {
            await supabaseAdmin
              .from('payment_sessions')
              .update({
                status: 'FAILED',
                failure_reason: failureReason,
                updated_at: new Date().toISOString()
              })
              .eq('order_id', resolvedOrderId)
              .neq('status', 'SUCCESS');
          } catch (e) {
            console.warn('⚠️ [PaymentRepository.recordPaymentWebhook] DB error updating failed session:', e.message);
          }
        }
        if (this.db.paymentSessions) {
          const cached = this.db.paymentSessions.get(resolvedOrderId);
          if (cached && cached.status !== 'PAYMENT_SUCCESS') {
            cached.status = 'PAYMENT_FAILED';
            cached.failureReason = failureReason;
          }
        }
      }

      // Record failed webhook in payment_webhooks WITHOUT ledger mutation
      if (isLivePostgres && supabaseAdmin) {
        try {
          await supabaseAdmin.from('payment_webhooks').insert({
            event_id: eventId,
            event_type: eventType,
            provider: 'RAZORPAY',
            amount: declaredAmt || 0,
            status: 'FAILED',
            payload: payload || {},
            is_processed: true,
            payment_id: resolvedPaymentId,
            signature_valid: true
          });
        } catch (dbErr) {
          console.warn('⚠️ [PaymentRepository.recordPaymentWebhook] DB error:', dbErr.message);
        }
      }

      if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);

      if (this.db.createAuditLog) {
        this.db.createAuditLog({
          adminId: 'PAYMENT_GATEWAY',
          adminName: 'Razorpay Webhook Engine',
          role: 'SYSTEM',
          action: 'PAYMENT_WEBHOOK_FAILED',
          module: 'PAYMENTS',
          targetEntityType: 'PAYMENT_TRANSACTION',
          targetEntityId: resolvedPaymentId || eventId,
          previousState: 'PENDING',
          newState: 'FAILED',
          reason: `Payment failure webhook processed: ${payload?.payment?.entity?.error_description || payload?.error_description || 'Declined'}`
        });
      }

      if (this.db.save) this.db.save();

      return {
        success: false,
        code: 'PAYMENT_FAILED',
        status: 'FAILED',
        orderId: resolvedOrderId,
        paymentId: resolvedPaymentId,
        message: 'Payment failure webhook recorded'
      };
    }

    if (resolvedOrderId) {
      // Connect to authoritative capture_payment_atomic
      const captureResult = await this.capturePaymentAtomic({
        orderId: resolvedOrderId,
        paymentId: resolvedPaymentId,
        customerId: declaredCustomer,
        declaredAmount: declaredAmt,
        webhookEventId: eventId,
        signatureValid: true,
        provider: 'RAZORPAY'
      });

      if (!captureResult.success && !captureResult.duplicate) {
        return captureResult;
      }

      if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);
      return {
        success: true,
        duplicate: captureResult.duplicate,
        orderId,
        paymentId: resolvedPaymentId,
        amount: captureResult.amount || declaredAmt
      };
    }

    // Standalone Webhook Recording (Fallback when no orderId attached, e.g. generic test payloads)
    return await this.recordStandaloneWebhook({
      eventId,
      eventType,
      paymentId: resolvedPaymentId,
      amount: declaredAmt || 0,
      status: status || 'CAPTURED',
      signature,
      payload
    });
  }

  /**
   * Helper: Record Standalone Webhook and Ledger Entry
   */
  async recordStandaloneWebhook({ eventId, eventType, paymentId, amount, status, signature, payload }) {
    const isRefund = eventType === 'refund.processed' || eventType === 'refund.created';
    const isFailedStatus = status === 'FAILED' || eventType === 'payment.failed';
    const numAmount = Number(amount) || 0;

    // Claim the event id in the store BEFORE anything money-shaped happens.
    // `payment_webhooks.event_id` is UNIQUE (migrations/001_central_schema.sql:211) so the second
    // delivery of one event loses that race — which is the whole point of the row. supabase-js
    // resolves a PostgreSQL refusal as `{data, error}` instead of rejecting, so the previous
    // `try { await insert } catch { warn }` discarded the 23505 and then booked the ledger
    // anyway: two concurrent deliveries, two identical ESCROW -> WALLET entries. The sibling SQL
    // primitive already claims first and returns duplicate to the loser
    // (refund_payment_atomic, migrations/006_payments_domain.sql:217-219, 272-274); this mirrors it.
    // A refusal that is not a collision is not a duplicate either — it is "the event was not
    // recorded", so nothing moves and the gateway retries.
    let claimed = true;
    if (isLivePostgres && supabaseAdmin) {
      let error;
      try {
        ({ error } = await supabaseAdmin.from('payment_webhooks').insert({
          event_id: eventId,
          event_type: eventType || 'payment.captured',
          provider: 'RAZORPAY',
          amount: numAmount,
          status: status || 'CAPTURED',
          payload: payload || {},
          is_processed: true,
          payment_id: paymentId,
          signature_valid: true
        }));
      } catch (dbErr) {
        throw storeFailure('payment webhook event', dbErr);
      }

      if (error) {
        if (error.code === '23505') claimed = false;
        else throw storeFailure('payment webhook event', error);
      }
    }

    if (!claimed) {
      if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);
      return {
        success: true,
        duplicate: true,
        message: 'Webhook already processed (idempotent claim held by the earlier event row)',
        eventId,
        paymentId
      };
    }

    if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);

    // Record double-entry ledger entry ONLY if not failed and amount > 0
    if (!isFailedStatus && numAmount > 0) {
      await this.db.recordLedgerEntry({
        transactionId: paymentId || eventId,
        debitAccount: isRefund ? 'CUSTOMER_WALLET_LIABILITY' : 'PAYMENT_GATEWAY_ESCROW',
        creditAccount: isRefund ? 'PAYMENT_GATEWAY_ESCROW' : 'CUSTOMER_WALLET_LIABILITY',
        amount: numAmount,
        description: `Payment ${isRefund ? 'refund' : 'captured'} via Webhook [${eventType}]: ${paymentId}`,
        referenceId: eventId
      });
    }

    if (this.db.createAuditLog) {
      this.db.createAuditLog({
        adminId: 'PAYMENT_GATEWAY',
        adminName: 'Razorpay Webhook Engine',
        role: 'SYSTEM',
        action: 'PAYMENT_WEBHOOK_PROCESSED',
        module: 'PAYMENTS',
        targetEntityType: 'PAYMENT_TRANSACTION',
        targetEntityId: paymentId || eventId,
        previousState: 'PENDING',
        newState: status || 'CAPTURED',
        reason: `Webhook ${eventId} verified & processed. Amount: ₹${numAmount}`
      });
    }

    if (this.db.save) this.db.save();
    return {
      success: true,
      duplicate: false,
      record: {
        id: `WH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        eventId,
        eventType,
        paymentId,
        amount: numAmount,
        status: status || 'CAPTURED',
        signatureValid: true,
        timestamp: new Date().toISOString(),
        payload
      }
    };
  }

  /**
   * 6. Atomic Refund via Migration 006 RPC refund_payment_atomic
   */
  async refundPaymentAtomic({
    orderOrPayment,
    refundEventId,
    reason,
    authorizedBy,
    provider = 'RAZORPAY_SANDBOX',
    declaredAmount = null,
    ticketId = null
  }) {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('refund_payment_atomic', {
        p_order_or_payment: orderOrPayment,
        p_refund_event_id: refundEventId,
        p_reason: reason || null,
        p_authorized_by: authorizedBy || 'SUPPORT_AGENT',
        p_provider: provider || 'RAZORPAY_SANDBOX',
        p_declared_amount: declaredAmount !== null ? Number(declaredAmount) : null,
        p_ticket_id: ticketId || null
      });

      if (error) {
        // An unreachable store is not a refused refund. A codeless Error was caught by the webhook
        // caller as a warning and answered 200, telling the gateway a refund landed when the database
        // never answered at all. Mark it the way the capture sibling does (this file, capturePaymentAtomic)
        // so the route's classifier gives it a retryable 503 instead.
        throw storeFailure('payment refund', error);
      }
      return data;
    }
    return { success: false, error: 'Database unavailable' };
  }

  /**
   * 7. In-Memory Legacy Payment Record
   */
  recordPayment({ paymentId, idempotencyKey, jobId, customerId, amount, status = 'CAPTURED', method = 'WALLET' }) {
    if (this.isProcessed(paymentId) || (idempotencyKey && this.isProcessed(idempotencyKey))) {
      return { duplicate: true, paymentId };
    }

    if (paymentId && this.db.processedPaymentIds) this.db.processedPaymentIds.add(paymentId);
    if (idempotencyKey && this.db.processedPaymentIds) this.db.processedPaymentIds.add(idempotencyKey);

    const paymentRecord = {
      paymentId: paymentId || `pay_${Date.now()}`,
      idempotencyKey,
      jobId,
      customerId,
      amount: Number(amount),
      method,
      status,
      createdAt: new Date().toISOString()
    };

    if (this.db.save) this.db.save();
    return { success: true, payment: paymentRecord, duplicate: false };
  }
}

module.exports = PaymentRepository;
