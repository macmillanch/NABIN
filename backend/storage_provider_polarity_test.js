'use strict';

// =========================================================================
// STORAGE PROVIDER POLARITY — P8 Phase 3, candidate B
//
// The two media storage adapters decide "am I real?" from one input: whether
// provider credentials happen to be present. Absent credentials, they return
//   success: true
//   secure_url: a URL on a CDN that does not exist
//   width/height/bytes: numbers the file was never measured against
// and deleteAsset() answers `result: 'ok'` for an asset no provider was ever
// asked to destroy. That is correct in development and indefensible anywhere
// else: a deployment whose keys were dropped, rotated out, or never set keeps
// answering 200 to uploaders, shows clients a broken image as a stored
// photograph, and writes the invented URL plus the invented dimensions into the
// durable `media_assets` ownership row. The same class was already closed twice
// — `SMS_MOCK_PROVIDER_FORBIDDEN` (#286) and `PUSH_GATEWAY_NOT_CONFIGURED`
// (#276) — both by `RuntimeMode.isProduction()` at call time, and both leaving
// the sandbox running outside production. This suite is the third of those three.
//
// What it pins:
//   A — in production, an unconfigured provider refuses instead of simulating,
//       with a coded 503, at the service seam for every mutating operation.
//   B — the refusal is decided at CALL time, not construction time, because
//       both adapters are singletons whose `isConfigured` is frozen at require.
//   C — outside production the simulation survives, and is labelled as
//       simulated in its payload AND in its host, so a URL cannot be mistaken
//       for a real cloud's.
//   D — over HTTP, against the durable store: a refused upload writes NO
//       `media_assets` row, and a refused delete keeps the row and its
//       ownership tuple untouched. A failure must not leave a false record.
//   E — the route reports the provider's refusal as the refusal it is (503),
//       not as a 400 client error.
//
// Runs only on the disposable isolated lane (`scripts/with_local_target.js`,
// `scripts/lane_check.js`). It refuses a non-loopback target before any socket
// opens, so it can never write to a hosted project.
// =========================================================================

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const targetGuard = require('./scripts/chain_target_guard');
const { trackServer, reapSpawnedServers, findFreePort } = require('./scripts/spawned_server');

// The store this suite reads and writes. A non-loopback target throws at load,
// before any request is made, so a misconfigured run can never touch real rows.
const PG_TARGET = targetGuard.requireLoopbackPgTarget({ label: 'storage_provider_polarity_test' });

const passed = [];
const failed = [];
function assert(name, cond, detail) {
  if (cond) { passed.push(name); console.log(`[PASS] ${name}`); }
  else { failed.push(name); console.log(`[FAIL] ${name}${detail ? ` -> ${JSON.stringify(detail)}` : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// A 1x1 placeholder JPEG data URI. The refused branch never decodes it; the
// simulated branch only needs `fileData` present and a MIME type to validate.
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNCwsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AOr/2Q==';

const ADMIN_USER = 'superadmin';
const ADMIN_PASSWORD = 'AdminPassword123!';
const BOOTSTRAP_SECRET = process.env.ADMIN_BOOTSTRAP_SECRET || 'local-secret-for-testing';

const REFUSAL_CODE = 'MEDIA_PROVIDER_NOT_CONFIGURED';

function makeRequest(baseUrl) {
  return (method, pathname, body = null, headers = {}) => new Promise((resolve, reject) => {
    const url = new URL(pathname, baseUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : null;
    const req = http.request({
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        ...headers,
      },
    }, (res) => {
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

async function bootServer({ port, request, extraEnv = {}, attempts = 60, delayMs = 500 }) {
  const proc = trackServer(spawn(process.execPath, [path.join(__dirname, 'src/server.js')], {
    cwd: __dirname,
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
    env: {
      ...process.env,
      PORT: String(port),
      // Never let a background timer of this process prune sessions the harness
      // did not provision (F-13).
      NABIN_SESSION_PRUNE: 'off',
      ...extraEnv,
    },
  }));
  proc.unref();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    try { const h = await request('GET', '/api/health'); if (h.status === 200) return proc; }
    catch { /* not up yet */ }
  }
  return proc; // caller reports readiness via the next health probe
}

async function stopProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' });
    } else {
      proc.kill('SIGTERM');
    }
  } catch { /* already gone */ }
}

// Admin sessions are password-only, so this suite needs no test convenience and
// can be run against a backend booted with NODE_ENV=production.
async function mintAdmin({ request }) {
  let res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  if (res.status !== 200 || !(res.data && res.data.token)) {
    await request('POST', '/api/admin/bootstrap', {
      bootstrapSecret: BOOTSTRAP_SECRET,
      username: ADMIN_USER,
      password: ADMIN_PASSWORD,
      name: 'Storage Polarity Bootstrap Admin',
    });
    res = await request('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASSWORD });
  }
  return { token: res.data && res.data.token, status: res.status, body: res.data };
}

// Track every public_id this run mints so teardown deletes exactly those rows
// and nothing broader.
const created = [];
function track(asset) {
  const pid = asset && asset.public_id;
  if (pid && !created.includes(pid)) created.push(pid);
  return pid;
}

let pg = null;
async function assetCount() {
  const r = await pg.query('select count(*)::int as n from media_assets');
  return r.rows[0].n;
}
async function pgRow(publicId) {
  const r = await pg.query(
    'select provider, public_id, owner_type, owner_id, tenant_id, folder, media_type, secure_url from media_assets where provider = $1 and public_id = $2',
    ['cloudinary', publicId]);
  return r.rows[0] || null;
}

// The durable columns a refused operation must never touch. Presence alone is a
// weak claim: a row whose owner was nulled still exists while its provenance is
// gone.
const OWNERSHIP_COLS = ['owner_type', 'owner_id', 'tenant_id', 'folder', 'media_type'];
function ownershipDrift(before, after) {
  if (!before || !after) return ['<row missing on one side>'];
  return OWNERSHIP_COLS.filter((c) => String(before[c]) !== String(after[c]))
    .map((c) => `${c}: ${before[c]} -> ${after[c]}`);
}

// --- in-process service handles -------------------------------------------
// Both adapters are singletons that freeze `isConfigured` at construction, and
// requiring supabaseStorageService pulls in the Supabase client. Build fresh,
// explicitly UNCONFIGURED instances so the seam under test is the branch itself,
// with no dependence on whatever CLOUDINARY_* the shell happens to carry.
const { SupabaseStorageService } = require('./src/services/supabaseStorageService');

function unconfiguredCloudinary() {
  const saved = {
    name: process.env.CLOUDINARY_CLOUD_NAME,
    key: process.env.CLOUDINARY_API_KEY,
    secret: process.env.CLOUDINARY_API_SECRET,
  };
  delete process.env.CLOUDINARY_CLOUD_NAME;
  delete process.env.CLOUDINARY_API_KEY;
  delete process.env.CLOUDINARY_API_SECRET;
  delete require.cache[require.resolve('./src/services/cloudinaryService')];
  const svc = require('./src/services/cloudinaryService');
  for (const [k, v] of [['CLOUDINARY_CLOUD_NAME', saved.name], ['CLOUDINARY_API_KEY', saved.key], ['CLOUDINARY_API_SECRET', saved.secret]]) {
    if (v !== undefined) process.env[k] = v;
  }
  return svc;
}

function withNodeEnv(value, fn) {
  const prev = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = value;
  try { return fn(); }
  finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
}

// Unwrap a rejection into the {code, status} pair the route needs, so the claim
// is about the coded channel and not about some message wording.
async function rejectionOf(promise) {
  try {
    const value = await promise;
    return { resolved: true, value };
  } catch (err) {
    return { resolved: false, code: err.code, status: err.status, message: err.message };
  }
}
function isRefusal(r) {
  return r.resolved === false && r.code === REFUSAL_CODE && r.status === 503;
}

async function main() {
  console.log('========================================================================');
  console.log('NABIN STORAGE PROVIDER POLARITY TEST — P8 Phase 3');
  const masked = (() => { try { const u = new URL(PG_TARGET.connectionString); return `${u.protocol}//${u.hostname}:${u.port}`; } catch { return '(masked)'; } })();
  console.log(`  TARGET       : ${masked} (loopback, proven by scripts/chain_target_guard.js)`);
  console.log(`  suite NODE_ENV: ${process.env.NODE_ENV || '(unset)'}`);
  console.log('========================================================================\n');

  pg = new Client({ connectionString: PG_TARGET.connectionString });
  await pg.connect();

  // =====================================================================
  // GROUP A — production refuses a provider that would store nothing
  // =====================================================================
  console.log('\n--- GROUP A: in production an unconfigured storage provider is refused, not simulated ---');
  const cx = unconfiguredCloudinary();
  assert('A0 the Cloudinary handle under test is unconfigured', cx.isConfigured === false, { isConfigured: cx.isConfigured });

  const prodImageUpload = await withNodeEnv('production', () => rejectionOf(cx.uploadImage({ fileData: TINY_JPEG, mimeType: 'image/jpeg' })));
  assert('A1 production image upload is refused with 503 ' + REFUSAL_CODE, isRefusal(prodImageUpload), prodImageUpload);
  assert('A2 production image upload does NOT report success', prodImageUpload.resolved === false, { value: prodImageUpload.value });

  const prodVideoUpload = await withNodeEnv('production', () => rejectionOf(cx.uploadVideo({ fileData: TINY_JPEG, mimeType: 'video/mp4' })));
  assert('A3 production video upload is refused with 503 ' + REFUSAL_CODE, isRefusal(prodVideoUpload), prodVideoUpload);

  const prodDelete = await withNodeEnv('production', () => rejectionOf(cx.deleteAsset('nabin/public/some_asset')));
  assert('A4 production delete is refused rather than reporting a destruction no provider confirmed',
    isRefusal(prodDelete), prodDelete);

  const sb = new SupabaseStorageService({ bucket: 'catalog-images', client: null, isConfigured: false });
  assert('A5 the Supabase Storage handle under test is unconfigured', sb.isConfigured === false, { isConfigured: sb.isConfigured });

  const prodCatalogUpload = await withNodeEnv('production', () => rejectionOf(sb.uploadCatalogImage({
    fileData: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    merchantId: '00000000-0000-0000-0000-000000000201',
    category: 'covers',
    itemId: 'polarity-probe',
    mimeType: 'image/jpeg',
  })));
  assert('A6 production catalog upload is refused with 503 ' + REFUSAL_CODE, isRefusal(prodCatalogUpload), prodCatalogUpload);

  const prodCatalogDelete = await withNodeEnv('production', () => rejectionOf(sb.deleteCatalogImage({
    merchantId: '00000000-0000-0000-0000-000000000201',
    path: 'merchants/00000000-0000-0000-0000-000000000201/covers/polarity-probe.jpg',
  })));
  assert('A7 production catalog delete is refused rather than reporting a removal no provider confirmed',
    isRefusal(prodCatalogDelete), prodCatalogDelete);

  // =====================================================================
  // GROUP B — the decision is made at call time
  // =====================================================================
  // The adapters are singletons whose `isConfigured` is fixed when the module is
  // first required, so a guard written as `if (!isConfigured) throw` at boot would
  // never see the environment a deployment actually runs with. Same handle, two
  // polarities, in one process.
  console.log('\n--- GROUP B: polarity is read at call time, not at construction ---');
  const sameHandleDev = await withNodeEnv('development', () => rejectionOf(cx.deleteAsset('nabin/public/some_asset')));
  assert('B1 the same unconfigured handle simulates outside production', sameHandleDev.resolved === true && sameHandleDev.value.mock === true, sameHandleDev);
  const sameHandleProd = await withNodeEnv('production', () => rejectionOf(cx.deleteAsset('nabin/public/some_asset')));
  assert('B2 and refuses through production, without being re-created', isRefusal(sameHandleProd), sameHandleProd);

  // =====================================================================
  // GROUP C — development simulation survives, and says so
  // =====================================================================
  console.log('\n--- GROUP C: legitimate local simulation is preserved and labelled ---');
  const devImage = (await withNodeEnv('local', () => rejectionOf(cx.uploadImage({ fileData: TINY_JPEG, mimeType: 'image/jpeg', bytes: 1234 })))).value;
  assert('C1 development image upload still succeeds as a simulation', Boolean(devImage) && devImage.success === true && devImage.mock === true, devImage);
  assert('C2 the simulated URL is not dressed as a real Cloudinary cloud',
    Boolean(devImage) && !String(devImage.secure_url).includes('res.cloudinary.com'), { secure_url: devImage && devImage.secure_url });
  assert('C3 the simulated URL names itself as simulated storage',
    Boolean(devImage) && /\.nabin\.local/.test(String(devImage.secure_url)), { secure_url: devImage && devImage.secure_url });
  assert('C4 the byte count is the caller\'s, not an invented 45000',
    Boolean(devImage) && devImage.bytes === 1234, { bytes: devImage && devImage.bytes });

  const devVariants = withNodeEnv('local', () => cx.generateVariantUrls('nabin/public/polarity_probe'));
  assert('C5 no variant URL falls back to a cloud name that does not exist',
    Object.values(devVariants).every((u) => !String(u).includes('nabin-media')), devVariants);

  const devCatalog = (await withNodeEnv('local', () => rejectionOf(sb.uploadCatalogImage({
    fileData: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    merchantId: '00000000-0000-0000-0000-000000000201',
    category: 'covers',
    itemId: 'polarity-probe',
    mimeType: 'image/jpeg',
  })))).value;
  assert('C6 development catalog upload keeps its labelled mock sandbox',
    Boolean(devCatalog) && devCatalog.mock === true && devCatalog.storageProvider === 'supabase-mock'
    && String(devCatalog.publicUrl).includes('supabase-mock.nabin.local'), devCatalog && { mock: devCatalog.mock, provider: devCatalog.storageProvider, url: devCatalog.publicUrl });

  const devCatalogDelete = (await withNodeEnv('local', () => rejectionOf(sb.deleteCatalogImage({
    merchantId: '00000000-0000-0000-0000-000000000201',
    path: 'merchants/00000000-0000-0000-0000-000000000201/covers/polarity-probe.jpg',
  })))).value;
  assert('C7 development catalog delete stays available and labelled',
    Boolean(devCatalogDelete) && devCatalogDelete.success === true && devCatalogDelete.mock === true, devCatalogDelete);

  // =====================================================================
  // GROUP D — durable consequences over HTTP
  // =====================================================================
  // A refusal that still wrote the ownership row would be a greener-looking
  // version of the same bug: the asset would exist with an owner, a folder and a
  // URL for bytes nothing ever stored.
  console.log('\n--- GROUP D: a refused media operation leaves no durable record ---');

  const devPort = await findFreePort();
  const devBase = `http://127.0.0.1:${devPort}`;
  const devReq = makeRequest(devBase);
  const devProc = await bootServer({ port: devPort, request: devReq });
  const devHealth = await devReq('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('D0a development-polarity backend is up', devHealth.status === 200, { status: devHealth.status });
  const devAdmin = await mintAdmin({ request: devReq });
  assert('D0b admin session minted on the development backend', Boolean(devAdmin.token), { status: devAdmin.status, body: devAdmin.body });

  const devUpload = await devReq('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(devAdmin.token));
  const devPid = track(devUpload.data && devUpload.data.asset);
  assert('D1 development upload answers 200 with a simulated asset', devUpload.status === 200 && Boolean(devPid), { status: devUpload.status, data: devUpload.data });
  const devRow = await pgRow(devPid);
  assert('D2 the simulated upload is a durable row on the isolated target', Boolean(devRow), { devPid });

  const prodPort = await findFreePort();
  const prodBase = `http://127.0.0.1:${prodPort}`;
  const prodReq = makeRequest(prodBase);
  // Same isolated store, same missing credentials — only the polarity changes.
  const prodProc = await bootServer({ port: prodPort, request: prodReq, extraEnv: { NODE_ENV: 'production' } });
  const prodHealth = await prodReq('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('D0c production-polarity backend (no Cloudinary credentials) is up', prodHealth.status === 200, { status: prodHealth.status });
  const prodAdmin = await mintAdmin({ request: prodReq });
  assert('D0d admin session minted on the production-polarity backend', Boolean(prodAdmin.token), { status: prodAdmin.status, body: prodAdmin.body });

  const countBefore = await assetCount();
  const refusedUpload = await prodReq('POST', '/api/media/upload', { fileData: TINY_JPEG, mimeType: 'image/jpeg' }, bearer(prodAdmin.token));
  const countAfter = await assetCount();
  assert('D3 production upload with no provider is refused, not a 200 success',
    refusedUpload.status === 503 && refusedUpload.data && refusedUpload.data.success === false, { status: refusedUpload.status, data: refusedUpload.data });
  assert('D4 the refusal arrives on the coded channel',
    refusedUpload.data && refusedUpload.data.code === REFUSAL_CODE, refusedUpload.data);
  assert('D5 a refused upload writes NO durable media-ownership row', countAfter === countBefore, { countBefore, countAfter });
  const inventedPid = refusedUpload.data && refusedUpload.data.asset && refusedUpload.data.asset.public_id;
  assert('D6 the refusal mints no asset identity at all', !inventedPid, { inventedPid });

  // A delete the provider was never asked to perform must not report 'ok', and
  // must not drop or mutate the row that proves who owns the asset.
  const rowBefore = await pgRow(devPid);
  const refusedDelete = await prodReq('DELETE', `/api/media/${devPid}`, null, bearer(prodAdmin.token));
  const rowAfter = await pgRow(devPid);
  assert('D7 production delete with no provider is refused, not reported as destruction',
    refusedDelete.status === 503 && refusedDelete.data && refusedDelete.data.success === false, { status: refusedDelete.status, data: refusedDelete.data });
  assert('D8 the refused delete keeps the durable record', Boolean(rowAfter), { devPid });
  const drift = ownershipDrift(rowBefore, rowAfter);
  assert('D9 a refused delete cannot corrupt the durable ownership tuple', drift.length === 0, { drift, devPid });

  // The owner can still delete it against the development-polarity backend.
  const cleanupDelete = await devReq('DELETE', `/api/media/${devPid}`, null, bearer(devAdmin.token));
  assert('D10 the asset is deletable on the development-polarity backend',
    cleanupDelete.status === 200 && cleanupDelete.data && cleanupDelete.data.success === true, cleanupDelete.data);

  await stopProc(prodProc);
  await stopProc(devProc);

  console.log('\n================ SUMMARY ================');
  console.log(`PASSED: ${passed.length}   FAILED: ${failed.length}`);
  if (failed.length) {
    console.log('Failed checks:');
    for (const name of failed) console.log(`  - ${name}`);
  }
  console.log(`STORAGE PROVIDER POLARITY TEST: ${passed.length}/${passed.length + failed.length} passed, ${failed.length} failed`);
  process.exitCode = failed.length ? 1 : 0;
}

// Leave no residue: delete exactly the public_ids this run minted, by their own
// identities, and awaited — a fire-and-forget cleanup can exit before the delete
// lands. Rows this suite did not create are never touched, and no journal, ledger,
// payment or audit record is in scope here.
async function cleanup() {
  reapSpawnedServers();
  if (!pg) return;
  try {
    if (created.length) {
      const del = await pg.query(
        'delete from media_assets where provider = $1 and public_id = any($2)',
        ['cloudinary', created]);
      console.log(`[cleanup] deleted ${del.rowCount} of ${created.length} media_assets row(s) this run minted`);
    }
  } catch (e) {
    console.error('[CLEANUP FAILED] residue may remain in media_assets:', e.message);
  }
  try { await pg.end(); } catch { /* already closed */ }
}

async function run() {
  try {
    await main();
  } catch (err) {
    console.error('[FATAL] storage_provider_polarity_test threw outside the assertion harness:', err);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
  process.exit(process.exitCode || 0);
}

run();
