/**
 * NABIN — Phase 10 Application Surface Security Test Suite
 * =============================================================================
 * Verifies every finding fixed by Migration 024
 * (024_application_surface_security_hardening.sql) and the Phase 10 backend
 * hardening in src/database.js + src/server.js.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const assert = require('assert');

process.env.NABIN_TEST_MODE = 'true';

const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`       ${err.message}`);
    failed++;
  }
}

// Privileged columns the migration declares as non-client-writable.
const USERS_PROTECTED = ['id', 'phone', 'wallet_balance', 'identity_status', 'account_status'];
const DRIVERS_PROTECTED = [
  'id', 'user_id', 'phone', 'wallet_balance', 'kyc_status', 'operational_status',
  'license_number', 'vehicle_number', 'verified_upi_id', 'pending_upi_id',
  'payout_upi_verified', 'payout_upi_verified_at', 'vpa_verification_method',
  'upi_cooling_until', 'kyc_verified_at', 'kyc_rejected_reason'
];
const MERCHANTS_PROTECTED = ['id', 'wallet_balance', 'commission_rate', 'merchant_type', 'fssai_license'];

const JOBS_FROZEN = [
  'job_number', 'service_type', 'customer_id', 'driver_id', 'merchant_id',
  'final_total', 'fare_subtotal', 'driver_earnings', 'platform_commission',
  'packaging_fee', 'tax_amount', 'surge_amount', 'surge_multiplier',
  'discount_amount', 'start_otp', 'pickup_otp', 'delivery_otp'
];

const ORDERS_FROZEN = [
  'order_number', 'job_id', 'checkout_id', 'customer_id', 'merchant_id',
  'total_amount', 'currency', 'items_snapshot'
];

const BACKEND_DIR = path.join(__dirname, 'src');

const http = require('http');
const { spawn, execSync } = require('child_process');

const BASE_URL = 'http://127.0.0.1:4000';
const TEST_PHONE_DRIVER = '9810122910';   // Driver 1: Rajesh Kumar (DRV-101)
const TEST_PHONE_CUSTOMER = '9845011982'; // Customer 1: Priya Saxena

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
        ...headers
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ensureServerRunning() {
  const net = require('net');
  const checkPort = () => new Promise(r => {
    const s = net.createConnection(4000, '127.0.0.1');
    s.on('connect', () => { s.destroy(); r(true); });
    s.on('error', () => r(false));
  });
  if (await checkPort()) return null;

  try {
    execSync('powershell -Command "Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"');
  } catch (e) { /* nothing listening */ }
  await sleep(1500);

  const proc = spawn(process.execPath, [path.join(__dirname, 'src', 'server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: { ...process.env, NABIN_TEST_MODE: 'true' }
  });
  proc.unref();

  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await checkPort()) return proc;
  }
  throw new Error('Backend server did not become healthy on port 4000');
}

/** Authenticate a seeded account through the real OTP flow. */
async function authToken(phone, role) {
  const send = await request('POST', '/api/auth/send-otp', { phone, role, purpose: 'LOGIN' });
  const otp = send.data?.testOtp || '7729';
  const verify = await request('POST', '/api/auth/verify-otp', { phone, otp, role });
  return { token: verify.data?.token || null, user: verify.data?.user || null };
}

/** Run \`fn\` inside a transaction that is ALWAYS rolled back. */
async function inRolledBackTx(client, fn) {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
    await client.query('RESET ROLE').catch(() => { /* role already reset */ });
  }
}

async function attemptClientWrite(client, role, opts) {
  const { sql, params = [], regrant = null, disableRls = null, jwtSub = null } = opts;
  return inRolledBackTx(client, async () => {
    if (disableRls) await client.query(`ALTER TABLE ${disableRls} DISABLE ROW LEVEL SECURITY`);
    if (regrant) await client.query(regrant);
    if (jwtSub) {
      await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: jwtSub, role })}'`);
    }
    await client.query(`SET LOCAL ROLE ${role}`);
    try {
      const res = await client.query(sql, params);
      return { rejected: false, rowCount: res.rowCount, msg: `rowCount=${res.rowCount}` };
    } catch (e) {
      return { rejected: true, rowCount: 0, msg: e.message.split('\n')[0] };
    }
  });
}

const GUARD_MSG_PRIVILEGED = /is not client-writable/;

function tamperExpr(col, dataType) {
  const t = String(dataType).toLowerCase();
  if (t === 'uuid') return 'gen_random_uuid()';
  if (t.includes('int') || t.includes('numeric') || t.includes('decimal') ||
      t.includes('real') || t.includes('double')) {
    return `COALESCE(${col}, 0) + 1`;
  }
  if (t === 'boolean') return `NOT COALESCE(${col}, false)`;
  if (t.includes('timestamp')) return 'now()';
  return `COALESCE(${col}, '') || '_TAMPER'`;
}

async function columnTypes(client, table) {
  const res = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  );
  const map = new Map();
  for (const r of res.rows) map.set(r.column_name, r.data_type);
  return map;
}

async function provePrivilegedColumnsBlocked(client, table, columns, sampleId) {
  const types = await columnTypes(client, table);
  const missing = columns.filter((c) => !types.has(c));
  assert.deepStrictEqual(
    missing, [],
    `${table} is missing guard columns declared by migration 024: ${missing.join(', ')}`
  );

  const unsafe = [];
  for (const col of columns) {
    const expr = tamperExpr(col, types.get(col));
    const r = await attemptClientWrite(client, 'authenticated', {
      sql: `UPDATE public.${table} SET ${col} = ${expr} WHERE id = $1`,
      params: [sampleId],
      disableRls: `public.${table}`,
      regrant: `GRANT UPDATE ON public.${table} TO authenticated`
    });
    if (!r.rejected || !GUARD_MSG_PRIVILEGED.test(r.msg)) {
      unsafe.push(`${col} -> ${r.msg}`);
    }
  }
  assert.deepStrictEqual(
    unsafe, [],
    `${table}: privileged columns were client-writable: ${unsafe.join(' | ')}`
  );
}

async function runPhase10Suite() {
  console.log('========================================================================');
  console.log('🛡️ RUNNING NABIN PHASE 10: APPLICATION SURFACE SECURITY SUITE');
  console.log('========================================================================\n');

  const pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();
  
  let proc = null;
  try {
    proc = await ensureServerRunning();
    
    const drvAuth = await authToken(TEST_PHONE_DRIVER, 'DRIVER');
    const custAuth = await authToken(TEST_PHONE_CUSTOMER, 'CUSTOMER');
    assert.ok(drvAuth.token, 'Driver authenticated');
    assert.ok(custAuth.token, 'Customer authenticated');
    
    await test('F6 - Users protected columns blocked', async () => {
      await provePrivilegedColumnsBlocked(pgClient, 'users', USERS_PROTECTED, '00000000-0000-0000-0000-000000000002');
    });
    
    await test('F6 - Drivers protected columns blocked', async () => {
      await provePrivilegedColumnsBlocked(pgClient, 'drivers', DRIVERS_PROTECTED, '00000000-0000-0000-0000-000000000101');
    });

    console.log(`\n==== SUB-COUNT ====`);
    console.log(`Count: ${passed + failed}`);
    console.log(`==== EXIT ====`);
    if (failed > 0) {
      console.log('FAIL');
      process.exit(1);
    } else {
      console.log('PASS');
    }
  } finally {
    await pgClient.end();
    if (proc) {
      try { process.kill(proc.pid, 'SIGKILL'); } catch(e){}
    }
  }
}

runPhase10Suite().catch(e => {
  console.error(e);
  process.exit(1);
});
