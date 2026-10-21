const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { releasePrivatePort } = require('./scripts/port_release');
const { trackServer } = require('./scripts/spawned_server');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.NABIN_TEST_MODE = 'true';

const TEST_PORT = 4098;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function ensureServerRunning() {
  releasePrivatePort(TEST_PORT);
  await sleep(1500);

  const localEnv = Object.assign({}, process.env, {
    PORT: String(TEST_PORT),
    NABIN_ENV: 'development',
    NABIN_SUPABASE_REF: '',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjE0NzQ4MzY0N30.zgkIIaTYIuVOAP7uQbSJgypYnfr0kFzw83NdTkC5JCM',
    DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    SUPABASE_POSTGRES_LIVE: 'true',
  });

  const proc = trackServer(
    spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname,
      env: localEnv,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    })
  );
  proc.unref();

  const bootFrom = Date.now();
  for (;;) {
    await sleep(500);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) {
        console.log(`Backend online on port ${TEST_PORT} after ${Date.now() - bootFrom}ms`);
        return proc;
      }
    } catch {}
    if (Date.now() - bootFrom > 60000) {
      throw new Error(`Backend never answered /api/health on port ${TEST_PORT} within 60s`);
    }
  }
}

async function run() {
  console.log('--- Testing Unified Merchant Portal Registration & Entitlements ---');
  await ensureServerRunning();

  const ts = Date.now().toString().slice(-4);

  // 1. Register Restaurant-only
  const restPhone = `9810${ts}01`;
  console.log(`1. Testing Restaurant registration (${restPhone})…`);
  const regRest = await request('POST', '/api/merchant/register', {
    name: `Test Diner ${ts}`,
    phone: restPhone,
    address: 'Bawngkawn, Aizawl',
    businessType: 'RESTAURANT',
    fssaiLicense: '12345678901234',
  });
  if (regRest.status !== 201) {
    console.error('Registration failed with error:', regRest.data);
  }
  assert.strictEqual(regRest.status, 201, `Expected 201, got ${regRest.status}`);
  assert.strictEqual(regRest.data.success, true);
  assert.strictEqual(regRest.data.merchant.merchantType, 'RESTAURANT');
  console.log('✅ Restaurant registered successfully');

  // 2. Register Grocery-only
  const grocPhone = `9810${ts}02`;
  console.log(`2. Testing Grocery registration (${grocPhone})…`);
  const regGroc = await request('POST', '/api/merchant/register', {
    name: `Test Mart ${ts}`,
    phone: grocPhone,
    address: 'Zarkawt, Aizawl',
    businessType: 'GROCERY',
  });
  assert.strictEqual(regGroc.status, 201);
  assert.strictEqual(regGroc.data.merchant.merchantType, 'GROCERY');
  console.log('✅ Grocery registered successfully');

  // 3. Register Both (Hybrid)
  const bothPhone = `9810${ts}03`;
  console.log(`3. Testing Hybrid Both registration (${bothPhone})…`);
  const regBoth = await request('POST', '/api/merchant/register', {
    name: `Test Superstore & Kitchen ${ts}`,
    phone: bothPhone,
    address: 'Khatla, Aizawl',
    businessType: 'BOTH',
  });
  assert.strictEqual(regBoth.status, 201);
  assert.strictEqual(regBoth.data.merchant.merchantType, 'HYBRID_BOTH');
  console.log('✅ Hybrid Both registered successfully');

  // 4. Duplicate phone rejection
  console.log('4. Testing duplicate phone rejection…');
  const dupReg = await request('POST', '/api/merchant/register', {
    name: 'Duplicate Store',
    phone: restPhone,
    address: 'Khatla, Aizawl',
    businessType: 'RESTAURANT',
  });
  assert.strictEqual(dupReg.status, 409);
  assert.strictEqual(dupReg.data.code, 'MERCHANT_ALREADY_REGISTERED');
  console.log('✅ Duplicate phone rejected with 409');

  // 5. Invalid business type rejection
  console.log('5. Testing invalid business type rejection…');
  const badType = await request('POST', '/api/merchant/register', {
    name: 'Bad Type Store',
    phone: `9810${ts}99`,
    address: 'Khatla, Aizawl',
    businessType: 'AIRLINE',
  });
  assert.strictEqual(badType.status, 400);
  assert.strictEqual(badType.data.code, 'INVALID_BUSINESS_TYPE');
  console.log('✅ Invalid business type rejected with 400');

  // 6. Login and Services Entitlements for Restaurant
  console.log('6. Verifying Restaurant login and service entitlements…');
  const otpRes1 = await request('POST', '/api/auth/send-otp', { phone: restPhone, role: 'MERCHANT' });
  const verify1 = await request('POST', '/api/auth/verify-otp', {
    phone: restPhone,
    otp: otpRes1.data.testOtp || '7729',
    role: 'MERCHANT',
  });
  if (verify1.status !== 200) {
    console.error('Verify failed with data:', verify1.data);
  }
  assert.strictEqual(verify1.status, 200);
  const restToken = verify1.data.token;

  const srv1 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${restToken}` });
  assert.strictEqual(srv1.status, 200);
  assert.deepStrictEqual(srv1.data.services, ['RESTAURANT']);
  assert.strictEqual(srv1.data.needsServiceSelector, false);
  console.log('✅ Restaurant has services: ["RESTAURANT"], needsServiceSelector: false');

  // 7. Login and Services Entitlements for Grocery
  console.log('7. Verifying Grocery login and service entitlements…');
  const otpRes2 = await request('POST', '/api/auth/send-otp', { phone: grocPhone, role: 'MERCHANT' });
  const verify2 = await request('POST', '/api/auth/verify-otp', {
    phone: grocPhone,
    otp: otpRes2.data.testOtp || '7729',
    role: 'MERCHANT',
  });
  assert.strictEqual(verify2.status, 200);
  const grocToken = verify2.data.token;

  const srv2 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${grocToken}` });
  assert.strictEqual(srv2.status, 200);
  assert.deepStrictEqual(srv2.data.services, ['INSTAMART']);
  assert.strictEqual(srv2.data.needsServiceSelector, false);
  console.log('✅ Grocery has services: ["INSTAMART"], needsServiceSelector: false');

  // 8. Login and Services Entitlements for Both (Hybrid)
  console.log('8. Verifying Hybrid Both login and service entitlements…');
  const otpRes3 = await request('POST', '/api/auth/send-otp', { phone: bothPhone, role: 'MERCHANT' });
  const verify3 = await request('POST', '/api/auth/verify-otp', {
    phone: bothPhone,
    otp: otpRes3.data.testOtp || '7729',
    role: 'MERCHANT',
  });
  assert.strictEqual(verify3.status, 200);
  const bothToken = verify3.data.token;

  const srv3 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${bothToken}` });
  assert.strictEqual(srv3.status, 200);
  assert.deepStrictEqual(srv3.data.services, ['RESTAURANT', 'INSTAMART']);
  assert.strictEqual(srv3.data.needsServiceSelector, true);
  console.log('✅ Hybrid Both has services: ["RESTAURANT", "INSTAMART"], needsServiceSelector: true');

  // 9. Authorization Enforcement: Cross-service isolation
  console.log('9. Verifying Cross-Service isolation guards…');
  // Restaurant cannot call grocery inventory
  const restInv = await request('GET', '/api/merchant/inventory', null, { Authorization: `Bearer ${restToken}` });
  assert.strictEqual(restInv.status, 403);
  assert.strictEqual(restInv.data.code, 'MERCHANT_TYPE_MISMATCH');
  console.log('✅ Restaurant calling /api/merchant/inventory correctly refused 403 MERCHANT_TYPE_MISMATCH');

  // Hybrid CAN call grocery inventory
  const bothInv = await request('GET', '/api/merchant/inventory', null, { Authorization: `Bearer ${bothToken}` });
  assert.strictEqual(bothInv.status, 200);
  console.log('✅ Hybrid Both calling /api/merchant/inventory allowed 200 OK');

  console.log('\n🎉 ALL UNIFIED MERCHANT PORTAL CONTRACTS VERIFIED AND PASSING!\n');
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
}).finally(() => {
  releasePrivatePort(TEST_PORT);
});
