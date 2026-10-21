'use strict';

// =========================================================================
// NABIN — SECURITY HARDENING PHASE 2, OBJECTIVE 4: MEDIA AUTHENTICATION &
// DURABLE OWNERSHIP — EXECUTABLE SECURITY TESTS
//
// What this proves, property by property, against the LOCAL Docker Postgres
// (never a hosted store):
//
//   1. anonymous upload / list / signed-params / delete are rejected;
//   2. a caller cannot claim another principal's owner id (body `ownerId` /
//      `ownerType` are ignored; ownership is derived from the session);
//   3. a non-admin cannot forge the destination namespace or public id — the
//      asset lands in the caller's OWN namespace, and one merchant cannot read
//      another merchant's namespace;
//   4. a customer cannot delete another customer's asset (403, record kept);
//   5. a nonexistent durable record does NOT authorize provider deletion (404);
//   6. authorized owner + admin workflows still function;
//   7. invalid format / excessive size / malformed params are rejected;
//   8. metadata survives a backend restart;
//   9. a provider (or store) failure returns a failure, never a false success,
//      and keeps the durable record;
//  10. security-critical reads/writes are served from PostgreSQL, never the
//      in-memory fallback (`dataSource` is always 'postgresql' here).
//
// Every record this suite mints is disposable and is deleted from `media_assets`
// by its own public_id in the finally block. Nothing here targets production:
// `scripts/chain_target_guard.js` refuses a non-loopback target at load, and the
// live-Postgres check below refuses a store where durability would be a fiction
// (an in-process array cannot "survive a restart", so every durable assertion
// would silently be about nothing).
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { Client } = require('pg');
const { createLogin } = require('./testSessionCache');
const { trackServer, findFreePort } = require('./scripts/spawned_server');
const targetGuard = require('./scripts/chain_target_guard');
const { isLivePostgres, supabaseAdmin } = require('./src/supabase');

process.env.NABIN_TEST_MODE = 'true';

// The store this suite reads and writes. A non-loopback target throws at load,
// before any socket opens, so a misconfigured run can never write real rows.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'media_security_test' });

if (!isLivePostgres || !supabaseAdmin) {
  console.error('REFUSED — media_security_test must run against a LIVE Postgres target so');
  console.error('durability and the in-memory-fallback guard are meaningful. Run it under');
  console.error('`node scripts/with_local_target.js node media_security_test.js`.');
  process.exit(2);
}

const maskTarget = (value) => {
  try { const u = new URL(value); return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`; }
  catch { return '(unparsable)'; }
};

// A 1x1 placeholder JPEG data URI. The Cloudinary mock branch never decodes it;
// it only needs `fileData` to be present and a MIME type to validate.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNCwsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AOr/2Q==';

const FORGED_OWNER = '00000000-0000-0000-0000-000000000999';
const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data }); }
      });
    });
    req.on('error', (err) => reject(err));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Track every public_id this run mints, so the finally block leaves no residue.
const created = [];
function track(asset) {
  const pid = asset && asset.public_id;
  if (pid && !created.includes(pid)) created.push(pid);
  return pid;
}

let pg = null;
async function pgRow(publicId) {
  const r = await pg.query(
    'select provider, public_id, owner_type, owner_id, tenant_id, folder, media_type from media_assets where provider = $1 and public_id = $2',
    ['cloudinary', publicId]);
  return r.rows[0] || null;
}

// The durable columns a refused or failed media operation must never change. A delete that answered 403
// or 502 but silently nulled owner_id, re-pointed the folder, or flipped owner_type would still pass a
// `Boolean(await pgRow(...))` "record kept" check — the row exists but the provenance is gone, which is
// exactly the corruption Phase 2 exists to prevent. Comparing the tuple (not just presence) is the proof.
const OWNERSHIP_COLS = ['owner_type', 'owner_id', 'tenant_id', 'folder', 'media_type'];
function ownershipDrift(before, after) {
  if (!before || !after) return ['<row missing on one side>'];
  return OWNERSHIP_COLS.filter((c) => String(before[c]) !== String(after[c]))
    .map((c) => `${c}: ${before[c]} -> ${after[c]}`);
}

function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

// Boot a backend we own on `port` and wait until its health endpoint answers.
// Returns the child handle; the caller keeps it so it can be reaped (and, for the
// restart test, killed and replaced on the same port).
async function bootServer({ port, request, extraEnv = {}, attempts = 60, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      // Do not let a background timer prune sessions the harness did not provision.
      NABIN_SESSION_PRUNE: 'off',
      ...extraEnv,
    },
  }));
  proc.unref();
  const deadline = Date.now() + attempts * delayMs + 15000;
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
    if (Date.now() > deadline) break;
  }
  return proc; // caller reports readiness via the next health probe
}

// Confirm the port stops answering, so a respawn can bind it instead of racing a
// half-dead server.
async function waitForPortFree({ port, request, attempts = 40, delayMs = 250 }) {
  for (let i = 0; i < attempts; i++) {
    try { const h = await request('GET', '/api/health'); if (h.status !== 200) return true; }
    catch { return true; }
    await sleep(delayMs);
  }
  return false;
}

async function mintAdmin({ request, baseUrl }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    // No admin row yet in this store: bootstrap once, then log in.
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: 'local-secret-for-testing',
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Media Security Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  const token = res.data && res.data.token;
  return { token, status: res.status, body: res.data, baseUrl };
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN MEDIA SECURITY TEST — Phase 2 / Objective 4');
  console.log(`  target label : ${process.env.NABIN_TARGET_LABEL || '(unset)'}`);
  console.log(`  pg host      : ${maskTarget(process.env.DATABASE_URL)}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  const port = await findFreePort();
  const BASE = `http://127.0.0.1:${port}`;
  const request = makeRequest(BASE);

  let mainProc = null;
  let brokenProc = null;
  try {
  mainProc = await bootServer({ port, request });
  const health = await request('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('backend (this run started it) is healthy on its private port', health.status === 200, { port, health: health.status });

  // ----- identities ------------------------------------------------------
  const login = createLogin({ baseUrl: BASE, request });
  const admin = await mintAdmin({ request, baseUrl: BASE });
  assert('admin session minted', Boolean(admin.token), { status: admin.status });

  const custA = await login('9845011982', 'CUSTOMER');   // Priya,   ...0002 VERIFIED
  const custB = await login('9876543210', 'CUSTOMER');   // Rahul,   ...0001 active (pending KYC ≠ blocked)
  const mchA = await login('9811223344', 'MERCHANT');    // Dilli ...201
  const mchB = await login('9814045506', 'MERCHANT');    // separate restaurant store
  assert('customer A authenticated', Boolean(custA.token && custA.user), custA.failure || {});
  assert('customer B authenticated', Boolean(custB.token && custB.user), custB.failure || {});
  assert('merchant A authenticated', Boolean(mchA.token && mchA.user), mchA.failure || {});
  assert('merchant B authenticated', Boolean(mchB.token && mchB.user), mchB.failure || {});

  const A = custA.token, B = custB.token, MA = mchA.token, MB = mchB.token, AD = admin.token;
  const adminId = (admin.body && admin.body.admin && admin.body.admin.id) || null;

  // =====================================================================
  // GROUP 1 — anonymous rejected on every media door
  // =====================================================================
  console.log('\n--- GROUP 1: anonymous upload / list / signed-params / delete are rejected ---');
  const anonUpload = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' });
  assert('G1 anonymous POST /api/media/upload -> 401', anonUpload.status === 401, anonUpload.data);
  assert('G1 anonymous upload carries AUTH_REQUIRED', anonUpload.data && anonUpload.data.code === 'AUTH_REQUIRED', anonUpload.data);

  const anonList = await request('GET', '/api/media');
  assert('G1 anonymous GET /api/media -> 401', anonList.status === 401, anonList.data);

  const anonSigned = await request('GET', '/api/media/signed-params');
  assert('G1 anonymous GET /api/media/signed-params -> 401', anonSigned.status === 401, anonSigned.data);
  assert('G1 anonymous signed-params never returns a signature', !(anonSigned.data && anonSigned.data.params && anonSigned.data.params.signature), anonSigned.data);

  const anonDelete = await request('DELETE', `/api/media/nabin/public/anon_delete_${Date.now()}`);
  assert('G1 anonymous DELETE /api/media/* -> 401', anonDelete.status === 401, anonDelete.data);

  const badBearer = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer('not_a_real_session_token'));
  assert('G1 invalid bearer upload -> 401 INVALID_SESSION', badBearer.status === 401 && badBearer.data && badBearer.data.code === 'INVALID_SESSION', badBearer.data);

  // =====================================================================
  // GROUP 2 — ownership derives from the session, never the body
  // =====================================================================
  console.log('\n--- GROUP 2: caller cannot claim another principal\'s owner id ---');
  const forgeryUpload = await request('POST', '/api/media/upload', {
    fileData: TINY_JPEG,
    mimeType: 'image/jpeg',
    ownerType: 'ADMIN',            // forged: pretend to be an admin asset
    ownerId: FORGED_OWNER,         // forged: pretend to own someone else's id
  }, bearer(A));
  assert('G2 customer upload with forged body owner fields succeeds (200)', forgeryUpload.status === 200, forgeryUpload.data);
  const forgeryAsset = forgeryUpload.data && forgeryUpload.data.asset;
  const forgeryPid = track(forgeryAsset);
  assert('G2 saved asset ownerType is CUSTOMER, not the forged ADMIN', forgeryAsset && forgeryAsset.ownerType === 'CUSTOMER', forgeryAsset);
  assert('G2 saved asset ownerId is NOT the forged id', forgeryAsset && String(forgeryAsset.ownerId) !== FORGED_OWNER, forgeryAsset);
  assert('G2 saved asset ownerId is the caller\'s own id', forgeryAsset && String(forgeryAsset.ownerId) === String((custA.user && custA.user.id)), forgeryAsset);
  assert('G2 saved asset dataSource is postgresql (durable, not memory)', forgeryAsset && forgeryAsset.dataSource === 'postgresql', forgeryAsset);
  const forgeryRow = await pgRow(forgeryPid);
  assert('G2 durable row exists in media_assets', Boolean(forgeryRow), forgeryRow);
  assert('G2 durable row owner_id is the session id, not the forged id', forgeryRow && String(forgeryRow.owner_id) !== FORGED_OWNER, forgeryRow);
  // The forged id owns nothing: an admin scoped read of that id must be empty.
  const forgedScoped = await request('GET', `/api/media?ownerId=${FORGED_OWNER}`, null, bearer(AD));
  const forgedList = (forgedScoped.data && forgedScoped.data.media) || [];
  assert('G2 admin scoped read of the forged owner id finds no row', forgedScoped.status === 200 && forgedList.every((m) => m.public_id !== forgeryPid), { status: forgedScoped.status, count: forgedList.length });

  // =====================================================================
  // GROUP 3 — namespace / public-id forgery refused; KYC folder rejected
  // =====================================================================
  console.log('\n--- GROUP 3: a non-admin cannot forge the destination folder or public id ---');
  const mBns = mchB.user && mchB.user.id;
  const nsForgery = await request('POST', '/api/media/upload', {
    fileData: TINY_JPEG,
    mimeType: 'image/jpeg',
    folder: `nabin/restaurants/${mBns}`,   // try to write into merchant B's namespace
    publicId: 'evil_forged_fixed_id',      // try to pin a fixed public id
  }, bearer(A));
  assert('G3 namespace-forgery upload succeeds into the CALLER\'S namespace', nsForgery.status === 200, nsForgery.data);
  const nsAsset = nsForgery.data && nsForgery.data.asset;
  const nsPid = track(nsAsset);
  assert('G3 forged folder was ignored: asset landed in the customer namespace', nsAsset && nsAsset.folder === `nabin/users/${nsAsset.ownerId}`, nsAsset);
  assert('G3 forged folder was NOT merchant B\'s namespace', nsAsset && !String(nsAsset.folder).includes(`restaurants/${mBns}`), nsAsset);
  assert('G3 forged publicId was ignored: id is server-minted under the caller namespace', nsAsset && !String(nsAsset.public_id).includes('evil_forged_fixed_id') && String(nsAsset.public_id).startsWith(`${nsAsset.folder}/`), nsAsset);

  const kycFolder = await request('POST', '/api/media/upload', {
    fileData: TINY_JPEG, mimeType: 'image/jpeg', folder: 'nabin/users/x/aadhaar_copy',
  }, bearer(A));
  assert('G3 a sensitive/KYC folder request is rejected 400 even for a customer', kycFolder.status === 400 && kycFolder.data && kycFolder.data.success === false, kycFolder.data);

  // =====================================================================
  // GROUP 4 — merchant tenant isolation on writes and reads
  // =====================================================================
  console.log('\n--- GROUP 4: one merchant cannot upload into / list another\'s namespace ---');
  const mUploadA = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(MA));
  const mAssetA = mUploadA.data && mUploadA.data.asset;
  const mPidA = track(mAssetA);
  assert('G4 merchant A upload lands in its restaurant namespace with ownerType MERCHANT', mAssetA && mAssetA.ownerType === 'MERCHANT' && mAssetA.folder === `nabin/restaurants/${mAssetA.ownerId}`, mAssetA);
  const mUploadB = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(MB));
  const mPidB = track(mUploadB.data && mUploadB.data.asset);

  const listA = await request('GET', '/api/media', null, bearer(MA));
  const listARows = (listA.data && listA.data.media) || [];
  assert('G4 merchant A list is scoped to A (every row owned by A)', listA.status === 200 && listARows.length > 0 && listARows.every((m) => String(m.ownerId) === String(mAssetA.ownerId)), { count: listARows.length });
  assert('G4 merchant A list dataSource is postgresql', listA.data && listA.data.dataSource === 'postgresql', listA.data);

  const listB = await request('GET', '/api/media', null, bearer(MB));
  const listBrows = (listB.data && listB.data.media) || [];
  assert('G4 merchant B list does NOT contain A\'s asset', listB.status === 200 && listBrows.every((m) => m.public_id !== mPidA), { count: listBrows.length });
  assert('G4 merchant B list does NOT contain customer A\'s asset', listBrows.every((m) => m.public_id !== nsPid));

  const forgedFolderList = await request('GET', `/api/media?folder=nabin/restaurants/${mBns}`, null, bearer(MA));
  const forgedFolderRows = (forgedFolderList.data && forgedFolderList.data.media) || [];
  assert('G4 merchant A ?folder=<B> query stays scoped to A (no leak of B\'s row)', forgedFolderList.status === 200 && forgedFolderRows.every((m) => m.public_id !== mPidB), { count: forgedFolderRows.length });

  // =====================================================================
  // GROUP 5 — user cannot delete another's asset; owner can
  // =====================================================================
  console.log('\n--- GROUP 5: cross-owner delete forbidden; owner delete allowed ---');
  const ownerAsset = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(A));
  const ownerPid = track(ownerAsset.data && ownerAsset.data.asset);
  assert('G5 owner asset minted', Boolean(ownerPid), ownerAsset.data);
  const ownerRowBefore = await pgRow(ownerPid);
  assert('G5 durable ownership row present before the forbidden delete', Boolean(ownerRowBefore), { ownerPid });

  const crossDelete = await request('DELETE', `/api/media/${ownerPid}`, null, bearer(B));
  assert('G5 customer B deleting customer A\'s asset -> 403 FORBIDDEN_NOT_OWNER', crossDelete.status === 403 && crossDelete.data && crossDelete.data.code === 'FORBIDDEN_NOT_OWNER', crossDelete.data);
  const ownerRowAfterCross = await pgRow(ownerPid);
  assert('G5 record KEPT after a forbidden delete', Boolean(ownerRowAfterCross), { ownerPid });
  const crossDrift = ownershipDrift(ownerRowBefore, ownerRowAfterCross);
  assert('G5 forbidden delete cannot corrupt the durable ownership tuple', crossDrift.length === 0, { drift: crossDrift, ownerPid });

  const ownDelete = await request('DELETE', `/api/media/${ownerPid}`, null, bearer(A));
  assert('G5 owner DELETE -> 200 success', ownDelete.status === 200 && ownDelete.data && ownDelete.data.success === true, ownDelete.data);
  assert('G5 record gone after the owner delete', (await pgRow(ownerPid)) === null, { ownerPid });

  // =====================================================================
  // GROUP 6 — a nonexistent record does not authorize provider deletion
  // =====================================================================
  console.log('\n--- GROUP 6: no durable record -> deletion refused before the provider runs ---');
  const ghost = `nabin/public/ghost_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const ghostAdmin = await request('DELETE', `/api/media/${ghost}`, null, bearer(AD));
  assert('G6 admin DELETE of a nonexistent record -> 404 MEDIA_ASSET_NOT_FOUND', ghostAdmin.status === 404 && ghostAdmin.data && ghostAdmin.data.code === 'MEDIA_ASSET_NOT_FOUND', ghostAdmin.data);
  const ghostCust = await request('DELETE', `/api/media/${ghost}`, null, bearer(A));
  assert('G6 customer DELETE of a nonexistent record -> 404 (record check precedes ownership)', ghostCust.status === 404 && ghostCust.data && ghostCust.data.code === 'MEDIA_ASSET_NOT_FOUND', ghostCust.data);

  // =====================================================================
  // GROUP 7 — invalid format / size / malformed params rejected
  // =====================================================================
  console.log('\n--- GROUP 7: invalid format, excessive size, and missing file data rejected ---');
  const badMime = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'application/pdf' }, bearer(A));
  assert('G7 unsupported MIME -> 400', badMime.status === 400 && badMime.data && badMime.data.success === false, badMime.data);
  const oversize = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg', bytes: 11 * 1024 * 1024 }, bearer(A));
  assert('G7 image over the 10MB limit -> 400', oversize.status === 400 && oversize.data && oversize.data.success === false, oversize.data);
  const noData = await request('POST', '/api/media/upload', { mimeType: 'image/jpeg' }, bearer(A));
  assert('G7 missing fileData -> 400 FILE_DATA_REQUIRED', noData.status === 400 && noData.data && noData.data.code === 'FILE_DATA_REQUIRED', noData.data);

  // =====================================================================
  // GROUP 8 — authorized admin workflow functions (broad list + delete)
  // =====================================================================
  console.log('\n--- GROUP 8: authorized admin can list broadly and delete any asset ---');
  const adminList = await request('GET', '/api/media', null, bearer(AD));
  const adminRows = (adminList.data && adminList.data.media) || [];
  const owners = new Set(adminRows.map((m) => m.ownerType));
  assert('G8 admin unfiltered list returns rows from multiple owner types', adminList.status === 200 && adminList.data.dataSource === 'postgresql' && owners.has('CUSTOMER') && owners.has('MERCHANT'), { count: adminRows.length, owners: [...owners] });

  const adminUpload = await request('POST', '/api/media/upload', {
    fileData: TINY_JPEG, mimeType: 'image/jpeg', folder: 'nabin/public', publicId: `nabin/public/admin_del_${Date.now()}`,
  }, bearer(AD));
  const adminPid = track(adminUpload.data && adminUpload.data.asset);
  assert('G8 admin upload with an explicit folder/publicId is honoured', adminUpload.status === 200 && adminUpload.data.asset.ownerType === 'ADMIN', adminUpload.data);
  const adminDelete = await request('DELETE', `/api/media/${adminPid}`, null, bearer(AD));
  assert('G8 admin DELETE of any asset -> 200', adminDelete.status === 200 && adminDelete.data && adminDelete.data.success === true, adminDelete.data);
  assert('G8 admin-deleted record is gone', (await pgRow(adminPid)) === null, { adminPid });

  // =====================================================================
  // GROUP 9 — signed-params: authenticated grant reaches the signer, anonymous
  // is refused (the mock signer throws without creds, so an authorized caller
  // gets 400 from the signer, never 401/403 — proving auth passed first).
  // =====================================================================
  console.log('\n--- GROUP 9: signed-params enforces auth before the signer runs ---');
  const custSigned = await request('GET', '/api/media/signed-params', null, bearer(A));
  assert('G9 customer signed-params is NOT refused for auth (past 401/403)', custSigned.status !== 401 && custSigned.status !== 403, custSigned.data);

  // =====================================================================
  // GROUP 10 — metadata survives a backend restart (durable, not in-memory)
  // =====================================================================
  console.log('\n--- GROUP 10: uploaded metadata survives a backend restart ---');
  const surviveUpload = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(A));
  const survivePid = track(surviveUpload.data && surviveUpload.data.asset);
  assert('G10 pre-restart durable row exists', Boolean(await pgRow(survivePid)), { survivePid });

  console.log('  restarting the backend this run owns (same port) ...');
  stopProc(mainProc);
  await waitForPortFree({ port, request });
  mainProc = await bootServer({ port, request });
  const rehealth = await request('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('G10 backend responds after restart', rehealth.status === 200, { status: rehealth.status });

  const login2 = createLogin({ baseUrl: BASE, request });
  const custA2 = await login2('9845011982', 'CUSTOMER');
  assert('G10 customer A can sign in to the restarted backend', Boolean(custA2.token), custA2.failure || {});
  const afterRestart = await request('GET', '/api/media', null, bearer(custA2.token));
  const afterRows = (afterRestart.data && afterRestart.data.media) || [];
  assert('G10 pre-restart asset is listed by the fresh process', afterRows.some((m) => m.public_id === survivePid), { count: afterRows.length });
  assert('G10 post-restart read is served from PostgreSQL, not memory', afterRestart.data && afterRestart.data.dataSource === 'postgresql', afterRestart.data);

  // =====================================================================
  // GROUP 11 — provider failure is a failure, and the durable record is kept
  // =====================================================================
  console.log('\n--- GROUP 11: a provider delete failure never reports success (record kept) ---');
  const failUpload = await request('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(custA2.token));
  const failPid = track(failUpload.data && failUpload.data.asset);
  assert('G11 asset to be provider-delete-tested minted on the current backend', Boolean(failPid), failUpload.data);
  const failRowBefore = await pgRow(failPid);

  const brokenPort = await findFreePort();
  const brokenBase = `http://127.0.0.1:${brokenPort}`;
  const brokenRequest = makeRequest(brokenBase);
  // Same live PostgreSQL, but Cloudinary is "configured" with unusable credentials,
  // so deleteAsset() reaches the provider and fails. This is the branch the mock
  // store can never exercise.
  brokenProc = await bootServer({
    port: brokenPort,
    request: brokenRequest,
    extraEnv: {
      CLOUDINARY_CLOUD_NAME: 'nabin-media-security-test-invalid',
      CLOUDINARY_API_KEY: 'invalid-key',
      CLOUDINARY_API_SECRET: 'invalid-secret',
    },
  });
  const brokenHealth = await brokenRequest('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('G11 provider-failure backend (unusable Cloudinary creds) is up', brokenHealth.status === 200, { status: brokenHealth.status });

  const brokenLogin = createLogin({ baseUrl: brokenBase, request: brokenRequest });
  const custABroken = await brokenLogin('9845011982', 'CUSTOMER');
  const providerDelete = await brokenRequest('DELETE', `/api/media/${failPid}`, null, bearer(custABroken.token));
  assert('G11 provider failure -> 502 PROVIDER_DELETE_FAILED, success:false', providerDelete.status === 502 && providerDelete.data && providerDelete.data.success === false && providerDelete.data.code === 'PROVIDER_DELETE_FAILED', providerDelete.data);
  const failRowAfter = await pgRow(failPid);
  assert('G11 durable record KEPT after a provider delete failure', Boolean(failRowAfter), { failPid });
  const providerDrift = ownershipDrift(failRowBefore, failRowAfter);
  assert('G11 failed provider delete cannot corrupt the durable ownership tuple', providerDrift.length === 0, { drift: providerDrift, failPid });
  // The owner can still delete it against a working (mock) provider.
  const retryDelete = await request('DELETE', `/api/media/${failPid}`, null, bearer(custA2.token));
  assert('G11 owner delete succeeds against the working backend', retryDelete.status === 200 && retryDelete.data && retryDelete.data.success === true, retryDelete.data);

  stopProc(brokenProc);
  brokenProc = null;

  // =====================================================================
  // GROUP 12 — the store answers every security read from PostgreSQL
  // (no in-memory fallback) for every principal type used above.
  // =====================================================================
  console.log('\n--- GROUP 12: security reads never fall back to the in-memory store ---');
  const dataSourceSamples = [
    await request('GET', '/api/media', null, bearer(A)),
    await request('GET', '/api/media', null, bearer(MA)),
    await request('GET', '/api/media', null, bearer(AD)),
  ];
  assert('G12 every media list under the live target reports dataSource=postgresql', dataSourceSamples.every((r) => r.data && r.data.dataSource === 'postgresql'), dataSourceSamples.map((r) => r.data && r.data.dataSource));

  // =====================================================================
  } finally {
    // Leave no residue: delete every asset this run minted, by its own public_id.
    // Some groups already delete their own row; this is idempotent for those, and it
    // runs even when a group threw, so a partial run cannot strand rows.
    try {
      if (created.length) {
        const del = await pg.query(
          'delete from media_assets where provider = $1 and public_id = any($2)',
          ['cloudinary', created]);
        console.log(`\n[cleanup] deleted ${del.rowCount} of ${created.length} tracked media_assets row(s) this run minted`);
      }
    } catch (cleanupErr) {
      console.error('[CLEANUP FAILED] residue may remain in media_assets:', cleanupErr.message);
    }

    console.log('\n================ SUMMARY ================');
    const remaining = await pg.query('select count(*)::int as n from media_assets')
      .then((r) => r.rows[0].n).catch(() => -1);
    console.log(`media_assets rows still present after cleanup: ${remaining}`);
    console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
    if (failed.length) {
      console.log('Failed checks:');
      for (const f of failed) console.log(`  - ${f}`);
    }

    // stop the backends we own so the next run may bind the ports.
    stopProc(brokenProc);
    stopProc(mainProc);
    await pg.end();
    process.exitCode = failed.length ? 1 : 0;
  }
}

main().catch(async (err) => {
  console.error('media_security_test harness error:', err && err.stack || err);
  try { if (pg) await pg.end(); } catch { /* noop */ }
  process.exit(1);
});
