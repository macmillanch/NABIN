# GEO State — ₹NaN Root-Cause Investigation

## NaN FAILURE OBSERVABILITY (2026-09-29)

**This is instrumentation, not a fix, and it does not establish a root cause.**

- The original NaN was **not reproduced** — controlled inside/outside modifier testing was finite
  across the quote, the booking response, and the persisted row (§"FINAL INSIDE-MODIFIER
  EXPERIMENT" above).
- The reason that investigation could not be closed as *impossible* is that **the original response
  body was never captured**: the only artifact was `Number(value ?? NaN)`.
- The harness now captures the relevant raw response **when, and only when, a booking the server
  reported as created yields a non-finite fare.**

### Change

`backend/geo_adversarial_test.js` only (99 insertions, 5 deletions):

1. `request()` additionally returns `res.headers` — additive; no assertion reads it.
2. `quote()` records a compact summary of the last quote, included in the diagnostic as
   `nearest prior quote` (labelled as such because the suite's concurrent sections can interleave).
3. `book()` keeps the **original fare expression byte-for-byte, including its NaN terminus**, and
   calls `reportNonFiniteFare()` when `created && !Number.isFinite(fare)`. Output: HTTP status,
   allowlisted headers, redacted body, top-level/`job`/`order` key sets, every candidate in the
   fallback chain, the selected raw value and its type, idempotency key, job id, duplicate flag,
   call-site frame.

**Trigger had to be narrowed.** The first version fired on any non-finite fare and produced
**3 diagnostics on a fully passing 62/0 run** — because the suite deliberately books refused
coordinates (`lat=999`, `lat="abc"`), where "no fare" is the correct answer. Gating on
`created &&` non-finite is what makes this signal rather than noise.

### Verification (freshly executed)

| condition | result |
|---|---|
| real server, normal run | **62 PASSED, 0 FAILED, exit 0, diagnostics emitted: 0** — no noise, assertions untouched |
| local stub returning a created job with **no fare field** (the historical anomaly shape) | **31 PASSED, 31 FAILED, exit 1, diagnostics emitted: 26** — the failure still *fails*; only the evidence is new |
| planted `set-cookie` / `authorization` secret in the response headers | occurrences in output: **0** (allowlist, not blocklist) |
| planted OTP / password-hash / session-token values in the body | `__REDACTED__` markers: **175**; raw values never appear |
| customer phone number | masked to `****1982` (25×) — last four digits only, by design |

### Explicitly not claimed

- **No product code was changed.** `geo_adversarial_test.js` is the only tracked file edited in this
  pass; the `src/` and migration diffs present in the working tree belong to earlier tasks and were
  not touched here.
- No pricing, booking, persistence, `sweepGeoAdv`, cleanup, surge precedence, or geo/surge residue
  was modified.
- **The test-harness-interpretation hypothesis is NOT proven.** It remains the one surviving
  candidate class because every other mechanism was disproved by measurement; this change exists so
  that if the symptom ever recurs, the response is recorded instead of theorised about.

### Artifacts

`backend/scratch/fare_diag_stub.js` (local stub used solely to prove the trigger and the redaction;
listens on `127.0.0.1:4211`, touches no database), `backend/scratch/stub_diag.log` (its output).

---


## FINAL INSIDE-MODIFIER EXPERIMENT (2026-09-29) — closes the investigation

**INSIDE-MODIFIER NaN NOT REPRODUCED.**

Run against a server this script spawned (pid 27884, killed by the script), gated on BOTH
`/api/health` and `/api/ready`, with the geo store confirmed `VALIDATED / source: postgres`,
real customer OTP authentication, the real quote endpoint `POST /api/pricing/estimate` and the
real `POST /api/customer/book-ride`, and the persisted row read straight from PostgreSQL.
Field names and the fixture shape were copied from `geo_adversarial_test.js` (which creates
`{ type:'CIRCLE', center, radiusMeters, surcharge, surgeMultiplier, status:'ACTIVE', name }`),
not guessed.

### 1. Fixture definition

Created through the admin API, then verified in PostgreSQL (never assumed):

```
zone_name       GeoInside mulmjhzqf4c1f4     id dccb5f5b-f715-4c99-8d30-08947eeb857f
geometry_type   CIRCLE     center 28.6328, 77.2197     radius_meters 4000
surge_multiplier 1.10      surcharge_amount 33.00      is_active true
zone_code       ZONE_GEOINSIDE_MULMJHZQF4C1F4_32f867fc
```

INSIDE coordinate = the fixture's own centre. OUTSIDE control = `27.50, 88.50`
(the suite's own "outside everything" point).

### 2. Outside control

| measure | value |
|---|---|
| quote | `109`, multiplier `1`, `geoStatus=VALIDATED_OUTSIDE`, `matched=false`, `zone=null` |
| booking response fare | `105` (finite) |
| persisted `jobs` row | `fare_subtotal 105`, `surge_multiplier 1`, `surge_amount 0`, `discount_amount 0`, `tax_amount 0`, `packaging_fee 0`, `final_total 105`, `driver_earnings 89`, `cancellation_fee 0`, `refund_amount 0` |
| non-finite fields | **none** |

### 3–5. Inside quote, booking, persistence — 5 consecutive runs, fresh idempotency key each time

Every run produced **identical** numbers:

| measure | value (×5) |
|---|---|
| quote | `196`, multiplier **`1.4`**, `geoStatus=VALIDATED_INSIDE`, `matched=true` |
| matched zones | `"GeoInside mulmjhzqf4c1f4, Connaught Place CBD Boundary"` — **two** ACTIVE boundaries genuinely overlap this point |
| booking response fare | `190` (finite) |
| persisted row | `fare_subtotal 190`, `surge_multiplier 1.4`, `surge_amount 0`, `final_total 190`, `driver_earnings 161`, discounts/tax/fees/refund 0 |
| non-finite fields | **none, in any run** |

`quote 196 | response 190 | fare_subtotal 190 | final_total 190` — the persisted money is
internally consistent; quote and booking differ by the same small amount in the outside control
too (109 vs 105), which is the two endpoints pricing slightly different inputs (the quote call
passes an explicit distance/duration; the booking derives its own from the coordinates), not a
money defect. Not investigated further, and deliberately not reported as a finding.

### 6. Replay

Same idempotency key, inside booking replayed: `200`, **`duplicate=true`**, fare `190` finite,
**same job id**, **identical response key set**, no non-finite persisted field.

### 7–8. Repeatability and finiteness

5 runs, 0 non-finite values across quote, response, and persistence. Geography **did** bind this
time — multiplier `1.4`, surcharge applied, `VALIDATED_INSIDE` — so unlike the earlier probe this
exercised the inside-with-modifier leg, which was the exact leg the original chain failure
reported as `₹NaN`.

### Overlapping-zone precedence — now confirmed empirically

The INSIDE point matched two ACTIVE boundaries with different multipliers (fixture `1.1`, seeded
CBD `1.4`) and the engine selected **`1.4` on all five runs**: the **maximum** multiplier wins,
deterministically. This confirms from runtime output what the code (`GeoPolicyService.js:588-589`)
indicated, and it is the question §12 of the earlier pass left open. No precedence rule was
invented and no ordering was changed.

### 9–10. Conclusion

**NaN REPRODUCED: NO** — under controlled inside-modifier conditions, through the real booking
path with a hydrated store and direct persistence reads.

**ROOT CAUSE OF THE ORIGINAL SEVEN CHAIN FAILURES: NOT PROVEN.** Every mechanism ever proposed
for it has now been disproved by measurement: NULL/malformed multipliers, `Math.max(…, undefined)`,
idempotent-replay response shape, pagination truncation, cleanup matching on a non-existent field,
non-deterministic overlap selection, and corrupt persisted money. The condition does not occur in
the outside control, the inside case, the replay, or across five repeats.

Per Phase 9 the investigation is closed as: **not reproduced under controlled inside/outside
modifier conditions.** Accordingly **nothing was changed** — no product code, no `sweepGeoAdv`,
no cleanup, no surge logic, no zone precedence, and **no regression test was added**, because a
test written now would assert a hypothesis rather than an observed failure.

### Remaining uncertainty

One honest gap: I have not observed the original failing event, so I cannot exclude a
state-dependent cause tied to the store as it stood during that specific chain run (it has since
been re-measured many times without reproducing). That is recorded as an open possibility, not
resolved, and it is the only reason this is filed as "not reproduced" rather than "impossible".

### 12. Temporary residue and cleanup status

* **Fixture: created and removed.** The first `DELETE` returned `400` and my script printed only
  the status, so **its reason is unrecorded** — a limitation of my own probe. The retry returned
  `200` with the deleted record echoed back, and PostgreSQL confirms `0` rows for that id and
  `geo_fences` back to **447**. The one structural difference between the two calls was that the
  failing one sent a literal `null` request body while the succeeding one sent no body; noted as
  an observation, not asserted as the cause.
* **Pre-existing rows: untouched** — `geo_fences` 447 → 447, `surge_zones` 445 → 445.
* **Probe bookings retained: 6 job rows** (`jobs` 5,514 → 5,520). Not deleted: FK children were
  inspected for `geo_fences` but not for `jobs`, and deleting money rows to tidy a probe is
  precisely what Phase 10 forbids doing blindly. Reported as residue.
* Earlier probes also left 2 job rows (5,512 → 5,514).

### 13. SEPARATE FOLLOW-UP (recorded only, not investigated)

```
activeRulesWithoutZoneBinding = 10
```
Observed in `GET /api/admin/geofences` → `inventory`. No conclusion about correctness. No code
changes. Related, unexamined: only 257 of 447 fences carry a usable centre.

### Scripts

`backend/scratch/geo_exp3_inside.js` (Phases 2–7), `backend/scratch/geo_exp3_cleanup.js`
(Phase 10). Read-only apart from the one fixture they created and removed, and the bookings the
real path made.

### Not re-run in this pass

No suite was executed during this experiment, so **nothing here is claimed green**: geo ×5,
restart, the OP-1 gate and the chain all carry over from earlier passes with their recorded
numbers. No file under `src/` or any test file was modified.

---

## DECISIVE PASS (2026-09-29) — supersedes §1–§8 below


Two experiments were run against a server this investigation spawned itself (PIDs 35716, 36148,
36148/…, all killed by the scripts), waited for **both** `/api/health` **and** `/api/ready`, and
cross-checked every conclusion with a direct PostgreSQL read.

### Experiment 1 — the cleanup suspicion is DISPROVED

`GET /api/admin/geofences` (live response, same ids read back from `geo_fences`):

* the response **maps `zone_name` → both `name` and `zoneName`**, and the values are identical to
  the DB column. Verified on a real row: `DB.zone_name = "Connaught Place CBD Boundary"` ↔
  `API.name = "Connaught Place CBD Boundary"`, `API.zoneName` the same.
* **`sweepGeoAdv`'s `f.name` therefore works.** The previous section's suspicion that cleanup
  "structurally fails" because `geo_fences` has no `name` column was **wrong**: the API supplies a
  mapped `name`. **Per §15 the cleanup code was NOT modified.**
* **No pagination truncation**: 447 rows returned vs 447 in the table — complete. `?limit=5000`
  and `?page=2` both return 447 (the handler ignores paging parameters; there is no server-side
  paging on this list, and PostgREST's `max_rows=1000` covers the whole table today).
* The platform already measures the residue itself:
  `inventory.duplicateFenceRows=441`, `duplicatedFenceShapes=3`, `fenceCount=447`,
  `activeFenceCount=447`, `malformedFenceCount=0`, and a new finding —
  **`activeRulesWithoutZoneBinding=10`**.
* Store state was `VALIDATED / source: postgres`, confirming the earlier `STORE_UNAVAILABLE` in
  §4 was my un-hydrated harness, as stated.

### Experiment 2 — the money path is finite under the real booking flow

Using the deterministic local OTP session and `POST /api/customer/book-ride` with a fresh
`Idempotency-Key`, at a real active boundary's own centre:

| step | result |
|---|---|
| booking #1 (fresh) | `200`, `success=true`, `job.fare = 105` — **finite** |
| booking #2 (**same key, replay**) | `200`, **`duplicate=true`**, `job.fare = 105` — **finite** |
| response shape | identical key sets on both, `fare` present in both → the replay-shape hypothesis is **disproved** |
| persisted row (direct PostgreSQL) | `fare_subtotal 105`, `final_total 105`, `driver_earnings 89`, `surge_multiplier 1`, `surge_amount 0`, `discount_amount 0`, `tax_amount 0`, `refund_amount 0`, `packaging_fee 0`, `cancellation_fee 0` — **every money column finite: YES** |
| overlap determinism | 6 identical quote calls → **1 distinct tuple → DETERMINISTIC** |

**NaN REPRODUCED: NO.** Nothing produced `NaN`, `null`, `undefined` or `Infinity` in a fare field.

**Honest limitation:** the coordinate chosen did **not** bind geography — the persisted
`surge_multiplier=1` / `surge_amount=0` show the fare was geography-free, so *my* probe exercised
the outside leg, not the inside-with-modifier leg. The inside leg is exercised by the suite itself
(`MTX-R05/INV-07`, "job fare ₹144 = server quote ₹144"), which passes 62/62 ×5. **Residue:**
my runs created 2 job rows (`jobs` 5,512 → 5,514); the cancel route I tried answered 404, and I
did not delete them directly because their FK children were not inspected — recorded rather than
guessed at. `geo_fences` 447 and `surge_zones` 445 unchanged: **no geo row was deleted.**

### What is now ruled out as the ₹NaN cause

NULL/malformed multipliers (both tables) · `Math.max(…, undefined)` in the fare engine ·
idempotent-replay response shape · pagination hiding rows · non-deterministic zone matching ·
corrupt persisted money.

### Remaining position

**ROOT CAUSE: NOT PROVEN.** The original 7 chain failures are not reproducible under any condition
tested, and every mechanism proposed for them has now been disproved by measurement. No fix is
justified, no regression test is written (§17 forbids testing an unproven hypothesis), and no
cleanup code was changed because §15's "already correct" branch is the one that turned out to be
true.

---

## Earlier notes (2026-09-28), retained for provenance — partially superseded by the above


Status: **IN PROGRESS / BLOCKED ON CONTEXT. ROOT CAUSE: NOT PROVEN.**
This is an honest partial record, not a closure. Nothing below is inferred from a table or column
name; every claim carries the command or file line that produced it, and my own errors are marked
as such.

HEAD `9924138b1d19a3e9e176e1e7883b3c44b23762e6`, unchanged. No commit, no push, no staging. Local
Docker only (`127.0.0.1:54321` / `:54322`), guarded by a loopback check in every probe before it
connects. **No data was purged, no database reset, no `geo_fences` or `surge_zones` row deleted**
(§3 respected).

## 1. What is now ruled out (evidence, not assumption)

| Candidate | Result | Evidence |
|---|---|---|
| NULL / malformed multiplier in `geo_fences` | **RULED OUT** | 447 rows: `null_mult=0`, `null_surcharge=0`, `inactive=0` |
| NULL / malformed multiplier in `surge_zones` | **RULED OUT** | 445 rows: `null_mult=0`, `not_active=0`, `null_window=0` |
| `Math.max(surgeMultiplier, geo.effectiveSurgeMultiplier)` receiving `undefined` (`database.js:2438`) | **RULED OUT by reading `GeoPolicyService.js`** | every multiplier source is coerced: `Number(fence.surgeMultiplier ?? 1) \|\| 1` (L384), `Number(fence.surgeMultiplier \|\| 1)` (L588), and the return is `Math.round(effectiveSurgeMultiplier * 100) / 100` (L683). `evaluate()` cannot hand back `undefined` for that field. My initial hypothesis was wrong and is recorded as disproved. |
| The 373 duplicate rows carrying bad values that poison a match | **RULED OUT as a data-quality issue** | sampled duplicate `Restart Test Aero City Zone` rows are byte-identical to each other (`surge_multiplier 1.25`, `surcharge_amount 65.00`, `category HIGH_DEMAND`, same centre). They are *redundant*, not corrupt. |

## 2. What is confirmed about the accumulated state

* `geo_fences` 447 rows / 6 distinct `zone_name`; `surge_zones` 445 rows, all `ACTIVE`.
* Duplicates are **identical copies**, so they are test residue rather than legitimate distinct
  zones — a boundary name repeated 188 times is not 188 different geographies.
* The `zone_name` **"Restart Test Aero City Zone" is self-attributing to `restart_test.js`**, whose
  own comments (lines 148–150) record that "until now nothing ever removed them: one run left 1
  `geo_fences` row and 1 `surge_zones` row behind, permanently". That explains the mechanism of
  accumulation (one per historical run) for at least this group.
* Ownership of `Noida IT Sector 62 Boundary` (188) and `South Delhi Hospital Corridor` (185) is
  **NOT YET PROVEN**. It requires the repository search in §5 of the directive, which was not
  completed before context ran out.

## 3. The cleanup question — deliberately not "fixed" yet

The previous report's observation stands: **`geo_fences` has no `name` column** (verified from
`information_schema.columns`: `id, zone_name, zone_code, geometry_type, coordinates,
surcharge_amount, surge_multiplier, is_active, created_at, category, center_lat, center_lng,
radius_meters, allowed_services, allowed_vehicles, operating_hours, description, created_by,
updated_at`), while `sweepGeoAdv` filters `String(f.name \|\| '').startsWith('GeoAdv ')`
(`geo_adversarial_test.js:699`).

**What has NOT been established, and is why no edit was made:** whether the admin geofence route
maps a `name` field onto its response from one of those columns. If it does, the filter works
against the API even though the column is named differently, and "changing `f.name` to
`f.zone_name`" would be an unnecessary edit to a security test — or worse, would start deleting
rows matched on a different field than intended. The directive (§6) says exactly this: verify that
`zone_name` is authoritative for those probe rows *before* changing the filter. That verification
— one response-shape read of `/api/admin/geofences` plus a direct DB cross-check — is the next
action, not a code change.

Also unresolved: whether cleanup must remove **both** `geo_fences` and `surge_zones`, and the FK
deletion order between them.

## 4. The NaN reproduction attempt — inconclusive because of my own probe

`scratch/geo_nan_trace.js` reported "24 NON-FINITE RESULTS". **That is a false positive produced by
the probe, not by the backend:**

* it asserted on `customerFare` and `totalSurcharge`, which `calculateFareEstimate` does not return
  (it returns `finalCustomerCharge`, `baseCharge`, `platformFee`, `driverEarnings`,
  `surgeMultiplier`) — absent properties are `undefined`, which my filter flags as non-finite; and
* every one of those calls answered `geoStatus: STORE_UNAVAILABLE`, because I required a fresh
  `db` instance in a script that never completed a real boot hydration — the engine correctly
  refused to price from unverified boundaries, which is the designed fail-closed behaviour, not a
  bug.

So the quote path was **not** actually exercised under a hydrated store, and the persisted-booking
leg (`jobs.fare_subtotal`, `jobs.surge_amount`) was **not** exercised at all. **NaN REPRODUCED: NO
— and equally NOT RULED OUT.** Converting this run into evidence requires re-running against a
fully hydrated store and asserting on the real field names, then creating a booking and reading
`jobs.fare_subtotal` back.

## 5. Overlapping-zone determinism — the architectural question still open

`GeoPolicyService.evaluate()` collects `matchedFences` and then takes the **maximum** multiplier
across matches (L588–589: `if (multiplier > effectiveSurgeMultiplier) effectiveSurgeMultiplier =
multiplier`), while `database.js:2441` uses `matchedGeofence = geo.matchedFences[0]` — i.e. the
price uses *max-across-all-matches* but the *reported/displayed* fence is *the first one in an
ordered list*. With 447 mostly-duplicate ACTIVE boundaries, "first" is an ordering question.
Whether that ordering is deterministic (does the hydrator sort?) was not established before
context ran out.

Per §12 this is stated plainly rather than silently patched: **if no precedence rule exists, that
is an architectural blocker, and inventing one (or "fixing" it by adding `ORDER BY`) is not in
scope for an investigation task.**

## 6. Financial-safety position

The engine already refuses rather than inventing a price: `STORE_UNAVAILABLE` yields a typed 503
refusal (`database.js:2477-2482`) and invalid coordinates a typed 400 — the directive's "never
calculate `base * undefined`, never persist NaN, never fall back to 1x/first-zone" is the existing
intent. No fallback pricing was added, and no product code was modified in this pass, so no
regression test is claimed as passing.

## 7. Verified-preserved state

No OP-1 file was touched (`032_operator_permissions_store.sql`,
`operator_permissions_migration_test.js`, `adminPermissions.js`). OP-1's own verification was
**not re-run in this pass**, so it is reported as *previously verified and untouched*, not as
freshly verified. Same for geo ×5, restart 40/40 and the chain — all carry over from the prior
task's measurements and are **not** re-asserted here.

## 8. Concrete next actions, in order

1. Read one `/api/admin/geofences` response and cross-check against `geo_fences.zone_name` to
   settle whether `f.name` exists as a mapped field → only then touch `sweepGeoAdv`.
2. Establish FK relationship + deletion order for `geo_fences` ↔ `surge_zones`; determine which
   suites own the 188 / 185 groups (repo search for the two names).
3. Re-run the NaN trace correctly: hydrated store, real field names, then a booking with
   `jobs.fare_subtotal` / `jobs.surge_amount` read back directly, asserting `Number.isFinite`.
4. Determine whether fence-match ordering is deterministic; if not, report the precedence gap as a
   blocker rather than patching it.
5. Only after the above: regression test, geo ×5, chain.

## 9. Files

Created (read-only probes, gitignored scratch): `geo_state.js`, `geo_state2.js`, `op1_bootcost.js`,
`geo_nan_trace.js`, this report. **No product or test file was modified in this pass.**
