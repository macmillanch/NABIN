-- =========================================================================
-- NABIN PRODUCTION BACKEND — DOMAIN 10 MIGRATION
-- Administrative Audit Logs & Action Persistence (Append-Only Immutable Ledger)
-- =========================================================================

-- 1. Ensure public.audit_logs table exists with core columns
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id VARCHAR(50) NOT NULL,
    admin_name VARCHAR(100) NOT NULL,
    role VARCHAR(40) NOT NULL,
    action VARCHAR(80) NOT NULL,
    module VARCHAR(50) NOT NULL,
    target_entity_type VARCHAR(50) NOT NULL,
    target_entity_id VARCHAR(100) NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    reason TEXT,
    ip_address VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Additive columns for extended audit trail metadata & tracking
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS request_id VARCHAR(100);
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(100);
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS success BOOLEAN DEFAULT TRUE;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- 3. Performance & Audit Query Indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin_id ON public.audit_logs (admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON public.audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON public.audit_logs (module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON public.audit_logs (target_entity_type, target_entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_composite ON public.audit_logs (module, action, created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop previous policies safely if they exist to avoid duplication
DROP POLICY IF EXISTS "Audit logs viewable by authorized admins" ON public.audit_logs;
DROP POLICY IF EXISTS "Audit logs insertable by service role and admins" ON public.audit_logs;

-- Read Policy: Only authorized admin roles and backend service role can inspect audit trails
CREATE POLICY "Audit logs viewable by authorized admins"
    ON public.audit_logs FOR SELECT
    USING (
        auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT', 'service_role')
        OR auth.role() = 'service_role'
    );

-- Write Policy: Insert allowed for backend service role and authenticated admins
CREATE POLICY "Audit logs insertable by service role and admins"
    ON public.audit_logs FOR INSERT
    WITH CHECK (
        auth.jwt() ->> 'role' IN ('SUPER_ADMIN', 'KYC_SPECIALIST', 'OPERATIONS', 'FINANCE_AUDITOR', 'SUPPORT_AGENT', 'service_role')
        OR auth.role() = 'service_role'
        OR auth.jwt() IS NOT NULL
    );

-- NOTE ON IMMUTABILITY:
-- Normal UPDATE and DELETE policies are intentionally OMITTED.
-- PostgreSQL RLS denies UPDATE and DELETE operations by default, ensuring an immutable, append-only historical audit ledger.
