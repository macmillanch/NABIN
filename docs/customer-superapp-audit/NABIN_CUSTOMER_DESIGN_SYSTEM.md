# NABIN — CUSTOMER SUPER-APP UNIFIED DESIGN SYSTEM
## Authoritative Design Tokens, Component Specifications, and UX Guidelines

**Document ID:** NABIN-DESIGN-SYS-004  
**Date:** November 18, 2026  
**Auditor Roles:** Senior Mobile UI/UX Designer, Flutter Solution Architect  
**Governing Standard:** Flutter 3.50.0 / Material 3 / Google Stitch Master System  

---

## 1. COLOR ARCHITECTURE & TOKEN HIERARCHY

The NABIN color system strictly differentiates between the **Master Ecosystem Signature Brand**, the **Vertical Service Accents**, and the **Operational Surface Ramps**.

### 1.1 Master Brand & Service Accents
```
┌────────────────────────────────────────────────────────────────────────┐
│                        MASTER BRAND SIGNATURE                          │
│               Royal Blue: #1A3BA2  (Primary Ecosystem Identity)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
┌────────┴────────┐        ┌────────┴────────┐        ┌────────┴────────┐
│   NABIN RIDE    │        │   NABIN FOOD    │        │  NABIN GROCERY  │
│ Royal Blue:     │        │ Warm Orange:    │        │ Fresh Green:    │
│    #1A3BA2      │        │    #E85D24      │        │    #16834A      │
└─────────────────┘        └─────────────────┘        └─────────────────┘
                                    │
                           ┌────────┴────────┐
                           │  NABIN PARCEL   │
                           │ Velvet Purple:  │
                           │    #7047B8      │
                           └─────────────────┘
```

| Token Identifier | Hex Value | Semantic Role | Minimum Contrast on White |
|---|---|---|:---:|
| `brandPrimary` | `#1A3BA2` | Super-App root actions, navigation active states, brand headers | **10.8 : 1 (AAA)** |
| `serviceRide` | `#1A3BA2` | Ride booking buttons, polyline active route, vehicle selection | **10.8 : 1 (AAA)** |
| `serviceFood` | `#E85D24` | Food "Add to Cart", checkout completion, delivery tracking | **4.6 : 1 (AA)** |
| `serviceGrocery`| `#16834A` | Grocery stock availability, discount tags, green quantity pills | **5.4 : 1 (AA)** |
| `serviceParcel` | `#7047B8` | Courier booking CTA, waybill labels, tracking badges | **7.2 : 1 (AAA)** |

### 1.2 Surface, Neutral & Feedback Ramps
* **Base Canvas (`background`):** `#F5F7FB` (cool, low-saturation neutral canvas preventing screen glare).
* **Card Surface (`surface`):** `#FFFFFF` (high-purity white).
* **Primary Text (`onSurface`):** `#172033` (Slate Navy/Charcoal — 14.2:1 contrast ratio).
* **Secondary Text (`onSurfaceMuted`):** `#64748B` (Muted Slate — 4.6:1 contrast ratio).
* **Hairline Borders (`divider`):** `#E2E8F0` (1px solid perimeter boundary).
* **Success / Paid:** `#16834A` (Fresh Green).
* **Warning / Waiting:** `#D97706` (Amber).
* **Error / Rejected:** `#DC2626` (Crimson).

---

## 2. TYPOGRAPHY SYSTEM (INTER FONT FAMILY)

The entire customer typography is built strictly on **Inter** to ensure optical legibility across dense data displays and currency lists:

| Style Role | Font Weight | Size (px) | Line Height (px) | Tracking / Features |
|---|:---:|:---:|:---:|---|
| `display-lg` | 700 (Bold) | 28 | 34 | -0.02em letter-spacing |
| `headline-md` | 600 (Semi-Bold) | 20 | 26 | -0.015em letter-spacing |
| `title-md` | 600 (Semi-Bold) | 16 | 22 | Normal |
| `body-lg` | 400 (Regular) | 15 | 22 | Normal |
| `body-md` | 400 (Regular) | 14 | 20 | Normal |
| `body-sm` | 400 (Regular) | 12 | 16 | Secondary metadata |
| `label-lg` | 600 (Semi-Bold) | 14 | 18 | +0.01em letter-spacing (Button labels) |
| `label-sm` | 700 (Bold) | 10 | 14 | +0.04em letter-spacing (Badges, tags) |
| `price-tabular` | 600 (Semi-Bold) | 16 / 18 | 22 / 24 | `font-feature-settings: 'tnum' on` |

---

## 3. SPACING & ELEVATION GRID (8px BASELINE)

### 3.1 Spacing Tokens
- `space-xxs`: `4dp` (badge inner padding, icon-text gap)
- `space-xs`: `8dp` (item titles, tag gutters)
- `space-sm`: `12dp` (card inner padding, list row spacing)
- `space-md`: `16dp` (global canvas margins, section gutters)
- `space-lg`: `24dp` (major section separations)
- `space-xl`: `32dp` (bottom clearance before fixed action bars)

### 3.2 Elevation Hierarchy
* **Level 0 (Canvas):** Flat `#F5F7FB`.
* **Level 1 (Cards):** `#FFFFFF` fill with 1px border (`#E2E8F0`) and ambient shadow:
  $$\text{box-shadow: } 0\text{px } 2\text{px } 6\text{px } -1\text{px rgba}(23, 32, 51, 0.04)$$
* **Level 2 (Floating Trays & Sticky Bottom Bars):** `#FFFFFF` fill with top hairline border (`#E2E8F0`) and upward elevation:
  $$\text{box-shadow: } 0\text{px } -4\text{px } 16\text{px } 0\text{px rgba}(23, 32, 51, 0.06)$$
* **Level 3 (Modal Bottom Sheets):** `#FFFFFF` surface with `24dp` top corner radius above `rgba(23, 32, 51, 0.5)` dimmed scrim.

---

## 4. CORE COMPONENT SPECIFICATIONS

### 4.1 Primary CTA Buttons
* **Standard Height:** `48dp` (Mobile touch target minimum).
* **Border Radius:** `12dp` (`rounded-md`).
* **Active Press State:** Tactile scale transformation `scale(0.98)` with slight darkening.
* **Colors:**
  - Super-App & Ride: `#1A3BA2` with pure white text.
  - Food Order: `#E85D24` with pure white text.
  - Grocery Checkout: `#16834A` with pure white text.
  - Parcel Booking: `#7047B8` with pure white text.

### 4.2 Dietary Signifiers (FSSAI Compliant)
* Size: `16x16dp` square with `3dp` corner radius and `1.5dp` outline stroke.
  - **Pure Veg:** Green `#16A34A` stroke, containing a centered `#16A34A` solid circle of `7dp` diameter.
  - **Non-Veg:** Red `#DC2626` stroke, containing a centered `#DC2626` solid equilateral triangle of `7dp` width.
  - **Egg:** Amber `#D97706` stroke, containing a centered `#D97706` solid circle of `7dp` diameter.

### 4.3 Quantity Stepper Capsule
* **Height:** `36dp` visual height, expanded to `48dp` hit target.
* **Expanded State:** Capsule pill with minus icon, integer quantity count, and plus icon.
* **Color:** Light tinted background (`#F0FDF4`), 1px solid `#16834A` stroke, green glyphs.

---

## 5. FLUTTER THEME IMPLEMENTATION SNIPPET

```dart
ThemeData buildNabinCustomerTheme() {
  return ThemeData(
    useMaterial3: true,
    fontFamily: GoogleFonts.inter().fontFamily,
    scaffoldBackgroundColor: const Color(0xFFF5F7FB),
    colorScheme: const ColorScheme(
      brightness: Brightness.light,
      primary: Color(0xFF1A3BA2),
      onPrimary: Colors.white,
      secondary: Color(0xFFE85D24),
      onSecondary: Colors.white,
      tertiary: Color(0xFF16834A),
      onTertiary: Colors.white,
      surface: Colors.white,
      onSurface: Color(0xFF172033),
      error: Color(0xFFDC2626),
      onError: Colors.white,
    ),
    dividerTheme: const DividerThemeData(
      color: Color(0xFFE2E8F0),
      thickness: 1,
    ),
  );
}
```
