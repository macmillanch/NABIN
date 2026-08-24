const cloudinary = require('cloudinary').v2;

class CloudinaryService {
  constructor() {
    this.cloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
    this.apiKey = process.env.CLOUDINARY_API_KEY || '';
    this.apiSecret = process.env.CLOUDINARY_API_SECRET || '';

    this.isConfigured = Boolean(this.cloudName && this.apiKey && this.apiSecret);

    if (this.isConfigured) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true
      });
    }

    this.allowedFolders = [
      'nabin/users',
      'nabin/drivers',
      'nabin/vehicles',
      'nabin/restaurants',
      'nabin/food',
      'nabin/grocery',
      'nabin/parcels',
      'nabin/delivery-proof',
      'nabin/public'
    ];

    this.allowedImageMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'image/gif'
    ];

    this.allowedVideoMimes = [
      'video/mp4',
      'video/webm',
      'video/quicktime'
    ];

    this.maxImageSizeBytes = 10 * 1024 * 1024; // 10MB
    this.maxVideoSizeBytes = 50 * 1024 * 1024; // 50MB
  }

  validateFolder(folder) {
    if (!folder) return 'nabin/public';
    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
    const isAllowed = this.allowedFolders.some(f => cleanFolder === f || cleanFolder.startsWith(`${f}/`));
    if (!isAllowed) {
      throw new Error(`Folder [${folder}] is not permitted for public media storage.`);
    }
    return cleanFolder;
  }

  validateMimeType(mimeType, isVideo = false) {
    if (!mimeType) throw new Error('File MIME type is required.');
    const allowed = isVideo ? this.allowedVideoMimes : this.allowedImageMimes;
    if (!allowed.includes(mimeType.toLowerCase())) {
      throw new Error(`Unsupported MIME type [${mimeType}]. Allowed: ${allowed.join(', ')}`);
    }
  }

  validateFileSize(bytes, isVideo = false) {
    if (!bytes || bytes <= 0) throw new Error('Invalid file size.');
    const max = isVideo ? this.maxVideoSizeBytes : this.maxImageSizeBytes;
    if (bytes > max) {
      const maxMb = Math.round(max / (1024 * 1024));
      throw new Error(`File size exceeds maximum allowed limit of ${maxMb}MB.`);
    }
  }

  generateOptimizedUrl(publicId, options = {}) {
    if (!publicId) return '';
    const cloudName = this.cloudName || 'nabin-media';
    const {
      width,
      height,
      crop = 'fill',
      quality = 'auto',
      format = 'auto',
      gravity = 'auto'
    } = options;

    const transforms = [];
    if (width) transforms.push(`w_${width}`);
    if (height) transforms.push(`h_${height}`);
    if (width || height) transforms.push(`c_${crop}`);
    if (gravity && (crop === 'fill' || crop === 'thumb')) transforms.push(`g_${gravity}`);
    transforms.push(`q_${quality}`);
    transforms.push(`f_${format}`);

    const transformStr = transforms.join(',');
    return `https://res.cloudinary.com/${cloudName}/image/upload/${transformStr}/${publicId}`;
  }

  generateThumbnailUrl(publicId, size = 160) {
    return this.generateOptimizedUrl(publicId, {
      width: size,
      height: size,
      crop: 'thumb',
      gravity: 'face',
      quality: 'auto',
      format: 'auto'
    });
  }

  generateVariantUrls(publicId) {
    if (!publicId) return {};
    return {
      thumbnail: this.generateThumbnailUrl(publicId, 160),
      small: this.generateOptimizedUrl(publicId, { width: 400, crop: 'limit' }),
      medium: this.generateOptimizedUrl(publicId, { width: 800, crop: 'limit' }),
      large: this.generateOptimizedUrl(publicId, { width: 1200, crop: 'limit' }),
      original: `https://res.cloudinary.com/${this.cloudName || 'nabin-media'}/image/upload/q_auto,f_auto/${publicId}`
    };
  }

  async uploadImage({ fileData, folder = 'nabin/public', publicId = null, tags = [], mimeType = 'image/jpeg', bytes = 0 }) {
    this.validateFolder(folder);
    this.validateMimeType(mimeType, false);
    if (bytes) this.validateFileSize(bytes, false);

    if (!fileData) {
      throw new Error('Image data or file buffer is required.');
    }

    const cleanFolder = this.validateFolder(folder);
    const targetPublicId = publicId || `${cleanFolder}/img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!this.isConfigured) {
      // Mock Sandbox Delivery when credentials not provisioned in local dev
      const mockPublicId = targetPublicId.startsWith('nabin/') ? targetPublicId : `${cleanFolder}/${targetPublicId}`;
      const mockVariants = this.generateVariantUrls(mockPublicId);
      return {
        success: true,
        public_id: mockPublicId,
        secure_url: mockVariants.medium,
        optimized_urls: mockVariants,
        format: mimeType.split('/')[1] || 'jpg',
        resource_type: 'image',
        width: 800,
        height: 600,
        bytes: bytes || 45000,
        folder: cleanFolder,
        created_at: new Date().toISOString(),
        mock: true
      };
    }

    try {
      const result = await cloudinary.uploader.upload(fileData, {
        folder: cleanFolder,
        public_id: publicId ? publicId.split('/').pop() : undefined,
        overwrite: true,
        resource_type: 'image',
        tags: ['nabin-platform', ...tags],
        transformation: [
          { quality: 'auto', fetch_format: 'auto' }
        ]
      });

      const variants = this.generateVariantUrls(result.public_id);
      return {
        success: true,
        public_id: result.public_id,
        secure_url: result.secure_url,
        optimized_urls: variants,
        format: result.format,
        resource_type: result.resource_type,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
        folder: cleanFolder,
        created_at: result.created_at || new Date().toISOString()
      };
    } catch (err) {
      throw new Error(`Cloudinary upload error: ${err.message}`);
    }
  }

  async uploadVideo({ fileData, folder = 'nabin/public', publicId = null, tags = [], mimeType = 'video/mp4', bytes = 0 }) {
    this.validateFolder(folder);
    this.validateMimeType(mimeType, true);
    if (bytes) this.validateFileSize(bytes, true);

    if (!fileData) {
      throw new Error('Video data or file buffer is required.');
    }

    const cleanFolder = this.validateFolder(folder);
    const targetPublicId = publicId || `${cleanFolder}/vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!this.isConfigured) {
      return {
        success: true,
        public_id: targetPublicId,
        secure_url: `https://res.cloudinary.com/${this.cloudName || 'nabin-media'}/video/upload/${targetPublicId}.mp4`,
        format: 'mp4',
        resource_type: 'video',
        bytes: bytes || 1500000,
        folder: cleanFolder,
        created_at: new Date().toISOString(),
        mock: true
      };
    }

    try {
      const result = await cloudinary.uploader.upload(fileData, {
        folder: cleanFolder,
        public_id: publicId ? publicId.split('/').pop() : undefined,
        overwrite: true,
        resource_type: 'video',
        tags: ['nabin-platform', ...tags]
      });

      return {
        success: true,
        public_id: result.public_id,
        secure_url: result.secure_url,
        format: result.format,
        resource_type: result.resource_type,
        bytes: result.bytes,
        folder: cleanFolder,
        created_at: result.created_at || new Date().toISOString()
      };
    } catch (err) {
      throw new Error(`Cloudinary video upload error: ${err.message}`);
    }
  }

  async deleteAsset(publicId, resourceType = 'image') {
    if (!publicId) throw new Error('public_id is required for deletion.');

    if (!this.isConfigured) {
      return { success: true, result: 'ok', public_id: publicId, mock: true };
    }

    try {
      const res = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      return { success: true, result: res.result || 'ok', public_id: publicId };
    } catch (err) {
      throw new Error(`Cloudinary delete error: ${err.message}`);
    }
  }

  generateSignedUploadParams({ folder = 'nabin/public', publicId = null, tags = [] }) {
    if (!this.isConfigured) {
      throw new Error('Cloudinary credentials must be configured to generate signed upload parameters.');
    }

    const cleanFolder = this.validateFolder(folder);
    const timestamp = Math.round(new Date().getTime() / 1000);
    const paramsToSign = {
      timestamp,
      folder: cleanFolder,
      ...(publicId ? { public_id: publicId } : {}),
      ...(tags.length ? { tags: tags.join(',') } : {})
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, this.apiSecret);

    return {
      cloudName: this.cloudName,
      apiKey: this.apiKey,
      timestamp,
      signature,
      folder: cleanFolder,
      publicId,
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.cloudName}/auto/upload`
    };
  }
}

module.exports = new CloudinaryService();
