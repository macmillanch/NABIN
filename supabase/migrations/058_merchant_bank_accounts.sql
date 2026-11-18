-- =============================================================================
-- NABIN PLATFORM — MERCHANT BANK ACCOUNTS & SETTLEMENT DESTINATIONS
-- Migration: 058_merchant_bank_accounts.sql
-- Status: LOCAL & PRODUCTION VERIFIED.
-- =============================================================================
-- Purpose:
--   Durable, tenant-isolated metadata and encrypted account storage for
--   restaurant merchant settlement payouts (Daily T+1 / Weekly ACH clearing).
--
-- Security & Financial Isolation:
--   - Account numbers are stored in AES-256-GCM ciphertext (encrypted_account_number)
--     plus masked form (masked_account_number) for safe UI rendering.
--   - Account numbers are NEVER stored or logged in plain text.
--   - Strict tenant isolation: merchant_id references authenticated principal.
--   - Row Level Security (RLS) enabled; access granted only to service_role.
--   - Completely separate from customer-facing static UPI QR settings.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.merchant_bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id VARCHAR(255) NOT NULL,
    account_holder_name VARCHAR(255) NOT NULL,
    bank_name VARCHAR(255) NOT NULL,
    encrypted_account_number TEXT NOT NULL,
    masked_account_number VARCHAR(30) NOT NULL,
    account_number_hash VARCHAR(64) NOT NULL,
    ifsc_code VARCHAR(20) NOT NULL,
    branch_name VARCHAR(255),
    account_type VARCHAR(50) NOT NULL DEFAULT 'CURRENT',
    payout_cadence VARCHAR(50) NOT NULL DEFAULT 'DAILY_T1',
    cancelled_cheque_document_id UUID,
    verification_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_VERIFICATION',
    verification_provider VARCHAR(50) DEFAULT 'PENNY_DROP_ACH',
    verification_reference VARCHAR(100),
    verification_notes TEXT,
    verified_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_merchant_bank_account_merchant UNIQUE (merchant_id),
    CONSTRAINT chk_merchant_bank_account_type CHECK (
        account_type IN ('CURRENT', 'SAVINGS', 'OVERDRAFT')
    ),
    CONSTRAINT chk_merchant_bank_payout_cadence CHECK (
        payout_cadence IN ('DAILY_T1', 'WEEKLY_CONSOLIDATED')
    ),
    CONSTRAINT chk_merchant_bank_verification_status CHECK (
        verification_status IN (
            'NOT_SUBMITTED',
            'PENDING_VERIFICATION',
            'VERIFIED',
            'REJECTED',
            'ACTION_REQUIRED'
        )
    )
);

-- Indices for performance and security queries
CREATE INDEX IF NOT EXISTS idx_merchant_bank_accounts_merchant_id
    ON public.merchant_bank_accounts (merchant_id);

CREATE INDEX IF NOT EXISTS idx_merchant_bank_accounts_verification_status
    ON public.merchant_bank_accounts (verification_status);

CREATE INDEX IF NOT EXISTS idx_merchant_bank_accounts_hash
    ON public.merchant_bank_accounts (account_number_hash);

-- Enable RLS
ALTER TABLE public.merchant_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Grant permissions to backend service role
GRANT ALL ON public.merchant_bank_accounts TO service_role;
