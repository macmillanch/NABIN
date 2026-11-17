# NABIN PHASE 3.3 — RESTAURANT MERCHANT DESIGN-TO-CODE MAPPING

**Document ID:** NABIN-RM-MAPPING-001  
**Date:** November 18, 2026  
**Authoritative Source:** Google Stitch Project `6689743337313822856`  
**Target Architecture:** NABIN Flutter Mobile Super-App (`mobile/`, flavor `restaurant_merchant`)  

---

## 1. Executive Summary

This document provides a comprehensive, read-only architectural mapping of all 66 approved Google Stitch Restaurant Merchant RMS + KDS screens to the NABIN Flutter application codebase (`mobile/`). 

### Architecture Inventory Summary:
- **Total Stitch Screens Audited:** 66
- **Fully Implemented Core Screens (P0):** 10 (Splash, Login, OTP, Dashboard Bento Grid, KDS Queue, Active Orders, Menu Overview)
- **Partially Implemented / Extended Management (P1):** 15 (Dish management, Registration, Finance & GST Reports)
- **Specialized / Enterprise Modules (P2):** 41 (Thermal printing, multi-outlet networking, advanced shift handover, RBAC matrix, live support chat)

---

## 2. Complete 66-Screen Mapping Table

| Index | Screen Code | Screen Title | Flutter Route | Dart File Reference | API Dependencies | Auth / Role | Status | Priority |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :---: | :---: |
| 1 | **RM-001** | Merchant Welcome | `/` | `restaurant_splash_screen.dart` | `GET /api/merchant/services` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 2 | **RM-002** | Merchant Login | `/login` | `restaurant_login_screen.dart` | `POST /api/auth/send-otp` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 3 | **RM-003** | OTP Verification | `/otp` | `restaurant_otp_screen.dart` | `POST /api/auth/verify-otp` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 4 | **RM-004** | Restaurant Business Details | `/registration` | `restaurant_registration_screen.dart` | `POST /api/merchant/register, PATCH /api/merchant/:id/profile` | Bearer Token / RESTAURANT | `PARTIAL` | **P1** |
| 5 | **RM-005** | Restaurant Address and Location | `/registration` | `restaurant_registration_screen.dart` | `POST /api/merchant/register, PATCH /api/merchant/:id/profile` | Bearer Token / RESTAURANT | `PARTIAL` | **P1** |
| 6 | **RM-006** | Business Documents | `/registration` | `restaurant_registration_screen.dart` | `POST /api/merchant/register, PATCH /api/merchant/:id/profile` | Bearer Token / RESTAURANT | `PARTIAL` | **P1** |
| 7 | **RM-007** | Bank and Settlement Details | `/registration` | `restaurant_registration_screen.dart` | `POST /api/merchant/register, PATCH /api/merchant/:id/profile` | Bearer Token / RESTAURANT | `PARTIAL` | **P1** |
| 8 | **RM-008** | Onboarding Progress and Verification Status | `/dashboard` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/dashboard` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 9 | **RM-009** | RM-009: Quick App Tour & RMS Feature Highlights | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 10 | **RM-010** | RM-010: Sales & Revenue Analytics | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 11 | **RM-011** | RM-011: Dish Performance & Velocity | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 12 | **RM-012** | RM-012: Incoming Order Audio/Visual Chime Alert Overlay | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 13 | **RM-013** | Order Details #NB-4825 | `/menu/dish/:dishId` | `restaurant_dish_detail_screen.dart` | `GET /api/merchant/catalog` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P1** |
| 14 | **RM-014** | Accept Order | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 15 | **RM-015** | Reject Order | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 16 | **RM-016** | Preparation Time Management | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 17 | **RM-017** | Customer Order Issues & Disputes | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 18 | **RM-018** | Cancellation & Refund Management | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 19 | **RM-019** | RM-019: Order Dispute Case Detail & Evidence Viewer | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 20 | **RM-020** | Order History | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 21 | **RM-021** | RM-021: New Kitchen Orders | `/dashboard (Orders Tab / KDS)` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/orders, POST /api/merchant/orders/:id/status` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 22 | **RM-022** | RM-022: Preparing Orders | `/dashboard (Orders Tab / KDS)` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/orders, POST /api/merchant/orders/:id/status` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 23 | **RM-023** | RM-023: Ready Orders | `/dashboard (Orders Tab / KDS)` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/orders, POST /api/merchant/orders/:id/status` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 24 | **RM-024** | RM-024: Kitchen Station Management | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 25 | **RM-025** | RM-025: KDS Display Settings | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 26 | **RM-026** | RM-026: Menu Overview | `/dashboard (Menu Tab)` | `restaurant_main_shell.dart` | `GET /api/merchant/catalog` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 27 | **RM-027** | RM-027: Menu Categories | `/dashboard (Menu Tab)` | `restaurant_main_shell.dart` | `GET /api/merchant/catalog` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 28 | **RM-028** | RM-028: Dish Management | `/dashboard (Menu Tab)` | `restaurant_main_shell.dart` | `GET /api/merchant/catalog` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 29 | **RM-029** | RM-029: Add New Dish | `/menu/manage` | `restaurant_menu_management_screen.dart` | `POST /api/merchant/catalog, PATCH /api/merchant/catalog/:id` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P1** |
| 30 | **RM-030** | RM-030: Edit Dish | `/menu/manage` | `restaurant_menu_management_screen.dart` | `POST /api/merchant/catalog, PATCH /api/merchant/catalog/:id` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P1** |
| 31 | **RM-031** | RM-031: Dish Customization Management | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 32 | **RM-032** | RM-032: Menu Availability & Scheduling | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 33 | **RM-033** | RM-033: Bulk Menu Management | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 34 | **RM-034** | RM-034: Restaurant Profile & Outlets | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 35 | **RM-035** | RM-035: Operating Hours & Shifts | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 36 | **RM-036** | RM-036: Multi-Outlet Network | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 37 | **RM-037** | RM-037: Service Channels & Fulfilment | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 38 | **RM-038** | RM-038: Emergency Store Pause | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 39 | **RM-039** | RM-039: Scheduled Holiday & Seasonal Closure Calendar | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 40 | **RM-040** | RM-040: Printer Discovery & Pairing | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 41 | **RM-041** | RM-041: Printer Configuration & Specs | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 42 | **RM-042** | RM-042: KOT Slip Layout & Preview | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 43 | **RM-043** | RM-043: Customer Bill & Invoice Template | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 44 | **RM-044** | RM-044: Auto-Print Routing Rules | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 45 | **RM-045** | RM-045: Print Queue & Diagnostics | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 46 | **RM-046** | RM-046: Finance Overview & Payouts | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 47 | **RM-047** | RM-047: Daily Settlement & Statement | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 48 | **RM-048** | RM-048: Order Transaction Ledger | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 49 | **RM-049** | RM-049: Commission & Deductions Breakdown | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 50 | **RM-050** | RM-050: Bank Accounts & Payout Settings | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 51 | **RM-051** | RM-051: Tax & GST Reports | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/finance/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P1** |
| 52 | **RM-052** | RM-052: Staff Management & Role-Based Access (RBAC) | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 53 | **RM-053** | RM-053: Kitchen Staff Quick PIN Switcher | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 54 | **RM-053A** | RM-053A: Invite Staff & Add Employee | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 55 | **RM-054** | RM-054: Daily Shift Handover & Cash Drawer Reconciliation | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 56 | **RM-054A** | RM-054A: Staff Member Profile & Activity History | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 57 | **RM-055** | RM-055: Notifications & Broadcasts | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 58 | **RM-055A** | RM-055A: Roles & Permissions Matrix | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/staff/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 59 | **RM-056** | RM-056: 24/7 Merchant Helpdesk & Live Dispute Chat | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 60 | **RM-057** | RM-057: Support Tickets Archive & SLA Tracking | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 61 | **RM-059** | RM-059: Account & Application Master Settings | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 62 | **RM-060** | RM-060: Security, Active Sessions & Audit Log | `NOT_IMPLEMENTED` | `None / New File Required` | `GET /api/merchant/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 63 | **RM-098** | Thermal Printer Management | `NOT_IMPLEMENTED` | `None / New File Required` | `POST /api/merchant/printer/...` | Bearer Token / RESTAURANT | `NOT_IMPLEMENTED` | **P2** |
| 64 | **RM-100** | KDS Kitchen Board | `/dashboard (Orders Tab / KDS)` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/orders, POST /api/merchant/orders/:id/status` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 65 | **RM-102** | Live Order Management | `/dashboard (Orders Tab / KDS)` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/orders, POST /api/merchant/orders/:id/status` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |
| 66 | **RM-104** | Restaurant Dashboard | `/dashboard` | `restaurant_main_shell.dart` | `GET /api/merchant/:id/dashboard` | Bearer Token / RESTAURANT | `VERIFIED_IMPLEMENTED` | **P0** |

---

## 3. Architecture & State Management Alignment

1. **Routing Architecture:** Governed by GoRouter in `mobile/lib/core/router/restaurant_router.dart`, enforcing strict authentication redirection (`SessionManager.instance.isAuthenticated`).
2. **State Management:** Reactive Riverpod providers (`restaurant_menu_provider.dart`, session state) combined with robust state handling in `RestaurantMainShell` (`loading`, `ready`, `failed`, `unreadable`).
3. **Backend Integration:** Communicates with Node.js shared backend (`backend/src/server.js`) via authenticated REST endpoints (`NabinApiService`), preserving zero fake local state and fail-closed security for unauthenticated sessions.

*End of Design-to-Code Mapping.*
