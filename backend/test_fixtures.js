/*
 * Shared isolated-fixture helper for backend suites.
 *
 * Several suites asserted against the repository's own hand-seeded rows (merchant
 * 00000000-0000-0000-0000-000000000201 and the grocery inventory hanging off it) and one of
 * them UPDATEd that shared row's merchant_type to suit itself. Six chain links then went red
 * on whichever fixture write landed last, not on product behaviour. Every fixture a suite
 * needs is created here under a unique run marker and removed by the same handle, so a suite
 * neither depends on a shared row nor overwrites one another suite uses.
 *
 * Rows created here are identifiable three ways: the name carries `FIX <label> <runId>`, the
 * phone is randomly allocated only after proving no merchant or user row already has it, and
 * every id is recorded in the handle's own registry.
 *
 * `cleanup()` deletes by OWNERSHIP SCOPE rather than by the registry alone, because the
 * application itself mints rows this file cannot predict: booking through the checkout route
 * creates the order, its lines and a KDS ticket under ids no caller ever sees, and the first
 * version of this helper deleted only its own recorded ids and then died on
 * `order_lines_restaurant_product_id_fkey` while removing the fixture dish. The scope is still
 * exactly this handle's records - the merchant, customer and order ids IT created - so nothing
 * another suite owns is ever in range, and no "delete everything that looks like test data"
 * happens anywhere.
 *
 * A delete the database refuses is collected and returned, never swallowed: the calling suite's
 * own residue check then reports the row that survived, which is the loud signal a cleanup
 * regression has to produce.
 *
 * Local/test only; refuses any non-loopback PostgreSQL target.
 */
const { Client } = require('pg');
const crypto = require('crypto');

// The handle resolves from the same explicit target the suite under test runs against.
// `DATABASE_URL` is that target: `scripts/with_local_target.js` applies it from the local-Docker
// block, and `scripts/chain_scratch.js link-env` overrides it with a clone-scoped URL carrying
// `search_path=chain_scratch`. Reading `NABIN_PG_NOTIFY` first instead meant a fixture link wrote
// `public` while the application it fed read the clone, so the chain verified one schema and the
// helper polluted another. Precedence: explicit option > shell > the env file the children load.
//
// F-C1-1: there is no fourth step. Until 2026-10-16 this list ended in a hardcoded
// loopback DSN (`postgres://<user>:<password>@127.0.0.1:54322/postgres`), so a suite invoked with nothing declared
// silently created and deleted its fixtures in a store NO configuration named — which is precisely
// the shape of the #283 split-target defect: the handle and the application under test reaching
// different databases, invisibly. Resolution now goes through `scripts/chain_target_guard.js`, the
// module that already answers "where will the children actually connect?" (shell first, because
// dotenv fills only keys the shell left undefined, then `backend/.env`), and an undeclared target is
// a refusal thrown before any socket opens. `options.connectionString` still wins: a suite that
// deliberately names its own target is the configuration this change must not break.
const targetGuard = require('./scripts/chain_target_guard');
const TARGET_KEYS = ['DATABASE_URL', 'NABIN_PG_NOTIFY'];

function resolveTarget(options = {}) {
  if (options.connectionString) return { connectionString: options.connectionString, source: 'options' };
  const declared = targetGuard.declaredTarget({ keys: TARGET_KEYS, fileEnv: targetGuard.readFileEnv() });
  if (!declared) {
    throw new Error(`test_fixtures REFUSED: no PostgreSQL target is declared — ${TARGET_KEYS.join(' / ')} are `
      + `unset in the shell and in ${targetGuard.chainEnvFile()}. Nothing was connected and no row was `
      + 'written. Run the suite under scripts/with_local_target.js for the local Docker stack, or export '
      + 'DATABASE_URL explicitly. (A hardcoded loopback fallback address used to be the fourth source; '
      + 'counting a store no configuration named is the defect that removal closes.)');
  }
  // The key name alone, so a caller can say which variable it resolved from without the URL;
  // `declaredIn` keeps the file path for a suite that wants to print where the target came from.
  return { connectionString: declared.value, source: declared.key, declaredIn: declared.source };
}

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;

// Host, port, database and search_path only — a handle must be able to name the schema it writes
// without ever carrying the password it connected with.
function describeTarget(url) {
  return { host: url.hostname, port: url.port || '', database: url.pathname.replace(/^\//, '') };
}

const uid = () => crypto.randomUUID();
const hex = (n) => crypto.randomBytes(n).toString('hex');

async function openFixtures(label = 'suite', options = {}) {
  const target = resolveTarget(options);
  const connectionString = target.connectionString;
  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch (e) {
    // Unparsable is a refusal, not a reason to fall back to the shipped DSN: guessing a target here
    // is how a fixture handle ends up writing a store its suite never meant to touch.
    throw new Error(`test_fixtures REFUSED: ${target.source} is not a parsable PostgreSQL URL`);
  }
  if (!LOOPBACK.test(parsed.hostname)) {
    throw new Error(`test_fixtures REFUSED: non-loopback PostgreSQL target (${target.source} host ${parsed.hostname})`);
  }
  // A loopback proxy in front of the production project would pass the host test, so the project ref
  // is refused on its own terms — the same unconditional refusal `chain_target_guard` applies.
  if (connectionString.includes(targetGuard.PRODUCTION_REF)) {
    throw new Error(`test_fixtures REFUSED: ${target.source} carries the production project ref `
      + `${targetGuard.PRODUCTION_REF} — a fixture handle creates and deletes rows and must never aim `
      + 'at production, loopback host or not.');
  }
  const client = new Client({ connectionString });
  await client.connect();

  // Read back from the connected session, because the URL alone does not prove which schema the
  // server resolved. A caller can now assert the handle and the suite really share one target.
  const searchPath = (await client.query('SHOW search_path')).rows[0].search_path;

  const runId = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${hex(3)}`;
  const marker = (name) => `FIX ${label} ${runId}${name ? ` ${name}` : ''}`;
  const created = { orderLines: [], orders: [], inventory: [], catalog: [], products: [], users: [], merchants: [], phones: [] };

  const digits10 = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

  // A phone the durable tables do not already know, so a fixture can never collide with - or
  // be mistaken for - a row another suite or a previous run owns.
  async function freePhone(table) {
    if (table !== 'merchants' && table !== 'users') throw new Error('test_fixtures: unknown phone table');
    for (let i = 0; i < 40; i++) {
      const phone = `+919${String(crypto.randomInt(0, 1e8)).padStart(8, '0')}`;
      const { rows } = await client.query(
        `SELECT 1 FROM ${table} WHERE right(regexp_replace(phone, '\\D', '', 'g'), 10) = $1 LIMIT 1`,
        [digits10(phone)]
      );
      if (!rows.length) return phone;
    }
    throw new Error(`test_fixtures: could not allocate an unused ${table} phone`);
  }

  async function merchant({ type = 'RESTAURANT', name = '', is_open = true, phone } = {}) {
    // An explicit phone is allowed for the duplicate-number case; a fresh one is allocated
    // only after proving no merchant row already answers to it.
    const number = phone || await freePhone('merchants');
    const { rows } = await client.query(
      // `approval_status = 'APPROVED'` is written, not defaulted: a fixture here stands for a store
      // the platform has onboarded, which is what every caller's merchant-scoped request assumes.
      // Migration 048's DEFAULT is PENDING on purpose, so an omitted column would make these suites
      // test a storefront the gate is designed to refuse.
      `INSERT INTO merchants (id, name, merchant_type, phone, address, lat, lng, is_open, approval_status)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 23.7176, 92.7176, $5, 'APPROVED')
       RETURNING id::text id`,
      [marker(name), type, number, 'Fixture Street 1, Aizawl', is_open]
    );
    const m = { id: rows[0].id, phone: number, type };
    created.merchants.push(m.id);
    created.phones.push(number);
    return m;
  }

  async function customer({ name = '', identity_status = 'VERIFIED', account_status = 'ACTIVE' } = {}) {
    const phone = await freePhone('users');
    const { rows } = await client.query(
      `INSERT INTO users (id, phone, name, address, identity_status, account_status, wallet_balance, rating)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 500, 4.5)
       RETURNING id::text id`,
      [phone, marker(name), 'Flat 402, Civil Lines Hub, North Delhi', identity_status, account_status]
    );
    const u = { id: rows[0].id, phone, name: marker(name) };
    created.users.push(u.id);
    created.phones.push(phone);
    return u;
  }

  async function foodProduct(merchantId, { name = '', category = 'Fixture Category', price = 120, is_available = true } = {}) {
    const { rows } = await client.query(
      `INSERT INTO products (id, merchant_id, name, category, price, is_available, in_stock_quantity, prep_time_minutes)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, $4, $5, 50, 15)
       RETURNING id::text id`,
      [merchantId, marker(name), category, price, is_available]
    );
    const p = { id: rows[0].id, name: marker(name), price: Number(price) };
    created.products.push(p.id);
    return p;
  }

  // One master-catalogue row plus the merchant's own inventory line for it. Checkout resolves
  // the inventory id, so that is what callers put in a cart.
  async function groceryItem(merchantId, { name = '', category = 'Fixture Aisle', store_price = 60,
    stock_quantity = 50, standard_unit = 'piece', pack_size = '1 piece', is_available = true,
    status = 'AVAILABLE' } = {}) {
    const catalogName = marker(name);
    const cat = await client.query(
      `INSERT INTO master_grocery_catalog (id, name, category, standard_unit, pack_size, standard_image_url, pricing_model, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'https://images.example.invalid/fixture.png', 'FIXED_PRICE', true)
       RETURNING id::text id`,
      [catalogName, category, standard_unit, pack_size]
    );
    created.catalog.push(cat.rows[0].id);
    const inv = await client.query(
      `INSERT INTO merchant_grocery_inventory (id, merchant_id, product_id, store_price, stock_quantity, is_available, status)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4, $5, $6)
       RETURNING id::text id`,
      [merchantId, cat.rows[0].id, store_price, stock_quantity, is_available, status]
    );
    const item = { id: inv.rows[0].id, catalogId: cat.rows[0].id, name: catalogName,
      store_price: Number(store_price), stock_quantity, unit: standard_unit };
    created.inventory.push(item.id);
    return item;
  }

  // Direct order minting, for suites that must assert over a body of past orders rather than
  // book one through checkout. Lines use the durable catalog the fixture created, so
  // order_lines' catalog_kind checks and cross-tenant trigger are satisfied by real ids.
  async function order({ customerId, merchantId, serviceType = 'FOOD', total_amount, state = 'RECEIVED',
    payment_status = 'PENDING', payment_method = 'ONLINE', channel = 'DELIVERY', lines = [], created_at }) {
    const order_number = `FIX-${runId}-${hex(3)}`;
    const currencyRow = lines.length ? lines[0].currency : null;
    const ins = await client.query(
      `INSERT INTO orders (id, order_number, customer_id, merchant_id, service_type, order_state,
         previous_state, total_amount, currency, order_channel, payment_status, payment_method,
         items_snapshot, created_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, $4, $5, $5, $6, $7, $8, $9, $10, $11::jsonb,
         COALESCE($12::timestamptz, now()))
       RETURNING id::text id`,
      [order_number, customerId, merchantId, serviceType, state, total_amount,
        currencyRow || 'INR', channel, payment_status, payment_method,
        JSON.stringify(lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unit_price_snapshot }))),
        created_at || null]
    );
    const id = ins.rows[0].id;
    created.orders.push(id);
    for (const l of lines) {
      const lineTotal = Number((Number(l.unit_price_snapshot) * Number(l.quantity)).toFixed(2));
      const isGrocery = serviceType === 'GROCERY';
      const lr = await client.query(
        `INSERT INTO order_lines (id, order_id, merchant_id, catalog_kind, restaurant_product_id,
           grocery_inventory_id, product_name_snapshot, quantity, unit_snapshot, unit_price_snapshot, line_total)
         VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6, $7, $8, $9, $10)
         RETURNING id::text id`,
        [id, merchantId, isGrocery ? 'GROCERY_INVENTORY' : 'RESTAURANT_PRODUCT',
          isGrocery ? null : l.productId, isGrocery ? l.inventoryId : null,
          l.name, l.quantity, l.unit || 'piece', l.unit_price_snapshot, lineTotal]
      );
      created.orderLines.push(lr.rows[0].id);
    }
    return { id, order_number };
  }

  // Kitchen tickets the application minted for the order ids the caller names. Narrow on purpose:
  // migration 043 made `restaurant_kds_tickets` durable, so every successful food checkout now
  // leaves a ticket behind, and a suite that books through the shared demo customer owns neither
  // that merchant nor that customer, so `cleanup()`'s ownership scope cannot reach its ticket.
  // The order itself is deliberately NOT touched here — orders are the rows this project treats as
  // immutable, and a subtree delete would also reap `payments` while its journal rows stayed, which
  // is how a cleanup ends up unbalancing the ledger. Only the ids the caller passes are in range,
  // so this can never become "delete everything that looks like test data".
  async function removeKdsTicketsFor(orderIds) {
    const ids = Array.from(new Set((orderIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!ids.length) return { asked: 0, removed: 0, blocked: [] };
    try {
      const { rowCount } = await client.query(
        `DELETE FROM restaurant_kds_tickets WHERE order_id = ANY($1::uuid[])`, [ids]);
      return { asked: ids.length, removed: rowCount, blocked: [] };
    } catch (e) {
      return { asked: ids.length, removed: 0,
        blocked: [{ table: 'restaurant_kds_tickets', code: e.code, error: String(e.message).slice(0, 140) }] };
    }
  }

  // Which tables point at our rows is DISCOVERED from the catalog instead of guessed, because a
  // fixture order booked through the application's own checkout grows rows this helper was never
  // told about - the lines, the KDS ticket, the payment - and their names are exactly the kind of
  // thing a guessed column name gets wrong. Single-column foreign keys only: a composite key
  // matched column by column would delete rows that merely share one value.
  async function childTablesOf(parent) {
    const { rows } = await client.query(
      `SELECT src.relname AS child, att.attname AS column_name
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid = con.confrelid
         JOIN pg_class src ON src.oid = con.conrelid AND src.relkind = 'r'
         JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         JOIN pg_attribute att ON att.attrelid = src.oid AND att.attnum = con.conkey[1]
                                  AND NOT att.attisdropped
        WHERE con.contype = 'f' AND rel.relname = $1 AND array_length(con.conkey, 1) = 1
          AND src.relnamespace = ns.oid
          AND ns.nspname = current_schema()`,
      [parent]);
    return rows;
  }

  const IDENT = /^[a-z_][a-z0-9_]*$/i;

  // F-C1-4: the money rows are not this helper's to reap, because the rows that document them cannot
  // be reaped by anyone. Measured 2026-10-16 against the local `public` store as role `postgres`:
  //
  //   - `payments` and `payment_sessions` hang off a fixture customer by FK (`customer_id`, NO
  //     ACTION) and their only trigger is `BEFORE UPDATE`, so a DELETE on them is never refused.
  //   - `ledger_entries` (1041 rows), `journal_transactions` (5195) and `journal_lines` (10384)
  //     carry `prevent_financial_row_mutation()` on `BEFORE DELETE OR UPDATE`, which RAISEs for
  //     EVERY role including `postgres`, so cleanup can neither delete nor rebalance them.
  //   - The two sets share no key. `ledger_entries` and `journal_transactions` point only at
  //     `jobs(job_id)`, and `journal_lines` only at its own journal plus `ledger_accounts`; their
  //     `reference_id` holds a gateway string (`order_pay_phase16_…`), and 0 of 1041 ledger rows
  //     name a `payments` row by any stored value. So PostgreSQL cannot refuse the money delete on
  //     the ledger's behalf — while 170 of the 170 journaled ledger rows share their `job_id` with
  //     a payments row that this cleanup deletes out from under them (85 of the 587 job-carrying
  //     journal rows do).
  //   - One append-only table does reach into the money, and it guards a subset: 698 of the 879
  //     `payments` rows are named by `payment_refund_authorizations.payment_id` (`NO ACTION`) and the
  //     engine refuses those deletes with 23503; the other 181 are deletable by any role. Protection
  //     that depends on whether a refund was ever authorized is not a rule cleanup can rely on.
  //
  // That is a half-reaped double-entry ledger: the durable audit says the money happened and the
  // money is gone, so ledger consistency cannot be proven for these two tables. The risky case is
  // therefore DISABLED: the rows are kept, counted and reported under `kept`, and the fixture
  // customers that own them are kept with them, because deleting such a user either is refused by
  // NO ACTION (a `blocked` entry, which means a bug, not a decision) or silently orphans the money
  // row that was just kept. A suite that needs its customer gone again must run as an isolated link
  // against a disposable schema (scripts/chain_scratch.js), where the ledger and the money are
  // discarded together — that is the safe design; the measurement behind this rule is recorded in
  // scratch/review_20261016_c1/fc14_*.log.
  const KEPT_FINANCIAL = ['payments', 'payment_sessions'];

  async function cleanup() {
    const removed = {};
    const blocked = [];
    const kept = {
      financial: [],
      users: 0,
      reason: 'the append-only ledger/journal rows that document this money cannot be deleted by any '
        + 'role, and they link to it by job_id plus unvalidated varchar columns (reference_id, '
        + 'entity_id), so "no audit row describes this payment" is not provable here — see KEPT_FINANCIAL',
    };
    const merchants = created.merchants;
    const phoneKeys = created.phones.map(digits10);
    // A fixture phone was proven unowned when it was allocated, so any user row carrying it -
    // including one the authentication path auto-registered when a suite handed it a phone in a
    // shape the store did not already have - can only belong to this handle.
    let users = created.users.slice();
    if (phoneKeys.length) {
      const byPhone = await client.query(
        `SELECT id::text id FROM users
          WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($1::text[])`, [phoneKeys]);
      users = Array.from(new Set(users.concat(byPhone.rows.map((r) => r.id))));
    }

    // Orders this handle owns: the ones it inserted, plus any the application minted for one of
    // its fixture merchants or placed by one of its fixture customers.
    let orderIds = created.orders.slice();
    if (merchants.length || users.length) {
      const extra = await client.query(
        `SELECT id::text id FROM orders WHERE merchant_id = ANY($1::uuid[]) OR customer_id = ANY($2::uuid[])`,
        [merchants, users]);
      orderIds = Array.from(new Set(orderIds.concat(extra.rows.map((r) => r.id))));
    }

    // A validated grocery checkout auto-provisions a `checkouts` row, so that session is this
    // handle's record as much as the order is. It is reachable three ways - by its own merchant
    // binding, by the fixture customer, and by the order it later links to - and the order link is
    // only readable while the orders still exist, so that scan runs before the deletes.
    let checkoutIds = [];
    if (merchants.length || users.length) {
      const linked = await client.query(
        `SELECT DISTINCT checkout_id::text id FROM orders
          WHERE checkout_id IS NOT NULL AND (merchant_id = ANY($1::uuid[]) OR customer_id = ANY($2::uuid[]))`,
        [merchants, users]);
      checkoutIds = linked.rows.map((r) => r.id);
    }

    const del = async (table, where, ids, kind) => {
      if (!ids.length) { if (!(table in removed)) removed[table] = 0; return; }
      if (!IDENT.test(table) || !IDENT.test(where)) throw new Error(`test_fixtures: refusing identifier ${table}.${where}`);
      try {
        const { rowCount } = await client.query(
          `DELETE FROM ${table} WHERE ${where} = ANY($1::${kind}[])`, [ids]);
        removed[table] = (removed[table] || 0) + rowCount;
      } catch (e) {
        // A refused delete is reported, not swallowed: the suite's own residue check then names
        // the row that survived, which is the loud signal a cleanup regression has to produce.
        blocked.push({ table, code: e.code, error: String(e.message).slice(0, 140) });
      }
    };

    // children first, three levels deep at most, each level scoped to ids this handle created
    for (const [parent, ids, kind] of [['orders', orderIds, 'uuid'], ['products', created.products, 'uuid']]) {
      if (!ids.length) continue;
      for (const { child, column_name } of await childTablesOf(parent)) {
        await del(child, column_name, ids, kind);
      }
    }
    // an order line can also belong to a fixture merchant without the order being listed here
    await del('order_lines', 'merchant_id', merchants, 'uuid');
    // A delivery job hangs off the store it hands over from, and `jobs.merchant_id REFERENCES
    // merchants(id)` carries no ON DELETE clause (001_central_schema.sql), so a job that outlives its
    // order blocks the merchant delete below with 23503. It was unreachable before P3 #436 because
    // nothing ever minted a FOOD/GROCERY job - measured 2026-10-19: the checkout fixture's four
    // grocery orders left four jobs behind (`jobs:0` removed, `residue j:4`, merchants blocked), while
    // the `jobs` delete under the users loop below matched nothing, because the order's customer is a
    // seeded row and not one of this handle's. Scope is the same exact-id ownership as `orders`:
    // `created.merchants` only ever holds stores this handle INSERTED (test_fixtures.js `merchant()`).
    // A job that carries money is NOT reaped here by accident - `payments`, `payment_sessions`,
    // `ledger_entries`, `journal_transactions` and `payment_refund_authorizations` all reference
    // `jobs(id)` with NO ACTION, so such a delete is refused and surfaces in `blocked` as a red,
    // which is the F-C1-4 rule: a fixture cannot silently delete the rows an audit points at.
    await del('jobs', 'merchant_id', merchants, 'uuid');
    await del('orders', 'merchant_id', merchants, 'uuid');
    await del('orders', 'customer_id', users, 'uuid');
    await del('checkouts', 'merchant_id', merchants, 'uuid');
    await del('checkouts', 'customer_id', users, 'uuid');
    await del('checkouts', 'id', checkoutIds, 'uuid');
    await del('merchant_grocery_inventory', 'merchant_id', merchants, 'uuid');
    // Every price this suite wrote on its own shelf is recorded against that merchant, so the
    // history is its record too; left alone it accumulates one row per chain run.
    await del('grocery_price_history', 'merchant_id', merchants, 'uuid');
    await del('products', 'merchant_id', merchants, 'uuid');
    await del('master_grocery_catalog', 'id', created.catalog, 'uuid');
    // the sessions this suite authenticated are its own records too, and they hold the phone
    if (phoneKeys.length) {
      await client.query(
        `DELETE FROM backend_sessions
          WHERE right(regexp_replace(coalesce(phone,''), '\\D', '', 'g'), 10) = ANY($1::text[])`, [phoneKeys])
        .then((r) => { removed.backend_sessions = r.rowCount; })
        .catch((e) => blocked.push({ table: 'backend_sessions', code: e.code, error: String(e.message).slice(0, 140) }));
    }
    for (const { child, column_name } of await childTablesOf('users')) {
      // F-C1-4: the money tables are skipped by name, not by accident - see KEPT_FINANCIAL.
      if (KEPT_FINANCIAL.includes(child)) continue;
      await del(child, column_name, users, 'uuid');
    }
    // Count what was kept before the registry is cleared, so the evidence names the rows a later
    // run will find still standing.
    for (const table of KEPT_FINANCIAL) {
      if (!users.length) break;
      const { rows } = await client.query(
        `SELECT count(*)::int n FROM ${table} WHERE customer_id = ANY($1::uuid[])`, [users]);
      if (rows[0].n) { kept.financial.push({ table, rows: rows[0].n }); }
    }
    if (kept.financial.length) {
      // The customer stays with its money: NO ACTION would refuse the delete anyway, and a refusal
      // in `blocked` reads as a cleanup bug, while this is a documented decision.
      kept.users = users.length;
    } else {
      await del('users', 'id', users, 'uuid');
    }
    // merchants go last: the restaurant_* family cascades from them
    await del('merchants', 'id', merchants, 'uuid');

    for (const key of Object.keys(created)) created[key] = [];
    const evidence = { blocked };
    // Reported only when something was actually kept, so a suite that never touched a payment
    // still reads the same cleanup summary it read before this rule existed.
    if (kept.financial.length) evidence.kept = kept;
    return Object.assign(removed, evidence);
  }

  async function close() {
    const removed = await cleanup();
    await client.end();
    return removed;
  }

  return {
    client, runId, marker, created, cleanup, close, freePhone,
    merchant, customer, foodProduct, groceryItem, order,
    removeKdsTicketsFor,
    target: Object.assign({ source: target.source, searchPath }, describeTarget(parsed)),
    query: (sql, params) => client.query(sql, params),
    one: async (sql, params) => (await client.query(sql, params)).rows[0],
  };
}

module.exports = { openFixtures, resolveTarget, TARGET_KEYS };
