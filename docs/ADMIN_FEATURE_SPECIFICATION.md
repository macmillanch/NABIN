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

`backend/src/server.js` registers **70 routes under `/api/admin/*`** (parsed from the
route table itself, not from a grep of strings):

| Gate | Count | Meaning |
|---|---|---|
| No middleware | 3 | `/api/admin/bootstrap`, `/api/admin/login` (intentional entry points), and `POST /api/admin/grocery/products/:id/photo` — see §2.6 |
| `authenticateAdmin` only | 14 | any valid admin session, including a `SUPPORT_AGENT`: `drivers`, `drivers/:id`(dup), `jobs`, `restaurants`, `metrics`, `accounts`×2, `advertisements` (the **read** only), `master-catalog/:id/stores`, `supabase-status`, `features`×3, `reset-password` |
| `authenticateAdmin` + `requirePermission(...)` | 51 | named-permission gate |
| `authenticateAdmin` + `requireSuperAdmin` | 2 | the `platform-settings` pair |

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

- **At sign-in** (`server.js:1247` → `database.js:5139`): the password proves the caller
  knows a secret; the store decides whether the account still exists and is still
  `is_active`. An unreachable store **refuses the login** rather than answering from
  memory, and a removed account gets the same message as a wrong password.
- **On every request** (`authenticateAdmin`, `server.js:794`): the bearer resolves
  through `activeAdminSessions` / `db.getSessionByToken`, then a deactivation check reads
  the **in-process `adminUsers` copy**, not the store.

So a disable made directly in `admin_accounts` does not stop an already-issued token in a
running backend; it converges when that administrator next attempts to sign in
(`server.js:1266` writes `INACTIVE` into the copy, which then fails the per-request check).
That is a *delayed* revocation, not a broken one, but it is not what area 34 asks for.
Two things Phase A must therefore provide: an admin-facing session list with revoke backed
by `active_sessions` / `backend_sessions`, and a revocation path that removes
`activeAdminSessions` entries rather than waiting for a restart.

`admin_accounts` itself carries `failed_attempts` and `locked_until`, and a failed login is
audited with the caller's IP (`server.js:1228`) — the lockout trail a security centre needs
already exists, it is just not visible to any screen.

---

## 2. Five facts that constrain every design choice

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

### 2.2 The permission matrix is not persisted, and cannot be per-administrator

`requirePermission` (`backend/src/server.js:840`) grants when
`req.admin.role === 'SUPER_ADMIN'` **or** `permissions.includes(requiredPerm)`. The
`permissions` array comes from a hard-coded `defaultPermissionsMap` inside
`createAdminAccount` (`backend/src/database.js:3927`), held only in the in-process
`adminUsers` list — and a **second, different copy of that same map** lives at
`backend/src/database.js:1803`, applied when the boot sync hydrates `admin_accounts`
(it overwrites the in-memory entry, `database.js:1845`). They do not agree: the boot map
gives `SUPER_ADMIN` **40** strings including `services.*`, `audit.export`,
`promotion.activate`, `finance.settlement`, `support.view`; the provisioning map gives
**18**, without them. So the same username holds a *wider* grant list after a restart than
the one it was created with, and the matrix is not auditable from either file alone.
`resolveAdminByPhone` (`backend/src/database.js:5111`) returns
`permissions: known ? known.permissions : []` — an administrator who exists in
`admin_accounts` but has no in-memory twin signs in with **zero** permissions.

**Consequences**:

- Grants cannot be edited without a code change and a restart.
- A second backend process, or a restart that misses the boot sync, silently changes who
  can do what.
- Per-administrator overrides (the natural next ask after area 33) are impossible today.
- The role `CHECK` in `001_central_schema.sql:178` allows exactly five values:
  `SUPER_ADMIN, KYC_SPECIALIST, OPERATIONS, FINANCE_AUDITOR, SUPPORT_AGENT`. An
  unrecognised role silently becomes `OPERATIONS`
  (`backend/src/database.js:3966`: `|| defaultPermissionsMap.OPERATIONS`) — a **fail-open
  default**, and the one item in this section I would fix before building anything on top.

Persisting the matrix needs a new table → migration **028** → §9 approval stop.

### 2.3 36 permissions are enforced; two sets don't line up

The enforced set (measured from the guard list, 36 distinct strings):
`advertisement.{create,edit,delete}`, `audit.view`, `campaign.{view,create,edit,publish,delete}`,
`catalog.manage`, `finance.{view,refund,adjust,settlement}`, `fleet.manage`,
`geofence.{view,create,delete}`, `grocery.review`,
`identity_verification.{view,review}`, `merchant.manage`, `notification.broadcast`,
`orders.manage`, `pricing.edit`, `promotion.{view,create,edit}`,
`services.{pause,resume,emergency_killswitch}`, `support.{view,respond,resolve}`,
`surge.{view,create}`.

- **Enforced but granted to no non-super role** — reachable today only through
  `SUPER_ADMIN`'s role wildcard, which is to say unusable by least-privilege staff and
  invisible to the matrix: `advertisement.*`, `campaign.*`, `catalog.manage`,
  `geofence.{create,delete}`, `grocery.review`, `notification.broadcast`,
  `orders.manage`, `pricing.edit`, `promotion.{view,create,edit}`, `services.*`,
  `surge.create`.
- **Granted but never enforced** (16 strings): `identity_verification.{approve,reject,
  request_resubmission}`, `identity_documents.{view,download}`, `support.escalate`,
  `promotion.activate`, `geofence.edit`, `surge.{edit,activate}`, `audit.export`,
  `services.view`, `notification.view`, `admin_accounts.{create,manage}`. Three of these
  are exactly what areas 22, 31 and 32 ask to be real: a coupon activation, an audit
  export, and admin provisioning. `admin_accounts.*` *is* restricted — but by an inline
  `req.admin.role !== 'SUPER_ADMIN'` test (`server.js:1804`, `1812`), correct today and
  invisible to the matrix, so it will drift the moment a non-super role needs it. Note
  also that `finance.settlement` is enforced and granted to `FINANCE_AUDITOR`, while the
  *provisioning* map omits it for `SUPER_ADMIN` and the *boot* map includes it — harmless
  only because of the role wildcard, and a good illustration of why the matrix needs one
  source.
- **In-handler role checks instead of middleware**: `POST/PUT /api/admin/features*`
  (`server.js:5498`, `5532`), `accounts` (`1804`, `1812`), `reset-password` (`1339`). Same
  answer, four spellings.

### 2.4 A feature flag can write any platform setting

`POST /api/admin/features` (`server.js:5492`) upserts `platform_settings` keyed on the
caller-supplied `key`. Because flags and settings share the one table, a request with
`key: 'nabin.admin.theme_v1'` writes a theme record through the flag endpoint, and the
flag endpoint's permission is a role check rather than `settings.edit`. Area 38's
requirement — flags must not become a way around other controls — fails on this. Fix is
small: namespace the key (`feature.<key>`) or move flags to their own table (same §9
migration stop).

### 2.5 Memory-only surfaces

These answer 200 from process state and are lost or divergent on restart — each one is a
lie an operator can act on, and they are the reason §7 puts a `dataSource` label on every
admin read:
`master_grocery_catalog` CRUD, `fleetLocations` (the map's data), the `advertisements`
fallback list, `activeAdminSessions`, the dispatch offers cache, and the boot-synced
copies of `pricingConfig`, `geoFences`, `surgeZones`, `ledgerEntries`,
`supportTickets`.

### 2.6 One anonymous route I did **not** change, on purpose

`POST /api/grocery/products/:id/photo` **and its `/api/admin/` alias** (`server.js:6631`)
accept a base64 image with no credentials, and can create rows in the grocery catalogue.
`backend/cloudinary_test.js:126` posts to it with no `Authorization` header, so gating it
turns a green test red. Per the standing rule *"fix the implementation rather than
modifying the test to hide the failure"* and *"when something conflicts with an earlier
requirement, STOP and report the conflict"*, it is **reported, not silently fixed**, and
belongs to task #51 (campaign asset architecture), where the media surface gets a real
upload contract. This is the only unauthenticated `/api/admin/*` path other than the two
login entry points.

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
| security | `security.view` `NEW`, `security.session.revoke` `NEW` | area 34 |
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
| 6 | KYC queue with private document storage | EXISTS — `identity-verifications` list/`review`/`lock`/`unlock`, `identity_documents` table, `/docs/:filename` preview | `identity_documents.view` is granted but **unenforced**; document preview must be permission-checked per owner-tenant | D |
| 7 | Merchant management with tenant isolation | PARTIAL — `POST /api/admin/restaurants/:id/status`, `GET /api/restaurants` for admin | No merchant detail/edit; merchant-scoped endpoints already prove tenant isolation via `requireMerchantTenant` and reuse it here | D |
| 32 | Admin users, least privilege, no auto SUPER_ADMIN | PARTIAL — `GET/POST /api/admin/accounts` inline-gated to SUPER_ADMIN | No disable/reset-everyone flow, no permission UI (blocked by §2.2), and the fail-open role default must go first | A |

### Transactions

| # | Area | Today | Gap | Phase |
|---|---|---|---|---|
| 8 | Catalog / products with bulk update | PARTIAL — `master-catalog` CRUD (memory-only, §2.5), `grocery/products/:id/review` | No bulk operation; persistence of master-catalog writes | E |
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
| 31 | Audit log protected from normal deletion | EXISTS — `trg_audit_logs_immutable` + `GET /api/admin/audit-logs` | 32 audit writes in `database.js` are un-awaited vs 6 awaited (task #57): the trail can silently lose rows | A |
| 33 | Permission matrix with named permissions, enforced server-side | PARTIAL — `requirePermission` is a real server-side gate on 51 routes, with 36 named strings | The names live inline, two divergent grant maps decide who holds them (§2.2), 16 granted strings have no gate and 11 gated strings belong to no role (§2.3), and four routes use ad-hoc role tests instead. §3 is the target catalogue; persisting it is the §9 migration | A |
| 34 | Security centre | MISSING as a surface | Sessions (`active_sessions`/`backend_sessions`), failed-login lockouts (`failed_attempts`, `locked_until`), admin session list + revoke. Revocation today is delayed rather than absent — see §1.4 | A |
| 36 | Integrations, never display secret values | PARTIAL — `platform_settings` holds mixed data | Show presence/configured-state + last check, never a value; `PUT` rejects anything secret-shaped | A |
| 37 | Settings, secrets not editable from admin UI | PARTIAL — `GET/PUT /api/admin/platform-settings` (`requireSuperAdmin`) | Needs an allow-list of keys, not an open key/value editor over a table that also holds config the server reads at boot | A |
| 38 | Feature flags that cannot bypass controls | PARTIAL — `features` routes, `is_feature_enabled()` | §2.4: a flag write can address any `platform_settings` key; must be namespaced, and flags must remain unable to disable auth/authz/payment/RLS/audit | A |
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
  (`database.js:5060`) — the awaited-audit pattern for directive (7)'s "every sensitive
  operation is audited".

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
1. Fail-closed role: an unknown `admin_accounts.role` refuses to sign in instead of
   becoming `OPERATIONS` (`database.js:3966`).
2. One permission catalogue module; every `requirePermission` literal sourced from it;
   `GET /api/admin/me` returns `{ role, permissions }` so the UI can gate honestly.
3. Move `accounts`, `features` and `reset-password` inline role checks onto
   `requirePermission` with the §3 names.
4. Namespace feature-flag keys so a flag write cannot address another domain's setting
   (§2.4).
5. Awaited audit writes on every admin mutation (closes the `database.js` half of #57).
6. Security centre read surface: sessions, lockouts, revoke — plus the single dangerous-
   action confirmation component (area 49).
7. Settings/integrations: key allow-list, secret values never rendered, never writable.

**Gate:** `test_suite.js` green *plus* a new `admin_authorization_test.js` that, for each
of the five roles, proves allow/deny on every gated route (the existing `RBAC-01..12`
module is the model), and proves a revoked admin session stops working.

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
| `backend/test_suite.js` | 408 existing assertions incl. `RBAC-01..12`, `CC-00..17` | every phase |
| `backend/outage_semantics_audit.js` | 5xx-vs-4xx semantics under a real store outage | phases touching store traffic |
| `backend/payment_verifier_config_test.js` | verifiers fail closed when unconfigured | any payment/refund change |
| `backend/restart_test.js`, `test_phase4_orders.js`, `test_phase5_payments.js` | durability across restart, order/payment invariants | phases C/E/F |
| `backend/cloudinary_test.js` | media surface | phase F/E media |
| `admin_authorization_test.js` (**new, phase A**) | allow/deny per role per route; revoked session dead | phases A–G |
| Flutter `main_admin.dart` widget tests + `flutter analyze` | the admin mobile app | phases with mobile changes |

Preconditions that make a run trustworthy are recorded in project memory
(`nabin-backend-suite-preconditions.md`): both payment secrets exported into the server's
env, restart-to-load, the 15-minute broadcast window, the surge row, and never two
harnesses at once.

---

## 9. Approval stops — work this document does **not** authorise

I will stop and report before:

1. **Any migration beyond 027** (directive 16). Four items want one: persisting the
   role/permission matrix (§2.2), durable fleet locations (area 3), per-admin dashboard
   preferences (area 46), and `disputes` as a table (area 30). Migrations 001–026 are
   frozen; 027 stays local-only and is not applied to any hosted environment.
2. **Any financial correction or settlement-logic change** (directives 14/15) — including
   the `driver_payouts` writer question and the FI-08 evidence, which stays as documented
   in `docs/FI08_SETTLEMENT_OVERPOSTING_EVIDENCE.md`.
3. **Adding a dependency** — chart library, XLSX/PDF writer, or any model provider for
   area 44. Each is also a new secret and, for the AI case, a data-egress decision.
4. **Anything touching hosted Supabase, pushing, or deploying.**

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

Answers to 1, 3, 4, 5, 6 and 8 change schema or dependencies, so they are the first
things worth settling; the rest can be decided at the head of their phase.
