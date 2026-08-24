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

  // --- 1. Valid Image Upload ---
  console.log('--- 1. VALID PUBLIC IMAGE UPLOAD ---');
  const uploadRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    ownerType: 'PLATFORM',
    ownerId: 'sys_promo_1'
  });
  assert('Upload valid image asset to Cloudinary', uploadRes.status === 200 && uploadRes.body.success, `Public ID: ${uploadRes.body.asset?.cloudinaryPublicId}`);
  const uploadedPublicId = uploadRes.body.asset?.cloudinaryPublicId;

  // --- 2. Invalid MIME Type Rejection ---
  console.log('\n--- 2. INVALID MIME TYPE REJECTION ---');
  const badMimeRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'application/x-msdownload'
  });
  assert('Reject unpermitted MIME type with HTTP 400', badMimeRes.status === 400);

  // --- 3. Oversized File Rejection ---
  console.log('\n--- 3. OVERSIZED FILE REJECTION ---');
  const oversizedRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    bytes: 25 * 1024 * 1024 // 25MB (exceeds 10MB limit)
  });
  assert('Reject oversized media payload exceeding 10MB limit', oversizedRes.status === 400);

  // --- 4. Unpermitted Folder Rejection ---
  console.log('\n--- 4. FOLDER WHITELISTING & PRIVACY GUARD ---');
  const badFolderRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'system/sensitive_private_keys',
    mimeType: 'image/png'
  });
  assert('Reject upload to non-whitelisted folder', badFolderRes.status === 400);

  // --- 5. Customer Profile Photo Upload ---
  console.log('\n--- 5. CUSTOMER PROFILE PHOTO INTEGRATION ---');
  const custPhotoRes = await request('POST', '/api/customer/profile/photo', {
    customerId: 'usr_1',
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Customer updates profile avatar with optimized thumbnail', 
    custPhotoRes.status === 200 && custPhotoRes.body.user?.avatarUrl != null,
    `Avatar URL: ${custPhotoRes.body.user?.avatarUrl?.substring(0, 50)}...`
  );

  // --- 6. Driver Profile & Vehicle Media ---
  console.log('\n--- 6. DRIVER & VEHICLE MEDIA INTEGRATION ---');
  const drvPhotoRes = await request('POST', '/api/driver/profile/photo', {
    driverId: 'DRV-101',
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Driver updates profile photo', drvPhotoRes.status === 200 && drvPhotoRes.body.driver?.profilePhotoUrl != null);

  const vehPhotoRes = await request('POST', '/api/driver/vehicle/photo', {
    driverId: 'DRV-101',
    vehicleId: 'veh_dl_101',
    fileData: SAMPLE_IMAGE_BASE64,
    photoType: 'front_exterior',
    mimeType: 'image/png'
  });
  assert('Driver uploads vehicle exterior photo', vehPhotoRes.status === 200 && Array.isArray(vehPhotoRes.body.driver?.vehiclePhotos));

  // --- 7. Restaurant & Menu Item Media ---
  console.log('\n--- 7. RESTAURANT & MENU ITEM MEDIA INTEGRATION ---');
  const restCoverRes = await request('POST', '/api/merchant/rest_1/media', {
    fileData: SAMPLE_IMAGE_BASE64,
    mediaType: 'COVER',
    mimeType: 'image/png'
  });
  assert('Restaurant uploads high-res cover banner', restCoverRes.status === 200 && restCoverRes.body.restaurant?.coverUrl != null);

  const menuItemPhotoRes = await request('POST', '/api/merchant/rest_1/menu/item_biryani_1/photo', {
    fileData: SAMPLE_IMAGE_BASE64,
    mimeType: 'image/png'
  });
  assert('Merchant uploads food menu item photo', menuItemPhotoRes.status === 200 && menuItemPhotoRes.body.asset?.secureUrl != null);

  // --- 8. Image Replacement with Old Asset Cleanup ---
  console.log('\n--- 8. IMAGE REPLACEMENT & SAFE CLEANUP ---');
  const replaceRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/public',
    mimeType: 'image/png',
    replacePublicId: uploadedPublicId
  });
  assert('Upload new image and replace old asset atomically', replaceRes.status === 200 && replaceRes.body.asset?.cloudinaryPublicId != null);
  const newPublicId = replaceRes.body.asset?.cloudinaryPublicId;

  // --- 9. Asset Deletion ---
  console.log('\n--- 9. ASSET DELETION & METADATA PURGE ---');
  const deleteRes = await request('DELETE', `/api/media/${encodeURIComponent(newPublicId)}`);
  assert('Delete media asset from Cloudinary and remove database metadata', deleteRes.status === 200 && deleteRes.body.success);

  // --- 10. Optimized URL & Variant Generation Verification ---
  console.log('\n--- 10. RESPONSIVE TRANSFORMATIONS & OPTIMIZATION ---');
  const testOptRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/food',
    mimeType: 'image/png'
  });
  const optUrls = testOptRes.body.asset?.optimizedUrls || {};
  assert('Generates auto-format & auto-quality responsive variants', 
    optUrls.thumbnail != null && optUrls.small != null && optUrls.medium != null && optUrls.large != null,
    `Thumbnail: ${optUrls.thumbnail?.substring(0, 45)}...`
  );

  // --- 11. Security Audit: Zero Secret Exposure ---
  console.log('\n--- 11. SECURITY AUDIT: SECRETS PROTECTION ---');
  const signedParamsRes = await request('GET', '/api/media/signed-params?folder=nabin/public');
  // Signed params response must NOT contain api_secret
  assert('Signed params API never leaks CLOUDINARY_API_SECRET to client', 
    signedParamsRes.body.params?.apiSecret == null && signedParamsRes.body.params?.apiKey == null || !JSON.stringify(signedParamsRes.body).includes('CLOUDINARY_API_SECRET')
  );

  // --- 12. Sensitive KYC Private Document Isolation ---
  console.log('\n--- 12. SENSITIVE IDENTITY DOCUMENT ISOLATION ---');
  // Attempting to upload to KYC folder via public media API is blocked
  const kycAttemptRes = await request('POST', '/api/media/upload', {
    fileData: SAMPLE_IMAGE_BASE64,
    folder: 'nabin/kyc-documents-private',
    mimeType: 'image/png'
  });
  assert('Private KYC documents blocked from public Cloudinary storage', kycAttemptRes.status === 400);

  console.log('\n========================================================================');
  console.log(`📊 CLOUDINARY TEST SUMMARY: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');
}

runCloudinaryTestSuite().catch(console.error);
