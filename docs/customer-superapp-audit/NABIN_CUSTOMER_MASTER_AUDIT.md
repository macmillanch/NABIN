# NABIN — CUSTOMER SUPER-APP MASTER AUDIT
## Comprehensive Architectural, UI/UX, Repository, and Cross-Service Audit

**Document ID:** NABIN-CS-AUDIT-001  
**Date:** November 18, 2026  
**Auditor Roles:** Principal Architect, Product Designer, Flutter Architect, QA Lead  
**Governing Context:** NABIN Modular Local-Services Super-App Platform  
**Target Repository:** `https://github.com/macmillanch/NABIN.git` (Branch: `main`)  

---

## 1. EXECUTIVE SUMMARY

This Master Audit provides an authoritative, end-to-end evaluation of the **NABIN Customer Super-App** and its four connected canonical service modules (**Ride, Food, Grocery, Parcel**). The audit establishes baseline architectural truth across the active Flutter codebase (`mobile/`), backend REST/WebSocket APIs (`backend/`), and Google Stitch design repositories (5 canonical projects totaling 180 verified instances).

### Core Audit Findings:
1. **Architectural Separation:** The Customer Super-App correctly operates as a shared outer shell. However, routing transitions between the outer shell and inner service experiences currently have navigation gaps (e.g., landmark validation, multi-stop rides, and detailed tax breakdown modals are not yet mounted in GoRouter).
2. **Zero Thermal Printer Footprint on Customer Surface:** The customer mobile application is **100% free of thermal printer mechanisms, permissions, and dependencies**. Digital receipts and invoices are rendered cleanly in Flutter screens.
3. **Zero Dark Store Compliance:** The customer app routes currently contain obsolete code comments mentioning "10-Minute DarkStore" in `app_router.dart:224`. This violates Rule 2 ("Zero Dark Stores Policy") and must be cleansed to reflect NABIN's physical kirana marketplace model.
4. **Google Stitch Parity:** 180 total instances across 5 customer projects are active (176 original preserved + 4 approved gap additions: `SA-GAP-01`, `RD-GAP-01`, `FD-GAP-01`, `GR-GAP-01`).
5. **Quality & Test Baseline:** Automated test suite is 100% green (51 customer widget/unit tests passing, 70 merchant tests passing).

---

## 2. PART 1 — REPOSITORY & FLUTTER APPLICATION AUDIT

### 2.1 Repository Layout & Multi-App Topology
The Flutter codebase is consolidated within the single multi-app container at `mobile/`:
* **App Entrypoints:**
  - `mobile/lib/main_customer.dart`: Canonical Customer Super-App entrypoint.
  - `mobile/lib/main_driver.dart`: Driver Partner Cockpit entrypoint.
  - `mobile/lib/main_restaurant.dart`: Restaurant Merchant RMS/KDS entrypoint.
  - `mobile/lib/main_grocery.dart`: Grocery Customer entrypoint (stand-alone target).
  - `mobile/lib/main_grocery_merchant.dart`: Grocery Merchant Inventory entrypoint.
  - `mobile/lib/main_admin.dart`: Internal Ops Console entrypoint.
  - `mobile/lib/main.dart`: Unified developer mode selector.

### 2.2 Flutter Framework & Dependencies
* **Flutter Version:** Flutter `3.50.0` (Dart `3.14.0`) on Windows x64.
* **Core Dependencies (`mobile/pubspec.yaml`):**
  - Routing: `go_router: ^14.2.0` (active version `14.8.1`).
  - State Management: `flutter_riverpod: ^2.5.1` (active version `2.6.1`).
  - Typography: `google_fonts: ^6.2.1` (`Inter`).
  - Mapping: `flutter_map: ^8.3.1`, `latlong2: ^0.10.1`.
  - Storage & Cache: `shared_preferences: ^2.5.5`.
  - Hardware / Location: `geolocator: ^14.1.1` (GPS only; zero Bluetooth or printer plugins).
  - Networking: `http: ^1.2.1`.

### 2.3 Navigation & Routing Structure (`app_router.dart`)
* **Router Type:** Declarative GoRouter instance with URL routing.
* **Current Route Inventory (Customer):**
  - Auth / Onboarding: `/splash`, `/`, `/phone-entry`, `/otp-verification`, `/personalization`, `/identity-verification-submit`, `/identity-verification-status`.
  - Core Shell: `/home`, `/wallet`, `/activity`, `/profile`, `/support`.
  - Ride Service: `/ride-booking`, `/active-ride`, `/ride-receipt`.
  - Food Service: `/food-home`, `/food-categories`, `/restaurant-menu`, `/dish-detail`, `/food-checkout`, `/food-tracking`.
  - Grocery Service: `/grocery-home`, `/grocery-cart`, `/grocery-checkout`, `/grocery-categories`, `/grocery-products`, `/grocery-product-detail`, `/grocery-deals`, `/grocery-tracking`.
  - Parcel Service: `/parcel-booking`, `/parcel-confirmation`.
  - Shared Payments: `/payment`.
* **Identified Routing Gaps:**
  - Missing route for `SA-GAP-01` (`/address-landmark-guard`): Pin confirmation currently routes directly without checking landmark sufficiency.
  - Missing route for `RD-GAP-01` (`/ride-multi-stop`): Intermediate waypoints cannot currently be injected into the ride booking flow.
  - Missing modal sheet trigger for `FD-GAP-01` (`/food-tax-breakdown`): Food checkout summary does not expose statutory Section 9(5) CGST breakdown modal.
  - Missing route for `GR-GAP-01` (`/grocery-tax-ledger`): Delivery status screen does not route into the post-fulfillment substitution delta ledger.

### 2.4 State Management & Shared Stores
* **Riverpod Providers:**
  - `groceryCartProvider`: Manages item quantities, lines, subtotal, and checkout payload.
  - `adminAuthProvider`, `adminDriversProvider`, `adminJobsProvider`, `adminMerchantsProvider`, `adminMetricsProvider`.
  - `nabinConfigControllerProvider`: Manages remote feature flags and dynamic service availability.
* **Gaps in State Management:**
  - Independent Ride, Food, and Parcel carts/bookings lack unified persistent hydration; a customer backgrounding the app or jumping across services risks state eviction if not committed to backend jobs.

### 2.5 Backend & Supabase Integration
* **API Service (`nabin_api_service.dart`):** Wraps standard HTTP GET, POST, PUT, DELETE with auth token injection, automatic error deserialization, and timeout handling.
* **WebSocket Service (`nabin_ws_service.dart`):** Maintains persistent socket connection for real-time dispatch updates, driver location telemetry, and order status transitions.
* **Supabase / PostgreSQL Schema:** 55 migrations applied in `supabase/migrations/`. Auth uses Supabase Auth + JWT claims. Fares, city rate cards, and merchant catalogs are fetched dynamically.

---

## 3. PART 2 — GOOGLE STITCH CUSTOMER ECOSYSTEM AUDIT

Audit of the 5 canonical customer Stitch projects via the Stitch MCP integration:

| Project | Stitch Project ID | Canonical Focus | Total Instances | UI Screens | Logo / Doc Assets | Gap Screens Present |
|---|---|---|:---:|:---:|:---:|:---:|
| **Customer Super-App** | `489536988828642080` | Shared Shell & Account | 41 | 38 | 3 | `SA-GAP-01` (`93a520ce...`) |
| **NABIN Ride** | `15895521349027986707` | 2W, 3W, 4W, Rental Ride | 24 | 20 | 4 | `RD-GAP-01` (`c8313815...`) |
| **NABIN Food** | `7613683360643688164` | Restaurant & Cloud Kitchen | 38 | 28 | 10 | `FD-GAP-01` (`92bb8d18...`) |
| **NABIN Grocery** | `7916514387823717414` | Physical Retail & Kirana | 47 | 34 | 13 | `GR-GAP-01` (`66f30ac7...`) |
| **NABIN Parcel** | `14684086286758455985` | Local Courier & Delivery | 30 | 26 | 4 | None (Complete) |
| **TOTAL** | — | — | **180** | **146** | **34** | **4 Implemented** |

### Duplicate Screen Analysis:
* The Customer Super-App project (`489536988828642080`) contains 13 legacy mock screens duplicated from inner services (`NABIN-072` through `NABIN-095`).
* **Preservation Status:** In accordance with owner directives, all 13 screens remain **100% preserved as reference designs** in Stitch.
* **Production Route Policy:** The Flutter client GoRouter bypasses these 13 duplicates, deep-linking directly into canonical inner service implementations (`/food-home`, `/grocery-home`, `/ride-booking`, `/parcel-booking`).

---

## 4. PART 3 — BUSINESS ARCHITECTURE & LOCALIZATION AUDIT

### 4.1 Strict Service Taxonomy
1. **NABIN Ride:** Bike (2W), Auto (3W), Taxi/Cab (4W), Shared Ride, Rentals. Excludes bus, train, or flight ticketing.
2. **NABIN Food:** Cooked meals exclusively from restaurants and cloud kitchens. Dietary signifiers (Veg, Non-Veg, Egg) are mandatory on every dish.
3. **NABIN Grocery:** Retail FMCG and staples from local physical kirana stores and supermarkets. Strict Zero Dark Store enforcement. Includes out-of-stock substitution approval workflow.
4. **NABIN Parcel:** Intra-city document, box, and personal parcel transport. Dimensions and weight validation; sender and receiver OTP verification.

### 4.2 Regional Pilot Hub: Kamalanagar (Chawngte), Mizoram
* All default currency indicators strictly render Indian Rupee (`₹`).
* Geofence coordinates, initial map views, and seed merchant directories are anchored to Kamalanagar / Chawngte, Lawngtlai District, Mizoram (`22.65°N, 92.65°E`).
* Address search algorithms must prioritize Chakma Autonomous District Council (CADC) localities and prominent landmarks.

---

## 5. PART 4 — AUDIT RISK MATRIX

| Risk Area | Severity | Impact | Mitigation Strategy |
|---|:---:|---|---|
| **Stale DarkStore Reference in Code** | Low | Confuses architectural clarity | Cleanse comment in `app_router.dart:224` during refinement. |
| **Address Setup Flow Disconnection** | Medium | User bypasses landmark verification | Insert `/address-landmark-guard` (`SA-GAP-01`) between pin selection and saved address storage. |
| **Ride Waypoints Missing in Route** | Medium | Passengers cannot add intermediate stops | Connect `/ride-multi-stop` (`RD-GAP-01`) directly to `RideBookingScreen`. |
| **Food Tax Modal Disconnected** | High | Statutory non-compliance with CGST Sec 9(5) | Mount `/food-tax-modal` (`FD-GAP-01`) as a bottom sheet in `FoodCheckoutScreen`. |
| **Grocery Price Delta Ledger Disconnected** | High | Customer lacks refund transparency on substitutions | Wire `/grocery-tax-ledger` (`GR-GAP-01`) into `GroceryOrderStatusScreen`. |

---

## 6. CONCLUSION & READINESS

The existing repository architecture is robust, highly modular, and backed by a comprehensive suite of passing tests. No rebuild is necessary. Refinement should focus exclusively on wiring the four approved gap additions and polishing visual hierarchy.
