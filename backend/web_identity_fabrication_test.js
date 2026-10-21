/*
 * IDW: the customer web app may install a demo session, but it may not install a verified identity.
 *
 * This tree reached that false claim two ways, and both are measured here:
 *
 *  1. A demo path STAMPING the verified value. `src/context/AuthContext.tsx` used to build its rehydrated
 *     persona with `identityStatus: 'VERIFIED'`, and `src/app/login/page.tsx` minted the same stamp from both
 *     declared demo buttons ("Explore Customer Portal (Demo Mode)", "Instant Demo Sign-In"). Every screen under
 *     `useSession` reads that object, so the stamp was the app's only answer to "has this account been
 *     identity-verified?". IDW-06/07/10 keep it pinned to the backend's own unresolved value instead.
 *  2. A gate reading ABSENCE as verification. `src/app/ride/page.tsx` gated its submit on
 *     `user.identityStatus && user.identityStatus !== "VERIFIED"`, so an account that supplied no identity
 *     status at all was treated as verified — and absence is reachable, because the field is optional on the
 *     `User` interface. IDW-24 evaluates the extracted predicate against every answer a read can produce, and
 *     IDW-25 requires the notice to say WHICH kind of non-verified account it is describing.
 *
 * What the false claim does, measured rather than asserted:
 *  - `src/app/profile/page.tsx` renders the status through its own `IDENTITY` map, whose verified entry is
 *    `{ label: "Verified", tone: "success", note: "You can book every NABIN service." }`. A demo session
 *    therefore paints a green "Verified" badge and promises every service is bookable.
 *  - `src/app/ride/page.tsx` gates its submit on the same field, so the stamp is what unlocks a form whose
 *    POST the backend refuses anyway.
 *  - It is NOT an authorization hole. The only production site that decides anything from this field is
 *    `src/server.js` inside `POST /api/customer/book-ride`; it reads the server's own `req.user`, and
 *    `authenticateUser` runs before it. IDW-18 to IDW-23 measure that against this tree's backend instead of
 *    claiming it: the client-minted demo bearer gets a 4xx with no job, so no booking was ever at stake.
 *    The defect is truthfulness — a screen telling a customer that an identity check passed when none ran.
 *
 * Three rules pull against each other, and all three are in the checks:
 *  - The demo persona is an advertised feature (P11 requirement 4). A fix that deletes the persona, the
 *    demo branch, or either button to make the leak disappear reddens IDW-09.
 *  - Dropping the `identityStatus` line is NOT the fix either: the app would then be reporting an account
 *     whose status it never asked about. IDW-08 requires the demo path to keep carrying a status — the
 *     backend's own unresolved one — and IDW-24 makes the gate fail closed whether or not it does.
 *  - The e2e suite seeds a demo session straight into `localStorage`, and six of those seeds carried the
 *    verified stamp. Measured, nothing in the tree reads that key and the demo branch rebuilds its persona in
 *    code, so no test needed the claim: IDW-26 corrects the demo seeds, and IDW-27 proves the correction did
 *    not flatten the fixtures that genuinely require a verified user to test the legitimate flow.
 *
 * The vocabulary is derived, never typed in here. "Verified" comes from the backend's own gate comparison,
 * the unresolved status from the backend's own fallback at `GET /api/identity/status/:userId` and the
 * login-time hydration mapping in `src/database.js`, and the whole client-visible set from migration 001's
 * `CHECK` constraint. A fix therefore cannot pass by inventing a fourth status, and this guard cannot drift
 * when the platform renames one.
 *
 * The static half adds no toolchain — customer-web has no test dependency and this suite does not add one.
 * The runtime half boots THIS tree's backend on 127.0.0.1 through the loopback target guard and sends only
 * requests that carry no valid session, so it writes no session, no job, no order and no ledger row
 * anywhere. The positive half of the fix ("an authoritative VERIFIED still restores the legitimate verified
 * state") is carried here by reading both sides of that contract from source (IDW-16); the server's own half
 * of it is measured on a durable approved fixture by `customer_identity_durability_test.js` (chain link 104,
 * B1/B2), which this suite deliberately does not re-run — minting a session for a verified fixture would
 * write `backend_sessions` rows to prove what another link already proves.
 */
'use strict';

process.env.NABIN_TEST_MODE = 'true';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, findFreePort } = require('./scripts/spawned_server');

// Booting src/server.js connects it to whatever store its environment declares, so the same refusal the
// writing suites use applies here even though this suite intends to write nothing.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'web_identity_fabrication_test' });

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'customer-web', 'src');
const CTX = path.join(WEB, 'context', 'AuthContext.tsx');
const LOGIN = path.join(WEB, 'app', 'login', 'page.tsx');
const PROFILE = path.join(WEB, 'app', 'profile', 'page.tsx');
const RIDE = path.join(WEB, 'app', 'ride', 'page.tsx');
const APILIB = path.join(WEB, 'lib', 'api.ts');
const SERVER = path.join(__dirname, 'src', 'server.js');
const DATABASE = path.join(__dirname, 'src', 'database.js');
const MIG001 = path.join(ROOT, 'supabase', 'migrations', '001_central_schema.sql');

const label = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// --- a scanner that knows strings, so a keyword inside prose is not a keyword ----------------
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
// Comments are blanked to spaces (offsets, and therefore line numbers, survive) so the words this guard
// looks for — `identityStatus`, `VERIFIED`, `setUser(`, `catch` — can only be found where they execute.
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
function bodyFrom(code, fromIdx) {
  const open = code.indexOf('{', fromIdx);
  if (open < 0) return null;
  const close = matchPair(code, open, '{', '}');
  if (close < 0) return null;
  return { start: open, end: close, text: code.slice(open, close + 1) };
}
// Top-level `key: value` pairs of an object literal, including ES6 shorthand. The value text is kept
// because the whole question here is whether a field was fed from a response or typed in by the browser.
function topLevelEntries(objText) {
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < objText.length; i++) {
    const c = objText[i];
    if (c === '"' || c === "'") { const e = endOfString(objText, i); if (depth >= 1) cur += objText.slice(i, e); i = e - 1; continue; }
    if (c === '`') { const e = endOfTemplate(objText, i); if (depth >= 1) cur += objText.slice(i, e + 1); i = e; continue; }
    if (c === '{' || c === '[' || c === '(') { depth++; if (depth > 1) cur += c; continue; }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth < 1) { if (cur.trim()) parts.push(cur); cur = ''; continue; }
      cur += c; continue;
    }
    if (c === ',' && depth === 1) { parts.push(cur); cur = ''; continue; }
    if (depth >= 1) cur += c;
  }
  const out = [];
  for (const raw of parts) {
    const t = raw.trim();
    const m = /^([A-Za-z_$][\w$]*)\s*:\s*([\s\S]+)$/.exec(t);
    if (m) { out.push({ key: m[1], value: m[2].trim() }); continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(t)) out.push({ key: t, value: t, shorthand: true });
  }
  return out;
}
const topLevelKeys = (objText) => [...new Set(topLevelEntries(objText).map((e) => e.key))];
const unquote = (s) => {
  const m = /^(["'])([\s\S]*)\1$/.exec(String(s).trim());
  return m ? m[2] : String(s).trim();
};
const isQuoted = (s) => /^(["'])[\s\S]*\1$/.test(String(s).trim());
const literalValue = (v) => (isQuoted(v) ? unquote(v) : null);

function routeBodyAt(src, registration) {
  const at = src.indexOf(registration);
  if (at < 0) return null;
  const arrow = src.indexOf('=>', at);
  return arrow < 0 ? null : bodyFrom(src, arrow + 2);
}
function successObjects(body) {
  const out = [];
  const re = /\bres\.json\(\s*\{/g;
  let m;
  while ((m = re.exec(body.text))) {
    const obj = bodyFrom(body.text, m.index + m[0].length - 1);
    if (obj && /\bsuccess:\s*true\b/.test(obj.text)) {
      out.push({ text: obj.text, keys: topLevelKeys(obj.text) });
    }
  }
  return out;
}
function catchBlocks(name, code, body) {
  const out = [];
  const re = /\bcatch\b/g;
  let m;
  while ((m = re.exec(body.text))) {
    const braceAt = body.text.indexOf('{', m.index);
    if (braceAt < 0) continue;
    const close = matchPair(body.text, braceAt, '{', '}');
    if (close < 0) continue;
    out.push({
      src: name,
      start: body.start + braceAt,
      end: body.start + close,
      line: lineOf(code, body.start + braceAt),
      text: body.text.slice(braceAt, close + 1),
    });
  }
  return out;
}

const SOURCES = [['AuthContext.tsx', CTX], ['login/page.tsx', LOGIN], ['profile/page.tsx', PROFILE],
  ['ride/page.tsx', RIDE], ['lib/api.ts', APILIB], ['server.js', SERVER], ['database.js', DATABASE],
  ['001_central_schema.sql', MIG001]];
const gone = SOURCES.filter(([, f]) => !fs.existsSync(f)).map(([n]) => n);
if (gone.length) {
  check('IDW-00', false, `${gone.length} source(s) this guard reads are gone: ${gone.join(', ')} — nothing below can be measured`);
  process.exitCode = 1;
  finish();
  return;
}

const A = blankComments(fs.readFileSync(CTX, 'utf8'));
const L = blankComments(fs.readFileSync(LOGIN, 'utf8'));
const PR = blankComments(fs.readFileSync(PROFILE, 'utf8'));
const R = blankComments(fs.readFileSync(RIDE, 'utf8'));
const API = blankComments(fs.readFileSync(APILIB, 'utf8'));
const S = blankComments(fs.readFileSync(SERVER, 'utf8'));
const D = blankComments(fs.readFileSync(DATABASE, 'utf8'));
const MIG = fs.readFileSync(MIG001, 'utf8');

// =====================================================================================
// The vocabulary, derived from the platform rather than typed into this file
// =====================================================================================

// "Verified" — the backend's own gate comparison, the one production site that decides anything from it.
const BOOK_RIDE_REG = "app.post('/api/customer/book-ride'";
const bookRideRegAt = S.indexOf(BOOK_RIDE_REG);
const bookRideBody = routeBodyAt(S, BOOK_RIDE_REG);
const gateMatches = [...S.matchAll(/user\.identityStatus\s*!==\s*(["'])([A-Z_]+)\1/g)];
const VERIFIED = gateMatches.length ? gateMatches[0][2] : null;
const gateLine = gateMatches.length ? `server.js:${lineOf(S, gateMatches[0].index)}` : 'NOT FOUND';
function gateState() {
  if (!bookRideBody || !gateMatches.length) return 'gate not located';
  const at = gateMatches[0].index - bookRideBody.start;
  const seg = bookRideBody.text.slice(at, at + 320);
  const status = /res\.status\((\d{3})\)/.exec(seg);
  return `${status ? status[1] : 'NO EXPLICIT STATUS (FAIL)'}`;
}

// The unresolved status the backend itself answers with when an account has no decided identity.
const IDSTATUS_REG = "app.get('/api/identity/status/:userId'";
const idStatusRegAt = S.indexOf(IDSTATUS_REG);
const idStatusBody = routeBodyAt(S, IDSTATUS_REG);
const unresolvedMatch = idStatusBody && /identityStatus:\s*[A-Za-z_$][\w$.]*\s*\|\|\s*(["'])([A-Z_]+)\1/.exec(idStatusBody.text);
const UNRESOLVED = unresolvedMatch ? unresolvedMatch[2] : null;

// The login-time hydration mapping: how the store's spelling becomes the one the client sees.
const hydrate = /entity\.identityStatus\s*=\s*dbUser\.identity_status\s*===\s*(["'])([A-Z_]+)\1\s*\?\s*(["'])([A-Z_]+)\3/.exec(D);
const STORE_UNRESOLVED = hydrate ? hydrate[2] : null;
const CLIENT_UNRESOLVED = hydrate ? hydrate[4] : null;

// The durable column: its default and its whole legal vocabulary.
const col = /identity_status\s+VARCHAR\(\d+\)\s+DEFAULT\s*(["'])([A-Z_]+)\1\s+CHECK\s*\(\s*identity_status\s+IN\s*\(([^)]*)\)/.exec(MIG);
const STORE_VOCAB = col ? [...col[3].matchAll(/(["'])([A-Z_]+)\1/g)].map((m) => m[2]) : [];
const STORE_DEFAULT = col ? col[2] : null;
const CLIENT_VOCAB = STORE_VOCAB.map((v) => (v === STORE_UNRESOLVED ? CLIENT_UNRESOLVED : v));

// The demo persona, exactly as the app builds it.
const demoGate = /([A-Za-z_$][\w$]*)\.startsWith\(\s*(["'])([^"']*)\2\s*\)/.exec(A);
const DEMO_PREFIX = demoGate ? demoGate[3] : null;
let demoBranch = null, demoObj = null;
if (demoGate) {
  const openParen = A.lastIndexOf('(', demoGate.index);
  const closeParen = matchPair(A, openParen, '(', ')');
  const brace = closeParen < 0 ? -1 : A.indexOf('{', closeParen);
  if (brace >= 0) {
    const b = bodyFrom(A, brace);
    if (b && /setUser\(/.test(b.text)) {
      demoBranch = b;
      demoObj = bodyFrom(b.text, b.text.indexOf('{', b.text.indexOf('setUser(')));
    }
  }
}
const demoEntries = demoObj ? topLevelEntries(demoObj.text) : [];
const demoStatusEntry = demoEntries.find((e) => e.key === 'identityStatus') || null;
const demoPersona = {};
for (const e of demoEntries) if (isQuoted(e.value)) demoPersona[e.key] = unquote(e.value);
const demoStatus = Object.prototype.hasOwnProperty.call(demoPersona, 'identityStatus') ? demoPersona.identityStatus : null;

// The credential the app mints for that persona, read out of the login page so the runtime probes ask the
// backend about the token the app really hands out rather than one written in this file.
const demoMints = [];
{
  const re = /\blogin\(\s*(["'])([^"']*)\1\s*,\s*\{/g;
  let m;
  while ((m = re.exec(L))) {
    if (!DEMO_PREFIX || !m[2].startsWith(DEMO_PREFIX)) continue;
    const obj = bodyFrom(L, m.index + m[0].length - 1);
    if (!obj) continue;
    const entries = topLevelEntries(obj.text);
    const statusEntry = entries.find((e) => e.key === 'identityStatus') || null;
    const open = L.lastIndexOf('<button', m.index);
    const close = L.indexOf('</button>', obj.end);
    demoMints.push({
      token: m[2],
      line: lineOf(L, m.index),
      entries,
      statusEntry,
      button: open < 0 || close < 0 ? null : L.slice(open, close + 9),
    });
  }
}
const DEMO_TOKEN = demoMints.length ? demoMints[0].token : null;

const mintsClaimVerified = demoMints.filter((d) => d.statusEntry && literalValue(d.statusEntry.value) === VERIFIED);
const mintsCarryVocab = demoMints.filter((d) => d.statusEntry && CLIENT_VOCAB.includes(literalValue(d.statusEntry.value) ?? ''));
const buttonsOk = demoMints.length > 0 && demoMints.every((d) => d.button && /type="button"/.test(d.button) && /Demo/.test(d.button));

// =====================================================================================
// Group A — witnesses and the derived vocabulary (a check cannot pass by finding nothing)
// =====================================================================================

check('IDW-01',
  Boolean(demoGate) && Boolean(demoObj) && demoMints.length > 0 && Boolean(bookRideBody) && bookRideRegAt >= 0
  && Boolean(idStatusBody) && Boolean(hydrate) && Boolean(col) && gateMatches.length > 0,
  `read: ${label(CTX)}:${lineOf(A, demoGate ? demoGate.index : 0)} demo branch `
  + `${demoGate ? `${demoGate[1]}.startsWith('${DEMO_PREFIX}')` : 'NOT FOUND (FAIL)'}, persona `
  + `${demoObj ? `${demoEntries.length} fields ${JSON.stringify(demoPersona)}` : 'NOT FOUND (FAIL)'}; `
  + `${label(LOGIN)} mints at line(s) ${demoMints.map((d) => d.line).join(', ') || 'NONE (FAIL)'} with token `
  + `${DEMO_TOKEN ? `${DEMO_TOKEN}` : 'NOT FOUND (FAIL)'}; gate ${gateMatches.length ? gateLine : 'NOT FOUND (FAIL)'}`
  + ` inside ${BOOK_RIDE_REG} (${bookRideRegAt < 0 ? 'route NOT FOUND (FAIL)' : `server.js:${lineOf(S, bookRideRegAt)}`}, `
  + `${bookRideBody ? `${bookRideBody.text.split('\n').length} lines` : 'NO BODY (FAIL)'}); identity-status route `
  + `${idStatusRegAt < 0 ? 'NOT FOUND (FAIL)' : `server.js:${lineOf(S, idStatusRegAt)}`}; hydration map `
  + `${hydrate ? `database.js:${lineOf(D, hydrate.index)}` : 'NOT FOUND (FAIL)'}; users.identity_status `
  + `${col ? `001_central_schema.sql:${lineOf(MIG, col.index)}` : 'NOT FOUND (FAIL)'} — every derived value below comes from these`);

const gateRegistration = bookRideRegAt < 0 ? '' : S.slice(bookRideRegAt, S.indexOf('=>', bookRideRegAt));
check('IDW-02', VERIFIED !== null && gateMatches.length === 1 && Boolean(bookRideBody)
  && gateMatches[0].index >= bookRideBody.start && gateMatches[0].index <= bookRideBody.end
  && /authenticateUser/.test(gateRegistration),
  `the value this guard calls "a verified identity" is the backend's own, not a string chosen here: `
  + `${gateMatches.length} site(s) in server.js compare \`user.identityStatus !==\` `
  + `(${gateMatches.map((g) => `${gLine(g)} '${g[2]}'`).join('; ') || 'NONE (FAIL)'}), `
  + (bookRideBody && gateMatches.length ? `inside the ${BOOK_RIDE_REG} body, answered by ${gateState()}; ` : 'NOT inside the booking route (FAIL); ')
  + (/authenticateUser/.test(gateRegistration)
    ? 'and the registration runs authenticateUser first, so the gate reads the server\'s own session entity'
    : 'and the registration has NO authenticateUser (FAIL)'));

function gLine(g) { return `server.js:${lineOf(S, g.index)}`; }

check('IDW-03', UNRESOLVED !== null,
  `the unresolved status is the backend's own answer, not a choice made here: GET /api/identity/status/:userId `
  + `(server.js:${idStatusRegAt < 0 ? 'NOT FOUND' : lineOf(S, idStatusRegAt)}) replies `
  + (unresolvedMatch
    ? `with \`identityStatus: user.identityStatus || '${UNRESOLVED}'\` at server.js:${lineOf(S, idStatusBody.start + unresolvedMatch.index)}, `
      + 'so an account with no decided identity is reported as unverified rather than assumed verified'
    : 'WITHOUT a fallback (FAIL)'));

check('IDW-04', STORE_VOCAB.length > 0 && CLIENT_VOCAB.includes(VERIFIED) && CLIENT_VOCAB.includes(UNRESOLVED),
  `users.identity_status is declared at 001_central_schema.sql:${col ? lineOf(MIG, col.index) : 'NOT FOUND'} as VARCHAR `
  + `DEFAULT '${STORE_DEFAULT ?? '?'}' CHECK IN [${STORE_VOCAB.join(', ') || 'NOT FOUND (FAIL)'}]. database.js:${hydrate ? lineOf(D, hydrate.index) : 'NOT FOUND'} `
  + `hydrates the store's '${STORE_UNRESOLVED ?? '?'}' as the client's '${CLIENT_UNRESOLVED ?? '?'}', so the client-visible set is `
  + `[${CLIENT_VOCAB.join(', ')}] — it contains both the verified value ('${VERIFIED}') the gate compares and the unresolved value `
  + `('${UNRESOLVED}') the backend falls back to, which is what IDW-08 measures the demo path against`);

const usersTableAt = MIG.search(/CREATE TABLE IF NOT EXISTS users \(/);
const idIsUuid = usersTableAt >= 0 && /CREATE TABLE IF NOT EXISTS users \(\s*\r?\n\s*id UUID PRIMARY KEY/.test(MIG);
check('IDW-05', STORE_DEFAULT !== null && STORE_DEFAULT !== VERIFIED && idIsUuid
  && typeof demoPersona.id === 'string' && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(demoPersona.id),
  `the store could not agree with the claim even if it were asked to: users.identity_status defaults to `
  + `'${STORE_DEFAULT ?? 'NOT FOUND'}', which ${STORE_DEFAULT === VERIFIED ? 'IS the verified value (FAIL)' : 'is NOT the verified value'} — `
  + 'the durable default is unverified. '
  + `And users.id is ${idIsUuid ? 'UUID PRIMARY KEY' : 'NOT proven UUID (FAIL)'} at 001_central_schema.sql:${usersTableAt < 0 ? 'NOT FOUND' : lineOf(MIG, usersTableAt)}, `
  + `while the persona id is '${demoPersona.id ?? 'ABSENT'}' (${/^[0-9a-f]{8}-/.test(String(demoPersona.id ?? '')) ? 'a UUID' : 'not a UUID'}), `
  + `so no users row can carry that identity. backend/src mentions of the persona: ${backendMintsPersona()}`);

function backendMintsPersona() {
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(js|sql)$/.test(ent.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (src.includes('customer-demo-01') || (DEMO_TOKEN && src.includes(DEMO_TOKEN))) hits.push(label(p));
    }
  };
  walk(path.join(__dirname, 'src'));
  return hits.length ? hits.join(', ') : 'none (the persona exists only in the browser)';
}

// =====================================================================================
// Group B — the false claim itself
// =====================================================================================

check('IDW-06', Boolean(demoObj) && demoStatus !== null && demoStatus !== VERIFIED,
  demoObj
    ? `demo rehydration at ${label(CTX)}:${lineOf(A, demoBranch.start)} stamps identityStatus: '${demoStatus ?? 'ABSENT (FAIL)'}' `
      + `on the persona, while the backend's verified value is '${VERIFIED}'. `
      + (demoStatus === null
        ? "No status is claimed at all — that is IDW-08's business, because the ride gate reads an absent status as verified."
        : demoStatus === VERIFIED
          ? 'A token this app minted in the browser asserts an identity check that no server ever ran.'
          : 'The persona is presented as not-verified.')
    : `NO persona literal in the demo branch (FAIL) — the claim could not be read`);

check('IDW-07', demoMints.length > 0 && mintsClaimVerified.length === 0,
  `${demoMints.length} demo mint(s) in ${label(LOGIN)}: `
  + (demoMints.length
    ? demoMints.map((d) => `line ${d.line} → ${d.statusEntry ? `'${literalValue(d.statusEntry.value) ?? d.statusEntry.value}'` : 'NO identityStatus'}`).join('; ')
    : 'NONE FOUND (FAIL)')
  + `. Verified means '${VERIFIED}' to this platform, so ${mintsClaimVerified.length} of them assert an identity `
  + `verification the login page never performed${mintsClaimVerified.length ? ' — a customer clicking a Demo button is told their documents were approved' : ''}`);

check('IDW-08', demoStatus !== null && CLIENT_VOCAB.includes(demoStatus)
  && demoMints.length > 0 && mintsCarryVocab.length === demoMints.length
  && /identityStatus\?:\s*string\s*;/.test(A),
  `the demo path carries identityStatus '${demoStatus ?? 'ABSENT (FAIL)'}' (login page: `
  + `${demoMints.map((d) => `'${d.statusEntry ? (literalValue(d.statusEntry.value) ?? d.statusEntry.value) : 'ABSENT'}'`).join(', ') || 'none found'}), `
  + `which ${CLIENT_VOCAB.includes(String(demoStatus)) ? 'is a status the platform already has' : 'is NOT in the platform vocabulary'} `
  + `[${CLIENT_VOCAB.join(', ')}] — no fourth status invented here — and the \`User\` interface still declares `
  + `\`${(A.match(/identityStatus\?:\s*[^;]+;/) || ['NOT FOUND (FAIL)'])[0]}\`, so the identity-status contract is unchanged`);

check('IDW-09', Boolean(demoObj) && ['id', 'name', 'phone', 'role'].every((k) => k in demoPersona)
  && demoMints.length === 2 && buttonsOk,
  `the declared demo feature survives: the persona still carries [${Object.keys(demoPersona).join(', ')}], and `
  + `${demoMints.length} demo button(s) ${demoMints.map((d) => `line ${d.line}`).join(', ')} `
  + `${buttonsOk ? 'are still type="button" and labelled Demo' : 'are NOT both type="button" and labelled Demo (FAIL)'}. `
  + 'Browsing the sample persona is a feature; claiming it passed an identity check is the defect, so a fix that deletes '
  + 'either the persona or a button is not a fix');

// Every place the browser-side code touches this field, classified and reported. A fix that moves the
// fabrication to another file shows up here instead of hiding.
const reach = [];
{
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(ent.name)) continue;
      const src = blankComments(fs.readFileSync(p, 'utf8'));
      src.split(/\r?\n/).forEach((ln, i) => {
        if (!/identityStatus/.test(ln)) return;
        const assign = /identityStatus\s*:\s*(["'])([^"']*)\1/.exec(ln);
        const read = /(?:user|session|entity)\.identityStatus/.test(ln);
        reach.push({
          site: `${label(p)}:${i + 1}`,
          kind: assign ? 'assigns literal' : read ? (/!==|===|\[/.test(ln) ? 'compares/looks up' : 'reads') : 'declares',
          value: assign ? assign[2] : null,
        });
      });
    }
  };
  walk(WEB);
}
const lying = reach.filter((r) => r.kind === 'assigns literal' && r.value === VERIFIED);
check('IDW-10', reach.length > 0 && lying.length === 0,
  `${reach.length} identityStatus site(s) across customer-web/src: ${reach.map((r) => `${r.site} ${r.kind}${r.value ? ` '${r.value}'` : ''}`).join('; ')}. `
  + `${lying.length ? `${lying.length} of them ASSIGN the backend's verified value '${VERIFIED}' from browser code` : 'none assigns the verified value'}`);

// =====================================================================================
// Group C — the consumers, evaluated rather than string-matched
// =====================================================================================

const profileMap = (() => {
  const m = /const\s+IDENTITY\b[^=]*=\s*\{/.exec(PR);
  if (!m) return null;
  const obj = bodyFrom(PR, m.index + m[0].length - 1);
  if (!obj) return null;
  const entries = {};
  for (const e of topLevelEntries(obj.text)) {
    const nested = e.value.trim().startsWith('{') ? topLevelEntries(e.value) : [];
    entries[e.key] = Object.fromEntries(nested.map((n) => [n.key, literalValue(n.value) ?? n.value]));
  }
  const fb = /\]\s*\?\?\s*\{/.exec(PR.slice(m.index));
  const fbObj = fb ? bodyFrom(PR, m.index + fb.index + fb[0].length - 1) : null;
  return {
    at: m.index,
    entries,
    fallback: fbObj ? Object.fromEntries(topLevelEntries(fbObj.text).map((n) => [n.key, literalValue(n.value) ?? n.value])) : null,
  };
})();
const verifiedEntry = profileMap ? profileMap.entries[VERIFIED] : null;
const demoEntry = profileMap && demoStatus !== null ? profileMap.entries[demoStatus] : null;

check('IDW-11', Boolean(profileMap) && Boolean(verifiedEntry) && Boolean(demoEntry) && Boolean(profileMap.fallback)
  && demoEntry.tone !== verifiedEntry.tone && demoEntry.label !== verifiedEntry.label
  && profileMap.fallback.tone !== verifiedEntry.tone,
  `the badge is rendered by ${label(PROFILE)}'s own map, read here as data: [${profileMap ? Object.keys(profileMap.entries).join(', ') : 'NOT FOUND (FAIL)'}]. `
  + `'${VERIFIED}' → ${JSON.stringify(verifiedEntry ?? null)}. The demo persona's status '${demoStatus ?? 'ABSENT'}' → `
  + `${demoEntry ? JSON.stringify(demoEntry) : 'NOT A KEY — falls through to the unknown branch'}. A status the map does not know → `
  + `${JSON.stringify(profileMap ? profileMap.fallback : null)}. So a demo session renders `
  + `${demoEntry && verifiedEntry ? (demoEntry.label === verifiedEntry.label ? 'THE VERIFIED LABEL AND TONE (FAIL)' : `'${demoEntry.label}' with tone '${demoEntry.tone}', not '${verifiedEntry.label}'/'${verifiedEntry.tone}'`) : 'no verified label'}`);

const predMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*identityStatus[^;]*);/.exec(R);
const predName = predMatch ? predMatch[1] : null;
let pred = null, predErr = null;
if (predMatch) {
  try { pred = new Function('user', `return (${predMatch[2]});`); } catch (e) { predErr = String(e && e.message); }
}
const predLiteral = predMatch && /!==\s*(["'])([A-Z_]+)\1/.exec(predMatch[2]);
const demoBlocked = pred ? Boolean(pred(Object.assign({}, demoPersona))) : null;
const verifiedAllowed = pred ? Boolean(pred({ identityStatus: VERIFIED })) : null;
const absentAllowed = pred ? !Boolean(pred({})) : null;

check('IDW-12', Boolean(pred) && Boolean(predLiteral) && predLiteral[2] === VERIFIED
  && demoBlocked === true && verifiedAllowed === false,
  `the gate at ${label(RIDE)}:${predMatch ? lineOf(R, predMatch.index) : 'NOT FOUND'} is \`${predName} = ${predMatch ? predMatch[2].trim() : 'NOT FOUND (FAIL)'}\``
  + `, evaluated as written: the persona the app installs ${JSON.stringify(demoPersona)} → `
  + `${demoBlocked === null ? `NOT EVALUATED (FAIL: ${predErr})` : demoBlocked ? 'BLOCKED' : 'ALLOWED (FAIL)'}. `
  + `A user the backend reported as '${VERIFIED}' → ${verifiedAllowed === null ? 'NOT EVALUATED (FAIL)' : verifiedAllowed ? 'BLOCKED (FAIL — the legitimate verified flow would be broken)' : 'ALLOWED'}. `
  + `The gate compares '${predLiteral ? predLiteral[2] : 'ABSENT'}', which ${predLiteral && predLiteral[2] === VERIFIED ? 'is' : 'is NOT'} the backend's own verified value. `
  + `A user with NO identityStatus is ${absentAllowed === null ? 'not evaluated' : absentAllowed ? 'ALLOWED — the fail-open that is why IDW-08 requires the demo path to carry a status rather than drop the field' : 'blocked'}`);

const noticeBlock = (() => {
  if (!predName) return null;
  const m = new RegExp(`\\{${predName} && \\(`).exec(R);
  if (!m) return null;
  const open = R.indexOf('(', m.index + m[0].length - 1);
  if (open < 0) return null;
  const close = matchPair(R, open, '(', ')');
  if (close < 0) return null;
  return { line: lineOf(R, m.index), text: R.slice(open, close + 1) };
})();
const submitGate = new RegExp(`disabled=\\{[^}]*${predName}[^}]*\\}`).test(R);
check('IDW-13', Boolean(noticeBlock) && submitGate && !new RegExp(`["']${VERIFIED}["']`).test(noticeBlock.text)
  && /blocked/i.test(noticeBlock.text),
  `the label and the action agree: \`${predName}\` renders a status notice at ${label(RIDE)}:${noticeBlock ? noticeBlock.line : 'NOT FOUND'} `
  + `(${noticeBlock ? noticeBlock.text.replace(/\s+/g, ' ').slice(0, 150) : 'no block (FAIL)'}...) and disables the submit `
  + `(${submitGate ? 'yes' : 'NOT wired (FAIL)'}); the notice ${/blocked/i.test(noticeBlock ? noticeBlock.text : '') ? 'says bookings are blocked and' : 'does NOT say bookings are blocked (FAIL), and'} `
  + `claims no passed check${noticeBlock && !new RegExp(`["']${VERIFIED}["']`).test(noticeBlock.text) ? '' : ' (FAIL)'}`);

// The gate has to fail CLOSED, and IDW-12 alone does not prove that: it asks three personas.
// `user.identityStatus && user.identityStatus !== "VERIFIED"` treats an ABSENT, null or empty status as
// "not blocked" — the same false claim this brief exists to remove, carried by a missing field instead of a
// typed one. Absence is reachable: `identityStatus?` is optional on the `User` interface (IDW-08), and a
// failed or refused read leaves it unset. These personas are every answer a read can produce, and the
// predicate extracted above is run against each of them.
const GATE_PERSONAS = [
  [`the backend's '${VERIFIED}' answer`, { identityStatus: VERIFIED }, false],
  [`the unresolved answer '${UNRESOLVED ?? '?'}'`, { identityStatus: UNRESOLVED }, true],
  ['the persona the app installs', Object.assign({}, demoPersona), true],
  ['an absent identityStatus', {}, true],
  ['a null identityStatus', { identityStatus: null }, true],
  ['an empty identityStatus', { identityStatus: '' }, true],
  ['a value outside the vocabulary', { identityStatus: 'NOT_A_STATUS' }, true],
];
const gateEval = GATE_PERSONAS.map(([name, persona, expectBlock]) => {
  let blocks = null, err = null;
  try { if (pred) blocks = Boolean(pred(persona)); } catch (e) { err = String(e && e.message); }
  return { name, expectBlock, blocks, err };
});
const gateBad = gateEval.filter((g) => g.blocks === null || g.blocks !== g.expectBlock);
check('IDW-24', Boolean(pred) && gateEval.length === GATE_PERSONAS.length && gateBad.length === 0,
  `the booking gate \`${predName ?? 'NOT FOUND'}\` at ${label(RIDE)}:${predMatch ? lineOf(R, predMatch.index) : 'NOT FOUND'}`
  + ` was evaluated as written against ${gateEval.length} personas: `
  + gateEval.map((g) => `${g.name} → ${g.blocks === null ? `NOT EVALUATED${g.err ? ` (${g.err})` : ''}` : g.blocks ? 'BLOCKED' : 'ALLOWED'}`
    + `${g.blocks === g.expectBlock ? '' : ` (FAIL: ${g.expectBlock ? 'an identity the app cannot read must not open the gate' : 'the legitimate verified flow must stay open'})`}`).join('; ')
  + `. ${gateBad.length ? `${gateBad.length} of them disagree with the server's own condition`
    : `one rule for every shape — only an authoritative '${VERIFIED}' opens the gate, which is exactly the backend's condition at ${gateLine}`}`);

// And the notice is judged as prose rather than as one fixed sentence, because what it owes the customer now
// depends on WHICH kind of non-verified account it describes. Quoted string literals and bare JSX text are
// both collected, so the check cannot be satisfied by moving the copy out of the block that renders it.
function noticeSentences(blk) {
  if (!blk) return [];
  const quoted = [...blk.text.matchAll(/(["'])((?:(?!\1)[^\n]){20,})\1/g)].map((m) => m[2].trim());
  const bare = blk.text
    .replace(/<\/?[A-Za-z][\w:.-]*[^>]*>/g, '\n')
    .replace(/\{[^{}]*\}/g, '\n')
    .split('\n').map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.split(' ').length >= 4);
  return [...new Set([...quoted, ...bare].filter((s) => /identit|bookings?|account/i.test(s)))];
}
const sentences = noticeSentences(noticeBlock);
const unreadSaid = sentences.filter((s) => /could not read|not read|cannot be read|unavailable|unknown/i.test(s));
const pendingSaid = sentences.filter((s) => /pending/i.test(s));
const withoutConsequence = sentences.filter((s) => !/blocked/i.test(s));
check('IDW-25', Boolean(noticeBlock) && sentences.length >= 2 && unreadSaid.length > 0 && pendingSaid.length > 0
  && withoutConsequence.length === 0,
  `the notice at ${label(RIDE)}:${noticeBlock ? noticeBlock.line : 'NOT FOUND'} is read as prose: `
  + `${sentences.length} sentence(s) about this account's identity [${sentences.map((s) => `"${s}"`).join(' | ')}]. `
  + `An identity the app could not READ needs its own words — `
  + `${unreadSaid.length ? `"${unreadSaid[0]}"` : 'NONE, so a status that was never supplied and a pending one get the same sentence (FAIL)'}; `
  + `a status the backend really returned but that is not verified keeps `
  + `${pendingSaid.length ? `"${pendingSaid[0]}"` : 'no sentence at all (FAIL)'}; and `
  + `${withoutConsequence.length ? `${withoutConsequence.length} sentence(s) do NOT state the consequence (FAIL)` : 'every one of them states that bookings are blocked'}. `
  + 'An absence is not a verification, so the copy may not imply one from either direction');

const fallbacks = [];
for (const [name, src] of [[label(CTX), A], [label(LOGIN), L], [label(PROFILE), PR], [label(RIDE), R]]) {
  for (const m of src.matchAll(/identityStatus\s*(?:\?\?|\|\|)\s*(["'])([^"']*)\1/g)) {
    fallbacks.push({ site: `${name}:${lineOf(src, m.index)}`, value: m[2], isVerified: m[2] === VERIFIED });
  }
}
check('IDW-14', fallbacks.every((f) => !f.isVerified),
  `${fallbacks.length} fallback on this field exist in the client: `
  + `${fallbacks.length ? fallbacks.map((f) => `at ${f.site} → '${f.value}'${f.isVerified ? ' [SUPPLIES THE VERIFIED CLAIM (FAIL)]' : ''}`).join('; ') : 'none'}. `
  + 'An absent identity is therefore read from the server or shown as unresolved, never defaulted to verified');

const initBody = bodyFrom(A, A.indexOf('const initAuth'));
const initCatches = initBody ? catchBlocks(label(CTX), A, initBody) : [];
const otpBody = /const handleVerifyOtp = async/.test(L) ? bodyFrom(L, L.indexOf('const handleVerifyOtp')) : null;
const otpCatches = otpBody ? catchBlocks(label(LOGIN), L, otpBody) : [];
const allCatches = [...initCatches, ...otpCatches];
const catchReport = allCatches.map((c) => `${c.src}:${c.line} setUser:${/setUser\(/.test(c.text) ? 'YES (FAIL)' : 'no'}, login-call:${/\blogin\(\s*["']/.test(c.text) ? 'YES (FAIL)' : 'no'}, token dropped:${/removeItem\(\s*(['"])nabin_customer_token\1/.test(c.text) ? 'yes' : 'no'}, shown to the user:${/setError\(/.test(c.text) ? 'yes' : 'no'}`);
check('IDW-15', initCatches.length > 0 && otpCatches.length > 0 && allCatches.every((c) => !/setUser\(/.test(c.text) && !/\blogin\(\s*["']/.test(c.text)),
  `${allCatches.length} catch block(s) on the two paths that decide who is signed in (${catchReport.join('; ')}). `
  + 'A failed or refused identity read leaves the customer signed out with a message, not signed in as someone verified');

// =====================================================================================
// Group D — the authoritative source, read from both sides
// =====================================================================================

const meRegAt = S.indexOf("app.get('/api/auth/me'");
const meBody = routeBodyAt(S, "app.get('/api/auth/me'");
const meSuccess = meBody ? successObjects(meBody) : [];
const ctxAuthCall = /await\s+authApi\.me\(\)/.test(A);
const ctxAssignsResponse = /setUser\(\s*res\.data\.user\s*\)/.test(A);
const apiMePath = (API.match(/me:\s*\(\)\s*=>\s*api\.get\(\s*(["'])([^"']*)\1/) || [])[2] || null;
const projection = /function\s+projectUserForSelf[\s\S]{0,240}?const\s*\{\s*([A-Za-z_$][\w$]*)(?:,\s*\.\.\.([A-Za-z_$][\w$]*))?\s*\}\s*=\s*entity;\s*return\s+\2\s*;/.exec(S);
check('IDW-16', ctxAuthCall && ctxAssignsResponse && meSuccess.length > 0 && meSuccess.some((o) => o.keys.includes('user'))
  && apiMePath !== null && Boolean(projection) && projection[1] === 'rating',
  `the authoritative path is untouched and total: ${label(APILIB)} calls \`${apiMePath ?? 'NOT FOUND (FAIL)'}\` against `
  + `server.js:${meRegAt < 0 ? 'NOT FOUND (FAIL)' : lineOf(S, meRegAt)}, whose success object declares [${meSuccess.map((o) => o.keys.join(',')).join(' | ') || 'NONE (FAIL)'}]. `
  + `The provider is ${ctxAuthCall ? 'awaiting that call' : 'NOT calling it (FAIL)'} and assigns ${ctxAssignsResponse ? '`res.data.user` wholesale' : 'NOT the response user (FAIL)'}, `
  + `and the self-projection removes only \`${projection ? projection[1] : 'NOT PARSED (FAIL)'}\` from the entity, so an account the backend really verified still reaches `
  + `the screen as '${VERIFIED}' — the legitimate flow this correction had to preserve`);

check('IDW-17', gateState() === '403' && gateMatches.length === 1 && bookRideBody
  && /success:\s*false/.test(bookRideBody.text.slice(gateMatches[0].index - bookRideBody.start, gateMatches[0].index + 420)),
  `KYC enforcement is exactly as strong as before this change: the server's own gate (${gateLine}) refuses an account `
  + `whose identity is not '${VERIFIED}' with HTTP ${gateState()} and \`success: false\`, and it remains the one place server.js `
  + `reads the field to decide anything (${gateMatches.length} site). Every edit this brief authorises is client-side, so no `
  + `verification requirement was loosened to make a test pass`);

const E2E_DIR = path.join(ROOT, 'e2e-tests');
const e2eSeeds = [];
const e2eFiles = [];
{
  const demoBearer = DEMO_PREFIX
    ? new RegExp(`localStorage\\.setItem\\(\\s*(["'])\\w*token\\1\\s*,\\s*(["'])${DEMO_PREFIX}`)
    : null;
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|js)$/.test(ent.name)) continue;
      const src = blankComments(fs.readFileSync(p, 'utf8'));
      if (!demoBearer || !demoBearer.test(src)) continue;
      e2eFiles.push(label(p));
      for (const m of src.matchAll(/identityStatus\s*:\s*(["'])([^"']*)\1/g)) {
        e2eSeeds.push({
          site: `${label(p)}:${lineOf(src, m.index)}`,
          value: m[2],
          claimsVerified: m[2] === VERIFIED,
          inVocab: CLIENT_VOCAB.includes(m[2]),
        });
      }
    }
  };
  if (fs.existsSync(E2E_DIR)) walk(E2E_DIR);
}
const lyingSeeds = e2eSeeds.filter((s) => s.claimsVerified);
const offVocabSeeds = e2eSeeds.filter((s) => !s.inVocab);
check('IDW-26', e2eFiles.length > 0 && e2eSeeds.length > 0 && lyingSeeds.length === 0 && offVocabSeeds.length === 0,
  `${e2eFiles.length} e2e file(s) install a \`${DEMO_PREFIX ?? '?'}\`-prefixed bearer (${e2eFiles.join(', ') || 'NONE FOUND (FAIL)'}); `
  + `${e2eSeeds.length} identityStatus seed literal(s) sit beside one: ${e2eSeeds.map((s) => `${s.site} → '${s.value}'`).join('; ') || 'NONE FOUND (FAIL)'}. `
  + `A seed that carries a client-minted demo bearer is the same shape as the app's own demo path, so `
  + `${lyingSeeds.length ? `${lyingSeeds.length} of them claim '${VERIFIED}' with no server behind it (FAIL)` : 'none of them claims the verified value'} `
  + `and ${offVocabSeeds.length ? `${offVocabSeeds.length} use a status outside the platform vocabulary [${CLIENT_VOCAB.join(', ')}] (FAIL)` : 'every value used is in that vocabulary'}`);

// The other half of the same rule: a fix that unverifies EVERYTHING in the tree would clear IDW-06/07/10/26
// while destroying the only coverage of the legitimate verified flow. These four fixtures have to keep
// claiming verified, and the mobile screen test has to keep both states so the pair stays a comparison.
const KEEP_VERIFIED = [
  ['backend/customer_identity_durability_test.js', 'asserts a durable APPROVED decision reaches the client as verified (link 104)'],
  ['backend/customer_profile_edit_test.js', 'puts identity_status: \'' + VERIFIED + '\' in a PATCH payload and asserts the field does NOT move'],
  ['mobile/test/identity_verification_test.dart', 'renders the identity screen from a verified application row'],
  ['backend/src/database.js', 'seeds the usr_2 persona as verified, corroborated by its own APP-9018 SUBMITTED/APPROVED audit rows'],
];
const NON_VERIFIED_FIXTURES = CLIENT_VOCAB.filter((v) => v !== VERIFIED);
const keepRead = KEEP_VERIFIED.map(([rel, why]) => {
  const f = path.join(ROOT, rel);
  if (!fs.existsSync(f)) return { rel, why, at: 'FILE GONE', count: 0, missing: true };
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const hits = lines.map((ln, i) => [i + 1, ln]).filter(([, ln]) => ln.includes(String(VERIFIED)));
  return { rel, why, at: hits.length ? `${rel}:${hits[0][0]}` : 'NO OCCURRENCE', count: hits.length, missing: false };
});
const mobileFixture = keepRead.find((k) => k.rel.startsWith('mobile/')) || null;
const mobileBothStates = Boolean(mobileFixture) && !mobileFixture.missing
  && NON_VERIFIED_FIXTURES.some((v) => fs.readFileSync(path.join(ROOT, mobileFixture.rel), 'utf8').includes(v));
const keepLost = keepRead.filter((k) => k.count === 0);
check('IDW-27', keepRead.length === KEEP_VERIFIED.length && keepLost.length === 0 && mobileBothStates,
  `${keepRead.length} intentional verified fixture(s) still hold their claim, because a correction is only honest if the `
  + `legitimate flow is still tested: ${keepRead.map((k) => `${k.at || 'NOT READ'} (${k.count} line(s)) — ${k.why}`).join('; ')}. `
  + `${mobileBothStates ? 'and the mobile identity screen test still renders both a verified row and a non-verified one'
    : 'but the mobile identity screen test no longer pairs its verified fixture with a non-verified one (FAIL)'}`);

// =====================================================================================
// Runtime: does the fabricated claim have any counterpart on the authoritative side?
// =====================================================================================
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function req(baseUrl, method, urlPath, token, payload) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: Object.assign({ 'content-type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* a non-JSON answer is still a refusal if it is 4xx */ }
  const keys = json && typeof json === 'object' ? Object.keys(json) : [];
  return {
    status: res.status, keys,
    hasUser: keys.includes('user'),
    hasJob: keys.includes('job') || keys.includes('order') || keys.some((k) => /job$/i.test(k)),
    claimsVerified: text.includes(String(VERIFIED)),
    code: (json && (json.code || json.error)) || text.slice(0, 70),
  };
}

const RIDE_ATTEMPT = {
  customerId: typeof demoPersona.id === 'string' ? demoPersona.id : 'customer-demo-01',
  vehicleType: 'AUTO',
  pickup: { address: 'North Campus Girls Hostel, Delhi' },
  drop: { address: 'Aizawl Bazaar, Aizawl' },
};

async function runRuntime() {
  const port = await findFreePort();
  const proc = trackServer(spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname),
    windowsHide: true,
    env: Object.assign({}, process.env, { PORT: String(port), NABIN_SESSION_PRUNE: 'off', NABIN_SESSION_RECONCILE_MS: '0' }),
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
  const stderr = [];
  proc.stderr.on('data', (d) => stderr.push(String(d)));
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + 90000;
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await fetch(`${baseUrl}/api/health`)).status === 200; } catch (e) { /* not up yet */ }
    }
    check('IDW-18', ready,
      ready
        ? `the backend the app talks to booted on 127.0.0.1:${port} against the loopback store this run declared `
          + `(${PG_TARGET.host}:${PG_TARGET.port}/${PG_TARGET.database}, from ${PG_TARGET.source}) — the four requests below are `
          + 'answered by the routes the fabricated identity pretends to satisfy. Every one carries no valid session, so this '
          + 'suite writes no session, no job, no order and no ledger row'
        : `the backend never came up, so the runtime claims were NOT measured: ${stderr.join('').slice(-240)}`);
    if (!ready) return;

    const anon = await req(baseUrl, 'GET', '/api/auth/me', null, null);
    check('IDW-19', anon.status >= 400 && anon.status < 500 && !anon.hasUser && !anon.claimsVerified,
      `GET /api/auth/me with no credential: ${anon.status} ${anon.code}; body declares [${anon.keys.join(', ')}] → `
      + `${anon.hasUser ? 'A user OBJECT (FAIL)' : 'no user'}, and ${anon.claimsVerified ? `its text still contains '${VERIFIED}' (FAIL)` : `it does not contain '${VERIFIED}'`} — `
      + 'the authoritative source has no anonymous verified answer to give');

    const demo = DEMO_TOKEN ? await req(baseUrl, 'GET', '/api/auth/me', DEMO_TOKEN, null) : null;
    check('IDW-20', Boolean(demo) && demo.status >= 400 && demo.status < 500 && !demo.hasUser && !demo.claimsVerified,
      demo
        ? `GET /api/auth/me with the credential the app itself mints, \`${DEMO_TOKEN}\`: ${demo.status} ${demo.code}; `
          + `${demo.hasUser ? 'IT RETURNED A user (FAIL)' : 'no user in the body'}, and ${demo.claimsVerified ? `the answer contains '${VERIFIED}' (FAIL)` : `nothing in it says '${VERIFIED}'`} — `
          + 'the stamp the demo persona carried has no server counterpart to restore it from, which is why the only honest value '
          + 'for that field on this path is one the backend itself uses for an undecided identity'
        : 'the demo credential could not be read out of the login page, so the claim was NOT measured (FAIL)');

    const status = DEMO_TOKEN
      ? await req(baseUrl, 'GET', `/api/identity/status/${encodeURIComponent(RIDE_ATTEMPT.customerId)}`, DEMO_TOKEN, null)
      : null;
    check('IDW-21', Boolean(status) && status.status >= 400 && status.status < 500 && !status.claimsVerified,
      status
        ? `GET /api/identity/status/${RIDE_ATTEMPT.customerId} with that bearer: ${status.status} ${status.code}, `
          + `${status.claimsVerified ? `asserting '${VERIFIED}' (FAIL)` : 'asserting no verified identity'} — the route that is the `
          + 'authoritative status feed (server.js:' + (idStatusRegAt < 0 ? '?' : lineOf(S, idStatusRegAt)) + ') refuses the demo persona outright'
        : 'no demo credential to probe (FAIL)');

    const booking = await req(baseUrl, 'POST', '/api/customer/book-ride', DEMO_TOKEN, RIDE_ATTEMPT);
    check('IDW-22', booking.status >= 400 && booking.status < 500 && !booking.hasJob,
      `POST /api/customer/book-ride with that bearer and a placed-looking route: ${booking.status} ${booking.code}, `
      + `${booking.hasJob ? 'A JOB IN THE BODY (FAIL)' : 'no job returned'} — the false stamp could not have bought a booking, `
      + 'so what this correction removes is a claim, not a capability');

    const mint = /const token = `nabin_/.exec(D);
    const mintLine = mint ? D.slice(mint.index, D.indexOf('\n', mint.index)).trim() : null;
    const entropy = mintLine && /randomBytes\((\d+)\)/.exec(mintLine);
    const fixtureTokens = [...D.matchAll(/activeSessions\.set\(\s*(["'])([^"']*)\1/g)].map((m) => m[2]);
    check('IDW-23', Boolean(mint) && Boolean(entropy) && Number(entropy[1]) >= 16 && fixtureTokens.length > 0
      && fixtureTokens.every((t) => DEMO_PREFIX && !t.startsWith(DEMO_PREFIX)),
      `the refusal above is structural, not a fixture accident: sessions are minted at database.js:${mint ? lineOf(D, mint.index) : 'NOT FOUND (FAIL)'} as `
      + `${mintLine ? `"${mintLine.slice(0, 90)}"` : 'NOT READ (FAIL)'} — a ${entropy ? `${entropy[1]}-byte` : 'unreadable-length'} random suffix under the `
      + `\`nabin_\` prefix, which a \`${DEMO_PREFIX ?? '?'}\`-prefixed client string cannot be. The hard-coded development session keys this store does `
      + `accept are [${fixtureTokens.join(', ') || 'none'}], and ${fixtureTokens.filter((t) => DEMO_PREFIX && t.startsWith(DEMO_PREFIX)).length} of them start `
      + `with '${DEMO_PREFIX ?? '?'}'`);
  } finally {
    proc.kill();
  }
}

runRuntime().then(finish).catch((err) => {
  check('IDW-18', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 WEB IDENTITY FABRICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
