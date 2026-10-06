'use strict';

/*
 * TASK F1 (Food discovery + real menu ordering) contract regression.
 *
 * The customer Food page was rewritten to browse PostgreSQL-backed restaurants and add real catalogue
 * products to a cart. This suite pins the contracts that design depends on, over real HTTP:
 *
 *   GET  /api/restaurants                  must serve durable restaurants (dataSource 'postgres')
 *   GET  /api/restaurants/:id/menu         must serve that merchant's real products with server prices
 *   POST /api/customer/book-food           must require a customer session, must reject another
 *                                          merchant's product, must NOT accept an invented dish
 *                                          name, and must price the coupon code it is handed
 *
 * Every checkout assertion here is a REFUSAL path, so the suite places no orders and mutates no money or
 * dispatch state - it needs no data cleanup and cannot perturb other links. Successful order placement is
 * covered by test_phase4_orders.js (see the F-3 chain-registration gap in the progress log).
 *
 * The one filesystem assertion (FD-09) is a static check on the shipped page, not a browser test: no
 * browser harness exists in this repository, and none is being claimed.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BASE = process.env.NABIN_TEST_BASE || process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
// The durable read-back half of the profile checks needs the same loopback guard as BASE:
// pointing a test database handle at a hosted project is how a suite rewrites production.
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
if (!/^(?:127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(new URL(BASE).hostname)
  || !/^(?:127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(new URL(PG).hostname)) {
  console.error('REFUSED: non-loopback target'); process.exit(1);
}

const PHONE_C1 = '9845011982';
const OTP = process.env.NABIN_TEST_OTP || '7729';
// The two registered RESTAURANT tenants the merchant suites already authenticate as (A owns
// the row this group writes; B is the neighbour it must not be able to edit).
const PHONE_RESTAURANT_A = '9888000001';
const PHONE_RESTAURANT_B = '9888000003';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pass = 0; let fail = 0;
const check = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` -- ${String(d).slice(0, 150)}` : ''}`); };

const api = async (method, p, { body, token } = {}) => {
  const res = await fetch(BASE + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {}; try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, data };
};

(async () => {
  const health = await api('GET', '/api/health');
  check('FD-00 backend is reachable and healthy', health.status === 200, `status ${health.status}`);
  if (health.status !== 200) { console.log('FATAL: backend not running'); process.exitCode = 1; return; }

  // --- discovery reads -----------------------------------------------------
  const list = await api('GET', '/api/restaurants');
  check('FD-01 restaurant list responds', list.status === 200 && list.data.success === true, `status ${list.status}`);
  check('FD-01b restaurant list is served from PostgreSQL, not fixtures',
    list.data.dataSource === 'postgres' && list.data.degraded !== true, `dataSource=${list.data.dataSource} degraded=${list.data.degraded}`);
  const restaurants = list.data.restaurants || [];
  check('FD-01c at least one real restaurant exists to order from', restaurants.length > 0, `count ${restaurants.length}`);
  check('FD-01d rows carry durable ids and booleans the UI depends on',
    restaurants.every((r) => UUID_RE.test(r.id) && typeof r.name === 'string' && typeof r.isOpen === 'boolean'),
    JSON.stringify(Object.keys(restaurants[0] || {})));

  const searchable = restaurants.find((r) => r.name && r.name.length > 3);
  if (searchable) {
    const term = searchable.name.slice(0, 4);
    const found = await api('GET', `/api/restaurants?search=${encodeURIComponent(term)}`);
    check('FD-02 search narrows server-side to matching restaurants',
      found.status === 200 && (found.data.restaurants || []).length >= 1
      && (found.data.restaurants || []).every((r) => r.name.toLowerCase().includes(term.toLowerCase())),
      `term "${term}" hits ${(found.data.restaurants || []).length}`);
  } else {
    check('FD-02 search narrows server-side to matching restaurants', false, 'no restaurant with a usable name');
  }

  // --- menu of a real restaurant ------------------------------------------
  const withMenu = async (id) => api('GET', `/api/restaurants/${id}/menu`);
  let menuRes = null; let chosen = null;
  for (const r of restaurants.slice(0, 12)) {
    const res = await withMenu(r.id);
    if (res.status === 200 && (res.data.items || []).length > 0) { menuRes = res; chosen = r; break; }
  }
  check('FD-03 a real restaurant serves a real menu with products', !!menuRes, chosen ? chosen.name : 'no restaurant had menu items');

  if (menuRes) {
    const items = menuRes.data.items;
    check('FD-03b menu items carry UUID product identifiers (the cart ids)',
      items.every((i) => UUID_RE.test(i.id)), JSON.stringify((items.find((i) => !UUID_RE.test(i.id)) || {}).id));
    check('FD-03c menu prices are server numbers, usable for display',
      items.every((i) => Number.isFinite(Number(i.price)) && Number(i.sellingPrice) > 0),
      JSON.stringify((items.find((i) => !(Number(i.sellingPrice) > 0)) || { name: 'none' }).name));
    check('FD-03d availability is a real boolean, so sold-out can be shown',
      items.every((i) => typeof i.isAvailable === 'boolean'));
    check('FD-03e menu read is durable, not fixture',
      menuRes.data.dataSource === 'postgres' && menuRes.data.degraded !== true, `dataSource=${menuRes.data.dataSource}`);
  }

  // A well-formed UUID that simply does not exist: a malformed id would exercise the database cast
  // error path instead of the "not found" contract the UI relies on.
  const bogus = await api('GET', '/api/restaurants/00000000-0000-0000-0000-000000000f99');
  check('FD-04 unknown restaurant id is refused, not served as empty success',
    bogus.status === 404 || bogus.status === 400, `status ${bogus.status}`);

  // --- checkout contract: auth + tenant isolation + no invented dishes ------
  const noToken = await api('POST', '/api/customer/book-food', {
    body: { restaurantId: (chosen || {}).id, deliveryAddress: 'Test address', items: [{ quantity: 1 }] },
  });
  check('FD-05 checkout without a customer session is refused with 401',
    noToken.status === 401, `status ${noToken.status} code ${noToken.data.code}`);

  const badToken = await api('POST', '/api/customer/book-food', {
    token: 'not-a-real-session-token',
    body: { restaurantId: (chosen || {}).id, deliveryAddress: 'Test address', items: [{ quantity: 1 }] },
  });
  check('FD-05b an invalid session token is refused with 401', badToken.status === 401, `status ${badToken.status}`);

  // Real customer session through the application's own OTP flow. The local/test build exposes the code
  // as `testOtp`; the deterministic fallback matches the other suites rather than guessing a new one.
  const send = await api('POST', '/api/auth/send-otp', { body: { phone: PHONE_C1, role: 'CUSTOMER', purpose: 'LOGIN' } });
  const otp = (send.data && send.data.testOtp) || '7729';
  const verify = await api('POST', '/api/auth/verify-otp', { body: { phone: PHONE_C1, otp, role: 'CUSTOMER' } });
  const custToken = verify.data && verify.data.token;
  check('FD-06 customer authenticates through the OTP flow', !!custToken, `send ${send.status} verify ${verify.status}`);
  if (!custToken) {
    console.log('FATAL: no customer session, the checkout-boundary checks below cannot run.');
    console.log(`\nfood_discovery_ordering_contract_test: ${pass} passed, ${fail + 4} failed`);
    process.exitCode = 1; return;
  }

  // A product belonging to a DIFFERENT merchant must not be orderable from this restaurant.
  let foreignProduct = null;
  for (const r of restaurants) {
    if (chosen && r.id === chosen.id) continue;
    const res = await withMenu(r.id);
    const first = (res.data.items || [])[0];
    if (first) { foreignProduct = { restaurantId: r.id, itemId: first.id }; break; }
  }
  if (foreignProduct) {
    const cross = await api('POST', '/api/customer/book-food', {
      token: custToken,
      body: {
        restaurantId: chosen.id,
        deliveryAddress: 'Test address',
        items: [{ productId: foreignProduct.itemId, quantity: 1 }],
        idempotencyKey: `idemp_fd_cross_${Date.now()}`,
      },
    });
    check('FD-07 another merchant\'s product id cannot be ordered (tenant isolation holds)',
      cross.status >= 400 && cross.status !== 401, `status ${cross.status} code ${cross.data.code}`);
  } else {
    check('FD-07 another merchant\'s product id cannot be ordered (tenant isolation holds)', false, 'no second merchant with a menu found');
  }

  // The old UI let a customer type any dish name. The catalogue must still say no.
  const invented = await api('POST', '/api/customer/book-food', {
    token: custToken,
    body: {
      restaurantId: chosen.id,
      deliveryAddress: 'Test address',
      items: [{ name: 'Dragon Breath Nonexistent Curry' }],
      idempotencyKey: `idemp_fd_invented_${Date.now()}`,
    },
  });
  check('FD-08 an invented dish name is refused with PRODUCT_NOT_FOUND',
    invented.status >= 400 && (invented.data.code === 'PRODUCT_NOT_FOUND' || /not found/i.test(String(invented.data.error))),
    `status ${invented.status} code ${invented.data.code} ${String(invented.data.error || '').slice(0, 40)}`);

  const ghostRestaurant = await api('POST', '/api/customer/book-food', {
    token: custToken,
    body: {
      restaurantId: '00000000-0000-0000-0000-0000000000a9',
      deliveryAddress: 'Test address',
      items: [{ productId: (menuRes && menuRes.data.items[0] ? menuRes.data.items[0].id : '00000000-0000-0000-0000-0000000000b9'), quantity: 1 }],
      idempotencyKey: `idemp_fd_ghost_${Date.now()}`,
    },
  });
  check('FD-08b an unknown restaurant id is refused at checkout with MERCHANT_NOT_FOUND',
    ghostRestaurant.status >= 400 && (ghostRestaurant.data.code === 'MERCHANT_NOT_FOUND' || ghostRestaurant.status === 404),
    `status ${ghostRestaurant.status} code ${ghostRestaurant.data.code}`);

  // --- shipped page no longer asks the customer to type ids/names ----------
  const pagePath = path.join(__dirname, '..', 'customer-web', 'src', 'app', 'food', 'page.tsx');
  const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
  check('FD-09 Food page reads discovery from the API (static check, not a browser run)',
    page.includes('discoveryApi.restaurants') && page.includes('discoveryApi.menu'), 'discovery API calls absent');
  // Assert on code shape, not prose: the page's own comment legitimately mentions the removed design,
  // so matching the words "Restaurant ID" would fail against a correct file.
  check('FD-09b Food page has no typed restaurant-id field and no typed-item widget',
    !/setRestaurantId\(/.test(page) && !/value=\{restaurantId\}/.test(page)
    && !/mcht_1/.test(page) && !/<LineItems/.test(page) && !/blankLine/.test(page),
    'typed restaurant/item controls still wired up');
  check('FD-09c Food page orders by productId, never by name',
    /items: cart\.map\(\(line\) => \(\{ productId: line\.productId/.test(page), 'cart payload does not carry productId');

  // --- #132: restaurant discovery metadata, PostgreSQL -> endpoint -> card -----------
  //
  // A Food card makes three claims about a kitchen: what it cooks, what it looks like
  // and how long it takes. Before migration 034 the schema held no column behind any
  // of them, so every value a customer saw came from the in-memory fixture, while
  // `merchants.rating DEFAULT 4.80` made a never-rated restaurant look measured. This
  // group pins the whole chain in both directions: the merchant declares through the
  // API, the declaration is durable, the customer read serves exactly what was
  // declared and nothing else, `?cuisine=` is a real filter rather than a decorative
  // query parameter, and a withdrawn declaration goes back to showing nothing.
  //
  // It writes one row (tenant A's own merchant record) and restores those three
  // columns to NULL in the finally, so the suite leaves the database as it found it.
  let pg = null;
  let fdMerchantA = null;
  try {
    const norm = (p) => String(p || '').replace(/\D/g, '').slice(-10);
    pg = new Client({ connectionString: PG });
    await pg.connect();
    const merchantRows = (await pg.query(
      'SELECT id::text AS id, phone, name, merchant_type, rating FROM merchants'
    )).rows;
    const only = (phone) => merchantRows.filter((r) => norm(r.phone) === norm(phone));
    const foundA = only(PHONE_RESTAURANT_A);
    const foundB = only(PHONE_RESTAURANT_B);
    if (foundA.length !== 1 || foundB.length !== 1
      || foundA[0].merchant_type !== 'RESTAURANT' || foundB[0].merchant_type !== 'RESTAURANT') {
      // Loud, not skipped: this group proves a write path, and it cannot prove one
      // against a database where the tenant rows are missing or ambiguous.
      throw new Error(`need exactly one RESTAURANT row each for ${PHONE_RESTAURANT_A}/${PHONE_RESTAURANT_B}, `
        + `got ${foundA.length}/${foundB.length}`);
    }
    fdMerchantA = foundA[0];
    const merchantB = foundB[0];
    const ratingAsFound = fdMerchantA.rating;

    // ---- what the customer may never be shown ----
    check('FD-10 the customer projection carries no rating field at all, so a schema default cannot look measured',
      restaurants.length > 0 && restaurants.every((r) => !('rating' in r)),
      JSON.stringify(restaurants.find((r) => 'rating' in r) || 'no row carried one').slice(0, 120));

    check('FD-10b cuisines / coverImageUrl / deliveryMinutes are present and correctly typed on every row',
      restaurants.length > 0 && restaurants.every((r) => Array.isArray(r.cuisines)
        && (r.coverImageUrl === null || typeof r.coverImageUrl === 'string')
        && (r.deliveryMinutes === null || (Number.isInteger(r.deliveryMinutes) && r.deliveryMinutes > 0))),
      JSON.stringify(restaurants.find((r) => !Array.isArray(r.cuisines)) || {}));

    // An empty array and two nulls are the honest representation of a restaurant that
    // has declared nothing; anything else here would be the projection inventing a value.
    const undeclared = restaurants.find((r) => r.id === fdMerchantA.id);
    check('FD-10c an undeclared restaurant is served as no cuisines, no cover and no window',
      !!undeclared && undeclared.cuisines.length === 0
      && undeclared.coverImageUrl === null && undeclared.deliveryMinutes === null,
      JSON.stringify(undeclared || 'merchant A was not in the browse list'));

    // A comment in the route explains the old sort, so assert on the column list and
    // the ORDER BY itself rather than the word 'rating' anywhere in the file.
    const serverSrc = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
    const customerColumns = serverSrc.match(/const CUSTOMER_RESTAURANT_COLUMNS =\s*'([^']+)'/);
    check('FD-10d the customer read never selects the rating column and nothing sorts by it',
      !!customerColumns && !/\brating\b/.test(customerColumns[1]) && !/\.order\('rating'/.test(serverSrc),
      customerColumns ? customerColumns[1] : 'CUSTOMER_RESTAURANT_COLUMNS not found');

    // ---- the write path is a merchant-only, tenant-scoped one ----
    const anon = await api('PATCH', `/api/merchant/${fdMerchantA.id}/profile`, { body: { cuisines: ['Anyone'] } });
    check('FD-11 the profile route refuses an unauthenticated write', anon.status === 401, `status ${anon.status}`);

    const sendA = await api('POST', '/api/auth/send-otp', { body: { phone: PHONE_RESTAURANT_A, role: 'MERCHANT', purpose: 'LOGIN' } });
    const otpA = (sendA.data && sendA.data.testOtp) || OTP;
    const verifyA = await api('POST', '/api/auth/verify-otp', { body: { phone: PHONE_RESTAURANT_A, otp: otpA, role: 'MERCHANT' } });
    const tokA = verifyA.data && verifyA.data.token;
    check('FD-11b tenant A authenticates through the application OTP flow', !!tokA, `send ${sendA.status} verify ${verifyA.status}`);
    if (!tokA) throw new Error('no merchant session - the declaration path cannot be exercised');

    const stolen = await api('PATCH', `/api/merchant/${merchantB.id}/profile`, { token: tokA, body: { cuisines: ['Not mine'] } });
    check('FD-12 tenant A cannot declare on tenant B by putting B\'s id in the path',
      stolen.status === 403 && stolen.data.code === 'MERCHANT_MISMATCH', `status ${stolen.status} code ${stolen.data.code}`);
    const bAfter = await pg.query('SELECT cuisines FROM merchants WHERE id = $1::uuid', [merchantB.id]);
    check('FD-12b and B\'s row really is untouched', bAfter.rows[0].cuisines === null, JSON.stringify(bAfter.rows[0]));

    const groceryTry = only('9888000002')[0];
    if (groceryTry && groceryTry.merchant_type === 'GROCERY') {
      const sendG = await api('POST', '/api/auth/send-otp', { body: { phone: '9888000002', role: 'MERCHANT', purpose: 'LOGIN' } });
      const otpG = (sendG.data && sendG.data.testOtp) || OTP;
      const verifyG = await api('POST', '/api/auth/verify-otp', { body: { phone: '9888000002', otp: otpG, role: 'MERCHANT' } });
      const tokG = verifyG.data && verifyG.data.token;
      const asGrocery = tokG
        ? await api('PATCH', `/api/merchant/${groceryTry.id}/profile`, { token: tokG, body: { cuisines: ['Grocery trying to be a kitchen'] } })
        : { status: 401, data: { code: 'NO_SESSION' } };
      check('FD-13 a GROCERY-only merchant has no restaurant profile to declare',
        asGrocery.status === 403, `status ${asGrocery.status} code ${asGrocery.data.code}`);
    } else {
      check('FD-13 a GROCERY-only merchant has no restaurant profile to declare', false,
        'no unambiguous GROCERY row for 9888000002');
    }

    // ---- every rejected value, and the row must not move for any of them ----
    const refused = [
      ['thirteen cuisines', { cuisines: Array.from({ length: 13 }, (_, i) => `Cuisine ${i}`) }],
      ['a blank cuisine', { cuisines: ['Biryani', '   '] }],
      ['the same cuisine twice', { cuisines: ['Biryani', 'biryani'] }],
      ['a cuisine that is not a name', { cuisines: [42] }],
      ['cuisines that is not an array', { cuisines: 'Biryani, Mughlai' }],
      ['a javascript: cover url', { coverImageUrl: 'javascript:alert(1)' }],
      ['a relative cover url', { coverImageUrl: '/images/banner.jpg' }],
      ['a four minute window', { standardDeliveryMinutes: 4 }],
      ['a window that is not a number', { standardDeliveryMinutes: 'soon' }],
    ];
    for (let i = 0; i < refused.length; i++) {
      const [label, body] = refused[i];
      const res = await api('PATCH', `/api/merchant/${fdMerchantA.id}/profile`, { token: tokA, body });
      check(`FD-14${String.fromCharCode(97 + i)} refuses ${label}`,
        res.status === 400 && res.data.code === 'INVALID_RESTAURANT_PROFILE',
        `status ${res.status} code ${res.data.code} ${String(res.data.error || '').slice(0, 60)}`);
    }
    const afterRefusals = await pg.query(
      'SELECT cuisines, cover_image_url, standard_delivery_minutes FROM merchants WHERE id = $1::uuid', [fdMerchantA.id]);
    check('FD-14j none of the refused writes reached the row',
      afterRefusals.rows[0].cuisines === null && afterRefusals.rows[0].cover_image_url === null
      && afterRefusals.rows[0].standard_delivery_minutes === null, JSON.stringify(afterRefusals.rows[0]));

    const empty = await api('PATCH', `/api/merchant/${fdMerchantA.id}/profile`, { token: tokA, body: {} });
    check('FD-15 an update that names no field is refused rather than reported as a success',
      empty.status === 400 && empty.data.code === 'NO_PROFILE_FIELDS', `status ${empty.status} code ${empty.data.code}`);

    // ---- a declaration goes in, and comes back out through the customer read ----
    const declaredCuisines = ['FD Test Cuisine A', 'FD Test, With Comma'];
    const declaredCover = 'https://example.com/nabin/fd-test-banner.jpg';
    const write = await api('PATCH', `/api/merchant/${fdMerchantA.id}/profile`, {
      token: tokA,
      body: { cuisines: declaredCuisines, coverImageUrl: declaredCover, standardDeliveryMinutes: 28, rating: 5.0 },
    });
    check('FD-16 the merchant declares cuisine, cover and window through the API',
      write.status === 200 && write.data.success === true
      && JSON.stringify(write.data.restaurant.cuisines) === JSON.stringify(declaredCuisines)
      && write.data.restaurant.coverImageUrl === declaredCover
      && write.data.restaurant.standardDeliveryMinutes === 28,
      `status ${write.status} ${JSON.stringify(write.data.restaurant || write.data).slice(0, 160)}`);

    // `rating` rode along in that body. It is not in the writable set, so the row must
    // still hold the value it had before this suite ran - with or without a default.
    const ratingRow = await pg.query('SELECT rating FROM merchants WHERE id = $1::uuid', [fdMerchantA.id]);
    check('FD-16b and the same body cannot smuggle in a rating',
      String(ratingRow.rows[0].rating) === String(ratingAsFound) && !('rating' in (write.data.restaurant || {})),
      `before ${ratingAsFound} after ${ratingRow.rows[0].rating}`);

    const durable = await pg.query(
      'SELECT cuisines, cover_image_url, standard_delivery_minutes FROM merchants WHERE id = $1::uuid', [fdMerchantA.id]);
    check('FD-16c the declaration is durable in PostgreSQL, not just in the response',
      JSON.stringify(durable.rows[0].cuisines) === JSON.stringify(declaredCuisines)
      && durable.rows[0].cover_image_url === declaredCover
      && Number(durable.rows[0].standard_delivery_minutes) === 28, JSON.stringify(durable.rows[0]));

    const detail = await api('GET', `/api/restaurants/${fdMerchantA.id}`);
    check('FD-17 the customer detail endpoint serves exactly what the merchant declared',
      detail.status === 200 && detail.data.dataSource === 'postgres'
      && JSON.stringify(detail.data.restaurant.cuisines) === JSON.stringify(declaredCuisines)
      && detail.data.restaurant.coverImageUrl === declaredCover
      && detail.data.restaurant.deliveryMinutes === 28
      && !('rating' in detail.data.restaurant) && !('deliveryTime' in detail.data.restaurant),
      JSON.stringify(detail.data.restaurant || detail.data).slice(0, 170));

    const filtered = await api('GET', `/api/restaurants?cuisine=${encodeURIComponent(declaredCuisines[0])}`);
    const filteredRows = filtered.data.restaurants || [];
    check('FD-18 ?cuisine= is a real server-side filter now, not an ignored parameter',
      filtered.status === 200 && filtered.data.dataSource === 'postgres' && filteredRows.length >= 1
      && filteredRows.every((r) => r.cuisines.some((c) => String(c).toLowerCase() === declaredCuisines[0].toLowerCase())),
      `status ${filtered.status} hits ${filteredRows.length}`);

    // PostgREST builds array literals out of the URL, so a comma in a cuisine name is
    // the case that would silently turn one filter into two.
    const commaFiltered = await api('GET', `/api/restaurants?cuisine=${encodeURIComponent(declaredCuisines[1])}`);
    const commaRows = commaFiltered.data.restaurants || [];
    check('FD-18b a cuisine containing a comma still matches itself and nothing else',
      commaRows.length >= 1 && commaRows.every((r) => r.cuisines.includes(declaredCuisines[1]))
      && commaRows.some((r) => r.id === fdMerchantA.id),
      `hits ${commaRows.length}`);

    const unfiltered = await api('GET', '/api/restaurants');
    const servedA = (unfiltered.data.restaurants || []).find((r) => r.id === fdMerchantA.id);
    check('FD-18c the unfiltered browse list carries the same declared values',
      !!servedA && servedA.deliveryMinutes === 28 && servedA.coverImageUrl === declaredCover
      && JSON.stringify(servedA.cuisines) === JSON.stringify(declaredCuisines),
      JSON.stringify(servedA || 'absent'));

    const nobody = await api('GET', '/api/restaurants?cuisine=' + encodeURIComponent('FD Cuisine Nobody Declares'));
    check('FD-18d a cuisine no restaurant declares returns an empty list instead of the whole one',
      nobody.status === 200 && (nobody.data.restaurants || []).length === 0,
      `status ${nobody.status} hits ${(nobody.data.restaurants || []).length}`);

    const withdrawn = await api('PATCH', `/api/merchant/${fdMerchantA.id}/profile`, {
      token: tokA,
      body: { cuisines: null, coverImageUrl: null, standardDeliveryMinutes: null },
    });
    const afterWithdraw = await api('GET', `/api/restaurants/${fdMerchantA.id}`);
    check('FD-19 a merchant can withdraw the declaration and the card then shows nothing',
      withdrawn.status === 200 && afterWithdraw.status === 200
      && afterWithdraw.data.restaurant.cuisines.length === 0
      && afterWithdraw.data.restaurant.coverImageUrl === null
      && afterWithdraw.data.restaurant.deliveryMinutes === null,
      JSON.stringify(afterWithdraw.data.restaurant || afterWithdraw.data).slice(0, 150));
  } catch (err) {
    check('FD-10 the discovery-metadata round trip could run at all', false, err.message);
  } finally {
    if (pg) {
      if (fdMerchantA) {
        // Belt and braces: FD-19 already nulls these, but nothing may survive a failure
        // in the middle of the group.
        try {
          await pg.query('UPDATE merchants SET cuisines = NULL, cover_image_url = NULL, standard_delivery_minutes = NULL WHERE id = $1::uuid', [fdMerchantA.id]);
        } catch (e) { /* reported by the caller's next run, not hidden here */ }
      }
      try { await pg.end(); } catch (e) { /* already closed */ }
    }
  }

  // --- #137: the coupon the checkout sends is actually read by the order write -------
  //
  // `food_checkout_screen.dart` shows a discount it got from `POST /api/promotions/apply`
  // and then sends only the *code* to `book-food`, trusting `redeem_promotion_atomic` to
  // price it against the menu prices the server re-reads (`server.js:4122`). If book-food
  // ever stopped reading that field, the customer would see "₹50 off", the order would be
  // created at the full amount, and nothing in this repository would notice — the Flutter
  // test only pins what left the app. An unknown code is the refusal-shaped proof that the
  // field is read: the route rejects before `createOrderWithLinesAtomic`, so this group
  // places no order, consumes no usage and moves no money, like the checkout refusals above.
  if (chosen && menuRes && (menuRes.data.items || []).length > 0) {
    // The suite's own id discipline: a key that collides with an earlier run would find a
    // token row that has nothing to do with this request.
    const couponKey = `idemp_fd_coupon_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const couponCode = `FD_NO_SUCH_CODE_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const couponRes = await api('POST', '/api/customer/book-food', {
      token: custToken,
      body: {
        restaurantId: chosen.id,
        deliveryAddress: 'Test address',
        items: [{ productId: menuRes.data.items[0].id, quantity: 1 }],
        couponCode,
        idempotencyKey: couponKey,
      },
    });
    check('FD-20 book-food reads the couponCode the checkout sends and refuses an unknown code',
      couponRes.status === 400 && couponRes.data.success === false
      && couponRes.data.code === 'INVALID_PROMO_CODE',
      `status ${couponRes.status} code ${couponRes.data.code} ${String(couponRes.data.error || '').slice(0, 60)}`);

    let couponPg = null;
    try {
      couponPg = new Client({ connectionString: PG });
      await couponPg.connect();
      const noOrder = await couponPg.query(
        'SELECT 1 FROM order_creation_tokens WHERE idempotency_key = $1', [couponKey]);
      const noRedemption = await couponPg.query(
        'SELECT 1 FROM promotion_redemptions WHERE idempotency_key = $1', [`food_coupon:${couponKey}`]);
      check('FD-20b and the refusal is residue-free: no order row, no redemption consumed',
        noOrder.rows.length === 0 && noRedemption.rows.length === 0,
        `orders ${noOrder.rows.length} redemptions ${noRedemption.rows.length}`);
    } catch (err) {
      // Loud, not skipped: without the database the claim above is unproven.
      check('FD-20b and the refusal is residue-free: no order row, no redemption consumed',
        false, err.message);
    } finally {
      if (couponPg) { try { await couponPg.end(); } catch (e) { /* already closed */ } }
    }
  } else {
    check('FD-20 book-food reads the couponCode the checkout sends and refuses an unknown code',
      false, 'no restaurant menu row available to build an order body from');
    check('FD-20b and the refusal is residue-free: no order row, no redemption consumed',
      false, 'no restaurant menu row available to build an order body from');
  }

  console.log(`\nfood_discovery_ordering_contract_test: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => { console.error('FATAL', err.stack || err.message); process.exitCode = 1; });
