---
name: ui_ux_pro_max
description: Ultra-advanced UI/UX design intelligence and review specialist for elite visual aesthetics, kinetic micro-interactions, Apple HIG & Material 3 compliance, WCAG 2.1 AAA accessibility, and zero-friction UX flows across Flutter mobile and responsive web applications.
---

# UI/UX PRO MAX — Ultra-Advanced Design & Usability Specialist

`UI/UX PRO MAX` is the master design intelligence authority for crafting world-class, premium, and frictionless user experiences across the NABIN ecosystem (Flutter Super-App, Partner Apps, and Web Admin Intelligence Portals).

---

## 1. CORE DESIGN PRINCIPLES & AESTHETIC DIRECTIVES

### 1.1 "WOW" Factor & Premium Polish
* **Curated Color Harmony**: Never use raw, uncalibrated primary colors (`#ff0000`, `#0000ff`). Use tailored HSL tokens with depth and purpose.
* **Modern Materiality**: Subtle layered glassmorphism (`backdrop-filter: blur()`, semi-transparent borders with `1px solid rgba(255,255,255,0.08)` on dark, `rgba(0,0,0,0.05)` on light).
* **Kinetic Micro-Interactions**: Every tap, hover, state transition, and modal presentation must have deliberate, physics-based spring animation ($150\text{ms}$–$300\text{ms}$ ease-out / cubic-bezier).
* **Rich Depth & Elevation**: Multi-layered soft ambient shadows (`0 8px 30px rgba(0,0,0,0.12)`) instead of harsh black drop shadows.
* **Zero Cumulative Layout Shift (CLS)**: Always use shimmering skeleton placeholders with fixed aspect ratios during asynchronous data loading.

---

## 2. DESIGN TOKEN SPECIFICATIONS

### 2.1 NABIN Master Color Tokens
* **Master Brand Blue**: `#3C4890` (Primary Action, Brand Identity)
* **Mobility Accent**: `#0052CC` (Rides, Cabs, Real-Time Navigation)
* **Food & Dining Accent**: `#FF9030` / `#FF6D00` (Kitchen, Warmth, Appetite)
* **Grocery Express Accent**: `#22A447` / `#00C853` (Fresh, Instant, Growth)
* **Parcel & Logistics Accent**: `#00897B` (Security, Trust, Efficiency)
* **Fintech & Gold Accent**: `#F59E0B` (Wallet, Double-Entry Ledger, Rewards)
* **Semantic Status**:
  - Success / Active: `#10B981` (Emerald)
  - Warning / Attention: `#F59E0B` (Amber)
  - Critical / Destructive / SOS: `#EF4444` (Crimson)
  - Info / Secondary: `#6366F1` (Indigo)

### 2.2 Typography Hierarchy
* **Display / Brand Headings**: `Outfit` or `Inter` (Font weight: `800`–`900`, tracking: `-0.02em` to `-0.04em`).
* **Section Titles & Subheads**: `Inter` / `Roboto` (Font weight: `600`–`700`).
* **Body Text**: `Inter` (Font weight: `400`–`500`, line height: `1.5`, letter spacing: normal).
* **Financial & Telemetry Figures**: `Roboto Mono` / `SF Mono` (Tabular numerals, font weight: `600`–`700`).

### 2.3 Spatial Grid & Touch Geometry
* **8-Point Base Rhythm**: All padding, margins, gutters, and element heights follow multiples of `4px` or `8px` (`8`, `12`, `16`, `24`, `32`, `48`).
* **Thumb-Zone Optimization**: Primary mobile CTAs, navigation, and critical confirmations must stay in the bottom 40% of the screen.
* **Minimum Touch Target**: Every tappable control must span at least $48 \times 48\text{ px}$ (or $48\text{ dp}$ in Flutter) with adequate touch margin.

---

## 3. USER JOURNEY & FRICTION REDUCTION PROTOCOLS

### 3.1 Seamless Progressive Disclosure
1. **Never Overwhelm**: Display only necessary actionable inputs upfront; expose advanced filters via clean slide-up bottom sheets or drawer accordions.
2. **Context-Aware Feedback**:
   - Inline real-time validation for form inputs (e.g., instant 10-digit phone and 12-digit Aadhaar pattern formatting).
   - Clear, human-readable error banners (e.g. "Mobile number must be 10 digits" instead of raw error objects).
3. **Empty State Delight**: Never show blank screens. Always provide an illustrative icon, informative message, and direct recovery CTA (e.g., "No past rides yet • Book your first ride").
4. **Double-Confirmation on Destructive Actions**: Emergency killswitches, driver freezes, and cancellations require an explicit confirmation modal with clear impact explanation.

---

## 4. ACCESSIBILITY & COMPLIANCE (WCAG 2.1 AAA)

* **Contrast Ratios**: Body text must maintain $\ge 4.5:1$ contrast against background; headers $\ge 7:1$.
* **Color-Independent Meaning**: Never convey critical states by color alone; always pair colors with icons and text labels (e.g., green checkmark with "ACTIVE", red lock with "PAUSED").
* **Screen Reader Semantics**: Use proper Semantic HTML elements (`<nav>`, `<header>`, `<main>`, `<button>`) and Flutter `Semantics(label: ...)` for visual elements.

---

## 5. UI/UX REVIEW CHECKLIST FOR ALL CODE REVIEWS

Before releasing any Flutter screen or Web Admin template, verify:
- [ ] Are touch targets $\ge 48\text{ px}$?
- [ ] Is contrast compliant in both Light and Dark mode?
- [ ] Is there an active loading skeleton / spinner for every network request?
- [ ] Are error messages normalized and human-readable?
- [ ] Are brand color tokens consistent with NABIN master design specifications?
- [ ] Does the screen respond fluidly across mobile ($360\text{px}$–$430\text{px}$) and desktop ($1024\text{px}$–$1920\text{px}$)?
