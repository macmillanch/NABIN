-- =============================================================================
-- NABIN PLATFORM — MERCHANT COMPLIANCE DOCUMENTS METADATA
-- Migration: 057_merchant_compliance_documents.sql
-- Status: LOCAL & PRODUCTION VERIFIED.
-- =============================================================================
-- Purpose:
--   Durable, tenant-isolated metadata tracking for merchant compliance documents
--   (FSSAI Food Safety Licence, PAN/VAT Certificates, Restaurant Trade Licences).
--   Binary payloads reside exclusively in the private 'merchant-documents'
--   Supabase Storage bucket; this relation tracks metadata, ownership,
--   verification lifecycle, and cryptographic checksums.
--
-- Security & Isolation:
--   - Polymorphic merchant_id referencing the authenticated merchant principal.
--   - Zero public access: Row Level Security (RLS) enabled.
--   - Backend access via service_role with explicit tenant matching in the API layer.
--   - Checksum tracking via SHA-256 for non-repudiation and auditability.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id VARCHAR(255) NOT NULL,
    document_type VARCHAR(60) NOT NULL,
    document_number VARCHAR(100),
    storage_bucket VARCHAR(100) NOT NULL DEFAULT 'merchant-documents',
    storage_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    file_hash_sha256 VARCHAR(64),
    status VARCHAR(40) NOT NULL DEFAULT 'PENDING_REVIEW',
    expiry_date VARCHAR(50),
    rejection_reason TEXT,
    uploaded_by_user_id VARCHAR(255),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_merchant_document_type CHECK (
        document_type IN (
            'FSSAI_LICENSE',
            'PAN_VAT_CERTIFICATE',
            'TRADE_LICENSE',
            'GST_CERTIFICATE',
            'OTHER_COMPLIANCE'
        )
    ),
    CONSTRAINT chk_merchant_document_status CHECK (
        status IN (
            'ATTACHED',
            'PENDING_REVIEW',
            'VERIFIED',
            'REJECTED',
            'WITHDRAWN'
        )
    ),
    CONSTRAINT chk_merchant_document_size_positive CHECK (file_size_bytes > 0)
);

-- Indices for performance and tenant scoping
CREATE INDEX IF NOT EXISTS idx_merchant_documents_merchant_id 
    ON public.merchant_documents (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_documents_merchant_type 
    ON public.merchant_documents (merchant_id, document_type);

CREATE INDEX IF NOT EXISTS idx_merchant_documents_status 
    ON public.merchant_documents (status);

CREATE INDEX IF NOT EXISTS idx_merchant_documents_created_at 
    ON public.merchant_documents (created_at DESC);

-- Enable RLS
ALTER TABLE public.merchant_documents ENABLE ROW LEVEL SECURITY;

-- Grant permissions to backend service role
GRANT ALL ON public.merchant_documents TO service_role;
