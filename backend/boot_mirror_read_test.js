// =========================================================================
// EVERY BOOT MIRROR MUST HOLD THE WHOLE TABLE, AND GEOGRAPHY MUST NOT HANG BOOT
//
// Two findings, one mechanism.
//
// 1. `supabase/config.toml` sets `[api] max_rows = 1000` and PostgREST enforces it by
//    answering with the first 1000 rows — no error, no notice. `hydrateSessions` was
//    fixed for that on 2026-09-23; this file exists because it was never the only
//    instance. `initPostgres` also reads `users`, `drivers`, `admin_accounts`,
//    `promotions`, `geo_fences` and `surge_zones` unbounded, and each of those becomes
//    an authoritative in-memory mirror whose completeness other code then assumes.
//    Measured on the live store on 2026-09-24: promotions 818, geo_fences 445,
//    surge_zones 443, admin_accounts 390 — every one of them a page away from lying.
//    For geography the lie is priced: `hydrateGeoStore` published whatever came back
//    as `GEO_STORE_STATE.VALIDATED`, so a truncated copy made the ray-cast answer
//    "no fence here" about fences it had never read, and a surcharged zone quoted at
//    1.0x. `docs/POSTGREST_MAX_ROWS_AUDIT.md` carries the census.
//
// 2. FI-09: `initPostgres` is awaited before `server.listen()`, and the geo reads had
//    no deadline. A store that accepts the connection and never answers therefore
//    produced a process that never serves anything — strictly worse than the same
//    store refusing the connection, which is handled in seconds. `hydrateGeoStore`
//    now bounds the read and lands on `UNREADABLE`, the state that already refuses to
//    price, so a hung store costs geographic quotes and not the platform.
//
// What this file refuses to let happen again:
//   BM-00..BM-05  the truncation is real on the live server, and the walk beats it.
//   BM-06         the guard rests on `count: 'exact'` surviving the cap — proven here,
//                 not assumed, because the whole completeness check depends on it.
//   BM-07..BM-11  a walk that cannot finish says so: a store that ignores the cursor,
//                 a cap below the page size, a store that answers nothing, one that
//                 refuses, and a page ceiling.
//   BM-12..BM-18  geography's ways the store can answer — healthy, refusal, truncated,
//                 delayed inside budget, hung past it — and the copy it hands back.
//   BM-19         teardown hands the process back the store's own geography.
//   BM-20..BM-27  the audit mirror: it is a window over a 225,571-row trail and must record
//                 that as numbers (BM-20..BM-22), enter rows through the same mapper a read
//                 returns (BM-23), merge rather than append on a retry (BM-24), name a
//                 refused page (BM-25, BM-26), and leave the size unknown rather than
//                 guessed when only the count is refused (BM-27).
//                 Decision 6 B in docs/OWNER_SECURITY_DECISIONS.md:228 — serve the mirror,
//                 but say so — and "say so" is these fields, not a sentence.
//
// Read-only against the live store, plus proxy stores that only ever wrap it. Nothing
// here writes a row, and nothing here needs a server on :4000.
// =========================================================================

const fs = require('fs');
const path = require('path');
const db = require('./src/database');
const supabaseModule = require('./src/supabase');
const geoPolicy = require('./src/services/GeoPolicyService');

const GEO_STATE = geoPolicy.STORE_STATE;
const PAGE = 500;              // production page size, pinned so a silent change is caught
const CAP = 1000;              // supabase/config.toml [api] max_rows

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const expectedPages = (n) => Math.floor(n / PAGE) + 1;

/**
 * A proxy over the real client that can misbehave the way the real server does. The
 * real client is captured here rather than read back through the module, because a
 * test patches the module export with one of these and a proxy that looked itself up
 * would recurse.
 *
 * `truncate` clamps the page body while still reporting the true count — which is
 * `max_rows` in the case a page size cannot be assumed to sit under. `ignoreCursor`
 * answers every page with the first page. `fail` answers with an error. `hangMs`
 * answers late; `'never'` never answers, which is FI-09. `failCount` answers an
 * uncounted page fine and refuses only the request that asks for a count — the audit
 * mirror needs that shape, because a window it cannot size is a different answer from
 * a window it could not read.
 */
function makeProxy({ truncate = null, ignoreCursor = false, fail = false, hangMs = null, hideCount = false, failCount = false } = {}) {
  const real = supabaseModule.supabaseAdmin;
  const calls = [];
  function builderFor(table) {
    const state = { select: '*', count: null, limit: null, order: null, cursor: null };
    const b = {
      select: (cols, opts) => {
        state.select = cols;
        state.count = opts && opts.count ? opts.count : null;
        return b;
      },
      order: (col, cfg) => { state.order = { col, ascending: cfg?.ascending !== false }; return b; },
      limit: (n) => { state.limit = n; return b; },
      gt: (col, val) => { if (!ignoreCursor) state.cursor = { col, val }; return b; },
      then: (resolve, reject) => {
        calls.push({ table, ...state });
        if (fail) return Promise.resolve({ data: null, error: { message: 'simulated store refusal' } }).then(resolve, reject);
        if (failCount && state.count) return Promise.resolve({ data: null, error: { message: 'simulated count refusal' } }).then(resolve, reject);
        if (hangMs === 'never') return new Promise(() => {}).then(resolve, reject);
        let settled = real
          .from(table)
          .select(state.select, state.count ? { count: state.count } : undefined)
          .then(({ data, error, count }) => ({
            data: truncate != null && Array.isArray(data) ? data.slice(0, truncate) : data,
            error,
            count: hideCount ? null : count
          }));
        if (hangMs != null) {
          const fast = settled;
          settled = new Promise((res) => { setTimeout(() => res(fast), hangMs); });
        }
        return settled.then(resolve, reject);
      }
    };
    return b;
  }
  return { from: (table) => builderFor(table), calls };
}

/** Swap the module's client for a misbehaving one for the length of one call. */
async function withProxy(proxy, fn) {
  const real = supabaseModule.supabaseAdmin;
  supabaseModule.supabaseAdmin = proxy;
  try {
    return await fn();
  } finally {
    supabaseModule.supabaseAdmin = real;
  }
}

/**
 * Run one call with `console.warn` collected instead of printed. The audit mirror's promise is
 * that a failed read is *said*, so the saying is part of what has to be asserted — a state
 * object alone cannot tell a named error from a silently absent one.
 */
async function withWarnCapture(fn) {
  const real = console.warn;
  const lines = [];
  console.warn = (...args) => { lines.push(args.map(String).join(' ')); };
  try {
    return { value: await fn(), lines };
  } finally {
    console.warn = real;
  }
}

async function headCount(table) {
  const { count, error } = await supabaseModule.supabaseAdmin
    .from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table} head count failed: ${error.message}`);
  return count;
}

async function main() {
  if (!supabaseModule.isLivePostgres || !supabaseModule.supabaseAdmin) {
    console.error('❌ This file is worthless without the live store: every number below is the platform\'s.');
    process.exit(1);
  }

  // --- The defect, on the live server, so it stays described in the file that fixes it.
  // The witness must be a table that is over the cap in any real store. `audit_logs` grows
  // with every admin action and the local reset never truncates it; a transactional table
  // is empty on a clean database, where a truncation cannot be demonstrated at all — the
  // check would read as a product failure when it is only an absence of rows.
  const witnessTotal = await headCount('audit_logs');
  const singleShot = await supabaseModule.supabaseAdmin.from('audit_logs').select('*');
  check('BM-00', witnessTotal > CAP && singleShot.data.length === CAP,
    `audit_logs holds ${witnessTotal} rows and a plain read returns ${singleShot.data.length} with no error — the defect, not a test artifact`);

  const ordersTotal = await headCount('orders');
  const walked = await db.readAllRows(supabaseModule.supabaseAdmin, { table: 'orders' });
  check('BM-01', walked.complete && walked.rows.length === ordersTotal,
    `readAllRows assembled ${walked.rows.length} of ${ordersTotal} over ${walked.pages} page(s), complete=${walked.complete}`);
  check('BM-02', new Set(walked.rows.map(r => r.id)).size === ordersTotal,
    'the assembled set has no duplicate id — a cursor that skipped or repeated a row would not');

  // --- Geography specifically, because that is the copy other code prices from.
  const fenceTotal = await headCount('geo_fences');
  const ruleTotal = await headCount('surge_zones');
  const fenceWalk = await db.readAllRows(supabaseModule.supabaseAdmin, { table: 'geo_fences', orderDesc: 'created_at' });
  check('BM-03', fenceWalk.complete && fenceWalk.rows.length === fenceTotal && fenceWalk.pages === expectedPages(fenceTotal),
    `geo_fences read completely: ${fenceWalk.rows.length}/${fenceTotal} across ${fenceWalk.pages} page(s)`);
  const atTimes = fenceWalk.rows.map(r => Date.parse(r.created_at) || 0);
  const descending = atTimes.every((v, i) => i === 0 || atTimes[i - 1] >= v);
  check('BM-04', descending,
    'created_at desc is re-applied after the walk, so paging cannot change what the admin map or the array order shows');
  const ruleWalk = await db.readAllRows(supabaseModule.supabaseAdmin, { table: 'surge_zones', orderDesc: 'created_at' });
  check('BM-05', ruleWalk.complete && ruleWalk.rows.length === ruleTotal,
    `surge_zones read completely: ${ruleWalk.rows.length}/${ruleTotal} across ${ruleWalk.pages} page(s)`);

  // --- The premise under the guard: the count survives the cap.
  const capped = await supabaseModule.supabaseAdmin.from('geo_fences').select('id', { count: 'exact' }).limit(5);
  check('BM-06', capped.data.length === 5 && capped.count === fenceTotal,
    `the server answers 5 rows and count ${capped.count} together — completeness is a fact from PostgREST, not an inference`);

  // --- A walk that cannot finish must say so, and publish nothing.
  const looped = await db.readAllRows(makeProxy({ ignoreCursor: true }), { table: 'geo_fences', pageSize: 100 });
  check('BM-07', !looped.complete && looped.rows.length === 0 && /pagination repeated/.test(looped.error || ''),
    `a store that ignores the cursor is caught by the duplicate guard, not walked twice: error="${looped.error}"`);

  const belowPage = await db.readAllRows(makeProxy({ truncate: 10 }), { table: 'geo_fences' });
  check('BM-08', !belowPage.complete && belowPage.rows.length === 0 && /store counts/.test(belowPage.error || ''),
    `a cap below the page size cannot pass for an exhausted table: error="${belowPage.error}"`);

  const blind = await db.readAllRows(makeProxy({ truncate: 10, hideCount: true }), { table: 'geo_fences' });
  check('BM-09', blind.complete && blind.rows.length === 10,
    'documented limit: without a count a short page is all the reader can know, which is why BM-06 pins the count existing');

  const broken = await db.readAllRows(makeProxy({ fail: true }), { table: 'geo_fences' });
  check('BM-10', !broken.complete && broken.rows.length === 0 && /simulated store refusal/.test(broken.error || ''),
    `a store that refuses is reported, not swallowed: error="${broken.error}"`);

  const ceiling = await db.readAllRows(supabaseModule.supabaseAdmin, { table: 'geo_fences', pageSize: 1, maxPages: 3 });
  check('BM-11', !ceiling.complete && /3 pages/.test(ceiling.error || ''),
    `a walk with no ceiling is a hang in disguise: error="${ceiling.error}"`);

  // --- hydrateGeoStore: what each answer from the store is allowed to claim.
  const healthy = await db.hydrateGeoStore('boot-mirror-test');
  check('BM-12', healthy.refreshed === true && healthy.fences === fenceTotal && healthy.rules === ruleTotal
      && db.geoStore.fences !== GEO_STATE.UNREADABLE && db.geoStore.rules !== GEO_STATE.UNREADABLE,
    `healthy store: ${healthy.fences} fences / ${healthy.rules} rules published as validated`);

  const refused = await withProxy(makeProxy({ fail: true }), () => db.hydrateGeoStore('simulated refusal'));
  check('BM-13', refused.refreshed === false
      && db.geoStore.fences === GEO_STATE.UNREADABLE && db.geoStore.rules === GEO_STATE.UNREADABLE,
    'a store that refuses leaves the copy UNREADABLE, which is the state that declines to price');

  const truncated = await withProxy(makeProxy({ truncate: 10 }), () => db.hydrateGeoStore('simulated truncation'));
  check('BM-14', truncated.refreshed === false
      && db.geoStore.fences === GEO_STATE.UNREADABLE && db.geoStore.rules === GEO_STATE.UNREADABLE,
    `a ${10}-row page of a ${fenceTotal}-row table is never published as VALIDATED again`);

  const slowWithinBudget = await withProxy(makeProxy({ hangMs: 40 }),
    () => db.hydrateGeoStore('simulated delay', { timeoutMs: 5000 }));
  check('BM-15', slowWithinBudget.refreshed === true && slowWithinBudget.fences === fenceTotal,
    'a store that answers late but inside the budget is a normal read, not a failure');

  // FI-09 itself: a store that never answers must not be able to hold the process.
  const hungStartedAt = Date.now();
  const hung = await withProxy(makeProxy({ hangMs: 'never' }),
    () => db.hydrateGeoStore('simulated hang', { timeoutMs: 150 }));
  const hungElapsed = Date.now() - hungStartedAt;
  check('BM-16', hung.refreshed === false && hung.timedOut === true && hungElapsed < 3000,
    `a store that never answers resolves in ${hungElapsed}ms instead of blocking boot forever`);
  check('BM-17', db.geoStore.fences === GEO_STATE.UNREADABLE && db.geoStore.rules === GEO_STATE.UNREADABLE,
    'the abandoned read is not mistaken for one that succeeded — stale-by-omission geography stays unauthoritative');

  // `hideCount` here stands for a store that counts nothing because it holds nothing;
  // a truncated page plus a real count is BM-08, and must not reach this state.
  const empty = await withProxy(makeProxy({ truncate: 0, hideCount: true }), () => db.hydrateGeoStore('simulated empty store'));
  check('BM-18', empty.refreshed === true && db.geoStore.fences === GEO_STATE.VALIDATED_EMPTY,
    'an empty store is a fact about the store, so it is VALIDATED_EMPTY and not UNREADABLE — the two must not share a path');

  const restored = await db.hydrateGeoStore('test teardown');
  check('BM-19', restored.refreshed === true && db.geoFences.length === fenceTotal && db.surgeZones.length === ruleTotal,
    `teardown hands back the store's own geography, not this file's fixtures: ${db.geoFences.length} fences / ${db.surgeZones.length} rules, UNREADABLE=${db.geoStore.fences === GEO_STATE.UNREADABLE}`);

  // --- The audit mirror, which is a window and must say so.
  //
  // `docs/OWNER_SECURITY_DECISIONS.md` Decision 6 chose option B: the mirror may answer during
  // an outage, but only with an explicit degraded/stale marker. A marker has to be *facts*, or
  // it is a second piece of prose — so this group pins the record boot writes (`hydrateAuditMirror`)
  // rather than the sentence a reader eventually renders.
  //
  // It also pins the two defects that made the marker impossible: the swallowed `audErr` (a
  // mirror that failed to hydrate was indistinguishable from one that hydrated to nothing) and
  // the boot row mapping that reached for `mapRowToDTO` by a name out of scope, so every
  // mirrored row kept snake_case keys and every camelCase reader skipped it silently — the
  // admin trail showing `Invalid Date` and `System` for records the store held in full.
  //
  // `witnessTotal` is the store's own `audit_logs` count, taken at BM-00.
  const auditMirrorBefore = db.auditLogs.length;

  const auditHydrated = await db.hydrateAuditMirror();
  check('BM-20', auditHydrated.source === 'postgres' && auditHydrated.windowRows === 200
      && auditHydrated.storeRows === witnessTotal && auditHydrated.complete === false,
    `a ${witnessTotal}-row trail copies ${auditHydrated.windowRows} rows and records it as a window, not as the whole: complete=${auditHydrated.complete}, error="${auditHydrated.error}"`);
  check('BM-21', /newest .* of .* rows/.test(auditHydrated.error || ''),
    `the incompleteness is stated in numbers a reader can use: "${auditHydrated.error}"`);
  check('BM-22', auditHydrated.windowRows < auditHydrated.storeRows
      && db.auditLogs.length > auditMirrorBefore && db.auditLogs.length !== auditHydrated.storeRows,
    `the mirror grew by the window (${auditMirrorBefore} → ${db.auditLogs.length}) and still is not the store's ${auditHydrated.storeRows} — the length of the array is not a count of the trail`);
  const lengthAfterFirst = db.auditLogs.length;

  const newestStoreRow = (await supabaseModule.supabaseAdmin
    .from('audit_logs').select('*').order('created_at', { ascending: false }).limit(1)).data[0];
  const mirroredNewest = db.auditLogs.find(a => a.id === newestStoreRow.id);
  check('BM-23', Boolean(mirroredNewest) && mirroredNewest.timestamp === newestStoreRow.created_at
      && mirroredNewest.adminName === newestStoreRow.admin_name
      && mirroredNewest.created_at === undefined && mirroredNewest.admin_id === undefined,
    `a hydrated row enters the mirror through the same mapper a read returns (${newestStoreRow.id}: timestamp=${Boolean(mirroredNewest && mirroredNewest.timestamp)}, adminName=${mirroredNewest && mirroredNewest.adminName}, raw store keys carried=${mirroredNewest && (mirroredNewest.created_at !== undefined || mirroredNewest.admin_id !== undefined)})`);

  const again = await db.hydrateAuditMirror();
  const distinct = new Set(db.auditLogs.map(a => a.id)).size;
  check('BM-24', again.windowRows === 200 && db.auditLogs.length === lengthAfterFirst && distinct === db.auditLogs.length,
    `a second hydration merges by id instead of appending: ${db.auditLogs.length} rows, ${distinct} distinct ids — a reader that retried would otherwise double the trail`);

  const auditRefused = await withWarnCapture(() => withProxy(makeProxy({ fail: true }), () => db.hydrateAuditMirror()));
  check('BM-25', auditRefused.value.complete === false && /simulated store refusal/.test(auditRefused.value.error || '')
      && auditRefused.value.windowRows === 0,
    `a store that refuses the page read names its error instead of swallowing it: error="${auditRefused.value.error}"`);
  check('BM-26', auditRefused.lines.some(l => /audit_logs mirror NOT hydrated/.test(l)),
    `and says it out loud at boot, where an operator is looking: ${JSON.stringify(auditRefused.lines[0] || '')}`);

  // The page answered and the count did not. `windowRows` is asserted as non-zero rather than
  // as 200 because this proxy re-issues the read without the `.limit()` it was given — it was
  // written for the geo walk, where the page size is the caller's, not the store's — so the
  // window it hands back is PostgREST's own cap. The 200-row bound is BM-20's job, on the
  // unproxied path. What BM-27 pins is that an unknown size stays unknown instead of being
  // inferred from however many rows came back.
  const countBlind = await withWarnCapture(() => withProxy(makeProxy({ failCount: true }), () => db.hydrateAuditMirror()));
  check('BM-27', countBlind.value.windowRows > 0 && countBlind.value.storeRows === null
      && countBlind.value.complete === false && countBlind.lines.some(l => /store row count unavailable/.test(l)),
      `a store that answers the page but not the count leaves the size unknown rather than guessed, and calls that a warning: `
      + `windowRows=${countBlind.value.windowRows}, storeRows=${countBlind.value.storeRows}, complete=${countBlind.value.complete}, `
      + `warned=${JSON.stringify(countBlind.lines)}`);

  // The claim the boot report makes. It cannot be exercised without booting, so it is read as
  // written: the audit window must appear in the same list that names `users` and `promotions`,
  // which is what `docs/POSTGREST_MAX_ROWS_AUDIT.md` §4.4 found missing.
  const bootSource = fs.readFileSync(path.join(__dirname, 'src', 'database.js'), 'utf8');
  check('BM-28', /partialMirrors\.push\(`audit_logs: /.test(bootSource)
      && /audit_logs mirror NOT hydrated/.test(bootSource),
    'initPostgres names an incomplete audit window in its INCOMPLETE MIRROR report — the table is no longer excluded from the list that admits truncation');

  const failed = results.filter(r => !r.ok);
  console.log(`\n📊 ${results.length - failed.length} PASSED, ${failed.length} FAILED of ${results.length}`);
  if (failed.length) console.log(`❌ failing: ${failed.map(f => f.id).join(', ')}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`❌ harness threw: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
