/*
 * SSF: the platform service switchboard may report which services are suspended, but it may not
 * invent how busy, how fast, or how well-liked they are.
 *
 * `this.platformServices` (backend/src/database.js) is the emergency killswitch registry. It is a
 * control-plane structure: an operator pauses a service, the booking gate refuses it, an admin sees
 * who paused it and why. Every field of that contract is real. Six of the entries also carried three
 * fields that are not, and the public, unauthenticated `GET /api/services/status` handed them out as
 * though the platform had measured them:
 *
 *   activeVolume  '1,248 active drivers • 942 on trip'   (rides)
 *                 '18 Darkstores Active • 4,810 SKUs Live' (grocery)
 *                 '620 Partner Kitchens • 850 Courier Fleet' (food)
 *                 '412 Courier Riders Active'             (parcel)
 *                 'UPI 2.0 Rails • 99.98% Gateway Success' (payments)
 *                 'Sub-second Geo-Proximity Matcher (18,400 sockets)' (dispatch)
 *   latencyMs     38 / 42 / 45 / 34 / 55 / 19 — no component of this backend measures a latency,
 *                 records a socket count, or stores an uptime percentage anywhere.
 *   metrics       { completedToday, satisfaction } — 3492/2180/1840/920/8432/8250 orders and
 *                 '4.82★'/'4.91★'/'4.78★'/'4.88★'/'99.9%'/'99.4%'. There is no ratings table in this
 *                 schema and `jobs` has no completed_at, so "completed today" has no definition to
 *                 measure against even if one wanted to infer it.
 *
 * Nothing computed any of it. The numbers are typed into a constructor, which makes them a static
 * placeholder wearing the shape of a measurement — and the placeholder is served to anyone who asks,
 * because the public route answers with `db.getServicesStatus()` whole.
 *
 * What is actually backed, and what this guard therefore pins:
 *  - The control contract. `pauseService`/`resumeService`/the auto-resume pass write status, pausedAt,
 *    pausedBy, pausedReason, resumeAt, affectedRegions, broadcastNotice, and `isServicePaused` plus the
 *    423 booking gate read them. Removing the fabricated fields must not remove one of those.
 *  - `summary`. total/active/paused/degraded are `Array.length` over the service objects the same call
 *    returns, so they are derived. This guard recomputes them from the live response and requires a
 *    match, which is how "derived" stays a fact rather than a claim.
 *  - Platform-wide counts that a caller genuinely needs already exist honestly on
 *    `/api/admin/metrics` (getAdminPlatformMetrics: exact head counts, `dataSource:'postgres'`,
 *    503 AUTH_STORE_UNAVAILABLE when the store cannot answer). This suite does not move them onto a
 *    public response — that is owner decision A, not a correction.
 *
 * The allowlist below is derived, not typed. It is the union of (a) the fields the backend's own
 * control machinery assigns, (b) the fields AppConfigService keeps when it projects the same status for
 * /api/app/config, and (c) the fields the two type-pinned clients declare they read. The admin
 * dashboard is deliberately NOT a source for it: a fabricated field read by the page that painted it
 * would justify itself. It is instead checked against the list.
 *
 * Two invariants that are easy to break while "cleaning up", both guarded here:
 *  - `getServicesStatus()` must stay synchronous. It is called by an anonymous public route, and
 *    docs/ADMIN_FEATURE_SPECIFICATION.md:482 records why: as an async read a lost record could 5xx a
 *    public endpoint. Truthfulness is not worth a public outage.
 *  - `restoreServiceState()` merges the durable `PLATFORM_SERVICE_STATE` snapshot onto the seeded
 *    objects. A raw `Object.assign` would re-inject whatever an older snapshot holds, so a snapshot
 *    written before this correction would resurrect the fabricated fields at every boot. The merge must
 *    filter.
 *
 * The static half adds no toolchain. The runtime half boots THIS tree's backend on 127.0.0.1 through
 * the loopback target guard and issues only GETs, so it creates no session, no job, no order and no
 * ledger line. `GET /api/services/status` is the one read in this tree that can write — the auto-resume
 * pass logs a `SERVICE_AUTO_RESUMED` audit row when a paused service's `resumeAt` has passed — so the
 * suite proves at the end that nothing it observed was paused, which is what makes "no residue" a
 * measured statement rather than an assumption.
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
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'services_status_fabrication_test' });

const ROOT = path.join(__dirname, '..');
const DATABASE = path.join(__dirname, 'src', 'database.js');
const SERVER = path.join(__dirname, 'src', 'server.js');
const APPCONFIG = path.join(__dirname, 'src', 'services', 'AppConfigService.js');
const DASHBOARD = path.join(ROOT, 'admin_dashboard.html');
const WEB_PAGE = path.join(ROOT, 'customer-web', 'src', 'app', 'page.tsx');
const OPS_PAGE = path.join(ROOT, 'admin-web', 'src', 'app', 'operations', 'page.tsx');

const label = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

// --- scanners that know strings, so a keyword inside prose or a class name is not a keyword -------
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
// A method DEFINITION, anchored at the line start. Searching a bare `\bname\s*(` finds the first call site
// instead (`await this.restoreServiceState()` sits 700 lines above its body), and a check then reads the
// wrong body while still reporting a PASS — which is worse than a FAIL, because the claim is unfalsified.
const DEF_RE = (name) => new RegExp(`^[ \\t]{0,6}(?:async[ \\t]+)?${name}[ \\t]*\\([^\\n]*\\)[ \\t]*\\{[ \\t]*$`, 'm');
function methodDef(code, name) {
  const m = DEF_RE(name).exec(code);
  return m ? m.index + m[0].indexOf(name) : -1;
}
function methodIsAsync(code, name) {
  const m = new RegExp(`^[ \\t]{0,6}(async)[ \\t]+${name}[ \\t]*\\(`, 'm').exec(code);
  return Boolean(m);
}
function methodBody(code, name) {
  const at = methodDef(code, name);
  if (at < 0) return null;
  const openParen = code.indexOf('(', at);
  const closeParen = matchPair(code, openParen, '(', ')');
  return closeParen < 0 ? null : bodyFrom(code, closeParen + 1);
}
function entriesOf(objText) {
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
    if (m) out.push({ key: m[1], value: m[2].trim() });
  }
  return out;
}
// Keys of a TS interface, and `name?.` / `name.x` reads, both from a blanked source.
function tsInterfaceKeys(src, name) {
  const at = src.indexOf(`interface ${name}`);
  if (at < 0) return null;
  const b = bodyFrom(src, at);
  if (!b) return null;
  return [...b.text.matchAll(/([A-Za-z_$][\w$]*)\??\s*:/g)].map((m) => m[1]);
}
const dottedKeys = (src, receiver, body) =>
  [...(body || '').matchAll(new RegExp(`\\b${receiver}\\.([A-Za-z_$][\\w$]*)`, 'g'))].map((m) => m[1]);

const SOURCES = [['database.js', DATABASE], ['server.js', SERVER], ['AppConfigService.js', APPCONFIG],
  ['admin_dashboard.html', DASHBOARD], ['customer-web/src/app/page.tsx', WEB_PAGE],
  ['admin-web/src/app/operations/page.tsx', OPS_PAGE]];
const gone = SOURCES.filter(([, f]) => !fs.existsSync(f)).map(([n]) => n);
if (gone.length) {
  check('SSF-00', false, `${gone.length} source(s) this guard reads are gone: ${gone.join(', ')} — nothing below can be measured`);
  process.exitCode = 1;
  finish();
  return;
}
check('SSF-00', true, `all ${SOURCES.length} witness sources are present: ${SOURCES.map(([n]) => n).join(', ')}`);

const D = blankComments(fs.readFileSync(DATABASE, 'utf8'));
const S = blankComments(fs.readFileSync(SERVER, 'utf8'));
const AC = blankComments(fs.readFileSync(APPCONFIG, 'utf8'));
const HD = fs.readFileSync(DASHBOARD, 'utf8');
const HDB = blankComments(HD);
const WP = blankComments(fs.readFileSync(WEB_PAGE, 'utf8'));
const OP = blankComments(fs.readFileSync(OPS_PAGE, 'utf8'));

// =====================================================================================
// Group A — the registry as written, and the allowlist the platform's own code justifies
// =====================================================================================

const regAt = D.indexOf('this.platformServices =');
const REG = regAt < 0 ? null : bodyFrom(D, regAt + 'this.platformServices ='.length);
check('A1', Boolean(REG) && REG.text.length > 200, REG
  ? `the switchboard registry is a constructor literal at ${label(DATABASE)}:~${lineOf(D, regAt)} — `
    + `${entriesOf(REG.text).length} service entries written into it`
  : `the platformServices literal could not be read out of ${label(DATABASE)}, so no claim below about it was measured (FAIL)`);

const ENTRIES = REG ? entriesOf(REG.text).map((e) => {
  const b = /^\{/.test(e.value) ? e.value : '';
  return { id: e.key, keys: b ? entriesOf(b).map((k) => k.key) : [], raw: b };
}) : [];
const SEED_IDS = ENTRIES.map((e) => e.id);
check('A2', ENTRIES.length >= 6 && ENTRIES.every((e) => e.keys.length > 0),
  `parsed ${ENTRIES.length} entries [${SEED_IDS.join(', ')}] from the literal, each with its field list intact `
  + `(${ENTRIES.map((e) => `${e.id}:${e.keys.length}`).join(', ')})`);

// (a) what the control machinery writes
const METHOD_BODIES = ['getServicesStatus', 'pauseService', 'resumeService'].map((m) => methodBody(D, m));
const WRITTEN = [...new Set(METHOD_BODIES.filter(Boolean)
  .flatMap((b) => [...b.text.matchAll(/\bs\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1])))];
// (b) what the backend's own public projection keeps
const PROJ_AT = AC.indexOf('buildServiceSection');
const PROJ_BODY = PROJ_AT < 0 ? null : bodyFrom(AC, PROJ_AT);
const KEPT = PROJ_BODY ? [...new Set(dottedKeys(null, 'service', PROJ_BODY.text))] : [];
// (c) what the two type-pinned clients declare they read
const C_WEB = tsInterfaceKeys(WP, 'ServiceInfo') || [];
const A_WEB = tsInterfaceKeys(OP, 'ServiceRow') || [];
const ALLOWED = [...new Set([...WRITTEN, ...KEPT, ...C_WEB, ...A_WEB, 'id'])].sort();

check('A3', WRITTEN.length >= 7 && Boolean(KEPT.length) && C_WEB.length >= 5 && A_WEB.length >= 8,
  `the allowlist is derived, not typed: the control machinery assigns [${WRITTEN.join(', ')}]; `
  + `AppConfigService.buildServiceSection keeps [${KEPT.join(', ')}]; customer-web ServiceInfo declares `
  + `[${C_WEB.join(', ')}]; admin-web ServiceRow declares [${A_WEB.join(', ')}]. Union = ${ALLOWED.length} field(s): `
  + `[${ALLOWED.join(', ')}]. The admin dashboard is excluded as evidence — a field it invented cannot justify itself`);

const METRIC_SHAPED = /volume|latenc|\bmetrics?\b|completedtoday|satisfaction|rating|socket|uptime|percent|throughput|headcount|\bcount\b|active.?drivers|sku/i;
const OUTSIDE = ENTRIES.flatMap((e) => e.keys.filter((k) => !ALLOWED.includes(k)).map((k) => `${e.id}.${k}`));
check('B1', OUTSIDE.length === 0, OUTSIDE.length
  ? `${OUTSIDE.length} field(s) in the seeded registry are in no projection, no control write and no client `
    + `interface, so nothing in this platform computes or needs them: [${[...new Set(OUTSIDE.map((s) => s.split('.')[1]))].join(', ')}]`
  : 'every field of every service entry traces to a control write, the public projection, or a client that declares it');

const METRIC_KEYS = ENTRIES.flatMap((e) => e.keys.filter((k) => METRIC_SHAPED.test(k)));
check('B2', METRIC_KEYS.length === 0, METRIC_KEYS.length
  ? `${METRIC_KEYS.length} field name(s) in the registry advertise a measurement the schema has no column for: `
    + `[${[...new Set(METRIC_KEYS)].join(', ')}]`
  : 'no field name in the registry claims a volume, latency, satisfaction, socket count or completion total');

const NUMERIC_VALUES = ENTRIES.flatMap((e) => {
  const parsed = e.raw ? entriesOf(e.raw) : [];
  return parsed.filter((p) => /^-?\d+(\.\d+)?$/.test(p.value)).map((p) => `${e.id}.${p.key}=${p.value}`);
});
check('B3', NUMERIC_VALUES.length === 0, NUMERIC_VALUES.length
  ? `${NUMERIC_VALUES.length} seeded value(s) is a bare number standing in for an instrument that does not exist: `
    + `[${NUMERIC_VALUES.join(', ')}]`
  : 'no seeded service field is a bare number — the control contract is strings, nulls and arrays');

const STRONG_CLAIMS = [...D.matchAll(/([\d][\d,]{2,})\s*(active drivers|Darkstores|Partner Kitchens|Courier|sockets|SKUs|Gateway)/gi)]
  .map((m) => m[0]);
check('B4', STRONG_CLAIMS.length === 0, STRONG_CLAIMS.length
  ? `${STRONG_CLAIMS.length} operational volume claim(s) is still written into the source of the switchboard: `
    + `[${STRONG_CLAIMS.join(' | ')}]`
  : 'no fleet size, darkstore count, SKU count, socket count or gateway percentage survives in database.js');

// =====================================================================================
// Group C — the control contract and the killswitch must still work
// =====================================================================================

const CONTROL_FIELDS = ['status', 'pausedAt', 'pausedBy', 'pausedReason', 'resumeAt', 'affectedRegions', 'broadcastNotice'];
check('C1', CONTROL_FIELDS.every((f) => WRITTEN.includes(f)),
  `the correction left the killswitch contract whole: the machinery still assigns [${WRITTEN.join(', ')}], which `
  + `covers every field isServicePaused and the 423 booking gate depend on [${CONTROL_FIELDS.join(', ')}]`);

const gsAt = methodDef(D, 'getServicesStatus');
const gsIsAsync = gsAt >= 0 && methodIsAsync(D, 'getServicesStatus');
check('C2', gsAt >= 0 && !gsIsAsync, gsAt < 0
  ? 'getServicesStatus could not be located (FAIL)'
  : `${gsIsAsync ? 'it IS async' : `still declared synchronously at line ~${lineOf(D, gsAt)}`}. The auto-resume `
    + 'pass has to stay sync: this is the call an anonymous public route answers with, and an async read that '
    + 'loses a record would 5xx a public endpoint (docs/ADMIN_FEATURE_SPECIFICATION.md:482)');

const GS_BODY = gsAt < 0 ? null : methodBody(D, 'getServicesStatus');
const summaryDerived = GS_BODY && /total\s*=\s*services\.length/.test(GS_BODY.text)
  && /paused\s*=\s*services\.filter\([^)]*PAUSED/.test(GS_BODY.text)
  && /active\s*=\s*services\.filter\([^)]*ACTIVE/.test(GS_BODY.text)
  && /degraded[^:]*:\s*services\.filter\([^)]*DEGRADED/.test(GS_BODY.text);
check('C3', Boolean(summaryDerived), summaryDerived
  ? 'summary is derived — total/active/paused/degraded are Array.length over the very services array this '
    + 'response returns, so they measure the switchboard rather than decorate it'
  : 'summary is no longer recomputed from the returned services, so its counts are an assertion (FAIL)');

const restoreAt = methodDef(D, 'restoreServiceState');
const restoreBody = restoreAt < 0 ? null : methodBody(D, 'restoreServiceState');
const rawMerge = Boolean(restoreBody) && /Object\.assign\(/.test(restoreBody.text);
check('C4', Boolean(restoreBody) && !rawMerge, !restoreBody
  ? `restoreServiceState's DEFINITION could not be anchored in src/database.js (its name does occur at line `
    + `~${lineOf(D, Math.max(0, D.search(/\brestoreServiceState\s*\(/)))}), so the boot merge was NOT measured (FAIL)`
  : rawMerge
    ? `restoreServiceState (definition at line ~${lineOf(D, restoreAt)}) still assigns the stored object onto the `
      + `seeded one wholesale: a snapshot written before this correction re-injects every retired field at boot, so `
      + `the fabricated numbers would come back on their own (FAIL)`
    : `the boot merge at line ~${lineOf(D, restoreAt)} no longer assigns the stored object wholesale onto the seeded `
      + 'one — C5 executes that same method to prove it');

// =====================================================================================
// Group D — authorization boundaries the correction must not move
// =====================================================================================

const PUB = "app.get('/api/services/status'";
const ADM = "app.get('/api/admin/services/status'";
const pubAt = S.indexOf(PUB);
const admAt = S.indexOf(ADM);
const pubBody = pubAt < 0 ? null : bodyFrom(S, S.indexOf('=>', pubAt) > 0 ? S.indexOf('=>', pubAt) : pubAt);
check('D1', pubAt >= 0 && admAt >= 0 && !/authenticateAdmin/.test(S.slice(pubAt, pubBody ? pubBody.start : pubAt + 120))
  && /authenticateAdmin/.test(S.slice(admAt, admAt + 120)),
  `both routes are where this platform put them and nothing here moved them: GET /api/services/status `
  + `(${label(SERVER)}:~${lineOf(S, pubAt)}) is answered without a credential because customer-web's home page reads it, `
  + `and GET /api/admin/services/status (:~${lineOf(S, admAt)}) is still behind authenticateAdmin`);

const writeRoutes = [
  ["/api/admin/services/pause", 'services.pause'],
  ["/api/admin/services/resume", 'services.resume'],
  ["/api/admin/services/emergency-killswitch", 'services.emergency_killswitch'],
].map(([p, perm]) => {
  const at = S.indexOf(p);
  const seg = at < 0 ? '' : S.slice(at, at + 420);
  return { path: p, perm, ok: at >= 0 && /authenticateAdmin/.test(seg) && new RegExp(`requirePermission\\(\\s*['"]${perm}['"]`).test(seg) };
});
check('D2', writeRoutes.every((r) => r.ok),
  `the three routes that can suspend the platform are still ${writeRoutes.map((r) => `${r.path}→authenticateAdmin+requirePermission('${r.perm}')`).join(', ')} — `
  + 'this correction touches reads only');

const readyAt = S.indexOf("app.get('/api/ready'");
const readyBody = readyAt < 0 ? null : bodyFrom(S, S.indexOf('=>', readyAt) > 0 ? S.indexOf('=>', readyAt) : readyAt);
const readyJson = readyBody ? bodyFrom(readyBody.text, readyBody.text.indexOf('res.status')) : null;
const READY_KEYS = readyJson ? [...new Set(entriesOf(readyJson.text).map((e) => e.key))] : [];
check('D3', READY_KEYS.length > 0 && READY_KEYS.every((k) => !METRIC_SHAPED.test(k))
  && /getServicesStatus\(\)/.test(readyBody.text) && /summary/.test(readyBody.text),
  `readiness still answers with [${READY_KEYS.join(', ')}] built from db.getServicesStatus().summary — the probe is `
  + `about whether the platform will serve, not about how many orders it thinks it did`);

// =====================================================================================
// Group E — the operator dashboard: absent must render as absent, never as a number
// =====================================================================================

const READS = [...new Set(dottedKeys(null, 'service', HDB))];
const READ_OUTSIDE = READS.filter((k) => !ALLOWED.includes(k));
check('E1', READS.length > 0 && READ_OUTSIDE.length === 0, READS.length === 0
  ? 'no service.<field> read was found in admin_dashboard.html at all, which would mean the card is dead (FAIL)'
  : READ_OUTSIDE.length
    ? `the dashboard reads ${READ_OUTSIDE.length} field(s) no part of the backend writes or projects: `
      + `[${READ_OUTSIDE.join(', ')}] — whatever it prints from them is authored, not observed`
    : `all ${READS.length} service fields the dashboard reads [${READS.join(', ')}] are fields the platform actually carries`);

const FALLBACKS = [
  [/\|\|\s*['"]Active['"]/, `|| 'Active'`],
  [/\|\|\s*40\b/, `|| 40`],
  [/'System OK'/, `'System OK'`],
].filter(([re]) => re.test(HDB));
check('E2', FALLBACKS.length === 0, FALLBACKS.length
  ? `${FALLBACKS.length} substitution(s) turn a missing measurement into a plausible one on the operator screen: `
    + FALLBACKS.map(([, t]) => t).join(', ')
  : 'the dashboard no longer stands a word or a number in for a metric the backend never sent');

const gridAt = HDB.indexOf('function renderServicesGrid');
const GRID = gridAt < 0 ? null : bodyFrom(HDB, gridAt);
const painted = GRID ? [...GRID.text.matchAll(/>([^<>{}$]{4,})</g)].map((m) => m[1].trim()).filter((t) => /[A-Za-z]{3}/.test(t)) : [];
const honest = painted.filter((t) => /not measured|no telemetry|unavailable|not instrumented/i.test(t));
check('E3', Boolean(GRID) && honest.length >= 1, GRID
  ? honest.length
    ? `${honest.length} cell(s) say the honest sentence instead of a fake one: [${honest.join(' | ')}]`
    : `the card grid paints ${painted.length} text cell(s) [${painted.slice(0, 12).join(' | ')}] and not one of them `
      + 'says the metric is unavailable — an absent measurement is being hidden, not reported (FAIL)'
  : 'renderServicesGrid is gone, so the display half was NOT measured (FAIL)');

const interpolations = GRID ? [...GRID.text.matchAll(/\$\{([^{}]*)\}/g)].map((m) => m[1]) : [];
const numericFallbacks = interpolations.filter((e) => /\|\|\s*\d/.test(e) && /service\./.test(e));
check('E4', interpolations.length > 0 && numericFallbacks.length === 0,
  `scanned ${interpolations.length} interpolation(s) in the card renderer; `
  + (numericFallbacks.length
    ? `${numericFallbacks.length} of them default a service field to a number: [${numericFallbacks.join(' | ')}] (FAIL)`
    : 'none defaults a service field to a number'));

// =====================================================================================
// Group C' — the boot merge, executed rather than read
//
// The durable snapshot is the one path by which a retired field can come back on its own, so this is
// proved by calling restoreServiceState() twice in THIS process with a stubbed store handle: once with a
// snapshot that still carries the fabricated fields, once with a legitimate control change. Nothing is
// queried and nothing is written — the fake store never reaches PostgreSQL.
// =====================================================================================

async function runRestoreProof() {
  let db;
  try {
    db = require('./src/database');
  } catch (e) {
    check('C5', false, `src/database.js could not be required, so the boot merge was NOT executed: ${String(e && e.message)}`);
    check('C6', false, 'not measured because the store could not be loaded');
    return;
  }
  const real = db.liveStore.bind(db);
  // The proof mutates the in-process registry, so keep the ride's own control state to put back afterwards.
  const ridesBaseline = JSON.parse(JSON.stringify(db.platformServices.rides || {}));
  const snapshot = (value) => {
    db.liveStore = () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { setting_value: value }, error: null }) }) }) })
    });
  };
  const future = new Date(Date.now() + 3600000).toISOString();

  try {
    // A snapshot written before the correction: control state plus the fields this code no longer declares.
    snapshot({
      setting_key: 'PLATFORM_SERVICE_STATE',
      services: {
        rides: {
          status: 'ACTIVE',
          activeVolume: '9,999 active drivers • 9,999 on trip',
          latencyMs: 7,
          metrics: { completedToday: 999, satisfaction: '5.00★' }
        }
      },
      pauseHistory: []
    });
    const staleRestored = await db.restoreServiceState();
    const stale = db.getServicesStatus().services.find((s) => s.id === 'rides') || {};
    const staleKeys = Object.keys(stale);
    const resurrected = staleKeys.filter((k) => !ALLOWED.includes(k));
    const staleNumerics = staleKeys.filter((k) => typeof stale[k] === 'number');
    check('C5', staleRestored === true && resurrected.length === 0 && staleNumerics.length === 0,
      `restoreServiceState() was executed against a snapshot that still holds activeVolume, latencyMs and metrics: `
      + `it reported ${staleRestored} and the ride came back carrying [${staleKeys.join(', ')}] → `
      + `${resurrected.length ? `RESURRECTED [${resurrected.join(', ')}] (FAIL)` : 'not one retired field returned'} and `
      + `${staleNumerics.length ? `a number again (FAIL)` : 'no number reappeared'}. The fabricated figures cannot `
      + 'come back from the durable store on their own');

    // The same call must still apply a real control change, or the guard would have "fixed" the killswitch.
    snapshot({
      services: {
        rides: {
          status: 'PAUSED',
          pausedAt: future,
          pausedBy: 'Examiner (SUPER_ADMIN)',
          pausedReason: 'Snapshot restore proof',
          resumeAt: future,
          affectedRegions: ['ALL_REGIONS'],
          broadcastNotice: 'Restore proof notice'
        }
      },
      pauseHistory: []
    });
    const liveRestored = await db.restoreServiceState();
    const live = db.getServicesStatus().services.find((s) => s.id === 'rides') || {};
    const kept = live.status === 'PAUSED' && live.pausedBy === 'Examiner (SUPER_ADMIN)'
      && live.pausedReason === 'Snapshot restore proof' && live.resumeAt === future
      && Array.isArray(live.affectedRegions) && live.broadcastNotice === 'Restore proof notice';
    check('C6', liveRestored === true && kept,
      `the bounded merge still restores a genuine suspension: status=${live.status} pausedBy=${live.pausedBy} `
      + `reason="${live.pausedReason}" resumeAt=${live.resumeAt} regions=${JSON.stringify(live.affectedRegions)} — `
      + `${kept ? 'every control field landed, so durability of the killswitch survived the correction'
        : 'a control field was dropped, so the merge is now too narrow (FAIL)'}`);
  } finally {
    db.liveStore = real;
    db.platformServices.rides = ridesBaseline;
  }
}

// =====================================================================================
// Group F — the running backend, asked without a credential
// =====================================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(baseUrl, urlPath) {
  const res = await fetch(baseUrl + urlPath);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* a non-JSON answer is still an answer */ }
  return { status: res.status, body: json, text };
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
    let up = false;
    while (Date.now() < deadline && !up) {
      await sleep(250);
      try { up = (await fetch(`${baseUrl}/api/health`)).status === 200; } catch (e) { /* not up yet */ }
    }
    check('F0', up, up
      ? `the backend this route table belongs to booted on 127.0.0.1:${port} against the loopback store this run `
        + `declared (${PG_TARGET.host}:${PG_TARGET.port}/${PG_TARGET.database}, from ${PG_TARGET.source}). Only GETs follow`
      : `the backend never came up, so the runtime claims were NOT measured: ${stderr.join('').slice(-240)}`);
    if (!up) return;

    const pub = await req(baseUrl, '/api/services/status');
    const services = Array.isArray(pub.body?.services) ? pub.body.services : [];
    const keysSeen = [...new Set(services.flatMap((s) => Object.keys(s)))];
    const outside = keysSeen.filter((k) => !ALLOWED.includes(k));
    const shaped = keysSeen.filter((k) => METRIC_SHAPED.test(k));
    const numerics = services.flatMap((s) => Object.entries(s).filter(([, v]) => typeof v === 'number')
      .map(([k, v]) => `${s.id}.${k}=${v}`));
    check('F1', pub.status === 200 && services.length > 0 && outside.length === 0 && shaped.length === 0,
      `GET /api/services/status with no credential: ${pub.status}, ${services.length} service(s), fields `
      + `[${keysSeen.join(', ')}] → ${outside.length ? `UNJUSTIFIED [${outside.join(', ')}] (FAIL)` : 'all justified by a control write, the projection, or a client'}, `
      + `${shaped.length ? `and ${shaped.length} measurement-shaped name(s) [${shaped.join(', ')}] (FAIL)` : 'no measurement-shaped name'}`);
    check('F2', services.length > 0 && numerics.length === 0, numerics.length
      ? `the anonymous response still carries ${numerics.length} number(s) about operational load: [${numerics.join(', ')}] (FAIL)`
      : `nothing in the anonymous payload is a number — every value is a control state, a label, or null`);

    const sum = pub.body?.summary || {};
    const recomputed = {
      total: services.length,
      active: services.filter((s) => s.status === 'ACTIVE').length,
      paused: services.filter((s) => s.status === 'PAUSED').length,
      degraded: services.filter((s) => s.status === 'DEGRADED').length,
    };
    const sumOk = ['total', 'active', 'paused', 'degraded'].every((k) => sum[k] === recomputed[k]);
    check('F3', sumOk && sum.platformStatus === (recomputed.paused === recomputed.total ? 'EMERGENCY_LOCKDOWN'
      : recomputed.paused > 0 ? 'PARTIALLY_DEGRADED' : 'OPERATIONAL'),
      `summary was recomputed from the same response and matched: answered ${JSON.stringify({ total: sum.total, active: sum.active, paused: sum.paused, degraded: sum.degraded, platformStatus: sum.platformStatus })} `
      + `vs recomputed ${JSON.stringify(recomputed)} — the counts a caller sees are derived from the services it is given`);

    const ready = await req(baseUrl, '/api/ready');
    const readyServices = ready.body?.services || {};
    const readyKeys = Object.keys(readyServices);
    check('F4', ready.status === 200 && ready.body?.ready === true && ready.body?.database?.connected === true
      && readyKeys.every((k) => !METRIC_SHAPED.test(k)) && readyKeys.length > 0,
      `GET /api/ready: ${ready.status} ready=${ready.body?.ready} db=${JSON.stringify(ready.body?.database)} `
      + `services=[${readyKeys.join(', ')}] — the probe reports ${readyKeys.length} control fields and no business volume, `
      + 'so the consumers that page-and-halo on it get exactly what readiness requires');

    const admin = await req(baseUrl, '/api/admin/services/status');
    const adminLeaked = Array.isArray(admin.body?.services) && admin.body.services.length > 0;
    check('F5', admin.status >= 400 && admin.status < 500 && !adminLeaked,
      `GET /api/admin/services/status with no credential: ${admin.status} ${admin.body?.code || admin.body?.error || ''} `
      + `→ ${adminLeaked ? 'IT HANDED BACK THE SERVICE LIST (FAIL)' : 'no service payload, no summary, nothing'} — the `
      + 'operator twin is still closed to anonymous callers');

    const cfg = await req(baseUrl, '/api/app/config');
    const section = cfg.body?.sections?.services || {};
    const cfgServices = Array.isArray(section.services) ? section.services : [];
    const cfgKeys = [...new Set(cfgServices.flatMap((s) => Object.keys(s)))];
    check('F6', cfg.status === 200 && cfgServices.length > 0
      && cfgKeys.every((k) => ALLOWED.includes(k)) && !cfgKeys.includes('pausedBy') && !cfgKeys.includes('pauseHistory')
      && !Object.keys(section).includes('pauseHistory'),
      `GET /api/app/config: ${cfg.status}, ${cfgServices.length} service(s) projected as [${cfgKeys.join(', ')}] `
      + `under sections.services alongside summary — ${cfgKeys.includes('pausedBy') ? 'leaks who paused (FAIL)' : 'no pausedBy'}, `
      + `${cfgKeys.includes('pauseHistory') || Object.keys(section).includes('pauseHistory') ? 'leaks the incident history (FAIL)' : 'no pauseHistory'}, `
      + `and ${cfgKeys.some((k) => !ALLOWED.includes(k)) ? `${cfgKeys.filter((k) => !ALLOWED.includes(k)).join(', ')} appear(s) out of nowhere (FAIL)` : 'not one invented metric'}`);

    const stillPaused = recomputed.paused;
    check('F7', stillPaused === 0, stillPaused === 0
      ? 'no service was PAUSED at any point in these reads, so the auto-resume pass had nothing to resume and wrote '
        + 'no SERVICE_AUTO_RESUMED audit row — the four GETs above are the whole footprint of this suite'
      : `${stillPaused} service(s) were paused during the probe, so a resume audit row may have been written (FAIL — report as residue)`);
  } finally {
    proc.kill();
  }
}

async function main() {
  try {
    await runRestoreProof();
  } catch (err) {
    check('C5', false, `the boot-merge proof threw before it could measure: ${String(err && err.message)}`);
    check('C6', false, 'not measured because the boot-merge proof threw');
  }
  try {
    await runRuntime();
  } catch (err) {
    check('F0', false, `the runtime half threw before it could measure: ${String(err && err.message)}`);
  }
  finish();
}

main();

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`📊 SERVICES STATUS FABRICATION: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log(`failed: ${failed.map((f) => f.id).join(', ')}`);
  console.log('='.repeat(72));
  process.exitCode = failed.length ? 1 : 0;
}
