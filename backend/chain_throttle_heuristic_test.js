// =========================================================================
// THE CHAIN RUNNER MUST NOT READ A PASSING CHECK'S OWN TEXT AS A THROTTLE
//
// `scripts/test_chain.js` prints an advisory `OTP_THROTTLED` marker per link. Its purpose is
// to qualify a RED link — "this failure is the OTP rate limiter, not your change" — and the
// console only says `[OTP throttle seen]` on the failure branch. The summary line and
// `metadata.json` carry the flag for every link, so when it fires on a green one the run
// record asserts a throttle nobody observed.
//
// `#288` made that measurable. Before it, `AUTH_OTP_DISPATCH_FAILED` did not exist; the audit
// trail had one action for every OTP request whether the send worked or not, so a refused
// send printed a success-shaped row and no suite printed the words. Fixing the trail gave a
// refusal its own action name — and that name *contains* the literal `OTP_DISPATCH_FAILED`
// the heuristic greps for, so link 8's two ✅ PASS lines, which print the action name as
// evidence, set the flag on a 22/22 exit-0 run.
//
// The fixtures below are verbatim from `chain_20261012_134303_53804_ee8534`: the two AUTH-19
// and AUTH-20 lines from `auth_failclosed_test.log`, and the COR-35 line from
// `customer_order_read_reliability_test.log`. Nothing here touches a database or a network;
// the runner is required, not executed, which is what the `require.main` seam in
// `scripts/test_chain.js` exists to allow.
// =========================================================================

const fs = require('fs');
const path = require('path');

const RUNS_DIR = path.join(__dirname, '.chain-logs', 'runs');

// Requiring the runner must not start a chain. Count the evidence directories first: a run
// that began would create one, and the assertion below is what makes the seam's promise —
// rather than the copy of a pattern — the thing under test.
const runsBefore = fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0;
const runner = require('./scripts/test_chain');
const { scanOutput } = runner;

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail || ''}`);
}

const flagOf = (text) => scanOutput(text).otpThrottled;

// ---------------------------------------------------------------- the fixtures

// Verbatim, `auth_failclosed_test.log` of the 13:43 run.
const AUTH19 = '✅ [AUTH-19] PASS  a send the gateway refused is audited as refused: the trail for +919876500088 got a challenge row and a failure row and never a dispatch row (actions=["AUTH_OTP_REQUESTED","AUTH_OTP_DISPATCH_FAILED"])';
// Verbatim, truncated only at the end of the `blob` field it prints; the substring that
// matters is intact and appears twice in the real line.
const AUTH20 = '✅ [AUTH-20] PASS  and the failure row is an honest failure row: success=false, the refusal code in its failureReason, the state the process is actually in (row={"action":"AUTH_OTP_DISPATCH_FAILED","module":"AUTH","previous":"OTP_PENDING","next":"OTP_PENDING","success":false,"failureReason":"SMS_GATEWAY_NOT_CONFIGURED: SMS_PROVIDER is not configured.","reason":"The CUSTOMER LOGIN OTP challenge was created but no code was sent.","blob":"{\\"adminId\\":\\"SYSTEM_AUTH\\",\\"action\\":\\"AUTH_OTP_DISPATCH_FAILED\\"}"}, challenge retained=true)';
// Verbatim, `customer_order_read_reliability_test.log` of the same run.
const COR35 = '[PASS] COR-35 the detail route does NOT turn the outage into a 404 Order not found -> {"status":503,"code":"STORE_UNAVAILABLE","error":"The customer order cannot be served right now because the database is not reachable. This is our side, not yours — try again in a moment."}';

// What a real dispatch failure looks like on the way out: `src/server.js:1221` answers
// `{ code: err.code || 'OTP_DISPATCH_FAILED' }`, so the code appears as a value, never as the
// tail of a longer identifier.
const CODE_JSON = 'POST /api/auth/send-otp -> {"success":false,"code":"OTP_DISPATCH_FAILED","message":"OTP generated but SMS delivery failed"}';
const CODE_JS = "refused with { code: 'OTP_DISPATCH_FAILED', status: 502 }";
const THROTTLE_MSG = 'POST /api/auth/send-otp answered 429 Too many OTP requests, try again in 8 minutes';

// ---------------------------------------------------------------- the seam

check('HTH-00', typeof scanOutput === 'function',
  '`scripts/test_chain.js` exports the ACTUAL scanner, so this suite guards the runner and not a copy of its patterns');
check('HTH-01', (fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0) === runsBefore,
  `requiring the runner started no chain run (${runsBefore} evidence director${runsBefore === 1 ? 'y' : 'ies'} before, ${fs.existsSync(RUNS_DIR) ? fs.readdirSync(RUNS_DIR).length : 0} after)`);

// ---------------------------------------------------------------- the regression #288 caused

check('HTH-02', flagOf(AUTH19) === false,
  'the AUTH-19 PASS line, verbatim from the 13:43 run, does not flag a throttle — it prints the audit action name as its evidence');
check('HTH-03', flagOf(AUTH20) === false,
  'the AUTH-20 PASS line does not flag a throttle, with the action name appearing both bare and inside the escaped `blob`');
check('HTH-04', flagOf(`${AUTH19}\n${AUTH20}\n✅ [AUTH-21] PASS\n📊 22 PASSED, 0 FAILED (Total: 22)`) === false,
  'the real link-8 log shape (both lines, green summary) flags nothing — this is the run that printed OTP_THROTTLED on 22/22, exit 0');
check('HTH-05', flagOf('{"action":"AUTH_OTP_DISPATCH_FAILED","success":false}') === false,
  'the action name inside a JSON row is an audit record, not a throttle event');
check('HTH-06', flagOf('AUTH_OTP_DISPATCHED') === false,
  'the sibling action name never flags, so a future rename cannot quietly re-open this');

// ---------------------------------------------------------------- the signals that must survive

check('HTH-07', flagOf(CODE_JSON) === true,
  'a dispatch failure answered as the server error code (`src/server.js:1221`) still flags — the alternative was narrowed, not deleted');
check('HTH-08', flagOf(CODE_JS) === true,
  'the same code in the JS object print form (`code: ...`) still flags');
check('HTH-09', flagOf(THROTTLE_MSG) === true,
  'the rate limiter’s own message still flags, and it matches through both of its phrases in one line');
check('HTH-10', flagOf('Too many OTP requests') === true, 'phrase one, alone');
check('HTH-11', flagOf('try again in 300 seconds') === true, 'phrase two, alone');

// ---------------------------------------------------------------- a pre-existing false positive, pinned as measured
//
// `customer_order_read_reliability_test.js` carries OTP_THROTTLED in BOTH the 12:40 and the
// 13:43 run, and the cause is now measured: COR-35 and COR-41 are ✅ PASS lines asserting that
// a store outage answers 503 with `supabase.js:173`'s sentence. That is not this cycle's defect
// (`#288` introduced only the substring collision), and it is not a free narrowing either. The
// measured reasons for pinning instead of deleting the alternative:
//   - The real OTP throttle copy is `Too many OTP requests. Please wait 10 minutes before
//     requesting again.` (`src/database.js:6485`). It does not contain the retry clause at all,
//     so the first alternative already covers it; the clause is not load-bearing for the limiter.
//   - The clause IS load-bearing for the account-lockout copies (`src/database.js:6494`, `:6663`,
//     `:9159`), which are rate-limit events in a different form and carry no other marker.
//   - The same clause also sits in outage/audit-refusal copy (`src/database.js:6313`, `:6334`,
//     `src/supabase.js:173`), which is what makes it ambiguous: one string, two meanings. Telling
//     them apart needs a positive discriminator ("temporarily locked"), i.e. a redesign of the
//     heuristic, not a narrowing of it — a separate call from this cycle's.
// So it is asserted as TRUE here, on record: a later cycle that changes it does so against a red
// line in this suite, deliberately, not by accident. Note also that this check's own printed
// detail must not quote the clause verbatim — a guard that trips its own heuristic would be a
// second, self-inflicted instance of the defect it pins, and this suite is chain link 69.
check('HTH-12', flagOf(COR35) === true,
  'KNOWN REMAINING FALSE POSITIVE, pinned as measured: a green link quoting the 503 outage retry clause still flags, because that clause is lockout copy as well as outage copy (link 57 in both the 12:40 and 13:43 runs)');

// ---------------------------------------------------------------- the scanner is still the scanner
//
// These two checks print the scanner's own numbers, and printing them in the runner's marker
// vocabulary is the defect this suite exists to pin, aimed at me: with the details as first
// written, the real `scanOutput` read this green log as `passed=19, 1 failure mark(s)` — 19
// because `passed=3` is one of the summary forms it adds, and the failure mark because a
// `[FAIL]` quoted inside a ✅ PASS line matches the unanchored `\[FAIL\]` alternative. So the
// evidence below is printed in words the parser does not claim, and `node chain_throttle_
// heuristic_test.js` through the real scanner is measured to report 16/0/0 (Action 36).
const green = '✔ one\n✔ two\n[PASS] three\n📊 3 PASSED, 0 FAILED (Total: 3)\n';
const g = scanOutput(green);
check('HTH-13', g.passed >= 3 && g.failLines.length === 0 && g.skipLines.length === 0,
  'a green log parses as it did before (advisory count read as ' + g.passed + ', zero failure marks, zero skips)');
const red = '❌ [X-01] FAIL  something broke\n📊 1 PASSED, 1 FAILED (Total: 2)\n';
const r = scanOutput(red);
check('HTH-14', r.failLines.length === 1,
  'a failure mark is still counted — exactly ' + r.failLines.length + ' line, the bracket-after-cross shape pinned by #160');
const throttledRed = '❌ [X-02] FAIL  send-otp answered 429 Too many OTP requests\n';
const t = scanOutput(throttledRed);
check('HTH-15', t.otpThrottled === true && t.failLines.length === 1,
  'a RED link that really was throttled keeps its explanation, which is what the flag exists for');

// ---------------------------------------------------------------- report

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log('✅ the chain runner reads a passing check as evidence, not as an event.');
