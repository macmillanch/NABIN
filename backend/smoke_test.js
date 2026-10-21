/**
 * NABIN — Production-Safe Read-Only Smoke Test Suite
 * 
 * Verifies live endpoint responsiveness, service registry, feature flags,
 * and database readiness without modifying state or creating dummy records.
 */

const http = require('http');
const https = require('https');

const targetUrl = process.env.API_URL || process.env.BASE_URL || process.argv[2] || 'http://localhost:4000';
const baseUrl = targetUrl.replace(/\/+$/, '');

console.log(`========================================================================`);
console.log(`🔍 RUNNING NABIN SMOKE TEST SUITE`);
console.log(`🎯 Target API: ${baseUrl}`);
console.log(`========================================================================\n`);

function executeGet(endpointPath) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${baseUrl}${endpointPath}`;
    const client = fullUrl.startsWith('https:') ? https : http;

    const req = client.get(fullUrl, { timeout: 10000 }, (res) => {
      let rawData = '';
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(rawData);
        } catch (e) {
          parsed = rawData;
        }
        resolve({ statusCode: res.statusCode, data: parsed, headers: res.headers });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${endpointPath} timed out after 10000ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

// A refused connection is not always a message: Node reports a dual-stack (IPv4 + IPv6) connect failure
// as an AggregateError whose own `message` is empty and carries the cause in `errors[]`, so the plain
// `${err.message}` this file used to print rendered as a blank line and the real reason was lost.
function describeError(err) {
  if (!err) return String(err);
  const parts = [err.message, err.code];
  for (const inner of (Array.isArray(err.errors) ? err.errors : [])) {
    parts.push(inner && (inner.code || inner.message));
  }
  const readable = parts.filter(Boolean).join(' / ');
  return readable || String(err);
}

let passedCount = 0;
let failedCount = 0;

function assertCheck(description, condition, details = '') {
  if (condition) {
    console.log(`✅ [PASS] ${description}`);
    passedCount++;
  } else {
    console.error(`❌ [FAIL] ${description} ${details ? `-> ${details}` : ''}`);
    failedCount++;
  }
}

const { spawn } = require('child_process');
const path = require('path');
// Reap the backend this run starts, and only that one — scripts/spawned_server.js.
const { trackServer } = require('./scripts/spawned_server');

async function ensureLocalServerRunning() {
  if (!baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) return;
  try {
    const res = await executeGet('/api/health');
    if (res.statusCode === 200) return;
  } catch (e) {}

  // F-13: a backend that boots with the default session-reconcile tick DELETEs expired rows from the
  // shared public.backend_sessions table 15 s after start-up (`reconcileSessions({ prune: true })`, whose
  // first statement is a `delete ... .lte('expires_at', nowIso)`). A smoke run is a read, so the process
  // it starts must not write: every suite that boots this backend passes these two switches (see
  // scripts/spawned_server.js), and this harness now does the same. Measured before this line existed:
  // three smoke runs took public.backend_sessions from 7209 to 7178.
  //
  // PORT comes from the target this run was pointed at, because the harness probes baseUrl — without it
  // an API_URL on another port would start a server on the default one and then report that the address
  // it chose never came up.
  const childEnv = Object.assign({}, process.env, {
    NABIN_SESSION_PRUNE: 'off',
    NABIN_SESSION_RECONCILE_MS: '0'
  });
  const portFromBaseUrl = baseUrl.match(/:(\d+)(?:\/|$)/);
  if (portFromBaseUrl) childEnv.PORT = portFromBaseUrl[1];

  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: childEnv
  }));
  proc.unref();

  // A cold boot does not listen until the authoritative PostgreSQL mirror synchronisation has finished:
  // measured at 6.8 s against the local Docker store on this machine, and the suites that boot this
  // backend themselves allow 90 s for it (services_status_fabrication_test.js:542). The 30 × 200 ms wait
  // this function used to have expired while the server it had just started was still booting, then
  // returned as though nothing was wrong — so the next request failed and the run reported a "Fatal
  // connectivity error" that was really its own backend not being up yet.
  const bootDeadlineMs = 90000;
  const bootStartedAt = Date.now();
  let childExit = null;
  proc.on('exit', (code, signal) => { childExit = { code, signal }; });

  const deadline = bootStartedAt + bootDeadlineMs;
  let lastFailure = 'no health probe attempted';
  while (Date.now() < deadline && !childExit) {
    try {
      const res = await executeGet('/api/health');
      if (res.statusCode === 200) return;
      lastFailure = `HTTP ${res.statusCode}`;
    } catch (e) {
      lastFailure = describeError(e);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  const cause = childExit
    ? `it exited (code=${childExit.code} signal=${childExit.signal}) ${Date.now() - bootStartedAt}ms after this run started it`
    : `stopped answering after ${lastFailure}`;
  throw new Error(
    `Backend this run started (pid ${proc.pid}, ${baseUrl}) never became ready — ${cause}. ` +
    `Its stdout/stderr is discarded by this harness (stdio: 'ignore'), so run ` +
    `node src/server.js by hand for the boot log.`
  );
}

async function runSmokeTests() {
  try {
    await ensureLocalServerRunning();
    // 0. Root API Discovery Probe
    const rootRes = await executeGet('/');
    assertCheck(
      'GET / returns HTTP 200 with ONLINE API discovery JSON',
      rootRes.statusCode === 200 && rootRes.data?.status === 'ONLINE',
      `Got status ${rootRes.statusCode}, body: ${JSON.stringify(rootRes.data)}`
    );

    // 1. Health Probe
    const healthRes = await executeGet('/api/health');
    assertCheck(
      'GET /api/health returns HTTP 200 with ONLINE status',
      healthRes.statusCode === 200 && healthRes.data?.status === 'ONLINE',
      `Got status ${healthRes.statusCode}, body: ${JSON.stringify(healthRes.data)}`
    );

    // 2. Readiness Probe
    const readyRes = await executeGet('/api/ready');
    assertCheck(
      'GET /api/ready returns HTTP 200 with operational readiness',
      readyRes.statusCode === 200 && readyRes.data?.ready === true,
      `Got status ${readyRes.statusCode}, body: ${JSON.stringify(readyRes.data)}`
    );

    // 3. Platform Services Switchboard Status
    const servicesRes = await executeGet('/api/services/status');
    assertCheck(
      'GET /api/services/status returns HTTP 200 and valid service states',
      servicesRes.statusCode === 200 && servicesRes.data?.success === true && Array.isArray(servicesRes.data?.services),
      `Got status ${servicesRes.statusCode}`
    );

    // 4. Feature Flags Configuration
    const featuresRes = await executeGet('/api/v1/features');
    assertCheck(
      'GET /api/v1/features returns HTTP 200 with feature flag definitions',
      featuresRes.statusCode === 200 && (featuresRes.data?.success === true || typeof featuresRes.data === 'object'),
      `Got status ${featuresRes.statusCode}`
    );

  } catch (err) {
    console.error(`\n🚨 Fatal connectivity error during smoke test: ${describeError(err)}`);
    failedCount++;
  }

  console.log(`\n========================================================================`);
  console.log(`📊 SMOKE TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log(`========================================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSmokeTests();
