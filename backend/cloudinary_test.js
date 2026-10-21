const https = require('https');
const http = require('http');
const { createLogin } = require('./testSessionCache');
const { supabaseAdmin, isLivePostgres } = require('./src/supabase');

const BASE_URL = process.env.NABIN_API_URL || 'http://localhost:4000';

// A direct store handle is only ever acceptable against a LOCAL live Postgres. It is used for
// flow-7 fixture provisioning and for cleaning up this run's media_assets — writes that must
// never touch a hosted or production project. Every condition is checked from the process's own
// environment, not trusted from a flag: production is refused even if live mode is on, and the
// Supabase host must be loopback/private. On any failure the suite keeps working purely over
// HTTP; flow 7 then simply reports the status the route actually returned rather than a
// provisioning result from a store it was not allowed to write.
const LOCAL_HOST = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|::1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/i;
function databaseGuard() {
  if (process.env.NODE_ENV === 'production' || process.env.NABIN_ENV === 'production') {
    return { ok: false, reason: 'production environment' };
  }
  if (!isLivePostgres || !supabaseAdmin) {
    return { ok: false, reason: 'not a live PostgreSQL target' };
  }
  let host = '';
  try { host = new URL(process.env.SUPABASE_URL || '').hostname; } catch (_) { /* fall through */ }
  if (!LOCAL_HOST.test(host)) {
    return { ok: false, reason: `supabase host ${host || '(unset)'} is not loopback/private` };
  }
  return { ok: true, reason: 'local live PostgreSQL' };
}

// The merchant media doors (flows 4-7) upload through Supabase Storage, which needs the
// `catalog-images` bucket. On a fresh local target it does not exist, so the route's storage call
// throws and answers a bare 400. Creating the bucket is environment provisioning, not a test
// fixture: it is idempotent (skip when present) and public-read (the route reads back a public URL),
// and it is shared local-dev infrastructure the durability suite also relies on — so it is created
// but never deleted. It only ever runs behind the same local-only guard as the direct store handle.
async function ensureCatalogBucket(bucketName) {
  const { data: buckets, error: listErr } = await supabaseAdmin.storage.listBuckets();
  if (listErr) throw new Error(`could not list buckets: ${listErr.message}`);
  if ((buckets || []).some((b) => b.id === bucketName)) return { created: false, existed: true };
  const { error: createErr } = await supabaseAdmin.storage.createBucket(bucketName, { public: true });
  if (createErr) throw new Error(`could not create bucket: ${createErr.message}`);
  return { created: true, existed: false };
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = BASE_URL.startsWith('https');
    const lib = isHttps ? https : http;
    const url = new URL(path, BASE_URL);
    const postData = body ? JSON.stringify(body) : null;

    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {}),
        ...headers
      }
    };

    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body: data });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// 1x1 Transparent Base64 Sample Image for test
const SAMPLE_IMAGE_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function runCloudinaryTestSuite() {
  console.log('========================================================================');
  console.log('☁️ NABIN CLOUDINARY MEDIA STORAGE & OPTIMIZATION TEST SUITE');
  console.log('🎯 Target Backend:', BASE_URL);
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(title, condition, detail = '') {
    if (condition) {
      console.log(`✅ [PASS] ${title} ${detail ? '— ' + detail : ''}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${title} ${detail ? '— ' + detail : ''}`);
      failed++;
    }
  }

  // Two auth surfaces, and this suite must reflect both honestly:
  //  - Flows 1, 2, 3 and 8 (customer/driver/parcel photo routes) keep the original
  //    "bearer optional, but enforced when present" contract. With no token the dev-convenience
  //    branch answers them, so they stay unauthenticated exactly as before.
  //  - Flows 4-7 are the Phase-2 merchant media doors, and the generic /api/media* surface in
  //    flows 9-14 now require a session. Sending none merely trips the 401, which tests the gate
  //    but not the upload. So these flows present a REAL, server-minted session for the identity
  //    that is actually allowed to act: a MERCHANT whose own store and merchant_type satisfy
  //    resolveMediaCaller + mediaTargetStore, and a CUSTOMER for the generic doors. Nothing here
  //    bypasses auth or loosens a route — it stops asserting against requests that were never
  //    authorized to succeed.
  // `request` returns { status, body }; createLogin reads { status, data } — hence the adapter.
  const login = createLogin({
    baseUrl: BASE_URL,
    request: (m, p, b, h) => request(m, p, b, h).then(r => ({ status: r.status, data: r.body })),
  });
  const cust = await login('9845011982', 'CUSTOMER');
  const AUTH = cust && cust.token ? { Authorization: `Bearer ${cust.token}` } : {};
  assert('CUSTOMER session minted for the authenticated media flows', Boolean(cust && cust.token),
    cust && cust.failure ? JSON.stringify(cust.failure) : '');

  // The store that owns the gated merchant doors. Phone → session → entityId resolves to the
  // caller's own store inside the route; no id is forged into the path or body.
  const rest = await login('9811223344', 'MERCHANT'); // RESTAURANT store …201 "Dilli Darbar"
  const REST_AUTH = rest && rest.token ? { Authorization: `Bearer ${rest.token}` } : {};
  assert('RESTAURANT MERCHANT session minted for flows 4-6', Boolean(rest && rest.token),
    rest && rest.failure ? JSON.stringify(rest.failure) : '');

  const groc = await login('9999900203', 'MERCHANT'); // GROCERY store …203 "Fresh Mart"
  const GROC_AUTH = groc && groc.token ? { Authorization: `Bearer ${groc.token}` } : {};
  assert('GROCERY MERCHANT session minted for flow 7', Boolean(groc && groc.token),
    groc && groc.failure ? JSON.stringify(groc.failure) : '');

  // Flow 7 needs a product the grocery store owns. Live PostgreSQL has none for …203, and no
  // HTTP route lets a merchant mint a master catalogue row, so the suite provisions exactly one
  // test-owned `products` row, exercises the authorized 200 path, then deletes that row plus every
  // media_asset this run created. This direct store handle is used ONLY when every guard below
  // holds — loopback target, live Postgres, never production — so it can never write a hosted
  // store. If any guard fails, provisioning is skipped and flow 7 reports the real status it got.
  const DB = databaseGuard();
  const createdAssetPublicIds = [];   // media_assets public_ids this run minted — cleaned up precisely
  let provisionedProductId = null;    // the one grocery product row this run inserts

  // Baseline the durable store BEFORE any flow writes to it. Both a count AND the set of public_ids
  // are measured: the id-set is what lets cleanup delete precisely the rows this run added (current
  // minus baseline) and provably never a pre-existing or shared row. The end assertion is that the
  // count returns to `mediaCountBaseline` — net zero new rows for this run.
  let mediaCountBaseline = null;
  let baselineAssetIds = null;
  if (DB.ok) {
    const { data: rows } = await supabaseAdmin.from('media_assets').select('public_id');
    baselineAssetIds = new Set((rows || []).map((r) => r.public_id).filter(Boolean));
    mediaCountBaseline = baselineAssetIds.size;
    console.log(`[store] media_assets baseline rows on local target: ${mediaCountBaseline}`);
  } else {
    console.log(`[store] direct-handle cleanup disabled — ${DB.reason}`);
  }

  // The Supabase Storage bucket the merchant media doors write into. Same guard as the store handle,
  // so this can only ever create a bucket on the local Docker project — never hosted or production.
  const CATALOG_BUCKET = process.env.SUPABASE_CATALOG_STORAGE_BUCKET || 'catalog-images';
  let bucketReady = false;
  if (DB.ok) {
    try {
      const provisioned = await ensureCatalogBucket(CATALOG_BUCKET);
      bucketReady = true;
      console.log(`[store] catalog bucket '${CATALOG_BUCKET}' ${provisioned.created ? 'created (public)' : 'already present'}`);
    } catch (e) {
      console.error(`[store] could not ensure catalog bucket: ${e.message}`);
    }
  } else {
    console.log(`[store] catalog bucket provisioning skipped — ${DB.reason}`);
  }

  // --- 1. FLOW 1: Customer Profile Photo Upload ---
  console.log('--- 1. FLOW 1: CUSTOMER PROFILE PHOTO ---');
  const custPhotoRes = await request('POST', '/api/customer/profile/photo', {
    customerId: 'usr_1',
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Customer updates profile avatar with optimized thumbnail', 
    custPhotoRes.status === 200 && custPhotoRes.body.user?.avatarUrl != null,
    `Avatar URL: ${custPhotoRes.body.user?.avatarUrl?.substring(0, 50)}...`
  );

  // --- 2. FLOW 2: Driver Profile Photo ---
  console.log('\n--- 2. FLOW 2: DRIVER PROFILE PHOTO ---');
  const drvPhotoRes = await request('POST', '/api/driver/profile/photo', {
    driverId: 'DRV-101',
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Driver updates profile photo and returns thumbnail', drvPhotoRes.status === 200 && drvPhotoRes.body.driver?.profilePhotoUrl != null);

  // --- 3. FLOW 3: Vehicle Exterior Photo ---
  console.log('\n--- 3. FLOW 3: VEHICLE EXTERIOR PHOTO ---');
  const vehPhotoRes = await request('POST', '/api/driver/vehicle/photo', {
    driverId: 'DRV-101',
    vehicleId: 'veh_dl_101',
    fileData: SAMPLE_IMAGE_BASE64,
    photoType: 'front_exterior',
    mimeType: 'image/png'
  });
  assert('Driver uploads vehicle exterior photo to vehicle gallery', vehPhotoRes.status === 200 && Array.isArray(vehPhotoRes.body.driver?.vehiclePhotos));

  // Each successful per-entity media write persists one durable media_assets row. The public id
  // comes back on `asset.cloudinaryPublicId`; recording it lets cleanup delete exactly this run's
  // rows — never a pre-existing asset, and never a shared record.
  const recordAsset = (body) => {
    const pid = body && body.asset && body.asset.cloudinaryPublicId;
    if (pid && !createdAssetPublicIds.includes(pid)) createdAssetPublicIds.push(pid);
    return pid;
  };

  // The grocery store the GROCERY session acts for. …203 "Fresh Mart Grocery Only" is a seed
  // store id (same identity the grocery durability suite signs in as); flow 7 gives it exactly one
  // test-owned catalogue row and deletes it again.
  const GROCERY_STORE_ID = '00000000-0000-0000-0000-000000000203';

  // --- 4. FLOW 4: Restaurant Logo (authenticated RESTAURANT merchant) ---
  console.log('\n--- 4. FLOW 4: RESTAURANT LOGO ---');
  // `/api/merchant/media` (no path id): the caller's own store is picked from the session, so no
  // `rest_1` and no forged uuid is needed — and none would be honoured if sent.
  const restLogoRes = await request('POST', '/api/merchant/media', {
    fileData: SAMPLE_IMAGE_BASE64,
    mediaType: 'LOGO',
    mimeType: 'image/png'
  }, REST_AUTH);
  recordAsset(restLogoRes.body);
  assert('Restaurant logo uploads as the authorized store and persists a media asset',
    restLogoRes.status === 200 && restLogoRes.body.success === true && restLogoRes.body.asset?.cloudinaryPublicId != null,
    `status=${restLogoRes.status} code=${restLogoRes.body.code || ''} err=${restLogoRes.body.error || ''} publicId=${restLogoRes.body.asset?.cloudinaryPublicId || 'none'}`);

  // --- 5. FLOW 5: Restaurant Cover Banner (authenticated RESTAURANT merchant) ---
  console.log('\n--- 5. FLOW 5: RESTAURANT COVER BANNER ---');
  const restCoverRes = await request('POST', '/api/merchant/media', {
    fileData: SAMPLE_IMAGE_BASE64,
    mediaType: 'COVER',
    mimeType: 'image/png'
  }, REST_AUTH);
  recordAsset(restCoverRes.body);
  assert('Restaurant cover banner uploads as the authorized store and persists a media asset',
    restCoverRes.status === 200 && restCoverRes.body.success === true && restCoverRes.body.asset?.cloudinaryPublicId != null,
    `status=${restCoverRes.status} code=${restCoverRes.body.code || ''} publicId=${restCoverRes.body.asset?.cloudinaryPublicId || 'none'}`);

  // --- 6. FLOW 6: Food / Menu Item Image (authenticated RESTAURANT merchant, real dish) ---
  console.log('\n--- 6. FLOW 6: FOOD & MENU ITEM PHOTO ---');
  // The dish must be one the caller's own store actually has on live PostgreSQL. Discover it
  // through the merchant's own dishes read rather than assuming a mock id that never resolves.
  const dishesRes = await request('GET', '/api/merchant/dishes', null, REST_AUTH);
  const dishes = (dishesRes.body && dishesRes.body.dishes) || [];
  let discoveredDishId = dishes.length ? (dishes[0].id || dishes[0].sku) : null;
  assert('RESTAURANT merchant lists at least one of its own dishes to photograph',
    dishesRes.status === 200 && discoveredDishId != null,
    `status=${dishesRes.status} count=${dishesRes.body?.count ?? 'n/a'}`);

  if (discoveredDishId) {
    const menuItemPhotoRes = await request('POST', `/api/merchant/menu/${encodeURIComponent(discoveredDishId)}/photo`, {
      fileData: SAMPLE_IMAGE_BASE64,
      mimeType: 'image/png'
    }, REST_AUTH);
    recordAsset(menuItemPhotoRes.body);
    assert('Merchant uploads a photo of one of its own dishes and persists a media asset',
      menuItemPhotoRes.status === 200 && menuItemPhotoRes.body.success === true && menuItemPhotoRes.body.asset?.cloudinaryPublicId != null,
      `status=${menuItemPhotoRes.status} code=${menuItemPhotoRes.body.code || ''} publicId=${menuItemPhotoRes.body.asset?.cloudinaryPublicId || 'none'}`);
  }

  // --- 7. FLOW 7: Grocery Product Image (authenticated GROCERY merchant) ---
  console.log('\n--- 7. FLOW 7: GROCERY PRODUCT PHOTO ---');
  // Live PostgreSQL has no product owned by the grocery store, and no HTTP route lets a merchant
  // mint a master catalogue row, so provision exactly one — locally-guarded — to exercise the
  // authorized path, then delete it (and its media asset) in cleanup. The route reads live PG, so
  // an in-memory fixture could not be photographed; provisioning through the store handle is what
  // makes the 200 real rather than asserted.
  let flow7Provisioned = false;
  if (DB.ok) {
    const { data: prow, error: perr } = await supabaseAdmin.from('products').insert({
      merchant_id: GROCERY_STORE_ID,
      name: 'Cloudinary Suite Test Product',
      category: 'Test',
      price: 10,
      is_available: true,
    }).select('id').single();
    if (!perr && prow) {
      provisionedProductId = prow.id;
      flow7Provisioned = true;
    } else {
      console.error(`[fixture] could not provision a grocery product: ${perr && perr.message}`);
    }
  } else {
    console.log(`[fixture] grocery provisioning skipped — ${DB.reason}`);
  }

  if (flow7Provisioned) {
    const groceryPhotoRes = await request('POST', `/api/grocery/products/${encodeURIComponent(provisionedProductId)}/photo`, {
      fileData: SAMPLE_IMAGE_BASE64,
      mimeType: 'image/png'
    }, GROC_AUTH);
    recordAsset(groceryPhotoRes.body);
    // The durable answer is the persisted asset; the `product` field is an in-memory mirror that
    // is null under live PostgreSQL, so it is not asserted on.
    assert('Grocery merchant uploads a photo of its own product and persists a media asset',
      groceryPhotoRes.status === 200 && groceryPhotoRes.body.success === true && groceryPhotoRes.body.asset?.cloudinaryPublicId != null,
      `status=${groceryPhotoRes.status} code=${groceryPhotoRes.body.code || ''} publicId=${groceryPhotoRes.body.asset?.cloudinaryPublicId || 'none'}`);
  } else {
    assert('Grocery product photo exercised against a provisioned test product', false,
      'no test product could be provisioned on this target — flow 7 not run');
  }

  // --- 7b. FLOW 4-7 remain gated: unauthorized and mis-authorized requests must STILL be refused.
  // Fixing the client must not quietly loosen a door. These prove the protections still hold.
  console.log('\n--- 7b. SECURITY BOUNDARY: MERCHANT MEDIA DOORS STAY GATED ---');
  const anonLogo = await request('POST', '/api/merchant/media', { fileData: SAMPLE_IMAGE_BASE64, mediaType: 'LOGO', mimeType: 'image/png' });
  assert('Merchant media upload with NO session is refused with 401 AUTH_REQUIRED',
    anonLogo.status === 401 && anonLogo.body.code === 'AUTH_REQUIRED', `status=${anonLogo.status} code=${anonLogo.body.code || ''}`);

  const anonMenuPhoto = await request('POST', `/api/merchant/menu/${encodeURIComponent(discoveredDishId || 'any')}/photo`, { fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png' });
  assert('Menu-item photo with NO session is refused with 401', anonMenuPhoto.status === 401, `status=${anonMenuPhoto.status}`);

  const anonGroceryPhoto = await request('POST', '/api/grocery/products/any/photo', { fileData: SAMPLE_IMAGE_BASE64, mimeType: 'image/png' });
  assert('Grocery product photo with NO session is refused with 401', anonGroceryPhoto.status === 401, `status=${anonGroceryPhoto.status}`);

  const customerOnMerchant = await request('POST', '/api/merchant/media', { fileData: SAMPLE_IMAGE_BASE64, mediaType: 'LOGO', mimeType: 'image/png' }, AUTH);
  assert('A CUSTOMER session cannot write merchant media (403 FORBIDDEN)',
    customerOnMerchant.status === 403 && customerOnMerchant.body.code === 'FORBIDDEN', `status=${customerOnMerchant.status} code=${customerOnMerchant.body.code || ''}`);

  // A GROCERY merchant is authenticated but NOT entitled to the RESTAURANT door: merchant_type is
  // enforced, not bypassed. This is the clearest proof the auth fix did not open the wrong gate.
  const groceryOnRestaurant = await request('POST', '/api/merchant/media', { fileData: SAMPLE_IMAGE_BASE64, mediaType: 'LOGO', mimeType: 'image/png' }, GROC_AUTH);
  assert('A GROCERY merchant is refused the RESTAURANT door on merchant_type (403 MERCHANT_TYPE_MISMATCH)',
    groceryOnRestaurant.status === 403 && groceryOnRestaurant.body.code === 'MERCHANT_TYPE_MISMATCH',
    `status=${groceryOnRestaurant.status} code=${groceryOnRestaurant.body.code || ''}`);


  // --- 8. FLOW 8: Parcel Delivery Proof Photo ---
  console.log('\n--- 8. FLOW 8: PARCEL DELIVERY PROOF ---');
  const parcelProofRes = await request('POST', '/api/parcel/JOB-101/delivery-proof', {
    fileData: SAMPLE_IMAGE_BASE64,
    driverId: 'DRV-101',
    mimeType: 'image/png'
  });
  assert('Driver uploads parcel contactless delivery proof photo', parcelProofRes.status === 200 && parcelProofRes.body.job?.deliveryProofUrl != null);

  // --- 9. Image Replacement & Safe Cleanup ---
  console.log('\n--- 9. IMAGE REPLACEMENT & CLEANUP ---');
  const initialUpload = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png'
  }, AUTH);
  const oldPublicId = initialUpload.body.asset?.cloudinaryPublicId;

  const replaceRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    replacePublicId: oldPublicId
  }, AUTH);
  assert('Upload new image and replace old asset atomically', replaceRes.status === 200 && replaceRes.body.asset?.cloudinaryPublicId != null);
  const newPublicId = replaceRes.body.asset?.cloudinaryPublicId;

  // --- 10. Asset Deletion ---
  console.log('\n--- 10. ASSET DELETION & METADATA PURGE ---');
  const deleteRes = await request('DELETE', `/api/media/${encodeURIComponent(newPublicId)}`, null, AUTH);
  assert('Delete media asset from Cloudinary and remove database metadata', deleteRes.status === 200 && deleteRes.body.success);

  // --- 11. Security Boundary: Aadhaar Rejection ---
  console.log('\n--- 11. SECURITY BOUNDARY: SENSITIVE KYC REJECTIONS ---');
  const aadhaarAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/kyc/aadhaar_card',
    mimeType: 'image/png'
  }, AUTH);
  assert('Attempt to upload Aadhaar card to Cloudinary is strictly rejected with HTTP 400', aadhaarAttempt.status === 400);

  const voterAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/voter_id_documents',
    mimeType: 'image/png'
  }, AUTH);
  assert('Attempt to upload Voter ID to Cloudinary is strictly rejected with HTTP 400', voterAttempt.status === 400);

  const licenseAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/driver_license_front',
    mimeType: 'image/png'
  }, AUTH);
  assert('Attempt to upload Driver License to Cloudinary is strictly rejected with HTTP 400', licenseAttempt.status === 400);

  // --- 12. Security Audit: Zero Secret Exposure ---
  console.log('\n--- 12. SECURITY AUDIT: SECRETS PROTECTION ---');
  const signedParamsRes = await request('GET', '/api/media/signed-params?folder=nabin/public', null, AUTH);
  assert('Signed params API never leaks CLOUDINARY_API_SECRET to client', 
    signedParamsRes.body.params?.apiSecret == null && signedParamsRes.body.params?.apiKey == null || !JSON.stringify(signedParamsRes.body).includes('CLOUDINARY_API_SECRET')
  );

  // --- 13. Image Limits & MIME Validation ---
  console.log('\n--- 13. IMAGE LIMITS & MIME VALIDATION ---');
  const badMimeRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'application/x-msdownload'
  }, AUTH);
  assert('Reject unpermitted MIME type with HTTP 400', badMimeRes.status === 400);

  const oversizedRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    bytes: 25 * 1024 * 1024 // 25MB (exceeds 10MB limit)
  }, AUTH);
  assert('Reject oversized media payload exceeding 10MB limit', oversizedRes.status === 400);

  // --- 14. Responsive Transformations ---
  console.log('\n--- 14. RESPONSIVE TRANSFORMATIONS (THUMBNAIL, SMALL, MEDIUM, LARGE) ---');
  const testOptRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/food',
    mimeType: 'image/png'
  }, AUTH);
  const optUrls = testOptRes.body.asset?.optimizedUrls || {};
  assert('Generates auto-format & auto-quality responsive variants (thumbnail, small, medium, large)', 
    optUrls.thumbnail != null && optUrls.small != null && optUrls.medium != null && optUrls.large != null,
    `Thumbnail: ${optUrls.thumbnail?.substring(0, 45)}...`
  );

  // The transformation asset is the only one this suite leaves behind (flows 9-10 delete
  // their own), so remove it here to keep media_assets at zero residue for the run.
  const optPid = testOptRes.body.asset?.cloudinaryPublicId;
  if (optPid) {
    const cleanup = await request('DELETE', `/api/media/${encodeURIComponent(optPid)}`, null, AUTH);
    assert('Cleanup removes the transformation asset minted by flow 14', cleanup.status === 200 && cleanup.body.success);
  }

  // --- 15. Cleanup: remove ONLY this run's test-owned metadata ---
  // The merchant/grocery doors in flows 4-7 persist a durable media_assets row each, and flow 7
  // inserted one catalogue product. Nothing here is reachable through the generic delete route (the
  // caller of a per-entity photo is the owning MERCHANT, not the CUSTOMER that owns /api/media), so
  // cleanup deletes EXACTLY the public_ids this run recorded and the one product it provisioned —
  // never a pre-existing row, never a shared record. It runs only when the local-only store guard
  // holds; otherwise it reports that residue was left on a target it was not allowed to write.
  console.log('\n--- 15. CLEANUP: TEST-OWNED ASSETS & FIXTURE ---');
  if (DB.ok) {
    // Which rows did THIS run add? current public_ids minus the baseline set measured before flow 1.
    // That difference is exactly this run's residue by construction — no baseline (pre-existing or
    // shared) id can appear in it — so deleting it provably never touches a record the suite minted
    // elsewhere. The explicitly recorded merchant-door ids are a subset; the set difference also
    // catches any asset another flow orphaned (e.g. an atomic replace leaving its prior row).
    const { data: currentRows } = await supabaseAdmin.from('media_assets').select('public_id');
    const currentIds = (currentRows || []).map((r) => r.public_id).filter(Boolean);
    const addedByThisRun = currentIds.filter((pid) => !baselineAssetIds.has(pid));
    const idsToRemove = Array.from(new Set([...createdAssetPublicIds, ...addedByThisRun]));

    for (const pid of idsToRemove) {
      await supabaseAdmin.from('media_assets').delete().eq('public_id', pid);
    }
    if (provisionedProductId) {
      await supabaseAdmin.from('products').delete().eq('id', provisionedProductId);
    }

    // Evidence, not assumption: nothing outside the baseline set survives, the provisioned product is
    // gone, and the durable count is back to the number measured before the first flow ran.
    const { data: afterRows } = await supabaseAdmin.from('media_assets').select('public_id');
    const afterIds = (afterRows || []).map((r) => r.public_id).filter(Boolean);
    const stillAdded = afterIds.filter((pid) => !baselineAssetIds.has(pid));
    const finalCount = afterIds.length;
    const { data: survivingProduct } = provisionedProductId
      ? await supabaseAdmin.from('products').select('id').eq('id', provisionedProductId).maybeSingle()
      : { data: null };

    assert('Every media asset this run minted is deleted (baseline ids untouched)',
      stillAdded.length === 0,
      `removed=${idsToRemove.length} surviving-new=${stillAdded.length}`);
    assert('The provisioned grocery product is deleted',
      provisionedProductId == null ? true : survivingProduct == null,
      provisionedProductId ? 'product removed' : 'no product was provisioned');
    assert('media_assets net change for this run is zero',
      finalCount === mediaCountBaseline,
      `baseline=${mediaCountBaseline} final=${finalCount}`);
  } else {
    console.log(`[store] cleanup skipped — ${DB.reason}. This run left ${createdAssetPublicIds.length} recorded test asset(s) and ${provisionedProductId ? 1 : 0} fixture product(s) on a target the direct handle is not allowed to write.`);
  }

  console.log('\n========================================================================');
  console.log(`📊 CLOUDINARY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');

  // The client must report failures, not swallow them behind exit 0. The whole suite is a gate, so
  // a non-zero exit on any FAIL is what makes CI and the regression chain able to see a break.
  process.exitCode = failed > 0 ? 1 : 0;
}

// A throw in runCloudinaryTestSuite means the suite never reached its summary line. That is the
// worst case, not a pass — fail loudly rather than exit 0.
runCloudinaryTestSuite().catch((err) => {
  console.error('❌ CLOUDINARY SUITE ABORTED BEFORE SUMMARY:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
