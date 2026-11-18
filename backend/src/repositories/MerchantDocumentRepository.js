const { supabaseAdmin, isLivePostgres } = require('../supabase');
const crypto = require('crypto');

/**
 * Shared DTO shape for merchant compliance documents.
 */
function toDTO(record) {
  if (!record) return null;
  return {
    id: record.id,
    merchantId: record.merchantId || record.merchant_id,
    documentType: record.documentType || record.document_type,
    documentNumber: record.documentNumber || record.document_number || null,
    storageBucket: record.storageBucket || record.storage_bucket || 'merchant-documents',
    storagePath: record.storagePath || record.storage_path,
    originalFilename: record.originalFilename || record.original_filename,
    mimeType: record.mimeType || record.mime_type,
    fileSizeBytes: Number(record.fileSizeBytes != null ? record.fileSizeBytes : record.file_size_bytes) || 0,
    fileHashSha256: record.fileHashSha256 || record.file_hash_sha256 || null,
    status: record.status || 'PENDING_REVIEW',
    expiryDate: record.expiryDate || record.expiry_date || null,
    rejectionReason: record.rejectionReason || record.rejection_reason || null,
    uploadedByUserId: record.uploadedByUserId || record.uploaded_by_user_id || null,
    metadata: record.metadata || {},
    createdAt: record.createdAt || record.created_at || null,
    updatedAt: record.updatedAt || record.updated_at || null
  };
}

/**
 * Map PostgreSQL row to DTO.
 */
function mapRowToDTO(row) {
  if (!row) return null;
  return toDTO({
    id: row.id,
    merchant_id: row.merchant_id,
    document_type: row.document_type,
    document_number: row.document_number,
    storage_bucket: row.storage_bucket,
    storage_path: row.storage_path,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size_bytes: row.file_size_bytes,
    file_hash_sha256: row.file_hash_sha256,
    status: row.status,
    expiry_date: row.expiry_date,
    rejection_reason: row.rejection_reason,
    uploaded_by_user_id: row.uploaded_by_user_id,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

function toRow(doc) {
  return {
    merchant_id: doc.merchantId || doc.merchant_id,
    document_type: doc.documentType || doc.document_type,
    document_number: doc.documentNumber || doc.document_number || null,
    storage_bucket: doc.storageBucket || doc.storage_bucket || 'merchant-documents',
    storage_path: doc.storagePath || doc.storage_path,
    original_filename: doc.originalFilename || doc.original_filename,
    mime_type: doc.mimeType || doc.mime_type,
    file_size_bytes: Number(doc.fileSizeBytes != null ? doc.fileSizeBytes : doc.file_size_bytes) || 0,
    file_hash_sha256: doc.fileHashSha256 || doc.file_hash_sha256 || null,
    status: doc.status || 'PENDING_REVIEW',
    expiry_date: doc.expiryDate || doc.expiry_date || null,
    rejection_reason: doc.rejectionReason || doc.rejection_reason || null,
    uploaded_by_user_id: doc.uploadedByUserId || doc.uploaded_by_user_id || null,
    metadata: doc.metadata || {},
    updated_at: new Date().toISOString()
  };
}

class MerchantDocumentRepository {
  constructor(dbOrClient = null) {
    this.client = (dbOrClient && typeof dbOrClient.from === 'function') ? dbOrClient : supabaseAdmin;
    this.documents = []; // In-memory fallback mirror
  }

  /**
   * Save or replace merchant compliance document record
   */
  async save(documentData) {
    const row = toRow(documentData);
    const docId = documentData.id || crypto.randomUUID();

    // In-memory update/insert
    const existingIdx = this.documents.findIndex(d => 
      (d.id === docId) || 
      (d.merchantId === row.merchant_id && d.documentType === row.document_type)
    );

    const memoryRecord = {
      id: docId,
      ...documentData,
      ...row,
      createdAt: existingIdx >= 0 ? this.documents[existingIdx].createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      this.documents[existingIdx] = memoryRecord;
    } else {
      this.documents.push(memoryRecord);
    }

    if (isLivePostgres && this.client) {
      try {
        const { data, error } = await this.client
          .from('merchant_documents')
          .upsert([{ id: docId, ...row }], { onConflict: 'id' })
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
   * Find documents by merchant ID
   */
  async findByMerchantId(merchantId) {
    if (isLivePostgres && this.client) {
      try {
        const { data, error } = await this.client
          .from('merchant_documents')
          .select('*')
          .eq('merchant_id', String(merchantId))
          .neq('status', 'WITHDRAWN')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(mapRowToDTO);
        }
      } catch (_) {
        // Fallback to memory
      }
    }

    return this.documents
      .filter(d => String(d.merchantId || d.merchant_id) === String(merchantId) && d.status !== 'WITHDRAWN')
      .map(toDTO);
  }

  /**
   * Find single document by ID with tenant isolation
   */
  async findById(documentId, merchantId) {
    if (isLivePostgres && this.client) {
      try {
        let query = this.client
          .from('merchant_documents')
          .select('*')
          .eq('id', documentId);

        if (merchantId) {
          query = query.eq('merchant_id', String(merchantId));
        }

        const { data, error } = await query.maybeSingle();
        if (!error && data) {
          return mapRowToDTO(data);
        }
      } catch (_) {
        // Fallback to memory
      }
    }

    const found = this.documents.find(d => 
      d.id === documentId && (!merchantId || String(d.merchantId || d.merchant_id) === String(merchantId))
    );
    return found ? toDTO(found) : null;
  }

  /**
   * Withdraw / delete document with tenant isolation
   */
  async delete(documentId, merchantId) {
    const existing = await this.findById(documentId, merchantId);
    if (!existing) {
      return null;
    }

    this.documents = this.documents.filter(d => d.id !== documentId);

    if (isLivePostgres && this.client) {
      try {
        await this.client
          .from('merchant_documents')
          .delete()
          .eq('id', documentId)
          .eq('merchant_id', String(merchantId));
      } catch (_) {
        // Fallback to memory
      }
    }

    return existing;
  }
}

module.exports = {
  MerchantDocumentRepository,
  toDTO,
  mapRowToDTO
};
