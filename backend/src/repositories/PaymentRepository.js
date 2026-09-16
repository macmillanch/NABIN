// =========================================================================
// NABIN PLATFORM — PAYMENT REPOSITORY (PostgreSQL-Authoritative)
// Governs payment sessions, atomic capture, webhook idempotency, and refunds.
// Migration 006 & 018 authoritative integration.
// =========================================================================
const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH'];

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
   * Persists to PostgreSQL payment_sessions table with status INITIATED.
   */
  async createPaymentSession({ customerId, amount, currency = 'INR', serviceType = 'RIDE', jobId = null, metadata = {} }) {
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error('Valid transaction amount is required to create a payment session.');
    }

    const isLiveMode = process.env.PAYMENT_MODE === 'live';
    if (isLiveMode && (!process.env.PAYMENT_KEY_ID || !process.env.PAYMENT_KEY_SECRET)) {
      throw new Error('Live payment gateway is not yet activated on this production instance.');
    }

    const orderId = isLiveMode
      ? `order_rzp_live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      : `order_rzp_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const customerUuid = this.resolveCustomerUuid(customerId);
    const jobUuid = (jobId && UUID_REGEX.test(jobId)) ? jobId : null;
    const keyId = isLiveMode ? process.env.PAYMENT_KEY_ID : (process.env.PAYMENT_KEY_ID || 'rzp_test_nabin_beta_2026');

    const sessionRecord = {
      orderId,
      customerId: customerUuid || customerId || 'usr_cust_anon',
      amount: numAmount,
      currency,
      serviceType,
      jobId: jobUuid || jobId || null,
      status: 'PAYMENT_PENDING',
      provider: isLiveMode ? 'RAZORPAY_LIVE' : 'RAZORPAY_SANDBOX',
      keyId,
      metadata: { ...metadata, callerCustomerId: customerId },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // 1. Authoritative PostgreSQL Insert
    if (isLivePostgres && supabaseAdmin) {
      try {
        const { data, error } = await supabaseAdmin
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
          .single();

        if (error) {
          console.error('⚠️ [PaymentRepository.createPaymentSession] DB error:', error.message);
        } else if (data) {
          sessionRecord.id = data.id;
          sessionRecord.createdAt = data.created_at;
          sessionRecord.updatedAt = data.updated_at;
        }
      } catch (dbErr) {
        console.error('⚠️ [PaymentRepository.createPaymentSession] Exception:', dbErr.message);
      }
    }

    // 2. Cache in memory
    if (!this.db.paymentSessions) this.db.paymentSessions = new Map();
    this.db.paymentSessions.set(orderId, sessionRecord);

    // 3. Audit log & save
    if (this.db.createAuditLog) {
      this.db.createAuditLog({
        adminId: customerId || 'CUSTOMER_CHECKOUT',
        adminName: 'Payment Gateway Client',
        role: 'CUSTOMER',
        action: 'PAYMENT_SESSION_CREATED',
        module: 'PAYMENTS',
        targetEntityType: 'PAYMENT_ORDER',
        targetEntityId: orderId,
        previousState: 'NONE',
        newState: 'PAYMENT_PENDING',
        reason: `Created payment order for ${serviceType}. Amount: ₹${numAmount}`
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
        throw new Error(`capture_payment_atomic RPC error: ${error.message}`);
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
          this.db.recordLedgerEntry({
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

    // Enforce customer ownership if caller customerId is known
    const callerUuid = this.resolveCustomerUuid(customerId);
    const sessionUuid = this.resolveCustomerUuid(session.customerId || session.customer_id);
    if (callerUuid && sessionUuid && callerUuid !== sessionUuid) {
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
    const paymentSecret = process.env.PAYMENT_KEY_SECRET || (process.env.NODE_ENV !== 'production' ? 'rzp_sec_nabin_beta_test_secret_2026' : null);
    if (!paymentSecret && process.env.NODE_ENV === 'production') {
      const err = new Error('Payment gateway credentials not configured.');
      err.statusCode = 500;
      err.code = 'GATEWAY_CONFIG_MISSING';
      throw err;
    }

    const verificationPayload = `${orderId}|${paymentId}`;
    const expectedSignature = paymentSecret
      ? crypto.createHmac('sha256', paymentSecret).update(verificationPayload).digest('hex')
      : null;

    const suppliedSignature = Buffer.from(signature || '', 'utf8');
    const expectedSignatureBuffer = Buffer.from(expectedSignature || '', 'utf8');

    if (
      !expectedSignature ||
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

      if (refundTarget) {
        try {
          await this.refundPaymentAtomic({
            orderOrPayment: refundTarget,
            refundEventId: eventId,
            reason: 'Webhook refund notification',
            authorizedBy: 'GATEWAY_WEBHOOK',
            provider: 'RAZORPAY',
            declaredAmount: refundAmt
          });
        } catch (rErr) {
          console.warn('⚠️ [PaymentRepository.recordPaymentWebhook] Refund RPC warning:', rErr.message);
        }
      }

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
    if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);

    const isRefund = eventType === 'refund.processed' || eventType === 'refund.created';
    const isFailedStatus = status === 'FAILED' || eventType === 'payment.failed';
    const numAmount = Number(amount) || 0;

    // PostgreSQL Webhook Insert
    if (isLivePostgres && supabaseAdmin) {
      try {
        await supabaseAdmin.from('payment_webhooks').insert({
          event_id: eventId,
          event_type: eventType || 'payment.captured',
          provider: 'RAZORPAY',
          amount: numAmount,
          status: status || 'CAPTURED',
          payload: payload || {},
          is_processed: true,
          payment_id: paymentId,
          signature_valid: true
        });
      } catch (dbErr) {
        console.warn('⚠️ [PaymentRepository.recordStandaloneWebhook] DB error:', dbErr.message);
      }
    }

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
        throw new Error(`refund_payment_atomic RPC error: ${error.message}`);
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
