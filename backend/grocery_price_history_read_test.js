'use strict';

/*
 * TASK 4N review corrections: exercise GET /api/merchant/grocery/price-history over its REAL HTTP
 * path, so authentication, the merchant tenant + service guards, query handling and read-only
 * behaviour are demonstrated rather than inferred from source text.
 *
 * Merchant contexts are the same unambiguous local/test merchants the tenant-isolation suite uses,
 * authenticated through the application's own OTP flow:
 *   9888000002 GROCERY        (the entitled caller)
 *   9888000001 RESTAURANT     (must be refused by the GROCERY service guard)
 *
 * Exact counts come from PostgREST `count:'exact'` with `head:true`, never from a default-limited
 * row set. Loopback only. Synthetic rows are tagged by a unique `reason` and removed in `finally`;
 * the exit code is assigned only after cleanup has been verified.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'local';

// Accept both base-URL variables: `NABIN_TEST_BASE` (the tenant-isolation convention) and
// `NABIN_TEST_BASE_URL` (the merchant-operations convention), so the suite runs unchanged whichever one
// the caller or chain harness exports.
const BASE = process.env.NABIN_TEST_BASE || process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
if (!/^(?:127\.\d+\.\d+\.\d+|localhost|::1)$/i.test(new URL(BASE).hostname)) {
  console.error('REFUSED: non-loopback target'); process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');

const PHONE_GROCERY = '9888000002';
const PHONE_RESTAURANT = '9888000001';
const OTP = process.env.NABIN_TEST_OTP || '7729';
const PATH = '/api/merchant/grocery/price-history';
const TS = Date.now();
const MARK = `4nhttp-${TS}`;

let pass = 0; let fail = 0;
const check = (l, ok, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${l}${d ? ` -- ${String(d).slice(0, 150)}` : ''}`); };

const api = async (method, path, { body, token, raw } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return { status: res.status, text: await res.text() };
  let data = null; try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, data: data || {} };
};

const exactCount = async (table, filters) => {
  let q = supabaseAdmin.from(table).select('id', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(filters || {})) q = q.eq(col, val);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table} failed: ${error.message}`);
  return count || 0;
};

(async () => {
  if (!isLivePostgres || !supabaseAdmin) { console.log('needs the durable store'); process.exitCode = 1; return; }

  // Resolve the two real merchants. Phones are matched on digits only, exactly as the tenant-isolation
  // suite does, because stored values may carry a country code or separators.
  const norm = (v) => String(v || '').replace(/\D/g, '').slice(-10);
  const allMerchants = (await supabaseAdmin.from('merchants').select('id, phone, merchant_type').limit(1000)).data || [];
  const findBy = (phone) => allMerchants.filter((m) => norm(m.phone) === norm(phone));
  const g = findBy(PHONE_GROCERY);
  const r = findBy(PHONE_RESTAURANT);
  if (g.length !== 1 || r.length !== 1) {
    console.log(`FATAL: test phones must resolve to exactly one merchant each (grocery=${g.length}, restaurant=${r.length})`);
    process.exitCode = 1; return;
  }
  const M_G = g[0].id; const M_R = r[0].id;

  const prods = (await supabaseAdmin.from('master_grocery_catalog').select('id, standard_unit').eq('is_active', true).limit(2)).data || [];
  const other = (await supabaseAdmin.from('merchant_grocery_inventory').select('merchant_id').neq('merchant_id', M_G).limit(1)).data || [];
  if (prods.length < 2 || other.length < 1) { console.log('FATAL: need 2 active products and another stocked merchant'); process.exitCode = 1; return; }
  const [P1, P2] = prods;
  const M_OTHER = other[0].merchant_id;

  // Authenticate through the app's own flow.
  const loginG = await api('POST', '/api/auth/verify-otp', { body: { phone: PHONE_GROCERY, otp: OTP, role: 'MERCHANT' } });
  const tokG = loginG.data.token;
  check('HT-00 grocery merchant authenticates via the application OTP flow', loginG.status === 200 && !!tokG, `status ${loginG.status} ${loginG.data.error || ''}`);
  const loginR = await api('POST', '/api/auth/verify-otp', { body: { phone: PHONE_RESTAURANT, otp: OTP, role: 'MERCHANT' } });
  const tokR = loginR.data.token;
  check('HT-00b restaurant merchant authenticates via the application OTP flow', loginR.status === 200 && !!tokR, `status ${loginR.status}`);
  if (!tokG || !tokR) { console.log('FATAL: cannot continue without both tokens'); process.exitCode = 1; return; }

  const inserted = [];
  const cleanupFailures = [];
  const seed = async (merchantId, productId, prev, next) => {
    const { data, error } = await supabaseAdmin.from('grocery_price_history').insert({
      merchant_id: merchantId, product_id: productId, previous_price: prev, new_price: next,
      unit: P1.standard_unit || 'kg', changed_by: `probe:${MARK}`, reason: MARK,
    }).select('id').single();
    if (error) throw new Error(`seed failed: ${error.message}`);
    inserted.push(data.id);
  };

  try {
    // Four rows for the grocery merchant (distinct merchant-exclusive prices) + two for another merchant.
    await seed(M_G, P1.id, 11.11, 12.11);
    await seed(M_G, P1.id, 12.11, 13.11);
    await seed(M_G, P2.id, 21.11, 22.11);
    await seed(M_G, P2.id, 23.11, 24.11);
    await seed(M_OTHER, P1.id, 71.11, 72.11);
    await seed(M_OTHER, P2.id, 73.11, 74.11);
    const LEAK = [71.11, 72.11, 73.11, 74.11];

    // PH-08 / PH-09 measured around the HTTP reads with EXACT counts.
    const histBeforeG = await exactCount('grocery_price_history', { merchant_id: M_G });
    const auditBefore = await exactCount('audit_logs', { action: 'PRICE_UPDATE' });

    const full = await api('GET', PATH, { token: tokG });
    check('HT-01 authenticated grocery merchant gets 200 and an envelope', full.status === 200 && full.data.success === true && Array.isArray(full.data.history),
      `status ${full.status} ${full.data.error || ''}`);
    check('HT-01b merchantId in the response is the token merchant, not a caller value', full.data.merchantId === M_G, `${full.data.merchantId}`);
    const rows = full.data.history || [];
    check('PH-01 all four seeded rows are returned from the durable table', rows.length >= 4, `rows ${rows.length}`);
    check('PH-04/HT-02 no other merchant rows leak into the response', !rows.some((h) => LEAK.includes(h.previousPrice) || LEAK.includes(h.newPrice)),
      JSON.stringify(rows.map((h) => [h.previousPrice, h.newPrice])));
    check('PH-02 records carry exactly the merchant-appropriate fields',
      rows.length > 0 && rows.every((h) => Object.keys(h).length === 6 && ['historyId', 'productId', 'previousPrice', 'newPrice', 'unit', 'createdAt'].every((k) => k in h)),
      JSON.stringify(Object.keys(rows[0] || {})));
    check('PH-02b no internal actor metadata crosses the wire', !rows.some((h) => 'changedBy' in h || 'changed_by' in h || 'reason' in h));
    const times = rows.map((h) => String(h.createdAt));
    check('PH-03 HTTP ordering is deterministic, newest first', times.every((t, i) => i === 0 || times[i - 1] >= t), JSON.stringify(times.slice(0, 3)));

    // PH-05: query-supplied merchant identity must not win.
    const spoof = await api('GET', `${PATH}?merchantId=${M_OTHER}`, { token: tokG });
    const srows = spoof.data.history || [];
    check('HT-03 ?merchantId=<other> cannot override the token identity',
      spoof.status === 200 && spoof.data.merchantId === M_G && !srows.some((h) => LEAK.includes(h.previousPrice) || LEAK.includes(h.newPrice)),
      `status ${spoof.status} merchantId=${spoof.data.merchantId === M_G ? 'token' : spoof.data.merchantId} leak=${srows.some((h) => LEAK.includes(h.previousPrice))}`);
    const spoofProduct = await api('GET', `${PATH}?merchantId=${M_OTHER}&productId=${P1.id}`, { token: tokG });
    check('HT-03b combined spoofed merchant+product query stays scoped',
      (spoofProduct.data.history || []).every((h) => LEAK.indexOf(h.previousPrice) === -1), `rows ${(spoofProduct.data.history || []).length}`);

    // Guards: unauthenticated and non-grocery, on the route family's own status semantics.
    const anon = await api('GET', PATH, {});
    check('HT-04 unauthenticated request is refused with 401', anon.status === 401 && anon.data.success === false, `status ${anon.status} code ${anon.data.code}`);
    const wrongService = await api('GET', PATH, { token: tokR });
    check('HT-05 non-grocery merchant is refused 403 MERCHANT_TYPE_MISMATCH',
      wrongService.status === 403 && wrongService.data.code === 'MERCHANT_TYPE_MISMATCH', `status ${wrongService.status} code ${wrongService.data.code}`);

    // Filters and pagination over HTTP.
    const byProduct = await api('GET', `${PATH}?productId=${P1.id}`, { token: tokG });
    const bp = byProduct.data.history || [];
    check('PH-06 productId filter works over HTTP', bp.length >= 2 && bp.every((h) => h.productId === P1.id), `rows ${bp.length}`);
    const unknown = await api('GET', `${PATH}?productId=00000000-0000-0000-0000-0000000000fe`, { token: tokG });
    check('PH-06b unknown product id returns the established empty envelope, not an error',
      unknown.status === 200 && unknown.data.success === true && (unknown.data.history || []).length === 0, `status ${unknown.status}`);

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const future = new Date(Date.now() + 3600_000).toISOString();
    const fromWindow = await api('GET', `${PATH}?from=${encodeURIComponent(hourAgo)}`, { token: tokG });
    check('PH-07a `from` bound includes recent rows over HTTP',
      (fromWindow.data.history || []).length >= 4 && (fromWindow.data.history || []).every((h) => new Date(h.createdAt) >= new Date(hourAgo)),
      `rows ${(fromWindow.data.history || []).length}`);
    const toPast = await api('GET', `${PATH}?to=${encodeURIComponent(hourAgo)}`, { token: tokG });
    check('PH-07b `to` bound excludes the seeded rows over HTTP',
      (toPast.data.history || []).every((h) => new Date(h.createdAt) <= new Date(hourAgo)) && !(toPast.data.history || []).some((h) => [12.11, 13.11, 22.11, 24.11].includes(h.newPrice)),
      `rows ${(toPast.data.history || []).length}`);
    const bothBounds = await api('GET', `${PATH}?from=${encodeURIComponent(hourAgo)}&to=${encodeURIComponent(future)}`, { token: tokG });
    check('PH-07c both bounds together return the seeded window', (bothBounds.data.history || []).length >= 4, `rows ${(bothBounds.data.history || []).length}`);

    const pg1 = await api('GET', `${PATH}?limit=2&offset=0`, { token: tokG });
    const pg2 = await api('GET', `${PATH}?limit=2&offset=2`, { token: tokG });
    const ids1 = (pg1.data.history || []).map((h) => h.historyId);
    const ids2 = (pg2.data.history || []).map((h) => h.historyId);
    check('PH-07d HTTP limit is honoured', (pg1.data.history || []).length === 2 && pg1.data.count === 2, `count ${pg1.data.count}`);
    check('PH-07e HTTP offset pages without repeating rows', ids1.every((i) => !ids2.includes(i)) && ids2.length === 2, `${ids1.length}/${ids2.length}`);
    const overCap = await api('GET', `${PATH}?limit=5000`, { token: tokG });
    check('PH-07f oversized limit is capped at the server, not passed through', (overCap.data.history || []).length <= 100, `rows ${(overCap.data.history || []).length}`);

    // PH-08 / PH-09: after every read above, exact counts.
    const histAfterG = await exactCount('grocery_price_history', { merchant_id: M_G });
    const auditAfter = await exactCount('audit_logs', { action: 'PRICE_UPDATE' });
    check('PH-08 HTTP reads mutate no history rows', histAfterG === histBeforeG, `before ${histBeforeG} after ${histAfterG} (exact counts)`);
    check('PH-09 HTTP reads create no PRICE_UPDATE audit entry', auditAfter === auditBefore, `before ${auditBefore} after ${auditAfter} (exact counts)`);

    // PH-10: degraded store must not fabricate history. The route branch is
    // `if (!isLivePostgres) -> { count:0, history:[], degraded:true }`; exercised at the model boundary
    // because the running harness always has a live store.
    const supa = require('./src/supabase');
    const saved = supa.isLivePostgres;
    supa.isLivePostgres = false;
    const degraded = await db.getMerchantPriceHistory({ merchantId: M_G });
    supa.isLivePostgres = saved;
    check('PH-10 degraded store yields no rows instead of replaying fixture history',
      Array.isArray(degraded) && degraded.length === 0, `rows ${degraded.length}`);

    // F-1: the removed public fixture-history route must never answer again. It used to return 200 with
    // fabricated history plus `changedBy`/`storeId` to any anonymous caller; a regression here would
    // re-leak audit metadata and re-assert durability the data does not have.
    const legacy = await api('GET', '/api/grocery/products/gprod_1/history', { raw: true });
    check('F1-01 the removed public fixture-history route no longer returns 200',
      legacy.status !== 200, `status ${legacy.status}`);
    check('F1-02 it leaks no changedBy / storeId actor metadata',
      !/changedBy|storeId/.test(legacy.text || ''), `${(legacy.text || '').slice(0, 90)}`);
    const durableStillWorks = await api('GET', PATH, { token: tokG });
    check('F1-03 the authenticated durable endpoint is unaffected by the removal',
      durableStillWorks.status === 200 && durableStillWorks.data.success === true, `status ${durableStillWorks.status}`);
  } finally {
    if (inserted.length) {
      const { error: delErr } = await supabaseAdmin.from('grocery_price_history').delete().in('id', inserted);
      if (delErr) cleanupFailures.push(`delete error: ${delErr.message}`);
      const left = await supabaseAdmin.from('grocery_price_history').select('id', { count: 'exact', head: true }).eq('reason', MARK);
      const remaining = left.count || 0;
      console.log(`  cleanup: seeded=${inserted.length} deleted, remaining by marker=${remaining}`);
      if (remaining !== 0) cleanupFailures.push(`${remaining} synthetic rows left behind`);
    }
    if (cleanupFailures.length) { fail += cleanupFailures.length; console.log(`  FAIL  CLEANUP: ${cleanupFailures.join('; ')}`); }
    else { pass++; console.log('  PASS  CLEANUP: zero synthetic rows remain'); }

    // Exit status is decided only now, after cleanup has actually been verified.
    console.log(`\ngrocery_price_history_read_test: ${pass} passed, ${fail} failed`);
    process.exitCode = fail ? 1 : 0;
  }
})().catch((err) => { console.error('FATAL', err.stack || err.message); process.exitCode = 1; });
