# NABIN — FLUTTER IMPLEMENTATION BLUEPRINT

**Document ID:** NABIN-FLUTTER-BLUEPRINT-001  
**Status:** ARCHITECTURAL SPECIFICATION FOR PHASE 17  

---

## 1. Monorepo Package Architecture

The customer application is structured as a modular Flutter package suite:

```
apps/mobile-customer/
├── lib/
│   ├── main.dart (Global App Entry & ProviderScope)
│   ├── core/
│   │   ├── router/ (GoRouter modular configuration)
│   │   ├── theme/ (AppTheme, NabinTokens, Palette #1A3BA2)
│   │   ├── network/ (Dio HTTP Client, SocketIoService, Offline Interceptors)
│   │   └── session/ (CustomerSessionNotifier, SecureStorage)
│   ├── features/
│   │   ├── superapp/ (Home, Onboarding, Search, Wallet, Profile, Support)
│   │   ├── ride/ (RideDiscovery, VehicleSelection, LiveRideTracking, SOS)
│   │   ├── food/ (RestaurantDiscovery, MenuKOT, FoodCart, FoodLiveTracking)
│   │   ├── grocery/ (StoreDiscovery, SKUCatalog, Substitution, GroceryTracking)
│   │   └── parcel/ (ParcelForm, VehicleAssign, CourierTracking, POD)
```

---

## 2. State Management & Networking Stack

- **State Management:** `flutter_riverpod` (`AsyncNotifierProvider` with autoDispose for screen lifecycle).
- **Navigation:** `go_router` with typed declarative routing, deep-link handling, and redirect guards for auth.
- **Network Engine:** `dio` configured with 5000ms connect/receive timeouts, automatic auth Bearer token injection, and SQLite offline cache for low-connectivity Tier-2/3 Indian cellular networks.
- **Real-Time Telemetry:** `socket_io_client` connected to `backend/src/server.js` on port 4000 for driver GPS locations, kitchen KOT status, and order timeline milestones.
