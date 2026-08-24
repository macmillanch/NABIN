require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const db = require('./database');
const supabaseHelper = require('./supabase');
const cloudinaryService = require('./services/cloudinaryService');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Environment-Specific Whitelisted CORS
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:4000',
  'http://localhost:5000',
  'http://localhost:5173',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
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
  req.id = req.headers['x-request-id'] || `req_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  res.setHeader('X-Request-Id', req.id);
  next();
});

app.use(express.json());

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
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ONLINE',
    service: 'NABIN Unified Multi-App Backend',
    version: '1.1.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    activeDrivers: db.drivers.filter(d => d.isOnline).length,
    activeJobs: db.jobs.filter(j => j.status !== 'COMPLETED').length,
    pendingIdentityVerifications: db.identityApplications.filter(a => a.status === 'IDENTITY_VERIFICATION_PENDING').length
  });
});

app.get('/api/ready', (req, res) => {
  const status = db.getServicesStatus();
  const ready = status.summary.platformStatus !== 'EMERGENCY_LOCKDOWN';
  res.status(ready ? 200 : 503).json({
    ready,
    platformStatus: status.summary.platformStatus,
    services: status.summary,
    timestamp: new Date().toISOString()
  });
});

// Track Connected WebSocket Clients with Authentication Handshake
const clients = new Map();

wss.on('connection', (ws, req) => {
  ws.isAuthenticated = false;
  ws.authInfo = null;

  // Handshake Token Check
  if (req && req.url) {
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const handshakeToken = urlObj.searchParams.get('token');
      if (handshakeToken) {
        const session = db.getSessionByToken(handshakeToken);
        if (session) {
          ws.isAuthenticated = true;
          ws.authInfo = { role: session.role.toLowerCase(), id: session.entityId, entity: session.entity };
          clients.set(ws, ws.authInfo);
          ws.send(JSON.stringify({ type: 'AUTHENTICATED', role: session.role, id: session.entityId }));
        }
      }
    } catch (e) {}
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'AUTHENTICATE' || data.type === 'REGISTER') {
        const token = data.token;
        if (token) {
          const session = db.getSessionByToken(token);
          if (session) {
            ws.isAuthenticated = true;
            ws.authInfo = { role: session.role.toLowerCase(), id: session.entityId, entity: session.entity };
            clients.set(ws, ws.authInfo);
            ws.send(JSON.stringify({ type: 'AUTHENTICATED', role: session.role, id: session.entityId }));
            return;
          }
        }
        ws.send(JSON.stringify({ type: 'AUTH_ERROR', error: 'WebSocket authentication rejected: Valid session token required.' }));
      } else if (data.type === 'DRIVER_LOCATION_UPDATE') {
        const driverId = (ws.authInfo && ws.authInfo.role === 'driver') ? ws.authInfo.id : (data.driverId || 'DRV-101');
        const driver = db.getDriver(driverId);
        if (driver && data.location) {
          driver.location = data.location;
        }
      }
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  ws.on('close', () => {
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
    req.user = null;
    req.session = null;
    return next();
  }

  const session = db.getSessionByToken(token);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or expired customer session token. Please log in.',
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
  if (driver && driver.operationalStatus === 'SUSPENDED') {
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

  req.merchant = session.entity || db.restaurants[0];
  req.session = session;
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
app.post('/api/auth/verify-otp', (req, res) => {
  try {
    const { phone, otp, role = 'CUSTOMER', purpose = 'LOGIN' } = req.body;
    const result = db.verifyAuthOtp({ phone, otp, role, purpose });
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
    token: session.token,
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
  res.json({ success: true, valid: true, session });
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

app.post('/api/admin/services/pause', authenticateAdmin, requirePermission('services.pause'), (req, res) => {
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

app.post('/api/admin/services/resume', authenticateAdmin, requirePermission('services.resume'), (req, res) => {
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

app.post('/api/admin/services/emergency-killswitch', authenticateAdmin, requirePermission('services.emergency_killswitch'), (req, res) => {
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
  app.post('/api/admin/bootstrap', (req, res) => {
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
    
    // We intentionally evaluate the secret using timing-safe string comparison to prevent timing attacks
    // But since this is a simple script, a standard comparison is fine as a first pass, 
    // however, a generic error must be returned regardless of what failed.
    const isSecretValid = process.env.ADMIN_BOOTSTRAP_SECRET && bootstrapSecret === process.env.ADMIN_BOOTSTRAP_SECRET;
    
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
    db.createAuditLog({ action: 'ADMIN_BOOTSTRAP', module: 'SECURITY', adminId: 'SYSTEM', details: 'First SUPER_ADMIN account securely bootstrapped.', ip });
    
    // Save to persistent storage if available
    const persistentStore = require('./database/persistentStore');
    persistentStore.saveStateSync(db);

    res.json({ success: true, message: 'Administrator bootstrapped successfully.' });
  });

// Admin Login with Brute-Force Protection & Password Hashing Verification
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Username and password are required.', requestId: req.id });
  }

  const authResult = db.verifyAdminCredentials(username, password);
  if (!authResult.success) {
    db.createAuditLog({
      adminId: 'UNKNOWN',
      adminName: username || 'Unknown',
      role: 'GUEST',
      action: 'LOGIN_FAILED',
      module: 'AUTH',
      targetEntityType: 'ADMIN_SESSION',
      targetEntityId: 'LOGIN',
      previousState: 'UNAUTHENTICATED',
      newState: 'FAILED',
      reason: `Failed login attempt for username: ${username}. Detail: ${authResult.error}`
    });

    return res.status(authResult.locked ? 429 : 401).json({
      success: false,
      error: authResult.error,
      requestId: req.id
    });
  }

  const admin = authResult.admin;
  const token = `adm_token_${Date.now()}_${crypto.randomBytes(16).toString('hex')}`;
  const session = {
    token,
    role: admin.role,
    entityId: admin.id,
    entity: admin,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString()
  };

  activeAdminSessions.set(token, admin);
  db.activeSessions.set(token, session);

  db.createAuditLog({
    adminId: admin.id,
    adminName: admin.name,
    role: admin.role,
    action: 'ADMIN_LOGIN',
    module: 'AUTH',
    targetEntityType: 'ADMIN_SESSION',
    targetEntityId: admin.id,
    previousState: 'OFFLINE',
    newState: 'ONLINE',
    reason: `Admin login successful. Role: ${admin.role}`
  });

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

// Admin Password Recovery & Reset
app.post('/api/admin/reset-password', (req, res) => {
  try {
    const { identifier, newPassword } = req.body;
    const result = db.resetAdminPassword({ identifier, newPassword });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/me', authenticateAdmin, (req, res) => {
  res.json({ success: true, admin: req.admin });
});

// -------------------------------------------------------------
// 1. GLOBAL ADMINISTRATIVE AUDIT LOG TRAIL
// -------------------------------------------------------------
app.get('/api/admin/audit-logs', authenticateAdmin, requirePermission('audit.view'), (req, res) => {
  const filters = {
    module: req.query.module || 'ALL',
    action: req.query.action || 'ALL',
    adminId: req.query.adminId || 'ALL',
    search: req.query.search || '',
    applicationId: req.query.applicationId || null
  };
  const logs = db.getAuditLogs(filters);
  res.json({ success: true, logs, total: logs.length });
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

app.post('/api/admin/drivers/:id/status', authenticateAdmin, (req, res) => {
  const { status, reason } = req.body;
  const driver = (db.drivers || []).find(d => d.id === req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });
  
  const prev = driver.operationalStatus || 'ACTIVE';
  driver.operationalStatus = status;
  driver.driverState = status === 'SUSPENDED' ? 'SUSPENDED' : 'ONLINE';
  driver.isOnline = status !== 'SUSPENDED';

  db.createAuditLog({
    adminId: req.admin.id,
    adminName: req.admin.name,
    role: req.admin.role,
    action: status === 'SUSPENDED' ? 'DRIVER_SUSPENDED' : 'DRIVER_ACTIVATED',
    module: 'FLEET',
    targetEntityType: 'DRIVER',
    targetEntityId: driver.id,
    previousState: prev,
    newState: status,
    reason: reason || `Driver status updated to ${status}`
  });

  res.json({ success: true, driver });
});

// -------------------------------------------------------------
// 2. SUPPORT & DISPUTE RESOLUTION
// -------------------------------------------------------------
app.post('/api/support/ticket', (req, res) => {
  const ticket = db.createSupportTicket(req.body);
  broadcastToAdmins({ type: 'NEW_SUPPORT_TICKET', ticket });
  res.json({ success: true, ticket });
});

app.get('/api/support/user/:userId', (req, res) => {
  const tickets = db.supportTickets.filter(t => t.userId === req.params.userId);
  res.json({ success: true, tickets });
});

app.post('/api/support/ticket/:id/message', (req, res) => {
  const { senderRole, senderName, text, attachments } = req.body;
  const result = db.addTicketMessage(req.params.id, senderRole || 'CUSTOMER', senderName || 'User', text, attachments);
  if (!result.success) return res.status(400).json(result);
  
  broadcastToAdmins({ type: 'TICKET_THREAD_UPDATED', ticketId: req.params.id });
  res.json(result);
});

app.get('/api/admin/support', authenticateAdmin, requirePermission('support.view'), (req, res) => {
  const filters = {
    status: req.query.status || 'ALL',
    category: req.query.category || 'ALL',
    priority: req.query.priority || 'ALL',
    search: req.query.search || ''
  };
  const tickets = db.getSupportTickets(filters);
  res.json({ success: true, tickets, total: tickets.length });
});

app.post('/api/admin/support/:id/assign', authenticateAdmin, requirePermission('support.respond'), (req, res) => {
  const result = db.assignSupportTicket(req.params.id, req.admin.id, req.admin.name);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/admin/support/:id/resolve', authenticateAdmin, requirePermission('support.resolve'), (req, res) => {
  const { resolutionNotes, refundAmount, specializedData } = req.body;
  const result = db.resolveSupportTicket(
    req.params.id,
    resolutionNotes,
    refundAmount,
    req.admin.id,
    req.admin.name,
    specializedData || req.body
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

app.post('/api/admin/finance/settlements/drivers/:id/payout', authenticateAdmin, requirePermission('finance.settlement'), (req, res) => {
  const driver = db.getDriver(req.params.id);
  if (!driver) return res.status(404).json({ success: false, error: 'Driver not found' });
  const amount = Number(req.body.amount) || driver.walletBalance;

  const result = db.recordPayout(driver.id, amount, driver.upiId);
  if (result.success) {
    db.createAuditLog({
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

app.post('/api/admin/finance/adjustments', authenticateAdmin, requirePermission('finance.adjust'), (req, res) => {
  const { targetType, targetId, direction, amount, reason } = req.body;
  const result = db.processFinancialAdjustment(targetType, targetId, direction, amount, reason, req.admin.id, req.admin.name);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/admin/finance/refund', authenticateAdmin, requirePermission('finance.refund'), (req, res) => {
  const { jobId, customerId, amount, reason } = req.body;
  const amt = Number(amount);
  if (!amt || amt <= 0) return res.status(400).json({ success: false, error: 'Invalid refund amount.' });

  const existingRefund = db.transactions.find(t => t.type === 'WALLET_REFUND' && t.jobId === jobId);
  if (existingRefund) {
    return res.status(400).json({ success: false, error: `Refund already processed for job ${jobId}.` });
  }

  const user = db.getUser(customerId || 'usr_1');
  user.walletBalance = (user.walletBalance || 0) + amt;

  const refundTxn = {
    id: `TXN-REF-${Date.now().toString().slice(-4)}`,
    type: 'WALLET_REFUND',
    jobId,
    userId: user.id,
    userRole: 'CUSTOMER',
    title: `Admin Refund for Job ${jobId}: ${reason}`,
    amount: amt,
    platformFee: 0,
    commission: 0,
    deliveryFee: 0,
    net: amt,
    paymentMode: 'WALLET_CREDIT',
    paymentStatus: 'SUCCESS',
    settlementStatus: 'SETTLED',
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' Today'
  };

  db.transactions.unshift(refundTxn);

  db.recordLedgerEntry({
    transactionId: refundTxn.id,
    debitAccount: 'CUSTOMER_WALLET_LIABILITY',
    creditAccount: 'PAYMENT_GATEWAY_ESCROW',
    amount: amt,
    description: `Admin Refund for Job ${jobId}: ${reason}`,
    referenceId: jobId
  });

  db.createAuditLog({
    adminId: req.admin.id,
    adminName: req.admin.name,
    role: req.admin.role,
    action: 'REFUND_PROCESSED',
    module: 'FINANCE',
    targetEntityType: 'CUSTOMER_REFUND',
    targetEntityId: user.id,
    previousState: 'CHARGED',
    newState: `REFUNDED_₹${amt}`,
    reason: reason || `Admin refund of ₹${amt} issued for job ${jobId}`
  });

  res.json({ success: true, refund: refundTxn, updatedWalletBalance: user.walletBalance });
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
app.get('/api/admin/promotions', (req, res) => {
  res.json({ success: true, promotions: db.promotions });
});

app.post('/api/admin/promotions', authenticateAdmin, requirePermission('promotion.create'), (req, res) => {
  const promo = db.createPromotion(req.body, req.admin.id, req.admin.name);
  res.json({ success: true, promotion: promo });
});

app.put('/api/admin/promotions/:id', authenticateAdmin, requirePermission('promotion.edit'), (req, res) => {
  const promo = db.promotions.find(p => p.id === req.params.id);
  if (!promo) return res.status(404).json({ success: false, error: 'Promotion not found' });

  const prevStatus = promo.status;
  if (req.body.status !== undefined) promo.status = req.body.status;
  if (req.body.discountValue !== undefined) promo.discountValue = Number(req.body.discountValue);

  db.createAuditLog({
    adminId: req.admin.id,
    adminName: req.admin.name,
    role: req.admin.role,
    action: 'PROMOTION_UPDATED',
    module: 'PROMOTIONS',
    targetEntityType: 'PROMOTION',
    targetEntityId: promo.id,
    previousState: prevStatus,
    newState: promo.status,
    reason: `Promotion ${promo.code} updated.`
  });

  res.json({ success: true, promotion: promo });
});

app.post('/api/promotions/apply', (req, res) => {
  const { code, orderAmount, service } = req.body;
  const result = db.validateAndApplyCoupon(code, orderAmount, service);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

// -------------------------------------------------------------
// ADVERTISEMENTS & SPONSORED CAMPAIGNS API
// -------------------------------------------------------------
app.get('/api/advertisements', (req, res) => {
  const { slot, service } = req.query;
  const ads = db.getAdvertisements({ slot, service, activeOnly: true });

  // Record impressions
  ads.forEach(ad => db.recordAdImpression(ad.id));

  res.json({ success: true, count: ads.length, advertisements: ads });
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
// 5. GEO-FENCING & DYNAMIC SURGE ZONES
// -------------------------------------------------------------
app.get('/api/admin/geofences', (req, res) => {
  res.json({ success: true, geoFences: db.geoFences });
});

app.post('/api/admin/geofences', authenticateAdmin, requirePermission('geofence.create'), (req, res) => {
  const fence = db.addGeoFence(req.body, req.admin.id, req.admin.name);
  res.json({ success: true, geoFence: fence });
});

app.delete('/api/admin/geofences/:id', authenticateAdmin, requirePermission('geofence.delete'), (req, res) => {
  const idx = db.geoFences.findIndex(g => g.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Geo-fence not found' });
  const deleted = db.geoFences.splice(idx, 1)[0];

  db.createAuditLog({
    adminId: req.admin.id,
    adminName: req.admin.name,
    role: req.admin.role,
    action: 'GEOFENCE_DELETED',
    module: 'GEOFENCING',
    targetEntityType: 'GEOFENCE',
    targetEntityId: deleted.id,
    previousState: 'ACTIVE',
    newState: 'DELETED',
    reason: `Geo-fence zone ${deleted.name} deleted.`
  });

  res.json({ success: true, deleted });
});

app.get('/api/admin/surgezones', (req, res) => {
  res.json({ success: true, surgeZones: db.surgeZones });
});

app.post('/api/admin/surgezones', authenticateAdmin, requirePermission('surge.create'), (req, res) => {
  const surge = db.addSurgeZone(req.body, req.admin.id, req.admin.name);
  res.json({ success: true, surgeZone: surge });
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

app.get('/api/admin/pricing', authenticateAdmin, (req, res) => {
  res.json({ success: true, pricingConfig: db.pricingConfig });
});

app.post('/api/admin/pricing', authenticateAdmin, requirePermission('pricing.edit'), (req, res) => {
  const { globalSurgeMultiplier, activeSurgeZone, serviceType, baseFare, perKmRate, commissionPercent } = req.body;

  if (globalSurgeMultiplier !== undefined) db.pricingConfig.globalSurgeMultiplier = Number(globalSurgeMultiplier);
  if (activeSurgeZone !== undefined) db.pricingConfig.activeSurgeZone = activeSurgeZone;

  if (serviceType && db.pricingConfig[serviceType]) {
    if (baseFare !== undefined) db.pricingConfig[serviceType].baseFare = Number(baseFare);
    if (perKmRate !== undefined) db.pricingConfig[serviceType].perKmRate = Number(perKmRate);
    if (commissionPercent !== undefined) db.pricingConfig[serviceType].commissionPercent = Number(commissionPercent);
  }

  db.createAuditLog({
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

  res.json({ success: true, pricingConfig: db.pricingConfig, message: 'Platform pricing updated.' });
});

// -------------------------------------------------------------
// MANUAL IDENTITY VERIFICATION API
// -------------------------------------------------------------
app.post('/api/identity/submit', (req, res) => {
  const { userId, name, phone, email, dob, address, aadhaarNumber, aadhaarDocUrl, voterIdNumber, voterIdDocUrl, isResubmission } = req.body;

  if (!aadhaarNumber || aadhaarNumber.toString().replace(/\D/g, '').length < 12) {
    return res.status(400).json({ success: false, error: 'A valid 12-digit Aadhaar number is required.' });
  }
  if (!voterIdNumber || voterIdNumber.toString().trim().length < 5) {
    return res.status(400).json({ success: false, error: 'A valid Voter ID (EPIC) number is required.' });
  }

  const result = db.submitIdentityApplication({
    userId,
    name,
    phone,
    email,
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

app.get('/api/identity/status/:userId', (req, res) => {
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

app.get('/api/admin/identity-verifications/:id', authenticateAdmin, requirePermission('identity_verification.view'), (req, res) => {
  const appRecord = db.getIdentityApplicationById(req.params.id);
  if (!appRecord) return res.status(404).json({ success: false, error: 'Application not found' });

  const canViewUnmasked = req.admin.role === 'SUPER_ADMIN' ||
    (req.admin.permissions && req.admin.permissions.includes('identity_documents.view'));

  res.json({
    success: true,
    application: {
      ...appRecord,
      aadhaarNumberRaw: canViewUnmasked ? appRecord.aadhaarNumberRaw : undefined,
      voterIdNumberRaw: canViewUnmasked ? appRecord.voterIdNumberRaw : undefined
    },
    auditLogs: db.getAuditLogs({ applicationId: appRecord.id })
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
app.post('/api/customer/book-ride', authenticateUser, (req, res) => {
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

  const { customerId, vehicleType, pickup, drop, promoCode, zoneId, bookingType, passengerCategory, passengerInfo } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
  if (idempotencyKey) {
    const existing = db.jobs.find(j => j.idempotencyKey === idempotencyKey);
    if (existing) {
      return res.json({ success: true, job: existing, duplicate: true });
    }
  }

  const user = (customerId ? db.getUser(customerId) : req.user) || db.getUser('usr_1');

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

  const job = db.createJob({
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
      startOtp: job.startOtp,
      isForSomeoneElse: job.isForSomeoneElse,
      isSchoolChild: isSchoolChild,
      childName: passengerInfo?.childName,
      schoolName: passengerInfo?.schoolName,
      gradeClass: passengerInfo?.gradeClass,
      section: passengerInfo?.section,
      specialInstructions: passengerInfo?.specialInstructions,
    }
  });

  res.json({ success: true, job });
});

app.post('/api/customer/book-parcel', authenticateUser, (req, res) => {
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

  const { customerId, senderDetails, recipientDetails, promoCode } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
  if (idempotencyKey) {
    const existing = db.jobs.find(j => j.idempotencyKey === idempotencyKey);
    if (existing) {
      return res.json({ success: true, job: existing, duplicate: true });
    }
  }

  const user = req.user || db.getUser(customerId || 'usr_2');
  
  // Authoritative server-side pricing
  const pricing = db.calculateFareEstimate({
    serviceType: 'PARCEL',
    distanceKm: 6.1,
    durationMins: 18,
    promoCode
  });

  const job = db.createJob({
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
      startOtp: job.startOtp,
      deliveryOtp: job.deliveryOtp,
      packageDetails: 'Electronics Box (1.4 kg, Fragile)'
    }
  });

  res.json({ success: true, job });
});

app.post('/api/customer/book-food', authenticateUser, (req, res) => {
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

  const { customerId, restaurantId, items, deliveryAddress, promoCode } = req.body;
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.body.idempotencyKey;
  if (idempotencyKey) {
    const existing = db.jobs.find(j => j.idempotencyKey === idempotencyKey);
    if (existing) {
      return res.json({ success: true, job: existing, duplicate: true });
    }
  }

  const rest = db.restaurants.find(r => r.id === (restaurantId || 'rest_1')) || db.restaurants[0];

  if (rest.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      error: `Restaurant ${rest.name} is temporarily suspended by NABIN Admin and cannot accept new orders.`
    });
  }

  const user = req.user || db.getUser(customerId || 'usr_2');
  const deliveryPricing = db.calculateFareEstimate({ serviceType: 'FOOD', distanceKm: 3.0, durationMins: 12, promoCode });
  
  // Calculate exact item total based on menu
  let foodTotal = 220.0;
  if (items && Array.isArray(items)) {
    foodTotal = items.reduce((sum, itm) => {
      const match = rest.menu.find(m => itm.includes(m.name));
      return sum + (match ? match.price : 150);
    }, 0);
    if (foodTotal <= 0) foodTotal = 220.0;
  }

  const packagingFee = 15.0;
  const gst = Math.round((foodTotal + deliveryPricing.customerCharge) * 0.05);
  const finalTotal = foodTotal + deliveryPricing.customerCharge + packagingFee + gst;

  const job = db.createJob({
    type: 'FOOD',
    idempotencyKey: idempotencyKey || null,
    restaurantId: rest.id,
    restaurantName: rest.name,
    customerId: user.id,
    customerName: user.name,
    customerPhone: user.phone,
    pickup: { address: `${rest.name}, ${rest.address}` },
    drop: { address: deliveryAddress || 'North Campus Girls Hostel, Delhi' },
    distance: '3.0 km',
    duration: '12 mins',
    fare: finalTotal,
    deliveryFee: deliveryPricing.customerCharge,
    foodSubtotal: foodTotal,
    packagingFee,
    gst,
    driverEarnings: deliveryPricing.driverEarnings,
    platformFee: deliveryPricing.platformFee,
    orderStatus: 'PENDING_RESTAURANT',
    pickupOtp: Math.floor(1000 + Math.random() * 9000).toString(),
    deliveryOtp: Math.floor(1000 + Math.random() * 9000).toString(),
    foodItems: items || ['1x Special Dum Biryani (Chicken)', '2x Garlic Butter Naan']
  });

  broadcastToMerchant(rest.id, {
    type: 'NEW_FOOD_ORDER',
    order: {
      id: job.id,
      customerName: user.name,
      customerPhone: user.phone,
      items: job.foodItems,
      totalAmount: job.fare,
      deliveryAddress: job.drop.address
    }
  });

  res.json({ success: true, job });
});

// RESTAURANT / MERCHANT API ENDPOINTS
app.get('/api/merchant/:restaurantId/dashboard', authenticateMerchant, (req, res) => {
  const rest = db.restaurants.find(r => r.id === req.params.restaurantId) || db.restaurants[0];
  const pendingOrders = db.jobs.filter(j => j.type === 'FOOD' && j.restaurantId === rest.id && j.status !== 'COMPLETED');
  res.json({
    success: true,
    restaurant: rest,
    activeOrdersCount: pendingOrders.length,
    todaySales: 8420.0
  });
});

app.get('/api/merchant/:restaurantId/orders', authenticateMerchant, (req, res) => {
  const rest = db.restaurants.find(r => r.id === req.params.restaurantId) || db.restaurants[0];
  const orders = db.jobs.filter(j => j.type === 'FOOD' && (j.restaurantId === rest.id || !j.restaurantId));
  res.json({ success: true, orders });
});

app.post(['/api/merchant/:restaurantId/orders/:orderId/status', '/api/merchant/orders/:orderId/status'], (req, res) => {
  const { status } = req.body;
  const orderId = req.params.orderId;
  const job = db.getJob(orderId);

  if (!job) return res.status(404).json({ success: false, error: 'Order not found' });

  job.orderStatus = status;
  if (status === 'READY_FOR_PICKUP') {
    job.status = 'READY_FOR_PICKUP';
    broadcastToDrivers({
      type: 'NEW_JOB_DISPATCH',
      job: {
        id: job.id,
        type: 'FOOD',
        title: `Food Pickup: ${job.restaurantName || 'Dilli Darbar'}`,
        pickup: job.pickup.address,
        drop: job.drop.address,
        fare: `₹${(job.deliveryFee || 55).toFixed(2)}`,
        customer: job.customerName,
        deliveryOtp: job.deliveryOtp
      }
    });
  }

  broadcastToCustomer(job.customerId, {
    type: 'FOOD_ORDER_UPDATE',
    orderId: job.id,
    orderStatus: status
  });

  res.json({ success: true, job });
});

app.post('/api/merchant/:restaurantId/menu/:itemId/toggle', authenticateMerchant, (req, res) => {
  const rest = db.restaurants.find(r => r.id === req.params.restaurantId) || db.restaurants[0];
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
app.post('/api/admin/drivers/:id/status', authenticateAdmin, requirePermission('fleet.manage'), (req, res) => {
  const { status, reason } = req.body;
  const result = db.setDriverStatus(req.params.id, status, reason, req.admin.id, req.admin.name);
  if (!result.success) return res.status(400).json(result);
  res.json(result);
});

app.post('/api/driver/:driverId/toggle-online', authenticateDriver, (req, res) => {
  const driver = db.getDriver(req.params.driverId);

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
  const driver = db.getDriver(req.params.driverId) || req.driver || db.drivers[0];
  res.json({ success: true, driver });
});

app.post('/api/driver/accept-job', authenticateDriver, (req, res) => {
  const { jobId, driverId } = req.body;
  const effectiveDriverId = req.driver?.id || driverId || 'drv_1';
  const driver = db.getDriver(effectiveDriverId);

  if (driver.operationalStatus === 'SUSPENDED') {
    return res.status(403).json({ success: false, error: 'Suspended driver cannot accept trips.' });
  }

  const job = db.updateJobStatus(jobId, 'ASSIGNED', driver.id);
  if (job) {
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
    res.json({ success: true, job, driver });
  } else {
    res.status(404).json({ success: false, error: 'Job not found' });
  }
});

// Authoritative Driver Trip / Delivery OTP Verification
app.post('/api/driver/verify-otp', authenticateDriver, (req, res) => {
  try {
    const jobId = req.body.jobId;
    const otp = req.body.otp || req.body.enteredOtp;
    const otpType = req.body.otpType || 'START';
    const effectiveDriverId = req.driver?.id || req.body.driverId || 'drv_1';
    
    const result = db.validateAuthoritativeJobOtp({
      jobId,
      otp,
      otpType,
      driverId: effectiveDriverId
    });

    if (result.status === 'COMPLETED') {
      broadcastToCustomer(result.job.customerId, { type: 'TRIP_COMPLETED', jobId: result.job.id, fare: result.job.fare });
      broadcastToDrivers({ type: 'JOB_COMPLETED', jobId: result.job.id });
    } else if (result.status === 'OUT_FOR_DELIVERY') {
      broadcastToCustomer(result.job.customerId, { type: 'FOOD_ORDER_UPDATE', orderId: result.job.id, orderStatus: 'OUT_FOR_DELIVERY' });
    } else {
      broadcastToCustomer(result.job.customerId, { type: 'TRIP_STARTED', jobId: result.job.id });
    }

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, verified: false });
  }
});

app.post('/api/driver/complete-trip', authenticateDriver, (req, res) => {
  const { jobId, rating } = req.body;
  const job = db.updateJobStatus(jobId, 'COMPLETED');
  if (job) {
    broadcastToCustomer(job.customerId, { type: 'TRIP_COMPLETED', jobId: job.id, fare: job.fare, rating });
    res.json({ success: true, job, driver: db.getDriver() });
  } else {
    res.status(404).json({ success: false, error: 'Job not found' });
  }
});

app.post('/api/driver/payout', (req, res) => {
  const { driverId, amount, upiId } = req.body;
  const result = db.recordPayout(driverId || 'drv_1', Number(amount) || 500, upiId);
  res.json(result);
});

app.get('/api/driver/:driverId/earnings', (req, res) => {
  const driver = db.getDriver(req.params.driverId);
  res.json({
    success: true,
    todayEarnings: driver.todayEarnings,
    todayTrips: driver.todayTrips,
    weeklyEarnings: driver.weeklyEarnings,
    monthlyEarnings: driver.monthlyEarnings,
    walletBalance: driver.walletBalance,
    commissionPaidToday: driver.commissionPaidToday,
    cashCollectedToday: driver.cashCollectedToday,
    onlinePaidToday: driver.onlinePaidToday,
    transactions: db.transactions
  });
});

// SAVED SCHOOLS & CHILDREN CRUD
app.get('/api/schools', (req, res) => res.json({ success: true, schools: db.getSchools() }));
app.post('/api/schools', (req, res) => res.json({ success: true, school: db.addSchool(req.body) }));
app.put('/api/schools/:id', (req, res) => {
  const school = db.updateSchool(req.params.id, req.body);
  if (!school) return res.status(404).json({ success: false, error: 'School not found' });
  res.json({ success: true, school });
});
app.delete('/api/schools/:id', (req, res) => {
  const deleted = db.deleteSchool(req.params.id);
  res.json({ success: true, deleted });
});

app.get('/api/children', (req, res) => res.json({ success: true, children: db.getChildren() }));
app.post('/api/children', (req, res) => res.json({ success: true, child: db.addChild(req.body) }));
app.put('/api/children/:id', (req, res) => {
  const child = db.updateChild(req.params.id, req.body);
  if (!child) return res.status(404).json({ success: false, error: 'Child not found' });
  res.json({ success: true, child });
});
app.delete('/api/children/:id', (req, res) => {
  const deleted = db.deleteChild(req.params.id);
  res.json({ success: true, deleted });
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

// Get Products Catalog (Customer & Merchant view)
app.get('/api/grocery/products', (req, res) => {
  const products = db.getGroceryProducts(req.query);
  res.json({ success: true, count: products.length, products });
});

// Get Specific Product Price History Audit Trail
app.get('/api/grocery/products/:id/history', (req, res) => {
  const history = db.getGroceryPriceHistory(req.params.id);
  res.json({ success: true, productId: req.params.id, history });
});

// Single Merchant Price Update
app.put('/api/grocery/products/:id/price', (req, res) => {
  try {
    const { newPrice, reason, merchantId, actor } = req.body;
    const updated = db.updateGroceryProductPrice({
      productId: req.params.id,
      newPrice,
      merchantId: merchantId || 'mcht_darkstore_1',
      reason: reason || 'Merchant price adjustment',
      actor: actor || 'Merchant'
    });
    broadcastToAdmins({ type: 'GROCERY_PRICE_UPDATED', productId: req.params.id, product: updated });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- ADMIN MASTER CATALOG ENDPOINTS ---
app.get('/api/admin/master-catalog', (req, res) => {
  const masterProducts = db.getMasterProducts();
  res.json({ success: true, count: masterProducts.length, masterProducts });
});

app.post('/api/admin/master-catalog', (req, res) => {
  try {
    const product = db.addMasterProduct(req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_ADDED', product });
    res.json({ success: true, product });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/master-catalog/:id', (req, res) => {
  try {
    const updated = db.updateMasterProduct(req.params.id, req.body);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_UPDATED', product: updated });
    res.json({ success: true, product: updated });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/master-catalog/:id', (req, res) => {
  try {
    const deleted = db.deleteMasterProduct(req.params.id);
    broadcastToAdmins({ type: 'MASTER_PRODUCT_DELETED', id: req.params.id });
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/master-catalog/:id/stores', (req, res) => {
  try {
    const matrix = db.getMasterProductStoreMatrix(req.params.id);
    res.json({ success: true, ...matrix });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// --- MERCHANT STORE INVENTORY ENDPOINTS ---
app.get('/api/merchant/inventory', (req, res) => {
  const merchantId = req.query.merchant_id || 'mcht_darkstore_1';
  const inventory = db.getMerchantInventory(merchantId);
  res.json({ success: true, merchantId, count: inventory.length, inventory });
});

app.post('/api/merchant/inventory', (req, res) => {
  try {
    const item = db.updateMerchantInventoryItem(req.body);
    res.json({ success: true, item });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Bulk Merchant Price Update
app.post('/api/grocery/products/bulk-price-update', (req, res) => {
  try {
    const { updates, merchantId, actor } = req.body;
    const results = db.bulkUpdateGroceryPrices({ updates, merchantId, actor });
    broadcastToAdmins({ type: 'GROCERY_BULK_PRICE_UPDATED', results });
    res.json({ success: true, count: results.length, results });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Server-Side Cart Price Revalidation (Customer App & Cart)
app.post('/api/grocery/cart/revalidate', (req, res) => {
  const { cartItems } = req.body;
  const reval = db.revalidateCart(cartItems || []);
  res.json({ success: true, ...reval });
});

// Authoritative Checkout Validation & Order Generation
app.post('/api/grocery/checkout/validate', (req, res) => {
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

  const result = db.validateCheckout(req.body);
  if (!result.success) {
    return res.status(409).json(result);
  }
  res.json(result);
});

// Merchant Submit Actual Packed Weight & Recalculate Order Total
app.post('/api/grocery/orders/:id/packed-weight', (req, res) => {
  try {
    const { itemId, packedWeight, merchantId } = req.body;
    const result = db.submitPackedWeight({
      orderId: req.params.id,
      itemId,
      packedWeight,
      merchantId
    });
    broadcastToCustomer(result.order.customerId, { type: 'ORDER_WEIGHT_RECALCULATED', order: result.order });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
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

app.get(['/api/v1/features', '/api/features'], (req, res) => {
  const env = req.query.env || process.env.NODE_ENV || 'production';
  const flags = db.getFeatureFlags(env);
  res.json({ success: true, ...flags });
});

app.post(['/api/v1/admin/features', '/api/admin/features'], authenticateAdmin, (req, res) => {
  const { key, enabled, betaOnly, description } = req.body;
  if (!key) {
    return res.status(400).json({ success: false, code: 'INVALID_INPUT', message: 'Feature flag key is required.' });
  }
  const updated = db.updateFeatureFlag(key, { enabled, betaOnly, description }, req.admin?.username || 'admin');
  res.json({ success: true, featureFlag: updated });
});

// =========================================================================
// HIGH-FREQUENCY LIVE FLEET TELEMETRY & SCOPED TRACKING (v1)
// =========================================================================

app.post(['/api/v1/driver/location', '/api/driver/location'], (req, res) => {
  const { driverId, lat, lng, latitude, longitude, heading, bearing, speed, speedKmph, jobId, activeJobId, isOnline, status, serviceType } = req.body;
  const effectiveLat = lat !== undefined ? lat : latitude;
  const effectiveLng = lng !== undefined ? lng : longitude;

  if (!driverId || effectiveLat === undefined || effectiveLng === undefined) {
    return res.status(400).json({ success: false, code: 'INVALID_COORDINATES', message: 'driverId, lat, and lng are required.' });
  }

  // Update in-memory / Redis fast store (Never writing raw high-frequency telemetry to PostgreSQL)
  const locationRecord = db.updateDriverLocation({
    driverId,
    lat: effectiveLat,
    lng: effectiveLng,
    heading: heading || bearing,
    speed: speed || speedKmph,
    jobId: jobId || activeJobId,
    isOnline,
    status,
    serviceType
  });

  // Broadcast to authorized channel scopes
  // 1. Always broadcast to authorized Admin Fleet channel
  broadcast({
    type: 'DRIVER_LOCATION_UPDATE',
    channel: 'admin:fleet',
    driverId,
    location: locationRecord
  });

  // 2. If assigned to an active trip/delivery, broadcast strictly to the authorized customer/merchant channel
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

  res.json({ success: true, telemetryStored: true, timestamp: locationRecord.updatedAt });
});

app.get(['/api/v1/fleet/locations', '/api/fleet/locations'], authenticateAdmin, (req, res) => {
  const serviceType = req.query.serviceType || null;
  const isOnlineOnly = req.query.isOnlineOnly !== 'false';
  const fleet = db.getFleetLocations({ serviceType, isOnlineOnly });
  res.json({ success: true, count: fleet.length, fleet });
});

app.get(['/api/v1/tracking/:jobId', '/api/tracking/:jobId'], (req, res) => {
  const jobId = req.params.jobId;
  const job = db.getJob(jobId);
  if (!job) {
    return res.status(404).json({ success: false, code: 'JOB_NOT_FOUND', message: `Job ${jobId} not found.` });
  }

  const effectiveDriverId = job.driverId || 'DRV-101';
  const driverLocation = db.getDriverLocation(effectiveDriverId) || {
    driverId: effectiveDriverId,
    lat: 28.6853,
    lng: 77.2185,
    heading: 90.0,
    speed: 28.5
  };

  const driverObj = db.getDriver(effectiveDriverId) || { id: effectiveDriverId, name: job.driverName || 'Rajesh Kumar', phone: '+91 98101 22334' };

  res.json({
    success: true,
    jobId: job.id,
    status: job.status,
    type: job.type,
    channel: job.type === 'RIDE' ? `ride:${job.id}` : `delivery:${job.id}`,
    driver: { id: driverObj.id || effectiveDriverId, name: driverObj.name || 'Rajesh Kumar', phone: driverObj.phone || '+91 98101 22334' },
    location: driverLocation,
    pickup: job.pickup,
    drop: job.drop
  });
});

// -------------------------------------------------------------
// PAYMENT GATEWAY CHECKOUT & ESCROW SETTLEMENT ENGINE
// -------------------------------------------------------------

// 1. Create Sandbox/Live Payment Order Session
app.post('/api/payments/create-order', (req, res) => {
  try {
    const { customerId, amount, currency = 'INR', serviceType = 'RIDE', jobId, metadata } = req.body;
    const session = db.createPaymentSession({ customerId, amount, currency, serviceType, jobId, metadata });
    res.json({ success: true, session });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// 2. Verify Payment Checkout & Update Transaction State
app.post('/api/payments/verify-checkout', (req, res) => {
  try {
    const { orderId, paymentId, signature, status = 'SUCCESS', failureReason } = req.body;
    const result = db.verifyPaymentSession({ orderId, paymentId, signature, status, failureReason });
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
  }
});

// 3. Query Payment Session
app.get('/api/payments/session/:orderId', (req, res) => {
  const session = db.paymentSessions ? db.paymentSessions.get(req.params.orderId) : null;
  if (!session) return res.status(404).json({ success: false, error: 'Payment session not found' });
  res.json({ success: true, session });
});

// 4. Server-to-Server Webhook
app.post('/api/payments/webhook', (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || req.headers['x-webhook-signature'] || '';
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || 'whsec_nabin_secure_beta_2026';
    const bodyPayload = JSON.stringify(req.body);

    if (signature) {
      const expectedSignature = crypto.createHmac('sha256', secret).update(bodyPayload).digest('hex');
      if (signature !== expectedSignature && process.env.NODE_ENV === 'production') {
        return res.status(400).json({ success: false, error: 'Invalid webhook signature', requestId: req.id });
      }
    }

    const eventId = req.headers['x-event-id'] || req.body.event_id || req.body.eventId || req.body.id || `evt_${Date.now()}`;
    const eventType = req.body.event || req.body.type || 'payment.captured';
    const paymentData = req.body.payload?.payment?.entity || req.body.data || req.body;
    const paymentId = paymentData.id || req.body.paymentId || `pay_${Date.now()}`;
    const amount = (paymentData.amount ? paymentData.amount / 100 : req.body.amount) || 0;
    const status = paymentData.status || req.body.status || 'CAPTURED';

    const result = db.recordPaymentWebhook({
      eventId,
      eventType,
      paymentId,
      amount,
      status,
      signature,
      payload: req.body
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message, requestId: req.id });
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

    const existing = db.getMediaAsset(rawPublicId);
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
    const { customerId = 'usr_1', fileData, mimeType = 'image/jpeg' } = req.body;
    const user = db.getUser(customerId);
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
    const { driverId = 'DRV-101', fileData, mimeType = 'image/jpeg' } = req.body;
    const driver = db.getDriver(driverId);
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
    const { driverId = 'DRV-101', vehicleId = 'veh_1', fileData, photoType = 'exterior', mimeType = 'image/jpeg' } = req.body;
    const driver = db.getDriver(driverId);
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
    const restaurantId = req.params.restaurantId || req.body.restaurantId || 'rest_1';
    const { fileData, mediaType = 'COVER', mimeType = 'image/jpeg' } = req.body;
    const rest = db.restaurants.find(r => r.id === restaurantId) || db.restaurants[0];

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
    const restaurantId = req.params.restaurantId || req.body.restaurantId || 'rest_1';
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
    const { fileData, driverId = 'DRV-101', mimeType = 'image/jpeg' } = req.body;

    const job = db.getJob(parcelId);
    if (!job) return res.status(404).json({ success: false, error: 'Parcel job not found.' });

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
server.listen(PORT, () => {
  console.log(`NABIN Unified Backend running on http://localhost:${PORT}`);
  console.log(`WebSocket Dispatch Server listening on ws://localhost:${PORT}`);
});
