// =========================================================================
// SUPPORT-TICKET WRITE GUARD (local only)
//
// `POST /api/support/ticket` was the one customer-facing write that pasted
// PostgreSQL's own sentence about the caller's input straight back to the
// caller, with a status code that blamed them for it:
//
//   * Nothing bounded `title`, `description` or `category` against the columns
//     they land in. `support_tickets` declares `subject varchar(200)` and
//     `category varchar(50)`, so a pasted 300-character subject reached the
//     engine and came back `400 value too long for type character
//     varying(200)` — a schema diagram sent to a stranger, and no hint of
//     which field to fix.
//   * Every failure in the repository was rethrown as
//     `new Error(`Failed to … in PostgreSQL: ${error.message}`)` with no status,
//     so the route's `err.statusCode || 400` printed it AND called it a bad
//     request. A collision (`duplicate key value violates unique constraint
//     "support_tickets_ticket_number_key"`), an unmigrated schema
//     (`relation "support_tickets" does not exist`) and an unreachable store all
//     answered 400 — the client's own signal to stop retrying.
//
// The correction introduces no new vocabulary. The repository now marks a
// genuine store refusal with `storeFailure = true` plus the engine's `code`,
// keeps the engine's text in `details` (which `replyStoreError` logs and never
// echoes), and leaves `status` unset so a store failure cannot be answered as a
// 400. The routes hand that to the platform's existing single classifier,
// `storeReply`/`isStoreUnreachable` in src/supabase.js, which decides 503 / 409 /
// 500 / 400 from the code. The over-cap inputs are refused at the boundary
// first, with a named code, in the style of `TITLE_TOO_LONG` and the pricing
// estimate's `MISSING_DISTANCE_KM`.
//
// Three techniques, because the three claims need different evidence:
//
//   * Schema truth — the declared caps are read out of the repository source and
//     compared with `information_schema`. A constant that drifts from the column
//     it claims to bound is a bug this suite must catch, in either direction.
//   * Repository against a real outage — the same closed-port method as
//     `checkout_store_semantics_test.js`: a child whose SUPABASE_URL points at a
//     port nobody listens on. A cap refusal proves itself by arriving BEFORE the
//     store, so the two families are distinguishable with no mocks at all, and
//     an exactly-at-limit value proves the gate accepts it by reaching the store
//     instead. Nothing can be written, because there is nothing to write to.
//   * Routes over real HTTP with the store's answer faked at the wire. A
//     route-level outage cannot be produced by pointing a server at a dead store
//     (support auth reads that same store and answers 401 first — the
//     `campaign_outage_test.js` problem), so each server child replaces only
//     `supabaseAdmin.from('support_tickets')` with a builder that resolves — or
//     rejects — exactly the way supabase-js does for one PostgreSQL code. What is
//     proven is the repository's marking AND the route's classification, over
//     real HTTP, with no row anywhere.
//
// Nothing in this suite writes. No request that would pass the gates and reach a
// live `support_tickets` insert is ever sent: the at-limit and valid payloads are
// only used against a store that is unreachable or faked. The final two checks
// fingerprint `support_tickets` and `users` before and after the whole run and
// require both to be identical; the authentication side effects the run cannot
// avoid (`backend_sessions`, `audit_logs`) are measured and printed, not deleted.
// =========================================================================

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { Client } = require('pg');

const targetGuard = require('./scripts/chain_target_guard');
// F-C1-1: this suite writes and asserts through this handle, so its store must be a target
// something DECLARED (shell, then backend/.env) and loopback - never an address typed into
// this file, which is what let a run write one store and assert against another (#283).
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'support_ticket_write_guard_test' });
const PG = PG_TARGET.connectionString;
const OTP = process.env.NABIN_TEST_OTP || '7729';
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1)$/i;
const SUITE = path.join(__dirname, 'support_ticket_write_guard_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'SupportTicketRepository.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');

if (process.env.NODE_ENV === 'production') {
  console.error('STW REFUSED: this suite must not run against a production environment');
  process.exit(1);
}
if (!LOOPBACK.test(new URL(PG).hostname)) {
  console.error('STW REFUSED: non-loopback database target');
  process.exit(1);
}

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 240)}` : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const repeat = (n) => 'x'.repeat(n);

// A repository call reduced to what the verdict cares about. `storeFailure` is the
// mark the fixed repository puts on a genuine engine refusal, and `unreachable` is
// what `isStoreUnreachable()` answers for it — the two things the routes read.
function outcome(fn) {
  return Promise.resolve()
    .then(fn)
    .then(value => ({ threw: false, value }))
    .catch(err => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      storeFailure: Boolean(err && err.storeFailure),
      message: err && err.message,
      details: err && err.details,
    }));
}

async function request(method, baseUrl, urlPath, body, token) {
  const res = await fetch(baseUrl + urlPath, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: `Bearer ${token}` } : {}),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* the raw text is kept for the leak check */ }
  return { status: res.status, data: data || {}, text };
}

async function findFreePort() {
  const srv = net.createServer();
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = srv.address().port;
  await new Promise((resolve) => srv.close(resolve));
  return port;
}

// Two leak questions, two marker sets.
//
// A SECRET LEAK is a leak in any body: the connection target, a credential, a
// JWT-looking value, or the shape of a stack frame.
const SECRET_MARKERS = ['password', 'postgres://', 'postgresql://', 'service_role', '54322',
  '54321', 'eyJ', '    at ', 'at Object.', 'at async', '127.0.0.1'];
// The SCHEMA WORDS are what the defect actually printed: PostgreSQL naming a
// column type, a constraint, a relation, its own SQLSTATE, or the reason it could
// not be reached. None of them appear in the copy this repository writes.
const SCHEMA_MARKERS = ['varchar', 'character varying', 'duplicate key', 'violates unique constraint',
  'relation "', 'does not exist', 'null value in column', '22001', '23505', '23502', '42p01',
  'postgrest', 'econnrefused', 'connrefused', 'fetch failed', 'support_tickets_'];
function leaksIn(text, markers) {
  const lower = String(text || '').toLowerCase();
  return markers.filter(m => lower.includes(m.toLowerCase()));
}

// ---------------------------------------------------------------- source truth
// The caps are only honest if they equal the columns. Read the declared constants
// out of the file rather than re-typing them here, so this is a check of the
// source and not of this suite's own memory.
function declaredCap(name) {
  const src = fs.readFileSync(REPO_FILE, 'utf8');
  const m = src.match(new RegExp('const ' + name + '\\s*=\\s*(\\d+)\\s*;'));
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------- children
async function runChild(scenario) {
  const db = require('./src/database');
  const { isStoreUnreachable, supabaseAdmin } = require('./src/supabase');
  const fx = JSON.parse(process.env.NABIN_STW_FX || '{}');
  const verdict = (out) => console.log(`STW_VERDICT ${JSON.stringify(out)}`);
  const shaped = (res) => Object.assign({}, res, {
    unreachable: res.threw ? isStoreUnreachable(res) : false,
    leaked: res.threw ? leaksIn([res.message, res.details].filter(Boolean).join(' '), SCHEMA_MARKERS) : [],
  });

  if (scenario === 'repo_down') {
    const out = { scenario, ok: false };
    const caller = { id: fx.customerUuid, name: fx.customerName, role: 'CUSTOMER' };
    const create = async (payload) => shaped(await outcome(() => db.supportTicketRepo.createTicket(caller, payload)));

    // Payloads are built from the MEASURED column lengths, not from the constants
    // under test: a wrong constant must not be able to change what this suite sends
    // (a million-character title would be refused by the JSON body limit, not by the
    // gate, and the check would prove nothing).
    out.titleOver = await create({ title: repeat(fx.subjectBound + 1), description: 'short body', category: 'GENERAL' });
    out.descOver = await create({ title: 'short title', description: repeat(fx.descBound + 1), category: 'GENERAL' });
    out.categoryOver = await create({ title: 'short title', description: 'short body', category: repeat(fx.categoryBound + 1).toUpperCase() });
    out.titleAt = await create({ title: repeat(fx.subjectBound), description: 'short body', category: 'GENERAL' });
    out.descAt = await create({ title: 'short title', description: repeat(fx.descBound), category: 'GENERAL' });
    out.categoryAt = await create({ title: 'short title', description: 'short body', category: repeat(fx.categoryBound).toUpperCase() });
    out.valid = await create({ title: 'short title', description: 'short body', category: 'GENERAL' });
    out.noTitle = await create({ title: '   ', description: 'short body' });
    out.noDesc = await create({ title: 'short title', description: '  ' });
    out.messageOver = shaped(await outcome(() => db.supportTicketRepo.addMessage(
      fx.ticketRef, { text: repeat(4001) }, caller)));

    // The store is a closed port, so anything that clears a gate must end up as an
    // unreachable-store failure. That is the whole distinction: a cap refusal
    // arrives with our code and our wording, and never touches the wire.
    out.ok = out.titleOver.code === 'TITLE_TOO_LONG'
      && out.descOver.code === 'DESCRIPTION_TOO_LONG'
      && out.categoryOver.code === 'CATEGORY_TOO_LONG'
      && ['valid', 'titleAt', 'descAt', 'categoryAt'].every(k => out[k].threw === true
        && out[k].unreachable === true
        && !['TITLE_TOO_LONG', 'DESCRIPTION_TOO_LONG', 'CATEGORY_TOO_LONG'].includes(out[k].code))
      && out.noTitle.status === 400 && out.noDesc.status === 400
      && out.messageOver.status === 400 && out.messageOver.unreachable === false;
    return verdict(out);
  }

  if (scenario === 'serve_live' || scenario === 'serve_fake') {
    const port = Number(process.env.PORT);
    const kind = process.env.NABIN_STW_FAKE;

    // The engine's answer for one SQLSTATE, shaped the way supabase-js shapes it:
    // a resolved `{data:null, error}` for a refusal, a rejected TypeError with the
    // syscall `cause` for a store that is not there.
    const ENGINE_ERRORS = {
      '23505': { code: '23505', message: 'duplicate key value violates unique constraint "support_tickets_ticket_number_key"', details: null, hint: null },
      '22001': { code: '22001', message: 'value too long for type character varying(200)', details: null, hint: null },
      '42P01': { code: '42P01', message: 'relation "support_tickets" does not exist', details: null, hint: null },
    };
    function fakeBuilder() {
      const settle = () => {
        if (kind === 'fetch') {
          const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
          cause.code = 'ECONNREFUSED';
          cause.syscall = 'connect';
          const err = new TypeError('fetch failed');
          err.cause = cause;
          return Promise.reject(err);
        }
        return Promise.resolve({ data: null, error: ENGINE_ERRORS[kind] });
      };
      const self = {};
      ['insert', 'update', 'delete', 'upsert', 'select', 'eq', 'neq', 'or', 'in', 'is', 'not',
        'gte', 'lte', 'like', 'ilike', 'order', 'limit', 'range', 'filter'].forEach((m) => {
        self[m] = () => self;
      });
      self.single = settle;
      self.maybeSingle = settle;
      self.then = (onOk, onErr) => settle().then(onOk, onErr);
      return self;
    }

    require('./src/server');
    const baseUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 90000;   // measured boot is ~13s idle, longer under load
    let ready = false;
    while (Date.now() < deadline && !ready) {
      await sleep(250);
      try { ready = (await request('GET', baseUrl, '/api/health')).status === 200; } catch (e) { /* not up yet */ }
    }
    if (!ready) return verdict({ scenario, ok: false, port });

    // Installed only after boot, so seeding and authentication keep the real
    // client: the fake covers exactly the table this change is about.
    if (scenario === 'serve_fake') {
      const realFrom = supabaseAdmin.from.bind(supabaseAdmin);
      supabaseAdmin.from = (table) => (table === 'support_tickets' ? fakeBuilder() : realFrom(table));
    }
    return verdict({ scenario, ok: true, port, fake: scenario === 'serve_fake' ? kind : null });
  }

  verdict({ scenario, ok: false, error: `unknown scenario ${scenario}` });
}

function spawnRepoChild(scenario, env) {
  const res = spawnSync(process.execPath, [SUITE, scenario], {
    cwd: __dirname,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { NABIN_STW_CHILD: scenario }, env),
  });
  const line = String(res.stdout || '').split('\n').filter(l => l.startsWith('STW_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `child printed no verdict: ${String(res.stdout || '').slice(-200)}${String(res.stderr || '').slice(-300)}` };
  }
  try { return JSON.parse(line.slice('STW_VERDICT '.length)); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 300)}` }; }
}

function spawnServerChild(scenario, port, extraEnv) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SUITE, scenario], {
      cwd: __dirname,
      windowsHide: true,
      env: Object.assign({}, process.env, { NABIN_STW_CHILD: scenario, PORT: String(port) }, extraEnv || {}),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = [];
    let buffer = '';
    let settled = false;
    proc.stderr.on('data', (d) => stderr.push(String(d)));
    proc.stdout.on('data', (d) => {
      buffer += String(d);
      const line = buffer.split('\n').find(l => l.startsWith('STW_VERDICT '));
      if (!line || settled) return;
      settled = true;
      try { resolve({ proc, verdict: JSON.parse(line.slice('STW_VERDICT '.length)), stderr }); }
      catch (e) { reject(new Error(`unparsable server verdict: ${String(e && e.message)}`)); }
    });
    proc.on('exit', (code) => {
      if (!settled) reject(new Error(`server child exited (${code}) before readiness: ${stderr.join('').slice(-400)}`));
    });
  });
}

async function mintCustomerToken(baseUrl, fx) {
  const mint = await request('POST', baseUrl, '/api/auth/verify-otp', {
    phone: fx.customerPhone, otp: OTP, role: 'CUSTOMER', purpose: 'LOGIN',
  });
  return mint.data && mint.data.token;
}

// One faked store answer, asserted through both support write routes.
const FAKE_KINDS = [
  { kind: 'fetch', status: 503, code: 'STORE_UNAVAILABLE' },
  { kind: '23505', status: 409, code: 'ALREADY_EXISTS' },
  { kind: '22001', status: 400, code: 'INVALID_VALUE' },
  { kind: '42P01', status: 500, code: 'SCHEMA_NOT_READY' },
];

// ---------------------------------------------------------------- main
async function main() {
  const c = new Client({ connectionString: PG });
  await c.connect();
  const norm = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

  // ============================================ 1. the caps match the columns
  const caps = {
    subjectCap: declaredCap('SUBJECT_MAX_LENGTH'),
    categoryCap: declaredCap('CATEGORY_MAX_LENGTH'),
    descCap: declaredCap('DESCRIPTION_MAX_LENGTH'),
  };
  const columns = (await c.query(
    `SELECT column_name, data_type, character_maximum_length
       FROM information_schema.columns WHERE table_name = 'support_tickets'`)).rows;
  const col = (name) => columns.find(x => x.column_name === name);
  const subjectCol = col('subject');
  const categoryCol = col('category');
  const descriptionCol = col('description');

  check('STW-01', 'the three caps are declared as numeric constants in the repository source',
    Object.values(caps).every(v => Number.isInteger(v) && v > 0), caps);
  check('STW-02', 'SUBJECT_MAX_LENGTH equals the live subject column (varchar(200))',
    Boolean(subjectCol) && subjectCol.data_type === 'character varying'
    && subjectCol.character_maximum_length === caps.subjectCap,
    { column: subjectCol, declared: caps.subjectCap });
  check('STW-03', 'CATEGORY_MAX_LENGTH equals the live category column (varchar(50))',
    Boolean(categoryCol) && categoryCol.data_type === 'character varying'
    && categoryCol.character_maximum_length === caps.categoryCap,
    { column: categoryCol, declared: caps.categoryCap });
  check('STW-04', 'description has no column cap, so its bound is the thread bound the sibling path already uses',
    Boolean(descriptionCol) && descriptionCol.data_type === 'text'
    && descriptionCol.character_maximum_length === null && caps.descCap === 4000,
    { column: descriptionCol, declared: caps.descCap });

  // The bounds the payloads are built from. subject/category come from the COLUMNS,
  // never from the constants under test: a wrong constant must not be able to change
  // what this suite sends, or the refusal it produces would be the JSON body limit
  // (413) instead of the gate, and the check would prove nothing about either.
  // description is `text` with no column bound, so its declared cap is the only
  // truth — clamped here to the thread bound STW-04 pins it to.
  const bounds = {
    subjectBound: subjectCol ? subjectCol.character_maximum_length : null,
    categoryBound: categoryCol ? categoryCol.character_maximum_length : null,
    descBound: Math.min(caps.descCap, 4000),
  };
  if (!Number.isInteger(bounds.subjectBound) || !Number.isInteger(bounds.categoryBound)
    || !Number.isInteger(bounds.descBound) || bounds.descBound < 1) {
    console.error('STW ABORT: support_tickets columns are not readable, so no bound can be built');
    process.exitCode = 1; await c.end(); return;
  }

  const repoSrc = fs.readFileSync(REPO_FILE, 'utf8');
  const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');
  // Comments describe the defect this file used to have (and one step of the
  // resolution path names the store honestly), so a leak scan has to look at what
  // executes. Block comments first, then whole-line `//` comments.
  const executable = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const repoCode = executable(repoSrc);
  check('STW-05', 'no throw in the repository still prints PostgreSQL\'s sentence about itself',
    !/in PostgreSQL/.test(repoCode) && !/Database error/.test(repoCode)
    && !/new Error\(\s*`[^`]*\$\{\s*(?:error|err|fetchErr|updateErr)\.message/.test(repoCode)
    && !/throw new Error\([^)]*\$\{\s*(?:error|err|fetchErr|updateErr)\.message/.test(repoCode),
    {
      pgPhrase: (repoCode.match(/in PostgreSQL/g) || []).length,
      dbErrorPhrase: (repoCode.match(/Database error/g) || []).length,
    });
  check('STW-06', 'every database refusal is marked with the storeFailure flag the routes read',
    (repoSrc.match(/throw storeFailure\(/g) || []).length >= 10,
    { sites: (repoSrc.match(/throw storeFailure\(/g) || []).length });
  const supportLabels = ['support ticket', 'support tickets', 'reply to this support ticket',
    'admin support queue', 'ticket assignment', 'ticket resolution'];
  check('STW-07', 'the six support routes hand store failures to the platform\'s existing classifier',
    (serverSrc.match(/err\.storeFailure/g) || []).length >= 6
    && supportLabels.every(label => serverSrc.includes(`replyStoreError(res, req, err, '${label}')`)),
    { markers: (serverSrc.match(/err\.storeFailure/g) || []).length });

  // ============================================ fixtures, discovered not assumed
  const phones = new Map();
  for (const r of (await c.query('SELECT phone FROM users')).rows) phones.set(norm(r.phone), (phones.get(norm(r.phone)) || 0) + 1);
  const customer = (await c.query(
    `SELECT id::text id, phone, name FROM users u`)).rows
    .filter(u => phones.get(norm(u.phone)) === 1 && /^\d{10}$/.test(norm(u.phone)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (!customer) {
    console.error('STW ABORT: this database has no unambiguously-registered customer');
    process.exitCode = 1; await c.end(); return;
  }
  // A ticket reference for the thread route. No call in this suite lets that read
  // succeed, so the value only has to be a plausible identifier — the customer's own
  // ticket when one exists, and a well-formed number when none does.
  const ownTicket = (await c.query(
    `SELECT ticket_number FROM support_tickets WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
    [customer.id])).rows[0];
  const ticketRef = ownTicket ? ownTicket.ticket_number : 'TCK-000000-000000';

  // One row, four measurements. `tickets` is a fingerprint (count + a digest over the
  // columns this suite could have written), so an added OR edited row cannot hide
  // behind an unchanged count.
  const FINGERPRINT = `SELECT
      (SELECT count(*)::int || ':' || coalesce(md5(string_agg(
          t.id::text || '|' || coalesce(t.subject, '') || '|' || coalesce(t.description, '')
            || '|' || coalesce(t.messages::text, ''), ',' ORDER BY t.id)), 'empty')
         FROM support_tickets t) AS tickets,
      (SELECT count(*) FROM users)::int || ':' || (SELECT count(*) FROM merchants)::int AS identities,
      (SELECT count(*) FROM backend_sessions)::int AS sessions,
      (SELECT count(*) FROM audit_logs)::int AS audit`;
  const before = await c.query(FINGERPRINT);
  const base = before.rows[0];
  console.log(`  baseline residue: support_tickets=${base.tickets.slice(0, 20)}… users:merchants=${base.identities} `
    + `sessions=${base.sessions} audit_logs=${base.audit}`);
  await c.end();

  const fx = Object.assign({
    customerUuid: customer.id, customerPhone: norm(customer.phone), customerName: customer.name,
    ticketRef,
  }, caps, bounds);
  const fxJson = JSON.stringify(fx);

  // ============================================ 2. repository, store unreachable
  const down = spawnRepoChild('repo_down', {
    NODE_ENV: 'development',
    SUPABASE_POSTGRES_LIVE: 'true',
    SUPABASE_URL: 'http://127.0.0.1:59999',
    SUPABASE_ANON_KEY: 'local-only-unreachable-key',
    SUPABASE_SERVICE_ROLE_KEY: 'local-only-unreachable-key',
    NABIN_STW_FX: fxJson,
  });
  const CAP_CODES = ['TITLE_TOO_LONG', 'DESCRIPTION_TOO_LONG', 'CATEGORY_TOO_LONG'];
  check('STW-08', 'a title one character over the column limit is refused with TITLE_TOO_LONG before the wire',
    down.ok === true && down.titleOver && down.titleOver.threw === true
    && down.titleOver.code === 'TITLE_TOO_LONG' && down.titleOver.status === 400
    && down.titleOver.unreachable === false,
    { code: down.titleOver && down.titleOver.code, status: down.titleOver && down.titleOver.status,
      unreachable: down.titleOver && down.titleOver.unreachable, detail: down.detail });
  check('STW-09', 'an over-limit description is refused with its own code, not a shared one',
    Boolean(down.descOver) && down.descOver.threw === true && down.descOver.code === 'DESCRIPTION_TOO_LONG'
    && down.descOver.status === 400 && down.descOver.unreachable === false,
    { code: down.descOver && down.descOver.code, status: down.descOver && down.descOver.status });
  check('STW-10', 'an over-limit category is refused with CATEGORY_TOO_LONG',
    Boolean(down.categoryOver) && down.categoryOver.threw === true
    && down.categoryOver.code === 'CATEGORY_TOO_LONG' && down.categoryOver.status === 400
    && down.categoryOver.unreachable === false,
    { code: down.categoryOver && down.categoryOver.code });
  check('STW-11', 'the three refusals name the field and its limit, and no column type',
    [down.titleOver, down.descOver, down.categoryOver].every(r => r && /exceeds maximum allowed length/.test(r.message)
      && /characters/.test(r.message) && r.leaked.length === 0),
    [down.titleOver, down.descOver, down.categoryOver].map(r => r && r.leaked));
  check('STW-12', 'a title of exactly the column limit is NOT refused by the gate (it reaches the store)',
    Boolean(down.titleAt) && down.titleAt.threw === true && CAP_CODES.includes(down.titleAt.code) === false
    && down.titleAt.unreachable === true,
    { code: down.titleAt && down.titleAt.code, unreachable: down.titleAt && down.titleAt.unreachable });
  check('STW-13', 'a description of exactly its bound is NOT refused by the gate',
    Boolean(down.descAt) && down.descAt.threw === true && CAP_CODES.includes(down.descAt.code) === false
    && down.descAt.unreachable === true,
    { code: down.descAt && down.descAt.code });
  check('STW-14', 'a category of exactly its bound is NOT refused by the gate',
    Boolean(down.categoryAt) && down.categoryAt.threw === true && CAP_CODES.includes(down.categoryAt.code) === false
    && down.categoryAt.unreachable === true,
    { code: down.categoryAt && down.categoryAt.code });
  check('STW-15', 'an in-bounds ticket request is not answered as a caller error when the store is unreachable',
    Boolean(down.valid) && down.valid.threw === true && down.valid.unreachable === true
    && down.valid.status !== 400 && CAP_CODES.includes(down.valid.code) === false,
    { status: down.valid && down.valid.status, code: down.valid && down.valid.code,
      unreachable: down.valid && down.valid.unreachable });
  check('STW-16', 'no store failure on this path carries a 4xx status, so no route can blame the caller for it',
    [down.titleAt, down.descAt, down.categoryAt, down.valid].every(r => r && r.threw === true
      && (r.status === undefined || r.status >= 500)),
    [down.titleAt, down.descAt, down.categoryAt, down.valid].map(r => r && r.status));
  check('STW-17', 'the thread route keeps its own text bound and refuses it before the wire',
    Boolean(down.messageOver) && down.messageOver.threw === true && down.messageOver.status === 400
    && down.messageOver.unreachable === false && /maximum length/i.test(down.messageOver.message),
    { status: down.messageOver && down.messageOver.status, message: down.messageOver && down.messageOver.message });
  check('STW-18', 'the existing missing-field refusals are unchanged (400, no new throw on either)',
    Boolean(down.noTitle) && Boolean(down.noDesc) && down.noTitle.status === 400 && down.noDesc.status === 400
    && /title/i.test(down.noTitle.message) && /description/i.test(down.noDesc.message)
    && CAP_CODES.includes(down.noTitle.code) === false,
    { noTitle: down.noTitle && down.noTitle.message, noDesc: down.noDesc && down.noDesc.message });

  // ============================================ 3. routes, store working (reads and refusals only)
  const livePort = await findFreePort();
  const liveChild = await spawnServerChild('serve_live', livePort);
  const liveBase = `http://127.0.0.1:${livePort}`;
  let liveResponses = [];
  try {
    const token = await mintCustomerToken(liveBase, fx);
    check('STW-19', 'a real registered customer authenticates against this backend over HTTP',
      liveChild.verdict.ok === true && Boolean(token), { port: livePort });

    const overTitle = await request('POST', liveBase, '/api/support/ticket',
      { title: repeat(fx.subjectBound + 1), description: 'a short body', category: 'GENERAL' }, token);
    const overDesc = await request('POST', liveBase, '/api/support/ticket',
      { title: 'a short title', description: repeat(fx.descBound + 1), category: 'GENERAL' }, token);
    const overCategory = await request('POST', liveBase, '/api/support/ticket',
      { title: 'a short title', description: 'a short body', category: repeat(fx.categoryBound + 1).toUpperCase() }, token);
    const overMessage = await request('POST', liveBase, `/api/support/ticket/${fx.ticketRef}/message`,
      { text: repeat(4001) }, token);
    liveResponses = [overTitle, overDesc, overCategory, overMessage];

    check('STW-20', 'POST /api/support/ticket answers an over-limit title with 400 TITLE_TOO_LONG',
      overTitle.status === 400 && overTitle.data.success === false && overTitle.data.code === 'TITLE_TOO_LONG',
      { status: overTitle.status, code: overTitle.data.code });
    check('STW-21', 'the same route answers an over-limit description with 400 DESCRIPTION_TOO_LONG',
      overDesc.status === 400 && overDesc.data.code === 'DESCRIPTION_TOO_LONG',
      { status: overDesc.status, code: overDesc.data.code });
    check('STW-22', 'and an over-limit category with 400 CATEGORY_TOO_LONG',
      overCategory.status === 400 && overCategory.data.code === 'CATEGORY_TOO_LONG',
      { status: overCategory.status, code: overCategory.data.code });
    check('STW-23', 'the reply route keeps its 400 for an over-limit message',
      overMessage.status === 400 && overMessage.data.success === false,
      { status: overMessage.status, code: overMessage.data.code });
    check('STW-24', 'no refusal body leaks a column type, a constraint, an SQLSTATE, a relation or a stack shape',
      liveResponses.every(r => leaksIn(r.text, SCHEMA_MARKERS).length === 0),
      liveResponses.map(r => ({ status: r.status, leaks: leaksIn(r.text, SCHEMA_MARKERS) })));
    check('STW-25', 'no refusal body leaks a credential, the connection target or a stack frame',
      liveResponses.every(r => leaksIn(r.text, SECRET_MARKERS).length === 0),
      liveResponses.map(r => ({ status: r.status, leaks: leaksIn(r.text, SECRET_MARKERS) })));

    const anonCreate = await request('POST', liveBase, '/api/support/ticket',
      { title: repeat(fx.subjectBound + 1), description: 'x' });
    const anonMessage = await request('POST', liveBase, `/api/support/ticket/${fx.ticketRef}/message`,
      { text: repeat(4001) });
    check('STW-26', 'authentication is still required on both write routes (401, before any validation)',
      anonCreate.status === 401 && anonMessage.status === 401,
      { create: anonCreate.status, message: anonMessage.status });
  } finally {
    liveChild.proc.kill();
  }

  // ============================================ 4. routes, the store refusing in four different ways
  const perKind = [];
  for (let i = 0; i < FAKE_KINDS.length; i++) {
    const spec = FAKE_KINDS[i];
    const base = 27 + i * 5;
    const port = await findFreePort();
    const child = await spawnServerChild('serve_fake', port, { NABIN_STW_FAKE: spec.kind });
    const baseUrl = `http://127.0.0.1:${port}`;
    const rows = [];
    try {
      const token = await mintCustomerToken(baseUrl, fx);
      const valid = await request('POST', baseUrl, '/api/support/ticket',
        { title: 'a short title', description: 'a short body', category: 'GENERAL' }, token);
      const overTitle = await request('POST', baseUrl, '/api/support/ticket',
        { title: repeat(fx.subjectBound + 1), description: 'a short body', category: 'GENERAL' }, token);
      const atLimit = await request('POST', baseUrl, '/api/support/ticket',
        { title: repeat(fx.subjectBound), description: 'a short body', category: 'GENERAL' }, token);
      const message = await request('POST', baseUrl, `/api/support/ticket/${fx.ticketRef}/message`,
        { text: 'following up on my order' }, token);
      rows.push(valid, overTitle, atLimit, message);

      check(`STW-${base}`, `store answer ${spec.kind} is served as ${spec.status} ${spec.code} on ticket create, not as a caller error`,
        child.verdict.ok === true && Boolean(token) && valid.status === spec.status
        && valid.data.code === spec.code && valid.data.success === false
        && valid.data.ticket === undefined,
        { status: valid.status, code: valid.data.code, keys: Object.keys(valid.data) });
      check(`STW-${base + 1}`, `with store ${spec.kind} an over-limit title is still refused by the gate (400 TITLE_TOO_LONG)`,
        overTitle.status === 400 && overTitle.data.code === 'TITLE_TOO_LONG',
        { status: overTitle.status, code: overTitle.data.code });
      check(`STW-${base + 2}`, `with store ${spec.kind} a title at exactly the limit is not cap-refused, so the gate is not over-tight`,
        atLimit.status === spec.status && atLimit.data.code === spec.code,
        { status: atLimit.status, code: atLimit.data.code });
      check(`STW-${base + 3}`, `the reply route classifies store answer ${spec.kind} the same way (one convention, both writes)`,
        message.status === spec.status && message.data.code === spec.code
        && message.data.success === false && message.data.message === undefined,
        { status: message.status, code: message.data.code });
      check(`STW-${base + 4}`, `no ${spec.kind} failure body carries PostgreSQL's words, a stack frame or the target`,
        rows.every(r => leaksIn(r.text, SCHEMA_MARKERS).length === 0
          && leaksIn(r.text, SECRET_MARKERS).length === 0),
        rows.map(r => ({ status: r.status, leaks: [...leaksIn(r.text, SCHEMA_MARKERS), ...leaksIn(r.text, SECRET_MARKERS)] })));
    } finally {
      child.proc.kill();
      perKind.push(spec.kind);
    }
  }

  // ============================================ 5. residue: measured, and proven to be only auth
  const c2 = new Client({ connectionString: PG });
  await c2.connect();
  const after = (await c2.query(FINGERPRINT)).rows[0];
  await c2.end();
  check('STW-47', 'support_tickets is byte-for-byte identical after the whole run (this suite writes no ticket)',
    after.tickets === base.tickets, { before: base.tickets.slice(0, 24), after: after.tickets.slice(0, 24) });
  check('STW-48', 'no identity row appeared either — the only growth is the sessions this run authenticated',
    after.identities === base.identities,
    { before: base.identities, after: after.identities,
      sessions: `${base.sessions} -> ${after.sessions}`, audit: `${base.audit} -> ${after.audit}`,
      fakesExercised: perKind });

  const failed = results.filter(r => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 SUPPORT-TICKET WRITE GUARD: ${results.length - failed.length}/${results.length} passed, `
    + `${failed.length} failed`);
  console.log(`   residue: support_tickets unchanged=${after.tickets === base.tickets}, `
    + `backend_sessions +${Number(after.sessions) - Number(base.sessions)}, `
    + `audit_logs +${Number(after.audit) - Number(base.audit)} (${1 + FAKE_KINDS.length} OTP logins over ${1 + FAKE_KINDS.length} server children)`);
  console.log('========================================================================');
  if (failed.length) console.log('  failed: ' + failed.map(f => f.id).join(', '));
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_STW_CHILD) {
  runChild(process.env.NABIN_STW_CHILD).catch(err => {
    console.log(`STW_VERDICT ${JSON.stringify({ scenario: process.env.NABIN_STW_CHILD, ok: false, crashed: err.message })}`);
    process.exit(3);
  });
} else {
  main().catch(err => {
    console.error('STW ABORTED:', err.message);
    process.exit(2);
  });
}
