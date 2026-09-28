/*
 * Merchant tenant isolation and service-entitlement regression.
 *
 * This suite exists because the merchant security surface had NO dedicated zero-skip coverage:
 * merchant_operations_test.js reaches a merchant session only through the non-production
 * "no merchant for this phone -> use restaurants[0]" fallback (Finding A), so it cannot prove
 * that one registered store cannot reach another's data.
 *
 * Every identity here is a REAL registered merchant row authenticated through the
 * application's own deterministic test OTP. Nothing is forged, no session row is inserted,
 * no fallback identity is relied on, and no check is skipped: if any of the four contexts
 * cannot authenticate, that is a loud failure, which is exactly the information needed.
 *
 *   9888000001 RESTAURANT  (tenant A)
 *   9888000003 RESTAURANT  (tenant B, same family as A - the interesting cross-tenant pair)
 *   9888000002 GROCERY
 *   9811223344 HYBRID_BOTH
 *
 * Mutations are proven with durable before/after reads. Where a table's column name is not
 * already known it is DISCOVERED from information_schema at runtime rather than guessed,
 * because guessing column names is the recurring failure mode of this programme.
 *
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('MTI REFUSED: non-loopback target'); process.exit(1);
}

const OTP = process.env.NABIN_TEST_OTP || '7729';
const PHONES = { A: '9888000001', B: '9888000003', G: '9888000002', H: '9811223344' };
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 210)}` : ''));
}
const api = async (method, path, body, token) => {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { 'Authorization': `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { status: res.status, data: json || {} };
};
// normalise exactly the way the app does: digits only, last ten
const norm = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const many = async (sql, p) => (await c.query(sql, p)).rows;

  // ---- resolve each test phone to its real merchant row (read-only, no guessing) ----
  const rowsByPhone = new Map();
  for (const r of await many('SELECT id::text id, phone, name, merchant_type FROM merchants')) {
    const k = norm(r.phone);
    if (!rowsByPhone.has(k)) rowsByPhone.set(k, []);
    rowsByPhone.get(k).push(r);
  }
  const idFor = (key) => {
    const rows = rowsByPhone.get(norm(PHONES[key])) || [];
    if (rows.length !== 1) {
      console.log(`  FATAL: phone for context ${key} (${PHONES[key]}) matched ${rows.length} merchants; `
        + 'this suite requires an unambiguous registered merchant');
      process.exit(1);
    }
    return { id: rows[0].id, type: rows[0].merchant_type, name: rows[0].name };
  };
  const A = idFor('A'), B = idFor('B'), G = idFor('G'), H = idFor('H');
  console.log(`  contexts: A=${A.type} ${A.id.slice(0, 13)} | B=${B.type} ${B.id.slice(0, 13)} | `
    + `G=${G.type} ${G.id.slice(0, 13)} | H=${H.type} ${H.id.slice(0, 13)}`);
  check('MTI-00', 'the four test phones resolve to exactly one unambiguous merchant row each',
    A.type === 'RESTAURANT' && B.type === 'RESTAURANT' && G.type === 'GROCERY' && H.type === 'HYBRID_BOTH',
    { A: A.type, B: B.type, G: G.type, H: H.type });

  // ---- A-D: authenticate through the application's own OTP flow ----
  const tok = {};
  for (const [key, label] of [['A', 'RESTAURANT A'], ['B', 'RESTAURANT B'], ['G', 'GROCERY'], ['H', 'HYBRID_BOTH']]) {
    const r = await api('POST', '/api/auth/verify-otp', { phone: PHONES[key], otp: OTP, role: 'MERCHANT' });
    tok[key] = r.data && r.data.token;
    check(`MTI-${key === 'A' ? '01' : key === 'B' ? '02' : key === 'G' ? '03' : '04'}`,
      `${label} can authenticate with the deterministic test OTP`,
      r.status === 200 && !!tok[key], { status: r.status, code: r.data.code, err: r.data.error });
  }
  if (!tok.A || !tok.B || !tok.G || !tok.H) {
    console.log('  FATAL: a legitimate merchant context could not be authenticated - see failures above.');
    console.log('  This suite refuses to continue rather than skipping the dependent checks.');
    process.exitCode = 1; await c.end(); return;
  }

  // ---- entitlement discovery endpoint reports the authenticated merchant's own services ----
  const svcA = await api('GET', '/api/merchant/services', undefined, tok.A);
  const svcH = await api('GET', '/api/merchant/services', undefined, tok.H);
  const servicesOf = (d) => JSON.stringify(d);
  check('MTI-05', 'services endpoint answers for both a single-service and a hybrid merchant',
    svcA.status === 200 && svcH.status === 200, { a: svcA.status, h: svcH.status });
  check('MTI-06', 'the hybrid merchant is told it holds both families and the restaurant-only one is not',
    /HYBRID_BOTH/.test(servicesOf(svcH)) && !/HYBRID_BOTH/.test(servicesOf(svcA)),
    { hybridHasHybrid: /HYBRID_BOTH/.test(servicesOf(svcH)), restaurantHasHybrid: /HYBRID_BOTH/.test(servicesOf(svcA)) });

  // ---- E/F: cross-tenant dashboard, both directions, with durable proof ----
  const dashA_own = await api('GET', `/api/merchant/${A.id}/dashboard`, undefined, tok.A);
  const dashA_ofB = await api('GET', `/api/merchant/${B.id}/dashboard`, undefined, tok.A);
  const dashB_ofA = await api('GET', `/api/merchant/${A.id}/dashboard`, undefined, tok.B);
  check('MTI-07', "merchant A's own dashboard resolves when A names itself",
    dashA_own.status === 200, { status: dashA_own.status, code: dashA_own.data.code });
  check('MTI-08', 'A cannot read B\'s dashboard by putting B\'s id in :restaurantId',
    dashA_ofB.status === 403 && !Array.isArray(dashA_ofB.data.orders),
    { status: dashA_ofB.status, code: dashA_ofB.data.code, keys: Object.keys(dashA_ofB.data) });
  check('MTI-09', 'and B cannot read A\'s dashboard the same way (symmetry)',
    dashB_ofA.status === 403, { status: dashB_ofA.status, code: dashB_ofA.data.code });

  // ---- C: order isolation. Find a RESTAURANT merchant that really owns orders and whose phone
  // is unambiguous, authenticate as it, and take the order through its own authenticated read.
  // B itself may own nothing, so the attacker/owner pair is discovered rather than assumed.
  const ownerRows = await many(`SELECT m.id::text mid, m.phone, m.merchant_type, count(o.id)::text n
      FROM merchants m JOIN orders o ON o.merchant_id = m.id
      GROUP BY m.id, m.phone, m.merchant_type HAVING count(o.id) > 0 ORDER BY 4 DESC LIMIT 8`);
  const owner = ownerRows.map(r => ({ ...r, rows: rowsByPhone.get(norm(r.phone)) || [] }))
    .find(r => r.rows.length === 1);
  const foreign = ownerRows.map(r => ({ ...r, rows: rowsByPhone.get(norm(r.phone)) || [] }))
    .find(r => r.rows.length === 1 && r.mid !== (owner && owner.mid));
  check('MTI-10', 'a legitimate owner/attacker merchant pair with real orders and unambiguous phones exists',
    !!owner && !!foreign,
    { owner: owner && `${owner.merchant_type}/${owner.n} orders`, attacker: foreign && `${foreign.merchant_type}/${foreign.n} orders` });

  let bOrderId = null, tokOwner = null, tokAtk = null;
  if (owner && foreign) {
    const vo = await api('POST', '/api/auth/verify-otp', { phone: owner.phone, otp: OTP, role: 'MERCHANT' });
    const va = await api('POST', '/api/auth/verify-otp', { phone: foreign.phone, otp: OTP, role: 'MERCHANT' });
    tokOwner = vo.data && vo.data.token; tokAtk = va.data && va.data.token;
    check('MTI-10B', 'both order-bearing merchants authenticate with the test OTP',
      vo.status === 200 && va.status === 200 && !!tokOwner && !!tokAtk, { owner: vo.status, atk: va.status });
    const ownOrders = await api('GET', `/api/merchant/${owner.mid}/orders`, undefined, tokOwner);
    const list = (ownOrders.data && (ownOrders.data.orders || ownOrders.data.data)) || [];
    bOrderId = list[0] && (list[0].id || list[0].orderId);
    check('MTI-10C', "the owner's own authenticated read reveals a real order id (nothing invented)",
      ownOrders.status === 200 && !!bOrderId, { status: ownOrders.status, count: list.length, bOrderId });
  } else {
    check('MTI-10B', 'owner/attacker merchant sessions', false, { note: 'no eligible pair' });
    check('MTI-10C', 'a real order id was discovered', false, { note: 'no eligible pair' });
  }

  // column discovery, because guessing an orders column name has burned this programme before;
  // the durability proof itself compares the WHOLE row, which needs no name knowledge at all.
  const ordCols = await many(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='orders' ORDER BY ordinal_position`);
  const names = ordCols.map(r => r.column_name);
  const statusCol = names.find(n => /status|state/i.test(n));
  const merchantCol = names.find(n => /^merchant_id$/i.test(n));
  check('MTI-11', 'the orders table exposes a discoverable status-like and merchant column',
    !!statusCol && !!merchantCol, { statusCol, merchantCol, cols: names.length });

  if (bOrderId && merchantCol && tokAtk) {
    const before = await one(`SELECT to_jsonb(o)::text row FROM orders o WHERE id = $1::uuid`, [bOrderId]);
    const asAtk = await api('POST', `/api/merchant/orders/${bOrderId}/status`,
      { status: 'PREPARING', reason: 'MTI cross-tenant attempt' }, tokAtk);
    const after = await one(`SELECT to_jsonb(o)::text row FROM orders o WHERE id = $1::uuid`, [bOrderId]);
    check('MTI-12', 'a merchant cannot mutate another merchant\'s order status',
      asAtk.status === 403 || asAtk.status === 404,
      { status: asAtk.status, code: asAtk.data.code, err: String(asAtk.data.error || '').slice(0, 60) });
    check('MTI-13', 'the entire durable order row is byte-identical across the attempt',
      !!before && !!after && before.row === after.row,
      { changed: before && after ? before.row !== after.row : 'no row' });
    const ownRow = after ? JSON.parse(after.row) : {};
    check('MTI-14', 'and the order still belongs to its original merchant',
      String(ownRow[merchantCol]) === String(owner.mid), { owner: String(ownRow[merchantCol]).slice(0, 13) });
  } else {
    check('MTI-12', 'cross-tenant order mutation was attempted and denied', false,
      { note: bOrderId ? 'no attacker token' : 'no order discovered for any eligible merchant' });
    check('MTI-13', 'durable order row unchanged', false, { note: 'not executed' });
    check('MTI-14', 'order ownership unchanged', false, { note: 'not executed' });
  }

  // ---- G/H: service entitlement, both directions, and zero financial movement ----
  const finBefore = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl, (SELECT count(*) FROM driver_payouts)::text po`);
  const invAsRestaurant = await api('GET', '/api/merchant/inventory', undefined, tok.A);
  const invPostAsRestaurant = await api('POST', '/api/merchant/inventory',
    { masterProductId: '00000000-0000-0000-0000-000000000000', stock: 5 }, tok.A);
  check('MTI-15', 'RESTAURANT is refused the GROCERY inventory read with an entitlement status',
    invAsRestaurant.status === 403, { status: invAsRestaurant.status, code: invAsRestaurant.data.code });
  check('MTI-16', 'RESTAURANT is refused the GROCERY inventory write',
    invPostAsRestaurant.status === 403,
    { status: invPostAsRestaurant.status, code: invPostAsRestaurant.data.code });
  const priceAsGrocery = await api('GET', '/api/merchant/inventory', undefined, tok.G);
  check('MTI-17', 'the same GROCERY read is allowed for a real grocery merchant (so 403 above was entitlement, not breakage)',
    priceAsGrocery.status === 200, { status: priceAsGrocery.status, code: priceAsGrocery.data.code });

  // GROCERY must not reach the restaurant-only menu control
  const restMenu = await many(`SELECT id, is_available FROM menu_items WHERE restaurant_id = $1::uuid LIMIT 1`, [B.id])
    .catch(() => []);
  if (restMenu.length) {
    const item = restMenu[0];
    const groceryToggle = await api('POST', `/api/merchant/${B.id}/menu/${item.id}/toggle`,
      { available: !item.is_available }, tok.G);
    check('MTI-18', 'GROCERY cannot toggle a RESTAURANT menu item',
      groceryToggle.status === 403,
      { status: groceryToggle.status, code: groceryToggle.data.code });
    const stillSame = await many(`SELECT is_available FROM menu_items WHERE id = $1`, [item.id]);
    check('MTI-19', 'the refused toggle left the menu row unchanged',
      stillSame.length === 1 && stillSame[0].is_available === item.is_available,
      { before: item.is_available, after: stillSame[0] && stillSame[0].is_available });
  } else {
    const groceryToggle = await api('POST', `/api/merchant/${B.id}/menu/00000000-0000-0000-0000-000000000001/toggle`,
      { available: true }, tok.G);
    check('MTI-18', 'GROCERY cannot reach the RESTAURANT menu control (refused before any item lookup)',
      groceryToggle.status === 403,
      { status: groceryToggle.status, code: groceryToggle.data.code, note: 'B has no menu_items rows' });
    check('MTI-19', 'no menu mutation was possible to verify because this restaurant has no menu rows',
      groceryToggle.status === 403, { status: groceryToggle.status });
  }

  const restaurantMenuAsGrocery = await api('POST', `/api/merchant/${G.id}/menu/x/toggle`, { available: true }, tok.G);
  check('MTI-20', 'a grocery merchant naming a grocery id on the restaurant menu route is still refused',
    restaurantMenuAsGrocery.status === 403,
    { status: restaurantMenuAsGrocery.status, code: restaurantMenuAsGrocery.data.code });

  // ---- I: hybrid reaches both families ----
  const invAsHybrid = await api('GET', '/api/merchant/inventory', undefined, tok.H);
  const dashHybrid = await api('GET', `/api/merchant/${H.id}/dashboard`, undefined, tok.H);
  check('MTI-21', 'HYBRID_BOTH is allowed the GROCERY inventory read',
    invAsHybrid.status === 200, { status: invAsHybrid.status, code: invAsHybrid.data.code });
  check('MTI-22', 'HYBRID_BOTH is allowed its own dashboard',
    dashHybrid.status === 200, { status: dashHybrid.status, code: dashHybrid.data.code });

  // ---- client-supplied merchant identifiers must not switch the tenant ----
  const spoofBody = { merchantId: B.id, restaurantId: B.id, id: B.id };
  const spoofInv = await api('POST', '/api/merchant/inventory',
    Object.assign({ masterProductId: '00000000-0000-0000-0000-000000000000', stock: 1 }, spoofBody), tok.G);
  check('MTI-23', 'a body-supplied merchantId/restaurantId cannot make GROCERY act as B',
    spoofInv.status === 403 || spoofInv.status === 400 || spoofInv.status === 404,
    { status: spoofInv.status, code: spoofInv.data.code });
  const spoofDash = await api('GET', `/api/merchant/${G.id}/dashboard`, undefined, tok.G);
  const spoofNamedSelf = await api('GET', `/api/merchant/${B.id}/dashboard`, undefined, tok.G);
  check('MTI-24', 'naming another merchant in the path is refused even for a valid own-id route shape',
    spoofNamedSelf.status === 403 || spoofNamedSelf.status === 404,
    { own: spoofDash.status, foreign: spoofNamedSelf.status });

  // ---- unknown merchant must fail closed, never fall through to another merchant ----
  const unknown = await api('GET', '/api/merchant/00000000-dead-beef-0000-000000000000/dashboard',
    undefined, tok.A);
  check('MTI-25', 'an unknown :restaurantId does not silently resolve to some other merchant',
    unknown.status === 403 || unknown.status === 404,
    { status: unknown.status, code: unknown.data.code, err: String(unknown.data.error || '').slice(0, 70) });
  const noAuth = await api('GET', '/api/merchant/inventory');
  check('MTI-26', 'no token means no merchant context at all',
    noAuth.status === 401, { status: noAuth.status, code: noAuth.data.code });

  // ---- nothing financial moved anywhere in this suite ----
  const finAfter = await one(`SELECT (SELECT count(*) FROM journal_transactions)::text jt,
      (SELECT count(*) FROM journal_lines)::text jl, (SELECT count(*) FROM driver_payouts)::text po`);
  const dFin = ['jt', 'jl', 'po'].map(k => Number(finAfter[k]) - Number(finBefore[k]));
  console.log(`  at start: journal=${finBefore.jt}/${finBefore.jl} payouts=${finBefore.po}`);
  console.log(`  at end:   journal=${finAfter.jt}/${finAfter.jl} payouts=${finAfter.po}`);
  check('MTI-27', 'this suite moved no money: journal and payout totals are identical',
    dFin.every(d => d === 0), { deltas: dFin });

  await c.end();
  const failed = results.filter(r => !r.pass);
  const skipped = results.filter(r => r.pass === undefined).length;
  console.log(`\n=== MERCHANT TENANT ISOLATION: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed, ${skipped} skipped ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
