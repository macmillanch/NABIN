/**
 * NABIN - Durable Merchant Persistence & Authorization Test
 *
 * Exercises real PostgreSQL database operations:
 *   1. Clean prior test fixtures in PostgreSQL
 *   2. Boot backend connected to local Docker PostgreSQL (127.0.0.1:54322 / 54321)
 *   3. Register RESTAURANT merchant via API -> verify persistent row in PostgreSQL
 *   4. Register GROCERY merchant via API -> verify persistent row in PostgreSQL
 *   5. Register HYBRID_BOTH merchant via API -> verify persistent row in PostgreSQL
 *   6. Independent direct PostgreSQL read verification (pg.Client)
 *   7. Rejection of duplicate phone registration (409 Conflict)
 *   8. Rejection of invalid business type (400 Bad Request)
 *   9. Login & OTP challenge for persistent merchants
 *  10. Server-authorized capabilities (/api/merchant/services)
 *  11. Cross-service tenant isolation (refuse restaurant on grocery inventory)
 *  12. Process restart survival: stop backend, restart fresh instance, verify login & entitlements
 */

const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { releasePrivatePort } = require('./scripts/port_release');
const { trackServer } = require('./scripts/spawned_server');

const TEST_PORT = 4198;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;
const PG_CONN = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const TEST_PHONES = {
  RESTAURANT: '9810293601',
  GROCERY: '9810293602',
  HYBRID_BOTH: '9810293603'
};

const TEST_E164 = {
  RESTAURANT: '+919810293601',
  GROCERY: '+919810293602',
  HYBRID_BOTH: '+919810293603'
};

const LOCAL_ENV = Object.assign({}, process.env, {
  PORT: String(TEST_PORT),
  NABIN_ENV: 'development',
  NABIN_SUPABASE_REF: '',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MjE0NzQ4MzY0N30.zgkIIaTYIuVOAP7uQbSJgypYnfr0kFzw83NdTkC5JCM',
  DATABASE_URL: PG_CONN,
  SUPABASE_POSTGRES_LIVE: 'true',
  NABIN_TEST_MODE: 'true',
});

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
          resolve({ status: res.statusCode, body: parsed });
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

  const proc = trackServer(
    spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
      cwd: __dirname,
      env: LOCAL_ENV,
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
    if (Date.now() - bootFrom > 30000) {
      throw new Error(`Backend never answered /api/health on port ${TEST_PORT} within 30s`);
    }
  }
}

async function cleanTestFixtures() {
  const client = new Client({ connectionString: PG_CONN });
  await client.connect();
  for (const phone of Object.values(TEST_E164)) {
    await client.query('DELETE FROM merchants WHERE phone = $1', [phone]);
  }
  for (const phone of Object.values(TEST_PHONES)) {
    await client.query('DELETE FROM merchants WHERE phone = $1', [phone]);
  }
  await client.end();
}

async function loginMerchant(phone) {
  const sendRes = await request('POST', '/api/auth/send-otp', {
    phone,
    role: 'MERCHANT',
    purpose: 'LOGIN'
  });
  if (sendRes.status !== 200) {
    throw new Error(`send-otp failed for ${phone}: ${JSON.stringify(sendRes.body)}`);
  }
  const testOtp = sendRes.body.testOtp || '7729';

  const verifyRes = await request('POST', '/api/auth/verify-otp', {
    phone,
    otp: testOtp,
    role: 'MERCHANT'
  });
  if (verifyRes.status !== 200) {
    throw new Error(`verify-otp failed for ${phone}: ${JSON.stringify(verifyRes.body)}`);
  }

  return verifyRes.body.token || (verifyRes.body.session && verifyRes.body.session.token);
}

async function run() {
  console.log('=== NABIN DURABLE MERCHANT PERSISTENCE & AUTHORIZATION TEST ===');

  console.log('\n[Phase 0] Cleaning test fixtures in PostgreSQL...');
  await cleanTestFixtures();
  console.log('✅ Cleaned prior test records');

  console.log('\n[Phase 1] Starting backend on port ' + TEST_PORT + '...');
  await ensureServerRunning();

  const pgClient = new Client({ connectionString: PG_CONN });
  await pgClient.connect();

  try {
    // 1. RESTAURANT REGISTRATION
    console.log('\n[Phase 2] Registering RESTAURANT merchant (' + TEST_PHONES.RESTAURANT + ')...');
    const reg1 = await request('POST', '/api/merchant/register', {
      name: 'Durable Taste Kitchen',
      phone: TEST_PHONES.RESTAURANT,
      address: '101 MG Road, Aizawl, Mizoram',
      businessType: 'RESTAURANT',
      fssaiLicense: '11223344556677'
    });
    if (reg1.status !== 201) throw new Error('Restaurant registration failed: ' + JSON.stringify(reg1.body));
    console.log('✅ Restaurant registered via API: HTTP 201');

    // Verify row in PostgreSQL
    const pgRow1 = await pgClient.query('SELECT id, name, merchant_type, phone, address, fssai_license FROM merchants WHERE phone = $1', [TEST_E164.RESTAURANT]);
    if (pgRow1.rows.length === 0) throw new Error('PostgreSQL verification failed: Restaurant row not found in merchants table!');
    if (pgRow1.rows[0].merchant_type !== 'RESTAURANT') throw new Error('PostgreSQL merchant_type mismatch: expected RESTAURANT, got ' + pgRow1.rows[0].merchant_type);
    console.log('✅ Persistent row verified in PostgreSQL:', pgRow1.rows[0]);

    // 2. GROCERY REGISTRATION
    console.log('\n[Phase 3] Registering GROCERY merchant (' + TEST_PHONES.GROCERY + ')...');
    const reg2 = await request('POST', '/api/merchant/register', {
      name: 'Durable Super Mart',
      phone: TEST_PHONES.GROCERY,
      address: '202 Zarkawt Main, Aizawl, Mizoram',
      businessType: 'GROCERY',
      fssaiLicense: '22334455667788'
    });
    if (reg2.status !== 201) throw new Error('Grocery registration failed: ' + JSON.stringify(reg2.body));
    console.log('✅ Grocery registered via API: HTTP 201');

    const pgRow2 = await pgClient.query('SELECT id, name, merchant_type, phone, address FROM merchants WHERE phone = $1', [TEST_E164.GROCERY]);
    if (pgRow2.rows.length === 0) throw new Error('PostgreSQL verification failed: Grocery row not found in merchants table!');
    if (pgRow2.rows[0].merchant_type !== 'GROCERY') throw new Error('PostgreSQL merchant_type mismatch: expected GROCERY, got ' + pgRow2.rows[0].merchant_type);
    console.log('✅ Persistent row verified in PostgreSQL:', pgRow2.rows[0]);

    // 3. HYBRID_BOTH REGISTRATION
    console.log('\n[Phase 4] Registering HYBRID_BOTH merchant (' + TEST_PHONES.HYBRID_BOTH + ')...');
    const reg3 = await request('POST', '/api/merchant/register', {
      name: 'Durable Food & Grocery Hub',
      phone: TEST_PHONES.HYBRID_BOTH,
      address: '303 Chanmari Plaza, Aizawl, Mizoram',
      businessType: 'BOTH',
      fssaiLicense: '33445566778899'
    });
    if (reg3.status !== 201) throw new Error('Hybrid Both registration failed: ' + JSON.stringify(reg3.body));
    console.log('✅ Hybrid Both registered via API: HTTP 201');

    const pgRow3 = await pgClient.query('SELECT id, name, merchant_type, phone, address FROM merchants WHERE phone = $1', [TEST_E164.HYBRID_BOTH]);
    if (pgRow3.rows.length === 0) throw new Error('PostgreSQL verification failed: Hybrid row not found in merchants table!');
    if (pgRow3.rows[0].merchant_type !== 'HYBRID_BOTH') throw new Error('PostgreSQL merchant_type mismatch: expected HYBRID_BOTH, got ' + pgRow3.rows[0].merchant_type);
    console.log('✅ Persistent row verified in PostgreSQL:', pgRow3.rows[0]);

    // 4. DUPLICATE PHONE REJECTION
    console.log('\n[Phase 5] Testing duplicate phone registration rejection...');
    const dupRes = await request('POST', '/api/merchant/register', {
      name: 'Duplicate Attempt',
      phone: TEST_PHONES.RESTAURANT,
      address: 'Somewhere Else',
      businessType: 'RESTAURANT'
    });
    if (dupRes.status !== 409) throw new Error('Expected HTTP 409 for duplicate phone, got: ' + dupRes.status);
    console.log('✅ Duplicate phone rejected with HTTP 409');

    // 5. INVALID BUSINESS TYPE REJECTION
    console.log('\n[Phase 6] Testing invalid business type rejection...');
    const invRes = await request('POST', '/api/merchant/register', {
      name: 'Invalid Type Store',
      phone: '9810293699',
      address: 'Nowhere',
      businessType: 'HARDWARE'
    });
    if (invRes.status !== 400) throw new Error('Expected HTTP 400 for invalid business type, got: ' + invRes.status);
    console.log('✅ Invalid business type rejected with HTTP 400');

    // 6. LOGIN & AUTHORIZATION BEFORE RESTART
    console.log('\n[Phase 7] Testing login and service entitlements...');
    const restToken = await loginMerchant(TEST_PHONES.RESTAURANT);
    const srv1 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${restToken}` });
    if (!srv1.body.services || !srv1.body.services.includes('RESTAURANT') || srv1.body.services.includes('INSTAMART')) {
      throw new Error('Restaurant entitlement mismatch: ' + JSON.stringify(srv1.body));
    }
    if (srv1.body.needsServiceSelector !== false) throw new Error('Restaurant should not need selector');
    console.log('✅ Restaurant granted:', srv1.body.services);

    const grocToken = await loginMerchant(TEST_PHONES.GROCERY);
    const srv2 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${grocToken}` });
    if (!srv2.body.services || !srv2.body.services.includes('INSTAMART') || srv2.body.services.includes('RESTAURANT')) {
      throw new Error('Grocery entitlement mismatch: ' + JSON.stringify(srv2.body));
    }
    if (srv2.body.needsServiceSelector !== false) throw new Error('Grocery should not need selector');
    console.log('✅ Grocery granted:', srv2.body.services);

    const bothToken = await loginMerchant(TEST_PHONES.HYBRID_BOTH);
    const srv3 = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${bothToken}` });
    if (!srv3.body.services || !srv3.body.services.includes('RESTAURANT') || !srv3.body.services.includes('INSTAMART')) {
      throw new Error('Hybrid Both entitlement mismatch: ' + JSON.stringify(srv3.body));
    }
    if (srv3.body.needsServiceSelector !== true) throw new Error('Hybrid Both must require service selector');
    console.log('✅ Hybrid Both granted:', srv3.body.services, '(selector: true)');

    // 7. CROSS-SERVICE TENANT ISOLATION
    console.log('\n[Phase 8] Testing cross-service isolation guards...');
    const invRest = await request('GET', '/api/merchant/inventory', null, { Authorization: `Bearer ${restToken}` });
    if (invRest.status !== 403 || invRest.body.code !== 'MERCHANT_TYPE_MISMATCH') {
      throw new Error('Restaurant should be refused grocery inventory with 403 MERCHANT_TYPE_MISMATCH: got ' + invRest.status);
    }
    console.log('✅ Restaurant blocked from grocery inventory: HTTP 403 MERCHANT_TYPE_MISMATCH');

    const invBoth = await request('GET', '/api/merchant/inventory', null, { Authorization: `Bearer ${bothToken}` });
    if (invBoth.status !== 200) {
      throw new Error('Hybrid Both should have access to grocery inventory: got ' + invBoth.status);
    }
    console.log('✅ Hybrid Both allowed on grocery inventory: HTTP 200 OK');

    // 8. PROCESS RESTART SURVIVAL TEST
    console.log('\n[Phase 9] Testing process restart survival...');
    console.log('Stopping backend process and proving persistent rows survive...');
    releasePrivatePort(TEST_PORT);
    await sleep(2000);

    console.log('Starting fresh backend instance on port ' + TEST_PORT + '...');
    await ensureServerRunning();

    // Log in afresh to prove rows exist in PostgreSQL and are queried by new process
    console.log('Testing fresh login for Hybrid Both after server restart...');
    const restartToken = await loginMerchant(TEST_PHONES.HYBRID_BOTH);
    const srvRestart = await request('GET', '/api/merchant/services', null, { Authorization: `Bearer ${restartToken}` });
    if (!srvRestart.body.services || !srvRestart.body.services.includes('RESTAURANT') || !srvRestart.body.services.includes('INSTAMART')) {
      throw new Error('Post-restart entitlement mismatch: ' + JSON.stringify(srvRestart.body));
    }
    console.log('✅ Post-restart login succeeded and server-authorized capabilities confirmed from PostgreSQL:', srvRestart.body.services);

    console.log('\n🎉 ALL DURABLE PERSISTENCE & AUTHORIZATION CONTRACTS VERIFIED AGAINST LIVE POSTGRESQL!');

  } finally {
    await pgClient.end();
    console.log('\nCleaning test fixtures in PostgreSQL...');
    await cleanTestFixtures();
    releasePrivatePort(TEST_PORT);
  }
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  releasePrivatePort(TEST_PORT);
  process.exit(1);
});
