---
name: Nabin Global Service System
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e4'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3fd'
  surface-container: '#ededf8'
  surface-container-high: '#e7e7f2'
  surface-container-highest: '#e1e2ec'
  on-surface: '#191b23'
  on-surface-variant: '#434654'
  inverse-surface: '#2e3038'
  inverse-on-surface: '#f0f0fb'
  outline: '#737685'
  outline-variant: '#c3c6d6'
  surface-tint: '#0c56d0'
  primary: '#003d9b'
  on-primary: '#ffffff'
  primary-container: '#0052cc'
  on-primary-container: '#c4d2ff'
  inverse-primary: '#b2c5ff'
  secondary: '#535f73'
  on-secondary: '#ffffff'
  secondary-container: '#d4e0f8'
  on-secondary-container: '#576377'
  tertiary: '#7b2600'
  on-tertiary: '#ffffff'
  tertiary-container: '#a33500'
  on-tertiary-container: '#ffc6b2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2ff'
  primary-fixed-dim: '#b2c5ff'
  on-primary-fixed: '#001848'
  on-primary-fixed-variant: '#0040a2'
  secondary-fixed: '#d7e3fb'
  secondary-fixed-dim: '#bbc7de'
  on-secondary-fixed: '#101c2d'
  on-secondary-fixed-variant: '#3b475b'
  tertiary-fixed: '#ffdbcf'
  tertiary-fixed-dim: '#ffb59b'
  on-tertiary-fixed: '#380d00'
  on-tertiary-fixed-variant: '#812800'
  background: '#faf8ff'
  on-background: '#191b23'
  surface-variant: '#e1e2ec'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  button-text:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  margin-mobile: 16px
  gutter-mobile: 12px
  touch-target-min: 48px
---

## Brand & Style

The design system is engineered for a high-utility, multi-service ecosystem (Ride-hailing, Logistics, and Food Delivery). The brand personality is **dependable, efficient, and frictionless**. 

The aesthetic follows a **Modern Corporate** style with a heavy emphasis on **Mobile-First Functionalism**. It prioritizes clarity over decoration to ensure users can complete high-intent tasks (like ordering food or booking a ride) with zero cognitive load. The UI uses generous white space, a structured logical grid, and subtle depth to separate actionable service layers from informational background layers.

The visual language evokes a sense of "Logistics Precision"—everything is aligned, legible, and responsive.

## Colors

The palette is anchored by a high-trust **Primary Blue (#0052CC)**, used for primary actions and brand presence. 

- **Primary:** Use for main buttons, active states, and critical path icons.
- **Secondary/Neutral:** A range of cool greys (from #172B4D for text to #F4F5F7 for backgrounds) ensures a clean, non-distracting environment.
- **Semantic Colors:** Green (#36B37E) is reserved exclusively for successful payment or "Driver Arrived" states. Amber (#FFAB00) is used for "Pending" or "Low Balance" alerts.
- **Backgrounds:** The app uses a layered approach. The base screen background is a very light grey (#F4F5F7), while interactive cards and sheets use pure white (#FFFFFF) to pop against the base.

## Typography

The design system utilizes **Inter** for its exceptional legibility on mobile screens and neutral, professional character.

- **Scale:** High contrast between headlines and body text helps users scan services quickly.
- **Weights:** Use Semi-Bold (600) for interactive elements and buttons to ensure they look "tappable." Use Regular (400) for descriptions and addresses.
- **Micro-copy:** Small labels (12px) should be used for secondary metadata, such as "ETA" or "Distance," often paired with a 600 weight for visibility.

## Layout & Spacing

This design system follows a **4px baseline grid** with a focus on mobile ergonomics.

- **Safe Zones:** Always maintain a 16px margin on the left and right of the viewport.
- **Touch Targets:** No interactive element (button, icon, list item) should have a height/width less than 48px to accommodate one-handed thumb use.
- **Vertical Rhythm:** Use 16px (md) spacing between distinct cards and 8px (sm) spacing between elements within a card.
- **Map Context:** When the map is visible, UI elements (Search bars, Service selectors) should be contained in floating sheets or bottom-anchored cards to maintain visibility of the route.

## Elevation & Depth

Hierarchy is established through **Ambient Shadows** and **Tonal Layering**.

- **Level 0 (Base):** The #F4F5F7 background.
- **Level 1 (Cards):** White surfaces with a soft, diffused shadow (Blur: 12px, Y: 4px, Color: rgba(0, 0, 0, 0.05)). This is used for service selection cards and list items.
- **Level 2 (Floating/Modals):** Elements that require immediate attention (Bottom Sheets, Primary Action Buttons) use a more pronounced shadow (Blur: 20px, Y: 8px, Color: rgba(0, 0, 0, 0.12)) to appear physically closer to the user.
- **Outlines:** Use a subtle 1px border (#DFE1E6) for input fields and inactive states instead of shadows to prevent visual clutter.

## Shapes

The shape language is **Rounded**, conveying friendliness and modern tech-forwardness.

- **Standard Elements:** Buttons and input fields use a **12px (rounded-lg)** radius.
- **Service Cards:** Main dashboard cards for "Ride," "Food," and "Parcel" use a **16px (rounded-xl)** radius to stand out as primary entry points.
- **Selection Indicators:** Small badges or count indicators use the **Pill (rounded-full)** shape.

## Components

### Buttons
- **Primary:** Solid #0052CC background with White text. Height: 56px for main mobile actions.
- **Secondary:** Light blue tint background (#DEEBFF) with #0052CC text.
- **Ghost:** Transparent background with Primary Blue text, used for "Cancel" or "View Details."

### Input Fields
- White background with a 1px #DFE1E6 border. 
- Must include a 24px icon slot on the left (e.g., Search icon, Location pin) to provide visual context.
- Focused state: 2px border in Primary Blue.

### Service Cards
- Large, square-ish cards on the home screen. 
- Top-aligned iconography with bottom-aligned bold labels.
- Background: Pure white with Level 1 elevation.

### Bottom Navigation
- Fixed at the bottom of the viewport.
- 4 Slots: Home, Activity, Wallet, Profile.
- Height: 64px + safe area.
- Active state: Primary Blue icon + 4px dot indicator below. Inactive: Secondary Grey.

### Bottom Sheets
- Used for service details (e.g., selecting car types).
- Top edge: 16px rounded corners.
- Handle: 40x4px pill-shaped bar at the top center for "swipe-to-close" affordance.