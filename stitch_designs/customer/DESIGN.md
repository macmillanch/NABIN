# NABIN Super-App — Customer Design System (Flutter; Kamalanagar, Aizawl, Mizoram, India)

## Brand & Style — NABIN blue is the identity, white/neutral is the canvas (40 / 30 / 20 / 10)

The NABIN primary brand color is **#1A3BA2** — a confident, deep royal blue. It is the brand's signature and must read as NABIN at a glance, but it is used **strategically, not as a full-bleed wash**. (Owner decision 2026-10-03: #1A3BA2 replaces both the old #1A1265 and the briefly-trialled #4D5BBD. The earlier "70% indigo-dominant, indigo-filled cards" rule is REVERSED — do not make the whole app blue.)

This is a **redesign brief, not a recolor brief.** For every screen: inspect the current Stitch design and the Flutter implementation, find the visual weaknesses, and improve hierarchy, spacing, typography, component consistency, navigation, cards/surfaces, buttons/controls, and the empty/loading/error/confirmation states — then apply the #1A3BA2 system. Do not preserve a poor layout just because it already exists.

Visual balance per screen (a hierarchy, NOT literal pixel coverage):

- **~40% NABIN BRAND #1A3BA2** — the app bar / header band, primary navigation active state, primary CTAs, hero/promo blocks, section accents, selected chips, brand icons, key highlights. Enough that the brand is unmistakable, never so much that the screen is a blue rectangle.
- **~30% WHITE / NEUTRAL / SURFACE** — the page background is a soft neutral, and content cards / sheets / inputs / lists are white. This is where the product is *read*: text, products, fares, order lines live on light surfaces.
- **~20% SERVICE ACCENT** — Ride #2D5BDB, Food #E8590C, Grocery #12A150, Parcel #E5A800. Service identity, active states, icons, badges, progress, status chips. Subordinate to the master brand: a Grocery screen is NOT a green app — it is a white/neutral app with brand-blue structure and 20% grocery-green accents.
- **~10% SEMANTIC / SECONDARY** — success / warning / danger / info, only where meaning requires them.

Avoid: excessive blue, huge solid color blocks everywhere, repetitive identical cards, outdated heavy gradients, unnecessary borders, inconsistent corner radii, inconsistent spacing, oversized buttons, cluttered screens.

Feel: premium, modern, clean, confident, energetic, trustworthy, spacious, polished.

## Colors

```
brand: #1A3BA2              # master signature blue — headers, CTAs, active nav, hero, brand marks
brand-hover: #2A4DB8        # lighter interaction layer
brand-bright: #3E5CC4       # focus / accent tint on light
brand-pressed: #142E80      # pressed / darkest blue
brand-tint: #E9EEF9         # soft blue section fills, selected-light background
brand-container: #D6DEF5    # selected container / filled chip (ink #142E80)
on-brand: #FFFFFF           # text/icons on #1A3BA2 (white on #1A3BA2 ≈ 8.0:1, AA-safe)

surface-white: #FFFFFF      # content cards, sheets, inputs, lists (the 30%)
canvas: #F5F7FB             # page background — soft cool neutral, NOT white-to-the-eye, NOT blue
text-main: #0F172A          # primary ink on light surfaces
text-secondary: #556072     # captions, labels on light
border: #E2E8F0             # hairlines on light surfaces

accent-ride: #2D5BDB        # keep unchanged
accent-food: #E8590C        # keep unchanged
accent-grocery: #12A150     # keep unchanged
accent-parcel: #E5A800      # keep unchanged

success: #16A34A | warning: #F59E0B | danger: #DC2626 | info: #0284C7
```

Status must never rely on color alone — always icon + text. Currency INR (₹), phone +91, realistic Aizawl/Mizoram data; never Bangladesh/BDT; never lorem.

### Design token roles (LIGHT mode — use these values verbatim, do not re-derive)

```yaml
colors:
  primary: "#1A3BA2"
  on-primary: "#FFFFFF"
  primary-container: "#D6DEF5"
  on-primary-container: "#142E80"
  secondary: "#2A4DB8"
  on-secondary: "#FFFFFF"
  secondary-container: "#E9EEF9"
  on-secondary-container: "#142E80"
  tertiary: "#3E5CC4"
  on-tertiary: "#FFFFFF"
  background: "#F5F7FB"       # soft neutral page canvas — NOT blue, NOT near-black
  on-background: "#0F172A"
  surface: "#FFFFFF"          # white cards, inputs, sheets, lists (the 30%)
  on-surface: "#0F172A"
  surface-variant: "#E9EEF9"
  on-surface-variant: "#47506A"
  outline: "#556072"
  outline-variant: "#C7CEDB"
  error: "#DC2626"
  on-error: "#FFFFFF"
  error-container: "#FEECEC"
  on-error-container: "#7F1D1D"
```

The page canvas is a light cool neutral (#F5F7FB), and content is white. #1A3BA2 appears as structure and emphasis (app bar band, active nav, primary buttons, hero/promo, section headers), not as the background of the whole screen. Never render the page background as solid #1A3BA2; never render dense content cards as solid blue — put text and product data on white.

## Layout & Spacing

8pt base grid, 4pt micro increments; horizontal margins/gutters 16px; vertical rhythm 8/16/24/32. Card radius 16, sheet top 20, chips full, controls 12. Consistent radii and spacing across every screen — no one-off magic numbers. Buttons height 52 (large), 44 (compact); touch targets ≥ 44. Generous negative space; a screen is allowed to breathe.

## Typography

Inter everywhere (headline/body/label). Body ≥ 15, titles bold (w700–w900), nothing below 12. Strong scale contrast between section titles, card titles and metadata so hierarchy is instant. Tabular figures for money, ETA and distance.

## Navigation

Bottom nav (5 destinations): Home · Activity · Services · Notifications · Profile — white bar, inactive items muted slate, the active item shown in #1A3BA2 (icon + label + a small indicator). Predictable back, preserved state. Sub-flows (Food, Grocery, Ride, Parcel) get their own in-flow top app bar carrying the brand band, with a clear back and consistent title placement.

## Component notes (shared language across Customer)

- App bars / headers: brand band (#1A3BA2) with white title for primary destinations; content-area headers on white with dark ink. One header pattern, not many.
- Primary button (CTA): solid #1A3BA2, white label, h52, radius 12, full-width in sheets. Secondary button: white fill, #1A3BA2 label + border. Text button: #1A3BA2. Never make every button heavy — reserve solid brand fill for the single main action per view.
- Cards: white surface, radius 16, one soft shadow, no unnecessary border; internal padding 16. Vary card treatments by role (service tile vs list row vs product card) rather than repeating one identical card.
- Service tiles: white card carrying the service color (#2D5BDB / #E8590C / #12A150 / #E5A800) as the icon badge / accent, not the whole tile.
- Chips / filters: light #E9EEF9 pill with dark ink; selected chip uses brand-container (#D6DEF5, ink #142E80).
- Tabs / segmented: underline or pill in #1A3BA2 for the active tab.
- Inputs: white fill, #C7CEDB border, focus border #1A3BA2, dark text; label above, helper/error text below. Bottom sheets and dialogs are white.
- Status badges: icon + text on a light tint (semantic or service), never color-only.
- Empty / loading / error / confirmation states: designed on-brand illustrations/copy on a light surface — skeleton loaders in #E9EEF9 shimmer, empty states with a clear action, error states with retry, confirmation states that only claim what the backend truly returns.

## Customer Home — a true super-app home (not four buttons)

A polished vertical hierarchy: NABIN header (wordmark + notification + profile) · delivery location/address · search · active trip/order banner (when real) · four service shortcuts (Ride / Food / Grocery / Parcel) · offers & promotions (only with real promo data) · nearby / recommended restaurants · recommended grocery stores · recent activity · account/footer. The four service buttons are one row, not the entire experience.

## Food & Grocery — full customer experiences

Food: Home (location, search, cuisine/category shortcuts, offers, featured/nearby/popular restaurants, recommendation rails, restaurant cards, filters) → Restaurant detail (hero, identity, open/closed where supported, cuisine, delivery info where supported, menu categories, featured dishes) → Menu (categories, item cards, images, pricing, availability, add/quantity controls) → Item detail (image, title, description, price, options/add-ons where supported, quantity, add to cart) → Cart → Checkout → Address → Order confirmation → Preparing → Delivery → Delivered → Receipt → Rating/Reorder — each only where the backend actually supports it.

Grocery: Home (location, search, categories, featured categories, deals, promo banners, recommended/popular/recently-purchased products, reorder, store discovery where supported) → Store home (identity, status, delivery info, categories, search, featured, deals) → Category (grid/list, filter, sort, availability, pricing) → Product detail (image, name, price, unit, availability, quantity, substitution, add to cart) → Cart → Address → Delivery slot → Substitution → Checkout → Order confirmation → Picking → Packing → Delivery → Delivered → Receipt → Reorder — again, present only real states.

## Responsive system (required - not optional)

This is a **mobile app**. Responsive means **phone + tablet only**. There is no desktop layout, no desktop chrome and no content designed for widths above 1024px. Do not enlarge a phone layout to fill a tablet; recompose it.

```
breakpoints (implementation guidance, adapt fluidly):
  xs   compact phone     320-360     single column, compact cards, horizontal chip rails
  m    standard phone    375-430     single column, 2-col grids where the data supports it
  l    large phone       431-600     wider sheets and cards, roomier rails, still single column
  t    tablet portrait   601-768     two-column where useful, larger map, wider fare/vehicle cards
  tw   tablet landscape  769-1024    the widest state: two-column, efficient horizontal space
```

Nothing above 1024px is designed. Make only these ranges addressable in the markup, and emit them literally in the Tailwind config instead of relying on framework defaults. Tailwind's stock `sm/md/lg/xl` are 640/768/1024/1280, which leave 320-360, 375-430 and 431-600 as one undifferentiated base and put 1281+ on the same footing as the tablet range - four of the five ranges collapse. Put this in `tailwind.config`:

```js
theme: {
  extend: {
    screens: {
      xs:   "375px",   // 375-430   standard phone
      sm:   "431px",   // 431-600   large phone
      md:   "601px",   // 601-768   tablet portrait
      lg:   "769px",   // 769-1024  tablet landscape
    },
  },
}
```

Do not add breakpoint keys above `lg`, and do not use `xl` / `2xl` / `3xl` utilities in any screen - a class that targets a desktop width is a defect here. An unprefixed class is the 320-360 baseline; every step up is an explicit override. Use the mobile-first direction only (never `max-*`), and make sure each range named above changes something real on the screen - a column count, a container cap, card width, or sheet width.

Rules:
- Content is capped at the tablet width and centred; never stretch a component toward a desktop viewport. Body text measure caps near 70ch.
- Grids are column-count driven, not fixed-px cards. Catalog grids go 1 -> 2 on phone, 2 -> 3 on tablet. No 4, 5 or 6 column grids.
- Navigation stays a touch-friendly bottom tab bar on phone. On tablet it may become a wider, max-width-centred bottom bar; it must not become a desktop sidebar or an expanded desktop rail.
- Detail views stack on phone; on tablet they may become side-by-side (media + information/purchase panel) within the capped width.
- Checkout and multi-step forms stack on phone with a sticky summary; on tablet the form and summary may sit alongside each other, still inside the capped width.
- Map surfaces are the same map at both sizes: a bottom-sheet composition on phone, a larger map with the panel beside or below it on tablet.
- Sheets/dialogs are full-width with a grab handle on phone; centered, width-capped dialogs on tablet.
- Type scales with viewport within limits - no desktop-sized headline on a 320px screen. Prices, names and captions wrap or truncate gracefully at every width.
- No fixed heights that clip. Nothing may overflow, distort, or become unreadable at any width in 320-1024.
- Same product at every width: identical features, terminology, statuses and data - different composition.

## Backend capability boundary (verified 2026-10-03 against backend/src/server.js)

Generated screens must not assert a capability the customer API does not have. Verified endpoint surface:

```
REAL (customer-scoped):
  GET  /api/auth/me                 -> role, user, token, expiresAt
  POST /api/auth/send-otp, verify-otp, logout, refresh-token
  GET  /api/customer/orders         -> { success, count, orders }
  GET  /api/customer/activity       -> { success, count, items[] }
       item: id, service(RIDE|PARCEL|FOOD|INSTAMART), title, status,
              amount, currency INR, placedAt, active, itemCount
  POST /api/customer/profile/photo  -> the ONLY writable profile field
  POST /api/customer/book-ride      -> pickup, drop, vehicleType, bookingType,
                                       promoCode, passengerInfo, Idempotency-Key
  POST /api/customer/book-parcel, book-food
  GET/PUT /api/notifications, /:id/read, /read-all
  GET/PUT /api/notifications/preferences -> 12 toggles: rides, driver_updates,
       parcel, food, grocery, payments, promotions, support, system,
       push, in_app, sms, email
  POST/DELETE /api/notifications/device-token
  POST /api/support/ticket, GET /api/support/user/:userId,
  POST /api/support/ticket/:id/message         (three endpoints, no more)
  POST /api/identity/submit, GET /api/identity/status/:userId
  POST /api/payments/create-order, verify-checkout
  GET  /api/payments/session/:orderId
  POST /api/geofence/evaluate, /api/geofence/reverse-geocode (lat,lng only)
  POST /api/promotions/apply, redeem
  POST /api/grocery/cart/revalidate, /api/grocery/checkout/validate

NOT SUPPORTED - no route exists, so never show it as working:
  saved-address CRUD / address book persistence
  wallet balance, top-up, wallet transactions (only an ADMIN refund route exists)
  profile name/phone/email update, payment-method save, ratings or reviews
  parcel live tracking, ride progress not driven by events
```

Coupons are a supported customer feature, not a gap. `POST /api/promotions/apply` previews a codeagainst an amount and service, `POST /api/promotions/redeem` consumes it, and `book-ride`,
`book-parcel` and `book-food` all accept a `promoCode` and reject a bad one with
`INVALID_PROMO_CODE`. So a checkout may show: a coupon input, an apply action, an applied-discount
line, and an invalid-code state. What does NOT exist is a customer-facing promotion catalogue -
so no "Deals For You" carousel of invented offers, and no coupon codes invented on screen.

**Exactly one coupon code is seeded, and it is `NABINFIRST50`.** `FESTIVAL30` was cited as real in
earlier briefs and appears on eight ride screens; it exists in no route, no seed and no migration.
Do not print it. The seeded offer (`backend/src/database.js:623`) is 50% off, capped at ₹100, needs
an order of at least ₹80, applies to `RIDE` only, and is new-customer only — and
`PromotionRepository.js:459-464` enforces the service and the minimum. So an applied-discount state
is only truthful on a ride of ₹80 or more, and never on a Food, Grocery or Parcel order, where the
real answer is "Coupon code is only valid for RIDE orders." A ₹65.00 ride must show the rejection
("Minimum order amount of ₹80 required for this coupon."), not a discount. Show the arithmetic:
a ₹181.00 Taxi fare (rate card `4W`: base 70 + 4.0 km × 18 + 12 min × 2, plus a ₹15 booking fee) takes
−₹90.50 and totals ₹90.50.

Real error semantics worth designing against: 401 invalid-or-expired session token,
403 FEATURE_DISABLED, 423 servicePaused (carries broadcastNotice + resumeAt),
429 with retryAfterMs, 503 store-unreachable (code CUSTOMER_ACCOUNT_STATE_UNREADABLE),
and errors echo a requestId. **An unreachable store is not an empty list** - the empty
state and the unavailable state must look different and say different things.

Where a screen is named in the product but has no endpoint (Saved Addresses, Addresses,
Wallet), design it as an honest unavailable/unsupported surface: explain plainly that it
cannot be saved or read yet, offer the path that does work, and never invent rows,
balances, cards or counts to fill it.

## Token use - no raw palette classes

Style surfaces with the design-system tokens only (`bg-primary`, `text-on-surface`,
`bg-error-container`, `border-outline-variant`, and the service accents). Do not reach for raw
Tailwind palette classes - `bg-amber-100`, `text-emerald-700`, `border-slate-200` - because they
bypass the brand system, drift from it, and cannot be re-themed. A warning, success or info tone
that has no token yet gets the nearest semantic token, not an arbitrary hue. If a tone genuinely
has no token, that is a design-system gap to raise, not a licence to use `amber-300`.

## Copy register - what a customer may read

The backend contract in the section above is input for the designer, not content for the screen.
Nothing on a customer surface may read like an API document.

Never render in visible copy: an endpoint path (`POST /api/customer/book-ride`), an HTTP status
code (`403`, `423`, `400`), a response field name (`payload`, `resumeAt`, `jobId`, `servicePaused`),
a feature-flag key (`FEATURE_RIDE_TAXI`), an error code (`INVALID_PROMO_CODE`, `FEATURE_DISABLED`),
an event type (`DRIVER_ASSIGNED`), or a state-machine diagram. Also never print a panel that lists
what the app cannot do - "Operational gaps", "No fabrications", "Not implemented", "Coming soon".
That is a spec sheet, not a screen.

Say the same thing the way the product would: "Taxi rides aren't open in your area yet", "Ride
service is paused here until 14:30", "That code didn't work - check it and try again", "You can't
rate a ride yet - tell us what happened through Support". A refusal state is a designed state with
a plain sentence, its reason in human terms, and the action that does exist.

Every honest-gap instruction is subject to this rule too: the guard tells the designer what to say,
it does not become a paragraph on the screen.

## Functionality rule (presentation only)

Never fill a capability gap with marketing copy. When a surface has no endpoint behind it, a model will invent reassurance to occupy the space, and that is the most damaging kind of fabrication because it reads as a commitment. Do not assert a certification, a compliance or regulatory status, an encryption or security guarantee, a settlement rail, a bank partner, a refund window, a fee amount, or an uptime claim that no response actually carries. "RBI Compliant", "bank-grade encryption", "100% direct bank refunds within 2-48 hrs" and "₹0 fee" are all examples of invented claims and none of them are supported here. An honest gap statement is short, says what cannot be done yet, and offers the path that does work.

The same impulse produces a second, quieter class of fabrication: **assurance about our own process**, which reads as a service-level promise. All of the following are invented and banned on every surface:

- **Assurance words applied to a place, route, fare, vehicle, trip or process** — "Route Verified", "Fare confirmed", "Live Route Verification", "Suggested & Verified Points", "Traffic Clear". The rider chose the spot; saying NABIN checked it is a claim nothing returns. The one exception is the account's own identity state, which the account endpoint really does return: "Identity verified".
- **Measured promises** — any accuracy or precision figure ("accurate to ~15 metres"), any travel-time, arrival-time, countdown or relative ETA ("Est. 60–75 min", "Resumes in ~45 mins", "Fastest"). A pause banner shows its absolute resume time and nothing else. Distances measured from two pinned coordinates are fine; durations are not.
- **A payment surface where there is none** — no payment method, no "Cash / UPI on arrival", no "scan the driver's QR code", no paid/refunded/wallet state on a ride screen. A fare is displayed as a price; no screen in that flow collects money.
- **A coupon catalogue** — a code field accepts what the rider typed. Never list the codes that exist, never "Active codes", "Available offers", "View Offers", and never show a discount amount before an apply has returned one. The only seeded code is `NABINFIRST50` (50% off, capped ₹100, ₹80 minimum, RIDE only, new customers) — `FESTIVAL30` does not exist and must never be printed.
- **A curated place list or a count of it** — no "verified motorable points", no "7 spots nearby", no per-place distance badges on a list the rider did not search for. Suggestions come from what the rider typed, or from the address of the pin they dropped.
- **A history or saved-place affordance** — no "Recent Drops" or "Saved addresses" tab; there is no address book. The value chosen earlier in the same booking may be echoed as a chip labelled "From this booking".
- **Policy and authority copy** — no cancellation policy, no "per local district transport standards", no "under regional transport guidelines", no statement about what the driver's app does behind the scene.

UI redesign does NOT authorize backend changes. Never invent payment success, refunds, customer-cancellation success, rating submission, parcel live-tracking, financial values, or delivery events. Ride is WebSocket/event-driven — do not substitute visual-only fake progress for real events; Parcel is booking-oriented — do not claim live tracking. Redesign only the presentation of functionality that exists.
