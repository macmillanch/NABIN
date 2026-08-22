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

### UI/UX Specialist (`skills/ui_ux_designer/SKILL.md`)
- Owns NABIN design system, navigation, user flows, Flutter & Web components, accessibility, kinetic UI tokens.

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

## 4. PRE-TASK CHECK PROTOCOL
Before every task, state:
- **TASK**: What am I building?
- **EXISTING**: Does this already exist?
- **DEPENDENCIES**: What existing components/APIs/tables does it depend on?
- **IMPACT**: Which NABIN applications are affected?
- **PLAN**: What is the smallest safe implementation?
- **TEST**: How will I verify it?
