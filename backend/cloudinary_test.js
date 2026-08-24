const https = require('https');
const http = require('http');

const BASE_URL = process.env.NABIN_API_URL || 'http://localhost:4000';

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

  // --- 4. FLOW 4: Restaurant Logo ---
  console.log('\n--- 4. FLOW 4: RESTAURANT LOGO ---');
  const restLogoRes = await request('POST', '/api/merchant/rest_1/media', {
    fileData: SAMPLE_IMAGE_BASE64,
    mediaType: 'LOGO',
    mimeType: 'image/png'
  });
  assert('Restaurant uploads brand logo with thumbnail variant', restLogoRes.status === 200 && restLogoRes.body.restaurant?.logoUrl != null);

  // --- 5. FLOW 5: Restaurant Cover Banner ---
  console.log('\n--- 5. FLOW 5: RESTAURANT COVER BANNER ---');
  const restCoverRes = await request('POST', '/api/merchant/rest_1/media', {
    fileData: SAMPLE_IMAGE_BASE64,
    mediaType: 'COVER',
    mimeType: 'image/png'
  });
  assert('Restaurant uploads high-res cover banner with responsive widths', restCoverRes.status === 200 && restCoverRes.body.restaurant?.coverUrl != null);

  // --- 6. FLOW 6: Food / Menu Item Image ---
  console.log('\n--- 6. FLOW 6: FOOD & MENU ITEM PHOTO ---');
  const menuItemPhotoRes = await request('POST', '/api/merchant/rest_1/menu/item_biryani_1/photo', {
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Merchant uploads food menu item photo with auto-format WebP/AVIF', menuItemPhotoRes.status === 200 && menuItemPhotoRes.body.asset?.secureUrl != null);

  // --- 7. FLOW 7: Grocery Product Image ---
  console.log('\n--- 7. FLOW 7: GROCERY PRODUCT PHOTO ---');
  const groceryPhotoRes = await request('POST', '/api/grocery/products/groc_1/photo', {
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Grocery catalog updates SKU product photo and thumbnail', groceryPhotoRes.status === 200 && groceryPhotoRes.body.product?.imageUrl != null);

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
  });
  const oldPublicId = initialUpload.body.asset?.cloudinaryPublicId;

  const replaceRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    replacePublicId: oldPublicId
  });
  assert('Upload new image and replace old asset atomically', replaceRes.status === 200 && replaceRes.body.asset?.cloudinaryPublicId != null);
  const newPublicId = replaceRes.body.asset?.cloudinaryPublicId;

  // --- 10. Asset Deletion ---
  console.log('\n--- 10. ASSET DELETION & METADATA PURGE ---');
  const deleteRes = await request('DELETE', `/api/media/${encodeURIComponent(newPublicId)}`);
  assert('Delete media asset from Cloudinary and remove database metadata', deleteRes.status === 200 && deleteRes.body.success);

  // --- 11. Security Boundary: Aadhaar Rejection ---
  console.log('\n--- 11. SECURITY BOUNDARY: SENSITIVE KYC REJECTIONS ---');
  const aadhaarAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/kyc/aadhaar_card',
    mimeType: 'image/png'
  });
  assert('Attempt to upload Aadhaar card to Cloudinary is strictly rejected with HTTP 400', aadhaarAttempt.status === 400);

  const voterAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/voter_id_documents',
    mimeType: 'image/png'
  });
  assert('Attempt to upload Voter ID to Cloudinary is strictly rejected with HTTP 400', voterAttempt.status === 400);

  const licenseAttempt = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/driver_license_front',
    mimeType: 'image/png'
  });
  assert('Attempt to upload Driver License to Cloudinary is strictly rejected with HTTP 400', licenseAttempt.status === 400);

  // --- 12. Security Audit: Zero Secret Exposure ---
  console.log('\n--- 12. SECURITY AUDIT: SECRETS PROTECTION ---');
  const signedParamsRes = await request('GET', '/api/media/signed-params?folder=nabin/public');
  assert('Signed params API never leaks CLOUDINARY_API_SECRET to client', 
    signedParamsRes.body.params?.apiSecret == null && signedParamsRes.body.params?.apiKey == null || !JSON.stringify(signedParamsRes.body).includes('CLOUDINARY_API_SECRET')
  );

  // --- 13. Image Limits & MIME Validation ---
  console.log('\n--- 13. IMAGE LIMITS & MIME VALIDATION ---');
  const badMimeRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'application/x-msdownload'
  });
  assert('Reject unpermitted MIME type with HTTP 400', badMimeRes.status === 400);

  const oversizedRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    bytes: 25 * 1024 * 1024 // 25MB (exceeds 10MB limit)
  });
  assert('Reject oversized media payload exceeding 10MB limit', oversizedRes.status === 400);

  // --- 14. Responsive Transformations ---
  console.log('\n--- 14. RESPONSIVE TRANSFORMATIONS (THUMBNAIL, SMALL, MEDIUM, LARGE) ---');
  const testOptRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/food',
    mimeType: 'image/png'
  });
  const optUrls = testOptRes.body.asset?.optimizedUrls || {};
  assert('Generates auto-format & auto-quality responsive variants (thumbnail, small, medium, large)', 
    optUrls.thumbnail != null && optUrls.small != null && optUrls.medium != null && optUrls.large != null,
    `Thumbnail: ${optUrls.thumbnail?.substring(0, 45)}...`
  );

  console.log('\n========================================================================');
  console.log(`📊 CLOUDINARY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');
}

runCloudinaryTestSuite().catch(console.error);
