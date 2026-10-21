#!/usr/bin/env node
// Route inventory: derives every HTTP registration in backend/src/server.js from source,
// so a recorded count can never drift from the code the way a hand-maintained list does.
//
// Structural contract this parser relies on, measured against the file on 2026-10-12:
//   - every registration opens at column 0 with app.<method>(
//   - the handler arrow (`=>`) is always on that same opener line
//   - the handler closes on a line that is exactly `});`
// Any registration that breaks one of these is reported, not guessed at.
//
// Usage: node scripts/route_inventory.js [--json <outfile>] [--quiet]
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'backend', 'src', 'server.js');
const METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all'];
// Auth guards imported or defined in server.js. An argument that is neither one of these
// nor the handler is reported as unidentified rather than silently counted as public.
const GUARDS = new Set([
  'authenticateUser', 'authenticateDriver', 'authenticateMerchant', 'requireMerchantTenant',
  'authenticateAdmin', 'requireSuperAdmin', 'requireSupportCallerAuth', 'requireCustomerAuth',
  'requireNotificationAuth',
]);
// Guards that take an argument: requireMerchantService('food'), requirePermission('finance.view').
const GUARD_FACTORIES = ['requireMerchantService', 'requirePermission', 'requireIdentityDecision'];
const OPEN_RE = new RegExp(`^app\\.(${METHODS.join('|')})\\(`);
const canonical = (p) => p.replace(/^\/api\/v1\//, '/api/');

const src = fs.readFileSync(SRC, 'utf8');
// server.js is stored with CRLF endings; strip the carriage return so structural matches
// (`});`) compare against content only. Line numbers are unaffected.
const lines = src.split('\n').map((l) => l.replace(/\r$/, ''));
const quoted = (s) => [...s.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);

const routes = [];
const anomalies = [];

for (let ln = 0; ln < lines.length; ln++) {
  const m = OPEN_RE.exec(lines[ln]);
  if (!m) continue;
  const lineNo = ln + 1;
  const arrow = lines[ln].indexOf('=>');
  if (arrow === -1) {
    anomalies.push({ line: lineNo, reason: 'handler arrow not on the opener line' });
    continue;
  }
  let endLine = null;
  const opens = (lines[ln].match(/\(/g) || []).length;
  const closes = (lines[ln].match(/\)/g) || []).length;
  // A one-line registration is paren-balanced on its own opener, e.g.
  // `app.get('/api/admin/jobs', authenticateAdmin, (req, res) => res.json({ jobs: db.jobs }));`
  // A multi-line handler opens more than it closes on the opener line.
  if (opens === closes && lines[ln].replace(/;+\s*$/, '').endsWith(')')) {
    endLine = lineNo;
  } else {
    for (let j = ln + 1; j < lines.length; j++) {
      if (lines[j] === '});') { endLine = j + 1; break; }
      if (OPEN_RE.test(lines[j])) break; // a sibling opened first: this one did not close
    }
  }
  if (endLine === null) {
    anomalies.push({ line: lineNo, reason: 'no `});` line before the next registration' });
    continue;
  }

  const head = lines[ln].slice(m[0].length, arrow);
  // Only the FIRST argument names the path(s); later arguments are guards, and guard
  // factories carry quoted permission names that must not be read as routes.
  const rest = head.replace(/^\s*/, '');
  let firstArg;
  if (rest.startsWith('[')) {
    const closeBracket = rest.indexOf(']');
    if (closeBracket === -1) {
      anomalies.push({ line: lineNo, reason: 'path array not closed on the opener line' });
      continue;
    }
    firstArg = rest.slice(0, closeBracket + 1);
  } else {
    const comma = rest.indexOf(',');
    firstArg = comma === -1 ? rest : rest.slice(0, comma);
  }
  const paths = [...new Set(quoted(firstArg).map(canonical))];
  if (!paths.length) anomalies.push({ line: lineNo, reason: 'no quoted path found in the opener' });

  const guardSource = rest.slice(firstArg.length);
  const guards = [];
  for (const tok of GUARD_FACTORIES) {
    const re = new RegExp(`\\b${tok}\\((['"])([^'"]*)\\1\\)`, 'g');
    for (const hit of guardSource.matchAll(re)) guards.push(hit[0]);
  }
  const bareArgs = guardSource
    .replace(/(['"])((?:\\.|(?!\1).)*)\1/g, '') // drop string literals (factory args)
    .split(/[\s,()=]+/)
    .filter((t) => /^[A-Za-z_$][\w$]*$/.test(t));
  for (const t of bareArgs) {
    if (GUARDS.has(t)) guards.push(t);
    else if (GUARD_FACTORIES.includes(t)) continue; // already captured with its argument
    else if (!['async', 'req', 'res', 'next'].includes(t)) {
      anomalies.push({ line: lineNo, reason: `unidentified opener token "${t}"`, path: paths[0] });
    }
  }

  const handler = lines.slice(ln, endLine).join('\n');
  routes.push({
    line: lineNo,
    endLine,
    method: m[1].toUpperCase(),
    paths,
    guards: [...new Set(guards)],
    authRequired: guards.length > 0,
    signals: {
      inMemoryDb: /\bdb\./.test(handler),
      supabase: /supabase\.|from\(/.test(handler),
      poolQuery: /\bpool\.query\b|withClient|\.query\s*\(/.test(handler),
      store: /persistentStore|\bstore\./.test(handler),
      sourceLabel: /source:\s*['"`]/.test(handler),
      idempotency: /idempot/i.test(handler),
      // Heuristic, not a verdict: text in the handler that *looks like* credential handling.
      // An unguarded route with authInBody=false is the case to read by hand.
      authInBody: /authorization|bearer|verifyOtp|verifyToken|getSession|authenticate[A-Z]?\w*\(req|req\.headers\[\s*['"`]x-/i.test(handler),
      rateLimit: /rateLimit|throttle|limit(er)?\b/i.test(handler),
      ownership: /req\.user|req\.merchant|req\.driver|ownerId|userId\s*===|merchantId\s*===|\.eq\(['"](user_id|merchant_id|driver_id)/.test(handler),
      placeholder: /TODO|FIXME|not implemented|coming soon/i.test(handler),
    },
  });
}

const byMethod = {};
for (const r of routes) byMethod[r.method] = (byMethod[r.method] || 0) + 1;
const pathOccurrences = routes.reduce((n, r) => n + r.paths.length, 0);
const uniquePaths = new Set(routes.flatMap((r) => r.paths)).size;
const guarded = routes.filter((r) => r.authRequired).length;

if (!process.argv.includes('--quiet')) {
  console.log(`registrations=${routes.length}  path occurrences=${pathOccurrences}  unique paths=${uniquePaths}`);
  console.log(`by method: ${JSON.stringify(byMethod)}`);
  console.log(`guarded=${guarded}  unguarded=${routes.length - guarded}`);
  if (anomalies.length) {
    console.log(`\nANOMALIES (${anomalies.length}) — the parse is not complete, inspect:`);
    for (const a of anomalies) console.log(`  ${a.line} ${a.path || ''} ${a.reason}`);
  } else {
    console.log('\nanomalies: none — every registration parsed under the documented structure');
  }
  const openAdmin = routes.filter((r) => !r.authRequired && r.paths.some((p) => /^\/api\/admin\b/.test(p)));
  console.log(`\n/api/admin routes with no guard (${openAdmin.length}):`);
  for (const r of openAdmin) console.log(`  ${r.line}  ${r.method} ${r.paths.join(' | ')}`);
}

const jsonArg = process.argv.indexOf('--json');
if (jsonArg > -1 && process.argv[jsonArg + 1]) {
  fs.writeFileSync(process.argv[jsonArg + 1], JSON.stringify(routes, null, 2) + '\n');
  console.log(`\nwrote ${process.argv[jsonArg + 1]}`);
}
