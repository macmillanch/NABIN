# NABIN — SECURITY DECISIONS IMPLEMENTATION PLAN

**Status: PLAN ONLY. This document is the only file this task creates.** No source file, test,
migration, configuration, database row, hosted environment, commit or push was touched. Every statement
below about what a phase *would* change is a proposal to review, not a description of a change.

Source of the decisions: `docs/OWNER_SECURITY_DECISIONS.md` (ten decisions, all `STATUS: OWNER DECIDED`,
dated 2026-09-24). Supporting evidence: `docs/GEO_SECURITY_DECISION_GATE.md`,
`docs/GEOFENCING_SECURITY_AUDIT.md`, `docs/POSTGREST_MAX_ROWS_AUDIT.md`, and the unapplied
`docs/proposed/028_geo_and_commerce_reads_service_role_only.sql`.

---

## 1. Executive summary

The owner has decided ten questions. Seven of the ten can be built now against measured facts. Three
cannot be built as literally worded without a further instruction, and this plan says so at the point
where each one blocks rather than smoothing it over:

- **Decision 3** (delete residue fences plus their orphaned surge rules) was decided on an evidence
  record that says there is no foreign key protecting `surge_zones.zone_id`. There is one:
  `surge_zones_zone_id_fkey … ON DELETE CASCADE`. The consequence is favourable but different from the
  recorded risk — deleting the 444 residue fences removes 256 rules deterministically and leaves 189
  rules in place, of which **179 are duplicate active surge rows attached to a real fence**
  (`ZONE_AIRPORT_IGI_T3`). Those 179 are neither fences nor orphans, so no line of Decision 3 authorises
  touching them, and after the purge they would be the entire active surge surface for the airport zone.
  Phase 4 therefore inventories them and stops.
- **Decision 6** (allow a stale audit mirror with an explicit degraded marker) is answered `YES` for the
  admin UI, compliance and security investigation. But the repository contains **no compliance consumer
  and no security-investigation consumer of the audit API at all** — the two `YES` answers name uses
  that no code performs, and the one consumer that does exist (the admin UI) reads the list unfiltered
  and ignores everything but `data.logs`. So the marker can be built; what it must guarantee cannot be,
  until the owner says which operations count as compliance decisions. Phase 7 builds the parts that
  need no such knowledge and marks the rest BLOCKED.
- **Decision 4** (normalized indexed phone column, and uniqueness required) cannot reach the uniqueness
  step: 50 active `admin_accounts` rows share one phone value today. A UNIQUE constraint on the
  normalized form is refused by that data. Phase 5 ships the normalized column, the index and the
  credential-column fix — which are all safe and unblock nothing less — and stops at the constraint,
  because per the standing rule duplicate admin accounts are never merged, deleted or renamed
  automatically.

Two more things shape the ordering. **Decision 9** ("every complete-set read must explicitly handle
`max_rows`") is a policy, not a fix, and the code inventory says 6 reads answer security or financial
questions from a set that can silently arrive truncated — so Phase 9 is where that policy lands, and it
cannot be merged with the decision-specific phases without making each of them depend on a survey.
**Decision 7** is explicitly inventory-only, so Phase 8 produces a table, changes no behaviour, and gates
Phase 9 rather than feeding it.

The cheapest correct sequence is: lock the reads (1), split the endpoint (2), bound the cache (3), clean
the data (4), fix identity resolution (5), paginate the tickets (6), mark the mirror (7), inventory the
reads (8), then apply the policy (9). Migration numbering (10) and the RX/INP reproduction spec (11) are
independent of all nine and can run in parallel with anything.

**Nothing above is done.** Twelve phases, each with its files, its database objects, its migration
verdict, its tests, its rollback and its commit boundary, follow.

---

## 2. The owner decisions this plan implements against

| # | Area | Owner choice | Extra fields | Plan phase |
| --- | --- | --- | --- | --- |
| 1 | Anonymous geo data | **A** — revoke anon access, service-role-only backend reads | — | Phase 1 |
| 1b | `POST /api/geofence/evaluate` | **4** — split a public serviceability endpoint from privileged geo evaluation | stays public? **NO** | Phase 2 |
| 2 | Geo cache invalidation | **B** — short-TTL cache | stale window **30 s**; critical ops = fare calculation, booking creation, driver assignment, cancellation/refund calculations | Phase 3 |
| 3 | Historical geo fixtures | **C** — delete fences and the surge rules orphaned by that deletion | permission to remove orphaned `surge_zones` rows: **YES** | Phase 4 |
| 4 | Admin phone resolution | **A** — normalized, indexed phone column | unique phone required: **YES** | Phase 5 |
| 5 | Support tickets | **A** — add proper pagination and update the consumers | — | Phase 6 |
| 6 | Audit log outage | **B** — allow a stale mirror with an explicit degraded/stale marker | admin UI **YES**, compliance **YES**, security investigation **YES** | Phase 7 |
| 7 | `authoritativeRead` | **C** — inventory first, implementation later | — | Phase 8 |
| 8 | Migration 028 | **B** — renumber after checking the repository migration sequence | — | Phase 10 |
| 9 | Unbounded reads | **A** — every complete-set read must explicitly handle `max_rows` | — | Phase 9 |
| 10 | RX/INP | **C** — define a deterministic reproduction requirement first | status stays INTERMITTENT / UNRESOLVED, cause NOT PROVEN | Phase 11 |

General owner policy recorded with the ten choices, applied as a constraint on every phase below: fail
closed where incomplete authoritative data could affect pricing, authorization, booking or financial
correctness; prefer simple infrastructure before Redis or event-driven designs; never expose secrets;
never weaken tests; never make production changes without explicit owner authorization.

Two choices in the table resolve a conflict inside their own evidence, and the plan follows the measured
state rather than the document: Decision 1's "no client dependency on direct anon reads" is confirmed
(`createClient` appears only under `backend/`), and Decision 3's "no foreign key protects `zone_id`" is
**not** confirmed (there is one, and it cascades).

---

## 3. Phase 0 — baseline (measured, local Docker Supabase, 2026-09-24)

Every later phase compares against this table. A phase that cannot reproduce its own starting counts
stops and reports the difference before changing anything.

### 3.1 Git and migration sequence

| Item | Value |
| --- | --- |
| `HEAD` | `a02971e` |
| `origin/main` | `0bd03ce` — local branch **ahead 1, not pushed** |
| Last migration on disk | `supabase/migrations/027_dynamic_campaigns_and_themes.sql` |
| Next free migration number | **028** — no filename collision in `supabase/migrations/`; the collision is with `docs/ADMIN_FEATURE_SPECIFICATION.md` §9 item 1, which reserves and declines the identifier in prose |
| Migration runner | `backend/scripts/migrate.js:25` resolves `supabase/migrations/` (or `$MIGRATIONS_DIR`), so `docs/proposed/` is unreachable by design |
| Untracked at baseline | `.kilo/agents/`, `docs/GEO_SECURITY_DECISION_GATE.md`, `docs/OWNER_SECURITY_DECISIONS.md` |
| Tracked-file diff at baseline | empty, staged and unstaged |

### 3.2 Row counts

| Table | Rows | Notes |
| --- | --- | --- |
| `geo_fences` | **447** | 444 residue + 3 real |
| `surge_zones` | **445** | see 3.4 |
| `admin_accounts` | **430** | 428 was the audit figure; +2 from later runs |
| `support_tickets` | **767** | RESOLVED 749 / OPEN 9 / IN_PROGRESS 9 |
| `audit_logs` | **28,938** | 23 modules; newest 2026-09-23 20:40:10; 1,494 geo-related rows |
| `promotions` | 846 | |
| `campaigns` | 214 | |
| `backend_sessions` | 1,517 | 1,516 unexpired |
| `orders` | 1,110 | |

`supabase/config.toml` `[api] max_rows = 1000` is unchanged and stays unchanged: six of the tables above
are already past it, and the owner's position is that the keyset path — not a raised cap — is the fix.

### 3.3 The geography residue

`geo_fences` by author: System Administrator 444 (created 2026-09-05 … 2026-09-23), Devika Singhania 2,
Karan Patel 1. Name families with digits stripped:

| Family | Rows |
| --- | --- |
| `Noida IT Sector*` | 188 |
| `South Delhi Hospital Corridor*` | 185 |
| `Restart Test Aero City Zone*` | 71 |
| **total residue** | **444** |

The 3 real fences: Connaught Place CBD Boundary (`ZONE_CBD_CONNAUGHT_PLACE`), Cyber City DLF Phase 2
Corridor (`ZONE_TECH_CYBERCITY_DLF`), IGI Airport Terminal 3 Zone (`ZONE_AIRPORT_IGI_T3`).

Measured properties of the 444: **all 444 are `is_active` with `surge_multiplier > 1` and
`surcharge_amount > 0`**, and they carry only **3 distinct geometries** between them. 188 of them have no
surge rule attached. That combination is what makes them a live pricing surface rather than inert
history: an anonymous caller can read them, and the pricing engine matches against them.

### 3.4 The surge-rule linkage — the finding that changes Phase 4

`surge_zones` has **`surge_zones_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES geo_fences(id) ON DELETE
CASCADE`**, which `docs/OWNER_SECURITY_DECISIONS.md` Decision 3 records as absent. Linkage as measured:

| Linkage | Rows |
| --- | --- |
| `zone_id` IS NULL | 10 |
| `zone_id` pointing at a missing fence | **0** |
| rules on residue fences | 256 |
| rules on real fences | **179** |
| **total** | 445 |

All 179 rules on real fences are attached to the **same** fence, `ZONE_AIRPORT_IGI_T3`, with an
**identical** multiplier of 1.50, all ACTIVE, all priority HIGH, one distinct name, created across the
same 2026-09-05 … 2026-09-23 window as the residue. They are duplicate rows of one rule, not 179 rules.

Cascade arithmetic, measured rather than reasoned: deleting the 444 residue fences removes 444 fences
and 256 rules by cascade and leaves **189** rules (179 + 10). No dangling `zone_id` exists before or
after, because the FK prevents the state Decision 3 was written to permit.

### 3.5 Grants, policies and RLS

51 public tables, **all 51 have RLS enabled, 0 use `FORCE ROW LEVEL SECURITY`**. `anon` holds SELECT on
**38** tables, `authenticated` on **39**. The ten tables this plan cares about:

| Table | anon SELECT | authenticated SELECT | Policies |
| --- | --- | --- | --- |
| `geo_fences` | yes | yes | `p_read_active_geofences[SELECT for public] (is_active = true)` |
| `surge_zones` | yes | yes | `p_read_active_surge_zones[SELECT for public]` |
| `pricing_configurations` | yes | yes | `p_read_pricing_configs[SELECT for public] true` |
| `platform_settings` | yes | yes | `Public read platform settings` |
| `promotions` | yes | yes | `Public view active promotions` |
| `notification_templates` | yes | yes | `p_templates_public_read` |
| `support_tickets` | yes | yes | permissive |
| `audit_logs` | yes | yes | `Audit logs viewable by authorized admins[SELECT for public]` |
| `admin_accounts` | **no** | **no** | none — already the 027 §6 pattern |
| `campaigns` | **no** | **no** | none — already the 027 §6 pattern |

A `[for public]` policy means every role, because the originals were written with no `TO` clause. That
is the door Phase 1 closes. `admin_accounts` and `campaigns` are the proof the closing pattern works on
this database: they answer a PostgREST read with 42501.

### 3.6 `admin_accounts` identity surface

Columns: `id uuid` (`gen_random_uuid()`), `username`, `name`, `email` (both NOT NULL), **`phone` nullable
and unindexed**, `role` NOT NULL, `department`, **`password_hash`, `password_salt` NOT NULL**, `is_active`
default true, `failed_attempts`, `locked_until`, `last_login_at`, `created_at`, `updated_at`.
Constraints: primary key, `admin_accounts_email_key` UNIQUE, `admin_accounts_username_key` UNIQUE, a role
CHECK. **No index and no constraint of any kind on `phone`.**

Phone values: 380 NULL or blank; the remaining 50 rows all hold the **same** value `+91 98112 33445`, all
50 active, all created 2026-09-22 … 2026-09-23. Roles: OPERATIONS 142 (50 active), KYC_SPECIALIST 107
(50 active), SUPPORT_AGENT 90 (0 active), FINANCE_AUDITOR 90 (0 active), SUPER_ADMIN 1. Created per day:
2026-09-05 1, 2026-09-22 226, 2026-09-23 203. Emails are harness probe identities (`cust_*`, `authz_*`,
`idg_*`).

So the phone-resolution ambiguity is not hypothetical and not rare — it is 50 rows on one number, and
`resolveAdminByPhone` reads `select('*')` across all 430.

### 3.7 `support_tickets` and `audit_logs` physical shape

`support_tickets`: `id uuid` PK, `ticket_number` UNIQUE NOT NULL, `user_type`/`user_id` NOT NULL,
status/priority/category (no CHECK), `assigned_admin_id` FK → `admin_accounts`, `job_id` FK → `jobs`
ON DELETE SET NULL, `messages jsonb`, `resolution_notes`, `resolved_at`, timestamps. Indexes: PK,
`ticket_number` unique, `status`, `category`, `job_id`, `user_id` (two), `created_at DESC`. **No
composite `(created_at, id)` index** — which is what a stable keyset page needs.

`audit_logs`: `id uuid` PK; NOT NULL varchar `admin_id`, `admin_name`, `role`, `action`, `module`,
`target_entity_type`, `target_entity_id`; `previous_state`, `new_state`, `reason`, `ip_address`,
`user_agent`, `details`; `created_at timestamptz`. Indexes: PK, `action`, `admin_id`, `module`,
`created_at DESC`, `(module, action, created_at DESC)`, `(target_entity_type, target_entity_id)`.

`pricing_configurations` is keyed `(id, service_type)` — there is **no `scope` column**, contrary to one
of the gate's example queries — holds 6 rows, and its GLOBAL row carries
`global_surge_multiplier = 1.00` with `active_surge_zone = NONE`.

### 3.8 Code-side baseline that the phases are written against

- `GeoPolicyService` is the single geographic authority; store state is
  `UNREADABLE / VALIDATED_EMPTY / VALIDATED` and `describeFence` whitelists out geometry. The cache is
  hydrated at boot and after a local write only — **no TTL, no tick, no publisher**.
- Complete-set machinery already in the repo, to reuse rather than reinvent: `readAllRows`
  (`backend/src/database.js:5892-5965`, cursor hard-coded on `id`, pageSize 500, maxPages 40, returns
  `{rows, complete, error, pages}` and refuses to publish a partial set), `readAllActiveSessions`
  (`:6012-6070`, cursor `token_hash`), `AuditLogRepository.list` (limit clamp 1–500, offset,
  `count:'exact'`), `listCustomerAccounts` (`:6755-6824`, `searchCappedAt: 200`, `dataSource`,
  `degraded`).
- Degraded-marker precedent: `dataSource` + sparse `degraded:true` (`listCustomerAccounts`), and
  `stale: <bool>` (`AppConfigService`). `FeatureControlService.js:30` is the counter-example — it keeps
  serving stale with no marker at all.
- Auth gates: `authenticateAdmin` (`server.js:933-975`), `authenticateUser` (`:720`, the only session
  gate that reaches the store, via `customerSessionRefusal`), `authenticateDriver` (`:808`) and
  `authenticateMerchant` (`:860`) are **memory-only**; `requirePermission(...)` carries the RBAC.
  **There is no rate-limit or throttle primitive anywhere in the repository.**
- `authoritativeRead` / `authoritativeWrite` / `settleAuthoritative` (`database.js:5213/5220/5228`)
  convert a store failure into a 503 and **never inspect the length of what came back**. Measured scope
  is **25 call sites — 14 reads, 9 writes, 2 direct settles**, of which 7 are set-shaped and 6 answer a
  security or financial question from that set. The gate's "14 sites / 4 set-shaped" is superseded.
- `admin_dashboard.html` is a single 410,792-byte file **at the repository root**, not under
  `admin-web/src/app/`; `admin-web` has no audit view at all.
- `admin_authorization_test.js:651-661` and `:755-757` monkey-patch both authoritative wrappers, so that
  suite is blind to any change in them — Phase 8 and Phase 9 cannot be verified by it.

### 3.9 Material corrections to the audit record

1. `surge_zones.zone_id` **is** FK-protected and cascades (Decision 3's evidence says it is not).
2. The residue is not inert history: 444/444 active, 444/444 with `surge_multiplier > 1` and
   `surcharge_amount > 0`, 3 distinct geometries.
3. `admin_accounts` is 430 rows with 50 sharing one phone (documents say 428, and describe ambiguity as
   possible rather than present).
4. `authoritativeRead` scope is 25 sites / 6 complete-set-dependent (documents say 14 / 4).
5. The support-ticket and audit-log admin UI lives in repo-root `admin_dashboard.html` (documents imply
   `admin-web/src/app/…`).
6. The audit mirror's boot hydration is broken in a way no document records: `mapRowToDTO` is module
   scope at `AuditLogRepository.js:3`, so `database.js:1951` calls an undefined local and boot rows enter
   the mirror as raw snake_case — the UI renders `Invalid Date` and `'System'` for them.

A phase that needs a number from the documents and finds a different number here uses the number here and
says so in its report.

---

## Phase 1 — Lock the geographic and commerce reads to `service_role`

**1. Phase number and title.** Phase 1 — Anonymous geo data: revoke `anon`/`authenticated` access,
service-role-only backend architecture.

**2. Owner decisions implemented.** Decision 1 choice **A**, and it is the whole of it. Decision 8 choice
**B** governs the filename this phase ships as (see Phase 10): the SQL is the §2 block of
`docs/proposed/028_geo_and_commerce_reads_service_role_only.sql`, and the renumbering is settled there,
not here.

**3. Exact source files expected to change.**

| File | Change |
| --- | --- |
| `supabase/migrations/029_…sql` (new; number fixed by Phase 10) | the Section-A SQL below, verbatim from the proposed file's §2 |
| `backend/geo_adversarial_test.js` | `SEC-07-KNOWN-GAP` at `:603-608` currently asserts `anon.status === 200 && rows > 0 && withGeometry`. It becomes a check that asserts 42501 **and** that no row count is returned. This is a strengthening: the check's own text already asks for it. |
| `docs/GEOFENCING_SECURITY_AUDIT.md`, `docs/GEO_SECURITY_DECISION_GATE.md` | annotate the census rows as closed, with the measured post-application numbers. Documentation only. |

No file under `backend/src/` changes. No client changes: `createClient` / `@supabase/supabase-js` /
`supabase_flutter` appear only under `backend/`, and `admin-web`, `customer-web`,
`restaurant-merchant-web`, `grocery-merchant-web` and `mobile/` reach the platform only through the REST
API. That was re-verified at baseline, not inherited from the document.

**4. Exact database objects expected to change.** Six tables — `geo_fences`, `surge_zones`,
`pricing_configurations`, `platform_settings`, `promotions`, `notification_templates`:

- `ENABLE ROW LEVEL SECURITY` — already true on all 51 public tables, so a no-op restated for clarity.
- `DROP POLICY`: `p_read_active_geofences`, `p_read_active_surge_zones`, `p_read_pricing_configs`,
  `"Public read platform settings"`, `"Public view active promotions"`, `p_templates_public_read`. All
  six are `[SELECT for public]`, and a policy with no `TO` clause applies to every role — that is the
  mechanism the anon read travels on.
- `REVOKE ALL … FROM anon, authenticated` and `GRANT SELECT … TO service_role`, which is the pattern
  migration 027 §6 already uses and which `admin_accounts` and `campaigns` prove works (they answer 42501
  today).

**5. Migration required?** **YES.** One new file, applied to the local Docker database first.

**6. Tests to add or update.**
- Update `geo_adversarial_test.js` `SEC-07-KNOWN-GAP` to assert the refusal (above).
- Add a negative suite that is the decision's actual proof: for each of the six tables, an anonymous
  PostgREST read must fail with 42501, and `geo_fences` specifically must be unable to return
  `coordinates`, `center_lat`, `center_lng` or `radius_meters` — geometry, not just rows. One test per
  table, so a partial application cannot pass a bundle assertion.
- Add a positive check that `service_role` still reads all six (the failure mode of this phase is the
  backend blinding itself, not the anon caller).
- Extend the probe's environment guard: `:603` currently *skips* the check when
  `SUPABASE_ANON_KEY` is absent. A skip that reads as a pass is the same weakness in the other
  direction, so the new check must report a hard fail when the key is missing.

**7. Existing tests and harnesses to rerun, in this order.** Per the proposed file's §4:
`geo_policy_test.js` → `geo_adversarial_test.js` → `test_suite.js` → `restart_test.js` →
`auth_failclosed_test.js` → `session_reconcile_pagination_test.js` → `boot_mirror_read_test.js`, plus
`test_phase8_security.js` because it asserts RLS policy names directly (it targets
`support_tickets`/`notifications`, which are out of scope here, so it must stay green unchanged — a
colour change there means the migration touched more than six tables). Between the runs, restart the
backend and confirm the boot line still reports 447 fences / 445 rules: a `service_role` regression shows
up there and not in the anon census.

**8. Security invariants that must remain true.**
- After this phase no anonymous caller can read geometry. (Directly Decision 1.)
- The backend still reads every one of the six tables as `service_role`, and every route answers exactly
  as it did before.
- `supabase/config.toml` `max_rows` is untouched.
- No hosted environment is touched; local Docker only, then the hosted test project on its own approval,
  then production on a separate one.
- The `admin_accounts` / `campaigns` 42501 behaviour is unchanged — the pattern is extended, not edited.

**9. Rollback.** Forward-only file, as with 027. A `DROP POLICY` is a schema change, so the rollback is
`pg_dump` before applying and restore after; re-creating the six policies verbatim (011 §6 for the geo
trio, the quoted names for the rest) and re-granting SELECT to `anon, authenticated` is the documented
manual path if a restore is unavailable. The `SEC-07` assertion change is reverted by reverting its
commit, not by relaxing the test.

**10. Dependencies and blockers.** Numbering from Phase 10 (a naming dependency only, resolvable in the
same commit). **Section B of the proposed file is out of scope and must not be included** — the
storefront tables (`merchants`, `products`, `merchant_grocery_inventory`, `master_grocery_catalog`,
`advertisements`) were never decided, and Section B is prose rather than executable SQL anyway. One scope
note for the owner rather than an assumption by me: Decision 1 is titled "Anonymous Geo Data", but
Section A as written also locks `promotions`, `platform_settings` and `notification_templates`. Decision
8 chose renumber (B), not split (C), so this plan carries Section A as one unit; if the owner wants the
non-geo three held back, that is Decision 8's option C and it must be ordered.

**11. Can it be deployed independently?** **Yes** — it is the cleanest phase in the plan. No code path
depends on it, because no code path used the grants.

**12. Proposed commit boundary.** Two commits: (a) the migration file plus the negative tests, (b) the
`SEC-07` rewrite plus the documentation annotation, so the behaviour change and the assertion change are
separately reviewable. Actually one commit is better here: the assertion change is only correct *after*
the migration is applied to the shared database, and splitting them leaves a tree where the suite is red
for an unrelated reason. **Recommendation for the implementing order: single commit**, message naming the
six tables and recording that it was applied locally only.

---

## Phase 2 — Split the public serviceability answer from privileged geo evaluation

**1. Phase number and title.** Phase 2 — `POST /api/geofence/evaluate`: split into a public serviceability
endpoint and a privileged geo evaluation endpoint.

**2. Owner decisions implemented.** Decision 1's second question, choice **4**, and `SHOULD
/api/geofence/evaluate REMAIN PUBLIC?: NO`.

**3. Caller map, with the classification the order asks for.** `POST /api/geofence/evaluate` is at
`backend/src/server.js:2975-3006`, registered with **no middleware at all**.

| Caller | Location | Class | Sends a credential today |
| --- | --- | --- | --- |
| `evaluateDeviceGeofence()` — GPS banner | `admin_dashboard.html:5307` | **admin console, calling anonymously** | no — `Content-Type` only (`:5309`) |
| `testCoordinateGeofence()` — map click-to-test | `admin_dashboard.html:5367` | **admin console, calling anonymously** | no |
| Module-7 geo assertions | `backend/test_suite.js:507, 517, 527, 537` | test | no |
| D04/D06/D07 + outage verdict | `backend/geo_policy_test.js:449, 466, 471, 572` | test | no |
| SEC-03 oracle, CACHE-02 visibility | `backend/geo_adversarial_test.js:563, 644` | test | no |
| Flutter customer / driver / merchant | `mobile/lib/core/network/nabin_api_service.dart` — has `/pricing/estimate` `:146`, `/admin/geofences` `:896`, `/admin/surgezones` `:912`, **no evaluate call** | **none** | n/a |
| `customer-web`, `admin-web`, both merchant webs | no match for `geofence`/`evaluate`/`reverse-geocode` | **none** | n/a |

So: **zero customer callers, zero driver callers, zero merchant callers, two admin-console callers, and
three test files.** The dashboard already holds an admin bearer (`currentAdminSession.token`, used at
`:3593`, `:3708`, `:3766`, `:3994` and ~20 other sites), so both of its calls can carry one without
inventing anything. The route is publicly reachable today through `vercel.json:5-8` /
`vercel.prod.json:5-8` proxying `/api/(.*)` to the Render backend.

**4. Exact source files expected to change.**

| File | Change |
| --- | --- |
| `backend/src/server.js` | add `POST /api/geofence/check-serviceable` (anonymous, thin); put the existing `evaluate` handler behind `authenticateAdmin, requirePermission('geofence.view')` — the exact pair already on `GET /api/admin/geofences` `:2922` — or behind the audience the owner names in the clarification below |
| `backend/src/services/GeoPolicyService.js` | expose the serviceability projection (a `serviceableFor(latitude, lng, service)` answer built from `insideServiceArea` `:678` plus, if the owner wants it, `allowed_services` / `allowed_vehicles` / `operating_hours` from `describeFence`'s source columns, which the engine ignores today) |
| `admin_dashboard.html` | `:5307` and `:5367` point at the privileged route and send the bearer header |
| `backend/geo_policy_test.js`, `backend/geo_adversarial_test.js`, `backend/test_suite.js` | the 11 call sites above re-target: pricing-verdict assertions move to the privileged route with a token, serviceability assertions move to the public route |

**5. Exact database objects expected to change.** **None.** This phase is a routing and payload change.

**6. Migration required?** **NO.**

**7. Tests to add or update.**
- New negative test: an anonymous request to the privileged route gets 401 and to the
  permission-holding-but-not-admin customer/driver routes gets 403, per `geo_adversarial_test.js`
  SEC-02's existing 401-unauthenticated pattern.
- New contract test on the public route: its response contains a boolean per service (and no
  `surchargeAmount`, no `surgeMultiplier`, no `totalSurcharge`, no `effectiveSurgeMultiplier`, no zone
  list, no geometry, no `applicableSurgeRules[].window`). Assert absence of the *fields*, not just of
  coordinates — the value of the current payload is the multiplier and the ₹ figure, which is what makes
  it an oracle.
- Keep GEO-D07 (`geo_policy_test.js:471-479`) and SEC-03 (`geo_adversarial_test.js:563-571`) geometry
  assertions, applied to **both** routes.
- Keep the outage behaviour assertion: `check-serviceable` must answer 503 `GEO_STORE_UNAVAILABLE`
  rather than "not serviceable" when the store is unreadable — the existing fail-closed rule at
  `GeoPolicyService.js:538-547` ("An unreadable store is not an empty world") must not be turned into a
  silent `inside: false`.
- Rerun: `geo_policy_test.js`, `geo_adversarial_test.js`, `test_suite.js`, `restart_test.js`,
  `boot_mirror_read_test.js`.

**8. Security invariants that must remain true.**
- No anonymous caller learns geometry (unchanged from Phase 1, and this route never emitted it —
  `describeFence` at `GeoPolicyService.js:376-387` is the whitelist).
- **No unrestricted public geo pricing oracle.** This phase is where that invariant is supposed to land,
  and see the blocker below: it cannot land unless `POST /api/pricing/estimate` is addressed too.
- Fail closed: an unreadable geo store is a 503 on both halves, never a "no" and never a fare.
- No new authentication semantics: `authenticateAdmin` `:933`, `authenticateUser` `:720`,
  `authenticateDriver` `:808`, `requirePermission` `:988` are the only gates used.
- `POST /api/geofence/reverse-geocode` (`:3009`) is out of scope: it returns a locality string from
  hardcoded Delhi branches (`:3032-3059`), not pricing.

**9. Rollback.** Code-only, single revert. No schema, no rows, no config, so `git revert` is complete —
provided the dashboard calls are reverted in the same commit, or the console's map tester breaks.

**10. Dependencies and blockers.**
- After Phase 1 in sequence, though not technically dependent: Phase 1 removes the direct read, so this
  phase is what makes the remaining HTTP surface honest.
- **BLOCKED ON OWNER CLARIFICATION — the privileged half's audience.** Option 4 says split; it does not
  say who may call the evaluation half. Options 2 (customer/driver session) and 3 (admin-only) were
  separate questions and were not answered. The measured evidence points at admin-only, because the only
  real consumers are the two admin-console calls, but that is an inference about an unstated choice and
  the order forbids making it. Two sub-cases: gate on `geofence.view` (admin, matches every existing
  consumer, zero app-flow risk), or issue a customer/driver session requirement (which no caller in the
  repository satisfies today, so it would break nothing but would serve nobody either).
- **BLOCKED ON OWNER CLARIFICATION — `POST /api/pricing/estimate` is anonymous** (`server.js:3445`, no
  middleware) and returns the full `estimate`, which includes the geo surcharge for whatever
  `pickupLat/pickupLng` the body carries. Splitting `evaluate` while leaving `estimate` anonymous does not
  remove a pricing oracle; it removes one of two doors. The owner decided nothing about `estimate` — it
  was not on the checklist — so this phase must not quietly gate it either.
- **Not a blocker, recorded so it is not lost:** there is no rate-limit or throttle primitive in the
  repository (`backend/package.json` has no `express-rate-limit`, no `helmet`; the only in-process
  limiter is OTP-specific at `database.js:5379-5388`, and `ENABLE_RATE_LIMITING=true` in
  `.env.production.example:32` is read by nothing). Any option that wanted a throttle — the gate's
  option A — would be new infrastructure, which the owner's general policy ("prefer simple
  infrastructure") and this split both avoid.

**11. Can it be deployed independently?** Yes, once the audience is named. It depends on no migration and
no other phase's database state.

**12. Proposed commit boundary.** One commit: both routes + the serviceability projection + the two
dashboard call sites + the re-targeted tests. Splitting it leaves a tree where either the console is
broken or the tests are red.

---

## Phase 3 — Bound geographic staleness to 30 seconds

**1. Phase number and title.** Phase 3 — Geo cache invalidation: short-TTL cache, 30-second stale window.

**2. Owner decisions implemented.** Decision 2 choice **B**, with `STALE WINDOW: 30 seconds` and the four
named critical operations.

**3. What is there today, exactly.** The engine owns no copy: `GeoPolicyService` reads through bound
accessors (`GeoPolicyService.js:431-436`) at `fences: () => this.geoFences` / `rules: () =>
this.surgeZones` (`database.js:1641-1646`). Those two arrays are replaced by `hydrateGeoStore`
(`database.js:2318-2370`) and the freshness record is `this.geoStore = { fences, rules, source, readAt }`
(`database.js:1637-1639`).

Refresh happens at exactly these moments: boot (`:2004`), and after a local admin write through
`geoStoreChanged()` (`:2383-2392`) called from `PricingRepository.js:435` (fence create), `:485` (fence
delete), `:599` (rule create) — plus the memory-mode direct mutations at `database.js:3134`,
`:3158-3160`, `:3202`. **There is no TTL, no periodic tick, no publisher and no subscriber**: `readAt` is
written at `:2323/:2340/:2368` and read at `GeoPolicyService.js:455`, and nothing anywhere compares it
to a deadline (the only other reader is `geo_adversarial_test.js:659-661`). The nearest in-repo precedent
for what this phase adds is the session tick at `server.js:7921-7925` — `hydrateSessions()` then
`setInterval(() => db.reconcileSessions(), 15000)`.

**Cost, measured rather than estimated:** `readAllRows` is a real keyset walk (`.order('id').limit(500)`
+ `.gt('id', cursor)`, `count:'exact'` on the first page, `rows.length === total` check,
`database.js:5892-5966`), so a refresh of 447 fences and 445 rules is **one page each = two PostgREST
round-trips**, and `hydrateGeoStore` already runs both inside one shared 10 s deadline
(`:2330-2333`, `GEO_READ_TIMEOUT_MS` `:24`).

**4. Exact source files expected to change.**

| File | Change |
| --- | --- |
| `backend/src/database.js` | add the TTL bound: a `geoStoreIsStale()` helper comparing `readAt` to `GEO_STALE_WINDOW_MS = 30000`, a refresh path that is single-flight (concurrent callers await one walk, not N), and the tick following the `server.js:7921` shape |
| `backend/src/server.js` | register the interval next to the session interval; add a config/env constant for the window so it is one place |
| `backend/src/services/GeoPolicyService.js` | have `evaluate()` take an `operation` it can trust: today `operation` is only ever `'QUOTE'` or `'PUBLIC_EVALUATE'`, and the `BOOKING_CRITICAL` enum (`GeoPolicyService.js:62-65`, `isBookingCritical()` `:438-440`) is **dead code with no call site** — the natural hook for the critical-operation rule, already in the file |

**5. Exact database objects expected to change.** **None.** Purely in-process state and a timer.

**6. Migration required?** **NO.**

**7. Critical operations — the identification the order demands.** The owner named four. Measured
against the code, they are not four of one kind:

| Named critical operation | Does it consult geo policy today? | Where |
| --- | --- | --- |
| Fare calculation | **Yes** | `POST /api/pricing/estimate` `server.js:3445` → `db.calculateFareEstimate` → `database.js:2400-2416` → `geoPolicy.evaluate` `:2407` with `operation:'QUOTE'` |
| Booking creation (ride) | **Yes, and it refuses** | `server.js:3411`, coords at `:3477`, refusal at `:3486-3487` via `replyGeoRefusal` `:68-78` |
| Booking creation (parcel) | Consults, but receives **no coordinates** | `server.js:3614`, input built at `:3665-3669` ⇒ `geoStatus:'NOT_PROVIDED'`, no refusal (`database.js:2457-2471`) |
| Booking creation (food) | **No** | `server.js:3756` — no geo call at all; uses `featureControlService.requireFeature` with an `X-Location-Id` header string (`:3770-3771`) |
| Driver assignment | **No** | `POST /api/driver/offers/:offerId/accept` `:4313`, `/api/driver/accept-job` `:4369`, arrived `:4481`, complete `:4658` — none calls geo policy |
| Cancellation / refund calculation | **No** | `server.js:4832` — uses the stored fare and `cancel_ride_atomic` (`supabase/migrations/016:262`) |

So the mechanism this phase builds is: **the two operations that do consult geography (`QUOTE`, and
`PUBLIC_EVALUATE` through `evaluate`) force a refresh when `readAt` is older than 30 s, and refuse rather
than price on data they cannot validate** — i.e. force-refresh-then-decide, not bypass, because a bypass
would price on a snapshot the caller cannot bound. Concretely: `evaluate()` gains the rule that an
operation in `BOOKING_CRITICAL` (the existing dead enum, now wired) with a stale store triggers an
awaited single-flight `hydrateGeoStore('stale <window>')` before answering, and if that refresh fails or
returns incomplete, the existing `STORE_UNAVAILABLE` refusal path
(`GeoPolicyService.js:538-547` → `database.js:2460-2471` → 503 `GEO_STORE_UNAVAILABLE`) fires. The tick
is the background bound; the per-operation check is the guarantee.

**Three of the six named operations cannot be given a freshness guarantee, because they never ask
geography anything.** "Driver assignment must not use stale geo policy" and "cancellation/refund must not
use stale geo policy" are not implementable sentences against this code without a behaviour change the
owner has not ordered — making dispatch geo-aware, or making refunds re-price. **This is a required owner
clarification, not something this phase resolves**, and the parcel-no-coordinates case is the same class:
adding coordinates to parcel pricing changes what customers are charged, which is a product decision.
What Phase 3 does is make the stale window honest wherever geo is consulted, and record the four rows in
the table above as *not covered by any staleness guarantee, then and now*.

**8. Tests to add or update.**
- A two-process test, extending the shape already proven for cross-instance invalidation: instance A
  writes a fence, instance B must converge within ≤30 s + one tick, asserted by polling and measuring the
  observed bound rather than asserting a fixed number.
- A unit-level assertion that `readAt` older than the window forces exactly one refresh under N
  concurrent evaluations (single-flight), so the TTL cannot become a read amplification.
- An assertion that a stale-and-unreadable store is a 503, never a fare — the invariant the geo suite
  already protects at `geo_policy_test.js:572`.
- `geo_adversarial_test.js` CACHE-02 (`:644`, with the `readAt` check at `:659-661`) must stay green —
  it asserts a local write is visible, which the tick does not break.
- **Known blind spot to state in the report:** `admin_authorization_test.js:651-661` and `:755-757`
  monkey-patch the authoritative wrappers, so that suite cannot detect a change in the read path this
  phase touches. Verification must come from the geo suite and a live two-process run.
- Rerun: `geo_policy_test.js`, `geo_adversarial_test.js`, `test_suite.js`, `restart_test.js`,
  `auth_failclosed_test.js`, `boot_mirror_read_test.js`, then the full `test_suite.js`.

**9. Security invariants that must remain true.**
- No pricing on incomplete or unreadable geography — the tri-state
  `UNREADABLE / VALIDATED_EMPTY / VALIDATED` and the `rows.length === total` check in `readAllRows` must
  stay load-bearing; a TTL refresh that returns a partial walk must set that half `UNREADABLE`, exactly
  as `database.js:2354-2356`/`:2362-2364` do today.
- The 30 s window is a bound on *staleness*, never a licence to serve `UNREADABLE` data.
- Never raise `max_rows`; a refresh at 447/445 rows fits one page, and if it ever exceeds the cap the
  walk must report incomplete rather than price on 1000 rows.
- The memory-mode branch keeps working — and note that **no restart harness exercises it for geo**:
  `restart_test.js` proves persistence against the real tables (its own comment at `:289` says "proven
  against the real `supabase` tables, not a memory map"), so `hydrateGeoStore`'s memory branch
  (`database.js:2318-2325`, `source:'memory'`) must be covered by a new test in this phase rather than
  assumed.
- A timer must not keep the process alive on shutdown (the existing `withDeadline` timer at `:5987` is
  deliberately not unref'd — the new interval must be, or tests hang).

**10. Dependencies and blockers.** Independent of Phases 1, 2 and 4 — it touches neither grants nor rows
nor routes. **Blocker: the four uncovered critical operations above** (owner clarification). One adjacent
defect worth naming because the TTL interacts with it: `updatePricingConfig`
(`PricingRepository.js:246-253`) writes `pricingConfig.globalSurgeMultiplier` in-process and calls
**no** `geoStoreChanged`, so a global-multiplier change is invisible to the refresh logic by construction —
the 30 s tick happens to mask it, which is a reason to fix it in this phase rather than rely on the tick.

**11. Can it be deployed independently?** Yes. No migration, no schema, no client change; it is one
process's behaviour, and the second process converges by polling the same store.

**12. Proposed commit boundary.** Two commits: (a) the single-flight refresh + TTL bound + wiring
`BOOKING_CRITICAL`, (b) the `globalSurgeMultiplier` invalidation gap. The second is small and separable,
and conflating them makes (a) harder to review.

---

## Phase 4 — Remove the fixture residue, and the rules that cascade with it

**1. Phase number and title.** Phase 4 — Historical geo fixtures: inventory, classify, dependency-check,
and prepare (not execute) the deletion.

**2. Owner decisions implemented.** Decision 3 choice **C** — delete the fences *and* the surge rules
orphaned by that deletion — with `PERMISSION TO REMOVE ORPHANED surge_zones ROWS: YES`.

**3. Inventory and classification, as measured.** 447 `geo_fences` rows hold 3 real boundaries and 444
fixture rows. The three to keep, by primary key — this is the whole keep-list, and it is the part of the
plan that must be copied into any execution script:

| `id` | `zone_code` | `zone_name` | `created_by` |
| --- | --- | --- | --- |
| `102660fc-c653-4478-98b0-0399a97a87d7` | `ZONE_AIRPORT_IGI_T3` | IGI Airport Terminal 3 Zone | Devika Singhania |
| `26a87122-8db1-48bb-88ee-4bc34b2d378d` | `ZONE_CBD_CONNAUGHT_PLACE` | Connaught Place CBD Boundary | Karan Patel |
| `55f80472-b2d7-4153-9b48-542186455f56` | `ZONE_TECH_CYBERCITY_DLF` | Cyber City DLF Phase 2 Corridor | Devika Singhania |

The 444 to remove, by name family: `Noida IT Sector 62 Boundary` 188, `South Delhi Hospital Corridor`
185, `Restart Test Aero City Zone` 71. All 444 carry `created_by = 'System Administrator'` and were
created 2026-09-05 … 2026-09-23.

**A pattern-based selector is not safe here, and the measurement proves it.** Their `zone_code` values do
not follow one shape — observed forms include `ZONE_NOIDA_IT_SECTOR_62_BOUNDARY_5470`,
`ZONE_NOIDA_IT_SECTOR_62_BOUNDA_6d3ee00f` (truncated at the column width, then a hex suffix),
`ZONE_CIRC_6750_6752`, `ZONE_CIRC_E3KEIC3N`, `ZONE_CIRC_CETEFX5N_0672` and `ZONE_RST_2625_2621` alongside
`ZONE_RST_7827`. A regex covering the four families under-counted by 56 rows on the first attempt. So the
deletion set must be a **materialized list of IDs produced at execution time**, not a predicate
re-evaluated later — and `created_by = 'System Administrator'` is not a durable classifier either, since
it names an identity the backend writes rather than a property of the data.

**4. Orphans and dependency check.** `surge_zones.zone_id` is
`FOREIGN KEY … REFERENCES geo_fences(id) ON DELETE CASCADE` (`011:56`), which contradicts the evidence
field of Decision 3. Measured consequence:

| Linkage | Rows |
| --- | --- |
| rules pointing at a residue fence | 256 — removed by cascade |
| rules pointing at a real fence | 179 — all on `102660fc…` (`ZONE_AIRPORT_IGI_T3`) |
| rules with `zone_id IS NULL` | 10 — unaffected by any fence deletion |
| rules pointing at a missing fence today | 0 |
| no-rule residue fences | 188 |

No other table references a fence: a column survey across the schema found no `zone_id`, `fence_id`,
`surge_zone_id` or `zone_code` column anywhere outside `surge_zones`, and the geo audit found no
fence/order/checkout reference. `orders` (1,110 rows) stores fares, not boundary pointers, and the
`zoneId`-in-the-body door was already removed (Phase 3 of the earlier remediation,
`server.js:3092-3094` records it as "accepted only so the answer can say it was ignored").

**Before/after counts if the deletion ran as decided:** `geo_fences` 447 → **3**; `surge_zones` 445 →
**189** (179 + 10); dangling rules before 0, after 0.

**5. The gap that stops this phase from being fully executed.** The 179 rules on the IGI fence are
duplicate rows of a single rule — identical 1.50 multiplier, identical name, all ACTIVE, all priority
HIGH, created one per test run across the same 18-day window as the residue. They are residue in every
substantive sense, but Decision 3 authorises deleting **fences** and **the rules orphaned by that
deletion**. These 179 are neither: they are orphaned by nothing and survive the purge. After Phase 4 they
would be 95% of the remaining surge table and 179 identical active rules on one airport zone. **This plan
does not touch them, and does not decide they should be kept either — it records the question for the
owner**: "Decision 3 chose C. Do the 179 duplicate ACTIVE `surge_zones` rows attached to
`ZONE_AIRPORT_IGI_T3` (and the 10 `zone_id IS NULL` rows) fall inside that permission, or are they a
separate decision?" The honest reading of the chosen option is that they are outside it.

**6. Exact source files expected to change.** None, if the purge is executed as data work: this is DML,
not code. The phase's artefacts are SQL scripts under the operator's control. If the owner instead wants
a supported purge path, that is a new admin route and out of Decision 3's scope.

**7. Exact database objects expected to change.** Rows only, in two tables: 444 `geo_fences` rows and, by
cascade, 256 `surge_zones` rows. No schema object, no policy, no grant, no index.

**8. Migration required?** **NO.** Deletion is DML. That is also why there is no schema-level undo, which
is what makes the backup step mandatory rather than advisory.

**9. Tests to add or update.**
- A guard test asserting the *post-purge* real geography still prices correctly: the 3 keep-list fences
  resolve, `ZONE_AIRPORT_IGI_T3` still returns its 1.50 multiplier, and `GET /api/admin/geofences`
  reports 3.
- A guard test that the suites cannot silently re-litter: the geo fixtures in `test_suite.js` /
  `restart_test.js` already tear down (`GEO-TEARDOWN` asserts the 447/445 counts are identical across a
  run), so after the purge the same assertion must be re-baselined to 3/189 **by measuring, not by
  editing the expected number to whatever comes back**.
- `geo_policy_test.js` and `geo_adversarial_test.js` reference fence fixtures they create themselves; they
  must stay green unchanged.

**10. Existing tests and harnesses to rerun.** `geo_policy_test.js`, `geo_adversarial_test.js`,
`test_suite.js`, `restart_test.js`, `boot_mirror_read_test.js`, and a backend restart to confirm the boot
line reports the post-purge counts.

**11. Security invariants that must remain true.**
- **No deletion of legitimate geographic data.** The keep-list is three IDs and is asserted before and
  after; a mismatch aborts.
- Nothing is deleted in this planning task, and nothing in Phase 4's write-up above authorises an
  execution — the delete statements exist in the plan as reviewed text, and the owner's separate
  go-ahead is what applies them.
- The audit trail still holds its 1,494 geo rows; deleting rows does not delete their history, and none
  of the audit rows name a leaked fixture shape (already verified), so no audit rewrite is needed.
- Local Docker first; the hosted test project and production are each separately ordered, and the residue
  counts there are unknown — the plan's 444/256/179 numbers describe **this** database only.

**12. Rollback.** `pg_dump -t public.geo_fences -t public.surge_zones` immediately before the delete,
restored into a scratch schema on failure, and the two `INSERT … SELECT` statements re-run from that dump
in FK order (fences before rules). Because the cascade is what removes the rules, restoring the fences
alone would leave 256 rules missing — so the backup must cover both tables, and the restore is the
rollback, not any comment in a SQL file.

**13. Dependencies, independent deployability, commit boundary.** Depends on nothing; must run **before**
Phase 3's re-baselined cache assertions are meaningful, and before any anonymous-read comparison after
Phase 1 (the census recorded 449 fences visible to `anon` mid-suite against 447 at rest — the same leak
from the other side). Independently deployable: it is data. **Ordering constraint the owner must see: run
it after Phase 1**, so the residue stops being publicly readable while it still exists. Commit boundary:
none — a DML purge executed against a database produces no source diff; the artefact is the dump, the
materialized ID list, and the before/after counts in the pass report.

---

## Phase 5 — Normalize, index and stop full-table-reading the admin phone lookup

**1. Phase number and title.** Phase 5 — Admin phone resolution: normalized indexed column, DB-side
lookup, no credential columns on the auth path, duplicate detection without duplicate remediation.

**2. Owner decisions implemented.** Decision 4 choice **A** plus `UNIQUE PHONE: YES`.

**3. Exact source files expected to change.**

| File | Change |
| --- | --- |
| `backend/src/database.js` | `resolveAdminByPhone` `:5279-5334`: replace `select('*')` with a projected, SQL-filtered `select('id, username, name, email, phone, role, department, is_active, created_at, updated_at').eq('phone_normalized', normPhone).limit(2)`; keep the `matches.length > 1` refusal at `:5287-5291` **and** set `.status = 403` on it (today the throw carries a code but no status, so `server.js:1030-1040` renders it as HTTP 400); mirror the same change in the memory branch `:5325-5330`; normalize on write in `createAdminAccount` `:4122-4166` (today `phone: phone \|\| null` raw, with no duplicate check at all); map `phone_normalized` through the boot mirror at `:1866/:1887` |
| `supabase/migrations/031_…sql` (new; number fixed by Phase 10) | add `phone_normalized`, backfill, index it; **not** the UNIQUE constraint (see 5.4) |
| `backend/auth_failclosed_test.js` | `:162` is the only test caller of `resolveAdminByPhone`; extend it to assert the 403 and the projected column set |
| New: `backend/admin_phone_resolution_test.js` | ambiguity, single-match, and no-credential-column assertions |

**5.4-style note on shape:** the SQL-filtered `.eq(...).limit(2)` + throw-on-two pattern is already the
house pattern in this file — `authoritativeAdminByUsername` `database.js:5349-5367` does exactly it for
`username` and raises `ADMIN_USERNAME_ENROLMENT_AMBIGUOUS` with status 403. This phase copies a pattern
that exists rather than designing one.

**4. Exact database objects expected to change.**
- `admin_accounts.phone_normalized VARCHAR(20)` — new column, nullable.
- Backfill over 430 rows, of which 380 are NULL/blank and 50 share one value.
- `CREATE INDEX IF NOT EXISTS idx_admin_accounts_phone_normalized ON public.admin_accounts
  (phone_normalized)` — there is currently **no index of any kind on `admin_accounts`**, and `phone`
  itself has no index and no constraint (`001:172-188`).
- Deferred to a later migration: `CREATE UNIQUE INDEX … WHERE phone_normalized IS NOT NULL`, the
  partial-unique form the repository already uses twice (`012:74`, `016:73-75`).

**Two implementation facts the writing pass must respect.** First, `GENERATED ALWAYS AS` and
expression/functional indexes appear **nowhere** in this repository's migrations — every `CREATE INDEX`
is plain btree over a whole column — so a stored generated column would be new vocabulary; the
in-repo-consistent options are an application-written column (normalize at every write path) or a
trigger, and triggers already exist (`022:15`, `023:77/134/186`, `024:106/193`). Second, the normalizer is
`NabinDatabase.normalizePhone` `database.js:5194-5200`, which folds to digits and prefixes `+91` for a
10-digit input, and there are **two other normalizers in the codebase that do not agree with it** —
`UserRepository.normalizePhone` `:17-20` and `DriverRepository.normalizePhone` `:47-50` strip whitespace
only. This phase deliberately adopts the database-side form of `normalizePhone` and does not touch the
customer/driver paths, which is a scoped decision, not a fix to those two.

**5. Migration required?** **YES** — one, containing the column, the backfill and the index. The UNIQUE
constraint is a **second, later** migration gated on the remediation below.

**6. Tests to add or update.**
- Ambiguity: with two rows sharing a normalized number, `resolveAdminByPhone` refuses, the refusal code
  is `ADMIN_PHONE_ENROLMENT_AMBIGUOUS` and the HTTP status is now 403.
- Completeness: a fixture set larger than `max_rows` where the matching admin sits past row 1000 must
  still resolve (this is the actual security bug the phase removes — today the JS filter runs over a
  truncated `select('*')`, so the ambiguity check can pass on a set that is not the whole table).
- Privacy: assert the query's projection contains no `password_hash` / `password_salt` — provable by
  stubbing the builder and inspecting the `select` string, and by asserting `resolveAdminByPhone`'s
  returned object never carries those keys.
- Rerun: `auth_failclosed_test.js`, `admin_authorization_test.js`, `test_suite.js`, `restart_test.js`,
  `session_reconcile_pagination_test.js`, `bootstrap_test.js` (known-red for an unrelated reason — see
  Phase 9's note).

**7. Security invariants that must remain true.**
- No secret exposure: `password_hash` and `password_salt` must stop entering process memory on the
  authentication path. Today `select('*')` at `:5282-5285` fetches them for all 430 rows; the returned
  object is projected (`:5305-5322`) so the exposure is in-process, and this phase removes it.
- No unsafe admin identity ambiguity: one phone may never resolve to more than one account, and a
  truncated read may never be treated as a complete one.
- No SUPER_ADMIN creation or use changes: `server.js:1364-1379` provisions via raw upsert and is
  untouched here; `setAdminAccountStatus`'s `LAST_SUPER_ADMIN_CANNOT_BE_DISABLED` guard
  (`database.js:6995`, `:7040`) belongs to Phase 8/9, not here.
- **No automatic merge, rename or deletion of admin rows.** The 50 duplicate-phone accounts stay.
- Fail closed: an unreadable admin store still refuses (the wrapper's `AUTH_STORE_UNAVAILABLE` → 503).

**8. Rollback.** The column and index are additive: `DROP INDEX`, then `ALTER TABLE … DROP COLUMN
phone_normalized`, then revert the code commit. No row is rewritten by the backfill (it writes a new
column from `phone`), so no data restore is needed — which is the main reason the UNIQUE constraint is
held back to a separate migration.

**9. Dependencies and blockers.**
- **BLOCKED at the uniqueness step.** `UNIQUE PHONE: YES` cannot be applied while 50 active rows share
  `+919811233445` (raw `+91 98112 33445`, all created 2026-09-22 … 2026-09-23). The plan therefore ships
  the column, the index, the DB-side lookup and the credential-column fix, and delivers **duplicate
  detection plus a remediation workflow** rather than a constraint:
  1. a report query listing every `phone_normalized` with `count(*) > 1` and the accounts' ids, usernames,
     roles and `is_active`;
  2. for each group, a human decision per account — reassign to a distinct number, or deactivate —
     executed through the existing admin routes so it is audited (`createAdminAccount` and
     `setAdminAccountStatus` are the only legitimate write paths);
  3. re-run the report until it returns zero groups;
  4. only then apply the second migration adding the unique partial index.
  Step 2 is staff work on accounts the owner owns. **It cannot be ordered by this plan, and if the owner
  wants it automated, that is a new decision, because per-account identity resolution was not in the ten.
  This phase is therefore PARTIALLY BLOCKED and must be reported as such.**
- No dependency on any other phase. Independent of the ticket work; shares nothing with Phase 1.

**10. Can it be deployed independently?** The column/index/lookup half: yes. The constraint half: no, not
until remediation completes.

**11. Proposed commit boundary.** Three: (a) migration for column + backfill + index, (b)
`resolveAdminByPhone` + write-path normalization + status 403 + new tests, (c) the duplicate report query
added to whatever admin surface the owner chooses (which may be none — a SQL script is an acceptable
deliverable and keeps (c) out of the app).

---

## Phase 6 — Paginate the support-ticket reads and update their consumers

**1. Phase number and title.** Phase 6 — Support tickets: real pagination, and consumers rebuilt against
it.

**2. Owner decisions implemented.** Decision 5 choice **A** — add proper pagination and update the
consumers.

**3. Inventory of every complete-set consumer, as the order requires.**

| Consumer | Current query | Expected semantics | Strategy | Ordering / keyset |
| --- | --- | --- | --- | --- |
| `SupportTicketRepository.getTicketsAdmin` `:441` | unbounded `select('*')`, `created_at DESC`, no limit/range/count | a page, plus a truthful total | server-side limit + offset today, keyset when the index lands | needs `(created_at DESC, id)`; **that composite index does not exist** — the table has separate indexes on `status`, `category`, `job_id`, `user_id` (×2) and `created_at DESC` |
| Route `GET /api/admin/support` `server.js:2045`, gated `support.view` | returns `total: tickets.length` `:1790` | `total` = whole-store count, not page length | accept `limit`/`offset`/`status`/`category`/`priority`/`search`; report `total` from `count:'exact'`, and an explicit `dataSource` / completeness marker | — |
| `getTicketsByUser` `:350` | unbounded per-user | bounded per user | same | `user_id` is already indexed |
| Boot hydration `database.js:1905-1909` | `.limit(200)` of 767 rows into the memory mirror | must stop pretending 200 is the set | keep the mirror bounded but label it, or retire it — see the invariant below | — |
| Offline `getSupportTickets` `database.js:2663-2687` | sorts `updatedAt`, searches broader fields | must match the live ordering | align on `created_at, id` so a page means the same thing in both modes | — |
| `admin_dashboard.html` `loadSupportTickets:4399` (+ shadowed duplicate `:4310`, render `:4376`) | fetch-all | page + total | send `limit`/`offset`, render the server's `total` | — |
| … category filter `:4343-4363` | filters in JS over the fetched array | filter in SQL | pass `category` to the route (its index exists) | — |
| … status badge `:4395-4396`, hardcoded `5` at `:1561` | counts the fetched array | per-status counts | either `count:'exact'` with `status=` per badge, or a small counts endpoint | — |
| `openSupportDisputePage` `:4412-4420` | re-fetches the entire list and `find`s by id → `alert('Ticket not found')` | fetch one ticket | **`getTicketById` `:396` already exists and is unwired** — add `GET /api/admin/support/:id` on the same `support.view` gate and call it | — |
| `NEW_SUPPORT_TICKET` websocket handler | none exists | refresh the visible page | unchanged semantics, page-aware | — |

**4. Exact source files expected to change.**
`backend/src/repositories/SupportTicketRepository.js` (`:350`, `:396`, `:441`),
`backend/src/server.js` (`:1781`, plus a new by-id route), `backend/src/database.js` (the `.limit(200)`
hydration at `:1905-1909` and the offline path at `:2663-2687`), `admin_dashboard.html` (`:4310`, `:4343`,
`:4376`, `:4395`, `:4399`, `:4412-4420`, `:1561`, `:4975`), and a new migration for the composite index.

**5. Exact database objects expected to change.** One index: `CREATE INDEX IF NOT EXISTS
idx_support_tickets_created_id ON public.support_tickets (created_at DESC, id)`. No column, no policy, no
grant change. (`support_tickets` currently grants `anon`/`authenticated` SELECT with permissive policies;
the anon census showed it returns **zero rows** to an anonymous caller, so the predicate — not the grant —
is what protects it. That is not this phase's business, and is noted for the record.)

**6. Migration required?** **YES**, one, index-only — and it is required only if the pages are keyset. A
limit/offset design would not need it, which is the trade-off to state in the implementing order rather
than decide silently here: offset pagination is simpler and already the house pattern
(`AuditLogRepository.list` `:106` clamps 1–500 with offset and `count:'exact'`), while keyset is what the
row-cap lesson points at. **The plan proposes limit/offset + `count:'exact'` + a completeness marker as
step 1 (matching the existing precedent, and enough to make `total` honest), with the composite index and
keyset as step 2 if deep pages are ever used.**

**7. Tests to add or update.**
- A row-cap test in the shape of `session_reconcile_pagination_test.js`: seed > 1,000 tickets, request a
  page, assert `total` equals the store's exact count and not the page length, and assert the response
  flags incompleteness rather than returning a short set silently.
- By-id route test (wiring `getTicketById`), including the 404 and the `support.view` gate.
- Update: `test_suite.js:192-263` and `:1333-1460`, `admin_authorization_test.js:220-222`, `:463-465`,
  `:624-627` (they assert 200s on the admin list route, so a response-shape change must land with them),
  and `test_phase8_security.js:191-227` (it asserts the `support_tickets` policy names
  `p_admin_select_support_tickets` / `p_admin_update_support_tickets` — this phase must leave them intact,
  so a red there means an accidental policy touch).

**8. Security invariants that must remain true.**
- No silent PostgREST truncation for a complete-set read: `total` must never again be `tickets.length`
  when the underlying read was capped, and a truncated read must be labelled as one.
- Never raise `max_rows = 1000`.
- The gate stays `support.view`; a by-id route is at least as gated as the list.
- No ticket rows are deleted or mutated; this phase changes reads only.
- The live and offline modes answer the same page of the same query — a consumer must not be able to see
  two different "first 50" depending on `dataSource`.

**9. Rollback.** Code revert plus `DROP INDEX` for the composite index if it was added. No data touched,
so no restore.

**10. Dependencies and blockers.** Independent of Phases 1–5. Interacts with Phase 9 (the
complete-set policy) — `getTicketsAdmin` is one of the reads that policy will cover, so the pagination
design must be the answer Phase 9 records for it, not a second opinion. **No blocker**: the three
complete-set semantics are all resolvable with existing primitives (`count:'exact'`, `getTicketById`, SQL
`category` filter).

**11. Can it be deployed independently?** Yes.

**12. Proposed commit boundary.** Two: (a) repository + route pagination and the by-id route with tests,
(b) the dashboard consumers and the badge/filter/dispute-page rework. They can ship apart because (a)
keeps answering an unparameterized request exactly as it does now.

---

## Phase 7 — Make the audit mirror honest: a stale marker, and the defects under it

**1. Phase number and title.** Phase 7 — Audit log outage behaviour: explicit degraded/stale marking of
the mirror, plus the ordering and hydration defects that make today's marker impossible.

**2. Owner decisions implemented.** Decision 6 choice **B** — allow a stale mirror with an explicit
degraded/stale marker — with `ADMIN UI: YES`, `COMPLIANCE: YES`, `SECURITY INVESTIGATION: YES`.

**3. What the code does today, line by line.**

| Fact | Location |
| --- | --- |
| `create` **throws** on a failed store write, and only then inserts into the mirror | `AuditLogRepository.js:75-77` throw, `:81-83` mirror `unshift` — so the mirror can hold records the authoritative store rejected, and can miss records the store accepted after a slow write |
| the mirror is unbounded | `db.auditLogs`, no capacity ceiling |
| `list()` returns `{logs,total}`; live total is an exact count, offline total is `list.length` | `:106`, `:113`/`:156`, `:185` — an offline `total` is therefore the length of a 200-row mirror presented as the whole |
| **no `dataSource`, no `degraded`, no `stale`, no `readAt` anywhere in the audit path** | verified by grep — the marker the owner asked for does not exist in any form |
| boot hydration is `.limit(200)` **once**, against ~28,938 rows, and its error is swallowed | `database.js:1942-1959`, `audErr` ignored at `:1949`; `partialMirrors` at `:2009-2011` **excludes audit**, so an incomplete audit mirror is never named |
| 4 fabricated seed rows sit in the mirror and are never cleared | `database.js:987-1004` |
| hydration maps rows through a name that is out of scope | `mapRowToDTO` is module-scope at `AuditLogRepository.js:3`, so the lookup at `database.js:1951` is undefined and boot rows enter the mirror as raw snake_case — the UI shows `Invalid Date` and `'System'` |
| 20 audit writes are not awaited | `database.js:2043, 2647, 2719, 2865, 2995, 3334, 4552, 4656, 7226, 7247, 7274, 7373, 7663, 7695` and `PaymentRepository.js:117, 367, 404, 481, 642→643, 748→749` |
| two read routes disagree on outage | R1 `server.js:1572` → bare 500 `:1593-1596`; R2 `:3308` → 503 `AUDIT_TRAIL_UNAVAILABLE` `:3327-3331`; both carry unreachable `getAuditLogs` fallbacks (`:1591`, `:3334`) |
| the only consumers | TAB 9 `admin_dashboard.html:1741-1815` (copy at `:1784` claims an "Immutable, tamper-resistant record of all compliance decisions"), `loadGlobalAuditLogs:3990-4015` reads `data.logs` and nothing else, with `catch (e) {}` at `:4014`, no pagination and one search filter; the KYC modal `:2379-2410`/`:3870-3892` calls **R1 unfiltered**. `admin-web` has no audit view; `mobile/lib/core/network/nabin_api_service.dart:656` is defined and never called |

**4. Exact source files expected to change.**
`backend/src/repositories/AuditLogRepository.js` (ordering of store-write vs mirror-write; the marker on
`list()`), `backend/src/database.js` (hydration via keyset instead of `.limit(200)`, stop swallowing
`audErr`, include audit in `partialMirrors`, fix the `mapRowToDTO` scope bug, dispose of the 4 seed rows),
`backend/src/server.js` (R1 and R2 return the same contract; delete the unreachable fallbacks),
`backend/src/repositories/PaymentRepository.js` (the 6 un-awaited writes there are financial),
`admin_dashboard.html` (`:3990-4015` render the marker and stop the empty `catch`; `:1784` copy reduced to
what is actually held), and `backend/boot_mirror_read_test.js` (see 7).

**5. Exact database objects expected to change.** **None.** `audit_logs` already holds 28,938 rows with
the indexes a bounded query needs (`created_at DESC`, `(module, action, created_at DESC)`,
`(target_entity_type, target_entity_id)`). No migration.

**6. Migration required?** **NO.**

**7. Tests to add or update.**
- `boot_mirror_read_test.js` currently covers **geo only** — no test asserts anything about the audit
  `.limit(200)` hydration, which is why this has stayed broken. Extend it to audit, asserting that a store
  with more rows than the page size yields a mirror that is labelled incomplete.
- A new outage test: with the store unreachable, both routes answer the same status and code, the payload
  carries `dataSource` and a staleness marker, and `total` is never a mirror length.
- A mirror-vs-store test: a rejected store write must not appear as an accepted audit record (the
  `:75-77` / `:81-83` ordering), and the fix must be visible from `list()`.
- Rerun: `test_suite.js`, `restart_test.js`, `auth_failclosed_test.js`, `test_phase8_security.js` (its
  GROUP 6 trigger assertions cover `audit_logs` triggers).

**8. Security invariants that must remain true.**
- **No false claim that bounded mirror data is complete** — this phase exists to enforce that invariant,
  and the `:1784` copy is part of the claim surface.
- Fail closed where incomplete data could affect authorization, booking or financial correctness (the
  owner's general policy) — which is the exact tension with `COMPLIANCE: YES`, addressed below.
- Audit records are immutable: no phase here updates or deletes an `audit_logs` row. The 4 fabricated seed
  rows in the **mirror** are a different object from the store's rows, and their disposition is still an
  owner question (see 10).
- Secrets: `previous_state` / `new_state` / `details` must not start carrying credentials as a side effect
  of routing more writes through the repository.
- Never weaken a test: `test_phase8_security.js` assertions on triggers must stay green unchanged.

**9. Rollback.** Code-only, per-file reverts; nothing to restore in the database because no row or schema
object changes. If the hydration switch to keyset is reverted, the mirror goes back to 200 rows — which is
why the marker must ship **before or with** the hydration change, never after.

**10. Dependencies, blockers and the required owner clarifications.** Depends on nothing else; Phase 9
should follow it because the audit `list()` becomes a worked example of the completeness rule.
**Decision 6 as recorded cannot be fully implemented, for a specific reason**: the owner answered `YES` to
`COMPLIANCE` and `SECURITY INVESTIGATION`, but the repository has **no compliance consumer and no
security-investigation consumer of the audit API** — the only consumer is the admin UI, and the KYC modal
hits R1 unfiltered. So there is nothing for those two answers to govern, and no code that could honour
them. Marking a mirror stale does not make it sufficient for compliance: 200 hydrated rows out of 28,938
is 0.7% of the record. Therefore:

| Item | Status |
| --- | --- |
| Marker (`dataSource` + `stale`/`degraded` + truthful `total`), ordering fix, hydration fix, scope bug, route unification, UI honesty | **BUILDABLE NOW** |
| Which of the three existing marker shapes to adopt (`dataSource`+`degraded` per `listCustomerAccounts`, `stale` per `AppConfigService`, or the geo `readAt`+state enum) | implementation choice, **recommend the `listCustomerAccounts` shape for consistency**, recorded not decided |
| R1's bare 500 vs R2's coded 503 — which wins | **OWNER CLARIFICATION** (a contract change for the KYC modal either way) |
| Disposition of the 4 fabricated seed mirror rows (delete at boot / mark as synthetic / move behind a flag) | **OWNER CLARIFICATION** — they are presented as real audit history today |
| Which of the 20 un-awaited writes are compliance- or financially-relevant and must be awaited | **OWNER CLARIFICATION**; the 6 in `PaymentRepository` are the obvious subset, and "obvious" is not a decision |
| Whether `COMPLIANCE: YES` means "a labelled partial mirror may be relied on for compliance" or "compliance reads must fail closed during an outage" | **BLOCKED** — the two readings produce different code, and the owner's general policy ("fail closed where incomplete authoritative data could affect … financial correctness") points the second way while Decision 6 B points the first. **Not resolved in this plan.** |
| Whether the mirror gets a capacity bound (it is unbounded today) | implementation detail, flag it in the pass report |

**11. Can it be deployed independently?** Yes for the buildable set. The BLOCKED row above is not a
deployment blocker, it is a scope limit.

**12. Proposed commit boundary.** Three: (a) repository ordering + marker + truthful `total`, (b) boot
hydration keyset + scope fix + `partialMirrors` inclusion + seed-row question left open, (c) route
contract + dashboard rendering. Each is independently revertible.

---

## Phase 8 — `authoritativeRead`: the inventory, and nothing else

**1. Phase number and title.** Phase 8 — Classify every authoritative-wrapper call site by cardinality and
`max_rows` sensitivity. **Decision 7 is choice C: inventory first, implementation later — so this phase
changes no behaviour.**

**2. Owner decisions implemented.** Decision 7 choice **C**, in full and only.

**3. Exact source files expected to change.** One document: the inventory table below becomes a section of
`docs/POSTGREST_MAX_ROWS_AUDIT.md`. No file under `backend/src/` changes in this phase.

**4. Exact database objects expected to change.** **None. 5. Migration required? NO.**

**6. The inventory.** Call sites of `authoritativeRead` / `authoritativeWrite` / `settleAuthoritative` in
`backend/src`, enumerated at baseline. The wrapper bodies are `database.js:5213` (read), `:5220` (write),
`:5228` (settle); **none of the three ever looks at `data.length`**, which is the mechanism under audit.

| Site | Table + query shape | Enclosing use | Expected cardinality | Complete-set required? | `max_rows` sensitivity | Proposed remediation |
| --- | --- | --- | --- | --- | --- | --- |
| `database.js:5282` | `admin_accounts` `select('*')`, no filter, no order | `resolveAdminByPhone` → `matches.length > 1` ambiguity refusal `:5287` | **SET** | **YES** | **SENSITIVE** — 430 rows now, cap 1000; past the cap the ambiguity check passes on a non-complete set | DB-side `.eq('phone_normalized').limit(2)` + project away credentials (Phase 5) |
| `:5352` | `admin_accounts` `.eq('username').limit(2)` | `authoritativeAdminByUsername` | 1–2 | YES | Not sensitive — bounded by `.limit(2)` and the UNIQUE | none (this is the pattern to copy) |
| `:5527` | `users` `select('*').eq('phone', norm)` | customer OTP login | **1** | no | Not sensitive — `users.phone VARCHAR(20) UNIQUE NOT NULL` (`001:17`) | none |
| `:5633` | `drivers` `select('*').eq('phone', norm)` | driver OTP login | **1** | no | Not sensitive — `drivers.phone … UNIQUE NOT NULL` (`001:53`) | none |
| `:5657` | `users` `.eq('phone', norm)` | merchant-owner fallback | **1** | no | Not sensitive (same UNIQUE) | none |
| `:5678` | `merchants` `select('*')` | merchant login resolution | **UNCONFIRMED** — the extracted fragment shows no `.eq('phone')`, so the filter may be in JS | **YES if JS-filtered** | **UNCLASSIFIED — first task of the implementing pass**: read the surrounding 20 lines and settle it; merchants is 39 rows today | TBD on the above |
| `:6384`, `:6390` | `backend_sessions` reads | `listCustomerSessions`, feeding the `signedOut` count | **SET** | **YES** | **SENSITIVE** — 1,517 sessions, max 276 for one entity; the page cap is per-query, so a busy customer can exceed it | route through a keyset walk on `token_hash` (`readAllActiveSessions` `:6012-6070` exists but hard-codes its own purpose; `readAllRows` cannot serve it — its cursor is `id`) |
| `:6609` | `users` `.eq('id')` | customer lookup by PK | **1** | no | Not sensitive | none |
| `:6794` | `users` paged directory | `listCustomerAccounts`, self-declares `searchCappedAt: 200` | **SET** | declared bounded | **Deliberate** — documented in the payload | keep; it is the reference implementation for Decision 9 |
| `:6801` | settle with `count:'exact'` | same directory | SET + count | declared | — | keep; **the only site in the codebase that reads `count`** |
| `:6838` | `users` `.eq('id')` | `projectCustomerAccount` | **1** | no | Not sensitive | none |
| `:6944` | `users` `.eq('id')` | account behind a session | **1** | no | Not sensitive | none |
| `:6995` | `admin_accounts` `select(id, username, name, email, role, is_active)` | `setAdminAccountStatus` → `activeSuperAdmins <= 1` → `LAST_SUPER_ADMIN_CANNOT_BE_DISABLED` `:7040` | **SET** | **YES** | **POTENTIALLY SENSITIVE** — SUPER_ADMIN is 1 row today; sensitivity depends on whether the role filter is server-side, which must be confirmed | push the filter into SQL and use `count:'exact'`, or keyset |
| `repositories/DriverRepository.js:436` | driver read | dispatch/driver surface | **UNCLASSIFIED** | **UNCLASSIFIED** | **UNCLASSIFIED** | classify in the implementing pass |
| `:4144` | `admin_accounts` insert | admin enrolment | 1 | no | not sensitive | none |
| `:4776` | `admin_accounts` `update().eq('username')` | unusual-price-alert state | 1 | no | not sensitive | none |
| `:4817` | same update, **compensating restore** | error path that deliberately swallows the restore failure | 1 | no | not sensitive | surface the swallow (label it, don't delete it) |
| `:5569` | `users` insert | OTP-time user creation | 1 | no | not sensitive | none |
| `:6272` | `backend_sessions` `delete().eq('token_hash')` | lockout/session surface | set-by-predicate | the delete count is the answer | moderately sensitive; single-token predicate | assert `deleted.length` against expectation |
| `:6317` | `backend_sessions` `delete()` | `revokeAdminSessionsForAccount` — `(deleted \|\| [])` length **is** the security answer | **SET** | **YES** | **SENSITIVE** | keyset delete loop, or RPC returning a count |
| `:6443` | `backend_sessions` `delete()` | `revokeCustomerSessions` — same shape | **SET** | **YES** | **SENSITIVE** | same |
| `:6623` | `users` `update().eq('id')` | customer status write | 1 | no | not sensitive | none |
| `:7049` | `admin_accounts` write | admin status write | 1 | no | not sensitive | none |
| `repositories/DriverRepository.js:467` | settle of a driver write | dispatch surface | UNCLASSIFIED | UNCLASSIFIED | UNCLASSIFIED | classify |

**The 25 reconciles, and the reconciliation is part of the deliverable.** Enumerating `backend/src` by
hand gives 14 `authoritativeRead` calls (13 in `database.js` plus `repositories/DriverRepository.js:436`),
9 `authoritativeWrite` calls (all in `database.js`: `:4144, 4776, 4817, 5569, 6272, 6317, 6443, 6623,
:7049`) and 4 `settleAuthoritative` occurrences of which 2 are internal to the wrapper bodies — so 14 + 9
+ 2 = **25 external call sites**, matching the audit's count exactly.

**Aggregate verdict for the record:** 4 sites are hard-sensitive set reads (`:5282`, `:6384`, `:6390`, and
one of the two session deletes' answer-shape), 1 is potentially sensitive (`:6995`), 3 are writes whose
**return value is a security answer** (`:6272`, `:6317`, `:6443`), 3 sites are unclassified
(`:5678`, `DriverRepository.js:436`, `:467`), and **nothing in this phase is fixed** — that is
Decision 7's explicit instruction.

**7. Existing tests/harnesses to rerun.** None — no code changes. The inventory must instead be verified
by re-running the enumeration command and pasting its output into the document, so the table cannot drift
from the tree.

**8. Security invariants that must remain true.** This phase must not *introduce* a claim it cannot
support: every row marked UNCLASSIFIED stays UNCLASSIFIED in the published document. And it must record
the verification blind spot: **`admin_authorization_test.js:651-661` and `:755-757` monkey-patch both
wrappers**, so the authorization suite provides no coverage of any change to them — every remediation in
Phase 9 needs its own test, not that suite's green.

**9. Rollback.** Document-only revert.

**10. Dependencies and blockers.** Nothing blocks the inventory; three rows are blocked on reading more
code, and `:5678`'s classification changes whether the merchant login path is exposed. Feeds Phase 9.
**11. Independently deployable:** trivially. **12. Commit boundary:** one documentation commit.

---

## Phase 9 — Apply the complete-set rule to the remaining reads

**1. Phase number and title.** Phase 9 — Decision 9's policy written into the code: every complete-set read
explicitly handles `max_rows`.

**2. Owner decisions implemented.** Decision 9 choice **A** — *every* complete-set read must explicitly
handle `max_rows` — informed by Phase 8's table.

**3. Exact source files expected to change.**

| File | Change |
| --- | --- |
| `backend/src/database.js` | `:5282` (with Phase 5), `:6384`/`:6390`, `:6995`, `:6272`/`:6317`/`:6443`, and the boot hydrations at `:1866` (`admin_accounts` via `readAllRows` — correct), `:1905` (tickets `.limit(200)`), `:1942` (audit `.limit(200)`) |
| `backend/src/repositories/SupportTicketRepository.js` | `:441` — resolved by Phase 6, not re-litigated here |
| `backend/src/repositories/PricingRepository.js` | `listGeoFences` `:260-275` and `listSurgeZones` `:494-504` are plain `select('*')` + `created_at desc` with **no** `readAllRows`, so they are capped at 1000 — after Phase 1 these admin lists are the *only* way to see a boundary, and a truncated one would hide a fence from the operator. Must be bounded or keyset + total |
| `backend/src/repositories/DriverRepository.js` | whatever Phase 8's two unclassified rows turn out to need |
| `docs/POSTGREST_MAX_ROWS_AUDIT.md` | the written rule itself, which is what the decision actually asks for |

**4. Exact database objects expected to change.** Possibly one index if a keyset cursor needs it; no
column, no policy. The 8 reads the earlier audit recorded as **CAP-SENSITIVE and deliberately left
unchanged** stay unchanged unless this phase's per-read verdict says otherwise — and each must then carry
a written verdict line, because "left alone" and "left alone without a rule" are different states under
policy A.

**5. Migration required?** **Probably NO; YES if** the geo or session keyset pages need a supporting index.
Decide at execution from the Phase 8 table, and state the answer in the commit message.

**6. Baseline the rule is applied to.** `docs/POSTGREST_MAX_ROWS_AUDIT.md` §1: 167 `.from(…)` chains and
122 reads under `backend/src`, of which 49 are unbounded and 9 read whole tables; 7 complete-set reads were
already fixed; 8 were recorded CAP-SENSITIVE and left. `readAllRows` (`:5892-5966`) already implements the
correct shape — pageSize 500, maxPages 40, `count:'exact'` on the first page, dedupe by id, `rows.length ===
total` validation, and **refusal to publish a partial set** — so policy A is largely "route the remaining
reads through what already exists", plus one honest limit: `readAllRows`'s cursor is hard-coded to `id`,
which is why it cannot serve `backend_sessions`.

**7. Tests to add or update.** One deterministic row-cap test per remediated read, in the shape of
`session_reconcile_pagination_test.js` — seed past 1,000, assert completeness is detected and labelled, and
assert the security answer (revoked count, ambiguity refusal, super-admin floor) is computed over the whole
set. Existing: `test_suite.js`, `restart_test.js`, `auth_failclosed_test.js`,
`session_reconcile_pagination_test.js`, `boot_mirror_read_test.js`, `admin_authorization_test.js` (with
its wrapper-monkey-patch caveat stated in the report).

**8. Security invariants that must remain true.**
- **No silent PostgREST truncation for a complete-set read** — the invariant this phase exists to hold.
- `max_rows` stays 1000.
- Do not touch safe bounded reads unnecessarily: the `.eq('phone')`/`.eq('id')` single-row lookups covered
  by a UNIQUE constraint or a PK are **not** remediated, and the report must list them as considered-and-
  left rather than omit them.
- No pricing decision on incomplete geography: if a geo read ever reports incomplete, the refusal path
  (`GEO_STORE_UNAVAILABLE`, 503) fires — Phase 3's invariant, re-asserted here.
- Never weaken a test to make a remediation pass.

**9. Rollback.** Per-read code reverts; each read's behaviour is unchanged for every dataset under the cap,
so a revert has no data consequence.

**10. Dependencies and blockers.** **Depends on Phase 8** (the inventory is the work list) and overlaps
Phase 5 (`:5282`) and Phase 6 (`:441`) — those two must not be done twice. **Blocker:** the three
UNCLASSIFIED sites from Phase 8 (`:5678`, `DriverRepository.js:436`, `:467`) must be classified before
the rule can be stated as "all sites covered". **Known unrelated red:** `bootstrap_test.js` fails for the reason recorded
in `docs/GEO_SECURITY_DECISION_GATE.md` Appendix C (the
`support_tickets_assigned_admin_id_fkey` constraint refuses its whole-table `admin_accounts` delete, and
the harness never inspects the returned error); it is reported red, not fixed by editing its assertion.

**11. Can it be deployed independently?** Yes, per read — which is why the commit boundary below is small.

**12. Proposed commit boundary.** One commit per read family: (a) sessions (`:6384`/`:6390`/`:6272`/
`:6317`/`:6443`), (b) admin status/super-admin floor (`:6995`), (c) admin geo lists
(`PricingRepository:260/494`), (d) boot hydrations, (e) the written rule in the audit document. Each with
its own row-cap test.

---

## Phase 10 — Migration numbering, and what Section A must change before it can be applied

**1. Phase number and title.** Phase 10 — Assign migration identifiers for the whole plan, and renumber the
proposed geo/commerce lock.

**2. Owner decisions implemented.** Decision 8 choice **B** — renumber after checking the repository
migration sequence.

**3. The check, performed.** `supabase/migrations/` ends at `027_dynamic_campaigns_and_themes.sql`; **028
is free as a filename**, so the only collision is prose: `docs/ADMIN_FEATURE_SPECIFICATION.md` §9 item 1
reserves and declines the identifier 028. The choice of B means the file moves to a number that is not
028, and the documented reservation is then left intact rather than argued with. `backend/scripts/migrate.js:25`
applies files in `supabase/migrations/` (or `$MIGRATIONS_DIR`) in filename order, so numbering is also
application order.

**4. The numbering scheme this plan reserves.**

| Number | Content | Phase | Status |
| --- | --- | --- | --- |
| `029_geo_and_commerce_reads_service_role_only.sql` | Section A only: RLS restated, six policies dropped, `REVOKE ALL` from `anon`/`authenticated`, `GRANT SELECT` to `service_role` | Phase 1 | to be created, **not created here** |
| `030_support_tickets_created_id_index.sql` | `CREATE INDEX IF NOT EXISTS` on `(created_at DESC, id)` | Phase 6 step 2 | only if keyset is chosen |
| `031_admin_phone_normalized_column.sql` | column + backfill + index | Phase 5 | to be created |
| `032_admin_phone_normalized_unique.sql` | `CREATE UNIQUE INDEX … WHERE phone_normalized IS NOT NULL` | Phase 5 step 2 | **blocked on duplicate remediation**, do not schedule until the report is clean |

**5. Exact source files expected to change.** `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql`
is renamed to `supabase/migrations/029_…sql` **at the moment Phase 1 is ordered**, and its internal header
("PROPOSED 028", §5's rollback text naming 028) is updated with it. Nothing in this task renames it.

**6. Exact database objects expected to change.** None — numbering is a filename. **7. Migration required?
NO** (this phase *names* migrations; it does not write or apply them).

**8. What in the proposed SQL must change because of the other owner decisions.** Five items:
1. **Section B must not be part of the migration.** It is prose and marked DO NOT APPLY; if it moves into
   `supabase/migrations/` unchanged it would be dead text inside an applied file — better to leave Section
   B in `docs/proposed/` and carry only Section A forward.
2. **`ALTER TABLE … ENABLE ROW LEVEL SECURITY` is a no-op** — all 51 public tables are already enabled
   (baseline §3.5). Keep it as a restatement of intent, but do not let it read as the change; the change
   is the REVOKE.
3. **Dropping the six policies is required, not optional**, and the reason is now measured: 0 tables use
   `FORCE ROW LEVEL SECURITY`, so a surviving policy plus any future re-grant (Supabase defaults do this
   on new tables) reopens the read with no decision attached.
4. **Scope note for the owner:** Section A also covers `promotions`, `platform_settings` and
   `notification_templates`, which are wider than "anonymous geo data". Decision 8 chose renumber (B), not
   split (C), so the plan keeps them together and flags it.
5. **Ordering with Phase 4:** apply 029 *before* purging the residue, so the 444 fixture fences stop being
   publicly readable while they still exist. The §4 verification steps in the proposed file stay valid,
   with one correction: step 3's expected boot counts (447 / 445) become 3 / 189 once Phase 4 runs, so the
   two phases cannot both assert "the count did not change" unless each records the count it was run
   against.

**9. Tests to add or update.** `test_phase8_security.js` (asserts policy names on other tables — must stay
green), plus Phase 1's new negative suite. **10. Rollback:** forward-only, `pg_dump` first, as the proposed
file's §5 already says. **11. Dependencies:** none, but it must run *before* Phase 1's commit and *before*
Phase 4's purge. **12. Commit boundary:** the rename is part of Phase 1's commit, not a separate one —
a number with no content and a content with no number are both broken states.

---

## Phase 11 — A deterministic reproduction requirement for RX/INP

**1. Phase number and title.** Phase 11 — Decide *what would prove* the RX/INP intermittency, before
investigating it again.

**2. Owner decisions implemented.** Decision 10 choice **C**.

**3. Status carried forward, unchanged.** RX-01…03 (`backend/admin_authorization_test.js:620-627`) and
INP-21/22 (`backend/admin_customers_test.js:665-674`) are **INTERMITTENT / UNRESOLVED, CAUSE NOT PROVEN**.
Across controlled passes: four green, one red, against a mechanism (the session-reconciliation row cap)
that no longer exists in the code. **This phase does not claim a fix and must not be written up as one.**

**4. What the checks actually depend on,** which is what a reproduction spec must pin down:
- RX-01: a session row written by **another instance** must be honoured within the **15-second reconcile
  window** — i.e. `hydrateSessions()` + `setInterval(() => db.reconcileSessions(), 15000)`
  (`server.js:7921-7925`, `database.js:6101-6150`).
- RX-02: the honoured session carries `OPERATIONS`, i.e. it must survive the role branch in
  `authenticateAdmin` (`server.js:953` `isAdminSessionRole`).
- RX-03: a foreign bearer passes `GET /api/admin/support` (200) and is denied
  `GET /api/admin/audit-logs?limit=1` (403) — permission-shaped, and the second route is the R2 audit
  route Phase 7 touches.
- INP-21/22: a bearer this instance never issued is honoured after the tick and then refused
  `ACCOUNT_SUSPENDED` on every probe — which depends on `customerSessionRefusal` (`server.js:754-771`) and
  on the reconciled session set being **complete**, the row-cap link.
- Store state at baseline: 1,517 `backend_sessions` rows, 1,516 unexpired, max 276 for one entity, against
  `max_rows = 1000`.

**5. The reproduction requirement to write down (the phase's deliverable).** A spec section in
`docs/GEOFENCING_SECURITY_AUDIT.md` (or a dedicated `docs/RX_INP_REPRODUCTION_SPEC.md`, owner's choice of
location is cosmetic) with all ten items the order asks for:

| # | Item | Requirement |
| --- | --- | --- |
| 1 | Environment | local Docker Supabase only; container name and image recorded in the artifact; `SUPABASE_URL`/keys from `.env`; **no hosted project**; nothing else bound to port 4000 |
| 2 | Cold/warm conditions | two processes, each with a **verified** spawned-pid = listening-pid pair (the Windows/MSYS pid trap is documented in memory and has already produced a false green once); which process is issuer and which is observer, fixed per run |
| 3 | Request sequence | the exact call order: session mint → cross-instance poll at t+0/5/10/15/20 s → RX-03 pair → suspend → INP probe set, with no concurrent suite traffic |
| 4 | Database state | `backend_sessions` row count and unexpired count taken immediately before each run (not inherited), the identity of the fixture session rows, and the `max_rows` value read from `supabase/config.toml` |
| 5 | Client conditions | same bearer for every probe; no retry-on-401 anywhere in the harness; timeouts recorded; the in-process broadcast/session window cleared by the restart, which is a known suite precondition |
| 6 | Measurements | reconcile tick start time, per-poll latency, `reconcileSessions` pages walked and rows returned, whether `readAllActiveSessions` reported `complete`, and the boot line's `Restored N authentication session` value for each process |
| 7 | Pass/fail threshold | stated as a rule, e.g. "honoured within 15 s + one tick, and every INP probe returns exactly 403 `ACCOUNT_SUSPENDED`" — a check that can only pass or fail, with no "usually" |
| 8 | Repeat count | **N ≥ 10 consecutive runs, each in a verified-fresh process**, reported individually rather than as a suite total; a single red inside ten is information, a 10/10 green is not proof |
| 9 | Artifacts | the run script (versioned, e.g. replacing the throwaway `rxinp_pass6.sh`), raw per-run logs kept out of the repo, and a results table appended to the audit document with dates and pids |
| 10 | Establishing causality | the only admissible evidence: a **controlled intervention** — reproduce with the suspect mechanism present, disable or bound that one mechanism, reproduce again, then restore it and reproduce again. Correlation across repeats (four green, one red) is explicitly **not** causality, which is precisely the mistake the pass-6 table invites. Until an intervention flips the result, CAUSE stays NOT PROVEN and the STATUS stays INTERMITTENT / UNRESOLVED, whatever else changes |

**6. Source files expected to change.** Only documentation, plus optionally one new harness script under
`backend/`. **7. Database objects: none. 8. Migration required? NO. 9. Existing tests to rerun: none —
the phase defines the runs, it does not perform them.**

**10. Security invariants.** No hosted environment is contacted; no test is weakened or deleted; the
NOT-PROVEN wording survives every future report of this group.
**11. Independently deployable:** yes, and it is the one phase with zero interaction risk.
**12. Commit boundary:** one documentation commit for the spec; a separate commit for the harness script.

---

## Dependency analysis

### A. Critical dependencies (X must happen before Y)

1. **Phase 10 → Phase 1.** The number must exist before the file does; the rename and the content are one
   commit.
2. **Phase 1 → Phase 4.** Lock the anonymous read *before* purging, so 444 fixture boundaries stop being
   publicly readable while they still exist. Reversing the order leaves a window.
3. **Phase 4 → Phase 3's re-baselining.** Every geo count assertion (boot line, `GEO-TEARDOWN`,
   `boot_mirror_read_test.js`) changes value at 447/445 → 3/189. Phases 3 and 4 may be built in either
   order, but only one of them may leave the expected counts stale.
4. **Phase 8 → Phase 9.** Decision 7 is inventory-first by the owner's own words; the table is Phase 9's
   work list, and the three UNCLASSIFIED sites gate its completion claim.
5. **Phase 5 → Phase 9 for site `:5282`.** The same read is fixed once, by Phase 5, and Phase 9 records it
   as covered rather than re-implementing it.
6. **Phase 6 → Phase 9 for `SupportTicketRepository:441`.** Same reason.
7. **Phase 7's marker → Phase 7's hydration change**, within the phase: label what is incomplete *before*
   changing how much is loaded, or there is a state where the mirror is bigger and still presented as
   complete.
8. **Phase 5's duplicate remediation → migration `032`.** A UNIQUE index cannot be created while 50 active
   rows share one normalized number. This is a hard data dependency, not an ordering preference.
9. **Phase 2's owner clarifications → Phase 2's code.** The route cannot be written before its audience is
   named.

### B. Safe to do in parallel

- Phases **6, 7, 10, 11** are mutually independent and independent of 1–5: different tables, different
  files, no shared assertions.
- Phase **5** (admin accounts) and phase **1** (grants) touch disjoint objects.
- Phase **3** and phase **1** touch disjoint objects (in-process state vs grants) — but both change geo
  assertions, so the *test* work must be coordinated even where the code does not collide.
- Phase **9**'s session-read family (a), super-admin floor (b) and admin geo lists (c) are independent of
  each other and can be three parallel commits.
- File-level conflict to schedule rather than discover: `backend/src/database.js` is edited by Phases 3, 5,
  6, 7, 8(no), 9 and `backend/src/server.js` by Phases 1(no), 2, 6, 7 — so at most one phase should be open
  on each of those two files at a time.

### C. Work that must land before any migration is applied

1. A `pg_dump` of `geo_fences` and `surge_zones` (Phase 4's rollback) and of the whole database (Phase 1's,
   because a `DROP POLICY` is schema state).
2. The negative tests for Phase 1 written **and red**, so applying the migration is the thing that turns
   them green rather than a change validated afterwards.
3. Confirmation, re-measured at execution time, that no client in the repository opens a Supabase session
   (`createClient` outside `backend/`) — a fact at baseline, and the only thing standing between Section A
   and a broken app.
4. The Phase 4 materialized ID list, with its count asserted equal to the classification.
5. Agreement on which migration numbers are reserved (Phase 10), so no two phases claim 029.

### D. Work that requires data remediation before it can be completed

1. **Phase 5's UNIQUE phone** — 50 active rows share `+919811233445`; per-account human decisions required;
   **no automatic merge, rename or delete**.
2. **Phase 4's purge as a repeatable operation** — the classification is a snapshot, because new fixture
   residue is created by test runs; a durable purge tool would need a durable classifier that does not
   exist (`created_by` is not a fixture property and the `zone_code` shapes vary).
3. **Phase 9's session reads** — `backend_sessions` holds 1,517 rows of which 1,516 are unexpired; the
   keyset remediation is behaviour-safe, but any *cleanup* of stale sessions would be new data work the
   owner has not ordered.
4. **Phase 7's 4 fabricated seed mirror rows** — a data-in-memory question whose disposition is an owner
   answer, not a code choice.

### E. Work that requires owner clarification (nothing here is decided by this plan)

| # | Question | Blocks |
| --- | --- | --- |
| E1 | Who may call the privileged half of the split geo-evaluation endpoint — admin with `geofence.view`, or a customer/driver session? Option 4 decided the split, not the audience. | Phase 2 |
| E2 | `POST /api/pricing/estimate` is anonymous and returns the surcharge-inclusive fare for any submitted coordinates (`server.js:3077`). Splitting `evaluate` leaves that door open. Is it in scope of Decision 1b, or a separate decision? | Phase 2's "no public pricing oracle" invariant |
| E3 | Do the **179 duplicate ACTIVE `surge_zones` rows on `ZONE_AIRPORT_IGI_T3`**, and the **10 `zone_id IS NULL` rules**, fall inside Decision 3's permission, or are they a separate decision? | Phase 4's completion |
| E4 | Three of the four operations named as "must not use stale geo policy" (driver assignment, cancellation/refund, and parcel booking's missing coordinates) **do not consult geo policy at all**. Should they start to (a behaviour change with pricing and dispatch consequences), or is the correct reading "wherever geo is consulted, these operations must not see stale geo"? | Phase 3's guarantee |
| E5 | `COMPLIANCE: YES` — may a labelled-partial mirror be relied on for a compliance determination, or must compliance reads fail closed during an outage? (The owner's general policy points one way, Decision 6 B the other.) | Phase 7's scope |
| E6 | Which audit routes win on outage: R1's bare 500 → R2's coded 503, or both to the R2 contract? | Phase 7 |
| E7 | Disposition of the 4 fabricated boot seed audit rows. | Phase 7 |
| E8 | Which of the 20 un-awaited audit writes must become awaited (the 6 in `PaymentRepository.js` are the obvious subset — "obvious" is not an order). | Phase 7 |
| E9 | Is Section A's bundling of `promotions` / `platform_settings` / `notification_templates` with the geo trio intended, or should it split (Decision 8 option C)? | Phases 1 and 10 |
| E10 | Are the ~380 NULL/blank admin `phone` rows expected to stay NULL under a UNIQUE rule (this plan assumes a partial unique index `WHERE phone_normalized IS NOT NULL`), or must they be backfilled/excluded? | Phase 5 |
| E11 | Does the owner want a supported admin purge route for Phase 4, or an operator-executed SQL script? | Phase 4's deliverable shape |
| E12 | Where should the Phase 8 inventory live — extend `docs/POSTGREST_MAX_ROWS_AUDIT.md`, or a new document? | Phase 8's commit |

### F. Recommended execution order (sequencing, not preference)

```
0  re-verify the baseline (Section 3), then freeze counts for this pass
1  Phase 10 (numbering)          ──┐
2  Phase 1  (anon read lock)       │  migrations + their negative tests
3  Phase 4  (residue purge)        │  after 1, per A2
4  Phase 3  (30 s geo TTL)       ──┘  needs E4 before its guarantee can be claimed
5  Phase 2  (endpoint split)          needs E1, E2
6  Phase 6  (ticket pagination)       parallel with 3–5
7  Phase 5  (admin phone)             parallel; UNIQUE deferred to 032 pending remediation
8  Phase 7  (audit marker)            parallel; needs E5–E8 for full scope
9  Phase 8  (authoritativeRead table)  documentation, parallel throughout
10 Phase 9  (complete-set policy)      after 8; after 5 and 6 for its two shared sites
11 Phase 11 (RX/INP spec)              independent, anytime
```

Phases 5, 6, 7 and 11 have no dependency on 1–4 and may be interleaved with them by different workers,
subject to the two shared-file constraints in B.

---

## Blockers and unresolved owner clarifications, stated plainly

| Blocker | Type | What cannot proceed |
| --- | --- | --- |
| E1 endpoint audience | owner clarification | Phase 2's privileged route |
| E2 anonymous `pricing/estimate` | owner clarification, and an invariant gap | Phase 2 cannot satisfy "no unrestricted public geo pricing oracle" |
| E3 the 179 + 10 surge rules | owner clarification | Phase 4's end state is 3 fences / 189 rules including 179 duplicates |
| E4 three critical operations never consult geo | owner clarification | Phase 3's guarantee for driver assignment, cancellation/refund, parcel |
| E5 compliance reliance on partial data | owner contradiction (B vs general policy) | Phase 7's fail-closed boundary |
| 50 duplicate admin phones | data remediation | migration `032`, the UNIQUE constraint |
| No compliance / security-investigation consumer exists | repository fact | Phase 7 cannot honour `COMPLIANCE: YES` / `SECURITY INVESTIGATION: YES` in code |
| Phase 8 UNCLASSIFIED × 3 (`:5678`, `DriverRepository.js:436`, `:467`) | inventory gap | Phase 9's "all sites covered" claim |
| `admin_authorization_test.js:651-661/:755-757` monkey-patch the wrappers | test blind spot | verification of Phases 8/9 must not rely on that suite |
| `bootstrap_test.js` known red | pre-existing, documented in the gate's Appendix C | a fully green suite run; reported red, not silenced |
| RX/INP cause not proven | open investigation | any claim that Phase 3 or 9 resolved it |

---

## Security invariants this plan must leave true

1. No production database change without explicit owner authorization. Nothing here authorizes one; the
   hosted test project and production are separate orders from the phases that name them.
2. No live Razorpay operation. No phase in this plan touches payment credentials; Phase 7's
   `PaymentRepository` work is about whether an audit write is awaited, not about the payment.
3. No SUPER_ADMIN creation or use beyond what is authorized — `server.js:1364-1379` (raw upsert, result
   ignored) and the `LAST_SUPER_ADMIN_CANNOT_BE_DISABLED` floor at `database.js:7040` are treated in
   Phases 8/9 as inventory and as a sensitive read, not as things to change silently.
4. No secret exposure: `password_hash` / `password_salt` stop being fetched on an auth path (Phase 5);
   audit payloads do not start carrying new state (Phase 7); nothing in the plan prints a key.
5. No weakened tests: the only assertion rewrites are Phase 1's SEC-07 (a known-gap check that asks to be
   inverted) and Phase 2/4/6's re-targeted fixtures — each must end up asserting **more**, and each rewrite
   is named in its phase.
6. **No anonymous access to protected geo geometry after Decision 1** — Phase 1's negative tests prove it
   per table, including the geometry columns specifically.
7. **No unrestricted public geo pricing oracle after Decision 1b** — Phase 2 closes one of two doors;
   E2 records that the invariant is not met until `pricing/estimate` is addressed. Stated as a gap, not as
   satisfied.
8. **No pricing on incomplete or unreadable geography** — the `UNREADABLE` tri-state and its 503 refusal
   stay load-bearing through Phases 3, 4 and 9, and Phase 3's TTL may not turn an unreadable store into a
   stale-but-answered quote.
9. **No silent PostgREST truncation for complete-set reads** — Phases 6, 7, 8, 9; plus `max_rows` stays
   1000 everywhere.
10. **No false claim that bounded audit mirror data is complete** — Phase 7's whole purpose, including the
    dashboard copy at `admin_dashboard.html:1784`.
11. **No unsafe admin identity ambiguity** — Phase 5: one phone resolves to at most one account, a
    truncated read can never satisfy the ambiguity check, and the refusal becomes a 403 instead of a 400.
12. **No deletion of legitimate geographic data** — Phase 4's three-ID keep-list, asserted before and
    after, and a `pg_dump` as the only rollback.
13. **No automatic admin-row merge, rename or delete** — Phase 5's remediation workflow is human, per
    account, through audited routes.
14. **No false claim that the RX/INP cause is proven or fixed** — Phase 11 carries INTERMITTENT /
    UNRESOLVED forward verbatim and defines what would be enough to say otherwise.
15. **Nothing is applied to a hosted environment by any phase in this document.**

---

## Test strategy

- **Order that geo work verifies in** (from the proposed migration's §4, kept): `geo_policy_test.js` →
  `geo_adversarial_test.js` → `test_suite.js` → `restart_test.js` → `auth_failclosed_test.js` →
  `session_reconcile_pagination_test.js` → `boot_mirror_read_test.js`, with a backend restart between the
  migration and the suite, and the boot line's fence/rule counts read as the regression signal for
  `service_role`.
- **Negative-first for every access change.** Write the refusal test, see it fail, then apply. A security
  test that was never red has not been shown to test anything.
- **Deterministic row-cap tests** for every remediated read, in the shape of
  `session_reconcile_pagination_test.js`: seed past the cap, assert completeness detection and the
  security answer over the whole set.
- **Two-process tests** for anything cross-instance (Phases 3 and 11's dependency), with the
  spawned-pid = listening-pid check, because a silent `EADDRINUSE` has already produced a false green on
  this host.
- **Known coverage holes, recorded wherever a phase's green would otherwise be misleading:**
  `admin_authorization_test.js` patches the authoritative wrappers; `boot_mirror_read_test.js` covers geo
  only, not audit; `test_phase8_security.js` pins policy names, which is how Phase 1 would learn it
  touched a seventh table; the anon probe self-skips when `SUPABASE_ANON_KEY` is absent and must become a
  hard fail; and `bootstrap_test.js` is red for a documented unrelated reason.
- **UI verification**: Phases 2, 6 and 7 change `admin_dashboard.html`, which is a root-level file served
  through Vercel — the dashboard's map tester, support page and audit TAB must be walked in a browser,
  since no automated suite covers them.

## Rollback strategy

| Phase | Rollback |
| --- | --- |
| 1 | `pg_dump` before, restore after; or re-create the six named policies from 011 §6 / the proposed file's §2 text and re-grant SELECT to `anon, authenticated`. Forward-only otherwise |
| 2 | `git revert` (code + dashboard together) |
| 3 | `git revert`; no schema, no rows |
| 4 | restore `geo_fences` + `surge_zones` from the pre-delete dump, fences first so the cascade's rules can be re-inserted |
| 5 | `DROP INDEX`, `ALTER TABLE … DROP COLUMN phone_normalized`, revert code — additive column, so no data restore |
| 6 | revert code; `DROP INDEX` if 030 was applied |
| 7 | revert code, per-file |
| 8 | revert document |
| 9 | revert per read family |
| 10 | rename back (no database state involved until Phase 1 applies it) |
| 11 | revert document; nothing executed |

The two phases with no clean rollback are **1** (a dropped policy is schema state) and **4** (DML with no
constraint-level undo). Both therefore require the dump as a precondition, not a suggestion.

## Proposed commit boundaries

One commit per phase except where stated otherwise: Phase 1 = 1 commit (migration + tests + the SEC-07
rewrite together, because splitting them leaves the suite red for an unrelated reason); Phase 3 = 2 (TTL,
then the `globalSurgeMultiplier` invalidation gap); Phase 4 = 0 commits (DML against a database; the
artefact is the report plus the dump); Phase 5 = 3 (031, then the lookup + tests, then the duplicate
report); Phase 7 = 3; Phase 9 = 5 (one per read family plus the policy document). Every commit message
names the decision it implements and states which environment it was verified against — local Docker
unless the owner has separately ordered otherwise. Nothing in this plan authorizes any of these commits, or
a push.

---

## NOT IMPLEMENTED

**Nothing in this document has been implemented.** As of this writing:

- **no source file was modified** — `backend/src/**`, all four web clients and `mobile/lib/**` are
  untouched;
- **no test file was created, modified, weakened or deleted**;
- **no migration was written, renamed, applied or rolled back** — `supabase/migrations/` still ends at
  027, and `docs/proposed/028_geo_and_commerce_reads_service_role_only.sql` is byte-identical to the state
  in which it was read (its §2 SQL has been quoted in this plan, not executed);
- **no database object was created or altered, and no row was deleted** — the local Docker database was
  read through `SELECT`-only queries against `information_schema`, `pg_policy`, `pg_indexes` and the tables
  named in Section 3;
- **the hosted test project and the production project were not contacted**, by any tool, at any point;
- **no configuration was changed** — `supabase/config.toml` still reads `max_rows = 1000`;
- **nothing was committed and nothing was pushed**;
- **no owner decision was made, inferred, extended or reinterpreted.** Where a decision as recorded cannot
  be built as worded — E1 through E12 — this document says so at that point and stops.

The statuses that must not be upgraded by anyone reading this file: RX/INP is **INTERMITTENT /
UNRESOLVED, CAUSE NOT PROVEN**; the Phase 8 inventory has **three unclassified sites**; Phase 5's uniqueness
requirement is **BLOCKED**; Phase 2's pricing-oracle invariant is **NOT SATISFIED**.

