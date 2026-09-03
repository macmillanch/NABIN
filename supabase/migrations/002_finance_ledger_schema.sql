-- =========================================================================
-- NABIN PLATFORM — ADVANCED DOUBLE-ENTRY FINANCIAL LEDGER & SETTLEMENTS
-- Migration: 002_finance_ledger_schema.sql
-- Architecture: Immutable Double-Entry Ledger, Escrow Vault, Idempotent Payments
-- =========================================================================

-- 1. CHART OF ACCOUNTS (LEDGER ACCOUNTS)
CREATE TABLE IF NOT EXISTS ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(60) UNIQUE NOT NULL,
    account_name VARCHAR(120) NOT NULL,
    account_type VARCHAR(30) NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    normal_balance VARCHAR(10) NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    current_balance NUMERIC(14, 2) DEFAULT 0.00,
    currency VARCHAR(10) DEFAULT 'INR',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pre-seed Standard Platform Accounts
INSERT INTO ledger_accounts (account_code, account_name, account_type, normal_balance)
VALUES
    ('CUSTOMER_WALLET_LIABILITY', 'Customer Prepaid Wallet Balances', 'LIABILITY', 'CREDIT'),
    ('DRIVER_EARNINGS_PAYABLE', 'Driver Accrued Payout Balances', 'LIABILITY', 'CREDIT'),
    ('MERCHANT_PAYABLE', 'Merchant Net Sales Payable', 'LIABILITY', 'CREDIT'),
    ('PAYMENT_GATEWAY_ESCROW', 'Razorpay/UPI Escrow Clearing Account', 'ASSET', 'DEBIT'),
    ('PLATFORM_COMMISSION_REVENUE', 'NABIN Platform Commission Revenue', 'REVENUE', 'CREDIT'),
    ('PLATFORM_PROMO_EXPENSE', 'Marketing & Customer Promo Discount Expense', 'EXPENSE', 'DEBIT'),
    ('DISPUTE_REFUND_EXPENSE', 'Dispute Compensation & Refund Outflows', 'EXPENSE', 'DEBIT')
ON CONFLICT (account_code) DO NOTHING;

-- 2. DOUBLE-ENTRY JOURNAL TRANSACTIONS
CREATE TABLE IF NOT EXISTS journal_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id VARCHAR(80) UNIQUE NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE,
    category VARCHAR(50) NOT NULL CHECK (category IN ('RIDE_SETTLEMENT', 'FOOD_SETTLEMENT', 'PARCEL_SETTLEMENT', 'GROCERY_SETTLEMENT', 'PAYMENT_CAPTURE', 'WALLET_TOPUP', 'DISPUTE_REFUND', 'DRIVER_PAYOUT')),
    job_id UUID REFERENCES jobs(id),
    total_debit NUMERIC(14, 2) NOT NULL,
    total_credit NUMERIC(14, 2) NOT NULL,
    description TEXT NOT NULL,
    reference_id VARCHAR(100),
    status VARCHAR(30) DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOIDED', 'PENDING')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_balanced_entry CHECK (total_debit = total_credit)
);

-- 3. DETAILED LEDGER JOURNAL LINES
CREATE TABLE IF NOT EXISTS journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_id UUID REFERENCES journal_transactions(id) ON DELETE CASCADE,
    account_code VARCHAR(60) REFERENCES ledger_accounts(account_code),
    entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    entity_type VARCHAR(30) CHECK (entity_type IN ('CUSTOMER', 'DRIVER', 'MERCHANT', 'PLATFORM', 'GATEWAY')),
    entity_id VARCHAR(60),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PAYMENTS & IDEMPOTENCY REGISTRY
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id VARCHAR(80) UNIQUE NOT NULL,
    idempotency_key VARCHAR(100) UNIQUE,
    job_id UUID REFERENCES jobs(id),
    customer_id UUID REFERENCES users(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    currency VARCHAR(10) DEFAULT 'INR',
    method VARCHAR(30) NOT NULL CHECK (method IN ('UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH')),
    status VARCHAR(30) NOT NULL CHECK (status IN ('INITIATED', 'PENDING', 'CAPTURED', 'FAILED', 'REFUNDED')),
    gateway_transaction_id VARCHAR(100),
    gateway_signature VARCHAR(200),
    error_code VARCHAR(50),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DRIVER SETTLEMENTS & BANK PAYOUTS
CREATE TABLE IF NOT EXISTS driver_payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id VARCHAR(80) UNIQUE NOT NULL,
    driver_id UUID REFERENCES drivers(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    upi_id VARCHAR(100) NOT NULL,
    status VARCHAR(30) DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'PROCESSING', 'SETTLED', 'FAILED')),
    reference_id VARCHAR(100),
    idempotency_key VARCHAR(100) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

-- RLS POLICIES FOR FINANCE TABLES
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and service roles can view journal entries"
    ON journal_transactions FOR SELECT
    USING (auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'FINANCE_AUDITOR', 'service_role'));

CREATE POLICY "Customers view only own payments"
    ON payments FOR SELECT
    USING (auth.uid() = customer_id);

CREATE POLICY "Drivers view only own payouts"
    ON driver_payouts FOR SELECT
    USING (auth.uid() = driver_id);
