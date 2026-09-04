-- NABIN Platform — Domain 5 Migration (Jobs / Rides / Orders)
-- Adds a metadata JSONB column to the jobs table to store service-specific
-- fields (food items, order status, idempotency keys, passenger info, etc.)
-- that do not have dedicated columns. Core fields already exist in 001.
--
-- NOTE: This migration is applied to the TEST Supabase database via the
-- Supabase Management API during test setup. The application code also
-- gracefully handles the case where this column is absent (falls back to
-- cache / join-based reconstruction).

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Index for fast idempotency-key lookups (stored inside metadata).
CREATE INDEX IF NOT EXISTS idx_jobs_metadata_idempotency
  ON jobs USING btree (((metadata->>'idempotencyKey')::text))
  WHERE metadata->>'idempotencyKey' IS NOT NULL;

-- Index for fast customer/driver/merchant lookups (already covered by FK
-- columns, but explicit indexes improve list query performance).
CREATE INDEX IF NOT EXISTS idx_jobs_customer_id ON jobs (customer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_driver_id ON jobs (driver_id);
CREATE INDEX IF NOT EXISTS idx_jobs_merchant_id ON jobs (merchant_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_service_type ON jobs (service_type);
