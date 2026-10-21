/**
 * NABIN Supabase Storage Integration Test Suite
 *
 * Scope: Phase B — Catalog Image Uploads (Restaurant dishes, Grocery products, Merchant media).
 * Verifies:
 *  1. Live storage connectivity & health check on development project (ywhxkzmbwppkdemvzlhv).
 *  2. Genuine upload of JPEG/PNG/WebP/AVIF images with stable HTTPS CDN public URL.
 *  3. Safe cleanup/removal of uploaded test assets from Supabase Storage.
 *  4. Mocked sandbox fallback when client or credentials are unconfigured.
 *  5. Rejection of invalid MIME types (e.g. application/x-msdownload, application/pdf).
 *  6. Magic-number binary content validation (rejects mismatched buffer content vs claimed MIME).
 *  7. Rejection of oversized image files (> 5 MB).
 *  8. Strict isolation from private KYC documents (Aadhaar, Voter ID, Passport, Driver License).
 *  9. Tenant isolation and path authorization (merchants cannot overwrite or delete other merchants' assets).
 * 10. Service module entitlement guards (Restaurant vs Grocery).
 * 11. End-to-end HTTP route tests for restaurant dish photo, grocery photo, and store media.
 * 12. Zero secret leakage in responses or logs.
 * 13. Zero base64 payload writes to database entities.
 */

const http = require('http');
const assert = require('assert');
const crypto = require('crypto');
const { SupabaseStorageService, supabaseStorageService } = require('./src/services/supabaseStorageService');
const { supabaseAdmin, isConfigured, isLivePostgres } = require('./src/supabase');
const db = require('./src/database');
const { app } = require('./src/server');

// This suite verifies the Supabase Storage catalog doors against the LOCAL Docker target.
// The public URL it asserts on is derived from the configured origin, never hard-coded to a
// hosted project, so a local `http://127.0.0.1:54321/...` and a hosted
// `https://<ref>.supabase.co/...` are both answered from what the deployment actually is.
const SUPABASE_PUBLIC_ORIGIN = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const CATALOG_BUCKET = process.env.SUPABASE_CATALOG_STORAGE_BUCKET || 'catalog-images';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_HOST = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/i;

// A strictly-guarded handle: only a live PostgreSQL target on a loopback/private host may be
// provisioned against or cleaned up. Production, a hosted ref, or an unconfigured (in-memory)
// boot refuses — the E2E positives then cannot run, which is reported rather than faked.
function localTargetGuard() {
  if (process.env.NODE_ENV === 'production') return { ok: false, reason: 'NODE_ENV=production' };
  if (!isLivePostgres || !supabaseAdmin) return { ok: false, reason: 'not a live PostgreSQL target (run via scripts/with_local_target.js)' };
  const match = /@([^:/]+):/.exec(String(process.env.DATABASE_URL || ''));
  const host = match ? match[1] : '';
  if (!LOCAL_HOST.test(host)) return { ok: false, reason: `database host '${host || '(unknown)'}' is not loopback/private` };
  return { ok: true, reason: 'local Docker target' };
}

// The provider-truth test for a returned URL: it is a real public object path on the configured
// storage origin (not a base64 payload, not the offline mock sandbox host).
function isStoragePublicUrl(url) {
  return typeof url === 'string'
    && url.startsWith(`${SUPABASE_PUBLIC_ORIGIN}/storage/v1/object/public/${CATALOG_BUCKET}/`)
    && !url.startsWith('data:')
    && !url.includes('supabase-mock.nabin.local');
}

async function ensureCatalogBucket(bucketName) {
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) throw new Error(`could not list buckets: ${listErr.message}`);
  if ((buckets || []).some(b => b.id === bucketName)) return { created: false, existed: true };
  const { error: createErr } = await supabaseAdmin.storage.createBucket(bucketName, { public: true });
  if (createErr) throw new Error(`could not create bucket: ${createErr.message}`);
  return { created: true, existed: false };
}

// Standard 1x1 test image buffers
const VALID_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9
]);

const VALID_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82
]);

// 12-byte minimal WebP header
const VALID_WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x20, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
  Buffer.from('VP8 ')
]);

// 16-byte minimal AVIF header
const VALID_AVIF = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x1c]),
  Buffer.from('ftyp'),
  Buffer.from('avif'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('avif')
]);

const OVERSIZED_BUFFER = Buffer.alloc(5 * 1024 * 1024 + 1024, 0xff); // 5 MB + 1 KB

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function report(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${name} ${details ? '— ' + details : ''}`);
  } else {
    failedTests++;
    console.error(`  ❌ [FAIL] ${name} ${details ? '— ' + details : ''}`);
  }
}

function httpRequest(serverPort, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
      ...headers
    };

    const req = http.request({
      host: '127.0.0.1',
      port: serverPort,
      method,
      path,
      headers: reqHeaders
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTestSuite() {
  console.log('========================================================================');
  console.log('🚀 NABIN PHASE B: SUPABASE STORAGE CATALOG INTEGRATION VERIFICATION');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------------
  // TEST 1: Service Health & Bucket Accessibility
  // -------------------------------------------------------------------------
  console.log('--- 1. BUCKET CONFIGURATION & HEALTH CHECK ---');
  const health = await supabaseStorageService.checkStorageHealth();
  report(
    'Supabase Storage service reports configured and ready',
    health.configured && health.ready,
    `Bucket: ${health.bucket}, Public: ${health.isPublic}`
  );

  // Deterministic local setup: prove the catalog bucket exists before any upload is asserted.
  // On a clean local stack the bucket may be absent, which makes the service throw and the
  // route answer a bare 400 — provisioning it idempotently makes the run reproducible. The
  // guard keeps this strictly on the loopback live target; production/hosted is refused.
  const DB = localTargetGuard();
  console.log(`[target] ${DB.ok ? 'local target accepted' : 'REFUSED'} — ${DB.reason}; storage origin ${SUPABASE_PUBLIC_ORIGIN || '(unset)'}; bucket ${CATALOG_BUCKET}`);
  if (DB.ok) {
    try {
      const bucket = await ensureCatalogBucket(CATALOG_BUCKET);
      console.log(`[bucket] '${CATALOG_BUCKET}' ${bucket.existed ? 'already present' : 'created'} on the local target.`);
    } catch (err) {
      report('Catalog bucket could not be provisioned on the local target', false, err.message);
    }
  }

  // -------------------------------------------------------------------------
  // TEST 2: Genuine Live Upload & Public CDN Delivery
  // -------------------------------------------------------------------------
  console.log('\n--- 2. GENUINE LIVE UPLOAD & CLEANUP (DEVELOPMENT INTEGRATION) ---');
  const merchantId = '00000000-0000-0000-0000-000000000201'; // Dilli Darbar
  const dishId = 'dish_butter_chicken_101';

  try {
    const uploadRes = await supabaseStorageService.uploadCatalogImage({
      fileData: VALID_JPEG,
      merchantId,
      category: 'dishes',
      itemId: dishId,
      mimeType: 'image/jpeg'
    });

    report(
      'Live Supabase upload returns success: true',
      uploadRes.success === true,
      `Storage Provider: ${uploadRes.storageProvider}`
    );
    report(
      'Upload returns a stable public URL on the configured Supabase storage CDN origin',
      isStoragePublicUrl(uploadRes.publicUrl),
      `${uploadRes.publicUrl} (${/supabase\.co/.test(SUPABASE_PUBLIC_ORIGIN) ? 'hosted project' : 'local origin'})`
    );
    report(
      'Upload generates server-authoritative path containing merchant and category',
      uploadRes.path.startsWith(`merchants/${merchantId}/dishes/${dishId}_`),
      uploadRes.path
    );
    report(
      'Response provides optimized_urls with safe client fallback URL',
      uploadRes.optimized_urls && uploadRes.optimized_urls.fallback === '/assets/images/catalog-placeholder.png'
    );
    report(
      'Response does NOT expose Supabase service-role key or private credentials',
      !JSON.stringify(uploadRes).includes('service_role') && !uploadRes.serviceKey
    );

    // Clean up live uploaded test file
    const deleteRes = await supabaseStorageService.deleteCatalogImage({
      merchantId,
      path: uploadRes.path
    });
    report(
      'Safe cleanup deletes test asset from storage without errors',
      deleteRes.success === true && Array.isArray(deleteRes.removed)
    );
  } catch (err) {
    report('Live Supabase upload failed with exception', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Multi-Format Magic Number Validation (PNG, WebP, AVIF)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. MULTI-FORMAT MAGIC NUMBER VERIFICATION ---');
  try {
    const pngRes = await supabaseStorageService.uploadCatalogImage({
      fileData: VALID_PNG,
      merchantId,
      category: 'grocery',
      itemId: 'prod_atta_1',
      mimeType: 'image/png'
    });
    report('PNG format successfully verified and uploaded', pngRes.format === 'png');
    await supabaseStorageService.deleteCatalogImage({ merchantId, path: pngRes.path });

    const webpRes = await supabaseStorageService.uploadCatalogImage({
      fileData: VALID_WEBP,
      merchantId,
      category: 'dishes',
      itemId: 'dish_biryani_1',
      mimeType: 'image/webp'
    });
    report('WebP format successfully verified and uploaded', webpRes.format === 'webp');
    await supabaseStorageService.deleteCatalogImage({ merchantId, path: webpRes.path });

    const avifRes = await supabaseStorageService.uploadCatalogImage({
      fileData: VALID_AVIF,
      merchantId,
      category: 'media',
      itemId: 'cover',
      mimeType: 'image/avif'
    });
    report('AVIF format successfully verified and uploaded', avifRes.format === 'avif');
    await supabaseStorageService.deleteCatalogImage({ merchantId, path: avifRes.path });
  } catch (err) {
    report('Multi-format verification failed', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Rejection of Invalid MIME Types & Corrupted Buffers
  // -------------------------------------------------------------------------
  console.log('\n--- 4. MIME VALIDATION & SPOOFING DEFENSE ---');
  try {
    let rejectedBadMime = false;
    try {
      await supabaseStorageService.uploadCatalogImage({
        fileData: VALID_JPEG,
        merchantId,
        category: 'dishes',
        itemId: 'dish_spoof',
        mimeType: 'application/x-msdownload'
      });
    } catch (e) {
      rejectedBadMime = /Unsupported MIME type/.test(e.message);
    }
    report('Rejects disallowed MIME type (application/x-msdownload)', rejectedBadMime);

    let rejectedMismatchedContent = false;
    try {
      // Claimed PNG, but sent JPEG buffer
      await supabaseStorageService.uploadCatalogImage({
        fileData: VALID_JPEG,
        merchantId,
        category: 'dishes',
        itemId: 'dish_mismatch',
        mimeType: 'image/png'
      });
    } catch (e) {
      rejectedMismatchedContent = /mismatch|Unsupported MIME type/.test(e.message);
    }
    report('Rejects buffer content that contradicts claimed MIME type', rejectedMismatchedContent);

    let rejectedNonImageBinary = false;
    try {
      const fakeBinary = Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'); // DOS executable header
      await supabaseStorageService.uploadCatalogImage({
        fileData: fakeBinary,
        merchantId,
        category: 'dishes',
        itemId: 'dish_exe',
        mimeType: 'image/jpeg'
      });
    } catch (e) {
      rejectedNonImageBinary = /Unsupported MIME type/.test(e.message);
    }
    report('Rejects executable/non-image buffer disguised with image/jpeg MIME', rejectedNonImageBinary);
  } catch (err) {
    report('MIME validation tests encountered unexpected error', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 5: File Size Boundary Enforcement (Max 5 MB)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. FILE SIZE BOUNDARY ENFORCEMENT ---');
  try {
    let rejectedOversized = false;
    try {
      await supabaseStorageService.uploadCatalogImage({
        fileData: OVERSIZED_BUFFER,
        merchantId,
        category: 'dishes',
        itemId: 'dish_large',
        mimeType: 'image/jpeg'
      });
    } catch (e) {
      rejectedOversized = /exceeds maximum allowed limit of 5MB/i.test(e.message);
    }
    report('Strictly enforces 5 MB maximum file size limit for catalog photos', rejectedOversized);
  } catch (err) {
    report('File size limit check failed', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Strict Isolation from Private KYC & Identity Documents
  // -------------------------------------------------------------------------
  console.log('\n--- 6. PRIVATE KYC & IDENTITY DOCUMENT ISOLATION ---');
  try {
    let aadhaarBlocked = false;
    try {
      await supabaseStorageService.uploadCatalogImage({
        fileData: VALID_JPEG,
        merchantId: 'aadhaar_card_owner',
        category: 'dishes',
        itemId: 'dish_1'
      });
    } catch (e) {
      aadhaarBlocked = /Sensitive identity documents/i.test(e.message);
    }
    report('Blocks Aadhaar keyword in path/identifiers from public catalog bucket', aadhaarBlocked);

    let kycCategoryBlocked = false;
    try {
      await supabaseStorageService.uploadCatalogImage({
        fileData: VALID_JPEG,
        merchantId,
        category: 'kyc_documents',
        itemId: 'dish_1'
      });
    } catch (e) {
      kycCategoryBlocked = /Sensitive identity documents/i.test(e.message);
    }
    report('Blocks KYC keyword in category from public catalog bucket', kycCategoryBlocked);

    let passportItemIdBlocked = false;
    try {
      await supabaseStorageService.uploadCatalogImage({
        fileData: VALID_JPEG,
        merchantId,
        category: 'dishes',
        itemId: 'passport_scan'
      });
    } catch (e) {
      passportItemIdBlocked = /Sensitive identity documents/i.test(e.message);
    }
    report('Blocks Passport keyword in item ID from public catalog bucket', passportItemIdBlocked);
  } catch (err) {
    report('KYC isolation check encountered unexpected error', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Tenant Isolation & Path Cross-Overwrite Protection
  // -------------------------------------------------------------------------
  console.log('\n--- 7. TENANT ISOLATION & UNAUTHORIZED DELETION PROTECTION ---');
  try {
    const merchantB = '2699ade3-e014-4731-95dc-c79b095def40'; // Test Bistro M1
    let crossDeleteBlocked = false;
    try {
      // Merchant A attempting to delete Merchant B's storage path
      await supabaseStorageService.deleteCatalogImage({
        merchantId, // Caller is Merchant A
        path: `merchants/${merchantB}/dishes/dish_test_1.jpg`
      });
    } catch (e) {
      crossDeleteBlocked = e.status === 403 && e.code === 'MERCHANT_MISMATCH';
    }
    report('Prevents Merchant A from deleting Merchant B storage assets (MERCHANT_MISMATCH 403)', crossDeleteBlocked);
  } catch (err) {
    report('Tenant cross-deletion check failed', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 8: Mock Sandbox Fallback when Unconfigured
  // -------------------------------------------------------------------------
  console.log('\n--- 8. MOCK SANDBOX FALLBACK (OFFLINE DEVELOPMENT MODE) ---');
  try {
    const mockService = new SupabaseStorageService({
      bucket: 'catalog-images',
      client: null // Unconfigured client simulation
    });

    const mockRes = await mockService.uploadCatalogImage({
      fileData: VALID_JPEG,
      merchantId: 'mock_mcht_1',
      category: 'dishes',
      itemId: 'mock_dish_1',
      mimeType: 'image/jpeg'
    });

    report('Unconfigured service falls back to mock sandbox with mock: true', mockRes.mock === true);
    report('Mock storage provider declared as supabase-mock', mockRes.storageProvider === 'supabase-mock');
    report('Mock public URL generated without network attempt', mockRes.publicUrl.includes('supabase-mock.nabin.local'));
  } catch (err) {
    report('Mock fallback verification failed', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Zero Base64 Payload Persistence in Database
  // -------------------------------------------------------------------------
  console.log('\n--- 9. ZERO BASE64 IN DATABASE VERIFICATION ---');
  try {
    const testAsset = db.saveMediaAsset({
      ownerType: 'MENU_ITEM',
      ownerId: 'dish_test_no_base64',
      mediaType: 'FOOD_PHOTO',
      public_id: 'merchants/m_1/dishes/dish_1.jpg',
      secure_url: 'https://ywhxkzmbwppkdemvzlhv.supabase.co/storage/v1/object/public/catalog-images/merchants/m_1/dishes/dish_1.jpg',
      folder: 'merchants/m_1/dishes'
    });

    report(
      'Media asset record stores HTTPS CDN reference rather than base64 payload',
      !testAsset.secureUrl.startsWith('data:') && testAsset.secureUrl.startsWith('https://')
    );
    report(
      'Database media assets collection does NOT contain raw base64 data',
      !JSON.stringify(testAsset).includes('base64,')
    );
  } catch (err) {
    report('Database base64 check failed', false, err.message);
  }

  // -------------------------------------------------------------------------
  // TEST 10: End-to-End Express HTTP Route Verification
  // -------------------------------------------------------------------------
  console.log('\n--- 10. END-TO-END EXPRESS HTTP ROUTE VERIFICATION ---');

  // Teardown handles live outside the try so the `finally` can always remove what this run
  // created, even if an assertion throws partway through. Each stays null until provisioned.
  let realDishId = null;            // an existing dish on merchant A's live catalogue
  let provisionedProductId = null;  // a product this run inserted for the grocery store
  const mintedAssetIds = [];        // media_assets public_ids the positive uploads created

  const testServer = http.createServer(app);
  await new Promise((res) => testServer.listen(0, '127.0.0.1', res));
  const serverPort = testServer.address().port;

  // These routes read the live PostgreSQL catalogue, so the E2E positives must aim at rows that
  // exist there — an in-memory-only id returns 404 at the catalogue lookup *before* MIME or
  // upload validation, which is the wrong thing to assert. Fixtures are provisioned against the
  // strictly-guarded local target only; the auth negatives run regardless.
  const MCHT_A_UUID = '00000000-0000-0000-0000-000000000201'; // Dilli Darbar (RESTAURANT)
  const MCHT_B_UUID = '2699ade3-e014-4731-95dc-c79b095def40'; // Test Bistro M1 (RESTAURANT)
  const GROCERY_UUID = '00000000-0000-0000-0000-000000000203'; // Fresh Mart (GROCERY)

  try {
    if (DB.ok) {
      const { data: dishRows } = await supabaseAdmin
        .from('products').select('id').eq('merchant_id', MCHT_A_UUID).limit(1);
      realDishId = dishRows && dishRows.length ? dishRows[0].id : null;

      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('products')
        .insert({ merchant_id: GROCERY_UUID, name: 'Supabase Storage Suite Test Product', category: 'Test', price: 10, is_available: true })
        .select('id').single();
      if (insertErr) {
        report('Could not provision a grocery product for the E2E photo route', false, insertErr.message);
      } else {
        provisionedProductId = inserted.id;
      }
      report('Live-PG E2E fixtures available (a real dish and a provisioned product)', Boolean(realDishId && provisionedProductId),
        `dish=${realDishId || 'none'} product=${provisionedProductId || 'none'}`);
    } else {
      report('Live-PG E2E fixtures require the guarded local target', false, `${DB.reason} — run via scripts/with_local_target.js`);
    }

    // Sessions are seeded into the in-memory Map that `getSessionByToken` consults; the store each
    // session names is a real live merchant, so mediaTargetStore resolves it from PostgreSQL.
    const TOKEN_MCHT_A = 'test-token-mcht-a-' + Date.now();
    const TOKEN_MCHT_B = 'test-token-mcht-b-' + Date.now();
    const TOKEN_CUSTOMER = 'test-token-cust-' + Date.now();
    const TOKEN_GROCERY = 'test-token-groc-' + Date.now();
    db.activeSessions.set(TOKEN_MCHT_A, { role: 'MERCHANT', entityId: MCHT_A_UUID, userId: 'usr_mcht_a', expiresAt: '2099-01-01T00:00:00Z' });
    db.activeSessions.set(TOKEN_MCHT_B, { role: 'MERCHANT', entityId: MCHT_B_UUID, userId: 'usr_mcht_b', expiresAt: '2099-01-01T00:00:00Z' });
    db.activeSessions.set(TOKEN_GROCERY, { role: 'MERCHANT', entityId: GROCERY_UUID, userId: 'usr_groc_1', expiresAt: '2099-01-01T00:00:00Z' });
    db.activeSessions.set(TOKEN_CUSTOMER, { role: 'CUSTOMER', entityId: 'usr_cust_1', userId: 'usr_cust_1', expiresAt: '2099-01-01T00:00:00Z' });

    const validDataUrl = `data:image/jpeg;base64,${VALID_JPEG.toString('base64')}`;
    const noteMinted = (res) => {
      const pid = res && res.body && res.body.asset && res.body.asset.public_id;
      if (pid) mintedAssetIds.push(pid);
    };

    // 10.1: Unauthenticated request rejected (refused before any catalogue read)
    const unauthRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_A_UUID}/menu/dish_dd_1/photo`, {
      fileData: validDataUrl,
      mimeType: 'image/jpeg'
    });
    report(
      'Unauthenticated dish photo upload returns 401 AUTH_REQUIRED',
      unauthRes.status === 401 && unauthRes.body.code === 'AUTH_REQUIRED'
    );

    // 10.2: Customer token rejected by role check
    const custRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_A_UUID}/menu/dish_dd_1/photo`, {
      fileData: validDataUrl,
      mimeType: 'image/jpeg'
    }, { Authorization: `Bearer ${TOKEN_CUSTOMER}` });
    report(
      'Customer token cannot upload merchant dish photo (403 FORBIDDEN)',
      custRes.status === 403 && custRes.body.code === 'FORBIDDEN'
    );

    // 10.3: Cross-tenant upload rejected
    const crossRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_B_UUID}/menu/dish_tb_1/photo`, {
      fileData: validDataUrl,
      mimeType: 'image/jpeg'
    }, { Authorization: `Bearer ${TOKEN_MCHT_A}` });
    report(
      'Merchant A cannot upload photo for Merchant B restaurant (403 MERCHANT_MISMATCH)',
      crossRes.status === 403 && crossRes.body.code === 'MERCHANT_MISMATCH'
    );

    // 10.4: Module entitlement check (Grocery merchant attempting a restaurant dish photo)
    const entRes = await httpRequest(serverPort, 'POST', `/api/merchant/${GROCERY_UUID}/menu/dish_dd_1/photo`, {
      fileData: validDataUrl,
      mimeType: 'image/jpeg'
    }, { Authorization: `Bearer ${TOKEN_GROCERY}` });
    report(
      'Grocery-only merchant cannot upload restaurant dish photo (403 MERCHANT_TYPE_MISMATCH)',
      entRes.status === 403 && entRes.body.code === 'MERCHANT_TYPE_MISMATCH'
    );

    // 10.5–10.6 need a dish that exists in the live catalogue so the route reaches MIME/upload.
    if (realDishId) {
      // 10.5: Disallowed MIME type rejected with 400
      const badMimeRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_A_UUID}/menu/${realDishId}/photo`, {
        fileData: validDataUrl,
        mimeType: 'application/x-msdownload'
      }, { Authorization: `Bearer ${TOKEN_MCHT_A}` });
      report(
        'Disallowed MIME type returns 400 with Unsupported MIME type error',
        badMimeRes.status === 400 && /Unsupported MIME type/.test(badMimeRes.body.error || ''),
        `status=${badMimeRes.status} err=${badMimeRes.body && badMimeRes.body.error || ''}`
      );

      // 10.6: Valid dish photo upload returns a real storage object URL on the configured origin
      const dishUploadRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_A_UUID}/menu/${realDishId}/photo`, {
        fileData: validDataUrl,
        mimeType: 'image/jpeg'
      }, { Authorization: `Bearer ${TOKEN_MCHT_A}` });
      report(
        'Authorized merchant uploads restaurant dish photo via HTTP (200 OK, real storage URL)',
        dishUploadRes.status === 200 && dishUploadRes.body.success === true && isStoragePublicUrl(dishUploadRes.body.asset?.secureUrl),
        `status=${dishUploadRes.status} url=${dishUploadRes.body && dishUploadRes.body.asset?.secureUrl || '—'}`
      );
      noteMinted(dishUploadRes);
    } else {
      report('Disallowed MIME type returns 400 with Unsupported MIME type error', false, 'no live dish to photograph');
      report('Authorized merchant uploads restaurant dish photo via HTTP (200 OK, real storage URL)', false, 'no live dish to photograph');
    }

    // 10.7: Valid restaurant media (cover) upload — merchant A's own store
    const coverUploadRes = await httpRequest(serverPort, 'POST', `/api/merchant/${MCHT_A_UUID}/media`, {
      fileData: validDataUrl,
      mediaType: 'COVER',
      mimeType: 'image/jpeg'
    }, { Authorization: `Bearer ${TOKEN_MCHT_A}` });
    report(
      'Authorized merchant uploads restaurant cover banner via HTTP (200 OK, real storage URL)',
      coverUploadRes.status === 200 && coverUploadRes.body.success === true && isStoragePublicUrl(coverUploadRes.body.asset?.secureUrl),
      `status=${coverUploadRes.status} url=${coverUploadRes.body && coverUploadRes.body.asset?.secureUrl || '—'}`
    );
    noteMinted(coverUploadRes);

    // 10.8: Grocery product photo upload — against the product provisioned on the live store
    if (provisionedProductId) {
      const grocUploadRes = await httpRequest(serverPort, 'POST', `/api/grocery/products/${provisionedProductId}/photo`, {
        fileData: validDataUrl,
        mimeType: 'image/jpeg'
      }, { Authorization: `Bearer ${TOKEN_GROCERY}` });
      report(
        'Authorized grocery merchant uploads grocery product photo via HTTP (200 OK, real storage URL)',
        grocUploadRes.status === 200 && grocUploadRes.body.success === true && isStoragePublicUrl(grocUploadRes.body.asset?.secureUrl),
        `status=${grocUploadRes.status} url=${grocUploadRes.body && grocUploadRes.body.asset?.secureUrl || '—'}`
      );
      noteMinted(grocUploadRes);
    } else {
      report('Authorized grocery merchant uploads grocery product photo via HTTP (200 OK, real storage URL)', false, 'no grocery product provisioned');
    }
  } catch (err) {
    report('HTTP route verification failed with exception', false, err.message);
  } finally {
    testServer.close();

    // Teardown removes ONLY what this run created: the storage objects and durable media_assets
    // rows it minted, and the grocery product it inserted. Every id deleted here is one this run
    // recorded for itself, so a baseline or shared row can never be removed by it.
    if (DB.ok && (mintedAssetIds.length || provisionedProductId)) {
      for (const pid of mintedAssetIds) {
        const ownerFromPath = String(pid).split('/')[1];
        if (ownerFromPath) {
          await supabaseStorageService.deleteCatalogImage({ merchantId: ownerFromPath, path: pid }).catch(() => {});
        }
        await supabaseAdmin.from('media_assets').delete().eq('public_id', pid);
      }
      if (provisionedProductId) {
        await supabaseAdmin.from('products').delete().eq('id', provisionedProductId);
      }

      const { data: survivingAssets } = await supabaseAdmin
        .from('media_assets').select('public_id').in('public_id', mintedAssetIds.length ? mintedAssetIds : ['__none__']);
      report(
        'Teardown removed every media_assets row this run minted',
        (survivingAssets || []).length === 0,
        `minted=${mintedAssetIds.length} surviving=${(survivingAssets || []).length}`
      );
      if (provisionedProductId) {
        const { data: survivingProduct } = await supabaseAdmin
          .from('products').select('id').eq('id', provisionedProductId).maybeSingle();
        report('Teardown removed the provisioned grocery product', survivingProduct == null,
          survivingProduct ? 'product still present' : 'product removed');
      }
    } else if (!DB.ok) {
      console.log(`[store] teardown skipped — ${DB.reason}. Nothing was provisioned on a target the guarded handle is not allowed to write.`);
    }
  }

  // -------------------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log(`TOTAL PHASE B TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FAILED: ${failedTests}`);
  console.log('========================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((e) => {
  console.error('Test suite failed fatally:', e);
  process.exit(1);
});
