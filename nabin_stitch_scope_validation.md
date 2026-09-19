# NABIN Stitch Scope Validation

**Document Version**: 1.0.0  
**Date**: 2026-09-19  
**Status**: VALIDATED

---

## Canonical Scope

**234 requirements** across **7 approved Stitch projects**.

| Project | Stitch ID | Type | Screens |
|---------|-----------|------|---------|
| Customer App | 8177350010716545885 | Flutter | 48 |
| Driver App | 8351986305462646918 | Flutter | 38 |
| Restaurant Merchant App | 6214000417822217011 | Flutter | 32 |
| Grocery Merchant App | 14026068595233675473 | Flutter | 30 |
| Admin App | 10226544365361646201 | Flutter | 28 |
| Customer Web | 9754323984525516826 | Next.js | 29 |
| Admin Web | 17357153901300306716 | Next.js | 29 |
| **TOTAL** | | | **234** |

---

## Verification Status

| Check | Result |
|-------|--------|
| Requirements count | ✅ 234 / 234 |
| Verified | ✅ 234 |
| Missing | ✅ 0 |
| Failed | ✅ 0 |
| Duplicate IDs | ✅ 0 |

---

## Out of Scope (Confirmed)

The following were explicitly determined to be **OUT OF SCOPE** and must NOT be created:

### Applications (11)
1. ❌ Fleet Management Portal
2. ❌ Merchant Web Portal
3. ❌ Customer Support Helpdesk product
4. ❌ Family App
5. ❌ Family Circle
6. ❌ Family Vault
7. ❌ Dark Store App
8. ❌ Warehouse App
9. ❌ Picker App
10. ❌ Separate Driver Ride App
11. ❌ Separate Driver Delivery App

### Screens (110)
The old 344-screen target included 110 screens for the above applications. These are **permanently excluded**.

---

## Vehicle Model Validation

### Three Vehicle Categories (NABIN Standard)

| Category | Display Name | Use Case |
|----------|-------------|----------|
| 2-WHEELER | Bike | Motorcycle/scooter rides |
| 3-WHEELER | Auto | Auto-rickshaw rides |
| 4-WHEELER | Taxi / Car | Car/taxi rides |

### Service Modes (Separate from Vehicle Categories)

- Normal Ride
- Shared Ride
- Rental

**Rule**: Shared Ride and Rental are NOT vehicle categories. They are service modes that can apply to any vehicle category.

### Driver App Architecture

**ONE Driver App** serving ALL vehicle categories. Do NOT create separate driver applications.

---

## Grocery Model Validation

### Current Architecture (Approved)

```
Independent Grocery Merchant
    → Merchant picks
    → Merchant packs
    → Ready/Handover
    → NABIN Driver
    → Customer
```

### Explicitly Excluded (Do NOT Introduce)

- ❌ Dark store
- ❌ Centralized warehouse
- ❌ Warehouse picker
- ❌ Centralized fulfillment center

---

## Branding Validation

| Element | Specification |
|---------|---------------|
| Wordmark Font | Neuron Regular (NABIN logo only) |
| UI Typography | Inter |
| Primary Color | Royal Blue |
| Rule | Neuron ONLY for NABIN wordmark/logo. Never for entire UI. |

**Note**: The uploaded Neuron Regular TTF must be added to actual Flutter/Web projects during implementation. Stitch cannot verify exact font rendering.

---

## Stitch Project IDs (Canonical - DO NOT CREATE NEW)

1. `8177350010716545885` — Customer App
2. `8351986305462646918` — Driver App
3. `6214000417822217011` — Restaurant Merchant App
4. `14026068595233675473` — Grocery Merchant App
5. `10226544365361646201` — Admin App
6. `9754323984525516826` — Customer Web
7. `17357153901300306716` — Admin Web

---

## Validation Checklist

- [x] 234 requirements match canonical count
- [x] 7 approved projects only
- [x] 0 out-of-scope projects included
- [x] Vehicle model: 3 categories, service modes separate
- [x] Grocery model: Independent merchant, no dark store
- [x] Branding: Neuron for logo, Inter for UI
- [x] One Driver App for all vehicle types
- [x] Duplicate requirement IDs: 0

---

## Sign-off

**Scope Validated**: ✅ PASS  
**Ready for Implementation**: ✅ YES  
**Design Freeze Authorized**: ✅ YES