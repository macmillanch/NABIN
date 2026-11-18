const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

async function runTests() {
  console.log('=== NABIN PHASE 4.1C — MERCHANT COMPLIANCE DOCUMENTS TEST SUITE ===');

  const { merchantDocumentStorageService } = require('./src/services/merchantDocumentStorageService');
  const db = require('./src/database');
  const { app, server } = require('./src/server');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}: ${e.message}`);
      failed++;
    }
  }

  // 1. Magic byte detection
  test('detectBufferMime accurately detects PDF', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 sample document', 'utf8');
    const mime = merchantDocumentStorageService.detectBufferMime(pdfBuffer);
    assert.strictEqual(mime, 'application/pdf');
  });

  test('detectBufferMime accurately detects JPEG', () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    const mime = merchantDocumentStorageService.detectBufferMime(jpegBuffer);
    assert.strictEqual(mime, 'image/jpeg');
  });

  test('detectBufferMime accurately detects PNG', () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const mime = merchantDocumentStorageService.detectBufferMime(pngBuffer);
    assert.strictEqual(mime, 'image/png');
  });

  test('detectBufferMime rejects arbitrary text or executable bytes', () => {
    const textBuffer = Buffer.from('MZ executable or plain text', 'utf8');
    const mime = merchantDocumentStorageService.detectBufferMime(textBuffer);
    assert.strictEqual(mime, null);
  });

  // 2. Validation & Size Limits
  test('validateBuffer throws on oversized payload (> 10MB)', () => {
    const largeBuffer = Buffer.alloc(11 * 1024 * 1024);
    largeBuffer[0] = 0x25; largeBuffer[1] = 0x50; largeBuffer[2] = 0x44; largeBuffer[3] = 0x46;
    assert.throws(() => {
      merchantDocumentStorageService.validateBuffer(largeBuffer, 'application/pdf', 'doc.pdf');
    }, /exceeds maximum allowed limit/);
  });

  test('validateBuffer throws on invalid file extension', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 sample', 'utf8');
    assert.throws(() => {
      merchantDocumentStorageService.validateBuffer(pdfBuffer, 'application/pdf', 'doc.exe');
    }, /Invalid file extension/);
  });

  test('validateBuffer throws on MIME type mismatch', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 sample', 'utf8');
    assert.throws(() => {
      merchantDocumentStorageService.validateBuffer(pdfBuffer, 'image/png', 'doc.png');
    }, /MIME type mismatch/);
  });

  // 3. Storage Upload & Retrieval Lifecycle
  await testAsync('uploadDocument uploads valid PDF and generates private path', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4 sample license document content for testing', 'utf8');
    const res = await merchantDocumentStorageService.uploadDocument({
      merchantId: 'rest_demo_1',
      documentType: 'FSSAI_LICENSE',
      fileData: pdfBuffer,
      filename: 'fssai_cert.pdf',
      mimeType: 'application/pdf'
    });

    assert.ok(res.storagePath.startsWith('merchants/rest_demo_1/documents/fssai_license_'));
    assert.strictEqual(res.mimeType, 'application/pdf');
    assert.ok(res.fileHashSha256);

    const retrieved = await merchantDocumentStorageService.downloadDocument(res.storagePath);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.toString('utf8'), pdfBuffer.toString('utf8'));
  });

  await testAsync('deleteDocument refuses cross-tenant deletion attempt', async () => {
    await assert.rejects(async () => {
      await merchantDocumentStorageService.deleteDocument(
        'merchants/rest_victim/documents/fssai_license_123_abc.pdf',
        'rest_attacker'
      );
    }, /Cannot delete storage assets of another merchant/);
  });

  // 4. Repository CRUD & Tenant Isolation
  await testAsync('MerchantDocumentRepository saves and queries documents tenant-isolated', async () => {
    const doc = await db.merchantDocumentRepo.save({
      merchantId: 'rest_tenant_A',
      documentType: 'TRADE_LICENSE',
      documentNumber: 'TRD-KTM-2024-883',
      storageBucket: 'merchant-documents',
      storagePath: 'merchants/rest_tenant_A/documents/trade_license_1.pdf',
      originalFilename: 'trade_license.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048,
      status: 'PENDING_REVIEW'
    });

    assert.ok(doc.id);
    assert.strictEqual(doc.documentNumber, 'TRD-KTM-2024-883');

    const docsA = await db.merchantDocumentRepo.findByMerchantId('rest_tenant_A');
    assert.ok(docsA.some(d => d.id === doc.id));

    const docsB = await db.merchantDocumentRepo.findByMerchantId('rest_tenant_B');
    assert.ok(!docsB.some(d => d.id === doc.id));

    const crossRead = await db.merchantDocumentRepo.findById(doc.id, 'rest_tenant_B');
    assert.strictEqual(crossRead, null);

    const ownRead = await db.merchantDocumentRepo.findById(doc.id, 'rest_tenant_A');
    assert.strictEqual(ownRead.id, doc.id);

    const deleted = await db.merchantDocumentRepo.delete(doc.id, 'rest_tenant_A');
    assert.strictEqual(deleted.id, doc.id);

    const afterDelete = await db.merchantDocumentRepo.findById(doc.id, 'rest_tenant_A');
    assert.strictEqual(afterDelete, null);
  });

  // 5. HTTP Integration & Tenant Security Tests
  const testServer = http.createServer(app);
  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const port = testServer.address().port;

  function makeRequest({ path, method = 'GET', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      }, (res) => {
        let resBody = '';
        res.on('data', chunk => { resBody += chunk; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(resBody); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, body: json, rawBody: resBody });
        });
      });
      req.on('error', reject);
      if (body) {
        req.write(typeof body === 'string' ? body : JSON.stringify(body));
      }
      req.end();
    });
  }

  // Seed test merchant session
  const tokenA = 'test_token_merchant_a_' + Date.now();
  const tokenB = 'test_token_merchant_b_' + Date.now();

  const testMerchantA = { id: 'rest_http_a', uuid: 'rest_http_a', name: 'Restaurant A', merchant_type: 'RESTAURANT', approval_status: 'PENDING' };
  const testMerchantB = { id: 'rest_http_b', uuid: 'rest_http_b', name: 'Restaurant B', merchant_type: 'RESTAURANT', approval_status: 'PENDING' };
  db.restaurants.push(testMerchantA, testMerchantB);

  const sessionA = {
    token: tokenA,
    role: 'MERCHANT',
    entityId: 'rest_http_a',
    userId: 'usr_m_a',
    phone: '+919999900001'
  };
  const sessionB = {
    token: tokenB,
    role: 'MERCHANT',
    entityId: 'rest_http_b',
    userId: 'usr_m_b',
    phone: '+919999900002'
  };

  db.activeSessions.set(tokenA, sessionA);
  db.activeSessions.set(db.hashSessionToken(tokenA), sessionA);
  db.activeSessions.set(tokenB, sessionB);
  db.activeSessions.set(db.hashSessionToken(tokenB), sessionB);

  await testAsync('POST /api/merchant/documents refuses unauthenticated request (401)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/documents',
      method: 'POST',
      body: { documentType: 'FSSAI_LICENSE' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  });

  let createdDocId = null;

  await testAsync('POST /api/merchant/documents uploads PDF for pending merchant (201)', async () => {
    const validPdfBase64 = Buffer.from('%PDF-1.4 official license content', 'utf8').toString('base64');
    const res = await makeRequest({
      path: '/api/merchant/documents',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        documentType: 'FSSAI_LICENSE',
        documentNumber: '10021022000492',
        expiryDate: '12 / 2026',
        filename: 'fssai_cert_2024.pdf',
        fileData: `data:application/pdf;base64,${validPdfBase64}`
      }
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.document.documentType, 'FSSAI_LICENSE');
    assert.strictEqual(res.body.document.documentNumber, '10021022000492');
    assert.ok(res.body.document.viewUrl);
    createdDocId = res.body.document.id;
  });

  await testAsync('POST /api/merchant/documents refuses invalid document type (400)', async () => {
    const validPdfBase64 = Buffer.from('%PDF-1.4 sample', 'utf8').toString('base64');
    const res = await makeRequest({
      path: '/api/merchant/documents',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        documentType: 'INVALID_PASSPORT',
        fileData: validPdfBase64
      }
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'INVALID_DOCUMENT_TYPE');
  });

  await testAsync('POST /api/merchant/:restaurantId/documents enforces tenant isolation (403)', async () => {
    const validPdfBase64 = Buffer.from('%PDF-1.4 sample', 'utf8').toString('base64');
    // Merchant A trying to upload to Merchant B's restaurantId
    const res = await makeRequest({
      path: '/api/merchant/rest_http_b/documents',
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenA}` },
      body: {
        documentType: 'PAN_VAT_CERTIFICATE',
        fileData: validPdfBase64
      }
    });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'MERCHANT_MISMATCH');
  });

  await testAsync('GET /api/merchant/documents returns uploaded documents with signed URLs', async () => {
    const res = await makeRequest({
      path: '/api/merchant/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.documents.length >= 1);
    assert.strictEqual(res.body.documents[0].documentType, 'FSSAI_LICENSE');
    assert.ok(res.body.documents[0].viewUrl);
  });

  await testAsync('GET /api/merchant/documents for Merchant B returns empty list (tenant isolation)', async () => {
    const res = await makeRequest({
      path: '/api/merchant/documents',
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenB}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.documents.length, 0);
  });

  await testAsync('GET /api/merchant/documents/:documentId returns document and streams binary', async () => {
    assert.ok(createdDocId);
    const res = await makeRequest({
      path: `/api/merchant/documents/${createdDocId}?stream=true`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], 'application/pdf');
    assert.ok(res.rawBody.includes('%PDF-1.4 official license content'));
  });

  await testAsync('DELETE /api/merchant/documents/:documentId withdraws document (200)', async () => {
    assert.ok(createdDocId);
    const res = await makeRequest({
      path: `/api/merchant/documents/${createdDocId}`,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);

    // Confirm it is gone
    const getRes = await makeRequest({
      path: `/api/merchant/documents/${createdDocId}`,
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenA}` }
    });
    assert.strictEqual(getRes.status, 404);
  });

  console.log(`\n=== FINAL RESULTS: ${passed} passed, ${failed} failed ===`);
  testServer.close(() => {
    process.exit(failed > 0 ? 1 : 0);
  });
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
