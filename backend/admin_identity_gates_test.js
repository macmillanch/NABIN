// =========================================================================
// THE KYC GATES AND THE FLEET STATUS BUTTON — DO THEY SAY WHAT THEY DO
// (Phase D, areas 5 and 6 — local only)
//
// Area 5 is the driver fleet queue and area 6 is the identity/KYC queue. Both were
// measured against the specification's §4 matrix before this file was written, and both
// had the same shape of fault: a control whose answer is not the thing it claims.
//
//   1. **The document preview had no gate at all.** `GET /docs/:filename` answered any
//      caller, authenticated or not, and the seed identity rows hand out that path as an
//      applicant's `aadhaarDocUrl`. What it serves is a hard-coded mock, so no real
//      document ever came out of it — but the path is what the examiner's queue links to,
//      and a preview route that admits anyone is a route that will serve real documents
//      the day somebody points it at storage.
//   2. **The queue listed what the file withholds.** `identity_documents.view` is a real
//      grant in the catalogue and the detail route has always honoured it, but the *list*
//      route returned the repository's rows untouched, so OPERATIONS — which holds
//      `identity_verification.view` and not the document name — received every applicant's
//      full Aadhaar and Voter ID numbers in one call.
//   3. **Three powers sat behind one gate.** `/identity-verifications/:id/review` accepted
//      APPROVE, REJECT and REQUEST_RESUBMISSION from anyone holding
//      `identity_verification.review`, and answered the three finer names by hand inside
//      the handler, in a spelling no other route used.
//   4. **The fleet button normalised silently.** `updateDriverStatus` mapped 'ACTIVE' to
//      'AVAILABLE', then wrote the audit record with `previousState` read *after* the
//      mutation and `newState` set to whatever the caller sent — so the trail of an
//      activation says the driver went from AVAILABLE to 'ACTIVE', a value the column's
//      CHECK cannot hold. A status outside that CHECK reached the store and came back as
//      PostgREST's own wording in a 400 body.
//
// What this file proves, in order: the preview gate by role; that the unmasked identity
// references are the same answer in both routes; the decision gate refusing each of its
// three powers (its denial side is unreachable over HTTP, because no role in the catalogue
// holds the route's permission without all three decisions — that is asserted here too, so
// the claim and the grants cannot drift); and that a driver status change stores what it
// says, says what it stores, and refuses without writing either.
//
// LOCAL ONLY. It provisions four throwaway administrator accounts and one throwaway driver
// row, and takes both back at the end. The audit records the run generates are kept: a
// trail you delete when it is inconvenient is not a trail. Nothing here is pushed,
// deployed, or pointed at a hosted project.
// =========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
const {
  ROLE_GRANTS,
  adminHoldsPermission,
  requireIdentityDecision
} = require('./src/adminPermissions');

const BASE_URL = 'http://127.0.0.1:4000';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };
const PROBE_PREFIX = 'idg_';

// The five values `drivers.operational_status` accepts (migration 001:60) and the six
// `drivers.kyc_status` accepts (migration 016:12). Spelled out here rather than imported
// on purpose: if a migration widens a CHECK and the code does not follow, this file should
// say so rather than agree with whatever the code now believes.
const OPERATIONAL_STATUSES = ['AVAILABLE', 'BUSY', 'ON_TRIP', 'ON_DELIVERY', 'SUSPENDED'];
const KYC_STATUSES = ['PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED'];

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

async function serverIsUp() {
  try {
    return (await request('GET', '/api/health')).status === 200;
  } catch (e) {
    return false;
  }
}

async function ensureServerRunning() {
  if (await serverIsUp()) return { up: true };
  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true
  });
  proc.unref();
  for (let i = 0; i < 60; i++) {
    if (await serverIsUp()) return { up: true };
    await new Promise(r => setTimeout(r, 500));
  }
  return { up: false };
}

// A stand-in `res` for the direct middleware calls in section 3. These gates answer in
// exactly one shape, so the object that catches the answer is part of what is asserted.
function captureResult() {
  const captured = { status: 0, body: null, passedThrough: false };
  captured.res = {
    status(code) { captured.status = code; return captured.res; },
    json(payload) { captured.body = payload; return captured.res; }
  };
  captured.done = () => { captured.passedThrough = true; };
  return captured;
}

function runMiddleware(fn, req) {
  const captured = captureResult();
  fn(req, captured.res, captured.done);
  return captured;
}

const serverSource = fs.readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
const routeLineOf = (signature) => (serverSource.split('\n').find(line => line.startsWith(signature)) || '');
const handlerOf = (signature) => {
  const start = serverSource.indexOf(signature);
  const end = start < 0 ? -1 : serverSource.indexOf('\n});', start);
  return start < 0 || end < 0 ? '' : serverSource.slice(start, end);
};
// Two of the checks below ask whether a spelling is gone from a handler. Its own comment
// may still name the spelling it replaced — that is the point of a comment — so the text
// those checks read has the narration removed and the code left.
const codeOnly = (text) => text.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

async function teardown(fixtureUuid, createdAdmins, superToken, sweptBefore) {
  const notes = [];
  if (fixtureUuid) {
    const removed = await supabaseAdmin.from('drivers').delete().eq('id', fixtureUuid).select('id');
    notes.push(removed.error
      ? `the fixture driver row could not be removed (${removed.error.message})`
      : `the fixture driver row was deleted (${(removed.data || []).length})`);
  }
  for (const a of createdAdmins) {
    if (!a.accountId) continue;
    await request('POST', `/api/admin/accounts/${a.accountId}/status`,
      { isActive: false, reason: 'Phase D identity gates harness teardown' }, bearer(superToken));
  }
  const all = await request('GET', '/api/admin/accounts', null, bearer(superToken));
  const standing = (all.data.accounts || []).filter(a => String(a.username || '').startsWith(PROBE_PREFIX) && String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE');
  notes.push(`${createdAdmins.length} probe account(s) disabled, ${sweptBefore} from an earlier run swept, ${standing.length} still enabled`);
  return notes.join('; ');
}

async function main() {
  console.log('=======================================================================');
  console.log('🪪 NABIN KYC QUEUE & FLEET STATUS — PHASE D AREAS 5 AND 6');
  console.log('=======================================================================\n');

  const { up } = await ensureServerRunning();
  check('IG-PRE-01', up, `a local backend answers on ${BASE_URL} ${up ? '' : '— nothing is listening, so nothing below means anything'}`);
  if (!up) process.exit(1);

  check('IG-PRE-02', isLivePostgres && !!supabaseAdmin,
    'the run is against the live PostgreSQL store, which is where a driver row and its audit record have to agree');
  if (!isLivePostgres || !supabaseAdmin) {
    console.error('\n❌ Aborting: the fleet half of this file compares an API answer with a live row.\n');
    process.exit(1);
  }

  const superLogin = await request('POST', '/api/admin/login', SUPER);
  check('IG-PRE-03', superLogin.status === 200 && !!superLogin.data.token,
    `the platform SUPER_ADMIN signs in for the probe tokens (${superLogin.status})`);
  if (superLogin.status !== 200) process.exit(1);
  const superToken = superLogin.data.token;
  const tokens = { SUPER_ADMIN: superToken };

  // An aborted run must not leave four more enabled credentials standing.
  const isEnabled = (a) => String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
  const sweepProbes = async (why) => {
    const all = await request('GET', '/api/admin/accounts', null, bearer(superToken));
    const orphans = (all.data.accounts || []).filter(a => String(a.username || '').startsWith(PROBE_PREFIX) && isEnabled(a));
    for (const a of orphans) {
      await request('POST', `/api/admin/accounts/${a.id}/status`, { isActive: false, reason: why }, bearer(superToken));
    }
    return orphans.length;
  };
  const sweptBefore = await sweepProbes('Phase D identity gates harness: sweeping an aborted run');

  const suffix = crypto.randomBytes(4).toString('hex');
  const createdAdmins = [];
  for (const role of ['KYC_SPECIALIST', 'OPERATIONS', 'SUPPORT_AGENT', 'FINANCE_AUDITOR']) {
    const username = `${PROBE_PREFIX}${role.toLowerCase().slice(0, 4)}${suffix}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const created = await request('POST', '/api/admin/accounts', {
      username, name: `Identity Gates ${role}`, email: `${username}@nabin.in`, role, password
    }, bearer(superToken));
    const account = created.data && created.data.account;
    createdAdmins.push({ role, username, accountId: account && account.id });
    const login = created.status === 200
      ? await request('POST', '/api/admin/login', { username, password })
      : { status: created.status };
    if (login.status === 200 && login.data.token) tokens[role] = login.data.token;
    check(`IG-PRE-04.${role}`, login.status === 200 && !!login.data.token,
      `a ${role} account exists to probe the gates with (provision=${created.status} login=${login.status})`);
  }
  const needed = ['KYC_SPECIALIST', 'OPERATIONS', 'SUPPORT_AGENT', 'FINANCE_AUDITOR'];
  if (needed.some(role => !tokens[role])) {
    console.error('\n❌ Aborting: the role-by-role assertions need all four tokens.\n');
    process.exit(1);
  }

  // The driver the fleet half owns end to end: its own row, its own uuid, deleted at the
  // end. It is created straight in PostgreSQL rather than through a route so that nothing
  // this file tests depends on a write path it is not testing.
  const fixturePhone = `98${String(Date.now()).slice(-8)}`;
  const inserted = await supabaseAdmin.from('drivers').insert({
    phone: fixturePhone,
    name: 'Phase D Fleet Gate Fixture',
    vehicle_type: '3W',
    vehicle_number: 'DL01IDGATE',
    license_number: 'DL-IDGATE-0001',
    is_online: false,
    operational_status: 'AVAILABLE',
    kyc_status: 'PENDING'
  }).select('id, phone, operational_status, is_online, kyc_status').single();
  const fixtureUuid = inserted.data && inserted.data.id;
  check('IG-PRE-05', !inserted.error && !!fixtureUuid,
    `one throwaway driver row was created for this run (${inserted.error ? inserted.error.message : fixtureUuid})`);
  if (!fixtureUuid) {
    console.log(`\n🧹 ${await teardown(null, createdAdmins, superToken, sweptBefore)}\n`);
    process.exit(1);
  }

  const statusRoute = (id) => `/api/admin/drivers/${id}/status`;
  const liveRow = async () => {
    const { data } = await supabaseAdmin.from('drivers')
      .select('operational_status, is_online, kyc_status').eq('id', fixtureUuid).maybeSingle();
    return data || {};
  };
  const auditRows = async () => {
    const res = await request('GET',
      `/api/admin/audit-logs?targetEntityType=DRIVER&targetEntityId=${fixtureUuid}&limit=100`,
      null, bearer(superToken));
    return res.data.logs || [];
  };

  // A status the column rejects used to reach the store, so only the running process can
  // show that the refusal now happens before the write.
  const emptyCall = await request('POST', statusRoute(fixtureUuid), {}, bearer(superToken));
  check('IG-PRE-06', emptyCall.status === 400 && emptyCall.data.code === 'NO_DRIVER_STATUS_CHANGE',
    `the running backend carries this code's fleet handler (${emptyCall.status} ${emptyCall.data.code || emptyCall.data.error || ''}) — anything else means restart it`);
  check('IG-PRE-07', (await liveRow()).operational_status === 'AVAILABLE',
    'and the empty call left the row exactly as it was created');

  // -------------------------------------------------------------------
  // 1. Area 6, part one: the document preview is an authorised read now
  // -------------------------------------------------------------------
  const docPath = '/docs/preview_aadhaar.png';
  const docAnon = await request('GET', docPath);
  check('DOC-01', docAnon.status === 401,
    `an anonymous caller no longer gets a document preview (${docAnon.status})`);

  const docSupport = await request('GET', docPath, null, bearer(tokens.SUPPORT_AGENT));
  check('DOC-02', docSupport.status === 403 && /identity_documents\.view/.test(docSupport.raw),
    `SUPPORT_AGENT is refused by name rather than answered quietly (${docSupport.status} ${docSupport.data.error || ''})`);

  const docOps = await request('GET', docPath, null, bearer(tokens.OPERATIONS));
  check('DOC-03', docOps.status === 403 && /identity_documents\.view/.test(docOps.raw),
    `OPERATIONS reads the KYC queue and still cannot open the document that queue links to (${docOps.status})`);

  const docKyc = await request('GET', docPath, null, bearer(tokens.KYC_SPECIALIST));
  check('DOC-04', docKyc.status === 200 && /<svg/.test(docKyc.raw),
    `KYC_SPECIALIST holds identity_documents.view and is answered (${docKyc.status}, ${docKyc.raw.length} bytes of the hard-coded mock)`);

  const docSuper = await request('GET', docPath, null, bearer(superToken));
  check('DOC-05', docSuper.status === 200,
    `and so is SUPER_ADMIN, whose wildcard is why a super-only probe proves reachability and nothing about the grant (${docSuper.status})`);

  const docRouteLine = routeLineOf("app.get('/docs/:filename'");
  check('DOC-06', docRouteLine.includes('authenticateAdmin') && docRouteLine.includes("requirePermission('identity_documents.view')"),
    `the gate sits in the route chain rather than inside the handler: ${docRouteLine.slice(0, 92)}…`);

  // -------------------------------------------------------------------
  // 2. Area 6, part two: the unmasked identity numbers give one answer
  // -------------------------------------------------------------------
  const queueAsKyc = await request('GET', '/api/admin/identity-verifications?limit=50', null, bearer(tokens.KYC_SPECIALIST));
  const kycApps = queueAsKyc.data.applications || [];
  const sample = kycApps.find(a => a.aadhaarNumberRaw && a.aadhaarNumberMasked && a.voterIdNumberRaw);
  check('MASK-01', queueAsKyc.status === 200 && !!sample,
    `the queue answers a document holder with ${kycApps.length} application(s), one of which carries the unmasked numbers to compare against (${sample ? sample.id : 'none'})`);
  if (!sample) {
    console.log(`\n🧹 ${await teardown(fixtureUuid, createdAdmins, superToken, sweptBefore)}\n`);
    process.exit(1);
  }

  const queueAsOps = await request('GET', '/api/admin/identity-verifications?limit=50', null, bearer(tokens.OPERATIONS));
  check('MASK-02', queueAsOps.status === 200,
    `OPERATIONS may read the queue at all — it holds identity_verification.view (${queueAsOps.status})`);
  check('MASK-03', !queueAsOps.raw.includes(sample.aadhaarNumberRaw) && !queueAsOps.raw.includes(sample.voterIdNumberRaw),
    `and the queue no longer hands that role every applicant's Aadhaar and Voter ID numbers: '${sample.aadhaarNumberRaw}' appears ${queueAsOps.raw.includes(sample.aadhaarNumberRaw) ? '' : 'not '}in the body`);
  check('MASK-04', queueAsOps.raw.includes(sample.aadhaarNumberMasked) && queueAsOps.raw.includes(sample.voterIdNumberMasked),
    `while the masked forms it does need to work with are still there (${sample.aadhaarNumberMasked}, ${sample.voterIdNumberMasked})`);
  check('MASK-05', (queueAsOps.data.applications || []).every(a => !('aadhaarNumberRaw' in a) && !('voterIdNumberRaw' in a)),
    `the withheld keys are absent rather than blanked, so a client cannot read "empty" as "this applicant has no number" (${(queueAsOps.data.applications || []).length} row(s))`);
  check('MASK-06', kycApps.some(a => 'aadhaarNumberRaw' in a),
    'the same two routes differ only by the grant: the document holder still sees the field');

  const detailAsOps = await request('GET', `/api/admin/identity-verifications/${sample.id}`, null, bearer(tokens.OPERATIONS));
  check('MASK-07', detailAsOps.status === 200 &&
    !('aadhaarNumberRaw' in (detailAsOps.data.application || {})) &&
    !('voterIdNumberRaw' in (detailAsOps.data.application || {})),
    `the file view withholds them from that role too (${detailAsOps.status}, keys: ${Object.keys(detailAsOps.data.application || {}).length})`);

  const detailAsKyc = await request('GET', `/api/admin/identity-verifications/${sample.id}`, null, bearer(tokens.KYC_SPECIALIST));
  check('MASK-08', detailAsKyc.status === 200 &&
    (detailAsKyc.data.application || {}).aadhaarNumberRaw === sample.aadhaarNumberRaw,
    `and gives them back to the role the catalogue names for it (${detailAsKyc.status})`);

  const detailAsSupport = await request('GET', `/api/admin/identity-verifications/${sample.id}`, null, bearer(tokens.SUPPORT_AGENT));
  check('MASK-09', detailAsSupport.status === 403 && /identity_verification\.view/.test(detailAsSupport.raw),
    `SUPPORT_AGENT, which holds neither name, is stopped at the route (${detailAsSupport.status})`);

  const queueAsAuditor = await request('GET', '/api/admin/identity-verifications', null, bearer(tokens.FINANCE_AUDITOR));
  check('MASK-10', queueAsAuditor.status === 403 && /identity_verification\.view/.test(queueAsAuditor.raw),
    `and so is FINANCE_AUDITOR, whose grants are all in the money domain (${queueAsAuditor.status})`);

  check('MASK-11', !/password_hash|passwordHash|password_salt|"salt"|license_number["']?\s*:\s*"[^"]+"/.test(queueAsOps.raw + detailAsOps.raw),
    'neither answer carries credential material or a licence number for a role that was not given one');

  const queueBlock = handlerOf("app.get('/api/admin/identity-verifications'");
  const detailBlock = handlerOf("app.get('/api/admin/identity-verifications/:id'");
  check('MASK-12', queueBlock.includes("adminHoldsPermission(req.admin, 'identity_documents.view')") &&
    detailBlock.includes("adminHoldsPermission(req.admin, 'identity_documents.view')") &&
    !codeOnly(queueBlock).includes('permissions.includes') && !codeOnly(detailBlock).includes('permissions.includes'),
    'both routes ask the same predicate for the same field pair, and neither re-spells the question in code, so the list cannot out-live the file view again');

  // -------------------------------------------------------------------
  // 3. Area 6, part three: the decision gate, called directly
  //
  // Its refusal side is unreachable over HTTP: the route's own permission is
  // `identity_verification.review`, and no role that holds that name lacks a decision, so
  // the pair (role, refused decision) does not exist in the catalogue. KG-17 asserts that
  // fact about the grants rather than assuming it, because if a later §4 change gives
  // `review` to a role without the decisions, the gate becomes HTTP-provable and this
  // arrangement should be revisited.
  // -------------------------------------------------------------------
  const REVIEW_ONLY = { id: 'probe', name: 'Probe', role: 'KYC_SPECIALIST', permissions: ['identity_verification.review'] };
  const DECISIONS = {
    APPROVE: 'identity_verification.approve',
    REJECT: 'identity_verification.reject',
    REQUEST_RESUBMISSION: 'identity_verification.request_resubmission'
  };

  const decisionNames = Object.keys(DECISIONS);
  decisionNames.forEach((decision, index) => {
    const perm = DECISIONS[decision];
    const refused = runMiddleware(requireIdentityDecision, { admin: REVIEW_ONLY, body: { decision }, id: `req-${decision}` });
    check(`KG-${10 + index}`, refused.status === 403 && !refused.passedThrough &&
      refused.body.error === `Access Denied: Missing required permission [${perm}]. Current role: KYC_SPECIALIST`,
      `a reviewer without '${perm}' is refused the ${decision} decision before the handler, in requirePermission's own wording (${refused.status} ${refused.body && refused.body.error})`);
  });

  const unknown = runMiddleware(requireIdentityDecision, { admin: REVIEW_ONLY, body: { decision: 'NOT_A_DECISION' }, id: 'req-unknown' });
  check('KG-13', unknown.passedThrough === true && unknown.status === 0,
    'an unrecognised decision falls through to the method, which refuses it as a 400 — the gate is an authorisation check, not a validator');

  const noAdmin = runMiddleware(requireIdentityDecision, { body: { decision: 'APPROVE' }, id: 'req-noadmin' });
  check('KG-14', noAdmin.status === 401 && noAdmin.body.error === 'Authentication required',
    `and with no resolved administrator it answers 401 rather than throwing on a missing role (${noAdmin.status})`);

  const superPass = Object.keys(DECISIONS)
    .every(decision => runMiddleware(requireIdentityDecision, {
      admin: { id: 'probe', role: 'SUPER_ADMIN', permissions: ROLE_GRANTS.SUPER_ADMIN },
      body: { decision }, id: `req-super-${decision}`
    }).passedThrough);
  check('KG-15', superPass,
    'SUPER_ADMIN passes all three by the same wildcard the rest of the control plane uses');

  const holderPass = Object.keys(DECISIONS)
    .every(decision => runMiddleware(requireIdentityDecision, {
      admin: { id: 'probe', role: 'KYC_SPECIALIST', permissions: ROLE_GRANTS.KYC_SPECIALIST },
      body: { decision }, id: `req-kyc-${decision}`
    }).passedThrough);
  check('KG-16', holderPass,
    'and the one non-super role §4 gives the queue to holds every decision, so the route answers it normally');

  const reviewWithoutDecision = Object.keys(ROLE_GRANTS).filter(role => {
    const grants = ROLE_GRANTS[role] || [];
    const reviewer = { role, permissions: grants };
    return adminHoldsPermission(reviewer, 'identity_verification.review') &&
      Object.values(DECISIONS).some(perm => !adminHoldsPermission(reviewer, perm));
  });
  check('KG-17', reviewWithoutDecision.length === 0,
    `no role in adminPermissions.js holds identity_verification.review without all three decisions (${reviewWithoutDecision.join(', ') || 'none'}), which is why the refusals above are called directly and not over HTTP`);

  const reviewRouteLine = routeLineOf("app.post('/api/admin/identity-verifications/:id/review'");
  const reviewBlock = handlerOf("app.post('/api/admin/identity-verifications/:id/review'");
  check('KG-18', reviewRouteLine.includes('requirePermission(\'identity_verification.review\')') &&
    reviewRouteLine.indexOf('requireIdentityDecision') > reviewRouteLine.indexOf('requirePermission('),
    `the gate is chained after the route permission and before the handler: ${reviewRouteLine.slice(0, 118)}…`);
  check('KG-19', !codeOnly(reviewBlock).includes('permissions.includes') && !codeOnly(reviewBlock).includes('Missing required permission'),
    `and the handler no longer answers the three names by hand — the inline spelling is gone, not merely duplicated (${
      codeOnly(reviewBlock).includes('permissions.includes') ? 'still present' : 'absent'})`);

  // -------------------------------------------------------------------
  // 4. Area 5: the fleet status control says what it does
  // -------------------------------------------------------------------
  const opsDeny = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'SUSPENDED' }, bearer(tokens.SUPPORT_AGENT));
  check('DS-01', opsDeny.status === 403 && /fleet\.manage/.test(opsDeny.raw),
    `SUPPORT_AGENT cannot change a driver's status at all (${opsDeny.status})`);

  const kycDeny = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'SUSPENDED' }, bearer(tokens.KYC_SPECIALIST));
  check('DS-02', kycDeny.status === 403 && /fleet\.manage/.test(kycDeny.raw),
    `neither can the examiner who does hold the identity document grants — the two domains stay separate (${kycDeny.status})`);

  const badStatus = await request('POST', statusRoute(fixtureUuid), { status: 'OFFLINE' }, bearer(tokens.OPERATIONS));
  const rowAfterBad = await liveRow();
  check('DS-03', badStatus.status === 400 && badStatus.data.code === 'INVALID_DRIVER_OPERATIONAL_STATUS' &&
    badStatus.data.error.includes("'OFFLINE'"),
    `a status outside the column's CHECK is now refused on the merits, in our own words rather than PostgREST's (${badStatus.status} ${badStatus.data.code || ''} ${badStatus.data.error || ''})`);
  check('DS-04', JSON.stringify(badStatus.data.allowedValues) === JSON.stringify(OPERATIONAL_STATUSES) &&
    rowAfterBad.operational_status === 'AVAILABLE',
    `the refusal names the five values the store accepts (${(badStatus.data.allowedValues || []).join(', ')}) and the row stayed '${rowAfterBad.operational_status}'`);
  check('DS-05', (await auditRows()).length === 0,
    'and a refused status change writes no audit record, so the trail only lists things that happened');

  const badKyc = await request('POST', statusRoute(fixtureUuid), { kycStatus: 'APPROVED_MAYBE' }, bearer(tokens.OPERATIONS));
  check('DS-06', badKyc.status === 400 && badKyc.data.code === 'INVALID_DRIVER_KYC_STATUS' &&
    JSON.stringify(badKyc.data.allowedValues) === JSON.stringify(KYC_STATUSES),
    `the same applies to the KYC column (${badKyc.status}, ${badKyc.data.error || ''})`);

  // The lie the button told: 'ACTIVE' is not a status the row can hold.
  const activate = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'ACTIVE' }, bearer(tokens.OPERATIONS));
  const activateChange = (activate.data.change || {}).operationalStatus || {};
  const rowAfterActivate = await liveRow();
  check('DS-07', activate.status === 200 && activateChange.requested === 'ACTIVE' &&
    activateChange.applied === 'AVAILABLE' && activateChange.normalised === true,
    `an activation still works and now says what it mapped (${activate.status}: requested '${activateChange.requested}' → applied '${activateChange.applied}', normalised ${activateChange.normalised})`);
  check('DS-08', rowAfterActivate.operational_status === 'AVAILABLE',
    `the row holds the value the response names, not the one the button sent (live: '${rowAfterActivate.operational_status}')`);
  check('DS-09', activateChange.previous === 'AVAILABLE',
    `and the previous state it reports is the state the row was in before the write ('${activateChange.previous}'), which the audit used to take from an already-mutated object`);

  // Take the fixture online, then suspend it: the forced-offline half of the change.
  await supabaseAdmin.from('drivers').update({ is_online: true }).eq('id', fixtureUuid);
  const suspend = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'suspended' }, bearer(tokens.OPERATIONS));
  const suspendChange = (suspend.data.change || {}).operationalStatus || {};
  const rowAfterSuspend = await liveRow();
  check('DS-10', suspend.status === 200 && suspendChange.applied === 'SUSPENDED' && suspendChange.previous === 'AVAILABLE',
    `a lower-case 'suspended' is applied as SUSPENDED with the status before it recorded truthfully (${suspend.status}: '${suspendChange.previous}' → '${suspendChange.applied}')`);
  check('DS-11', rowAfterSuspend.operational_status === 'SUSPENDED' && rowAfterSuspend.is_online === false &&
    suspendChange.forcedOffline === true,
    `an online driver is taken off the road by the suspension itself, and the response says so (live is_online: ${rowAfterSuspend.is_online}, forcedOffline: ${suspendChange.forcedOffline})`);

  const reactivate = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'ACTIVE' }, bearer(tokens.OPERATIONS));
  const reactivateChange = (reactivate.data.change || {}).operationalStatus || {};
  const rowAfterReactivate = await liveRow();
  check('DS-12', reactivateChange.previous === 'SUSPENDED' && reactivateChange.applied === 'AVAILABLE' &&
    reactivateChange.isOnlineNow === false && rowAfterReactivate.is_online === false,
    `activating a suspended driver does not put them back on the road — the button that says "Activate" leaves them offline and the answer now states it (isOnlineNow: ${reactivateChange.isOnlineNow}, live is_online: ${rowAfterReactivate.is_online})`);

  const busy = await request('POST', statusRoute(fixtureUuid), { operationalStatus: 'BUSY' }, bearer(tokens.OPERATIONS));
  check('DS-13', busy.status === 200 && (busy.data.change || {}).operationalStatus.applied === 'BUSY',
    `a status that is neither an activation nor a suspension is applied as itself (${busy.status})`);

  const both = await request('POST', statusRoute(fixtureUuid),
    { operationalStatus: 'ON_TRIP', kycStatus: 'APPROVED', reason: 'Phase D fleet gate harness: KYC decision with a status change' },
    bearer(tokens.OPERATIONS));
  const bothChange = both.data.change || {};
  check('DS-14', both.status === 200 && bothChange.kycStatus.applied === 'VERIFIED' &&
    bothChange.operationalStatus.applied === 'ON_TRIP',
    `one call may still decide KYC and status together, and both halves come back described (${both.status}: kyc '${bothChange.kycStatus.requested}' → '${bothChange.kycStatus.applied}', status '${bothChange.operationalStatus.previous}' → '${bothChange.operationalStatus.applied}')`);

  const allRows = await auditRows();
  const byAction = (action) => allRows.filter(l => l.action === action);
  const activations = byAction('DRIVER_ACTIVATED');
  check('DS-15', activations.length === 2 && activations.every(a => a.newState === 'AVAILABLE'),
    `both activation records name a status the column can hold (${activations.map(a => a.newState).join(', ') || 'none found'}), where they used to end "→ 'ACTIVE'"`);
  check('DS-16', activations.some(a => a.previousState === 'SUSPENDED'),
    `and one of them reports the state it actually replaced (${activations.map(a => `${a.previousState} → ${a.newState}`).join(' | ')}), which the old post-mutation read could not: it reported the value it had just written`);
  check('DS-17', activations.every(a => ((a.metadata || {}).operationalStatus || {}).requested === 'ACTIVE' &&
    ((a.metadata || {}).operationalStatus || {}).previous === a.previousState),
    `with the button's own word kept in metadata, so the record explains the mapping without storing an impossible state (${activations.map(a => JSON.stringify((a.metadata || {}).operationalStatus || {})).join(' | ')})`);

  const suspensions = byAction('DRIVER_SUSPENDED');
  check('DS-18', suspensions.length === 1 && suspensions[0].previousState === 'AVAILABLE' &&
    suspensions[0].newState === 'SUSPENDED',
    `the suspension row is a single record of the one suspension that happened (${suspensions.map(s => `${s.previousState} → ${s.newState}`).join(' | ') || 'none found'})`);

  const busyRows = byAction('DRIVER_STATUS_BUSY');
  check('DS-19', busyRows.length === 1 && activations.length === 2,
    `moving a driver to BUSY is recorded as DRIVER_STATUS_BUSY rather than as another activation (${busyRows.map(b => `${b.previousState} → ${b.newState}`).join(' | ') || 'none found'})`);

  const kycRows = byAction('DRIVER_KYC_VERIFIED');
  check('DS-20', kycRows.length === 1 && ((kycRows[0].metadata || {}).operationalStatus || {}).applied === 'ON_TRIP',
    `a call that decided KYC and status together keeps its KYC action name and carries the fleet half in metadata, so nothing applied is missing from the trail (${kycRows.map(k => `${k.previousState} → ${k.newState}`).join(' | ') || 'none found'})`);

  const actions = allRows.map(l => l.action);
  check('DS-21', actions.length === 5 && actions.every(a => /^DRIVER_/.test(a)),
    `the fixture has exactly the five records this run wrote and nothing else (${actions.sort().join(', ')})`);
  check('DS-22', new Set(allRows.map(l => l.adminName)).size === 1,
    `all of them name the one operator who made them (${[...new Set(allRows.map(l => l.adminName))].join(', ')})`);

  const absentUuid = '00000000-0000-4000-8000-000000000099';
  const absent = await request('POST', statusRoute(absentUuid), { operationalStatus: 'ACTIVE' }, bearer(tokens.OPERATIONS));
  check('DS-23', absent.status === 400 && /not found/i.test(absent.data.error || ''),
    `a driver the directory does not have is refused without any write (${absent.status} ${absent.data.error || ''})`);

  const finalRow = await liveRow();
  check('DS-24', finalRow.operational_status === 'ON_TRIP' && finalRow.kyc_status === 'VERIFIED',
    `the row ends where the last accepted call put it ('${finalRow.operational_status}', kyc '${finalRow.kyc_status}') — the response and the store agreed at every step above`);

  // -------------------------------------------------------------------
  // 5. Cleanup
  // -------------------------------------------------------------------
  const cleanupNote = await teardown(fixtureUuid, createdAdmins, superToken, sweptBefore);
  check('IG-END', /0 still enabled/.test(cleanupNote),
    `the harness leaves nothing privileged behind: ${cleanupNote}`);

  const gone = await supabaseAdmin.from('drivers').select('id').eq('id', fixtureUuid).maybeSingle();
  check('IG-END-2', !gone.data,
    `and the fixture driver row is gone from the fleet directory (${gone.data ? 'still present' : 'deleted'}), while its ${actions.length} audit record(s) stay`);

  const failed = results.filter(r => !r.ok);
  console.log('\n=======================================================================');
  console.log(`${failed.length === 0 ? '✅' : '❌'} ${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) for (const f of failed) console.log(`   · ${f.id}: ${f.detail}`);
  console.log('=======================================================================\n');
  process.exit(failed.length ? 1 : 0);
}

main().catch(err => {
  console.error(`\n💥 Harness threw: ${err.stack || err.message}\n`);
  process.exit(1);
});
