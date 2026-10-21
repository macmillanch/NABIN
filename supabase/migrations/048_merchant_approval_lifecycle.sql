-- =========================================================================
-- 048 — Merchant pending-approval lifecycle (MI-5, P0) — LOCAL ONLY
--
-- Do NOT apply this to a hosted project. It is written against the local Docker
-- PostgreSQL this repository's suites run against, and it is applied with
-- backend/scripts/apply_local_migration.js (DEC-013: remote Supabase is never
-- touched without an explicit owner order).
--
-- THE DEFECT THIS MIGRATION MAKES EXPRESSIBLE (measured against this store before
-- writing it, not quoted from the earlier report):
--   * `merchants` had 27 columns and none of them approval-shaped. There was no
--     state the row could even hold: `POST /api/merchant/register` needs no
--     credential of any kind, and MerchantRepository.createMerchant wrote
--     `is_open: true, rating: 4.80` straight into the durable row. A random phone
--     number plus one POST minted a storefront that was immediately tradeable.
--   * Measured row counts at that moment: 83 merchants, ALL 83 with
--     `is_open = true`, and 54 of them carrying `rating = 4.80`.
--   * The only customer-facing read policy was
--     "Public read active merchants" FOR SELECT USING (is_open = true) —
--     an unapproved store is "active" the instant it is inserted.
--   * Measured RLS reality in this store: every policy on `merchants` is created
--     `TO public` (pg_policies.roles reads {public} for all three), so the roles
--     column cannot distinguish a customer-readable policy from an owner-scoped
--     one. Only the `qual` predicate can, which is why the fix below rewrites the
--     predicate rather than adding a fourth policy.
--
-- WHY THIS SHAPE:
--   The project already knows how to express an approval lifecycle: drivers carry
--   `kyc_status VARCHAR(30) DEFAULT 'PENDING' CHECK (kyc_status IN (...))` plus
--   `kyc_verified_at` / `kyc_rejected_reason` (migration 016:11-12, :24, measured
--   1411 PENDING / 786 VERIFIED). This is the merchant equivalent, with the
--   project's smaller vocabulary — a storefront either trades or it does not.
--   Fail-closed by default: the column DEFAULT is 'PENDING', so a registration
--   path that forgets to declare the state gets the non-serviceable one. The two
--   fixture helpers that insert merchants directly were updated in the same
--   change to write 'APPROVED' explicitly, because "invisible" is the correct
--   outcome for an unapproved store and the wrong outcome for a test fixture.
--
-- WHAT THE BACKFILL DOES AND DOES NOT CLAIM:
--   The 83 pre-existing rows are grandfathered to 'APPROVED' inside the same
--   transaction that adds the column. Replacing them with 'PENDING' would have
--   silently closed every live storefront in the store — that is an owner
--   decision about existing partners, not a side effect a migration is entitled
--   to take. `approval_decided_by` and `approval_decided_at` are deliberately
--   left NULL for those rows: no administrator decided them, and stamping a fake
--   decision onto 83 stores would replace one fabrication with a worse one.
--   Every store registered from now on gets its decision columns written by the
--   admin approval route, or not at all.
--
-- IDEMPOTENT BY NECESSITY: apply_local_migration.js submits this whole file as a
-- single query, and re-running the backfill would demote stores an admin approved
-- in between, so the ALTER/UPDATE block is guarded on the column's absence.
-- =========================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'merchants'
      AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE merchants
      ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      ADD COLUMN approval_decided_at TIMESTAMPTZ,
      ADD COLUMN approval_decided_by VARCHAR(150),
      ADD COLUMN approval_reason TEXT;

    ALTER TABLE merchants
      ADD CONSTRAINT merchants_approval_status_check
      CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));

    -- Pre-gate storefronts keep trading; see "WHAT THE BACKFILL DOES AND DOES NOT CLAIM".
    UPDATE merchants SET approval_status = 'APPROVED' WHERE approval_status = 'PENDING';
  END IF;
END $$;

-- The queue an administrator works from, and the predicate every customer-facing
-- read now needs. Mirrors `idx_drivers_kyc_status` (migration 016:24).
CREATE INDEX IF NOT EXISTS idx_merchants_approval_status
  ON merchants (approval_status);

-- Read control at the durable level, not only in the route handlers.
--
-- Every path that can take an order, and every merchant write route, is gated in
-- application code as well (server.js `requireMerchantApproved`, and the approval
-- check that precedes the closure gates on `POST /api/customer/book-food` and
-- `POST /api/grocery/checkout/validate`) because `service_role` bypasses RLS and
-- that is what the backend connects as. This policy is the layer underneath: a
-- reader that is not presenting an auth claim can no longer see a storefront the
-- platform has not approved.
DROP POLICY IF EXISTS "Public read active merchants" ON merchants;
CREATE POLICY "Public read active merchants"
  ON merchants FOR SELECT
  USING (is_open = true AND approval_status = 'APPROVED');
