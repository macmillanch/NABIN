// =========================================================================
// SESSION RECONCILIATION MUST COVER EVERY ELIGIBLE ROW
//
// `supabase/config.toml` sets PostgREST `max_rows = 1000`. That is not an error and not a
// warning: an unbounded read simply returns the first 1000 rows, and the caller cannot tell
// a complete dataset from a truncated one. Both session reads were unbounded, and
// `backend_sessions` measured 1459 unexpired rows on 2026-09-23 (Content-Range
// `0-0/1458` answered with a 1000-row body). So at boot the process restored 1000 sessions,
// and every 15 seconds the reconcile tick answered "is this session still alive?" from a set
// missing ~459 rows — which is how a signed-in user gets silently signed out by code that is
// only meant to clean up after logouts.
//
// `readAllActiveSessions` walks the table by keyset cursor over `token_hash`, the PRIMARY KEY
// (unique, not null, immutable), so a page cannot repeat a row, cannot skip one, and ends on
// a short page. `hydrateSessions` and `reconcileSessions` both read through it, and a walk
// that cannot finish says so: adoption may still run on a partial set (it only adds), pruning
// may not (it removes, and "absent from a truncated page" is not evidence of "deleted").
//
// Four things this file refuses to let happen again:
//   1. A reconcile that misses rows past a page boundary. RC-08 straddles the cap at 999,
//      1000, 1001, 1459 and 2000, so an off-by-one in the cursor shows up.
//   2. A destructive half running on a partial read. RC-12 proves the prune is skipped and a
//      live session survives a broken walk.
//   3. A walk that never ends. RC-13 drives a store that ignores the cursor, RC-14 a page
//      ceiling.
//   4. Raising `max_rows` and calling it fixed. RC-15 shows the walk still pages against a
//      store with no cap at all.
//
// The live group (RC-01..RC-07, RC-16) runs the same reader against the real PostgREST, so
// the cursor is proven against the server's own pagination and not only against this file's
// model of it. It reads only.
// =========================================================================

const db = require('./src/database');
const configured = require('./src/supabase');

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const MAX_ROWS = 1000;   // supabase/config.toml [api] max_rows
const PAGE = 500;        // production page size, pinned so a silent change is caught
const FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2000-01-01T00:00:00.000Z';
const COLUMNS = 'token_hash, role, entity_id, phone, entity, created_at, expires_at';

// A keyset walk ends on a page that came back short, so an exact multiple of the page size
// costs one more (empty) request. Asserting the real shape, not a hopeful one.
const expectedPages = (n) => Math.floor(n / PAGE) + 1;

const hash = (n) => String(n).padStart(64, '0');

/** A store that behaves like PostgREST, including the part that bites. */
function makeStore(rows, opts = {}) {
  const { breakAfterPage = Infinity, ignoreCursor = false, maxRows = MAX_ROWS } = opts;
  const log = { reads: 0, deletes: 0 };
  let backing = rows.slice();

  function run(mode, filters, state) {
    if (mode === 'delete') {
      log.deletes += 1;
      let removed = 0;
      backing = backing.filter((r) => {
        if (filters.every((f) => f(r))) { removed += 1; return false; }
        return true;
      });
      return { data: null, error: null, count: removed };
    }
    log.reads += 1;
    if (log.reads > breakAfterPage) {
      return { data: null, error: { message: 'simulated store failure mid-walk' } };
    }
    // `ignoreCursor` drops only the cursor predicate, which is what a server that
    // mis-handles `token_hash=gt.` would do: every page is the first page.
    const active = ignoreCursor
      ? filters.filter((f) => !f.cursor)
      : filters;
    let out = backing.filter((r) => active.every((f) => f(r)));
    if (state.order) {
      const { col, ascending } = state.order;
      out = out.sort((a, b) => (ascending ? a[col] > b[col] : a[col] < b[col]) ? 1 : -1);
    }
    const cap = state.limit == null ? maxRows : Math.min(state.limit, maxRows);
    return { data: out.slice(0, cap).map((r) => ({ ...r })), error: null };
  }

  const builder = (mode) => {
    const filters = [];
    const state = {};
    const b = {
      gt: (col, val) => {
        const f = (r) => r[col] > val;
        if (col === 'token_hash') f.cursor = true;
        filters.push(f);
        return b;
      },
      lte: (col, val) => { filters.push((r) => r[col] <= val); return b; },
      order: (col, cfg) => { state.order = { col, ascending: cfg?.ascending !== false }; return b; },
      limit: (n) => { state.limit = n; return b; },
      then: (resolve, reject) => Promise.resolve(run(mode, filters, state)).then(resolve, reject)
    };
    return b;
  };

  return {
    from: () => ({ select: () => builder('select'), delete: () => builder('delete') }),
    log,
    rows: (next) => { if (next) backing = next; return backing; }
  };
}

function eligible(n, { offset = 0 } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    token_hash: hash(i + offset),
    role: i % 3 === 0 ? 'CUSTOMER' : 'DRIVER',
    entity_id: `entity_${i + offset}`,
    phone: null,
    entity: { id: i + offset, role: 'CUSTOMER' },
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: FUTURE
  }));
}

async function main() {
  // --- The defect itself, so it stays described in the file that fixes it ---------------
  const big = eligible(1459);
  const uncapped = await makeStore(big).from('backend_sessions').select(COLUMNS)
    .gt('expires_at', new Date().toISOString());
  check('RC-00', uncapped.data.length === 1000 && big.length === 1459,
    `an unbounded read returns ${uncapped.data.length} of 1459 rows with no error — the defect, not a test artifact`);

  // --- The real table, read through the real server -------------------------------------
  check('RC-01', configured.isLivePostgres && Boolean(configured.supabaseAdmin),
    `isLivePostgres=${configured.isLivePostgres} — the counts below are the platform's, not a fixture's`);
  if (!configured.isLivePostgres) {
    console.log('❌ Not running against the live store. This file is worthless without RC-02..RC-07.');
    process.exit(1);
  }

  const countLive = async () => configured.supabaseAdmin
    .from('backend_sessions').select('token_hash', { count: 'exact', head: true })
    .gt('expires_at', new Date().toISOString());
  const { count: liveCount, error: countError } = await countLive();
  check('RC-02', !countError && Number.isInteger(liveCount) && liveCount > MAX_ROWS,
    `the real table holds ${liveCount} eligible rows against a ${MAX_ROWS}-row page (error=${countError?.message || 'none'})`);

  const real = await db.readAllActiveSessions(configured.supabaseAdmin, { pageSize: PAGE });
  check('RC-03', real.complete && real.rows.length === liveCount,
    `the real walk returned ${real.rows.length} of ${liveCount} rows across ${real.pages} page(s), complete=${real.complete}${real.error ? ` error=${real.error}` : ''}`);
  check('RC-04', real.pages > 1 && real.pages === expectedPages(liveCount),
    `it made ${real.pages} requests (expected ${expectedPages(liveCount)}), so one capped read could never have covered it`);
  check('RC-05', new Set(real.rows.map((r) => r.token_hash)).size === real.rows.length,
    `no row was processed twice (${new Set(real.rows.map((r) => r.token_hash)).size} unique of ${real.rows.length})`);
  check('RC-06', real.rows.every((r, i) => i === 0 || r.token_hash > real.rows[i - 1].token_hash),
    'the walk came back ordered by the cursor column, which is what makes skips and repeats impossible');
  check('RC-07', real.rows.every((r) => Date.parse(r.expires_at) > Date.now()),
    'no expired row was pulled back by the walk');

  // --- Straddle the cap deterministically -----------------------------------------------
  for (const n of [999, 1000, 1001, 1459, 2000]) {
    const store = makeStore(eligible(n));
    const walk = await db.readAllActiveSessions(store, { pageSize: PAGE });
    check(`RC-08/${n}`, walk.complete && walk.rows.length === n && walk.pages === expectedPages(n),
      `${n} eligible rows -> ${walk.rows.length} read in ${walk.pages} page(s) (expected ${n} in ${expectedPages(n)})${walk.error ? ` error=${walk.error}` : ''}`);
    check(`RC-09/${n}`, walk.rows.every((r, i) => i === 0 || r.token_hash > walk.rows[i - 1].token_hash)
      && new Set(walk.rows.map((r) => r.token_hash)).size === n,
      `and the ${n}-row walk is strictly ordered with no duplicate across its page boundaries`);
  }

  // --- Reconciliation over more than one page -------------------------------------------
  const mixed = [...eligible(1200), ...eligible(40, { offset: 5000 })];
  const expiredHashes = new Set(mixed.filter((_, i) => i % 7 === 0).map((r) => r.token_hash));
  mixed.forEach((r) => { if (expiredHashes.has(r.token_hash)) r.expires_at = PAST; });
  const store = makeStore(mixed);
  const rec = await db.reconcileSessions({ store, pageSize: PAGE });
  check('RC-10', rec.complete && rec.rows === mixed.length - expiredHashes.size && rec.adopted > 0
    && db.activeSessions.size >= rec.rows,
    `a reconcile over ${mixed.length} rows with ${expiredHashes.size} expired adopted ${rec.adopted}, reported ${rec.rows} eligible, complete=${rec.complete}`);
  check('RC-11', !Array.from(db.activeSessions.keys()).some((h) => expiredHashes.has(h)),
    'and no expired session was adopted into this process by that walk');
  check('RC-11b', store.log.deletes === 1,
    `the expired half was deleted at the store once (${store.log.deletes} statement), not once per page`);

  // --- The destructive half must not run on a partial read ------------------------------
  const broken = makeStore(eligible(1459), { breakAfterPage: 2 });
  const survivorToken = 'plaintext-bearer-a-real-user-holds-1400';
  const survivorHash = db.hashSessionToken(survivorToken);
  // The store holds this session (row 1400, the third page) and this process knows it only
  // by its plaintext bearer — exactly the shape the prune consumes.
  broken.rows(eligible(1459).concat([{ ...eligible(1, { offset: 0 })[0], token_hash: survivorHash, entity_id: 'entity_1400' }]));
  db.activeSessions.set(survivorToken, {
    token: survivorToken, role: 'CUSTOMER', entityId: 'entity_1400',
    expiresAt: new Date(Date.now() + 600000).toISOString()
  });
  const brokenRec = await db.reconcileSessions({ store: broken, pageSize: PAGE });
  check('RC-12', !brokenRec.complete && brokenRec.pruned === 0 && db.activeSessions.has(survivorToken),
    `a walk that fails on page 3 reports complete=${brokenRec.complete}, prunes ${brokenRec.pruned}, and keeps the bearer whose row it never reached (${brokenRec.error})`);
  db.activeSessions.delete(survivorToken);

  const stuck = await db.readAllActiveSessions(makeStore(eligible(1459), { ignoreCursor: true }), { pageSize: PAGE });
  check('RC-13', !stuck.complete && stuck.pages === 2 && stuck.rows.length === PAGE,
    `a store that ignores the cursor is caught by its own duplicate guard: stopped after ${stuck.pages} page(s), ${stuck.rows.length} rows, complete=${stuck.complete} (${stuck.error})`);

  const ceiling = await db.readAllActiveSessions(makeStore(eligible(1459)), { pageSize: PAGE, maxPages: 2 });
  check('RC-14', !ceiling.complete && ceiling.pages === 3 && /without reaching a short page/.test(ceiling.error || ''),
    `a walk that cannot finish stops at the page ceiling and says why (pages=${ceiling.pages}, error="${ceiling.error}")`);

  // --- Raising max_rows is not the fix --------------------------------------------------
  const noCap = await db.readAllActiveSessions(makeStore(eligible(1459), { maxRows: 100000 }), { pageSize: PAGE });
  check('RC-15', noCap.pages === expectedPages(1459) && noCap.rows.length === 1459,
    `against a store with no cap at all the walk still pages (${noCap.pages} requests for 1459 rows), so the fix is the walk and not a bigger limit`);

  // --- The live table was not disturbed -------------------------------------------------
  const after = await countLive();
  check('RC-16', after.count >= liveCount - 5 && after.count <= liveCount + 5,
    `the live table still holds ${after.count} eligible rows (was ${liveCount}); this file read it and wrote nothing`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n📊 SESSION RECONCILE PAGINATION: ${results.length - failed.length} PASSED, ${failed.length} FAILED (Total: ${results.length})`);
  for (const f of failed) console.log(`   FAILED ${f.id}: ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
