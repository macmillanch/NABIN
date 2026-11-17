# NABIN — FOOD REQUIRED SCREEN PLAN

**Document ID:** NABIN-PLAN-FOOD-001  
**Project ID:** `7613683360643688164`  
**Vertical Accent:** Warm Orange (`#E85D24`)  
**Total Production Screens:** 24 Screens (Pruning 3 intra-project duplicates)  

---

## Screen Register & Specifications

| Plan ID | Existing Stitch ID | Screen Name | Role / Purpose | Entry Point | Exit Destination |
|---|---|---|---|---|---|
| **FD-01** | `b8bdeeb9ccd64edb8284b89e6e72be4d` | FOOD-001 Food Home & Discovery | Restaurant rails, cuisine tags, cost-for-two | Super-App Home | FD-05 / FD-07 |
| **FD-02** | `71454abef4af49d99b6f833ca31a525e` | FOOD-002 Location & Delivery Address | Geofenced restaurant radius selector | FD-01 Header | FD-01 Food Home |
| **FD-03** | `3d803460b16d43ffa7dc134c22e04545` | FOOD-003 Food Search | Search dishes and cloud kitchens | FD-01 Top Bar | FD-04 Results |
| **FD-04** | `9104736fd4a6431e8786f5eefd4edaf5` | FOOD-004 Search Results | Pure Veg / Rating / Price filters | FD-03 | FD-07 Restaurant Menu |
| **FD-05** | `5472b450bded4001afcd1523dda8a6dc` | FOOD-005 Cuisine & Category Discovery | Biryani, South Indian, Pizza, Chinese | FD-01 Rails | FD-06 Restaurant List |
| **FD-06** | `ad6a1bc2c1b7457899595e3d0261adb7` | FOOD-006 Restaurant Listing | Ranked list by prep time & rating | FD-05 | FD-07 Restaurant Menu |
| **FD-07** | `6f8d99bb47244ffd8ced05a5a2801474` | FOOD-007 Restaurant Details & Menu | Full categorized menu & kitchen badges | FD-01/06 | FD-08 Customizer |
| **FD-08** | `753a3cb778c94f739a27b8f79fff5e29` | FOOD-008 Dish Details & Customization | Veg/Non-Veg, spice level, add-on tray | FD-07 Dish Tap | FD-09 Food Cart |
| **FD-09** | `efd1c1bd2dc14078a98d5310ff316bee` | FOOD-009 Food Cart | Section 9(5) 5% GST breakdown & notes | FD-07/08 Cart | FD-13 Checkout |
| **FD-10** | `8f984d93b70d4976a629ac36eb65d8d6` | FOOD-010 Offers and Coupons | Restaurant coupon applicator | FD-09 | FD-09 Food Cart |
| **FD-11** | `03948bf1781b48f9b1f09359a69968c8` | FOOD-011 Delivery Address Confirmation | Select landmark address for drop | FD-09 | FD-13 Checkout |
| **FD-12** | `5dcd7fd5b8f94189acf502fe08407ae3` | FOOD-012 Payment Method | UPI Intent, Cards, COD (city cap) | FD-13 | FD-14 Order Placed |
| **FD-13** | `b1d4071a3a9a4eacb0c79a9d7eb4e48c` | FOOD-013 Order Review and Checkout | Itemized bill, tip, delivery fee | FD-09 | FD-14 Order Placed |
| **FD-14** | `e329aac2b03c415b86c845a6eee6b197` | FOOD-014 Order Placed Confirmation | Sound chime + order ID generated | FD-13 | FD-15 Acceptance |
| **FD-15** | `23f86802f7ae458b8eb8d41dc459a181` | FOOD-015 Restaurant Confirmation | Merchant handshake countdown | FD-14 | FD-16 Prep Track |
| **FD-16** | `b774189f5f6b411998f323c96c8d5355` | FOOD-016 Food Preparation Tracking | Kitchen KOT 10-30 min progress bar | FD-15 | FD-17 Rider Assign |
| **FD-17** | `b7d578b0855c494fb5797844ae9a3148` | FOOD-017 Delivery Partner Assigned | Live rider photo, vehicle, and arrival | FD-16 | FD-18 Live Tracking |
| **FD-18** | `c4297b7e95f14db0bf7d2b2cc55700b3` | FOOD-018 Live Food Order Tracking | Map vector, ETA, delivery PIN | FD-17 | FD-20 Delivered |
| **FD-19** | `17871950dbb648ef818162d5d18cb2ae` | FOOD-019 Customer & Rider Chat | In-app messaging for gate/landmark | FD-18 Chat | FD-18 Tracking |
| **FD-20** | `875faa4319864682a99ddfc6fa62770f` | FOOD-020 Food Order Delivered | Thermal invoice, itemized bill | FD-18 | FD-21 Rating |
| **FD-21** | `fe7c7496f6ce4ea7848bf0fae3c490c5` | FOOD-021 Ratings & Restaurant Reviews | Food quality, packaging, rider rating | FD-20 | Super-App Home |
| **FD-22** | `ea3e43b6314643a3b03c2c7ba68815a6` | FOOD-022 Food Order History | Past meals, re-order 1-tap button | Profile Activity| FD-07 Menu |
| **FD-23** | `7b97f9e0f848421a89c7fba74d09ee76` | FOOD-024 Food Order Cancellation | Kitchen cancellation rules | FD-14/15 | FD-01 Food Home |
| **FD-24** | `3471221019a5410bbee443dbaebb74b0` | FOOD-027 Food Error & Closed States | Kitchen closed, item sold out | Error | FD-01 Food Home |
