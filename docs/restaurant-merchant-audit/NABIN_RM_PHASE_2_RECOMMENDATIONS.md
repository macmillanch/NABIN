# NABIN RESTAURANT MERCHANT — PHASE 2 RECOMMENDATIONS & ROADMAP
## Strategic Enhancements, Secondary Screens Generation & Hardware Verification Plan

**Document ID:** NABIN-RM-ROADMAP-010  
**Stitch Project ID:** `6689743337313822856`  
**Date:** November 18, 2026  
**Auditor Roles:** Principal Product Designer, Restaurant Technology Architect, Flutter Solution Architect  

---

## 1. PHASE 2 STRATEGIC OVERVIEW

While Phase 1 Flutter implementation establishes the foundational restaurant revenue engine across 51 operational screens, Phase 2 expands the platform into a multi-staff, enterprise-grade restaurant operating system.

---

## 2. PHASE 2 IMPLEMENTATION WORKSTREAMS

### Workstream 1: Secondary Screens Generation in Google Stitch
Following Phase 1 Flutter delivery and owner review, generate the 9 identified secondary screens in Stitch project `6689743337313822856`:

1. **`RM-009 — Quick App Tour & RMS Feature Highlights`:**
   - 3-card swipeable carousel introducing Live Orders, KDS Bump Bar, and Daily Settlements.
2. **`RM-012 — Incoming Order Full-Screen Chime Overlay`:**
   - High-urgency overlay with flashing border, 120-second acceptance countdown, and loud looping audio tone.
3. **`RM-019 — Dispute Resolution Case Detail & Evidence Viewer`:**
   - High-resolution photographic evidence inspector for customer complaints (spillages, missing items).
4. **`RM-039 — Holiday & Seasonal Scheduled Closure Calendar`:**
   - Multi-day calendar selector allowing merchants to pre-schedule festival closures (Diwali, Christmas, local holidays).
5. **`RM-052 — Staff Management & Role-Based Access Control (RBAC)`:**
   - Staff directory with granular permission toggles: *Manager (Full Access), Cashier (Billing & Orders), Head Chef (KDS & Menu), Expo (Handover Only)*.
6. **`RM-053 — Kitchen Staff Quick PIN Switcher`:**
   - 4-digit PIN numpad overlay enabling rapid cook profile switching on shared kitchen tablets.
7. **`RM-054 — Daily Shift Handover & Cash Drawer Reconciliation`:**
   - Cash-on-Delivery physical currency count reconciliation at end of shift with discrepancy logging.
8. **`RM-055 — Merchant Notification Centre & Platform Broadcasts`:**
   - In-app notification feed for commission tier changes, festive promos, and operational advisories.
9. **`RM-056 — 24/7 Merchant Helpdesk & Live Dispute Chat`:**
   - In-app live chat client with ticketing queue and phone callback request.

---

### Workstream 2: Physical Thermal Printer Hardware Verification
* **Hardware Procurement & Lab Testing:**
  - Secure physical test units:
    1. **58mm Bluetooth BLE Printer:** (e.g., Epson TM-P20II / Sunmi V2 / generic ESC/POS).
    2. **80mm LAN/Wi-Fi Kitchen Printer:** (e.g., Epson TM-T88VI / Star Micronics TSP143III).
  - Verify actual physical baud rates, paper cutting mechanism, multi-language font rendering, and zero duplicate print guarantees.
* **Transition from Simulation to Verified Status:**
  - Update `NABIN_RM_WORKFLOW_VALIDATION.md` and `NABIN_SHARED_PRINTER_ARCHITECTURE.md` with physical test logs and photos upon successful device execution.

---

### Workstream 3: Automated Penny-Drop Banking API Integration
* **Provider Evaluation:**
  - Evaluate Cashfree Payments Bank Account Verification API or Razorpay Fund Account Validation.
  - Implement automated instant ₹1.00 deposit with bank registered name fuzzy-matching against the merchant's uploaded PAN card name.
* **Security & Failure Handling:**
  - If fuzzy-match score is $< 80\%$, route bank details to the NABIN internal ops admin verification queue without blocking document review.

---

### Workstream 4: Multi-Outlet Enterprise Synchronisation
* **Central Kitchen to Multi-Branch Inventory Sync:**
  - Implement master menu replication from brand headquarters to regional branch outlets (`RM-036`).
  - Centralized raw material stock tracking across multiple kitchen stations.

---

## 3. PHASE 1 TO PHASE 2 TRANSITION GATEWAY

```
┌────────────────────────────────────────────────────────┐
│             PHASE 1 (CURRENT AUDIT & MVP)              │
│  • 51 Operational Screens Audited & Validated          │
│  • Core Revenue Engine: Onboarding, KDS, Menu, Orders  │
│  • Software Thermal Printer Service & Spooler          │
│  • Owner Approval Gate: Review Audit Reports           │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Owner Authorization)
┌────────────────────────────────────────────────────────┐
│               PHASE 1 FLUTTER EXECUTION                │
│  • Build Flutter Restaurant Merchant App (51 Screens)  │
│  • Connect Existing Node.js Backend & Supabase DB      │
│  • Execute Automated Widget & Integration Tests        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼ (Pilot Deployment)
┌────────────────────────────────────────────────────────┐
│                  PHASE 2 ROADMAP EXPANSION             │
│  • Generate 9 Secondary Stitch Screens (RM-052 to 056) │
│  • Physical Printer Hardware Lab Verification          │
│  • Penny-Drop Automated Banking API Integration        │
│  • Multi-Outlet Master Catalog Replication             │
└────────────────────────────────────────────────────────┘
```
