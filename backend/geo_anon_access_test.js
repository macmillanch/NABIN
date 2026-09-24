// =========================================================================
// ANONYMOUS GEO ACCESS — THE DECISION 1 PROOF (local only)
//
// Migration 029 revokes `anon`/`authenticated` on the six Section-A tables — `REVOKE ALL`,
// so reads with writes and deletes — so
// that an anonymous holder of the publishable key cannot pull a service boundary's
// geometry, its surcharge, the operator rate card, or the rule windows straight from
// PostgREST. This file is the proof of that decision and of the one failure mode the
// migration can actually cause: blinding the backend, which reads the same tables as
// `service_role`.
//
// So it asks three things per table, and one per table is enough to catch a partial
// application — which is why nothing here is bundled into a single assertion:
//
//   NEGATIVE  an anonymous read is refused and returns no rows.
//   GEOMETRY  geo_fences specifically cannot yield coordinates, centre or radius —
//             a refusal that still leaked a column would be a leak with a status code.
//   POSITIVE  service_role still reads every table, whole.
//
// Two more groups hold the surrounding ground steady: the roles that were never
// supposed to read these tables (027's `admin_accounts`) still refuse, and the tables
// Section A deliberately did NOT touch (`merchants`, `advertisements`) still answer,
// so a migration that quietly widened its scope shows up here rather than in a
// production outage. The `authenticated` half is probed with a real customer session
// when the backend is up, and reported as unproven — not skipped — when it is not. The
// last group checks the write half of `REVOKE ALL` with a filter that matches no row, so
// a missing refusal cannot turn the check itself into a mutation.
//
// Keys are read from the environment and never printed. Unlike the older probe this
// replaces, a missing key is a FAILURE, not a skip: a security check that passes
// because its input was absent is the same weakness as no check at all, in the other
// direction.
// =========================================================================

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const PGRST = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const BASE = process.env.GEO_TEST_BASE || 'http://127.0.0.1:4000';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

// The six tables of Decision 1 / migration 029 Section A, with a column set that is
// worth stealing: rows the anonymous caller used to be able to count and price.
const PROTECTED = [
  { table: 'geo_fences', select: 'id,zone_code,coordinates,center_lat,center_lng,radius_meters,surcharge_amount,surge_multiplier' },
  { table: 'surge_zones', select: 'id,zone_id,surge_multiplier,status,priority,start_time,end_time' },
  { table: 'pricing_configurations', select: 'id,service_type,base_fare,per_km_rate,per_min_rate,min_fare,booking_fee,commission_percent' },
  { table: 'platform_settings', select: 'setting_key,setting_value,updated_by' },
  { table: 'promotions', select: 'id,code,discount_type,discount_value,max_discount,usage_count' },
  { table: 'notification_templates', select: 'id,template_code,title_template,body_template' }
];

// Geometry, named rather than inferred from "some column came back". This is the
// specific thing Decision 1 is about: a boundary's shape.
const GEOMETRY_COLUMNS = ['coordinates', 'center_lat', 'center_lng', 'radius_meters'];

async function rest(route, key, headers = {}) {
  const h = { Prefer: 'count=exact', ...headers };
  if (key) { h.apikey = key; h.Authorization = `Bearer ${key}`; }
  try {
    const res = await fetch(`${PGRST}/rest/v1/${route}`, { headers: h });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* non-JSON is asserted by the caller */ }
    return {
      status: res.status,
      body: json,
      text,
      rows: Array.isArray(json) ? json.length : 0,
      count: res.headers.get('content-range'),
      code: json && json.code ? String(json.code) : '',
      message: json && json.message ? String(json.message) : ''
    };
  } catch (err) {
    return { status: 0, body: null, text: String(err.message), rows: 0, count: null, code: 'FETCH_FAILED', message: String(err.message) };
  }
}

// A read is refused only if it yields no rows AND the database said why. An empty
// array is not a refusal — it is PostgREST answering "there is nothing here", which
// is what RLS without a grant looks like, and it is a worse answer to depend on.
function refused(r) {
  return r.rows === 0 && r.code === '42501' && (r.status === 401 || r.status === 403);
}

// PATCH, for the write half of `REVOKE ALL`. Callers must pass a filter that matches no
// row, so a missing refusal cannot quietly become a mutation.
async function restPatch(route, key, body) {
  try {
    const res = await fetch(`${PGRST}/rest/v1/${route}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* asserted below */ }
    return {
      status: res.status,
      text,
      rows: Array.isArray(json) ? json.length : 0,
      code: json && json.code ? String(json.code) : '',
      message: json && json.message ? String(json.message) : ''
    };
  } catch (err) {
    return { status: 0, text: String(err.message), rows: 0, code: 'FETCH_FAILED', message: String(err.message) };
  }
}

async function main() {
  console.log(`PostgREST target: ${PGRST.replace(/\/\/[^@/]*@/, '//')}`);
  if (!ANON || !SERVICE) {
    check('GUARD-01', false,
      `this file cannot prove anything without both keys (anon ${ANON ? 'present' : 'MISSING'}, ` +
      `service_role ${SERVICE ? 'present' : 'MISSING'}). A missing key is a failed check, not a skipped one.`);
    return finish();
  }
  check('GUARD-01', true, 'both keys are in the environment, so the anonymous refusal is being proven rather than assumed');

  console.log('\n--- 1. NEGATIVE: an anonymous caller cannot read a protected table ---');
  for (const { table, select } of PROTECTED) {
    const r = await rest(`${table}?select=${encodeURIComponent(select)}&limit=5`, ANON);
    check(`ANON-DENY-${table}`, refused(r),
      `HTTP ${r.status} code=${r.code || 'none'} rows=${r.rows} content-range=${r.count || '-'} ` +
      `${r.message ? `"${r.message.slice(0, 60)}"` : ''}`);
    // Belt and braces: the payload must not carry the word that names a boundary.
    check(`ANON-NODATA-${table}`, r.rows === 0 && !/\[\s*\{/.test(r.text),
      `the response body carries no rows and no object array (${r.text.slice(0, 70)})`);
  }

  console.log('\n--- 2. GEOMETRY: geo_fences cannot give up its shape by any column spelling ---');
  for (const col of GEOMETRY_COLUMNS) {
    const r = await rest(`geo_fences?select=${col}&limit=3`, ANON);
    check(`ANON-GEOM-${col}`, refused(r) && !r.text.includes(col),
      `select=${col} → HTTP ${r.status} code=${r.code || 'none'} rows=${r.rows}${r.text.includes(col) ? ' COLUMN NAME PRESENT IN BODY' : ''}`);
  }
  const star = await rest('geo_fences?select=*&limit=3', ANON);
  check('ANON-GEOM-STAR', refused(star) && !/ring|polygon|lat[":]/i.test(star.text),
    `select=* on the fence table is refused outright (HTTP ${star.status} code=${star.code || 'none'} rows=${star.rows}) — ` +
    `a wildcard cannot reach a column the role cannot read`);
  const counted = await rest('geo_fences?select=id', ANON);
  check('ANON-NOCOUNT', refused(counted) && !counted.count,
    `not even the row count survives: content-range=${counted.count || 'absent'} (used to read "0-2/447", which is ` +
    `the fence inventory handed to an anonymous caller one integer at a time)`);

  console.log('\n--- 3. THE ANON KEY IS NOT THE DOOR: no credential at all must fail too ---');
  for (const table of ['geo_fences', 'surge_zones']) {
    const bare = await rest(`${table}?select=id&limit=3`, null);
    check(`NOKEY-DENY-${table}`, bare.rows === 0 && (refused(bare) || bare.status === 401 || bare.status === 403),
      `a request with no apikey and no Authorization answers HTTP ${bare.status} code=${bare.code || 'none'} rows=${bare.rows} ` +
      `(before 029 this returned rows on the local Kong, which is why the key was never the boundary)`);
  }

  console.log('\n--- 4. POSITIVE: the backend role still reads everything it priced from ---');
  for (const { table, select } of PROTECTED) {
    const r = await rest(`${table}?select=${encodeURIComponent(select)}&limit=3`, SERVICE);
    const ok = (r.status === 200 || r.status === 206) && r.rows > 0;
    check(`SERVICE-READ-${table}`, ok,
      `service_role reads ${table}: HTTP ${r.status} rows=${r.rows} content-range=${r.count || '-'} ` +
      `${r.message ? `"${r.message.slice(0, 60)}"` : ''}`);
  }
  const geometryBack = await rest('geo_fences?select=id,coordinates,radius_meters&limit=3', SERVICE);
  check('SERVICE-GEOMETRY', (geometryBack.status === 200 || geometryBack.status === 206)
    && geometryBack.rows > 0 && Boolean(geometryBack.body[0]?.coordinates),
    `the service-role copy still carries real geometry (${geometryBack.rows} rows, first has ` +
    `${geometryBack.body[0]?.coordinates ? 'a boundary' : 'NO coordinates'}) — GeoPolicyService hydrates from this, ` +
    `so a "refused" here would mean the backend has been blinded by the revocation`);

  console.log('\n--- 5. THE DECISION DID NOT TRAVEL: neighbours keep their own answers ---');
  // 027's service_role-only pattern must still be the reason these refuse, and the
  // storefront tables Section B left open must still answer. Both directions are a
  // scope alarm: the first moving means 029 rewrote rules it never touched, the
  // second means it locked the storefront without a decision.
  for (const [table, expectOpen] of [['admin_accounts', false], ['backend_sessions', false], ['merchants', true], ['advertisements', true]]) {
    const r = await rest(`${table}?select=*&limit=2`, ANON);
    const shape = expectOpen
      ? `outside Section A and still answers anon (HTTP ${r.status}, rows=${r.rows}, as before)`
      : `not in Section A and still refuses on its own 027 grant (HTTP ${r.status} code=${r.code || 'none'})`;
    check(`SCOPE-${table}`, expectOpen
      ? (r.status === 200 || r.status === 206)
      : (refused(r) || (r.code === '42501' && r.status >= 400)),
      `${table} is ${shape}`);
  }

  console.log('\n--- 6. THE CUSTOMER ROLE, PROVEN WITH A REAL SESSION WHEN THE BACKEND IS UP ---');
  let authedProven = false;
  try {
    const otp = await fetch(`${BASE}/api/auth/send-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' })
    }).then(r => r.json());
    const verified = await fetch(`${BASE}/api/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '9845011982', otp: otp.testOtp || '7729', role: 'CUSTOMER' })
    }).then(r => r.json());
    const token = verified.token;
    if (!token) throw new Error(`no session issued (${JSON.stringify(verified).slice(0, 80)})`);
    for (const { table } of PROTECTED) {
      const r = await rest(`${table}?select=*&limit=3`, ANON, { Authorization: `Bearer ${token}` });
      check(`AUTHED-DENY-${table}`, refused(r),
        `a signed-in customer token reads ${table}: HTTP ${r.status} code=${r.code || 'none'} rows=${r.rows} — ` +
        `Decision 1 revoked anonymous AND authenticated access, and the apps reach this data through the backend either way`);
    }
    authedProven = true;
  } catch (err) {
    check('AUTHED-DENY-GROUP', false,
      `the authenticated-role checks could not run because the backend at ${BASE} gave no customer session ` +
      `(${String(err.message).slice(0, 90)}). This is reported as UNPROVEN, not as a pass: the anon half above ` +
      `is proven, the authenticated half needs the server running (node src/server.js).`);
  }

  check('GUARD-02', authedProven || results.some(r => r.id === 'AUTHED-DENY-GROUP' && !r.ok),
    'the authenticated checks either ran or said so in the failure list');

  // `is_feature_enabled()` is SECURITY DEFINER and owned by `postgres`, so it reads
  // platform_settings with its OWN privileges — a table REVOKE does not reach it, and
  // 025 grants EXECUTE to PUBLIC, which `anon` inherits. This check does not pretend to
  // close that channel; it bounds what the channel can say, so that the day the
  // function returns more than one boolean — the setting_value JSON, or a row — the
  // suite changes colour here instead of in a leak report.
  console.log('\n--- 7. THE PATH A TABLE REVOKE CANNOT REACH, BOUNDED NOT ASSUMED AWAY ---');
  const rpc = await fetch(`${PGRST}/rest/v1/rpc/is_feature_enabled`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_feature_key: `anon_probe_${Date.now()}` })
  });
  const rpcText = await rpc.text();
  let rpcJson = null;
  try { rpcJson = JSON.parse(rpcText); } catch (_) { /* asserted below */ }
  check('RPC-BOOLEAN-ONLY', rpc.status === 200 && typeof rpcJson === 'boolean',
    `an anonymous /rpc/is_feature_enabled call answers HTTP ${rpc.status} with ${typeof rpcJson} ` +
    `(${rpcText.slice(0, 40)}) — one boolean for a key that does not exist, no setting_value, no row, ` +
    `and it fails closed. OPEN, deliberately not closed by 029: the definer still reads the table, so ` +
    `revoking its PUBLIC EXECUTE is a separate order`);
  check('RPC-NO-SETTING-VALUE', !/setting_value|setting_key|\{/.test(rpcText),
    `the body carries no setting payload (${rpcText.slice(0, 40)})`);

  // ---------------------------------------------------------------------------
  // 8. THE OTHER HALF OF `REVOKE ALL`
  //
  // `REVOKE ALL` says writes too, and the two PUBLIC `FOR ALL` policies left in place on
  // platform_settings and promotions gate on the JWT role claim (`SUPER_ADMIN`,
  // `service_role`) rather than on the connect-time role — so a caller holding such a
  // token would, on the policy alone, be allowed to write straight through PostgREST. The
  // privilege check runs before the policy, and this is the proof that it now answers
  // first. The filter matches no row on purpose: a check that asserts a refusal must not
  // be able to change data if the refusal is missing.
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. THE OTHER HALF OF `REVOKE ALL`: a write is refused before any policy is read ---');
  const WRITE_PROBES = [
    { table: 'geo_fences', filter: 'zone_code=eq.anon_write_probe_never_matches', body: { surcharge_amount: 1 } },
    { table: 'platform_settings', filter: 'setting_key=eq.anon_write_probe_never_matches', body: { setting_value: 'probe' } }
  ];
  for (const probe of WRITE_PROBES) {
    const asAnon = await restPatch(`${probe.table}?${probe.filter}`, ANON, probe.body);
    check(`ANON-WRITE-DENIED-${probe.table}`, asAnon.code === '42501' && (asAnon.status === 401 || asAnon.status === 403),
      `an anonymous PATCH of ${probe.table} answers HTTP ${asAnon.status} code=${asAnon.code || 'none'} ` +
      `(${asAnon.message.slice(0, 50)}) — refused on the grant, and the filter matched nothing, so this ` +
      `check cannot have written a row even if the refusal were absent`);
  }
  // The admin-token case, named rather than assumed away: an operator writes these tables
  // through Express and its service_role client (group 4), never through PostgREST, so this
  // refusal is the intended shape and not a broken surface. If a direct-write client is ever
  // added, this is the check that has to be revisited deliberately.
  const asAnonInsert = await restPatch('promotions?code=eq.anon_write_probe_never_matches', ANON, { usage_count: 0 });
  check('ANON-WRITE-DENIED-promotions', asAnonInsert.code === '42501' && (asAnonInsert.status === 401 || asAnonInsert.status === 403),
    `an anonymous PATCH of promotions answers HTTP ${asAnonInsert.status} code=${asAnonInsert.code || 'none'} ` +
    `(${asAnonInsert.message.slice(0, 50)}) — the "Admins manage promotions" policy gates on the JWT role ` +
    `claim, and the grant is what answers an anon caller before that policy is consulted`);

  return finish();
}

function finish() {
  const failed = results.filter(r => !r.ok);
  console.log('\n========================================================================');
  console.log(`📊 ANON GEO ACCESS (Decision 1 / migration 029): ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  console.log('========================================================================');
  for (const failure of failed) console.log(`   ✗ ${failure.id}: ${failure.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error('ANON GEO ACCESS PROBE ABORTED:', err.stack || err.message);
  process.exit(3);
});
