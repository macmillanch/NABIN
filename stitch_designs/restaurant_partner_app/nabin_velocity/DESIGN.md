---
name: Nabin Velocity
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e5'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3fe'
  surface-container: '#ededf9'
  surface-container-high: '#e7e7f3'
  surface-container-highest: '#e1e2ed'
  on-surface: '#191b23'
  on-surface-variant: '#434655'
  inverse-surface: '#2e3039'
  inverse-on-surface: '#f0f0fb'
  outline: '#737686'
  outline-variant: '#c3c6d7'
  surface-tint: '#0053db'
  primary: '#004ac6'
  on-primary: '#ffffff'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#b4c5ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#943700'
  on-tertiary: '#ffffff'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#faf8ff'
  on-background: '#191b23'
  surface-variant: '#e1e2ed'
typography:
  order-number:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '500'
    lineHeight: 26px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  order-number-mobile:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '800'
    lineHeight: 44px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-tablet: 24px
  touch-target-min: 48px
---

## Brand & Style
The design system is engineered for high-stakes, fast-paced kitchen and storefront environments. The brand personality is efficient, reliable, and hyper-functional, prioritizing glanceability over decorative flair. 

The aesthetic follows a **Modern Corporate** approach with a utility-first mindset. It utilizes high-contrast interfaces to ensure legibility under harsh kitchen lighting and high-speed interaction. Whitespace is used strategically to separate distinct orders and actions, minimizing cognitive load for staff managing multiple streams of information.

## Colors
The palette is rooted in a functional hierarchy. **Royal Blue** serves as the primary action color, signaling intent and navigation. The background uses a soft Slate-White to reduce eye strain, while pure White is reserved for interactive cards.

Semantic colors are amplified for status communication:
- **Success (Green):** Indicates orders ready for pickup or completed tasks.
- **Warning (Amber):** Indicates active preparation or time-sensitive waiting periods.
- **Error (Red):** Indicates cancellations or critical system alerts.

High-contrast text ensures that order details are readable from a distance of 3-5 feet.

## Typography
This design system utilizes **Inter** for its exceptional legibility and systematic weight distribution. A custom `order-number` level is provided for primary identification in a kitchen queue.

- **Weight Usage:** Use Bold (700/800) for order IDs and status headings. Use Medium (500) for item names within an order to ensure they stand out against modifiers.
- **Hierarchy:** Labels use uppercase with slight letter spacing for category headers (e.g., "MODIFIERS", "CUSTOMER NOTES").

## Layout & Spacing
The layout follows a **Fluid Grid** model optimized for tablets, which are the primary hardware for restaurant partners. 

- **Grid:** A 12-column grid is used for desktop/dashboard views, shifting to a 1- or 2-column card stack on mobile/tablet.
- **Touch Strategy:** All interactive elements maintain a minimum height of `48px` to accommodate gloved or rushed touch inputs.
- **Density:** High vertical density is permitted for order lists, but horizontal spacing (gutters) must remain wide (`16px+`) to prevent accidental taps.

## Elevation & Depth
To maintain a "fast" feel, the design system avoids heavy shadows or complex blurs. It relies on **Tonal Layers** and **Low-contrast Outlines**.

- **Level 0 (Background):** Soft White (#F8FAFC).
- **Level 1 (Cards/Surface):** Pure White (#FFFFFF) with a 1px border in Slate-200 to define edges.
- **Level 2 (Modals/Active States):** A tight, neutral shadow (0px 4px 6px -1px rgba(15, 23, 42, 0.1)) to lift critical actions above the base grid.

Depth is used primarily to indicate that an element is "In Progress" or "Selected."

## Shapes
The design system adopts a **Soft (0.25rem)** roundedness profile. This provides a professional, modern look without appearing too "playful" or consumer-oriented. 

- **Buttons & Inputs:** `0.25rem` (4px) corner radius.
- **Order Cards:** `0.5rem` (8px) corner radius for better structural definition.
- **Status Indicators:** Fully rounded (pill) for status chips only.

## Components
### Buttons
- **Primary:** Solid Royal Blue with White text. Used for "Accept Order" or "Complete."
- **Secondary:** White background with 1px Slate-300 border. Used for "Print Receipt" or "View Details."
- **Destructive:** Solid Red for "Cancel Order" or "Reject."

### Order Cards
The central component of the app. Every card must feature the `order-number` in the top left. The right side is reserved for the `timer/status` chip. The body contains a list of items with checkboxes for "expo" style workflows.

### Status Chips
Pill-shaped badges with high-contrast backgrounds. 
- *Preparing*: Amber background with Dark Navy text.
- *Ready*: Green background with White text.

### Input Fields
Large text inputs with `16px` internal padding. Labels must always be visible (never placeholder-only) to ensure clarity during data entry (e.g., entering estimated prep time).

### Lists & Dividers
Use horizontal 1px dividers in Slate-100 to separate line items within a single order card to prevent item confusion.