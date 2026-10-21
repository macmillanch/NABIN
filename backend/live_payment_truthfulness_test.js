/*
 * NABIN Platform — Live Payment Truthfulness Test (P5-B)
 *
 * The contract this suite pins, in one sentence: a payment order id may only exist because a gateway
 * returned it, so a request that never reached a gateway must be refused instead of answered with an
 * identifier that nothing can charge.
 *
 * The defect, as measured before the fix: `PAYMENT_MODE=live` was treated as real rails by one line of
 * `PaymentRepository.js`, and the credential test beside it asked only that two environment variables
 * were non-empty. Nothing in `backend/src` calls a gateway — an inventory of the whole source tree for
 * `api.razorpay.com`, a `razorpay` SDK import or any Razorpay client returns zero hits, and LPT-15
 * measures that absence rather than assuming it. So with `PAYMENT_KEY_ID`/`PAYMENT_KEY_SECRET` set to
 * any values, `createPaymentSession` minted `order_rzp_live_<epoch>_<Math.random()>` in-process,
 * labelled the row `RAZORPAY_LIVE`, persisted it to `payment_sessions`, and the route answered
 * `{success:true, session}`. A customer was told a live gateway order existed and given an id to pay
 * against, and no such order existed anywhere. The status was INITIATED/PAYMENT_PENDING rather than
 * CAPTURED — the signature HMAC in `verifyPaymentSession` still gates capture — but the fabricated
 * identifier and the live designation were the defect: they claimed a capability the deployment does
 * not have, and no later webhook or reconciliation can ever settle against them.
 *
 * The second half was the silent default. The live branch was entered only by an explicit
 * `PAYMENT_MODE=live`, so everything else — including `NODE_ENV=production` with `PAYMENT_MODE` unset —
 * fell through to the sandbox branch and its hardcoded fallback key id `rzp_test_nabin_beta_2026`.
 * Simulation is the intended rail for this deployment (backend/.env.production.example:47 sets
 * `PAYMENT_MODE=sandbox` on purpose), so this suite does NOT refuse an explicitly declared sandbox in
 * production: LPT-14 pins that it keeps working and stays labelled as simulation. What it refuses is an
 * *undeclared* production mode silently pretending to be a payment rail. Whether production may run
 * simulated rails at all is an owner decision (see the report), not something to settle in code here.
 *
 * What the fix promises, and each check holds it to: a refused live request answers
 * `PAYMENT_PROVIDER_NOT_CONFIGURED` / 503 and mints, writes, caches, audits and books nothing, so a
 * replay cannot manufacture the success the first attempt refused; a simulated checkout keeps working
 * only behind an explicit declaration and says `simulated: true`; and the live provider designation,
 * the `order_rzp_live_*` shape and the fallback key id have no executable path left in the repository.
 * LPT-15 is the tripwire for the day a real provider integration lands: it will go red exactly when a
 * gateway client exists, and that is the moment to decide whether live may be served — not before.
 *
 * Method: the store is faked at the wire and every durable write, RPC call, audit row and ledger
 * posting is counted, so "nothing was booked" is a measurement, not a hope. Nothing is persisted and no
 * request is sent — the target is a closed port and the same calls are made through the real repository.
 * `PAYMENT_MODE`/`NODE_ENV` are flipped in-process around each call because both are read at call time;
 * the positive controls (LPT-11..LPT-14) are what make the zero-counters meaningful.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'live_payment_truthfulness_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'PaymentRepository.js');
const SRC_DIR = path.join(__dirname, 'src');

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

// ------------------------------------------------------------------ child
async function runChild() {
  const { supabaseAdmin } = require('./src/supabase');
  const db = require('./src/database');

  const SESSION_ROW = {
    id: '00000000-0000-0000-0000-00000000c001',
    created_at: '2026-10-19T00:00:00.000Z',
    updated_at: '2026-10-19T00:00:00.000Z',
  };

  let recording = false;
  const writes = [];
  const rpcCalls = [];

  function builder(table) {
    const mutate = () => {
      if (recording) writes.push(`${table}.write`);
      return Promise.resolve({ data: SESSION_ROW, error: null });
    };
    const read = () => Promise.resolve({ data: null, error: null });
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

  supabaseAdmin.from = (table) => builder(table);
  supabaseAdmin.rpc = async (name) => {
    if (recording) rpcCalls.push(name);
    return { data: null, error: null };
  };

  // Money boundaries become counters: a fabricated live order must not reach either book.
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
      statusCode: err && err.statusCode,
      message: err && err.message,
    }));

  // One scenario = one pair of env values applied for exactly the measured call.
  async function scenario({ mode, nodeEnv, keyId, keySecret }) {
    const prev = {
      PAYMENT_MODE: process.env.PAYMENT_MODE,
      NODE_ENV: process.env.NODE_ENV,
      PAYMENT_KEY_ID: process.env.PAYMENT_KEY_ID,
      PAYMENT_KEY_SECRET: process.env.PAYMENT_KEY_SECRET,
    };
    const setOrDelete = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
    setOrDelete('PAYMENT_MODE', mode);
    setOrDelete('NODE_ENV', nodeEnv);
    setOrDelete('PAYMENT_KEY_ID', keyId);
    setOrDelete('PAYMENT_KEY_SECRET', keySecret);

    const wBefore = writes.length, lBefore = ledgerCalls.length, aBefore = auditCalls.length, rBefore = rpcCalls.length;
    const out = await outcome(() => db.createPaymentSession({
      customerId: 'usr_cust_lpt', amount: 499, currency: 'INR', serviceType: 'FOOD',
    }));
    const v = out.threw ? null : out.value;

    const res = {
      threw: out.threw,
      code: out.code || null,
      status: out.status || null,
      statusCode: out.statusCode || null,
      message: out.threw ? String(out.message || '') : '',
      writes: writes.slice(wBefore),
      ledgerNew: ledgerCalls.length - lBefore,
      auditNew: auditCalls.length - aBefore,
      rpcNew: rpcCalls.slice(rBefore),
      // What a caller would be handed if the call answered success.
      orderId: v ? String(v.orderId || '') : null,
      provider: v ? String(v.provider || '') : null,
      keyId: v ? String(v.keyId === undefined ? '<absent>' : v.keyId) : null,
      status200: v ? String(v.status || '') : null,
      simulated: v ? v.simulated : null,
      paymentMode: v ? String(v.paymentMode === undefined ? '<absent>' : v.paymentMode) : null,
    };
    Object.keys(prev).forEach((k) => setOrDelete(k, prev[k]));
    return res;
  }

  recording = true;
  const verdict = {};
  verdict.live_no_creds = await scenario({ mode: 'live' });
  verdict.live_with_creds = await scenario({ mode: 'live', keyId: 'rzp_live_FAKE_NOT_A_REAL_KEY', keySecret: 'fake_secret_never_used' });
  // Replay the refused request: a retry must not manufacture the success the first attempt refused.
  verdict.live_replay_1 = await scenario({ mode: 'live', keyId: 'rzp_live_FAKE_NOT_A_REAL_KEY', keySecret: 'fake_secret_never_used' });
  verdict.live_replay_2 = await scenario({ mode: 'live', keyId: 'rzp_live_FAKE_NOT_A_REAL_KEY', keySecret: 'fake_secret_never_used' });
  verdict.sandbox_dev = await scenario({ mode: 'sandbox' });
  verdict.test_dev = await scenario({ mode: 'test' });
  verdict.prod_unset = await scenario({ mode: undefined, nodeEnv: 'production' });
  verdict.prod_sandbox = await scenario({ mode: 'sandbox', nodeEnv: 'production' });
  recording = false;
  verdict.writes_total = writes.length;

  console.log(`LPT_VERDICT ${JSON.stringify(verdict)}`);
}

// ----------------------------------------------------------------- parent
const LIVE_ID_RE = /^order_rzp_live_/;
const LIVE_PROVIDER = 'RAZORPAY_LIVE';

function spawnChild() {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      LPT_CHILD: '1',
      NODE_ENV: 'development',
      SUPABASE_POSTGRES_LIVE: 'true',
      SUPABASE_URL: 'http://127.0.0.1:59999',
      SUPABASE_ANON_KEY: 'local-only-fake-store-key',
      SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
      DATABASE_URL: 'postgresql://127.0.0.1:59999/lpt_no_store',
      PAYMENT_MODE: 'sandbox',
    }),
    timeout: 240000,
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('LPT_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict: ${String(res.stdout || '').slice(-200)} | ${String(res.stderr || '').slice(-600)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('LPT_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

// Every source file that could carry a gateway client, read once, for the absence proof.
function srcFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (/\.(js|mjs|cjs|ts)$/.test(e.name)) out.push(p);
  }
  return out;
}

// A comment may name the SDK it proves is absent; only live code can call it. Stripping whole-line
// comments (never block contents, so `//` inside a URL or string stays intact) keeps the tripwire
// about executables rather than prose.
function codeLines(text) {
  return text.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
}

function main() {
  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  const repoCode = codeLines(repoSrc);
  const files = srcFiles(SRC_DIR);
  const gatewayHits = files.filter((f) => /api\.razorpay\.com|require\(['"]razorpay|from ['"]razorpay|new Razorpay/i.test(codeLines(fs.readFileSync(f, 'utf8'))));

  const v = spawnChild();
  if (!v.ok) {
    console.error('LPT ABORT:', v.detail);
    process.exitCode = 1;
    return;
  }

  const refusal = (s) => s && s.threw === true;

  // ==================================================================
  // SCENE A — PAYMENT_MODE=live with no credentials at all
  // ==================================================================
  const nc = v.live_no_creds;
  check('LPT-01', 'live with no credentials is refused, not answered with a session',
    refusal(nc), { threw: nc.threw, code: nc.code, orderId: nc.orderId });
  check('LPT-02', 'the refusal names the configuration problem as PAYMENT_PROVIDER_NOT_CONFIGURED',
    nc.code === 'PAYMENT_PROVIDER_NOT_CONFIGURED', { code: nc.code, message: nc.message.slice(0, 120) });
  check('LPT-03', 'the refusal is retryable-as-configuration (503), not a 400 blaming the customer',
    nc.status === 503, { status: nc.status });

  // ==================================================================
  // SCENE B — PAYMENT_MODE=live with credentials set: the defect
  // ==================================================================
  const lc = v.live_with_creds;
  check('LPT-04', 'live WITH credentials present is still refused, because credentials are not an integration',
    refusal(lc), { threw: lc.threw, code: lc.code, orderId: lc.orderId, provider: lc.provider });
  check('LPT-05', 'no fabricated order_rzp_live_* identifier is handed to the caller',
    lc.orderId === null || !LIVE_ID_RE.test(lc.orderId), { orderId: lc.orderId });
  check('LPT-06', 'no RAZORPAY_LIVE provider designation is returned',
    lc.provider !== LIVE_PROVIDER, { provider: lc.provider });
  check('LPT-07', 'the refused live request writes no durable payment_sessions row',
    lc.writes.length === 0, { writes: lc.writes });
  check('LPT-08', 'the refused live request books no ledger or journal money',
    lc.ledgerNew === 0 && lc.rpcNew.length === 0, { ledgerNew: lc.ledgerNew, rpc: lc.rpcNew });
  check('LPT-09', 'nothing is marked captured, paid or gateway-created',
    lc.status200 === null || !/SUCCESS|CAPTURED|PAID/.test(String(lc.status200)), { status: lc.status200 });

  // ==================================================================
  // SCENE C — replay the refused live request
  // ==================================================================
  const r1 = v.live_replay_1, r2 = v.live_replay_2;
  check('LPT-10', 'replaying the refused live request produces no success and no new row',
    refusal(r1) && refusal(r2) && r1.writes.length === 0 && r2.writes.length === 0,
    { r1code: r1.code, r2code: r2.code, writes: [r1.writes.length, r2.writes.length] });

  // ==================================================================
  // SCENE D — simulation stays available and stays labelled
  // ==================================================================
  const sb = v.sandbox_dev;
  check('LPT-11', 'declared sandbox mode still creates a checkout, marked as simulation',
    sb.threw === false && sb.orderId.startsWith('order_rzp_test_') && sb.simulated === true
    && sb.provider === 'RAZORPAY_SANDBOX' && /PENDING|INITIATED/.test(sb.status200),
    { orderId: sb.orderId, provider: sb.provider, simulated: sb.simulated, status: sb.status200 });
  const ts = v.test_dev;
  check('LPT-12', 'declared test mode is labelled simulation too, and books no money',
    ts.threw === false && ts.simulated === true && ts.ledgerNew === 0,
    { simulated: ts.simulated, provider: ts.provider, ledgerNew: ts.ledgerNew });

  // ==================================================================
  // SCENE E — production configuration explicitness
  // ==================================================================
  const pu = v.prod_unset;
  check('LPT-13', 'production with PAYMENT_MODE unset refuses instead of silently simulating rails',
    pu.threw === true && pu.code === 'PAYMENT_MODE_UNCONFIGURED' && pu.status === 503 && pu.writes.length === 0,
    { threw: pu.threw, code: pu.code, status: pu.status, provider: pu.provider, writes: pu.writes });
  const ps = v.prod_sandbox;
  check('LPT-14', 'an explicitly declared sandbox in production keeps working and says it is simulated',
    ps.threw === false && ps.simulated === true && ps.provider === 'RAZORPAY_SANDBOX',
    { threw: ps.threw, simulated: ps.simulated, provider: ps.provider });

  // ==================================================================
  // SCENE F — the structural tripwires
  // ==================================================================
  check('LPT-15', 'no gateway client exists anywhere in backend/src, so a live id could only be invented',
    gatewayHits.length === 0, { hits: gatewayHits.map((f) => path.basename(f)) });
  check('LPT-16', 'the repository holds no path that can write a RAZORPAY_LIVE designation',
    !/['"`]RAZORPAY_LIVE['"`]/.test(repoCode),
    { quotedOccurrences: (repoCode.match(/['"`]RAZORPAY_LIVE['"`]/g) || []).length });
  check('LPT-17', 'createPaymentSession carries no hardcoded fallback gateway key id',
    repoCode.indexOf('rzp_test_nabin_beta_2026') === -1,
    { present: repoCode.indexOf('rzp_test_nabin_beta_2026') !== -1 });

  // ==================================================================
  // SCENE G — the refusal must reach the customer as a configuration error
  // ==================================================================
  // POST /api/payments/create-order answers from `err.statusCode || 400`, while the platform's other
  // typed refusals carry `.status`. A refusal that sets only one of the two is reported to the client
  // as a bad payment, which is the same lie in a smaller voice.
  check('LPT-18', 'both refusals carry statusCode 503, the field the create-order route reads',
    nc.statusCode === 503 && pu.statusCode === 503, { live: nc.statusCode, prod_unset: pu.statusCode });

  const passed = results.filter((r) => r.pass).length;
  const failed = results.length - passed;
  console.log('');
  console.log('========================================================================');
  console.log(`📊 LIVE PAYMENT TRUTHFULNESS TEST: ${passed}/${results.length} passed, ${failed} failed`);
  console.log('========================================================================');
  process.exitCode = failed > 0 ? 1 : 0;
}

if (process.argv.includes('--child')) {
  runChild().catch((e) => { console.error('LPT CHILD ERROR:', e && e.stack || e); process.exitCode = 2; });
} else {
  main();
}
