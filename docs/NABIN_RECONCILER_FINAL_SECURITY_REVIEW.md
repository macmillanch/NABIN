# NABIN — FINAL ADVERSARIAL SECURITY REVIEW: RECONCILER SECURITY HELPER

**Review Date**: 2026-10-13  
**Review Type**: Independent Adversarial Code & Architecture Audit  
**Execution Boundary**: **STRICTLY LOCAL AND OFFLINE**  
- Zero connections or sockets opened to hosted staging or production.
- Zero migrations executed remotely.
- Zero financial backfills executed.
- Zero financial records or database schemas mutated.
- Helper module **not** integrated into `reconcile_double_entry_ledger.js`.
- All working tree modifications and untracked files preserved. Zero git commits or pushes.

---

## 1. Files Inspected and Changed

### Inspected Files
- [backend/src/services/reconcilerSecurity.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js) — Pure-functional security, TLS gating, and signature validation.
- [backend/src/services/dbTls.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/dbTls.js) — Shared database TLS policy and pinned root CA certificate loader.
- [backend/reconciler_target_guard_test.js](file:///c:/Users/macmi/Documents/nabin/backend/reconciler_target_guard_test.js) — Hermetic unit test suite for reconciler security controls.
- [backend/db_tls_policy_test.js](file:///c:/Users/macmi/Documents/nabin/backend/db_tls_policy_test.js) — Unit tests for TLS policy enforcement and caller compliance.
- [backend/scripts/reconcile_double_entry_ledger.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/reconcile_double_entry_ledger.js) — Double-entry reconciliation and backfill execution script *(inspected only)*.
- [backend/scripts/with_staging_target.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/with_staging_target.js) — Staging process spawn wrapper and credential validator *(inspected only)*.
- [backend/scripts/with_local_target.js](file:///c:/Users/macmi/Documents/nabin/backend/scripts/with_local_target.js) — Local Docker target wrapper *(inspected only)*.

### Changed Files
1. [backend/src/services/reconcilerSecurity.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js):
   - Added scheme whitelist (`postgresql:`, `postgres:`) and port whitelist (`5432`, `6543` for staging).
   - Expanded manifest computation to bind all 9 accounting attributes (`entry_id`, `amount`, `debit_account`, `credit_account`, `category`, `reference_id`, `created_at`, `job_id`, `currency`).
   - Implemented canonical signature payload with delimiter injection protection (`[\r\n\t|]` disallowed).
   - Enforced Ed25519 digital signature validation against independently configured trusted public key.
   - Enforced fail-closed mandatory expiration, max 60m TTL, and exact boundary expiration (`currentTimestampMs >= expiresAtMs`).
   - Implemented full-tuple candidate drift validation across all 9 accounting fields.
2. [backend/src/services/dbTls.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/dbTls.js):
   - Upgraded CA fingerprint mismatch from a non-fatal warning to a fail-closed fatal exception (`DATABASE_TLS_FINGERPRINT_MISMATCH`).
3. [backend/reconciler_target_guard_test.js](file:///c:/Users/macmi/Documents/nabin/backend/reconciler_target_guard_test.js):
   - Expanded hermetic test suite from 31 to 64 tests verifying all new security controls, boundary conditions, delimiter injection prevention, Ed25519 verification, and per-field drift assertions.

---

## 2. Adversarial Findings & Analysis

### A. Durable Nonce Replay Prevention
- **Current Implementation**: `validateBackfillExecutionAuthorization` uses an in-memory `Set` (`consumedNonces`) to reject repeated approval nonces (`APPROVAL_NONCE_REPLAYED`).
- **Adversarial Assessment**:
  - *Process Restarts*: If Node.js restarts or crashes between invocations, the in-memory Set is lost. A valid signed approval within its 60-minute window could theoretically be replayed.
  - *Multi-Process Concurrency*: Two separate processes executing concurrently do not share the in-memory Set.
- **Classification**: **Cross-process and post-restart replay protection is INCOMPLETE**.
- **Required Future Mitigation**: In the eventual integration into `reconcile_double_entry_ledger.js`, nonces must be durably committed inside PostgreSQL inside the same atomic write transaction:
  ```sql
  INSERT INTO reconciliation_audit_nonces (nonce, manifest_digest, approved_by, consumed_at)
  VALUES ($1, $2, $3, NOW());
  ```
  A duplicate nonce will trigger a PostgreSQL unique constraint violation (`23505`) and atomically roll back any backfill writes.

### B. Canonical Signature Serialization
- **Current Implementation**: [getCanonicalApprovalPayload()](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js#L343-L368) constructs a pipe-delimited canonical string.
- **Adversarial Assessment**:
  - *Delimiter Injection*: In pipe-delimited formats, if an attacker can insert a pipe `|` into a field (e.g., `approvedBy = "Owner|injected_flag"`), tokens can shift.
  - *Remediation Applied*: The implementation now iterates through every input field and asserts `!/[\r\n\t|]/.test(field)`. Any occurrence of a pipe, carriage return, newline, or tab immediately throws `APPROVAL_FIELD_DELIMITER_INJECTION`.
  - *Format Determinism*: Candidate count is normalized to integer, amount is formatted with `toFixed(2)`, timestamps are numeric integers.
- **Classification**: **Unambiguous and collision-free within the validated schema**.

### C. Approval Expiry and Time Validation
- **Current Implementation**:
  - Requires numeric finite `issuedAtMs` and `expiresAtMs`.
  - Maximum approval lifetime is strictly capped at 60 minutes (`APPROVAL_LIFETIME_EXCESSIVE`).
  - Future-issued approvals (> 60s clock skew) are rejected (`APPROVAL_FUTURE_ISSUED`).
  - Inverted or zero windows (`expiresAtMs <= issuedAtMs`) are rejected (`APPROVAL_WINDOW_INVALID`).
  - Evaluated with fail-closed condition: `currentTimestampMs >= expiresAtMs` (`APPROVAL_WINDOW_EXPIRED`), properly rejecting approvals at the exact millisecond of expiration.
- **Classification**: **Correct, robust, and deterministic**.

### D. Test-Only Signing Helpers
- **Current Implementation**: [signApprovalPayloadForTesting()](file:///c:/Users/macmi/Documents/nabin/backend/src/services/reconcilerSecurity.js#L373-L379) signs the canonical payload using Node's native `crypto.sign`.
- **Adversarial Assessment**:
  - No private key is embedded or generated in the module.
  - The verification function requires a trusted public key (`trustedPublicKey` or `NABIN_RECONCILER_OWNER_PUBLIC_KEY`). If unset, it fails closed with `OWNER_PUBLIC_KEY_UNCONFIGURED`.
  - A test fixture cannot authorize a backfill in staging because staging requires the independently configured owner public key.
- **Classification**: **Safe and hermetic; cannot be abused as an authorization bypass**.

### E. Target and Database Identity Checks
- **Current Implementation**:
  - Rejects `FORBIDDEN_PROD_REF` ('ouxvqmhuyueklnegvmxe') across all URLs, parameters, and environment variables.
  - Rejects non-loopback hosts for local; rejects loopback hosts for staging.
  - Whitelists staging hosts strictly to `aws-0-ap-northeast-1.pooler.supabase.com` and `db.ywhxkzmbwppkdemvzlhv.supabase.co`.
  - Whitelists staging ports strictly to `5432` and `6543`.
  - Whitelists database schemes strictly to `postgresql:` and `postgres:`.
  - Prohibits placeholder passwords without leaking input values.
- **In-Band Limits**: In-band checks (`current_database()`, `current_user`, `schema_migrations`) are verified as defense-in-depth, not standalone proof. Cryptographic proof of target identity is enforced via TLS certificate pinning.
- **Classification**: **Fail-closed multi-layered target defense**.

### F. TLS Certificate Pinning & Fail-Closed Behavior
- **Current Implementation**: [dbTls.js](file:///c:/Users/macmi/Documents/nabin/backend/src/services/dbTls.js) loads `supabase-root-2021-ca.pem` and verifies its SHA-256 fingerprint against `EXPECTED_ROOT_SHA256` (`80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`).
- **Fail-Closed Verification**: A mismatched CA certificate fingerprint now throws `DATABASE_TLS_FINGERPRINT_MISMATCH`. Verified by unit test `RT-15b`.
- **Bypass Immunity**: Any setting of `DATABASE_SSL=no-verify`, `disable`, `allow`, or `insecure` throws `DATABASE_TLS_BYPASS_REFUSED`.
- **Classification**: **Cryptographically sound and fail-closed**.

### G. Candidate Manifest & Drift Detection
- **Accounting Attribute Coverage**: Inspecting [reconcile_double_entry_ledger.js:213-233](file:///c:/Users/macmi/Documents/nabin/backend/scripts/reconcile_double_entry_ledger.js#L213-L233) confirms that 9 fields dictate Book 2 journal generation:
  1. `entry_id` (idempotency key & description)
  2. `amount` (total_debit, total_credit, line amounts)
  3. `debit_account` (debit journal line)
  4. `credit_account` (credit journal line)
  5. `category` (transaction category & entity type mapping)
  6. `reference_id` (bidirectional payment tracing)
  7. `created_at` (audit timestamp)
  8. `job_id` (service transaction tracing)
  9. `currency` (asserted to be INR)
- **Drift Detection**: Verified by tests `RT-28a` through `RT-28i`. Altering any one of these 9 fields, adding a candidate, or omitting a candidate triggers immediate refusal with `CANDIDATE_SET_DRIFT_DETECTED`.
- **Classification**: **Complete coverage of financial accounting semantics**.

### H. Full Authorization Path & Integration Preconditions
The security module is pure-functional and currently resides in isolation. For a future authorized integration into `reconcile_double_entry_ledger.js`, the caller must enforce:
1. Pre-flight parameter & scheme/port validation before opening socket.
2. TLS configuration passed to `pg.Client({ connectionString, ssl: targetConfig.ssl })`.
3. In-band session catalog attestation immediately on connect.
4. Engine-level read-only transaction for dry-run (`BEGIN TRANSACTION READ ONLY;`).
5. Output of deterministic dry-run report artifact with candidate manifest digest.
6. Execution gate (`--execute`):
   - Mandatory presence of signed owner approval artifact.
   - Verification of Ed25519 signature against `NABIN_RECONCILER_OWNER_PUBLIC_KEY`.
   - Mandatory expiration, issuance window, and maximum 60m TTL.
   - Re-scan of live database and 100% full-tuple zero-drift check.
   - Atomic database write transaction (`BEGIN` -> `INSERT nonces` -> `INSERT journals` -> `COMMIT`).
   - Replay prevention via durable PostgreSQL nonce insertion.

---

## 3. Test Evidence

All tests were executed locally and offline:

| Test Suite | Command | Exit Code | Result | Scope |
| :--- | :--- | :---: | :---: | :--- |
| **Reconciler Target Guard & Safety** | `node backend/reconciler_target_guard_test.js` | `0` | **64 / 64 PASS** | Pure unit tests with synthetic mocks |
| **Database TLS Policy Suite** | `node backend/db_tls_policy_test.js` | `0` | **50 / 50 PASS** | Pure unit tests with synthetic certs |
| **Staging Target Guard Suite** | `node backend/staging_target_guard_test.js` | `0` | **40 / 40 PASS** | Pure unit tests for harness isolation |
| **Hosted Test Env Guard Suite** | `node backend/verify_hosted_test_env_guard_test.js` | `0` | **27 / 27 PASS** | Pure unit tests for credential shapes |
| **Local Ledger Integration** | `node backend/scripts/with_local_target.js node backend/ledger_double_entry_reconciliation_test.js` | `0` | **18 / 18 PASS** | Integration tests against local Docker PostgreSQL |
| **Documentation Citation Guard** | `node backend/doc_citation_guard_test.js` | `0` | **8 / 8 PASS** | Markdown documentation integrity |
| **Git Diff Syntax & Check** | `git diff --check` | `0` | **0 Errors** | Whitespace and syntax integrity |

---

## 4. Remaining Security Gaps & Severity

| ID | Finding | Severity | Current Status | Required Next Action |
| :--- | :--- | :---: | :--- | :--- |
| **GAP-01** | Process-local in-memory Set does not survive restarts or cross-process concurrency. | **MEDIUM** | In-memory only in helper module. | Implement durable table-based nonce insertion (`reconciliation_audit_nonces`) when integrating into reconciler. |
| **GAP-02** | Owner Ed25519 keypair not yet provisioned by Platform Owner. | **HIGH (Operational)** | Module fails closed (`OWNER_PUBLIC_KEY_UNCONFIGURED`). | Platform Owner must generate keypair out-of-band and configure public key in staging. |
| **GAP-03** | Staging database pooler password is unconfigured template. | **HIGH (Operational)** | Module fails closed (`PLACEHOLDER_CREDENTIAL_REFUSED`). | Platform Owner must configure real credentials in `backend/.env.staging`. |
| **GAP-04** | Migration 039 not yet applied to hosted staging. | **HIGH (Operational)** | Module fails closed (`BASELINE_MIGRATION_MISSING`). | Migration 039 must be applied in authorized staging deployment window. |

---

## 5. Independent Final Verdicts

```text
========================================================================================
                               FINAL AUDIT VERDICTS
========================================================================================

1. Local Helper Security (reconcilerSecurity.js):
   [GO]
   - Pure functional design, scheme/port allowlists, 9-field candidate manifest,
     delimiter injection protection, and full-tuple drift detection verified (64/64 tests).

2. Approval Authentication:
   [GO (HELPER-LEVEL) / HOLD (DURABLE MULTI-PROCESS PERSISTENCE)]
   - Ed25519 cryptographic verification, TTL enforcement, and bound parameters verified.
   - Cross-process and post-restart replay protection is HOLD pending database-backed nonce storage.

3. TLS Policy (dbTls.js):
   [GO]
   - Pinned root CA, hostname verification, fail-closed fingerprint mismatch verified (50/50 tests).

4. Reconciler Integration (reconcile_double_entry_ledger.js):
   [HOLD]
   - Not authorized in this task. Wiring should proceed only in a dedicated integration task.

5. Hosted Staging Access:
   [NO-GO]
   - Zero remote access authorized. Blocked on owner deployment window and credentials.

6. Financial Backfill Execution:
   [NO-GO]
   - Strictly prohibited. Blocked on staging migration, dry-run review, and signed owner approval.
========================================================================================
```

---

## 6. Summary: What Was Proven, What Remains Unproven, and Next Step

### Proven
- The pure-functional security module strictly rejects production targets, unauthorized endpoints, invalid ports, unapproved schemes, and credential placeholders.
- Database TLS fails closed on certificate fingerprint divergence, with zero bypass possibility.
- Candidate manifest hashing binds all 9 accounting attributes, and live drift detection rejects any modified, added, or missing candidate.
- Approval expiration enforces a strict 60-minute maximum TTL and rejects expired or future-issued approvals.
- Ed25519 digital signatures are verified against an independent public key with delimiter-injection protection.

### Unproven
- Cross-process and post-restart nonce persistence remains unproven until a durable database table is added in the reconciler.
- Actual hosted staging catalog state remains unproven until the owner authorizes an inspection window.

### Safest Recommended Next Step
Present this audit report to the Platform Owner for review. Once approved, the next safe step is the **offline integration of `reconcilerSecurity.js` into `reconcile_double_entry_ledger.js`** using local Docker PostgreSQL, including a durable database-backed nonce table for replay protection, with zero remote access.
