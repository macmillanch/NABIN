/*
 * DS-2 closure regression: admin dark-store HTTP surface + RLS through real database roles.
 *
 * Two things the foundation suite could not prove:
 *   1. the routes exist, require authentication, and carry the existing `merchant.manage`
 *      permission - with ownership still enforced by the service behind them;
 *   2. the RLS posture is real behaviour, not a catalog reading. Each role check uses
 *      `SET LOCAL ROLE` inside its own transaction so row-level security genuinely applies to
 *      the attempt; the surrounding connection is a superuser, which would otherwise bypass
 *      RLS silently and make the test meaningless.
 *
 * Authentication is legitimate: an admin session from the existing login route and merchant
 * sessions from the app's deterministic test OTP. Nothing is forged. Every dark store and
 * inventory row created here is disposable and deleted at the end, and the ten protected
 * tables are compared before and after.
 *
 * Local/test only; refuses any non-loopback target.
 */
const { Client } = require('pg');
const PG = process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';
const BASE = process.env.NABIN_TEST_BASE || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(PG).hostname)
  || !/^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('DS2-CLOSURE REFUSED: non-loopback target'); process.exit(1);
}
const STAMP = Date.now();
const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 200)}` : ''));
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
const TABLES = ['dark_stores', 'dark_store_inventory', 'dark_store_reservations'];
const PROTECTED = ['merchants', 'merchant_grocery_inventory', 'master_grocery_catalog',
  'grocery_price_history', 'orders', 'order_lines', 'payments', 'journal_transactions',
  'journal_lines', 'driver_payouts'];

(async () => {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const snap = async () => {
    const out = {};
    for (const t of PROTECTED) out[t] = String((await one(`SELECT count(*)::text n FROM public.${t}`)).n);
    return out;
  };
  const before = await snap();
  console.log('  protected tables before: ' + JSON.stringify(before));

  // ================= RLS through actual database roles =================
  console.log('=== RLS behaviour observed through real roles (no policy was changed) ===');
  const asRole = async (role, sql, p) => {
    await c.query('BEGIN');
    let err = null, rows = null;
    try {
      await c.query(`SET LOCAL ROLE ${role}`);
      rows = (await c.query(sql, p)).rows;
    } catch (e) { err = e; }
    await c.query('ROLLBACK');
    return { err, rows };
  };
  for (const t of TABLES) {
    const sel = await asRole('anon', `SELECT * FROM public.${t} LIMIT 1`);
    const ins = await asRole('anon', `INSERT INTO public.${t} (id) VALUES (gen_random_uuid())`);
    const aut = await asRole('authenticated', `SELECT * FROM public.${t} LIMIT 1`);
    check(`RLS-${t}`, `anon and authenticated cannot read or write ${t}`,
      !!sel.err && !!ins.err && !!aut.err,
      { anon_select: sel.err ? String(sel.err.message).split('\n')[0].slice(0, 52) : 'READ OK - LEAK',
        anon_insert: ins.err ? 'refused' : 'WRITE OK - LEAK',
        authenticated_select: aut.err ? String(aut.err.message).split('\n')[0].slice(0, 52) : 'READ OK - LEAK' });
  }
  const svc = { err: null, rows: null };
  await c.query('BEGIN');
  try { await c.query('SET LOCAL ROLE service_role'); svc.rows = (await c.query('SELECT count(*)::text n FROM public.dark_stores')).rows; }
  catch (e) { svc.err = e; }
  await c.query('ROLLBACK');
  check('RLS-service_role', 'service_role can read the new tables (the backend\'s working path)',
    !svc.err && !!svc.rows, { error: svc.err && String(svc.err.message).slice(0, 60), rows: svc.rows && svc.rows[0] && svc.rows[0].n });
  const pols = (await c.query(`SELECT count(*)::text n FROM pg_policy p JOIN pg_class cl ON cl.oid = p.polrelid
      WHERE cl.relname = ANY($1::text[])`, [TABLES])).rows[0];
  check('RLS-zero-policies', 'no policy was quietly added to make the app work (still zero)',
    Number(pols.n) === 0, { policies: pols.n });
  const rlsOn = (await c.query(`SELECT count(*)::text n FROM pg_class WHERE relname = ANY($1::text[]) AND relrowsecurity`, [TABLES])).rows[0];
  check('RLS-enabled', 'RLS remains enabled on all three tables', Number(rlsOn.n) === 3, { enabled_on: rlsOn.n });

  // ================= admin routes =================
  const adm = await api('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
  const tok = adm.data.token;
  check('RT-01', 'an administrator session is available', adm.status === 200 && !!tok, { status: adm.status });
  if (!tok) { console.log('FATAL: no admin session'); process.exit(1); }

  const mA = (await c.query(`SELECT id::text id FROM merchants WHERE phone IN ('9888000001','+919888000001') LIMIT 1`)).rows[0];
  const mB = (await c.query(`SELECT id::text id FROM merchants WHERE phone IN ('9888000003','+919888000003') LIMIT 1`)).rows[0];
  const prod = (await c.query(`SELECT id::text id FROM master_grocery_catalog ORDER BY id LIMIT 1`)).rows[0];
  const prod2 = (await c.query(`SELECT id::text id FROM master_grocery_catalog ORDER BY id DESC LIMIT 1`)).rows[0];
  const mLogin = await api('POST', '/api/auth/verify-otp', { phone: '9888000001', otp: '7729', role: 'MERCHANT', purpose: 'LOGIN' });
  const merchantTok = mLogin.data && mLogin.data.token;

  check('RT-02', 'unauthenticated list is refused', (await api('GET', '/api/admin/dark-stores')).status === 401);
  check('RT-03', 'unauthenticated create is refused', (await api('POST', '/api/admin/dark-stores', { code: 'X', name: 'Y', address: 'Z', latitude: 1, longitude: 1 })).status === 401);
  const asMerchant = await api('GET', '/api/admin/dark-stores', undefined, merchantTok);
  check('RT-04', 'a legitimate merchant session cannot reach the admin surface',
    asMerchant.status === 401 || asMerchant.status === 403,
    { status: asMerchant.status, hasMerchantToken: !!merchantTok });

  const list0 = await api('GET', '/api/admin/dark-stores', undefined, tok);
  check('RT-05', 'an authorised admin can list dark stores',
    list0.status === 200 && Array.isArray(list0.data.darkStores), { status: list0.status });

  // create with hostile body fields: operator must NOT be assignable at creation
  const mkStore = await api('POST', '/api/admin/dark-stores', {
    code: `RT-${STAMP}`, name: `Route Store ${STAMP}`, address: '1 Route Road',
    latitude: 12.9, longitude: 77.6, service_radius_m: 1500,
    merchant_id: mB && mB.id, operated_by_merchant_id: mB && mB.id, status: 'ACTIVE',
  }, tok);
  const S1 = mkStore.data.darkStore || {};
  check('RT-06', 'create succeeds and starts DRAFT regardless of a body-supplied status',
    mkStore.status === 200 && S1.status === 'DRAFT', { status: S1.status, code: mkStore.data.code });
  check('RT-07', 'a body-supplied merchant_id/operated_by_merchant_id cannot claim a store at creation',
    S1.operated_by_merchant_id === null || S1.operated_by_merchant_id === undefined,
    { operator: S1.operated_by_merchant_id });
  const created = [S1.id].filter(Boolean);

  const detail = await api('GET', `/api/admin/dark-stores/${S1.id}`, undefined, tok);
  check('RT-08', 'detail returns the store the caller named, not another',
    detail.status === 200 && String(detail.data.darkStore.id) === String(S1.id),
    { status: detail.status, id: detail.data.darkStore && String(detail.data.darkStore.id).slice(0, 8) });

  const ownerBefore = await one('SELECT to_jsonb(x)::text r FROM (SELECT * FROM dark_stores WHERE id=$1) x', [S1.id]);
  const smuggleStatus = await api('PATCH', `/api/admin/dark-stores/${S1.id}`, { status: 'ACTIVE' }, tok);
  check('RT-09', 'status cannot be smuggled through the generic PATCH',
    smuggleStatus.status === 400 && smuggleStatus.data.code === 'DARK_STORE_STATUS_VIA_LIFECYCLE',
    { status: smuggleStatus.status, code: smuggleStatus.data.code });
  const smuggleOwner = await api('PATCH', `/api/admin/dark-stores/${S1.id}`, { operated_by_merchant_id: mA.id }, tok);
  check('RT-10', 'ownership cannot be re-pointed through the generic PATCH',
    smuggleOwner.status === 400 && smuggleOwner.data.code === 'DARK_STORE_OPERATOR_IMMUTABLE',
    { status: smuggleOwner.status, code: smuggleOwner.data.code });
  const ownerRow = await one('SELECT to_jsonb(x)::text r FROM (SELECT * FROM dark_stores WHERE id=$1) x', [S1.id]);
  check('RT-11', 'both rejected edits left the durable store row byte-identical',
    !!ownerBefore && !!ownerRow && ownerBefore.r === ownerRow.r,
    { changed: ownerBefore && ownerRow ? ownerBefore.r !== ownerRow.r : 'no row',
      operator_still_null: JSON.parse(ownerRow.r).operated_by_merchant_id === null });

  const act = await api('POST', `/api/admin/dark-stores/${S1.id}/status`, { status: 'ACTIVE' }, tok);
  check('RT-12', 'the lifecycle endpoint activates a DRAFT store',
    act.status === 200 && act.data.darkStore.status === 'ACTIVE', { status: act.status, code: act.data.code });
  const badTrans = await api('POST', `/api/admin/dark-stores/${S1.id}/status`, { status: 'DRAFT' }, tok);
  check('RT-13', 'an invented ACTIVE -> DRAFT transition is refused with 409',
    badTrans.status === 409 && badTrans.data.code === 'DARK_STORE_INVALID_TRANSITION',
    { status: badTrans.status, code: badTrans.data.code });
  const stillActive = await one(`SELECT status FROM dark_stores WHERE id=$1`, [S1.id]);
  check('RT-14', 'the refused transition left the store ACTIVE', stillActive.status === 'ACTIVE', { status: stillActive.status });

  // inventory + cross-store id substitution through the path
  const inv1 = await api('POST', `/api/admin/dark-stores/${S1.id}/inventory`,
    { product_id: prod.id, selling_price: 30, stock_quantity: 8 }, tok);
  check('RT-15', 'inventory can be added to an authorised store',
    inv1.status === 200 && !!inv1.data.inventory, { status: inv1.status, code: inv1.data.code });
  const listInv = await api('GET', `/api/admin/dark-stores/${S1.id}/inventory`, undefined, tok);
  check('RT-16', 'inventory listing derives availability instead of storing it',
    listInv.status === 200 && listInv.data.inventory.length === 1
      && Number(listInv.data.inventory[0].available_quantity) === 8,
    listInv.data.inventory && listInv.data.inventory[0] && listInv.data.inventory[0].available_quantity);

  const S2 = (await api('POST', '/api/admin/dark-stores', {
    code: `RT2-${STAMP}`, name: `Route Store 2 ${STAMP}`, address: '2 Route Road',
    latitude: 12.95, longitude: 77.61, service_radius_m: 1500 }, tok)).data.darkStore || {};
  created.push(S2.id);
  const inv2 = (await api('POST', `/api/admin/dark-stores/${S2.id}/inventory`,
    { product_id: prod2.id, selling_price: 40, stock_quantity: 5 }, tok)).data.inventory || {};
  const before2 = await one('SELECT to_jsonb(x)::text r FROM (SELECT * FROM dark_store_inventory WHERE id=$1) x', [inv2.id]);
  const subst = await api('PATCH', `/api/admin/dark-stores/${S1.id}/inventory/${inv2.id}`,
    { selling_price: 1 }, tok);
  check('RT-17', "an inventory id belonging to another store cannot be written through this store's URL",
    subst.status === 403 || subst.status === 404,
    { status: subst.status, code: subst.data.code });
  const after2 = await one('SELECT to_jsonb(x)::text r FROM (SELECT * FROM dark_store_inventory WHERE id=$1) x', [inv2.id]);
  check('RT-18', 'that substitution changed nothing durable', before2.r === after2.r,
    { price_now: JSON.parse(after2.r).selling_price });
  const bodySpoof = await api('PATCH', `/api/admin/dark-stores/${S2.id}/inventory/${inv2.id}`,
    { selling_price: 41, dark_store_id: S1.id, merchant_id: mA.id }, tok);
  check('RT-19', 'body-supplied dark_store_id/merchant_id cannot re-target a legitimate write',
    bodySpoof.status === 200 && String(bodySpoof.data.inventory.dark_store_id) === String(S2.id),
    { status: bodySpoof.status, stayed: String(bodySpoof.data.inventory && bodySpoof.data.inventory.dark_store_id).slice(0, 8) });
  const ghostStore = await api('GET', '/api/admin/dark-stores/00000000-dead-beef-0000-000000000000', undefined, tok);
  check('RT-20', 'an unknown store id is refused, never resolved to some other store',
    ghostStore.status === 404 && ghostStore.data.code === 'DARK_STORE_NOT_FOUND',
    { status: ghostStore.status, code: ghostStore.data.code });
  const badCreate = await api('POST', '/api/admin/dark-stores', { code: 'bad code!!', name: '', address: '' }, tok);
  check('RT-21', 'validation is enforced over HTTP too', badCreate.status === 400,
    { status: badCreate.status, code: badCreate.data.code });

  // ================= cleanup + integrity =================
  const delInv = await c.query(`DELETE FROM dark_store_inventory WHERE dark_store_id = ANY($1::uuid[])`, [created]);
  const delStores = await c.query(`DELETE FROM dark_stores WHERE id = ANY($1::uuid[])`, [created]);
  const left = await one(`SELECT (SELECT count(*) FROM dark_stores WHERE id = ANY($1::uuid[]))::text s,
      (SELECT count(*) FROM dark_store_inventory WHERE dark_store_id = ANY($1::uuid[]))::text i,
      (SELECT count(*) FROM dark_store_reservations)::text r`, [created]);
  check('RT-90', 'this run left no fixture behind (stores, inventory and reservations all zero)',
    Number(left.s) === 0 && Number(left.i) === 0 && Number(left.r) === 0,
    { deleted_stores: delStores.rowCount, deleted_inventory: delInv.rowCount, remaining: left });
  const after = await snap();
  const diffs = PROTECTED.filter((t) => after[t] !== before[t]);
  check('RT-91', 'all ten protected tables unchanged across the whole closure run', diffs.length === 0,
    { changed: diffs, before, after });

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== DS-2 CLOSURE (routes + RLS): ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed, 0 skipped ===`);
  if (failed.length) console.log('  failed: ' + failed.map((f) => f.id).join(', '));
  await c.end();
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.error('FATAL', e.message); process.exitCode = 1; });
