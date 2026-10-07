const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./database');
const supabaseHelper = require('./supabase');
const cloudinaryService = require('./services/cloudinaryService');
// Canonical `Idempotency-Key` / `X-Idempotency-Key` / body spelling, shared with every other
// mutating route here so a client learns one convention rather than one per endpoint.
const { readIdempotencyHeader } = require('./services/moneyIdentity');
const { MockSandboxPushProvider, FcmV1PushProvider, PushNotificationService } = require('./services/PushNotificationService');
const { notificationEventBus, NOTIFICATION_EVENTS } = require('./services/NotificationEventBus');
const featureControlService = require('./services/FeatureControlService');
const appConfigService = require('./services/AppConfigService');
const { validateDriverTelemetry } = require('./services/TelemetryValidator');
const geoPolicy = require('./services/GeoPolicyService');
const { allowsTestConvenience } = require('./services/RuntimeMode');
const AdvertisementRepository = require('./repositories/AdvertisementRepository');

const pushProvider = (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL)
  ? new FcmV1PushProvider()
  : new MockSandboxPushProvider();

const pushNotificationService = new PushNotificationService(db.notificationRepo, pushProvider);
db.pushNotificationService = pushNotificationService;
db.notificationEventBus = notificationEventBus;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEGACY_CUSTOMER_MAP = {
  'usr_1': '00000000-0000-0000-0000-000000000001',
  'usr_2': '00000000-0000-0000-0000-000000000002',
  'usr_3': '00000000-0000-0000-0000-000000000003'
};

function resolveCustomerUserUuid(customerId) {
  if (!customerId) return null;
  if (UUID_REGEX.test(customerId)) return customerId;
  if (LEGACY_CUSTOMER_MAP[customerId]) return LEGACY_CUSTOMER_MAP[customerId];
  const user = db.getUser ? db.getUser(customerId) : null;
  if (user?.uuid && UUID_REGEX.test(user.uuid)) return user.uuid;
  if (user?.id && UUID_REGEX.test(user.id)) return user.id;
  if (user?.userId && UUID_REGEX.test(user.userId)) return user.userId;
  return null;
}

// promotions.service_type is a coarse domain ('RIDE'/'PARCEL'/'FOOD'/'GROCERY'/
// 'ALL'), while the pricing engine keys on vehicle types like '3W' or 'LUX'.
function couponServiceOf(pricingServiceType) {
  const t = String(pricingServiceType || '').toUpperCase();
  return t === 'PARCEL' ? 'PARCEL' : 'RIDE';
}

// Both ends of a booking have to be places the customer actually chose. This used
// to be a default: a ride with no pickup got central-Delhi coordinates, and the
// fare was then computed for a journey nobody described. NABIN has no geocoder and
// no route service, so a pin the customer placed is the only honest source of a
// place — the typed text beside it is a label, not a location.
//
// A coordinate pair validated here, or a refusal naming the field that failed.
// Nothing is completed from a default and one half of a pair is not a location.
function placedEnd(value, field) {
  // Absent, or a pin-less label with only coordinates missing from it, is the
  // "go place it" case — the customer can only act on that instruction. A pin that
  // is present and garbled is a different fault and keeps the validator's own code.
  const unplaced = !value || typeof value !== 'object' ||
    [value.lat, value.lng].some((v) => v === undefined || v === null || v === '');
  if (unplaced) {
    return { ok: false, code: 'PLACE_REQUIRED', field, message: `Place the ${field} on the map first. NABIN prices and dispatches from the place you choose.` };
  }
  // Numeric strings stay accepted because this transport published that contract
  // before; the pair itself is decided by the same validator every other
  // geographic surface uses.
  const coords = geoPolicy.validateCoordinatePair(value.lat, value.lng, { numericStrings: true });
  if (!coords.ok) {
    return { ok: false, code: coords.code, field, message: coords.message };
  }
  const address = typeof value.address === 'string' ? value.address.trim() : '';
  return { ok: true, value: { address: address || null, lat: coords.value.lat, lng: coords.value.lng } };
}

// A trip's length is measured from the two placed ends, never quoted from a
// literal, and an unmeasurable trip is refused before it reaches a fare.
function tripDistanceKm(from, to) {
  const km = geoPolicy.distanceKmBetween(from, to);
  if (km === null || !(km > 0)) return null;
  return Math.round(km * 100) / 100;
}

// The one speed model the platform uses, in one place. The booking routes priced
// 11 minutes for a "3.8 km" ride and 18 for a "6.1 km" parcel — both about 20
// km/h, so this makes the hidden assumption explicit rather than changing it. It
// is an estimate of a city trip in Mizoram, not a measurement of this one, and no
// screen is allowed to call it an arrival time.
const AVERAGE_CITY_SPEED_KMPH = 20;
function tripDurationMins(distanceKm) {
  return Math.max(3, Math.round((distanceKm / AVERAGE_CITY_SPEED_KMPH) * 60));
}

// The refusal every booking route gives for a place it was never told about: the
// same shape as every other API failure, with the field that needs placing.
function replyPlaceRefusal(res, req, refusal) {
  res.status(400).json({
    success: false,
    code: refusal.code,
    field: refusal.field,
    error: refusal.message,
    requestId: req.id
  });
  return true;
}

// One translation of the engine's refusal into the shape every other API failure
// already uses, so a route cannot invent its own idea of what an unvalidated
// location is worth. Returns false when there is nothing to refuse.
function replyGeoRefusal(res, req, refusal) {
  if (!refusal) return false;
  res.status(refusal.httpStatus).json({
    success: false,
    code: refusal.code,
    error: refusal.message,
    pricingAvailable: false,
    requestId: req.id
  });
  return true;
}

// The admin geo routes used to answer every failure with `400 + err.message`,
// which called a database outage a validation error and quoted the database
// driver at whoever asked. Only a refusal this code raised, carrying a GEO_
// reason code, is safe to repeat; anything else is an internal fault.
function replyGeoAdminError(res, req, err) {
  const code = typeof err?.code === 'string' && err.code.startsWith('GEO_') ? err.code : null;
  if (!code) {
    console.error('⚠️ Unhandled geofencing admin failure:', err);
    return res.status(500).json({
      success: false,
      code: geoPolicy.REASON.STORE_UNAVAILABLE,
      error: 'The geofencing configuration could not be changed. No change was saved.',
      requestId: req.id
    });
  }
  const declared = Number(err.status);
  res.status(Number.isFinite(declared) && declared >= 400 ? declared : 400).json({
    success: false,
    code,
    error: err.message,
    requestId: req.id
  });
}

async function resolveDriverUserUuid(driverId) {
  if (!driverId) return null;
  const driver = db.getDriver ? db.getDriver(driverId) : null;
  let userId = driver?.userId || driver?.user_id;
  if (userId && UUID_REGEX.test(userId)) return userId;

  if (supabaseHelper.isLivePostgres && supabaseHelper.supabaseAdmin) {
    const targetUuid = db.driverRepo?.resolveUuid(driverId) || driver?.uuid || driverId;
    if (UUID_REGEX.test(targetUuid)) {
      try {
        const { data } = await supabaseHelper.supabaseAdmin.from('drivers').select('user_id').eq('id', targetUuid).maybeSingle();
        if (data?.user_id && UUID_REGEX.test(data.user_id)) {
          return data.user_id;
        }
      } catch (e) {}
    }
  }
  return null;
}

// Universal Post-Commit Notification Event Bus Subscriber
// Asynchronously creates in-app notifications and dispatches push delivery with zero impact on caller transaction
notificationEventBus.subscribe('*', async (event) => {
  try {
    if (!event || !event.eventType) return;

    let recipientUserId = event.recipientUserId;
    // A merchant has no owning `users` row — `merchants` never grew the link — so
    // a merchant notification is keyed by its own `merchants.id`, which is what
    // `notifications.user_type` allows 'MERCHANT' for (Migration 012).
    let recipientUserType = event.userType ? String(event.userType).toUpperCase() : null;
    if (!recipientUserId && !event.customerId && !event.driverId &&
        (recipientUserType === 'MERCHANT' || event.merchantId)) {
      recipientUserId = event.merchantId;
      recipientUserType = 'MERCHANT';
    }
    if (!recipientUserId) {
      const driverEvents = ['PAYOUT_SETTLED', 'KYC_APPROVED', 'KYC_REJECTED', 'VPA_VERIFIED', 'payout:settled', 'kyc:approved', 'kyc:rejected', 'vpa:verified'];
      if (driverEvents.includes(event.eventType) || (event.driverId && !event.customerId)) {
        recipientUserId = await resolveDriverUserUuid(event.driverId);
      } else if (event.customerId) {
        recipientUserId = resolveCustomerUserUuid(event.customerId);
      } else if (event.driverId) {
        recipientUserId = await resolveDriverUserUuid(event.driverId);
      }
    }

    if (!recipientUserId) {
      if (event.driverId) {
        console.warn(`[NOTIF_BUS_SKIPPED] Event ${event.eventType} for driver ${event.driverId} skipped: unlinked driver account has no user_id.`);
      } else {
        console.warn(`[NOTIF_BUS_SKIPPED] Event ${event.eventType} skipped: recipient could not be resolved to valid users.id.`);
      }
      return;
    }

    if (!UUID_REGEX.test(recipientUserId)) {
      recipientUserId = resolveCustomerUserUuid(recipientUserId);
    }

    if (!recipientUserId || !UUID_REGEX.test(recipientUserId)) {
      console.warn(`[NOTIF_BUS_SKIPPED] Event ${event.eventType} skipped: recipient could not be resolved to valid users.id.`);
      return;
    }

    if (!db.notificationRepo) return;

    const notifRes = await db.notificationRepo.createNotification({
      recipientUserId,
      userType: recipientUserType || 'CUSTOMER',
      title: event.title || event.eventType,
      body: event.body || '',
      notificationType: event.notificationType || event.eventType,
      priority: event.priority || 'NORMAL',
      data: event.data || {},
      relatedEntityType: event.relatedEntityType || null,
      relatedEntityId: event.relatedEntityId || null,
      eventKey: event.eventKey
    });

    if (notifRes && notifRes.success && notifRes.notification && !notifRes.duplicate) {
      if (recipientUserType === 'MERCHANT') {
        broadcastToMerchant(recipientUserId, {
          type: 'NOTIFICATION',
          notification: notifRes.notification
        });
      }
      if (db.pushNotificationService) {
        await db.pushNotificationService.dispatchNotification(notifRes.notification);
      }
    }
  } catch (err) {
    console.error(`[NOTIF_BUS_ERROR] Failed to process notification for ${event.eventType}:`, err.message);
  }
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Global error handlers to prevent server crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Environment-Specific Whitelisted CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:4000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5173',
  'https://admin.nabin.in',
  'https://api.nabin.in',
  'https://api-beta.nabin.in',
  'https://beta.nabin.in',
  'https://nabin.in'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.nabin.in')) {
      callback(null, true);
    } else {
      callback(new Error('Origin blocked by NABIN security CORS policy'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // If-Match and If-None-Match are conditions, not payload, and both are part of a
  // contract this API already offers: a campaign save is refused unless it names the
  // revision it edited, and the config feed answers 304 so a client can revalidate cheaply.
  // A browser preflights either header, so leaving them out would break exactly the
  // clients the contract was written for — the admin console and a web app on another
  // origin — while Node and Flutter clients sail past it, which is why the test suite
  // cannot see this.
  //
  // Idempotency-Key joins X-Idempotency-Key for the same reason and with the same blind
  // spot: six routes read the canonical spelling FIRST (`req.headers['idempotency-key']
  // || req.headers['x-idempotency-key']`) — ride and parcel booking, grocery checkout,
  // offer acceptance, food ordering, coupon redemption — and the ledger and dispatch
  // procedures deduplicate on the value it carries. A browser that honoured that contract
  // preflighted a header this list did not allow, so the request never left the browser,
  // and a retry after a dropped response could book the trip or redeem the coupon twice.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'X-Idempotency-Key', 'X-App-Version', 'X-Device-Id', 'If-Match', 'If-None-Match'],
  // Without this, `response.headers.get('ETag')` reads as null in a browser even though
  // the server sent it, so a cross-origin client could never obtain the revision a
  // conditional write or a conditional GET has to echo back.
  exposedHeaders: ['ETag']
}));

// Request Tracking ID Middleware
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

/**
 * Answer a database failure with the status that failure actually deserves.
 *
 * Every route that talks to PostgreSQL had its own copy of
 * `res.status(400).json({ error: error.message })`, which is two bugs standing in one
 * line: an outage arrives as a client error, so the caller stops retrying and the work
 * is lost, and the database's own sentence about itself travels out to whoever asked.
 * The classification lives in one place now (`storeReply` in supabase.js) and this is
 * the one place that applies it to a response, so a route cannot be added that gets it
 * wrong by construction. `outage_semantics_audit.js` is the check that they stay fixed.
 */
function replyStoreError(res, req, err, what, options = {}) {
  const reply = supabaseHelper.storeReply(err, { what, ...options });
  // The engine's words go to the log, where an operator can act on them, and not to the
  // response, where they hand a stranger a map of the schema.
  console.error(`[store] ${req.method} ${req.originalUrl} ${reply.status} ${reply.code}: ${reply.detail}`);
  return res.status(reply.status).json({
    success: false,
    code: reply.code,
    error: reply.error,
    requestId: req.id
  });
}

// Root API Discovery Endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'NABIN Unified Multi-App Backend API',
    version: '1.1.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: 'https://github.com/macmillanch/NABIN/tree/main/docs',
    adminDashboardUrl: process.env.ADMIN_DASHBOARD_URL || 'https://admin.nabin.in',
    endpoints: {
      health: '/api/health',
      ready: '/api/ready',
      services: '/api/services/status',
      auth: '/api/auth',
      admin: '/api/admin',
      rides: '/api/rides',
      food: '/api/food',
      parcel: '/api/parcel'
    },
    timestamp: new Date().toISOString()
  });
});

// Admin API Discovery Endpoint
app.get('/admin', (req, res) => {
  res.json({
    service: 'NABIN Admin API',
    status: 'ONLINE',
    dashboardUrl: process.env.ADMIN_DASHBOARD_URL || 'https://admin.nabin.in',
    authEndpoint: '/api/admin/login',
    docs: '/api/admin/audit-logs'
  });
});

// Health & Readiness Endpoints
app.get('/api/health', async (req, res) => {
  // Liveness only: the process answers even while PostgreSQL is unreachable, so
  // orchestrators do not restart-loop during a database blip. Readiness is /api/ready.
  const connection = await supabaseHelper.checkSupabaseConnection().catch((err) => ({
    configured: supabaseHelper.isConfigured,
    connected: false,
    mode: 'POSTGRES_ERROR',
    error: err.message
  }));
  // The connection's own words — a driver error, an internal host and port, a PostgREST
  // code — go to the log and not to the body. This endpoint needs no credentials, so
  // shipping them would hand an anonymous caller the shape of the infrastructure.
  if (connection.error) console.warn(`[health] database detail: ${connection.error}`);
  res.json({
    status: 'ONLINE',
    service: 'NABIN Unified Multi-App Backend',
    version: '1.1.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: {
      configured: connection.configured,
      connected: connection.connected,
      mode: connection.mode
    },
    activeDrivers: db.drivers.filter(d => d.isOnline).length,
    activeJobs: db.jobs.filter(j => j.status !== 'COMPLETED').length,
    pendingIdentityVerifications: db.identityApplications.filter(a => a.status === 'IDENTITY_VERIFICATION_PENDING').length
  });
});

app.get('/api/ready', async (req, res) => {
  const connection = await supabaseHelper
    .checkSupabaseConnection()
    .catch((err) => ({ ready: false, connected: false, error: err.message }));
  const status = db.getServicesStatus();
  const locked = status.summary.platformStatus === 'EMERGENCY_LOCKDOWN';
  const ready = Boolean(connection.ready) && !locked;
  // Same rule as /api/health: the 503 says what an orchestrator needs (not ready), and
  // the database's own sentence about why goes to the log.
  if (connection.error) console.warn(`[ready] database detail: ${connection.error}`);
  res.status(ready ? 200 : 503).json({
    ready,
    platformStatus: status.summary.platformStatus,
    database: {
      connected: connection.connected,
      mode: connection.mode
    },
    services: status.summary,
    timestamp: new Date().toISOString()
  });
});

// Track Connected WebSocket Clients with Authentication Handshake
const clients = new Map();

wss.on('connection', (ws, req) => {
  ws.isAuthenticated = false;
  ws.authInfo = null;

  // Unauthenticated Registration Timeout (10 seconds)
  const registrationTimer = setTimeout(() => {
    if (!ws.isAuthenticated && ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'AUTH_ERROR',
          code: 'REGISTRATION_TIMEOUT',
          error: 'WebSocket authentication timeout: REGISTER message with valid token required within 10 seconds.'
        }));
        ws.close(4408, 'Registration Timeout');
      } catch (_) {}
    }
  }, 10000);

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      ws.send(JSON.stringify({
        type: 'ERROR',
        code: 'MALFORMED_JSON',
        error: 'Invalid JSON message payload.'
      }));
      return;
    }

    // Ping / Heartbeat
    if (data.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
      return;
    }

    // Handshake: REGISTER / AUTHENTICATE
    if (data.type === 'AUTHENTICATE' || data.type === 'REGISTER') {
      const token = data.token;
      if (!token) {
        ws.send(JSON.stringify({
          type: 'AUTH_ERROR',
          code: 'AUTH_REQUIRED',
          error: 'WebSocket authentication rejected: Valid session token required.'
        }));
        clearTimeout(registrationTimer);
        ws.close(4401, 'Unauthorized');
        return;
      }

      const session = db.getSessionByToken(token);
      if (!session) {
        ws.send(JSON.stringify({
          type: 'AUTH_ERROR',
          code: 'INVALID_TOKEN',
          error: 'WebSocket authentication rejected: Invalid or expired session token.'
        }));
        clearTimeout(registrationTimer);
        ws.close(4401, 'Unauthorized');
        return;
      }

      // Role check: If declared in payload, verify match with authoritative session
      const isRoleMatch = () => {
        if (!data.role) return true;
        const requested = data.role.toUpperCase();
        const actual = (session.role || '').toUpperCase();
        if (requested === actual) return true;
        if (requested === 'ADMIN' && (actual === 'SUPER_ADMIN' || actual === 'ADMIN')) return true;
        return false;
      };

      if (!isRoleMatch()) {
        ws.send(JSON.stringify({
          type: 'AUTH_ERROR',
          code: 'ROLE_MISMATCH',
          error: `WebSocket role mismatch: Session is ${session.role}, but registration requested ${data.role}.`
        }));
        clearTimeout(registrationTimer);
        ws.close(4403, 'Forbidden');
        return;
      }

      clearTimeout(registrationTimer);
      ws.isAuthenticated = true;
      const normalizedRole = (session.role === 'SUPER_ADMIN' || session.role === 'ADMIN') ? 'admin' : session.role.toLowerCase();
      ws.authInfo = { role: normalizedRole, id: session.entityId, entity: session.entity };
      clients.set(ws, ws.authInfo);
      ws.send(JSON.stringify({ type: 'AUTHENTICATED', role: session.role, id: session.entityId }));
      return;
    }

    // Guard: Every subsequent message requires authenticated socket
    if (!ws.isAuthenticated) {
      ws.send(JSON.stringify({
        type: 'AUTH_ERROR',
        code: 'AUTH_REQUIRED',
        error: 'Unauthorized: Session authentication required. Send REGISTER with valid session token.'
      }));
      clearTimeout(registrationTimer);
      ws.close(4401, 'Unauthorized');
      return;
    }

    // Telemetry: DRIVER_LOCATION_UPDATE
    if (data.type === 'DRIVER_LOCATION_UPDATE') {
      if (ws.authInfo.role !== 'driver') {
        ws.send(JSON.stringify({
          type: 'ERROR',
          code: 'ROLE_FORBIDDEN',
          error: 'Only drivers can update driver location.'
        }));
        return;
      }

      // Anti-spoofing verification: client-supplied driverId must match session
      if (data.driverId && data.driverId !== ws.authInfo.id) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          code: 'IDENTITY_SPOOFING_REJECTED',
          error: 'Driver impersonation rejected: driverId does not match authenticated session.'
        }));
        return;
      }

      const driverId = ws.authInfo.id;
      // Extract coordinates flexibly (supporting nested location, flat lat/lng, or latitude/longitude)
      const rawLat = data.location?.lat ?? data.location?.latitude ?? data.lat ?? data.latitude;
      const rawLng = data.location?.lng ?? data.location?.longitude ?? data.lng ?? data.longitude;
      const heading = Number(data.heading ?? data.bearing ?? data.location?.heading ?? 0) || 0;
      const speed = Number(data.speed ?? data.speedKmph ?? data.location?.speed ?? 0) || 0;
      const jobId = data.jobId ?? data.activeJobId ?? data.location?.jobId ?? null;
      if (jobId) {
        const job = db.getJob(jobId);
        if (!job) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
            error: 'Cannot attach telemetry to an invalid or unassigned job.'
          }));
          return;
        }
        const callerUuid = db.driverRepo?.resolveUuid(driverId) || driverId;
        const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
        if (job.driverId !== driverId && callerUuid !== jobDriverUuid) {
          ws.send(JSON.stringify({
            type: 'ERROR',
            code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
            error: 'Cannot attach telemetry to a job not assigned to you.'
          }));
          return;
        }
      }

      const telemetry = validateDriverTelemetry({
        lat: rawLat,
        lng: rawLng,
        speed: data.speed ?? data.speedKmph ?? data.location?.speed,
        accuracy: data.accuracy ?? data.location?.accuracy,
        heading: data.heading ?? data.bearing ?? data.location?.heading,
        timestamp: data.timestamp ?? data.location?.timestamp
      });
      if (!telemetry.ok) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          code: telemetry.code,
          error: telemetry.message
        }));
        return;
      }
      const { lat, lng } = telemetry.value;
      const reportedSpeed = telemetry.value.speed ?? speed;
      const reportedHeading = telemetry.value.heading ?? heading;

      const locationRecord = db.updateDriverLocation({
        driverId,
        lat,
        lng,
        heading: reportedHeading,
        speed: reportedSpeed,
        accuracy: telemetry.value.accuracy,
        receivedAt: telemetry.value.receivedAt,
        jobId,
        isOnline: true,
        status: jobId ? 'ON_TRIP' : 'AVAILABLE',
        serviceType: 'RIDE'
      });

      // Synchronize in-memory driver location
      const driver = db.getDriver(driverId);
      if (driver) {
        driver.location = { lat, lng };
      }

      // Broadcast to admin:fleet channel
      broadcastToAdmins({
        type: 'DRIVER_LOCATION_UPDATE',
        channel: 'admin:fleet',
        driverId,
        location: locationRecord
      });

      // Broadcast to active trip channel if assigned
      if (jobId) {
        const job = db.getJob(jobId);
        const channelName = job?.type === 'RIDE' ? `ride:${jobId}` : `delivery:${jobId}`;
        broadcast({
          type: 'DRIVER_LOCATION_UPDATE',
          channel: channelName,
          jobId,
          driverId,
          // Position only — this is the customer's live feed. See projectLocationForCustomer.
          location: projectLocationForCustomer(locationRecord)
        });
      }

      ws.send(JSON.stringify({
        type: 'LOCATION_ACK',
        success: true,
        driverId,
        timestamp: locationRecord.updatedAt
      }));
      return;
    }

    // Unrecognized message fallback
    ws.send(JSON.stringify({
      type: 'ERROR',
      code: 'UNKNOWN_MESSAGE_TYPE',
      error: `Unrecognized message type: ${data.type}`
    }));
  });

  ws.on('close', () => {
    clearTimeout(registrationTimer);
    clients.delete(ws);
  });
});

// Broadcast Helpers
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastToDrivers(payload) {
  const msg = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    if (info.role === 'driver' && ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastToCustomer(customerId, payload) {
  const msg = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    if (info.role === 'customer' && info.id === customerId && ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

// The customer's view of a fleet record: position and how old it is, nothing else. Used by both
// the tracking read and the trip-channel broadcast, because they answer the same question and a
// second hand-rolled copy of that answer is how a fleet default reached a customer before.
// `driverId`, `isOnline`, `status`, `serviceType` and the store's name/phone are the admin's and
// the driver's own state, not facts about where their vehicle is.
function projectLocationForCustomer(record) {
  if (!record) return null;
  return {
    lat: record.lat ?? null,
    lng: record.lng ?? null,
    heading: record.heading ?? null,
    speed: record.speed ?? null,
    accuracy: record.accuracy ?? null,
    receivedAt: record.receivedAt ?? null,
    updatedAt: record.updatedAt ?? null
  };
}

// A customer reading their own account, minus `rating`. `users.rating NUMERIC(3,2) DEFAULT 5.00`
// (001_central_schema.sql:22) and there is no reviews or ratings table in this schema, so the
// score every account carries is the column default — the same ruling migration 034 made for
// `merchants.rating` and #138 made for `drivers.rating`. The hydrator makes it worse than the
// DDL: `parseFloat(row.rating || 5.0)` (database.js:1704) turns a NULL into 5.0 before any route
// sees it, so an account with no rating at all reads as a perfect one.
//
// This is a projection, not a store change: the driver and admin reads that still answer with
// `users.rating` are their own slices to adjudicate, and the Driver app's star comes from
// `buildDriverHomePayload`, not from here.
function projectUserForSelf(entity) {
  if (!entity) return entity;
  const { rating, ...rest } = entity;
  return rest;
}

function broadcastToMerchant(merchantId, payload) {
  const msg = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    if (info.role === 'merchant' && info.id === merchantId && ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastToAdmins(payload) {
  const msg = JSON.stringify(payload);
  for (const [ws, info] of clients.entries()) {
    if (info.role === 'admin' && ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

function broadcastAll(payload) {
  const msg = JSON.stringify(payload);
  for (const [ws] of clients.entries()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(msg);
    }
  }
}

// -------------------------------------------------------------
// UNIVERSAL AUTHENTICATION & RBAC MIDDLEWARE
// -------------------------------------------------------------
const activeAdminSessions = new Map();

// `activeAdminSessions` is keyed by the plaintext bearer and `db.activeSessions` by its
// SHA-256, so the two only line up through this conversion. Revocation has to clear
// both: the first lookup on every guarded request is this Map, so leaving an entry here
// while deleting the store row means the session an operator just revoked keeps working
// until this process restarts.
function localAdminSessionHandle(token) {
  return db.hashSessionToken(String(token || '').replace(/^Bearer\s+/, '').trim());
}

function dropLocalAdminSessionsByHandle(handles) {
  const wanted = new Set(handles);
  let dropped = 0;
  for (const token of Array.from(activeAdminSessions.keys())) {
    if (wanted.has(localAdminSessionHandle(token))) {
      activeAdminSessions.delete(token);
      dropped += 1;
    }
  }
  return dropped;
}

function dropLocalAdminSessionsForAccount(adminId) {
  const wanted = String(adminId || '');
  let dropped = 0;
  for (const [token, principal] of Array.from(activeAdminSessions.entries())) {
    if (String(principal && principal.id) === wanted) {
      activeAdminSessions.delete(token);
      dropped += 1;
    }
  }
  return dropped;
}

async function authenticateUser(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Customer session token required. Please log in with Bearer token.',
      requestId: req.id
    });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired customer session token. Please log in.',
      requestId: req.id
    });
  }

  if (session.role !== 'CUSTOMER') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Customer role required.',
      requestId: req.id
    });
  }

  // A bearer is proof of a sign-in, not proof that the account is still open. Suspension
  // revokes sessions as it writes, but that revocation can fail while the status change
  // succeeds — and this gate is what keeps such an account from buying in the meantime.
  // Express 4 does not catch a rejected async middleware, so the outage path is answered
  // here rather than left to hang the socket.
  try {
    const refusal = await db.customerSessionRefusal(session);
    if (refusal) {
      return res.status(refusal.status).json({
        success: false,
        code: refusal.code,
        error: refusal.error,
        requestId: req.id
      });
    }
  } catch (err) {
    return res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_ACCOUNT_STATE_UNREADABLE',
      error: err.message,
      requestId: req.id
    });
  }

  req.user = session.entity || db.getUser(session.entityId);
  req.session = session;
  next();
}

/**
 * The same account check `authenticateUser` runs, for the handlers that resolve a bearer in
 * their own body because they accept more than one role (`admin_customers_test.js` INP-10
 * names them). It answers and returns true when the caller must not proceed; a non-customer
 * session is that role's middleware's business, so `customerSessionRefusal` returns null for
 * it and this returns false.
 */
async function refusedClosedCustomerAccount(req, res, session) {
  let refusal;
  try {
    refusal = await db.customerSessionRefusal(session);
  } catch (err) {
    // Express 4 does not catch a rejected async handler, so an unreadable account state is
    // answered here as the outage it is rather than left to hang the socket.
    refusal = {
      status: err.status || err.statusCode || 503,
      code: err.code || 'CUSTOMER_ACCOUNT_STATE_UNREADABLE',
      error: err.message
    };
  }
  if (!refusal) return false;
  res.status(refusal.status).json({
    success: false,
    code: refusal.code,
    error: refusal.error,
    requestId: req.id
  });
  return true;
}

function authenticateDriver(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Driver authentication token required. Please log in with Bearer token.',
      requestId: req.id
    });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired driver session token.',
      requestId: req.id
    });
  }

  const driver = session.entity || db.getDriver(session.entityId);
  if (!driver) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Driver profile not found.',
      requestId: req.id
    });
  }

  if (!driver.userId && !driver.user_id) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Driver profile is not linked to an active user account. Account linkage required before Driver App operations.',
      code: 'UNLINKED_DRIVER_ACCOUNT',
      requestId: req.id
    });
  }

  if (driver.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      error: `Driver account is suspended: ${driver.suspensionReason || 'Compliance review'}`,
      requestId: req.id
    });
  }

  req.driver = driver;
  req.session = session;
  next();
}

function authenticateMerchant(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Merchant authentication token required. Please log in with Bearer token.',
      requestId: req.id
    });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired merchant session token.',
      requestId: req.id
    });
  }

  if (session.role !== 'MERCHANT') {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Merchant role required.',
      requestId: req.id
    });
  }

  let merchant = session.entity || (db.getMerchant ? db.getMerchant(session.entityId) : null);
  if (!merchant && db.restaurants) {
    merchant = db.restaurants.find(r => r.id === session.entityId || r.restaurantId === session.entityId);
  }
  if (!merchant && session.entityId) {
    merchant = { id: session.entityId, name: 'Partner Merchant' };
  }

  if (!merchant) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Merchant profile not found.',
      requestId: req.id
    });
  }

  req.merchant = merchant;
  req.session = session;
  next();
}

function requireMerchantTenant(req, res, next) {
  if (!req.merchant) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Merchant context required.',
      requestId: req.id
    });
  }

  const tenantId = req.merchant.tenantId || req.merchant.tenant_id || req.merchant.id;
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Merchant is not associated with a tenant. Tenant binding required.',
      code: 'MERCHANT_TENANT_REQUIRED',
      requestId: req.id
    });
  }

  req.merchantTenantId = tenantId;
  next();
}

// -----------------------------------------------------------------------------
// Merchant service entitlements (PHASE 10)
//
// `merchants.merchant_type` has been a real, CHECK-constrained column since
// migration 001 — `('RESTAURANT','GROCERY','HYBRID_BOTH')`, i.e. exactly
// restaurant-only / instamart-only / both. Until now it was consulted on the two
// CUSTOMER-facing booking paths and nowhere else: all 11 `/api/merchant/*` routes
// and the grocery merchant writes carried `authenticateMerchant` +
// `requireMerchantTenant` only. Tenant isolation was therefore intact (a merchant
// could never touch another merchant's rows) while *service* authorisation was
// absent, so a restaurant-only store could POST to `/api/merchant/inventory` or
// `/api/grocery/products/:id/price`, and a grocery-only store could flip a
// restaurant menu item.
//
// Hiding the module in Flutter would not fix that: the server has to decide. This
// is the "AUTHORIZED SERVICE ENTITLEMENTS" rung between merchant identity and
// resource ownership.
//
// Note it reads PostgreSQL rather than `req.merchant`. `database.js` carries no
// `merchant_type` at all, so the in-memory merchant object cannot answer the
// question, and `authenticateMerchant` may also have handed the request a session
// `entity` snapshot or the synthetic `{ name: 'Partner Merchant' }` fallback. An
// entitlement that cannot be established is refused: a merchant whose record the
// platform cannot read is not a merchant who is entitled to everything.
// -----------------------------------------------------------------------------
const MERCHANT_SERVICE_ALIASES = {
  RESTAURANT: ['RESTAURANT', 'HYBRID_BOTH'],
  GROCERY: ['GROCERY', 'HYBRID_BOTH'],
  // The apps and this file say INSTAMART in a few places; it is the same entitlement.
  INSTAMART: ['GROCERY', 'HYBRID_BOTH']
};

function requireMerchantService(service) {
  const wanted = String(service || '').toUpperCase();
  const allowed = MERCHANT_SERVICE_ALIASES[wanted];
  if (!allowed) {
    // A typo in a route table must not become an open door.
    throw new Error(`requireMerchantService: unknown service '${service}'`);
  }

  return async function requireMerchantServiceMiddleware(req, res, next) {
    try {
      if (!req.merchant) {
        return res.status(401).json({
          success: false,
          code: 'MERCHANT_AUTH_REQUIRED',
          error: 'Unauthorized: Merchant authentication required.',
          requestId: req.id
        });
      }

      const merchantId = req.merchant.id || req.merchant.merchantId;
      let row = null;
      try {
        row = await db.orderRepo.resolveMerchant(merchantId);
      } catch (readErr) {
        if (supabaseHelper.isStoreUnreachable(readErr)) {
          return replyStoreError(res, req, readErr, 'merchant service entitlement');
        }
        throw readErr;
      }

      const actual = row && (row.merchant_type || row.merchantType);
      if (!actual) {
        return res.status(403).json({
          success: false,
          code: 'MERCHANT_IDENTITY_UNRESOLVED',
          error: 'Forbidden: this merchant account could not be resolved to a service entitlement.',
          requestId: req.id
        });
      }

      if (!allowed.includes(String(actual).toUpperCase())) {
        return res.status(403).json({
          success: false,
          code: 'MERCHANT_TYPE_MISMATCH',
          error: `Forbidden: this merchant is authorized for ${actual}, not for ${wanted} service.`,
          merchantType: actual,
          requestedService: wanted,
          requestId: req.id
        });
      }

      // Published for the handler and for the entitlement read, so no client has to
      // declare its own service for the server to honour it.
      req.merchantService = wanted;
      req.merchantType = actual;
      return next();
    } catch (err) {
      if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'merchant service entitlement');
      console.error('[merchant service entitlement] failed:', err);
      return res.status(err.status || 500).json({
        success: false,
        code: err.code || 'SERVICE_ENTITLEMENT_CHECK_FAILED',
        error: err.message,
        requestId: req.id
      });
    }
  };
}

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Administrator authentication token required. Please log in with Bearer token.',
      requestId: req.id
    });
  }

  let admin = activeAdminSessions.get(token);
  if (!admin) {
    const session = db.getSessionByToken(token);
    // Any of the five roles the schema allows, not just two of them. The session's
    // `role` is the account's own role — the password path writes `admin.role` and the
    // OTP path does the same — so an OPERATIONS or KYC_SPECIALIST token that reached
    // this branch was a real, live session that the door refused to read, and the
    // holder was signed out at every restart and, on the OTP path, from the start.
    if (session && db.isAdminSessionRole(session.role)) {
      admin = session.entity;
    }
  }

  if (!admin) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired administrator session token. Please log in.',
      requestId: req.id
    });
  }

  // A token outlives the account it was issued to unless something re-checks.
  // Without this, deactivating an administrator changed the admin list and not
  // the access: every already-signed-in control kept working, including the
  // ones that had just been withdrawn for cause.
  const enrolled = db.adminUsers.find(a => a.id === admin.id || (a.username && a.username === admin.username));
  if (enrolled && enrolled.status === 'INACTIVE') {
    activeAdminSessions.delete(token);
    return res.status(401).json({
      success: false,
      code: 'ADMIN_ACCOUNT_DEACTIVATED',
      error: 'Unauthorized: this administrator account has been deactivated.',
      requestId: req.id
    });
  }

  req.admin = admin;
  next();
}

// The predicate and both middlewares sit in `adminPermissions.js` with the grants they read
// (see the note there). Requiring them by these names keeps every route line in the shape
// the authorization matrix parses.
const { adminHoldsPermission, requirePermission, requireIdentityDecision } = require('./adminPermissions');

function requireSuperAdmin(req, res, next) {
  if (!req.admin) {
    return res.status(401).json({ success: false, error: 'Authentication required', requestId: req.id });
  }
  if (req.admin.role === 'SUPER_ADMIN') return next();
  return res.status(403).json({
    success: false,
    error: `Access Denied: This control is restricted to SUPER_ADMIN. Current role: ${req.admin.role}`,
    requestId: req.id
  });
}

// -------------------------------------------------------------
// CENTRALIZED AUTH & OTP REST API ENDPOINTS
// -------------------------------------------------------------

// Send Verification OTP to Mobile Number
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { phone, role = 'CUSTOMER', purpose = 'LOGIN' } = req.body;
    const result = await db.sendAuthOtp({ phone, role, purpose });
    res.json(result);
  } catch (err) {
    // Same rule as verify-otp: an audit store that cannot answer is an outage
    // (503, retry me), not a bad phone number (400, give up).
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'OTP_DISPATCH_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

// Verify Mobile OTP & Issue Session Token
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { phone, otp, role = 'CUSTOMER', purpose = 'LOGIN' } = req.body;
    const result = await db.verifyAuthOtp({ phone, otp, role, purpose });
    res.json(result);
  } catch (err) {
    // A store that cannot answer is an outage, not a wrong code. Answering 400
    // here tells the app to tell the user their OTP is bad, and a client that
    // believes it throws away a code that would have worked seconds later.
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'OTP_VERIFICATION_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

// Get Current Authenticated Profile
app.get('/api/auth/me', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '') || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No session token provided.' });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token.' });
  }

  // A client decides "am I signed in, and who am I" from this route, so it cannot be
  // allowed to answer that question for a closed account from a mint-time snapshot —
  // otherwise a suspension whose revocation failed shows an app its owner is still a
  // customer while every call that spends money is refused.
  try {
    const refusal = await db.customerSessionRefusal(session);
    if (refusal) {
      return res.status(refusal.status).json({
        success: false,
        code: refusal.code,
        error: refusal.error,
        requestId: req.id
      });
    }
  } catch (err) {
    return res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_ACCOUNT_STATE_UNREADABLE',
      error: err.message,
      requestId: req.id
    });
  }

  res.json({
    success: true,
    role: session.role,
    // The caller's own record — and for a customer that record's `rating` is a schema default,
    // not a measurement, so it is not handed to them as a score about themselves.
    user: session.role === 'CUSTOMER' ? projectUserForSelf(session.entity) : session.entity,
    // Echo the caller's own credential: restored sessions are keyed by token hash,
    // so session.token is not something the client can present again.
    token,
    expiresAt: session.expiresAt
  });
});

// Invalidate Session / Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '') || req.body.token;

  if (token) {
    db.invalidateSession(token);
    activeAdminSessions.delete(token);
  }

  res.json({ success: true, message: 'Logged out successfully.' });
});

// The customer's own profile: name and email.
//
// Two fields, because those are the two a customer is entitled to state about
// themselves. `users.name` and `users.email` (001_central_schema.sql:18-19) previously had
// one writer each and neither was the customer: sign-in mints a placeholder address
// (`<phone>@user.nabin.in`, database.js) and the identity submission copies whatever the
// applicant typed into both columns. So the profile screen could display a name and an
// address but could not change either, and the app told people to phone NABIN about a
// spelling of their own name.
//
// What is NOT here, and why:
//
//   * No id in the path or the body. The row is the one `authenticateUser` resolved from
//     the bearer token, so there is no way to aim this at somebody else's account — a
//     `userId` in the body is not honoured, it is dropped by the domain validator.
//   * No phone, date of birth, address, wallet, account status, identity status or rating.
//     Phone is the sign-in credential and changing it is a credential flow, not a profile
//     edit; identity status and account status are NABIN's decisions about a person, not
//     theirs; and `rating` is a column default with no reviews table behind it (#140), so
//     a write here could only invent one.
//   * No email verification. This backend has no mail transport and the schema has no
//     verification column, so the address is stored as stated and never as confirmed.
//     Nothing in the response claims otherwise, and the app must not either.
app.patch('/api/customer/profile', authenticateUser, async (req, res) => {
  try {
    const result = await db.updateOwnCustomerProfile(req.user, req.body || {});
    res.json({
      success: true,
      // The row as it now stands in PostgreSQL, not what the caller sent: the customer's
      // name is normalised by trimming and an address by lowercasing, and the app has to
      // show what was stored rather than what was typed.
      profile: result.profile,
      changed: result.changed,
      dataSource: result.dataSource,
      persisted: result.persisted,
      requestId: req.id
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'customer profile');
    // 400 for a value outside the domain, 409 for an address that is somebody else's or a
    // session that cannot be traced to a directory row, 503 for a server not connected to
    // the store the profile lives in. All three are the customer's answer to be told, so
    // none of them may be flattened into a 500.
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'CUSTOMER_PROFILE_UPDATE_FAILED',
      error: err.message,
      ...(err.field ? { field: err.field } : {}),
      requestId: req.id
    });
  }
});

// Refresh / Validate Token
app.post('/api/auth/refresh-token', async (req, res) => {
  const { token } = req.body;
  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Session token invalid or expired.' });
  }

  // "Refresh" is a second place a closed account can be told it is still current, so it
  // asks the same question the profile read asks.
  try {
    const refusal = await db.customerSessionRefusal(session);
    if (refusal) {
      return res.status(refusal.status).json({
        success: false,
        code: refusal.code,
        error: refusal.error,
        requestId: req.id
      });
    }
  } catch (err) {
    return res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_ACCOUNT_STATE_UNREADABLE',
      error: err.message,
      requestId: req.id
    });
  }

  // Same ruling as the profile read above: this route echoes the whole session, entity
  // included, so a customer session goes through the same projection.
  res.json({
    success: true,
    valid: true,
    session: Object.assign({}, session, {
      token,
      entity: session.role === 'CUSTOMER' ? projectUserForSelf(session.entity) : session.entity
    })
  });
});

// -------------------------------------------------------------
// PLATFORM SERVICE CONTROLS & EMERGENCY SWITCHBOARD
// -------------------------------------------------------------
app.get('/api/services/status', (req, res) => {
  res.json(db.getServicesStatus());
});

app.get('/api/admin/services/status', authenticateAdmin, (req, res) => {
  res.json(db.getServicesStatus());
});

app.post('/api/admin/services/pause', authenticateAdmin, requirePermission('services.pause'), async (req, res) => {
  try {
    const { serviceId, reason, durationMinutes, region, broadcastNotice } = req.body;
    if (!serviceId) {
      return res.status(400).json({ success: false, error: 'serviceId is required (e.g. "rides", "grocery", "food", "parcel", "payments", "dispatch", or "ALL").' });
    }
    const result = await db.pauseService({
      serviceId,
      reason,
      durationMinutes,
      region,
      broadcastNotice,
      adminUser: req.admin
    });
    await db.persistServiceState();

    const statusObj = db.getServicesStatus();
    broadcastAll({
      type: 'SERVICE_STATUS_CHANGED',
      serviceId,
      action: 'PAUSE',
      status: 'PAUSED',
      reason,
      durationMinutes,
      region,
      services: statusObj.services,
      summary: statusObj.summary
    });

    res.json({
      success: true,
      message: result.message,
      service: result.service || null,
      summary: statusObj.summary
    });
  } catch (err) {
    // `persistServiceState` now throws when the switchboard could not be mirrored into
    // PostgreSQL, and that is a 503-shaped outage, not a 400-shaped bad request.
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.post('/api/admin/services/resume', authenticateAdmin, requirePermission('services.resume'), async (req, res) => {
  try {
    const { serviceId, reason } = req.body;
    if (!serviceId) {
      return res.status(400).json({ success: false, error: 'serviceId is required (e.g. "rides", "grocery", "food", "parcel", "payments", "dispatch", or "ALL").' });
    }
    const result = await db.resumeService({
      serviceId,
      reason,
      adminUser: req.admin
    });
    await db.persistServiceState();

    const statusObj = db.getServicesStatus();
    broadcastAll({
      type: 'SERVICE_STATUS_CHANGED',
      serviceId,
      action: 'RESUME',
      status: 'ACTIVE',
      reason,
      services: statusObj.services,
      summary: statusObj.summary
    });

    res.json({
      success: true,
      message: result.message,
      service: result.service || null,
      summary: statusObj.summary
    });
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.post('/api/admin/services/emergency-killswitch', authenticateAdmin, requirePermission('services.emergency_killswitch'), async (req, res) => {
  try {
    const { activate, reason } = req.body;
    // The direction has to be named. `if (activate)` read a missing field as
    // "deactivate", so a client that dropped the parameter — a form serialized without
    // it, a retried request with an empty body — pulled the emergency lockdown *up*
    // instead of pulling it down, and answered 200 either way. A control whose silence
    // means the opposite of what an operator meant is not a fail-safe.
    if (typeof activate !== 'boolean') {
      return res.status(400).json({
        success: false,
        code: 'KILLSWITCH_DIRECTION_REQUIRED',
        error: 'activate must be true or false. This endpoint will not guess which way the emergency switch goes.',
        requestId: req.id
      });
    }
    let result;
    if (activate) {
      result = await db.pauseService({
        serviceId: 'ALL',
        reason: reason || 'Master Emergency Killswitch activated by Super Admin',
        adminUser: req.admin
      });
    } else {
      result = await db.resumeService({
        serviceId: 'ALL',
        reason: reason || 'Master Emergency Killswitch deactivated by Super Admin',
        adminUser: req.admin
      });
    }
    await db.persistServiceState();

    const statusObj = db.getServicesStatus();
    broadcastAll({
      type: 'SERVICE_STATUS_CHANGED',
      serviceId: 'ALL',
      action: activate ? 'EMERGENCY_KILLSWITCH_ACTIVATED' : 'EMERGENCY_KILLSWITCH_DEACTIVATED',
      status: activate ? 'PAUSED' : 'ACTIVE',
      reason,
      services: statusObj.services,
      summary: statusObj.summary
    });

    res.json({
      success: true,
      message: result.message,
      summary: statusObj.summary
    });
  } catch (err) {
    // The killswitch is the one control an operator must never be able to believe they
    // pulled when it did not stick, so a failed mirror is reported as a 503 outage here
    // rather than a 200 or a caller-blaming 400.
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

  const bootstrapAttempts = new Map();

  // Secure First Admin Bootstrap Mechanism
  app.post('/api/admin/bootstrap', async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = bootstrapAttempts.get(ip) || { count: 0, lockedUntil: 0 };

    const GENERIC_ERROR = 'Bootstrap failed or not available.';

    // 1. Strict IP-based rate limiting (Progressive Lockout)
    if (now < attempt.lockedUntil) {
      return res.status(403).json({ success: false, error: GENERIC_ERROR });
    }

    // 2. Verify Bootstrap is active
    if (db.adminUsers && db.adminUsers.length > 0) {
      return res.status(403).json({ success: false, error: GENERIC_ERROR });
    }

    // 3. Validate Bootstrap Secret
    const { bootstrapSecret, username, password } = req.body;
    
    let isSecretValid = false;
    if (process.env.ADMIN_BOOTSTRAP_SECRET && bootstrapSecret) {
      const bufExpected = Buffer.from(String(process.env.ADMIN_BOOTSTRAP_SECRET));
      const bufActual = Buffer.from(String(bootstrapSecret));
      if (bufExpected.length === bufActual.length) {
        isSecretValid = crypto.timingSafeEqual(bufExpected, bufActual);
      }
    }
    
    if (!isSecretValid) {
      attempt.count += 1;
      // Exponential backoff: count=1 -> 2s, count=2 -> 4s, count=3 -> 8s... capped at 1 hour
      const penaltyMs = Math.min(Math.pow(2, attempt.count) * 1000, 3600000);
      attempt.lockedUntil = now + penaltyMs;
      bootstrapAttempts.set(ip, attempt);
      return res.status(403).json({ success: false, error: GENERIC_ERROR });
    }

    // Reset attempts on successful secret
    bootstrapAttempts.delete(ip);

    // 4. Validate Inputs
    if (!username || !password || password.length < 8) {
      return res.status(403).json({ success: false, error: GENERIC_ERROR });
    }

    // 5. Create First Admin
    const crypto = require('crypto');
    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = crypto.scryptSync(password, salt, 64).toString('hex');

    const { grantsForRole } = require('./adminPermissions');
    const firstAdmin = {
      id: 'adm_bootstrap_1',
      username,
      name: 'System Administrator',
      role: 'SUPER_ADMIN',
      email: 'admin@nabin.in',
      salt,
      passwordHash,
      // The same list the boot sync and provisioning derive from the role, so there is
      // one answer to "what can this role do" instead of a fourth copy that can drift.
      permissions: [...grantsForRole('SUPER_ADMIN')]
    };

    db.adminUsers = [firstAdmin];
    await db.createAuditLog({ action: 'ADMIN_BOOTSTRAP', module: 'SECURITY', adminId: 'SYSTEM', details: 'First SUPER_ADMIN account securely bootstrapped.', ip });
    
    // Save to PostgreSQL if configured
    if (supabaseHelper.isLivePostgres && supabaseHelper.supabaseAdmin) {
      try {
        await supabaseHelper.supabaseAdmin.from('admin_accounts').upsert([{
          username: firstAdmin.username,
          name: firstAdmin.name,
          email: firstAdmin.email,
          role: firstAdmin.role,
          department: 'Operations',
          password_hash: firstAdmin.passwordHash,
          password_salt: firstAdmin.salt,
          is_active: true
        }], { onConflict: 'username' });
      } catch (e) {
        console.warn('⚠️ Admin PG sync notice:', e.message);
      }
    }

    // Save to persistent storage if available
    const persistentStore = require('./database/persistentStore');
    persistentStore.saveStateSync(db);

    res.json({ success: true, message: 'Administrator bootstrapped successfully.' });
  });

// Admin Login with Brute-Force Protection & Password Hashing Verification
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.', requestId: req.id });
  }

  const authResult = db.verifyAdminCredentials(username, password);

  if (!authResult.success) {
    try {
      await db.createAuditLog({
        adminId: 'GUEST',
        adminName: username || 'Unknown',
        role: 'GUEST',
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        targetEntityType: 'ADMIN_SESSION',
        targetEntityId: 'LOGIN',
        previousState: 'UNAUTHENTICATED',
        newState: 'FAILED',
        reason: `Failed login attempt for username: ${username}. Detail: ${authResult.error}`,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
      });
    } catch (auditErr) {
      console.error('[WARN] Failed to create audit log for failed login:', auditErr.message);
    }

    return res.status(authResult.locked ? 429 : 401).json({
      success: false,
      error: authResult.error,
      requestId: req.id
    });
  }

  // The password proves the caller knows the secret. Only the authoritative store
  // decides whether that account still exists and is still enabled, so this reads
  // it rather than trusting the copy this process took when it booted — and when
  // the store cannot answer, the login is refused instead of granted from memory.
  let gate;
  try {
    gate = await db.authoritativeAdminByUsername(authResult.admin.username || username);
  } catch (err) {
    return res.status(err.status || 503).json({
      success: false,
      code: err.code || 'AUTH_STORE_UNAVAILABLE',
      error: err.message,
      requestId: req.id
    });
  }
  if (gate.checked && !gate.account) {
    // Deliberately the same message as a wrong password: an account removed from
    // the store is not something to confirm to whoever just typed its name.
    return res.status(401).json({
      success: false,
      error: 'Invalid administrator credentials.',
      requestId: req.id
    });
  }
  if (gate.checked && gate.account.is_active === false) {
    const known = db.adminUsers.find(a => a.username === (authResult.admin.username || username));
    if (known) known.status = 'INACTIVE';
    return res.status(401).json({
      success: false,
      code: 'ADMIN_ACCOUNT_DEACTIVATED',
      error: 'Unauthorized: this administrator account has been deactivated.',
      requestId: req.id
    });
  }

  const admin = authResult.admin;
  // OP-1: effective permission = role grants UNION this operator's additive grants, and the
  // answer is taken from the durable store at authentication rather than from the copy this
  // process made when it booted. `admin` is the live mirror entry, so refreshing it here also
  // corrects what an already-issued token of this process will be checked against.
  await db.refreshAuthorizationFor(admin, gate.account);
  // Bearer credential: must come from a CSPRNG, not Date.now()+Math.random().
  const token = `adm_token_${require('crypto').randomBytes(32).toString('base64url')}`;
  // What the session carries is *who* is signed in. `admin` is the record the credential
  // check loaded, salt and password hash included, and this object is both written into
  // `backend_sessions` and handed back by `/api/admin/me` — so carrying it whole copied a
  // crackable credential pair into a table read on every request. `registerSession`
  // strips it again; doing it here as well keeps the in-process map honest.
  const principal = db.withoutCredentialFields(admin);
  const session = {
    token,
    role: admin.role,
    entityId: admin.id,
    entity: principal,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  };

  activeAdminSessions.set(token, principal);
  await db.registerSession(session);

  try {
    await db.auditAuthoritative({
      adminId: admin.id,
      adminName: admin.name,
      role: admin.role,
      action: 'ADMIN_LOGIN',
      module: 'AUTH',
      targetEntityType: 'ADMIN_SESSION',
      targetEntityId: admin.id,
      previousState: 'OFFLINE',
      newState: 'ONLINE',
      reason: `Admin login successful. Role: ${admin.role}`,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
    });
  } catch (auditErr) {
    // A control-plane session the audit trail cannot show is a session nobody can
    // later account for, so it is taken back rather than handed out.
    activeAdminSessions.delete(token);
    db.invalidateSession(token);
    return res.status(auditErr.status || 503).json({
      success: false,
      code: auditErr.code || 'AUTH_AUDIT_STORE_UNAVAILABLE',
      error: auditErr.message,
      requestId: req.id
    });
  }

  res.json({
    success: true,
    token,
    expiresAt: session.expiresAt,
    admin: {
      id: admin.id,
      name: admin.name,
      username: admin.username,
      role: admin.role,
      email: admin.email,
      permissions: admin.permissions
    }
  });
});

// Admin Password Recovery & Reset (Authenticated Gateway)
app.post('/api/admin/reset-password', authenticateAdmin, async (req, res) => {
  try {
    const { identifier, username, newPassword, currentPassword } = req.body;
    const targetIdentifier = identifier || username || req.admin.username || req.admin.email;
    const isSelf = targetIdentifier.toLowerCase() === (req.admin.username || '').toLowerCase() || targetIdentifier.toLowerCase() === (req.admin.email || '').toLowerCase();
    // `admin.manage` was tested here for as long as this route has existed, and nothing
    // has ever granted it: the name in the matrix is `admin_accounts.manage`. A check
    // against a string no one holds is not a narrow gate, it is a dead branch that reads
    // like one. The answer now comes from the same predicate `requirePermission` uses. The
    // name stays `isSuperAdmin` because that is the parameter `resetAdminPassword` reads.
    const isSuperAdmin = adminHoldsPermission(req.admin, 'admin_accounts.manage');

    if (!isSelf && !isSuperAdmin) {
      return res.status(403).json({
        success: false,
        code: 'ADMIN_PASSWORD_RESET_FORBIDDEN',
        error: 'Forbidden: Only SUPER_ADMIN can reset other administrators\' passwords.',
        requestId: req.id
      });
    }

    if (isSelf && !currentPassword && !isSuperAdmin) {
      return res.status(400).json({ success: false, code: 'CURRENT_PASSWORD_REQUIRED', error: 'Current password is required to reset password.', requestId: req.id });
    }

    const result = await db.resetAdminPassword({
      identifier: targetIdentifier, newPassword, currentPassword, isSuperAdmin,
      actor: { id: req.admin.id, username: req.admin.username, name: req.admin.name, role: req.admin.role }
    });
    res.json(result);
  } catch (err) {
    // A credential the directory refused to store, or a trail that could not
    // record the change, is an outage (5xx) and not a rejected form (4xx) — the
    // caller did nothing wrong and retrying may work.
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'ADMIN_PASSWORD_RESET_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

app.get('/api/admin/me', authenticateAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// -------------------------------------------------------------
// 1. GLOBAL ADMINISTRATIVE AUDIT LOG TRAIL (POSTGRES AUTHORITATIVE)
// -------------------------------------------------------------
app.get('/api/admin/audit-logs', authenticateAdmin, requirePermission('audit.view'), async (req, res) => {
  try {
    const filters = {
      module: req.query.module || 'ALL',
      action: req.query.action || 'ALL',
      adminId: req.query.adminId || 'ALL',
      search: req.query.search || '',
      applicationId: req.query.applicationId || null,
      targetEntityType: req.query.targetEntityType || null,
      targetEntityId: req.query.targetEntityId || null,
      limit: req.query.limit || 100,
      offset: req.query.offset || 0
    };

    if (db.auditLogRepo && typeof db.auditLogRepo.list === 'function') {
      const result = await db.auditLogRepo.list(filters);
      return res.json({ success: true, logs: result.logs, total: result.total });
    }

    const logs = db.getAuditLogs(filters);
    res.json({ success: true, logs, total: logs.length });
  } catch (err) {
    console.error('Failed to fetch audit logs:', err.message);
    res.status(500).json({ success: false, error: 'Failed to retrieve administrative audit logs.' });
  }
});

// -------------------------------------------------------------
// FLEET & DRIVER ACTIVITIES & TELEMETRY
// -------------------------------------------------------------
// These five admin reads used to be registered with no middleware at all, so an
// unauthenticated caller could list every driver with phone numbers, document paths and
// wallet balances, or read the platform's gross fare totals. They are admin sessions only
// from here. The coarse gate is deliberate: the fine-grained `drivers.read` /
// `payments.read` matrix the admin specification calls for does not exist yet, and no
// permission string can be enforced before it is persisted — see
// docs/ADMIN_FEATURE_SPECIFICATION.md, section "Permission matrix".
//
// The customer directory is the exception, and it is not coarse: `GET /api/admin/customers`
// asks for `customers.read` and projects an account rather than a row, because the
// specification's §4 matrix names that grant for three of the five roles. These routes
// answer for every administrator session, so a driver or wallet listing stays here while
// its own grant is still unbuilt.
app.get('/api/admin/drivers', authenticateAdmin, (req, res) => {
  const category = req.query.category || 'ALL';
  let list = db.drivers || [];
  if (category !== 'ALL') {
    list = list.filter(d => d.category === category);
  }
  res.json({ success: true, drivers: list, total: list.length });
});

app.get('/api/admin/drivers/:id', authenticateAdmin, (req, res) => {
  const driver = (db.drivers || []).find(d => d.id === req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });
  res.json({ success: true, driver });
});

app.post('/api/admin/drivers/:id/status', authenticateAdmin, requirePermission('fleet.manage'), async (req, res) => {
  try {
    const { status, operationalStatus, kycStatus, reason } = req.body;
    const opStatus = operationalStatus || status;
    const result = await db.setDriverStatus(req.params.id, opStatus, reason, req.admin.id, req.admin.name, kycStatus);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    // Without this catch an async rejection here was invisible: Express 4 does not forward
    // one, so the request simply hung. A refused audit record is a 503-shaped outage.
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

// -------------------------------------------------------------
// 2. SUPPORT & DISPUTE RESOLUTION (POSTGRESQL-AUTHORITATIVE)
// -------------------------------------------------------------
function requireSupportCallerAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Authentication token required. Please log in with Bearer token.',
      requestId: req.id
    });
  }

  // 1. Check admin sessions
  let admin = activeAdminSessions.get(token);
  if (!admin) {
    const session = db.getSessionByToken(token);
    if (session && (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN')) {
      admin = session.entity || { id: session.entityId, name: 'Admin', role: session.role };
    }
  }
  if (admin) {
    req.admin = admin;
    req.caller = {
      id: admin.id || 'admin',
      name: admin.name || 'Admin',
      role: 'ADMIN',
      type: 'ADMIN'
    };
    return next();
  }

  // 2. Check user/driver/merchant session
  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired session token.',
      requestId: req.id
    });
  }

  if (session.role === 'DRIVER') {
    const driver = session.entity || db.getDriver(session.entityId);
    req.driver = driver;
    req.caller = {
      id: session.entityId,
      name: driver ? driver.name : 'Driver',
      role: 'DRIVER',
      type: 'DRIVER'
    };
    return next();
  }

  if (session.role === 'MERCHANT') {
    let merchant = session.entity;
    if (!merchant && db.getMerchant) {
      merchant = db.getMerchant(session.entityId);
    }
    if (!merchant && db.restaurants) {
      merchant = db.restaurants.find(r => r.id === session.entityId || r.restaurantId === session.entityId);
    }
    if (!merchant) {
      return res.status(403).json({
        success: false,
        code: 'MERCHANT_NOT_FOUND',
        error: 'Forbidden: Merchant account not found for session.'
      });
    }
    req.merchant = merchant;
    req.caller = {
      id: session.entityId,
      name: merchant ? merchant.name : 'Merchant',
      role: 'MERCHANT',
      type: 'MERCHANT'
    };
    return next();
  }

  const user = session.entity || db.getUser(session.entityId);
  req.user = user;
  req.caller = {
    id: session.entityId,
    name: user ? user.name : 'Customer',
    role: 'CUSTOMER',
    type: 'CUSTOMER'
  };
  next();
}

app.post('/api/support/ticket', requireSupportCallerAuth, async (req, res) => {
  try {
    const ticket = await db.supportTicketRepo.createTicket(req.caller, req.body);
    broadcastToAdmins({ type: 'NEW_SUPPORT_TICKET', ticket });
    res.json({ success: true, ticket });
  } catch (err) {
    const status = err.statusCode || 400;
    res.status(status).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get('/api/support/user/:userId', requireSupportCallerAuth, async (req, res) => {
  try {
    if (req.caller.role !== 'ADMIN' && req.caller.id !== req.params.userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You can only view your own support tickets.',
        requestId: req.id
      });
    }
    const tickets = await db.supportTicketRepo.getTicketsByUser(req.params.userId, req.caller);
    res.json({ success: true, tickets });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/support/ticket/:id/message', requireSupportCallerAuth, async (req, res) => {
  try {
    const result = await db.supportTicketRepo.addMessage(req.params.id, req.body, req.caller);
    if (!result.success) return res.status(400).json(result);

    broadcastToAdmins({ type: 'TICKET_THREAD_UPDATED', ticketId: req.params.id });
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 400;
    res.status(status).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get('/api/admin/support', authenticateAdmin, requirePermission('support.view'), async (req, res) => {
  try {
    const filters = {
      status: req.query.status || 'ALL',
      category: req.query.category || 'ALL',
      priority: req.query.priority || 'ALL',
      search: req.query.search || ''
    };
    const tickets = await db.supportTicketRepo.getTicketsAdmin(filters);
    res.json({ success: true, tickets, total: tickets.length });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/admin/support/:id/assign', authenticateAdmin, requirePermission('support.respond'), async (req, res) => {
  try {
    const result = await db.supportTicketRepo.assignTicket(req.params.id, req.admin.id, req.admin.name);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

app.post('/api/admin/support/:id/resolve', authenticateAdmin, requirePermission('support.resolve'), async (req, res) => {
  try {
    const { resolutionNotes, refundAmount, specializedData } = req.body;
    const result = await db.supportTicketRepo.resolveTicket(
      req.params.id,
      {
        resolutionNotes,
        refundAmount,
        specializedData: specializedData || req.body
      },
      req.admin.id,
      req.admin.name,
      req.admin.role
    );
    if (!result.success) return res.status(400).json(result);

    broadcastToCustomer(result.ticket.userId, {
      type: 'SUPPORT_TICKET_RESOLVED',
      ticketId: result.ticket.id,
      category: result.ticket.category,
      resolutionType: result.ticket.resolutionType,
      refundAmount: result.ticket.refundAmount
    });

    if (result.ticket.driverId) {
      broadcastToDrivers({
        type: 'DRIVER_DISPUTE_SETTLED',
        ticketId: result.ticket.id,
        driverId: result.ticket.driverId,
        resolutionType: result.ticket.resolutionType,
        driverAdjusted: Boolean(result.driver)
      });
    }

    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// -------------------------------------------------------------
// 3. FINANCE & SETTLEMENTS
// -------------------------------------------------------------
app.get('/api/admin/finance/metrics', authenticateAdmin, requirePermission('finance.view'), async (req, res) => {
  // F1: the metrics are now computed from the authoritative ledger, so a store that cannot
  // answer is an outage (503) rather than a silent return of this process's in-memory seed.
  try {
    res.json({ success: true, metrics: await db.getFinancialMetrics() });
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    res.status(status).json({
      success: false,
      code: err.code || 'FINANCE_METRICS_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

app.get('/api/admin/finance/ledger', authenticateAdmin, requirePermission('finance.view'), (req, res) => {
  let list = [...db.transactions];
  if (req.query.service && req.query.service !== 'ALL') {
    list = list.filter(t => t.title && t.title.toLowerCase().includes(req.query.service.toLowerCase()));
  }
  if (req.query.type && req.query.type !== 'ALL') {
    list = list.filter(t => t.type === req.query.type);
  }
  res.json({ success: true, transactions: list, total: list.length });
});

app.get('/api/admin/finance/settlements/drivers', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  // F3: durable driver set and durable wallet balances. Previously this mapped
  // `db.drivers`, so a driver created after boot never appeared and a balance could be
  // stale by anything another process moved. Response shape, path and authorization are
  // unchanged. A store that cannot answer is a 503, never a shorter list.
  try {
    const driverSettlements = await db.getDriverSettlements();
    res.json({ success: true, driverSettlements });
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    console.error('[API] driver settlements failed:', err.message);
    res.status(status).json({ success: false, code: err.code || 'SETTLEMENTS_READ_FAILED', error: err.message, requestId: req.id });
  }
});

app.post('/api/admin/finance/settlements/drivers/:id/payout', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  // F4: two defects on a money-moving route, both proven by finance_driver_payout_authority_test.js.
  //
  // 1. Addressing. `db.getDriver()` ends in `match || this.drivers[0]`, so it never returns null:
  //    an unknown, mistyped or foreign :id was answered with a DIFFERENT real driver's record, and
  //    that substitute then supplied the wallet default, faced the KYC / cooling / verified-destination
  //    gates and became the payout target itself. The 404 branch below was unreachable dead code.
  //    Existence is now decided exactly - cache, then durable, then a case-insensitive id match - so
  //    every legitimate id form (uuid, DRV-101, drv_1 via the legacy map) still resolves and only the
  //    fabricated stand-in is gone.
  // 2. Amount. The full-balance default was read from this process's mirror, so a wallet changed
  //    elsewhere was paid at a stale number. It now comes from the durable `drivers.wallet_balance`.
  //    The service re-reads that same column and refuses INSUFFICIENT_BALANCE against it, so this is
  //    one authority read twice, not a second wallet authority.
  const requested = String(req.params.id);
  let driver = db.driverRepo ? db.driverRepo.findById(requested) : null;
  if (!driver && db.driverRepo) driver = await db.driverRepo.findByIdAsync(requested);
  if (!driver) {
    driver = (db.drivers || []).find(d => String(d.id).toLowerCase() === requested.toLowerCase()
      || (d.uuid && String(d.uuid) === requested)) || null;
  }
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });

  // Phase 9: Explicit amount validation. A malformed amount must never
  // silently settle the driver's full wallet balance; the full-balance
  // default applies only when no amount is provided at all.
  //
  // F4: that default is no longer computed here from `driver.walletBalance`, because this
  // process's mirror can be behind the database by whatever another process moved. An
  // omitted amount is passed down as null and resolved inside recordPayout from the
  // durable `drivers` row it refreshes for every other payout gate - one durable read,
  // one implementation, and the INSUFFICIENT_BALANCE check below it stays as it was.
  let amount = null;
  if (req.body.amount !== undefined && req.body.amount !== null) {
    const parsed = Number(req.body.amount);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid payout amount', code: 'INVALID_AMOUNT' });
    }
    amount = parsed;
  }

  // The third argument has always been ignored: the destination paid out is the *verified*
  // one on the driver record, never one supplied in the request. Left that way on purpose.
  //
  // This call is awaited. It previously was not, which meant `result` was a Promise:
  // `result.success` was undefined, the branch below never ran, the SETTLEMENT_EXECUTED
  // audit was never written, and `res.json(result)` serialised a live Promise to `{}` -
  // so the admin saw an empty body for an operation whose money had already moved.
  // The route has no outer try/catch, so awaiting it without a guard would let a
  // rejected store call hang the request - Express 4 does not forward async
  // rejections. A failure is answered as a failure, and says whether money moved.
  let result;
  try {
    result = await db.recordPayout(driver.id, amount, driver.upiId,
      { idempotencyKey: readIdempotencyHeader(req) });
  } catch (err) {
    // An idempotency conflict is a DETERMINISTIC refusal, not an unknown outcome: the key is
    // already booked for different financial semantics, nothing moved, and repeating the same
    // body can never succeed. E2 established the classification, the ledger produces it, and
    // POST /api/admin/finance/refund already answers it as 409 - so answering "outcome
    // unknown, retry with the same key" here was misleading. Every other store failure keeps
    // the existing 503.
    if (err && err.code === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({
        success: false,
        code: 'IDEMPOTENCY_CONFLICT',
        error: err.message,
        note: 'No payout was made. This Idempotency-Key already belongs to a different payout; '
          + 'resend the original amount, or use a new key for a new operation.'
      });
    }
    return res.status(503).json({
      success: false,
      code: 'PAYOUT_OUTCOME_UNKNOWN',
      error: err.message,
      note: 'The payout could not be completed or confirmed. Retry with the same Idempotency-Key: '
        + 'if the money did move, the replay returns the original result instead of paying twice.'
    });
  }
  if (!result || result.success !== true) {
    return res.status(400).json(result || { success: false, error: 'Payout produced no result' });
  }
  if (result.duplicate === true) {
    // Phase 13's identity did its job: this is a replay of an operation that already
    // moved money. Report it as the original outcome without writing a second audit.
    return res.json(result);
  }
  {
    // This awaited the audit write with no catch, so a refused record after a real payout
    // left the client waiting for an answer that never came — Express 4 does not forward an
    // async rejection. The money has moved by this point whatever the trail says, so the
    // response says exactly that: 503 for the record, and the payout it is missing.
    try {
      await db.auditAppliedChange({
        adminId: req.admin.id,
        adminName: req.admin.name,
        role: req.admin.role,
        action: 'SETTLEMENT_EXECUTED',
        module: 'FINANCE',
        targetEntityType: 'DRIVER_PAYOUT',
        targetEntityId: driver.id,
        previousState: 'PENDING',
        newState: 'PAID',
        reason: `Admin payout of ₹${typeof result.amount === 'number' ? result.amount : amount} executed to ${driver.upiId}`
      });
    } catch (auditErr) {
      return res.status(auditErr.status || 503).json({
        success: false,
        code: auditErr.code || 'AUDIT_RECORD_UNAVAILABLE',
        applied: true,
        payout: result,
        error: auditErr.message
      });
    }
  }
  res.json(result);
});

app.post('/api/admin/finance/adjustments', authenticateAdmin, requirePermission('finance.adjust'), async (req, res) => {
  const { targetType, targetId, direction, amount, reason } = req.body;
  try {
    // Same rule as the payout: the caller's key identifies the operation, so an admin who
    // resubmits after a lost response corrects one adjustment instead of creating two. Without
    // a key each request is one operation — the amount is deliberately not part of the identity,
    // because two legitimate equal-value adjustments are two real intentions.
    const result = await db.processFinancialAdjustment(targetType, targetId, direction, amount, reason,
      req.admin.id, req.admin.name, { idempotencyKey: readIdempotencyHeader(req) });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/finance/refund', authenticateAdmin, requirePermission('finance.refund'), async (req, res) => {
  const { paymentId, jobId, amount, reason, ticketId, idempotencyKey } = req.body;
  const amt = amount !== undefined ? Number(amount) : null;
  if (amt !== null && (isNaN(amt) || amt <= 0)) {
    return res.status(400).json({ success: false, error: 'Invalid refund amount.' });
  }

  const targetIdentifier = paymentId || jobId;
  if (!targetIdentifier) {
    return res.status(400).json({ success: false, error: 'paymentId or jobId is required.' });
  }

  const eventId = idempotencyKey || `ref_adm_${Date.now()}`;
  const { supabaseAdmin, isLivePostgres } = require('./supabase');

  if (isLivePostgres && supabaseAdmin) {
    const { data, error } = await supabaseAdmin.rpc('refund_payment_atomic', {
      p_order_or_payment: targetIdentifier,
      p_refund_event_id: eventId,
      p_reason: reason || 'Admin authorized refund',
      p_authorized_by: req.admin.id,
      p_provider: 'RAZORPAY_SANDBOX',
      p_declared_amount: amt,
      p_ticket_id: ticketId || null
    });

    if (error) {
      return replyStoreError(res, req, error, 'settlement', { unreachableCode: 'SETTLEMENT_STORE_UNAVAILABLE' });
    }
    if (!data.success) {
      const statusCode = data.code === 'IDEMPOTENCY_CONFLICT' ? 409 : 400;
      return res.status(statusCode).json(data);
    }

    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: 'REFUND_PROCESSED',
      module: 'FINANCE',
      targetEntityType: 'PAYMENT',
      targetEntityId: data.paymentId || targetIdentifier,
      previousState: 'CAPTURED',
      newState: data.status,
      reason: reason || `Admin refund of ₹${data.refundAmount} authorized by ${req.admin.name}`
    });

    // Phase 17 M4: Publish authoritative REFUND_PROCESSED lifecycle event post-commit
    try {
      let refundRecipient = data.userId || null;
      if (!refundRecipient && (data.paymentId || targetIdentifier) && isLivePostgres && supabaseAdmin) {
        try {
          const { data: pRow } = await supabaseAdmin.from('payments')
            .select('customer_id')
            .eq('payment_id', data.paymentId || targetIdentifier)
            .maybeSingle();
          if (pRow?.customer_id) refundRecipient = pRow.customer_id;
        } catch (e) {}
      }
      if (!refundRecipient && jobId) {
        const memJob = db.getJob(jobId);
        if (memJob?.customerId) refundRecipient = resolveCustomerUserUuid(memJob.customerId);
      }
      if (!refundRecipient) {
        refundRecipient = resolveCustomerUserUuid('usr_2');
      }

      notificationEventBus.publish('REFUND_PROCESSED', {
        paymentId: data.paymentId || targetIdentifier,
        recipientUserId: refundRecipient,
        eventKey: `refund_proc:${targetIdentifier}:${eventId}`,
        title: 'Refund Processed',
        body: `Refund of ₹${data.refundAmount !== undefined ? data.refundAmount : amt} has been processed for ${data.paymentId || targetIdentifier}.`,
        notificationType: 'REFUND_PROCESSED',
        priority: 'HIGH',
        data: { paymentId: data.paymentId || targetIdentifier, refundAmount: data.refundAmount !== undefined ? data.refundAmount : amt, reason }
      });
    } catch (notifErr) {
      console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit REFUND_PROCESSED:`, notifErr.message);
    }

    return res.json(data);
  }

  return res.status(500).json({ success: false, error: 'PostgreSQL database unavailable' });
});

// -------------------------------------------------------------
// 6. ADMINISTRATOR ACCOUNT PROVISIONING (SUPER ADMIN ONLY)
// -------------------------------------------------------------
// Provisioning and reading the control plane is the most privileged thing an admin screen
// can do, so it goes through the matrix like everything else rather than an inline role
// test the permission list cannot see. `admin_accounts.manage` and `admin_accounts.create`
// are granted to SUPER_ADMIN only, so the gate answers exactly as the old check did — with
// the difference that a grant to another role is now one line in `adminPermissions.js`
// instead of an edit to this route.
app.get('/api/admin/accounts', authenticateAdmin, requirePermission('admin_accounts.manage'), (req, res) => {
  const accounts = db.getAdminAccounts();
  res.json({ success: true, accounts, total: accounts.length });
});

app.post('/api/admin/accounts', authenticateAdmin, requirePermission('admin_accounts.create'), async (req, res) => {
  try {
    const result = await db.createAdminAccount(req.body, req.admin.id, req.admin.name);
    if (!result.success) return res.status(400).json(result);

    broadcastToAdmins({ type: 'NEW_ADMIN_ACCOUNT_PROVISIONED', account: result.account });
    res.json(result);
  } catch (err) {
    // Provisioning writes the authoritative enrolment row before it answers, so a
    // store that cannot take the write is an outage (503) and not a rejected form.
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'ADMIN_ACCOUNT_CREATION_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

// -------------------------------------------------------------
// 3b. SECURITY CENTRE (area 34) — sessions, lockouts, revocation
// -------------------------------------------------------------
//
// Read-only by design except for the two revocation writes. A list that carried the
// bearer tokens themselves would be a box of live credentials open to anyone with
// `security.view`, so what is exposed is the SHA-256 handle the store already keys on:
// enough to name a session to revoke, useless to sign in with.

app.get('/api/admin/security/sessions', authenticateAdmin, requirePermission('security.view'), (req, res) => {
  try {
    // The admin map is keyed by the bearer itself, so it has to be hashed to line up
    // with the handles the durable list reports.
    const adminMapHandles = new Set(Array.from(activeAdminSessions.keys()).map(localAdminSessionHandle));
    const sessions = db.listAdminSessions().map(s => ({
      ...s,
      // Also honoured by this process's admin map, which is the lookup that runs
      // first on every guarded request. Two maps, so a sweep has to say which.
      inAdminMap: adminMapHandles.has(s.sessionId)
    }));
    res.json({
      success: true,
      sessions,
      total: sessions.length,
      scope: 'THIS_SERVER_PROCESS_AND_PERSISTED_SESSIONS',
      note: 'A session revoked here is removed from the durable store and from this process. Another instance converges on its next session reconcile.'
    });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'ADMIN_SESSION_READ_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

app.get('/api/admin/security/login-lockouts', authenticateAdmin, requirePermission('security.view'), (req, res) => {
  try {
    const lockouts = db.listAdminLoginLockouts();
    res.json({ success: true, ...lockouts, total: lockouts.counters.length });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'ADMIN_LOCKOUT_READ_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

// One session by id, or every session of one account, never both: a request that names
// neither would be a "revoke everything" button wearing a body parameter.
app.post('/api/admin/security/sessions/revoke', authenticateAdmin, requirePermission('security.session.revoke'), async (req, res) => {
  try {
    const { sessionId, adminId } = req.body || {};
    if (!sessionId && !adminId) {
      return res.status(400).json({
        success: false,
        code: 'SESSION_REVOCATION_TARGET_REQUIRED',
        error: 'Name a sessionId or an adminId to revoke. Nothing is revoked without one.',
        requestId: req.id
      });
    }

    let result;
    if (sessionId) {
      const revoked = await db.revokeAdminSession(sessionId);
      const inAdminMap = dropLocalAdminSessionsByHandle([revoked.sessionId]);
      result = { mode: 'SESSION', ...revoked, inAdminMap };
    } else {
      // The same durable delete an account disable performs, without the status
      // change: an account can need its sessions cut while staying enabled — a laptop
      // left open, an administrator who has just left the network.
      const revoked = await db.revokeAdminSessionsForAccount(adminId);
      const inAdminMap = dropLocalAdminSessionsForAccount(adminId);
      result = { mode: 'ACCOUNT', adminId: String(adminId), ...revoked, inAdminMap };
    }

    // Both modes are audited, and awaited: who cut whose access, and how many sessions
    // went, is the question a security review opens this surface to answer. No bearer
    // and no session handle appears in the record — the account and the counts are what
    // carry meaning, and a handle in a log is a live revoke button for anyone who can
    // read it.
    const affected = result.revokedInStore + result.revokedInMemory + result.inAdminMap;
    await db.auditAppliedChange({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: result.mode === 'SESSION' ? 'ADMIN_SESSION_REVOKED' : 'ADMIN_SESSIONS_REVOKED',
      module: 'AUTH',
      targetEntityType: 'ADMIN_USER',
      targetEntityId: result.adminId || 'UNKNOWN',
      previousState: 'SIGNED_IN',
      newState: 'SESSIONS_REVOKED',
      reason: `${req.admin.name || req.admin.id} revoked ${result.mode === 'SESSION' ? 'one session' : `every session`} of administrator ${result.adminId || 'unknown account'} (${affected} take-down(s)).`,
      metadata: {
        mode: result.mode,
        revokedInStore: result.revokedInStore,
        revokedInMemory: result.revokedInMemory,
        revokedFromAdminMap: result.inAdminMap,
        storeChecked: result.storeChecked
      }
    });

    res.json({ success: true, revoked: result });
  } catch (err) {
    // Fail-closed by shape: an outage says so and keeps its 5xx, a bad target says so
    // at 4xx, and neither answers 200 as if a session had been taken back.
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'ADMIN_SESSION_REVOKE_FAILED',
      ...(err.applied === true ? { applied: true } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

// Disable or enable an administrator account, and cut its sessions when disabling.
// `role` is deliberately not accepted here — see `setAdminAccountStatus`.
app.post('/api/admin/accounts/:id/status', authenticateAdmin, requirePermission('admin_accounts.manage'), async (req, res) => {
  try {
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        code: 'ADMIN_STATUS_VALUE_REQUIRED',
        error: 'isActive must be true or false. An account is never left in a state this request did not name.',
        requestId: req.id
      });
    }

    const result = await db.setAdminAccountStatus({
      identifier: req.params.id,
      isActive,
      actor: { id: req.admin.id, username: req.admin.username, name: req.admin.name, role: req.admin.role }
    });

    // The actor may have just disabled their own account, in which case the durable
    // revoke above already took their session out of the store — but the admin map is
    // this process's own copy, and leaving the entry standing would keep honouring the
    // token this very response said was revoked.
    dropLocalAdminSessionsForAccount(result.account.id);

    broadcastToAdmins({ type: 'ADMIN_ACCOUNT_STATUS_CHANGED', accountId: result.account.id, status: result.account.status });
    res.json(result);
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'ADMIN_ACCOUNT_STATUS_FAILED',
      ...(err.applied === true ? { applied: true } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

// -------------------------------------------------------------
// 3c. CUSTOMER ACCOUNTS (area 4) — directory, status, sign-out
// -------------------------------------------------------------
//
// `users.account_status` is a real column constrained by
// `CHECK (account_status IN ('ACTIVE','SUSPENDED','BLOCKED'))`, so a suspension written
// here survives a restart and is honoured by the next sign-in — and the sessions that
// predate it are ended by the same call, because the bearer in hand is what actually
// keeps a suspended customer shopping. See `setCustomerAccountStatus`.
//
// There is no delete route, on purpose. A customer row is referenced by their orders,
// wallet movements and audit records, so "remove this account" would either orphan that
// history or break the financial trail; closing an account is what SUSPENDED and BLOCKED
// are for, and both are reversible.

app.get('/api/admin/customers', authenticateAdmin, requirePermission('customers.read'), async (req, res) => {
  try {
    const result = await db.listCustomerAccounts({
      search: req.query.search || '',
      status: req.query.status || '',
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_DIRECTORY_READ_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

// One account, with its live sessions listed: the confirmation dialog has to be able to
// say "this signs 3 devices out" rather than ask the operator to guess what the button
// does (area 49). Session handles are the SHA-256 the store keys on, not bearer tokens.
app.get('/api/admin/customers/:id', authenticateAdmin, requirePermission('customers.read'), async (req, res) => {
  try {
    const result = await db.getCustomerAccount(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_READ_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

app.post('/api/admin/customers/:id/status', authenticateAdmin, requirePermission('customers.suspend'), async (req, res) => {
  try {
    const { status, reason } = req.body || {};
    const result = await db.setCustomerAccountStatus({
      identifier: req.params.id,
      status: String(status || '').toUpperCase(),
      reason,
      actor: { id: req.admin.id, username: req.admin.username, name: req.admin.name, role: req.admin.role }
    });

    // Only the id and the new state go on the wire. `broadcastToAdmins` reaches every
    // connected administrator dashboard, including sessions whose role has no
    // `customers.read` at all, so a name or phone number in this payload would be the
    // directory leaking through the socket that the HTTP gate closes.
    broadcastToAdmins({
      type: 'CUSTOMER_ACCOUNT_STATUS_CHANGED',
      customerId: result.customer.id,
      accountStatus: result.status
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_STATUS_FAILED',
      ...(err.applied === true ? { applied: true } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

// Sign out without closing: the stolen-phone case, where the account itself is not the
// problem. Audited inside `signOutCustomerSessions`, awaited like every other mutation
// on this control plane.
app.post('/api/admin/customers/:id/sign-out', authenticateAdmin, requirePermission('customers.suspend'), async (req, res) => {
  try {
    const result = await db.signOutCustomerSessions(req.params.id, {
      id: req.admin.id,
      username: req.admin.username,
      name: req.admin.name,
      role: req.admin.role
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.status || err.statusCode || 503).json({
      success: false,
      code: err.code || 'CUSTOMER_SIGN_OUT_FAILED',
      ...(err.applied === true ? { applied: true } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

// -------------------------------------------------------------
// 4. PROMOTIONS & COUPONS
// -------------------------------------------------------------
app.get('/api/admin/promotions', authenticateAdmin, requirePermission('promotion.view'), async (req, res) => {
  try {
    // The page and its total come back together (`promotions`, `total`, `limit`,
    // `offset`, `hasMore`) so the console can show "539 coupons, showing 1-50" and a
    // search can reach a coupon the first page used to hide. The array still lives under
    // `promotions`, so a client that only reads that key is unaffected.
    const page = await db.promotionRepo.list(req.query);
    res.json({ success: true, ...page });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/admin/promotions', authenticateAdmin, requirePermission('promotion.create'), async (req, res) => {
  try {
    const promo = await db.createPromotion(req.body, req.admin.id, req.admin.name);
    // The offers section of the config feed and any campaign pointing at this coupon
    // are composed from promotion rows, so a coupon change has to refresh them.
    appConfigService.invalidate();
    res.json({ success: true, promotion: promo });
  } catch (err) {
    // The repository classifies its own store failures, so a coupon that could not be
    // written because PostgreSQL is unreachable is answered as an outage (503) and a
    // coupon with a bad discount as the caller's error (400). Before this, both were 400.
    if (err.detail) console.error(`[promotions] create failed (${err.status || 400}): ${err.detail}`);
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      requestId: req.id
    });
  }
});

app.put('/api/admin/promotions/:id', authenticateAdmin, requirePermission('promotion.edit'), async (req, res) => {
  try {
    const existing = await db.promotionRepo.getById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Promotion not found' });

    const prevStatus = existing.status;
    const updated = await db.promotionRepo.update(req.params.id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: 'Promotion not found' });

    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: 'PROMOTION_UPDATED',
      module: 'PROMOTIONS',
      targetEntityType: 'PROMOTION',
      targetEntityId: updated.id,
      previousState: prevStatus,
      newState: updated.status,
      reason: `Promotion ${updated.code} updated.`
    });

    // Same reason as on create: a coupon switched off must stop being advertised in
    // the same moment, not one cache window later.
    appConfigService.invalidate();

    res.json({ success: true, promotion: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/promotions/apply', authenticateUser, async (req, res) => {
  try {
    const { code, orderAmount, service, vehicleType, areaId } = req.body;
    // Phase 8: Use authenticated user ID exclusively. Never accept userId from request body.
    const effectiveUserId = req.user.id;
    const result = await db.promotionRepo.preview({
      code,
      userId: effectiveUserId,
      orderAmount,
      service,
      vehicleType,
      areaId
    });
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/promotions/redeem', authenticateUser, async (req, res) => {
  try {
    const { code, orderAmount, service, jobId, vehicleType, areaId } = req.body;
    const effectiveUserId = req.user?.id || req.body.userId;
    if (!effectiveUserId) {
      return res.status(401).json({ success: false, error: 'Authentication required for promotion redemption', requestId: req.id });
    }

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey || `red_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const result = await db.promotionRepo.redeem({
      code,
      userId: effectiveUserId,
      orderAmount,
      service,
      jobId,
      idempotencyKey,
      vehicleType,
      areaId
    });

    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get('/api/admin/promotions/:id/redemptions', authenticateAdmin, requirePermission('promotion.view'), async (req, res) => {
  try {
    const redemptions = await db.promotionRepo.listRedemptions({ promotionId: req.params.id, ...req.query });
    res.json({ success: true, redemptions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

// -------------------------------------------------------------
// ADVERTISEMENTS & SPONSORED CAMPAIGNS API
// -------------------------------------------------------------
app.get('/api/advertisements', async (req, res) => {
  try {
    const { slot, placement, service } = req.query;
    const result = await db.listAdvertisements({
      placement: placement || slot || null,
      activeOnly: true
    });

    // Serving a placement counts as an impression. Counters live in
    // `advertisements.clicks|impressions` and are best-effort (see
    // AdvertisementRepository.bumpCounter), so this is capped at the page size
    // and never blocks the response.
    const counted = result.advertisements.slice(0, 10);
    Promise.all(counted.map(ad => db.recordAdImpression(ad.id))).catch(() => {});

    res.json({
      success: true,
      count: result.advertisements.length,
      advertisements: result.advertisements,
      dataSource: result.dataSource,
      persisted: result.persisted,
      ...(result.degraded ? { degraded: true } : {}),
      placement: result.placementFilter,
      requestedSlot: result.requestedSlot,
      ordering: result.ordering,
      supportedPlacements: AdvertisementRepository.PLACEMENTS,
      ...(service ? {
        serviceFilter: {
          requested: service,
          applied: false,
          reason: 'advertisements has no service column; every stored campaign is served to every service.'
        }
      } : {})
    });
  } catch (err) {
    if (err.code === 'INVALID_PLACEMENT') {
      return res.status(400).json({
        success: false,
        code: err.code,
        error: err.message,
        supportedPlacements: err.details.supportedPlacements,
        legacySlotAliases: err.details.legacySlotAliases
      });
    }
    console.error('[advertisements] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load advertisements.' });
  }
});

// F-2: this route is public on purpose - a click-through comes from a visitor, not a session - but with no
// throttle a single requester could raise `clicks` without bound, and `clicks` is the metric campaigns are
// reported and valued on. Owner-selected product rule: 3 clicks per 10 minutes per advertisement + requester.
// Process-local by design and by approval: it resets on backend restart and applies per instance. It is NOT
// a distributed anti-abuse mechanism; that would need Redis or a limit table, both explicitly out of scope.
// The pattern is the one this repository already uses for the same purpose (`bootstrapAttempts` above and
// `database.js` rateLimitRecords) - an in-memory Map, a rolling window, and `req.ip` as the requester
// identity. Client-supplied identity headers are never trusted here, so a forged X-Forwarded-For cannot buy
// a fresh bucket.
const adClickBuckets = new Map();
const AD_CLICK_LIMIT = 3;
const AD_CLICK_WINDOW_MS = 10 * 60 * 1000;

app.post('/api/advertisements/:id/click', async (req, res) => {
  try {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const bucketKey = `${req.params.id}:${ip}`;
    const now = Date.now();
    const bucket = adClickBuckets.get(bucketKey) || { count: 0, windowStart: now };
    if (now - bucket.windowStart > AD_CLICK_WINDOW_MS) {
      bucket.count = 0;
      bucket.windowStart = now;
    }
    if (bucket.count >= AD_CLICK_LIMIT) {
      // Rejected before reaching the store, so a throttled click cannot move the durable counter.
      return res.status(429).json({
        success: false,
        code: 'AD_CLICK_RATE_LIMITED',
        error: 'Too many click reports for this advertisement. Please try again later.',
        limit: AD_CLICK_LIMIT,
        windowMs: AD_CLICK_WINDOW_MS,
        retryAfterMs: AD_CLICK_WINDOW_MS - (now - bucket.windowStart)
      });
    }
    bucket.count += 1;
    adClickBuckets.set(bucketKey, bucket);
    const result = await db.recordAdClick(req.params.id);
    if (!result.advertisement) {
      // Unknown advertisement keeps its existing 404 semantics, and must not spend the requester's budget -
      // guessing ids would otherwise be a way to block a legitimate reader.
      bucket.count -= 1;
      adClickBuckets.set(bucketKey, bucket);
      return res.status(404).json({ success: false, error: 'Advertisement not found' });
    }
    res.json({
      success: true,
      clicks: result.advertisement.clicks,
      dataSource: result.dataSource,
      persisted: result.persisted,
      message: 'Click recorded'
    });
  } catch (err) {
    console.error('[advertisements] click failed:', err);
    res.status(500).json({ success: false, error: 'Failed to record click.' });
  }
});

app.get('/api/admin/advertisements', authenticateAdmin, async (req, res) => {
  try {
    const result = await db.listAdvertisements({ activeOnly: false });
    const ads = result.advertisements;
    const totalImpressions = ads.reduce((acc, a) => acc + (a.impressions || 0), 0);
    const totalClicks = ads.reduce((acc, a) => acc + (a.clicks || 0), 0);

    res.json({
      success: true,
      advertisements: ads,
      dataSource: result.dataSource,
      persisted: result.persisted,
      ...(result.degraded ? { degraded: true } : {}),
      metrics: {
        totalCampaigns: ads.length,
        activeCampaigns: ads.filter(a => a.status === 'ACTIVE').length,
        pausedCampaigns: ads.filter(a => a.status === 'PAUSED').length,
        expiredCampaigns: ads.filter(a => a.status === 'EXPIRED').length,
        totalImpressions,
        totalClicks,
        overallCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0.00%',
        // Deliberately not a number: `advertisements` stores no bid rate or price,
        // so any revenue figure would be invented.
        monetization: {
          available: false,
          reason: 'No bid-rate or price column exists on advertisements, so revenue cannot be computed from stored data. Adding one requires a new migration.'
        }
      }
    });
  } catch (err) {
    console.error('[advertisements] admin list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load campaigns.' });
  }
});

app.post('/api/admin/advertisements', authenticateAdmin, requirePermission('advertisement.create'), async (req, res) => {
  try {
    const result = await db.createAdvertisement(req.body, req.admin.id, req.admin.name);
    appConfigService.invalidate();
    res.json({
      success: true,
      advertisement: result.advertisement,
      dataSource: result.dataSource,
      persisted: result.persisted,
      ...(result.degraded ? { degraded: true } : {})
    });
  } catch (err) {
    res.status(err.status || (err.code === 'ADVERTISEMENT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

app.put('/api/admin/advertisements/:id', authenticateAdmin, requirePermission('advertisement.edit'), async (req, res) => {
  try {
    const result = await db.updateAdvertisement(req.params.id, req.body, req.admin.id, req.admin.name);
    appConfigService.invalidate();
    res.json({
      success: true,
      advertisement: result.advertisement,
      dataSource: result.dataSource,
      persisted: result.persisted,
      ...(result.degraded ? { degraded: true } : {})
    });
  } catch (err) {
    res.status(err.status || (err.code === 'ADVERTISEMENT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

app.delete('/api/admin/advertisements/:id', authenticateAdmin, requirePermission('advertisement.delete'), async (req, res) => {
  try {
    const result = await db.deleteAdvertisement(req.params.id, req.admin.id, req.admin.name);
    appConfigService.invalidate();
    res.json({
      success: true,
      deleted: result.deleted,
      dataSource: result.dataSource,
      persisted: result.persisted,
      ...(result.degraded ? { degraded: true } : {})
    });
  } catch (err) {
    res.status(err.status || (err.code === 'ADVERTISEMENT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

// -------------------------------------------------------------
// 4d. CAMPAIGNS, FESTIVAL THEMES AND CAMPAIGN ASSETS
// Every route here is permission-gated: an advertisement has always been answerable
// to any authenticated admin, and a campaign that can repaint the whole app and
// attach coupons to checkout should not inherit that precedent.
// -------------------------------------------------------------

// The operator's intent graph. Time is not part of it: a campaign set to ACTIVE with
// a window that has not opened is SCHEDULED when anyone looks at it, because
// campaign_effective_status() says so in PostgreSQL.
const CAMPAIGN_STATUS_TRANSITIONS = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'ARCHIVED'],
  SCHEDULED: ['ACTIVE', 'PAUSED', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'SCHEDULED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'SCHEDULED', 'ARCHIVED'],
  // A closed book: reopening an archived campaign would mean re-dating a window that
  // has already run, which is a new decision and so gets a new row.
  ARCHIVED: []
};

// Campaign answers in HTTP terms, because a client decides what to do next from the
// status alone: an operator's own bad field is a 4xx that names the field, a refused
// concurrent write is a 409/412 telling it to reload, and a store it cannot reach is a
// 5xx it should retry. Nothing here lets one of the three wear the other's clothes.
function campaignStatus(err, fallback = 400) {
  // Numeric because an error object can carry the status as a string, and
  // res.status('503') is a crash on the way to answering an outage.
  const declared = Number(err && (err.status || err.statusCode));
  if (Number.isFinite(declared) && declared >= 400 && declared <= 599) return declared;
  if (err && err.code === 'CAMPAIGNS_UNAVAILABLE') return 503;
  if (err && err.code === 'CAMPAIGN_NOT_FOUND') return 404;
  return fallback;
}

// The revision a save is based on, taken from the If-Match the client echoes back after
// reading the campaign. Quoting and the weak-validator prefix are HTTP's own noise, so
// they come off; everything else is the stored `updated_at` string, character for
// character, which is what the compare-and-set matches on.
function campaignRevision(req) {
  const raw = String(req.headers['if-match'] || '').trim();
  if (!raw) return null;
  const token = raw.replace(/^W\//, '').replace(/^"|"$/g, '').trim();
  return token || null;
}

// A revision is the campaign's own stored instant, so anything else is a client that
// invented one. It has to be checked here rather than passed down: the compare-and-set
// hands the token to PostgreSQL as a timestamp, and a value that is not an instant comes
// back as the engine's own `invalid input syntax` wording — an infrastructure complaint
// wearing a validation error's clothes. `*` is refused for the same reason it would be in
// any compare-and-set: it would let a writer claim a revision it never read.
const CAMPAIGN_REVISION_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isUsableCampaignRevision(token) {
  return CAMPAIGN_REVISION_SHAPE.test(token) && Number.isFinite(Date.parse(token));
}

async function auditCampaign(req, { action, campaign, previousState = null, reason }) {
  try {
    await db.createAuditLog({
      adminId: String(req.admin.id || req.admin.username || 'ADMIN'),
      adminName: String(req.admin.name || req.admin.username || 'Admin'),
      role: String(req.admin.role || 'ADMIN'),
      action,
      module: 'CAMPAIGNS',
      targetEntityType: 'CAMPAIGN',
      targetEntityId: String(campaign ? (campaign.code || campaign.id) : 'UNKNOWN'),
      previousState,
      newState: campaign ? `${campaign.status}${campaign.effectiveStatus ? `/${campaign.effectiveStatus}` : ''}` : null,
      reason,
      details: JSON.stringify({ priority: campaign ? campaign.priority : null, window: campaign ? [campaign.startsAt, campaign.endsAt] : null }),
      ipAddress: req.ip,
      requestId: req.id
    });
  } catch (logErr) {
    // The campaign write already succeeded; a failed audit record is reported, not
    // swallowed, and never turns a saved campaign into a 500.
    console.error('[CAMPAIGN_AUDIT_WARN]', action, logErr.message);
  }
}

app.get('/api/admin/campaigns', authenticateAdmin, requirePermission('campaign.view'), async (req, res) => {
  try {
    const campaigns = await db.campaignRepo.listCampaigns({
      status: req.query.status || null,
      serviceType: req.query.serviceType || null,
      includeArchived: req.query.includeArchived !== 'false'
    });
    if (campaigns === null) {
      return res.status(503).json({ success: false, code: 'CAMPAIGNS_UNAVAILABLE', error: 'Campaign storage is unavailable because PostgreSQL is not reachable.' });
    }
    res.json({ success: true, campaigns, dataSource: 'postgres' });
  } catch (err) {
    console.error('[campaigns] admin list failed:', err);
    res.status(campaignStatus(err, 500)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: 'Failed to load campaigns.'
    });
  }
});

// What a client would be served right now, resolved by the database clock. This is the
// preview an operator checks before publishing, so it must be the same answer the apps
// get rather than a second opinion computed in the browser.
app.get('/api/admin/campaigns/live', authenticateAdmin, requirePermission('campaign.view'), async (req, res) => {
  try {
    const campaigns = await db.campaignRepo.liveCampaigns(req.query.serviceType || null);
    res.json({
      success: true,
      resolvedAt: new Date().toISOString(),
      campaigns: campaigns || [],
      dataSource: 'postgres'
    });
  } catch (err) {
    console.error('[campaigns] live resolution failed:', err);
    res.status(campaignStatus(err, 500)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: 'Failed to resolve live campaigns.'
    });
  }
});

app.get('/api/admin/campaigns/:idOrCode', authenticateAdmin, requirePermission('campaign.view'), async (req, res) => {
  try {
    const campaign = await db.campaignRepo.getCampaign(req.params.idOrCode);
    if (!campaign) {
      return res.status(404).json({ success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'No campaign matches that id or code.' });
    }
    // The revision a save has to echo. An editor that never sees it cannot save, which
    // is the point: an edit based on nothing must not be allowed to overwrite one it
    // never saw.
    res.set('ETag', `"${campaign.updatedAt}"`);
    res.json({ success: true, campaign, dataSource: 'postgres' });
  } catch (err) {
    console.error('[campaigns] admin read failed:', err);
    res.status(campaignStatus(err, 500)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.code === 'CAMPAIGNS_UNAVAILABLE'
        ? 'Campaign storage is not reachable right now, so the campaign could not be read.'
        : 'Failed to load the campaign.'
    });
  }
});

app.post('/api/admin/campaigns', authenticateAdmin, requirePermission('campaign.create'), async (req, res) => {
  try {
    const campaign = await db.campaignRepo.createCampaign(req.body, req.admin);
    appConfigService.invalidate();
    await auditCampaign(req, {
      action: 'CAMPAIGN_CREATED',
      campaign,
      reason: `Campaign ${campaign.code} created with ${campaign.assets.length} asset(s), ${campaign.offers.length} offer(s) and ${campaign.messages.length} message(s).`
    });
    res.status(201).json({ success: true, campaign, dataSource: 'postgres' });
  } catch (err) {
    res.status(campaignStatus(err)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

app.put('/api/admin/campaigns/:idOrCode', authenticateAdmin, requirePermission('campaign.edit'), async (req, res) => {
  try {
    // An edit without the revision it was based on is an edit that could be standing on
    // an older copy of the campaign, so it is refused before anything is read. 428 is
    // HTTP's "you left the precondition out", which is exactly that.
    const revision = campaignRevision(req);
    if (!revision) {
      return res.status(428).json({
        success: false,
        code: 'CAMPAIGN_REVISION_REQUIRED',
        error: 'A campaign edit must send the revision it is based on in the If-Match header. Read this campaign first and pass back its updatedAt value.'
      });
    }
    if (!isUsableCampaignRevision(revision)) {
      return res.status(400).json({
        success: false,
        code: 'CAMPAIGN_REVISION_INVALID',
        error: 'That is not a revision this console issues. Read the campaign again and pass its updatedAt value back unchanged.'
      });
    }
    const before = await db.campaignRepo.getCampaign(req.params.idOrCode);
    if (!before) {
      return res.status(404).json({ success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'No campaign matches that id or code.' });
    }
    // Status moves through its own route so a partial edit cannot quietly
    // re-activate an archived campaign as a side effect of changing a colour.
    const patch = { ...req.body };
    delete patch.status;
    const campaign = await db.campaignRepo.updateCampaign(before.id, patch, req.admin, { guard: { updatedAt: revision } });
    if (!campaign) {
      return res.status(404).json({ success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'No campaign matches that id or code.' });
    }
    appConfigService.invalidate();
    await auditCampaign(req, {
      action: 'CAMPAIGN_UPDATED',
      campaign,
      previousState: `${before.status}/${before.effectiveStatus}`,
      reason: `Campaign ${campaign.code} edited.`
    });
    res.json({ success: true, campaign, dataSource: 'postgres' });
  } catch (err) {
    // A refused edit writes nothing, but a section that failed after the campaign row
    // was committed does change what a client should see — and the route cannot tell the
    // two apart from here, so the feed is refreshed either way. The cost of the
    // unnecessary case is one recomputation.
    appConfigService.invalidate();
    if (err.code === 'CAMPAIGN_PARTIALLY_APPLIED') {
      console.error(`[campaigns] ${req.params.idOrCode}: part-applied edit`, err.details);
    }
    res.status(campaignStatus(err)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

app.post('/api/admin/campaigns/:idOrCode/status', authenticateAdmin, requirePermission('campaign.publish'), async (req, res) => {
  try {
    const campaign = await db.campaignRepo.getCampaign(req.params.idOrCode);
    if (!campaign) {
      return res.status(404).json({ success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'No campaign matches that id or code.' });
    }
    const target = String(req.body.status || '').toUpperCase();
    const allowed = CAMPAIGN_STATUS_TRANSITIONS[campaign.status] || [];
    if (!allowed.includes(target)) {
      return res.status(409).json({
        success: false,
        code: 'CAMPAIGN_TRANSITION_REJECTED',
        error: `A campaign cannot go from ${campaign.status} to ${target || '(nothing supplied)'}.`,
        allowedTransitions: allowed
      });
    }
    // The transition is guarded by the status it was offered from, so two operators
    // pressing different buttons on one campaign cannot both believe they moved it: the
    // second one's WHERE clause no longer matches.
    const updated = await db.campaignRepo.updateCampaign(campaign.id, { status: target }, req.admin, { guard: { status: campaign.status } });
    appConfigService.invalidate();
    await auditCampaign(req, {
      action: `CAMPAIGN_${target}`,
      campaign: updated,
      previousState: `${campaign.status}/${campaign.effectiveStatus}`,
      reason: req.body.reason ? String(req.body.reason).slice(0, 500) : `Campaign ${campaign.code} moved to ${target}.`
    });
    res.json({ success: true, campaign: updated, dataSource: 'postgres' });
  } catch (err) {
    appConfigService.invalidate();
    res.status(campaignStatus(err)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message,
      ...(err.details ? { details: err.details } : {})
    });
  }
});

// Archiving, not deleting: a campaign that ran is the record of an offer customers
// saw, and the coupons it attached carry their own redemption history.
app.delete('/api/admin/campaigns/:idOrCode', authenticateAdmin, requirePermission('campaign.delete'), async (req, res) => {
  try {
    const campaign = await db.campaignRepo.getCampaign(req.params.idOrCode);
    if (!campaign) {
      return res.status(404).json({ success: false, code: 'CAMPAIGN_NOT_FOUND', error: 'No campaign matches that id or code.' });
    }
    if (campaign.status === 'ARCHIVED') {
      return res.status(409).json({
        success: false,
        code: 'CAMPAIGN_ALREADY_ARCHIVED',
        error: `Campaign ${campaign.code} is already archived.`
      });
    }
    const archived = await db.campaignRepo.updateCampaign(campaign.id, { status: 'ARCHIVED' }, req.admin, { guard: { status: campaign.status } });
    appConfigService.invalidate();
    await auditCampaign(req, {
      action: 'CAMPAIGN_ARCHIVED',
      campaign: archived,
      previousState: `${campaign.status}/${campaign.effectiveStatus}`,
      reason: `Campaign ${campaign.code} archived from the delete route; rows are retained.`
    });
    res.json({ success: true, archived: true, campaign: archived, dataSource: 'postgres' });
  } catch (err) {
    appConfigService.invalidate();
    res.status(campaignStatus(err)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

// -------------------------------------------------------------
// 5. GEO-FENCING & DYNAMIC SURGE ZONES
// -------------------------------------------------------------
// The stored inventory travels with the list because an operator maintaining
// boundaries has to be able to see that two of them are the same shape, or that
// a row cannot be read at all. It is a store-wide count of the configuration,
// not a verdict about a coordinate, so it says nothing a stranger could use to
// map the service area — which is why it stays behind geofence.view.
app.get('/api/admin/geofences', authenticateAdmin, requirePermission('geofence.view'), async (req, res) => {
  try {
    const geoFences = await db.pricingRepo.listGeoFences(req.query);
    res.json({ success: true, geoFences, inventory: db.geoStoreStatus() });
  } catch (err) {
    replyGeoAdminError(res, req, err);
  }
});

app.post('/api/admin/geofences', authenticateAdmin, requirePermission('geofence.create'), async (req, res) => {
  try {
    const fence = await db.addGeoFence(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, geoFence: fence });
  } catch (err) {
    replyGeoAdminError(res, req, err);
  }
});

app.delete('/api/admin/geofences/:id', authenticateAdmin, requirePermission('geofence.delete'), async (req, res) => {
  try {
    const deleted = await db.deleteGeoFence(req.params.id, req.admin.id, req.admin.name);
    if (!deleted) return res.status(404).json({ success: false, code: 'GEO_FENCE_NOT_FOUND', error: 'Geo-fence not found' });
    res.json({ success: true, deleted });
  } catch (err) {
    replyGeoAdminError(res, req, err);
  }
});

app.get('/api/admin/surgezones', authenticateAdmin, requirePermission('surge.view'), async (req, res) => {
  try {
    const surgeZones = await db.pricingRepo.listSurgeZones(req.query);
    res.json({ success: true, surgeZones, inventory: db.geoStoreStatus() });
  } catch (err) {
    replyGeoAdminError(res, req, err);
  }
});

app.post('/api/admin/surgezones', authenticateAdmin, requirePermission('surge.create'), async (req, res) => {
  try {
    const surge = await db.addSurgeZone(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, surgeZone: surge });
  } catch (err) {
    replyGeoAdminError(res, req, err);
  }
});

// Centralized Geofence Live Evaluation Endpoint
//
// Still unauthenticated, because whether it should be is §14 decision 8 of
// docs/GEOFENCING_SECURITY_AUDIT.md and this pass does not answer product
// questions. What changed is what one answer costs: the response is a verdict
// about the point that was submitted, not a copy of the boundary that produced
// it — no vertices, no operator notes, no neighbouring zones.
app.post('/api/geofence/evaluate', (req, res) => {
  const { lat, lng, serviceType } = req.body;
  const result = geoPolicy.evaluate({
    latitude: lat,
    longitude: lng,
    service: serviceType || 'RIDE',
    operation: 'PUBLIC_EVALUATE',
    authenticatedUser: req.user ? { id: req.user.id, role: 'CUSTOMER' } : null
  });

  if (result.rejectionReason) {
    const unavailable = result.rejectionReason.code === geoPolicy.REASON.STORE_UNAVAILABLE;
    return res.status(unavailable ? 503 : 400).json({
      success: false,
      code: result.rejectionReason.code,
      error: result.rejectionReason.message
    });
  }

  res.json({
    success: true,
    coordinates: result.coordinate,
    inside: result.insideServiceArea,
    locationValidated: result.locationValidated,
    matchedZones: result.matchedFences,
    primaryZone: result.matchedFences[0] || null,
    effectiveSurgeMultiplier: result.effectiveSurgeMultiplier,
    totalSurcharge: result.totalSurcharge,
    applicableSurgeRules: result.applicableSurgeRules.map(r => ({ id: r.id, zoneName: r.zoneName, surgeMultiplier: r.surgeMultiplier, basis: r.basis, window: r.window })),
    evaluatedAt: result.evaluatedAt
  });
});

// Coordinate → place name. NABIN has no geocoder, so what this route used to do was
// keep a compiled-in list of Delhi neighbourhoods and answer with the nearest one:
// a point in Aizawl came back as "Delhi NCR Operational Hub", and a caller had no
// way to tell a resolved place from a guess. The invented gazetteer is gone. The
// route still validates the coordinate — that part was real — and now says plainly
// that nothing named it. A real lookup would be a new external integration and is
// the owner's call, not a hardening pass's.
app.post('/api/geofence/reverse-geocode', (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: 'Latitude and Longitude required.' });
  }

  // `parseFloat` turned "abc" into NaN and this endpoint answered 200 with
  // "Live Location (NaN° N, NaN° E)" — a description of nowhere that reads like a
  // resolved place. The same validator every other geographic surface uses
  // decides what a coordinate is. Numeric strings stay accepted because
  // `parseFloat` accepted them, so clients may already send one.
  const coords = geoPolicy.validateCoordinatePair(lat, lng, { numericStrings: true });
  if (!coords.ok) {
    return res.status(400).json({ success: false, code: coords.code, error: coords.message });
  }

  res.json({
    success: true,
    // `resolved` is the field a caller must branch on. Every name below is null
    // because the platform does not know what this point is called.
    resolved: false,
    locality: null,
    landmark: null,
    city: null,
    formattedAddress: null,
    reason: 'NO_GEOCODER',
    coordinates: { lat: coords.value.lat, lng: coords.value.lng }
  });
});

// Centralized Pricing Estimate (Integrates Live Coordinates, Geo-fences & Surge)
// A coupon on a quote is validated by the PostgreSQL promotion authority and shown
// without being consumed: `validate_promotion_preview` is read-only, so quoting a
// discount cannot burn a redemption. Per-user limits are enforced again by the
// atomic redemption at booking time, because this endpoint is public.
app.post('/api/pricing/estimate', async (req, res) => {
  try {
    const { serviceType, distanceKm, durationMins, pickupLat, pickupLng, promoCode } = req.body;
    // #158. `Number(distanceKm) || 4.0` was two defects in one expression: a caller that said
    // nothing got a confident fare for a 4 km / 12 min trip it never described, and a caller
    // that said `0` was treated as if it had said nothing (`Number('0') || 4.0` is 4.0). A quote
    // is the platform offering to take money, so the length has to come from the caller:
    // missing, unparseable or non-positive is a refusal, never a default. Non-positive is the
    // same rule the booking route already states — a zero-length trip has no trip to price
    // (`PLACE_REQUIRED`, from the `tripKm === null` guard in `book-ride` below), so a quote can
    // never offer a fare no booking will accept. The engine still carries its own defaults
    // (`calculateFareEstimate` in `database.js`) and its own `distanceKm || 1`; nothing reachable
    // from these routes can feed it a missing or zero length now, and the engine is next to clean.
    const requiredLength = (raw, field) => {
      const missing = raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
      const value = missing ? NaN : Number(raw);
      const name = field.toLowerCase();
      if (missing) return { code: `MISSING_${field}`, error: `${name} is required; a quote cannot price a trip nobody described.` };
      if (!Number.isFinite(value)) return { code: `INVALID_${field}`, error: `${name} must be a finite number.` };
      if (value <= 0) return { code: `INVALID_${field}`, error: `${name} must be greater than zero; there is no trip to price without one.` };
      return { value };
    };
    const distance = requiredLength(distanceKm, 'DISTANCE_KM');
    const duration = requiredLength(durationMins, 'DURATION_MINS');
    const badLength = [distance, duration].find(c => c.code);
    if (badLength) {
      return res.status(400).json({
        success: false, code: badLength.code, error: badLength.error,
        pricingAvailable: false, requestId: req.id
      });
    }

    const pricingInput = {
      serviceType: serviceType || '3W',
      distanceKm: distance.value,
      durationMins: duration.value,
      // Passed through unparsed on purpose: `Number('')` is 0 and `Number(null)`
      // is 0, and latitude 0 is the Gulf of Guinea, which is a place. A missing
      // coordinate must stay missing for the engine to tell it apart from a
      // nonsense one.
      pickupLat: pickupLat === undefined ? null : pickupLat,
      pickupLng: pickupLng === undefined ? null : pickupLng,
      // Accepted only so the answer can say it was ignored. `zoneId` used to be a
      // second door into pricing: name a zone, pay its surcharge, stand anywhere.
      requestedZoneId: req.body.zoneId === undefined ? null : req.body.zoneId
    };
    const base = db.calculateFareEstimate(pricingInput);

    // A quote whose geography could not be validated is not a low quote, it is an
    // unknown one, so it stops here rather than reaching a customer as a number.
    if (replyGeoRefusal(res, req, base.geoValidation.refusal)) return;

    let discount = 0;
    let appliedPromo = null;
    if (promoCode) {
      const preview = await db.promotionRepo.preview({
        code: promoCode,
        orderAmount: base.customerCharge,
        service: couponServiceOf(base.serviceType)
      });
      if (!preview.success) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PROMO_CODE',
          error: preview.error,
          estimate: base
        });
      }
      discount = preview.discount;
      appliedPromo = { code: preview.code, promotionId: preview.promotionId, name: preview.name, discount };
    }

    const estimate = discount > 0
      ? db.calculateFareEstimate({ ...pricingInput, couponDiscount: discount })
      : base;

    res.json({ success: true, estimate, appliedPromo });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get('/api/admin/pricing', authenticateAdmin, requirePermission('pricing.edit'), async (req, res) => {
  try {
    const pricingConfig = await db.pricingRepo.getPricingMatrix();
    res.json({ success: true, pricingConfig });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/pricing', authenticateAdmin, requirePermission('pricing.edit'), async (req, res) => {
  try {
    const pricingConfig = await db.pricingRepo.updatePricingConfig(req.body, { id: req.admin.id, name: req.admin.name, role: req.admin.role });

    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: 'PRICING_UPDATED',
      module: 'PRICING_ENGINE',
      targetEntityType: 'PRICING_CONFIG',
      targetEntityId: 'PRICING_GLOBAL',
      previousState: 'CONFIGURED',
      newState: 'UPDATED',
      reason: `Pricing adjusted by ${req.admin.name}. Global Surge: ${db.pricingConfig.globalSurgeMultiplier}x`
    });

    res.json({ success: true, pricingConfig, message: 'Platform pricing updated.' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// MANUAL IDENTITY VERIFICATION API
// -------------------------------------------------------------
app.post('/api/identity/submit', authenticateUser, (req, res) => {
  const { userId, name, phone, email, dob, address, aadhaarNumber, aadhaarDocUrl, voterIdNumber, voterIdDocUrl, isResubmission } = req.body;

  // Tenant isolation: reject spoofed userId
  const customerUuid = db.userRepo?.resolveUuid(req.user.id) || req.user.uuid || req.user.id;
  if (userId) {
    const targetUuid = db.userRepo?.resolveUuid(userId) || userId;
    if (userId !== req.user.id && targetUuid !== customerUuid) {
      return res.status(403).json({
        success: false,
        code: 'CUSTOMER_MISMATCH',
        error: 'Forbidden: Cannot submit identity verification for another customer account.'
      });
    }
  }

  const effectiveUserId = req.user.id;

  if (!aadhaarNumber || aadhaarNumber.toString().replace(/\D/g, '').length < 12) {
    return res.status(400).json({ success: false, error: 'A valid 12-digit Aadhaar number is required.' });
  }
  if (!voterIdNumber || voterIdNumber.toString().trim().length < 5) {
    return res.status(400).json({ success: false, error: 'A valid Voter ID (EPIC) number is required.' });
  }

  // NABIN has no identity-document upload path: no bucket, no scan, no retention rule. Until it
  // has one, a submission that claims to carry a document is refused rather than stored. Passing
  // the string through was never harmless — the only reader of that column is an examiner's
  // browser, so every value a customer sent became a URL the admin dashboard was asked to load,
  // and the record read as though NABIN held paperwork it had never received.
  if (aadhaarDocUrl || voterIdDocUrl) {
    return res.status(400).json({
      success: false,
      code: 'IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED',
      error: 'Forbidden: identity documents cannot be submitted with this application yet. Submit the two identity numbers and the declared details only.'
    });
  }

  const result = db.submitIdentityApplication({
    userId: effectiveUserId,
    name: name || req.user.name,
    phone: phone || req.user.phone,
    email: email || req.user.email,
    dob,
    address,
    aadhaarNumber: aadhaarNumber.toString().trim(),
    // No document fields at all. This used to pass `/docs/mock_aadhaar_user.png` and, after #146,
    // an explicit null; the route above now refuses any submission that claims a document, and the
    // writer no longer reads those fields even when a caller reaches it directly, so there is
    // nothing left to pass.
    voterIdNumber: voterIdNumber.toString().trim().toUpperCase(),
    isResubmission: Boolean(isResubmission)
  });

  broadcastToAdmins({
    type: 'NEW_IDENTITY_APPLICATION',
    applicationId: result.application.id,
    userName: result.application.userName,
    status: result.application.status
  });

  res.json({
    success: true,
    // The customer sent numbers and declared details, not paperwork. Telling them "your identity
    // documents have been submitted" made the receipt claim a delivery that never happened — and a
    // customer who believed it would wait for a review of a document NABIN never received.
    message: 'Your identity details and numbers have been submitted for manual review. No documents were uploaded: NABIN does not accept identity document uploads yet.',
    application: {
      id: result.application.id,
      userId: result.application.userId,
      userName: result.application.userName,
      status: result.application.status,
      overallDocumentStatus: result.application.overallDocumentStatus,
      aadhaarNumberMasked: result.application.aadhaarNumberMasked,
      voterIdNumberMasked: result.application.voterIdNumberMasked,
      submissionDate: result.application.submissionDate
    },
    user: result.user
  });
});

// Phase 8: Add authentication + ownership check (was fully unauthenticated — IDOR risk)
app.get('/api/identity/status/:userId', authenticateUser, (req, res) => {
  // Enforce caller owns the requested userId, or is an admin
  if (req.user.id !== req.params.userId) {
    const token = req.headers.authorization?.split(' ')[1];
    const session = token ? db.getSessionByToken(token) : null;
    const isAdmin = session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';
    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        code: 'FORBIDDEN',
        error: 'Access denied: cannot view another user identity status.'
      });
    }
  }
  const user = db.getUser(req.params.userId);
  if (!user) return res.status(404).json({ success: false, error: 'User record not found.' });

  const application = user.currentApplicationId
    ? db.getIdentityApplicationById(user.currentApplicationId)
    : db.identityApplications.find(a => a.userId === user.id);

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      identityStatus: user.identityStatus || 'IDENTITY_VERIFICATION_PENDING',
      accountStatus: user.accountStatus || 'IDENTITY_VERIFICATION_PENDING'
    },
    application: application ? {
      id: application.id,
      status: application.status,
      overallDocumentStatus: application.overallDocumentStatus,
      aadhaarDocStatus: application.aadhaarDocStatus,
      aadhaarNumberMasked: application.aadhaarNumberMasked,
      voterIdDocStatus: application.voterIdDocStatus,
      voterIdNumberMasked: application.voterIdNumberMasked,
      submissionDate: application.submissionDate,
      updatedAt: application.updatedAt,
      resubmissionReason: application.resubmissionReason,
      rejectionReason: application.rejectionReason,
      reviewNotes: application.reviewNotes
    } : null
  });
});

app.get('/api/admin/identity-verifications', authenticateAdmin, requirePermission('identity_verification.view'), (req, res) => {
  const filters = {
    status: req.query.status || 'ALL',
    search: req.query.search || '',
    page: req.query.page || 1,
    limit: req.query.limit || 20
  };
  const data = db.getIdentityApplications(filters);
  // The queue handed `getIdentityApplications`' rows straight out, so a role holding
  // `identity_verification.view` but not `identity_documents.view` — OPERATIONS is in the
  // catalogue exactly that way — read every applicant's full Aadhaar and Voter ID numbers in
  // one call, while the detail route below had been withholding those same two fields from
  // that role all along. One predicate, both routes, so the answers cannot drift.
  const canListUnmasked = adminHoldsPermission(req.admin, 'identity_documents.view');
  const applications = canListUnmasked
    ? data.applications
    : data.applications.map(({ aadhaarNumberRaw, voterIdNumberRaw, ...rest }) => rest);
  res.json({
    success: true,
    ...data,
    applications,
    metrics: {
      total: db.identityApplications.length,
      pending: db.identityApplications.filter(a => a.status === 'IDENTITY_VERIFICATION_PENDING').length,
      underReview: db.identityApplications.filter(a => a.status === 'UNDER_REVIEW').length,
      resubmission: db.identityApplications.filter(a => a.status === 'RESUBMISSION_REQUIRED').length,
      verified: db.identityApplications.filter(a => a.status === 'VERIFIED').length,
      rejected: db.identityApplications.filter(a => a.status === 'REJECTED').length
    }
  });
});

app.get('/api/admin/identity-verifications/:id', authenticateAdmin, requirePermission('identity_verification.view'), async (req, res) => {
  const appRecord = db.getIdentityApplicationById(req.params.id);
  if (!appRecord) return res.status(404).json({ success: false, error: 'Application not found' });

  // Field-level, so it cannot be route middleware: one read is a queue row for a role
  // without the name and an examiner's file for a role with it. It used to ask
  // `req.admin.permissions.includes(...)` by hand — a fourth spelling of the answer
  // `requirePermission` already gives — so it asks the same predicate now.
  const canViewUnmasked = adminHoldsPermission(req.admin, 'identity_documents.view');

  let auditLogs = [];
  if (db.auditLogRepo && typeof db.auditLogRepo.list === 'function') {
    try {
      const audRes = await db.auditLogRepo.list({ applicationId: appRecord.id });
      auditLogs = audRes.logs;
    } catch (err) {
      // The trail is the point of this view, so an unreadable one must not become an empty
      // list — that reads as "nothing has touched this application". There was no catch here
      // at all, so the rejection hung the request instead. PostgREST wording is not echoed.
      return res.status(503).json({
        success: false,
        code: 'AUDIT_TRAIL_UNAVAILABLE',
        error: `The audit trail for ${appRecord.id} could not be read, so it is not being shown.`
      });
    }
  } else {
    auditLogs = db.getAuditLogs({ applicationId: appRecord.id });
  }

  res.json({
    success: true,
    application: {
      ...appRecord,
      aadhaarNumberRaw: canViewUnmasked ? appRecord.aadhaarNumberRaw : undefined,
      voterIdNumberRaw: canViewUnmasked ? appRecord.voterIdNumberRaw : undefined
    },
    auditLogs
  });
});

app.post('/api/admin/identity-verifications/:id/lock', authenticateAdmin, requirePermission('identity_verification.review'), async (req, res) => {
  try {
    const result = await db.lockIdentityApplication(req.params.id, req.admin.id, req.admin.name);
    if (!result.success) return res.status(409).json(result);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.post('/api/admin/identity-verifications/:id/unlock', authenticateAdmin, requirePermission('identity_verification.review'), (req, res) => {
  const result = db.unlockIdentityApplication(req.params.id, req.admin.id);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// The decision in the body chooses which permission this call needs; the gate is
// `adminPermissions.js`'s `requireIdentityDecision`, so its three names are enforced in the
// same wording as every other route and can be refusal-tested without a server. An unknown
// decision is left to the method, which refuses it as a 400.
app.post('/api/admin/identity-verifications/:id/review', authenticateAdmin, requirePermission('identity_verification.review'), requireIdentityDecision, async (req, res) => {
  const { decision, reason, checklist } = req.body;

  let result;
  try {
    result = await db.reviewIdentityApplication(
      req.params.id,
      decision,
      reason,
      checklist,
      req.admin.id,
      req.admin.name
    );
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }

  if (!result.success) return res.status(400).json(result);

  broadcastToCustomer(result.application.userId, {
    type: 'IDENTITY_STATUS_UPDATED',
    status: result.application.status,
    applicationId: result.application.id,
    reason: reason || ''
  });

  res.json(result);
});

// -------------------------------------------------------------
// DISPATCH & COMMUTE SERVICES (CUSTOMER APP)
// -------------------------------------------------------------
// -------------------------------------------------------------
// DISPATCH & COMMUTE SERVICES (CUSTOMER APP)
// -------------------------------------------------------------
app.post('/api/customer/book-ride', authenticateUser, async (req, res) => {
  if (db.isServicePaused('rides')) {
    const s = db.getService('rides');
    return res.status(423).json({
      success: false,
      servicePaused: true,
      error: s?.broadcastNotice || 'NABIN Mobility & Rides is temporarily paused by platform operations.',
      serviceName: s?.name || 'NABIN Mobility',
      resumeAt: s?.resumeAt || null,
      reason: s?.pausedReason || null
    });
  }

  try {
    await featureControlService.requireFeature('FEATURE_RIDE', req.header('X-Location-Id') || 'GLOBAL');
    if (req.body.vehicleType) {
        let type = req.body.vehicleType.toUpperCase();
        if (type === '4W' || type === 'LUX') type = 'TAXI';
        if (type === '3W') type = 'AUTO';
        const supportedFeatures = ['BIKE', 'AUTO', 'TAXI', 'SHARED', 'RENTAL'];
        if (supportedFeatures.includes(type)) {
            await featureControlService.requireFeature(`FEATURE_RIDE_${type}`, req.header('X-Location-Id') || 'GLOBAL');
        }
    }
  } catch (error) {
    if (error.code === 'FEATURE_DISABLED') return res.status(403).json({ success: false, error: error.message, code: error.code });
    return res.status(500).json({ success: false, error: error.message });
  }

  const { customerId, vehicleType, pickup, drop, promoCode, bookingType, passengerCategory, passengerInfo } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
  if (idempotencyKey) {
    const existing = db.jobs.find(j => j.idempotencyKey === idempotencyKey);
    if (existing) {
      return res.json({ success: true, job: existing, duplicate: true });
    }
  }

  // Customer identity binding: req.user is set by authenticateUser middleware
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Customer session required.',
      requestId: req.id
    });
  }

  // Reject cross-customer IDOR attempts
  if (customerId && String(customerId).trim() !== String(req.user.id).trim()) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Cannot book rides for another customer account.',
      requestId: req.id
    });
  }

  const user = req.user;

  if (user && user.identityStatus !== 'VERIFIED') {
    return res.status(403).json({
      success: false,
      error: 'Account identity verification pending. Your Aadhaar & Voter ID are currently awaiting manual verification by NABIN Admin.'
    });
  }

  // Server-Side Authoritative Pricing Calculation (Zero Trust of client-supplied fare).
  // Both ends must be places the customer chose, because the fare is a function of
  // the distance between them: an unplaced end used to be filled in with central
  // Delhi and priced from that.
  const placedPickup = placedEnd(pickup, 'pickup');
  if (!placedPickup.ok) return replyPlaceRefusal(res, req, placedPickup);
  const placedDrop = placedEnd(drop, 'drop');
  if (!placedDrop.ok) return replyPlaceRefusal(res, req, placedDrop);

  const tripKm = tripDistanceKm(placedPickup.value, placedDrop.value);
  if (tripKm === null) {
    return replyPlaceRefusal(res, req, {
      code: 'PLACE_REQUIRED',
      field: 'drop',
      message: 'The pickup and the drop are the same point, so there is no trip to price. Choose a different drop.'
    });
  }

  const pricingInput = {
    serviceType: vehicleType || '3W',
    distanceKm: tripKm,
    durationMins: tripDurationMins(tripKm),
    pickupLat: placedPickup.value.lat,
    pickupLng: placedPickup.value.lng,
    requestedZoneId: req.body.zoneId === undefined ? null : req.body.zoneId
  };
  const basePricing = db.calculateFareEstimate(pricingInput);
  if (replyGeoRefusal(res, req, basePricing.geoValidation.refusal)) return;

  // A coupon is redeemed through `redeem_promotion_atomic`, which enforces the
  // validity window, global and per-user limits under a row lock. An unusable code
  // rejects the booking instead of silently charging the full fare, and the
  // deterministic key lets a replay reuse the same redemption instead of burning a
  // second one.
  let pricing = basePricing;
  let appliedPromo = null;
  if (promoCode) {
    const redemption = await db.redeemCoupon({
      code: promoCode,
      customerId: user.id,
      orderAmount: basePricing.customerCharge,
      service: 'RIDE',
      idempotencyKey: `ride_coupon:${idempotencyKey || crypto.randomUUID()}`
    });
    if (!redemption.applied) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PROMO_CODE',
        error: redemption.error,
        requestId: req.id
      });
    }
    appliedPromo = {
      code: redemption.code,
      promotionId: redemption.promotionId,
      redemptionId: redemption.redemptionId,
      discount: redemption.discount
    };
    pricing = db.calculateFareEstimate({ ...pricingInput, couponDiscount: redemption.discount });
  }

  const finalFare = pricing.customerCharge;
  const isSomeoneElse = bookingType === 'FOR_SOMEONE_ELSE';
  const isSchoolChild = isSomeoneElse && passengerCategory === 'SCHOOL_CHILD';

  const job = await db.createJob({
    type: 'RIDE',
    idempotencyKey: idempotencyKey || null,
    customerId: user.id,
    customerName: user.name,
    customerPhone: user.phone,
    // No `customerRating`: `users.rating` is a `DEFAULT 5.00` column with no ratings table
    // behind it, so copying it booked a column default as a score the passenger never got.
    vehicleType: vehicleType || '3W',
    pickup: { ...pickup, ...placedPickup.value },
    drop: { ...drop, ...placedDrop.value },
    distance: `${tripKm} km`,
    // The measured trip, in the column that exists for it. This used to stop at a
    // display string, so every ride row carried `distance_km = 0` next to a
    // "4.2 km" label and the two could not be reconciled.
    distanceKm: tripKm,
    duration: `${pricingInput.durationMins} mins`,
    fare: finalFare,
    discountAmount: pricing.discount,
    driverEarnings: pricing.driverEarnings,
    platformFee: pricing.platformFee,
    surgeMultiplier: pricing.surgeMultiplier,
    appliedPromo,
    isForSomeoneElse: isSomeoneElse,
    isSchoolChild: isSchoolChild,
    passengerCategory: passengerCategory || 'ADULT',
    passengerInfo: isSomeoneElse ? passengerInfo : null,
  });

  // Create authoritative dispatch offers for active/eligible drivers
  try {
    if (db.dispatchRepo) {
      const candidateDrivers = db.drivers.filter(d => d.operationalStatus !== 'SUSPENDED');
      for (const d of candidateDrivers) {
        await db.dispatchRepo.createOffer({
          jobId: job.id,
          driverId: d.id,
          ttlSeconds: 60,
          metadata: { serviceType: 'RIDE', vehicleType: job.vehicleType }
        });
      }
    }
  } catch (err) {
    console.warn('[DISPATCH_OFFER_WARN] Could not persist dispatch offer:', err.message);
  }

  broadcastToDrivers({
    type: 'NEW_JOB_DISPATCH',
    job: {
      id: job.id,
      type: 'RIDE',
      vehicleType: job.vehicleType,
      title: isSchoolChild ? `School Ride (${job.vehicleType})` : `Passenger Ride (${job.vehicleType})`,
      pickup: job.pickup.address,
      drop: job.drop.address,
      fare: `₹${job.fare.toFixed(2)}`,
      distance: `${job.distance} (${job.duration})`,
      // Only names the booking actually carries. This used to print `(5 ★)` after the
      // passenger's name — a score read off a `DEFAULT 5.00` column — and to answer a school
      // ride with no guardian name as 'Rahul Sharma', a person the platform invented for
      // somebody else's child. An unknown name is sent as null, not filled in.
      customer: isSchoolChild ? (passengerInfo?.guardianName || null) : (job.customerName || null),
      customerPhone: passengerInfo?.guardianPhone || job.customerPhone,
      // Phase 10: the trip-start code is NOT broadcast with the open dispatch
      // offer. Broadcasting it to every connected driver disclosed the pickup
      // control to drivers who were never assigned the trip (docs/PHASE_2_
      // MIGRATION_PLAN.md scopes OTPs to the assigned driver's channel only).
      // The assigned driver receives the code with the assignment response and
      // the customer receives it on DRIVER_ASSIGNED.
      isForSomeoneElse: job.isForSomeoneElse,
      isSchoolChild: isSchoolChild,
      childName: passengerInfo?.childName,
      schoolName: passengerInfo?.schoolName,
      gradeClass: passengerInfo?.gradeClass,
      section: passengerInfo?.section,
      specialInstructions: passengerInfo?.specialInstructions,
    }
  });

  // Phase 17 M4: Publish post-commit JOB_DISPATCHED event
  try {
    notificationEventBus.publish('JOB_DISPATCHED', {
      jobId: job.id,
      eventKey: `job_dispatch:${job.id}`,
      customerId: job.customerId,
      title: 'Ride Booking Requested',
      body: `Your ride request (${job.id}) has been broadcast to nearby drivers.`,
      notificationType: 'JOB_DISPATCHED',
      priority: 'HIGH',
      data: { jobId: job.id, vehicleType: job.vehicleType, fare: job.fare }
    });
  } catch (err) {
    console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit JOB_DISPATCHED for job ${job.id}:`, err.message);
  }

  res.json({ success: true, job });
});

app.post('/api/customer/book-parcel', authenticateUser, async (req, res) => {
  if (db.isServicePaused('parcel')) {
    const s = db.getService('parcel');
    return res.status(423).json({
      success: false,
      servicePaused: true,
      error: s?.broadcastNotice || 'NABIN Parcel Courier delivery is temporarily paused by platform operations.',
      serviceName: s?.name || 'NABIN Parcel',
      resumeAt: s?.resumeAt || null,
      reason: s?.pausedReason || null
    });
  }

  try {
    await featureControlService.requireFeature('FEATURE_PARCEL', req.header('X-Location-Id') || 'GLOBAL');
    await featureControlService.requireFeature('FEATURE_PARCEL_BOOKING', req.header('X-Location-Id') || 'GLOBAL');
  } catch (error) {
    if (error.code === 'FEATURE_DISABLED') return res.status(403).json({ success: false, error: error.message, code: error.code });
    return res.status(500).json({ success: false, error: error.message });
  }

  const { customerId, senderDetails, recipientDetails, promoCode, weightTier } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
  if (idempotencyKey) {
    const existing = db.jobs.find(j => j.idempotencyKey === idempotencyKey);
    if (existing) {
      return res.json({ success: true, job: existing, duplicate: true });
    }
  }

  // Customer identity binding: req.user is set by authenticateUser middleware
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Customer session required.',
      requestId: req.id
    });
  }

  // Reject cross-customer IDOR attempts
  if (customerId && String(customerId).trim() !== String(req.user.id).trim()) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Cannot book parcels for another customer account.',
      requestId: req.id
    });
  }

  const user = req.user;

  // Authoritative server-side pricing. A parcel moves between two places, and the
  // fare is a function of how far apart they are — so both ends must be placed.
  // This route used to price every parcel as a 6.1 km, 18 minute trip between two
  // Delhi markets it named itself, whatever the customer had typed.
  const placedSender = placedEnd(senderDetails, 'sender');
  if (!placedSender.ok) return replyPlaceRefusal(res, req, placedSender);
  const placedRecipient = placedEnd(recipientDetails, 'recipient');
  if (!placedRecipient.ok) return replyPlaceRefusal(res, req, placedRecipient);

  const parcelKm = tripDistanceKm(placedSender.value, placedRecipient.value);
  if (parcelKm === null) {
    return replyPlaceRefusal(res, req, {
      code: 'PLACE_REQUIRED',
      field: 'recipient',
      message: 'The pickup and drop-off points are the same place, so there is no parcel trip to price. Choose a different drop-off point.'
    });
  }

  const parcelPricingInput = {
    serviceType: 'PARCEL',
    distanceKm: parcelKm,
    durationMins: tripDurationMins(parcelKm)
  };
  const basePricing = db.calculateFareEstimate(parcelPricingInput);

  let pricing = basePricing;
  let appliedPromo = null;
  if (promoCode) {
    const redemption = await db.redeemCoupon({
      code: promoCode,
      customerId: user.id,
      orderAmount: basePricing.customerCharge,
      service: 'PARCEL',
      idempotencyKey: `parcel_coupon:${idempotencyKey || crypto.randomUUID()}`
    });
    if (!redemption.applied) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PROMO_CODE',
        error: redemption.error,
        requestId: req.id
      });
    }
    appliedPromo = {
      code: redemption.code,
      promotionId: redemption.promotionId,
      redemptionId: redemption.redemptionId,
      discount: redemption.discount
    };
    pricing = db.calculateFareEstimate({ ...parcelPricingInput, couponDiscount: redemption.discount });
  }

  const job = await db.createJob({
    type: 'PARCEL',
    idempotencyKey: idempotencyKey || null,
    customerId: user.id,
    customerName: user.name,
    customerPhone: user.phone,
    pickup: { ...senderDetails, ...placedSender.value },
    drop: { ...recipientDetails, ...placedRecipient.value },
    distance: `${parcelKm} km`,
    distanceKm: parcelKm,
    duration: `${parcelPricingInput.durationMins} mins`,
    fare: pricing.customerCharge,
    discountAmount: pricing.discount,
    driverEarnings: pricing.driverEarnings,
    platformFee: pricing.platformFee,
    appliedPromo,
    // What the customer declared about the parcel, or nothing. This used to be a
    // line the platform wrote for them — "Electronics Box (1.4 kg, Fragile)" —
    // which a courier then read as instructions about somebody else's box.
    packageDetails: typeof req.body.packageDetails === 'string' && req.body.packageDetails.trim()
      ? req.body.packageDetails.trim()
      : null,
    weightTier: typeof weightTier === 'string' && weightTier.trim() ? weightTier.trim() : null,
    deliveryOtp: Math.floor(1000 + Math.random() * 9000).toString()
  });

  // Create authoritative dispatch offers for active/eligible drivers
  try {
    if (db.dispatchRepo) {
      const candidateDrivers = db.drivers.filter(d => d.operationalStatus !== 'SUSPENDED');
      for (const d of candidateDrivers) {
        await db.dispatchRepo.createOffer({
          jobId: job.id,
          driverId: d.id,
          ttlSeconds: 60,
          metadata: { serviceType: 'PARCEL' }
        });
      }
    }
  } catch (err) {
    console.warn('[DISPATCH_OFFER_WARN] Could not persist parcel dispatch offer:', err.message);
  }

  broadcastToDrivers({
    type: 'NEW_JOB_DISPATCH',
    job: {
      id: job.id,
      type: 'PARCEL',
      title: 'Instant Parcel Courier (Dual-OTP)',
      pickup: job.pickup.address,
      drop: job.drop.address,
      fare: `₹${job.fare.toFixed(2)}`,
      distance: `${job.distance} (${job.duration})`,
      customer: `${user.name} (Sender)`,
      customerPhone: job.customerPhone,
      packageDetails: job.packageDetails,
      // Phase 10: parcel OTPs are NOT broadcast with the open dispatch offer.
      // The delivery OTP in particular is the proof-of-delivery control; sending
      // it to every connected driver before assignment nullified it.
    }
  });

  res.json({ success: true, job });
});

app.post('/api/customer/book-food', authenticateUser, async (req, res) => {
  if (db.isServicePaused('food')) {
    const s = db.getService('food');
    return res.status(423).json({
      success: false,
      servicePaused: true,
      error: s?.broadcastNotice || 'NABIN Food Delivery service is temporarily paused by platform operations.',
      serviceName: s?.name || 'NABIN Food Delivery',
      resumeAt: s?.resumeAt || null,
      reason: s?.pausedReason || null
    });
  }

  try {
    await featureControlService.requireFeature('FEATURE_FOOD', req.header('X-Location-Id') || 'GLOBAL');
    await featureControlService.requireFeature('FEATURE_FOOD_ORDERING', req.header('X-Location-Id') || 'GLOBAL');
  } catch (error) {
    if (error.code === 'FEATURE_DISABLED') return res.status(403).json({ success: false, error: error.message, code: error.code });
    return res.status(500).json({ success: false, error: error.message });
  }

  // 1. Authenticate customer
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Customer session required.',
      requestId: req.id
    });
  }

  const customerUuid = db.orderRepo ? db.orderRepo.resolveUserUuid(req.user.uuid || req.user.id) : null;
  if (!customerUuid) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Valid customer profile required.',
      requestId: req.id
    });
  }

  const { customerId, restaurantId, merchantId, items, deliveryAddress } = req.body;

  // Reject cross-customer IDOR attempts
  if (customerId && db.orderRepo) {
    const requestedUuid = db.orderRepo.resolveUserUuid(customerId);
    if (requestedUuid && requestedUuid !== customerUuid) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot book food orders for another customer account.',
        requestId: req.id
      });
    }
  }

  // The address the meal is driven to. Absent, this used to be written as
  // "North Campus Girls Hostel, Delhi" on the merchant's order card — an order to
  // a place that was never given. After the identity gate, because an authorization
  // failure must not turn into a form-validation hint, and before the coupon is
  // redeemed, because a refusal that arrives after `redeem_promotion_atomic` has
  // spent the customer's one redemption is a worse bug than the invented address.
  const foodDeliveryAddress = typeof deliveryAddress === 'string' ? deliveryAddress.trim() : '';
  if (!foodDeliveryAddress) {
    return res.status(400).json({
      success: false,
      code: 'PLACE_REQUIRED',
      field: 'deliveryAddress',
      error: 'Add a delivery address before ordering. NABIN writes the address you give; it does not fill one in.',
      requestId: req.id
    });
  }

  // 2. Resolve merchant
  const mchtInput = restaurantId || merchantId;
  if (!mchtInput) {
    return res.status(400).json({
      success: false,
      code: 'MERCHANT_REQUIRED',
      error: 'restaurantId or merchantId is required.',
      requestId: req.id
    });
  }

  // ResolveMerchant now refuses with a 503 when the store cannot be reached, rather
  // than reporting "not found" for a merchant the outage simply could not read; a
  // genuine miss still 404s. This call is not inside the route's create-order try, so
  // the store fault is caught right here and classified by the shared classifier.
  let merchant;
  try {
    merchant = await db.orderRepo.resolveMerchant(mchtInput);
  } catch (err) {
    return replyStoreError(res, req, err, 'restaurant lookup');
  }
  if (!merchant) {
    return res.status(404).json({
      success: false,
      code: 'MERCHANT_NOT_FOUND',
      error: `Restaurant / merchant [${mchtInput}] not found.`,
      requestId: req.id
    });
  }

  if (merchant.merchant_type !== 'RESTAURANT' && merchant.merchant_type !== 'HYBRID_BOTH') {
    return res.status(400).json({
      success: false,
      code: 'MERCHANT_TYPE_MISMATCH',
      error: 'Merchant is not authorized for FOOD service.',
      requestId: req.id
    });
  }

  if (merchant.is_open === false || merchant.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      error: `Restaurant ${merchant.name} is closed or suspended and cannot accept orders.`
    });
  }

  // 3. Resolve items & catalog ownership
  let resolvedProducts;
  try {
    resolvedProducts = await db.orderRepo.resolveFoodProducts(merchant.id, items);
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'restaurant menu');
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'INVALID_ITEMS',
      error: err.message,
      requestId: req.id
    });
  }

  // 4. Idempotency Key
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey || ('idemp_food_' + crypto.randomUUID());

  // 4b. Server-authoritative coupon: the discount comes from
  // `redeem_promotion_atomic`, never from the client's `discount`/`grandTotal`.
  const foodCouponCode = req.body.couponCode || req.body.promoCode || null;
  const grossFoodAmount = Math.round((Number(resolvedProducts.totalAmount) || 0) * 100) / 100;
  let foodCoupon = { applied: false, discount: 0, finalAmount: grossFoodAmount };
  if (foodCouponCode) {
    foodCoupon = await db.redeemCoupon({
      code: foodCouponCode,
      customerId: customerUuid,
      orderAmount: grossFoodAmount,
      service: 'FOOD',
      idempotencyKey: `food_coupon:${idempotencyKey}`
    });
    if (!foodCoupon.applied) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_PROMO_CODE',
        error: foodCoupon.error,
        requestId: req.id
      });
    }
  }
  const foodFinalAmount = Math.round((grossFoodAmount - foodCoupon.discount) * 100) / 100;

  // 5. Metadata
  const metadata = {
    deliveryAddress: foodDeliveryAddress,
    customerName: req.user.name || 'Customer',
    customerPhone: req.user.phone || null,
    source: 'web_or_mobile',
    ...(foodCoupon.applied ? {
      coupon: {
        code: foodCoupon.code,
        promotionId: foodCoupon.promotionId,
        redemptionId: foodCoupon.redemptionId,
        discount: foodCoupon.discount,
        grossAmount: grossFoodAmount,
        payableAmount: foodFinalAmount
      }
    } : {})
  };

  // 6. Invoke Migration 019 create_order_with_lines_atomic
  try {
    const result = await db.orderRepo.createOrderWithLinesAtomic({
      serviceType: 'FOOD',
      customerId: customerUuid,
      merchantId: merchant.id,
      totalAmount: foodFinalAmount,
      items: resolvedProducts.lines,
      metadata,
      idempotencyKey
    });

    if (!result.success) {
      const statusCode = result.code === 'IDEMPOTENCY_CONFLICT' ? 409 : (result.code === 'CUSTOMER_NOT_FOUND' || result.code === 'MERCHANT_NOT_FOUND' || result.code === 'PRODUCT_NOT_FOUND' ? 404 : 400);
      return res.status(statusCode).json(result);
    }

    // Broadcast to merchant
    broadcastToMerchant(merchant.id, {
      type: 'NEW_FOOD_ORDER',
      order: {
        id: result.order_id,
        orderNumber: result.order_number,
        customerName: req.user.name,
        customerPhone: req.user.phone,
        items: result.items,
        totalAmount: result.total_amount,
        deliveryAddress: metadata.deliveryAddress
      }
    });

    // Response object: database authoritative
    const dbOrder = await db.orderRepo.getOrderById(result.order_id);
    const orderPayload = {
      id: dbOrder.id,
      order_id: dbOrder.id,
      orderNumber: dbOrder.order_number,
      order_number: dbOrder.order_number,
      orderState: dbOrder.order_state,
      order_state: dbOrder.order_state,
      status: dbOrder.order_state,
      serviceType: dbOrder.service_type,
      service_type: dbOrder.service_type,
      customerId: dbOrder.customer_id,
      customer_id: dbOrder.customer_id,
      merchantId: dbOrder.merchant_id,
      merchant_id: dbOrder.merchant_id,
      totalAmount: Number(dbOrder.total_amount),
      total_amount: Number(dbOrder.total_amount),
      total: Number(dbOrder.total_amount),
      fare: Number(dbOrder.total_amount),
      items: dbOrder.lines || [],
      lines: dbOrder.lines || [],
      metadata: dbOrder.metadata || {},
      createdAt: dbOrder.created_at,
      discount: foodCoupon.discount,
      appliedPromo: foodCoupon.applied ? {
        code: foodCoupon.code,
        promotionId: foodCoupon.promotionId,
        redemptionId: foodCoupon.redemptionId,
        discount: foodCoupon.discount
      } : null,
      packagingFee: 15,
      gst: Math.round(Number(dbOrder.total_amount) * 0.05)
    };

    return res.json({
      success: true,
      duplicate: !!result.duplicate,
      order: orderPayload,
      job: orderPayload
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'food order');
    return res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

// Customer Food/Grocery Order Reads
app.get('/api/customer/orders', authenticateUser, async (req, res) => {
  try {
    const customerUuid = db.orderRepo.resolveUserUuid(req.user.uuid || req.user.id);
    if (!customerUuid) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid customer identity.' });
    }
    const orders = await db.orderRepo.getOrdersByCustomer(customerUuid);
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// One history feed for every service the customer has used, so the app does not need
// four endpoints and four guesses. Rides and parcels come from `jobs`, food and
// Instamart from `orders`; the two sets are disjoint by construction because
// getJobsByCustomer deliberately excludes the FOOD/GROCERY delivery legs that sit beside
// an order. Identity comes only from the bearer token, never from a query parameter, so
// there is no customer id to tamper with, and an unreadable store is a 503 rather than
// an empty history.
app.get('/api/customer/activity', authenticateUser, async (req, res) => {
  try {
    const customerUuid = db.orderRepo.resolveUserUuid(req.user.uuid || req.user.id);
    if (!customerUuid) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid customer identity.' });
    }
    const [jobs, orders] = await Promise.all([
      db.jobRepo.getJobsByCustomer(customerUuid),
      db.orderRepo.getOrdersByCustomer(customerUuid),
    ]);
    const items = [
      ...jobs.map(j => ({
        id: j.id,
        service: j.type === 'PARCEL' ? 'PARCEL' : 'RIDE',
        title: j.type === 'PARCEL' ? 'Parcel delivery' : 'Ride',
        status: j.status,
        amount: j.fare,
        currency: 'INR',
        placedAt: j.createdAt,
        active: !['COMPLETED', 'CANCELLED'].includes(j.status),
      })),
      ...orders.map(o => ({
        id: o.order_number,
        service: o.service_type === 'GROCERY' ? 'INSTAMART' : 'FOOD',
        title: o.service_type === 'GROCERY' ? 'Instamart order' : 'Food order',
        status: o.order_state,
        amount: Number(o.total_amount),
        currency: o.currency || 'INR',
        placedAt: o.created_at,
        itemCount: (o.lines || []).length,
        active: !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.order_state),
      })),
    ].sort((a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime());
    res.json({ success: true, count: items.length, items });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'customer activity');
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get(['/api/customer/orders/:id', '/api/orders/:id'], authenticateUser, async (req, res) => {
  try {
    const customerUuid = db.orderRepo.resolveUserUuid(req.user.uuid || req.user.id);
    const order = await db.orderRepo.getOrderById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    // Reject cross-customer IDOR if caller is customer
    if (customerUuid && order.customer_id !== customerUuid) {
      return res.status(403).json({ success: false, error: 'Forbidden: Cannot access another customer\'s order.' });
    }
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// RESTAURANT / MERCHANT API ENDPOINTS
// The merchant's own entitlements, derived from the bearer token and from PostgreSQL.
//
// This is the read that lets ONE Merchant app decide which modules to draw instead of two
// APKs being pre-cut at build time, and it is deliberately not the client's own claim: the
// caller sends no service, no merchant id and no restaurant id. Nothing here authorises
// anything by itself — every gated route re-resolves the entitlement server-side, because a
// list the client fetched is a navigation hint, not a permission.
//
// `services` is spelled the way the apps read it (RESTAURANT / INSTAMART) while
// `merchantType` keeps the stored vocabulary (RESTAURANT / GROCERY / HYBRID_BOTH), so the
// column stays the single source of truth and the client is not asked to learn it.
app.get('/api/merchant/services', authenticateMerchant, async (req, res) => {
  try {
    const merchantId = req.merchant && (req.merchant.id || req.merchant.merchantId);
    const row = merchantId ? await db.orderRepo.resolveMerchant(merchantId) : null;
    const merchantType = row && (row.merchant_type || row.merchantType);

    if (!merchantType) {
      // Refuse rather than guess. An empty service list rendered as "available services"
      // would look like a store with no modules, which is a different (and calmer) lie than
      // telling a partner they can sell a service the platform has not granted them.
      return res.status(403).json({
        success: false,
        code: 'MERCHANT_IDENTITY_UNRESOLVED',
        error: 'Forbidden: this merchant account could not be resolved to a service entitlement.',
        requestId: req.id
      });
    }

    const services = [];
    if (['RESTAURANT', 'HYBRID_BOTH'].includes(String(merchantType).toUpperCase())) services.push('RESTAURANT');
    if (['GROCERY', 'HYBRID_BOTH'].includes(String(merchantType).toUpperCase())) services.push('INSTAMART');

    res.json({
      success: true,
      merchantId: row.id,
      name: row.name || null,
      merchantType,
      services,
      // Single service means the app can go straight in; two means it shows a selector.
      needsServiceSelector: services.length > 1,
      isOpen: row.is_open !== undefined ? Boolean(row.is_open) : null,
      // The merchant's own identity, straight from its record. Deliberately limited to the
      // columns that exist: `merchants` carries `fssai_license` but NO verification or
      // GSTIN column, so there is nothing here to render a "Verified Partner" badge from
      // and none is invented. A restaurant console that cannot say who it is belongs on
      // an empty state, not on a plausible-looking constant.
      profile: {
        name: row.name || null,
        phone: row.phone || null,
        address: row.address || null,
        fssaiLicense: row.fssai_license || null,
        city: row.city || null,
        rating: row.rating !== undefined && row.rating !== null ? Number(row.rating) : null
      }
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'merchant service entitlements');
    console.error('[merchant/services] failed:', err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.code || 'MERCHANT_SERVICES_READ_FAILED',
      error: err.message,
      requestId: req.id
    });
  }
});

app.get('/api/merchant/:restaurantId/dashboard', authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const merchant = await db.orderRepo.resolveMerchant(req.merchant.id || req.params.restaurantId);
    if (!merchant) {
      return res.status(401).json({ success: false, error: 'Merchant not found', requestId: req.id });
    }

    if (req.params.restaurantId) {
      const requestedMerchant = await db.orderRepo.resolveMerchant(req.params.restaurantId);
      // DECISION A1: an unknown :restaurantId used to fall through and serve the caller's own
      // dashboard with 200, because only a KNOWN other merchant was refused. The sibling
      // /api/merchant/:restaurantId/orders route refuses both cases, so this now matches that
      // stricter convention: no match at all is an authorization failure, not a silent success.
      if (!requestedMerchant || requestedMerchant.id !== merchant.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Cannot access another merchant\'s restaurant dashboard.',
          requestId: req.id
        });
      }
    }

    const merchantOrders = await db.orderRepo.getOrdersByMerchant(merchant.id);
    const activeOrdersCount = merchantOrders.filter(o => !['DELIVERED', 'REJECTED', 'CANCELLED'].includes(o.order_state)).length;
    const todaySales = merchantOrders.reduce((sum, o) =>
      sum + (o.order_state !== 'CANCELLED' && o.order_state !== 'REJECTED' ? Number(o.total_amount) : 0), 0
    );

    res.json({
      success: true,
      restaurant: merchant,
      activeOrdersCount,
      todaySales,
      orders: merchantOrders
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'merchant dashboard');
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get(['/api/merchant/:restaurantId/orders', '/api/merchant/orders'], authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const merchant = await db.orderRepo.resolveMerchant(req.merchant.id || req.params.restaurantId);
    if (!merchant) {
      return res.status(401).json({ success: false, error: 'Merchant not found', requestId: req.id });
    }

    if (req.params.restaurantId) {
      const requestedMerchant = await db.orderRepo.resolveMerchant(req.params.restaurantId);
      if (!requestedMerchant || requestedMerchant.id !== merchant.id) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Cannot access another merchant\'s orders.',
          requestId: req.id
        });
      }
    }

    const orders = await db.orderRepo.getOrdersByMerchant(merchant.id, { status: req.query.status });
    res.json({ success: true, count: orders.length, orders });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'merchant orders');
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post(['/api/merchant/:restaurantId/orders/:orderId/status', '/api/merchant/orders/:orderId/status'], authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const { status, reason } = req.body;
    // `Idempotency-Key` is the canonical spelling every other mutating route here accepts (and
    // the one the CORS allow-list grants). This route read only `req.body.idempotencyKey`, so a
    // client that sent the documented header got silently non-idempotent behaviour: the
    // PostgreSQL transition function deduplicates on the key *before* it validates the state,
    // but it was never handed the key, and a retry came back as INVALID_TRANSITION instead of
    // the duplicate it was.
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;
    const orderId = req.params.orderId;

    const merchant = await db.orderRepo.resolveMerchant(req.merchant.id || req.params.restaurantId);
    if (!merchant) {
      return res.status(401).json({ success: false, error: 'Merchant profile not found', requestId: req.id });
    }

    const order = await db.orderRepo.getOrderById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found', requestId: req.id });
    }

    // Verify merchant owns this order
    if (order.merchant_id !== merchant.id) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Cannot modify another merchant\'s order.',
        requestId: req.id
      });
    }

    // KDS approved state check
    const APPROVED_KDS_STATES = ['ACCEPTED', 'REJECTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP'];
    if (!APPROVED_KDS_STATES.includes(status)) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_STATUS',
        error: `Invalid KDS status: ${status}. Must be one of: ${APPROVED_KDS_STATES.join(', ')}`
      });
    }

    // Rejection reason check
    if (status === 'REJECTED') {
      const APPROVED_REASONS = ['ITEM_UNAVAILABLE', 'MERCHANT_CLOSED', 'OUT_OF_STOCK', 'UNABLE_TO_PREPARE', 'INVALID_ORDER', 'OTHER'];
      if (!reason || !APPROVED_REASONS.includes(reason)) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_REJECTION_REASON',
          error: `Valid rejection reason required for REJECTED state. Must be one of: ${APPROVED_REASONS.join(', ')}`
        });
      }
    }

    // Invoke Migration 018 transition authority
    const transitionRes = await db.orderRepo.transitionOrderState({
      orderId: order.id,
      newState: status,
      actorRole: 'MERCHANT',
      actorId: merchant.id,
      reason,
      idempotencyKey: idempotencyKey || ('trans_' + order.id + '_' + status + '_' + Date.now()),
      metadata: { actor: req.merchant.name || 'Merchant' }
    });

    if (!transitionRes.success) {
      return res.status(400).json(transitionRes);
    }

    if (status === 'READY_FOR_PICKUP') {
      broadcastToDrivers({
        type: 'NEW_JOB_DISPATCH',
        job: {
          id: order.id,
          orderId: order.id,
          orderNumber: order.order_number,
          type: order.service_type,
          title: `Order Pickup: ${merchant.name}`,
          totalAmount: order.total_amount
        }
      });
    }

    broadcastToCustomer(order.customer_id, {
      type: 'FOOD_ORDER_UPDATE',
      orderId: order.id,
      orderStatus: status,
      newState: status
    });

    const updatedOrder = await db.orderRepo.getOrderById(order.id);
    return res.json({
      success: true,
      duplicate: !!transitionRes.duplicate,
      transitionId: transitionRes.transitionId,
      order_state: status,
      status: status,
      newState: status,
      order: updatedOrder,
      job: {
        id: order.id,
        orderId: order.id,
        orderStatus: status,
        status: status
      }
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'order status change');
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/merchant/:restaurantId/menu/:itemId/toggle', authenticateMerchant, requireMerchantTenant, requireMerchantService('RESTAURANT'), async (req, res) => {
  try {
    // Phase 8: Fail-closed (DEC-005) — no fallback to first restaurant
    const rest = db.restaurants.find(r => r.id === req.params.restaurantId);
    if (!rest) return res.status(404).json({ success: false, error: 'Restaurant not found.', requestId: req.id });

    // Verify merchant owns this restaurant.
    //
    // The guard used to read `if (rest.merchantId && rest.merchantId !== req.merchant.id)`, so
    // a store with no owner recorded on it — which is exactly `rest_1`, the seeded legacy
    // restaurant — was left with no check at all: any authenticated merchant could put its menu
    // in and out of stock. Ownership is now resolved the same way the order reads resolve it, so
    // it must be positively established rather than merely absent.
    const [callerMerchant, requestedMerchant] = await Promise.all([
      db.orderRepo.resolveMerchant(req.merchant.id),
      db.orderRepo.resolveMerchant(req.params.restaurantId),
    ]);
    if (!callerMerchant || !requestedMerchant || String(requestedMerchant.id) !== String(callerMerchant.id)) {
      return res.status(403).json({
        success: false,
        code: 'MERCHANT_MISMATCH',
        error: 'Forbidden: Cannot modify another merchant\'s menu.',
        requestId: req.id
      });
    }
    const item = rest.menu.find(m => m.id === req.params.itemId);
    if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });

    item.inStock = req.body.inStock ?? !item.inStock;
    res.json({ success: true, item });
  } catch (err) {
    // Awaiting in an async handler needs a catch: without one a rejected store read becomes an
    // unhandled promise instead of an answer to the merchant, and the audit trail says nothing
    // (`admin_audit_fail_closed_test.js` ST-04 is the guard that keeps that list from growing).
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'menu item availability');
    console.error('[merchant/menu/toggle] failed:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'MENU_TOGGLE_FAILED', error: err.message, requestId: req.id });
  }
});

// -----------------------------------------------------------------------------
// MERCHANT RESTAURANT PROFILE (cuisines / cover image / delivery window)
//
// This is the write half of migration 034, and the reason those columns exist at
// all. `GET /api/restaurants` shows a customer three claims about a kitchen — what
// it cooks, what it looks like, how long it takes — and until this route nothing in
// the codebase could put a value behind any of them, which meant the only content
// those fields ever had was the in-memory fixture. A merchant states them here;
// nothing else fills them and no client guesses them.
//
// Three guards, in the order the menu-toggle route uses them: merchant session,
// tenant binding, RESTAURANT entitlement. Ownership of the *named* restaurant is
// then proven by resolving both ids, because `requireMerchantService` checks the
// caller's type while the path parameter names a different row. The database write
// itself lives in `db.updateMerchantRestaurantProfile`, which refuses to pretend on
// a non-PostgreSQL boot; `rating` is not accepted anywhere in this body.
// -----------------------------------------------------------------------------
app.patch('/api/merchant/:restaurantId/profile', authenticateMerchant, requireMerchantTenant, requireMerchantService('RESTAURANT'), async (req, res) => {
  try {
    const [callerMerchant, requestedMerchant] = await Promise.all([
      db.orderRepo.resolveMerchant(req.merchant.id),
      db.orderRepo.resolveMerchant(req.params.restaurantId),
    ]);
    if (!callerMerchant || !requestedMerchant || String(requestedMerchant.id) !== String(callerMerchant.id)) {
      return res.status(403).json({
        success: false,
        code: 'MERCHANT_MISMATCH',
        error: "Forbidden: Cannot edit another merchant's restaurant profile.",
        requestId: req.id
      });
    }

    const restaurant = await db.updateMerchantRestaurantProfile(req.params.restaurantId, req.body);
    res.json({ success: true, restaurant, dataSource: 'postgres' });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'restaurant profile');
    // The db layer answers with a status of its own: 400 for a value outside the
    // domain, 404 for a restaurant that is not there, and 503 for a server that is
    // not connected to the store the profile lives in. All of them are the merchant's
    // answer, so they must not be flattened into a 500.
    const status = Number.isInteger(err.status) ? err.status : Number.isInteger(err.statusCode) ? err.statusCode : 0;
    if (status >= 400 && status < 600) {
      return res.status(status).json({ success: false, code: err.code, error: err.message, requestId: req.id });
    }
    console.error('[merchant/profile] failed:', err);
    return res.status(500).json({ success: false, code: err.code || 'PROFILE_UPDATE_FAILED', error: err.message, requestId: req.id });
  }
});

// ---------------------------------------------------------------------------
// DS-2 DARK STORE ADMINISTRATION
//
// Each path is registered exactly once. A duplicate registration here would not be
// a cosmetic bug: Express dispatches the FIRST match, so a second copy carrying the
// permission guard would never run (this file already documents that hazard for the
// driver-status route). Authentication and permission are the route's job; ownership
// and business rules belong to darkStoreService, which is the only thing these
// handlers call. No handler touches a repository directly and none reads
// req.body.merchant_id / operated_by_merchant_id as authority.
// `merchant.manage` is the existing operational-store permission (it already governs
// POST /api/admin/restaurants/:id/status); no second permission system was invented.
// ---------------------------------------------------------------------------
function darkStoreAdminActor(req) {
  return { type: 'ADMIN', adminId: req.admin.id, adminName: req.admin.name, role: req.admin.role };
}
// One error shape for the whole group, matching the existing admin convention.
function darkStoreError(res, req, err) {
  const status = err.status || err.statusCode || 400;
  return res.status(status).json({
    success: false,
    ...(err.code ? { code: err.code } : {}),
    error: err.message,
    requestId: req.id
  });
}

app.get('/api/admin/dark-stores', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const stores = await db.darkStoreService.list(darkStoreAdminActor(req), {
      status: req.query.status || null,
    });
    res.json({ success: true, darkStores: stores, total: stores.length });
  } catch (err) { res.status(err.status || 500).json({ success: false, code: err.code, error: err.message, requestId: req.id }); }
});

app.post('/api/admin/dark-stores', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const store = await db.darkStoreService.create(darkStoreAdminActor(req), {
      code: b.code, name: b.name, address: b.address,
      latitude: b.latitude, longitude: b.longitude,
      serviceRadiusM: b.service_radius_m !== undefined ? b.service_radius_m : b.serviceRadiusM,
      timezone: b.timezone, opensAt: b.opens_at, closesAt: b.closes_at,
      // Deliberately NOT read from the body: a store is created platform-operated and the
      // operator is attached by an explicit assignment, so a caller cannot pre-claim one.
    });
    res.json({ success: true, darkStore: store });
  } catch (err) { res.status(err.status || 400).json({ success: false, code: err.code, error: err.message, requestId: req.id }); }
});

app.get('/api/admin/dark-stores/:id', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    res.json({ success: true, darkStore: await db.darkStoreService.get(darkStoreAdminActor(req), req.params.id) });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.patch('/api/admin/dark-stores/:id', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    res.json({ success: true, darkStore: await db.darkStoreService.update(darkStoreAdminActor(req), req.params.id, req.body || {}) });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.post('/api/admin/dark-stores/:id/status', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const store = await db.darkStoreService.setStatus(darkStoreAdminActor(req), req.params.id, (req.body || {}).status);
    // The audit trail is fail-closed here, not optional: swallowing its failure (an earlier
    // draft used `.catch(() => {})`) would leave a completed status change with no record and
    // no signal, which is the exact hazard admin_audit_fail_closed_test ST-03 exists to catch.
    // The change HAS happened, so the answer reports 503 with the applied state, matching the
    // payout route's convention.
    try {
      await db.auditAppliedChange({
        adminId: req.admin.id, adminName: req.admin.name, role: req.admin.role,
        action: 'DARK_STORE_STATUS_CHANGED', module: 'OPERATIONS',
        targetEntityType: 'DARK_STORE', targetEntityId: store.id,
        previousState: (req.body || {}).expectedFrom || null, newState: store.status,
        reason: `Dark store ${store.code} status set to ${store.status}`
      });
    } catch (auditErr) {
      return res.status(auditErr.status || 503).json({
        success: false,
        code: auditErr.code || 'AUDIT_RECORD_UNAVAILABLE',
        applied: true,
        darkStore: store,
        error: auditErr.message,
        requestId: req.id
      });
    }
    res.json({ success: true, darkStore: store });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.get('/api/admin/dark-stores/:id/inventory', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const items = await db.darkStoreService.listInventory(darkStoreAdminActor(req), req.params.id, {
      includeUnavailable: req.query.availableOnly !== 'true',
    });
    res.json({ success: true, inventory: items, total: items.length });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.post('/api/admin/dark-stores/:id/inventory', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const b = req.body || {};
    const item = await db.darkStoreService.createInventory(darkStoreAdminActor(req), req.params.id, {
      productId: b.product_id !== undefined ? b.product_id : b.productId,
      sellingPrice: b.selling_price !== undefined ? b.selling_price : b.sellingPrice,
      stockQuantity: b.stock_quantity !== undefined ? b.stock_quantity : b.stockQuantity,
      lowStockThreshold: b.low_stock_threshold !== undefined ? b.low_stock_threshold : b.lowStockThreshold,
      isAvailable: b.is_available !== undefined ? b.is_available : b.isAvailable,
      status: b.status,
    });
    res.json({ success: true, inventory: item });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.patch('/api/admin/dark-stores/:id/inventory/:inventoryId', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const b = req.body || {};
    // The inventory id in the path is a TARGET. The service re-checks that it belongs to the
    // store named in the path, and the repository qualifies the UPDATE by dark_store_id, so a
    // foreign row matches zero records instead of being written through another store's URL.
    const item = await db.darkStoreService.updateInventory(darkStoreAdminActor(req), req.params.id, req.params.inventoryId, {
      sellingPrice: b.selling_price !== undefined ? b.selling_price : b.sellingPrice,
      stockQuantity: b.stock_quantity !== undefined ? b.stock_quantity : b.stockQuantity,
      lowStockThreshold: b.low_stock_threshold !== undefined ? b.low_stock_threshold : b.lowStockThreshold,
      isAvailable: b.is_available !== undefined ? b.is_available : b.isAvailable,
      status: b.status,
    });
    res.json({ success: true, inventory: item });
  } catch (err) { return darkStoreError(res, req, err); }
});

app.post('/api/admin/restaurants/:id/status', authenticateAdmin, requirePermission('merchant.manage'), async (req, res) => {
  try {
    const { status, reason } = req.body;
    const result = await db.setRestaurantStatus(req.params.id, status, reason, req.admin.id, req.admin.name);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

// DRIVER FLEET GOVERNANCE & TELEMETRY
// (POST /api/admin/drivers/:id/status is declared above, with its
//  fleet.manage guard. A second, identical registration of that path used to sit
//  here: Express dispatches the first match, so the copy carrying the permission
//  check never ran and reading this file gave the wrong impression of what the
//  route enforces.)

app.post('/api/admin/drivers/:id/verify-payout-destination', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  const { decision, evidenceUrl, bankAccountHolderName, reason } = req.body;
  if (!decision || !['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be APPROVE or REJECT' });
  }
  let result;
  try {
    result = await db.driverRepo.verifyPayoutDestination(req.params.id, {
      decision,
      evidenceUrl,
      bankAccountHolderName,
      reason,
      adminId: req.admin.id,
      adminName: req.admin.name
    });
  } catch (err) {
    // `verifyPayoutDestination` only throws once the `drivers` row has been written and its
    // audit record refused, so the verdict really did change even though this answers 5xx.
    // Without a catch the request hung: Express 4 does not forward an async rejection.
    return res.status(err.status || err.statusCode || 503).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      applied: err.applied === true,
      error: err.message
    });
  }
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// Shared implementation behind both spellings of the online switch.
//
// `drivers.is_online` is a real column and boot hydration reads it back, so going online
// has to be written to PostgreSQL. It used to mutate the in-memory object only, which meant
// a partner who pressed Online was visible to dispatch until the next restart and invisible
// afterwards — while their own app still showed a green ONLINE. The reverse was worse: the
// platform's answer to "who is available?" and the partner's answer disagreed, and neither
// survived a deploy.
//
// A store that cannot answer is reported as a 503 rather than a confident success, because
// telling a driver they are online when nothing was persisted sends them waiting for a job
// the dispatcher cannot see them for.
async function applyDriverAvailability(driver, isOnline) {
  const wanted = Boolean(isOnline);

  if (driver.operationalStatus === 'SUSPENDED') {
    const err = new Error(`Your driver account is SUSPENDED by NABIN Admin. Reason: ${driver.suspensionReason || 'Compliance review'}`);
    err.code = 'DRIVER_SUSPENDED';
    err.status = 403;
    throw err;
  }

  let updated;
  try {
    updated = await db.driverRepo.setOnlineStatus(driver.id, wanted);
  } catch (err) {
    throw db.orderRepo.storeUnavailableError('your online status', err);
  }
  if (!updated) {
    const err = new Error('No driver account is attached to this session.');
    err.code = 'DRIVER_NOT_FOUND';
    err.status = 403;
    throw err;
  }

  // The suspension may have landed while the partner was already on shift. The durable
  // write succeeded, so report what the account is now allowed to do.
  if (updated.operationalStatus === 'SUSPENDED') {
    updated.isOnline = false;
    updated.driverState = 'OFFLINE';
  }

  return {
    success: true,
    isOnline: Boolean(updated.isOnline),
    operationalStatus: updated.operationalStatus || null,
  };
}

function driverAvailabilityFailure(res, req, err, fallbackLabel) {
  if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, fallbackLabel);
  console.error('[driver/availability] failed:', err);
  return res.status(err.status || 500).json({ success: false, code: err.code || 'AVAILABILITY_UPDATE_FAILED', error: err.message });
}

app.post('/api/driver/:driverId/toggle-online', authenticateDriver, async (req, res) => {
  const requestedId = req.params.driverId;
  const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
  const targetUuid = db.driverRepo?.resolveUuid(requestedId) || requestedId;
  if (requestedId !== req.driver.id && callerUuid !== targetUuid) {
    return res.status(403).json({
      success: false,
      code: 'DRIVER_MISMATCH',
      error: 'Forbidden: Cannot toggle online status for another driver.'
    });
  }

  const driver = db.getDriver(req.driver.id) || req.driver;
  try {
    res.json(await applyDriverAvailability(driver, req.body.isOnline ?? !driver.isOnline));
  } catch (err) {
    return driverAvailabilityFailure(res, req, err, 'driver availability');
  }
});

// The same switch without a partner id in the path or the body. Identity is the bearer
// token's, so the driver app has nothing to send that it could get wrong.
app.post('/api/driver/status', authenticateDriver, async (req, res) => {
  const { isOnline } = req.body || {};
  if (typeof isOnline !== 'boolean') {
    return res.status(400).json({
      success: false,
      code: 'INVALID_AVAILABILITY',
      error: 'A true or false `isOnline` value is required.'
    });
  }
  const driver = db.getDriver(req.driver.id) || req.driver;
  try {
    res.json(await applyDriverAvailability(driver, isOnline));
  } catch (err) {
    return driverAvailabilityFailure(res, req, err, 'driver availability');
  }
});

app.get('/api/driver/:driverId/dashboard', authenticateDriver, (req, res) => {
  const requestedId = req.params.driverId;
  const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
  const targetUuid = db.driverRepo?.resolveUuid(requestedId) || requestedId;
  if (requestedId !== req.driver.id && callerUuid !== targetUuid) {
    return res.status(403).json({
      success: false,
      code: 'DRIVER_MISMATCH',
      error: 'Forbidden: Cannot access another driver\'s dashboard.'
    });
  }

  const driver = db.getDriver(req.driver.id) || req.driver;
  res.json({ success: true, driver });
});

// A dispatch offer row carries ids, distance and rank — not a decision. Both spellings of
// the offers read hydrate each one from the job behind it so a partner can see the fare they
// would earn and the two ends of the trip, and so `GET /api/driver/offers` and the console
// cannot grow into two different answers to the same question.
//
// The raw offer fields are spread in rather than replaced, so `id` keeps meaning what it
// meant to any reader that already exists, and `offerId` is added as the name the app uses.
// Where the job cannot be read, the offer comes back with `detailsAvailable: false` instead
// of a made-up fare: an incomplete list is a shorter truth, not a licence to guess.
async function buildDriverOfferViews(driverId) {
  const offers = await db.dispatchRepo.getOffersForDriver(driverId);

  const summaries = await db.jobRepo.getJobSummariesByUuids(
    (offers || []).map(o => o.jobUuid || o.jobId).filter(Boolean)
  );

  return (offers || []).map((o) => {
    const job = summaries instanceof Map ? summaries.get(String(o.jobUuid || o.jobId)) : null;
    const expiry = o.expiresAt ? Date.parse(o.expiresAt) : null;
    return {
      ...o,
      offerId: o.id,
      status: o.status,
      secondsLeft: Number.isFinite(expiry) ? Math.max(0, Math.round((expiry - Date.now()) / 1000)) : null,
      distanceToPickupKm: o.distanceToPickup !== undefined ? o.distanceToPickup : null,
      serviceType: job?.serviceType || o.metadata?.serviceType || null,
      pickupAddress: job?.pickupAddress || null,
      dropAddress: job?.dropAddress || null,
      fare: job ? job.fare : null,
      driverEarnings: job ? job.driverEarnings : null,
      platformCommission: job ? job.platformCommission : null,
      detailsAvailable: Boolean(job),
    };
  });
}

// The driver console's one read: who this partner is, whether they are available, the job
// they are standing on, and the offers actually in front of them.
//
// Everything here is derived from PostgreSQL through the same token-scoped identity the
// earnings read uses. The previous screen had none of it — availability was a Dart boolean,
// "8 Trips Done" and ₹1,420.00 were literals, and the offers came from three buttons that
// invented a ride, a parcel and a food order on tap, complete with a customer name and a
// number the platform had never priced.
async function buildDriverHomePayload(driver) {
  const driverUuid = db.driverRepo?.resolveUuid(driver.id) || driver.uuid || driver.id;
  if (!driverUuid) {
    const err = new Error('The driver identity for this session could not be resolved to a dispatch account.');
    err.code = 'DRIVER_IDENTITY_UNRESOLVED';
    err.status = 403;
    throw err;
  }

  const [offerViews, activeJob] = await Promise.all([
    buildDriverOfferViews(driver.id),
    db.dispatchRepo.getActiveAssignmentForDriver(driver.id),
  ]);

  const isOnline = Boolean(driver.isOnline);
  return {
    success: true,
    serverTime: new Date().toISOString(),
    driver: {
      id: driver.id,
      uuid: driverUuid,
      name: driver.name || null,
      phone: driver.phone || null,
      rating: driver.rating !== undefined ? Number(driver.rating) : null,
      vehicleType: driver.vehicleType || driver.type || null,
      vehicleNumber: driver.vehicleNumber || driver.vehiclePlate || null,
      kycStatus: driver.kycStatus || driver.status || null,
      operationalStatus: driver.operationalStatus || null,
      isOnline,
      driverState: isOnline ? 'ONLINE' : 'OFFLINE',
      walletBalance: Math.round((Number(driver.walletBalance) || 0) * 100) / 100,
      activeJobId: driver.activeJobId || null,
    },
    // The durable availability, echoed once so the client renders the server's answer
    // instead of the state it last asked for.
    availability: { isOnline, operationalStatus: driver.operationalStatus || null },
    activeJob: activeJob || null,
    offers: offerViews,
    offerCount: offerViews.length,
  };
}

app.get('/api/driver/home', authenticateDriver, async (req, res) => {
  try {
    res.json(await buildDriverHomePayload(db.getDriver(req.driver.id) || req.driver));
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'driver console state');
    console.error('[driver/home] failed:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'DRIVER_HOME_READ_FAILED', error: err.message });
  }
});

// Authoritative Driver Dispatch Offers Endpoint
app.get(['/api/driver/offers', '/api/driver/:driverId/offers'], authenticateDriver, async (req, res) => {
  try {
    const requestedId = req.params.driverId;
    if (requestedId) {
      const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
      const targetUuid = db.driverRepo?.resolveUuid(requestedId) || requestedId;
      if (requestedId !== req.driver.id && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'DRIVER_MISMATCH',
          error: 'Forbidden: Cannot view another driver\'s dispatch offers.'
        });
      }
    }

    const offers = await buildDriverOfferViews(req.driver.id);
    res.json({ success: true, count: offers.length, offers });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'dispatch offers');
    console.error('[driver/offers] failed:', err);
    res.status(err.status || 500).json({ success: false, code: err.code || 'OFFERS_READ_FAILED', error: err.message });
  }
});

// One status vocabulary for every offer response.
//
// An offer that is no longer `OFFERED` — lost to another partner, expired, already accepted,
// already declined — is a conflict on the state of the row, not a malformed request. The
// route used to answer 400 to all of them, which left a partner's app unable to tell "this
// trip just went to somebody else" apart from "the request made no sense", and both of those
// ask for a different sentence on screen and a different next action.
function offerResponseStatus(code) {
  if (code === 'OFFER_NOT_FOUND' || code === 'JOB_NOT_FOUND') return 404;
  if (['DRIVER_MISMATCH', 'DRIVER_SUSPENDED', 'IDENTITY_SPOOFING_REJECTED', 'DRIVER_IDENTITY_UNRESOLVED', 'UNLINKED_DRIVER_ACCOUNT'].includes(code)) return 403;
  if (['JOB_ALREADY_ASSIGNED', 'OFFER_NOT_AVAILABLE', 'OFFER_EXPIRED', 'OFFER_ALREADY_ACCEPTED', 'OFFER_ALREADY_REJECTED', 'OFFER_CLOSED'].includes(code)) return 409;
  return 400;
}

// Authoritative Offer Acceptance by Offer ID
app.post('/api/driver/offers/:offerId/accept', authenticateDriver, async (req, res) => {
  try {
    const offerId = req.params.offerId;
    const idempotencyKey = req.headers['idempotency-key'] || req.body?.idempotencyKey;

    // Anti-spoofing verification if client supplies driverId in body
    const bodyDriverId = req.body?.driverId || req.body?.driver_id || req.body?.driverUuid;
    if (bodyDriverId) {
      const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
      const targetUuid = db.driverRepo?.resolveUuid(bodyDriverId) || bodyDriverId;
      if (bodyDriverId !== req.driver.id && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_SPOOFING_REJECTED',
          error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
        });
      }
    }

    const result = await db.dispatchRepo.acceptOfferAtomic({
      offerId,
      driverId: req.driver.id,
      idempotencyKey
    });

    if (!result.success) {
      return res.status(offerResponseStatus(result.code)).json(result);
    }

    const targetJobId = result.job_id || result.job_uuid;
    const job = db.jobRepo?.findById(targetJobId) || await db.jobRepo?.findByIdAsync(targetJobId);
    const driver = db.getDriver(req.driver.id) || req.driver;

    if (driver && job) {
      driver.activeJobId = job.id;
      broadcastToCustomer(job.customerId, {
        type: 'DRIVER_ASSIGNED',
        jobId: job.id,
        // `rating` is not projected. `drivers.rating NUMERIC(3,2) DEFAULT 5.00` (001:58) is a
        // column, not a measurement — no reviews or ratings table exists in this schema, so the
        // best case a customer could be shown here is the DDL default stamped as a score. Same
        // ruling migration 034 made for `merchants.rating`; the driver's own reads keep the column.
        driver: {
          name: driver.name,
          vehiclePlate: driver.vehiclePlate,
          startOtp: job.startOtp
        }
      });
    }

    res.json({ success: true, duplicate: !!result.duplicate, job, driver, offer: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Authoritative Offer Decline by Offer ID.
//
// The REJECTED state, the `rejection_reason` column and an RLS policy commented "drivers can
// ONLY update their own offers (e.g. reject/respond)" have existed since migration 014/020,
// but no route ever implemented them — so the driver app's Decline button had nothing to
// call and simply hid the fabricated card. This is that missing endpoint, and it is written
// against the same offer row the accept path uses, so the two cannot both win.
app.post('/api/driver/offers/:offerId/reject', authenticateDriver, async (req, res) => {
  try {
    const offerId = req.params.offerId;

    // A body-supplied driverId is only ever checked against the token, never believed.
    const bodyDriverId = req.body?.driverId || req.body?.driver_id || req.body?.driverUuid;
    if (bodyDriverId) {
      const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
      const targetUuid = db.driverRepo?.resolveUuid(bodyDriverId) || bodyDriverId;
      if (bodyDriverId !== req.driver.id && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_SPOOFING_REJECTED',
          error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
        });
      }
    }

    const result = await db.dispatchRepo.rejectOfferAtomic({
      offerId,
      driverId: req.driver.id,
      reason: req.body?.reason || null,
    });

    if (!result.success) {
      return res.status(offerResponseStatus(result.code)).json(result);
    }

    // A declined offer takes the job out of this partner's queue. The competing offers for
    // the same job are untouched — they were never this driver's to close, and the dispatch
    // rule that re-offers a job belongs to the dispatcher, not to a decline.
    res.json({ ...result, offerId });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'dispatch offer response');
    console.error('[driver/offers/reject] failed:', err);
    return res.status(err.status || 400).json({ success: false, code: err.code || 'OFFER_REJECT_FAILED', error: err.message });
  }
});

app.post('/api/driver/accept-job', authenticateDriver, async (req, res) => {
  const { jobId, offerId } = req.body;

  // Anti-spoofing verification: client-supplied driverId must match session
  const bodyDriverId = req.body?.driverId || req.body?.driver_id || req.body?.driverUuid;
  if (bodyDriverId) {
    const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
    const targetUuid = db.driverRepo?.resolveUuid(bodyDriverId) || bodyDriverId;
    if (bodyDriverId !== req.driver.id && callerUuid !== targetUuid) {
      return res.status(403).json({
        success: false,
        code: 'IDENTITY_SPOOFING_REJECTED',
        error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
      });
    }
  }

  const effectiveDriverId = req.driver.id;
  let driver = db.getDriver(effectiveDriverId) || req.driver;

  const { supabaseAdmin, isLivePostgres } = require('./supabase');
  if (isLivePostgres && supabaseAdmin) {
    const targetUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || driver?.uuid || effectiveDriverId;
    const { data: dbDriver } = await supabaseAdmin.from('drivers').select('*').eq('id', targetUuid).maybeSingle();
    if (dbDriver) {
      driver.userId = dbDriver.user_id;
      driver.user_id = dbDriver.user_id;
      driver.kycStatus = dbDriver.kyc_status;
      driver.status = dbDriver.kyc_status;
      driver.operationalStatus = dbDriver.operational_status;
    }
  }

  if (!driver.userId && !driver.user_id) {
    return res.status(403).json({
      success: false,
      error: 'Unlinked driver profile cannot accept jobs. Account linkage required.',
      code: 'UNLINKED_DRIVER_ACCOUNT'
    });
  }

  if (driver.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({ success: false, error: 'Suspended driver cannot accept trips.' });
  }

  try {
    let job;
    let duplicate = false;
    if (isLivePostgres && supabaseAdmin) {
      const result = await db.dispatchRepo.acceptJobAtomic({
        jobId,
        driverId: effectiveDriverId,
        offerId
      });

      if (!result.success) {
        return res.status(offerResponseStatus(result.code)).json(result);
      }

      duplicate = !!result.duplicate;
      const targetJobId = result.job_id || jobId;
      job = db.jobRepo?.findById(targetJobId) || await db.jobRepo?.findByIdAsync(targetJobId);
    } else {
      job = await db.updateJobStatus(jobId, 'ASSIGNED', driver.id);
    }

    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    driver.activeJobId = job.id;
    broadcastToCustomer(job.customerId, {
      type: 'DRIVER_ASSIGNED',
      jobId: job.id,
      // See the accept-offer broadcast above: `driver.rating` is a schema default, not a
      // measurement, so the customer is not handed one here either.
      driver: {
        name: driver.name,
        vehicleName: driver.vehicleName,
        vehiclePlate: driver.vehiclePlate,
        startOtp: job.startOtp
      }
    });

    // Phase 17 M4: Publish post-commit JOB_ACCEPTED event
    try {
      notificationEventBus.publish('JOB_ACCEPTED', {
        jobId: job.id,
        eventKey: `job_accepted:${job.id}`,
        customerId: job.customerId,
        driverId: driver.id,
        title: 'Driver Assigned',
        body: `${driver.name} has accepted your trip request and is heading your way.`,
        notificationType: 'JOB_ACCEPTED',
        priority: 'HIGH',
        data: { jobId: job.id, driverId: driver.id, driverName: driver.name, vehiclePlate: driver.vehiclePlate }
      });
    } catch (notifErr) {
      console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit JOB_ACCEPTED for job ${job.id}:`, notifErr.message);
    }

    res.json({ success: true, duplicate, job, driver });
  } catch (err) {
    const isAssignErr = err.message && (err.message.includes('could not transition to ASSIGNED') || err.message.includes('assigned to another driver'));
    const statusCode = isAssignErr ? 409 : 400;
    res.status(statusCode).json({ success: false, error: err.message, code: isAssignErr ? 'JOB_ALREADY_ASSIGNED' : 'TRANSITION_FAILED' });
  }
});

// Authoritative Dedicated Driver Arrival Endpoint
app.post(['/api/driver/arrived', '/api/driver/arrive'], authenticateDriver, async (req, res) => {
  try {
    const { jobId } = req.body;
    if (!jobId) {
      return res.status(400).json({ success: false, error: 'jobId is required.' });
    }

    const bodyDriverId = req.body?.driverId || req.body?.driver_id || req.body?.driverUuid;
    if (bodyDriverId) {
      const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
      const targetUuid = db.driverRepo?.resolveUuid(bodyDriverId) || bodyDriverId;
      if (bodyDriverId !== req.driver.id && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_SPOOFING_REJECTED',
          error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
        });
      }
    }

    const effectiveDriverId = req.driver.id;

    // Verify job is assigned to this driver
    const job = db.getJob(jobId) || await db.jobRepo?.findByIdAsync(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const callerUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || req.driver.uuid || effectiveDriverId;
    const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
    if (job.driverId !== effectiveDriverId && callerUuid !== jobDriverUuid) {
      return res.status(403).json({
        success: false,
        code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
        error: 'Forbidden: You are not assigned to this job.'
      });
    }

    // Authoritative DRIVER_ARRIVED transition via db.updateJobStatus
    const updatedJob = await db.updateJobStatus(jobId, 'DRIVER_ARRIVED', effectiveDriverId);
    if (!updatedJob) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    broadcastToCustomer(updatedJob.customerId, {
      type: 'DRIVER_ARRIVED',
      jobId: updatedJob.id,
      driverId: effectiveDriverId
    });

    // Phase 17 M4: Publish post-commit DRIVER_ARRIVED event
    try {
      notificationEventBus.publish('DRIVER_ARRIVED', {
        jobId: updatedJob.id,
        eventKey: `driver_arrived:${updatedJob.id}`,
        customerId: updatedJob.customerId,
        driverId: effectiveDriverId,
        title: 'Driver Arrived',
        body: 'Your driver has arrived at the pickup location.',
        notificationType: 'DRIVER_ARRIVED',
        priority: 'HIGH',
        data: { jobId: updatedJob.id, driverId: effectiveDriverId }
      });
    } catch (notifErr) {
      console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit DRIVER_ARRIVED for job ${updatedJob.id}:`, notifErr.message);
    }

    res.json({ success: true, job: updatedJob });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Authoritative Driver Trip / Delivery OTP Verification
app.post('/api/driver/verify-otp', authenticateDriver, async (req, res) => {
  try {
    const jobId = req.body.jobId;
    const otp = req.body.otp || req.body.enteredOtp;
    const otpType = req.body.otpType || 'START';

    const bodyDriverId = req.body?.driverId || req.body?.driver_id || req.body?.driverUuid;
    if (bodyDriverId) {
      const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
      const targetUuid = db.driverRepo?.resolveUuid(bodyDriverId) || bodyDriverId;
      if (bodyDriverId !== req.driver.id && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'IDENTITY_SPOOFING_REJECTED',
          error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
        });
      }
    }

    const effectiveDriverId = req.driver.id;

    // Verify job is assigned to this driver
    const job = db.getJob(jobId) || await db.jobRepo?.findByIdAsync(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }

    const callerUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || req.driver.uuid || effectiveDriverId;
    const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
    if (job.driverId !== effectiveDriverId && callerUuid !== jobDriverUuid) {
      return res.status(403).json({
        success: false,
        code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
        error: 'Forbidden: You are not assigned to this job.'
      });
    }

    const result = await db.validateAuthoritativeJobOtp({
      jobId,
      otp,
      otpType,
      driverId: effectiveDriverId
    });

    if (result.status === 'COMPLETED') {
      broadcastToCustomer(result.job.customerId, { type: 'TRIP_COMPLETED', jobId: result.job.id, fare: result.job.fare });
      broadcastToDrivers({ type: 'JOB_COMPLETED', jobId: result.job.id });

      // Phase 17 M4: Publish post-commit RIDE_COMPLETED event
      try {
        notificationEventBus.publish('RIDE_COMPLETED', {
          jobId: result.job.id,
          eventKey: `ride_completed:${result.job.id}`,
          customerId: result.job.customerId,
          driverId: effectiveDriverId || result.job.driverId,
          title: 'Ride Completed',
          body: `Your ride ${result.job.id} has completed successfully. Final fare: ₹${result.job.fare}.`,
          notificationType: 'RIDE_COMPLETED',
          priority: 'HIGH',
          data: { jobId: result.job.id, fare: result.job.fare, driverId: effectiveDriverId || result.job.driverId }
        });
      } catch (notifErr) {
        console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit RIDE_COMPLETED for job ${result.job.id}:`, notifErr.message);
      }
    } else if (result.status === 'OUT_FOR_DELIVERY') {
      broadcastToCustomer(result.job.customerId, { type: 'FOOD_ORDER_UPDATE', orderId: result.job.id, orderStatus: 'OUT_FOR_DELIVERY' });
    } else {
      broadcastToCustomer(result.job.customerId, { type: 'TRIP_STARTED', jobId: result.job.id });

      // Phase 17 M4: Publish post-commit RIDE_STARTED event
      try {
        notificationEventBus.publish('RIDE_STARTED', {
          jobId: result.job.id,
          eventKey: `ride_started:${result.job.id}`,
          customerId: result.job.customerId,
          driverId: effectiveDriverId || result.job.driverId,
          title: 'Ride In Transit',
          body: `OTP verified. Your ride ${result.job.id} has started.`,
          notificationType: 'RIDE_STARTED',
          priority: 'HIGH',
          data: { jobId: result.job.id, driverId: effectiveDriverId || result.job.driverId }
        });
      } catch (notifErr) {
        console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit RIDE_STARTED for job ${result.job.id}:`, notifErr.message);
      }
    }

    res.json(result);
  } catch (err) {
    // A delivery OTP for an already-settled trip is a conflict, not a bad code.
    if (err.code === 'TRIP_ALREADY_SETTLED') {
      return res.status(409).json({
        success: false,
        duplicate: true,
        code: 'TRIP_ALREADY_SETTLED',
        error: err.message,
        verified: false
      });
    }
    res.status(400).json({ success: false, error: err.message, verified: false });
  }
});

app.post('/api/driver/complete-trip', authenticateDriver, async (req, res) => {
  const { jobId, rating } = req.body;
  const effectiveDriverId = req.driver.id;

  const job = db.getJob(jobId) || await db.jobRepo?.findByIdAsync(jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  const callerUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || req.driver.uuid || effectiveDriverId;
  const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
  if (job.driverId !== effectiveDriverId && callerUuid !== jobDriverUuid) {
    return res.status(403).json({
      success: false,
      code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
      error: 'Forbidden: You are not assigned to this job.'
    });
  }

  // Phase 10: completion is the money-mutating transition (driver wallet credit
  // + double-entry ledger posting). It must never be reachable without the
  // OTP-verified trip lifecycle, otherwise an assigned driver could mint driver
  // earnings and post ledger entries while skipping both OTP proofs
  // (ASSIGNED -> COMPLETED was previously permitted).
  const completableStates = ['IN_TRANSIT', 'OUT_FOR_DELIVERY'];
  const currentStatus = String(job.status || '').toUpperCase();
  // A trip that is already COMPLETED is a duplicate, not a missing OTP proof.
  // Reporting OTP_VERIFICATION_REQUIRED for it would send an operator chasing a
  // verification that already happened, and it would hide the fact that the
  // settlement is booked. Late duplicates answer here; the ones that arrive
  // inside the winner's window are refused by the database compare-and-set.
  if (currentStatus === 'COMPLETED') {
    return res.status(409).json({
      success: false,
      duplicate: true,
      code: 'TRIP_ALREADY_SETTLED',
      error: 'This trip was already completed and settled.',
      status: 'COMPLETED'
    });
  }
  if (!completableStates.includes(currentStatus)) {
    return res.status(409).json({
      success: false,
      code: 'OTP_VERIFICATION_REQUIRED',
      error: `Trip cannot be completed from state ${currentStatus || 'UNKNOWN'}. Start and delivery OTP verification must be completed first.`,
      status: currentStatus || null
    });
  }

  // The transition is claimed inside PostgreSQL (UPDATE … WHERE status IN the
  // prior states, plus a UNIQUE settlement idempotency key), so 50 simultaneous
  // completions of one trip leave exactly one financial effect: the 49 losers
  // arrive here with TRIP_ALREADY_SETTLED and are answered 409 without having
  // touched a wallet, a counter or the ledger.
  let updatedJob;
  try {
    updatedJob = await db.updateJobStatus(jobId, 'COMPLETED');
  } catch (err) {
    if (err.code === 'TRIP_ALREADY_SETTLED') {
      return res.status(409).json({
        success: false,
        duplicate: true,
        code: 'TRIP_ALREADY_SETTLED',
        error: 'This trip was already completed and settled.',
        status: 'COMPLETED'
      });
    }
    return res.status(409).json({ success: false, code: 'TRIP_SETTLEMENT_REJECTED', error: err.message });
  }

  if (updatedJob) {
    broadcastToCustomer(updatedJob.customerId, { type: 'TRIP_COMPLETED', jobId: updatedJob.id, fare: updatedJob.fare, rating });

    // Phase 17 M4: Publish post-commit RIDE_COMPLETED event
    try {
      notificationEventBus.publish('RIDE_COMPLETED', {
        jobId: updatedJob.id,
        eventKey: `ride_completed:${updatedJob.id}`,
        customerId: updatedJob.customerId,
        driverId: updatedJob.driverId || req.driver?.id,
        title: 'Ride Completed',
        body: `Your ride ${updatedJob.id} has completed successfully. Final fare: ₹${updatedJob.fare}.`,
        notificationType: 'RIDE_COMPLETED',
        priority: 'HIGH',
        data: { jobId: updatedJob.id, fare: updatedJob.fare }
      });
    } catch (notifErr) {
      console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit RIDE_COMPLETED for job ${updatedJob.id}:`, notifErr.message);
    }

    res.json({ success: true, job: updatedJob, driver: db.getDriver(effectiveDriverId) || req.driver });
  } else {
    res.status(404).json({ success: false, error: 'Job not found' });
  }
});

app.post('/api/driver/payout-destination/request', authenticateDriver, async (req, res) => {
  const { upiId } = req.body;
  const result = await db.driverRepo.requestPayoutDestination(req.driver.id, upiId);
  if (!result.success) {
    const statusCode = result.code === 'UNLINKED_DRIVER_ACCOUNT' || result.code === 'KYC_NOT_VERIFIED' ? 403 : 400;
    return res.status(statusCode).json(result);
  }
  res.json(result);
});

app.post('/api/driver/payout', authenticateDriver, async (req, res) => {
  const { amount } = req.body;
  const effectiveDriverId = req.driver.id;

  // Phase 9: Explicit amount required. A missing or malformed amount must
  // never trigger a default money movement (previously ₹500).
  const parsedAmount = Number(amount);
  if (amount === undefined || amount === null || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      error: 'A positive numeric payout amount is required.',
      code: 'INVALID_AMOUNT'
    });
  }

  // The payout identity comes from the caller's Idempotency-Key when it sends one, so a client
  // whose response was lost can retry the SAME operation instead of buying a second one. When
  // absent, the repository mints a fresh unique identity — one effect per request — which is
  // the honest default, because nothing in the request distinguishes a retry from a new
  // intention. The key is scoped to the authenticated driver inside the repository, so it
  // cannot be used to address another partner's wallet.
  const idempotencyKey = readIdempotencyHeader(req);
  const result = await db.recordPayout(effectiveDriverId, parsedAmount, undefined, { idempotencyKey });
  if (!result.success) {
    const statusCode = result.code === 'UNLINKED_DRIVER_ACCOUNT' ||
      result.code === 'KYC_VERIFICATION_REQUIRED' ||
      result.code === 'UNVERIFIED_PAYOUT_DESTINATION' ||
      result.code === 'PAYOUT_DESTINATION_COOLING_ACTIVE' ? 403 : 400;
    return res.status(statusCode).json(result);
  }

  // Phase 17 M4: Publish post-commit PAYOUT_SETTLED event
  try {
    const { supabaseAdmin, isLivePostgres } = require('./supabase');
    let payoutKey = result.payoutKey;
    let driverUserId = req.driver?.userId || req.driver?.user_id;

    if (!driverUserId || !payoutKey) {
      if (isLivePostgres && supabaseAdmin) {
        const targetUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || req.driver?.uuid || effectiveDriverId;
        const [driverRow, payoutRow] = await Promise.all([
          !driverUserId ? supabaseAdmin.from('drivers').select('user_id').eq('id', targetUuid).maybeSingle() : Promise.resolve(null),
          !payoutKey ? supabaseAdmin.from('driver_payouts').select('idempotency_key').eq('driver_id', targetUuid).order('settled_at', { ascending: false }).limit(1).maybeSingle() : Promise.resolve(null)
        ]);
        if (driverRow?.data?.user_id) driverUserId = driverRow.data.user_id;
        if (payoutRow?.data?.idempotency_key) payoutKey = payoutRow.data.idempotency_key;
      }
    }

    if (!payoutKey) {
      payoutKey = `payout_${effectiveDriverId}_${Date.now()}`;
    }

    if (!driverUserId) {
      console.warn(`[NOTIF_BUS_SKIPPED] PAYOUT_SETTLED event for driver ${effectiveDriverId} skipped: unlinked driver account has no user_id.`);
    } else {
      notificationEventBus.publish('PAYOUT_SETTLED', {
        payoutId: payoutKey,
        eventKey: `payout_settled:${payoutKey}`,
        recipientUserId: driverUserId,
        driverId: effectiveDriverId,
        title: 'Payout Settled',
        body: `Your payout of ₹${parsedAmount} to ${result.verifiedUpiId} has been successfully settled.`,
        notificationType: 'PAYOUT_SETTLED',
        priority: 'HIGH',
        data: { amount: parsedAmount, upiId: result.verifiedUpiId, payoutKey }
      });
    }
  } catch (notifErr) {
    console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit PAYOUT_SETTLED for driver ${effectiveDriverId}:`, notifErr.message);
  }

  res.json(result);
});

app.post(['/api/rides/:id/cancel', '/api/jobs/:id/cancel'], async (req, res) => {
  try {
    const jobId = req.params.id;
    const { reason, isDelayedOverride, customerId, userId } = req.body || {};

    // Authentication: Token is strictly required
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        error: 'Unauthorized: Authentication token required to cancel ride/job.'
      });
    }

    let requesterId = null;
    let requesterRole = 'CUSTOMER';

    if (activeAdminSessions && activeAdminSessions.has(token)) {
      const admin = activeAdminSessions.get(token);
      requesterId = admin.id || 'admin';
      requesterRole = 'ADMIN';
    } else {
      const session = db.getSessionByToken ? db.getSessionByToken(token) : null;
      if (!session) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_TOKEN',
          error: 'Unauthorized: Invalid or expired session token.'
        });
      }
      const role = (session.role || '').toUpperCase();
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
        requesterId = session.entityId || session.userId || 'admin';
        requesterRole = 'ADMIN';
      } else if (role === 'DRIVER') {
        requesterId = session.entityId || session.userId;
        requesterRole = 'DRIVER';
      } else {
        requesterId = session.entityId || session.userId;
        requesterRole = 'CUSTOMER';
      }
      // A cancelled ride is a customer-visible, money-affecting act, so the bearer has to
      // still belong to an open account at the moment of the call — not merely have been
      // issued before the suspension landed.
      if (await refusedClosedCustomerAccount(req, res, session)) return;
    }

    // Verify job exists
    const memJob = db.getJob(jobId) || await db.jobRepo?.findByIdAsync(jobId);
    if (!memJob) {
      return res.status(404).json({ success: false, code: 'JOB_NOT_FOUND', error: `Job ${jobId} not found.` });
    }

    // Reject identity spoofing in request body
    const declaredId = customerId || userId;
    if (declaredId && requesterRole === 'CUSTOMER') {
      const callerUuid = db.userRepo?.resolveUuid(requesterId) || requesterId;
      const targetUuid = db.userRepo?.resolveUuid(declaredId) || declaredId;
      if (declaredId !== requesterId && callerUuid !== targetUuid) {
        return res.status(403).json({
          success: false,
          code: 'CUSTOMER_MISMATCH',
          error: 'Forbidden: Cannot cancel ride on behalf of another customer.'
        });
      }
    }

    // Tenant isolation
    if (requesterRole === 'CUSTOMER') {
      const callerUuid = db.userRepo?.resolveUuid(requesterId) || requesterId;
      const jobCustomerUuid = db.userRepo?.resolveUuid(memJob.customerId) || memJob.customerUuid || memJob.customerId;
      if (requesterId !== memJob.customerId && callerUuid !== jobCustomerUuid) {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_NOT_OWNER',
          error: 'Forbidden: You can only cancel your own trip.'
        });
      }
    } else if (requesterRole === 'DRIVER') {
      const callerUuid = db.driverRepo?.resolveUuid(requesterId) || requesterId;
      const jobDriverUuid = db.driverRepo?.resolveUuid(memJob.driverId) || memJob.driverUuid || memJob.driverId;
      if (requesterId !== memJob.driverId && callerUuid !== jobDriverUuid) {
        return res.status(403).json({
          success: false,
          code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
          error: 'Forbidden: You are not assigned to this job.'
        });
      }
    }

    const { supabaseAdmin, isLivePostgres } = require('./supabase');
    let jobUuid = memJob?.uuid || jobId;
    let userUuid = requesterId;
    if (requesterRole === 'CUSTOMER') {
      userUuid = db.userRepo?.resolveUuid(requesterId) || (db.getUser(requesterId)?.uuid) || requesterId;
    } else if (requesterRole === 'DRIVER') {
      userUuid = db.driverRepo?.resolveUuid(requesterId) || (db.getDriver(requesterId)?.uuid) || requesterId;
    }

    if (isLivePostgres && supabaseAdmin) {
      const { data, error } = await supabaseAdmin.rpc('cancel_ride_atomic', {
        p_job_id: jobUuid,
        p_requester_id: userUuid,
        p_requester_role: requesterRole,
        p_reason: reason || 'Customer requested cancellation',
        p_is_delayed_override: Boolean(isDelayedOverride)
      });

      if (error) {
        return replyStoreError(res, req, error, 'cancellation', { unreachableCode: 'CANCELLATION_STORE_UNAVAILABLE' });
      }

      const memJob = db.getJob(jobId);
      if (memJob) {
        memJob.status = 'CANCELLED';
        memJob.cancellationFee = data.cancellationFee;
        memJob.driverCompensation = data.driverCompensation;
        memJob.refundAmount = data.refundAmount;
        memJob.refundStatus = data.refundStatus;
      }
      if (memJob?.driverId) {
        const memDrv = db.getDriver(memJob.driverId);
        if (memDrv) {
          memDrv.operationalStatus = 'AVAILABLE';
          memDrv.isOnline = true;
          if (data.driverWalletBalance !== undefined) {
            memDrv.walletBalance = Number(data.driverWalletBalance);
          }
        }
      }

      // Phase 17 M4: Publish post-commit JOB_CANCELLED event strictly after atomic RPC commit
      try {
        const targetJobId = memJob?.id || jobId;
        const custId = memJob?.customerId || (requesterRole === 'CUSTOMER' ? requesterId : null);
        notificationEventBus.publish('JOB_CANCELLED', {
          jobId: targetJobId,
          eventKey: `job_cancelled:${targetJobId}`,
          customerId: custId,
          driverId: memJob?.driverId || null,
          title: 'Ride Cancelled',
          body: `Trip ${targetJobId} was cancelled. Reason: ${reason || 'Customer requested cancellation'}.`,
          notificationType: 'JOB_CANCELLED',
          priority: 'HIGH',
          data: {
            jobId: targetJobId,
            cancellationFee: data.cancellationFee,
            refundAmount: data.refundAmount,
            driverCompensation: data.driverCompensation
          }
        });
      } catch (notifErr) {
        console.warn(`[NOTIF_DISPATCH_WARN] Failed to emit JOB_CANCELLED for job ${jobId}:`, notifErr.message);
      }

      return res.json({ success: true, ...data });
    }

    return res.status(500).json({ success: false, error: 'PostgreSQL database unavailable' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// One implementation of "what has this driver earned", shared by the path-scoped
// `/api/driver/:driverId/earnings` — which keeps its DRIVER_MISMATCH guard — and the
// token-derived `/api/driver/earnings` that the driver app calls, where there is no id in
// the request to tamper with in the first place.
//
// Why the money is summed from `jobs` rather than read off the driver record: the frozen
// schema has no earnings columns on `drivers`. `mapRowToDriver` answers
// `todayEarnings: 0, todayTrips: 0` for every PostgreSQL-hydrated driver and does not map
// `weeklyEarnings`/`monthlyEarnings` at all, so the previous response was reporting
// process-local counters — a driver who had worked all week read back as ₹0 the moment the
// process restarted. `jobs.final_total`, `jobs.driver_earnings` and
// `jobs.platform_commission` are per-job columns the pricing engine wrote at booking, so
// the sum is durable and traceable to rows. `drivers.wallet_balance` stays the wallet
// authority; it is a real column and survives a restart (`restart_test.js` locks that).
//
// The windows are rolling — last 24 hours, 7 days, 30 days — rather than calendar "today /
// this week / this month" on purpose: a calendar day needs a platform timezone decision
// that has not been made, and a money endpoint is not the place to invent one silently.
async function buildDriverEarningsPayload(driver, sessionDriver) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const windowStarts = { last24h: now - DAY_MS, last7d: now - 7 * DAY_MS, last30d: now - 30 * DAY_MS };
  const totals = {
    last24h: { trips: 0, grossFares: 0, platformFees: 0, netEarnings: 0 },
    last7d: { trips: 0, grossFares: 0, platformFees: 0, netEarnings: 0 },
    last30d: { trips: 0, grossFares: 0, platformFees: 0, netEarnings: 0 },
  };
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

  // Identity candidates come from the token first and the resolved record second, so a
  // row is only ever matched to the session that is already proven to own it. Carrying
  // both shapes is what lets a legacy `DRV-101` session line up with the PostgreSQL
  // UUID the `jobs` rows are keyed by.
  const identities = new Set([
    sessionDriver?.id, sessionDriver?.uuid, driver?.id, driver?.uuid,
  ].filter(Boolean).map(String));
  const driverUuid = db.driverRepo?.resolveUuid(driver.id) || driver.uuid || driver.id;
  if (driverUuid) identities.add(String(driverUuid));
  // PHASE 38: both earnings routes go through this one builder (EARN-21 pins that), so the
  // durable reconcile lives here and nowhere else. It re-reads the columns PostgreSQL owns
  // (`drivers.wallet_balance` and the payout-destination set) so a long-lived process cannot
  // answer from a mirror another settlement has already moved past. It keeps mutating the same
  // object, which is why nothing below needs rebinding.
  await db.reconcileDriverFromDurable(driver);
  const rows = await db.jobRepo.getDriverCompletedRows(driverUuid, {
    sinceIso: new Date(windowStarts.last30d).toISOString()
  });

  let source = 'postgres';
  let settled;
  if (rows === null) {
    // Memory-only development mode: no PostgreSQL is configured, so the hydrated arrays
    // are the only store there is. `getDriverCompletedRows` returns null to say so, which
    // is different from returning `[]` — an empty array would mean "this driver has
    // completed nothing", and a driver reading their own earnings must not be told that
    // because a platform process is running without a database.
    source = 'hydrated-memory';
    settled = (db.jobs || [])
      .filter(j => (identities.has(String(j.driverId)) || (j.driverUuid && identities.has(String(j.driverUuid))))
        && String(j.status || '').toUpperCase() === 'COMPLETED')
      .map(j => ({
        id: j.id,
        job_number: j.jobNumber || j.id,
        service_type: j.type || j.serviceType || 'RIDE',
        // Record whichever shape of this job's driver reference is the caller's, so the
        // ownership check below compares like for like.
        driver_id: identities.has(String(j.driverUuid)) ? j.driverUuid : j.driverId,
        final_total: j.fare,
        driver_earnings: j.driverEarnings,
        platform_commission: j.platformFee,
        payment_status: j.paymentStatus,
        updated_at: j.updatedAt || j.createdAt,
      }));
  } else {
    settled = rows;
  }

  // Nothing that is not the caller's may enter the sum. The PostgreSQL query is already
  // keyed on the caller's resolved UUID, so a foreign row here means the read predicate
  // stopped applying somewhere — which is a platform fault to raise, not a total to publish.
  // Quietly dropping the row would under-report what a driver is owed, and under-reporting
  // money is its own kind of wrong answer.
  const foreignRow = settled.find(r => !identities.has(String(r.driver_id)));
  if (foreignRow) {
    const scopeErr = new Error('Earnings read returned a trip that is not assigned to this driver.');
    scopeErr.code = 'EARNINGS_SCOPE_VIOLATION';
    scopeErr.status = 500;
    console.error(`[driver/earnings] refusing to total a foreign trip (${foreignRow.job_number || foreignRow.id})`);
    throw scopeErr;
  }

  for (const row of settled) {
    const at = Date.parse(row.updated_at || row.created_at) || 0;
    const gross = Number(row.final_total || 0);
    const net = Number(row.driver_earnings || 0);
    const fee = Number(row.platform_commission || 0);
    for (const [key, start] of Object.entries(windowStarts)) {
      if (at >= start) {
        totals[key].trips += 1;
        totals[key].grossFares += gross;
        totals[key].platformFees += fee;
        totals[key].netEarnings += net;
      }
    }
  }

  for (const t of Object.values(totals)) {
    t.grossFares = round2(t.grossFares);
    t.platformFees = round2(t.platformFees);
    t.netEarnings = round2(t.netEarnings);
  }

  const recentTrips = settled
    .map(row => ({ row, at: Date.parse(row.updated_at || row.created_at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, 10)
    .map(({ row, at }) => ({
      id: row.id,
      jobNumber: row.job_number,
      serviceType: row.service_type,
      grossFare: round2(row.final_total),
      driverEarnings: round2(row.driver_earnings),
      platformCommission: round2(row.platform_commission),
      paymentStatus: row.payment_status || null,
      settledAt: at ? new Date(at).toISOString() : null,
    }));

  const driverTx = (db.transactions || []).filter(t =>
    (t.driverId && identities.has(String(t.driverId))) || (t.entityId && identities.has(String(t.entityId)))
  );

  return {
    success: true,
    source,
    walletBalance: round2(driver.walletBalance),
    // Legacy keys, unchanged in meaning: `weeklyEarnings`/`monthlyEarnings` were never
    // columns, and `todayEarnings`/`todayTrips` were process-local. They now carry the
    // PostgreSQL-derived figures so an existing reader stops getting a post-restart zero.
    todayEarnings: totals.last24h.netEarnings,
    todayTrips: totals.last24h.trips,
    weeklyEarnings: totals.last7d.netEarnings,
    monthlyEarnings: totals.last30d.netEarnings,
    // The platform's own cut is durable — `jobs.platform_commission` is written per row at
    // pricing time — so it is summed rather than read off a process-local counter.
    commissionPaidToday: totals.last24h.platformFees,
    // `cashCollectedToday` / `onlinePaidToday` were process-local counters that reset on
    // every restart. They cannot be rebuilt from PostgreSQL yet: every COMPLETED job in the
    // database still carries `payment_status = 'PENDING'`, so no row states that money was
    // actually collected, and splitting by `payment_method` would report collection that may
    // never have happened. `null` means "the platform does not know", where `0` would be a claim.
    cashCollectedToday: null,
    onlinePaidToday: null,
    windows: totals,
    recentTrips,
    payout: {
      destination: driver.payoutUpiVerified ? (driver.verifiedUpiId || null) : null,
      destinationVerified: Boolean(driver.payoutUpiVerified),
      pendingDestination: driver.pendingUpiId || null,
      destinationCoolingUntil: driver.upiCoolingUntil || null,
      kycStatus: driver.kycStatus || driver.status || null,
      operationalStatus: driver.operationalStatus || null,
    },
    transactions: driverTx,
  };
}

// The driver app's own earnings read. Identity comes from the bearer token and nowhere
// else — there is no path or body id for a client to point at another driver — and an
// unreachable or unfinished PostgreSQL read is a 503, never a zero: a driver asking what
// they are owed must not be answered "nothing" because the store did not answer.
app.get('/api/driver/earnings', authenticateDriver, async (req, res) => {
  try {
    // The money is read from the live driver record, not from `req.driver`. A persisted session
    // stores an `entity` snapshot taken at sign-in (see `backend_sessions.entity`) and sessions
    // live for 30 days, so answering from the snapshot tells a driver the balance they held when
    // they authenticated rather than the balance they hold now — a completed trip would not show
    // up until the app signed out and back in. This is the same resolution the sibling
    // `/api/driver/:driverId/earnings` route performs, which is precisely what EARN-21 pins: one
    // implementation, including where each route reads from. Identity still comes only from the
    // bearer token; nothing here accepts a driver id from the client.
    const driver = db.getDriver(req.driver.id) || req.driver;
    res.json(await buildDriverEarningsPayload(driver, req.driver));
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'driver earnings');
    console.error('[driver/earnings] failed:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'EARNINGS_READ_FAILED', error: err.message });
  }
});

app.get('/api/driver/:driverId/earnings', authenticateDriver, async (req, res) => {
  const requestedId = req.params.driverId;
  const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
  const targetUuid = db.driverRepo?.resolveUuid(requestedId) || requestedId;
  if (requestedId !== req.driver.id && callerUuid !== targetUuid) {
    return res.status(403).json({
      success: false,
      code: 'DRIVER_MISMATCH',
      error: 'Forbidden: You can only access your own driver earnings.'
    });
  }

  const driver = db.getDriver(req.driver.id) || req.driver;
  if (!driver) {
    return res.status(404).json({ success: false, code: 'DRIVER_NOT_FOUND', error: 'Driver profile not found.' });
  }

  try {
    res.json(await buildDriverEarningsPayload(driver, req.driver));
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'driver earnings');
    console.error('[driver/:driverId/earnings] failed:', err);
    return res.status(err.status || 500).json({ success: false, code: err.code || 'EARNINGS_READ_FAILED', error: err.message });
  }
});

// SAVED SCHOOLS & CHILDREN CRUD (POSTGRESQL-AUTHORITATIVE VIA MIGRATION 015)
function requireCustomerAuth(req, res, next) {
  authenticateUser(req, res, () => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Customer authentication token required. Please log in with Bearer token.',
        requestId: req.id
      });
    }
    next();
  });
}

app.get('/api/schools', requireCustomerAuth, async (req, res) => {
  try {
    const schools = await db.schoolChildRepo.getSchoolsByUser(req.user.id);
    res.json({ success: true, schools });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/schools', requireCustomerAuth, async (req, res) => {
  try {
    const { name, address, latitude, longitude } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: name', requestId: req.id });
    }
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: address', requestId: req.id });
    }
    if (latitude === undefined || latitude === null || isNaN(Number(latitude))) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required field: latitude', requestId: req.id });
    }
    if (longitude === undefined || longitude === null || isNaN(Number(longitude))) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required field: longitude', requestId: req.id });
    }
    const school = await db.schoolChildRepo.createSchool(req.user.id, req.body);
    res.json({ success: true, school });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.put('/api/schools/:id', requireCustomerAuth, async (req, res) => {
  try {
    const school = await db.schoolChildRepo.updateSchool(req.params.id, req.user.id, req.body);
    if (!school) return res.status(404).json({ success: false, error: 'School not found', requestId: req.id });
    res.json({ success: true, school });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.delete('/api/schools/:id', requireCustomerAuth, async (req, res) => {
  try {
    const deleted = await db.schoolChildRepo.deleteSchool(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'School not found', requestId: req.id });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.get('/api/children', requireCustomerAuth, async (req, res) => {
  try {
    const children = await db.schoolChildRepo.getChildrenByUser(req.user.id);
    res.json({ success: true, children });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/children', requireCustomerAuth, async (req, res) => {
  try {
    const { fullName, gradeClass, guardianName, guardianPhone, defaultPickupAddress, pickupLat, pickupLng } = req.body || {};
    if (!fullName || typeof fullName !== 'string' || !fullName.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: fullName', requestId: req.id });
    }
    if (!gradeClass || typeof gradeClass !== 'string' || !gradeClass.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: gradeClass', requestId: req.id });
    }
    if (!guardianName || typeof guardianName !== 'string' || !guardianName.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: guardianName', requestId: req.id });
    }
    if (!guardianPhone || typeof guardianPhone !== 'string' || !guardianPhone.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: guardianPhone', requestId: req.id });
    }
    if (!defaultPickupAddress || typeof defaultPickupAddress !== 'string' || !defaultPickupAddress.trim()) {
      return res.status(400).json({ success: false, error: 'Missing required field: defaultPickupAddress', requestId: req.id });
    }
    if (pickupLat === undefined || pickupLat === null || isNaN(Number(pickupLat))) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required field: pickupLat', requestId: req.id });
    }
    if (pickupLng === undefined || pickupLng === null || isNaN(Number(pickupLng))) {
      return res.status(400).json({ success: false, error: 'Missing or invalid required field: pickupLng', requestId: req.id });
    }
    const child = await db.schoolChildRepo.createChild(req.user.id, req.body);
    res.json({ success: true, child });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.put('/api/children/:id', requireCustomerAuth, async (req, res) => {
  try {
    const child = await db.schoolChildRepo.updateChild(req.params.id, req.user.id, req.body);
    if (!child) return res.status(404).json({ success: false, error: 'Child not found', requestId: req.id });
    res.json({ success: true, child });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.delete('/api/children/:id', requireCustomerAuth, async (req, res) => {
  try {
    const deleted = await db.schoolChildRepo.deleteChild(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Child not found', requestId: req.id });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

// MASTER ADMIN METRICS & HEALTH
app.get('/api/admin/metrics', authenticateAdmin, (req, res) => {
  const activeDrivers = db.drivers.filter(d => d.isOnline).length;
  const pendingKyc = db.identityApplications.filter(a => a.status === 'IDENTITY_VERIFICATION_PENDING').length;
  const activeJobs = db.jobs.filter(j => j.status !== 'COMPLETED' && j.status !== 'CANCELLED').length;
  const totalCompletedJobs = db.jobs.filter(j => j.status === 'COMPLETED').length;
  const totalGrossFare = db.jobs
    .filter(j => j.status === 'COMPLETED')
    .reduce((sum, j) => sum + (j.fare || 0), 0);

  res.json({
    success: true,
    metrics: {
      activeDrivers,
      pendingKyc,
      activeJobs,
      totalCompletedJobs,
      totalGrossFare,
      totalUsers: db.users.length,
      totalRestaurants: db.restaurants.length,
      fleetStatus: 'OPTIMAL_OPERATION',
      timestamp: new Date().toISOString()
    }
  });
});

app.get('/api/admin/jobs', authenticateAdmin, (req, res) => res.json({ success: true, jobs: db.jobs }));
app.get('/api/admin/restaurants', authenticateAdmin, (req, res) => res.json({ success: true, restaurants: db.restaurants }));

// Document previews. The gate is the point: `identity_documents.view` is the permission the
// examiners' queue already runs on, and the day one of these paths names a real upload, an ungated
// preview is a document leak. What sits behind it is deliberately *nothing* — this schema has no
// document storage and no upload path, so the honest preview of a document NABIN does not hold is a
// card that says so. It used to render a convincing fake: "RAHUL SHARMA", a date of birth, a Delhi
// address, `XXXX XXXX 4892` / `EPIC NO: DLH1948201`, under a government heading and a
// "✓ GOVERNMENT WATERMARK" line. An examiner approving a real applicant against that image was
// reading a forged identity document the platform printed itself. No identity field, no agency name,
// no number, and the requested filename is never echoed back into the markup.
app.get('/docs/:filename', authenticateAdmin, requirePermission('identity_documents.view'), (req, res) => {
  const svgContent = `
    <svg width="600" height="380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="No document on file" style="font-family: Arial, sans-serif; background: #ffffff;">
      <rect width="596" height="376" x="2" y="2" rx="16" fill="#ffffff" stroke="#1A3BA2" stroke-width="2" stroke-dasharray="10 7"/>
      <text x="300" y="150" fill="#1A3BA2" font-size="26" font-weight="bold" text-anchor="middle">NO DOCUMENT ON FILE</text>
      <text x="300" y="196" fill="#334155" font-size="15" text-anchor="middle">NABIN has not received an uploaded document here.</text>
      <text x="300" y="222" fill="#64748b" font-size="14" text-anchor="middle">This platform has no identity-document upload or storage path yet,</text>
      <text x="300" y="244" fill="#64748b" font-size="14" text-anchor="middle">so there is nothing to show and no document to verify.</text>
    </svg>
  `;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svgContent);
});

// -------------------------------------------------------------
// DYNAMIC GROCERY PRICING & REVALIDATION REST APIS
// -------------------------------------------------------------

// Customer-facing grocery shelf. PostgreSQL is authoritative here: the legacy
// fixtures all belong to `mcht_darkstore_1`, which `/grocery/checkout/validate`
// rejects with DARK_STORE_NOT_SUPPORTED, so a fixture-backed shelf lists items
// that can never be ordered. Each row carries the `merchant_grocery_inventory`
// id, which is the id checkout resolves.
const GROCERY_TYPES = ['GROCERY', 'HYBRID_BOTH'];

// Seed rows point at `example.com`, which renders as a broken image. A product
// with no real artwork is honest; one with a dead URL is a bug.
const PLACEHOLDER_IMAGE_HOSTS = ['example.com', 'www.example.com', 'via.placeholder.com', 'placehold.co'];
const realImageUrl = (value) => {
  const raw = (value === null || value === undefined) ? '' : String(value).trim();
  if (!raw) return null;
  try {
    return PLACEHOLDER_IMAGE_HOSTS.includes(new URL(raw).hostname.toLowerCase()) ? null : raw;
  } catch {
    return null;
  }
};

const projectGroceryInventoryForCustomer = (row) => {
  const catalog = row.master_grocery_catalog || {};
  const store = row.merchants || {};
  return {
    id: row.id,
    inventoryId: row.id,
    masterProductId: catalog.id ?? row.product_id ?? null,
    name: catalog.name ?? 'Grocery item',
    brand: catalog.brand ?? null,
    category: catalog.category ?? null,
    subcategory: catalog.subcategory ?? null,
    unit: catalog.standard_unit ?? null,
    packSize: catalog.pack_size ?? null,
    description: catalog.description ?? null,
    currentPrice: Number(row.store_price ?? 0),
    // PostgreSQL stores no maximum retail price, so none is invented here.
    mrp: null,
    previousPrice: null,
    stockQty: Number(row.stock_quantity ?? 0),
    isAvailable: row.is_available === true,
    status: row.status ?? null,
    pricingType: catalog.pricing_model ?? null,
    imageUrl: realImageUrl(catalog.standard_image_url),
    merchantId: row.merchant_id,
    merchantName: store.name ?? null,
    merchantIsOpen: store.is_open === true,
    lastPriceUpdate: row.updated_at ?? null
  };
};

// Get Products Catalog (Customer & merchant view)
app.get('/api/grocery/products', async (req, res) => {
  const category = (req.query.category || '').toString().trim();
  const search = (req.query.search || '').toString().trim();
  const { supabaseAdmin, isLivePostgres } = require('./supabase');

  if (!isLivePostgres || !supabaseAdmin) {
    const products = db.getGroceryProducts(req.query);
    return res.json({ success: true, count: products.length, products, dataSource: 'fixture', degraded: true });
  }

  try {
    const { data: stores, error: storeError } = await supabaseAdmin
      .from('merchants')
      .select('id, name')
      .in('merchant_type', GROCERY_TYPES)
      .order('name', { ascending: true });
    if (storeError) return replyStoreError(res, req, storeError, 'grocery catalogue');

    let storeIds = (stores || []).map((s) => s.id);
    if (req.query.merchantId) {
      storeIds = storeIds.filter((id) => id === req.query.merchantId.toString().trim());
    }
    if (!storeIds.length) {
      return res.json({ success: true, count: 0, products: [], categories: [], dataSource: 'postgres' });
    }

    let query = supabaseAdmin
      .from('merchant_grocery_inventory')
      .select('id, product_id, merchant_id, store_price, stock_quantity, is_available, status, updated_at, master_grocery_catalog!inner(id, name, category, subcategory, brand, standard_unit, pack_size, standard_image_url, description, pricing_model, is_active), merchants(id, name, is_open)')
      .in('merchant_id', storeIds)
      // A master product the platform retires must stop being browsable everywhere at
      // once; stores keep their own listing rows, which is what `is_active` is for.
      // `!inner` above is what makes this drop the listing rather than null the embed.
      .eq('master_grocery_catalog.is_active', true);
    if (category && category !== 'All') query = query.eq('master_grocery_catalog.category', category);

    const { data, error } = await query.order('store_price', { ascending: true });
    if (error) return replyStoreError(res, req, error, 'grocery catalogue');

    let products = (data || []).map(projectGroceryInventoryForCustomer);
    if (search) {
      const needle = search.toLowerCase();
      products = products.filter((p) => [p.name, p.brand, p.category, p.subcategory]
        .some((field) => (field || '').toString().toLowerCase().includes(needle)));
    }

    res.json({
      success: true,
      count: products.length,
      categories: [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
      products,
      dataSource: 'postgres'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// F-1 (Task 4N follow-up, owner decision): the former public route
// `GET /api/grocery/products/:id/history` has been REMOVED. It required no authentication, applied no
// tenant scope, and returned the process-local `groceryPriceHistory` fixture while presenting it as real
// product price history - including internal actor text (`changedBy`), `storeId` and legacy ids - so it
// both leaked audit metadata and made a durability claim the data could not support. It had no caller in
// any NABIN app and appeared in no API contract document.
// Durable, authenticated, tenant-scoped price history is served by the route below, and that boundary is
// guarded in-chain by `grocery_price_history_read_test.js` (chain link 45).

// TASK 4N: the merchant's own durable grocery price history. READ ONLY - it never writes prices,
// history, inventory, catalogue rows or audit records.
// Identity comes from the token only. A `merchantId` in the query string is ignored on purpose, in the
// same way `POST /api/merchant/inventory` re-asserts `merchantId: req.merchant.id` after the body
// spread: a caller cannot retarget somebody else's history. A foreign `productId` simply yields no rows,
// because the durable query is already scoped to this merchant.
// Degraded mode returns the same `degraded: true` shape the neighbouring master-catalogue read uses,
// with an empty list, rather than replaying in-memory fixture history as if it were durable.
app.get('/api/merchant/grocery/price-history', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    const { isLivePostgres } = require('./supabase');
    const merchantId = req.merchant.id;
    if (!isLivePostgres) {
      return res.json({ success: true, merchantId, count: 0, history: [], degraded: true });
    }
    const history = await db.getMerchantPriceHistory({
      merchantId,
      productId: req.query.productId || null,
      from: req.query.from || null,
      to: req.query.to || null,
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.json({ success: true, merchantId, count: history.length, history });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Single Merchant Price Update
app.put('/api/grocery/products/:id/price', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), (req, res) => {
  try {
    const { newPrice, reason, actor } = req.body;
    const merchantId = req.merchant.id;
    const updated = db.updateGroceryProductPrice({
      productId: req.params.id,
      newPrice,
      merchantId,
      reason: reason || 'Merchant price adjustment',
      actor: actor || 'Merchant'
    });
    broadcastToAdmins({ type: 'GROCERY_PRICE_UPDATED', productId: req.params.id, product: updated });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// CUSTOMER DISCOVERY READ APIS (restaurant browsing + menus)
// Customer clients previously had no public read path for restaurants, so the
// browse screens rendered hard-coded arrays. These project the PostgreSQL
// `merchants`/`products` tables and expose no customer PII or merchant phone.
// -------------------------------------------------------------

const RESTAURANT_TYPES = ['RESTAURANT', 'HYBRID_BOTH'];

// A `%` or `_` typed into the search box would otherwise act as a wildcard.
const likePattern = (value) => `%${String(value).replace(/[%,_]/g, ' ').trim()}%`;

// A cuisine label must reach Postgres as an array literal whose elements are
// quoted. postgrest-js builds one for an array argument as `cs.{${value.join(',')}}`
// — unquoted — so the label `North Indian, Mughlai` would arrive as the
// two-element array {North Indian, Mughlai} and `@>` would then demand that a
// restaurant declare BOTH: one filter silently becomes a different, narrower one
// and the customer sees an empty list. `contains()` passes a *string* argument
// through verbatim, so the literal is composed here — element quoted, and
// backslash/quote escaped the way PostgreSQL's array input expects.
const pgTextArrayLiteral = (values) =>
  `{${values.map((v) => `"${String(v).replace(/[\\"]/g, '\\$&')}"`).join(',')}}`;

// Accepts both PostgreSQL (snake_case) rows and legacy fixture (camelCase) rows so
// the degraded path cannot diverge from the live one. `phone` is never projected.
//
// `rating` is NOT projected at all, and that is not an oversight. `merchants.rating`
// was created in 001 as `NUMERIC(3,2) DEFAULT 4.80` and this schema has no reviews
// table, no ratings table and no order-feedback column, so every stored score is the
// column default rather than a measurement. Showing it put a fabricated 4.8 on every
// restaurant card in the Customer app and in customer-web. Migration 034 removed the
// default so new rows are born NULL; this projection stops reading the column so no
// row — default or otherwise — reaches a customer. A real rating needs a real source.
//
// `deliveryMinutes` is the merchant's declared kitchen-to-door window
// (`standard_delivery_minutes`, 034) as a number, never a string: '25-35 mins' cannot
// be compared or rendered honestly, so each client formats it. The fixture row's
// `deliveryTime` string is not projected, which means a degraded read shows no ETA.
const positiveIntOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const projectRestaurantForCustomer = (row) => {
  const lat = row.lat ?? row.location?.lat;
  const lng = row.lng ?? row.location?.lng;
  return {
    id: row.id,
    name: row.name,
    merchantType: row.merchant_type ?? row.merchantType ?? null,
    address: row.address ?? null,
    // `merchants.cuisines` (034). An empty array means the restaurant has declared
    // nothing, and the card and the cuisine wheel both render nothing for it.
    cuisines: Array.isArray(row.cuisines) ? row.cuisines : [],
    coverImageUrl: row.cover_image_url ?? row.coverImageUrl ?? null,
    deliveryMinutes: positiveIntOrNull(row.standard_delivery_minutes ?? row.standardDeliveryMinutes),
    isOpen: (row.is_open ?? row.isOpen) === true,
    location: lat === undefined || lat === null || lng === undefined || lng === null
      ? null
      : { lat: Number(lat), lng: Number(lng) }
  };
};

// The columns a customer may be shown about a restaurant. Kept as one list so the
// browse route and the detail route cannot drift apart on which fields exist.
const CUSTOMER_RESTAURANT_COLUMNS =
  'id, name, merchant_type, address, lat, lng, is_open, cuisines, cover_image_url, standard_delivery_minutes';

// `in_stock_quantity` of -1 means "not tracked", so it must not surface as 0.
const projectMenuItemForCustomer = (item) => {
  const price = Number(item.price ?? 0);
  const discounted = item.discount_price === null || item.discount_price === undefined
    ? null
    : Number(item.discount_price);
  const hasDiscount = discounted !== null && discounted > 0 && discounted < price;
  const stock = item.in_stock_quantity ?? item.stockQty ?? null;
  return {
    id: item.id,
    sku: item.sku ?? null,
    name: item.name,
    description: item.description ?? null,
    category: item.category ?? null,
    price,
    sellingPrice: hasDiscount ? discounted : price,
    mrp: hasDiscount ? price : null,
    discountPercent: hasDiscount ? Math.round(((price - discounted) / price) * 100) : null,
    isVeg: item.isVeg ?? null,
    isAvailable: (item.is_available ?? item.inStock ?? true) === true,
    stockQty: stock === null || Number(stock) < 0 ? null : Number(stock),
    imageUrl: item.image_url ?? item.imageUrl ?? null
  };
};

app.get('/api/restaurants', async (req, res) => {
  const search = (req.query.search || '').toString().trim();
  const cuisine = (req.query.cuisine || '').toString().trim();
  const openOnly = req.query.openNow === 'true' || req.query.openNow === '1';
  const { supabaseAdmin, isLivePostgres } = require('./supabase');

  if (!isLivePostgres || !supabaseAdmin) {
    const fixtures = db.restaurants
      .filter((r) => (openOnly ? r.isOpen === true : true))
      .filter((r) => (search ? r.name.toLowerCase().includes(search.toLowerCase()) : true))
      // Element match, not substring: the live path below asks Postgres whether the
      // array CONTAINS the label, and a fixture path that matched 'North' to
      // 'North Indian' would make the same URL mean two different things.
      .filter((r) => (cuisine
        ? (Array.isArray(r.cuisines) ? r.cuisines : []).some((c) => String(c).trim().toLowerCase() === cuisine.toLowerCase())
        : true))
      .map(projectRestaurantForCustomer);
    return res.json({ success: true, count: fixtures.length, restaurants: fixtures, degraded: true });
  }

  try {
    let query = supabaseAdmin
      .from('merchants')
      .select(CUSTOMER_RESTAURANT_COLUMNS)
      .in('merchant_type', RESTAURANT_TYPES)
      // `name ASC`, where the old query sorted `rating DESC` first. That ordering was
      // only ever meaningful while someone believed the rating column: with
      // DEFAULT 4.80 on every row it sorted a constant, and the Customer app turned
      // around and labelled the list "Top rated restaurants" (034 removes the default;
      // see projectRestaurantForCustomer for why rating is not projected at all).
      .order('name', { ascending: true });

    if (openOnly) query = query.eq('is_open', true);
    if (search) query = query.ilike('name', likePattern(search));
    if (cuisine) query = query.contains('cuisines', pgTextArrayLiteral([cuisine]));

    const { data, error } = await query;
    if (error) return replyStoreError(res, req, error, 'restaurant list');

    res.json({
      success: true,
      count: (data || []).length,
      restaurants: (data || []).map(projectRestaurantForCustomer),
      dataSource: 'postgres'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/restaurants/:id', async (req, res) => {
  const { supabaseAdmin, isLivePostgres } = require('./supabase');
  if (!isLivePostgres || !supabaseAdmin) {
    const restaurant = db.restaurants.find((r) => r.id === req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found.' });
    return res.json({ success: true, restaurant: projectRestaurantForCustomer(restaurant), degraded: true });
  }

  const { data, error } = await supabaseAdmin
    .from('merchants')
    .select(CUSTOMER_RESTAURANT_COLUMNS)
    .eq('id', req.params.id)
    .in('merchant_type', RESTAURANT_TYPES)
    .maybeSingle();
  if (error) return replyStoreError(res, req, error, 'restaurant');
  if (!data) return res.status(404).json({ success: false, error: 'Restaurant not found.' });

  res.json({ success: true, restaurant: projectRestaurantForCustomer(data), dataSource: 'postgres' });
});

app.get('/api/restaurants/:id/menu', async (req, res) => {
  const { supabaseAdmin, isLivePostgres } = require('./supabase');
  const category = (req.query.category || '').toString().trim();

  if (!isLivePostgres || !supabaseAdmin) {
    const restaurant = db.restaurants.find((r) => r.id === req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, error: 'Restaurant not found.' });
    let items = (restaurant.menu || []).map(projectMenuItemForCustomer);
    if (category && category !== 'ALL') items = items.filter((i) => i.name.toLowerCase().includes(category.toLowerCase()));
    return res.json({ success: true, restaurantId: restaurant.id, count: items.length, items, degraded: true });
  }

  const { data: merchant } = await supabaseAdmin
    .from('merchants')
    .select('id, merchant_type')
    .eq('id', req.params.id)
    .in('merchant_type', RESTAURANT_TYPES)
    .maybeSingle();
  if (!merchant) return res.status(404).json({ success: false, error: 'Restaurant not found.' });

  let query = supabaseAdmin
    .from('products')
    .select('id, sku, name, description, category, price, discount_price, is_available, in_stock_quantity, image_url')
    .eq('merchant_id', merchant.id)
    .order('category', { ascending: true })
    .order('name', { ascending: true });
  if (category && category !== 'ALL') query = query.eq('category', category);

  const { data, error } = await query;
  if (error) return replyStoreError(res, req, error, 'menu');

  const items = (data || []).map(projectMenuItemForCustomer);
  res.json({
    success: true,
    restaurantId: merchant.id,
    count: items.length,
    categories: [...new Set(items.map((item) => item.category).filter(Boolean))],
    items,
    dataSource: 'postgres'
  });
});

// --- ADMIN MASTER CATALOG ENDPOINTS ---
// Durable against PostgreSQL whenever it is live, mirroring merchant inventory below:
// the read is a read-through and every write is a write-through, so a catalogue edit
// survives a restart. The permission gate runs in middleware, before any of these
// handlers, so a refusal never touches the store.
app.get('/api/admin/master-catalog', authenticateAdmin, async (req, res) => {
  try {
    const masterProducts = await db.getMasterProducts();
    res.json({ success: true, count: masterProducts.length, masterProducts });
  } catch (err) {
    return replyStoreError(res, req, err, 'master catalogue');
  }
});

app.post('/api/admin/master-catalog', authenticateAdmin, requirePermission('catalog.manage'), async (req, res) => {
  try {
    const product = await db.addMasterProduct(req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_ADDED', product });
    res.json({ success: true, product });
  } catch (err) {
    res.status(err.status || (err.code === 'MASTER_PRODUCT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.put('/api/admin/master-catalog/:id', authenticateAdmin, requirePermission('catalog.manage'), async (req, res) => {
  try {
    const updated = await db.updateMasterProduct(req.params.id, req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_UPDATED', product: updated });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(err.status || (err.code === 'MASTER_PRODUCT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.delete('/api/admin/master-catalog/:id', authenticateAdmin, requirePermission('catalog.manage'), async (req, res) => {
  try {
    const deleted = await db.deleteMasterProduct(req.params.id);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_DELETED', id: req.params.id });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(err.status || (err.code === 'MASTER_PRODUCT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

app.get('/api/admin/master-catalog/:id/stores', authenticateAdmin, async (req, res) => {
  try {
    const matrix = await db.getMasterProductStoreMatrix(req.params.id);
    res.json({ success: true, ...matrix });
  } catch (err) {
    res.status(err.status || (err.code === 'MASTER_PRODUCT_NOT_FOUND' ? 404 : 400)).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

// --- MERCHANT STORE INVENTORY ENDPOINTS ---
app.get('/api/merchant/inventory', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const inventory = await db.getMerchantInventory(merchantId);
    res.json({ success: true, merchantId, count: inventory.length, inventory });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/merchant/inventory', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    // The store comes from the token and is placed after the spread on purpose: a
    // `merchantId` in the body can never retarget somebody else's shelf.
    const item = await db.updateMerchantInventoryItem({ ...req.body, merchantId: req.merchant.id });
    res.json({ success: true, item });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'store inventory');
    // A refused value has to say which field and why. This used to answer 400 with only
    // `error`, which left a merchant's form unable to tell a bad price from a bad product id.
    const status = err.status || err.statusCode;
    res.status(status === 400 ? 400 : status || 400).json({
      success: false,
      code: err.code || 'INVENTORY_UPDATE_FAILED',
      error: err.message,
      ...(err.field ? { field: err.field, reason: err.reason } : {}),
    });
  }
});

// Un-stock a listing the merchant added themselves. The store is taken from the
// bearer token, so an id in the URL can only ever address the caller's own shelf.
app.delete('/api/merchant/inventory/:masterProductId', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    const result = await db.deleteMerchantInventoryItem({
      merchantId: req.merchant.id,
      masterProductId: req.params.masterProductId
    });
    broadcastToAdmins({ type: 'GROCERY_PRODUCT_UNSTOCKED', merchantId: req.merchant.id, ...result });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// --- MERCHANT CATALOGUE READS (PostgreSQL authoritative) ---
// The legacy in-memory menu is a different store from the `products` table that the
// order path resolves against, so merchant clients read the real catalogue here.
// `/api/merchant/catalog` is deliberately NOT entitlement-gated. `restaurant-merchant-web`
// reads it (`app/page.tsx:22` -> `merchantApi.catalog()`), so marking it GROCERY-only would
// break a working restaurant integration rather than protect one. The entanglement it exposes
// is real and is recorded as a finding instead: a restaurant console is being served from the
// grocery-shaped `products` table, which is the module-boundary question the entitlement rule
// is asking, and answering it means changing a shipping app — a product decision.
app.get('/api/merchant/catalog', authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const merchant = await db.orderRepo.resolveMerchant(req.merchant.id);
    if (!merchant) {
      return res.status(401).json({ success: false, error: 'Merchant profile not found', requestId: req.id });
    }
    const { supabaseAdmin, isLivePostgres } = require('./supabase');
    if (!isLivePostgres || !supabaseAdmin) {
      return res.json({ success: true, merchantId: merchant.id, count: 0, products: [], degraded: true });
    }
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, sku, name, description, category, price, discount_price, is_available, in_stock_quantity, image_url, updated_at')
      .eq('merchant_id', merchant.id)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) return replyStoreError(res, req, error, 'merchant product list');
    res.json({ success: true, merchantId: merchant.id, count: (data || []).length, products: data || [] });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'merchant product list');
    res.status(400).json({ success: false, error: err.message });
  }
});

// Master grocery catalogue the merchant may stock in their store.
app.get('/api/merchant/master-catalog', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    const { supabaseAdmin, isLivePostgres } = require('./supabase');
    if (!isLivePostgres || !supabaseAdmin) {
      return res.json({ success: true, count: db.masterProducts.length, products: db.masterProducts, degraded: true });
    }
    const { data, error } = await supabaseAdmin
      .from('master_grocery_catalog')
      .select('id, name, category, subcategory, brand, standard_unit, pack_size, pricing_model, standard_image_url')
      .eq('is_active', true)
      .order('category', { ascending: true })
      .order('name', { ascending: true });
    if (error) return replyStoreError(res, req, error, 'master catalogue');
    res.json({ success: true, count: (data || []).length, products: data || [] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Bulk Merchant Price Update
app.post('/api/grocery/products/bulk-price-update', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), (req, res) => {
  try {
    // Bulk path only. `req.body.actor` is deliberately ignored: this route is merchant-authenticated,
    // so the audit actor and role come from the session (same `req.merchant.name || 'Merchant'`
    // convention used elsewhere) and a merchant can no longer write "Admin ..." into the price audit.
    const { updates } = req.body;
    const merchantId = req.merchant.id;
    const actor = req.merchant.name || 'Merchant';
    const results = db.bulkUpdateGroceryPrices({ updates, merchantId, actor, actorRole: 'MERCHANT' });
    broadcastToAdmins({ type: 'GROCERY_BULK_PRICE_UPDATED', results });
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Server-Side Cart Price Revalidation (Customer App & Cart)
app.post('/api/grocery/cart/revalidate', authenticateUser, async (req, res) => {
  const cartItems = req.body.cartItems || [];
  const { supabaseAdmin, isLivePostgres } = require('./supabase');

  if (!isLivePostgres || !supabaseAdmin) {
    const reval = db.revalidateCart(cartItems);
    return res.json({ success: true, ...reval, dataSource: 'fixture', degraded: true });
  }

  try {
    const requestedIds = [...new Set(cartItems
      .map((item) => db.orderRepo.resolveGroceryRefId(item.productId || item.id || ''))
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];

    const inventoryById = new Map();
    if (requestedIds.length) {
      const { data, error } = await supabaseAdmin
        .from('merchant_grocery_inventory')
        .select('id, product_id, merchant_id, store_price, stock_quantity, is_available, status, master_grocery_catalog(id, name, standard_unit, pricing_model)')
        .or(`id.in.(${requestedIds.join(',')}),product_id.in.(${requestedIds.join(',')})`);
      if (error) return replyStoreError(res, req, error, 'cart prices');
      for (const row of data || []) {
        inventoryById.set(row.id, row);
        if (row.product_id && !inventoryById.has(row.product_id)) inventoryById.set(row.product_id, row);
      }
    }

    let priceChanged = false;
    const items = cartItems.map((item) => {
      const sentId = (item.productId || item.id || '').toString().trim();
      const row = inventoryById.get(sentId) || inventoryById.get(db.orderRepo.resolveGroceryRefId(sentId));
      const catalog = row?.master_grocery_catalog || {};
      const quantity = Number(item.quantity || item.requestedQtyKg || 1);

      if (!row || row.is_available !== true || Number(row.stock_quantity) <= 0) {
        priceChanged = true;
        return {
          productId: sentId,
          available: false,
          priceChanged: true,
          quantity,
          statusMessage: row ? 'Out of stock at this store' : 'Item is no longer stocked by any NABIN grocery store'
        };
      }

      const serverPrice = Number(row.store_price);
      const clientPrice = parseFloat(item.unitPrice ?? item.serverPrice ?? item.price);
      const differs = Number.isFinite(clientPrice) && Math.abs(clientPrice - serverPrice) > 0.01;
      if (differs) priceChanged = true;

      return {
        productId: sentId,
        inventoryId: row.id,
        merchantId: row.merchant_id,
        productName: catalog.name ?? 'Grocery item',
        unit: catalog.standard_unit ?? null,
        pricingType: catalog.pricing_model ?? null,
        isWeightBased: catalog.pricing_model === 'WEIGHT_BASED_PRICE',
        clientPrice: Number.isFinite(clientPrice) ? clientPrice : serverPrice,
        serverPrice,
        priceChanged: differs,
        quantity,
        requestedQtyKg: Number(item.requestedQtyKg || quantity),
        estimatedTotal: Math.round(serverPrice * quantity * 100) / 100,
        stockQty: Number(row.stock_quantity),
        mrp: null,
        available: true
      };
    });

    const merchantIds = [...new Set(items.map((i) => i.merchantId).filter(Boolean))];
    res.json({
      success: true,
      priceChanged,
      status: priceChanged ? 'PRICE_CHANGED' : 'VALIDATED',
      merchantIds,
      // Checkout is per-store, so a basket spanning two merchants cannot be placed.
      singleMerchant: merchantIds.length <= 1,
      items,
      dataSource: 'postgres'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Authoritative Checkout Validation & Order Generation (PostgreSQL-Authoritative)
app.post('/api/grocery/checkout/validate', authenticateUser, async (req, res) => {
  if (db.isServicePaused('grocery')) {
    const s = db.getService('grocery');
    return res.status(423).json({
      success: false,
      servicePaused: true,
      error: s?.broadcastNotice || 'NABIN Mart / Quick Grocery delivery is temporarily paused by platform operations.',
      serviceName: s?.name || 'NABIN Mart',
      resumeAt: s?.resumeAt || null,
      reason: s?.pausedReason || null
    });
  }

  try {
    await featureControlService.requireFeature('FEATURE_GROCERY', req.header('X-Location-Id') || 'GLOBAL');
    await featureControlService.requireFeature('FEATURE_GROCERY_MARKETPLACE', req.header('X-Location-Id') || 'GLOBAL');
  } catch (error) {
    if (error.code === 'FEATURE_DISABLED') return res.status(403).json({ success: false, error: error.message, code: error.code });
    throw error;
  }

  try {
    const customerRaw = req.user?.id || req.user?.userId || req.user?.sub;
    if (!customerRaw) {
      return res.status(401).json({
        success: false,
        code: 'UNAUTHENTICATED',
        error: 'Authentication required for grocery checkout.'
      });
    }

    const customerUuid = db.orderRepo.resolveUserUuid(customerRaw);
    if (!customerUuid) {
      return res.status(403).json({
        success: false,
        code: 'USER_NOT_FOUND',
        error: 'Authenticated customer could not be resolved.'
      });
    }

    const requestedMerchant = req.body.merchantId || req.body.restaurantId || req.body.storeId || 'mcht_1';
    if (requestedMerchant === 'mcht_darkstore_1' || (requestedMerchant && String(requestedMerchant).toLowerCase().includes('darkstore'))) {
      return res.status(400).json({
        success: false,
        code: 'DARK_STORE_NOT_SUPPORTED',
        error: 'Dark stores are not supported. NABIN only operates with independent verified grocery merchants.'
      });
    }

    const merchant = await db.orderRepo.resolveMerchant(requestedMerchant);
    if (!merchant) {
      return res.status(404).json({
        success: false,
        code: 'MERCHANT_NOT_FOUND',
        error: 'Grocery merchant not found.'
      });
    }

    if (!['GROCERY', 'HYBRID_BOTH'].includes(merchant.merchant_type)) {
      return res.status(400).json({
        success: false,
        code: 'MERCHANT_TYPE_MISMATCH',
        error: 'Merchant is not authorized for GROCERY service.'
      });
    }

    const cartItems = req.body.cartItems || req.body.items || [];
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_CART',
        error: 'Cart items cannot be empty.'
      });
    }

    const resolved = await db.orderRepo.resolveGroceryItems(merchant.id, cartItems);
    const grossAmount = Math.round((Number(resolved.totalAmount) || 0) * 100) / 100;

    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey || null;

    let checkoutId = req.body.checkoutId || req.body.checkout_id || null;
    if (!checkoutId && idempotencyKey) {
      const existingToken = await db.orderRepo.getIdempotencyToken(idempotencyKey);
      if (existingToken?.order?.checkout_id) {
        checkoutId = existingToken.order.checkout_id;
      }
    }

    // The client's own `discount`/`finalTotal` fields are never read: the coupon is
    // redeemed against the PostgreSQL-resolved cart total and the atomic order RPC
    // re-reads every unit price from the database.
    const couponCode = req.body.couponCode || req.body.promoCode || null;
    let coupon = { applied: false, discount: 0, finalAmount: grossAmount };
    if (couponCode) {
      coupon = await db.redeemCoupon({
        code: couponCode,
        customerId: customerUuid,
        orderAmount: grossAmount,
        service: 'GROCERY',
        idempotencyKey: `grocery_coupon:${idempotencyKey || crypto.randomUUID()}`
      });
      if (!coupon.applied) {
        return res.status(400).json({
          success: false,
          code: 'INVALID_PROMO_CODE',
          error: coupon.error
        });
      }
    }
    const payableAmount = Math.round((grossAmount - coupon.discount) * 100) / 100;

    if (!checkoutId) {
      // Auto-provision PostgreSQL checkout row to guarantee checkout linkage
      const newCheckout = await db.orderRepo.createCheckoutSession({
        customerId: customerUuid,
        merchantId: merchant.id,
        serviceType: 'GROCERY',
        paymentMethod: req.body.paymentMethod === 'CASH' ? 'CASH' : 'WALLET',
        baseAmount: grossAmount,
        discountAmount: coupon.discount,
        appliedPromoCode: coupon.applied ? coupon.code : null,
        promotionId: coupon.applied ? coupon.promotionId : null,
        redemptionId: coupon.applied ? coupon.redemptionId : null,
        finalPayableAmount: payableAmount,
        checkoutStatus: 'CONFIRMED',
        metadata: {
          deliveryAddress: req.body.deliveryAddress || 'Default Address',
          deliveryInstructions: req.body.deliveryInstructions || null
        }
      });
      checkoutId = newCheckout.id;
    }

    const effectiveIdempKey = idempotencyKey || ('gchk_' + checkoutId);

    const result = await db.orderRepo.createOrderWithLinesAtomic({
      serviceType: 'GROCERY',
      customerId: customerUuid,
      merchantId: merchant.id,
      totalAmount: payableAmount,
      items: resolved.lines,
      metadata: {
        deliveryAddress: req.body.deliveryAddress || 'Default Address',
        deliveryInstructions: req.body.deliveryInstructions || null,
        ...(coupon.applied ? {
          coupon: {
            code: coupon.code,
            promotionId: coupon.promotionId,
            redemptionId: coupon.redemptionId,
            discount: coupon.discount,
            grossAmount,
            payableAmount
          }
        } : {})
      },
      idempotencyKey: effectiveIdempKey,
      checkoutId
    });

    if (!result.success) {
      const statusCode = (result.code === 'IDEMPOTENCY_CONFLICT' || result.code === 'CHECKOUT_ALREADY_LINKED') ? 409 : 400;
      return res.status(statusCode).json(result);
    }

    const dbOrder = await db.orderRepo.getOrderById(result.order_id);
    if (!dbOrder) {
      return res.status(500).json({ success: false, error: 'Order created in PostgreSQL but could not be read back' });
    }

    // Broadcast to merchant WebSocket
    broadcastToMerchant(merchant.id, {
      type: 'ORDER_RECEIVED',
      order: dbOrder
    });

    // Persisted feed entry as well as the socket push, so a store that was closed
    // when the order landed still sees it after signing back in.
    notificationEventBus.publish('MERCHANT_NEW_GROCERY_ORDER', {
      merchantId: merchant.id,
      userType: 'MERCHANT',
      orderId: dbOrder.id,
      title: 'New grocery order',
      body: `Order ${dbOrder.order_number || dbOrder.id} is waiting to be accepted.`,
      notificationType: 'ORDER_RECEIVED',
      relatedEntityType: 'ORDER',
      relatedEntityId: dbOrder.id,
      priority: 'HIGH'
    });

    const orderSnapshot = {
      id: dbOrder.id,
      order_id: dbOrder.id,
      order_number: dbOrder.order_number,
      status: dbOrder.order_state,
      order_state: dbOrder.order_state,
      merchantId: dbOrder.merchant_id,
      customerId: dbOrder.customer_id,
      serviceType: dbOrder.service_type,
      checkoutId: dbOrder.checkout_id,
      deliveryAddress: req.body.deliveryAddress || 'Default Address',
      items: (dbOrder.lines || []).map(l => ({
        id: l.id,
        productId: l.grocery_inventory_id,
        productName: l.product_name_snapshot,
        quantity: Number(l.quantity),
        unitPriceAtCheckout: Number(l.unit_price_snapshot),
        finalItemAmount: Number(l.line_total),
        unit: l.unit_snapshot,
        packedConfirmedQuantity: l.packed_confirmed_quantity ? Number(l.packed_confirmed_quantity) : null
      })),
      estimatedSubtotal: grossAmount,
      finalSubtotal: grossAmount,
      finalTotal: Number(dbOrder.total_amount),
      discount: coupon.discount,
      appliedPromo: coupon.applied ? {
        code: coupon.code,
        promotionId: coupon.promotionId,
        redemptionId: coupon.redemptionId,
        discount: coupon.discount
      } : null,
      deliveryFee: 0,
      handlingFee: 0,
      createdAt: dbOrder.created_at
    };

    res.json({
      success: true,
      code: 'CHECKOUT_SUCCESS',
      duplicate: !!result.duplicate,
      order: orderSnapshot
    });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'grocery checkout');
    const statusCode = err.statusCode || (err.code === 'MERCHANT_MISMATCH' ? 400 : 409);
    res.status(statusCode).json({
      success: false,
      code: err.code || 'CHECKOUT_FAILED',
      error: err.message
    });
  }
});

// Merchant Submit Actual Packed Weight & Recalculate Order Total (PostgreSQL Authoritative)
app.post('/api/grocery/orders/:id/packed-weight', authenticateMerchant, requireMerchantTenant, requireMerchantService('GROCERY'), async (req, res) => {
  try {
    const { itemId, packedWeight } = req.body;
    const merchantId = req.merchant.id;

    const result = await db.orderRepo.submitPackedWeight({
      orderId: req.params.id,
      itemId,
      packedWeight,
      merchantId
    });

    if (result.order?.customer_id) {
      broadcastToCustomer(result.order.customer_id, {
        type: 'ORDER_WEIGHT_RECALCULATED',
        order: result.order
      });
    }
    res.json(result);
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'packed-weight update');
    res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }
});

// Admin Order State Maintenance: Trigger Expire Stale Orders (Migration 018 timeout authority)
app.post('/api/admin/orders/expire-stale', authenticateAdmin, requirePermission('orders.manage'), async (req, res) => {
  try {
    const expiredCount = await db.orderRepo.expireStaleOrders();
    res.json({ success: true, expiredCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin Price Alerts & Audit Trail API
app.get('/api/admin/grocery/price-alerts', authenticateAdmin, (req, res) => {
  const alerts = db.getUnusualPriceAlerts();
  res.json({ success: true, count: alerts.length, alerts });
});

// Admin Price Freeze / Correction API
app.post('/api/admin/grocery/products/:id/review', authenticateAdmin, requirePermission('grocery.review'), async (req, res) => {
  try {
    const { action, newPrice, reason } = req.body;
    const product = await db.adminReviewPrice({
      productId: req.params.id,
      action,
      newPrice,
      reason,
      adminUser: req.admin
    });
    res.json({ success: true, product });
  } catch (err) {
    // A refused audit record is a 503-shaped outage; a bad action or unknown product is a
    // 400. Collapsing both to 400 tells an operator their input was wrong when the store is down.
    res.status(err.status || 400).json({
      success: false,
      ...(err.code ? { code: err.code } : {}),
      error: err.message
    });
  }
});

// Supabase Database Connection & Status Check API
// Anonymous before this, which made it the most useful endpoint an attacker could ask
// for: it confirmed live connectivity to the database and echoed the driver's own error
// text, which names the host. Admin sessions only, and the engine's words stop at the log.
app.get('/api/admin/supabase-status', authenticateAdmin, async (req, res) => {
  const status = await supabaseHelper.checkSupabaseConnection();
  if (status.error) console.warn(`[supabase-status] ${req.admin.id}: ${status.error}`);
  const { error, ...safeStatus } = status;
  res.json({
    success: true,
    supabase: safeStatus,
    timestamp: new Date().toISOString()
  });
});

// =========================================================================
// FEATURE FLAGS & PLATFORM VERSION CHECK APIS (v1)
// =========================================================================

app.get(['/api/v1/system/version-check', '/api/system/version-check'], (req, res) => {
  const clientType = req.query.clientType || 'customer';
  const version = req.query.version || '1.0.0';
  const check = db.checkAppVersion({ clientType, version });
  res.json({ success: true, ...check });
});

// -------------------------------------------------------------
// FEATURE CONTROL SYSTEM API
// -------------------------------------------------------------
app.get(['/api/features', '/api/v1/features'], async (req, res) => {
  try {
    await featureControlService.refreshCache();
    const publicFeatures = {};
    for (const [key, val] of featureControlService.cache.entries()) {
      publicFeatures[key] = { enabled: val.enabled };
    }
    res.json({ success: true, features: publicFeatures });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch features' });
  }
});

app.get(['/api/admin/features', '/api/v1/admin/features'], authenticateAdmin, async (req, res) => {
  try {
    await featureControlService.refreshCache();
    const adminFeatures = {};
    for (const [key, val] of featureControlService.cache.entries()) {
      adminFeatures[key] = val;
    }
    res.json({ success: true, features: adminFeatures });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch features' });
  }
});

app.post(['/api/v1/admin/features', '/api/admin/features'], authenticateAdmin, async (req, res) => {
  // Legacy POST wrapper to support test_suite.js
  const key = req.body.key;
  if (!key) return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'Feature flag key is required.' });
  
  try {
    const adminRole = req.admin?.role || req.user?.role;
    if (adminRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only SUPER_ADMIN can modify feature controls' });
    }

    if (!featureControlService.isWritableFlagKey(key)) {
      return res.status(400).json({
        success: false,
        code: 'FEATURE_FLAG_KEY_NOT_ALLOWED',
        error: `'${key}' is not a feature flag. Flag keys are FEATURE_-prefixed; a setting another control owns — service state, pricing, surge, theme — changes through that control, not through this one.`
      });
    }

    const { data, error } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();

    // The merge below reads the current value first. On a read failure `data` is null, so the
    // merged object silently became `{enabled, description}` — dropping every other field the
    // flag held (a lost update written with confidence).
    if (error) {
      const refusal = new Error(`Feature flag "${key}" could not be read, so it was not changed.`);
      refusal.status = 503;
      refusal.code = 'FEATURE_FLAG_STORE_UNAVAILABLE';
      refusal.cause = error.message;
      throw refusal;
    }

    let newValue = { enabled: req.body.enabled, description: req.body.description };
    if (data && data.setting_value) {
      newValue = { ...data.setting_value, ...newValue };
    }

    const { error: writeError } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .upsert({
        setting_key: key,
        setting_value: newValue,
        updated_by: req.admin?.id || 'admin',
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });

    // The write used to be unobserved: the `error` above belongs to the *read*, so a refused
    // upsert still answered 200 for a flag that decides whether customers can use a service.
    if (writeError) {
      const refusal = new Error(`Feature flag "${key}" was not written, so it is reported as unchanged.`);
      refusal.status = 503;
      refusal.code = 'FEATURE_FLAG_WRITE_FAILED';
      refusal.cause = writeError.message;
      throw refusal;
    }

    featureControlService.invalidateCache();
    await db.auditAppliedChange({
      adminId: req.admin?.id || 'admin',
      adminName: req.admin?.name || 'Admin',
      role: req.admin?.role || 'SUPER_ADMIN',
      action: 'FEATURE_FLAG_UPDATED',
      module: 'SETTINGS',
      targetEntityType: 'PLATFORM_SETTING',
      targetEntityId: key,
      previousState: data?.setting_value ? JSON.stringify(data.setting_value) : 'ABSENT',
      newState: JSON.stringify(newValue),
      reason: req.body.description || 'Feature flag updated through the admin API'
    });
    res.json({ success: true, featureFlag: { key, ...newValue } });
  } catch (error) {
    // PostgREST error text can name the host, so only our own refusals are echoed.
    const ours = error.code === 'FEATURE_FLAG_WRITE_FAILED'
      || error.code === 'FEATURE_FLAG_STORE_UNAVAILABLE'
      || error.code === 'AUDIT_RECORD_UNAVAILABLE';
    res.status(error.status || 500).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      error: ours ? error.message : 'Failed to update feature'
    });
  }
});

app.put('/api/admin/features/:key', authenticateAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const { enabled, location_overrides } = req.body;
    const adminRole = req.admin?.role || req.user?.role;
    if (adminRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only SUPER_ADMIN can modify feature controls' });
    }

    if (!featureControlService.isWritableFlagKey(key)) {
      return res.status(400).json({
        success: false,
        code: 'FEATURE_FLAG_KEY_NOT_ALLOWED',
        error: `'${key}' is not a feature flag. Flag keys are FEATURE_-prefixed; a setting another control owns — service state, pricing, surge, theme — changes through that control, not through this one.`
      });
    }

    const { data, error } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();

    // A read failure and "no such flag" used to share one answer: 404. That tells the client
    // its key is wrong while the store is simply down.
    if (error) {
      const refusal = new Error(`Feature flag "${key}" could not be read, so it was not changed.`);
      refusal.status = 503;
      refusal.code = 'FEATURE_FLAG_STORE_UNAVAILABLE';
      refusal.cause = error.message;
      throw refusal;
    }
    if (!data) {
      return res.status(404).json({ success: false, error: 'Feature key not found' });
    }

    const newValue = {
      ...data.setting_value,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(location_overrides ? { location_overrides } : {})
    };

    const { error: writeError } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .update({
        setting_value: newValue,
        updated_by: req.admin?.id || 'admin',
        updated_at: new Date().toISOString()
      })
      .eq('setting_key', key);

    if (writeError) {
      const refusal = new Error(`Feature flag "${key}" was not written, so it is reported as unchanged.`);
      refusal.status = 503;
      refusal.code = 'FEATURE_FLAG_WRITE_FAILED';
      refusal.cause = writeError.message;
      throw refusal;
    }

    featureControlService.invalidateCache();
    await db.auditAppliedChange({
      adminId: req.admin?.id || 'admin',
      adminName: req.admin?.name || 'Admin',
      role: req.admin?.role || 'SUPER_ADMIN',
      action: 'FEATURE_FLAG_UPDATED',
      module: 'SETTINGS',
      targetEntityType: 'PLATFORM_SETTING',
      targetEntityId: key,
      previousState: JSON.stringify(data.setting_value),
      newState: JSON.stringify(newValue),
      reason: `Feature flag updated through the admin API by ${req.admin?.name || req.admin?.id || 'admin'}`
    });
    res.json({ success: true, feature: { setting_key: key, setting_value: newValue } });
  } catch (error) {
    const ours = error.code === 'FEATURE_FLAG_WRITE_FAILED'
      || error.code === 'FEATURE_FLAG_STORE_UNAVAILABLE'
      || error.code === 'AUDIT_RECORD_UNAVAILABLE';
    res.status(error.status || 500).json({
      success: false,
      ...(error.code ? { code: error.code } : {}),
      error: ours ? error.message : 'Failed to update feature'
    });
  }
});

// =========================================================================
// SERVER-DRIVEN APP CONFIGURATION (data only, never code)
// =========================================================================

app.get(['/api/app/config', '/api/v1/app/config'], async (req, res) => {
  try {
    const { etag, config } = await appConfigService.getConfig();
    res.setHeader('Cache-Control', `public, max-age=${config.cacheSeconds}`);
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    res.json({ success: true, ...config });
  } catch (error) {
    console.error('⚠️ /api/app/config failed:', error.message);
    res.status(503).json({
      success: false,
      code: 'APP_CONFIG_UNAVAILABLE',
      error: 'Configuration is temporarily unavailable. Use the defaults bundled with the app.',
      requestId: req.id
    });
  }
});

app.get('/api/admin/platform-settings', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  try {
    if (!supabaseHelper.isLivePostgres) {
      return res.json({ success: false, dataSource: 'fixture', degraded: true, error: 'PostgreSQL is unavailable.' });
    }
    let query = supabaseHelper.supabaseAdmin
      .from('platform_settings')
      .select('setting_key, setting_value, description, updated_by, updated_at')
      .order('setting_key', { ascending: true });

    if (req.query.key) query = query.eq('setting_key', String(req.query.key));
    if (req.query.prefix) query = query.like('setting_key', `${String(req.query.prefix)}%`);

    const { data, error } = await query;
    if (error) return replyStoreError(res, req, error, 'platform settings');
    // Never served raw: a row that holds a credential — stored before the write gate
    // existed, or by a subsystem outside it — reads back as its shape, not its value.
    const settings = (data || []).map(row => appConfigService.redactSettingRow(row));
    res.json({
      success: true,
      dataSource: 'postgres',
      settings,
      redactedKeys: settings.filter(row => row.valueRedacted).map(row => row.setting_key)
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, requestId: req.id });
  }
});

app.put('/api/admin/platform-settings/:key', authenticateAdmin, requireSuperAdmin, async (req, res) => {
  const key = req.params.key;
  // One gate answers name shape, whose namespace the key is, and whether any part of this
  // exchange is a credential. A refusal echoes the key and the offending field *names*
  // only — repeating the submitted value would put it in a response body and a log line.
  const refusal = appConfigService.validateSettingWrite(key, req.body?.value);
  if (refusal) {
    return res.status(400).json({ success: false, code: refusal.code, error: refusal.error, requestId: req.id });
  }

  try {
    if (!supabaseHelper.isLivePostgres) {
      return res.status(503).json({ success: false, code: 'DATABASE_UNAVAILABLE', error: 'PostgreSQL is unavailable, so the setting was not written.' });
    }

    const { data: existing } = await supabaseHelper.supabaseAdmin
      .from('platform_settings')
      // `description` is here because an update that sends no description keeps the one
      // already on the row; selecting it without the rest made every write erase it.
      .select('setting_key, description, updated_by, updated_at')
      .eq('setting_key', key)
      .maybeSingle();

    const description = typeof req.body?.description === 'string'
      ? req.body.description.slice(0, 500)
      : (existing?.description ?? null);

    const { data, error } = await supabaseHelper.supabaseAdmin
      .from('platform_settings')
      .upsert({
        setting_key: key,
        setting_value: req.body.value,
        description,
        updated_by: req.admin.id,
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' })
      .select('setting_key, setting_value, description, updated_by, updated_at')
      .single();

    if (error) return replyStoreError(res, req, error, 'platform setting', { unreachableCode: 'DATABASE_UNAVAILABLE' });

    appConfigService.invalidate();

    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: existing ? 'PLATFORM_SETTINGS_UPDATED' : 'PLATFORM_SETTINGS_CREATED',
      module: 'PLATFORM_SETTINGS',
      targetEntityType: 'PLATFORM_SETTING',
      targetEntityId: key,
      previousState: existing ? 'EXISTING' : 'ABSENT',
      newState: 'PUBLISHED',
      reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : `Configuration key ${key} published.`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      requestId: req.id,
      metadata: { key, valueSha256: crypto.createHash('sha256').update(JSON.stringify(req.body.value)).digest('hex').slice(0, 16) }
    });

    res.json({ success: true, dataSource: 'postgres', setting: appConfigService.redactSettingRow(data) });
  } catch (error) {
    console.error('⚠️ PUT /api/admin/platform-settings failed:', error.message);
    res.status(500).json({ success: false, error: 'Failed to update platform setting', requestId: req.id });
  }
});

// =========================================================================
// HIGH-FREQUENCY LIVE FLEET TELEMETRY & SCOPED TRACKING (v1)
// =========================================================================

// Who is allowed to write a merchant's media, decided from the bearer token alone.
//
// Three upload routes used to run this decision inline, and each of them let a request with
// **no token at all** continue whenever the environment was not production, then took the
// destination from the request body (`restaurantId`/`productId`, defaulting to `rest_1`).
// Outside production that meant an anonymous caller could write into any store's gallery, and
// `POST /api/grocery/products/:id/photo` had no check whatsoever: it accepted an unauthored
// upload, overwrote any product's image by id, invented a catalogue entry when the id was
// unknown, and answered 200. That is proven by `merchant_operations_test.js` (MCMD-01…06),
// which measured 200 on all five doors before this existed.
//
// A token is now mandatory on every one of them. `allowsTestConvenience` remains what it was
// for everywhere else — a dev affordance for *credentials*, never a way to become somebody.
function resolveMediaCaller(req, res) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();
  if (!token) {
    res.status(401).json({
      success: false,
      code: 'AUTH_REQUIRED',
      error: 'Authentication required to upload merchant media.',
      requestId: req.id
    });
    return null;
  }
  const session = db.getSessionByToken(token);
  if (!session) {
    res.status(401).json({
      success: false,
      code: 'INVALID_SESSION',
      error: 'Invalid or expired session.',
      requestId: req.id
    });
    return null;
  }
  const role = session.role;
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  if (role !== 'MERCHANT' && !isAdmin) {
    res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      error: 'Merchant or Admin authorization required.',
      requestId: req.id
    });
    return null;
  }
  return { session, callerMerchantId: session.entityId, isAdmin };
}

// The store a media write may target: the caller's own, always. A path or body id is only
// allowed when it resolves to that same store, so `rest_1`, a legacy alias, a uuid and a
// forged id are all answered from identity rather than from what the client typed.
async function mediaTargetStore(caller, suppliedId) {
  const own = await db.orderRepo.resolveMerchant(caller.callerMerchantId);
  if (!own) {
    const err = new Error('Merchant profile not found for this session.');
    err.status = 401;
    throw err;
  }
  if (!suppliedId) return own;
  if (String(suppliedId) === String(own.id)) return own;
  const requested = await db.orderRepo.resolveMerchant(suppliedId);
  if (requested && String(requested.id) === String(own.id)) return own;
  if (caller.isAdmin) {
    // An administrator acts for the store they named, but the store still has to exist.
    const target = requested || (db.restaurants || []).find(r => r.id === suppliedId);
    if (!target) {
      const err = new Error('Restaurant not found.');
      err.status = 404;
      throw err;
    }
    return target;
  }
  const denied = new Error('Forbidden: Cannot write media for another merchant.');
  denied.status = 403;
  denied.code = 'MERCHANT_MISMATCH';
  throw denied;
}

app.post(['/api/v1/driver/location', '/api/driver/location'], authenticateDriver, async (req, res) => {
  const { driverId, lat, lng, latitude, longitude, heading, bearing, speed, speedKmph, accuracy, timestamp, jobId, activeJobId, isOnline, status, serviceType } = req.body;
  const effectiveLat = lat !== undefined ? lat : latitude;
  const effectiveLng = lng !== undefined ? lng : longitude;

  // The same validator the WebSocket frame handler runs, so a fix this socket
  // would reject cannot be posted through this door instead.
  const telemetry = validateDriverTelemetry({
    lat: effectiveLat,
    lng: effectiveLng,
    heading: heading ?? bearing,
    speed: speed ?? speedKmph,
    accuracy,
    timestamp
  });
  if (!telemetry.ok) {
    return res.status(telemetry.status).json({
      success: false,
      code: telemetry.code,
      message: telemetry.message,
      error: telemetry.message
    });
  }

  // Anti-spoofing check: client-supplied driverId must match session
  if (driverId) {
    const callerUuid = db.driverRepo?.resolveUuid(req.driver.id) || req.driver.uuid || req.driver.id;
    const targetUuid = db.driverRepo?.resolveUuid(driverId) || driverId;
    if (driverId !== req.driver.id && callerUuid !== targetUuid) {
      return res.status(403).json({
        success: false,
        code: 'IDENTITY_SPOOFING_REJECTED',
        error: 'Driver impersonation rejected: driverId does not match authenticated credentials.'
      });
    }
  }

  const effectiveDriverId = req.driver.id;
  const targetJobId = jobId || activeJobId;

  // Active job authorization: cannot attach telemetry to a job not assigned to this driver.
  //
  // This used to consult the in-memory copy alone and to skip the check entirely when the
  // job was not in it — which is the state of every job created by another process, or after
  // a restart that did not hydrate it. "Cannot find it" was treated as "nothing to
  // authorise", so the one case where the guard mattered most was the case it let through.
  // The row is now read from PostgreSQL, and a job that cannot be resolved is refused.
  if (targetJobId) {
    let job;
    try {
      job = db.getJob(targetJobId) || await db.jobRepo?.findByIdAsync(targetJobId);
    } catch (lookupErr) {
      // The handler is async now, so a rejection here would otherwise surface as an
      // unhandled promise rather than an answer to the driver. Not being able to ask the
      // question is not permission to accept the telemetry.
      if (supabaseHelper.isStoreUnreachable(lookupErr)) return replyStoreError(res, req, lookupErr, 'trip authorization');
      console.error('[driver/location] authorization lookup failed:', lookupErr);
      return res.status(403).json({
        success: false,
        code: 'JOB_AUTHORIZATION_UNRESOLVED',
        error: 'Forbidden: that trip could not be verified as yours.'
      });
    }
    if (!job) {
      return res.status(404).json({
        success: false,
        code: 'JOB_NOT_FOUND',
        error: 'Forbidden: that trip could not be resolved, so telemetry cannot be attached to it.'
      });
    }
    const callerUuid = db.driverRepo?.resolveUuid(effectiveDriverId) || req.driver.uuid || effectiveDriverId;
    const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
    if (job.driverId !== effectiveDriverId && callerUuid !== jobDriverUuid) {
      return res.status(403).json({
        success: false,
        code: 'JOB_NOT_ASSIGNED_TO_DRIVER',
        error: 'Forbidden: You cannot attach telemetry to a job not assigned to you.'
      });
    }
  }

  // Update in-memory / Redis fast store (Never writing raw high-frequency telemetry to PostgreSQL)
  const locationRecord = db.updateDriverLocation({
    driverId: effectiveDriverId,
    lat: telemetry.value.lat,
    lng: telemetry.value.lng,
    heading: telemetry.value.heading ?? heading ?? bearing,
    speed: telemetry.value.speed ?? speed ?? speedKmph,
    accuracy: telemetry.value.accuracy,
    receivedAt: telemetry.value.receivedAt,
    jobId: targetJobId,
    isOnline: isOnline !== undefined ? isOnline : true,
    status,
    serviceType
  });

  // Broadcast to authorized channel scopes
  // 1. Always broadcast to authorized Admin Fleet channel
  broadcast({
    type: 'DRIVER_LOCATION_UPDATE',
    channel: 'admin:fleet',
    driverId: effectiveDriverId,
    location: locationRecord
  });

  // 2. If assigned to an active trip/delivery, broadcast strictly to the authorized customer/merchant channel
  if (targetJobId) {
    const job = db.getJob(targetJobId);
    const channelName = job?.type === 'RIDE' ? `ride:${targetJobId}` : `delivery:${targetJobId}`;
    broadcast({
      type: 'DRIVER_LOCATION_UPDATE',
      channel: channelName,
      jobId: targetJobId,
      driverId: effectiveDriverId,
      // Position only — this is the customer's live feed. See projectLocationForCustomer.
      location: projectLocationForCustomer(locationRecord)
    });
  }

  res.json({ success: true, telemetryStored: true, timestamp: locationRecord.updatedAt });
});

app.get(['/api/v1/fleet/locations', '/api/fleet/locations'], authenticateAdmin, (req, res) => {
  const serviceType = req.query.serviceType || null;
  const isOnlineOnly = req.query.isOnlineOnly !== 'false';
  const fleet = db.getFleetLocations({ serviceType, isOnlineOnly });
  res.json({ success: true, count: fleet.length, fleet });
});

app.get(['/api/v1/tracking/:jobId', '/api/tracking/:jobId'], async (req, res) => {
  try {
    const jobId = req.params.jobId;
    const job = await db.jobRepo?.findByIdAsync(jobId) || db.getJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, code: 'JOB_NOT_FOUND', message: `Job ${jobId} not found.` });
    }

    // Tenant Authentication & Authorization: Customer, Assigned Driver, or Admin
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'AUTH_REQUIRED',
        error: 'Unauthorized: Authentication token required to track trip.'
      });
    }

    const session = db.getSessionByToken(token);
    if (!session) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        error: 'Unauthorized: Invalid or expired session token.'
      });
    }

    const role = (session.role || '').toUpperCase();
    const callerId = session.entityId;
    const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';

    if (!isAdmin) {
      if (role === 'CUSTOMER') {
        const customerUuid = db.userRepo?.resolveUuid(callerId) || callerId;
        const jobCustomerUuid = db.userRepo?.resolveUuid(job.customerId) || job.customerUuid || job.customerId;
        if (callerId !== job.customerId && customerUuid !== jobCustomerUuid) {
          return res.status(403).json({
            success: false,
            code: 'CUSTOMER_MISMATCH',
            error: 'Forbidden: You cannot track another customer\'s trip.'
          });
        }
      } else if (role === 'DRIVER') {
        const driverUuid = db.driverRepo?.resolveUuid(callerId) || callerId;
        const jobDriverUuid = db.driverRepo?.resolveUuid(job.driverId) || job.driverUuid || job.driverId;
        if (callerId !== job.driverId && driverUuid !== jobDriverUuid) {
          return res.status(403).json({
            success: false,
            code: 'DRIVER_MISMATCH',
            error: 'Forbidden: You are not assigned to this trip.'
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          code: 'FORBIDDEN_TRACKING_ACCESS',
          error: 'Forbidden: Role not authorized for tracking.'
        });
      }
    }

    const effectiveDriverId = job.driverId || null;
    const driverObj = effectiveDriverId ? (db.getDriver(effectiveDriverId) || null) : null;

    // Neither of these may be invented. A customer reading this route can see a position and a
    // name, so a fallback here is a fact the platform never measured: `lat 28.6853, lng 77.2185`
    // is a Delhi coordinate in a Mizoram app, and `'Rajesh Kumar' / '+91 98101 22334'` is a
    // phone number the app offers to dial. Live telemetry lives only in the in-memory fleet map
    // (never in PostgreSQL, see the note at the fleet route), so "this driver has not reported
    // since the process started" is a real and common state — the honest answer is `null`, and
    // `active_ride_screen.dart` already renders an absence rather than a placeholder.
    //
    // The second lookup is not decoration. `POST /api/driver/location` keys the map by the
    // authenticated driver's own id, while `jobs.driver_id` is a uuid, so a customer's read used
    // to miss every report and land on the fabricated pin — which is the only reason nobody
    // noticed. Resolved through the driver row this route already loads, a reported position is
    // found under either spelling, and a driver who has not reported still answers `null`.
    const driverLocation = effectiveDriverId
      ? (db.getDriverLocation(effectiveDriverId)
        || (driverObj && driverObj.id ? db.getDriverLocation(driverObj.id) : null)
        || null)
      : null;

    // A position, not a fleet record — see projectLocationForCustomer.
    const customerLocation = projectLocationForCustomer(driverLocation);

    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      type: job.type || job.serviceType,
      channel: (job.type || job.serviceType) === 'RIDE' ? `ride:${job.id}` : `delivery:${job.id}`,
      driver: driverObj
        ? { id: driverObj.id || effectiveDriverId, name: driverObj.name ?? null, phone: driverObj.phone ?? null }
        : null,
      location: customerLocation,
      pickup: job.pickup,
      drop: job.drop
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// PAYMENT GATEWAY CHECKOUT & ESCROW SETTLEMENT ENGINE
// -------------------------------------------------------------

// 1. Create Sandbox/Live Payment Order Session
app.post('/api/payments/create-order', authenticateUser, async (req, res) => {
  try {
    const customerUuid = resolveCustomerUserUuid(req.user.id || req.user.uuid || req.user.userId);
    if (!customerUuid) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authenticated customer identity could not be resolved.',
        requestId: req.id
      });
    }

    const { amount, currency = 'INR', serviceType = 'RIDE', jobId, metadata = {} } = req.body;

    // Enforce tenant/identity isolation: reject spoofed customerId in payload
    if (req.body.customerId) {
      const declaredCustomerUuid = resolveCustomerUserUuid(req.body.customerId);
      if (req.body.customerId !== req.user.id && declaredCustomerUuid !== customerUuid) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Cannot create payment session for another customer.',
          code: 'CUSTOMER_MISMATCH',
          requestId: req.id
        });
      }
    }

    // Amount integrity check
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid positive transaction amount is required.',
        requestId: req.id
      });
    }

    // If a ride jobId is passed, verify job ownership and amount
    if (jobId) {
      const job = db.getJob ? db.getJob(jobId) : null;
      if (job) {
        const jobCustUuid = resolveCustomerUserUuid(job.customerId || job.customer_id);
        if (jobCustUuid && jobCustUuid !== customerUuid) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: You do not own this ride job.',
            code: 'JOB_CUSTOMER_MISMATCH',
            requestId: req.id
          });
        }
        const expectedFare = Number(job.finalFare || job.fare || job.amount);
        if (expectedFare && Math.abs(expectedFare - numAmount) > 0.01) {
          return res.status(400).json({
            success: false,
            error: `Amount mismatch: job fare is ₹${expectedFare}, cannot request ₹${numAmount}.`,
            code: 'AMOUNT_MISMATCH',
            requestId: req.id
          });
        }
      }
    }

    // If an orderId is attached in metadata, verify order ownership and amount
    const orderRef = metadata.orderId || metadata.order_id;
    if (orderRef && db.orderRepo) {
      const order = await db.orderRepo.getOrderById(orderRef);
      if (order) {
        if (order.customer_id && order.customer_id !== customerUuid) {
          return res.status(403).json({
            success: false,
            error: 'Forbidden: You do not own this order.',
            code: 'ORDER_CUSTOMER_MISMATCH',
            requestId: req.id
          });
        }
        const orderTotal = Number(order.total_amount);
        if (orderTotal && Math.abs(orderTotal - numAmount) > 0.01) {
          return res.status(400).json({
            success: false,
            error: `Amount mismatch: order total is ₹${orderTotal}, cannot request ₹${numAmount}.`,
            code: 'AMOUNT_MISMATCH',
            requestId: req.id
          });
        }
      }
    }

    const session = await db.createPaymentSession({
      customerId: customerUuid,
      amount: numAmount,
      currency,
      serviceType,
      jobId,
      metadata
    });

    res.json({ success: true, session });
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({ success: false, error: err.message, code: err.code, requestId: req.id });
  }
});

// 2. Verify Payment Checkout & Update Transaction State
app.post('/api/payments/verify-checkout', authenticateUser, async (req, res) => {
  try {
    const customerUuid = resolveCustomerUserUuid(req.user.id || req.user.uuid || req.user.userId);
    const { orderId, paymentId, signature, status = 'SUCCESS', failureReason } = req.body;

    const result = await db.verifyPaymentSession({
      orderId,
      paymentId,
      signature,
      customerId: customerUuid,
      status,
      failureReason
    });

    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || (err.code === 'CUSTOMER_MISMATCH' ? 403 : 400);
    res.status(statusCode).json({ success: false, error: err.message, code: err.code, requestId: req.id });
  }
});

// 3. Query Payment Session
app.get('/api/payments/session/:orderId', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Authentication required to query payment session.',
        requestId: req.id
      });
    }

    let authUser = null;
    let isAdmin = false;

    if (activeAdminSessions && activeAdminSessions.has(token)) {
      isAdmin = true;
    } else {
      const session = db.getSessionByToken(token);
      if (!session) {
        return res.status(401).json({
          success: false,
          error: 'Unauthorized: Invalid session token.',
          requestId: req.id
        });
      }
      if (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN') {
        isAdmin = true;
      } else {
        authUser = session.user || session.entity || { id: session.userId || session.id };
        // A payment session is the step before money moves, so it cannot be readable on a
        // bearer that outlived a failed revocation.
        if (await refusedClosedCustomerAccount(req, res, session)) return;
      }
    }

    const session = await (db.paymentRepo ? db.paymentRepo.getPaymentSession(req.params.orderId) : (db.paymentSessions ? db.paymentSessions.get(req.params.orderId) : null));
    if (!session) {
      return res.status(404).json({ success: false, error: 'Payment session not found', requestId: req.id });
    }

    // If not admin, enforce customer tenant isolation
    if (!isAdmin && authUser) {
      const callerUuid = resolveCustomerUserUuid(authUser.id || authUser.uuid);
      const sessionCustomerUuid = resolveCustomerUserUuid(session.customerId || session.customer_id);
      if (callerUuid && sessionCustomerUuid && callerUuid !== sessionCustomerUuid) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: You do not own this payment session.',
          code: 'CUSTOMER_MISMATCH',
          requestId: req.id
        });
      }
    }

    res.json({ success: true, session });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

// 4. Server-to-Server Webhook
app.post('/api/payments/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || req.headers['x-webhook-signature'] || '';
    if (!signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing webhook signature header (x-razorpay-signature or x-webhook-signature required).',
        code: 'MISSING_SIGNATURE',
        requestId: req.id
      });
    }

    // There is no default here on purpose. A committed fallback let any deployment that
    // forgot the variable keep verifying money against a key printed in the repository —
    // which is to say, let anyone who can read the repository authorise a payment — and
    // the previous guard only refused when NODE_ENV was exactly 'production', so beta,
    // staging and a local `npm start` all ran fail-open.
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (!secret) {
      // This is the server's own condition, so it answers as one. A 4xx here would tell
      // the gateway its legitimate webhook was rejected on the merits, and a gateway
      // that believes that stops retrying — which loses the payment record.
      console.error('[payments] PAYMENT_WEBHOOK_SECRET is not configured; webhook refused without verification.');
      return res.status(503).json({
        success: false,
        error: 'This server cannot verify payment webhooks right now, because no webhook secret is configured. Retry later.',
        code: 'WEBHOOK_NOT_CONFIGURED',
        requestId: req.id
      });
    }

    // Cryptographic constant-time HMAC-SHA256 signature verification
    const rawPayload = req.rawBody ? req.rawBody : Buffer.from(JSON.stringify(req.body), 'utf8');
    const expectedSignature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    const suppliedSignature = Buffer.from(signature, 'utf8');
    const expectedSignatureBuffer = Buffer.from(expectedSignature, 'utf8');

    if (
      suppliedSignature.length !== expectedSignatureBuffer.length ||
      !crypto.timingSafeEqual(suppliedSignature, expectedSignatureBuffer)
    ) {
      return res.status(400).json({
        success: false,
        error: 'Invalid webhook signature.',
        code: 'INVALID_SIGNATURE',
        requestId: req.id
      });
    }

    const eventId = req.headers['x-event-id'] || req.body.event_id || req.body.eventId || req.body.id;
    if (!eventId) {
      return res.status(400).json({
        success: false,
        error: 'Event ID is required for idempotent webhook processing.',
        code: 'MISSING_EVENT_ID',
        requestId: req.id
      });
    }

    const eventType = req.body.event || req.body.type || 'payment.captured';
    const paymentData = req.body.payload?.payment?.entity || req.body.data || req.body;
    const paymentId = paymentData.id || req.body.paymentId;
    const orderId = paymentData.order_id || paymentData.orderId || req.body.orderId || req.body.order_id || null;
    let amount = 0;
    if (paymentData.amount !== undefined) {
      amount = paymentData.amount > 100 && Number.isInteger(paymentData.amount)
        ? paymentData.amount / 100
        : Number(paymentData.amount);
    } else if (req.body.amount !== undefined) {
      amount = Number(req.body.amount);
    }
    const status = paymentData.status || req.body.status || 'CAPTURED';

    const result = await db.recordPaymentWebhook({
      eventId,
      eventType,
      paymentId,
      orderId,
      amount,
      status,
      signature,
      payload: req.body,
      rawBody: req.rawBody
    });

    if (result && result.code === 'SESSION_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: result.error || 'Payment session not found for order',
        code: result.code,
        requestId: req.id
      });
    }

    if (result && result.code === 'CUSTOMER_MISMATCH') {
      return res.status(403).json({
        success: false,
        error: 'Customer mismatch: payment session belongs to another customer',
        code: result.code,
        requestId: req.id
      });
    }

    if (result && result.code === 'PAYMENT_FAILED') {
      return res.status(200).json({
        success: true,
        status: 'FAILED',
        code: 'PAYMENT_FAILED',
        message: result.message || 'Payment failure webhook recorded',
        orderId: result.orderId,
        paymentId: result.paymentId,
        requestId: req.id
      });
    }

    if (result && !result.success && !result.duplicate) {
      return res.status(400).json({
        success: false,
        error: result.error || 'Webhook processing failed',
        code: result.code,
        requestId: req.id
      });
    }

    res.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 400;
    res.status(statusCode).json({ success: false, error: err.message, code: err.code, requestId: req.id });
  }
});

// Double-Entry Financial Ledger Query Endpoint
app.get('/api/admin/finance/ledger-double-entry', authenticateAdmin, requirePermission('finance.view'), async (req, res) => {
  const filters = {
    account: req.query.account || null,
    transactionId: req.query.transactionId || null
  };
  // F5: this is the durable journal, not the boot-time `ledgerEntries` projection it used to
  // read. Path, authorization, filters and the { success, entries, total } envelope are
  // unchanged; a store that cannot be walked completely is a typed 503 rather than a shorter
  // ledger.
  try {
    const entries = await db.getDoubleEntryLedger(filters);
    res.json({ success: true, entries, total: entries.length });
  } catch (err) {
    const status = err.status || err.statusCode || 500;
    console.error('[API] double-entry ledger failed:', err.message);
    res.status(status).json({ success: false, code: err.code || 'LEDGER_READ_FAILED', error: err.message, requestId: req.id });
  }
});

// =========================================================================
// CLOUDINARY PUBLIC MEDIA STORAGE & DELIVERY API
// =========================================================================

// 1. Upload Media Asset (Image / Video)
app.post('/api/media/upload', async (req, res) => {
  try {
    const {
      fileData,
      folder = 'nabin/public',
      publicId = null,
      tags = [],
      ownerType = 'PUBLIC',
      ownerId = 'system',
      mediaType = 'IMAGE',
      mimeType = 'image/jpeg',
      bytes = 0,
      replacePublicId = null
    } = req.body;

    if (!fileData) {
      return res.status(400).json({ success: false, error: 'fileData (Base64 Data URI or URL) is required.' });
    }

    const isVideo = mediaType === 'VIDEO' || mimeType.startsWith('video/');
    const uploadResult = isVideo
      ? await cloudinaryService.uploadVideo({ fileData, folder, publicId, tags, mimeType, bytes })
      : await cloudinaryService.uploadImage({ fileData, folder, publicId, tags, mimeType, bytes });

    const savedAsset = db.saveMediaAsset({
      ownerType,
      ownerId,
      mediaType: isVideo ? 'VIDEO' : 'IMAGE',
      public_id: uploadResult.public_id,
      secure_url: uploadResult.secure_url,
      optimized_urls: uploadResult.optimized_urls,
      resource_type: uploadResult.resource_type,
      format: uploadResult.format,
      width: uploadResult.width,
      height: uploadResult.height,
      bytes: uploadResult.bytes,
      folder: uploadResult.folder,
      created_at: uploadResult.created_at
    });

    // If replacing an existing asset, delete the old one after DB save succeeds
    if (replacePublicId && replacePublicId !== uploadResult.public_id) {
      try {
        await cloudinaryService.deleteAsset(replacePublicId);
        db.deleteMediaAsset(replacePublicId);
      } catch (delErr) {
        console.warn(`⚠️ Could not delete replaced asset [${replacePublicId}]:`, delErr.message);
      }
    }

    res.json({ success: true, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// 2. Delete Media Asset
app.delete('/api/media/*', async (req, res) => {
  try {
    const rawPublicId = req.params[0];
    if (!rawPublicId) {
      return res.status(400).json({ success: false, error: 'Cloudinary public_id is required.' });
    }

    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = allowsTestConvenience('skipping an authentication check');

    if (!token && !isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required to delete media assets.' });
    }

    const existing = db.getMediaAsset(rawPublicId);
    if (token) {
      const session = db.getSessionByToken(token);
      // The owner check below proves the bearer belongs to this owner; it does not prove
      // the owner's account is still open, which is what a surviving bearer defeats.
      if (await refusedClosedCustomerAccount(req, res, session)) return;
      const admin = activeAdminSessions.get(token);
      const isAdmin = (admin && admin.role) || (session && (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN'));

      if (existing && !isAdmin) {
        const callerId = session ? (session.entityId || session.userId) : null;
        if (!callerId || (existing.ownerId !== callerId && existing.ownerId !== session?.entity?.id)) {
          return res.status(403).json({ success: false, code: 'FORBIDDEN_NOT_OWNER', error: 'Forbidden: You do not own this media asset.' });
        }
      }
    }

    await cloudinaryService.deleteAsset(rawPublicId, existing?.resourceType || 'image');
    db.deleteMediaAsset(rawPublicId);

    res.json({ success: true, message: `Media asset [${rawPublicId}] deleted successfully.` });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// 3. Generate Signed Upload Parameters for Client Direct Uploads
app.get('/api/media/signed-params', (req, res) => {
  try {
    const { folder = 'nabin/public', publicId = null, tags = '' } = req.query;
    const tagList = tags ? tags.split(',').map(t => t.trim()) : [];
    const params = cloudinaryService.generateSignedUploadParams({ folder, publicId, tags: tagList });
    res.json({ success: true, params });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 4. List Media Assets (Admin / Discovery)
app.get('/api/media', (req, res) => {
  const { ownerType, ownerId, folder } = req.query;
  let list = db.mediaAssets || [];
  if (ownerType) list = list.filter(m => m.ownerType === ownerType);
  if (ownerId) list = list.filter(m => m.ownerId === ownerId);
  if (folder) list = list.filter(m => m.folder === folder);
  res.json({ success: true, media: list, count: list.length });
});

// 5. Customer Profile Photo Upload
app.post('/api/customer/profile/photo', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = allowsTestConvenience('skipping an authentication check');

    let callerCustomerId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'CUSTOMER' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Customer or Admin authorization required.' });
      }
      if (await refusedClosedCustomerAccount(req, res, session)) return;
      callerCustomerId = session.entityId || session.userId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for profile photo upload.' });
    }

    const requestedCustomerId = req.body.customerId || callerCustomerId || 'usr_1';
    if (callerCustomerId && requestedCustomerId !== callerCustomerId) {
      const session = db.getSessionByToken(token);
      if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        const callerUuid = db.userRepo?.resolveUuid(callerCustomerId) || callerCustomerId;
        const targetUuid = db.userRepo?.resolveUuid(requestedCustomerId) || requestedCustomerId;
        if (callerUuid !== targetUuid) {
          return res.status(403).json({ success: false, code: 'CUSTOMER_MISMATCH', error: 'Forbidden: Cannot update photo for another customer.' });
        }
      }
    }

    const { fileData, mimeType = 'image/jpeg' } = req.body;
    const user = db.getUser(requestedCustomerId);
    if (!user) return res.status(404).json({ success: false, error: 'Customer not found.' });

    const folder = `nabin/users/${user.id}`;
    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId: `${folder}/profile`,
      tags: ['customer-avatar', user.id],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'CUSTOMER',
      ownerId: user.id,
      mediaType: 'PROFILE_PHOTO',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      resource_type: uploadRes.resource_type,
      format: uploadRes.format,
      folder
    });

    user.avatarUrl = uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url;
    db.save();

    res.json({ success: true, user, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 6. Driver Profile & Vehicle Media Upload
app.post('/api/driver/profile/photo', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = allowsTestConvenience('skipping an authentication check');

    let callerDriverId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'DRIVER' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Driver or Admin authorization required.' });
      }
      callerDriverId = session.entityId || session.userId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for driver profile photo upload.' });
    }

    const requestedDriverId = req.body.driverId || callerDriverId || 'DRV-101';
    if (callerDriverId && requestedDriverId !== callerDriverId) {
      const session = db.getSessionByToken(token);
      if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        const callerUuid = db.driverRepo?.resolveUuid(callerDriverId) || callerDriverId;
        const targetUuid = db.driverRepo?.resolveUuid(requestedDriverId) || requestedDriverId;
        if (callerUuid !== targetUuid) {
          return res.status(403).json({ success: false, code: 'DRIVER_MISMATCH', error: 'Forbidden: Cannot update photo for another driver.' });
        }
      }
    }

    const { fileData, mimeType = 'image/jpeg' } = req.body;
    const driver = db.getDriver(requestedDriverId);
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found.' });

    const folder = `nabin/drivers/${driver.id}`;
    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId: `${folder}/profile`,
      tags: ['driver-avatar', driver.id],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'DRIVER',
      ownerId: driver.id,
      mediaType: 'PROFILE_PHOTO',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    driver.profilePhotoUrl = uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url;
    db.save();

    res.json({ success: true, driver, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/driver/vehicle/photo', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = allowsTestConvenience('skipping an authentication check');

    let callerDriverId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'DRIVER' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Driver or Admin authorization required.' });
      }
      callerDriverId = session.entityId || session.userId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for vehicle photo upload.' });
    }

    const requestedDriverId = req.body.driverId || callerDriverId || 'DRV-101';
    if (callerDriverId && requestedDriverId !== callerDriverId) {
      const session = db.getSessionByToken(token);
      if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        const callerUuid = db.driverRepo?.resolveUuid(callerDriverId) || callerDriverId;
        const targetUuid = db.driverRepo?.resolveUuid(requestedDriverId) || requestedDriverId;
        if (callerUuid !== targetUuid) {
          return res.status(403).json({ success: false, code: 'DRIVER_MISMATCH', error: 'Forbidden: Cannot update vehicle photo for another driver.' });
        }
      }
    }

    const { vehicleId = 'veh_1', fileData, photoType = 'exterior', mimeType = 'image/jpeg' } = req.body;
    const driver = db.getDriver(requestedDriverId);
    if (!driver) return res.status(404).json({ success: false, error: 'Driver not found.' });

    const folder = `nabin/vehicles/${vehicleId}`;
    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId: `${folder}/${photoType}`,
      tags: ['vehicle-photo', driver.id, vehicleId],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'VEHICLE',
      ownerId: vehicleId,
      mediaType: 'VEHICLE_PHOTO',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    if (!driver.vehiclePhotos) driver.vehiclePhotos = [];
    driver.vehiclePhotos.push(uploadRes.secure_url);
    db.save();

    res.json({ success: true, driver, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 7. Restaurant Logo, Cover, and Menu Item Photo Upload
app.post(['/api/merchant/:restaurantId/media', '/api/merchant/media'], async (req, res) => {
  try {
    const caller = resolveMediaCaller(req, res);
    if (!caller) return;

    const { fileData, mediaType = 'COVER', mimeType = 'image/jpeg' } = req.body;
    // Identity picks the store. A path or body id counts only when it resolves back to the
    // caller's own, so neither `rest_1` nor a forged uuid is a way to write elsewhere.
    const target = await mediaTargetStore(caller, req.params.restaurantId || req.body.restaurantId);
    const rest = db.restaurants.find(r => r.id === target.id || (target.uuid && r.uuid === target.uuid)) || target;

    const folder = `nabin/restaurants/${rest.id}`;
    const publicId = `${folder}/${mediaType.toLowerCase()}`;

    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId,
      tags: ['restaurant-media', rest.id, mediaType],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'RESTAURANT',
      ownerId: rest.id,
      mediaType,
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    if (mediaType === 'LOGO') rest.logoUrl = uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url;
    if (mediaType === 'COVER') rest.coverUrl = uploadRes.optimized_urls?.large || uploadRes.secure_url;
    db.save();

    res.json({ success: true, restaurant: rest, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post(['/api/merchant/:restaurantId/menu/:itemId/photo', '/api/merchant/menu/:itemId/photo'], async (req, res) => {
  try {
    const caller = resolveMediaCaller(req, res);
    if (!caller) return;

    const target = await mediaTargetStore(caller, req.params.restaurantId || req.body.restaurantId);
    const rest = db.restaurants.find(r => r.id === target.id || (target.uuid && r.uuid === target.uuid)) || target;

    const itemId = req.params.itemId || req.body.itemId;
    if (!itemId) {
      return res.status(400).json({ success: false, code: 'ITEM_ID_REQUIRED', error: 'A menu item id is required.', requestId: req.id });
    }
    // The item has to be on the caller's own menu. Naming somebody's item id used to be
    // enough to have its photo replaced, and a missing id silently fell back to 'item_1'.
    const item = (rest.menu || []).find(m => m.id === itemId);
    if (!item) {
      return res.status(404).json({ success: false, code: 'MENU_ITEM_NOT_FOUND', error: 'Menu item not found for this store.', requestId: req.id });
    }

    const { fileData, mimeType = 'image/jpeg' } = req.body;

    const folder = `nabin/restaurants/${rest.id}/menu`;
    const publicId = `${folder}/${itemId}`;

    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId,
      tags: ['menu-item-photo', restaurantId, itemId],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'MENU_ITEM',
      ownerId: itemId,
      mediaType: 'FOOD_PHOTO',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    res.json({ success: true, itemId, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 8. Grocery Product Photo Upload
app.post(['/api/grocery/products/:id/photo', '/api/admin/grocery/products/:id/photo'], async (req, res) => {
  try {
    const caller = resolveMediaCaller(req, res);
    if (!caller) return;

    const { fileData, mimeType = 'image/jpeg' } = req.body;
    const productId = req.params.id || req.body.productId;
    if (!productId) {
      return res.status(400).json({ success: false, code: 'PRODUCT_ID_REQUIRED', error: 'A product id is required.', requestId: req.id });
    }

    // The product must exist and belong to the caller's store. Previously this route had no
    // authentication of any kind and, given an id it did not recognise, pushed a fabricated
    // "Grocery Product Item" into the catalogue — an anonymous caller could therefore create
    // products as well as repaint real ones.
    const { supabaseAdmin, isLivePostgres } = require('./supabase');
    if (isLivePostgres && supabaseAdmin) {
      const target = await mediaTargetStore(caller, null);
      const { data: productRow, error: productErr } = await supabaseAdmin
        .from('products').select('id,merchant_id,name').eq('id', productId).maybeSingle();
      if (productErr) return replyStoreError(res, req, productErr, 'the product being photographed');
      if (!productRow) {
        return res.status(404).json({ success: false, code: 'PRODUCT_NOT_FOUND', error: 'Product not found.', requestId: req.id });
      }
      if (!caller.isAdmin && String(productRow.merchant_id) !== String(target.id)) {
        return res.status(403).json({
          success: false,
          code: 'MERCHANT_MISMATCH',
          error: 'Forbidden: Cannot upload a photo for another merchant\'s product.',
          requestId: req.id
        });
      }
    } else if (!caller.isAdmin) {
      const owned = (db.groceryCatalog || []).find(p => p.id === productId || p.sku === productId);
      if (!owned) {
        return res.status(404).json({ success: false, code: 'PRODUCT_NOT_FOUND', error: 'Product not found.', requestId: req.id });
      }
    }

    const folder = `nabin/grocery/products/${productId}`;
    const publicId = `${folder}/image`;

    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId,
      tags: ['grocery-product', productId],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'GROCERY_PRODUCT',
      ownerId: productId,
      mediaType: 'PRODUCT_PHOTO',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    let product = db.groceryCatalog?.find(p => p.id === productId || p.sku === productId);
    if (product) {
      product.imageUrl = uploadRes.optimized_urls?.medium || uploadRes.secure_url;
      product.thumbnailUrl = uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url;
      db.save();
    }

    res.json({ success: true, productId, product: product || null, asset: savedAsset });
  } catch (err) {
    if (supabaseHelper.isStoreUnreachable(err)) return replyStoreError(res, req, err, 'grocery product photo');
    res.status(err.status || 400).json({ success: false, code: err.code, error: err.message });
  }
});

// 9. Parcel Delivery Proof Photo Upload
app.post('/api/parcel/:id/delivery-proof', async (req, res) => {
  try {
    const parcelId = req.params.id || req.body.parcelId;
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = allowsTestConvenience('skipping an authentication check');

    let callerDriverId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'DRIVER' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Driver or Admin authorization required.' });
      }
      callerDriverId = session.entityId || session.userId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for delivery proof.' });
    }

    const job = db.getJob(parcelId);
    if (!job) return res.status(404).json({ success: false, error: 'Parcel job not found.' });

    const assignedDriver = job.assignedDriverId || job.driverId;
    if (callerDriverId && assignedDriver) {
      const callerUuid = db.driverRepo?.resolveUuid(callerDriverId) || callerDriverId;
      const assignedUuid = db.driverRepo?.resolveUuid(assignedDriver) || assignedDriver;
      if (callerDriverId !== assignedDriver && callerUuid !== assignedUuid) {
        return res.status(403).json({ success: false, code: 'DRIVER_NOT_ASSIGNED', error: 'Forbidden: You are not the assigned driver for this parcel.' });
      }
    }

    const { fileData, driverId = callerDriverId || 'DRV-101', mimeType = 'image/jpeg' } = req.body;

    const folder = `nabin/parcels/${parcelId}`;
    const publicId = `${folder}/proof_${Date.now()}`;

    const uploadRes = await cloudinaryService.uploadImage({
      fileData,
      folder,
      publicId,
      tags: ['parcel-delivery-proof', parcelId, driverId],
      mimeType
    });

    const savedAsset = db.saveMediaAsset({
      ownerType: 'PARCEL_PROOF',
      ownerId: parcelId,
      mediaType: 'DELIVERY_PROOF',
      public_id: uploadRes.public_id,
      secure_url: uploadRes.secure_url,
      optimized_urls: uploadRes.optimized_urls,
      folder
    });

    job.deliveryProofUrl = uploadRes.secure_url;
    db.save();

    res.json({ success: true, parcelId, job, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// =========================================================================
// NOTIFICATION REST API ENDPOINTS (PHASE 17 - MILESTONE 3)
// =========================================================================
// Top-level PushNotificationService and NotificationEventBus instances are used here.

// Rate limiting state for Administrative Broadcasts (Requirement 9: 1 per 15 minutes)
let lastAdminBroadcastTimestamp = 0;
const BROADCAST_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Universal Notification User Authentication Middleware
 * Enforces authenticated identity from session token; rejects unauthenticated requests.
 * Resolves session entity and sets req.authenticatedUserId.
 */
function requireNotificationAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '').trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Authentication token required. Please log in with Bearer token.',
      code: 'UNAUTHORIZED',
      requestId: req.id
    });
  }

  let session = db.getSessionByToken(token);
  if (!session) {
    const admin = activeAdminSessions.get(token);
    if (admin) {
      session = { token, role: admin.role, entityId: admin.id, entity: admin };
    }
  }

  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired session token.',
      code: 'UNAUTHORIZED',
      requestId: req.id
    });
  }

  let resolvedUserId = null;
  if (session.role === 'CUSTOMER') {
    resolvedUserId = session.entityId;
  } else if (session.role === 'DRIVER') {
    const drv = session.entity || db.getDriver(session.entityId);
    resolvedUserId = drv?.userId || drv?.user_id || session.entityId;
  } else {
    resolvedUserId = session.entityId;
  }

  req.session = session;
  req.user = session.entity || db.getUser(resolvedUserId) || { id: resolvedUserId };
  req.authenticatedUserId = resolvedUserId;
  next();
}

// 1. Device Token Registration (POST /api/notifications/device-token)
app.post('/api/notifications/device-token', requireNotificationAuth, async (req, res) => {
  try {
    const { deviceToken, platform = 'ANDROID', appType = 'CUSTOMER', deviceId = null } = req.body || {};

    if (!deviceToken || typeof deviceToken !== 'string' || !deviceToken.trim()) {
      return res.status(400).json({
        success: false,
        error: 'deviceToken is required and must be a non-empty string.',
        code: 'INVALID_DEVICE_TOKEN',
        requestId: req.id
      });
    }

    if (deviceToken.length > 1024) {
      return res.status(400).json({
        success: false,
        error: 'deviceToken exceeds maximum length of 1024 characters.',
        code: 'TOKEN_TOO_LONG',
        requestId: req.id
      });
    }

    const validPlatforms = ['ANDROID', 'IOS', 'WEB'];
    const normPlatform = platform.toUpperCase().trim();
    if (!validPlatforms.includes(normPlatform)) {
      return res.status(400).json({
        success: false,
        error: `Invalid platform [${platform}]. Allowed values: ${validPlatforms.join(', ')}`,
        code: 'INVALID_PLATFORM',
        requestId: req.id
      });
    }

    const validAppTypes = ['CUSTOMER', 'DRIVER', 'MERCHANT', 'ADMIN'];
    const normAppType = appType.toUpperCase().trim();
    if (!validAppTypes.includes(normAppType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid appType [${appType}]. Allowed values: ${validAppTypes.join(', ')}`,
        code: 'INVALID_APP_TYPE',
        requestId: req.id
      });
    }

    // Authenticated identity is authoritative; ignore any client-supplied user_id
    const registered = await db.notificationRepo.registerDeviceToken({
      userId: req.authenticatedUserId,
      deviceToken: deviceToken.trim(),
      platform: normPlatform,
      appType: normAppType,
      deviceId: deviceId ? String(deviceId).slice(0, 255) : null
    });

    res.json({
      success: true,
      deviceToken: registered,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 2. Device Token Deactivation (DELETE /api/notifications/device-token)
app.delete('/api/notifications/device-token', requireNotificationAuth, async (req, res) => {
  try {
    const tokenToDeactivate = req.body?.deviceToken || req.body?.device_token || req.query?.deviceToken;

    if (!tokenToDeactivate || typeof tokenToDeactivate !== 'string' || !tokenToDeactivate.trim()) {
      return res.status(400).json({
        success: false,
        error: 'deviceToken is required to deactivate token.',
        code: 'MISSING_DEVICE_TOKEN',
        requestId: req.id
      });
    }

    // Only deactivates the authenticated user's token; never affects or exposes other accounts
    const deactivated = await db.notificationRepo.deactivateDeviceToken(
      req.authenticatedUserId,
      tokenToDeactivate.trim()
    );

    res.json({
      success: true,
      deactivated,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 3. User Notification Feed (GET /api/notifications)
app.get('/api/notifications', requireNotificationAuth, async (req, res) => {
  try {
    const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 100);
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const unreadOnly = req.query.unreadOnly === 'true' || req.query.unreadOnly === true || req.query.unreadOnly === '1';
    const notificationType = req.query.category || req.query.type || req.query.notificationType || null;

    // Authenticated recipient is authoritative; ignore client-supplied recipient filtering
    const feed = await db.notificationRepo.getNotifications(req.authenticatedUserId, {
      limit,
      offset,
      unreadOnly,
      notificationType
    });

    res.json({
      success: true,
      ...feed,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 4. Mark Notification Read (PUT /api/notifications/:id/read)
app.put('/api/notifications/:id/read', requireNotificationAuth, async (req, res) => {
  try {
    const notificationId = req.params.id;
    if (!notificationId) {
      return res.status(400).json({
        success: false,
        error: 'Notification ID is required.',
        code: 'MISSING_NOTIFICATION_ID',
        requestId: req.id
      });
    }

    // Fails closed if notification does not exist or belongs to another user
    const result = await db.notificationRepo.markAsRead(req.authenticatedUserId, notificationId);
    if (!result.success) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found.',
        code: 'NOT_FOUND',
        requestId: req.id
      });
    }

    res.json({
      success: true,
      notification: result.notification,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 5. Mark All Notifications Read (PUT /api/notifications/read-all)
app.put('/api/notifications/read-all', requireNotificationAuth, async (req, res) => {
  try {
    const result = await db.notificationRepo.markAllAsRead(req.authenticatedUserId);
    res.json({
      success: true,
      updatedCount: result.updatedCount,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 6. Get User Notification Preferences (GET /api/notifications/preferences)
app.get('/api/notifications/preferences', requireNotificationAuth, async (req, res) => {
  try {
    const preferences = await db.notificationRepo.getPreferences(req.authenticatedUserId);
    res.json({
      success: true,
      preferences,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 7. Update User Notification Preferences (PUT /api/notifications/preferences)
app.put('/api/notifications/preferences', requireNotificationAuth, async (req, res) => {
  try {
    const updated = await db.notificationRepo.updatePreferences(req.authenticatedUserId, req.body || {});
    res.json({
      success: true,
      preferences: updated,
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// 8. Admin Notification Broadcast (POST /api/admin/notifications/broadcast)
app.post('/api/admin/notifications/broadcast', authenticateAdmin, requirePermission('notification.broadcast'), async (req, res) => {
  try {
    const now = Date.now();
    // Enforce 1 broadcast per 15 minutes rate limit
    if (now - lastAdminBroadcastTimestamp < BROADCAST_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((BROADCAST_COOLDOWN_MS - (now - lastAdminBroadcastTimestamp)) / 1000);
      return res.status(429).json({
        success: false,
        error: `Administrative broadcast rate limit exceeded. Only 1 broadcast permitted per 15 minutes. Try again in ${remainingSeconds}s.`,
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: remainingSeconds,
        requestId: req.id
      });
    }

    const {
      title,
      body,
      audience = 'ALL',
      notificationType = 'BROADCAST',
      priority = 'NORMAL',
      data = {}
    } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        error: 'title is required and must be a non-empty string.',
        code: 'MISSING_TITLE',
        requestId: req.id
      });
    }

    if (title.length > 255) {
      return res.status(400).json({
        success: false,
        error: 'title exceeds maximum allowed length of 255 characters.',
        code: 'TITLE_TOO_LONG',
        requestId: req.id
      });
    }

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({
        success: false,
        error: 'body is required and must be a non-empty string.',
        code: 'MISSING_BODY',
        requestId: req.id
      });
    }

    if (body.length > 2000) {
      return res.status(400).json({
        success: false,
        error: 'body exceeds maximum allowed length of 2000 characters.',
        code: 'BODY_TOO_LONG',
        requestId: req.id
      });
    }

    const validAudiences = ['ALL', 'CUSTOMERS', 'DRIVERS', 'MERCHANTS'];
    const normAudience = audience.toUpperCase().trim();
    if (!validAudiences.includes(normAudience)) {
      return res.status(400).json({
        success: false,
        error: `Invalid audience [${audience}]. Allowed values: ${validAudiences.join(', ')}`,
        code: 'INVALID_AUDIENCE',
        requestId: req.id
      });
    }

    // PII / Credential sanitization check
    const rawContent = `${title} ${body} ${JSON.stringify(data)}`;
    const sensitivePattern = /(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY|password\s*[:=]|secret\s*[:=]|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b)/i;
    if (sensitivePattern.test(rawContent)) {
      return res.status(400).json({
        success: false,
        error: 'Content validation error: Broadcast title or body contains sensitive PII or credentials.',
        code: 'SENSITIVE_CONTENT_DETECTED',
        requestId: req.id
      });
    }

    const broadcastId = `bcast_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Target audience user resolution
    let targetUsers = [];
    if (normAudience === 'ALL') {
      targetUsers = db.users || [];
    } else if (normAudience === 'CUSTOMERS') {
      targetUsers = (db.users || []).filter(u => !u.role || u.role === 'CUSTOMER');
    } else if (normAudience === 'DRIVERS') {
      const driverUserIds = (db.drivers || []).map(d => d.userId || d.user_id).filter(Boolean);
      targetUsers = (db.users || []).filter(u => driverUserIds.includes(u.id) || driverUserIds.includes(u.uuid));
    } else if (normAudience === 'MERCHANTS') {
      targetUsers = (db.users || []).filter(u => u.role === 'MERCHANT');
    }

    // Persist notification for target recipients
    const dispatchPromises = targetUsers.slice(0, 500).map(user => {
      const recipientId = user.uuid || user.id;
      return db.notificationRepo.createNotification({
        userId: null,
        recipientUserId: recipientId,
        title: title.trim(),
        body: body.trim(),
        notificationType,
        priority,
        data: { ...data, broadcastId }
      });
    });

    await Promise.all(dispatchPromises);

    // Record immutable audit log
    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name || req.admin.username,
      role: req.admin.role,
      action: 'NOTIFICATION_BROADCAST',
      module: 'NOTIFICATIONS',
      targetEntityType: 'BROADCAST',
      targetEntityId: broadcastId,
      previousState: null,
      newState: normAudience,
      reason: `Broadcast dispatched to audience ${normAudience}. Title: "${title.trim()}". Recipients: ${targetUsers.length}`,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1'
    });

    // Update cooldown
    lastAdminBroadcastTimestamp = now;

    res.json({
      success: true,
      broadcastId,
      audience: normAudience,
      recipientCount: targetUsers.length,
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
      requestId: req.id
    });
  }
});

// Centralized Asynchronous Error Handler Middleware
app.use((err, req, res, next) => {
  console.error(`[${req.id || 'NO_REQ_ID'}] Unhandled error:`, err);
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected server error occurred.' : (err.message || 'Internal error')
    },
    requestId: req.id
  });
});

const PORT = process.env.PORT || 4000;
(async () => {
  try {
    await db.initPostgres();
  } catch (e) {
    console.warn('⚠️ PostgreSQL init error:', e.message);
  }

  // Sessions are authoritative in PostgreSQL; hydrate so a restart does not sign
  // users out, then converge periodically so revocations reach every instance.
  await db.hydrateSessions().catch((e) => console.warn('⚠️ Session hydration failed:', e.message));
  const sessionReconcileTimer = setInterval(() => {
    db.reconcileSessions().catch((e) => console.warn('⚠️ Session reconcile failed:', e.message));
  }, 15000);
  sessionReconcileTimer.unref?.();

  server.listen(PORT, () => {
    console.log(`NABIN Unified Backend running on http://localhost:${PORT}`);
    console.log(`WebSocket Dispatch Server listening on ws://localhost:${PORT}`);
  });
})();
