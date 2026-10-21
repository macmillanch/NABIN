# NABIN — Staging Readiness Checklist & Operational Specification

**Document Reference**: `docs/NABIN_STAGING_READINESS_CHECKLIST.md`  
**Current Date**: 13 October 2026  
**Status**: AUTHORITATIVE — STAGING READINESS PACKAGE (PLANNING ONLY)  
**Execution Classification**: **PREPARATION ONLY — ZERO REMOTE CONNECTIONS OR BACKFILL MUTATIONS WITHOUT EXPLICIT SEPARATE OWNER AUTHORIZATION**  
**Target Environment**: Hosted Staging Cloud (`ywhxkzmbwppkdemvzlhv`, AWS Tokyo `ap-northeast-1`)  
**Git Baseline**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` on branch `main`  
**Current Recommendation**: **NO-GO FOR IMMEDIATE ROLLOUT; GO FOR SCHEDULED, OWNER-AUTHORIZED STAGING WINDOW**  

---

## 1. Executive Summary & Governance Boundaries

This document provides the authoritative, evidence-based staging-readiness specification for deploying and operating the NABIN financial ledger reconciler and related migrations (specifically Migrations 039 and 040).

### Strict Governance Constraints (Multi-Agent Governance & DECISIONS.md)
1. **Local/Offline Boundary**: All automated development and testing are strictly restricted to local loopback infrastructure (`127.0.0.1:54322`). AI agents are permanently prohibited from initiating remote network connections, applying migrations to hosted projects, generating owner signing keys, or executing financial backfills.
2. **Separation of Evidence**: Local test evidence is never conflated with hosted staging reality. Local candidate rows (572 records totaling ₹173,840.00) are local automated test artifacts and do not exist on staging.
3. **Append-Only Immutability**: The general ledger (`journal_transactions`, `journal_lines`) is strictly append-only. No SQL `UPDATE` or `DELETE` operations are permitted on financial tables. Historical test fixtures in the local database must never be deleted or purged.
4. **Provider Neutrality**: Payment provider selection remains pending an explicit owner decision. All systems operate in sandbox mode with zero live aggregator keys.
5. **Git Safety**: Working tree status, commit history, and branches must remain intact. Zero force pushes, hard resets, stashes, or unapproved commits.

---

## 2. Preconditions & Authorization Gates

Every staging deployment must pass through eight distinct verification gates. A failure at any gate halts the process immediately.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      STAGING AUTHORIZATION GATES                       │
├─────────┬──────────────────────┬───────────────────────────────────────┤
│ Gate 01 │ Git Checkpoint       │ Clean tree, HEAD == origin/main       │
│ Gate 02 │ Owner Authorization  │ Explicit written window approval      │
│ Gate 03 │ Credential Isolation │ Staging pooler password in env only   │
│ Gate 04 │ Target Guard Audit   │ Verified ref: ywhxkzmbwppkdemvzlhv    │
│ Gate 05 │ TLS Pinned CA Anchor │ Supabase Root 2021 CA verified        │
│ Gate 06 │ Logical Backup Dump  │ Full pre-migration pg_dump verified   │
│ Gate 07 │ Migration Delta Read │ Remote schema_migrations queried      │
│ Gate 08 │ Two-Stage Approval   │ Offline Ed25519 signature on manifest │
└─────────┴──────────────────────┴───────────────────────────────────────┘
```

### Detailed Gate Definitions:
- **Gate 01 (Git Checkpoint)**:
  - Working tree must be clean.
  - `git rev-parse HEAD` must match `git rev-parse origin/main` (`a48c0793e82eb5eb47ef779b84f63a0c285fc15d`).
- **Gate 02 (Owner Authorization)**:
  - Explicit written user/owner approval specifying the exact scheduled deployment window and operational scope.
- **Gate 03 (Credential Isolation)**:
  - Staging database pooler password obtained securely from Supabase Dashboard.
  - Password must never appear in command-line arguments, shell history, chat output, or committed files.
- **Gate 04 (Target Guard Audit)**:
  - Target must match `ywhxkzmbwppkdemvzlhv` (AWS Tokyo).
  - Target guard (`reconcilerSecurity.js`, `with_staging_target.js`) must audit environment variables and reject any production reference (`ouxvqmhuyueklnegvmxe`).
- **Gate 05 (TLS Pinned CA Anchor)**:
  - Strict TLS verification (`rejectUnauthorized: true`) using pinned `backend/certs/supabase-root-2021-ca.pem`.
  - Bypasses (`DATABASE_SSL=disable|no-verify|insecure`) fail closed immediately.
- **Gate 06 (Logical Backup Dump)**:
  - Verified pre-migration `pg_dump` taken by the human operator before executing DDL.
- **Gate 07 (Migration Delta Read)**:
  - Read-only inspection of remote `supabase_migrations.schema_migrations` to record exact unapplied migrations.
- **Gate 08 (Two-Stage Human Approval)**:
  - Offline review of deterministic dry-run manifest.
  - Out-of-band signature generation using owner's offline private key; valid Ed25519 signature file supplied via `--approval-file`.

---

## 3. Migration Inventory, Dependencies & Gap Analysis (001–040)

The repository contains exactly **38 migration files** under `supabase/migrations/`.

```
001_central_schema.sql
002_finance_ledger_schema.sql
003_extended_schema.sql
004_missing_entities_schema.sql
005_jobs_domain.sql
006_payments_domain.sql
007_wallets_domain.sql
008_support_domain.sql
009_promotions_domain.sql
010_admin_audit_domain.sql
011_geofences_surge_domain.sql
012_notifications_domain.sql
013_checkout_domain.sql
014_dispatch_domain.sql
015_school_child_domain.sql
016_driver_kyc_payout_and_partial_refund.sql
[Gap 1: Migration 017 ABSENT — Reverted unauthorized Phase 18 attempt; DEC-009]
018_order_state_lines_and_checkout_linkage.sql
019_order_creation_atomic.sql
020_dispatch_security_atomic.sql
021_cross_domain_security_hardening.sql
022_notifications_support_dispute_security.sql
023_financial_ledger_security_hardening.sql
024_application_surface_security_hardening.sql
025_feature_control_system.sql
026_backend_session_persistence.sql
027_dynamic_campaigns_and_themes.sql
[Gap 2: Migration 028 ABSENT — Intentionally skipped numbering; non-existent]
029_geo_and_commerce_reads_service_role_only.sql
030_merchant_inventory_integrity.sql
031_dark_store_foundation.sql
032_operator_permissions_store.sql
033_privileged_delete_returns_old.sql
034_restaurant_discovery_metadata.sql
035_customer_profile_email_uniqueness.sql
036_restaurant_catalog_persistence_and_variants.sql
037_order_creation_customization_snapshot_atomic.sql
038_order_creation_checkout_status_fix.sql
039_atomic_double_entry_capture_and_refund.sql
040_reconciliation_audit_nonces.sql
```

### Detailed Migration Delta & Ordering Requirements

| Migration File | Key Tables / Functions Created or Modified | Dependency Prerequisites | Safety & Idempotency Notes |
| :--- | :--- | :--- | :--- |
| **001–016** | Core schema, ledger accounts, jobs, payments, wallets, driver KYC | None (Base schema) | Immutable baseline per DEC-007 and DEC-008. |
| **017** | **ABSENT** | N/A | **DO NOT CREATE OR APPLY**. Formally deleted per DEC-009. |
| **018–027** | Orders, atomic order creation, dispatch security, RLS hardening, feature flags, sessions, campaigns | Migrations 001–016 | Each migration executes inside its own transaction via `migrate.js`. |
| **028** | **ABSENT** | N/A | **DO NOT CREATE OR APPLY**. Number was skipped. |
| **029–038** | Service-role tightening, inventory locks, operator permissions, catalog snapshots, checkout fixes | Migrations 018–027 | Contains transactional DDL with `IF NOT EXISTS` guards. |
| **039** | `capture_payment_atomic`, `refund_payment_atomic`, drops legacy 6-arg refund overload | Migrations 002, 006, 016 | **Critical Financial Bridge**: Unifies Book 1 (`ledger_entries`) and Book 2 (`journal_transactions` + `journal_lines`). Enforces balanced entries. Drops legacy overload to eliminate `PGRST203`. Revokes `PUBLIC, anon, authenticated`; grants `service_role`. |
| **040** | `reconciliation_audit_nonces` table, index, check constraint | Core PostgreSQL types | **Durable Replay Protection**: Stores consumed nonces with manifest digest, target, and PID. Enables RLS. Revokes `ALL` from `PUBLIC, anon, authenticated`; grants `SELECT, INSERT` to `service_role`. |

---

## 4. TLS & Database Target Identity Verification

Before opening any database connection or executing queries, the runtime enforces five levels of target validation:

```
┌────────────────────────────────────────────────────────────────────────┐
│                     TARGET VERIFICATION DEFENSE-IN-DEPTH               │
├────────────────────────────────────────────────────────────────────────┤
│ Level 1: Out-of-band Environment Guard (with_staging_target.js)       │
│ Level 2: Reconciler Target Pre-flight (reconcilerSecurity.js)          │
│ Level 3: Database TLS Policy & Pinned CA Verification (dbTls.js)       │
│ Level 4: In-Band Catalog & Session Introspection                       │
│ Level 5: Baseline Migration Assertion                                  │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Production Reference Denial**:
   - Rejects `ouxvqmhuyueklnegvmxe` in connection strings, environment variables (`NABIN_SUPABASE_REF`, `SUPABASE_URL`, `DATABASE_URL`), and CLI flags.
2. **Staging Hostname & Port Enforcement**:
   - Staging host must match `/^aws-0-ap-northeast-1\.pooler\.supabase\.com$/i` or `/^db\.ywhxkzmbwppkdemvzlhv\.supabase\.co$/i`.
   - Port must be sanctioned: `5432` (session pooler/direct) or `6543` (transaction pooler). Port `5433` or arbitrary ports throw `UNAPPROVED_STAGING_PORT`.
3. **Pinned CA Certificate Verification**:
   - Pinned Root CA: `backend/certs/supabase-root-2021-ca.pem`.
   - Fingerprint: `80:70:25:AD:D3:58:19:D4:6C:C1:CE:A6:4C:E6:3B:56:40:96:49:DE:C2:5F:8F:AE:D6:7A:DE:FE:F3:19:64:1F`.
   - Subject: `CN=Supabase Root 2021 CA, O=Supabase Inc, L=New Castle, ST=Delware, C=US`.
   - TLS bypasses (`DATABASE_SSL=disable`, `no-verify`, `insecure`, `false`) throw `DATABASE_TLS_BYPASS_REFUSED`.
4. **In-Band Catalog Identity Validation**:
   - Executes `SELECT current_database(), current_user, inet_server_addr();`.
   - Verifies database name is `postgres`.
   - Verifies user begins with `postgres` (or `postgres.ywhxkzmbwppkdemvzlhv`).
5. **In-Band Baseline Migration Check**:
   - Verifies that Migration 039 is recorded in `supabase_migrations.schema_migrations` or present in `pg_proc`.

---

## 5. Effective Database Privileges & RLS Checks

### Procedural Security Matrix
All financial stored procedures must enforce least privilege:

| Function / Resource | Anonymous (`anon`) | Authenticated (`authenticated`) | Service Role (`service_role`) | Admin / Postgres (`postgres`) |
| :--- | :---: | :---: | :---: | :---: |
| `capture_payment_atomic` | **REVOKED (42501)** | **REVOKED (42501)** | **GRANTED (EXECUTE)** | **GRANTED (EXECUTE)** |
| `refund_payment_atomic` | **REVOKED (42501)** | **REVOKED (42501)** | **GRANTED (EXECUTE)** | **GRANTED (EXECUTE)** |
| `adjust_wallet_atomic` | **REVOKED (42501)** | **REVOKED (42501)** | **GRANTED (EXECUTE)** | **GRANTED (EXECUTE)** |
| `reconciliation_audit_nonces` | **REVOKED (ALL)** | **REVOKED (ALL)** | **SELECT, INSERT** | **ALL PRIVILEGES** |
| `journal_transactions` | **REVOKED (ALL)** | **REVOKED (ALL)** | **SELECT, INSERT** | **ALL PRIVILEGES** |
| `journal_lines` | **REVOKED (ALL)** | **REVOKED (ALL)** | **SELECT, INSERT** | **ALL PRIVILEGES** |
| `ledger_accounts` | **REVOKED (W)** | **REVOKED (W)** | **SELECT** | **ALL PRIVILEGES** |

### Row Level Security (RLS) Assertions:
1. `ALTER TABLE public.reconciliation_audit_nonces ENABLE ROW LEVEL SECURITY;`
2. `journal_transactions` and `journal_lines` must have RLS active with strict policies preventing direct client manipulation.
3. The append-only trigger `trg_prevent_financial_row_mutation` must be active on both `journal_transactions` and `journal_lines` (`BEFORE UPDATE OR DELETE`), preventing historical data deletion or alteration.

---

## 6. Backup & Recovery Requirements

Before modifying any hosted database schema or executing any backfill, the human operator must guarantee complete recoverability:

1. **Pre-Migration Logical Backup**:
   ```bash
   # Run via pg_dump using the pinned TLS connection:
   pg_dump -h aws-0-ap-northeast-1.pooler.supabase.com \
           -p 5432 \
           -U postgres.ywhxkzmbwppkdemvzlhv \
           -d postgres \
           -F c \
           -b \
           -v \
           -f "nabin-db-backups/staging-pre-migration-039-$(date +%Y%m%d%H%M%S).dump"
   ```
2. **Backup Validation**:
   - Confirm backup file size is greater than 0 bytes.
   - Run `pg_restore --list <dump_file>` to confirm header and table of contents are valid.
3. **Emergency Schema Rollback Scripts**:
   - If Migration 039 fails during rollout, `migrate.js` automatically issues a transaction `ROLLBACK`.
   - If Migration 039 must be rolled back post-commit, execute approved rollback SQL dropping updated overloads and restoring baseline definitions from Migration 016.
4. **Financial Invariant Preservation**:
   - If backfill fails during execution, transaction `ROLLBACK` removes all proposed headers, lines, and nonces.
   - If an error occurs post-commit, **NEVER DELETE ROWS**. Compensating journal transactions must be created.

---

## 7. Dry-Run Manifest Review & Candidate Reconciliation Checks

### Manifest Generation & Cryptographic Binding
A dry-run scan must always be run first via:
```bash
node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --target=staging --dry-run --report-out=staging-dryrun-report.json
```

1. **Engine-Level Read-Only Transaction**:
   - Wraps scan in `BEGIN TRANSACTION READ ONLY;` and always concludes with `ROLLBACK;`. Zero database mutations.
2. **Candidate Mapping Criteria**:
   - Scans Book 1 (`ledger_entries`) where no corresponding Book 2 entry exists in `journal_transactions`.
   - Validates that amount is strictly positive and parses to exact integer paise with scale $\le 2$. Prohibits scientific notation, partial strings, and values exceeding `NUMERIC(14, 2)`.
   - Validates debit and credit account codes against active chart of accounts (`ledger_accounts`).
   - Categorizes entries: `PAYMENT_CAPTURE`, `DISPUTE_REFUND`, or `SETTLEMENT`.
3. **Deterministic SHA-256 Manifest Digest**:
   - Binds 9 canonical accounting fields for every candidate entry:
     `entry_id | job_id | reference_id | category | debit_account | credit_account | amount | currency | created_at`
   - Candidates are sorted deterministically by `created_at ASC, entry_id ASC`.
   - Generates a 64-character hex SHA-256 digest (`manifestDigest`).
4. **Quarantine Handling**:
   - Any record with an invalid amount, unsupported currency (non-`INR`), unknown account, or missing identifier is placed in `quarantinedEntries`.
   - **Fail-Closed Gate**: If `quarantinedEntries.length > 0`, execution is strictly blocked until an operator reviews the anomalies.

---

## 8. Idempotency, Conflict Classification & Interrupted-Commit Handling

### Durable Database Nonce Replay Protection
- Nonce is inserted into `reconciliation_audit_nonces` inside the same database transaction as the candidate backfill writes.
- Primary key constraint on `nonce` guarantees that any attempt to replay an approval artifact is immediately rejected with PostgreSQL error `23505 (unique_violation)`.

### Transaction-Scoped Advisory Locking
- Backfill transaction executes:
  ```sql
  SET LOCAL lock_timeout = '5s';
  SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;
  ```
- Non-blocking: fails in $< 500\text{ms}$ if another process holds the lock.
- Transaction-scoped: automatically released on commit or rollback; leaves zero dangling locks on connection disconnect.

### Explicit Conflict Classification
- The reconciler replaces silent `ON CONFLICT DO NOTHING` with deep conflict verification:
  - When an idempotency key (`recon_<entry_id>`) already exists, the reconciler queries the existing journal header and both lines.
  - Verifies that `total_debit`, `total_credit`, `category`, `reference_id`, and line-level accounts and amounts match the candidate exactly.
  - If existing data diverges from the candidate, it throws `IDEMPOTENCY_CONFLICT_ANOMALY` and rolls back the entire batch.

### Interrupted Commit & Ambiguity Resolution
- In the event of a network drop or socket timeout during `COMMIT`, the operator or recovery probe must invoke `verifyAmbiguousCommitOutcome`:
  1. Validates the intended target identity.
  2. Queries `reconciliation_audit_nonces` for the approval nonce.
  3. Queries `journal_transactions` for candidate idempotency keys (`recon_%`).
  4. **Strict Safety Rule**: Nonce absence alone **never** proves rollback. Rollback is confirmed only if both the nonce and all candidate journal headers and lines are completely absent.
  5. Any partial state or connection ambiguity returns `AMBIGUOUS_REQUIRES_MANUAL_REVIEW`.

---

## 9. Historical Local Test Fixtures Documentation

The local Docker PostgreSQL database (`127.0.0.1:54322`) contains historical synthetic fixtures created during early harness test passes:

### Fixture Inventory (Local Only):
1. **Historical Test Transactions (3 rows)** in `journal_transactions` and 6 lines in `journal_lines`:
   - `txn_existing_probe_1791859018377` (idempotency key: `recon_existing_probe_1791859018377`)
   - `txn_existing_probe_1791859509848` (idempotency key: `recon_existing_probe_1791859509848`)
   - `txn_existing_probe_1791859559975` (idempotency key: `recon_existing_probe_1791859559975`)
2. **Historical Test Nonces (2 rows)** in `reconciliation_audit_nonces`:
   - `TEST_IDEM_NONCE_1_1791858102887`
   - `TEST_IDEM_NONCE_2_1791858102923`

### Preservation & Accounting Guarantees:
- **Strict Non-Deletion Policy**: In accordance with DEC-003, DEC-004, and financial audit rules, these records must **never be deleted or altered**.
- **Namespace Isolation**: Genuine candidate entries use IDs formatted as `recon_LEDG-<uuid>`. Synthetic test fixtures use the distinct namespace `recon_existing_probe_*` and `TEST_*`.
- **Zero Collision Impact**: The reconciler only selects entries present in `ledger_entries` (Book 1). Because no Book 1 entry exists for `existing_probe_*`, these rows are ignored during reconciliation scans and cannot collide with live Book 1 entries.
- **Hosted Staging Separation**: These rows exist exclusively in the local Docker database container. They do not exist on hosted staging.

---

## 10. Proposed 4-Stage Staging Execution Sequence

The operational sequence strictly decouples read-only inspection, schema migration, dry-run manifest review, and financial backfill execution.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      STAGING EXECUTION SEQUENCE                        │
├────────────────────────────────────────────────────────────────────────┤
│  STAGE 1: Read-Only Staging Inspection & Baseline Audit               │
│     │                                                                  │
│     ▼ (Gate: Baseline version verified, credentials valid)            │
│  STAGE 2: Migration Application (039 & 040)                            │
│     │                                                                  │
│     ▼ (Gate: 039/040 recorded, RPC grants verified)                    │
│  STAGE 3: Read-Only Dry-Run Manifest Generation & Review               │
│     │                                                                  │
│     ▼ [STOP GATE: EXPLICIT OWNER AUTHORIZATION & ED25519 SIGNATURE]    │
│  STAGE 4: Authorized Financial Backfill Execution (Separate Approval)  │
└────────────────────────────────────────────────────────────────────────┘
```

### Stage 1: Read-Only Staging Inspection & Baseline Audit
*Mode: Pure read-only. Zero mutations.*
1. Human operator securely fills `DATABASE_URL` pooler password in `backend/.env.staging`.
2. Run target verifier:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/verify_hosted_test_env.js
   ```
   *Expected*: `✅ PASS: Environment is safely and correctly configured for Hosted TEST`.
3. Inspect remote migration ledger:
   ```bash
   node backend/scripts/with_staging_target.js node -e "
     const { Client } = require('pg');
     const { sslConfig } = require('./backend/src/services/dbTls');
     (async () => {
       const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: sslConfig(process.env.DATABASE_URL) });
       await client.connect();
       const { rows } = await client.query('SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version ASC;');
       console.log('Applied migrations count:', rows.length);
       console.table(rows);
       await client.end();
     })();
   "
   ```
4. Verify remote table grants and RPC signatures:
   - Confirm current definitions of `capture_payment_atomic` and `refund_payment_atomic`.
   - Confirm baseline candidate count in Book 1 (`ledger_entries`) vs Book 2 (`journal_transactions`).

### Stage 2: Migration Application (Migrations 039 & 040)
*Mode: Schema DDL under advisory lock. One transaction per file.*
1. Human operator takes pre-migration `pg_dump` backup (Gate 06).
2. Execute migration runner through the staging harness:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/migrate.js
   ```
3. Verify post-migration state:
   - Confirm `039_atomic_double_entry_capture_and_refund` and `040_reconciliation_audit_nonces` are recorded in `supabase_migrations.schema_migrations`.
   - Confirm `capture_payment_atomic` and `refund_payment_atomic` EXECUTE is revoked from `PUBLIC, anon, authenticated` and granted to `service_role`.
   - Confirm table `public.reconciliation_audit_nonces` exists with RLS enabled.

### Stage 3: Read-Only Dry-Run Manifest Generation & Review
*Mode: Read-only transaction. Zero mutations.*
1. Execute dry-run scan against staging:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --target=staging --dry-run --report-out=staging-dryrun-report.json
   ```
2. Inspect dry-run report output:
   - Confirm `target: "staging"`.
   - Confirm `projectRef: "ywhxkzmbwppkdemvzlhv"`.
   - Record `candidateCount`, `totalDebit`, `totalCredit`, and `manifestDigest`.
   - Verify `quarantinedCount === 0`.
3. **STOP GATE**: The dry-run report and manifest digest are submitted to the project owner for formal review. **NO FURTHER AUTOMATED ACTION OCCURS.**

### Stage 4: Authorized Financial Backfill Execution (SEPARATE OWNER APPROVAL REQUIRED)
*Mode: Atomic execution under transaction advisory lock and Ed25519 signature verification.*
> [!CAUTION]
> **Stage 4 requires separate, explicit written authorization from the project owner.**
> It must never be combined with Stages 1, 2, or 3.
1. Project owner verifies `staging-dryrun-report.json` offline.
2. Project owner signs the canonical payload using their offline Ed25519 private key:
   `APPROVAL|FINANCIAL_LEDGER_BACKFILL_EXECUTE|staging|ywhxkzmbwppkdemvzlhv|<manifestDigest>|<nonce>|<candidateCount>|<totalAmount>|<issuedAtMs>|<expiresAtMs>|<ownerPubKeyId>`
3. Approval artifact is saved to `staging-approval.json` with TTL $\le 60\text{ minutes}$.
4. Human operator invokes execution:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --target=staging --execute --approval-file=staging-approval.json --report-out=staging-execute-report.json
   ```
5. Confirm execution result:
   - Verify `insertedHeaders === candidateCount`.
   - Verify `insertedLines === candidateCount * 2`.
   - Verify post-backfill check reports `unbalanced_count === 0` and `invalid_account_count === 0`.
   - Verify nonce is committed to `reconciliation_audit_nonces`.

---

## 11. Post-Migration Validation & Fail-Closed Stop Conditions

### Fail-Closed Emergency Halt Triggers
An operator must **immediately abort and issue a halt report** if any of the following occur:
1. `verify_hosted_test_env.js` reports non-zero exit or `PENDING CREDENTIALS`.
2. The detected project ref is not `ywhxkzmbwppkdemvzlhv`, or a production indicator is found.
3. Pre-migration backup fails or produces an empty file.
4. Any missing migration file is discovered that is not intentionally absent (only 017 and 028 are expected gaps).
5. `migrate.js` reports an unhandled SQL exception or connection loss.
6. Post-migration security queries report `anon` or `authenticated` have `EXECUTE` on financial procedures.
7. Reconciliation dry-run reports any quarantined records (`quarantinedCount > 0`).
8. Live candidate drift is detected during backfill execution (`CANDIDATE_SET_DRIFT_DETECTED`).
9. Advisory lock `nabin_reconciliation_backfill_lock` cannot be acquired within 5 seconds.
10. Ambiguous commit outcome resolution cannot confirm complete rollback.

---

## 12. Credential Isolation & Operator Security Rules

1. **Zero Hardcoded Secrets**: No database passwords, JWT tokens, or private keys in source code, Markdown files, or git commits.
2. **Interactive Variable Input**: Operators must use interactive non-echoing inputs or temporary restricted credential stores:
   ```bash
   read -s -p "Enter Staging Database Pooler Password: " STAGING_PG_PASS
   export DATABASE_URL="postgresql://postgres.ywhxkzmbwppkdemvzlhv:${STAGING_PG_PASS}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres"
   unset STAGING_PG_PASS
   ```
3. **Log Sanitization**: Terminal output, CI logs, and test artifacts must strictly redact connection credentials and private keys. The reconciler target guard automatically redacts user credentials in all error messages.
