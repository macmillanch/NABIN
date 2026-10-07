# NABIN — OWNER SECURITY CLARIFICATIONS

**Purpose: to present ONLY the newly discovered contradictions, and to ask the owner to resolve them
explicitly.**

> **These clarifications were created because Phase 0 measurement found facts that were not represented
> accurately in the earlier decision documents. They do not replace the original owner decisions except
> where the owner explicitly clarifies them below.**

The five main `OWNER CHOICE` fields below were filled in by the owner on **2026-09-24** and now read
`STATUS: OWNER DECIDED`. Conditional sub-fields attached to an option the owner did **not** select are
marked `NOT APPLICABLE`; a sub-field that belongs to the selected branch and that the owner left unstated
is marked `OPEN` rather than filled in. A blank is still not a decision: nothing here is inferred on the
owner's behalf, and an `OPEN` field must not be read as agreement with whichever option is listed first.

Rules this file is written under:

- No option is ranked, scored, described as best / recommended / preferred / optimal / strongest, or
  marked as a default. Consequences are stated technically and symmetrically.
- Nothing is inferred on the owner's behalf. Where the earlier evidence was wrong, this file says what was
  measured instead of what the evidence claimed, and leaves the interpretation open.
- A filled-in field is a **decision expressed in words**. Implementation, migration writing, migration
  application, row deletion, schema change, source change, test change, commit, push and deployment each
  require their own separate order.
- **This document authorized nothing.** No source file, test, schema object, migration, row, configuration
  value, hosted environment or commit was touched while producing it. `docs` was the only writable target.
- Counts are dated. They describe the **local Docker** database as measured on 2026-09-24. The hosted test
  and production databases were never contacted, and their counts are unknown — none of these questions can
  be answered from this file for those environments.
- The authoritative record of the earlier ten decisions is `docs/OWNER_SECURITY_DECISIONS.md`. The
  measurements quoted here are in `docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` §3 (baseline) and the
  phases that cite them. Where this file quotes a line number, it was re-read from the working tree at
  `HEAD` = `a02971e`.

| # | Clarification | Original decision it questions | Status of that decision |
| --- | --- | --- | --- |
| 1 | Historical geo cleanup and what cascades with it | Decision 3 — choice C | unchanged, but its evidence field is factually wrong |
| 2 | Admin phone duplicates | Decision 4 — `UNIQUE PHONE: YES` | unchanged, but not implementable as stated today |
| 3 | What the audit mirror must mean for compliance | Decision 6 — choice B + three `YES` fields | unchanged, but two of the three fields have no consumer |
| 4 | Geo-cache critical operations that never consult geo | Decision 2 — choice B + the four named operations | unchanged, but three of the four names do not fit the code |
| 5 | The remaining anonymous pricing door | Decision 1's second question — choice 4 | unchanged, but the invariant it was meant to satisfy is not satisfied |

---

## Clarification 1 — Historical geo cleanup, and what the cascade actually deletes

### Measured evidence

1. **`surge_zones.zone_id` is foreign-key protected and cascades.** The constraint is
   `surge_zones_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES geo_fences(id) ON DELETE CASCADE`, created at
   `supabase/migrations/011:56`.
2. `docs/OWNER_SECURITY_DECISIONS.md` Decision 3 states the opposite — "*`zone_id` is a soft relationship
   and **no foreign key protects it**, so deleting fences can silently orphan surge rules*" — and
   `docs/GEO_SECURITY_DECISION_GATE.md` `## Decision 4` carries the same claim. Both are contradicted by
   the live schema.
3. `geo_fences` holds 447 rows at rest: **444** fixture/historical rows across three name families
   (`Noida IT Sector 62 Boundary` 188, `South Delhi Hospital Corridor` 185, `Restart Test Aero City Zone`
   71) and **3** legitimate boundaries. The keep-list, by primary key, is recorded in
   `docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` Phase 4 §3:

   | `id` | `zone_code` | `zone_name` |
   | --- | --- | --- |
   | `102660fc-c653-4478-98b0-0399a97a87d7` | `ZONE_AIRPORT_IGI_T3` | IGI Airport Terminal 3 Zone |
   | `26a87122-8db1-48bb-88ee-4bc34b2d378d` | `ZONE_CBD_CONNAUGHT_PLACE` | Connaught Place CBD Boundary |
   | `55f80472-b2d7-4153-9b48-542186455f56` | `ZONE_TECH_CYBERCITY_DLF` | Cyber City DLF Phase 2 Corridor |

4. `surge_zones` holds 445 rows, linked as measured:

   | Linkage | Rows | Effect of deleting the 444 fences |
   | --- | --- | --- |
   | pointing at a fixture/historical fence | **256** | **deleted by cascade** |
   | pointing at `ZONE_AIRPORT_IGI_T3` (a keep-list fence) | **179** | **survive** |
   | `zone_id IS NULL` | **10** | survive |
   | pointing at a fence that does not exist | **0** | none — the FK forbids the state |

   Totals move from 447 fences / 445 rules to **3 fences / 189 rules**.
5. The 179 surviving rules on the airport fence were inspected: all 179 carry the **same**
   `surge_multiplier` of 1.50, the **same** zone name, status ACTIVE, priority HIGH, and were created one
   per run across the same 2026-09-05 … 2026-09-23 window as the fixture fences. They are 179 rows of what
   reads as one rule. **This document does not state whether they are legitimate, erroneous, or
   residue-like — that judgement is the owner's, and it is the substance of the question below.**
6. The 444 fences are not inert history: all 444 are `is_active = TRUE` with `surge_multiplier > 1` **and**
   `surcharge_amount > 0`, and between them they hold only **3 distinct geometries**. 188 of them carry no
   surge rule.
7. No other table references a fence: a column survey of the schema found no `zone_id`, `fence_id`,
   `surge_zone_id` or `zone_code` column outside `surge_zones`, and no fence/order/checkout reference was
   found.
8. Two mechanical facts that bear on any choice: deletion is **DML**, so no migration is involved and there
   is **no schema-level undo**; and a name- or author-based selector is not durable — the fixture rows'
   `zone_code` values follow at least six different shapes (measured: a regex set covering four families
   under-counted by 56 rows), and `created_by = 'System Administrator'` is an identity the backend writes,
   not a property of fixture data.

### Why a clarification is needed

Decision 3 chose **C — delete fences and the surge rules orphaned by that deletion**, with
`PERMISSION TO REMOVE ORPHANED surge_zones ROWS: YES`. Both halves of that sentence assume orphans will be
created by the deletion. The measured cascade means **no orphan is ever created**, and the rules the
permission was written to cover (256) are removed by the fence deletion itself. Separately, 179 rules that
*are* residue-shaped are **not** covered by any word of the chosen option, because they are attached to a
fence that is being kept. So the decision as recorded does not describe the act it would authorize, and it
does not reach the rows that are now the largest single question in the table.

### Owner choices

- **A** — Delete only the confirmed historical/test fences and accept the 256 cascade deletions; preserve
  all remaining 189 rules.
- **B** — Delete confirmed historical/test fences **and** explicitly identify/remediate the remaining 189
  rules as part of the cleanup.
- **C** — Preserve the historical/test fences for now and perform a separate data-cleanup investigation.
- **D** — Other: ______________________________________________

### Owner fields

```
STATUS: OWNER DECIDED (2026-09-24)
OWNER CHOICE: C — Preserve the historical/test fences for now and perform a separate data-cleanup investigation.
IF B — whether the 10 `zone_id IS NULL` rules are inside "the remaining 189": NOT APPLICABLE (option B was not chosen)
IF B — the remediation intended for the 179 (delete / keep one row per distinct rule / archive / other): NOT APPLICABLE (option B was not chosen)
IF C — what the separate investigation must cover and what would end it: OPEN — the owner selected C and gave its rationale, and did not state the investigation's scope or its ending condition. Not to be inferred; it must be asked before any cleanup is planned.
RATIONALE: The baseline found that deleting the 444 identified historical/test fences would cascade-delete 256 surge-zone rules, while 189 rules would remain, including 179 duplicate ACTIVE rules attached to ZONE_AIRPORT_IGI_T3. The legitimacy of those remaining rules has not been established. Do not perform irreversible cleanup until the remaining data is explicitly classified.
DATE: 2026-09-24
```

**What this records, stated plainly so it is not misread later:** `docs/OWNER_SECURITY_DECISIONS.md`
Decision 3 is **not** amended or deleted by this field, and its `PERMISSION TO REMOVE ORPHANED surge_zones
ROWS: YES` stands as written. What choice C does is **defer the act**: no fence is deleted, and therefore no
cascade fires, until the remaining 189 rules have been explicitly classified. The deferral is the owner's
instruction, and it is the operative fact for any later phase that touches this data.

**Not decided here, and deliberately not answered by this file:** whether the 179 duplicate ACTIVE rows are
legitimate geography, test contamination, or something between the two; whether the 444 fences should be
deleted before or after the anonymous-read lock; whether any purge should be an operator SQL script or a
supported admin route. Each is a further order.

---

## Clarification 2 — Admin phone duplicates, and what `UNIQUE PHONE: YES` can attach to

### Measured evidence

1. 50 rows in `admin_accounts` currently hold the **same** phone value, `+91 98112 33445` — which
   `normalizePhone` (`backend/src/database.js:5194-5200`) folds to `+919811233445`. All 50 have
   `is_active = true`, and all were created 2026-09-22 … 2026-09-23.
2. The table holds 430 rows. Of those, **380 have `phone` NULL or blank**. Roles: OPERATIONS 142 (50
   active), KYC_SPECIALIST 107 (50 active), SUPPORT_AGENT 90 (0 active), FINANCE_AUDITOR 90 (0 active),
   SUPER_ADMIN 1.
3. `admin_accounts.phone` is `VARCHAR(20)`, nullable, with **no index, no UNIQUE, no CHECK**
   (`supabase/migrations/001:172-188`), and the table has **no index of any kind**. The existing constraints
   are on `username` and `email`.
4. The read that depends on it, `resolveAdminByPhone` (`database.js:5279-5334`), issues
   `select('*')` over the whole table, filters in JavaScript, and refuses with
   `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` when more than one row matches (`:5287-5291`). That refusal carries no
   HTTP status, so `server.js:1030-1040` renders it as **400**. The read also pulls `password_hash` and
   `password_salt` into process memory on an authentication path.
5. **The ambiguity is live, not hypothetical.** With 50 rows on one number, any administrator login by
   phone against that number is refused today. The mechanism the earlier documents described as a possible
   future condition ("past 1,000 rows a truncated read can make the ambiguity check pass on a set that is
   not the whole table") is present at 430 rows in a different form: the check trips on real data now.
6. A UNIQUE rule cannot be created while more than one row shares a normalized value. The natural form
   available in this repository's house style is a **partial** unique index
   (`CREATE UNIQUE INDEX … WHERE phone_normalized IS NOT NULL`) — precedent at `012:74` and `016:73-75`,
   which is also what would let the 380 NULL-phone rows coexist with the rule. `GENERATED ALWAYS AS` and
   expression indexes appear **nowhere** in this repository's migrations, so a stored generated column
   would be new vocabulary.

### Why a clarification is needed

Decision 4 chose **A — a normalized, indexed phone column** and `UNIQUE PHONE: YES`. The first half is
buildable. The second half is **blocked by the data it is meant to constrain**: it cannot be applied to
these 430 rows without first resolving the 50, and resolving the 50 means deciding, per account, whether it
should exist, what its number should be, and what happens to the identity it holds. That is a decision
about accounts, not about a column, and the ten decisions did not contain it.

### Owner choices

- **A** — The owner will provide/approve an account-by-account remediation list before the uniqueness
  migration.
- **B** — Keep uniqueness as a future requirement but defer the migration until an operational remediation
  process exists.
- **C** — Other: ______________________________________________

### Owner fields

```
STATUS: OWNER DECIDED (2026-09-24)
OWNER CHOICE: B — Keep UNIQUE PHONE as a future requirement but defer the uniqueness migration until an operational remediation process exists.
IF A — how the remediation list will be delivered (a report the owner annotates / a list given in words / another way): NOT APPLICABLE (option A was not chosen)
IF A — treatment of the 380 NULL/blank-phone rows under the rule (allow NULL via a partial index / require a value / out of scope): NOT APPLICABLE (option A was not chosen)
IF B — what would constitute "an operational remediation process exists": OPEN — the owner set the condition and did not define it. The uniqueness migration stays unwritten until the owner states what satisfies it.
RATIONALE: There are currently 50 active admin accounts sharing the same phone number. The system already rejects ambiguous phone resolution with HTTP 400. Do not automatically merge, rename, delete, or reassign accounts. Normalization/indexing and safer lookup work may proceed independently, while the uniqueness constraint waits for account-level remediation.
DATE: 2026-09-24
```

**What this records, stated plainly:** `UNIQUE PHONE: YES` from Decision 4 is **kept as a requirement and
deferred in time** — it is not withdrawn, and no later phase may treat its absence as permission to drop
the goal. The owner's rationale separates the two halves of Decision 4: the normalized/indexed column and
the safer lookup read (evidence item 4, which currently pulls `password_hash` and `password_salt` into
memory on an authentication path) may proceed on their own; the constraint waits.

### Explicitly stated limits, at the owner's instruction and re-stated here

**NO automatic merge.** **NO automatic rename.** **NO automatic deletion.** **NO automatic
reassignment.** No account row will be merged, renamed, deleted or reassigned by any tool, script or agent
under any choice recorded above. Any per-account change is performed by a named person, through the
existing audited admin write paths, and is individually reviewable. The 50 rows stay exactly as they are
until the owner says otherwise, account by account.

---

## Clarification 3 — What the audit mirror is required to mean for compliance

### Measured evidence

1. **Consumers found, in full.** The audit list is read by exactly two routes and one UI:
   - R1 `backend/src/server.js:1572` → on store failure a **bare 500** (`:1593-1596`);
   - R2 `server.js:3308` → on store failure a **503 `AUDIT_TRAIL_UNAVAILABLE`** (`:3327-3331`);
   - `admin_dashboard.html` TAB 9 (`:1741-1815`), whose `loadGlobalAuditLogs` (`:3990-4015`) reads
     `data.logs` **only**, has no pagination, one search filter, and an empty `catch (e) {}` at `:4014`;
   - the KYC modal (`:2379-2410`, `:3870-3892`) calls **R1 unfiltered**, so R2's coded error has no
     consumer at all.
2. **No compliance consumer was found. No security-investigation consumer was found.** Not "found but
   gated" — absent: `admin-web` has no audit view, and the Flutter client's audit call
   (`mobile/lib/core/network/nabin_api_service.dart:656`) has zero callers. There is no export, no
   retention job, no report, no second reader of the audit API anywhere in the repository.
3. The mirror is bounded and says so implicitly by silence. Boot hydration reads
   **`.limit(200)` once** against **28,938** `audit_logs` rows (`database.js:1942-1959`); its error is
   swallowed at `:1949`; the incomplete-mirror report at `:2009-2011` **excludes audit**; and the offline
   branch's `total` is `list.length` (`AuditLogRepository.js:185`) while the live branch's `total` is an
   exact count (`:113`/`:156`). There is **no `dataSource`, no `degraded`, no `stale` and no `readAt`
   anywhere in the audit path.** 200 rows out of 28,938 is 0.7%.
4. Four fabricated seed rows sit in the mirror (`database.js:987-1004`) and are never cleared, and the
   dashboard copy at `:1784` describes the view as an "*Immutable, tamper-resistant record of all
   compliance decisions…*".
5. **A separate implementation defect, recorded as such and not offered as a decision.** `mapRowToDTO` is
   declared at module scope in `AuditLogRepository.js:3`; the boot hydration at `database.js:1951` looks it
   up where it is not in scope, so the mapping never runs and the first 200 rows enter the mirror as raw
   snake_case. The observable UI symptom is `Invalid Date` and `'System'`. **This is a code defect. It is
   not an owner decision, it is not a consequence of any choice below, and no option here should be read as
   accepting it.** It is listed because it was found while measuring this question and because it affects
   how much of the mirror's content has ever been correctly rendered.
6. Store ordering: `AuditLogRepository.create` **throws** on a failed store write (`:75-77`) and only then
   inserts into the mirror (`:81-83`), so the mirror can hold records the authoritative store rejected.
   And 20 audit writes are not awaited (`database.js` `:2043, 2647, 2719, 2865, 2995, 3334, 4552, 4656,
   7226, 7247, 7274, 7373, 7663, 7695`; `PaymentRepository.js` `:117, 367, 404, 481, 642→643, 748→749`), so
   a record can be missing from both places at the moment it is read.

### What the owner previously selected, restated without reinterpretation

`Decision 6 — OWNER CHOICE: B — Allow a stale mirror with an explicit degraded/stale marker`;
`ADMIN UI: YES`; `COMPLIANCE: YES`; `SECURITY INVESTIGATION: YES`. **This document does not reinterpret
those four fields and does not propose that any of them be changed.**

### Why a clarification is needed

Choice B is a rule about **presentation** — serve the mirror, label it. The two `YES` answers name **uses**
— compliance and security investigation. The measured repository contains no consumer for either use, so
there is nothing for those answers to govern, and the one thing B does (mark staleness) is neutral about
whether a labelled-partial set is *sufficient* for them. The two readings of the owner's answer produce
different code, and the earlier general policy ("*fail closed where incomplete authoritative data could
affect pricing, authorization, booking, or financial correctness*") points in one direction while B points
in the other. Which is meant is not derivable from the words already recorded.

### Owner must clarify

For compliance and security investigations, does the requirement mean:

- **A** — The audit mirror may be used as a convenience view, but authoritative investigation must use the
  underlying authoritative audit records.
- **B** — The mirror itself must become authoritative/complete enough for those investigations.
- **C** — Other: ______________________________________________

### Owner fields

```
STATUS: OWNER DECIDED (2026-09-24)
OWNER CHOICE: A — The audit mirror is a convenience UI view. Authoritative compliance/security investigation must use the underlying authoritative audit records.
IF A — the surface from which authoritative records are to be read (direct SQL by an operator / an export route / existing R1+R2 with filters / other): OPEN — the owner fixed the meaning of the mirror and did not name the surface. Nothing here selects one on their behalf.
IF B — the completeness bound the mirror must meet, and how it is to be maintained (keyset hydration of all 28,938 / a bounded window with a stated age / other): NOT APPLICABLE (option B was not chosen)
RATIONALE: The investigation found that the current mirror is a bounded/stale UI representation and no separate compliance or security-investigation consumer currently depends on it. The authoritative audit records remain the source of truth for compliance and security investigations. The mirror should clearly identify stale/incomplete state.
OWNER INSTRUCTION (RECORDED, NOT A DECISION): The mapRowToDTO hydration/mapping problem — evidence item 5, `AuditLogRepository.js:3` against `database.js:1951` — remains an implementation defect and must be fixed separately. It is not an owner decision.
DATE: 2026-09-24
```

**What this records, stated plainly:** choice A settles *what the mirror means* — it is a UI convenience, and
the `COMPLIANCE: YES` / `SECURITY INVESTIGATION: YES` fields of Decision 6 now attach to the **authoritative
audit records**, not to the mirror. `Decision 6 — OWNER CHOICE: B — Allow a stale mirror with an explicit
degraded/stale marker` stands unchanged, and A sharpens its last clause: the mirror "should clearly identify
stale/incomplete state," which is the part of B that becomes buildable. Evidence item 3's finding that the
audit path carries **no `dataSource`, no `degraded`, no `stale` and no `readAt` anywhere** is the gap this
instruction points at; the E5–E8 questions below it are still open.

**Also unresolved under either choice, and asked separately rather than assumed away** (each appears in
`docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` as E5–E8): which of the 20 un-awaited writes must become
awaited; whether R1's bare 500 or R2's coded 503 is the contract for both routes; and what happens to the 4
fabricated seed rows. None of those three is a restatement of the question above, and none is decided by an
answer to it.

---

## Clarification 4 — Critical geo operations that do not consult geography

### Measured evidence

The four operations the owner named, measured against the code that would have to honour them:

| Named critical operation | Consults geo policy in the path? | Where it happens, or where it does not |
| --- | --- | --- |
| **Fare calculation** | **Yes** | `POST /api/pricing/estimate` `server.js:3445` → `db.calculateFareEstimate` → `database.js:2400-2416` → `geoPolicy.evaluate` at `:2407` (`operation: 'QUOTE'`) |
| **Booking creation — ride** | **Yes, and it refuses** | `server.js:3411`, coordinates at `:3477`, refusal at `:3486-3487` via `replyGeoRefusal` (`:68-78`) |
| **Booking creation — parcel** | Reaches the engine **with no coordinates** | `server.js:3614`, input built at `:3665-3669` ⇒ `geoStatus: 'NOT_PROVIDED'`, and no refusal (`database.js:2457-2471`) |
| **Booking creation — food** | **No** | `server.js:3756` — no geo call; feature-gated by an `X-Location-Id` header string (`:3770-3771`) |
| **Driver assignment** | **No** | `POST /api/driver/offers/:offerId/accept` `:4313`, `/api/driver/accept-job` `:4369`, arrived `:4481`, complete `:4658` — none calls geo policy |
| **Cancellation / refund calculation** | **No** | `server.js:4832` — uses the stored fare and the `cancel_ride_atomic` RPC (`supabase/migrations/016:262`) |

Two supporting measurements:

1. There are only **two** call sites into `GeoPolicyService.evaluate()` in the whole backend
   (`database.js:2407` and `server.js:2977`), and both read the **in-process copy**, not the database.
2. The vocabulary for "this operation is booking-critical" already exists and is **unused**:
   `BOOKING_CRITICAL` (`GeoPolicyService.js:62-65`) and `isBookingCritical()` (`:438-440`) have no call
   site anywhere in `backend/`. `operation` is only ever `'QUOTE'` or `'PUBLIC_EVALUATE'`.

### Why a clarification is needed

Decision 2 chose **B — short-TTL cache**, `STALE WINDOW: 30 seconds`, and listed four operations that
"*must not use stale geo policy*". The TTL is buildable. But three of the four named operations — driver
assignment, cancellation/refund, and parcel booking's coordinate-less input — **do not consult geography at
all**. A rule that says those operations must not use stale geography is, as written, unsatisfiable: there
is no geography in them to make fresh. Giving them a freshness guarantee would require first giving them
geography (geo-aware dispatch, re-pricing on cancellation, coordinates on parcel booking), and each of
those changes what a driver is assigned or what a customer is charged. Nothing in the ten decisions
ordered any of that, so this file does not treat the omission as an invitation to add it.

### Owner choices

- **A** — Apply the 30-second TTL only to operations that actually consume geo data; document the non-geo
  operations as unaffected.
- **B** — Require future geo-aware versions of those operations to use the same 30-second TTL policy.
- **C** — Other: ______________________________________________

### Owner fields

```
STATUS: OWNER DECIDED (2026-09-24)
OWNER CHOICE: A — Apply the 30-second TTL only to operations that actually consume geo data; document the non-geo operations as unaffected.
IF A — confirmation that "documented as unaffected" is acceptable wording in the audit trail for driver assignment and cancellation/refund: OPEN — the owner chose A and did not answer this confirmation line, so the wording of the audit-trail entry for those two operations is still the owner's to approve.
IF B — whether a written forward rule is enough, or the operations must become geo-aware in this plan: NOT APPLICABLE (option B was not chosen)
IF B — whether parcel booking should start sending coordinates (a customer-facing pricing change): NOT APPLICABLE (option B was not chosen)
RATIONALE: The 30-second stale window is appropriate for geo-dependent pricing/booking behavior, but the baseline confirmed that driver assignment, cancellation/refund, and the relevant parcel path currently do not consume geography. Do not invent geo dependencies where none exist.
DATE: 2026-09-24
```

**What this records, stated plainly:** `STALE WINDOW: 30 seconds` from Decision 2 stands, and its scope is
now narrowed to the operations in the table above that answer **Yes** — fare calculation and ride booking
creation. The three that answer **No** are recorded as *unaffected by the geo cache*, not as compliant with
it. The owner's closing instruction — *do not invent geo dependencies where none exist* — is the governing
rule: no later phase may add a geo call to driver assignment, cancellation/refund, or parcel booking in
order to give the original wording something to apply to.

**Not invented here:** no geo usage has been assumed where none exists. The three rows in the table marked
**No** are reported as **No**, and any change to them is a separate order with its own evidence.

---

## Clarification 5 — The anonymous pricing door that the endpoint split does not close

### Measured evidence

1. `POST /api/geofence/evaluate` (`server.js:2975-3006`) is registered with **no middleware at all**. Its
   response carries `inside`, `matchedZones`, `primaryZone`, `effectiveSurgeMultiplier`, `totalSurcharge`
   and `applicableSurgeRules[].{surgeMultiplier, window}` — i.e. margin numbers, no geometry (geometry
   absence is enforced by `describeFence`, `GeoPolicyService.js:376-387`, and by GEO-D07/SEC-03).
2. Its only callers in the repository are two **anonymous** calls from the admin console
   (`admin_dashboard.html:5307`, `:5367`) and three test files
   (`test_suite.js:507, 517, 527, 537`; `geo_policy_test.js:449, 466, 471, 572`;
   `geo_adversarial_test.js:563, 644`). **Zero** customer, driver or merchant callers exist:
   `mobile/lib/core/network/nabin_api_service.dart` calls `/pricing/estimate` (`:146`), `/admin/geofences`
   (`:896`) and `/admin/surgezones` (`:912`) and never calls evaluate; the four web clients contain no
   match for `geofence`/`evaluate`/`reverse-geocode`.
3. `POST /api/pricing/estimate` (`server.js:3445`) is **also** registered with no middleware, accepts
   `pickupLat`/`pickupLng` from the body, calls the same `db.calculateFareEstimate` →
   `geoPolicy.evaluate` path (`database.js:2400-2416`), and returns the full `estimate` — which is the
   surcharge-inclusive fare a rider would be quoted for coordinates the caller chooses to submit. It is
   reachable from the public internet the same way evaluate is (`vercel.json:5-8`,
   `vercel.prod.json:5-8` proxy `/api/(.*)`).
4. A third anonymous geo-adjacent route exists, `POST /api/geofence/reverse-geocode` (`:3009`); it returns
   a locality string built from hardcoded Delhi branches (`:3032-3059`) and no pricing, and is therefore
   outside this question.
5. There is **no rate-limit or throttle primitive anywhere in the repository** — `backend/package.json` has
   no `express-rate-limit` and no `helmet`; the only in-process limiter is OTP-specific
   (`database.js:5379-5388`, 5 requests / 10 minutes per normalized phone); the only 429-with-retryAfter
   shape is the broadcast cooldown (`server.js:7749-7762`); and `ENABLE_RATE_LIMITING=true` in
   `.env.production.example:32` is read by no code.

### Why a clarification is needed

The owner answered Decision 1's second question with **4 — split a public serviceability endpoint from
privileged geo evaluation**, and `SHOULD /api/geofence/evaluate REMAIN PUBLIC?: NO`. The implementation plan
builds that split. But the invariant the split is meant to serve — "*no unrestricted public geo pricing
oracle after Decision 1b*" — is about **what an anonymous caller can learn**, and one of the two doors that
teach it is `evaluate` while the other is `estimate`. Closing `evaluate` and leaving `estimate` anonymous
removes a door that had no users and keeps a door that the Flutter customer app uses for its real quote
flow. So the invariant cannot be marked satisfied by Clarification-1b's own choice, and the reason is
structural, not a matter of how carefully the split is built.

`estimate` was not on the ten-question checklist, so nothing has been decided about it. This file asks what
should be.

### Owner choices

- **A** — Protect `/api/pricing/estimate` with authenticated customer/driver access.
  - Technical consequence, stated neutrally: the Flutter customer app calls this route
    (`nabin_api_service.dart:146`). Under today's auth model a customer token exists
    (`authenticateUser` `server.js:720-776`, the only session gate that reaches the store), so a gated
    estimate is compatible with the signed-in browse/quote flow. It is **not** compatible with a
    pre-sign-in quote, because `authenticateDriver` (`:808`) and `authenticateMerchant` (`:860`) are
    memory-only gates and an anonymous shopper has no token to present. Any browsing-before-login journey
    that quotes a fare would have to move behind sign-in, or keep a different answer.
- **B** — Keep pricing estimate public but remove enough geographic/surcharge information so it cannot act
  as a pricing/geometry oracle.
  - Technical consequence, stated neutrally: the value of the response *is* a number a customer needs to
    see, so "enough removed" is a question about the minimum a quote must disclose — for example whether a
    total can be shown without its surcharge components, and whether the zone attribution can be dropped.
    This is a product boundary, and the fields it would remove are asserted present-or-absent by existing
    tests (`test_suite.js` Module-7, `geo_policy_test.js`), so the choice determines how much of the current
    payload survives.
- **C** — Keep it public intentionally and explicitly accept the oracle risk.
  - Technical consequence, stated neutrally: an anonymous caller can obtain the surcharge-inclusive fare
    for arbitrary coordinates at unlimited rate, since there is no throttle primitive to add a bound to
    (evidence item 5). The invariant in
    `docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` then remains recorded as NOT SATISFIED by choice rather
    than by omission.
- **D** — Other: ______________________________________________

### Owner fields

```
STATUS: OWNER DECIDED (2026-09-24)
OWNER CHOICE: A — Require authentication for POST /api/pricing/estimate.
IF B — the exact list of fields that may remain in an anonymous estimate: NOT APPLICABLE (option B was not chosen)
IF any choice — whether a throttle is in scope at all, given that none exists in the codebase today: OPEN — this line is not attached to any one option, and the owner did not answer it. Evidence item 5 (no rate-limit or throttle primitive exists anywhere in the repository) is unchanged by choice A.
RATIONALE: The endpoint currently permits anonymous surcharge-inclusive pricing queries. This creates a second public pricing oracle even if /api/geofence/evaluate is protected. Requiring authentication keeps authoritative pricing behind the application's existing authenticated customer/driver model.
OWNER INSTRUCTION (RECORDED, NOT A DECISION): Do not redesign authentication. Use the existing NABIN authentication/session architecture during implementation planning.
DATE: 2026-09-24
```

**What this records, stated plainly:** this is the answer to the question the plan raises as **E2**, and it
unblocks Phase 2's invariant — "*no unrestricted public geo pricing oracle*" — which the `evaluate` split
alone could not satisfy. Decision 1b's choice 4 (the split) and `SHOULD /api/geofence/evaluate REMAIN
PUBLIC?: NO` stand unchanged; A adds the second half. The owner's instruction to use the existing
authentication/session architecture means the gate is built from what is already there — `authenticateUser`
(`server.js:720-776`) is the only session gate that reaches the store, while `authenticateDriver` (`:808`)
and `authenticateMerchant` (`:860`) are memory-only — and the consequence recorded under option A above
still holds and is not softened by this choice: a customer token exists for the signed-in quote flow the
Flutter app uses (`nabin_api_service.dart:146`), and a pre-sign-in quote would not have one to present.

**Related question that this clarification does not answer, and should not be read as answering.**
`docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` E1 records that option 4 decided the *split* but not the
*audience* of the privileged half: the only real consumers are admin-console calls, while customer/driver
sessions are a different gate. If the owner chooses A above, the audience of the evaluation half and the
audience of the estimate route become answerable together; if B or C, E1 still needs its own answer.

---

## What a filled-in field here does not do

A choice written into one of the blocks above is a clarification, expressed in words. It is not, by itself:

- a source change, or authority to make one;
- a schema change, index, constraint, grant or policy;
- a migration being written, renamed, applied or rolled back;
- a row being deleted, cascaded, archived, merged, renamed or reassigned;
- a test being weakened, rewritten or deleted;
- a route being gated, split, opened or closed;
- a push, a deploy, or any action against the hosted test or production projects.

Each of those needs its own order. `docs/SECURITY_DECISIONS_IMPLEMENTATION_PLAN.md` remains a plan; its
phases stay unbuilt, and a clarification above does not promote any of them into work that may begin.

> **NO IMPLEMENTATION AUTHORIZED BY THIS DOCUMENT.**

*Five questions. Each carries the measurement that raised it, the original decision it does not replace,
the choices in the order the owner's instruction gave them, and — recorded 2026-09-24 — the owner's choice,
rationale and date, with five sub-fields left marked `OPEN` because the owner did not answer them.*
