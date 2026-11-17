# NABIN RESTAURANT MERCHANT — MISSING SCREENS & DELTA REGISTER
## Gap Analysis Between Target 60-Screen Specification and Active 51-Screen Inventory

**Document ID:** NABIN-RM-MISSING-004  
**Stitch Project ID:** `6689743337313822856`  
**Date:** November 18, 2026  
**Auditor Roles:** Principal Product Designer, Restaurant Technology Architect, Flutter Solution Architect  

---

## 1. DELTA SUMMARY & GAP CENSUS

The earlier theoretical product roadmap outlined 60 distinct screens for the mature enterprise Restaurant Merchant suite. The current active project in Google Stitch contains **51 operational UI screens**, **1 architecture documentation canvas**, **2 brand logo assets**, and **1 design system asset** (55 total instances).

$$\text{Theoretical Specification} = 60 \text{ Screens}$$
$$\text{Active Designed UI Screens} = 51 \text{ Screens}$$
$$\mathbf{Identified\ Gap\ Delta} = \mathbf{9\ Screens}$$

All 9 gap screens belong to **secondary operational, back-office, or staff administration workflows**. None of the 9 gap screens block the four core revenue and kitchen fulfilment journeys.

---

## 2. DETAILED REGISTER OF IDENTIFIED GAPS

| # | Missing Screen ID | Screen Title | Intended Module | Priority | Functional Role & Gap Analysis | Recommendation |
|---|---|---|---|:---:|---|---|
| 1 | `RM-009` | Quick App Tour & RMS Feature Highlights | Onboarding | P3 (Low) | Educational walk-through displayed immediately after account activation before reaching the Dashboard. Currently, onboarding advances directly from `RM-008` (Verification Progress) to `RM-104` (Dashboard). | **Subsume into Dashboard tooltips** during Phase 1; design separate tour in Phase 2. |
| 2 | `RM-012` | Incoming Order Audio/Visual Chime Alert Overlay | Order Management | P2 (Medium) | Full-screen urgent chime overlay when an order arrives while the merchant is on another screen. Currently, `RM-102` (Live Order Management) handles order inflow in a dedicated tab. | **Implement as Flutter overlay dialog** in Phase 1 without needing separate Stitch screen. |
| 3 | `RM-019` | Order Dispute Case Detail & Evidence Viewer | Order Management | P2 (Medium) | Detailed photographic evidence viewer for food damage / missing item disputes. Currently, `RM-017` (Customer Order Issues) and `RM-018` (Cancellation & Refund) cover the essential dispute states. | **Phase 2 Expansion**. Current `RM-017` is fully sufficient for MVP pilot. |
| 4 | `RM-039` | Scheduled Holiday & Seasonal Closure Calendar | Operations | P2 (Medium) | Multi-day holiday calendar. Currently, `RM-035` (Operating Hours) and `RM-038` (Emergency Store Pause) provide store open/pause controls. | **Phase 2 Expansion**. `RM-038` covers immediate store closure needs. |
| 5 | `RM-052` | Staff Management & Role-Based Access (RBAC) | Staff & Security | P1 (High) | Staff member list (Manager, Head Chef, Cashier, Expo) with access permission toggles. | **Slated for Phase 2**. Single-login restaurant profile is sufficient for single-store pilot. |
| 6 | `RM-053` | Kitchen Staff Quick PIN Switcher | Staff & Security | P2 (Medium) | 4-digit PIN lock screen on shared tablet KDS allowing cooks to clock in or switch active cook profiles. | **Slated for Phase 2**. |
| 7 | `RM-054` | Daily Shift Handover & Cash Drawer Reconciliation | Finance / Operations | P2 (Medium) | Physical cash drawer count balancing at shift close (Cash on Delivery receipts vs physical notes). | **Slated for Phase 2**. Digital settlement statement (`RM-047`) satisfies financial audit. |
| 8 | `RM-055` | Merchant Notifications & Broadcast Announcements | Support & Ops | P3 (Low) | Dedicated inbox for platform policy updates, festival promotions, and service alerts. | **Slated for Phase 2**. Urgent alerts appear on `RM-104` Dashboard banner. |
| 9 | `RM-056` | 24/7 Merchant Helpdesk & Live Dispute Chat | Support | P2 (Medium) | Direct ticketing and live chat interface with NABIN merchant support agent. | **Slated for Phase 2**. Emergency contact phone number is provided in `RM-034`. |

---

## 3. IMPACT ANALYSIS ON PHASE 1 FLUTTER IMPLEMENTATION

| Core Journey | Missing Screens | Operational Blockers | Flutter Phase 1 Feasibility |
|---|:---:|:---:|:---:|
| **Journey 1: Onboarding** | `RM-009` | None (Direct progression to Dashboard is standard practice) | **100% FEASIBLE** |
| **Journey 2: Orders & KDS** | `RM-012`, `RM-019` | None (`RM-102`, `RM-014`, `RM-015`, `RM-021-023` provide complete lifecycle) | **100% FEASIBLE** |
| **Journey 3: Thermal Printing**| None (0) | None (`RM-098`, `RM-040-045` are 100% designed) | **100% FEASIBLE** |
| **Journey 4: Finance & GST** | None (0) | None (`RM-046-051` are 100% designed) | **100% FEASIBLE** |

---

## 4. ARCHITECTURAL RECOMMENDATION

1. **Phase 1 Execution Boundary:** Proceed with Flutter development of the **51 designed UI screens**, covering 100% of the core revenue-generating restaurant operations.
2. **Phase 2 Expansion Scope:** Authorize the design and implementation of the 9 secondary support screens (`RM-009`, `RM-012`, `RM-019`, `RM-039`, `RM-052` to `RM-056`) as an independent Phase 2 milestone once live pilot operations in Kamalanagar are established.
