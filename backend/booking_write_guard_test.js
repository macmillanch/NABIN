'use strict';
// =========================================================================
// BOOKING WRITE GUARD (local only, writes nothing)
//
// A booking is the first money-shaped write a customer makes: the ride the platform
// now believes exists, the fare it will settle, and the dispatch offers that go out
// over it. So a `jobs` insert the database refused must not be able to come back as a
// created job.
//
// `NabinDatabase.createJob` (src/database.js:4193) treated every refusal as a notice:
//
//     if (this.jobRepo) {
//       try {
//         const created = await this.jobRepo.create(newJob);
//         if (created) Object.assign(newJob, created);
//       } catch (e) {
//         console.warn('⚠️ JobRepository.create async notice:', e.message);
//       }
//     }
//     this.jobs.unshift(newJob);
//     this.save();
//     return newJob;                    // the caller's `job`, with its id and fare
//
// and `JobRepository.create` answered a refused insert with a codeless Error
// (`src/repositories/JobRepository.js:313`):
//
//     if (error) { throw new Error(`Failed to create job in PostgreSQL: ${error.message}`); }
//
// supabase-js resolves `{ data, error }` for a PostgreSQL refusal, so an unmigrated
// schema (42P01), a `customer_id` no longer in `users` (23503), a `job_number` over
// VARCHAR(80) (22001) and a `jobs_job_number_key` collision (23505) all become that
// one Error, which the facade turns into a warning, which ends in a mirror row.
// `book-ride` (src/server.js:4036) and `book-parcel` (:4236) then answer
// `res.json({ success: true, job })` and fan the booking out to drivers. The customer
// holds a job number, an OTP and a fare for a trip that is not in the database, and
// the next read of that job — the tracking screen, the driver's offer, the settlement —
// finds nothing. It also replays: `db.jobs.find(j => j.idempotencyKey === key)`
// (src/server.js:3938) now matches the row PostgreSQL never accepted, so a retry is
// answered `duplicate: true` from the process cache.
//
// The same insert also wrote the mirror twice on success. `JobRepository.create`
// pushed the mapped row (`:317-319`) and the facade pushed its own copy, so
// `db.jobs` carried two objects for one trip — with different field sets, because
// only the facade's copy keeps the route-only values (`idempotencyKey`,
// `appliedPromo`, `passengerInfo`) the repository's payload never carries.
//
// Fix, in the platform's existing vocabulary: a store refusal is marked with
// `storeFailure` plus the engine's own `code` and the engine's sentence on `details`
// (the shape src/repositories/LedgerRepository.js:57 uses), the mirror is written by
// the facade once and only after the insert lands, and the two booking routes hand
// anything the store refused to the one classifier that decides 503 vs 409 vs 500
// (`replyStoreError`, src/server.js:347). The routes have to say it themselves:
// Express 4 (`package.json` `"express": "^4.21.2"`) does not forward a rejected async
// handler to the error middleware, so a propagating throw with no `try/catch` at the
// call site would hang the request until the client gives up.
//
// RED baseline, measured before the fix landed: 3/20 passed. Only BWG-00 (the child is
// really live), BWG-08 (no 4xx on the error) and BWG-14 (no table outside `jobs`) held.
// Each of 42P01, 23503, 22001, 23505 and a dead socket answered
// {"threw":false,"mirrorNew":1,"inMirror":true,"returned":{"status":"SEARCHING","fare":249}},
// and both positive controls — the cooperating store and the storeless offline run —
// answered mirrorNew:2, which is the duplicate mirror write measured, not inferred.
//
// Evidence: the store's answer is faked at the wire in the exact shape supabase-js
// produces for each SQLSTATE, because a genuine refusal of a specific constraint
// cannot be provoked against a store this suite is not allowed to write to. Nothing
// is persisted: the client points at a closed port, `db.save` becomes a no-op, and no
// HTTP request is made. The positive controls (BWG-10, BWG-11) are what make the
// refusals meaningful — with the store cooperating, and with no store configured at
// all, the same call must still book exactly one job.
// =========================================================================

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SUITE = path.join(__dirname, 'booking_write_guard_test.js');
const REPO_FILE = path.join(__dirname, 'src', 'repositories', 'JobRepository.js');
const DB_FILE = path.join(__dirname, 'src', 'database.js');
const SERVER_FILE = path.join(__dirname, 'src', 'server.js');

const results = [];
function check(id, name, cond, detail) {
  results.push({ id, pass: cond === true });
  console.log(`[${cond === true ? 'PASS' : 'FAIL'}] ${id} ${name}`
    + (detail !== undefined ? ` -> ${JSON.stringify(detail).slice(0, 300)}` : ''));
}

const STAMP = process.env.NABIN_BWG_STAMP ? Number(process.env.NABIN_BWG_STAMP) : Date.now();
const CUSTOMER_UUID = '00000000-0000-4000-8000-0000000000c1';
const JOB_ROW_UUID = '00000000-0000-4000-8000-0000000000e1';
const engineText = (s) => /duplicate key value violates|relation "|violates foreign key|value too long for type/.test(String(s || ''));

// ---------------------------------------------------------------- child
async function runChild() {
  const { supabaseAdmin, isLivePostgres, isStoreUnreachable } = require('./src/supabase');
  const db = require('./src/database');

  // One SQLSTATE per faked wire answer, in supabase-js' own shape.
  const ENGINE = {
    '42P01': { code: '42P01', message: 'relation "jobs" does not exist', details: null, hint: null },
    '23503': { code: '23503', message: 'insert or update on table "jobs" violates foreign key constraint "jobs_customer_id_fkey"', details: 'Key is not present in table "users".', hint: null },
    '23505': { code: '23505', message: 'duplicate key value violates unique constraint "jobs_job_number_key"', details: 'Key (job_number)=(x) already exists.', hint: null },
    '22001': { code: '22001', message: 'value too long for type character varying(80)', details: null, hint: null },
  };

  const plan = JSON.parse(process.env.NABIN_BWG_PLAN || '{}');
  const observed = [];
  let recording = false;
  let lastPayload = null;

  function builder(table) {
    const reject = () => {
      const cause = new Error('connect ECONNREFUSED 127.0.0.1:59999');
      cause.code = 'ECONNREFUSED';
      cause.syscall = 'connect';
      const err = new TypeError('fetch failed');
      err.cause = cause;
      return Promise.reject(err);
    };
    const mutate = () => {
      if (recording) observed.push(`${table}.write`);
      const kind = plan[table] || 'ok';
      if (kind === 'fetch') return reject();
      if (kind === 'ok') {
        // A real insert answers the stored row back (`insert().select().single()`), so
        // the positive control has to hand back what the payload claimed.
        return Promise.resolve({
          data: Object.assign({}, lastPayload, {
            id: JOB_ROW_UUID,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }),
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: ENGINE[kind] || { code: kind, message: `faked ${kind}` } });
    };
    const self = {};
    ['update', 'delete', 'upsert', 'select', 'eq', 'neq', 'or', 'in', 'order', 'limit']
      .forEach((m) => { self[m] = () => self; });
    self.insert = (rows) => { lastPayload = Array.isArray(rows) ? rows[0] : rows; return self; };
    self.single = mutate;
    self.then = (onOk, onErr) => mutate().then(onOk, onErr);
    return self;
  }
  supabaseAdmin.from = (table) => builder(table);

  // No file mirror.
  db.save = () => {};
  const mirror = () => (db.jobs || []).length;
  const inMirror = (jobId) => (db.jobs || []).some((j) => j && (j.id === jobId || j.jobNumber === jobId));

  const outcome = (fn) => Promise.resolve().then(fn).then(
    (value) => ({ threw: false, value }),
    (err) => ({
      threw: true,
      code: err && err.code,
      status: err && (err.status || err.statusCode),
      storeFailure: Boolean(err && err.storeFailure),
      unreachable: Boolean(err && isStoreUnreachable(err)),
      message: err && err.message,
      details: err && err.details,
    }));

  const book = async (label) => {
    const jobId = `BWG-${label}-${STAMP}`;
    const before = mirror();
    const out = await outcome(() => db.createJob({
      id: jobId,
      type: 'RIDE',
      status: 'SEARCHING',
      customerId: CUSTOMER_UUID,
      customerName: 'BWG customer',
      customerPhone: '0000000001',
      fare: 249,
      platformFee: 37,
      distanceKm: 4.2,
      pickup: { address: 'BWG pickup', lat: 27.7172, lng: 85.3240 },
      drop: { address: 'BWG drop', lat: 27.7200, lng: 85.3300 },
    }));
    const value = out.threw ? null : out.value;
    return {
      attempted: jobId,
      threw: out.threw,
      storeFailure: out.storeFailure,
      code: out.code,
      status: out.status,
      unreachable: out.unreachable,
      leaked: engineText([out.threw ? out.message : '', value ? JSON.stringify(value) : ''].join(' ')),
      reason: String((out.threw ? (out.details || out.message) : '') || ''),
      mirrorNew: mirror() - before,
      // The stronger form of the delta: not "the cache grew once less" but "no row the
      // customer could read back exists under the number they were just given".
      inMirror: inMirror(jobId),
      returned: value ? { id: value.id, jobNumber: value.jobNumber, status: value.status, uuid: value.uuid, fare: value.fare } : null,
    };
  };

  const verdict = { live: isLivePostgres === true };

  if (!isLivePostgres) {
    // Offline development has no durable jobs table, so the mirror is the honest answer.
    verdict.offline = await book('offline');
    console.log(`BWG_VERDICT ${JSON.stringify(verdict)}`);
    return;
  }

  recording = true;

  // 1. durable refusals of the insert, none of them a booking that happened
  for (const kind of ['42P01', '23503', '22001', '23505', 'fetch']) {
    plan.jobs = kind;
    verdict[`insert_${kind}`] = await book(kind);
  }

  // 2. positive control: a booking the store accepted lands exactly one mirror row
  plan.jobs = 'ok';
  verdict.cooperative = await book('ok');
  recording = false;
  verdict.observed = observed.slice();
  verdict.payloadFields = lastPayload ? Object.keys(lastPayload).sort() : null;
  console.log(`BWG_VERDICT ${JSON.stringify(verdict)}`);
}

// ---------------------------------------------------------------- parent
const STORE_ENV = {
  NODE_ENV: 'development',
  SUPABASE_URL: 'http://127.0.0.1:59999',
  SUPABASE_ANON_KEY: 'local-only-fake-store-key',
  SUPABASE_SERVICE_ROLE_KEY: 'local-only-fake-store-key',
};

function spawnChild(live, planJson) {
  const res = spawnSync(process.execPath, [SUITE, '--child'], {
    cwd: __dirname,
    encoding: 'utf8',
    timeout: 240000,
    env: Object.assign({}, process.env, STORE_ENV, {
      NABIN_BWG_CHILD: '1',
      NABIN_BWG_STAMP: String(STAMP),
      SUPABASE_POSTGRES_LIVE: live ? 'true' : 'false',
      NABIN_BWG_PLAN: JSON.stringify(planJson || {}),
    }),
  });
  const line = String(res.stdout || '').split('\n').filter((l) => l.startsWith('BWG_VERDICT ')).pop();
  if (!line) {
    return { ok: false, detail: `no verdict: ${String(res.stdout || '').slice(-160)} | ${String(res.stderr || '').slice(-400)}` };
  }
  try { return Object.assign({ ok: true }, JSON.parse(line.slice('BWG_VERDICT '.length))); }
  catch (e) { return { ok: false, detail: `unparsable verdict: ${line.slice(0, 200)}` }; }
}

const REFUSED = ['42P01', '23503', '22001', '23505', 'fetch'];

// The slice is read for the shapes of the code it no longer contains, so the explanation of
// the deleted defect must not count as an occurrence of it: comment lines are stripped first.
const stripComments = (src) => src.split('\n').filter((ln) => !ln.trim().startsWith('//')).join('\n');

function routeSlice(src, routePath) {
  const start = src.indexOf(`app.post('${routePath}'`);
  if (start < 0) return '';
  const next = src.indexOf('\napp.', start + 1);
  return src.slice(start, next < 0 ? src.length : next);
}

function main() {
  const v = spawnChild(true, { jobs: 'ok' });
  const off = spawnChild(false, {});
  if (!v.ok) { console.error('BWG ABORT:', v.detail); process.exitCode = 1; return; }
  if (!off.ok) { console.error('BWG ABORT (offline):', off.detail); process.exitCode = 1; return; }

  check('BWG-00', 'the live child really is talking to a configured store', v.live === true, v.live);

  // ============================ 1. a refused insert is a failed booking
  REFUSED.forEach((kind, i) => {
    const h = v[`insert_${kind}`];
    check(`BWG-0${i + 1}`,
      `a store refusal of the jobs insert (${kind}) fails closed instead of returning a booked job`,
      h && h.threw === true && (h.storeFailure === true || h.unreachable === true),
      h);
  });

  check('BWG-06', 'a refused booking never adds a mirror row that claims the trip exists',
    REFUSED.every((k) => v[`insert_${k}`] && v[`insert_${k}`].mirrorNew === 0),
    REFUSED.map((k) => ({ k, mirrorNew: v[`insert_${k}`] && v[`insert_${k}`].mirrorNew })));

  check('BWG-07', 'no refused booking leaves a jobs row readable under the number it was answered with',
    REFUSED.every((k) => v[`insert_${k}`] && v[`insert_${k}`].inMirror === false),
    REFUSED.map((k) => ({ k, inMirror: v[`insert_${k}`] && v[`insert_${k}`].inMirror })));

  check('BWG-08', 'a store failure is never answered as the caller\'s mistake (no 4xx on the error)',
    REFUSED.every((k) => {
      const h = v[`insert_${k}`];
      return h && (h.status === undefined || h.status >= 500);
    }),
    REFUSED.map((k) => ({ k, status: v[`insert_${k}`] && v[`insert_${k}`].status })));

  check('BWG-09', 'the engine code travels on the error so replyStoreError can classify it, and a dead socket reads as an outage',
    Boolean(v.insert_42P01 && v.insert_42P01.code === '42P01')
      && Boolean(v.insert_23503 && v.insert_23503.code === '23503')
      && Boolean(v.insert_22001 && v.insert_22001.code === '22001')
      && Boolean(v.insert_23505 && v.insert_23505.code === '23505')
      && Boolean(v.insert_fetch && v.insert_fetch.unreachable === true),
    REFUSED.map((k) => ({ k, code: v[`insert_${k}`] && v[`insert_${k}`].code, unreachable: v[`insert_${k}`] && v[`insert_${k}`].unreachable })));

  check('BWG-10', 'PostgreSQL\'s sentence about itself stays off the answer and on the field only the log reads',
    REFUSED.every((k) => {
      const h = v[`insert_${k}`];
      return h && h.leaked === false && (k === 'fetch' ? /fetch failed|ECONNREFUSED/i.test(h.reason) : engineText(h.reason));
    }),
    REFUSED.map((k) => ({ k, leaked: v[`insert_${k}`] && v[`insert_${k}`].leaked, reason: v[`insert_${k}`] && v[`insert_${k}`].reason })));

  // ============================ 2. positive controls
  check('BWG-11', 'a booking the store accepted still lands, exactly once, with its own identity',
    Boolean(v.cooperative) && v.cooperative.threw === false
      && v.cooperative.mirrorNew === 1
      && v.cooperative.inMirror === true
      && v.cooperative.returned && v.cooperative.returned.id === v.cooperative.attempted,
    v.cooperative);

  check('BWG-12', 'one accepted booking is one mirror row, not the repository and the facade each writing one',
    Boolean(v.cooperative) && v.cooperative.mirrorNew === 1,
    { mirrorNew: v.cooperative && v.cooperative.mirrorNew });

  check('BWG-13', 'offline development with no durable store still books to the mirror (the gate is not over-tight)',
    off.live === false && off.offline && off.offline.threw === false
      && off.offline.mirrorNew === 1
      && off.offline.inMirror === true
      && off.offline.returned && off.offline.returned.status === 'SEARCHING',
    off.offline);

  check('BWG-14', 'the measured calls touched no table outside jobs',
    Array.isArray(v.observed) && v.observed.length > 0
      && v.observed.every((w) => w === 'jobs.write'),
    { observed: v.observed });

  // ============================ 3. the code no longer answers from the mirror
  const dbSrc = fs.readFileSync(DB_FILE, 'utf8');
  const repoSrcRaw = fs.readFileSync(REPO_FILE, 'utf8');
  const repoSrc = stripComments(repoSrcRaw);
  const serverSrc = fs.readFileSync(SERVER_FILE, 'utf8');

  const createJobSlice = dbSrc.slice(
    dbSrc.indexOf('async createJob('),
    dbSrc.indexOf('  // Schools CRUD'));
  check('BWG-15', 'createJob no longer trades a store failure for a mirror row and a warning',
    createJobSlice.length > 0 && /console\.warn/.test(createJobSlice) === false
      && /catch\s*\(/.test(createJobSlice) === false
      && /this\.jobRepo\.create/.test(createJobSlice),
    { slice: createJobSlice.length, warns: (createJobSlice.match(/console\.warn/g) || []).length });

  check('BWG-16', 'the repository marks jobs-insert refusals with the flag the routes already read',
    (repoSrc.match(/storeFailure/g) || []).length >= 3
      && /throw new Error\(`Failed to create job in PostgreSQL/.test(repoSrc) === false,
    { sites: (repoSrc.match(/storeFailure/g) || []).length });

  // Scoped to `create` on purpose: `findByIdAsync` is a read-through cache and is allowed
  // to fill `db.jobs` (Owner Decision 11), so a file-wide ban would fail for a reason
  // unrelated to the booking write.
  const createSlice = repoSrc.slice(
    repoSrc.indexOf('async create(jobData)'),
    repoSrc.indexOf('  async updateStatus('));
  check('BWG-17', 'the repository\'s create no longer writes the booking mirror the facade owns',
    createSlice.length > 0 && /this\.db\.jobs\.unshift/.test(createSlice) === false
      && /supabaseAdmin/.test(createSlice),
    { slice: createSlice.length, mirrors: (createSlice.match(/this\.db\.jobs\.unshift/g) || []).length });

  const rideRoute = routeSlice(serverSrc, '/api/customer/book-ride');
  check('BWG-18', 'the ride booking route classifies a store failure instead of hanging or answering success',
    rideRoute.length > 0 && /db\.createJob\(/.test(rideRoute)
      && /replyStoreError\(res, req, err, 'ride booking'\)/.test(rideRoute),
    { slice: rideRoute.length, classified: /replyStoreError\(res, req, err, 'ride booking'\)/.test(rideRoute) });

  const parcelRoute = routeSlice(serverSrc, '/api/customer/book-parcel');
  check('BWG-19', 'the parcel booking route classifies a store failure instead of hanging or answering success',
    parcelRoute.length > 0 && /db\.createJob\(/.test(parcelRoute)
      && /replyStoreError\(res, req, err, 'parcel booking'\)/.test(parcelRoute),
    { slice: parcelRoute.length, classified: /replyStoreError\(res, req, err, 'parcel booking'\)/.test(parcelRoute) });

  const failed = results.filter((r) => !r.pass);
  console.log('\n========================================================================');
  console.log(`📊 BOOKING WRITE GUARD: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) console.log('   failed: ' + failed.map((f) => f.id).join(', '));
  console.log('========================================================================');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.env.NABIN_BWG_CHILD) {
  runChild().catch((err) => {
    console.log(`BWG_VERDICT ${JSON.stringify({ crashed: String((err && err.message) || err), stack: String((err && err.stack) || '').slice(0, 400) })}`);
    process.exitCode = 2;
  });
} else {
  main();
}
