---
name: Nabin Mobility Intelligence
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#434654'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#747685'
  outline-variant: '#c4c5d6'
  surface-tint: '#2854cc'
  primary: '#214fc7'
  on-primary: '#ffffff'
  primary-container: '#4169e1'
  on-primary-container: '#f8f7ff'
  inverse-primary: '#b6c4ff'
  secondary: '#505f76'
  on-secondary: '#ffffff'
  secondary-container: '#d0e1fb'
  on-secondary-container: '#54647a'
  tertiary: '#005f89'
  on-tertiary: '#ffffff'
  tertiary-container: '#0079ad'
  on-tertiary-container: '#f3f8ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b6c4ff'
  on-primary-fixed: '#00164e'
  on-primary-fixed-variant: '#003baf'
  secondary-fixed: '#d3e4fe'
  secondary-fixed-dim: '#b7c8e1'
  on-secondary-fixed: '#0b1c30'
  on-secondary-fixed-variant: '#38485d'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Geist
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
    letterSpacing: 0.05em
  mono-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  container-max: 1440px
  gutter: 1.5rem
  margin-desktop: 2rem
  margin-mobile: 1rem
  stack-xs: 0.25rem
  stack-sm: 0.5rem
  stack-md: 1rem
  stack-lg: 2rem
---

## Brand & Style

The design system is engineered for high-stakes logistics and mobility administration. The brand personality is **authoritative, precise, and systematic**, designed to instill confidence in dispatchers and fleet managers handling real-time data.

The visual style follows a **Modern Corporate** aesthetic with a heavy emphasis on **Functional Minimalism**. It prioritizes high information density through disciplined whitespace and a structured hierarchy. The interface uses a "Layered Surface" model—where the background is distinct from the content containers—to reduce cognitive load during long work sessions. Every element is optimized for speed of recognition, ensuring that critical mobility alerts are never missed.

## Colors

This design system utilizes a high-clarity palette centered around **Royal Blue (#4169E1)** to signify action and authority. 

- **Surface Tiers**: Use `#F8FAFC` for the global application background and pure `#FFFFFF` for content cards and data tables to create a "lifted" effect.
- **Typography**: The primary text uses a deep Slate (#1E293B) for maximum contrast. Secondary metadata uses Slate-500 (#64748B).
- **Functional Accents**: Status colors follow industry standards but are slightly desaturated to maintain the professional tone. Borders use a subtle Slate-200 (#E2E8F0) to define structure without adding visual noise.

## Typography

The typographic strategy balances modern character with utilitarian precision. 

- **Hanken Grotesk** is used for headings to provide a sharp, contemporary professional feel.
- **Inter** serves as the workhorse for all body copy and data entry, chosen for its exceptional legibility in dense tables.
- **Geist** is employed for labels, badges, and technical IDs (like Order UUIDs or Vehicle VINs) to provide a distinctive technical "developer-lite" aesthetic that fits an admin dashboard.

**Mobile Scaling**: For viewports below 768px, `display-lg` should scale down to 28px/36px LH, and `headline-md` to 20px/28px LH.

## Layout & Spacing

The design system uses a **Fixed-Fluid Hybrid Grid**. The main content area lives within a 1440px max-width container, centered on the screen, while the navigation sidebar remains fixed to the left.

- **Desktop Layout**: 12-column grid with 24px (1.5rem) gutters. The sidebar occupies 280px or collapses to an 80px icon-only rail.
- **Data Density**: Use a tight 4px baseline grid for internal component spacing (padding/margins) to allow for high data density without losing readability.
- **Breakpoints**: 
  - Desktop: 1280px+
  - Tablet: 768px to 1279px (Sidebar becomes an overlay)
  - Mobile: Under 767px (Cards stack vertically, horizontal scrolling for data tables)

## Elevation & Depth

Hierarchy is established through **Tonal Layering** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background)**: `#F8FAFC` — Used for the canvas.
- **Level 1 (Cards/Surface)**: `#FFFFFF` — All primary content modules. These use a 1px solid border of `#E2E8F0`. No shadow.
- **Level 2 (Modals/Dropdowns)**: `#FFFFFF` — These use a soft, large-radius ambient shadow (`0px 10px 25px -5px rgba(0, 0, 0, 0.05)`) to indicate temporary interaction and focus.
- **State Indicators**: Active navigation items or selected table rows use a subtle blue tint (`#EFF6FF`) to indicate focus without requiring a heavy border.

## Shapes

The design system uses a consistent **8px (0.5rem)** radius for all primary UI components, including cards, buttons, and input fields. This "Rounded" setting provides a professional, approachable feel without appearing overly casual.

- **Small elements**: Checkboxes and radio buttons use a 4px radius.
- **Large elements**: Modals and slide-overs use `rounded-xl` (1.5rem) on top corners only to suggest a "sheet" metaphor.
- **Badges**: Status badges use a pill-shape (full rounding) to differentiate them from interactive buttons.

## Components

### Buttons & Inputs
- **Primary Button**: Solid `#4169E1` with white text. 8px radius.
- **Secondary Button**: White fill, `#E2E8F0` border, `#1E293B` text.
- **Input Fields**: 1px `#E2E8F0` border, 12px horizontal padding. On focus, the border transitions to `#4169E1` with a 2px outer glow in the same color at 10% opacity.

### Data Tables
- **Header**: Light gray background (`#F1F5F9`), `label-md` typography, uppercase.
- **Rows**: 56px minimum height. Border-bottom only (`#F1F5F9`).
- **Interactive States**: Row highlight on hover using `#F8FAFC`.

### Status Badges
- Used for delivery/mobility status.
- **Format**: Light background tint (10% opacity of the status color) with high-contrast text of the same hue.
- **Example**: "In Transit" uses `#EFF6FF` background and `#3B82F6` text.

### Maps & Charts
- **Maps**: Use a "Silver" or "Light" map style to prevent the UI from becoming too dark/heavy. Overlays should use the same `#FFFFFF` card style with 8px radius.
- **Charts**: Use a primary color stroke for line charts. Use a categorical palette: Royal Blue, Sky Blue, Slate, and Teal.