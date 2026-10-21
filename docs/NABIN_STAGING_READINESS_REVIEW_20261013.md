# NABIN — STAGING READINESS REVIEW (NO DEPLOYMENT)

**Document Reference**: `docs/NABIN_STAGING_READINESS_REVIEW_20261013.md`  
**Review Date**: 13 October 2026, 06:30 IST  
**Git Baseline**: `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` on `main`  
**Review Mode**: PLAN & AUDIT ONLY — Zero connections, zero writes, zero deployments to hosted staging or production  
**Target Environment Evaluated**: Hosted Staging Cloud (`ywhxkzmbwppkdemvzlhv`, AWS Tokyo `ap-northeast-1`)  

---

## 1. EXECUTIVE SUMMARY & GO / NO-GO RECOMMENDATION

### Formal Recommendation: **NO-GO FOR IMMEDIATE ROLLOUT; GO FOR A SCHEDULED, OWNER-AUTHORIZED STAGING WINDOW**

Immediate automated execution against hosted staging is **STRICTLY BLOCKED**. While local implementation is verified on local Docker PostgreSQL, hosted staging cannot be deployed or verified without external owner actions.

```
┌────────────────────────────────────────────────────────┐
│                   READINESS MATRIX                     │
├────────────────────────────────────────────────────────┤
│ Local Technical Implementation  : VERIFIED (Local Only)│
│ Dual-Book Ledger Consolidation  : VERIFIED (Local Only)│
│ Least-Privilege Security Model : VERIFIED (Local Only)│
│ Local Regression Chain (72/72)  : PASS (2,877 checks)  │
│ Hosted Staging Schema Baseline  : UNVERIFIED (Unknown) │
│ Hosted Staging Pooler Password  : BLOCKED (Placeholder)│
│ Hosted Table Privilege Alignment: UNVERIFIED (Contested)│
│ Hosted Reconciliation Baseline  : UNMEASURED (Unknown) │
│ Payment Provider Selection      : PENDING (Owner Call) │
└────────────────────────────────────────────────────────┘
```

### Separation of Verified Local Evidence vs. Unverified Hosted Assumptions

| Dimension | Verified Local Reality (`127.0.0.1:54322`) | Unverified Hosted Staging Reality (`ywhxkzmbwppkdemvzlhv`) |
| :--- | :--- | :--- |
| **Migration 039** | Applied cleanly to local Docker PostgreSQL; 37 total migrations recorded in `schema_migrations`. | **Unapplied.** Remote schema version is unknown. Operator must query `supabase_migrations.schema_migrations` to determine baseline. |
| **Double-Entry Ledger** | Dual-posting verified: captures and refunds write balanced Book 1 (`ledger_entries`) and Book 2 (`journal_transactions` + `journal_lines`) rows in a single atomic transaction. | **Two-book divergence active.** Remote stored procedures remain at earlier definitions without dual-posting. |
| **Historical Reconciliation** | 572 candidate entries (₹173,840.00) proven to be local automated-test residue and backfilled locally. | **Unmeasured.** The 572 local records DO NOT exist remotely. Staging candidate count, provenance, and monetary values are unmeasured. |
| **Regression Chain** | 72/72 links clean, 0 problems, 2,877 explicit checks passing, 2 standing skips, exit code 0 ([chain-summary.txt](file:///c:/Users/macmi/Documents/nabin/backend/.chain-logs/runs/chain_20261013_023614_76484_7e98e2/chain-summary.txt)). | **Unverified.** Automated test chain has never run against hosted edge API gateway with Migration 039 active. |
| **Database Credentials** | Active local Docker container `supabase_db_nabin`. | **Blocked.** `DATABASE_URL` pooler password in `backend/.env.staging` is an unfilled template placeholder. [verify_hosted_test_env.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/verify_hosted_test_env.js) exits 1 with `PENDING CREDENTIALS`. |
| **Grants & RBAC** | Strict least privilege: `capture_payment_atomic` and `refund_payment_atomic` revoked from `PUBLIC`, `anon`, `authenticated`; granted only to `service_role`. | **Unverified.** Previous reports noted core tables (`users`, `drivers`, `jobs`, `orders`) returned HTTP 403 `42501` permission denied; blanket grant claims remain contested. |

---

## 2. MIGRATION 039 AUDIT, DEPENDENCIES & CALLERS

### Diff Analysis: `supabase/migrations/039_atomic_double_entry_capture_and_refund.sql`

[Migration 039](file:///c:/Users/macmi/Documents/nabin/supabase/migrations/039_atomic_double_entry_capture_and_refund.sql) resolves the two-book ledger divergence without deleting or altering existing historical rows:

1. **Atomic Dual-Posting in `capture_payment_atomic`**:
   - Signature: `(text, text, uuid, text, text, boolean, text, text, numeric)`
   - Dual-writes to Book 1: `ledger_entries` (for backward-compatible audit preservation).
   - Dual-writes to Book 2: `journal_transactions` (`category = 'PAYMENT_CAPTURE'`, `status = 'POSTED'`) + 2 `journal_lines`:
     - **DEBIT**: `PAYMENT_GATEWAY_ESCROW` (Clearing Asset)
     - **CREDIT**: `MERCHANT_PAYABLE` (for food/grocery) or `CUSTOMER_WALLET_LIABILITY` (for rides/top-ups)
   - Mutates `payments` (`status = 'CAPTURED'`) and `jobs` (`payment_status = 'PAID'`) within the same PostgreSQL transaction.
   - Enforces check constraint `chk_balanced_entry` (`total_debit = total_credit`).

2. **Atomic Dual-Posting in `refund_payment_atomic`**:
   - Signature: `(text, text, text, text, text, numeric, text)`
   - Drops redundant legacy 6-arg overload (`DROP FUNCTION IF EXISTS public.refund_payment_atomic(text, text, text, text, text, numeric)`), permanently eliminating PostgREST `PGRST203` (Multiple Choices) ambiguity.
   - Writes to Book 1: `ledger_entries` + `payment_refund_authorizations`.
   - Writes to Book 2: `journal_transactions` (`category = 'DISPUTE_REFUND'`, `status = 'POSTED'`) + 2 `journal_lines`:
     - **DEBIT**: `CUSTOMER_WALLET_LIABILITY` (liability reduction)
     - **CREDIT**: `PAYMENT_GATEWAY_ESCROW` (clearing payout)
   - Mutates `payments` (`status = 'REFUNDED'` or `'PARTIALLY_REFUNDED'`).
   - Refunds exceeding refundable ceiling (`payments.amount - payments.refunded_amount`) fail closed with `EXCEEDS_REFUNDABLE_BALANCE`.

3. **Database Dependencies**:
   - `public.ledger_entries` (Migration 001 / 006)
   - `public.payments`, `public.payment_sessions`, `public.payment_webhooks` (Migration 006)
   - `public.payment_refund_authorizations` (Migration 016)
   - `public.journal_transactions`, `public.journal_lines`, `public.ledger_accounts` (Migration 002)
   - Accounts: `PAYMENT_GATEWAY_ESCROW`, `CUSTOMER_WALLET_LIABILITY`, `MERCHANT_PAYABLE` (seeded in Migration 002)
   - `public.jobs` (Migration 001 / 005)

4. **Backend Caller Audit**:
   - [PaymentRepository.js](file:///c:/Users/macmi/Documents/nabin/backend/src/repositories/PaymentRepository.js):
     - `capturePaymentAtomic`: calls `supabaseAdmin.rpc('capture_payment_atomic', { ... })`
     - `processRefund`: calls `supabaseAdmin.rpc('refund_payment_atomic', { ... })`
     - `verifyPaymentSession` (lines 503-512): calls `this.capturePaymentAtomic` upon cryptographic HMAC verification.
     - `recordPaymentWebhook` (lines 717-725): calls `this.capturePaymentAtomic` upon gateway `payment.captured` event.
   - [server.js](file:///c:/Users/macmi/Documents/nabin/backend/src/server.js):
     - Route `POST /api/admin/finance/refund` (line 2380): calls `supabaseAdmin.rpc('refund_payment_atomic', { ... })`
     - Route `POST /api/payments/verify-checkout` (line 8790): calls `db.verifyPaymentSession` → `paymentRepo.verifyPaymentSession` → `paymentRepo.capturePaymentAtomic`
     - *Webhook Note*: No registered Express route `POST /api/payments/webhook` currently exists in `server.js`; webhook processing logic lives in `PaymentRepository.recordPaymentWebhook`.
   - All database calls execute via `supabaseAdmin` using `SUPABASE_SERVICE_ROLE_KEY`. No client frontend (Customer Web/Mobile, Driver Mobile, Merchant Web) makes direct PostgREST calls to these procedures.

---

## 3. STAGING MIGRATION SEQUENCING & GAP ANALYSIS (017–039)

### Actual Migration File Inventory
The repository contains exactly **37 migration files** under `supabase/migrations/`:
- `001` through `016` (16 files): Foundation, core schema, initial ledger, payments, KYC.
- `018` through `027` (10 files): Orders, dispatch security, cross-domain security, feature control, backend sessions, campaigns.
- `029` through `039` (11 files): Service role restrictions, dark stores, operator permissions, catalog snapshots, and double-entry capture/refund.

### Explicit Analysis of Missing Migration Numbers
1. **Migration 017 — INTENTIONALLY ABSENT (GOVERNANCE PROTECTED)**:
   - Migration 017 is explicitly blocked and unapproved per `.agents/AGENTS.md` ("Do not modify migrations 001–016. Migration 017 is currently not approved. Do not create Migration 017 merely because functionality requires database changes.").
   - It is **not** a missing file that needs to be created or recovered; it is an intentionally reserved number.
2. **Migration 028 — INTENTIONALLY ABSENT (HISTORICAL GAP)**:
   - Migration 028 is a gap in historical numbering. No file named `028_*.sql` exists in the repository.
   - [migrate.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/migrate.js) sorts discovered files alphabetically by prefix (`027` followed immediately by `029`). The absence of 028 does not impede execution.

### Do Not Assume Remote Version Baseline
We **must not assume** hosted staging is at version 038. Staging could be in one of four distinct states:
- **Baseline Scenario (at 016)**: Staging has never received migrations past the initial baseline. All 21 migrations (`018`–`027`, `029`–`039`) must be applied in order.
- **Intermediate Scenario (e.g., at 027 or 032)**: Staging received partial past migrations; only subsequent numbers are pending.
- **Pre-Consolidation Scenario (at 038)**: Staging received migrations up to 038; only `039` is pending.
- **Unrecorded / Divergent Scenario**: Remote `schema_migrations` table is empty or diverged.

**Mandatory Operator Pre-Check**:
Before running any migration command, the operator must query the remote database catalog:
```sql
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;
```
The set difference between the 37 local migration versions and the remote query output defines the exact execution delta.

---

## 4. SECURITY, RBAC & `SECURITY DEFINER` AUDIT

### `SECURITY DEFINER` Execution Risks
Both `capture_payment_atomic` and `refund_payment_atomic` are defined with:
```sql
SECURITY DEFINER
SET search_path TO 'public'
```
Because `SECURITY DEFINER` functions execute with the privileges of their owner (`postgres`), **they completely bypass table-level Row Level Security (RLS) policies within the function body**.

If `EXECUTE` privileges are granted to `authenticated` or `anon`:
- Any logged-in customer, driver, or anonymous attacker could issue a PostgREST POST request to `/rpc/capture_payment_atomic` or `/rpc/refund_payment_atomic`.
- Because the functions accept `p_order_id` or `p_order_or_payment` and lack internal caller UID checks, an untrusted user could capture or refund payments belonging to arbitrary third parties across tenant boundaries.

### Enforced Privilege Matrix (Migration 039 Lines 399–408 & Migration 022 Lines 52–88)
```sql
-- Migration 039: Financial RPC hardening (SECURITY DEFINER)
REVOKE ALL ON FUNCTION public.capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_payment_atomic(text, text, uuid, text, text, boolean, text, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_payment_atomic(text, text, text, text, text, numeric, text) TO service_role;

-- Migration 022: Wallet RPC hardening (SECURITY INVOKER)
REVOKE EXECUTE ON FUNCTION public.adjust_wallet_atomic(uuid, varchar, numeric, varchar, text, varchar, varchar, varchar, varchar) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_wallet_atomic(uuid, varchar, numeric, varchar, text, varchar, varchar, varchar, varchar) TO service_role, postgres;
```

### Architectural Distinction: `SECURITY DEFINER` vs. `SECURITY INVOKER`
- **`capture_payment_atomic` & `refund_payment_atomic` (`SECURITY DEFINER`)**: Execute with `postgres` ownership privileges and bypass table RLS. Revoking `anon` and `authenticated` access is critical to prevent unauthenticated or cross-tenant IDOR attacks via PostgREST RPC endpoints.
- **`adjust_wallet_atomic` (`SECURITY INVOKER`)**: Created in Migration 007 and hardened in Migration 022. Executes under caller permissions. Because it mutates `users`, `drivers`, `merchants`, and `journal_*` records, revoking execute from `PUBLIC` and `authenticated` prevents clients from executing wallet arithmetic directly.

### Mandatory Post-Deployment SQL Security Checks
The staging operator must run these queries immediately after migration:

```sql
-- Check 1: Verify RPC execution is granted ONLY to service_role
SELECT 
    p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authn_exec,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_exec
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('capture_payment_atomic', 'refund_payment_atomic', 'adjust_wallet_atomic');
-- Expected: anon_exec = false, authn_exec = false, svc_exec = true for all 3 rows.

-- Check 2: Verify RLS is enabled on all financial tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('payments', 'ledger_entries', 'journal_transactions', 'journal_lines', 'payment_refund_authorizations');
-- Expected: rowsecurity = true for all 5 tables.

-- Check 3: Confirm anon and authenticated CANNOT insert directly into journal tables
SELECT 
    has_table_privilege('anon', 'journal_transactions', 'INSERT') AS anon_insert_jt,
    has_table_privilege('authenticated', 'journal_transactions', 'INSERT') AS authn_insert_jt,
    has_table_privilege('anon', 'journal_lines', 'INSERT') AS anon_insert_jl,
    has_table_privilege('authenticated', 'journal_lines', 'INSERT') AS authn_insert_jl;
-- Expected: all 4 values must be FALSE.
```

---

## 5. SECURE PRE-MIGRATION BACKUP PROCEDURES

### Credential Protection Rules
- **NEVER** pass passwords inline in command arguments (e.g., `-W`, `--password=...`, or inline connection strings `postgresql://user:pass@...`).
- Inline secrets leak into `.bash_history`, PowerShell `PSReadLine` history (`ConsoleHost_history.txt`), process monitors (`ps aux`), and CI logs.
- **NEVER** run backup commands during review or planning phases.

### Secure Backup Methods for Authorized Operator

#### Method A: Supabase Dashboard (Recommended — Zero Credential Exposure)
1. Log into the hosted Supabase Dashboard.
2. Navigate to: **Project Settings → Database → Backups**.
3. Trigger a manual snapshot before migration execution.

#### Method B: Interactive Terminal Environment Variable (CLI)
In an interactive, non-logged terminal session:
```bash
# Securely prompt for password without echoing to screen or command history:
read -s -p "Enter Staging DB Pooler Password: " PGPASSWORD
export PGPASSWORD

# Execute pg_dump using session environment variable:
pg_dump \
  --host=aws-0-ap-northeast-1.pooler.supabase.com \
  --port=5432 \
  --username=postgres.ywhxkzmbwppkdemvzlhv \
  --dbname=postgres \
  --format=custom \
  --file=staging_pre_039_backup.dump

# Immediately clear password from shell session:
unset PGPASSWORD
```

#### Method C: Ephemeral `.pgpass` File
Create a temporary `.pgpass` file with strict permissions:
```bash
echo "aws-0-ap-northeast-1.pooler.supabase.com:5432:postgres:postgres.ywhxkzmbwppkdemvzlhv:<PASSWORD>" > ~/.pgpass
chmod 600 ~/.pgpass

pg_dump -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 -U postgres.ywhxkzmbwppkdemvzlhv -d postgres -F c -f staging_pre_039_backup.dump

rm -f ~/.pgpass
```

---

## 6. ROLLBACK LIMITATIONS, COMPENSATING ENTRIES & RECOVERY STRATEGY

### Critical Clarification: Deleting from `schema_migrations` is NOT a Rollback
A critical error in earlier drafts was suggesting `DELETE FROM supabase_migrations.schema_migrations WHERE version = '039';` as a rollback.
- **Deleting a row from `schema_migrations` does NOT revert any database changes.**
- It leaves the altered stored procedures (`capture_payment_atomic`, `refund_payment_atomic`) active in the database catalog while stripping the version record.
- If `migrate.js` is subsequently run, it will attempt to re-execute Migration 039 against already-modified functions, causing unpredictable behavior.

### Realistic Rollback & Recovery Architecture

```
┌────────────────────────────────────────────────────────┐
│                   FAILURE TAXONOMY                     │
├────────────────────────────┬───────────────────────────┤
│ Failure During migrate.js  │ Automatic Transaction     │
│ Execution (Script Error)   │ Rollback (BEGIN...COMMIT) │
├────────────────────────────┼───────────────────────────┤
│ Post-Migration Defect in   │ Forward-Fix Migration     │
│ Function Logic (DDL)       │ (e.g., Migration 040)     │
├────────────────────────────┼───────────────────────────┤
│ Post-Migration Financial   │ Compensating Double-Entry │
│ Data Discrepancy           │ Journal Postings          │
├────────────────────────────┼───────────────────────────┤
│ Catastrophic Database      │ Restore from Pre-Migration│
│ Corruption                 │ Dump (Downtime Required)  │
└────────────────────────────┴───────────────────────────┘
```

1. **Transaction-Level Rollback During Migration**:
   - [migrate.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/migrate.js) executes each migration inside `BEGIN ... COMMIT`.
   - If any syntax error, missing dependency, or constraint failure occurs while applying Migration 039, PostgreSQL automatically executes `ROLLBACK`. The migration is not committed, and no version row is inserted.

2. **DDL Reversibility (If Migration 039 Committed but Must Be Reverted)**:
   - DDL changes in Migration 039 are code replacements (`CREATE OR REPLACE FUNCTION` and `DROP FUNCTION`).
   - Reversal requires executing an explicit DDL reversal script:
     - Restore `capture_payment_atomic` to its Migration 006 definition.
     - Restore `refund_payment_atomic` to its Migration 016 definition.
     - Recreate the dropped 6-arg `refund_payment_atomic` overload.
   - **Caution**: Reverting function signatures will break any backend code already deployed that relies on the 7-arg refund signature or dual-entry return shapes.

3. **Financial Data Immutability & Compensating Entries**:
   - The double-entry general ledger is append-only.
   - `journal_transactions` is protected by `trg_journal_transactions_append_only`, which rejects SQL `UPDATE` and `DELETE` at the engine level.
   - Any journal transactions written post-migration (whether live captures, live refunds, or reconciliation entries) **CANNOT be deleted**.
   - If any incorrect journal entries are posted, the only valid accounting procedure is posting a **compensating journal transaction**:
     - Create a new transaction with category `'RECONCILIATION_CORRECTION'`.
     - Swap the debit and credit legs to zero out the unintended balance movement.

4. **Forward-Fix vs. Backup Restore**:
   - **Forward-Fix is the Preferred Engineering Pattern**: If an edge case is identified post-migration, author a forward-only migration (e.g., `040_*.sql`) to patch the stored procedure.
   - **Full Restore**: Restoring from the pre-migration `.dump` file is reserved exclusively for catastrophic corruption. Restoring a dump overwrites all tables and causes data loss for any concurrent user actions that occurred post-backup.

---

## 7. CONDITIONAL STAGING RECONCILIATION & CANDIDATE PROVENANCE

### Do Not Assume Local Test Candidates Exist on Staging
- On local Docker PostgreSQL, 572 candidate entries (₹173,840.00) were identified:
  - 557 dispute refunds (₹170,300.00)
  - 7 food captures (₹2,450.00)
  - 8 ride captures (₹1,090.00)
- **These 572 records are local automated-test residue** generated by local test runners (`test_phase5_payments.js`, etc.) on developer machines.
- **Hosted staging holds a completely independent dataset.** It may hold 0 candidate entries, 10 entries, or hundreds, with entirely different amounts and references.

### Local-Target Guard in Reconciler (`reconcile_double_entry_ledger.js:34–38`)
`reconcile_double_entry_ledger.js` contains a fail-closed local-target guard:
```javascript
const dbUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!dbUrl.includes('127.0.0.1') && !dbUrl.includes('localhost')) {
  console.error('❌ SAFETY REFUSAL: Database target is not loopback. Refusing execution.');
  process.exit(1);
}
```
**Operational Consequence**:
- If `with_staging_target.js` executes `reconcile_double_entry_ledger.js` pointing directly at `aws-0-ap-northeast-1.pooler.supabase.com`, this guard intentionally triggers an immediate exit 1 refusal.
- In a future authorized window, the operator must either:
  1. Route the staging connection through an SSH/local port tunnel (e.g., local port `127.0.0.1:6543` forwarding to `aws-0-ap-northeast-1.pooler.supabase.com:5432`), satisfying the loopback requirement; OR
  2. The team must author an owner-approved guard modification accepting an explicit opt-in flag (e.g. `NABIN_ALLOW_REMOTE_RECONCILIATION=1`) under `with_staging_target.js`.

### Strict Staging Reconciliation Protocol
The staging operator must follow this conditional protocol:

1. **Step 1: Execute Read-Only Dry-Run**:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --dry-run
   ```
2. **Step 2: Inspect Candidate Provenance**:
   - If candidate count is **0**: Staging is already balanced. **Skip backfill execution entirely.**
   - If candidates exist: Query `ledger_entries` on staging to inspect `entry_id`, `reference_id`, `job_id`, `created_at`, and `amount`.
   - Distinguish whether candidates are synthetic test fixtures (`pay_test_*`, `order_test_*`) or actual staging user test orders.
   - Verify zero candidates are quarantined.
3. **Step 3: Conditional Execution Gate**:
   - Execute `--execute` ONLY if candidate count > 0, all candidate entries pass referential checks, and candidate provenance is understood and approved by the operator.
   - If any candidate is ambiguous, **abort and investigate**.

---

## 8. STEP-BY-STEP STAGING VERIFICATION CHECKLIST

When an authorized staging rollout window is opened by the project owner:

### Phase 1: Environment & Credential Gates
- [ ] Retrieve database pooler password for `ywhxkzmbwppkdemvzlhv` from Supabase Dashboard.
- [ ] Populate `backend/.env.staging` (or set `STAGING_DATABASE_URL` in operator session).
- [ ] Run environment verifier: `node backend/scripts/verify_hosted_test_env.js` (must exit 0 `PASS`).
- [ ] Run target preview check: `node backend/scripts/with_staging_target.js node -e "console.log('Target verified')"` (must confirm `ywhxkzmbwppkdemvzlhv`, non-loopback, strict TLS).

### Phase 2: Remote Baseline Audit & Pre-Migration Backup
- [ ] Query remote migration ledger: `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;`.
- [ ] Record exact migration delta (which migrations between 001 and 039 are missing).
- [ ] Perform secure logical backup (Dashboard snapshot or secure `pg_dump`).
- [ ] Snapshot current row counts on `payments`, `ledger_entries`, `journal_transactions`, `journal_lines`, `jobs`.

### Phase 3: Database Migration Execution
- [ ] Run migration engine: `node backend/scripts/with_staging_target.js node backend/scripts/migrate.js`.
- [ ] Confirm all pending migrations apply cleanly with exit code 0.
- [ ] Verify `schema_migrations` contains all applied versions.
- [ ] Run SQL Security Check (Query from Section 4): confirm `anon` and `authenticated` have `false` for financial RPC execution.

### Phase 4: Conditional Reconciliation Dry-Run & Backfill
- [ ] Run dry-run: `node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --dry-run`.
- [ ] Inspect reported candidate count and provenance.
- [ ] **If 0 candidates reported**: Staging is balanced. Mark reconciliation COMPLETE with 0 rows backfilled.
- [ ] **If > 0 candidates reported**: Verify provenance; if approved, run: `node backend/scripts/with_staging_target.js node backend/scripts/reconcile_double_entry_ledger.js --execute`.
- [ ] Re-run dry-run: confirm 0 proposed entries remain.

### Phase 5: Application Smoke & Regression Testing
- [ ] Run staging synthetic suite: `node backend/scripts/with_staging_target.js node backend/test_hosted_staging_synthetic.js`.
- [ ] Run staging flows suite: `node backend/scripts/with_staging_target.js node backend/test_staging_flows.js`.
- [ ] Run ledger reconciliation test: `node backend/scripts/with_staging_target.js node backend/ledger_double_entry_reconciliation_test.js` (must pass 18/18).
- [ ] Execute post-migration data integrity queries (Section 6): confirm 0 unbalanced transactions, 0 asymmetric lines, 0 invalid accounts.

---

## 9. UNRESOLVED RISKS, OWNER DECISIONS & RELEASE BLOCKERS

The following items cannot be resolved autonomously by AI agents and require human project owner decisions:

| Item | Category | Blocker Reference | Required Owner Decision / Action |
| :--- | :--- | :--- | :--- |
| **Staging DB Password** | Credentials | **BLK-02** | Retrieve database pooler password for project `ywhxkzmbwppkdemvzlhv` from Supabase Dashboard and configure in staging environment. |
| **Staging Rollout Authorization** | Infrastructure | **BLK-02** | Explicit owner approval to execute `with_staging_target.js node backend/scripts/migrate.js` against hosted staging. |
| **Payment Provider Decision** | Financial Policy | **BLK-04 / F-1** | Explicit owner ruling selecting primary payment gateway (Razorpay vs. Cashfree). System remains strictly gateway-neutral; legacy `'RAZORPAY_SANDBOX'` parameter default in Migration 039 / 006 / 016 stored procedure signatures is an inert schema placeholder, not an active gateway selection. Sandbox mode remains active with zero live keys until commercial KYC is finalized. |
| **India SMS DLT Credentials** | Regulatory / Auth | **BLK-03** | Provide TRAI DLT Entity ID, Sender Header, and transactional SMS provider API keys. Production SMS remains disabled until provided. |
| **Android Keystore & Flavors** | Build / Release | **BLK-01** | Generate production release signing keystores and configure Gradle flavors. |
| **DNS & Domain Routing** | Network | **BLK-06** | Provision and route production DNS records for `nabin.in`, `api.nabin.in`, and `admin.nabin.in`. |
| **Blanket vs. Least-Privilege Grant** | Security | **D-8 / #251** | Owner confirmation whether the blanket `GRANT ALL ON ALL TABLES TO service_role` on staging should be narrowed to the 29 named relation privileges listed in `#251`. |

---

## 10. CONCLUSION

Local implementation, tests, and accounting invariants are verified on local Docker PostgreSQL. Hosted staging rollout is technically prepared and documented, but remains **NO-GO** pending owner credentials, remote baseline verification, and explicit authorization.
