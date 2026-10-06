# Customer app closure report

Written to PROMPT 10 §10: one row per Customer-reachable screen, what backs it, what
proves it, and what is still not true. Nothing here is a completion claim for a field
the platform cannot measure.

- **App**: `mobile/` (NABIN Customer, Flutter)
- **Date**: 2026-10-06
- **Doctrine**: a screen is closed when every value it paints comes from a read NABIN
  actually serves, is derived from those rows by arithmetic the screen itself shows, or
  is refused. A default wearing a measurement is the defect this report is written
  against.

## How each row was verified

Every claim in this report is reproducible with these commands, run from the repo root:

| Check | Command | What it measures |
|---|---|---|
| Flutter suite | `cd mobile && flutter test` | 381 tests, all passing |
| Analyzer | `cd mobile && flutter analyze lib test` | 55 issues, all `info`, none in a file this work touched |
| Backend contract chain | `cd backend && node scripts/test_chain.js` | 55 links today, 54 when this report was measured (link 55, `admin_console_xss_test.js`, was added 2026-10-06), per-link check counts, schema drift witness on 10 protected tables |
| Screen → suite map | `grep -rl <screen_file_stem> mobile/test/*.dart` | which suite imports or routes to which screen |
| Request shape | each suite's stub (`mobile/test/support/http_stub.dart`) | the exact `METHOD url` list the screen sent, asserted before any content is asserted |

Two columns carry the evidence: **tests** (how many) and **refusals** (how many
`findsNothing` assertions the suite holds — the count of things that must *not* paint).
A suite with a high refusal count is the one where the screen is closest to its data.

## §1 Per-screen closure table

Customer-reachable routes read out of `mobile/lib/core/router/app_router.dart`. Status
legend: **CLOSED** = backing read identified, fields audited, pinned by a suite that
asserts both the painted values and the refused ones. **CLOSED (earlier slice)** = same,
audited in a prior slice; the suite column is the current evidence. **NOT CLOSED** =
named in §3. CLOSED means the screen's own fields are honest; it does not waive a §3
residual that the screen can reach — `/home` and `/profile` are both CLOSED rows and both
carry §3 item 5, because what they push into belongs to the next app in the queue.

| Route | Screen | Backing read | Suite (tests / refusals) | Status |
|---|---|---|---|---|
| `/splash` | `customer_splash_screen.dart` | none by design — reads `SessionManager` state already in the process | `customer_splash_test.dart` (6 / 8) | CLOSED |
| `/` | `welcome_screen.dart` | none | `app_flow_test.dart` (17 / 3), `widget_test.dart` (1) | CLOSED |
| `/phone-entry` | `phone_entry_screen.dart` | `POST /auth/send-otp` | `onboarding_session_test.dart` (15 / 15) | CLOSED (earlier slice) |
| `/otp-verification` | `otp_verification_screen.dart` | `POST /auth/verify-otp` | `onboarding_session_test.dart`, `app_flow_test.dart` | CLOSED (earlier slice) |
| `/personalization` | `personalization_screen.dart` | reads the session `POST /auth/verify-otp` already stored; writes nothing | `onboarding_session_test.dart` (the group "the personalization step does only what it can", incl. "Get Moving continues and writes nothing") | CLOSED (earlier slice) |
| `/identity-verification-submit` | `identity_verification_submission_screen.dart` | `POST /identity/submit` | `identity_verification_test.dart` (14 / 15) | CLOSED (earlier slice, #128 #146) |
| `/identity-verification-status` | `identity_verification_status_screen.dart` | `GET /identity/status/:userId` | `identity_verification_test.dart` | CLOSED (earlier slice) |
| `/home` | `customer_home_screen.dart` | `GET /features`, `/notifications`, `/customer/activity`, `/restaurants`, `/grocery/products`, `/advertisements?slot=&service=` | `customer_home_discovery_test.dart` (14 / 15), `customer_home_config_test.dart` (9 / 5), `customer_home_notifications_test.dart` (5 / 3) | CLOSED (#108 #109) |
| `/ride-booking` | `ride_booking_screen.dart` | `GET /schools`, `/children`, `POST /pricing/estimate`, `POST /customer/book-ride` | `ride_booking_test.dart` (18 / 12), `school_child_crud_test.dart` (14 / 0) | CLOSED (#32 #141 #145) |
| `/active-ride` | `active_ride_screen.dart` | `GET /tracking/:jobId` | `active_ride_test.dart` (29 / 23) | CLOSED (#34 #138) |
| `/ride-receipt` | `ride_receipt_screen.dart` | `GET /customer/orders/:id` | `ride_receipt_test.dart` (4 / 3) | CLOSED |
| `/parcel-booking` | `parcel_booking_screen.dart` | `POST /pricing/estimate`, `POST /customer/book-parcel` | `parcel_booking_test.dart` (20 / 7) | CLOSED (#141 #143) |
| `/parcel-confirmation` | `parcel_confirmation_screen.dart` | the job row `POST /customer/book-parcel` returned | `parcel_booking_test.dart` | CLOSED |
| `/payment` | `payment_screen.dart` | none of its own — the terminal state comes from a caller-supplied `authorize` callback | `payment_screen_test.dart` (12 / 13) | CLOSED as a screen; **orphan route** — see §3 |
| `/food-home` | `food_home_screen.dart` | `GET /restaurants` | `food_menu_test.dart` (5 / 14), `app_flow_test.dart` | CLOSED (#131) |
| `/food-categories` | `food_category_screen.dart` | `GET /restaurants` | `food_category_test.dart` (7 / 5) | CLOSED (#15) |
| `/restaurant-menu` | `restaurant_menu_screen.dart` | `GET /restaurants`, `/restaurants/:id/menu` | `food_menu_test.dart` | CLOSED (#131) |
| `/dish-detail` | `dish_detail_screen.dart` | the menu rows `/restaurants/:id/menu` returned | `dish_detail_test.dart` (13 / 16) | CLOSED (#16) |
| `/food-checkout` | `food_checkout_screen.dart` | `POST /promotions/apply`, `POST /customer/book-food` | `food_checkout_test.dart` (19 / 15) | CLOSED (#20 #137) |
| `/food-tracking` | `food_order_tracking_screen.dart` | `GET /tracking/:jobId` | `food_order_tracking_test.dart` (15 / 6) | CLOSED (#31) |
| `/grocery-home` | `grocery_app_shell.dart` | `GET /grocery/products`, `/advertisements?slot=GROCERY_HERO_CAROUSEL&service=GROCERY`, `/auth/me` | `grocery_app_shell_test.dart` (11 / 11), `grocery_menu_test.dart` (5 / 3) | CLOSED |
| — Account tab | `grocery_account_screen.dart` | `GET /auth/me` (name, phone, walletBalance) | `grocery_account_test.dart` (10 / 6) | CLOSED (#129) |
| `/grocery-categories` | `grocery_categories_screen.dart` | `GET /grocery/products?category=` | `grocery_menu_test.dart` | CLOSED (#130) |
| `/grocery-products` | `grocery_products_screen.dart` | `GET /grocery/products?category=&search=&merchantId=` | `grocery_products_test.dart` (11 / 19) | CLOSED |
| `/grocery-product-detail` | `grocery_product_detail_screen.dart` | the same single read; no per-product endpoint exists | `grocery_product_detail_test.dart` (9 / 26) | CLOSED |
| `/grocery-deals` | `grocery_deals_screen.dart` | the same single read; drops computed from `mrp` vs `currentPrice` | `grocery_deals_test.dart` (9 / 15) | CLOSED |
| `/grocery-cart` | `grocery_cart_screen.dart` | in-memory basket, prices from the catalogue rows; `POST /grocery/cart/revalidate` on the way to checkout | `grocery_app_shell_test.dart`, `grocery_checkout_test.dart` (18 / 15) | CLOSED |
| `/grocery-checkout` | `grocery_checkout_screen.dart` | `POST /promotions/apply`, `POST /grocery/checkout/validate` (that call *is* the order write) | `grocery_checkout_test.dart` | CLOSED |
| `/wallet` | `wallet_screen.dart` | `GET /auth/me` (`user.walletBalance`) — the platform serves no wallet ledger route | `customer_wallet_test.dart` (11 / 9) | CLOSED (#110) |
| `/activity` | `activity_screen.dart` | `GET /customer/activity` | `app_flow_test.dart` | CLOSED |
| `/profile` | `profile_screen.dart` | `GET /auth/me`, `/customer/activity`, `/notifications/preferences`, `POST /auth/logout` | `customer_profile_test.dart` (17 / 12), `customer_logout_test.dart` (5 / 1) | CLOSED (#111 #117 #118 #119 #140) |
| `/support` | `customer_support_screen.dart` | `GET /support/user/:userId`, `POST /support/ticket` | `test/support/customer_support_screen_test.dart` (5 / 5) | CLOSED |

The five screens with no suite at the start of this session —
`grocery_products_screen.dart`, `grocery_product_detail_screen.dart`,
`grocery_deals_screen.dart`, `grocery_app_shell.dart`, `customer_splash_screen.dart` —
now carry 46 tests and 79 refusal assertions between them.

## §2 Field-truth ledger for the surface audited this session

`REAL BACKEND` = the row/field comes straight out of a served read. `DERIVED` =
arithmetic over those rows, with the derivation stated on screen. `HIDDEN BECAUSE
UNSUPPORTED` = the field is not in any read NABIN serves, so the screen does not render
it at all.

### Grocery (one read: `GET /api/grocery/products`)

| Field on screen | Class | Source |
|---|---|---|
| product name, `emoji`, `currentPrice`, `mrp`, `unit`, `packSize`, `stockQty`, `isAvailable`, `merchantId/Name` | REAL BACKEND | the row |
| aisle list (Categories, home rail) | DERIVED | distinct `category` values in the returned rows, ordered |
| "N items" per aisle | DERIVED | count of rows carrying that category |
| "% OFF", "You save ₹X against MRP" | DERIVED | `mrp - currentPrice`, only where `mrp > currentPrice` |
| Deals ranking, "Up to X% below MRP", the saving total | DERIVED | same subtraction over the same rows; stated as "buying all of them once would save ₹X" |
| `brand`, `previousPrice`, `priceStatus`, `unitPricingType`, `lastPriceUpdate` | REAL BACKEND | optional keys on the row (`grocery_product.dart:28-88`). Rendered only where the row carries them — a row without them loses the line rather than gaining a default. `grocery_product_detail_test.dart` pins both directions: Vanthral Mills' `brand` + `₹175 → ₹160` movement + frozen-price + per-weight lines paint, and none of those four lines exist for a row that omitted them |
| rating, reviews, "4.8", star icons | HIDDEN BECAUSE UNSUPPORTED | no rating read exists anywhere in the platform |
| "Delivery in 10 minutes", any ETA/SLA | HIDDEN BECAUSE UNSUPPORTED | no SLA read; the promise would be a guess |
| veg / non-veg flag | HIDDEN BECAUSE UNSUPPORTED | no such column |
| saved address book on the Account tab | HIDDEN BECAUSE UNSUPPORTED | `/grocery/address` is not served; the tab says so in words |
| wallet top-up, payment methods, grocery order history | HIDDEN BECAUSE UNSUPPORTED | `/grocery/wallet`, `/grocery/payment-method`, `/grocery/orders` are not served; balance is only what `/auth/me` reports |
| coupon codes on checkout | HIDDEN BECAUSE UNSUPPORTED | no grocery coupon read; the checkout prints what the validate call answered |
| sort order | DERIVED, scoped | the backend exposes no sort, so the control re-orders the rows already returned and the screen prints "Sorted by … (these results only)" |

### Splash

`isAuthenticated` is `SessionManager._isAuthenticated && _token != null`
(`mobile/lib/core/network/session_manager.dart:11`). The gate reads that and routes; it
issues no request, so there is no field on it at all. Its frame carries the wordmark and
the four service names — a promise of what the app does, not of speed, rank or rating.

## §3 Blockers and residuals (not hidden to make the table green)

1. **`/payment` is registered and nothing navigates to it.** `app_router.dart:162`
   defines it, but no Customer screen pushes `'/payment'` — a grep for it outside the
   router returns nothing. Each journey settles inside its own order call and prints the
   confirmation from the row the platform returned, so no journey stops for lack of the
   screen; but no customer can reach it either. It is an **orphan, not a dead-end**, and
   `payment_screen_test.dart` keeps it honest for the day something links to it.
2. **Grocery has no separate confirmation route.** Its terminal state is a modal inside
   `/grocery-checkout`, built from the order `POST /grocery/checkout/validate` wrote back
   (`grocery_checkout_screen.dart:248-275`). The journey closes, but it does not survive
   the back-navigation the way `/parcel-confirmation` does — a deliberate shape, recorded
   here rather than counted as a pass.
3. **The identity chain is truthful over an in-memory backend.** `POST /identity/submit`
   accepts and reports what it was given; there is no document-upload route, so the
   screen records a typed number as a declaration, never as a submitted document
   (#146). The screen now says which it is.
4. **No rating source anywhere in the platform.** Every surface that a reference app
   would fill with a score hides it instead. This is a missing capability, not a
   missing pixel.
5. **Two partner-mode simulators are reachable from Customer screens and are pure
   invention.** `customer_home_screen.dart:615` ("Driver Mode") and
   `profile_screen.dart:190` ("Switch to Driver Partner Mode") both `push('/driver-dashboard')`,
   which `app_router.dart:308` resolves to `DriverAppShell`; the same pair exists for
   `/restaurant-dashboard` (`app_router.dart:312`). Neither entry is demo-gated, and the
   shells render fabricated rows — `driver_app_shell.dart:962-968` paints "Rajesh Kumar",
   "+91 98765 43210" and "✓ KYC Approved • ⭐ 4.92 Rating" (a name, a Delhi-format mobile
   and a rating with no source, per item 4), and `restaurant_app_shell.dart:278` paints
   "₹28,450" as revenue. No Customer suite imports either shell, so `flutter test` is
   silent about them. PROMPT 12 §14 fences Driver and Restaurant Merchant code out of this
   slice, so they are reported, not fixed; recorded as #150 for the Driver slice (the
   matching Stitch-side fabrication is #103), and the alternative — removing the entries
   from the Customer app — is a design decision for the owner.
6. **Demo prefills in the Customer app are correctly gated.** `'9876543210'` appears at
   three sites and all three sit behind `NabinBuildEnv.allowsDemoConvenience`, which is
   `!isProduction` (`nabin_build_env.dart:38`): the controller seed at
   `phone_entry_screen.dart:19`, the router's fallback at `app_router.dart:76`, and the
   whole "Demo Numbers" pill behind the `if` at `phone_entry_screen.dart:141` (its literals
   at `:146` and `:153` are inside that gated `Row`). A release build of the Customer app
   therefore opens with nothing filled in.
7. **The Driver KYC form is not gated at all** (#149).
   `driver_kyc_registration_screen.dart:19-22` seeds the name, licence, registration and
   UPI controllers with `'Rajesh Kumar'`, `'DL-14201900192'`, `'DL 1RA 4892'` and
   `'rajesh.driver@okhdfcbank'` — Delhi RTO formats, no gate, and a live-shaped UPI handle.
   It is not reachable from `app_router.dart`; only `driver_router.dart:57` builds it, so
   it is outside the Customer app and inside the Driver slice.
8. **The Admin examiner's document viewer shows one demo applicant's card for every
   application** (#147) — `admin_dashboard.html` hard-points `img.src` at
   `mock_aadhaar_rahul.png` / `mock_voter_rahul.png`. It is a backend-admin surface, not a
   Customer screen; meanwhile the `/docs` route serves a "NO DOCUMENT ON FILE" placeholder
   gated by `identity_documents.view`, pinned by `backend/admin_identity_gates_test.js`
   DOC-01..DOC-09.
9. **Three grocery screens exist in two flavours.** `/grocery-categories`,
   `/grocery-products` and `/grocery-deals` are registered standalone *and* live as
   tabs in `GroceryAppShell`. The add-to-cart toast wording differs between the two
   paths ("Added "X" to Cart!" vs "Added "X" to Grocery Cart!"), and both wordings are
   now pinned so a future unification cannot silently change them.
10. **The deals screen has one unreachable string.** `'The catalogue could not be read'`
   is not the copy that path emits (it prints `'These items could not be loaded'`); the
   test pins the reachable copy and asserts the unreachable one is *absent*.
11. **`flutter analyze lib test` reports 55 `info` issues.** All are
   `prefer_const_constructors` / `deprecated_member_use` in `admin/`,
   `grocery_merchant/`, `admin_feature_controls` and one `unnecessary_const` in
   `nabin_tokens.dart` — none in a Customer screen or suite touched by this work, and
   the count is the same as before it.
12. **Stitch-side Customer closure is a separate record.** This report covers the Flutter
   implementation. The design mirrors, the refused revisions and the exhausted prompt
   budget are tracked in the Stitch reports at the repo root.

## §4 Widget defects found and fixed by this session's suites

The tests render in Ahem, where every glyph is 1em, so a row that is 5% too tight at
393px overflows instead of silently shrinking. Three real `RenderFlex` overflows were
found this way. Each fix was made in the widget, never in the assertion.

| File | Defect | Fix |
|---|---|---|
| `grocery_products_screen.dart:156` | the sort popup's label pushed the row past the menu's own 256px width | label wrapped in `Expanded` with `maxLines: 1` + ellipsis |
| `grocery_account_screen.dart:220` | the wallet card's left block was fixed-width, so `'Not readable'` (wider than a number) overflowed it | label column wrapped in `const Expanded(child: Row(...))` with ellipsis; the amount keeps its own column |
| `grocery_cart_screen.dart:275` | `_billRow` put two bare `Text`s in a `spaceBetween` row; a sentence-valued row (`'Set by the store'`) ran past the card | `Expanded` label + `Flexible` right-aligned value, both ellipsised, with a gutter |

## §5 Verification

| Gate | Result |
|---|---|
| `flutter test` | **381 / 381 passed** |
| `flutter analyze lib test` | **55 issues, all info, all in files untouched by this work** |
| `node scripts/test_chain.js` | **54 / 54 links clean, 0 problems, 2252 explicit passing checks, 2 skipped** |
| Schema drift during the chain | **10 protected tables unchanged** on every link that reported; only `audit_logs`, `orders`, `jobs`, `journal_transactions` grew, which is what the writes under test are supposed to do |
| Harness cleanup | `teardown: pid 50192 reaped, :4000 free` |

These are the closure run's own measurements, kept as measured. The chain has since grown a link
(`admin_console_xss_test.js`, added 2026-10-06 as link 55), so a run today reports 55 links; the
current numbers live in the dated records in `docs/AUTONOMOUS_BUILD_PROGRESS.md`, not here.

The two skipped checks are coverage this run did not get, stated here rather than left in
the log:

- `IDENT-08` (link 25, `driver_earnings_identity_audit_test.js`) — the local store holds
  no `drv_earn_<timestamp>` earnings rows to attribute, so there was nothing for the check
  to prove either way (`driver_earnings_identity_audit_test.js:174`).
- `GAP-TRK-01` (link 54, `place_substitution_test.js`) — a deliberately recorded open gap
  (§14-6), not a regression: a job whose `driver_id` is a legacy seeded id resolves
  against the compiled-in seed fleet, so the tracking read carried a position nothing in
  the run reported. The suite refuses to call it green (a guarantee this repository does
  not have) or red (removing those arrays is the owner's decision), so it is written as
  NOT MEASURED with the observed coordinates in the message.


## §6 What this slice changed, and its commit state

| File | Change |
|---|---|
| `mobile/test/grocery_products_test.dart` | 11 tests: the `?category=&search=&merchantId=` request shape, derived aisle chips and counts, the client-side sort's own scope line, the refused-addition path |
| `mobile/test/grocery_product_detail_test.dart` | 9 tests: resolution from the catalogue read with no per-product request, every listed fact, the four optional lines present *and* absent, delisted vs zero-stock pills, unknown/failed/missing id states, 393 and 834 |
| `mobile/test/grocery_deals_test.dart` | 9 tests: no deal/campaign/coupon path is ever requested, the drop ranking and saving total as arithmetic over the rows, the ghost list (flash sale, countdown, invented coupons) |
| `mobile/test/grocery_app_shell_test.dart` | 11 tests: exactly three reads on mount and zero on tab change, the shell's own toast wording, the account tab's real identity and balance, 16 invented rows absent, filled-basket bill honesty, five tabs at 393 and 834 |
| `mobile/test/customer_splash_test.dart` | 6 tests: routing on the next zero-duration frame (so not a timer), signed-out → welcome with no request, signed-in → home, the painted frame claims nothing, no redirect loop, 393 and 834 |
| `mobile/lib/features/grocery/presentation/screens/grocery_products_screen.dart` | overflow fix §4 |
| `mobile/lib/features/grocery/presentation/screens/grocery_account_screen.dart` | overflow fix §4 |
| `mobile/lib/features/grocery/presentation/screens/grocery_cart_screen.dart` | overflow fix §4 |

Nothing is committed, pushed, deployed or migrated. The working tree carries these five
new suites, three widget fixes and this report on top of the earlier uncommitted slice
work, and it stays that way until the owner says otherwise.

`app_router.dart` registers 33 routes: 31 Customer surfaces plus the Driver and
Restaurant Merchant shells, which belong to the apps that follow in the queue. Every one
of the 31 has at least one suite, as does the grocery Account tab (a screen the shell
mounts, not a route) — 32 of 32. So the Customer app's remaining gaps are journey-level
and backend-capability-level, named in §3, not screen-level ones averaged away.
