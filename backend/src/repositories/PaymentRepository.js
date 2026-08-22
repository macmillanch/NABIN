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
}

module.exports = PaymentRepository;
