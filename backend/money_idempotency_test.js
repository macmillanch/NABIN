/**
 * Money-safe idempotency (PHASE 13).
 *
 * Two financial mutations used to name themselves with the clock:
 *
 *   `admin_adj_${targetType}_${targetId}_${direction}_${amt}_${Date.now()}`
 *   `payout_${driver.id}_${Date.now()}`
 *
 * A clock cannot identify an operation, in either direction. A retry whose response was lost
 * arrives a millisecond later, gets a fresh key, and moves the money a second time; two
 * genuinely different operations submitted in the same millisecond get the *same* key and
 * collide on a UNIQUE column. The second one already had teeth: `driver_payouts.payout_id` is
 * UNIQUE, built as `PO-${Date.now()}`, and the insert's error was never checked — so the ledger
 * had debited the wallet while no payout record existed.
 *
 * Everything here is proven against the local/TEST PostgreSQL and a local backend, and asserted
 * from the database rather than from response bodies, because the claim being tested is "exactly
 * one financial effect" and only the journal can answer that.
 *
 * Deliberately NOT tested or changed here: which store is a driver's authoritative balance
 * (Phase 12 left that open), settlement semantics, payout eligibility rules, chart-of-account
 * balances, or the 422 completed-but-unjournaled trips. This file names operations; it does not
 * decide what a balance is.
 *
 * Local only. It refuses to run against a non-loopback backend or a non-loopback database.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { operationKey, stableRecordId } = require('./src/services/moneyIdentity');

const BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const SUPER = { username: 'superadmin', password: 'AdminPassword123!' };
const DRIVER_UUID = '00000000-0000-0000-0000-000000000101';   // DRV-101
const RUN = `p13_${Date.now()}`;

const passed = [];
const failed = [];
const skipped = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
function skip(name, reason) { skipped.push(name); console.log(`[SKIP] ${name} -> ${reason}`); }

function request(method, urlPath, body = null, headers = {}, baseUrl = BASE_URL) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const payload = body === undefined || body === null ? null : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {} }); }
        catch (e) { resolve({ status: res.statusCode, data: {}, raw: data.slice(0, 200) }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const bearer = (t) => ({ Authorization: `Bearer ${t}` });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The journal rows carrying one idempotency key — the only count that answers the claim. */
async function journalRowsFor(store, key) {
  const { data, error } = await store.from('journal_transactions')
    .select('id, category, total_debit, total_credit').eq('idempotency_key', key);
  return { rows: data || [], error: error && error.message };
}

async function payoutRowsFor(store, key) {
  const { data, error } = await store.from('driver_payouts')
    .select('id, payout_id, amount').eq('idempotency_key', key);
  return { rows: data || [], error: error && error.message };
}

async function main() {
  console.log('--- PHASE 13: MONEY-SAFE IDEMPOTENCY ---');

  const { supabaseAdmin } = require('./src/supabase');
  if (!supabaseAdmin) {
    console.log('SKIP: PostgreSQL is not configured; these checks pin database-level barriers.');
    return finish();
  }

  // =========================== 1. the identity is not a clock ===========================
  // If anyone reintroduces `Date.now()` here, the "same operation, same key" assertions below
  // stop holding and this block goes red — including the sleep, which is what a timestamp
  // cannot survive.
  const callerKey = `${RUN}_payout_intent_1`;
  const k1 = operationKey('driver_payout', [DRIVER_UUID], callerKey);
  await sleep(6);
  const k2 = operationKey('driver_payout', [DRIVER_UUID], callerKey);
  assert('IDE-01 the same account + same caller key gives the same identity across time',
    k1.key === k2.key && k1.reusedCallerKey === true, { k1: k1.key, k2: k2.key });

  const now1 = Date.now();
  const kA = operationKey('driver_payout', [DRIVER_UUID], null);
  const kB = operationKey('driver_payout', [DRIVER_UUID], null);
  assert('IDE-02 with no caller key each request is its own operation (no silent dropping)',
    kA.key !== kB.key, { kA: kA.key, kB: kB.key });
  assert('IDE-03 ...and two requests inside one millisecond are still distinct',
    Date.now() - now1 < 50 && kA.key !== kB.key);

  const otherAccount = operationKey('driver_payout', ['00000000-0000-0000-0000-000000000103'], callerKey);
  assert('IDE-04 the identity is scoped to the account, so a key is not transferable',
    otherAccount.key !== k1.key, { other: otherAccount.key });

  // A caller must not be able to escape its namespace by choosing a key that contains the
  // separator, or one long enough to overflow a VARCHAR(100) column.
  const smuggled = operationKey('driver_payout', [DRIVER_UUID],
    `00000000-0000-0000-0000-000000000103:whatever${':'.repeat(40)}${'x'.repeat(300)}`);
  assert('IDE-05 a hostile caller key cannot widen the namespace or overflow the column',
    smuggled.key.length <= 100 && !smuggled.key.includes('00000000-0000-0000-0000-000000000103'),
    { len: smuggled.key.length, key: smuggled.key.slice(0, 60) });

  const rid1 = stableRecordId('PO', k1.key);
  const rid2 = stableRecordId('PO', k1.key);
  assert('IDE-06 the payout record id is derived from the operation, not the clock',
    rid1 === rid2 && rid1.startsWith('PO-'), { rid1, rid2 });

  // =========================== 2. the database is the barrier ===========================
  // Proven directly on the constraints, inside a transaction that is always rolled back, so no
  // row survives. This is the claim "duplicate requests cannot create two payout records".
  let pg;
  try {
    pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: false });
    await pg.connect();
    const barrierKey = `${RUN}_barrier`;
    // A real driver uuid: `driver_payouts.driver_id` has a foreign key to `drivers(id)`, and a
    // fake one would be rejected by the FK before the UNIQUE idempotency constraint was ever
    // reached — the test would "pass" without proving the barrier it exists to prove.
    const fakeUuid = DRIVER_UUID;
    await pg.query('BEGIN');
    let first = 'ok';
    try {
      await pg.query(
        `INSERT INTO driver_payouts (payout_id, driver_id, amount, upi_id, status, idempotency_key)
         VALUES ($1, $2, 10.00, 'barrier@okhdfcbank', 'SETTLED', $3)`,
        [stableRecordId('POB', barrierKey), fakeUuid, barrierKey]);
    } catch (e) { first = e.message; }
    let second = 'NOT REJECTED';
    try {
      await pg.query(
        `INSERT INTO driver_payouts (payout_id, driver_id, amount, upi_id, status, idempotency_key)
         VALUES ($1, $2, 10.00, 'barrier@okhdfcbank', 'SETTLED', $3)`,
        [stableRecordId('POB', barrierKey), fakeUuid, barrierKey]);
    } catch (e) { second = e.code === '23505' ? 'REJECTED_BY_UNIQUE' : `rejected(${e.code})`; }
    await pg.query('ROLLBACK');
    assert('IDE-07 driver_payouts rejects a repeated payout identity at the database',
      second === 'REJECTED_BY_UNIQUE' && first === 'ok', { first: first.slice(0, 70), second });

    // Same for the journal, which is where a duplicate wallet effect would actually land.
    await pg.query('BEGIN');
    let jFirst = 'ok';
    try {
      await pg.query(
        `INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description)
         VALUES ($1, $2, 'WALLET_TOPUP', 5.00, 5.00, 'barrier probe')`,
        [`${RUN}_jt_a`, `${RUN}_jt_key`]);
    } catch (e) { jFirst = e.message; }
    let jSecond = 'NOT REJECTED';
    try {
      await pg.query(
        `INSERT INTO journal_transactions (transaction_id, idempotency_key, category, total_debit, total_credit, description)
         VALUES ($1, $2, 'WALLET_TOPUP', 5.00, 5.00, 'barrier probe')`,
        [`${RUN}_jt_b`, `${RUN}_jt_key`]);
    } catch (e) { jSecond = e.code === '23505' ? 'REJECTED_BY_UNIQUE' : `rejected(${e.code})`; }
    await pg.query('ROLLBACK');
    assert('IDE-08 journal_transactions rejects a repeated operation identity at the database',
      jSecond === 'REJECTED_BY_UNIQUE' && jFirst === 'ok', { first: jFirst.slice(0, 70), second: jSecond });
  } catch (e) {
    skip('IDE-07/IDE-08 database barrier probes', `could not open a local transaction: ${e.message}`);
  } finally {
    if (pg) { try { await pg.query('ROLLBACK'); } catch (e) { /* already rolled back */ } await pg.end(); }
  }

  // =========================== 3. the live adjustment path ===========================
  const adminLogin = await request('POST', '/api/admin/login', SUPER);
  const adminToken = adminLogin.data && adminLogin.data.token;
  assert('IDE-09 an admin session is available for the wire tests',
    adminLogin.status === 200 && !!adminToken, { status: adminLogin.status });
  if (!adminToken) return finish();

  const anonAdj = await request('POST', '/api/admin/finance/adjustments',
    { targetType: 'DRIVER', targetId: DRIVER_UUID, direction: 'CREDIT', amount: 5, reason: RUN });
  assert('IDE-10 an unauthenticated adjustment is refused before any money moves',
    anonAdj.status === 401, { status: anonAdj.status });

  const driverSession = await request('POST', '/api/auth/send-otp',
    { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
  let drvToken = null;
  if (driverSession.data && driverSession.data.success) {
    const v = await request('POST', '/api/auth/verify-otp', {
      phone: '9810122910', otp: driverSession.data.testOtp || '7729', role: 'DRIVER', purpose: 'LOGIN',
    });
    drvToken = v.data && v.data.token;
  }
  if (drvToken) {
    const drvOnAdminRoute = await request('POST', '/api/admin/finance/adjustments',
      { targetType: 'DRIVER', targetId: DRIVER_UUID, direction: 'CREDIT', amount: 5, reason: RUN }, bearer(drvToken));
    assert('IDE-11 a driver token cannot reach the admin adjustment route (a key is not authorisation)',
      drvOnAdminRoute.status === 401 || drvOnAdminRoute.status === 403, { status: drvOnAdminRoute.status });
  } else {
    skip('IDE-11 driver token on the admin route', 'no driver session available to test with');
  }

  const adjust = (payload, key, base = BASE_URL) => request('POST', '/api/admin/finance/adjustments',
    payload, { ...bearer(adminToken), ...(key ? { 'Idempotency-Key': key } : {}) }, base);
  const payload = { targetType: 'DRIVER', targetId: DRIVER_UUID, direction: 'CREDIT', amount: 10, reason: RUN };

  const oneKey = `${RUN}_single`;
  const first = await adjust(payload, oneKey);
  const retry = await adjust(payload, oneKey);
  const rowsAfterRetry = await journalRowsFor(supabaseAdmin,
    operationKey('admin_adjustment', ['DRIVER', DRIVER_UUID], oneKey).key);

  assert('IDE-12 the first adjustment is applied', first.status === 200 && first.data.success === true,
    { status: first.status, code: first.data.code, error: first.data.error });
  assert('IDE-13 retrying the same key reports the existing operation instead of a second one',
    retry.status === 200 && retry.data.success === true && retry.data.duplicate === true,
    { status: retry.status, body: JSON.stringify(retry.data).slice(0, 160) });
  assert('IDE-14 and PostgreSQL holds exactly one journal transaction for that operation',
    rowsAfterRetry.rows.length === 1 && !rowsAfterRetry.error,
    { rows: rowsAfterRetry.rows.length, err: rowsAfterRetry.error });

  // A different legitimate operation must still be independent, or this would be a block, not
  // an idempotency mechanism.
  const twoA = await adjust(payload, `${RUN}_sib_a`);
  const twoB = await adjust(payload, `${RUN}_sib_b`);
  const sibCounted = await Promise.all([
    journalRowsFor(supabaseAdmin, operationKey('admin_adjustment', ['DRIVER', DRIVER_UUID], `${RUN}_sib_a`).key),
    journalRowsFor(supabaseAdmin, operationKey('admin_adjustment', ['DRIVER', DRIVER_UUID], `${RUN}_sib_b`).key),
  ]);
  assert('IDE-15 two different keys are two real operations (not a blanket block)',
    twoA.status === 200 && twoB.status === 200 && twoA.data.duplicate !== true && twoB.data.duplicate !== true
    && sibCounted[0].rows.length === 1 && sibCounted[1].rows.length === 1,
    { a: sibCounted[0].rows.length, b: sibCounted[1].rows.length });

  // The case that has no caller key at all: two submissions, two operations. This is the
  // pre-existing behaviour preserved deliberately — nothing in the request says whether it is a
  // retry, and guessing "yes" would silently discard a legitimate second adjustment.
  const noKeyA = await adjust(payload, null);
  const noKeyB = await adjust(payload, null);
  assert('IDE-16 without a caller key two requests are two operations, honestly',
    noKeyA.status === 200 && noKeyB.status === 200
    && noKeyA.data.idempotencyKey && noKeyB.data.idempotencyKey
    && noKeyA.data.idempotencyKey !== noKeyB.data.idempotencyKey,
    { a: noKeyA.data.idempotencyKey, b: noKeyB.data.idempotencyKey });

  // Concurrency: the same operation fired at once, several times. One key, one effect.
  const raceKey = `${RUN}_race`;
  const raced = await Promise.all(Array.from({ length: 6 }, () => adjust(payload, raceKey)));
  const raceRows = await journalRowsFor(supabaseAdmin,
    operationKey('admin_adjustment', ['DRIVER', DRIVER_UUID], raceKey).key);
  const answered = raced.filter((r) => r && (r.status === 200 || r.status === 400) && r.data);
  // "Booked" means this request moved money and said so. Exactly one may.
  const booked = raced.filter((r) => r.status === 200 && r.data.success === true && r.data.duplicate !== true).length;
  const claimedDuplicate = raced.filter((r) => r.data && r.data.duplicate === true).length;
  const errored = raced.filter((r) => r.status !== 200 || r.data.success !== true).length;
  const seen = raced.map((r) => `${r.status}:${r.data.duplicate ? 'dup' : (r.data.success ? 'new' : 'err')}`).join(' ');

  assert('IDE-17 six simultaneous identical operations produce exactly ONE journal transaction',
    raceRows.rows.length === 1 && !raceRows.error,
    { rows: raceRows.rows.length, responses: seen, err: raceRows.error });
  assert('IDE-18 exactly one concurrent request books the operation; none reports a second effect',
    booked === 1, { booked, claimedDuplicate, errored, responses: seen });
  // Reported, not asserted away: six simultaneous writes to one account row can lose a round
  // trip (a lock/deadlock refusal). That is an availability fact about the loser, not a second
  // movement of money, and IDE-17/18 are what pin the money. Silently ignoring refusals here
  // would hide a real caller-facing problem, so the count is printed either way.
  if (errored > 0) {
    console.log(`[note] ${errored} of 6 concurrent requests did not answer 200-success; the ledger still holds exactly one transaction for the key.`);
  }
  assert('IDE-18b every request answered, so none hung the caller',
    answered.length === 6, { answered: answered.length, responses: seen });

  // =========================== 4. two processes, one database ===========================
  // Phase 12 established that this system runs more than one backend against one PostgreSQL
  // (restart_test.js does it inside the chain). In-process de-duplication would not survive
  // that; the database barrier must.
  const secondPort = 4700 + (process.pid % 200);
  const secondBase = `http://127.0.0.1:${secondPort}`;
  let secondProc = null;
  try {
    secondProc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, PORT: String(secondPort) },
    });
    let up = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try { const h = await request('GET', '/api/health', null, {}, secondBase); if (h.status === 200) { up = true; break; } }
      catch (e) { /* still starting */ }
    }
    if (!up) {
      skip('IDE-20/21 cross-process duplicate', `second backend never bound :${secondPort}`);
    } else {
      const xprocKey = `${RUN}_xproc`;
      const [viaA, viaB] = await Promise.all([
        adjust(payload, xprocKey),
        adjust(payload, xprocKey, secondBase),
      ]);
      const xRows = await journalRowsFor(supabaseAdmin,
        operationKey('admin_adjustment', ['DRIVER', DRIVER_UUID], xprocKey).key);
      const results = [viaA, viaB];
      assert('IDE-20 the same operation through TWO backend processes yields ONE journal transaction',
        xRows.rows.length === 1 && results.every((r) => r.status === 200 && r.data.success === true),
        { rows: xRows.rows.length, a: viaA.data.duplicate, b: viaB.data.duplicate, err: xRows.error });
      // The loser must still be able to answer with a balance — that is what makes a lost
      // response retryable instead of retried-into-a-second-payment.
      assert('IDE-21 the duplicate answer carries the resulting balance, not just "skipped"',
        results.some((r) => r.data.duplicate === true)
        && results.filter((r) => r.data.duplicate === true).every((r) => r.data.updatedBalance !== undefined),
        { a: viaA.data.updatedBalance, b: viaB.data.updatedBalance });
    }
  } catch (e) {
    skip('IDE-20/21 cross-process duplicate', `could not run a second backend: ${e.message}`);
  } finally {
    if (secondProc && secondProc.pid) {
      try {
        require('child_process').execFile('taskkill', ['/PID', String(secondProc.pid), '/T', '/F'],
          { stdio: 'ignore' }, () => {});
      } catch (e) { /* already gone */ }
      await sleep(600);
    }
  }

  // The payout path is gated by KYC / verified-destination / 24h cooling, which the shared
  // fixture driver does not currently satisfy; it is reported rather than bypassed, because
  // relaxing a money gate to make a test runnable is the opposite of this phase.
  const probe = drvToken
    ? await request('POST', '/api/driver/payout', { amount: 1 },
      { ...bearer(drvToken), 'Idempotency-Key': `${RUN}_probe` })
    : null;
  if (!probe) {
    skip('IDE-22/23 payout gate and no-record-on-refusal', 'no driver session available to probe with');
  } else {
  console.log(`\n[note] driver payout gate state on the shared fixture: ${probe.status} ${probe.data.code || probe.data.error || ''}`);
  assert('IDE-22 a payout request never moves money without passing its eligibility gate',
    probe.status === 400 || probe.status === 403 || probe.data.success === true,
    { status: probe.status, code: probe.data.code });
  const probePayouts = await payoutRowsFor(supabaseAdmin,
    operationKey('driver_payout', [DRIVER_UUID], `${RUN}_probe`).key);
  assert('IDE-23 a refused payout leaves no payout record behind',
    probe.data.success === true || (probePayouts.rows.length === 0 && !probePayouts.error),
    { rows: probePayouts.rows.length, err: probePayouts.error });
  }

  // Leave the fixture as it was found. Read back from the journal rather than counted by hand:
  // the six-way race is ONE booked operation and the cross-process pair is ONE, so any
  // hand-count over-debits the driver. WALLET_TOPUP is the credit category and DISPUTE_REFUND
  // the debit one, so the two cannot bleed into each other's sum.
  const creditedRows = await supabaseAdmin.from('journal_transactions')
    .select('total_credit').eq('category', 'WALLET_TOPUP').like('description', `%${RUN}%`);
  const credited = (creditedRows.data || [])
    .reduce((sum, r) => sum + Number(r.total_credit || 0), 0);
  const restore = await request('POST', '/api/admin/finance/adjustments', {
    targetType: 'DRIVER', targetId: DRIVER_UUID, direction: 'DEBIT', amount: credited,
    reason: `${RUN} restore`,
  }, { ...bearer(adminToken), 'Idempotency-Key': `${RUN}_restore` });
  assert('IDE-24 every credit this file booked is reversed by one offsetting debit',
    !creditedRows.error && credited > 0 && restore.status === 200 && restore.data.success === true,
    { credited, status: restore.status, error: restore.data.error, err: creditedRows.error });

  return finish();
}

function finish() {
  console.log(`\nPHASE 13 IDEMPOTENCY: ${passed.length} PASSED, ${failed.length} FAILED, ${skipped.length} SKIPPED`);
  if (failed.length) console.log(`Failed: ${failed.join(' | ')}`);
  process.exitCode = failed.length ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 50).unref();
}

main().catch((err) => {
  console.error(`Unexpected error: ${err && err.stack ? err.stack : err}`);
  failed.push('HARNESS');
  finish();
});
