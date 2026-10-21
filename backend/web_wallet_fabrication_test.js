/*
 * WDW: the customer web wallet may show a balance it read, but it may not author its own money.
 *
 * `customer-web/src/app/wallet/page.tsx` is a screen about money that never asks the backend anything.
 * The four bullets below are what was measured in the file before the correction, and every one of them is
 * a site the checks still read out of the source, so a re-introduced claim reddens the line that names it:
 *
 *  - it destructures the session (`const { user, loading: authLoading } = useSession()`) and then never
 *    references `user` again — every number, row and status painted below it is written in this file;
 *  - `useState(1450)` seeds the balance, and the card prints `inr(balance)` as AVAILABLE BALANCE. ₹1,450
 *    appears nowhere in `backend/src`, in the migrations, or in any fixture this tree seeds;
 *  - `DEMO_TRANSACTIONS` is four rows — `DEMO-RECHARGE-101` ₹1,000 CREDIT, `DEMO-RD-9821` ₹220 DEBIT,
 *    `DEMO-ORD-4412` ₹380 DEBIT, `DEMO-PROMO-50` ₹50 CREDIT — each `status: "COMPLETED"`, each rendered as
 *    a receipt under "Recent Activity & Receipts";
 *  - `handleTopup` does `setBalance((prev) => prev + amt)`, prepends a fifth invented row, and announces
 *    `Successfully credited ${inr(amt)} to demo wallet!`.
 *
 * What the backend actually offers this screen, read rather than assumed:
 *  - A balance does exist durably (`users.wallet_balance`, 001_central_schema.sql), the store hydrates it
 *    onto the session entity as the derived client key, and `GET /api/auth/me` hands that entity to the
 *    browser through a projection that strips exactly one field. So the honest fix needs no new endpoint:
 *    the number is already in `user`, and that is what WDW-03 pins.
 *  - A statement does not. This tree registers no route whose path mentions a wallet, a top-up, a recharge,
 *    a balance or a statement (WDW-04 counts them out of the running server file), the wallet journal
 *    `journal_lines` is revoked from `anon`/`authenticated` and made append-only by 023, and the only
 *    ledger reads are `/api/admin/finance/*` behind `authenticateAdmin` + `requirePermission`. The four
 *    rows therefore have no source to have come from, in demo mode or in a real session.
 *  - `WALLET_TOPUP` is a real journal category (002's CHECK), and the only code that writes it is the
 *    admin support-refund path — money a finance authority moves for a customer, never money a customer
 *    mints by clicking. The client's own `TOP_UP`/`RIDE`/`REFUND` union matches none of the eight legal
 *    categories, which is how WDW-06 shows the interface was authored rather than projected.
 *
 * Two rules pull against each other, and both are in the checks:
 *  - The demo persona is an advertised feature. A fix that deletes the persona, the demo branch, or either
 *    "Demo" button to escape a money claim reddens WDW-14, which reads them back out of the login page.
 *  - Deleting the invented number and printing `inr(null)` is the tempting wrong second fix: `inr` is
 *    `format(amount ?? 0)`, so an unread balance renders as ₹0.00 — a different false claim about a
 *    customer's money. WDW-12 evaluates that function to show the coercion is real, and requires the
 *    screen to keep "not known" distinct from "zero", the same way `mobile/lib/features/wallet/…/wallet_screen.dart`
 *    already does for the Flutter customer app (`double? _balance`, "Null means 'we do not know'").
 *
 * The static half adds no toolchain — customer-web has no test dependency and this suite does not add one.
 * The runtime half boots THIS tree's backend on 127.0.0.1 through the loopback target guard and sends only
 * requests that carry no valid session, so it writes no session, no job, no order, no journal line and no
 * balance anywhere. Nothing here can mint money even by accident: the two wallet-shaped paths a customer
 * would need are asked for and reported missing, which is the finding, not a step towards it.
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
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'web_wallet_fabrication_test' });

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'customer-web', 'src');
const WALLET = path.join(WEB, 'app', 'wallet', 'page.tsx');
const CTX = path.join(WEB, 'context', 'AuthContext.tsx');
const LOGIN = path.join(WEB, 'app', 'login', 'page.tsx');
const RIDE = path.join(WEB, 'app', 'ride', 'page.tsx');
const APILIB = path.join(WEB, 'lib', 'api.ts');
const FORMAT = path.join(WEB, 'lib', 'format.ts');
const SHELL = path.join(WEB, 'components', 'AppShell.tsx');
const NAV = path.join(WEB, 'components', 'Header.tsx');
const SERVER = path.join(__dirname, 'src', 'server.js');
const DATABASE = path.join(__dirname, 'src', 'database.js');
const MIG001 = path.join(ROOT, 'supabase', 'migrations', '001_central_schema.sql');
const MIG002 = path.join(ROOT, 'supabase', 'migrations', '002_finance_ledger_schema.sql');
const MIG023 = path.join(ROOT, 'supabase', 'migrations', '023_financial_ledger_security_hardening.sql');

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
// looks for — `useState`, `amount`, `inr(`, `api.` — can only be found where they execute or render.
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
      out.push({ text: obj.text, keys: topLevelEntries(obj.text).map((e) => e.key) });
    }
  }
  return out;
}

// Every readable piece of text the page can paint: quoted literals, template literals, and JSX text
// children. Money claims live in all three, and `Successfully credited ${inr(amt)}` lives in two at once.
function paintedText(code) {
  const out = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '"' || c === "'") {
      const e = endOfString(code, i);
      out.push({ kind: 'string', text: code.slice(i + 1, Math.max(i + 1, e - 1)), line: lineOf(code, i) });
      i = e; continue;
    }
    if (c === '`') {
      const e = endOfTemplate(code, i);
      out.push({ kind: 'template', text: code.slice(i + 1, e), line: lineOf(code, i) });
      i = e + 1; continue;
    }
    if (c === '>') {
      const j = i + 1;
      const k = code.indexOf('<', j);
      if (k > j) {
        const raw = code.slice(j, k);
        if (/[A-Za-z]{3}/.test(raw) && !/[{}<>`"]/.test(raw) && raw.trim()) {
          out.push({ kind: 'jsx', text: raw.trim(), line: lineOf(code, j) });
        }
      }
      i = j; continue;
    }
    i++;
  }
  return out;
}

// useState() initial values, read as (name, setter, initializer) rather than as a line of text.
function useStateCalls(code) {
  const out = [];
  const re = /\buseState\s*(?:<[^<>()]*>)?\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const open = code.indexOf('(', m.index + m[0].length - 1);
    const close = open < 0 ? -1 : matchPair(code, open, '(', ')');
    if (close < 0) continue;
    const decl = code.slice(Math.max(0, code.lastIndexOf('const', m.index)), m.index);
    const nm = /\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]/.exec(decl);
    out.push({
      name: nm ? nm[1] : null,
      setter: nm ? nm[2] : null,
      init: code.slice(open + 1, close).trim(),
      line: lineOf(code, m.index),
    });
    re.lastIndex = close;
  }
  return out;
}

const SOURCES = [['wallet/page.tsx', WALLET], ['AuthContext.tsx', CTX], ['login/page.tsx', LOGIN],
  ['ride/page.tsx', RIDE], ['lib/api.ts', APILIB], ['lib/format.ts', FORMAT], ['AppShell.tsx', SHELL],
  ['Header.tsx', NAV],
  ['server.js', SERVER], ['database.js', DATABASE], ['001_central_schema.sql', MIG001],
  ['002_finance_ledger_schema.sql', MIG002], ['023_financial_ledger_security_hardening.sql', MIG023]];
const gone = SOURCES.filter(([, f]) => !fs.existsSync(f)).map(([n]) => n);
if (gone.length) {
  check('WDW-00', false, `${gone.length} source(s) this guard reads are gone: ${gone.join(', ')} — nothing below can be measured`);
  process.exitCode = 1;
  finish();
  return;
}

const W = blankComments(fs.readFileSync(WALLET, 'utf8'));
const A = blankComments(fs.readFileSync(CTX, 'utf8'));
const L = blankComments(fs.readFileSync(LOGIN, 'utf8'));
const R = blankComments(fs.readFileSync(RIDE, 'utf8'));
const API = blankComments(fs.readFileSync(APILIB, 'utf8'));
const F = blankComments(fs.readFileSync(FORMAT, 'utf8'));
const SH = blankComments(fs.readFileSync(SHELL, 'utf8'));
const HD = blankComments(fs.readFileSync(NAV, 'utf8'));
const S = blankComments(fs.readFileSync(SERVER, 'utf8'));
const D = blankComments(fs.readFileSync(DATABASE, 'utf8'));
// The platform's own rule about this field is written as a comment in database.js, so it is read from
// the unredacted file: blankComments() would erase the very sentence this guard cites.
const D_RAW = fs.readFileSync(DATABASE, 'utf8');
const M1 = fs.readFileSync(MIG001, 'utf8');
const M2 = fs.readFileSync(MIG002, 'utf8');
const M23 = fs.readFileSync(MIG023, 'utf8');

// =====================================================================================
// The vocabulary, derived from the platform rather than typed into this file
// =====================================================================================

// The durable balance: its column, its declared type, and the store's own default for it.
const usersAt = M1.search(/CREATE TABLE IF NOT EXISTS users \(/);
const usersBlock = usersAt < 0 ? '' : M1.slice(usersAt, M1.indexOf('\n)', usersAt) > 0 ? M1.indexOf('\n)', usersAt) : M1.length);
const balCol = /(\w*wallet_balance)\s+NUMERIC\((\d+),\s*(\d+)\)\s+DEFAULT\s+([\d.]+)/.exec(usersBlock);
const STORE_BAL_COL = balCol ? balCol[1] : null;
const STORE_BAL_DEFAULT = balCol ? balCol[4] : null;

// The key the store's column becomes on the way out, and the two places the backend writes it onto the
// entity the browser receives: hydration, and the OTP-login refresh onto the same entity.
const hydrate = new RegExp(`([A-Za-z_$][\\w$]*)\\s*:\\s*parseFloat\\(\\s*row\\.(${STORE_BAL_COL || 'wallet_balance'})\\b`).exec(D);
const CLIENT_BAL_KEY = hydrate ? hydrate[1] : null;
const loginRefresh = new RegExp(`entity\\.(${CLIENT_BAL_KEY || 'walletBalance'})\\s*=\\s*Number\\(\\s*dbUser\\.${STORE_BAL_COL || 'wallet_balance'}`).exec(D);

// The self-projection on GET /api/auth/me: which one field the browser is not sent.
const ME_REG = "app.get('/api/auth/me'";
const meRegAt = S.indexOf(ME_REG);
const meBody = routeBodyAt(S, ME_REG);
const meSuccess = meBody ? successObjects(meBody) : [];
const projection = /function\s+projectUserForSelf[\s\S]{0,240}?const\s*\{\s*([A-Za-z_$][\w$]*)(?:,\s*\.\.\.([A-Za-z_$][\w$]*))?\s*\}\s*=\s*entity;\s*return\s+\2\s*;/.exec(S);
const STRIPPED_FIELD = projection ? projection[1] : null;

// The whole route surface, inventoried out of the file this tree runs, so an absent wallet route is a
// counted fact and not a grep that happened to miss.
const ROUTES = [...S.matchAll(/app\.(get|post|patch|put|delete)\(\s*(['"])([^'"]*)\2/g)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[3], at: m.index, line: lineOf(S, m.index) }));
const registrationSegment = (r) => S.slice(r.at, S.indexOf('=>', r.at) > 0 ? S.indexOf('=>', r.at) : r.at + 200);
const WALLET_SHAPED = ROUTES.filter((r) => /wallet|top.?up|recharge|balance|statement/i.test(r.path));
const CUSTOMER_ROUTES = ROUTES.filter((r) => r.path.startsWith('/api/customer/'));
const ADMIN_FINANCE = ROUTES.filter((r) => /\/api\/admin\/finance/i.test(r.path));
const PAYMENT_ROUTES = ROUTES.filter((r) => /\/api\/payments/i.test(r.path));

// The journal: what a legal movement category is, and who may read the legs at all.
const journalTableAt = M2.search(/CREATE TABLE IF NOT EXISTS journal_transactions \(/);
const catCheck = /category\s+VARCHAR\(\d+\)\s+NOT NULL\s+CHECK\s*\(\s*category\s+IN\s*\(([^)]*)\)/.exec(M2.slice(journalTableAt));
const LEDGER_CATEGORIES = catCheck ? [...catCheck[1].matchAll(/(['"])([A-Z_]+)\1/g)].map((m) => m[2]) : [];
const linesRevoked = /REVOKE ALL ON TABLE public\.journal_lines\s+FROM\s+anon,\s+authenticated/.test(M23);
const linesAppendOnly = /CREATE TRIGGER trg_journal_lines_append_only/.test(M23);

// The formatter that turns a number into money — extracted, then evaluated, because whether an unknown
// balance can be printed as a real-looking zero is a fact about this function, not about this guard.
const inrFn = /export const inr\s*=\s*\(([^)]*)\)\s*=>\s*new Intl\.NumberFormat\([^)]*\)\s*(?:\([^)]*\)\s*){0,2}\.format\(\s*([A-Za-z_$][\w$]*)\s*(\?\?|\|\|)\s*(\d+(?:\.\d+)?)\s*\)/.exec(F);
const INR_ARG = inrFn ? inrFn[2] : null;
const INR_OP = inrFn ? inrFn[3] : null;
const INR_FALLBACK = inrFn ? inrFn[4] : null;
let printUnknown = null, inrErr = null;
// A plain non-zero example, deliberately not any number this page ever printed: the point is only that
// inr() separates a read amount from an unread one.
const INR_PROBE = 250;
if (inrFn) {
  const body = F.slice(inrFn.index, F.indexOf('\n\n', inrFn.index) > 0 ? F.indexOf('\n\n', inrFn.index) : F.length);
  const m = /export const inr[\s\S]*?=>\s*([\s\S]*?);/.exec(body);
  try {
    const fn = new Function(INR_ARG, `const nf = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }); return ${m[1].replace(/;[\s\S]*$/, '')}`);
    printUnknown = { null: fn(null), zero: fn(0), value: fn(INR_PROBE) };
  } catch (e) { inrErr = String(e && e.message); }
}

// The demo persona and the credential the app hands the browser for it, read out of the app so the
// runtime probes ask the backend about the string the app really uses.
const demoGate = /([A-Za-z_$][\w$]*)\.startsWith\(\s*(["'])([^"']*)\2\s*\)/.exec(A);
const DEMO_PREFIX = demoGate ? demoGate[3] : null;
let demoObj = null, demoPersona = {};
if (demoGate) {
  const openParen = A.lastIndexOf('(', demoGate.index);
  const closeParen = matchPair(A, openParen, '(', ')');
  const brace = closeParen < 0 ? -1 : A.indexOf('{', closeParen);
  if (brace >= 0) {
    const b = bodyFrom(A, brace);
    if (b && /setUser\(/.test(b.text)) {
      demoObj = bodyFrom(b.text, b.text.indexOf('{', b.text.indexOf('setUser(')));
      if (demoObj) for (const e of topLevelEntries(demoObj.text)) if (isQuoted(e.value)) demoPersona[e.key] = unquote(e.value);
    }
  }
}
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
    demoMints.push({ token: m[2], line: lineOf(L, m.index), statusEntry,
      button: open < 0 || close < 0 ? null : L.slice(open, close + 9) });
  }
}
const DEMO_TOKEN = demoMints.length ? demoMints[0].token : null;

// =====================================================================================
// Group A — witnesses and the derived vocabulary (a check cannot pass by finding nothing)
// =====================================================================================

check('WDW-01',
  Boolean(balCol) && Boolean(hydrate) && Boolean(projection) && Boolean(inrFn) && ROUTES.length > 0
  && meRegAt >= 0 && Boolean(meBody) && meSuccess.length > 0 && Boolean(demoGate) && demoMints.length > 0
  && journalTableAt >= 0 && LEDGER_CATEGORIES.length > 0 && W.length > 0,
  `read: ${label(WALLET)} (${W.split('\n').length} lines, ${useStateCalls(W).length} useState cell(s) `
  + `${JSON.stringify(useStateCalls(W).map((s) => `${s.name}=${s.init}`))}); users.${STORE_BAL_COL ?? '?'} `
  + `${balCol ? `001_central_schema.sql:${lineOf(M1, usersAt + balCol.index)}` : 'NOT FOUND (FAIL)'} as NUMERIC(${balCol ? `${balCol[2]},${balCol[3]}` : '?'}) `
  + `DEFAULT ${STORE_BAL_DEFAULT ?? '?'}; hydration ${hydrate ? `database.js:${lineOf(D, hydrate.index)}` : 'NOT FOUND (FAIL)'} → client key `
  + `'${CLIENT_BAL_KEY ?? '?'}'; login refresh ${loginRefresh ? `database.js:${lineOf(D, loginRefresh.index)}` : 'NOT FOUND (FAIL)'}; `
  + `self-projection ${projection ? `server.js:${lineOf(S, projection.index)}` : 'NOT FOUND (FAIL)'} strips only `
  + `'${STRIPPED_FIELD ?? '?'}'; ${ME_REG} at server.js:${meRegAt < 0 ? 'NOT FOUND (FAIL)' : lineOf(S, meRegAt)} with `
  + `${meSuccess.length} success object(s) declaring [${meSuccess.map((o) => o.keys.join(',')).join(' | ') || 'NONE (FAIL)'}]; `
  + `${ROUTES.length} route registrations in server.js; journal_transactions at ${path.basename(MIG002)}:${lineOf(M2, journalTableAt)} with `
  + `${LEDGER_CATEGORIES.length} legal categories; inr() ${inrFn ? `lib/format.ts:${lineOf(F, inrFn.index)}` : 'NOT FOUND (FAIL)'} — `
  + 'every derived value below comes from these');

check('WDW-02', CLIENT_BAL_KEY !== null && STORE_BAL_COL !== null && Boolean(loginRefresh),
  `a customer balance is durable and has one spelling on each side: the column is \`${STORE_BAL_COL ?? 'NOT FOUND (FAIL)'}\` `
  + `NUMERIC(${balCol ? `${balCol[2]}, ${balCol[3]}` : '?'}) DEFAULT ${STORE_BAL_DEFAULT ?? '?'} at `
  + `001_central_schema.sql:${usersAt < 0 ? 'NOT FOUND' : lineOf(M1, usersAt)}, and database.js:${hydrate ? lineOf(D, hydrate.index) : 'NOT FOUND (FAIL)'} `
  + `hydrates it onto the entity as \`${CLIENT_BAL_KEY ?? 'NOT FOUND (FAIL)'}\`, re-read onto the same entity at login by `
  + `database.js:${loginRefresh ? lineOf(D, loginRefresh.index) : 'NOT FOUND (FAIL)'}. So \`'${CLIENT_BAL_KEY ?? 'walletBalance'}'\` in the browser means `
  + 'the store said it, and anything else on this screen means the browser said it');

check('WDW-03', Boolean(meBody) && meSuccess.some((o) => o.keys.includes('user'))
  && Boolean(projection) && STRIPPED_FIELD !== CLIENT_BAL_KEY
  && /setUser\(\s*res\.data\.user\s*\)/.test(A) && /await\s+authApi\.me\(\)/.test(A)
  && /me:\s*\(\)\s*=>\s*api\.get\(\s*(["'])\/auth\/me\1/.test(API),
  `the honest fix needs no new endpoint, and this is the proof: ${label(APILIB)} calls \`${(API.match(/me:\s*\(\)\s*=>\s*api\.get\(\s*(["'])([^"']*)\1/) || [])[2] ?? 'NOT FOUND (FAIL)'}\`, `
  + `server.js:${meRegAt < 0 ? 'NOT FOUND' : lineOf(S, meRegAt)} answers it with a success object declaring [${meSuccess.map((o) => o.keys.join(',')).join(' | ') || 'NONE (FAIL)'}], `
  + `the self-projection at server.js:${projection ? lineOf(S, projection.index) : 'NOT FOUND (FAIL)'} removes only \`${STRIPPED_FIELD ?? '?'}\` from the entity, and `
  + `${label(CTX)} assigns the response \`user\` wholesale (${/setUser\(\s*res\.data\.user\s*\)/.test(A) ? 'yes' : 'NO (FAIL)'}). `
  + `'${CLIENT_BAL_KEY ?? '?'}' is therefore already in the object this screen receives but does not read`);

check('WDW-04', ROUTES.length > 0 && WALLET_SHAPED.length === 0
  && CUSTOMER_ROUTES.length > 0 && ADMIN_FINANCE.length > 0
  && ADMIN_FINANCE.every((r) => /authenticateAdmin/.test(registrationSegment(r))),
  `there is nothing in this backend for a wallet screen to have called: ${ROUTES.length} registrations exist, and `
  + `${WALLET_SHAPED.length} of them name a wallet, top-up, recharge, balance or statement `
  + `(${WALLET_SHAPED.map((r) => `${r.method} ${r.path}@${r.line}`).join(', ') || 'none — the browser has no money read or money write to reach'}). `
  + `The customer-scoped reads are [${CUSTOMER_ROUTES.map((r) => r.path).join(', ')}] — bookings and activity, no journal — and the `
  + `${ADMIN_FINANCE.length} ledger reads (${ADMIN_FINANCE.map((r) => r.path).join(', ')}) are all behind authenticateAdmin `
  + `(${ADMIN_FINANCE.every((r) => /authenticateAdmin/.test(registrationSegment(r))) ? 'confirmed in the registration itself' : 'NOT CONFIRMED (FAIL)'})`);

const topupCategoryLine = LEDGER_CATEGORIES.includes('WALLET_TOPUP')
  ? `${path.basename(MIG002)}:${lineOf(M2, journalTableAt + (catCheck ? catCheck.index : 0))}` : 'NOT A LEGAL CATEGORY';
const topupWriterAt = D.indexOf("const category = direction === 'CREDIT' ? 'WALLET_TOPUP'");
check('WDW-05', linesRevoked && linesAppendOnly && LEDGER_CATEGORIES.includes('WALLET_TOPUP')
  && PAYMENT_ROUTES.length > 0 && topupWriterAt >= 0,
  'and the journal itself is not readable from a browser even by accident: '
  + `${path.basename(MIG023)}:${lineOf(M23, M23.indexOf('REVOKE ALL ON TABLE public.journal_lines'))} revokes every grant on `
  + `public.journal_lines from anon and authenticated, and ${lineOf(M23, M23.indexOf('CREATE TRIGGER trg_journal_lines_append_only'))} `
  + `installs ${linesAppendOnly ? 'the append-only guard' : 'NO append-only guard (FAIL)'} on it. WALLET_TOPUP is a real category (`
  + `${LEDGER_CATEGORIES.join(', ')} at ${topupCategoryLine}), and the one place this backend writes it is `
  + `database.js:${topupWriterAt >= 0 ? lineOf(D, topupWriterAt) : 'NOT FOUND (FAIL)'} — inside the admin support-refund path, money a `
  + 'finance authority moves *for* a customer, never money a customer mints by clicking. '
  + `${PAYMENT_ROUTES.length} payment routes do exist (${PAYMENT_ROUTES.map((r) => r.path).join(', ')}), so this guard asserts no `
  + 'gateway configuration state in either direction; it asserts only that this page is not equipped to know one');

const clientTxUnion = (() => {
  const m = /interface\s+Transaction\b[\s\S]*?\bcategory\s*:\s*([^;]+);/.exec(W);
  if (!m) return null;
  return [...m[1].matchAll(/(["'])([A-Z_]+)\1/g)].map((x) => x[2]);
})();
const unknownCategories = clientTxUnion ? clientTxUnion.filter((c) => !LEDGER_CATEGORIES.includes(c)) : [];
check('WDW-06', clientTxUnion === null || unknownCategories.length === 0,
  clientTxUnion === null
    ? `the page authors no transaction-category vocabulary, so nothing on it claims a ledger shape it did not read`
    : `${label(WALLET)}'s own \`Transaction\` interface declares category values [${clientTxUnion.join(', ')}], and `
      + `${unknownCategories.length} of them are not legal journal categories [${LEDGER_CATEGORIES.join(', ')}] `
      + `(unknown: ${unknownCategories.join(', ')}). The rows rendered under that interface are therefore not a projection of `
      + 'the money schema at all — they are a shape this file invented, which is exactly what a statement list must not be');

// =====================================================================================
// Group B — the money the screen authored
// =====================================================================================

const states = useStateCalls(W);
const userReads = [...W.matchAll(/\buser\.|\buser\?\./g)];
check('WDW-07', userReads.length > 0 && new RegExp(`${CLIENT_BAL_KEY}\\b`).test(W),
  `${label(WALLET)} destructures the session (${(W.match(/const\s*\{[^}]*\}\s*=\s*useSession\(\)/) || ['NOT FOUND (FAIL)'])[0]}), `
  + `and then reads it in ${userReads.length} place(s). The signed-in entity that carries '${CLIENT_BAL_KEY ?? '?'}' is `
  + `${userReads.length ? 'used' : 'IGNORED — the screen prints no value the backend ever returned'}. `
  + `A wallet screen whose money figures are independent of its own session is a wallet screen making them up`);

const numericBalanceState = states.find((s) => s.name && /balance/i.test(s.name) && /^[\d.]+$/.test(s.init));
check('WDW-08', numericBalanceState === undefined,
  `the page declares ${states.length} useState cell(s) [${states.map((s) => `${s.name}: ${s.init}`).join('; ') || 'none'}]. `
  + `${numericBalanceState
    ? `AVAILABLE BALANCE at ${label(WALLET)}:${numericBalanceState.line} is seeded from the literal ${numericBalanceState.init} — `
      + `a number that exists in this file and nowhere in backend/src, the migrations, or a fixture this tree seeds`
    : 'no money cell is seeded from a literal, so every figure on the card traces to the session or to nothing'}`);

const amountLiterals = [...W.matchAll(/\bamount\s*:\s*(\d[\d.]*)/g)];
const referenceLiterals = [...W.matchAll(/\breference\s*:\s*(["'])([^"']*)\1/g)];
const inventedRows = amountLiterals.length + referenceLiterals.length;
check('WDW-09', inventedRows === 0,
  `${amountLiterals.length} object literal(s) in the page set \`amount\` to a number (${amountLiterals.map((m) => `${m[1]}@${lineOf(W, m.index)}`).join(', ') || 'none'}) and `
  + `${referenceLiterals.length} set \`reference\` to a string written in the file (${referenceLiterals.map((m) => `${m[2]}@${lineOf(W, m.index)}`).join(', ') || 'none'}). `
  + (inventedRows
    ? 'Each of those rows renders as a receipt with its own status painted in the success tone. '
      + `No route (WDW-04), no journal read (WDW-05) and no fixture produces them, so they are not a statement of `
      + `${inventedRows} movements — they are ${inventedRows} invented movements`
    : 'the page authors no amount and no reference, so it lists no money movements at all — '
      + 'the balance the session reported is the only figure on it'));

const arithmetic = [...W.matchAll(/\bset[A-Za-z_$][\w$]*\(\s*\(\s*(\w+)\s*\)\s*=>\s*\1\s*([+-])\s*[^)]*\)/g)];
const balanceSetters = states.filter((s) => /balance/i.test(s.name ?? '') && s.setter && new RegExp(`${s.setter}\\(`).test(W));
const noArithRule = D_RAW.indexOf('No JavaScript balance arithmetic');
const ruleQuote = noArithRule < 0 ? 'RULE NOT FOUND (FAIL)'
  : D_RAW.slice(noArithRule, D_RAW.indexOf('.', noArithRule) + 1).replace(/\s*\/\/\s*/g, ' ').replace(/\s+/g, ' ').trim();
check('WDW-10', arithmetic.length === 0 && balanceSetters.length === 0 && noArithRule >= 0,
  `${arithmetic.length} site(s) change a money value in the browser (${arithmetic.map((m) => `${m[0].slice(0, 40)} → ${m[2]}@${lineOf(W, m.index)}`).join('; ') || 'none'}). `
  + `A balance cell is written only through its setter: ${states.filter((s) => /balance/i.test(s.name ?? '')).map((s) => `${s.name}=${s.init}@${s.line} setter ${s.setter ?? '?'} ${s.setter && new RegExp(`${s.setter}\\(`).test(W) ? 'CALLED (FAIL)' : 'not called'}`).join('; ') || 'no balance cell exists — the card renders a value it read'}. Balances move through `
  + `the atomic ledger RPC, and ${noArithRule >= 0 ? `${label(DATABASE)}:${lineOf(D_RAW, noArithRule)}` : 'no such rule is recorded anywhere'} states it as `
  + `"${ruleQuote}" — so client arithmetic on this field is a claim, not a calculation`);

const requests = [...W.matchAll(/\bapi\.(get|post|patch|put|delete)\b|\bfetch\(|\baxios\.|\bawait\s+[A-Za-z_$][\w$]*Api\./g)];
const MOVEMENT_RE = /\b(credited|credit\b|recharge|top.?up|paid|payment succeeded|transferred)\b/i;
const movementClaims = paintedText(W).filter((t) => MOVEMENT_RE.test(t.text));
check('WDW-11', requests.length === 0 ? movementClaims.length === 0 : true,
  `the page issues ${requests.length} request(s)${requests.length ? '' : ` — it never asks the backend anything`}. `
  + `${movementClaims.length} painted string(s) assert that money moved (${movementClaims.map((t) => `line ${t.line} ${t.kind} "${t.text.replace(/\s+/g, ' ').slice(0, 70)}"`).join('; ') || 'none'}). `
  + (movementClaims.length
    ? `With no write route to call (WDW-04) and ${requests.length} request(s) issued, `
      + `"${movementClaims[0].text.replace(/\s+/g, ' ').slice(0, 60)}" describes a transaction the screen cannot have performed`
    : 'the page paints no wording that says money moved, so nothing on it reports an action it did not take'));

const loadingUsed = /authLoading|loading/.test(W.slice(W.indexOf('return (')));
const unknownBranch = /(===\s*null|!==\s*null|==\s*null|\?\?\s*[^)\n]|not available|isn.?t available|not shown)/i
  .test(W.slice(W.indexOf('return (')));
check('WDW-12', printUnknown !== null && printUnknown.null === printUnknown.zero && printUnknown.null !== printUnknown.value
  && loadingUsed && unknownBranch,
  `an unread balance must not become a zero, and that is a property of the code, not of this wording: \`inr\` at `
  + `${label(FORMAT)}:${inrFn ? lineOf(F, inrFn.index) : 'NOT FOUND (FAIL)'} is evaluated here as written — `
  + `${inrErr ? `NOT EVALUATED (FAIL: ${inrErr})` : `inr(null) → "${printUnknown ? printUnknown.null : '?'}" and inr(0) → "${printUnknown ? printUnknown.zero : '?'}", which ${printUnknown && printUnknown.null === printUnknown.zero ? 'are the same string' : 'differ'}; inr(${INR_PROBE}) [an example read amount] → "${printUnknown ? printUnknown.value : '?'}"`}. `
  + `So a fix that deletes the invented number and keeps a bare \`inr(balance)\` would print a real-looking zero over an `
  + `account it never read. This page renders the balance ${loadingUsed ? 'behind' : 'WITHOUT'} the session's loading state `
  + `(${(W.match(/const\s*\{\s*user\s*,\s*loading\s*:\s*(\w+)\s*\}/) || [, 'not renamed'])[1] ?? '?'}) and ${unknownBranch ? 'has' : 'HAS NO'} `
  + 'not-known branch in its return path');

// =====================================================================================
// Group C — what the correction had to leave alone
// =====================================================================================

const hasBalanceCard = /available balance/i.test(W);
// The navigation entry can live in the shell or in the header the shell renders, so the check names
// whichever file actually declares it rather than assuming which component owns the chrome.
const navHit = [[label(SHELL), SH], [label(NAV), HD]]
  .map(([name, src]) => { const m = /href:\s*(["'])\/wallet\1/.exec(src); return m ? { name, line: lineOf(src, m.index) } : null; })
  .find(Boolean);
check('WDW-13', fs.existsSync(WALLET) && /useSession\(\)/.test(W) && hasBalanceCard && Boolean(navHit),
  `the screen itself survives the correction: ${label(WALLET)} exists, is still gated by useSession `
  + `(${/useSession\(\)/.test(W) ? 'yes' : 'NO (FAIL)'}), still renders the ${hasBalanceCard ? 'AVAILABLE BALANCE' : 'MISSING (FAIL)'} card, `
  + `and its route is still offered by the navigation (${navHit ? `href: '/wallet' at ${navHit.name}:${navHit.line}`
    : `NOT IN THE NAV (FAIL) — neither ${label(SHELL)} nor ${label(NAV)} declares it`}). `
  + 'Removing the wallet screen, its navigation entry or its session guard would not be a fix to this finding');

const demoStatusEntry = demoObj ? topLevelEntries(demoObj.text).find((e) => e.key === 'identityStatus') : null;
const buttonsOk = demoMints.length === 2 && demoMints.every((d) => d.button && /type="button"/.test(d.button) && /Demo/.test(d.button));
check('WDW-14', Boolean(demoObj) && Boolean(demoStatusEntry) && demoMints.length === 2 && buttonsOk
  && /token\.startsWith|startsWith\(\s*(["'])demo/.test(A),
  `the advertised demo feature is untouched by this correction: ${label(CTX)} still branches on the `
  + `\`${DEMO_PREFIX ?? '?'}\`-prefixed token and installs a persona carrying [${Object.keys(demoPersona).join(', ')}], `
  + `with identityStatus '${demoStatusEntry ? (literalValue(demoStatusEntry.value) ?? demoStatusEntry.value) : 'ABSENT (FAIL)'}', and `
  + `${demoMints.length} demo button(s) in ${label(LOGIN)} remain type="button" and Demo-labelled (${buttonsOk ? 'yes' : 'NO (FAIL)'}). `
  + 'A demo session browsing the app is the feature; a demo session describing its own money is the defect, and only the '
  + 'second one is what this guard removes');

const idVocabOk = demoStatusEntry && /IDENTITY_VERIFICATION_PENDING|PENDING|UNVERIFIED|REJECTED/.test(String(literalValue(demoStatusEntry.value) ?? ''));
const predMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*identityStatus[^;]*);/.exec(R);
let demoBlocked = null, predErr = null;
if (predMatch) {
  try { demoBlocked = Boolean(new Function('user', `return (${predMatch[2]});`)(Object.assign({}, demoPersona))); }
  catch (e) { predErr = String(e && e.message); }
}
check('WDW-15', idVocabOk && demoBlocked === true
  && /identityStatus\?:\s*string\s*;/.test(A),
  `the identity contract this suite also depends on is unchanged: the persona still carries a real status `
  + `(${demoStatusEntry ? `'${literalValue(demoStatusEntry.value) ?? '?'}'` : 'ABSENT (FAIL)'}), the \`User\` interface still declares `
  + `\`${(A.match(/identityStatus\?:\s*[^;]+;/) || ['NOT FOUND (FAIL)'])[0]}\`, and the ride gate at ${label(RIDE)}:${predMatch ? lineOf(R, predMatch.index) : 'NOT FOUND (FAIL)'} `
  + `still evaluates to ${demoBlocked === null ? `NOT EVALUATED (FAIL: ${predErr})` : demoBlocked ? 'BLOCK for the demo persona' : 'ALLOW (FAIL — a wallet fix must not reopen the gate link 111 closed)'}. `
  + 'A money screen has no business weakening an identity gate to render a number');

const GATEWAY_RE = /\b(gateway|instrument|unconfigured|not configured|no payment)\b/i;
const infraClaims = paintedText(W).filter((t) => GATEWAY_RE.test(t.text));
check('WDW-16', requests.length === 0 && infraClaims.length === 0,
  `${label(WALLET)} asserts ${infraClaims.length} thing(s) about server-side configuration it cannot have learned `
  + `(${infraClaims.map((t) => `line ${t.line} ${t.kind} "${t.text.replace(/\s+/g, ' ').slice(0, 78)}"`).join('; ') || 'none'}). `
  + `It issues ${requests.length} request(s), so no such claim has a source — and the claim is not safe in either `
  + `direction: this backend registers ${PAYMENT_ROUTES.length} payment routes (${PAYMENT_ROUTES.map((r) => r.path).join(', ')}), so `
  + `"not configured" is a deployment-environment fact this screen is not equipped to state. The page may say what it `
  + 'can do; it may not report the state of infrastructure it never asked');

// =====================================================================================
// Runtime: is there any server counterpart to what the page authored?
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
  try { json = JSON.parse(text); } catch (e) { /* a non-JSON answer is still an answer */ }
  const keys = json && typeof json === 'object' ? Object.keys(json) : [];
  return {
    status: res.status, keys, text,
    hasUser: keys.includes('user'),
    claimsSuccess: keys.includes('success') && json.success === true,
    mentionsBalance: text.includes(String(CLIENT_BAL_KEY)),
    code: (json && (json.code || json.error)) || text.slice(0, 60),
  };
}

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
    check('WDW-17', ready,
      ready
        ? `the backend the app talks to booted on 127.0.0.1:${port} against the loopback store this run declared `
          + `(${PG_TARGET.host}:${PG_TARGET.port}/${PG_TARGET.database}, from ${PG_TARGET.source}) — the requests below are `
          + 'answered by the routes this screen would have needed. Every one carries no valid session, so this suite writes '
          + 'no session, no balance, no journal line and no order anywhere'
        : `the backend never came up, so the runtime claims were NOT measured: ${stderr.join('').slice(-240)}`);
    if (!ready) return;

    const anon = await req(baseUrl, 'GET', '/api/auth/me', null, null);
    check('WDW-18', anon.status >= 400 && anon.status < 500 && !anon.hasUser && !anon.mentionsBalance && !anon.claimsSuccess,
      `GET /api/auth/me with no credential: ${anon.status} ${anon.code}; body declares [${anon.keys.join(', ')}] → `
      + `${anon.hasUser ? 'A user OBJECT (FAIL)' : 'no user'}, ${anon.mentionsBalance ? `still mentions '${CLIENT_BAL_KEY}' (FAIL)` : `mentions no '${CLIENT_BAL_KEY}'`}, `
      + `${anon.claimsSuccess ? 'and claims success (FAIL)' : 'and claims no success'} — the authoritative balance feed has no `
      + 'anonymous answer to give, so a screen with no session has no balance to print');

    const demo = DEMO_TOKEN ? await req(baseUrl, 'GET', '/api/auth/me', DEMO_TOKEN, null) : null;
    check('WDW-19', Boolean(demo) && demo.status >= 400 && demo.status < 500 && !demo.hasUser && !demo.mentionsBalance,
      demo
        ? `GET /api/auth/me with the credential the app itself mints, \`${DEMO_TOKEN}\`: ${demo.status} ${demo.code}, `
          + `${demo.hasUser ? 'IT RETURNED A user (FAIL)' : 'no user'}, and ${demo.mentionsBalance ? `the body mentions '${CLIENT_BAL_KEY}' (FAIL)` : `nothing in it carries a '${CLIENT_BAL_KEY}'`} — `
          + `the demo persona has no durable account, hence no ${CLIENT_BAL_KEY ?? 'walletBalance'} the screen could have read, which is why `
          + `${amountLiterals.length + (numericBalanceState ? 1 : 0)} figure(s) on it could only have been written in the file`
        : 'the demo credential could not be read out of the login page, so the claim was NOT measured (FAIL)');

    const read = await req(baseUrl, 'GET', '/api/wallet', DEMO_TOKEN ?? null, null);
    const write = await req(baseUrl, 'POST', '/api/wallet/topup', DEMO_TOKEN ?? null, { amount: 1000 });
    check('WDW-20', read.status >= 400 && read.status < 500 && !read.claimsSuccess
      && write.status >= 400 && write.status < 500 && !write.claimsSuccess && !write.mentionsBalance,
      `the two paths this screen would have needed do not exist: GET /api/wallet → ${read.status} ${read.code} `
      + `${read.claimsSuccess ? '(claims success — FAIL)' : '(claims nothing)'}; POST /api/wallet/topup with an amount of 1000 → `
      + `${write.status} ${write.code} ${write.claimsSuccess ? '(AND CLAIMED SUCCESS — FAIL)' : '(no success to believe)'}. `
      + 'So neither half of the money claim this screen used to make has a route behind it: the invented rows and the '
      + 'invented "credited" message described one transaction, and neither the transaction nor its record exists anywhere');

    const ledger = await req(baseUrl, 'GET', '/api/admin/finance/ledger', null, null);
    check('WDW-21', ledger.status >= 400 && ledger.status < 500,
      `GET /api/admin/finance/ledger with no credential: ${ledger.status} ${ledger.code} — the statement feed this page `
      + `pretended to render is ${ledger.status >= 400 ? 'closed to it' : 'OPEN TO ANONYMOUS CALLERS (FAIL)'}, behind `
      + `authenticateAdmin${ADMIN_FINANCE.every((r) => /requirePermission/.test(registrationSegment(r))) ? " and requirePermission('finance.view')" : ''}, `
      + `across ${ADMIN_FINANCE.length} admin ledger route(s) [${ADMIN_FINANCE.map((r) => r.path).join(', ')}]. A customer's `
      + 'receipt history is not a surface this client can read, and no correction here widens it');
  } finally {
    proc.kill();
  }
}

runRuntime().then(finish).catch((err) => {
  check('WDW-17', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  finish();
});

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 WEB WALLET FABRICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
