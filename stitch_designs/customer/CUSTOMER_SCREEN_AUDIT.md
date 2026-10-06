# NABIN Customer — screen-by-screen audit

Stitch project `17214277447715826653`. 69 canonical screens, one row each, the twelve fields the brief asks for. **id, device, canvas and tab bp are read from the project**: `final_audit.py` fetches each slot's newest stored revision and counts tablet utilities inside class attributes only. **rendered** is what headless Chrome paints at 768 CSS pixels (`render_audit.mjs`), which is the only way to see a phone column that declared enough utilities. **brand%** and the content flags are measured on the canonical render by `audit_all.py`, except the two frame labels `DESKTOP-CANVAS` and `NO-TABLET`, which are re-derived from the fetched revision so they cannot contradict the canvas column beside them. The product columns are declared here, and the backend column is checked against the routes actually registered in `backend/src/server.js`.

A `none` under **backend dependency** is a finding, not a gap in the table: the screen shows a capability no customer route implements. Those are collected at the end.

`23` slots store a revision that is not the render on disk (09, 10, 16, 20, 22, 25, 26, 30, 32, 43, 46, 47, 48, 49, 50, 51, 52, 53, 54, 56, 61, 63, 66); for those, the render-based columns describe the local file while the id and canvas columns describe what the project actually holds.

| # | screen | journey | prev → next | purpose | backend dependency | Flutter destination | id | device | canvas | tab bp | rendered 768 | brand% | quality | redesign |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 | Splash | AUTH | app launch → 02 Onboarding | Brand hold while the session is restored. | GET /api/auth/me (session only, no screen data) | `features/auth/splash_screen.dart` | `e66aa83fdb` | MOBILE | 780x2368 | 8 | 704px of 768 painted | 38% | weak | REBUILD (phone+tablet form) |
| 02 | Onboarding | AUTH | 01 Splash → 03 Login | Three value slides introducing the super-app. | none - static copy | `features/auth/onboarding_screen.dart` | `08083d712a` | MOBILE | 780x2114 | 7 | 736px of 768 painted | 56% | weak | REBUILD (phone+tablet form) |
| 03 | Login phone entry | AUTH | 02 Onboarding → 04 OTP | Collect the phone number that starts the session. | POST /api/auth/send-otp | `features/auth/login_screen.dart` | `bdd6496c89` | MOBILE | 780x1768 | 8 | 724px of 768 painted | 39% | sound | keep |
| 04 | OTP verification | AUTH | 03 Login → 05 Home or 18 Location | Verify the six-digit code. | POST /api/auth/verify-otp | `features/auth/otp_screen.dart` | `5410c81bc6` | MOBILE | 780x1768 | 5 | 736px of 768 painted | 70% | weak | REBUILD (phone+tablet form) |
| 05 | Customer home super-app | HOME | 04 OTP / tab → any service tab | The super-app front door: location, search, four services, active order, activity. | GET /api/services/status, /api/customer/orders, /api/customer/activity, /api/notifications | `features/home/home_screen.dart` | `5bfccd6a2c` | MOBILE | 780x5526 | 21 | 736px of 768 painted | 40% | weak | REBUILD (phone+tablet form) |
| 06 | Food home | FOOD | 05 Home → 07 Category | Browse restaurants and dishes by cuisine. | GET /api/restaurants | `features/food/food_home_screen.dart` | `fda7ddbd15` | MOBILE | 780x5278 | 12 | 730px of 768 painted | 66% | weak | REBUILD (phone+tablet form) |
| 07 | Food category and subcategory | FOOD | 06 Food home → 08 Restaurant | Pick a category then a subcategory. | GET /api/restaurants (menu categories) | `features/food/food_category_screen.dart` | `1b06354737` | MOBILE | 780x3174 | 27 | 720px of 768 painted | 62% | weak | REBUILD (phone+tablet form) |
| 08 | Restaurant detail and menu | FOOD | 07 Category → 09 Dish | One restaurant: identity, status, its menu. | GET /api/restaurants/:id + /api/restaurants/:id/menu | `features/food/restaurant_detail_screen.dart` | `665d1d6f76` | MOBILE | 780x5178 | 11 | 781px of 768 painted | 60% | weak | REBUILD (phone+tablet form) |
| 09 | Dish detail vosa bai | FOOD | 08 Restaurant → 10 Cart | One dish: price, description, add to cart. | GET /api/restaurants/:id/menu | `features/food/dish_detail_screen.dart` | `8591a20bb2` | MOBILE | 780x3994 | 9 | 728px of 768 painted | 57% | weak | DRIFT ONLY (project stores other bytes) |
| 10 | Food cart and checkout | FOOD | 09 Dish → 11 Order status | Review the basket, apply a coupon, place the order. | POST /api/customer/book-food, /api/promotions/apply | `features/food/food_cart_screen.dart` | `bc9aeb5e81` | MOBILE | 780x3396 | 8 | 736px of 768 painted | 67% | weak | DRIFT ONLY (project stores other bytes) |
| 11 | Food order status | FOOD | 10 Cart → 55-style history entry | Follow a placed food order. | GET /api/customer/orders + the order websocket | `features/food/food_order_status_screen.dart` | `e35ee6fd7d` | MOBILE | 780x2888 | 9 | 736px of 768 painted | 52% | sound | keep |
| 12 | Grocery home | GROCERY | 05 Home → 13 Category | Browse grocery categories and products. | GET /api/grocery/products | `features/grocery/grocery_home_screen.dart` | `31999f14ca` | MOBILE | 780x4148 | 24 | 720px of 768 painted | 55% | sound | keep |
| 13 | Grocery category and subcategory | GROCERY | 12 Grocery home → 14 Product | Category then subcategory then product list. | GET /api/grocery/products | `features/grocery/grocery_category_screen.dart` | `e79548564f` | MOBILE | 780x3520 | 37 | 736px of 768 painted | 33% | weak | REBUILD (phone+tablet form) |
| 14 | Grocery product detail | GROCERY | 13 Category → cart sheet | One product: unit, price, quantity, add. | GET /api/grocery/products | `features/grocery/product_detail_screen.dart` | `bf0716ca72` | MOBILE | 780x3350 | 9 | 730px of 768 painted | 33% | sound | keep |
| 15 | Choose a ride | RIDE | 05 Home → 16 (superseded by 43-46) | Choose a vehicle and see the fare. | POST /api/pricing/estimate | `features/ride/ride_select_screen.dart` | `c2ff8ad44f` | MOBILE | 780x3116 | 4 | 730px of 768 painted | 75% | weak | REBUILD (phone+tablet form) |
| 16 | Parcel delivery type and fare | PARCEL | 05 Home → booking confirmation | Delivery type and the parcel fare. | POST /api/pricing/estimate (PARCEL), POST /api/customer/book-parcel | `features/parcel/parcel_fare_screen.dart` | `862cbfde96` | MOBILE | 780x3096 | 10 | 354px of 768 painted | 63% | weak | REBUILD (phone+tablet form) |
| 17 | Processing payment | WALLET | any checkout → the checkout that called it | In-progress payment state. | POST /api/payments/create-order, /api/payments/verify-checkout | `features/payments/processing_screen.dart` | `97d5d31b61` | MOBILE | 780x2400 | 12 | 736px of 768 painted | 81% | weak | REBUILD (phone+tablet form) |
| 18 | Location select | LOCATION | 04 OTP / 05 Home → 19 or 20 | Choose where the order goes. | POST /api/geofence/reverse-geocode | `features/location/location_screen.dart` | `f30ff23452` | MOBILE | 780x2388 | 20 | 728px of 768 painted | 55% | sound | keep |
| 19 | Manual address entry | LOCATION | 18 Location → 21 Confirm | Type an address when the map is not enough. | POST /api/geofence/reverse-geocode | `features/location/address_entry.dart` | `89c5c3f40a` | MOBILE | 780x3372 | 12 | 736px of 768 painted | 83% | weak | REBUILD (phone+tablet form) |
| 20 | Map picker | LOCATION | 18 Location → 21 Confirm | Drop a pin on the OSM map. | OSM tiles only - no key-based SDK | `widgets/nabin_map.dart` | `da0e5e500f` | MOBILE | 780x2464 | 5 | 730px of 768 painted | 50% | weak | DRIFT ONLY (project stores other bytes) |
| 21 | Confirm location | LOCATION | 19 or 20 → 05 Home | Read back the picked place before it is used. | POST /api/geofence/evaluate | `features/location/confirm_location.dart` | `cb48fe1873` | MOBILE | 780x2816 | 9 | 730px of 768 painted | 40% | sound | keep |
| 22 | Saved addresses | LOCATION | 18 Location / 25 → 18 Location | The saved place list. | none - `users` carries a single address column and the auth projection withholds even that; no address-book table or route exists | `features/location/saved_addresses.dart` | `30edb1af75` | MOBILE | 780x2688 | 8 | 736px of 768 painted | 55% | weak | REBUILD (phone+tablet form) |
| 23 | Account profile | ACCOUNT | tab → 24 Edit | Identity hub, links to wallet, activity, settings. | GET /api/auth/me - returns name, phone, email, account and identity status; not dob or address | `features/account/profile_screen.dart` | `5df29f4c89` | MOBILE | 780x3906 | 4 | 720px of 768 painted | 74% | weak | REBUILD (phone+tablet form) |
| 24 | Edit profile | ACCOUNT | 23 Profile → 23 Profile | Change name and photo. | POST /api/customer/profile/photo | `features/account/edit_profile_screen.dart` | `9a3d34c03d` | DESKTOP | 2560x2048 | 15 | 698px of 768 painted | 75% | weak | REBUILD (phone+tablet form) |
| 25 | Account addresses | ACCOUNT | 23 Profile → 18 Location | Manage delivery addresses. | none - same: no address book behind it | `features/account/addresses_screen.dart` | `19e05aa9e6` | DESKTOP | 2560x2048 | 17 | 720px of 768 painted | 76% | weak | REBUILD (phone+tablet form) |
| 26 | Account wallet | WALLET | 23 Profile → 17 Payment | Balance and payment methods. | partial - `users.wallet_balance` is real and is moved by adjust_wallet_atomic, but CUSTOMER_ACCOUNT_PROJECTION (database.js:44) deliberately omits it from every read on the authentication path, so no customer route returns it. The in-memory seed does, which is why the screen looks backed on a dev box and is not on the hosted one | `features/wallet/wallet_screen.dart` | `b63fd35e0b` | MOBILE | 780x2864 | 11 | 736px of 768 painted | 62% | weak | DRIFT ONLY (project stores other bytes) |
| 27 | Account activity | ACTIVITY/HISTORY | tab → 28 History | Recent orders and trips across services. | GET /api/customer/activity | `features/activity/activity_screen.dart` | `9ee35cd3c0` | MOBILE | 780x2644 | 17 | 704px of 768 painted | 55% | weak | REBUILD (phone+tablet form) |
| 28 | Account history | ACTIVITY/HISTORY | 27 Activity → the order detail | Completed rides, food and grocery orders. | GET /api/customer/orders | `features/activity/history_screen.dart` | `5f2819820d` | DESKTOP | 2560x2048 | 5 | 734px of 768 painted | 75% | weak | REBUILD (phone+tablet form) |
| 29 | Account support | SUPPORT | 23 Profile / a problem → ticket thread | Open a help topic or a ticket. | GET /api/support/user/:userId, POST /api/support/ticket | `features/support/support_screen.dart` | `e90caf2373` | MOBILE | 780x2758 | 3 | 734px of 768 painted | 48% | weak | REBUILD (phone+tablet form) |
| 30 | Account settings | SETTINGS | 23 Profile → a sub-setting | Notifications, language, data, about. | GET/PUT /api/notifications/preferences | `features/settings/settings_screen.dart` | `24e3089c7f` | MOBILE | 780x3566 | 8 | 736px of 768 painted | 40% | weak | DRIFT ONLY (project stores other bytes) |
| 31 | Identity verification | IDENTITY VERIFICATION | 23 Profile / a 403 refusal → 23 Profile | Submit documents and see the review state. | POST /api/identity/submit, GET /api/identity/status/:userId | `features/identity/verification_screen.dart` | `4e9151c210` | DESKTOP | 2560x2384 | 29 | 695px of 768 painted | 71% | weak | REBUILD (phone+tablet form) |
| 32 | Account logout | ACCOUNT | 23 Profile → 03 Login | Confirm the customer wants to end the session. | POST /api/auth/logout | `features/account/logout_sheet.dart` | `75c481b8fc` | MOBILE | 780x1768 | 18 | 720px of 768 painted | 60% | weak | REBUILD (phone+tablet form) |
| 33 | Global loading | GLOBAL STATES | any screen → its loaded form | Waiting for data. | n/a - a state, not a feature | `widgets/nabin_loading.dart` | `04d6bb2678` | MOBILE | 780x1838 | 4 | 728px of 768 painted | 47% | sound | keep |
| 34 | Global skeleton | GLOBAL STATES | any list → its filled form | Structure shown before values arrive. | n/a | `widgets/nabin_skeleton.dart` | `52dfbadb32` | MOBILE | 780x2988 | 5 | 723px of 768 painted | 36% | sound | keep |
| 35 | Global empty | GLOBAL STATES | any list → retry or back | Nothing to show, said plainly. | n/a | `widgets/nabin_empty.dart` | `bf0d7736cc` | MOBILE | 780x2492 | 12 | 719px of 768 painted | 79% | weak | REBUILD (phone+tablet form) |
| 36 | Global error | GLOBAL STATES | any screen → 37 Retry | The request failed. | n/a | `widgets/nabin_error.dart` | `18a70964c0` | MOBILE | 780x1768 | 6 | 640px of 768 painted | 64% | weak | REBUILD (phone+tablet form) |
| 37 | Global retry | GLOBAL STATES | 36 Error → the failed load | Ask again. | n/a | `widgets/nabin_error.dart (retry variant)` | `ac939ec89c` | MOBILE | 780x2038 | 1 | 732px of 768 painted | 21% | weak | REBUILD (phone+tablet form) |
| 38 | Global offline | GLOBAL STATES | any screen → same screen | No connection; cached view only. | n/a | `widgets/nabin_offline.dart` | `c636bb15d1` | MOBILE | 780x3346 | 11 | 736px of 768 painted | 72% | weak | REBUILD (phone+tablet form) |
| 39 | Global pending | GLOBAL STATES | a submitted action → its settled state | Accepted, not yet done. | n/a | `widgets/nabin_pending.dart` | `925ace32b9` | MOBILE | 780x3176 | 13 | 724px of 768 painted | 82% | weak | REBUILD (phone+tablet form) |
| 40 | Global unavailable | GLOBAL STATES | a service entry → back | The service is not available here. | GET /api/services/status | `widgets/nabin_unavailable.dart` | `a9ed6feba6` | MOBILE | 780x2876 | 10 | 728px of 768 painted | 56% | weak | REBUILD (phone+tablet form) |
| 41 | Global disabled | GLOBAL STATES | a disabled action → back | Paused or switched off, with when it returns. | a 423 servicePaused response | `widgets/nabin_disabled.dart` | `ba29bc2a38` | MOBILE | 780x2974 | 5 | 732px of 768 painted | 54% | sound | keep |
| 42 | Global confirmation | GLOBAL STATES | a destructive action → yes/no outcome | Ask before it happens. | n/a | `widgets/nabin_confirm.dart` | `33e47c8418` | MOBILE | 780x1768 | 11 | 723px of 768 painted | 47% | sound | keep |
| 43 | Ride home | RIDE | 05 Home / tab → 44 Pickup | Ride front door: pickup, destination, vehicle, estimate. | POST /api/pricing/estimate, GET /api/services/status | `features/ride/ride_home_screen.dart` | `077c2c56e3` | MOBILE | 780x3308 | 7 | 543px of 768 painted | 44% | weak | REBUILD (phone+tablet form) |
| 44 | Ride pickup | RIDE | 43 Ride home → 45 Destination | Where the trip starts. | POST /api/geofence/reverse-geocode | `features/ride/pickup_screen.dart` | `fafd714a57` | MOBILE | 780x3064 | 7 | 728px of 768 painted | 66% | weak | REBUILD (phone+tablet form) |
| 45 | Ride destination | RIDE | 44 Pickup → 46 Fare | Where the trip ends. | POST /api/geofence/reverse-geocode | `features/ride/destination_screen.dart` | `9cd17d8625` | MOBILE | 780x2564 | 13 | 732px of 768 painted | 40% | sound | keep |
| 46 | Ride fare estimate | RIDE | 45 Destination → 47 Confirm | Vehicle choice, price, coupon. | POST /api/pricing/estimate, POST /api/promotions/apply | `features/ride/fare_screen.dart` | `19cfd3afd1` | DESKTOP | 2560x2050 | 19 | 526px of 768 painted | 75% | weak | REBUILD (phone+tablet form) |
| 47 | Ride booking confirmation | RIDE | 46 Fare → 48 Searching | Read the whole booking back before it is sent. | POST /api/customer/book-ride | `features/ride/confirm_booking_screen.dart` | `f23303fa41` | MOBILE | 780x3908 | 11 | 358px of 768 painted | 55% | weak | REBUILD (phone+tablet form) |
| 48 | Ride searching for driver | RIDE | 47 Confirm → 49 Assigned | Looking for a driver; the PENDING state. | the job websocket | `features/ride/searching_screen.dart` | `8e31ea6baf` | MOBILE | 780x1834 | 0 | 721px of 768 painted | 71% | weak | REBUILD (phone+tablet form) |
| 49 | Ride driver assigned | RIDE | 48 Searching → 50 Arriving | DRIVER_ASSIGNED. | the job websocket | `features/ride/assigned_screen.dart` | `b02cb341c4` | MOBILE | 780x2918 | 6 | 736px of 768 painted | 75% | weak | DRIFT ONLY (project stores other bytes) |
| 50 | Ride driver arriving | RIDE | 49 Assigned → 51 Active | DRIVER_ARRIVED. | the job websocket | `features/ride/arriving_screen.dart` | `a3d42f88a4` | MOBILE | 780x3638 | 7 | 736px of 768 painted | 48% | weak | DRIFT ONLY (project stores other bytes) |
| 51 | Ride active trip | RIDE | 50 Arriving → 52 Completed | TRIP_STARTED and DRIVER_LOCATION_UPDATE on the map. | the job websocket | `features/ride/active_trip_screen.dart` | `31dd2e5e43` | MOBILE | 780x3458 | 4 | 703px of 768 painted | 42% | weak | DRIFT ONLY (project stores other bytes) |
| 52 | Ride trip completed | RIDE | 51 Active → 53 Receipt | TRIP_COMPLETED. | the job websocket | `features/ride/trip_completed_screen.dart` | `e4d652be0d` | MOBILE | 780x1768 | 0 | 388px of 768 painted | 55% | weak | REBUILD (phone+tablet form) |
| 53 | Ride receipt | RIDE | 52 Completed → 54 Rate / 55 History | What the trip cost. | the fare fields the booking response carries (`fare`, `discountAmount`, `platformFee`, `appliedPromo`) - a ride job stores no payment state, so `Settlement Method`, `Payment Mode` and `Amount Received` on this receipt describe money the platform never collected | `features/ride/receipt_screen.dart` | `5a42a25994` | MOBILE | 780x2444 | 9 | 736px of 768 painted | 67% | weak | DRIFT ONLY (project stores other bytes) |
| 54 | Ride rating | RIDE | 52 Completed → 55 History | Rate the trip, or decline. | none - drivers carry a rating the dispatch reads, but no customer route accepts one, so this screen can collect a star and cannot send it | `features/ride/rate_screen.dart` | `fe91a5c192` | MOBILE | 780x1768 | 0 | 470px of 768 painted | 36% | weak | REBUILD (phone+tablet form) |
| 55 | Ride history | ACTIVITY/HISTORY | 53 Receipt / tab → 53 Receipt | Past rides. | GET /api/customer/orders | `features/ride/ride_history_screen.dart` | `77073e67e2` | MOBILE | 780x1768 | 0 | 558px of 768 painted | 34% | weak | REBUILD (phone+tablet form) |
| 56 | Food search results | FOOD | 06 Food home → 08 Restaurant detail | Restaurants and dishes matching the search term, filtered by open now. | GET /api/restaurants?search=&openNow= (server.js:6658) | `features/food/food_search_screen.dart - new, no route yet` | `f131efa022` | MOBILE | 780x2020 | 1 | 384px of 768 painted | 45% | weak | REBUILD (phone+tablet form) |
| 57 | Food order confirmation | FOOD | 10 Food cart and checkout → 11 Food order status | The moment the booking is accepted: job id, items, fare paid by wallet or cash. | POST /api/customer/book-food, then GET /api/customer/orders | `features/food/food_order_confirmed_screen.dart - new, no route yet` | `9e3568ddc3` | MOBILE | 780x2680 | 11 | 715px of 768 painted | 31% | sound | keep |
| 58 | Food order completed | FOOD | 11 Food order status → 28 Account history | The finished order and the lines its receipt is made of. | GET /api/customer/orders (server.js:4421) | `features/food/food_order_completed_screen.dart - new, no route yet` | `1aa63662c3` | MOBILE | 780x2590 | 8 | 735px of 768 painted | 60% | weak | REBUILD (phone+tablet form) |
| 59 | Grocery product browse | GROCERY | 13 Grocery categories → 14 Grocery product detail | Products in a category or subcategory, with quantity steppers into the cart. | GET /api/grocery/products?category=&search=&merchantId= (server.js:6449) | `features/grocery/grocery_products_screen.dart (/grocery-products)` | `e691c88550` | MOBILE | 780x2590 | 16 | 723px of 768 painted | 0% | weak | REBUILD (phone+tablet form) |
| 60 | Grocery cart | GROCERY | 59 Grocery product browse → 61 Grocery checkout | Line items and subtotal, and the stock revalidation that runs before checkout. | POST /api/grocery/cart/revalidate (server.js:6956) | `features/grocery/grocery_cart_screen.dart (/grocery-cart)` | `538fdf2260` | MOBILE | 780x3452 | 16 | 736px of 768 painted | 48% | sound | keep |
| 61 | Grocery checkout | GROCERY | 60 Grocery cart → 62 Grocery order confirmation | Address, slot and the two payment methods the platform records. | POST /api/grocery/checkout/validate (server.js:7043) - this call creates the order | `features/grocery/grocery_checkout_screen.dart (/grocery-checkout)` | `360e4ca86e` | MOBILE | 780x3090 | 9 | 736px of 768 painted | 56% | weak | DRIFT ONLY (project stores other bytes) |
| 62 | Grocery order confirmation | GROCERY | 61 Grocery checkout → 27 Account activity | The grocery order the checkout call just created, by job id. | the order snapshot returned by POST /api/grocery/checkout/validate | `features/grocery/grocery_order_confirmed_screen.dart - new, no route yet` | `94525a14f3` | MOBILE | 780x2972 | 17 | 736px of 768 painted | 30% | sound | keep |
| 63 | Parcel home | PARCEL | 05 Customer home super-app → 64 Parcel sender details | Parcel front door: start a booking, and the parcels this account already sent. | POST /api/customer/book-parcel (server.js:4000); GET /api/customer/orders for the list | `features/parcel/parcel_home_screen.dart - new, no route yet` | `c5198bc0d9` | MOBILE | 780x2550 | 19 | 388px of 768 painted | 72% | weak | REBUILD (phone+tablet form) |
| 64 | Parcel sender details | PARCEL | 63 Parcel home → 65 Parcel recipient details | Where the parcel is collected from. | POST /api/customer/book-parcel - senderDetails | `features/parcel/parcel_booking_screen.dart (/parcel-booking, step 1 of 4)` | `72704035ee` | MOBILE | 780x3278 | 8 | 722px of 768 painted | 77% | weak | REBUILD (phone+tablet form) |
| 65 | Parcel recipient details | PARCEL | 64 Parcel sender details → 66 Parcel package details | Who receives it, and the phone the driver calls on arrival. | POST /api/customer/book-parcel - recipientDetails | `features/parcel/parcel_booking_screen.dart (/parcel-booking, step 2 of 4)` | `950bec8c1b` | MOBILE | 780x3298 | 7 | 719px of 768 painted | 0% | weak | REBUILD (phone+tablet form) |
| 66 | Parcel package details | PARCEL | 65 Parcel recipient details → 16 Parcel delivery type and fare | What is in the box and what it is worth. | POST /api/customer/book-parcel; no package field reaches the fare, so the estimate is indicative - see consistency finding A2 | `features/parcel/parcel_booking_screen.dart (/parcel-booking, step 3 of 4)` | `8b8167d833` | MOBILE | 780x3704 | 6 | 726px of 768 painted | 75% | weak | DRIFT ONLY (project stores other bytes) |
| 67 | Parcel booking confirmation | PARCEL | 16 Parcel delivery type and fare → 05 Home / 28 Account activity | The created parcel job: id, indicative fare, and the receiver OTP the driver redeems. | POST /api/customer/book-parcel returns a job with deliveryOtp (server.js:4000) | `features/parcel/parcel_confirmation_screen.dart (/parcel-confirmation)` | `bddda92cb6` | MOBILE | 780x2394 | 16 | 736px of 768 painted | 64% | weak | REBUILD (phone+tablet form) |
| 68 | Notifications inbox | ACCOUNT | 05 Customer home super-app → 69 Notification preferences | The notification list the seeded templates actually produce. | GET /api/notifications (server.js:9057), PUT /api/notifications/:id/read | `features/notifications/notifications_screen.dart - new, no route yet` | `dc2ad656f9` | MOBILE | 780x3380 | 4 | 736px of 768 painted | 67% | weak | REBUILD (phone+tablet form) |
| 69 | Notification preferences | SETTINGS | 30 Account settings → 68 Notifications inbox | Which notification types the customer wants to receive. | GET and PUT /api/notifications/preferences (server.js:9161) - a real read/write pair with no screen until now; overlaps slot 30, which already claims notifications settings | `features/settings/notification_preferences_screen.dart - new, no route yet` | `1b6dbf962d` | MOBILE | 780x3064 | 12 | 726px of 768 painted | 51% | sound | keep |

## Screens that must be redesigned, not recolored

Each carries content the product cannot support. A palette pass would leave the fabrication in place, which is exactly what the brief forbids.


## Screens that only need the phone+tablet rebuild

Honest content, wrong form.

- **Splash** — desktop-chrome
- **Onboarding** — BRAND-HEAVY, RAW-TOKENS
- **OTP verification** — BRAND-HEAVY
- **Customer home super-app** — desktop-chrome, desktop marks
- **Food home** — BRAND-HEAVY
- **Food category and subcategory** — BRAND-HEAVY
- **Restaurant detail and menu** — BRAND-HEAVY
- **Dish detail vosa bai** — BRAND-HEAVY, served != canonical
- **Food cart and checkout** — BRAND-HEAVY, served != canonical
- **Grocery category and subcategory** — RAW-TOKENS
- **Choose a ride** — BRAND-HEAVY, LOW-NEUTRAL, RAW-TOKENS
- **Parcel delivery type and fare** — BRAND-HEAVY, served != canonical, thin tablet column (354px of the 768px painted)
- **Processing payment** — BRAND-HEAVY, LOW-NEUTRAL
- **Manual address entry** — BRAND-HEAVY, LOW-NEUTRAL
- **Map picker** — served != canonical
- **Saved addresses** — desktop-chrome, desktop marks, served != canonical
- **Account profile** — BRAND-HEAVY, desktop-chrome, desktop marks
- **Edit profile** — BRAND-HEAVY, DESKTOP-CANVAS, canvas>1024, device!=MOBILE
- **Account addresses** — BRAND-HEAVY, DESKTOP-CANVAS, LOW-NEUTRAL, RAW-TOKENS, canvas>1024, device!=MOBILE, served != canonical
- **Account wallet** — BRAND-HEAVY, served != canonical
- **Account activity** — LOW-NEUTRAL, RAW-TOKENS
- **Account history** — BRAND-HEAVY, DESKTOP-CANVAS, LOW-NEUTRAL, RAW-TOKENS, canvas>1024, device!=MOBILE
- **Account support** — LOW-NEUTRAL, NO-TABLET, RAW-TOKENS, no tablet composition
- **Account settings** — served != canonical
- **Identity verification** — BRAND-HEAVY, DESKTOP-CANVAS, canvas>1024, device!=MOBILE
- **Account logout** — BRAND-HEAVY, desktop-chrome, desktop marks, served != canonical
- **Global empty** — BRAND-HEAVY, LOW-NEUTRAL
- **Global error** — BRAND-HEAVY
- **Global retry** — NO-TABLET, RAW-TOKENS, no tablet composition
- **Global offline** — BRAND-HEAVY, LOW-NEUTRAL
- **Global pending** — BRAND-HEAVY, LOW-NEUTRAL
- **Global unavailable** — BRAND-HEAVY, RAW-TOKENS
- **Ride home** — RAW-TOKENS, served != canonical, thin tablet column (543px of the 768px painted)
- **Ride pickup** — BRAND-HEAVY
- **Ride fare estimate** — BRAND-HEAVY, DESKTOP-CANVAS, canvas>1024, device!=MOBILE, served != canonical, thin tablet column (526px of the 768px painted)
- **Ride booking confirmation** — RAW-TOKENS, served != canonical, thin tablet column (358px of the 768px painted)
- **Ride searching for driver** — BRAND-HEAVY, LOW-NEUTRAL, NO-TABLET, RAW-TOKENS, no tablet composition, served != canonical
- **Ride driver assigned** — BRAND-HEAVY, served != canonical
- **Ride driver arriving** — RAW-TOKENS, served != canonical
- **Ride active trip** — RAW-TOKENS, served != canonical
- **Ride trip completed** — NO-TABLET, no real tablet adaptation, no tablet composition, served != canonical, thin column on a tablet, thin tablet column (388px of the 768px painted)
- **Ride receipt** — BRAND-HEAVY, served != canonical
- **Ride rating** — NO-TABLET, no tablet composition, served != canonical, thin tablet column (470px of the 768px painted)
- **Ride history** — NO-TABLET, no real tablet adaptation, no tablet composition, thin column on a tablet, thin tablet column (558px of the 768px painted)
- **Food search results** — NO-TABLET, desktop-chrome, no tablet composition, served != canonical, thin tablet column (384px of the 768px painted)
- **Food order completed** — BRAND-HEAVY
- **Grocery product browse** — RAW-TOKENS
- **Grocery checkout** — BRAND-HEAVY, served != canonical
- **Parcel home** — BRAND-HEAVY, LOW-NEUTRAL, RAW-TOKENS, served != canonical, thin tablet column (388px of the 768px painted)
- **Parcel sender details** — BRAND-HEAVY, LOW-NEUTRAL
- **Parcel recipient details** — RAW-TOKENS
- **Parcel package details** — BRAND-HEAVY, LOW-NEUTRAL, RAW-TOKENS, served != canonical
- **Parcel booking confirmation** — BRAND-HEAVY
- **Notifications inbox** — BRAND-HEAVY, desktop-chrome, desktop marks

## What reaches `keep`

`keep` asks three separate tests of the same screen: the stored-screen rules, the painted layout at 390 and 768 CSS pixels, and the content guard. `37` of the 69 canonical screens clear the two responsive axes. `22` of those fail the third, so the number that could ship untouched is `15`.

The responsive work on those screens is finished and stays finished. What is left is content on the ones the guard flags, and on the others the brand axis - colour written as raw hex instead of the pinned tokens, or a page weighted further toward #1A3BA2 than the owner's 40/30/20/10 ratio allows. Neither is fixed by a rebuild that keeps the layout, and neither is a responsive failure, so a document reporting only the two responsive axes would call these 37 finished.

- **Splash** — desktop-chrome, which is a design-system pass rather than a layout one.
- **Onboarding** — BRAND-HEAVY, RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Login phone entry** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **OTP verification** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Food home** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Food category and subcategory** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Restaurant detail and menu** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Food order status** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Grocery home** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Grocery category and subcategory** — RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Grocery product detail** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Choose a ride** — BRAND-HEAVY, LOW-NEUTRAL, RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Processing payment** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Location select** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Manual address entry** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Confirm location** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Account activity** — LOW-NEUTRAL, RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Global loading** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Global skeleton** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Global empty** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Global error** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Global offline** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Global pending** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Global unavailable** — BRAND-HEAVY, RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Global disabled** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Global confirmation** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Ride pickup** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Ride destination** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Food order confirmation** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Food order completed** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Grocery product browse** — RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Grocery cart** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Grocery order confirmation** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.
- **Parcel sender details** — BRAND-HEAVY, LOW-NEUTRAL, which is a design-system pass rather than a layout one.
- **Parcel recipient details** — RAW-TOKENS, which is a design-system pass rather than a layout one.
- **Parcel booking confirmation** — BRAND-HEAVY, which is a design-system pass rather than a layout one.
- **Notification preferences** — nothing: passes the stored rules, both painted breakpoints, the content guard and the brand axis.

## Capability gaps: what these screens show that no customer route returns

- **Onboarding** — *none*: none - static copy
- **Saved addresses** — *none*: none - `users` carries a single address column and the auth projection withholds even that; no address-book table or route exists
- **Account addresses** — *none*: none - same: no address book behind it
- **Account wallet** — *partial*: partial - `users.wallet_balance` is real and is moved by adjust_wallet_atomic, but CUSTOMER_ACCOUNT_PROJECTION (database.js:44) deliberately omits it from every read on the authentication path, so no customer route returns it. The in-memory seed does, which is why the screen looks backed on a dev box and is not on the hosted one
- **Ride rating** — *none*: none - drivers carry a rating the dispatch reads, but no customer route accepts one, so this screen can collect a star and cannot send it
