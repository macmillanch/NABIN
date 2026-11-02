# NABIN Customer App — Auth Journey Walk Evidence

Walk performed: 2026-11-02 (Home re-capture completed 2026-11-03).
App under test: the Flutter **customer** app (`mobile/`) compiled to web and served statically.
This document is the index for `qa_screenshots/customer_walk_*.png`. It records what was
actually seen in a running app, not what the source is expected to do.

## 1. How this run was produced

Build (from `mobile/`):

```
flutter build web -t lib/main.dart \
  --dart-define=NABIN_ENV=development \
  --dart-define=NABIN_API_URL=http://localhost:4000/api \
  --dart-define=NABIN_WS_URL=ws://localhost:4000
```

Serve: a static server on `127.0.0.1:8080` (that origin is in the backend CORS allowlist).
Backend: `http://localhost:4000`.

Viewport: 404 x 569.6 CSS px, `devicePixelRatio` 1.25. Every PNG in this set is 505 x 711
device px.

The build is a non-production build, so `NabinBuildEnv.allowsDemoConvenience` is true. That is
what pre-fills the phone number and surfaces the backend `testOtp`. A production build would not.

## 2. Route order actually walked

`/` (Welcome) → `/phone-entry` → `/otp-verification` → `/personalization` →
`/identity-verification-submit` → `/home`

The last step was reached through the on-screen skip, not through a completed verification.
See finding F-1.

## 3. Screenshot index

| File | Route | What it proves |
|---|---|---|
| `customer_walk_01_welcome.png` | `/` | Welcome carousel slide 1/3, "Fast, Reliable Rides", Get Started. |
| `customer_walk_02_phone_entry.png` | `/phone-entry` | Phone field pre-filled with `9876543210` by the demo-convenience gate. |
| `customer_walk_03_otp.png` | `/otp-verification` | Four OTP boxes already filled on arrival. See finding F-2. |
| `customer_walk_04_personalization.png` | `/personalization` | Preferences step after a successful OTP verify. |
| `customer_walk_05_identity_submit.png` | `/identity-verification-submit` | KYC step, top of screen. States verification is mandatory. |
| `customer_walk_05b_identity_skip_demo.png` | `/identity-verification-submit` | Same screen scrolled: the only exit is "Skip directly to Super-App (Demo)". |
| `customer_walk_06_home_top.png` | `/home` | Greeting, `NABIN PAY ₹450.00`, "What do you need today?", Ride/Food/Grocery/Parcel tiles, location reads "Choose your pl…". |
| `customer_walk_07_home_service_band.png` | `/home` | Selected-service band, service search, "Saved pl… • None on thi…", Support & Help, "Recommended restaurants" rail heading. |
| `customer_walk_08_home_activity.png` | `/home` | Recent activity: three Food orders (₹220.00, ₹220.00, ₹60.00, 14/10/2026 19:51) and the "Partner with NABIN" disclosure. |
| `customer_walk_09_grocery_home_degraded.png` | grocery home | "Aisle names could not be loaded." then "These items could not be loaded — the grocery catalogue could not be served because this backend's database schema is not fully applied." |
| `customer_walk_10_food_home_degraded.png` | `/food-home` | "Restaurants unavailable" with the same schema message and a Try again action. |

All 11 PNGs are byte-distinct (11 files, 11 unique SHA-256 digests).

## 4. Reads confirmed real, not invented

- **₹450.00 wallet** — `customer_home_screen.dart:81` reads `user['walletBalance']` with no
  literal fallback.
- **"Good Morning, Rahul"** — `customer_home_screen.dart:293` derives the first name from
  `SessionManager.instance.currentUser?['name']`, falling back to `User`. The name is the signed-in
  session's own record.
- **Three Recent-activity orders** — rendered from the order read, not from a static list.
- **Location shows "Choose your pl…"** and **Saved places show "None on thi…"** — the UI reports
  the absence instead of substituting a Delhi default.
- **Food and Grocery failures** — the on-screen text is the backend's own message verbatim. A
  read-only `GET` during the walk returned:

  ```
  GET /api/restaurants      -> 500 {"code":"SCHEMA_NOT_READY", ...}
  GET /api/grocery/products -> 500 {"code":"SCHEMA_NOT_READY", ...}
  ```

  Across the whole browser session this was 11 error responses: 5 for `/api/restaurants`, 6 for
  `/api/grocery/products`. Every call to both endpoints failed; none succeeded.

## 5. Findings open for an owner decision

These are not claimed as defects fixed. Each is a contradiction between what the app says and what
the app does, and each needs a product ruling before code changes.

**F-1 — Identity verification is called mandatory, then skipped.**
`identity_verification_submission_screen.dart:386` offers "Skip directly to Super-App (Demo)" as the
only exit from a screen whose own copy says verification is mandatory. Either the gate is optional
or the skip should not exist. Note also that the walk's Home screen was reached through that skip.

**F-2 — The OTP is pre-filled client-side, not from the server.**
`otp_verification_screen.dart:24-32` writes a hardcoded `'7729'` into the four boxes when the phone
contains `9876543210`. It does not use the `testOtp` the backend returns. The demo convenience is
therefore not proving that the server's OTP path works.

**F-3 — Unbacked claims in marketing copy.**
`welcome_screen.dart:41` asserts "live GPS telemetry, and zero surge pricing", and
`phone_entry_screen.dart:182` asserts "Secured with 256-bit encryption & instant OTP
verification" — both are visible in this walk (screenshots 01 and 02). Nothing measured here
supports either claim.

**F-4 — Food and Grocery discovery cannot render at all in this environment.**
Both module homes are permanently degraded because the schema is not fully applied on the target
this backend points at. The UI is honest about it, so this is an environment/migration question,
not a display bug.

## 6. Method note

Flutter web renders to a CanvasKit canvas — there is no clickable DOM, so accessibility snapshots
return nothing useful. Every interaction in this walk was a synthetic `MouseEvent`
(`mousemove` → `mousedown` → 80–90 ms → `mouseup` → `click`) dispatched on the canvas inside
`flutter-view flt-glass-pane`'s shadow root. Scrolling is a `WheelEvent` with `composed: true`;
positive `deltaY` scrolls down. Screenshots are the only visual evidence and were read back
individually before being named, so each filename states what the pixels actually show.
