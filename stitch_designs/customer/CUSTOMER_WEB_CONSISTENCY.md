# NABIN Customer — Customer Web consistency findings

Deliverable 9 of the Customer audit. `customer-web/` is the **product** reference for this design set — features, terminology, categories, hierarchy, workflows, statuses, business meaning. It is not a layout reference: the brief forbids copying desktop layouts, so this document never compares visual structure.

Every line citation is re-read from disk when this document is generated, and the generator refuses to write if any has moved. Regenerate with `web_consistency_doc.py` in the Stitch working directory.

## What the web surface is

Next.js 16.3.8 + React 19.2.8, App Router, 8 flat routes: `/`, `/food`, `/grocery`, `/login`, `/orders`, `/parcel`, `/profile`, `/ride`.
Primary nav is Ride · Food · Grocery · Parcel with Orders and Profile on the right (`customer-web/src/components/Header.tsx:8`).

The service set, their order and their single-word names match the mobile set exactly. Everything below is a divergence.

---

## A. Where the mobile design set is wrong — fix the designs

### A1. UPI is not a payment method this platform has

The backend records exactly two methods, and it does so by coercion, not validation:

```js
// backend/src/server.js:6891  (grocery checkout)
paymentMethod: req.body.paymentMethod === 'CASH' ? 'CASH' : 'WALLET',
```

The web offers precisely those two — `customer-web/src/app/grocery/page.tsx:23` and `customer-web/src/app/grocery/page.tsx:24`. On the food checkout it offers neither: `paymentMethod` appears nowhere in `customer-web/src/app/food/page.tsx`, so a web food order is recorded as a wallet order without anyone having chosen it.

This finding was raised on **12 of the design set's screens** (05, 06, 10, 11, 14, 15, 16, 17, 21, 28, 32, 68); 12 of them have since been rebuilt and none names one now.
5 went past naming a method into inventing financial artefacts:

| slot | what the screen asserted | why it is false |
|---|---|---|
| 10 | A selected UPI control, plus "Zero transaction fee / Instant UPI refund in case of cancellation" | no fee table and no customer refund route exists |
| 11 | "Payment verified via UPI / Transmitted directly to Kapam Kitchen" and "Paid via GooglePay UPI - **Trans ID: UPI/84920194**" | a fabricated transaction identifier, shown as payment proof |
| 14 | "Payment partners: UPI / RuPay / Visa / Cash on Delivery" | an invented acquirer list, on a product detail page |
| 16 | "Prepaid via UPI (PhonePe)" and "**Txn ID: UPI/2610/94827104**" | a fabricated transaction identifier |
| 17 | "The local hill cellular relay is synchronizing encrypted settlement with your UPI provider" and a gateway id `HDFC-UPI-MZ-ROUTER-04` | settlement infrastructure that does not exist |

**Status, measured when this document was written:** None of these 5 screens carries the line quoted above any more. Each was rebuilt rather than relabelled, because the artefact itself — a transaction identifier, an acquirer list, a settlement claim — has no field to bind to, and a relabelled screen would keep the shape of the invention while changing its noun.

The other 7 named UPI as a method or asserted it in past-tense transaction copy — "₹345 paid via UPI" on 05 Customer home super app (in the archive); "UPI &amp; Cash on Delivery" on 06 Food home (in the archive); "Google Pay UPI" on 15 Choose a ride (in the archive); "(or UPI QR)" on 21 Confirm location (in the archive). So this was systemic chrome, not one bad screen; none of them still carry it.

**Fabricated financial identifiers are a distinct severity from a wrong method label.** A customer who read `Trans ID: UPI/84920194` on a food order status believed they held a payment reference no system can confirm, and a support ticket about it could not be resolved.

This class has a check. `audit_all.py` scans every design for the whole rail vocabulary (UPI, RuPay, card networks, wallet providers, bank names) and flags it as `unsupported-payment-rail`; asserted on every screen, not only ride screens, because the platform can charge on exactly the two methods the backend coerces to and no screen anywhere may name a rail it cannot bill on. That rule is run over the current folder here rather than quoted from the audit's last output: it finds a rail on 0 of the 69 designs on disk. Nothing on disk names one, and the word-UPI scan is empty with it.

What the check buys is that the class stays closed: every audit pass re-runs the rule over every design, so a rail name that returns to a screen is caught by the next run rather than by someone re-reading sixty-nine screens by hand.

**Action:** 10, 11, 14, 16, 17 were redesigned rather than relabelled — a label swap cannot fix them, because the payment proof itself was invented. Nothing on disk now names a rail: every payment row says CASH or WALLET and no screen asserts a completed transaction the platform cannot record.

### A2. A fare estimate the fare cannot vary

Parcel price is not computed from anything the customer enters. `distanceKm: 6.1` is one of three literal inputs at `backend/src/server.js:3915`, and the booking body destructures only `{ customerId, senderDetails, recipientDetails, promoCode }` (`backend/src/server.js:3883`) — there is no package or delivery-type field.

Slots 16 (Parcel delivery type and fare) and 66 (Parcel package) therefore present choices that provably change nothing. Keep the screens — the brief asks for a booking-oriented parcel journey — but the fare on them must read as an indicative platform figure, never as a quote derived from the package.

### A3. The design set must not adopt the web's demo coupon

`placeholder="e.g. NABIN50"` suggests the code `NABIN50` to users. That string exists nowhere under `backend/src` (verified absent). Mobile must not copy it: the brief forbids invented demo codes, and A1 is the evidence of what happens when a placeholder is treated as a capability.

### A4. Reference codes in formats no API can return

0 designs across 0 journeys show a booking, verification or reference code in a branded format the platform never mints: .

The only identifiers the customer side can actually receive are job ids, minted as `` id: jobData.id || `JOB-${Date.now().toString().slice(-8)}-${Math.floor(100 + Math.random() * 900)}` `` (`backend/src/database.js:3928`) — i.e. `JOB-` plus the last eight digits of a timestamp and three more — and request ids, minted as `req_${...}` (`backend/src/server.js:274`) and returned as `requestId`. The booking response hands the whole job object back to the customer (`backend/src/server.js:4001`), so `job.id` is on the wire and there is nothing to invent.

| what the screens print | example | slots |
|---|---|---|

None of these formats exists in `backend/src`. A customer quotes a booking reference to support, support searches a job id, and the string on the screen matches nothing in the system — the same failure mode as A1's `Trans ID`, one severity down. It also costs real work at build time: `job.id` is the field Flutter must render, so every one of these frames has to be corrected before it becomes a screen, not after.

The fix is one rule, not 0 redesigns: print `job.id` verbatim, and if a shorter human-friendly reference is wanted later it must be a field the backend actually mints. Each entry above is an uppercase, hyphen-branded key ending in a digit run; the 0 families are the whole list, which is why one rule covers them. Slot 21 was worse than a format problem — it printed an idempotency key (`IDEMP-RIDE-…`) as customer UI, and the real keys are internal (`ride_coupon:${...}` at `backend/src/server.js:3750`).

**Status, measured at the time this document was written:** All 13 screens above now print a reference in a shape the platform mints, and `ref_formats()` finds no design inventing a code. The two that needed no reference at all — the idempotency key on 21 and the cache identifier on 38 — were deleted rather than replaced.
But read that count as a measurement of the mirror, not of Stitch: 4 of them (48, 52, 53, 54) were landed in the canonical render from the DOM operations the edit call reported, and the call never returned a design for those screens. It returned a `project.file_update` event carrying one operation — a selector, the new text, and the HTML context it had matched — which is an instruction for the Stitch client. Nothing consumed it, and the screen kept the same `htmlCode` file and the same old reference across two re-reads. So the project still shows the invented code on those screens, and closing the gap takes the same sentence applied in the Stitch UI rather than another API call.

### A5. A wallet the app can choose and cannot show

`paymentMethod: req.body.paymentMethod === 'CASH' ? 'CASH' : 'WALLET'` (`backend/src/server.js:6891`) is the whole payment contract on a food or grocery order: the call keeps CASH if the caller sends CASH and calls everything else WALLET. "NABIN Wallet" is therefore a real, stored choice. What does not exist is any way for the customer app to see money in it. Parsed out of the live server, the routes registering a path that mentions a wallet are `none` — not none because nobody thought about it, but because the only balances the code holds are driver balances, and the admin reads that expose balances were themselves gated as "admin sessions only" (`backend/src/server.js:1721`).

The consequence for the design set is precise, and it is what A1 kept missing: a wallet row may be *selectable*, and may show nothing else. No balance figure, no top-up link, no "insufficient wallet balance" state, no "₹320 refunded to your NABIN Wallet" line. Slot 17 is the other half of the same gap: the payment session is the platform's own (`backend/src/server.js:7727`, `backend/src/server.js:7830`, `backend/src/server.js:7852`), created at `const session = { orderId, customerId: customerId || 'usr_cust_anon', amount: Number(amount), currency, serviceType, jobId, status: 'PAYMENT_PENDING' };` (`backend/src/database.js:8566`) and answered `return { success: true, session, status: 'PAYMENT_SUCCESS' };` (`backend/src/database.js:8580`) — three states, pending and success and failed, with no bank, no rail, no gateway and no settlement step anywhere in the path. A processing screen that names an issuer or prints a UTR is inventing the machinery, not describing a wait.

**Action:** treat "NABIN Wallet" as a label for a choice, not a surface for money. Whether the wallet should become a funded customer balance is a backend decision the design set cannot make, and if it stays unfunded the label itself should be reconsidered before Flutter builds it.

### A6. Two bill lines the charge does not include

The order call re-prices the cart from the database and totals the lines (`totalAmount: Math.round(computedTotal * 100) / 100` at `backend/src/repositories/OrderRepository.js:210`), then subtracts only a coupon it redeemed itself (`backend/src/server.js:6883` for grocery, `backend/src/server.js:4142` for food). That figure is what the customer is billed. And yet the food order response also carries `packagingFee: 15` and a 5% `gst` alongside it (`backend/src/server.js:4224`) — two amounts `total_amount` does not contain.

A checkout drawn from that payload has two ways to be wrong: print the packaging and GST lines and the bill no longer sums to the charge, or leave them out and the screen contradicts the API it just read. The designs take the charged lines only, because the customer is charged those, and the mismatch is recorded here as a backend finding rather than designed around. No fee, tax, handling or surcharge line belongs on a NABIN bill until the order call actually adds it.

### A7. The three references a customer screen may print, and the shapes they have

13 designs were recorded printing a reference no route can return — `MZ-RD-94820`, `MZ-GR-78210`, `MZ-PRC-84920`, `MZ-KYC-94361`, `IDEMP-RIDE-94820`, `MZ-CACHE-0922`. Flutter built from any of them renders a string that will never occur, and a customer who quotes it to support describes nothing. The product mints exactly three identifiers the customer side can hold:

* a **job number** for a ride or a parcel, `id: jobData.id || `JOB-${Date.now().toString().slice(-8)}-${Math.floor(100 + Math.random() * 900)}`` (`backend/src/database.js:3928`, and the same expression in the repository at `backend/src/repositories/JobRepository.js:210`) — `JOB-` then 8 digits then 3, and it is the value the dispatch layer itself emits as `job_id` (`supabase/migrations/020_dispatch_security_atomic.sql:181`), so the number on the receipt is the number the events carry;
* an **order number** for food and grocery, `v_order_number := 'ORD-' || lpad(nextval('public.order_number_seq')::TEXT, 8, '0');` (`supabase/migrations/019_order_creation_atomic.sql:543`) — `ORD-` then a zero-padded sequence, written by the order-creation function, with the line prices beside it snapshotted into the order rather than left pointing at the catalog;
* an **application reference** on the identity screen, minted when the person submits documents — `APP-${Math.floor(1000 + Math.random() * 9000)}` (`backend/src/database.js:3497`) — and handed back to them on the status route (`backend/src/server.js:3508`); the seeded record the demo path shows carries `id: 'APP-9021'` (`backend/src/database.js:175`).

None of the three is a field a client gets to write. The submit route parses a body with no identifier in it (`backend/src/server.js:3414`) and mints one; and two of the three are then frozen against a later rewrite by migration 024, which keeps a write-once list per table — `job_number` in the `jobs` list (`supabase/migrations/024_application_surface_security_hardening.sql:230`), `order_number` and `items_snapshot` in the `orders` list — inside a function that states its own reason:

```sql
-- supabase/migrations/024_application_surface_security_hardening.sql:221
    -- Write-once columns. Every entry is set by JobRepository.create() and is
    -- never reassigned by any later application path (verified by audit):
    --   identity  -> job_number, service_type, customer_id, driver_id, merchant_id
    --   money     -> final_total, fare_subtotal, driver_earnings,
```

and the violation raises, rather than quietly dropping the field a client tried to write:

```sql
-- supabase/migrations/024_application_surface_security_hardening.sql:253
    IF new_value -> col IS DISTINCT FROM old_value -> col THEN
      RAISE EXCEPTION
        'Financial/OTP column %.%.% is immutable after creation (attempted by role %).',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, col, current_user
```

The snapshot beside the order number is the column itself: `items_snapshot JSONB DEFAULT '[]'::jsonb,` (`supabase/migrations/018_order_state_lines_and_checkout_linkage.sql:31`), which the order-creation function fills from the price and name it read at order time. That is what makes a receipt line a fact instead of a live query — and it is why the reference on the screen has a real field to bind to.

Two of the six codes above get no replacement, because they were never customer-facing: an idempotency key is how a retry is deduplicated, and a cache identifier is how a client diagnoses a stale read. Neither belongs in a customer's line of sight, and the honest fix is deletion, not a swap.

**Action:** one booking keeps one reference across every screen of it — that continuity is what made a stable-looking code attractive in the first place, and it is achievable with the real shape. A Flutter screen may bind these fields directly; it may not format one.

---

## B. Where the web is wrong — do not copy it

### B1. Every sample address is Delhi

6 input placeholders name Delhi or a Delhi locality, namely `customer-web/src/app/parcel/page.tsx:146`, `customer-web/src/app/parcel/page.tsx:179`, `customer-web/src/app/ride/page.tsx:179`, `customer-web/src/app/ride/page.tsx:195`, `customer-web/src/app/food/page.tsx:525`, `customer-web/src/app/grocery/page.tsx:193`. NABIN is an Aizawl/Mizoram product. The mobile set must not inherit a single one, and the backend is worse: the parcel route's own fallback addresses are Delhi (open finding #32; not fixable by design work).

### B2. The brief's coupon premise is wrong in both directions

The brief calls `NABINFIRST50` and `FESTIVAL30` "known seeded examples". Neither half of that holds. `code: 'NABINFIRST50'` at `backend/src/database.js:623` is real: PERCENTAGE 50, cap ₹100, minimum ₹80, **RIDE-only**. `code: 'FESTIVAL30'` at `backend/test_suite.js:392` is not product data at all — the test suite creates it through the admin API to exercise the redemption path.

And `NABINFIRST50` is not the only seeded row: the in-memory fallback carries three promotions — also `code: 'DELHIFOOD'` (`backend/src/database.js:646`, a flat ₹50 **FOOD** coupon over ₹250) and `code: 'AIRPORTDELHI'` (`backend/src/database.js:669`, an airport-drop ride voucher). Two of the three name Delhi, which rules them out of an Aizawl product whatever else is true of them, and the fallback only answers when PostgreSQL is unreachable. On the durable path the `backend/migrations/001_central_schema.sql:253` table is created (`backend/migrations/001_central_schema.sql:253`), indexed (`backend/migrations/009_promotions_domain.sql:32`) and never seeded — verified absent across every migration — so a code redeems only if an admin has made one.

What that changes is the reasoning, not the design. A promo field on a food, grocery or parcel screen is not a field that can only fail: `const foodCouponCode = req.body.couponCode || req.body.promoCode || null;` at `backend/src/server.js:4122` is redeemed with `service: 'FOOD'`, and the FOOD-eligible seeded row would accept it. Nor is there a catalogue to show: the customer-facing route (`backend/src/server.js:2600`) takes a code the person already has, and the only list of codes is admin-authenticated (`backend/src/server.js:2534`). So the screen prints the field and the rejection line the server actually returns, names no code, and promises nothing about whether the next one will work. `Promotional Broadcast` is an inbound notification (backend/migrations/012_notifications_domain.sql), not a browse page — the product's own promotion surface corroborates the ruling.

### B3. A ride status vocabulary that is not the job status

`const SPLASH: Record<string, string> = {` maps six keys at `customer-web/src/app/ride/page.tsx:29`. `ACCEPTED`, `SEARCHING` and `STARTED` are not ride job statuses: `ACCEPTED` exists in the backend only as a **merchant kitchen display** state (`backend/src/server.js:4486`), and the other two exist nowhere as a status or an event. The real vocabulary is the brief's — job statuses PENDING / ASSIGNED / COMPLETED / CANCELLED, and tracking events DRIVER_ASSIGNED, DRIVER_ARRIVED, DRIVER_LOCATION_UPDATE, TRIP_STARTED, TRIP_COMPLETED.

The mobile set may render only those. Note what the vocabulary papers over: the web never resolves it into a screen. `customer-web/src/app/ride/page.tsx:133` and its three siblings are the entire tracking affordance.

### B4. Order statuses shown raw, against a vocabulary the customer never sees

`customer-web/src/app/orders/page.tsx:104` prints the enum straight into a badge, so a job status reaches the customer as a database identifier. The deeper problem is which statuses designers reach for: `PREPARING` and `PACKING` occur in the backend only inside `const APPROVED_KDS_STATES = ['ACCEPTED', 'REJECTED', 'PREPARING', 'PACKING', 'READY_FOR_PICKUP'];` — a **merchant kitchen display** list. A customer "Packing" screen built on them would render a state no customer route ever returns.

The only customer-facing lifecycle wording in this product is the seeded notification template set (`backend/migrations/012_notifications_domain.sql`, parsed at generation time — 17 types, titles verbatim):

| type | the title the product already uses |
|---|---|
| `RIDE_BOOKED` | Ride Confirmed |
| `DRIVER_ASSIGNED` | Driver Assigned |
| `DRIVER_ARRIVING` | Driver Arriving |
| `RIDE_STARTED` | Ride in Transit |
| `RIDE_COMPLETED` | Ride Completed |
| `PARCEL_PICKED` | Parcel Picked Up |
| `PARCEL_DELIVERED` | Parcel Delivered |
| `FOOD_PREPARING` | Food in Kitchen |
| `FOOD_OUT_FOR_DELIVERY` | Food Out for Delivery |
| `PAYMENT_SUCCESS` | Payment Received |
| `PAYMENT_FAILED` | Payment Failed |
| `WALLET_CREDIT` | Wallet Credited |
| `WALLET_DEBIT` | Wallet Debited |
| `SUPPORT_CREATED` | Support Ticket Created |
| `SUPPORT_MESSAGE` | Support Message Received |
| `SUPPORT_RESOLVED` | Support Ticket Resolved |
| `PROMO_BROADCAST` | Promotional Broadcast |

So the order-state screens have **two** vocabularies to reconcile and may extend neither: the job statuses (PENDING / ASSIGNED / COMPLETED / CANCELLED) for the list and detail chrome, and these titles for anything the customer is told happened. Mobile must map every status it can receive to a human label and never render an unknown one as a code.

### B5. "Live driver tracking" as a promise, with no tracking surface

The home card sells "Bike, auto and cab trips with live driver tracking" (`customer-web/src/app/page.tsx:21`). The ride page has no tracker, no map and no event consumer; it books a job and defers to My orders. Mobile has the tracking screens (48–52) and the real DRIVER_LOCATION_UPDATE event, so mobile is ahead. The web copy is an over-promise.

### B6. An orphaned map stylesheet block

`.nabin-map` and `.nabin-map .leaflet-container` are defined at `customer-web/src/app/globals.css:917-931` and used by no component. It does **not** corroborate mobile slot 20 (map location picker): a web map existed once or was planned, and there is no live one.

### B7. "Dark stores are not supported"

`setFailure("Enter the store ID. Dark stores are not supported.");` is user-facing copy at `customer-web/src/app/grocery/page.tsx:50`. The repository simultaneously carries a committed "Instamart dark store foundation" checkpoint. Which is true is an owner decision — already open as the dark-store scope conflict — but shipping copy that asserts the negative is new evidence that the product has taken the "not supported" line so far.

### B8. Parcel does have a lifecycle — just not a live one

The brief says not to invent parcel tracking "unless actual backend support is established later". It has been, and it is narrower than it sounds: `Parcel Picked Up` and `Parcel Delivered` are seeded notification types (`backend/migrations/012_notifications_domain.sql`), so a parcel journey may truthfully show picked-up and delivered, driven by the notification the customer actually receives. What it may not show is a map, an ETA or a driver position: `backend/src/server.js:3883` creates a job and offers it to drivers, and no customer route returns parcel positions. Slot 67 and any parcel history state should use exactly those two titles.

The hand-off code the parcel screens print is real too, which is worth stating because it looks like an invention. Every parcel booking mints a four-digit delivery OTP at `backend/src/server.js:3962`: `deliveryOtp: Math.floor(1000 + Math.random() * 9000).toString()`, the booking response returns the whole job to the customer (`backend/src/server.js:4001`), and the driver redeems it at `backend/src/server.js:5319` against `expectedOtp = job.deliveryOtp || null;` (`backend/src/database.js:8175`). So slot 63 "Code the receiver reads out" and slot 67 "the receiver gives the code ... so the parcel is marked delivered" describe a verified flow, not a decorative PIN. Two cautions: the digits must come from the booking response rather than being typeset, and the code is shown to the customer only — the driver-facing screen is where it is entered.

### B9. The brief's event names are a paraphrase of the product's

The brief lists DRIVER_ASSIGNED, DRIVER_ARRIVED, DRIVER_LOCATION_UPDATE, TRIP_STARTED, TRIP_COMPLETED. The product seeds `Driver Arriving` as DRIVER_ARRIVING (not DRIVER_ARRIVED) and RIDE_STARTED / RIDE_COMPLETED (not TRIP_STARTED / TRIP_COMPLETED). Where the brief and the product word the same thing differently, **the product wins in customer-facing copy** — a design that inherits the brief's words yields a UI no notification can match. DRIVER_LOCATION_UPDATE is real and unconflicted: it is telemetry on the socket (`backend/src/server.js:505`), not a notification type.

---

## C. Same concept, different words — pick one, per row

| Concept | Web | Mobile design set | Ruling |
|---|---|---|---|
| The order list | "Orders" in the nav (`customer-web/src/components/Header.tsx:15`), "My orders" as the page title (`customer-web/src/app/orders/page.tsx:66`), and again on Profile | One history/activity destination | **My orders** everywhere; the nav label is the outlier |
| Ending the session | "Sign out" (`customer-web/src/components/Header.tsx:53`) against "Log out" (`customer-web/src/app/profile/page.tsx:98`) in the same product | One logout sheet (slot 32) | **Log out** |
| Vehicle words | "cab" in the marketing card (`customer-web/src/app/page.tsx:21`) against "Taxi" in the picker (`customer-web/src/app/ride/page.tsx:26`) | TAXI is the API enum | **Taxi** in UI; never "cab" |
| Food taxonomy | One flat level, derived from the menu itself (`customer-web/src/app/food/page.tsx:172`) and filtered with chips. `subcategory` appears nowhere in the web source | Category → subcategory → browse, per the brief | **Unresolved — D1** |

---

## D. Hierarchy: the two products sit at different depths

### D1. Food taxonomy — the brief asks for a level the data does not have

A dish's only category is `menu[].category`, one flat string per item, read straight off `customer-web/src/app/food/page.tsx:172`; the web derives its filter chips from it and has no subcategory word anywhere (`subcategory` is absent from `customer-web/src`). The mobile brief mandates Category → Subcategory → Dish browse as three distinct screens, so a subcategory screen can only be built on a taxonomy the platform does not store.

**The design may show the level; no screen may assert a subcategory count or a curation the API cannot return.** This is the grocery twin of open finding #27. Owner decision: accept one level, or fund a taxonomy in the merchant domain.

### D2. Grocery — mobile has the whole journey, the web has none of it

The web says so outright: `customer-web/src/app/grocery/page.tsx:87`, with a typed store-id field (`customer-web/src/app/grocery/page.tsx:135`) as its only entry. Mobile has grocery home (12), categories (13), product browse (59), product detail (14), cart (60), checkout (61) and confirmation (62), with real endpoints behind them (`backend/src/server.js:6229` and the order-creating `backend/src/server.js:6774`). **The web is simply behind; nothing in the mobile set should change because of it.**

### D3. Parcel — one web form against a five-step mobile journey

The web collects six fields on one screen: pickup (`customer-web/src/app/parcel/page.tsx:137`), sender, drop, recipient, recipient phone, contents (`customer-web/src/app/parcel/page.tsx:217`); then shows a booked result with the fare after the fact (`customer-web/src/app/parcel/page.tsx:91`, `customer-web/src/app/parcel/page.tsx:109`). Mobile splits the same information into home → sender → recipient → package → confirmation (63–67), which is what the brief asks for. The two mobile steps with no web counterpart are package and delivery type — see A2 for why neither can affect price today.

### D4. Identity verification — the web defers to mobile, correctly

The web maps five real states (`const IDENTITY: Record<string, { label: string; tone: string; note: string }> = {` at `customer-web/src/app/profile/page.tsx:8`: VERIFIED, IDENTITY_VERIFICATION_PENDING, UNDER_REVIEW, RESUBMISSION_REQUIRED, REJECTED) and for the penultimate one says `customer-web/src/app/profile/page.tsx:23`. So submission belongs to the app: slot 31 is the only design that covers it, and Flutter is right to split it into `/identity-verification-submit` and `/identity-verification-status`. **Adopt those five labels verbatim** — they are the only customer-facing wording for that state machine in the product.

### D5. Three history surfaces where the product has one read path

The web has a single orders page, `customer-web/src/app/orders/page.tsx:66`, backed by one endpoint (`backend/src/server.js:4241`). The mobile set carries three screens in the same IA group: 27 Account activity, 28 Account history and 55 Ride history. The brief does group ACTIVITY/HISTORY together, so the pair 27/28 is already a candidate duplicate in the navigation deliverable; the third is the one this comparison catches, because there is no `GET /api/customer/orders?service=RIDE` — a filtered view is a client-side filter over the same rows.

Ride history earns its place — a ride is searched by trip, and the receipt lives on the job — but as a **filter of the shared history, not a second source**. Design it so: same rows, same status labels, a scope control that reads visibly as filtered, and a back affordance that returns to the unfiltered list. Nothing on it may imply a dataset only rides belong to.

---

## E. Surfaces one side has and the other lacks

| Surface | Backend | Web | Mobile design set | Read |
|---|---|---|---|---|
| Notifications | Real: `GET /api/notifications` `backend/src/server.js:9057`, plus read, read-all and preferences | None: `/api/notifications` appears nowhere in `customer-web/src`, and no `/notifications` route | 68 inbox, 69 preferences (generated this round) | The largest unused capability in the product, and mobile is the only side building it |
| Wallet | Real balance and ledger | No `/wallet` route; wallet appears only as a payment choice (`customer-web/src/app/grocery/page.tsx:24`) | Route `/wallet` and slot 26 | Mobile-only surface |
| Support | Three real ticket endpoints | No `/support` route — only the prose at `customer-web/src/app/profile/page.tsx:28` | Slot 29 | Mobile-only surface |
| Address book | **No route** | None | Slot 25, folded into Profile | Correctly absent on both sides |
| Deals / promotions | No customer catalogue route | None | Flutter route `/grocery-deals` | Code ahead of both the API and the design rules — owner decision, carried in the Flutter map |
| Personalisation | — | None | No design | Flutter route with nothing behind it |

Checked against the filesystem: none of `/wallet`, `/support`, `/notifications`, `/activity` is a web route, so the mobile set is the only place those surfaces will exist. That is a scope fact, not a defect — the brief scopes this project to Customer mobile.

---

## F. Checked and consistent — no action

- Currency: INR with ₹ on both surfaces.
- Phone format: +91 on both sides (`customer-web/src/app/parcel/page.tsx:210`).
- The four services: same set, same order, same names.
- Payment method *names* where the web offers them match the two the backend can record.
- Promo is an optional free-text field on both sides (`customer-web/src/app/ride/page.tsx:202`), never a catalogue.
- One order read path on the web (`backend/src/server.js:4241`), and every mobile history screen can be built on it — see D5 for the three surfaces that need to agree first.
- Parcel asserts nothing the backend cannot back (B8): picked-up and delivered are seeded notification types, the receiver code is a real per-booking OTP the driver redeems, and neither side puts a map, an ETA or a driver position in the parcel journey. The web is the thinner of the two here — it books a job and stops.

## What this changes in the design set

1. Strip UPI from 0 screens (). The five listed in A1 need their payment proof rebuilt, not relabelled.
2. Reframe the fare on 16 and 66 as indicative, never as computed from the package.
3. Adopt the web's five identity labels verbatim on slot 31.
4. Map every order status to a human label; render none raw, and build the labels from the 17 seeded notification titles (B4), not from merchant KDS states.
5. Use "My orders" and "Log out" consistently; "Taxi", not "cab".
6. Keep Aizawl/Mizoram data everywhere; copy no Delhi placeholder.
7. Show no coupon code on any surface: the web's `NABIN50` placeholder is invented, and the three rows the fallback seeds are two Delhi-named codes and one RIDE coupon (B2). Draw the field and the rejection line, never a code.
8. Replace every branded reference code with the real `job.id` (A4) — 0 designs, 0 journeys.
9. Audit coverage for this class now exists: `audit_all.py` flags `unsupported-payment-rail` on every screen, so a rail name cannot return unnoticed (A1).
10. Permit Parcel Picked Up / Parcel Delivered as real parcel states, and the receiver OTP as a real hand-off step (B8); keep a map, an ETA and a driver position out of the parcel journey.
11. Treat Ride history (55) as a filter of the shared order list, not a second dataset (D5).
12. Use the product's words — Driver Arriving, Ride in Transit, Ride Completed — over the brief's paraphrases in customer copy (B9).
13. Keep "NABIN Wallet" a label for a choice, not a surface for money: no balance, no top-up, no insufficient-funds state and no refund-to-wallet line (A5).
14. Draw every bill from what is charged — the re-priced lines less a redeemed discount, with no fee, handling or tax line — and leave the packaging and GST fields out (A6).

Owner decisions this document needs: the food taxonomy depth (D1), the dark-store line (B7), `/grocery-deals` (E), whether 27/28/55 stay three screens (D5), and whether the customer wallet becomes a funded balance or stays a label (A5).
