# NABIN — SHARED CUSTOMER STATE ARCHITECTURE

**Document ID:** NABIN-STATE-ARCH-001  
**Status:** ARCHITECTURAL SPECIFICATION  

---

## 1. Global vs. Vertical State Isolation Principle

To ensure zero cross-contamination while preserving seamless single-app UX, the state architecture strictly enforces:
1. **Global Umbrella State:** Stored at the Super-App root and accessible read-only across all inner verticals.
2. **Modular Isolated State:** Kept strictly inside the respective service packages (`nabin_ride`, `nabin_food`, `nabin_grocery`, `nabin_parcel`).
3. **Zero Mixed Carts:** A user **never** shares a shopping cart across Food and Grocery. Food carts carry Section 9(5) restaurant GST; Grocery carts carry multi-slab SKU inventory and substitution rules.

---

## 2. Conceptual Customer State Matrix

| State Domain | Owning Scope | Stored Entity / Schema | Read Access | Write Access | Persistence |
|---|---|---|---|---|---|
| **Customer Auth Session** | Super-App | JWT Token, User UUID, Phone, Verified Profile | Super-App, Ride, Food, Grocery, Parcel | Super-App Auth | SecureStorage |
| **Active Landmark Address** | Super-App | Current Lat/Lng, Geohash, Landmark String, Zone ID | Super-App, All Verticals | Super-App Location Picker | Local Cache + DB |
| **Universal Wallet & Cash** | Super-App | NABIN Cash Balance, Saved UPI IDs, Linked Cards | Super-App, Checkout Screens | Super-App Payments | Supabase RPC |
| **Unified Activity Feed** | Super-App | Poly-service timeline (Ride trips, Restaurant orders, Kirana deliveries, Parcels) | Super-App History Tab | Central Order Engine | PostgreSQL DB |
| **Ride Booking State** | NABIN Ride | Pickup, Drop, Tier (Bike/Auto/Cab), Radar status, Driver location, OTP | Ride Module Only | Ride Booking Engine | Redis + DB |
| **Food Restaurant Cart** | NABIN Food | Restaurant ID, KOT Dishes, Spice/Portion add-ons, Section 9(5) Tax | Food Module Only | Food Cart Controller | Local SQLite |
| **Grocery Retail Basket** | NABIN Grocery | Store ID, SKU Quantities, MRP vs Selling, Substitution Rules | Grocery Module Only | Grocery Cart Controller | Local SQLite |
| **Parcel Courier Manifest** | NABIN Parcel | Sender Lat/Lng, Receiver Lat/Lng, Weight class, Receiver OTP, POD photo | Parcel Module Only | Parcel Dispatch Controller | PostgreSQL DB |
