# Customer screen contract audit (PROMPT 11 §2)

Audited 2026-10-05 against `backend/src/server.js`, `backend/src/database.js`,
`backend/src/repositories/*` and `supabase/migrations/*`. Read-only: no route was called against a
hosted project, no migration was applied, nothing here was changed by this audit.

Purpose: before a Customer screen is built or fixed, name what the backend can actually back. This is
the "Routes a screen may NOT claim" gate — a screen that asserts anything in the final section is
fabricated, however plausible it looks.

Citation convention (task #139): every `server.js:N` below names a route **registration** and is
derived, not remembered — `node scripts/reanchor_audit_citations.js` rewrites the number and
`--check` fails when it drifts. A fact that lives *inside* a handler is cited by a greppable literal
instead (`server.js → \`orderState: dbOrder.order_state\``), never by a bare line number: an insert
anywhere above it silently moves the number, and a confident wrong line is worse than no line.
Citations into other files (`database.js`, the repositories, the migrations) are not yet derived —
they were re-checked by hand on 2026-10-06.

## 1. Payment

- `POST /api/payments/create-order` — server.js:8067, `authenticateUser`.
- `POST /api/payments/verify-checkout` — server.js:8170, `authenticateUser`.
- `GET /api/payments/session/:orderId` — server.js:8192, **no middleware**; parses its own bearer
  token at 7952–7984.
- `POST /api/payments/webhook` — server.js:8254, no middleware, requires
  `x-razorpay-signature` + `PAYMENT_WEBHOOK_SECRET` (8014, 8029).
- `POST /api/admin/finance/refund` — server.js:2294, `authenticateAdmin` +
  `requirePermission('finance.refund')` — admin-only, so a customer read can never show a refund.
- Sandbox, not a gateway: `PAYMENT_MODE === 'live'` gates the real path
  (PaymentRepository.js:51); `keyId` falls back to the literal `'rzp_test_nabin_beta_2026'`
  (PaymentRepository.js:62); responses say `provider: 'RAZORPAY_SANDBOX'` (PaymentRepository.js:72,
  and the refund handler's `p_provider: 'RAZORPAY_SANDBOX'`). No Razorpay SDK in `backend/package.json`.
- Terminal states: `INITIATED|PENDING|SUCCESS|FAILED|CANCELLED|EXPIRED`
  (006_payments_domain.sql:19-20), client spellings mapped at PaymentRepository.js:159-161.
- PostgreSQL write only under `isLivePostgres` (PaymentRepository.js:80-97, `payment_sessions`),
  mirrored to an in-memory `Map` (112-113) and read back from memory on a DB miss (180-186).
  Payment responses carry **no `dataSource` field**, so a client cannot tell which it got — unlike
  `GET /api/advertisements` (server.js:2807) and `GET /api/admin/campaigns` (server.js:3092), which
  both answer with one.
- `last4` exists only for a **driver payout** destination (DriverRepository.js:69-73,
  format at database.js:2514-2515). No route returns a customer instrument.

## 2. Grocery order tracking

- Customer reads are PostgreSQL via `OrderRepository.js:432`/`:407` (`.from('orders')`):
  `GET /api/customer/orders` (server.js:4475), `GET /api/customer/orders/:id` and
  `/api/orders/:id` (server.js:4535), `GET /api/customer/activity` (server.js:4495) — all
  `authenticateUser`.
- The stage vocabulary is one column, `orders.order_state`
  (`RECEIVED, ACCEPTED, PREPARING, PACKING, READY_FOR_PICKUP, PICKED_UP, DELIVERED, REJECTED,
  CANCELLED` — 018:20-25), emitted as `status` (`server.js → \`status: o.order_state\``) and, on the
  food order, also `orderState`.
- Only writer: the merchant KDS route `POST /api/merchant/orders/:orderId/status` (server.js:4688,
  `APPROVED_KDS_STATES`) → `transitionOrderState` (OrderRepository.js:348-378).
- A timeline table exists and is **never read**: `public.order_transitions` (018:73-87), zero
  references in `backend/src`. `checkout_events` (013:56) likewise has no reader. So a screen may
  show the current state, not a per-stage event history with timestamps.
- Websocket updates arrive as `FOOD_ORDER_UPDATE` even for grocery orders — both the KDS route and
  the driver's delivery confirm send that type (`server.js → \`type: 'FOOD_ORDER_UPDATE'\``). The
  packed-weight broadcast comes from `POST /api/grocery/orders/:id/packed-weight` (server.js:7340).
- `POST /api/grocery/checkout/validate` (server.js:7097) projects `deliveryAddress` from the request
  or the literal `'Default Address'` (`server.js → \`deliveryAddress: req.body.deliveryAddress || 'Default Address'\``).
  `GET /api/grocery/products` can answer `dataSource: 'fixture', degraded: true` (server.js:6503).

## 3. Identity documents / KYC

- `POST /api/identity/submit` (server.js:3562) and `GET /api/identity/status/:userId`
  (server.js:3644) are the customer routes; admin review is the five `identity-verifications` routes
  under `requirePermission('identity_verification.view')` / `.review`, opening at
  `GET /api/admin/identity-verifications` (server.js:3691).
- **In-memory**: `submitIdentityApplication` (database.js:3469-3606) mutates `this.users` /
  `this.identityApplications` and contains no `supabaseAdmin` call. The `identity_documents` table
  (001:30) has **no writer** in `backend/src`.
- **Retired by #146, do not re-introduce:** the submit path used to default a missing upload to
  `/docs/mock_aadhaar_user.png` / `/docs/mock_voter_user.png` and `submitIdentityApplication` used
  to hard-code `'SUBMITTED'` for both documents and the overall status, so a customer who typed two
  numbers into a form left a record saying NABIN held paperwork it had never received. The route now
  stores `aadhaarDocUrl: null` / `voterIdDocUrl: null` (`server.js → \`aadhaarDocUrl: null,\``), and
  the three document statuses are one constant — `NO_DOCUMENT` — at submission and after every
  decision (`database.js → \`const aadhaarDocStatus = 'NO_DOCUMENT';\``). #146 took the two steps
  that were available then: the missing file became `null` instead of a mock path, and a document
  was reported `SUBMITTED` only if one was actually on the record. #154 finished the thought. With
  #147's route refusing a document field outright, nothing can ever be on the record, so `PENDING`
  promised paperwork that cannot arrive and `SUBMITTED` could not be reached — and the APPROVE
  decision was still writing all three as `VERIFIED`. The numbers the customer typed are what the
  route validates and stores; the record now claims no document at any step of its life. Guarded by
  `backend/kyc_approve_checklist_test.js` SUB-01…SUB-07 and AP-02/AP-06/AP-13 — SUB-07 fails the
  suite if a `/docs/mock…` literal reappears as code in either writer.
- **What `GET /docs/:filename` serves is a refusal, not a document** (#146; guarded by
  `backend/admin_identity_gates_test.js` DOC-07…DOC-09). It used to render a forged government ID
  card — "RAHUL SHARMA", DOB 15/08/1994, "XXXX XXXX 4892", an EPIC number, a
  "GOVERNMENT WATERMARK" line — for any filename an examiner's queue happened to name. It now
  answers a fixed "NO DOCUMENT ON FILE" placeholder that states NABIN has no upload or storage path,
  and it does not read `req.params.filename` at all, so nothing the caller sends is echoed into the
  markup (DOC-09). The gate in front of it is unchanged: `authenticateAdmin` plus
  `requirePermission('identity_documents.view')` (DOC-01…DOC-06).
- **The seed applications say what they were given**: `APP-9021`, `APP-9019` and `APP-9018`
  (`database.js → \`this.identityApplications = [\``) carry their demo identity numbers and
  `aadhaarDocUrl: null` / `voterIdDocUrl: null` with all three document statuses at `NO_DOCUMENT`,
  which is the same value the live writer and every reviewer decision write (#154). Their
  `status`, `reviewNotes` and `resubmissionReason` no longer narrate an examiner reading a
  photograph that no platform received
  (#147): the two decided rows review the declared details and the two supplied numbers, and say the
  document was not submitted. The same ticket took the fiction out of `admin_dashboard.html`, whose
  viewer had hard-pointed `img.src` at a demo applicant's Aadhaar card for every application an
  examiner opened, so that one card stood in for any applicant's. The pane is built from the
  selected application now, and says "No document on file" when the record holds no file rather
  than painting one. Guarded by `backend/admin_identity_gates_test.js` EXAM-01…EXAM-06, and by
  SUB-07, which now sweeps the dashboard beside the two writers.
- **There is still no upload**: no route accepts a document, no storage path writes one, and the
  `identity_documents` table (001:30) has **no writer** in `backend/src`, so every real submission
  on file today is numbers-only. As of #147 the boundary says so out loud: `/api/identity/submit`
  refuses `aadhaarDocUrl` / `voterIdDocUrl` with 400 `IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED` instead
  of storing a caller-supplied URL that only an examiner's browser would ever load. Guarded by
  `backend/test_phase7_security.js` MODULE 4 case 4.
- `/api/media*` has no auth middleware, and it is worse than the earlier note:
  `POST /api/media/upload` (server.js:8410), `GET /api/media/signed-params` (server.js:8509),
  `GET /api/media` (server.js:8521) are all unauthenticated. Only `DELETE /api/media/*`
  (server.js:8467) checks a token and ownership, itself bypassable via
  `allowsTestConvenience('skipping an authentication check')` at the top of that handler.
- Media metadata lives in `db.mediaAssets` (database.js:8669-8696), hydrated from `store.json`
  (database.js:1602-1607; `backend/src/store.json` via `database/persistentStore.js:6`).
- Driver KYC has no document upload route — the driver reads carry a `kycStatus` scalar only
  (`server.js → \`kycStatus: driver.kycStatus || driver.status || null\``) plus the admin
  `POST /api/admin/drivers/:id/verify-payout-destination` (server.js:5044).

## 4. Avatar

- `POST /api/customer/profile/photo` (server.js:8531), `POST /api/driver/profile/photo`
  (server.js:8596) and `POST /api/driver/vehicle/photo` (server.js:8657) have **no
  `authenticateUser` middleware** — each hand-parses the bearer token and, with no token plus test
  convenience, falls back to a hard-coded id: `requestedCustomerId = … || 'usr_1'` on the customer
  route, `requestedDriverId = … || 'DRV-101'` on the two driver routes.
- It writes `user.avatarUrl` (`server.js → \`user.avatarUrl =\``) then `db.save()` → local
  `store.json`. There is **no
  avatar column** (users columns: id, phone, name, email, dob, address, rating, wallet_balance,
  identity_status, account_status — 001:15-28) and **no GET route that serves an avatar**.

## 5. Profile name / email

- `/api/auth/*` is exactly five routes: `POST /api/auth/send-otp` (server.js:1201),
  `POST /api/auth/verify-otp` (server.js:1219), `GET /api/auth/me` (server.js:1238),
  `POST /api/auth/logout` (server.js:1288) and `POST /api/auth/refresh-token` (server.js:1355).
  **There is no profile write of any kind** — no `/api/auth/profile`, no `PATCH /api/auth/me`.
- `GET /api/auth/me` answers with the session's **mint-time snapshot** of the users row
  (`server.js → \`user: session.role === 'CUSTOMER' ? projectUserForSelf(session.entity)\``), not a
  fresh SQL read. Since #140 that projection strips `rating` for a CUSTOMER and the
  `refresh-token` echo runs through the same helper; the driver, merchant and admin reads still
  echo `session.entity` whole, which is why the hydrator's `DEFAULT 5.00` still reaches *them*.
  Separately, a booked ride used to carry a `customerRating` copied from `users.rating`
  (`POST /api/customer/book-ride`, server.js:3826); #144 deleted that write and both job
  projections answer `null` for the field, so no read of a trip reports a score for the passenger
  — see §6. `walletBalance` on a customer read comes from the wallet work, not from `/auth/me`.
- Saved-address book: **absent**. No `/api/addresses` route; `address` exists only as
  `users.address` (001:21), the identity-submit free text, and the inline pickup/drop defaults the
  booking and parcel routes write (see §6 and task #32).

## 6. Ride map coordinates

- `pickup_lat/pickup_lng/drop_lat/drop_lng` are real persisted `jobs` columns (001:145-148).
- **Retired by #142, do not re-introduce** (guarded by `backend/place_substitution_test.js` NULL-01…03,
  chain link 54, and `customer_ride_projection_test.js` CT-18): the read projection used to default
  a coordinate-free row to Delhi — `parseFloat(row.pickup_lat || 28.6139)` and its three siblings —
  and the writer baked the same four literals into the stored row. Both directions now go through
  one exported guard, `coordinateOrNull`
  (`backend/src/repositories/JobRepository.js → function coordinateOrNull`), which answers an
  absent or non-finite coordinate with `null`; the boot hydrator imports that same function rather
  than copying the rule. A job stored without geography reads back as a job without geography.
- **A booking with no placed end is refused, not filled in** (#141; pinned by
  `backend/geo_adversarial_test.js`, `backend/test_phase4_orders.js` and
  `mobile/test/ride_booking_test.dart`): `POST /api/customer/book-ride`
  (server.js:3826), `POST /api/customer/book-parcel` (server.js:4054) and
  `POST /api/customer/book-food` (server.js:4221) each answer `400 PLACE_REQUIRED` from one helper
  (`server.js → function placedEnd`) and write no row. The places they used to invent —
  `'Connaught Place Inner Circle, Block B'` at `28.6328, 77.2197`, `'Kamla Nagar Market, Block C,
  Delhi'` / `'Karol Bagh Electronics Hub, Delhi'`, and `'North Campus Girls Hostel, Delhi'` —
  survive only in the comments that record the ruling. Distance is measured between the two placed
  ends (`server.js → function tripDistanceKm`) and duration is the one explicit city-speed model
  (`server.js → function tripDurationMins`, 20 km/h, an estimate no screen may call an arrival
  time), replacing the `distance: '4.2 km'` / `duration: '14 mins'` literals.
- That refusal never answers ahead of a gate that must come first (`place_substitution_test.js`
  ORDER-01…05): unauthenticated it is a 401 rather than a form hint, a forged `customerId` is
  answered by the identity check, and the address check sits before the route redeems a coupon.
  The food route's placed address is what the durable row holds (`place_substitution_test.js`
  ADDR-01…05).
- `POST /api/geofence/reverse-geocode` (server.js:3410) resolves nothing today
  (`place_substitution_test.js` RS-01…06): it answers `resolved: false` with
  `locality`/`landmark`/`city`/`formattedAddress` all `null` and `reason: 'NO_GEOCODER'`, in place of
  the `'Civil Lines, North Delhi'` it used to return for a point it had never heard of, and in place
  of the `200 … "Live Location (NaN° N, NaN° E)"` it used to return for a non-numeric input.
- `GET /api/tracking/:jobId` (server.js:7957; no middleware, manual bearer + ownership check) returns
  `location`, `driver`, `pickup`/`drop`. As of task #138 the customer's `location` is a **projected
  position** — `lat, lng, heading, speed, accuracy, receivedAt, updatedAt` — through
  `projectLocationForCustomer`, which the two trip-channel telemetry pushes also use. It is no
  longer the raw fleet record, which also carried a second `driverId` spelling, the driver's own
  self-asserted `isOnline`/`status`, a `serviceType`, and the identity the store used to default.
- **Live position is not in PostgreSQL**: the driver-location route states raw telemetry is never
  written there; `updateDriverLocation` writes the `fleetLocations` Map only, and the map starts
  empty in intent — "this driver has not reported since the process started" is a real, common
  state, and the answer to it is `location: null`, not a stand-in. `drivers.current_lat` exists
  (001:62) but its projection still defaults it to 28.6139 — on both sides of the driver record
  (`DriverRepository.js → lat: parseFloat(row.current_lat || 28.6139)`,
  `DriverRepository.js → current_lat: driverData.currentLocation?.lat || 28.6139`, and the same read
  in the boot hydrator). That is the Driver slice's to adjudicate; no Customer surface reads it,
  because the customer's position arrives through `projectLocationForCustomer` instead.
- **Retired by #138, do not re-introduce** (each is guarded by `backend/customer_ride_projection_test.js`,
  chain link 52): tracking used to fall back to fabricated telemetry `lat 28.6853, lng 77.2185,
  heading 90.0, speed 28.5` and to driver identity `'Rajesh Kumar' / '+91 98101 22334'`, and
  `updateDriverLocation` used to default a driver the map had not seen to the same name, that
  number and `vehicleType: '3W'`. All three are now `null`-or-real. The real `drivers.phone` for
  DRV-101 is `+919810122910`; `+91 98101 22334` belongs to no row.
- **No rating is projected to a customer, on any Customer surface.** `drivers.rating NUMERIC(3,2)
  DEFAULT 5.00` (001:58) and `users.rating DEFAULT 5.00` (001:22) are column defaults and **no
  reviews or ratings table exists anywhere in the schema** — measured 2026-10-06 against the local
  database: zero tables matching `%rating%|%review%|%feedback%`, only three `rating` columns
  (`drivers`, `merchants`, `users`), and 197 of 199 `users` rows hold exactly the default `5.00`.
  Both `DRIVER_ASSIGNED` broadcasts dropped `rating` (#138) and `GET /api/auth/me` + the
  `refresh-token` echo now run customer sessions through `projectUserForSelf` (#140), which removes
  it — the same ruling migration 034 made for `merchants.rating`. `profile_screen.dart` deleted its
  "User Rating" stat slot rather than leave a dash that still claims NABIN scores customers.
  Guarded by `customer_ride_projection_test.js` CT-02/CT-13 and `customer_activity_test.js`
  ACT-21…23 + SELF-01/02.
  **Closed by #144 on the job row as well:** `customerRating: user.rating` is deleted from the
  booking route, the metadata write allowlist no longer carries the key, and both projections of a
  `jobs` row — `JobRepository.mapRowToJob` and the boot hydrator — answer `null` for it. The hydrator
  assigns it *after* its `...(row.metadata || {})` spread, so a trip booked while the route still
  copied the column has its stored `5.0` shadowed on read instead of re-quoted; the seed job JOB-101
  lost its `customerRating: 5.0` for the same reason. The driver dispatch
  (`server.js → type: 'NEW_JOB_DISPATCH'`) no longer prints `(5 ★)` beside a passenger's name and no
  longer answers a school ride with no guardian recorded as `'Rahul Sharma'` — an unknown name is
  sent as `null`. Guarded by `customer_ride_projection_test.js` CT-14…CT-18.
  Still open, on other apps' surfaces and their slices to adjudicate: the hydrator's
  `rating: parseFloat(row.rating || 5.0)` (two places, `database.js → \`rating: parseFloat(row.rating || 5.0)\``)
  still turns a NULL into a perfect score before any route sees the driver or merchant row, and
  `driver_app_shell.dart` reads `job['customerRating']` from a payload that no longer carries the
  key, so that card prints `(null)` — a display bug on the Driver side now, not a fabricated fact.
- The boot seed `fleetLocations.set('DRV-101', …)` (database.js:124-137) still carries the Delhi pin
  and the `#138`-retired `'Rajesh Kumar' / '+91 98101 22334'` identity as *fixture data*, which is why
  `place_substitution_test.js` records `GAP-TRK-01` as NOT MEASURED rather than claiming a guarantee
  it cannot make. Removing those arrays is the owner's decision. The routes' own defaults are gone:
  `bookingPickup` no longer exists anywhere in `server.js`, and a booking with no placed end is
  refused (§6 above).
- WS `DRIVER_LOCATION_UPDATE` is pushed to `ride:{jobId}` / `delivery:{jobId}` with the projected
  position, and to `admin:fleet` with the full record (the fleet view's subject *is* the vehicle).
  **Open finding, not fixed here:** the push uses the unfiltered `broadcast()` helper, so every
  registered socket receives it regardless of channel — `broadcast(payload)` has no recipient test
  at all. The comment above the REST call claims "strictly to the authorized customer/merchant
  channel", which is not what the code does. Scoping that is a WS-authorization change touching
  every channel, and needs its own decision.

## Routes a screen may NOT claim

1. A saved payment instrument, card, UPI id or last-4 for a **customer** (driver VPA only).
2. A customer-readable refund status, refund id or refund timeline (admin route only).
3. A customer wallet balance, top-up or wallet-as-payment-method (no route exists).
4. Grocery stages beyond the nine `order_state` values, or a timestamped event timeline
   (`order_transitions` and `checkout_events` are unread).
5. Real customer identity-document upload, durable storage or a verified status (in-memory array,
   no upload route, and since #146 the record answers `PENDING` for a document that was never sent).
6. An avatar persisted to or served from the database (no column, no read route).
7. Editing profile name or email (no write route at all).
8. Saved-address book CRUD.
9. A persisted, authoritative live driver position (Map-only store).
10. Real ride coordinates when the client omits lat/lng — the row now stores `null` (#142), so a
    coordinate-free job reads back as a job without geography rather than as a place.
11. A driver name or phone on tracking when the driver row is unresolvable — the answer is `null`.
12. Any rating on any Customer surface — a driver's (`drivers.rating`), the customer's own
    (`users.rating`) or a restaurant's (`merchants.rating`). All three are `DEFAULT` columns and no
    reviews table exists, so there is no measurement to show.
13. Anything from the fleet record on a Customer feed (a second driver id, `isOnline`, `status`,
    `serviceType`, a name or phone) — the customer's position payload is a position and their
    driver's identity comes from the driver row.

**How to apply:** for each Customer screen, pair this file with the screen's test. A literal that
names any item above is deleted, not relabelled, and the state becomes honest (loading / error+retry
/ empty) rather than a plausible stand-in.

---

# Flutter-side state of the same six surfaces (PROMPT 11 §2, part 2)

Audited 2026-10-06 against `mobile/lib` and `mobile/test`. Read-only. The pattern each closed screen
follows: assert the request actually left (`stubSaw('GET', '/path')`) **before** asserting content,
because an error state also satisfies "the invented literal is gone".

1. **Payment** — `features/payment/.../payment_screen.dart`. No HTTP at all: nothing in `mobile/lib`
   calls `/api/payments/create-order` or `/verify-checkout`; `authorize` is injected and no
   checkout pushes `/payment` (router only, `app_router.dart:162-171`). Truth pass closed
   2026-10-06 (`test/payment_screen_test.dart`, 12 tests): the `'NABIN Wallet'` tile is **deleted**
   (`_methods` `:77-94` now offers UPI / Card / Cash on delivery only — see the "recordable ≠
   spendable" note below), the success copy no longer says an amount was *paid*
   (`_successMessage` `:246-250`: "₹160 confirmed for {service}", and for COD "the delivery person
   will collect ₹160 in cash"), the receipt's literal `('Status','Completed')` became
   `'Order confirmed'` and `('Amount paid', …)` became `('Amount', …)`
   (`_receiptView` `:316-`), and the reference row now names its own source —
   "Reference (from this order)" when only the caller's `referenceId` exists vs
   "Reference (returned by the order call)" when a backend id arrived. Cash on delivery also goes
   through `authorize` when one is wired (`_confirm` `:102-136`); previously the Pay button jumped
   straight to success, which showed an order as taken that was never sent. **Still unpinned:** the
   "a request left" assertion — `test/payment_screen_test.dart` uses no `stubSaw`, because no
   checkout ever navigates here with one; the screen's only real dependency is the injected call.
2. **Grocery tracking** — there is no grocery-specific tracking screen; `food_order_tracking_screen.dart`
   serves both, reads `GET /api/customer/orders/:id` (`:137`), and its `Timer.periodic` (`:111`) only
   re-reads. The ladder `_forwardStates` `:39-82` + `_stoppedStates` `:88-97` is exactly the nine real
   `order_state` values. `food_order_tracking_test.dart` precedes every content expect with
   `stubSaw('GET','/customer/orders/…')` (`:143-325`). Honest.
3. **Identity verification** — submits `POST /api/identity/submit`
   (`identity_verification_submission_screen.dart:118`) and reads
   `GET /api/identity/status/:userId` (`..._status_screen.dart:53`); no document tile, and the screen
   states plainly that no document travels with it (`submission:257-260`). `identity_verification_test.dart`
   pins the POST body and forbids `Rahul Sharma`, `XXXX-XXXX-4892`, `MZO***201`, `Simulate Approve`.
   Honest **against a backend that is itself in-memory** (see §3 above) — the Flutter side is truthful,
   the route is not durable.
4. **Avatar** — no picker, no `Image.network` avatar, and `avatarUrl` is never read back;
   `personalization_screen.dart:132-162` and `profile_screen.dart:253-264` render an initials
   monogram, with a comment naming the upload route that exists but is unwired (`:127-131`). Honest.
5. **Profile name/email** — `profile_screen.dart:43` reads `/auth/me`, `:57` reads
   `/customer/activity`; name and email are read-only rows (`personalization_screen.dart:41-88`) with
   copy stating no write route exists (`:179-184`). Log Out calls the real route (`profile_screen.dart:75-84`).
6. **Ride map / active ride** — `active_ride_screen.dart:223` reads `GET /api/tracking/:jobId`, the
   ladder (`:66-109`) mirrors `VALID_JOB_TRANSITIONS`, `Timer.periodic` (`:180`) only re-reads, driver
   name/phone come from the tracking row (`:266-278`) and plate/rating/OTP only from the
   `DRIVER_ASSIGNED` push (`:205-207, 280-305`) with no fallback. `active_ride_test.dart` forbids
   `Rajesh Kumar`, `Vikram Singh`, `7729`, plates and ETA (`:317-345`). Honest.

## Still fabricated (Flutter, current)

- `mobile/lib/core/widgets/driver_map_view.dart` — hard-coded Delhi `LatLng(28.6814,77.2228)` /
  `LatLng(28.6315,77.2167)` (`:45-46`), a roster of 8 invented drivers with names and plates
  (`:70-151`), and a 1800 ms `Timer.periodic` that walks the marker along a static route
  (`:185-209`). Its only consumer is `features/home/presentation/screens/driver_home_screen.dart:459`,
  so this is **Driver-app surface, not Customer** — and the widget is shared with Customer, so it must
  be localised by pin-label arguments only (memory `nabin-map-widget-is-shared`).
- ~~`payment_screen.dart` — a `'NABIN Wallet'` method tile~~ **closed 2026-10-06.** The **balance** was
  real (`wallet_screen.dart:31-40` reads `user.walletBalance` off `/auth/me`'s `session.entity`), but
  nothing debited it at payment time: no wallet route, and the only writer of a customer balance is an
  admin refund. The distinction the fix rests on is **recordable ≠ spendable** —
  `checkouts.payment_method` does permit the string `'WALLET'` (013_checkout_domain.sql) and the
  grocery checkout stamps it on any non-CASH call (`POST /api/grocery/checkout/validate`,
  server.js:7097) without moving a rupee, so the
  column could record a payment that no code performed. Offering the tile gave that stale default a
  customer-facing meaning; it is removed rather than relabelled.

