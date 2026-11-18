const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('=== NABIN PHASE 4.2 — RESTAURANT OPERATIONS TEST SUITE ===');

  const db = require('./src/database');
  const { app } = require('./src/server');

  let passed = 0;
  let failed = 0;

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;

  function makeRequest({ path, method = 'GET', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => { resBody += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(resBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, rawBody: resBody });
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  // Seed test restaurant session
  const token = 'test_ops_token_' + Date.now();
  const merchantId = 'rest_ops_1';

  const testMerchant = {
    id: merchantId,
    uuid: merchantId,
    name: 'Ops Test Kitchen',
    merchant_type: 'RESTAURANT',
    approval_status: 'APPROVED',
    is_open: true
  };
  db.restaurants.push(testMerchant);

  const session = {
    token,
    role: 'MERCHANT',
    entityId: merchantId,
    userId: 'usr_ops_1',
    phone: '+919999900031'
  };
  db.activeSessions.set(token, session);
  db.activeSessions.set(db.hashSessionToken(token), session);

  // Seed dummy order in db.orders
  const testOrder = {
    id: 'ord_ops_4825',
    order_id: 'ord_ops_4825',
    merchant_id: merchantId,
    merchantId,
    order_state: 'ACCEPTED',
    orderState: 'ACCEPTED',
    customer_name: 'Aarav Sharma',
    total_amount: 540.00,
    prep_time_minutes: 20
  };
  if (!db.orders) db.orders = [];
  db.orders.push(testOrder);

  // 1. KDS Settings Endpoints
  await testAsync('GET /api/merchant/rms/kds/settings returns default KDS preferences', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/kds/settings',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.settings.gridColumns);
    assert.strictEqual(res.body.settings.audioChimeEnabled, true);
  });

  await testAsync('PUT /api/merchant/rms/kds/settings updates gridColumns and darkTheme', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/kds/settings',
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: { gridColumns: 4, darkTheme: true, audioChimeEnabled: false }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.settings.gridColumns, 4);
    assert.strictEqual(res.body.settings.audioChimeEnabled, false);
  });

  // 2. Kitchen Stations Endpoints
  await testAsync('GET /api/merchant/rms/stations returns canonical stations list', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/stations',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.stations.length >= 4);
    assert.ok(res.body.stations.some(s => s.code === 'GRILL'));
  });

  let createdStationId = null;
  await testAsync('POST /api/merchant/rms/stations adds new custom station', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/stations',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Momo & Dimsum Steam Bay', code: 'STEAM', printerAssigned: 'KOT_Thermal_3' }
    });
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.station.code, 'STEAM');
    createdStationId = res.body.station.id;
  });

  await testAsync('DELETE /api/merchant/rms/stations/:id removes station', async () => {
    assert.ok(createdStationId);
    const res = await makeRequest({
      path: `/api/merchant/rms/stations/${createdStationId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  });

  // 3. Prep-Time Adjustment Endpoint (RM-016)
  await testAsync('POST /api/merchant/orders/:id/prep-time updates order prep time', async () => {
    const res = await makeRequest({
      path: `/api/merchant/orders/ord_ops_4825/prep-time`,
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { minutes: 35, reason: 'Rush hour tandoor queue' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.prepTimeMinutes, 35);
    assert.ok(res.body.estimatedReadyTime);
  });

  // 4. Disputes & Order Issues Endpoints (RM-017, RM-019)
  await testAsync('GET /api/merchant/rms/disputes lists open customer dispute cases', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/disputes',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.disputes.length >= 1);
    assert.ok(res.body.disputes.some(d => d.issueType === 'MISSING_ITEM'));
  });

  await testAsync('POST /api/merchant/rms/disputes/:id/action resolves dispute', async () => {
    const res = await makeRequest({
      path: '/api/merchant/rms/disputes/disp_4825_1/action',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { action: 'APPROVE_REFUND', notes: 'Naan was mistakenly missed in bag 2. Refund approved.' }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.dispute.status, 'RESOLVED');
  });

  console.log(`\n=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
  testServer.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
