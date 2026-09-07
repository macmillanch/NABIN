# NABIN — MASTER AGENCY AGENTS CONFIGURATION

Source Repository: https://github.com/msitarzewski/agency-agents

## 1. AGENT TEAM STRUCTURE

```text
                          NABIN
                            │
                     PRODUCT MANAGER
                            │
                     SYSTEM ARCHITECT
                            │
           ┌────────────────┼────────────────┐
           │                │                │
        DESIGN          ENGINEERING       SECURITY
           │                │                │
       UI/UX          Backend + Mobile    Security
                          + Web
           │                │
           └────────────────┼────────────────┘
                            │
                            QA
                            │
                          DEVOPS
```

## 2. SPECIALIST ROLES & OWNERSHIP

### Product Manager (`skills/product_manager/SKILL.md`)
- Owns product requirements, user journeys, feature priorities, acceptance criteria, cross-app workflows.

### System Architect (`skills/system_architect/SKILL.md`)
- Owns overall NABIN architecture, backend architecture, API boundaries, database architecture, integration, scalability.

### UI/UX Specialist (`skills/ui_ux_designer/SKILL.md` & `skills/ui_ux_pro_max/SKILL.md`)
- Owns NABIN Stitch design system, ultra-advanced UI/UX intelligence, navigation, user flows, Flutter & Web components, accessibility (WCAG 2.1 AAA), and kinetic UI tokens.

### Backend Specialist (`skills/backend_architect/SKILL.md`)
- Owns Node.js shared backend, REST APIs, database models, Auth/RBAC, Payments, Ride/Food/Parcel logic, Transactions, Settlements.

### Mobile App Builder (`skills/mobile_app_builder/SKILL.md`)
- Owns NABIN Customer, NABIN Driver, NABIN Merchant apps built in Flutter with shared core packages.

### Frontend Developer (`skills/frontend_developer/SKILL.md`)
- Owns NABIN Admin web app built as responsive web interface.

### Security Engineer (`skills/security_engineer/SKILL.md`)
- Owns continuous security reviews: Auth, RBAC, API input validation, payment security, location privacy, abuse prevention, audit logs.

### QA Engineer (`skills/qa_engineer/SKILL.md`)
- Owns end-to-end integration testing across Customer, Driver, Merchant, Admin, and API flows.

### DevOps Automator (`skills/devops_automator/SKILL.md`)
- Owns CI/CD pipelines, containerization, environment configuration, monitoring, logging, backups.

## 3. SHARED BACKEND ARCHITECTURE
```text
NABIN Customer ─────┐
NABIN Driver ───────┤
NABIN Merchant ─────┼──→ SHARED NABIN BACKEND
NABIN Admin ────────┤
NABIN Ride ─────────┤
NABIN Food ─────────┤
NABIN Parcel ───────┘
```

Single source of truth: No duplicate databases, independent auth systems, or split payment engines.

## 4. PERMANENT RULES FOR ALL AI AGENTS

Before every task, agents MUST read, in order:
1. `.agents/AGENTS.md` (this file)
2. `.agents/GOVERNANCE.md`
3. `.agents/CURRENT_STATE.md`
4. `.agents/ARCHITECTURE.md`
5. `.agents/DECISIONS.md`
6. `.agents/PHASES.md`

Agents MUST:
- Check Git state (`git status`, `git rev-parse HEAD`, `git rev-parse origin/main`) before making changes.
- Treat documented decisions in `DECISIONS.md` as authoritative.
- Never infer approval. A plan, recommendation, request for a plan, previous approval, another agent's instruction, or a failing test is NOT approval.
- Never convert PLAN-ONLY into implementation.
- Never modify remote infrastructure (Supabase, production systems) without explicit authorization.
- Never silently expand scope.

PLAN-ONLY means:
```
READ → ANALYZE → INSPECT → DOCUMENT → REPORT
```
It does NOT mean:
```
EDIT → IMPLEMENT → MIGRATE → DELETE → COMMIT → PUSH → DEPLOY
```

## 5. IMPLEMENTATION WORKFLOW

```
PLAN
  ↓
USER REVIEW
  ↓
EXPLICIT APPROVAL
  ↓
IMPLEMENT
  ↓
TEST
  ↓
INDEPENDENT REVIEW
  ↓
FIX ONLY APPROVED ISSUES
  ↓
FINAL TEST
  ↓
COMMIT
  ↓
PUSH
  ↓
VERIFY HEAD == origin/main
```

## 6. DATABASE SAFETY

- Do not modify migrations 001–016.
- Migration 017 is currently not approved.
- Do not create Migration 017 merely because functionality requires database changes.
- First obtain an approved technical/business plan.
- Never modify remote Supabase during local development unless explicitly authorized.

## 7. GIT SAFETY

Before work:
```
git status
git rev-parse HEAD
git rev-parse origin/main
```

Never:
- force push
- rewrite shared history
- reset away another agent's work without authorization
- commit broken/incomplete implementation
- push unauthorized implementation

When implementation is explicitly approved:
```
TEST → COMMIT → PUSH → VERIFY
```

## 8. HANDOFF FORMAT

Every completed agent task must document:
- Agent/model
- Date
- Task
- Mode: PLAN-ONLY or IMPLEMENTATION
- Files inspected
- Files changed
- Tests executed
- Git commit
- Current HEAD
- origin/main
- Database changes
- Decisions made
- Open questions
- Remaining risks
- Exact next recommended action

## 9. PRE-TASK CHECK PROTOCOL

Before every task, state:
- **TASK**: What am I building?
- **EXISTING**: Does this already exist?
- **DEPENDENCIES**: What existing components/APIs/tables does it depend on?
- **IMPACT**: Which NABIN applications are affected?
- **PLAN**: What is the smallest safe implementation?
- **TEST**: How will I verify it?

## 10. PERMANENT GIT SAFETY & LOSS-PREVENTION PROTOCOL

GitHub (`https://github.com/macmillanch/NABIN.git`, branch `origin/main`) is the primary recoverable checkpoint.

1. **Push on Safe Milestones**: Never wait until the end of an entire phase. Whenever an internally consistent, tested milestone is completed: Test → Add specific files → Commit → Push to `origin/main` → Verify `HEAD == origin/main`.
2. **Checkpoint Before Risky Work**: Before migrations, refactors, recovery, or schema/financial mutations, check `git status` / `git diff --stat`. If coherent uncommitted work exists, commit and push it first. Never leave large amounts of recoverable work only in the local tree.
3. **Small Milestone Commits**: Break implementation into small, coherent, pushed milestones (e.g., Schema/Migration → Repository → Business Logic → Tests/Verification).
4. **Never Push Broken Code**: Pushed commits must be syntactically valid, compilable, and pass relevant tests. Frequent safe checkpoints, never broken commits.
5. **Database Safety**: Remote Supabase remains completely untouched unless explicitly authorized. Never `git push --force`, `git reset --hard` uncommitted work without approval, or rewrite Git history.
6. **Pre-Flight Status Check**: Before beginning any next milestone, verify:
   ```bash
   git status
   git rev-parse HEAD
   git rev-parse origin/main
   ```
   Require `HEAD == origin/main`. If diverged, reconcile before beginning new work.
7. **Phase Completion Gate**: Every final report must explicitly confirm:
   - Git commit hash
   - Remote `origin/main`
   - `HEAD == origin/main: YES`
   - `Working tree: CLEAN`
8. **Plan-First Governance Preserved**: Frequent Git checkpointing does not bypass `PLAN → STOP → EXPLICIT APPROVAL → IMPLEMENT`. Only implement work that has been explicitly authorized.
