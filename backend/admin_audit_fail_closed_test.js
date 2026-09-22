// =========================================================================
// ADMIN MUTATIONS MUST NOT REPORT SUCCESS WITHOUT THEIR AUDIT RECORD
//
// §2.7 of docs/ADMIN_FEATURE_SPECIFICATION.md. Before this, 32 of the 42 audit writes in
// `database.js` were fired without awaiting, from methods that could not await because they
// were synchronous. A refused write therefore produced a `[audit] DROPPED TRAIL` line (A3)
// and nothing else: the route had already answered 200. An operator could not tell a
// complete trail from a missing one, which is the exact property area 31 asks for.
//
// `auditAppliedChange` is the fix: await the record of a change that has already landed,
// and if it cannot be written, answer 503 with `applied: true`. The state change is real at
// that point, so the message says "reconcile this", never "nothing happened" — a refusal
// shape would be a lie, and a retry after a real change can double-apply it.
//
// Three rules this file pins:
//   1. For every converted control-plane method: a refused trail rejects with the 503
//      shape, the mutation really did land, and a resolved trail returns normally.
//   2. Awaiting is only half of it. Express 4 does not forward a rejected async handler to
//      error middleware, so a converted method called from a route with no catch turns a
//      5xx-shaped outage into a request that never answers. Every such route is checked.
//   3. The financial and dispatch paths deliberately NOT converted stay unconverted: this
//      file asserts their shape too, so a later edit cannot quietly fail-close a wallet
//      adjustment whose retry key is derived from the clock.
//
// The audit store is replaced with one that refuses, in this process only. The accepting
// stub never contacts PostgreSQL, so no audit row is written by this file and nothing is
// left behind in the local database.
// =========================================================================

const fs = require('fs');
const path = require('path');
const db = require('./src/database');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const SRC = __dirname;
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

const realAuditRepo = db.auditLogRepo;
const realConsoleError = console.error;
let logged = [];
console.error = (...args) => { logged.push(args.map(String).join(' ')); };

function refuseStore() {
  db.auditLogRepo = {
    create: () => Promise.reject(new Error('simulated audit store refusal'))
  };
}

let accepted = [];
function acceptStore() {
  accepted = [];
  db.auditLogRepo = {
    create: async (entry) => {
      accepted.push(entry);
      return { id: `AUD-HARNESS-${accepted.length}`, action: entry.action };
    }
  };
  return () => accepted;
}

const HARNESS_ADMIN = { id: 'adm_failclosed_harness', name: 'Fail-Closed Harness', role: 'SUPER_ADMIN' };

// --- fixture handles, read from the same collections the methods mutate ---
const SERVICE_ID = 'rides';
const identityApp = db.identityApplications[0];
const restaurant = db.restaurants[0];
const groceryProduct = db.groceryProducts[0];

function snapshotServices() {
  const out = {};
  for (const [id, s] of Object.entries(db.platformServices)) out[id] = s.status;
  return out;
}
function restoreServices(snap) {
  for (const [id, status] of Object.entries(snap)) {
    const s = db.platformServices[id];
    if (s) { s.status = status; s.pausedAt = null; s.pausedBy = null; s.resumeAt = null; }
  }
}

const serviceSnap = snapshotServices();
const identitySnap = identityApp ? { ...identityApp } : null;
const identityUser = identityApp ? db.getUser(identityApp.userId) : null;
const identityUserSnap = identityUser ? { identityStatus: identityUser.identityStatus, accountStatus: identityUser.accountStatus } : null;
const restaurantSnap = restaurant ? { ...restaurant } : null;
const productSnap = groceryProduct ? { priceStatus: groceryProduct.priceStatus } : null;

function undoIdentityChange() {
  if (identityApp) Object.assign(identityApp, identitySnap);
  if (identityUser) Object.assign(identityUser, identityUserSnap);
}

// The advertisement cases need control over which branch runs, since this process has a
// live PostgreSQL client and a real insert here would add a campaign to the local database.
// `live` is a getter on the repository, so assigning to it is a silent no-op; the own
// property below shadows it and is removed again afterwards.
const realAdCreate = db.adRepo.createAdvertisement;

function setAdLive(value) {
  Object.defineProperty(db.adRepo, 'live', { configurable: true, get: () => value });
}
function clearAdLive() {
  delete db.adRepo.live;
}

function asLiveStoreReturning(result) {
  setAdLive(true);
  const calls = { create: 0 };
  db.adRepo.createAdvertisement = async () => { calls.create++; return result; };
  return calls;
}

function asMemoryStore() {
  setAdLive(false);
}

function restoreAdRepo() {
  clearAdLive();
  db.adRepo.createAdvertisement = realAdCreate;
}

const CASES = [
  {
    id: 'AF-01',
    label: 'pause the rides service (synchronous-path mutation, now awaited)',
    run: () => db.pauseService({ serviceId: SERVICE_ID, reason: 'Fail-closed harness — restore immediately', adminUser: HARNESS_ADMIN }),
    applied: () => db.getService(SERVICE_ID).status === 'PAUSED',
    undo: () => restoreServices(serviceSnap)
  },
  {
    id: 'AF-02',
    label: 'resume the rides service',
    setup: () => { db.getService(SERVICE_ID).status = 'PAUSED'; },
    run: () => db.resumeService({ serviceId: SERVICE_ID, reason: 'Fail-closed harness cleanup', adminUser: HARNESS_ADMIN }),
    applied: () => db.getService(SERVICE_ID).status === 'ACTIVE',
    undo: () => restoreServices(serviceSnap)
  },
  {
    id: 'AF-03',
    label: 'activate the emergency killswitch (every service, one trail)',
    run: () => db.pauseService({ serviceId: 'ALL', reason: 'Fail-closed harness — restore immediately', adminUser: HARNESS_ADMIN }),
    applied: () => Object.values(db.platformServices).every(s => s.status === 'PAUSED'),
    undo: () => restoreServices(serviceSnap)
  },
  {
    id: 'AF-04',
    label: 'claim an identity verification review lock',
    skip: !identityApp,
    run: () => db.lockIdentityApplication(identityApp.id, HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    applied: () => identityApp.lockedByAdminId === HARNESS_ADMIN.id,
    undo: undoIdentityChange
  },
  {
    id: 'AF-05',
    label: 'move an identity application to UNDER_REVIEW',
    skip: !identityApp,
    run: () => db.reviewIdentityApplication(identityApp.id, 'MARK_UNDER_REVIEW', 'Fail-closed harness probe', null, HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    applied: () => identityApp.status === 'UNDER_REVIEW' && identityUser && identityUser.accountStatus === 'UNDER_REVIEW',
    undo: undoIdentityChange
  },
  {
    id: 'AF-06',
    label: 'suspend a restaurant',
    skip: !restaurant,
    run: () => db.setRestaurantStatus(restaurant.id, 'SUSPENDED', 'Fail-closed harness probe', HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    applied: () => restaurant.operationalStatus === 'SUSPENDED' && restaurant.isOpen === false,
    undo: () => Object.assign(restaurant, restaurantSnap)
  },
  {
    id: 'AF-07',
    label: 'freeze a grocery price',
    skip: !groceryProduct,
    run: () => db.adminReviewPrice({ productId: groceryProduct.id, action: 'FREEZE', reason: 'Fail-closed harness probe', adminUser: HARNESS_ADMIN }),
    applied: () => groceryProduct.priceStatus === 'FROZEN',
    undo: () => Object.assign(groceryProduct, productSnap)
  },
  {
    id: 'AF-08',
    label: 'publish a campaign that PostgreSQL accepted (no second copy in memory)',
    setup: () => {
      CASES._adCalls = asLiveStoreReturning({
        id: 'ad_failclosed_probe',
        title: 'Fail-closed harness campaign',
        placement: 'HOME_BANNER',
        status: 'ACTIVE'
      });
      CASES._adsBefore = db.advertisements.length;
    },
    run: () => db.createAdvertisement({
      title: 'Fail-closed harness campaign',
      placement: 'HOME_BANNER',
      imageUrl: 'https://nabin.example.com/ads/harness.png',
      targetUrl: '/grocery',
      status: 'ACTIVE'
    }, HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    // The store-side stub stands for the row that really went in. What must be true is that
    // a refused trail does NOT fall through to the memory branch, which would create a
    // second campaign with the same content and write a second trail for it.
    applied: () => CASES._adCalls.create === 1 && db.advertisements.length === CASES._adsBefore,
    undo: () => { restoreAdRepo(); db.advertisements.length = CASES._adsBefore; }
  },
  {
    id: 'AF-09',
    label: 'publish a campaign in the offline fallback (memory holds it, trail refused)',
    setup: () => { asMemoryStore(); CASES._adsBefore = db.advertisements.length; },
    run: () => db.createAdvertisement({
      title: 'Fail-closed harness offline campaign',
      placement: 'HOME_BANNER',
      imageUrl: 'https://nabin.example.com/ads/harness.png',
      targetUrl: '/grocery',
      status: 'ACTIVE'
    }, HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    applied: () => db.advertisements.length === CASES._adsBefore + 1,
    undo: () => { db.advertisements.splice(0, db.advertisements.length - CASES._adsBefore); restoreAdRepo(); }
  },
  {
    id: 'AF-10',
    label: 'delete a campaign in the offline fallback (it is gone, trail refused)',
    skip: !db.advertisements.length,
    setup: () => { asMemoryStore(); CASES._victim = db.advertisements[0]; CASES._adsBefore = db.advertisements.length; },
    run: () => db.deleteAdvertisement(CASES._victim.id, HARNESS_ADMIN.id, HARNESS_ADMIN.name),
    applied: () => db.advertisements.indexOf(CASES._victim) === -1,
    undo: () => {
      if (db.advertisements.indexOf(CASES._victim) === -1) db.advertisements.unshift(CASES._victim);
      restoreAdRepo();
    }
  }
];

function describeError(err) {
  if (!err) return 'no rejection at all — the call answered as if the trail had landed';
  return `code=${err.code || '—'} status=${err.status} statusCode=${err.statusCode} applied=${err.applied} cause=${err.cause}`;
}

async function runCase(c) {
  if (c.skip) {
    console.log(`⏭️  [${c.id}] skipped: ${c.skip === true ? 'no fixture for this case' : c.skip}`);
    return;
  }
  // Refused trail.
  logged = [];
  if (c.setup) c.setup();
  refuseStore();
  let err = null;
  try {
    await c.run();
  } catch (e) {
    err = e;
  }
  const shapeOk = Boolean(err) && err.code === 'AUDIT_RECORD_UNAVAILABLE' && err.status === 503 &&
    err.statusCode === 503 && err.applied === true && /simulated audit store refusal/.test(String(err.cause));
  check(`${c.id}-a`, shapeOk, `${c.label} → refusing store rejects with the fail-closed shape (${describeError(err)})`);
  check(`${c.id}-b`, Boolean(err) && /was applied/.test(err.message) && /reconciled/.test(err.message) &&
    !/was not applied|did not apply|nothing changed/i.test(err.message),
    'the message names the change as applied and asks for reconciliation, never as refused');
  check(`${c.id}-c`, Boolean(err) && !/simulated audit store refusal/.test(err.message) &&
    /simulated audit store refusal/.test(String(err.cause)),
    'the client-facing message carries no store wording; the reason stays in cause for the log');
  check(`${c.id}-d`, c.applied(), `the state really did change, so "the action failed" would be a false claim`);
  check(`${c.id}-e`, logged.some(l => l.includes('DROPPED TRAIL')), `A3's report still fires alongside the propagated failure (${logged.length} console line(s))`);
  if (c.undo) c.undo();

  // Accepted trail.
  logged = [];
  const collect = acceptStore();
  if (c.setup) c.setup();
  let err2 = null;
  let value2 = null;
  try {
    value2 = await c.run();
  } catch (e) {
    err2 = e;
  }
  check(`${c.id}-f`, !err2 && collect().length >= 1, `an accepting store lets the same call resolve and write its trail (${err2 ? describeError(err2) : `${collect().length} write(s)`})`);
  check(`${c.id}-g`, logged.length === 0 && collect().length <= 1, `a landed write reports no drop and produces exactly one trail`);
  if (c.undo) c.undo();
  restoreStoreToNeutral();
}

// Between cases: a store that accepts, so nothing a later case does can reach PostgreSQL.
function restoreStoreToNeutral() {
  acceptStore();
}

// --- static sections -------------------------------------------------------

function readSources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(SRC, 'src'));
  return files.map(f => ({ file: f, text: fs.readFileSync(f, 'utf8') }));
}

const ROUTE_RE = /^app\.(get|post|put|delete|patch)\(\s*(\[?['"`])([^'"`\[]*)/;

// Every handler in server.js, as { verb, path, start, end, text }.
function handlers(serverText) {
  const lines = serverText.split('\n');
  const marks = [];
  lines.forEach((l, i) => {
    const m = l.match(ROUTE_RE);
    if (m) marks.push({ i, verb: m[1], path: m[3] });
  });
  return marks.map((mk, idx) => {
    const end = idx + 1 < marks.length ? marks[idx + 1].i : lines.length;
    return { ...mk, end, text: lines.slice(mk.i, end).join('\n'), line: mk.i + 1 };
  });
}

// Calls that can now reject because their audit record is awaited. A route that makes one
// of these must answer the failure, not hang and not blame the caller.
const FAIL_CLOSED_CALLS = [
  'db.pauseService', 'db.resumeService', 'db.persistServiceState', 'db.setDriverStatus',
  'db.setRestaurantStatus', 'db.lockIdentityApplication', 'db.reviewIdentityApplication',
  'db.adminReviewPrice', 'db.createAdvertisement', 'db.updateAdvertisement', 'db.deleteAdvertisement',
  'db.supportTicketRepo.assignTicket', 'db.supportTicketRepo.resolveTicket',
  'db.driverRepo.verifyPayoutDestination', 'db.auditAppliedChange'
];

function staticChecks(sources) {
  const serverText = sources.find(s => s.file.endsWith(path.join('src', 'server.js'))).text;

  // ST-01/02 — nothing may fire the fail-closed helper without awaiting it. A bare call
  // would restore the exact hole this change closes.
  const unawaited = [];
  let total = 0;
  for (const s of sources) {
    const lines = s.text.split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('auditAppliedChange(')) return;
      if (/^\s*(async )?auditAppliedChange\(entry\)/.test(line)) return; // the definition
      total += 1;
      if (!/\bawait\b/.test(line)) {
        unawaited.push(`${path.relative(SRC, s.file)}:${i + 1}`);
      }
    });
  }
  check('ST-01', unawaited.length === 0, `no un-awaited auditAppliedChange call anywhere in src/ (${unawaited.join(', ') || 'none'})`);
  check('ST-02', total >= 20, `${total} auditAppliedChange call sites in src/ — this file's cases must keep covering the control-plane ones`);

  // ST-03 — every route that can now reject answers its own failure.
  const hs = handlers(serverText);
  const offenders = [];
  let bearing = 0;
  for (const h of hs) {
    const callsIt = FAIL_CLOSED_CALLS.filter(c => h.text.includes(`${c}(`));
    if (!callsIt.length) continue;
    bearing += callsIt.length;
    const allAwaited = callsIt.every(c => h.text.includes(`await ${c}(`));
    const catches = /\bcatch\s*\(/.test(h.text);
    const honorsStatus = /\b\w*(?:err|error)\w*\.(?:status|statusCode)\b/i.test(h.text);
    if (!allAwaited || !catches || !honorsStatus) {
      offenders.push(`${h.verb.toUpperCase()} ${h.path} (line ${h.line}) awaited=${allAwaited} catch=${catches} status=${honorsStatus}`);
    }
  }
  check('ST-03', offenders.length === 0, `every route that awaits a fail-closed call answers it with its own status (checked ${bearing} call sites across ${hs.length} handlers; offenders: ${offenders.join('; ') || 'none'})`);

  // ST-04 — the inventory of async handlers with an await and no catch, so the remaining
  // hang risks are counted rather than guessed. Four are left: the driver payout-destination
  // request, the two public restaurant reads and the supabase-status probe. None of them
  // awaits an audit write, so the number may only go down from here.
  const naked = hs.filter(h =>
    /async\s*\(/.test(h.text.split('\n').slice(0, 3).join('\n')) &&
    /\bawait\b/.test(h.text) &&
    !/\bcatch\s*\(/.test(h.text) &&
    !/\.next\s*\(/.test(h.text)
  );
  check('ST-04', naked.length <= 4, `async handlers that await with no catch left standing: ${naked.length} (${naked.map(h => `${h.verb} ${h.path}:${h.line}`).join(', ')})`);

  // ST-05/06 — the paths deliberately NOT failed closed stay as they were. A wallet
  // adjustment's idempotency key ends in Date.now(), so a 503 that invites a retry would
  // move the money twice; the six payment-repository trails are fire-and-forget on purpose.
  const pay = sources.find(s => s.file.endsWith(path.join('repositories', 'PaymentRepository.js'))).text;
  const payWrites = (pay.match(/this\.db\.createAuditLog\(/g) || []).length;
  const payAwaited = (pay.match(/await\s+this\.db\.createAuditLog\(/g) || []).length;
  check('ST-05', payWrites === 6 && payAwaited === 0, `PaymentRepository still holds ${payWrites} un-awaited trail writes (${payAwaited} awaited) — untouched by this change, still reported by A3`);
  const dbText = sources.find(s => s.file.endsWith(path.join('src', 'database.js'))).text;
  const adj = /const idempotencyKey = `admin_adj_\$\{targetType\}_\$\{targetId\}_\$\{direction\}_\$\{amt\}_\$\{Date\.now\(\)\}`/.test(dbText);
  check('ST-06', adj && !/async processFinancialAdjustment[\s\S]{0,4000}?await this\.auditAppliedChange\(/.test(dbText),
    `processFinancialAdjustment is still un-awaited while its key is clock-derived (${adj ? 'Date.now() key confirmed' : 'key shape changed — re-read this'})`);
}

async function main() {
  console.log('=======================================================================');
  console.log('🧯 NABIN ADMIN AUDIT FAIL-CLOSED HARNESS (in-process, store replaced)');
  console.log('=======================================================================');
  acceptStore();

  for (const c of CASES) await runCase(c);

  // The helper's own contract, once more directly: an accepting store returns normally and
  // a refusing one carries `cause` so the operator can see why without the engine text
  // reaching the client.
  logged = [];
  refuseStore();
  let helperErr = null;
  try {
    await db.auditAppliedChange({ module: 'HARNESS', action: 'HELPER_CONTRACT', targetEntityType: 'PROBE', targetEntityId: 'AF-11' });
  } catch (e) { helperErr = e; }
  check('AF-11-a', Boolean(helperErr) && helperErr.status === 503 && helperErr.statusCode === 503 &&
    helperErr.code === 'AUDIT_RECORD_UNAVAILABLE' && helperErr.applied === true,
    `the helper sets both status spellings, because admin catches read err.status and repository catches read err.statusCode (${describeError(helperErr)})`);
  check('AF-11-b', /HARNESS\/HELPER_CONTRACT/.test(helperErr.message), 'the rejection names the module and action it belongs to');
  restoreStoreToNeutral();

  staticChecks(readSources());

  check('AF-99', unhandled.length === 0, `no rejection escaped into the process net (${unhandled.length})`);

  db.auditLogRepo = realAuditRepo;
  restoreAdRepo();
  restoreServices(serviceSnap);
  undoIdentityChange();
  if (restaurant) Object.assign(restaurant, restaurantSnap);
  if (groceryProduct) groceryProduct.priceStatus = productSnap.priceStatus;
  console.error = realConsoleError;

  const failed = results.filter(r => !r.ok);
  console.log('\n=======================================================================');
  console.log(`📊 AUDIT FAIL-CLOSED: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  for (const f of failed) console.log(`   FAILED ${f.id}: ${f.detail}`);
  console.log('=======================================================================\n');
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error = realConsoleError;
  db.auditLogRepo = realAuditRepo;
  restoreAdRepo();
  restoreServices(serviceSnap);
  console.error('❌ [AF-98] harness threw:', err);
  process.exitCode = 1;
});
