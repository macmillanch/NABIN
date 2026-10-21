'use strict';

// =========================================================================
// NABIN — P3 #438 FOOD DELIVERY LIFECYCLE (written RED-before-fix, now the regression guard)
//
// What this suite is about, in one line: a FOOD order on the DELIVERY channel must be able to
// reach PICKED_UP and then DELIVERED through a real driver job, and before #436/#439 it could not.
// The defect was not in the state machine — migration 018 allows READY_FOR_PICKUP→PICKED_UP→
// DELIVERED for a DRIVER author — it was in placement. `POST /api/customer/book-food`
// (src/server.js:4658) wrote the `orders` row and its lines and returned; no code path created a
// `jobs` row or wrote `orders.job_id`, and the KDS advance answered READY_FOR_PICKUP by broadcasting
// `NEW_JOB_DISPATCH` with the ORDER id in the `job.id` field, so a driver app was handed an id no
// job table answers to. Measured against the local store before this file existed: 0 of the 1,354
// durable orders named a job, `jobs` held 2,134 RIDE and 518 PARCEL rows and no FOOD or GROCERY row,
// and 92 orders sat at READY_FOR_PICKUP with nowhere to go.
//
// The link now exists — 047's `create_delivery_job_atomic`, called from `dispatchDeliveryJob`
// (src/server.js:367) at placement and again from the merchant's READY_FOR_PICKUP advance
// (src/server.js:5445) as the retry — and the two driver endpoints are
// `POST /api/driver/pickup-order` (src/server.js:7470) and
// `POST /api/driver/deliver-order` (src/server.js:7527). This file is the guard that they hold: it
// still drives the whole lifecycle against PostgreSQL, so a link that disappears, a job that is
// fabricated in the response but not in the store, or a route that accepts the wrong driver, reddens
// here instead of shipping.
//
// The scenario itself lives in `scripts/delivery_lifecycle_harness.js`, shared verbatim with
// `grocery_delivery_lifecycle_test.js`. That is deliberate: brief §5 lists twelve conditions, and
// the FOOD and GROCERY paths must be proven against the SAME assertions — two copies of 400 lines
// would drift, and the drift would look like a service-specific pass.
//
// This file therefore only names the FOOD half of the contract:
//   * a RESTAURANT store, because book-food rejects any other merchant_type with
//     MERCHANT_TYPE_MISMATCH;
//   * a dish from `products`, because `resolveFoodProducts` matches `items[].productId` against
//     that table by uuid;
//   * placement through `POST /api/customer/book-food`, with `orderChannel: 'DELIVERY'` explicit —
//     the route's default IS DELIVERY, and the suite still sends it so a future change of default
//     fails here instead of silently testing takeaway;
//   * a non-empty `deliveryAddress`, because DELIVERY with a blank address is a 400 PLACE_REQUIRED
//     and an order that never placed proves nothing about jobs;
//   * `metaChannel: 'DELIVERY'`, because the channel the customer chose is stored in
//     `metadata.orderChannel` and NOT in the `orders.order_channel` column — `create_order_with_lines_atomic`
//     (supabase/migrations/019_order_creation_atomic.sql:545) does not list that column, so every order
//     including a DINE_IN one reads back the 041 column DEFAULT of 'DELIVERY'. Gating the new lifecycle on
//     the column would dispatch dine-in and takeaway orders; gating it on the metadata is what this pin
//     demands. Grocery takes no channel from its client at all — its checkout writes the same
//     `DELIVERY` into its own metadata (src/server.js:9261), because that route has no
//     collect-at-counter path — so its wrapper pins that written value rather than excusing the
//     column.
//
// Every assertion reads PostgreSQL through this run's own `pg` client, not the HTTP body. Book-food
// used to answer `job: orderPayload` — an ORDER id wearing a job's name while the store held no such
// row — and that field is gone; the route now answers `deliveryJob` (src/server.js:5023) whose ids
// come from the RPC's verdict. The shape of the guarantee is unchanged: a 200 that names a job is
// only evidence once the `jobs` row, the `orders.job_id` link and the `dispatch_offers` say the
// same thing. A response that names a job the store does not hold is still exactly what these
// checks refuse to accept.
//
// Local/test only. Refuses a non-loopback backend/database target and refuses a store that is not
// live PostgreSQL, because on the mock branch the job link, the offers and the OTP columns are all
// absent by construction and the twelve conditions would be assertions about nothing.
// =========================================================================

const targetGuard = require('./scripts/chain_target_guard');
const { runDeliveryLifecycle } = require('./scripts/delivery_lifecycle_harness');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'food_delivery_lifecycle_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — food_delivery_lifecycle_test must run against a LIVE Postgres target, because');
  console.error('its twelve conditions are durable jobs, dispatch offers and OTP columns. Run it as');
  console.error('`node scripts/with_local_target.js node food_delivery_lifecycle_test.js` from backend/.');
  process.exit(2);
}

// Two dishes, so a line-removal or a partial-quantity change cannot be mistaken for the cart being
// echoed back whole.
async function seed(fx, store) {
  const dish = await fx.foodProduct(store.id, { name: 'delivery thali', price: 260 });
  const side = await fx.foodProduct(store.id, { name: 'delivery breads', price: 60 });
  return { cart: [{ productId: dish.id, quantity: 2 }, { productId: side.id, quantity: 1 }], dish, side };
}

async function place({ request, token, store, cart, address, idempotencyKey }) {
  return request('POST', '/api/customer/book-food', {
    restaurantId: store.id,
    items: cart,
    deliveryAddress: address,
    orderChannel: 'DELIVERY',
    paymentMethod: 'ONLINE',
    idempotencyKey,
  }, { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey });
}

runDeliveryLifecycle({
  suiteName: 'FOOD DELIVERY LIFECYCLE TEST',
  prefix: 'FDL',
  label: 'fdl',
  merchantType: 'RESTAURANT',
  serviceType: 'FOOD',
  metaChannel: 'DELIVERY',
  pgTarget: PG_TARGET,
  seed,
  place,
}).catch((err) => {
  // A throw here is the harness refusing to proceed (identities it cannot mint), not a failed
  // assertion, so it must land as a non-zero exit with the cause printed — never as silence.
  console.error(`\nFOOD DELIVERY LIFECYCLE TEST aborted: ${err && err.message}`);
  if (err && err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
});
