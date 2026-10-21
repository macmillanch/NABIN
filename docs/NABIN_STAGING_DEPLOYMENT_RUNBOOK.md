# NABIN — STAGING DEPLOYMENT & VERIFICATION RUNBOOK
**Authoritative Operational Runbook for Staging Migration 039 & Financial Ledger Reconciliation**

- **Document Reference**: `docs/NABIN_STAGING_DEPLOYMENT_RUNBOOK.md`
- **Date**: 13 October 2026, 06:45 IST
- **Target Project**: Hosted Supabase Staging (`ywhxkzmbwppkdemvzlhv`, AWS Tokyo `ap-northeast-1`)
- **Git Baseline**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` on `main`
- **Execution Classification**: **PREPARATION-ONLY — STRICTLY PROHIBITED FROM REMOTE EXECUTION WITHOUT EXPLICIT SEPARATE OWNER AUTHORIZATION**
- **Current Rollout Recommendation**: **NO-GO FOR IMMEDIATE ROLLOUT**

---

## 1. PREFLIGHT PRINCIPLES & SCOPE OF THIS RUNBOOK

This document establishes the exact, repeatable operational procedure an authorized human operator must execute during a future, owner-approved staging window.

### Governing Constraints
1. **Zero Automated Remote Action**: AI coding agents are strictly forbidden from connecting to, executing migrations on, or querying hosted staging or production environments.
2. **Separation of Evidence**: Local automated test evidence on `127.0.0.1:54322` is never conflated with hosted staging reality. Staging state remains completely unverified until inspected by the operator.
3. **No Financial Deletions**: The general ledger (`journal_transactions`, `journal_lines`) is append-only. No SQL `UPDATE` or `DELETE` can occur. Any corrections require balanced compensating entries.
4. **Provider Neutrality**: Payment provider selection remains pending explicit owner decision. Sandbox mode remains active with zero live payment aggregator credentials.

---

## 2. LOCAL EVIDENCE VS. UNVERIFIED REMOTE ASSUMPTIONS

```
┌────────────────────────────────────────────────────────────────────────┐
│                   LOCAL REALITY VS. HOSTED ASSUMPTIONS                 │
├────────────────────────────────────────────────────────────────────────┤
│ Local Technical Implementation  : VERIFIED ON DOCKER POSTGRESQL        │
│ Dual-Book Ledger Consolidation  : VERIFIED (REC-01..REC-18 PASS)       │
│ Least-Privilege RPC Grants      : VERIFIED (REC-11 PASS)               │
│ Local Full Regression Chain     : PASS (72/72 links, 2,877 checks)     │
│ Hosted Staging Schema Baseline  : UNVERIFIED (Must query remote DB)    │
│ Hosted Staging Pooler Password  : BLOCKED (Unfilled template)          │
│ Hosted Staging Candidates       : UNKNOWN (0 assumed; local 572 != rem)│
│ Payment Aggregator Selection    : PENDING EXPLICIT OWNER SELECTION     │
└────────────────────────────────────────────────────────────────────────┘
```

| Dimension | Local Docker Reality (`127.0.0.1:54322`) | Hosted Staging Reality (`ywhxkzmbwppkdemvzlhv`) |
| :--- | :--- | :--- |
| **Migration Status** | Migration 039 applied; 37 migration files recorded in `schema_migrations`. | **Unapplied.** Remote baseline version is unknown. Operator must run Query Set A. |
| **Two-Book Ledger** | Consolidated: `capture_payment_atomic` and `refund_payment_atomic` write Book 1 and Book 2 atomically. | **Two-book divergence active.** Remote functions remain at earlier definitions. |
| **Reconciliation Data** | 572 candidates (₹173,840.00) proven to be local test residue and backfilled locally. | **Unmeasured.** Local test candidates **do not exist remotely**. Remote may have 0 entries. |
| **Stored RPC Grants** | `capture_payment_atomic` & `refund_payment_atomic` revoked from `PUBLIC, anon, authenticated`. | **Unverified.** Table-level and RPC-level grants remain uninspected on staging. |
| **Regression Status** | 72/72 links clean, exit code 0 (`chain_20261013_023614_76484_7e98e2`). | **Unrun.** Staging synthetic suite unrun pending valid database pooler credentials. |

---

## 3. PREFLIGHT CHECKLIST & FAIL-CLOSED STOP CONDITIONS

Before running any deployment commands, the operator must confirm every check item:

### Preflight Gates
- [ ] **Gate 01 (Git Checkpoint)**: Working tree is clean and `HEAD == origin/main` (`a48c0793e82eb5eb47ef779b84f63a0c285fc15d`).
- [ ] **Gate 02 (Owner Authorization)**: Explicit written approval received from project owner for staging deployment window.
- [ ] **Gate 03 (Credential Isolation)**: Database pooler password acquired securely via Supabase Dashboard; password is NOT stored in shell history or shared chat.
- [ ] **Gate 04 (Target Verification)**: Target is confirmed as `ywhxkzmbwppkdemvzlhv` (AWS Tokyo `ap-northeast-1`); production `ouxvqmhuyueklnegvmxe` is strictly prohibited.
- [ ] **Gate 05 (Logical Backup Confirmed)**: Pre-migration database backup completed and verified before any migration DDL is triggered.
- [ ] **Gate 06 (Remote Baseline Audited)**: Query Set A executed; migration delta determined.

### Fail-Closed Stop Conditions (Immediate Abort)
An operator must **immediately stop** if any of the following occur:
1. `verify_hosted_test_env.js` reports non-zero exit code or `PENDING CREDENTIALS`.
2. Target project reference does not match `ywhxkzmbwppkdemvzlhv`.
3. Pre-migration backup fails or produces an empty dump file.
4. Any missing migration file is discovered that is not intentionally absent (017 and 028 are the only expected absent numbers).
5. `migrate.js` reports an unhandled SQL exception or connection loss.
6. Post-migration SQL security queries report `anon_exec = true` or `authn_exec = true`.
7. Reconciliation dry-run reports quarantined records or unclassifiable candidates.

---

## 4. SECURE CREDENTIAL HANDLING

### Prohibited Actions
- **DO NOT** pass database passwords inline in CLI flags (`-W`, `--password=...`, or inline connection strings `postgresql://postgres:PASSWORD@...`).
- **DO NOT** echo or log credentials in scripts, CI logs, or terminal command history.

### Authorized Methods for Staging Operator

#### Method 1: Interactive Non-Logged Session Variable
```bash
# In an interactive terminal session (do not prefix with space):
read -s -p "Enter Staging Database Pooler Password: " STAGING_PG_PASS
export PGPASSWORD="$STAGING_PG_PASS"

# Verify connection without embedding password:
psql -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 -U postgres.ywhxkzmbwppkdemvzlhv -d postgres -c "SELECT current_database(), current_user;"

# Unset immediately after session:
unset PGPASSWORD
unset STAGING_PG_PASS
```

#### Method 2: Temporary Restricted `.pgpass` File
```bash
# Create file with strict permissions (Linux/macOS):
echo "aws-0-ap-northeast-1.pooler.supabase.com:5432:postgres:postgres.ywhxkzmbwppkdemvzlhv:<PASSWORD>" > ~/.pgpass
chmod 600 ~/.pgpass

# On Windows PowerShell:
# Store securely in %APPDATA%\postgresql\pgpass.conf with read-only ACL for current user.
```

---

## 5. PRE-MIGRATION BACKUP CONFIRMATION

Before running `migrate.js`, the operator must obtain a verifiable backup:

### Primary: Supabase Dashboard Snapshot
1. Open Supabase Dashboard for project `ywhxkzmbwppkdemvzlhv`.
2. Navigate to: **Database → Backups**.
3. Trigger a manual snapshot and verify timestamp is current.

### Secondary: Logical Custom Dump
```bash
pg_dump \
  --host=aws-0-ap-northeast-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.ywhxkzmbwppkdemvzlhv \
  --dbname=postgres \
  --format=custom \
  --file=staging_pre_039_backup_$(date +%Y%m%d_%H%M%S).dump

# Verify dump file size is greater than zero:
ls -lh staging_pre_039_backup_*.dump
```

---

## 6. READ-ONLY VERIFICATION SQL QUERIES

### Query Set A: Remote Migration Baseline Audit (Pre-Migration)
*Execute before running any migration commands to calculate the migration delta.*

```sql
-- Query A.1: List all migrations currently applied on remote staging
SELECT version, name, inserted_at 
FROM supabase_migrations.schema_migrations 
ORDER BY version ASC;

-- Expected Local Inventory: 37 files (001-016, 018-027, 029-039).
-- Note: 017 is INTENTIONALLY ABSENT (governance blocked).
-- Note: 028 is INTENTIONALLY ABSENT (historical numbering gap).
```

### Query Set B: Pre-Migration Financial Table Baseline (Pre-Migration)
*Snapshot existing row counts before running Migration 039.*

```sql
-- Query B.1: Record baseline row counts across financial and operational entities
SELECT 
    (SELECT count(*) FROM payments) AS count_payments,
    (SELECT count(*) FROM payment_sessions) AS count_payment_sessions,
    (SELECT count(*) FROM ledger_entries) AS count_ledger_entries,
    (SELECT count(*) FROM journal_transactions) AS count_journal_transactions,
    (SELECT count(*) FROM journal_lines) AS count_journal_lines,
    (SELECT count(*) FROM jobs) AS count_jobs,
    (SELECT count(*) FROM users) AS count_users;
```

### Query Set C: Post-Migration RPC Privileges & Least-Privilege Verification (Post-Migration)
*Execute immediately after `migrate.js` finishes to confirm RPC isolation.*

```sql
-- Query C.1: Verify execute permissions on sensitive financial stored procedures
SELECT 
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END AS exec_mode,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authn_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('capture_payment_atomic', 'refund_payment_atomic', 'adjust_wallet_atomic')
ORDER BY p.proname;

-- ACCEPTANCE CRITERIA:
-- 1. capture_payment_atomic: SECURITY DEFINER | anon_exec = false | authn_exec = false | svc_exec = true
-- 2. refund_payment_atomic:  SECURITY DEFINER | anon_exec = false | authn_exec = false | svc_exec = true
-- 3. adjust_wallet_atomic:   SECURITY INVOKER | anon_exec = false | authn_exec = false | svc_exec = true
```

```sql
-- Query C.2: Confirm legacy 6-argument overload of refund_payment_atomic was dropped
SELECT count(*) AS legacy_refund_overload_count
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'refund_payment_atomic'
  AND pronargs = 6;

-- ACCEPTANCE CRITERIA: legacy_refund_overload_count = 0.
```

### Query Set D: Post-Migration Financial Table RLS & Policy Audit (Post-Migration)
*Confirm that Row Level Security remains enabled on all ledger tables.*

```sql
-- Query D.1: Check RLS status on financial tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('payments', 'ledger_entries', 'journal_transactions', 'journal_lines', 'payment_refund_authorizations');

-- ACCEPTANCE CRITERIA: rowsecurity = true for all 5 tables.
```

```sql
-- Query D.2: Confirm unauthenticated roles cannot insert directly into journal tables
SELECT 
    has_table_privilege('anon', 'public.journal_transactions', 'INSERT') AS anon_can_insert_jt,
    has_table_privilege('authenticated', 'public.journal_transactions', 'INSERT') AS authn_can_insert_jt,
    has_table_privilege('anon', 'public.journal_lines', 'INSERT') AS anon_can_insert_jl,
    has_table_privilege('authenticated', 'public.journal_lines', 'INSERT') AS authn_can_insert_jl;

-- ACCEPTANCE CRITERIA: all 4 values must be FALSE.
```

### Query Set E: General Ledger Integrity & Zero-Sum Invariant (Post-Migration / Post-Reconciliation)
*Execute after operations to confirm double-entry accounting invariants.*

```sql
-- Query E.1: Verify zero unbalanced journal transactions
SELECT count(*) AS unbalanced_transactions_count
FROM journal_transactions
WHERE total_debit <> total_credit;

-- ACCEPTANCE CRITERIA: count = 0.
```

```sql
-- Query E.2: Verify total debit equals total credit across all journal lines per transaction
SELECT 
    jt.id,
    jt.transaction_id,
    jt.total_debit,
    SUM(CASE WHEN jl.entry_type = 'DEBIT' THEN jl.amount ELSE 0 END) AS lines_debit,
    SUM(CASE WHEN jl.entry_type = 'CREDIT' THEN jl.amount ELSE 0 END) AS lines_credit
FROM journal_transactions jt
JOIN journal_lines jl ON jt.id = jl.journal_id
GROUP BY jt.id, jt.transaction_id, jt.total_debit
HAVING SUM(CASE WHEN jl.entry_type = 'DEBIT' THEN jl.amount ELSE 0 END) <> SUM(CASE WHEN jl.entry_type = 'CREDIT' THEN jl.amount ELSE 0 END);

-- ACCEPTANCE CRITERIA: 0 rows returned.
```

```sql
-- Query E.3: Verify all accounts referenced in journal lines exist in active chart of accounts
SELECT count(*) AS invalid_account_lines_count
FROM journal_lines jl
LEFT JOIN ledger_accounts la ON jl.account_code = la.account_code AND la.is_active = true
WHERE la.account_code IS NULL;

-- ACCEPTANCE CRITERIA: count = 0.
```

---

## 7. MIGRATION EXECUTION PROTOCOL (OWNER-AUTHORIZED WINDOW ONLY)

When Gate 01 through Gate 06 pass, the operator executes:

```bash
# 1. Preview staging configuration (target identity must report ywhxkzmbwppkdemvzlhv):
node backend/scripts/with_staging_target.js node backend/scripts/verify_hosted_test_env.js

# 2. Execute migration runner:
node backend/scripts/with_staging_target.js node backend/scripts/migrate.js

# 3. Verify exit code:
# Must report: "All migrations executed successfully." Exit code: 0.

# 4. Immediately run Query Set C & Query Set D to verify RPC permissions and RLS.
```

---

## 8. RECONCILIATION TOOL CONNECTION ANALYSIS & SAFE DESIGN PROPOSAL

### Architectural Conflict in Existing Tooling
A critical structural conflict exists between staging target guards:
1. `backend/scripts/with_staging_target.js:143-146`: Explicitly **forbids loopback hosts** (`throw new StagingRefused('DATABASE_URL host ... is a loopback address — staging must point to a hosted database.')`).
2. `backend/scripts/reconcile_double_entry_ledger.js:34-38`: Explicitly **forbids non-loopback hosts** (`if (!dbUrl.includes('127.0.0.1') && !dbUrl.includes('localhost')) { process.exit(1); }`).

**Consequence**: The existing reconciliation script **cannot run directly against staging through `with_staging_target.js`** without triggering a safety refusal.

### Security Flaw in Naive Environment Variable Bypasses
The initial concept of using a simple flag like `NABIN_AUTHORIZED_STAGING_RECONCILER=1` is **insecure and rejected**:
1. **Inheritance & Ambient Leakage**: Environment variables are inherited by all child processes and subprocesses in a shell. If an operator sets it or it leaks via an `.env` file, unrelated scripts would execute with bypassed guards.
2. **Zero In-Band Attestation**: An environment variable does not prove which database `DATABASE_URL` is pointing to. If `DATABASE_URL` pointed to production while `NABIN_AUTHORIZED_STAGING_RECONCILER=1` was set, catastrophic data corruption would occur.
3. **No TLS Enforcement**: Setting an env flag does not solve the fact that `reconcile_double_entry_ledger.js` currently omits `sslConfig()`.

### Recommended Safe Reconciler Architecture (Pending Owner Review)
The reconciler connection must be secured at the database connection layer rather than through ambient environment flags:

1. **Integrated TLS Enforcement**: `reconcile_double_entry_ledger.js` must import `dbTls.sslConfig()` and strictly pass certificate configuration with pinned `supabase-root-2021-ca.pem` to `new Client({ connectionString: dbUrl, ssl })`.
2. **Explicit Target Mode Parameter**: Replace the hardcoded loopback check with an explicit CLI target flag:
   - `--target=local`: Verifies loopback (`127.0.0.1` or `localhost`), rejects non-loopback, sets `DATABASE_SSL=disable`.
   - `--target=staging`: Verifies non-loopback hostname, strictly matches `ywhxkzmbwppkdemvzlhv` pooler host, rejects `FORBIDDEN_PROD_REF`, enforces verified TLS.
3. **In-Band Target Identity Query**: Before reading ledger entries, execute an in-band catalog check:
   ```sql
   SELECT current_user, current_database(), inet_server_addr();
   ```
   Confirm username matches `postgres.ywhxkzmbwppkdemvzlhv` and verify Migration 039 is recorded in `supabase_migrations.schema_migrations`.
4. **Enforced Transaction Isolation**:
   - In `--dry-run` mode: Wrap operations in `BEGIN READ ONLY; ... ROLLBACK;`. Zero writes are physically possible at the engine level.
   - In `--execute` mode: Require explicit confirmation and valid pre-migration backup before committing `BEGIN ... COMMIT`.
5. **Status**: **DESIGN REVIEW ONLY. NOT IMPLEMENTED UNTIL EXPLICIT OWNER APPROVAL.**

### Staging Reconciliation Operational Protocol
Once the connection mechanism is approved, the operator executes the 7-step protocol:

1. **Step 1: Target & Baseline Verification**: Confirm Migration 039 applied cleanly.
2. **Step 2: Confirm Staging Backup**: Confirm pre-migration snapshot is valid.
3. **Step 3: Read-Only Dry-Run**:
   ```bash
   node backend/scripts/reconcile_double_entry_ledger.js --dry-run
   ```
4. **Step 4: Audit Candidate Provenance**:
   - Inspect `candidateCount`, `totalProposedAmount`, categories, and IDs.
   - Confirm zero records in `quarantined`.
5. **Step 5: Stop Condition**: If any candidate reference is unverified or ambiguous, **STOP AND INVESTIGATE**.
6. **Step 6: Zero Candidate Condition**: If `candidateCount === 0`, **skip backfill entirely**. The ledger is already balanced.
7. **Step 7: Separate Owner Authorization Gate**: Backfill `--execute` must **NEVER** run automatically. It requires explicit separate human owner authorization after reviewing dry-run outputs.

---

## 9. ROLLBACK LIMITATIONS, FORWARD-FIX & RECOVERY

### Rejection of Flawed Rollback Concepts
- **`DELETE FROM supabase_migrations.schema_migrations WHERE version = '039'` IS NOT A ROLLBACK.**
- Deleting the version row does not revert stored procedures in PostgreSQL; it corrupts catalog tracking.

### Proper Recovery Procedures
1. **Migration-Time Automatic Rollback**: `migrate.js` wraps each file in `BEGIN ... COMMIT`. If any error occurs during execution, PostgreSQL rolls back the entire transaction automatically.
2. **Post-Deployment DDL Reversal (If needed)**:
   - Restore Migration 006 definition of `capture_payment_atomic`.
   - Restore Migration 016 definition of `refund_payment_atomic`.
   - Recreate the dropped 6-argument overload.
3. **Financial Data Corrections (Compensating Entries)**:
   - Because `journal_transactions` is protected by `trg_journal_transactions_append_only`, posted entries cannot be deleted.
   - Any incorrect postings must be reversed by authoring a balanced compensating journal entry (`category = 'RECONCILIATION_CORRECTION'`) swapping DEBIT and CREDIT accounts.
4. **Forward-Fix Migration Pattern**: The standard engineering procedure is authoring a forward-fix migration (`040_*.sql`) rather than attempting database rewinds.

---

## 10. UNRESOLVED OWNER DECISIONS & RELEASE BLOCKERS

The operator must not proceed to production launch until these decisions are made by the project owner:

| Blocker | Category | Owner Decision Required |
| :--- | :--- | :--- |
| **BLK-01** | Mobile Build | Supply production Android signing keystore (`upload-keystore.jks`) and define release flavors. |
| **BLK-02** | Cloud Infrastructure | Provide staging pooler password and authorize staging deployment window. |
| **BLK-03** | Regulatory / Auth | Complete TRAI DLT registration; configure production SMS provider credentials. |
| **BLK-04** | Compliance / Finance | **Pending explicit owner selection of primary payment provider**. System remains strictly provider-neutral; no provider assumed by default; sandbox active. |
| **BLK-05** | Mobile Build | Provide macOS / iOS build environment and Apple Developer accounts. |
| **BLK-06** | Networking | Configure production domain routing and SSL certificates for `nabin.in`. |
| **BLK-07** | Financial Integrity | Staging rollout of Migration 039 and conditional reconciliation backfill authorization. |

---

## 11. GO / NO-GO RECOMMENDATION

### Formal Staging Rollout Verdict: **NO-GO FOR IMMEDIATE EXECUTION**
> **GO FOR A SCHEDULED, OWNER-AUTHORIZED STAGING WINDOW** once the staging pooler password is provided, Gate 01–06 are verified, and the reconciliation connection design is formally approved. Zero remote operations have been performed.
