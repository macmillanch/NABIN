/*
 * F-2: the public ad-click endpoint is unauthenticated by design (a click-through comes from a visitor),
 * but with no throttle one requester could inflate `clicks` without bound, and clicks are the metric
 * advertisers are billed and ranked on. The owner-selected product rule is
 * **3 clicks per 10 minutes per `<advertisementId>:<requester IP>`**, enforced process-locally with the
 * in-memory Map pattern the repository already uses (`server.js` bootstrapAttempts, `database.js`
 * rateLimitRecords).
 *
 * Deliberately NOT covered here, because it is not what F-2 approved: Redis, a limit table, or any
 * distributed limiter. The limiter resets on backend restart and is per instance - see the docs.
 *
 * The requester key is `req.ip` per the repository's existing convention. A forged `X-Forwarded-For` must
 * NOT buy a fresh bucket, so F2-05 sends one on purpose.
 *
 * Run it with NABIN_TEST_BASE_URL to target an existing backend, or with no env to start a throwaway one.
 */
process.env.NODE_ENV = 'local';
let BASE_URL = process.env.NABIN_TEST_BASE_URL || 'http://127.0.0.1:4000';
const { spawn } = require('child_process');

// Live-proof mode (how the chain runs this link): fixture data is not acceptable evidence that a click was
// stored, so the suite then reads the actual row with SQL and refuses to pass on `dataSource: 'fixture'`.
// It also refuses to run at all if the isolated DATABASE_URL was not injected, because falling back to the
// shared database would silently turn an isolated proof into a public write.
const REQUIRE_LIVE = process.env.NABIN_F2_REQUIRE_LIVE === '1';

const LIMIT = 3;            // the owner-selected threshold
const WINDOW_MS = 10 * 60 * 1000;

let passed = 0, failed = 0, cleanupFailures = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.log(`  ❌ ${name} ${detail}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const request = (method, pathName, body = null, headers = {}) => new Promise((resolve, reject) => {
  const url = new URL(pathName, BASE_URL);
  const bodyStr = body ? JSON.stringify(body) : null;
  const req = require('http').request({
    method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
    headers: { 'Content-Type': 'application/json', ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}), ...headers }
  }, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch (e) { resolve({ status: res.statusCode, raw: data }); } });
  });
  req.on('error', reject);
  if (body) req.write(bodyStr);
  req.end();
});

async function waitForHealth(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const health = await request('GET', '/api/health');
      if (health.status === 200) return;
    } catch (e) { /* retry */ }
    await sleep(250);
  }
  throw new Error(`backend never became healthy at ${BASE_URL}`);
}

async function click(adId, headers = {}) {
  return request('POST', `/api/advertisements/${adId}/click`, {}, headers);
}
// The counter as the platform itself reports it, so F2-03 does not depend on the click response body.
async function clicksOf(adId) {
  const res = await request('GET', '/api/advertisements');
  const all = (res.data && res.data.advertisements) || [];
  const ad = all.find((a) => a.id === adId);
  return ad ? Number(ad.clicks || 0) : null;
}

let pgClient = null;
async function pgConnect() {
  if (pgClient) return pgClient;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('NABIN_F2_REQUIRE_LIVE is set but DATABASE_URL is absent - refusing to prove durability against public or fixture data');
  const { Client } = require('pg');
  pgClient = new Client({ connectionString: url });
  await pgClient.connect();
  return pgClient;
}
// The durable value, read as SQL from the row itself - not inferred from a response body.
async function durableClicks(adId) {
  if (!REQUIRE_LIVE) return null;
  const client = await pgConnect();
  const r = await client.query('SELECT clicks FROM advertisements WHERE id = $1', [adId]);
  if (!r.rowCount) throw new Error(`advertisement ${adId} is not present in the isolated schema`);
  return Number(r.rows[0].clicks || 0);
}
async function sqlCount(table) {
  if (!REQUIRE_LIVE) return null;
  const client = await pgConnect();
  const r = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
  return Number(r.rows[0].n);
}

(async () => {
  // Isolation contract, matching the already-proven links 48/49/50: when the runner allocates a private port
  // this suite ALWAYS starts and drives its own backend, so the process carries the injected chain_scratch
  // SUPABASE_URL/DATABASE_URL. Reading NABIN_TEST_BASE_URL first is what broke the in-chain run: the runner
  // points it at the shared :4000 harness, so clicks went to `public` while the SQL durability reads below
  // went to `chain_scratch` - two different databases, and a public write an isolated link must never make.
  const PRIVATE_PORT = process.env.NABIN_RESTART_PORT || process.env.NABIN_TEST_PORT || '';
  const ownsServer = !process.env.NABIN_TEST_BASE_URL || !!PRIVATE_PORT;
  let backend = null;
  if (ownsServer) {
    const ownPort = PRIVATE_PORT || '4161';
    backend = spawn(process.execPath, ['src/server.js'], {
      cwd: __dirname, env: Object.assign({}, process.env, { PORT: String(ownPort), NODE_ENV: 'local' })
    });
    backend.stdout.resume();
    backend.stderr.resume();
    BASE_URL = `http://127.0.0.1:${ownPort}`;
  }
  try {
    await waitForHealth(ownsServer ? 90000 : 5000);

    // Live-proof mode first refuses a non-durable backend, so no later assertion can be satisfied by
    // fixture state.
    if (REQUIRE_LIVE) {
      const probe = await request('GET', '/api/advertisements');
      check('F2-L00 the isolated backend is serving the real PostgreSQL store, not fixtures',
        probe.status === 200 && probe.data.dataSource === 'postgres' && probe.data.persisted === true,
        JSON.stringify({ dataSource: probe.data.dataSource, persisted: probe.data.persisted }));
      await pgConnect();
    }

    // Two campaigns created by this test, not borrowed from whatever rows happen to exist: the old code
    // indexed `ads[1]` and died on a schema that had only one ACTIVE campaign. Publishing through the same
    // authenticated admin route AD-01 uses keeps the proof deterministic, and in live mode every write lands
    // in `chain_scratch` because that is where the injected URLs point.
    const stamp = `${Date.now()}-${process.pid}`;
    const adminLogin = await request('POST', '/api/admin/login', {
      username: 'superadmin', password: 'AdminPassword123!'
    });
    check('F2-00 the test can authenticate as admin to publish its own campaigns',
      adminLogin.status === 200 && !!adminLogin.data.token,
      `${adminLogin.status} ${JSON.stringify(adminLogin.data).slice(0, 120)}`);
    const adminToken = adminLogin.data.token;
    const campaignPayload = (title, placement) => ({
      title, placement,
      imageUrl: 'https://nabin.example.com/ads/f2-rate-limit-proof.png',
      targetUrl: '/grocery',
      status: 'ACTIVE',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z'
    });
    const pubA = await request('POST', '/api/admin/advertisements',
      campaignPayload(`F2 throttle proof A ${stamp}`, 'HOME_BANNER'),
      { 'Authorization': `Bearer ${adminToken}` });
    const pubB = await request('POST', '/api/admin/advertisements',
      campaignPayload(`F2 throttle proof B ${stamp}`, 'HOME_BANNER'),
      { 'Authorization': `Bearer ${adminToken}` });
    const adA = pubA.data && pubA.data.advertisement && pubA.data.advertisement.id;
    const adB = pubB.data && pubB.data.advertisement && pubB.data.advertisement.id;
    const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
    check('F2-00b two independent ACTIVE campaigns exist for the proof, created by this test',
      isUuid(adA) && isUuid(adB) && adA !== adB,
      JSON.stringify({ A: pubA.status, B: pubB.status, a: pubA.data, b: pubB.data }).slice(0, 260));

    // F2-01 / F2-07 - a permitted click persists durably. This is AD-07's own predicate, restated so
    // throttling cannot quietly break it.
    const base0 = await clicksOf(adA);
    const n0 = await durableClicks(adA);
    const first = await click(adA);
    const n1 = await durableClicks(adA);
    // Durability is asserted as the store reports it rather than hard-coded to postgres: a permitted click
    // must claim `persisted: true` exactly when it says `dataSource: 'postgres'`, and must never claim
    // persisted while reporting fixture data. AD-07 (test_suite.js) is the postgres-specific guarantee and
    // runs in the chain, where the harness boots against the real store.
    const durableConsistent = (r) => r.data.persisted === (r.data.dataSource === 'postgres');
    check('F2-01 a first permitted click returns 200 with the existing response contract',
      first.status === 200 && first.data.success === true && typeof first.data.clicks === 'number'
      && typeof first.data.dataSource === 'string' && typeof first.data.persisted === 'boolean'
      && durableConsistent(first),
      JSON.stringify(first.data).slice(0, 200));
    check('F2-07 AD-07 semantics hold: permitted click reports success and moves the counter, with persisted matching a durable store',
      first.status === 200 && first.data.success === true && first.data.clicks >= 1 && durableConsistent(first)
      && (base0 === null || first.data.clicks > base0),
      `base=${base0} after=${JSON.stringify(first.data).slice(0, 120)}`);

    // F2-02 - the 2nd and 3rd are still permitted, the 4th within the window is not.
    const second = await click(adA);
    const n2 = await durableClicks(adA);
    const third = await click(adA);
    const n3 = await durableClicks(adA);
    check('F2-02 the 2nd and 3rd clicks from the same requester are still permitted',
      second.status === 200 && third.status === 200,
      `second=${second.status} third=${third.status}`);
    const fourth = await click(adA);
    const nAfter4 = await durableClicks(adA);
    check('F2-02 the 4th click in the window is throttled with the exact status and body',
      fourth.status === 429 && fourth.data.success === false
      && fourth.data.code === 'AD_CLICK_RATE_LIMITED'
      && fourth.data.limit === LIMIT && fourth.data.windowMs === WINDOW_MS
      && typeof fourth.data.retryAfterMs === 'number' && fourth.data.retryAfterMs > 0,
      `${fourth.status} ${JSON.stringify(fourth.data).slice(0, 220)}`);
    check('F2-02 the throttle is reported as an error, not as a fake successful click',
      fourth.data.clicks === undefined, JSON.stringify(fourth.data).slice(0, 160));

    // F2-03 - throttled clicks must not move the durable counter.
    const afterThrottle = await clicksOf(adA);
    const afterPermitted = third.data.clicks;
    check('F2-03 the throttled click did not increment the durable counter',
      afterThrottle !== null && Number(afterThrottle) === Number(afterPermitted),
      `durable=${afterThrottle} lastPermitted=${afterPermitted}`);
    const fifth = await click(adA);
    const nAfter5 = await durableClicks(adA);
    check('F2-03 a further throttled click still leaves the durable counter alone',
      fifth.status === 429 && Number(await clicksOf(adA)) === Number(afterPermitted),
      `fifth=${fifth.status} durable=${await clicksOf(adA)}`);

    // The exact sequence, read from the row rather than from any response body: N, N+1, N+2, N+3, and the
    // two throttled clicks leave it at N+3.
    if (REQUIRE_LIVE) {
      check('F2-L01 the advertisement row itself moved from N to N+1 on the first permitted click',
        Number(n1) === Number(n0) + 1, `n0=${n0} n1=${n1}`);
      check('F2-L02 the durable sequence is exactly N+1, N+2, N+3 for the three permitted clicks',
        Number(n2) === Number(n0) + 2 && Number(n3) === Number(n0) + 3,
        `n0=${n0} n1=${n1} n2=${n2} n3=${n3}`);
      check('F2-L03 the throttled 4th and 5th clicks did NOT change the durable click count',
        Number(nAfter4) === Number(n3) && Number(nAfter5) === Number(n3),
        `n3=${n3} after4=${nAfter4} after5=${nAfter5}`);
      check('F2-L04 the throttle stayed in force for this ad+requester within the window',
        fifth.status === 429 && fifth.data.code === 'AD_CLICK_RATE_LIMITED', `${fifth.status}`);
    }

    // F2-04 - buckets are per advertisement, so another campaign is unaffected.
    const otherFirst = await click(adB);
    check('F2-04 a different advertisement is not throttled by this one (independent bucket)',
      otherFirst.status === 200 && otherFirst.data.success === true && durableConsistent(otherFirst),
      JSON.stringify(otherFirst.data).slice(0, 200));

    // F2-05 - a forged forwarding header must NOT buy a fresh bucket: the key is req.ip, per the
    // repository's existing convention, and client-supplied identity headers are not trusted.
    const spoofed = await click(adA, { 'X-Forwarded-For': '203.0.113.77' });
    check('F2-05 a spoofed X-Forwarded-For does not reset the throttle for the same requester',
      spoofed.status === 429 && spoofed.data.code === 'AD_CLICK_RATE_LIMITED',
      `${spoofed.status} ${JSON.stringify(spoofed.data).slice(0, 160)}`);

    // F2-06 - unknown advertisement keeps its 404, throttled or not.
    const unknown = await click('00000000-0000-0000-0000-000000000000');
    check('F2-06 an unknown advertisement still returns the existing 404 semantics',
      unknown.status === 404 && unknown.data.success === false
      && /not found/i.test(unknown.data.error || ''),
      `${unknown.status} ${JSON.stringify(unknown.data).slice(0, 160)}`);

    // F2-08 - the route must still hand back whatever the store reports, so a degraded/fixture backend
    // keeps its own dataSource/persisted semantics rather than being made to look durable.
    check('F2-08 the permitted-click response still carries the store\'s own dataSource and persisted fields',
      typeof first.data.dataSource === 'string' && typeof first.data.persisted === 'boolean',
      JSON.stringify({ dataSource: first.data.dataSource, persisted: first.data.persisted }));

    // F2-09 - clicks must not become an audit or financial side effect. In live mode this is measured with
    // SQL COUNT(*) on the isolated schema, because a PostgREST count can be capped by `max_rows` and pass
    // vacuously.
    if (REQUIRE_LIVE) {
      // Unknown ids must 404 without spending budget and without touching any row, and a legitimate click
      // taken after a stream of 404s must still be permitted and must move exactly one counter by exactly 1.
      const before = { audit: await sqlCount('audit_logs'), payouts: await sqlCount('driver_payouts'), ledger: await sqlCount('ledger_entries') };
      const b0 = await durableClicks(adB);
      for (const ghost of ['00000000-0000-0000-0000-000000000000', 'not-an-id', adB.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))]) {
        const g = await click(ghost);
        if (g.status !== 404) { failed++; console.log(`  ❌ F2-09a unknown ad did not 404: ${ghost} -> ${g.status}`); }
      }
      const bAfterGhosts = await durableClicks(adB);
      const realAfterGhosts = await click(adB);
      const b1 = await durableClicks(adB);
      const after = { audit: await sqlCount('audit_logs'), payouts: await sqlCount('driver_payouts'), ledger: await sqlCount('ledger_entries') };
      check('F2-09 unknown-ad 404s consume no click budget, write no row, and produce no audit/financial writes (SQL counts, not capped REST counts)',
        Number(bAfterGhosts) === Number(b0) && Number(b1) === Number(b0) + 1
        && realAfterGhosts.status === 200 && realAfterGhosts.data.persisted === true
        && after.audit === before.audit && after.payouts === before.payouts && after.ledger === before.ledger,
        JSON.stringify({ b0, bAfterGhosts, b1, realStatus: realAfterGhosts.status, before, after }));
    } else {
    process.env.PGSSLMODE = 'disable';
    const { supabaseAdmin } = require('./src/supabase');
    const auditBefore = await supabaseAdmin.from('audit_logs').select('id', { count: 'exact', head: true });
    const payoutBefore = await supabaseAdmin.from('driver_payouts').select('id', { count: 'exact', head: true });
    await click(adB);
    const auditAfter = await supabaseAdmin.from('audit_logs').select('id', { count: 'exact', head: true });
    const payoutAfter = await supabaseAdmin.from('driver_payouts').select('id', { count: 'exact', head: true });
    check('F2-09 clicking produces no audit or financial side effects',
      (auditAfter.count || 0) === (auditBefore.count || 0)
      && (payoutAfter.count || 0) === (payoutBefore.count || 0),
      `audit ${auditBefore.count}->${auditAfter.count}, payouts ${payoutBefore.count}->${payoutAfter.count}`);
  }

    // Cleanup accounting: permitted clicks move a durable counter that has no delete path over HTTP.
    const finalA = await clicksOf(adA);
    const finalB = await clicksOf(adB);
    const expectedDelta = Number(finalA) - Number(base0);
    console.log(`\n  note: permitted clicks advanced adA by ${expectedDelta} (<=${LIMIT}) and were also taken on adB;`
      + ' these are durable and cannot be reversed from the test - recorded as known residue.');
    cleanupFailures = (expectedDelta > LIMIT || expectedDelta < 0) ? 1 : 0;
    if (cleanupFailures) { failed++; console.log('  ❌ F2-10 more permitted clicks than the configured limit (bucket leak)'); }
    else console.log('  ✅ F2-10 permitted-click accounting stayed inside the configured limit');
  } catch (err) {
    failed++;
    console.log(`  ❌ unexpected error: ${err.message}`);
  } finally {
    if (pgClient) { try { await pgClient.end(); } catch (e) { /* closing must not mask a real failure */ } }
    // Killing the child is not the same as it having died. On Windows the backend can keep running for tens
    // of seconds after kill(), which made an isolated run look like it leaked. Wait for the real exit event
    // up to a bounded deadline, report which of the three outcomes happened, and fail the run on a genuine
    // leak so cleanup problems change the exit status instead of being noise.
    if (backend) {
      const exited = new Promise((resolve) => {
        backend.once('exit', () => resolve(true));
        backend.once('close', () => resolve(true));
      });
      const deadline = new Promise((resolve) => setTimeout(() => resolve(false), 25000));
      backend.kill();
      const gone = await Promise.race([exited, deadline]);
      if (gone) {
        console.log('  \u2705 teardown: spawned backend exited (CLEAN)');
      } else {
        console.log(`  \u274c teardown: backend pid ${backend.pid} STILL ALIVE 25s after kill() - LEAKED`);
        cleanupFailures++;
        failed++;
      }
    }
  }

  console.log(`\n${failed + cleanupFailures === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 || cleanupFailures > 0 ? 1 : 0);
})();
