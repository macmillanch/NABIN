class PaymentRepository {
  constructor(db) {
    this.db = db;
  }

  isProcessed(paymentIdOrEventId) {
    return this.db.processedPaymentIds.has(paymentIdOrEventId) || this.db.processedWebhookIds.has(paymentIdOrEventId);
  }

  recordPayment({ paymentId, idempotencyKey, jobId, customerId, amount, status = 'CAPTURED', method = 'WALLET' }) {
    if (this.isProcessed(paymentId) || (idempotencyKey && this.isProcessed(idempotencyKey))) {
      return { duplicate: true, paymentId };
    }

    if (paymentId) this.db.processedPaymentIds.add(paymentId);
    if (idempotencyKey) this.db.processedPaymentIds.add(idempotencyKey);

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

    this.db.save();
    return { success: true, payment: paymentRecord, duplicate: false };
  }

  async refundPaymentAtomic({
    orderOrPayment,
    refundEventId,
    reason,
    authorizedBy,
    provider = 'RAZORPAY_SANDBOX',
    declaredAmount = null,
    ticketId = null
  }) {
    const { supabaseAdmin, isLivePostgres } = require('../supabase');
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
}

module.exports = PaymentRepository;
