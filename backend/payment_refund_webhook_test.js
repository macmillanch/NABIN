'use strict';
// =========================================================================
// REFUND WEBHOOK VERDICT GUARD (local only, writes nothing)
//
// `PaymentRepository.recordPaymentWebhook`'s refund branch
// (src/repositories/PaymentRepository.js:593-626) treats `refund_payment_atomic`'s answer as
// optional. It awaits the atomic refund, DISCARDS the returned verdict, swallows the throw, and
// then — unconditionally — journals a refund and reports success:
//
//     if (refundTarget) {
//       try { await this.refundPaymentAtomic({ ... }); }
//       catch (rErr) { console.warn('... Refund RPC warning:', rErr.message); }   // verdict lost
//     }
//     await this.recordStandaloneWebhook({ ... amount: refundAmt, status: 'REFUNDED' ... });       // books money
//     if (this.db.processedWebhookIds) this.db.processedWebhookIds.add(eventId);                    // poisons replay
//     return { success: true, duplicate: false, message: 'Refund webhook processed' };              // claims 200
//
// `refund_payment_atomic` (migrations/006_payments_domain.sql:223-309) is the money authority. It
// refuses with `{success:false, code}` for PAYMENT_NOT_FOUND (no such payment), INVALID_STATE (not
// CAPTURED), and REFUND_AMOUNT_MISMATCH, and it writes NOTHING under the event id in those cases.
// The branch then calls `recordStandaloneWebhook`, whose UNIQUE `payment_webhooks.event_id` insert
// is not colliding (the RPC never claimed it), so it succeeds and books a
// CUSTOMER_WALLET_LIABILITY -> PAYMENT_GATEWAY_ESCROW ledger entry for a refund that never happened,
// marks the event processed (so a corrected delivery of the same event is dropped as duplicate), and
// answers HTTP 200 — telling Razorpay the refund landed while the ledger records money that did not
// move. A store outage is the same failure wearing a different mask: `refundPaymentAtomic` threw a
// codeless Error (not `storeFailure` like its capture sibling at :266), the branch caught it as a
// warning, and the gateway was told 200 for a database that was simply unreachable — so it stopped
// retrying a refund that was never recorded.
//
// Fix, in the platform's own vocabulary: the RPC verdict drives the response. A refusal journals
// nothing, marks nothing processed, and is returned typed; a store failure propagates as
// `storeFailure` so the route answers retryable 503; a real refund lets the RPC be the sole
// authority (no second journal).
//
// Evidence: the store's answers are faked at the wire — the exact `{data, error}` shapes
// supabase-js produces for each SQLSTATE and for the RPC's own jsonb verdict — because a genuine
// refused refund cannot be provoked against a store this suite is not allowed to write to, and a
// success path would leave rows in the protected `payment_webhooks` / `ledger_entries` tables. The
// `payment_webhooks` insert is stubbed to ACCEPT so the fabrication is observable: with the RPC
// refusing AND the row claim winning, the current code still moves money. Nothing is persisted —
// `db.save`, `db.recordLedgerEntry` and `db.createAuditLog` are replaced by counters and no request
// is ever sent.
// =========================================================================

const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'payment_refund_webhook_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'PaymentRepository.js');

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

// ---------------------------------------------------------------- child
// Each scenario is one `refund_payment_atomic` outcome the real RPC produces. The insert claim is
// 'ok' everywhere because the refusal scenarios are exactly the ones where the RPC never claimed the
// event id, so the standalone insert WINS and books the bogus ledger entry.
const RPC_ANSWER = {
  not_found: { data: { success: false, code: 'PAYMENT_NOT_FOUND' }, error: null },
  invalid_state: { data: { success: false, code: 'INVALID_STATE', status: 'CREATED' }, error: null },
  amount_mismatch: { data: { success: false, code: 'REFUND_AMOUNT_MISMATCH', expected: 100, received: 150 }, error: null },
  store_down: { data: null, error: { code: '08006', message: 'could not connect to server' } },
  success: { data: { success: true, duplicate: false, paymentId: 'pay_rfw', refundedAmount: 100 }, error: null },
  duplicate: { data: { success: true, duplicate: true, paymentId: 'pay_rfw' }, error: null },
};

async function runChild() {
  const { supabaseAdmin, isStoreUnreachable } = require('./src/supabase');
  const db = require('./src/database');

  let currentRpc = null;
  let recording = false;
  const observed = [];

  supabaseAdmin.rpc = async (name) => {
    if (name !== 'refund_payment_atomic') {
      return { data: null, error: { code: 'PGRST202', message: `unexpected rpc ${name}` } };
    }
    if (recording) observed.push('rpc.refund_payment_atomic');
    return currentRpc;
  };

  supabaseAdmin.from = (table) => {
    const chain = {};
    const passthrough = () => chain;
    ['select', 'eq', 'neq', 'order', 'limit'].forEach((m) => { chain[m] = passthrough; });
    // The webhook pre-check read always answers "no such row": the insert below is the claim.
    chain.maybeSingle = () => { if (recording) observed.push(`${table}.read`); return Promise.resolve({ data: null, error: null }); };
    chain.insert = () => {
      if (recording) observed.push(`${table}.insert`);
      return Promise.resolve({ data: { id: 'fake-row' }, error: null });   // the claim is accepted
    };
    return chain;
  };

  db.save = () => {};
  const ledgerCalls = [];
  db.recordLedgerEntry = async (entry) => { ledgerCalls.push(entry); return entry; };
  db.createAuditLog = () => {};

  const engineText = (parts) => /duplicate key|could not connect|does not exist/.test(parts.filter(Boolean).join(' '));

  const runScenario = async (scenario, eventId, opts) => {
    if (db.processedWebhookIds) db.processedWebhookIds.delete(eventId);
    currentRpc = RPC_ANSWER[scenario] || null;
    const beforeLedger = ledgerCalls.length;
    const out = await Promise.resolve()
      .then(() => db.recordPaymentWebhook(Object.assign({
        eventId,
        eventType: 'refund.processed',
        paymentId: 'pay_rfw',
        orderId: null,
        amount: 150,
        status: 'REFUNDED',
        signature: 'x',
        payload: {},
      }, opts || {})))
      .then((value) => ({ threw: false, value }),
        (err) => ({
          threw: true,
          storeFailure: Boolean(err && err.storeFailure),
          code: err && err.code,
          status: err && (err.status || err.statusCode),
          unreachable: Boolean(err && isStoreUnreachable(err)),
        }));

    const result = out.threw ? null : out.value;
    return {
      threw: out.threw,
      storeFailure: out.storeFailure === true,
      unreachable: out.unreachable === true,
      errCode: out.code,
      errStatus: out.status,
      success: result ? result.success : null,
      duplicate: result ? result.duplicate : null,
      code: result ? result.code : null,
      ledgerNew: ledgerCalls.length - beforeLedger,
      markedProcessed: Boolean(db.processedWebhookIds && db.processedWebhookIds.has(eventId)),
      engineTextLeaked: out.threw && engineText([out.code, String(out.value || '')]),
    };
  };

  recording = true;
  const ts = Date.now();
  const verdict = { scenarios: {} };

  verdict.scenarios.not_found = await runScenario('not_found', `evt_rfw_nf_${ts}`);
  verdict.scenarios.invalid_state = await runScenario('invalid_state', `evt_rfw_is_${ts}`);
  verdict.scenarios.amount_mismatch = await runScenario('amount_mismatch', `evt_rfw_am_${ts}`);
  verdict.scenarios.store_down = await runScenario('store_down', `evt_rfw_sd_${ts}`);
  verdict.scenarios.success = await runScenario('success', `evt_rfw_ok_${ts}`);
  verdict.scenarios.duplicate = await runScenario('duplicate', `evt_rfw_dup_${ts}`);
  verdict.scenarios.no_target = await runScenario('no_target', `evt_rfw_nt_${ts}`, { paymentId: null, payload: { payment: { entity: {} } } });

  // Idempotency must survive a refusal: a refused event was never recorded, so the SAME event id
  // delivered again — this time by a store that grants the refund — must still be able to land.
  const reEventId = `evt_rfw_re_${ts}`;
  verdict.reprocess_refused = await runScenario('not_found', reEventId);
  verdict.reprocess_retry = await runScenario('success', reEventId);

  recording = false;
  verdict.observed = observed.slice();
  console.log(`RFW_VERDICT ${JSON.stringify(verdict)}`);
}

// ---------------------------------------------------------------- parent
function spawnChild() {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      NABIN_RFW_CHILD: '1',
      NODE_ENV: 'development',
      SUPABASE_POSTGRES_LIVE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:59999',
      SUPABASE_ANON_KEY: 'local-only-fake-store-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
      PAYMENT_MODE: 'test',
    }),
    timeout: 240000,
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('RFW_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict: stdout ${String(res.stdout || '').slice(-200)} | stderr ${String(res.stderr || '').slice(-500)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('RFW_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

function main() {
  const fs = require('fs');
  const v = spawnChild();
  if (!v.ok) {
    console.error('RFW ABORT:', v.detail);
    process.exitCode = 1;
    return;
  }
  const s = v.scenarios || {};

  // ---- The three business refusals must not fabricate a refund.
  [['not_found', 'PAYMENT_NOT_FOUND'], ['invalid_state', 'INVALID_STATE'], ['amount_mismatch', 'REFUND_AMOUNT_MISMATCH']]
    .forEach(([key, code], i) => {
      const sc = s[key];
      check(`RFW-${String(i + 1).padStart(2, '0')}`,
        `a refused refund (${code}) is answered as a refusal, not success`,
        sc && sc.threw === false && sc.success === false && sc.duplicate === false && sc.code === code,
        sc && { success: sc.success, code: sc.code, threw: sc.threw });
    });
  check('RFW-04', 'the first refusal (PAYMENT_NOT_FOUND) books no ledger money',
    s.not_found && s.not_found.ledgerNew === 0, s.not_found);
  check('RFW-05', 'INVALID_STATE books no ledger money',
    s.invalid_state && s.invalid_state.ledgerNew === 0, s.invalid_state);
  check('RFW-06', 'REFUND_AMOUNT_MISMATCH books no ledger money',
    s.amount_mismatch && s.amount_mismatch.ledgerNew === 0, s.amount_mismatch);
  check('RFW-07', 'a refused refund does not consume the event id (the corrected delivery is not lost)',
    ['not_found', 'invalid_state', 'amount_mismatch'].every((k) => s[k] && s[k].markedProcessed === false),
    ['not_found', 'invalid_state', 'amount_mismatch'].map((k) => ({ k, markedProcessed: s[k] && s[k].markedProcessed })));

  // ---- A store outage is retryable and must not be answered as a completed refund.
  check('RFW-08', 'a refund against an unreachable store fails closed as a classified store failure (not a swallowed 200)',
    s.store_down && s.store_down.threw === true && s.store_down.storeFailure === true && s.store_down.unreachable === true,
    s.store_down);
  check('RFW-09', 'the outage books no ledger money and leaves the event unclaimed for a retry',
    s.store_down && s.store_down.ledgerNew === 0 && s.store_down.markedProcessed === false, s.store_down);

  // ---- A refund event that names no payment must not fabricate one.
  check('RFW-10', 'a refund with no payment reference is refused, not journaled as REFUNDED',
    s.no_target && s.no_target.threw === false && s.no_target.success === false && s.no_target.ledgerNew === 0 && s.no_target.markedProcessed === false,
    s.no_target);

  // ---- Positive controls: a real refund still works, and the repository does not double-journal it.
  check('RFW-11', 'a refund the store granted is reported as success with no second ledger entry from the repository',
    s.success && s.success.threw === false && s.success.success === true && s.success.duplicate === false && s.success.ledgerNew === 0,
    s.success);
  check('RFW-12', 'an already-refunded event is reported as a duplicate, not a fresh refund',
    s.duplicate && s.duplicate.threw === false && s.duplicate.success === true && s.duplicate.duplicate === true && s.duplicate.ledgerNew === 0,
    s.duplicate);

  // ---- The strongest end-to-end proof of the fix: refuse, then let the same event land.
  check('RFW-13', 'after a refusal the SAME event id can still be processed once the store grants it',
    v.reprocess_refused && v.reprocess_retry && v.reprocess_refused.success === false
      && v.reprocess_retry.success === true && v.reprocess_retry.ledgerNew === 0,
    { refused: v.reprocess_refused && v.reprocess_refused.success, retry: v.reprocess_retry && v.reprocess_retry.success });

  // ---- Nothing outside the two payment tables was touched.
  check('RFW-14', 'the measured calls touched only the refund rpc and the payment_webhooks claim',
    Array.isArray(v.observed) && v.observed.every((w) => /^(rpc\.refund_payment_atomic|payment_webhooks\.(read|insert))$/.test(w)),
    { observed: v.observed });

  // ---- Source guards: the verdict is consulted and the outage is classified like its capture sibling.
  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  check('RFW-15', 'refundPaymentAtomic marks a store refusal with the flag the routes already read',
    /storeFailure\(\s*['"]payment refund['"]/.test(repoSrc) || /throw storeFailure/.test(repoSrc.match(/async refundPaymentAtomic[\s\S]*?\n  \}/)?.[0] || ''),
    { hasRefundStoreFailure: /storeFailure\(\s*['"]payment refund['"]/.test(repoSrc) });
  check('RFW-16', 'the refund branch reads the RPC verdict instead of discarding it',
    /verdict|refundResult|refundVerdict|const\s+\w+\s*=\s*await this\.refundPaymentAtomic/.test(repoSrc)
      && !/catch \(rErr\)\s*\{\s*console\.warn\([^)]*Refund RPC warning/.test(repoSrc),
    { swallowGone: !/catch \(rErr\)\s*\{\s*console\.warn\([^)]*Refund RPC warning/.test(repoSrc) });

  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 REFUND WEBHOOK VERDICT GUARD: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('   failed: ' + failed.map((f) => f.id).join(', '));
  console.log('========================================================================');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_RFW_CHILD) {
  runChild().catch((err) => {
    console.log(`RFW_VERDICT ${JSON.stringify({ scenarios: {}, crashed: err && err.message, stack: String((err && err.stack) || '').slice(0, 600) })}`);
    process.exit(3);
  });
} else {
  main();
}
