'use strict';
// =========================================================================
// LEDGER WRITE GUARD (local only, writes nothing)
//
// The double-entry books are the one place where a wrong answer is worse than no
// answer: a posting the database refused, reported as booked, is money that does
// not exist.
//
// `LedgerRepository.recordDoubleEntry` (src/repositories/LedgerRepository.js) used to insert
// the `journal_transactions` header and then treat the answer this way:
//
//     if (jtErr && jtErr.code === '23505' && idempotencyKey) { return { duplicate: true, ... }; }
//     if (!jtErr && jtData && jtData.id) { await supabaseAdmin.from('journal_lines').insert([...]); }
//   } catch (err) { console.warn('Supabase journal insert notice:', err.message); }
//   this.db.ledgerEntries.unshift(entry);
//   return entry;                       // entry.status === 'POSTED'
//
// supabase-js resolves `{data, error}` for a PostgreSQL refusal, so every engine
// decision except that one idempotency-key collision falls through to the last two
// lines: an unmigrated schema (42P01), a dangling `job_id` (23503), an exceeded
// VARCHAR(80) `transaction_id` (22001) and a `transaction_id` collision (23505 with
// no key — which is exactly what a re-run settlement produces, because the
// settlement ids are deterministic: `RIDE-SETTLEMENT-<ref>-COMMISSION`) all end in a
// mirror entry that says POSTED. The `journal_lines` insert is awaited and its
// result never read, so a header whose legs were refused is also reported as a
// balanced posting.
//
// `NabinDatabase.recordLedgerEntry` (src/database.js) then caught and warned on anything the
// repository did throw, and mirrored a second time:
//
//     } catch (e) { console.warn('ledgerRepo.recordDoubleEntry notice:', e.message); }
//     this.ledgerEntries.unshift(entry); this.save(); return entry;
//
// Both of the platform's callers believed that answer. `updateJobStatus` booked the trip
// COMPLETED and returned the job, so the driver's earnings and the rider's receipt were
// reported from a ledger row that was never written, and `PaymentRepository`'s capture and
// webhook paths did the same. The settlement path already stated the intended rule, in the
// guard that protects the money transition 40 lines earlier: "A persistence write that the
// database rejected must abort the settlement instead of silently proceeding on
// in-memory state and desynchronising the ledger" (src/database.js:4380-4385).
//
// RED baseline, measured before the fix landed: 6/18 passed. LWG-01..04, 05, 07, 08, 09,
// 11, 15, 16 and 17 failed — each of 42P01, 23503, 22001 and a dead socket answered
// {"threw":false,"mirrorNew":1,"returned":{"status":"POSTED"}}.
//
// Fix, in the platform's existing vocabulary: a store refusal is marked with
// `storeFailure` plus the engine's own `code` and the engine's sentence on `details`
// (src/repositories/PaymentRepository.js:25-35), the mirror is never written for a
// posting that did not land, and the routes hand the error to the one classifier
// that decides 503 vs 409 vs 500 (`replyStoreError`, src/server.js:347).
//
// The two durable answers stay durable-shaped: a UNIQUE collision on
// `journal_transactions` (its only two unique constraints are `transaction_id` and
// `idempotency_key`, supabase/migrations/002_finance_ledger_schema.sql:36-37) is the
// booking already existing, so it reports `duplicate` and moves nothing; a store that
// is simply gone is an outage, and it fails.
//
// Evidence: the store's answer is faked at the wire in the exact shape supabase-js
// produces for each SQLSTATE, because a genuine refusal of a specific constraint
// cannot be provoked against a store this suite is not allowed to write to. Nothing
// is persisted: the client points at a closed port, `db.save` becomes a no-op, and no
// HTTP request is made. The positive controls (LWG-12, LWG-13) are what make the
// refusals meaningful — with the store cooperating, and with no store configured at
// all, the same calls must still post exactly one entry.
// =========================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'ledger_write_guard_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'LedgerRepository.js');
const PAYMENT_REPO_FILE = path.join(__dirname, 'src', 'repositories', 'PaymentRepository.js');
const DB_FILE = path.join(__dirname, 'src', 'database.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

const STAMP = Date.now();
const JOB_UUID = '00000000-0000-4000-8000-000000000001';
const engineText = (s) => /duplicate key value violates|relation "|violates foreign key|value too long for type/.test(String(s || ''));

// ---------------------------------------------------------------- child
async function runChild() {
  const { supabaseAdmin, isLivePostgres, isStoreUnreachable } = require('./src/supabase');
  const db = require('./src/database');

  // One SQLSTATE per faked wire answer, in supabase-js' own shape.
  const ENGINE = {
    '42P01': { code: '42P01', message: 'relation "journal_transactions" does not exist', details: null, hint: null },
    '23503': { code: '23503', message: 'insert or update on table "journal_transactions" violates foreign key constraint "journal_transactions_job_id_fkey"', details: 'Key is not present in table "jobs".', hint: null },
    '23505': { code: '23505', message: 'duplicate key value violates unique constraint "journal_transactions_transaction_id_key"', details: 'Key (transaction_id)=(x) already exists.', hint: null },
    '22001': { code: '22001', message: 'value too long for type character varying(80)', details: null, hint: null },
  };

  const observed = [];
  let recording = false;
  const plan = JSON.parse(process.env.NABIN_LWG_PLAN || '{}');

  function builder(table, kind) {
    const reject = () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
      cause.code = 'ECONNREFUSED';
      cause.syscall = 'connect';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      return Promise.reject(err);
    };
    const mutate = () => {
      if (recording) observed.push(`${table}.write`);
      if (kind === 'fetch') return reject();
      if (kind === 'ok') {
        return Promise.resolve({
          data: table === 'journal_transactions' ? { id: JOB_UUID } : [{}],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: ENGINE[kind] || { code: kind, message: `faked ${kind}` } });
    };
    const self = {};
    ['insert', 'update', 'delete', 'upsert', 'select', 'eq', 'neq', 'or', 'in', 'order', 'limit']
      .forEach((m) => { self[m] = () => self; });
    self.single = mutate;
    self.then = (onOk, onErr) => mutate().then(onOk, onErr);
    return self;
  }
  supabaseAdmin.from = (table) => builder(table, plan[table] || 'ok');

  // No file mirror, and the persisted-state writer becomes a no-op.
  db.save = () => {};
  const mirror = () => (db.ledgerEntries || []).length;

  const outcome = (fn) => Promise.resolve().then(fn).then(
    (value) => ({ threw: false, value }),
    (err) => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      storeFailure: Boolean(err && err.storeFailure),
      unreachable: Boolean(err && isStoreUnreachable(err)),
      message: err && err.message,
      details: err && err.details,
    }));

  const record = async (label, extra) => {
    const before = mirror();
    const out = await outcome(() => db.recordLedgerEntry(Object.assign({
      transactionId: `LWG-${label}-${STAMP}`,
      debitAccount: 'CUSTOMER_WALLET_LIABILITY',
      creditAccount: 'PLATFORM_COMMISSION_REVENUE',
      amount: 149,
      description: 'LWG measured posting',
      referenceId: `LWGREF-${STAMP}`,
      jobId: JOB_UUID,
    }, extra || {})));
    const value = out.threw ? null : out.value;
    return {
      threw: out.threw,
      storeFailure: out.storeFailure,
      code: out.code,
      status: out.status,
      unreachable: out.unreachable,
      leaked: engineText([out.threw ? out.message : '', value ? JSON.stringify(value) : ''].join(' ')),
      reason: String((out.threw ? out.details : '') || ''),
      mirrorNew: mirror() - before,
      returned: value ? { status: value.status, duplicate: value.duplicate, transactionId: value.transactionId } : null,
    };
  };

  const verdict = { live: isLivePostgres === true };

  if (!isLivePostgres) {
    // Offline development has no durable journal at all, so the mirror is the honest answer.
    const once = await record('offline', { idempotencyKey: `LWG:offline:${STAMP}` });
    verdict.offline = once;
    console.log(`LWG_VERDICT ${JSON.stringify(verdict)}`);
    return;
  }

  recording = true;

  // 1. durable refusals of the header, none of them the caller's fault
  for (const kind of ['42P01', '23503', '22001', 'fetch']) {
    plan.journal_transactions = kind;
    plan.journal_lines = kind;
    verdict[`header_${kind}`] = await record(kind, { idempotencyKey: `LWG:${kind}:${STAMP}` });
  }

  // 2. a UNIQUE collision with no idempotency key (the re-run settlement) is a duplicate
  plan.journal_transactions = '23505';
  plan.journal_lines = '23505';
  verdict.collision_no_key = await record('collision-no-key');

  // 3. a UNIQUE collision on the idempotency key is already answered correctly; must stay
  verdict.collision_with_key = await record('collision-key', { idempotencyKey: `LWG:dup:${STAMP}` });

  // 4. the header lands and the legs are refused: a half-posting is not a posting
  plan.journal_transactions = 'ok';
  plan.journal_lines = '23503';
  verdict.lines_refused = await record('lines-refused', { idempotencyKey: `LWG:lines:${STAMP}` });

  // 5. positive control: a cooperating store posts exactly one entry
  plan.journal_transactions = 'ok';
  plan.journal_lines = 'ok';
  verdict.cooperative = await record('cooperative', { idempotencyKey: `LWG:ok:${STAMP}` });

  recording = false;
  verdict.observed = observed.slice();
  console.log(`LWG_VERDICT ${JSON.stringify(verdict)}`);
}

// ------------------------------------------------- settlement child (#280)
// The other half of the same settlement: the driver's wallet credit.
//
// `NabinDatabase.updateJobStatus` treats a rejected `driverRepo.updateEarnings` as a
// notice and carries on:
//
//     try {
//       earnings = (await this.driverRepo.updateEarnings(driver.id, netEarnings, settlementRef)) || earnings;
//     } catch (e) {
//       console.warn('⚠️ driverRepo.updateEarnings notice:', e.message);
//     }
//
// `earnings` then keeps its initial `{duplicate:false, posted:false}`, which is exactly
// the shape the offline-mirror answer has, so the settlement reads the refusal as "no
// durable movement happened, the cache carries it": it posts the NET journal entry the
// refused RPC never booked, adds `netEarnings` to the cached wallet, increments
// todayTrips, writes the TRIP_EARNING transaction row, debits the customer, and returns
// the job COMPLETED. Every one of `updateEarnings`' throws is a deliberate refusal —
// DRIVER_NOT_FOUND (404), MONEY_OPERATION_IDENTITY_REQUIRED (400), DRIVER_NOT_DURABLE
// (400), the idempotency conflict (409), or the wallet RPC's own failure — so the catch
// turns a guard into a bypass.
//
// The wallet RPC's own failure is also unclassified today: `adjustWallet` ends its error
// branch with `throw new Error('PostgreSQL adjust_wallet_atomic failed: …')`, a codeless
// Error, so even once the swallow is removed the completion route cannot tell an outage
// from a business refusal and answers 409 with PostgreSQL's sentence.
const SETTLE_ENGINE = {
  '42P01': { code: '42P01', message: 'relation "ledger_entries" does not exist', details: null, hint: null },
  '23503': { code: '23503', message: 'insert or update on table "ledger_entries" violates foreign key constraint', details: 'Key is not present in table "drivers".', hint: null },
};

async function runSettlementChild() {
  const { supabaseAdmin, isLivePostgres, isStoreUnreachable } = require('./src/supabase');
  const db = require('./src/database');
  const plan = JSON.parse(process.env.NABIN_LWG_SETTLE_PLAN || '{}');
  const rpcPlan = plan.rpc || 'ok';

  const JOURNAL_HEADER_UUID = '00000000-0000-4000-8000-000000000009';
  const calls = [];

  const refusal = (kind) => {
    if (kind === 'fetch') {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
      cause.code = 'ECONNREFUSED';
      cause.syscall = 'connect';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      throw err;
    }
    return { data: null, error: SETTLE_ENGINE[kind] || { code: kind, message: `faked ${kind}` } };
  };

  function builder(table) {
    let mode = 'read';
    const answer = () => {
      if (mode === 'write') {
        calls.push(`${table}.write`);
        if (table === 'journal_transactions' && plan.journal_transactions) return refusal(plan.journal_transactions);
        if (table === 'journal_transactions') return { data: { id: JOURNAL_HEADER_UUID }, error: null };
        return { data: [{}], error: null };
      }
      calls.push(`${table}.read`);
      // A fresh settlement: no operation already booked under this idempotency key.
      return { data: table === 'journal_lines' ? [] : null, error: null };
    };
    const self = {};
    ['eq', 'neq', 'or', 'in', 'order', 'limit'].forEach((m) => { self[m] = () => self; });
    ['insert', 'update', 'delete', 'upsert'].forEach((m) => {
      self[m] = () => { mode = 'write'; return self; };
    });
    self.select = () => self;
    self.single = () => Promise.resolve(mode === 'write' && table === 'journal_transactions' && plan.journal_transactions
      ? refusal(plan.journal_transactions)
      : answer());
    self.maybeSingle = () => Promise.resolve(answer());
    self.then = (onOk, onErr) => Promise.resolve().then(answer).then(onOk, onErr);
    return self;
  }
  supabaseAdmin.from = (table) => builder(table);
  supabaseAdmin.rpc = async (name) => {
    calls.push(`rpc:${name}`);
    if (name !== 'adjust_wallet_atomic') return { data: null, error: { code: 'UNEXPECTED_RPC', message: `settlement child saw rpc ${name}` } };
    if (rpcPlan === 'fetch') {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
      cause.code = 'ECONNREFUSED';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      throw err;
    }
    if (rpcPlan === 'ok') {
      return { data: { success: true, status: 'POSTED', balance: 1234.5, transaction_id: `LWGSETTLE-${STAMP}` }, error: null };
    }
    return { data: null, error: SETTLE_ENGINE[rpcPlan] || { code: rpcPlan, message: `faked ${rpcPlan}` } };
  };

  db.save = () => {};

  const tail = String(STAMP).slice(-8);
  const driverId = `00d1${tail}`.slice(-8) + '-0000-4000-8000-0000000000d1';
  const userId = `00c1${tail}`.slice(-8) + '-0000-4000-8000-0000000000c1';
  const jobId = `LWGSETTLEJOB-${STAMP}`;
  db.drivers.push({
    id: driverId, uuid: driverId, name: 'LWG settlement driver', phone: '0000000000',
    walletBalance: 100, todayEarnings: 0, todayTrips: 0, commissionPaidToday: 0,
    cashCollectedToday: 0, onlinePaidToday: 0, activeJobId: jobId,
  });
  db.users.push({ id: userId, uuid: userId, name: 'LWG settlement customer', phone: '0000000001', walletBalance: 5000 });
  db.jobs.push({
    id: jobId, jobNumber: `LWG-SETTLE-${STAMP}`, uuid: JOURNAL_HEADER_UUID, type: 'RIDE',
    status: 'IN_TRANSIT', fare: 500, platformFee: 75, paymentMode: 'ONLINE',
    customerId: userId, driverId,
    pickup: { address: 'LWG pickup' }, drop: { address: 'LWG drop' },
  });

  const driver = db.getDriver(driverId);
  const user = db.getUser(userId);
  const before = {
    wallet: driver ? driver.walletBalance : null,
    today: driver ? driver.todayEarnings : null,
    trips: driver ? driver.todayTrips : null,
    userWallet: user ? user.walletBalance : null,
    transactions: (db.transactions || []).length,
    ledger: (db.ledgerEntries || []).length,
  };

  const verdict = { live: isLivePostgres === true, before, rpcPlan };
  const started = Date.now();
  let out = null;
  let thrown = null;
  try {
    out = await db.updateJobStatus(jobId, 'COMPLETED');
  } catch (err) {
    thrown = {
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      storeFailure: Boolean(err && err.storeFailure),
      unreachable: Boolean(err && isStoreUnreachable(err)),
      message: String((err && err.message) || ''),
      details: String((err && err.details) || ''),
    };
  }
  verdict.ms = Date.now() - started;
  verdict.threw = Boolean(thrown);
  verdict.error = thrown;
  verdict.returned = out ? { id: out.id, status: out.status } : null;
  const after = {
    wallet: driver ? driver.walletBalance : null,
    today: driver ? driver.todayEarnings : null,
    trips: driver ? driver.todayTrips : null,
    userWallet: user ? user.walletBalance : null,
    transactions: (db.transactions || []).length,
    ledger: (db.ledgerEntries || []).length,
  };
  verdict.after = after;
  verdict.delta = Object.keys(after).reduce((acc, k) => {
    const a = after[k], b = before[k];
    if (typeof a === 'number' && typeof b === 'number') acc[k] = a - b;
    else acc[k] = a === b ? 0 : 'changed';
    return acc;
  }, {});
  // The earnings journal row the settlement posts behind the wallet credit, and the
  // TRIP_EARNING row, are the two claims that the trip was settled.
  verdict.journalWrites = calls.filter((c) => c === 'journal_transactions.write').length;
  verdict.walletRpcCalled = calls.filter((c) => c === 'rpc:adjust_wallet_atomic').length;
  verdict.jobsWrites = calls.filter((c) => c === 'jobs.write').length;
  verdict.suspicious = /does not exist|violates foreign key|duplicate key value/.test(
    [verdict.error && verdict.error.message, JSON.stringify(verdict.returned || {})].join(' '));
  console.log(`LWG_SETTLE_VERDICT ${JSON.stringify(verdict)}`);
}

// ---------------------------------------------------------------- parent
const STORE_ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:59999',
  SUPABASE_ANON_KEY: 'local-only-fake-store-key',
  SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
};

function spawnChild(live, planJson) {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 240000,
    env: Object.assign({}, process.env, STORE_ENV, {
      NABIN_LWG_CHILD: '1',
      SUPABASE_POSTGRES_LIVE: live ? 'true' : 'false',
      NABIN_LWG_PLAN: JSON.stringify(planJson || {}),
    }),
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('LWG_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict: ${String(res.stdout || '').slice(-160)} | ${String(res.stderr || '').slice(-400)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('LWG_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

const HEADER_FAILS = ['42P01', '23503', '22001', 'fetch'];

function spawnSettlement(rpcPlan) {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 240000,
    env: Object.assign({}, process.env, STORE_ENV, {
      NABIN_LWG_CHILD: '1',
      NABIN_LWG_MODE: 'settlement',
      SUPABASE_POSTGRES_LIVE: 'true',
      NABIN_LWG_SETTLE_PLAN: JSON.stringify({ rpc: rpcPlan }),
    }),
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('LWG_SETTLE_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no settlement verdict (${rpcPlan}): ${String(res.stdout || '').slice(-200)} | ${String(res.stderr || '').slice(-500)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('LWG_SETTLE_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable settlement verdict: ${line.slice(0, 200)}` }; }
}

function main() {
  const v = spawnChild(true, { journal_transactions: '42P01', journal_lines: '42P01' });
  const off = spawnChild(false, {});
  if (!v.ok) { console.error('LWG ABORT:', v.detail); process.exitCode = 1; return; }
  if (!off.ok) { console.error('LWG ABORT (offline):', off.detail); process.exitCode = 1; return; }

  check('LWG-00', 'the live child really is talking to a configured store', v.live === true, v.live);

  // ============================ 1. a refused header is a failed request
  HEADER_FAILS.forEach((kind, i) => {
    const h = v[`header_${kind}`];
    check(`LWG-0${i + 1}`,
      `a store refusal of the journal header (${kind}) fails closed instead of reporting POSTED`,
      h && h.threw === true && (h.storeFailure === true || h.unreachable === true),
      h);
  });

  check('LWG-05', 'a refused posting never adds a mirror entry that claims the money was booked',
    HEADER_FAILS.every((k) => v[`header_${k}`] && v[`header_${k}`].mirrorNew === 0),
    HEADER_FAILS.map((k) => ({ k, mirrorNew: v[`header_${k}`] && v[`header_${k}`].mirrorNew })));

  check('LWG-06', 'a store failure is never answered as the caller\'s mistake (no 4xx on the error)',
    HEADER_FAILS.every((k) => {
      const h = v[`header_${k}`];
      return h && (h.status === undefined || h.status >= 500);
    }),
    HEADER_FAILS.map((k) => ({ k, status: v[`header_${k}`] && v[`header_${k}`].status })));

  check('LWG-07', 'the engine code travels on the error so replyStoreError can classify it, and a dead socket reads as an outage',
    Boolean(v.header_42P01 && v.header_42P01.code === '42P01')
      && Boolean(v.header_23503 && v.header_23503.code === '23503')
      && Boolean(v.header_22001 && v.header_22001.code === '22001')
      && Boolean(v.header_fetch && v.header_fetch.unreachable === true),
    HEADER_FAILS.map((k) => ({ k, code: v[`header_${k}`] && v[`header_${k}`].code, unreachable: v[`header_${k}`] && v[`header_${k}`].unreachable })));

  check('LWG-08', 'PostgreSQL\'s sentence about itself stays off the answer and on the field only the log reads',
    HEADER_FAILS.every((k) => {
      const h = v[`header_${k}`];
      return h && h.leaked === false && (k === 'fetch' ? /fetch failed|ECONNREFUSED/i.test(h.reason) : engineText(h.reason));
    }),
    HEADER_FAILS.map((k) => ({ k, leaked: v[`header_${k}`] && v[`header_${k}`].leaked, reason: v[`header_${k}`] && v[`header_${k}`].reason })));

  // ============================ 2. a collision is the booking already existing
  check('LWG-09', 'a transaction_id collision (a re-run settlement) answers duplicate and mirrors nothing',
    Boolean(v.collision_no_key) && v.collision_no_key.threw === false
      && v.collision_no_key.mirrorNew === 0
      && v.collision_no_key.returned && v.collision_no_key.returned.duplicate === true,
    v.collision_no_key);

  check('LWG-10', 'an idempotency-key collision keeps its current duplicate answer',
    Boolean(v.collision_with_key) && v.collision_with_key.threw === false
      && v.collision_with_key.mirrorNew === 0
      && v.collision_with_key.returned && v.collision_with_key.returned.duplicate === true,
    v.collision_with_key);

  // ============================ 3. a header whose legs were refused is not a posting
  check('LWG-11', 'a refused journal_lines insert fails the posting instead of reporting a balanced entry',
    Boolean(v.lines_refused) && v.lines_refused.threw === true
      && v.lines_refused.storeFailure === true && v.lines_refused.mirrorNew === 0,
    v.lines_refused);

  // ============================ 4. positive controls
  check('LWG-12', 'a posting the store accepted still lands exactly once, stamped POSTED',
    Boolean(v.cooperative) && v.cooperative.threw === false
      && v.cooperative.mirrorNew === 1
      && v.cooperative.returned && v.cooperative.returned.status === 'POSTED',
    v.cooperative);

  check('LWG-13', 'offline development with no durable store still posts to the mirror (the gate is not over-tight)',
    off.live === false && off.offline && off.offline.threw === false
      && off.offline.mirrorNew === 1
      && off.offline.returned && off.offline.returned.status === 'POSTED',
    off.offline);

  check('LWG-14', 'the measured calls touched no table outside the durable journal',
    Array.isArray(v.observed) && v.observed.length > 0
      && v.observed.every((w) => /^journal_(transactions|lines)\.write$/.test(w)),
    { observed: v.observed });

  // ============================ 5. the money boundary no longer answers from the mirror
  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  const dbSrc = fs.readFileSync(DB_FILE, 'utf8');
  const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
  // The slice is read for the shapes of the code it no longer contains, so the explanation of
  // the deleted defect must not count as an occurrence of it: comment lines are stripped first.
  const stripComments = (src) => src.split('\n').filter((ln) => !ln.trim().startsWith('//')).join('\n');
  const recordLedger = stripComments(dbSrc.slice(dbSrc.indexOf('async recordLedgerEntry('), dbSrc.indexOf('  getLedgerEntries(')));
  check('LWG-15', 'recordLedgerEntry no longer trades a store failure for a mirror entry',
    recordLedger.length > 0 && /console\.warn/.test(recordLedger) === false
      && /this\.ledgerEntries\.unshift/.test(recordLedger) === false,
    { slice: recordLedger.length, warns: (recordLedger.match(/console\.warn/g) || []).length, mirrors: (recordLedger.match(/this\.ledgerEntries\.unshift/g) || []).length });
  check('LWG-16', 'the repository marks journal refusals with the flag the routes already read',
    (repoSrc.match(/storeFailure/g) || []).length >= 3,
    { sites: (repoSrc.match(/storeFailure/g) || []).length });

  const completeRoute = serverSrc.slice(
    serverSrc.indexOf("db.updateJobStatus(jobId, 'COMPLETED')") - 500,
    serverSrc.indexOf("db.updateJobStatus(jobId, 'COMPLETED')") + 900);
  check('LWG-17', 'the ride-completion route classifies a settlement store failure instead of answering 409 with the engine\'s sentence',
    serverSrc.indexOf("db.updateJobStatus(jobId, 'COMPLETED')") > 0
      && /replyStoreError/.test(completeRoute)
      && /err\.storeFailure \|\| supabaseHelper\.isStoreUnreachable\(err\)/.test(completeRoute),
    { replyStoreError: /replyStoreError/.test(completeRoute) });

  const verifyRoute = serverSrc.slice(
    serverSrc.indexOf('db.verifyPaymentSession({') - 300,
    serverSrc.indexOf('db.verifyPaymentSession({') + 900);
  check('LWG-18', 'the checkout-verify route classifies a capture store failure instead of answering 400',
    serverSrc.indexOf('db.verifyPaymentSession({') > 0
      && /replyStoreError\(res, req, err, 'payment capture'\)/.test(verifyRoute),
    { replyStoreError: /replyStoreError/.test(verifyRoute) });

  const payRepoSrc = stripComments(fs.readFileSync(PAYMENT_REPO_FILE, 'utf8'));
  check('LWG-19', 'a rejected capture RPC travels as a classified refusal, not a codeless Error the route reads as the caller\'s mistake',
    /storeFailure\('payment capture', error\)/.test(payRepoSrc)
      && /throw new Error\(`capture_payment_atomic RPC error/.test(payRepoSrc) === false,
    { classified: /storeFailure\('payment capture', error\)/.test(payRepoSrc) });

  // ============================ 6. the driver's wallet credit (#280)
  const REFUSED = ['42P01', '23503', 'fetch'];
  const s = {};
  for (const kind of REFUSED.concat(['ok'])) {
    const v = spawnSettlement(kind);
    if (!v.ok) { console.error(`LWG ABORT (settlement ${kind}):`, v.detail); process.exitCode = 1; return; }
    s[kind] = v;
  }

  check('DEC-00', 'the settlement children really are talking to a configured store',
    REFUSED.concat(['ok']).every((k) => s[k].live === true),
    REFUSED.concat(['ok']).map((k) => ({ k, live: s[k].live })));

  REFUSED.forEach((kind, i) => {
    const v = s[kind];
    check(`DEC-0${i + 1}`,
      `a store refusal of the driver wallet credit (${kind}) aborts the settlement instead of completing the trip`,
      v.threw === true && v.returned === null,
      { threw: v.threw, returned: v.returned, error: v.error && { code: v.error.code, storeFailure: v.error.storeFailure } });
  });

  check('DEC-04', 'a refused wallet credit is classified as a store failure, so the route cannot answer it as the caller\'s mistake',
    s['42P01'].error && s['42P01'].error.storeFailure === true && s['42P01'].error.code === '42P01'
      && s['23503'].error && s['23503'].error.storeFailure === true && s['23503'].error.code === '23503'
      && s.fetch.error && s.fetch.error.unreachable === true,
    REFUSED.map((k) => ({ k, storeFailure: s[k].error && s[k].error.storeFailure, code: s[k].error && s[k].error.code, unreachable: s[k].error && s[k].error.unreachable })));

  check('DEC-05', 'nothing about the settled trip is claimed: no wallet, no trip count, no transaction row, no ledger row',
    REFUSED.every((k) => {
      const d = s[k].delta;
      return d && d.wallet === 0 && d.today === 0 && d.trips === 0 && d.transactions === 0 && d.ledger === 0;
    }),
    REFUSED.map((k) => ({ k, delta: s[k].delta })));

  check('DEC-06', 'the customer is not debited for a settlement that did not happen',
    REFUSED.every((k) => s[k].delta && s[k].delta.userWallet === 0),
    REFUSED.map((k) => ({ k, userWallet: s[k].delta && s[k].delta.userWallet })));

  check('DEC-07', 'no journal row is booked behind the refused wallet movement',
    REFUSED.every((k) => s[k].journalWrites === 0 && s[k].walletRpcCalled === 1),
    REFUSED.map((k) => ({ k, journalWrites: s[k].journalWrites, walletRpcCalled: s[k].walletRpcCalled })));

  check('DEC-08', 'the refusal is reported as a failure, not as the engine\'s sentence about itself',
    REFUSED.every((k) => s[k].suspicious === false),
    REFUSED.map((k) => ({ k, suspicious: s[k].suspicious, message: String((s[k].error && s[k].error.message) || '').slice(0, 120) })));

  // `delta.userWallet === -500` used to be asserted here. It was measured, not invented — but it
  // pinned the defect #264 names: a settlement must not move the rider's balance at all, because no
  // durable primitive debits it. DEC-12 now owns the rider's wallet; this check owns the trip.
  check('DEC-09', 'positive control: a wallet credit the store accepted still settles the trip exactly once',
    s.ok.threw === false && s.ok.returned && s.ok.returned.status === 'COMPLETED'
      && s.ok.walletRpcCalled === 1 && s.ok.journalWrites === 1 && s.ok.jobsWrites === 1
      && s.ok.delta && s.ok.delta.transactions === 1
      && s.ok.after && s.ok.after.wallet === 1234.5,
    { threw: s.ok.threw, returned: s.ok.returned, delta: s.ok.delta, after: s.ok.after, journalWrites: s.ok.journalWrites, walletRpcCalled: s.ok.walletRpcCalled, jobsWrites: s.ok.jobsWrites });

  const settleSlice = stripComments(dbSrc.slice(
    dbSrc.indexOf("const netKey = `RIDE_SETTLEMENT:"),
    dbSrc.indexOf('if (earnings.duplicate)')));
  check('DEC-10', 'the settlement no longer trades a rejected earnings credit for a warning',
    settleSlice.length > 0 && /console\.warn/.test(settleSlice) === false
      && /this\.driverRepo\.updateEarnings/.test(settleSlice),
    { slice: settleSlice.length, warns: (settleSlice.match(/console\.warn/g) || []).length });

  const ledgerRepoSrc = stripComments(repoSrc);
  check('DEC-11', 'a failed adjust_wallet_atomic RPC travels classified instead of as a codeless Error',
    /storeFailure\('wallet adjustment', error\)/.test(ledgerRepoSrc)
      && /throw new Error\(`PostgreSQL adjust_wallet_atomic failed/.test(ledgerRepoSrc) === false,
    { classified: /storeFailure\('wallet adjustment', error\)/.test(ledgerRepoSrc) });

  // ============================ 7. the rider's wallet is not moved by a settlement (#264)
  // `users.wallet_balance` is a durable column and the only primitive in this repository that
  // writes it is `adjust_wallet_atomic` (migration 007), which books the matching journal legs in
  // the same function body. A ride settlement never calls it for the customer: the fare crosses the
  // gateway through `capture_payment_atomic` (migration 006), which books PAYMENT_GATEWAY_ESCROW
  // against CUSTOMER_WALLET_LIABILITY and leaves the rider's balance untouched, and the settlement
  // then debits that liability account. So the rider's balance is not a ride's funding source at
  // all, and a settlement that lowers the number the API reports is reporting a debit no book
  // contains — permanently, until the next restart reflows it back from the column
  // (database.js:1780 hydrates `walletBalance` from `row.wallet_balance`).
  //
  // It is not a display rounding either. `/api/auth/me` answers with the mirror object itself
  // (server.js:1289 -> `projectUserForSelf`, which strips `rating` and passes `walletBalance`
  // through), and `mobile/lib/features/wallet/presentation/screens/wallet_screen.dart:31-38` calls
  // exactly that route and prints `user.walletBalance` as the customer's money.
  check('DEC-12', 'a settled ride leaves the rider\'s reported wallet balance untouched',
    s.ok.threw === false && s.ok.returned && s.ok.returned.status === 'COMPLETED'
      && s.ok.delta && s.ok.delta.userWallet === 0
      && s.ok.before && s.ok.before.userWallet === 5000
      && s.ok.after && s.ok.after.userWallet === 5000,
    { delta: s.ok.delta && s.ok.delta.userWallet, before: s.ok.before && s.ok.before.userWallet, after: s.ok.after && s.ok.after.userWallet });

  // DEC-004 (database.js:3303-3306) is the rule this pins for the rider side: wallet mutations
  // flow through the atomic ledger RPC, "No JavaScript balance arithmetic". The driver mirror
  // credit is legitimate because it is guarded by `!earnings.posted` — it carries the movement only
  // when the store refused to. The rider debit was guarded by nothing, so it ran on the live path
  // too. The accepted shapes are therefore "no rider balance arithmetic here" or "arithmetic only
  // where there is no durable store", and the count comparison is what makes an unguarded
  // re-introduction fail rather than read as a style choice.
  const riderSlice = stripComments(dbSrc.slice(
    dbSrc.indexOf("const driver = this.getDriver(job.driverId"),
    dbSrc.indexOf('async recordPayout(')));
  const riderAssigns = (riderSlice.match(/user\.walletBalance\s*[-+]?=/g) || []).length;
  const guardedRiderAssigns = (riderSlice.match(/if \(\s*!isLivePostgres[^{}]*\)\s*\{\s*user\.walletBalance\s*[-+]?=/g) || []).length;
  check('DEC-13', 'the rider balance is mutated in the settlement only where the mirror is the store',
    riderSlice.length > 0 && riderAssigns === guardedRiderAssigns,
    { riderAssigns, guardedRiderAssigns, slice: riderSlice.length });

  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 LEDGER WRITE GUARD: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('   failed: ' + failed.map((f) => f.id).join(', '));
  console.log('========================================================================');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_LWG_CHILD) {
  const run = process.env.NABIN_LWG_MODE === 'settlement' ? runSettlementChild : runChild;
  run().catch((err) => {
    console.log(`LWG_VERDICT ${JSON.stringify({ ok: false, crashed: err && err.message, stack: String((err && err.stack) || '').slice(0, 500) })}`);
    process.exit(3);
  });
} else {
  main();
}
