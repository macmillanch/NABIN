'use strict';

// TASK 4M permanent regression: grocery catalog authority + price-audit privilege.
//
// Covers two defects proven during 4M:
//  1. Merchant grocery inventory writes could target an INACTIVE master_grocery_catalog row, while
//     every merchant-facing catalog read already filters `is_active = true`. Fixed with the opt-in
//     `requireActive` resolver policy used only by the merchant write paths, so admin catalog
//     management can still open and reactivate an inactive product.
//  2. `actor` came from the merchant request body and `actor.startsWith('Admin')` decided whether
//     the PRICE_UPDATE audit row said ADM-EXEC / SUPER_ADMIN, so any authenticated merchant could
//     mint privileged audit evidence. Fixed by deriving the actor from the authenticated merchant
//     and passing a trusted `actorRole`; display text can no longer set authority.
//
// Local Docker Supabase only. Creates one synthetic inactive catalog row and audit rows carrying a
// unique reason marker, and removes the catalog row afterwards.

process.env.NODE_ENV = process.env.NODE_ENV || 'local';

const db = require('./src/database');
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const ACTIVE_ID = '00000000-0000-0000-0000-000000000401';
const INACTIVE_ID = '00000000-0000-0000-0000-00000000a402';
const PROBE_NAME = `ZZZ4M delisted ${Date.now()}`;
const MARK = `4m-gate-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0; let fail = 0;
const check = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` -- ${String(d).slice(0, 130)}` : ''}`); };

// Row-existence is asserted first: a missing audit row must never satisfy a negative assertion.
const auditRow = async (marker) => {
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabaseAdmin.from('audit_logs')
      .select('admin_id,admin_name,role,action,module,reason')
      .eq('action', 'PRICE_UPDATE').ilike('reason', `%${marker}%`).limit(2);
    if (error) return { error: error.message };
    if (data && data.length === 1) return { row: data[0] };
    if (data && data.length > 1) return { error: `ambiguous (${data.length} rows)` };
    await sleep(500);
  }
  return { error: 'no row found' };
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) {
    console.log('SKIP: this gate needs the durable catalog and audit_logs, not the memory mirror.');
    process.exitCode = 0; return;
  }

  // --- catalog authority -------------------------------------------------
  const { error: insErr } = await supabaseAdmin.from('master_grocery_catalog').insert({
    id: INACTIVE_ID, name: PROBE_NAME, category: 'Produce', subcategory: 'Produce', brand: 'Probe',
    standard_unit: 'kg', pack_size: '1 kg', pricing_model: 'FIXED_PRICE',
    standard_image_url: 'https://example.invalid/probe.png', is_active: false,
  });
  if (insErr) { console.log(`FATAL cannot create synthetic inactive catalog row: ${insErr.message}`); process.exitCode = 1; return; }

  try {
    check('GC-01 merchant mode refuses an inactive master product',
      (await db.resolveMasterProductId(INACTIVE_ID, { requireActive: true })) === null);
    check('GC-02 admin/default still resolves it (edit + reactivate preserved)',
      (await db.resolveMasterProductId(INACTIVE_ID)) === INACTIVE_ID);
    check('GC-03 merchant mode still accepts an ACTIVE product',
      (await db.resolveMasterProductId(ACTIVE_ID, { requireActive: true })) === ACTIVE_ID);

    let up = null;
    try { await db.updateMerchantInventoryItem({ merchantId: ACTIVE_ID, masterProductId: INACTIVE_ID, currentPrice: 55, stockQty: 10 }); }
    catch (err) { up = err.message; }
    check('GC-04 merchant inventory update refuses the inactive product',
      !!up && up.includes('not in the NABIN master grocery catalogue'), up || 'NO ERROR THROWN');

    let del = null;
    try { await db.deleteMerchantInventoryItem({ merchantId: ACTIVE_ID, masterProductId: INACTIVE_ID }); }
    catch (err) { del = err.message; }
    check('GC-05 merchant inventory delete refuses the inactive product',
      !!del && del.includes('not in the NABIN master grocery catalogue'), del || 'NO ERROR THROWN');

    check('GC-06 fuzzy name branch cannot resolve an inactive product for merchants',
      (await db.resolveMasterProductId(PROBE_NAME, { requireActive: true })) === null);
    check('GC-07 fuzzy name branch still resolves it for the admin default',
      (await db.resolveMasterProductId(PROBE_NAME)) === INACTIVE_ID);

    const inv = await supabaseAdmin.from('merchant_grocery_inventory').select('id').eq('product_id', INACTIVE_ID);
    check('GC-08 rejected writes created no inventory rows', (inv.data || []).length === 0, `rows ${(inv.data || []).length}`);
  } finally {
    await supabaseAdmin.from('master_grocery_catalog').delete().eq('id', INACTIVE_ID);
    const left = await supabaseAdmin.from('master_grocery_catalog').select('id').eq('id', INACTIVE_ID);
    console.log(`  cleanup: synthetic catalog rows remaining = ${(left.data || []).length}`);
  }

  // --- audit privilege ---------------------------------------------------
  const product = db.groceryProducts[0];
  let price = Number(product.currentPrice);
  const attempts = [
    ['spoof-admin', 'Admin Finance', 'MERCHANT'],
    ['spoof-exec', 'ADMIN EXEC OTB', 'MERCHANT'],
    ['plain-merchant', 'Fresh Mart', 'MERCHANT'],
    ['admin-legacy', 'Admin Priya', null],
  ];
  for (const [tag, actor, actorRole] of attempts) {
    price += 7;
    db.updateGroceryProductPrice({
      productId: product.id, newPrice: price, merchantId: 'gate-merchant',
      reason: `${MARK}-${tag}`, actor, ...(actorRole ? { actorRole } : {}),
    });
  }

  for (const [tag, actor, actorRole] of attempts) {
    const found = await auditRow(`${MARK}-${tag}`);
    if (found.error || !found.row) { check(`AU-${tag} audit row exists`, false, found.error || 'no row'); continue; }
    const r = found.row;
    if (actorRole === 'MERCHANT') {
      check(`AU-${tag} actor text cannot mint privileged authority`,
        r.role !== 'SUPER_ADMIN' && r.admin_id !== 'ADM-EXEC', `admin_id=${r.admin_id} role=${r.role} name=${r.admin_name}`);
      check(`AU-${tag} recorded as MERCHANT`, r.role === 'MERCHANT', `role=${r.role}`);
    } else {
      check(`AU-${tag} admin path preserved (ADM-EXEC / SUPER_ADMIN)`,
        r.admin_id === 'ADM-EXEC' && r.role === 'SUPER_ADMIN', `admin_id=${r.admin_id} role=${r.role}`);
    }
  }

  console.log(`\ngrocery_catalog_audit_integrity_test: ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch((err) => { console.error('FATAL', err.stack || err.message); process.exitCode = 1; });
