# NABIN Super Admin — Command Center

Status: **architecture inspection and gap analysis complete; implementation not started.**
This document is the deliverable required by the spec's own gate: *"Before implementation:
INSPECT THE EXISTING NABIN ADMIN ARCHITECTURE … Reuse existing … Do not create duplicate systems
unnecessarily."* Nothing here was inferred from table names; every count below was read out of the
source.

Local-only work. HEAD `9924138b1d19a3e9e176e1e7883b3c44b23762e6`, no commit, no push, no deploy.

## 1. What already exists (verified)

### Backend — 70 distinct `/api/admin/*` routes (85 registrations)

| Area | Routes present |
|---|---|
| Identity | `login`, `me`, `bootstrap`, `reset-password`, `accounts`, `accounts/:id/status` |
| Customers | `customers`, `customers/:id`, `customers/:id/status`, `customers/:id/sign-out` |
| Drivers | `drivers`, `drivers/:id`, `drivers/:id/status`, `drivers/:id/verify-payout-destination` |
| Restaurants | `restaurants`, `restaurants/:id/status` |
| Instamart / grocery | `dark-stores` (+`:id`, `:id/status`, `:id/inventory`, `:id/inventory/:inventoryId`), `grocery/products/:id/review`, `grocery/price-alerts`, `master-catalog` (+`:id`, `:id/stores`) |
| Rides / orders / parcel | `jobs`, `orders/expire-stale` — **`/api/admin/jobs` is the shared ride+delivery read surface** (`order_state` is the real status column); there is no separate `rides`/`parcels` admin list |
| Finance | `finance/metrics`, `finance/ledger`, `finance/ledger-double-entry`, `finance/settlements/drivers`, `finance/settlements/drivers/:id/payout`, `finance/refund`, `finance/adjustments` |
| Promotions | `promotions` (+`:id`, `:id/redemptions`), `campaigns` (+`:idOrCode`, `:idOrCode/status`, `campaigns/live`), `advertisements` (+`:id`), `notifications/broadcast` |
| Support | `support`, `support/:id/assign`, `support/:id/resolve` |
| Security | `security/sessions`, `security/sessions/revoke`, `security/login-lockouts`, `supabase-status` |
| Operations control | `services/status`, `services/pause`, `services/resume`, `services/emergency-killswitch`, `features/:key`, `platform-settings` (+`:key`) |
| Geography / pricing | `geofences` (+`:id`), `surgezones`, `pricing` |
| KYC | `identity-verifications` (+`:id`, `:id/review`, `:id/lock`, `:id/unlock`) |
| Audit | `audit-logs` |
| Metrics | `metrics` |

Every one of these is guarded server-side: **68 `requirePermission(...)` guards** over a single
predicate (`adminPermissions.js :: adminHoldsPermission`), 401 when unauthenticated vs 403 when
unauthorised. The spec's "hiding a menu item is not authorization" is therefore already the shape
of the backend, and must stay that way.

### Authorisation model (after OP-1)

Roles and grants are now **data**: `permission_keys` (55), `operator_roles` (5), `role_grants` (80),
`operator_grants` (0), with `admin_accounts.role` constrained by a foreign key to `operator_roles`
rather than a hardcoded list. Proven invariants: 1,709/1,709 accounts kept identical effective
permission sets; grant tables are invisible and unwritable to `anon`/`authenticated` (RLS, zero
policies, `service_role` only).

### Admin Web (`admin-web/`, Next.js) — **8 pages**

`/`, `/campaigns`, `/customers`, `/drivers`, `/login`, `/merchants`, `/orders`, `/security`.

### Mobile Admin (`mobile/lib/…`, Flutter) — **7 screens**

`admin_dashboard`, `admin_fleet`, `admin_merchants`, `admin_orders`, `admin_users`,
`admin_feature_controls`, `admin_login` (+ router, auth/providers, theme).

## 2. The real gap

The backend is far ahead of both front ends. Most of "build a command center" is **read-model and
surface work, not new API invention** — which matters because every new endpoint invented here
would be a new unguarded surface.

### Present in backend, absent from Admin Web (build here, no API work)

`/finance` (metrics, ledger, double-entry, settlements, refunds), `/support`, `/audit`,
`/security` deep views (sessions, lockouts — page exists but is thin), `/kyc`, `/instamart`
(dark stores, master catalog, grocery review, price alerts), `/pricing` + `/geofences` +
`/surge`, `/services` (pause/resume/kill-switch), `/feature-flags` + `/platform-settings`,
`/promotions` + `/advertisements` + `/broadcast`.

### Genuinely missing from the backend — do not invent UI for these yet

| Spec asks for | Reality | Consequence |
|---|---|---|
| **Global search** across customer/driver/restaurant/store/ride/order/parcel/payment/ticket | no `/api/admin/search` | needs one aggregated, permission-filtered endpoint; must not be 8 client-side calls (each would need its own guard) |
| **Alert Center / Dashboard automation** (delayed order, driver disconnected mid-job, webhook failed, repeated refund attempts, restaurant offline unexpectedly, inventory problem) | **no alerts table and no `/api/admin/alerts` at all** | this is a new subsystem: derivation rules + persistence + dedup, not a screen |
| **Disputes** as an admin module | only `support/:id/assign|resolve` and `/api/support/ticket*` | decide whether disputes are a ticket category (reuse) or a table (new) — see §4 |
| **Wallet** visibility as a module | no `/api/admin/wallets`; wallet movement is `finance/adjustments` | a read surface is needed; balance mutation must stay on the existing atomic path |
| **Permission-preview / operator creation flow** (steps 3–5 of the spec's Operator Creation) | storage exists (OP-1) but there is **no grant-mutation endpoint** by design | OP-4, not this task |

### Decisions the specs contradict each other on — needs a human call

**Three different role lists are now on the table, and only one exists in the database:**

| Source | Roles |
|---|---|
| **Code + `operator_roles` today (5)** | SUPER_ADMIN, KYC_SPECIALIST, OPERATIONS, FINANCE_AUDITOR, SUPPORT_AGENT |
| **Multi-Operator spec (13)** | + OPERATIONS_MANAGER, DISPATCH_OPERATOR, DRIVER_OPERATOR, RESTAURANT_OPERATOR, INSTAMART_OPERATOR, FOOD_OPERATOR, FINANCE_OPERATOR, SUPPORT_OPERATOR, MARKETING_OPERATOR, SECURITY_OPERATOR, KYC_OPERATOR, ANALYTICS_OPERATOR |
| **Command Center spec (8)** | SUPER_ADMIN, OPERATIONS, FINANCE, SUPPORT, MARKETING, MERCHANT_ADMIN, DRIVER_ADMIN, SECURITY_ADMIN |

The 8-list maps almost onto the existing 5 (`OPERATIONS`→`OPERATIONS`, `FINANCE`→`FINANCE_AUDITOR`,
`SUPPORT`→`SUPPORT_AGENT`, `MERCHANT_ADMIN`/`DRIVER_ADMIN`→ slices of `OPERATIONS`, `MARKETING`/
`SECURITY_ADMIN`→ permission families, not roles). The 13-list is finer-grained by service.
**Choosing between them changes the permission matrix, so it is not mine to make silently** — and
local data means it is not theoretical: 1,709 accounts sit on the 5 roles (1 super admin, 549
OPERATIONS, 419 KYC_SPECIALIST, 370 FINANCE_AUDITOR, 370 SUPPORT_AGENT; only 351 active).

Also: the permission *key vocabulary* differs. The spec proposes `customers.read`,
`rides.dispatch`, `finance.settlements.read`, `payments.refund.request`; the code uses
`customers.read`, `orders.manage`, `finance.settlement`, `finance.refund`. `customers.read`
already agrees; the rest would be renames or additions, and renaming a live key invalidates every
stored grant row. Recommend **extending the catalogue, never renaming** (OP-1's
`PERMISSION_KEY_UNKNOWN` refuses anything outside it, which is the guard that makes this safe).

## 3. Home screen — the "one-person operation" answers

The spec's nine questions map onto existing endpoints, so `/` is assembleable without new API:

| Question | Existing source |
|---|---|
| What is happening now? | `jobs`, `metrics`, `services/status` |
| What needs my attention? | `support`, `identity-verifications`, `grocery/price-alerts`, `grocery/products/:id/review` — **no alert feed exists**, so this is currently manual |
| Is money moving correctly? | `finance/metrics`, `finance/ledger`, `finance/settlements/drivers` (all four were made durable-authority in F3/F4/F5) |
| Are customers having problems? | `support`, `orders/expire-stale` |
| Drivers / restaurants / Instamart operating normally? | `drivers`, `restaurants`, `dark-stores/:id/inventory` |
| Security problems? | `security/login-lockouts`, `security/sessions`, `audit-logs` |
| External services failing? | `supabase-status`, `services/status` — the failure-safety rule ("never display fake success") is already the convention on these routes |

## 4. Financial controls — keep as they are

`The dashboard must NOT directly modify financial balances` is already true, and was hardened by
measure, not intention: `finance/refund` and `finance/adjustments` are atomic, idempotent
(`IDEMPOTENCY_CONFLICT` → 403/409 as classified), journalled through `journal_transactions`/
`journal_lines` with a balanced-entry check, and settlement/payout reads go to durable rows
(`getDriverSettlements`, `getDoubleEntryLedger`) rather than in-memory mirrors. The spec's
request→review→approval→execution flow is **OP-6, deliberately deferred** — adding an approval
step in front of a working atomic path is a financial-integrity change, not a dashboard change.

Any new finance surface must read, never write, and reuse those endpoints. `Avoid giving direct
balance-modification permission` is satisfied today by `finance.adjust` being held only by
SUPER_ADMIN and FINANCE_AUDITOR.

## 5. Security posture to preserve

- Never trust client-supplied admin id, role, permissions, target ownership, or financial amounts
  — this is the exact class of defect OP-1's write path refuses (`PERMISSION_KEY_UNKNOWN`,
  `OPERATOR_IDENTITY_AMBIGUOUS`, `OPERATOR_NOT_FOUND` with no fallback row, and
  `AUTHORIZATION_ACTOR_UNRESOLVED` for unattributable grants).
- No automatic SUPER_ADMIN, no master password, no backdoor. `bootstrap` exists and is secret-gated;
  `do not automatically create SUPER_ADMIN` must be respected in any new seeding.
- Last-SUPER_ADMIN lockout protection stays.
- Sensitive fields: `identity_documents.view/download` and `identity_verification.*` are already
  separate keys. **Masking does not exist anywhere in the backend** (no mask helper found), so the
  spec's masking requirement is real, unbuilt work — and its prerequisite (a per-field sensitive-data
  inventory) has not been done. Do not build a masked screen before that inventory; guessing which
  fields are sensitive is how a phone number ends up in a log line.
- Secrets: nothing in this document contains a key, token, or password; admin credentials used by
  tests are local-only fixtures.

## 6. Proposed sequencing (not started)

1. **SC-1 Finance + Support + Audit pages in Admin Web** — pure reuse of existing guarded routes;
   highest operator value per unit of risk, and it exercises the permission surface rather than
   changing it.
2. **SC-2 Instamart/grocery + operations-control pages** (dark stores, master catalog, reviews,
   services pause/resume/kill-switch, feature flags) — again reuse; kill-switch needs confirmation +
   re-auth per the spec's dangerous-operation rule.
3. **SC-3 Sensitive-data inventory → masking** — read-only analysis, then implement.
4. **SC-4 Global search** — one permission-filtered endpoint, tested so a scoped operator cannot
   enumerate rows they may not read.
5. **SC-5 Alert center + dashboard automation** — new subsystem (rules, dedup, persistence). Must not
   become noisy; needs thresholds defined before code.
6. **SC-6 Wallet read surface**; **SC-7 disputes decision** (ticket category vs table).
7. **Role matrix decision** (the three-way collision above) → this belongs to **OP-2**, which is a
   separate, authorised programme. Do not fold a 13-role decision into dashboard work.

Mobile Admin should keep the priority list it already partly has (alerts, live operations, lookups,
support, feature controls) and defer analytics/large tables to Web, as the spec says.

## 7. Remaining work — plainly

No dashboard code was written in this pass. The inspection is what the spec asked to happen first,
and it produced two findings that would have been expensive to discover later: **the backend is
~70 guarded routes deep while the web surface is 8 pages, so most of the work is reading, not
inventing**; and **the three role lists on the table do not agree**, which cannot be resolved by
whichever one is easiest to implement, because 1,709 existing accounts are already partitioned
across the five that exist.
