/*
 * The one list of tables an isolated chain link must not be able to move in `public`.
 *
 * It used to live inside `scripts/chain_scratch.js`, which meant two things. First, the guard could
 * only answer questions about the names it had been taught, and the list was maintained by whoever
 * happened to be reading a census. Second, nothing else in the harness could check itself against it:
 * `scripts/test_store_census.js` counts every table and had no way to say whether a line it reported
 * as moving was covered by the hard guard or simply unknown to it. Both files now read this module,
 * so "uncovered" is a statement the code can make instead of a human inference.
 *
 * Why each name is here is measured, not assumed: the 2026-10-15 full-chain census (two consecutive
 * 77-link runs, `.chain-logs/runs/chain_20261015_170317_21760_9af0a5` and
 * `chain_20261015_173219_24796_bd948b`) reported the same 20 tables moving in both runs. Fourteen of
 * them were already protected. The ten that were not are the additions below - `dispatch_offers` in
 * `APPEND_PROBED`, the other nine here.
 *
 * A table that is in NEITHER list is not excused: the census still counts it, and it now reports the
 * line as `UNPROTECTED` so a new mover cannot be absorbed silently. Adding it here is the fix.
 */

// Counted exactly, before and after every link. Kept to tables whose full COUNT is cheap enough to
// run twice per link for all 77 links. Measured 2026-10-15 against `public`: the largest of these is
// `audit_logs` at 277,137 rows (then `notifications` at 28,773), and one guard pass costs 769 ms for
// the snapshot and 623 ms for the compare - that is what an isolated link pays per link.
// `dispatch_offers`, at 3,095,401 rows, is what a full COUNT of it alone costs 1,121 ms, which is why
// the set below is split from `APPEND_PROBED`.
const PROTECTED = [
  // Money and integrity - the original list, append-only by trigger (migration 033).
  'orders', 'jobs', 'payments', 'payment_sessions', 'payment_webhooks',
  'ledger_entries', 'journal_transactions', 'journal_lines', 'driver_payouts',
  // Watched in advance: no `wallets` relation exists in `public` today (balances are columns on
  // `users`/`drivers`/`merchants`/`ledger_accounts`), so the guard reports it as a missing-name NOTE
  // rather than a count. It becomes an exact-counted watch the day a migration creates it.
  'wallets',
  'audit_logs',
  // Identity and catalogue: a link that restyles these dirties the store the next link reads.
  'merchants', 'users', 'products', 'order_lines', 'checkouts',
  // The restaurant family migration 042 had to put RLS on.
  'restaurant_tables', 'restaurant_sections', 'restaurant_table_sessions', 'restaurant_bills',
  'restaurant_bill_payments', 'restaurant_refunds', 'restaurant_receipts', 'restaurant_kds_tickets',
  'restaurant_reservations', 'restaurant_staff',
  // #329 additions - every one of these moved in both 2026-10-15 census runs and had no per-link
  // owner recorded. Deltas per 77-link run, measured from the two runs named in the header:
  'admin_accounts',                  // +7  (admin fixture creation)
  'backend_sessions',                // +54 (session mint/revocation during auth suites)
  'drivers',                         // +10 (driver fixtures; also the fleet the dispatch fan-out reads)
  'notifications',                   // +20
  'notification_deliveries',         // +20
  'payment_refund_authorizations',   // +6
  'promotions',                      // +1  (per-run coupon mint)
  'promotion_redemptions',           // +1
  'grocery_price_history'            // +1
];

// Bulk accumulators that must still be attributed per link, but not by a full COUNT:
// `count(*) FROM public.dispatch_offers` measured 1,121 ms against 3,084,895 rows, and the runner
// counts the protected set twice per link across 77 links. For these the per-link measurement is
// "rows whose write timestamp is after this baseline", taken with the database's own clock (never the
// harness clock, so host/container skew cannot create or hide a row) and answered by the table's
// timestamp index.
//
// What that semantics does and does not prove: it is exact for APPENDS, which is how these tables
// move during a run - the suites that touch them insert, and `scripts/reset_local_test_data.js` is
// not a chain link. A DELETE on one of these during an isolated link would therefore be invisible to
// `verify`, and so is an INSERT whose timestamp predates the baseline (a copied or back-dated row);
// `scripts/guard_detection_probe.js` measures both cases rather than asserting them. The whole-run
// census is the guard for them, because it counts every table exactly.
// That asymmetry is deliberate and priced: the alternative is ~170 s of COUNTs added to every run.
//
// The limit that applies to BOTH mechanisms, and the reason no doc may claim otherwise: they compare
// ROW COUNTS (plus the census's named-row probes). An UPDATE that adds and removes no row - a tax
// rate, a flag, a status - moves nothing they read, so it is invisible to `verify`, to `diff`, and to
// the census. Protecting against that needs a value-level watch (per-column digest), not a bigger list.
const APPEND_PROBED = [
  { table: 'dispatch_offers', column: 'created_at' }
];

// A census line is `public.table`, or `public.table[marker]` for the row-level probes
// (orders[RMSSPEC-*], restaurant_tables[T-101].qr). Classification must look at the table part,
// whichever schema the census was run against.
function tableOf(censusKey) {
  const name = String(censusKey).split('=')[0].split('[')[0].trim();
  const parts = name.split('.');
  return parts[parts.length - 1];
}

function isCovered(censusKey) {
  const t = tableOf(censusKey);
  return PROTECTED.includes(t) || APPEND_PROBED.some((p) => p.table === t);
}

// The names #329 added in the 2026-10-15 round, kept as data so `scripts/guard_detection_probe.js`
// can be told exactly which tables it owes a detection proof for instead of re-deriving the list.
const ADDITIONS_2026_10_15 = [...APPEND_PROBED.map((p) => p.table), 'admin_accounts', 'backend_sessions',
  'drivers', 'notifications', 'notification_deliveries', 'payment_refund_authorizations',
  'promotions', 'promotion_redemptions', 'grocery_price_history'];

module.exports = { PROTECTED, APPEND_PROBED, ADDITIONS_2026_10_15, tableOf, isCovered };
