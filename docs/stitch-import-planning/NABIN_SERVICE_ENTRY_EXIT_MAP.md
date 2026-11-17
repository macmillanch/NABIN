# NABIN — SERVICE ENTRY & EXIT MAP

**Document ID:** NABIN-ENTRY-EXIT-001  
**Status:** MAPPING SPECIFICATION  

---

## Service Transition & Deep-Link Matrix

| Service Vertical | Entry Point in Super-App | Inherited Session State | Exit Mechanism (Back Navigation) | Mid-Journey Abandonment Behavior |
|---|---|---|---|---|
| **NABIN Ride** | 2x2 Grid Tile on `NABIN-021` (`/ride`) | Active User JWT, Landmark Address, Default Payment | Top AppBar Back Button (`pop()` to `/home`) | Active driver search or trip minimizes into **Bottom Floating Live Bar** on Home |
| **NABIN Food** | 2x2 Grid Tile on `NABIN-021` (`/food`) | Active User JWT, Landmark Address, Food Cart Session | Top AppBar Back Button (`pop()` to `/home`) | Unsubmitted cart is preserved in SQLite; active prep minimizes to **Live Bar** |
| **NABIN Grocery** | 2x2 Grid Tile on `NABIN-021` (`/grocery`) | Active User JWT, Landmark Address, Grocery Basket | Top AppBar Back Button (`pop()` to `/home`) | Unsubmitted basket preserved in SQLite; live picking minimizes to **Live Bar** |
| **NABIN Parcel** | 2x2 Grid Tile on `NABIN-021` (`/parcel`) | Active User JWT, Saved Addresses, Default Payment | Top AppBar Back Button (`pop()` to `/home`) | Form draft preserved in memory; active courier tracking minimizes to **Live Bar** |
