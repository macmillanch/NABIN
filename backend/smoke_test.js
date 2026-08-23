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

async function ensureLocalServerRunning() {
  if (!baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1')) return;
  try {
    const res = await executeGet('/api/health');
    if (res.statusCode === 200) return;
  } catch (e) {}

  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  proc.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await executeGet('/api/health');
      if (res.statusCode === 200) return;
    } catch (e) {}
  }
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
    console.error(`\n🚨 Fatal connectivity error during smoke test: ${err.message}`);
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
