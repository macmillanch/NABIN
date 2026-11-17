# NABIN — CUSTOMER SUPER-APP UI/UX AUDIT & DEFECT REPORT

**Document ID:** NABIN-UX-DEFECTS-003  
**Date:** November 18, 2026  
**Auditor Roles:** Senior Mobile UI/UX Designer, Flutter Solution Architect  
**Evaluation Standard:** Material 3, Apple HIG, WCAG 2.1 AAA Accessibility  

---

## 1. EXECUTIVE SUMMARY

This document categorizes all visual, layout, interaction, and accessibility issues observed across the **NABIN Customer Super-App** Flutter screens and Google Stitch designs. The defects are triaged by severity: **Critical (P0)**, **High (P1)**, and **Medium/Low (P2)**.

---

## 2. DEFECT LOG & DETAILED ANALYSIS

### 2.1 Critical Severity (P0) — Navigation & Structural Disconnections

| Defect ID | Screen / Component | Violation / Issue | UX Impact | Remediation Plan |
|---|---|---|---|---|
| **UX-P0-01** | Address Setup Flow (`NABIN-018` $\rightarrow$ `Home`) | Absence of Landmark Verification step (`SA-GAP-01`) | Drivers and couriers face delivery failure in rural/unmapped areas. | Insert `SA-GAP-01` (`/address-landmark-guard`) after map pin adjustment, prompting for a descriptive landmark with accessible skip. |
| **UX-P0-02** | Ride Route Planning (`RIDE-002`) | Absence of Multi-Stop Waypoint addition (`RD-GAP-01`) | Passengers traveling with children or errands cannot book multi-stop routes. | Integrate `RD-GAP-01` (`/ride-multi-stop`) between destination search and vehicle selection. |
| **UX-P0-03** | Food Checkout (`FOOD-013` / `food_checkout_screen.dart`) | Omission of Section 9(5) CGST statutory breakdown modal (`FD-GAP-01`) | Violates statutory tax disclosure mandates; customers cannot see food vs packaging vs platform GST. | Mount `FD-GAP-01` as an interactive bottom sheet on tap of the "Taxes & Charges" row. |
| **UX-P0-04** | Grocery Order Status (`GROCERY-018` / `grocery_order_status_screen.dart`) | Omission of Picking Price Delta & Substitution Ledger (`GR-GAP-01`) | Customer is unaware of item replacements or automatic wallet refunds. | Provide a sticky CTA button "View Tax Invoice & Item Ledger" linking directly to `GR-GAP-01`. |

---

### 2.2 High Severity (P1) — Visual Hierarchy, Color Consistency & Touch Targets

| Defect ID | Screen / Component | Issue Description | Standards Violated | Corrective Action |
|---|---|---|---|---|
| **UX-P1-01** | Service Accent Discrepancy | In Flutter `nabin_tokens.dart`, `foodOrange` is `#E8590C`, while Stitch Design System specifies `#E85D24`. Grocery is `#12A150` vs Stitch `#16834A`. | Brand drift across platforms. | Align Flutter tokens with official Stitch master tokens (`Food: #E85D24`, `Grocery: #16834A`). |
| **UX-P1-02** | Touch Target Boundaries | Quick-add "+" buttons and dietary badges in product cards measure 36x36dp visual footprint. | WCAG 2.1 AAA minimum 48x48dp interactive bounding box. | Wrap compact icons in an expanded hit-test padding container (`min 48x48dp`). |
| **UX-P1-03** | Currency Integer Alignment | Price labels in cart line items and receipts use proportional fonts, causing jagged vertical alignment. | Tabular figure alignment (`tnum`). | Apply `fontFeatures: [FontFeature.tabularFigures()]` across all currency values. |
| **UX-P1-04** | Dietary Signifier Consistency | Food category and restaurant menu screens lack consistent Veg/Non-Veg/Egg square badge frames. | FSSAI food labeling statutory guidelines. | Standardize `16x16dp` bordered square with solid green circle (Veg), red triangle (Non-Veg), or amber circle (Egg). |

---

### 2.3 Medium Severity (P2) — Information Density & Empty States

| Defect ID | Screen / Component | Issue Description | Remediation Plan |
|---|---|---|---|
| **UX-P2-01** | Universal Search (`NABIN-022`) | Search results list lacks clear vertical partitioning (e.g. searching "chicken" returns biryani dishes and raw chicken mixed together). | Group search results into segmented sections: "Restaurants & Dishes" vs "Grocery & Fresh Meat". |
| **UX-P2-02** | Empty Search State (`NABIN-025`) | Displays a flat "No results found" text without trending suggestion chips. | Introduce one-tap trending suggestion chips ("Fresh Milk", "Auto Ride", "Chicken Biryani"). |
| **UX-P2-03** | Offline Error State (`NABIN-061`) | The offline warning in `customer_home_screen.dart` is an invasive full-screen block rather than a non-blocking toast/banner when cached data exists. | Allow cached catalog browsing while displaying a top ambient offline banner with auto-reconnect polling. |
| **UX-P2-04** | Obsolete DarkStore Reference | Code comment in `app_router.dart:224` reads `"NABIN Grocery Express (10-Minute DarkStore)"`. | Revise to `"NABIN Grocery (Local Kirana & Supermarket Marketplace)"` to respect Cardinal Rule 2. |

---

## 3. ACCESSIBILITY COMPLIANCE AUDIT (WCAG 2.1 AAA)

| Checkpoint | Target Standard | Current Audit Finding | Status |
|---|---|---|:---:|
| **Color Contrast (Text on Surface)** | $\ge 7:1$ (AAA Normal Text) | Slate Navy `#172033` on `#FFFFFF` measures **14.2:1** | **PASSED** |
| **Color Contrast (Secondary Text)** | $\ge 4.5:1$ (AA Minimum) | Slate Grey `#64748B` on `#FFFFFF` measures **4.6:1** | **PASSED** |
| **Touch Target Dimensions** | Minimum $48 \times 48\text{ dp}$ | Core buttons satisfy 48dp; mini steppers need expanded hitboxes | **NEEDS WORK** |
| **Font Scaling (Dynamic Type)** | Text survives $200\%$ scale without clipping | Card height in menu item needs `maxLines: 2` with auto-ellipsizing | **NEEDS WORK** |
| **Screen Reader Semantics** | Proper `Semantics` labels on interactive icons | Heart favorite and cart stepper icons need explicit semantic labels | **NEEDS WORK** |

---

## 4. SUMMARY RECOMMENDATION

All identified UX issues can be resolved entirely through non-destructive Flutter code adjustments and GoRouter mounting, with zero breaking modifications to pre-existing Google Stitch screens.
