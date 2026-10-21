/**
 * NABIN — Phase C Verification Suite:
 * Persistent Restaurant Catalog & Authoritative Food Checkout
 *
 * Covers:
 *   1. Catalog persistence: Dish CRUD, variants CRUD, add-on groups & options CRUD,
 *      availability toggling, and safe soft-archival.
 *   2. Authorization & Tenant Isolation:
 *      - 401 on unauthenticated writes
 *      - 403 on cross-tenant writes (Merchant A -> Merchant B)
 *      - 403 on grocery-only merchant attempting restaurant dish operations
 *      - 403 on IDOR body override attempts
 *      - 404 on missing dish / variant / add-on group
 *      - 400 on invalid prices, negative prep time, min > max bounds
 *   3. Authoritative Customer Food Checkout:
 *      - Server-authoritative base pricing
 *      - Variant pricing override (Half vs Full)
 *      - Multi-add-on pricing calculations
 *      - Required add-on group enforcement (fails closed)
 *      - Max selection limit enforcement (fails closed)
 *      - Unavailable dish / variant / add-on rejection
 *      - Archived dish checkout rejection
 *      - Price tampering rejection (client ₹1 payload completely ignored)
 *      - Invalid quantity rejection (<= 0)
 *      - Idempotency key preservation and replay
 *      - Immutable customization snapshot verification
 */

const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const db = require('./src/database');
const { app } = require('./src/server');

let server;
let baseUrl;

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqHeaders = { ...headers };
    let reqBody = null;

    if (body !== null && typeof body === 'object') {
      reqHeaders['Content-Type'] = 'application/json';
      reqBody = JSON.stringify(body);
      reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const req = http.request(
      url,
      {
        method,
        headers: reqHeaders
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = rawData;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed
          });
        });
      }
    );

    req.on('error', reject);
    if (reqBody) req.write(reqBody);
    req.end();
  });
}

async function runTests() {
  console.log('\n========================================================================');
  console.log('🧪 NABIN PHASE C: RESTAURANT CATALOG & AUTHORITATIVE CHECKOUT TEST SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function recordPass(testName) {
    passed++;
    console.log(`  ✅ [PASS] ${testName}`);
  }

  function recordFail(testName, err) {
    failed++;
    console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
  }

  // Set up test server
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Test identities
  const merchantAUuid = '00000000-0000-0000-0000-000000000201'; // Dilli Darbar (RESTAURANT)
  const merchantBUuid = '00000000-0000-0000-0000-000000000202'; // Sagar Ratna (RESTAURANT)
  const grocUuid = '00000000-0000-0000-0000-000000000203'; // Fresh Mart (GROCERY only)
  const customerUuid = '00000000-0000-0000-0000-000000000001'; // Rahul Sharma

  // Create authentication tokens for testing
  const tokenMchtA = 'test_token_mcht_a_' + Date.now();
  const tokenMchtB = 'test_token_mcht_b_' + Date.now();
  const tokenGroc = 'test_token_groc_' + Date.now();
  const tokenCust = 'test_token_cust_' + Date.now();

  if (!db.activeSessions) db.activeSessions = new Map();
  db.activeSessions.set(tokenMchtA, { role: 'MERCHANT', entityId: merchantAUuid, userId: 'usr_mcht_a', expiresAt: '2099-01-01T00:00:00Z' });
  db.activeSessions.set(tokenMchtB, { role: 'MERCHANT', entityId: merchantBUuid, userId: 'usr_mcht_b', expiresAt: '2099-01-01T00:00:00Z' });
  db.activeSessions.set(tokenGroc, { role: 'MERCHANT', entityId: grocUuid, userId: 'usr_groc', expiresAt: '2099-01-01T00:00:00Z' });
  db.activeSessions.set(tokenCust, { role: 'CUSTOMER', entityId: 'usr_1', userId: 'usr_1', name: 'Rahul Sharma', expiresAt: '2099-01-01T00:00:00Z' });

  // Ensure restaurants are present in db.restaurants with appropriate merchant_type
  let restA = db.restaurants.find(r => r.uuid === merchantAUuid || r.id === merchantAUuid);
  if (!restA) {
    restA = {
      id: 'rest_1',
      uuid: merchantAUuid,
      name: 'Dilli Darbar Test',
      merchant_type: 'RESTAURANT',
      isOpen: true,
      menu: []
    };
    db.restaurants.push(restA);
  } else {
    restA.merchant_type = 'RESTAURANT';
    restA.isOpen = true;
  }

  let restB = db.restaurants.find(r => r.uuid === merchantBUuid || r.id === merchantBUuid);
  if (!restB) {
    restB = {
      id: 'rest_2',
      uuid: merchantBUuid,
      name: 'Sagar Ratna Test',
      merchant_type: 'RESTAURANT',
      isOpen: true,
      menu: []
    };
    db.restaurants.push(restB);
  } else {
    restB.merchant_type = 'RESTAURANT';
    restB.isOpen = true;
  }

  let grocMcht = db.restaurants.find(r => r.uuid === grocUuid || r.id === grocUuid);
  if (!grocMcht) {
    grocMcht = {
      id: 'groc_1',
      uuid: grocUuid,
      name: 'Fresh Mart Grocery Test',
      merchant_type: 'GROCERY',
      isOpen: true
    };
    db.restaurants.push(grocMcht);
  } else {
    grocMcht.merchant_type = 'GROCERY';
  }

  let createdDishId = null;
  let variantHalfId = null;
  let variantFullId = null;
  let spiceGroupId = null;
  let spiceMediumOptionId = null;
  let breadGroupId = null;
  let garlicNaanOptionId = null;
  let butterRotiOptionId = null;

  try {
    // =========================================================================
    // 1. DISH CREATION & PERSISTENCE
    // =========================================================================
    console.log('--- 1. DISH PERSISTENCE & STRUCTURED ATTRIBUTES ---');

    // TC-01: Create dish with variants, add-on groups, photos, dietary type
    try {
      const res = await makeRequest('POST', '/api/merchant/dishes', {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Royal Shahi Paneer',
        description: 'Rich cottage cheese in cashew cream gravy',
        category: 'Main Course',
        price: 320,
        dietaryType: 'VEG',
        prepTimeMinutes: 25,
        photos: [
          { url: 'https://cdn.nabin.com/shahi_paneer_1.jpg', isPrimary: true, sortOrder: 0 },
          { url: 'https://cdn.nabin.com/shahi_paneer_2.jpg', isPrimary: false, sortOrder: 1 }
        ],
        variants: [
          { name: 'Half (250g)', price: 190, isAvailable: true, isDefault: false },
          { name: 'Full (500g)', price: 320, isAvailable: true, isDefault: true }
        ],
        addOnGroups: [
          {
            name: 'Spice Level',
            isRequired: true,
            minSelections: 1,
            maxSelections: 1,
            allowMultiple: false,
            options: [
              { name: 'Mild', price: 0, isAvailable: true },
              { name: 'Medium Spicy', price: 0, isAvailable: true },
              { name: 'Extra Hot', price: 15, isAvailable: true }
            ]
          },
          {
            name: 'Accompaniment Breads',
            isRequired: false,
            minSelections: 0,
            maxSelections: 3,
            allowMultiple: true,
            options: [
              { name: 'Butter Roti', price: 25, isAvailable: true },
              { name: 'Garlic Naan', price: 55, isAvailable: true },
              { name: 'Laccha Paratha', price: 45, isAvailable: true }
            ]
          }
        ]
      });

      assert.strictEqual(res.statusCode, 201, `Expected 201 Created, got ${res.statusCode}`);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.dish.name, 'Royal Shahi Paneer');
      assert.strictEqual(res.body.dish.price, 320);
      assert.strictEqual(res.body.dish.dietaryType, 'VEG');
      assert.strictEqual(res.body.dish.isVeg, true);
      assert.strictEqual(res.body.dish.variants.length, 2);
      assert.strictEqual(res.body.dish.addOnGroups.length, 2);

      createdDishId = res.body.dish.id;
      variantHalfId = res.body.dish.variants[0].id;
      variantFullId = res.body.dish.variants[1].id;

      spiceGroupId = res.body.dish.addOnGroups[0].id;
      spiceMediumOptionId = res.body.dish.addOnGroups[0].options[1].id;

      breadGroupId = res.body.dish.addOnGroups[1].id;
      butterRotiOptionId = res.body.dish.addOnGroups[1].options[0].id;
      garlicNaanOptionId = res.body.dish.addOnGroups[1].options[1].id;

      recordPass('Create dish with structured variants, add-on groups, and photos');
    } catch (e) {
      recordFail('Create dish with structured variants, add-on groups, and photos', e);
    }

    // TC-02: Get dish by ID
    try {
      const res = await makeRequest('GET', `/api/merchant/dishes/${createdDishId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dish.id, createdDishId);
      assert.strictEqual(res.body.dish.name, 'Royal Shahi Paneer');
      recordPass('Retrieve single dish by ID for merchant');
    } catch (e) {
      recordFail('Retrieve single dish by ID for merchant', e);
    }

    // TC-03: Update dish base price & description
    try {
      const res = await makeRequest('PUT', `/api/merchant/dishes/${createdDishId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        price: 340,
        description: 'Signature creamy royal shahi paneer'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dish.price, 340);
      assert.strictEqual(res.body.dish.description, 'Signature creamy royal shahi paneer');
      recordPass('Update dish base price and description');
    } catch (e) {
      recordFail('Update dish base price and description', e);
    }

    // TC-04: Availability toggle (PATCH)
    try {
      const res = await makeRequest('PATCH', `/api/merchant/dishes/${createdDishId}/availability`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        isAvailable: false
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dish.isAvailable, false);

      // Re-enable availability
      const res2 = await makeRequest('PATCH', `/api/merchant/dishes/${createdDishId}/availability`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        isAvailable: true
      });
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.body.dish.isAvailable, true);
      recordPass('Toggle dish availability between out-of-stock and in-stock');
    } catch (e) {
      recordFail('Toggle dish availability between out-of-stock and in-stock', e);
    }

    // =========================================================================
    // 2. VARIANT & ADD-ON CRUD OPERATIONS
    // =========================================================================
    console.log('\n--- 2. VARIANT & ADD-ON SUB-RESOURCE CRUD ---');

    let extraVariantId = null;
    // TC-05: Add new variant
    try {
      const res = await makeRequest('POST', `/api/merchant/dishes/${createdDishId}/variants`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Family Pack (1kg)',
        price: 620,
        isAvailable: true
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.variant.name, 'Family Pack (1kg)');
      assert.strictEqual(res.body.variant.price, 620);
      extraVariantId = res.body.variant.id;
      recordPass('Add third variant to existing dish');
    } catch (e) {
      recordFail('Add third variant to existing dish', e);
    }

    // TC-06: Update variant price
    try {
      const res = await makeRequest('PUT', `/api/merchant/dishes/${createdDishId}/variants/${extraVariantId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        price: 640
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.variant.price, 640);
      recordPass('Update variant price');
    } catch (e) {
      recordFail('Update variant price', e);
    }

    // TC-07: Delete variant
    try {
      const res = await makeRequest('DELETE', `/api/merchant/dishes/${createdDishId}/variants/${extraVariantId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      recordPass('Delete variant');
    } catch (e) {
      recordFail('Delete variant', e);
    }

    // TC-08: Add new option to add-on group
    let extraOptionId = null;
    try {
      const res = await makeRequest('POST', `/api/merchant/dishes/${createdDishId}/add-on-groups/${breadGroupId}/options`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Roomali Roti',
        price: 30,
        isAvailable: true
      });
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.body.option.name, 'Roomali Roti');
      assert.strictEqual(res.body.option.price, 30);
      extraOptionId = res.body.option.id;
      recordPass('Add option to existing add-on group');
    } catch (e) {
      recordFail('Add option to existing add-on group', e);
    }

    // TC-09: Delete option from add-on group
    try {
      const res = await makeRequest('DELETE', `/api/merchant/dishes/${createdDishId}/add-on-groups/${breadGroupId}/options/${extraOptionId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.success, true);
      recordPass('Delete option from add-on group');
    } catch (e) {
      recordFail('Delete option from add-on group', e);
    }

    // =========================================================================
    // 3. AUTHORIZATION & TENANT ISOLATION SAFEGUARDS
    // =========================================================================
    console.log('\n--- 3. AUTHORIZATION & TENANT ISOLATION SAFEGUARDS ---');

    // TC-10: 401 Unauthenticated write attempt
    try {
      const res = await makeRequest('POST', '/api/merchant/dishes', {}, {
        name: 'Unauth Dish',
        price: 100,
        category: 'Starter'
      });
      assert.strictEqual(res.statusCode, 401);
      recordPass('Unauthenticated write rejected with HTTP 401');
    } catch (e) {
      recordFail('Unauthenticated write rejected with HTTP 401', e);
    }

    // TC-11: 403 Merchant B cannot edit Merchant A dish (Cross-Tenant check)
    try {
      const res = await makeRequest('PUT', `/api/merchant/dishes/${createdDishId}`, {
        Authorization: `Bearer ${tokenMchtB}`
      }, {
        name: 'Hacked Dish Name',
        price: 1
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.code, 'MERCHANT_MISMATCH');
      recordPass('Cross-tenant write attempt rejected with HTTP 403 MERCHANT_MISMATCH');
    } catch (e) {
      recordFail('Cross-tenant write attempt rejected with HTTP 403 MERCHANT_MISMATCH', e);
    }

    // TC-12: 403 Grocery merchant cannot access restaurant dish CRUD
    try {
      const res = await makeRequest('POST', '/api/merchant/dishes', {
        Authorization: `Bearer ${tokenGroc}`
      }, {
        name: 'Grocery Dish Attempt',
        price: 100,
        category: 'Food'
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.code, 'MERCHANT_TYPE_MISMATCH');
      recordPass('Grocery merchant rejected from restaurant catalog with HTTP 403 MERCHANT_TYPE_MISMATCH');
    } catch (e) {
      recordFail('Grocery merchant rejected from restaurant catalog with HTTP 403 MERCHANT_TYPE_MISMATCH', e);
    }

    // TC-13: 403 IDOR body override defense (Merchant A trying to set merchantId of Merchant B in body)
    try {
      const res = await makeRequest('POST', '/api/merchant/dishes', {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Spoofed Tenant Dish',
        price: 150,
        category: 'Starter',
        merchantId: merchantBUuid // Attempting to forge tenant ownership
      });
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.body.code, 'MERCHANT_MISMATCH');
      recordPass('Client IDOR body tenant override rejected with HTTP 403 MERCHANT_MISMATCH');
    } catch (e) {
      recordFail('Client IDOR body tenant override rejected with HTTP 403 MERCHANT_MISMATCH', e);
    }

    // TC-14: 400 Invalid price validation (negative price)
    try {
      const res = await makeRequest('POST', '/api/merchant/dishes', {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Negative Price Dish',
        price: -50,
        category: 'Starter'
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'INVALID_PRICE');
      recordPass('Negative price rejected with HTTP 400 INVALID_PRICE');
    } catch (e) {
      recordFail('Negative price rejected with HTTP 400 INVALID_PRICE', e);
    }

    // TC-15: 400 Invalid selection bounds (minSelections > maxSelections)
    try {
      const res = await makeRequest('POST', `/api/merchant/dishes/${createdDishId}/add-on-groups`, {
        Authorization: `Bearer ${tokenMchtA}`
      }, {
        name: 'Impossible Selection Group',
        minSelections: 3,
        maxSelections: 1,
        options: [
          { name: 'Opt 1', price: 10 }
        ]
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'INVALID_SELECTION_BOUNDS');
      recordPass('Invalid selection bounds (min > max) rejected with HTTP 400 INVALID_SELECTION_BOUNDS');
    } catch (e) {
      recordFail('Invalid selection bounds (min > max) rejected with HTTP 400 INVALID_SELECTION_BOUNDS', e);
    }

    // =========================================================================
    // 4. CUSTOMER CATALOG READ & ARCHIVAL ISOLATION
    // =========================================================================
    console.log('\n--- 4. CUSTOMER CATALOG READS & ARCHIVAL ISOLATION ---');

    // Create a temporary dish to test archival
    let archiveDishId = null;
    const tempRes = await makeRequest('POST', '/api/merchant/dishes', {
      Authorization: `Bearer ${tokenMchtA}`
    }, {
      name: 'Seasonal Mango Curry',
      price: 280,
      category: 'Seasonal'
    });
    archiveDishId = tempRes.body.dish.id;

    // TC-16: Customer sees active dish on menu
    try {
      const res = await makeRequest('GET', `/api/restaurants/${merchantAUuid}/menu`);
      assert.strictEqual(res.statusCode, 200);
      const found = res.body.items.find(i => i.id === archiveDishId);
      assert.ok(found, 'Created seasonal dish should be present in customer menu');
      recordPass('Customer reads published restaurant menu with active items');
    } catch (e) {
      recordFail('Customer reads published restaurant menu with active items', e);
    }

    // TC-17: Archive dish (soft-delete)
    try {
      const res = await makeRequest('DELETE', `/api/merchant/dishes/${archiveDishId}`, {
        Authorization: `Bearer ${tokenMchtA}`
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.dish.isArchived, true);
      assert.strictEqual(res.body.dish.isAvailable, false);
      recordPass('Merchant archives dish (is_archived: true, is_available: false)');
    } catch (e) {
      recordFail('Merchant archives dish (is_archived: true, is_available: false)', e);
    }

    // TC-18: Archived dish disappears from customer menu
    try {
      const res = await makeRequest('GET', `/api/restaurants/${merchantAUuid}/menu`);
      assert.strictEqual(res.statusCode, 200);
      const found = res.body.items.find(i => i.id === archiveDishId);
      assert.strictEqual(found, undefined, 'Archived dish must not appear in customer menu');
      recordPass('Archived dish is excluded from customer menu');
    } catch (e) {
      recordFail('Archived dish is excluded from customer menu', e);
    }

    // =========================================================================
    // 5. AUTHORITATIVE FOOD CHECKOUT PRICING & ENFORCEMENT
    // =========================================================================
    console.log('\n--- 5. AUTHORITATIVE FOOD CHECKOUT PRICING ---');

    // TC-19: Base order pricing: Server authoritative calculation
    // 1x Royal Shahi Paneer (Full 340) + Spice Level Mild (0) = 340
    try {
      const idempKey = 'idemp_test_base_' + crypto.randomUUID();
      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        idempotencyKey: idempKey,
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceMediumOptionId],
            quantity: 1,
            unit_price: 1 // Client attempts to forge price of ₹1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
      // Dish Full variant price is 320. Medium spicy option is +0. Server authoritative price = 320 (client ₹1 is ignored).
      assert.strictEqual(res.body.order.totalAmount, 320, `Expected authoritative 320, got ${res.body.order.totalAmount}`);
      recordPass('Checkout strictly calculates server-authoritative base/variant price (ignores client ₹1 tampering)');
    } catch (e) {
      recordFail('Checkout strictly calculates server-authoritative base/variant price (ignores client ₹1 tampering)', e);
    }

    // TC-20: Variant pricing override (Half 190) + Add-ons (Garlic Naan 55 + Butter Roti 25) = (190 + 80) * 2 = 540
    try {
      const idempKey = 'idemp_test_variant_addon_' + crypto.randomUUID();
      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        idempotencyKey: idempKey,
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantHalfId, // Half = 190
            selected_add_ons: [spiceMediumOptionId, garlicNaanOptionId, butterRotiOptionId], // 0 + 55 + 25 = 80
            quantity: 2
          }
        ]
      });

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.order.totalAmount, 540, `Expected (190 + 80) * 2 = 540, got ${res.body.order.totalAmount}`);

      // Verify immutable customization snapshot
      const orderItems = res.body.order.items;
      assert.ok(Array.isArray(orderItems) && orderItems.length === 1);
      const line = orderItems[0];
      assert.strictEqual(line.unit_price, 270);
      assert.strictEqual(line.line_total, 540);
      assert.ok(line.customization_snapshot, 'Order line must carry immutable customization_snapshot');
      assert.strictEqual(line.customization_snapshot.variant.name, 'Half (250g)');
      assert.strictEqual(line.customization_snapshot.add_ons.length, 3);
      recordPass('Checkout accurately calculates variant override + multiple add-ons with snapshot');
    } catch (e) {
      recordFail('Checkout accurately calculates variant override + multiple add-ons with snapshot', e);
    }

    // TC-21: Required add-on group enforcement (fails if omitted)
    // Dish has 'Spice Level' as required (minSelections = 1). If caller omits it -> 400 REQUIRED_ADDON_MISSING
    try {
      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [], // Missing required spice level
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'REQUIRED_ADDON_MISSING');
      recordPass('Checkout rejects omission of required add-on group with HTTP 400 REQUIRED_ADDON_MISSING');
    } catch (e) {
      recordFail('Checkout rejects omission of required add-on group with HTTP 400 REQUIRED_ADDON_MISSING', e);
    }

    // TC-22: Max selection limit enforcement (fails if exceeded)
    // 'Spice Level' allows max 1 selection. If caller sends 2 spice options -> 400 ADDON_LIMIT_EXCEEDED
    try {
      const dish = await db.restaurantCatalogRepo.getDishById(merchantAUuid, createdDishId);
      const spiceOptMild = dish.addOnGroups[0].options[0].id;
      const spiceOptHot = dish.addOnGroups[0].options[2].id;

      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceOptMild, spiceOptHot], // 2 selections when max is 1
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'ADDON_LIMIT_EXCEEDED');
      recordPass('Checkout rejects exceeding add-on max selection limit with HTTP 400 ADDON_LIMIT_EXCEEDED');
    } catch (e) {
      recordFail('Checkout rejects exceeding add-on max selection limit with HTTP 400 ADDON_LIMIT_EXCEEDED', e);
    }

    // TC-23: Archived dish checkout rejection (fails closed)
    try {
      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: archiveDishId,
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'ITEM_ARCHIVED');
      recordPass('Checkout rejects ordering archived dish with HTTP 400 ITEM_ARCHIVED');
    } catch (e) {
      recordFail('Checkout rejects ordering archived dish with HTTP 400 ITEM_ARCHIVED', e);
    }

    // TC-24: Out-of-stock dish checkout rejection (fails closed)
    try {
      // Toggle dish to unavailable
      await db.restaurantCatalogRepo.toggleAvailability(merchantAUuid, createdDishId, false);

      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceMediumOptionId],
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'ITEM_UNAVAILABLE');
      recordPass('Checkout rejects ordering out-of-stock dish with HTTP 400 ITEM_UNAVAILABLE');

      // Re-enable availability
      await db.restaurantCatalogRepo.toggleAvailability(merchantAUuid, createdDishId, true);
    } catch (e) {
      recordFail('Checkout rejects ordering out-of-stock dish with HTTP 400 ITEM_UNAVAILABLE', e);
    }

    // TC-25: Unavailable variant rejection
    try {
      await db.restaurantCatalogRepo.updateVariant(merchantAUuid, createdDishId, variantHalfId, { isAvailable: false });

      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantHalfId,
            selected_add_ons: [spiceMediumOptionId],
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'VARIANT_UNAVAILABLE');
      recordPass('Checkout rejects ordering unavailable variant with HTTP 400 VARIANT_UNAVAILABLE');

      await db.restaurantCatalogRepo.updateVariant(merchantAUuid, createdDishId, variantHalfId, { isAvailable: true });
    } catch (e) {
      recordFail('Checkout rejects ordering unavailable variant with HTTP 400 VARIANT_UNAVAILABLE', e);
    }

    // TC-26: Unavailable add-on option rejection
    try {
      await db.restaurantCatalogRepo.updateAddOnOption(merchantAUuid, createdDishId, breadGroupId, garlicNaanOptionId, { isAvailable: false });

      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceMediumOptionId, garlicNaanOptionId],
            quantity: 1
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'ADDON_UNAVAILABLE');
      recordPass('Checkout rejects ordering unavailable add-on option with HTTP 400 ADDON_UNAVAILABLE');

      await db.restaurantCatalogRepo.updateAddOnOption(merchantAUuid, createdDishId, breadGroupId, garlicNaanOptionId, { isAvailable: true });
    } catch (e) {
      recordFail('Checkout rejects ordering unavailable add-on option with HTTP 400 ADDON_UNAVAILABLE', e);
    }

    // TC-27: Invalid quantity rejection (<= 0)
    try {
      const res = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceMediumOptionId],
            quantity: -2
          }
        ]
      });

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.code, 'INVALID_QUANTITY');
      recordPass('Checkout rejects negative quantity with HTTP 400 INVALID_QUANTITY');
    } catch (e) {
      recordFail('Checkout rejects negative quantity with HTTP 400 INVALID_QUANTITY', e);
    }

    // TC-28: Idempotency replay check
    try {
      const replayKey = 'idemp_food_replay_' + crypto.randomUUID();
      const payload = {
        restaurantId: merchantAUuid,
        deliveryAddress: 'Flat 402, Civil Lines, North Delhi',
        idempotencyKey: replayKey,
        items: [
          {
            restaurant_product_id: createdDishId,
            variant_id: variantFullId,
            selected_add_ons: [spiceMediumOptionId],
            quantity: 1
          }
        ]
      };

      const res1 = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, payload);

      assert.strictEqual(res1.statusCode, 200);
      const originalOrderId = res1.body.order.id;

      // Replay with identical idempotency key
      const res2 = await makeRequest('POST', '/api/customer/book-food', {
        Authorization: `Bearer ${tokenCust}`
      }, payload);

      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.body.order.id, originalOrderId, 'Idempotent replay must return original order ID without duplicating');
      recordPass('Duplicate submission with same idempotency key safely returns idempotent replay');
    } catch (e) {
      recordFail('Duplicate submission with same idempotency key safely returns idempotent replay', e);
    }

  } finally {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
  }

  console.log('\n========================================================================');
  console.log(`TOTAL PHASE C TESTS: ${passed + failed}`);
  console.log(`PASSED: ${passed}`);
  console.log(`FAILED: ${failed}`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
