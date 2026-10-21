'use strict';
// =========================================================================
// PAYMENT WRITE GUARD (local only, writes nothing)
//
// Two payment write paths treat their own durable idempotency record as
// optional, and both of them move or claim money afterwards anyway.
//
//   1. `PaymentRepository.createPaymentSession` (src/repositories/PaymentRepository.js:99-113)
//      inserted the authoritative `payment_sessions` row and then did this with the answer:
//
//          if (error) { console.error('... DB error:', error.message); }
//          else if (data) { sessionRecord.id = data.id; ... }
//          ...
//          this.db.paymentSessions.set(orderId, sessionRecord);   // runs either way
//
//      `payment_sessions.order_id` is `VARCHAR(80) UNIQUE NOT NULL` (migrations/006_payments_domain.sql:14),
//      so the refusal is the engine saying "this checkout already exists" — and the code logs it,
//      caches a session that has no row behind it, and returns it. `POST /api/payments/create-order`
//      answers 200 with that phantom, the client opens a gateway checkout against an order the
//      ledger never heard of, and a later `verify-checkout` finds no session to capture.
//
//   2. `PaymentRepository.recordStandaloneWebhook` (:723-751) awaited the `payment_webhooks`
//      insert and never read its result:
//
//          try { await supabaseAdmin.from('payment_webhooks').insert({ event_id: eventId, ... }); }
//          catch (dbErr) { console.warn('... DB error:', dbErr.message); }
//          if (!isFailedStatus && numAmount > 0) { await this.db.recordLedgerEntry({...}); }
//
//      supabase-js does not reject on a PostgreSQL refusal — it resolves `{data, error}`, so the
//      `catch` only ever sees a dead socket and the UNIQUE violation is discarded. That destroys
//      the guard the schema exists to provide: `payment_webhooks.event_id` is UNIQUE
//      (migrations/001_central_schema.sql:211) precisely so a second delivery of one event loses.
//      The read-check ~180 lines earlier (recordPaymentWebhook:527-538) is a lookup, not a claim,
//      so two concurrent deliveries both read "not seen", both fail to insert, and both book
//      PAYMENT_GATEWAY_ESCROW -> CUSTOMER_WALLET_LIABILITY. The sibling SQL primitive already does
//      this correctly: `refund_payment_atomic` claims the event id FIRST and returns duplicate to
//      the loser (migrations/006_payments_domain.sql:217-219, 272-274).
//
// Fix, in the platform's existing vocabulary: a store refusal is marked with `storeFailure` plus
// the engine's `code` (src/repositories/SupportTicketRepository.js:50-60) and the routes hand it to
// the one classifier they already use (`err.storeFailure || isStoreUnreachable(err)` ->
// `replyStoreError`, e.g. server.js:2050). For money, "could not record the event" means "did not
// move the money": the ledger write is withheld and the gateway retries.
//
// Evidence: the store's answer is faked at the wire — the exact shape supabase-js produces for one
// SQLSTATE, per table — because a genuine duplicate-key refusal cannot be provoked against a store
// this suite is not allowed to write to. Nothing is persisted: `db.save`, `db.createAuditLog` and
// the ledger boundary are replaced by counters, the connection target is a closed port, and no
// request is ever sent. The positive control (PWG-07/PWG-08) is what makes the counters
// meaningful: with the store cooperating, the same calls must still cache the session and book
// exactly one ledger entry.
// =========================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'payment_write_guard_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'PaymentRepository.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

// ---------------------------------------------------------------- child
const SESSION_ROW = {
  id: '00000000-0000-0000-0000-00000000b001',
  created_at: '2026-10-11T00:00:00.000Z',
  updated_at: '2026-10-11T00:00:00.000Z',
};

async function runChild() {
  const { supabaseAdmin, isStoreUnreachable } = require('./src/supabase');
  const db = require('./src/database');

  const ENGINE = {
    '23505': { code: '23505', message: 'duplicate key value violates unique constraint" _key"', details: null, hint: null },
    '42P01': { code: '42P01', message: 'relation "x" does not exist', details: null, hint: null },
  };

  // `observed` starts empty and only fills during the measured calls, so module-load seeding
  // cannot be mistaken for something this suite did.
  const observed = [];
  let recording = false;

  // A builder that settles the way supabase-js does: a resolved {data, error} for an engine
  // refusal, a rejected TypeError with the syscall cause for a store that is not there.
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
      if (kind === 'ok') return Promise.resolve({ data: SESSION_ROW, error: null });
      const err = ENGINE[kind] || { code: kind, message: `faked ${kind}` };
      return Promise.resolve({ data: null, error: err });
    };
    // Reads always answer "no such row": the webhook's pre-check lookup must not short-circuit
    // the insert, because the insert is the claim under test.
    const read = () => {
      if (recording) observed.push(`${table}.read`);
      if (kind === 'fetch') return reject();
      return Promise.resolve({ data: null, error: null });
    };
    const self = {};
    ['insert', 'update', 'delete', 'upsert', 'select', 'eq', 'neq', 'or', 'in', 'is', 'not',
      'gte', 'lte', 'like', 'ilike', 'order', 'limit', 'range', 'filter'].forEach((m) => {
        self[m] = () => self;
      });
    self.single = mutate;
    self.maybeSingle = read;
    self.then = (onOk, onErr) => mutate().then(onOk, onErr);
    return self;
  }

  const plan = JSON.parse(process.env.NABIN_PWG_PLAN || '{}');
  supabaseAdmin.from = (table) => builder(table, plan[table] || 'ok');

  // No file mirror; the audit and ledger boundaries become counters.
  db.save = () => {};
  const ledgerCalls = [];
  db.recordLedgerEntry = async (entry) => { ledgerCalls.push(entry); return entry; };
  const auditCalls = [];
  db.createAuditLog = (row) => { auditCalls.push(row && row.action); };

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

  const cacheKeys = () => Array.from((db.paymentSessions && db.paymentSessions.keys) ? db.paymentSessions.keys() : []);
  const engineText = (parts) => /duplicate key value violates|relation "|value too long for type/.test(parts.filter(Boolean).join(' '));

  const verdict = {};
  const REFUSED = ['23505', '42P01', 'fetch'];

  recording = true;

  // ---- 1. createPaymentSession against a store that refuses the row
  for (const kind of REFUSED) {
    plan.payment_sessions = kind;
    const before = cacheKeys();
    const beforeAudit = auditCalls.length;
    const out = await outcome(() => db.createPaymentSession({
      customerId: 'usr_cust_pwg', amount: 249, currency: 'INR', serviceType: 'RIDE',
    }));
    verdict[`session_${kind}`] = {
      threw: out.threw,
      storeFailure: out.storeFailure,
      code: out.code,
      status: out.status,
      unreachable: out.unreachable,
      cachedNew: cacheKeys().filter((k) => !before.includes(k)).length,
      auditNew: auditCalls.length - beforeAudit,
      leaked: engineText([out.threw ? out.message : '', out.threw ? '' : String((out.value && out.value.error) || '')]),
      reason: String(out.details || ''),
    };
  }

  // ---- 2. the same call against a store that accepts it (positive control)
  plan.payment_sessions = 'ok';
  const okBefore = cacheKeys();
  const okOut = await outcome(() => db.createPaymentSession({
    customerId: 'usr_cust_pwg', amount: 249, currency: 'INR', serviceType: 'RIDE',
  }));
  verdict.session_ok = {
    threw: okOut.threw,
    cachedNew: cacheKeys().filter((k) => !okBefore.includes(k)).length,
    hasDurableId: Boolean(okOut.value && okOut.value.id),
    message: okOut.threw ? String(okOut.message || '') : '',
  };

  // ---- 3. a standalone capture webhook whose idempotency row the store refuses
  for (const kind of REFUSED) {
    plan.payment_webhooks = kind;
    const beforeLedger = ledgerCalls.length;
    const out = await outcome(() => db.recordPaymentWebhook({
      eventId: `evt_pwg_${kind}`,
      eventType: 'payment.captured',
      paymentId: `pay_pwg_${kind}`,
      orderId: null,
      amount: 5000,
      status: 'CAPTURED',
      signature: 'x',
      payload: { event: 'payment.captured', id: `evt_pwg_${kind}`, paymentId: `pay_pwg_${kind}`, amount: 5000, status: 'CAPTURED' },
    }));
    if (db.processedWebhookIds) db.processedWebhookIds.delete(`evt_pwg_${kind}`);
    verdict[`hook_${kind}`] = {
      threw: out.threw,
      storeFailure: out.storeFailure,
      code: out.code,
      unreachable: out.unreachable,
      message: out.threw ? String(out.message || '') : '',
      result: out.threw ? null : out.value,
      ledgerNew: ledgerCalls.length - beforeLedger,
      leaked: engineText([out.threw ? out.message : '', out.threw ? '' : String((out.value && out.value.error) || '')]),
      reason: String(out.details || ''),
    };
  }

  // ---- 4. and the same webhook with a store that accepts the event (positive control)
  plan.payment_webhooks = 'ok';
  const lBefore = ledgerCalls.length;
  const okHook = await outcome(() => db.recordPaymentWebhook({
    eventId: 'evt_pwg_ok',
    eventType: 'payment.captured',
    paymentId: 'pay_pwg_ok',
    orderId: null,
    amount: 5000,
    status: 'CAPTURED',
    signature: 'x',
    payload: { event: 'payment.captured', id: 'evt_pwg_ok', paymentId: 'pay_pwg_ok', amount: 5000, status: 'CAPTURED' },
  }));
  verdict.hook_ok = {
    threw: okHook.threw,
    result: okHook.threw ? null : okHook.value,
    ledgerNew: ledgerCalls.length - lBefore,
  };

  recording = false;
  verdict.observed = observed.slice();
  console.log(`PWG_VERDICT ${JSON.stringify(verdict)}`);
}

// ---------------------------------------------------------------- parent
const engineTextReason = (s) => /duplicate key value violates|relation "|value too long for type/.test(String(s || ''));
function spawnChild() {
  // One child, one plan per table: the session table refuses, the webhook table refuses, and the
  // positive-control calls re-run against the same child by rewriting the plan in-process.
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      NABIN_PWG_CHILD: '1',
      NABIN_PWG_PLAN: JSON.stringify({ payment_sessions: '23505', payment_webhooks: '23505' }),
      NODE_ENV: 'development',
      SUPABASE_POSTGRES_LIVE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:59999',
      SUPABASE_ANON_KEY: 'local-only-fake-store-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
      PAYMENT_MODE: 'test',
    }),
    timeout: 240000,
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('PWG_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict: ${String(res.stdout || '').slice(-160)} | ${String(res.stderr || '').slice(-400)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('PWG_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

function main() {
  const v = spawnChild();
  if (!v.ok) {
    console.error('PWG ABORT:', v.detail);
    process.exitCode = 1;
    return;
  }

  const REFUSED = ['23505', '42P01', 'fetch'];

  // ============================ 1. the phantom checkout session
  REFUSED.forEach((kind, i) => {
    const s = v[`session_${kind}`];
    check(`PWG-${String(i + 1).padStart(2, '0')}`,
      `createPaymentSession fails closed when the store refuses the payment_sessions row (${kind})`,
      s && s.threw === true && s.storeFailure === true,
      s);
  });
  check('PWG-04', 'no phantom session reaches the in-memory cache, and no audit row claims it existed',
    REFUSED.every((k) => v[`session_${k}`] && v[`session_${k}`].cachedNew === 0 && v[`session_${k}`].auditNew === 0),
    REFUSED.map((k) => ({ k, cachedNew: v[`session_${k}`] && v[`session_${k}`].cachedNew, auditNew: v[`session_${k}`] && v[`session_${k}`].auditNew })));
  check('PWG-05', 'a duplicate order id is not answered as the caller\'s mistake (no 4xx status on the failure)',
    REFUSED.every((k) => {
      const s = v[`session_${k}`];
      return s && (s.status === undefined || s.status >= 500);
    }),
    REFUSED.map((k) => ({ k, status: v[`session_${k}`] && v[`session_${k}`].status })));
  check('PWG-06', 'the refused engine code travels on the error, so replyStoreError can classify it',
    Boolean(v.session_23505 && v.session_23505.code === '23505')
    && Boolean(v.session_42P01 && v.session_42P01.code === '42P01')
    && Boolean(v.session_fetch && v.session_fetch.unreachable === true),
    { dup: v.session_23505 && v.session_23505.code, rel: v.session_42P01 && v.session_42P01.code, down: v.session_fetch && v.session_fetch.unreachable });
  check('PWG-07', 'a session the store accepted is still cached and carries its durable id (the gate is not over-tight)',
    Boolean(v.session_ok && v.session_ok.threw === false && v.session_ok.cachedNew === 1 && v.session_ok.hasDurableId === true),
    v.session_ok);

  // ============================ 2. the webhook that pays out on a refused event row
  check('PWG-08', 'positive control: with the store accepting the event, one capture books exactly one ledger entry',
    Boolean(v.hook_ok && v.hook_ok.threw === false && v.hook_ok.ledgerNew === 1),
    v.hook_ok);
  REFUSED.forEach((kind, i) => {
    const h = v[`hook_${kind}`];
    check(`PWG-${String(9 + i).padStart(2, '0')}`,
      `a payment_webhooks refusal (${kind}) moves no money - the ledger write is withheld`,
      h && h.ledgerNew === 0,
      { ledgerNew: h && h.ledgerNew, threw: h && h.threw, result: h && h.result });
  });
  check('PWG-12', 'the duplicate delivery answers as a duplicate, or fails typed - never as a fresh capture',
    Boolean(v.hook_23505 && (v.hook_23505.threw === true
      ? v.hook_23505.storeFailure === true
      : v.hook_23505.result && v.hook_23505.result.duplicate === true)),
    { threw: v.hook_23505 && v.hook_23505.threw, result: v.hook_23505 && v.hook_23505.result });
  check('PWG-13', 'an unmigrated or unreachable store fails the webhook closed, typed and classified',
    Boolean(v.hook_42P01 && (v.hook_42P01.threw ? v.hook_42P01.storeFailure === true : v.hook_42P01.result && v.hook_42P01.result.success === false))
    && Boolean(v.hook_fetch && (v.hook_fetch.threw ? v.hook_fetch.unreachable === true : v.hook_fetch.result && v.hook_fetch.result.success === false)),
    { relThrew: v.hook_42P01 && v.hook_42P01.threw, rel: v.hook_42P01 && v.hook_42P01.code, downThrew: v.hook_fetch && v.hook_fetch.threw, down: v.hook_fetch && v.hook_fetch.unreachable });
  check('PWG-14', 'no payment failure reaches the caller as the engine\'s sentence about itself',
    REFUSED.every((k) => v[`session_${k}`] && v[`session_${k}`].leaked === false
      && v[`hook_${k}`] && v[`hook_${k}`].leaked === false),
    REFUSED.map((k) => ({ k, sessionLeaked: v[`session_${k}`] && v[`session_${k}`].leaked, hookLeaked: v[`hook_${k}`] && v[`hook_${k}`].leaked })));

  // ============================ 3. nothing else was touched, and the classifier is still wired
  check('PWG-15', 'the measured calls touched no table outside the two payment tables',
    Array.isArray(v.observed) && v.observed.every((w) => /^payment_(sessions|webhooks)\./.test(w)),
    { observed: v.observed });

  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
  check('PWG-16', 'the repository marks store refusals with the flag the routes already read',
    (repoSrc.match(/storeFailure/g) || []).length >= 2,
    { sites: (repoSrc.match(/storeFailure/g) || []).length });
  check('PWG-17', 'both payment routes hand store failures to the platform classifier',
    /replyStoreError\(res, req, err, 'payment order session'\)/.test(serverSrc)
    && /replyStoreError\(res, req, err, 'payment webhook event'\)/.test(serverSrc),
    { createOrder: /replyStoreError\(res, req, err, 'payment order session'\)/.test(serverSrc), webhook: /replyStoreError\(res, req, err, 'payment webhook event'\)/.test(serverSrc) });

  // The other half of PWG-14. What the caller is not shown, the operator must still be given:
  // every failure this suite produced carries the store's own reason on `details`, which
  // `replyStoreError` writes to the log and never to the response (server.js:344-355). A SQLSTATE
  // refusal carries PostgreSQL's sentence; a dead socket carries the syscall. Dropping either
  // would make a 503 untriageable. The duplicate-webhook answer is excluded because nothing
  // failed there — the UNIQUE claim losing is the idempotency guard working.
  const THROWN = [['session_23505', '23505'], ['session_42P01', '42P01'], ['session_fetch', 'fetch'],
    ['hook_42P01', '42P01'], ['hook_fetch', 'fetch']];
  check('PWG-18', 'each failure keeps the store\'s own reason on the field only the log reads',
    THROWN.every(([key, kind]) => {
      const rec = v[key];
      if (!rec || !rec.threw) return false;
      return kind === 'fetch'
        ? /fetch failed|ECONNREFUSED/i.test(rec.reason)
        : engineTextReason(rec.reason);
    }),
    THROWN.map(([key]) => ({ key, reason: v[key] && v[key].reason, threw: v[key] && v[key].threw })));

  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 PAYMENT WRITE GUARD: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('   failed: ' + failed.map((f) => f.id).join(', '));
  console.log('========================================================================');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_PWG_CHILD) {
  runChild().catch((err) => {
    console.log(`PWG_VERDICT ${JSON.stringify({ ok: false, crashed: err && err.message, stack: String((err && err.stack) || '').slice(0, 500) })}`);
    process.exit(3);
  });
} else {
  main();
}
