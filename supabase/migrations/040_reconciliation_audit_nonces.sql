-- Migration 040: Durable Nonce Replay Protection for Financial Ledger Reconciler
-- Authoritative Audit Storage for One-Time Replay Protection

CREATE TABLE IF NOT EXISTS public.reconciliation_audit_nonces (
  nonce TEXT PRIMARY KEY,
  manifest_digest TEXT NOT NULL,
  target TEXT NOT NULL,
  project_ref TEXT NOT NULL,
  operation TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  total_amount NUMERIC(14, 2) NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_by_pid INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMMITTED',
  CONSTRAINT check_reconciliation_operation CHECK (operation = 'FINANCIAL_LEDGER_BACKFILL_EXECUTE')
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_audit_nonces_manifest ON public.reconciliation_audit_nonces (manifest_digest);

ALTER TABLE public.reconciliation_audit_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.reconciliation_audit_nonces FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.reconciliation_audit_nonces TO service_role;
GRANT ALL ON public.reconciliation_audit_nonces TO postgres;
