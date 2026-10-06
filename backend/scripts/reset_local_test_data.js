/*
 * LOCAL-ONLY test-data reset for the NABIN PostgreSQL stack.
 *
 * Why this exists: the regression suites write straight into `public` by design (the F-3(b)
 * Phase A reads in docs/AUTONOMOUS_BUILD_PROGRESS.md classified Phase 6/9 as C — public-attaching),
 * so months of runs left 2.2M rows behind — 1.9M of them in `dispatch_offers` alone. That residue
 * is what makes a fresh run's reads ambiguous: `SELECT id FROM users LIMIT 1` answers with
 * somebody else's old row, and a "green" suite may be passing off stale data.
 *
 * This script deletes rows. It therefore refuses everything that is not the local stack:
 *   - a non-loopback DATABASE_URL  -> REFUSED, with no override flag. Point it at the local stack.
 *   - NODE_ENV=production          -> REFUSED.
 *   - no --apply                   -> dry run: reports the counts it would remove.
 *
 * The table lists are allowlists, not patterns — a typo must skip a table, not widen the blast
 * radius. Nothing outside them is touched, and the config/fixture tables (platform_settings,
 * pricing_configurations, ledger_accounts, permission_keys, operator_roles, role_grants,
 * notification_templates, master_grocery_catalog, merchants, products, dark_stores, geo_fences,
 * surge_zones) are deliberately absent. The wipe is one multi-table TRUNCATE, and it first proves
 * that no table outside the set holds a foreign key into it — that closure is why CASCADE is never
 * needed here, and CASCADE is exactly what would reach data this script never declared.
 *
 * Usage:
 *   node scripts/reset_local_test_data.js                       # dry run, transactional tier
 *   node scripts/reset_local_test_data.js --apply               # truncate the transactional tier
 *   node scripts/reset_local_test_data.js --include-identity    # also plan users/drivers/admin_accounts
 */
const { Client } = require('pg');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// Rows produced by bookings, dispatch, payments, messaging and ledger probes.
const TRANSACTIONAL = [
  'active_sessions', 'backend_sessions', 'checkout_events', 'checkouts',
  'campaign_assets', 'campaign_messages', 'campaign_offers', 'campaign_themes', 'campaigns',
  'dark_store_reservations', 'device_tokens', 'dispatch_offers', 'driver_payouts',
  'grocery_price_history', 'identity_documents', 'jobs',
  'journal_lines', 'journal_transactions', 'ledger_entries', 'notification_deliveries',
  'notification_preferences', 'notifications', 'order_creation_tokens', 'order_lines',
  'order_transitions', 'orders', 'payment_refund_authorizations', 'payment_sessions',
  'payment_webhooks', 'payments', 'promotion_redemptions', 'promotions', 'saved_children',
  'saved_schools', 'support_tickets', 'user_delegates', 'user_saved_locations',
];

// Identities the suites mint on every run; kept separate because some probes read an existing
// row (`SELECT id FROM public.users LIMIT 1`) instead of creating one, so clearing these can
// turn a green link red for a harness reason. Only clear them deliberately.
const IDENTITY = ['users', 'drivers', 'admin_accounts'];

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;

function guard() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — refuse to guess a target');
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSED: NODE_ENV=production');
  const host = new URL(url).hostname;
  if (!LOOPBACK.test(host)) {
    throw new Error(
      `REFUSED: DATABASE_URL points at ${host}. This script only ever clears the local stack; ` +
      'remote projects (dev and production) are migrated through the Supabase dashboard/CLI, never here.'
    );
  }
  return url;
}

(async () => {
  const url = guard();
  const apply = process.argv.includes('--apply');
  const includeIdentity = process.argv.includes('--include-identity');
  const wanted = apply || includeIdentity ? [...TRANSACTIONAL, ...(includeIdentity ? IDENTITY : [])] : [...TRANSACTIONAL, ...(includeIdentity ? IDENTITY : [])];
  const c = new Client({ connectionString: url, ssl: false });
  await c.connect();

  const exists = new Set((await c.query(
    "select tablename from pg_tables where schemaname='public'"
  )).rows.map((r) => r.tablename));

  let total = 0;
  const lines = [];
  for (const t of wanted) {
    if (!exists.has(t)) { lines.push(`   skip  ${t} (table does not exist)`); continue; }
    const n = (await c.query(`select count(*)::int n from public."${t}"`)).rows[0].n;
    total += n;
    lines.push(`${String(n).padStart(9)}  ${t}`);
  }
  console.log(`${apply ? 'TRUNCATING' : 'DRY RUN — would truncate'} (${wanted.length} tables, ${total.toLocaleString()} rows)`);
  for (const l of lines) console.log(l);

  if (!apply) {
    console.log('\nNo rows removed. Re-run with --apply to clear the transactional tier'
      + (includeIdentity ? '' : ', or add --include-identity for users/drivers/admin_accounts.'));
    await c.end();
    return;
  }

  // A per-table TRUNCATE fails here: the transactional tables reference each other (orders ->
  // jobs, journal_lines -> journal_transactions, ...), so truncating one while its child still
  // holds rows trips the FK. Listing them in ONE statement is what Postgres needs — every row
  // on both sides goes at once — and it stays honest only while no referencing table lives
  // outside the set, because CASCADE would reach out of the allowlist and truncate it too.
  const present = wanted.filter((t) => exists.has(t));
  const refs = await c.query(
    `select distinct rc.relname as referencing
       from pg_constraint cc
       join pg_class rc on rc.oid = cc.conrelid
       join pg_class r  on r.oid  = cc.confrelid
      where cc.contype = 'f' and rc.relnamespace = 'public'::regnamespace
        and r.relname = any($1) and rc.relname <> r.relname`,
    [present]
  );
  const outside = refs.rows.map((row) => row.referencing).filter((t) => !present.includes(t));
  if (outside.length) {
    throw new Error(
      `Refusing to truncate: ${present.length} tables carry a foreign key from ` +
      `${outside.join(', ')} — a table outside this set. Truncating the parent would either ` +
      'fail on the constraint or, with CASCADE, clear data this script never declared.'
    );
  }

  await c.query('BEGIN');
  try {
    const list = present.map((t) => `public."${t}"`).join(', ');
    // RESTART IDENTITY so a serial key doesn't carry old test runs' offsets.
    await c.query(`TRUNCATE TABLE ${list} RESTART IDENTITY`);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK');
    console.error('Rolled back, nothing removed:', err.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
  if (!process.exitCode) console.log(`\nRemoved ${total.toLocaleString()} rows from the local stack.`);
})().catch((err) => { console.error(err.message); process.exit(1); });
