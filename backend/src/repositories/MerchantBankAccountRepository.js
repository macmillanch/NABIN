const { supabaseAdmin, isLivePostgres } = require('../supabase');
const crypto = require('crypto');
const { financialEncryptionService } = require('../services/financialEncryptionService');

/**
 * Shared DTO shape for merchant bank accounts.
 * Safe by default: NEVER exposes encrypted or raw account number unless explicitly asked.
 */
function toDTO(record, { includeDecrypted = false } = {}) {
  if (!record) return null;
  const dto = {
    id: record.id,
    merchantId: record.merchantId || record.merchant_id,
    accountHolderName: record.accountHolderName || record.account_holder_name,
    bankName: record.bankName || record.bank_name,
    maskedAccountNumber: record.maskedAccountNumber || record.masked_account_number,
    ifscCode: record.ifscCode || record.ifsc_code,
    branchName: record.branchName || record.branch_name || null,
    accountType: record.accountType || record.account_type || 'CURRENT',
    payoutCadence: record.payoutCadence || record.payout_cadence || 'DAILY_T1',
    cancelledChequeDocumentId: record.cancelledChequeDocumentId || record.cancelled_cheque_document_id || null,
    verificationStatus: record.verificationStatus || record.verification_status || 'PENDING_VERIFICATION',
    verificationProvider: record.verificationProvider || record.verification_provider || 'PENNY_DROP_ACH',
    verificationReference: record.verificationReference || record.verification_reference || null,
    verificationNotes: record.verificationNotes || record.verification_notes || null,
    verifiedAt: record.verifiedAt || record.verified_at || null,
    metadata: record.metadata || {},
    createdAt: record.createdAt || record.created_at || null,
    updatedAt: record.updatedAt || record.updated_at || null
  };

  if (includeDecrypted && (record.encryptedAccountNumber || record.encrypted_account_number)) {
    try {
      dto.decryptedAccountNumber = financialEncryptionService.decryptAccountNumber(
        record.encryptedAccountNumber || record.encrypted_account_number
      );
    } catch (_) {
      dto.decryptedAccountNumber = null;
    }
  }

  return dto;
}

function mapRowToDTO(row, options) {
  if (!row) return null;
  return toDTO({
    id: row.id,
    merchant_id: row.merchant_id,
    account_holder_name: row.account_holder_name,
    bank_name: row.bank_name,
    encrypted_account_number: row.encrypted_account_number,
    masked_account_number: row.masked_account_number,
    account_number_hash: row.account_number_hash,
    ifsc_code: row.ifsc_code,
    branch_name: row.branch_name,
    account_type: row.account_type,
    payout_cadence: row.payout_cadence,
    cancelled_cheque_document_id: row.cancelled_cheque_document_id,
    verification_status: row.verification_status,
    verification_provider: row.verification_provider,
    verification_reference: row.verification_reference,
    verification_notes: row.verification_notes,
    verified_at: row.verified_at,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  }, options);
}

function toRow(data) {
  return {
    merchant_id: data.merchantId || data.merchant_id,
    account_holder_name: data.accountHolderName || data.account_holder_name,
    bank_name: data.bankName || data.bank_name,
    encrypted_account_number: data.encryptedAccountNumber || data.encrypted_account_number,
    masked_account_number: data.maskedAccountNumber || data.masked_account_number,
    account_number_hash: data.accountNumberHash || data.account_number_hash,
    ifsc_code: data.ifscCode || data.ifsc_code,
    branch_name: data.branchName || data.branch_name || null,
    account_type: data.accountType || data.account_type || 'CURRENT',
    payout_cadence: data.payoutCadence || data.payout_cadence || 'DAILY_T1',
    cancelled_cheque_document_id: data.cancelledChequeDocumentId || data.cancelled_cheque_document_id || null,
    verification_status: data.verificationStatus || data.verification_status || 'PENDING_VERIFICATION',
    verification_provider: data.verificationProvider || data.verification_provider || 'PENNY_DROP_ACH',
    verification_reference: data.verificationReference || data.verification_reference || null,
    verification_notes: data.verificationNotes || data.verification_notes || null,
    verified_at: data.verifiedAt || data.verified_at || null,
    metadata: data.metadata || {},
    updated_at: new Date().toISOString()
  };
}

class MerchantBankAccountRepository {
  constructor(dbOrClient = null) {
    this.client = (dbOrClient && typeof dbOrClient.from === 'function') ? dbOrClient : supabaseAdmin;
    this.accounts = []; // In-memory fallback mirror
  }

  /**
   * Save or update merchant bank account details
   */
  async save(bankAccountData) {
    const row = toRow(bankAccountData);
    const accountId = bankAccountData.id || crypto.randomUUID();

    // In-memory update/insert keyed on merchant_id
    const existingIdx = this.accounts.findIndex(a => 
      a.id === accountId || String(a.merchantId || a.merchant_id) === String(row.merchant_id)
    );

    const memoryRecord = {
      id: accountId,
      ...bankAccountData,
      ...row,
      createdAt: existingIdx >= 0 ? this.accounts[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      this.accounts[existingIdx] = memoryRecord;
    } else {
      this.accounts.push(memoryRecord);
    }

    if (isLivePostgres && this.client) {
      try {
        const { data, error } = await this.client
          .from('merchant_bank_accounts')
          .upsert([{ id: accountId, ...row }], { onConflict: 'merchant_id' })
          .select('*')
          .maybeSingle();

        if (!error && data) {
          return mapRowToDTO(data);
        }
      } catch (_) {
        // Fallback to memory
      }
    }

    return toDTO(memoryRecord);
  }

  /**
   * Find bank account by merchant ID (returns masked account number)
   */
  async findByMerchantId(merchantId, options = {}) {
    if (isLivePostgres && this.client) {
      try {
        const { data, error } = await this.client
          .from('merchant_bank_accounts')
          .select('*')
          .eq('merchant_id', String(merchantId))
          .maybeSingle();

        if (!error && data) {
          return mapRowToDTO(data, options);
        }
      } catch (_) {
        // Fallback to memory
      }
    }

    const found = this.accounts.find(a => 
      String(a.merchantId || a.merchant_id) === String(merchantId)
    );
    return found ? toDTO(found, options) : null;
  }

  /**
   * Delete or withdraw bank account for a merchant
   */
  async delete(merchantId) {
    const existing = await this.findByMerchantId(merchantId);
    if (!existing) return null;

    this.accounts = this.accounts.filter(a => 
      String(a.merchantId || a.merchant_id) !== String(merchantId)
    );

    if (isLivePostgres && this.client) {
      try {
        await this.client
          .from('merchant_bank_accounts')
          .delete()
          .eq('merchant_id', String(merchantId));
      } catch (_) {
        // Fallback to memory
      }
    }

    return existing;
  }
}

module.exports = {
  MerchantBankAccountRepository,
  toDTO,
  mapRowToDTO
};
