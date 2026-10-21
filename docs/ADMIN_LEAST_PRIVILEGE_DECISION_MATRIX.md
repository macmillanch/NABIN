# Admin least-privilege decision matrix (Brief F)

**Status:** PROPOSAL ONLY. No production middleware, role grant, permission catalogue,
response shape, super-admin gate, `/api/admin/me`, or platform-settings behaviour has been
changed. Nothing is staged, committed, pushed, deployed, or migrated.

**Prepared:** 2026-10-21, against the current working tree. `backend/src/server.js` in this
tree already carries earlier uncommitted work, so every line reference below is a current
working-tree line, not a line in HEAD `23ee5d1`.

**Inputs:** the Brief E audit in `docs/ADMIN_PERMISSION_MATRIX.md`; the live catalogue in
`backend/src/adminPermissions.js`; the route registrations and handlers in
`backend/src/server.js`; the read implementations in `backend/src/database.js`; the target
catalogue and role matrix in `docs/ADMIN_FEATURE_SPECIFICATION.md` §3–§4 and decision 11.

**Nothing here is implemented.** Every "proposed" permission or grant is labelled as
existing, specification-proposed, or new. A new name is not adopted by being written in
this document; it needs the owner decision cited beside it.

---

## 1. The 13 registrations, as measured

`authenticateAdmin` admits all five closed roles (`SUPER_ADMIN`, `KYC_SPECIALIST`,
`OPERATIONS`, `FINANCE_AUDITOR`, `SUPPORT_AGENT`). None of the 13 registrations carries
`requirePermission` or `requireSuperAdmin`, so **every active administrator token of any
role can call all 13 today.** That sentence is the defect; the table records what each call
returns.

| # | Registration | Current line | Handler | Data source | Sensitivity |
|---|---|---|---|---|---|
| F1 | `GET /api/admin/services/status` | `server.js:1852` | inline, `db.getServicesStatus()` | in-memory service mirror, with a write side effect | Medium; and the identical payload is anonymous at `/api/services/status` |
| F2 | `GET /api/admin/drivers` | `server.js:2350` | inline, reads `db.drivers` | boot-hydrated memory mirror, not a per-request durable read | High: driver PII, DL, UPI identifiers, wallet, earnings, location |
| F3 | `GET /api/admin/drivers/:id` | `server.js:2359` | inline, reads `db.drivers` | same mirror | High: the whole mirror object |
| F4 | `GET /api/admin/advertisements` | `server.js:3450` | inline, `db.listAdvertisements({ activeOnly:false })` | Postgres when live, otherwise fixture with `degraded:true`, `persisted:false` | Medium: merchant association, campaign performance; no revenue column exists |
| F5 | `GET /api/admin/metrics` | `server.js:8520` | inline, `db.getAdminPlatformMetrics()` | Postgres only; 503 `AUTH_STORE_UNAVAILABLE` when unavailable | Medium–high: platform counts plus `totalGrossFare` |
| F6 | `GET /api/admin/jobs` | `server.js:8534` | `db.listAdminJobs(...)` | Postgres when live, otherwise memory with `degraded:true` | High: customer name/phone, addresses, coordinates, fare breakdown, driver earnings, payment fields, arbitrary metadata |
| F7 | `GET /api/admin/restaurants` | `server.js:8535` | `db.listAdminRestaurants(...)` | Postgres when live, otherwise memory with `degraded:true` | High: merchant phone/address/coordinates, `walletBalance`, `commissionRate` |
| F8 | `GET /api/admin/master-catalog` | `server.js:9049` | `db.getMasterProducts()` | Postgres filtered `is_active=true`, otherwise all memory products | Low: product catalogue metadata, no prices |
| F9 | `GET /api/admin/master-catalog/:id/stores` | `server.js:9100` | `db.getMasterProductStoreMatrix(id)` | Postgres, otherwise memory | Low–medium: merchant link, address, store price, stock |
| F10 | `GET /api/admin/grocery/price-alerts` | `server.js:9679` | `db.getUnusualPriceAlerts()` | memory only, always `dataSource:'memory'`, `degraded:true` | Medium: merchant/product price history, one process wide |
| F11 | `GET /api/admin/supabase-status` | `server.js:9711` | `checkSupabaseConnection()` | live probe | Medium: environment, project ref, mode, `userCount`; error text is logged, not returned |
| F12 | `GET ['/api/admin/features','/api/v1/admin/features']` | `server.js:9749` | `featureControlService.refreshCache()` | in-memory flag cache | Medium: full flag values, while the public twin returns only `enabled` |
| F13 | `GET ['/api/v1/fleet/locations','/api/fleet/locations']` | `server.js:10353` | `db.getFleetLocations(...)` | memory only, resets on restart, seeded with one fixture driver | High: live coordinates plus name/phone for records that carry them |

The four registrations that remain handler-decided are outside this list and must keep their
present behaviour: `GET /api/admin/me` (`server.js:2278`, identity only),
`POST /api/admin/reset-password` (`server.js:2235`, `adminHoldsPermission` inside the
handler), `POST /api/v1/admin/features` (`server.js:9762`, SUPER_ADMIN check inside the
handler), and `PUT /api/admin/features/:key` (`server.js:9847`, same). Brief E measured
89 `authenticateAdmin` registrations: 70 permission-gated, 2 super-admin-only, 17
authentication-only. Gating these 13 would leave **4 authentication-only** registrations.

---

## 2. What already exists, and what the specification proposes

### 2.1 Live catalogue (`backend/src/adminPermissions.js`)

- Five closed roles, enforced by the database `CHECK` (`backend/migrations/001_central_schema.sql:178`).
- 55 names in `SUPER_ADMIN_GRANTS` (`:48-71`). `requirePermission` admits SUPER_ADMIN by
  wildcard (`:151-156`), so the explicit list affects `/me` reporting, not reachability.
- Current non-super grants (`:73-88`):
  - `KYC_SPECIALIST`: identity view/review/approve/reject/request-resubmission,
    `identity_documents.view`, `audit.view`.
  - `OPERATIONS`: `identity_verification.view`, `customers.read`, `fleet.manage`,
    `merchant.manage`, `support.view`, `support.respond`, `geofence.view`, `surge.view`.
  - `FINANCE_AUDITOR`: `finance.view`, `finance.refund`, `finance.adjust`,
    `finance.settlement`, `audit.view`.
  - `SUPPORT_AGENT`: `support.view`, `support.respond`, `support.resolve`, `audit.view`,
    `customers.read`.

### 2.2 Read names that already exist

`customers.read`, `audit.view`, `finance.view`, `campaign.view`, `promotion.view`,
`geofence.view`, `surge.view`, `support.view`, `security.view`, `identity_verification.view`,
`identity_documents.view`, `notification.view`, and `services.view`.

Most of these already gate routes. **`services.view` and `notification.view` are the
exceptions from this list: both are granted to SUPER_ADMIN and gate nothing.** That makes
`services.view` the one existing, unused, correctly-read name available to this brief.

### 2.3 Write names mistakenly available as "read" names

`fleet.manage`, `merchant.manage`, `catalog.manage`, `orders.manage`, and `grocery.review`
are write powers. The codebase already has precedents where a read route is gated by one of
them (for example `GET /api/admin/dark-stores` and `GET /api/admin/merchants/pending` use
`merchant.manage`). Those precedents are existing debt, not a recommendation. This proposal
keeps reads on read names wherever a read name exists or can be approved; where it falls
back to a write name, that conflation is stated in the route's decision.

### 2.4 What the specification proposes but has not adopted

`docs/ADMIN_FEATURE_SPECIFICATION.md` §3 names these new read-side strings:
`dashboard.view`, `operations.live`, `map.view`, `fleet.read`, `merchants.read`,
`rides.read`, `food.read`, `parcel.read`, `system.health`, `feature.view`,
`settings.view`, plus non-read `catalog.bulk`. It also writes `advertisement.*` as
"existing", but the catalogue has only `advertisement.create/edit/delete`; there is **no
`advertisement.view`**.

The §4 role matrix (`:554-582`) is the role-need source used below:

| Capability | SUPER | OPS | FINANCE | KYC | SUPPORT |
|---|---|---|---|---|---|
| Dashboard KPI aggregate | ● | ● | ● | ○ | ○ |
| Live operations centre + map | ● | ● | ○ | ○ | ○ |
| Drivers: read | ● | ● | ○ | ○ | ○ |
| Merchants: read | ● | ● | ○ | ○ | ○ |
| Catalogue + bulk | ● | ○ | ○ | ○ | ○ |
| Orders: ride / food / parcel read | ● | ● | ride only | ○ | ● |
| Campaigns / ads / banners | ● | ● | ○ | ○ | ○ |
| Health + integrations | ● | ○ | ● | ○ | ○ |
| Settings + feature flags | ● | ○ | ○ | ○ | ○ |

Two specification facts matter before the route decisions:

1. **The §4 matrix grants no read capability to KYC_SPECIALIST except its own identity
   queue.** Today KYC can call all 13 routes; the target is zero of them.
2. **Decision 11 is still open** (`:1360`) and its option (a) is not sufficient as written.
   Of the names it lists, `services.view` fits F1; `system.health` fits F11; `catalog.manage`,
   `merchant.manage`, and `fleet.manage` fit F8/F9, F7, and F2/F3 only by reusing a write
   name; `promotion.view` and `audit.view` fit none of the 13. F4, F5, F6, F10, F12, and F13
   need a decision option (a) does not contain.

---

## 3. Route-by-route decision matrix

Legend for "existing name": **EXISTING** = in `adminPermissions.js`; **SPEC** = named in
`ADMIN_FEATURE_SPECIFICATION.md` §3 but not in the catalogue; **NEW** = not in either,
proposed here as a decision, not adopted.

### F1 — `GET /api/admin/services/status`

1. **Route and handler:** `server.js:1852`, inline; calls `db.getServicesStatus()`
   (`database.js:2164-2211`). Array-free, one registration.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** services, summary, `pauseHistory`; identical to the
   anonymous `GET /api/services/status` (`server.js:1848`). Sensitivity is medium
   operationally, but **confidentiality is already nil** because the anonymous route serves
   the same JSON. `getServicesStatus()` has a write side effect: a due pause is auto-resumed
   and a `SERVICE_AUTO_RESUMED` audit row is created (`database.js:2166-2190`). A GET can
   therefore mutate state and write an audit row.
4. **Roles that need it:** SUPER_ADMIN and OPERATIONS (service controls). SUPPORT_AGENT can
   read the public route for outage answers; it does not need the admin alias. FINANCE and
   KYC do not need it.
5. **Proposed minimum permission:** `services.view` on the admin registration.
6. **Existing name:** YES — `services.view` exists, is SUPER-only today, and gates nothing.
   This route would be its first enforcement point.
7. **Specification proposal:** none needed; `services.view` is already in the catalogue. The
   target catalogue names service pause/resume but not the read.
8. **Owner decision (D-F1):**
   - **F1-A (recommended):** gate with `services.view`; grant it to OPERATIONS. Keep the
     public route as is.
   - **F1-B:** also grant `services.view` to SUPPORT_AGENT, accepting that the same data is
     already public.
   - **F1-C:** retire the admin alias and have the console read `/api/services/status`,
     removing a duplicate surface entirely.
   - **F1-D:** separately decide whether a read may keep the auto-resume write side effect;
     moving it to a scheduled/owned write is a behaviour change outside this brief.
9. **Tests required before implementation:** 403 naming `services.view` for FINANCE, KYC,
   and SUPPORT (unless F1-B); 200 for OPERATIONS and SUPER; 401 for missing/forged tokens;
   proof the allow-probe does not trigger auto-resume or create an audit row; parity of the
   admin and public payloads is an owner-visible fact, not a regression to hide.

### F2 — `GET /api/admin/drivers`

1. **Route and handler:** `server.js:2350`, inline; optional `category` filter; returns
   `{ success, drivers: list, total }`.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** the whole `db.drivers` mirror object, not a projection.
   The boot hydration (`database.js:1839-1898`) carries `name`, `phone`, `dl`,
   `verifiedUpiId`, `pendingUpiId`, `upiCoolingUntil`, `payoutUpiVerified`,
   `vpaVerificationMethod`, `walletBalance`, `todayEarnings`, `currentLocation`,
   `tripHistory`, plus status/KYC fields. This is driver PII **and** financial identifiers
   **and** location in one payload. The directory is a memory mirror, so it can be stale or
   incomplete relative to Postgres.
4. **Roles that need it:** SUPER_ADMIN and OPERATIONS for fleet operations (spec §4
   "Drivers: read"). KYC needs identity data, not the fleet catalogue, and has its own
   identity routes. SUPPORT may need one driver in the context of a ticket, not the whole
   directory. FINANCE needs payout identifiers and earnings, but the payout/settlement
   routes already exist under `finance.settlement`; it does not need the full driver PII
   directory.
5. **Proposed minimum permission:** `fleet.read` on both F2 and F3.
6. **Existing name:** NO read name. `fleet.manage` exists but is a write power; using it
   would make read access imply suspend/activate.
7. **Specification proposal:** YES — `fleet.read` is `NEW` in §3 and the §4 matrix grants
   driver read to SUPER and OPERATIONS.
8. **Owner decision (D-F2):**
   - **F2-A (recommended permission):** add `fleet.read`; grant SUPER and OPERATIONS.
   - **F2-B (recommended field rule):** `fleet.read` returns an operational projection only
     (identity, category, vehicle, rating, KYC/operational status, online state, today's
     counts). Financial identifiers (`verifiedUpiId`, `pendingUpiId`,
     `payoutUpiVerified`, `vpaVerificationMethod`, `walletBalance`, `todayEarnings`) are
     removed unless the caller also holds `finance.view`; `dl` is removed unless the caller
     holds `identity_documents.view` or an approved fleet-document read. `currentLocation`
     is removed from this route and read through F13.
   - **F2-C:** grant `fleet.read` to FINANCE for a finance-only projection, or leave FINANCE
     on the settlement routes.
   - **F2-D:** decide whether SUPPORT gets a scoped single-driver read (see D-F12); do not
     grant the directory by default.
   - **F2-E:** decide whether phone is shown unmasked to OPERATIONS or masked with a
     reveal action; the current screen displays it.
9. **Tests required:** 403 naming `fleet.read` for KYC, FINANCE (unless F2-C), SUPPORT
   (unless F2-D); 200 for OPERATIONS/SUPER; a field-level assertion that no UPI identifier,
   wallet, earnings, DL, or location reaches a caller without the corresponding grant; a
   memory/degraded label assertion; category-filter correctness; no change to the
   `POST /api/admin/drivers/:id/status` gate.

### F3 — `GET /api/admin/drivers/:id`

1. **Route and handler:** `server.js:2359`, inline; finds by `id` in `db.drivers`; 404 when
   absent; returns the full object as `driver`.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** the same full mirror object as F2, for one driver. The
   404 also confirms whether an id exists.
4. **Roles that need it:** same as F2. A detail view must not be a wider hole than the list.
5. **Proposed minimum permission:** `fleet.read`, the same as F2.
6. **Existing name:** NO.
7. **Specification proposal:** YES — `fleet.read`.
8. **Owner decision:** same as D-F2; no separate role decision. If F2-B is approved, the
   detail handler must use the same projection, not a second one.
9. **Tests required:** identical 403/200 matrix as F2; field projection parity between list
   and detail; 404 for a missing id only after authorization passes; no enumeration through
   differing refusal shapes.

### F4 — `GET /api/admin/advertisements`

1. **Route and handler:** `server.js:3450`, inline; `db.listAdvertisements({ activeOnly:false })`;
   computes counts, impressions, clicks, CTR; reports `monetization.available:false`.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** advertisement rows (`title`, `merchant_id`, placement,
   image/target URLs, status, dates, clicks, impressions), aggregate campaign metrics, and
   `dataSource`/`persisted`/`degraded`. A live Postgres read failure falls back to fixture
   rows with `degraded:true`, so a 200 does not always mean durable data. No bid, price, or
   revenue column exists; `monetization` says so rather than inventing one.
4. **Roles that need it:** SUPER_ADMIN and OPERATIONS (spec §4 "Campaigns / ads / banners").
   SUPPORT does not need campaign inventory for tickets; FINANCE cannot compute revenue from
   these rows and should not infer it; KYC does not need it.
5. **Proposed minimum permission:** `advertisement.view` (NEW), or `campaign.view`
   (EXISTING) if the owner treats ads as part of the campaign domain.
6. **Existing name:** `campaign.view` exists and already gates the campaign routes; there is
   no `advertisement.view`. The write routes use the `advertisement.*` family.
7. **Specification proposal:** PARTIAL — §3 claims `advertisement.*` is existing, but there
   is no `.view`. The §4 matrix grants campaigns/ads to SUPER and OPERATIONS.
8. **Owner decision (D-F3):**
   - **F4-A (recommended):** add `advertisement.view` and grant SUPER/OPS. This keeps the
     advertisement domain's read and write names symmetrical and does not widen campaign
     access.
   - **F4-B:** reuse `campaign.view` and grant SUPER/OPS. Fewer names, but the same grant
     also opens the campaign list/live/detail routes; record that coupling.
   - **F4-C:** leave ads SUPER-only until the advertisement screen ships. This is the
     smallest change but does not match the §4 matrix.
9. **Tests required:** 403 naming the chosen permission for KYC/FINANCE/SUPPORT; 200 for
   OPERATIONS/SUPER; `degraded`/`persisted` passthrough; no invented revenue field; if
   `campaign.view` is reused, a test that the grant also opens the campaign routes (so the
   owner sees the coupling).

### F5 — `GET /api/admin/metrics`

1. **Route and handler:** `server.js:8520`, inline; `db.getAdminPlatformMetrics()`
   (`database.js:9290-9342`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** exact Postgres counts (`activeDrivers`, `activeJobs`,
   `totalCompletedJobs`, `totalUsers`, `totalRestaurants`), `totalGrossFare` summed from
   completed `final_total`, `dataSource:'postgres'`, `timestamp`. A store that cannot answer
   is 503 `AUTH_STORE_UNAVAILABLE`; there is no memory fallback. `totalGrossFare` is a
   platform-wide financial figure. A separate `GET /api/admin/finance/metrics` already
   exists under `finance.view` (`server.js:2650`).
4. **Roles that need it:** SUPER, OPERATIONS, and FINANCE per §4 "Dashboard KPI aggregate".
   SUPPORT and KYC do not need platform-wide counts.
5. **Proposed minimum permission:** `dashboard.view` (SPEC) on the route, with
   `totalGrossFare` exposed only to callers who also hold `finance.view` (or the owner may
   decide OPS sees the whole payload per §4).
6. **Existing name:** NO `dashboard.view`; `finance.view` exists but gates the finance
   metrics route and would exclude OPS.
7. **Specification proposal:** YES — `dashboard.view` is `NEW` in §3; §4 grants the KPI
   aggregate to SUPER/OPS/FINANCE.
8. **Owner decision (D-F4):**
   - **F5-A (recommended permission):** add `dashboard.view`; grant SUPER, OPERATIONS,
     FINANCE.
   - **F5-B (recommended field split):** keep the five counts under `dashboard.view`;
     return `totalGrossFare` only when the caller holds `finance.view`. OPS sees operations
     counts without platform revenue; FINANCE can also use `/admin/finance/metrics`.
   - **F5-C:** give OPS the whole payload including `totalGrossFare`, matching §4's
     unqualified dashboard row. Record that this makes a platform-wide finance metric
     available to OPERATIONS.
   - **F5-D:** restrict the whole route to `finance.view`; this would exclude OPS and
     contradict §4, so it is listed only for completeness.
9. **Tests required:** 403 naming `dashboard.view` for SUPPORT/KYC; 200 for OPS/FINANCE/
   SUPER; with F5-B, a field assertion that `totalGrossFare` is absent for an OPS caller
   without `finance.view` and present for FINANCE; 503 passthrough on an unavailable store;
   no change to `/admin/finance/metrics`.

### F6 — `GET /api/admin/jobs`

1. **Route and handler:** `server.js:8534`, inline; `db.listAdminJobs({ type, status, limit,
   offset })` (`database.js:9359-9400`). Accepted types are `RIDE`, `FOOD`, `PARCEL`,
   `GROCERY` (`database.js:12`); page size is capped at 200.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** the broadest payload in this set. `mapRowToJob`
   (`repositories/JobRepository.js:92`) produces `customerName`, `customerPhone`,
   pickup/drop addresses and coordinates, distance, fare, subtotal, discount, surge,
   packaging fee, `driverEarnings`, `platformFee`, payment fields, items, restaurant fields,
   and spread metadata. `redactAdminJobSecrets` (`database.js:28-35`) removes only
   `startOtp`, `pickupOtp`, `deliveryOtp`. The read is Postgres when live, otherwise the
   memory mirror with `degraded:true`. Customer contact data, addresses, and driver earnings
   are all in one response.
4. **Roles that need it:** SUPER, OPERATIONS, and SUPPORT for all four service types per
   §4's orders row (which names ride/food/parcel and is silent on grocery); FINANCE for ride
   jobs only, per the same row. KYC does not need the order queue.
5. **Proposed minimum permission:** the specification's per-type read names
   (`rides.read`, `food.read`, `parcel.read`, plus a grocery decision) or one new
   `orders.read` for the combined queue.
6. **Existing name:** NO suitable read name. `orders.manage` exists but is a write power and
   is SUPER-only.
7. **Specification proposal:** YES for RIDE/FOOD/PARCEL (`rides.read`, `food.read`,
   `parcel.read`); **no `grocery.read` is proposed**, although the route accepts `GROCERY`.
   This is a specification gap, not a naming detail.
8. **Owner decision (D-F5):**
   - **F6-A (recommended for a combined queue):** add one `orders.read`; grant SUPER, OPS,
     SUPPORT. Keep `type` as a filter, and require the caller to hold the permission for the
     type requested. Decide GROCERY explicitly (grant it under `orders.read` or refuse it
     for non-super roles).
   - **F6-B (spec-shaped):** add `rides.read`, `food.read`, `parcel.read`, and a fourth
     grocery read name or an explicit refusal for GROCERY. A no-`type` request must be
     filtered to the types the caller holds, not answered with all four.
   - **F6-C (FINANCE):** grant FINANCE `rides.read` only and enforce `type=RIDE` for that
     caller; or leave FINANCE on the finance routes and deny this queue.
   - **F6-D (field rule):** decide what SUPPORT may see (customer contact and address are
     needed for tickets) versus OPS (addresses for dispatch) versus FINANCE (fare breakdown,
     not customer address). A role-based projection is required if any of these differ.
   - **F6-E:** decide whether `metadata` should continue to be spread into the admin
     response. It is the least-constrained field in the payload.
9. **Tests required:** 403 naming the chosen permission(s) for KYC; 200 for each granted
   role; type-filter enforcement for FINANCE if F6-C; no-`type` filtering by held types;
   field assertions for customer phone/address and driver earnings per the approved
   projection; OTP fields absent for every role; degraded labeling; page cap.

### F7 — `GET /api/admin/restaurants`

1. **Route and handler:** `server.js:8535`, inline; `db.listAdminRestaurants({ merchantType,
   limit, offset })` (`database.js:9418-9480`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** `projectAdminMerchant` returns id, name, `address`,
   `phone`, merchant type, `location` (lat/lng), open state, approval status, rating,
   `walletBalance`, `commissionRate`, cuisines, timestamps. Postgres when live; memory with
   `degraded:true` otherwise. Merchant contact, location, and financial terms are in one
   payload.
4. **Roles that need it:** SUPER and OPERATIONS per §4 "Merchants: read". SUPPORT may need a
   merchant's contact for a ticket, not the whole directory. FINANCE needs merchant
   settlement/commission data, but the settlement routes exist; it does not need the
   directory by default. KYC does not need it.
5. **Proposed minimum permission:** `merchants.read` (SPEC).
6. **Existing name:** NO read name. `merchant.manage` exists but is a write power and
   already gates the merchant approval/status/dark-store routes.
7. **Specification proposal:** YES — `merchants.read` is `NEW` in §3; §4 grants merchant
   read to SUPER/OPS.
8. **Owner decision (D-F6):**
   - **F7-A (recommended permission):** add `merchants.read`; grant SUPER and OPERATIONS.
   - **F7-B (recommended field rule):** `walletBalance` and `commissionRate` require
     `finance.view` in addition to `merchants.read`; OPS sees the directory without merchant
     financial terms. Address/phone/location remain for OPS because they are operational.
   - **F7-C:** grant FINANCE `merchants.read` for a financial-only projection, or leave
     FINANCE on the settlement routes.
   - **F7-D:** decide whether SUPPORT gets a scoped merchant read (D-F12).
9. **Tests required:** 403 naming `merchants.read` for KYC/SUPPORT and FINANCE (unless
   F7-C); 200 for OPS/SUPER; wallet/commission field assertions under F7-B; degraded
   labeling; merchant-type filter; no change to the `merchant.manage` write routes.

### F8 — `GET /api/admin/master-catalog`

1. **Route and handler:** `server.js:9049`, inline; `db.getMasterProducts()`
   (`database.js:5535-5548`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** master grocery products (`id`, `name`, `category`,
   `subcategory`, `brand`, `standard_unit`, `pack_size`, `standard_image_url`,
   `pricing_model`, `is_active`, `created_at`). Postgres filters `is_active=true`; the memory
   fallback returns all products, so live and fallback answers differ in row set. No prices,
   PII, or financial values. Sensitivity is low, but the catalogue is platform product data.
4. **Roles that need it:** SUPER only per §4 "Catalogue + bulk". OPERATIONS runs stores, not
   the master catalogue, in the target matrix. KYC, FINANCE, and SUPPORT do not need it.
5. **Proposed minimum permission:** `catalog.read` (NEW) or `catalog.manage` (EXISTING
   write name).
6. **Existing name:** `catalog.manage` exists and already gates the three master-catalogue
   writes; using it for read conflates read with create/update/delete, but it is SUPER-only
   and matches the specification's role outcome.
7. **Specification proposal:** PARTIAL — §3 proposes `catalog.bulk`, a write, not a read
   name. The §4 matrix says catalogue is SUPER only.
8. **Owner decision (D-F7):**
   - **F8-A (recommended for read/write separation):** add `catalog.read`; grant SUPER only.
     This adds a name but keeps read and write separate.
   - **F8-B (smallest change):** gate the read with `catalog.manage`; grant none new.
     Read access implies write capability for any future non-super holder, so record the
     conflation.
   - **F8-C:** leave it ungated but declare it an "any signed-in administrator" read
     (decision 11 option b). This contradicts §4 and is not recommended.
9. **Tests required:** 403 naming the chosen permission for all four non-super roles; 200
   for SUPER; array-free registration unchanged; active-only row set in the live branch; a
   test that the read does not call any write route; if F8-B, a test documenting that the
   same grant opens the writes.

### F9 — `GET /api/admin/master-catalog/:id/stores`

1. **Route and handler:** `server.js:9100`, inline; `db.getMasterProductStoreMatrix(id)`
   (`database.js:5684-5750`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** `masterProduct`, `totalLinkedStores`, and per-store
   `merchantId`, `merchantName`, optional `merchantAddress`, `mrp` (null in the live branch),
   `currentPrice`, `stockQty`, `isAvailable`, `lastUpdated`. The memory branch can include
   `mrp`. Low–medium: merchant identity/address and retail price/stock, no customer data.
4. **Roles that need it:** SUPER only per §4 "Catalogue + bulk". OPS may inspect stores, but
   the target matrix gives catalogue to SUPER only; do not infer OPS access from its store
   role.
5. **Proposed minimum permission:** same as F8 (`catalog.read` preferred, or
   `catalog.manage`).
6. **Existing name:** same as F8.
7. **Specification proposal:** same as F8.
8. **Owner decision:** D-F7 covers it; the detail read must use the same permission as the
   list, not a narrower or wider one.
9. **Tests required:** same 403/200 matrix; 404 after authorization; live-vs-memory `mrp`
   difference documented, not asserted as a stable shape; merchant address only when the
   durable row carries one; no customer data.

### F10 — `GET /api/admin/grocery/price-alerts`

1. **Route and handler:** `server.js:9679`, inline; `db.getUnusualPriceAlerts()`
   (`database.js:6495-6509`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** alerts derived from `groceryPriceHistory` when a price
   moves at least 25%, with `alertType`, `pctChange`, and a message. The source is always
   `dataSource:'memory'`, `degraded:true`; there is no durable cross-tenant price-history
   read. Sensitivity is medium: merchant/product pricing, but the view is one process's
   memory and resets on restart.
4. **Roles that need it:** SUPER and OPERATIONS for grocery price integrity. FINANCE may
   care about pricing but the target matrix does not grant catalogue/pricing review to it.
   SUPPORT and KYC do not need it.
5. **Proposed minimum permission:** `grocery.alerts.view` (NEW) or `grocery.review`
   (EXISTING write name, SUPER-only today).
6. **Existing name:** `grocery.review` exists and gates the price review write; there is no
   read name.
7. **Specification proposal:** NO read name. §3 does not propose one; decision 11's option
   (a) does not mention it.
8. **Owner decision (D-F8):**
   - **F10-A (recommended):** add `grocery.alerts.view`; grant SUPER and OPERATIONS.
   - **F10-B:** gate with `grocery.review`, SUPER only. This excludes OPS and conflates read
     with the review decision.
   - **F10-C:** accept that the feed is memory-only and label it on the screen; any role
     granted sees an incomplete view. The `degraded:true` field already says so.
9. **Tests required:** 403 naming the chosen permission for KYC/FINANCE/SUPPORT; 200 for
   OPS/SUPER; `dataSource:'memory'` and `degraded:true` preserved; no assertion that the
   feed is complete; no write triggered by the read.

### F11 — `GET /api/admin/supabase-status`

1. **Route and handler:** `server.js:9711`, inline; `checkSupabaseConnection()`
   (`backend/src/supabase.js:80-103`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** environment, project ref, configured/connected/ready,
   mode, `userCount`. The engine's error text is logged with the admin id and stripped from
   the response; no credentials are returned. This is infrastructure metadata: useful for
   outage triage, but it discloses deployment identity and a user count.
4. **Roles that need it:** SUPER and FINANCE per §4 "Health + integrations". OPERATIONS has
   an incident-response argument; SUPPORT can use the public service status; KYC does not
   need it.
5. **Proposed minimum permission:** `system.health` (SPEC).
6. **Existing name:** NO. `services.view` is service state, not database health.
7. **Specification proposal:** YES — `system.health` is `NEW` in §3; §4 grants health to
   SUPER/FINANCE.
8. **Owner decision (D-F9):**
   - **F11-A (recommended, spec-aligned):** add `system.health`; grant SUPER and FINANCE.
   - **F11-B:** also grant OPERATIONS for outage triage. This is an explicit widening beyond
     §4; record it.
   - **F11-C:** SUPER only. Smallest exposure, but it removes FINANCE's spec-granted health
     read.
9. **Tests required:** 403 naming `system.health` for KYC/SUPPORT and OPS (unless F11-B);
   200 for FINANCE/SUPER; response contains no `error` field and no secret-shaped value;
   the probe does not mutate the store; user count comes from the live probe.

### F12 — `GET ['/api/admin/features','/api/v1/admin/features']`

1. **Route and handler:** `server.js:9749`, one array registration; `featureControlService.refreshCache()`;
   returns every cache entry as `adminFeatures[key] = val`.
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles. The
   write twins are handler-decided: `POST` (`:9762`) checks `adminRole !== 'SUPER_ADMIN'`
   and `PUT /:key` (`:9847`) does the same before its own key/namespace validation.
3. **Returned data / sensitivity:** full flag objects, not just `enabled`. The public twin
   (`/api/features`, `/api/v1/features`, `:9736`) returns only `{ enabled }`. Descriptions
   and any extra fields are internal configuration. Medium: the flags decide customer-facing
   service availability; a read is not a write, but it reveals the control surface.
4. **Roles that need it:** SUPER only per §4 "Settings + feature flags". OPS may want to know
   whether a service is enabled, but it can use `services.view`/the public service state;
   KYC, FINANCE, and SUPPORT do not need the flag panel.
5. **Proposed minimum permission:** `feature.view` (SPEC) on the **GET** only. The POST/PUT
   handler checks must remain unchanged.
6. **Existing name:** NO.
7. **Specification proposal:** YES — `feature.view` is `NEW` in §3; §4 gives flags to SUPER
   only.
8. **Owner decision (D-F10):**
   - **F12-A (recommended):** add `feature.view`; grant SUPER only.
   - **F12-B:** let `services.view` cover the flag read. This conflates service status with
     feature configuration and would give OPS full flag values; not recommended.
   - **F12-C:** leave the read handler-decided like the writes. That keeps the current
     any-admin access unless the handler is changed, so it does not meet the brief.
9. **Tests required:** 403 naming `feature.view` for all four non-super roles on **both**
   array paths; 200 for SUPER on both paths; public twin still returns only `enabled`;
   `POST`/`PUT` still refuse non-super with their existing handler response; no write is
   triggered by GET.

### F13 — `GET ['/api/v1/fleet/locations','/api/fleet/locations']`

1. **Route and handler:** `server.js:10353`, one array registration; `db.getFleetLocations({
   serviceType, isOnlineOnly })` (`database.js:10175-10184`).
2. **Current middleware / effective access:** `authenticateAdmin` only; all five roles.
3. **Returned data / sensitivity:** memory `fleetLocations` records: `driverId`, `name`,
   `phone`, `vehicleType`, `lat`, `lng`, `heading`, `speed`, `accuracy`, `receivedAt`,
   `isOnline`, `status`, `activeJobId`, `serviceType`, `updatedAt`. The store resets on
   restart (decision 4 is still open: persist or label the reset). The seed
   (`database.js:224-237`) is a fabricated Delhi record, `DRV-101` / "Rajesh Kumar" /
   `+91 98101 22334`; `updateDriverLocation` (`:10138-10167`) carries real name/phone when
   the record was written from a driver row. Highest sensitivity in this set: live location
   plus contact data.
4. **Roles that need it:** SUPER and OPERATIONS per §4 "Live operations centre + map".
   SUPPORT could use a location only while handling an active delivery ticket; that needs a
   scoped route, not the fleet feed. FINANCE and KYC do not need live locations.
5. **Proposed minimum permission:** `map.view` or `operations.live` (both SPEC; one name must
   be chosen). `map.view` is the literal name for this feed; `operations.live` describes the
   operations-centre capability as a whole. The Brief E audit calls `operations.live` the
   target; this proposal records that conflict rather than silently choosing.
6. **Existing name:** NO. `fleet.manage` is a write power; `map.view` and `operations.live`
   are not in the catalogue.
7. **Specification proposal:** YES, but ambiguous — §3 names both `operations.live` and
   `map.view`; the §4 matrix has one row for "Live operations centre + map".
8. **Owner decision:** see the separate live-location section (§4) and D-F11.
9. **Tests required:** 403 naming the chosen permission for KYC/FINANCE/SUPPORT; 200 for
   OPS/SUPER; both array paths; no fabricated driver appears as a real one (the seed is a
   fixture and must be labelled or removed); a record without identity fields returns null,
   not a substituted name/phone; service/online filters; restart behaviour documented, not
   asserted as durable.

---

## 4. The separate live-location question

Live driver positions are the one category where "who needs it" cannot be answered by the
current route shape, because the route returns the **whole fleet** with identity attached.
The owner must choose both a permission name and a role set.

| Option | Who can read the fleet feed | Consequence |
|---|---|---|
| **L1 (recommended)** | SUPER + OPERATIONS, gate `map.view` or `operations.live` | Matches §4; dispatch and incident response work; no other role sees live positions. |
| **L2** | L1 + SUPPORT, scoped to an active ticket/job | Requires a new scoped route or server-side filter; the current whole-fleet route would over-grant. Do not implement by granting SUPPORT the whole feed. |
| **L3** | L1 + FINANCE | Finance has no operational need for live positions; it would add PII/location exposure for no workflow. Not recommended. |
| **L4** | L1 + KYC | KYC has no use for live positions; identity review uses its own queue. Not recommended. |
| **L5** | Any signed-in administrator (current behaviour, declared) | Decision 11 option (b); contradicts §4 and leaves the highest-sensitivity route open to all five roles. Not recommended. |

Name decision:

- **F13-A:** `map.view` — literal, gates the fleet feed; `operations.live` remains a future
  page-level capability.
- **F13-B:** `operations.live` — matches the Brief E audit's stated target; covers the live
  operations centre and its map data with one name.
- **F13-C:** adopt both now (`operations.live` for the page, `map.view` for the feed). This
  is the most names but the clearest separation; it also means the feed can be granted
  without the whole operations centre.

Field decision:

- **F13-D:** remove `name` and `phone` from the fleet feed and let the map join the driver
  directory by `driverId` (which itself needs `fleet.read`). This keeps the location feed
  minimal.
- **F13-E:** keep identity for OPS/SUPER only, and return a coordinate-only projection to any
  future scoped SUPPORT route.
- **F13-F:** decide whether the fabricated `DRV-101` seed may remain. It is a Delhi record
  with a dialable phone and no driver row behind it; it should be labelled as a demo fixture
  or removed before any non-super role is granted access.

---

## 5. Proposed role-by-route outcome

This is the decision the owner is being asked to approve. **● = proposed read access;
○ = proposed denial. No role gains a write permission in this matrix.** Conditions in
parentheses are the field-level decisions above.

| Route | SUPER | OPS | FINANCE | SUPPORT | KYC | Proposed gate |
|---|---|---|---|---|---|---|
| F1 services status | ● | ● | ○ | ○ (public route available) | ○ | `services.view` |
| F2 drivers list | ● | ● | ○ (or finance-only projection) | ○ (scoped only) | ○ | `fleet.read` |
| F3 driver detail | ● | ● | ○ (or finance-only projection) | ○ (scoped only) | ○ | `fleet.read` |
| F4 advertisements | ● | ● | ○ | ○ | ○ | `advertisement.view` (or `campaign.view`) |
| F5 metrics | ● | ● | ● | ○ | ○ | `dashboard.view`; fare with `finance.view` |
| F6 jobs | ● | ● | ride only | ● | ○ | `rides.read`/`food.read`/`parcel.read` (+ grocery decision) or `orders.read` |
| F7 restaurants | ● | ● | ○ (or finance-only projection) | ○ (scoped only) | ○ | `merchants.read`; wallet/commission with `finance.view` |
| F8 master catalogue | ● | ○ | ○ | ○ | ○ | `catalog.read` (or `catalog.manage`) |
| F9 store matrix | ● | ○ | ○ | ○ | ○ | same as F8 |
| F10 price alerts | ● | ● | ○ | ○ | ○ | `grocery.alerts.view` (or `grocery.review`) |
| F11 supabase status | ● | ○ (optional) | ● | ○ | ○ | `system.health` |
| F12 features GET | ● | ○ | ○ | ○ | ○ | `feature.view` |
| F13 fleet locations | ● | ● | ○ | ○ (scoped only) | ○ | `map.view` or `operations.live` |

Totals if the recommended options are approved: SUPER 13/13; OPERATIONS 9/13 (F1, F2, F3,
F4, F5, F6, F7, F10, F13); FINANCE 3/13 (F5, F11, F6 ride-only); SUPPORT 1/13 (F6); KYC
0/13. These totals are a consequence of the route rows, not a separate grant decision.

**Read/write separation check.** Every proposed gate is a read name. The only write names
used are fallbacks (`catalog.manage` for F8/F9, `grocery.review` for F10) and they are
marked as fallbacks, not recommendations. No write route's middleware changes. `POST`
`/api/admin/drivers/:id/status` keeps `fleet.manage`; the three master-catalogue writes keep
`catalog.manage`; the price review keeps `grocery.review`; the advertisement writes keep
`advertisement.create/edit/delete`.

---

## 6. Cross-cutting decisions the route table cannot express

1. **Field-level projections are not optional for F2, F3, F5, F6, F7, and F13.** Gating a
   route only decides who enters; it does not decide what they see. The current payloads
   combine operational data with financial identifiers, customer contact data, and live
   location. The owner must approve the projection before implementation, or accept the
   whole payload for each granted role in writing.
2. **Customer contact and addresses (F6).** SUPPORT needs them to answer a ticket; OPS may
   need addresses to dispatch; FINANCE needs fare figures, not the customer's address. If
   these roles all receive the same payload, the least-privilege claim is false even though
   the route is gated.
3. **Driver financial identifiers (F2/F3).** UPI ids, payout verification state, wallet
   balance, and earnings are not fleet-operations data. FINANCE already has settlement
   routes; do not grant the driver directory to FINANCE just to reach them.
4. **Merchant financial terms (F7).** `walletBalance` and `commissionRate` are finance data.
   OPS needs the storefront directory but not necessarily these columns.
5. **Platform-wide finance metrics (F5).** `totalGrossFare` is a platform revenue aggregate,
   not an operations count. A separate `finance.view`-gated finance metrics route already
   exists. Splitting the field is the least-privilege option; granting the whole payload to
   OPS should be an explicit decision.
6. **Advertisements do not contain revenue.** The route says so; no bid/price column exists.
   Do not add a revenue figure to justify a finance role for F4.
7. **Catalogue data is low sensitivity but still product data.** SUPER-only per §4 is a
   role decision, not a claim that the rows are dangerous.
8. **Health metadata is not secret-free by accident.** The error text is logged and
   stripped; the project ref, mode, and user count remain. Treat it as infrastructure
   metadata with a named reader, not as anonymous status.
9. **Feature flags reveal control state.** The public twin already reveals `enabled`; the
   admin twin reveals the full objects. A read name is still needed because the public twin
   is deliberately narrower.
10. **Live locations reset on restart.** Decision 4 is open. Until it is answered, any
    grant to F13 is a grant to a memory view, not a durable location history. The seed
    contains a fabricated driver; do not let it pass as a real fleet member.
11. **The admin-web demo token bypasses the backend.** `admin-web/src/lib/api.ts:21-136`
    installs an axios adapter for any token starting with `demo-` and returns fabricated
    data for many of these endpoints. A UAT run with a demo token proves nothing about
    authorization; every regression test below must use a real administrator session.
12. **The UI currently calls these reads without a role gate.** After the backend gates
    land, a role without the permission must see a hidden/labelled control, not a button
    that answers 403. That is implementation work, not part of this proposal.

---

## 7. Source discrepancies (reported, not reconciled)

1. **`docs/ADMIN_PERMISSION_MATRIX.md` §5 line citations are stale.** The route table cites
   `server.js` lines such as `:1091`, `:1513`, `:1470`, `:6088`, `:6003`, `:5990`,
   `:6389`, `:2466`, `:5082`, `:5083`, `:5057`, `:5417`, `:5452`, `:5920`, and `:5952`.
   The current working tree registers these routes at different lines (for example F2 at
   `:2350`, F6 at `:8534`, F8 at `:9049`). The audit's conclusions are still usable; its
   line anchors are not.
2. **The matrix says CAT-04 cannot see array registrations; the current parser can.** The
   Brief E parser is statement-level and counts the array-form features and fleet
   registrations inside the 17. `docs/ADMIN_PERMISSION_MATRIX.md` §5 still describes the
   line-based limitation. The measured ceiling is 17, not a count that omits the arrays.
3. **The matrix says `map.view` gates nothing.** `map.view` is not in
   `adminPermissions.js` at all. The same sentence calls `operations.live` the target;
   neither name exists yet. This is a naming conflict, not a measured gate.
4. **`ADMIN_FEATURE_SPECIFICATION.md` §5 row 33 is stale and internally inconsistent.**
   It says "60 of 79 routes" and "14 ungated" and "3 handler-decided"; Brief E measured
   89 registrations, 70 gated, 2 super-admin-only, 17 authentication-only, with 13 data
   reads and 4 handler-decided. The row also lists `POST /api/v1/admin/features` among the
   reads that answer to any valid token, but that registration has a handler SUPER_ADMIN
   check and is a write. The row's "76→79" history is older still.
5. **The specification says `advertisement.*` is existing.** Only
   `advertisement.create`, `advertisement.edit`, and `advertisement.delete` exist. There is
   no `advertisement.view`; F4 needs one or must reuse `campaign.view`.
6. **Several §3 `NEW` markers are no longer accurate.** `customers.read`,
   `customers.suspend`, `promotion.activate`, and `geofence.edit` are in the live catalogue
   now. `notification.view` is also present (granted, gates nothing). The `NEW` marker
   should not be used as evidence that a name is unavailable.
7. **Decision 11 option (a) cannot cover the 13.** It lists `services.view`,
   `promotion.view`, `catalog.manage`, `merchant.manage`, `fleet.manage`, `audit.view`, and
   `system.health`. That set fits F1 and F11 and reaches F2/F3, F7, F8/F9 only through write
   names; it fits none of F4, F5, F6, F10, F12, F13. The decision needs the new read names
   proposed here, or it needs to declare a narrower scope.
8. **`services.view` exists but gates nothing.** This is the one existing read name that
   can be put to work without inventing a string; the matrix lists it among the nine
   granted-but-unenforced names.
9. **The `GET /api/admin/services/status` data is already public.** It returns exactly the
   same `db.getServicesStatus()` payload as the anonymous `/api/services/status`. Gating the
   admin alias does not make the data confidential; it only names the caller. The GET also
   auto-resumes due pauses and writes `SERVICE_AUTO_RESUMED` audit rows.
10. **The specification's §4 orders row omits GROCERY, but the route accepts it.**
    `ADMIN_JOB_SERVICE_TYPES` is `['RIDE','FOOD','PARCEL','GROCERY']`; the route's `type`
    filter accepts all four. Any per-type permission model must decide grocery explicitly.
11. **The specification's §4 driver read row does not mention financial identifiers.**
    Granting `fleet.read` to OPERATIONS without a projection gives OPS UPI ids, wallet
    balances, and earnings, not just fleet data.
12. **`GET /api/admin/features` is an array registration and the public twin is narrower.**
    The admin GET returns full flag values on both `/api/admin/features` and
    `/api/v1/admin/features`; the public GET returns only `{ enabled }`. A gate must cover
    both paths.
13. **The specification's §4 merchants row does not mention wallet/commission.** Granting
    `merchants.read` to OPS without a projection gives OPS merchant financial terms.
14. **The Brief E baseline is not a full-chain verdict.** Brief E's subset run was
    `chain_20261021_105032_80324_70d4d3`, link 14 exit 0, 118/118 checks, contamination
    false, census `drift` (`audit_logs` +935, `backend_sessions` +2). It is evidence for the
    route count only; no full-chain claim is made here.

---

## 8. Regression tests required before implementation

These are the tests to write (RED first) in the implementation brief. They are **not**
written or run in this documentary brief.

| ID | Test | Applies to |
|---|---|---|
| T1 | Route census update: the 13 reads become permission-gated; the remaining authentication-only registrations are exactly `me`, `reset-password`, and the two feature writes; UPDATE `CAT-04`, `AUTH-401`, and `CAT-07` (17 → 4). | harness |
| T2 | 403 with the required permission name for every non-granted role, on every registration, including both array paths. | F1–F13 |
| T3 | 200 for every granted non-super role using a real administrator session (never a `demo-` token). | F1–F13 |
| T4 | SUPER_ADMIN still passes every route (wildcard), and the explicit grant list still reports the new names in `/me`. | F1–F13 |
| T5 | Anonymous and forged tokens still get 401, not 403, on every route. | F1–F13 |
| T6 | Read/write separation: no read gate is a write name unless the owner chose the documented fallback; every existing write gate is unchanged. | all |
| T7 | `GET /api/admin/me` remains identity-only and unchanged. | preserve |
| T8 | `GET/PUT /api/admin/platform-settings` remain `authenticateAdmin, requireSuperAdmin`; no non-super access. | preserve |
| T9 | Field-level projections: financial identifiers, customer contact/address, merchant wallet/commission, and location are absent unless the approved additional grant is held. | F2/F3/F5/F6/F7/F13 |
| T10 | Durable/degraded semantics: metrics 503 on store outage; jobs/restaurants/ads keep `dataSource`/`degraded`/`persisted`; price alerts say `memory`/`degraded`; catalogue live branch filters inactive rows. | F4–F10 |
| T11 | Array-alias parity: `/api/admin/features` and `/api/v1/admin/features`; `/api/v1/fleet/locations` and `/api/fleet/locations` return the same authorization outcome. | F12/F13 |
| T12 | The F1 allow-probe does not trigger auto-resume or write an audit row; or, if the side effect is retained, the test records it as a known mutation. | F1 |
| T13 | Fleet seed truthfulness: no fabricated `DRV-101` identity is presented as a real driver; identity fields are null when not stored. | F13 |
| T14 | Link-14 focused run after implementation: `admin_authorization_test.js` updated and green; do not claim a full-chain verdict from a subset. | harness |

Implementation ordering: catalogue/gate helpers → F1/F8/F9/F12 (SUPER-only or existing-name
routes) → F5/F11 (dashboard/health) → F2/F3/F7/F4/F10 (operations reads with projections) →
F6/F13 (highest-sensitivity, last, after projections and the live-location decision). Each
step keeps the write routes and `/me` untouched.

---

## 9. Verification statement for this brief

- Work performed: source reading and documentation only. No middleware, handler, role grant,
  permission catalogue, response shape, super-admin gate, `/api/admin/me`, platform-settings,
  migration, snapshot, or financial record was changed.
- No test suite and no chain run was executed in this brief. No claim is made that the policy
  is implemented, that any route is gated, or that the chain is green.
- Files changed: this document (`docs/ADMIN_LEAST_PRIVILEGE_DECISION_MATRIX.md`). The
  pre-existing working-tree modifications were left untouched.
- Measurements reused from Brief E are identified as such; the route and payload facts above
  were re-read from the current working tree on 2026-10-21.

---

## 10. Owner approval checklist

Answer each line with **approve**, **change**, or **defer**. Only approved lines are
implemented; deferred lines stay ungated and the reason is recorded.

### Route gates

- [ ] **F1** — gate `GET /api/admin/services/status` with `services.view`; grant OPERATIONS. (Choose F1-A / F1-B / F1-C; separately decide F1-D on the GET side effect.)
- [ ] **F2/F3** — add `fleet.read`; grant SUPER + OPERATIONS; approve the operational projection (F2-B) and the phone rule (F2-E).
- [ ] **F4** — choose `advertisement.view` (F4-A) or `campaign.view` (F4-B); grant SUPER + OPERATIONS.
- [ ] **F5** — add `dashboard.view`; grant SUPER + OPERATIONS + FINANCE; choose whether `totalGrossFare` requires `finance.view` (F5-B) or is included for OPS (F5-C).
- [ ] **F6** — choose one `orders.read` (F6-A) or the per-type names plus a GROCERY rule (F6-B); grant SUPER + OPERATIONS + SUPPORT; decide FINANCE ride-only (F6-C) and the PII projection (F6-D/E).
- [ ] **F7** — add `merchants.read`; grant SUPER + OPERATIONS; choose whether `walletBalance`/`commissionRate` require `finance.view` (F7-B).
- [ ] **F8/F9** — choose `catalog.read` (F8-A) or `catalog.manage` (F8-B); grant SUPER only.
- [ ] **F10** — choose `grocery.alerts.view` (F10-A) or `grocery.review` (F10-B); grant SUPER + OPERATIONS.
- [ ] **F11** — add `system.health`; grant SUPER + FINANCE (F11-A), optionally OPERATIONS (F11-B).
- [ ] **F12** — add `feature.view`; grant SUPER only on the GET; leave POST/PUT handler checks unchanged.
- [ ] **F13** — choose `map.view` (F13-A), `operations.live` (F13-B), or both (F13-C); grant SUPER + OPERATIONS; choose the identity field rule (F13-D/E) and the seed rule (F13-F).

### Separate live-location decision

- [ ] **L1** — restrict to SUPER + OPERATIONS (recommended).
- [ ] **L2** — add SUPPORT only through a scoped ticket/job route, never the whole feed.
- [ ] **L3** — add FINANCE (not recommended).
- [ ] **L4** — add KYC (not recommended).
- [ ] **L5** — declare any signed-in administrator (current behaviour; not recommended).

### Cross-cutting

- [ ] Approve the field-level projection as a required part of implementation for F2, F3, F5, F6, F7, and F13.
- [ ] Approve that all tests use real administrator sessions, not `demo-` tokens, and that the UI is gated to hide denied actions rather than showing 403 buttons.
- [ ] Confirm that no write permission is granted by this matrix; fallback write names (`catalog.manage`, `grocery.review`) are accepted or replaced with the read names.
- [ ] Confirm that `/api/admin/me`, `/api/admin/platform-settings`, anonymous/forged-token rejection, and the four handler-decided registrations stay unchanged.

**Do not implement any line above until it is explicitly approved.** After approval, the
implementation brief should update `admin_authorization_test.js` in the same change as the
route gates and run the focused link-14 suite, not a full chain.
