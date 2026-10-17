'use strict';
/*
 * RMS WRITE HONESTY GUARD — local only. The store is faked at the wire against a loopback URL,
 * so no query leaves this process and nothing is written anywhere.
 *
 * Why this file exists. `RestaurantManagementRepository` answers the restaurant merchant routes at
 * src/server.js:5691-6159 (31 registrations, 20 of them mutations). Two things were untrue in every
 * one of those answers:
 *
 * 1. A durable write the database refused was reported as saved. All four write sites in that file
 *    (the `merchants` UPDATE in `_persistSettings`, the two `restaurant_sections` INSERTs in
 *    `_ensureSection`/`createSection`, the `restaurant_tables` INSERT in `createTable`) either
 *    discard the result of the call entirely or print `[RMS] … persistence failed …` with
 *    `console.warn` and then do `this._tables.set(id, table); return table;`. supabase-js resolves
 *    `{data, error}` for a PostgreSQL refusal rather than rejecting, so a refused insert lands in
 *    the caller's lap as a success, the route's own `catch` never runs, and the merchant is told
 *    `{success: true}` for a row that exists only in this process. `_persistSettings` additionally
 *    begins `if (!this.pgEnabled) return;` and `updateSettings` wrote the new value into the
 *    settings Map *before* attempting the update, so even a thrown refusal left the process serving
 *    a tax rate the database had rejected.
 *
 * 2. The answer never said which store it came from. `rmsPgIoEnabled()` requires
 *    `nabinEnv.restLocal === true`, which the committed `.env` does not set, so `this.pgEnabled` is
 *    false in the ordinary developer run and every RMS response is served from the Maps the
 *    constructor makes at `:107-115` — while the route replies `success: true` with no `dataSource`,
 *    the field the rest of this backend uses for exactly that distinction (29 other `dataSource:`
 *    replies in src/server.js, 18 of them the literal `'postgres'`, before these routes gained it).
 *
 *    Worse than the gate: when this guard was written only three tables were written durably, and a
 *    bill, a payment, a refund, a dining session, a reservation, a KDS ticket or a staff row was
 *    in-memory *whatever the gate says* — which is why the store label has to be per-domain, and why
 *    a blanket `dataSource: 'postgres'` on those routes would be a new lie rather than a fix. That
 *    durable half has since grown, so this file no longer asserts any particular split: it measures
 *    the write surface from the code (a `.from(…)` builder with a write verb, plus every `rms_*`
 *    function the repository calls whose own body in migration 043 writes a table) and demands that
 *    the repository's declaration and every domain's `dataSource` answer match that measurement.
 *    Nothing in here is a hard-coded list of what is still memory-only, because that list is exactly
 *    what the implementation is meant to shrink — pinning it would make the guard fight the fix.
 *
 * The vocabulary of the fix is already the platform's: `storeFailure(what, error)` marks a refused
 * durable write with `.storeFailure` plus the engine's own SQLSTATE on `.code` and the engine's
 * sentence on `.details` (src/repositories/PaymentRepository.js:25, LedgerRepository.js:57,
 * JobRepository.js:16), and `replyStoreError` (src/server.js:347) is the single place that decides
 * 503 vs 409 vs 500 from that SQLSTATE, logging the engine's words instead of echoing them.
 *
 * Everything asserted here is derived, not restated: the durable table set comes from scanning the
 * repository's own query builders for a write verb and its own `rms_*` calls against migration
 * 043's function bodies, the seven RMS tables come from reading migration 041's own CREATE TABLE
 * statements, the route family and its verbs come from the registrations in src/server.js, the
 * domain names come from the arguments the routes pass, and the store answers come from running the
 * shipped class against a faked wire. Every check reports how many sites it inspected, and
 * inspecting nothing is a failure, not a pass.
 *
 * RED baseline, measured before the fix landed: 5/20 passed. RMSH-01, RMSH-02 and RMSH-03 were green
 * (the scanners saw the code and the faked loopback store really did open the gate), RMSH-11 and
 * RMSH-15 were green (the accepted-write controls) — everything else failed: each refused durable
 * write answered {threw: false} and left its Map committed, `dataSourceFor` did not exist, and 20 of
 * 20 mutation routes named neither the store nor a store-failure branch.
 */
process.env.NABIN_TEST_MODE = 'true';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'rms_write_honesty_test.js');
const REPO = path.join(__dirname, 'src', 'repositories', 'RestaurantManagementRepository.js');
const SERVER = path.join(__dirname, 'src', 'server.js');
const MIGRATION = path.join(__dirname, '..', 'supabase', 'migrations', '041_restaurant_management_system_core.sql');
const MIGRATION_043 = path.join(__dirname, '..', 'supabase', 'migrations', '043_rms_durable_persistence.sql');

const REPO_SRC = fs.readFileSync(REPO, 'utf8');
const SERVER_SRC = fs.readFileSync(SERVER, 'utf8');
const MIG_SRC = fs.readFileSync(MIGRATION, 'utf8');
let MIG043_SRC = '';
let MIG043_ERROR = null;
try {
  MIG043_SRC = fs.readFileSync(MIGRATION_043, 'utf8');
} catch (err) {
  MIG043_ERROR = err.message;
}

const results = [];
function check(id, cond, detail) {
  results.push({ id, ok: Boolean(cond), detail });
  console.log(`${cond ? '✅' : '❌'} [${id}] ${cond ? 'PASS' : 'FAIL'}  ${detail}`);
}

const MERCHANT = '00000000-0000-4000-8000-000000000201';

// ---------------------------------------------------------------- derivations

// One query builder = one `.from('t')` up to the next `.from('t')`. A builder is a write when the
// text that follows it calls a write verb before any new builder starts, which is how the durable
// surface is measured from the code rather than from a list someone wrote down.
function builders(text) {
  const starts = [...text.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)];
  return starts.map((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < starts.length ? starts[i + 1].index : Math.min(text.length, from + 600);
    return { table: m[1], tail: text.slice(from, to) };
  });
}
const WRITE_VERB = /\.(insert|update|delete|upsert)\s*\(/;
const REPO_BUILDERS = builders(REPO_SRC);
const WRITE_BUILDERS = REPO_BUILDERS.filter((b) => WRITE_VERB.test(b.tail));
const BUILDER_WRITTEN_TABLES = [...new Set(WRITE_BUILDERS.map((b) => b.table))].sort();
const REFERENCED_TABLES = [...new Set(REPO_BUILDERS.map((b) => b.table))].sort();

// The second durable channel. `this._rpc('what', 'rms_x', args)` writes through a plpgsql function,
// so a table it mutates is invisible to the builder scan above; the write surface is therefore
// measured by reading each called function's own body in migration 043. The same derivation catches
// a repository that calls a function the applied migration never defines, which would otherwise
// shrink the durable list by silently dropping the call.
const RPC_CALLS = [...REPO_SRC.matchAll(/this\._rpc\(\s*'([^']*)'\s*,\s*'(rms_[a-z_0-9]+)'/g)]
  .map((m) => ({ what: m[1], fn: m[2] }));
const RPC_NAMES = [...new Set(RPC_CALLS.map((c) => c.fn))].sort();

// One function body runs from its CREATE OR REPLACE FUNCTION line to the next one, so the write
// verbs found inside it belong to that function and not to its neighbour.
function functionBodies(text) {
  const starts = [...text.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_0-9]+)/gi)];
  const out = new Map();
  starts.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < starts.length ? starts[i + 1].index : text.length;
    out.set(m[1], text.slice(from, to));
  });
  return out;
}
const FN_BODIES = functionBodies(MIG043_SRC);
const RPC_MISSING_FNS = RPC_NAMES.filter((n) => !FN_BODIES.has(n));
const RPC_WRITTEN_TABLES = [...new Set(RPC_NAMES
  .filter((n) => FN_BODIES.has(n))
  .flatMap((n) => [...FN_BODIES.get(n)
    .matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+public\.([a-z_]+)/gi)].map((m) => m[1]))
)].sort();
const WRITTEN_TABLES = [...new Set([...BUILDER_WRITTEN_TABLES, ...RPC_WRITTEN_TABLES])].sort();

// Which methods answer from the database at all — derived from the call graph, not from a list. A
// public method is a durable store method when its own body holds a builder write or a durable
// `_rpc` call — write or read, which is why `getSalesReport`'s `rms_sales_report` counts — or when
// it reaches one through `this.<method>()`; that is why `_persistSettings`,
// `_ensureSection`, `_generateDurableBill` and `_durableBillFor` are counted through their callers
// and `updateSettings` through `getSettings`. The gate-off child probes exactly this set, so a
// method added later cannot hide from the production-refusal claim by never being attempted.
const NOT_A_METHOD = new Set(['if', 'for', 'while', 'switch', 'return', 'catch', 'try']);
function rmsMethods(text) {
  const lines = text.split('\n');
  const out = [];
  for (let n = 0; n < lines.length; n++) {
    if (!/^  (?:async )?([A-Za-z_]\w*)\(/.test(lines[n]) || !/\{\s*$/.test(lines[n])) continue;
    const name = lines[n].match(/^  (?:async )?([A-Za-z_]\w*)\(/)[1];
    if (NOT_A_METHOD.has(name)) continue;
    let depth = 0;
    let i = n;
    for (; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth += 1; else if (ch === '}') depth -= 1; }
      if (depth <= 0) break;
    }
    out.push({ name, line: n + 1, body: lines.slice(n, i + 1).join('\n') });
  }
  return out;
}
const RMS_METHODS = rmsMethods(REPO_SRC);
const RMS_METHOD_BY_NAME = new Map(RMS_METHODS.map((r) => [r.name, r]));
RMS_METHODS.forEach((r) => {
  r.directWrite = builders(r.body).some((b) => WRITE_VERB.test(b.tail))
    || /this\._rpc\(\s*'[^']*'\s*,\s*'rms_[a-z_0-9]+'/.test(r.body);
  r.calls = [...new Set([...r.body.matchAll(/this\.([A-Za-z_]\w*)\(/g)].map((x) => x[1]))];
});
function reachesDurableStore(r, seen) {
  seen = seen || new Set();
  if (!r || seen.has(r.name)) return false;
  seen.add(r.name);
  if (r.directWrite) return true;
  return r.calls.some((c) => RMS_METHOD_BY_NAME.has(c) && reachesDurableStore(RMS_METHOD_BY_NAME.get(c), seen));
}
const DURABLE_STORE_METHODS = RMS_METHODS
  .filter((r) => !r.name.startsWith('_') && reachesDurableStore(r))
  .map((r) => r.name).sort();

// The RMS schema migration's own table list — the set a durable RMS record could live in.
const MIG_RMS_TABLES = [...MIG_SRC.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-z_]+)/g)]
  .map((m) => m[1]).filter((t) => t.startsWith('restaurant_')).sort();

// Every table the whole migration set creates, scanned rather than listed, so a write aimed at a
// table that exists in nobody's schema is caught instead of measured as durable.
const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');
const SCHEMA_TABLES = [...new Set(fs.readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .flatMap((f) => [...fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    .matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1]))
)].sort();

// The RMS route family: every registration whose path is in the family, with its verb and the
// handler text bounded by the next registration.
const ALL_REGS = [...SERVER_SRC.matchAll(/app\.(get|post|put|patch|delete)\s*\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)];
function registrationPaths(arg) {
  const raw = arg.startsWith('[') ? arg.match(/'[^']*'|"[^"]*"/g) : [arg];
  return (raw || []).map((s) => s.slice(1, -1));
}
const RMS_REGS = ALL_REGS.map((m, i) => {
  const paths = registrationPaths(m[2]);
  if (!paths.some((p) => /\/rms\//.test(p))) return null;
  const end = i + 1 < ALL_REGS.length ? ALL_REGS[i + 1].index : SERVER_SRC.length;
  return {
    verb: m[1].toLowerCase(), paths, body: SERVER_SRC.slice(m.index, end),
    line: SERVER_SRC.slice(0, m.index).split('\n').length
  };
}).filter(Boolean);
const RMS_MUTATIONS = RMS_REGS.filter((r) => r.verb !== 'get');
const RMS_READS = RMS_REGS.filter((r) => r.verb === 'get');

// A route's own failure handling, from its `catch (err)` to the end of the registration. Sliced by
// text rather than assumed to be the whole body, because RMSH-24 has to prove which branch comes
// first: a store-failure test written after the route's `res.status(...)` default would never run.
function catchSegment(body) {
  const i = body.indexOf('} catch (err) {');
  if (i === -1) return '';
  const end = body.indexOf('\n});', i);
  return end === -1 ? body.slice(i) : body.slice(i, end);
}
const STORE_LABEL = /dataSourceFor\(\s*'[a-z_]+'\s*\)/;
const STORE_BRANCH = /\(err\.storeFailure\s*\|\|\s*supabaseHelper\.isStoreUnreachable\(err\)\)/;

// The domain vocabulary is the repository's own map, read from the child, and the durable half of
// it is measured: a domain is durable exactly when the table it names is in the write surface.
function partitionDomains(domainTables) {
  const names = Object.keys(domainTables || {});
  const durable = names.filter((d) => domainTables[d] && WRITTEN_TABLES.includes(domainTables[d]));
  const memory = names.filter((d) => !durable.includes(d));
  return { all: names, durable, memory };
}

// ---------------------------------------------------------------- the faked store (child)

const FAKE_LOCAL_STORE = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:59999',
  SUPABASE_ANON_KEY: 'local-only-fake-store-key',
  SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
  DATABASE_URL: '',
  LOCAL_POSTGRES_RMS: '',
  LOCAL_POSTGRES_URL: ''
};
const ENGINE = {
  refuse: { code: '42501', message: 'permission denied for table restaurant_tables', details: null, hint: null },
  missing: { code: '42P01', message: 'relation "restaurant_tables" does not exist', details: null, hint: null }
};

// The plan is read at the moment each builder acts, so one child process can walk every scenario
// by repointing it; each scenario still runs against a fresh repository.
let currentPlan = {};
const planFor = (p) => { currentPlan = p; };

async function runChild() {
  const { supabaseAdmin, isLivePostgres, isStoreUnreachable, nabinEnv } = require('./src/supabase');
  const RestaurantManagementRepository = require('./src/repositories/RestaurantManagementRepository');

  // Reads answer "no row" so the flow reaches the write; writes answer whatever the plan says.
  function builder(table) {
    const kind = currentPlan[table] || 'ok';
    const act = () => {
      if (kind === 'ok') return Promise.resolve({ data: null, error: null });
      if (kind === 'unreachable') {
        const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
        cause.code = 'ECONNREFUSED';
        cause.syscall = 'connect';
        const err = new TypeError('fetch failed');
        err.cause = cause;
        return Promise.reject(err);
      }
      return Promise.resolve({ data: null, error: ENGINE[kind] || { code: kind, message: `faked ${kind}` } });
    };
    const self = {};
    ['insert', 'update', 'delete', 'upsert', 'select', 'eq', 'neq', 'order', 'limit']
      .forEach((mm) => { self[mm] = () => self; });
    self.maybeSingle = () => Promise.resolve({ data: null, error: null });
    self.single = act;
    self.then = (onOk, onErr) => act().then(onOk, onErr);
    return self;
  }
  supabaseAdmin.from = (table) => builder(table);

  const fresh = () => new RestaurantManagementRepository({ merchants: [] });
  const attempt = async (fn) => {
    const repo = fresh();
    try {
      const value = await fn(repo);
      return { threw: false, value, repo };
    } catch (err) {
      return {
        threw: true,
        storeFailure: Boolean(err && err.storeFailure),
        code: err && err.code,
        status: err && err.status,
        message: err && err.message,
        details: err && err.details,
        unreachable: Boolean(err && isStoreUnreachable(err)),
        repo
      };
    }
  };
  const R = RestaurantManagementRepository;
  const domainKeys = Object.keys((R.RMS_DOMAIN_TABLES && typeof R.RMS_DOMAIN_TABLES === 'object')
    ? R.RMS_DOMAIN_TABLES : {});
  const label = (repo) => (typeof repo.dataSourceFor === 'function'
    ? domainKeys.reduce((acc, d) => {
        try { acc[d] = repo.dataSourceFor(d); } catch (e) { acc[d] = `THROWS(${e.message})`; }
        return acc;
      }, {})
    : null);
  const v = {
    gate: { live: isLivePostgres === true, restLocal: Boolean(nabinEnv && nabinEnv.restLocal === true) },
    declaredDurable: Array.isArray(R.RMS_DURABLE_TABLES) ? [...R.RMS_DURABLE_TABLES].sort() : null,
    domainTables: R.RMS_DOMAIN_TABLES && typeof R.RMS_DOMAIN_TABLES === 'object' ? R.RMS_DOMAIN_TABLES : null
  };

  // 1. every write accepted — the control that keeps honesty from becoming a blanket refusal.
  planFor({});
  const ok = await attempt((repo) => repo.createTable(MERCHANT, { table_number: '41', capacity: 2, section_name: 'RWH Floor' }));
  v.tableAccepted = {
    threw: ok.threw, tablesHeld: ok.repo._tables.size, sectionsHeld: ok.repo._sections.size,
    answer: ok.threw ? String(ok.message) : String((ok.value && ok.value.tableNumber) || 'no row')
  };
  v.labelWithWrite = label(ok.repo);

  // 2. every write refused by the engine.
  planFor({ restaurant_tables: 'refuse', restaurant_sections: 'refuse', merchants: 'refuse' });
  const refused = await attempt((repo) => repo.createTable(MERCHANT, { table_number: '42', capacity: 2, section_name: 'RWH Floor' }));
  v.tableRefused = {
    threw: refused.threw, storeFailure: refused.storeFailure, code: refused.code, details: refused.details,
    message: refused.message, tablesHeld: refused.repo._tables.size, sectionsHeld: refused.repo._sections.size,
    leaksEngineText: /permission denied|does not exist|violates/.test(String(refused.message || ''))
  };
  const secRefused = await attempt((repo) => repo.createSection(MERCHANT, { name: 'RWH Refused' }));
  v.sectionRefused = { threw: secRefused.threw, storeFailure: secRefused.storeFailure, sectionsHeld: secRefused.repo._sections.size };

  // The settings Map is seeded by the read first, so a commit made before the write landed shows up.
  // The seed is captured outside the thrown call because the refusal is the case under test.
  let seededTax;
  const settingsRefused = await attempt(async (repo) => {
    const before = await repo.getSettings(MERCHANT);
    seededTax = before.taxRatePercent;
    await repo.updateSettings(MERCHANT, { tax_rate_percent: 9.5 });
    return before.taxRatePercent;
  });
  v.settingsRefused = {
    threw: settingsRefused.threw, storeFailure: settingsRefused.storeFailure,
    heldTax: settingsRefused.repo._settings.get(MERCHANT) ? settingsRefused.repo._settings.get(MERCHANT).taxRatePercent : 'unset',
    previousTax: seededTax === undefined ? 'not reached' : seededTax
  };

  // 3. the store is simply gone.
  planFor({ restaurant_tables: 'unreachable', restaurant_sections: 'unreachable', merchants: 'unreachable' });
  const gone = await attempt((repo) => repo.createTable(MERCHANT, { table_number: '43', capacity: 2, section_name: 'RWH Floor' }));
  v.tableUnreachable = { threw: gone.threw, unreachable: gone.unreachable, storeFailure: gone.storeFailure, tablesHeld: gone.repo._tables.size };
  const settingsGone = await attempt((repo) => repo.updateSettings(MERCHANT, { tax_rate_percent: 8.5 }));
  v.settingsUnreachable = { threw: settingsGone.threw, unreachable: settingsGone.unreachable };

  // 4. a production process whose durability gate is CLOSED may not serve an RMS write out of its
  // own memory. Only the gate-off child can reach that branch — with the gate open the durable
  // path runs and a store refusal is the outcome under RMSH-05..08, not this one.
  // Which methods are attempted is not decided here: the parent derives the set from the
  // repository's own call graph and hands it down, so a new durable store method shows up as a red check
  // naming it rather than as an untested method. Each call is one that would succeed from memory
  // in development (RMSH-15), which is what makes the refusal the thing under test.
  if (!(isLivePostgres === true && nabinEnv && nabinEnv.restLocal === true)) {
    process.env.NODE_ENV = 'production';
    const mapTotal = (repo) => Object.values(repo)
      .filter((x) => x instanceof Map)
      .reduce((n, m) => n + m.size, 0);
    v.memoryBaseline = mapTotal(fresh());
    const TID = '00000000-0000-4000-8000-000000000999';
    const TID2 = '00000000-0000-4000-8000-000000000998';
    const SID = '00000000-0000-4000-8000-000000000888';
    const BID = '00000000-0000-4000-8000-000000000777';
    const KID = '00000000-0000-4000-8000-000000000666';
    const RID = '00000000-0000-4000-8000-000000000555';
    const STF = '00000000-0000-4000-8000-000000000444';
    const ORD = '00000000-0000-4000-8000-000000000333';
    const WHEN = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const INVOCATIONS = {
      updateSettings: (r) => r.updateSettings(MERCHANT, { tax_rate_percent: 9.5 }),
      updatePaymentSettings: (r) => r.updatePaymentSettings(MERCHANT, { upi_id: 'rwh@okhdfcbank' }),
      createSection: (r) => r.createSection(MERCHANT, { name: 'RWH Floor' }),
      createTable: (r) => r.createTable(MERCHANT, { table_number: '44', capacity: 2, section_name: 'RWH Floor' }),
      updateTable: (r) => r.updateTable(MERCHANT, TID, { capacity: 4 }),
      setTableStatus: (r) => r.setTableStatus(MERCHANT, TID, 'CLEANING'),
      regenerateTableQr: (r) => r.regenerateTableQr(MERCHANT, TID),
      openSession: (r) => r.openSession(MERCHANT, TID, { guest_count: 2 }),
      getOrCreateActiveSession: (r) => r.getOrCreateActiveSession(MERCHANT, TID, { guest_count: 2 }),
      openTableSession: (r) => r.openTableSession(MERCHANT, TID, { guest_count: 2 }),
      recordSessionOrder: (r) => r.recordSessionOrder(SID, { id: ORD }, MERCHANT),
      attachOrderToSession: (r) => r.attachOrderToSession(MERCHANT, SID, { id: ORD }),
      transferSession: (r) => r.transferSession(MERCHANT, SID, TID2),
      closeSession: (r) => r.closeSession(MERCHANT, SID, { closedBy: 'Manager Rwh' }),
      createReservation: (r) => r.createReservation(MERCHANT, {
        table_id: TID, customer_name: 'Rwh Guest', customer_phone: '9999900011',
        party_size: 2, reservation_time: WHEN
      }),
      updateReservationStatus: (r) => r.updateReservationStatus(MERCHANT, RID, 'CONFIRMED'),
      generateSessionBill: (r) => r.generateSessionBill(MERCHANT, SID),
      getBillForSession: (r) => r.getBillForSession(MERCHANT, SID),
      splitBill: (r) => r.splitBill(MERCHANT, BID, 2),
      recordBillPayment: (r) => r.recordBillPayment(MERCHANT, BID, { amount: 10, paymentMethod: 'CASH' }),
      getBillReceipt: (r) => r.getBillReceipt(MERCHANT, BID),
      recordBillRefund: (r) => r.recordBillRefund(MERCHANT, BID, { amount: 10, paymentMethod: 'CASH' }),
      createKdsTicket: (r) => r.createKdsTicket({ merchantId: MERCHANT, orderId: ORD }),
      updateKdsTicketStatus: (r) => r.updateKdsTicketStatus(MERCHANT, KID, 'PREPARING'),
      recordTakeawayHandover: (r) => r.recordTakeawayHandover(MERCHANT, ORD, 'Staff Rwh'),
      createStaff: (r) => r.createStaff(MERCHANT, { name: 'Rwh Cashier', phone: '9999900022', role: 'CASHIER' }),
      deleteStaff: (r) => r.deleteStaff(MERCHANT, STF),
      getSalesReport: (r) => r.getSalesReport(MERCHANT, {}),
      getChannelSalesReport: (r) => r.getChannelSalesReport(MERCHANT)
    };
    const required = JSON.parse(process.env.NABIN_RWH_PROBES || '[]');
    v.productionProbes = {};
    for (const name of required) {
      const call = INVOCATIONS[name];
      if (!call) { v.productionProbes[name] = { missingInvocation: true }; continue; }
      const one = await attempt(call);
      v.productionProbes[name] = {
        threw: one.threw, storeFailure: one.storeFailure, code: one.code, status: one.status,
        message: one.message, mapsGrew: mapTotal(one.repo) - v.memoryBaseline
      };
    }
    // The read side of the same promise: with the gate shut a production process answers an outage
    // rather than the empty floor plan its own untouched Map happens to hold.
    const prodRead = await attempt((repo) => repo.getTables(MERCHANT));
    v.productionReadRefusal = {
      threw: prodRead.threw, storeFailure: prodRead.storeFailure, code: prodRead.code,
      status: prodRead.status, message: prodRead.message
    };

    // RMSH-23: the guard is only worth having if the 503 above is the mechanism's and not something
    // each method would answer on its own. So disable `_rejectMemoryFallback` on the prototype,
    // still under NODE_ENV=production, and run the same invocations again. Whatever refuses now
    // refuses for a reason of its own; whatever commits to a Map is what the mechanism was
    // preventing. The prototype is put back before the child reports, and the baseline comparison
    // still holds because every attempt gets a fresh repository.
    const original = R.prototype._rejectMemoryFallback;
    R.prototype._rejectMemoryFallback = function rejectMemoryFallback() {};
    v.neuteredProbes = {};
    for (const name of required) {
      const call = INVOCATIONS[name];
      if (!call) continue;
      const one = await attempt(call);
      v.neuteredProbes[name] = {
        threw: one.threw, storeFailure: one.storeFailure, code: one.code, status: one.status,
        message: one.message, mapsGrew: mapTotal(one.repo) - v.memoryBaseline
      };
    }
    const neuteredRead = await attempt((repo) => repo.getTables(MERCHANT));
    v.neuteredRead = {
      threw: neuteredRead.threw, storeFailure: neuteredRead.storeFailure,
      code: neuteredRead.code, status: neuteredRead.status
    };
    R.prototype._rejectMemoryFallback = original;
    v.neuteredRestored = R.prototype._rejectMemoryFallback === original;
    process.env.NODE_ENV = 'development';
  }

  console.log(`RWH_VERDICT ${JSON.stringify(v)}`);
}

// ---------------------------------------------------------------- parent

function spawn(liveFlag) {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 240000,
    env: Object.assign({}, process.env, FAKE_LOCAL_STORE, {
      NABIN_RWH_CHILD: '1',
      NABIN_RWH_PROBES: JSON.stringify(DURABLE_STORE_METHODS),
      SUPABASE_POSTGRES_LIVE: liveFlag ? 'true' : 'false'
    })
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('RWH_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict from the child (gate ${liveFlag ? 'on' : 'off'}): ${String(res.stderr || res.stdout || '').slice(-400)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('RWH_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

function main() {
  check('RMSH-01',
    REPO_BUILDERS.length > 0 && (WRITE_BUILDERS.length > 0 || RPC_CALLS.length > 0),
    `the repository runs ${REPO_BUILDERS.length} query builder(s) against ${REFERENCED_TABLES.length} table(s) [${REFERENCED_TABLES.join(', ')}], of which ${WRITE_BUILDERS.length} ${WRITE_BUILDERS.length === 1 ? 'is' : 'are'} a write on [${BUILDER_WRITTEN_TABLES.join(', ')}], and it calls ${RPC_CALLS.length} durable function(s) [${RPC_NAMES.join(', ')}] whose own SQL writes [${RPC_WRITTEN_TABLES.join(', ')}] — the whole RMS durable surface measured from its own code, across both channels`);

  const durableRms = MIG_RMS_TABLES.filter((t) => WRITTEN_TABLES.includes(t));
  const memoryOnlyRms = MIG_RMS_TABLES.filter((t) => !WRITTEN_TABLES.includes(t));
  const writingToUnknown = WRITTEN_TABLES.filter((t) => !SCHEMA_TABLES.includes(t));
  check('RMSH-02',
    MIG_RMS_TABLES.length > 0 && SCHEMA_TABLES.length > 0 && writingToUnknown.length === 0,
    `the repository's ${WRITTEN_TABLES.length} written table(s) all name a table some migration in supabase/migrations actually creates [${SCHEMA_TABLES.length} CREATE TABLE statement(s) scanned] — a write aimed at a table the schema never made would be measured as durable and refused by the engine forever. ${MIG_RMS_TABLES.length} RMS table(s) from 041 split into ${durableRms.length} durably written [${durableRms.join(', ') || 'none'}] and ${memoryOnlyRms.length} named by no write at all [${memoryOnlyRms.join(', ') || 'none'}]; the latter live in the constructor's Maps whatever the gate says, which is why the store label has to be per-domain`);

  const gateOn = spawn(true);
  const gateOff = spawn(false);
  if (!gateOn.ok || !gateOff.ok) {
    check('RMSH-03', false, `the child did not answer — ${gateOn.detail || ''} ${gateOff.detail || ''}`);
    return finish();
  }
  const V = gateOn;

  check('RMSH-03', V.gate.live === true && V.gate.restLocal === true,
    `the faked loopback store is recognised as live PostgreSQL (${V.gate.live}) on a local REST host (${V.gate.restLocal}), so the durability gate is genuinely open in this run and the durable branches below are the ones actually executed`);

  check('RMSH-04',
    Array.isArray(V.declaredDurable) && V.declaredDurable.join() === WRITTEN_TABLES.join(),
    `the repository declares its durable tables as [${(V.declaredDurable || []).join(', ') || 'NOT DECLARED'}] while its code writes [${WRITTEN_TABLES.join(', ')}] — declaring a table it never writes would promise a row no query creates, and omitting one it does write would under-report a real record`);

  check('RMSH-05', V.tableRefused.threw === true && V.tableRefused.storeFailure === true && V.tableRefused.code === '42501',
    `a restaurant_tables insert the store refused answered ${JSON.stringify({ threw: V.tableRefused.threw, storeFailure: V.tableRefused.storeFailure, code: V.tableRefused.code })} — the refusal has to reach the route as a classified store failure, because before this guard the same engine answer was a console.warn followed by {success: true}`);

  check('RMSH-06',
    V.tableRefused.threw === true && V.tableRefused.tablesHeld === 0 && V.tableAccepted.tablesHeld === 1,
    `after that refusal the in-memory table store holds ${V.tableRefused.tablesHeld} row(s) and the section store ${V.tableRefused.sectionsHeld}, while the accepted write holds ${V.tableAccepted.tablesHeld} — a table the engine refused must not be kept as though it were saved`);

  check('RMSH-07',
    V.tableRefused.threw === true && V.tableRefused.leaksEngineText === false && typeof V.tableRefused.details === 'string',
    `the refusal's client-visible message is ${JSON.stringify(V.tableRefused.message)} (engine text leaked: ${V.tableRefused.leaksEngineText}) with the engine's own sentence on details as ${JSON.stringify(V.tableRefused.details)} — schema words belong in the log, not in a merchant's response`);

  check('RMSH-08',
    V.tableUnreachable.threw === true && V.tableUnreachable.unreachable === true && V.tableUnreachable.tablesHeld === 0 && V.settingsUnreachable.unreachable === true,
    `a store that is simply gone answers ${JSON.stringify({ table: V.tableUnreachable, settings: V.settingsUnreachable })} so the route can reply 503 rather than report a saved table`);

  check('RMSH-09',
    V.sectionRefused.threw === true && V.sectionRefused.storeFailure === true && V.sectionRefused.sectionsHeld === 0,
    `a refused restaurant_sections insert throws (threw=${V.sectionRefused.threw}, storeFailure=${V.sectionRefused.storeFailure}) and leaves ${V.sectionRefused.sectionsHeld} section(s) in memory — _ensureSection used to fall silently through to the memory path, which is how a floor that was never written became a table's home`);

  check('RMSH-10',
    V.settingsRefused.threw === true && V.settingsRefused.storeFailure === true && V.settingsRefused.heldTax === V.settingsRefused.previousTax,
    `a refused settings update answers ${JSON.stringify(V.settingsRefused)} — the store Map must still hold the previous tax rate (${V.settingsRefused.previousTax}), because updateSettings committed ${V.settingsRefused.heldTax} into _settings before attempting the update, so even a thrown refusal left this process serving a value the database rejected`);

  check('RMSH-11',
    V.tableAccepted.threw === false && V.tableAccepted.tablesHeld === 1 && V.tableAccepted.sectionsHeld >= 1,
    `with the same faked store answering {data, error: null} createTable returns its row (${JSON.stringify(V.tableAccepted)}) without throwing — durability honesty must not become a blanket refusal`);

  const L = V.labelWithWrite || {};
  const P = partitionDomains(V.domainTables);
  check('RMSH-12',
    P.durable.length > 0 && P.durable.every((d) => L[d] === 'postgres'),
    `with the gate open the ${P.durable.length} domain(s) whose measured write surface reaches a real table answer [${P.durable.map((d) => `${d}=${L[d]}`).join(', ')}] — the label is derived from the writes this file performs, not from the gate alone`);

  check('RMSH-13',
    P.memory.every((d) => L[d] === 'memory'),
    `with the gate open the ${P.memory.length} domain(s) with no durable write answer [${P.memory.map((d) => `${d}=${L[d]}`).join(', ') || 'none — every domain persists'}] — a domain with no measured write must never be labelled postgres, because that would promise a row no query in this file creates`);

  const O = gateOff;
  check('RMSH-14',
    O.labelWithWrite && P.all.every((d) => O.labelWithWrite[d] === 'memory'),
    `with the gate shut — the state a default developer configuration is actually in, since rmsPgIoEnabled needs nabinEnv.restLocal and the committed .env does not set it — all ${P.all.length} domains answer memory [${JSON.stringify(O.labelWithWrite)}]`);

  check('RMSH-15',
    O.tableAccepted.threw === false && O.tableAccepted.tablesHeld === 1,
    `with the gate shut createTable still succeeds from memory (${JSON.stringify(O.tableAccepted)}) — the fix is an honest label, not a refusal to work offline`);

  const domainsUsed = [...new Set(RMS_MUTATIONS.flatMap((r) => [...r.body.matchAll(/dataSourceFor\(\s*'([a-z_]+)'\s*\)/g)].map((m) => m[1])))].sort();
  const unlabeled = RMS_MUTATIONS.filter((r) => !/dataSourceFor\(\s*'[a-z_]+'\s*\)/.test(r.body))
    .map((r) => `${r.verb} ${r.paths[0]} (line ${r.line})`);
  check('RMSH-16',
    RMS_MUTATIONS.length > 0 && unlabeled.length === 0,
    unlabeled.length
      ? `${unlabeled.length} of ${RMS_MUTATIONS.length} RMS mutation route(s) answer success without naming the store that holds the row: ${unlabeled.join(' | ')}`
      : `all ${RMS_MUTATIONS.length} RMS mutation route(s) (of ${RMS_REGS.length} registrations in the family, ${RMS_READS.length} of them reads) answer through dataSourceFor() [domains named: ${domainsUsed.join(', ')}] so a merchant can tell a durable row from a Map entry`);

  const unclassified = RMS_MUTATIONS.filter((r) => !/storeFailure/.test(r.body))
    .map((r) => `${r.verb} ${r.paths[0]} (line ${r.line})`);
  check('RMSH-17',
    RMS_MUTATIONS.length > 0 && unclassified.length === 0,
    unclassified.length
      ? `${unclassified.length} of ${RMS_MUTATIONS.length} RMS mutation route(s) have no store-failure branch, so a thrown refusal still falls through to their own 400 default: ${unclassified.join(' | ')}`
      : `all ${RMS_MUTATIONS.length} RMS mutation route(s) classify a store refusal before their own 400 default, which is what keeps an outage a 503 instead of a bad request`);

  const requiredDomains = [...new Set([...domainsUsed, 'sections'])].sort();
  const missingDomains = requiredDomains.filter((d) => !P.all.includes(d));
  check('RMSH-18',
    domainsUsed.length > 0 && missingDomains.length === 0 && V.domainTables && typeof V.domainTables === 'object',
    `the ${domainsUsed.length} domain(s) the routes name [${domainsUsed.join(', ')}] plus the sections floor the repository persists are all domains the repository answers, and it keeps its own domain→table map [${V.domainTables ? Object.keys(V.domainTables).map((k) => `${k}→${V.domainTables[k] || 'none'}`).join(', ') : 'NO MAP'}] — a route naming a domain the repository has never heard of throws rather than silently claiming a store${missingDomains.length ? `, but it does not answer: ${missingDomains.join(', ')}` : ''}`);

  // No durable write may warn-and-continue: every write builder needs a throw, the persistence
  // failure warnings that used to replace one must be gone, and the function channel must
  // classify at its single point rather than at N call sites that can each forget.
  const persistWarns = [...REPO_SRC.matchAll(/console\.warn\([^)]*(?:persistence failed|Settings persistence)/g)].map((m) => m[0]);
  const throwSites = [...REPO_SRC.matchAll(/throw storeFailure\(/g)].length;
  const rpcClassifies = /if \(error\) throw storeFailure\(what, error\);/.test(REPO_SRC)
    && /if \(data\.success === false\)/.test(REPO_SRC);
  check('RMSH-19',
    WRITE_BUILDERS.length > 0 && persistWarns.length === 0 && throwSites >= WRITE_BUILDERS.length && rpcClassifies,
    `${WRITE_BUILDERS.length} builder write site(s) need ${WRITE_BUILDERS.length} throw and the file has ${throwSites}, while the ${RPC_CALLS.length} durable function call(s) share one classification point in _rpc (${rpcClassifies ? 'engine error → storeFailure, refusal → its own code at 400' : 'ABSENT'}) — ${persistWarns.length} warn-and-continue site(s) remain${persistWarns.length ? `: ${persistWarns.map((w) => w.replace(/\s+/g, ' ').slice(0, 80)).join(' | ')}` : ''}`);

  check('RMSH-20', /err\.storeFailure\s*=\s*true/.test(REPO_SRC),
    `the repository marks a refused write with the platform's own storeFailure flag (${/err\.storeFailure\s*=\s*true/.test(REPO_SRC) ? 'present' : 'ABSENT'}), the same shape PaymentRepository.js:25 and LedgerRepository.js:57 use, so replyStoreError classifies it from the SQLSTATE instead of the wording`);

  // The function channel is only measurable if the functions exist. A call site renamed or
  // misspelled against migration 043 would drop out of WRITTEN_TABLES quietly, shrinking the
  // durable list and making the declaration match a write surface that no longer includes it.
  const rpcProblems = [];
  if (MIG043_ERROR) rpcProblems.push(`043 could not be read (${MIG043_ERROR})`);
  RPC_MISSING_FNS.forEach((n) => rpcProblems.push(`${n} is called by the repository and defined by no migration`));
  check('RMSH-21',
    RPC_CALLS.length > 0 && FN_BODIES.size > 0 && rpcProblems.length === 0,
    rpcProblems.length
      ? `${rpcProblems.join('; ')}`
      : `the repository calls ${RPC_CALLS.length} durable function(s) [${RPC_NAMES.join(', ')}], every one of them defined among the ${FN_BODIES.size} functions in migration 043, and the tables their bodies write are [${RPC_WRITTEN_TABLES.join(', ')}] — the durable surface is measured from the SQL, so a call site that names a function the applied schema never created cannot hide by vanishing from the scan`);

  // RMSH-22 is the claim that Map persistence is gone from the production path, so its subject list
  // comes from the scan above rather than from the methods someone remembered to probe. A refused
  // write must also leave nothing behind in the Maps: `mapsGrew` is the delta a fresh repository
  // would not show, which is how a commit-then-throw would surface. The list is every public method
  // the scan finds that persists through the store — an RPC read such as `getSalesReport` belongs on
  // it for the same reason a write does: with the gate shut the store has the only real numbers, so
  // a production process summarising its own Maps would be a report of nothing.
  const probes = O.productionProbes || {};
  const probeProblems = [];
  if (DURABLE_STORE_METHODS.length === 0) probeProblems.push('the scan found no public durable store method, so it inspected nothing');
  DURABLE_STORE_METHODS.forEach((name) => {
    const p = probes[name];
    if (!p) { probeProblems.push(`${name} writes durably and the child never probed it`); return; }
    if (p.missingInvocation) { probeProblems.push(`${name} has no invocation in this guard`); return; }
    if (!(p.threw === true && p.storeFailure === true && p.code === 'STORE_UNAVAILABLE'
      && p.status === 503 && p.mapsGrew === 0)) {
      probeProblems.push(`${name} answered ${JSON.stringify({
        threw: p.threw, storeFailure: p.storeFailure, code: p.code, status: p.status,
        mapsGrew: p.mapsGrew, message: String(p.message || '').slice(0, 70)
      })}`);
    }
  });
  const extraProbes = Object.keys(probes).filter((n) => !DURABLE_STORE_METHODS.includes(n));
  if (extraProbes.length) probeProblems.push(`${extraProbes.join(', ')} probed but the scan says cannot write durably`);
  const read = O.productionReadRefusal;
  check('RMSH-22',
    probeProblems.length === 0 && read && read.threw === true && read.status === 503,
    probeProblems.length
      ? `with the durability gate closed and NODE_ENV=production, ${probeProblems.length} problem(s) among ${DURABLE_STORE_METHODS.length} derived durable method(s): ${probeProblems.join('; ')}`
      : `with the durability gate closed and NODE_ENV=production, all ${DURABLE_STORE_METHODS.length} durable method(s) the scan derives from the repository's own call graph [${DURABLE_STORE_METHODS.join(', ')}] refuse with STORE_UNAVAILABLE 503 and leave their Maps at the ${O.memoryBaseline} record(s) they started from, and the read side refuses too: getTables ${JSON.stringify(read)} — a restaurant must not be told its floor, bill, booking, kitchen ticket, handover or staff row was saved, nor given a sales figure summarised from this process alone, while the same calls still work from memory in development (RMSH-15)`);

  // RMSH-23 is what the createReservation experiment taught, phrased so it cannot rot into a
  // fiction. Deleting that method's own refusal left RMSH-22 green, because the probe passes a
  // table_id and the nested getTableById refusal answered 503 on its behalf — so RMSH-22 proves the
  // outcome (no production write lands only in memory), not that each method decides it for itself,
  // and this guard cannot prove that without naming nouns by hand. What it can prove, and does: put
  // the mechanism out of service and re-run the same calls. If any probe still answered
  // STORE_UNAVAILABLE, RMSH-22's 503 would belong to something else; if no method then touched a
  // Map, the mechanism would be guarding a path that no longer exists and RMSH-22 would be measuring
  // nothing. A red here with the code looking better (every method refusing for its own reason) is
  // still the right alarm: the premise that the Maps are there for production to misuse has changed,
  // and the claim has to be re-derived rather than deleted.
  const neutered = O.neuteredProbes || {};
  const neuterProblems = [];
  if (!O.neuteredRestored) neuterProblems.push('the child did not put _rejectMemoryFallback back on the prototype');
  const invokable = DURABLE_STORE_METHODS.filter((n) => probes[n] && !probes[n].missingInvocation);
  const unrecorded = invokable.filter((n) => !neutered[n]);
  if (unrecorded.length) neuterProblems.push(`${unrecorded.join(', ')} were probed with the mechanism intact and skipped with it disabled`);
  const stillRefused = invokable.filter((n) => neutered[n] && neutered[n].code === 'STORE_UNAVAILABLE');
  stillRefused.forEach((n) => neuterProblems.push(`${n} still answers STORE_UNAVAILABLE with the mechanism disabled, so the 503 RMSH-22 credits it with is not the mechanism's`));
  const committedToMemory = invokable.filter((n) => neutered[n] && neutered[n].mapsGrew > 0);
  if (invokable.length && committedToMemory.length === 0) {
    neuterProblems.push(`none of the ${invokable.length} neutered method(s) touched a Map even with the mechanism disabled, so RMSH-22's promise has nothing left to guard and its subjects would have to be re-derived`);
  }
  const nRead = O.neuteredRead;
  if (!nRead) neuterProblems.push('the neutered run recorded no read result');
  else if (nRead.threw === true || nRead.code === 'STORE_UNAVAILABLE') {
    neuterProblems.push(`the neutered read still refused ${JSON.stringify(nRead)} instead of falling back to memory`);
  }
  check('RMSH-23',
    neuterProblems.length === 0,
    neuterProblems.length
      ? `${neuterProblems.join('; ')}`
      : `with _rejectMemoryFallback disabled and NODE_ENV still production, ${stillRefused.length} of the ${invokable.length} derived durable methods answer STORE_UNAVAILABLE and getTables returns from memory instead of refusing, while ${committedToMemory.length} of them commit straight into the Maps [${committedToMemory.map((n) => `${n} +${neutered[n].mapsGrew}`).join(', ')}] — so the 503 RMSH-22 measures for every one of those ${DURABLE_STORE_METHODS.length} methods is produced by this mechanism and by nothing else, and the mechanism is the only thing between a production restaurant and a write that dies with the process or a sales figure summarised from one process's memory`);

  // RMSH-24 is the read half of RMSH-16/17, and it exists because those two checks only ever scanned
  // the mutations: the eleven GET routes in the same family answered their own `catch` with a bare
  // 400 or a 500 carrying `err.message`, so a restaurant whose store was simply gone was told its
  // bill, bookings, kitchen board or staff list was a bad request or an internal fault — and nothing
  // named which store the rows came from. Its subjects come from the same route scan, so a read route
  // added tomorrow without a channel reddens this check instead of inheriting the old silence.
  const readProblems = [];
  RMS_REGS.forEach((r) => {
    const seg = catchSegment(r.body);
    const where = `${r.verb.toUpperCase()} ${r.paths[0]} (line ${r.line})`;
    if (!STORE_LABEL.test(r.body)) readProblems.push(`${where} answers success without naming the store`);
    if (!seg) { readProblems.push(`${where} has no catch(err) to classify with`); return; }
    const branch = seg.search(STORE_BRANCH);
    const replied = branch === -1 ? -1 : seg.slice(branch).search(/return\s+replyStoreError\s*\(/);
    const ownDefault = seg.search(/res\.status\(/);
    if (branch === -1) readProblems.push(`${where} has no store-failure branch`);
    else if (replied === -1) readProblems.push(`${where} tests the store channel but never answers through replyStoreError`);
    else if (ownDefault !== -1 && ownDefault < branch) {
      readProblems.push(`${where} answers its own default before the store branch, so an outage still becomes ${seg.slice(ownDefault, ownDefault + 22).replace(/\s+/g, ' ')}`);
    }
  });
  const readLabelled = RMS_READS.filter((r) => STORE_LABEL.test(r.body)).length;
  check('RMSH-24',
    RMS_REGS.length > 0 && RMS_READS.length > 0 && readProblems.length === 0,
    readProblems.length
      ? `${readProblems.length} problem(s) among the ${RMS_REGS.length} RMS route registrations: ${readProblems.join(' | ')}`
      : `all ${RMS_REGS.length} RMS route registrations — ${RMS_MUTATIONS.length} mutations and the ${RMS_READS.length} reads RMSH-16/17 never looked at (${readLabelled} of them now labelled) — name the store on success and hand a store refusal or an unreachable database to replyStoreError before their own 400/500 default, which is what keeps a failed read a retryable 503 instead of a message about the caller's data`);

  return finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

if (process.env.NABIN_RWH_CHILD) {
  runChild().catch((err) => {
    console.log(`RWH_VERDICT ${JSON.stringify({ ok: false, crashed: err && err.message, stack: String((err && err.stack) || '').slice(0, 600) })}`);
    process.exit(3);
  });
} else {
  main();
}
