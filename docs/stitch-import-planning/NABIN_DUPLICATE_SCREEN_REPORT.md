# NABIN — DUPLICATE SCREEN & REDUNDANCY REPORT

**Document ID:** NABIN-DUPLICATE-REPORT-001  
**Status:** AUDITED  

---

## 1. Executive Summary: The Outer vs. Inner Duplication Dilemma

A comprehensive cross-project audit identified **two distinct categories of screen duplication**:
1. **Intra-Project Duplicates:** Identical screen concepts generated multiple times within the same vertical project (e.g. two identical delivery chat screens in Food, two identical checkout reviews in Grocery).
2. **Cross-Project Boundary Violations:** The **Customer Super-App (`489536988828642080`)** currently contains **13 inner service screens** that replicate the detailed workflows owned exclusively by Ride, Food, Grocery, and Parcel.

---

## 2. Cross-Project Boundary Violations (Super-App Duplicating Inner Workflows)

Per **Part 2 & Part 6** of the Master Engineering Specification:
> *"The four service projects own their complete inner service workflows. The Super-App owns the outer/shared application experience. Do not duplicate the detailed inner service screens inside the Super-App."*

The following 13 screens currently sitting inside the Customer Super-App must be retired from the Super-App scope and formally deferred to their respective inner service owners:

| Super-App Screen ID | Screen Label | True Service Owner | Canonical Screen in Service Project | Action Required |
|---|---|---|---|---|
| `604793f3f7d347d2a0ba284222547188` | NABIN-072 — Ride Map & Route Selection | **RIDE** | `688fd04399b64356a631baa12842799d` (RIDE-002) & `36fc851cdb4943f897f2299cc0455cf0` (RIDE-003) | **Remove from Super-App**; Navigate to Ride Module |
| `b3e3c154f05b49be8d6e4ed29394b6bb` | NABIN-073 — Vehicle Selection & Live Fare Breakdown | **RIDE** | `b73eb74d974f46eda03b93df688f5fc9` (RIDE-004) | **Remove from Super-App**; Owned by Ride Module |
| `bd8329e79d6f4b26ab93755918c38815` | NABIN-075 — Active Trip Tracking & Live Captain Map | **RIDE** | `c712907be8ef42d4b655745a834c20de` (RIDE-010) | **Remove from Super-App**; Owned by Ride Module |
| `010f44543a49436f832f3782b7a0e552` | NABIN-076 — Ride Completed, Rating & Tip | **RIDE** | `5b7bc73c7b074913b08d7e9ce24fb6b4` (RIDE-011) | **Remove from Super-App**; Owned by Ride Module |
| `0a97ac4e914e4592bd3aee2a788b6081` | NABIN-082 — Restaurant Menu & Dish Detail | **FOOD** | `6f8d99bb47244ffd8ced05a5a2801474` (FOOD-007) & `753a3cb778c94f739a27b8f79fff5e29` (FOOD-008) | **Remove from Super-App**; Owned by Food Module |
| `f7b126f73b054c5790c511a206dacfe6` | NABIN-083 — Food Cart & Checkout Screen | **FOOD** | `efd1c1bd2dc14078a98d5310ff316bee` (FOOD-009) & `b1d4071a3a9a4eacb0c79a9d7eb4e48c` (FOOD-013) | **Remove from Super-App**; Owned by Food Module |
| `7a64010f70bb42e7b67d560671b74e33` | NABIN-084: Live Order Tracking & Kitchen Preparation | **FOOD** | `b774189f5f6b411998f323c96c8d5355` (FOOD-016) & `c4297b7e95f14db0bf7d2b2cc55700b3` (FOOD-018) | **Remove from Super-App**; Owned by Food Module |
| `416bc3e32d88445585d1e537ded8fce5` | NABIN-085 — Food Order Delivered, Rating & Tip | **FOOD** | `875faa4319864682a99ddfc6fa62770f` (FOOD-020) & `fe7c7496f6ce4ea7848bf0fae3c490c5` (FOOD-021) | **Remove from Super-App**; Owned by Food Module |
| `494c2d5e18a6495b868143a81e153c0f` | NABIN-091 — Grocery Store Catalog | **GROCERY** | `da50adee7ce0408d8b6ddfb33f936ba0` (GROCERY-001) & `fd2581658a4541588816f041142fa61f` (GROCERY-007) | **Remove from Super-App**; Owned by Grocery Module |
| `6fe2b02fc1f043dfb8448b5ebe07ec77` | NABIN-092 — Grocery Cart & Instant Checkout | **GROCERY** | `469e5e2bdb5b4462b494299d826cb09c` (GROCERY-012) & `e35d18e4efde4c9f9b6a754bcfb9e2ff` (GROCERY-018) | **Remove from Super-App**; Owned by Grocery Module |
| `38180ea103f944f6a132526c7706e4c0` | NABIN-093 — Live Grocery Tracking & Picking | **GROCERY** | `c92bbc55c04a440eb1feb6b210bbc11c` (GROCERY-021) & `55b8d9b34a2d4a0fbe12eb1ad9a144b3` (GROCERY-024) | **Remove from Super-App**; Owned by Grocery Module |
| `f3f60fbf4c384eb5bbafefdc713f18b4` | NABIN-094 — Grocery Delivered, Feedback & Invoice | **GROCERY** | `338f92e3434c426e8ec348d017e37ad5` (GROCERY-026) & `7d233e6934024b7685b0563581850aac` (GROCERY-027) | **Remove from Super-App**; Owned by Grocery Module |
| `6bbff028ae7c422b842b9c8f27db8ceb` | NABIN-095 — Parcel Courier Booking | **PARCEL** | `511354bd17a54dc9b8ad973d862c0db0` (PARCEL-001) through `94aba707c59d4f2aa1b0362fe9663e60` (PARCEL-013) | **Remove from Super-App**; Owned by Parcel Module |

---

## 3. Intra-Project Duplicates Within Vertical Services

### A. NABIN Food Duplicates:
1. **FOOD-019 Delivery Partner Chat**:
   - Screen A: `1139ef7c86fb49eb8aeea058eea6d62d` (390x887)
   - Screen B: `17871950dbb648ef818162d5d18cb2ae` (390x884)
   - *Resolution:* Retain `17871950dbb648ef818162d5d18cb2ae` as canonical; archive `1139ef7c86fb49eb8aeea058eea6d62d`.
2. **FOOD-017 Delivery Partner Assigned**:
   - Screen A: `7a1ca9bf67c7454184c7b4befb0b0874` (390x884)
   - Screen B: `b7d578b0855c494fb5797844ae9a3148` (390x1290)
   - *Resolution:* Retain `b7d578b0855c494fb5797844ae9a3148` (complete view with live rider card and ETA).
3. **FOOD-020 Food Order Delivered**:
   - Screen A: `875faa4319864682a99ddfc6fa62770f` (390x1397)
   - Screen B: `9b8dfad1621748dfb08f8d6f50dfa607` (390x884)
   - *Resolution:* Retain `875faa4319864682a99ddfc6fa62770f` (complete view with full bill breakdown and itemized receipt).

### B. NABIN Grocery Duplicates:
1. **GROCERY-003 Product and Store Search**:
   - Screen A: `79f37ccb71ff4d3d940e4713cea1b5df` (390x1768)
   - Screen B: `d5ef9bb8c3c24c2994be15ed578c5965` (390x884)
   - *Resolution:* Retain `79f37ccb71ff4d3d940e4713cea1b5df` (full category discovery + search suggestions).
2. **GROCERY-004 Search Results**:
   - Screen A: `495ea1c63a23410ab41ec8ceab570576` (390x884)
   - Screen B: `736f6cb0833542b4aafdac305d51762a` (390x1311)
   - *Resolution:* Retain `736f6cb0833542b4aafdac305d51762a` (complete 2-column catalog with filter chips).
3. **GROCERY-005 Category Discovery**:
   - Screen A: `4a2e2b83054a4211b2375610b584fb20` (390x2265)
   - Screen B: `6a6cd19cc65e4839812bb55246b2c15e` (390x884)
   - *Resolution:* Retain `4a2e2b83054a4211b2375610b584fb20` (full visual departmental catalog).
4. **GROCERY-016 Delivery Slot Selection**:
   - Screen A: `a341fadde5ec455899f1057c62b43892` (390x1248)
   - Screen B: `ee7588e6ad0342d1b99b05ef80d29c3e` (390x884)
   - *Resolution:* Retain `a341fadde5ec455899f1057c62b43892` (shows express instant slot + scheduled date/time tabs).
5. **GROCERY-018 Order Review and Checkout**:
   - Screen A: `d302674c3a53486ead67f4f2d5a21b90` (390x884)
   - Screen B: `e35d18e4efde4c9f9b6a754bcfb9e2ff` (390x1455)
   - *Resolution:* Retain `e35d18e4efde4c9f9b6a754bcfb9e2ff` (complete view with item-level GST breakdown and delivery instructions).
6. **GROCERY-019 Order Placed**:
   - Screen A: `679a7902431c44cd8f2d7ac0d602bbbc` (390x1029)
   - Screen B: `a384ecb17e664692b0cd37265a37b7cf` (390x884)
   - *Resolution:* Retain `679a7902431c44cd8f2d7ac0d602bbbc`.
