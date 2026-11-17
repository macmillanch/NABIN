# NABIN — COMPLETE GAP ANALYSIS & MISSING SCREEN REGISTER

**Document ID:** NABIN-GAP-ANALYSIS-001  
**Status:** PHASE 10 PLANNING DELIVERABLE  

---

## 1. Executive Summary

Comparing the **137 imported Stitch screens** against the **end-to-end user journeys** required by the Master PRD and statutory Indian multi-service requirements, the existing design ecosystem is **exceptionally rich (~85% complete)**, but exhibits specific operational gaps that must be planned before Flutter code synthesis.

---

## 2. Identified Gaps by Vertical

### A. Customer Super-App (Outer Shell)
1. **Mandatory Landmark Address Picker (Edge State):** While `NABIN-016`, `NABIN-017`, and `NABIN-018` exist, there is no screen enforcing a **missing landmark validation banner** when an address geocodes without an unambiguous Indian landmark.
2. **Multi-Service Floating Live Bar:** Super-App Home (`NABIN-021`) needs an explicit modular component showing simultaneous multi-vertical live states (e.g. active ride + grocery delivery in progress).

### B. NABIN Ride
1. **Multi-Stop Waypoints Selector:** `RIDE-002` and `RIDE-003` currently only present 1 pickup and 1 drop. Missing UI for adding intermediate stops (essential for Indian shared rides and errand commutes).
2. **Ride Start 4-Digit OTP Curbside Card:** `RIDE-009` displays the driver card, but needs an explicit high-contrast prominent 4-digit curbside OTP badge to prevent driver identity mismatch.

### C. NABIN Food
1. **Section 9(5) Tax Breakdown Modal:** `FOOD-009` and `FOOD-013` have item prices, but need an itemized statutory breakdown distinguishing restaurant cooked meal 5% GST from platform convenience fees.
2. **Merchant Prep Time Selector Feedback:** When restaurant updates prep time (10 to 30 mins), customer live tracker (`FOOD-016`) needs an animated timer adjustment banner.

### D. NABIN Grocery
1. **Kirana Item-Level GST Slabs:** `GROCERY-018` needs explicit statutory breakdown separating `0%` (unbranded grains/pulses), `5%`, `12%`, and `18%` retail items.
2. **Substituted Item Price Adjustment Notice:** When a replacement item is approved via `GROCERY-022`, the cart refund/additional payment adjustment ledger state must be explicitly rendered.

### E. NABIN Parcel
1. **Weight Class to Vehicle Auto-Assign (2W vs 3W):** `PARCEL-006` currently has weights, but needs explicit visual feedback explaining why parcels >15kg automatically lock into an 3-Wheeler Auto/Mini-truck rather than a 2-Wheeler motorcycle.
2. **Proof of Delivery (POD) Receiver Signature / Photo:** `PARCEL-023` requires a visual POD confirmation card with geotagged photo capture.
