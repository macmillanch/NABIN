# NABIN — Agent Handoff Format

**Status**: AUTHORITATIVE — PERMANENT  
**Usage**: Every completed agent task must produce a handoff document when passing work to another agent.

---

## HANDOFF TEMPLATE

```markdown
# NABIN Agent Handoff

## 1. IDENTIFICATION

- **Agent/Model**: [Agent name and model, e.g., "backend_architect / Claude Opus 4.1"]
- **Date**: [YYYY-MM-DD]
- **Task**: [Concise description of completed task]
- **Mode**: PLAN-ONLY | IMPLEMENTATION

## 2. FILES INSPECTED

- `path/to/file1.ext` — [what was inspected and why]
- `path/to/file2.ext` — [what was inspected and why]

## 3. FILES CHANGED

- `path/to/file1.ext` — [what changed and why]
- `path/to/file2.ext` — [what changed and why]

## 4. TESTS EXECUTED

- [Test suite name]: [X/Y passed]
- [Specific test IDs]: [results]

## 5. GIT STATE

- **Git Commit**: [commit hash if committed, or "not committed"]
- **Current HEAD**: [git rev-parse HEAD output]
- **origin/main**: [git rev-parse origin/main output]
- **HEAD == origin/main**: YES | NO
- **Working tree**: CLEAN | [list uncommitted changes]

## 6. DATABASE CHANGES

- **Migrations**: [list any migration files created/modified]
- **Remote Supabase**: TOUCHED | NOT TOUCHED
- **Local Supabase**: [what was done, if anything]

## 7. DECISIONS MADE

- **Decision ID**: [DEC-XXX or NEW]
- **Decision**: [what was decided]
- **Rationale**: [why]

## 8. OPEN QUESTIONS

1. [Question 1]
2. [Question 2]

## 9. REMAINING RISKS

1. [Risk 1 and mitigation]
2. [Risk 2 and mitigation]

## 10. EXACT NEXT RECOMMENDED ACTION

1. [Specific next step with file paths]
2. [Specific next step with file paths]
```

---

## HANDOFF RULES

1. **Every task completion** must produce a handoff document.
2. **Handoff documents** are stored in `.agents/handoffs/` or referenced in `HANDOFF.md`.
3. **Receiving agents** must read the handoff before starting work.
4. **No silent handoffs** — the handoff must be explicit and complete.
5. **Plan-only handoffs** must clearly state what was analyzed and what is recommended.
6. **Implementation handoffs** must include test results and git state.

---

## EXAMPLE: PLAN-ONLY HANDOFF

```markdown
# NABIN Agent Handoff

## 1. IDENTIFICATION

- **Agent/Model**: system_architect / Claude Opus 4.1
- **Date**: 2026-09-07
- **Task**: Audit Migration 016 for Phase 16 remediation readiness
- **Mode**: PLAN-ONLY

## 2. FILES INSPECTED

- `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` — Full schema review
- `backend/src/server.js` — Lines 1100–1120 (synthetic VPA fallback)
- `backend/src/server.js` — Lines 2348–2420 (cancel-ride endpoint)
- `backend/src/database.js` — Lines 265, 297, 328, 358, 388, 4884 (hardcoded KYC)
- `backend/test_suite.js` — Lines 3251–3253 (tautological assertions)

## 3. FILES CHANGED

- None (PLAN-ONLY mode)

## 4. TESTS EXECUTED

- None (PLAN-ONLY mode)

## 5. GIT STATE

- **Git Commit**: N/A (not committed)
- **Current HEAD**: 1d404a6e4afcee5b25c078d3a989c158b78a2a1c
- **origin/main**: 1d404a6e4afcee5b25c078d3a989c158b78a2a1c
- **HEAD == origin/main**: YES
- **Working tree**: CLEAN

## 6. DATABASE CHANGES

- **Migrations**: None
- **Remote Supabase**: NOT TOUCHED
- **Local Supabase**: NOT TOUCHED

## 7. DECISIONS MADE

- **Decision ID**: DEC-P3 (new)
- **Decision**: Phase 16 remediation requires 4 discrete fixes before Migration 016 can be reconsidered.
- **Rationale**: Forensic audit (PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md) identified 5 critical violations.

## 8. OPEN QUESTIONS

1. Should Migration 016 be recreated from scratch after fixes, or can existing file be amended?
2. Does the business still require driver KYC and verified VPA payout after marketplace grocery clarification (DEC-010)?

## 9. REMAINING RISKS

1. **Synthetic VPA fallback** — Must be eradicated before any payout code is approved.
2. **Non-atomic cancellation** — Must wire `cancel_ride_atomic` before cancellation endpoint is approved.
3. **Mock KYC hardcoding** — Must remove `kycStatus: 'VERIFIED'` from test fixtures before KYC tests are trusted.

## 10. EXACT NEXT RECOMMENDED ACTION

1. USER reviews Phase 16 forensic audit and decides whether to proceed with remediation.
2. If approved, SYSTEM ARCHITECT creates detailed remediation plan.
3. SECURITY ENGINEER reviews remediation plan for residual vulnerabilities.
4. BACKEND ARCHITECT implements fixes under explicit approval.
5. QA ENGINEER validates fixes with new test assertions.
```

---

## EXAMPLE: IMPLEMENTATION HANDOFF

```markdown
# NABIN Agent Handoff

## 1. IDENTIFICATION

- **Agent/Model**: backend_architect / Claude Opus 4.1
- **Date**: 2026-09-07
- **Task**: Implement fix for synthetic VPA fallback in admin payout endpoint
- **Mode**: IMPLEMENTATION

## 2. FILES INSPECTED

- `backend/src/server.js:1102` — Identified `${driver.id}@okhdfcbank` fallback

## 3. FILES CHANGED

- `backend/src/server.js` — Line 1102: Removed synthetic VPA fallback; endpoint now returns HTTP 400 if `verifiedUpiId` is null

## 4. TESTS EXECUTED

- `backend/test_suite.js`: SEC-09 (driver payout debits wallet atomically) — PASSED
- `backend/restart_test.js`: Restart-12e (driver payout persists) — PASSED

## 5. GIT STATE

- **Git Commit**: abc1234 (pending push)
- **Current HEAD**: 1d404a6e4afcee5b25c078d3a989c158b78a2a1c
- **origin/main**: 1d404a6e4afcee5b25c078d3a989c158b78a2a1c
- **HEAD == origin/main**: NO (uncommitted changes staged)
- **Working tree**: Clean after commit

## 6. DATABASE CHANGES

- **Migrations**: None
- **Remote Supabase**: NOT TOUCHED
- **Local Supabase**: Verified against local Docker; no schema changes needed

## 7. DECISIONS MADE

- **Decision ID**: DEC-P3
- **Decision**: Synthetic VPA fallback eradicated from `server.js:1102`.
- **Rationale**: DEC-015 prohibits synthetic VPA generation. Endpoint now rejects payouts without verified UPI.

## 8. OPEN QUESTIONS

1. Should we add a notification to drivers reminding them to complete KYC for payout eligibility?

## 9. REMAINING RISKS

1. **Non-atomic cancellation** — Still pending. Must be addressed in separate approved task.
2. **Mock KYC hardcoding** — Still present in `database.js` test fixtures.

## 10. EXACT NEXT RECOMMENDED ACTION

1. QA ENGINEER adds regression test: admin payout with null `verifiedUpiId` returns HTTP 400.
2. SECURITY ENGINEER reviews change for residual fallback paths.
3. Push to `origin/main` after approval.
```
