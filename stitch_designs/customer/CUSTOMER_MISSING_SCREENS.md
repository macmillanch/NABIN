# NABIN Customer — screens genuinely missing, and the screens that are not

14 screens were missing from the journey map, and 14 of them have now been generated into the project, which holds 69 canonical screens. Each was a step a named journey could not be walked without, and each has a route behind it — listed below with the endpoint and the fields that response returns. Slots 56-69 continue the numbering in `CUSTOMER_SCREEN_INVENTORY.md`; nothing renumbers an existing screen.

Not yet on disk: none.

Read with `CUSTOMER_SCREEN_AUDIT.md`: that file says what is wrong with screens that exist, this one says what did not exist and now does.

## The gaps

| slot | screen | journey | sits between | endpoint the data comes from | render on disk |
|---|---|---|---|---|---|
| 56 | Food search results | FOOD | 06 Food home → 08 Restaurant detail | `GET /api/restaurants?search=&openNow= (server.js:6658)` | yes |
| 57 | Food order confirmation | FOOD | 10 Food cart and checkout → 11 Food order status | `POST /api/customer/book-food (server.js:4167) then GET /api/customer/orders (4241)` | yes |
| 58 | Food order completed | FOOD | 11 Food order status → 28 Account history | `GET /api/customer/orders (server.js:4421); the order snapshot carries an order number, a state, its lines and a final total` | yes |
| 59 | Grocery product browse | GROCERY | 12 Grocery home → 14 Grocery product detail | `GET /api/grocery/products?category=&search=&merchantId= (server.js:6449)` | yes |
| 60 | Grocery cart | GROCERY | 59 Grocery product browse → 61 Grocery checkout | `POST /api/grocery/cart/revalidate (server.js:6956)` | yes |
| 61 | Grocery checkout | GROCERY | 60 Grocery cart → 62 Grocery order confirmation | `POST /api/grocery/checkout/validate (server.js:7043) - this call creates the order` | yes |
| 62 | Grocery order confirmation | GROCERY | 61 Grocery checkout → 27 Account activity | `the order snapshot from POST /api/grocery/checkout/validate (server.js:7043): id, order number, state, lines, final total` | yes |
| 63 | Parcel home | PARCEL | 05 Customer home super-app → 64 Parcel sender details | `POST /api/customer/book-parcel (server.js:4000); GET /api/customer/orders (4241)` | yes |
| 64 | Parcel sender details | PARCEL | 63 Parcel home → 65 Parcel recipient details | `POST /api/customer/book-parcel (server.js:4000), senderDetails field` | yes |
| 65 | Parcel recipient details | PARCEL | 64 Parcel sender details → 66 Parcel package details | `POST /api/customer/book-parcel (server.js:4000), recipientDetails field` | yes |
| 66 | Parcel package details | PARCEL | 65 Parcel recipient details → 16 Parcel delivery type and fare | `POST /api/customer/book-parcel (server.js:4000); the fare step that follows reads the delivery type the package choices narrow` | yes |
| 67 | Parcel booking confirmation | PARCEL | 16 Parcel delivery type and fare → 63 Parcel home | `POST /api/customer/book-parcel (server.js:4000) returns a job with a reference, a fare and a four-digit hand-over code; a repeat send with the same key returns the first booking` | yes |
| 68 | Notifications inbox | ACCOUNT | 05 Customer home super-app → 69 Notification preferences | `GET /api/notifications (server.js:9057), PUT /api/notifications/:id/read (8801), PUT /api/notifications/read-all (8839)` | yes |
| 69 | Notification preferences | SETTINGS | 68 Notifications inbox → 30 Account settings | `GET /api/notifications/preferences (server.js:9143), PUT /api/notifications/preferences (8875)` | yes |

## Why each one is missing

### 56 Food search results

**The brief's food hierarchy runs Home -> Category -> Subcategory -> Restaurant/Dish Browse -> Restaurant Detail. Slots 06, 07, 08 exist and 07 is the category step, so the browse-and-search step is the one missing link: today a customer jumps from a category tile straight into one restaurant with no way to compare or to search.**

Data: `GET /api/restaurants?search=&openNow= (server.js:6658)`

---

### 57 Food order confirmation

**Food checkout (10) is followed directly by an order-status screen (11). The brief asks for Confirmation as its own step, and every other service in the project has one (47 for ride, 42 as a global state). A customer who pays nothing on 10 and lands on a tracker has no moment where the order number is handed to them.**

Data: `POST /api/customer/book-food (server.js:4167) then GET /api/customer/orders (4241)`

---

### 58 Food order completed

**Slot 11 covers the supported in-progress states and the brief ends the food hierarchy at Completion -> Receipt/History. There is no completed screen, so the journey has no end - and slot 28 (history) is a list, not a record.**

Data: `GET /api/customer/orders (server.js:4421); the order snapshot carries an order number, a state, its lines and a final total`

---

### 59 Grocery product browse

**Slot 13 is the category and subcategory step and 14 is one product's detail page. The brief's grocery hierarchy runs Category -> Subcategory -> Product Browse -> Product Detail, and Product Browse is absent - the project has no screen that lists the items in a subcategory, so 14 currently appears out of nowhere.**

Data: `GET /api/grocery/products?category=&search=&merchantId= (server.js:6449)`

---

### 60 Grocery cart

**The revalidate route exists and takes a cart, which proves a grocery cart is a real object in the product, and the brief's hierarchy names it. Slot 10 is a food cart. Grocery has no cart screen at all.**

Data: `POST /api/grocery/cart/revalidate (server.js:6956)`

---

### 61 Grocery checkout

**The route that creates a grocery order exists, and the brief runs Cart -> Address -> Checkout -> Confirmation. Slot 17 is a generic payment screen and 19 is address entry; nothing binds them to a grocery order.**

Data: `POST /api/grocery/checkout/validate (server.js:7043) - this call creates the order`

---

### 62 Grocery order confirmation

**Task #35 already recorded this exact hole - 'grocery has no confirmation'. The call returns an order number and a state, so the confirmation is a screen the backend can actually fill.**

Data: `the order snapshot from POST /api/grocery/checkout/validate (server.js:7043): id, order number, state, lines, final total`

---

### 63 Parcel home

**The whole parcel service hangs off one screen, 16, which is already the delivery-type and fare step. The brief's parcel flow starts at a Parcel Home, so today parcel is the only service with no front door - food has 06, grocery has 12, ride has 43.**

Data: `POST /api/customer/book-parcel (server.js:4000); GET /api/customer/orders (4241)`

---

### 64 Parcel sender details

**The booking call takes sender details as its own object. Nothing in the project collects them, so 16 asks a customer for a fare without ever asking who is sending.**

Data: `POST /api/customer/book-parcel (server.js:4000), senderDetails field`

---

### 65 Parcel recipient details

**Same as 64 on the other end of the journey, and it is the field the hand-over code belongs to: the confirmation gives a code to whoever receives the parcel.**

Data: `POST /api/customer/book-parcel (server.js:4000), recipientDetails field`

---

### 66 Parcel package details

**The brief's parcel hierarchy names Package between Recipient and Delivery Type. Slot 16 jumps straight to fare, so the screen that would justify a fare is missing.**

Data: `POST /api/customer/book-parcel (server.js:4000); the fare step that follows reads the delivery type the package choices narrow`

---

### 67 Parcel booking confirmation

**16 ends at a fare with no confirmation behind it, and the brief's hierarchy ends at Booking Confirmation. This is also where the duplicate-booking behaviour the owner asked to see becomes visible.**

Data: `POST /api/customer/book-parcel (server.js:4000) returns a job with a reference, a fare and a four-digit hand-over code; a repeat send with the same key returns the first booking`

---

### 68 Notifications inbox

**The bottom navigation has a Notifications tab and a full notification API exists - feed, unread filter, category filter, mark-read, mark-all-read, preferences - and not one screen in the project reads it. This is the largest unused real capability in the customer surface, and task #35 has been carrying it as an open finding.**

Data: `GET /api/notifications (server.js:9057), PUT /api/notifications/:id/read (8801), PUT /api/notifications/read-all (8839)`

---

### 69 Notification preferences

**The preferences routes are a real read/write pair with no screen, and the brief lists settings as its own IA group - slot 30 currently offers generic toggles that cannot be wired to anything.**

Data: `GET /api/notifications/preferences (server.js:9143), PUT /api/notifications/preferences (8875)`

---

## Not missing — and why the brief names them anyway

The owner's hierarchy lists these. None of them has a route, a column or a field anywhere in `backend/src` or `migrations/001_central_schema.sql` … `015_school_child_domain.sql`, so designing them would put an affordance on a screen that the product cannot service — the defect the ride batch already had and just spent a round removing.

| candidate | evidence it is not buildable |
|---|---|
| Grocery delivery slot | no `deliverySlot` or `delivery_slot` column, field or route anywhere in backend/src or migrations/001-015. Slot 61 collects an address line and free-text instructions, which is what the checkout call actually accepts. |
| Grocery substitution consent | no substitution field on the inventory rows, the revalidate response or the checkout body. The nearest real signal is the out-of-stock status message, which slot 60 shows instead. |
| A saved-address book (beyond slot 22) | `users` carries one `address` column and no route creates, lists or deletes saved addresses. Slot 22 already exists and overstates that; it is an audit finding for the redesign round, not a reason to add screens. |
| Customer rating submission | no customer-facing route accepts a rating. Slot 54 can collect a star and cannot send it, which the audit records as a capability gap. |
| Ride refusal states as separate screens | already covered inside the flow by slots 43 and 46 - the paused banner with a resume time, the per-area vehicle switch-off, the "Verify your account to book a ride" chip and the rejected-code line - plus global slots 40 and 41. Four more screens would duplicate what those two already render, and every Stitch edit mints a new screen id and strands the old one. |
| Parcel live tracking | no customer-facing tracking read path exists. Slots 63 and 67 use the hand-over code and the PARCEL_PICKED / PARCEL_DELIVERED notice events, which are real. |

## Found while reading, not designed in this pass

These need a decision before they need a screen.

**School-child rides.** Slot 47 asks for a child, a school and a guardian, and nothing in the project lets a customer add or edit one - so the only way to reach the feature is to book a ride. Real routes exist (`GET/POST/PUT/DELETE /api/children`, `GET/POST /api/schools`; a child row carries fullName, gradeClass, guardianName, guardianPhone and a default pickup address with coordinates). Two screens would close it - a children list and an add-child form - and a third would let the ride review step pick from the list instead of typing. This needs the owner's yes or no before it is drawn, because it widens the customer surface beyond the brief.

**Driver contact of any kind.** There is no customer-to-driver messaging route anywhere in the backend - the only message endpoint is `/api/support/ticket/:id/message`. Slot 47 is clean and no ride screen offers a chat, which holds the owner's no-phone rule; it is recorded here because any future parcel or ride screen that reaches for a "message your driver" affordance would be inventing a capability, not designing a gap.

**Slot 69 overlaps slot 30.** Notification preferences has two homes now. Slot 30 Account settings is declared as "Notifications, language, data, about", and slot 69 is a dedicated preferences screen over the same `GET/PUT /api/notifications/preferences` pair. Both are honest - neither invents anything - so this is the duplicate class the brief asks the audit to find, not a missing screen. The owner decides which way it resolves: 30 keeps a single "Notifications" row that opens 69 (the deep-link reading, and the one the settings screen already implies), or 30 absorbs the toggles and 69 goes away. This pass generated 69 because the preference routes had no screen at all; merging is a redesign of 30, which is already on the #45 list for other reasons.

## One backend finding this pass surfaced

`POST /api/customer/book-parcel` prices every parcel from `distanceKm: 6.1, durationMins: 18` (server.js:3913-3917) and falls back to Delhi addresses for sender and receiver when the body omits them (:3953-3954). So the distance and duration a parcel screen shows are not measured from the addresses the customer typed. Task #32 already tracks that as a backend defect; here it constrains the designs — slots 63-67 never phrase distance or duration as a property of the customer's own route.

That is a UI constraint, not a licence to fix the backend: this assignment changes no server code.

