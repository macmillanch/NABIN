# NABIN — Unified System Architecture

**Author**: System Architect Agent ([`system_architect`](file:///c:/Users/Macmillan/OneDrive/Documents/nabin/.agents/skills/system_architect/SKILL.md))  
**Source Agency Agent**: `msitarzewski/agency-agents`

## 1. High-Level Architecture
NABIN is an all-in-one local services platform serving **Customer**, **Driver**, **Merchant**, and **Admin** workloads through a single unified backend.

```text
┌─────────────────┐  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────┐
│  NABIN Customer │  │  NABIN Driver │  │  NABIN Merchant │  │    NABIN Admin   │
│   (Flutter)     │  │   (Flutter)   │  │    (Flutter)    │  │   (Web Dash)     │
└────────┬────────┘  └───────┬───────┘  └────────┬────────┘  └────────┬─────────┘
         │                   │                   │                    │
         └───────────────────┴─────────┬─────────┴────────────────────┘
                                       │ (REST + WebSocket)
                                       ▼
                       ┌───────────────────────────────┐
                       │  SHARED NABIN UNIFIED BACKEND │
                       │    (Node.js + Express + WS)   │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │     POSTGRESQL / DATA STORE   │
                       └───────────────────────────────┘
```

## 2. Core Service Boundaries
- **Authentication & RBAC**: JWT authorization, role scopes (`SUPER_ADMIN`, `KYC_SPECIALIST`, `OPERATIONS`, `DRIVER`, `CUSTOMER`, `MERCHANT`).
- **Identity Verification & Compliance**: Manual Aadhaar/Voter ID review workflow, document masking, status lifecycle (`IDENTITY_VERIFICATION_PENDING`, `VERIFIED`, `RESUBMISSION_REQUIRED`).
- **Fleet & Driver Dispatch**: Real-time WebSocket location tracking, vehicle categories (2W, 3W, 4W), driver status.
- **Ride, Food & Parcel Engines**: Unified pricing, surge multiplier, fare calculation, order tracking.
- **Finance & Settlements**: Wallet balances, ledger transactions, merchant payouts, driver earnings, refund safety controls.
- **Audit & Governance**: Immutable admin action logging (`audit.view`, `audit.export`).

## 3. Technology Stack
- **Mobile Apps**: Flutter M3 Kinetic Reliability System (`mobile/lib/`)
- **Admin Dashboard**: HTML5, Vanilla CSS, JS Web UI (`admin_dashboard.html`)
- **Backend API**: Node.js, Express, WebSocket (`backend/src/server.js`)
- **Data Store**: Persistent Relational Store (`backend/src/database.js`)
