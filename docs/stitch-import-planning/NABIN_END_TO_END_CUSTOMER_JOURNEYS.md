# NABIN — COMPLETE END-TO-END CUSTOMER JOURNEYS

**Document ID:** NABIN-JOURNEYS-001  
**Status:** PHASE 5 COMPREHENSIVE SPECIFICATION  

---

## 1. Journey 1: Customer Onboarding, Mobile OTP & Mandatory Landmark

```
[SA-01: Welcome] → [SA-02: Showcase] → [SA-03: Phone Input (+91)] → [SA-04: 6-Digit SMS OTP]
       ↓
[SA-05: Landmark Address Picker] ── (Missing Landmark?) ──→ [Landmark Error Banner]
       ↓ (Valid Landmark)                                             ↓
[SA-07: Pin-on-Map Confirmation] ←─────────────────────────────────────┘
       ↓
[SA-08: Main Marketplace Home]
```

- **Primary Trigger:** Fresh install or session expiry.
- **Fail-Closed Condition:** If GPS resolves a street without an Indian landmark, checkout and service booking remain disabled until the user provides a recognized local landmark (e.g. *"Opposite SBI Bank"*, *"Near Kamalanagar Daily Market"*).

---

## 2. Journey 2: NABIN Ride Complete Mobility Flow

```
[SA-08: Home (Tap Ride)] → [RD-01: Ride Home] → [RD-02: Destination Search]
       ↓
[RD-03: Curbside Pin Adjust] → [RD-04: Vehicle Selection (Bike/Auto/Cab)]
       ↓
[RD-07: Fare Checkout] → [RD-08: Radar Matching (30s Countdown)]
       ↓
[RD-09: Driver Assigned (Display 4-Digit OTP)] ── (Curbside Match) ──→ Driver Validates OTP
       ↓
[RD-10: Live Active Trip (Destination ETA + SOS Shield)]
       ↓
[RD-11: Trip Completed & Digital Receipt] → [SA-08: Return to Home]
```

- **Specialized Modes:** Rentals (`RD-05`) and Shared Pool (`RD-06`) split off from `RD-04` and merge back at `RD-07`.
- **Safety Fallback:** Tapping SOS triggers `RD-013` (112 police dispatch + WhatsApp live tracking link broadcast).

---

## 3. Journey 3: NABIN Food Restaurant Cooked Meal Flow

```
[SA-08: Home (Tap Food)] → [FD-01: Food Home] → [FD-05: Cuisine / FD-06: Restaurant List]
       ↓
[FD-07: Restaurant Menu] → [FD-08: Veg/Non-Veg & Spice Customization Sheet]
       ↓
[FD-09: Food Cart (Section 9(5) 5% GST)] → [FD-13: Order Review & UPI Payment]
       ↓
[FD-14: Order Placed] → [FD-15: Kitchen KOT Handshake] → [FD-16: Food Preparation (10-30m)]
       ↓
[FD-17: Delivery Partner Dispatched] → [FD-18: Live Food Order Tracking]
       ↓
[FD-20: Food Delivered (Thermal Receipt)] → [FD-21: Star Rating] → [SA-08: Return to Home]
```

- **Statutory Constraint:** Strict enforcement of 5% GST under Section 9(5) without input tax credit for restaurants.

---

## 4. Journey 4: NABIN Grocery Kirana Retail Basket Flow

```
[SA-08: Home (Tap Grocery)] → [GR-01: Kirana Home] → [GR-06: Store Discovery / GR-05: Aisles]
       ↓
[GR-07: Store Catalog] → [GR-10: Product SKU (MRP vs Selling Price)]
       ↓
[GR-12: Dedicated Grocery Cart] → [GR-13: Out-of-Stock Substitution Rules]
       ↓
[GR-16: Slot Selection (Express vs Scheduled)] → [GR-18: Item-Level GST Checkout]
       ↓
[GR-19: Order Placed] → [GR-20: Kirana Acceptance] → [GR-21: Live Picking Progress]
       ↓
(Item Missing?) ──→ [GR-22: Customer Replacement Approval] ──→ Item Substituted
       ↓
[GR-23: Packed & Rider Dispatched] → [GR-24: Live Delivery Tracking]
       ↓
[GR-25: Handover OTP] → [GR-26: Delivered & GSTR-1 Tax Invoice]
```

- **Statutory Constraint:** Item-level GST slabs (`0%`, `5%`, `12%`, `18%`) rendered with separate tax ledger.

---

## 5. Journey 5: NABIN Parcel Express Courier Flow

```
[SA-08: Home (Tap Parcel)] → [PC-01: Parcel Home] → [PC-02: Pickup] → [PC-03: Drop-Off]
       ↓
[PC-04: Route Map] → [PC-05: Package Category] → [PC-06: Weight Class (<15kg 2W vs >15kg 3W)]
       ↓
[PC-07: Photo Snapshot] → [PC-08: Contents Declaration] → [PC-09: Sender] → [PC-10: Recipient]
       ↓
[PC-11: Delivery Option] → [PC-13: Upfront Fare] → [PC-14: Review & Receiver OTP Toggle]
       ↓
[PC-15: Payment] → [PC-16: Booking Confirmed] → [PC-17: Courier Matching]
       ↓
[PC-18: Courier Assigned] → [PC-20: Pickup Photo Verification]
       ↓
[PC-21: In Transit] → [PC-23: Handover & Receiver 4-Digit OTP / Signature]
       ↓
[PC-24: Parcel Delivered] → [SA-08: Return to Home]
```
