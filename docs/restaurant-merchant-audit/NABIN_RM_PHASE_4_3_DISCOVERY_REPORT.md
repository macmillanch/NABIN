# NABIN PHASE 4.3 — RESTAURANT MERCHANT DISCOVERY REPORT
## Restaurant Management, Configuration and Operational Workflows

**Document ID:** NABIN-RM-PHASE4-3-DISCOVERY-001  
**Date:** November 19, 2026  
**Authoritative Reviewer:** Senior Flutter & Backend Integration Lead (Kilo Code)  
**Milestone Scope:** Restaurant Management, Configuration and Operational Workflows (9 Screens).  

---

## 1. Executive Discovery Summary

This discovery report establishes the exact screen allocation, visual assets, backend contracts, database persistence layer, and implementation architecture for **Phase 4.3** of the NABIN Restaurant Merchant platform.

### Canonical Screen Allocation (9 Screens):
1. **RM-009:** Quick App Tour & RMS Feature Highlights
2. **RM-026:** Menu Overview
3. **RM-027:** Menu Categories
4. **RM-028:** Dish Management
5. **RM-029:** Add New Dish
6. **RM-030:** Edit Dish
7. **RM-031:** Dish Customization Management
8. **RM-032:** Menu Availability & Scheduling
9. **RM-033:** Bulk Menu Management

---

## 2. Screen-by-Screen Inventory & Specifications

### 1. RM-009: Quick App Tour & RMS Feature Highlights
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-009_quick_app_tour_rms_feature_highlights.html`
- **Resource ID:** `896b42b6a78248c5a297eefae5ce1982`
- **Core Purpose:** Visual feature walkthrough for newly approved or onboarded merchants. Highlights the real-time order stream, KDS kitchen display, instant 86'd menu control, and automated daily payouts.
- **Controls & Actions:** Step progress meter, feature hero cards, "Skip Tour" button, "Explore Dashboard" CTA.
- **Status:** **DISCOVERED & PLANNED**.

### 2. RM-026: Menu Overview
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-026_menu_overview.html`
- **Resource ID:** `468e826858bc4436940f90e5445214e2`
- **Core Purpose:** High-level menu performance console. Features 4 quick metric cards (Total Active Dishes, Live Categories, 86'd Items, Under Review), category sales volume sparkline, top revenue driver showcase ("Chicken Momo Special"), and quick action triggers.
- **Controls & Actions:** "Add New Dish", "Bulk Operations", "Availability & Shifts", category pills.
- **Status:** **DISCOVERED & PLANNED**.

### 3. RM-027: Menu Categories
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-027_menu_categories.html`
- **Resource ID:** `0ce05f6e6bc6491e847c2b0409a13ea2`
- **Core Purpose:** Category taxonomy and reordering manager. Allows merchants to define food categories, assign preparation stations, toggle availability, and arrange sequence for the customer app.
- **Controls & Actions:** Drag-and-drop reorder handles, category status toggles, category creation modal, station tags.
- **Status:** **DISCOVERED & PLANNED**.

### 4. RM-028: Dish Management
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-028_dish_management.html`
- **Resource ID:** `268dbd48eb8447d2a71bf386a6d63428`
- **Core Purpose:** Operational catalog list with high-density industrial cards. Displays culinary photos, price, dietary tags (Pure Veg, Non-Veg, Contains Egg), live preparation load, and instant 86'd stockout toggle.
- **Controls & Actions:** Filter chips (All, Veg, Non-Veg, Egg, In Stock, 86'd), quick stock toggle, edit dish button.
- **Status:** **DISCOVERED & PLANNED**.

### 5. RM-029: Add New Dish
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-029_add_new_dish.html`
- **Resource ID:** `b8364cbfd8a44b36a7a0a037887efef6`
- **Core Purpose:** New dish creation wizard.
- **Controls & Actions:** Dish Name, Menu Category selector, Dietary Classification radio cards (Veg, Non-Veg, Egg), description, base price, prep time minutes, photo upload trigger, variant creation.
- **Status:** **DISCOVERED & PLANNED**.

### 6. RM-030: Edit Dish
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-030_edit_dish.html`
- **Resource ID:** `1f5b61b7f9eb4a36b5ec632598be69d5`
- **Core Purpose:** Dish modification console. Allows updating title, prices, portion sizes, add-ons, culinary photo, and temporary out-of-stock toggling.
- **Status:** **DISCOVERED & PLANNED**.

### 7. RM-031: Dish Customization Management
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-031_dish_customization_management.html`
- **Resource ID:** `921501309f7b494ea4e0fb4ef980bb6e`
- **Core Purpose:** Advanced item customization editor. Manages portion sizes (Half, Full, Jumbo) and add-on option groups (spice levels, extra dips/chutneys, beverage pairings).
- **Controls & Actions:** Add-on group creation, required vs optional rules, min/max selection bounds, option stock toggles.
- **Status:** **DISCOVERED & PLANNED**.

### 8. RM-032: Menu Availability & Scheduling
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-032_menu_availability_scheduling.html`
- **Resource ID:** `9133860bb4d7494488a09cfb81a8b5e2`
- **Core Purpose:** Dayparting and automated meal-shift scheduler (Breakfast Express 07:30-11:00, Lunch Feast 11:30-16:00, Dinner & Tandoor 18:00-23:00).
- **Controls & Actions:** Shift toggles, time range pickers, active shift indicator.
- **Status:** **DISCOVERED & PLANNED**.

### 9. RM-033: Bulk Menu Management
- **Stitch File:** `docs/restaurant-merchant-audit/stitch-html/RM-033_bulk_menu_management.html`
- **Resource ID:** `e243fc411b4249a5b481bf1660d3d5b2`
- **Core Purpose:** High-tempo emergency management. Supports instant 86'd emergency staple freeze ("Out of Paneer", "Out of Biryani Rice", "Tandoor Dough / LPG"), bulk availability toggling, and bulk price percentage adjustments.
- **Controls & Actions:** Multi-item checkboxes, emergency freeze chips, bulk price adjustment dialog.
- **Status:** **DISCOVERED & PLANNED**.

---

## 3. Backend & Repository Readiness

- **Repository:** `RestaurantCatalogRepository.js` (Lines 1–1250) is fully implemented with dual-store PostgreSQL and local memory resilience:
  - `listDishes(merchantId, filter)`
  - `createDish(merchantId, dishData)`
  - `updateDish(merchantId, dishId, updateData)`
  - `archiveDish(merchantId, dishId)`
  - `toggleAvailability(merchantId, dishId, isAvailable)`
  - `addVariant`, `updateVariant`, `deleteVariant`
  - `addAddOnGroup`, `updateAddOnGroup`, `deleteAddOnGroup`
- **Backend Endpoints:** Lines 7244–7445 in `backend/src/server.js` expose complete REST endpoints for dishes, variants, and add-ons.
- **Category & Shift Management Extension:**
  - Will add endpoints for menu dayparts / meal shifts (`GET/PUT /api/merchant/rms/menu/shifts`) and bulk menu operations (`POST /api/merchant/dishes/bulk-availability`, `POST /api/merchant/dishes/bulk-pricing`).

---

## 4. Implementation Plan

1. **Backend Integration:**
   - Add bulk availability and pricing endpoints in `backend/src/server.js`.
   - Add menu daypart shifts endpoints in `backend/src/server.js` and `RestaurantManagementRepository.js`.
   - Write automated backend tests in `backend/test_phase43_menu_management.js`.
2. **Flutter UI & State Architecture:**
   - Implement `RestaurantMenuTourScreen` (RM-009).
   - Implement `RestaurantMenuOverviewScreen` (RM-026).
   - Implement `RestaurantMenuCategoriesSheet` (RM-027).
   - Enhance `restaurant_menu_management_screen.dart` to support RM-028 (Dish Management).
   - Implement `RestaurantAddDishScreen` (RM-029).
   - Enhance `restaurant_dish_detail_screen.dart` to support RM-030 (Edit Dish) and RM-031 (Dish Customization).
   - Implement `RestaurantMenuSchedulingSheet` (RM-032).
   - Implement `RestaurantBulkMenuSheet` (RM-033).
   - Register routes in `restaurant_router.dart`.
3. **Automated Testing:**
   - Execute backend and Flutter widget test suites.

*End of Discovery Report.*
