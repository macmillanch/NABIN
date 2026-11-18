/**
 * MerchantDocumentStorageService
 *
 * Secure private Supabase Storage adapter for NABIN merchant compliance documents
 * (FSSAI Food Safety Licences, PAN/VAT Certificates, Restaurant Trade Licences).
 *
 * Security & Governance:
 *  - Enforces server-side canonical private path generation:
 *    merchants/{merchantId}/documents/{docType}_{timestamp}_{nonce}.{ext}
 *  - Private bucket: 'merchant-documents' (NO public CDN distribution).
 *  - Max file size: 10 MB (10,485,760 bytes) strictly enforced.
 *  - Allowed MIME types: application/pdf, image/jpeg, image/png.
 *  - Binary magic number sniffing: verifies %PDF, JPEG, or PNG headers.
 *  - Generates short-lived signed URLs (default: 900 seconds / 15 minutes).
 *  - Zero client-supplied storage paths trusted.
 *  - In-memory mock storage fallback when offline or in test environments.
 */

const crypto = require('crypto');
const { supabaseAdmin, isConfigured } = require('../supabase');
const { isProduction } = require('./RuntimeMode');

class MerchantDocumentStorageService {
  constructor(options = {}) {
    this.bucket = options.bucket || process.env.SUPABASE_DOCUMENTS_STORAGE_BUCKET || 'merchant-documents';
    this.client = options.client !== undefined ? options.client : supabaseAdmin;
    this.isConfigured = options.isConfigured !== undefined ? options.isConfigured : Boolean(this.client && this.client.storage && isConfigured);

    this.maxDocumentSizeBytes = 10 * 1024 * 1024; // 10 MB limit matching RM-006 Stitch spec

    this.allowedMimeTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png'
    ];

    this.allowedExtensions = ['pdf', 'jpg', 'jpeg', 'png'];

    // In-memory mock store for offline/testing
    this._mockPrivateStorage = new Map();
  }

  /**
   * Sniff binary buffer magic numbers to determine true MIME type
   * @param {Buffer} buffer
   * @returns {string|null} detected MIME type or null
   */
  detectBufferMime(buffer) {
    if (!buffer || buffer.length < 4) return null;

    // PDF: %PDF (25 50 44 46)
    if (
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46
    ) {
      return 'application/pdf';
    }

    // JPEG: FF D8 FF
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }

    return null;
  }

  /**
   * Parse input data (Buffer, base64 data URI, or raw base64 string) into Buffer
   */
  parseInputBuffer(fileData) {
    if (!fileData) {
      throw new Error('File data or document buffer is required.');
    }

    if (Buffer.isBuffer(fileData)) {
      return { buffer: fileData, claimedMime: null };
    }

    if (typeof fileData === 'string') {
      const dataUriMatch = fileData.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
      if (dataUriMatch) {
        const claimedMime = dataUriMatch[1];
        const buffer = Buffer.from(dataUriMatch[2], 'base64');
        return { buffer, claimedMime };
      }

      // Plain base64 string
      const buffer = Buffer.from(fileData, 'base64');
      return { buffer, claimedMime: null };
    }

    throw new Error('Unsupported document payload format. Expected Buffer or base64 string.');
  }

  /**
   * Validate buffer size, MIME type, and binary magic numbers
   */
  validateBuffer(buffer, declaredMime = null, filename = '') {
    if (!buffer || buffer.length === 0) {
      const err = new Error('Empty document buffer provided.');
      err.code = 'INVALID_FILE_EMPTY';
      err.status = 400;
      throw err;
    }

    if (buffer.length > this.maxDocumentSizeBytes) {
      const err = new Error(
        `Document size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of 10 MB.`
      );
      err.code = 'FILE_TOO_LARGE';
      err.status = 413;
      throw err;
    }

    const detectedMime = this.detectBufferMime(buffer);
    if (!detectedMime) {
      const err = new Error('Unsupported file signature. Uploaded document must be a valid PDF, JPEG, or PNG.');
      err.code = 'INVALID_FILE_SIGNATURE';
      err.status = 400;
      throw err;
    }

    if (declaredMime && declaredMime.toLowerCase() !== detectedMime.toLowerCase()) {
      // Allow image/jpg vs image/jpeg alias
      const isJpgAlias =
        (declaredMime.toLowerCase() === 'image/jpg' && detectedMime === 'image/jpeg') ||
        (declaredMime.toLowerCase() === 'image/jpeg' && detectedMime === 'image/jpeg');
      if (!isJpgAlias) {
        const err = new Error(
          `MIME type mismatch: declared '${declaredMime}' does not match detected binary signature '${detectedMime}'.`
        );
        err.code = 'MIME_TYPE_MISMATCH';
        err.status = 400;
        throw err;
      }
    }

    // Check extension if filename is provided
    if (filename) {
      const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : '';
      if (!this.allowedExtensions.includes(ext)) {
        const err = new Error(
          `Invalid file extension '.${ext}'. Allowed extensions are: ${this.allowedExtensions.join(', ')}.`
        );
        err.code = 'INVALID_FILE_EXTENSION';
        err.status = 400;
        throw err;
      }
    }

    return detectedMime;
  }

  /**
   * Build server-authoritative tenant-isolated storage path
   */
  generatePath({ merchantId, documentType, ext }) {
    if (!merchantId) {
      throw new Error('Merchant ID is required to generate document storage path.');
    }
    const cleanMerchantId = String(merchantId).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanDocType = String(documentType || 'doc').toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const timestamp = Date.now();
    const nonce = crypto.randomBytes(4).toString('hex');
    const safeExt = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');

    return `merchants/${cleanMerchantId}/documents/${cleanDocType}_${timestamp}_${nonce}.${safeExt}`;
  }

  /**
   * Upload compliance document to private storage
   */
  async uploadDocument({ merchantId, documentType, fileData, filename, mimeType }) {
    const { buffer, claimedMime } = this.parseInputBuffer(fileData);
    const effectiveClaimedMime = mimeType || claimedMime;
    const verifiedMime = this.validateBuffer(buffer, effectiveClaimedMime, filename);

    // Derive file extension
    let ext = 'bin';
    if (verifiedMime === 'application/pdf') ext = 'pdf';
    else if (verifiedMime === 'image/jpeg') ext = 'jpg';
    else if (verifiedMime === 'image/png') ext = 'png';

    const storagePath = this.generatePath({ merchantId, documentType, ext });
    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

    if (this.isConfigured && this.client && this.client.storage) {
      try {
        const { error } = await this.client.storage
          .from(this.bucket)
          .upload(storagePath, buffer, {
            contentType: verifiedMime,
            upsert: false
          });

        if (error) {
          throw new Error(`Supabase Storage upload failed: ${error.message}`);
        }
      } catch (err) {
        if (isProduction()) {
          throw err;
        }
        // In local/dev fallback, save to memory mock
        this._mockPrivateStorage.set(storagePath, {
          buffer,
          mimeType: verifiedMime,
          merchantId: String(merchantId)
        });
      }
    } else {
      // Local development / mock mode
      this._mockPrivateStorage.set(storagePath, {
        buffer,
        mimeType: verifiedMime,
        merchantId: String(merchantId)
      });
    }

    return {
      storageBucket: this.bucket,
      storagePath,
      mimeType: verifiedMime,
      fileSizeBytes: buffer.length,
      fileHashSha256: fileHash
    };
  }

  /**
   * Generate short-lived signed URL for authorized retrieval
   */
  async getSignedUrl(storagePath, expiresInSeconds = 900) {
    if (!storagePath) return null;

    if (this.isConfigured && this.client && this.client.storage) {
      try {
        const { data, error } = await this.client.storage
          .from(this.bucket)
          .createSignedUrl(storagePath, expiresInSeconds);

        if (!error && data && data.signedUrl) {
          return data.signedUrl;
        }
      } catch (_) {
        // Fallback to backend streaming URL
      }
    }

    // Local / backend-mediated signed download path
    return `/api/merchant/documents/stream?path=${encodeURIComponent(storagePath)}`;
  }

  /**
   * Retrieve binary buffer from storage
   */
  async downloadDocument(storagePath) {
    if (this.isConfigured && this.client && this.client.storage) {
      try {
        const { data, error } = await this.client.storage
          .from(this.bucket)
          .download(storagePath);

        if (!error && data) {
          const arrayBuffer = await data.arrayBuffer();
          return Buffer.from(arrayBuffer);
        }
      } catch (_) {
        // Fallback to mock
      }
    }

    const mockItem = this._mockPrivateStorage.get(storagePath);
    if (mockItem) {
      return mockItem.buffer;
    }

    return null;
  }

  /**
   * Delete document from private storage
   */
  async deleteDocument(storagePath, merchantId) {
    if (!storagePath) return false;

    // Tenant safety check
    const expectedPrefix = `merchants/${String(merchantId).replace(/[^a-zA-Z0-9_-]/g, '')}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      const err = new Error('Forbidden: Cannot delete storage assets of another merchant.');
      err.code = 'STORAGE_TENANT_MISMATCH';
      err.status = 403;
      throw err;
    }

    this._mockPrivateStorage.delete(storagePath);

    if (this.isConfigured && this.client && this.client.storage) {
      try {
        await this.client.storage
          .from(this.bucket)
          .remove([storagePath]);
      } catch (_) {
        // Ignored in teardown
      }
    }

    return true;
  }
}

const merchantDocumentStorageService = new MerchantDocumentStorageService();

module.exports = {
  MerchantDocumentStorageService,
  merchantDocumentStorageService
};
