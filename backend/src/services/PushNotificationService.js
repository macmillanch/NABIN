const crypto = require('crypto');
const { isProduction } = require('./RuntimeMode');

/**
 * Mock Sandbox Push Provider for Local Development & Automated Testing
 * Zero external network dependencies; zero cloud credentials required.
 *
 * It refuses to run in production, rather than relying on the wiring that hands
 * it to the service. `push_delivery_truthfulness_test.js` PDT-C20 is the witness:
 * with the sandbox chosen by environment alone, a production instance with no
 * Firebase credentials recorded DELIVERED rows for notifications that were never
 * sent. The delivery table is an audit trail, so a fabricated row is worse than a
 * failure — and production is decided by NODE_ENV alone, the same rule
 * RuntimeMode.js exists to enforce.
 */
class MockSandboxPushProvider {
  constructor(options = {}) {
    this.name = 'MOCK_SANDBOX';
    this.simulationMode = options.simulationMode || 'SUCCESS'; // 'SUCCESS' | 'TRANSIENT_FAILURE' | 'INVALID_TOKEN' | 'PERMANENT_FAILURE'
    this.dispatches = [];
  }

  setSimulationMode(mode) {
    this.simulationMode = mode;
  }

  async sendPush({ token, platform = 'ANDROID', title, body, data = {}, priority = 'NORMAL' }) {
    if (isProduction()) {
      return {
        success: false,
        isTransient: false,
        error: 'PUSH_GATEWAY_NOT_CONFIGURED: the MOCK_SANDBOX push adapter does not run in production.',
        errorCode: 'PUSH_GATEWAY_NOT_CONFIGURED'
      };
    }

    const dispatchRecord = {
      token,
      platform,
      title,
      body,
      data,
      priority,
      timestamp: new Date().toISOString()
    };
    this.dispatches.push(dispatchRecord);

    if (this.simulationMode === 'TRANSIENT_FAILURE') {
      return {
        success: false,
        isTransient: true,
        error: 'SIMULATED_GATEWAY_TIMEOUT: Provider endpoint timed out',
        errorCode: 'PROVIDER_TIMEOUT'
      };
    }

    if (this.simulationMode === 'INVALID_TOKEN' || token.includes('invalid') || token.includes('unregistered')) {
      return {
        success: false,
        isTransient: false,
        error: 'messaging/registration-token-not-registered: Device token is no longer valid',
        errorCode: 'UNREGISTERED_TOKEN'
      };
    }

    if (this.simulationMode === 'PERMANENT_FAILURE') {
      return {
        success: false,
        isTransient: false,
        error: 'SIMULATED_PERMANENT_REJECTION: Invalid payload schema',
        errorCode: 'INVALID_PAYLOAD'
      };
    }

    const msgId = `msg_sand_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    return {
      success: true,
      providerMessageId: msgId,
      deliveredAt: new Date().toISOString()
    };
  }

  async sendBatchPush({ tokens = [], platform = 'ANDROID', title, body, data = {}, priority = 'NORMAL' }) {
    const results = [];
    for (const token of tokens) {
      const res = await this.sendPush({ token, platform, title, body, data, priority });
      results.push({ token, ...res });
    }
    return results;
  }
}

/**
 * FCM v1 Push Provider — credential reader, NOT a dispatcher.
 * Reads credentials exclusively from environment variables and never hardcodes
 * a secret, but has no network path yet (see sendPush). It must not be described
 * as a working production provider until that dispatch exists.
 */
class FcmV1PushProvider {
  constructor() {
    this.name = 'FCM_V1';
    this.projectId = process.env.FIREBASE_PROJECT_ID || null;
    this.clientEmail = process.env.FIREBASE_CLIENT_EMAIL || null;
    this.privateKey = process.env.FIREBASE_PRIVATE_KEY || null;
    this.isConfigured = Boolean(this.projectId && (this.privateKey || process.env.FIREBASE_SERVICE_ACCOUNT_KEY));
  }

  async sendPush() {
    if (!this.isConfigured) {
      throw new Error('FCM v1 Push Provider is not configured. Set FIREBASE_PROJECT_ID and credentials in environment variables.');
    }

    // No path in this repo mints the FCM OAuth2 token or POSTs to
    // fcm.googleapis.com — push_delivery_truthfulness_test.js PDT-A0 reads this
    // file to prove it, and goes red the day someone implements the dispatch.
    // Until then `success: true` would be a fabrication: it used to return a
    // message id minted from Date.now(), and the caller wrote a DELIVERED audit
    // row for a device that was never contacted. A refusal names what is missing
    // and lands the row FAILED.
    return {
      success: false,
      isTransient: false,
      error: 'PUSH_DELIVERY_NOT_IMPLEMENTED: this build has no FCM dispatch path, so no device was contacted.',
      errorCode: 'PUSH_DELIVERY_NOT_IMPLEMENTED'
    };
  }
}

/**
 * The adapter a production instance gets when it has no Firebase credentials.
 * It exists so "not configured" is a named state in the delivery audit trail
 * instead of a sandbox pretending to be a gateway.
 */
class NotConfiguredPushProvider {
  constructor() {
    this.name = 'NOT_CONFIGURED';
  }

  async sendPush() {
    return {
      success: false,
      isTransient: false,
      error: 'PUSH_GATEWAY_NOT_CONFIGURED: set FIREBASE_PROJECT_ID and FIREBASE_CLIENT_EMAIL to enable push.',
      errorCode: 'PUSH_GATEWAY_NOT_CONFIGURED'
    };
  }
}

/**
 * Single place that decides which push adapter this process may use.
 *
 * Mirrors SmsGatewayService.resolveProvider: credentials select the real
 * provider, and production with no credentials is a named refusal rather than a
 * silent fallback to the development adapter.
 */
function resolvePushProvider(env = process.env) {
  const hasFcm = Boolean(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL);
  if (hasFcm) return new FcmV1PushProvider();
  if (isProduction()) return new NotConfiguredPushProvider();
  return new MockSandboxPushProvider();
}

/**
 * Core Push Notification Service
 * Coordinates template resolution, preference filtering, provider dispatch,
 * delivery logging, and automatic retry / token deactivation.
 */
class PushNotificationService {
  constructor(notificationRepoOrOptions, pushProvider = null) {
    if (notificationRepoOrOptions && notificationRepoOrOptions.notificationRepo) {
      this.notificationRepo = notificationRepoOrOptions.notificationRepo;
      this.provider = notificationRepoOrOptions.pushProvider || pushProvider || new MockSandboxPushProvider();
    } else {
      this.notificationRepo = notificationRepoOrOptions;
      this.provider = pushProvider || new MockSandboxPushProvider();
    }
  }

  setProvider(provider) {
    this.provider = provider;
  }

  interpolateTemplate(text, variables = {}) {
    if (!text) return '';
    return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      return variables[key] !== undefined ? String(variables[key]) : match;
    });
  }

  categorizeEvent(notificationType) {
    const type = (notificationType || '').toUpperCase();
    if (['PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'WALLET_CREDIT', 'WALLET_DEBIT', 'PAYOUT_INITIATED', 'PAYOUT_SETTLED', 'REFUND_PROCESSED'].includes(type)) {
      return 'TRANSACTIONAL';
    }
    if (['KYC_APPROVED', 'KYC_REJECTED', 'VPA_VERIFIED', 'ACCOUNT_LOCKED', 'SECURITY_ALERT'].includes(type)) {
      return 'SECURITY';
    }
    if (['PROMOTION', 'PROMO_BROADCAST', 'MARKETING', 'COUPON'].includes(type)) {
      return 'MARKETING';
    }
    return 'OPERATIONAL';
  }

  async shouldDeliverPush(userId, notificationType) {
    const category = this.categorizeEvent(notificationType);
    if (category === 'TRANSACTIONAL' || category === 'SECURITY') {
      return { allowed: true, reason: 'MANDATORY_SAFETY_TRANSACTIONAL' };
    }

    try {
      const prefs = await this.notificationRepo.getPreferences(userId);
      if (!prefs) return { allowed: true, reason: 'DEFAULT_ALLOWED' };

      if (!prefs.pushEnabled) {
        return { allowed: false, reason: 'PREFERENCE_PUSH_MUTED' };
      }

      if (category === 'MARKETING' && !prefs.promotionsEnabled) {
        return { allowed: false, reason: 'PREFERENCE_PROMOTIONS_DISABLED' };
      }

      const type = (notificationType || '').toUpperCase();
      if (type.startsWith('RIDE') && !prefs.ridesEnabled) {
        return { allowed: false, reason: 'PREFERENCE_RIDES_DISABLED' };
      }
      if (type.startsWith('FOOD') && !prefs.foodEnabled) {
        return { allowed: false, reason: 'PREFERENCE_FOOD_DISABLED' };
      }
      if (type.startsWith('PARCEL') && !prefs.parcelEnabled) {
        return { allowed: false, reason: 'PREFERENCE_PARCEL_DISABLED' };
      }
      if (type.startsWith('GROCERY') && !prefs.groceryEnabled) {
        return { allowed: false, reason: 'PREFERENCE_GROCERY_DISABLED' };
      }
      if (type.startsWith('SUPPORT') && !prefs.supportEnabled) {
        return { allowed: false, reason: 'PREFERENCE_SUPPORT_DISABLED' };
      }

      return { allowed: true, reason: 'PREFERENCE_ALLOWED' };
    } catch (err) {
      return { allowed: true, reason: 'PREFERENCE_CHECK_FALLBACK' };
    }
  }

  async dispatchNotification(notification) {
    if (!notification || !notification.id || !notification.recipientUserId) {
      return { success: false, error: 'Invalid notification object' };
    }

    const recipientUserId = notification.recipientUserId;
    const activeTokens = await this.notificationRepo.getActiveTokens(recipientUserId);

    if (!activeTokens || activeTokens.length === 0) {
      await this.notificationRepo.createDeliveryRecord({
        notificationId: notification.id,
        recipientUserId,
        channel: 'PUSH',
        status: 'SKIPPED',
        provider: this.provider.name,
        failureReason: 'NO_ACTIVE_DEVICE_TOKEN'
      });
      return { success: true, delivered: false, reason: 'NO_ACTIVE_DEVICE_TOKEN' };
    }

    const preferenceCheck = await this.shouldDeliverPush(recipientUserId, notification.notificationType);
    if (!preferenceCheck.allowed) {
      for (const tok of activeTokens) {
        await this.notificationRepo.createDeliveryRecord({
          notificationId: notification.id,
          deviceTokenId: tok.id,
          recipientUserId,
          channel: 'PUSH',
          status: 'SKIPPED',
          provider: this.provider.name,
          failureReason: preferenceCheck.reason
        });
      }
      return { success: true, delivered: false, reason: preferenceCheck.reason };
    }

    const deliveryResults = [];
    for (const tok of activeTokens) {
      const delivRecord = await this.notificationRepo.createDeliveryRecord({
        notificationId: notification.id,
        deviceTokenId: tok.id,
        recipientUserId,
        channel: 'PUSH',
        status: 'PENDING',
        provider: this.provider.name
      });

      const pushResult = await this.executeDeliveryWithRetry(tok, notification, delivRecord);
      deliveryResults.push(pushResult);
    }

    return {
      success: true,
      delivered: deliveryResults.some(r => r.success),
      results: deliveryResults
    };
  }

  async executeDeliveryWithRetry(deviceToken, notification, deliveryRecord, attempt = 1, maxAttempts = 3) {
    const providerResult = await this.provider.sendPush({
      token: deviceToken.deviceToken,
      platform: deviceToken.platform || 'ANDROID',
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      priority: notification.priority || 'NORMAL'
    });

    if (providerResult.success) {
      await this.notificationRepo.updateDeliveryStatus(deliveryRecord.id, {
        status: 'DELIVERED',
        deliveredAt: providerResult.deliveredAt || new Date().toISOString(),
        providerMessageId: providerResult.providerMessageId
      });
      return { success: true, deliveryId: deliveryRecord.id, providerMessageId: providerResult.providerMessageId };
    }

    const isPermanent = !providerResult.isTransient;
    if (isPermanent) {
      await this.notificationRepo.updateDeliveryStatus(deliveryRecord.id, {
        status: 'FAILED',
        failedAt: new Date().toISOString(),
        failureReason: providerResult.error || 'PERMANENT_DELIVERY_FAILURE'
      });

      if (providerResult.errorCode === 'UNREGISTERED_TOKEN' || (providerResult.error && providerResult.error.toLowerCase().includes('not-registered'))) {
        await this.notificationRepo.deactivateDeviceToken(deviceToken.userId, deviceToken.deviceToken);
      }
      return { success: false, isPermanent: true, error: providerResult.error, deliveryId: deliveryRecord.id };
    }

    // Transient failure retry handling
    if (attempt < maxAttempts) {
      const backoffDelays = [0, 1000, 4000, 16000];
      const delayMs = backoffDelays[attempt] || 1000;

      await this.notificationRepo.updateDeliveryStatus(deliveryRecord.id, {
        status: 'PENDING',
        failureReason: `Transient error (attempt ${attempt}): ${providerResult.error}`,
        attemptCount: attempt + 1,
        incrementAttempt: true
      });

      if (process.env.NODE_ENV !== 'test' && !process.env.FAST_TEST_MODE) {
        await new Promise(res => setTimeout(res, delayMs));
      }

      return this.executeDeliveryWithRetry(deviceToken, notification, deliveryRecord, attempt + 1, maxAttempts);
    }

    // Max retry count reached
    await this.notificationRepo.updateDeliveryStatus(deliveryRecord.id, {
      status: 'FAILED',
      failedAt: new Date().toISOString(),
      failureReason: `MAX_RETRIES_EXCEEDED (3 attempts): ${providerResult.error}`,
      attemptCount: maxAttempts
    });
    return { success: false, isPermanent: false, error: providerResult.error, maxRetriesExceeded: true, deliveryId: deliveryRecord.id };
  }
}

module.exports = {
  MockSandboxPushProvider,
  FcmV1PushProvider,
  NotConfiguredPushProvider,
  resolvePushProvider,
  PushNotificationService
};
