# NABIN — MASTER CUSTOMER DESIGN SYSTEM & TOKENS

**Document ID:** NABIN-DESIGN-SYSTEM-001  
**Status:** CANONICAL DESIGN SPECIFICATION  

---

## 1. Color System Architecture

| Role | Token Name | Hex Code | Visual Application |
|---|---|---|---|
| **Master Brand** | `brandPrimary` | `#1A3BA2` | Royal Blue: Header, system bottom bar, primary CTA, account identity |
| **Brand Pressed**| `brandPressed` | `#122973` | Dark Royal Blue: Active button tap feedback |
| **Brand Tint** | `brandTint` | `#EEF2FF` | 8% Soft blue wash for active selection rings and selected address tags |
| **Ride Accent** | `rideAccent` | `#1A3BA2` | Royal Blue: Vehicle tiers, route vectors, ride OTP box |
| **Food Accent** | `foodAccent` | `#E85D24` | Warm Orange: Restaurant banners, food cart CTA, prep indicators |
| **Grocery Accent**| `groceryAccent`| `#16834A` | Fresh Farm Green: Retail discount pills, stock tags, grocery checkout |
| **Parcel Accent**| `parcelAccent` | `#7047B8` | Vibrant Purple: Courier icons, weight badges, tracking milestones |
| **Canvas** | `canvasBackground`| `#F5F7FB` | Soft cool-gray base canvas (low glare, high contrast) |
| **Card Surface** | `surfaceWhite` | `#FFFFFF` | Pure white elevated cards, bottom sheets, search modals |
| **Text Primary** | `textPrimary` | `#172033` | High-contrast slate navy for titles, prices, plate numbers |
| **Text Secondary**| `textSecondary` | `#64748B` | Muted slate for subtitles, distance, prep notes, timestamps |
| **Hairline Border**| `borderSoft` | `#E2E8F0` | 1px clean card and divider stroke |
| **Success** | `statusSuccess` | `#16A34A` | Positive green: Delivered, payment success, Pure Veg badge |
| **Warning** | `statusWarning` | `#D97706` | Amber: Surge price notice, kitchen delay, Egg badge |
| **Error / SOS** | `statusDanger` | `#DC2626` | Crimson: Cancellation, payment failure, SOS emergency button, Non-Veg badge |

---

## 2. Typography Baseline (Inter)
- **Display Hero:** 36px / Bold / Line Height 44px (Onboarding / Welcome Hub)
- **Headline Large:** 28px / Bold / Line Height 36px (Section Headers)
- **Headline Medium:** 20px / SemiBold / Line Height 28px (Card Titles, Modals)
- **Title Medium:** 16px / SemiBold / Line Height 22px (Item Titles, Restaurant Names)
- **Body Large:** 16px / Regular / Line Height 24px (Main Body Text)
- **Body Medium:** 14px / Regular / Line Height 20px (Addresses, Form Inputs)
- **Body Small:** 12px / Regular / Line Height 16px (Metadata, Distance, Timestamps)
- **Label Bold:** 14px / SemiBold / Line Height 20px (Button Labels)
- **Tabular Numerics:** Strict enforcement of tabular figures for all INR (₹) prices, trip OTPs, and countdown ETAs.
