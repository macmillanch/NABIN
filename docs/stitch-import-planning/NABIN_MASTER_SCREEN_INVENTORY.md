# NABIN — MASTER SCREEN INVENTORY (ALL 5 STITCH PROJECTS)

**Document ID:** NABIN-MASTER-INVENTORY-001  
**Last Updated:** November 17, 2026  
**Scope:** 176 instances (137 UI Screens, 7 Tech Specs, 32 System Assets)  

---

## Screen Classification Taxonomy
1. **Onboarding & Auth:** `NABIN-001`, `NABIN-004`, `NABIN-009`, `NABIN-011`
2. **Location & Address:** `NABIN-016`, `NABIN-017`, `NABIN-018`, `FOOD-002`, `GROCERY-002`, `PARCEL-002`, `PARCEL-003`
3. **Home & Marketplace:** `NABIN-021`, `RIDE-001`, `FOOD-001`, `GROCERY-001`, `PARCEL-001`
4. **Search & Discovery:** `NABIN-022`, `NABIN-025`, `FOOD-003`, `FOOD-004`, `FOOD-005`, `FOOD-006`, `GROCERY-003`, `GROCERY-004`, `GROCERY-005`, `GROCERY-006`
5. **Details & Customization:** `FOOD-007`, `FOOD-008`, `GROCERY-007`, `GROCERY-008`, `GROCERY-009`, `GROCERY-010`, `GROCERY-011`, `PARCEL-005`, `PARCEL-006`, `PARCEL-007`, `PARCEL-008`
6. **Cart & Basket:** `FOOD-009`, `GROCERY-012`, `GROCERY-013`
7. **Checkout & Payment:** `RIDE-007`, `FOOD-012`, `FOOD-013`, `GROCERY-016`, `GROCERY-017`, `GROCERY-018`, `PARCEL-011`, `PARCEL-013`, `PARCEL-014`, `PARCEL-015`
8. **Confirmation & Acceptance:** `FOOD-014`, `FOOD-015`, `GROCERY-019`, `GROCERY-020`, `PARCEL-016`
9. **Preparation & Picking:** `FOOD-016`, `GROCERY-021`, `GROCERY-022`, `GROCERY-023`
10. **Matching & Driver Telemetry:** `RIDE-008`, `RIDE-009`, `FOOD-017`, `PARCEL-017`, `PARCEL-018`, `PARCEL-019`, `PARCEL-020`
11. **Live Trip & Delivery Tracking:** `RIDE-010`, `FOOD-018`, `GROCERY-024`, `GROCERY-025`, `PARCEL-021`, `PARCEL-023`
12. **Delivered & Receipts:** `RIDE-011`, `FOOD-020`, `GROCERY-026`, `PARCEL-024`
13. **Ratings & Feedback:** `RIDE-011`, `FOOD-021`, `GROCERY-027`
14. **Activity & History:** `NABIN-033`, `RIDE-012`, `FOOD-022`, `FOOD-023`, `GROCERY-028`, `GROCERY-029`, `PARCEL-025`
15. **Support & Safety:** `NABIN-053`, `RIDE-013`, `FOOD-025`, `GROCERY-032`, `PARCEL-026`
16. **Edge & System States:** `NABIN-061`, `NABIN-062`, `NABIN-063`, `RIDE-014`, `RIDE-015`, `FOOD-024`, `FOOD-027`, `GROCERY-030`, `GROCERY-033`
17. **In-App Communication:** `RIDE-016`, `FOOD-019`, `PARCEL-022`

---

## Detailed Screen Register by Project

### RIDE: NABIN Ride Flutter UI/ux Design new (`projects/15895521349027986707`)

| Screen ID | Label | Role / Purpose | Dimensions | Status |
|---|---|---|---|---|
| `1203a0534ba74a6896048004b68d5246` | RIDE-008 — Live Radar Driver Search & Matching | UI Screen View | 390x1172 | VERIFIED |
| `20042be00ea840cf93d58d2c67d6bf3c` | RIDE-009 — Driver Assigned & Approaching Pickup | UI Screen View | 390x1348 | VERIFIED |
| `2ae7b52e-3bd0-4b65-a415-091a26f7ac88` | nabin-icon-primary-192.png | Logo Asset | 164x192 | VERIFIED |
| `36fc851cdb4943f897f2299cc0455cf0` | RIDE-003 — Map Pin Adjustment & Pickup Confirmation | UI Screen View | 390x884 | VERIFIED |
| `512117cb16164a56beb457a7d7a99024` | RIDE-001 — Ride Home & Discovery | UI Screen View | 390x1363 | VERIFIED |
| `542196bc27f543559ead3866c04be9a8` | RIDE-013 — Emergency & Safety Shield Center | UI Screen View | 390x1520 | VERIFIED |
| `5b7bc73c7b074913b08d7e9ce24fb6b4` | RIDE-011 — Trip Completed, Digital Receipt & Driver Rating | UI Screen View | 390x1515 | VERIFIED |
| `688fd04399b64356a631baa12842799d` | RIDE-002 — Location Search & Suggestions | UI Screen View | 390x1091 | VERIFIED |
| `71de2ed4-aeb6-41c9-81e0-efd00ade89b0` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |
| `799ef8ce3fd2418f81a85be5bf2c0bdf` | NABIN Ride — Flutter GoRouter & State Architecture Specification | UI Screen View | 600x600 | VERIFIED |
| `82f7d7cb22974bb5bd1e899af7b352e1` | NABIN Ride — Screen & Workflow Architecture | UI Screen View | 600x600 | VERIFIED |
| `83b947e406114449b85b3acc0c400954` | RIDE-006 — Shared Ride Specialized Booking | UI Screen View | 390x1396 | VERIFIED |
| `894e824b60e745758113c0c88ce781ea` | RIDE-014 — Cancellation & Refund Policy | UI Screen View | 390x1250 | VERIFIED |
| `a5e3c9e76720430fb7f0f2cd53556a03` | RIDE-015 — Service Availability & System Edge States | UI Screen View | 390x1174 | VERIFIED |
| `assets_2fb00b089aad43c0a8630c9510dcee15` |  | Design Asset | 960x540 | VERIFIED |
| `assets_888661b05e274fd282171709a9ed2ad4` |  | Design Asset | 960x540 | VERIFIED |
| `assets_8a8e8fdf93104360a40e4b03026fdcf9` |  | Design Asset | 960x540 | VERIFIED |
| `b73eb74d974f46eda03b93df688f5fc9` | RIDE-004 — Category Selection & Route Fare Comparison | UI Screen View | 390x1074 | VERIFIED |
| `c712907be8ef42d4b655745a834c20de` | RIDE-010 — Active Trip in Progress & Destination ETA | UI Screen View | 390x1058 | VERIFIED |
| `ca81dbd628a5475f97647545d1f5c4e6` | RIDE-012 — Ride History & Activity Log | UI Screen View | 390x1520 | VERIFIED |
| `dc7dff8f57c14871959d821dba64fd71` | RIDE-005 — Rentals Experience (Hourly & Daily Packages) | UI Screen View | 390x1520 | VERIFIED |
| `e0bd329f376e48c9b06fbac8e1eedaab` | RIDE-007 — Checkout & Itemized Fare Breakdown | UI Screen View | 390x1771 | VERIFIED |
| `e0e9ff3583204e59ae9663a88d5d5740` | RIDE-016 — In-App Driver Chat & Direct Messaging | UI Screen View | 390x1029 | VERIFIED |

### FOOD: NABIN Food Flutter UI/UX Design new (`projects/7613683360643688164`)

| Screen ID | Label | Role / Purpose | Dimensions | Status |
|---|---|---|---|---|
| `03948bf1781b48f9b1f09359a69968c8` | FOOD-011 Delivery Address Confirmation | UI Screen View | 390x1321 | VERIFIED |
| `1139ef7c86fb49eb8aeea058eea6d62d` | FOOD-019 Customer and Delivery Partner Chat | UI Screen View | 390x887 | VERIFIED |
| `1374f1ecfa7e42b49facaafe0da0a51a` | NABIN Food — Flutter & HTML Code Export | UI Screen View | 600x600 | VERIFIED |
| `17871950dbb648ef818162d5d18cb2ae` | FOOD-019 Customer and Delivery Partner Chat | UI Screen View | 390x884 | VERIFIED |
| `23f86802f7ae458b8eb8d41dc459a181` | FOOD-015 Restaurant Confirmation | UI Screen View | 390x1020 | VERIFIED |
| `28d1c5442d2c46f895da35339b8f68aa` | FOOD-025 Help and Support | UI Screen View | 390x1942 | VERIFIED |
| `3471221019a5410bbee443dbaebb74b0` | FOOD-027 Food System and Error States | UI Screen View | 390x2168 | VERIFIED |
| `3d803460b16d43ffa7dc134c22e04545` | FOOD-003 Food Search | UI Screen View | 390x1458 | VERIFIED |
| `48e9a325-6769-417a-999f-73b822856cee` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |
| `5472b450bded4001afcd1523dda8a6dc` | FOOD-005 Cuisine and Category Discovery | UI Screen View | 390x2909 | VERIFIED |
| `5935e29bf1b142099687468d29eaf1cf` | FOOD-026 Notifications | UI Screen View | 390x1649 | VERIFIED |
| `5dcd7fd5b8f94189acf502fe08407ae3` | FOOD-012 Payment Method | UI Screen View | 390x1766 | VERIFIED |
| `6f8d99bb47244ffd8ced05a5a2801474` | FOOD-007 Restaurant Details and Menu | UI Screen View | 390x1758 | VERIFIED |
| `71454abef4af49d99b6f833ca31a525e` | FOOD-002 Location and Delivery Address | UI Screen View | 390x1270 | VERIFIED |
| `753a3cb778c94f739a27b8f79fff5e29` | FOOD-008 Dish Details and Customization | UI Screen View | 390x2135 | VERIFIED |
| `7a1ca9bf67c7454184c7b4befb0b0874` | FOOD-017 Delivery Partner Assigned | UI Screen View | 390x884 | VERIFIED |
| `7b97f9e0f848421a89c7fba74d09ee76` | FOOD-024 Order Cancellation | UI Screen View | 390x1621 | VERIFIED |
| `875faa4319864682a99ddfc6fa62770f` | FOOD-020 Food Order Delivered | UI Screen View | 390x1397 | VERIFIED |
| `8f984d93b70d4976a629ac36eb65d8d6` | FOOD-010 Offers and Coupons | UI Screen View | 390x1356 | VERIFIED |
| `9104736fd4a6431e8786f5eefd4edaf5` | FOOD-004 Search Results | UI Screen View | 390x1792 | VERIFIED |
| `9b8dfad1621748dfb08f8d6f50dfa607` | FOOD-020 Food Order Delivered | UI Screen View | 390x884 | VERIFIED |
| `9e0a75d6-8c94-4b62-84a3-f16696b78f46` | nabin-icon-primary-192.png | Logo Asset | 164x192 | VERIFIED |
| `a55a69ad7692484ca2eaa6b55e462e5e` | FOOD-018 Live Food Order Tracking (Animated) | UI Screen View | 390x1106 | VERIFIED |
| `ad6a1bc2c1b7457899595e3d0261adb7` | FOOD-006 Restaurant Listing | UI Screen View | 390x1484 | VERIFIED |
| `assets_7a12dc4c53504fcb9e7b6157c2dcb1de` |  | Design Asset | 960x540 | VERIFIED |
| `assets_9a60ad7051f841c9ad401cfeced07d0a` |  | Design Asset | 960x540 | VERIFIED |
| `assets_cb7eb74c4b8c48a7b5609286d3f02d24` |  | Design Asset | 960x540 | VERIFIED |
| `b1d4071a3a9a4eacb0c79a9d7eb4e48c` | FOOD-013 Order Review and Checkout | UI Screen View | 390x1393 | VERIFIED |
| `b774189f5f6b411998f323c96c8d5355` | FOOD-016 Food Preparation Tracking | UI Screen View | 390x1850 | VERIFIED |
| `b7d578b0855c494fb5797844ae9a3148` | FOOD-017 Delivery Partner Assigned | UI Screen View | 390x1290 | VERIFIED |
| `b8bdeeb9ccd64edb8284b89e6e72be4d` | FOOD-001 Food Home and Discovery | UI Screen View | 390x1845 | VERIFIED |
| `bdde009f1bb34694a35f71c5f3d065cf` | FOOD-023 Food Order Details | UI Screen View | 390x2044 | VERIFIED |
| `c4297b7e95f14db0bf7d2b2cc55700b3` | FOOD-018 Live Food Order Tracking | UI Screen View | 390x1009 | VERIFIED |
| `e329aac2b03c415b86c845a6eee6b197` | FOOD-014 Order Placed | UI Screen View | 390x1372 | VERIFIED |
| `ea3e43b6314643a3b03c2c7ba68815a6` | FOOD-022 Food Order History | UI Screen View | 390x1778 | VERIFIED |
| `efd1c1bd2dc14078a98d5310ff316bee` | FOOD-009 Food Cart | UI Screen View | 390x1385 | VERIFIED |
| `fe7c7496f6ce4ea7848bf0fae3c490c5` | FOOD-021 Ratings and Reviews | UI Screen View | 390x2040 | VERIFIED |

### GROCERY: NABIN Grocery App UI/UX Design new (`projects/7916514387823717414`)

| Screen ID | Label | Role / Purpose | Dimensions | Status |
|---|---|---|---|---|
| `04f78e2195064d93b87884bf33b836c2` | GROCERY-032 Help and Support | UI Screen View | 390x1751 | VERIFIED |
| `09c7485d598f4b3c9ae28a8422bfff63` | NABIN Grocery - Final Technical Specifications v2.2 | UI Screen View | 600x600 | VERIFIED |
| `2eafe0844ad44fdca09ed859eb973d4c` | GROCERY-009 Product Listing | UI Screen View | 390x1514 | VERIFIED |
| `338f92e3434c426e8ec348d017e37ad5` | GROCERY-026 Order Delivered | UI Screen View | 390x1249 | VERIFIED |
| `37115d89c6314c24948e4227bf966906` | GROCERY-017 Payment Methods | UI Screen View | 390x1546 | VERIFIED |
| `469e5e2bdb5b4462b494299d826cb09c` | GROCERY-012 Dedicated Grocery Cart | UI Screen View | 390x1488 | VERIFIED |
| `495ea1c63a23410ab41ec8ceab570576` | GROCERY-004 Search Results | UI Screen View | 390x884 | VERIFIED |
| `4a2e2b83054a4211b2375610b584fb20` | GROCERY-005 Category Discovery | UI Screen View | 390x2265 | VERIFIED |
| `4e8b09de474b4e73b0bda07a18a6385f` | GROCERY-008 Product Category Listing | UI Screen View | 390x1459 | VERIFIED |
| `5152a58650c34d989a5e12ee325f5575` | NABIN Grocery - Ratified Technical Specifications (NKC Standard) | UI Screen View | 600x600 | VERIFIED |
| `55b8d9b34a2d4a0fbe12eb1ad9a144b3` | GROCERY-024 Live Order Tracking | UI Screen View | 390x1164 | VERIFIED |
| `575fae39f397462ea4f520861d82e2aa` | GROCERY-002 Delivery Location | UI Screen View | 390x1052 | VERIFIED |
| `5a59b34596b24088a9aadb33d40d6b11` | GROCERY-023 Packed Order and Delivery Partner | UI Screen View | 390x1684 | VERIFIED |
| `63d25fabb32c4cddb643d5410005b5be` | GROCERY-014 Offers and Coupons | UI Screen View | 390x1522 | VERIFIED |
| `679a7902431c44cd8f2d7ac0d602bbbc` | GROCERY-019 Order Placed | UI Screen View | 390x1029 | VERIFIED |
| `6a6cd19cc65e4839812bb55246b2c15e` | GROCERY-005 Category Discovery | UI Screen View | 390x884 | VERIFIED |
| `736f6cb0833542b4aafdac305d51762a` | GROCERY-004 Search Results | UI Screen View | 390x1311 | VERIFIED |
| `7959c6450a234176960f9d4253dd5a14` | GROCERY-033 Empty, Loading and Error States | UI Screen View | 390x2350 | VERIFIED |
| `79f37ccb71ff4d3d940e4713cea1b5df` | GROCERY-003 Product and Store Search | UI Screen View | 390x1768 | VERIFIED |
| `7c8e5ad79a8d489497959f6ff8178a91` | GROCERY-025 Delivery Handover | UI Screen View | 390x1213 | VERIFIED |
| `7d233e6934024b7685b0563581850aac` | GROCERY-027 Ratings and Reviews | UI Screen View | 390x1593 | VERIFIED |
| `85d3186dc88d44cdb1395acd51829a4a` | GROCERY-029 Order Details | UI Screen View | 390x1778 | VERIFIED |
| `949b3647a3674393b0b5559c517a2a64` | NABIN Grocery - Flutter Technical Specifications | UI Screen View | 600x600 | VERIFIED |
| `97d5f31390c54a7090408fd9cafc16d5` | GROCERY-031 Notifications | UI Screen View | 390x1236 | VERIFIED |
| `9dbcd63114604a1794101c7b44daa624` | GROCERY-013 Substitution Preferences | UI Screen View | 390x1647 | VERIFIED |
| `a081b4be1df34c2599b8f1c461228e6a` | GROCERY-006 Store Discovery | UI Screen View | 390x1772 | VERIFIED |
| `a341fadde5ec455899f1057c62b43892` | GROCERY-016 Delivery Slot Selection | UI Screen View | 390x1248 | VERIFIED |
| `a384ecb17e664692b0cd37265a37b7cf` | GROCERY-019 Order Placed | UI Screen View | 390x884 | VERIFIED |
| `a424ef0ab3834c73ade2ec9429655af0` | NABIN Grocery - Refined Technical Specifications v2.0 | UI Screen View | 600x600 | VERIFIED |
| `assets_71a54a96aba54541aa04510d6f8a1326` |  | Design Asset | 960x540 | VERIFIED |
| `b07012e5-87bc-4547-9ceb-3d81d04fc6b9` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |
| `b58f6a36-b5c9-4069-90d9-0524b3411b99` | nabin-icon-primary-192.png | Logo Asset | 164x192 | VERIFIED |
| `baded7e82b2c421ba83d5d4c35736848` | GROCERY-020 Store Acceptance | UI Screen View | 390x1218 | VERIFIED |
| `bb107a99646f48d7935b7fe51ec7161c` | GROCERY-015 Delivery Address Confirmation | UI Screen View | 390x1468 | VERIFIED |
| `bcf9e89861fd44e394d4438c4dfe147c` | GROCERY-022 Unavailable Product and Replacement | UI Screen View | 390x1395 | VERIFIED |
| `c3d5b3e6d0e24bc9964e62531884407e` | GROCERY-011 Product Variants and Quantity | UI Screen View | 390x1254 | VERIFIED |
| `c92bbc55c04a440eb1feb6b210bbc11c` | GROCERY-021 Grocery Picking Progress | UI Screen View | 390x1698 | VERIFIED |
| `d302674c3a53486ead67f4f2d5a21b90` | GROCERY-018 Order Review and Checkout | UI Screen View | 390x884 | VERIFIED |
| `d5ab5a9dabc44c62ab2a586ecb5e11e8` | GROCERY-030 Cancellation and Refund | UI Screen View | 390x1806 | VERIFIED |
| `d5ef9bb8c3c24c2994be15ed578c5965` | GROCERY-003 Product and Store Search | UI Screen View | 390x884 | VERIFIED |
| `da50adee7ce0408d8b6ddfb33f936ba0` | GROCERY-001 Grocery Home | UI Screen View | 390x2141 | VERIFIED |
| `e35d18e4efde4c9f9b6a754bcfb9e2ff` | GROCERY-018 Order Review and Checkout | UI Screen View | 390x1455 | VERIFIED |
| `e5bc49e0eedb4011a122e2f0d8c38781` | GROCERY-028 Order History | UI Screen View | 390x1481 | VERIFIED |
| `ee7588e6ad0342d1b99b05ef80d29c3e` | GROCERY-016 Delivery Slot Selection | UI Screen View | 390x884 | VERIFIED |
| `f103e8d2be3b4c0f975c673ed773ff71` | GROCERY-010 Product Details | UI Screen View | 390x2506 | VERIFIED |
| `fd2581658a4541588816f041142fa61f` | GROCERY-007 Store Details | UI Screen View | 390x1570 | VERIFIED |

### PARCEL: NABIN Parcel Customer App ui/ux new (`projects/14684086286758455985`)

| Screen ID | Label | Role / Purpose | Dimensions | Status |
|---|---|---|---|---|
| `0e2fc83e8efe412cbf6214d1a0b1c51a` | PARCEL-006 — Package Details | UI Screen View | 390x1121 | VERIFIED |
| `130391a5eed84ca794c2a156f7658d79` | PARCEL-025 — Booking History & Details | UI Screen View | 390x1472 | VERIFIED |
| `148ece1d7d2e49d1a4cb9206f34a823d` | PARCEL-005 — Package Type | UI Screen View | 390x1182 | VERIFIED |
| `18a23fb8c7fa4586b6ae2c6c083ace5b` | PARCEL-026 — Cancellation, Support & Edge States | UI Screen View | 390x1501 | VERIFIED |
| `28cf908f60694ab89b6fdb7e2d46ac1b` | PARCEL-010 — Recipient Details | UI Screen View | 390x1524 | VERIFIED |
| `4861a336556d48c5a601a8da04fd07b1` | PARCEL-011 — Delivery Options | UI Screen View | 390x992 | VERIFIED |
| `511354bd17a54dc9b8ad973d862c0db0` | PARCEL-001 — Parcel Home | UI Screen View | 390x1388 | VERIFIED |
| `574e644636074f8a9488fce1c7b654f9` | PARCEL-021 — Parcel In Transit | UI Screen View | 390x996 | VERIFIED |
| `6bb1daeac1b545a8ab5f5618443abd64` | PARCEL-020 — Package Pickup & Verification | UI Screen View | 390x1245 | VERIFIED |
| `70095da745c64463968f179c61177b8a` | PARCEL-022 — Customer & Driver Chat | UI Screen View | 390x918 | VERIFIED |
| `731f5e6bedd147a59fbd4edb9bf3477b` | PARCEL-003 — Drop-Off Location | UI Screen View | 390x1519 | VERIFIED |
| `7341044dc58046ce9f3b104294ec6c67` | PARCEL-016 — Booking Confirmation | UI Screen View | 390x1347 | VERIFIED |
| `85b3b86a310a4407a8e61f412263f8e2` | PARCEL-007 — Package Photos | UI Screen View | 390x1198 | VERIFIED |
| `86fe00ebef044744bc7d4011648c3f9b` | PARCEL-002 — Pickup Location | UI Screen View | 390x1066 | VERIFIED |
| `89bb56e556f1411291b84eee5a735885` | PARCEL-009 — Sender Details | UI Screen View | 390x1284 | VERIFIED |
| `8d9e63cecd18420182201290486e00f0` | PARCEL-023 — Delivery Handover & Proof | UI Screen View | 390x1267 | VERIFIED |
| `94aba707c59d4f2aa1b0362fe9663e60` | PARCEL-013 — Price Estimate | UI Screen View | 390x1407 | VERIFIED |
| `9e30484fcae645fc99c30c8f857d3685` | PARCEL-012 — Schedule Pickup | UI Screen View | 390x1282 | VERIFIED |
| `a03f875125b6438490138486a323112c` | PARCEL-017 — Driver Matching | UI Screen View | 390x1000 | VERIFIED |
| `ada27834d7564171b47f51d68de4d6b7` | PARCEL-008 — Contents Declaration | UI Screen View | 390x1234 | VERIFIED |
| `af886ae0f5e34b7c85bdf6cca9d031e6` | PARCEL-004 — Location Map Confirmation | UI Screen View | 390x898 | VERIFIED |
| `assets_1caface2b9014b1988b77d23bef88b2a` |  | Design Asset | 960x540 | VERIFIED |
| `c8699909-558a-4fd1-bc50-aa265336d6a4` | nabin-icon-primary-192.png | Logo Asset | 164x192 | VERIFIED |
| `c91d96a2f8a4441ca17c012c638cecdf` | PARCEL-015 — Payment Methods | UI Screen View | 390x1338 | VERIFIED |
| `d20da0d2ca3e4dafbdf1c99838150670` | PARCEL-014 — Booking Review | UI Screen View | 390x1239 | VERIFIED |
| `db9f300e-7e5c-4ac5-b713-45303101206e` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |
| `dc1a79ced9ad442398897e7dc35a2ff1` | PARCEL-018 — Driver Assigned | UI Screen View | 390x1269 | VERIFIED |
| `f3f838d386ec40368dd484a9faaa37f3` | PARCEL-019 — Pickup Approaching | UI Screen View | 390x1063 | VERIFIED |
| `f64dcf78b7d84e3ca11be00900b4a7b8` | PARCEL-024 — Parcel Delivered | UI Screen View | 390x1312 | VERIFIED |
| `f7632af8-02b1-4062-a8d9-79a2bd7d8414` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |

### SUPERAPP: NABIN Super-App Mobile UI/UX Design (`projects/489536988828642080`)

| Screen ID | Label | Role / Purpose | Dimensions | Status |
|---|---|---|---|---|
| `010f44543a49436f832f3782b7a0e552` | NABIN-076 — Ride Completed, Rating & Tip | UI Screen View | 390x1357 | VERIFIED |
| `0a97ac4e914e4592bd3aee2a788b6081` | NABIN-082 — Restaurant Menu & Dish Detail | UI Screen View | 390x1385 | VERIFIED |
| `0d1bd11f0b8e4681a9eeeb5d0a01670c` | NABIN-016 — Location & Address Setup | UI Screen View | 390x985 | VERIFIED |
| `0d45d4e686014b3dbd55e5cb5c9a493d` | NABIN-046 — Manage Favourites | UI Screen View | 390x1974 | VERIFIED |
| `0efd059860294b53a73d7d8a7a6929df` | NABIN-017 — Manual Address Search & Location Picker | UI Screen View | 390x1126 | VERIFIED |
| `2920c8771b934807b6fff455e671fc07` | NABIN-022 — Universal Search & Discovery | UI Screen View | 390x948 | VERIFIED |
| `346245e0177f45cf934bdf560678e2c4` | NABIN-018 — Pin-on-Map Address Confirmation | UI Screen View | 390x958 | VERIFIED |
| `37a4d153-21ef-4aee-b0bb-e05cc06de1e5` | nabin-icon-primary-192.png | Logo Asset | 164x192 | VERIFIED |
| `38180ea103f944f6a132526c7706e4c0` | NABIN-093 — Live Grocery Tracking & Picking | UI Screen View | 390x1652 | VERIFIED |
| `416bc3e32d88445585d1e537ded8fce5` | NABIN-085 — Food Order Delivered, Rating & Tip | UI Screen View | 390x2081 | VERIFIED |
| `4787dd61b6184401a0e992869d8476ce` | NABIN-043 — Customer Profile & Account | UI Screen View | 390x1744 | VERIFIED |
| `494c2d5e18a6495b868143a81e153c0f` | NABIN-091 — Grocery Store Catalog | UI Screen View | 390x1891 | VERIFIED |
| `4f915e269ef1476e983eabbc9fbbd5e1` | NABIN-044 — Saved Addresses Management | UI Screen View | 390x1899 | VERIFIED |
| `5ecd27de1c1546479ee98587c9e31f9f` | NABIN-025 — Universal Search Empty State | UI Screen View | 390x1662 | VERIFIED |
| `5f23d43289824c0484f38c82f8aef8d4` | NABIN-047 — Offers & Promotions | UI Screen View | 390x1629 | VERIFIED |
| `604793f3f7d347d2a0ba284222547188` | NABIN-072 — Ride Map & Route Selection | UI Screen View | 390x989 | VERIFIED |
| `6404eca20f12433bad74944b71b6c8f4` | NABIN-021 — Main Marketplace Home | UI Screen View | 390x1709 | VERIFIED |
| `6bbff028ae7c422b842b9c8f27db8ceb` | NABIN-095 — Parcel Courier Booking | UI Screen View | 390x2040 | VERIFIED |
| `6fe2b02fc1f043dfb8448b5ebe07ec77` | NABIN-092 — Grocery Cart & Instant Checkout | UI Screen View | 390x2004 | VERIFIED |
| `774e06e5abec4305abd74ce8fd3cd459` | NABIN-039 — Notifications & Alerts Centre | UI Screen View | 390x1716 | VERIFIED |
| `7a64010f70bb42e7b67d560671b74e33` | NABIN-084: Live Order Tracking & Kitchen Preparation | UI Screen View | 390x1354 | VERIFIED |
| `88df231a05c744e68c2e2d7e4bd0f5ee` | NABIN-063 — Location Unavailable / GPS Denied State | UI Screen View | 390x1540 | VERIFIED |
| `914b2d8d1b2e4c8f978f842f3dc6677e` | NABIN-009 — Customer Login (+91) | UI Screen View | 390x884 | VERIFIED |
| `ac83522cf3b2423893b2d8feb2952e4e` | NABIN-033 — Unified Activity & History | UI Screen View | 390x1442 | VERIFIED |
| `acce6e05294645429a0d825ff861f28a` | NABIN-053 — Shared Help & Customer Support | UI Screen View | 390x1511 | VERIFIED |
| `assets_551d6d1ed565497ea4277db692e94a41` |  | Design Asset | 960x540 | VERIFIED |
| `b3e3c154f05b49be8d6e4ed29394b6bb` | NABIN-073 — Vehicle Selection & Live Fare Breakdown | UI Screen View | 390x1110 | VERIFIED |
| `bc82b589c09f4d92ac73dfadba7c2975` | NABIN-049 — Recommendations & Discovery | UI Screen View | 390x1817 | VERIFIED |
| `bd8329e79d6f4b26ab93755918c38815` | NABIN-075 — Active Trip Tracking & Live Captain Map | UI Screen View | 390x1236 | VERIFIED |
| `c0400b8fb868471fb0f63443b1628fd9` | NABIN-062 — Server Error / 500 State | UI Screen View | 390x1278 | VERIFIED |
| `c698c47ebdcd4a2c8b3a195d4e863425` | NABIN-048 — Offer Details | UI Screen View | 390x1448 | VERIFIED |
| `ca7bb89261e5490b8d4d837db30d5e66` | NABIN-004 — Customer Onboarding & Service Showcase | UI Screen View | 390x970 | VERIFIED |
| `d48d4e68ec034b9cb7a29b2ee79e7c67` | NABIN-061 — No Internet Connection / Offline State | UI Screen View | 390x1278 | VERIFIED |
| `d8895b2847934e41b2d36f13f3cd6121` | NABIN-041 — Notification Preferences | UI Screen View | 390x1586 | VERIFIED |
| `dc929506-fe00-41d6-b072-9ec5989afdb2` | nabin-wordmark-primary-192.png | Logo Asset | 512x149 | VERIFIED |
| `f0ec18963c354e4d96787ae49fe2199b` | NABIN-011 — 6-Digit OTP Verification | UI Screen View | 390x884 | VERIFIED |
| `f12158b4317f40ec8ae284eeff0f06f7` | NABIN-045 — Payment Methods & Wallet | UI Screen View | 390x1860 | VERIFIED |
| `f3f60fbf4c384eb5bbafefdc713f18b4` | NABIN-094 — Grocery Delivered, Feedback & Invoice | UI Screen View | 390x2177 | VERIFIED |
| `f7b126f73b054c5790c511a206dacfe6` | NABIN-083 — Food Cart & Checkout Screen | UI Screen View | 390x1609 | VERIFIED |
| `fe175b02116a41378bce7610fe0302ca` | NABIN-001 — Welcome & App Launch | UI Screen View | 390x1684 | VERIFIED |
