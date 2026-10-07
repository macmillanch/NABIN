-- =============================================================================
-- NABIN MIGRATION 035: One account per email address
-- =============================================================================
-- Scope: ONE partial unique index on the existing `users.email` column. Nothing is
-- dropped, renamed, backfilled or added. No existing row loses a value and no row
-- gains one, so the migration is a no-op against the data it touches.
--
-- Why it is needed now: `PATCH /api/customer/profile` lets a customer write their own
-- `users.email`. Before this file the column had no uniqueness rule at all
-- (`email VARCHAR(150)` — 001_central_schema.sql:19) and nothing in the backend read it
-- before writing, so two accounts could hold the same address. An email address is how
-- NABIN would identify a customer in any message it ever sends, so an address held
-- twice is an address that can be pointed at the wrong person.
--
-- What the local dev database actually holds (measured 2026-10-07, read-only, before
-- this index was written). Every number below is a count, not a claim:
--
--   users rows                                      231
--   email IS NULL                                   190   <- the common case, by far
--   email is non-null                               41
--   email = '' or whitespace-only                    0
--   exact duplicate email groups                     0
--   lower(trim(email)) duplicate groups              0
--   email longer than the column's 150 characters    0
--   name  longer than the column's 100 characters    0
--   stored emails already lowercase                  41 of 41
--
-- So the index builds against the data as it stands: there is no duplicate to resolve,
-- no value to truncate, and nothing to backfill. Had a duplicate group existed, the
-- correct move was a data decision about which account keeps the address — not a
-- migration that quietly deletes one — and this file would not exist.
--
-- Three deliberate choices in the predicate, each forced by the rows above:
--
--   1. PARTIAL (`WHERE ... IS NOT NULL AND btrim(email) <> ''`) rather than a plain
--      UNIQUE constraint. 190 of 231 accounts have no email, because sign-in is
--      phone-and-OTP and `users.email` is left empty until the customer states one
--      (or the identity submission carries it). A plain UNIQUE would still permit
--      repeated NULLs, but it would refuse a second empty-string email, and `''` is a
--      value the profile route can write — so the empty value stays out of the rule and
--      means "not stated", exactly like NULL.
--
--   2. `lower(btrim(email))`, not the bare column. The profile route normalises to
--      lowercase before writing, so the DB must not be the place where `A@b.com` and
--      `a@b.com` are two different mailboxes: those are one address, and a uniqueness
--      rule that misses it is not a rule. Trimming is the same argument in whitespace.
--      Both functions are IMMUTABLE, which is what makes the expression index legal.
--
--   3. An index, not a `CHECK`. A CHECK would be wrong here — uniqueness is a
--      statement about other rows, not about the row itself.
--
-- This is the whole migration. No RLS change: `users` is reached by the backend through
-- the service-role client, which bypasses RLS by design (§2.1), so the field-level
-- allowlist in `customerProfileDomain` — not a policy — is what keeps a profile edit
-- from writing `wallet_balance` or `account_status`.
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uniq
    ON public.users (lower(btrim(email)))
    WHERE email IS NOT NULL AND btrim(email) <> '';

-- One string literal, not a `||` expression: `COMMENT ON ... IS` takes a single string
-- constant, and concatenation there is a syntax error (measured — the first attempt at
-- this file failed with `syntax error at or near "||"` and rolled back whole).
COMMENT ON INDEX public.users_email_lower_uniq IS
'Migration 035: one account per email address, compared case- and whitespace-insensitively. Accounts that have never stated an email (NULL, or empty after trimming) are outside the rule - 190 of 231 local rows were NULL when this was added. It backs the profile route''s own pre-check, so a concurrent write collides here rather than producing a second account with the same address.';
