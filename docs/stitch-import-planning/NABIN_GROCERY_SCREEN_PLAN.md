# NABIN — GROCERY REQUIRED SCREEN PLAN

**Document ID:** NABIN-PLAN-GROCERY-001  
**Project ID:** `7916514387823717414`  
**Vertical Accent:** Fresh Farm Green (`#16834A`)  
**Total Production Screens:** 27 Screens (Pruning 6 intra-project duplicates)  

---

## Screen Register & Specifications

| Plan ID | Existing Stitch ID | Screen Name | Role / Purpose | Entry Point | Exit Destination |
|---|---|---|---|---|---|
| **GR-01** | `da50adee7ce0408d8b6ddfb33f936ba0` | GROCERY-001 Grocery Kirana Home | Daily essentials, store aisles, discounts | Super-App Home | GR-05 / GR-06 |
| **GR-02** | `575fae39f397462ea4f520861d82e2aa` | GROCERY-002 Delivery Location Confirmation | Kirana hyperlocal geofence check | GR-01 Header | GR-01 Grocery Home |
| **GR-03** | `79f37ccb71ff4d3d940e4713cea1b5df` | GROCERY-003 Product & Store Search | Barcode / SKU search & brand filters | GR-01 Top Bar | GR-04 Search Results |
| **GR-04** | `736f6cb0833542b4aafdac305d51762a` | GROCERY-004 Search Results | 2-column SKU shelf with +/- stepper | GR-03 | GR-10 Product Detail |
| **GR-05** | `4a2e2b83054a4211b2375610b584fb20` | GROCERY-005 Category Discovery | Atta/Rice, Dairy, Personal Care, Snacks | GR-01 Aisle | GR-08 Category List |
| **GR-06** | `a081b4be1df34c2599b8f1c461228e6a` | GROCERY-006 Store Discovery | Nearest physical retail grocery stores | GR-01 Banner | GR-07 Store Details |
| **GR-07** | `fd2581658a4541588816f041142fa61f` | GROCERY-007 Store Details & Catalog | Store inventory, merchant hours | GR-06 | GR-09 Product List |
| **GR-08** | `4e8b09de474b4e73b0bda07a18a6385f` | GROCERY-008 Product Category Listing | Sub-categories (e.g. Organic, Pulses) | GR-05 | GR-09 Product List |
| **GR-09** | `2eafe0844ad44fdca09ed859eb973d4c` | GROCERY-009 Product SKU Listing | Retail items with MRP strikethrough | GR-07/08 | GR-10 Product Detail |
| **GR-10** | `f103e8d2be3b4c0f975c673ed773ff71` | GROCERY-010 Product Details | Weight tags (500g, 1kg), stock status | GR-09 SKU Tap | GR-12 Grocery Cart |
| **GR-11** | `c3d5b3e6d0e24bc9964e62531884407e` | GROCERY-011 Product Variants & Quantities | Pack sizes (500ml vs 1L) selector | GR-10 | GR-12 Grocery Cart |
| **GR-12** | `469e5e2bdb5b4462b494299d826cb09c` | GROCERY-012 Dedicated Grocery Cart | Multi-item basket, bag fee, savings | GR-09/10 Cart | GR-13 Substitution |
| **GR-13** | `9dbcd63114604a1794101c7b44daa624` | GROCERY-013 Substitution Preferences | Call me / Replace with best match / Refund | GR-12 | GR-16 Delivery Slot |
| **GR-14** | `63d25fabb32c4cddb643d5410005b5be` | GROCERY-014 Offers and Coupons | Kirana store coupons | GR-12 | GR-12 Cart |
| **GR-15** | `bb107a99646f48d7935b7fe51ec7161c` | GROCERY-015 Delivery Address Confirmation | Confirm apartment, flat, floor | GR-12 | GR-16 Delivery Slot |
| **GR-16** | `a341fadde5ec455899f1057c62b43892` | GROCERY-016 Delivery Slot Selection | Instant 30-min express vs. Scheduled slot | GR-13/15 | GR-17 Payment |
| **GR-17** | `37115d89c6314c24948e4227bf966906` | GROCERY-017 Payment Methods | UPI, Cards, COD (city cap validation) | GR-16 | GR-18 Checkout |
| **GR-18** | `e35d18e4efde4c9f9b6a754bcfb9e2ff` | GROCERY-018 Order Review & Checkout | Item-Level GST (0%, 5%, 12%, 18%) bill | GR-17 | GR-19 Order Placed |
| **GR-19** | `679a7902431c44cd8f2d7ac0d602bbbc` | GROCERY-019 Order Placed Confirmation | Order ID, expected arrival window | GR-18 | GR-20 Acceptance |
| **GR-20** | `baded7e82b2c421ba83d5d4c35736848` | GROCERY-020 Store Acceptance | Kirana store clerk confirmation | GR-19 | GR-21 Picking |
| **GR-21** | `c92bbc55c04a440eb1feb6b210bbc11c` | GROCERY-021 Grocery Picking Progress | Live checklist of items picked | GR-20 | GR-23 Packed Order |
| **GR-22** | `bcf9e89861fd44e394d4438c4dfe147c` | GROCERY-022 Unavailable Replacement Modal | Price delta & approval trigger | GR-21 Stock Out | GR-21 Picking |
| **GR-23** | `5a59b34596b24088a9aadb33d40d6b11` | GROCERY-023 Packed Order & Partner Assign | Bag sealed & rider dispatched | GR-21 | GR-24 Live Tracking |
| **GR-24** | `55b8d9b34a2d4a0fbe12eb1ad9a144b3` | GROCERY-024 Live Order Tracking | Real-time rider route to customer | GR-23 | GR-25 Handover |
| **GR-25** | `7c8e5ad79a8d489497959f6ff8178a91` | GROCERY-025 Delivery Handover (OTP) | Handover verification code | GR-24 | GR-26 Delivered |
| **GR-26** | `338f92e3434c426e8ec348d017e37ad5` | GROCERY-026 Order Delivered & GSTR-1 Bill | Itemized tax invoice & download | GR-25 | Super-App Home |
| **GR-27** | `d5ab5a9dabc44c62ab2a586ecb5e11e8` | GROCERY-030 Cancellation & Refund Policy | Store picking cancellation rules | GR-20/21 | GR-01 Grocery Home |
