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
// Five things this file refuses to let happen again:
//   1. A reconcile that misses rows past a page boundary. RC-08 straddles the cap at 999,
//      1000, 1001, 1459 and 2000, so an off-by-one in the cursor shows up.
//   2. A destructive half running on a partial read. RC-12 proves the prune is skipped and a
//      live session survives a broken walk.
//   3. A walk that never ends. RC-13 drives a store that ignores the cursor, RC-14 a page
//      ceiling.
//   4. Raising `max_rows` and calling it fixed. RC-15 shows the walk still pages against a
//      store with no cap at all.
//   5. A walk that adopts back a session revoked while it was in flight. The adopt half runs
//      after the whole walk, so a sign-out between two pages puts a revoked bearer back into
//      this process — and the prune never takes a hash-keyed entry off again. RC-17..RC-22.
//
// The live group (RC-01..RC-07, RC-16) runs the same reader against the real PostgREST, so
// the cursor is proven against the server's own pagination and not only against this file's
// model of it. It reads only. Its page size comes from the live row count rather than from
// the production page size: a clean local store holds only the sessions the running harness
// itself signed in, so a 500-row page over it is one request and proves nothing about
// boundaries. Smaller pages over the same real rows cross the same boundary the 1459-row
// incident did; the 1000-row cap itself is witnessed by RC-00 and by RC-08/09 straddling it.
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
const expectedPages = (n, size = PAGE) => Math.floor(n / size) + 1;

const hash = (n) => String(n).padStart(64, '0');

/** A store that behaves like PostgREST, including the part that bites. */
function makeStore(rows, opts = {}) {
  const {
    breakAfterPage = Infinity, ignoreCursor = false, maxRows = MAX_ROWS,
    onPageRead = null, deleteDelayMs = 0
  } = opts;
  const log = { reads: 0, deletes: 0 };
  let backing = rows.slice();

  function run(mode, filters, state) {
    if (mode === 'delete') {
      log.deletes += 1;
      const apply = () => {
        let removed = 0;
        backing = backing.filter((r) => {
          if (filters.every((f) => f(r))) { removed += 1; return false; }
          return true;
        });
        return { data: null, error: null, count: removed };
      };
      // A real DELETE is a round trip: the statement leaves this process and the table
      // changes some time later. With no delay the fake is faster than the truth, which
      // makes an un-awaited call look like it completed. `deleteDelayMs` restores the
      // interval so a test can see what is in it.
      if (deleteDelayMs > 0) {
        return new Promise((resolve) => { setTimeout(() => resolve(apply()), deleteDelayMs); });
      }
      return apply();
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
    const page = out.slice(0, cap).map((r) => ({ ...r }));
    // The walk is a series of awaited round trips, so the store is allowed to change
    // underneath it. This is how a test gets to place a write between two pages.
    if (onPageRead) onPageRead(page, log.reads);
    return { data: page, error: null };
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
      // `forgetSession` and every operator revocation filter by equality, so the fake has to
      // speak that predicate or the store would delete rows the real statement never touched.
      eq: (col, val) => { filters.push((r) => r[col] === val); return b; },
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
  // Two eligible rows is the minimum that a page boundary can exist between. Anything the
  // harness signs in satisfies it; an empty live table would mean this file proved nothing.
  // Must stay <= PAGE (500) so a large table cannot request a page size > PostgREST's MAX_ROWS (1000).
  const livePage = Math.min(PAGE, Math.max(1, Math.ceil(Math.max(0, liveCount || 0) / 3)));
  check('RC-02', !countError && Number.isInteger(liveCount) && liveCount >= 2,
    `the real table holds ${liveCount} eligible rows, walked at a ${livePage}-row page (error=${countError?.message || 'none'})`);

  const real = await db.readAllActiveSessions(configured.supabaseAdmin, { pageSize: PAGE });
  check('RC-03', real.complete && real.rows.length === liveCount,
    `the real walk returned ${real.rows.length} of ${liveCount} rows across ${real.pages} page(s), complete=${real.complete}${real.error ? ` error=${real.error}` : ''}`);
  const realPaged = await db.readAllActiveSessions(configured.supabaseAdmin, { pageSize: livePage });
  check('RC-04', realPaged.complete && realPaged.rows.length === liveCount
    && realPaged.pages > 1 && realPaged.pages === expectedPages(realPaged.rows.length, livePage),
    `it made ${realPaged.pages} requests at a ${livePage}-row page (expected ${expectedPages(liveCount, livePage)}), so one capped read could never have covered it`);
  check('RC-05', new Set(realPaged.rows.map((r) => r.token_hash)).size === realPaged.rows.length,
    `no row was processed twice across the ${realPaged.pages} page(s) (${new Set(realPaged.rows.map((r) => r.token_hash)).size} unique of ${realPaged.rows.length})`);
  check('RC-06', realPaged.rows.every((r, i) => i === 0 || r.token_hash > realPaged.rows[i - 1].token_hash),
    'the walk came back ordered by the cursor column, which is what makes skips and repeats impossible');
  check('RC-07', realPaged.rows.every((r) => Date.parse(r.expires_at) > Date.now()),
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

  // --- A revocation that commits mid-walk must not be undone -----------------------------
  //
  // `admin_customers_test` CU-28 went red on one chain run in sixteen with this pair in the
  // log: "ends every session it just made invalid — 2 signed out", then the very next read
  // of the same account reporting "1 left". The sign-out deleted two store rows and two
  // memory entries. The reconcile tick walking `backend_sessions` at that moment had already
  // read the page holding the first handle, so its row set still carried a session this
  // process had just revoked, and its adopt half — which runs after the whole walk, not after
  // each page — handed it back. Nothing takes it off again: the prune deliberately skips
  // hash-keyed entries, so the signed-out bearer stays honoured until its token expires.
  // One of the two came back because the page boundary fell between the two handles.
  const revRow = (h) => ({
    token_hash: h, role: 'CUSTOMER', entity_id: `rev_${h.slice(-4)}`, phone: null,
    entity: { id: h.slice(-4), role: 'CUSTOMER' },
    created_at: '2026-01-01T00:00:00.000Z', expires_at: FUTURE
  });
  const revokedHandle = hash(700001);
  const laterHandle = hash(700002);
  let revokedMidWalk = false;
  const revStore = makeStore([revRow(revokedHandle), revRow(laterHandle)], {
    onPageRead: (page) => {
      // Only once, and only on the page that still shows the revoked row: this is the
      // sign-out landing inside the walk, not a write on every request.
      if (revokedMidWalk || !page.some((r) => r.token_hash === revokedHandle)) return;
      revokedMidWalk = true;
      revStore.rows(revStore.rows().filter((r) => r.token_hash !== revokedHandle));
      db.dropRevokedSession(revokedHandle);
    }
  });
  // The handle has to be in this process before the tick, the way a hydrated session is,
  // because the adopt half only acts on handles it does not already hold.
  db.activeSessions.set(revokedHandle, { ...revRow(revokedHandle), token: revokedHandle, entityId: 'rev_0001', expiresAt: FUTURE });
  db.activeSessions.delete(laterHandle);
  const revRec = await db.reconcileSessions({ store: revStore, pageSize: 1 });
  check('RC-17', revokedMidWalk && revRec.complete && revRec.revokedDuringWalk === 1,
    `the tick saw the sign-out land inside its own walk (${revRec.revokedDuringWalk} revocation(s) across ${revRec.rows} eligible rows)`);
  check('RC-18', !db.activeSessions.has(revokedHandle),
    'the session revoked mid-walk was NOT written back into this process by the adopt half');
  check('RC-19', revRec.adopted === 0,
    `and the tick adopted nothing rather than acting on a picture taken through the delete (adopted=${revRec.adopted})`);

  // Deferring is not refusing: the next tick starts after the delete, so the revoked row is
  // simply not there to adopt, and a session issued elsewhere still arrives.
  const nextRec = await db.reconcileSessions({ store: revStore, pageSize: 1 });
  check('RC-20', nextRec.revokedDuringWalk === 0 && nextRec.adopted === 1
    && db.activeSessions.has(laterHandle) && !db.activeSessions.has(revokedHandle),
    `one round later it adopted ${nextRec.adopted} live session(s) and still has not re-adopted the revoked one`);

  // The partial-read branch adopts as well, so it needs the same refusal.
  const breakHandle = hash(700003);
  let revokedOnPartial = false;
  const broken3 = makeStore([revRow(breakHandle)], {
    breakAfterPage: 1,
    onPageRead: () => {
      if (revokedOnPartial) return;
      revokedOnPartial = true;
      broken3.rows(broken3.rows().filter((r) => r.token_hash !== breakHandle));
      db.dropRevokedSession(breakHandle);
    }
  });
  db.activeSessions.set(breakHandle, { ...revRow(breakHandle), token: breakHandle, entityId: 'rev_0003', expiresAt: FUTURE });
  const brokenRevRec = await db.reconcileSessions({ store: broken3, pageSize: 1 });
  check('RC-21', !brokenRevRec.complete && brokenRevRec.adopted === 0 && !db.activeSessions.has(breakHandle),
    `a walk that both failed and raced a revocation adopts nothing either (complete=${brokenRevRec.complete}, adopted=${brokenRevRec.adopted}, ${brokenRevRec.error})`);

  // The guard only holds if every revocation announces itself. A future sign-out that drops
  // its local entries with a bare `activeSessions.delete` would resurrect that session on
  // the next tick, and no test below would notice — so this reads the source.
  const databaseSrc = require('fs').readFileSync(require.resolve('./src/database.js'), 'utf8').split('\n');
  const methodSpan = (name) => {
    const from = databaseSrc.findIndex((l) => new RegExp(`^  (async )?${name}\\(`).test(l));
    if (from === -1) return null;
    let to = databaseSrc.length;
    for (let i = from + 1; i < databaseSrc.length; i++) {
      if (/^  (async )?[A-Za-z_]\w*\(/.test(databaseSrc[i])) { to = i; break; }
    }
    return databaseSrc.slice(from, to).join('\n');
  };
  const quietRevocations = ['revokeCustomerSessions', 'revokeAdminSession', 'revokeAdminSessionsForAccount']
    .filter((name) => {
      const body = methodSpan(name);
      return !body || /this\.activeSessions\.delete\(/.test(body) || !/this\.dropRevokedSession\(/.test(body);
    });
  check('RC-22', quietRevocations.length === 0,
    quietRevocations.length
      ? `these revocation paths drop local sessions without moving the guard: ${quietRevocations.join(', ')}`
      : 'every revocation path takes its local entries through `dropRevokedSession`, so the tick can see it happened');
  [revokedHandle, laterHandle, breakHandle].forEach((h) => db.activeSessions.delete(h));

  // --- The sign-out window: the durable delete has to land before the call claims it did ---
  //
  // `invalidateSession` is the logout path, and until this was fixed it was the one revocation
  // in the platform that dropped its durable row *un-awaited*. Every operator-triggered
  // revocation (`revokeCustomerSessions`, `revokeAdminSession`, `revokeAdminSessionsForAccount`)
  // awaits the store before touching memory; this one fired the DELETE and returned, so
  // `/api/auth/logout` answered "Logged out successfully." while the row was still in the table.
  // A reconcile tick started inside that one round trip read the row back, and its adopt half
  // handed the signed-out bearer to this process again — with nothing to take it off, because
  // the prune skips hash-keyed entries and `revocationSeq` cannot see a revocation that
  // predates the walk. The delay below is what makes the window observable: with a synchronous
  // fake, an un-awaited delete and an awaited one are indistinguishable.
  const logoutToken = 'logout-window-probe-token';
  const logoutHash = db.hashSessionToken(logoutToken);
  // How long the fake holds a DELETE before it applies. It only has to be longer than zero:
  // the picture of the store below is taken in the same synchronous step the sign-out returns
  // in, so no timer can fire between the return and the read, whatever this is set to.
  const DELETE_WINDOW_MS = 250;
  const slowStore = makeStore(
    [{ ...eligible(1, { offset: 9000 })[0], token_hash: logoutHash, entity_id: 'logout_probe' }],
    { deleteDelayMs: DELETE_WINDOW_MS }
  );
  const realLiveStore = db.liveStore;
  db.liveStore = () => slowStore;
  try {
    db.activeSessions.set(logoutHash, {
      token: logoutToken, role: 'CUSTOMER', entityId: 'logout_probe',
      entity: { id: 'logout_probe', role: 'CUSTOMER' },
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: FUTURE
    });
    const seqBeforeLogout = db.revocationSeq;
    const removed = await db.invalidateSession(logoutToken);
    // Taken without an intervening await, so it is exactly what a reconcile tick started at
    // that moment would read. Feeding the tick a copy rather than `slowStore` itself is
    // deliberate: the tick's own prune awaits a delete, which on a shared fake would give the
    // sign-out's in-flight delete a chance to land and hide the window.
    const rowsAtReturn = slowStore.rows().map((r) => ({ ...r }));
    check('RC-23', removed === true && db.revocationSeq === seqBeforeLogout + 1
      && !db.activeSessions.has(logoutHash),
      `the sign-out took the bearer out of this process and moved the guard it is waiting on `
      + `(removed=${removed}, revocationSeq ${seqBeforeLogout} -> ${db.revocationSeq})`);
    check('RC-24', rowsAtReturn.length === 0,
      `the durable row was gone when the call returned: the store held ${rowsAtReturn.length} of 1 `
      + 'at that instant (0 = the delete landed first, 1 = a walk started then still saw the revoked session)');

    // The consequence, not just the timing.
    const tickStore = makeStore(rowsAtReturn);
    const tickAfterLogout = await db.reconcileSessions({ store: tickStore, pageSize: PAGE });
    check('RC-25', !db.activeSessions.has(logoutHash) && tickAfterLogout.adopted === 0,
      `a tick started the moment the sign-out returned read ${tickAfterLogout.rows} eligible row(s) and `
      + `adopted ${tickAfterLogout.adopted}; this process honours the signed-out bearer=`
      + `${db.activeSessions.has(logoutHash)}`);

    // Not a lost write: the statement does land, one round trip late. Green before the fix as
    // well as after it, and here so the checks above cannot be satisfied by a delete that
    // never happens.
    await new Promise((r) => { setTimeout(r, DELETE_WINDOW_MS + 150); });
    check('RC-26', slowStore.rows().length === 0 && slowStore.log.deletes >= 1,
      `the DELETE does arrive (${slowStore.log.deletes} delete statement(s) issued, `
      + `${slowStore.rows().length} row(s) left) — the defect is the window it leaves open, not a write that was dropped`);
    check('RC-27', !db.activeSessions.has(logoutHash),
      'and after the delete landed plus a full tick, this process has no copy of the revoked bearer');
  } finally {
    db.liveStore = realLiveStore;
    db.activeSessions.delete(logoutHash);
  }

  // The same guard RC-22 runs over the revocation paths, aimed at this one: a future sign-out
  // that goes back to a fire-and-forget delete would pass every check above if it were reached
  // through a call site that does not wait, so the wait is asserted where it is written.
  const serverSrc = require('fs').readFileSync(require.resolve('./src/server.js'), 'utf8').split('\n');
  const unawaitedCallSites = [];
  [['./src/database.js', databaseSrc], ['./src/server.js', serverSrc]].forEach(([rel, lines]) => {
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line.includes('.invalidateSession(')) return;
      if (line.startsWith('//') || line.startsWith('*')) return;
      if (!/\bawait\s+(?:db|this)\.invalidateSession\(/.test(line)) unawaitedCallSites.push(`${rel}:${i + 1}`);
    });
  });
  check('RC-28', unawaitedCallSites.length === 0, unawaitedCallSites.length
    ? `these sign-out call sites do not wait for the revocation: ${unawaitedCallSites.join(', ')}`
    : 'every invalidateSession call site awaits it, so nothing can re-widen the window by dropping the await');

  // --- The write half is separable from the convergence half ------------------------------
  // F-13 measured that the tick's first statement deletes expired rows from whatever store
  // `liveStore()` serves, so the chain runner boots its harness and lane with the tick off
  // entirely. That left two admin suites waiting for an adoption that nobody performs any
  // more, and the answer is not a background timer: they boot a dedicated instance with
  // `NABIN_SESSION_PRUNE=off`. This switch is only worth having if it removes the DELETE and
  // keeps the adoption, so both halves are measured against identical stores.
  {
    const rows13 = [...eligible(60, { offset: 9100 }), ...eligible(4, { offset: 9200 })];
    rows13.forEach((r, i) => { if (i % 9 === 0) r.expires_at = PAST; });
    const expired13 = rows13.filter((r) => r.expires_at === PAST);
    const eligible13 = rows13.filter((r) => r.expires_at !== PAST);
    const knownBefore = new Set(db.activeSessions.keys());
    const shouldAdopt = eligible13.filter((r) => !knownBefore.has(r.token_hash)).length;

    const keep = makeStore(rows13.map((r) => ({ ...r })));
    const kept = await db.reconcileSessions({ store: keep, pageSize: PAGE, prune: false });
    check('RC-29', keep.log.deletes === 0 && keep.rows().length === rows13.length
      && kept.complete && kept.adopted === shouldAdopt,
      `prune:false issues ${keep.log.deletes} DELETE statement(s) and leaves all ${keep.rows().length} row(s), `
      + `including the ${expired13.length} expired one(s), while still adopting ${kept.adopted} of the `
      + `${eligible13.length} eligible session(s) this process had never issued`);

    // Same store, same page size, same starting memory: the only difference is the write.
    eligible13.forEach((r) => db.activeSessions.delete(r.token_hash));
    const sweep = makeStore(rows13.map((r) => ({ ...r })));
    const swept = await db.reconcileSessions({ store: sweep, pageSize: PAGE });
    check('RC-30', sweep.log.deletes === 1 && sweep.rows().length === rows13.length - expired13.length
      && swept.complete && swept.adopted === kept.adopted,
      `the default tick on the same rows deletes once (${sweep.log.deletes} statement, `
      + `${sweep.rows().length} row(s) left of ${rows13.length}) and adopts ${swept.adopted} — the knob takes the `
      + 'write, not the convergence');
    eligible13.forEach((r) => db.activeSessions.delete(r.token_hash));

    const dbSrc = require('fs').readFileSync(require.resolve('./src/database.js'), 'utf8');
    const bootSrc = require('fs').readFileSync(require.resolve('./src/server.js'), 'utf8');
    const gate = dbSrc.slice(dbSrc.indexOf('async reconcileSessions('));
    check('RC-31', /reconcileSessions\(\{ store = this\.liveStore\(\), pageSize, prune = true \} = \{\}\)/.test(gate)
      && gate.indexOf('if (prune) {') < gate.indexOf(".from('backend_sessions').delete()")
      && /\.lte\('expires_at', nowIso\)/.test(gate.slice(0, gate.indexOf('seqBeforeWalk')))
      && /reconcileSessions\(\{ prune: !pruneOff \}\)/.test(bootSrc)
      && /NABIN_SESSION_PRUNE/.test(bootSrc),
      'the DELETE sits inside the prune guard, the parameter defaults to true, and the server tick passes '
      + '`{ prune: !pruneOff }` from NABIN_SESSION_PRUNE — production is unchanged unless a caller opts out');
  }

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
