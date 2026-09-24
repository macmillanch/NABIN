# NABIN — Geographic and Commerce Security Decision Gate

Written 2026-09-24 at checkpoint `a02971e` (one commit ahead of `origin/main` at `0bd03ce`).

**This document changes no code, applies no migration, deletes no row, and touches no hosted
environment.** It exists because seven security-relevant findings have reached the point where the
next step is a *choice* rather than a measurement, and each choice has a legitimate owner other
than the agent doing the work: the product owner. Everything below is therefore structured as
options with their costs, not as a plan.

## How to read this document

Every decision follows the same eleven headings: **CURRENT EVIDENCE / SECURITY IMPACT / BUSINESS
IMPACT / OPTIONS / PROS / CONS / MIGRATION REQUIRED / INFRASTRUCTURE REQUIRED / TEST REQUIREMENTS /
ROLLBACK / OPEN QUESTION**.

There is deliberately **no recommendation, no ranking, no score and no "winner"** anywhere in this
file. Where a section calls an option "the smallest change", that is a statement about lines of
code, not about which option to pick. Where an option is described as fixing a mechanism rather
than a consequence, that is a statement about what was measured, not a suggestion.

Verdict vocabulary is the one the previous passes used and must keep being used:

| Word | Means here |
|---|---|
| CONFIRMED | Observed directly, this pass or a recorded earlier one, against the live local stack. |
| REPRODUCED | Observed more than once, with the conditions named. |
| FIXED | A change is in the tree and the check that proved the defect now passes. |
| INTERMITTENT | Observed sometimes; the conditions that decide are not known. |
| NOT PROVEN | Mechanism is understood; the consequence has not been shown. |
| POTENTIAL | Mechanism is understood; the consequence depends on a scale the current store has not reached. |
| NOT MEASURED HERE | The evidence that would settle it exists to be gathered, and was not gathered in this pass. |
| REQUIRES BUSINESS DECISION | The correct behaviour is a product question, not a technical one. |

**The environment for every number below** is the local Docker Supabase stack
(`http://127.0.0.1:54321`, container `supabase_db_nabin`, `backend/.env:12`
`SUPABASE_POSTGRES_LIVE=true`), the Express backend on `:4000` connecting as `service_role`, and
`supabase/config.toml:8` `max_rows = 1000`. Nothing here was run against the hosted test project
or production, and no number below should be read as a statement about either.

---

## Decision 1 — Should the anonymous key still read geography, rates, flags and promotions directly from PostgREST?

### CURRENT EVIDENCE

**What an anonymous caller can read today** (census taken with the publishable/anon key over
PostgREST, one `select('*', { count: 'exact' }).limit(2)` per table across 40 tables; recorded in
`docs/proposed/028_geo_and_commerce_reads_service_role_only.sql` §1 and re-derived this pass):

| Table | anon reads | rows at rest | what that gives away |
|---|---|---|---|
| `geo_fences` | YES | 447 | every ACTIVE boundary's geometry (coordinates / center+radius), `surcharge_amount`, `surge_multiplier`, `allowed_services`, `allowed_vehicles`, `operating_hours` |
| `surge_zones` | YES | 445 | every ACTIVE rule's multiplier, window, priority, reason |
| `pricing_configurations` | YES | 6 | `base_fare`, `per_km_rate`, `per_min_rate`, `min_fare`, `booking_fee`, `commission_percent`, `global_surge_multiplier` |
| `platform_settings` | YES | 21 | key/value pairs including the feature-flag and integration namespace |
| `promotions` | YES | 642 → 838 | code, `discount_type`/`discount_value`, caps, usage counts |
| `merchants` | YES | 39 | including `phone`, `fssai_license`, `wallet_balance`, address, lat/lng |
| `products` / `merchant_grocery_inventory` / `master_grocery_catalog` / `notification_templates` / `advertisements` | YES | 26 / 14 / 3 / 17 / 1 | prices, stock, SKU, templates, campaigns |

31 of the 40 probed tables answer an anon `SELECT` at all. The other 9 refuse with `42501
permission denied` — `campaigns`, `campaign_assets`, `campaign_offers`, `campaign_messages`,
`campaign_themes`, `backend_sessions`, `dispatch_offers`, `journal_lines`, `payment_webhooks` —
and every one of those refusals is migration 027 §6 doing its job:

```sql
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ... FROM anon, authenticated;
GRANT SELECT ON ... TO service_role;
```

**Why the door is open on the eleven target tables** (verified this pass against
`pg_policies` / `pg_class` / `information_schema.role_table_grants` on the local database): each
has `ROW LEVEL SECURITY` **enabled but not forced**, a read policy whose `TO` clause is absent —
which in PostgreSQL means *every role*, including `anon` — **and** a `SELECT` grant held by
`anon`/`authenticated`. Three separate reasons it answers, which is why a policy drop alone would
not close it.

**CLIENT DEPENDENCY: NO.** Tested rather than assumed:

- `createClient` / `@supabase/supabase-js` / `supabase_flutter` appear **only** under `backend/`.
  The two client constructions are `backend/src/supabase.js:36` (anon, used internally by the
  server) and `:37` (`service_role || anon`, the one the API actually uses). The only other hits
  are the security probes at `backend/geo_adversarial_test.js:84` and `:605`.
- `admin-web`, `customer-web`, `restaurant-merchant-web`, `grocery-merchant-web` and `mobile/`
  reach the platform **only** through the REST API. Every admin screen that shows a boundary calls
  `GET /api/admin/geofences`, which is gated (`geo_adversarial_test.js` SEC-02: 401 unauthenticated).
- No Postgres function is reachable with the anon key: the promotion domain has exactly two RPCs
  and neither is executable by `anon` (checked this pass).

So the anon grants are **surface, not function**. Revoking them cannot break a screen, because no
screen is on the other side.

Two supporting facts, both verified: `service_role` has `rolbypassrls = true` and holds its own
grants on all eleven tables, so the Express server keeps its reads whatever is revoked from
`anon`/`authenticated`. And the census above was taken *while `test_suite.js` was running*: the
anon key saw **449** `geo_fences` rows where the store holds 447 at rest — Decision 4's residue,
visible from outside the process.

### SECURITY IMPACT

An unauthenticated HTTP request to `http://<host>:54321/rest/v1/geo_fences?...` returns the
operator's entire geographic and pricing model: the coordinates of every active boundary, every
surcharge amount, every surge multiplier and its window, and the complete rate card including
`commission_percent`. That is a competitor's spreadsheet, assembled with one request per table,
with no credentials, no rate limit and no audit trail — and it never touches the Express layer, so
nothing in the platform's own logging can see it happen.

The `merchants` row is the sharpest column: `phone`, `fssai_license` and `wallet_balance` of 39
counterparties in an unauthenticated response. A `wallet_balance` is a financial field of a
business partner; a `phone` is personal data of a named proprietor.

### BUSINESS IMPACT

- **Closing it** (Option A) removes a read no current consumer uses. Its cost is architectural
  finality: after it, adding any public read of these six tables requires a migration — which is
  the point, and also the friction.
- **Keeping it** preserves the possibility of a static, backend-free public surface — a marketing
  site reading `pricing_configurations` for a "fares from ₹X" widget, a partner integration
  polling `platform_settings`. No such consumer exists today, so keeping it open is a decision
  about a *hypothetical* consumer.

### OPTIONS

- **A — service_role-only on the six control-plane tables.** `docs/proposed/…028…sql` §2, already
  written and **not applied**: `ENABLE ROW LEVEL SECURITY`, drop the six `public`-granted read
  policies, `REVOKE ALL FROM anon, authenticated`, restate `GRANT SELECT TO service_role`. Scope:
  `geo_fences`, `surge_zones`, `pricing_configurations`, `platform_settings`, `promotions`,
  `notification_templates`.
- **B — restricted `authenticated` RLS.** Keep policies, tighten them to
  `TO authenticated USING (…)`, so a signed-in customer reads them and an anonymous caller cannot.
  Requires choosing which of the 31 readable tables a *customer* legitimately reads, and
  re-granting `SELECT` to `authenticated` only.
- **C — public-minimal projection.** A deliberately narrow public surface: a database `VIEW` (or
  column-level grant) exposing only what a public page legitimately shows — fence `name` and a
  serviceability boolean, not geometry; `min_fare` bands, not `commission_percent`; a merchant
  directory of name/cuisine/address/photo, not `phone`/`wallet_balance`.
- **D — column-grant narrowing without closing the read.** The variant 028 §3 records for
  `merchants`: `REVOKE SELECT`, then `GRANT SELECT (id, name, merchant_type, address, lat, lng,
  is_open, rating, created_at, updated_at)`. PostgREST honours column privileges and projects only
  what the role can read. **Untested in this repository** — 028 says so at §3; it must be proved on
  a scratch database before anything relies on it.
- **E — the current architecture, documented as intended.** Decide that direct PostgREST reads are
  a supported public path, accept the exposure, and instead remove the sensitive *columns* from the
  tables (move `wallet_balance`, `fssai_license` to a table with no public grant).

### PROS

- **A**: one DDL file, already written; matches the pattern the repository already uses and that
  the nine 42501s prove works; no consumer to migrate; makes
  CLIENT → BACKEND → GeoPolicyService → DATABASE the only path instead of an option; the six
  tables are precisely the ones that are *not* client data.
- **B**: keeps a signed-in read path open for a future app that talks to PostgREST directly.
- **C**: the only option that is *better* than today for a public page — a view can show a service
  area without showing its coordinates.
- **D**: surgical; leaves the storefront working; removes the two worst columns from the response.
- **E**: zero compatibility risk; removes the leak at the data layer rather than the policy layer.

### CONS

- **A**: an `authenticated` customer loses these reads too, since RLS-without-policies denies every
  non-BYPASSRLS role. Intended for these six tables — and the reason B and C exist as alternatives.
  It also **breaks `geo_adversarial_test.js` SEC-07-KNOWN-GAP**, which currently asserts a 200; the
  check's own text asks to be rewritten to assert the refusal.
  *(Chosen and carried out on 2026-09-24: owner Decision 1 = A, migration 029 applied to the local
  Docker store, `SEC-07` now asserts the 42501 refusal, and `backend/geo_anon_access_test.js` proves
  all six tables. `authenticated` did lose the reads, as this bullet says it would — the caller
  inventory found none of them, so nothing that used these tables stopped working. Hosted test and
  production remain untouched.)*
- **B**: `authenticated` is a *session*, not a *scope* — every signed-in customer of every service
  line gets the same read. It also does nothing about `anon` unless `anon` is separately revoked,
  so it is more moving parts than A for less closure.
- **C**: a view is new schema to maintain and the backend must be pointed at it; RLS on the
  underlying tables still applies, so it needs care (Postgres views run as the owner unless
  `security_invoker` is set — the latter is the one that keeps RLS meaningful).
- **D**: the `select=*` → allowed-set behaviour on column grants is plausible and documented but
  **not demonstrated here**; and a partial-column read is easy to get wrong silently, because a
  missing column can look like a null downstream.
- **E**: moving columns between tables is the largest blast radius of the five, and every writer of
  those columns has to change in step.

### MIGRATION REQUIRED

All five: yes — DDL or grant changes, so a file in `supabase/migrations/`. Nothing in this decision
can be done in application code, because the read bypasses the application. **No migration is
applied by this pass, and none may be applied without a decision here.**

**One naming problem to settle before any DDL is written down.** The number `028` is already
reserved: `docs/ADMIN_FEATURE_SPECIFICATION.md` §9 item 1 records that "migration 028 will not be
written, proposed again, or slipped into a phase" — for the *declined* role/permission matrix.
`docs/proposed/028_geo_and_commerce_reads_service_role_only.sql` therefore collides with a declined
identifier, and applying it as 028 would silently redefine a number the specification says is
deliberately unused. Fix before applying: renumber to 029, or apply under whatever number the owner
assigns. This is an approval question, not a technical one. See Phase 10, caveat 1.

### INFRASTRUCTURE REQUIRED

Nothing beyond what runs today. No Redis, no queue, no new service. Local Docker for verification;
the hosted test project only after local verification, on its own approval.

### TEST REQUIREMENTS

1. Re-run the anon census. Expected: the six tables answer `42501 permission denied`, and every
   table that returned 0 rows still returns 0 rows rather than erroring in a new way.
2. **Restart the backend and read the boot line.** This is where a `service_role` regression shows
   up, not in step 1 — geography that cannot be read lands on `UNREADABLE` and geographic pricing
   becomes unavailable, so a wrong grant is a pricing outage. The tripwire already exists:
   `boot_mirror_read_test.js`, 20 checks, written for exactly this.
3. Rewrite `geo_adversarial_test.js` SEC-07-KNOWN-GAP to assert the refusal.
   *(Done 2026-09-24, in the same change as migration 029. The rewritten check also fails, rather than
   skipping, when `SUPABASE_ANON_KEY` is absent — and it needed `require('dotenv')` at the top of that
   file, which no other suite in the chain carried, because it had never needed the key before.)*
4. Then, in order, each from a fresh process: `geo_policy_test.js`, `geo_adversarial_test.js`,
   `test_suite.js`, `restart_test.js`, `auth_failclosed_test.js`,
   `session_reconcile_pagination_test.js`, `boot_mirror_read_test.js`.
5. Option C or D additionally needs a probe of the *view* / *column set* under `anon`, and a
   negative probe proving a withheld column cannot be projected.

### ROLLBACK

Forward-only as written, and the real rollback is a `pg_dump` taken before applying plus a restore
— 028 §5 says so. Re-creating the six dropped policies verbatim (011 §6 for the geo trio; the
names quoted in 028 §2 for the other three) and re-granting `SELECT` to `anon` and `authenticated`
puts Section A back. A `DROP POLICY` is a schema change, so the dump is not optional.

### OPEN QUESTION

> Is any anonymous, backend-free read of these six tables part of a planned product surface — a
> public fare page, a partner feed, a static marketing site? If yes, this is Decision 1 *and* a new
> question about which columns that page may see. If no, the anon grants are pure attack surface
> and Option A closes them with no consumer to migrate.

---

## Decision 2 — Should `POST /api/geofence/evaluate` require authentication?

### CURRENT EVIDENCE

- **Who calls it.** The route is registered bare at `backend/src/server.js:2975` — no
  `authenticateAdmin`, no customer/driver bearer, no middleware of any kind between the URL and the
  handler. Its callers, exhaustively:
  - `admin-web/src/app/admin_dashboard.html:5307` and `:5367` — **tokenless** `fetch` calls, i.e.
    the dashboard's "test a point against the fence set" tool reaches this route as an anonymous
    user;
  - the backend test harnesses (`geo_policy_test.js`, `geo_adversarial_test.js`, `test_suite.js`),
    which send no token because none is required;
  - **no Flutter caller** — `mobile/lib/core/network/nabin_api_service.dart` has no
    `/geofence/evaluate`;
  - **no public website caller**.
- **Does a customer or driver auth path exist that could apply?** Yes, and this route uses none of
  it. Customer and driver sessions are issued and verified (`POST /api/auth/*`, bearer resolution
  in `server.js`), and the booking routes that price a real trip sit on that path — but a rider's
  quote comes from `POST /api/pricing/estimate`, which is *also* anonymous (`server.js:3077`).
- **Is it used by admins?** As a tool, yes; as an admin route, no. The five real admin geo routes
  are separately registered and gated (`server.js:2922`, `:2931`, `:2940`, `:2950`, `:2959`,
  `:3130`; `geo_adversarial_test.js` SEC-02 proves 401 unauthenticated). So `/evaluate` is a
  *public* route an admin happens to click, and its tokenless fetch is why gating it would break
  that button.
- **Siblings in the same state:** `POST /api/geofence/reverse-geocode` (`:3009`),
  `POST /api/pricing/estimate` (`:3077`), `GET /api/app/config` (`:6277`) — all anonymous. There is
  no anonymous fence-*list* route, so this route is not a bulk dump. It is a single-point oracle.
- **What it returns** (`DATA RETURNED`): through `describeFence`
  (`backend/src/services/GeoPolicyService.js:376-387`), a field whitelist that **excludes
  geometry** — matched zone identity and name, `surge_multiplier`, `surcharge_amount`, the pricing
  inputs the engine will use, service/vehicle allowances, and `storeState`. The boundary's
  coordinates are not in the payload.
- **Rate limiting: none, anywhere** (`RATE-LIMIT REQUIREMENT`: unmet today). There is no
  `express-rate-limit`, no `helmet`, no throttle middleware in the Express dependency tree at all.
  This is not specific to this route — the platform has no rate-limit layer, so *every* option
  below that relies on one is also a decision to add one.
- **Flutter: direct or backend?** Backend only. The mobile app reaches the platform through the
  REST API and never opens a Supabase session (Decision 1: CLIENT DEPENDENCY NO), so this route is
  not on the mobile path at all today.

### SECURITY IMPACT (`ABUSE RISK`)

An unauthenticated **pricing oracle**. One POST per coordinate pair; the answer is whether a
boundary contains that point and what it would cost. Two consequences follow that "it does not
return coordinates" does not cover:

1. **Boundary reconstruction by bisection.** The geometry is absent from the payload, but the
   boolean *inside / outside* is not, and it is answerable at any resolution the caller wants. A
   few thousand requests over a grid recover the shape of every active fence to arbitrary
   precision — the same information Decision 1's direct read gives away in one request, obtainable
   here with no key beyond the public one.
2. **Margin disclosure by estimation.** The payload carries `surcharge_amount` and the effective
   multiplier, and `POST /api/pricing/estimate` on the same anonymous path returns the fare itself.
   Together they let a competitor measure the operator's pricing rule zone by zone.
3. **Amplification.** No auth means no per-account attribution; no throttle means one client can
   issue as many as it likes; and each evaluation ray-casts the whole fence copy in memory — so
   this is simultaneously a reconnaissance channel and a cheap CPU lever against the pricing path.
   Pass 6 polled this route family at `5 req/s` continuously while two backends priced, and the
   divergence recorded in Decision 3 was found through it.

### BUSINESS IMPACT

Gating it is not free. The boundary tester in the admin dashboard is an anonymous call today, and
the customer-facing quote path (`/api/pricing/estimate`) is anonymous by design — a shopper
checking a fare before signing in is a real journey. So:

- A **customer/driver bearer** on `/evaluate` breaks nothing real (no app calls it) but sets the
  precedent that `/estimate` should follow, and *that* would change the signup funnel.
- An **admin** bearer is a one-line change that breaks the dashboard tester until the dashboard
  sends the token it already holds in memory — a few lines of `admin_dashboard.html`.
- Every option also raises the question the platform has not answered: **is there a rate-limit
  policy for anonymous pricing reads at all?** That is a product decision about the public funnel,
  not a security one.

### OPTIONS (`OPTIONS`)

- **A — leave it anonymous, add a throttle.** The response already omits geometry; accept the
  oracle and bound its rate (per-IP, and per-IP only, since there is no identity). Requires adding
  a rate-limit dependency the repository does not currently have.
- **B — require a customer or driver bearer.** Every evaluation becomes attributable; the bisector
  now needs an account. Leaves the pre-signup quote journey broken unless `/estimate` is treated
  differently.
- **C — gate it behind `authenticateAdmin` and make the dashboard send its token.** The route is
  *used* as an admin tool by everyone who calls it and no app depends on it. Smallest change by
  line count. Does nothing about `/estimate`, which is where the fare comes from.
- **D — split the route.** Keep a thin anonymous `POST /api/geofence/check-serviceable` answering
  one boolean for one point ("can I book here?") with no multiplier, no surcharge and no zone
  attribution, and move everything richer behind an admin gate. The public funnel keeps working;
  the oracle stops existing.
- **E — anonymous but bounded by design.** The response keeps the whitelist, and the route refuses
  a request unless it carries the session token `GET /api/app/config` issued, with a per-token
  evaluation budget. Effectively a poor man's rate limit that needs no identity.

### PROS

- **A**: no consumer breaks; the funnel is untouched; the only option that also covers `/estimate`
  and `reverse-geocode` with one mechanism.
- **B**: attribution, and the abuse channel requires a registered account the platform can disable.
- **C**: matches actual usage exactly; no new response contract; consistent with the five gated
  admin geo routes beside it.
- **D**: separates the two genuinely different questions the route answers today — "is this
  serviceable" (public, low value to an attacker) and "what does the engine charge here" (private).
- **E**: no dependency, no identity, keeps the pre-signup path.

### CONS

- **A**: still an oracle — bisection just succeeds more slowly; and it adds the platform's first
  stateful middleware, which has its own outage mode (what does the route do when the counter store
  is unavailable?).
- **B**: a signed-in-only boundary check *is* a funnel change, and the funnel is the reason the
  route is public. It also breaks the admin tester unless the dashboard holds a customer token,
  which is the wrong credential for an admin.
- **C**: implies the platform has no public geographic surface, which the pricing path contradicts
  — an attacker moves to `/estimate`. C alone moves the door rather than closing it.
- **D**: two contracts instead of one, and the boolean is still a bisection answer — a far less
  valuable one per request, which is why D still wants A's throttle to be worth much.
- **E**: makes token issuance a security dependency of a route that had none, and a caller who
  wants to sweep can simply re-request the config feed. Per-IP (A) is more honest about what is
  actually available.

### MIGRATION REQUIRED

No — for all five. This decision lives entirely in the Express layer, which is where every
enforcement layer this project actually has lives (`ADMIN_FEATURE_SPECIFICATION.md` §2.1 and §11
answer 8: Express-only enforcement, no per-request scoped tokens).

### INFRASTRUCTURE REQUIRED

A needs a rate store: in-process counters (reset on restart, one per instance) or an external one,
which the platform does not have. E needs the same plus a signing secret. B, C, D need nothing new.

**Multi-instance caveat, because it recurs in Decision 3:** an in-process counter is one counter
per process, and this project is known to run more than one process against one database. Any
throttle chosen here inherits that a second process does not see the first one's budget.

### TEST REQUIREMENTS

`geo_adversarial_test.js` must be extended, not replaced: today it proves the *admin* geo routes
refuse an unauthenticated caller (SEC-02) and records the *database* exposure on `/evaluate`
(SEC-07-KNOWN-GAP). New checks:

*(Status 2026-09-24, after Decision 1 = A: `SEC-07` asserts the refusal in that file, and the
negative-and-positive matrix below lives in its own harness, `backend/geo_anon_access_test.js` —
6 tables denied to `anon`, the four geometry columns and the row count withheld, a no-credential
request denied, `service_role` still reading all six, a signed-in customer token denied, and the
out-of-scope neighbours still answering, and the write half of `REVOKE ALL` probed with a filter that
matches no row. 44 checks.)*

1. A gate check on the route in its new state (401/403 where appropriate), per caller class:
   anonymous, customer bearer, driver bearer, non-admin staff.
2. A negative check that the response contains no geometry and no field outside the `describeFence`
   whitelist. That whitelist is the current mitigation, so it must stay *asserted* rather than
   become assumed.
3. If A or E: a throttle check that counts refusals, and a check that a throttled response does not
   look like a pricing failure — a 429 must not surface as `GEO_STORE_UNAVAILABLE`, and must not
   move the geo store to `UNREADABLE`, which is a state the platform treats as a pricing outage.
4. Full chain from fresh processes, because the route is on the pricing path: `geo_policy_test.js`,
   `geo_adversarial_test.js`, `test_suite.js`, `restart_test.js`.

### ROLLBACK

Application code only, so a revert is a genuine rollback — the one respect in which this decision
is cheaper than Decision 1. One asymmetry: a *revoked* admin token is not restored by a revert, so
any option that logs people out has a one-way edge.

### OPEN QUESTION

> Is a boundary or pricing check meant to be answerable to a stranger? This route currently does,
> and the funnel route (`/api/pricing/estimate`) does too — so "no" is a product change and not
> only a security change. The answer has to cover **both** routes, because gating one and not the
> other moves the sweep rather than stopping it.

---

## Decision 3 — How does a geographic write on one instance become visible to another?

### CURRENT EVIDENCE

**What is cached, and where.** `NabinDatabase` holds the live geographic state in two plain
process-memory arrays — `geoFences` (`backend/src/database.js:523`) and `surgeZones` (`:586`) —
plus a state object `this.geoStore` (`:1637-1639`) with `{ fences, rules, source, readAt }`, the
first two taking `GEO_STORE_STATE.UNREADABLE | VALIDATED_EMPTY | VALIDATED`. `GeoPolicyService`
owns no copy: it binds accessors at `:1641-1646` (`fences: () => this.geoFences`,
`rules: () => this.surgeZones`, `globalSurgeMultiplier`, `storeState`). That indirection is
deliberate — "the engine reads through accessors instead of owning a copy, so the next call sees a
re-hydration" (`:1630-1631`).

**When it is hydrated.** Exactly two moments:

1. at boot, before `listen()` — `await this.hydrateGeoStore('boot')` (`:2004`), bounded by
   `GEO_READ_TIMEOUT_MS = 10000`;
2. after a *local* admin write — `geoStoreChanged(what)` (`:2383`), which re-hydrates with reason
   `admin <what> write`.

**TTL: none.** No expiry, no interval, no periodic refresh, no lazy re-read on access. `readAt` is
recorded and reported but **never compared against anything** — a timestamp for a human, not a
freshness control.

**Does a database write invalidate another instance's copy? No.** No publisher, no subscriber, no
channel. Nothing in the write path signals a second process, and no code path other than the two
above can move `geoStore` out of `VALIDATED`.

**Can pricing execute from stale data? Yes — CONFIRMED, in rupees.** Pass 6 ran two independent
backends against one database (`docs/GEOFENCING_SECURITY_AUDIT.md` R10 item 3): after instance A
created a boundary, **A quoted a point ₹984 and B quoted the same point ₹330 — 2.7× apart**,
indefinitely; 35 seconds of polling moved B nowhere; and the divergence ran both ways, because a
boundary B deleted kept being priced by A until A restarted. **Restart is the only invalidation
that exists.**

**The same question is already an open approval stop, elsewhere.** `ADMIN_PERMISSION_MATRIX.md`
§6.7 and `ADMIN_FEATURE_SPECIFICATION.md` §11 decision 16 / §9 item 6 record this exact shape for
*sessions*: adoption of another instance's write converges inside a periodic reconcile tick
(observed working in 3 of 4 passes, INTERMITTENT in the fourth), while a revocation performed here
does not reach another instance at all, because `reconcileSessions`'s loop skips precisely the keys
a remote revocation needs dropped (`if (isDevFixture || /^[0-9a-f]{64}$/.test(key)) continue;`
against tokens stored as `hashSessionToken(token)` — 64 hex characters). Two consequences for this
decision: the repository already contains a periodic, DB-driven reconcile pattern pointed at a
different table, and it already contains the evidence that periodic *adoption* is easier than
periodic *invalidation*, and that neither is a guarantee.

**What already got fixed, so nobody re-fixes it.** Pass 6 made a *single* process correct about its
own writes and honest about an unreadable store: `fenceIdFilter` (`PricingRepository.js:277`,
`:442`) stops a non-UUID id reaching an `id` column; `readAllRows` (`database.js:5892`) walks past
the 1000-row cap and refuses to publish a truncated geography (an incomplete walk lands on
`UNREADABLE`); `withDeadline` bounds the boot read. **None of that is cross-instance.** They are
the preconditions for every option below, and the reason no option here has to worry about a
partial read masquerading as a fresh one.

### SECURITY IMPACT

Geography is a pricing input and `GeoPolicyService` is its only authority
(`ADMIN_FEATURE_SPECIFICATION.md` §2.1). If two processes hold different answers to "what does this
trip cost", the platform's price is a property of *which process answered*, not of the policy:

- An operator suspends a surge rule to stop overcharging during a rain event. The instance that
  served the write stops; the others keep surcharging. From the customer's side the fix "did not
  work" for some requests, and there is no error anywhere to explain it.
- Conversely a fence *added* on A is invisible to B, so B undercharges — `surcharge_amount` never
  applied, 1.0x where the store says 2.0x. Silent revenue leakage.
- The audit trail records the write A made. It cannot record the quotes B kept giving from a stale
  copy, so the discrepancy is invisible after the fact except to a customer comparing two receipts
  — which is how the ₹984/₹330 pair surfaced at all.
- It is also why Decision 1's exposure matters more: an anonymous caller reading `geo_fences`
  directly sees the *store*, while the customer's price comes from a *process's memory*. Those two
  can disagree, and neither is authoritative.

### BUSINESS IMPACT

Every option is a freshness/cost trade on the hottest path in the pricing engine. Option A turns
every quote into a paged walk over 447 fences + 445 rules — measurable latency, and it moves
Phase 9's truncation exposure onto every request instead of boot. B and E add staleness *windows*
the owner must accept as a number ("a price may be up to N seconds wrong"), which is a commercial
statement. C and D add infrastructure the project does not have.

And the whole area has a non-technical twin: **if the platform is only ever run as one process,
this is a latent bug with no impact.** "How many processes will share this database in production?"
is a deployment question only the owner can answer — and it is the same question that decides §11
decision 16 for sessions.

### OPTIONS

- **A — no cache: read geography from the store for every decision.** Remove the arrays as a
  pricing input; `evaluate` becomes a `readAllRows` walk (or a Postgres-side ray-cast) per request.
- **B — short TTL on the in-process copy.** `hydrateGeoStore` on first use after
  `readAt + ttl` elapsed, ttl in the 5–60s range, still bounded by `GEO_READ_TIMEOUT_MS`.
- **C — database-driven invalidation.** A version/heartbeat row (or trigger + `pg_notify`) each
  instance checks — by LISTEN on a persistent connection, or by polling the version cheaply; a
  changed version means re-hydrate. This is the `reconcileSessions` tick's shape, aimed at
  geography.
- **D — Redis / pub-sub.** The write path publishes "geo changed"; every instance subscribes and
  re-hydrates. Push instead of poll, so convergence is near-instant and no read sits on the request
  path.
- **E — the architecture already in the repository, extended.** One periodic tick per process,
  `hydrateGeoStore('scheduled refresh')` on an interval — geography given the reconcile-tick
  treatment the sessions domain already has, with the state object going to `UNREADABLE` when the
  tick fails.
- **F — accept it, and make restart the *documented* invalidation.** Not a workaround as an
  oversight: a written deployment contract that geo writes are followed by a rolling restart, the
  audit record says so, and the admin UI warns "this takes effect after the service restarts".
  Pass 6 found restart is the only invalidation that exists; F is the choice to make that the
  specified behaviour instead of the accidental one.

Per-option consequence table, in the terms the order asked for. Each cell is a property of the
option, not a judgement about whether to choose it:

| Option | SECURITY | CORRECTNESS | LATENCY | COMPLEXITY | FAILURE MODE | INFRASTRUCTURE | MIGRATION | REVERSIBILITY |
|---|---|---|---|---|---|---|---|---|
| A no-cache | price always reflects the store | stale-by-construction impossible | worst: paged walk per quote | low conceptually, high blast radius | store answers partially → quotes fail (Phase 9) | none | none | code revert |
| B short TTL | bounded staleness | wrong for ≤ttl | one slow request per ttl window | lowest | refresh on request path times out → `UNREADABLE` | none | none | code revert |
| C DB version row | converges, bounded by poll | version bump can be forgotten | unchanged (poll is cheap) | medium | missed bump → today's behaviour, silently | none (or a persistent connection for LISTEN) | yes (DDL) | code revert; dead table is harmless |
| D Redis pub/sub | near-instant convergence | best of the six | unchanged | highest | dropped subscription must not mean stale → needs B/C under it | **new stateful service per env** | none | deployment rollback + secret deletion |
| E periodic tick | bounded staleness | converges both ways if the tick lands | unchanged | low (pattern exists) | missed/intermittent tick (sessions precedent: 3-of-4) | none | none | code revert |
| F restart contract | truthfully documented | correct after the restart | unchanged | documentation only | operator forgets; memory-only surfaces lose state on restart | deployment procedure | none | doc revert |

### MIGRATION REQUIRED

A: no. B: no. C: yes, if the version is a table or trigger (DDL, plus 027/028-style grant care so
`anon` cannot read it). D: no DB migration, but a deployment change. E: no. F: no.

### INFRASTRUCTURE REQUIRED

D requires a Redis (or equivalent pub/sub) instance in every environment including the local Docker
stack — `docker-compose.yml` changes, a secret to manage, and the first stateful dependency this
backend has. C's `pg_notify` variant needs a long-lived direct Postgres connection per instance
(PostgREST's pool is request-scoped, so this is a dependency the platform currently avoids;
`database/persistentStore.js` is file-backed). A, B, E, F need nothing new.

### TEST REQUIREMENTS

The one decision that cannot be verified with a single process — and pass 6's two-backend harness
already exists and should be extended rather than rewritten.

1. **Adoption**: A writes a fence; B must converge within the promised bound (A: first request;
   B: TTL; C/E: interval; D: publish latency). Assert the *bound*, not eventual convergence —
   "eventually" is what pass 6 disproved for revocation.
2. **Invalidation in both directions**: B must *stop* pricing a fence A deleted, not merely start
   pricing one A created. The sessions precedent (INP-24/25/26) is exactly that adoption is the
   easy half and revocation the hard one, and the ₹984/₹330 measurement diverged both ways.
3. **Failed refresh**: with the store made unreachable, the copy must go to `UNREADABLE` and
   geographic pricing must refuse rather than serve the stale copy — "a cache that keeps pricing
   while the store cannot be read has become the thing it was copied from" (`:2300-2305`). Assert a
   503 `GEO_STORE_UNAVAILABLE`, and that it is not mislabelled as a business 4xx.
4. **Truncated refresh**: a capped walk must land on `UNREADABLE`, never `VALIDATED` (Phase 9's
   interaction with this decision). `boot_mirror_read_test.js` already asserts it for boot; the
   same assertion must hold for whatever new refresh trigger is chosen.
5. **No-regression**: `geo_policy_test.js`, `geo_adversarial_test.js` (CACHE-01…05 cover the
   local-write invalidation this must not break), `test_suite.js`, `restart_test.js`,
   `boot_mirror_read_test.js`, each from a fresh process — plus the two-process test run **twice**,
   because the sessions area already showed that a single green multi-instance run proves nothing
   (INTERMITTENT, 3-of-4).

### ROLLBACK

A/B/E: revert code; the state machine tolerates it because `UNREADABLE` is the safe state and the
boot hydrate is untouched. C: revert code, and a version table/trigger can stay harmlessly unread —
a dead row is not a wrong answer. D: revert code, but removing the Redis dependency is a deployment
rollback and the credentials must actually be deleted, not merely unused. F: revert the documented
procedure — a documentation change, so F's risk is not rollback but the interval during which
operators act on the old text.

### OPEN QUESTION

> **How many backend processes will share one database in production, and is that number one
> today?** If it is one, this decision and §11 decision 16 are both latent, and the defensible
> option is F with the constraint written down. If it is more than one, a bounded-staleness
> *number* is required from the business — "a price may be up to N seconds out of date" is a
> commercial statement — and every option except A needs it.

---

## Decision 4 — What happens to the historical boundary rows the test suites left behind?

### CURRENT EVIDENCE

The resting local store holds **447 `geo_fences`** and **445 `surge_zones`** rows. This pass
classified all of it, read-only, against the local container (the SQL lived in the pass's scratch
directory and was deliberately not left in the repository).

**`geo_fences` — 3 real, 444 residue:**

| Family | rows | distinct geometries | distinct `created_by` | date span (by day) |
|---|---|---|---|---|
| test-fixture shapes (three recurring names) | **444** | **exactly one per shape** | **1 author** | 2026-09-05 … 2026-09-23 |
| real seed boundaries | **3** | 3 | 2 named people | 2026-09-05 |

The three real ones are **Connaught Place**, **Cyber City**, **IGI Airport**, created by *Karan
Patel* and *Devika Singhania* on 2026-09-05. Every other fence is a repeated fixture shape, one
geometry per shape, from a single author, spread over eighteen consecutive days — the signature of
a suite running repeatedly, not of an operator drawing boundaries. This is **production-like
fixture residue**, and it accumulated per run rather than from one probe.

**`surge_zones` — the classification does not transfer, and this is the finding to read twice:**
**all 445 rows carry one of the three leaked fixture names**, with author *System Administrator*.
The three real fences appear as `zone_id` references *inside* those rules — 179 rules point at the
IGI Airport seed, 185 at the Hospital-shaped seed, 0 at Noida. So a purge keyed on the leaked
*names* would **empty the entire `surge_zones` table**, including the rules a reviewer would
naturally classify as real. There is no name-based split of the rules that is safe.

**Referential reality:**

- **Zero foreign keys** on either table (`pg_constraint` inspection this pass). `zone_id` is a soft
  UUID reference with no database-level integrity behind it. Consequence in both directions: a
  fence delete can never fail on an FK violation, and a fence delete can therefore **silently
  orphan** the rules that point at it — nothing will tell you.
- **Zero references** to any fence or zone id inside `jobs`, `orders`, `checkouts` or payments. The
  audit passes already established that geo is pricing-only: no boundary gates a booking
  (`GEOFENCING_SECURITY_AUDIT.md` §3 table, "Create a ride → Enforces a geo-fence? **No**"). So no
  transactional row points at these 444 shapes.
- **1,494 `audit_logs` rows** carry geo/surge actions, but **zero** of them name a leaked fixture
  shape. The audit trail does not depend on these rows for its narrative — and conversely, the
  leaked rows were never audited into existence, which is itself part of the story.

**The leak is already stopped.** Pass 6 added `GEO-TEARDOWN` to `test_suite.js` and
`restart_test.js`: a suite records the ids it created and reaps them by id, so a run now leaves the
store at 447/445 instead of growing it (documented in `docs/POSTGREST_MAX_ROWS_AUDIT.md` §6.2: the
geography growth stopped; promotions and tickets still grow ~+7/+4 per run). The absence of a
surge-rule `DELETE` route is why teardown goes through the service path, not an HTTP verb.

So the 444 are **historical residue from before the fix**. Note also that the anon census saw
**449** fences mid-run: residue is externally readable while it exists, which is Decision 1's stake
in this decision.

### SECURITY IMPACT

Three effects, in descending order of seriousness:

1. **Every fence in the store is ray-cast on every quote.** `readAllRows` walks the whole table at
   boot and hydrate; 444 of 447 boundaries are fiction. A caller probing `/api/geofence/evaluate`
   (Decision 2) gets "inside a fence" answers for shapes no operator ever drew, and pricing inputs
   (`surcharge_amount`, `allowed_services`, `allowed_vehicles`, `operating_hours`) come from them.
   The test data is not inert: it is an active pricing input.
2. **The ratio makes review useless.** With 447 rows of which 444 are residue, no human can look at
   the admin fence list and tell what is real. The `⚠️ INCOMPLETE MIRROR(S)` reporting and the
   `describeFence` whitelist both assume the read set is meaningful data; 99.3% of it is a stale
   fixture. Precedence between overlapping rules (`priority`) is decided against that noise, so
   "which fence wins" can be answered by a row whose author was a test.
3. **It is the visible symptom of a leak class, not a one-off.** The same mechanism left 838
   promotions and 763 tickets behind (`POSTGREST_MAX_ROWS_AUDIT.md` §6.2). Geography is the only
   domain whose suite got a teardown, so a purge here without extending the pattern to the others
   fixes one instance of a class.

### BUSINESS IMPACT

Deleting 444 rows is, in this project, an act that needs a rule rather than an exception:
`ADMIN_FEATURE_SPECIFICATION.md` §10 already states **"No hard delete of … audit rows"**, and the
same instinct will be applied to this table by the next person who reads that sentence. The rows
are local-Docker rows — the hosted test project and production have their own contents, and **this
census says nothing about them** — so the practical impact is confined to the local stack, which is
also where every suite runs.

What is *not* confined is the precedent: "test residue gets hard-deleted by an operator with psql"
is a policy statement about data in this project, and if it is chosen it should be chosen as a
policy and written down, not done as a cleanup. There is a trap specific to this table too: because
`zone_id` has no FK, a purge of fences that leaves the 445 rules behind does not error — it quietly
produces a rule set that points at nothing, which is a *worse* state than today's, because
today's rules at least point at the shapes they were written with.

### PURGE CANDIDATES

| Set | rows | classification | candidate? |
|---|---|---|---|
| `geo_fences` with the three fixture names | 444 | test-suite residue (1 geometry per shape, 1 author, 18 days of repeats) | **YES — the only cleanly identifiable purge in the table** |
| `geo_fences` Connaught Place / Cyber City / IGI Airport | 3 | seed / production-like, 2 named human authors | NO — keep |
| `surge_zones` — all rows | 445 | all carry a leaked fixture name; 179 / 185 / 0 reference the three seeds | **NOT name-identifiable.** Only a purge by recorded id (or by geometry) distinguishes "rule created by a suite" from "rule an operator wrote about the IGI fence". The census cannot make that split, and this document will not guess it. |
| `promotions` / `support_tickets` residue | 838 / 763 | same class, no teardown yet | out of scope here; named so the class is not mistaken for geo-specific |

### SAFE TO DELETE?

**The 444 fences: technically yes, with one condition.** No FK blocks it, no transactional row
references it, no audit row names it. The condition is that the **rules must be handled in the same
operation**: either restrict the fence purge to shapes no rule references (a query the census
supports — fence ids absent from `surge_zones.zone_id`), or accept orphaned `zone_id` values and say
so in writing, because nothing below the application will.

**The 445 rules: NO, not from this evidence.** "All rows carry a leaked name" means the name is not
a classifier for them. A rule purge needs either ids recorded by runs that have already been
deleted, or a geometry/priority/date heuristic that is a *business* judgement about which rules an
operator would have written. Neither exists in this pass. **Nothing was deleted by this pass, and
nothing here should be read as authority to delete.**

### DEPENDENCIES

- `readAllRows` → `hydrateGeoStore` → `GeoPolicyService`: reads *all* active fences and rules at
  boot and after any local write. A purge changes every quote the platform gives and every number
  in the boot summary; that is the point — but it means the purge and the pricing verification
  belong in the same sitting, not two.
- Tests: `geo_policy_test.js`, `geo_adversarial_test.js` (CACHE-01…05, SEC-02, SEC-07),
  `test_suite.js` and `restart_test.js` (both now carry `GEO-TEARDOWN`), and
  `boot_mirror_read_test.js`, which asserts page counts of the boot read. Several hard-code
  expectations derived from a 447/445 store, so after a purge the `fencePages` / `rulePages` counts
  and any census assertion must be re-derived — or the suite fails for the wrong reason.
- `persistentStore` (`database/persistentStore.js`) mirrors state to disk and `database.js:1583`
  restores `persisted.geoFences` when non-empty — so a purge of the *database* alone does not
  necessarily clear what a memory-mode boot reads back from the local file. Both stores must be
  checked, in that order.
- Docs: the 447/445 pair is the at-rest census in at least four places
  (`GEOFENCING_SECURITY_AUDIT.md` R10, `POSTGREST_MAX_ROWS_AUDIT.md` §3/§4.2/§6,
  `proposed/028…sql` §1 and §4 step 3). A purge invalidates all of them, including the "expected"
  values in 028 §4's verification order.

### FOREIGN KEYS

**None, in either direction, on `geo_fences` or `surge_zones`** (verified this pass). So no deletion
will be blocked, no deletion will cascade, and the soft `zone_id` reference is protected by nothing
but the application. Two consequences that argue for the purge being a *single scripted operation
over both tables*: (i) an orphaned rule is silent; (ii) if the operator later re-adds a boundary it
gets a new UUID, so any surviving rule that meant the old one does not "come back" — it keeps
pointing at nothing forever.

### AUDIT IMPLICATIONS

1,494 audit rows record geo/surge actions, and **0 of them name a leaked fixture shape**. So:

- A purge does **not** falsify the existing audit narrative — no audit row will point at a row that
  no longer exists. That is the good news, and it is a direct result of the fixtures never having
  been audited in.
- The purge itself must be audited, and today nothing deletes residue: `deleteGeoFence`
  (`PricingRepository.js:442`) is the operator's delete and `GEO-TEARDOWN` is the suite's. A bulk
  purge by psql therefore writes **no audit row at all** — precisely the property that let the
  residue accumulate. If a purge happens, its record should be a durable artifact (the script, its
  output, the commit that adds it) rather than a shell history line, and the owner may reasonably
  decide that "no audit row for a bulk DELETE on the pricing input" is itself the reason to purge
  through the API in small batches instead.
- It does not touch `audit_logs` rows, and nothing in this decision licenses deleting those (§10).

### ROLLBACK PLAN

1. `pg_dump -t public.geo_fences -t public.surge_zones` (whole tables, both) before touching
   anything, taken from the local container and kept as a file outside the repository — 447 rows of
   geometry is not a large dump and there is no reason to be clever about it.
2. Run the purge inside a transaction with a `SELECT count(*)` guard before and after, and the
   expected counts written *in* the script. The pass-6 lesson generalises: an assertion that is not
   in the file is an assertion that did not happen.
3. Rollback is `TRUNCATE` + restore from that dump, or restore into a scratch database and confirm
   there before touching the working one. This is the only rollback that exists — there is no
   application-level undo, and the purge is **DML, not DDL**, so it is *not* a migration and
   `migrate.js` will not help.
4. After any restore: restart the backend, confirm the boot line reports the restored counts, then
   run `geo_policy_test.js` and `boot_mirror_read_test.js`.

**Does deletion require a migration?** **No.** It requires a data operation, which is a different
risk class: `migrate.js` records what it applied, a psql script does not. The gap worth naming is
that no mechanism in this repository records "who changed which rows, when" for a bulk DELETE — the
migration ledger covers schema, the audit table covers API writes, and this falls between them.
That is an argument for the purge being written down as a reviewed script even though it is not a
migration.

### OPEN QUESTION

> Three, and the third is the only genuinely new one:
> 1. Are the three seed boundaries (Connaught Place, Cyber City, IGI Airport) real intended data,
>    or seeded demo fixtures that should also go — leaving the store empty and honest?
> 2. Is the local Docker database ever promoted to a hosted project? If it is, 444 fictional pricing
>    boundaries move with it, and the purge is a pre-promotion requirement rather than housekeeping.
> 3. **`surge_zones` cannot be classified by name at all: 445 of 445 carry a leaked name. Who owns
>    the decision about which surge rules are real?** The technical answers available are "purge the
>    444 fences and leave the rules orphans" or "purge nothing"; both are bad, and the reason is
>    that the rules' provenance was never recorded. If nobody owns it, the honest option may be to
>    leave the residue, keep the teardown that stops it growing, and rebuild the geography from an
>    authoritative list.

---

## Decision 5 — Should the administrator sign-in read the whole `admin_accounts` table?

### CURRENT EVIDENCE

`resolveAdminByPhone` (`backend/src/database.js:5279`–`5334`) resolves a staff sign-in by
**reading the entire table and filtering in JavaScript**:

```js
const rows = await this.authoritativeRead(
  supabaseAdmin.from('admin_accounts').select('*'),
  { what: 'the administrator enrolment list' }
);
// … then, per row: this.normalizePhone(a.phone) === normPhone
const matches = this.adminUsers.filter(a => a.phone && this.normalizePhone(a.phone) === normPhone);
if (matches.length > 1) { /* ADMIN_PHONE_ENROLMENT_AMBIGUOUS — throw */ }
```

- **Max realistic table size:** this is an *operator* table, not a user table. 428 rows today
  (`POSTGREST_MAX_ROWS_AUDIT.md` §4.3; `database.js:5279` and `:6978` are the two reads that see
  it). A plausible ceiling for a platform of this shape is low thousands. So the read is **not** a
  scaling problem, and saying so matters: this decision is about correctness and credential
  handling on the authentication path, not about query performance.
- **Uniqueness on `phone`: NOT ENFORCED.** `admin_accounts` has UNIQUE on `email`, `username` and a
  PRIMARY KEY on `id` (`001_central_schema.sql:172-180`); `phone VARCHAR(20)` is **nullable, with no
  constraint and no index**. The ambiguity a normalised lookup would want to detect is therefore a
  *data* condition the database does not police, which is exactly why the code carries
  `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` — a refusal added precisely because two accounts can share a
  number. Note that it is the *count* that decides, not the first match.
- **Normalized column:** none. `phone` stores whatever was written; `normalizePhone`
  (`database.js:5194-5200`) folds to digits and applies a `+91`/`+` prefix rule in JavaScript. There
  is no generated or stored column, and nothing comparable in the schema.
- **Index:** none on `phone` (verified this pass). So today's read is a full scan either way, and
  the JS filter is doing work the database is not charged with.
- **Is a direct lookup feasible?** Yes with DDL — `normalizePhone` is a pure, deterministic digit
  fold, so an expression index or a stored generated column can hold its result. Not today, and not
  without the ambiguity rule being expressible in SQL. Without DDL a direct `.eq('phone', input)`
  lookup is feasible but **weaker**: it answers for one exact spelling of one number, so the
  `matches.length > 1` check can no longer see the second account enrolled under a different
  spelling. The refusal that protects sign-in would degrade.
- **Does it need a migration?** Any column, index or constraint change: yes (DDL, plus the backfill
  question that goes with it). A pagination-style change (Option B): no.
- **What makes this a security decision rather than a tidiness one** — three facts, each CONFIRMED
  by reading:
  1. `select('*')` on the authentication path pulls **`password_hash` and `salt`** for all 428
     accounts into the process, on every staff sign-in. `ADMIN_FEATURE_SPECIFICATION.md` §2.1
     consequence 1 is the project's own rule: "Any new admin read must be projected in code with an
     explicit column list, because nothing below will narrow it." The function *does* project its
     return value explicitly (`:5325-5333`), so the credential never leaves the process — but it is
     fetched, held in `rows`, and reachable to anything that logs or serialises the read. §2.1 item
     3 records that this repository already leaked that pair once, into 307 `backend_sessions` rows.
  2. `authoritativeRead` (`:5213-5217`) checks `error` and **never `data.length`** (Phase 9). At
     `max_rows = 1000`, a store over 1000 accounts silently returns a *page*, and the
     `matches.length > 1` ambiguity guard then compares matches *within that page*. Two accounts
     sharing a number, one of them past the cap, resolve to a single match and sign in — the one
     refusal this function exists to make is the one that fails.
  3. The same table is read at `:6995` to count active `SUPER_ADMIN`s for the
     `LAST_SUPER_ADMIN_CANNOT_BE_DISABLED` guard — also uncapped, also complete-set-dependent. That
     is Phase 9's entry, but it is this table's problem.

### SECURITY IMPACT

The cap interaction is the live one and it is **POTENTIAL** at 428 rows, not CONFIRMED: the
mechanism (silent truncation + a length-blind wrapper + a guard that counts matches) is established
by reading, and by `config.toml:8` being a number anyone can change; the consequence needs 1000+
enrolled administrators. The credential overfetch is **CONFIRMED** as behaviour and low-severity as
impact — it does not reach a response, because `withoutCredentialFields()` and the explicit return
projection are what stand between. The no-index fact is **CONFIRMED**, and it means the current
"read everything and filter" is not a shortcut around an unavailable index: there simply isn't one,
so the *shape* of the read is the only thing keeping `+9198…`, `98…` and `98-…` resolving to the
same account.

### BUSINESS IMPACT

Any option that changes which phone spellings resolve is a change to *who can log in*. That is the
risk to keep in view: a normalised-column lookup matching only the canonical form will start
refusing a legitimate operator who enrolled with `098765 43210`, and the failure will look like a
wrong password. Conversely, an exact-`phone`-equality option can turn a *refusal* into a *sign-in*
by narrowing the match set — which is the direction that matters. And because staff directories
grow slowly, whoever decides this is deciding for a table that will stay small for years, so
"correct at scale" and "correct today" carry genuinely different weights here, and only the owner
knows which one the platform is heading toward.

### OPTIONS

- **A — normalized, indexed direct lookup.** DDL: add a `phone_normalized` generated/stored column
  (or an expression index) holding `normalizePhone(phone)`'s result; backfill; then
  `.eq('phone_normalized', normPhone).limit(2)` and keep the `length > 1` → ambiguous refusal on the
  rows returned.
- **B — keyset walk using the idiom already in the repo.** Replace the read with
  `readAllRows(supabaseAdmin, { table: 'admin_accounts', … })` (`database.js:5892`), which
  paginates **and verifies** against a pre-cap `count:'exact'`, and keep the existing JS filter. No
  DDL. Also project the column list to exclude `password_hash`/`salt`.
- **C — other existing indexed approach.** Point the lookup at an index that already exists:
  username/email resolution (`:5352` already does `.eq('username').limit(2)` — the shape to copy)
  and, for phone, issue exact-equality probes for the small set of spellings a number can take
  (raw, `+91XXXXXXXXXX`, `91XXXXXXXXXX`, `XXXXXXXXXX`) and union the matches. No DDL, no full-table
  read; the ambiguity check stays meaningful *within the probed spellings*.
- **D — leave the read, close the length blind spot instead.** Change the wrapper, not the query:
  have every complete-set-dependent `authoritativeRead` site assert the count — i.e. apply
  Phase 9's answer to sites `:5282`, `:6384`, `:6390`, `:6995`. Fixes the security-relevant half of
  this decision for all four sites at once and leaves login behaviour untouched.
- **E — enforce it in the database.** A UNIQUE constraint (or partial unique index) on the
  normalized form, so `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` becomes a *provisioning* failure rather than
  a *sign-in* refusal — the option that makes the ambiguity unrepresentable, and also the one that
  can refuse to create an account the operator wants.

### PROS

- **A**: O(log n) on an index, one or two rows fetched, no credential overfetch, spellings resolved
  identically to today because the *same* function computes the key, ambiguity check intact.
- **B**: no DDL, no login-semantics change, and it removes the truncation hazard with the
  repository's own already-tested primitive — `readAllRows` is what `hydrateGeoStore` relies on, so
  there is precedent for trusting it on a hot path.
- **C**: no DDL, tiny reads, uses an existing unique index, and the multi-spelling probe keeps the
  normalisation rule in one place.
- **D**: highest security value per line, and it is the fix for the *class* (Phase 9) rather than
  for this call site; it also protects `:6995`, a guard the project treats as important.
- **E**: turns a runtime identity failure into a data-integrity guarantee; the cleanest end state.

### CONS

- **A**: DDL plus a backfill on the table that gates administration; the generated column duplicates
  `normalizePhone`'s rule in two languages, so the two can drift — and a drift here is silently a
  *login* change. It also forces the collision question immediately: what happens to a row whose
  normalized form already collides, when nothing enforces uniqueness today?
- **B**: still fetches 428 rows per sign-in (now correctly, but expensively) and still holds them in
  memory; the cap fix is pagination rather than a narrower query, so on a larger table it becomes N
  round trips per login.
- **C**: the spelling set is an enumeration, not a normalisation — a number enrolled as
  `+91-98-7654-3210` matches none of the probes, so it **can turn a valid account into an
  unfindable one**, which is a login outage; and it multiplies PostgREST round trips per login.
- **D**: does not reduce the credential overfetch or the full scan — a length check on a
  `select('*')` is still a `select('*')`.
- **E**: adding a UNIQUE where duplicates already exist **fails**, so it needs the duplicates
  resolved first — by hand, per account, by an owner who can say whether two people sharing a
  number is a mistake or two shift teams. Until then the migration cannot land. That is
  REQUIRES BUSINESS DECISION today.

### MIGRATION REQUIRED

A: yes (column or expression index + backfill; decide the duplicate story before writing it).
B: no. C: no. D: no. E: yes, and blocked on data cleanup rather than on code.
A and E both mean DDL — and the standing rule applies: **write the migration, report it, STOP
before applying it.**

### INFRASTRUCTURE REQUIRED

None for any option. All five are schema or query changes against the store already in use.

### TEST REQUIREMENTS

The auth path has its own suites, and this call site is already covered for the refusal it makes:

1. `auth_failclosed_test.js` — must still pass. It is the suite that proves an outage becomes a 503
   rather than a fallback identity, and A and C change *which* read fails, so the store-unreachable
   probe must be re-run through the new read.
2. **Ambiguity, both directions**: two accounts sharing a number in *different spellings* → refuse
   with `ADMIN_PHONE_ENROLMENT_AMBIGUOUS`; one account in one spelling → sign in normally. A and C
   need this proved across the whole spelling set `normalizePhone` accepts (`1234567890`,
   `+911234567890`, `911234567890`, separated forms), or the option has changed who can log in
   without anyone noticing.
3. **Over-the-cap**: seed `admin_accounts` past `max_rows` on a scratch database and prove the
   ambiguity guard still sees both matches. That check would fail for A as designed here, pass for
   B and D, and fail open for C — which is the sentence that should decide between them.
4. A column-list assertion: the read must not fetch `password_hash`/`salt` (extend the checks near
   `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` in the admin authorization suite rather than adding a file).
5. Full chain, because this is sign-in: `test_suite.js`, `restart_test.js`,
   `auth_failclosed_test.js`, plus the admin authorization suite.
6. E additionally needs a pre-flight query proving no normalized-phone duplicates exist, run before
   the migration is even written.

### ROLLBACK

A: revert code; dropping the generated column or index is DDL, and a backfilled column with no
writer is harmless but *not* self-deleting — say so in the migration's rollback text rather than
assuming a revert is a cleanup. B/C/D: code revert, complete. E: dropping a UNIQUE is cheap, but
the *provisioning refusals* it caused meanwhile are not undone by the revert.

### OPEN QUESTION

> Two, and the second is the blocker for E:
> 1. Should two administrator accounts ever share a phone number? The code's current answer is "if
>    they do, nobody can sign in with it" — a refusal. E's answer is "they cannot exist". Which of
>    those is the policy the platform wants?
> 2. **Do any existing `admin_accounts` rows already share a normalized phone?** If yes, E needs
>    them resolved by an owner first and A's backfill needs to know what to do about them; if no,
>    both options are much cheaper than they look. (NOT MEASURED HERE — the hosted projects were not
>    queried, and a local count of 428 rows says nothing about the hosted ones.)

---

## Decision 6 — Promotion and support-ticket reads: which need a complete set, and which need pagination?

### CURRENT EVIDENCE

These two reads are in **opposite** states, and the useful output of this decision is the
distinction between them — because "paginate everything" would fix one and damage the other.

**`GET /api/admin/promotions` → `PromotionRepository.list()` (`backend/src/repositories/PromotionRepository.js:261`)**

- **Are there endpoints?** One. `server.js:2328-2331`, gated `authenticateAdmin` +
  `requirePermission('promotion.view')`; the whole query string is forwarded, so the live params
  are `serviceType`, `status`, `activeOnly`/`isActive`, `limit`. There is no `page`/`offset`/`search`
  in the contract.
- **Builder chain** (`:263-279`): `select('*')` + optional
  `.or('service_type.eq.X,service_type.eq.ALL')` + `.eq('is_active', …)` +
  `order('created_at', desc)` + `const limit = Math.min(parseInt(filters.limit,10) || 50, 100)` →
  **already hard-capped at ≤100 rows in SQL, so `max_rows = 1000` can never truncate this read.**
  Sorting happens in SQL; there is **no** JS filtering or sorting in the live path (the non-live
  fallback `:287-294` filters memory and applies no limit).
- **Is a complete set required?** **NO — not by any consumer.**
  `admin_dashboard.html:4019-4050` renders cards with no count label, no page controls, no search
  box and no status filter; `admin-web/src/lib/api.ts:50` →
  `admin-web/src/app/campaigns/page.tsx:107` asks for `limit: '100'` purely to fill a coupon picker,
  and `components/CampaignEditor.tsx:508` looks an id up with an **explicit degraded branch at
  `:543-546`** reading `Coupon outside the loaded list` — a non-complete set is tolerated *by
  design*; tests only look up a just-created coupon and rely on newest-first
  (`test_suite.js:1662, 1680, 1903, 1970`);
  `mobile/lib/core/network/nabin_api_service.dart:870 getAdminPromotions()` has **no callers**.
- **Does the UI expect pagination?** No. The real defect is different and already written down:
  `.agents/CURRENT_STATE.md:480` records "caps at 50 rows with no total and no search" (and
  `TASKS.md:905`), with 838 promotions in the store (`POSTGREST_MAX_ROWS_AUDIT.md` §4.2 — 84% of the
  cap by count, but see above: the SQL limit is what actually binds).
- Found in the same read, unrelated but adjacent: `admin_dashboard.html:4022`
  `fetch('/api/admin/promotions')` sends **no Authorization header** while `authenticateAdmin`
  (`server.js:933-943`) requires a Bearer token, and the `catch` at `:4122` swallows the failure.
  That is a broken admin widget, not a pagination question — and it is why "the UI shows the first
  50" has never actually been observed.
- The customer-facing coupon browse is a *different* read and is already the model answer:
  `services/AppConfigService.js:287-315` uses `.limit(PUBLISHED_OFFER_LIMIT /*10*/)` **plus a
  pre-cap `count:'exact'`** and publishes `totalActive` / `truncated`.

**`GET /api/admin/support` → `SupportTicketRepository.getTicketsAdmin()` (`SupportTicketRepository.js:441`)**

- **Are there endpoints?** One. `server.js:1781-1790`, gated `authenticateAdmin` +
  `requirePermission('support.view')`, filters built as
  `{ status: req.query.status || 'ALL', category: … 'ALL', priority: … 'ALL', search: … '' }` —
  **no page or limit parameter is read at all**, and the response is
  `{ success: true, tickets, total: tickets.length }`, i.e. **the total is derived from the
  truncated array**.
- **Builder chain** (`:443-461`): `select('*')`, conditional
  `.eq('status'|'category'|'priority')`, `search` →
  `.or('ticket_number.ilike.%q%,subject.ilike.%q%,description.ilike.%q%')`,
  `order('created_at', desc)`, then `await query` — **no `.range()`, no `.limit()`, no `count`**.
  This *is* the read the 1000-row cap silently truncates.
- **Is pagination already implemented?** No, at any layer — not in SQL, not in the route, not in
  the UI.
- **Is a complete set required?** **YES, in three places**, all in `admin_dashboard.html`:
  1. `:4395-4396` `countBadge.innerText = allSupportTickets.length`, feeding the tab label
     `All Disputes (<span id="countDisputesAll">5</span>)` at `:1561` — the count *is* this array;
  2. `:4412-4421` `openSupportDisputePage` re-fetches the queue and
     `data.tickets.find(t => t.id === ticketId)`, then `if (!ticket) return alert('Ticket not
     found')` — the resolution workspace depends on membership in the returned set;
  3. the category filter, which happens **in the browser**: `:4361-4363`
     `if (currentDisputeCategoryFilter !== 'ALL') { list = list.filter(t => t.category === …); }`.
     Truncation there changes *which category tabs contain rows*, not merely which page is visible.
- **Sort/filter before or after retrieval?** Sorting before (SQL `ORDER BY created_at DESC`); status,
  category and priority before (SQL `eq`) *and* category again after (JS `filter`); `search` before
  (SQL `ilike`, unused by any UI).
- **Can these exceed `max_rows` in production?** `promotions`: no, because the SQL `limit` binds
  first — and 838/642 growth aside, the ceiling is the ≤100 window, not the cap. `support_tickets`:
  **yes** — 763 rows today = 76% of the cap, growing ~+4 per suite run
  (`POSTGREST_MAX_ROWS_AUDIT.md` §6.2), with the default filter `'ALL'` reading ~740 resolved
  tickets along the way, and no bound in the query at all.
- The consumer sends nothing: the live `loadSupportTickets` (`:4401-4411`; `:4312` is a dead
  duplicate) fetches `/api/admin/support` with only the Bearer header — no status default, no page
  size, no page controls, no search box. `admin-web` has no support screen;
  `nabin_api_service.dart:669 getAdminSupportTickets()` has no callers. So the route's `search` and
  `priority` params are used by no UI at all.
- Truncation is **partly** visible here — missing rows, a wrong badge count, a `Ticket not found`
  alert — but the "first 1000" itself is silent, and `total: tickets.length` makes the silence look
  like a fact.

**Pagination idioms already in the repository**, so a chosen option can copy a contract rather than
invent one:

| Shape | Where | Contract |
|---|---|---|
| offset + pre-cap count | `AuditLogRepository.list` `:107-158` | `limit = min(max(Number(filters.limit)\|\|100,1),500)`, `offset = max(Number(filters.offset)\|\|0,0)`, `select('*',{count:'exact'})`, `.range(offset, offset+limit-1)`, returns `{ logs, total: count !== null ? count : logs.length }`; route `server.js:1572-1584` forwards `limit`/`offset`/`search` |
| offset + count, with UI | `database.js:6755-6806 listCustomerAccounts({search,status,limit,offset})` → `{customers,total,limit,offset}` | prev/next in `admin-web/src/app/customers/page.tsx:108-114, 468-484` |
| bare offset | `OrderRepository.getOrdersByMerchant` `:428-446` `({limit=50, offset=0, status})` → `.range(offset, offset+limit-1)` | returns an array with **no total**, and the routes (`server.js:4031`, `:4067`) never pass limit/offset — this idiom is *half-built*: copy its parameter shape, not its missing total |
| complete-set walk | `database.js:5892 readAllRows(store,{table,select,pageSize=500,maxPages=40,orderDesc})` | keyset on `.order('id').gt('id',cursor).limit(pageSize)`, first page asks `{count:'exact'}`, `if (total !== null && rows.length !== total) complete = false` with a loud `⚠️ ${table} read INCOMPLETE`; already used for the promotions boot mirror at `database.js:1962` |

### SECURITY IMPACT

Low directly, with three edges worth naming:

- A truncated ticket queue is a **support-integrity** problem rather than a leak: a dispute that
  exists but is not in the newest 1000 is invisible to the agent, `Ticket not found` reads as "that
  ticket does not exist", and the SLA breach is silent. The failure mode is a customer complaint
  nobody sees, which is a trust and regulatory exposure before it is a security one.
- A wrong `total` is worse than no total, because it is believed. `AuditLogRepository` already
  returns a pre-cap count and `listCustomerAccounts` self-declares `searchCappedAt: 200`
  (`database.js:6819-6822`) — the repository's own conventions say "publish the cap", while
  `/api/admin/support` publishes a number that hides it.
- The 838 promotions are **not** exposed to `max_rows` at all (the SQL `limit` binds first), so this
  half of the decision has no truncation exposure today. Its exposure is the unlabelled newest-100
  window and, separately, an admin widget that is authenticated-wrong and silently broken.

### BUSINESS IMPACT

- **Support queue:** the dispute screen is the one screen whose *count* is a business number —
  `All Disputes (N)` is what a support lead reads as workload. Changing it to a page changes what
  that number means, and only the owner can say whether the badge should read "this page" or
  "everything". The honest fix for the badge and the honest fix for the list may be different
  mechanisms.
- **Promotions:** 838 promotions at ~+7 per suite run is a fixture-growth curve, not a real
  catalogue; the operator's actual promotion count is unknown and probably small. Paginating a
  screen whose real data fits in 50 rows is cost with no benefit — which is why "do not blindly
  paginate" is specifically right here.
- **Both:** the growth is partly self-inflicted by test residue (Decision 4's class). A pagination
  fix on a table a suite is filling is a fix that has to be re-decided every quarter; the residue
  question is upstream of this one.

### OPTIONS

**For `/api/admin/support` (the read that genuinely truncates):**

- **A1 — paginate it end to end.** Add `limit`/`offset` (and surface `search`/`priority`, which
  already exist server-side and unused), return a pre-cap `count:'exact'` as `total`, and give
  `admin_dashboard.html` prev/next — copying `AuditLogRepository.list` plus the customers-screen
  contract exactly.
- **A2 — complete-set walk.** Use `readAllRows` and keep returning everything, so the badge, the
  `find` and the JS filter all keep working unchanged; loud `⚠️ … read INCOMPLETE` if the walk
  cannot be completed.
- **A3 — fix the filters, then paginate.** Move the category filter (`:4361`) into SQL, which the
  route already supports; make the badge's count a `count:'exact'` query independent of the list;
  default the queue to *open* rather than `'ALL'` (the ~740 resolved rows are why the read is big);
  then page. Three changes, each of which shrinks the other two.
- **A4 — minimal honesty only.** Keep the read as it is and add `total` from a pre-cap count plus a
  `truncated: true` marker (the `AppConfigService.js:287-315` pattern), so the UI can say "showing
  the newest 1000 of 1,240". No UI pagination work at all.

**For `/api/admin/promotions` (the read that does not truncate):**

- **B1 — leave the query, label the window.** Return
  `{ promotions, total: <pre-cap count>, limit, truncated }` as `AppConfigService` does, so the ≤100
  newest window is visible. No UI change required, though the campaigns picker's
  `Coupon outside the loaded list` branch gets a real reason to appear.
- **B2 — give the dashboard its missing token and let it filter.** Fix `admin_dashboard.html:4022`
  to send the Bearer header (the widget is broken today), then add a search box mapping to params
  the repo already accepts. Addresses `CURRENT_STATE.md:480` without page controls nobody asked for.
- **B3 — paginate it anyway,** for symmetry with support.
- **B4 — do nothing** on the promotions side, and record that the cap cannot bind because the SQL
  limit does.

### PROS

- **A1**: matches the repo's most-used contract, makes the badge truthful per page, bounds the
  response permanently; no complete-set dependency survives to break.
- **A2**: zero UI change; removes the silent truncation this pass found; the walk is already
  written, already used for promotions at boot, and already asserts completeness.
- **A3**: the only option that makes the screen *faster and smaller* rather than merely correct;
  `openSupportDisputePage`'s `find` becomes an id fetch, which is the real fix for `Ticket not
  found`.
- **A4**: cheapest correct-ish change; `truncated` is a boolean and the repo has precedent for
  publishing it.
- **B1**: makes the 838-row reality visible without touching behaviour.
- **B2**: fixes a bug nobody has noticed (the tokenless fetch) and closes the documented gap in the
  same file.
- **B3**: one mental model for both admin queues.
- **B4**: zero risk, and defensible — the read is already bounded.

### CONS

- **A1**: **breaks the three complete-set dependencies above** unless each is changed in the same
  pass — the badge count, `openSupportDisputePage`'s `.find`, and the JS category filter all read
  the whole array today. Most work, most regression surface, of the four.
- **A2**: still returns every ticket to one screen — a growing response and growing round trips
  (40 pages × 500 today, so it holds to ~20,000 tickets); the UI keeps filtering in JavaScript, so
  the underlying oddity (an unbounded queue read for a screen that shows one category at a time) is
  deferred, not solved.
- **A3**: three coupled changes, so a regression is harder to attribute; and "default to open" is a
  visible product change — an agent searching for a resolved ticket will not find it until the
  search box that does not exist yet is built.
- **A4**: leaves the truncation *happening*; the screen still shows the newest 1000. It buys honesty
  rather than correctness, and a badge reading "1000 of 1240" on a support queue is a promise
  someone will have to keep later.
- **B1**: a `total` no UI reads is decoration; today nothing reads it.
- **B2**: scope creep into an unrelated bug during a security pass — legitimate work, but it should
  be chosen as a bug fix and not smuggled in as a mitigation.
- **B3**: adds page controls to a screen whose real dataset is small and *removes* nothing; the
  newest-first tests (`test_suite.js:1662`) still pass either way, so it costs UI for no behavioural
  change.
- **B4**: leaves `CURRENT_STATE.md:480` open, and the promotions count grows ~+7 per run, so "it
  cannot truncate" is true at 838 and needs re-checking whenever the `limit` default changes.

### MIGRATION REQUIRED

None. All of A1–A4 and B1–B4 are query and response-contract changes in repositories and UI code.

(`max_rows` lives in `supabase/config.toml:8`, and raising it is deliberately *not* offered as an
option here: it is a global knob, it does not make `total: tickets.length` honest, and it needs the
stack restarted to change. If the owner prefers it anyway, it is a config change and not a
migration, and `POSTGREST_MAX_ROWS_AUDIT.md` §5 carries the reasoning for why per-read bounds beat
a global one.)

### INFRASTRUCTURE REQUIRED

Nothing new for any option.

### TEST REQUIREMENTS

1. **A truncation assertion, not a row-count assertion.** Seed past the cap on a scratch database
   and prove the read either refuses to be incomplete (A2, per `readAllRows`'s existing
   `complete = false`, in the `boot_mirror_read_test.js` idiom) or reports it (A1/A4's `total` /
   `truncated`). `POSTGREST_MAX_ROWS_AUDIT.md` §6.2 records ~+4 tickets per suite run, so the
   *fixture* for this is the growth itself — and the standing instruction applies: **tests must not
   hide a persistence defect**, so a `support_tickets` / `promotions` teardown (the `GEO-TEARDOWN`
   pattern) is a prerequisite for a *stable* test of either, and is its own decision (Decision 4's
   class).
2. **`total` is not the array length** — assert it comes from a `count:'exact'` request, and assert
   the count is taken *before* the cap applies (`POSTGREST_MAX_ROWS_AUDIT.md` §2 establishes that
   ordering; it is why `count` is trustworthy and `data.length` is not).
3. **The three support dependencies** (badge count, `openSupportDisputePage`'s `.find`, the JS
   category filter) each need a browser walk if A1 or A3 is chosen, at the widths the admin audit
   already uses (320/375/390/430/768) — `ADMIN_PERMISSION_MATRIX.md` §7 establishes that pattern for
   `/customers` and `/security`.
4. Route-level: the `support.view` / `promotion.view` gates must stay as they are, and if B2 is
   chosen the dashboard's tokenless fetch must be proven fixed rather than silently failing again —
   assert the request carries the header.
5. Regression chain: `test_suite.js` (both domains have tests in it), `restart_test.js`, any admin
   suite touching the queues, and — because `readAllRows` may then sit on a request path rather than
   a boot path — `boot_mirror_read_test.js` extended to assert nothing regressed there.
6. **Do not paginate the promotions read in a test to make the test pass.** If B4 is chosen, the
   assertion to write is "the list is newest-first and ≤100".

### ROLLBACK

Code and UI only for every option — a revert is complete, with one exception: if A1 ships page
controls and operators start reading "All Disputes" as *this page*, the meaning of a number has
changed, and a revert restores the code but not the misunderstanding. That is an argument for
labelling (A4's marker) whichever structural option is chosen.

### OPEN QUESTION

> **What should the "All Disputes (N)" badge mean: this page, or the whole queue?** Every support
> option is downstream of that one sentence. If it must mean the whole queue, A1 needs a separate
> count read (which is A3's second change) and A2 is the only option that gets it for free; if it
> may mean the page, A1 becomes clearly cheapest.
>
> Secondary, and a product question rather than a technical one: **should the default dispute view
> be open tickets only?** Today it is `'ALL'`, which is why the read is ~740 rows of resolved
> history. Nothing in the code says that is intended; it is simply the default nobody changed.

---

## Decision 7 — What should the admin audit trail show when the store it reads is unavailable?

### CURRENT EVIDENCE

**Authoritative source:** the `audit_logs` table in the local Docker Postgres, reached through
PostgREST. Store size at rest: **~28,780 rows** (`POSTGREST_MAX_ROWS_AUDIT.md` §3).

**Mirror:** `NabinDatabase.auditLogs`, in process memory. `ADMIN_FEATURE_SPECIFICATION.md` §2.7
counts **42 audit writes** and **31 awaited sites** against it.

**Failover:** there is no second store. `database/persistentStore.js:76` mirrors state to a local
file, which is a restart aid for memory mode rather than a failover target.

**Write path.** `AuditLogRepository.create` (`backend/src/repositories/AuditLogRepository.js:42`)
is the only durable writer. In live mode it inserts and **throws** on failure:

- `:75-77` `if (error) { throw new Error(\`Failed to persist audit log in PostgreSQL: ${error.message}\`); }`
- `:81-83` appends to the memory copy **only after** a successful write — a refused write adds
  nothing (`backend/audit_drop_visibility_test.js:97` proves it).
- `Database.createAuditLog` (`database.js:2528`) wraps it with a non-swallowing logger:
  `:2534` `console.error(\`[audit] DROPPED TRAIL for ${who} on ${what}: ${err.message}\`)`.
- Two awaited-and-surfaced variants exist: `auditAppliedChange` (`database.js:2563`, which answers
  503 with `applied = true`) and `auditAuthoritative` (`:2554`).
- **20 writes are still un-awaited** — 14 in `database.js` (2043, 2647, 2719, 2865, 2995, 3334,
  4552, 4656, 7226, 7247, 7274, 7373, 7663, 7695) and 6 in `repositories/PaymentRepository.js`
  (117, 367, 404, 481, 643, 749). For those twenty, a failed audit write is a console line and
  nothing the caller can see.

**Read path.** Exactly two routes serve audit data:

- `server.js:1572 GET /api/admin/audit-logs` → `:1586-1588 db.auditLogRepo.list(filters)` →
  `{ success, logs, total }`.
- `server.js:3308` (identity detail) → `:3321 db.auditLogRepo.list({ applicationId })`.
- Both routes carry a fallback call to `db.getAuditLogs(filters)` guarded by "does the repo have
  `list`" — **dead code**, since the repo is constructed unconditionally at `database.js:1617`.
- The real switch is inside the repo: `:110 if (isLivePostgres && supabaseAdmin)` …
  `:160-161` `// Offline / non-live fallback:`
  `let list = Array.isArray(this.db?.auditLogs) ? […this.db.auditLogs] : []` (and `getById` at
  `:212`). The same predicate governs the write, at `:68`.

**Outage behaviour, live configuration** — the shipped one (`backend/.env:12`
`SUPABASE_POSTGRES_LIVE=true`): a PostgREST error → `:149-151 throw new Error('Failed to query
audit logs from PostgreSQL…')` → route catch `server.js:1593-1595` → **HTTP 500** with
`'Failed to retrieve administrative audit logs.'` It fails closed, which is the safe direction — but
as a **bare 500**, not through the platform's infrastructure-failure convention (`storeReply`/503,
`supabase.js:127`), and with **no error code**. The code `AUDIT_TRAIL_UNAVAILABLE` exists, and only
on the identity route (`server.js:3329`).

**Outage behaviour, non-live configuration:** the same URL answers from the mirror with
`total = list.length` (`:185`) and **no label** — no `dataSource`, no `degraded`. That is
inconsistent with the rest of the platform, which stamps its source (`server.js:2707`,
`server.js:5285`, `database.js:6718`, `services/AppConfigService.js:571`).

**Freshness of the mirror: one page, once.** Hydrated only inside `initPostgres`, awaited only
before `listen()` (`server.js:7914`), by
`database.js:1943-1947 .from('audit_logs').select('*').order('created_at',…)).limit(200)` merged
into the 4 seed rows at `:988` → **204 rows against a 28,780-row store: 0.7%**. There is **no
interval and no refresh** for audit (contrast geography, which re-hydrates: `database.js:2316`,
re-run at `:2385`). A row written by another process — or by this one, after boot — is absent from
the mirror except via the local `unshift` (`:82`, `:96`, `database.js:2547`). The boot summary
prints `${this.auditLogs.length} audit logs` as though it were the store size (`:2016`), and
`audit_logs` is **not** in the `partialMirrors` list (`:2009`), so **the 200-cap is never flagged.**
Consumers of the mirror are `getAuditLogs` (`database.js:2581`) and the repo reads at `:161`/`:212`;
there is no socket or live-tail consumer.

**Admin UI behaviour.** `admin_dashboard.html:3990 loadGlobalAuditLogs()` fetches
`/api/admin/audit-logs?search=…` with **no limit** → the route default `req.query.limit || 100`
(`server.js:1582`) → 100 rows rendered straight into `#globalAuditLogsBody` (`:4000
data.logs.map(…)`); the modal `openAuditLogViewer` (`:3870-3889`) does the same. **Neither reads
`data.total`** (no `total` appears anywhere in the audit UI), there are no page controls and no
source note — under the heading at `:1783-1784`:

> "Global Administrative Audit Log Trail / Immutable, tamper-resistant record of **all** compliance
> decisions…"

`admin-web/src` has **no** audit view (only copy, and `refusals.ts:48`).
`mobile/lib/core/network/nabin_api_service.dart:659` calls the endpoint from no screen. So the one
true consumer is the legacy dashboard, which shows 100 rows of a 28,780-row store and labels that
"all".

### SECURITY IMPACT

This is the decision where the answer changes what an auditor can *believe*, and the evidence
supports a specific, named false statement:

1. **Could returning mirror data present stale information as authoritative? Yes — CONFIRMED as a
   code path, conditional on configuration.** Whenever `isLivePostgres && supabaseAdmin` is false,
   the identical URL serves 204 rows (0.7% of the trail) with `total` = 204, no `dataSource`, no
   `degraded`, no cap warning. Nothing in the response distinguishes it from the store. An operator
   who asks "is there an audit record of that action?" and gets "no" concludes *the action did not
   happen* — the opposite of true. The correct conclusion is "this screen cannot see it".
2. **In the configuration as shipped, that particular lie is unreachable**, because the live
   predicate fails closed to a 500. So the honest summary is two-part: **the outage behaviour is
   safe; the non-outage fallback is unlabeled** — and the difference between them is one `.env`
   line, which is a configuration fact rather than a code guarantee. A dev-mode process, a mis-set
   flag, a `supabaseAdmin` that fails to initialise, or a future `&&` edit, and the unlabeled mirror
   is answering a compliance screen.
3. **The 500 is the wrong status class for this platform.** The project's convention separates
   infrastructure failure (503, retryable, `GEO_STORE_UNAVAILABLE` / `AUTH_STORE_UNAVAILABLE` /
   `AUDIT_TRAIL_UNAVAILABLE`) from business error (4xx); that separation was itself a hardening
   task (#46). A bare 500 with no code means a client cannot distinguish "the trail is unavailable,
   retry" from "this request is broken", and the operator cannot tell whether the record is missing
   or unreadable.
4. **"Immutable, tamper-resistant, all" is doing work the data cannot support.** The read is capped
   twice — `.limit(200)` at hydration and `limit … || 100` at the route — over a 28,780-row store,
   with `count:'exact'` available in the repository (`AuditLogRepository.list:107-158` uses it) and
   unused by the UI. A trail presented as complete that is in fact newest-100 is a **misleading
   compliance artifact**, and that is a security property of a read-only screen.
5. **Twenty un-awaited writes** mean the platform's own knowledge of whether a trail exists can be
   wrong in the direction that matters: the action proceeds, the failure is console noise, no
   durable row exists. `audit_drop_visibility_test.js` proves the *awaited* variant is loud; the
   un-awaited twenty are not covered by that claim.
6. The boot summary's `${this.auditLogs.length} audit logs` (`:2016`) is a number in an operator's
   log that is neither the store size nor a flagged partial — it is the mirror's length, printed as
   a fact.

### BUSINESS IMPACT

An audit trail's only value is that people can rely on it, so the options differ mainly in *which*
promise is kept:

- **Fail closed everywhere** (A) makes the compliance screen unusable during a store outage —
  truthful, and what an auditor wants to hear ("we cannot show you the trail; the store is down") —
  and what an on-call operator does not want, because the trail matters most when things are broken.
- **Serving the mirror with a visible marker** (B) keeps a degraded screen usable and puts the
  burden on the marker being impossible to miss: the 204-row window must say so, and the heading
  claiming "all" must stop claiming it.
- **A bounded fallback** (C) is the middle the data makes awkward: any bound *below* the store size
  is a window, and a window presented without its bound is Option B with the label deleted.
- Whatever is chosen, the dashboard's copy is a **statement to customers and auditors**, written in
  a UI file, and it has to change in the same decision. Nobody should fix a read path and leave that
  sentence standing.

One more business fact: `ADMIN_FEATURE_SPECIFICATION.md` §10 states **"No hard delete of … audit
rows"**, so the trail only grows — 28,780 rows today, and among the tables the audit pass measured
as growing with the suites. Every read bound chosen here tightens over time, and the `.limit(200)`
hydration is already 0.7% of a store that cannot shrink.

### OPTIONS

- **A — fail closed, properly.** Live: store error → **503** with code `AUDIT_TRAIL_UNAVAILABLE`
  (extend the code the identity route already emits) through the platform's `storeReply` convention.
  Non-live: do **not** answer from the mirror on a compliance route at all — 503. Delete the dead
  `getAuditLogs` fallbacks at `server.js:1591` and `:3334` so the path cannot be revived by an `&&`
  edit.
- **B — serve the mirror only with an explicit, unmissable marker.** Keep the fallback and stamp
  `dataSource: 'memory'`, `degraded: true`, the mirror's `readAt`, `mirroredRows`/`storeRows`
  counts, and the fact that hydration was `.limit(200)`; render all of it in the dashboard, change
  the heading to match, and refuse the label "all".
- **C — bounded fallback with an honest name.** Serve the mirror only as what it is — "the last 200
  events this process witnessed since boot", stated exactly that way — never "the audit trail". Add
  the missing entry to `partialMirrors` so the boot summary itself reports
  `⚠️ INCOMPLETE MIRROR(S)`.
- **D — make the mirror real instead of choosing among the above.** Give audit the treatment
  geography has: a periodic refresh (an interval, a `readAllRows`-style bounded walk,
  `partialMirrors` inclusion), so the fallback is a recent window rather than a boot-time page and
  the freshness question at least has a number attached.
- **E — make the writes match the reads.** Await the 20 remaining un-awaited audit writes (or route
  them through `auditAppliedChange` / `auditAuthoritative`), so a compliance-relevant action cannot
  be recorded only in a console and "did this get audited?" has a durable answer.
- **F — accept the current behaviour and document it.** Fail-closed-500 live / unlabeled mirror
  non-live, with the dashboard copy changed to say "newest 100 records", and no code change to the
  read path.

### PROS

- **A**: the simplest rule for an auditor — the screen either shows the store or says it cannot.
  Removes the false-complete risk entirely, and matches the `AUTH_STORE_UNAVAILABLE` precedent this
  project already accepted for authentication reads.
- **B**: keeps a degraded screen useful during an incident, when the trail matters most; the marker
  fields already exist elsewhere (`dataSource`), so it is a small, familiar change.
- **C**: no lie and no dead screen. "Last 200 events this process saw" is a true statement about a
  mirror, and it is exactly what the data is.
- **D**: makes the fallback worth having, reusing the `hydrateGeoStore` / `partialMirrors` machinery
  that exists, is tested, and already knows to say `UNREADABLE` instead of guessing.
- **E**: fixes the half of the problem that is *not* about reading at all, and every later read
  decision is easier if fewer writes can go missing. Also the smallest diff.
- **F**: zero risk of breaking an admin screen during an outage; the copy fix alone removes the
  strongest false claim.

### CONS

- **A**: an incident is exactly when the trail is wanted, and this makes it unavailable then. The
  503 must also not render as a business error — the legacy dashboard's `catch` (`:4122`-style) will
  otherwise show "no records", which is the same lie with different plumbing. And turning a 500 into
  a 503 risks a monitoring rule that alerts on 5xx counting both the same way.
- **B**: correctness now depends on a UI label, and labels rot; a marker the operator learns to
  ignore is worse than no fallback, because it manufactures confidence. And 204 of 28,780 rows is
  not a "recent window" either — it is the *oldest* 200 from boot plus this process's own writes,
  close to the least useful 204 rows the store has.
- **C**: needs the copy rewritten anyway (it is not "the audit trail"), and a bounded statement
  about a non-refreshed mirror is still a statement about a window that never moves.
- **D**: more reads against the largest table in the store, on an interval, from every process; a
  periodic refresh inherits Decision 3's caveat that a tick can be intermittent without anyone
  knowing; and a refresh that fails must not silently leave a stale mirror answering — it has to go
  to an `UNREADABLE` equivalent, or the exercise re-creates today's problem with a `readAt` on it.
- **E**: awaiting 20 writes lengthens 20 request paths, and an audit-write failure becomes a request
  failure — the correct trade for a compliance record, and still a **behaviour change on live
  routes**: a store hiccup could now surface as an error to a user doing an unrelated action.
  `auditAppliedChange` shows the project already has the right pattern (commit, report
  `applied = true`, 503 on the audit failure), so this is applying an existing answer rather than
  inventing one.
- **F**: leaves the 20 un-awaited writes and the unlabeled fallback; only the loudest sentence is
  fixed.

### MIGRATION REQUIRED

No, for all options. Every one is Express-layer (status code, marker fields, hydration, awaiting a
promise) plus a UI copy change. `ADMIN_FEATURE_SPECIFICATION.md` §2.1's decision (Express-only
enforcement, no per-request scoped tokens) means the audit layer keeps being exactly this thin, and
that is stated here because a reviewer will otherwise ask why no database-side guarantee is
proposed.

### INFRASTRUCTURE REQUIRED

D needs nothing new (a timer in-process, like the sessions reconcile tick already present). E needs
nothing. A/B/C/F need nothing. Nothing here requires Redis, a queue, or an external log sink —
though an owner who wants the trail to survive a store outage would find that answer outside A–F
entirely, and it is out of scope for this pass.

### TEST REQUIREMENTS

The relevant suites exist; these are extensions, not new files:

1. `backend/audit_drop_visibility_test.js` — currently proves a *refused* audit write adds nothing to
   memory and is visible. It must grow to cover the 20 un-awaited sites if E is chosen, otherwise
   the fix is unproven where it matters.
2. **A store-outage read probe.** With local PostgREST stopped (the chaos-audit tooling and
   `auth_failclosed_test.js` already establish the technique), assert `/api/admin/audit-logs`
   returns **503 with the named code**, not 500, and that the body cannot be mistaken for "no
   records". Then assert the identity route (`server.js:3308`) agrees — today it has the code and
   the list route does not, so that divergence is the thing to catch.
3. **A non-live probe.** Start the backend without `SUPABASE_POSTGRES_LIVE` and assert whatever
   A/B/C/F decided for that configuration — *including* A's "503 even here", the assertion most
   likely to be skipped and most likely to matter, because it is the branch where the unlabeled
   mirror answers today. (Task #74 in the history is exactly this kind of branch verification, and
   it is the precedent for writing it as a test rather than reading the code.)
4. **A marker assertion** if B/C/D: `dataSource`, `degraded`, `readAt`, and a count distinguishing
   mirrored from store size; plus the dashboard change walked in a browser at the admin widths
   (320/375/390/430/768) — a compliance label cut off at 375px is not a compliance label.
5. `boot_mirror_read_test.js` — add `audit_logs` to the mirrored-read assertions and prove
   `partialMirrors` reports it (today it is absent from the list at `:2009`).
6. A pagination-class assertion for the route: 100 requested of a larger store, `total` from a
   pre-cap `count:'exact'`, and `offset` bounded as `AuditLogRepository.list:107` already does.
7. Regression chain: `test_suite.js`, `restart_test.js` (which boots a fresh process and so is the
   one that sees hydration), `admin_authorization_test.js` (the route is gated),
   `auth_failclosed_test.js` (same fail-closed philosophy, different domain).

### ROLLBACK

A/B/C/E/F: code only; a revert restores present behaviour completely — except that under A an
operator lost their incident screen and will have to be told twice. D's refresh timer is code only,
but a mirror kept fresh makes the *revert* subtly dangerous: after D, someone may start trusting
the fallback, and a revert removes the freshness under a response that still looks identical. That
is an argument for B's marker being part of any choice that includes D.

### OPEN QUESTION

> **What is the audit trail *for*, in this platform, at this stage?**
> - If it is an internal operator aid, a labeled stale window (B/D) is plausibly better than a dead
>   screen during an incident, and the "all compliance decisions" copy is the only thing that has to
>   change.
> - If it is a compliance artifact someone may be asked to produce, it must never answer from a
>   204-row mirror without saying so in words an auditor will accept — and A becomes the only
>   defensible shape, with the outage window as the accepted cost.
> - Either way: **is a state where the trail cannot be read during an incident acceptable, or is the
>   mirror worth keeping reachable?** That single question chooses between A and B/C/D; the rest of
>   this section is context for answering it.
>
> A related sub-question the code cannot settle: should the 20 un-awaited audit writes become
> blocking (E)? It makes requests slower and makes an audit outage visible to end users, and
> `ADMIN_FEATURE_SPECIFICATION.md` §9 lists "make admin control-plane mutations await their audit
> record" as work that was *chosen* for some routes and not others — so where that boundary sits is
> an owner decision, not a defect to sweep away.

---

## Phase 9 — The `authoritativeRead` length blind spot: mechanism, exposure, and what is *not* claimed

This section is not a decision. It is the inventory the owner needs in order to make Decision 5 and
parts of Decisions 3, 6 and 7 as one change instead of four. **Nothing here was modified in this
pass**, as instructed, and it is **not fixed** here.

### What the wrapper does

`backend/src/database.js:5213-5217`:

```js
async authoritativeRead(builder, { what = 'the account record' } = {}) {
  const { data, error } = await this.settleAuthoritative(builder, what);
  if (error) throw this.authStoreUnavailable(error, what);
  return data;
}
```

`settleAuthoritative` (`:5228`) catches a client-level rejection and routes it to the same refusal.
So the wrapper's purpose is the one its own comment states: distinguish "the database is
unreachable" from "no such row", which PostgREST otherwise reports identically, and turn the first
into a 503 `AUTH_STORE_UNAVAILABLE` instead of a fallback to somebody else's seeded account.
**That half works, and it was a real fix.**

**The gap: it inspects `error` and never `data.length`.** Under `supabase/config.toml:8`
`max_rows = 1000`, a truncated read arrives as `error === null` with 1000 rows — indistinguishable,
to this wrapper, from a complete read of a 1000-row table. Every caller that treats the returned
array as *the whole set* therefore inherits a silent bound, and the name promises more than the
check delivers.

### All 14 call sites, classified (single-record vs complete-set)

| Site | Read | Single-row or SET? | Deciding line |
|---|---|---|---|
| `database.js:5282` | `admin_accounts`, whole-table `select('*')` | **SET** | `(rows‖[]).filter(…)`; `if (matches.length > 1)` → `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` (`:5291`) |
| `:5352` | `admin_accounts .eq(username).limit(2)` | ONE | `rows[0]` after a `rows.length > 1` refusal (`:5366`) |
| `:5527` | users by phone `.maybeSingle()` | ONE | — |
| `:5633` | drivers by phone `.maybeSingle()` | ONE | — |
| `:5657` | users by phone `.maybeSingle()` | ONE | — |
| `:5678` | merchants `.limit(1)` | ONE | `merchantRows[0]` (`:5692`) |
| `:6384` | `backend_sessions .in(entity_id, ids)` | **SET** | `found.push(…)` feeds the session list and its count |
| `:6390` | `backend_sessions .eq(phone)` | **SET** | same |
| `:6609` | users by id `.maybeSingle()` | ONE | — |
| `:6794` | users `ilike .limit(200)` ×3 | **SET**, *self-declares* its cap | `total: matched.length, searchCappedAt: 200` (`:6819-6822`) — the one site that documents that it can be partial |
| `:6838` | users by id `.maybeSingle()` | ONE | — |
| `:6944` | users by id/phone `.maybeSingle()` | ONE | — |
| `:6995` | `admin_accounts .select(id,username,name,email,role,is_active)` | **SET** | `activeSuperAdmins = (rows‖[]).filter(a => a.role === 'SUPER_ADMIN' && a.is_active !== false).length` (`:7013`) → `LAST_SUPER_ADMIN_CANNOT_BE_DISABLED` (`:7039`) |
| `repositories/DriverRepository.js:436` | drivers `.eq('id', targetUuid)` | ONE | `Array.isArray(rows) ? rows[0] : null` (`:440`) |

Four sites need a complete set; one of those four (`:6794`) already admits its own bound. The
remaining three are the exposure: **`:5282`** (Decision 5's ambiguity guard),
**`:6384`/`:6390`** (a session list whose count is a security statement), and **`:6995`** (the
last-super-admin guard — a *count* of a privileged role derived from an array whose length this
wrapper never checked).

`readAllRows` (`database.js:5892`) is the repository's existing answer, and it *does* check:
`if (total !== null && rows.length !== total) { complete = false; … }` (`:5952-5957`), with a loud
`⚠️ ${table} read INCOMPLETE`. It already serves the geo boot mirrors, the promotions mirror
(`:1962`) and `readAllActiveSessions`. So the fix is not missing — it is *not applied to this
wrapper's callers*.

### Can `max_rows` affect it? Is it affecting it today?

Yes, and separately: not for these reads, in this store, as far as was measured.

- The bound is configurable and small: `supabase/config.toml:8` `max_rows = 1000`.
- Counts at rest (`POSTGREST_MAX_ROWS_AUDIT.md` §3): `admin_accounts` **428**,
  `backend_sessions` **1,530–1,536**, `jobs` 1,886 — while `audit_logs` 28,780,
  `dispatch_offers` 168,354 and `notifications` 11,658 sit in domains these four reads do not
  touch.
- **`backend_sessions` is already past 1000.** That is what makes `:6384`/`:6390` the interesting
  pair: the pass-5 fix converted `reconcileSessions`' own read into a keyset walk precisely because
  `backend_sessions` held ~1,459 unexpired rows against an unbounded select
  (`ADMIN_PERMISSION_MATRIX.md` §6.7). That history is the demonstration that *this class of read on
  this table* truncates in practice on this platform. `:6384`/`:6390` are different reads of the
  same table, still going through the length-blind wrapper.

### Classification, per the order's requested labels

- **CONFIRMED** — the mechanism. `authoritativeRead` inspects `error` and not `data.length`
  (`:5213-5217`); `max_rows = 1000` truncates with `error === null` and no distinguishing header;
  `count:'exact'` is computed *before* the cap, which is why a pre-cap count is the only trustworthy
  total. All three are recorded in `POSTGREST_MAX_ROWS_AUDIT.md` §2 and re-verified this pass.
- **CONFIRMED** — four of the fourteen sites are complete-set-dependent, and one of those four
  already declares its cap while three do not.
- **POTENTIAL** — the consequences at `:5282` and `:6995`: both read `admin_accounts`, which holds
  428 rows, so no wrong answer exists in this store today. The failure needs >1000 enrolled
  administrators — a scale question, not a mechanism question. POTENTIAL rather than NOT PROVEN
  because the trigger is a known row count; not CONFIRMED because nothing was demonstrated.
- **NOT MEASURED HERE** — whether the `backend_sessions` pair at `:6384`/`:6390` has ever returned a
  page it treated as a set. The table is over the cap (1,530+) and the truncation of the
  neighbouring `reconcileSessions` read on that same table was measured and fixed in an earlier
  pass. A follow-up that probes these two moves the line to CONFIRMED or NOT REPRODUCED. Stating it
  as unmeasured is the honest position: the neighbour truncated; this pair was not probed.
- **NOT PROVEN** — any user-visible misbehaviour (a wrong sign-in, a bypassed last-super-admin
  guard) caused by this wrapper. None was produced, and none should be claimed.
- **THEORETICAL vs DEMONSTRATED**: the *truncation* is demonstrated (config value + counts + a fixed
  neighbour); the *consequence* is theoretical. This document treats the two as separate claims and
  will not merge them.
- **NOT FIXED**, as instructed.

### Why it is offered as one change with three homes

The cheapest technical answer is to the wrapper, not to the fourteen call sites — give
`authoritativeRead` an expectation (`{ expectComplete: true }`), or route the set-shaped sites
through `readAllRows`, and the class closes at once. The catch is that this is the authentication
path, where the project has already learned that a store-shaped 503 is a *feature* and a wrongly
shaped 503 is an outage: a length check that fires on a large-but-complete read turns a working
sign-in into a 503, so a fix that cannot distinguish "truncated" from "large" is worse than the bug
it cures. `readAllRows` gets that distinction from a pre-cap `count:'exact'`, which is why it is the
primitive to route through rather than a bare `data.length === 1000` test.

That is a design choice whose failure mode is a login outage, so it appears on the options list as
**Decision 5's option D** — not as a recommendation in this section.

---

## Phase 10 — Migration `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql`, statement by statement

**Status: read, reviewed, NOT applied. Not one statement in it has been executed by anyone, in this
pass or any previous one.** The file lives in `docs/proposed/`, which `backend/scripts/migrate.js:25`
does not resolve — the runner reads `supabase/migrations/` (or `MIGRATIONS_DIR`) — so the file is
unreachable by default and cannot be applied by the accident of running the migration command. That
placement is deliberate and should not change without the owner's Decision 1.

### §2 Section A — the six control-plane tables → **SAFE TO APPLY AFTER APPROVAL**

| Statement | Table(s) | Current RLS / grants (verified this pass) | Current application dependency | Security benefit if applied | Compatibility risk | Rollback | Depends on Decision 1 |
|---|---|---|---|---|---|---|---|
| `ALTER TABLE … ENABLE ROW LEVEL SECURITY` ×6 | `geo_fences`, `surge_zones`, `pricing_configurations`, `platform_settings`, `promotions`, `notification_templates` | **RLS already enabled** on all six; **not forced** on any | None — `service_role` has `BYPASSRLS` | none by itself; it is the precondition that makes the revoke mean something | **Zero** (no-op on an already-enabled table) | none needed | Yes |
| `DROP POLICY IF EXISTS p_read_active_geofences` / `p_read_active_surge_zones` / `p_read_pricing_configs` | the geo trio | exist, granted with no `TO` clause ⇒ every role incl. `anon` | None (backend is `service_role`; no client touches PostgREST) | removes the door an anonymous caller walks through | Low: it drops the *policy*, not the grant, so it does not by itself close the read | re-create verbatim from 011 §6 | Yes |
| `DROP POLICY IF EXISTS "Public read platform settings"` / `"Public view active promotions"` / `p_templates_public_read` | `platform_settings`, `promotions`, `notification_templates` | exist, same no-`TO` shape, quoted identifiers | None | as above — and dropping rather than leaving them is right for the reason the file gives: "a policy that survives its grant is a loaded gun: the next migration that re-grants SELECT reopens the read without anyone deciding to" | Low | re-create from the names quoted in §2 | Yes |
| `REVOKE ALL ON … FROM anon, authenticated` ×6 | same six | `anon` **and** `authenticated` hold `SELECT` on all six | None — CLIENT DEPENDENCY **NO** | **this is the statement that actually closes the read**; without it the six keep answering | Low for the backend (`service_role` verified: own grants + `BYPASSRLS`). It **also closes `authenticated`**, which is intended here | re-grant `SELECT` | Yes |
| `GRANT SELECT ON … TO service_role` ×6 | same six | already held | the entire backend | none — restated so the file describes intended grant state rather than being a diff | **Zero** | n/a | Yes |

**Assessment: the SQL is clean, and this review found nothing to correct in the statements.** Three
caveats, all belonging to the decision rather than to the DDL:

1. **The number is reserved for something else.** `ADMIN_FEATURE_SPECIFICATION.md` §9 item 1 records
   that "migration 028 will not be written, proposed again, or slipped into a phase" — for the
   *declined* role/permission matrix. This file reuses that number for an unrelated change, so
   applying it as 028 would silently redefine a deliberately-unused identifier. Fix before applying:
   renumber to 029 or to whatever number the owner assigns, and update §1's self-reference and §5's
   rollback text. **This is the one defect found in the file, and it is a naming defect, not a
   statement defect.**
2. **It will break a check, correctly.** `geo_adversarial_test.js` SEC-07-KNOWN-GAP asserts the anon
   read *succeeds*; after applying, it must assert the 42501 refusal. The file says so at §2 and the
   instruction is right — **and the ordering matters**: rewrite the check in the same change, so
   there is never a commit where a security suite asserts a behaviour the author meant to remove.
   *(This is the item as applied: check and DDL landed together in one uncommitted change on
   2026-09-24, the file is `supabase/migrations/029_geo_and_commerce_reads_service_role_only.sql`,
   numbered as this section asked rather than 028, and it was applied to the local Docker store only.
   `docs/proposed/028_…sql` itself was left as the historical proposal, including its 028 self-reference
   and §5 text, because editing it is the renumbering work this order excluded.)*
3. **§4's verification order is the right order and step 3 is the important one.** A `service_role`
   mistake does not show up as a successful 42501 census (step 2); it shows up as the boot line
   reporting different geography, or as `GEO_STORE_STATE.UNREADABLE` with no geographic pricing at
   all. `boot_mirror_read_test.js` (20 checks, written for exactly this) and the
   restart-before-you-believe-it rule are already in the repository; treat them as mandatory steps,
   not advice.

**What §2 explicitly does not claim, and the claim is accurate:** the file states that
`USING (is_active = TRUE)` "has never been what filtered a fence out of a quote", that Express
(`GeoPolicyService`) is that filter, and that **this section removes an information leak, not a
pricing hole.** Confirmed against the code: `service_role` bypasses RLS, so no policy has ever
gated a backend quote. Anyone reading Section A as a pricing-integrity fix has misread it —
Decision 3 (cross-instance freshness) and Decision 2 (the anonymous evaluation oracle) are the two
things that actually touch what a customer is charged.

### §3 Section B — the public storefront → **DO NOT APPLY YET**

| Content | Table(s) | Review |
|---|---|---|
| Prose only — **no executable statements** | `merchants`, `products`, `merchant_grocery_inventory`, `master_grocery_catalog`, `advertisements` | Correct as written: "whether the apps are meant to keep reading them straight from PostgREST — they currently do not — is a product decision about the storefront, not a security defect, so it is NOT made in this file." There is nothing to apply, so "DO NOT APPLY YET" describes the section's *future*, not its present SQL. |
| Recorded finding 1: `merchants` exposes `phone`, `fssai_license`, `wallet_balance` to `anon` | `merchants` | **Accurate, and independent of the open decision.** A public directory needs name/cuisine/address/photo; a counterparty's wallet balance in an unauthenticated response is not a matter of taste. The remedy it names (a column grant, not a policy) is the right *mechanism*, and the file correctly flags it "(Untested here — apply on a scratch database and confirm before relying on it.)" **That sentence must survive into whatever is applied: the `GRANT SELECT (cols…)` behaviour is unverified in this repository.** |
| Recorded finding 2: `merchant_grocery_inventory`'s `auth.uid() = merchant_id` is a merchant-app path | `merchant_grocery_inventory` | Accurate and correctly conditional ("if the merchant apps keep reading it directly") — which they do not today (Decision 1: CLIENT DEPENDENCY NO), so the premise is currently false and the conditionality is the right shape. |

Section B stays where it is: recorded, not proposed, not applied. The storefront question is
**orthogonal to Decision 1's six tables**, so approving Section A must not be read as approving or
prejudging B. If the file is renumbered, §3's text should keep a pointer back to this document.

### §1, §4, §5 — the measurement and the procedure. Two accuracy notes; no statements to review.

- §1's census matches the independent re-derivation this pass performed: the same eleven
  row-returning tables, the same nine 42501 refusals, the same `ENABLE RLS` + `REVOKE` +
  `GRANT SELECT TO service_role` pattern credited to 027 §6. One value is a range in practice: the
  file records `promotions` at **642** rows while `POSTGREST_MAX_ROWS_AUDIT.md` §4.2 records
  **838**. Both were true on different days — the table grows ~+7 per suite run (§6.2) — but a
  verification procedure that quotes an expected count should say *which* count. §4 step 2's
  expectation ("all answer 42501") is unaffected. **Documentation drift in a file that is a
  measurement record, not a defect in its SQL.**
- §1's "449 fences seen mid-run while 447 at rest" is the single most useful sentence in the file: it
  is Decision 4's residue made visible from outside the process, and it is why Decision 1 and
  Decision 4 should be decided in the same sitting.
- §4's order matches the platform's own rules (local Docker first; restart and read the boot line
  before believing a green census; the hosted test project separately; production on its own
  approval). §5's "forward-only, take a `pg_dump` and treat the restore as the rollback" is correct
  for a file containing `DROP POLICY`, and the note that a `DROP POLICY` is a schema change is the
  reason the dump is mandatory rather than merely prudent.

### Documentation-only corrections this order permits — reported, not made

The order allows editing the migration file only where a documentation correction is *required*. Two
candidates exist and **neither was made**, so the owner sees the file unaltered:

1. §1's `promotions` count (642 vs 838) — correct by stating both with dates.
2. §1's wide table cells use column-aligned spacing that wraps into a wall of text when rendered;
   cosmetic only.

The numbering collision (Section A caveat 1) is **not** a documentation correction — choosing a
number is a decision — so it is reported and left alone.

---

## Cross-decision dependencies, in one place

The seven decisions are not independent, and deciding them in the wrong order creates work:

1. **Decision 1 and Decision 4 belong to the same sitting.** The residue is what the anon read
   exposes — 449 fences seen mid-run, 444 of them fictional. Closing the read first makes the
   residue invisible from outside and easier to postpone; purging first makes the read look less
   alarming than it is.
2. **Decision 4's teardown lesson is upstream of Decision 6.** `support_tickets` (+4/run) and
   `promotions` (+7/run) are still growing for the same reason geography grew. Paginating a queue a
   suite is filling defers the same decision to next quarter.
3. **Decision 3 and §11 decision 16 are one architecture question with two subjects.** Sessions
   already document adoption-works / revocation-does-not (§9 item 6, INP-24/25/26); geography
   documents divergence in both directions (₹984 vs ₹330). Whichever mechanism is chosen — TTL,
   tick, version row, pub/sub — it should be chosen once and applied to both, because the current
   state is two half-implemented convergence stories that fail differently.
4. **Decision 5's option D *is* Phase 9.** Fixing the wrapper answers the class; fixing the call
   site answers the incident. They can be one change or two, and the choice is easier to make with
   the four set-shaped sites in hand.
5. **Decision 7's option E reduces Decision 6's stakes**, and both are compliance-shaped: an audit
   trail whose writes can be console-only is a weaker artifact than a support queue whose count is
   derived from a truncated array. If only one of the two gets fixed, the ordering matters.
6. **Decision 2 and Decision 1 share one fact and nothing else.** Both are about anonymous
   reachability, but gating `/evaluate` does nothing about the direct PostgREST read, and closing
   the read does nothing about the oracle. Neither fixes the other, and a pass that closed one while
   reporting both as handled would be a false report.
7. **Everything here inherits `ADMIN_FEATURE_SPECIFICATION.md` §2.1 / §11 answer 8** (decided
   2026-09-22): enforcement is Express-only, RLS is not a defence layer for backend traffic, and no
   per-request scoped tokens are adopted. That decision is why no option in this file proposes a
   database-side authorisation fix except Decision 1, which is about *public* reads rather than
   about admin authorisation. A reader who expects RLS to be the bottom layer here will keep
   looking; it is not, by decision and not by oversight.

---

## Decision gate summary — the seven questions, one line each

| # | The question the owner has to answer | Verdict status | Options on the table | DDL? | New infra? |
|---|---|---|---|---|---|
| 1 | May an anonymous caller keep reading geography, rate cards, flags and promotions straight from PostgREST? | exposure CONFIRMED; client dependency **NO** | A service_role-only · B authenticated-only RLS · C public view · D column grants · E keep + narrow columns | yes | no |
| 2 | Should `POST /api/geofence/evaluate` keep answering a stranger? | exposure CONFIRMED; no rate limit anywhere | A throttle · B customer/driver bearer · C admin gate · D split the route · E issued-token budget | no | A/E need a rate store |
| 3 | How does a geo write on one process reach another? | divergence CONFIRMED (₹984 vs ₹330); restart is the only invalidation | A no-cache · B TTL · C DB version/notify · D Redis pub/sub · E periodic tick · F documented restart | C only | D: yes |
| 4 | What happens to 444 residue fences and 445 unclassifiable rules? | residue CONFIRMED; leak already stopped by `GEO-TEARDOWN` | purge fences only · purge both · rebuild geography · leave it | no (DML) | no |
| 5 | Should staff sign-in keep reading all of `admin_accounts`? | mechanism CONFIRMED; consequence POTENTIAL at 428 rows | A normalized index · B `readAllRows` · C spelling probes · D fix the wrapper · E UNIQUE on normalized phone | A/E | no |
| 6 | Do promotions and support tickets need pagination? | tickets: truncation **live at 76% of cap**; promotions: **cannot truncate** (SQL limit binds) | tickets A1 paginate / A2 complete walk / A3 filter-then-page / A4 mark truncated · promotions B1 label / B2 fix the token / B3 paginate / B4 nothing | no | no |
| 7 | What may the audit screen claim when the store cannot be read? | live path fails closed but as an unlabeled 500; non-live mirror is unlabeled and 0.7% of the store | A fail closed + code · B marker · C bounded & renamed · D refresh the mirror · E await the 20 writes · F document only | no | no |

Plus the two non-decision items the order asked to be prepared rather than fixed: **Phase 9** (the
`authoritativeRead` length blind spot — 14 sites inventoried, 4 complete-set-dependent) and
**Phase 10** (migration 028 reviewed statement by statement: **Section A safe to apply after
approval**, **Section B do not apply yet**, and **it has not been applied**).

---

## Appendix A — what this pass did, and what it did not

- **Changed:** this file only.
- **Not changed:** any source file, test, migration or document other than this one.
  `docs/GEOFENCING_SECURITY_AUDIT.md`, `docs/POSTGREST_MAX_ROWS_AUDIT.md`,
  `docs/ADMIN_FEATURE_SPECIFICATION.md`, `docs/ADMIN_PERMISSION_MATRIX.md` and
  `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql` were read in full or in the
  sections cited above and left byte-identical.
- **Not applied:** any SQL. `docs/proposed/028…sql` was not copied into `supabase/migrations/`,
  `backend/scripts/migrate.js` was not run, and no DDL of any kind was executed.
- **Not deleted:** any row. Every count in this document came from a `SELECT`, a
  `pg_*`/`information_schema` view, or a document already in the repository; the database
  inspection used for Decisions 1, 4, 5 and 6 was read-only.
- **Not contacted:** the hosted test project and production. No request, no migration, no read.
- **Not pushed, not deployed, no commit made.** This pass was given no commit authority; the tree
  was left with the decision document as its only new file, for the owner to review.
- **Not chosen:** any of the seven policies. Nothing in this file should be read as "the recommended
  option", and the absence of a recommendation is the point.
- **Tests not run:** this pass executed no suite and started no backend. Several sections describe
  tests that *would* be required; none of them was run here, and no claim in this document depends
  on a run that did not happen. The pre-existing results cited are quoted from the documents that
  record them (`GEOFENCING_SECURITY_AUDIT.md` R10, `POSTGREST_MAX_ROWS_AUDIT.md` §3–§6,
  `ADMIN_PERMISSION_MATRIX.md` §7), not re-measured.

## Appendix B — the standing instructions this file was written under

Work locally only. Do not push, deploy, modify production, modify hosted test/production, apply
migrations, activate live payments, weaken tests, invent unresolved business policies, or resolve
open decisions silently. Do not apply a migration automatically: if DDL is required, report the
migration and STOP before applying it. Do not turn an intermittent observation into a confirmed root
cause. Do not add a blanket DELETE, and do not let tests hide a persistence defect. Do not
automatically paginate every query. Do not assume cache invalidation works. Geo data must never
become authoritative merely because the store failed. Do not claim a problem is fixed.

Each of those is honoured above: no DDL applied (Phase 10), no root cause asserted for the
INTERMITTENT sessions result (Decision 3), no blanket pagination (Decision 6 says explicitly that
promotions must not be paginated), no assumption that invalidation works (Decision 3's
adoption/revocation asymmetry), no silent decision (every option set ends in an OPEN QUESTION), and
no claim of a fix anywhere in the file.

---

## Appendix C — the known `bootstrap_test.js` environment failure, documented separately

The order asks that this failure be documented apart from the seven decisions, because it is not one
of them: it is a test-harness precondition that has been red on this database for several passes and
is **not** a geographic, promotional, audit-read or auth-read finding. Recording it here keeps it from
being mistaken for a new regression introduced by the work above, and keeps it from being silently
"fixed" by editing the one assertion it exists to make.

**Observed result.** `backend/bootstrap_test.js` exits 1 with exactly one failed assertion,
"Valid bootstrap succeeds (200)", and it answers 403 instead. It has been red in every run recorded in
`docs/GEOFENCING_SECURITY_AUDIT.md` (§R9 item 3, and again in the pass-6 chain table at that document's
own §"The known `bootstrap_test.js` failure"). Nothing in this pass ran it, and nothing in this pass
could have changed it.

**The mechanism, stated as a chain rather than a label.**

1. The harness tries to start from an empty administrator table:
   `backend/bootstrap_test.js:45-49` deletes every `admin_accounts` row whose `id` differs from the
   all-zero UUID.
2. That delete is refused by a foreign key. `supabase/migrations/003_extended_schema.sql:54` declares
   `assigned_admin_id UUID REFERENCES admin_accounts(id)` on `support_tickets`, which PostgreSQL
   auto-names `support_tickets_assigned_admin_id_fkey`; at least one administrator is named on at
   least one ticket, so the delete would orphan it and the whole statement is rejected. The
   repository has no file that writes this constraint name literally — it is the inline `REFERENCES`
   above producing it, so a search for the name in `supabase/migrations/` finds nothing. Read-only
   confirmation only; no constraint was inspected against the live database during this pass.
3. **The refusal is invisible to the harness.** PostgREST reports the failure as a returned
   `error` property on the builder's result, not as a rejected promise. Line 48 `await`s the call and
   discards both `data` and `error`, so the `try/catch` at line 50 — whose comment reads
   "Non-blocking if supabase is unavailable" — has nothing to catch. This is the same shape of bug the
   `authoritativeRead` work in Phase 9 is about, in a harness rather than in the server.
4. The pre-existing administrator rows therefore survive, the server boots with
   `db.adminUsers.length > 0`, and `/api/admin/bootstrap` answers its generic 403 — **which is the
   route behaving correctly.** A bootstrap endpoint that succeeded while administrators already existed
   would be the actual vulnerability.

**Verdict: CONFIRMED mechanism, NOT FIXED, and the red is the honest result.** The 403 is a correct
refusal; the defect is that a harness which intends to test the *empty* case is silently testing the
*populated* case.

**What the rest of that harness therefore does not prove.** Its later "Login with bootstrapped
credentials succeeds" and "Bootstrap permanently disabled" assertions pass, but against the
pre-existing `superadmin` rather than against a freshly bootstrapped account. Treat those two PASSes as
evidence about the disabled-after-first-admin rule, and as **no evidence at all** about the
create-first-admin path.

**Secondary precondition, unrelated to the assertion.** The harness also unlinks
`backend/data/store.json` at `backend/bootstrap_test.js:43` and spawns its own server process, so it
requires port 4000 to be free; run against a stale listener it fails for a reason that has nothing to
do with bootstrap at all.

**Not measured here.** The recorded counts differ by date and neither was re-measured during this
pass: an earlier note has 351 surviving rows and one administrator holding 723 tickets (2026-09-23),
while Decision 5 above counts **428** `admin_accounts` rows as read on 2026-09-24. What is stable
across both is the shape of the problem — at least one pinned administrator and a swallowed `error` —
not the arithmetic. Any future fix should re-count before quoting a number.

---

*End of decision gate. Seven questions, each with its evidence, options and costs, plus one
environment failure recorded on its own terms. The next move on any of them is the owner's.*
