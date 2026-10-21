'use strict';

// =========================================================================
// NABIN — P3 #438 GROCERY DELIVERY LIFECYCLE (written RED-before-fix, now the regression guard)
//
// The same twelve §5 conditions as `food_delivery_lifecycle_test.js`, against the grocery path.
// Both suites call the shared `scripts/delivery_lifecycle_harness.js` scenario rather than carrying
// their own copy, because two near-identical 400-line files drift, and the drift would be reported
// as "GROCERY passes and FOOD does not" when the real difference is which copy was edited.
//
// GROCERY is a separate suite because it is a separate write path, not a variant of the food one:
//   * placement is `POST /api/grocery/checkout/validate` (src/server.js:9102). The name is a lie —
//     the route's own header at :9101 records that it is the authoritative order-generation path, and
//     it writes the durable checkout AND the order;
//   * the cart is `cartItems[].inventoryId`, resolved by `resolveGroceryItems` against
//     `merchant_grocery_inventory`, so the fixture is a master-catalogue row plus one inventory line
//     (`fx.groceryItem`), and the id the order line carries is the INVENTORY id, not the catalog id;
//   * the merchant gate is `['GROCERY','HYBRID_BOTH']`, so a RESTAURANT store is refused here with
//     MERCHANT_TYPE_MISMATCH and the two suites cannot share a store;
//   * the route accepts NO `orderChannel` from the client, so unlike food it cannot be sent a
//     different channel to see what it records. It now writes `orderChannel: 'DELIVERY'` into the
//     order's `metadata` itself (:9261) — the checkout has always been delivery-only, and naming the
//     channel is what lets migration 047 gate the handover on a fact the store holds rather than on
//     the `order_channel` column, which is a 041:113 DEFAULT of 'DELIVERY' (019:545 omits the column)
//     that every order reads back regardless of what the customer chose. `metaChannel: 'DELIVERY'`
//     below therefore pins what the route writes, not what a request supplied.
//
// The defect this file was written RED against is a placement defect, not a state-machine defect:
// migration 018 allows READY_FOR_PICKUP→PICKED_UP→DELIVERED, but no grocery path created a `jobs`
// row or wrote `orders.job_id`, and the KDS/driver surfaces substituted an ORDER id where a JOB id
// belongs. Measured on the local store before this file existed: 0 of the 1,354 durable orders named
// a job. The handover now runs from this checkout at src/server.js:9314, gated on a delivery address
// the customer actually typed — the route's own `'Default Address'` fallback is refused, because a
// rider sent to "Default Address" is a job the platform invented.
//
// Every assertion reads PostgreSQL through this run's own client. The route echoes an
// `order` snapshot built from the row it just read back, which is honest, but the job link,
// the offers and the OTP columns have no echo to hide behind — they either exist in the store or
// the condition is reported as failed.
//
// Local/test only. Refuses a non-loopback target and refuses a store that is not live PostgreSQL.
// =========================================================================

const targetGuard = require('./scripts/chain_target_guard');
const { runDeliveryLifecycle } = require('./scripts/delivery_lifecycle_harness');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'grocery_delivery_lifecycle_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — grocery_delivery_lifecycle_test must run against a LIVE Postgres target, because');
  console.error('its twelve conditions are durable jobs, dispatch offers and OTP columns. Run it as');
  console.error('`node scripts/with_local_target.js node grocery_delivery_lifecycle_test.js` from backend/.');
  process.exit(2);
}

// Two SKUs: a partial-quantity or dropped-line change then shows up as a cart that no longer matches
// the durable `order_lines`, instead of hiding behind a single-item echo.
async function seed(fx, store) {
  const staple = await fx.groceryItem(store.id, { name: 'delivery rice', store_price: 180, stock_quantity: 40 });
  const fresh = await fx.groceryItem(store.id, { name: 'delivery greens', store_price: 45, stock_quantity: 30 });
  return { cart: [{ inventoryId: staple.id, quantity: 2 }, { inventoryId: fresh.id, quantity: 3 }], staple, fresh };
}

async function place({ request, token, store, cart, address, idempotencyKey }) {
  return request('POST', '/api/grocery/checkout/validate', {
    merchantId: store.id,
    cartItems: cart,
    deliveryAddress: address,
    paymentMethod: 'ONLINE',
    idempotencyKey,
  }, { Authorization: `Bearer ${token}`, 'Idempotency-Key': idempotencyKey });
}

runDeliveryLifecycle({
  suiteName: 'GROCERY DELIVERY LIFECYCLE TEST',
  prefix: 'GDL',
  label: 'gdl',
  merchantType: 'GROCERY',
  serviceType: 'GROCERY',
  metaChannel: 'DELIVERY',
  pgTarget: PG_TARGET,
  seed,
  place,
}).catch((err) => {
  console.error(`\nGROCERY DELIVERY LIFECYCLE TEST aborted: ${err && err.message}`);
  if (err && err.stack) console.error(err.stack.split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
});
