# NABIN Customer — Flutter implementation map

69 canonical designs against the routes `mobile/lib/core/router/app_router.dart` actually registers. Outcomes: 23 exists, 19 new, 27 partial.

The `exists` and `partial` columns name files that are on disk right now. Where a Stitch screen is folded into a bigger Flutter page, that is written out, because the design set gives each state its own screen and the code has to grow a place to render it or the state has nowhere to go.

The `queue` column is the remediation band from `remediation_queue.json` - band 2: 5, band 3: 8, band 4: 8 - so a screen that is ready to build is distinguishable at a glance from one whose design is still being re-asked. Building a Flutter page from a design that still has to be redesigned is the work this column exists to prevent.

## Screen by screen

| slot | screen | journey | Flutter route | widget | file | outcome | queue |
|---|---|---|---|---|---|---|---|
| 01 | Splash | AUTH | /splash | CustomerSplashScreen | `lib/features/home/presentation/screens/customer_splash_screen.dart` | exists | conformant / not queued |
| 02 | Onboarding | AUTH | / | WelcomeScreen | `lib/features/auth/presentation/screens/welcome_screen.dart` | exists | conformant / not queued |
| 03 | Login phone entry | AUTH | /phone-entry | PhoneEntryScreen | `lib/features/auth/presentation/screens/phone_entry_screen.dart` | exists | conformant / not queued |
| 04 | OTP verification | AUTH | /otp-verification | OtpVerificationScreen | `lib/features/auth/presentation/screens/otp_verification_screen.dart` | exists | conformant / not queued |
| 05 | Customer home super-app | HOME | /home | CustomerHomeScreen | `lib/features/home/presentation/screens/customer_home_screen.dart` | exists | band 4 |
| 06 | Food home | FOOD | /food-home | FoodHomeScreen | `lib/features/food/presentation/screens/food_home_screen.dart` | partial - the food home and its search surface are one page | conformant / not queued |
| 07 | Food category and subcategory | FOOD | /food-categories | FoodCategoryScreen | `lib/features/food/presentation/screens/food_category_screen.dart` | partial - category and subcategory are the same screen with a filter | conformant / not queued |
| 08 | Restaurant detail and menu | FOOD | /restaurant-menu | RestaurantMenuScreen | `lib/features/food/presentation/screens/restaurant_menu_screen.dart` | partial - restaurant detail and its menu list are one screen | conformant / not queued |
| 09 | Dish detail vosa bai | FOOD | /dish-detail | DishDetailScreen | `lib/features/food/presentation/screens/dish_detail_screen.dart` | exists | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 10 | Food cart and checkout | FOOD | /food-checkout | FoodCheckoutScreen | `lib/features/food/presentation/screens/food_checkout_screen.dart` | exists | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 11 | Food order status | FOOD | /food-tracking | FoodOrderTrackingScreen | `lib/features/food/presentation/screens/food_order_tracking_screen.dart` | exists | conformant / not queued |
| 12 | Grocery home | GROCERY | /grocery-home | GroceryAppShell | `lib/features/grocery/presentation/screens/grocery_app_shell.dart` | exists | conformant / not queued |
| 13 | Grocery category and subcategory | GROCERY | /grocery-categories | GroceryCategoriesScreen | `lib/features/grocery/presentation/screens/grocery_categories_screen.dart` | exists | conformant / not queued |
| 14 | Grocery product detail | GROCERY | /grocery-product-detail | GroceryProductDetailScreen | `lib/features/grocery/presentation/screens/grocery_product_detail_screen.dart` | exists | conformant / not queued |
| 15 | Choose a ride | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - the superseded ride entry point and 43 Ride home are the same page | conformant / not queued |
| 16 | Parcel delivery type and fare | PARCEL | /parcel-booking | ParcelBookingScreen | `lib/features/parcel/presentation/screens/parcel_booking_screen.dart` | exists | band 3 |
| 17 | Processing payment | WALLET | /payment | PaymentScreen | `lib/features/payment/presentation/screens/payment_screen.dart` | exists | conformant / not queued |
| 18 | Location select | LOCATION | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - location select is a step inside the booking page, not a route | conformant / not queued |
| 19 | Manual address entry | LOCATION | — | — | `—` | new | conformant / not queued |
| 20 | Map picker | LOCATION | — | — | `—` | new | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 21 | Confirm location | LOCATION | — | — | `—` | new | conformant / not queued |
| 22 | Saved addresses | LOCATION | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | partial - saved addresses share that page, and the backend has no address book | band 4 |
| 23 | Account profile | ACCOUNT | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | exists | band 4 |
| 24 | Edit profile | ACCOUNT | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | partial - edit profile is a sheet on the profile page | band 2 |
| 25 | Account addresses | ACCOUNT | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | partial - addresses render inside the profile page | band 2 |
| 26 | Account wallet | WALLET | /wallet | WalletScreen | `lib/features/wallet/presentation/screens/wallet_screen.dart` | exists | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 27 | Account activity | ACTIVITY/HISTORY | /activity | ActivityScreen | `lib/features/activity/presentation/screens/activity_screen.dart` | exists | conformant / not queued |
| 28 | Account history | ACTIVITY/HISTORY | /activity | ActivityScreen | `lib/features/activity/presentation/screens/activity_screen.dart` | partial - history is the same list as activity, filtered | band 2 |
| 29 | Account support | SUPPORT | /support | CustomerSupportScreen | `lib/features/support/presentation/screens/customer_support_screen.dart` | exists | band 4 |
| 30 | Account settings | SETTINGS | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | partial - settings share the profile page | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 31 | Identity verification | IDENTITY VERIFICATION | /identity-verification-submit · /identity-verification-status | IdentityVerificationSubmissionScreen | `lib/features/auth/presentation/screens/identity_verification_submission_screen.dart` | exists - the review-state half of the same design | band 2 |
| 32 | Account logout | ACCOUNT | /profile | ProfileScreen | `lib/features/profile/presentation/screens/profile_screen.dart` | partial - logout is a button on the profile page | band 4 |
| 33 | Global loading | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 34 | Global skeleton | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 35 | Global empty | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 36 | Global error | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 37 | Global retry | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | band 4 |
| 38 | Global offline | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 39 | Global pending | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 40 | Global unavailable | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 41 | Global disabled | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 42 | Global confirmation | GLOBAL STATES | — | — | `—` | new - a shared state widget, not a route | conformant / not queued |
| 43 | Ride home | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - Ride home, pickup, destination, fare and confirmation are one form | band 3 |
| 44 | Ride pickup | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - see 43 | conformant / not queued |
| 45 | Ride destination | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - see 43 | conformant / not queued |
| 46 | Ride fare estimate | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - see 43 | band 2 |
| 47 | Ride booking confirmation | RIDE | /ride-booking | RideBookingScreen | `lib/features/ride/presentation/screens/ride_booking_screen.dart` | partial - see 43 | band 3 |
| 48 | Ride searching for driver | RIDE | /active-ride | ActiveRideScreen | `lib/features/ride/presentation/screens/active_ride_screen.dart` | partial - the waiting states and the trip share one tracking page | band 4 |
| 49 | Ride driver assigned | RIDE | /active-ride | ActiveRideScreen | `lib/features/ride/presentation/screens/active_ride_screen.dart` | partial - see 48 | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 50 | Ride driver arriving | RIDE | /active-ride | ActiveRideScreen | `lib/features/ride/presentation/screens/active_ride_screen.dart` | partial - see 48 | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 51 | Ride active trip | RIDE | /active-ride | ActiveRideScreen | `lib/features/ride/presentation/screens/active_ride_screen.dart` | partial - see 48 | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 52 | Ride trip completed | RIDE | /active-ride | ActiveRideScreen | `lib/features/ride/presentation/screens/active_ride_screen.dart` | partial - see 48 | band 3 |
| 53 | Ride receipt | RIDE | /ride-receipt | RideReceiptScreen | `lib/features/ride/presentation/screens/ride_receipt_screen.dart` | exists | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 54 | Ride rating | RIDE | /ride-receipt | RideReceiptScreen | `lib/features/ride/presentation/screens/ride_receipt_screen.dart` | partial - the rating step renders here and cannot submit - no route accepts it | band 3 |
| 55 | Ride history | ACTIVITY/HISTORY | /activity | ActivityScreen | `lib/features/activity/presentation/screens/activity_screen.dart` | partial - ride history is a filter of the shared activity list | band 3 |
| 56 | Food search results | FOOD | — | — | `—` | new - generated this round | band 3 |
| 57 | Food order confirmation | FOOD | — | — | `—` | new - generated this round | conformant / not queued |
| 58 | Food order completed | FOOD | — | — | `—` | new - generated this round | conformant / not queued |
| 59 | Grocery product browse | GROCERY | /grocery-products | GroceryProductsScreen | `lib/features/grocery/presentation/screens/grocery_products_screen.dart` | exists - the code already had this page | conformant / not queued |
| 60 | Grocery cart | GROCERY | /grocery-cart | GroceryCartScreen | `lib/features/grocery/presentation/screens/grocery_cart_screen.dart` | exists - the code already had this page | conformant / not queued |
| 61 | Grocery checkout | GROCERY | /grocery-checkout | GroceryCheckoutScreen | `lib/features/grocery/presentation/screens/grocery_checkout_screen.dart` | exists - the code already had this page | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 62 | Grocery order confirmation | GROCERY | — | — | `—` | new - generated this round | conformant / not queued |
| 63 | Parcel home | PARCEL | /parcel-booking | ParcelBookingScreen | `lib/features/parcel/presentation/screens/parcel_booking_screen.dart` | partial - the parcel home, sender, recipient and package steps are one page | band 3 |
| 64 | Parcel sender details | PARCEL | /parcel-booking | ParcelBookingScreen | `lib/features/parcel/presentation/screens/parcel_booking_screen.dart` | partial - see 63 | conformant / not queued |
| 65 | Parcel recipient details | PARCEL | /parcel-booking | ParcelBookingScreen | `lib/features/parcel/presentation/screens/parcel_booking_screen.dart` | partial - see 63 | conformant / not queued |
| 66 | Parcel package details | PARCEL | /parcel-booking | ParcelBookingScreen | `lib/features/parcel/presentation/screens/parcel_booking_screen.dart` | partial - see 63 | not queued - drift, see CUSTOMER_REMEDIATION.md |
| 67 | Parcel booking confirmation | PARCEL | /parcel-confirmation | ParcelConfirmationScreen | `lib/features/parcel/presentation/screens/parcel_confirmation_screen.dart` | exists - the code already had this page | conformant / not queued |
| 68 | Notifications inbox | ACCOUNT | — | — | `—` | new - generated this round | band 4 |
| 69 | Notification preferences | SETTINGS | — | — | `—` | new - generated this round | conformant / not queued |

## Routes the design set has no screen for

- `/grocery-deals` → GroceryDealsScreen: a promotions listing. The design rules forbid a customer promotion catalogue because no route returns one, so this page either contradicts that rule or is showing fixture data. It needs the owner's call, not a screen from me.
- `/personalization` → PersonalizationScreen: a step the app renders after login, and no screen describes it.

These are real customer pages with no design behind them, so their treatment is undefined by the design system.

## What has to be built

9 screens need both a route and a page. The `new` outcome counts 19, because the ten global-state screens (33-42) are also `new` - they are one shared widget family rather than ten routes, so they appear under Conventions below instead of in this list. Grouped by journey, because that is how they land in the feature tree:

- **ACCOUNT** — 68 Notifications inbox
- **FOOD** — 56 Food search results; 57 Food order confirmation; 58 Food order completed
- **GROCERY** — 62 Grocery order confirmation
- **LOCATION** — 19 Manual address entry; 20 Map picker; 21 Confirm location
- **SETTINGS** — 69 Notification preferences

## Read this map alongside the queue

21 of the 69 canonical screens are queued for a re-ask. Which Flutter page each one lands on is the reason the two axes matter together:

- **exists** - 5 queued screens (05, 16, 23, 29, 31) already have their own route in Flutter, so their redesign changes what that page has to render, not whether the page exists.
- **partial** - 13 queued screens (22, 24, 25, 28, 32, 43, 46, 47, 48, 52, 54, 55, 63) already have a page that already carries them in Flutter, so their redesign changes what that page has to render, not whether the page exists.
- **new** - 3 queued screens (37, 56, 68) have no route at all, so they are design work and page work at once: the re-ask settles what the screen should look like, and someone still has to build it.

The five capability gaps in `CUSTOMER_SCREEN_AUDIT.md` are deliberately absent from this document as work: a screen for a capability the backend does not have would need a route and a widget invented to hold it, which is the fabrication the queue exists to remove.

## Conventions the new screens inherit

- Feature-first tree: `features/<feature>/presentation/screens/<name>_screen.dart`, with the data layer beside it under `domain/` and `data/`. Customer screens live in this package alongside driver, merchant and admin surfaces, so a new screen takes a `customer_` prefix only where the name would otherwise collide (compare `customer_home_screen.dart` with `driver_home_screen.dart`).
- Routes go on `app_router.dart` as `GoRoute`s with a `path` and a builder; child routes are nested rather than flat, so a booking step keeps its parent on the tree.
- State is Riverpod; navigation is go_router. Neither is introduced differently by any screen in this map.
- Global states (33-42) become one shared widget family that every feature renders in-place - loading, skeleton, empty, error, retry, offline, pending, unavailable, disabled, confirmation - not ten routes. That is the one item on this list that is architecture rather than screen work.

## What this map does not claim

It says which files exist and which do not. It does not say the existing pages are correct: `food_order_tracking_screen.dart` simulates its lifecycle with a timer and `ride` screens of the same vintage carried a fabricated driver (open findings #31 and #34), and a mapping that called them implemented would be describing a defect as done work. Those pages are the redesign target for their slots, not evidence for them.

