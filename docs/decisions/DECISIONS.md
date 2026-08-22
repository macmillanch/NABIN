# NABIN — Key Architecture & Project Decisions

## Decision Record 001: Unified Backend Architecture
- **Date**: 2026-08-20
- **Status**: APPROVED
- **Decision**: All 4 client applications (Customer, Driver, Merchant, Admin) interface with a single Node.js backend (`backend/src/server.js`) and database instance (`backend/src/database.js`).
- **Rationale**: Eliminates data fragmentation, duplicate authentication logic, and out-of-sync payment engines.

## Decision Record 002: Agency Agents Integration
- **Date**: 2026-08-20
- **Status**: APPROVED
- **Decision**: Installed `msitarzewski/agency-agents` at `.agents/agency_agents/` and mapped specialist skills under `.agents/skills/`.
- **Rationale**: Enforces skill-first development protocols for Product, System Architecture, UI/UX Design, Backend Engineering, Mobile Builder, Security Audit, QA Testing, and DevOps.
