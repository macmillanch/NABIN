---
name: Nabin Driver System
colors:
  surface: '#11131b'
  surface-dim: '#11131b'
  surface-bright: '#373942'
  surface-container-lowest: '#0c0e16'
  surface-container-low: '#191b23'
  surface-container: '#1d1f27'
  surface-container-high: '#282a32'
  surface-container-highest: '#32343d'
  on-surface: '#e1e2ed'
  on-surface-variant: '#c3c6d7'
  inverse-surface: '#e1e2ed'
  inverse-on-surface: '#2e3039'
  outline: '#8d90a0'
  outline-variant: '#434655'
  surface-tint: '#b4c5ff'
  primary: '#b4c5ff'
  on-primary: '#002a78'
  primary-container: '#2563eb'
  on-primary-container: '#eeefff'
  inverse-primary: '#0053db'
  secondary: '#c3c6ce'
  on-secondary: '#2d3136'
  secondary-container: '#43474d'
  on-secondary-container: '#b2b5bc'
  tertiary: '#ffb596'
  on-tertiary: '#581e00'
  tertiary-container: '#bc4800'
  on-tertiary-container: '#ffede6'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dbe1ff'
  primary-fixed-dim: '#b4c5ff'
  on-primary-fixed: '#00174b'
  on-primary-fixed-variant: '#003ea8'
  secondary-fixed: '#e0e2ea'
  secondary-fixed-dim: '#c3c6ce'
  on-secondary-fixed: '#181c21'
  on-secondary-fixed-variant: '#43474d'
  tertiary-fixed: '#ffdbcd'
  tertiary-fixed-dim: '#ffb596'
  on-tertiary-fixed: '#360f00'
  on-tertiary-fixed-variant: '#7d2d00'
  background: '#11131b'
  on-background: '#e1e2ed'
  surface-variant: '#32343d'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  data-tabular:
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
  touch-target-min: 48px
  margin-mobile: 16px
  margin-desktop: 32px
  gutter: 16px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style
The design system is engineered for professional drivers who require high-performance, mission-critical clarity in low-light environments. The brand personality is **authoritative, precise, and tech-driven**, mirroring the reliability of an industrial-grade cockpit.

The visual style blends **Modern Corporate** efficiency with **Minimalist** restraint. It prioritizes data legibility and rapid task completion through a high-contrast dark aesthetic. The interface uses deep obsidian surfaces to reduce eye strain during long shifts, while Royal Blue accents signal high-priority actions and system states. The result is a premium, "instrument-cluster" feel that evokes confidence and professional focus.

## Colors
The palette is optimized for a **Dark-First** experience, utilizing a layered neutral scale to establish hierarchy without relying on heavy shadows. 

- **Primary (Royal Blue):** Reserved for primary actions, active states, and brand presence.
- **Background Hierarchy:** Use `#0B0F14` for global backgrounds, `#111827` for secondary containers, and `#17202B` for interactive cards.
- **Content:** Text is strictly hierarchical, using `#F8FAFC` for headlines to ensure maximum readability against dark backgrounds.
- **Functional Colors:** Success, Warning, and Error colors must maintain a high saturation to remain distinct against the dark UI surfaces.

## Typography
This design system utilizes **Inter** for its neutral, systematic clarity. The typographic scale is designed for quick scanning while in motion.

- **Tabular Data:** For all financial figures, trip distances, and time-based counters, enable `tnum` (tabular numbers) to ensure columns of figures align perfectly for easier comparison.
- **Scale:** Body text is slightly enlarged (16px-18px) to accommodate the vibration and movement inherent in a driver's environment.
- **Contrast:** Headlines should always use the primary text color (#F8FAFC) to pop against dark surfaces.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a strictly enforced 4px baseline. 

- **Touch Targets:** A minimum 48x48px hit area is required for all interactive elements to ensure ease of use while driving or wearing gloves.
- **Mobile Layout:** 4-column grid with 16px margins. 
- **Desktop/Tablet Layout:** 12-column grid with 32px margins.
- **Rhythm:** Vertical spacing between cards and sections should primarily use the `stack-md` (16px) or `stack-lg` (24px) units to maintain an airy, premium feel despite the data-dense nature of the tool.

## Elevation & Depth
Depth in this design system is communicated through **Tonal Layering** rather than traditional drop shadows. As elements "rise" toward the user, their surface color becomes lighter.

1. **Level 0 (Base):** `#0B0F14` (Global background).
2. **Level 1 (Cards/Containers):** `#111827`.
3. **Level 2 (Modals/Overlays):** `#17202B`.
4. **Level 3 (Active/Pop-overs):** `#1E293B`.

To further define edges in the high-contrast dark mode, use a **1px Inner Stroke** with 10% opacity white on all cards and buttons. This creates a "glass-edge" effect that feels precise and premium.

## Shapes
The shape language is **Restrained and Professional**. Elements use a 8px (`rounded-md`) to 16px (`rounded-xl`) corner radius.

- **Buttons & Cards:** Standardize on 12px corners for a balance between modern friendliness and professional rigidity.
- **Status Pills:** Use a fully rounded (pill) shape to distinguish them from interactive buttons.
- **Inputs:** Maintain the 8px corner radius to ensure they feel structured and reliable.

## Components
- **Buttons:** Primary buttons use Royal Blue (#2563EB) with white text. Height must be 48px or 56px. Secondary buttons use a Subtle Grey (#1E293B) background with Primary Text.
- **Input Fields:** Use a solid dark background (#111827) with a 1px border (#1E293B). On focus, the border transitions to Royal Blue.
- **Cards:** The primary vehicle for information. Use `#17202B` background with 12px rounded corners and 16px internal padding.
- **Chips/Status:** Use low-opacity background fills of the status color (e.g., 15% Success Green) with high-saturation text of the same color for high legibility without visual noise.
- **Lists:** Use 1px dividers in `#1E293B` to separate list items. Each list item must have a minimum height of 64px to accommodate large touch targets.
- **Trip Meter:** A specialized component using `data-tabular` typography and high-contrast labels to show real-time earnings and distance.