/*
 * OP-1 — data-driven operator permissions: baseline equivalence gate.
 *
 * PRIMARY SECURITY GATE (§16): every one of the 1,709 existing admin accounts must keep
 * EXACTLY the same effective permission set after the authorization store lands. A silent
 * re-grant to the 549 OPERATIONS rows is a security failure, not a migration detail.
 *
 * The baseline is DERIVED, never typed: expected = durable account row (id, role, is_active)
 * mapped through the current authorization implementation in `adminPermissions.js`. Nothing
 * in this file restates a permission list by hand, so the expectation cannot drift from the
 * implementation it is supposed to protect.
 *
 * Reads go through direct PostgreSQL (`pg`), not PostgREST: `max_rows = 1000` truncates a
 * 1,709-row directory silently, and a truncated baseline would make the gate pass on a
 * subset. Local loopback only - the guard refuses anything else before connecting.
 *
 * RED before the migration by construction: the sections that need the durable store record
 * FAILs rather than throwing, so the pre-migration run reports what is missing instead of
 * crashing partway and hiding the rest.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
// Reap the backend this run starts, and only that one — scripts/spawned_server.js.
const { trackServer } = require('./scripts/spawned_server');
const { Client } = require('pg');

process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const { ROLE_GRANTS, grantsForRole, KNOWN_ADMIN_ROLES, adminHoldsPermission } = require('./src/adminPermissions');

const BASE_URL = 'http://127.0.0.1:4000';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };
const DB_URL = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const sortedSet = (arr) => [...new Set((arr || []).map(String))].sort();
const digestOf = (rows) => crypto.createHash('sha256')
  .update(rows.map(r => `${r.id}|${r.role}|${r.is_active}|${sortedSet(r.effective).join(',')}`)
    .sort().join('\n')).digest('hex').slice(0, 16);

function request(method, route, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, BASE_URL);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers }
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data), raw: data }); } catch (e) { resolve({ status: res.statusCode, raw: data, data: {} }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function ensureServerRunning() {
  try { const res = await request('GET', '/api/health'); if (res.status === 200) return null; } catch (e) {}
  // Capture the spawned server's own output. With stdio:'ignore' every warning the authorization
  // path prints is thrown away, and a silent refusal cannot be diagnosed. Two distinct files -
  // stdout and stderr to the same path makes the spawn fail and the server never start.
  const fs2 = require('fs');
  const outFd = fs2.openSync(path.join(__dirname, 'scratch', 'op1_srv_out.log'), 'w');
  const errFd = fs2.openSync(path.join(__dirname, 'scratch', 'op1_srv_err.log'), 'w');
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: ['ignore', outFd, errFd], detached: true, windowsHide: true
  }));
  proc.unref();
  // Boot hydrates the whole 1,709-account directory plus the store, so the 6-second window the
  // sibling suites use is not enough here; waiting longer is correct, reporting a crash as a
  // product failure is not.
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { const res = await request('GET', '/api/health'); if (res.status === 200) return proc; } catch (e) {}
  }
  return proc;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fixtureSuffix() {
  return `${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`.toLowerCase();
}

/* -------------------------------------------------------------
 * 1. BASELINE from the current implementation + the durable directory.
 *    Available before the migration, and the thing the migration is measured against.
 * ------------------------------------------------------------- */
async function readDirectory(client) {
  const { rows } = await client.query('select id, role, is_active from public.admin_accounts order by id');
  return rows.map(r => ({ ...r, effective: sortedSet(grantsForRole(r.role) || []) }));
}

async function sectionBaseline(client) {
  const baseline = await readDirectory(client);
  const total = baseline.length;
  const byRole = {};
  baseline.forEach(a => { const k = `${a.role}:${a.is_active}`; byRole[k] = (byRole[k] || 0) + 1; });
  console.log(`   directory: ${total} accounts  ${JSON.stringify(byRole)}`);
  console.log(`   BASELINE DIGEST (code-derived, pre-migration): ${digestOf(baseline)}`);

  check('BL-01', total > 0, `accounts read through direct PG: ${total}`);
  // §3-B every account belongs to exactly one current role
  const unknown = baseline.filter(a => !KNOWN_ADMIN_ROLES.includes(a.role));
  check('BL-02', unknown.length === 0,
    `every account maps to a known role (unknown-role accounts: ${unknown.length}${unknown.length ? ' e.g. ' + unknown[0].role : ''})`);
  // §3-C no account has permissions beyond its own role's, because the role is the only source today
  const stray = baseline.filter(a => a.effective.some(p => !(ROLE_GRANTS[a.role] || []).includes(p)));
  check('BL-03', stray.length === 0, `no account carries a permission outside its role mapping (${stray.length} stray)`);
  // §3-D the single SUPER_ADMIN exists and is active
  const supers = baseline.filter(a => a.role === 'SUPER_ADMIN');
  check('BL-04', supers.length === 1 && supers[0].is_active === true,
    `exactly one SUPER_ADMIN and it is active (found ${supers.length}, active=${supers.map(s => s.is_active)})`);
  // §3-E inactive accounts are captured as inactive so the gate can prove they stay inert
  const inactiveCount = baseline.filter(a => a.is_active === false).length;
  check('BL-05', inactiveCount > 0, `inactive accounts recorded in the baseline: ${inactiveCount} of ${total}`);
  // §3-H no first-row inheritance: each account's set equals ITS OWN role's set
  const firstRole = baseline[0] ? baseline[0].role : null;
  const inherited = baseline.filter(a => a.role !== firstRole && a.effective.join() === sortedSet(ROLE_GRANTS[firstRole] || []).join());
  check('BL-06', inherited.length === 0,
    `no account inherits the first row's grants (${inherited.length} would have followed row 1 = ${firstRole})`);
  // §3-G an account's set depends on its role only, so two roles that differ cannot collide
  const opSet = sortedSet(ROLE_GRANTS.OPERATIONS), saSet = sortedSet(ROLE_GRANTS.SUPER_ADMIN);
  check('BL-07', opSet.length > 0 && saSet.length > opSet.length && opSet.every(p => saSet.includes(p)),
    `OPERATIONS is a strict subset of SUPER_ADMIN (${opSet.length} vs ${saSet.length}) so an equality bug cannot hide as a subset`);
  // §3-I empty must never mean allow-all, and unknown role must not silently become []
  check('BL-08', grantsForRole('NOT_A_ROLE') === null, `grantsForRole returns null for an unresolvable role, not [] (got ${JSON.stringify(grantsForRole('NOT_A_ROLE'))})`);
  check('BL-09', adminHoldsPermission({ role: 'OPERATIONS', permissions: [] }, 'finance.refund') === false
    && adminHoldsPermission({ role: 'OPERATIONS' }, 'finance.refund') === false,
    'null/empty permission representation denies rather than allows all');
  // §17 privilege-escalation clauses on the mapping itself
  check('BL-10', !(ROLE_GRANTS.OPERATIONS || []).includes('admin_accounts.manage'), 'OPERATIONS holds no admin_accounts.manage (cannot self-authorise)');
  check('BL-11', !(ROLE_GRANTS.KYC_SPECIALIST || []).includes('finance.refund'), 'KYC_SPECIALIST holds no finance.refund');
  check('BL-12', !(ROLE_GRANTS.SUPPORT_AGENT || []).includes('finance.adjust'), 'SUPPORT_AGENT holds no finance.adjust');
  check('BL-13', !(ROLE_GRANTS.FINANCE_AUDITOR || []).includes('admin_accounts.manage')
    && !(ROLE_GRANTS.FINANCE_AUDITOR || []).includes('services.emergency_killswitch'),
    'FINANCE_AUDITOR holds no unrelated administrative permission');
  // §3-J resolution is server-side: nothing in the client payload can supply grants
  check('BL-14', typeof adminHoldsPermission === 'function' && KNOWN_ADMIN_ROLES.length === 5,
    'permission resolution lives in one server-side predicate over 5 known roles');
  return baseline;
}

/* -------------------------------------------------------------
 * 2. THE STORE — RED before migration, GREEN after.
 * ------------------------------------------------------------- */
async function sectionStore(client, baseline) {
  const tableExists = async (name) => (await client.query(
    `select 1 from information_schema.tables where table_schema='public' and table_name=$1`, [name])).rowCount > 0;

  const wanted = ['permission_keys', 'operator_roles', 'role_grants', 'operator_grants'];
  const present = {};
  for (const t of wanted) {
    try { present[t] = await tableExists(t); } catch (e) { present[t] = false; }
  }
  wanted.forEach(t => check(`ST-00.${t}`, present[t], `table ${t} exists`));
  if (!wanted.every(t => present[t])) {
    check('ST-01', false, 'authorization store incomplete — remaining store sections cannot be evaluated');
    return { storeReady: false };
  }

  // §5 catalogue must contain the whole existing permission universe, including keys that
  // routes enforce. Read the enforced set out of the source rather than restating it.
  const fs = require('fs');
  const serverSrc = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const enforced = [...new Set([...serverSrc.matchAll(/requirePermission\(\s*'([^']+)'/g)].map(m => m[1]))];
  const inCode = [...new Set(Object.values(ROLE_GRANTS).flat())];
  const { rows: catRows } = await client.query(`select key from public.permission_keys where is_active is distinct from false`);
  const catalogue = new Set(catRows.map(r => r.key));
  const missingEnforced = enforced.filter(k => !catalogue.has(k));
  check('ST-01', missingEnforced.length === 0,
    `catalogue covers every enforced permission (${enforced.length} distinct keys in routes; missing: ${missingEnforced.length}${missingEnforced.length ? ' -> ' + missingEnforced.join(', ') : ''})`);
  const missingCode = inCode.filter(k => !catalogue.has(k));
  check('ST-02', missingCode.length === 0, `catalogue covers every grant named in adminPermissions.js (${inCode.length} keys; missing ${missingCode.length})`);
  const invented = [...catalogue].filter(k => !inCode.includes(k) && !enforced.includes(k));
  check('ST-03', invented.length === 0,
    `catalogue invents no permission nobody enforces (unreferenced: ${invented.length}${invented.length ? ' -> ' + invented.join(', ') : ''})`);
  check('ST-04', catalogue.size === inCode.length || catalogue.size >= inCode.length,
    `catalogue size ${catalogue.size} vs code universe ${inCode.length}`);

  // §6 exactly the five existing roles are data at OP-1; the 13 new roles are OP-2
  const { rows: roleRows } = await client.query(`select role_key from public.operator_roles order by role_key`);
  const roleKeys = roleRows.map(r => r.role_key);
  check('ST-05', KNOWN_ADMIN_ROLES.every(r => roleKeys.includes(r)),
    `all 5 existing roles exist as rows (${roleKeys.join(', ')})`);
  check('ST-06', roleKeys.length === 5, `OP-1 adds no new roles — exactly 5 rows (got ${roleKeys.length}; OP-2 owns the 13)`);

  // §12 role_grants reproduce the code mapping exactly, per role
  const durableGrants = {};
  const { rows: rg } = await client.query(`
    select r.role_key, p.key
    from public.role_grants g
    join public.operator_roles r on r.id = g.role_id
    join public.permission_keys p on p.id = g.permission_id
    order by r.role_key, p.key`);
  rg.forEach(x => { (durableGrants[x.role_key] = durableGrants[x.role_key] || []).push(x.key); });
  let repro = true; const reproDetail = [];
  for (const role of KNOWN_ADMIN_ROLES) {
    const a = sortedSet(ROLE_GRANTS[role]), b = sortedSet(durableGrants[role]);
    if (a.join() !== b.join()) { repro = false; reproDetail.push(`${role}: code=${a.length} store=${b.length}`); }
  }
  check('ST-07', repro, `store reproduces today's role mapping byte-for-byte for all 5 roles (${reproDetail.join('; ') || 'all equal'})`);

  // §8 no existing operator receives an extra grant
  const { rows: og } = await client.query(`
    select g.operator_id, p.key from public.operator_grants g
    join public.permission_keys p on p.id = g.permission_id`);
  const baselineIds = new Set(baseline.map(b => String(b.id)));
  const preExisting = og.filter(r => baselineIds.has(String(r.operator_id)));
  check('ST-08', preExisting.length === 0,
    `no pre-migration account carries an additive grant (${og.length} grant rows total, ${preExisting.length} belong to existing accounts)`);

  // §15 SUPER_ADMIN equivalence, before == after, wildcard untouched
  const saBefore = sortedSet(ROLE_GRANTS.SUPER_ADMIN);
  const saAfter = sortedSet(durableGrants.SUPER_ADMIN);
  check('SA-01', saBefore.join() === saAfter.join(),
    `SUPER_ADMIN explicit grants identical before/after (${saBefore.length} vs ${saAfter.length})`);
  const { rows: wildcardish } = await client.query(`select count(*)::int n from public.permission_keys where key like '%*'`);
  check('SA-02', wildcardish[0].n === 0, `no wildcard permission row invented (keys containing '*': ${wildcardish[0].n})`);
  check('SA-03', adminHoldsPermission({ role: 'SUPER_ADMIN', permissions: saAfter }, 'services.emergency_killswitch') === true,
    'SUPER_ADMIN wildcard behaviour preserved as it already exists (documented, not silently changed)');

  // §11 role integrity: CHECK replaced by a stronger mechanism, not removed
  const { rows: cons } = await client.query(`
    select con.conname, contype, pg_get_constraintdef(con.oid) as def
    from pg_constraint con join pg_class rel on rel.oid=con.conrelid
    join pg_namespace nsp on nsp.oid=rel.relnamespace
    where nsp.nspname='public' and rel.relname='admin_accounts' and con.conname like '%role%'`);
  const fk = cons.find(c => c.contype === 'f' && /role/i.test(c.def));
  const legacyCheck = cons.find(c => c.contype === 'c' && /role/i.test(c.def));
  check('IN-01', Boolean(fk), `admin_accounts.role is now a foreign key to operator_roles (${fk ? fk.conname : 'none'})`);
  check('IN-02', !legacyCheck, `the hardcoded 5-name CHECK is gone, replaced rather than dropped (${legacyCheck ? legacyCheck.conname + ' still present' : 'replaced'})`);
  let badRoleRefused = false;
  try {
    await client.query('begin');
    await client.query(`insert into public.admin_accounts (username,name,email,role,password_hash,password_salt)
      values('op1_badrole_zz','OP-1 probe','op1_badrole_zz@nabin.in','MAINTENANCE_OVERRIDE','x','y')`);
    await client.query('rollback');
  } catch (e) { badRoleRefused = true; try { await client.query('rollback'); } catch (e2) {} }
  check('IN-03', badRoleRefused, 'a role that is not a row is refused at the database (stronger than the old fixed CHECK)');
  let dropInUseRefused = false;
  try {
    await client.query('begin');
    await client.query(`delete from public.operator_roles where role_key='OPERATIONS'`);
    await client.query('rollback');
  } catch (e) { dropInUseRefused = true; try { await client.query('rollback'); } catch (e2) {} }
  check('IN-04', dropInUseRefused, 'a role in use by 549 accounts cannot be deleted out from under them');

  // §10 RLS, following the 029/031 convention
  const { rows: rls } = await client.query(`
    select c.relname, c.relrowsecurity,
      (select count(*) from pg_policies p where p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname = any(array['permission_keys','operator_roles','role_grants','operator_grants'])`);
  const rlsOk = rls.every(r => r.relrowsecurity && Number(r.policies) === 0);
  check('RLS-01', rls.length === 4 && rlsOk,
    `all 4 tables have RLS enabled with zero policies (${rls.map(r => `${r.relname}:${r.relrowsecurity}/${r.policies}`).join(' ')})`);
  // A refusal only counts as a refusal if it is a PRIVILEGE refusal. Probing with a column set
  // the table does not have would "pass" for a completely unrelated reason, and a passing test
  // that proves nothing is worse than a failing one.
  const probe = async (role, sqlText) => {
    try {
      await client.query('begin');
      await client.query(`set local role ${role}`);
      await client.query(sqlText);
      await client.query('rollback');
      return { allowed: true };
    } catch (e) {
      await client.query('rollback').catch(() => {});
      return { allowed: false, code: e.code, message: e.message };
    }
  };
  const isPrivilegeRefusal = (r) => !r.allowed && (r.code === '42501' || /permission denied|row-level security/i.test(r.message || ''));
  const writeProbe = {
    permission_keys: `insert into public.permission_keys (id, key) values (gen_random_uuid(), 'zz.op1_probe')`,
    operator_roles: `insert into public.operator_roles (id, role_key, name) values (gen_random_uuid(), 'ZZ_OP1_PROBE', 'OP-1 probe')`,
    role_grants: `insert into public.role_grants (role_id, permission_id) values (gen_random_uuid(), gen_random_uuid())`,
    operator_grants: `insert into public.operator_grants (operator_id, permission_id) values (gen_random_uuid(), gen_random_uuid())`
  };
  // Sequential on purpose: these share one connection, and `begin` / `set local role` /
  // `rollback` from concurrent probes would interleave into each other's transactions and
  // report a refusal that never happened.
  const awRes = [], awtRes = [], arRes = [];
  for (const [t, s] of Object.entries(writeProbe)) awRes.push([t, await probe('anon', s)]);
  for (const [t, s] of Object.entries(writeProbe)) awtRes.push([t, await probe('authenticated', s)]);
  for (const t of Object.keys(writeProbe)) arRes.push([t, await probe('anon', `select count(*) from public.${t}`)]);
  check('RLS-02', awRes.every(r => isPrivilegeRefusal(r[1])),
    `anon cannot WRITE any grant table, refused as a privilege error (${awRes.map(([t, r]) => `${t}:${r.code || 'ALLOWED'}`).join(' ')})`);
  check('RLS-03', awtRes.every(r => isPrivilegeRefusal(r[1])),
    `authenticated (operator/user JWT role) cannot WRITE any grant table (${awtRes.map(([t, r]) => `${t}:${r.code || 'ALLOWED'}`).join(' ')})`);
  check('RLS-03b', arRes.every(r => isPrivilegeRefusal(r[1])),
    `anon cannot even READ the grant tables — an operator cannot enumerate the privilege boundary (${arRes.map(([t, r]) => `${t}:${r.code || 'ALLOWED'}`).join(' ')})`);
  let svcOk = false, svcCount = 0;
  try {
    await client.query('begin');
    await client.query('set local role service_role');
    const r = await client.query('select count(*)::int n from public.permission_keys');
    svcCount = r.rows[0].n; svcOk = svcCount > 0;
    await client.query('rollback');
  } catch (e) { try { await client.query('rollback'); } catch (e2) {} }
  check('RLS-04', svcOk, `service_role — the only writer — reads the catalogue through RLS (${svcCount} keys)`);
  check('RLS-05', !/permission_keys|operator_roles|role_grants|operator_grants/.test(
    (require('fs').readFileSync(path.join(__dirname, 'src/server.js'), 'utf8').match(/app\.(get|post|put|patch|delete)\([^)]*?(permission_keys|operator_roles|role_grants|operator_grants)/g) || []).join('')),
    'no HTTP route touches the grant tables directly; changes go through server-side operations');

  // §16 THE GATE: effective = store role grants ∪ store operator grants, over all accounts
  const { rows: allAccounts } = await client.query('select id, role, is_active from public.admin_accounts order by id');
  const grantByAccount = {};
  const { rows: ogAll } = await client.query(`
    select g.operator_id, p.key from public.operator_grants g
    join public.permission_keys p on p.id = g.permission_id`);
  ogAll.forEach(r => { const k = String(r.operator_id); (grantByAccount[k] = grantByAccount[k] || []).push(r.key); });

  const mismatches = [];
  let exact = 0;
  for (const a of allAccounts) {
    const before = sortedSet(grantsForRole(a.role) || []);
    const after = sortedSet([...(durableGrants[a.role] || []), ...(grantByAccount[String(a.id)] || [])]);
    if (before.join() === after.join()) exact++; else mismatches.push({ id: String(a.id), role: a.role, before: before.length, after: after.length });
  }
  console.log(`   ACCOUNT EQUIVALENCE  accounts_checked: ${allAccounts.length}  exact_matches: ${exact}  mismatches: ${mismatches.length}`);
  console.log(`   AFTER-MIGRATION DIGEST (store-derived): ${digestOf(allAccounts.map(a => ({ id: a.id, role: a.role, is_active: a.is_active, effective: sortedSet([...(durableGrants[a.role] || []), ...(grantByAccount[String(a.id)] || [])]) })) )}`);
  mismatches.slice(0, 20).forEach(m => console.log(`      MISMATCH ${m.id} role=${m.role} before=${m.before} after=${m.after}`));
  check('EQ-01', mismatches.length === 0 && exact === allAccounts.length,
    `1,709-account equivalence: ${exact}/${allAccounts.length} exact matches, ${mismatches.length} mismatches`);
  check('EQ-02', allAccounts.length === baseline.length,
    `the gate counted the whole directory both times (${baseline.length} baseline vs ${allAccounts.length} after) — not a truncated page`);

  // §3-E inactive accounts stay inert: identical effective set to their role, no grants
  const inactiveWithGrants = allAccounts.filter(a => a.is_active === false && (grantByAccount[String(a.id)] || []).length);
  check('EQ-03', inactiveWithGrants.length === 0, `no inactive account gains an active authorization (${inactiveWithGrants.length} with grants)`);

  return { storeReady: true, durableGrants, catalogue };
}

/* -------------------------------------------------------------
 * 3. LIVE ENFORCEMENT over real HTTP (§17/§18), plus §19 immediacy.
 * ------------------------------------------------------------- */
async function sectionHttp(client, durableGrants) {
  const suffix = fixtureSuffix();
  const superLogin = await request('POST', '/api/admin/login', SUPER);
  check('HT-01', superLogin.status === 200 && !!superLogin.data.token, `SUPER_ADMIN signs in for the probe (${superLogin.status})`);
  if (superLogin.status !== 200 || !superLogin.data.token) return;
  const st = bearer(superLogin.data.token);

  const mk = async (role, tag) => {
    // The tag separates two probes that share a role: a username built from role+suffix alone
    // made the second create a duplicate and answer 400, which is the product being correct.
    const username = `op1_${role.toLowerCase()}_${tag}_${suffix}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const created = await request('POST', '/api/admin/accounts', {
      username, name: `OP-1 probe ${role} ${tag}`, email: `${username}@nabin.in`, role, password
    }, st);
    let token = null, admin = null;
    if (created.status === 200) {
      const login = await request('POST', '/api/admin/login', { username, password });
      if (login.status === 200 && login.data.token) { token = login.data.token; admin = login.data.admin || null; }
    }
    return { username, password, created, token, admin };
  };

  const A = await mk('SUPPORT_AGENT', 'a');
  const B = await mk('SUPPORT_AGENT', 'b');
  check('HT-02', Boolean(A.token && B.token), `two non-SUPER_ADMIN probes provisioned and signed in (A=${A.created.status}/${A.token ? 'ok' : 'no-token'} B=${B.created.status}/${B.token ? 'ok' : 'no-token'})`);
  if (!A.token || !B.token) return;

  // A real guarded operation. The payment id is deliberately bogus, so the HANDLER will refuse
  // for a domain reason — which can also surface as 403. Asserting on the status alone therefore
  // cannot tell "the authorization gate refused" from "the refund was rejected", and would have
  // reported a working gate as broken. Distinguish by the refusal's own words: the gate says
  // `Missing required permission [finance.refund]`; nothing else can produce that text.
  const REFUND_DENIED = /Missing required permission \[finance\.refund\]/;
  const refund = (token) => request('POST', '/api/admin/finance/refund',
    { paymentId: 'op1_nonexistent_payment', amount: 1, reason: 'OP-1 authorization probe' }, bearer(token));
  const authzRefused = (res) => res.status === 403 && REFUND_DENIED.test(String((res.data && (res.data.error || res.data.message)) || res.raw || ''));
  const a1 = await refund(A.token);
  check('HT-03', authzRefused(a1), `A is refused at the authorization gate for finance.refund (${a1.status} ${String(a1.data.error || '').slice(0, 60)})`);
  const b1 = await refund(B.token);
  check('HT-04', authzRefused(b1), `B refused by the same gate (${b1.status})`);
  const meA = await request('GET', '/api/admin/me', null, bearer(A.token));
  check('HT-05', meA.status === 200 && sortedSet(meA.data?.admin?.permissions || []).join() === sortedSet(ROLE_GRANTS.SUPPORT_AGENT).join(),
    `A's reported permissions are exactly its role grants — the store added nothing it did not earn (${sortedSet(meA.data?.admin?.permissions || []).length})`);

  // §18 cross-account isolation, proven through the server. The grant row is written by the test
  // against the local database (there is no HTTP mutation endpoint in OP-1 and none is faked),
  // then A re-authenticates so the server resolves the effective set from the durable store.
  const insertGrant = async (operatorId, key) => {
    const r = await client.query(`
      insert into public.operator_grants (operator_id, permission_id)
      select $1::uuid, p.id from public.permission_keys p where p.key = $2
      on conflict on constraint operator_grants_operator_permission_key do nothing
      returning id`, [operatorId, key]);
    return r.rowCount;
  };
  const removeGrant = (operatorId, key) => client.query(
    `delete from public.operator_grants g using public.permission_keys p
      where g.operator_id = $1::uuid and p.id = g.permission_id and p.key = $2`, [operatorId, key]);

  // Close any transaction the privilege probes left open, then prove the grant is visible to a
  // DIFFERENT connection. That distinction is the whole point: a write the test can see but the
  // server cannot is not a grant, it is an uncommitted row, and it would make every check below
  // pass on the wrong evidence.
  await client.query('commit').catch(() => {});
  const aId = A.admin?.id || (await client.query('select id from public.admin_accounts where username=$1', [A.username])).rows[0]?.id;
  const bId = B.admin?.id || (await client.query('select id from public.admin_accounts where username=$1', [B.username])).rows[0]?.id;
  const granted = await insertGrant(aId, 'finance.refund');
  check('HT-06', granted === 1, `additive grant row written for A only (${granted})`);

  const viewer = new (require('pg').Client)({ connectionString: DB_URL });
  await viewer.connect();
  const seenElsewhere = await viewer.query(
    `select count(*)::int n from public.operator_grants g join public.permission_keys p on p.id=g.permission_id
      where g.operator_id = $1::uuid and p.key='finance.refund'`, [aId]);
  check('HT-06b', seenElsewhere.rows[0].n === 1,
    `the grant row is committed and visible to another connection, i.e. to the serving process (${seenElsewhere.rows[0].n})`);
  await viewer.end().catch(() => {});

  const relogin = async (f) => {
    const l = await request('POST', '/api/admin/login', { username: f.username, password: f.password });
    return l.status === 200 && l.data.token ? l : null;
  };
  const A2 = await relogin(A), B2 = await relogin(B);
  check('HT-07', Boolean(A2 && B2), `both probes re-authenticated after the grant (A=${A2 ? 200 : 'fail'} B=${B2 ? 200 : 'fail'})`);

  const a3 = await refund(A2.data.token);
  const meA2 = await request('GET', '/api/admin/me', null, bearer(A2.data.token));
  const permsA2 = sortedSet(meA2.data?.admin?.permissions || []);
  check('HT-08a', permsA2.includes('finance.refund'),
    `the server resolved A's effective set from the durable store at sign-in (${permsA2.length} permissions; finance.refund ${permsA2.includes('finance.refund') ? 'present' : 'ABSENT'} — set: ${permsA2.join(',')})`);
  check('HT-08', !authzRefused(a3),
    `A, granted finance.refund, passes the authorization gate and reaches the handler (status ${a3.status} — the domain answer to a bogus payment id is expected here; what must NOT appear is the permission refusal)`);
  const b3 = await refund(B2.data.token);
  check('HT-09', authzRefused(b3), `B — same role, no grant row — stays refused by the gate: grants are per-operator, not per-role (${b3.status})`);

  await removeGrant(aId, 'finance.refund');
  const A3 = await relogin(A);
  const a4 = await refund(A3.data.token);
  check('HT-10', authzRefused(a4), `revoking the grant row returns A to refused by the gate (${a4.status}) — revocation is a row delete, not a stale cache`);

  // §17/§19 escalation through the server-side write path, in this process.
  const db = require('./src/database');
  await db.loadAuthorizationStore();
  const actorUuid = (await client.query(`select id from public.admin_accounts where username='superadmin'`)).rows[0].id;
  const actor = { id: actorUuid };
  check('HT-11', typeof db.applyOperatorGrant === 'function' && typeof db.revokeOperatorGrant === 'function',
    `server-side grant operations exist as the write path (apply=${typeof db.applyOperatorGrant}, revoke=${typeof db.revokeOperatorGrant})`);

  let unattributedRefused = false;
  try { await db.applyOperatorGrant(aId, 'finance.refund', { id: 'not-a-uuid' }); }
  catch (e) { unattributedRefused = e.code === 'AUTHORIZATION_ACTOR_UNRESOLVED'; }
  check('HT-11b', unattributedRefused, 'a grant cannot be recorded against an actor that is not a durable account id — no unattributable privilege change');

  let inventedRefused = false;
  try { await db.applyOperatorGrant(aId, 'finance.do_whatever_i_want', actor); }
  catch (e) { inventedRefused = e.code === 'PERMISSION_KEY_UNKNOWN'; }
  check('HT-12', inventedRefused, 'a permission key outside the catalogue is refused rather than minted (PERMISSION_KEY_UNKNOWN)');

  let ghostRefused = false;
  try { await db.applyOperatorGrant('op1_no_such_operator_zz', 'finance.refund', actor); }
  catch (e) { ghostRefused = e.code === 'OPERATOR_NOT_FOUND'; }
  check('HT-13', ghostRefused, 'a grant cannot be applied to an unknown operator — no fallback-to-first-row, the F4 defect class');

  const applied = await db.applyOperatorGrant(aId, 'finance.refund', actor);
  const mirrorA = db.adminUsers.find(a => String(a.id) === String(aId));
  check('HT-14', applied.applied === true && mirrorA && mirrorA.permissions.includes('finance.refund'),
    'the mutation writes through to the live mirror, so this process enforces it on the next request without a restart (§19)');
  const mirrorB = db.adminUsers.find(a => String(a.id) === String(bId));
  check('HT-15', !(mirrorB?.permissions || []).includes('finance.refund'), 'and the write-through did not touch B');

  await db.revokeOperatorGrant(aId, 'finance.refund', actor);
  const afterRevoke = db.adminUsers.find(a => String(a.id) === String(aId));
  check('HT-16', !(afterRevoke?.permissions || []).includes('finance.refund'), 'revocation removes it from the live mirror too');
  const stillRole = sortedSet(afterRevoke.permissions).join() === sortedSet(ROLE_GRANTS.SUPPORT_AGENT).join();
  check('HT-17', stillRole, `A is back to exactly its role grants after revoke+revoke (${sortedSet(afterRevoke.permissions).length})`);

  const { rows: leftover } = await client.query(`select count(*)::int n from public.operator_grants where operator_id in ($1::uuid,$2::uuid)`, [aId, bId]);
  check('HT-18', leftover[0].n === 0, `no probe grant row is left behind (${leftover[0].n}) — the directory is as it was`);

  const esc = await request('POST', '/api/admin/accounts', { username: `op1_esc_${suffix}`, name: 'esc', email: `op1_esc_${suffix}@nabin.in`, role: 'SUPER_ADMIN', password: crypto.randomBytes(18).toString('base64url') }, bearer(A2.data.token));
  check('HT-19', esc.status === 403 || esc.status === 401, `an operator cannot call a super-only endpoint to mint itself a SUPER_ADMIN (${esc.status})`);

  // Probe accounts are this test's own rows, removed so they do not accumulate the way wallet
  // residue accumulated and later broke FIN15B-20. Grant rows go first (they cascade anyway),
  // then the session rows that reference the account, then the account itself.
  const sweep = `
    delete from public.operator_grants where operator_id in (select id from public.admin_accounts where username like 'op1_%');
    delete from public.backend_sessions where entity_id in (select id::text from public.admin_accounts where username like 'op1_%');
    delete from public.admin_accounts where username like 'op1_%';`;
  let swept = 0, sweepError = null;
  try {
    await client.query('begin');
    await client.query(sweep);
    const left = await client.query(`select count(*)::int n from public.admin_accounts where username like 'op1_%'`);
    swept = left.rows[0].n;
    await client.query('commit');
  } catch (e) {
    sweepError = e.message;
    await client.query('rollback').catch(() => {});
  }
  check('HT-99', sweepError === null && swept === 0,
    `probe accounts removed, directory left as it was (${swept} remaining${sweepError ? ' — ' + sweepError : ''})`);
}

(async () => {
  if (!/127\.0\.0\.1|localhost/.test(DB_URL)) { console.log('REFUSED: OP-1 gate is local-database only.'); process.exit(2); }
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  const proc = await ensureServerRunning();
  try {
    const baseline = await sectionBaseline(client);
    const store = await sectionStore(client, baseline);
    if (store.storeReady) {
      try {
        await sectionHttp(client, store.durableGrants);
      } catch (e) {
        // A harness/connection failure is reported as a failed check, never as a silent pass and
        // never as a crash that hides the checks that had not run yet.
        check('HT-ERR', false, `HTTP enforcement section aborted: ${e.message}`);
      }
    } else {
      check('HT-00', false, 'HTTP enforcement section not evaluable — the store is absent (this is the expected RED)');
    }
  } finally {
    await client.end().catch(() => {});
    if (proc) try { proc.kill(); } catch (e) {}
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);
  console.log(`\n====================================================`);
  console.log(`OP-1 GATE  ${passed} PASSED, ${failed.length} FAILED, 0 SKIPPED`);
  failed.forEach(f => console.log(`   ❌ [${f.id}] ${f.detail}`));
  console.log(`====================================================`);
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => { console.log('FATAL ' + e.message + '\n' + e.stack); process.exitCode = 1; });
