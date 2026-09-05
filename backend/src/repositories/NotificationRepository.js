const { supabaseAdmin, isLivePostgres } = require('../supabase');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_USER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003',
  'DRV-101': '00000000-0000-0000-0000-000000000101',
  'DRV-102': '00000000-0000-0000-0000-000000000102',
  'DRV-103': '00000000-0000-0000-0000-000000000103'
};

function mapRowToNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    userType: row.user_type,
    userId: row.user_id,
    recipientUserId: row.recipient_user_id || row.user_id,
    title: row.title,
    body: row.body,
    data: typeof row.data === 'object' && row.data !== null ? row.data : {},
    isRead: Boolean(row.is_read),
    notificationType: row.notification_type || 'GENERAL',
    relatedEntityType: row.related_entity_type || null,
    relatedEntityId: row.related_entity_id || null,
    priority: row.priority || 'NORMAL',
    channel: row.channel || 'IN_APP',
    status: row.status || 'UNREAD',
    eventKey: row.event_key || null,
    readAt: row.read_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function mapRowToDeviceToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    deviceToken: row.device_token,
    platform: row.platform,
    appType: row.app_type,
    deviceId: row.device_id || null,
    isActive: Boolean(row.is_active),
    lastSeenAt: row.last_seen_at || row.created_at,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function mapRowToPreferences(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    ridesEnabled: row.rides_enabled !== undefined ? Boolean(row.rides_enabled) : true,
    driverUpdatesEnabled: row.driver_updates_enabled !== undefined ? Boolean(row.driver_updates_enabled) : true,
    parcelEnabled: row.parcel_enabled !== undefined ? Boolean(row.parcel_enabled) : true,
    foodEnabled: row.food_enabled !== undefined ? Boolean(row.food_enabled) : true,
    groceryEnabled: row.grocery_enabled !== undefined ? Boolean(row.grocery_enabled) : true,
    paymentsEnabled: row.payments_enabled !== undefined ? Boolean(row.payments_enabled) : true,
    promotionsEnabled: row.promotions_enabled !== undefined ? Boolean(row.promotions_enabled) : true,
    supportEnabled: row.support_enabled !== undefined ? Boolean(row.support_enabled) : true,
    systemEnabled: row.system_enabled !== undefined ? Boolean(row.system_enabled) : true,
    pushEnabled: row.push_enabled !== undefined ? Boolean(row.push_enabled) : true,
    inAppEnabled: row.in_app_enabled !== undefined ? Boolean(row.in_app_enabled) : true,
    smsEnabled: row.sms_enabled !== undefined ? Boolean(row.sms_enabled) : true,
    emailEnabled: row.email_enabled !== undefined ? Boolean(row.email_enabled) : true,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString()
  };
}

function mapRowToDelivery(row) {
  if (!row) return null;
  return {
    id: row.id,
    notificationId: row.notification_id,
    deviceTokenId: row.device_token_id,
    recipientUserId: row.recipient_user_id,
    channel: row.channel,
    status: row.status,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    attemptCount: row.attempt_count || 1,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    failedAt: row.failed_at,
    failureReason: row.failure_reason,
    createdAt: row.created_at
  };
}

class NotificationRepository {
  constructor(db) {
    this.db = db;
    // In-memory fallbacks for offline testing
    this.notifications = [];
    this.deviceTokens = [];
    this.preferences = new Map();
    this.deliveries = [];
    this.templates = [];
  }

  resolveUuid(id) {
    if (!id) return null;
    if (UUID_REGEX.test(id)) return id;
    if (LEGACY_USER_MAP[id]) return LEGACY_USER_MAP[id];
    if (this.db) {
      if (this.db.users) {
        const u = this.db.users.find(x => x.id === id || x.uuid === id);
        if (u && (u.uuid || u.id)) return u.uuid || u.id;
      }
      if (this.db.drivers) {
        const d = this.db.drivers.find(x => x.id === id || x.uuid === id);
        if (d && (d.uuid || d.id)) return d.uuid || d.id;
      }
    }
    return null;
  }

  // =========================================================================
  // 1. DEVICE TOKENS (Registration, Refresh, Deactivation, Multi-Device)
  // =========================================================================

  async registerDeviceToken({ userId, deviceToken, platform = 'ANDROID', appType = 'CUSTOMER', deviceId = null }) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) {
      throw new Error('Valid authenticated user identity required for device token registration.');
    }
    if (!deviceToken || typeof deviceToken !== 'string' || !deviceToken.trim()) {
      throw new Error('Non-empty device token string required.');
    }

    const cleanToken = deviceToken.trim();
    const cleanPlatform = ['ANDROID', 'IOS', 'WEB', 'OTHER'].includes(platform?.toUpperCase()) ? platform.toUpperCase() : 'ANDROID';
    const cleanAppType = ['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN'].includes(appType?.toUpperCase()) ? appType.toUpperCase() : 'CUSTOMER';
    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      // Check existing token by (user_id, device_token, app_type) unique constraint
      const { data: existing } = await supabaseAdmin
        .from('device_tokens')
        .select('*')
        .eq('user_id', userUuid)
        .eq('device_token', cleanToken)
        .eq('app_type', cleanAppType)
        .maybeSingle();

      if (existing) {
        const { data: updated, error } = await supabaseAdmin
          .from('device_tokens')
          .update({
            is_active: true,
            last_seen_at: now,
            device_id: deviceId || existing.device_id,
            platform: cleanPlatform,
            updated_at: now
          })
          .eq('id', existing.id)
          .select('*')
          .single();

        if (error) throw new Error(`Failed to refresh device token: ${error.message}`);
        return mapRowToDeviceToken(updated);
      }

      // If deviceId provided, deactivate previous tokens associated with this deviceId for other users (prevent cross-user leakage)
      if (deviceId) {
        await supabaseAdmin
          .from('device_tokens')
          .update({ is_active: false, updated_at: now })
          .eq('device_id', deviceId)
          .neq('user_id', userUuid);
      }

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('device_tokens')
        .insert({
          user_id: userUuid,
          device_token: cleanToken,
          platform: cleanPlatform,
          app_type: cleanAppType,
          device_id: deviceId || null,
          is_active: true,
          last_seen_at: now,
          created_at: now,
          updated_at: now
        })
        .select('*')
        .single();

      if (insErr) {
        // Fallback: If race condition triggered unique violation, fetch existing and update
        if (insErr.code === '23505') {
          const { data: conflictRow } = await supabaseAdmin
            .from('device_tokens')
            .update({ is_active: true, last_seen_at: now, updated_at: now })
            .eq('user_id', userUuid)
            .eq('device_token', cleanToken)
            .eq('app_type', cleanAppType)
            .select('*')
            .single();
          return mapRowToDeviceToken(conflictRow);
        }
        throw new Error(`Failed to register device token in PostgreSQL: ${insErr.message}`);
      }

      return mapRowToDeviceToken(inserted);
    }

    // In-memory fallback
    let tok = this.deviceTokens.find(t => t.userId === userUuid && t.deviceToken === cleanToken && t.appType === cleanAppType);
    if (tok) {
      tok.isActive = true;
      tok.lastSeenAt = now;
      tok.deviceId = deviceId || tok.deviceId;
      tok.updatedAt = now;
      return tok;
    }

    const crypto = require('crypto');
    tok = {
      id: crypto.randomUUID(),
      userId: userUuid,
      deviceToken: cleanToken,
      platform: cleanPlatform,
      appType: cleanAppType,
      deviceId: deviceId || null,
      isActive: true,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    };
    this.deviceTokens.push(tok);
    return tok;
  }

  async deactivateDeviceToken(userId, deviceToken) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid || !deviceToken) return false;

    const cleanToken = deviceToken.trim();
    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      const { error } = await supabaseAdmin
        .from('device_tokens')
        .update({ is_active: false, updated_at: now })
        .eq('user_id', userUuid)
        .eq('device_token', cleanToken);

      if (error) throw new Error(`Failed to deactivate device token: ${error.message}`);
      return true;
    }

    const tok = this.deviceTokens.find(t => t.userId === userUuid && t.deviceToken === cleanToken);
    if (tok) {
      tok.isActive = false;
      tok.updatedAt = now;
      return true;
    }
    return false;
  }

  async getActiveTokens(userId, appType = null) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) return [];

    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
        .from('device_tokens')
        .select('*')
        .eq('user_id', userUuid)
        .eq('is_active', true);

      if (appType) {
        query = query.eq('app_type', appType.toUpperCase());
      }

      const { data, error } = await query;
      if (error) throw new Error(`Failed to fetch active device tokens: ${error.message}`);
      return (data || []).map(mapRowToDeviceToken);
    }

    return this.deviceTokens
      .filter(t => t.userId === userUuid && t.isActive && (!appType || t.appType === appType.toUpperCase()));
  }

  // =========================================================================
  // 2. IN-APP NOTIFICATIONS (Creation, Event Idempotency, Feed, Read State)
  // =========================================================================

  async createNotification({
    userId = null,
    recipientUserId,
    userType = 'CUSTOMER',
    title,
    body,
    data = {},
    notificationType = 'GENERAL',
    relatedEntityType = null,
    relatedEntityId = null,
    priority = 'NORMAL',
    channel = 'IN_APP',
    eventKey = null,
    expiresAt = null
  }) {
    const recipientUuid = this.resolveUuid(recipientUserId || userId);
    if (!recipientUuid) {
      throw new Error('A valid recipient user identity is required to create a notification.');
    }
    if (!title || !body) {
      throw new Error('Notification title and body are required.');
    }

    const senderUuid = userId ? this.resolveUuid(userId) : recipientUuid;
    const cleanUserType = ['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN', 'SYSTEM'].includes(userType?.toUpperCase()) ? userType.toUpperCase() : 'CUSTOMER';
    const cleanPriority = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'].includes(priority?.toUpperCase()) ? priority.toUpperCase() : 'NORMAL';
    const cleanChannel = ['IN_APP', 'PUSH', 'SMS', 'EMAIL', 'ALL'].includes(channel?.toUpperCase()) ? channel.toUpperCase() : 'IN_APP';
    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      // 1. If eventKey provided, check idempotency first
      if (eventKey) {
        const { data: existing } = await supabaseAdmin
          .from('notifications')
          .select('*')
          .eq('event_key', eventKey)
          .maybeSingle();

        if (existing) {
          return { success: true, duplicate: true, notification: mapRowToNotification(existing) };
        }
      }

      const rowToInsert = {
        user_type: cleanUserType,
        user_id: senderUuid,
        recipient_user_id: recipientUuid,
        title: title.trim(),
        body: body.trim(),
        data: typeof data === 'object' && data !== null ? data : {},
        is_read: false,
        notification_type: notificationType,
        related_entity_type: relatedEntityType,
        related_entity_id: relatedEntityId,
        priority: cleanPriority,
        channel: cleanChannel,
        status: 'UNREAD',
        event_key: eventKey || null,
        expires_at: expiresAt || null,
        created_at: now,
        updated_at: now
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('notifications')
        .insert(rowToInsert)
        .select('*')
        .single();

      if (insErr) {
        // Enforce Migration 012 unique constraint on idx_notifications_event_key
        if (insErr.code === '23505' && eventKey) {
          const { data: conflictRow } = await supabaseAdmin
            .from('notifications')
            .select('*')
            .eq('event_key', eventKey)
            .maybeSingle();
          if (conflictRow) {
            return { success: true, duplicate: true, notification: mapRowToNotification(conflictRow) };
          }
        }
        throw new Error(`Failed to persist notification in PostgreSQL: ${insErr.message}`);
      }

      return { success: true, duplicate: false, notification: mapRowToNotification(inserted) };
    }

    // In-memory fallback
    if (eventKey) {
      const existing = this.notifications.find(n => n.eventKey === eventKey);
      if (existing) {
        return { success: true, duplicate: true, notification: existing };
      }
    }

    const crypto = require('crypto');
    const notif = {
      id: crypto.randomUUID(),
      userType: cleanUserType,
      userId: senderUuid,
      recipientUserId: recipientUuid,
      title: title.trim(),
      body: body.trim(),
      data: typeof data === 'object' && data !== null ? data : {},
      isRead: false,
      notificationType,
      relatedEntityType,
      relatedEntityId,
      priority: cleanPriority,
      channel: cleanChannel,
      status: 'UNREAD',
      eventKey: eventKey || null,
      readAt: null,
      expiresAt: expiresAt || null,
      createdAt: now,
      updatedAt: now
    };
    this.notifications.unshift(notif);
    return { success: true, duplicate: false, notification: notif };
  }

  async getNotifications(userId, { limit = 20, offset = 0, unreadOnly = false, notificationType = null } = {}) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) return { notifications: [], total: 0, unreadCount: 0 };

    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 20), 100);
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

    if (isLivePostgres && supabaseAdmin) {
      let query = supabaseAdmin
        .from('notifications')
        .select('*', { count: 'exact' })
        .or(`recipient_user_id.eq.${userUuid},and(user_id.eq.${userUuid},recipient_user_id.is.null)`)
        .order('created_at', { ascending: false })
        .range(parsedOffset, parsedOffset + parsedLimit - 1);

      if (unreadOnly) {
        query = query.eq('is_read', false);
      }
      if (notificationType) {
        query = query.eq('notification_type', notificationType);
      }

      const { data, count, error } = await query;
      if (error) throw new Error(`Failed to fetch notifications: ${error.message}`);

      // Also get unread count
      const { count: unreadCount, error: unreadErr } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .or(`recipient_user_id.eq.${userUuid},and(user_id.eq.${userUuid},recipient_user_id.is.null)`)
        .eq('is_read', false);

      return {
        notifications: (data || []).map(mapRowToNotification),
        total: count !== null ? count : (data || []).length,
        unreadCount: unreadErr ? 0 : (unreadCount || 0),
        limit: parsedLimit,
        offset: parsedOffset
      };
    }

    // In-memory fallback
    let filtered = this.notifications.filter(n => n.recipientUserId === userUuid || (n.userId === userUuid && !n.recipientUserId));
    if (unreadOnly) filtered = filtered.filter(n => !n.isRead);
    if (notificationType) filtered = filtered.filter(n => n.notificationType === notificationType);

    const unreadCount = this.notifications.filter(n => (n.recipientUserId === userUuid || (n.userId === userUuid && !n.recipientUserId)) && !n.isRead).length;

    const sliced = filtered.slice(parsedOffset, parsedOffset + parsedLimit);
    return {
      notifications: sliced,
      total: filtered.length,
      unreadCount,
      limit: parsedLimit,
      offset: parsedOffset
    };
  }

  async getUnreadCount(userId) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) return 0;

    if (isLivePostgres && supabaseAdmin) {
      const { count, error } = await supabaseAdmin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .or(`recipient_user_id.eq.${userUuid},and(user_id.eq.${userUuid},recipient_user_id.is.null)`)
        .eq('is_read', false);

      if (error) throw new Error(`Failed to count unread notifications: ${error.message}`);
      return count || 0;
    }

    return this.notifications.filter(n => (n.recipientUserId === userUuid || (n.userId === userUuid && !n.recipientUserId)) && !n.isRead).length;
  }

  async markAsRead(userId, notificationId) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid || !notificationId) {
      return { success: false, error: 'User identity and notification ID required.', code: 'INVALID_PARAMETERS' };
    }

    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      // Enforce strict recipient ownership check
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .update({
          is_read: true,
          status: 'READ',
          read_at: now,
          updated_at: now
        })
        .eq('id', notificationId)
        .or(`recipient_user_id.eq.${userUuid},user_id.eq.${userUuid}`)
        .select('*')
        .maybeSingle();

      if (error) throw new Error(`Failed to mark notification as read: ${error.message}`);
      if (!data) {
        return { success: false, error: 'Notification not found or access denied.', code: 'NOT_FOUND_OR_FORBIDDEN' };
      }

      return { success: true, notification: mapRowToNotification(data) };
    }

    const notif = this.notifications.find(n => n.id === notificationId && (n.recipientUserId === userUuid || n.userId === userUuid));
    if (!notif) {
      return { success: false, error: 'Notification not found or access denied.', code: 'NOT_FOUND_OR_FORBIDDEN' };
    }

    notif.isRead = true;
    notif.status = 'READ';
    notif.readAt = now;
    notif.updatedAt = now;
    return { success: true, notification: notif };
  }

  async markAllAsRead(userId) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) return { success: false, updatedCount: 0 };

    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('notifications')
        .update({
          is_read: true,
          status: 'READ',
          read_at: now,
          updated_at: now
        })
        .or(`recipient_user_id.eq.${userUuid},user_id.eq.${userUuid}`)
        .eq('is_read', false)
        .select('id');

      if (error) throw new Error(`Failed to mark all notifications as read: ${error.message}`);
      return { success: true, updatedCount: (data || []).length };
    }

    let count = 0;
    for (const notif of this.notifications) {
      if ((notif.recipientUserId === userUuid || notif.userId === userUuid) && !notif.isRead) {
        notif.isRead = true;
        notif.status = 'READ';
        notif.readAt = now;
        notif.updatedAt = now;
        count++;
      }
    }
    return { success: true, updatedCount: count };
  }

  // =========================================================================
  // 3. NOTIFICATION PREFERENCES (Granular Category & Channel Controls)
  // =========================================================================

  async getPreferences(userId) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) throw new Error('User identity required to retrieve notification preferences.');

    const now = new Date().toISOString();

    if (isLivePostgres && supabaseAdmin) {
      const { data: existing, error: selErr } = await supabaseAdmin
        .from('notification_preferences')
        .select('*')
        .eq('user_id', userUuid)
        .maybeSingle();

      if (selErr) throw new Error(`Failed to fetch notification preferences: ${selErr.message}`);
      if (existing) return mapRowToPreferences(existing);

      // Seed default preferences if not yet existing
      const defaultPrefs = {
        user_id: userUuid,
        rides_enabled: true,
        driver_updates_enabled: true,
        parcel_enabled: true,
        food_enabled: true,
        grocery_enabled: true,
        payments_enabled: true,
        promotions_enabled: true,
        support_enabled: true,
        system_enabled: true,
        push_enabled: true,
        in_app_enabled: true,
        sms_enabled: true,
        email_enabled: true,
        created_at: now,
        updated_at: now
      };

      const { data: inserted, error: insErr } = await supabaseAdmin
        .from('notification_preferences')
        .insert(defaultPrefs)
        .select('*')
        .single();

      if (insErr) {
        // In case of concurrent creation race, fetch existing
        const { data: fallback } = await supabaseAdmin
          .from('notification_preferences')
          .select('*')
          .eq('user_id', userUuid)
          .maybeSingle();
        if (fallback) return mapRowToPreferences(fallback);
        throw new Error(`Failed to initialize notification preferences: ${insErr.message}`);
      }

      return mapRowToPreferences(inserted);
    }

    // In-memory fallback
    if (!this.preferences.has(userUuid)) {
      const crypto = require('crypto');
      this.preferences.set(userUuid, {
        id: crypto.randomUUID(),
        userId: userUuid,
        ridesEnabled: true,
        driverUpdatesEnabled: true,
        parcelEnabled: true,
        foodEnabled: true,
        groceryEnabled: true,
        paymentsEnabled: true,
        promotionsEnabled: true,
        supportEnabled: true,
        systemEnabled: true,
        pushEnabled: true,
        inAppEnabled: true,
        smsEnabled: true,
        emailEnabled: true,
        createdAt: now,
        updatedAt: now
      });
    }
    return this.preferences.get(userUuid);
  }

  async updatePreferences(userId, updateFields = {}) {
    const userUuid = this.resolveUuid(userId);
    if (!userUuid) throw new Error('User identity required to update notification preferences.');

    const allowedKeys = [
      'rides_enabled', 'driver_updates_enabled', 'parcel_enabled', 'food_enabled',
      'grocery_enabled', 'payments_enabled', 'promotions_enabled', 'support_enabled',
      'system_enabled', 'push_enabled', 'in_app_enabled', 'sms_enabled', 'email_enabled'
    ];

    const dbUpdates = { updated_at: new Date().toISOString() };
    for (const [key, val] of Object.entries(updateFields)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      if (allowedKeys.includes(snakeKey)) {
        dbUpdates[snakeKey] = Boolean(val);
      }
    }

    if (isLivePostgres && supabaseAdmin) {
      // Ensure preferences exist first
      await this.getPreferences(userUuid);

      const { data: updated, error } = await supabaseAdmin
        .from('notification_preferences')
        .update(dbUpdates)
        .eq('user_id', userUuid)
        .select('*')
        .single();

      if (error) throw new Error(`Failed to update notification preferences: ${error.message}`);
      return mapRowToPreferences(updated);
    }

    const current = await this.getPreferences(userUuid);
    const updated = { ...current };
    for (const [key, val] of Object.entries(updateFields)) {
      if (key in updated) {
        updated[key] = Boolean(val);
      }
    }
    updated.updatedAt = new Date().toISOString();
    this.preferences.set(userUuid, updated);
    return updated;
  }

  // =========================================================================
  // 4. NOTIFICATION DELIVERIES (Audit Trail, Provider State Machine, Retries)
  // =========================================================================

  async createDeliveryRecord({
    notificationId,
    deviceTokenId = null,
    recipientUserId,
    channel = 'PUSH',
    status = 'SENT',
    provider = 'MOCK_SANDBOX',
    providerMessageId = null,
    failureReason = null
  }) {
    const recipientUuid = this.resolveUuid(recipientUserId);
    const cleanChannel = ['IN_APP', 'PUSH', 'SMS', 'EMAIL'].includes(channel?.toUpperCase()) ? channel.toUpperCase() : 'PUSH';
    const cleanStatus = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'].includes(status?.toUpperCase()) ? status.toUpperCase() : 'SENT';
    const now = new Date().toISOString();

    const rowToInsert = {
      notification_id: notificationId,
      device_token_id: deviceTokenId || null,
      recipient_user_id: recipientUuid || null,
      channel: cleanChannel,
      status: cleanStatus,
      provider: provider || 'MOCK_SANDBOX',
      provider_message_id: providerMessageId || null,
      attempt_count: 1,
      sent_at: now,
      delivered_at: cleanStatus === 'DELIVERED' ? now : null,
      failed_at: cleanStatus === 'FAILED' ? now : null,
      failure_reason: failureReason || null,
      created_at: now
    };

    if (isLivePostgres && supabaseAdmin) {
      const { data: inserted, error } = await supabaseAdmin
        .from('notification_deliveries')
        .insert(rowToInsert)
        .select('*')
        .single();

      if (error) throw new Error(`Failed to create notification delivery record: ${error.message}`);
      return mapRowToDelivery(inserted);
    }

    const crypto = require('crypto');
    const delivery = { id: crypto.randomUUID(), ...rowToInsert };
    this.deliveries.push(delivery);
    return mapRowToDelivery(delivery);
  }

  async updateDeliveryStatus(deliveryId, {
    status,
    deliveredAt = null,
    failedAt = null,
    failureReason = null,
    providerMessageId = null,
    attemptCount = null,
    incrementAttempt = false
  }) {
    if (!deliveryId) return null;
    const cleanStatus = ['PENDING', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED'].includes(status?.toUpperCase()) ? status.toUpperCase() : status;
    const now = new Date().toISOString();

    const dbUpdates = {
      status: cleanStatus,
      failure_reason: failureReason
    };

    if (providerMessageId) dbUpdates.provider_message_id = providerMessageId;
    if (attemptCount !== null && attemptCount !== undefined) dbUpdates.attempt_count = attemptCount;
    if (cleanStatus === 'DELIVERED') dbUpdates.delivered_at = deliveredAt || now;
    if (cleanStatus === 'FAILED') dbUpdates.failed_at = failedAt || now;

    if (isLivePostgres && supabaseAdmin) {
      if (incrementAttempt && (attemptCount === null || attemptCount === undefined)) {
        const { data: cur } = await supabaseAdmin.from('notification_deliveries').select('attempt_count').eq('id', deliveryId).maybeSingle();
        dbUpdates.attempt_count = ((cur?.attempt_count) || 1) + 1;
      }
      let query = supabaseAdmin.from('notification_deliveries').update(dbUpdates).eq('id', deliveryId);
      const { data, error } = await query.select('*').single();
      if (error) throw new Error(`Failed to update delivery status: ${error.message}`);
      return mapRowToDelivery(data);
    }

    const rec = this.deliveries.find(d => d.id === deliveryId);
    if (rec) {
      Object.assign(rec, dbUpdates);
      if (attemptCount !== null && attemptCount !== undefined) {
        rec.attemptCount = attemptCount;
      } else if (incrementAttempt) {
        rec.attemptCount = (rec.attemptCount || 1) + 1;
      }
      return mapRowToDelivery(rec);
    }
    return null;
  }

  async getDeliveriesByNotification(notificationId) {
    if (!notificationId) return [];

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('notification_deliveries')
        .select('*')
        .eq('notification_id', notificationId)
        .order('created_at', { ascending: false });

      if (error) throw new Error(`Failed to retrieve delivery records: ${error.message}`);
      return (data || []).map(mapRowToDelivery);
    }

    return this.deliveries.filter(d => d.notificationId === notificationId).map(mapRowToDelivery);
  }

  // =========================================================================
  // 5. NOTIFICATION TEMPLATES (Operational & Localization Template Registry)
  // =========================================================================

  async getTemplate(templateCode) {
    if (!templateCode) return null;

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('notification_templates')
        .select('*')
        .or(`template_code.eq.${templateCode},id.eq.${templateCode}`)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw new Error(`Failed to fetch notification template: ${error.message}`);
      return data;
    }

    return this.templates.find(t => (t.template_code === templateCode || t.id === templateCode) && t.is_active) || null;
  }

  async listActiveTemplates() {
    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('notification_templates')
        .select('*')
        .eq('is_active', true)
        .order('category', { ascending: true });

      if (error) throw new Error(`Failed to list notification templates: ${error.message}`);
      return data || [];
    }

    return this.templates.filter(t => t.is_active);
  }
}

module.exports = NotificationRepository;
