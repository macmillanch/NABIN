// =========================================================================
// CHECKOUT STORE-SEMANTICS CHECKS (local only)
//
// The order resolvers in repositories/OrderRepository.js read merchants,
// restaurant menus and store inventory out of PostgreSQL. Before the outage
// sweep they swallowed every database error and returned "nothing found", the
// same shape as a genuine miss. A database blip therefore surfaced to a
// customer mid-checkout as MERCHANT_NOT_FOUND / PRODUCT_NOT_FOUND — a 4xx that
// blames the customer for the platform's own outage and tells the client to
// stop retrying.
//
// These checks pin the corrected behaviour, and they prove it the same way the
// auth fail-closed suite does: a real child process pointed at a closed port on
// 127.0.0.1. Nothing here touches a hosted environment — the "unreachable
// store" is a socket that refuses the connection.
//
//   1. With the store unreachable, every resolver must THROW a 503 that
//      isStoreUnreachable() recognises, so the routes classify it as a retryable
//      outage instead of a business error.
//   2. With the store live, a resolver asked for a record that genuinely does
//      not exist must still resolve to null (or its business answer), NOT a
//      false 503. Fail-closed must not become fail-always.
// =========================================================================

const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

// A resolver outcome reduced to the only fields the verdict cares about. The
// point is the classification, not the exact wording, so both the thrown error
// and a returned value map onto the same shape.
function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      message: err && err.message
    }));
}

// --------------------------------------------------------------- child process
async function runChild(scenario) {
  const out = { scenario, ok: false };
  const db = require('./src/database');
  const { isStoreUnreachable } = require('./src/supabase');

  if (scenario === 'store_down') {
    // supabaseAdmin is constructed purely from SUPABASE_URL + a key (see
    // src/supabase.js), and every resolver takes its PostgreSQL branch whenever
    // supabaseAdmin exists — so a closed port reaches settleStore and the
    // supabase-js rejection, which is exactly the outage path under test.
    const merchantUuid = crypto.randomUUID();
    const productUuid = crypto.randomUUID();

    const merchant = await outcome(() => db.orderRepo.resolveMerchant(merchantUuid));
    out.merchant = {
      threw: merchant.threw,
      status: merchant.status,
      unreachable: merchant.threw ? isStoreUnreachable(merchant) : false
    };

    const food = await outcome(() =>
      db.orderRepo.resolveFoodProducts(merchantUuid, [{ productId: productUuid, quantity: 1 }]));
    out.food = {
      threw: food.threw,
      status: food.status,
      unreachable: food.threw ? isStoreUnreachable(food) : false
    };

    const grocery = await outcome(() =>
      db.orderRepo.resolveGroceryItems(merchantUuid, [{ productId: productUuid, quantity: 1 }]));
    out.grocery = {
      threw: grocery.threw,
      status: grocery.status,
      unreachable: grocery.threw ? isStoreUnreachable(grocery) : false
    };

    out.ok = ['merchant', 'food', 'grocery'].every(k =>
      out[k].threw === true && out[k].status === 503 && out[k].unreachable === true);
  } else if (scenario === 'store_live') {
    // Against the real local PostgreSQL: a well-formed UUID the store has no row
    // for is a genuine miss, and a genuine miss must NOT be dressed up as an
    // outage. The resolver returns null; the checkout 404s for the right reason.
    const missingMerchant = await outcome(() => db.orderRepo.resolveMerchant(crypto.randomUUID()));
    out.missingMerchant = {
      threw: missingMerchant.threw,
      isNull: missingMerchant.threw === false && missingMerchant.value === null
    };

    const missingFood = await outcome(() =>
      db.orderRepo.resolveFoodProducts(crypto.randomUUID(), [{ productId: crypto.randomUUID(), quantity: 1 }]));
    // No merchant rows means no matching product, so the business answer is a
    // 404 PRODUCT_NOT_FOUND throw — a 4xx, never a 503.
    out.missingFood = {
      threw: missingFood.threw,
      status: missingFood.status,
      unreachable: missingFood.threw ? isStoreUnreachable(missingFood) : false
    };

    out.ok = out.missingMerchant.isNull === true &&
      out.missingFood.threw === true && out.missingFood.unreachable === false &&
      out.missingFood.status !== 503;
  }
  console.log(JSON.stringify(out));
}

function spawnChild(scenario, env) {
  const res = spawnSync(process.execPath, [path.join(__dirname, 'checkout_store_semantics_test.js'), scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NABIN_CHECKOUT_CHILD: scenario, ...env }
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch (e) { /* reported below */ }
  if (!parsed) {
    return { ok: false, detail: `child printed no verdict: ${(res.stdout || '') + (res.stderr || '')}`.slice(0, 400) };
  }
  return parsed;
}

async function main() {
  // 1. The unreachable store: every resolver fails closed with a retryable 503.
  const down = spawnChild('store_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key'
  });
  check('CHK-01', down.merchant && down.merchant.threw && down.merchant.status === 503 && down.merchant.unreachable,
    `merchant lookup with the store unreachable throws a 503 outage rather than a not-found ` +
    `(threw=${down.merchant && down.merchant.threw}, status=${down.merchant && down.merchant.status})` +
    `${down.detail ? ' ' + down.detail : ''}`);
  check('CHK-02', down.food && down.food.threw && down.food.status === 503 && down.food.unreachable,
    `restaurant menu read fails closed the same way instead of an empty menu (status=${down.food && down.food.status})`);
  check('CHK-03', down.grocery && down.grocery.threw && down.grocery.status === 503 && down.grocery.unreachable,
    `store inventory read fails closed the same way instead of item-not-found (status=${down.grocery && down.grocery.status})`);

  // 2. The live store: a genuine miss is still a miss, never a false outage.
  const live = spawnChild('store_live', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true'
  });
  check('CHK-04', live.missingMerchant && live.missingMerchant.isNull,
    `with the store live, a merchant that genuinely does not exist resolves to null, not to a 503 ` +
    `(threw=${live.missingMerchant && live.missingMerchant.threw})${live.detail ? ' ' + live.detail : ''}`);
  check('CHK-05', live.missingFood && live.missingFood.threw && live.missingFood.unreachable === false &&
    live.missingFood.status !== 503,
    `and a food line over a merchant with no such product is a business 4xx, not an outage ` +
    `(status=${live.missingFood && live.missingFood.status}, unreachable=${live.missingFood && live.missingFood.unreachable})`);

  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 CHECKOUT STORE-SEMANTICS: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  process.exit(failed.length ? 1 : 0);
}

if (process.env.NABIN_CHECKOUT_CHILD) {
  runChild(process.env.NABIN_CHECKOUT_CHILD).catch(err => {
    console.log(JSON.stringify({ scenario: process.env.NABIN_CHECKOUT_CHILD, ok: false, crashed: err.message }));
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('CHECKOUT STORE-SEMANTICS ABORTED:', err.message);
    process.exit(2);
  });
}
