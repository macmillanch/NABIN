# NABIN PHASE 3.3 — RESTAURANT MERCHANT IMPLEMENTATION ROADMAP

**Document ID:** NABIN-RM-ROADMAP-001  
**Date:** November 18, 2026  
**Scope:** Phased feature completion roadmap for NABIN Restaurant Merchant RMS + KDS.  

---

## 1. Roadmap Phasing Strategy

The remaining non-core screens and specialized modules are structured into prioritized implementation milestones to ensure incremental, test-driven delivery without destabilizing the verified P0 core.

### Phase 3.3.1: Core Onboarding & Profile Completion (P1)
- **Target Screens:** RM-004 through RM-007 (Business details, address, document upload, bank setup).
- **Backend Dependencies:** `POST /api/merchant/register`, `PATCH /api/merchant/:id/profile`.
- **Testing Criteria:** Form validation, image picker stubs, server persistence verification.

### Phase 3.3.2: Advanced Analytics & Revenue Insights (P1)
- **Target Screens:** RM-010, RM-011, RM-046 to RM-051 (Sales charts, dish velocity, daily settlement, tax/GST reports).
- **Backend Dependencies:** `GET /api/merchant/dashboard`, financial ledger RPC queries.
- **Testing Criteria:** Currency formatting verification, GST Section 9(5) compliance checks.

### Phase 3.3.3: Enterprise KDS & Order Workflows (P2)
- **Target Screens:** RM-014 through RM-020, RM-024, RM-025 (Accept/reject orders, prep-time adjustments, dispute management, kitchen station management).
- **Backend Dependencies:** `POST /api/merchant/orders/:id/status`, KDS display preference endpoints.
- **Testing Criteria:** Idempotent state transitions, audio/visual chime alert triggers.

### Phase 3.3.4: Thermal Printing & Invoicing Integration (P2)
- **Target Screens:** RM-040 through RM-045, RM-098 (Printer discovery, Bluetooth pairing, KOT slip layouts, customer bill templates, print queue diagnostics).
- **Backend Dependencies:** Printer configuration endpoints, ESC/POS formatter stubs.
- **Testing Criteria:** Print job queue status polling, layout preview rendering.

### Phase 3.3.5: Staff, RBAC & Support Workflows (P2)
- **Target Screens:** RM-052 through RM-060, RM-104 (Staff roles, quick PIN switcher, cash drawer handover, 24/7 helpdesk chat).
- **Backend Dependencies:** RBAC permissions API, support ticket management endpoints.
- **Testing Criteria:** PIN authentication gating, secure audit logging.

---

## 2. Testing & Quality Assurance Standards

- **Unit & Widget Tests:** Enforced via `mobile/test/` suite (`restaurant_dashboard_test.dart`, `restaurant_kds_orders_test.dart`, etc.).
- **Compliance:** Adherence to all 12 Cardinal Rules of Engagement, including zero silent tax rates and strict Supabase migration safety.

*End of Implementation Roadmap.*
