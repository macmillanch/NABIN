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
// Five rules this file pins:
//   1. For every converted control-plane method: a refused trail rejects with the 503
//      shape, the mutation really did land, and a resolved trail returns normally.
//   2. Awaiting is only half of it. Express 4 does not forward a rejected async handler to
//      error middleware, so a converted method called from a route with no catch turns a
//      5xx-shaped outage into a request that never answers. Every such route is checked.
//   3. The financial and dispatch paths deliberately NOT converted stay unconverted: this
//      file asserts their shape too, so a later edit cannot quietly fail-close a wallet
//      adjustment whose retry key is derived from the clock.
//   4. AF-12..AF-19 — the read side. Decision 6 of docs/OWNER_SECURITY_DECISIONS.md chose
//      option B: the in-memory audit mirror may answer while the trail cannot be reached,
//      but only labelled degraded/stale and with a `total` that is not the length of a
//      window. A marker has to be derived from what boot recorded, and the two routes'
//      differing status codes are a recorded owner question, so they are pinned as they are.
//   5. AR-01..AR-08 — the input side of the same rule. `adminReviewPrice` implemented three
//      actions and accepted any other word as if it were one of them, so a request that
//      changed nothing still produced a durable trail naming it. An action that did not
//      happen may not be recorded as if it had.
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
  // Normalize line endings at the single read point so every downstream assertion (the `\n  \}\n`
  // method-body captures in ST-06/ST-07, the `.split('\n')` handler walks, the `.includes` guards)
  // behaves identically on an LF worktree and a CRLF `git archive` checkout under core.autocrlf.
  // In-memory only: no committed file changes and no repo-wide line-ending churn.
  return files.map(f => ({ file: f, text: fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') }));
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

  // ST-05/06 — the paths deliberately NOT failed closed. ST-05 still stands as written: the
  // six payment-repository trails are fire-and-forget on purpose. ST-06 no longer belongs to
  // that pairing, and is explained where it runs.
  const pay = sources.find(s => s.file.endsWith(path.join('repositories', 'PaymentRepository.js'))).text;
  const payWrites = (pay.match(/this\.db\.createAuditLog\(/g) || []).length;
  const payAwaited = (pay.match(/await\s+this\.db\.createAuditLog\(/g) || []).length;
  check('ST-05', payWrites === 6 && payAwaited === 0, `PaymentRepository still holds ${payWrites} un-awaited trail writes (${payAwaited} awaited) — untouched by this change, still reported by A3`);
  // ST-06 — rewritten by PHASE 13, because it had stopped testing what mattered.
  //
  // It used to assert the opposite condition: that `processFinancialAdjustment` stayed
  // un-awaited *while* its idempotency key ended in Date.now(). Those two facts were one
  // decision, not two bugs — a 503 on the audit write invites the operator to retry, and with
  // a clock-derived key a retry moves the money a second time. Leaving the trail un-awaited was
  // the safer half of that pairing.
  //
  // Phase 13 replaced the clock with a stable, account-scoped operation identity, so the
  // premise is gone and the check would have kept green only by describing a world that no
  // longer exists. It now pins the invariant itself, and does so more strictly than before:
  // any `Date.now()` anywhere near either money identity fails it, and it covers the payout as
  // well as the adjustment. The un-awaited audit write is left as it is — with a stable key it
  // can now be awaited safely, but that is a separate change, not this one.
  const dbText = sources.find(s => s.file.endsWith(path.join('src', 'database.js'))).text;
  const adjBody = (dbText.match(/async processFinancialAdjustment\([\s\S]*?\n  \}\n/) || [''])[0];
  const payBody = (dbText.match(/async recordPayout\([\s\S]*?\n  \}\n/) || [''])[0];
  // Only the assignment of the identity itself. A window around it would flag unrelated
  // display identifiers such as `TXN-ADJ-${Date.now()...}`, which name a row in a list and
  // have nothing to do with whether a retry moves money twice.
  const assignOf = (body, name) => (body.match(new RegExp(`(?:const|let)\\s+${name}\\s*=[^\\n]*`, 'g')) || []);
  const adjAssign = assignOf(adjBody, 'idempotencyKey');
  const payAssign = assignOf(payBody, 'payoutKey');
  const adjClock = adjAssign.some((line) => /Date\.now\(\)/.test(line));
  const payClock = payAssign.some((line) => /Date\.now\(\)/.test(line));
  const adjIdentity = /operationKey\(/.test(adjBody);
  const payIdentity = /operationKey\(/.test(payBody);
  check('ST-06',
    adjBody.length > 0 && payBody.length > 0 && adjAssign.length > 0 && payAssign.length > 0
    && !adjClock && !payClock && adjIdentity && payIdentity,
    `neither money identity may be derived from the clock (identities found: adjustment=${adjAssign.length}, payout=${payAssign.length}; `
    + `clock in identity: adjustment=${adjClock}, payout=${payClock}; stable identity used: adjustment=${adjIdentity}, payout=${payIdentity})`);

  // ST-07 — the shape of the AR guard, not just its current verdict. The refusal has to sit
  // ahead of the first write, because a guard that runs after the trail was written is
  // decoration: the row is already durable and the operator has already been answered. Same
  // reason rule 1 gives for the store side ("a refusal that runs after the write is not a
  // refusal"), applied to the input.
  const reviewBody = (dbText.match(/async adminReviewPrice\([\s\S]*?\n  \}\n/) || [''])[0];
  const guardAt = reviewBody.indexOf('GROCERY_PRICE_REVIEW_ACTION_INVALID');
  const firstMutation = reviewBody.search(/product\.priceStatus\s*=/);
  const trailAt = reviewBody.indexOf('auditAppliedChange(');
  check('ST-07', reviewBody.length > 0 && guardAt !== -1 && firstMutation !== -1 && trailAt !== -1
      && guardAt < firstMutation && guardAt < trailAt,
    `the action guard runs before adminReviewPrice mutates state or writes its trail (guard@${guardAt}, first priceStatus write@${firstMutation}, trail@${trailAt})`);
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

  // --- AR-01..AR-08: the input side — an action that did not happen may not be recorded ---
  //
  // `adminReviewPrice` has three branches: FREEZE, UNFREEZE and CORRECT-with-a-price. Every
  // other `action` value fell through all three, so the method wrote a durable
  // `ADMIN_PRICE_<whatever the caller sent>` trail for a change that never took place and the
  // route answered `{ success: true, product }`. `CORRECT` with no `newPrice` fell through the
  // same way. The admin was told the review happened, and the audit trail agreed with it.
  //
  // Two precedents already in this file and one in the pricing path rule the fix: rule 1 above
  // says a mutation must not report success without its trail, and the mirror of that is that a
  // non-mutation must not produce one; `reviewIdentityApplication` refuses an unknown decision
  // on the merits rather than falling through; DECISION C1 (`grocery_reference_and_degraded_
  // pricing_test.js`) states the outcome shape — "no state and no audit record are produced".
  //
  // The store here is the accepting stub, so a fall-through row is captured in `accepted`
  // instead of reaching PostgreSQL. This group proves the record is absent and leaves none.
  if (groceryProduct) {
    const statusBefore = groceryProduct.priceStatus;

    let collect = acceptStore();
    let arErr = null;
    let arValue;
    try {
      arValue = await db.adminReviewPrice({
        productId: groceryProduct.id, action: 'APPROVE', reason: 'AR probe', adminUser: HARNESS_ADMIN
      });
    } catch (e) { arErr = e; }
    check('AR-01', Boolean(arErr) && arErr.code === 'GROCERY_PRICE_REVIEW_ACTION_INVALID'
      && arErr.status === 400 && arErr.applied !== true,
      `an action this method does not implement refuses instead of answering success (${describeError(arErr)})`);
    check('AR-02', collect().length === 0,
      `nothing was written to the trail for it (${collect().length} write(s); before the guard this was a durable ADMIN_PRICE_APPROVE row for an action that changed nothing)`);
    check('AR-03', arValue === undefined && groceryProduct.priceStatus === statusBefore,
      `no product was handed back and the price status is untouched (returned=${JSON.stringify(arValue)}, priceStatus=${groceryProduct.priceStatus})`);
    const reflected = Boolean(arErr) && String(arErr.message).includes('APPROVE');
    check('AR-04', Boolean(arErr) && !reflected,
      `the client-facing message names the allowed actions without echoing the caller's own string back ("${arErr ? arErr.message : 'no rejection'}")`);

    // A missing action is the same fall-through, and used to mint `ADMIN_PRICE_UNDEFINED`.
    collect = acceptStore();
    let arMissing = null;
    try {
      await db.adminReviewPrice({ productId: groceryProduct.id, reason: 'AR probe', adminUser: HARNESS_ADMIN });
    } catch (e) { arMissing = e; }
    check('AR-05', Boolean(arMissing) && arMissing.code === 'GROCERY_PRICE_REVIEW_ACTION_INVALID' && collect().length === 0,
      `an absent action refuses with the same code and leaves no ADMIN_PRICE_UNDEFINED trail (${describeError(arMissing)}, ${collect().length} write(s))`);

    // A lower-case word is a malformed client, not a freeze. Silently answering 200 for it
    // was the failure; the refusal is the truth, and it says which word was wanted.
    collect = acceptStore();
    let arCase = null;
    try {
      await db.adminReviewPrice({ productId: groceryProduct.id, action: 'freeze', reason: 'AR probe', adminUser: HARNESS_ADMIN });
    } catch (e) { arCase = e; }
    check('AR-06', Boolean(arCase) && arCase.code === 'GROCERY_PRICE_REVIEW_ACTION_INVALID' && collect().length === 0
      && groceryProduct.priceStatus === statusBefore,
      `"freeze" is refused as an unknown action rather than reported as a freeze that never froze (${describeError(arCase)}, priceStatus=${groceryProduct.priceStatus})`);

    // CORRECT with no price to correct: the branch condition was `action === 'CORRECT' &&
    // newPrice`, so the request skipped every write, was audited as ADMIN_PRICE_CORRECT and
    // answered 200 — the sharpest form of the defect, because the action name is legitimate.
    collect = acceptStore();
    let arCorrect = null;
    let arCorrectValue;
    try {
      arCorrectValue = await db.adminReviewPrice({
        productId: groceryProduct.id, action: 'CORRECT', reason: 'AR probe', adminUser: HARNESS_ADMIN
      });
    } catch (e) { arCorrect = e; }
    check('AR-07', Boolean(arCorrect) && arCorrect.code === 'GROCERY_PRICE_REVIEW_CORRECT_PRICE_REQUIRED'
      && arCorrect.status === 400 && collect().length === 0 && arCorrectValue === undefined,
      `CORRECT with no newPrice refuses instead of being audited as a correction (${describeError(arCorrect)}, ${collect().length} write(s), returned=${JSON.stringify(arCorrectValue)})`);

    // The guard must not cost the admin the actions that do work — AF-07 covers the refused-
    // trail shape of FREEZE; this is its accepted-trail half over the same fixture.
    collect = acceptStore();
    let arFreezeErr = null;
    let arFrozen = null;
    try {
      arFrozen = await db.adminReviewPrice({
        productId: groceryProduct.id, action: 'FREEZE', reason: 'AR probe', adminUser: HARNESS_ADMIN
      });
    } catch (e) { arFreezeErr = e; }
    check('AR-08', !arFreezeErr && arFrozen && arFrozen.priceStatus === 'FROZEN' && collect().length === 1,
      `FREEZE still lands and still writes exactly one trail (${describeError(arFreezeErr)}, priceStatus=${arFrozen && arFrozen.priceStatus}, ${collect().length} write(s))`);
    groceryProduct.priceStatus = statusBefore;
    restoreStoreToNeutral();
  } else {
    console.log('⏭️  AR group skipped: no grocery price fixture in this process');
  }

  // --- AF-12..AF-19: the read side of Decision 6 B --------------------------
  //
  // Everything above is a write that must not report success without its trail. This group is
  // its mirror image: a read that must not report a page as if it were the trail.
  //
  // `docs/OWNER_SECURITY_DECISIONS.md` Decision 2 chose B — an outage may be answered from
  // this process's audit copy, but only with an explicit degraded/stale marker. A marker is
  // only worth having if it is derived from facts the process recorded, so this group pins
  // the derivation: what boot wrote into `db.auditMirror` decides the labels a reader gets,
  // and `total` stays unknown when the only number available is the length of a window.
  //
  // The branch is steered by shadowing the repository's own `live`/`client` getters with
  // instance properties — the same technique `setAdLive` uses above, for the same reason
  // (`live` is a prototype getter, so assigning to it is a silent no-op). `client` is
  // injected too, so a live-branch case never contacts the store: no read, no write, no
  // residue. Cases that need a `live` answer use a fake client that refuses.
  const auditRepo = realAuditRepo;

  function shadowAuditBranch({ live, client }, fn) {
    const ownsClient = client !== undefined;
    Object.defineProperty(auditRepo, 'live', { configurable: true, get: () => live });
    if (ownsClient) Object.defineProperty(auditRepo, 'client', { configurable: true, get: () => client });
    return (async () => {
      try { return await fn(); } finally {
        delete auditRepo.live;
        if (ownsClient) delete auditRepo.client;
      }
    })();
  }

  // A client shaped like the PostgREST builder: every method chains, and awaiting the last
  // one hands back a refusal instead of rows.
  function refusingClient(message, { insert = false } = {}) {
    const refused = { data: null, count: null, error: { message } };
    const b = {
      select: () => b, eq: () => b, or: () => b, order: () => b, range: () => b,
      insert: () => b, upsert: () => b,
      single: () => Promise.resolve(insert ? refused : { data: null, error: refused.error }),
      then: (resolve) => Promise.resolve(refused).then(resolve)
    };
    return { from: () => b };
  }

  const mirrorSnap = db.auditMirror;
  const mirrorRowsSnap = Array.isArray(db.auditLogs) ? db.auditLogs.length : 0;
  const hydratedAt = '2026-10-10T00:00:00.000Z';
  const storeWindow = {
    source: 'postgres', limit: 200, readAt: hydratedAt, windowRows: 200,
    storeRows: 225571, complete: false, error: 'the mirror holds the newest 200 of 225571 rows'
  };

  // AF-12 — no store attached at all. The array is everything there is, so its length may be
  // reported as a total, but the answer still cannot be called the durable trail.
  db.auditMirror = { source: 'memory', limit: null, readAt: null, windowRows: mirrorRowsSnap, storeRows: null, complete: true, error: null };
  const memRead = await shadowAuditBranch({ live: false }, () => auditRepo.list({ limit: 5 }));
  check('AF-12', memRead.dataSource === 'memory' && memRead.degraded === false && memRead.stale === false
      && memRead.totalIsExact === true && memRead.total === memRead.mirroredRows
      && /no PostgreSQL audit store is attached/.test(memRead.notice),
    `a process with no audit store labels itself as memory without claiming to be stale: source=${memRead.dataSource}, degraded=${memRead.degraded}, total=${memRead.total}/${memRead.mirroredRows}, notice="${memRead.notice}"`);

  // AF-13 — a store window is what's being served, so the trail's size is not the page's size.
  db.auditMirror = { ...storeWindow };
  const mirrorRead = await shadowAuditBranch({ live: false }, () => auditRepo.list({ limit: 5 }));
  check('AF-13-a', mirrorRead.dataSource === 'memory' && mirrorRead.degraded === true && mirrorRead.stale === true
      && mirrorRead.totalIsExact === false && mirrorRead.total === null,
    `a mirror hydrated from the store is served labelled, and its length is never presented as the trail's size: source=${mirrorRead.dataSource}, degraded=${mirrorRead.degraded}, stale=${mirrorRead.stale}, total=${JSON.stringify(mirrorRead.total)}`);
  check('AF-13-b', mirrorRead.storeRows === storeWindow.storeRows && mirrorRead.mirroredRows === db.auditLogs.length
      && mirrorRead.hydrationLimit === 200 && mirrorRead.hydratedAt === hydratedAt,
    `every number behind the label is the one boot recorded: storeRows=${mirrorRead.storeRows}, mirroredRows=${mirrorRead.mirroredRows}, hydrationLimit=${mirrorRead.hydrationLimit}, hydratedAt=${mirrorRead.hydratedAt}`);
  check('AF-13-c', /in-memory audit mirror/.test(mirrorRead.notice) && /Absence is not evidence/.test(mirrorRead.notice),
    `the notice says what the page cannot support: "${mirrorRead.notice}"`);

  // AF-14 — the count was refused, so the size is unknown. Guessing it from the rows present
  // is the failure mode Decision 2 was ruling on, so this is the sharpest check in the group.
  db.auditMirror = { source: 'postgres', limit: 200, readAt: hydratedAt, windowRows: 200, storeRows: null, complete: false, error: null };
  const blindRead = await shadowAuditBranch({ live: false }, () => auditRepo.list({ limit: 5 }));
  check('AF-14', blindRead.total === null && blindRead.storeRows === null && blindRead.degraded === true
      && blindRead.stale === true && blindRead.logs.length > 0,
    `an unknown store size stays unknown rather than becoming the length of this page: total=${JSON.stringify(blindRead.total)}, storeRows=${JSON.stringify(blindRead.storeRows)}, rows handed back=${blindRead.logs.length}`);

  // AF-15 — the live branch refusing is a refusal, not a silent demotion to the mirror.
  // Decision 2 permits the copy to answer when the trail cannot be reached; it does not
  // permit a route that asked the trail to answer from the copy without saying so. R1/R2
  // answer that case with a status code, and the repository's job is to let them.
  let outageErr = null;
  try {
    await shadowAuditBranch({ live: true, client: refusingClient('simulated trail outage') }, () => auditRepo.list({ limit: 5 }));
  } catch (e) { outageErr = e; }
  check('AF-15', Boolean(outageErr) && /Failed to query audit logs/.test(outageErr.message),
    `a live read that the store refuses rejects instead of answering with mirror rows (${outageErr ? outageErr.message : 'no rejection — the refusal was swallowed'})`);

  // AF-16 — filters still bind during an outage. An investigator narrowing by application must
  // not be shown the newest window and told it is that application's trail.
  const PROBE_TARGET = 'APP-FAILCLOSED-PROBE';
  db.auditMirror = { ...storeWindow };
  db.auditLogs.push({ id: 'AUD-HARNESS-READ-PROBE', timestamp: new Date().toISOString(), module: 'IDENTITY', action: 'PROBE', targetEntityId: PROBE_TARGET, targetEntityType: 'IDENTITY_APPLICATION' });
  const filtered = await shadowAuditBranch({ live: false }, () => auditRepo.list({ applicationId: PROBE_TARGET, limit: 50 }));
  const allMatch = filtered.logs.length === 1 && filtered.logs[0].targetEntityId === PROBE_TARGET;
  db.auditLogs.splice(db.auditLogs.findIndex(a => a.id === 'AUD-HARNESS-READ-PROBE'), 1);
  check('AF-16', allMatch && filtered.degraded === true && filtered.dataSource === 'memory',
    `a filtered outage read returns only matching rows (${filtered.logs.length}) and is still labelled degraded=${filtered.degraded}`);

  // AF-17 — a refused store write must not enter the mirror. If it did, the copy would record
  // an action the durable trail does not hold, and the two directions of the lie would fight.
  const rowsBeforeWrite = db.auditLogs.length;
  let writeErr = null;
  try {
    await shadowAuditBranch({ live: true, client: refusingClient('simulated insert refusal', { insert: true }) },
      () => auditRepo.create({ adminId: HARNESS_ADMIN.id, adminName: HARNESS_ADMIN.name, role: 'SUPER_ADMIN', module: 'HARNESS', action: 'AF_17_PROBE' }));
  } catch (e) { writeErr = e; }
  check('AF-17', Boolean(writeErr) && db.auditLogs.length === rowsBeforeWrite,
    `a write the store refused rejects (${writeErr ? writeErr.message : 'no rejection'}) and left the in-process trail at ${db.auditLogs.length} rows — it was ${rowsBeforeWrite} before`);

  // AF-18 — one marker helper, both routes, and neither answers from the unlabelled accessor.
  const serverText = fs.readFileSync(path.join(SRC, 'src', 'server.js'), 'utf8');
  const markerUses = (serverText.match(/\.\.\.auditTrailMarker\(/g) || []).length;
  check('AF-18-a', markerUses === 2 && /function auditTrailMarker\(/.test(serverText),
    `both audit read routes carry the marker through the same helper (${markerUses} use(s) of one definition) — R1 and R2 cannot drift into two different contracts`);
  check('AF-18-b', !/db\.getAuditLogs\(/.test(serverText),
    `no route answers with the unlabelled in-process accessor (${(serverText.match(/db\.getAuditLogs\(/g) || []).length} reference(s) in server.js) — it returns rows with no statement about what they are`);

  // AF-19 — the status-code difference between the two refusals is an OPEN OWNER QUESTION, not
  // a resolved design. Pinned as-is so a change is a decision, not an accident.
  const r1 = (serverText.match(/app\.get\('\/api\/admin\/audit-logs'[\s\S]*?\n\}\);/) || [''])[0];
  const r2 = (serverText.match(/app\.get\('\/api\/admin\/identity-verifications\/:id'[\s\S]*?\n\}\);/) || [''])[0];
  check('AF-19', /status\(500\)/.test(r1) && !/AUDIT_TRAIL_UNAVAILABLE/.test(r1)
      && /status\(503\)/.test(r2) && /AUDIT_TRAIL_UNAVAILABLE/.test(r2),
    'the two refusals still differ (R1 500 unlabelled, R2 503 coded). Which one is right is a recorded owner clarification, so neither is silently changed here — this check exists to make that visible.');

  db.auditMirror = mirrorSnap;
  if (Array.isArray(db.auditLogs) && db.auditLogs.length !== mirrorRowsSnap) {
    db.auditLogs.splice(0, db.auditLogs.length - mirrorRowsSnap);
  }

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
