// =========================================================================
// OUTAGE SEMANTICS AUDIT (LOCAL ONLY — it stops and starts the local database)
//
// Directive item 4 says an infrastructure failure must read as 5xx and a business
// refusal as 4xx, so that a client never reads an outage as a rejection of its own
// request. The campaign routes were fixed that way and proved it; this asks the
// same question of the rest of the API, because a `catch` block that answers 400
// whatever went wrong will tell an operator "your data is invalid" while the
// database is simply down — and then the client stops retrying and the work is lost.
//
// It signs in *before* the outage, because authentication itself now fails closed:
// a session taken from the store while it was healthy is what the routes under test
// get to keep, which is exactly the situation an operator is in when the database
// drops mid-shift.
//
// Every probe is compared against its own healthy response, which is what makes a
// 400 during an outage provably the server's rather than the caller's: a route that
// rejects the same body for the same reason while everything is up is a route that
// is doing validation correctly. So the bodies below are ones the API accepts.
//
// Writes that actually land while the store is healthy are undone before this exits,
// and the service switchboard is checked to prove nothing was left paused — this
// file must not leave the local database in a state that later suites trip over.
//
// Nothing here reaches a hosted environment: the "outage" is the local Docker
// container, and it is started again before this process exits.
// =========================================================================

const { execSync, spawnSync } = require('child_process');

const BASE_URL = process.env.NABIN_API_URL || 'http://127.0.0.1:4000';
const CONTAINER = process.env.NABIN_DB_CONTAINER || 'supabase_db_nabin';

const ADMIN_IDENTITY = { username: 'superadmin', password: 'AdminPassword123!' };
const CUSTOMER_PHONE = '9876543210';
// A driver that exists in the authoritative store, since login now fails closed
// rather than minting a session for an unenrolled number.
const DRIVER_PHONE = '9810122334';

// The coupon code is deliberately fixed. `POST /api/admin/promotions` upserts on
// `code`, so a unique code per run would add a row to the local database every time
// this runs; reusing one name keeps the fixture count flat. Nothing else in the
// suite uses this code, so there is no usage counter here to clobber.
const PROBE_COUPON_CODE = 'OSPROBE_OUTAGE_SEMANTICS';

async function call(method, urlPath, body = null, headers = {}) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { parsed = { raw: text } }
  return { status: res.status, body: parsed, text };
}

function dbIsUp() {
  const out = execSync(`docker inspect -f "{{.State.Running}}" ${CONTAINER}`).toString().trim();
  return out === 'true';
}

function setDb(running) {
  const action = running ? 'start' : 'stop';
  const res = spawnSync('docker', [action, CONTAINER], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`docker ${action} ${CONTAINER} failed: ${res.stderr || res.stdout}`);
  }
}

async function waitForDb(gone, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (dbIsUp() !== gone) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

// The probes. `expect` says what this audit treats as the honest answer while the
// store is down, per route rather than by one global rule, because "served from
// cache" is correct for a public feed and wrong for a coupon that has to exist:
//   read      — a read may answer 5xx, or 2xx from a cache that says so.
//   write     — a write that must reach PostgreSQL may answer 5xx; it may not claim
//               to have persisted, and a 4xx blaming the caller is the bug sought.
//   telemetry — accepted in memory by design and never contacts the store, so both
//               a 2xx and a 5xx are defensible here; it is reported, not judged.
//   info      — a dependency-status endpoint, whose whole job is to name the thing
//               that is down, so it is reported, not judged.
const PROBES = [
  { id: 'OS-01', label: 'admin reads the campaign list', method: 'GET', path: '/api/admin/campaigns', expect: 'read', actor: 'admin' },
  { id: 'OS-02', label: 'admin reads the coupon list', method: 'GET', path: '/api/admin/promotions', expect: 'read', actor: 'admin' },
  { id: 'OS-03', label: 'admin reads the audit trail', method: 'GET', path: '/api/admin/audit-logs?limit=5', expect: 'read', actor: 'admin' },
  { id: 'OS-04', label: 'admin reads the ledger', method: 'GET', path: '/api/admin/finance/ledger?limit=5', expect: 'read', actor: 'admin' },
  { id: 'OS-05', label: 'admin pauses the rides service', method: 'POST', path: '/api/admin/services/pause', expect: 'write', actor: 'admin',
    body: { serviceId: 'rides', reason: 'OUTAGE SEMANTICS AUDIT probe — restore immediately' }, undo: { path: '/api/admin/services/resume', body: { serviceId: 'rides', reason: 'OUTAGE SEMANTICS AUDIT probe cleanup' } } },
  { id: 'OS-06', label: 'admin publishes an advertisement', method: 'POST', path: '/api/admin/advertisements', expect: 'write', actor: 'admin',
    body: {
      title: 'OUTAGE SEMANTICS AUDIT probe campaign',
      placement: 'HOME_BANNER',
      imageUrl: 'https://nabin.example.com/ads/outage-probe.png',
      targetUrl: '/grocery',
      status: 'ACTIVE',
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-12-31T23:59:59.000Z'
    }, undoById: true },
  { id: 'OS-07', label: 'admin creates a coupon', method: 'POST', path: '/api/admin/promotions', expect: 'write', actor: 'admin',
    body: { code: PROBE_COUPON_CODE, name: 'Outage semantics probe coupon', discountType: 'PERCENTAGE', discountValue: 5, maxDiscount: 50, minOrderAmount: 0, eligibleService: 'ALL' } },
  { id: 'OS-08', label: 'customer home config feed', method: 'GET', path: '/api/app/config', expect: 'read', actor: 'none' },
  { id: 'OS-09', label: 'customer browse grocery products', method: 'GET', path: '/api/grocery/products', expect: 'read', actor: 'none' },
  { id: 'OS-10', label: 'driver sends a location fix', method: 'POST', path: '/api/driver/location', expect: 'telemetry', actor: 'driver',
    body: { lat: 28.61, lng: 77.23, speed: 0, isOnline: true } },
  { id: 'OS-11', label: 'public health check', method: 'GET', path: '/api/health', expect: 'info', actor: 'none' }
];

// Words that mean "this is the database talking, not the server explaining itself".
const ENGINE_TEXT = /invalid input syntax|violates unique constraint|null value in column|relation .* does not exist|permission denied for|syntax error at or near|PostgREST|Could not connect to .*54322|ECONNREFUSED|fetch failed|failed to contact database|getaddrinfo|connect ETIMEDOUT|Supabase|PGRST/i;

function verdictFor(probe, res, baseline) {
  if (probe.expect === 'info') {
    return { kind: 'report', note: `dependency-status endpoint answered ${res.status}: ${res.text.slice(0, 90)}` };
  }
  if (res.status === 0) {
    return { kind: 'fail', note: 'the request never got an answer at all — the server did not respond' };
  }
  if (res.status === 404 && !(baseline && baseline.status === 200)) {
    return { kind: 'probe-broken', note: 'route not present in this build, so this probe proves nothing — fix the probe' };
  }
  if (res.status === 401 || res.status === 403) {
    return { kind: 'report', note: `refused on credentials (${res.status}), not on the outage` };
  }
  if (res.status >= 500) {
    return { kind: 'pass', note: `5xx — the correct class: retryable, and not the caller's fault` };
  }
  if (res.status >= 200 && res.status < 300) {
    if (probe.expect === 'read') {
      return { kind: 'report', note: 'read answered 2xx while the store was down — check it says where the data came from' };
    }
    if (probe.expect === 'telemetry') {
      return { kind: 'report', note: 'telemetry accepted in memory by design; nothing was written to the store' };
    }
    const declared = res.body?.persisted === false || res.body?.degraded === true;
    return {
      kind: declared ? 'report' : 'fail',
      note: declared
        ? 'write answered 2xx but declares it did not persist — honest, and recorded as a design question'
        : 'a write claimed success with no declaration that the store was unreachable'
    };
  }
  // A 4xx: the only question is whether it is the caller's or the outage's. The
  // healthy baseline settles it — the same refusal before the outage is validation.
  if (baseline && baseline.status === res.status && baseline.body?.code === res.body?.code) {
    return { kind: 'pass', note: `identical refusal (${res.status} ${res.body?.code || '—'}) while healthy, so this one is the caller's own` };
  }
  const before = baseline ? `${baseline.status} ${baseline.body?.code || ''}`.trim() : 'n/a';
  return { kind: 'fail', note: `answered ${res.status} ${res.body?.code || ''}`.trim() + ` to an outage where healthy was ${before}` };
}

// Health is meant to name its dependencies, so the engine-word rule does not apply
// to it; everything else must translate a store failure into its own words.
function leaksEngineWords(probe, res) {
  if (probe.expect === 'info') return false;
  return ENGINE_TEXT.test(res.text);
}

async function captureBaseline(tokens) {
  // What these same probes answer while the database is healthy. The comparison is
  // what makes a 400 during an outage provably wrong rather than merely suspicious.
  const out = {};
  for (const probe of PROBES) {
    out[probe.id] = await call(probe.method, probe.path, probe.body, headersFor(probe, tokens));
  }
  return out;
}

function headersFor(probe, tokens) {
  const headers = {};
  if (probe.actor === 'admin' && tokens.admin) headers.Authorization = `Bearer ${tokens.admin}`;
  if (probe.actor === 'customer' && tokens.customer) headers.Authorization = `Bearer ${tokens.customer}`;
  if (probe.actor === 'driver' && tokens.driver) headers.Authorization = `Bearer ${tokens.driver}`;
  return headers;
}

async function signIn() {
  const admin = await call('POST', '/api/admin/login', ADMIN_IDENTITY);
  const customerSent = await call('POST', '/api/auth/send-otp', { phone: CUSTOMER_PHONE, role: 'CUSTOMER', purpose: 'LOGIN' });
  const customer = await call('POST', '/api/auth/verify-otp', {
    phone: CUSTOMER_PHONE, otp: customerSent.body?.testOtp || '7729', role: 'CUSTOMER'
  });
  const driverSent = await call('POST', '/api/auth/send-otp', { phone: DRIVER_PHONE, role: 'DRIVER', purpose: 'LOGIN' });
  const driver = await call('POST', '/api/auth/verify-otp', {
    phone: DRIVER_PHONE, otp: driverSent.body?.testOtp || '7729', role: 'DRIVER'
  });
  return {
    admin: admin.body?.token || null,
    customer: customer.body?.token || null,
    driver: driver.body?.token || null
  };
}

// Undo what the probes changed, so a run leaves the local database as it found it.
// Called both after the healthy baseline and again after the outage phase.
async function undoWrites(tokens, results) {
  for (const probe of PROBES) {
    if (!probe.undo && !probe.undoById) continue;
    if (probe.undo) {
      const res = await call('POST', probe.undo.path, probe.undo.body, headersFor(probe, tokens));
      if (res.status !== 200) console.log(`   ⚠️ cleanup ${probe.id} (${probe.undo.path}) answered ${res.status}`);
      continue;
    }
    // An advertisement created by the probe is deleted by the id it returned, when
    // it returned one; a write that failed during the outage has nothing to delete.
    const createdId = results?.[probe.id]?.body?.advertisement?.id;
    if (!createdId) continue;
    const res = await call('DELETE', `/api/admin/advertisements/${createdId}`, null, headersFor(probe, tokens));
    if (res.status !== 200) console.log(`   ⚠️ cleanup ${probe.id} DELETE /api/admin/advertisements answered ${res.status}`);
  }
}

async function assertNothingPaused() {
  const status = await call('GET', '/api/services/status');
  const services = status.body?.services || {};
  const paused = Object.entries(services).filter(([, s]) => {
    const state = typeof s === 'string' ? s : (s?.status || s?.state);
    return state && String(state).toUpperCase() !== 'ACTIVE' && String(state).toUpperCase() !== 'RUNNING';
  });
  return { paused: paused.map(([id]) => id), status: status.status };
}

async function main() {
  console.log('=======================================================================');
  console.log('🔌 NABIN OUTAGE SEMANTICS AUDIT — LOCAL DATABASE ONLY');
  console.log('=======================================================================');
  if (!dbIsUp()) {
    console.error(`❌ ${CONTAINER} is not running. This audit needs to start from a healthy database.`);
    process.exit(1);
  }

  const tokens = await signIn();
  if (!tokens.admin) {
    console.error('❌ Could not sign in as an administrator while healthy, so the admin probes would prove nothing.');
    process.exit(1);
  }
  if (!tokens.driver) console.log('⚠️ No driver session: the telemetry probe will show a credentials refusal, not an outage answer.');

  const baseline = await captureBaseline(tokens);
  const baselineBad = PROBES.filter(p => baseline[p.id].status >= 400);
  console.log(`✓ Baseline captured with the database up.`);
  for (const p of baselineBad) {
    console.log(`   note ${p.id} already refuses when healthy: ${baseline[p.id].status} ${baseline[p.id].body?.code || ''} ${JSON.stringify(baseline[p.id].body).slice(0, 90)}`);
  }
  await undoWrites(tokens, baseline);

  console.log(`\n⏹ Stopping ${CONTAINER}…`);
  setDb(false);
  if (!await waitForDb(true)) console.log('⚠️ container still reports running; probing anyway.');
  await new Promise(r => setTimeout(r, 3000));

  const rows = [];
  const outageResults = {};
  try {
    for (const probe of PROBES) {
      let res;
      try {
        res = await call(probe.method, probe.path, probe.body, headersFor(probe, tokens));
      } catch (err) {
        res = { status: 0, body: {}, text: `${err.name}: ${err.message}` };
      }
      outageResults[probe.id] = res;
      const verdict = verdictFor(probe, res, baseline[probe.id]);
      const leaked = leaksEngineWords(probe, res);
      rows.push({ probe, res, verdict, leaked, before: baseline[probe.id]?.status });
      const mark = verdict.kind === 'pass' ? '✅' : verdict.kind === 'fail' ? '❌' : 'ℹ️ ';
      console.log(
        `${mark} [${probe.id}] ${probe.label}\n` +
        `     healthy=${baseline[probe.id]?.status}  outage=${res.status}  code=${res.body?.code || '—'}  engine-text-in-body=${leaked}\n` +
        `     ${verdict.note}`
      );
    }
  } finally {
    console.log(`\n▶ Starting ${CONTAINER} again…`);
    setDb(true);
    console.log(await waitForDb(false) ? `✓ ${CONTAINER} is running.` : '⚠️ container did not report running — check it by hand.');
    await new Promise(r => setTimeout(r, 4000));
    console.log('▶ Restoring state the probes changed…');
    await undoWrites(tokens, { ...baseline, ...outageResults });
    const after = await assertNothingPaused();
    console.log(after.paused.length === 0
      ? `✓ Service switchboard clear — nothing left paused.`
      : `❌ Services still paused after cleanup: ${after.paused.join(', ')} — restore them before trusting any later suite.`);
    if (after.paused.length) rows.push({ probe: { id: 'OS-98', label: 'switchboard restored' }, verdict: { kind: 'fail', note: 'paused: ' + after.paused.join(',') }, res: { body: {} }, leaked: false });
  }

  const bad = rows.filter(r => r.verdict.kind === 'fail');
  const probesBroken = rows.filter(r => r.verdict.kind === 'probe-broken');
  const reported = rows.filter(r => r.verdict.kind === 'report');
  const leaked = rows.filter(r => r.leaked);
  console.log('\n=======================================================================');
  console.log(`📊 OUTAGE SEMANTICS: ${rows.length - bad.length} acceptable, ${bad.length} wrong, ${reported.length} to review, ${probesBroken.length} broken probes, ${leaked.length} leaking engine wording (Total: ${rows.length})`);
  for (const r of bad) console.log(`   WRONG      ${r.probe.id}: ${r.probe.label} → ${r.res.status} ${JSON.stringify(r.res.body).slice(0, 140)}`);
  for (const r of leaked) console.log(`   LEAKS WORDS ${r.probe.id}: ${r.probe.label} → ${JSON.stringify(r.res.body).slice(0, 140)}`);
  for (const r of reported) console.log(`   REVIEW     ${r.probe.id}: ${r.probe.label} → ${r.verdict.note}`);
  for (const r of probesBroken) console.log(`   BROKEN     ${r.probe.id}: ${r.probe.label} → ${r.res.status}`);
  console.log('=======================================================================\n');
  if (bad.length || leaked.length || probesBroken.length) process.exitCode = 1;
}

main().catch(err => {
  console.error('❌ Audit failed:', err);
  try { setDb(true); } catch (e) { console.error('And the database could not be restarted:', e.message); }
  process.exit(1);
});
