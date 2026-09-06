const EventEmitter = require('events');

const NOTIFICATION_EVENTS = Object.freeze({
  JOB_ACCEPTED: 'job:accepted',
  JOB_DISPATCHED: 'job:dispatched',
  DRIVER_ARRIVED: 'driver:arrived',
  RIDE_STARTED: 'ride:started',
  RIDE_COMPLETED: 'ride:completed',
  JOB_CANCELLED: 'job:cancelled',
  PAYOUT_SETTLED: 'payout:settled',
  REFUND_PROCESSED: 'refund:processed',
  KYC_APPROVED: 'kyc:approved',
  KYC_REJECTED: 'kyc:rejected',
  VPA_VERIFIED: 'vpa:verified'
});

/**
 * Deterministic Event Key Generator
 * Guarantees idempotency matching Migration 012 UNIQUE(event_key) index.
 */
function createEventKey(eventType, entityId, targetId = null) {
  if (!eventType || !entityId) {
    throw new Error('Event type and primary entity ID are required to generate deterministic event key.');
  }

  const cleanType = eventType.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanEntityId = String(entityId).trim();
  const cleanTargetId = targetId ? `:${String(targetId).trim()}` : '';

  switch (eventType) {
    case NOTIFICATION_EVENTS.JOB_ACCEPTED:
    case 'JOB_ACCEPTED':
      return `job_accepted:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.JOB_DISPATCHED:
    case 'JOB_DISPATCHED':
      return `job_dispatch:${cleanEntityId}${cleanTargetId}`;

    case NOTIFICATION_EVENTS.DRIVER_ARRIVED:
    case 'DRIVER_ARRIVED':
      return `driver_arrived:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.RIDE_STARTED:
    case 'RIDE_STARTED':
      return `ride_started:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.RIDE_COMPLETED:
    case 'RIDE_COMPLETED':
      return `ride_completed:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.JOB_CANCELLED:
    case 'JOB_CANCELLED':
      return `job_cancelled:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.PAYOUT_SETTLED:
    case 'PAYOUT_SETTLED':
      return `payout_settled:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.REFUND_PROCESSED:
    case 'REFUND_PROCESSED':
      return `refund_proc:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.KYC_APPROVED:
    case 'KYC_APPROVED':
      return `kyc_approved:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.KYC_REJECTED:
    case 'KYC_REJECTED':
      return `kyc_rejected:${cleanEntityId}`;

    case NOTIFICATION_EVENTS.VPA_VERIFIED:
    case 'VPA_VERIFIED':
      return `vpa_verified:${cleanEntityId}${cleanTargetId}`;

    default:
      return `${cleanType}:${cleanEntityId}${cleanTargetId}`;
  }
}

/**
 * Notification Event Bus
 * Decoupled event-driven bridge connecting core business domain operations
 * to asynchronous push and in-app notification processing.
 */
class NotificationEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  publish(eventType, eventData = {}) {
    if (!eventType) throw new Error('Event type required to publish event.');

    const entityId = eventData.jobId || eventData.orderId || eventData.payoutId || eventData.driverId || eventData.entityId;
    const targetId = eventData.targetId || eventData.recipientUserId || eventData.driverId || null;

    const eventKey = eventData.eventKey || (entityId ? createEventKey(eventType, entityId, targetId) : null);

    const payload = {
      eventType,
      eventKey,
      timestamp: new Date().toISOString(),
      ...eventData
    };

    this.emit(eventType, payload);
    this.emit('*', payload);
    return payload;
  }

  subscribe(eventType, listener) {
    this.on(eventType, listener);
    return () => this.off(eventType, listener);
  }

  unsubscribe(eventType, listener) {
    this.off(eventType, listener);
  }
}

// Global Singleton Instance
const notificationEventBus = new NotificationEventBus();

module.exports = {
  NOTIFICATION_EVENTS,
  createEventKey,
  NotificationEventBus,
  notificationEventBus
};
