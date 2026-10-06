/*
 * The admin console must not let a value somebody else typed become markup in an examiner's DOM.
 *
 * The defect this file was written for: the console is one static HTML file that renders every
 * queue by assigning a template literal to `innerHTML`, and the row fields it prints — a ticket
 * title, a merchant name, an address, a SKU, a campaign headline — were typed by a customer,
 * driver, merchant or operator. #147 found one queue doing it with a baked-in document; the
 * survey behind #155 found the same class across tens of render sites. A fix that closes only the
 * queue somebody happened to look at is not a fix for a class, so this file asserts the class:
 *
 *   every value the console writes into innerHTML is escaped, shape-checked, or a literal —
 *   measured against the shipped file, with the row names derived from the file too, so a queue
 *   added tomorrow under a new variable name is caught by the same rule.
 *
 * Two doors are held to a stricter standard, because HTML-entity escaping does not work there: an
 * `onclick="fn('…')"` attribute is decoded by the parser *before* JavaScript runs, so an escaped
 * quote still ends the string literal; and `src="…"` takes a URL, where escaping says nothing
 * about `javascript:`. Those slots must carry a shape check (`safeId`) or a URL allowlist
 * (`safeUrl`) — and using `escHtml` there is asserted as a failure in its own right.
 *
 * Everything here is static on purpose: no server, no table, no seeded row. The claim is about
 * what the file does, and the file is the whole attack surface.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'admin_dashboard.html');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const SRC = fs.readFileSync(FILE, 'utf8');

// --- literals ----------------------------------------------------------------
// Three hazards decide whether a byte is code or text in a file like this one: a comment can
// contain an apostrophe, a regex literal can contain every interesting character at once
// (`/[&<>"']/g` in escHtml), and a JS string never spans a newline. All three occur here, and a
// scanner that ignores any of them stops seeing template literals for the rest of the file — a
// guard that finds no templates would then pass by finding nothing, which is worse than failing.

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

function endOfRegex(text, i) {
  let j = i + 1, cls = false;
  while (j < text.length && text[j] !== '\n') {
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === '[') cls = true;
    else if (text[j] === ']') cls = false;
    else if (text[j] === '/' && !cls) {
      while (j < text.length && /[a-z]/i.test(text[j + 1] ?? '')) j++;
      return j + 1;
    }
    j++;
  }
  return j;
}

// A `/` opens a regex when the token before it cannot end an expression. After `)`, `]` or a
// plain identifier it is division; this file divides nothing, but the rule keeps a stray `/` in
// prose from eating a line.
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'new', 'instanceof']);
function isRegexStart(text, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(text[j])) j--;
  if (j < 0) return true;
  const c = text[j];
  if (!/[A-Za-z0-9_$)\]]/.test(c)) return true;
  const word = /[A-Za-z_$]/.test(c) ? /([A-Za-z_$][\w$]*)$/.exec(text.slice(0, j + 1))[1] : '';
  return KEYWORDS_BEFORE_REGEX.has(word);
}

function readSlot(text, i) {
  let depth = 1, j = i + 2;
  while (j < text.length && depth > 0) {
    const ch = text[j];
    if (ch === '"' || ch === "'") { j = endOfString(text, j); continue; }
    if (ch === '`') { j = readTemplate(text, j) + 1; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    j++;
  }
  return j;
}

function readTemplate(text, start) {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') return i;
    if (c === '$' && text[i + 1] === '{') { i = readSlot(text, i); continue; }
    i++;
  }
  return text.length;
}

// Comments are blanked through the same scanner that understands strings, so a `//` inside
// `'https://cdn…'` survives, and every blanked byte becomes a space — offsets, and therefore the
// line numbers a failure reports, stay exact.
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
      wipe(i, j);
      i = j;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const at = text.indexOf('*/', i + 2);
      const end = at < 0 ? text.length : at + 2;
      wipe(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = readTemplate(text, i) + 1; continue; }
    if (c === '/' && isRegexStart(text, i)) { i = endOfRegex(text, i); continue; }
    i++;
  }
  return out.join('');
}

const CODE = blankComments(SRC);
const lineAt = (off) => CODE.slice(0, off).split('\n').length;

// The helpers this contract rests on.
const ESCAPERS = ['escHtml'];
const GATES = ['safeId', 'safeUrl'];
const ABSENT = ['notSuppliedText', 'docStatusText'];
const PROTECTIVE = [...ESCAPERS, ...GATES, ...ABSENT];

// The `${…}` spans within a range, as absolute offsets.
function slotsInRange(text, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const c = text[i];
    if (c === '\\') { i += 2; continue; }
    if (c === '`') { i = Math.min(readTemplate(text, i) + 1, to); continue; }
    if (c === '$' && text[i + 1] === '{') {
      const end = Math.min(readSlot(text, i), to);
      out.push({ start: i, end, expr: text.slice(i + 2, Math.max(i + 2, end - 1)) });
      i = end;
      continue;
    }
    i++;
  }
  return out;
}

// Every template literal in the inline scripts, nested ones included.
const inlineScriptRanges = [];
for (const m of CODE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi)) {
  inlineScriptRanges.push([m.index + m[0].indexOf('>') + 1, m.index + m[0].lastIndexOf('<')]);
}
const templates = [];
function discover(from, to) {
  let i = from;
  while (i < to) {
    const c = CODE[i];
    if (c === '"' || c === "'") { i = Math.min(endOfString(CODE, i), to); continue; }
    if (c === '/' && isRegexStart(CODE, i)) { i = Math.min(endOfRegex(CODE, i), to); continue; }
    if (c === '`') {
      const end = Math.min(readTemplate(CODE, i), to);
      templates.push({ bodyStart: i + 1, bodyEnd: end });
      for (const s of slotsInRange(CODE, i + 1, end)) discover(s.start + 2, s.end - 1);
      i = end + 1;
      continue;
    }
    i++;
  }
}
inlineScriptRanges.forEach(([from, to]) => discover(from, to));

// Row names are read off the file: every lambda parameter of a collection method is a row.
const BINDINGS = new Set();
for (const m of CODE.matchAll(/\.(?:map|forEach|filter|find|findIndex|some|every|sort|flatMap|reduce)\(\s*\(?([A-Za-z_$][\w$]*)\)?\s*=>/g)) BINDINGS.add(m[1]);
for (const m of CODE.matchAll(/\.(?:map|forEach|filter)\(\s*\[([^\]]+)\]\s*=>/g)) m[1].split(',').forEach((n) => BINDINGS.add(n.trim()));
const MARKUP = /<(?:div|tr|td|th|span|img|button|p|ul|li|table|textarea|input|select|option|h[1-6])\b|<\/\w/;
// A name lifted out of the file becomes a pattern here, so it is escaped first.
const rx = (n) => n.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');

// --- balanced scanning helpers -----------------------------------------------

// Which bracket closes which, both directions, for one short expression. Strings and nested
// templates are stepped over: a `)` inside `'a)b'` is not a closer.
function pairMap(s) {
  const map = new Map();
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'") { i = endOfString(s, i) - 1; continue; }
    if (c === '`') { i = readTemplate(s, i); continue; }
    if ('([{'.includes(c)) stack.push(i);
    else if (')]}'.includes(c)) {
      const j = stack.pop();
      if (j !== undefined) { map.set(j, i); map.set(i, j); }
    }
  }
  return map;
}

function matchPair(text, i, openCh, closeCh) {
  let depth = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { i = endOfString(text, i); continue; }
    if (c === '`') { i = readTemplate(text, i) + 1; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i;
    i++;
  }
  return -1;
}

// The body of a function definition: a brace block, a template literal, or one line.
function bodyAt(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] === '{') { const j = matchPair(text, i, '{', '}'); return text.slice(i, j < 0 ? text.length : j + 1); }
  if (text[i] === '`') return text.slice(i, readTemplate(text, i) + 1);
  const nl = text.indexOf('\n', i);
  return text.slice(i, nl < 0 ? text.length : nl);
}

// A function that returns markup is not a value to escape at its call site — the template it
// returns is audited here like every other. But its parameters carry exactly what the call site
// passed in, so they join the row names under watch. That is how a badge helper's fallback
// `${cat}` is caught at the helper, rather than at each `badge(t.category)` call that reaches it.
const MARKUP_HELPERS = new Set();
const HELPER_PARAMS = new Set();
const HELPER_DEFS = [
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g,
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/g,
  /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g,
];
for (const re of HELPER_DEFS) {
  for (const m of CODE.matchAll(re)) {
    if (!MARKUP.test(bodyAt(CODE, m.index + m[0].length))) continue;
    MARKUP_HELPERS.add(m[1]);
    for (const raw of (m[2] || '').split(',')) {
      const p = raw.trim().split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(p)) { BINDINGS.add(p); HELPER_PARAMS.add(p); }
    }
  }
}

const BINDING_RE = new RegExp('(?:^|[^\\w$])(?:' + [...BINDINGS].map((n) => n.replace(/\$/g, '\\$')).join('|') + ')\\s*[.\\[]');

// A row is only dangerous through one of its fields, so `t.title` is a reference and `t` alone is
// not. A helper parameter is different: the call site hands it whatever it likes, the audit cannot
// see past the helper's own template, and `${cat}` — with no dot to match — is the whole value.
// So a bare helper parameter counts as a reference to user data.
const HELPER_PARAM_RE = HELPER_PARAMS.size
  ? new RegExp('(?:^|[^\\w$.])(?:' + [...HELPER_PARAMS].map(rx).join('|') + ')(?![\\w$])(?!\\s*=[^=])')
  : null;

// --- is a slot protected? ---------------------------------------------------

// Delete every balanced `NAME(…)` call for the given names; what a wrapper covers is protected,
// so a binding that disappears with it needs no further comment.
function stripCalls(text, names) {
  let s = text, guard = 0;
  while (guard++ < 200) {
    let hit = false;
    for (const n of names) {
      const m = new RegExp('(?:^|[^\\w$])' + rx(n) + '\\s*\\(', 'g').exec(s);
      if (!m) continue;
      const open = s.indexOf('(', m.index + m[0].length - 1);
      const close = matchPair(s, open, '(', ')');
      if (close < 0) break;
      s = s.slice(0, m.index) + ' ' + s.slice(close + 1);
      hit = true;
      break;
    }
    if (!hit) break;
  }
  return s;
}

// A formatter prints a number in a fixed shape: no field can push markup through `x.toFixed(2)`.
// The exemption is on the value as a whole, not on a suffix — `x.name + n.toFixed(2)` is a string,
// and `x.name` still has to be escaped — so the receiver chain is removed by structure and the
// remainder of the leaf is inspected like any other expression.
const FORMATTER_NAMES = new Set(['toFixed', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);

// Walk left from the `.` over the postfix chain (names, subscripts, calls) that made the number.
function chainStart(s, pairs, dot) {
  let i = dot - 1;
  for (;;) {
    while (i >= 0 && /\s/.test(s[i])) i--;
    if (i < 0) return 0;
    if (')]}'.includes(s[i])) {
      const j = pairs.get(i);
      if (j === undefined) return i + 1;
      i = j - 1;
      continue;
    }
    if (!/[\w$]/.test(s[i])) return i + 1;
    while (i >= 0 && /[\w$.]/.test(s[i])) i--;
  }
}

function stripFormatterChains(s) {
  const pairs = pairMap(s);
  const chars = s.split('');
  const hits = [];
  for (const m of s.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/g)) if (FORMATTER_NAMES.has(m[1])) hits.push({ dot: m.index, open: m.index + m[0].length - 1 });
  for (const h of hits) {
    const close = pairs.get(h.open);
    if (close === undefined) continue;
    for (let k = chainStart(s, pairs, h.dot); k <= close; k++) if (chars[k] !== '\n') chars[k] = ' ';
  }
  return chars.join('');
}

// The values a ternary can emit: the condition is only compared, never printed.
function emittedBranches(expr) {
  let s = expr.trim();
  // Grouping does not change what is emitted: `${(a ? 'X' : 'Y')}` emits two literals, not a
  // reference to `a`, which is what a naked `(`/`)` count would have concluded.
  while (s.startsWith('(') && pairMap(s).get(0) === s.length - 1) s = s.slice(1, -1).trim();
  let depth = 0, str = null, q = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (str) { if (c === '\\') { i++; continue; } if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === '`') { str = c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === '?' && depth === 0 && s[i + 1] !== '.' && i > 0 && s[i - 1] !== '?') { q = i; break; }
  }
  if (q < 0) return [s];
  let d2 = 0, s2 = null, colon = -1;
  for (let i = q + 1; i < s.length; i++) {
    const c = s[i];
    if (s2) { if (c === '\\') { i++; continue; } if (c === s2) s2 = null; continue; }
    if (c === '"' || c === "'" || c === '`') { s2 = c; continue; }
    if ('([{'.includes(c)) d2++;
    if (')]}'.includes(c)) d2--;
    if (c === ':' && d2 === 0) { colon = i; break; }
  }
  if (colon < 0) return [s];
  return [...emittedBranches(s.slice(q + 1, colon)), ...emittedBranches(s.slice(colon + 1))];
}

const unprotectedBindings = (expr) => {
  const leaves = emittedBranches(expr);
  const bad = [];
  for (const leaf of leaves) {
    let rest = stripCalls(leaf, [...PROTECTIVE, 'new Date', ...MARKUP_HELPERS]);
    rest = stripFormatterChains(rest);
    // A branch that is itself markup (a nested template) is not a value; its own slots are
    // audited separately, so it is not counted here.
    if (rest.includes('`')) continue;
    const m = rest.match(BINDING_RE) || (HELPER_PARAM_RE ? rest.match(HELPER_PARAM_RE) : null);
    if (m) bad.push((m.input || '').slice(Math.max(0, m.index), m.index + 46).trim());
  }
  return bad;
};

// --- the audit --------------------------------------------------------------

const markupTemplates = templates.filter((t) => MARKUP.test(CODE.slice(t.bodyStart, t.bodyEnd)));
const naked = [];
let emittedSlots = 0;
for (const t of markupTemplates) {
  for (const s of slotsInRange(CODE, t.bodyStart, t.bodyEnd)) {
    const before = CODE.slice(Math.max(0, s.start - 300), s.start);
    const inDoor = /(?:on[A-Za-z]+|src|href)\s*=\s*"[^"]*$/.test(before);
    if (inDoor) continue;                       // audited under the stricter rule below
    emittedSlots++;
    const bad = unprotectedBindings(s.expr);
    if (bad.length) naked.push({ line: lineAt(s.start), expr: s.expr.trim().slice(0, 90), bad: bad[0] });
  }
}

check('XSS-01', markupTemplates.length > 0 && naked.length === 0,
  naked.length
    ? `${naked.length} of ${emittedSlots} interpolated value(s) in ${markupTemplates.length} markup template(s) reach innerHTML unsanitised, e.g. line ${naked[0].line}: \${${naked[0].expr}} — ${naked[0].bad} is not escaped`
    : `all ${emittedSlots} interpolated value(s) across ${markupTemplates.length} markup templates are escaped, gated, absent-spelled, numeric-formatted or a literal`);
// A red link has to name every site, or the reviewer re-derives the list the guard already has.
if (naked.length) for (const n of naked) console.log(`     line ${n.line}: ${n.bad}`);

// The two doors where escaping is not enough, checked on the source text of the attribute.
const doorSlots = (attrRe, allowedName) => {
  const offenders = [];
  let total = 0;
  for (const m of CODE.matchAll(attrRe)) {
    const value = m[1];
    for (const slot of value.matchAll(/\$\{([^}]*)\}/g)) {
      total++;
      const expr = slot[1].trim();
      const okShape = new RegExp('^' + allowedName + '\\([\\w$.\\s|\'"-]+\\)$').test(expr);
      if (!okShape) offenders.push(`line ${lineAt(m.index)}: ${expr.slice(0, 70)}`);
    }
  }
  return { total, offenders };
};
const handlerDoor = doorSlots(/on[a-zA-Z]+\s*=\s*"([^"]*)"/g, 'safeId');
check('XSS-02', handlerDoor.offenders.length === 0,
  handlerDoor.offenders.length
    ? `${handlerDoor.offenders.length} of ${handlerDoor.total} inline-handler slot(s) is not a safeId(...) call: ${handlerDoor.offenders.slice(0, 3).join(' | ')}`
    : `every one of ${handlerDoor.total} slot(s) handed to an inline handler is a safeId(...) shape check — escHtml would be decoded by the attribute parser before the JS runs, so escaping there is not a defence`);

const urlDoor = doorSlots(/(?:src|href)\s*=\s*"([^"]*)"/g, 'safeUrl');
check('XSS-03', urlDoor.offenders.length === 0,
  urlDoor.offenders.length
    ? `${urlDoor.offenders.length} of ${urlDoor.total} src/href slot(s) is not a safeUrl(...) call: ${urlDoor.offenders.slice(0, 3).join(' | ')}`
    : `every one of ${urlDoor.total} src/href slot(s) goes through the URL allowlist, so a javascript: or data: value is refused rather than loaded`);

// escHtml in a handler or URL slot is its own failure, even if the audit above would pass.
const escapedInDoor = [...CODE.matchAll(/(on[a-zA-Z]+|src|href)\s*=\s*"[^"]*\$\{\s*escHtml\(/g)];
check('XSS-04', escapedInDoor.length === 0,
  escapedInDoor.length
    ? `${escapedInDoor.length} slot(s) use escHtml where it does not protect: line ${escapedInDoor.map((m) => lineAt(m.index)).join(', ')}`
    : 'and no door relies on entity escaping, which is the mistake the fix could have made');

// --- the helpers actually behave as claimed ---------------------------------

const grabDefinition = (startRe) => {
  const m = startRe.exec(CODE);
  if (!m) return null;
  const open = CODE.indexOf('{', m.index);
  if (open < 0) return null;
  let depth = 0, j = open;
  for (; j < CODE.length; j++) {
    if (CODE[j] === '{') depth++;
    if (CODE[j] === '}' && --depth === 0) break;
  }
  return CODE.slice(m.index, j + 1);
};
const defs = [
  grabDefinition(/function escHtml\(/),
  grabDefinition(/const safeId = /),
  grabDefinition(/const safeUrl = /),
  grabDefinition(/const requireId = /),
];
check('XSS-05', defs.every(Boolean), `the four helpers are all present in the shipped file (${defs.map((d, i) => (d ? 'yes' : 'MISSING:' + i)).join(', ')})`);

// Run the shipped code, not a copy of it, over the payloads this class produces.
let behaviour = { esc: false, ids: [], urls: [], refused: [] };
try {
  const sandbox = new Function('alerts', `
    const fired = [];
    const alert = (m) => fired.push(m);
    ${defs[0]};
    ${defs[1]};
    ${defs[2]};
    ${defs[3]};
    return {
      escHtml, safeId, safeUrl, requireId, fired,
    };
  `)();
  const HOSTILE = '</td><td><img src=x onerror=alert(1)>';
  const escaped = sandbox.escHtml(HOSTILE);
  behaviour.esc = !/[<>]/.test(escaped) && escaped.includes('&lt;') && !sandbox.escHtml(undefined).includes('undefined');
  const HOSTILE_ID = `abc');alert(1);//`;
  behaviour.ids = [sandbox.safeId('7f0d5b48-2f0a-4a10-9b6f-3b7b0f1c2d3e'), sandbox.safeId('NAB-9824'), sandbox.safeId(HOSTILE_ID), sandbox.safeId('x'.repeat(80))];
  behaviour.urls = [sandbox.safeUrl('https://img.nabin.test/a.png'), sandbox.safeUrl('javascript:alert(1)'), sandbox.safeUrl('data:text/html,<script>alert(1)</script>'), sandbox.safeUrl('/docs/toll_receipt.png'), sandbox.safeUrl(null)];
  behaviour.refused = [sandbox.requireId(HOSTILE_ID, 'ticket'), sandbox.requireId('', 'ticket'), sandbox.requireId('NAB-9824', 'ticket')];
  behaviour.alerts = sandbox.fired.length;
} catch (e) {
  check('XSS-06', false, `the shipped helpers could not be executed to prove they refuse: ${e.message}`);
}
if (behaviour.alerts !== undefined) {
  check('XSS-06', behaviour.esc, 'escHtml neutralises a tag-bearing ticket title: no raw angle bracket survives, and an absent value prints as empty rather than the word undefined');
  check('XSS-07', behaviour.ids[0] === '7f0d5b48-2f0a-4a10-9b6f-3b7b0f1c2d3e' && behaviour.ids[1] === 'NAB-9824' && behaviour.ids[2] === '' && behaviour.ids[3] === '',
    `safeId keeps the two identifier shapes this platform mints and refuses a quote-bearing one and an over-long one (kept, kept, '${behaviour.ids[2]}', '${behaviour.ids[3]}')`);
  check('XSS-08', behaviour.urls[0] === 'https://img.nabin.test/a.png' && behaviour.urls.slice(1).every((u) => u === ''),
    `safeUrl admits only an absolute http(s) URL: javascript:, data:, a root-relative path and nothing all answer '${behaviour.urls.slice(1).join('|')}'`);
  check('XSS-09', behaviour.refused[0] === false && behaviour.refused[1] === false && behaviour.refused[2] === true && behaviour.alerts === 2,
    `requireId stops a refused identifier reaching a fetch, and says so out loud rather than no-oping (${behaviour.alerts} refusal message(s))`);
}

// --- the handlers that put a parameter in a request URL guard it themselves ---

// A URL is the door where a refused value changes *what is asked for*: an empty id in
// `/api/admin/tickets/${id}` is `/api/admin/tickets/`, which is the whole collection, and a DELETE
// aimed at such a path deletes nothing while the console reports success. So the rule is scoped to
// the argument of `fetch(…)` — a parameter that only reaches the server through `JSON.stringify` is
// escaped by that call, and demanding a shape check there would train everyone to ignore this one.
function templatesIn(s, from = 0, to = s.length, out = []) {
  let i = from;
  while (i < to) {
    const c = s[i];
    if (c === '"' || c === "'") { i = Math.min(endOfString(s, i), to); continue; }
    if (c === '/' && isRegexStart(s, i)) { i = Math.min(endOfRegex(s, i), to); continue; }
    if (c === '`') {
      const end = Math.min(readTemplate(s, i), to);
      out.push([i + 1, end]);
      for (const slot of slotsInRange(s, i + 1, end)) templatesIn(s, slot.start + 2, slot.end - 1, out);
      i = end + 1;
      continue;
    }
    i++;
  }
  return out;
}

const fetchHandlers = [];
for (const m of CODE.matchAll(/\n\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
  const [name, paramsRaw] = [m[1], m[2]];
  const braceAt = m.index + m[0].length - 1;
  const braceEnd = matchPair(CODE, braceAt, '{', '}');
  if (braceEnd < 0) continue;
  const body = CODE.slice(braceAt, braceEnd + 1);
  const urlSlots = [];
  for (const f of body.matchAll(/\bfetch\s*\(/g)) {
    const open = f.index + f[0].length - 1;
    const close = matchPair(body, open, '(', ')');
    if (close < 0) continue;
    for (const [bs, be] of templatesIn(body, open + 1, close))
      for (const s of slotsInRange(body, bs, be)) urlSlots.push({ fetchAt: f.index, expr: s.expr });
  }
  if (!urlSlots.length) continue;
  for (const raw of paramsRaw.split(',')) {
    const p = raw.trim().split('=')[0].trim();
    if (!p || !/^[A-Za-z_$][\w$]*$/.test(p)) continue;
    const bare = new RegExp('(?:^|[^\\w$.])' + rx(p) + '(?![\\w$])');
    const named = urlSlots.filter((s) => bare.test(s.expr));
    if (!named.length) continue;
    const before = body.slice(0, named[0].fetchAt);
    const preflighted = new RegExp('requireId\\(\\s*' + rx(p) + '\\b').test(before);
    const inlineChecked = named.every((s) => /(?:^|[^.\w$])safeId\(/.test(s.expr));
    fetchHandlers.push({ name, p, guarded: preflighted || inlineChecked, line: lineAt(m.index) });
  }
}
check('XSS-10', fetchHandlers.length > 0 && fetchHandlers.every((h) => h.guarded),
  fetchHandlers.length === 0
    ? 'NO handler was found putting a parameter in a request URL — the check would pass vacuously, so it is a failure'
    : fetchHandlers.filter((h) => !h.guarded).length
      ? `${fetchHandlers.filter((h) => !h.guarded).length} of ${fetchHandlers.length} handler(s) interpolate a caller's parameter into a request URL without re-checking its shape: ${fetchHandlers.filter((h) => !h.guarded).map((h) => h.name + '(' + h.p + ') at line ' + h.line).join(', ')}`
      : `all ${fetchHandlers.length} handler(s) that put a parameter in a request URL (${fetchHandlers.map((h) => h.name + '(' + h.p + ')').join(', ')}) requireId-check it before the request, so a refused id cannot widen the query`);

// --- no fix is applied to a copy the browser never runs ----------------------

// Two declarations of one name in one scope: the later wins and the earlier never runs. This is how
// a guarded `deleteMasterSku` sat beside a live unguarded one, and a guard suite that read the first
// would have been right about the code and wrong about the program.
const declarations = new Map();
for (const m of CODE.matchAll(/\n\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
  const list = declarations.get(m[1]) || [];
  list.push(lineAt(m.index));
  declarations.set(m[1], list);
}
const shadowed = [...declarations].filter(([, lines]) => lines.length > 1);
check('XSS-12', shadowed.length === 0,
  shadowed.length
    ? `${shadowed.length} function name(s) declared more than once, where only the last copy ever runs: ${shadowed.map(([n, ls]) => n + ' (' + ls.join(', ') + ')').join('; ')}`
    : `every function in the console is declared once (${declarations.size} names), so a guard added to a handler is the guard the browser executes`);

// --- the file is still valid JS --------------------------------------------

const broken = [];
for (const m of SRC.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
  try { new Function(m[1]); } catch (e) { broken.push(`line ${lineAt(m.index)}: ${e.message}`); }
}
check('XSS-11', broken.length === 0,
  broken.length ? `an inline script no longer parses — ${broken.join(' | ')}` : `both inline scripts parse, so the escaping pass did not clip a string boundary`);

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
