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

**One path was registered twice, and the second copy was dead**: `GET /api/admin/drivers`
existed at `server.js:1419` and again at `server.js:4663` when this baseline was taken.
Express answers with the first, so the second handler never ran — a shape change made there
is invisible at runtime, which is the kind of defect area 5's driver list cannot absorb. It
was listed here as an open decision because picking the survivor means deciding which
response shape is correct; **§11 answer 9 settled it on 2026-09-22 and D2 deleted the dead one
on 2026-09-23**, which is why §2.3 counts fourteen ungated admin routes rather than fifteen.
`admin_authorization_test.js` CAT-06 now parses every registration in the file and fails the
run if any method+path appears twice, so the deletion cannot be quietly undone. The
authenticateAdmin-only row above still lists `drivers`×2 for the same reason the rest of the
table is a snapshot: it is what A1 measured, and the live numbers are the ones CAT-01 prints.

Existing route groups by prefix: `services` (4), `accounts` (2), `audit-logs` (1),
`advertisements` (4), `campaigns` (7), `drivers` (5), `finance` (7), `features` (3),
`geofences` (3), `grocery` (3), `identity-verifications` (5), `jobs` (1),
`master-catalog` (5), `metrics` (1), `notifications` (1), `orders` (1), `platform-settings`
(2), `promotions` (4), `pricing` (2), `restaurants` (2), `reset-password` (1), `me` (1),
`supabase-status` (1), `surgezones` (2), `support` (3), `bootstrap`/`login`.

### 1.2 The admin web surface

`admin-web/` (Next.js) has **eight pages** and **nine components/lib files** (re-measured
after D3 added the customers screen and `lib/access.ts`; A5 had added the security screen and
the confirmation modal):

```
src/app/login/page.tsx      src/app/page.tsx        (metrics + service switchboard)
src/app/drivers/page.tsx    src/app/merchants/page.tsx
src/app/orders/page.tsx     src/app/campaigns/page.tsx
src/app/security/page.tsx   src/app/customers/page.tsx
src/components/{AdminLayout,AuthProvider,ResourceTable,CampaignEditor,ConfirmAction}.tsx
src/lib/{api.ts,campaigns.ts,refusals.ts,access.ts}
```

`src/lib/api.ts` exposes 28 methods — 25 on `adminApi`, 3 on `authApi` — and every one of
them is now reached by a page; the four customer calls arrived with the screen that needed
them. Measured absences:

- Permission checks exist in **three** places: `/security` and `/customers` each gate their
  action buttons on the caller's grants, and `AdminLayout` hides a nav entry whose permission
  the caller lacks — now through `holdsPermission()`, the client's copy of
  `adminHoldsPermission`, so `SUPER_ADMIN`'s wildcard is applied the same way the server
  applies it rather than relying on its grant list happening to be complete. Every other page
  still renders the same controls for every role, so a least-privilege administrator there is
  refused by the server rather than by the screen (#61, §11 decision 10 — carried out on the
  one surface it was answered for, not platform-wide).
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
   administrator, i.e. a design change to the store connection. **Decided 2026-09-22
   (§11 answer 8: option (a)).** This project documents Express-only enforcement and keeps
   projecting columns explicitly; scoped per-request tokens are not adopted, so §9 keeps the
   migration/design stop and no phase in §7 may assume a second defence layer exists. Every
   "authorised server-side" claim in this document therefore means *the Express layer*, and
   the review that follows an admin read is a review of its column list.
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

**Decided 2026-09-22 (§11 answer 1: option (a)).** The matrix stays role-derived in
`adminPermissions.js`; migration 028 is not authorised, so per-administrator overrides are
deferred and the consequences above are the accepted shape rather than a pending fix. Two
rules follow for everything built on top of it: a screen may only gate on what
`GET /api/admin/me` reports for the caller, and any statement about *who* was allowed to do
something is a statement about their role on that day, which is why the audit trail records
the role and the permission name with every action rather than a derived grant list.

### 2.3 The catalogue has one source now; three gaps remain inside it

After Phase A1 the role→grants answer exists in exactly one file, `backend/src/adminPermissions.js`.
It replaced three copies that disagreed — the boot sync's 40 strings, `createAdminAccount`'s 18,
and the bootstrap route's own 41 — and which of them won depended on whether the process had
restarted since the account was created. The catalogue is now **55** names (A4 added
`security.view` and `security.session.revoke`, D1 added `customers.read` and
`customers.suspend`); **46** of them gate **60** of the 76 `authenticateAdmin` routes,
**9** gate no route at all, and every count in this section is
re-measured from `src/server.js` on each run by `admin_authorization_test.js` CAT-01…CAT-05
rather than restated by hand.

- **Enforced but granted to no non-super role** (27 — the 26 measured when §11 answer 10
  was recorded, plus D1's `customers.suspend`; up from the 11 measured at A1 because
  completing the `SUPER_ADMIN` list made the gap visible, not because it grew):
  `admin_accounts.{create,manage}`, `advertisement.{create,edit,delete}`,
  `campaign.{view,create,edit,publish,delete}`, `catalog.manage`, `customers.suspend`,
  `geofence.{create,delete}`, `grocery.review`, `notification.broadcast`,
  `orders.manage`, `pricing.edit`, `promotion.{view,create,edit}`,
  `security.{view,session.revoke}`, `services.{pause,resume,emergency_killswitch}`,
  `surge.create`. `SUPER_ADMIN` reaches them through the role wildcard at `server.js:847`,
  so nothing is broken today — but the nineteen names a non-super role does hold
  (`audit.view`, `customers.read`, `finance.*`, `fleet.manage`, `geofence.view`,
  `identity_documents.view`, `identity_verification.*`, `merchant.manage`, `support.*`,
  `surge.view`) are the whole of least privilege today, which is precisely what area 33
  asks for. **Decided 2026-09-22
  (§11 answer 10: option (a)):** the twenty-six stay `SUPER_ADMIN`-only and are *not* spread
  across the other four roles — and `customers.suspend`, added by D1 afterwards, joined the
  same set under the same rule rather than being spread. That is now a stated position
  rather than an accident of the wildcard, so the
  surface has to carry it: a control bound to one of those names is either hidden or shown
  as super-only for a caller whose `GET /api/admin/me` does not report the name, and never
  rendered as an ordinary button that answers 403. `security.view` was the shape to copy —
  `admin-web/src/app/security/page.tsx` already gated each action on `user.permissions` — and
  since D3 `app/customers/page.tsx` carries it too, through `lib/access.ts` so the wildcard
  rule matches the server's rather than depending on a grant list being complete, with the
  missing name stated in the row where the control would have been. That is two of the six
  pages; the other four still render whatever the role cannot do (§11 answer 10's remaining
  reach, #61).
- **In the catalogue, gated on no route** (9): `audit.export`, `geofence.edit`,
  `identity_documents.download`, `notification.view`, `promotion.activate`, `services.view`,
  `support.escalate`, `surge.{edit,activate}`. Until D2 this list had thirteen entries, and
  the four that left it did so because they became enforced rather than because a count was
  edited: `identity_documents.view` is now asked for by `GET /docs/:filename`, and
  `identity_verification.{approve,reject,request_resubmission}` by `requireIdentityDecision`
  on the review route. Several of the nine are exactly what areas 20, 22, 28, 31 and 42 ask
  to be real — a surge edit, a coupon activation, a notification history read, an audit
  export. They are names the old bootstrap map carried and no route ever checked, so area 33
  cannot gate on them until the guard exists.
- **Decided inside a handler, not by middleware** (4 routes): the queue's two identity reads
  call `adminHoldsPermission(req.admin, 'identity_documents.view')` to decide whether the
  applicant's raw Aadhaar and voter-ID come back at all (§5 row 6), `reset-password` allows
  self-or-`admin_accounts.manage` through the same predicate, and
  `PUT /api/admin/features/:key` compares `req.admin?.role` to `SUPER_ADMIN` by hand
  (`server.js:6059`). §3 does name a gate for flag writing — `feature.edit` — but it is a
  planned entry, not one of the 55 in `adminPermissions.js`, so there is no string for a
  middleware gate to ask for yet and the role equality stands in for it until area 38 adds
  the name in the same phase as its screen. That is §11's outstanding question, not a
  silence introduced here. This bullet used to count four spellings of the same answer; two remain,
  `adminHoldsPermission` (which `requirePermission` and `requireIdentityDecision` both apply)
  and that role comparison. The two queue reads are gated at the route *and* masked in the
  handler, which is the shape area 6 asked for: the gate says whether you may read the
  application, the predicate says how much of it you may see. What CAT-04 counts is the
  narrower question — routes with no route-level permission at all — so it names
  `reset-password` and `features/:key` from this bullet, and never the two queue reads.
- **Gated by nothing at all** (14 admin routes): `services/status`, `me`, `reset-password`,
  `advertisements`, `metrics`, `drivers`, `drivers/:id`, `jobs`, `restaurants`,
  `master-catalog`, `master-catalog/:id/stores`, `grocery/price-alerts`, `supabase-status`,
  `features/:key`. The count was fifteen: `GET /api/admin/drivers` was registered twice
  against two different handlers, and the second — a dead duplicate that answered from a
  different projection — is deleted (§11 decision 9, answered 2026-09-22). Three of the
  remaining fourteen decide inside the handler — `me` by design (any signed-in administrator
  reads their own grants), `reset-password` (self-or-`admin_accounts.manage`) and
  `features/:key` (role equality with `SUPER_ADMIN`) — so **eleven answer to any valid
  administrator token**. That is area 33's least-privilege debt in its plainest form, and
  CAT-04 fails the run if the count grows.
- **Still not persisted — and now decided not to be** (§2.2, §11 answer 1): grants are
  derived from the role at read time and `admin_accounts` has no permissions column, so
  per-admin overrides need migration 028, which is not authorised.

### 2.4 Two endpoints could write any platform setting — closed in Phase A2 and A6

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

**The mirror image, closed in A6.** The flags endpoint could reach any key; so could
`PUT /api/admin/platform-settings/:key`, which took a caller-supplied key for any row and
published `APP_CONFIG_*` values to every device that polls `/api/app/config` — so a
credential typed into configuration would have been stored in plain text, readable by an
admin screen and shipped to phones. `GET` had no rule either: it returned every row's
`setting_value` verbatim, including whatever the flag and switchboard writers put there.

Both directions now answer from one gate in `AppConfigService`, so a rule cannot be added to
one read and forgotten on the other: `validateSettingWrite()` (namespace allow-list, then
credential-by-name, then plain-data, then credential-anywhere-in-the-value) on the way in,
and `redactSettingRow()`/`redactSecrets()` on the way out of the admin read, the write
echo, and the anonymous feed. **A refusal reports the field names and never their contents**
— the error path is where a guard most often becomes the leak. One naming rule worth
recording because it is not obvious: bare `token` cannot be a refused word in a project whose
published palette is a list of tokens, so the credential spellings are `access_token`,
`apiKey`, `bearer token` and their phrases, and a field simply called `token` is caught by
its value's shape instead. See `admin_settings_surface_test.js` (SS-01…SS-27).

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
because by then it was. **26 trail writes went through it at A3b**, measured per file:
`database.js` 18 (`pauseService` ×2, `resumeService` ×2, `reviewIdentityApplication` ×4,
`lockIdentityApplication`, `setRestaurantStatus`, `adminReviewPrice`, `setDriverStatus`, the
advertisement create/update/delete ×6, plus the two support/identity offline fallbacks),
`server.js` 3 (both feature-flag writes and the driver payout route), `DriverRepository` 3
(driver status, payout destination verified/rejected — reached in live mode, which is where
`setDriverStatus` actually goes: it delegates to the repository whenever one exists, so the
in-file write is the fallback), and `SupportTicketRepository` 2 (assign + resolve) — whose
`catch { console.error('Audit log write error (non-fatal)') }` declared an audit record
optional for the one action (a dispute settlement) that most needs one.
**Re-measured after D1: 31 awaited call sites** — `database.js` 22, `server.js` 4,
`DriverRepository` 3, `SupportTicketRepository` 2. The additions since A3b are A5's account
status write (`setAdminAccountStatus`) and its session-revoke route, and D1's three customer
writes: the live status change, its offline fallback, and `signOutCustomerSessions`. Every
one of them is `await`ed, which is the rule ST-01 enforces statically, so the count is free
to grow while the guarantee holds.

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
| kyc | `identity_verification.view/review` (existing), `identity_documents.view` (existing, **enforced on `GET /docs/:filename` and on both queue reads' masking since D2**) | area 6 |
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
| 4 | Customer management incl. suspend + force logout | EXISTS since D1 (routes) and D3 (screen) — `GET /api/admin/customers` and `/:id` (`customers.read`), `POST /:id/status` and `/:id/sign-out` (`customers.suspend`), over `users.account_status` with its `CHECK (ACTIVE\|SUSPENDED\|BLOCKED)`, reached from `admin-web/src/app/customers/page.tsx` whose four actions all go through the area-49 dialog and whose suspend control is hidden-and-named for the three roles without the grant (§11 answer 10). **Not `is_active`, which the inventory guessed: `users` has no such column**, and `account_status` is the one migration 024 already shields from the client roles | Profile edit (`customers.update`) and `customers.impersonate` remain unbuilt, and neither has a screen waiting for it; **no hard delete of records with financial or audit trail** — there is no delete route, and the harness asserts one stays that way; and five customer handlers still resolve a bearer by hand without asking the account's status, which is safe only because each requires a live session (§7's D1 remainder names them). The screen has no realtime refresh, so a suspension made in another console shows on the next reload | D |
| 5 | Driver management | PARTIAL — `GET /api/admin/drivers`, `GET /:id`, `POST /:id/status` (`fleet.manage`) | No profile edit, no document list, no per-driver timeline. Since D2 the status write is honest about what it did: `ACTIVE`/`APPROVED`/lower-case are still accepted because both UIs post them, but the response now carries `change.operationalStatus.{requested,applied,previous,normalised,forcedOffline,isOnlineNow}` and the audit row records the value the column can actually hold (`DriverRepository.js:407`). Suspending still writes `is_online = false`, and re-activating still leaves the driver offline — that is the driver's own action to take — but the answer says so instead of implying a restore that never happened. What is still not there: suspend is **not reversible to what it was** — no column holds the pre-suspension operational status, so reinstating always lands on `AVAILABLE`; the UI's "Activate" copy still promises a restore (§7 Phase D, admin-web task); and a driver who exists only in memory is now refused (`DRIVER_RECORD_MISSING`) rather than half-updated | D |
| 6 | KYC queue with private document storage | PARTIAL — `identity-verifications` list/`review`/`lock`/`unlock`, `identity_documents` table, `/docs/:filename` preview | D2 made the two document powers real gates instead of descriptions: `GET /docs/:filename` asks for `identity_documents.view` (`server.js:5058`), which it previously did not check at all — what that route serves today is a hard-coded SVG mock, so the gate closes a hole ahead of the first real upload rather than patching a live leak, and it is `§7`'s D2 item 1 that says so at length — and the review route chains `requireIdentityDecision` after its route permission so `identity_verification.{approve,reject,request_resubmission}` are enforced by one middleware each (`adminPermissions.js`) rather than by three `req.admin.permissions.includes` calls inside the handler. The queue's own list route also stopped leaking: it answers with raw Aadhaar and Voter ID numbers only to a holder of `identity_documents.view`, and withholds the *keys* — not blanked strings — from every other role, matching what the detail route already did (§2.3). Still true and still the ceiling: the `identity_documents` table holds **0 rows and no code touches it**, the queue's applications live in **process memory** (§2.5), and an unmasked identity read is not itself audited | D |
| 7 | Merchant management with tenant isolation | PARTIAL — `POST /api/admin/restaurants/:id/status`, `GET /api/restaurants` for admin | No merchant detail/edit; **the suspend action writes a memory copy that no column can hold** (`merchants` has 39 rows and only `is_open`, §2.5); merchant-scoped endpoints already prove tenant isolation via `requireMerchantTenant` and reuse it here | D |
| 32 | Admin users, least privilege, no auto SUPER_ADMIN | PARTIAL — `GET/POST /api/admin/accounts` gated by `admin_accounts.{manage,create}` since A1; since A4 `POST /api/admin/accounts/:id/status` (`admin_accounts.manage`) enables and disables with the last-enabled-`SUPER_ADMIN` guard, and revokes every session of the account as it disables (§1.4). §11 answered on 2026-09-22: the matrix stays role-derived in code (answer 1) and the 26 sensitive names stay `SUPER_ADMIN`-only (answer 10), so "least privilege" here means the five roles as written, not a per-account editor | No permission UI **by decision** — there is nothing to edit without migration 028, and the screen's job is now to *show* the caller's role and grants read-only and to hide or label the super-only controls (§2.3, Phase D); 11 of §2.3's admin reads still answer to any valid administrator token, which §11 answer 11 must settle; a role or grant change is not possible at all yet, which is recorded as the accepted shape rather than a pending fix | A |

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
| 31 | Audit log protected from normal deletion | EXISTS — `trg_audit_logs_immutable` + `GET /api/admin/audit-logs`; since A3 a refused write is announced instead of vanishing, and since A3b the control-plane writes are awaited and a refusal answers 503 (§2.7; 26 of them at A3b, 31 re-measured after D1) | 20 writes stay un-awaited for stated reasons (§2.7's table), so a 200 on those is still not proof the record landed; and three admin mutations have no column to land in at all (§2.5) | A |
| 33 | Permission matrix with named permissions, enforced server-side | PARTIAL — 60 of 79 `authenticateAdmin` routes gate on 46 names, and since A1 the grants come from one file (§2.3; D1 added `customers.read` and `customers.suspend`, D2 put `identity_documents.view` on the document route and the three review decisions into `requireIdentityDecision`). Since A4 the whole map is **proven rather than described**: `admin_authorization_test.js` parses the route table out of `src/server.js`, refuses all 208 (route, non-super role) pairs that should be closed with 403 naming the permission, allow-probes 39 names through a handler-validated request, hands 3 conditional names to the harness that calls their middleware directly, records 4 it will not probe and why, and compares `GET /api/admin/me` against the catalogue per role. The parser now reads whole registration **statements** rather than lines, which is why two numbers in this row moved without anything being re-gated: 76 → 79 routes and 14 → 17 ungated. Three routes had always been ungated and the line-based parse could not see them, because they are registered in array form | 17 admin routes carry no route-level permission — of those, 3 decide inside the handler (`me` by design, `reset-password` through `adminHoldsPermission`, the same predicate the gate uses, and `features/:key` by role equality with `SUPER_ADMIN`), so **14 answer to any valid administrator token**: the 11 this row counted before, plus `GET /api/admin/features`, its `POST /api/v1/admin/features` twin and `GET /api/v1/fleet/locations`. The features pair is the flag-family decision this row already defers; the fleet alias is §14 decision 9 of the geo audit (who may read live driver positions), and neither was gated by a test choosing an answer. 9 catalogue names grant nothing anywhere; 27 gated names are unreachable for a least-privilege role (§2.3, and decided to stay that way by §11 answer 10); nothing is persisted, so per-admin overrides need the §9 migration. 4 names (`notification.broadcast`, `orders.manage`, `geofence.create`, `surge.create`) have no *safe* allow probe, so a holder reaching them is unproven — recorded in the harness, not hidden. §3 is the target catalogue | A |
| 34 | Security centre | EXISTS as an API surface **and, since A5, as a screen** — `GET /api/admin/security/sessions` (`security.view`), `GET /api/admin/security/login-lockouts` (`security.view`), `POST /api/admin/security/sessions/revoke` (`security.session.revoke`, by handle or by account, durable-store-first, audited through `auditAppliedChange`), and the account enable/disable write that cuts sessions with it (§1.4). `admin-web/src/app/security/page.tsx` reads all three and gates every action button on `user.permissions` from `GET /api/admin/me`, so a role without `security.session.revoke` sees the directory with no buttons rather than a button that answers 403 | The lockout counters are this-process-only because `failed_attempts`/`locked_until` are dead columns (§1.4) — durable lockouts and a last-seen-IP trail need a migration → §9. `security.view`-only roles cannot list the account directory it acts on (`admin_accounts.manage`), sessions are unpaged, and the nav entry itself disappears for a role with no `security.view` | A |
| 36 | Integrations, never display secret values | EXISTS since A6, at the API: `GET /api/admin/platform-settings` serves every row through one redactor, so a row that holds a credential reads back as its *shape* — the sensitive leaves replaced by `__REDACTED__`, their dotted paths listed in `redactedPaths`, the key named in the response's `redactedKeys`, and the fields an operator does need (`homepage`, `name`, `updated_at`) left alone. `loadSettings()` applies the same rule on the way out, so the anonymous `/api/app/config` feed masks it too rather than shipping it to devices | No integrations screen exists, so "presence + last check" is only proven in the payload; there is **no last-check or configured column to show** — `platform_settings` has key/value/description/updated_by/updated_at and nothing that records a connection test, so a real integrations surface needs §9 schema work; and rows whose legacy secrets are merely masked stay in the table until someone deletes them, which is §9 too | A |
| 37 | Settings, secrets not editable from admin UI | EXISTS since A6 — the write gate is an allow-list rather than a block-list: `PUT /api/admin/platform-settings/:key` answers `SETTING_KEY_NOT_ALLOWED` for anything outside the `APP_CONFIG_` namespace the endpoint publishes (`FEATURE_*`, `PLATFORM_SERVICE_STATE`, `service_status`, `surge_multiplier` keep the `INVALID_SETTING_KEY` refusal they had), `SETTING_NAME_IS_CREDENTIAL` for a key that names a credential, and `SETTING_VALUE_IS_CREDENTIAL` for one anywhere in the value at any depth — and a refusal reports the offending **field names**, never the contents, so the error path cannot become the leak it guards | Still `requireSuperAdmin` rather than a catalogue name, which is #61 and §11 decision 10; the gate is on this surface only — the flag route, the service-state mirror and pricing keep their own namespace checks by design, which is why the allow-list refuses rather than reroutes; and bare `token` cannot be a refused word in a project that publishes a palette of them, so a field named `token` is caught by its value's shape, not its name | A |
| 38 | Feature flags that cannot bypass controls | PARTIAL — `features` routes, `is_feature_enabled()`, and since A2 a write surface limited to flag keys (§2.4) | Flags must remain unable to disable auth/authz/payment/RLS/audit; the routes are still role-checked rather than name-checked, and neither write is audited | A |
| 39 | Reports with CSV/XLSX/PDF | MISSING | CSV first (no dependency), XLSX and PDF only if a library already exists in the tree — it does not, so both are a §9 dependency decision | B |
| 42 | Data export with field filtering + audit | MISSING | Built on `report.export`/`audit.export`; field filtering is *subtraction from a fixed projection*, never caller-supplied column names | B |
| 44 | Admin AI assistant on authorised tools only | MISSING — **no LLM integration exists anywhere in the repo** (verified: no `openai`/`anthropic`/`llm` reference in `backend/src`, `admin-web/src`, `customer-web/src`, `mobile/lib`) | Requires (a) an external model provider = new dependency + new secret + customer data leaving the boundary, and (b) the tool layer must call the same permission-checked services with the *caller's* session. See §11 — this is a decision to make, not a phase to build | — |
| 45 | Mobile-responsive admin, not shrunk tables | WALKED, **six of the eight app routes**, 2026-09-23 — the **customers** screen at 320/375/390/430 and 768px holds up: stacked `CUSTOMER` cell (name, phone, email, id) rather than a shrunk row, wrapping status chips, a scrollable labelled table region whose actions stay reachable, and a confirmation dialog that fits and scrolls at phone heights. The other five (dashboard, `/drivers`, `/merchants`, `/orders`, `/campaigns`) were then walked at the same widths: two of them overflowed the page and both are fixed in the shared primitives rather than per page, along with 158 sub-floor buttons and four sub-floor controls. **`/login` and `/security` have not been walked at these widths, so "all eight" is not a claim this row makes.** No table lost a column at any width — they scroll inside their labelled region, which is the "not shrunk tables" half of the requirement | Closed for the six walked; §8 records both passes and their limits. `ResourceTable`'s column-hiding breakpoints beneath 900px are still untested, because nothing exercised them. Two routes outstanding: `/login`, `/security` |
| 46 | Per-admin dashboard customisation | MISSING | Needs a persisted per-admin preferences store — same §9 migration family | G |
| 48 | Accessibility | MISSING as an enforced property | Keyboard nav, focus order, labelled controls, contrast, live-region announcements for the realtime feed | G |
| 49 | Confirmation that states exactly what will happen | EXISTS — `admin-web/src/components/ConfirmAction.tsx`, one modal fed by a `Confirmation { title, effect, consequences[], confirmLabel, tone }` written from the mutation's **actual** backend behaviour, not from intention. Wired at every privileged mutation the dashboard has today: service pause, merchant suspend, driver suspend, campaign ACTIVE/PAUSED/ARCHIVED, and session revoke / revoke-all-for-account / disable-account on the security screen | Killswitch, payout and refund have no admin-web surface at all yet, so nothing confirms them (§5 rows 15 and 18, §11 decision 10); a suspension carries no reason field from the UI, so the driver is told the server's default `'Compliance review'`; saving an **edit** to an already-live campaign is not confirmed (the editor's own footnote states what a save replaces in full, and publishing stays a confirmed state button — whether a live-content edit needs the dialog too is undecided); and the audit reason for a revoke says `"(N take-down(s))"`, summing durable store rows and this process's in-memory copies of the *same* session — the screen's line keeps them apart, the trail's does not | A |
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
`admin-web/src/components/ConfirmAction.tsx` + `admin-web/src/lib/refusals.ts` (area 49's
one confirmation modal and the one reader of a refused write — a new mutation calls
`useConfirmAction()` before it posts and reports failure through `readRefusal(err, …)`, it
does not write its own dialog or its own `err.response?.data?.message` line),
`CampaignEditor.tsx` (the pattern for a revision-carrying config editor),
`AuthProvider.tsx` (which already carries `GET /api/admin/me`'s `{ role, permissions }` on
`user`, and is what a screen gates an action button against), and
`AdminLayout.tsx` (where the nav becomes permission-driven — done for `/security`, still
static for every other entry).

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
   `requirePermission`'s literals still live at the routes. **§11 answers 1 and 10 remove
   the reason to wait**: the matrix stays role-derived and no grant moves, so sourcing each
   `requirePermission('...')` literal from the catalogue module (#61) is now a plain
   mechanical change rather than a decision-dependent one — its value is that a typo'd name
   stops being a gate that silently refuses everyone but the wildcard role, and `CAT-05`
   already catches that at the catalogue boundary, so this is hardening, not a gap in the
   control.
3. ➜ **Part done (A1).** `accounts` is on `requirePermission('admin_accounts.{create,manage}')`
   and the dead `'admin.manage'` string in `reset-password` is now a real name. `features`
   (§2.4) and the `identity_verification` decision checks are still in-handler. **Not
   unblocked by the answers above**: converting them needs one new catalogue name per
   decision (`feature.edit` has no entry to bind to today), and inventing a name is a §3
   catalogue change rather than a refactor — so it stays open with the names it needs
   listed, not silently renamed.
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
7. ➜ **Part done (A4, screen in A5).** The security-centre **API** is live and gated: the session list,
   the lockout read labelled for what it actually covers, revoke by handle or by account
   with the durable store written first, the account status write that cuts sessions as it
   disables, and the fail-closed audit on all three (§1.4, §5 rows 32 and 34). Since A5 the
   surface has a consumer: `admin-web/src/app/security/page.tsx`.
   **Open:** durable lockouts and a last-seen-IP trail, which need the dead
   `failed_attempts`/`locked_until` columns written → §9; sessions are listed unpaged; and a
   role holding `security.view` without `admin_accounts.manage` can see the sessions but not
   the account directory it would revoke by account.
   **Found while gating it, fixed:** `POST /api/admin/services/emergency-killswitch` read
   its direction as `if (activate)`, so a body that omitted the field lifted the lockdown —
   the one admin mutation where doing nothing by accident was the dangerous answer. The
   direction is now required (`KILLSWITCH_DIRECTION_REQUIRED`, 400), and
   `authenticateAdmin`'s store-fallback branch accepts any administrator role rather than
   only `ADMIN`/`SUPER_ADMIN`, which had made an OPERATIONS or KYC token that reached that
   branch a live session the door refused to read.
8. ✅ **Done (A5).** Area 49's single dangerous-action confirmation exists —
   `admin-web/src/components/ConfirmAction.tsx`, one provider-level modal whose `effect`
   line is required and whose copy is written from what the backend route actually does —
   and every privileged mutation in the dashboard runs through it: service pause, merchant
   suspend, driver suspend, the three live campaign states, and security's revoke /
   revoke-all-for-account / disable-account. It fails closed: with no provider, or with a
   second request already open, the answer is `false`.
   **Found while wiring it, fixed:** the switchboard had never worked from the dashboard.
   `pauseService`/`resumeService` posted `{ service: '<display name>' }` against routes that
   read `serviceId`, so **every** pause and resume answered 400 — and the card read a field
   named `isPaused` that the payload does not contain, so a service paused over the API still
   rendered as `Live`. Both corrected, and the round trip proven live: pause a service, watch
   the badge and reason change, resume it, and see both actions in the audit trail. Along the
   same read every refusal the dashboard and the security screen show now comes from
   `readRefusal(err, …)`, so a `503` carrying `applied: true` says the change landed and only
   its record failed — instead of "the change was not applied", the one sentence about it
   that would be false.
9. ✅ **Done (A6).** The settings surface is an allow-list with a redactor, not an open
   key/value editor. `PUT /api/admin/platform-settings/:key` now answers
   `SETTING_KEY_NOT_ALLOWED` for anything outside the `APP_CONFIG_` namespace it publishes
   (the four keys another control owns keep the `INVALID_SETTING_KEY` refusal they had),
   `SETTING_NAME_IS_CREDENTIAL` for a key that names a credential, and
   `SETTING_VALUE_IS_CREDENTIAL` for a credential anywhere in the value at any depth — and a
   refusal reports the offending **field names** and never their contents, so the error path
   cannot become the leak it is guarding. `GET` and the anonymous `/api/app/config` feed both
   run every row through the same redactor, so a credential already in the table — written
   before the gate, or by a subsystem outside it — reads back as its shape with the paths
   named, instead of being served to an admin screen and shipped to devices
   (`admin_settings_surface_test.js`, SS-01…SS-27).
   **Found while writing it, fixed:** an update that sent no description erased the one on the
   row, because the route read the existing row without that column and then upserted `null`
   over it (SS-19). **Open:** still `requireSuperAdmin` rather than a catalogue name (#61); no
   integrations screen exists, so area 36's "presence + last check" is proven in the payload
   only, and there is no last-check or configured column to show — that is §9 schema work;
   and the masked legacy rows stay in the table until someone deletes them, which is §9 too.

**Gate:** ✅ `test_suite.js` green *plus* `admin_authorization_test.js`, which replaced the
hand-picked `RBAC-01..12` model with the whole measured map: 109 assertions at the close of
Phase A — 193 (route, permission) refusals across the four non-super roles, one validated
allow probe per
permission, per-role agreement between `GET /api/admin/me` and the catalogue, and
revocation proven by using the revoked bearer afterwards. (Re-measured after D2: 113
assertions, 208 refusals across the four non-super roles — the map is parsed from source, so
it grows whenever a phase registers a gated route, which is the point: D1's two customer
permissions took it to 111/205, and D2's document gate plus the three decision names it moved
out of the handler account for the rest. CAT-03 now proves 39 permissions by reaching a
handler, refuses 4 with a recorded reason, and hands 3 to `requireIdentityDecision`'s own
harness by name.) The two halves it deliberately
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

**Scope as split against §9 (2026-09-22, after §11 answers 1 and 10):** what this phase can
actually finish, and what it must stop short of.
- **Area 4 (customers) is built — D1, 2026-09-22.** `users.account_status` exists with
  `CHECK (ACTIVE|SUSPENDED|BLOCKED)`, so a suspension is durable and reversible in a column
  that was designed for it, and migration 024 already forbids the client roles from writing
  it themselves. The condition recorded when this was scoped — that no customer auth path
  read the column, so the write had to be paired with a refusal or the button would only
  move data nobody consults — is what the rest of this bullet describes. Three mechanisms
  cover it, and they are separate because each covers a case the others cannot:
  1. **`verifyAuthOtp` refuses the new token** (`server` answers 403 `ACCOUNT_SUSPENDED` /
     `ACCOUNT_BLOCKED`) after reading the row authoritatively, so no closed account can be
     signed in to from any instance, including one that never saw the write.
  2. **`authenticateUser` refuses a bearer already in hand** through
     `db.customerSessionRefusal`, which reads this process's directory record and falls
     back to the store when the session names an account it cannot resolve. This is the
     half that holds when revocation fails: `setCustomerAccountStatus` mirrors the status
     into memory *before* it revokes, and if the revoke cannot reach the store it answers
     503 with `applied: true` — the session is still live, and the guard is what stops it.
     Two routes resolve a bearer without that middleware — `GET /api/auth/me` and
     `POST /api/auth/refresh-token`, the pair a handset calls to answer "am I signed in,
     and as whom" — so the guard is awaited inside both handlers as well, and a static
     check (INP-10) fails the run if either call is deleted. `CU-15.1/.2` prove the open
     account still gets its normal `200` from both.
  3. **The write ends the sessions it invalidates** (`revokeCustomerSessions`, store first
     then memory, matching both `usr_1` and uuid id spaces because `backend_sessions.entity_id`
     carries whichever a login happened to resolve).
  What is *not* claimed: no per-request database read happens on the common path, so a
  status written **outside** this API is only seen by a process that cannot resolve the
  account locally. And **a suspension does not reach another instance at all** — which is
  a correction, not a caveat, because this section used to say the opposite. The sentence
  was "the shared row is gone, so another process's 15-second reconcile prune drops its
  copy". `reconcileSessions` prunes only what its loop recognises as locally minted, and the
  loop reads `const isDevFixture = /^(usr|drv|mcht)_session_/.test(key); if (isDevFixture ||
  /^[0-9a-f]{64}$/.test(key)) continue;` — while every real login is stored under
  `hashSessionToken(token)`, which is 64 hex characters. The `continue` therefore skips
  exactly the entries a revocation performed elsewhere needs removed. The other half of the
  same function does work: a session row another process wrote is adopted inside the tick,
  so a bearer minted elsewhere is honoured here (INP-21, over HTTP against a live second
  process). **Adoption converges; revocation does not.** The bearer-time guard is no
  backstop for this case either — an instance that hydrated the account while it was open
  answers from that copy, and the store is consulted only when it cannot resolve the account
  at all (INP-26). So a customer suspended on instance A keeps a working signed-in app on
  instance B until B restarts or the session expires: the door a suspension shuts is the
  instance that shut it. Correcting this is a two-line change to that predicate — honour the
  prune for hash-keyed entries and let `restoreSession` re-add what is genuinely live — but
  it changes the authorisation path of every instance at once, so it is carried as a §9 stop
  and a §11 decision rather than edited in beside a documentation fix.
  The bearer-time sweep is now complete: `refusedClosedCustomerAccount`, one helper beside
  `authenticateUser`, is awaited by the five handlers that resolve a session in their own
  body — `POST /api/rides/:id/cancel` and `POST /api/jobs/:id/cancel` (one handler, two
  paths), `GET /api/payments/session/:orderId`, `DELETE /api/media/*`, and
  `POST /api/customer/profile/photo` — alongside the two that already had it. Each call sits
  before that handler's own 404 or ownership check, so the status is what answers rather than
  whatever the request would have hit next. INP-10 names all seven routes in the source and
  fails the run if any call, or the helper's delegation, is deleted; INP-19…INP-22 then prove
  the behaviour over HTTP in both directions — an open account is served normally, and a
  bearer that outlived its account is refused `403 ACCOUNT_SUSPENDED` on each of the five.
  `GET /api/tracking/:jobId` reads a token only to decide which tenant may see the job and is
  a shared read, not a customer one. `GET /api/media` sits beside the five with no gate of any
  kind, listing stored assets by `ownerType`/`ownerId` to anyone who asks; it is not one of
  the five and adding an authentication check to it is a client-visible change outside this
  task's wording, so it remains an area-33 finding recorded here rather than a quiet fix.
  Carried as a task, not as a claim.
  Two measured facts belong with this, because they constrain the next person to touch
  the field: the in-memory entity overloads `accountStatus` with **identity** states
  (`IDENTITY_VERIFICATION_PENDING`, `UNDER_REVIEW`, `RESUBMISSION_REQUIRED` — `database.js:76`,
  `:3402`, `:3452`), which is why `customerAccountBlocked` answers only for the three values
  the column can hold and treats anything else as open; and a **rejected KYC decision maps
  to `account_status = 'SUSPENDED'`** (`UserRepository.js:301`), so an identity refusal
  closes the account through the same guard — the local directory measured 39/39 `ACTIVE`,
  which is why no existing sign-in was affected. Third, and the one a reviewer would want
  named: because the guard has to read a status the column can actually hold, `verifyAuthOtp`
  now mirrors the durable `account_status` into that entity field at sign-in, so for a
  customer who signs in the field stops carrying the identity stage. Measured before making
  that change: `identityStatus` is a separate mapped column (`UserRepository.js:34`), nothing
  in `backend/src` keys a decision on the overloaded value (the identity flow only writes
  it; `GET /api/identity/status/:userId:3137` reports it), and no client in `mobile/lib` or
  `admin-web/src` reads `accountStatus` at all — so this is a reporting change, not a
  behaviour change. If area 5-6's work ever needs the identity stage, it must read
  `identity_status`, which is where it is durable.
- **Area 4's screen is built — D3, 2026-09-23.** `admin-web/src/app/customers/page.tsx` on
  the D1 routes, and it is the surface §11 answer 10 was answered for. The directory is the
  projected read with a bounded search, a status filter and real paging behind the count;
  suspend, block, reinstate and sign-out-everywhere each go through the area-49 dialog, whose
  effect line states what the route does rather than what a button implies — sessions end,
  orders and wallet history do not, nothing is deleted, the account holder is not notified so
  the reason you type is the only record left, and reinstating reopens sign-in without
  restoring the sessions the suspension ended. The device count in that sentence comes from
  `GET /api/admin/customers/:id` before the dialog opens, because area 49 forbids guessing at
  it, and a read that fails is reported as unknown rather than as zero.
  `ConfirmAction` grew the `reason` field this needed — the server refuses a suspension under
  five characters, so the confirm button stays disabled below the same minimum rather than
  letting the operator discover it through a 400 — and `lib/access.ts` is the client's copy of
  `adminHoldsPermission`, wildcard included, used to hide `customers.suspend` controls from
  the three roles that hold `customers.read` without them and to say, in the row, which grant
  is missing. The read-only "Your role and grants" section is the other half of answer 10:
  with no permission editor by decision, the screen states the caller's role and grants
  instead of leaving the absent buttons to be inferred. Walked end to end, both directions,
  with the refusals re-proven against the routes with the same non-super token — §8.
  What this does **not** do: it does not carry answer 10 to the other five pages, which still
  render controls their caller may be refused on (#61); it adds no realtime refresh, so a
  suspension made in another console appears on the next reload; and the driver screen's
  "Activate" copy still promises a restore that D2 showed is not what happens, which is area
  5's UI work and unchanged here.
- **Areas 5 and 6 are built — D2, 2026-09-23.** The condition recorded when this phase was
  scoped said it in one line: area 6's *enforcement* is buildable, its *durability* is not.
  That is exactly what happened. Four measured faults, four fixes, and one harness
  (`admin_identity_gates_test.js`, 64 assertions) that proves the refusals rather than the
  grants, because the grants were already proven by `admin_authorization_test.js`:
  1. **`GET /docs/:filename` had no middleware at all.** The document preview the queue hands
     out as every applicant's `aadhaarDocUrl`/`voterIdDocUrl` answered any caller who knew a
     filename. What it serves *today* is a hard-coded SVG mock — the name, DOB and address in
     it are the fixture's — so this gate protects nothing that exists yet; it closes the hole
     before a real upload ever lands there, which is the point of naming the permission the
     examiners' queue already uses. It now asks for `identity_documents.view` in its own chain
     (`server.js:5058`) — the same name §4 granted to `KYC_SPECIALIST` and nothing had ever
     enforced, one of §2.3's "granted but unenforced" names and now part of the reason that
     list is 9 rather than 13. No client renders these URLs, which is why gating an `<img>`
     source was safe to do without a screen change.
  2. **The queue listed what the file view withheld.** `GET /api/admin/identity-verifications`
     answered every applicant's raw Aadhaar and Voter ID numbers to any holder of
     `identity_verification.view`, while `GET …/:id` masked the same two fields behind
     `identity_documents.view`. Under §2.1 — RLS bypassed, Express the only authorisation
     layer — that is a leak, not an inconsistency: OPERATIONS cannot open one document but
     could read every number in the queue. Both routes now decide through
     `adminHoldsPermission(req.admin, 'identity_documents.view')`, and the non-holder's rows
     are missing the *keys* rather than carrying empty strings, so a screen cannot render a
     blank as "the applicant supplied nothing". Row counts are identical either way, so
     masking cannot be used to infer a filtered-out applicant.
  3. **Three permissions sat behind one gate, inside a handler.** The review route checked
     `identity_verification.{approve,reject,request_resubmission}` against
     `req.admin.permissions` in a spelling no parsed route table can see. Those three are now
     `requireIdentityDecision`, a middleware exported beside the grants it guards
     (`adminPermissions.js`), chained after the route's own permission. It is proven by
     calling the middleware directly — `KG-10..12` — because `KYC_SPECIALIST` is the only
     non-super role that holds `identity_verification.review` and §4 gives it all three
     decisions, so no real least-privilege session *can* be refused one over HTTP. Rather
     than let that arrangement rot quietly, `KG-17` asserts the underlying grants fact every
     run: if §4 ever hands `review` to a role without the decisions, the harness fails and the
     probe becomes an HTTP one.
  4. **A driver status write reported things that never happened.** `operationalStatus:
     'OFFLINE'` — a value several UIs send and the column's `CHECK` has never allowed — was
     normalised or refused with PostgREST's own text as a 400; the audit record's
     `previousState` was read *after* the memory object was mutated, so it reported the new
     value as the old one; and every accepted change was actioned as `DRIVER_ACTIVATED`,
     which made a driver moved to `BUSY` look like a reinstated one. `updateDriverStatus` now
     validates against the two `CHECK` sets the schema actually holds (`001_central_schema.sql:60`,
     `016_driver_kyc_payout_and_partial_refund.sql:12`)
     before writing anything, refuses an empty call, reads the pre-write state
     authoritatively, writes through `settleAuthoritative`/`authStoreUnavailable` so a store
     outage is a 503 and not a bad-request-shaped lie (§directive 4), mutates memory only
     after a landed write, and returns `change.{operationalStatus,kycStatus}` carrying
     `requested`/`applied`/`previous`/`normalised`/`forcedOffline`/`isOnlineNow`. The trail
     matches: `DRIVER_SUSPENDED`, `DRIVER_ACTIVATED`, `DRIVER_STATUS_BUSY`,
     `DRIVER_KYC_VERIFIED`, with `metadata` holding the whole `change` object. `ACTIVE` and
     `APPROVED` still work — silently breaking both admin UIs and the suite would not be an
     improvement — but the mapping is said out loud in the response, in the audit record and
     in the refusal wording, which is what "no silent normalisation" asked for.
  **What D2 does not claim.** The queue's rows are still process memory and
  `identity_documents` still holds 0 rows, so a review dies with the process (§2.5, §9 item
  1); an *unmasked* identity read is not itself on the trail, so the platform can prove who
  opened a document but not who read a raw number off the list; suspension is still not
  reversible to the status it replaced, because no column holds it; and the driver screen's
  "Activate" copy still promises a restore, which is the next task's UI work, not this
  route's. `GET /api/media` also remains open to any caller (§7 Phase D, area 4's closing
  paragraph), and D2 did not touch it.
- **Area 6's enforcement is buildable; its durability is not.** `identity_documents.view`
  and `identity_verification.{approve,reject,request_resubmission}` can be moved from
  in-handler reads to real gates without a migration. The queue's own rows cannot — they
  live in process memory (§2.5), and giving them a table is §9 item 1. *The first half of
  this was done on 2026-09-23, above; the second half is the standing reason area 6 is
  PARTIAL and not EXISTS.*
- **Area 7's merchant suspension has no column** — `merchants` carries 13 columns and the
  only status-shaped one is `is_open`, which is the merchant's own trading toggle, so
  writing it to "suspend" would misreport a business state as an enforcement action and
  would be undone by the merchant's next tap. Detail read + tenant isolation are in scope;
  a durable suspension is §9.
- **The §11 answer 10 labelling lands here**, because this is where the controls get built:
  a super-only action is hidden or explicitly marked for a caller whose `/api/admin/me`
  lacks the name, and never rendered as a live button that answers 403.

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
| `backend/admin_authorization_test.js` (**new, A4**) | 113 assertions: the guard map parsed from `src/server.js` (60 gated routes / 46 names), all 208 (route, non-super role) pairs refused with 403 naming the permission, one handler-validated allow probe per permission — or a recorded reason not to probe, or the named harness that probes a conditional middleware directly — that no method+path in the file is registered twice (CAT-06, 156 registrations), that at most 14 admin routes carry no permission check (CAT-04's ceiling, tightened by D2 to the count after §11 answer 9's duplicate was deleted), `GET /api/admin/me` equal to the catalogue per role, revocation proven by using the revoked bearer, cross-instance sessions honoured and revocable, disable-cuts-sessions, and the four guards that must never be fired over HTTP proven against a stubbed store | phases A–G |
| `backend/admin_settings_surface_test.js` (**new, A6**) | 31 assertions: the write allow-list refuses a key outside the published namespace and a credential by name or at any depth in the value, a refusal never echoes what it rejected, an ordinary name and a real published theme are *not* refused, a legacy row seeded outside the gate is masked in the admin read **and** in the anonymous config feed, the non-sensitive fields beside it survive, and an update with no description keeps the description it has | any settings, config-feed or redaction change |
| `backend/admin_customers_test.js` (**new, D1**) | 75 assertions: the two customer permissions refuse exactly the roles §4 says must not hold them, the directory is projected (no wallet, dob, address or credential key reaches the response) with a bounded search and a real count behind the paging, a suspension lands in `users.account_status`, signs the customer's live sessions out, makes the bearers already in hand fail and a fresh sign-in answer 403 `ACCOUNT_SUSPENDED`, and leaves an audit row that states how many sessions it killed; `BLOCKED` refuses at sign-in too, and reinstating reports the status it replaced; a sign-out ends sessions *without* closing the account, proven by its 401 being distinguishable from a closed account's 403; no delete route exists; the in-process guard is proven against the identity-overloaded statuses, a mint-time snapshot, and a status written out of process, and the two routes that resolve a bearer without `authenticateUser` (`/api/auth/me`, `/api/auth/refresh-token`) are checked both ways — normal `200` for an open account over HTTP, and a source check that a deleted guard fails the run; **the half-failed write is proven against an outage rather than argued** (`INP-11..18`) — with the session-store revocation made to fail in-process, so the status write reaches PostgreSQL and the revocation cannot, the route answers 503 `CUSTOMER_SESSION_REVOKE_UNAVAILABLE` with `applied: true`, the trail row exists and states its counts as zero beside `sessionsRevokeFailed: true` instead of borrowing the successful case's numbers, the bearer in hand is still refused, and undoing the suspension returns `ACTIVE` with `persisted: true`; and `CU-33.1`/`CU-33.2` keep Block and Suspend apart *in the trail* — two records, two distinct actions, each naming its own new state — so no screen can read one as the other; the fixture deletes itself and sweeps orphaned probe accounts | any customer account-status or customer-session change |
| `backend/admin_identity_gates_test.js` (**new, D2**) | 64 assertions: the document preview refuses an anonymous caller and refuses every role §4 did not give `identity_documents.view` to, by name; the two identity reads mask the *same* field pair for the *same* token, with the withheld keys absent rather than blanked and the row count unchanged either way, so the list route can no longer publish what the detail route withholds; the three review decisions each refuse on their own permission in `requirePermission`'s own wording, proven by calling `requireIdentityDecision` directly (`KG-10..12`) plus an assertion of the grants fact that makes direct calling correct rather than a shortcut (`KG-17`); and `updateDriverStatus` refusing a value the column's `CHECK` cannot hold without writing it or a trail row, applying the aliases both admin UIs send while *reporting* `requested`/`applied`/`previous`/`normalised`/`forcedOffline`, agreeing with the live row at every step, and leaving exactly its own five truthful records — one action per kind of change, never `DRIVER_ACTIVATED` for a driver moved to `BUSY`. It creates and deletes its own fixture driver row and disables its own `idg_*` probe accounts, sweeping an aborted run's leftovers before making new ones | any driver status/KYC write, identity queue read or document route change |
| Flutter `main_admin.dart` widget tests + `flutter analyze` | the admin mobile app | phases with mobile changes |
| `admin-web`: `npm run lint`, `npm run build`, then a real browser walk of each confirmation (local backend on :4000, local dev server on :3001) | area 49's component, the security screen, the customers screen, and that a dialog's words match what the route does | phases A5, D3 and G — **there is no automated admin-web harness**, so this is the only thing between a copy edit and a false promise to an operator |

The walk is not cosmetic. It is what found that the dashboard's pause and resume had never
worked (§7 item 8), and that a first draft of the security screen reported "Every session
taken down: 0 removal(s)" for a no-op and "2 session(s) revoked" for one session by adding
the durable store's row to this process's in-memory copy of the same session.

**The D3 walk, run 2026-09-23 against the local store.** It found two more before either was
committed, both of the same kind — a screen stating something the route does not do:

- The first draft's suspension dialog said "0 signed-in devices is signed out by the same
  call" for an account with nothing signed in. A count of zero is not a plural, and it is
  also not the same sentence as "nothing to end", so `devicesEnding()` now answers four ways
  (unknown, none, one, many) and the unknown branch says it is unknown rather than borrowing
  zero's confidence.
- The directory header rendered the server's `searchCappedAt: 200` as "the search matched
  more than 200 and is capped" whenever the field was present. It is present on **every**
  searched read, because it describes the search's shape rather than its outcome, so a
  one-row search was telling the operator it had missed 199. The note now appears only when
  the matched count actually reaches the ceiling.

What it proved, on `6abb651f…` (a `New NABIN Customer` fixture with exactly one live
session, chosen so the singular wording and the session count were both observable): the
reason field refused to confirm at 4 characters and accepted at the server's own minimum;
the suspend landed as `SUSPENDED` with the outcome line reading "1 session(s) ended — 1
row(s) deleted in the durable store, 0 held by this process" — the two mechanisms kept
apart, as §2.7 requires; `GET /api/admin/audit-logs?module=CUSTOMER` returned
`CUSTOMER_SUSPENDED` with the typed sentence as `reason`, `ACTIVE → SUSPENDED`, and
`metadata.sessionsSignedOut: 1`; the `Suspended` chip listed the row and the reinstatement
returned it to `ACTIVE` with its own `CUSTOMER_REINSTATED` record, whose `reason` reads
"Customer account reinstated. Note: …" — and left the account with **0** sessions, which is
what the dialog promised rather than what a "restore" copy would have implied.

§11 answer 10 was walked as a second identity, not as a code read: a throwaway
`ui_walk_operations` OPERATIONS account saw the directory at 25 rows with **no button in the
action column at all** and the row's own sentence naming the missing `customers.suspend`
grant, saw the Security entry absent from the navigation, and saw its grants counted as 8
against `SUPER_ADMIN`'s 55 in the read-only "Your role and grants" section. Then the same
token was used against the routes directly, because hiding is not allowing:
`GET /api/admin/customers` answered 200, and both `POST …/status` and `POST …/sign-out`
answered 403 naming `customers.suspend`. The account was disabled at the end of the walk —
`isActive: false` revoked its 3 sessions in the same call and its next sign-in was refused —
so no enabled credential was left behind, and its two audit rows are.

Four things that paragraph left open are closed now, each exercised under the condition it
describes rather than argued from the code. Two of them turned out to be lying, and both lies
were of the kind this section exists to catch.

**`applied: true` — walked, and it was broken.** The condition is a store that takes the
status write and refuses the session revocation, which no browser can arrange, so a
throwaway transparent proxy stood in front of the local PostgREST answering 503 for exactly
`DELETE /backend_sessions` and passing every other call through byte for byte. Nothing in
`src/` was stubbed. **The defect that reproduced:** the half-failed write threw its 503
*before* its audit record was written, so the one suspension that most needs a trail — the
one that landed halfway and cannot be seen from the customer's side — left no record at all.
`setCustomerAccountStatus` now writes the trail first, with its counts honestly zero beside
`sessionsRevokeFailed: true`, and then refuses. On the screen, with a fixture holding exactly
one live session, the dialog's effect line named that device, confirming answered
`nabin-alert--danger` with "This landed, but it did not finish: The account is SUSPENDED, but
its existing sessions could not be revoked… The change is live and must be reconciled — new
sign-ins are closed, already-issued tokens are not. Do not repeat the action as if nothing
had changed… (ref req_…)", and the reloaded row read `SUSPENDED` with **Reinstate** in place
of the two closing buttons. The store agreed with every word: one `CUSTOMER_SUSPENDED` row,
`ACTIVE → SUSPENDED`, `metadata.sessionsSignedOut: 0` with the revoke-failure flag set, and
the session row still there — refused by the account-status guard rather than deleted, which
is what the sentence says rather than what a success copy would have implied. Reinstating it
from the keyboard answered "is now ACTIVE (was SUSPENDED)" and left its own
`CUSTOMER_REINSTATED` record: two operations, two rows, no duplicate and no false success.
The client half of the same fault was a sentence that named the wrong artifact — every
`applied: true` refusal was described as a lost *audit record*, including this one, which
lost sessions and kept its trail — so `readRefusal` now reserves that wording for
`AUDIT_RECORD_UNAVAILABLE` and repeats the server's own words for everything else.
`INP-11..18` keep the branch pinned.

**The memory-only branch — exercised, deterministic, and its UI sentence was false.** Under
`NODE_ENV=development` with `SUPABASE_POSTGRES_LIVE=false`, the write returns
`dataSource: 'memory'` and `persisted: false`, the trail row is written, and the gate still
bites inside the process: the session leaves `activeSessions`, the bearer in hand is refused,
and a fresh sign-in answers 403. Repeating the call with the same input gave the same reply.
What was wrong was the operator-facing line: it promised "this lives in this process's memory
and **will not survive a restart**". The offline fallback keeps its own whole-state snapshot
in `backend/data/store.json`, `users` included, so restarting the same checkout reads the
suspension straight back. The line now states the thing that is actually missing — that this
is not the platform's record and no other instance will ever see it. Two adjacent claims were
checked rather than swept along: `database.js`'s service-pause sentence *is* true, because
`platformServices` is not among the keys that snapshot serialises; and the fallback has no
administrator at all (`this.adminUsers = []`, no superadmin seed in `src/`), so
`/api/admin/*` refuses every caller there — fail-closed, which is why this branch is proven
in-process and why **no browser walk of that sentence is possible**, and none is claimed.

**Block is a distinct action, and the dialog's reason for saying so was wrong.** §4 gives
suspend and block one permission and one route, so the difference had to be found in what
lands, not inferred from the button label. Measured on a live fixture: `Block` opens its own
confirmation, confirming writes `account_status = 'BLOCKED'`, the badge reads `BLOCKED`, the
row offers Reinstate, the trail files `CUSTOMER_BLOCKED` with `ACTIVE → BLOCKED` and its
session counts, and a fresh sign-in answers 403 `ACCOUNT_BLOCKED` — a different code and a
different sentence from `ACCOUNT_SUSPENDED`. Reinstating returns `ACTIVE`. The first draft's
bullet explained the pair as differing "only in severity", which is not what the platform
does: it also files a different action, which is what an outage or compliance sweep searches
by. `CU-33.1`/`CU-33.2` assert the two records apart so a future copy edit that conflates
them fails the run.

**Below 768px — walked at 320, 375, 390, 430 and 768, and four real defects fell out.** The
widths were given to the page as real CSS viewports, not read out of a stylesheet, and each
check measured geometry, hit-tested the control under the pointer, and drove the screen:
search, the status chips, pagination, the navigation drawer, and a full suspend → reinstate
at 320px. (1) The page overflowed horizontally at 320 and 375 because the filter chips sat in
a non-wrapping row; the group wraps now. (2) The table's minimum content width was set by an
unbreakable uuid; `overflow-wrap: anywhere` on the stacked cell — not `break-word`, which
does not participate in min-content sizing — lets the column shrink with the viewport. (3)
The suspension dialog could not be used at phone heights at all: a `position: fixed` scrim
that centres a panel taller than the viewport puts the title above the fold and the confirm
button below it, and a fixed element's overflow creates no scroll box, so neither half was
reachable. The scrim now aligns to the start, scrolls, and `overscroll-behavior: contain`
stops the wheel from dragging the list behind it. (4) The row actions sat past the right edge
below ~360px, and focusing an off-screen button does not scroll a horizontal container in
Chrome, so a keyboard operator was pressing an invisible control; the table wrapper is now a
labelled, focusable scroll region. One limit on the evidence, stated rather than glossed:
screenshot capture did not composite the fixed overlay inside the narrow sub-frames, so the
dialog's fit at those widths is proven by geometry and hit tests, not by pixels.

**The other five screens, same five widths — and the fixes went to the primitives.** The
remaining pages are the dashboard, `/drivers`, `/merchants`, `/orders` and `/campaigns`. Each
was given a real CSS viewport at 320, 375, 390, 430 and 768 and measured, not read out of a
stylesheet. Two overflowed the page: `/orders` laid 359px of content into a 305px viewport and
`/campaigns` laid 389px into the same space, both from rows that could not wrap. Neither is
fixed on its own page — `.nabin-row` and `.nabin-card__header` now wrap, which is where the
defect lived and what every screen inherits — and both then report `scrollWidth ===
clientWidth` at all five widths. Touch targets were the larger finding by count: 158 buttons
carried an inline `minHeight: 40` literal, now `var(--target-min)` across the eight files that
held them, and four shared controls measured below the floor — a 32px header menu, a 28px
drawer close, a 28px alert action, and the 36px `.nabin-chip` that doubles as a read-only
status badge. The first three take the token now; the chip's floor is scoped to
`button.nabin-chip`, because raising the badges would change every table's row height for no
reachability gain. What remains wider than the viewport sits inside the labelled, focusable
`.nabin-table-wrap` regions — the driver table's 533px of content, the campaign table's
321px, eight cells on `/merchants` at 320px — which is the behaviour area 45 asks for: the
region scrolls, the table is not shrunk. The walk drove each screen rather than photographing
it: the drawer opens on-canvas with 52px items and a 44px close, the suspension dialog reaches
both ends by scrolling at 320×640 and now opens at the top instead of scrolled to its reason
field (`preventScroll` on the focus, because the consequences are the copy being confirmed),
and the campaign editor lays out at 273px with no overflowing descendant and no input under
40px. `/customers` was re-walked at the same five widths and still holds up — 25 rows, no page
overflow, nothing under the floor, the region still labelled and focusable — as does
`/security` with its 559 session rows. These pages also gained their layer-1 gates while the
widths were being measured, which is §11 answer 10's rule rather than new privilege: a role
without the name sees why, not a button that answers 403.

**The webhook harness's environment is not deterministic, and the cause is process reuse.**
`EXPECTED CONFIGURATION: MISMATCH`, `SOURCE OF CONFIGURATION: shell` — six of the ten
harnesses set `PAYMENT_WEBHOOK_SECRET ||= 'test_*_not_for_deployment'` in their own process
and hand it to the server they spawn, while `backend/.env` deliberately holds neither key, so
the value is whichever environment the harness was started from. The failure is not the
default: `ensureServerRunning()` **reuses any healthy server on :4000**, so a hand-started
process carrying a different pair silently replaces the correctly-configured child, and every
webhook the harness then signs reads `INVALID_SIGNATURE`. The deterministic procedure is the
one this run used: no listener on :4000 before each harness, one harness at a time, so each
spawns and talks to its own process. No application payment security was touched to make a
test pass, and no secret value is printed anywhere in this document or its logs.

Still not claimed: the browser walk does not exercise a second backend instance. The "another
instance honours its own copy until its next reconcile" line, carried here from §1.4's
session mechanics and stated as measured in the Phase D area-4 bullet of §7, is now actually
measured — and it was wrong in the direction that matters. Adoption of another instance's
session is observed over HTTP (INP-21); revocation reaching another instance is not, because
it does not happen (INP-25, INP-26).

Preconditions that make a run trustworthy are recorded in project memory
(`nabin-backend-suite-preconditions.md`): the server and the harness signing webhooks must
hold the *same* payment pair — which `ensureServerRunning()` guarantees only when nothing is
already listening on :4000 — restart-to-load, the 15-minute broadcast window, the surge row
back at 1.0, and never two harnesses at once.

`admin_authorization_test.js` adds one of its own: it **writes** — four throwaway `authz_*`
administrator accounts per run, one `backend_sessions` row for the cross-instance case, and
their revocations — so it is a local-store harness and nothing else. Its CLN section sweeps
every `authz_*` account in the directory to `INACTIVE`, including those a crashed earlier run
left behind, and asserts afterwards that none is enabled (CLN-01).

`admin_identity_gates_test.js` writes too, and its footprint is worth stating because two of
its assertions exist to prove it: one `drivers` row inserted and deleted again, four `idg_*`
probe administrators created and disabled (plus a sweep of any `idg_*` account an aborted run
left enabled), and **five audit records that stay** — deliberately, since the whole point of
`IG-END-2` is that a suspension trail must outlive the row it was about, which is only true
because the trail stores the target id rather than joining to it. It never writes an identity
application, never touches the seeded fleet, and never reads a hosted store.

**The chain behind this section, run 2026-09-23 from fresh processes.** It was run twice,
serially, never two harnesses at once. Pass 1 cleared :4000 once at the start, so the chain's
first harness spawned the backend every later HTTP harness reused. Pass 2 cleared it before
*each* harness, so each got a process of its own (`17472`, `34028`, `33196`, `27936`,
`35340`, `32000` recorded as they came up), which is the run that answers the
process-reuse hazard above. Both passes: **901 assertions, 0 failures** —
`admin_identity_gates_test.js` 64/64, `admin_authorization_test.js` 113/0,
`admin_customers_test.js` 75/75, `admin_audit_fail_closed_test.js` 79/0,
`admin_settings_surface_test.js` 31/0, `auth_failclosed_test.js` 15/0,
`audit_drop_visibility_test.js` 8/0, `test_phase4_orders.js` 66/0, `test_suite.js` 415/0,
`restart_test.js` 35/0 — every harness exiting 0. Environment for both: `NODE_ENV`
development, `SUPABASE_POSTGRES_LIVE=true` against the local Docker PostgREST on :54321,
neither payment key present in `backend/.env` or in the launching shell, and
`global_surge_multiplier` read back at 1.0 before the run started. `admin-web`:
`npm run lint` 0 errors (one pre-existing `no-location-assign-relative-destination` warning
in `src/lib/api.ts`, which this work did not touch) and `npm run build` exit 0 with all eight
routes generated. The browser evidence is the walks above, on the same tree.

---

## 9. Approval stops — work this document does **not** authorise

I will stop and report before:

1. **Any migration beyond 027** (directive 16). Five items want one: durable fleet locations
   (area 3), per-admin dashboard preferences (area 46), `disputes` as a table (area 30),
   durable administrator login
   lockouts — whose two columns exist and are dead, so the security centre can only report
   one process's counters today (§1.4) — and the three control-plane
   mutations that currently have nowhere to be written — merchant suspension, the identity
   review queue, and grocery price review (§2.5). Areas 6, 7 and 8 cannot be finished without
   the last one, because their buttons change process memory only. Migrations 001–026 are
   frozen; 027 stays local-only and is not applied to any hosted environment.
   **The sixth item is gone**: persisting the role/permission matrix is off the list because
   §11 answer 1 (2026-09-22) declined it, so migration 028 will not be written, proposed
   again, or slipped into a phase as an implementation detail.
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
6. **Changing how sessions converge between instances.** The prune predicate in
   `reconcileSessions` decides which bearers a second process honours (§7, Phase D area 4;
   §11 decision 16). Correcting it is two lines and no migration, but it is a change to the
   authorisation path of every process that shares the store, and its failure mode is
   customers signed out of a working app — which is the same class of blast radius as item 2,
   not the same class as a gate on one route. `INP-25` and `INP-26` pin the present behaviour
   in the suite so it cannot drift undocumented, and stay failing on purpose if the predicate
   changes: that inversion has to be a decision, made with the two assertions rewritten.

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
| 1 | Where does the permission matrix live? | (a) keep role-derived grants in code, per-admin overrides deferred; (b) migration 028 adding `admin_role_permissions` + `admin_account_permissions` | **ANSWERED 2026-09-22: (a).** Recorded at §2.2. No migration 028, so per-admin overrides are out of every phase below |
| 2 | KPI list for area 1 | approve the ~23 named in the directive, or trim to what the tables can answer honestly today | B |
| 3 | Reports | (a) CSV only, zero dependencies; (b) add XLSX; (c) add PDF | B |
| 4 | Driver positions | (a) persist to a new table (migration); (b) accept a map that resets on restart and label it as such | C |
| 5 | `driver_payouts` | (a) write payout rows there; (b) derive the payouts view from `ledger_entries` | E |
| 6 | Disputes | (a) type of `support_tickets`; (b) its own table (migration) | G |
| 7 | AI assistant | (a) not built; (b) internal-only rules/no LLM; (c) external provider with a written data-egress position | after G |
| 8 | RLS | (a) document the Express-only enforcement and keep projecting columns explicitly; (b) design per-request scoped tokens | **ANSWERED 2026-09-22: (a).** Recorded at §2.1: Express is the only authorisation layer, every admin read projects its columns, and no phase may assume a second one |
| 9 | The duplicate `GET /api/admin/drivers` (§1.1) | (a) delete the dead second registration; (b) merge the two response shapes into the live one; (c) leave it and rename the second path | **ANSWERED 2026-09-22: (a), implemented in D2.** The second registration is gone, which is why §2.3 counts 14 ungated admin routes rather than 15. Nothing held that open until D2 added `admin_authorization_test.js` CAT-06, which parses every `app.<method>('<path>'` registration in `src/server.js` and fails if any method+path appears twice — so an undone deletion is a failed run, not a quietly unreachable handler |
| 10 | Who besides `SUPER_ADMIN` may hold the gated names no non-super role reaches (§2.3; 26 when this was answered, 27 since D1 added `customers.suspend`) — the emergency killswitch, service pause/resume, account provisioning, campaign publish, session revoke, customer suspension | (a) leave them super-only and say so on the screen; (b) assign them per role in `adminPermissions.js`, which is one edit with a per-route effect and needs no migration | **ANSWERED 2026-09-22: (a).** Recorded at §2.3. The names stay super-only and the screen must state it — a control bound to one of them is hidden or labelled for a caller who lacks the name, never a button that answers 403. Closes §5 rows 32 and 33's grant question; the labelling itself is Phase D work, since that is where the controls get built |
| 11 | The 14 admin reads with no route-level gate, 11 of which answer to any valid administrator token (§2.3) | (a) bind each to a catalogue name that already exists (`services.view`, `promotion.view`, `catalog.manage`, `merchant.manage`, `fleet.manage`, `audit.view`) plus `system.health` from §3; (b) declare them "any signed-in administrator" reads, and record that as the decision instead of leaving it as drift | A — still open, and now measurable rather than assumed: `admin_authorization_test.js` CAT-04 prints the list every run and fails if it grows. The three that decide inside the handler and the one that compares `req.admin?.role` by hand are *not* open despite appearing there, so option (a) for those is a spelling change, not a privilege change |
| 12 | Administrator lockout trail | (a) accept the per-process counter and keep labelling it as §1.4 does; (b) migration: write `failed_attempts`/`locked_until`, or an `admin_login_events` table, so a second instance and a restart see the same answer | when the security screen is built |
| 13 | Should an unmasked identity read leave a trail? D2 gated the document *file* and masked the raw Aadhaar/Voter ID numbers on both queue routes, but neither route records who saw the unmasked form — so the platform can prove a reviewer opened a PDF only if that reviewer used the file route, and can prove nothing about the numbers on the list | (a) accept it and say so in §5 row 6, which is where this document currently records it; (b) `auditAppliedChange`-style record on the unmasked branch only, which is one awaited write per read and makes the queue's own traffic auditable | B — it is the same question area 31 asks about every other sensitive read, and D2 should not answer it silently |
| 14 | Does a rejected KYC decision own closing an account? `UserRepository.applyIdentityDecision` writes `users.account_status = 'SUSPENDED'` for a `REJECTED` identity decision — straight into the column, not through `setCustomerAccountStatus`, so the write carries no reason, no audit record of its own and no session revocation, while D1's guard makes that value refuse the customer's bearers at request time and 403 their next sign-in. The local directory measured 39/39 `ACTIVE`, which is why the suite never crossed this path | (a) route it through `setCustomerAccountStatus` so it gets the reason, the trail and the revocations; (b) keep identity rejection out of account status entirely and let it gate the queue only; (c) leave as-is and record the gap | D — **flagged, not changed.** (b) is the choice that matches the column's stated purpose and needs a decision from you about whether a KYC refusal may end a customer's sessions at all |
| 15 | What does "reinstate a driver" mean? Suspension overwrites `operational_status`, and no column holds what was there, so reinstating always lands on `AVAILABLE` and the driver stays offline — D2 made the response and the trail say exactly that, and `DS-12` proves it. Restoring the prior status needs a column, which is §9 item 1 | (a) keep the one-way rule and fix the button's copy to say "return to the pool (offline until they come online themselves)"; (b) a `previous_operational_status` column via migration, which needs your explicit approval before anything is written | D — (a) is this document's recommendation, because the UI copy is the actual defect and the fleet's own status is what a driver controls from their app |
| 16 | Must a suspension reach a second instance? `reconcileSessions` skips pruning any key that is 64 hex characters, and every real login is stored under `hashSessionToken(token)` — so an instance that minted a bearer keeps honouring it after another instance deleted the row, and its own hydrated copy of the account still says `ACTIVE`, which is the copy the bearer-time guard reads (`admin_customers_test.js` INP-24/25/26). Adoption across instances works; revocation does not | (a) fix the prune predicate so a hash-keyed entry whose row is gone dies at the next tick — two lines, no migration, but it changes the authorisation path of every process sharing the store and would sign out any bearer whose `persistSession` upsert had silently failed; (b) have the guard consult the store even when it resolves the account locally, which costs a read per customer request against §11 answer 8's "Express is the only layer" posture; (c) accept it and label it — a suspension binds the instance that made it, until the others restart or the session expires | D — **flagged, not changed.** Locally there is one process, so today's practical exposure is nil; what is being decided is whether the durable-session work of task #13 counts as finished. See §9 item 6 for why this is a stop rather than a fix |

Answers to 1, 3, 4, 5, 6, 8, 12, 14, 15 and 16 change schema, dependencies, per-request cost
or who gets signed out, so they are the first things worth settling; the rest can be decided
at the head of their phase.

**1 and 8 are settled, and settled toward no schema change** (2026-09-22). That removes
migration 028 and the scoped-token redesign from the critical path, which is what lets
Phase A close on the code it already has. **10 is settled toward leaving the grants
alone**, so the remaining Phase A work is labelling, not privilege. **9 is settled toward
deleting the dead duplicate** (implemented in D2, held in place by `RT-01`). 2, 3, 4, 5, 6,
11, 12, 13, 14, 15 and 16 are still open and each is asked at the head of the phase that needs
it. Of the three D2 raised: 13 is an audibility gap it deliberately did not paper over, 14
is a write path it found and left alone rather than widen, and 15's option (b) is a
migration — so nothing about 15 beyond the copy fix in (a) happens without your explicit
approval (§9 item 1). Of the two this pass raised: 16 is a mechanism that exists and does
only half of what its comment claims, and it was left alone because the half that is missing
is the one that signs people out.
