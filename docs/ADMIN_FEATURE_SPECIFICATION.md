# NABIN — Admin Panel Feature Specification

**Document Path**: `docs/ADMIN_FEATURE_SPECIFICATION.md`
**Status**: SPECIFICATION ONLY — no implementation authorised by this document
**Scope**: NABIN Admin as the control centre for Ride, Food, Parcel and Grocery across all
surfaces (`mobile/lib/main_admin.dart`, `admin-web/`, and the APIs both consume).
**Verbatim requirement sources**: the 50-area Admin directive and the standing Phase 4
production-readiness directive. Where this document and either directive disagree, the
directives win.

---

## 0. How to read this document

Every claim in §1–§6 is **measured**, not remembered. Each carries the file, line, table
or command that produced it so a reviewer can re-run it. The three kinds of statement are
marked deliberately:

- **EXISTS** — working today, verified by code reading plus a live query.
- **PARTIAL** — the route or the table exists; the requirement's security or completeness
  condition does not hold yet.
- **MISSING** — nothing in the repository provides it.

This document is the last artefact of Phase 0 of the Admin work. It is not a plan I am
authorised to execute end to end: §9 lists the four points where I must **stop and ask**,
because the work beyond them needs a new migration, touches financial controls, or adds an
external service.

---

## 1. Measured baseline

### 1.1 The admin API surface

`backend/src/server.js` registers **73 admin routes** — 73 (method, path) registrations
covering 61 distinct URL paths; three registrations list an alias beside their main path,
such as the `/api/admin/features` + `/api/v1/admin/features` pair. One (method, path) pair
appears twice; see the note under the table. Parsed
from the argument list of each registration, so the middleware chain and the handler
boundary come from the same read. The split below is measured **after Phase A1 landed**, and
each row's previous state is given in §2:

| Gate | Count | Meaning |
|---|---|---|
| No middleware | 3 | `/api/admin/bootstrap`, `/api/admin/login` (intentional entry points), and `POST /api/admin/grocery/products/:id/photo` — see §2.6 |
| `authenticateAdmin` only | 17 | any valid admin session, including a `SUPPORT_AGENT`: `reset-password` (self-service by design), `me`, `services/status`, `drivers`×2, `jobs`, `restaurants`, `metrics`, `advertisements` (the **read**), `master-catalog` and `master-catalog/:id/stores`, `grocery/price-alerts`, `supabase-status`, `features`×3 |
| `authenticateAdmin` + `requirePermission(...)` | 51 | named-permission gate, 38 distinct strings |
| `authenticateAdmin` + `requireSuperAdmin` | 2 | the `platform-settings` pair |

**One path is registered twice, and the second copy is dead**: `GET /api/admin/drivers`
exists at `server.js:1419` and again at `server.js:4663`. Express answers with the first,
so the second handler never runs — a shape change made there is invisible at runtime, which
is the kind of defect area 5's driver list cannot absorb. It is listed in §11 as an open
decision because picking the survivor means deciding which response shape is correct.

Existing route groups by prefix: `services` (4), `accounts` (2), `audit-logs` (1),
`advertisements` (4), `campaigns` (7), `drivers` (5), `finance` (7), `features` (3),
`geofences` (3), `grocery` (3), `identity-verifications` (5), `jobs` (1),
`master-catalog` (5), `metrics` (1), `notifications` (1), `orders` (1), `platform-settings`
(2), `promotions` (4), `pricing` (2), `restaurants` (2), `reset-password` (1), `me` (1),
`supabase-status` (1), `surgezones` (2), `support` (3), `bootstrap`/`login`.

### 1.2 The admin web surface

`admin-web/` (Next.js) has **six pages** and **five components/lib files**:

```
src/app/login/page.tsx      src/app/page.tsx        (metrics + service switchboard)
src/app/drivers/page.tsx    src/app/merchants/page.tsx
src/app/orders/page.tsx     src/app/campaigns/page.tsx
src/components/{AdminLayout,AuthProvider,ResourceTable,CampaignEditor}.tsx
src/lib/{api.ts,campaigns.ts}
```

`src/lib/api.ts` exposes 22 methods, but only **15** are called by any page. Measured
absences in this surface:

- **Zero** permission or role checks — `grep -rn "permission\|role ===" admin-web/src`
  returns no matches. The nav is the same for every administrator.
- **Zero** realtime code — `grep -nE "socket|WebSocket|realtime|EventSource|setInterval|
  refreshInterval" admin-web/src` returns no matches. Nothing moves unless you reload.
- **Zero** charts, **zero** maps, **zero** CSV/XLSX/PDF export, **zero** global search.
- One generic `ResourceTable`; no responsive or card layout beneath it.

### 1.3 The database

63 tables in `public` (`information_schema.tables`, local Docker store). Admin-relevant
facts measured against that live store:

- `admin_accounts` columns: `id, username, name, email, phone, role, department,
  password_hash, password_salt, is_active, failed_attempts, locked_until, last_login_at,
  created_at, updated_at`. **There is no permissions column and no role/permission
  table.** See §2.2.
- **Zero views** exist (`information_schema.views` is empty), so every "list" endpoint
  shapes its own projection in JavaScript.
- No table exists for: `disputes`, `wallets` (a wallet is `users.wallet_balance` plus
  ledger rows), `feature_flags` (flags live inside `platform_settings` JSON values),
  `reports`, `admin_permissions`, `admin_roles`, `zones`, `banners` (banners are
  `advertisements` rows with a placement).
- `active_sessions` and `backend_sessions` **do** exist — the durable session basis a
  security centre needs is already there.
- Append-only protection is real: `trg_audit_logs_immutable`,
  `trg_ledger_entries_append_only`, `trg_journal_*_append_only`,
  `trg_driver_payouts_append_only`, `trg_payment_webhooks_append_only`,
  `trg_payments_mutation_invariants`.
- `driver_payouts` exists with an append-only trigger but **has no writer** in the
  application: settlement writes go through `settle_trip`/`adjust_wallet_atomic`, so the
  payouts area is schema-only. See area 18 in §5.

### 1.4 Sessions, tokens, and what an admin token grants

Two different checks protect an admin session, and only one of them is authoritative.

- **At sign-in** (`server.js:1240` → `database.js:5204`, `authoritativeAdminByUsername`): the
  password proves the caller
  knows a secret; the store decides whether the account still exists and is still
  `is_active`. An unreachable store **refuses the login** rather than answering from
  memory, and a removed account gets the same message as a wrong password.
- **On every request** (`authenticateAdmin`, `server.js:794`): the bearer resolves
  through `activeAdminSessions` / `db.getSessionByToken`, then a deactivation check reads
  the **in-process `adminUsers` copy**, not the store.

So a disable made directly in `admin_accounts` does not stop an already-issued token in a
running backend; it converges when that administrator next attempts to sign in
(`server.js:1260` writes `INACTIVE` into the copy, which then fails the per-request check).
That is a *delayed* revocation, not a broken one, and it is why area 34 asked for a
security centre rather than a smaller fix.

**Closed in A4.** Revocation no longer waits for the account's next sign-in.
`POST /api/admin/security/sessions/revoke` deletes the durable row **first** and this
process's `activeAdminSessions` afterwards — the reverse order leaves a session live in
`backend_sessions` after somebody was told it was revoked, and it returns on the next
reconcile — and `POST /api/admin/accounts/:id/status` runs the same revocation for every
session of the account, then clears both maps by account id. `admin_authorization_test.js`
proves it from the using side, not the reporting side: REV-01…REV-09 (a revoked bearer
answers 401 on the next request against an ungated *and* a gated route; the store row is
gone so a restart cannot hand it back; a second revoke reports `SESSION_NOT_FOUND` rather
than a second success; a session written by another instance is honoured inside the
15-second reconcile and is revocable from here; an administrator's revoke button cannot
sign a customer out — `SESSION_NOT_ADMIN`, checked before anything is deleted), and
DIS-01…DIS-07 (disabling cuts sessions at once, the disabled account cannot sign in, and
re-enabling restores access without a restart).

Two facts this surface has to state rather than imply, because a security screen that
looks authoritative is worse than an honest one:

- `admin_accounts.failed_attempts` and `locked_until` (migration 001:183–184) exist and
  are **never read or written**. What actually locks anybody out is the process-local
  `failedLoginAttempts` map (5 attempts / 15 minutes), so
  `GET /api/admin/security/login-lockouts` answers beside its counters with
  `scope: 'THIS_SERVER_PROCESS_ONLY'`, `resetOnRestart: true` and
  `durableColumnsInSchema: false` (SEC-06/SEC-07). Durable lockouts need a migration → §9.
- An administrator had **two ids**: `admin_accounts.id` (a uuid) and, for an account
  provisioned in the running process, an in-memory `adm_<six clock digits>` that boot
  hydration replaced with the uuid. The id in the create response therefore addressed a
  row that did not exist — a status write or a session revoke aimed at it was refused as
  `ADMIN_NOT_ENROLLED`. Provisioning now reads the uuid back from its own insert, so one
  id exists from the first moment the account does.

---

## 2. Seven facts that constrain every design choice

These are not bugs to note and move past; each one changes what an honest admin build
looks like.

### 2.1 RLS is bypassed for all backend traffic (EXISTS as a fact, MISSING as a control)

`backend/src/supabase.js:36` builds the client the API actually uses as
`createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey)`. `service_role` has
`BYPASSRLS`, and `backend/migrations/` contains **zero** `FORCE ROW LEVEL SECURITY`
statements. Every `auth.jwt() ->> 'role' = 'SUPER_ADMIN'` policy in migrations 001–026 is
therefore unreachable from the backend, and unreachable in principle for the ones that
reference `auth.users`, because administrators live in `admin_accounts`, not `auth.users`.

**Consequence for this spec**: the only enforcement that currently exists is the
Express-layer check. So "enforce server-side" (areas 33, 50) must mean *one authoritative
place in the backend that every admin mutation passes through*, and the spec must not
claim RLS as a defence layer. Two consequences follow, and both are work rather than
commentary:

1. Any new admin read must be projected in code with an explicit column list, because
   nothing below will narrow it — `select *` on `drivers` is a data-export event.
2. Making RLS real for admin traffic means issuing per-request tokens scoped to the
   administrator, i.e. a design change to the store connection. That is a §9 approval
   stop, not a phase in §7.
3. The same absence of a bottom layer is why Phase A1 had to fix a credential leak in two
   places rather than one. Sign-in used to copy the whole administrator entity —
   `passwordHash` and `salt` included — into `backend_sessions.entity`, and `/api/admin/me`
   used to serve that entity back. `withoutCredentialFields()` now strips those keys on both
   the write and the read, so the fix holds without editing stored rows (`RBAC-15`,
   `RBAC-16`). It does not retroactively clean the rows an older build already wrote: the
   local store held **307** of them when this was found, and scrubbing them is §9 item 5.

### 2.2 The permission matrix has one source now, and it is still not persisted

`requirePermission` (`backend/src/server.js:841`) grants when
`req.admin.role === 'SUPER_ADMIN'` **or** `permissions.includes(requiredPerm)`.

**Phase A1 changed the first half of this sentence's history.** The `permissions` array
used to be produced by three different hard-coded maps that disagreed: the boot sync handed
`SUPER_ADMIN` forty strings, `createAdminAccount` handed the same role eighteen, and the
bootstrap route carried a third list of forty-one; an unrecognised role silently received
`OPERATIONS` at the two sites in `database.js`. All three are now the single
`backend/src/adminPermissions.js`, read by the boot sync, by `createAdminAccount`, by the OTP
resolution path and by the bootstrap route; an unknown role is refused at provisioning with
`ADMIN_ROLE_UNKNOWN` and refused at sign-in rather than rounded down. The suite asserts
both (`RBAC-13`).

What is still true, and what shapes everything downstream:

- Grants are derived from the role at the moment the process reads the account. They are
  **not stored**, so they cannot be edited per administrator, and there is no row an
  auditor can point at to say what this account was allowed to do last Tuesday.
- A second backend process, or a restart, re-derives everything from `adminPermissions.js`.
  Changing a grant is a code change plus a restart.
- An administrator who exists in `admin_accounts` but has no in-memory twin now gets its
  role's grants; it used to get `[]`, which read as "signed in and powerless".
- The role `CHECK` in `001_central_schema.sql:178` allows exactly five values:
  `SUPER_ADMIN, KYC_SPECIALIST, OPERATIONS, FINANCE_AUDITOR, SUPPORT_AGENT`. That
  constraint is now matched in code, so the fail-open default has nowhere to come from.

Persisting the matrix needs a new table → migration **028** → §9 approval stop.

### 2.3 The catalogue has one source now; three gaps remain inside it

After Phase A1 the role→grants answer exists in exactly one file, `backend/src/adminPermissions.js`.
It replaced three copies that disagreed — the boot sync's 40 strings, `createAdminAccount`'s 18,
and the bootstrap route's own 41 — and which of them won depended on whether the process had
restarted since the account was created. The catalogue is now **53** names (A4 added
`security.view` and `security.session.revoke`); **40** of them gate **55** of the 72
`authenticateAdmin` routes, **13** gate no route at all, and every count in this section is
re-measured from `src/server.js` on each run by `admin_authorization_test.js` CAT-01…CAT-05
rather than restated by hand.

- **Enforced but granted to no non-super role** (26, up from the 11 measured at A1 because
  completing the `SUPER_ADMIN` list made the gap visible, not because it grew):
  `admin_accounts.{create,manage}`, `advertisement.{create,edit,delete}`,
  `campaign.{view,create,edit,publish,delete}`, `catalog.manage`,
  `geofence.{create,delete}`, `grocery.review`, `notification.broadcast`,
  `orders.manage`, `pricing.edit`, `promotion.{view,create,edit}`,
  `security.{view,session.revoke}`, `services.{pause,resume,emergency_killswitch}`,
  `surge.create`. `SUPER_ADMIN` reaches them through the role wildcard at `server.js:847`,
  so nothing is broken today — but the fourteen names a non-super role does hold
  (`audit.view`, `finance.*`, `fleet.manage`, `geofence.view`, `identity_verification.*`,
  `merchant.manage`, `support.*`, `surge.view`) are the whole of least privilege today,
  which is precisely what area 33 asks for. Assigning the other twenty-six is a product
  decision, not a code one, and §11 asks it.
- **In the catalogue, gated on no route** (13): `audit.export`, `geofence.edit`,
  `identity_documents.{view,download}`, `identity_verification.{approve,reject,
  request_resubmission}`, `notification.view`, `promotion.activate`, `services.view`,
  `support.escalate`, `surge.{edit,activate}`. Four of the thirteen are decided *inside* a
  handler (see the third bullet), so the remaining **nine grant nothing anywhere**:
  `audit.export`, `geofence.edit`, `identity_documents.download`, `notification.view`,
  `promotion.activate`, `services.view`, `support.escalate`, `surge.edit`,
  `surge.activate`. Several are exactly what areas 20, 22, 28, 31 and 42 ask to be real — a
  surge edit, a coupon activation, a notification history read, an audit export. They are
  names the old bootstrap map carried and no route ever checked, so area 33 cannot gate on
  them until the guard exists.
- **Enforced, but not by middleware**: `identity_documents.view` is read inside
  `GET /api/admin/identity-verifications/:id` (`server.js:2788`) to decide whether the
  applicant's phone and document references come back unmasked — the field-level shape area 6
  wants, and the pattern new reads should follow. `identity_verification.{approve,reject,
  request_resubmission}` are checked against `req.admin.permissions` inside the review route
  (`server.js:2848`, `2851`, `2854`). `POST/PUT /api/admin/features*` compare `req.admin?.role`
  to `SUPER_ADMIN` directly (`server.js:5586`, `5669`), and `reset-password` allows
  self-or-`admin_accounts.manage` (`server.js:1342`). Four spellings of the same answer, and
  only the first form is readable as a list.
- **Gated by nothing at all** (15 admin routes): `services/status`, `me`, `reset-password`,
  `advertisements`, `metrics`, the duplicate `drivers` pair (§11 decision 9), `drivers/:id`,
  `jobs`, `restaurants`, `master-catalog`, `master-catalog/:id/stores`,
  `grocery/price-alerts`, `supabase-status`, `features/:key`. Three of them decide inside
  the handler — `me` by design (any signed-in administrator reads their own grants),
  `reset-password` (self-or-`admin_accounts.manage`) and `features/:key` (role equality with
  `SUPER_ADMIN`) — so **twelve answer to any valid administrator token**. That is area 33's
  least-privilege debt in its plainest form, and CAT-04 fails the run if the count grows.
- **Still not persisted**: grants are derived from the role at read time and `admin_accounts`
  has no permissions column, so per-admin overrides remain a migration-028 question (§2.2, §9).

### 2.4 A feature flag could write any platform setting — closed in Phase A2

`POST /api/admin/features` (`server.js:5579`) and `PUT /api/admin/features/:key`
(`server.js:5664`) upsert `platform_settings` keyed on the caller-supplied `key`. Because
flags and settings share the one table, a request with `key: 'nabin.admin.theme_v1'` used to
write a theme record through the flag endpoint, and `PLATFORM_SERVICE_STATE` — the emergency
switchboard — was equally reachable. Area 38's requirement that flags must not become a way
around other controls therefore failed on the write path alone.

**Closed:** both routes now admit only what the flag readers can serve — a `FEATURE_%` key
(`FeatureControlService` loads exactly that prefix) or one of the legacy flags
`/api/features` still answers from `db.featureFlags`. Anything else is a 400 with
`FEATURE_FLAG_KEY_NOT_ALLOWED`. The predicate is `isWritableFlagKey()`, asserted both over
HTTP and directly against the reserved names. Moving flags to their own table remains the
§9 migration question; this closes the control failure without one.

**Still open here:** the gate on these two routes is an in-handler `role === 'SUPER_ADMIN'`
test rather than a named permission (§2.3), so `settings.edit` in §3 has nothing to bind to
until the naming decision in §11 is answered.

### 2.5 Memory-only surfaces

These answer 200 from process state and are lost or divergent on restart — each one is a
lie an operator can act on, and they are the reason §7 puts a `dataSource` label on every
admin read:
`master_grocery_catalog` CRUD, `fleetLocations` (the map's data), the `advertisements`
fallback list, `activeAdminSessions`, the dispatch offers cache, and the boot-synced
copies of `pricingConfig`, `geoFences`, `surgeZones`, `ledgerEntries`,
`supportTickets`.

**Three of them are admin control-plane mutations, measured while doing §2.7.** These are the
worst form of the same fact, because an operator presses a button, sees a success, and the
platform never changed:

| Admin action | What it actually writes | What the store holds |
|---|---|---|
| `POST /api/admin/restaurants/:id/status` (suspend a merchant, area 7) | `this.restaurants[].operationalStatus` in process memory | `merchants` has **39 rows and no `operational_status` column** — the only state field it has is `is_open`, which this route never touches. The customer-facing merchant reads go to PostgreSQL, so they never see the suspension. |
| `POST /api/admin/identity-verifications/:id/lock` and `/review` (area 6) | `this.identityApplications[]` in process memory | `identity_documents` exists and has **0 rows**; nothing in `src/` selects or inserts it. The whole review queue is fixture data. |
| `POST /api/admin/grocery/products/:id/review` (price freeze, area 8) | `this.groceryProducts[].priceStatus` in process memory | No `price_status` column anywhere in the schema, so there is nowhere for it to go. |

Their audit records are now fail-closed (§2.7), which makes the trail honest about an action
that landed — it does not make the action land. Closing this needs new columns and writes,
i.e. a migration, so it is a §9 approval stop rather than something to do inside Phase A.

### 2.6 One anonymous route I did **not** change, on purpose

`POST /api/grocery/products/:id/photo` **and its `/api/admin/` alias** (`server.js:6811`)
accept a base64 image with no credentials, and can create rows in the grocery catalogue.
`backend/cloudinary_test.js:126` posts to it with no `Authorization` header, so gating it
turns a green test red. Per the standing rule *"fix the implementation rather than
modifying the test to hide the failure"* and *"when something conflicts with an earlier
requirement, STOP and report the conflict"*, it is **reported, not silently fixed**, and
belongs to task #51 (campaign asset architecture), where the media surface gets a real
upload contract. This is the only unauthenticated `/api/admin/*` path other than the two
login entry points.

### 2.7 An audit record can be lost while the mutation reports success

`database.js` holds 42 audit writes. Before Phase A3, **32 were fired without awaiting**: 21
from methods that were not `async` and so could not await, 11 from methods that were already
`async` and simply did not bother. When the store refused one, the rejection had one
destination — the process-wide `unhandledRejection` net at `server.js:153`, which prints that
*a* promise rejected. Nothing there said an operator action had lost its record, or which
one, and the route had already answered 200.

**A3 (visibility, committed first):** `createAuditLog` attaches a report-only handler before
returning. A drop now reads `[audit] DROPPED TRAIL for MODULE/ACTION on Type/id: <reason>`
and never reaches the net; the original promise is still what callers await.
`backend/audit_drop_visibility_test.js` (AD-01…AD-08) pins both directions.

**A3b (fail-closed on the admin control plane):** a new sibling,
`database.js` `auditAppliedChange`, awaits the write and turns a refusal into
`AUDIT_RECORD_UNAVAILABLE` at 503 carrying **both** `status` and `statusCode` — half the admin
catches read one, the support and repository paths read the other, and setting only one turns
an outage into a 400. Its message says the action *was applied* and must be reconciled,
because by then it was. **26 trail writes now go through it**, measured per file:
`database.js` 18 (`pauseService` ×2, `resumeService` ×2, `reviewIdentityApplication` ×4,
`lockIdentityApplication`, `setRestaurantStatus`, `adminReviewPrice`, `setDriverStatus`, the
advertisement create/update/delete ×6, plus the two support/identity offline fallbacks),
`server.js` 3 (both feature-flag writes and the driver payout route), `DriverRepository` 3
(driver status, payout destination verified/rejected — reached in live mode, which is where
`setDriverStatus` actually goes: it delegates to the repository whenever one exists, so the
in-file write is the fallback), and `SupportTicketRepository` 2 (assign + resolve) — whose
`catch { console.error('Audit log write error (non-fatal)') }` declared an audit record
optional for the one action (a dispute settlement) that most needs one.

Two consequences worth stating:

1. **Awaiting can hang a route if the route is not ready to reject.** Express 4 does not
   forward a rejected async handler to the error middleware, so `POST /api/admin/drivers/:id/status`
   — which already called an awaited, throwing repository method — would have hung the request
   rather than answered. The identity lock/review, restaurant status and price review handlers
   were synchronous and had no `catch` at all. All five now catch and honour `err.status`.
   Three handlers that could *already* reject from an awaited audit write had no `catch`
   either, and are fixed on the same rule: `POST /api/admin/finance/settlements/drivers/:id/payout`
   (hangs after a real payout if its `SETTLEMENT_EXECUTED` record is refused — it now answers
   503 with the payout it is missing, `applied: true`), `POST /api/admin/drivers/:id/verify-payout-destination`
   (hangs after the `drivers` row is written), and `GET /api/admin/identity-verifications/:id`
   (hangs when `auditLogRepo.list` fails; it must not answer an empty trail as if that were
   the record). Four catch-less async handlers remain, listed in §2.7's own harness as ST-04.
2. **The advertisement live branch had to leave its own `try`.** Its store-failure `catch`
   falls back to memory; an awaited audit refusal inside it would have been read as "the create
   failed" and produced a **second** campaign in memory with the same content. The trail write
   now sits after that `catch`.

**Proved two ways.** `backend/admin_audit_fail_closed_test.js` (79 assertions, all passing)
runs each converted method against an audit store that refuses, and asserts the rejection
shape, that the state really did change (so "it failed" would be a false claim), that the
client-facing message carries no store wording while `cause` does, and that an accepting
store lets the same call resolve with exactly one trail. Its static half then holds the two
rules that no dynamic case can cover: no un-awaited `auditAppliedChange` anywhere (ST-01), and
every route that awaits a fail-closed call has its own `catch` honouring `err.status` (ST-03,
21 call sites across 166 handlers). It also pins the paths deliberately left alone, so a later
edit cannot quietly fail-close a wallet adjustment (ST-05/ST-06).
`outage_semantics_audit.js` proves it through the wire with the local database stopped:
`OS-05` (pause a service) and `OS-06` (publish a campaign) now read
`healthy=200 outage=503 code=AUDIT_RECORD_UNAVAILABLE`, where before this change both answered
200 with a lost trail. The audit reports 11 acceptable, 0 wrong, 0 leaking engine wording.

**What still drops, and why each one stayed (20 writes across `src/`):**

| Site | Why not converted |
|---|---|
| `validateAuthoritativeJobOtp` ×3 (dispatch OTP) | Trip completion, not admin. A lost record must not strand a driver mid-trip. |
| `processFinancialAdjustment` | Its `idempotencyKey` ends in `Date.now()` (`database.js:2805`), so **a retry after a 503 would move the money twice**. Fail-closed here is unsafe until the key is request-derived — reported, not changed. |
| `PaymentRepository` ×6 | Payment/webhook paths, fire-and-forget on purpose: directive 15 puts settlement logic out of scope, and a 503 on a webhook invites a replay. Their drops are announced by A3. |
| `saveMediaAsset`, `deleteMediaAsset` | 8 + 2 call sites across the upload surface, mixed actors; belongs with #51 where that surface gets one contract. |
| `getServicesStatus` (auto-resume) | A **read** that writes, called by the anonymous `GET /api/services/status`; making it async would let a lost system record 5xx a public endpoint. |
| `updateFeatureFlag` | The method is **dead** — nothing calls it. The live flag write is the route, which now audits (see below). |
| support/identity/grocery **offline fallbacks** (`assignSupportTicket`, `resolveSupportTicket`, `createSupportTicket`, `submitIdentityApplication`, `updateGroceryProductPrice`, `submitPackedWeight`) | Reached only when there is no live PostgreSQL, where `createAuditLog` keeps an in-memory record that cannot fail. Non-admin actors on four of the six. |

**Two flag-write holes found while doing this** (`POST /api/v1/admin/features`,
`PUT /api/v1/admin/features/:key`): neither wrote any audit record at all, and **neither
looked at the result of its own write** — the destructured `error` belonged to the preceding
read, so a refused upsert answered 200 with the new value. On the POST that is also a lost
update: with `data` null on a read failure the merge silently dropped every field the flag
already held. Both now check the read, check the write, and await
`SETTINGS/FEATURE_FLAG_UPDATED` with previous and new state.

---

## 3. Target permission catalogue

Names follow the existing `domain.verb` convention. `NEW` marks a string that does not
exist today. The catalogue is what `requirePermission` should be able to enumerate from
one module rather than 70 inline literals; the catalogue itself is code, and its
*persistence* is the §9 migration.

| Domain | Permission | Protects |
|---|---|---|
| dashboard | `dashboard.view` `NEW` | KPI aggregate reads (area 1) |
| dashboard | `dashboard.configure` `NEW` | per-admin layout preferences (area 46) |
| operations | `operations.live` `NEW` | live operations centre + timeline (area 2) |
| operations | `map.view` `NEW` | fleet/zone map (area 3) |
| operations | `search.global` `NEW` | global search, permission-filtered (area 40) |
| customers | `customers.read` `NEW`, `customers.update` `NEW`, `customers.suspend` `NEW`, `customers.impersonate` `NEW` | area 4 |
| drivers | `fleet.manage` (existing), `fleet.read` `NEW` | area 5 |
| kyc | `identity_verification.view/review` (existing), `identity_documents.view` (granted, enforcement `NEW`) | area 6 |
| merchants | `merchant.manage` (existing), `merchants.read` `NEW` | area 7 |
| catalog | `catalog.manage` (existing), `catalog.bulk` `NEW` | area 8 |
| orders | `orders.manage` (existing), `rides.read` `NEW`, `food.read` `NEW`, `parcel.read` `NEW`, `parcel.proof.view` `NEW` | areas 9–11 |
| dispatch | `dispatch.view` `NEW`, `dispatch.reassign` `NEW` | area 12 |
| trips | `trips.transition` `NEW` | area 13 (state-machine-only transitions) |
| payments | `payments.read` `NEW`, `payments.view_raw` `NEW` (gateway ids only, never secrets) | area 14 |
| refunds | `finance.refund` (existing) | area 15 |
| wallets | `wallets.read` `NEW`, `wallets.adjust` (alias of existing `finance.adjust`) | area 16 |
| finance | `finance.view`, `finance.settlement` (existing), `ledger.export` `NEW` | area 17, 42 |
| payouts | `payouts.view` `NEW`, `payouts.release` `NEW` | area 18 |
| pricing | `pricing.edit`, `surge.view`, `surge.create` (existing), `surge.delete` `NEW` | areas 19–20 |
| geo | `geofence.view/create/delete` (existing), `geofence.edit` `NEW` | area 21 |
| growth | `promotion.view/create/edit`, `campaign.*`, `advertisement.*` (existing), `promotion.activate` `NEW` | areas 22–23, 27 |
| branding | `branding.edit` `NEW`, `theme.edit` `NEW`, `banner.manage` `NEW` | areas 24–26 |
| messaging | `notification.view` (granted, enforcement `NEW`), `notification.broadcast` (existing) | area 28 |
| support | `support.view/respond/resolve` (existing) | area 29 |
| disputes | `dispute.view` `NEW`, `dispute.resolve` `NEW` | area 30 |
| audit | `audit.view` (existing), `audit.export` (granted, enforcement `NEW`) | areas 31, 42 |
| admins | `admin_accounts.create/manage` (existing grants, enforcement `NEW`), `admin_accounts.impersonate` `NEW` | area 32 |
| security | `security.view`, `security.session.revoke` (both exist and are enforced since A4) | area 34 |
| system | `system.health` `NEW`, `services.pause/resume/emergency_killswitch` (existing) | areas 35, 43 |
| integration | `integrations.view` `NEW`, `integrations.edit` `NEW` (metadata only) | area 36 |
| settings | `settings.view` `NEW`, `settings.edit` (today only `requireSuperAdmin`) | area 37 |
| flags | `feature.view` `NEW`, `feature.edit` `NEW` | area 38 |
| reports | `report.view` `NEW`, `report.export` `NEW` | area 39 |
| ai | `ai.query` `NEW`, `ai.act` `NEW` (acts only through the caller's own permissions) | area 44 |

**Rule for every `NEW` string**: it is added in one catalogue module, and the route that
enforces it lands in the same phase as the screen that needs it. A permission with no
enforcing route is worse than no permission, because the matrix then lies.

---

## 4. Role matrix (the five roles the schema allows, and only those)

`admin_accounts.role` cannot hold anything else until a migration says so
(`001_central_schema.sql:178`). Adding "GROWTH_MANAGER" or "SUPPORT_LEAD" is a §9 stop.
`SUPER_ADMIN` is **never** created by any code path in this plan (area 32); provisioning
an admin stays a `SUPER_ADMIN`-only act, and the first administrator continues to come from
the operator-run bootstrap.

| Capability | SUPER_ADMIN | OPERATIONS | FINANCE_AUDITOR | KYC_SPECIALIST | SUPPORT_AGENT |
|---|---|---|---|---|---|
| Dashboard KPI aggregate | ● | ● | ● | ○ | ○ |
| Live operations centre + map | ● | ● | ○ | ○ | ○ |
| Customers: read / suspend | ● / ● | ● / ○ | ○ / ○ | ○ / ○ | ● / ○ |
| Drivers: read / status | ● / ● | ● / ● | ○ / ○ | ○ / ○ | ○ / ○ |
| KYC queue: read / decide | ● / ● | ● / ○ | ○ / ○ | ● / ● | ○ / ○ |
| Merchants: read / manage | ● / ● | ● / ● | ○ / ○ | ○ / ○ | ○ / ○ |
| Catalogue + bulk | ● | ○ | ○ | ○ | ○ |
| Orders: ride / food / parcel read | ● / ● / ● | ● / ● / ● | ● / ○ / ○ | ○ | ● / ● / ● |
| Dispatch reassign | ● | ● | ○ | ○ | ○ |
| Trip manual transition | ● | ● | ○ | ○ | ○ |
| Payments read / refunds | ● / ● | ○ / ○ | ● / ● | ○ | ○ |
| Wallets read / adjust | ● / ● | ○ / ○ | ● / ● | ○ | ○ |
| Ledger + settlements + payouts | ● | ○ | ● | ○ | ○ |
| Pricing / surge / geofence | ● | ● | ○ | ○ | ○ |
| Coupons | ● | ● | ○ | ○ | ○ |
| Campaigns / ads / banners | ● | ● | ○ | ○ | ○ |
| Branding + theme | ● | ○ | ○ | ○ | ○ |
| Notifications: read / broadcast | ● / ● | ○ / ○ | ○ | ○ | ○ / ○ |
| Support | ● | ● | ○ | ○ | ● |
| Disputes | ● | ○ | ● | ○ | ● |
| Audit: view / export | ● / ● | ○ / ○ | ● / ● | ● / ○ | ○ |
| Admin accounts | ● | ○ | ○ | ○ | ○ |
| Security centre / revoke sessions | ● | ○ | ○ | ○ | ○ |
| Health + integrations (no secrets) | ● | ○ | ● | ○ | ○ |
| Settings + feature flags | ● | ○ | ○ | ○ | ○ |
| Reports / exports | ● | ● | ● | ○ | ○ |
| AI assistant: query / act | ● / ● | ● / ○ | ● / ○ | ○ | ● / ○ |

● full · ○ none. Row-by-row additions (e.g. "OPERATIONS may broadcast to one zone") are a
configuration question once §2.2 is fixed, not a code change.

---

## 5. Area-by-area map: 50 requested areas against measured reality

### Data & monitoring

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 1 | Real-time dashboard, ~23 KPIs, TODAY/YESTERDAY/7D/30D/custom | PARTIAL — `GET /api/admin/metrics` (memory-derived) and `/api/admin/finance/metrics` | No single aggregate read model; no date range parameter; no charts; KPI list not defined; `metrics` has no permission | B |
| 2 | Live operations centre with the full timeline | PARTIAL — `orders` rows are immutable and `order_transitions` exists; `GET /api/admin/jobs` dumps everything | No per-order timeline endpoint joining booking→payment→dispatch→…→settlement; no live stream | C |
| 3 | Operational map (drivers, trips, zones, geo-fences, surge) | PARTIAL — `fleetLocations` is **memory-only**, `geo_fences`/`surge_zones` are real tables, `GET /api/admin/geofences`+`surgezones` exist | No combined map endpoint; driver positions lost on restart; must not expose customer PII coords — currently would, since nothing projects them | C |
| 35 | System health without secrets | EXISTS since this phase: `/api/health` and `/api/ready` no longer echo `connection.error`, `GET /api/admin/supabase-status` is admin-only and strips the engine's words | Needs a `system.health` permission and a dashboard card that reads it | A |
| 40 | Permission-respecting global search | MISSING | New endpoint that fans out over already-gated reads and drops the sections the caller lacks | B |
| 41 | Activity timelines | PARTIAL — `audit_logs` per actor exists and `GET /api/admin/audit-logs` is gated `audit.view` | No per-entity (order/customer/driver) timeline view | B |
| 43 | Backup/recovery **visibility**, no restore/delete controls | MISSING | Read-only surface over what the local store can answer; **no** restore, **no** deletion, per area 43 | F |
| 47 | Real-time without excessive polling | PARTIAL — backend already `broadcastToAdmins` and has a `channel: 'admin:fleet'` | No consumer anywhere in `admin-web/` (`grep` in §1.2) | C |

### People

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 4 | Customer management incl. suspend + force logout | MISSING as an admin API — `users` table and `active_sessions`/`backend_sessions` exist | Needs read (projected, no password columns), suspend via `is_active`, and session revoke; **no hard delete** of records with financial or audit trail | D |
| 5 | Driver management | PARTIAL — `GET /api/admin/drivers`, `GET /:id`, `POST /:id/status` (`fleet.manage`) | No profile edit, no document list, no per-driver timeline | D |
| 6 | KYC queue with private document storage | EXISTS — `identity-verifications` list/`review`/`lock`/`unlock`, `identity_documents` table, `/docs/:filename` preview | `identity_documents.view` is granted but **unenforced**; the `identity_documents` table holds **0 rows and no code touches it**, so the queue and its reviews are process memory only (§2.5) | D |
| 7 | Merchant management with tenant isolation | PARTIAL — `POST /api/admin/restaurants/:id/status`, `GET /api/restaurants` for admin | No merchant detail/edit; **the suspend action writes a memory copy that no column can hold** (`merchants` has 39 rows and only `is_open`, §2.5); merchant-scoped endpoints already prove tenant isolation via `requireMerchantTenant` and reuse it here | D |
| 32 | Admin users, least privilege, no auto SUPER_ADMIN | PARTIAL — `GET/POST /api/admin/accounts` gated by `admin_accounts.{manage,create}` since A1; since A4 `POST /api/admin/accounts/:id/status` (`admin_accounts.manage`) enables and disables with the last-enabled-`SUPER_ADMIN` guard, and revokes every session of the account as it disables (§1.4) | No permission UI (blocked by §2.2), no least-privilege grant for the 26 §2.3 names; the 15 ungated admin reads in §2.3 are still open to any token; enable/disable is audited, a role or grant change is not possible at all yet | A |

### Transactions

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 8 | Catalog / products with bulk update | PARTIAL — `master-catalog` CRUD (memory-only, §2.5), `grocery/products/:id/review` | No bulk operation; persistence of master-catalog writes, and `priceStatus` has **no column** either, so a freeze is process memory only (§2.5) | E |
| 9 | Ride management | PARTIAL — `GET /api/admin/jobs` dump, `POST /api/rides/:id/cancel` is customer-side | No filtered admin ride list, no admin-initiated cancellation with a reason code and audit | E |
| 10 | Food order management | PARTIAL — `POST /api/admin/orders/expire-stale` (`orders.manage`) | No admin order list/detail with the state machine's legal moves | E |
| 11 | Parcel incl. proof of delivery | PARTIAL — parcel jobs exist; delivery-proof uploads exist on the driver path | No admin view of proof images behind `parcel.proof.view` | E |
| 12 | Dispatch monitoring, no rule bypass | PARTIAL — `dispatch_offers` table, `accept_dispatch_offer_atomic`, offers cache | No admin dispatch board; any reassign must go through the same rule evaluation, never around it | C |
| 13 | Trip state machine, invalid manual transitions prevented | EXISTS as a guard — `transition_order_state` + `is_valid_order_transition`, with `actor_type='ADMIN'` | No admin endpoint that *only* offers legal transitions; must not write `status` directly | C |
| 14 | Payments | PARTIAL — `payments`, `payment_sessions`, `checkout_events` tables; `finance.view` | No admin payment list/detail; gateway identifiers only, never secrets | E |
| 15 | Refunds, never duplicate | EXISTS — `refund_payment_atomic` (`FOR UPDATE` + `refundable_left`, `payment_refund_authorizations.idempotency_key` UNIQUE, `uq_payment_ticket_refund`), `POST /api/admin/finance/refund` (`finance.refund`) | Needs a UI that surfaces idempotency rather than re-submitting | E |
| 16 | Wallets, no direct balance edit | EXISTS as a guard — `adjust_wallet_atomic`, non-negative CHECK on `wallet_balance` | No admin wallet read; every adjustment must call the RPC, never `update users set wallet_balance` | E |
| 17 | Ledger / finance as authoritative | EXISTS — `ledger_entries`, `journal_*`, `chk_balanced_entry (total_debit = total_credit)`, append-only triggers; `GET /api/admin/finance/ledger`, `/ledger-double-entry`, `/adjustments` | No admin surface that states "this cannot be edited" rather than offering an edit | E |
| 18 | Payouts | PARTIAL — `driver_payouts` table + append-only trigger, `POST /api/admin/finance/settlements/drivers/:id/payout`, `verify-payout-destination` | The table has **no writer**; decide whether payout records belong there or are derived from ledger before building a screen (design question, §11) | E |

### Configuration & growth

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 19 | Pricing with effective dates | PARTIAL — `pricing_configurations`, `GET/POST /api/admin/pricing` (`pricing.edit`) | No effective-dated rows: editing pricing changes history | F |
| 20 | Surge | PARTIAL — `surge_zones`, `GET/POST /api/admin/surgezones` | No delete/edit, no audit of a surge change's blast radius | F |
| 21 | Geo-fences | EXISTS — `geo_fences` + list/create/delete (`geofence.*`) | No edit; no map surface | F |
| 22 | Promotions / coupons | EXISTS — `promotions` CRUD + `/redemptions`, `redeem_promotion_atomic`, server-authoritative checkout | No activate/expiry permission; `PUT /:id` already `promotion.edit` | F |
| 23 | Festival / campaign manager without an APK update | EXISTS — `campaigns` + `campaign_*` tables, 7 admin routes, CAS revision edits, `resolve_live_campaigns()`, consumed via `GET /api/app/config` | This is the reference pattern the other config areas should copy | — |
| 24 | Dynamic branding | PARTIAL — branding payload is on the config feed | No admin editor behind `branding.edit` | F |
| 25 | Dynamic theme, no arbitrary code execution | EXISTS and must stay — validated theme section on `/api/app/config`, Flutter renders through a `ThemeExtension` | Admin editor surface only; validation is the security control, keep it | F |
| 26 | Banners | PARTIAL — banners are `advertisements` with a placement | Needs its own permission + placement UI, reusing the ad routes | F |
| 27 | Advertisements | EXISTS — `advertisements` CRUD, PG-backed, `advertisement.*` | UI missing | F |
| 28 | Notifications, no unauthorised mass messaging | PARTIAL — `POST /api/admin/notifications/broadcast` (`notification.broadcast`, 1-per-15-min process-local window) | Rate window is in-memory so it resets on restart; targeting rules and an approval step needed | F |

### Service, security, shell

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 29 | Support | EXISTS — `GET /api/admin/support`, `assign`, `resolve` (`support.*`) | UI missing; tickets are boot-synced copies (§2.5) | G |
| 30 | Disputes | MISSING — no table, no route, no screen | New domain: a migration to create `disputes`, or model as a typed `support_tickets`. §11 decision, and the migration branch is a §9 stop | G |
| 31 | Audit log protected from normal deletion | EXISTS — `trg_audit_logs_immutable` + `GET /api/admin/audit-logs`; since A3 a refused write is announced instead of vanishing, and since A3b the 26 control-plane writes are awaited and a refusal answers 503 (§2.7) | 20 writes stay un-awaited for stated reasons (§2.7's table), so a 200 on those is still not proof the record landed; and three admin mutations have no column to land in at all (§2.5) | A |
| 33 | Permission matrix with named permissions, enforced server-side | PARTIAL — 55 of 72 `authenticateAdmin` routes gate on 40 names, and since A1 the grants come from one file (§2.3). Since A4 the whole map is **proven rather than described**: `admin_authorization_test.js` parses the route table out of `src/server.js` and refuses all 193 (route, role) pairs that should be closed, allow-probes 36 names through a handler-validated request, and compares `GET /api/admin/me` against the catalogue per role | 12 ungated admin reads answer to any token, 9 catalogue names grant nothing anywhere, and 26 gated names are unreachable for a least-privilege role (§2.3); 4 decisions sit inside handlers in a fourth spelling; nothing is persisted, so per-admin overrides need the §9 migration. 4 names (`notification.broadcast`, `orders.manage`, `geofence.create`, `surge.create`) have no *safe* allow probe, so a holder reaching them is unproven — recorded in the harness, not hidden. §3 is the target catalogue | A |
| 34 | Security centre | EXISTS as an API surface since A4 — `GET /api/admin/security/sessions` (`security.view`), `GET /api/admin/security/login-lockouts` (`security.view`), `POST /api/admin/security/sessions/revoke` (`security.session.revoke`, by handle or by account, durable-store-first, audited through `auditAppliedChange`), and the account enable/disable write that cuts sessions with it (§1.4) | No dashboard screen reads any of it yet (phase A shell work, area 40/45); the lockout counters are this-process-only because `failed_attempts`/`locked_until` are dead columns (§1.4) — durable lockouts and a last-seen-IP trail need a migration → §9 | A |
| 36 | Integrations, never display secret values | PARTIAL — `platform_settings` holds mixed data | Show presence/configured-state + last check, never a value; `PUT` rejects anything secret-shaped | A |
| 37 | Settings, secrets not editable from admin UI | PARTIAL — `GET/PUT /api/admin/platform-settings` (`requireSuperAdmin`) | Needs an allow-list of keys, not an open key/value editor over a table that also holds config the server reads at boot | A |
| 38 | Feature flags that cannot bypass controls | PARTIAL — `features` routes, `is_feature_enabled()`, and since A2 a write surface limited to flag keys (§2.4) | Flags must remain unable to disable auth/authz/payment/RLS/audit; the routes are still role-checked rather than name-checked, and neither write is audited | A |
| 39 | Reports with CSV/XLSX/PDF | MISSING | CSV first (no dependency), XLSX and PDF only if a library already exists in the tree — it does not, so both are a §9 dependency decision | B |
| 42 | Data export with field filtering + audit | MISSING | Built on `report.export`/`audit.export`; field filtering is *subtraction from a fixed projection*, never caller-supplied column names | B |
| 44 | Admin AI assistant on authorised tools only | MISSING — **no LLM integration exists anywhere in the repo** (verified: no `openai`/`anthropic`/`llm` reference in `backend/src`, `admin-web/src`, `customer-web/src`, `mobile/lib`) | Requires (a) an external model provider = new dependency + new secret + customer data leaving the boundary, and (b) the tool layer must call the same permission-checked services with the *caller's* session. See §11 — this is a decision to make, not a phase to build | — |
| 45 | Mobile-responsive admin, not shrunk tables | MISSING | Card/list layouts under 768px; the existing `ResourceTable` is desktop-only | G |
| 46 | Per-admin dashboard customisation | MISSING | Needs a persisted per-admin preferences store — same §9 migration family | G |
| 48 | Accessibility | MISSING as an enforced property | Keyboard nav, focus order, labelled controls, contrast, live-region announcements for the realtime feed | G |
| 49 | Confirmation that states exactly what will happen | MISSING | A single dangerous-action dialog fed by the mutation's own effect description, used by suspend/payout/killswitch/refund/flag | A |
| 50 | Security controls never bypassed by UI, AI or client | Governs everything above | One enforcement point (§2.1 consequence), no client-supplied id/role/ownership/amount/time, and the AI tool layer shares the same gate | all |

---

## 6. Reuse list — what to call instead of writing

**Database guards (already proven; these are the reason areas 15/16/17/22/35 can be
trusted):** `adjust_wallet_atomic`, `refund_payment_atomic`, `capture_payment_atomic`
(returns `duplicate: true` and the authoritative persisted amount), `cancel_ride_atomic`,
`redeem_promotion_atomic`, `create_order_with_lines_atomic`, `transition_order_state` +
`is_valid_order_transition` (`actor_type` `'ADMIN'`), `accept_dispatch_offer_atomic`,
`is_feature_enabled()`, `resolve_live_campaigns()`, `campaign_effective_status()`,
`settle_trip`.

**Backend layers to extend, not duplicate:**
- `storeReply` / `isStoreUnreachable` in `backend/src/supabase.js` — the outage-vs-business
  classifier every new admin read must use (directive 4; proven by
  `backend/outage_semantics_audit.js`).
- `requirePermission` + the §3 catalogue — the only place authorisation is decided.
- `appConfigService` (+ its ETag/last-known-good contract) — the delivery path for
  themes/branding/banners/campaigns, so no new polling surface appears.
- `featureControlService` — flag reads with location overrides.
- `broadcastToAdmins` and the `admin:fleet` socket channel — the realtime source for
  areas 2/3/47.
- `authoritativeWrite` / `authoritativeRead` / `auditAuthoritative`
  (`database.js:5068`–`5119`) — the awaited-audit pattern for directive (7)'s "every sensitive
  operation is audited". An audit failure there becomes a 503 with a code, not a 4xx.

**Frontend components to reuse:** `admin-web/src/components/ResourceTable.tsx`,
`CampaignEditor.tsx` (the pattern for a revision-carrying config editor),
`AuthProvider.tsx` (where the permission set from `GET /api/admin/me` should land), and
`AdminLayout.tsx` (where the nav becomes permission-driven).

**Design references:** `.agents/skills/ui_ux_pro_max` and
`.agents/skills/frontend_developer` are the conventions for the shell work in phase G;
`docs/design/` holds the existing visual direction.

---

## 7. Implementation phases

Each phase is a unit of *verification*, not just of writing: nothing is called done
before its gate passes, and each phase ends in one local commit. **No push, no deploy.**

### Phase A — Authorisation ground (areas 31, 32, 33, 34, 35, 36, 37, 38, 49, 50)
1. ✅ **Done (A1).** Fail-closed role: an unknown `admin_accounts.role` is refused at
   provisioning with `ADMIN_ROLE_UNKNOWN` (`database.js:3977`) and refused at sign-in,
   instead of silently becoming `OPERATIONS`.
2. ✅ **Done (A1).** One permission catalogue — `backend/src/adminPermissions.js` — read by
   the boot sync, provisioning, the OTP resolution path and the bootstrap route;
   `GET /api/admin/me` returns `{ role, permissions }` so the UI can gate honestly (§2.3).
   `requirePermission`'s literals still live at the routes; centralising *those* is the
   remaining half of this item and belongs with the §11 naming decision.
3. ➜ **Part done (A1).** `accounts` is on `requirePermission('admin_accounts.{create,manage}')`
   and the dead `'admin.manage'` string in `reset-password` is now a real name. `features`
   (§2.4) and the `identity_verification` decision checks are still in-handler.
4. ✅ **Found during A1, done.** Sessions no longer persist a password hash and salt, and
   `/api/admin/me` no longer serves them (§2.1 item 3, `RBAC-14`–`RBAC-16`).
5. ✅ **Done (A2).** Namespace feature-flag keys so a flag write cannot address another
   domain's setting (§2.4).
6. ✅ **Done (A3 + A3b).** A dropped audit write is announced with its action and target
   rather than falling into the process-wide rejection net (§2.7,
   `audit_drop_visibility_test.js`, AD-01…AD-08), and **26 of the control-plane writes now
   await their record** — a refused one answers 503 with `applied: true` instead of a 200 that
   claimed the trail existed (§2.7, `admin_audit_fail_closed_test.js` AF-01…AF-11 + ST-01…ST-06,
   proved through the wire by `outage_semantics_audit.js` OS-05/OS-06). **Open:** the 20 writes
   that stay un-awaited for the reasons tabled in §2.7, and the three admin surfaces in §2.5
   whose state never reaches PostgreSQL at all — the latter needs new columns, so it is a §9
   stop rather than more Phase A work.
7. ➜ **Part done (A4).** The security-centre **API** is live and gated: the session list,
   the lockout read labelled for what it actually covers, revoke by handle or by account
   with the durable store written first, the account status write that cuts sessions as it
   disables, and the fail-closed audit on all three (§1.4, §5 rows 32 and 34).
   **Open:** the single dangerous-action confirmation component (area 49) and a dashboard
   screen that reads any of this surface — both are admin-web work, and until they exist
   the security centre is reachable only over HTTP.
   **Found while gating it, fixed:** `POST /api/admin/services/emergency-killswitch` read
   its direction as `if (activate)`, so a body that omitted the field lifted the lockdown —
   the one admin mutation where doing nothing by accident was the dangerous answer. The
   direction is now required (`KILLSWITCH_DIRECTION_REQUIRED`, 400), and
   `authenticateAdmin`'s store-fallback branch accepts any administrator role rather than
   only `ADMIN`/`SUPER_ADMIN`, which had made an OPERATIONS or KYC token that reached that
   branch a live session the door refused to read.
8. ⬜ Settings/integrations: key allow-list, secret values never rendered, never writable.

**Gate:** ✅ `test_suite.js` green *plus* `admin_authorization_test.js`, which replaced the
hand-picked `RBAC-01..12` model with the whole measured map: 109 assertions — 193
(route, permission) refusals across the four non-super roles, one validated allow probe per
permission, per-role agreement between `GET /api/admin/me` and the catalogue, and
revocation proven by using the revoked bearer afterwards. The two halves it deliberately
does **not** prove are named in the file with their reasons (4 permissions with no harmless
probe body; the last-`SUPER_ADMIN` guard, proven against a stubbed store so the platform's
own account is never one bad refactor away from being unreachable).

### Phase B — Read models & dashboard (areas 1, 39, 40, 41, 42)
KPI aggregate endpoint with explicit ranges and a `dataSource` label per number; the KPI
list agreed in §11; `order_transitions`-based timelines; permission-filtered global
search; CSV export with a fixed projection and an audit record. Charts via an
existing-dependency-only rule (see §11: nothing is added without approval).

**Gate:** every number traceable to a table + filter in the test; an outage of the store
returns 503 for each of them (extended `outage_semantics_audit.js`); export emits audit.

### Phase C — Live operations (areas 2, 3, 12, 13, 47)
One per-order timeline endpoint; the admin realtime consumer over the existing
`broadcastToAdmins`/`admin:fleet` channel with backoff instead of polling; the map from
persisted positions (needs `fleetLocations` durable — a §9 migration or a `platform_
settings`-scoped table); dispatch board that can only re-offer through the dispatch rules;
manual trip transitions exclusively through `transition_order_state`.

**Gate:** an invalid manual transition is refused by the database, not by the UI; the map
never carries customer coordinates; two concurrent admins cannot double-transition a trip.

### Phase D — People (areas 4, 5, 6, 7)
Customer/driver/merchant surfaces on projected reads, suspend not delete, session revoke,
KYC queue with `identity_documents.view` actually enforced, merchant detail with the same
tenant isolation the merchant endpoints already use.

**Gate:** a `SUPPORT_AGENT` cannot reach a driver's document path; no endpoint performs a
hard delete on a record with ledger, payment or audit references.

### Phase E — Transactions (areas 8–18)
Admin lists for rides/food/parcel; payment and wallet reads; proof-of-delivery viewing;
payout records (after the §11 decision); master-catalog persistence and bulk update.

**Gate:** money only moves through the §6 guards; a duplicate refund is impossible at the
database level and the test proves it twice concurrently; no raw balance write anywhere in
the diff (`grep` assertion in the harness).

### Phase F — Configuration & growth (areas 19–28, 43)
Pricing with **effective dates**; surge/geofence edit; coupon activate; branding/banner/
ad editors delivered through the config feed; notification broadcast with durable rate
limiting and targeting; backup/recovery **visibility** only.

**Gate:** a live campaign/pricing change reaches a client without an APK update (the
pattern proved in Phase 3); the 15-minute broadcast window survives a restart; no restore
or delete control exists in the diff.

### Phase G — Shell, service, accessibility (areas 29, 30, 45, 46, 48)
Support console; dispute handling (after the §11 modelling decision); responsive layouts
below 768px rather than shrunk tables; per-admin dashboard preferences; accessibility pass
with the realtime feed announcing through a live region.

**Gate:** keyboard-only completion of refund, suspend and killswitch; screen-reader labels
on every new control; layout verified at 360/768/1024/1440.

### Not scheduled: Phase H — the AI assistant (area 44)
It is last and it is a decision, not a task (§11). If approved, its tool layer calls the
same services the buttons call, under the caller's session, and "high-risk action" means
the same area-49 confirmation with no shortcut path.

---

## 8. Verification contract

| Harness | Proves | Run |
|---|---|---|
| `backend/test_suite.js` | 415 existing assertions incl. `RBAC-01..12`, `CC-00..17` | every phase |
| `backend/outage_semantics_audit.js` | 5xx-vs-4xx semantics under a real store outage, incl. `AUDIT_RECORD_UNAVAILABLE` on the converted control-plane writes | phases touching store traffic |
| `backend/payment_verifier_config_test.js` | verifiers fail closed when unconfigured | any payment/refund change |
| `backend/restart_test.js`, `test_phase4_orders.js`, `test_phase5_payments.js` | durability across restart, order/payment invariants | phases C/E/F |
| `backend/cloudinary_test.js` | media surface | phase F/E media |
| `backend/audit_drop_visibility_test.js` (**new, A3**) | a refused trail is announced with its module, action and target, and never reaches the process-wide rejection net | any audit-path change |
| `backend/admin_audit_fail_closed_test.js` (**new, A3b**) | each converted mutation rejects 503 `applied: true` when its record is refused, the state really did change, no route that awaits one can hang or answer 400, and the deliberately unconverted paths stay unconverted | any audit-path change |
| `backend/admin_authorization_test.js` (**new, A4**) | 109 assertions: the guard map parsed from `src/server.js` (55 gated routes / 40 names), all 193 (route, non-super role) pairs refused with 403 naming the permission, one handler-validated allow probe per permission, `GET /api/admin/me` equal to the catalogue per role, revocation proven by using the revoked bearer, cross-instance sessions honoured and revocable, disable-cuts-sessions, and the four guards that must never be fired over HTTP proven against a stubbed store | phases A–G |
| Flutter `main_admin.dart` widget tests + `flutter analyze` | the admin mobile app | phases with mobile changes |

Preconditions that make a run trustworthy are recorded in project memory
(`nabin-backend-suite-preconditions.md`): both payment secrets exported into the server's
env, restart-to-load, the 15-minute broadcast window, the surge row, and never two
harnesses at once.

`admin_authorization_test.js` adds one of its own: it **writes** — four throwaway `authz_*`
administrator accounts per run, one `backend_sessions` row for the cross-instance case, and
their revocations — so it is a local-store harness and nothing else. Its CLN section sweeps
every `authz_*` account in the directory to `INACTIVE`, including those a crashed earlier run
left behind, and asserts afterwards that none is enabled (CLN-01).

---

## 9. Approval stops — work this document does **not** authorise

I will stop and report before:

1. **Any migration beyond 027** (directive 16). Six items want one: persisting the
   role/permission matrix (§2.2), durable fleet locations (area 3), per-admin dashboard
   preferences (area 46), `disputes` as a table (area 30), durable administrator login
   lockouts — whose two columns exist and are dead, so the security centre can only report
   one process's counters today (§1.4) — and the three control-plane
   mutations that currently have nowhere to be written — merchant suspension, the identity
   review queue, and grocery price review (§2.5). Areas 6, 7 and 8 cannot be finished without
   the last one, because their buttons change process memory only. Migrations 001–026 are
   frozen; 027 stays local-only and is not applied to any hosted environment.
2. **Any financial correction or settlement-logic change** (directives 14/15) — including
   the `driver_payouts` writer question and the FI-08 evidence, which stays as documented
   in `docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md`.
3. **Adding a dependency** — chart library, XLSX/PDF writer, or any model provider for
   area 44. Each is also a new secret and, for the AI case, a data-egress decision.
4. **Anything touching hosted Supabase, pushing, or deploying.**
5. **Scrubbing the 307 legacy session rows that still hold a credential pair** (§2.1). The
   write and read paths are fixed forward, and a restart leaves no in-memory copy either, so
   what remains is exposure *at rest* in rows no longer used for anything. Locally, the
   statement is one line and touches no other column:

   ```sql
   UPDATE public.backend_sessions
      SET entity = entity - 'passwordHash' - 'salt'
    WHERE entity ? 'passwordHash' OR entity ? 'salt';
   ```

   The alternative — deleting those rows outright — loses the sign-in trail they are part
   of, so it is not the default. Either way: local store first, count verified before and
   after, and never against a hosted project without a separate explicit request.

---

## 10. Explicit non-goals

- No new admin panel framework, no second auth system, no parallel config feed: the
  campaign + `/api/app/config` path is the pattern.
- No hard delete of customers, drivers, merchants, orders, payments, ledger or audit rows.
- No UI-only permission model, no client-supplied effective status or server time.
- No `SUPER_ADMIN` creation, enablement or auto-provisioning.
- No visual redesign of working screens; area 45's responsiveness is a layout requirement,
  not a restyle (directive 18).
- No RLS claim in any test name or comment until §2.1 is actually fixed.

---

## 11. Open decisions — answers needed before the phase that depends on them

| # | Question | Options | Needed by |
|---|---|---|---|
| 1 | Where does the permission matrix live? | (a) keep role-derived grants in code, per-admin overrides deferred; (b) migration 028 adding `admin_role_permissions` + `admin_account_permissions` | A |
| 2 | KPI list for area 1 | approve the ~23 named in the directive, or trim to what the tables can answer honestly today | B |
| 3 | Reports | (a) CSV only, zero dependencies; (b) add XLSX; (c) add PDF | B |
| 4 | Driver positions | (a) persist to a new table (migration); (b) accept a map that resets on restart and label it as such | C |
| 5 | `driver_payouts` | (a) write payout rows there; (b) derive the payouts view from `ledger_entries` | E |
| 6 | Disputes | (a) type of `support_tickets`; (b) its own table (migration) | G |
| 7 | AI assistant | (a) not built; (b) internal-only rules/no LLM; (c) external provider with a written data-egress position | after G |
| 8 | RLS | (a) document the Express-only enforcement and keep projecting columns explicitly; (b) design per-request scoped tokens | A |
| 9 | The duplicate `GET /api/admin/drivers` (§1.1) | (a) delete the dead second registration; (b) merge the two response shapes into the live one; (c) leave it and rename the second path | A |
| 10 | Who besides `SUPER_ADMIN` may hold the 26 gated names no non-super role reaches (§2.3) — the emergency killswitch, service pause/resume, account provisioning, campaign publish, session revoke | (a) leave them super-only and say so on the screen; (b) assign them per role in `adminPermissions.js`, which is one edit with a per-route effect and needs no migration | A (closes rows 32 and 33) |
| 11 | The 12 admin reads with no gate of any kind (§2.3) | (a) bind each to a catalogue name that already exists (`services.view`, `promotion.view`, `catalog.manage`, `merchant.manage`, `fleet.manage`, `audit.view`) plus `system.health` from §3; (b) declare them "any signed-in administrator" reads, and record that as the decision instead of leaving it as drift | A |
| 12 | Administrator lockout trail | (a) accept the per-process counter and keep labelling it as §1.4 does; (b) migration: write `failed_attempts`/`locked_until`, or an `admin_login_events` table, so a second instance and a restart see the same answer | when the security screen is built |

Answers to 1, 3, 4, 5, 6, 8 and 12 change schema or dependencies, so they are the first
things worth settling; the rest can be decided at the head of their phase.
