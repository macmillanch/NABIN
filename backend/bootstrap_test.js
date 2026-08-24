const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:4000';

function request(method, pathName, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('--- RUNNING ADMIN BOOTSTRAP SECURITY TESTS ---');

  // Spawn isolated test server instance
  // First, let's delete the mock db file if it exists so we start fresh
  const fs = require('fs');
  const dbPath = path.join(__dirname, 'data', 'store.json');
  if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);

  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    env: { ...process.env, PORT: 4000, ADMIN_BOOTSTRAP_SECRET: 'test-secret' },
    detached: true,
  });

  // wait for startup
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) break;
    } catch (e) {}
  }

  let failures = 0;
  const assert = (desc, cond) => {
    if (cond) {
      console.log(`✅ [PASS] ${desc}`);
    } else {
      console.error(`❌ [FAIL] ${desc}`);
      failures++;
    }
  };

  try {
    // We must reset the DB state by bootstrapping (or wiping if already bootstrapped).
    // Let's assume this starts a clean mock db if the JSON doesn't exist, OR it loads JSON.
    // If it loads JSON and an admin exists, bootstrap fails.
    
    // First, let's delete the mock db file if it exists so we start fresh
    // This was moved up before spawning the server.
    
    // Test 1: missing secret
    const res1 = await request('POST', '/api/admin/bootstrap', { username: 'admin1', password: 'Password123!' });
    assert('Missing bootstrap secret -> rejected (403)', res1.status === 403 && res1.data.error === 'Bootstrap failed or not available.');

    // Test 2: wrong secret
    const res2 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'wrong', username: 'admin1', password: 'Password123!' });
    assert('Wrong bootstrap secret -> rejected (403)', res2.status === 403 && res2.data.error === 'Bootstrap failed or not available.');

    // Test 3: Rate limiting kicks in (progressive lockout)
    // If we try the RIGHT secret immediately after the wrong one without waiting, it should still be locked out (penalty is > 2 seconds).
    const res3 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'test-secret', username: 'admin1', password: 'Password123!' });
    assert('Valid secret rejected due to active rate-limit lockout (403)', res3.status === 403 && res3.data.error === 'Bootstrap failed or not available.');

    // Let's reset the IP by using a proxy IP (actually, req.ip is hard to mock locally without X-Forwarded-For, but we can't easily set req.ip. So we must wait out the 2-second lockout or restart the server.)
    // We will just wait 2.1 seconds for the penalty to expire (count was 2, wait, res1 and res2 were bad secrets, so count=2. Penalty = 4000ms).
    console.log('Waiting 4.1 seconds for rate limit to expire...');
    await new Promise(r => setTimeout(r, 4100));

    // Test 4: weak password (after lockout expires)
    const res4 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'test-secret', username: 'admin1', password: '123' });
    assert('Weak password -> rejected (403)', res4.status === 403 && res4.data.error === 'Bootstrap failed or not available.');

    // Test 5: missing username
    const res5 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'test-secret', password: 'Password123!' });
    assert('Missing username -> rejected (403)', res5.status === 403 && res5.data.error === 'Bootstrap failed or not available.');

    // Test 6: Valid bootstrap
    const res6 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'test-secret', username: 'superadmin', password: 'AdminPassword123!' });
    if (!(res6.status === 200 && res6.data.success === true)) console.log('TEST 6 FAILING RESPONSE:', res6);
    assert('Valid bootstrap succeeds (200)', res6.status === 200 && res6.data.success === true);
    assert('Plaintext password is never exposed', !res6.data.password && !JSON.stringify(res6.data).includes('AdminPassword123!'));

    // Test 7: Verify login works with the new credentials
    const loginRes = await request('POST', '/api/admin/login', { username: 'superadmin', password: 'AdminPassword123!' });
    assert('Login with bootstrapped credentials succeeds', loginRes.status === 200 && loginRes.data.success);

    // Test 8: Bootstrap permanently disabled
    const res8 = await request('POST', '/api/admin/bootstrap', { bootstrapSecret: 'test-secret', username: 'hacker', password: 'Password123!' });
    assert('Bootstrap permanently disabled after first admin (403)', res8.status === 403 && res8.data.error === 'Bootstrap failed or not available.');

  } catch (err) {
    console.error('Unexpected error in test:', err);
    failures++;
  } finally {
    try { proc.kill(); } catch (e) {}
  }

  if (failures > 0) {
    console.error(`Total failures: ${failures}`);
    process.exit(1);
  }
}

runTests();
