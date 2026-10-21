// =========================================================================
// CORS security suite (Security Hardening Phase 1).
//
// It stands up a minimal Express app mounted with the SAME cors middleware
// the real server uses (services/corsConfig.js), listens on an ephemeral port,
// and drives real HTTP/OPTIONS requests at it. Every assertion reads the
// actual response headers off the wire — never a substring of the source — so
// a policy that compiles but misbehaves at runtime still fails here. The Vercel
// edge configs and the removed suffix rule are checked as committed
// configuration, which is exactly the surface that bypasses the Node app.
//
// Run:  node backend/cors_security_test.js   (no database needed)
// =========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  createCorsMiddleware,
  buildAllowedOrigins,
  assertValidOrigin,
  DEV_ORIGINS,
  PROD_ORIGINS
} = require('./src/services/corsConfig');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Count occurrences of a response header from the raw wire, so a duplicated or
// contradictory Access-Control-Allow-Origin cannot hide behind Node's
// last-write-wins `res.headers` object.
function headerValues(rawHeaders, wanted) {
  const out = [];
  const lower = wanted.toLowerCase();
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (String(rawHeaders[i]).toLowerCase() === lower) out.push(rawHeaders[i + 1]);
  }
  return out;
}

function fire(serverPort, { method = 'GET', p = '/probe', origin, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (origin !== undefined) h.Origin = origin;
    const req = http.request({ host: '127.0.0.1', port: serverPort, method, path: p, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        rawHeaders: res.rawHeaders,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

// One small app with the exact middleware, plus a state-changing POST guarded
// only by an Authorization check — the same shape every real protected route
// has. CORS must never let a request past this check, and must never block a
// legitimate non-browser caller with it.
function startApp({ production }) {
  return new Promise(resolve => {
    const app = express();
    app.use(createCorsMiddleware({ production }));
    app.get('/probe', (req, res) => res.json({ ok: true }));
    app.post('/write', (req, res) => {
      if (req.headers.authorization !== 'Bearer good-token') {
        return res.status(401).json({ error: 'unauthorized' });
      }
      res.json({ written: true });
    });
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function main() {
  // --- A. Every confirmed trusted origin is accepted and reflected exactly once ---
  const { server, port } = await startApp({ production: false });
  console.log('\n--- CORS-SEC: Dev-mode origin policy over real HTTP ---');

  const devTrusted = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002',
    'http://localhost:3003', 'http://localhost:3004', 'https://admin.nabin.in'];
  for (const origin of devTrusted) {
    const r = await fire(port, { method: 'OPTIONS', origin,
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type, idempotency-key' } });
    const acao = headerValues(r.rawHeaders, 'access-control-allow-origin');
    check(`CORS-SEC-01 [${origin}]: preflight accepted, ACAO present exactly once and equal to the origin`,
      r.status === 204 && acao.length === 1 && acao[0] === origin,
      `status=${r.status} acao=${JSON.stringify(acao)}`);
  }

  // --- B. A credentialed approved request returns the exact origin AND Vary: Origin ---
  {
    const origin = 'http://localhost:3004'; // the merchant-web dev origin the report named
    const r = await fire(port, { method: 'GET', p: '/probe', origin, headers: { Authorization: 'Bearer good-token' } });
    const acao = headerValues(r.rawHeaders, 'access-control-allow-origin');
    const vary = headerValues(r.rawHeaders, 'vary');
    check('CORS-SEC-02: an approved credentialed GET reflects the exact origin once and carries Vary: Origin',
      r.status === 200 && acao.length === 1 && acao[0] === origin
      && vary.some(v => /origin/i.test(v)),
      `status=${r.status} acao=${JSON.stringify(acao)} vary=${JSON.stringify(vary)}`);
  }

  // --- C. Unsafe-suffix origins are refused, by construction, with no permissive ACAO ---
  // Each of these once matched the removed `origin.endsWith('.nabin.in')` rule OR is
  // the classic look-alike; none is an exact allowlist entry, so all must be refused.
  const refused = [
    'https://evil.nabin.in',            // a subdomain suffix-match used to silently trust
    'https://anything.nabin.in',        // the same class: any future *.nabin.in
    'https://evil.nabin.in.attacker.tld',
    'https://nabin.in.evil.com',
    'https://evil.example.com',
    'http://localhost:9999'             // an unlisted dev port
  ];
  for (const origin of refused) {
    const r = await fire(port, { method: 'GET', p: '/probe', origin });
    const acao = headerValues(r.rawHeaders, 'access-control-allow-origin');
    check(`CORS-SEC-03 [${origin}]: refused — no ACAO header, nothing reflected`,
      acao.length === 0,
      `acao=${JSON.stringify(acao)}`);
  }

  // --- D. A no-Origin (non-browser) request is never CORS-blocked and gets no permissive ACAO ---
  {
    const noAuth = await fire(port, { method: 'POST', p: '/write' }); // no Origin, no token
    const acaoNoAuth = headerValues(noAuth.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-04a: a no-Origin state-changing request is still refused by the route auth (401), CORS grants no privilege',
      noAuth.status === 401,
      `status=${noAuth.status}`);

    const withAuth = await fire(port, { method: 'POST', p: '/write', headers: { Authorization: 'Bearer good-token' } });
    const acaoWith = headerValues(withAuth.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-04b: a no-Origin request with a valid token is served (200) — CORS is not the auth gate',
      withAuth.status === 200,
      `status=${withAuth.status} body=${withAuth.body.slice(0, 60)}`);
    check('CORS-SEC-04c: a no-Origin response carries no wildcard ACAO',
      acaoWith.length === 0 || !acaoWith.some(v => v.trim() === '*'),
      `acao=${JSON.stringify(acaoWith)}`);
  }

  // --- E. A wildcard never appears in any dev-mode answer ---
  {
    const r = await fire(port, { method: 'OPTIONS', p: '/write', origin: 'http://localhost:3001',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization' } });
    const acao = headerValues(r.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-05: an approved preflight never answers with * (incompatible with credentials)',
      acao.length === 1 && acao[0] !== '*' && acao[0] === 'http://localhost:3001',
      `acao=${JSON.stringify(acao)}`);
  }

  await close(server);

  // --- F. Production mode: exact prod origins only, no localhost, no wildcard ---
  console.log('\n--- CORS-SEC: Production-mode origin policy over real HTTP ---');
  const prodApp = await startApp({ production: true });
  {
    const p = prodApp.port;
    const prodOk = await fire(p, { method: 'GET', p: '/probe', origin: 'https://admin.nabin.in' });
    const prodAcao = headerValues(prodOk.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-06: in production an exact PROD origin is accepted',
      prodAcao.length === 1 && prodAcao[0] === 'https://admin.nabin.in',
      `acao=${JSON.stringify(prodAcao)}`);

    const localhostInProd = await fire(p, { method: 'GET', p: '/probe', origin: 'http://localhost:3000' });
    const lcAcao = headerValues(localhostInProd.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-07: in production a localhost dev origin is refused (prod list is not the dev list)',
      lcAcao.length === 0,
      `acao=${JSON.stringify(lcAcao)}`);

    const subInProd = await fire(p, { method: 'GET', p: '/probe', origin: 'https://evil.nabin.in' });
    const subAcao = headerValues(subInProd.rawHeaders, 'access-control-allow-origin');
    check('CORS-SEC-08: in production a *.nabin.in subdomain that is not exactly listed is refused',
      subAcao.length === 0,
      `acao=${JSON.stringify(subAcao)}`);
  }
  await close(prodApp.server);

  // --- G. Startup validation: bad production config fails loudly, never falls back to * ---
  console.log('\n--- CORS-SEC: Allowlist validation and fail-closed boot ---');
  {
    const throws = (fn) => { try { fn(); return false; } catch (e) { return true; } };
    check('CORS-SEC-09: assertValidOrigin refuses a wildcard origin',
      throws(() => assertValidOrigin('https://*.nabin.in', 'TEST')));
    check('CORS-SEC-10: assertValidOrigin refuses an origin with a path',
      throws(() => assertValidOrigin('https://admin.nabin.in/api', 'TEST')));
    check('CORS-SEC-11: assertValidOrigin refuses a schemeless host',
      throws(() => assertValidOrigin('admin.nabin.in', 'TEST')));
    check('CORS-SEC-12: buildAllowedOrigins in production yields the exact PROD set with no wildcard and no localhost',
      (() => {
        const set = buildAllowedOrigins({ production: true });
        return set.has('https://nabin.in') && !set.has('*')
          && [...set].every(o => PROD_ORIGINS.includes(o))
          && ![...set].some(o => o.includes('localhost') || o.includes('127.0.0.1'));
      })());
    check('CORS-SEC-13: no allowlist entry (dev or prod) is ever a wildcard or contains *',
      [...DEV_ORIGINS, ...PROD_ORIGINS].every(o => !o.includes('*')));
  }

  // --- H. The unsafe suffix rule is gone from the server source ---
  console.log('\n--- CORS-SEC: Source + Vercel configuration checks ---');
  {
    const serverSrc = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
    check('CORS-SEC-14: server.js no longer contains the unsafe endsWith(\'.nabin.in\') suffix rule',
      !/endsWith\(['"]\.nabin\.in['"]\)/.test(serverSrc),
      'suffix rule still present');

    const vercelFiles = ['../vercel.json', '../vercel.prod.json'];
    for (const rel of vercelFiles) {
      const file = path.join(__dirname, rel);
      let cfg;
      try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { check(`CORS-SEC-15 [${rel}]: parses as JSON`, false, e.message); continue; }
      const acacEntries = (cfg.headers || []).flatMap(h => (h.headers || [])
        .filter(x => String(x.key).toLowerCase() === 'access-control-allow-origin'));
      check(`CORS-SEC-15 [${rel}]: no wildcard Access-Control-Allow-Origin reintroduced for edge/proxied /api responses`,
        acacEntries.every(x => String(x.value).trim() !== '*') && !acacEntries.some(x => String(x.value).trim() === '*'),
        `acaos=${JSON.stringify(acacEntries.map(x => x.value))}`);
    }
  }

  console.log(`\nCORS security suite: ${passed} passed, ${failed} failed${failed ? ` — ${failures.join('; ')}` : ''}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch(err => {
  console.error('CORS security suite crashed:', err);
  process.exitCode = 1;
});
