# NABIN — REVISED NON-DESTRUCTIVE IMPLEMENTATION PLAN & BUSINESS RULES SPECIFICATION

**Document ID:** NABIN-REVISED-PLAN-002  
**Date:** November 17, 2026  
**Status:** AWAITING FINAL OWNER AUTHORIZATION  
**Governance Standard:** Zero Deletions • HSN-Based Tax Architecture • Aggregator Guidelines Alignment • Non-Destructive Preservation  

---

## 1. Zero-Deletion Preservation & Screen Immutability Procedure

### 1.1 Stitch Cloud Instance Invariant (176 Instances Protected)
Every single asset across the five Google Stitch projects will remain completely untouched and preserved:
- **NABIN Ride (`15895521349027986707`):** 16 UI Screens, 2 Architectural Specs, 5 System Assets.
- **NABIN Food (`7613683360643688164`):** 27 UI Screens, 1 Code Export Spec, 9 System Assets.
- **NABIN Grocery (`7916514387823717414`):** 33 UI Screens, 4 Technical Specs, 9 System Assets.
- **NABIN Parcel (`14684086286758455985`):** 26 UI Screens, 4 System Assets.
- **Customer Super-App (`489536988828642080`):** 35 UI Screens, 5 System Assets.
- **Total:** **176 instances preserved without any deletion, rename, move, or overwrite.**

### 1.2 Protocol for the 13 Duplicated Super-App Screens
- The 13 inner duplicate screens in `projects/489536988828642080` (`NABIN-072`, `NABIN-073`, `NABIN-075`, `NABIN-076`, `NABIN-082`, `NABIN-083`, `NABIN-084`, `NABIN-085`, `NABIN-091`, `NABIN-092`, `NABIN-093`, `NABIN-094`, `NABIN-095`) are **retained permanently** in the Super-App project as historical and reference design instances.
- **In the Flutter codebase (`apps/mobile-customer`):** Production navigation routes directly from Super-App Home (`NABIN-021`) to the modular service feature packages (`features/ride`, `features/food`, `features/grocery`, `features/parcel`). The 13 screens remain in Stitch for reference, preventing any design loss while keeping code modular and clean.

---

## 2. Revised Business-Rule Specifications

### A. Landmark Validation (`SA-GAP-01`)
*Classification: Proposed NABIN Platform Usability Rule (Non-Statutory)*

1. **Context & Rationale:**
   - In Tier-2 and Tier-3 towns (such as Kamalanagar, Mizoram) and unnumbered residential clusters across India, geo-coordinates alone frequently leave drivers/riders on unnamed arterial roads without clear destination visibility.
   - The landmark field is an operational mechanism designed to minimize delivery friction and driver cancellation rates.
2. **Operational Rule:**
   - By default, users are prompted to enter a descriptive landmark (recommended $\ge 4$ characters, e.g., *"Opposite Community Hall"*, *"Near Bazar Tiniali"*).
3. **Exceptions & Accessible Fallback:**
   - **Gated Societies & Formally Addressed Plots:** If an address has an explicit house/flat number, colony/society name, and PIN code, the landmark requirement is flagged as optional.
   - **User Override ("Skip Landmark"):** If a customer does not know or cannot provide a recognizable landmark, they may tap *"Deliver without landmark — I will guide over call/chat"*. This bypasses the prompt and automatically appends a `"Guide on Call"` tag to the dispatch order.
   - **Auto-Suggestions:** The address selector queries local landmarks via Places/OSM and provides one-tap suggestion chips (e.g., *"Near SBI ATM"*, *"Near Primary School"*).

---

### B. Ride Multi-Stop Workflow & Pricing (`RD-GAP-01`)
*Classification: Configurable Platform Policy & Regulatory Alignment*

1. **Context & Regulatory Framework:**
   - Under the **Ministry of Road Transport and Highways (MoRTH) Motor Vehicle Aggregator Guidelines 2020** (§13 on Fare Principles) and applicable State Aggregator Rules:
     - Base fares, surge boundaries, and cancellation policies are subject to state-notified rate ceilings.
     - MoRTH Guidelines provide that surge pricing must not exceed **1.5x of the base fare** (and minimum discount not lower than 50% of the base fare), subject to specific state transport department gazettes.
2. **Stop Limits & Stop Charges:**
   - **Stop Limit:** Maximum of **2 intermediate stops** ($S_1, S_2$) per ride booking (proposed platform operational rule to avoid driver exhaustion and route divergence).
   - **Fare Configuration:** Additional stop charges (e.g. nominal ₹25 per stop) and waiting charges beyond free curbside waiting (e.g. ₹2.00–₹2.50/min after 3 minutes) are **dynamic parameters configured in the City Rate Card database** (`city_rate_cards` table in PostgreSQL), never hardcoded.
   - State-specific gazetted ceilings automatically clamp the total calculated fare before customer confirmation.

---

### C. Restaurant & Food Tax Treatment Review (`FD-GAP-01`)
*Classification: Statutory Review under Indian GST Law*

Under the Central Goods and Services Tax (CGST) Act, 2017 and relevant CBIC circulars:
1. **Restaurant Meals (Section 9(5) CGST Act):**
   - The Electronic Commerce Operator (ECO / NABIN) is liable to pay GST on restaurant services provided through it.
   - **Rate:** 5% GST (2.5% CGST + 2.5% SGST) for standalone restaurants, provided no Input Tax Credit (ITC) is claimed.
   - *Hotel Exception:* Restaurants located inside hotel premises having declared room tariff of ₹7,500/night or above attract **18% GST with ITC**. The tax engine reads the `merchant.gst_tier` attribute from the database.
2. **Restaurant Packaging Charges:**
   - Under the principle of **composite supply** (Section 2(30) and Section 8 of the CGST Act), packaging is ancillary to the principal supply of food; it adopts the GST rate of the meal (typically 5%).
3. **Platform Convenience Fee:**
   - Taxed at **18% GST** (SAC 9985 / Support Services) as independent platform consideration.
4. **Delivery Partner Fee:**
   - If collected on behalf of an un-registered delivery partner, ECO tax treatment under marketplace guidelines applies; if supplied directly by platform, 18% GST (SAC 9968) applies.
5. **Customer Tips:**
   - 100% pure voluntary gratuity passed directly to the driver/rider; **0% GST**.
6. **Implementation Approach:**
   - The UI displays an itemized tax breakdown modal verified and generated dynamically by the backend Tax Engine (`backend/src/services/TaxEngineService.js`), without hardcoding fixed percentages.

---

### D. Kirana / Grocery HSN-Based Tax Catalogue (`GR-GAP-01`)
*Classification: Harmonized System of Nomenclature (HSN) Tax Architecture*

1. **Regulatory Framework:**
   - Under CBIC notifications (including Notification No. 6/2022 and 7/2022 - Central Tax (Rate)), grocery items cannot be classified by broad product names alone. Tax liability depends strictly on **8-digit HSN codes, pre-packaging, and labelling criteria**:
     - *Unbranded, loose grains/pulses (e.g. HSN 1006 loose rice):* **0% GST (Nil-rated)**.
     - *Pre-packaged and labelled pulses/grains ($\le 25$ kg):* **5% GST**.
     - *Packaged dairy/cheese (HSN 0406):* **12% GST**.
     - *Soaps, cosmetics, household chemicals (HSN 3401/3402):* **18% GST**.
     - *Aerated beverages containing added sugar (HSN 2202):* **28% GST + Compensation Cess**.
2. **Dynamic Tax Engine Architecture:**
   - Every grocery SKU in the database references an authoritative `hsn_code`, `is_prepackaged_labelled` boolean flag, and `effective_date`.
   - The UI invoice screen renders tax dynamically itemized by HSN category:
     $$\text{Total GST} = \sum_{\text{HSN}} \left( \text{TaxableValue}_{\text{HSN}} \times \text{Rate}_{\text{HSN}} \right)$$
   - Generates statutory-compliant GSTR-1 B2C invoice breakdowns.

---

## 3. Detailed UI Design & Screen Connection Specifications for the 4 Additions

### Addition 1: `SA-GAP-01` — Landmark Validation & Correction Guard
- **Project:** Customer Super-App (`489536988828642080`)
- **Visual Design:**
  - Modern, non-intrusive bottom sheet with a soft warning tint (`#FEF3C7` header banner).
  - Highlighting the detected locality and pin.
  - Prominent input field with Royal Blue focus ring (`#1A3BA2`), labeled *"Nearby Landmark (e.g., Near SBI Bank, Opp Market)"*.
  - Three quick-select suggestion pills populated from nearby landmarks.
  - Secondary accessible action button: *"Deliver without landmark — I'll guide via call/chat"*.
  - Primary CTA button: *"Save Landmark & Continue"*.
- **Connected Screens:**
  - **Preceding Screen:** `NABIN-016` (Location Setup) and `NABIN-018` (Pin Confirmation).
  - **Succeeding Screen:** `NABIN-021` (Main Marketplace Home) or active checkout screen.

---

### Addition 2: `RD-GAP-01` — Ride Multi-Stop Waypoints Selector
- **Project:** NABIN Ride (`15895521349027986707`)
- **Visual Design:**
  - Connected vertical waypoint timeline with Royal Blue pickup pin (`#1A3BA2`), intermediate amber stop dot (`#D97706`), and crimson drop pin (`#DC2626`).
  - Add Stop button (disabled after 2 stops) with informative pill: *"Max 2 stops per trip"*.
  - Real-time route recalculation preview card with estimated arrival time at each stop.
  - Notice pill: *"Free 3-minute waiting at intermediate stops; standard waiting rate thereafter"*.
  - Action button: *"Confirm Route with Stops"*.
- **Connected Screens:**
  - **Preceding Screen:** `RIDE-002` (Location Search & Suggestions).
  - **Succeeding Screen:** `RIDE-003` (Map Pin Confirmation) and `RIDE-004` (Category Selection & Fare Breakdown).

---

### Addition 3: `FD-GAP-01` — Section 9(5) Statutory Food Tax & Fee Modal
- **Project:** NABIN Food (`7613683360643688164`)
- **Visual Design:**
  - Tactile white bottom sheet with drag handle, titled *"Taxes & Charges Breakdown"*.
  - **Itemized Section 1:** Restaurant Food GST (Item total $\times$ Restaurant GST tier; cites *"Govt. GST under Section 9(5) on restaurant services"*).
  - **Itemized Section 2:** Restaurant Packaging & Processing Charge.
  - **Itemized Section 3:** Delivery Partner Fee & Platform Convenience Fee (18% GST itemized separately).
  - **Itemized Section 4:** Voluntary Rider Tip (noted as *"100% directly transferred to driver; zero tax"*).
  - Clear total reconciliation matching cart total.
  - Close CTA: *"Understood"*.
- **Connected Screens:**
  - **Preceding Screen:** `FOOD-009` (Food Cart) and `FOOD-013` (Order Review & Checkout).
  - **Succeeding Screen:** Returns smoothly to `FOOD-009` / `FOOD-013`.

---

### Addition 4: `GR-GAP-01` — HSN-Based Multi-Slab Grocery Tax & Adjustment Ledger
- **Project:** NABIN Grocery (`7916514387823717414`)
- **Visual Design:**
  - Clean card module titled *"Tax Invoice & Item Ledger"*.
  - Table grouping items by statutory HSN and tax slab:
    - `0% Nil-Rated` (Loose staples, pulses, vegetables)
    - `5% Essentials` (Packaged branded flour, edible oil)
    - `12% Packaged Foods` (Butter, dairy products)
    - `18% Household Goods` (Toiletries, cleaners)
  - **Picking Price Delta Ledger:** Clearly itemizing replaced items:
    - *Original Item vs Substituted Item* price difference.
    - Automatic note: *"₹XX credited to NABIN Wallet for lower-priced substitution"*.
  - Action button: *"Download Formal GST Tax Invoice (PDF)"*.
- **Connected Screens:**
  - **Preceding Screen:** `GROCERY-018` (Checkout Review) and `GROCERY-026` (Order Delivered & Bill).
  - **Succeeding Screen:** Returns to `GROCERY-026` or Super-App Activity History.

---

## 4. Implementation Phasing Matrix

```
[PHASE 11] — OWNER REVIEW & FINAL AUTHORIZATION (CURRENT STATE)
    │
    ▼ (Upon Explicit Approval)
[PHASE 12] — NON-DESTRUCTIVE GOOGLE STITCH GAP CREATION
    ├── Create `SA-GAP-01` in Super-App Project (`489536988828642080`)
    ├── Create `RD-GAP-01` in Ride Project (`15895521349027986707`)
    ├── Create `FD-GAP-01` in Food Project (`7613683360643688164`)
    ├── Create `GR-GAP-01` in Grocery Project (`7916514387823717414`)
    └── Post-Creation Re-Audit (Verify all 176 pre-existing instances remain untouched)
    │
    ▼
[PHASE 13] — FLUTTER MODULE CODE SYNTHESIS (`apps/mobile-customer`)
    ├── Core Router & Shared Super-App Shell Navigation
    ├── Modular Inner Service Package Integration
    └── Verified E2E Connectivity with Backend Fastify API
```

---

## 5. Confirmation of Zero-Deletion Safety Gate

Per your instruction, **no changes will be made in Google Stitch until you review this revised plan and provide your explicit authorization.**
All 176 existing instances remain 100% intact, and all original IDs are preserved.
Whenever you are ready, please confirm your authorization to proceed with Phase 12!
