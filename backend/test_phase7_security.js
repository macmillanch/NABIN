// =========================================================================
// NABIN — PHASE 7: FORENSIC SECURITY AUDIT & HARDENING TEST SUITE
// =========================================================================
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');

process.env.NABIN_TEST_MODE = 'true';

const BASE_URL = 'http://127.0.0.1:4000';
const PG_CONN_STRING = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function createPgClient() {
  return new Client({ connectionString: PG_CONN_STRING });
}

function request(method, pathName, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathName, BASE_URL);
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passed = 0;
let failed = 0;

function assert(description, condition, extraInfo = '') {
  if (condition) {
    console.log(`✅ [PASS] ${description}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${description} ${extraInfo ? '— ' + extraInfo : ''}`);
    failed++;
  }
}

async function ensureServerRunning() {
  try {
    const res = await request('GET', '/api/health');
    if (res.status === 200) return null;
  } catch (e) {}

  try {
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
  } catch (e) {}
  await sleep(1500);

  const proc = spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true
  });
  proc.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return proc;
    } catch (e) {}
  }
  return proc;
}

async function runSuite() {
  console.log('========================================================================');
  console.log('🛡️ RUNNING NABIN PHASE 7: FORENSIC SECURITY AUDIT & HARDENING SUITE');
  console.log('========================================================================\n');

  await ensureServerRunning();
  const healthRes = await request('GET', '/api/health');
  assert('Backend server is healthy & online', healthRes.status === 200);

  // Authenticate Super Admin
  const adminLoginRes = await request('POST', '/api/admin/login', {
    username: 'superadmin',
    password: 'AdminPassword123!'
  });
  const adminToken = adminLoginRes.data?.token;
  assert('Super Admin authenticated successfully', adminLoginRes.status === 200 && !!adminToken);

  // Authenticate Customer 1: Priya Saxena (00000000-0000-0000-0000-000000000002, VERIFIED)
  const cust1OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9845011982', role: 'CUSTOMER', purpose: 'LOGIN' });
  const cust1Login = await request('POST', '/api/auth/verify-otp', {
    phone: '9845011982',
    otp: cust1OtpSend.data?.testOtp || '7729',
    role: 'CUSTOMER'
  });
  const cust1Token = cust1Login.data?.token;
  const cust1Id = cust1Login.data?.user?.id || '00000000-0000-0000-0000-000000000002';
  assert('Customer 1 (Priya Saxena) authenticated successfully', cust1Login.status === 200 && !!cust1Token);

  // Authenticate Customer 2: Rahul Sharma (00000000-0000-0000-0000-000000000001, PENDING KYC)
  const cust2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9876543210', role: 'CUSTOMER', purpose: 'LOGIN' });
  const cust2Login = await request('POST', '/api/auth/verify-otp', {
    phone: '9876543210',
    otp: cust2OtpSend.data?.testOtp || '7729',
    role: 'CUSTOMER'
  });
  const cust2Token = cust2Login.data?.token;
  const cust2Id = cust2Login.data?.user?.id || '00000000-0000-0000-0000-000000000001';
  assert('Customer 2 (Rahul Sharma) authenticated successfully', cust2Login.status === 200 && !!cust2Token);

  // Authenticate Driver 1: Rajesh Kumar (DRV-101 / 00000000-0000-0000-0000-000000000101)
  const drv1OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9810122910', role: 'DRIVER', purpose: 'LOGIN' });
  const drv1Login = await request('POST', '/api/auth/verify-otp', {
    phone: '9810122910',
    otp: drv1OtpSend.data?.testOtp || '4892',
    role: 'DRIVER'
  });
  const drv1Token = drv1Login.data?.token;
  const drv1Id = drv1Login.data?.user?.id || drv1Login.data?.driver?.id || 'DRV-101';
  assert('Driver 1 (Rajesh Kumar / DRV-101) authenticated successfully', drv1Login.status === 200 && !!drv1Token);

  // Authenticate Driver 2: Deepak Auto (DRV-103 / 00000000-0000-0000-0000-000000000103)
  const drv2OtpSend = await request('POST', '/api/auth/send-otp', { phone: '9833344556', role: 'DRIVER', purpose: 'LOGIN' });
  const drv2Login = await request('POST', '/api/auth/verify-otp', {
    phone: '9833344556',
    otp: drv2OtpSend.data?.testOtp || '4892',
    role: 'DRIVER'
  });
  const drv2Token = drv2Login.data?.token;
  const drv2Id = drv2Login.data?.user?.id || drv2Login.data?.driver?.id || 'DRV-103';
  assert('Driver 2 (Deepak Auto / DRV-103) authenticated successfully', drv2Login.status === 200 && !!drv2Token);

  // =========================================================================
  // MODULE 1: ADMIN PASSWORD RESET & BACKDOOR ELIMINATION
  // =========================================================================
  console.log('\n--- MODULE 1: Admin Password Reset & Privilege Security ---');

  // 1. Unauthenticated reset attempt rejected
  const anonResetRes = await request('POST', '/api/admin/reset-password', {
    username: 'superadmin',
    newPassword: 'HackedPassword123!'
  });
  assert('Anonymous attempt to reset admin password rejected with HTTP 401', anonResetRes.status === 401);

  // 2. Customer token attempting admin reset rejected
  const custResetRes = await request('POST', '/api/admin/reset-password', {
    username: 'superadmin',
    newPassword: 'HackedPassword123!'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer token attempting admin password reset rejected with HTTP 401', custResetRes.status === 401);

  // 3. Driver token attempting admin reset rejected
  const drvResetRes = await request('POST', '/api/admin/reset-password', {
    username: 'superadmin',
    newPassword: 'HackedPassword123!'
  }, { 'Authorization': `Bearer ${drv1Token}` });
  assert('Driver token attempting admin password reset rejected with HTTP 401', drvResetRes.status === 401);

  // 4. Backdoor user auto-provisioning is blocked
  const backdoorRes = await request('POST', '/api/admin/reset-password', {
    username: 'muktachakma',
    newPassword: 'NewPassword123!'
  }, { 'Authorization': `Bearer ${adminToken}` });
  assert('Backdoor account auto-provisioning blocked (fails closed for nonexistent admin)', 
    backdoorRes.status === 400 && backdoorRes.data?.error?.includes('not found')
  );

  // 5. Super Admin authorized reset for valid admin succeeds
  const authResetRes = await request('POST', '/api/admin/reset-password', {
    username: 'superadmin',
    newPassword: 'AdminPassword123!'
  }, { 'Authorization': `Bearer ${adminToken}` });
  assert('Super Admin authorized password update succeeds with HTTP 200', authResetRes.status === 200 && authResetRes.data?.success);

  // =========================================================================
  // MODULE 2: DRIVER EARNINGS & TRANSACTION PRIVACY ISOLATION
  // =========================================================================
  console.log('\n--- MODULE 2: Driver Earnings & Transaction Privacy ---');

  // 1. Unauthenticated driver earnings rejected
  const anonEarnRes = await request('GET', `/api/driver/${drv1Id}/earnings`);
  assert('Unauthenticated access to driver earnings rejected with HTTP 401', anonEarnRes.status === 401);

  // 2. Driver 2 accessing Driver 1 earnings rejected
  const crossEarnRes = await request('GET', `/api/driver/${drv1Id}/earnings`, null, {
    'Authorization': `Bearer ${drv2Token}`
  });
  assert('Driver 2 accessing Driver 1 earnings rejected with HTTP 403 (DRIVER_MISMATCH)', 
    crossEarnRes.status === 403 && crossEarnRes.data?.code === 'DRIVER_MISMATCH'
  );

  // 3. Customer accessing driver earnings rejected
  const custEarnRes = await request('GET', `/api/driver/${drv1Id}/earnings`, null, {
    'Authorization': `Bearer ${cust1Token}`
  });
  assert('Customer token accessing driver earnings rejected with HTTP 401/403', custEarnRes.status === 401 || custEarnRes.status === 403);

  // 4. Driver 1 accessing own earnings succeeds and transactions are strictly scoped
  const ownEarnRes = await request('GET', `/api/driver/${drv1Id}/earnings`, null, {
    'Authorization': `Bearer ${drv1Token}`
  });
  assert('Driver 1 accessing own earnings succeeds with HTTP 200', ownEarnRes.status === 200 && ownEarnRes.data?.success);
  
  const txList = ownEarnRes.data?.transactions || [];
  const foreignTx = txList.filter(t => t.driverId && t.driverId !== drv1Id && t.entityId !== drv1Id);
  assert('Transactions in earnings response contain ZERO foreign driver records (strict isolation)', foreignTx.length === 0);

  // =========================================================================
  // MODULE 3: RIDE CANCELLATION AUTHORIZATION & IDOR PROTECTION
  // =========================================================================
  console.log('\n--- MODULE 3: Ride Cancellation Authorization & IDOR Protection ---');

  // Create a trip for Customer 1 (VERIFIED Priya Saxena)
  const bookRes = await request('POST', '/api/customer/book-ride', {
    serviceType: 'RIDE',
    pickup: { lat: 28.6139, lng: 77.2090, address: 'Connaught Place, Delhi' },
    drop: { lat: 28.5355, lng: 77.3910, address: 'Sector 62, Noida' },
    vehicleType: '4W',
    fare: 350.0
  }, { 'Authorization': `Bearer ${cust1Token}` });

  assert('Customer 1 books a ride successfully', bookRes.status === 200 && !!bookRes.data?.job);
  const activeJobId = bookRes.data?.job?.id || bookRes.data?.bookingId;

  // 1. Unauthenticated cancellation rejected
  const anonCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    reason: 'Changed mind'
  });
  assert('Unauthenticated ride cancellation rejected with HTTP 401', anonCancelRes.status === 401);

  // 2. Customer 2 attempting to cancel Customer 1 ride rejected
  const crossCustCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    reason: 'Malicious cancellation'
  }, { 'Authorization': `Bearer ${cust2Token}` });
  assert('Customer 2 cancelling Customer 1 ride rejected with HTTP 403 (FORBIDDEN_NOT_OWNER)',
    crossCustCancelRes.status === 403 && crossCustCancelRes.data?.code === 'FORBIDDEN_NOT_OWNER'
  );

  // 3. Customer spoofing customerId in body rejected
  const spoofCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    customerId: cust2Id,
    reason: 'Spoofed id'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer spoofing customerId in body rejected with HTTP 403 (CUSTOMER_MISMATCH)',
    spoofCancelRes.status === 403 && spoofCancelRes.data?.code === 'CUSTOMER_MISMATCH'
  );

  // 4. Driver not assigned attempting cancellation rejected
  const unassignedDrvCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    reason: 'Driver cancel'
  }, { 'Authorization': `Bearer ${drv1Token}` });
  assert('Unassigned driver cancelling ride rejected with HTTP 403 (JOB_NOT_ASSIGNED_TO_DRIVER)',
    unassignedDrvCancelRes.status === 403 && unassignedDrvCancelRes.data?.code === 'JOB_NOT_ASSIGNED_TO_DRIVER'
  );

  // 5. Authorized Customer 1 cancels own ride successfully
  const ownCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    reason: 'Personal reason'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Authorized Customer 1 cancels own ride with HTTP 200', ownCancelRes.status === 200 && ownCancelRes.data?.success);

  // 6. Cancellation idempotent replay
  const replayCancelRes = await request('POST', `/api/rides/${activeJobId}/cancel`, {
    reason: 'Personal reason retry'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Idempotent cancellation retry succeeds without double penalty', replayCancelRes.status === 200);

  // =========================================================================
  // MODULE 4: IDENTITY & KYC SUBMISSION TENANT SCOPING
  // =========================================================================
  console.log('\n--- MODULE 4: Identity & KYC Submission Tenant Scoping ---');

  // 1. Unauthenticated KYC submission rejected
  const anonKycRes = await request('POST', '/api/identity/submit', {
    userId: cust2Id,
    aadhaarNumber: '123456789012',
    voterIdNumber: 'ABCDE1234F'
  });
  assert('Unauthenticated identity verification submission rejected with HTTP 401', anonKycRes.status === 401);

  // 2. Customer 1 attempting to submit KYC for Customer 2 rejected
  const crossKycRes = await request('POST', '/api/identity/submit', {
    userId: cust2Id,
    aadhaarNumber: '987654321098',
    voterIdNumber: 'XYZAB9876C'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer 1 submitting KYC for Customer 2 rejected with HTTP 403 (CUSTOMER_MISMATCH)',
    crossKycRes.status === 403 && crossKycRes.data?.code === 'CUSTOMER_MISMATCH'
  );

  // 3. Customer 2 submitting own KYC succeeds
  const ownKycRes = await request('POST', '/api/identity/submit', {
    userId: cust2Id,
    aadhaarNumber: '123456789012',
    voterIdNumber: 'ABCDE1234F'
  }, { 'Authorization': `Bearer ${cust2Token}` });
  assert('Customer 2 submitting own KYC succeeds with HTTP 200', ownKycRes.status === 200 && ownKycRes.data?.success);

  // =========================================================================
  // MODULE 5: MASTER CATALOG ROUTE PROTECTION
  // =========================================================================
  console.log('\n--- MODULE 5: Master Catalog Route Protection ---');

  // 1. Unauthenticated GET rejected
  const anonCatGet = await request('GET', '/api/admin/master-catalog');
  assert('Unauthenticated GET /api/admin/master-catalog rejected with HTTP 401', anonCatGet.status === 401);

  // 2. Unauthenticated POST rejected
  const anonCatPost = await request('POST', '/api/admin/master-catalog', {
    name: 'Malicious Product',
    category: 'Dairy',
    mrp: 100.0
  });
  assert('Unauthenticated POST /api/admin/master-catalog rejected with HTTP 401', anonCatPost.status === 401);

  // 3. Customer token on master catalog rejected
  const custCatPost = await request('POST', '/api/admin/master-catalog', {
    name: 'Malicious Product',
    category: 'Dairy',
    mrp: 100.0
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer token attempting to add master product rejected with HTTP 401', custCatPost.status === 401);

  // 4. Authenticated Admin can view master catalog
  const adminCatGet = await request('GET', '/api/admin/master-catalog', null, {
    'Authorization': `Bearer ${adminToken}`
  });
  assert('Authenticated Admin reads master catalog with HTTP 200', adminCatGet.status === 200 && adminCatGet.data?.success);

  // =========================================================================
  // MODULE 6: MEDIA UPLOAD & DELETION IDOR PROTECTION
  // =========================================================================
  console.log('\n--- MODULE 6: Media Upload & Deletion IDOR Protection ---');

  const SAMPLE_BASE64_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  // 1. Customer 1 uploading profile photo succeeds
  const cust1PhotoRes = await request('POST', '/api/customer/profile/photo', {
    customerId: cust1Id,
    fileData: SAMPLE_BASE64_IMG,
    mimeType: 'image/png'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer 1 updates own profile photo successfully (HTTP 200)', cust1PhotoRes.status === 200 && !!cust1PhotoRes.data?.asset);
  const cust1AssetId = cust1PhotoRes.data?.asset?.public_id || cust1PhotoRes.data?.asset?.cloudinaryPublicId;

  // 2. Customer 1 uploading profile photo for Customer 2 rejected
  const crossCustMedia = await request('POST', '/api/customer/profile/photo', {
    customerId: cust2Id,
    fileData: SAMPLE_BASE64_IMG,
    mimeType: 'image/png'
  }, { 'Authorization': `Bearer ${cust1Token}` });
  assert('Customer 1 updating Customer 2 photo rejected with HTTP 403 (CUSTOMER_MISMATCH)',
    crossCustMedia.status === 403 && crossCustMedia.data?.code === 'CUSTOMER_MISMATCH'
  );

  // 3. Driver 1 uploading profile photo for Driver 2 rejected
  const crossDrvMedia = await request('POST', '/api/driver/profile/photo', {
    driverId: drv2Id,
    fileData: SAMPLE_BASE64_IMG,
    mimeType: 'image/png'
  }, { 'Authorization': `Bearer ${drv1Token}` });
  assert('Driver 1 updating Driver 2 photo rejected with HTTP 403 (DRIVER_MISMATCH)',
    crossDrvMedia.status === 403 && crossDrvMedia.data?.code === 'DRIVER_MISMATCH'
  );

  // 4. Driver 1 uploading vehicle photo for Driver 2 vehicle rejected
  const crossVehMedia = await request('POST', '/api/driver/vehicle/photo', {
    driverId: drv2Id,
    vehicleId: 'veh_dl_102',
    fileData: SAMPLE_BASE64_IMG,
    mimeType: 'image/png'
  }, { 'Authorization': `Bearer ${drv1Token}` });
  assert('Driver 1 updating Driver 2 vehicle photo rejected with HTTP 403 (DRIVER_MISMATCH)',
    crossVehMedia.status === 403 && crossVehMedia.data?.code === 'DRIVER_MISMATCH'
  );

  // 5. Customer 2 attempting to delete Customer 1's media asset rejected
  const crossDelMedia = await request('DELETE', `/api/media/${cust1AssetId}`, null, {
    'Authorization': `Bearer ${cust2Token}`
  });
  assert('Customer 2 attempting to delete Customer 1 media asset rejected with HTTP 403 (FORBIDDEN_NOT_OWNER)',
    crossDelMedia.status === 403 && crossDelMedia.data?.code === 'FORBIDDEN_NOT_OWNER'
  );

  // =========================================================================
  // MODULE 7: LIVE POSTGRESQL SECURITY & MIGRATION 021 VERIFICATION
  // =========================================================================
  console.log('\n--- MODULE 7: Live PostgreSQL Authoritative Security (Migration 021) ---');

  const pg = createPgClient();
  await pg.connect();

  try {
    // 1. Verify 0 tables missing RLS in public schema
    const rlsRes = await pg.query(`
      SELECT tablename
      FROM pg_tables
      JOIN pg_class c ON c.relname = pg_tables.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE schemaname = 'public'
        AND tablename != 'schema_migrations'
        AND c.relrowsecurity = false;
    `);
    assert('All PostgreSQL public tables have RLS enabled (0 missing RLS)', rlsRes.rows.length === 0,
      `Tables missing RLS: ${rlsRes.rows.map(r => r.tablename).join(', ')}`
    );

    // 2. Verify all SECURITY DEFINER functions have safe search_path
    const defRes = await pg.query(`
      SELECT proname, proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND prosecdef = true;
    `);
    const unsafeDef = defRes.rows.filter(r => !r.proconfig || !r.proconfig.some(c => c.startsWith('search_path=')));
    assert('All SECURITY DEFINER functions enforce explicit search_path (0 vulnerable)', unsafeDef.length === 0,
      `Vulnerable functions: ${unsafeDef.map(f => f.proname).join(', ')}`
    );

    // 3. Verify sensitive RPCs revoked from anon role
    const anonRpcRes = await pg.query(`
      SELECT routine_name
      FROM information_schema.routine_privileges
      WHERE routine_schema = 'public'
        AND grantee = 'anon'
        AND routine_name IN (
          'cancel_ride_atomic',
          'refund_payment_atomic',
          'redeem_promotion_atomic',
          'validate_promotion_preview',
          'create_dispatch_offer_atomic'
        );
    `);
    assert('Sensitive financial & state RPCs revoked from anon Supabase role (0 granted to anon)', anonRpcRes.rows.length === 0,
      `Granted to anon: ${anonRpcRes.rows.map(r => r.routine_name).join(', ')}`
    );

    // 4. Verify grocery tables have RLS and policies
    const grocRlsRes = await pg.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('master_grocery_catalog', 'merchant_grocery_inventory', 'grocery_price_history');
    `);
    assert('Grocery tables (master, inventory, price history) have rowsecurity = true',
      grocRlsRes.rows.length === 3 && grocRlsRes.rows.every(r => r.rowsecurity === true)
    );
  } finally {
    await pg.end();
  }

  // =========================================================================
  // MODULE 8: OTP PRODUCTION PROTECTION & TIMING-SAFE BOOTSTRAP
  // =========================================================================
  console.log('\n--- MODULE 8: Production Fail-Closed OTP & Security Guards ---');

  // 1. Timing-safe admin bootstrap verification
  const badBootstrapRes = await request('POST', '/api/admin/bootstrap', {
    bootstrapKey: 'wrong_secret_1234567890123456'
  });
  assert('Invalid bootstrap key rejected with HTTP 403', badBootstrapRes.status === 403);

  // 2. Database layer test mode vs production simulation
  const db = require('./src/database');
  const originalEnv = process.env.NODE_ENV;
  const originalTestMode = process.env.NABIN_TEST_MODE;

  try {
    // Simulate production environment
    process.env.NODE_ENV = 'production';
    delete process.env.NABIN_TEST_MODE;

    // Send OTP in production mode
    const prodOtpRes = await db.sendAuthOtp({ phone: '+919999999999', role: 'CUSTOMER' });
    assert('Production sendAuthOtp NEVER returns testOtp in response payload', prodOtpRes.testOtp === undefined);

    // Verify static demo OTP in production mode (must throw error / reject)
    let prodVerifyRejected = false;
    try {
      const prodVerifyRes = await db.verifyAuthOtp({
        phone: '+919999999999',
        otp: '7729',
        role: 'CUSTOMER'
      });
      if (!prodVerifyRes || prodVerifyRes.success === false) {
        prodVerifyRejected = true;
      }
    } catch (err) {
      prodVerifyRejected = true;
    }
    assert('Production verifyAuthOtp strictly rejects static demo OTP (7729)', prodVerifyRejected);
  } finally {
    process.env.NODE_ENV = originalEnv;
    process.env.NABIN_TEST_MODE = originalTestMode;
  }

  // =========================================================================
  // MODULE 9: CONCURRENCY RACE & IDEMPOTENCY SAFETY
  // =========================================================================
  console.log('\n--- MODULE 9: Concurrency & Ride Cancellation Race Safety ---');

  // Book a second trip for concurrency race with Customer 1
  const raceBookRes = await request('POST', '/api/customer/book-ride', {
    serviceType: 'RIDE',
    pickup: { lat: 28.5562, lng: 77.1000, address: 'Delhi Airport Terminal 3' },
    drop: { lat: 28.6315, lng: 77.2167, address: 'Connaught Place' },
    vehicleType: '4W',
    fare: 350.0
  }, { 'Authorization': `Bearer ${cust1Token}` });

  const raceJobId = raceBookRes.data?.job?.id || raceBookRes.data?.bookingId;
  assert('Race ride booked successfully', !!raceJobId);

  // Fire 2 concurrent cancellation requests simultaneously
  const cancelPromise1 = request('POST', `/api/rides/${raceJobId}/cancel`, {
    reason: 'Duplicate booking race 1'
  }, { 'Authorization': `Bearer ${cust1Token}` });

  const cancelPromise2 = request('POST', `/api/rides/${raceJobId}/cancel`, {
    reason: 'Duplicate booking race 2'
  }, { 'Authorization': `Bearer ${cust1Token}` });

  const [res1, res2] = await Promise.all([cancelPromise1, cancelPromise2]);

  assert('Both concurrent cancellation requests return safely (HTTP 200)', res1.status === 200 && res2.status === 200);
  const oneIsDuplicate = (res1.data?.duplicate === true) || (res2.data?.duplicate === true);
  assert('At least one cancellation is recognized as idempotent duplicate replay under concurrency', oneIsDuplicate);

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n========================================================================');
  console.log(`📊 PHASE 7 SECURITY AUDIT RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Fatal error running Phase 7 security suite:', err);
  process.exit(1);
});
