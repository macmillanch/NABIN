# NABIN — AUTHORITATIVE FINANCIAL RECONCILER INTEGRATION PLAN

**Document Version**: 1.1.0  
**Planning Mode**: **STRICTLY LOCAL PLANNING AND INSPECTION ONLY**  
*Zero network connections, zero migrations, zero financial backfills, and zero mutations to database records or application code.*

---

## 1. Executive Summary & Objective

This document defines the implementation-ready architecture and integration plan for wiring [backend/src/services/reconcilerSecurity.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js) into [backend/scripts/reconcile_double_entry_ledger.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/reconcile_double_entry_ledger.js).

The objective is to replace the current script's rudimentary checks with:
1. Strict, zero-trust target validation (`--target=local` vs. `--target=staging`) rejecting production targets, unapproved schemes, and non-standard ports.
2. Pinned TLS enforcement via [backend/src/services/dbTls.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/dbTls.js) with fail-closed CA certificate fingerprint validation.
3. Multi-layered target identity verification treating in-band catalog probes as defense-in-depth rather than standalone proof of environment.
4. Engine-level read-only isolation (`BEGIN TRANSACTION READ ONLY;`) for dry-run scans.
5. Deterministic dry-run manifest report generation binding all 9 financial accounting attributes.
6. A two-stage owner authorization gate requiring an out-of-band Ed25519 digital signature verified against an independently configured owner public key (`NABIN_RECONCILER_OWNER_PUBLIC_KEY`).
7. **Durable, database-backed nonce replay protection** using transaction-scoped advisory locking and a unique constraint table surviving process restarts and concurrent execution attempts.
8. Rigorous conflict classification replacing silent `ON CONFLICT DO NOTHING` drops with explicit row-count and post-write assertions.
9. Full-tuple live candidate set revalidation with zero drift tolerance immediately before write commit.

---

## 2. Current Architecture vs. Target Integrated Call Flow

### Current Script Architecture (`reconcile_double_entry_ledger.js`)
Inspection of `reconcile_double_entry_ledger.js` reveals critical gaps:
- **Target Verification**: Uses a crude substring check `dbUrl.includes('127.0.0.1') || dbUrl.includes('localhost')` (Lines 34–38).
- **Client Instantiation**: Instantiates `new Client({ connectionString: dbUrl })` (Line 40) with **no SSL configuration**, which would fail against hosted endpoints or leak credentials.
- **In-Band Verification**: Zero checks for connected database name, user identity, or Migration 039 baseline.
- **Dry-Run Isolation**: Queries execute in autocommit mode without an engine-level read-only transaction (Lines 45–80).
- **Report Output**: Outputs unstructured console logs without an immutable, deterministic SHA-256 manifest.
- **Silent Conflict Concealment**: Uses `ON CONFLICT (idempotency_key) DO NOTHING` followed by `if (jtInsert.rows.length === 0) continue;` (Lines 217–221). If an unexpected idempotency conflict occurs (e.g. differing amount or reference), the insert is silently dropped without error, concealing accounting anomalies.
- **Execution Gate**: Re-running with `--execute` directly opens `BEGIN` and writes rows without verifying human approval, signature validity, expiration, or candidate drift.

### Integrated Target Call Flow

```text
Operator / Automation
       │
       ▼
[CLI Arguments & Environment]
  --target=local | staging
  --dry-run | --execute
  --report-out=<path>
  --approval-file=<path>
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. TARGET PRE-FLIGHT VALIDATION                             │
│ validateTargetConfiguration({ target, dbUrl, env })         │
│ - Assert scheme: postgresql: / postgres:                    │
│ - Assert staging port: 5432 / 6543                          │
│ - Prohibit production ref 'ouxvqmhuyueklnegvmxe'            │
│ - Resolve TLS: rejectUnauthorized=true + Pinned CA Root     │
└─────────────────────────────────────────────────────────────┘
       │ (Pass)
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. SECURE CLIENT CONNECTION & IN-BAND PROBE                 │
│ client = new Client({ connectionString, ssl: tlsConfig })   │
│ verifyInBandDatabaseIdentity({ client, target })            │
│ - Query current_database() === 'postgres' (Defense-in-depth)│
│ - Query current_user === 'postgres.<ref>' | 'postgres'      │
│ - Query Migration 039 in schema_migrations catalog          │
└─────────────────────────────────────────────────────────────┘
       │ (Pass)
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. ENGINE-LEVEL READ-ONLY DRY-RUN SCAN                      │
│ BEGIN TRANSACTION READ ONLY;                                │
│ - Query active ledger_accounts                              │
│ - Query Book 1 (ledger_entries)                             │
│ - Query Book 2 (journal_transactions)                       │
│ - Classify: matched, proposed, quarantined                  │
│ ROLLBACK;                                                   │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. DETERMINISTIC MANIFEST COMPUTATION                       │
│ computeReportManifest(dryRunReport)                         │
│ - Normalize 9 fields: entry_id, amount, debit, credit,      │
│   category, reference_id, created_at, job_id, currency      │
│ - Sort by entry_id                                          │
│ - Compute SHA-256 hex digest                                │
│ - Emit immutable report JSON artifact with manifest digest  │
└─────────────────────────────────────────────────────────────┘
       │
       ├────────────────────────────────────────┐
       ▼ (If --dry-run)                         ▼ (If --execute)
[HALT: Report Artifact Generated]    ┌──────────────────────────────────────┐
                                     │ 5. PRE-EXECUTION AUTHORIZATION GATE  │
                                     │ - Read approval JSON artifact        │
                                     │ - Verify Ed25519 signature against   │
                                     │   NABIN_RECONCILER_OWNER_PUBLIC_KEY  │
                                     │ - Verify target & projectRef match   │
                                     │ - Verify operation match             │
                                     │ - Verify digest match                │
                                     │ - Verify candidateCount & totalDebit │
                                     │ - Verify issuedAtMs & expiresAtMs    │
                                     │ - Assert currentTimestamp < expiry   │
                                     └──────────────────────────────────────┘
                                                        │ (Authorized)
                                                        ▼
                                     ┌──────────────────────────────────────┐
                                     │ 6. ATOMIC WRITE TRANSACTION          │
                                     │ BEGIN;                               │
                                     │ - SET LOCAL lock_timeout = '5s';     │
                                     │ - pg_try_advisory_xact_lock(...)     │
                                     │ - INSERT nonce into audit table      │
                                     │   (fail closed on unique collision)  │
                                     │ - Re-scan live candidates & assert   │
                                     │   zero drift against reviewed report │
                                     │ - Insert journal_transactions        │
                                     │   (explicit conflict classification) │
                                     │ - Insert journal_lines               │
                                     │ - Assert row counts: headers & lines │
                                     │ - Run balance verification query     │
                                     │ COMMIT;                              │
                                     └──────────────────────────────────────┘
                                                        │
                                                        ▼
                                     [SUCCESS: Financial Backfill Complete]
```

---

## 3. Multi-Layered Target Identity Verification

A core design requirement is recognizing the limits of database catalog queries:
- In Supabase, every project database is named `postgres`. `SELECT current_database()` returning `'postgres'` confirms connection to a PostgreSQL engine, but **proves nothing about tenant identity**.
- Direct database connections connect as user `postgres` across both staging and production.
- Migration 039 will eventually exist in production once applied, so the presence of Migration 039 in `supabase_migrations.schema_migrations` does not uniquely prove staging.

### Five-Layer Target Identity Architecture
Target identity is proven through 5 strict, interdependent layers:

1. **Layer 1 — Explicit Command-Line Parameter**:
   The operator or harness must explicitly supply `--target=local` or `--target=staging`. The script rejects execution if `--target` is omitted or invalid (`INVALID_TARGET_PARAMETER`).
2. **Layer 2 — Process Execution Target Guard**:
   The command must be launched through the approved target wrapper ([with_local_target.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/with_local_target.js) or [with_staging_target.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/with_staging_target.js)), which isolates environment variables, strips cross-environment leakage, and refuses production references.
3. **Layer 3 — DSN Pre-Flight Whitelist & Production Blacklist**:
   [validateTargetConfiguration](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js#L56-L192) parses `DATABASE_URL` via WHATWG `URL`:
   - Whitelists schemes strictly to `postgresql:` and `postgres:` (`UNAPPROVED_DATABASE_SCHEME`).
   - Rejects any presence of `FORBIDDEN_PROD_REF` ('ouxvqmhuyueklnegvmxe') anywhere in URLs or environment (`PRODUCTION_TARGET_FORBIDDEN`).
   - Whitelists staging hostnames strictly to `aws-0-ap-northeast-1.pooler.supabase.com` and `db.ywhxkzmbwppkdemvzlhv.supabase.co` (`UNAPPROVED_STAGING_ENDPOINT`).
   - Whitelists staging ports strictly to `5432` and `6543` (`UNAPPROVED_STAGING_PORT`).
   - Whitelists staging usernames to `postgres.ywhxkzmbwppkdemvzlhv` (pooler) or `postgres` (direct) (`UNAPPROVED_STAGING_USER`).
4. **Layer 4 — Cryptographic Pinned TLS Certificate Verification**:
   Before credentials cross the socket, [dbTls.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/dbTls.js) enforces `rejectUnauthorized: true` with the pinned root CA certificate `supabase-root-2021-ca.pem`. The certificate's SHA-256 fingerprint is asserted against `EXPECTED_ROOT_SHA256` (`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`). Any fingerprint mismatch fails closed with `DATABASE_TLS_FINGERPRINT_MISMATCH`. Node's TLS client performs SNI hostname verification against the server's certificate SANs.
5. **Layer 5 — In-Band Catalog & Migration Baseline Attestation**:
   Immediately upon opening the client session, [verifyInBandDatabaseIdentity](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js#L193-L250) verifies `current_database() === 'postgres'`, session user format, and queries `supabase_migrations.schema_migrations` for version `039`.

**Fail-Closed Rule**: If any of these 5 layers fails or reports inconsistent data, execution halts immediately with zero database mutations.

---

## 4. Durable Nonce Replay Protection & Advisory-Lock Semantics

### The Need for Durable Storage
The in-memory `Set` in `reconcilerSecurity.js` is volatile:
- A terminated or restarted Node.js process starts with a clean memory heap, allowing an unexpired approval artifact to be executed again.
- Two concurrent Node.js processes cannot detect nonces consumed in the other's memory space.

### Minimum Database Schema (`reconciliation_audit_nonces`)
To provide durable replay protection surviving process restarts, crashes, and concurrency, a future migration must declare:

```sql
CREATE TABLE IF NOT EXISTS reconciliation_audit_nonces (
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
```

### Advisory-Lock Semantics (Transaction-Scoped vs Session-Scoped)
- **Correction**: `pg_advisory_xact_lock` is **transaction-scoped**, NOT session-scoped.
  - A *session-scoped* lock (`pg_advisory_lock`) persists until explicitly unlocked (`pg_advisory_unlock`) or the physical connection drops. If connections are pooled via PgBouncer or Supavisor, leaking a session lock wedges the pooler connection for future callers.
  - A *transaction-scoped* lock (`pg_advisory_xact_lock`) is automatically and deterministically released by PostgreSQL whenever the transaction completes, whether by `COMMIT` or `ROLLBACK`.
- **Concurrency & Timeout Handling**:
  To prevent concurrent runners from hanging indefinitely behind an existing run, the transaction must execute:
  ```sql
  SET LOCAL lock_timeout = '5s';
  SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;
  ```
  - If `acquired` returns `false`, another reconciler transaction holds the lock. The script immediately throws `CONCURRENT_RECONCILIATION_IN_PROGRESS` and aborts.
  - If competing processes attempt concurrent execution, exactly one acquires the lock; all others fail closed without blocking.

### Atomic Nonce Reservation & Crash Recovery
Within the same transaction block as the journal inserts:
```sql
INSERT INTO reconciliation_audit_nonces (
  nonce, manifest_digest, target, project_ref, operation, approved_by,
  candidate_count, total_amount, issued_at, expires_at, consumed_by_pid, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMMITTED');
```
- If the nonce was already committed in any previous run (even after a process restart or server reboot), PostgreSQL throws a unique constraint violation (`23505`).
- **Crash & Rollback Behavior**:
  If the process crashes, the network disconnects, or an error occurs during journal insertion, PostgreSQL executes `ROLLBACK`. The nonce reservation and all journal inserts roll back atomically. Zero partial rows exist.
- **Handling Ambiguous Commit Outcomes**:
  If the connection drops *during* the execution of `COMMIT` (client disconnects while server is writing commit record), the client cannot determine whether the commit completed.
  On subsequent invocation, the script performs an **Ambiguity Resolution Probe**:
  ```sql
  SELECT status, consumed_at FROM reconciliation_audit_nonces WHERE nonce = $1;
  ```
  - If found with `status = 'COMMITTED'`, the previous transaction completed successfully. The script verifies Book 2 journal consistency and reports completion without re-inserting.
  - If absent, the transaction rolled back. The operator can safely retry with the unconsumed approval artifact (provided `expiresAtMs` has not elapsed).

---

## 5. Idempotency, Insert Conflicts & Post-Write Assertions

### The Flaw of Silent `ON CONFLICT DO NOTHING`
The prototype script currently executes:
```sql
INSERT INTO journal_transactions (...) VALUES (...)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING id;
```
followed by: `if (jtInsert.rows.length === 0) continue;`
This pattern is **dangerous in financial accounting**:
1. If an existing `journal_transactions` row shares `idempotency_key = 'recon_' || entry_id` but has a **different amount, different reference, or different category**, `DO NOTHING` silently ignores the mismatch, skips line insertions, and reports success while omitting the candidate from the ledger.
2. In `journal_lines`, there is currently **no unique constraint** on `(journal_id, account_code, entry_type)`. If the header insertion were to conflict or skip improperly, inserting lines against a pre-existing header would corrupt historical double-entry totals.

### Explicit Conflict Classification Logic
In the hardened integration, conflicts must be explicitly audited and classified:
1. For each candidate in `proposed`:
   Attempt to insert the header:
   ```sql
   INSERT INTO journal_transactions (
     transaction_id, idempotency_key, category, job_id, total_debit, total_credit,
     description, reference_id, status, created_at
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'POSTED', $9)
   ON CONFLICT (idempotency_key) DO NOTHING
   RETURNING id;
   ```
2. If `RETURNING id` returns a row:
   Insert the debit and credit legs into `journal_lines`. Increment `insertedHeadersCount += 1`, `insertedLinesCount += 2`.
3. If `RETURNING id` returns 0 rows (Conflict Detected):
   **Do NOT silently continue.** Query the existing row:
   ```sql
   SELECT transaction_id, category, total_debit, total_credit, reference_id, status
   FROM journal_transactions WHERE idempotency_key = $1;
   ```
   - **Exact Prior Match Classification**: If `total_debit == candidate.amount`, `total_credit == candidate.amount`, `category == candidate.category`, `reference_id == candidate.reference_id`, and `status == 'POSTED'`:
     Verify that exactly 2 matching lines exist in `journal_lines` for this journal ID. If verified, increment `alreadyPostedCount += 1`.
   - **Unexpected Conflict Classification**: If ANY field diverges (mismatched amount, mismatched reference, unposted status, or missing lines):
     **IMMEDIATELY THROW `IDEMPOTENCY_CONFLICT_ANOMALY` AND ROLLBACK.**
     Do not proceed with any writes.

### Row-Count & Post-Write Integrity Assertions
Before `COMMIT`, the script must assert:
1. `insertedHeadersCount + alreadyPostedCount === dryRunReport.candidateCount`.
2. `insertedLinesCount === insertedHeadersCount * 2`.
3. Execute post-backfill verification query:
   ```sql
   SELECT 
     (SELECT count(*) FROM journal_transactions WHERE idempotency_key LIKE 'recon_%' AND total_debit != total_credit) AS unbalanced_count,
     (SELECT count(*) FROM journal_lines jl JOIN journal_transactions jt ON jl.journal_id = jt.id WHERE jt.idempotency_key LIKE 'recon_%' AND jl.account_code NOT IN (SELECT account_code FROM ledger_accounts)) AS invalid_account_count;
   ```
   Assert `unbalanced_count === 0` and `invalid_account_count === 0`.
   If either count is non-zero, execute `ROLLBACK` immediately.

### Catalog Constraints: Existing vs. Future
- **Existing in Database**:
  - `journal_transactions.transaction_id UNIQUE` (Migration 002)
  - `journal_transactions.idempotency_key UNIQUE` (Migration 002)
  - `journal_transactions CHECK (total_debit = total_credit)` (Migration 002)
- **Required in Future Migration**:
  - `reconciliation_audit_nonces (nonce PRIMARY KEY)` (To be declared in a future migration).

---

## 6. Transaction Sizing & Unverified Performance Claims

The previous report mentioned an estimated execution time of 15–35 ms for inserting 1,716 rows (572 transactions and 1,144 lines).

> [!WARNING]
> **UNVERIFIED PERFORMANCE ESTIMATE**:  
> The 15–35 ms figure is an **unverified theoretical estimate**. Transaction duration on hosted staging will depend on cloud pooler latency, PostgreSQL write-ahead log (WAL) synchronization, foreign key index checks on `journal_lines.journal_id`, and table triggers.  
> Performance must be **measured safely in local Docker PostgreSQL tests** prior to drawing conclusions. No hosted benchmarks or load tests may be executed without explicit authorization.

---

## 7. Detailed Integration Sequence

The execution workflow is structured into 6 formal phases:

```text
PHASE 1: Target Pre-Flight & Credential Attestation (Read-Only)
PHASE 2: In-Band Catalog & Migration Baseline Verification (Read-Only)
PHASE 3: Engine-Level Read-Only Dry-Run Scan (Read-Only)
PHASE 4: Deterministic Manifest Computation & Report Output (Read-Only)
PHASE 5: Out-of-Band Human Review & Ed25519 Cryptographic Signing (Owner Action)
PHASE 6: Authorized Backfill Execution & Atomic Commit (Write Transaction)
```

### Phase 1: Target Pre-Flight & Credential Attestation
- **Responsible Function**: `reconcilerSecurity.validateTargetConfiguration({ target, dbUrl, env })`
- **Mode**: Read-Only (Local memory).
- **Required Inputs**: CLI `--target` flag (`local` or `staging`), `process.env.DATABASE_URL`.
- **Security Checks**: Scheme whitelist, staging host whitelist, staging port whitelist (`5432`/`6543`), production reference prohibition (`ouxvqmhuyueklnegvmxe`), placeholder password rejection, pinned TLS configuration resolution via `dbTls.sslConfig`.
- **Failure Behavior**: Process exits with code `2` with redacted target message. Zero connections opened.

### Phase 2: In-Band Catalog & Migration Baseline Verification
- **Responsible Function**: `reconcilerSecurity.verifyInBandDatabaseIdentity({ client, target })`
- **Mode**: Read-Only.
- **Required Inputs**: Connected `pg.Client` instance, target name.
- **Security Checks**: `current_database() === 'postgres'`, session user matches expected pooler/direct user, Migration 039 exists in `supabase_migrations.schema_migrations`.
- **Failure Behavior**: Socket closed immediately. Process exits with code `2`.

### Phase 3: Engine-Level Read-Only Dry-Run Scan
- **Responsible Function**: `runDryRunReconciliationScan({ client })`
- **Mode**: Read-Only Transaction.
- **Database Boundary**:
  - `await client.query('BEGIN TRANSACTION READ ONLY;')`
  - Fetch active accounts: `SELECT account_code FROM ledger_accounts WHERE is_active = true`
  - Fetch Book 1: `SELECT * FROM ledger_entries ORDER BY created_at ASC, entry_id ASC`
  - Fetch Book 2: `SELECT * FROM journal_transactions`
  - Classify entries: `matched`, `proposed`, `quarantined`.
  - `await client.query('ROLLBACK;')`
- **Failure Behavior**: Transaction rolls back. Process aborts. Zero state mutated.

### Phase 4: Deterministic Manifest Computation & Report Output
- **Responsible Function**: `reconcilerSecurity.computeReportManifest(dryRunReport)`
- **Mode**: Read-Only (Local computation).
- **Required Inputs**: `dryRunReport` object containing normalized candidate array.
- **Normalization**: Every candidate is normalized to 9 attributes: `entry_id`, `amount`, `debit_account`, `credit_account`, `category`, `reference_id`, `created_at`, `job_id`, `currency`. Sorted by `entry_id`.
- **Output**: Deterministic SHA-256 hex digest. Writes report JSON artifact to `reports/reconciliation_dry_run_<target>_<timestamp>.json`.
- **Exit Condition**: If run in `--dry-run` mode, prints summary and digest, then exits with code `0`. **Never proceeds to writes.**

### Phase 5: Out-of-Band Human Review & Ed25519 Cryptographic Signing
- **Responsible Agent**: Platform Owner on secure administrative workstation.
- **Action**:
  1. Human owner inspects candidate manifest, categories, and totals in the dry-run report artifact.
  2. Asserts zero quarantined records exist (`quarantinedCount === 0`).
  3. Constructs approval payload binding:
     - `target`: exact target (`staging` or `local`).
     - `projectRef`: exact project reference (`ywhxkzmbwppkdemvzlhv`).
     - `operation`: `'FINANCIAL_LEDGER_BACKFILL_EXECUTE'`.
     - `manifestDigest`: exact SHA-256 digest from report.
     - `candidateCount`: exact candidate count.
     - `totalAmount`: exact total debit/credit amount.
     - `issuedAtMs`: current timestamp.
     - `expiresAtMs`: expiration timestamp (max 60m TTL).
     - `nonce`: random string (minimum 8 characters).
     - `approvedBy`: owner identity.
  4. Signs canonical payload using Ed25519 private key.
  5. Delivers signed JSON artifact to operator workstation.

### Phase 6: Authorized Backfill Execution & Atomic Commit
- **Responsible Function**: `executeAuthorizedBackfill({ client, target, approvalArtifact, dryRunReport })`
- **Mode**: Atomic Write Transaction.
- **Pre-Transaction Checks**: Calls `reconcilerSecurity.validateBackfillExecutionAuthorization()` asserting signature validity, non-expired window, exact bound parameters, and zero candidate drift.
- **Database Transaction Flow**:
  ```sql
  BEGIN;
  SET LOCAL lock_timeout = '5s';
  SELECT pg_try_advisory_xact_lock(hashtext('nabin_reconciliation_backfill_lock')) AS acquired;
  -- If acquired is false: THROW CONCURRENT_RECONCILIATION_IN_PROGRESS
  INSERT INTO reconciliation_audit_nonces (...) VALUES (...);
  -- Re-scan live candidates & assert zero drift
  -- Insert journal_transactions (with explicit conflict classification)
  -- Insert journal_lines
  -- Assert row counts and balance verification query
  COMMIT;
  ```
- **Failure Behavior**: On any failure, `ROLLBACK` executes. Script exits with code `1`.

---

## 8. Offline Adversarial Test Matrix

Prior to any live implementation, a dedicated hermetic test suite (`backend/reconciler_integration_harness_test.js`) must be executed against controlled mocks and local Docker PostgreSQL:

| Test ID | Test Scenario | Expected Outcome | Verification Assertion |
| :--- | :--- | :--- | :--- |
| **INT-01** | Concurrent execution attempt with identical nonce | Refused | `pg_try_advisory_xact_lock` returns false or throws `23505` (unique violation). |
| **INT-02** | Re-run approval after process restart | Refused | Query against `reconciliation_audit_nonces` rejects duplicate nonce. |
| **INT-03** | Immediate reuse of nonce in same process | Refused | Throws `APPROVAL_NONCE_REPLAYED` in memory & unique violation in DB. |
| **INT-04** | Failure during dry-run scan | Refused | Transaction rolled back; zero rows written. |
| **INT-05** | Failure during journal row insertion | Refused | Transaction rolled back; `reconciliation_audit_nonces` and journals rolled back. |
| **INT-06** | Candidate amount altered between dry-run & execute | Refused | Throws `CANDIDATE_SET_DRIFT_DETECTED` with specific field name. |
| **INT-07** | Candidate debit_account altered between dry-run & execute | Refused | Throws `CANDIDATE_SET_DRIFT_DETECTED` with specific field name. |
| **INT-08** | New candidate entry added to Book 1 before execute | Refused | Throws `CANDIDATE_SET_DRIFT_DETECTED` (count mismatch). |
| **INT-09** | Approval timestamp evaluated at exact expiration boundary | Refused | Throws `APPROVAL_WINDOW_EXPIRED`. |
| **INT-10** | Approval with forged or tampered Ed25519 signature | Refused | Throws `APPROVAL_SIGNATURE_INVALID`. |
| **INT-11** | Approval targeting local attempted against staging | Refused | Throws `APPROVAL_TARGET_MISMATCH`. |
| **INT-12** | Database URL pointing to production reference | Refused | Pre-flight check throws `PRODUCTION_TARGET_FORBIDDEN`. |
| **INT-13** | Database URL pointing to unapproved port 5433 | Refused | Pre-flight check throws `UNAPPROVED_STAGING_PORT`. |
| **INT-14** | Mismatched root CA certificate fingerprint | Refused | `dbTls` throws `DATABASE_TLS_FINGERPRINT_MISMATCH`. |
| **INT-15** | Post-backfill idempotency replay | Idempotent | Re-running scan finds 0 proposed candidates (`missingCategories: []`). |

---

## 9. Review of Plan Corrections & Unresolved Assumptions

### Summary of Corrections Applied in Version 1.1.0
1. **Advisory-Lock Semantics Corrected**: Replaced incorrect "session advisory lock" terminology with transaction-scoped `pg_try_advisory_xact_lock` and `SET LOCAL lock_timeout = '5s'`. Specified non-blocking acquisition, failure behavior, and automatic release on `COMMIT` or `ROLLBACK`.
2. **Target Identity De-coupled from Catalog Queries**: Acknowledged that `current_database() = 'postgres'` and user `postgres` are identical across Supabase tiers. Defined 5-layer identity architecture with pinned TLS and hostname allowlists as the primary cryptographic barrier.
3. **Idempotency & Silent `ON CONFLICT DO NOTHING` Removed**: Replaced silent skip with explicit conflict classification. Distinguishes exact already-posted entries from unexpected idempotency collisions (differing amounts or references), which fail closed and abort the transaction.
4. **Crash Recovery & Ambiguous Commits Defined**: Documented the Ambiguity Resolution Probe for handling network drops during `COMMIT`.
5. **Performance Claims Qualified**: Explicitly marked the 15–35 ms transaction duration as an **unverified estimate** that must be benchmarked locally before drawing conclusions.

### Unresolved Operational Assumptions (Pending Owner Actions)
1. **Owner Keypair Provisioning**: Platform Owner must generate an Ed25519 keypair out-of-band and configure `NABIN_RECONCILER_OWNER_PUBLIC_KEY` in staging.
2. **Staging Database Password**: Real pooler password must be configured in `backend/.env.staging` (currently unfilled template).
3. **Migration 039 Baseline on Staging**: Staging does not currently possess Migration 039; deployment window must be scheduled.
4. **Pre-Migration Staging Snapshot**: Manual Supabase Dashboard backup and logical `pg_dump` must be taken prior to staging execution.
5. **Payment Provider Neutrality**: Kept strictly separate; zero provider decisions made.

---

## 10. Files Affected in Future Implementation Task

When implementation is explicitly authorized, changes will be restricted to:
1. `supabase/migrations/040_reconciliation_audit_nonces.sql` *(NEW — durable nonce table)*
2. `backend/scripts/reconcile_double_entry_ledger.js` *(MODIFIED — wiring security helper)*
3. `backend/reconciler_integration_harness_test.js` *(NEW — adversarial test suite)*
4. `backend/scripts/test_chain.js` *(MODIFIED — test chain registration)*

---

## 11. Final Planning Verdicts

```text
========================================================================================
                               FINAL PLANNING VERDICTS
========================================================================================

1. Integration Plan Readiness:
   [GO]
   - The integration sequence, transaction-scoped advisory locking, multi-layer identity
     checks, durable PostgreSQL nonce table, explicit conflict classification, and
     15-case adversarial test plan are fully refined and implementation-ready.

2. Local Implementation Authorization:
   [HOLD]
   - Planning and inspection only. Implementation of the integration is held pending
     explicit owner authorization.

3. Hosted Staging Access:
   [NO-GO (BLOCKED)]
   - Zero remote access authorized. Blocked on owner deployment window and real staging
     pooler credentials.

4. Financial Backfill Execution:
   [NO-GO (STRICTLY PROHIBITED)]
   - Zero financial writes or backfills authorized. Blocked on staging migration 039,
     dry-run inspection, and owner-signed Ed25519 approval artifact.
========================================================================================
```
