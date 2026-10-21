/*
 * RRA — REFUND RECIPIENT ATTRIBUTION: who the platform tells about a refund, read out of PostgreSQL.
 *
 * The defect this suite pins is a recipient substitution on the notification leg of
 * `POST /api/admin/finance/refund` (server.js:2809). The money leg is honest — it delegates to the
 * SECURITY DEFINER function `refund_payment_atomic`, which writes `payments`,
 * `payment_refund_authorizations` and the double-entry posting, and it returns
 * `success/paymentId/refundAmount/totalRefunded/status/eventId/ledgerEntryId/transactionId`. It does
 * NOT return a `userId` (supabase/migrations/039_atomic_double_entry_capture_and_refund.sql:385-395),
 * so the route's first attempt at a recipient (`data.userId`) can never succeed. What is left is a
 * read-back of `payments.customer_id` (nullable since 006_payments_domain.sql:15), then a mirror-only
 * `db.getJob(jobId)` that has no row to offer after a restart — and then this:
 *
 *   if (!refundRecipient) refundRecipient = resolveCustomerUserUuid('usr_2');   // server.js:2873
 *
 * which resolves through `LEGACY_CUSTOMER_MAP` (server.js:36-38) to the seeded fixture
 * `00000000-0000-0000-0000-000000000002`. `notificationEventBus.publish` then inserts a durable
 * `notifications` row for that account (server.js:236-249) and pushes it to that account's registered
 * devices (server.js:255). So a refund whose owner the platform could not determine is announced,
 * with its amount and payment id, to a fixed unrelated customer — a fabricated attribution and a
 * misdirected financial notice. The same file already contains the honest shape two lines away:
 * the payout route skips the bus and records `[NOTIF_BUS_SKIPPED]` when no driver resolves
 * (server.js:7958-7960), and the bus itself refuses to invent a recipient (server.js:213-220).
 *
 * The fix is therefore a deletion, not an addition: with no resolvable recipient, publish nothing and
 * record the skip. Nothing about the refund changes — which is exactly what GROUP A asserts, because
 * "we stopped notifying" and "we broke refunds" must not be confusable.
 *
 * Everything is asserted against durable state. A 200 response is not evidence; the row count in
 * `notifications` keyed on this run's own payment ids is. GROUP B is the over-broad-fix guard: a
 * payment that DOES carry `customer_id` must still produce exactly one notification for that
 * customer, so the fix cannot pass by silently disabling refund notifications. GROUP B also makes
 * GROUP A's zero meaningful — the positive case proves the bus was live and the wait long enough,
 * so an absent row is a refusal rather than a race.
 *
 * Local Docker only: `scripts/chain_target_guard` refuses a non-loopback declared store and a mirror
 * target cannot prove durability, so the suite exits 1 rather than pretending. Run as an ISOLATED
 * chain link: it writes `payments`, `payment_refund_authorizations`, `ledger_entries`,
 * `journal_*` and `notifications`, all census-protected, so every write must die in `chain_scratch`.
 * It mints its own rows (RRA-prefixed) and its teardown deletes exactly those.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'refund_recipient_attribution_test' });
const PG = PG_TARGET.connectionString;
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('RRA REFUSED: non-loopback PostgreSQL target'); process.exit(1);
}

const { supabaseAdmin, isLivePostgres } = require('./src/supabase');
if (process.env.SUPABASE_URL && !LOOPBACK.test(new URL(process.env.SUPABASE_URL).hostname)) {
  console.error('RRA REFUSED: SUPABASE_URL points to a non-loopback host ('
    + new URL(process.env.SUPABASE_URL).hostname + `) while the assertion handle reads `
    + `${PG_TARGET.host}. That is the split-target class (#283): the refund would be booked in one `
    + 'store and asserted in another. Run through scripts/with_local_target.js.');
  process.exit(1);
}

const SERVER_FILE = path.join(__dirname, 'src', 'server.js');
const MIGRATION_039 = path.join(__dirname, '..', 'supabase', 'migrations',
  '039_atomic_double_entry_capture_and_refund.sql');
const STAMP = Date.now();
const AMOUNT = 400;
// The account the unfixed route names when it cannot resolve a recipient.
const FIXTURE_RECIPIENT = '00000000-0000-0000-0000-000000000002';
const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';
// Long enough for the async bus listener to land its row. GROUP B is waited out with the same helper,
// so the positive case proves the window was sufficient instead of letting a slow bus look like a fix.
const BUS_WAIT_MS = 6000;

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 260)}` : ''));
}

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        resolve({ status: res.statusCode, data: parsed, raw: data });
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  check('RRA-00', 'suite runs against the live PostgreSQL target (a mirror cannot prove durability)',
    isLivePostgres === true && !!supabaseAdmin,
    { isLivePostgres, declaredBy: PG_TARGET.source, host: PG_TARGET.host, database: PG_TARGET.database });
  if (!isLivePostgres || !supabaseAdmin) {
    console.log(`\n=== REFUND RECIPIENT ATTRIBUTION TEST: 0/${results.length || 1} passed, 1 failed ===`);
    process.exitCode = 1;
    return;
  }

  const c = new Client({ connectionString: PG });
  await c.connect();
  const one = async (sql, p) => (await c.query(sql, p)).rows[0];
  const WHERE = await one('SELECT current_schema() AS schema, inet_server_addr()::text AS server, '
    + 'inet_server_port() AS port');
  console.log(`TARGET: declared by ${PG_TARGET.source} -> ${PG_TARGET.host}:${PG_TARGET.port}/`
    + `${PG_TARGET.database}, assertion handle searches schema "${WHERE.schema}", write handle is `
    + `SUPABASE_URL ${process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : '(unset)'}`);

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);
  const owned = { users: [], payments: [] };
  let proc = null;

  async function bootServer() {
    const p = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname, stdio: 'ignore', detached: true, windowsHide: true,
      env: {
        ...process.env, PORT: String(port),
        NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0',
      },
    }));
    p.unref();
    for (let i = 0; i < 180; i++) {
      await sleep(500);
      try { const h = await request('GET', '/api/health'); if (h.status === 200) return p; } catch { /* not up */ }
    }
    return p;
  }

  async function stopProc(p) {
    if (!p || !p.pid) return;
    try {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: 'ignore' });
      } else { p.kill('SIGTERM'); }
    } catch { /* already gone */ }
  }

  async function mkCustomer(label) {
    const { data, error } = await supabaseAdmin.from('users').insert({
      phone: `86${String(STAMP).slice(-8)}${label}`, name: `RRA ${label} customer ${STAMP}`,
      wallet_balance: 0
    }).select('id').single();
    if (error) throw new Error(`user insert ${label}: ${error.message}`);
    owned.users.push(data.id);
    return data.id;
  }

  async function mkPayment(id, customerId) {
    const { error } = await supabaseAdmin.from('payments').insert({
      payment_id: id, amount: AMOUNT, currency: 'INR', method: 'UPI', status: 'CAPTURED',
      customer_id: customerId, gateway_order_id: `order_${id}`, created_at: new Date().toISOString()
    });
    if (error) throw new Error(`payment insert ${id}: ${error.message}`);
    owned.payments.push(id);
    return id;
  }

  // The durable question: does a notifications row exist that announces THIS refund, and to whom?
  // The writer fills both `user_id` (sender) and `recipient_user_id`, and the bus passes only a
  // recipient, so both columns land on the same account — read them both rather than guessing which
  // one a future refactor keeps.
  const notifRows = async (paymentId) => (await c.query(
    `SELECT id, user_id::text uid, recipient_user_id::text rid, title, body FROM notifications
      WHERE data->>'paymentId' = $1 AND notification_type = 'REFUND_PROCESSED'`,
    [paymentId])).rows;
  const addressedTo = (row) => [row.uid, row.rid].filter(Boolean);
  const anyRowTold = (rows, uuid) => rows.filter(r => addressedTo(r).includes(uuid));
  const paymentState = async (id) => one(
    'SELECT status, refunded_amount::text r, customer_id::text cid FROM payments WHERE payment_id=$1', [id]);

  try {
    proc = await bootServer();
    const login = await request('POST', '/api/admin/login',
      { username: ADMIN_USER, password: ADMIN_PASSWORD });
    let token = login.data && login.data.token;
    if (!token) {
      await request('POST', '/api/admin/bootstrap', { bootstrapSecret: BOOTSTRAP_SECRET,
        username: ADMIN_USER, password: ADMIN_PASSWORD, name: 'RRA bootstrap admin' });
      const again = await request('POST', '/api/admin/login',
        { username: ADMIN_USER, password: ADMIN_PASSWORD });
      token = again.data && again.data.token;
    }
    check('RRA-01', 'a finance.refund admin session exists on the booted backend', !!token,
      { status: login.status });
    if (!token) throw new Error('no admin token; refusing to assert against a route that cannot be reached');

    // ===================================== 1. the refund source answers no recipient
    // Read the DEFINED body, not a fixed window: `AS $function$ … $function$` brackets it, so the
    // first delimiter after the CREATE line opens it and the next closes it. An empty slice would
    // make "the RPC answers no userId" true by accident, so the size of the body is asserted first.
    const rpcSrc = fs.readFileSync(MIGRATION_039, 'utf8');
    const defIdx = rpcSrc.indexOf('CREATE OR REPLACE FUNCTION public.refund_payment_atomic');
    const openIdx = rpcSrc.indexOf('$function$', defIdx);
    const closeIdx = rpcSrc.indexOf('$function$', openIdx + 10);
    const refundFn = defIdx >= 0 && openIdx > defIdx && closeIdx > openIdx
      ? rpcSrc.slice(openIdx, closeIdx) : '';
    check('RRA-02a', 'the refund function body was located and read (the pin is not vacuous)',
      refundFn.length > 2000 && /RETURN json_build_object/.test(refundFn), { chars: refundFn.length });
    check('RRA-02', 'refund_payment_atomic returns no user identity of any kind, so the route cannot take a recipient from it',
      !/userId/i.test(refundFn) && !/user_id/i.test(refundFn),
      { successReturn: (refundFn.match(/RETURN json_build_object\(\s*'success', true[\s\S]{0,320}/) || [''])[0].replace(/\s+/g, ' ').trim().slice(0, 240) });

    // ============================ 2. an unattributable refund notifies nobody (the defect)
    // A captured payment with NO customer on the row and no job passed by the caller: this is exactly
    // the state in which the unfixed route reaches for the seeded fixture.
    const orphan = await mkPayment(`pay_rra_orphan_${STAMP}`, null);
    const orphanState0 = await paymentState(orphan);
    const rOrphan = await request('POST', '/api/admin/finance/refund', {
      paymentId: orphan, reason: 'RRA unattributable refund', ticketId: `TKT-RRA-ORPHAN-${STAMP}`,
      idempotencyKey: `rra-orphan:${STAMP}` }, { Authorization: `Bearer ${token}` });
    const orphanState1 = await paymentState(orphan);
    check('RRA-03', 'the fixture payment really is durable and carries no customer',
      orphanState0 && orphanState0.status === 'CAPTURED' && orphanState0.cid === null,
      { durable: orphanState0 });
    check('RRA-04', 'the refund itself still succeeds and is booked durably (the money leg is untouched)',
      rOrphan.status === 200 && orphanState1 && orphanState1.status === 'REFUNDED'
        && Number(orphanState1.r) === AMOUNT,
      { status: rOrphan.status, durable: orphanState1 });
    await sleep(BUS_WAIT_MS);
    const orphanRows = await notifRows(orphan);
    check('RRA-05', 'nobody is notified about a refund whose customer cannot be determined',
      orphanRows.length === 0, { rows: orphanRows.map(r => addressedTo(r)) });
    check('RRA-06', `and specifically the seeded fixture ${FIXTURE_RECIPIENT.slice(0, 13)}… was not told`,
      anyRowTold(orphanRows, FIXTURE_RECIPIENT).length === 0,
      { addressedTo: orphanRows.map(r => addressedTo(r)) });

    // ==================== 3. a caller cannot aim the fallback through an unrelated jobId
    const orphan2 = await mkPayment(`pay_rra_orphan2_${STAMP}`, null);
    await request('POST', '/api/admin/finance/refund', {
      paymentId: orphan2, jobId: 'job_not_in_this_store', reason: 'RRA mirror-branch probe',
      ticketId: `TKT-RRA-ORPHAN2-${STAMP}`, idempotencyKey: `rra-orphan2:${STAMP}` },
      { Authorization: `Bearer ${token}` });
    await sleep(BUS_WAIT_MS);
    const orphan2Rows = await notifRows(orphan2);
    check('RRA-07', 'an unknown jobId in the request body does not resurrect a recipient',
      anyRowTold(orphan2Rows, FIXTURE_RECIPIENT).length === 0,
      { addressedTo: orphan2Rows.map(r => addressedTo(r)) });

    // ==================== 4. an attributed refund still reaches its own customer (not over-broad)
    const owner = await mkCustomer('own');
    const attributed = await mkPayment(`pay_rra_attr_${STAMP}`, owner);
    const rAttr = await request('POST', '/api/admin/finance/refund', {
      paymentId: attributed, reason: 'RRA attributed refund', ticketId: `TKT-RRA-ATTR-${STAMP}`,
      idempotencyKey: `rra-attr:${STAMP}` }, { Authorization: `Bearer ${token}` });
    const attrState = await paymentState(attributed);
    await sleep(BUS_WAIT_MS);
    const attrRows = await notifRows(attributed);
    check('RRA-08', 'the attributed refund was booked durably', rAttr.status === 200
      && attrState && attrState.status === 'REFUNDED' && Number(attrState.r) === AMOUNT,
      { status: rAttr.status, durable: attrState });
    check('RRA-09', 'the customer on the payment row was notified, exactly once',
      attrRows.length === 1 && addressedTo(attrRows[0]).includes(owner),
      { rows: attrRows.map(r => addressedTo(r)), owner });
    check('RRA-10', 'and the notification was NOT copied to the seeded fixture account',
      anyRowTold(attrRows, FIXTURE_RECIPIENT).length === 0,
      { addressedTo: attrRows.map(r => addressedTo(r)) });
    // GROUP A's zero is only meaningful if the bus is demonstrably live and the wait was long enough.
    check('RRA-11', 'the bus is proven live, so the empty result in GROUP 2 is a refusal and not a race',
      attrRows.length === 1, { notifiedRows: attrRows.length });

    // ======================================= 5. the substitution is gone, not hidden
    const src = fs.readFileSync(SERVER_FILE, 'utf8');
    const routeFrom = src.indexOf("app.post('/api/admin/finance/refund'");
    const window = routeFrom >= 0 ? src.slice(routeFrom, src.indexOf('\n  return res.status(500)', routeFrom)) : '';
    check('RRA-12', 'the refund route window is readable (the pin is not vacuous)',
      window.length > 800, { chars: window.length });
    check('RRA-13', "no fixture customer is substituted for an unresolvable refund recipient",
      !/resolveCustomerUserUuid\('usr_2'\)/.test(src) && !/00000000-0000-0000-0000-000000000002/.test(window),
      { occurrences: (src.match(/resolveCustomerUserUuid\('usr_2'\)/g) || []).length });
    check('RRA-14', 'the unresolvable case is recorded as a skip, not swallowed silently',
      /NOTIF_BUS_SKIPPED/.test(window), { hit: /NOTIF_BUS_SKIPPED/.test(window) });
    check('RRA-15', 'the legitimate attribution read (payments.customer_id) was kept',
      /customer_id/.test(window) && /from\('payments'\)/.test(window));
    check('RRA-16', 'the legacy-id map still exists for callers that genuinely pass usr_2',
      /const LEGACY_CUSTOMER_MAP = \{/.test(src), undefined);
  } finally {
    await stopProc(proc);
    const sweep = [];
    for (const id of owned.payments) {
      const r = await c.query('DELETE FROM notifications WHERE data->>' + "'paymentId'" + '=$1', [id])
        .catch(() => null);
      sweep.push(`notif(${id.slice(0, 18)}) deleted=${r ? r.rowCount : 'error'}`);
    }
    // Append-only financial rows are retained, not deleted — the keep rule the money suites apply.
    // Deleting a payment would strand the journal posting and the refund authorization that name it.
    sweep.push(`payments RETAINED (${owned.payments.length})`);
    for (const u of owned.users) {
      const hist = await one('SELECT count(*) n FROM journal_lines WHERE entity_id=$1::text', [u]);
      if (Number(hist.n) > 0) { sweep.push(`user ${u.slice(0, 8)} RETAINED (lines=${hist.n})`); continue; }
      try { const r = await c.query('DELETE FROM users WHERE id=$1::uuid', [u]); sweep.push(`user deleted=${r.rowCount}`); }
      catch (e) { sweep.push(`user ${u.slice(0, 8)} RETAINED (${e.message.split('\n')[0].slice(0, 50)})`); }
    }
    const leftovers = await one(`SELECT
        (SELECT count(*) FROM notifications WHERE data->>'paymentId' LIKE '%${STAMP}') notif_rows,
        (SELECT count(*) FROM payments WHERE payment_id LIKE 'pay_rra_%${STAMP}') payments,
        (SELECT count(*) FROM users WHERE name LIKE 'RRA % customer ${STAMP}') users`);
    console.log('  cleanup -> ' + sweep.join(' | '));
    console.log(`  RRA residue after cleanup: ${JSON.stringify(leftovers)}`);
    await c.end();
    reapSpawnedServers();
  }

  const failed = results.filter(r => !r.pass);
  console.log(`\n=== REFUND RECIPIENT ATTRIBUTION TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ===`);
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
})().catch(e => {
  console.error('FATAL', e.message);
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== REFUND RECIPIENT ATTRIBUTION TEST: ${results.length - failed.length}/${results.length} passed, ${failed.length + 1} failed ===`);
  process.exitCode = 1;
});
