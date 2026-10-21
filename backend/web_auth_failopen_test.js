/*
 * A failed OTP attempt must not leave a customer holding a session that was never issued.
 *
 * The defect this file was written for is in `customer-web/src/app/login/page.tsx`, and it is a
 * fail-open in the one place a login screen is supposed to fail closed: the `catch`. When the
 * backend could not be reached, the screen checked the phone number for the shape of a demo
 * ("98765" / "demo") and then (a) advanced to the code step with `123456` already typed into the
 * box, and (b) on the verify step called `login("demo-customer-token", { … identityStatus:
 * "VERIFIED" })` and `return`ed as though the server had issued a session. So the difference
 * between "your code was wrong" and "our API is down" was invisible to the user, and an outage
 * minted a customer who is verified, has an id, and cannot read their own orders.
 *
 * The fabricated token does reach nowhere: measured against this tree's own backend, `Bearer
 * demo-customer-token` is refused by `/api/auth/me` (401) and `/api/customer/orders` (401), and it
 * buys exactly what no token buys. That is why this is a truthfulness defect rather than an
 * authorization hole — and why WAF-14 asserts the refusal instead of trusting it: if a backend
 * change ever starts accepting a client-minted token, that check reddens and the demo button
 * becomes a vulnerability report rather than a convenience.
 *
 * Two rules shape the guard, and they pull against each other:
 *  - The demo entry points are advertised features ("Explore Customer Portal (Demo Mode)",
 *    "Instant Demo Sign-In"). A fix that deletes them to make a leak go away destroys working
 *    development functionality, so WAF-07/WAF-08 require every demo session to come from a
 *    `type="button"` whose own label says Demo — and require at least one such button to exist.
 *  - A guard may not pass by finding nothing. Every check that scans reports what it located, and
 *    WAF-01/WAF-12 fail if the handlers or the files are not there to read.
 *
 * The static half needs no toolchain — customer-web has no test dependency and this suite does not
 * add one. The runtime half uses node's own `fetch` against a server this suite spawns on
 * 127.0.0.1, and sends nothing but GETs.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const LOGIN = path.join(__dirname, '..', 'customer-web', 'src', 'app', 'login', 'page.tsx');
const AUTHCTX = path.join(__dirname, '..', 'customer-web', 'src', 'context', 'AuthContext.tsx');
const APITS = path.join(__dirname, '..', 'customer-web', 'src', 'lib', 'api.ts');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// --- a scanner that knows strings, so a keyword inside prose is not a keyword --------------
function endOfString(text, i) {
  const q = text[i];
  let j = i + 1;
  while (j < text.length && text[j] !== '\n') {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === q) return j + 1;
    j++;
  }
  return j;
}
function endOfTemplate(text, start) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (ch === '"' || ch === "'") { j = endOfString(text, j); continue; }
        if (ch === '`') { j = endOfTemplate(text, j) + 1; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return text.length;
}
// Comments are blanked to spaces (offsets, and therefore line numbers, survive) so that the words
// this guard looks for — `login(`, `catch`, `setOtp` — can only be found where they execute.
function blankComments(text) {
  const out = text.split('');
  const wipe = (a, b) => {
    for (let k = a; k < b && k < out.length; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < text.length && text[j] !== '\n') j++;
      wipe(i, j); i = j; continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const at = text.indexOf('*/', i + 2);
      const end = at < 0 ? text.length : at + 2;
      wipe(i, end); i = end; continue;
    }
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = endOfTemplate(text, i) + 1; continue; }
    i++;
  }
  return out.join('');
}
function matchPair(text, i, openCh, closeCh) {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = endOfTemplate(text, i) + 1; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i;
    i++;
  }
  return -1;
}
// The `{ … }` block that starts an arrow/async body, found from a declaration offset.
function bodyFrom(code, fromIdx) {
  const open = code.indexOf('{', fromIdx);
  if (open < 0) return null;
  const close = matchPair(code, open, '{', '}');
  if (close < 0) return null;
  return { start: open, end: close, text: code.slice(open, close + 1) };
}
function catchBlocks(code, body) {
  const found = [];
  const re = /\bcatch\b\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(body.text))) {
    const open = body.start + m.index + m[0].length - 1;
    const close = matchPair(code, open, '{', '}');
    if (close < 0) continue;
    found.push({ start: open, end: close, text: code.slice(open, close + 1), line: lineOf(code, open) });
    re.lastIndex = m.index + m[0].length;
  }
  return found;
}
// A call is protected by being inside the block only if the name is actually invoked.
const calls = (text, name) => new RegExp('(?:^|[^\\w$.])' + name + '\\s*\\(').test(text);

const loginSrc = fs.readFileSync(LOGIN, 'utf8');
const ctxSrc = fs.readFileSync(AUTHCTX, 'utf8');
const apiSrc = fs.readFileSync(APITS, 'utf8');
const L = blankComments(loginSrc);
const C = blankComments(ctxSrc);

// --- locate the two handlers by what they ask the backend for, not by their names ----------
function handlerFor(callExpr) {
  const re = new RegExp('(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>', 'g');
  let m;
  while ((m = re.exec(L))) {
    const body = bodyFrom(L, m.index + m[0].length);
    if (body && new RegExp('authApi\\.' + callExpr).test(L.slice(body.start, body.end))) {
      return { name: m[1], line: lineOf(L, m.index), start: body.start, end: body.end, text: body.text };
    }
  }
  return null;
}
const sendH = handlerFor('sendOtp');
const verifyH = handlerFor('verifyOtp');

const sendCatches = sendH ? catchBlocks(L, sendH) : [];
const verifyCatches = verifyH ? catchBlocks(L, verifyH) : [];
const allCatches = [...sendCatches, ...verifyCatches];

check('WAF-01', Boolean(sendH && verifyH) && allCatches.length >= 2,
  `${sendH ? 'send-OTP handler ' + sendH.name + ' at line ' + sendH.line : 'NO send-OTP handler found'}; `
  + `${verifyH ? 'verify-OTP handler ' + verifyH.name + ' at line ' + verifyH.line : 'NO verify-OTP handler found'}; `
  + `${allCatches.length} catch block(s) located `
  + `(send ${sendCatches.map((c) => c.line).join(',') || 'none'}, verify ${verifyCatches.map((c) => c.line).join(',') || 'none'})`
  + (allCatches.length < 2 ? ' — the guard would pass by finding nothing, so it fails' : ''));

// Requirement 1 and 3 together: the failure branch says it failed, and does nothing else.
const prefilled = allCatches.filter((c) => /setOtp\(\s*['"]/.test(c.text));
check('WAF-02', prefilled.length === 0,
  prefilled.length
    ? `${prefilled.length} catch block(s) type an OTP into the field for the user: line ${prefilled[0].line} `
      + `runs ${prefilled[0].text.match(/setOtp\(\s*'[^']*'|setOtp\(\s*"[^"]*"/g).join(' + ')} — a code the server never sent`
    : `no catch block sets the OTP field to a literal, so a failure cannot prefill a credential (checked ${allCatches.length} block(s))`);

const advanced = allCatches.filter((c) => /setStep\(\s*['"]otp['"]/.test(c.text));
check('WAF-03', advanced.length === 0,
  advanced.length
    ? `${advanced.length} catch block(s) walk the user to the code step after the request failed: line ${advanced[0].line}`
    : `no catch block advances the form to the code step, so a screen only asks for a code the backend agreed to send`);

const sessions = allCatches.filter((c) => calls(c.text, 'login'));
check('WAF-04', sessions.length === 0,
  sessions.length
    ? `${sessions.length} catch block(s) create a session from the failure path: line ${sessions[0].line} `
      + `names ${sessions[0].text.match(/login\(\s*'[^']*'|login\(\s*"[^"]*"/g).join(' + ')} — an outage would sign somebody in`
    : `no catch block calls login(...), so a failed verification cannot create a session, mark the customer `
      + `verified, or return as though the server had issued one (checked ${allCatches.length} block(s))`);

const verifiedClaims = allCatches.filter((c) => /identityStatus/.test(c.text));
check('WAF-05', verifiedClaims.length === 0,
  verifiedClaims.length
    ? `${verifiedClaims.length} catch block(s) hand an identityStatus to a session: line ${verifiedClaims[0].line}`
    : `and no catch block asserts an identity status, which is the claim an unverified customer must not be given`);

const silent = allCatches.filter((c) => !/setError\(\s*[^)'"]/.test(c.text) || /setError\(\s*['"]['"]\s*\)/.test(c.text));
check('WAF-06', silent.length === 0,
  silent.length
    ? `${silent.length} catch block(s) end without showing a non-empty error: line ${silent[0].line} — `
      + `a failure the user cannot see is a failure they cannot retry knowingly`
    : `every catch block reports a non-empty error to the screen (${allCatches.map((c) => 'line ' + c.line).join(', ')})`);

// The busy flag has to come back off, or a failed attempt leaves the submit button disabled and
// "can retry explicitly" is a sentence nobody can test.
const handlers = [sendH, verifyH].filter(Boolean);
const stuckBusy = handlers.filter((h) => !/finally\s*\{[^}]*setIsLoading\(\s*false\s*\)/.test(h.text));
check('WAF-07', handlers.length === 2 && stuckBusy.length === 0,
  stuckBusy.length
    ? `${stuckBusy.length} handler(s) never clear the loading flag in a finally, leaving the button disabled: `
      + stuckBusy.map((h) => h.name).join(', ')
    : `both handlers clear the loading flag in a finally block, so a failed attempt leaves the form ready to retry`);

// --- requirements 4 and 7: the demo entry points stay, and stay labelled --------------------
// Every place a client-minted `demo-…` token enters a session, and who is allowed to write one.
const demoMints = [];
for (const m of L.matchAll(/login\(\s*['"]demo-[^'"]*['"]/g)) demoMints.push({ idx: m.index, line: lineOf(L, m.index) });
const insideCatch = demoMints.filter((d) => allCatches.some((c) => d.idx > c.start && d.idx < c.end));
check('WAF-08', demoMints.length > 0 && insideCatch.length === 0,
  demoMints.length === 0
    ? 'NO client-minted demo session exists in the login page any more — the advertised Demo Mode buttons are a '
      + 'feature, and a fix that deletes them is a regression this guard also refuses'
    : `${demoMints.length} demo-session site(s) at line(s) ${demoMints.map((d) => d.line).join(', ')}; `
      + (insideCatch.length
        ? `${insideCatch.length} of them sit in a catch block (line ${insideCatch[0].line}), which is the fail-open`
        : `none of them sits in a catch block, so every one is reached only by an explicit user action`));

// Each surviving demo mint must be inside a `type="button"` whose own rendered label says Demo.
const labelled = demoMints.filter((d) => {
  const bStart = L.lastIndexOf('<button', d.idx);
  const bEndRel = L.indexOf('</button>', d.idx);
  if (bStart < 0 || bEndRel < 0) return false;
  const el = L.slice(bStart, bEndRel);
  return /type="button"/.test(el) && /Demo/.test(el);
});
check('WAF-09', demoMints.length > 0 && labelled.length === demoMints.length,
  `${labelled.length}/${demoMints.length} demo-session site(s) are inside a type="button" element that says Demo in `
  + `its own label`
  + (labelled.length === demoMints.length
    ? ' — the feature stays clearly identified, so a demo session is never the user\'s only reading of "signed in"'
    : `: unlabelled at line(s) ${demoMints.filter((d) => !labelled.includes(d)).map((d) => d.line).join(', ')}`));

// The demo persona is a client-side fiction, and the two shapes that keep it a fiction are its own
// id and the prefix the session store keys on. If a demo persona were ever minted with an id that
// looks like a real account, or the store rehydrated any token starting `demo-` into a session
// without saying so, the "clearly identified" half of requirement 4 would be gone.
const persona = /login\(\s*['"]demo-[^'"]*['"]\s*,\s*\{([\s\S]*?)\}\s*\)/.exec(L);
const demoRehydrate = /token\.startsWith\(\s*['"]demo-['"]\s*\)/.test(C);
const personaIds = [...L.matchAll(/id:\s*['"](customer-demo[^'"]*)['"]/g)].map((m) => m[1]);
check('WAF-10', Boolean(persona) && personaIds.length > 0 && personaIds.every((s) => /demo/i.test(s)) && demoRehydrate,
  `${personaIds.length} demo persona id(s) [${personaIds.join(', ')||'none'}], each carrying the word demo, and `
  + `the session store rehydrates a client-minted token only behind the documented \`demo-\` prefix `
  + `(startsWith('demo-') present: ${demoRehydrate})`);

// --- the session store: cleanup must not leave a fabricated login standing ------------------
const logoutBody = (() => {
  const m = /\n\s*(?:const|function)\s+logout\b[^{]*/.exec(C);
  return m ? bodyFrom(C, m.index + m[0].length - 1) : null;
})();
check('WAF-11', Boolean(logoutBody) && /removeItem\(\s*['"]nabin_customer_token['"]/.test(logoutBody.text)
  && /setUser\(\s*null\s*\)/.test(logoutBody.text),
  logoutBody
    ? `logout clears ${/removeItem\(\s*['"]nabin_customer_token['"]/.test(logoutBody.text) ? 'the stored token' : 'NO token (FAIL)'} `
      + `and ${/setUser\(\s*null\s*\)/.test(logoutBody.text) ? 'the in-memory user' : 'NOT the in-memory user (FAIL)'}, `
      + `so no session survives the click that ended it`
    : 'no logout function could be located in AuthContext — requirement 6 (cleanup leaves no fabricated session) is unproven');

// A token the backend refuses has to be dropped, not kept for the next reload. The demo branch is
// exempt by design — it never claims a backend session — and WAF-09/WAF-10 are what keep it honest.
const initBody = (() => {
  const m = /const\s+initAuth\s*=\s*async[^{]*/.exec(C);
  return m ? bodyFrom(C, m.index + m[0].length - 1) : null;
})();
const initCatches = initBody ? catchBlocks(C, initBody) : [];
check('WAF-12', Boolean(initBody) && initCatches.length > 0
  && initCatches.every((c) => /removeItem\(\s*['"]nabin_customer_token['"]/.test(c.text)),
  initBody
    ? `the boot check ${initCatches.length ? `has ${initCatches.length} failure path(s), all of which remove the stored token` : 'has NO failure path (FAIL)'}; `
      + `a real token the server rejects cannot survive a reload, so a revoked session cannot resurrect itself`
    : 'no initAuth boot check could be located in AuthContext');

// --- runtime: what the fabricated token is actually worth to the backend --------------------
// Derived from the app's own call surface, so the claim tracks the client rather than a list.
// Both quote styles count: `api.get('/restaurants')` and `api.get(`/food/table-qr/${token}`)` are
// the same kind of call, and a surface read that silently skipped the templated half would be a
// smaller claim than the one WAF-15 says it made.
function customerGetRoutes() {
  const out = [];
  for (const m of apiSrc.matchAll(/api\.get\(\s*['"`](\/[^'"`]*)['"`]/g)) out.push(m[1]);
  return out;
}
const getRoutes = customerGetRoutes();

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function req(baseUrl, urlPath, token) {
  const res = await fetch(baseUrl + urlPath, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, text: await res.text() };
}

async function runRuntime() {
  const net = require('net');
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  await new Promise((r) => srv.close(r));
  const proc = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname),
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port) }),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stderr = [];
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90000;   // measured boot is ~13s idle, longer under load
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await req(baseUrl, '/api/health', null)).status === 200; } catch (e) { /* not up yet */ }
    }
    check('WAF-13', ready && getRoutes.length > 0,
      ready
        ? `the backend this client talks to booted on 127.0.0.1:${port}, and ${getRoutes.length} GET route(s) `
          + `were read out of customer-web/src/lib/api.ts: ${getRoutes.join(', ')}`
        : `the backend never came up, so the runtime claims below were NOT measured: ${stderr.join('').slice(-200)}`);
    if (!ready) return;

    const DEMO = 'demo-customer-token';
    const probes = [];
    for (const route of getRoutes) {
      const concrete = route.replace(/:([A-Za-z_]+)|\$\{[^}]*\}/g, 'nonexistent-id');
      const [withDemo, anonymous] = [await req(baseUrl, '/api' + concrete, DEMO), await req(baseUrl, '/api' + concrete, null)];
      probes.push({ route: '/api' + concrete, demo: withDemo.status, anon: anonymous.status });
    }
    // The routes this client treats as proof that a session exists: `authApi.me()` for the boot
    // check and `bookingApi.getOrders()` for the signed-in customer's own history.
    const PROOF = ['/api/auth/me', '/api/customer/orders'];
    const proof = PROOF.map((r) => {
      const p = probes.find((x) => x.route === r);
      return { route: r, status: p ? p.demo : 'NOT PROBED' };
    });
    check('WAF-14', proof.every((p) => p.status === 401),
      `a client-minted demo token is refused by every route the app uses as proof of login: `
      + proof.map((p) => `${p.route}=${p.status}`).join(', ')
      + ` — so the fail-open was a fake UI session, never access`);

    // And it buys nothing anywhere on the app's own surface: whatever the demo token gets, an
    // anonymous caller gets too. A route that starts answering a demo token differently is a route
    // that has begun to trust it, and this is the check that would say so.
    const richer = probes.filter((p) => p.demo !== p.anon);
    check('WAF-15', richer.length === 0,
      richer.length
        ? `${richer.length} route(s) answer a demo token differently from no token at all, i.e. they accept it: `
          + richer.map((p) => `${p.route} demo=${p.demo} anon=${p.anon}`).join(', ')
        : `and ${probes.length}/${probes.length} route(s) answer it exactly as they answer an anonymous caller, `
          + `so no surface grants a client-authored session more than nothing`);
  } finally {
    proc.kill();
  }
}

// --- the honest path stays honest -------------------------------------------
// Requirement 5: a registered customer signing in with a real code is unchanged, and the session
// it gets is the one the server issued. Asserted as structure rather than as a string search:
// exactly one `login(` in the verify handler, its first argument read off the response, and the
// call guarded by the backend's own success flag. Delete the real login and this goes red; so
// does routing it through anything the client invented.
const loginCalls = (body) => [...body.matchAll(/(?:^|[^[\w$.])login\s*\(\s*([^,)]+)/g)].map((m) => m[1].trim());
const verifyLogins = loginCalls(verifyH ? verifyH.text : '');
check('WAF-16', verifyLogins.length === 1 && verifyLogins[0] === 'res.data.token'
  && /if\s*\(\s*res\.data\.success\s*\)\s*\{[^{}]*login\(/.test(verifyH ? verifyH.text : ''),
  verifyH
    ? `the verify handler makes ${verifyLogins.length} session call(s) [${verifyLogins.join(' | ') || 'none'}], and `
      + `it is reached only inside \`if (res.data.success)\` — a token this server minted, never a literal`
    : 'no verify-OTP handler to inspect');

// And the code step is entered only on the same kind of answer: a 200 whose body says success.
const sendSteps = [...(sendH ? sendH.text : '').matchAll(/setStep\(\s*['"]otp['"]\s*\)/g)];
check('WAF-17', sendSteps.length === 1 && /if\s*\(\s*res\.data\.success\s*\)\s*\{\s*setStep\(\s*['"]otp['"]/.test(sendH ? sendH.text : ''),
  sendH
    ? `${sendSteps.length} advance-to-code-step call(s) in the send handler, ${
      /if\s*\(\s*res\.data\.success\s*\)\s*\{\s*setStep\(\s*['"]otp['"]/.test(sendH.text)
        ? 'gated on the backend saying it sent a code'
        : 'NOT gated on the backend\'s answer (FAIL)'}`
    : 'no send-OTP handler to inspect');

runRuntime().then(finish).catch((err) => {
  check('WAF-13', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 WEB AUTH FAIL-OPEN: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
