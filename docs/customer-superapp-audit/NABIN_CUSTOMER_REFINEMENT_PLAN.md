# NABIN — CUSTOMER SUPER-APP REFINEMENT & IMPLEMENTATION PLAN
## Structured Non-Destructive Refinement Strategy for Flutter & Google Stitch

**Document ID:** NABIN-REFINEMENT-PLAN-005  
**Date:** November 18, 2026  
**Auditor Roles:** Principal Architect, Flutter Solution Architect, QA Lead  
**Governing Rule:** Approval Gate Active — Do not execute implementation until explicit owner authorization is granted.  

---

## 1. PURPOSE & REFINEMENT OBJECTIVES

The objective of this plan is to refine the **NABIN Customer Super-App** and its four connected canonical service modules (**Ride, Food, Grocery, Parcel**) without rebuilding existing code or deleting/overwriting any existing Stitch designs.

### Core Objectives:
1. **Wire the 4 Approved Gap Additions in Flutter:**
   - `SA-GAP-01` (`93a520ce...`): Mount `/address-landmark-guard` in address setup flow.
   - `RD-GAP-01` (`c8313815...`): Mount `/ride-multi-stop` into `RideBookingScreen`.
   - `FD-GAP-01` (`92bb8d18...`): Mount statutory tax modal in `FoodCheckoutScreen`.
   - `GR-GAP-01` (`66f30ac7...`): Mount substitution delta ledger in `GroceryOrderStatusScreen`.
2. **Harmonize Visual Tokens:** Align Flutter `NabinColor` with Stitch canonical palette (`foodOrange: #E85D24`, `groceryGreen: #16834A`, `canvas: #F5F7FB`).
3. **Cleanse Code Comments:** Remove stale "DarkStore" terminology from `app_router.dart:224` to uphold Rule 2 ("Zero Dark Stores Policy").
4. **Preserve Digital Receipts:** Retain purely digital receipts/invoices; zero thermal printer functionality.

---

## 2. DETAILED SCREEN REFINEMENT INVENTORY

| Priority | Screen ID | Canonical Project | Screen Name | Proposed Refinement | Flutter Target File |
|---|---|---|---|---|---|
| **P0** | `93a520ce...` | Super-App (`489536988828642080`) | `SA-GAP-01` Landmark Guard | Insert route `/address-landmark-guard` between map pin confirmation (`NABIN-018`) and home. | `features/home/presentation/screens/landmark_guard_screen.dart` |
| **P0** | `c8313815...` | Ride (`15895521349027986707`) | `RD-GAP-01` Ride Multi-Stop | Expose "Add Stop" button in route picker; open modal with max 2 stops and waiting charges disclosure. | `features/ride/presentation/screens/ride_multi_stop_modal.dart` |
| **P0** | `92bb8d18...` | Food (`7613683360643688164`) | `FD-GAP-01` Food Tax Modal | Add info icon `(i)` on Taxes row in checkout; open modal with 5% food GST, composite packaging, and 18% platform fee. | `features/food/presentation/widgets/food_tax_breakdown_modal.dart` |
| **P0** | `66f30ac7...` | Grocery (`7916514387823717414`) | `GR-GAP-01` Tax & Delta Ledger | Add sticky button "View Detailed Tax Invoice & Item Ledger" on delivered screen, displaying substitution adjustments. | `features/grocery/presentation/screens/grocery_tax_ledger_screen.dart` |
| **P1** | `N/A` | Architecture | Design Token Harmonization | Update `foodOrange` to `#E85D24` and `groceryGreen` to `#16834A` in `nabin_tokens.dart`. | `core/theme/nabin_tokens.dart` |
| **P1** | `N/A` | Architecture | Code Hygiene | Replace "10-Minute DarkStore" comment in router with physical retail marketplace description. | `core/router/app_router.dart:224` |

---

## 3. PROPOSED FLUTTER IMPLEMENTATION BLUEPRINT

### 3.1 GoRouter Integration Plan
```dart
// Proposed additions to app_router.dart:

// 1. Landmark Validation Guard (SA-GAP-01)
GoRoute(
  path: '/address-landmark-guard',
  builder: (context, state) {
    final extra = state.extra as Map<String, dynamic>?;
    return LandmarkGuardScreen(
      selectedAddress: extra?['address'] as String? ?? '',
      latitude: extra?['lat'] as double? ?? 22.65,
      longitude: extra?['lng'] as double? ?? 92.65,
    );
  },
),

// 2. Ride Multi-Stop Waypoints Selector (RD-GAP-01)
GoRoute(
  path: '/ride-multi-stop',
  builder: (context, state) {
    final extra = state.extra as Map<String, dynamic>?;
    return RideMultiStopScreen(
      pickupAddress: extra?['pickup'] as String? ?? '',
      destinationAddress: extra?['destination'] as String? ?? '',
    );
  },
),

// 3. Grocery HSN Tax & Substitution Delta Ledger (GR-GAP-01)
GoRoute(
  path: '/grocery-tax-ledger',
  builder: (context, state) {
    final extra = state.extra as Map<String, dynamic>?;
    return GroceryTaxLedgerScreen(
      orderId: extra?['orderId'] as String? ?? '',
    );
  },
),
```

### 3.2 State Management & Cart Isolation
* **Ride State:** Handled in ephemeral booking state (`passengerInfo`, `waypoints`, `selectedVehicleType`).
* **Food Cart:** Independent state tied to single restaurant ID to prevent cross-restaurant contamination.
* **Grocery Cart:** Governed by `groceryCartProvider` tied to physical kirana store inventory.
* **Parcel State:** Transient booking state capturing sender, receiver, dimensions, and declared category.

---

## 4. RISKS, DEPENDENCIES & SAFETY CONSTRAINTS

1. **Zero Database Migrations Required:** All required data fields (`waypoints`, `landmarks`, `tax_snapshot`, `substitution_delta`) already exist within `jobs.metadata`, `orders.items`, and `orders.tax_details`. No database migrations are needed.
2. **Zero Backend Route Breakage:** Existing endpoints `GET /api/customer/orders`, `POST /api/ride/book`, `POST /api/food/checkout` handle extensible JSON payloads.
3. **Strict Zero Deletion Governance:** No existing Stitch screen or Flutter screen will be deleted, renamed, or overwritten.

---

## 5. APPROVAL GATE SUBMISSION

In compliance with Part 6 of the execution prompt:

> **APPROVAL GATE: PENDING OWNER AUTHORIZATION**  
> No Stitch screens have been created, modified, or deleted during this audit turn.  
> No production code has been committed or deployed.  
> The complete 5-part audit deliverable suite is ready for owner review.

### Next Steps Upon Owner Approval:
1. Implement the 4 UI gap screens in Flutter (`LandmarkGuardScreen`, `RideMultiStopScreen`, `FoodTaxBreakdownModal`, `GroceryTaxLedgerScreen`).
2. Mount the 4 screens in `mobile/lib/core/router/app_router.dart`.
3. Align Flutter service tokens in `mobile/lib/core/theme/nabin_tokens.dart`.
4. Run full test suite and verify 100% green build.
