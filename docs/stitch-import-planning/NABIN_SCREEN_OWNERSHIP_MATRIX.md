# NABIN — OUTER VS. INNER SCREEN OWNERSHIP MATRIX

**Document ID:** NABIN-OWNERSHIP-MATRIX-001  
**Status:** OFFICIAL ARCHITECTURAL BOUNDARY  

---

## 1. Governance Principles

1. **Outer Super-App Responsibility:**
   - Identity & Authentication (Splash, OTP, Language, Profile).
   - Global Navigation Shell (Home Marketplace, Service Grid, Bottom Nav).
   - Global Data Vaults (Saved Addresses, Saved Cards/UPI, Wallet, Unified History).
   - Global Customer Care & Notification Hub.
   - Global App Lifecycle (Offline, Server 500, GPS Denied).

2. **Inner Service Responsibility:**
   - Deep Discovery (Restaurant / Kirana Store / Vehicle Tiers / Parcel Categories).
   - Customization & Catalogs (Menus, Dish Options, Bulk SKUs, Package Size/Weight).
   - Vertical Basket & Pricing (Section 9(5) Food GST vs. Itemized Grocery GST).
   - Active Operational Telemetry (Ride Driver Pin, Food Kitchen KOT Prep, Grocery Picking/Substitutions, Parcel Courier Chain).
   - Service Handoff & Rating (Curbside OTP, Thermal Receipt, Handover Proof).

---

## 2. Complete Ownership Allocation Table

| Functional Area | Current Project | Correct Architectural Owner | Status | Recommended Action |
|---|---|---|---|---|
| **Splash & Onboarding** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App |
| **Phone & OTP Auth** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App |
| **Global Landmark Address Book** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App (Provide to all services via session) |
| **Main Marketplace Home** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App (2x2 service launch pad) |
| **Unified Search** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App (Deep links to respective services) |
| **Unified Activity & History** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App (Consolidates orders across all 4 verticals) |
| **Payment & Wallet** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App (Universal UPI, Cards, NABIN Cash) |
| **Customer Support Hub** | Super-App | **Customer Super-App** | CORRECT | Keep in Super-App |
| **Global Edge States (Offline/500/GPS)**| Super-App | **Customer Super-App** | CORRECT | Keep in Super-App |
| **Ride Discovery & Booking** | Ride & Super-App | **NABIN Ride** | DUPLICATED IN SUPER-APP | **Retain in Ride project; Prune from Super-App** |
| **Ride Active Tracking & OTP** | Ride & Super-App | **NABIN Ride** | DUPLICATED IN SUPER-APP | **Retain in Ride project; Prune from Super-App** |
| **Ride SOS & Safety Shield** | Ride | **NABIN Ride** | CORRECT | Keep in Ride |
| **Restaurant Menu & Dishes** | Food & Super-App | **NABIN Food** | DUPLICATED IN SUPER-APP | **Retain in Food project; Prune from Super-App** |
| **Dish Customization (Spice/Portion)**| Food | **NABIN Food** | CORRECT | Keep in Food |
| **Food Cart & Section 9(5) Tax** | Food & Super-App | **NABIN Food** | DUPLICATED IN SUPER-APP | **Retain in Food project; Prune from Super-App** |
| **Kitchen Prep & Live Rider** | Food & Super-App | **NABIN Food** | DUPLICATED IN SUPER-APP | **Retain in Food project; Prune from Super-App** |
| **Grocery Store & SKU Catalog** | Grocery & Super-App | **NABIN Grocery** | DUPLICATED IN SUPER-APP | **Retain in Grocery project; Prune from Super-App** |
| **Grocery Substitutions & Picking**| Grocery & Super-App | **NABIN Grocery** | DUPLICATED IN SUPER-APP | **Retain in Grocery project; Prune from Super-App** |
| **Item-Level GST Grocery Cart** | Grocery & Super-App | **NABIN Grocery** | DUPLICATED IN SUPER-APP | **Retain in Grocery project; Prune from Super-App** |
| **Parcel Sender/Receiver Form** | Parcel & Super-App | **NABIN Parcel** | DUPLICATED IN SUPER-APP | **Retain in Parcel project; Prune from Super-App** |
| **Parcel Weight & Vehicle Logic** | Parcel | **NABIN Parcel** | CORRECT | Keep in Parcel |
| **Parcel Courier Chain & POD** | Parcel | **NABIN Parcel** | CORRECT | Keep in Parcel |
