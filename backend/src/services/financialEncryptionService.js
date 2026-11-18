/**
 * FinancialEncryptionService
 *
 * Cryptographic service for encrypting, decrypting, masking, and hashing
 * sensitive merchant banking credentials (bank account numbers, routing metadata).
 *
 * Cryptographic Standard:
 *  - Algorithm: AES-256-GCM (Authenticated Encryption with Associated Data).
 *  - Key derivation: HKDF / SHA-256 derived from FINANCIAL_ENCRYPTION_KEY or server secret.
 *  - Ciphertext format: `ivHex:tagHex:encryptedHex`
 *  - Account Masking: `•••• •••• •••• 1234` (keeps only last 4 digits for UI display).
 *  - Account Hashing: HMAC-SHA256 for collision detection and verification idempotency.
 *  - Zero plaintext storage in logs or database columns.
 */

const crypto = require('crypto');

class FinancialEncryptionService {
  constructor() {
    this.algorithm = 'aes-256-gcm';
    this.ivLength = 12; // Standard 96-bit IV for GCM
    this.tagLength = 16; // 128-bit auth tag

    // Derive 256-bit encryption key
    const rawSecret = process.env.FINANCIAL_ENCRYPTION_KEY || 
                      process.env.JWT_SECRET || 
                      'nabin-financial-bank-vault-seed-key-2026';

    this.encryptionKey = crypto.createHash('sha256').update(rawSecret).digest();
  }

  /**
   * Encrypt bank account number using AES-256-GCM
   * @param {string} plaintext
   * @returns {string} iv:tag:ciphertext
   */
  encryptAccountNumber(plaintext) {
    if (!plaintext || typeof plaintext !== 'string') {
      throw new Error('Plaintext account number is required for encryption.');
    }

    const cleanNumber = plaintext.replace(/\s+/g, '');
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(cleanNumber, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /**
   * Decrypt bank account number using AES-256-GCM
   * @param {string} encryptedString
   * @returns {string} decrypted plaintext
   */
  decryptAccountNumber(encryptedString) {
    if (!encryptedString || typeof encryptedString !== 'string') {
      throw new Error('Encrypted payload is required for decryption.');
    }

    const parts = encryptedString.split(':');
    if (parts.length !== 3) {
      throw new Error('Malformed encrypted payload format. Expected iv:tag:ciphertext.');
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(cipherHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Mask account number for safe display e.g. '•••• •••• •••• 4910'
   * @param {string} accountNumber
   * @returns {string}
   */
  maskAccountNumber(accountNumber) {
    if (!accountNumber) return '••••';
    const clean = String(accountNumber).replace(/\s+/g, '');
    if (clean.length < 4) return '•••• ' + clean;

    const lastFour = clean.slice(-4);
    const maskedLength = clean.length - 4;
    
    // Group masked bullets in 4s if long, or standard 12-bullet block
    if (maskedLength >= 8) {
      return '•••• •••• •••• ' + lastFour;
    } else if (maskedLength >= 4) {
      return '•••• •••• ' + lastFour;
    }
    return '•••• ' + lastFour;
  }

  /**
   * Generate HMAC-SHA256 hash of normalized account number
   * @param {string} accountNumber
   * @returns {string} hex hash
   */
  hashAccountNumber(accountNumber) {
    if (!accountNumber) return '';
    const clean = String(accountNumber).replace(/\s+/g, '');
    return crypto.createHmac('sha256', this.encryptionKey).update(clean).digest('hex');
  }

  /**
   * Validate Indian / International IFSC format
   * Standard Indian IFSC: 4 uppercase letters, digit 0, 6 alphanumeric chars
   * e.g. SBIN0000123, HDFC0001234, NBLNPKTM01 (regional)
   */
  validateIfsc(ifsc) {
    if (!ifsc || typeof ifsc !== 'string') return false;
    const clean = ifsc.trim().toUpperCase();
    // Accommodates standard 11-char Indian IFSC & Regional Northeast / Himalayan 10-11 char routing
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$|^[A-Z]{3,5}[A-Z0-9]{5,8}$/;
    return ifscRegex.test(clean);
  }

  /**
   * Sanitize an object to ensure plain account numbers never appear in logs or responses
   */
  sanitizeForLogging(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const copy = { ...obj };
    if (copy.accountNumber) copy.accountNumber = this.maskAccountNumber(copy.accountNumber);
    if (copy.confirmAccountNumber) delete copy.confirmAccountNumber;
    if (copy.encryptedAccountNumber) copy.encryptedAccountNumber = '[ENCRYPTED_AES256_GCM]';
    return copy;
  }
}

const financialEncryptionService = new FinancialEncryptionService();

module.exports = {
  FinancialEncryptionService,
  financialEncryptionService
};
