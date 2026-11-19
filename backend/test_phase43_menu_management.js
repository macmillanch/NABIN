const assert = require('assert');
const http = require('http');

async function runTests() {
  console.log('=== NABIN PHASE 4.3 — MENU MANAGEMENT & CONFIGURATION TEST SUITE ===');

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

  // Seed test merchant
  const token = 'test_menu_token_' + Date.now();
  const merchantId = 'rest_menu_1';

  const testMerchant = {
    id: merchantId,
    uuid: merchantId,
    name: 'Menu Test Kitchen',
    merchant_type: 'RESTAURANT',
    approval_status: 'APPROVED',
    is_open: true
  };
  db.restaurants.push(testMerchant);

  const session = {
    token,
    role: 'MERCHANT',
    entityId: merchantId,
    userId: 'usr_menu_1',
    phone: '+919999900041'
  };
  db.activeSessions.set(token, session);
  db.activeSessions.set(db.hashSessionToken(token), session);

  let createdDishId = null;

  // 1. Create Dish (RM-029)
  await testAsync('POST /api/merchant/dishes creates new dish with valid dietary tag', async () => {
    const res = await makeRequest({
      path: '/api/merchant/dishes',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Kothey Chicken Momo',
        category: 'Momos & Tibetan Delicacies',
        price: 240,
        dietaryType: 'NON_VEG',
        isVeg: false,
        description: 'Pan-fried Himalayan chicken momos served with spicy sesame chutney.',
        prepTimeMinutes: 20
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.dish.name, 'Kothey Chicken Momo');
    assert.strictEqual(res.body.dish.price, 240);
    assert.strictEqual(res.body.dish.isAvailable, true);
    createdDishId = res.body.dish.id;
  });

  // 2. List Dishes (RM-028)
  await testAsync('GET /api/merchant/dishes lists created dish', async () => {
    const res = await makeRequest({
      path: '/api/merchant/dishes',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.dishes.some(d => d.id === createdDishId));
  });

  // 3. Update Dish (RM-030)
  await testAsync('PUT /api/merchant/dishes/:id updates dish price and description', async () => {
    assert.ok(createdDishId);
    const res = await makeRequest({
      path: `/api/merchant/dishes/${createdDishId}`,
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        price: 260,
        description: 'Updated signature recipe with roasted red chili dip.'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.dish.price, 260);
  });

  // 4. Toggle Availability (86ing)
  await testAsync('PATCH /api/merchant/dishes/:id/availability 86es dish', async () => {
    assert.ok(createdDishId);
    const res = await makeRequest({
      path: `/api/merchant/dishes/${createdDishId}/availability`,
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: { isAvailable: false }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.dish.isAvailable, false);
  });

  // 5. Bulk Availability Update (RM-033)
  await testAsync('POST /api/merchant/dishes/bulk-availability restores stock in bulk', async () => {
    assert.ok(createdDishId);
    const res = await makeRequest({
      path: '/api/merchant/dishes/bulk-availability',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        dishIds: [createdDishId],
        isAvailable: true
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.count, 1);
  });

  // 6. Bulk Adjust Pricing (RM-033)
  await testAsync('POST /api/merchant/dishes/bulk-pricing adjusts prices by +10%', async () => {
    assert.ok(createdDishId);
    const res = await makeRequest({
      path: '/api/merchant/dishes/bulk-pricing',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        dishIds: [createdDishId],
        percentageChange: 10
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    // 260 * 1.10 = 286
    assert.strictEqual(res.body.updated[0].price, 286);
  });

  // 7. Menu Shifts Scheduling (RM-032)
  await testAsync('GET and PUT /api/merchant/rms/menu/shifts manages meal dayparts', async () => {
    const getRes = await makeRequest({
      path: '/api/merchant/rms/menu/shifts',
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.strictEqual(getRes.status, 200);
    assert.strictEqual(getRes.body.success, true);
    assert.ok(getRes.body.shifts.length >= 3);

    const putRes = await makeRequest({
      path: '/api/merchant/rms/menu/shifts',
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        shifts: [
          { id: 'shift_1', name: 'Breakfast Express', startTime: '07:00', endTime: '11:00', isActive: true },
          { id: 'shift_2', name: 'Lunch Buffet & Thalis', startTime: '11:30', endTime: '16:00', isActive: true },
          { id: 'shift_3', name: 'Dinner Line & Tandoor', startTime: '18:00', endTime: '23:30', isActive: true }
        ]
      }
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.body.success, true);
    assert.strictEqual(putRes.body.shifts[0].startTime, '07:00');
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
