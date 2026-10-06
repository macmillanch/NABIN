# NABIN Customer — Redesign Log (#1A3BA2, white-dominant)

Owner brief 2026-10-03. Brand is now **#1A3BA2** used strategically (~40% brand / ~30% white-neutral surfaces / ~20% service / ~10% semantic) — see `DESIGN.md`. This is a **redesign**, not a recolor. The prior #4D5BBD full-indigo Stitch screens are a superseded baseline to redesign FROM, not to preserve.

Status legend: `pending` (not started) · `stitch` (Stitch redesigned) · `flutter` (Flutter matched) · `verified` (render-checked, journey-coherent, states covered).

Stitch canonical ids from `scratch/canonical_screens.json` (all currently #4D5BBD — every one must be re-aimed to #1A3BA2 white-dominant as part of its redesign).

## Identity chain
Stitch ids below marked `*` are fresh #1A3BA2 white-dominant references (`scratch/canonical_screens.json` → `redesigned_1A3BA2`); unmarked short ids are still the superseded #4D5BBD references pending re-mint.

| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Splash | eac2f627* | /splash | features/home/.../customer_splash_screen.dart | Routing gate; already NabinPalette-driven (brand tile on canvas), no colour change needed. Fresh #1A3BA2 Stitch reference minted. | flutter |
| Onboarding / Welcome | aabebf31* | / | features/auth/.../welcome_screen.dart | Rewritten white-dominant: per-slide white card on canvas, service-accent icon badge (Ride/Food/Parcel, no foreign gradients), brand 'Get Started' CTA, brand page dots. Note: Flutter is a 3-slide value-prop onboarding; the Stitch concept is a single hero card (illustration + 4 service chips). Both on-brand — not pixel-cloned (the illustration asset and social-login chips are not real features, so not fabricated). | flutter |
| Login / Phone entry | 30b15730* | /phone-entry | features/auth/.../phone_entry_screen.dart | Already token-driven (AppTheme #1A3BA2); Mizoram demo number. Fresh #1A3BA2 Stitch reference minted. | flutter |
| OTP Verification | 2f268377* | /otp-verification | features/auth/.../otp_verification_screen.dart | Already token-driven; 4-box OTP on brand accent. Fresh #1A3BA2 Stitch reference minted. | flutter |
| OTP Error states | 84ad6c2f | /otp-verification | features/auth/.../otp_verification_screen.dart | — | pending |
| Personalization | (onboarding) | — | features/auth/.../personalization_screen.dart | Language list corrected to Mizoram-appropriate (English/Mizo/Hindi/Bengali, dropped Telugu); token-driven surface. | verified |
| Identity / KYC submit | c27b4a4a | — | features/auth/.../identity_verification_submission_screen.dart | Tokenized legacy Material hexes → NabinPalette: warning-tint notice banner, success-tint uploaded-doc cards, brand primary CTA via theme, canvas app bar; Aizawl/Mizoram + MZO voter data. | verified |
| Identity status | c27b4a4a | — | features/auth/.../identity_verification_status_screen.dart | Tokenized: one semantic accent drives the status badge (VERIFIED→success, REJECTED→danger, pending/resubmit→warning) as a tinted circle on white, brand CTAs via theme, flexible summary rows (no overflow at 390dp). | verified |
| Location permission | 36510e3e | — | (auth/geo) | — | pending |

## Home (super-app)
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Home dashboard | c50fb3df | /home | features/home/.../customer_home_screen.dart | Redesigned super-app home: brand-blue header band (wordmark/location/wallet in on-brand ink), white search, four compact white service tiles (accent icon badge, no full-colour hero), slim support strip. Data: continuation banner renders only for a job `GET /customer/activity` marks active; recommended-restaurants rail reads `GET /restaurants`, the grocery rail collapses `GET /grocery/products` rows to distinct `merchantName` stores, and recent activity lists that endpoint's own three newest rows — a rating or ETA no endpoint returned paints no icon and no figure (2026-10-05, `mobile/test/customer_home_discovery_test.dart`). Removed legacy orange hardcodes (SafeRide amber ramp, restaurant/notification hexes) and Delhi placeholder data → Aizawl/Mizoram INR. | verified |
| Loading skeleton | 07c100e5 | — | (shared) | — | pending |

## Ride
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Choose a Ride | aa38c03a | /ride-booking | features/ride/.../ride_booking_screen.dart | Tokenized to the #1A3BA2 system (service chips/selected pills/CTA→brand, drop→error, pickup→success, tints via `.withValues`); vehicle tiles → white cards; Aizawl/Mizoram pickup + preset-locations and Aizawl pickup coords. Event flow untouched. No fresh #1A3BA2 Stitch ref minted yet. | flutter |
| Map picker | 13ad2807 | /ride-booking | features/ride/.../ride_booking_screen.dart | Shares the ride-booking screen above; the map itself is the shared `core/widgets/driver_map_view.dart` (Delhi-centred, used by Driver too → left untouched to respect Customer-only scope). | flutter |
| Searching | e5707df2 | /active-ride | features/ride/.../active_ride_screen.dart | Kept WebSocket/event-driven (no fake progress). | pending |
| Driver arriving / On-trip / Completed | 8bc275de | /active-ride | features/ride/.../active_ride_screen.dart | Tokenized all legacy Material hexes → AppTheme (SOS/cancel→error, refund/OTP→success, serviceParcel teal, warning tints via `.withValues`, gradients→solid); MZ (Mizoram) driver plates + Aizawl default pickup/drop; fixed 3 real 390dp RenderFlex overflows (fare-summary rows, cancel-sheet fee card + "Select reason" row, policy-modal header → scrollable). WS/event logic NOT touched. Analyze clean, 390dp fit-verified. | verified |
| No drivers | 211ee847 | /active-ride | features/ride/.../active_ride_screen.dart | — | pending |
| Ride receipt | 8b551c58 | /ride-receipt | features/ride/.../ride_receipt_screen.dart | Already fully theme-driven — zero raw `Color(...)`/`Colors.*` calls; no color changes needed. No fresh #1A3BA2 Stitch ref minted. | flutter |
| Rate driver | b6664ab9 | /ride-receipt | features/ride/.../ride_receipt_screen.dart | Only if rating submit is real — no fabricated rating. | pending |

## Parcel
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Parcel send / fare estimate | 266c9ec1 / a6f11358 | /parcel-booking | features/parcel/.../parcel_booking_screen.dart | Tokenized: Parcel service-teal retained as the selection/CTA accent (→AppTheme.serviceParcel); Dual-OTP banner green-gradient → white success-tint card; pins → success/error; Aizawl sender/recipient (UI + payload); CTA label wrapped in FittedBox (no overflow). Booking-only, no live tracking. Analyze clean, 390dp fit-verified. | verified |
| Driver assigned / confirmation | e3f4b715 | /parcel-confirmation | features/parcel/.../parcel_confirmation_screen.dart | Already fully theme-driven — zero raw color calls; no changes needed. Booking confirmation surface, no invented tracking events. | flutter |

## Payment
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Processing payment | 0c60e031 | /payment | features/payment/.../payment_screen.dart | Already fully theme-driven — zero raw color calls; no color changes needed. Truth pass (2026-10-05, `mobile/test/payment_screen_test.dart`): the method list named instruments no route can return — "Card · Visa •••• 4291 / Expires 09/27", "UPI · Google Pay / nabin.user@okhdfcbank", "NABIN Wallet / Balance ₹1,250" — so each row now states only the payment *kind* the checkout constraint allows (`payment_method IN CASH/WALLET/RAZORPAY/EXTERNAL_GATEWAY`, `supabase/migrations/013_checkout_domain.sql`) and no number, expiry, VPA or balance. The **refund stage is deleted, not softened**: the only refund route is the admin-scoped `POST /api/admin/finance/refund`, so a customer screen can neither initiate one nor quote `NAB-RF · …` or a "3–5 working days" SLA for it, and no caller ever set that stage. "Download receipt" removed (handler was `() {}`, no route serves a receipt file). Failed copy no longer testifies "₹ was not charged" — whether the bank put a hold is knowable only to the gateway. Pending copy no longer promises "we will update you automatically" — nothing polls the session back to this screen. Terminal state still comes only from the caller-supplied `authorize`; with no gateway wired it holds on pending rather than fabricating success. Second truth pass (2026-10-06, same test file, **12/12 green**) closed the three claims that pass had named but not fixed: the **`NABIN Wallet` tile is deleted**, not relabelled — `checkouts.payment_method` does *permit* the string `WALLET` and the grocery checkout stamps it on any non-CASH call (`server.js:6989`) without moving a rupee, so the DB could record a payment no code performed, while no customer route can debit a balance (the only writer of one is an admin refund). The success copy stopped testifying settlement: `₹160 paid via {method}` is now `{amount} confirmed for {service}`, and for cash on delivery "the delivery person will collect {amount} in cash" — a receipt for money that arrives later, if at all, was a receipt for nothing. The receipt sheet's literal `('Status','Completed')` is `Order confirmed`, `('Amount paid', …)` is `Amount`, and the reference row names its own source ("Reference (from this order)" vs "Reference (returned by the order call)"), because an unlabelled fallback to the caller's own `referenceId` read like a gateway id. One behavioural fix came with it: cash on delivery now goes through `authorize` when the caller wired one — the Pay button used to jump straight to success, which displayed an order as taken that was never sent. Chrome still on the shared payment theme; the **unwired `/payment` route** (no checkout navigates here, and no app call reaches `create-order`/`verify-checkout`) is a journey gap, not a data fabrication, and stays open. | verified |

## Food
Customer "Menu" = the **dish browsing catalog** (see memory `nabin-customer-browsing-hierarchy`): category → subcategory → dish list → detail must be distinct screens, not one generic page. Merchant menu-management is a separate workflow, out of scope here.
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Food home (= restaurant list) | 7f1ed502 | /food-home | features/food/.../food_home_screen.dart | Restructured to a delivery-app discovery shape (owner reference 2026-10-05, structure only): the cuisine pills became a **circular cuisine wheel** ("Eat what makes you happy" + "Browse all ›" → `/food-categories`), and the compact letter-tile row became a **photo-band card** — band with the OPEN/CLOSED and ETA chips on its corners, then name, cuisine line, address line, "View Menu & prices →". Chrome is #1A3BA2 white-dominant (`RestaurantTheme.headerBand` = brand; service orange stays on the FOOD badge and row-level controls only). Two claims the endpoint cannot back were removed: the app bar's "Delivering to Home" (no saved-address book exists — see #118; the address is typed at checkout) and the ★rating chip. **Closed (#132, 2026-10-05) — the card is now backed by real columns, not fixtures.** Migration `034_restaurant_discovery_metadata.sql` adds `merchants.cuisines TEXT[]`, `cover_image_url TEXT`, `standard_delivery_minutes SMALLINT` (CHECK-bounded, additive only) and drops the `rating DEFAULT 4.80` so an un-rated row can no longer look measured; `projectRestaurantForCustomer` emits `cuisines` / `coverImageUrl` / `deliveryMinutes` and **never** `rating`, and the merchant write path (`PATCH /api/merchant/:id/profile` + `restaurantProfileDomain.js`) accepts those three while refusing `rating`. The wheel derives from the cuisines the returned rows actually declare, a card with no declared window paints no chip (`foodEtaLabel(null) → null`), and the band layers `coverImageUrl` over the deterministic letter plate with `errorBuilder` → plate, so both image states are drawn and neither invents a picture. The headline reads "All restaurants" because the query orders by `name ASC` with no location filter — no "near you", no bookmark (no favourites route), no "Promoted", no price, no offer chip. `test/food_menu_test.dart` (5 tests) pins the wheel to the derived cuisines, proves the filter goes out as `?cuisine=`/`?search=`, asserts no star icon and no 4.8/4.1/3.6 paint anywhere, counts exactly the `… min` chips the fixtures declare, and checks the tile's `imageUrl` per restaurant plus the menu screen's `• Delivery in 35 min`; render-checked at 393 and 834 logical px, loading skeleton and loaded states; at ≥700 px available the cards go two-up (`_RestaurantGrid`) instead of stretching one band across a tablet. | verified |
| Cuisine / food category | (to mint) | /food-categories | features/food/.../food_category_screen.dart | NEW distinct category-selection screen (5 levels deep no longer collapsed into one page). White cards on canvas, cuisine name + restaurant count **derived** from the live feed (nothing invented); tap sets `foodHomeFiltersProvider` cuisine and returns to `/food-home`. Loading skeleton / error+retry / empty all covered. Analyze clean, 390dp render-verified incl. loading + error + empty states. | verified |
| Subcategory | n/a — not built | — | — | **Honest omission.** No food subcategory level exists in the data: a dish's only grouping is `FoodMenuItem.category`, which is a section *inside one restaurant's menu* and is already rendered as section headers by `restaurant_menu_screen.dart`, and the restaurant-level grouping is cuisine. Fabricating a second taxonomy would invent values. | pending |
| Dish list (restaurant menu) | (to mint) | /restaurant-menu | features/food/.../restaurant_menu_screen.dart | Dish rows now navigate: each row wrapped in a `GestureDetector` → `/dish-detail?restaurantId=…&dishId=…` (ids URI-component-encoded); inner ADD/stepper keep their own hit regions. In-menu search, veg/non-veg pills, section grouping, sticky cart bar and checkout payload unchanged. Truth pass (#132, 2026-10-05): the `[4.1★]` pill the reference put in the hero is **gone** — `merchants.rating` has no reviews table behind it, so the hero's real cuisine line carries that band; the hero picture is `FoodLetterTile(…, imageUrl: restaurant.coverImageUrl)` (layered plate, never a fabricated URL); the window is `• Delivery in ${foodEtaLabel(deliveryMinutes)}` from the projected integer, and an undeclared window renders nothing. The screen no longer accepts a `deliveryTime` string or a `rating` double — `deliveryMinutes: int?` only, resolved `restaurant.deliveryMinutes ?? routeMinutes` with `_firstPresent` deleted. | verified |
| Dish detail | f5472544 | /dish-detail | features/food/.../dish_detail_screen.dart | NEW leaf screen, real route (was not a surface at all). Resolves restaurant from the live feed + dish from `restaurantMenuProvider`; quantity stepper clamped 1–99; add-to-cart reports the **actual** `FoodCartNotifier.add()` result — a dish that went off the menu or a cross-restaurant basket switch is stated, never faked. No rating/review/ETA/spice fabricated. Covers no-arg, feed-loading, restaurant-unavailable, not-found, menu-loading, dish-not-on-menu, sold-out. Analyze clean, 390dp render-verified. | verified |
| Cart / checkout | 32e7f9ff | /food-checkout | features/food/.../food_checkout_screen.dart | Truth pass (#132, 2026-10-05): the delivery line now reads the `deliveryMinutes` integer carried from the menu route — "Delivery time shown at the restaurant: 35 min" when declared, "Delivery time is confirmed by the restaurant" when not — instead of a client-side guess. Fee lines remain un-invented: item total at menu price with the "the restaurant re-reads every dish price" note, no delivery fee / packaging / GST the app made up. `test/food_checkout_test.dart` pins both wording branches. | flutter |
| Order tracking | — | /food-tracking | features/food/.../food_order_tracking_screen.dart | only real states | pending |

## Grocery
Same browsing-hierarchy rule: category → subcategory → product list → product detail as distinct screens.
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Store discovery / home | 0a04eace | /grocery-home | features/grocery/.../grocery_home_screen.dart | Added the missing list entry: "Sort ›" on the product heading → `/grocery-products`, carrying the active aisle as `?category=` when one is selected. Then restructured to a supermarket-menu shape (owner reference 2026-10-04, structure only): the aisle pills became a **"Shop by category" artwork grid**, where each tile's picture is one of that aisle's own catalogue rows and each name/count is derived from real `GET /api/grocery/products` rows. No "delivery in 10 minutes" strip and no address greeting sits above it — the platform has no SLA read and no address book. | flutter |
| Category | — | /grocery-categories | features/grocery/.../grocery_categories_screen.dart | Became the **two-pane menu browser**: aisle rail on the left (with an "All aisles" clear entry), that aisle's product grid on the right, sticky basket bar under it. Accepts `?aisle=` so a home tile opens on the aisle it names, and filters through the endpoint's real `category` param rather than in memory. Aisles are **derived** from the `category` field of real rows (no category endpoint exists). Selected rail chrome measures brand `#1A3BA2`, not the service green; `test/grocery_menu_test.dart` (5 tests) pins that, the outgoing query, the basket subtotal and the no-SLA guard at 393 and 834 px. | flutter |
| Subcategory | n/a — not built | — | — | **Honest omission.** `GroceryProduct` carries exactly one `category` level — there is no subcategory field, and inventing a taxonomy would fabricate data the backend does not have. | pending |
| Product listing | (to mint) | /grocery-products | features/grocery/.../grocery_products_screen.dart | NEW distinct list screen: search field + aisle chips + sort. Sort is **client-side over the already-fetched rows and says so** ("Sorted by … (these results only)") because the grocery API exposes no sort. Pull-to-refresh, empty ("No products match …"), loading and error+retry all covered. Accepts `?category=` / `?search=` seeds; notifier mutation deferred past the first frame. Analyze clean, 390dp render-verified with a seeded catalogue. | verified |
| Product detail | 40a5f2f3 | /grocery-product-detail | features/grocery/.../grocery_product_detail_screen.dart | Promoted from the deleted bottom-sheet modal (`grocery_product_detail_modal.dart`) to a real route; every `GroceryProductTile` now `context.push`es here. Resolves the row by id from the live catalogue (no single-product endpoint). Quantity/add via the shared `GroceryAddControl`, basket via the shared sheet. Shows only fields the payload carries — no rating, review count, ETA, veg flag, coupon or gallery. Covers no-id, loading, error+retry, delisted, in-stock and sold-out. Fixed a real 142px RenderFlex overflow in the price row (price + struck-through MRP + savings now stack, MRP `Flexible`/ellipsis); 390dp render-verified with a long-named discounted product. | verified |
| Your cart | 58772084 | /grocery-cart | features/grocery/.../grocery_cart_screen.dart | Chrome: app bar + title → `headerBand`/`onHeader`, count-and-total subtitle → `white70`, delete-swipe icon → `onHeader`. Also fixed a standing-rule violation — the default address and all three picker entries were Delhi localities; now Kamalanagar / Tuiklani / Bungkawn Market, all Aizawl. | flutter |
| Substitution | 40fb7111 | — | features/grocery/.../grocery_cart_screen.dart | — | pending |
| App shell nav | — | /grocery-home | features/grocery/.../grocery_app_shell.dart | Chrome: top border made `const`; nav stays surface-white with brand only on the active destination. | flutter |
| Checkout | — | /grocery-checkout | features/grocery/.../grocery_checkout_screen.dart | Delhi→Aizawl on the default address and all three `_addressChoices` entries. | flutter |
| Cart sheet | — | — | features/grocery/.../grocery_cart_sheet.dart | Sticky basket bar was a green gradient wash; page structure now carries a solid brand band instead. | flutter |
| Product tile | — | — | features/grocery/.../grocery_product_tile.dart | `GroceryAddControl` split by role: `compact ? serviceAccent : primaryAction` — row-level ADD stays grocery-green, sheet-level CTA goes brand. | flutter |
| Categories / products / detail / deals | — | — | features/grocery/.../grocery_{categories,products,product_detail,deals}_screen.dart | Chrome: bars → `headerBand`, icons+titles → `onHeader`, muted subtitles → `white70`, selected chips → `chipSelected` on `sectionFill`, sort check + refresh indicator → brand. Search prefix icon and sort glyph use `headerBand` so brand reads as structure, not decoration. | flutter |

### Slice 3b — #1A3BA2 chrome pass over the Grocery surfaces
Rule applied: **brand = structure** (app-bar band, one primary CTA per view, selected chips, active nav, sticky basket bar, soft section fills); **service colour = identity** (icon badges, stock/status chips, row-level ADD controls, price emphasis). Additive roles only — `RestaurantTheme` is shared with the Restaurant Merchant app and `GroceryTheme` with `main_grocery_merchant.dart`, so no existing constant was mutated.

Verified: `flutter analyze lib/features/grocery` → No issues found. Full `flutter test` → `+61 -4`, matching the documented baseline exactly (the 4 are the known support failures from task #4), so no regression. 390dp render probe on 7 screens → 6 clean; `grocery_account_screen.dart` throws a 13px RenderFlex overflow and is **not** styled — see the Account section. Probe deleted afterwards per the verification recipe.

Two things found and escalated rather than papered over:
1. **`grocery_account_screen.dart` is a fabricated screen, not an unstyled one.** Invented identity (Rahul Sharma / +91 98765 43210 / rahul.sharma@example.com), an "M3 GROCERY WALLET ₹450.00" whose "+ Add Cash" only SnackBar-claims "Added ₹500", two invented delivered-in-8/9-mins orders (M3-882910 ₹141, M3-882912 ₹125) with Reorder buttons that reorder nothing, a "24/7 live support" claim, `Card **** 8888`, "Version 2.4.0", non-NABIN "M3" branding, and a Delhi address — with **zero providers**, so it reads nothing from the backend. Polishing it would launder fake data into a prettier fake screen. Needs an owner decision: wire to real endpoints, or strip the invented claims. Overflow cause is the wallet `Row` at :84–96 being non-`Flexible` inside a `spaceBetween` Row. It is routed in Customer (`grocery_app_shell.dart:47`), so it is not dead code.
2. **Delhi data in Customer money/identity paths beyond Grocery.** Now fixed on the label side: `food_checkout_screen.dart:18`, `food_order_tracking_screen.dart:55`, `profile_screen.dart:114-115/910/1054`, `active_ride_screen.dart:873`. Still open, and deliberately **not** silently changed because they are data/geo rather than copy: `school_child_repository.dart:76` carries a Delhi address *and* Delhi lat/lng (28.69xx/77.21xx) that feed the map, `food_order_tracking_screen.dart:54` has a Delhi RTO plate `DL 1RA 4892`. Closed: the wallet screen's "Auto Ride (Civil Lines ➔ CP) -₹85.00" transaction and its two siblings are gone with the rest of that fabricated ledger. `driver_map_view.dart` defaults are left alone — that widget is Customer+Driver shared and off-limits internally under a Customer-only brief.


### Slice 3 (Food + Grocery browsing hierarchy) — closed by 3b
The four new screens sit **inside** the existing Food and Grocery surfaces and deliberately inherited their service-zone palettes (RestaurantTheme orange, GroceryTheme green) so a slice wouldn't ship half-indigo/half-service. The #1A3BA2 white-dominant **chrome** pass over these two zones is now what the Slice 3b section above records, so that open item is closed. Nothing in this slice touched the backend, and no payment, refund, cancellation, rating, ETA or tracking value was invented.

## Account / Support
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Wallet | 49785b81 | /wallet | features/wallet/.../wallet_screen.dart | Truth pass, chrome still on the old `AppTheme` (queued in the all-apps UI task). The Flutter screen was an illustration: `double _balance = 450.00`, two instruments nobody saved (HDFC Visa **** 8888, rahul@okhdfcbank), three ledger rows with reference ids and a receipt sheet for them, and a Top Up sheet that added money to the local double and SnackBar'd "added successfully". None of it has a route — the backend registers **no** customer wallet endpoint, and its only payment routes are order-scoped. It now reads the one number that does exist, `walletBalance` on `GET /auth/me`, renders a refused read as "Couldn't load your balance" + Retry instead of ₹0, states that adding money isn't available yet, and paints no instruments or transactions at all. Deliberately departs from the generated design's "NABIN does not hold customer funds or process stored-value wallet transfers": the entity has a `walletBalance` in both the mirror and the SQL projection, checkout accepts `paymentMethod: WALLET`, and an admin refund credits that balance — so that sentence would be an invented assurance pointing the other way (2026-10-05, `mobile/test/customer_wallet_test.dart`). | verified |
| Activity | f9d58767 | /activity | features/activity/.../activity_screen.dart | — | pending |
| Profile | 4193af26 | /profile | features/profile/.../profile_screen.dart | Truth pass (2026-10-05, `mobile/test/customer_profile_test.dart`, 11/11). It was a `StatelessWidget` that hardcoded the person it belonged to — "Rahul Sharma", "+91 98765 43210", "rahul.sharma@example.com", initials "RS", a "42 Rides Taken / 18 Food Orders / ⭐ 4.98 User Rating" row — and made no request at all. It now reads the two routes that exist: `GET /auth/me` for identity plus the entity's own `rating`, and `GET /customer/activity` for the RIDE/FOOD counts, with the avatar initials derived from the returned name. A refused profile read paints "Couldn't load your profile." + Retry instead of a guess; a refused activity read paints **dashes**, because a row of zeros would report an absence as a fact; a profile with no `rating` column paints no star and no figure. The "Saved Payment Cards & UPI" tile went with the rest of the invented instruments — its modal asserted "Primary: HDFC Visa Card **** 8888 / UPI Autopay: rahul@okhdfcbank / Status: Verified & Active" and **no route returns a payment instrument**. Fixed a pre-existing 390dp `RenderFlex overflowed by 63 pixels`: the stats row was an unbounded `spaceAround` Row whose three labels need ~363px before any gap → `Expanded` thirds. "Log Out of NABIN" also only navigated: it never called `POST /api/auth/logout` (the route exists and invalidates the token server-side) and never cleared `SessionManager`, so the bearer token stayed attached to every later request and the process still reported itself authenticated — both halves are now wired, the local session goes even when the logout call is refused, and Cancel does neither (2026-10-05, `mobile/test/customer_logout_test.dart`, 5 tests). Chrome still on the old `AppTheme` (queued in the all-apps UI task). | verified |
| Addresses | dbff01e3 | /profile | features/profile/.../profile_screen.dart | — | pending |
| Settings | 0528cc30 | /profile | features/profile/.../profile_screen.dart | — | pending |
| Support | ddbb68db | /support | features/support/.../customer_support_screen.dart | no fabricated success (task #4) | pending |

## Global edge states
| Screen | Stitch id | Route | Flutter file | Redesign changes | Status |
|---|---|---|---|---|---|
| Offline | 7a772e70 | — | (shared) | — | pending |
| Session expired | 78d01891 | — | (shared) | — | pending |

## Foundation (done)
- Flutter tokens: brand #1A3BA2 (derived hover #2A4DB8 / bright #3E5CC4 / pressed #142E80 / tint #E9EEF9 / container #D6DEF5); full-bleed indigo detour reverted to clean white/neutral light model. `mobile/lib/core/theme/{nabin_tokens,app_theme}.dart`, `mobile/lib/main.dart`. Analyze clean; remote-config contract tests pass.
- `stitch_designs/customer/DESIGN.md` rewritten for #1A3BA2 white-dominant + redesign principles.

## New authoritative Stitch project — 17214277447715826653
The 15 screens supplied as the "right pages" were archived verbatim to `stitch_designs/customer/brand_1A3BA2/` **before** any deletion, then assessed rather than reused:
- ~12–13 of the brief's 89 inventory slots, with duplicates (two OTP screens, two home dashboards).
- Two screens still leaked `#4d5bbd` as `primary-container` (Parcel, Vosa Bai).
- **0 `@media` rules and ~4 `md:` classes across all 15** — the brief's responsive "critical requirement" was unmet.
- No LOCATION, ACCOUNT or GLOBAL screens at all.

The old project `319307322565808827` was **deliberately not deleted** — irreversible and shared-state; needs an explicit owner decision. The new project was created additively instead.

### Brand derivation defect found and fixed
Stitch's default Material derivation produced `primary: #00247f` (not #1A3BA2), `surface`/`background: #f7f9fd` (not white), and dropped every NABIN-named token. Two things had to be learned the hard way:
- `namedColors` is **not writable**. The role palette is derived only from `customColor` + `colorVariant` + `overridePrimaryColor/Secondary/Tertiary/Neutral`.
- `update_design_system` requires `name` **and** `projectId` **and** `designSystem`; the missing `name` was the actual cause of five failed theme shapes.

Fix: a new design system `assets/14539958730493792873` with **`colorVariant: FIDELITY` + `overridePrimaryColor: #1A3BA2`**, verified by generating a real screen rather than by reading back the config. Generated screens now emit `#1A3BA2` / `#142E80` / `#2A4DB8` / `#E9EEF9` with `primary-container: #D6DEF5`, and `#00247F` and `#4D5BBD` counts are **0 on every screen** (vs two leaks in the old set).

### Access path
The `stitch` MCP server is configured in user settings but its tool surface did not load (`mcp_list` keyword `stitch` → 0 tools). Working path is direct JSON-RPC to `https://stitch.googleapis.com/mcp` with an ADC bearer token from the bundled `~/.stitch-mcp/google-cloud-sdk` (`CLOUDSDK_CONFIG=~/.stitch-mcp/config`) plus `X-Goog-User-Project: gen-lang-client-0394278280`, re-minted per request for the ~1h expiry.

### Generation
17 lean prompts, one sentence per screen, brand/responsive/Aizawl/honesty rules carried by the pinned design system rather than restated in each prompt. `DESIGN.md` gained a **"Responsive system (required - not optional)"** section (6-breakpoint table + 9 rules) before upload.

Audited (all 17 screens): responsiveness is structural, not cosmetic — `max-w-7xl mx-auto` capped containers, column-count-driven grids, `nav md:hidden fixed bottom-0` ↔ `aside hidden md:flex` rail swap, mobile sticky checkout summary ↔ `aside lg:col-span-4 lg:sticky` two-column, stacked detail ↔ side-by-side, zero `100vw`, 6–70 breakpoint classes per screen vs ~4 total in the whole old project. `#00247F` / `#4D5BBD` / `#1A1265` counts are **0 on all 17**, and Delhi/Connaught/Civil Lines/Kamla Nagar counts are **0 on all 17** — the designs carry real Aizawl localities (Kamalanagar, Chanmari, Zarkawt, Durtlang, Khatla, Mission Veng, Tuiklani, Bungkawn, Champhai).

Money math verified by hand, and it is correct: food checkout `260 + (60×2) + 180 = 560` subtotal, `+ 30 + 15 + 28 + 5 = 638` which equals the stated Total to Pay, with GST at 5% of 560 = 28 exactly; parcel `50 + 35 + 21 + 10 + 29 = 145` equals the stated Total and the selected express fare. Honesty holds where it was asked for: the parcel screen states outright "without live map tracking", and food checkout shows "No coupon applied".

### Two defects found during the audit, not accepted
1. **`#27` — the Grocery browse and detail screens invent catalogue data.** `generate_screen_from_text` was asked for the brief's CATEGORY→SUBCATEGORY→PRODUCTS hierarchy, which the backend cannot express: `GroceryProduct` has exactly one `category` field, no subcategory, no category endpoint, and no rating field. So the screen fabricated it — a White Rice / Brown Rice / Millets / Flour taxonomy, department counts ('85+ / 42 / 64 / 110+ / 54 / 38 items', '28 items available in Kamalanagar', '4 subcategories found', 'Showing 8 of 18'), and '850+ verified local ratings'. The Flutter log already records the subcategory layer as an *honest omission*; these two Stitch screens contradict that and are **not** approved. Needs an owner decision: add the backend field, or keep the taxonomy and ratings out.
2. **`#28` — four of the six responsive ranges are unaddressable.** Tailwind's stock 640/768/1024/1280 leaves 320–360, 375–430 and 431–600 in one undifferentiated base and gives 1281+ the 1025–1280 treatment. DESIGN.md now carries a literal `theme.extend.screens` block (xs=375, sm=431, md=601, lg=1025, xl=1281, 2xl=1600) and was re-uploaded; it demonstrably took effect, since the regenerated Onboarding emits `xs:`. `xl:`/`2xl:` are still present on only 5 of 17 screens.

### `deviceType` behaviour, corrected
`MOBILE` is not structurally ignored — it produced a 780×3888 mobile dish-detail screen on retry while 16 earlier calls with the same parameter returned DESKTOP, so it varies per generation and can't be relied on. The trade-off is worth recording: the **DESKTOP** outputs are the ones carrying responsive markup, while the single MOBILE output has **zero** breakpoint classes and a fixed frame.

### Illustration diversion, fixed
Two prompts opened with image language ("Illustration area…", "large image…") and Stitch diverted them to image generation, returning assets with **no `htmlCode`**. Both were regenerated successfully by leading with "Complete mobile app screen, not a standalone illustration" and calling the photo a "bordered media panel". 17 of 17 screens now exist as real HTML.

### Coverage against the approved inventory
17 generated of 89 requested: AUTH 4/7, HOME 1/3, RIDE 1/14, FOOD 6/15, GROCERY 4/17, PARCEL 1/8, and **LOCATION (5), ACCOUNT (10) and GLOBAL (10) entirely absent** — the same three groups the original 15 screens also lacked. The brief is explicit that this must not stop at Home or at a few Food/Grocery screens, so the project is **not** complete. Tracked as `#29`.

### Location, Account and Global: the API was read before the prompts were written

`backend/src/server.js` was searched for the routes these 25 screens would sit on. The answer inverted the usual risk — the danger here is not ugly screens but screens that imply a capability:

- **zero** address routes and **zero** wallet routes across all 187 registered routes.
- `/api/customer/profile/photo` is the only writable profile field; name, phone and email have no update path.
- The single geo endpoint `/api/geofence/reverse-geocode` is hardcoded to Delhi (`landmark = 'Delhi NCR Operational Hub'`), so it cannot resolve an Aizawl locality — see `#32`.

DESIGN.md gained a **"Backend capability boundary (verified 2026-10-03 against backend/src/server.js)"** section: the real customer-scoped routes, the not-supported list, the real error semantics (401, 403 `FEATURE_DISABLED`, 423 `servicePaused` with `broadcastNotice`/`resumeAt`, 429 with `retryAfterMs`, 503 `CUSTOMER_ACCOUNT_STATE_UNREADABLE`, and the echoed `requestId`), plus the rule **"An unreachable store is not an empty list."** The GLOBAL screens are built from those codes rather than from generic error art.

### The probe that changed all 25 prompts

One wallet screen was generated before launching the batch. It obeyed every ban the prompt named — no balance figure, no Add-Cash button, no transaction list — and then invented the category of claim the prompt had *not* named: **"RBI Compliant", "Instant NPCI settlement", "100% Direct Bank Refunds / Standard window: 2–48 hrs", "Bank-grade 2-factor OTP", "₹0 Fee."** A model fills a capability gap with reassurance, and reassurance reads as a commitment. Fixed at three levels: prompt 26 rewritten to name payment rails, fee amounts, refund windows and certifications as banned in words; a `GUARD` clause appended to all 25 prompts; and a DESIGN.md paragraph. Re-generated under the fix, the wallet screen is honest — **0 invented claims, 0 Delhi** — and now reads: *"NABIN does not hold customer funds or process stored-value wallet transfers. You choose and complete your payment method directly whenever you book a ride or place an order at checkout."*

### Audit of the first nine (18–26)

All MOBILE, 780px wide, `#1A3BA2` present on every screen, `#00247F` and `#4D5BBD` at **0 on every screen**, Delhi/Connaught/Kamla Nagar/Bangalore/Mumbai at **0 on every screen**, invented-claim grep clean on every screen. Two `100%` hits and several `sla` hits were read in context and are artifacts of the matcher, not copy — `width="100%"` on an SVG rect, `100%` inside a `@keyframes` block, and `sla` inside `translate`; recorded so the next audit does not re-litigate them.

The three surfaces with no endpoint behind them behave as designed:

| Screen | What it says instead of inventing |
|---|---|
| 22 Saved addresses | "Address storage not supported … Customer accounts currently do not store persistent address books or saved profile locations", then offers the two paths that do work. |
| 25 Account addresses | "On-demand per booking. No Saved Addresses … Pickup points and delivery destinations are chosen directly whenever you book a ride or place an order." |
| 26 Account wallet | "In-App Wallet Not Available … NABIN does not hold customer funds", pointing at the payment method chosen at checkout. |

Screens 18 and 19 carry the same discipline inside the flow: *"Locations selected here apply only to this booking. NABIN does not save addresses to an address book."* One borderline line in 22 is noted rather than waved through — "Coordinates sync directly to the driver navigation terminal" asserts a hand-off no response confirms, and belongs in the same category as the claims the `GUARD` exists to stop.

### Open: mobile frames against a critical responsive requirement

Batch 3 is coming back MOBILE where batch 1 came back DESKTOP-wide, and the cost is measurable: screens 18–26 carry **0–9 breakpoint classes** against the 6–70 the DESKTOP outputs carry. The brief calls the six ranges a critical requirement and says explicitly *"Do NOT simply enlarge mobile UI"*, so a mobile frame alone does not satisfy it. Tracked as `#30`: a second pass on responsive canvases, keeping these mobile renders as the mobile-primary reference rather than replacing them.

### Audit of the full Location / Account / Global batch (18–42)

Twenty-two of twenty-five landed on the first pass; `29 Account support`, `30 Account settings`, `31 Identity verification` and `42 Global confirmation` hit server-side failures (`IncompleteRead`, "The service is currently unavailable", and two ~270s calls that returned a design with no `htmlCode`). All four are now generated — 29 and 30 recovered on a plain retry, 42 needed the prompt re-shaped because it asked for a bare dialog, which is not a screen, and 31 needed the data contract corrected (below). **LOCATION 5/5, ACCOUNT 10/10, GLOBAL 10/10.**

Across the screens that did land: `#1A3BA2` present on every one, `#00247F` and `#4D5BBD` at **0 on every one**, Delhi-family place names at **0 on every one but one**, and the invented-claim grep clean.

Two things the first pass got right that are worth keeping as evidence rather than impressions:

- The GLOBAL states are built from the API's actual failure vocabulary, not generic error art. Screen 36 renders the echoed `requestId`; 37 shows an attempt count on a failed list load; 40 renders the pause as the operational lock it is, with the broadcast notice and resume time; 41 shows `403 FEATURE_DISABLED` for a region-restricted control.
- The four screens with nothing behind them — 22, 25, 26 and the address-selection pair at 18/19 — refuse rather than decorate, quoted above.

Three findings from the same audit, all minor, none accepted silently:

1. **Screen 28 uses a non-local market name.** A history row reads "Bara Bazar Produce / Bara Bazar, Kamalanagar Hub". Bara Bazar is a Delhi and Agartala market, not an Aizawl one; Aizawl's markets are Darbar Market and City Durtlang. Fix in the responsive pass rather than hand-editing generated HTML.
2. **Screen 39's chip says "Awaiting Gateway Settlement".** It does not claim success, so it is not the wallet-screen failure mode, but "settlement" names a stage no response reports. It should read as pending verification and nothing more.
3. **Screen 22 says "Coordinates sync directly to the driver navigation terminal."** No response confirms that hand-off, and it is the same category of reassurance the `GUARD` exists to prevent. It survived because the guard bans claims about money and compliance, not about hand-offs.

Screen 28's per-row detail was also checked against the payload rather than assumed: `/api/customer/activity` returns exactly `id, service, title, status, amount, currency, placedAt, itemCount, active` — no merchant name, no locality, no item names, no payment method. The order rows behind `/api/customer/orders` do carry `payment_method`, `metadata.deliveryAddress` and `order_lines`, so history is renderable from real data, but the **merchant display name is not** on either payload — it needs a join the current endpoints do not perform.

### Screen 31 was wrong about the contract, and checking the route caught it

The first Identity verification screen offered a document **chooser** — Aadhaar *or* Voter ID *or* Driving Licence — plus a "KYC Tier 1" indicator. That is a form that cannot submit: `POST /api/identity/submit` (server.js:3508) requires **both** a 12-digit `aadhaarNumber` and a `voterIdNumber` of at least 5 characters in one call, each with its own document URL, and the payload has no driving-licence field and no tier. It was regenerated against the real contract and now asks for both documents together, drops the licence option, and carries the four real status states. Its remaining `tier` and `certification` matches are inside the generator's own HTML comment — "No Tier, No Level, No fake certification badges" — not on screen.

Worth separating from the fabrication findings: this screen's `POST /api/identity/submit` reference is **real**. Two of the three Account gaps (addresses, wallet) turned out to have no routes at all, so the suspicion on the third was reasonable and wrong, and reading the route is what settled it.

One backend finding came out of reading that handler, reported rather than fixed: the submit path defaults its document URLs to `'/docs/mock_aadhaar_user.png'` and `'/docs/mock_voter_user.png'` when the client sends none, so an identity application can be recorded as document-bearing while pointing at a placeholder image (server.js:3446 and :3448).


### Local preview, and what looking at the screens found that grepping had not

`preview.html` (untracked local artifact, served from this folder by `python -m http.server 8765 --bind 127.0.0.1`) renders all 42 screens with their screenshots, device/viewport, and a breakpoint-class count per card; opening a screen renders it in iframes at the brief's exact six widths — 320, 390, 430, 601, 1025, 1281 — and a six-up rig shows all six side by side. `screens.json` is generated by `make_preview.py`, which classifies by title keyword and joins the three generation state files.

The rig had a real bug: it resolved "the open screen" by matching the overlay's header text back against the list, so a title that did not match exactly left a stale index and the rig redrew **a different screen than the one clicked** — visible as a LOCATION card opening into a RIDE rig. Fixed by storing the opened screen in a variable set inside `openDetail`. Verified in the browser: clicking the *Location select* card and toggling the rig now yields six frames, all sourced from `NABIN_18_Location_select.html`, at widths 320/390/430/601/1025/1281.

Two screens came from looking at the rendered designs rather than at markup counts — `#15 Choose a ride`, whose `verified` icon is labelled **"Mizoram Certified"** beside per-vehicle **"4.8★ (420+ ratings)"**, **"4.9★ Top Hill Fleet"**, **"4.9★ (310+ trips)"** and **"Clean sanitized helmet"**, and `#11 Food order status`, whose bill carries **"Coupon (MIZOMEAL25) −₹100"** and whose footer asserts **"Mizoram State Licensed Delivery Network"**. Both are batch-1 screens this log had already passed, because the earlier audit checked colour, locality and money math and never checked claim language.

So the check was run properly, over all 42 screens, on visible text only with HTML comments and `<script>`/`<style>` stripped — the comment bodies are the generator's own annotations and were the source of earlier false positives.

**13 of 42 screens carry claim language, and all 13 are in batch 1: 03, 04, 06, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17.** That is 13 of the 17 batch-1 screens. Batch 3 (18–42) is clean on this class.

The categories found, worst first:

- **Fabricated regulatory identifiers.** Five screens print full 14-digit FSSAI licence numbers attributed to named kitchens and stores: `#08` and `#10` → `13220004000189`, `#11` → `22519001000342`, `#13` → `11823001000214`, `#14` → `10020037000184`. A licence number is a public identifier of a real regulator's record; inventing one against a named business is the most damaging item in this set, not a decorative badge.
- **Payment-rail and security certification on the payment screen.** `#17 Processing payment` carries **"AES-256 GCM • RBI Certified"**, **"NPCI Certified"**, **"Confirmed Clearance via NPCI Unified Payments Interface"** and **"encrypted settlement with your UPI provider"**. This is the same failure mode the wallet screen was caught in and fixed for; it was never checked here. `#03` and `#04` add **"256-bit SSL Encrypted"** / **"256-bit Encrypted"**, and `#10` adds **"All transactions encrypted with 256-bit banking security"** with **"100% Secure"**.
- **Certifications with no referent.** **"FSSAI Certified Kitchens"** (`#06`), **"Clean Kitchen Certified"** (`#10`), **"Hill Certified"** on the driver card (`#11`), **"FSSAI Certified"** (`#14`), **"Mizoram Certified"** (`#15`), and `#08`'s **"MIZ FOOD Verified"**.
- **Guarantees.** **"Damage-free guarantee on all steep mountain slopes"** (`#16`), **"100% Authentic Mizoram Harvest Guarantee"** and **"guaranteed quality checks"** (`#13`, `#12`), **"NABIN Freshness Guarantee / 100% PURE"** and **"Freshness & Mill Guarantee"** (`#14`), **"Authentic Chingal Preparation Guarantee"** (`#09`), **"NABIN Food Guarantee"** (`#10`), **"Guaranteed price. No surge changes"** (`#15`), **"Authentic Mizo Preparation Guaranteed"** (`#17`).
- **Ratings and trip counts** the data model has no field for: `#14`'s **"850+ verified local ratings"** (already open as #27), `#15`'s three vehicle ratings, `#11`'s driver **"4.9"** and **"1,420+ safe Aizawl hill deliveries completed"**.
- **Coupon codes with amounts**, on screens where no customer-coupon read path exists: `#08` and `#11` → `MIZOMEAL25 −₹100`, `#15` → **"Coupon Applied: 'HILLRIDE15' ₹15 flat discount"**. `#10` is the counter-example and reads **"No coupon applied"** — the honest shape, which is what the Flutter checkout was changed to show.

One false positive worth recording so it isn't re-reported: `#41 Global disabled` matched `rbi` twice, both inside the word **"Forbidden"** in its own `403 FORBIDDEN / FEATURE_DISABLED` payload. Substring matching on short tokens is not a check; word boundaries and a look at the surrounding text are.

What this changes mechanically: the claim grep becomes a gate on every batch, its vocabulary covers certification, licence numbers, regulatory bodies, encryption and security guarantees, settlement rails, refund windows, fee claims, ratings and trip counts, coupon codes and hygiene or quality guarantees, and it runs on visible text with comments stripped. Batch 1 needs the pass the GUARD gave batch 3 — which is an owner decision on regeneration, tracked as #33, not something to hand-edit into generated HTML.


### Responsive scope became phone + tablet, and the guard leaked into the copy

The owner ruled that these are mobile app screens: responsive means **phone (320–430) and tablet
(601–1024) only, no desktop layouts**. That invalidated the contract in this file's own
`## Responsive system` section, which defined six ranges including `2xl 1025-1280` and `3xl 1281+`,
shipped a `theme.extend.screens` block naming `lg: 1025px / xl: 1281px / 2xl: 1600px`, and required
"expanded rail/sidebar at tablet and above" and catalog grids growing to 4 and 6 columns. The
section is now five ranges ending at 1024, the Tailwind block stops at `lg: 769px`, the sidebar rule
is explicitly banned ("the bottom tab bar stays a bottom tab bar at every width"), and grid growth
is capped at 1 → 2 on phone, 2 → 3 on tablet. DESIGN.md was re-uploaded to the project so the next
generation inherits it rather than the stale desktop contract.

Then the ride batch (43–55) exposed a failure mode nobody predicted: **the honesty guard was
rendered as customer copy.** Screen 43 came back with a visible panel headed *"Strict Client
Operational Gaps (No Fabrications)"* listing "No driver phone call button (assignment carries no
telephone payload)", "No ride receipt download route (activity record only)", and a separate
*"REST Endpoints & WebSocket Lifecycle"* section printing `POST /api/customer/book-ride`,
`DRIVER_ASSIGNED: (jobId, driver, vehicleName, vehiclePlate, startOtp)` and the
`PENDING → ASSIGNED → COMPLETED | CANCELLED` state machine. Screen 44 printed
`HTTP 423 servicePaused: broadcastNotice & resumeAt`. Every one of those statements is **true**,
which is what makes them easy to miss: the screens passed the claim audit precisely because the
guard worked. A customer cannot read a status code, a JSON key or the word "payload", and a list of
missing routes is a spec sheet, not a screen.

Fixed in three places, because a per-prompt instruction alone competes with the stored contract:
`RIDE_RULES` now opens by declaring itself *"context for your decisions, NOT content to render"*;
`GUARD` bans printing a list of what the app cannot do; and DESIGN.md gained a **Copy register**
section (no endpoint paths, status codes, response fields, feature-flag keys, event types or
state-machine diagrams in visible text — "Taxi rides aren't open in your area yet" instead of
`403 FEATURE_DISABLED`) and a **Token use** section (no raw `amber-100` / `slate-200` Tailwind
palette classes; use the design-system token that means the same thing).

Two further content defects the audit caught on the first clean pass: vehicle cards showing
**"4 mins away"** and **"7 mins away"** — nothing on the customer surface returns a driver arrival
estimate — and an invented coupon code `AIZAWLRIDE20`. The guard now names both: no arrival estimate
on a vehicle card, and the only real codes are `FESTIVAL30` and `NABINFIRST50`. `NABINFIRST50` is a
genuine seeded promotion (`database.js:620`, 50% off first 3 cab rides, max ₹100, min ₹80, new users,
RIDE only); `FESTIVAL30` exists only as an admin-created promo in the test suite, so a screen must
never print a discount figure before the preview response actually returns it.

Also worth recording, because it cost a batch: **`deviceType: 'MOBILE'` is a request, not a
guarantee.** Screen 45 asked for MOBILE and returned a `2560x2752` DESKTOP canvas, and `width` comes
back as a *string*, so the guard `width > 1024` raised `TypeError` instead of comparing. The
generator now coerces the width and discards any canvas over 1024px rather than importing a desktop
layout to fix later. And stopping a background generation on this machine does not stop the Python
child — two generators were found writing the same state file and the same HTML at once, so the
state was reset and the batch regenerated from clean.
