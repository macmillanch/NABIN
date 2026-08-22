# NABIN — Security & Compliance Audit Baseline

**Author**: Security Engineer Agent ([`security_engineer`](file:///c:/Users/Macmillan/OneDrive/Documents/nabin/.agents/skills/security_engineer/SKILL.md))  
**Source Agency Agent**: `msitarzewski/agency-agents`

## 1. Security Rules & Controls
- **Authentication**: JWT token validation on protected endpoints (`/api/admin/*`, `/api/user/*`, `/api/driver/*`).
- **Role-Based Access Control (RBAC)**: Fine-grained administrative permissions (`identity_verification.review`, `finance.refund`, `support.resolve`, `surge.edit`).
- **Identity Privacy**: Aadhaar and Voter ID numbers are strictly masked (`XXXX-XXXX-4892`) in API list responses. Full raw values accessible only under authorized KYC officer role audit.
- **Audit Trails**: Every administrative action (reviews, wallet credits, surge updates, promo creation) writes an immutable log entry into `db.auditLogs`.
- **Payment Privacy**: PCI-DSS card masking (e.g. `VISA **** 8888`), server-side coupon validation to prevent tampered discounts.

## 2. Input Validation
- Server-side sanitization of query params, pagination offsets, and body payloads to mitigate injection and parameter pollution.
