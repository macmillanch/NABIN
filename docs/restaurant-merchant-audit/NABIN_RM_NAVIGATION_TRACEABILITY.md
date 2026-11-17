# NABIN RESTAURANT MERCHANT — NAVIGATION & WORKFLOW TRACEABILITY
## Screen-to-Screen Linkages, Modal Relationships & Business Requirement Traceability

**Document ID:** NABIN-RM-TRACE-008  
**Stitch Project ID:** `6689743337313822856`  
**Date:** November 18, 2026  
**Auditor Roles:** Flutter Solution Architect, Quality Assurance Lead  

---

## 1. APPLICATION SHELL ARCHETYPES & ENTRY POINTS

The Restaurant Merchant suite operates through three standardized Flutter shell templates:

1. **`Auth Blank Shell` (Zero Chrome):**
   - Entry: App launch $\rightarrow$ `RM-001` (Welcome).
   - Progression: `RM-001` $\rightarrow$ `RM-002` (Login) $\rightarrow$ `RM-003` (OTP).
   - If not verified: Redirects to `RM-004` through `RM-008` (Onboarding stepper).
   - If verified: Routes directly to `RM-104` (Dashboard).

2. **`Main Bottom-Tab Shell` (Persistent 5-Tab Navigation):**
   - **Tab 1: Home (`RM-104`):** Dashboard metrics, today's gross sales, quick store pause toggle (`RM-038`), analytics shortcut (`RM-010`, `RM-011`).
   - **Tab 2: Orders (`RM-102`):** Live incoming orders queue, accept modal (`RM-014`), reject modal (`RM-015`), prep time selector (`RM-016`), order details (`RM-013`), order history (`RM-020`).
   - **Tab 3: KDS (`RM-100`):** Kitchen Display System board, new queue (`RM-021`), preparing stage (`RM-022`), ready & expo hub (`RM-023`), station routing (`RM-024`), KDS settings (`RM-025`).
   - **Tab 4: Menu (`RM-026`):** Menu overview, categories (`RM-027`), dish manager (`RM-028`), add dish (`RM-029`), edit dish (`RM-030`), customization/modifiers (`RM-031`), availability scheduler (`RM-032`), bulk editor (`RM-033`).
   - **Tab 5: Finance (`RM-046`):** Payouts overview, daily statements (`RM-047`), transaction ledger (`RM-048`), commission breakdown (`RM-049`), bank accounts (`RM-050`), GST tax reports (`RM-051`).

3. **`Settings & Hardware Stack Shell` (Top Header with Back Chevron):**
   - Accessed from Dashboard profile avatar $\rightarrow$ `RM-034` (Restaurant Profile & Outlets), `RM-035` (Operating Hours), `RM-036` (Multi-Outlet Network), `RM-037` (Channels), `RM-098` (Thermal Printer Hub), `RM-040`–`RM-045` (Printer configuration stack).

---

## 2. MODAL & DIALOG RELATIONSHIPS

| Parent Screen | Trigger Action | Modal / Sheet Screen | Outcome / Next State |
|---|---|---|---|
| `RM-102` Live Orders | Tap "Accept Order" | `RM-014` Accept Modal + `RM-016` Prep Time | Order state becomes `ACCEPTED` $\rightarrow$ KOT printed $\rightarrow$ bumps to KDS `RM-021` |
| `RM-102` Live Orders | Tap "Reject Order" | `RM-015` Reject Order Dialog | Select reason $\rightarrow$ state becomes `CANCELLED` $\rightarrow$ auto-refund triggered |
| `RM-104` Dashboard | Tap "Emergency Pause" | `RM-038` Emergency Store Pause | Select duration (30m/1h/today) $\rightarrow$ store status becomes `PAUSED` |
| `RM-028` Dish Manager | Tap "Add Dish" | `RM-029` Add New Dish | Validates FSSAI/dietary inputs $\rightarrow$ dish added to catalog |
| `RM-028` Dish Manager | Tap dish row | `RM-030` Edit Dish | Update pricing/prep time $\rightarrow$ saves to database |
| `RM-030` Edit Dish | Tap "Manage Modifiers" | `RM-031` Dish Customization | Configure spice, size, extras $\rightarrow$ attaches modifier group to dish |
| `RM-098` Printer Hub | Tap "Add Printer" | `RM-040` Discovery & Pairing | Scans Bluetooth/LAN $\rightarrow$ pairs printer $\rightarrow$ opens `RM-041` |
| `RM-041` Printer Config | Tap "Preview KOT" | `RM-042` KOT Slip Layout | Displays simulated monospace ticket preview |
| `RM-041` Printer Config | Tap "Preview Bill" | `RM-043` Customer Bill Template | Displays simulated tax invoice layout |

---

## 3. DEAD-END & EXCEPTION AUDIT

* **Dead-End Check:** Every screen in the 51-screen inventory has either:
  1. A persistent bottom tab bar to switch contexts, OR
  2. A top app bar back chevron (`←`) returning to its parent stack.
* **Zero Dead Ends Found:** No orphaned screens or trap flows exist.
* **Role Restriced Boundaries:** Onboarding screens (`RM-004` to `RM-008`) are locked once the restaurant status is `APPROVED`. A verified restaurant cannot accidentally re-enter initial onboarding.

---

## 4. BUSINESS REQUIREMENT TRACEABILITY MATRIX

| Business Goal | Screen ID | User Action | Backend API | Database Transition | Verification Status |
|---|---|---|---|---|:---:|
| **Partner KYC** | `RM-006` | Upload FSSAI PDF | `POST /api/merchant/documents/upload` | `merchant_documents.status = 'PENDING'` | **VERIFIED** |
| **Instant Geofencing** | `RM-005` | Set 5km delivery radius | `PUT /api/merchant/profile` | `merchants.delivery_radius_km = 5.0` | **VERIFIED** |
| **Order Acceptance** | `RM-014` | Tap "Accept (+15m)" | `POST /api/restaurant/orders/:id/accept` | `orders.status = 'ACCEPTED'`, prep_time = 15 | **VERIFIED** |
| **Kitchen Ticket** | `RM-044` | Auto-trigger on Accept | Client Print Spooler (`RM-045`) | KOT prints on Kitchen Printer | **VERIFIED** |
| **Kitchen Progression**| `RM-022` | Tap "Start Cooking" | WebSocket event `KITCHEN_START` | `orders.status = 'PREPARING'` | **VERIFIED** |
| **Expo Dispatch** | `RM-023` | Check items & Bump | `POST /api/restaurant/orders/:id/ready` | `orders.status = 'READY_FOR_PICKUP'` | **VERIFIED** |
| **Rider Handover** | `RM-023` | Enter Rider OTP `4829` | `POST /api/restaurant/orders/:id/handover` | `orders.status = 'HANDED_OVER'` | **VERIFIED** |
| **Emergency Pause** | `RM-038` | Tap "Pause 1 Hour" | `POST /api/restaurant/pause` | `merchants.is_accepting_orders = false` | **VERIFIED** |
| **Daily Reconciliation**| `RM-047` | Tap "Download PDF" | `GET /api/restaurant/finance/statement` | Statement generated with net integer math | **VERIFIED** |
