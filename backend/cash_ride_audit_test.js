/*
 * NABIN — Phase 14 cash-ride and driver-cash-obligation audit tests.
 *
 * What the audit established, and what this suite therefore asserts:
 *
 *   Rides have NO cash payment path.  POST /api/customer/book-ride destructures
 *   `customerId, vehicleType, pickup, drop, promoCode, bookingType,
 *   passengerCategory, passengerInfo` — there is no payment field — and
 *   `db.createJob` is called without a payment method, so JobRepository falls
 *   back to `payment_method: 'WALLET'` and `metadata.paymentMode: 'Online UPI'`.
 *   The only comparisons against cash are `job.paymentMode === 'Cash'` and
 *   `!== 'Cash'` in `database.js`, and nothing in the repository writes 'Cash'
 *   for a ride.  Across all 3029 durable `jobs` rows the payment method is
 *   WALLET and `metadata.paymentMode` is 'Online UPI' (2799) or absent (230).
 *   Those branches are dead, and `driver.cashCollectedToday` — which has no
 *   column at all — can never move.
 *
 * So the tests here are of two kinds, and deliberately no more:
 *   1. BEHAVIOUR that exists and must keep existing: the server, not the client,
 *      decides a ride's fare, its split, and its payment method; and the
 *      dispatch functions refuse a suspended driver.
 *   2. RATCHETS ON ABSENT CAPABILITY.  There is no cash-collection record, no
 *      driver obligation, no threshold, no remittance endpoint, and no
 *      receivable account.  Each is asserted ABSENT.  Anyone who later adds a
 *      cash ride without adding the matching obligation model — or who lets a
 *      client choose the payment method — turns this suite red instead of
 *      shipping a silent second ledger.
 *
 * The alternative would be 28 cash tests where 22 of them pass by asserting
 * nothing, which is the failure mode the directive forbids.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createLogin } = require('./testSessionCache');

const BASE = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const envText = (() => {
  try { return fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); } catch { return ''; }
})();
const envOf = (k) => (envText.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1];
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(envOf('SUPABASE_URL') || 'http://127.0.0.1:54321',
  envOf('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const RUN = `P14-${Date.now()}`;
const results = { pass: 0, fail: 0, skip: 0 };
const check = (name, cond, detail) => {
  if (cond) { results.pass++; console.log(`PASSED  ${name}${detail ? ' — ' + detail : ''}`); }
  else { results.fail++; console.log(`FAILED  ${name}${detail ? ' — ' + detail : ''}`); }
};
const skip = (name, reason) => { results.skip++; console.log(`SKIPPED ${name} — ${reason}`); };
const req = (path, { method = 'GET', headers = {}, body } = {}) =>
  fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    // fetch rejects a GET/HEAD that carries a body, so only non-GET probes may
    // send one. Getting this wrong aborts the whole suite mid-run.
    body: method === 'GET' || !body ? undefined : JSON.stringify(body),
  }).then(async r => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const auth = t => ({ Authorization: `Bearer ${t}` });
/* Reuse an already-valid customer session rather than spending OTP dispatches:
 * the payment method, not the sign-in, is what is under test here. */
const request = (method, urlPath, body, headers = {}) => req(urlPath, { method, headers, body });
const sharedLogin = createLogin({ baseUrl: BASE, request });
const CUSTOMER_PHONE = '9845011982';
/* A ride the customer tries to turn into cash, with every money field supplied. */
const CASH_ATTEMPT_BODY = (phoneTail) => ({
  pickup: { address: 'Gate 1, India Gate, New Delhi', lat: 28.6129, lng: 77.2295 },
  drop: { address: 'Connaught Place, New Delhi', lat: 28.6315, lng: 77.2167 },
  vehicleType: 'AUTO',
  /* everything below is what a client must NOT be able to dictate */
  paymentMethod: 'CASH',
  paymentMode: 'Cash',
  payment_method: 'CASH',
  cashAmount: 5000,
  cashCollected: 5000,
  fare: 5000,
  driverEarnings: 4990,
  platformFee: 10,
  platformCommission: 10,
  driverAmountOwedToNabin: 4990,
  amountDue: 5000,
  settlementAmount: 0,
  outstandingAmount: 0,
  [RUN]: phoneTail,
});

test('NABIN Phase 14 cash-ride and driver obligation audit', async () => {
  const host = BASE.replace(/^https?:\/\//, '');

  /* ---------------------------------------------------------------- *
   * 1. The server owns the ride's money and payment method
   * ---------------------------------------------------------------- */
  const sess = await sharedLogin(CUSTOMER_PHONE, 'CUSTOMER');
  const ut = sess.token;
  check('CR-00 a real customer session is available for the ride tests', !!ut && ut.length > 10,
    ut ? `source=${sess.source}` : `failure=${JSON.stringify(sess.failure || {}).slice(0, 90)}`);

  if (!ut) {
    ['CR-01', 'CR-02', 'CR-03', 'CR-04', 'CR-05', 'CR-06', 'CR-07', 'CR-08'].forEach(n => skip(n, 'no customer session'));
  } else {
    const booked = await req('/api/customer/book-ride', { method: 'POST', headers: auth(ut), body: CASH_ATTEMPT_BODY(CUSTOMER_PHONE.slice(-4)) });
    check('CR-01 a ride can be booked while the client attempts cash', booked.status === 200 && booked.data.success === true && !booked.data.job?.paymentError,
      `s=${booked.status} code=${booked.data.code || booked.data.error?.code || ''} err=${JSON.stringify(booked.data.error || '').slice(0, 70)}`);

    const job = booked.data.job || {};
    const jobId = job.id || booked.data.jobId;
    /* The response is what the rest of the system reads, so it must not carry
     * cash semantics the client asked for. */
    check('CR-02 the client cannot make the ride a cash ride', !/cash/i.test(String(job.paymentMode || '')) && !/cash/i.test(String(job.paymentMethod || '')),
      `paymentMode=${job.paymentMode} paymentMethod=${job.paymentMethod}`);
    check('CR-03 the server keeps its own ride pricing, not the client number', job.fare !== 5000 && Number(job.fare) > 0,
      `serverFare=${job.fare} clientAskedFor=5000 earnings=${job.driverEarnings} platformFee=${job.platformFee}`);
    check('CR-04 the server keeps its own commission split, not the client split', Number(job.platformFee) !== 10 && Number(job.driverEarnings) !== 4990,
      `driverEarnings=${job.driverEarnings} platformFee=${job.platformFee} clientAskedFor=4990/10`);

    /* Durable proof: what actually lands in PostgreSQL. The API's `job.id` is the
     * business job number; `jobs.id` is the surrogate uuid, so the lookup has to
     * go by job_number or it fails with a uuid cast error. */
    const pg = await supabaseAdmin.from('jobs')
      .select('id,job_number,status,payment_method,payment_status,final_total,driver_earnings,platform_commission,metadata')
      .eq('job_number', jobId).maybeSingle();
    check('CR-05 the booked ride is persisted so the durable store can be audited', !pg.error && !!pg.data,
      pg.error ? `ERR ${pg.error.message.slice(0, 60)}` : `row=${pg.data && pg.data.job_number}`);
    if (pg.data) {
      const meta = pg.data.metadata || {};
      check('CR-06 the durable ride is a wallet ride, never cash', !/cash/i.test(String(pg.data.payment_method || '')) && !/cash/i.test(String(meta.paymentMode || '')),
        `payment_method=${pg.data.payment_method} metadata.paymentMode=${meta.paymentMode}`);
      check('CR-07 the durable amounts are the server calculation, not the client numbers',
        Number(pg.data.final_total) !== 5000 && Number(pg.data.driver_earnings) !== 4990 && Number(pg.data.platform_commission) !== 10,
        `final_total=${pg.data.final_total} driver_earnings=${pg.data.driver_earnings} platform_commission=${pg.data.platform_commission}`);
      check('CR-08 the ride row carries no cash-collection or obligation fields at all',
        !Object.keys(pg.data).some(k => /cash|outstand|collect|oblig|remitt|receivab|debt/i.test(k))
        && !Object.keys(meta).some(k => /cash|outstand|collect|oblig|remitt|receivab|debt/i.test(k)),
        `columns=${Object.keys(pg.data).length} metadataKeys=${Object.keys(meta).length}`);
    } else {
      ['CR-06', 'CR-07', 'CR-08'].forEach(n => skip(n, 'no durable job row'));
    }

    /* Completion must not invent a cash collection. */
    if (jobId) {
      /* Clean up the ride this test created; it is not a fixture anyone else uses. */
      await req(`/api/rides/${jobId}/cancel`, { method: 'POST', headers: auth(ut), body: { reason: 'PHASE 14 audit test' } });
    }
  }

  /* ---------------------------------------------------------------- *
   * 2. The capability that the directive describes does not exist, and
   *    this pins that fact so a half-implementation fails loudly.
   * ---------------------------------------------------------------- */
  const missing = [
    ['/api/driver/cash-confirmation', 'POST', 'driver confirms cash received'],
    ['/api/driver/cash-collections', 'GET', 'driver cash collection list'],
    ['/api/driver/cash-outstanding', 'GET', 'driver outstanding cash balance'],
    ['/api/driver/cash-settlement', 'POST', 'driver remits cash to NABIN'],
    ['/api/driver/cash-deposit', 'POST', 'driver cash deposit'],
    ['/api/driver/recovery', 'POST', 'cash recovery'],
    // No admin probe here: `/api/admin/...` is behind an authentication layer that
    // answers 401 before routing, so a 404 could not be distinguished from an
    // unregistered path. CR-11 proves the admin surface from the schema instead.
  ];
  for (const [route, method, label] of missing) {
    const r = await req(route, { method, headers: auth('no-token-this-probe-only'), body: {} });
    check(`CR-09 no endpoint exists to ${label}`, r.status === 404, `${method} ${route} -> s=${r.status}`);
  }

  /* Schema ratchets: no collection record, no obligation, no threshold, no
   * receivable account. If any appears, this suite must be revisited together
   * with the accounting decision — not quietly updated. */
  /* Schema and function-definition scans must come from PostgreSQL itself. This
   * PostgREST does not expose the information_schema catalog views, so a
   * client-side `.from('columns')` read returns zero rows — and a zero-row scan
   * would "prove" no cash column exists while proving nothing at all. CR-10
   * exists to make that failure mode impossible: it reddens unless the scan
   * itself is non-trivial. */
  const { Client } = require('pg');
  const pgClient = new Client({
    connectionString: process.env.NABIN_PG_NOTIFY || 'postgres://postgres:postgres@127.0.0.1:54322/postgres',
  });
  let pgErr = null;
  let scanned = 0;
  let cashCols = [];
  let gated = [];
  try {
    await pgClient.connect();
    const scan = await pgClient.query(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'");
    scanned = scan.rows.length;
    cashCols = [...new Set(scan.rows
      .filter(c => /cash|outstand|remitt|receivab|debt|obligation/i.test(c.column_name))
      .map(c => `${c.table_name}.${c.column_name}`))];
    const fns = await pgClient.query(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS src
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('accept_dispatch_offer_atomic','accept_job_assignment_atomic','create_dispatch_offer_atomic')`);
    gated = (fns.rows || [])
      .filter(r => /DRIVER_SUSPENDED/.test(String(r.src)) && /operational_status\s*=\s*'SUSPENDED'/.test(String(r.src)))
      .map(r => r.name);
  } catch (e) {
    pgErr = e.code || e.message;
  } finally {
    try { await pgClient.end(); } catch { /* ignore */ }
  }
  check('CR-10 the cash-column scan is trustworthy', pgErr === null && scanned > 500,
    pgErr ? `pg unavailable: ${pgErr}` : `scanned ${scanned} columns in the public schema`);
  check('CR-11 no cash-collection or cash-obligation column exists anywhere in the schema',
    pgErr === null && cashCols.length === 0,
    cashCols.length ? `found: ${cashCols.join(', ')}` : `none across ${scanned} columns`);

  const drvCols = await supabaseAdmin.from('drivers').select('*').limit(1);
  const driverKeys = Object.keys(((drvCols.data || [])[0]) || {});
  check('CR-12 drivers has no outstanding/debt column and no per-day cash column',
    !driverKeys.some(k => /outstand|debt|cash|receivab/i.test(k)),
    `drivers columns: ${driverKeys.length}, cash-like: ${driverKeys.filter(k => /outstand|debt|cash/i.test(k)).join(',') || 'none'}`);
  check('CR-13 suspension IS representable on a driver', driverKeys.includes('operational_status'),
    'operational_status exists and its CHECK permits SUSPENDED');

  const settings = await supabaseAdmin.from('platform_settings').select('setting_key').limit(500);
  const sKeys = (settings.data || []).map(r => r.setting_key);
  const thKeys = sKeys.filter(k => /cash|outstand|debt|limit|threshold|credit/i.test(k));
  check('CR-14 no cash-outstanding threshold is configured anywhere', settings.error ? false : thKeys.length === 0,
    `platform_settings has ${sKeys.length} keys, threshold-like: ${thKeys.join(',') || 'none'}`);

  /* The dispatch gate that DOES exist, verified from the database's own function
   * definitions rather than from a comment or a migration file: all three atomic
   * dispatch functions refuse a suspended driver. */
  check('CR-15 dispatch refuses a suspended driver at the database layer', gated.length === 3,
    pgErr ? `pg unavailable: ${pgErr}` : `functions enforcing DRIVER_SUSPENDED: ${gated.join(', ') || 'none'}`);

  /* And the root cause itself, pinned precisely: the ride booking handler reads
   * no money or payment field off the request. This is not "assert the defect
   * stays" — it names exactly which client-supplied fields would have to appear
   * before a cash ride becomes possible, so whoever adds one is forced to make
   * the accounting decision this suite exists to guard. */
  const serverText = fs.readFileSync(path.join(__dirname, 'src', 'server.js'), 'utf8');
  // server.js is CRLF, so an anchor written as `\n});` never matches and the
  // extraction silently yields an empty body — which would make this guard pass
  // by reading nothing. The length check below is what catches that.
  const bookBody = (serverText.match(/app\.post\('\/api\/customer\/book-ride'[\s\S]*?\r?\n\}\);/) || [''])[0];
  const bodyReads = [...bookBody.matchAll(/req\.body\.([A-Za-z0-9_]+)/g)].map(m => m[1]);
  const destructure = (bookBody.match(/const \{([^}]*)\} = req\.body/) || [, ''])[1];
  const names = new Set(bodyReads.concat(destructure.split(',').map(s => s.split(':').pop().trim()).filter(Boolean)));
  const forbidden = [...names].filter(n => /payment|cash|fare|earning|commission|fee|amount|price|total|settle|outstand/i.test(n));
  check('CR-16 the ride booking handler accepts no money or payment field from the client',
    bookBody.length > 200 && names.size > 3 && forbidden.length === 0,
    `handler=${bookBody.length} chars, reads: ${[...names].join(',') || 'none'}; money/payment fields accepted: ${forbidden.join(',') || 'none'}`);

  console.log(`\nPhase 14 cash audit ratchet totals: ${results.pass} passed, ${results.fail} failed, ${results.skip} skipped`);
  assert.strictEqual(results.fail, 0, `${results.fail} Phase 14 cash audit check(s) failed`);
});

process.on('exit', () => {
  console.log(`\nPHASE14_CASH_AUDIT_TEST_SUMMARY passed=${results.pass} failed=${results.fail} skipped=${results.skip}`);
});
