# NABIN OWNER SECURITY DECISIONS

**Status of this file: eleven decisions have been recorded by the owner. Decision 11 (hydration-read
outage semantics, choice B) is recorded as an accepted *no-change* semantics; nothing else in this file
has been implemented.**

Every decision below carries `STATUS: OWNER DECIDED`, the choice, the owner's rationale in the owner's
own words, and the date it was given: **2026-09-24**. A recorded choice decides *what* to build; it does
not build it. No source file, schema, migration, database row, route, policy or test has been changed on
the strength of any entry here, and no entry authorises a change until an implementation order names it.

Rules this file is written under:

- The options below are **listed in the order the owner's instruction gave them**. No option is
  ranked, scored, described as best / recommended / preferred / optimal / strongest, or marked as the
  default. Where two documents letter the same choice differently, that section says so.
- Recording a choice here is a **decision**, not an instruction to implement. Implementation,
  migration application, row deletion, schema change, deployment and push each require their own
  separate order.
- Evidence for every claim quoted here lives in `docs/GEO_SECURITY_DECISION_GATE.md` (the authoritative
  investigation record) and, for the unbounded-read counts, `docs/POSTGREST_MAX_ROWS_AUDIT.md`.
  This file restates as little as possible; read the gate section before choosing.
- As of the decision date: `HEAD` = `a02971e`, `origin/main` = `0bd03ce`, one local commit ahead and
  **not pushed**. The ten choices were recorded on 2026-09-24 with **no** migration applied, no row
  deleted, no source file modified and no hosted environment contacted.

---

## Decision 1 — Anonymous Geo Data

STATUS: OWNER DECIDED
OWNER CHOICE: **A — Revoke anonymous access; service-role-only backend architecture.**
RATIONALE: Geo-fence geometry and related geographic pricing data should not be directly readable
through the anonymous Supabase API. The audit confirmed anonymous access to `geo_fences` and related
tables and found no legitimate client-side dependency requiring direct anonymous reads.
DATE: 2026-09-24

**Options on offer**

- **A** — Revoke anon access; service-role-only backend architecture. ← **CHOSEN**
- **B** — Authenticated RLS access.
- **C** — Public / minimal view.
- **D** — Column-level grant architecture.
- **E** — Keep current access.

**Evidence pointers** — gate `## Decision 1` (`docs/GEO_SECURITY_DECISION_GATE.md:43` onward):
no known client dependency on direct Supabase anon reads (`createClient` appears only under
`backend/`); 11 tables expose rows through `anon`/`authenticated` grants; `geo_fences` exposes 31 of
40 columns; `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql` §2 carries the
service-role-only restrictions; no application break was identified because there is no known client
consumer. Option D rests on behaviour that has **not** been tested in this repository.

**Second question in the same area — must be answered separately.**

`POST /api/geofence/evaluate` — should it remain public?

STATUS: OWNER DECIDED
SHOULD /api/geofence/evaluate REMAIN PUBLIC?: **NO — 4 — Split a public serviceability endpoint from
privileged geo evaluation.**
RATIONALE: The endpoint should not remain a completely public/tokenless pricing and geometry oracle.
Customer/driver application flows may require authorized evaluation, while administrative evaluation can
remain separately authorized. Preserve the application capability without exposing unrestricted
anonymous geographic probing.
DATE: 2026-09-24

- **1** — Public.
- **2** — Require an authenticated customer/driver session.
- **3** — Admin-only.
- **4** — Split a public serviceability endpoint from privileged geo evaluation. ← **CHOSEN**
- **5** — Other, explicitly specified.

**Letter map:** the gate records the same five choices at `## Decision 2` (`:227`) as A–E, where
A = "leave it anonymous, add a throttle" (this checklist's 1 is "public" and does **not** carry the
throttle), and the gate's E = an issued-token budget, which this checklist's 5 would have to specify.

---

## Decision 2 — Geo Cache Invalidation

STATUS: OWNER DECIDED
OWNER CHOICE: **B — Short-TTL cache.**
STALE WINDOW: **30 seconds**
CRITICAL OPERATIONS THAT MUST NOT USE STALE GEO POLICY:
- fare calculation
- booking creation
- driver assignment
- cancellation/refund calculations

RATIONALE: A short TTL provides a simple and low-cost way to limit cross-instance stale geography
without introducing Redis or database-event infrastructure. Critical pricing/booking operations must not
silently rely on unacceptable stale state.
DATE: 2026-09-24

**Options on offer**

- **A** — Remove the application geo cache; read authoritative DB state per decision.
- **B** — Short-TTL cache. ← **CHOSEN**
- **C** — Database / event-driven invalidation.
- **D** — Redis / pub-sub invalidation.
- **E** — Restart-based invalidation as explicit policy.
- **F** — Other, explicitly specified architecture.

**Evidence pointers** — gate `## Decision 3` (`:394`): two independent instances can and do disagree
on geographic pricing for the same coordinates — ₹330 against ₹984, roughly 2.7× apart, observed in
**both** directions across create / update / deactivate / delete / reactivate, with no refresh for
~35 seconds of polling. The cache is hydrated at boot and after a **local** write only; there is
currently no TTL, no periodic tick and no publisher/subscriber anywhere in the path.

**Letter map:** the gate letters this set A–F too, but **E and F are swapped relative to this
checklist** — in the gate, E = a periodic refresh tick and F = the restart contract. If the owner
chooses "E", state in RATIONALE whether the restart policy or the periodic tick is meant.

**Two fields the owner must fill for this decision to be actionable.** The stale window and the list
of critical operations are inputs, not outcomes: without them no option below can be built to a
bound.

Chosen on 2026-09-24, and still not implemented — the 30-second bound above is now an input to whatever
order builds the TTL, not a change this file made.

---

## Decision 3 — Historical Geo Fixtures

STATUS: OWNER DECIDED
OWNER CHOICE: **C — Delete fences and the surge rules orphaned by that deletion.**
PERMISSION TO REMOVE ORPHANED `surge_zones` ROWS: **YES**
RATIONALE: The audit identified substantial historical/test residue compared with the small number of
real production fences. Cleanup should remove confirmed test residue together with orphaned surge rules,
but implementation must first verify which rows are genuinely historical/test data.
DATE: 2026-09-24

**Options on offer**

- **A** — Preserve historical rows.
- **B** — Delete the identified historical fence rows.
- **C** — Delete fences and the surge rules orphaned by that deletion. ← **CHOSEN**
- **D** — Archive them.
- **E** — Other, explicitly specified.

**Evidence pointers** — gate `## Decision 4` (`:570`): 444 historical residue fences against 3 real
fences; **all 445** `surge_zones` rows currently carry fixture-name contamination, so a
name-based purge empties the rules table along with the residue; `zone_id` is a soft relationship and
**no foreign key protects it**, so deleting fences can silently orphan surge rules; no
fence/order/checkout references were found; the audit trail holds 1,494 geo rows and **none** of them
names a leaked shape; nothing has been deleted.

**Why the second field exists.** Options B and C are not the same act. Because there is no foreign
key, B leaves surge rules pointing at rows that no longer exist — and those rules are live pricing
inputs. Choosing B or C requires the explicit YES above, naming the orphaned `surge_zones` rows,
before any deletion is ordered. Deletion is DML, so **no migration is required** — which also means
there is no schema-level undo; the gate records a `pg_dump` of the two tables as the rollback step.

**Deletion has not been executed by any choice recorded here.** Recording C authorises planning the
removal, not the removal; the verification clause in the RATIONALE — which rows are genuinely
historical/test data — has to be satisfied before any row is touched, because all 445 `surge_zones` rows
carry a fixture name and a name-based sweep cannot tell residue rules from real ones.

---

## Decision 4 — Admin Phone Resolution

STATUS: OWNER DECIDED
OWNER CHOICE: **A — Add a normalized, indexed phone column.**
UNIQUE PHONE: **YES** — a unique normalized phone is to be required.
RATIONALE: Admin identity resolution should use a normalized indexed representation instead of scanning
the entire `admin_accounts` table and loading unnecessary credential columns into application memory. A
unique normalized phone prevents ambiguous administrator identity.
DATE: 2026-09-24

**Options on offer**

- **A** — Add a normalized, indexed phone column. ← **CHOSEN**
- **B** — Keyset pagination.
- **C** — Database-side normalized lookup.
- **D** — Other, explicitly specified.

**Evidence pointers** — gate `## Decision 5` (`:763`): `resolveAdminByPhone`
(`backend/src/database.js:5279-5334`) reads `admin_accounts`, normalizes the phone number in
JavaScript, filters in application memory, then raises `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` when more
than one row matches; 428 rows today; **no index and no constraint on `phone`** and no normalized
column; the `select('*')` brings `password_hash` and `salt` into process memory on the
authentication path (the value returned to callers is projected, so the exposure is in-process); past
1,000 rows a truncated read can make the ambiguity check pass on a set that is not the whole table.

**Letter map:** the gate's own set at that section is A normalized+indexed / B keyset walk / C an
existing indexed approach / D fix the read wrapper / E a UNIQUE constraint on the normalized form.
This checklist's C ("database-side normalized lookup") is closest to the gate's C, and the
`UNIQUE PHONE` question above corresponds to the gate's E — which is currently **blocked on duplicate
cleanup**: a uniqueness rule cannot be added while more than one row shares a normalized number. The
owner's YES does not clear that precondition; it makes satisfying it part of the work, and the duplicate
inventory is a read, not a deletion — no row may be merged, renamed or removed under this decision, which
says nothing about them.

No schema is altered, and no index is created, by anything in this file.

---

## Decision 5 — Support Tickets

STATUS: OWNER DECIDED
OWNER CHOICE: **A — Add proper pagination and update the consumers.**
RATIONALE: Support tickets are growing data. Consumers that need complete sets should use explicit
pagination rather than relying on unbounded PostgREST reads.
DATE: 2026-09-24

**Options on offer**

- **A** — Add proper pagination and update the consumers. ← **CHOSEN**
- **B** — Keep complete-set semantics, implemented as a safe keyset retrieval.
- **C** — An explicit bounded maximum with documented behaviour.
- **D** — Other, explicitly specified.

**Evidence pointers** — gate `## Decision 6` (`:954`): `getTicketsAdmin()`
(`backend/src/repositories/SupportTicketRepository.js:441`) performs an unbounded read with no limit,
range or count; 763 rows observed, which is 76% of the store's 1,000-row cap; the route reports
`total: tickets.length`, so a truncated page reports a smaller total rather than an incomplete one;
three consumers depend on the set being complete today — the status badge, the "Ticket not found"
answer, and a category filter applied in JavaScript after retrieval, with the default filter `ALL`.

**Scope note.** The gate's Decision 6 also covers promotion reads. Its recorded finding there is that
promotions are already capped in SQL and no consumer needs the complete set — the owner's instruction
for this checklist asks nothing about promotions, so this file does not pose a decision about them.

No code is modified to record any choice.

---

## Decision 6 — Audit Log Outage

STATUS: OWNER DECIDED
OWNER CHOICE: **B — Allow a stale mirror with an explicit degraded/stale marker.**
ADMIN UI: **YES** (owner's field: `ADMIN UI REQUIREMENT: YES`)
COMPLIANCE: **YES** (owner's field: `COMPLIANCE INVESTIGATION REQUIRED: YES`)
SECURITY INVESTIGATION: **YES** (owner's field: `SECURITY INVESTIGATION REQUIRED: YES`)
RATIONALE: The audit mirror must not present a bounded 200-row snapshot as a complete live audit log.
The UI should explicitly communicate stale/incomplete state while preserving the authoritative audit
write path.
DATE: 2026-09-24

**Options on offer**

- **A** — Fail closed.
- **B** — Allow a stale mirror with an explicit degraded/stale marker. ← **CHOSEN**
- **C** — Bounded fallback.
- **D** — Honest empty result during an outage.
- **E** — Required mirror hydration before use.
- **F** — Other, explicitly specified.

**Evidence pointers** — gate `## Decision 7` (`:1210`): `AuditLogRepository.create` throws on a
failed store write and only then inserts into the in-process mirror, so the mirror can hold records the
authoritative store rejected; 20 audit writes are not awaited; during a live outage one read route
answers a bare 500 while the other carries a distinct error code that the first route does not use;
when the store is not live at all the mirror is served as if complete, with `total` equal to the
mirrored length and **no `dataSource` or degraded marker**; the mirror is hydrated once with
`.limit(200)` against roughly 28,780 audit rows; the admin UI neither displays nor acts on `total`, and
sits under copy that describes an immutable record of all compliance decisions.

**The three usage questions are separate from the behaviour choice.** An option can be chosen that
permits the mirror for the admin UI while refusing it for compliance decisions; all four fields above
have to be answered for the choice to be implementable.

**Letter map:** the gate's set at that section is A–F where F is "reduce the UI's claims to what is
actually held". This checklist's F means "other, specified". State which is meant if F is chosen.

---

## Decision 7 — authoritativeRead

STATUS: OWNER DECIDED
OWNER CHOICE: **C — Inventory first, implementation later.**
RATIONALE: The audit confirmed that `authoritativeRead` currently checks errors but not result
completeness. First inventory every SET call site and determine which require complete-set semantics
before changing behavior globally.
DATE: 2026-09-24

**Options on offer**

- **A** — Fix all SET-style call sites now.
- **B** — Fix only the call sites where sensitivity has been demonstrated.
- **C** — Inventory first, implementation later. ← **CHOSEN**
- **D** — Other, explicitly specified.

**Evidence pointers** — gate `## Phase 9` (`:1487`): `authoritativeRead` / `settleAuthoritative`
(`backend/src/database.js:5213`, `:5228`, `:5236`) convert a store failure into a 503 but **never
inspect the length of what came back**, so a PostgREST-truncated result looks exactly like a complete
one; 14 call sites were classified one-row-versus-set, and **4 are set-shaped**. The verdicts recorded
there are: mechanism **CONFIRMED** at those 4 sites; **POTENTIAL** for the two whose tables are still
below the cap (428 `admin_accounts` rows today); **NOT MEASURED HERE** for the pair on a 1,530+ row
table; **NOT PROVEN** that any user-visible misbehaviour has occurred; and **NOT FIXED**.

Nothing is implemented for any choice recorded here.

---

## Decision 8 — Migration 028

STATUS: OWNER DECIDED
OWNER CHOICE: **B — Renumber the migration after checking the repository migration sequence.**
RATIONALE: Migration numbering must remain unique and ordered. Resolve the 028 collision before any
migration is considered for application.
DATE: 2026-09-24

**Options on offer**

- **A** — Keep migration number 028 and resolve the documentation collision.
- **B** — Renumber the migration after checking the repository migration sequence. ← **CHOSEN**
- **C** — Split it into separate migrations.
- **D** — Other, explicitly specified.

**Evidence pointers** — gate `## Phase 10` (`:1604`): Section A — the service-role-only restrictions
on the geographic and commerce reads — is recorded statement by statement as **safe to apply after
approval**; Section B is recorded as **DO NOT APPLY YET**, and the gate notes it is prose rather than
executable SQL, so as written it cannot be applied at all. Separately, the identifier **028 is already
reserved and declined** by `docs/ADMIN_FEATURE_SPECIFICATION.md` §9 item 1, so the filename collides
with a documented reservation. The file is unapplied and unmodified: it still sits under
`docs/proposed/`, which the runner at `backend/scripts/migrate.js:25` cannot reach, because that
runner only reads `supabase/migrations/` (or `$MIGRATIONS_DIR`).

**Two facts worth holding while choosing.** The migration is a file path, not a database state —
nothing has been applied to any environment. And choosing a number here settles only the identifier;
it does not authorise applying the SQL it labels.

The migration file is not modified, renamed or applied by this task.

---

## Decision 9 — Unbounded Reads

STATUS: OWNER DECIDED
OWNER CHOICE: **A — Every complete-set read must explicitly handle `max_rows`.**
RATIONALE: Any read whose consumer requires the complete dataset must use an explicit complete-set
strategy such as keyset pagination or another bounded, verifiably complete mechanism. Do not globally
replace reads that intentionally use bounded windows.
DATE: 2026-09-24

**Options on offer**

- **A** — Every complete-set read must explicitly handle `max_rows`. ← **CHOSEN**
- **B** — Every potentially large read must be paginated.
- **C** — Only security/authorization-sensitive reads must be complete-set safe.
- **D** — Case-by-case review.
- **E** — Other, explicitly specified.

**Evidence pointers** — `docs/POSTGREST_MAX_ROWS_AUDIT.md` §1: a machine scan of `backend/src` found
167 `.from(…)` chains and 122 reads, of which 49 are unbounded and 9 read whole tables; 7 complete-set
reads were fixed, and 8 reads were deliberately recorded as **CAP-SENSITIVE and left alone** with their
headroom measured rather than changed (`supabase/config.toml` `[api] max_rows = 1000`). The earlier
instruction that "not every query should be blindly paginated" is what that last group is: the counts
say a blanket rule and a case-by-case rule were both already being applied, informally, one read at a
time.

This decision asks whether that informality becomes a written rule. It does not ask which of the 8
remaining reads to change.

No policy is implemented for any choice recorded here.

---

## Decision 10 — RX/INP

STATUS: OWNER DECIDED
OWNER CHOICE: **C — Define a dedicated deterministic reproduction requirement first.**
INVESTIGATION CHOICE: continue investigating, but only after a deterministic reproduction and
measurement methodology exists.
STATUS (recorded, not for the owner to overwrite): INTERMITTENT / UNRESOLVED — CAUSE NOT PROVEN
RATIONALE: The previous audit did not establish causality between the max_rows fix and RX/INP behavior.
Do not claim a fix until a deterministic reproduction and measurement methodology exists.
DATE: 2026-09-24

**Options on offer**

- **A** — Continue a dedicated investigation.
- **B** — Temporarily defer the investigation.
- **C** — Define a dedicated deterministic reproduction requirement first. ← **CHOSEN**
- **D** — Other, explicitly specified.

**Evidence pointers** — gate Decision 3 and `docs/GEOFENCING_SECURITY_AUDIT.md` §"RX/INP after the
row-cap fix": `RX-01…03` / `INP-21/22` passed three verified-fresh-process runs after the row-cap fix,
**and** they had already passed in earlier runs made before the fix. The tally across controlled passes
is four green and one red against a mechanism that no longer exists in the code, and the probe that
tested the mechanism adopted 24 of 24 rows inside the page the cap allowed. So CAUSE = **NOT PROVEN**
and STATUS = **INTERMITTENT / UNRESOLVED**.

This entry must not be written up, reported or read as fixed. Choosing A, B, C or D changes only what
investigation happens next.

---

## Decision 11 — Money / Identity Hydration-Read Outage Semantics

STATUS: OWNER DECIDED
OWNER CHOICE: **B — Money/identity hydration reads may continue using hydrated memory when
PostgreSQL is unavailable.**
RATIONALE (owner's own words, 2026-09-24): the owner was shown that the six repository read paths
below carry an `if (!error && data)` shape, but are the *opposite* failure mode from the checkout
resolvers fixed in the outage sweep — they are deliberate read-through caches that answer from
hydrated memory when the store cannot reply (fail-OPEN), not fail-closed-with-a-bad-code. The owner
was asked to choose A (fail closed with 503, matching the Phase 4 OTP/admin-login stance) or B
(preserve the existing cache fallback) and chose **B**. This is a deliberate, narrowly-scoped
carve-out from the general fail-closed policy above, made knowing that policy exists; it applies only
to these read paths and to the outage case. It does not authorize any behavior change — under B the
existing fallback is *preserved as is*.
DATE: 2026-09-24

**Options on offer**

- **A** — Money/identity hydration reads fail closed with 503 when PostgreSQL is unavailable.
- **B** — Money/identity hydration reads may continue using hydrated memory when PostgreSQL is
  unavailable. ← **CHOSEN**

**Sites this decision names (behavior preserved, not changed):**
`PaymentRepository.getPaymentSession`, `UserRepository.getByPhone`, `UserRepository.findByPhoneAsync`,
`DriverRepository` cache-first reads, `JobRepository` read-through, `DispatchRepository`
`getOffersForDriver`/`getActiveAssignmentForDriver` read-through paths. A genuine not-found must still
return `null`/empty; an unreachable store must not turn a cached row into a false 503, and must not be
treated as a business error either — it answers from the hydrated copy.
(Note: the initial framing listed `SupportTicketRepository` too, but on inspection its
`if (!error && data)` line is a **create/write**, not a read-through cache, so it is outside this
read-semantics decision and was left untouched. This is a factual correction to the site list, not a
change to the owner's A/B choice.)

**Guard against accidental reversal:** these fallbacks are now the *accepted* semantics under this
decision, not a bug to re-sweep. In-code comments at the sites and `backend/hydration_fallback_test.js`
lock the choice in; neither may be removed without a new owner order.

---

## General owner policy, recorded with these decisions

The owner gave this alongside the original ten choices. It is not itself one of the numbered
decisions and does not add to them; it is the frame those choices were made inside. (Decision 11 above
is a separate, later choice and is numbered on its own.)

- Security-sensitive operations should fail closed where incomplete authoritative data could affect
  pricing, authorization, booking, or financial correctness.
- Prefer simple infrastructure before adding Redis or event-driven infrastructure.
- Never expose secrets.
- Never weaken tests.
- Never make production changes without explicit owner authorization.

---

## What recording a choice here does not do

A field filled in above is a decision, expressed in words. It is not, by itself:

- a code change, or authority to make one;
- a schema change, an index, a constraint, or a grant;
- a migration being written, renamed, applied or rolled back;
- a row being deleted, archived or purged;
- a test being weakened, rewritten or deleted;
- a push, a deploy, or any action against the hosted test or production projects.

Each of those needs its own order, and — for anything touching the hosted environments or the
database's persisted state — the evidence the owner relied on should be re-checked against the state at
that moment, because the counts quoted above are dated.

*Eleven decisions, recorded on 2026-09-24, with every options list and every evidence pointer still in
place. Decisions 1–10 have not been built: at the time of writing no migration exists outside
`docs/proposed/` and no row has been deleted on their account. Decision 11 is the exception in kind —
it is an accepted *no-change* semantics (choice B), so "implemented" for it means the existing fallback
is preserved and locked in by a test, not that any behavior was altered.*
