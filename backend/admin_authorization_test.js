// =========================================================================
// THE ADMIN AUTHORISATION MATRIX, PROVEN PER ROLE AND PER ROUTE
//
// This is the Phase A gate from §8 of docs/ADMIN_FEATURE_SPECIFICATION.md: "for each of
// the five roles, prove allow/deny on every gated route, and prove a revoked admin
// session stops working". Neither half had a proof before this file. `RBAC-01..12` in
// `test_suite.js` checks nine hand-picked routes, and the property it leaves unproven is
// the one the whole area-33 requirement rests on — that a permission string written on a
// route actually decides the answer *everywhere*, and that the grants a role holds are
// the grants the catalogue says it holds.
//
// Four things are measured here rather than assumed:
//
//   1. DENY, on every gated route, for every role that does not hold its permission.
//      A refusal is safe to probe in bulk because the gate runs before the handler, so
//      nothing is read or written. This is the exhaustive half: 197 pairs, not nine.
//   2. ALLOW, one probe per permission name. These are *not* bulk-probed, because an
//      accepted request runs the handler and several handlers move money or pause
//      services. Every probe below is a request the handler refuses on its own
//      validation, against a route read first to confirm it validates before it acts.
//      A permission whose every route would take effect even from an empty body is
//      listed as NOT_PROBED with its reason, so the gap is a fact on the record and not
//      a silent green.
//   3. That the answers agree with one source. `GET /api/admin/me` is compared with
//      `adminPermissions.js` per role, and every literal in `requirePermission(...)` is
//      checked against the catalogue, so a typo'd gate name — which denies everyone
//      except the wildcard role, silently — fails here instead of in production.
//   4. Revocation, area 34: a session revoked through the security centre stops working
//      on the next request, in this process and in the durable store, including for a
//      session this process never issued. Disabling an account does the same to all of
//      its sessions at once, which is what §1.4 asked for when it recorded that
//      revocation used to be delayed until the account's next sign-in.
//
// LOCAL ONLY. It provisions four throwaway administrator accounts and one throwaway
// session row in the local development database, and disables them again as it finishes.
// It never disables or touches the platform's own SUPER_ADMIN, and the two controls whose
// accepted call would pause the platform or broadcast to users are probed only from the
// refusing side.
// =========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// A server this file spawns carries these, because the payment verifiers refuse to be
// configured from a value in the source (see project memory: suite preconditions).
process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const { ROLE_GRANTS, grantsForRole, KNOWN_ADMIN_ROLES } = require('./src/adminPermissions');

const BASE_URL = 'http://127.0.0.1:4000';
const ABSENT = 'authz_absent_zz';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function request(method, route, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, BASE_URL);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data), raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data, data: {} });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function ensureServerRunning() {
  try {
    const res = await request('GET', '/api/health');
    if (res.status === 200) return null;
  } catch (e) {}
  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true
  });
  proc.unref();
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return proc;
    } catch (e) {}
  }
  return proc;
}

function fixtureSuffix() {
  return `${Date.now().toString(36).slice(-6)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`.toLowerCase();
}

// -------------------------------------------------------------
// The route table, read out of the source rather than restated here.
//
// A hand-written list drifts from the routes the moment someone adds one, and the drift
// is silent: the harness keeps passing against the list it knows. Parsing `server.js`
// means a new guarded route is in the matrix on the next run, with no edit to this file.
// -------------------------------------------------------------

// The statement, not the line, is what carries a route's guards: `app.post(` can
// open with an array of paths, and its middleware chain can run onto the next
// line. A line-based, single-quote-only parse silently ignored 35 of the 191
// registrations in server.js — including every `/api/v1/...` alias and
// `POST /api/driver/location`, which is exactly the shape a new geo route
// arrives in. So the scan reads from the opener to the handler, and looks for
// guards only in the chain before it.
//
// The chain, not the whole argument list: a handler's body mentions other
// routes' permissions and other registrations wholesale, so counting guards over
// it attributes `finance.adjust` to its predecessor's route and turns a correct
// 403 into a reported mismatch.
function readRegistrationStatements(src) {
  const out = [];
  const opener = /app\.(get|post|put|patch|delete)\(/g;
  let m;
  while ((m = opener.exec(src))) {
    // Only a top-level registration, not one nested inside a handler's body.
    if (!/^\s*$/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index))) continue;
    const rest = src.slice(m.index + m[0].length);
    const handlerAt = rest.search(/(?:async\s+)?\(\s*req\s*,\s*res\s*\)\s*=>/);
    const nextRegistration = rest.search(/\n\s*app\./);
    let chainLen = Math.min(handlerAt >= 0 ? handlerAt : Infinity,
      nextRegistration >= 0 ? nextRegistration : Infinity);
    if (!Number.isFinite(chainLen)) {
      const nl = rest.indexOf('\n');
      chainLen = nl >= 0 ? nl : rest.length;
    }
    out.push({
      verb: m[1].toUpperCase(),
      args: rest.slice(0, chainLen),
      line: src.slice(0, m.index).split('\n').length
    });
  }
  return out;
}

// One registration can name several paths, and each is its own route in the
// matrix, because each is a separate thing a caller can reach.
function pathsOf(args) {
  const head = args.split(',')[0].trim();
  return [...head.matchAll(/['"`]([^'"`]+)['"`]/g)].map(x => x[1]);
}

function readGuardedRoutes() {
  const src = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const routes = [];
  for (const reg of readRegistrationStatements(src)) {
    if (!reg.args.includes('authenticateAdmin')) continue;
    const perms = [...reg.args.matchAll(/requirePermission\('([^']+)'\)/g)].map(x => x[1]);
    const condPerms = Object.keys(CONDITIONAL_GATES)
      .filter(fn => reg.args.includes(fn)).flatMap(fn => CONDITIONAL_GATES[fn].names);
    for (const pattern of pathsOf(reg.args)) {
      routes.push({
        method: reg.verb,
        pattern,
        // Every `:param` filled with a token no record can match, so a request that
        // reaches its handler is refused there rather than acting on real data.
        probePath: pattern.replace(/:[A-Za-z0-9_]+/g, ABSENT),
        perms,
        condPerms,
        superOnly: reg.args.includes('requireSuperAdmin'),
        line: reg.line
      });
    }
  }
  return routes;
}

// One safe probe per permission name, for the allow half. `via` is the handler's own
// refusal that proves the request got past the gate; each entry was read in
// `src/server.js` before it was written down, and the four refused entries at the bottom
// are the ones where no such body exists.
const ALLOW_PROBES = {
  'admin_accounts.manage': { method: 'GET', route: '/api/admin/accounts' },
  'admin_accounts.create': { method: 'POST', route: '/api/admin/accounts', body: {}, note: 'createAdminAccount refuses a missing mandatory field before it writes' },
  'audit.view': { method: 'GET', route: '/api/admin/audit-logs?limit=1' },
  'security.view': { method: 'GET', route: '/api/admin/security/sessions' },
  'security.session.revoke': { method: 'POST', route: '/api/admin/security/sessions/revoke', body: {}, note: 'names no target, so nothing is revoked' },
  'finance.view': { method: 'GET', route: '/api/admin/finance/metrics' },
  'finance.settlement': { method: 'GET', route: '/api/admin/finance/settlements/drivers' },
  'finance.refund': { method: 'POST', route: '/api/admin/finance/refund', body: {}, note: 'paymentId or jobId required before the RPC' },
  'finance.adjust': { method: 'POST', route: '/api/admin/finance/adjustments', body: {}, note: 'amount validated before the ledger RPC' },
  'identity_verification.view': { method: 'GET', route: '/api/admin/identity-verifications' },
  'identity_verification.review': { method: 'POST', route: `/api/admin/identity-verifications/${ABSENT}/lock`, body: {}, note: 'no such application, so 409 before any lock' },
  // Since D2 the document preview asks for this name instead of serving anyone who asks.
  // The bytes are still the hard-coded mock, so what the probe proves is the gate.
  'identity_documents.view': { method: 'GET', route: '/docs/preview_aadhaar.png', note: 'a mock SVG — reaching the handler is the claim, not the image' },
  'fleet.manage': { method: 'POST', route: `/api/admin/drivers/${ABSENT}/status`, body: {} },
  'merchant.manage': { method: 'POST', route: `/api/admin/restaurants/${ABSENT}/status`, body: {} },
  'support.view': { method: 'GET', route: '/api/admin/support' },
  'support.respond': { method: 'POST', route: `/api/admin/support/${ABSENT}/assign`, body: {} },
  'support.resolve': { method: 'POST', route: `/api/admin/support/${ABSENT}/resolve`, body: {} },
  'geofence.view': { method: 'GET', route: '/api/admin/geofences' },
  'geofence.delete': { method: 'DELETE', route: `/api/admin/geofences/${ABSENT}`, body: null, note: 'no such zone, so 404 before any delete' },
  'surge.view': { method: 'GET', route: '/api/admin/surgezones' },
  'promotion.view': { method: 'GET', route: '/api/admin/promotions' },
  'promotion.edit': { method: 'PUT', route: `/api/admin/promotions/${ABSENT}`, body: {} },
  'promotion.create': { method: 'POST', route: '/api/admin/promotions', body: {}, note: 'no code, so validation refuses' },
  'campaign.view': { method: 'GET', route: '/api/admin/campaigns' },
  'campaign.edit': { method: 'PUT', route: `/api/admin/campaigns/${ABSENT}`, body: {} },
  'campaign.delete': { method: 'DELETE', route: `/api/admin/campaigns/${ABSENT}`, body: null },
  'campaign.publish': { method: 'POST', route: `/api/admin/campaigns/${ABSENT}/status`, body: {} },
  'advertisement.edit': { method: 'PUT', route: `/api/admin/advertisements/${ABSENT}`, body: {} },
  'advertisement.delete': { method: 'DELETE', route: `/api/admin/advertisements/${ABSENT}`, body: null },
  // createCampaign runs validateAndShape before the first insert, and an empty body
  // fails on code/name/schedule, so the handler is reached and nothing is persisted.
  'campaign.create': { method: 'POST', route: '/api/admin/campaigns', body: {}, note: 'validateAndShape refuses code/name/startsAt/endsAt before any insert' },
  'advertisement.create': { method: 'POST', route: '/api/admin/advertisements', body: {}, note: 'the repository validates before it inserts' },
  'catalog.manage': { method: 'PUT', route: `/api/admin/master-catalog/${ABSENT}`, body: {} },
  // An absent id is refused by the status validation before the directory is read at all,
  // so the allow half proves the handler is reachable without writing to anybody.
  'customers.read': { method: 'GET', route: '/api/admin/customers?limit=1' },
  'customers.suspend': { method: 'POST', route: `/api/admin/customers/${ABSENT}/status`, body: {}, note: 'no status in the body, so CUSTOMER_STATUS_INVALID before any lookup or write' },
  'grocery.review': { method: 'POST', route: `/api/admin/grocery/products/${ABSENT}/review`, body: { action: 'NOT_A_RULE' } },
  'pricing.edit': { method: 'GET', route: '/api/admin/pricing' },
  'services.pause': { method: 'POST', route: '/api/admin/services/pause', body: {}, note: 'serviceId required before any pause' },
  'services.resume': { method: 'POST', route: '/api/admin/services/resume', body: {}, note: 'serviceId required before any resume' },
  'services.emergency_killswitch': { method: 'POST', route: '/api/admin/services/emergency-killswitch', body: {}, note: 'direction required; an empty body no longer lifts a lockdown' }
};

// Permissions whose every route takes effect from any body, so the allow half is not
// probed here. They stay deny-probed like every other route: what is unproven is only
// that a holder reaches the handler, which for all four is the SUPER_ADMIN wildcard the
// probes above already exercise on other routes.
const NOT_PROBED = {
  'notification.broadcast': 'a broadcast with a body is a real broadcast to a real audience, and the 15-minute cooldown window is a shared resource',
  'orders.manage': 'POST /api/admin/orders/expire-stale takes no input at all, so any accepted call expires live orders',
  'geofence.create': 'addGeoFence is not verified to validate before inserting, so an empty body could persist a junk zone',
  'surge.create': 'the surge write is not verified to validate before inserting, and an accepted row changes pricing for a live zone'
};

// A gate that one body field selects between cannot appear as `requirePermission('name')`
// in the route chain, so the parser above would lose it. Each entry names the middleware,
// the catalogue names it enforces, and why its refusal side is not reachable over HTTP —
// which is a fact about the *grants*, not about the gate: no role holds the route's own
// permission without also holding all three decisions, so the pair (route, refusing role)
// does not exist. The refusals are proven by calling the middleware in
// `admin_identity_gates_test.js` instead, and this file's CAT-03 accepts a name on this
// list the way it accepts a probe.
const CONDITIONAL_GATES = {
  requireIdentityDecision: {
    names: ['identity_verification.approve', 'identity_verification.reject',
      'identity_verification.request_resubmission'],
    proof: 'admin_identity_gates_test.js KG-10..12 (middleware called directly, one refusal per decision)',
    why: 'the route gate is identity_verification.review, and the only non-super role that holds it holds all three decisions'
  }
};

function holderFor(permission, tokens) {
  // Prefer a non-super holder: SUPER_ADMIN passes `requirePermission` by wildcard before
  // its list is ever consulted, so a super-only probe proves the route is reachable and
  // nothing at all about the grant.
  for (const role of ['KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT']) {
    if (ROLE_GRANTS[role].includes(permission) && tokens[role]) return { role, proof: 'grants list' };
  }
  return { role: 'SUPER_ADMIN', proof: 'wildcard (no non-super role holds it)' };
}

async function main() {
  console.log('=======================================================================');
  console.log('🔐 NABIN ADMIN AUTHORISATION MATRIX — PHASE A GATE');
  console.log('=======================================================================\n');

  const spawned = await ensureServerRunning();

  // --- PRE: the server under test is the code on disk ------------------
  // The route table below is parsed from `src/server.js`, so a server booted before
  // today's edit would answer for routes this file believes exist. The security centre
  // is the youngest of them, which makes it a usable tripwire.
  const tripwire = await request('GET', '/api/admin/security/sessions');
  check('PRE-01', tripwire.status !== 404,
    `the running backend carries the security centre (unauthenticated probe answered ${tripwire.status}) — a 404 means the server was booted before this code and needs a restart`);
  check('PRE-02', tripwire.status === 401,
    `an anonymous admin read is refused at the door, not answered from a fallback (${tripwire.status})`);

  const live = isLivePostgres && !!supabaseAdmin;
  check('PRE-03', live, `the durable session and account checks need the local PostgreSQL store (isLivePostgres=${isLivePostgres})`);
  if (!live) {
    console.error('\n❌ Aborting: without the local store the revocation assertions would quietly test nothing.\n');
    process.exit(1);
  }

  const superLogin = await request('POST', '/api/admin/login', SUPER);
  check('PRE-04', superLogin.status === 200 && !!superLogin.data.token,
    `the platform SUPER_ADMIN signs in for the probe tokens (${superLogin.status})`);
  if (superLogin.status !== 200) process.exit(1);
  const superToken = superLogin.data.token;
  const tokens = { SUPER_ADMIN: superToken };

  // --- Provision one account per remaining role ------------------------
  const suffix = fixtureSuffix();
  const provisioned = [];
  for (const role of ['KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT']) {
    const username = `authz_${role.toLowerCase().slice(0, 4)}_${suffix}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const created = await request('POST', '/api/admin/accounts', {
      username, name: `Authz Matrix ${role}`, email: `${username}@nabin.in`, role, password
    }, bearer(superToken));
    const account = created.data && created.data.account;
    provisioned.push({ role, username, accountId: account && account.id });
    const login = created.status === 200
      ? await request('POST', '/api/admin/login', { username, password })
      : { status: created.status };
    if (login.status === 200 && login.data.token) tokens[role] = login.data.token;
    check(`PRE-05.${role}`, login.status === 200 && !!login.data.token,
      `a ${role} account was provisioned and signed in (provision=${created.status} login=${login.status}${login.data && login.data.error ? ' ' + login.data.error : ''})`);
  }
  const missing = ['KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT'].filter(r => !tokens[r]);
  if (missing.length) {
    console.error(`\n❌ Aborting: no token for ${missing.join(', ')} — the matrix cannot be run against roles that cannot sign in.\n`);
    process.exit(1);
  }

  // --- CAT: the guard map, measured ------------------------------------
  const routes = readGuardedRoutes();
  const gated = routes.filter(r => r.perms.length || r.condPerms.length);
  const conditionalNames = [...new Set(gated.flatMap(r => r.condPerms))].sort();
  const names = [...new Set([...gated.flatMap(r => r.perms), ...conditionalNames])].sort();
  const ungated = routes.filter(r => !r.perms.length && !r.condPerms.length && !r.superOnly);

  check('CAT-01', routes.length >= 70 && gated.length >= 55,
    `parsed ${routes.length} authenticateAdmin routes from src/server.js, ${gated.length} of them permission-gated on ${names.length} names (${conditionalNames.length} of those through a body-selected middleware)`);

  const deadGates = names.filter(n => !Object.values(ROLE_GRANTS).some(list => list.includes(n)));
  check('CAT-02', deadGates.length === 0,
    `every permission a route asks for exists in the catalogue (offenders: ${deadGates.length ? deadGates.join(', ') : 'none'}) — a name nobody holds denies every non-super role forever`);

  const superOnly = names.filter(n => !['KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT']
    .some(r => ROLE_GRANTS[r].includes(n)));
  const conditionalSet = new Set(conditionalNames);
  const uncovered = names.filter(n => !ALLOW_PROBES[n] && !NOT_PROBED[n] && !conditionalSet.has(n));
  const staleBookkeeping = [...Object.keys(ALLOW_PROBES), ...Object.keys(NOT_PROBED)]
    .filter(n => !names.includes(n));
  check('CAT-03', uncovered.length === 0 && staleBookkeeping.length === 0,
    `every gated permission has a safe allow probe, a recorded reason not to probe one, or a named conditional middleware proven elsewhere (${names.length} names, ${Object.keys(ALLOW_PROBES).length} probed, ${Object.keys(NOT_PROBED).length} refused-with-reason, ${conditionalNames.length} conditional${staleBookkeeping.length ? `; STALE entries no longer gating anything: ${staleBookkeeping.join(', ')}` : ''}${uncovered.length ? `; UNCOVERED: ${uncovered.join(', ')}` : ''})`);

  // D2 closed §11 decision 9 by deleting the second, unreachable
  // `app.get('/api/admin/drivers', ...)`. A deletion only stays closed if something fails
  // when it is undone, and the ceiling below was the shape *before* that deletion — so the
  // count is now held at what the tree actually measures, and CAT-06 names the fault rather
  // than letting it hide inside a route tally.
  // The same bookkeeping as CAT-04, for the routes that carry no permission
  // name at all. The ceiling was 14 while the parser could only see single-line,
  // single-quoted registrations; the corrected parse found three more that had
  // always been there and had always been ungated — `GET /api/admin/features`,
  // its `POST /api/v1/admin/features` twin, and
  // `GET /api/v1/fleet/locations`. Those are recorded here as debt the matrix
  // now sees, not closed here: gating the features pair is the admin spec's
  // feature-flag family decision, and gating the fleet alias is §14 decision 9
  // ("who may read live driver positions?"), which no test may answer by
  // assertion.
  check('CAT-04', ungated.length <= 17,
    `admin routes with no permission check: ${ungated.length} (ceiling 17, the count after the statement-level parse stopped missing array-form aliases) — least-privilege debt, named in CAT-05`);
  console.log(`   · CAT-04 detail  ${ungated.map(r => `${r.method} ${r.pattern}@${r.line}`).join('\n     ')}\n`);

  const allRegistrations = new Map();
  const srcForCatalogue = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  for (const reg of readRegistrationStatements(srcForCatalogue)) {
    for (const pattern of pathsOf(reg.args)) {
      const key = `${reg.verb} ${pattern}`;
      if (!allRegistrations.has(key)) allRegistrations.set(key, []);
      allRegistrations.get(key).push(reg.line);
    }
  }
  const doubleRegistered = [...allRegistrations].filter(([, lns]) => lns.length > 1);
  check('CAT-06', doubleRegistered.length === 0,
    `every method+path in src/server.js is registered exactly once (${allRegistrations.size} registrations${doubleRegistered.length ? `, duplicates: ${doubleRegistered.map(([k, lns]) => `${k}@${lns.join(',')}`).join(' | ')}` : ''}) — a second one is not a second route, it is dead code Express never reaches, and the first one's projection is what leaks or holds`);

  const unenforced = Object.values(ROLE_GRANTS).reduce((all, list) => {
    for (const p of list) if (!names.includes(p)) all.add(p);
    return all;
  }, new Set());
  const unenforcedList = [...unenforced].sort();
  const serverSrc = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const enforcedElsewhere = unenforcedList.filter(p => serverSrc.includes(`'${p}'`));
  check('CAT-05', true,
    `catalogue names with no route-level gate: ${unenforcedList.length} (${unenforcedList.join(', ')}); ${enforcedElsewhere.length} of those are checked inside a handler, so ${unenforcedList.length - enforcedElsewhere.length} grant nothing anywhere — §5 row 33`);

  // --- DENY: every gated route, every role that must not reach it ------
  let denyPairs = 0;
  const offenders = [];
  for (const role of ['KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT']) {
    const bad = [];
    for (const route of gated) {
      for (const perm of route.perms) {
        if (ROLE_GRANTS[role].includes(perm)) continue;
        denyPairs += 1;
        const res = await request(route.method, route.probePath, {}, bearer(tokens[role]));
        const named = String(res.data.error || '').includes(perm);
        if (res.status !== 403 || !named) {
          bad.push(`${route.method} ${route.pattern} → ${res.status} ${JSON.stringify(res.data).slice(0, 90)}`);
        }
      }
    }
    const expected = gated.reduce((n, r) => n + r.perms.filter(p => !ROLE_GRANTS[role].includes(p)).length, 0);
    check(`DENY.${role}`, bad.length === 0,
      `${expected} gated (route, permission) pairs refused ${role} with 403 naming the permission (offenders: ${bad.length ? '\n     ' + bad.join('\n     ') : 'none'})`);
    offenders.push(...bad);
  }
  check('DENY-ALL', denyPairs >= 190 && offenders.length === 0,
    `${denyPairs} allow/deny pairs exercised from the refusing side across four roles`);

  const anon = await request('GET', '/api/admin/audit-logs');
  const garbage = await request('GET', '/api/admin/audit-logs', null, bearer('adm_token_not_a_session'));
  check('DENY-401', anon.status === 401 && garbage.status === 401,
    `no token and a made-up token are both refused at the door, before the permission question (${anon.status}/${garbage.status})`);

  // --- ALLOW: one probe per permission, held by a role that may pass ---
  const notProbed = [];
  for (const perm of names) {
    if (conditionalSet.has(perm)) {
      const gate = Object.entries(CONDITIONAL_GATES).find(([, g]) => g.names.includes(perm))[0];
      console.log(`   · ALLOW.${perm.padEnd(32)} CONDITIONAL MIDDLEWARE — ${gate}(): ${CONDITIONAL_GATES[gate].proof}; ${CONDITIONAL_GATES[gate].why}`);
      continue;
    }
    const probe = ALLOW_PROBES[perm];
    if (!probe) {
      notProbed.push(perm);
      console.log(`   · ALLOW.${perm.padEnd(32)} NOT PROBED — ${NOT_PROBED[perm]}`);
      continue;
    }
    const holder = holderFor(perm, tokens);
    const res = await request(probe.method, probe.route, probe.body === undefined ? {} : probe.body, bearer(tokens[holder.role]));
    const reached = res.status !== 401 && res.status !== 403;
    check(`ALLOW.${perm}`, reached,
      `${holder.role} (${holder.proof}) reaches the handler for '${perm}' — ${probe.method} ${probe.route} answered ${res.status}${probe.note ? ' (' + probe.note + ')' : ''}`);
  }
  check('ALLOW-COVER', notProbed.length === Object.keys(NOT_PROBED).length,
    `the unprobed list is exactly the recorded one (${notProbed.sort().join(', ') || 'empty'})`);

  // A refusal is only meaningful if the same account can do something it is allowed to.
  // Otherwise "every probe was refused" could be "every probe was mis-authenticated".
  const sanity = await request('GET', '/api/admin/support', null, bearer(tokens.OPERATIONS));
  check('ALLOW-SANITY', sanity.status === 200,
    `the OPERATIONS token can read the support queue it is granted (${sanity.status}) — so the refusals above are the gate, not a broken token`);

  // --- ME: the grants a client is told match the catalogue -------------
  for (const role of ['SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT']) {
    const me = await request('GET', '/api/admin/me', null, bearer(tokens[role]));
    const admin = me.data.admin || {};
    const expected = grantsForRole(role);
    const got = (admin.permissions || []).slice().sort().join(',');
    const want = [...expected].sort().join(',');
    check(`ME.${role}`, me.status === 200 && admin.role === role && got === want,
      `GET /api/admin/me reports ${role}'s grants as the catalogue defines them (${(admin.permissions || []).length} names, identical to adminPermissions.js: ${got === want})`);
    check(`ME.${role}.nosecret`, !/password_hash|passwordHash|password_salt|"salt"/.test(me.raw),
      `the same answer carries no credential material`);
  }

  // --- SEC: the security centre surface --------------------------------
  // The account under test was provisioned with a random password this file kept, but a
  // fresh session is easier to reason about: reset it through the super-user path, then
  // sign in twice and revoke twice.
  const victim = provisioned.find(p => p.role === 'SUPPORT_AGENT');
  const victimPassword = crypto.randomBytes(18).toString('base64url');
  const reset = await request('POST', '/api/admin/reset-password', {
    identifier: victim.username, newPassword: victimPassword
  }, bearer(superToken));
  const victimSignIn = await request('POST', '/api/admin/login', { username: victim.username, password: victimPassword });
  check('SEC-00', reset.status === 200 && victimSignIn.status === 200 && !!victimSignIn.data.token,
    `a fresh session for ${victim.username} exists to be revoked (reset=${reset.status} login=${victimSignIn.status})`);
  const victimToken = victimSignIn.data.token;

  const listAsSuper = await request('GET', '/api/admin/security/sessions', null, bearer(superToken));
  const sessions = listAsSuper.data.sessions || [];
  const victimRows = sessions.filter(s => s.adminId === String(victim.accountId));
  check('SEC-01', listAsSuper.status === 200 && Array.isArray(sessions) && victimRows.length >= 1,
    `the session list shows the session just issued (${sessions.length} administrator sessions, ${victimRows.length} for the account under test)`);
  check('SEC-02', sessions.every(s => /^[0-9a-f]{64}$/.test(s.sessionId)),
    `every listed handle is the SHA-256 the store keys on, never a bearer token`);
  check('SEC-03', !listAsSuper.raw.includes(victimToken) && !listAsSuper.raw.includes(SUPER.password),
    `neither bearer appears anywhere in the response body — the list is a revoke handle, not a credential box`);
  check('SEC-04', victimRows.length >= 1 && victimRows.every(s => s.inAdminMap === true),
    `it also says which of them this process honours in its own admin map`);

  const listAsSupport = await request('GET', '/api/admin/security/sessions', null, bearer(tokens.SUPPORT_AGENT));
  const revokeAsOps = await request('POST', '/api/admin/security/sessions/revoke', { adminId: victim.accountId }, bearer(tokens.OPERATIONS));
  check('SEC-05', listAsSupport.status === 403 && revokeAsOps.status === 403,
    `reading and revoking sessions are their own two permissions, and neither is granted outside SUPER_ADMIN (${listAsSupport.status}/${revokeAsOps.status} — §4 row "Security centre / revoke sessions")`);

  const lockouts = await request('GET', '/api/admin/security/login-lockouts', null, bearer(superToken));
  check('SEC-06', lockouts.status === 200 && lockouts.data.scope === 'THIS_SERVER_PROCESS_ONLY'
    && lockouts.data.durableColumnsInSchema === false,
    `the lockout read is labelled for what it is: ${lockouts.status} with scope ${lockouts.data.scope} and durableColumnsInSchema=${lockouts.data.durableColumnsInSchema}`);
  const failedAttempts = await request('POST', '/api/admin/login', { username: victim.username, password: 'wrong-on-purpose' });
  const lockoutsAfter = await request('GET', '/api/admin/security/login-lockouts', null, bearer(superToken));
  const victimCounter = (lockoutsAfter.data.counters || []).find(c => c.username === victim.username);
  check('SEC-07', failedAttempts.status === 401 && !!victimCounter && victimCounter.failedAttempts >= 1,
    `a failed sign-in shows up as a counter with a username and a number, not a claim about who might be attacking (${failedAttempts.status}, counter=${JSON.stringify(victimCounter)})`);
  check('SEC-08', !/password|hash|salt/i.test(lockoutsAfter.raw),
    `and the lockout surface carries no credential material`);

  // --- REV: revocation, proven by using the session afterwards ---------
  const noTarget = await request('POST', '/api/admin/security/sessions/revoke', {}, bearer(superToken));
  check('REV-01', noTarget.status === 400 && noTarget.data.code === 'SESSION_REVOCATION_TARGET_REQUIRED',
    `a revoke that names no target revokes nothing (${noTarget.status} ${noTarget.data.code}) — there is no "revoke everything" default`);

  const badHandle = await request('POST', '/api/admin/security/sessions/revoke', { sessionId: 'deadbeef' }, bearer(superToken));
  check('REV-02', badHandle.status === 400 && badHandle.data.code === 'SESSION_ID_INVALID',
    `a partial or invented handle is refused rather than prefix-matched into somebody else's session (${badHandle.status} ${badHandle.data.code})`);

  const revoke = await request('POST', '/api/admin/security/sessions/revoke', { adminId: victim.accountId }, bearer(superToken));
  check('REV-03', revoke.status === 200 && revoke.data.revoked.revokedInStore >= 1,
    `revoking by account answered ${revoke.status} and took ${revoke.data.revoked && revoke.data.revoked.revokedInStore} durable session row(s) (${JSON.stringify(revoke.data.revoked || {}).slice(0, 160)})`);

  const afterRevokeMe = await request('GET', '/api/admin/me', null, bearer(victimToken));
  const afterRevokeGated = await request('GET', '/api/admin/audit-logs?limit=1', null, bearer(victimToken));
  check('REV-04', afterRevokeMe.status === 401 && afterRevokeGated.status === 401,
    `the revoked bearer stops working immediately on both an ungated and a gated admin route (${afterRevokeMe.status}/${afterRevokeGated.status}) — this is the assertion the old "delayed revocation" could not pass`);

  const storeRow = await supabaseAdmin.from('backend_sessions').select('token_hash')
    .eq('entity_id', String(victim.accountId)).in('role', ['ADMIN', ...KNOWN_ADMIN_ROLES]);
  check('REV-05', !storeRow.error && (storeRow.data || []).length === 0,
    `and it is gone from the durable store too, so a restart cannot hand it back (${(storeRow.data || []).length} row(s) left)`);

  const trail = await request('GET', '/api/admin/audit-logs?action=ADMIN_SESSIONS_REVOKED&limit=5', null, bearer(superToken));
  const trailRow = (trail.data.logs || []).find(l => String(l.targetEntityId) === String(victim.accountId));
  check('REV-06', trail.status === 200 && !!trailRow,
    `the revocation is on the audit trail, naming the account whose access was cut (${trailRow ? trailRow.action : 'no row'})`);
  check('REV-07', !!trailRow && !JSON.stringify(trailRow).includes(victimToken)
    && !JSON.stringify(trailRow).includes(victimPassword),
    `and the trail records who revoked whom without copying the bearer or the password into a table more people read`);

  // A second sign-in, revoked by handle instead of by account.
  const second = await request('POST', '/api/admin/login', { username: victim.username, password: victimPassword });
  const secondToken = second.data.token;
  const listAgain = await request('GET', '/api/admin/security/sessions', null, bearer(superToken));
  const mine = (listAgain.data.sessions || []).find(s => s.adminId === String(victim.accountId));
  const byHandle = await request('POST', '/api/admin/security/sessions/revoke', { sessionId: mine && mine.sessionId }, bearer(superToken));
  const secondDead = await request('GET', '/api/admin/me', null, bearer(secondToken || 'none'));
  const twice = await request('POST', '/api/admin/security/sessions/revoke', { sessionId: mine && mine.sessionId }, bearer(superToken));
  check('REV-08', second.status === 200 && byHandle.status === 200 && secondDead.status === 401,
    `a single session revoked by handle kills exactly that bearer (${second.status}/${byHandle.status}/${secondDead.status})`);
  check('REV-09', twice.status === 404 && twice.data.code === 'SESSION_NOT_FOUND',
    `revoking it again reports that there is nothing left to revoke, instead of a second success (${twice.status} ${twice.data.code})`);

  // --- DIS: disabling an account cuts its sessions at once -------------
  const badStatus = await request('POST', `/api/admin/accounts/${victim.accountId}/status`, {}, bearer(superToken));
  check('DIS-01', badStatus.status === 400 && badStatus.data.code === 'ADMIN_STATUS_VALUE_REQUIRED',
    `a status write that does not say which way is refused instead of guessing (${badStatus.status})`);

  const opsDisables = await request('POST', `/api/admin/accounts/${victim.accountId}/status`, { isActive: false }, bearer(tokens.OPERATIONS));
  check('DIS-02', opsDisables.status === 403,
    `disabling an administrator is admin_accounts.manage, not merely being an administrator (${opsDisables.status})`);

  const reSignIn = await request('POST', '/api/admin/login', { username: victim.username, password: victimPassword });
  const disable = await request('POST', `/api/admin/accounts/${victim.accountId}/status`, { isActive: false }, bearer(superToken));
  const disabledMe = await request('GET', '/api/admin/me', null, bearer(reSignIn.data.token || 'none'));
  const storeAccount = await supabaseAdmin.from('admin_accounts').select('is_active').eq('id', victim.accountId).maybeSingle();
  check('DIS-03', disable.status === 200 && disable.data.account.status === 'INACTIVE',
    `disabling the account answered ${disable.status}${disable.data.code ? ' ' + disable.data.code : ''} and reports ${disable.data.account && disable.data.account.status} with ${disable.data.sessionsRevoked && disable.data.sessionsRevoked.inStore} session(s) cut`);
  check('DIS-04', disabledMe.status === 401,
    `the signed-in bearer of a disabled account stops working on the next request, not on the next sign-in (${disabledMe.status}) — §1.4's delayed revocation`);
  check('DIS-05', !storeAccount.error && storeAccount.data && storeAccount.data.is_active === false,
    `and the authoritative row says so (${JSON.stringify(storeAccount.data)})`);

  const signInDisabled = await request('POST', '/api/admin/login', { username: victim.username, password: victimPassword });
  const enable = await request('POST', `/api/admin/accounts/${victim.accountId}/status`, { isActive: true }, bearer(superToken));
  const signInEnabled = await request('POST', '/api/admin/login', { username: victim.username, password: victimPassword });
  check('DIS-06', signInDisabled.status === 401 && enable.status === 200 && signInEnabled.status === 200,
    `a disabled account cannot sign in (${signInDisabled.status}), and re-enabling it restores access without a restart (${enable.status}/${signInEnabled.status})`);
  const reEnabledToken = signInEnabled.data.token;
  await request('POST', '/api/admin/security/sessions/revoke', { adminId: victim.accountId }, bearer(superToken));
  const reEnabledDead = await request('GET', '/api/admin/me', null, bearer(reEnabledToken));
  check('DIS-07', reEnabledDead.status === 401,
    `and the session the re-enabled sign-in just issued can be revoked like any other (${reEnabledDead.status})`);

  // --- RX: a session this process never issued --------------------------
  // The durable session store is authoritative across instances, so a row written
  // elsewhere must be honoured here within one reconcile, and revocable from here too.
  const ops = provisioned.find(p => p.role === 'OPERATIONS');
  const foreignBearer = `nabin_operations_tok_${crypto.randomBytes(18).toString('base64url')}`;
  const foreignHandle = crypto.createHash('sha256').update(foreignBearer).digest('hex');
  const inserted = await supabaseAdmin.from('backend_sessions').insert({
    token_hash: foreignHandle,
    role: 'OPERATIONS',
    entity_id: String(ops.accountId),
    entity: {
      id: ops.accountId, username: ops.username, name: 'Foreign Instance Session',
      role: 'OPERATIONS', permissions: [...ROLE_GRANTS.OPERATIONS]
    },
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  let honoured = null;
  for (let i = 0; i < 40 && !honoured; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const probe = await request('GET', '/api/admin/me', null, bearer(foreignBearer));
    if (probe.status === 200) honoured = probe;
  }
  check('RX-01', !inserted.error && !!honoured,
    `a session written by another instance is honoured within the 15-second reconcile window (${honoured ? 'after a poll' : 'never'})`);
  check('RX-02', !!honoured && honoured.data.admin.role === 'OPERATIONS',
    `and it is honoured as the role it carries, not refused at the door — authenticateAdmin used to accept only ADMIN and SUPER_ADMIN here, so an OPERATIONS or KYC token that reached this branch was a live session the door could not read`);
  const foreignGated = await request('GET', '/api/admin/support', null, bearer(foreignBearer));
  const foreignDenied = await request('GET', '/api/admin/audit-logs?limit=1', null, bearer(foreignBearer));
  check('RX-03', foreignGated.status === 200 && foreignDenied.status === 403,
    `with its grants intact: support queue ${foreignGated.status}, audit trail ${foreignDenied.status}`);
  const revokeForeign = await request('POST', '/api/admin/security/sessions/revoke', { sessionId: foreignHandle }, bearer(superToken));
  await new Promise(r => setTimeout(r, 1200));
  const foreignAfter = await request('GET', '/api/admin/me', null, bearer(foreignBearer));
  check('RX-04', revokeForeign.status === 200 && foreignAfter.status === 401,
    `and one instance can revoke a session it never issued (${revokeForeign.status}/${foreignAfter.status}) — the reason revoke goes to the store before it touches memory`);

  // A customer session is not the admin endpoint's to cut.
  const customerLogin = await request('POST', '/api/auth/verify-otp', { phone: '9876543210', otp: '7729', role: 'CUSTOMER' });
  const customerToken = customerLogin.data.token;
  const customerHandle = crypto.createHash('sha256').update(String(customerToken || '')).digest('hex');
  const revokeCustomer = await request('POST', '/api/admin/security/sessions/revoke', { sessionId: customerHandle }, bearer(superToken));
  check('RX-05', !!(customerToken && customerLogin.status === 200) && revokeCustomer.status === 403
    && revokeCustomer.data.code === 'SESSION_NOT_ADMIN',
    `an administrator revoke button cannot sign a customer out: ${revokeCustomer.status} ${revokeCustomer.data.code} — the role is checked in memory and again in the store`);

  // --- GRD: the guards that must never be proven by firing them ---------
  // The last enabled SUPER_ADMIN is the platform's own account. Probing that over HTTP
  // would lock the backend out if the guard were broken, so the guard is exercised
  // against a stubbed store instead: the same method, no reachable database, and an
  // assertion that it wrote nothing at all.
  console.log('\n--- in-process guards, against a stubbed store ---');
  const db = require('./src/database');
  const realLiveStore = db.liveStore;
  const realRead = db.authoritativeRead;
  const realWrite = db.authoritativeWrite;
  const writes = [];
  const chainable = () => {
    const b = {};
    for (const m of ['from', 'select', 'update', 'eq', 'in', 'limit', 'delete', 'upsert', 'order']) b[m] = () => b;
    return b;
  };
  let rowsForGuard = [];
  db.liveStore = () => ({ from: () => chainable() });
  db.authoritativeRead = async () => rowsForGuard;
  db.authoritativeWrite = async (builder, opts) => {
    writes.push((opts && opts.what) || 'write');
    return [{ id: 'stub', username: 'stub', role: 'SUPER_ADMIN', is_active: true }];
  };
  const acceptStore = (() => {
    const real = db.auditLogRepo;
    db.auditLogRepo = { create: async (entry) => ({ id: 'AUTHZ-HARNESS', action: entry.action }) };
    return () => { db.auditLogRepo = real; };
  })();

  try {
    rowsForGuard = [
      { id: 'only-super', username: SUPER.username, role: 'SUPER_ADMIN', is_active: true },
      { id: 'ops-1', username: 'ops-1', role: 'OPERATIONS', is_active: true }
    ];
    const blocked = await db.setAdminAccountStatus({ identifier: 'only-super', isActive: false, actor: { id: 'only-super', role: 'SUPER_ADMIN' } })
      .then(() => null).catch(e => e);
    check('GRD-01', !!blocked && blocked.code === 'LAST_SUPER_ADMIN_CANNOT_BE_DISABLED' && blocked.status === 409,
      `the only enabled SUPER_ADMIN cannot be disabled (${blocked && blocked.code}) — and the platform's own account was never exposed to this, because it is proven against a stub`);
    check('GRD-02', writes.length === 0,
      `and the refusal happened before any write was attempted (${writes.length} write(s): ${writes.join(', ') || 'none'})`);

    rowsForGuard = [
      { id: 'super-a', username: 'super-a', role: 'SUPER_ADMIN', is_active: true },
      { id: 'super-b', username: 'super-b', role: 'SUPER_ADMIN', is_active: true }
    ];
    const notEnrolled = await db.setAdminAccountStatus({ identifier: 'nobody-here', isActive: false, actor: { id: 'super-a', role: 'SUPER_ADMIN' } })
      .then(() => null).catch(e => e);
    check('GRD-03', !!notEnrolled && notEnrolled.code === 'ADMIN_NOT_ENROLLED' && notEnrolled.status === 409,
      `an identifier the authoritative directory does not hold is refused, not applied to the in-memory copy (${notEnrolled && notEnrolled.code})`);

    rowsForGuard = [
      { id: 'dup-1', username: 'dup', role: 'OPERATIONS', is_active: true },
      { id: 'dup-2', username: 'dup', role: 'OPERATIONS', is_active: true }
    ];
    const ambiguous = await db.setAdminAccountStatus({ identifier: 'dup', isActive: false, actor: { id: 'super-a', role: 'SUPER_ADMIN' } })
      .then(() => null).catch(e => e);
    check('GRD-04', !!ambiguous && ambiguous.code === 'ADMIN_ACCOUNT_AMBIGUOUS' && ambiguous.status === 409,
      `two accounts on one identifier are a refusal rather than a coin flip on privileges (${ambiguous && ambiguous.code})`);

    const incomplete = await db.setAdminAccountStatus({ identifier: 'dup' })
      .then(() => null).catch(e => e);
    check('GRD-05', !!incomplete && incomplete.code === 'ADMIN_STATUS_REQUEST_INCOMPLETE' && incomplete.status === 400,
      `a request with no explicit active state is refused before the ambiguity question is even asked (${incomplete && incomplete.code})`);

    // A disable that lands but cannot be audited must not answer 200.
    rowsForGuard = [
      { id: 'super-a', username: 'super-a', role: 'SUPER_ADMIN', is_active: true },
      { id: 'super-b', username: 'super-b', role: 'OPERATIONS', is_active: true }
    ];
    const targetCopy = db.adminUsers.find(a => a.username === 'authz_matrix_target');
    if (!targetCopy) db.adminUsers.push({ id: 'stub-target', username: 'authz_matrix_target', name: 'Stub', role: 'OPERATIONS', status: 'ACTIVE' });
    rowsForGuard = [
      { id: 'super-a', username: 'super-a', role: 'SUPER_ADMIN', is_active: true },
      { id: 'stub-target', username: 'authz_matrix_target', role: 'OPERATIONS', is_active: true }
    ];
    db.auditLogRepo = { create: () => Promise.reject(new Error('simulated audit store refusal')) };
    const refusedTrail = await db.setAdminAccountStatus({ identifier: 'stub-target', isActive: false, actor: { id: 'super-a', role: 'SUPER_ADMIN' } })
      .then(() => null).catch(e => e);
    check('GRD-06', !!refusedTrail && refusedTrail.code === 'AUDIT_RECORD_UNAVAILABLE'
      && refusedTrail.status === 503 && refusedTrail.applied === true,
      `a disable whose audit record cannot be written is a 503 with applied=true, not a 200 (${refusedTrail && refusedTrail.code}/${refusedTrail && refusedTrail.status}/applied=${refusedTrail && refusedTrail.applied})`);
    const copyNow = db.adminUsers.find(a => a.username === 'authz_matrix_target');
    check('GRD-07', !!copyNow && copyNow.status === 'INACTIVE',
      `and the message never claims the account is still enabled — the state did change, and reconciling a missing record is not the same as undoing it (${copyNow && copyNow.status})`);

    // Sessions honour two lookup paths, and only the handle joins them: the admin map
    // keeps the bearer, the durable store keeps its hash.
    const probeBearer = `adm_token_probe_${crypto.randomBytes(12).toString('base64url')}`;
    const probeHandle = crypto.createHash('sha256').update(probeBearer).digest('hex');
    db.activeSessions.set(probeHandle, {
      token: probeHandle, role: 'OPERATIONS', entityId: 'stub-target',
      entity: { id: 'stub-target', username: 'authz_matrix_target', name: 'Stub', role: 'OPERATIONS' },
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()
    });
    const listed = db.listAdminSessions().filter(s => s.adminId === 'stub-target');
    check('GRD-08', listed.length === 1 && listed[0].sessionId === probeHandle,
      `the list reports a locally-issued session by the same handle the store uses (${listed.length} row(s))`);
    const nonAdminHandle = crypto.createHash('sha256').update('usr_session_customer_probe').digest('hex');
    db.activeSessions.set(nonAdminHandle, {
      token: nonAdminHandle, role: 'CUSTOMER', entityId: 'CUS-1', entity: { id: 'CUS-1' },
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600000).toISOString()
    });
    const refusedCustomer = await db.revokeAdminSession(nonAdminHandle).then(() => null).catch(e => e);
    check('GRD-09', !!refusedCustomer && refusedCustomer.code === 'SESSION_NOT_ADMIN' && refusedCustomer.status === 403
      && db.activeSessions.has(nonAdminHandle),
      `the role check runs before the delete, so a customer session survives an admin revoke attempt (${refusedCustomer && refusedCustomer.code}, still present=${db.activeSessions.has(nonAdminHandle)})`);
    db.activeSessions.delete(nonAdminHandle);
    const listed2 = db.listAdminSessions();
    check('GRD-10', listed2.every(s => db.isAdminSessionRole(s.role)) && !listed2.some(s => s.adminId === 'CUS-1'),
      `and the list itself never carries a non-administrator session (${listed2.length} rows, all administrator roles)`);
    acceptStore();
  } finally {
    db.liveStore = realLiveStore;
    db.authoritativeRead = realRead;
    db.authoritativeWrite = realWrite;
    const idx = db.adminUsers.findIndex(a => a.username === 'authz_matrix_target');
    if (idx !== -1) db.adminUsers.splice(idx, 1);
    db.activeSessions.delete(crypto.createHash('sha256').update('usr_session_customer_probe').digest('hex'));
  }

  // --- CLN: leave nothing signed in ------------------------------------
  // Swept by username prefix, not by what this run provisioned: a run that crashes
  // half-way leaves its accounts enabled behind, and the promise of this section is
  // that the harness never leaves privilege in the database at all.
  const allAccounts = await request('GET', '/api/admin/accounts', null, bearer(superToken));
  const matrixAccounts = (allAccounts.data.accounts || []).filter(a => String(a.username).startsWith('authz_'));
  const cleanupRefusals = [];
  for (const a of matrixAccounts) {
    await request('POST', '/api/admin/security/sessions/revoke', { adminId: a.id }, bearer(superToken));
    const off = await request('POST', `/api/admin/accounts/${a.id}/status`, { isActive: false }, bearer(superToken));
    if (off.status !== 200) {
      cleanupRefusals.push(`${a.username} → ${off.status} ${off.data.code || ''}`);
    }
  }
  const accounts = await request('GET', '/api/admin/accounts', null, bearer(superToken));
  const stillActive = (accounts.data.accounts || []).filter(a => String(a.username).startsWith('authz_') && a.status !== 'INACTIVE');
  check('CLN-01', stillActive.length === 0 && cleanupRefusals.length === 0,
    `every matrix account found in the directory is disabled again (${matrixAccounts.length} swept, refusals: ${cleanupRefusals.join('; ') || 'none'}, still enabled: ${stillActive.map(a => a.username).join(', ') || 'none'}) — the harness provisions throwaway privilege and takes it back`);
  const superStillWorks = await request('GET', '/api/admin/me', null, bearer(superToken));
  check('CLN-02', superStillWorks.status === 200,
    `and the platform's own SUPER_ADMIN session was never revoked by any of this (${superStillWorks.status})`);

  const failed = results.filter(r => !r.ok);
  console.log('\n=======================================================================');
  console.log(`📊 AUTHORISATION MATRIX: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  for (const f of failed) console.log(`   FAILED ${f.id}: ${f.detail}`);
  console.log('=======================================================================');
  if (spawned) spawned.kill();
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('\n❌ Harness failed outright:', err.stack || err.message);
  process.exit(1);
});
