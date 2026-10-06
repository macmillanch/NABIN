# NABIN Customer — journey and navigation map

69 canonical screens across 14 information-architecture groups. Screen ids and quality come from `CUSTOMER_SCREEN_INVENTORY.md` and `CUSTOMER_SCREEN_AUDIT.md`; this file answers where each screen sits in a journey and what the graph itself says about the navigation.

## The groups

| group | screens |
|---|---|
| AUTH | 01, 02, 03, 04 |
| LOCATION | 18, 19, 20, 21, 22 |
| HOME | 05 |
| RIDE | 15, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54 |
| FOOD | 06, 07, 08, 09, 10, 11, 56, 57, 58 |
| GROCERY | 12, 13, 14, 59, 60, 61, 62 |
| PARCEL | 16, 63, 64, 65, 66, 67 |
| ACTIVITY/HISTORY | 27, 28, 55 |
| WALLET | 17, 26 |
| ACCOUNT | 23, 24, 25, 32, 68 |
| SUPPORT | 29 |
| SETTINGS | 30, 69 |
| IDENTITY VERIFICATION | 31 |
| GLOBAL STATES | 33, 34, 35, 36, 37, 38, 39, 40, 41, 42 |

## Journey chains

### AUTH
- **01 Splash** — Brand hold while the session is restored.  
  in: app root · out: 02, 03
- **02 Onboarding** — Three value slides introducing the super-app.  
  in: 01 · out: 03
- **03 Login phone entry** — Collect the phone number that starts the session.  
  in: 01, 02, 32 · out: 04
- **04 OTP verification** — Verify the six-digit code.  
  in: 03 · out: 05, 18

### LOCATION
- **18 Location select** — Choose where the order goes.  
  in: 04, 22, 25 · out: 19, 20, 21, 22
- **19 Manual address entry** — Type an address when the map is not enough.  
  in: 18 · out: 21
- **20 Map picker** — Drop a pin on the OSM map.  
  in: 18 · out: 21
- **21 Confirm location** — Read back the picked place before it is used.  
  in: 18, 19, 20 · out: 05
- **22 Saved addresses** — The saved place list.  
  in: 18 · out: 18, 25

### HOME
- **05 Customer home super-app** — The super-app front door: location, search, four services, active order, activity.  
  in: 04, 05, 21, 67 · out: 06, 12, 15, 43, 16, 27, 05, 23, 29, 30, 56, 63, 68

### RIDE
- **15 Choose a ride** — Choose a vehicle and see the fare.  
  in: 05 · out: 16, 43
- **43 Ride home** — Ride front door: pickup, destination, vehicle, estimate.  
  in: 05, 15, 48 · out: 44, 55
- **44 Ride pickup** — Where the trip starts.  
  in: 43 · out: 45
- **45 Ride destination** — Where the trip ends.  
  in: 44 · out: 46
- **46 Ride fare estimate** — Vehicle choice, price, coupon.  
  in: 45 · out: 47
- **47 Ride booking confirmation** — Read the whole booking back before it is sent.  
  in: 17, 46 · out: 48
- **48 Ride searching for driver** — Looking for a driver; the PENDING state.  
  in: 47 · out: 49, 43
- **49 Ride driver assigned** — DRIVER_ASSIGNED.  
  in: 48 · out: 50
- **50 Ride driver arriving** — DRIVER_ARRIVED.  
  in: 49 · out: 51
- **51 Ride active trip** — TRIP_STARTED and DRIVER_LOCATION_UPDATE on the map.  
  in: 50 · out: 52
- **52 Ride trip completed** — TRIP_COMPLETED.  
  in: 51 · out: 53, 54
- **53 Ride receipt** — What the trip cost.  
  in: 27, 52, 55 · out: 54, 55
- **54 Ride rating** — Rate the trip, or decline.  
  in: 52, 53 · out: 55

### FOOD
- **06 Food home** — Browse restaurants and dishes by cuisine.  
  in: 05 · out: 07, 08, 09, 10, 56
- **07 Food category and subcategory** — Pick a category then a subcategory.  
  in: 06 · out: 08
- **08 Restaurant detail and menu** — One restaurant: identity, status, its menu.  
  in: 06, 07, 09, 56 · out: 09
- **09 Dish detail vosa bai** — One dish: price, description, add to cart.  
  in: 06, 08 · out: 10, 08
- **10 Food cart and checkout** — Review the basket, apply a coupon, place the order.  
  in: 06, 09, 14, 17 · out: 11, 17, 57
- **11 Food order status** — Follow a placed food order.  
  in: 10, 17, 27, 57, 68 · out: 28, 29, 58
- **56 Food search results** — Restaurants and dishes matching the search term, filtered by open now.  
  in: 05, 06 · out: 08
- **57 Food order confirmation** — The moment the booking is accepted: job id, items, fare paid by wallet or cash.  
  in: 10 · out: 11
- **58 Food order completed** — The finished order and the lines its receipt is made of.  
  in: 11, 28 · out: 28

### GROCERY
- **12 Grocery home** — Browse grocery categories and products.  
  in: 05, 14 · out: 13, 14
- **13 Grocery category and subcategory** — Category then subcategory then product list.  
  in: 12 · out: 14, 59
- **14 Grocery product detail** — One product: unit, price, quantity, add.  
  in: 12, 13, 59 · out: 12, 10, 60
- **59 Grocery product browse** — Products in a category or subcategory, with quantity steppers into the cart.  
  in: 13 · out: 14, 60
- **60 Grocery cart** — Line items and subtotal, and the stock revalidation that runs before checkout.  
  in: 14, 59 · out: 61
- **61 Grocery checkout** — Address, slot and the two payment methods the platform records.  
  in: 60 · out: 62
- **62 Grocery order confirmation** — The grocery order the checkout call just created, by job id.  
  in: 27, 61 · out: 27

### PARCEL
- **16 Parcel delivery type and fare** — Delivery type and the parcel fare.  
  in: 05, 15, 66 · out: 17, 67
- **63 Parcel home** — Parcel front door: start a booking, and the parcels this account already sent.  
  in: 05 · out: 64
- **64 Parcel sender details** — Where the parcel is collected from.  
  in: 63 · out: 65
- **65 Parcel recipient details** — Who receives it, and the phone the driver calls on arrival.  
  in: 64 · out: 66
- **66 Parcel package details** — What is in the box and what it is worth.  
  in: 65 · out: 16
- **67 Parcel booking confirmation** — The created parcel job: id, indicative fare, and the receiver OTP the driver redeems.  
  in: 16 · out: 05, 28

### ACTIVITY/HISTORY
- **27 Account activity** — Recent orders and trips across services.  
  in: 05, 23, 28, 62 · out: 28, 11, 53, 62, 68
- **28 Account history** — Completed rides, food and grocery orders.  
  in: 11, 27, 58, 67, 68 · out: 27, 58
- **55 Ride history** — Past rides.  
  in: 43, 53, 54 · out: 53

### WALLET
- **17 Processing payment** — In-progress payment state.  
  in: 10, 16, 26 · out: 10, 11, 47
- **26 Account wallet** — Balance and payment methods.  
  in: 23 · out: 23, 17

### ACCOUNT
- **23 Account profile** — Identity hub, links to wallet, activity, settings.  
  in: 05, 24, 25, 26, 29, 30, 31 · out: 24, 25, 26, 27, 29, 30, 31, 32
- **24 Edit profile** — Change name and photo.  
  in: 23 · out: 23
- **25 Account addresses** — Manage delivery addresses.  
  in: 22, 23 · out: 23, 18
- **32 Account logout** — Confirm the customer wants to end the session.  
  in: 23 · out: 03
- **68 Notifications inbox** — The notification list the seeded templates actually produce.  
  in: 05, 27, 69 · out: 69, 11, 28

### SUPPORT
- **29 Account support** — Open a help topic or a ticket.  
  in: 05, 11, 23 · out: 23

### SETTINGS
- **30 Account settings** — Notifications, language, data, about.  
  in: 05, 23 · out: 23, 69
- **69 Notification preferences** — Which notification types the customer wants to receive.  
  in: 30, 68 · out: 68

### IDENTITY VERIFICATION
- **31 Identity verification** — Submit documents and see the review state.  
  in: 23 · out: 23

### GLOBAL STATES
- **33 Global loading** — Waiting for data.  
  in: 37 · out: none declared
- **34 Global skeleton** — Structure shown before values arrive.  
  in: app root · out: none declared
- **35 Global empty** — Nothing to show, said plainly.  
  in: app root · out: none declared
- **36 Global error** — The request failed.  
  in: app root · out: 37
- **37 Global retry** — Ask again.  
  in: 36 · out: 33
- **38 Global offline** — No connection; cached view only.  
  in: app root · out: none declared
- **39 Global pending** — Accepted, not yet done.  
  in: app root · out: none declared
- **40 Global unavailable** — The service is not available here.  
  in: app root · out: none declared
- **41 Global disabled** — Paused or switched off, with when it returns.  
  in: app root · out: none declared
- **42 Global confirmation** — Ask before it happens.  
  in: app root · out: none declared


## What the renders actually support

The edges above are the intended graph. This is what the markup gives a customer to walk it with, measured per screen: a bottom bar (a `<nav>` anchored `fixed bottom-0` holding 4 or more buttons - fewer than that is a checkout CTA, not a tab bar) and a back affordance (`arrow_back`/`chevron_left`). An edge I declared is not an edge the screen can traverse, so this is the half that is evidence rather than assertion.

- **Neither a tab bar nor a way back** — a customer who arrives can only use the system gesture: 01, 02, 13, 17
- **Tab surfaces missing the bottom bar** (of 05, 27, 43, 23): none
- **Not tab surfaces that render the app tab bar anyway**, so the customer can tab away mid-flow: 07, 08, 10, 11, 12, 19, 21, 22, 24, 25, 26, 28, 29, 30, 32, 44, 45, 46, 47, 48, 50, 51, 52, 53, 54, 55, 57, 58, 59, 60, 62, 63, 64, 65, 66, 67, 68, 69

## What the graph says

- **Orphans** (no inbound edge from any screen, and not reachable from a tab or boot): none
- **Dead ends** (no outgoing edge declared — a customer who arrives can only press back): none
- **Edges to screens that do not exist**: none
- **Screens no path from a root can reach**: none
- **Global states, excluded from the two findings above** (10 of them, reached by condition): 33, 34, 35, 36, 37, 38, 39, 40, 41, 42
- **Groups containing an unreachable screen**: none


## Navigation fixes this implies

The tab bar is a shared component and the generator applies it everywhere, so the fix is a rule, not a per-screen edit. Splitting the 38 screens that carry it by the harm the bar does there keeps the two halves from being argued together.

- **Harmful — a live trip**: 48, 50, 51, 52. Tapping Home mid-trip leaves the trip running with no exit the customer chose, so these screens need an explicit "end view"/"cancel" action instead of a tab that escapes.
- **Wrong but survivable — browse, forms and settings**: 07, 08, 10, 11, 12, 19, 21, 22, 24, 25, 26, 28, 29, 30, 32, 44, 45, 46, 47, 53, 54, 55, 57, 58, 59, 60, 62, 63, 64, 65, 66, 67, 68, 69. A deep screen repeating the root navigation duplicates the exit the header already offers; the redesign round removes the bar and keeps the back affordance.
- **No defect**: 01 Splash and 02 Onboarding carry neither bar nor back because both are linear and boot into the next screen. 13 is the genuine one: it has neither, so a customer who reaches the grocery category screen cannot leave it by any on-screen path.

