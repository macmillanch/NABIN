// =========================================================================
// A CUSTOMER SUSPENSION HAS TO REACH THE DOOR (Phase D, area 4 — local only)
//
// Area 4 asks the admin panel to suspend and reinstate customer accounts.
// `users.account_status` already existed as a real column with
// `CHECK (account_status IN ('ACTIVE','SUSPENDED','BLOCKED'))`, so the durable part was
// never the problem. What was missing is everything that makes a status mean something:
//
//   1. **Nothing consulted it.** `authenticateUser` resolved a bearer out of the session
//      store and read no status at all, while the driver guard does check its own. A
//      suspend button that only writes that column moves data nobody reads — the
//      customer keeps transacting for the remaining thirty days of the token.
//   2. **Nothing revoked the sessions** the change invalidates, so even a correct read
//      would have had to wait for each bearer to die on its own.
//   3. **No route, no gate, no record.** `customers.read` / `customers.suspend` did not
//      exist in the permission catalogue, and an operator action on a person's account
//      with no audit row is unsweepable.
//
// So this file tests the whole chain rather than the write: a closed status is refused
// where the token is minted *and* where a token is presented, the two mechanisms cover
// each other's failure, the refusal is a 403 with its own code while an unreadable
// directory is a 503 (a client must never read an outage as a rejection), the trail
// records who closed whose account and how many sessions went, and the row in PostgreSQL
// says the same thing afterwards — which is what makes it survive a restart.
//
// Two properties are asserted negatively because they are the ones a later "just add a
// delete button" change would break: the read surface projects an account, never a
// wallet balance, date of birth or address; and no route deletes a customer at all.
//
// LOCAL ONLY. It provisions two throwaway administrator accounts (disabled afterwards,
// the same teardown the authorisation matrix uses), enrols one fixture customer through
// the normal OTP sign-in, and restores every one of those rows: the customer ends ACTIVE
// and its sessions and row are removed, so the directory is left as it was found. The
// platform's own SUPER_ADMIN signs in as itself. Nothing here is pushed, deployed, or
// pointed at a hosted project.
// =========================================================================

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

process.env.PAYMENT_WEBHOOK_SECRET ||= 'test_webhook_secret_not_for_deployment';
process.env.PAYMENT_KEY_SECRET ||= 'test_key_secret_not_for_deployment';
process.env.NABIN_TEST_MODE = 'true';

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const BASE_URL = 'http://127.0.0.1:4000';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };
const REASON = 'Phase D harness: fraud-review hold on a self-created fixture.';

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

// The customer the harness owns end to end. A fresh number enrols a fresh row through the
// normal sign-in path, so the fixture is created by the same code a handset uses and no
// existing customer is ever suspended to prove a point.
const FIXTURE_PHONE = `9${String(Date.now()).slice(-9)}`;
const ALLOWED_KEYS = ['id', 'name', 'phone', 'email', 'accountStatus', 'identityStatus',
  'rating', 'createdAt', 'updatedAt', 'allowedStatuses'];

async function signInCustomer() {
  const sent = await request('POST', '/api/auth/send-otp', {
    phone: FIXTURE_PHONE, role: 'CUSTOMER', purpose: 'LOGIN'
  });
  const otp = (sent.data && sent.data.testOtp) || '7729';
  const verified = await request('POST', '/api/auth/verify-otp', {
    phone: FIXTURE_PHONE, otp, role: 'CUSTOMER', purpose: 'LOGIN'
  });
  return { verified, token: verified.data && verified.data.token };
}

async function main() {
  console.log('=======================================================================');
  console.log('🧍 NABIN CUSTOMER ACCOUNT SURFACE — PHASE D AREA 4');
  console.log('=======================================================================\n');

  const { up } = await ensureServerRunning();
  check('CU-PRE-01', up, `a local backend answers on ${BASE_URL} ${up ? '' : '— nothing is listening, so nothing below means anything'}`);
  if (!up) process.exit(1);

  check('CU-PRE-02', isLivePostgres && !!supabaseAdmin,
    'the run is against the live PostgreSQL directory, not the demo memory list');
  if (!isLivePostgres || !supabaseAdmin) {
    console.error('\n❌ Aborting: this harness proves durability, which the offline mode cannot.\n');
    process.exit(1);
  }

  // The route table is parsed from disk by the authorisation matrix, so a server booted
  // before today's edit would answer for routes this file believes exist.
  const anonymous = await request('GET', '/api/admin/customers?limit=1');
  check('CU-PRE-03', anonymous.status === 401,
    `the customers route is registered in the running process and refuses an anonymous caller at the door (${anonymous.status})`);
  if (anonymous.status === 404) {
    console.error('\n❌ Aborting: 404 means the backend predates this code. Restart it.\n');
    process.exit(1);
  }

  const superLogin = await request('POST', '/api/admin/login', SUPER);
  check('CU-PRE-04', superLogin.status === 200 && !!superLogin.data.token,
    `the platform SUPER_ADMIN signs in (${superLogin.status})`);
  if (superLogin.status !== 200) process.exit(1);
  const superToken = superLogin.data.token;

  // A run that aborts part-way leaves its probe accounts enabled — the authorisation
  // matrix has the same hazard and sweeps for it, so this does too. Anything named like
  // this file's fixtures is disabled before new ones are made, so an aborted run cannot
  // leave a live `customers.read` credential sitting in the directory.
  const isEnabled = (a) => String(a.status || 'ACTIVE').toUpperCase() === 'ACTIVE';
  const sweepProbes = async (why) => {
    const all = await request('GET', '/api/admin/accounts', null, bearer(superToken));
    const orphans = (all.data.accounts || []).filter(a => /^cust_/.test(String(a.username || '')) && isEnabled(a));
    for (const a of orphans) {
      await request('POST', `/api/admin/accounts/${a.id}/status`,
        { isActive: false, reason: why }, bearer(superToken));
    }
    return orphans.length;
  };
  const sweptBefore = await sweepProbes('Phase D customers harness: sweeping an aborted run');
  const afterSweep = await request('GET', '/api/admin/accounts', null, bearer(superToken));
  check('CU-PRE-05', (afterSweep.data.accounts || []).filter(a => /^cust_/.test(String(a.username || '')) && isEnabled(a)).length === 0,
    `no probe account from an earlier aborted run is left enabled (${sweptBefore} swept before this run started)`);

  const suffix = crypto.randomBytes(4).toString('hex');
  const tokens = { SUPER_ADMIN: superToken };
  const createdAdmins = [];
  for (const role of ['SUPPORT_AGENT', 'FINANCE_AUDITOR', 'OPERATIONS']) {
    const username = `cust_${role.toLowerCase().slice(0, 4)}_${suffix}`;
    const password = crypto.randomBytes(18).toString('base64url');
    const created = await request('POST', '/api/admin/accounts', {
      username, name: `Customers Area ${role}`, email: `${username}@nabin.in`, role, password
    }, bearer(superToken));
    const account = created.data && created.data.account;
    createdAdmins.push({ role, username, accountId: account && account.id });
    const login = created.status === 200
      ? await request('POST', '/api/admin/login', { username, password })
      : { status: created.status };
    if (login.status === 200 && login.data.token) tokens[role] = login.data.token;
    check(`CU-PRE-06.${role}`, login.status === 200 && !!login.data.token,
      `a ${role} account exists to probe the gate with (provision=${created.status} login=${login.status})`);
  }
  if (!tokens.SUPPORT_AGENT || !tokens.FINANCE_AUDITOR || !tokens.OPERATIONS) {
    console.error('\n❌ Aborting: the deny probes need all three role tokens.\n');
    process.exit(1);
  }

  // --- 1. The gate, measured rather than assumed -------------------------
  const anonList = await request('GET', '/api/admin/customers');
  check('CU-01', anonList.status === 401,
    `an unauthenticated customer list is refused (${anonList.status})`);

  const auditorList = await request('GET', '/api/admin/customers?limit=2', null, bearer(tokens.FINANCE_AUDITOR));
  check('CU-02', auditorList.status === 403 && /customers\.read/.test(auditorList.raw),
    `FINANCE_AUDITOR, which holds no customer grant, is denied by name rather than silently answered (${auditorList.status} ${auditorList.data.code || ''})`);

  const supportList = await request('GET', '/api/admin/customers?limit=2', null, bearer(tokens.SUPPORT_AGENT));
  check('CU-03', supportList.status === 200 && Array.isArray(supportList.data.customers),
    `SUPPORT_AGENT does hold customers.read, so §4 is what answers and not the role's name (${supportList.status})`);

  const supportSuspend = await request('POST', '/api/admin/customers/00000000-0000-4000-8000-000000000000/status',
    { status: 'SUSPENDED', reason: REASON }, bearer(tokens.SUPPORT_AGENT));
  check('CU-04', supportSuspend.status === 403 && /customers\.suspend/.test(supportSuspend.raw),
    `reading customers is not closing them: the same token is refused the write by name (${supportSuspend.status})`);

  const opsSuspend = await request('POST', '/api/admin/customers/00000000-0000-4000-8000-000000000000/status',
    { status: 'SUSPENDED', reason: REASON }, bearer(tokens.OPERATIONS));
  check('CU-05', opsSuspend.status === 403,
    `OPERATIONS, which also holds customers.read, is refused the write too (${opsSuspend.status})`);

  // --- 2. What the read surface is allowed to contain --------------------
  const listed = await request('GET', '/api/admin/customers?limit=5', null, bearer(tokens.SUPPORT_AGENT));
  const rows = listed.data.customers || [];
  check('CU-06', listed.status === 200 && listed.data.dataSource === 'postgres',
    `the directory reads the authoritative table, and says so (${listed.data.dataSource})`);
  check('CU-07', rows.length > 0 && rows.every(r => Object.keys(r).every(k => ALLOWED_KEYS.includes(k))),
    `every row is an account projection and nothing else (${rows.length} row(s), keys: ${Object.keys(rows[0] || {}).join(', ')})`);
  check('CU-08', !/wallet_balance|walletBalance|"dob"|"address"|password|identity_document/i.test(listed.raw),
    'no wallet balance, date of birth, address, credential or document path leaks through the list an operator browses');
  check('CU-09', rows.every(r => Array.isArray(r.allowedStatuses) &&
    r.allowedStatuses.join(',') === 'ACTIVE,SUSPENDED,BLOCKED'),
    'the row carries the three states the column allows, so the screen cannot offer a fourth');

  const badFilter = await request('GET', '/api/admin/customers?status=UNDER_REVIEW', null, bearer(tokens.SUPPORT_AGENT));
  check('CU-10', badFilter.status === 400 && badFilter.data.code === 'CUSTOMER_STATUS_INVALID',
    `a status the CHECK constraint does not allow is refused, not treated as "match nothing" (${badFilter.status} ${badFilter.data.code || ''})`);

  const nasty = encodeURIComponent('Amitabh,Sen)%2C,*');
  const search = await request('GET', `/api/admin/customers?search=${nasty}`, null, bearer(tokens.SUPPORT_AGENT));
  check('CU-11', search.status === 200 && Array.isArray(search.data.customers) && search.data.searchCappedAt === 200,
    `free text with commas, parentheses and wildcards is a bounded parameterised read, not a filter expression (${search.status}, ${search.data.code || 'no error'})`);

  const paged = await request('GET', '/api/admin/customers?limit=2&offset=1', null, bearer(tokens.SUPPORT_AGENT));
  check('CU-12', paged.status === 200 && (paged.data.customers || []).length <= 2 && paged.data.total > 2,
    `paging is honoured against a real count rather than the page (${(paged.data.customers || []).length} of ${paged.data.total})`);

  // --- 3. A customer the harness owns, signed in for real ----------------
  const first = await signInCustomer();
  check('CU-13', first.verified.status === 200 && !!first.token,
    `the fixture customer signs in through the normal OTP path (${first.verified.status})`);
  if (!first.token) {
    console.error(`\n❌ Aborting: no fixture token (${JSON.stringify(first.verified.data).slice(0, 200)})\n`);
    process.exit(1);
  }
  const fixtureId = first.verified.data.user && (first.verified.data.user.uuid || first.verified.data.user.id);
  const second = await signInCustomer();
  check('CU-14', second.verified.status === 200 && !!second.token && second.token !== first.token,
    'a second sign-in gives a second live session, which is what a suspension has to end');

  const beforeOrders = await request('GET', '/api/customer/orders', null, bearer(first.token));
  check('CU-15', beforeOrders.status === 200,
    `the fixture's bearer works on an authenticateUser route before anything is closed (${beforeOrders.status})`);

  // Two routes resolve a bearer by hand rather than through `authenticateUser`, and they are
  // the two a handset calls to find out who it is signed in as. Both have to consult the
  // account status, and both have to keep answering an open account normally — a guard that
  // refuses everyone is as broken as one that refuses nobody.
  const meBefore = await request('GET', '/api/auth/me', null, bearer(first.token));
  check('CU-15.1', meBefore.status === 200 && meBefore.data.success === true,
    `the profile read answers an open account normally (${meBefore.status} ${meBefore.data.code || ''})`);
  const refreshBefore = await request('POST', '/api/auth/refresh-token', { token: first.token });
  check('CU-15.2', refreshBefore.status === 200 && refreshBefore.data.valid === true,
    `and so does the validate/refresh route (${refreshBefore.status} ${refreshBefore.data.code || ''})`);

  const detail = await request('GET', `/api/admin/customers/${fixtureId}`, null, bearer(superToken));
  check('CU-16', detail.status === 200 && detail.data.customer && detail.data.customer.accountStatus === 'ACTIVE',
    `the detail read finds the account by its directory id and shows it open (${detail.status} ${detail.data.customer && detail.data.customer.accountStatus})`);
  check('CU-17', detail.status === 200 && (detail.data.sessions.sessions || []).length >= 2,
    `and lists the sessions already running, which is how a confirmation can say what signing out will do (${(detail.data.sessions.sessions || []).length} listed)`);

  // --- 4. The refusals that come before any write ------------------------
  const noReason = await request('POST', `/api/admin/customers/${fixtureId}/status`,
    { status: 'SUSPENDED' }, bearer(superToken));
  check('CU-18', noReason.status === 400 && noReason.data.code === 'CUSTOMER_SUSPENSION_REASON_REQUIRED',
    `a suspension with no reason is refused — the trail is the only place a customer's complaint gets answered (${noReason.status})`);

  const unknownStatus = await request('POST', `/api/admin/customers/${fixtureId}/status`,
    { status: 'DELETED', reason: REASON }, bearer(superToken));
  check('CU-19', unknownStatus.status === 400 && unknownStatus.data.code === 'CUSTOMER_STATUS_INVALID',
    `"DELETED" is not a status this column can hold, and the request that asks for it writes nothing (${unknownStatus.status})`);

  const stillOpen = await request('GET', '/api/customer/orders', null, bearer(first.token));
  check('CU-20', stillOpen.status === 200,
    `and after both refusals the customer is still signed in — a refusal is not a partial action (${stillOpen.status})`);

  const missing = await request('POST', '/api/admin/customers/00000000-0000-4000-8000-000000000000/status',
    { status: 'SUSPENDED', reason: REASON }, bearer(superToken));
  check('CU-21', missing.status === 404 && missing.data.code === 'CUSTOMER_NOT_FOUND',
    `a well-formed id that is not in the directory answers 404, not 200 with nothing changed (${missing.status})`);

  // --- 5. The suspension, and everything it has to reach ----------------
  const suspended = await request('POST', `/api/admin/customers/${fixtureId}/status`,
    { status: 'SUSPENDED', reason: REASON }, bearer(superToken));
  const sessionsEnded = suspended.data.sessions || {};
  check('CU-22', suspended.status === 200 && suspended.data.status === 'SUSPENDED' && suspended.data.persisted === true,
    `SUPER_ADMIN suspends the account and the answer says it came from PostgreSQL (${suspended.status} ${suspended.data.dataSource || ''})`);
  check('CU-23', (sessionsEnded.signedOut || 0) >= 2,
    `and ends every session it just made invalid — ${sessionsEnded.signedOut} signed out (${sessionsEnded.revokedInStore} in the store, ${sessionsEnded.revokedInMemory} in this process)`);

  const bearerA = await request('GET', '/api/customer/orders', null, bearer(first.token));
  // Either refusal is correct and they mean different things: 401 when the revocation
  // landed and there is no session to honour, 403 ACCOUNT_SUSPENDED when a session survived
  // the write and the status guard is what stops it. What must never happen is 200, and a
  // handset must never see a 5xx here — the account really is closed.
  check('CU-24', bearerA.status === 401 || (bearerA.status === 403 && bearerA.data.code === 'ACCOUNT_SUSPENDED'),
    `the bearer issued before the suspension is refused (${bearerA.status} ${bearerA.data.code || 'session gone'})`);
  const bearerB = await request('GET', '/api/customer/orders', null, bearer(second.token));
  check('CU-25', bearerB.status === 401 || bearerB.status === 403,
    `so is the second device's — the sweep is not limited to the token in hand (${bearerB.status})`);

  const meAfter = await request('GET', '/api/auth/me', null, bearer(first.token));
  check('CU-25.1', meAfter.status === 401 || (meAfter.status === 403 && meAfter.data.code === 'ACCOUNT_SUSPENDED'),
    `the profile read refuses it too, which is the call a handset uses to decide whether to keep showing a signed-in app (${meAfter.status} ${meAfter.data.code || 'session gone'})`);
  const refreshAfter = await request('POST', '/api/auth/refresh-token', { token: first.token });
  check('CU-25.2', refreshAfter.status === 401 || refreshAfter.status === 403,
    `and validating a token is not a way to get a closed account back (${refreshAfter.status} ${refreshAfter.data.code || 'session gone'})`);

  const reSignIn = await signInCustomer();
  check('CU-26', reSignIn.verified.status === 403 && reSignIn.verified.data.code === 'ACCOUNT_SUSPENDED' && !reSignIn.token,
    `and a fresh sign-in issues no token either, which is the half that survives a restart of this process (${reSignIn.verified.status} ${reSignIn.verified.data.code || ''})`);

  const { data: storeRow } = await supabaseAdmin.from('users')
    .select('account_status, updated_at').eq('id', fixtureId).maybeSingle();
  check('CU-27', storeRow && storeRow.account_status === 'SUSPENDED',
    `the column the next boot hydrates from says SUSPENDED in PostgreSQL itself (${storeRow && storeRow.account_status})`);

  const afterSuspend = await request('GET', `/api/admin/customers/${fixtureId}`, null, bearer(superToken));
  const liveAfter = (afterSuspend.data.sessions || {}).sessions || [];
  check('CU-28', afterSuspend.status === 200 && liveAfter.length === 0,
    `the detail read now shows no live sessions, so the screen agrees with what the write did (${liveAfter.length} left)`);

  const trail = await request('GET', `/api/admin/audit-logs?module=CUSTOMER&action=CUSTOMER_SUSPENDED`, null, bearer(superToken));
  const entry = (trail.data.logs || trail.data.auditLogs || []).find(l =>
    String(l.targetEntityId || '') === String(fixtureId));
  check('CU-29', trail.status === 200 && !!entry,
    `the trail carries one CUSTOMER_SUSPENDED row addressed by the directory id (${trail.status})`);
  check('CU-30', !!entry && String(entry.reason || '').includes('fraud-review hold') &&
    entry.metadata && entry.metadata.sessionsSignedOut >= 2,
    `with the operator's reason and the number of sessions that went, which is what an appeal is answered from (${entry && JSON.stringify(entry.metadata)})`);
  check('CU-31', !!entry && !/"(wallet_balance|walletBalance|dob|address|email|phone)"/i.test(JSON.stringify(entry)) &&
    typeof entry.previousState === 'string' && typeof entry.newState === 'string',
    `and the record proves the closure with two status strings, not a copy of the account — no contact detail, balance or address in a table more people read (${entry && entry.previousState} → ${entry && entry.newState})`);

  // --- 6. BLOCKED is a different answer, and sign-out is a different action
  const blocked = await request('POST', `/api/admin/customers/${fixtureId}/status`,
    { status: 'BLOCKED', reason: 'Phase D harness: second state on the same fixture.' }, bearer(superToken));
  check('CU-32', blocked.status === 200 && blocked.data.status === 'BLOCKED',
    `SUSPENDED → BLOCKED is a legal transition the column accepts (${blocked.status})`);

  const blockedSignIn = await signInCustomer();
  check('CU-33', blockedSignIn.verified.status === 403 && blockedSignIn.verified.data.code === 'ACCOUNT_BLOCKED',
    `a blocked account is refused a token under its own code, so an app can tell the two apart on screen (${blockedSignIn.verified.status} ${blockedSignIn.verified.data.code || ''})`);

  const reactivated = await request('POST', `/api/admin/customers/${fixtureId}/status`,
    { status: 'ACTIVE' }, bearer(superToken));
  check('CU-34', reactivated.status === 200 && reactivated.data.previousStatus === 'BLOCKED' &&
    reactivated.data.status === 'ACTIVE',
    `reinstatement names the state it left, and needs no reason because closing an account is the act that requires one (${reactivated.status})`);

  const backIn = await signInCustomer();
  check('CU-35', backIn.verified.status === 200 && !!backIn.token,
    `the same customer can sign in again the moment the account is open — the refusal was the status, not the number (${backIn.verified.status})`);

  const signedOut = await request('POST', `/api/admin/customers/${fixtureId}/sign-out`, {}, bearer(superToken));
  check('CU-36', signedOut.status === 200 && (signedOut.data.sessions.signedOut || 0) >= 1,
    `and the sign-out route ends sessions on its own, without touching the status (${signedOut.status}, ${signedOut.data.sessions && signedOut.data.sessions.signedOut} ended, account ${signedOut.data.customer && signedOut.data.customer.accountStatus})`);

  const kicked = await request('GET', '/api/customer/orders', null, bearer(backIn.token));
  check('CU-37', kicked.status === 401 && kicked.data.code !== 'ACCOUNT_SUSPENDED' && kicked.data.code !== 'ACCOUNT_BLOCKED',
    `the session that just ended answers 401 "no such session", not a closed-account 403 — signing out is not closing (${kicked.status} ${kicked.data.code || ''})`);

  const afterSignOut = await request('GET', `/api/admin/customers/${fixtureId}`, null, bearer(superToken));
  const leftAfterSignOut = ((afterSignOut.data.sessions || {}).sessions || []).length;
  check('CU-38', afterSignOut.status === 200 && afterSignOut.data.customer.accountStatus === 'ACTIVE' &&
    leftAfterSignOut === 0,
    `and the account is still open with nothing signed in, which is the state a stolen-phone report asks for (${afterSignOut.data.customer && afterSignOut.data.customer.accountStatus}, ${leftAfterSignOut} session(s) left)`);

  const signOutTrail = await request('GET', '/api/admin/audit-logs?module=CUSTOMER&action=CUSTOMER_SESSIONS_REVOKED', null, bearer(superToken));
  const signOutEntry = (signOutTrail.data.logs || signOutTrail.data.auditLogs || [])
    .find(l => String(l.targetEntityId || '') === String(fixtureId));
  check('CU-39', !!signOutEntry && /status is unchanged \(ACTIVE\)/.test(String(signOutEntry.reason)),
    `the sign-out is audited as its own action, saying in words that the account stayed open (${signOutEntry ? 'found' : 'no record'})`);

  // --- 7. There is no delete route --------------------------------------
  const noDelete = await request('DELETE', `/api/admin/customers/${fixtureId}`, null, bearer(superToken));
  check('CU-40', noDelete.status === 404 && noDelete.data.success !== true,
    `no route deletes a customer, whatever an operator expects to find: their orders, ledger and trail all point at the row (${noDelete.status})`);

  // --- 8. The status guard itself, in this process -----------------------
  // Over HTTP a suspension that revokes correctly answers 401 before the status guard is
  // reached, so the branch that catches a session which *did* survive would never be
  // exercised by the calls above. These run `customerSessionRefusal` directly for that
  // reason — it is the code that has to hold when the revocation fails, when another
  // instance writes the row, or when the bearer names an account this process cannot see.
  const db = require('./src/database');
  const { data: fixtureRow } = await supabaseAdmin.from('users')
    .select('id, phone, account_status').eq('id', fixtureId).maybeSingle();

  check('INP-01', ['IDENTITY_VERIFICATION_PENDING', 'UNDER_REVIEW', 'REJECTED', 'RESUBMISSION_REQUIRED']
    .every(overload => db.customerAccountBlocked({ accountStatus: overload }) === null),
    'the identity states this project also stores in `accountStatus` do not close an account — only the three the column allows can');
  check('INP-02', db.customerAccountBlocked({ accountStatus: 'SUSPENDED' }) === 'SUSPENDED' &&
    db.customerAccountBlocked({ accountStatus: 'BLOCKED' }) === 'BLOCKED' &&
    db.customerAccountBlocked({ accountStatus: 'ACTIVE' }) === null &&
    db.customerAccountBlocked(null) === null,
    'and the two closure states read back as themselves, while a missing record is not treated as closed');

  const fakeHandle = crypto.randomBytes(32).toString('hex');
  const snapshotOnly = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: 'usr_block_me', phone: null,
    entity: { id: 'usr_block_me', accountStatus: 'BLOCKED' }, token: fakeHandle
  });
  check('INP-03', snapshotOnly && snapshotOnly.code === 'CUSTOMER_ACCOUNT_UNRESOLVED',
    `the copy a session carries is neither believed nor used as evidence — it is a mint-time snapshot, so an unresolvable id is refused as unattributable rather than judged from it (${snapshotOnly && snapshotOnly.code})`);

  const carried = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: String(db.users[1].id), phone: db.users[1].phone,
    entity: db.users[1], token: fakeHandle
  });
  check('INP-04', carried === null,
    `a locally-resolved ACTIVE account passes the guard (${carried === null ? 'allowed' : JSON.stringify(carried)})`);
  db.users[1].accountStatus = 'BLOCKED';
  const carriedBlocked = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: String(db.users[1].id), phone: db.users[1].phone,
    entity: db.users[1], token: fakeHandle
  });
  db.users[1].accountStatus = 'ACTIVE';
  check('INP-05', carriedBlocked && carriedBlocked.status === 403 && carriedBlocked.code === 'ACCOUNT_BLOCKED',
    `and the same session is refused the moment the record says closed, with its own 4xx code (${carriedBlocked && carriedBlocked.code})`);

  const storeSide = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: 'usr_not_here', phone: fixtureRow && fixtureRow.phone, token: fakeHandle
  });
  check('INP-06', storeSide === null,
    `an unresolvable session is asked of the directory by number rather than guessed at, and the fixture's row now says it may sign in (${storeSide === null ? 'allowed' : JSON.stringify(storeSide)})`);

  const unaddressable = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: 'not-an-identifier', phone: null, token: fakeHandle
  });
  check('INP-07', unaddressable && unaddressable.status === 403 &&
    unaddressable.code === 'CUSTOMER_ACCOUNT_UNRESOLVED',
    `a bearer that names no addressable account is refused instead of passing on "unknown" — the alternative is a session nobody can attribute (${unaddressable && unaddressable.code})`);

  const driverSession = await db.customerSessionRefusal({ role: 'DRIVER', entityId: 'DRV-101', token: fakeHandle });
  check('INP-08', driverSession === null,
    'and the guard abstains on another role\'s session, which its own middleware is responsible for');

  await supabaseAdmin.from('users').update({ account_status: 'SUSPENDED' }).eq('id', fixtureId);
  const afterStoreWrite = await db.customerSessionRefusal({
    role: 'CUSTOMER', entityId: 'usr_not_here', phone: fixtureRow && fixtureRow.phone, token: fakeHandle
  });
  check('INP-09', afterStoreWrite && afterStoreWrite.status === 403 &&
    afterStoreWrite.code === 'ACCOUNT_SUSPENDED',
    `a status written outside this process is caught on the next presentation, because the fallback reads the row rather than a cache (${afterStoreWrite && afterStoreWrite.code})`);

  // CU-25.1 and CU-25.2 above can only ever see a *dead session*, because this harness's
  // suspension revokes correctly — so a 401 there does not prove the guard is wired into
  // those handlers. This reads the source, the way A3b's ST-01 rule does, so that deleting
  // one of the two calls fails a check instead of quietly reopening a route.
  const serverSource = require('fs').readFileSync(path.join(__dirname, 'src/server.js'), 'utf8');
  const handlerOf = (signature) => {
    const start = serverSource.indexOf(signature);
    const end = start < 0 ? -1 : serverSource.indexOf('\n});', start);
    return start < 0 || end < 0 ? '' : serverSource.slice(start, end);
  };
  const meBlock = handlerOf("app.get('/api/auth/me'");
  const refreshBlock = handlerOf("app.post('/api/auth/refresh-token'");
  check('INP-10', meBlock.includes('customerSessionRefusal') && refreshBlock.includes('customerSessionRefusal'),
    `the two routes that resolve a bearer without authenticateUser both consult the guard — /api/auth/me ${meBlock.includes('customerSessionRefusal') ? 'wired' : 'NOT WIRED'}, refresh-token ${refreshBlock.includes('customerSessionRefusal') ? 'wired' : 'NOT WIRED'}`);

  // --- 9. The harness leaves nothing behind ------------------------------
  const cleanup = await teardown(fixtureId);
  check('CU-41', cleanup.ok, cleanup.detail);

  const sweptAfter = await sweepProbes('Phase D customers harness teardown');
  check('CU-42', sweptAfter >= createdAdmins.length,
    `the ${createdAdmins.length} probe accounts this run made were disabled again, and so was any earlier one still standing (${sweptAfter} swept)`);

  const finalRead = await request('GET', `/api/admin/customers?search=${encodeURIComponent(FIXTURE_PHONE)}`, null, bearer(superToken));
  check('CU-43', finalRead.status === 200 && (finalRead.data.customers || []).length === 0,
    `the fixture is gone from the directory, so the run leaves the tenant list as it found it (${(finalRead.data.customers || []).length} row(s) match the fixture number)`);

  const failed = results.filter(r => !r.ok);
  console.log('\n=======================================================================');
  console.log(`${failed.length === 0 ? '✅' : '❌'} ${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length) for (const f of failed) console.log(`   · ${f.id}: ${f.detail}`);
  console.log('=======================================================================\n');
  process.exit(failed.length ? 1 : 0);
}

// The fixture is a customer row and however many sessions the run minted against it. Both
// are the harness's own, so both go back; a row the store refuses to remove stays ACTIVE
// and is reported instead of being force-deleted around a foreign key.
async function teardown(fixtureId) {
  try {
    const row = await supabaseAdmin.from('users').select('phone, account_status').eq('id', fixtureId).maybeSingle();
    const phone = row && row.data && row.data.phone;
    if (phone) {
      await supabaseAdmin.from('backend_sessions').delete().eq('role', 'CUSTOMER').eq('phone', phone);
    }
    if (row && row.data && row.data.account_status !== 'ACTIVE') {
      await supabaseAdmin.from('users').update({ account_status: 'ACTIVE' }).eq('id', fixtureId);
    }
    const removed = await supabaseAdmin.from('users').delete().eq('id', fixtureId).select('id');
    if (removed.error) {
      return { ok: false, detail: `the fixture row could not be removed (${removed.error.message}) — it was left ACTIVE` };
    }
    if ((removed.data || []).length === 0) {
      return { ok: false, detail: 'the fixture delete matched no row — the customer may still be in the directory' };
    }
    return { ok: true, detail: `the fixture's sessions and its directory row were removed (${(removed.data || []).length} row deleted)` };
  } catch (err) {
    return { ok: false, detail: `cleanup threw: ${err.message}` };
  }
}

main().catch(err => {
  console.error(`\n💥 Harness threw: ${err.stack || err.message}\n`);
  process.exit(1);
});
