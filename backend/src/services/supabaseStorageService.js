/**
 * SupabaseStorageService
 *
 * Secure Supabase Storage adapter for NABIN catalog assets (restaurant dish
 * photos, grocery product images, and merchant covers/logos).
 *
 * Security & Governance:
 *  - Enforces server-side canonical path generation: merchants/{merchantId}/{category}/{itemId}_{timestamp}_{nonce}.{ext}
 *  - Max file size: 5 MB (5,242,880 bytes)
 *  - Allowed MIME types: image/jpeg, image/png, image/webp, image/avif
 *  - Magic number / buffer sniffing: validates actual binary content against claimed MIME
 *  - KYC / Identity Isolation: strictly rejects sensitive document keywords (Aadhaar, Voter ID, etc.)
 *  - Public read CDN distribution; uploads/deletions restricted to backend service-role key
 *  - Zero base64 writes to PostgreSQL
 *  - Safe fallback URLs provided for client error handling
 */

const crypto = require('crypto');
const { supabaseAdmin, isConfigured } = require('../supabase');
const { isProduction } = require('./RuntimeMode');

class SupabaseStorageService {
  constructor(options = {}) {
    this.bucket = options.bucket || process.env.SUPABASE_CATALOG_STORAGE_BUCKET || 'catalog-images';
    this.client = options.client !== undefined ? options.client : supabaseAdmin;
    this.isConfigured = options.isConfigured !== undefined ? options.isConfigured : Boolean(this.client && this.client.storage && isConfigured);

    this.maxImageSizeBytes = 5 * 1024 * 1024; // 5 MB strict catalog photo limit

    this.allowedMimeTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif'
    ];

    this.prohibitedKeywords = [
      'kyc',
      'aadhaar',
      'voter',
      'license',
      'passport',
      'identity',
      'pan_card',
      'national_id'
    ];

    this.defaultFallbackUrl = '/assets/images/catalog-placeholder.png';
  }

  /**
   * Refuse a storage operation that would report success while storing nothing.
   *
   * Outside production the mock sandbox below is legitimate and is labelled as
   * simulated. In production an unconfigured provider has no bucket to write to,
   * so the only honest answer is a refusal — not a plausible public URL.
   *
   * @param {string} operation
   */
  assertStorageAvailable(operation) {
    if (this.isConfigured || !isProduction()) return;
    const err = new Error(
      `Supabase Storage credentials are not configured, so ${operation} would store nothing while reporting success. ` +
      'Set the Supabase service key and SUPABASE_CATALOG_STORAGE_BUCKET in the production environment.'
    );
    err.code = 'MEDIA_PROVIDER_NOT_CONFIGURED';
    err.status = 503;
    throw err;
  }

  /**
   * Sniff binary buffer magic numbers to determine true MIME type
   * @param {Buffer} buffer
   * @returns {string|null} detected MIME type or null
   */
  detectBufferMime(buffer) {
    if (!buffer || buffer.length < 4) return null;

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

    // WebP: RIFF .... WEBP
    if (
      buffer.length >= 12 &&
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46 &&
      buffer[8] === 0x57 &&
      buffer[9] === 0x45 &&
      buffer[10] === 0x42 &&
      buffer[11] === 0x50
    ) {
      return 'image/webp';
    }

    // AVIF: ISOBMFF ftyp box containing avif / avis / mif1 / miaf brand
    if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
      const brand = buffer.toString('ascii', 8, 12);
      if (['avif', 'avis', 'mif1', 'miaf'].includes(brand)) {
        return 'image/avif';
      }
      const boxSize = buffer.readUInt32BE(0);
      const searchLimit = Math.min(buffer.length, boxSize > 0 && boxSize < 256 ? boxSize : 64);
      const ftypContent = buffer.slice(8, searchLimit).toString('ascii');
      if (ftypContent.includes('avif') || ftypContent.includes('avis')) {
        return 'image/avif';
      }
    }

    return null;
  }

  /**
   * Parse input data (Data URI string, Base64 string, or Buffer) into binary Buffer
   */
  parseInputBuffer(fileData) {
    if (!fileData) {
      throw new Error('Image data or file buffer is required.');
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

    throw new Error('Unsupported image payload format. Expected Buffer or base64 string.');
  }

  /**
   * Validate buffer size, MIME type, and magic numbers
   */
  validateImage({ buffer, claimedMime }) {
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty image payload.');
    }

    if (buffer.length > this.maxImageSizeBytes) {
      const maxMb = Math.round(this.maxImageSizeBytes / (1024 * 1024));
      throw new Error(`File size exceeds maximum allowed limit of ${maxMb}MB.`);
    }

    // Check declared / claimed MIME
    const effectiveClaimed = claimedMime ? claimedMime.toLowerCase().trim() : null;
    if (effectiveClaimed && !this.allowedMimeTypes.includes(effectiveClaimed)) {
      throw new Error(`Unsupported MIME type [${effectiveClaimed}]. Allowed: ${this.allowedMimeTypes.join(', ')}`);
    }

    // Inspect binary magic numbers
    const detectedMime = this.detectBufferMime(buffer);
    if (!detectedMime) {
      throw new Error(`Unsupported MIME type: binary content does not match allowed types (${this.allowedMimeTypes.join(', ')}).`);
    }

    if (!this.allowedMimeTypes.includes(detectedMime)) {
      throw new Error(`Unsupported MIME type [${detectedMime}]. Allowed: ${this.allowedMimeTypes.join(', ')}`);
    }

    if (effectiveClaimed && effectiveClaimed !== detectedMime) {
      throw new Error(`Unsupported MIME type mismatch: claimed [${effectiveClaimed}] but detected [${detectedMime}].`);
    }

    return detectedMime;
  }

  /**
   * Assert path does not leak into KYC / private identity storage
   */
  assertKycIsolation(pathOrIdentifier) {
    if (!pathOrIdentifier) return;
    const lower = String(pathOrIdentifier).toLowerCase();
    for (const kw of this.prohibitedKeywords) {
      if (lower.includes(kw)) {
        throw new Error(`Sensitive identity documents (${kw}) are strictly prohibited from public catalog storage and must use private encrypted storage.`);
      }
    }
  }

  /**
   * Build server-authoritative storage path
   * merchants/{merchantId}/{category}/{itemId}_{timestamp}_{nonce}.{ext}
   */
  generatePath({ merchantId, category = 'dishes', itemId = 'item', ext = 'jpg' }) {
    if (!merchantId) {
      throw new Error('Merchant ID is required to generate storage path.');
    }

    // Sanitize merchantId, category, itemId against path traversal
    const cleanMerchantId = String(merchantId).replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanCategory = String(category).toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cleanItemId = String(itemId).replace(/[^a-zA-Z0-9_-]/g, '');

    this.assertKycIsolation(cleanMerchantId);
    this.assertKycIsolation(cleanCategory);
    this.assertKycIsolation(cleanItemId);

    const nonce = crypto.randomBytes(4).toString('hex');
    const timestamp = Date.now();
    const cleanExt = String(ext).toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';

    return `merchants/${cleanMerchantId}/${cleanCategory}/${cleanItemId}_${timestamp}_${nonce}.${cleanExt}`;
  }

  /**
   * Map MIME type to standard file extension
   */
  mimeToExtension(mime) {
    switch (mime) {
      case 'image/jpeg': return 'jpg';
      case 'image/png': return 'png';
      case 'image/webp': return 'webp';
      case 'image/avif': return 'avif';
      default: return 'jpg';
    }
  }

  /**
   * Upload catalog image to Supabase Storage
   *
   * @param {Object} params
   * @param {string|Buffer} params.fileData - Raw buffer or base64 / data-uri string
   * @param {string} params.merchantId - Authoritative merchant identifier
   * @param {string} [params.category='dishes'] - 'dishes' | 'grocery' | 'media'
   * @param {string} [params.itemId='item'] - Target dish ID, product ID, or media type
   * @param {string} [params.mimeType] - Declared MIME type
   * @returns {Promise<Object>} Upload response with stable HTTPS URL
   */
  async uploadCatalogImage({ fileData, merchantId, category = 'dishes', itemId = 'item', mimeType = null }) {
    this.assertKycIsolation(merchantId);
    this.assertKycIsolation(category);
    this.assertKycIsolation(itemId);

    const { buffer, claimedMime } = this.parseInputBuffer(fileData);
    const effectiveMime = this.validateImage({
      buffer,
      claimedMime: mimeType || claimedMime
    });

    const ext = this.mimeToExtension(effectiveMime);
    const storagePath = this.generatePath({ merchantId, category, itemId, ext });

    // Live Supabase Storage branch
    if (this.isConfigured && this.client) {
      try {
        const { data, error } = await this.client.storage
          .from(this.bucket)
          .upload(storagePath, buffer, {
            contentType: effectiveMime,
            upsert: true
          });

        if (error) {
          throw new Error(`Supabase Storage upload error: ${error.message}`);
        }

        const { data: pubData } = this.client.storage
          .from(this.bucket)
          .getPublicUrl(storagePath);

        const publicUrl = pubData ? pubData.publicUrl : '';

        return {
          success: true,
          publicUrl,
          secure_url: publicUrl,
          optimized_urls: {
            thumbnail: publicUrl,
            small: publicUrl,
            medium: publicUrl,
            large: publicUrl,
            original: publicUrl,
            fallback: this.defaultFallbackUrl
          },
          public_id: storagePath,
          path: storagePath,
          bucket: this.bucket,
          storageProvider: 'supabase',
          format: ext,
          bytes: buffer.length,
          created_at: new Date().toISOString()
        };
      } catch (uploadErr) {
        // If in production, fail closed
        if (process.env.NODE_ENV === 'production') {
          throw uploadErr;
        }
        // In local development surface the error cleanly
        throw uploadErr;
      }
    }

    // Fallback Mock Sandbox (strictly for local development / testing when Supabase credentials are not configured)
    this.assertStorageAvailable('a catalog image upload');
    const mockPublicUrl = `https://supabase-mock.nabin.local/storage/v1/object/public/${this.bucket}/${storagePath}`;
    return {
      success: true,
      publicUrl: mockPublicUrl,
      secure_url: mockPublicUrl,
      optimized_urls: {
        thumbnail: mockPublicUrl,
        small: mockPublicUrl,
        medium: mockPublicUrl,
        large: mockPublicUrl,
        original: mockPublicUrl,
        fallback: this.defaultFallbackUrl
      },
      public_id: storagePath,
      path: storagePath,
      bucket: this.bucket,
      storageProvider: 'supabase-mock',
      format: ext,
      bytes: buffer.length,
      created_at: new Date().toISOString(),
      mock: true
    };
  }

  /**
   * Delete catalog image from Supabase Storage
   *
   * @param {Object} params
   * @param {string} params.merchantId - Caller merchant ID for ownership verification
   * @param {string} params.path - Relative path within bucket
   */
  async deleteCatalogImage({ merchantId, path }) {
    if (!merchantId) throw new Error('Merchant ID is required.');
    if (!path) throw new Error('Storage path is required.');

    // Ensure path belongs to this merchant
    const expectedPrefix = `merchants/${merchantId}/`;
    if (!path.startsWith(expectedPrefix)) {
      const err = new Error('Forbidden: Cannot delete storage assets of another merchant.');
      err.status = 403;
      err.code = 'MERCHANT_MISMATCH';
      throw err;
    }

    if (this.isConfigured && this.client) {
      const { data, error } = await this.client.storage
        .from(this.bucket)
        .remove([path]);
      if (error) {
        throw new Error(`Supabase Storage remove error: ${error.message}`);
      }
      return { success: true, removed: data };
    }

    this.assertStorageAvailable('a catalog image delete');
    return { success: true, removed: [path], mock: true };
  }

  /**
   * Health and readiness inspection for Supabase Storage
   */
  async checkStorageHealth() {
    if (!this.isConfigured) {
      return {
        configured: false,
        ready: false,
        bucket: this.bucket,
        mode: 'MOCK_SANDBOX'
      };
    }

    try {
      const { data, error } = await this.client.storage.getBucket(this.bucket);
      if (error) {
        return {
          configured: true,
          ready: false,
          bucket: this.bucket,
          error: error.message
        };
      }
      return {
        configured: true,
        ready: true,
        bucket: this.bucket,
        isPublic: Boolean(data?.public)
      };
    } catch (e) {
      return {
        configured: true,
        ready: false,
        bucket: this.bucket,
        error: e.message
      };
    }
  }
}

const supabaseStorageService = new SupabaseStorageService();

module.exports = {
  SupabaseStorageService,
  supabaseStorageService
};
