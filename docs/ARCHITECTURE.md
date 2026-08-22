# NABIN Platform Architecture Specification

## 1. System Overview

NABIN is a unified multi-service mobility, quick-commerce, and logistics platform designed on a **Single Source of Truth** shared backend architecture.

```
┌─────────────────────────────────────────────────────────────┐
│                 NABIN CLIENT ECOSYSTEM                      │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Customer App    │ Driver App      │ Merchant App            │
│ (Flutter iOS/And) (Flutter iOS/And) (Flutter iOS/And)         │
├─────────────────┴─────────────────┴─────────────────────────┤
│ Admin Intelligence Control Center (Responsive Web)          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / WSS (Bearer Auth)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             NABIN SHARED BACKEND ENGINE (Node.js)           │
├─────────────────────────────────────────────────────────────┤
│ • Universal Auth & Session Gateway (Cryptographic Hashing)   │
│ • Algorithmic Ride Dispatch & Geohash Spatial Radar         │
│ • 10-Minute DarkStore Grocery Engine & Dynamic Pricing      │
│ • Hyperlocal Food & Kitchen Order Management                │
│ • Dual-OTP Verified Parcel Express Courier                  │
│ • Double-Entry Financial Ledger & Escrow Settlement         │
│ • Role-Based Access Control (RBAC) & Audit Logging          │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
┌──────────────────────────────┐    ┌─────────────────────────┐
│ PostgreSQL / Supabase Engine │    │ In-Memory / Redis Store │
│ • Central Relational Tables  │    │ • Live Driver GPS Telemetry│
│ • Strict Foreign Keys & RLS  │    │ • High-Frequency Radar  │
│ • Immutable Financial Ledger │    │ • Active OTP & Rate Lim │
└──────────────────────────────┘    └─────────────────────────┘
```

## 2. Core Service Pillars

### A. NABIN Ride (Mobility)
- Multi-tier transport: Bike (2W), Auto Rickshaw (3W), Economy Cab (4W), Premium SUV (4W Premium).
- Dynamic spatial surge pricing with polygon and radial corridor geofencing.
- Authoritative start-trip OTP verification (`7729` / cryptographic random).

### B. 10-Minute Grocery Express (Quick Commerce)
- DarkStore-linked ultra-fast grocery delivery.
- Authoritative server-side cart subtotal and weight calculation.
- Dynamic SKU pricing rules with historical audit trail.

### C. NABIN Food (Cloud Kitchens & Restaurants)
- Multi-cuisine restaurant discovery and menu customization.
- Live kitchen preparation countdown and rider dispatch.

### D. NABIN Parcel Express (Hyperlocal Logistics)
- Sender-to-recipient courier flow.
- Dual-OTP verification: Pickup OTP from sender, Delivery OTP from recipient.

## 3. Real-Time Telemetry & Fleet State Management
- High-frequency GPS streams from Driver apps communicate over WebSocket `/` channel.
- GPS coordinates are processed in an isolated in-memory/Redis layer to prevent relational database write saturation.
- Spatial queries identify nearest available drivers within a 3-5 km operational radius.
