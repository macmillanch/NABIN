'use strict';

// =========================================================================
// NABIN — P0 SECURITY: POST /api/support/ticket/:id/message AUTHORIZATION
//
// A support thread is the record where a customer types where their order went wrong, what they
// were charged and often who they are travelling with. This suite pins who may write into one —
// and because the route answers with the updated ticket, who may READ it in full.
//
// The rule it enforces:
//   * an admin may reply to any ticket (that is the support job);
//   * a CUSTOMER / DRIVER / MERCHANT may write ONLY into a thread their own resolved identity
//     owns;
//   * an identity the store cannot resolve is refused too — ownership nobody can prove is not
//     ownership;
//   * a refusal puts no part of the thread in the response body and writes nothing durable.
//
// Why the third clause matters: `addMessage` compared the caller to the ticket owner only
// `if (callerUuid && ticketOwnerUuid && callerUuid !== ticketOwnerUuid)`. `resolveUserUuid` returns
// null for any handle that is not a uuid and matches no users/drivers row, and a restored
// `backend_sessions` row carries `entity_id` verbatim (`restoreSession` adopts it as long as the
// row has an `entity`), so a bearer whose handle no longer names an account skipped the comparison
// entirely and was answered 200 with the whole of another customer's thread. Same class as MI-1 on
// the payment-session route: a guard that vanishes when one side is unresolvable, and a role that
// was refused only because its id happened to be shaped like a uuid. Both halves are asserted here
// — the resolvable stranger AND the unresolvable handle — so the fix has to close the class.
//
// Local/test only: refuses a non-loopback backend or database, and refuses a store that is not
// live PostgreSQL, because on the mock branch the ownership comparison is a plain id equality and
// these assertions would be about nothing. This run owns and deletes exactly three rows: its
// ticket (by id) and the three ghost session rows it inserted (by token_hash). What stays is
// deliberate: the `backend_sessions` rows minted by signing in as the SHARED seeded customer,
// driver and merchant — those tokens live in `.nabin_test_sessions.json` and other links reuse
// them, so deleting them here would revoke another run's session to tidy a census — plus any
// `audit_logs` rows, which migration 022 makes append-only. The chain census names both.
// =========================================================================

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('./testSessionCache');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const targetGuard = require('./scripts/chain_target_guard');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'support_ticket_thread_ownership_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — support_ticket_thread_ownership_test must run against a LIVE Postgres target so the');
  console.error('durable thread-ownership assertions mean something. Run it under');
  console.error('`node scripts/with_local_target.js node support_ticket_thread_ownership_test.js`.');
  process.exit(2);
}

const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';

// Identities already seeded in the local development store (same fixtures link 81 uses).
const CUST_A_PHONE = '9845011982';                       // Priya Saxena — the ticket owner
const CUST_B_PHONE = '9876543210';                       // Rahul Sharma — a proven stranger
const DRIVER_PHONE = '9810122910';
const MERCHANT_PHONE = '9811223344';

const STAMP = Date.now().toString(36);
// The three unresolvable handles. Run-unique so nothing here can alias a real users/drivers row:
// `resolveUserUuid` has to return null for them, which is the whole defect.
const GHOST = {
  CUSTOMER: `STF-GHOST-C-${STAMP}`,
  MERCHANT: `STF-GHOST-M-${STAMP}`,
  DRIVER: `STF-GHOST-D-${STAMP}`,
};
// Text only the ticket owner may ever cause to be stored.
const OWNER_TEXT = `STF-${STAMP}-owner-followup`;
const GHOST_TEXT = `STF-${STAMP}-ghost-injected`;
const STRANGER_TEXT = `STF-${STAMP}-stranger-injected`;

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

async function bootServer({ port, request, attempts = 60, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: { ...process.env, PORT: String(port), NABIN_SESSION_PRUNE: 'off' },
  }));
  proc.unref();
  const deadline = Date.now() + attempts * delayMs + 15000;
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) break;
  }
  return proc;
}

async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Support Thread Guard Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return res.data && res.data.token;
}

let pg = null;

// The thread straight from the store — what a refusal must not change and what a pass must not add.
async function threadRow(ticketUuid) {
  const r = await pg.query(
    `select id, ticket_number, user_id, user_type, status,
            coalesce(jsonb_array_length(messages), 0) as messages,
            messages::text as messages_text
       from support_tickets where id = $1::uuid`, [ticketUuid]);
  return r.rows[0] || null;
}

const refused = (res) => res.status === 403 || res.status === 404;
const leakedThread = (res) => Boolean(res.data && res.data.ticket);

async function main() {
  console.log('========================================================================');
  console.log('NABIN SUPPORT TICKET THREAD OWNERSHIP TEST — P0 role + tenant isolation');
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(process.env.DATABASE_URL)}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const beforeTickets = (await pg.query('select count(*)::int n from support_tickets')).rows[0].n;
  const beforeSessions = (await pg.query('select count(*)::int n from backend_sessions')).rows[0].n;

  // --- ghost sessions: inserted BEFORE boot so the server hydrates them the way it hydrates any
  // session row an earlier build persisted. Each carries an `entity`, which is what makes
  // `restoreSession` adopt it, and an `entity_id` that names no account.
  const ghostTokens = {};
  const ghostHashes = [];
  for (const [role, handle] of Object.entries(GHOST)) {
    const token = `stf_ghost_${role.toLowerCase()}_${STAMP}_${crypto.randomBytes(16).toString('base64url')}`;
    const hash = sha256(token);
    ghostTokens[role] = token;
    ghostHashes.push(hash);
    await pg.query(`
      INSERT INTO backend_sessions (token_hash, role, entity_id, phone, entity, expires_at)
      VALUES ($1, $2, $3, NULL, $4::jsonb, now() + interval '1 day')
      ON CONFLICT (token_hash) DO NOTHING`,
      [hash, role, handle, JSON.stringify({ id: handle, name: `Ghost ${role} Bearer` })]);
  }

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  const login = createLogin({ baseUrl: BASE, request });

  let proc = null;
  let ticketUuid = null;
  try {
    proc = await bootServer({ port, request });
    const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
    assert('STF-00 backend (this run started it) is healthy on its private port', health.status === 200, { port });

    const adminToken = await mintAdmin({ request });
    assert('STF-01 admin session minted', Boolean(adminToken));

    const custA = await login(CUST_A_PHONE, 'CUSTOMER');
    const custB = await login(CUST_B_PHONE, 'CUSTOMER');
    const drv = await login(DRIVER_PHONE, 'DRIVER');
    const mch = await login(MERCHANT_PHONE, 'MERCHANT');
    assert('STF-02 ticket-owner customer authenticated', Boolean(custA.token), custA.failure || {});
    assert('STF-03 second customer authenticated', Boolean(custB.token), custB.failure || {});
    assert('STF-04 driver authenticated', Boolean(drv.token), drv.failure || {});
    assert('STF-05 merchant authenticated', Boolean(mch.token), mch.failure || {});
    if (!custA.token || !custB.token || !drv.token || !mch.token || !adminToken) {
      throw new Error('identity setup incomplete; cannot test authorization');
    }

    // --- the fixture: one real durable thread, owned by customer A ----------------------------
    const created = await request('POST', '/api/support/ticket', {
      title: `STF-${STAMP} delivery never arrived`,
      description: `Order never arrived, need a refund. Ref ${STAMP}`,
      category: 'GENERAL',
    }, bearer(custA.token));
    assert('STF-06 customer A opens a support ticket (HTTP 200)',
      created.status === 200 && created.data && created.data.success === true
      && Boolean(created.data.ticket && created.data.ticket.uuid), created.data);

    ticketUuid = created.data && created.data.ticket && created.data.ticket.uuid;
    const ticketNumber = created.data && created.data.ticket && created.data.ticket.ticketNumber;
    if (!ticketUuid || !ticketNumber) throw new Error('ticket fixture missing uuid/ticket_number');

    const fixture = await threadRow(ticketUuid);
    // The row must be bound to a resolvable owner: `support_tickets.user_id` is `UUID NOT NULL`, and
    // every live `createTicket` writes the caller's resolved uuid. That is what makes the fail-closed
    // fix safe to assert — an owner binding that is always present must never be the thing refused.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert('STF-07 durable row binds the thread to a resolved customer uuid and holds exactly the opening message',
      Boolean(fixture) && String(fixture.user_type) === 'CUSTOMER' && Number(fixture.messages) === 1
      && UUID_RE.test(String(fixture.user_id)),
      { user_id: fixture && fixture.user_id, user_type: fixture && fixture.user_type, messages: fixture && fixture.messages });
    const ownerUuid = fixture.user_id;

    // --- the owner may write (the fix must not break this) ------------------------------------
    const ownerPost = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: OWNER_TEXT }, bearer(custA.token));
    assert('STF-08 the owner posts into their own thread (HTTP 200 — real path preserved)',
      ownerPost.status === 200 && ownerPost.data && ownerPost.data.success === true,
      { status: ownerPost.status, body: ownerPost.data });

    // --- a proven stranger is refused ---------------------------------------------------------
    const strangerByUuid = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: STRANGER_TEXT }, bearer(custB.token));
    assert('STF-09 another CUSTOMER writing by ticket uuid is refused (403/404)',
      refused(strangerByUuid), { status: strangerByUuid.status, code: strangerByUuid.data && strangerByUuid.data.code, leaked: leakedThread(strangerByUuid) });

    const strangerByNumber = await request('POST', `/api/support/ticket/${ticketNumber}/message`,
      { text: STRANGER_TEXT }, bearer(custB.token));
    assert('STF-10 another CUSTOMER writing by ticket NUMBER is refused (403/404)',
      refused(strangerByNumber), { status: strangerByNumber.status, code: strangerByNumber.data && strangerByNumber.data.code, leaked: leakedThread(strangerByNumber) });
    assert('STF-11 the stranger refusal puts no thread in the response body',
      !leakedThread(strangerByUuid) && !leakedThread(strangerByNumber),
      { byUuid: strangerByUuid.data, byNumber: strangerByNumber.data });

    // --- the other two non-admin roles are refused by role, not by id shape -------------------
    const driverPost = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: STRANGER_TEXT }, bearer(drv.token));
    assert('STF-12 a DRIVER bearer is refused (403/404) and leaks nothing',
      refused(driverPost) && !leakedThread(driverPost),
      { status: driverPost.status, code: driverPost.data && driverPost.data.code, leaked: leakedThread(driverPost) });

    const merchantPost = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: STRANGER_TEXT }, bearer(mch.token));
    assert('STF-13 a MERCHANT bearer is refused (403/404) and leaks nothing',
      refused(merchantPost) && !leakedThread(merchantPost),
      { status: merchantPost.status, code: merchantPost.data && merchantPost.data.code, leaked: leakedThread(merchantPost) });

    // --- THE DEFECT: an identity the store cannot resolve -------------------------------------
    // A session row whose `entity_id` names no users/drivers row. `resolveUserUuid` returns null
    // for it, so the guarded comparison used to be skipped and the write landed.
    const ghostCustomer = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: GHOST_TEXT }, bearer(ghostTokens.CUSTOMER));
    assert('STF-14 a bearer whose identity resolves to no account is refused (403/404, fails closed)',
      refused(ghostCustomer),
      { status: ghostCustomer.status, code: ghostCustomer.data && ghostCustomer.data.code, handle: GHOST.CUSTOMER });
    assert('STF-15 that refusal does not hand back another customer\'s thread',
      !leakedThread(ghostCustomer),
      { status: ghostCustomer.status, leaked: leakedThread(ghostCustomer) });

    const ghostMerchant = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: GHOST_TEXT }, bearer(ghostTokens.MERCHANT));
    assert('STF-16 an unresolvable MERCHANT bearer is refused too',
      refused(ghostMerchant) && !leakedThread(ghostMerchant),
      { status: ghostMerchant.status, handle: GHOST.MERCHANT, leaked: leakedThread(ghostMerchant) });

    const ghostDriver = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: GHOST_TEXT }, bearer(ghostTokens.DRIVER));
    assert('STF-17 an unresolvable DRIVER bearer is refused too',
      refused(ghostDriver) && !leakedThread(ghostDriver),
      { status: ghostDriver.status, handle: GHOST.DRIVER, leaked: leakedThread(ghostDriver) });

    const ghostCreate = await request('POST', '/api/support/ticket', {
      title: `STF-${STAMP} ghost created a ticket`,
      description: 'a ticket under an identity nobody can resolve',
      category: 'GENERAL',
    }, bearer(ghostTokens.CUSTOMER));
    assert('STF-18 the sibling create boundary refuses an unresolvable identity (401) and writes nothing',
      ghostCreate.status === 401, { status: ghostCreate.status, code: ghostCreate.data && ghostCreate.data.code });

    // --- refusals must not mutate the thread --------------------------------------------------
    const afterRefusals = await threadRow(ticketUuid);
    const storedText = afterRefusals && afterRefusals.messages_text || '';
    assert('STF-19 the refused writes changed nothing durable (owner+1 message only)',
      Boolean(afterRefusals) && Number(afterRefusals.messages) === 2
      && String(afterRefusals.user_id) === String(ownerUuid),
      { messages: afterRefusals && afterRefusals.messages });
    assert('STF-20 no attacker text reached the durable thread',
      storedText.includes(OWNER_TEXT) && !storedText.includes(GHOST_TEXT) && !storedText.includes(STRANGER_TEXT),
      { hasOwner: storedText.includes(OWNER_TEXT), hasGhost: storedText.includes(GHOST_TEXT), hasStranger: storedText.includes(STRANGER_TEXT) });

    // --- the read boundary and the anonymous boundaries --------------------------------------
    const strangerRead = await request('GET', `/api/support/user/${ownerUuid}`, null, bearer(custB.token));
    assert('STF-21 another CUSTOMER reading A\'s tickets by id is refused (403)',
      strangerRead.status === 403 && !(strangerRead.data && strangerRead.data.tickets && strangerRead.data.tickets.length),
      { status: strangerRead.status, code: strangerRead.data && strangerRead.data.code });

    const anonPost = await request('POST', `/api/support/ticket/${ticketUuid}/message`, { text: STRANGER_TEXT });
    assert('STF-22 anonymous write is refused (401)', anonPost.status === 401, anonPost.data);
    const badBearer = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: STRANGER_TEXT }, bearer('stf_not_a_real_session_token'));
    assert('STF-23 invalid bearer write is refused (401)', badBearer.status === 401, badBearer.data);

    // --- the legitimate support path stays working --------------------------------------------
    const adminReply = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: `STF-${STAMP}-admin-reply` }, bearer(adminToken));
    assert('STF-24 admin still replies to the customer\'s thread (HTTP 200)',
      adminReply.status === 200 && adminReply.data && adminReply.data.success === true,
      { status: adminReply.status, body: adminReply.data });
    const afterAdmin = await threadRow(ticketUuid);
    assert('STF-25 the admin reply is durable and moved OPEN to IN_PROGRESS',
      Boolean(afterAdmin) && Number(afterAdmin.messages) === 3 && afterAdmin.status === 'IN_PROGRESS',
      { messages: afterAdmin && afterAdmin.messages, status: afterAdmin && afterAdmin.status });

    const ownerAgain = await request('POST', `/api/support/ticket/${ticketUuid}/message`,
      { text: `${OWNER_TEXT}-second` }, bearer(custA.token));
    assert('STF-26 the owner can still post after every refusal (no lockout side effect)',
      ownerAgain.status === 200 && ownerAgain.data && ownerAgain.data.success === true,
      { status: ownerAgain.status, body: ownerAgain.data });
    const finalRow = await threadRow(ticketUuid);
    assert('STF-27 final durable thread is exactly owner, owner, admin, owner (4 messages)',
      Boolean(finalRow) && Number(finalRow.messages) === 4
      && !((finalRow.messages_text || '').includes(GHOST_TEXT))
      && !((finalRow.messages_text || '').includes(STRANGER_TEXT)),
      { messages: finalRow && finalRow.messages });

    console.log('\n--- RESULT ---');
  } finally {
    try {
      if (ticketUuid) {
        const del = await pg.query('delete from support_tickets where id = $1::uuid', [ticketUuid]);
        console.log(`\n[cleanup] deleted ${del.rowCount} of 1 support_tickets row this run created`);
      }
      if (ghostHashes.length) {
        const del = await pg.query('delete from backend_sessions where token_hash = any($1)', [ghostHashes]);
        console.log(`[cleanup] deleted ${del.rowCount} of ${ghostHashes.length} ghost backend_sessions row(s) this run inserted`);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP FAILED] residue may remain:', cleanupErr.message);
    }

    console.log('\n================ SUMMARY ================');
    const afterTickets = (await pg.query('select count(*)::int n from support_tickets').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    const afterSessions = (await pg.query('select count(*)::int n from backend_sessions').catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    console.log(`support_tickets rows: before ${beforeTickets}, after cleanup ${afterTickets}`);
    console.log(`backend_sessions rows: before ${beforeSessions}, after cleanup ${afterSessions}`);
    console.log(`(the shared seeded customer/driver/merchant sessions this run reused stay, and are named by the census)`);
    console.log(`=== MI-7 SUPPORT TICKET THREAD OWNERSHIP: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed ===`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const f of failed) console.log(`  - ${f}`);
    }

    stopProc(proc);
    await pg.end();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch(async (err) => {
  console.error('support_ticket_thread_ownership_test harness error:', err && err.stack || err);
  try { if (pg) await pg.end(); } catch { /* noop */ }
  process.exit(1);
});
