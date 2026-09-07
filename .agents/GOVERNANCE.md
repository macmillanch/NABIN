# NABIN — Multi-Agent Governance Specification

**Status**: AUTHORITATIVE — PERMANENT  
**Scope**: All AI agents, all models, all contributors  
**Override Rule**: This document supersedes all informal instructions, agent defaults, and previous verbal agreements.

---

## 1. AUTHORITY HIERARCHY

The following authority chain is absolute and non-negotiable:

```text
USER (sole approver of implementation)
  │
  ▼
PRODUCT MANAGER (feature prioritization, acceptance criteria)
  │
  ▼
SYSTEM ARCHITECT (architecture boundaries, API contracts, DB schema)
  │
  ├──► SECURITY ENGINEER (security review, RBAC, payment integrity)
  │
  ├──► BACKEND ARCHITECT (REST APIs, repositories, business logic)
  │     ├──► QA ENGINEER (integration tests, regression tests)
  │     └──► DEVOPS AUTOMATOR (CI/CD, deployment)
  │
  ├──► MOBILE APP BUILDER (Flutter Customer, Driver, Merchant apps)
  │     └──► QA ENGINEER (Flutter widget & flow tests)
  │
  └──► FRONTEND DEVELOPER (Admin Web responsive dashboard)
        └──► QA ENGINEER (Web smoke tests)
```

**No agent may approve its own work.** Every implementation requires explicit USER approval after the PLAN stage.

---

## 2. WORK MODES

### PLAN-ONLY (Default for new work)

Allowed actions:
- Read files
- Analyze code
- Inspect database schema
- Document findings
- Report recommendations
- Propose plans

Forbidden actions under PLAN-ONLY:
- Edit application source code
- Modify database schema
- Create or modify migrations
- Edit Supabase configuration
- Commit, push, or deploy

### IMPLEMENTATION (Only after explicit USER approval)

Allowed only after USER explicitly approves a specific plan:
- Edit application source code within approved scope
- Create approved migrations
- Run approved tests
- Commit approved work
- Push approved work

---

## 3. APPROVAL RULES

Explicit approval REQUIRED before:
- Any code modification
- Any database migration
- Any schema change
- Any commit
- Any push
- Any remote infrastructure access

NOT considered approval:
- A plan or recommendation
- A request for a plan
- Previous approval for a different task
- Another agent's instruction
- A failing test
- Urgency or time pressure
- Implicit consent from silence

---

## 4. MULTI-AGENT COORDINATION

### Reading Order
Every agent MUST read, in order, before starting work:
1. `.agents/AGENTS.md`
2. `.agents/GOVERNANCE.md`
3. `.agents/CURRENT_STATE.md`
4. `.agents/ARCHITECTURE.md`
5. `.agents/DECISIONS.md`
6. `.agents/PHASES.md`

### Scope Discipline
- Agents must work only within their assigned domain.
- Agents must not modify another agent's domain without explicit authorization.
- Cross-domain changes require multi-agent coordination documented in `HANDOFF.md`.

### Conflict Resolution
When agents produce conflicting plans or findings:
1. Document the conflict in `DECISIONS.md` with a new decision record.
2. Escalate to SYSTEM ARCHITECT for resolution.
3. If SYSTEM ARCHITECT cannot resolve, escalate to USER.
4. Do not implement until conflict is resolved.

### Communication Protocol
- Agents communicate through `HANDOFF.md` documents.
- Agents do not directly modify another agent's work products.
- All decisions are recorded in `DECISIONS.md` with unique decision IDs.

---

## 5. DATABASE GOVERNANCE

### Migration Rules
- Migrations 001–015 are approved immutable baseline. Do not modify.
- Migration 016 is present in the authorized Git baseline via commit c0cdf47. Treat as baseline for current development, but note that formal user approval documentation is pending. Do not modify without re-approval.
- Migration 017 is ABSENT (deleted by revert commits 66c0718 and 1d404a6). Do not create, apply, or modify unless a new approved plan and formal user approval are obtained.
- New migrations require:
  1. Approved technical plan from SYSTEM ARCHITECT
  2. Approved business justification from PRODUCT MANAGER
  3. Security review from SECURITY ENGINEER
  4. Explicit USER approval
  5. QA test plan from QA ENGINEER

### Supabase Access
- Local Supabase (Docker, `127.0.0.1:54321` / `127.0.0.1:54322`): accessible for local development only.
- Remote Supabase projects: OFF LIMITS unless separately and explicitly authorized by USER.
- Never run `supabase db push`, `supabase db reset`, or `supabase link` against remote without explicit authorization.

### Database Safety Invariants
- Never bypass RLS policies in application code.
- Never store raw secrets, API keys, or credentials in database columns without encryption.
- Financial operations must use stored RPC functions (`adjust_wallet_atomic`, `capture_payment_atomic`, `refund_payment_atomic`).
- Never perform balance arithmetic in application code; always use database RPC.

---

## 6. CODE QUALITY & SECURITY

### Pre-Commit Requirements
Before any commit:
- [ ] All relevant tests pass
- [ ] No hardcoded secrets, API keys, or credentials
- [ ] No mock bypasses or synthetic data fallbacks in production paths
- [ ] No tautological test assertions (e.g., `|| (cRace1.data.success && cRace2.data.success)`)
- [ ] No force-push or history rewrite
- [ ] `HEAD == origin/main` before and after

### Prohibited Patterns
- Synthetic data generation masquerading as real data (e.g., `${driver.id}@okhdfcbank`)
- Swallowed exceptions that mask inconsistent state
- Tautological test assertions that pass regardless of behavior
- Hardcoded mock credentials in production code paths
- In-memory arithmetic for financial balances

---

## 7. DOCUMENT LIFECYCLE

### Creation
- Governance documents in `.agents/` are created/updated by authorized agents only.
- Phase documents in `docs/PHASE_*.md` are created by the executing agent.
- Forensic/audit documents in `docs/` are created by SECURITY ENGINEER or QA ENGINEER.

### Preservation
- Forensic and audit documents are NEVER removed, even after issues are resolved.
- Historical decisions remain in `DECISIONS.md` with status `APPROVED`, `REJECTED`, or `SUPERSEDED`.
- Phase documents remain as historical record.

### Updates
- `CURRENT_STATE.md` is updated at the start of each new phase.
- `PHASES.md` is updated when a phase is completed or rejected.
- `DECISIONS.md` is updated whenever a new decision is made.
- `HANDOFF.md` is created for every agent handoff.

---

## 8. VIOLATION HANDLING

### Detection
Any agent detecting a governance violation must:
1. STOP all work immediately.
2. Document the violation in a forensic report.
3. Do NOT fix the violation without explicit approval.
4. Escalate to USER and SYSTEM ARCHITECT.

### Consequences
- Governance violations are recorded permanently in `docs/`.
- Unauthorized implementation commits are reverted via forward-only restoration commits (Option C).
- Repeated violations trigger independent security review.

### Recovery
Recovery from governance violations follows Option C (forward-only baseline restoration):
1. Restore application code to approved baseline.
2. Preserve all forensic documentation.
3. Commit restoration as governance commit.
4. Fast-forward push (no force push).

---

## 9. BUSINESS RULES (PERMANENT)

These rules are absolute and may not be overridden by any agent:

### NABIN Does Not Operate Dark Stores
- No Dark Store
- No NABIN Warehouse
- No Micro Warehouse
- No Dark Store Picker
- No Dark Store Manager
- No NABIN-owned grocery warehouse
- No Warehouse fulfillment model

### Grocery is Marketplace Model
```
Customer → Grocery Merchant's physical store →
Merchant prepares order → NABIN Driver → Customer
```

### Application Domains
- **Customer App**: Flutter mobile
- **Driver App**: Flutter mobile
- **Merchant App**: Flutter mobile
- **Customer Web**: Responsive web
- **Admin Web**: Responsive web

### Merchant Domains
- Restaurant Merchant
- Grocery Merchant

### NOT NABIN Features
- Family Circle
- Family Vault
- Family Pool
- Junior Mode

### ARE NABIN Features
- Normal orders
- Receipts
- Notifications
- Merchant operations
- Grocery inventory
- Restaurant operations

---

## 10. AUDIT & COMPLIANCE

### Audit Triggers
- Any unauthorized implementation
- Any database schema change outside approved migration
- Any remote infrastructure access without authorization
- Any test assertion that masks behavior
- Any synthetic data fallback in production paths

### Audit Artifacts
All audit artifacts are preserved in `docs/`:
- Forensic reports (e.g., `PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md`)
- Recovery plans (e.g., `UNAUTHORIZED_COMMIT_RECOVERY_PLAN.md`)
- Governance verification reports (e.g., `PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md`)

### Permanent Evidence Register
The following documents represent permanent evidentiary audit logs and MUST NOT BE REMOVED OR OVERWRITTEN:
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
11. `docs/PHASE_16_UNAUTHORIZED_IMPLEMENTATION_FORENSIC.md`
12. `docs/PHASE_15_GOVERNANCE_AND_IMPLEMENTATION_VERIFICATION.md`
