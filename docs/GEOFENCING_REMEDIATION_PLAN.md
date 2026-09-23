# NABIN — Geo-Fencing Remediation Plan

Written before any code change, as Phase 0 requires. Every finding, term and verdict below is
taken from `docs/GEOFENCING_SECURITY_AUDIT.md` (2026-09-23); nothing in the audit's §14 list is
resolved here. **Nine unresolved business decisions are carried forward unchanged, and five of
this order's phases cannot be implemented without one of them being answered first** — those are
named in §9 rather than worked around.

Standing constraints observed: local Docker store and local backend only; no push, deploy,
hosted TEST/PROD contact, live payment activation, `SUPER_ADMIN` creation, secret exposure,
migration applied, or existing test weakened.

---

## 1. The two carried-over documentation corrections, inspected

Both were disclosed by the previous order rather than silently left; Phase 0 asked for an
inspection, and the inspection changes their status.

1. **`docs/ADMIN_FEATURE_SPECIFICATION.md:660` (area 45) claims "WALKED, all eight routes".**
   The routes are `/`, `/campaigns`, `/customers`, `/drivers`, `/login`, `/merchants`,
   `/orders`, `/security` — verified against the filesystem this session (`page.tsx` count: 8).
   The sentence's own narrative accounts for the customers screen plus **five** named others
   (dashboard, `/drivers`, `/merchants`, `/orders`, `/campaigns`) = six, §8 records seven, and
   **`/login` has never been walked at any width**. So the claim is overstated by two routes, and
   `/security`'s status is only as good as §8's record. Fix: restate the count to what was
   walked, and put the two unwalked routes into this order's Phase 18 walk list rather than
   leaving them asserted. **Not a code defect; a false claim in a document that other work cites.**
2. **`admin_authorization_test.js` CAT-04 / CAT-06 parse registrations with
   `/^app\.(get|post|put|patch|delete)\('([^']+)'/` (line 335).** That pattern cannot see an
   array-form registration, and the backend has at least one on the geo-adjacent path —
   `app.post(['/api/v1/driver/location', '/api/driver/location'], …)` (`server.js:6293`). So a
   duplicate-registered array route would pass CAT-06 and an array-gated route would be missing
   from CAT-04's list, which means **the two tests that exist to stop a gate count drifting are
   themselves blind to the one syntax a gate can hide in**. Fix: parse both the array form and
   double-quoted paths. Strengthening a test, so permitted by the "do not weaken tests" rule.

Both are in scope for this pass because the audit names them; neither is a geo-fence policy
question.

---

## 2. Every audit FAIL, and what enforcement layer it belongs to

The layer column matters more than the fix column: a check in the wrong layer is how this
codebase ended up with a table and no enforcement.

| # | Audit FAIL | Current behaviour (measured) | Intended enforcement layer | Fix in this order? |
|---|---|---|---|---|
| F1 | SERVICE AREA ENFORCEMENT, RIDE, FOOD, PARCEL | `evaluateLocationGeofences` has exactly two consumers — `server.js:2917` and `database.js:2337`. Bookings from Mumbai / New York / `lat: 999` / `lat:"abc"` all 200 and persist. `OUTSIDE_SERVICE_AREA` exists nowhere | GeoPolicyService, called by the booking handlers, refused **before** a job row is written | **NO — blocked by §14-1** |
| F2 | DISPATCH | Offers to every driver not `SUSPENDED`; `distance_to_pickup`/`rank_score` never written | Dispatch, after the policy engine answers for the pickup point | **NO — blocked by §14-1** (dispatch is meaningless until eligibility is defined) |
| F3 | DRIVER (containment half) | No fence tested at go-online / accept / arrived / start / complete; `POST /api/driver/location` stores a validated position that nothing uses | Driver lifecycle, one call into the policy engine per transition | **Partly — the trust half is unblocked (§14-1 not needed to stop trusting a client-sent flag); the gate itself is blocked** |
| F4 | PRICING | `Math.max(global, geo-if-inside, firstActiveSurgeRule)` at `database.js:2331-2359`; the third term has no containment, no time test, no priority | GeoPolicyService returns the modifier; `calculateFareEstimate` consumes only that | **YES for the client-authority and fallback halves; the containment/time-window half is blocked by §14-4** |
| F5 | SURGE | All 418 rules `ACTIVE`+`RIDE` with `start_time` set surge every ride quote: Mumbai `surge=2.2 ₹565`, healthy vs starved ₹565/₹363 for one identical request | Same engine; rules keyed to their own fence geometry and window | **NO — blocked by §14-4** |
| F6 | SECURITY | `zoneId` in the body moves a real job's fare ₹105 → ₹255 (`database.js:2344-2352`); `POST /api/geofence/evaluate` is tokenless; anon key reads 420 fences / 269 KB | Server-derives-everything; policy engine refuses a caller-named zone | **YES for the `zoneId` branch (F6a). The endpoint's anonymity is blocked by §14-8; the anon read is §14-8/RLS work and needs a migration → STOP** |
| F7 | ADMIN (edit/activate/deactivate/archive, validation) | 404 on `PUT`/`PATCH`/`archive`; no `DELETE /api/admin/surgezones/:id`; `createGeoFence` substitutes a hard-coded Delhi triangle for a 2-point polygon and returns 200 | Route + repository validation, permission-gated and audited | **YES for never-substitute + reject-invalid. `archive` needs a column → migration → STOP-and-report** |
| F8 | OVERLAPPING ZONES | max multiplier + **summed** surcharge + newest wins; `priority` ignored; 179 duplicate Noida polygons → ₹7,076 and a 143,866-byte response | Policy engine's aggregation step | **YES for duplicate exclusion (charging once per distinct polygon is not a commercial policy). Max-vs-sum across genuinely distinct overlaps stays §14-3** |
| F9 | FAILURE HANDLING | `if (!gfErr && dbFences.length > 0)` (`:1977/:1987`) leaves seed arrays authoritative; `activeZoneName` initialised to the literal `'Standard Operational Area'` (`:2332`); invalid coords → `inside:false` 200, indistinguishable from outside | Repository hydration + policy engine, with cache **never** an authorization source | **YES — this is Phase 2/5, explicitly directed** |

## 3. Every PARTIALLY IMPLEMENTED item

| Item | What exists | What is missing | Layer |
|---|---|---|---|
| GEO-FENCE DATABASE (DATABASE ONLY → needs app enforcement) | 420 rows, sound CHECKs, FK `surge_zones.zone_id → geo_fences.id ON DELETE CASCADE` verified, `NUMERIC(10,7)`, 6 btree indexes | Any read path that decides something; any spatial index; any write-time range check on `coordinates` | Repository validation + engine |
| RLS | `p_read_active_geofences` (SELECT, `is_active=true`), `p_read_active_surge_zones` (`status='ACTIVE'`), grant-level 401 on anon writes, differential proven (service sees an inactive fence, anon does not) | It constrains only the anon/authenticated path; the backend is `service_role`, so it authorises nothing server-side — which §11 answer 8 of the admin spec already states as the project's posture | Unchanged; tightening is §14-8 + a migration |
| DRIVER (telemetry half) | One shared validator for REST + WS, 8/8 rejections, server-clock `receivedAt`, impersonation 403 | Containment, and any use of the stored position by a decision | Lifecycle gates (blocked) |
| ADMIN geo routes | 5 routes, 5 catalogue names, permission-named 403s verified with a provisioned non-super account, awaited audit writes | Update/activate/deactivate/archive; surge delete; honest geometry validation | Repository + routes |
| BOUNDARY (correct maths, no safeguards) | ±1 m circle boundary behaves, `<=` on the boundary, polygons ≥3 points, no lost precision | No on-edge definition for polygons, no bbox prefilter, polygons carry no centre, and the write path can store a shape the operator never drew | Engine + validation |
| PERFORMANCE | 1,325/621 rps at 50-way concurrency, in-process arithmetic, no per-request query | Spatial index; the 143 KB / 5,162-byte response shapes; 838-card admin render | Engine response shape |

## 4. What this pass will actually change (unblocked set)

1. **`GeoPolicyService`** (`backend/src/services/GeoPolicyService.js`) — one authority returning
   `{ validCoordinates, locationValidated, insideServiceArea, matchedFences, applicablePricingZones,
   applicableSurgeRules, activeZoneName, rejectionReason }`, where `locationValidated` is *false*
   unless the store answered, and `activeZoneName` is `null` unless something matched.
   `evaluateLocationGeofences`, `calculateFareEstimate`, the public evaluate route and the admin
   list all consume it; no second copy of the containment rule.
2. **Cache is never an authorization source** — hydration tracks validated/unvalidated and
   populated/empty separately; the seed arrays stop being reachable as business state; a booking-
   critical call under an unreadable store gets the existing 503 refusal shape
   (`settleAuthoritative` / `authStoreUnavailable`, `database.js:5112-5140`, with a
   `GEO_STORE_UNAVAILABLE` sibling), carrying no internal error text to the client.
3. **`else if (zoneId)` deleted** from the pricing path, and `zoneId`/`inside`/`activeZoneName`/
   surge fields ignored on every inbound body that sends them.
4. **One strict coordinate validator** for geo decisions, with the existing numeric-string contract
   on driver telemetry kept as an explicitly documented exception rather than silently widened or
   broken.
5. **Geometry never substituted** — a 2-point polygon, a centre-less circle and an out-of-range
   vertex each return a controlled `400` with a reason code, and the store keeps what it is given.
6. **Duplicate exclusion** in aggregation, so 179 identical polygons price as one; inactive /
   expired / future / not-yet-in-window protections recorded as **measurements**, not enforced,
   until §14-4 is answered.

## 5. Tests required for the unblocked set

- `geo_policy_test.js` (new): inside / outside / boundary ±1 m / invalid / missing / stale
  coordinates; `locationValidated=false` on an unreadable store; a stale in-memory fence cannot
  authorize; `'Standard Operational Area'` never emitted as proof.
- Adversarial zoneId matrix (Phase 3's nine cases) — forged, inactive, deleted, another service's,
  with valid / invalid / null / string / out-of-range coordinates.
- Phase 12's A–Q rows for RIDE, FOOD and PARCEL, at the HTTP surface, asserting *no new*
  out-of-area refusal (that would be §14-1 decided by a test) while asserting every
  no-geographic-modifier invariant from Phase 13.
- Failure injection (Phase 14) recorded as REQUEST / EXPECTED / ACTUAL / SAFE / ROOT CAUSE,
  including DB unavailable, DB timeout, stale cache, malformed geometry, deleted fence,
  concurrent fence update and process restart.
- Admin validation: the three substitution cases now return 400 with a reason code and store
  nothing; the audit trail records the refusal.
- CAT-04 / CAT-06 array-syntax parsing strengthened (§1.2), so the new geo registrations cannot
  hide.
- Full Phase 18 chain afterwards, run serially twice where the project norm requires it.

## 6. Files, routes and functions touched

| File | What changes |
|---|---|
| `backend/src/services/GeoPolicyService.js` | new — the single geographic authority and its result shape |
| `backend/src/database.js` | `evaluateLocationGeofences` delegates; `calculateFareEstimate` loses the `zoneId` branch and the `'Standard Operational Area'` default; hydration tracks validated state (`:1971-1989`) |
| `backend/src/services/TelemetryValidator.js` | gains the shared strict coordinate entry point used by geo decisions |
| `backend/src/repositories/PricingRepository.js` | `createGeoFence` substitution removed for validation error (`:242-315`) |
| `backend/src/server.js` | `POST /api/geofence/evaluate` (`:2912`) consumes the engine; booking routes drop `zoneId` authority; the five admin geo routes keep their gates and gain honest validation |
| `backend/src/server.js:6293` | array-form registration made visible to the registration tests |
| `backend/admin_authorization_test.js` | CAT-04/CAT-06 parse arrays and double quotes |
| `backend/test_suite.js` | new geo harness registered so it runs in the full suite |
| `docs/GEOFENCING_SECURITY_AUDIT.md` | `## REMEDIATION RESULTS`, four matrices, failure-injection table, remaining decisions |
| `docs/ADMIN_FEATURE_SPECIFICATION.md:660` | the eight-routes claim corrected |

## 7. Not touched, and why

`customer-web`, `mobile/lib`, `admin-web/src`, `restaurant-merchant-web`,
`grocery-merchant-web`: no client change is needed to remove a server-side authority the client
was never supposed to hold, and the client-sends-`zoneId` behaviour is being taken away from the
server, not from the callers. Any Flutter/TypeScript edit that turns out to be necessary belongs
to the client's own phase, and Phase 18 will report the client suites' results either way.

## 8. Performance and cache semantics (Phase 16)

Cache stays a performance optimisation: `locationValidated` is derived from *this request's*
ability to answer, never from the presence of an array. Documented invalidation: a geo write
must invalidate or re-hydrate before it can be trusted by another process — measured today it
does not (no `appConfigService.invalidate()` or broadcast on the geo routes), which is reported
as a remaining risk rather than silently redesigned, because cross-instance propagation touches
the same authorisation blast radius the admin spec stops at (§9 item 6).

## 9. STOP — the nine §14 decisions, unchanged, and what each blocks

| §14 | Decision | Blocks |
|---|---|---|
| 1 | Does "outside the service area" refuse, reprice, or mean nothing? | Phase 4 entirely; F1, F2, and any driver-location gate in Phase 11 |
| 2 | Is client-supplied `zoneId` a feature or a hole? | **Answered by this order, Phase 3: it must go.** Recorded here so the removal is traceable to an instruction, not to my judgement |
| 3 | Overlapping fences: additive, max, or highest-`priority`? | Phase 7's final policy (duplicates are excluded without deciding it) |
| 4 | Must a surge rule have containment and a date? | Phase 6's containment and time-window enforcement; F5 |
| 5 | Global surge multiplier: table or process memory? (2.2 vs 1.00 vs 1.4 measured) | Phase 6/16's authority question |
| 6 | Are `allowed_services` / `allowed_vehicles` / `operating_hours` meant to bind? | Phase 4's per-service area and Phase 8's "service compatibility" |
| 7 | Geo lifecycle: build edit/activate/deactivate/archive? | Phase 8's missing routes — `edit`/`activate`/`deactivate` need no migration, `archive` does |
| 8 | Is the fence catalogue supposed to be public? (anon reads 420 fences; evaluate is tokenless) | Phases 9 and 10 |
| 9 | Who may read live driver positions? (`GET /api/fleet/locations` has no permission name) | Phase 11's read side and the admin spec's own §11 decision 10 family |

**MIGRATION REQUIRED: none applied, none written.** Two items would need one — a `deleted_at`
or `archived_at` column for §14-7's archive, and any RLS change for Phase 10 — and both stop
here under this order's own Phase 20 rule.
