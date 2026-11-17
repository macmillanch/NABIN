# NABIN — CROSS-PROJECT NAVIGATION & SERVICE ENTRY/EXIT PLAN

**Document ID:** NABIN-CROSS-NAV-001  
**Status:** ARCHITECTURAL SPECIFICATION  

---

## 1. Unified Navigation Model

The application operates as a single Flutter APK / iOS IPA using `go_router` modular routing:

```
/ (Super-App Root)
├── /auth (Onboarding, Phone, OTP)
├── /home (Main Marketplace Hub - 2x2 Service Grid)
├── /search (Universal Multi-Service Search)
├── /activity (Unified Poly-Service Order History)
├── /profile (Customer Profile, Addresses, Wallet, Support)
│
├── /ride (NABIN Ride Sub-Router)
│   ├── /ride/search
│   ├── /ride/estimate
│   ├── /ride/active
│   └── /ride/receipt
│
├── /food (NABIN Food Sub-Router)
│   ├── /food/discovery
│   ├── /food/restaurant/:id
│   ├── /food/cart
│   └── /food/tracking/:orderId
│
├── /grocery (NABIN Grocery Sub-Router)
│   ├── /grocery/stores
│   ├── /grocery/store/:id
│   ├── /grocery/cart
│   └── /grocery/tracking/:orderId
│
└── /parcel (NABIN Parcel Sub-Router)
    ├── /parcel/create
    ├── /parcel/review
    └── /parcel/tracking/:parcelId
```

---

## 2. Service Entry and Exit Rules

1. **Entering a Service:**
   - From Super-App Home (`NABIN-021`), tapping a service card mounts the respective modular router.
   - The user's active landmark location, auth token, and saved payment methods are seamlessly inherited.
2. **Exiting a Service (Back Navigation):**
   - The top-left AppBar back button inside a service root screen (`RIDE-001`, `FOOD-001`, `GROCERY-001`, `PARCEL-001`) always returns the user safely to `/home` (`NABIN-021`).
   - If an active order or ride is in progress, the Super-App Home surfaces a persistent **Bottom Floating Live Order Bar** (e.g. *"Ride in Progress • Auto arriving in 3 mins"* or *"Food Preparing • Kitchen KOT #104"*), allowing 1-tap re-entry into the active tracker without losing state.
