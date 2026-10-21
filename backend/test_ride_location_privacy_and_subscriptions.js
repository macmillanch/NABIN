'use strict';

/**
 * NABIN — RIDE LOCATION PRIVACY AND ROOM SUBSCRIPTION REGRESSION SUITE
 *
 * Verifies strict server-enforced authorization for driver telemetry and live ride tracking:
 * - Only authenticated drivers can transmit telemetry.
 * - Anti-spoofing rejects mismatched driver identities.
 * - Drivers can only attach telemetry to active rides assigned to them.
 * - Only the authorized customer for that ride receives live driver location packets.
 * - Unrelated customers receive ZERO location packets (no broadcast leakage).
 * - Room subscriptions (`SUBSCRIBE_RIDE`) reject unauthorized customers and non-active rides.
 * - Completed/cancelled rides revoke obsolete subscriptions and cease delivery.
 * - Admin fleet channel receives fleet telemetry only for authenticated admins.
 */

process.env.NABIN_TEST_MODE = 'true';
process.env.NODE_ENV = 'local';

const http = require('http');
const WebSocket = require('ws');
const { server } = require('./src/server');
const db = require('./src/database');

const WS_URL = 'ws://127.0.0.1:4000';

let passed = 0;
let failed = 0;
const results = [];

function assert(description, condition, details = '') {
  if (condition) {
    passed++;
    results.push({ desc: description, status: 'PASS' });
    console.log(`✅ [PASS] ${description}`);
  } else {
    failed++;
    results.push({ desc: description, status: 'FAIL', details });
    console.error(`❌ [FAIL] ${description} -> ${details}`);
  }
}

function waitForWsMessage(ws, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
    }, timeoutMs);

    function handler(raw) {
      clearTimeout(timer);
      ws.off('message', handler);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (e) {
        resolve(raw.toString());
      }
    }
    ws.on('message', handler);
  });
}

function waitForWsClose(ws, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for WebSocket close after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason ? reason.toString() : '' });
    });
  });
}

(async () => {
  console.log('========================================================================');
  console.log('🔒 NABIN RIDE LOCATION PRIVACY & ROOM SUBSCRIPTION SECURITY SUITE');
  console.log('========================================================================\n');

  try {
    // Wait for server to bind & become healthy
    console.log('⚡ Waiting for server to boot and synchronize PostgreSQL...');
    let serverReady = false;
    for (let i = 0; i < 150; i++) {
      try {
        const ok = await new Promise((resolve) => {
          const req = http.get('http://127.0.0.1:4000/api/health', (res) => resolve(res.statusCode === 200));
          req.on('error', () => resolve(false));
          req.setTimeout(500, () => {
            req.destroy();
            resolve(false);
          });
        });
        if (ok) {
          serverReady = true;
          break;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 250));
    }

    if (!serverReady) {
      throw new Error('Server failed to reach healthy status on http://127.0.0.1:4000/api/health within timeout.');
    }
    console.log('✅ Server online and responding on port 4000.\n');

    // 1. Create In-Memory Sessions & Actors
    console.log('--- 1. Provisioning Authoritative Test Sessions ---');
    const cust1Id = 'usr_cust_alice_1';
    const cust2Id = 'usr_cust_bob_2';
    const drv1Id = 'drv_dave_1';
    const drv2Id = 'drv_dan_2';
    const adminId = 'adm_super_1';

    const cust1Token = 'tok_cust_alice_priv';
    const cust2Token = 'tok_cust_bob_priv';
    const drv1Token = 'tok_drv_dave_priv';
    const drv2Token = 'tok_drv_dan_priv';
    const adminToken = 'tok_adm_super_priv';

    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    db.activeSessions = db.activeSessions || new Map();
    function registerTestSession(token, entityId, role, entity) {
      const sess = { token, entityId, role, entity, expiresAt };
      db.activeSessions.set(token, sess);
      if (typeof db.hashSessionToken === 'function') {
        db.activeSessions.set(db.hashSessionToken(token), sess);
      }
    }

    registerTestSession(cust1Token, cust1Id, 'CUSTOMER', { id: cust1Id, uuid: cust1Id });
    registerTestSession(cust2Token, cust2Id, 'CUSTOMER', { id: cust2Id, uuid: cust2Id });
    registerTestSession(drv1Token, drv1Id, 'DRIVER', { id: drv1Id, uuid: drv1Id });
    registerTestSession(drv2Token, drv2Id, 'DRIVER', { id: drv2Id, uuid: drv2Id });
    registerTestSession(adminToken, adminId, 'SUPER_ADMIN', { id: adminId });

    // Provision Driver records
    db.drivers = db.drivers || [];
    db.drivers.push(
      { id: drv1Id, name: 'Dave Driver', isOnline: true, location: { lat: 23.7271, lng: 92.7176 } },
      { id: drv2Id, name: 'Dan Driver', isOnline: true, location: { lat: 23.7271, lng: 92.7176 } }
    );

    // 2. Set up synthetic active ride in DB
    const testJobId = `job_priv_${Date.now()}`;
    const testJob = {
      id: testJobId,
      uuid: testJobId,
      jobNumber: testJobId,
      type: 'RIDE',
      serviceType: 'RIDE',
      customerId: cust1Id,
      customerUuid: cust1Id,
      driverId: drv1Id,
      driverUuid: drv1Id,
      status: 'IN_TRANSIT',
      pickup: { address: 'Treasury Square', lat: 23.7271, lng: 92.7176 },
      drop: { address: 'Bawngkawn', lat: 23.7350, lng: 92.7250 },
    };

    db.jobs = db.jobs || [];
    db.jobs.push(testJob);

    assert('Actor sessions and synthetic test ride provisioned in memory',
      db.jobs.find(j => j.id === testJobId) && db.getSessionByToken(cust1Token)
    );

    // --- 2. WebSocket Connections & Registration ---
    console.log('\n--- 2. Setting Up Authenticated WebSocket Sockets ---');
    
    // Admin socket
    const adminWs = new WebSocket(WS_URL);
    await new Promise(r => adminWs.once('open', r));
    adminWs.send(JSON.stringify({ type: 'REGISTER', role: 'ADMIN', token: adminToken }));
    await waitForWsMessage(adminWs);

    // Customer 1 socket (Alice — Ride Owner)
    const cust1Ws = new WebSocket(WS_URL);
    await new Promise(r => cust1Ws.once('open', r));
    cust1Ws.send(JSON.stringify({ type: 'REGISTER', role: 'CUSTOMER', token: cust1Token }));
    await waitForWsMessage(cust1Ws);

    // Customer 2 socket (Bob — Unrelated Customer)
    const cust2Ws = new WebSocket(WS_URL);
    await new Promise(r => cust2Ws.once('open', r));
    cust2Ws.send(JSON.stringify({ type: 'REGISTER', role: 'CUSTOMER', token: cust2Token }));
    await waitForWsMessage(cust2Ws);

    // Driver 1 socket (Dave — Assigned Driver)
    const drv1Ws = new WebSocket(WS_URL);
    await new Promise(r => drv1Ws.once('open', r));
    drv1Ws.send(JSON.stringify({ type: 'REGISTER', role: 'DRIVER', token: drv1Token }));
    const drv1Auth = await waitForWsMessage(drv1Ws);

    // Driver 2 socket (Dan — Unassigned Driver)
    const drv2Ws = new WebSocket(WS_URL);
    await new Promise(r => drv2Ws.once('open', r));
    drv2Ws.send(JSON.stringify({ type: 'REGISTER', role: 'DRIVER', token: drv2Token }));
    await waitForWsMessage(drv2Ws);

    // --- 3. Telemetry Isolation & Anti-Leakage ---
    console.log('\n--- 3. Testing Ride Telemetry Isolation & Authorization ---');

    const cust1Messages = [];
    const cust2Messages = [];
    cust1Ws.on('message', (m) => cust1Messages.push(JSON.parse(m.toString())));
    cust2Ws.on('message', (m) => cust2Messages.push(JSON.parse(m.toString())));

    const adminMessages = [];
    adminWs.on('message', (m) => adminMessages.push(JSON.parse(m.toString())));

    // Case 1: Driver 1 sends location update for testJobId
    drv1Ws.send(JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      driverId: drv1Auth.id,
      location: { lat: 23.7280, lng: 92.7180 },
      heading: 45.0,
      speed: 12.0,
      activeJobId: testJobId
    }));

    const ack = await waitForWsMessage(drv1Ws);
    assert('RLP-01: Assigned driver receives LOCATION_ACK for active ride telemetry',
      ack.type === 'LOCATION_ACK' && ack.success === true
    );

    // Give 150ms for message propagation
    await new Promise(r => setTimeout(r, 150));

    // Verify Customer 1 (Owner) received the update
    const c1Loc = cust1Messages.find(m => m.type === 'DRIVER_LOCATION_UPDATE');
    assert('RLP-02: Authorized customer receives live driver location update for their ride',
      c1Loc && c1Loc.jobId === testJobId && c1Loc.location?.lat === 23.7280
    );

    // Verify Customer 2 (Unrelated) received ZERO location updates
    const c2Loc = cust2Messages.find(m => m.type === 'DRIVER_LOCATION_UPDATE');
    assert('RLP-03: CRITICAL PRIVACY: Unrelated customer receives ZERO location updates',
      c2Loc === undefined,
      `Customer 2 leaked telemetry: ${JSON.stringify(c2Loc)}`
    );

    // Verify Admin received the update on admin:fleet channel
    const adminLoc = adminMessages.find(m => m.type === 'DRIVER_LOCATION_UPDATE' && m.channel === 'admin:fleet');
    assert('RLP-04: Admin fleet monitor receives DRIVER_LOCATION_UPDATE on admin:fleet channel',
      adminLoc && adminLoc.driverId === drv1Auth.id
    );

    // Case 2: Customer 2 attempts to subscribe to Customer 1's ride
    console.log('\n--- 4. Testing Room Subscription Authorization ---');
    cust2Ws.send(JSON.stringify({
      type: 'SUBSCRIBE_RIDE',
      jobId: testJobId
    }));
    const subReject = await waitForWsMessage(cust2Ws);
    assert('RLP-05: Customer cannot subscribe to another customer\'s ride ID (SUBSCRIPTION_FORBIDDEN)',
      subReject.type === 'ERROR' && subReject.code === 'SUBSCRIPTION_FORBIDDEN'
    );

    // Case 3: Customer 1 subscribes to their own ride
    cust1Ws.send(JSON.stringify({
      type: 'SUBSCRIBE_RIDE',
      jobId: testJobId
    }));
    const subAck = await waitForWsMessage(cust1Ws);
    assert('RLP-06: Authorized customer successfully subscribes to their own ride (SUBSCRIPTION_ACK)',
      subAck.type === 'SUBSCRIPTION_ACK' && subAck.jobId === testJobId && subAck.success === true
    );

    // Case 4: Driver impersonation attempt
    console.log('\n--- 5. Testing Driver Telemetry Anti-Spoofing & Assignment Guards ---');
    drv1Ws.send(JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      driverId: 'drv_spoofed_random',
      location: { lat: 23.7290, lng: 92.7190 }
    }));
    const spoofErr = await waitForWsMessage(drv1Ws);
    assert('RLP-07: Driver impersonation attempt with spoofed driverId is rejected',
      spoofErr.type === 'ERROR' && spoofErr.code === 'IDENTITY_SPOOFING_REJECTED'
    );

    // Case 5: Unassigned driver attempts to update Customer 1's ride
    drv2Ws.send(JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      driverId: drv2Id,
      location: { lat: 23.7290, lng: 92.7190 },
      activeJobId: testJobId
    }));
    const assignErr = await waitForWsMessage(drv2Ws);
    assert('RLP-08: Unassigned driver cannot attach telemetry to another driver\'s ride',
      assignErr.type === 'ERROR' && assignErr.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
    );

    // Case 6: Non-driver attempting DRIVER_LOCATION_UPDATE
    cust1Ws.send(JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      location: { lat: 23.7290, lng: 92.7190 }
    }));
    const roleErr = await waitForWsMessage(cust1Ws);
    assert('RLP-09: Customer attempting DRIVER_LOCATION_UPDATE is rejected with ROLE_FORBIDDEN',
      roleErr.type === 'ERROR' && roleErr.code === 'ROLE_FORBIDDEN'
    );

    // Case 7: Unauthenticated socket receives zero protected data
    console.log('\n--- 6. Testing Unauthenticated Sockets & Lifecycle Termination ---');
    const anonWs = new WebSocket(WS_URL);
    await new Promise(r => anonWs.once('open', r));
    anonWs.send(JSON.stringify({ type: 'SUBSCRIBE_RIDE', jobId: testJobId }));
    const anonErr = await waitForWsMessage(anonWs);
    const anonClose = await waitForWsClose(anonWs);
    assert('RLP-10: Unauthenticated socket attempting subscription is closed with 4401',
      anonErr.type === 'AUTH_ERROR' && anonClose.code === 4401
    );

    // Case 8: Ride completion revokes subscription & halts telemetry delivery
    console.log('\n--- 7. Testing Terminal Ride Subscription Revocation ---');
    testJob.status = 'COMPLETED';

    // Attempting to subscribe to completed ride is rejected
    cust1Ws.send(JSON.stringify({
      type: 'SUBSCRIBE_RIDE',
      jobId: testJobId
    }));
    const inactiveSub = await waitForWsMessage(cust1Ws);
    assert('RLP-11: Subscribing to completed ride is rejected with RIDE_NOT_ACTIVE',
      inactiveSub.type === 'ERROR' && inactiveSub.code === 'RIDE_NOT_ACTIVE'
    );

    // Clear message buffers
    cust1Messages.length = 0;
    cust2Messages.length = 0;

    // Driver transmits after completion
    drv1Ws.send(JSON.stringify({
      type: 'DRIVER_LOCATION_UPDATE',
      driverId: drv1Auth.id,
      location: { lat: 23.7310, lng: 92.7210 },
      activeJobId: testJobId
    }));
    await waitForWsMessage(drv1Ws); // ACK
    await new Promise(r => setTimeout(r, 150));

    const postCompleteLoc = cust1Messages.find(m => m.type === 'DRIVER_LOCATION_UPDATE');
    assert('RLP-12: Zero driver location updates delivered to customer after ride COMPLETED',
      postCompleteLoc === undefined,
      `Customer received post-completion telemetry: ${JSON.stringify(postCompleteLoc)}`
    );

    // Clean up WebSockets
    adminWs.close();
    cust1Ws.close();
    cust2Ws.close();
    drv1Ws.close();
    drv2Ws.close();

    // Remove synthetic job and sessions
    const jobIdx = db.jobs.findIndex(j => j.id === testJobId);
    if (jobIdx !== -1) db.jobs.splice(jobIdx, 1);

    console.log('\n========================================================================');
    console.log(`🏁 PRIVACY SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================\n');

    if (failed > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('FATAL TEST ERROR:', err);
    process.exitCode = 1;
  } finally {
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
