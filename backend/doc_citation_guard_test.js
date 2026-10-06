'use strict';

/*
 * DOC CITATION GUARD — task #139.
 *
 * The markdown in this repo cites `server.js:N` for route and handler facts. Those numbers are
 * claims about a moving file: an insert near the top of server.js silently invalidates every
 * citation below it, and a confident wrong line number is worse than none, because it sends the
 * reader to the wrong handler. `scripts/reanchor_audit_citations.js` derives them from the route
 * registrations instead, and `--check` exits non-zero while any derivable citation has drifted.
 *
 * This link is what keeps that guarantee from quietly stopping. It asserts three things:
 *   - the shipped docs are clean right now (DC-02/03),
 *   - the scanner is still finding what it claims to find (DC-04/05) — a guard whose file list or
 *     registration parse broke would report "0 stale" and pass, which is exactly the lie a green
 *     suite is most dangerous for, and
 *   - the guard fails when the drift is real (DC-06/07), by pointing it at a temp fixture with one
 *     wrong number and one deleted route.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'reanchor_audit_citations.js');
const AUDIT_DOC = 'docs/CUSTOMER_SCREEN_CONTRACT_AUDIT.md';

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond) });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

function run(args, cwd) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { exit: res.status, out: `${res.stdout || ''}${res.stderr || ''}`, error: res.error };
}

// "24 document(s) scanned: 0 stale and 0 dead citation(s)."
const FOOTER = /(\d+) document\(s\) scanned: (\d+) stale and (\d+) dead citation/;
const footer = (out) => out.match(FOOTER);
const perDoc = (out, rel) => {
  const line = out.split('\n').find((l) => l.startsWith(`${rel}:`));
  const m = line && line.match(/(\d+) correct/);
  return m ? Number(m[1]) : null;
};

const real = run(['--check'], ROOT);
const foot = footer(real.out);

check('DC-00', !real.error && fs.existsSync(SCRIPT),
  real.error ? `the guard could not run: ${real.error.message}` : `${path.relative(ROOT, SCRIPT)} runs`);
check('DC-01', Boolean(foot), foot ? `scanned ${foot[1]} document(s)` : 'the --check footer is missing, so the guard printed no verdict');
check('DC-02', foot && foot[2] === '0', foot ? `${foot[2]} stale derivable citation(s)` : 'not measured');
check('DC-03', foot && foot[3] === '0', foot ? `${foot[3]} citation(s) naming a route that is no longer registered` : 'not measured');

// Anti-vacuity, in two halves. The audit doc is the one this task derived line by line, so a
// healthy scanner must still be matching its citations; and the whole repo must still yield a
// substantial derived total. Either number falling to (near) zero means the scanner stopped
// reading server.js, not that the docs got better.
check('DC-04', perDoc(real.out, AUDIT_DOC) >= 35,
  `${AUDIT_DOC}: ${perDoc(real.out, AUDIT_DOC)} citations matched their registration`);
check('DC-05', foot && foot[1] >= 12, foot ? `${foot[1]} documents with server.js citations were scanned` : 'not measured');

// The guard must be able to go red. `--check` pointed at a fixture with one drifted number and one
// removed route has to report exactly that, or a clean run of the real docs proves nothing.
const fixture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nabin-citation-guard-')), 'fixture.md');
try {
  const body = (line) => `# Citations\n\n- \`POST /api/auth/send-otp\` ${line}\n`;
  fs.writeFileSync(fixture, body('(`server.js:1`) answers with a test OTP.'
    + '\n- `GET /api/this/route/was/never/registered` (`server.js:40`) is a finding.'), 'utf8');
  const bad = run(['--check', fixture], ROOT);
  const badFoot = footer(bad.out);
  check('DC-06', bad.exit === 1 && badFoot && badFoot[2] === '1' && badFoot[3] === '1',
    badFoot ? `a drifted fixture reported ${badFoot[2]} stale and ${badFoot[3]} dead (exit ${bad.exit})` : 'the fixture produced no verdict');

  const actual = run(['--list'], ROOT).out.split('\n').find((l) => /POST \/api\/auth\/send-otp$/.test(l.trim()));
  const liveLine = Number((actual || '').trim().split(/\s+/)[0]);
  fs.writeFileSync(fixture, body(`(\`server.js:${liveLine}\`) answers with a test OTP.`), 'utf8');
  const good = run(['--check', fixture], ROOT);
  check('DC-07', good.exit === 0 && footer(good.out)[2] === '0' && liveLine > 0,
    liveLine ? `the same fixture with the derived line ${liveLine} passes clean (exit ${good.exit})` : 'the registration for send-otp was not found to fix it with');
} finally {
  fs.rmSync(path.dirname(fixture), { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log('\n========================================================================');
console.log(`📊 DOC CITATION GUARD: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
console.log('========================================================================');
if (failed.length) console.log('Fix: node scripts/reanchor_audit_citations.js --write');
process.exit(failed.length ? 1 : 0);
