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
const { MockSandboxPushProvider, FcmV1PushProvider, PushNotificationService } = require('./services/PushNotificationService');
const { notificationEventBus, NOTIFICATION_EVENTS } = require('./services/NotificationEventBus');
const featureControlService = require('./services/FeatureControlService');

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
      title: event.title || event.eventType,
      body: event.body || '',
      notificationType: event.notificationType || event.eventType,
      priority: event.priority || 'NORMAL',
      data: event.data || {},
      eventKey: event.eventKey
    });

    if (notifRes && notifRes.success && notifRes.notification && !notifRes.duplicate) {
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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Idempotency-Key', 'X-App-Version', 'X-Device-Id']
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
  res.json({
    status: 'ONLINE',
    service: 'NABIN Unified Multi-App Backend',
    version: '1.1.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    database: {
      configured: connection.configured,
      connected: connection.connected,
      mode: connection.mode,
      ...(connection.error ? { error: connection.error } : {})
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
  res.status(ready ? 200 : 503).json({
    ready,
    platformStatus: status.summary.platformStatus,
    database: {
      connected: connection.connected,
      mode: connection.mode,
      ...(connection.error ? { error: connection.error } : {})
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

      if (rawLat === undefined || rawLng === undefined || isNaN(Number(rawLat)) || isNaN(Number(rawLng))) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          code: 'INVALID_COORDINATES',
          error: 'Numeric latitude and longitude are required.'
        }));
        return;
      }

      const lat = Number(rawLat);
      const lng = Number(rawLng);

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        ws.send(JSON.stringify({
          type: 'ERROR',
          code: 'COORDINATES_OUT_OF_RANGE',
          error: 'Latitude must be between -90 and 90, longitude between -180 and 180.'
        }));
        return;
      }

      const locationRecord = db.updateDriverLocation({
        driverId,
        lat,
        lng,
        heading,
        speed,
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
          location: locationRecord
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

function authenticateUser(req, res, next) {
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

  req.user = session.entity || db.getUser(session.entityId);
  req.session = session;
  next();
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
    if (session && (session.role === 'ADMIN' || session.role === 'SUPER_ADMIN')) {
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

  req.admin = admin;
  next();
}

function requirePermission(requiredPerm) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, error: 'Authentication required', requestId: req.id });
    }

    if (req.admin.role === 'SUPER_ADMIN' || (req.admin.permissions && req.admin.permissions.includes(requiredPerm))) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: `Access Denied: Missing required permission [${requiredPerm}]. Current role: ${req.admin.role}`,
      requestId: req.id
    });
  };
}

// -------------------------------------------------------------
// CENTRALIZED AUTH & OTP REST API ENDPOINTS
// -------------------------------------------------------------

// Send Verification OTP to Mobile Number
app.post('/api/auth/send-otp', (req, res) => {
  try {
    const { phone, role = 'CUSTOMER', purpose = 'LOGIN' } = req.body;
    const result = db.sendAuthOtp({ phone, role, purpose });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Verify Mobile OTP & Issue Session Token
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { phone, otp, role = 'CUSTOMER', purpose = 'LOGIN' } = req.body;
    const result = await db.verifyAuthOtp({ phone, otp, role, purpose });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get Current Authenticated Profile
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/, '') || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No session token provided.' });
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Invalid or expired session token.' });
  }

  res.json({
    success: true,
    role: session.role,
    user: session.entity,
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

// Refresh / Validate Token
app.post('/api/auth/refresh-token', (req, res) => {
  const { token } = req.body;
  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({ success: false, error: 'Session token invalid or expired.' });
  }
  res.json({ success: true, valid: true, session: { ...session, token } });
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
    const result = db.pauseService({
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
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/services/resume', authenticateAdmin, requirePermission('services.resume'), async (req, res) => {
  try {
    const { serviceId, reason } = req.body;
    if (!serviceId) {
      return res.status(400).json({ success: false, error: 'serviceId is required (e.g. "rides", "grocery", "food", "parcel", "payments", "dispatch", or "ALL").' });
    }
    const result = db.resumeService({
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
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/services/emergency-killswitch', authenticateAdmin, requirePermission('services.emergency_killswitch'), async (req, res) => {
  try {
    const { activate, reason } = req.body;
    let result;
    if (activate) {
      result = db.pauseService({
        serviceId: 'ALL',
        reason: reason || 'Master Emergency Killswitch activated by Super Admin',
        adminUser: req.admin
      });
    } else {
      result = db.resumeService({
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
    res.status(400).json({ success: false, error: err.message });
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

    const firstAdmin = {
      id: 'adm_bootstrap_1',
      username,
      name: 'System Administrator',
      role: 'SUPER_ADMIN',
      email: 'admin@nabin.in',
      salt,
      passwordHash,
      permissions: [
        'identity_verification.view', 'identity_verification.review', 'identity_verification.approve',
        'identity_verification.reject', 'identity_verification.request_resubmission',
        'identity_documents.view', 'identity_documents.download', 'fleet.manage', 'merchant.manage',
        'finance.view', 'finance.refund', 'finance.adjust', 'finance.settlement', 'pricing.edit',
        'support.view', 'support.respond', 'support.resolve', 'support.escalate', 'promotion.view',
        'promotion.create', 'promotion.edit', 'promotion.activate', 'geofence.view', 'geofence.create',
        'geofence.edit', 'geofence.delete', 'surge.view', 'surge.create', 'surge.edit', 'surge.activate',
        'audit.view', 'audit.export', 'services.view', 'services.pause', 'services.resume', 'services.emergency_killswitch'
      ]
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
  console.log('[DEBUG] Admin login request received');
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.', requestId: req.id });
  }

  console.log('[DEBUG] Calling verifyAdminCredentials');
  const authResult = db.verifyAdminCredentials(username, password);
  console.log('[DEBUG] verifyAdminCredentials result:', authResult);
  
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

  console.log('[DEBUG] Login successful, creating session');
  const admin = authResult.admin;
  // Bearer credential: must come from a CSPRNG, not Date.now()+Math.random().
  const token = `adm_token_${require('crypto').randomBytes(32).toString('base64url')}`;
  const session = {
    token,
    role: admin.role,
    entityId: admin.id,
    entity: admin,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  };

  console.log('[DEBUG] Setting session');
  activeAdminSessions.set(token, admin);
  await db.registerSession(session);

  console.log('[DEBUG] Creating audit log');
  try {
    await db.createAuditLog({
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
    console.error('[WARN] Failed to create audit log for successful login:', auditErr.message);
  }

  console.log('[DEBUG] Sending response');
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
app.post('/api/admin/reset-password', authenticateAdmin, (req, res) => {
  try {
    const { identifier, username, newPassword, currentPassword } = req.body;
    const targetIdentifier = identifier || username || req.admin.username || req.admin.email;
    const isSelf = targetIdentifier.toLowerCase() === (req.admin.username || '').toLowerCase() || targetIdentifier.toLowerCase() === (req.admin.email || '').toLowerCase();
    const isSuperAdmin = req.admin.role === 'SUPER_ADMIN' || (req.admin.permissions && req.admin.permissions.includes('admin.manage'));

    if (!isSelf && !isSuperAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden: Only SUPER_ADMIN can reset other administrators\' passwords.' });
    }

    if (isSelf && !currentPassword && !isSuperAdmin) {
      return res.status(400).json({ success: false, error: 'Current password is required to reset password.' });
    }

    const result = db.resetAdminPassword({ identifier: targetIdentifier, newPassword, currentPassword, isSuperAdmin });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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
app.get('/api/admin/drivers', (req, res) => {
  const category = req.query.category || 'ALL';
  let list = db.drivers || [];
  if (category !== 'ALL') {
    list = list.filter(d => d.category === category);
  }
  res.json({ success: true, drivers: list, total: list.length });
});

app.get('/api/admin/drivers/:id', (req, res) => {
  const driver = (db.drivers || []).find(d => d.id === req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });
  res.json({ success: true, driver });
});

app.post('/api/admin/drivers/:id/status', authenticateAdmin, async (req, res) => {
  const { status, operationalStatus, kycStatus, reason } = req.body;
  const opStatus = operationalStatus || status;
  const result = await db.setDriverStatus(req.params.id, opStatus, reason, req.admin.id, req.admin.name, kycStatus);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
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
    res.status(err.statusCode || 400).json({ success: false, error: err.message, requestId: req.id });
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
app.get('/api/admin/finance/metrics', authenticateAdmin, requirePermission('finance.view'), (req, res) => {
  res.json({ success: true, metrics: db.getFinancialMetrics() });
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

app.get('/api/admin/finance/settlements/drivers', authenticateAdmin, requirePermission('finance.settlement'), (req, res) => {
  const driverSettlements = db.drivers.map(d => ({
    driverId: d.id,
    driverName: d.name,
    upiId: d.upiId,
    bankAccount: d.bankAccount,
    walletBalance: d.walletBalance,
    todayEarnings: d.todayEarnings,
    status: d.walletBalance > 0 ? 'PENDING' : 'SETTLED'
  }));
  res.json({ success: true, driverSettlements });
});

app.post('/api/admin/finance/settlements/drivers/:id/payout', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  const driver = db.getDriver(req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });

  // Phase 9: Explicit amount validation. A malformed amount must never
  // silently settle the driver's full wallet balance; the full-balance
  // default applies only when no amount is provided at all.
  let amount = driver.walletBalance;
  if (req.body.amount !== undefined && req.body.amount !== null) {
    const parsed = Number(req.body.amount);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid payout amount', code: 'INVALID_AMOUNT' });
    }
    amount = parsed;
  }

  const result = db.recordPayout(driver.id, amount, driver.upiId);
  if (result.success) {
    await db.createAuditLog({
      adminId: req.admin.id,
      adminName: req.admin.name,
      role: req.admin.role,
      action: 'SETTLEMENT_EXECUTED',
      module: 'FINANCE',
      targetEntityType: 'DRIVER_PAYOUT',
      targetEntityId: driver.id,
      previousState: 'PENDING',
      newState: 'PAID',
      reason: `Admin payout of ₹${amount} executed to ${driver.upiId}`
    });
  }
  res.json(result);
});

app.post('/api/admin/finance/adjustments', authenticateAdmin, requirePermission('finance.adjust'), async (req, res) => {
  const { targetType, targetId, direction, amount, reason } = req.body;
  try {
    const result = await db.processFinancialAdjustment(targetType, targetId, direction, amount, reason, req.admin.id, req.admin.name);
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
      return res.status(400).json({ success: false, error: error.message });
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
app.get('/api/admin/accounts', authenticateAdmin, (req, res) => {
  if (req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Access Denied: Super Admin privilege required to view administrator accounts.' });
  }
  const accounts = db.getAdminAccounts();
  res.json({ success: true, accounts, total: accounts.length });
});

app.post('/api/admin/accounts', authenticateAdmin, (req, res) => {
  if (req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Access Denied: Super Admin privilege required to provision new administrator accounts.' });
  }
  const result = db.createAdminAccount(req.body, req.admin.id, req.admin.name);
  if (!result.success) return res.status(400).json(result);
  
  broadcastToAdmins({ type: 'NEW_ADMIN_ACCOUNT_PROVISIONED', account: result.account });
  res.json(result);
});

// -------------------------------------------------------------
// 4. PROMOTIONS & COUPONS
// -------------------------------------------------------------
app.get('/api/admin/promotions', authenticateAdmin, requirePermission('promotion.view'), async (req, res) => {
  try {
    const promotions = await db.promotionRepo.list(req.query);
    res.json({ success: true, promotions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/admin/promotions', authenticateAdmin, requirePermission('promotion.create'), async (req, res) => {
  try {
    const promo = await db.createPromotion(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, promotion: promo });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
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
app.get('/api/advertisements', (req, res) => {
  const { slot, service } = req.query;
  const ads = db.getAdvertisements({ slot, service, activeOnly: true });

  // Record impressions
  ads.forEach(ad => db.recordAdImpression(ad.id));

  // Campaigns live in the in-memory store: the `advertising_campaigns` table is
  // migrated but unused, so impressions/clicks reset on restart and admin
  // campaign writes are not durable. `persisted: false` says so explicitly.
  res.json({
    success: true,
    count: ads.length,
    advertisements: ads,
    dataSource: 'in_memory',
    persisted: false
  });
});

app.post('/api/advertisements/:id/click', (req, res) => {
  const ad = db.recordAdClick(req.params.id);
  if (!ad) return res.status(404).json({ success: false, error: 'Advertisement not found' });
  res.json({ success: true, clicks: ad.clicks, message: 'Click recorded' });
});

app.get('/api/admin/advertisements', authenticateAdmin, (req, res) => {
  const ads = db.getAdvertisements({ activeOnly: false });
  const totalImpressions = ads.reduce((acc, a) => acc + (a.impressions || 0), 0);
  const totalClicks = ads.reduce((acc, a) => acc + (a.clicks || 0), 0);
  const totalRevenue = ads.reduce((acc, a) => acc + (((a.impressions || 0) / 1000) * (a.bidRateCpm || 50)), 0);

  res.json({
    success: true,
    advertisements: ads,
    metrics: {
      totalCampaigns: ads.length,
      activeCampaigns: ads.filter(a => a.status === 'ACTIVE').length,
      totalImpressions,
      totalClicks,
      overallCtr: totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0.00%',
      adRevenueEstimate: Math.round(totalRevenue)
    }
  });
});

app.post('/api/admin/advertisements', authenticateAdmin, (req, res) => {
  try {
    const newAd = db.createAdvertisement(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, advertisement: newAd });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/advertisements/:id', authenticateAdmin, (req, res) => {
  try {
    const updated = db.updateAdvertisement(req.params.id, req.body, req.admin.id, req.admin.name);
    res.json({ success: true, advertisement: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/advertisements/:id', authenticateAdmin, (req, res) => {
  try {
    const deleted = db.deleteAdvertisement(req.params.id, req.admin.id, req.admin.name);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// -------------------------------------------------------------
// 5. GEO-FENCING & DYNAMIC SURGE ZONES
// -------------------------------------------------------------
app.get('/api/admin/geofences', authenticateAdmin, requirePermission('geofence.view'), async (req, res) => {
  try {
    const geoFences = await db.pricingRepo.listGeoFences(req.query);
    res.json({ success: true, geoFences });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/geofences', authenticateAdmin, requirePermission('geofence.create'), async (req, res) => {
  try {
    const fence = await db.addGeoFence(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, geoFence: fence });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/geofences/:id', authenticateAdmin, requirePermission('geofence.delete'), async (req, res) => {
  try {
    const deleted = await db.deleteGeoFence(req.params.id, req.admin.id, req.admin.name);
    if (!deleted) return res.status(404).json({ success: false, error: 'Geo-fence not found' });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/surgezones', authenticateAdmin, requirePermission('surge.view'), async (req, res) => {
  try {
    const surgeZones = await db.pricingRepo.listSurgeZones(req.query);
    res.json({ success: true, surgeZones });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/admin/surgezones', authenticateAdmin, requirePermission('surge.create'), async (req, res) => {
  try {
    const surge = await db.addSurgeZone(req.body, req.admin.id, req.admin.name);
    res.json({ success: true, surgeZone: surge });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Centralized Geofence Live Evaluation Endpoint
app.post('/api/geofence/evaluate', (req, res) => {
  const { lat, lng, serviceType } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: 'Latitude (lat) and Longitude (lng) are required.' });
  }
  const result = db.evaluateLocationGeofences(lat, lng, serviceType || 'RIDE');
  res.json({
    success: true,
    coordinates: { lat: parseFloat(lat), lng: parseFloat(lng) },
    ...result
  });
});

// Centralized Reverse-Geocoding Locality Resolver
app.post('/api/geofence/reverse-geocode', (req, res) => {
  const { lat, lng } = req.body;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ success: false, error: 'Latitude and Longitude required.' });
  }

  const numLat = parseFloat(lat);
  const numLng = parseFloat(lng);

  let locality = 'Live GPS Location';
  let landmark = 'Delhi NCR Operational Hub';
  let city = 'Delhi NCR';

  // Spatial landmark resolution
  if (numLat >= 28.620 && numLat <= 28.640 && numLng >= 28.205 && numLng <= 28.235 || (Math.abs(numLat - 28.6300) < 0.015 && Math.abs(numLng - 77.2200) < 0.015)) {
    locality = 'Connaught Place & Central Secretariat';
    landmark = 'Inner Circle, Rajiv Chowk, New Delhi';
    city = 'New Delhi';
  } else if (Math.abs(numLat - 28.6812) < 0.02 && Math.abs(numLng - 77.2226) < 0.02) {
    locality = 'Civil Lines, North Delhi';
    landmark = 'Near Civil Lines Metro & University Enclave';
    city = 'North Delhi';
  } else if (Math.abs(numLat - 28.5562) < 0.035 && Math.abs(numLng - 77.1000) < 0.035) {
    locality = 'IGI Airport Terminal 3';
    landmark = 'Terminal 3 Arrivals & Aerocity Hospitality Hub';
    city = 'South West Delhi';
  } else if (Math.abs(numLat - 28.4900) < 0.025 && Math.abs(numLng - 77.0850) < 0.025) {
    locality = 'DLF CyberCity & Phase 2';
    landmark = 'Building 10 / Cyber Hub, DLF Phase 2';
    city = 'Gurugram';
  } else if (Math.abs(numLat - 28.5494) < 0.02 && Math.abs(numLng - 77.2001) < 0.02) {
    locality = 'Hauz Khas & Green Park';
    landmark = 'Aurobindo Marg, South Delhi';
    city = 'South Delhi';
  } else if (Math.abs(numLat - 28.6507) < 0.02 && Math.abs(numLng - 77.2334) < 0.02) {
    locality = 'Chandni Chowk Heritage Quarter';
    landmark = 'Red Fort & Old Delhi Railway Hub';
    city = 'Central Delhi';
  } else {
    locality = `Live Location (${numLat.toFixed(3)}° N, ${numLng.toFixed(3)}° E)`;
    landmark = 'Operational Coverage Area';
    city = 'Delhi NCR';
  }

  res.json({
    success: true,
    locality,
    landmark,
    city,
    formattedAddress: `${locality}, ${landmark}, ${city}`,
    coordinates: { lat: numLat, lng: numLng }
  });
});

// Centralized Pricing Estimate (Integrates Live Coordinates, Geo-fences & Surge)
app.post('/api/pricing/estimate', (req, res) => {
  const { serviceType, distanceKm, durationMins, pickupLat, pickupLng, zoneId, promoCode } = req.body;
  const estimate = db.calculateFareEstimate({
    serviceType: serviceType || '3W',
    distanceKm: Number(distanceKm) || 4.0,
    durationMins: Number(durationMins) || 12,
    pickupLat: pickupLat !== undefined ? Number(pickupLat) : null,
    pickupLng: pickupLng !== undefined ? Number(pickupLng) : null,
    zoneId,
    promoCode
  });
  res.json({ success: true, estimate });
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

  const result = db.submitIdentityApplication({
    userId: effectiveUserId,
    name: name || req.user.name,
    phone: phone || req.user.phone,
    email: email || req.user.email,
    dob,
    address,
    aadhaarNumber: aadhaarNumber.toString().trim(),
    aadhaarDocUrl: aadhaarDocUrl || '/docs/mock_aadhaar_user.png',
    voterIdNumber: voterIdNumber.toString().trim().toUpperCase(),
    voterIdDocUrl: voterIdDocUrl || '/docs/mock_voter_user.png',
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
    message: 'Your identity documents have been submitted for manual admin verification.',
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
  res.json({
    success: true,
    ...data,
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

  const canViewUnmasked = req.admin.role === 'SUPER_ADMIN' ||
    (req.admin.permissions && req.admin.permissions.includes('identity_documents.view'));

  let auditLogs = [];
  if (db.auditLogRepo && typeof db.auditLogRepo.list === 'function') {
    const audRes = await db.auditLogRepo.list({ applicationId: appRecord.id });
    auditLogs = audRes.logs;
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

app.post('/api/admin/identity-verifications/:id/lock', authenticateAdmin, requirePermission('identity_verification.review'), (req, res) => {
  const result = db.lockIdentityApplication(req.params.id, req.admin.id, req.admin.name);
  if (!result.success) return res.status(409).json(result);
  res.json(result);
});

app.post('/api/admin/identity-verifications/:id/unlock', authenticateAdmin, requirePermission('identity_verification.review'), (req, res) => {
  const result = db.unlockIdentityApplication(req.params.id, req.admin.id);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/admin/identity-verifications/:id/review', authenticateAdmin, requirePermission('identity_verification.review'), (req, res) => {
  const { decision, reason, checklist } = req.body;

  if (decision === 'APPROVE' && !req.admin.permissions.includes('identity_verification.approve') && req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Permission denied: Cannot approve identity verification.' });
  }
  if (decision === 'REJECT' && !req.admin.permissions.includes('identity_verification.reject') && req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Permission denied: Cannot reject identity verification.' });
  }
  if (decision === 'REQUEST_RESUBMISSION' && !req.admin.permissions.includes('identity_verification.request_resubmission') && req.admin.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ success: false, error: 'Permission denied: Cannot request document resubmission.' });
  }

  const result = db.reviewIdentityApplication(
    req.params.id,
    decision,
    reason,
    checklist,
    req.admin.id,
    req.admin.name
  );

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

  const { customerId, vehicleType, pickup, drop, promoCode, zoneId, bookingType, passengerCategory, passengerInfo } = req.body;
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

  // Server-Side Authoritative Pricing Calculation (Zero Trust of client-supplied fare)
  const pickupLat = pickup?.lat !== undefined ? Number(pickup.lat) : 28.6853;
  const pickupLng = pickup?.lng !== undefined ? Number(pickup.lng) : 77.2185;
  const pricing = db.calculateFareEstimate({
    serviceType: vehicleType || '3W',
    distanceKm: 3.8,
    durationMins: 11,
    pickupLat,
    pickupLng,
    zoneId,
    promoCode
  });
  
  const finalFare = pricing.customerCharge;
  const isSomeoneElse = bookingType === 'FOR_SOMEONE_ELSE';
  const isSchoolChild = isSomeoneElse && passengerCategory === 'SCHOOL_CHILD';

  const job = await db.createJob({
    type: 'RIDE',
    idempotencyKey: idempotencyKey || null,
    customerId: user.id,
    customerName: user.name,
    customerPhone: user.phone,
    customerRating: user.rating,
    vehicleType: vehicleType || '3W',
    pickup: pickup || { address: isSchoolChild ? 'Flat 402, Civil Lines, Delhi' : 'Civil Lines Metro Gate 2, Delhi', lat: pickupLat, lng: pickupLng },
    drop: drop || { address: isSchoolChild ? 'ABC Public School, Kamalanagar' : 'Connaught Place Inner Circle, Block B', lat: 28.6328, lng: 77.2197 },
    distance: isSchoolChild ? '3.8 km' : '4.2 km',
    duration: isSchoolChild ? '11 mins' : '14 mins',
    fare: finalFare,
    driverEarnings: pricing.driverEarnings,
    platformFee: pricing.platformFee,
    surgeMultiplier: pricing.surgeMultiplier,
    appliedPromo: pricing.appliedPromo,
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
      customer: isSchoolChild ? `${passengerInfo?.guardianName || 'Rahul Sharma (Guardian)'}` : `${job.customerName} (${job.customerRating} ★)`,
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

  const { customerId, senderDetails, recipientDetails, promoCode } = req.body;
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

  // Authoritative server-side pricing
  const pricing = db.calculateFareEstimate({
    serviceType: 'PARCEL',
    distanceKm: 6.1,
    durationMins: 18,
    promoCode
  });

  const job = await db.createJob({
    type: 'PARCEL',
    idempotencyKey: idempotencyKey || null,
    customerId: user.id,
    customerName: user.name,
    customerPhone: user.phone,
    pickup: senderDetails || { address: 'Kamla Nagar Market, Block C, Delhi' },
    drop: recipientDetails || { address: 'Karol Bagh Electronics Hub, Delhi' },
    distance: '6.1 km',
    duration: '18 mins',
    fare: pricing.customerCharge,
    driverEarnings: pricing.driverEarnings,
    platformFee: pricing.platformFee,
    appliedPromo: pricing.appliedPromo,
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
      distance: '6.1 km (18 mins)',
      customer: `${user.name} (Sender)`,
      customerPhone: job.customerPhone,
      // Phase 10: parcel OTPs are NOT broadcast with the open dispatch offer.
      // The delivery OTP in particular is the proof-of-delivery control; sending
      // it to every connected driver before assignment nullified it.
      packageDetails: 'Electronics Box (1.4 kg, Fragile)'
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

  const merchant = await db.orderRepo.resolveMerchant(mchtInput);
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
    return res.status(err.statusCode || 400).json({
      success: false,
      code: err.code || 'INVALID_ITEMS',
      error: err.message,
      requestId: req.id
    });
  }

  // 4. Idempotency Key
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey || ('idemp_food_' + crypto.randomUUID());

  // 5. Metadata
  const metadata = {
    deliveryAddress: deliveryAddress || 'North Campus Girls Hostel, Delhi',
    customerName: req.user.name || 'Customer',
    customerPhone: req.user.phone || null,
    source: 'web_or_mobile'
  };

  // 6. Invoke Migration 019 create_order_with_lines_atomic
  try {
    const result = await db.orderRepo.createOrderWithLinesAtomic({
      serviceType: 'FOOD',
      customerId: customerUuid,
      merchantId: merchant.id,
      totalAmount: resolvedProducts.totalAmount,
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
app.get('/api/merchant/:restaurantId/dashboard', authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const merchant = await db.orderRepo.resolveMerchant(req.merchant.id || req.params.restaurantId);
    if (!merchant) {
      return res.status(401).json({ success: false, error: 'Merchant not found', requestId: req.id });
    }

    if (req.params.restaurantId) {
      const requestedMerchant = await db.orderRepo.resolveMerchant(req.params.restaurantId);
      if (requestedMerchant && requestedMerchant.id !== merchant.id) {
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
    res.status(500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post(['/api/merchant/:restaurantId/orders/:orderId/status', '/api/merchant/orders/:orderId/status'], authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const { status, reason, idempotencyKey } = req.body;
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
    return res.status(err.statusCode || 500).json({ success: false, error: err.message, requestId: req.id });
  }
});

app.post('/api/merchant/:restaurantId/menu/:itemId/toggle', authenticateMerchant, requireMerchantTenant, (req, res) => {
  // Phase 8: Fail-closed (DEC-005) — no fallback to first restaurant
  const rest = db.restaurants.find(r => r.id === req.params.restaurantId);
  if (!rest) return res.status(404).json({ success: false, error: 'Restaurant not found.', requestId: req.id });

  // Verify merchant owns this restaurant
  if (rest.merchantId && rest.merchantId !== req.merchant.id) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden: Cannot modify another merchant\'s menu.',
      requestId: req.id
    });
  }
  const item = rest.menu.find(m => m.id === req.params.itemId);
  if (!item) return res.status(404).json({ success: false, error: 'Menu item not found' });

  item.inStock = req.body.inStock ?? !item.inStock;
  res.json({ success: true, item });
});

app.post('/api/admin/restaurants/:id/status', authenticateAdmin, requirePermission('merchant.manage'), (req, res) => {
  const { status, reason } = req.body;
  const result = db.setRestaurantStatus(req.params.id, status, reason, req.admin.id, req.admin.name);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// DRIVER FLEET GOVERNANCE & TELEMETRY
app.post('/api/admin/drivers/:id/status', authenticateAdmin, requirePermission('fleet.manage'), async (req, res) => {
  const { status, operationalStatus, kycStatus, reason } = req.body;
  const opStatus = operationalStatus || status;
  const result = await db.setDriverStatus(req.params.id, opStatus, reason, req.admin.id, req.admin.name, kycStatus);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/admin/drivers/:id/verify-payout-destination', authenticateAdmin, requirePermission('finance.settlement'), async (req, res) => {
  const { decision, evidenceUrl, bankAccountHolderName, reason } = req.body;
  if (!decision || !['APPROVE', 'REJECT'].includes(decision)) {
    return res.status(400).json({ success: false, error: 'decision must be APPROVE or REJECT' });
  }
  const result = await db.driverRepo.verifyPayoutDestination(req.params.id, {
    decision,
    evidenceUrl,
    bankAccountHolderName,
    reason,
    adminId: req.admin.id,
    adminName: req.admin.name
  });
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/driver/:driverId/toggle-online', authenticateDriver, (req, res) => {
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

  const driver = db.getDriver(req.driver.id);
  if (driver.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      error: `Your driver account is SUSPENDED by NABIN Admin. Reason: ${driver.suspensionReason || 'Compliance review'}`
    });
  }

  driver.isOnline = req.body.isOnline ?? !driver.isOnline;
  res.json({ success: true, isOnline: driver.isOnline, operationalStatus: driver.operationalStatus });
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

    const offers = await db.dispatchRepo.getOffersForDriver(req.driver.id);
    res.json({ success: true, count: offers.length, offers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
      const statusCode = result.code === 'OFFER_NOT_FOUND' ? 404 :
        (result.code === 'DRIVER_MISMATCH' || result.code === 'DRIVER_SUSPENDED' ? 403 :
        (result.code === 'JOB_ALREADY_ASSIGNED' ? 409 : 400));
      return res.status(statusCode).json(result);
    }

    const targetJobId = result.job_id || result.job_uuid;
    const job = db.jobRepo?.findById(targetJobId) || await db.jobRepo?.findByIdAsync(targetJobId);
    const driver = db.getDriver(req.driver.id) || req.driver;

    if (driver && job) {
      driver.activeJobId = job.id;
      broadcastToCustomer(job.customerId, {
        type: 'DRIVER_ASSIGNED',
        jobId: job.id,
        driver: {
          name: driver.name,
          vehiclePlate: driver.vehiclePlate,
          rating: driver.rating,
          startOtp: job.startOtp
        }
      });
    }

    res.json({ success: true, duplicate: !!result.duplicate, job, driver, offer: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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
        const statusCode = result.code === 'JOB_NOT_FOUND' ? 404 :
          (result.code === 'DRIVER_MISMATCH' || result.code === 'DRIVER_SUSPENDED' ? 403 :
          (result.code === 'JOB_ALREADY_ASSIGNED' ? 409 : 400));
        return res.status(statusCode).json(result);
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
      driver: {
        name: driver.name,
        vehicleName: driver.vehicleName,
        vehiclePlate: driver.vehiclePlate,
        rating: driver.rating,
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
  if (!completableStates.includes(currentStatus)) {
    return res.status(409).json({
      success: false,
      code: 'OTP_VERIFICATION_REQUIRED',
      error: `Trip cannot be completed from state ${currentStatus || 'UNKNOWN'}. Start and delivery OTP verification must be completed first.`,
      status: currentStatus || null
    });
  }

  const updatedJob = await db.updateJobStatus(jobId, 'COMPLETED');
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

  const result = await db.recordPayout(effectiveDriverId, parsedAmount);
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
        return res.status(400).json({ success: false, error: error.message });
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

app.get('/api/driver/:driverId/earnings', authenticateDriver, (req, res) => {
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

  const driverTx = (db.transactions || []).filter(t =>
    t.driverId === driver.id || t.driverId === req.driver.id || t.entityId === driver.id || t.entityId === req.driver.id
  );

  res.json({
    success: true,
    todayEarnings: driver.todayEarnings || 0,
    todayTrips: driver.todayTrips || 0,
    weeklyEarnings: driver.weeklyEarnings || 0,
    monthlyEarnings: driver.monthlyEarnings || 0,
    walletBalance: driver.walletBalance || 0,
    commissionPaidToday: driver.commissionPaidToday || 0,
    cashCollectedToday: driver.cashCollectedToday || 0,
    onlinePaidToday: driver.onlinePaidToday || 0,
    transactions: driverTx
  });
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
app.get('/api/admin/metrics', (req, res) => {
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

app.get('/api/admin/drivers', (req, res) => res.json({ success: true, drivers: db.drivers }));
app.get('/api/admin/jobs', (req, res) => res.json({ success: true, jobs: db.jobs }));
app.get('/api/admin/restaurants', (req, res) => res.json({ success: true, restaurants: db.restaurants }));

// Safe document previews
app.get('/docs/:filename', (req, res) => {
  const filename = req.params.filename || '';
  const isAadhaar = filename.includes('aadhaar');
  const isBlurry = filename.includes('blurry');

  const svgContent = `
    <svg width="600" height="380" xmlns="http://www.w3.org/2000/svg" style="font-family: Arial, sans-serif; background: #fafafa;">
      <rect width="596" height="376" x="2" y="2" rx="16" fill="${isAadhaar ? '#fff8eb' : '#edf6ff'}" stroke="${isAadhaar ? '#ea580c' : '#2563eb'}" stroke-width="3"/>
      <rect width="596" height="50" fill="${isAadhaar ? '#ea580c' : '#1e40af'}" rx="14"/>
      <text x="30" y="32" fill="#ffffff" font-size="18" font-weight="bold">${isAadhaar ? 'GOVERNMENT OF INDIA • UNIQUE IDENTIFICATION AUTHORITY' : 'ELECTION COMMISSION OF INDIA • VOTER ID CARD'}</text>
      <rect x="35" y="75" width="130" height="155" fill="#e2e8f0" stroke="#94a3b8" rx="8"/>
      <circle cx="100" cy="130" r="35" fill="#cbd5e1"/>
      <ellipse cx="100" cy="190" rx="45" ry="30" fill="#94a3b8"/>
      <text x="75" y="245" font-size="12" fill="#64748b" font-weight="bold">PHOTO</text>
      <text x="190" y="95" font-size="14" fill="#334155" font-weight="bold">Name / Name:</text>
      <text x="190" y="118" font-size="17" fill="#0f172a" font-weight="bold">RAHUL SHARMA</text>
      <text x="190" y="150" font-size="13" fill="#334155" font-weight="bold">DOB / Date of Birth: <tspan fill="#0f172a" font-weight="normal">15/08/1994</tspan></text>
      <text x="190" y="175" font-size="13" fill="#334155" font-weight="bold">Gender: <tspan fill="#0f172a" font-weight="normal">Male / MALE</tspan></text>
      <text x="190" y="200" font-size="13" fill="#334155" font-weight="bold">Address: <tspan fill="#0f172a" font-weight="normal">Flat 402, Civil Lines, North Delhi - 110054</tspan></text>
      <rect x="35" y="275" width="530" height="60" fill="#ffffff" stroke="#cbd5e1" rx="8"/>
      <text x="50" y="312" font-size="22" font-weight="bold" fill="${isAadhaar ? '#c2410c' : '#1e3a8a'}" letter-spacing="3">${isAadhaar ? 'XXXX  XXXX  4892' : 'EPIC NO: DLH1948201'}</text>
      <text x="380" y="312" font-size="12" fill="#16a34a" font-weight="bold">✓ GOVERNMENT WATERMARK</text>
      ${isBlurry ? '<filter id="blur"><feGaussianBlur stdDeviation="5"/></filter><rect width="600" height="380" fill="white" fill-opacity="0.3" filter="url(#blur)"/>' : ''}
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
    if (storeError) return res.status(400).json({ success: false, error: storeError.message });

    let storeIds = (stores || []).map((s) => s.id);
    if (req.query.merchantId) {
      storeIds = storeIds.filter((id) => id === req.query.merchantId.toString().trim());
    }
    if (!storeIds.length) {
      return res.json({ success: true, count: 0, products: [], categories: [], dataSource: 'postgres' });
    }

    let query = supabaseAdmin
      .from('merchant_grocery_inventory')
      .select('id, product_id, merchant_id, store_price, stock_quantity, is_available, status, updated_at, master_grocery_catalog(id, name, category, subcategory, brand, standard_unit, pack_size, standard_image_url, description, pricing_model), merchants(id, name, is_open)')
      .in('merchant_id', storeIds);
    if (category && category !== 'All') query = query.eq('master_grocery_catalog.category', category);

    const { data, error } = await query.order('store_price', { ascending: true });
    if (error) return res.status(400).json({ success: false, error: error.message });

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

// Get Specific Product Price History Audit Trail
app.get('/api/grocery/products/:id/history', (req, res) => {
  const history = db.getGroceryPriceHistory(req.params.id);
  res.json({ success: true, productId: req.params.id, history });
});

// Single Merchant Price Update
app.put('/api/grocery/products/:id/price', authenticateMerchant, requireMerchantTenant, (req, res) => {
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

// Accepts both PostgreSQL (snake_case) rows and legacy fixture (camelCase) rows so
// the degraded path cannot diverge from the live one. `phone` is never projected.
const projectRestaurantForCustomer = (row) => {
  const lat = row.lat ?? row.location?.lat;
  const lng = row.lng ?? row.location?.lng;
  return {
    id: row.id,
    name: row.name,
    merchantType: row.merchant_type ?? row.merchantType ?? null,
    address: row.address ?? null,
    cuisines: row.cuisines ?? [],
    rating: row.rating === null || row.rating === undefined ? null : Number(row.rating),
    deliveryTime: row.deliveryTime ?? null,
    isOpen: (row.is_open ?? row.isOpen) === true,
    location: lat === undefined || lat === null || lng === undefined || lng === null
      ? null
      : { lat: Number(lat), lng: Number(lng) }
  };
};

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
  const openOnly = req.query.openNow === 'true' || req.query.openNow === '1';
  const { supabaseAdmin, isLivePostgres } = require('./supabase');

  if (!isLivePostgres || !supabaseAdmin) {
    const fixtures = db.restaurants
      .filter((r) => (openOnly ? r.isOpen === true : true))
      .filter((r) => (search ? r.name.toLowerCase().includes(search.toLowerCase()) : true))
      .map(projectRestaurantForCustomer);
    return res.json({ success: true, count: fixtures.length, restaurants: fixtures, degraded: true });
  }

  try {
    let query = supabaseAdmin
      .from('merchants')
      .select('id, name, merchant_type, address, lat, lng, is_open, rating')
      .in('merchant_type', RESTAURANT_TYPES)
      .order('rating', { ascending: false })
      .order('name', { ascending: true });

    if (openOnly) query = query.eq('is_open', true);
    if (search) query = query.ilike('name', likePattern(search));

    const { data, error } = await query;
    if (error) return res.status(400).json({ success: false, error: error.message });

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
    .select('id, name, merchant_type, address, lat, lng, is_open, rating')
    .eq('id', req.params.id)
    .in('merchant_type', RESTAURANT_TYPES)
    .maybeSingle();
  if (error) return res.status(400).json({ success: false, error: error.message });
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
  if (error) return res.status(400).json({ success: false, error: error.message });

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
app.get('/api/admin/master-catalog', authenticateAdmin, (req, res) => {
  const masterProducts = db.getMasterProducts();
  res.json({ success: true, count: masterProducts.length, masterProducts });
});

app.post('/api/admin/master-catalog', authenticateAdmin, (req, res) => {
  try {
    const product = db.addMasterProduct(req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_ADDED', product });
    res.json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/master-catalog/:id', authenticateAdmin, (req, res) => {
  try {
    const updated = db.updateMasterProduct(req.params.id, req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_UPDATED', product: updated });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/master-catalog/:id', authenticateAdmin, (req, res) => {
  try {
    const deleted = db.deleteMasterProduct(req.params.id);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_DELETED', id: req.params.id });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/master-catalog/:id/stores', authenticateAdmin, (req, res) => {
  try {
    const matrix = db.getMasterProductStoreMatrix(req.params.id);
    res.json({ success: true, ...matrix });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- MERCHANT STORE INVENTORY ENDPOINTS ---
app.get('/api/merchant/inventory', authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const merchantId = req.merchant.id;
    const inventory = await db.getMerchantInventory(merchantId);
    res.json({ success: true, merchantId, count: inventory.length, inventory });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post('/api/merchant/inventory', authenticateMerchant, requireMerchantTenant, async (req, res) => {
  try {
    const item = await db.updateMerchantInventoryItem({ ...req.body, merchantId: req.merchant.id });
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- MERCHANT CATALOGUE READS (PostgreSQL authoritative) ---
// The legacy in-memory menu is a different store from the `products` table that the
// order path resolves against, so merchant clients read the real catalogue here.
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
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, merchantId: merchant.id, count: (data || []).length, products: data || [] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Master grocery catalogue the merchant may stock in their store.
app.get('/api/merchant/master-catalog', authenticateMerchant, requireMerchantTenant, async (req, res) => {
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
    if (error) return res.status(400).json({ success: false, error: error.message });
    res.json({ success: true, count: (data || []).length, products: data || [] });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Bulk Merchant Price Update
app.post('/api/grocery/products/bulk-price-update', authenticateMerchant, requireMerchantTenant, (req, res) => {
  try {
    const { updates, actor } = req.body;
    const merchantId = req.merchant.id;
    const results = db.bulkUpdateGroceryPrices({ updates, merchantId, actor });
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
      .map((item) => (item.productId || item.id || '').toString().trim())
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)))];

    const inventoryById = new Map();
    if (requestedIds.length) {
      const { data, error } = await supabaseAdmin
        .from('merchant_grocery_inventory')
        .select('id, product_id, merchant_id, store_price, stock_quantity, is_available, status, master_grocery_catalog(id, name, standard_unit, pricing_model)')
        .or(`id.in.(${requestedIds.join(',')}),product_id.in.(${requestedIds.join(',')})`);
      if (error) return res.status(400).json({ success: false, error: error.message });
      for (const row of data || []) {
        inventoryById.set(row.id, row);
        if (row.product_id && !inventoryById.has(row.product_id)) inventoryById.set(row.product_id, row);
      }
    }

    let priceChanged = false;
    const items = cartItems.map((item) => {
      const sentId = (item.productId || item.id || '').toString().trim();
      const row = inventoryById.get(sentId);
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

    const idempotencyKey = req.headers['idempotency-key'] || req.body.idempotencyKey || null;

    let checkoutId = req.body.checkoutId || req.body.checkout_id || null;
    if (!checkoutId && idempotencyKey) {
      const existingToken = await db.orderRepo.getIdempotencyToken(idempotencyKey);
      if (existingToken?.order?.checkout_id) {
        checkoutId = existingToken.order.checkout_id;
      }
    }

    if (!checkoutId) {
      // Auto-provision PostgreSQL checkout row to guarantee checkout linkage
      const newCheckout = await db.orderRepo.createCheckoutSession({
        customerId: customerUuid,
        merchantId: merchant.id,
        serviceType: 'GROCERY',
        paymentMethod: req.body.paymentMethod === 'CASH' ? 'CASH' : 'WALLET',
        baseAmount: resolved.totalAmount,
        finalPayableAmount: resolved.totalAmount,
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
      totalAmount: resolved.totalAmount,
      items: resolved.lines,
      metadata: {
        deliveryAddress: req.body.deliveryAddress || 'Default Address',
        deliveryInstructions: req.body.deliveryInstructions || null
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
      estimatedSubtotal: Number(dbOrder.total_amount),
      finalSubtotal: Number(dbOrder.total_amount),
      finalTotal: Number(dbOrder.total_amount),
      discount: 0,
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
    const statusCode = err.statusCode || (err.code === 'MERCHANT_MISMATCH' ? 400 : 409);
    res.status(statusCode).json({
      success: false,
      code: err.code || 'CHECKOUT_FAILED',
      error: err.message
    });
  }
});

// Merchant Submit Actual Packed Weight & Recalculate Order Total (PostgreSQL Authoritative)
app.post('/api/grocery/orders/:id/packed-weight', authenticateMerchant, requireMerchantTenant, async (req, res) => {
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
    res.status(err.statusCode || 400).json({ success: false, error: err.message });
  }
});

// Admin Order State Maintenance: Trigger Expire Stale Orders (Migration 018 timeout authority)
app.post('/api/admin/orders/expire-stale', authenticateAdmin, async (req, res) => {
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
app.post('/api/admin/grocery/products/:id/review', authenticateAdmin, (req, res) => {
  try {
    const { action, newPrice, reason } = req.body;
    const product = db.adminReviewPrice({
      productId: req.params.id,
      action,
      newPrice,
      reason,
      adminUser: req.admin
    });
    res.json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Supabase Database Connection & Status Check API
app.get('/api/admin/supabase-status', async (req, res) => {
  const status = await supabaseHelper.checkSupabaseConnection();
  res.json({
    success: true,
    supabase: status,
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

    const { data, error } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();

    let newValue = { enabled: req.body.enabled, description: req.body.description };
    if (data && data.setting_value) {
      newValue = { ...data.setting_value, ...newValue };
    }

    await supabaseHelper.supabaseAdmin.from('platform_settings')
      .upsert({
        setting_key: key,
        setting_value: newValue,
        updated_by: req.admin?.id || 'admin',
        updated_at: new Date().toISOString()
      }, { onConflict: 'setting_key' });

    featureControlService.invalidateCache();
    res.json({ success: true, featureFlag: { key, ...newValue } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update feature' });
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

    const { data, error } = await supabaseHelper.supabaseAdmin.from('platform_settings')
      .select('setting_value')
      .eq('setting_key', key)
      .maybeSingle();
      
    if (error || !data) {
      return res.status(404).json({ success: false, error: 'Feature key not found' });
    }

    const newValue = {
      ...data.setting_value,
      ...(enabled !== undefined ? { enabled } : {}),
      ...(location_overrides ? { location_overrides } : {})
    };

    await supabaseHelper.supabaseAdmin.from('platform_settings')
      .update({
        setting_value: newValue,
        updated_by: req.admin?.id || 'admin',
        updated_at: new Date().toISOString()
      })
      .eq('setting_key', key);

    featureControlService.invalidateCache();
    res.json({ success: true, feature: { setting_key: key, setting_value: newValue } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update feature' });
  }
});

// =========================================================================
// HIGH-FREQUENCY LIVE FLEET TELEMETRY & SCOPED TRACKING (v1)
// =========================================================================

app.post(['/api/v1/driver/location', '/api/driver/location'], authenticateDriver, (req, res) => {
  const { driverId, lat, lng, latitude, longitude, heading, bearing, speed, speedKmph, jobId, activeJobId, isOnline, status, serviceType } = req.body;
  const effectiveLat = lat !== undefined ? lat : latitude;
  const effectiveLng = lng !== undefined ? lng : longitude;

  if (effectiveLat === undefined || effectiveLng === undefined) {
    return res.status(400).json({ success: false, code: 'INVALID_COORDINATES', message: 'lat and lng are required.' });
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

  // Active job authorization: cannot attach telemetry to a job not assigned to this driver
  if (targetJobId) {
    const job = db.getJob(targetJobId);
    if (job) {
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
  }

  // Update in-memory / Redis fast store (Never writing raw high-frequency telemetry to PostgreSQL)
  const locationRecord = db.updateDriverLocation({
    driverId: effectiveDriverId,
    lat: effectiveLat,
    lng: effectiveLng,
    heading: heading || bearing,
    speed: speed || speedKmph,
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
      location: locationRecord
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
    const driverLocation = effectiveDriverId ? (db.getDriverLocation(effectiveDriverId) || {
      driverId: effectiveDriverId,
      lat: 28.6853,
      lng: 77.2185,
      heading: 90.0,
      speed: 28.5
    }) : null;

    const driverObj = effectiveDriverId ? (db.getDriver(effectiveDriverId) || { id: effectiveDriverId, name: job.driverName || 'Rajesh Kumar', phone: '+91 98101 22334' }) : null;

    res.json({
      success: true,
      jobId: job.id,
      status: job.status,
      type: job.type || job.serviceType,
      channel: (job.type || job.serviceType) === 'RIDE' ? `ride:${job.id}` : `delivery:${job.id}`,
      driver: driverObj ? { id: driverObj.id || effectiveDriverId, name: driverObj.name || 'Rajesh Kumar', phone: driverObj.phone || '+91 98101 22334' } : null,
      location: driverLocation,
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

    const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_nabin_secure_beta_2026';
    if (!process.env.PAYMENT_WEBHOOK_SECRET && process.env.NODE_ENV === 'production') {
      return res.status(500).json({
        success: false,
        error: 'Payment webhook secret unconfigured in production environment.',
        code: 'WEBHOOK_CONFIG_MISSING',
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
app.get('/api/admin/finance/ledger-double-entry', authenticateAdmin, requirePermission('finance.view'), (req, res) => {
  const filters = {
    account: req.query.account || null,
    transactionId: req.query.transactionId || null
  };
  const entries = db.getLedgerEntries(filters);
  res.json({ success: true, entries, total: entries.length });
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
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

    if (!token && !isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required to delete media assets.' });
    }

    const existing = db.getMediaAsset(rawPublicId);
    if (token) {
      const session = db.getSessionByToken(token);
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
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

    let callerCustomerId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'CUSTOMER' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Customer or Admin authorization required.' });
      }
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
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

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
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

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
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

    let callerMerchantId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'MERCHANT' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Merchant or Admin authorization required.' });
      }
      callerMerchantId = session.entityId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for merchant media upload.' });
    }

    const restaurantId = req.params.restaurantId || req.body.restaurantId || callerMerchantId || 'rest_1';
    if (callerMerchantId && restaurantId !== callerMerchantId) {
      const session = db.getSessionByToken(token);
      if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, code: 'MERCHANT_MISMATCH', error: 'Forbidden: Cannot upload media for another restaurant.' });
      }
    }

    const { fileData, mediaType = 'COVER', mimeType = 'image/jpeg' } = req.body;
    // Phase 8: Fail-closed (DEC-005) — no fallback to first restaurant
    const rest = db.restaurants.find(r => r.id === restaurantId);
    if (!rest) return res.status(404).json({ success: false, code: 'RESTAURANT_NOT_FOUND', error: 'Restaurant not found.', requestId: req.id });

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
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

    let callerMerchantId = null;
    if (token) {
      const session = db.getSessionByToken(token);
      if (!session || (session.role !== 'MERCHANT' && session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN')) {
        return res.status(403).json({ success: false, code: 'FORBIDDEN', error: 'Merchant or Admin authorization required.' });
      }
      callerMerchantId = session.entityId;
    } else if (!isTestOrDev) {
      return res.status(401).json({ success: false, code: 'AUTH_REQUIRED', error: 'Authentication required for menu photo upload.' });
    }

    const restaurantId = req.params.restaurantId || req.body.restaurantId || callerMerchantId || 'rest_1';
    if (callerMerchantId && restaurantId !== callerMerchantId) {
      const session = db.getSessionByToken(token);
      if (session?.role !== 'ADMIN' && session?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ success: false, code: 'MERCHANT_MISMATCH', error: 'Forbidden: Cannot upload photo for another restaurant.' });
      }
    }

    const itemId = req.params.itemId || req.body.itemId || 'item_1';
    const { fileData, mimeType = 'image/jpeg' } = req.body;

    const folder = `nabin/restaurants/${restaurantId}/menu`;
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
    const productId = req.params.id || req.body.productId;
    const { fileData, mimeType = 'image/jpeg' } = req.body;

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
    if (!product) {
      product = {
        id: productId,
        sku: productId,
        name: 'Grocery Product Item',
        imageUrl: uploadRes.optimized_urls?.medium || uploadRes.secure_url,
        thumbnailUrl: uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url
      };
      if (!db.groceryCatalog) db.groceryCatalog = [];
      db.groceryCatalog.push(product);
    } else {
      product.imageUrl = uploadRes.optimized_urls?.medium || uploadRes.secure_url;
      product.thumbnailUrl = uploadRes.optimized_urls?.thumbnail || uploadRes.secure_url;
    }
    db.save();

    res.json({ success: true, productId, product, asset: savedAsset });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// 9. Parcel Delivery Proof Photo Upload
app.post('/api/parcel/:id/delivery-proof', async (req, res) => {
  try {
    const parcelId = req.params.id || req.body.parcelId;
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/, '').trim();
    const isTestOrDev = process.env.NODE_ENV !== 'production' || process.env.NABIN_TEST_MODE === 'true';

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
