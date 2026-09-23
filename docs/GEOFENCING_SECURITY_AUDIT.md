# NABIN — Geo-Fencing Security & Coverage Audit

Audited 2026-09-23 against the working tree at `main` (`9eca93d` plus uncommitted work). Environment: local Docker Supabase (`supabase_db_nabin`, Kong on `:54321`) and the Express backend on `:4000`, plus two throwaway backend instances on `:4101`/`:4102` that were started for §12 and stopped afterwards. **Nothing was pushed, deployed, or pointed at a hosted project. No migration was written or applied.**

---

## 0. Verdicts

| # | Area | Verdict | Implementation state |
|---|---|---|---|
| 1 | GEO-FENCE DATABASE | **PASS** (as storage) | DATABASE ONLY |
| 2 | RLS | **PASS** (as designed) — and it gates nothing the audit cares about | PARTIALLY IMPLEMENTED |
| 3 | SERVICE AREA ENFORCEMENT | **FAIL** | NOT IMPLEMENTED |
| 4 | RIDE | **FAIL** | NOT IMPLEMENTED |
| 5 | FOOD | **FAIL** | NOT IMPLEMENTED |
| 6 | PARCEL | **FAIL** | NOT IMPLEMENTED |
| 7 | DRIVER | **FAIL** (telemetry validation PASS; containment absent) | PARTIALLY IMPLEMENTED |
| 8 | DISPATCH | **FAIL** | NOT IMPLEMENTED |
| 9 | PRICING | **FAIL** | PARTIALLY IMPLEMENTED (pricing modifier, not eligibility) |
| 10 | SURGE | **FAIL** | PARTIALLY IMPLEMENTED (non-geographic) |
| 11 | ADMIN | **FAIL** | PARTIALLY IMPLEMENTED (create/view/delete only) |
| 12 | BOUNDARY | **PASS** (the geometry maths itself) | IMPLEMENTED for well-formed shapes |
| 13 | OVERLAPPING ZONES | **FAIL** | PARTIALLY IMPLEMENTED, undocumented rule |
| 14 | SECURITY | **FAIL** | NOT IMPLEMENTED |
| 15 | FAILURE HANDLING | **FAIL** | NOT IMPLEMENTED (fails open, silently) |
| 16 | PERFORMANCE | **PASS** at today's 420 fences, with a linear cliff | PARTIALLY IMPLEMENTED (no spatial index) |

> **Read §0 as the finding, not as the current state.** `# REMEDIATION RESULTS` at the end of this
> file records what changed after this audit, area by area, with the test that proves each claim. Two
> sentences above are already out of date in the direction of *more* enforcement: nonsense coordinates
> (`lat: 999`, `lat: "abc"`) are now refused rather than booked, and the client `zoneId` that moved a
> real job's fare no longer has a branch to move it through. Nothing was deleted from this section, on
> the principle that a finding you cannot read is a finding you cannot verify was fixed.

**The one-sentence answer.** `geo_fences` is a *pricing modifier table with an administrative CRUD surface and a map*. There is no service area: no operation in the ride, food, parcel, dispatch, accept, start or complete path asks whether a coordinate is inside anything, and the strings `OUTSIDE_SERVICE_AREA`, `serviceArea` and any equivalent appear **nowhere** in `backend/src` (grepped this session). Booking a ride from Mumbai, from New York, from `lat: 999` or from `lat: "abc"` all return HTTP 200 and persist. The premise in the work order — *do not assume geo-fencing is implemented because the table exists* — is the correct one, and it is worse than partial in the enforcement dimension: enforcement is absent, while the audit trail, the permission gates, the DB constraints and the geometry maths that *would* support it are genuinely in place.

---

## 1. Database

Live local store, measured this session (not read from the migration files):

| Table | Rows | Shape |
|---|---|---|
| `geo_fences` | 420, all `is_active = true` | 240 `CIRCLE`, 180 `POLYGON`; only **6 distinct `zone_name`** values |
| `surge_zones` | 418, all `status = 'ACTIVE'` | 100 % `service = 'RIDE'` (175 × `vehicle_type=4W` @1.45; 243 × `ALL` @1.35–1.50); every row has `zone_id` and `start_time`/`end_time` |
| `pricing_configurations` | 6 (`2W,3W,4W,PARCEL,FOOD,GLOBAL`) | `global_surge_multiplier = 1.00` and `active_surge_zone = 'NONE'` on **all** rows |

- **Geometry representation.** `geometry_type` ∈ {`POLYGON`,`CIRCLE`} (CHECK), geometry in `coordinates JSONB NOT NULL` — a polygon is an array of `{lat,lng}`, a circle is `{center:{lat,lng},radiusMeters}`. Column census: all 180 polygon rows carry **`center_lat`, `center_lng` and `radius_meters` as NULL** (they are meaningful only to circles), and 0 polygon rows have fewer than 3 points, 0 circles lack a centre. So the stored shapes are internally consistent even though nothing validates them on write.
- **Coordinates.** `center_lat`/`center_lng` are `NUMERIC(10,7)` — about 1.1 cm of resolution, more than enough; the JSONB points are IEEE doubles from `Number()`. There is **no CHECK on coordinate ranges**: a fence with `lat: 999, lng: 500` was accepted and stored verbatim through the admin route (§12).
- **Indexes.** `btree` only: PK on `id`, unique on `zone_code`, `idx_geo_fences_active(is_active)`, `idx_geo_fences_category`, `idx_geo_fences_zone_code`; `idx_surge_zones_lookup(status,service,vehicle_type)`, `idx_surge_zones_priority`, `idx_surge_zones_zone_id`. **There is no spatial index of any kind and no PostGIS**: `pg_extension` lists `plpgsql, uuid-ossp, pgcrypto, pgjwt, pg_stat_statements, supabase_vault, pg_graphql` and nothing geographic. Containment is therefore a Node-side loop over every active fence (§11).
- **Constraints that do work.** `geo_fences`: `surcharge_amount >= 0`, `surge_multiplier >= 1.00`. `surge_zones`: `surge_multiplier >= 1`, `max_multiplier >= 1`, `surge_multiplier <= max_multiplier`, `priority ∈ {LOW,NORMAL,HIGH,CRITICAL}`, `status ∈ {ACTIVE,INACTIVE,SCHEDULED,EXPIRED}`. `pricing_configurations`: seven non-negativity/range CHECKs. Negative surcharge, a multiplier below 1 and a multiplier above its own max are all rejected by the database (probed).
- **Ownership / grants.** All three tables are owned by `postgres`; `anon` and `authenticated` hold **SELECT only**; `service_role` holds ALL. The backend talks to the store as `service_role`, which is why RLS below cannot be read as a protection for anything the server does.
- **RLS.** Enabled on all three (not forced). Policies, read from `pg_policies`: `p_read_active_geofences` = SELECT to `public` USING `is_active = true`; `p_read_active_surge_zones` = SELECT to `public` USING `status = 'ACTIVE'`; `p_read_pricing_configs` = SELECT to `public` USING `true` (unrestricted); plus `p_service_role_*` FOR ALL USING/CHECK `true`. **Differential test, run this session:** an inactive fence seeded through `service_role` was read back as **1 row for `service_role`, 0 rows for the anon key**; anon INSERT/UPDATE/DELETE all failed with `42501 permission denied` (grant-level, stronger than RLS). RLS on these tables is correct and does what it says — it publishes the *active* geographic catalogue to any client holding the anon key, which is a feature for a map and a problem for §6/§8 (see below).
- **State / lifecycle available in the schema.** A geo-fence has exactly one lifecycle bit: `is_active BOOLEAN`. There is **no `status`, no `archived_at`, no `deleted_at`** (a `deleted_at=is.null` filter returns HTTP 400 — the column does not exist). A surge rule has `status`, `start_time`/`end_time` (time-of-day only, **no date**, so "expired" cannot be expressed) and `priority`.
- **Fields that exist and are never consulted.** `geo_fences.allowed_services`, `allowed_vehicles`, `operating_hours` and `category` are written (with defaults, `PricingRepository.js:276-298`) and mapped back out (`:68-70`) but appear in **no decision** — `grep -rn allowedServices` finds only those write/read sites. `surge_zones.start_time`, `end_time` and `priority` likewise: the pricing path filters on `status` and `service` only (`database.js:2355`). The 418 rows whose `start_time` is set are therefore in force 24 hours a day.

## 2. Service-area enforcement — which operations check a geo-fence

`db.evaluateLocationGeofences` has exactly two call sites in the whole backend (grep, this session):

| Call site | What it does |
|---|---|
| `server.js:2917` inside `POST /api/geofence/evaluate` | answers a caller's question, **and that route has no middleware at all** |
| `database.js:2337` inside `calculateFareEstimate` | adds a surcharge and raises a multiplier when the point is inside |

| Operation | Route | Enforces a geo-fence? |
|---|---|---|
| Create a ride | `POST /api/customer/book-ride` (`server.js:3309`) | **No** — reads `pickup`/`drop`, defaults them, prices, persists |
| Create a parcel order | `POST /api/customer/book-parcel` (`:3512`) | **No** — the pricing input carries no coordinates at all |
| Create a food order | `POST /api/customer/book-food` (`:3654`) | **No** — the handler never reads a `lat`/`lng`; an address string is enough |
| Assign a driver | dispatch loop | **No** — offers go to every driver whose `operationalStatus !== 'SUSPENDED'`; `distance_to_pickup`/`rank_score` exist in migration 014 and are never written |
| Accept an offer / accept a job | `:4211`, `:4267` | **No** |
| Arrived / start / complete | `:4379`, `:4453`, `:4556` | **No** — no containment test at any lifecycle step |
| Driver goes online | `:4147` | **No** — no position is required to enter the pool |

Measured, not inferred: bookings submitted from `19.076, 72.8777` (Mumbai), from New York coordinates, from `lat: 999` and from `lat: "abc"` all returned **HTTP 200** and stored a job with those values verbatim (`fare=105` for the Mumbai and the `999` cases). The service-area concept is **NOT IMPLEMENTED**; geo-fencing is a price modifier and an informational endpoint.

## 3. Customer location

`POST /api/geofence/evaluate` behaves as follows (all HTTP 200 — the endpoint never signals an error, which is the §12 problem stated in §3's terms):

| Input | Result |
|---|---|
| inside the Connaught Place polygon | `inside=true`, `matchedZones=[Connaught Place CBD Boundary]`, multiplier 1.4 |
| airport circle centre | `inside=true`, surcharge ₹150, multiplier 1.25 |
| exact boundary, just inside, just outside | behaves correctly, see §9 |
| outside every fence (Mumbai) | `inside=false`, multiplier 1, surcharge 0 |
| invalid coordinates (`"abc"`, `null`, `999`) | `inside=false`, HTTP 200 — **indistinguishable from "outside"** |
| missing coordinates | same as invalid |
| stale coordinates | **the evaluator has no notion of time**; a stale customer fix is evaluated as if it were now, and nothing in the booking path stores a position timestamp |

## 4. Driver location

The strong half of the audit lives here, and it is worth saying plainly because it was not always so: `POST /api/driver/location` (`server.js:6293`) and the WebSocket frame now share one validator (`services/TelemetryValidator.js`), and all eight rejection cases behaved when probed — missing, `NaN`, non-numeric, `lat` out of ±90, `lng` out of ±180, speed > 300 km/h, accuracy > 5000 m, timestamp more than 2 min ahead or more than 6 h behind. `receivedAt` is stamped by the server's clock, so a driver cannot age their own position by lying about it. Impersonation is refused: a `driverId` in the body that is not the session's driver is a 403 (`:6318`).

What is missing for this audit: **no fence is ever tested against a driver position.** `updateDriverLocation` (`database.js:6980`) stores lat/lng into the fleet store; `getFleetLocations` reads it back. Crossing into or out of a zone changes nothing — no arrival is verified geographically, no "arrived" transition can be refused for a driver 40 km away, and `POST /api/driver/.../arrived` accepts the claim on trust. The order's test — *client-supplied coordinates cannot bypass server-side geo-fence checks* — is **vacuously true**: there are no server-side geo-fence checks to bypass. One related gate is weak rather than absent: `GET /api/fleet/locations` (`:6389`) requires `authenticateAdmin` and **no permission name**, so any authenticated administrator, including one whose grants are `geofence.view`-only, reads every live driver position; `:6459` will additionally synthesise a tracking position when it has none.

## 5. Surge zones: the chain location → geo-fence → surge zone → pricing

The chain the order describes exists only inside `evaluateLocationGeofences`, and the fare estimator does not depend on it. In `calculateFareEstimate` (`database.js:2324-2352`) the multiplier that meets the customer is `Math.max(global, geo-if-inside, firstActiveSurgeRule)`, where the third term is:

```js
const activeSurge = this.surgeZones.find(s => s.status === 'ACTIVE' && (s.service === serviceType || s.service === 'ALL'));
```

— **no containment test, no `start_time`/`end_time` test, no `priority` tie-break, and `find()` takes whichever row happens to be first in the hydrated array** (which is `created_at DESC`, so the newest rule wins). Because all 418 rows in the local store are `ACTIVE`, `service='RIDE'`, with `start_time` set, that means *every ride quote on the platform is surged* by the most recently created rule, in Delhi, Mumbai or Mumbai-shaped nonsense.

Measured rupees, same request, three instances:

| Request | healthy instance | instance whose config store is unreachable |
|---|---|---|
| RIDE 14.2 km, airport circle | `surge=2.2 charge=₹895 driver=₹761` | `surge=1.4 charge=₹573 driver=₹487` |
| RIDE 14.2 km, **Mumbai, `matchedGeofence=null`** | `surge=2.2 charge=₹565` | `surge=1.4 charge=₹363` |
| RIDE, **no coordinates at all** | `surge=2.2 charge=₹565` | `surge=1.4 charge=₹363` |
| FOOD / PARCEL, same points | `surge=1` | `surge=1` |

Two conclusions. First, **pricing is server-side** (a client can never send a price, and the coupon path is already server-authoritative) but it is **not geographic**: the number that multiplies the fare came from a rule whose `matchedGeofence` the response itself reports as `null`. Second, the multiplier differs **between processes sharing one database**: the store's own maximum `surge_multiplier` is 1.50 and every `pricing_configurations.global_surge_multiplier` is 1.00, so neither 2.2 nor 1.4 is readable from the tables — 1.4 is the compiled-in seed rule `surge_1` (`database.js:580-595`) and 2.2 is the long-running process's own memory. Which fare a customer is quoted depends on which instance answers and when it last booted.

Inactive and expired zones: **no** inactive or non-ACTIVE surge row exists in the store, so "expired zone" cannot be exercised through data — and it would not matter, because only the literal string `'ACTIVE'` is tested and `EXPIRED`/`SCHEDULED` are unreachable states, not behaviours.

## 6. Security

| Attempt | Result |
|---|---|
| Set `latitude`/`longitude` to anything | Accepted; stored; priced. No gate exists to defeat. |
| `zoneId` in the booking/estimate body | **The bypass the order predicted exists.** `database.js:2344-2352`: when the client's coordinates are unusable, an `else if (zoneId)` branch looks the name up in the fence cache and applies *that fence's* surcharge and multiplier. Measured on a real job: garbage coordinates + the airport zone ⇒ `fare 105 → 255`, `driverEarnings 89 → 217`. The client does not have to be anywhere near the airport; it has to name it. |
| Same trick on a healthy instance, with `zoneId=zone_airport` | **Refused — accidentally.** `zone_airport` is a seed-array id, so once the cache has been hydrated from the table that id is gone and the request prices at ₹565. The *no-store* instance, whose cache is still the seed array, honoured the same request and returned ₹573 with `matchedGeofence="IGI Airport Terminal 3 Zone"`. Whether a client can buy an airport surcharge depends on the process's boot history. |
| `geoFenceId` / `serviceAreaId` / `surgeZoneId` | No such fields are read anywhere. The only client-named geographic input the server acts on is `zoneId`, above. |
| Unauthenticated enumeration | `POST /api/geofence/evaluate` has **no middleware** (`server.js:2912`): 200 for a tokenless request. It echoes back the matched zone names, geometry-derived surcharges and the effective multiplier, so it is a boundary-probing oracle. Alongside it, the RLS policy that works as designed lets any holder of the anon key read **all 420 fences (269,198 bytes) and 418 surge rules (195,005 bytes)** directly from PostgREST — with `coordinates` included. The fence catalogue is public. |

The order's requirement — *the server must calculate/verify geographic eligibility* — is unmet, because eligibility is not a concept the server implements. Where a position *is* verified (driver telemetry), the verification is honest.

## 7. Admin

Exactly five geo routes exist, all permission-named, all audited, and none of them is an update:

| Capability | Route | Gate | Audit |
|---|---|---|---|
| view | `GET /api/admin/geofences` (`:2865`), `GET /api/admin/surgezones` | `geofence.view`, `surge.view` | n/a |
| create | `POST /api/admin/geofences` (`:2874`), `POST /api/admin/surgezones` | `geofence.create`, `surge.create` | `GEOFENCE_CREATED` / `SURGE_CREATED` |
| delete | `DELETE /api/admin/geofences/:id` | `geofence.delete` | `GEOFENCE_DELETED` |
| **edit** | — | `geofence.edit`, `surge.edit` exist in the catalogue and **gate no route** | — |
| **activate / deactivate** | — (measured 404 on `PATCH /api/admin/geofences/:id`, `/:id/activate`, `PUT /api/admin/surgezones/:id`) | — | — |
| **archive** | — and the schema cannot express it (no `status`/`archived_at`/`deleted_at` on `geo_fences`) | — | — |
| configure service availability | `allowed_services` / `allowed_vehicles` / `operating_hours` are writable and **never read** (§1) | — | — |
| configure surge zones | create only — **there is no `DELETE /api/admin/surgezones/:id`**, which is how this audit ended up removing two probe rows with a raw `DELETE` against the local container | `surge.create` | `SURGE_CREATED` |

Permission control works and is not theatre: a throwaway `OPERATIONS` account provisioned for this audit held 8 grants, of which the geo-relevant ones were `geofence.view` and `surge.view`; it read both lists (200) and was refused both writes with 403 and a named permission (`Access Denied: Missing required permission [geofence.create]`, `[surge.create]`). The account was disabled through `POST /api/admin/accounts/:id/status` and its bearer then failed to sign in.

**Validation on write is the real failure.** `PricingRepository.createGeoFence` (`:242-315`) silently substitutes data rather than rejecting it, and every substitution returns HTTP 200:

| Submitted | Stored |
|---|---|
| a 2-point polygon | a **hard-coded 3-point Delhi triangle** `{28.625,77.36},{28.635,77.375},{28.615,77.375}` |
| a circle with no centre | centre `28.5562, 77.1`, radius 3500 |
| a polygon containing `lat: 999, lng: 500` | accepted **verbatim**, no range check |
| `status: 'INACTIVE'` … anything else | `is_active: payload.status !== 'INACTIVE'` — one magic string is the whole lifecycle contract |

An administrator who draws a two-point shape is told the platform stored a zone; the zone it stored is somewhere else entirely, and the audit trail says the create succeeded. That is worse than a 400.

And the surge rule an administrator deploys from the dashboard **acquires a fence it was never given**: `createSurgeZone` ends with "if still no zone UUID, fallback to first available geofence" (`PricingRepository.js:464-475`, `.select('id, zone_name').limit(1)` with **no order**), while the modal posts `zoneName, service, fenceType, surgeMultiplier, baseSurcharge, maxMultiplier, reason` and no geometry at all (`admin_dashboard.html:5128-5136`). Every one of the 418 rows in the store has a `zone_id` — which is how a rule labelled "Rohini Commercial Corridor" ends up bound to whichever fence the heap returns first.

## 8. Map

`admin_dashboard.html` (6,996 lines, one file, at the repository root) has a real geographic interface, and it is better than expected:

- Leaflet 1.9.4 with CARTO/OSM raster tiles (`:5164-5173`); fences are drawn from the API — `L.circle` for circles using `radiusMeters || 3500`, `L.polygon` for vertex arrays (`:5187-5230`), colour-coded by `category`, and non-`ACTIVE` fences are skipped.
- Click-to-test: a map click posts the coordinate to `/api/geofence/evaluate` and prints the zone, the multiplier and the toll (`:5176`, `:5346`).
- The live GPS panel uses **the administrator's own browser geolocation** (`navigator.geolocation`, `:5247`, `:5288`) and labels it "My Device Location". No customer position is rendered anywhere in the tab; the only person-shaped markers are driver positions on the separate fleet map (`:6020`). **The order's privacy requirement is met here.**

Against that: the tab's fence cards are pre-written as static HTML (`:1299-1345`, three demo cards with "Surge: 1.4x (High)") and only replaced once data arrives; `loadGeoFencesAndSurgeZones` (`:5429`) then renders **838 cards** (420 + 418) into one container from a ~464 KB response; there is **no legend or concept for a "restricted area"**, because the data model has no such category and the evaluator has no deny-list notion; and there is no draw/edit affordance, consistent with §7 — the UI cannot do what the API cannot do. `admin-web` (the Next.js dashboard, 8 routes) has **no geo screen at all**, so the only geo surface is this single-file legacy dashboard, whose map cannot change what it shows.

## 9. Boundary

Probed with distances derived from the inverse haversine rather than a rounded degrees constant (an earlier pass of mine used 111 km/degree at latitude 28.556 and produced a false result; the corrected pair is what follows). Against the airport circle, `center 28.5562/77.1`, `radius 3500 m`:

| Offset from the true boundary | Expected | Got |
|---|---|---|
| 1 m inside | inside | inside |
| on the boundary (distance == radius) | inside — the code is `<=` | inside |
| 1 m outside | outside | outside |
| ~0.5 m either way | follows the maths | follows the maths |

So `isPointInCircle` (`database.js:2240`) and `isPointInPolygon` (ray casting, `:2253`) are correct for well-formed shapes, and `NUMERIC(10,7)` storage does not lose sub-metre intent. Three caveats, none of which is an arithmetic bug: (a) a point **exactly on a polygon edge or vertex** is undefined in a parity ray-cast and can flip with the last-bit of a double — the honest statement is "boundary is inside for circles, undefined for polygons"; (b) there is **no bounding-box pre-filter**, and polygons carry no centre, so every point is tested against all 180 vertex arrays (§11); (c) precision at the boundary is meaningless when the write path will substitute a triangle for a shape the operator drew (§7) — the maths is sound on data that is never validated as it arrives.

## 10. Overlapping fences

The rule that exists in code, as read and measured — recorded rather than endorsed:

1. `effectiveSurgeMultiplier` = **max** over matched fences (and the global multiplier).
2. `totalSurcharge` = **sum** over matched fences.
3. `primaryZone` = the first match in cache order, i.e. **the most recently created** fence.
4. `surge_zones.priority` (`LOW/NORMAL/HIGH/CRITICAL`, indexed by `idx_surge_zones_priority`) is **never read** — the column is decoration.

Measured with two purpose-built overlapping fences: `mult=1.8` (the higher of 1.0 and 1.8), `surcharge=30` (10 + 20, **added**), `primaryZone=GEOAUDIT_B_1_8x` (the newer). Both decisions in one sentence: overlapping boundaries stack in money and never in multiplier.

The consequence at real scale: the local store's 420 fences have only 6 distinct names, because the test harnesses leave a duplicate cluster behind — **179 overlapping Noida polygons**. A point inside that cluster matched all 179 and produced a fare of **₹7,076 for a 3.8 km auto ride**, and a 143,866-byte evaluate response. That number is not an attack; it is what the additive rule does to data that accumulated in a development store. **Required decision (§16): is a surcharge meant to be additive across every fence a point falls inside, or meant to be the max / the highest-priority one?** Nothing here was changed, because answering that is the owner's call, not an audit finding.

## 11. Performance

Same store, `n=200`, concurrency 50, loopback:

| Workload | Wall | rps | p50 |
|---|---|---|---|
| evaluate a point outside everything (420 fences tested) | 151 ms | 1,325 | 32 ms |
| evaluate a point inside the 179-duplicate cluster | 322 ms | 621 | 77 ms |
| full fare estimate | 84 ms | 2,381 | — |

There is **no query per request**: the cache is loaded once at boot and containment is in-process arithmetic, so the geographic work is not a database bottleneck today and never touches an index — which is also why §1's missing spatial index is a *latent* rather than an active problem. What it does mean: cost is **O(active fences) per quote**, so a store that grows to 5,000 fences makes every fare estimate do 5,000 point-in-polygon tests, and the 179-duplicate case already halves throughput. Two payload facts belong with it — an evaluate response that matches 179 zones is 143,866 bytes and its `activeZoneName` string alone is 5,162 bytes (`matchedZones.map(z => z.name).join(', ')`), and the admin list renders 838 cards from a 464 KB read. The concurrency bench's health baseline is not quoted as a result: it always POSTs, and its 0/200 `ok` count is an artefact of that harness, not a health signal.

## 12. Failure behavior — the most consequential section

Two additional backend instances were started for this test and then stopped: `:4101` with `SUPABASE_URL` pointing at a port nothing listens on (store unreachable), `:4102` with a valid URL and a corrupted key (store refusing the read). The local Docker container was **not** stopped, so "database unavailable" is modelled on the client side, which is the side that matters to a request.

| Condition | Observed |
|---|---|
| **Store unreachable at boot** | Boot logs `⚠️ Supabase connection health check not connected: TypeError: fetch failed` and serves anyway. `GET /api/health` → `ONLINE`. `POST /api/geofence/evaluate` → `inside=true`, `IGI Airport Terminal 3 Zone`, ₹150 surcharge, HTTP 200. **It answers a geographic question with confidence while unable to reach any geography.** |
| Why | `database.js:1977` and `:1987` hydrate under `if (!err && rows && rows.length > 0)`. A read error *or an empty table* leaves the constructor's compiled-in seed arrays (`:517`, `:580`) authoritative — including `zone_airport` and a `1.4x` surge rule. Emptying `geo_fences` silently changes every fare on the platform instead of stopping it. |
| Same request, healthy vs starved | ₹895 vs ₹573 for one airport ride; ₹565 vs ₹363 for a Mumbai ride; `surge 2.2` vs `1.4`. Both HTTP 200. **The failure is invisible to the caller and disagrees between instances.** |
| **Invalid coordinates** | `inside=false`, HTTP 200 — a malformed request is reported exactly like a location that is genuinely outside every fence. There is no way for a caller to tell "you asked nothing sensible" from "you are not in a zone". |
| **The default answer** | `database.js:2332`: `let activeZoneName = 'Standard Operational Area'` — the estimate's zone field is a **string literal initialised before any computation** and only overwritten on a match. So a Mumbai quote, a no-coordinates quote and a quote from a process that cannot reach its database all answer `activeZoneName="Standard Operational Area"` with `matchedGeofence=null`. This is the order's prohibition, met almost verbatim: when geographic validation cannot be performed, the system reports being in the operational area. |
| **Invalid polygon** | Accepted (HTTP 200) and rewritten — a 2-point polygon becomes the hard-coded Delhi triangle; a polygon containing `lat 999 / lng 500` is stored as drawn. A `POLYGON` row with fewer than 3 points would make `isPointInPolygon` return `false` forever, i.e. a silent dead zone; the write path prevents that only by overwriting the operator's data. |
| **Missing fence reference** | `zoneId` naming a fence the cache does not hold prices with no surcharge (silently), and naming one it *does* hold prices with that fence's surcharge regardless of where the rider is (§6). |
| **Stale configuration** | Within one process, creates and deletes do reach the evaluator (measured 184 → 183 fences and the surcharge falling accordingly) — an earlier hypothesis of mine that the cache goes stale on write was wrong and is corrected here. What is missing is **propagation**: the geo routes call neither `appConfigService.invalidate()` nor the broadcast that other control-plane writes use, and `db.geoFences` is only assigned at construction and boot hydration. A second instance keeps quoting the old fence set until it restarts, which is exactly the ₹895/₹573 split above. |

Fail-safe scorecard: the system fails **open** on configuration (answers anyway, from compiled-in data), fails **quiet** on disagreement between instances, and fails **silent** on invalid input. It does not fail closed anywhere in this domain — and because there is no gate, there is also no gate that could be accused of failing closed. The pricing consequence is the one that reaches a wallet: an unreachable config store is a ~37 % fare change in this measurement, in the direction of whichever multiplier the process happens to remember.

## 13. Audit

Present and correct for the mutations that exist: `GEOFENCE_CREATED`, `GEOFENCE_DELETED` (module `GEOFENCING`) and `SURGE_CREATED` (module `DYNAMIC_SURGE`), each with actor id, actor name, role, `targetEntityType`, `targetEntityId`, `previousState`, `newState` and `reason`, written by `database.js:3011-3079` / `:3104-3115`. The writes are awaited, so a geo mutation cannot succeed with its trail dropped.

- **Customer/driver GPS in the trail: none.** Across the 200 most recent audit rows, **0** carry a coordinate-bearing key (`lat`/`lng`/`latitude`/`longitude`/`pickupLat`/`dropLat`). The order's "do not log unnecessary precise customer GPS data" requirement is met today, and the geometry that *is* recorded is configuration (a fence name and its id), not a person's location.
- Trail breadth is real: 18 modules observed (`AUTH, ADMIN_PROVISIONING, GEOFENCING, DYNAMIC_SURGE, PRICING_ENGINE, PROMOTIONS, PAYMENTS, DISPATCH, FINANCE_SETTLEMENT, DRIVER_FLEET, CAMPAIGNS, PLATFORM_SETTINGS, …`).
- **Gaps, all consequences of §7 rather than of the audit code:** there is no `GEOFENCE_UPDATED`/`SURGE_UPDATED`/`SURGE_DELETED` because no such route exists; a silent geometry substitution (§7) is audited as a plain success, so the trail says "created zone X" without saying the shape stored is not the shape submitted; and a restart that reverts pricing to the seed arrays (§12) leaves no record at all, because nothing detected the change.

## 14. Decisions this audit deliberately did not make

Nothing below was fixed, because each is a product or privilege decision. None needs a migration except where marked.

1. **Does "outside the service area" refuse a booking, price it higher, or mean nothing?** Today it means nothing. Whatever is chosen, §12 shows it needs a validator that distinguishes "outside" from "nonsense" before a refusal is safe to add.
2. **Is the client-supplied `zoneId` a supported feature or a hole?** The `else if (zoneId)` branch is the only way geography enters a price without coordinates. Deleting it is a two-line change with a real behaviour consequence for any client that relies on it.
3. **Overlapping fences: additive surcharge, or one governing zone (max / highest `priority`)?** §10. Also: does `priority` and `category` mean anything, and should `allowed_services` / `allowed_vehicles` / `operating_hours` bind at all — or be dropped from the write path instead of inviting operators to configure nothing?
4. **Does a surge rule need containment and a date?** `start_time`/`end_time` are time-of-day only; the pricing path ignores both. Either they bind (and "expired" becomes expressible) or the columns should stop being presented as configuration.
5. **The global surge multiplier's authority.** A long-running process quoted 2.2x where every `pricing_configurations` row says 1.00, and a fresh process quoted 1.4x from a seed array. Either the table is the truth and is re-read (with the divergence made loud), or the memory copy is — but the store currently answers neither question.
6. **The seed fallback arrays.** Removing them turns §12's silent substitution into a visible failure, which is the change this audit would recommend first and is not authorised here.
7. **Geo lifecycle.** `edit` / `activate` / `deactivate` / `archive` have no routes; `archive` additionally needs a column, which per the standing rule means a migration and an explicit approval. `geofence.edit` and `surge.edit` should stop being granted to roles for which no route exists — or the routes should exist.
8. **The fence catalogue's visibility.** RLS currently publishes all active geometry to any anon client, and `/api/geofence/evaluate` is unauthenticated. If the boundary shapes are meant to be trade secrets rather than a public map, that is a decision about these two surfaces.
9. **Who may read live driver positions.** `GET /api/fleet/locations` has no permission name.

## 15. What this audit verified as sound

Reported so the FAILs are read as gaps in a partially-built system, not as a broken one: driver telemetry validation (all eight rejections, shared between REST and WebSocket, server-clock `receivedAt`); driver impersonation refusal; job-assignment and ownership guards on the lifecycle routes; the DB CHECK constraints that do reject impossible multipliers and negative surcharges; `surge_zones.zone_id → geo_fences.id ON DELETE CASCADE`, which behaved as declared when a probe fence was removed; the RLS read policies and the grant-level refusal of anon writes; the permission gates on all five existing geo routes, verified with a provisioned non-super administrator; the audit trail's awaited writes and its absence of coordinates; the geometry maths at ±1 m of a circle boundary; and the map's refusal to render customer locations.

## 16. Method, environment and cleanup

- Static: every `app.<method>()` registration for geo paths, every `evaluateLocationGeofences` call site, every `allowedServices`/`priority`/`status` reference, and the five pricing functions (`database.js:2240-2400`, `PricingRepository.js:30-320`, `server.js:2865-3011`, `:3309-3800`, `:4147-4600`, `:6293-6500`).
- Live: `POST /api/geofence/evaluate`, `/api/pricing/estimate`, three booking routes, the five admin geo routes, `POST /api/driver/location`, `GET /api/fleet/locations`, `GET /api/app/config`, and PostgREST reads under both keys.
- Database: column/constraint/index/policy/grant/extension dumps and row censuses against the local Docker container, read-only apart from the two scoped probe deletions named below.
- Concurrency: 200 requests at 50-way concurrency against a warm process.
- Created and removed: 4 geo-fences and their attached surge rules (2 orphan rules had to be deleted with a scoped `DELETE FROM surge_zones WHERE zone_name LIKE 'AUDIT_PROBE%' OR 'PERM_%'` because **no delete route exists** — `DELETE 2`), one throwaway `OPERATIONS` administrator (disabled, its bearer then refused at login), and a temporary inactive fence (`RLSDIFFY`) used for the RLS differential, deleted immediately. Final state verified: **420 fences, 418 surge rules, 0 probe rows, 0 inactive rows** — the same counts as at the start of the audit, apart from one duplicate fence a harness had already left which was removed during probing (421 → 420), and the development `jobs` rows left by the booking tests — 25 rows created in the last 6 hours at the time of writing, a figure that also includes the test harnesses run alongside this audit, so it is quoted as an observation rather than attributed exactly. Both are disclosed rather than tidied away: deleting order history is not this audit's call.
- Not performed: no push, no deploy, no hosted Supabase contact, no migration written or applied, no production payment configuration touched, no secret printed (keys were piped through environment variables and only their lengths were logged).
- This document is **uncommitted**; the working tree also still carried two open documentation corrections from the previous order (area 45's "all eight routes" against seven walked, and the CAT-04 array-regex blind spot). **Both were made during the remediation below** — `ADMIN_FEATURE_SPECIFICATION.md` area 45 now claims six of eight walked, and area 33's counts moved to the statement-level parse's numbers.

---

# REMEDIATION RESULTS

Written 2026-09-23 against the same working tree (`main` at `9eca93d`, plus the uncommitted
geo work described here). Everything above stays as it was found; this section is additive, so a
reader can compare the finding to its fix. No §14 decision was closed by assertion — where an
area is still blocked, it is reported blocked and named with the decision that blocks it.

**How to re-run this.** `cd backend`, source `backend/.env`, then `node geo_policy_test.js`
(**55 checks**), `node geo_adversarial_test.js` (**57 checks**) and `node admin_authorization_test.js`
(**113 checks**) against the local backend on `:4000`. Both geo suites passed 55/55 and 57/57 in every
pass. The authorisation matrix passed 113/113 twice and **110/113 against a backend that had only just
booted** — see R9, which is the honest account of which process each number came from and why two of
the three passes were worth less than they looked. The suites need the local Docker store up, because
group D and the `SEC-07` probe read it. Group E of the policy suite starts its own child process
against a closed port — the fail-closed half cannot be proven from a healthy process, and nothing here
pretends otherwise.

Verdict words used below: **CLOSED** (the finding cannot recur, and a test says so), **CLOSED FOR THE
UNBLOCKED HALF** (the part this order authorised is shut and tested; the remainder is named with its
§14 decision), **MEASURED, NOT ENFORCED** (the engine can see the condition and reports it; acting on
it is an open decision), **OPEN** (unchanged, with the reason).

## R0. What was built

| Piece | Role |
|---|---|
| `backend/src/services/GeoPolicyService.js` (new) | the single geographic authority. `bind()` takes the fence/rule copy and the store's own state; `evaluate()` answers containment, matched boundaries, applicable rules, the effective multiplier and surcharge, and a `locationValidated` that is *false* unless the store answered. `validateCoordinatePair`, `validateFenceGeometry`, `fenceSignature` and the frozen `REASON`/`STORE_STATE` tables live here so no second copy of a rule exists |
| `database.js` | `evaluateLocationGeofences` delegates to the engine; `calculateFareEstimate` lost its `zoneId` branch and its `'Standard Operational Area'` default; hydration now tracks `UNREADABLE` / `VALIDATED_EMPTY` / `VALIDATED` (`hydrateGeoStore`, `geoStoreChanged`, `markGeoStoreUnreadable`) and the compiled-in seed arrays are no longer reachable as business state |
| `PricingRepository.js` | geometry is validated and stored as drawn or not at all; `geoFailure`/`geoStoreFailure` give a refusal a code and an honest status (a duplicate zone code is `409`, not a `503` outage); every geo write re-hydrates the copy the process prices from |
| `server.js` | the evaluate and reverse-geocode routes consume the engine; the quote and ride-booking routes refuse an unvalidated coordinate with a reason code and translate the engine's refusal through one helper; the five admin geo routes keep their permission gates and gained `replyGeoAdminError` plus an inventory the operator can read |
| `TelemetryValidator.js` | the strict coordinate entry point shared by telemetry and by geo decisions, with the numeric-string contract on telemetry kept as a documented exception |
| two suites | 112 geo checks, listed above, registered in `test_suite.js` so the full chain runs them |

## R1. Per-area results

### 1. GEO-FENCE DATABASE — was PASS (as storage) / DATABASE ONLY

- **BEFORE:** 420 rows, sound CHECKs, correct FK cascade — and no read path that decided anything, with nothing validating a shape on write.
- **CHANGE:** write-time validation in the repository (rings need ≥3 points, circles a centre and a positive radius, vertices inside ±90/±180, self-intersection refused), and a store state the process carries with the rows rather than inferring from their count.
- **AFTER:** a refusal never reaches the table (`FI-01` refuses and counts the store unchanged), and the operator can read what the store believes: `GET /api/admin/geofences` now reports `storeState`, `fenceCount`, `activeFenceCount`, `malformedFenceCount`, `duplicateFenceRows` and `activeRulesWithoutZoneBinding` with a `readAt` stamp (`GEO-D08`, `CACHE-04`).
- **TEST:** FI-01, FI-02, FI-04, FI-08, GEO-B01…B10, GEO-D08.
- **VERDICT:** CLOSED for the storage-and-validation half. Still no spatial index (area 16).

### 2. RLS — was PASS (as designed) / PARTIALLY IMPLEMENTED

- **BEFORE:** `p_read_active_geofences` and `p_read_active_surge_zones` publish the active catalogue to any holder of the anon key; the backend connects as `service_role`, so RLS authorises nothing server-side.
- **CHANGE:** none. Narrowing it is DDL, and this order stops at a migration.
- **AFTER:** unchanged, and now pinned by a test that fails if it changes quietly: `SEC-07-KNOWN-GAP` asserts the anon key *can* read active boundaries with geometry and surcharge, and its own text records that the backend's posture is that Express, not RLS, is the authorization layer.
- **TEST:** SEC-07-KNOWN-GAP (open finding), SEC-02 (admin surfaces behind a permission).
- **VERDICT:** OPEN by design, §14 decision 8. Reported in R-Remaining below rather than resolved.

### 3. SERVICE AREA ENFORCEMENT — was FAIL / NOT IMPLEMENTED

- **BEFORE:** no operation asked whether a coordinate was inside anything; `OUTSIDE_SERVICE_AREA` appeared nowhere; Mumbai, New York, `lat: 999` and `lat: "abc"` all booked.
- **CHANGE:** the engine answers containment for every geographic operation and the *nonsense* half is refused before a row is written. Whether *outside* should refuse is §14-1 and was not decided by a test.
- **AFTER:** `lat: 999` → `400 GEO_COORDINATES_OUT_OF_RANGE` with no quote and no job; `lat: "abc"` → `400 GEO_INVALID_COORDINATES`; a genuinely outside point is booked at a geography-free fare and labelled `VALIDATED_OUTSIDE` with `matchedFences: []` and `activeZoneName: null`.
- **TEST:** MTX-R01, MTX-R02, MTX-R03, MTX-R04, MTX-R10, GEO-A01, GEO-D04.
- **VERDICT:** CLOSED FOR THE UNBLOCKED HALF — invalid coordinates are refused everywhere, an outside coordinate is now a *known* fact rather than a silence. Refusing the booking itself remains blocked by §14-1.

### 4. RIDE — was FAIL / NOT IMPLEMENTED

- **BEFORE:** three quote doors and one booking door all consulted a fence only to add money, and a client `zoneId` moved a real job ₹105 → ₹255.
- **CHANGE:** the ride quote and both booking routes take the engine's verdict through the same helper, so a booking cannot invent its own idea of what an unvalidated location is worth.
- **AFTER:** inside `200 booked ₹144` with `m=1.4` from `Connaught Place CBD Boundary`; outside/Mumbai/New York `200 booked ₹105`; nonsense `400` and no job; a forged or a real `zoneId` on the same outside point prices exactly as standing there unnamed (₹105/₹105); during a store outage no door books at all (`GEO-E06`).
- **TEST:** MTX-R01…R10, INV-05, INV-07, GEO-E06, GEO-E07.
- **VERDICT:** CLOSED for pricing authority and coordinate validity; the area-refusal half is §14-1.

### 5. FOOD — was FAIL / NOT IMPLEMENTED

- **BEFORE:** food quotes and bookings ignored geography entirely while the audit assumed a fence might apply.
- **CHANGE:** none to the route's inputs — and that is the finding, stated honestly rather than improved on.
- **AFTER:** the food route reads no coordinate at all: six different inputs, nonsense included, produce one fare (₹220), and no geographic refusal can arise on it (`GEO-E08`: food does not reach the engine).
- **TEST:** MTX-FOOD-NO-GEO, GEO-E08.
- **VERDICT:** OPEN — measured and recorded. A food service area is §14-1 (and §14-6 for `allowed_services`); adding a gate the order forbids deciding would be worse than the gap.

### 6. PARCEL — was FAIL / NOT IMPLEMENTED

- **BEFORE:** as FOOD; the audit's parcel rows priced identically from any continent.
- **CHANGE:** the parcel pricing *input* is now built without any client coordinate, so it cannot be moved by one, and the route goes through the engine for whatever the engine can say.
- **AFTER:** six coordinates, one fare (₹129); `GEO-E08` proves the parcel input carries no `lat`/`lng` field at all.
- **TEST:** MTX-PARCEL-NO-GEO, GEO-E08.
- **VERDICT:** OPEN for the service area, §14-1. CLOSED for the possibility of a client moving a parcel price with a coordinate.

### 7. DRIVER — was FAIL (telemetry PASS, containment absent) / PARTIALLY IMPLEMENTED

- **BEFORE:** no lifecycle step tested a fence; the position stored by `POST /api/driver/location` was used by nothing; the concern in the order's Phase 11 was whether a lifecycle call trusted a client's geographic claim.
- **CHANGE:** none needed for trust — the parsed registrations show no lifecycle handler reads any geographic field. The engine's strict validator is now shared with the quote path so a nonsense fix is refused the same way on both.
- **AFTER:** five lifecycle operations (`toggle-online`, accept offer, accept job, arrived, complete-trip) read `none` of `zoneId`/`activeZoneName`/`surgeZone`/`inside`/coordinates; the one driver route that takes a coordinate takes *only* the coordinate and answers the same three fields whether the driver is inside a boundary or in Bengaluru; string, out-of-range, missing, 7-hour-stale and clock-ahead fixes are all `400` with a code; `isOnline` on the fleet map remains a display claim and cannot set `operationalStatus`.
- **TEST:** DRV-01…DRV-05, GEO-E09 (a driver cannot store a position during an outage).
- **VERDICT:** CLOSED for the "no lifecycle operation trusts a client geographic claim" requirement. A containment gate at go-online/accept remains §14-1, and reading live positions is §14-9.

### 8. DISPATCH — was FAIL / NOT IMPLEMENTED

- **BEFORE:** offers went to every driver not `SUSPENDED`; `distance_to_pickup` and `rank_score` were never written.
- **CHANGE:** none. Dispatch is meaningless until eligibility is defined, which is the §14-1 question in another form.
- **AFTER:** unchanged, with one dependency now honest: the geographic facts dispatch would need come from one engine with a `locationValidated` flag rather than from three call sites.
- **TEST:** none added — a test here would decide §14-1 by assertion.
- **VERDICT:** OPEN, §14-1.

### 9. PRICING — was FAIL / PARTIALLY IMPLEMENTED

- **BEFORE:** `Math.max(global, geo-if-inside, firstActiveSurgeRule)` — the third term with no containment and no time test, so 418 rules surged every ride quote; and a `zoneId` in the request body was a second door into the number.
- **CHANGE:** `else if (zoneId)` deleted; `activeZoneName` is `null` unless something matched; `'Standard Operational Area'` no longer exists as a default string; the engine returns the modifier and `calculateFareEstimate` consumes only that.
- **AFTER:** an outside point and a no-location point agree to the rupee (₹105, `m=1`); an inside point pays for the boundary it is in (₹144, `m=1.4`), and the difference is the server's own number, not a coincidence; every tampered field (`surgeMultiplier`, `activeZoneName`, `inside`, `geoValidation`) is ignored and the job's fare equals the quote it was shown; 8 concurrent identical quotes agree exactly; invalid geography produces no quote at all, hence no modifier.
- **TEST:** INV-01…INV-08, MTX-R05, MTX-R06, GEO-C01…C05, GEO-D01…D05.
- **VERDICT:** CLOSED for client authority, the fallback default and the unvalidated-geography modifier. Time windows and containment for *rules* are §14-4 (see area 10).

### 10. SURGE — was FAIL / PARTIALLY IMPLEMENTED

- **BEFORE:** all 418 rules `ACTIVE`+`RIDE` with a `start_time` set surged around the clock: Mumbai `surge=2.2`, ₹565 vs ₹363 for one identical request depending on which row was seen first.
- **CHANGE:** the engine reads each rule's own boundary and window and reports what it skipped and why, instead of taking the first active row it finds.
- **AFTER:** a rule whose window has passed is labelled `GEO_RULE_EXPIRED` and a rule that opens later `GEO_RULE_NOT_YET_ACTIVE` — *measured, then applied anyway*, because enforcing windows is §14-4. A rule with no geometry to contain the point is reported with `basis=STATUS_ONLY`, which is the one door still open to "surged for a zone you are not in", now at least named in the response. `platformWideSurgeRule.basis === 'STATUS_ONLY'` on the live store.
- **TEST:** PH6-K, PH6-L, PH6-STATUS, PH6-INACTIVE.
- **VERDICT:** MEASURED, NOT ENFORCED (§14-4). The silent version is closed; the honest version is reported.

### 11. ADMIN — was FAIL / PARTIALLY IMPLEMENTED

- **BEFORE:** `PUT`/`PATCH`/`archive` 404; no `DELETE /api/admin/surgezones/:id`; and `createGeoFence` substituted a hard-coded Delhi triangle for a 2-point polygon and answered 200 — the operator's map showed a boundary they never drew.
- **CHANGE:** substitution removed; the write path validates and refuses with a reason code; a zone code an operator names is stored verbatim or refused (not truncated to a prefix); a rejected unique constraint is `409 GEO_ZONE_CODE_TAKEN`, distinguished from a `503` outage.
- **AFTER:** the 2-point polygon, the centreless circle and the self-intersecting ring each answer `400` and leave the row count untouched; an over-long or blank zone code answers `400 GEO_ZONE_CODE_INVALID` where it used to fail *after* the insert as a 503; `edit`/`activate`/`deactivate`/`archive` remain absent — three need no migration and `archive` needs one, all four are §14-7.
- **TEST:** FI-01, FI-02, FI-04, FI-10, GEO-B01…B10, GEO-D10.
- **VERDICT:** CLOSED for never-substitute and reject-invalid. OPEN for lifecycle (§14-7).

### 12. BOUNDARY — was PASS on well-formed shapes

- **BEFORE:** ±1 m circle boundary behaved; polygons had no on-edge definition, no bbox prefilter and no centre; and the write path could store a shape nobody drew.
- **CHANGE:** the substitution is gone (area 11), the signature function recognises one boundary re-entered from another vertex, and self-intersection is refused at the write.
- **AFTER:** boundary at about a metre still separates inside from outside (₹10 `m=2.6` vs ₹0 `m=1`, `PH6-P`); a duplicated ring entered from a different starting vertex is counted once (`GEO-B10`).
- **TEST:** PH6-P, GEO-B10, FI-05.
- **VERDICT:** PASS retained; the polygon on-edge definition remains undocumented and is reported in R-Remaining.

### 13. OVERLAPPING ZONES — was FAIL / undocumented rule

- **BEFORE:** max multiplier, **summed** surcharge, newest wins, `priority` ignored, and 179 duplicate Noida polygons compounded to ₹7,076 in a 143,866-byte response.
- **CHANGE:** duplicate *shapes* are excluded before anything is added, which is arithmetic rather than policy; max-versus-sum across genuinely distinct overlaps was left alone.
- **AFTER:** 427 rows in 6 distinct shapes are counted as 6 (`SEC-08`); one point inside two copies of a boundary is charged once by that copy (`GEO-C01`, `GEO-C03`, and `FI-05`: deleting one identical row leaves the fare at ₹151 unchanged); two genuinely distinct overlapping boundaries sum their surcharge once each and take the highest single multiplier (`PH6-O`).
- **TEST:** GEO-C01, GEO-C02, GEO-C03, PH6-O, SEC-08, FI-05.
- **VERDICT:** CLOSED for duplicate exclusion. §14-3 stays open and `PH6-O`'s text says so.

### 14. SECURITY — was FAIL / NOT IMPLEMENTED

- **BEFORE:** `zoneId` in the body moved a real job's fare; `POST /api/geofence/evaluate` was tokenless; the anon key read 420 fences / 269 KB.
- **CHANGE:** the `zoneId` door is deleted; the evaluate route answers a verdict about one point and no longer returns the vertices, the `description`, `operating_hours` or `created_by` of the boundary that produced it; the reverse-geocode route refuses nonsense instead of naming it.
- **AFTER:** forged and real zone ids both price as the unnamed same point (`MTX-R07`, `GEO-D03`, `INV-04`); `GEO-D07` asserts no ring of coordinates appears in the evaluate response; `SEC-04` shows the resolver answering `400 GEO_INVALID_COORDINATES` where it used to answer `200 "Live Location (NaN° N …)"`; the anon read is unchanged and asserted as an open finding (`SEC-07-KNOWN-GAP`).
- **TEST:** MTX-R07, INV-04, GEO-D03, GEO-D07, GEO-D09, SEC-01…SEC-08.
- **VERDICT:** CLOSED for client-supplied zone authority and for response shape on the tokenless route. OPEN: whether that route needs a session at all (§14-8), and the RLS narrowing, which is DDL.

### 15. FAILURE HANDLING — was FAIL / failed open, silently

- **BEFORE:** `if (!gfErr && dbFences.length > 0)` left the compiled-in Delhi fences authoritative when the read failed; `activeZoneName` was initialised to the literal `'Standard Operational Area'`; an invalid coordinate returned `inside: false` at 200, indistinguishable from a real outside.
- **CHANGE:** hydration tracks validated and populated separately, so `VALIDATED_EMPTY` (a store that answered "nothing") and `UNREADABLE` (a store that did not answer) are different states with different consequences; the seed arrays are unreachable as business state; a booking-critical call under an unreadable store gets the 503 refusal shape with a `GEO_STORE_UNAVAILABLE` code and no internal text.
- **AFTER:** proven in a process that genuinely cannot reach the store — an inside-looking point and an outside-looking point both answer `503 GEO_STORE_UNAVAILABLE` with no fare, a client zone id cannot rescue a quote the store cannot vouch for, the public evaluate route reports unavailability instead of the remembered answer, nonsense coordinates are still a `400` *about the coordinates*, the operator log says geography specifically failed, and no ride and no driver position is stored during the outage. A stale in-memory fence cannot authorize; freshness across a write is proven separately (`CACHE-01…05`).
- **TEST:** GEO-E01…E09, FI-06, FI-07, FI-08, FI-09.
- **VERDICT:** CLOSED. The one residual is that the boot geo read has no timeout, so an unresponsive store delays start rather than failing fast — recorded in `FI-09`, not silently redesigned.

### 16. PERFORMANCE — was PASS at 420 fences, with a linear cliff

- **BEFORE:** 1,325/621 rps at 50-way concurrency, in-process arithmetic, no per-request query; 143 KB evaluate responses; 5,162-byte quote responses; 838-card admin render; no spatial index.
- **CHANGE:** the response shapes were cut (no vertices over the public route) and the inventory became readable to an operator; nothing was added to the per-request path beyond the engine's own pass.
- **AFTER:** still a Node-side loop over every active fence — the cliff the audit named is unchanged, and no spatial index exists.
- **TEST:** INV-08 (8 concurrent identical quotes agree exactly), plus the Phase 18 chain timings recorded in R-Regression.
- **VERDICT:** OPEN by scope. PostGIS or a bbox prefilter is its own decision, not a remediation of a finding.

## R2. SERVICE-AREA ENFORCEMENT MATRIX

Every row is a live HTTP call against the local backend, read from the same run. "Geo check" is the
engine's verdict on the *server's* read of the coordinate, never a claim from the request body.

| Service | Operation | Geo check | Outside behavior | DB failure |
|---|---|---|---|---|
| RIDE | quote (`/api/pricing/estimate`) | `VALIDATED_INSIDE` / `VALIDATED_OUTSIDE` / `NOT_PROVIDED` | 200, geography-free fare ₹105, `matchedFences: []`, `activeZoneName: null` (§14-1 open) | `503 GEO_STORE_UNAVAILABLE`, no fare (GEO-E01) |
| RIDE | book (`/api/customer/book-ride`) | same helper as the quote | 200 booked at ₹105, fare taken from the server quote (MTX-R04, INV-07) | no job row written, refusal translated by the same helper (GEO-E06, GEO-E07) |
| RIDE | invalid coordinate (`999`, `"abc"`) | refused before geography | `400 GEO_COORDINATES_OUT_OF_RANGE` / `GEO_INVALID_COORDINATES`, no quote and no job (MTX-R01, MTX-R10) | the coordinate refusal wins: a `400` about the input, not a `503` about the store (GEO-E04) |
| RIDE | missing coordinate | `NOT_PROVIDED` | 200 booked from the platform's central-Delhi default; §14-1 left open (MTX-R08, MTX-R09) | `503` — the door is shut whichever way the point looks (GEO-E01) |
| PARCEL | book | none available: the route's pricing input carries no coordinate (GEO-E08) | 200 at ₹129 from any of six coordinates — **no geographic modifier is possible, and no area refusal either** (MTX-PARCEL-NO-GEO) | unaffected: no geographic call to fail |
| FOOD | book | none: the route does not reach the engine (GEO-E08) | 200 at ₹220 from any of six coordinates (MTX-FOOD-NO-GEO) | unaffected: no geographic call to fail |
| DRIVER | go online / accept offer / accept job / arrived / complete | none, and none trusted: the handlers read no geographic field (DRV-01) | not reached — these operations take no coordinate | unaffected for the geographic half; the auth fail-closed path is unchanged |
| DRIVER | store position (`/api/driver/location`) | telemetry validity only, then stored (DRV-02) | stored, no zone named, identical field set to an inside driver (DRV-03) | nothing stored, no position lost silently (GEO-E09) |
| DISPATCH | offer fan-out | none (§14-1) | offers still reach every non-suspended driver | unchanged |

## R3. PRICING GEO MATRIX

"Geographic modifier allowed?" means a surcharge or multiplier reaching the customer's number from a
boundary or a rule. Measured through `/api/pricing/estimate` and the engine's own answers.

| Condition | Geographic modifier allowed? |
|---|---|
| Valid inside | **Yes** — the matched boundary's, once per distinct shape: ₹144 at `m=1.4` from `Connaught Place CBD Boundary` vs ₹105 outside (INV-05, MTX-R05) |
| Valid outside | **No** — ₹105, `m=1`, `matchedGeofence: null`, `activeZoneName: null`, identical to a no-location quote (INV-03) |
| Invalid coordinates | **No quote exists to carry one** — `400` with `pricingAvailable: false` and no `estimate` key (INV-01, GEO-D04) |
| Forged `zoneId` | **No** — the branch is deleted; a made-up id and a real one both price as the same unnamed point (INV-04, MTX-R07, `requestedZoneIdIgnored: true`) |
| DB unavailable | **No** — `503 GEO_STORE_UNAVAILABLE`, no fare, and a client `zoneId` cannot rescue the quote (GEO-E01, GEO-E02, PH6-UNREADABLE) |
| Inactive rule | **No** — the INACTIVE twin contributes nothing: ₹10 not ₹100, and it is counted as skipped (PH6-INACTIVE) |
| Expired rule | **Yes, still — and labelled `GEO_RULE_EXPIRED` with `applied: true`.** Enforcing windows is §14-4 and this row is a measurement, not an enforcement (PH6-K) |
| Future rule | **Yes, still — labelled `GEO_RULE_NOT_YET_ACTIVE`** under the same open decision (PH6-L) |
| Rule with no containing boundary | **Yes, through the one door left open**: reported as `basis=STATUS_ONLY`, which is status reaching a price without containment (PH6-STATUS) |
| Duplicate boundary rows | **Once** — 427 rows in 6 distinct shapes count as 6; deleting one identical row leaves the fare unchanged (SEC-08, FI-05) |

## R4. DRIVER LIFECYCLE MATRIX

Parsed from the registrations (array forms included), then exercised with a real driver session.

| Operation | Client geo trusted | Server geo check | Inside / outside / boundary | Invalid GPS | Stale GPS | Missing GPS |
|---|---|---|---|---|---|---|
| go online `/api/driver/:driverId/toggle-online` | none | none — no fence consulted | not reached: no geographic input | n/a | n/a | n/a |
| accept offer `/api/driver/offers/:offerId/accept` | none | none | not reached | n/a | n/a | n/a |
| accept job `/api/driver/accept-job` | none | none | not reached | n/a | n/a | n/a |
| arrived `/api/driver/arrived` | none | none | not reached | n/a | n/a | n/a |
| complete trip `/api/driver/complete-trip` | none | none | not reached | n/a | n/a | n/a |
| store position `/api/driver/location` | the coordinate only (`lat`,`lng`,`latitude`,`longitude`) | telemetry validity, then stored | all three answer the same three fields; no zone named | `400 GEO_INVALID_COORDINATES` / `GEO_COORDINATES_OUT_OF_RANGE` | `400 TELEMETRY_STALE` (7 h old) | `400 GEO_INVALID_COORDINATES` |
| fleet map `isOnline` | client claim, display only | none | unchanged by geography | n/a | n/a | n/a |

`operationalStatus` — the field that suspends a driver and that dispatch reads — cannot be set from
`/api/driver/location` (DRV-05). A clock-ahead fix is refused `400 TIMESTAMP_IN_FUTURE` (DRV-04).

## R5. ADMIN GEO-FENCE PERMISSION MATRIX

| Route | Method | Permission name | Anonymous | Verified findings |
|---|---|---|---|---|
| `/api/admin/geofences` | GET | `geofence.view` | `401` (GEO-D09) | returns the store inventory with `storeState` and `readAt` (GEO-D08) |
| `/api/admin/geofences` | POST | `geofence.create` | `401` | validates geometry and zone code; refuses with `400 GEO_GEOMETRY_*` / `GEO_ZONE_CODE_INVALID`, conflict as `409 GEO_ZONE_CODE_TAKEN` (FI-01, FI-02, FI-04, FI-10, GEO-D10) |
| `/api/admin/geofences/:id` | DELETE | `geofence.delete` | `401` | the copy the process prices from is re-read, so a deleted boundary stops pricing at once (FI-07) |
| `/api/admin/surgezones` | GET | `surge.view` | `401` (SEC-02) | — |
| `/api/admin/surgezones` | POST | `surge.create` | `401` (SEC-02) | a rule naming no boundary is refused `400 GEO_ZONE_UNRESOLVED` rather than bound to somebody else's (FI-03) |
| `/api/admin/geofences/:id` | PUT, PATCH | `geofence.edit` (catalogue only) | — | **does not exist** — `geofence.edit` grants nothing anywhere (CAT-05); edit/activate/deactivate/archive are §14-7 |
| `/api/admin/surgezones/:id` | DELETE | `surge.edit`, `surge.activate` (catalogue only) | — | **does not exist**; the audit removed orphan rules with a scoped SQL `DELETE` for the same reason |
| `/api/geofence/evaluate` | POST | none — tokenless | `200` | answers a verdict about one point; no vertices, `description`, `operating_hours` or `created_by` in the body (GEO-D07, SEC-03). Whether it needs a session is §14-8 |
| `/api/geofence/reverse-geocode` | POST | none — tokenless | `200` | refuses nonsense instead of naming it (SEC-04) |

`geofence.view`, `geofence.create`, `geofence.delete`, `surge.view`, `surge.create` are gated and
probed from both sides by `admin_authorization_test.js` (113 checks). The catalogue names
`geofence.edit`, `surge.edit` and `surge.activate` remain unenforced — reported, not granted.

## R6. FAILURE-INJECTION RESULTS

REQUEST / EXPECTED / ACTUAL / SAFE or UNSAFE / ROOT CAUSE, as the order asks. All local.

| # | REQUEST | EXPECTED | ACTUAL | SAFE? | ROOT CAUSE |
|---|---|---|---|---|---|
| FI-01 | admin write of a 2-point polygon | refused, nothing stored | `400 GEO_GEOMETRY_INVALID`, store still 427 rows | SAFE | `createGeoFence` used to substitute a hard-coded Delhi triangle and answer 200. Cause removed: the validator is the gate |
| FI-02 | admin write of a circle with no centre | refused | `400 GEO_GEOMETRY_INVALID` | SAFE | the substitution again — it drew a 3.5 km ring over Delhi |
| FI-03 | surge rule naming a non-existent boundary | refused, rule count unchanged | `400 GEO_ZONE_UNRESOLVED`, 425 rules still | SAFE | the rule used to bind by name-match to whatever it found first |
| FI-04 | self-intersecting ring (bowtie) | refused | `400 GEO_GEOMETRY_SELF_INTERSECT` | SAFE | ray-casting counts a bowtie's crossing point twice; containment was undefined, not merely expensive |
| FI-05 | two concurrent writes of one boundary | both may land; price must not compound | both `200` (2 ids), point prices ₹105 → ₹151, deleting one identical row leaves ₹151 | SAFE | found while writing this test: `zone_code` is UNIQUE, the name is truncated, and a 4-digit millisecond suffix made two fast writes collide — first as a `503`, then as a length error. Fixed by a UUID-derived suffix within the `varchar(40)` budget, and by not reporting a conflict as an outage |
| FI-10 | second write naming an existing zone code | `409`, distinguishable from an outage | `200` then `409 GEO_ZONE_CODE_TAKEN` | SAFE | the same class of mislabel from the other side: a rejected unique constraint is a data conflict |
| FI-06 | 6 quotes interleaved with 1 delete | every answer a definite verdict | 200 × 6, each with a geo answer, no torn read | SAFE | hydration swaps whole arrays, never in place |
| FI-07 | quote a point whose boundary was just deleted | no surcharge from a dead boundary | back to ₹105, no matched fence | SAFE | `geoStoreChanged` after every write; previously the process priced from its boot copy forever |
| FI-08 | sweep the probe rows this run created | store back where it started | 427 → 427 fences, 425 rules, 0 left behind (HYGIENE-01) | SAFE | a run that crashes mid-group left a twin fence behind, which contaminated the *next* run's inside counts — the sweep now runs before and after |
| FI-09 | store accepts connections but never answers | start must not serve a quote from unread geography | the process never opens `:4000` within 6 s, so no quote is served at all | SAFE, with a recorded risk | **the boot geo read has no timeout.** An unresponsive store therefore delays start rather than failing fast — reported, not redesigned, because the fix is a policy about availability |
| GEO-E01 | quote any point while the store is unreadable | `503`, no fare, no internal text | `503 GEO_STORE_UNAVAILABLE` for both an inside-looking and an outside-looking point | SAFE | `if (!gfErr && dbFences.length > 0)` used to leave the seed arrays authoritative |
| GEO-E02 | the same, with a client `zoneId` attached | must not rescue the quote | refused | SAFE | the `zoneId` branch no longer exists |
| GEO-E03 | public evaluate route during the outage | report unavailability, not the remembered answer | `503` | SAFE | cache is never an authorization source; `locationValidated` derives from this request's ability to answer |
| GEO-E04 | nonsense coordinates during the outage | a `400` about the coordinates | `400 GEO_INVALID_COORDINATES` | SAFE | validation order: input validity before store validity, so the message the caller can act on wins |
| GEO-E06 | book a ride during the outage | no job | 0 jobs by any door | SAFE | the booking route uses the engine's refusal helper |
| GEO-E09 | store a driver position during the outage | nothing stored | `telemetryStored` absent, non-200 | SAFE | a position nobody can price or dispatch against is not a reason to record one |
| PH6-UNREADABLE | engine bound to an unreadable store, named zone id | no membership, no multiplier, no price | refused | SAFE | `STORE_STATE.UNREADABLE` is a distinct state, not an empty list |

**One observation that did not reproduce.** A single `DELETE /api/admin/geofences/:id` returned `400`
in the first probe run of the zone-code work, immediately after two refused writes, for a row the
store then confirmed present. Five subsequent create→delete trials (immediate, after 500 ms, after 2 s,
with explicit and derived codes) all returned `200`, and the suites' own deletes (`FI-05`, `FI-10`) pass
every run. The path that produced it is `deleteGeoFence`'s `if (!existing) return null` → the route's
`400`, i.e. a read that did not see a row that was there. Not fixed, because a cause was not found;
recorded so a recurrence has a starting point.

## R7. Intentional behaviour changes, and new reason codes

Callers that relied on the old behaviour now get a different answer. Each of these is a deliberate
correction, not a regression:

1. `'Standard Operational Area'` is never emitted. A quote that matched nothing says `activeZoneName: null`.
2. A duplicate boundary no longer compounds a price: 179 identical polygons charge once. Surcharge totals on overlapping stores **fall** to one-per-shape.
3. Geometry that cannot be honoured is refused (`400`) instead of being repaired into a Delhi triangle at `200`.
4. A surge rule naming nothing is refused (`400 GEO_ZONE_UNRESOLVED`) instead of binding to the first name it matches.
5. `zoneId`, `inside`, `activeZoneName`, `surgeMultiplier` and `geoValidation` on an inbound body are ignored, and the response says so (`requestedZoneIdIgnored`).
6. Reverse geocoding refuses nonsense (`400`) instead of answering `200 "Live Location (NaN° N …)"`.
7. A zone code is stored exactly as named, or refused; never silently truncated. A collision is `409`, not `503`.
8. An unreadable geo store is a `503` on booking-critical calls where it used to be a silent `200` priced from compiled-in seeds.
9. The admin fence list gained an `inventory` block; the tokenless evaluate route lost its vertices.
10. `admin_authorization_test.js`'s route parser now reads statements, so three ungated routes it could not see are counted: `GET /api/admin/features`, `POST /api/v1/admin/features`, `GET /api/v1/fleet/locations`. The CAT-04 ceiling moved 14 → 17 **with those three named**, none of them gated here (features is the admin spec's flag-family decision; the fleet alias is §14-9).

New reason codes, all in `GeoPolicyService.REASON`, all client-safe (no stack text, no internal
detail, no secret or token in any of them): `GEO_INVALID_COORDINATES`, `GEO_COORDINATES_OUT_OF_RANGE`,
`GEO_STORE_UNAVAILABLE`, `GEO_GEOMETRY_INVALID`, `GEO_GEOMETRY_SELF_INTERSECT`, `GEO_ZONE_UNRESOLVED`,
`GEO_MULTIPLIER_INVALID`, `GEO_ZONE_CODE_TAKEN`, `GEO_ZONE_CODE_INVALID`, plus the window labels
`GEO_RULE_EXPIRED` and `GEO_RULE_NOT_YET_ACTIVE` and the telemetry codes
`TELEMETRY_STALE` / `TIMESTAMP_IN_FUTURE` the driver path already used.

## R8. REMAINING DECISIONS

**The nine §14 decisions are reproduced below exactly as the audit left them. None was resolved by
this remediation, by a test, or by a default in code.** Where a decision is listed in the matrices
above as "NOT DECIDED", that is the state of the work: the engine can see the condition, report it,
and act on it the moment the decision is made — but the decision is a commercial and legal one, and a
test that asserted an answer would be that answer chosen by whoever wrote the test.

| §14 | Decision | What this pass left it with |
|---|---|---|
| 1 | Does "outside the service area" refuse, reprice, or mean nothing? | Unanswered. RIDE repriced-to-nothing and booked; FOOD and PARCEL read no coordinate; DRIVER and DISPATCH ask no question of geography. Every one of those is now *labelled*, so answering this is a change in one place |
| 2 | Is client-supplied `zoneId` a feature or a hole? | **Answered by the order itself (Phase 3: it must go) and implemented.** Recorded here so the removal traces to an instruction, not to judgement |
| 3 | Overlapping fences: additive, max, or highest-`priority`? | Unanswered. Duplicate *shapes* are excluded as arithmetic; distinct overlaps still sum surcharge and take the max multiplier (`PH6-O`), which is the platform's existing rule now made visible |
| 4 | Must a surge rule have containment and a date? | Unanswered. `EXPIRED` and `NOT_YET_ACTIVE` are measured and reported, and the rule is applied anyway; `basis=STATUS_ONLY` names the door |
| 5 | Global surge multiplier: table or process memory? (2.2 vs 1.00 vs 1.4 measured) | Unanswered. The engine takes the multiplier from the bound source and reports it, so the two answers no longer silently disagree inside one request — but which source is authoritative is still the platform's choice |
| 6 | Are `allowed_services` / `allowed_vehicles` / `operating_hours` meant to bind? | Unanswered. Still written, mapped and consulted by no decision; `GEO-B09` refuses an unknown `allowedServices` value on *write*, which is not the same as honouring one |
| 7 | Geo lifecycle: build edit/activate/deactivate/archive? | Unanswered. `edit`/`activate`/`deactivate` need no migration; `archive` needs a column, and no migration was written. The catalogue names `geofence.edit`, `surge.edit`, `surge.activate` remain unenforced |
| 8 | Is the fence catalogue supposed to be public? | Unanswered. The anon key still reads active boundaries with geometry (`SEC-07-KNOWN-GAP`, asserted as an open finding so a change is noticed); the tokenless evaluate route now leaks less, but whether it should require a session at all is this decision |
| 9 | Who may read live driver positions? | Unanswered. `GET /api/fleet/locations` and its `/api/v1` alias still carry `authenticateAdmin` with no permission name — the alias is now *counted* by CAT-04 where it used to be invisible to the parser |

**Four further items this pass found and did not silently resolve.**

1. **The anon-key read of active geometry** (a consequence of §14-8, not separate from it). Narrowing
   `p_read_active_geofences` is DDL: a policy change, not a code change. It was left alone, and the
   test that documents it is written to fail loudly when somebody changes it without saying so.
2. **No timeout on the boot geo read** (`FI-09`). An unresponsive store delays start instead of failing
   fast. A timeout is an availability policy — what should happen when the store is slow *at boot* is
   the same family of question as §14-1's "refuse or serve", so it is reported rather than chosen here.
3. **Cross-instance propagation of a geo write.** One process re-reads its own copy after its own
   write (`CACHE-01…05` prove it); a second instance still serves from its own copy until something
   else refreshes it, because there is no invalidation broadcast on the geo routes. Fixing that touches
   the same authorization blast radius the admin specification stops at (§9 item 6 of that document),
   so it is recorded as a remaining risk rather than redesigned inside a geo-fencing pass.
4. **A session written by another instance is honoured by a long-lived backend and not by a
   just-booted one** (`RX-01…03`, `INP-21…22` — green twice against a warm process, red against a
   verified-fresh one). This is the *general* form of item 3: cross-instance convergence is assumed by
   these tests and has never been proven against a cold process. It also qualifies a claim already on
   the record — `docs/ADMIN_PERMISSION_MATRIX.md:414-415` states the adoption as working (INP-21) —
   so that sentence needs a cold-start case, and the correction belongs to the same decision the
   permission catalogue parked it at (spec §11 decision 16 with its §9 item 6). It is not geo
   behaviour and this order's diff does not touch the path, so it is reported with its evidence in R9
   rather than fixed inside a geo pass.

## R9. Regression evidence, and what each pass was actually worth

Phase 18 asked for the important suites twice, serially, and for no skip to be undocumented. Three
passes were run against one working tree — the code is identical in all three columns, so every
difference below is a difference in the *process*, not in the fix.

| Harness | Pass 1 — one shared warm process | Pass 2 — intended fresh | Pass 3 — verified fresh |
| --- | --- | --- | --- |
| `test_suite.js` | 419 PASSED / 0 FAILED | 419 / 0 | 419 / 0 |
| `geo_policy_test.js` | 55 / 0 | 55 / 0 | 55 / 0 |
| `geo_adversarial_test.js` | 57 / 0 | 57 / 0 | 57 / 0 |
| `admin_authorization_test.js` | 113 / 0 | 113 / 0 | **110 / 3** |
| `admin_audit_fail_closed_test.js` | 79 / 0 | 79 / 0 | 79 / 0 |
| `admin_customers_test.js` | exit 0 | exit 0 | **exit 1, 81 / 83** |
| `admin_identity_gates_test.js` | exit 0 | exit 0 | exit 0 |
| `admin_settings_surface_test.js` | 31 / 0 | 31 / 0 | 31 / 0 |
| `audit_drop_visibility_test.js` | 8 / 0 | 8 / 0 | 8 / 0 |
| `auth_failclosed_test.js` | 15 / 0 | 15 / 0 | 15 / 0 |
| `test_phase4_orders.js` | 66 / 0 | 66 / 0 | 66 / 0 |
| `test_phase5_payments.js` | 62 / 0 | not run | 62 / 0 |
| `test_phase6_dispatch.js` | **exit 1, fatal** | 62 / 0 | 62 / 0 |
| `test_phase7_security.js` | **36 / 9** | 45 / 0 | 45 / 0 |
| `test_phase8_security.js` | exit 0 | not run | exit 0 |
| `test_phase9_financial_security.js` | exit 0 | exit 0 | exit 0 |
| `test_phase10_security.js` | exit 0 | not run | exit 0 |
| `test_phase11_feature_control.js` | exit 0 | exit 0 | exit 0 |
| `payment_sandbox_test.js` | **never executed** | 5 / 4 | 9 / 0 |
| `payment_verifier_config_test.js` | 13 / 0 | 13 / 0 | 13 / 0 |
| `payment_production_readiness_test.js` | exit 0 | not run | 11 / 0 |
| `smoke_test.js` | 5 / 0 | not run | 5 / 0 |
| `restart_test.js` | 35 / 0 | 35 / 0 | 35 / 0 |
| `bootstrap_test.js` | exit 1 | exit 1 | exit 1 |

**Pass 2 does not evidence what it was written to evidence, and is reported as void.** Its script meant
to start a backend per harness and clear `:4000` between them; its port lookup was
`grep "TCP .*:4000 .*:0 LISTENING"`, and netstat pads each column to the widest row in the table, so
`:0` is followed by several spaces, never the one the pattern asked for. The pattern matched nothing,
the old server was never killed, each new one died with `EADDRINUSE` — **54 of them in that log** —
and every harness answered against whichever process was already listening. The `exit=0` column for
pass 2 is therefore "ran against a live backend", which is what pass 1 already was. Pass 3 repeats the
same 24 harnesses with the port released and *confirmed free by polling*, and asserts the hand-off by
process identity rather than by a health probe: the backend writes its own `process.pid` before it
loads (a Git Bash `$!` is an MSYS pid and netstat reports the Win32 one, so the two can never be
compared), and a harness only runs once the pid holding `:4000` is that number. Pass 3 recorded
**0 `EADDRINUSE` lines and 0 hand-off mismatches**.

**Three reds were attributed before any of them was treated as a code fault.**

1. `test_phase6_dispatch.js` (fatal: `order.id` of undefined) and `test_phase7_security.js` (36/9) in
   pass 1: `test_phase11_feature_control.js` disables `FEATURE_RIDE_TAXI` at its lockdown test and
   never put it back. The flag is persisted, so the *next* process booted into a lockdown and every
   ride booking after it answered `403 FEATURE_DISABLED`. Fixed at source — the harness now restores
   what it took — and both harnesses are green in pass 3 with no production code involved. A harness
   that poisons the environment its successors share is not a test of the platform.
2. `payment_sandbox_test.js` 5/4 in pass 2 (and never executed at all in pass 1, where the port was
   closed under it and it printed no summary while still exiting 0): its step 2 signs
   `orderId|paymentId` with `PAYMENT_KEY_SECRET`, which pass 2's server did not carry, so the checkout
   verifier answered `503 PAYMENT_VERIFIER_UNCONFIGURED`. With both payment secrets on the serving
   process it is **9 PASSED / 0 FAILED** (pass 3). Note two things about this harness: it exits 0
   whatever its assertions say, and a missing `📊 … PASSED, … FAILED` line means *it did not run*, not
   that it passed.
3. `bootstrap_test.js` cannot pass "Valid bootstrap succeeds (200)" on this database, and the 403 it
   receives is the route behaving correctly. It resets by deleting every `admin_accounts` row, but
   `support_tickets_assigned_admin_id_fkey` pins one administrator with **723 tickets**, so PostgREST
   refuses the whole statement; the harness never inspects the builder's `error` — a returned object,
   not a throw, so its `try/catch` cannot see it — the 351 rows survive, and `/api/admin/bootstrap`
   then answers the generic 403 because `db.adminUsers.length > 0`. Its two later PASSes ("Login with
   bootstrapped credentials succeeds", "Bootstrap permanently disabled after first admin") are
   therefore evidence about the *pre-existing* `superadmin`, not about a fresh bootstrap, and are
   reported here so nobody reads them as the former. Fixing the harness means either nulling
   `support_tickets.assigned_admin_id` first or restoring a clean store — a data decision outside a
   geo-fencing pass, so it is reported, not taken.

**The one red that is a finding, not an environment artifact.** Pass 3 is the first pass that ever
ran these harnesses against a process it can name, and it turned up two failures that passes 1 and 2
had hidden by reusing a warm server:

- `admin_authorization_test.js` **RX-01/02/03** — "a session written by another instance is honoured
  within the 15-second reconcile window (never)", after 40 one-second polls.
- `admin_customers_test.js` **INP-21/22** — the same property from the customer side: "a bearer this
  instance never issued is honoured by it after the reconcile tick" answered `401`.

Both groups test the same mechanism: a row inserted into `backend_sessions` by someone else should be
honoured by a process that never issued it, once `reconcileSessions()` next runs
(`server.js:7922`, an unconditional 15-second interval created before `listen`). It passes against a
long-lived process and fails against a just-booted one, which makes the property
**instance-lifetime-dependent rather than universally broken** — and it is not geo behaviour: the
diff for this order touches no line on that path (zero added or removed lines mentioning
`reconcileSessions`, `hydrateSessions`, `activeAdminSessions` or `backend_sessions`, and its
`server.js` hunks sit at 15–16, 51–103 and 2864–3350, not near 7915–7926).

Nor is it unknown ground. `docs/ADMIN_PERMISSION_MATRIX.md:414-415` already states the property as
established — "**A session another instance wrote is adopted here inside the reconcile tick**
(INP-21). That direction of convergence works" — alongside the predicate that makes the opposite
direction fail (`if (isDevFixture || /^[0-9a-f]{64}$/.test(key)) continue;`, `database.js:5886`,
skipping exactly the rows a remote revocation needs dropped). What pass 3 adds is a qualification of
that sentence rather than a new mechanism: **adoption holds against a long-lived process and fails
against one that has just booted**, so "works" is true within an instance lifetime and not across
lifetime boundaries. The correction stays where the permission catalogue left it — spec §11 decision
16 with §9 item 6 attached, deliberately not taken in a geo pass because it changes the
authorisation path of every process sharing the store. INP-25/INP-26 hold the present behaviour in
place so a future change has to be a decision, and this document now records that the claim needs a
cold-start case too. It also explains a note this project has carried for a while: a single
admin-harness failure on a heavily-reused server that "has not reproduced in six runs". It
reproduces on a cold one.

**Client halves of Phase 18.**

| Check | Result |
| --- | --- |
| `flutter analyze` (mobile) | 67 issues, **0 errors, 0 warnings** — 53 `prefer_const_constructors`, 13 `deprecated_member_use`, 1 `prefer_const_literals_to_create_immutables`; exit 1 is what analyze returns for info-only findings. Pre-existing style debt, and `mobile/` is untouched by this order |
| `flutter test` (mobile) | **56 passed, 0 failed**, exit 0 |
| `npm run lint` (admin-web) | **0 errors, 1 warning** (a `no-location-assign-relative-destination` in `src/lib/api.ts`), exit 0 |
| `npm run build` (admin-web) | build succeeded, 9 routes emitted, exit 0 |
| Browser walk (`admin_dashboard.html`) | walked against the live backend, logged in as the local superadministrator, on the Geo-Fencing & Surge view |

The walk is the part that cannot be proven by a Node harness, because the two labels this order
changed are strings the DOM assembles. Served from an origin the backend's CORS allow-list already
lists — port 3003 — rather than by widening that list, which is a security control and not a
convenience. With a scratch static host proxying `/api` to `:4000`:

| Point | Rendered status | Rendered multiplier |
| --- | --- | --- |
| the page's own fallback position (no browser GPS) | `● OUTSIDE EVERY BOUNDARY (no boundary contains this point, so no geographic modifier applies)` | `1.0x (no boundary matched)` |
| 28.6315°, 77.2167° (inside a real polygon) | `✓ INSIDE GEOFENCE: Connaught Place CBD Boundary · 1.40x Dynamic Surge` | `1.40x (CBD_HIGH_DEMAND)` |
| 12.9716°, 77.5946° (Bengaluru; matches nothing) | `● OUTSIDE EVERY BOUNDARY` | `1.0x (no boundary matched)` |
| coordinate tester, 999.0000° | `NOT EVALUATED (GEO_COORDINATES_OUT_OF_RANGE)` | — |
| coordinate tester, inside / outside | `INSIDE Connaught Place CBD Boundary · Dynamic Surge: 1.40x · Toll: ₹0.00` / `OUTSIDE EVERY BOUNDARY (No geographic modifier applies)` | — |

`document.body.innerText` was also read for the string the old code invented — `Standard Operational
Coverage Area` — and it is **absent from the rendered page**. The `● GEOGRAPHY UNAVAILABLE` branch was
not walked in a browser: it needs the boundary store to refuse, which is a running-container
interruption, and `outage_semantics_audit.js` is the only harness that causes one deliberately. That
branch is covered by `geo_adversarial_test.js` (FI-01…FI-07) and by the `locationValidated === false`
assertions in `geo_policy_test.js`, and is reported as covered that way rather than claimed as walked.

**Suites deliberately not run, and why.** `cloudinary_test.js` — its assertions upload assets to a
hosted service, and the order's constraints forbid contacting hosted environments.
`chaos_audit.js` and `outage_semantics_audit.js` — both stop and restart the `supabase_db_nabin`
container to observe outage behaviour, must run alone, and their fail-closed conclusions are already
asserted inside the pass-3 harnesses (`auth_failclosed_test.js` 15/0, `admin_audit_fail_closed_test.js`
79/0, geo group E, FI-01…FI-09). `test_migration_019.js` — it applies a migration, and no migration was
required or written by this order. `phase9_financial_audit.js` — a reporting probe: `grep -c "assert("`
returns **0**, so it has no assertions to contribute, though it does exit 1 if the store cannot be
read.

**One environmental drift worth naming, because the next reader of §16 will otherwise count fences and
find a different number.** The audit census was 420 fences / 418 surge rules. The store now holds
**439 / 437**, all of them active, and the increase is not corruption — it is a fixture leak this
order measured but did not cause and did not fix:

| Family | Rows | Created by |
| --- | --- | --- |
| `Noida IT Sector 62 Boundary` | **185**, identical | `test_suite.js` MODULE 5, which creates it and never deletes it — one per run, since that suite was written |
| `AUDIT_PROBE*` / `PERM_*` / `RLSDIFFY` | 0 | §16's own audit probes, cleaned up as recorded there |
| `GeoPolicy *` (the `GEO-D*` fixtures, including `GEO-D10`'s named fence) | 0 | `geo_policy_test.js`, which deletes each one in the same run |
| `Two Point Non-Boundary`, `Centreless Circle` | 0 | refused at the door by `GEO_GEOMETRY_INVALID`, which is the point of asserting them — a rejected write leaves no row |

So the geo suites this order added are self-cleaning, and the pre-existing `test_suite.js` fixture is
not. It matters for more than tidiness: `evaluateLocationGeofences` ray-casts **every** active fence,
so 185 copies of one Noida triangle are 185 redundant boundary tests on the hot path, and §11's
concurrency numbers were taken against a store already carrying them. Deleting them is a one-line
teardown in `test_suite.js` beside the `DELETE /api/admin/geofences/:id` call it already makes for
another fixture at line 2166 — deliberately left undone here, because this order's rule was to stop
changing booking and pricing behaviour, not to widen into a suite's fixture hygiene while claiming to
be auditing geography.

**No push, no deploy, no hosted contact, no migration written or applied, no secret printed.** Every
key in every command above was piped through an environment variable and only its presence was
observed; the one place a token appears in this document is a truncated SHA-256 handle, which is not
one.
