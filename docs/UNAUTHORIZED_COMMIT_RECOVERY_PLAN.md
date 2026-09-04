# NABIN — UNAUTHORIZED COMMIT RECOVERY & ROLLBACK PLAN
**Document Path**: `docs/UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md`  
**Status**: PLAN-ONLY — STRICT READ-ONLY FREEZE — AWAITING EXPLICIT USER APPROVAL  
**Clean Baseline Target**: Commit `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`  
**Unauthorized Pushed Commit**: Commit `d7ef7f52d255e663c6bb28d32baaeddb8623de68`  

---

## MANDATORY GOVERNANCE STATEMENT

> **No rollback, reset, revert, commit, push, or code mutation was performed during the authoring of this recovery plan.**  
> **The working tree remains strictly frozen pending explicit user review and authorization.**

---

## 1. CURRENT GIT STATE

```text
$ git rev-parse HEAD
d7ef7f52d255e663c6bb28d32baaeddb8623de68

$ git rev-parse origin/main
d7ef7f52d255e663c6bb28d32baaeddb8623de68

HEAD == origin/main: YES (The unauthorized commit was pushed to the remote repository)

$ git status --short
?? docs/PHASE_15_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
?? docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
?? docs/UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md

$ git log -3 --oneline
d7ef7f5 feat(phase-16): implement postgres kyc, verified vpa, partial refund and atomic cancellation
8e18c21 feat: bridge geofences and pricing to postgres persistence
1c978f8 feat: bridge promotions to postgres persistence
```

---

## 2. APPROVED BASELINE VERIFICATION

The last formally accepted and verified baseline is:
**Commit `8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9`** (*"feat: bridge geofences and pricing to postgres persistence"*).

### Baseline Proof & Invariants:
1. **Migrations 001–015**: Complete, validated, and unchanged across all previous phases. Migration 016 did NOT exist.
2. **Phase 1–9 Persistence Bridges**: Verified (User, Driver, Restaurant, Menu, Order, Wallet, Rating, Audit, Support, Geofence, Pricing).
3. **No Phase 15/16 Code**: Payouts, cancellations, and refunds remained in their baseline operational state; no synthetic VPA generators, no premature `refund_payment_atomic` upgrades, and no unapproved `cancel_ride_atomic` definitions.
4. **Test Suite Status**: 319 passed automated tests.

---

## 3. AUDIT OF THE UNAUTHORIZED COMMIT (`d7ef7f5`)

Commit `d7ef7f5` introduced 18 file changes (+7,478 insertions, -202 deletions).

### Detailed File Classification:
| File Path | Status in `d7ef7f5` | Classification | Forensic Action |
| :--- | :---: | :---: | :--- |
| `backend/migrations/016_driver_kyc_payout_and_partial_refund.sql` | Added | **A. MUST RESTORE TO 8e18c21** | Delete file (unauthorized migration replica) |
| `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` | Added | **A. MUST RESTORE TO 8e18c21** | Delete file (unauthorized migration) |
| `backend/src/server.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/database.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/repositories/DriverRepository.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/repositories/PaymentRepository.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/repositories/JobRepository.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/repositories/PromotionRepository.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/src/repositories/IdentityRepository.js` | Added | **A. MUST RESTORE TO 8e18c21** | Delete file (was not present in `8e18c21`) |
| `backend/test_suite.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `backend/restart_test.js` | Modified | **A. MUST RESTORE TO 8e18c21** | Restore exact content from `8e18c21` |
| `docs/PHASE_10_IDENTITY_KYC_PERSISTENCE_AUDIT.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (historical audit) |
| `docs/PHASE_12_DOMAIN_READINESS_AUDIT.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (historical audit) |
| `docs/PHASE_13_PAYMENTS_PAYOUTS_BOOKING_SECURITY.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (historical audit) |
| `docs/PHASE_14_FINANCIAL_INTEGRITY_AUDIT.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (historical audit) |
| `docs/PHASE_15_AUTHORIZATION_PAYOUT_CANCELLATION_AUDIT.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (Phase 15 audit) |
| `docs/PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (Phase 15 audit) |
| `docs/PHASE_16_IMPLEMENTATION_PLAN.md` | Added | **B. FORENSIC DOCUMENT TO PRESERVE** | Preserve in repository (Frozen plan) |

---

## 4. FORENSIC EVIDENCE PRESERVATION REGISTER

The following documentation files represent permanent evidentiary audit logs and **MUST NOT BE REMOVED OR OVERWRITTEN**:
1. `docs/PHASE_10_IDENTITY_KYC_PERSISTENCE_AUDIT.md`
2. `docs/PHASE_12_DOMAIN_READINESS_AUDIT.md`
3. `docs/PHASE_13_PAYMENTS_PAYOUTS_BOOKING_SECURITY.md`
4. `docs/PHASE_14_FINANCIAL_INTEGRITY_AUDIT.md`
5. `docs/PHASE_15_AUTHORIZATION_PAYOUT_CANCELLATION_AUDIT.md`
6. `docs/PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md`
7. `docs/PHASE_15_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md`
8. `docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md`
9. `docs/PHASE_16_IMPLEMENTATION_PLAN.md`
10. `docs/UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md`

---

## 5. EVALUATION OF RECOVERY OPTIONS

### OPTION A: Standard `git revert d7ef7f5`
- **Auditability**: High. Git creates a revert commit referencing `d7ef7f5`.
- **GitHub History Integrity**: Clean, linear, forward-only.
- **Risk**: Moderate. A blanket `git revert` attempts to remove all 18 files, which would delete legitimate forensic and audit markdown documentation unless selectively restored.
- **Effect on `origin/main`**: Fast-forward push.
- **Force Push Required**: NO.
- **Phase 16 Cleanliness**: Can introduce Git merge conflict baggage if future branches attempt to merge commits with inverted patches.

### OPTION B: Hard Reset `git reset --hard 8e18c21` + Force Push
- **Auditability**: **EXTREMELY POOR / DESTRUCTIVE**. Orphans commit `d7ef7f5` from remote history.
- **GitHub History Integrity**: Destructive. Rewrites remote `origin/main` history, causing desynchronization for any other collaborators or build agents.
- **Risk**: **CRITICAL**. High risk of accidental data loss; directly violates enterprise audit compliance.
- **Effect on `origin/main`**: Non-fast-forward forced rewrite.
- **Force Push Required**: **YES** (`git push --force-with-lease`).
- **Phase 16 Cleanliness**: Leaves clean working tree, but destroys commit-level audit trails.

### OPTION C: Forward-Only Baseline Restoration Commit (RECOMMENDED)
- **Mechanism**: Use Git to restore all application code (`backend/`, `supabase/migrations/`) to match commit `8e18c21` identically, while explicitly retaining all audit and forensic markdown documents in `docs/`. Commit this restoration as a forward-only governance commit:
  `chore(governance): restore codebase to approved baseline 8e18c21 preserving forensic audit records`
- **Auditability**: **HIGHEST**. The unauthorized commit `d7ef7f5` remains permanently in Git history alongside the formal restoration commit that corrects it.
- **GitHub History Integrity**: 100% linear, immutable, forward-only.
- **Risk**: **ZERO**. No history rewriting, no orphaned commits, no risk of data loss.
- **Effect on `origin/main`**: Standard fast-forward push.
- **Force Push Required**: **NO**.
- **Phase 16 Cleanliness**: Application source code and migrations match `8e18c21` byte-for-byte. Phase 16 can be cleanly planned and implemented from the exact baseline.

---

## 6. RECOMMENDED RECOVERY STRATEGY (OPTION C)

Option C is unequivocally recommended. It satisfies all safety rules:
1. Does not rewrite or force-push Git history.
2. Keeps the unauthorized commit `d7ef7f5` permanently auditable.
3. Preserves all forensic reports in `docs/`.
4. Restores application source files, database repositories, and migrations to the exact byte-for-byte state of approved baseline `8e18c21`.
5. Leaves remote Supabase completely untouched.

---

## 7. EXACT COMMANDS TO BE EXECUTED (UPON EXPLICIT APPROVAL ONLY)

> **DO NOT RUN THESE COMMANDS NOW. THEY ARE PRESENTED FOR REVIEW ONLY.**

```powershell
# Step 1: Restore backend source code and tests to approved baseline 8e18c21
git checkout 8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9 -- backend/src/
git checkout 8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9 -- backend/test_suite.js
git checkout 8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9 -- backend/restart_test.js

# Step 2: Remove unauthorized Migration 016 files introduced in d7ef7f5
git rm -f supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql
git rm -f backend/migrations/016_driver_kyc_payout_and_partial_refund.sql

# Step 3: Remove unauthorized repository file added in d7ef7f5
git rm -f backend/src/repositories/IdentityRepository.js

# Step 4: Verify that historical migrations 001-015 are completely identical to 8e18c21
git diff 8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9 -- supabase/migrations/

# Step 5: Stage all forensic documentation to ensure preservation
git add docs/PHASE_10_IDENTITY_KYC_PERSISTENCE_AUDIT.md
git add docs/PHASE_12_DOMAIN_READINESS_AUDIT.md
git add docs/PHASE_13_PAYMENTS_PAYOUTS_BOOKING_SECURITY.md
git add docs/PHASE_14_FINANCIAL_INTEGRITY_AUDIT.md
git add docs/PHASE_15_AUTHORIZATION_PAYOUT_CANCELLATION_AUDIT.md
git add docs/PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md
git add docs/PHASE_15_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
git add docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
git add docs/PHASE_16_IMPLEMENTATION_PLAN.md
git add docs/UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md

# Step 6: Create the authoritative restoration commit
git commit -m "chore(governance): restore codebase to approved baseline 8e18c21 preserving forensic audit records"

# Step 7: Push fast-forward restoration to origin/main (NO FORCE PUSH)
git push origin main
```

---

## 8. EXPECTED POST-RECOVERY GIT STATE

1. **Working Tree**: Clean.
2. **Application Code**:
   `git diff 8e18c21 HEAD -- backend/` will return **zero diff**.
3. **Database Migrations**:
   `git diff 8e18c21 HEAD -- supabase/migrations/` will return **zero diff**.
4. **Git Log**:
   ```text
   [NEW] chore(governance): restore codebase to approved baseline 8e18c21 preserving forensic audit records
   d7ef7f5 feat(phase-16): implement postgres kyc, verified vpa, partial refund and atomic cancellation
   8e18c21 feat: bridge geofences and pricing to postgres persistence
   ```
5. **Remote Supabase**: 100% untouched.

---

## 9. POST-RECOVERY VERIFICATION COMMANDS

```powershell
# Verify application source code exactly matches approved baseline
git diff 8e18c216202cd8b0d00f0e6ff7f8e97821a7efd9 HEAD -- backend/src/

# Verify no Migration 016 exists in either directory
Test-Path supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql
Test-Path backend/migrations/016_driver_kyc_payout_and_partial_refund.sql

# Verify forensic documents are preserved and tracked
git ls-files docs/PHASE_15_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
git ls-files docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md
git ls-files docs/UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md

# Run Phase 14 baseline test verification
node backend/test_suite.js
```

---

## 10. REMOTE SUPABASE CONFIRMATION

- No remote Supabase connection has been opened.
- No `supabase link`, `supabase db push`, or `supabase db reset` commands targeting remote environments were run.
- Remote Supabase projects remain completely off-limits.
