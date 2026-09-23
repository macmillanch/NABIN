# NABIN — Admin Permission Matrix

Measured 2026-09-23 against commit `9eca93d`. Every row in this file is read out of code, not
written from intention: the permission names come from `backend/src/adminPermissions.js`, the
routes from the registrations in `backend/src/server.js` (parsed, not counted by hand), the
audit events from the `action:`/`module:` literals the mutation paths actually pass, and the
client gating from `admin-web/src`. Where this file and
[`ADMIN_FEATURE_SPECIFICATION.md`](ADMIN_FEATURE_SPECIFICATION.md) disagree, the specification
governs and this file is wrong — but the counts below were re-derived from source on this run
precisely so that disagreement is visible rather than inherited.

Two rules bound everything here:

- **Nothing is invented.** 55 permission names exist; all 55 are listed, including the 9 that
  gate nothing. A capability with no route (disputes, reports, data export, wallet reads,
  payment lists, dispatch boards) is recorded as **no such permission**, because §3's `NEW`
  strings are a target and this file is a measurement.
- **Terminology is preserved, not normalised.** `fleet.manage` means drivers, `merchant.manage`
  means restaurants, `support.respond` protects the *assign* route, `campaign.*` means
  advertisements' sibling domain. Those names are what the code, the audit trail and
  `GET /api/admin/me` say, so they are what an operator searching a log would find.

---

## 1. The three layers, and which of them exist

| Layer | What it is | Reality |
|---|---|---|
| 1 — UI visibility | `admin-web` hides a control the caller cannot use | Exists on **all six action screens** as of this pass: `/customers` and `/security` had it, and `/` (`services.pause`/`services.resume`), `/drivers` (`fleet.manage`), `/merchants` (`merchant.manage`) and `/campaigns` (`campaign.view`/`create`/`edit`/`publish`, `promotion.view`) now gate through `holdsPermission()` and say why where a control was removed. Plus the nav filter in `AdminLayout.tsx:75`. It is still layer 1: typing the URL reaches the route and the route refuses (§2.1 of the spec says Express is the only authorisation layer, and that must stay true). |
| 2 — API authorisation | `requirePermission` / `requireIdentityDecision` / `requireSuperAdmin` in Express | The **only** real layer. 61 of the 76 `/api/admin` registrations gate at the route; 3 more decide inside the handler; `POST /api/admin/login` and `POST /api/admin/bootstrap` are open by design; the remaining 11 admin reads answer to any valid administrator token (§5). One admin path reaches neither layer — `POST /api/admin/grocery/products/:id/photo` (§6.5). |
| 3 — Database / RLS / resource scope | Row-level policy that would refuse the same row to the same caller | **Absent by decision, not by omission.** §2.1 of the specification records that RLS is bypassed for every backend connection, and §11 answer 8 (2026-09-22) chose to keep it that way and document it. Every scope in this file is therefore a *handler* scope — the `WHERE` a route writes — never a policy that would catch a route that forgot one. |

So the honest statement of the model is: **layer 2 is the enforcement point, layer 1 is
decoration, layer 3 does not exist.** No capability below may be described as "protected by
RLS", and no layer-1 gate counts as authorisation anywhere in this file.

Layer 2 has one more property that matters when reading the tables: `requirePermission` admits
`SUPER_ADMIN` by wildcard **before** consulting its grant list
(`adminPermissions.js:130-133`), so a probe of a super-only name proves reachability and
nothing about the grant.

---

## 2. Permission catalogue — all 55 names

`R`/`W` is what the enforced routes do. **Holders** are the non-`SUPER_ADMIN` roles whose grant
list carries the name; `SUPER_ADMIN` holds all 55 by wildcard. **Confirm** = the admin-web
control that fires it is wrapped in `ConfirmAction` (area 49). **Audit** is the `action` the
mutation writes to `audit_logs` (module in parentheses). A dash means the layer does not exist
for that row — recorded, not smoothed over.

### 2.1 Enforced names (46)

| Permission | Holders | R/W | Backend routes (method path) | Resource scope | Audit action (module) | Confirm | Screen |
|---|---|---|---|---|---|---|---|
| `admin_accounts.create` | super only | W | `POST /api/admin/accounts` `:1990` | creates a new administrator row | `CREATE_ADMIN_ACCOUNT` (ADMIN_PROVISIONING) | — | none (no provisioning UI) |
| `admin_accounts.manage` | super only | R+W | `GET /api/admin/accounts` `:1985`, `POST /api/admin/accounts/:id/status` `:2130` | list is platform-wide; the write targets one `:id` and refuses to disable the last enabled `SUPER_ADMIN` | `ADMIN_ACCOUNT_ENABLED`/`_DISABLED` (AUTH) | yes | `/security` |
| `advertisement.create` | super only | W | `POST /api/admin/advertisements` `:2501` | new row | `ADVERTISEMENT_CAMPAIGN_CREATED` (PROMOTIONS) | — | none |
| `advertisement.edit` | super only | W | `PUT /api/admin/advertisements/:id` `:2522` | one `:id` | `ADVERTISEMENT_CAMPAIGN_UPDATED` (PROMOTIONS) | — | none |
| `advertisement.delete` | super only | W | `DELETE /api/admin/advertisements/:id` `:2543` | one `:id` | `ADVERTISEMENT_CAMPAIGN_DELETED` (PROMOTIONS) | — | none |
| `audit.view` | KYC_SPECIALIST, FINANCE_AUDITOR, SUPPORT_AGENT | R | `GET /api/admin/audit-logs` `:1520` | filterable read over an append-only table (`trg_audit_logs_immutable`) | n/a (read) | — | none |
| `campaign.view` | super only | R | `GET /api/admin/campaigns` `:2645`, `/live` `:2669`, `/:idOrCode` `:2688` | collection / live projection / one row | n/a | — | `/campaigns` |
| `campaign.create` | super only | W | `POST /api/admin/campaigns` `:2711` | new row | `CAMPAIGN_CREATED` | no (creating is not a take-down) | `/campaigns` |
| `campaign.edit` | super only | W | `PUT /api/admin/campaigns/:idOrCode` `:2731` | one row, CAS on `revision` | `CAMPAIGN_UPDATED` | **no for an edit to an already-live campaign** (§5 row 49) | `/campaigns` |
| `campaign.publish` | super only | W | `POST /api/admin/campaigns/:idOrCode/status` `:2789` | one row's state | `CAMPAIGN_${target}` | yes (ACTIVE/PAUSED/ARCHIVED) | `/campaigns` |
| `campaign.delete` | super only | W | `DELETE /api/admin/campaigns/:idOrCode` `:2830` | one row | `CAMPAIGN_ARCHIVED` | **no surface — `admin-web` never issues a DELETE** (§6.3); retiring one from the screen is `campaign.publish` to `ARCHIVED` | none |
| `catalog.manage` | super only | W | `POST /api/admin/master-catalog` `:5422`, `PUT /api/admin/master-catalog/:id` `:5432`, `DELETE /api/admin/master-catalog/:id` `:5442` | one product row | **NO AUDIT RECORD** (§6.2) | — | none |
| `customers.read` | OPERATIONS, SUPPORT_AGENT | R | `GET /api/admin/customers` `:2182`, `/:id` `:2204` | collection with status/search filters; one row | n/a | — | `/customers` |
| `customers.suspend` | super only | W | `POST /api/admin/customers/:id/status` `:2218`, `/:id/sign-out` `:2253` | one customer; `account_status` CHECK limits values to ACTIVE/SUSPENDED/BLOCKED | `CUSTOMER_ACTIVE\|SUSPENDED\|BLOCKED` (CUSTOMER), `CUSTOMER_SESSIONS_REVOKED` (CUSTOMER) | yes, all four actions | `/customers` |
| `finance.view` | FINANCE_AUDITOR | R | `GET /api/admin/finance/metrics` `:1802`, `/ledger` `:1806`, `/finance/ledger-double-entry` `:6809` | aggregates over append-only ledger tables | n/a | — | none |
| `finance.refund` | FINANCE_AUDITOR | W | `POST /api/admin/finance/refund` `:1889` | one payment; `refund_payment_atomic` (`FOR UPDATE`, `refundable_left`, idempotency UNIQUE) | `REFUND_PROCESSED` (FINANCE) | no surface yet | none |
| `finance.adjust` | FINANCE_AUDITOR | W | `POST /api/admin/finance/adjustments` `:1878` | one wallet via `adjust_wallet_atomic`, never a balance write | `FINANCIAL_ADJUSTMENT` (FINANCE) | no surface yet | none |
| `finance.settlement` | FINANCE_AUDITOR | R+W | `GET /api/admin/finance/settlements/drivers` `:1817`, `POST …/drivers/:id/payout` `:1830`, `POST /api/admin/drivers/:id/verify-payout-destination` `:4117` | one driver | `SETTLEMENT_EXECUTED` (FINANCE), `PAYOUT_DESTINATION_VERIFIED`/`_REJECTED` (FINANCE_SETTLEMENT) | no surface yet | none |
| `fleet.manage` | OPERATIONS | W | `POST /api/admin/drivers/:id/status` `:1578` | one driver; the response states what it did to `operational_status`, `is_online` and the audit value | `DRIVER_SUSPENDED`/`DRIVER_ACTIVATED`, `DRIVER_KYC_${status}` (DRIVER_FLEET) | yes | `/drivers` |
| `geofence.view` | OPERATIONS | R | `GET /api/admin/geofences` `:2865` | collection | n/a | — | none |
| `geofence.create` | super only | W | `POST /api/admin/geofences` `:2874` | new row | `GEOFENCE_CREATED` (GEOFENCING) | — | none |
| `geofence.delete` | super only | W | `DELETE /api/admin/geofences/:id` `:2883` | one row | `GEOFENCE_DELETED` (GEOFENCING) | — | none |
| `grocery.review` | super only | W | `POST /api/admin/grocery/products/:id/review` `:5926` | one product's price status; **process memory only** (§2.5) | `ADMIN_PRICE_${action}` (GROCERY_PRICING) | — | none |
| `identity_verification.view` | KYC_SPECIALIST, OPERATIONS | R | `GET /api/admin/identity-verifications` `:3174`, `/:id` `:3206` | queue / one application; raw Aadhaar and voter-ID keys are withheld unless the caller also holds `identity_documents.view` | n/a, and the unmasked read leaves no trail (§11 decision 13) | — | none |
| `identity_verification.review` | KYC_SPECIALIST | W | `POST …/:id/lock` `:3246`, `/unlock` `:3260`, `/review` `:3270` | one application | `LOCKED`, `UNDER_REVIEW` (IDENTITY_VERIFICATION); **`/unlock` writes nothing** (§6.2) | — | none |
| `identity_verification.approve` | KYC_SPECIALIST | W | *route-level*: chained `requireIdentityDecision` on `POST …/:id/review` `:3270` | one application, decision `APPROVE` | `APPROVED` (IDENTITY_VERIFICATION) | — | none |
| `identity_verification.reject` | KYC_SPECIALIST | W | same route, decision `REJECT` | one application, decision `REJECT` | `REJECTED` (IDENTITY_VERIFICATION) | — | none |
| `identity_verification.request_resubmission` | KYC_SPECIALIST | W | same route, decision `REQUEST_RESUBMISSION` | one application | `RESUBMISSION_REQUESTED` (IDENTITY_VERIFICATION) | — | none |
| `identity_documents.view` | KYC_SPECIALIST | R | `GET /docs/:filename` `:5092` | one document by filename; today that route serves a hard-coded mock | n/a | — | none |
| `merchant.manage` | OPERATIONS | W | `POST /api/admin/restaurants/:id/status` `:4095` | one merchant; the written flag **has no column** and lives in process memory (§2.5) | `RESTAURANT_SUSPENDED`/`RESTAURANT_ACTIVATED` (MERCHANT_PARTNER) | yes | `/merchants` |
| `notification.broadcast` | super only | W | `POST /api/admin/notifications/broadcast` `:7647` | every device of a target class; rate window is 1-per-15-min **process-local** | `NOTIFICATION_BROADCAST` (NOTIFICATIONS) | — | none |
| `orders.manage` | super only | W | `POST /api/admin/orders/expire-stale` `:5910` | bulk: every order the `expire_stale_orders` RPC finds stale | **NO AUDIT RECORD** (§6.2) | — | none |
| `pricing.edit` | super only | R+W | `GET /api/admin/pricing` `:3028`, `POST /api/admin/pricing` `:3037` | **a read gated by a write name**; edits `pricing_configurations` with no effective dating, so it changes history (§5 row 19) | `PRICING_UPDATED` (PRICING_ENGINE) | — | none |
| `promotion.view` | super only | R | `GET /api/admin/promotions` `:2276`, `/:id/redemptions` `:2386` | collection / one promotion's redemptions | n/a | — | `/campaigns` |
| `promotion.create` | super only | W | `POST /api/admin/promotions` `:2285` | new row | `PROMOTION_CREATED` (PROMOTIONS) | — | none |
| `promotion.edit` | super only | W | `PUT /api/admin/promotions/:id` `:2306` | one row | `PROMOTION_UPDATED` (PROMOTIONS) | — | none |
| `security.view` | super only | R | `GET /api/admin/security/sessions` `:2018`, `/login-lockouts` `:2046` | session directory (unpaged); lockout counters are `scope: 'THIS_SERVER_PROCESS_ONLY'` | n/a | — | `/security` |
| `security.session.revoke` | super only | W | `POST /api/admin/security/sessions/revoke` `:2062` | one handle or one account; store row deleted **before** this process's maps | `ADMIN_SESSION_REVOKED`/`ADMIN_SESSIONS_REVOKED` (AUTH) | yes | `/security` |
| `services.pause` | super only | W | `POST /api/admin/services/pause` `:1095` | one service id | `ADMIN_SERVICE_PAUSED` (SERVICE_CONTROL) | yes | `/` |
| `services.resume` | super only | W | `POST /api/admin/services/resume` `:1141` | one service id | `ADMIN_SERVICE_RESUMED` (SERVICE_CONTROL) | yes | `/` |
| `services.emergency_killswitch` | super only | W | `POST /api/admin/services/emergency-killswitch` `:1180` | every service at once | `EMERGENCY_KILLSWITCH_ACTIVATED`/`_DEACTIVATED` (SERVICE_CONTROL) | no admin-web surface exists to confirm it | none |
| `support.view` | OPERATIONS, SUPPORT_AGENT | R | `GET /api/admin/support` `:1729` | ticket queue; tickets are boot-synced copies (§2.5) | n/a | — | none |
| `support.respond` | OPERATIONS, SUPPORT_AGENT | W | `POST /api/admin/support/:id/assign` `:1744` | one ticket (the name says *respond*, the route says *assign*); the row it moves is a boot-synced copy (§2.5) | `TICKET_ASSIGNED` (SUPPORT_DISPUTES) — **fire-and-forget, unawaited** (§6.2) | — | none |
| `support.resolve` | SUPPORT_AGENT | W | `POST /api/admin/support/:id/resolve` `:1759` | one ticket | `TICKET_RESOLVED` (SUPPORT_DISPUTES) — **fire-and-forget, unawaited** (§6.2) | — | none |
| `surge.view` | OPERATIONS | R | `GET /api/admin/surgezones` `:2893` | collection | n/a | — | none |
| `surge.create` | super only | W | `POST /api/admin/surgezones` `:2902` | new zone row; no record of the orders whose prices it changes | `SURGE_CREATED` (DYNAMIC_SURGE) | — | none |

Plus two gates that carry no catalogue name:

| Gate | Routes | Scope | Audit | Screen |
|---|---|---|---|---|
| `requireSuperAdmin` (role equality, no string) | `GET /api/admin/platform-settings` `:6193`, `PUT /api/admin/platform-settings/:key` `:6222` | one key inside the `APP_CONFIG_` allow-list; refuses credential-named keys and credential-shaped values, quoting field names only | `PLATFORM_SETTINGS_UPDATED`/`_CREATED` (PLATFORM_SETTINGS) | none |
| `requireIdentityDecision` (name chosen by `req.body.decision`) | the three review routes above | — | see the three decision rows | none |

### 2.2 Names in the catalogue that gate no route (9)

These are enforced nowhere. They appear in `GET /api/admin/me` and in role grant lists, so a
reader can be told "you can export the audit log" by an endpoint that has no such route. §3
lists them as targets and the rule at the bottom of §3 applies: *a permission with no enforcing
route is worse than no permission.*

| Name | Granted to | What would have to exist first |
|---|---|---|
| `audit.export` | super only | an export route (area 42) — §9 item 3 if it needs a writer library |
| `geofence.edit` | super only | a `PUT /api/admin/geofences/:id` (only create/delete exist) |
| `identity_documents.download` | super only | a real download behind the mock `/docs/:filename` |
| `notification.view` | super only | a notification-history read (area 28) |
| `promotion.activate` | super only | an activate/expiry route (area 22) |
| `services.view` | super only | `GET /api/admin/services/status` answers to any admin token instead (§5) |
| `support.escalate` | super only | an escalate route (only assign/resolve exist) |
| `surge.edit` | super only | a `PUT /api/admin/surgezones/:id` |
| `surge.activate` | super only | an activation route |

---

## 3. Capability domains — what exists, what does not

Phase A of the work order asks for every capability with its screen, action, permission, route,
method, role, scope, audit event and confirmation. The two tables below cover all of them; the
second one is the part that must not be written optimistically.

### 3.1 Domains with at least one real admin route

| Domain | Screen | Action(s) | Permission(s) | Route(s) | Method(s) | Required role | Scope | Audit event | Confirmation |
|---|---|---|---|---|---|---|---|---|---|
| CUSTOMERS | `/customers` | read, filter, suspend, block, reinstate, sign out | `customers.read`, `customers.suspend` | `/api/admin/customers`, `/:id`, `/:id/status`, `/:id/sign-out` | GET, POST | read: super/OPERATIONS/SUPPORT · write: super only | one customer | `CUSTOMER_*`, `CUSTOMER_SESSIONS_REVOKED` | yes on all four writes |
| DRIVERS | `/drivers` | list, read, suspend, activate | `fleet.manage` (+ ungated list/detail, §5) | `/api/admin/drivers`, `/:id`, `/:id/status`, `/:id/verify-payout-destination` | GET, POST | super/OPERATIONS (payout destination: super/FINANCE_AUDITOR) | one driver | `DRIVER_SUSPENDED/_ACTIVATED`, `PAYOUT_DESTINATION_*` | yes |
| MERCHANTS | `/merchants` | list, suspend, activate | `merchant.manage` (+ ungated list, §5) | `/api/admin/restaurants`, `/restaurants/:id/status` | GET, POST | super/OPERATIONS | one merchant; **memory-only write** | `RESTAURANT_SUSPENDED/_ACTIVATED` | yes |
| ORDERS | `/orders` | list jobs (read only) | none on the read; `orders.manage` on the bulk expire | `/api/admin/jobs`, `/api/admin/orders/expire-stale` | GET, POST | any admin token / super only | full dump / every stale order | **none** | — |
| RIDES, PARCELS | `/orders` (one dump of `jobs`) | no admin action | none | no admin route | — | — | — | — | — |
| PAYMENTS | none | no admin action | `finance.view` covers ledger reads only | no payment list/detail route | — | — | — | — | — |
| REFUNDS | none | refund (no UI) | `finance.refund` | `POST /api/admin/finance/refund` | POST | super/FINANCE_AUDITOR | one payment, idempotent | `REFUND_PROCESSED` | no UI to confirm |
| WALLETS | none | no admin read; adjust only | `finance.adjust` | `POST /api/admin/finance/adjustments` | POST | super/FINANCE_AUDITOR | one wallet via RPC | `FINANCIAL_ADJUSTMENT` | no UI |
| PAYOUTS | none | settlement, payout, verify destination | `finance.settlement` | settlements list, `…/:id/payout`, `verify-payout-destination` | GET, POST | super/FINANCE_AUDITOR | one driver; `driver_payouts` has **no writer** | `SETTLEMENT_EXECUTED`, `PAYOUT_DESTINATION_*` | no UI |
| PROMOTIONS | `/campaigns` (list side) | read, create, edit, redemptions | `promotion.view/create/edit` | `/api/admin/promotions`, `/:id`, `/:id/redemptions` | GET, POST, PUT | super only | collection / one row | `PROMOTION_CREATED/_UPDATED` | no |
| CAMPAIGNS | `/campaigns` | read, create, edit, publish/pause/archive, delete | `campaign.view/create/edit/publish/delete` | 7 routes under `/api/admin/campaigns` | GET, POST, PUT, DELETE | super only | one row + CAS revision | `CAMPAIGN_CREATED/_UPDATED/_${target}/_ARCHIVED` | yes for status + delete, no for a live edit |
| ADVERTISEMENT | none | create, edit, delete (+ ungated read, §5) | `advertisement.create/edit/delete` | `/api/admin/advertisements` ×4 | GET, POST, PUT, DELETE | super only (read: any admin) | one row | `ADVERTISEMENT_CAMPAIGN_*` | — |
| SETTINGS | none | read, write one allow-listed key | `requireSuperAdmin` (no name yet — §6.1) | `/api/admin/platform-settings`, `/:key` | GET, PUT | super only | one key, credential-blocked | `PLATFORM_SETTINGS_*` | — |
| GEO-FENCES | none | read, create, delete | `geofence.view/create/delete` (`edit` gates nothing) | `/api/admin/geofences`, `/:id` | GET, POST, DELETE | super/OPERATIONS (view) | one row | `GEOFENCE_CREATED/_DELETED` | — |
| SURGE | none | read, create | `surge.view/create` (`edit`/`activate` gate nothing) | `/api/admin/surgezones` | GET, POST | super/OPERATIONS (view) | one zone | `SURGE_CREATED` | — |
| PRICING | none | read, write | `pricing.edit` | `/api/admin/pricing` ×2 | GET, POST | super only | one service type, no effective dates | `PRICING_UPDATED` | — |
| NOTIFICATIONS | none | broadcast | `notification.broadcast` (`view` gates nothing) | `/api/admin/notifications/broadcast` | POST | super only | a target class of devices | `NOTIFICATION_BROADCAST` | — |
| SUPPORT | none | read queue, assign, resolve | `support.view/respond/resolve` | `/api/admin/support`, `/:id/assign`, `/:id/resolve` | GET, POST | super/OPERATIONS/SUPPORT_AGENT | one ticket | `TICKET_ASSIGNED/_RESOLVED` | — |
| AUDIT | none | read log | `audit.view` (`export` gates nothing) | `/api/admin/audit-logs` | GET | super + three roles | filterable read, immutable table | n/a | — |
| SECURITY | `/security` | session directory, lockouts, revoke, enable/disable account | `security.view`, `security.session.revoke`, `admin_accounts.manage` | 4 routes + `/api/admin/accounts/:id/status` | GET, POST | super only | one handle / one account / one admin | `ADMIN_SESSION_REVOKED(S)`, `ADMIN_ACCOUNT_*` | yes |
| ADMIN USERS | `/security` (directory side) | list, provision, enable/disable | `admin_accounts.manage/create` | `/api/admin/accounts` ×2, `/:id/status` | GET, POST | super only | one account, last-super guard | `CREATE_ADMIN_ACCOUNT`, `ADMIN_ACCOUNT_*` | yes for disable |
| ADMIN ROLES | none | none — no route reads or writes a role assignment | — | — | — | — | — | — | — |
| SYSTEM HEALTH | `/` (metrics side) | read health, readiness | none (`system.health` is §3 target only) | `/api/admin/supabase-status`, `/api/admin/metrics`, `/api/health`, `/api/ready` | GET | any admin token / anonymous | platform-wide, secrets redacted | n/a | — |
| KYC (people, area 6) | none | queue, decide, lock, unlock, documents | `identity_verification.*`, `identity_documents.view` | 5 routes + `/docs/:filename` | GET, POST | super/KYC_SPECIALIST (OPERATIONS may view) | one application | `LOCKED/_UNDER_REVIEW/_APPROVED/_REJECTED/_RESUBMISSION_REQUESTED` | — |
| CATALOG (grocery stocking) | none | CRUD master products, price review | `catalog.manage`, `grocery.review` | 4 routes, plus one admin photo upload with **no gate at all** (§6.5) | GET, POST, PUT, DELETE | super only | one product; memory-only | **none** for master-catalog, `ADMIN_PRICE_*` for review | — |
| FEATURE FLAGS | none | read, write one flag | `requireSuperAdmin` role equality on the write (no name) | `/api/admin/features` ×3 | GET, POST, PUT | super only by role compare | one key, namespace-checked | `FEATURE_FLAG_UPDATED` (SETTINGS) | — |

### 3.2 Domains in the work order with **no admin capability to catalogue**

Stated as absent, each with what was searched for, so the absence is a finding rather than an
omission:

| Domain | Measured state | Evidence |
|---|---|---|
| RIDES (admin management) | ABSENT | no admin route cancels or edits a ride; `POST /api/rides/:id/cancel` is customer-side, and §5 row 9 says the same |
| PARCELS (proof of delivery) | ABSENT | no admin route serves proof images; `parcel.proof.view` is a §3 target name, not a real one |
| PAYMENTS (list/detail) | ABSENT | §5 row 14: the tables exist, no admin read projects them |
| WALLETS (read) | ABSENT | no wallet route; `wallets.read` is §3 target only |
| DISPUTES | ABSENT entirely | no table, no route, no screen (§5 row 30); area 30's shape is §11 decision 6 |
| REPORTS | ABSENT | no route; `report.view`/`report.export` are §3 targets; CSV/XLSX/PDF is §11 decision 3 + §9 item 3 |
| DATA EXPORT | ABSENT | no route; `ledger.export`/`audit.export` gate nothing (§2.2) |
| DISPATCH board | ABSENT | `dispatch.view`/`dispatch.reassign` are §3 targets; reassignment must go through the same rule evaluation when built |
| BRANDING / THEME / BANNERS | ABSENT as admin routes | served on `/api/app/config`; `branding.edit`/`theme.edit`/`banner.manage` gate nothing |
| GLOBAL SEARCH | ABSENT | `search.global` is a §3 target; §1.2 measured zero search code in admin-web |
| MAP / LIVE OPS | ABSENT as a surface | `geofence`/`surge` reads exist (§3.1); `map.view`/`operations.live` gate nothing, and `fleetLocations` is memory-only |
| AI ASSISTANT | ABSENT | no LLM integration anywhere in the repo (§5 row 44); §11 decision 7 |
| BACKUP / RECOVERY visibility | ABSENT | no route; area 43 wants read-only visibility and forbids restore/delete |
| ADMIN ROLE EDITING | ABSENT | nothing assigns a role to an account after creation; a grant change is a code change plus restart (§2.2 of the spec) |

---

## 4. Role → permission matrix (the five roles the schema allows)

`admin_accounts.role` is closed by `001_central_schema.sql:178` to exactly these five values,
so this is the whole set: no `SUPER_ADMIN` is created by any code path, and no other name can be
granted without a migration this document does not authorise (§9 item 1 of the specification).
Counts are the length of each list in `adminPermissions.js:73-96`.

| Role | Grants | Count | What that role can actually do |
|---|---|---|---|
| `SUPER_ADMIN` | every name, plus the wildcard | 55 | everything in §2.1, both `requireSuperAdmin` routes, and the 11 ungated reads |
| `OPERATIONS` | `identity_verification.view`, `customers.read`, `fleet.manage`, `merchant.manage`, `support.view`, `support.respond`, `geofence.view`, `surge.view` | 8 | read customers, drivers, merchants, geofences, surge, the queue; suspend a driver or merchant; answer a ticket. **Cannot** suspend a customer, read the audit log, or write pricing/flags/settings |
| `FINANCE_AUDITOR` | `finance.view`, `finance.refund`, `finance.adjust`, `finance.settlement`, `audit.view` | 5 | the whole money surface: ledger reads, refunds, adjustments, settlements, payout destinations, and the audit trail to check them against |
| `KYC_SPECIALIST` | `identity_verification.view/review/approve/reject/request_resubmission`, `identity_documents.view`, `audit.view` | 7 | decide the queue and open the documents, and read the trail |
| `SUPPORT_AGENT` | `support.view`, `support.respond`, `support.resolve`, `audit.view`, `customers.read` | 5 | work tickets, resolve them, read customers, read the trail |

### 4.1 Privilege findings

- **Over-privileged: none measured.** Every grant above has a route behind it except
  `audit.view` for `KYC_SPECIALIST`/`SUPPORT_AGENT` (a read of a trail they may legitimately
  need, and the same grant `FINANCE_AUDITOR` holds) — recorded so it is not mistaken later for a
  mistake.
- **Under-privileged in one place that will surprise an operator:** `SUPPORT_AGENT` holds
  `support.resolve` but **not** `support.respond`... it does hold both. The real asymmetry is
  that `OPERATIONS` holds `support.respond` but not `support.resolve` — an operations agent can
  pick up a ticket and cannot close it. That is a coherent design (closing is support's call)
  and is stated here so nobody "fixes" it as a bug.
- **Names no non-super role can reach: 27** — the 26 §11 answer 10 settled plus
  `customers.suspend` added afterwards under the same rule. §2.1 marks each row "super only".
  Consequence for the UI, already decided: such a control is hidden or labelled, never offered
  as a button that answers 403. Today that holds on 2 of 6 action screens (§1 layer 1).
- **A read gated by a write name:** `GET /api/admin/pricing` requires `pricing.edit`, so a role
  that should only see the price list cannot. Nothing holds that today (the name is super-only),
  so it is a shape to fix when someone grants it, not a live defect.
- **A write name that also gates the directory read:** `admin_accounts.manage` covers
  `GET /api/admin/accounts`, so "list administrators" and "disable one" are one grant. Splitting
  them needs a name that does not exist yet.
- **Two gates that are not names at all** (`requireSuperAdmin`, the flag route's role compare)
  cannot be granted to a non-super role at all, and do not appear in `GET /api/admin/me`, so a
  screen cannot gate on them. That is why they are listed separately in §2.1.
- **Nothing is persisted.** A grant change is `adminPermissions.js` + a restart; there is no row
  saying what an account was allowed to do last Tuesday, which is why every audit record in
  §2.1 carries the role *and* the permission name rather than a derived list.

---

## 5. The 13 admin reads with no gate, and the 4 that decide in the handler

Any valid administrator token — including `SUPPORT_AGENT` — reaches these. §11 decision 11 is
open: bind each to an existing name, or declare "any signed-in administrator" as the decision.
This file does not pick. `admin_authorization_test.js` CAT-04 prints this list every run and
fails if it grows.

**CAT-04 cannot see the last two rows or the fleet row below.** It parses single-path
registrations (`app.get('/api/admin/…'`), and these are registered as arrays —
`app.get(['/api/admin/features', '/api/v1/admin/features'], …)`. That is why the harness reports
14 ungated admin paths where a re-parse counting arrays reports 82 admin paths, 79 behind
`authenticateAdmin`, and 3 in front of nothing (`GET /admin`, `POST /api/admin/login`, and
§6.5's photo route). The mechanism works — the routes really are admin-only in the sense of
needing a token — but the *check* that guards the list has a blind spot, so "CAT-04 is green"
proves less about coverage than its pass looks like it does.

| Route | Exposes | Name that would fit, if 11(a) is chosen |
|---|---|---|
| `GET /api/admin/services/status` `:1091` | every service's paused/live state | `services.view` (already in the catalogue, gates nothing) |
| `GET /api/admin/me` `:1513` | the caller's own role and grants | by design |
| `POST /api/admin/reset-password` `:1470` | self-service; `adminHoldsPermission(req.admin,'admin_accounts.manage')` for someone else | already decides in-handler, same predicate as the gate |
| `PUT /api/admin/features/:key` `:6088` | one flag | compares `req.admin?.role` to `SUPER_ADMIN` by hand; §3 names `feature.edit`, which does not exist yet |
| `POST /api/admin/features` + `POST /api/v1/admin/features` `:6003` (array) | the same legacy flag write as the PUT above | same in-handler role compare, same missing name |
| `GET /api/admin/features` + `/api/v1/admin/features` `:5990` (array) | the whole flag cache, including keys no other admin read exposes | `feature.view`, or the flag rows' own namespace |
| `GET /api/fleet/locations` + `/api/v1/fleet/locations` `:6389` (array) | every driver's last reported position | `operations.live` (§3 target); `map.view` in the same list gates nothing |
| `GET /api/admin/advertisements` `:2466` | the ads list its writes gate on `advertisement.*` | `promotion.view`-shaped gap: §3 has no `advertisement.view` |
| `GET /api/admin/drivers` `:1563` / `GET /api/admin/drivers/:id` `:1572` | the whole driver directory, PII included | `fleet.read` (§3 target, not real) |
| `GET /api/admin/jobs` `:5082` | every order/ride/parcel row | `orders.manage` today covers the write; a read name does not exist |
| `GET /api/admin/restaurants` `:5083` | merchant directory | `merchants.read` (§3 target) |
| `GET /api/admin/metrics` `:5057` | platform KPI aggregate | `dashboard.view` (§3 target) |
| `GET /api/admin/master-catalog` `:5417` / `/:id/stores` `:5452` | the master catalogue and its stocking | `catalog.manage` already gates its writes |
| `GET /api/admin/grocery/price-alerts` `:5920` | unusual-price alerts | `grocery.review` |
| `GET /api/admin/supabase-status` `:5952` | engine status with `connection.error` stripped | `system.health` (§3 target) |

One more anonymous surface belongs here for completeness rather than as a gap: `GET /admin`
`:270` answers to no token at all and returns a discovery document (service name, the login
endpoint, the dashboard URL). It leaks no data and names no record, but it does tell an
unauthenticated caller where to aim, which is the sort of thing a hardening pass is expected to
notice and either justify or close.

Two facts keep this section from being the whole security story: the reads above are
*administrative* reads over data some administrator can already see, and the one genuinely
sensitive list among them (`/api/admin/drivers`) is the one whose write gate (`fleet.manage`) is
held by `OPERATIONS` anyway. The gap is least privilege, not exposure to a stranger.

---

## 6. What this pass found

### 6.1 Two gates that no permission name reaches

`requireSuperAdmin` on the `platform-settings` pair and the hand-written role compare on
`PUT /api/admin/features/:key` both work — they refuse everyone but `SUPER_ADMIN` — but they are
invisible to `GET /api/admin/me`, so no screen can gate honestly on them and no auditor can
search the trail for the name. §11 answer 10 keeps the *privilege* where it is; converting the
*spelling* to `settings.edit` / `feature.edit` is task #61's remaining work and needs two names
added to the catalogue, which is why it is listed rather than done here.

### 6.2 Writes that leave no trail, or a trail that may never arrive

| Gate | Route | What it changes | What the trail says |
|---|---|---|---|
| `catalog.manage` | `POST`/`PUT`/`DELETE /api/admin/master-catalog` `:5422/:5432/:5442` | master product rows (memory-only, §2.5 of the spec) | **nothing** — no `auditAppliedChange`/`createAuditLog` call exists on any of the three paths, verified by reading the handlers and the three `database.js` methods they call (`:4113`, `:4132`, `:4151`) |
| `orders.manage` | `POST /api/admin/orders/expire-stale` `:5910` | **every** stale order, in one call, through the `expire_stale_orders` RPC | **nothing** at the application layer — the route records no audit row, so a bulk state change is invisible to the trail that area 31 exists to protect |
| `identity_verification.review` | `POST /api/admin/identity-verifications/:id/unlock` `:3260` | clears `lockedByAdminId`/`lockedByAdminName`/`lockedAt` on one application | **nothing** — `unlockIdentityApplication` (`database.js:3333-3347`) returns after the mutation with no audit call, while its sibling `/lock` (`:3288`) writes `LOCKED` (IDENTITY_VERIFICATION). So "who released this KYC record, and was the lock held by someone else" is unrecoverable, which is exactly the question a review-queue audit answers |
| `support.respond`, `support.resolve` | `POST /api/admin/support/:id/assign` `:1744`, `/resolve` `:1759` | one ticket's assignee and state | `TICKET_ASSIGNED`/`TICKET_RESOLVED` are written with `this.createAuditLog({...})` **without `await`** (`database.js:2618`, `:2764`). The write is attempted and a failure is logged as `[audit] DROPPED TRAIL`, but the request answers 200 either way — the two routes are the last admin mutations outside the "await the record of an applied change" rule that task #63 established (`auditAppliedChange`) |

The first three are gated, all three are reachable only by a role that already holds the name,
and none is a live exposure. They are the answer to the question "which permissions have no
audit", and area 31's promise — that a privileged change can be reconstructed from `audit_logs`
— does not currently hold for them.

### 6.3 Layer 1 was missing on four screens — now closed, with three corrections found on the way

`/`, `/drivers`, `/merchants` and `/campaigns` used to render every control to every role, so
the least-privilege administrator saw a button whose only answer was 403 — the shape §11 answer
10 rules out. They now gate on the caller's own `GET /api/admin/me` grants through
`lib/access.ts`, and each removed control leaves the `missingGrantNote()` sentence in its place
so the column reads as a decision rather than a rendering bug. `/campaigns` additionally stops
issuing the three reads it knows will be refused (`campaign.view` for the list and the live
preview, `promotion.view` for the coupon picker) instead of painting a 403 as "could not load".

Three things measured while doing it, all in `/security`:

- It read `user.permissions` directly instead of through `holdsPermission()`, so it was the one
  screen that could have hidden a control from `SUPER_ADMIN` — the wildcard is applied *before*
  the list, and only `lib/access.ts` knew that.
- Its two `security.view` reads were fired unconditionally, so a `security.session.revoke`-only
  caller (a shape no role holds today, which is why this is not a live defect) would have seen
  two red banners where the screen intends to say "not listed for this role".
- The per-account **Revoke sessions** button sat under `canManageAccounts`
  (`admin_accounts.manage`) while the route it calls is
  `POST /api/admin/security/sessions/revoke` (`security.session.revoke`). Two names, one row: a
  future role holding only one of them would have been shown a button it cannot press, or denied
  one it can. The row now checks each name against its own action.

`campaign.delete` is the one campaign name with no control anywhere — `admin-web` issues no
`DELETE` call at all (`lib/api.ts` has none), so retiring a campaign from the screen is
`campaign.publish` to `ARCHIVED`. Recorded in §2.1 rather than counted as a missing button.

### 6.4 An audit row that records the wrong role

15 of the audit writes in `database.js` pass a literal `role: 'ADMIN'` instead of the caller's
role (`:2621`, `:2767`, `:2897`, `:2957`, `:2998`, `:3039`, `:3067`, `:3107`, `:3320`, `:3380`,
`:3408`, `:3436`, `:3458`, `:3515`, `:3544`). `ADMIN` is not one of the five roles the schema
allows (`001_central_schema.sql:178`), so the trail's role column cannot be filtered by
`OPERATIONS` or `SUPPORT_AGENT` for any of those actions — including the ticket assign/resolve
and KYC lock/approve rows above. Attribution itself survives, because `adminId` and `adminName`
are written, and the other admin paths do pass the real role. Recorded as a fidelity gap in the
trail, not a hole in authorisation, and deliberately not "fixed" here: changing what a row says
is a decision about existing records, and an operator who has already searched the log by role
would find the answer moves underneath them.

### 6.5 One admin write that reaches no gate at all

`server.js:7250` registers
`app.post(['/api/grocery/products/:id/photo', '/api/admin/grocery/products/:id/photo'], …)` with
**no authentication middleware** and no token check in the body. Its sibling photo routes
(`:7070`, `:7194`) resolve a bearer by hand; this one does not. An unauthenticated caller can:

- push `fileData` to Cloudinary under `nabin/grocery/products/<any id>` with a fixed
  `publicId`, overwriting an existing product's image for any `id` it guesses, and
- append or mutate `db.groceryCatalog` and call `db.save()`.

This is the only `/api/admin/…` path in the file that answers with no `authenticateAdmin`, no
`requirePermission` and no in-handler check, so it is the one place where "hiding the button" and
"the server refusing" are both absent — the finding that makes the work order's own warning
(`Do not assume that hiding a button is authorization`) worth keeping. It is also a
*content* route wearing an admin URL: the merchant-facing twin at `:7194` proves the same
handler was meant to sit behind a bearer. Two facts bound what can be said about it from here:
the catalogue rows it touches are the memory-only ones §2.5 of the specification describes, and
Cloudinary credentials come from the environment, so the write burns the platform's own quota and
public URL namespace rather than a customer's money.

What this file does **not** claim: that the route is reachable in a deployed environment. Nothing
here was run against a hosted instance (§9 item 4), and the fix — one `authenticateAdmin` plus a
permission name, or dropping the `/api/admin/…` alias — is a behaviour change to a route the
Phase 4 test suite may already call, so it is listed for the owner with the rest of §6 rather
than applied inside a documentation pass. `admin_authorization_test.js` cannot see it either:
CAT-04's parser reads single-path registrations (§5).

### 6.6 What is *not* a gap, checked so the next reader does not re-open it

- No admin route performs a hard delete of a customer, driver, merchant, order, payment, ledger
  or audit row (`POST`-shaped deletes exist only for advertisements, campaigns and master
  catalogue rows, and those tables have their own guards).
- No 403 in this surface leaks another account's data: the refusal is
  `Access Denied: Missing required permission [name]. Current role: <caller's own role>`
  (`adminPermissions.js:135-143`), plus the request id. Nothing else about the caller's
  position, nobody else's identifier, and no internal message.
- `GET /docs/:filename` gating a mock is a hole closed ahead of the first real upload, not a
  patch to a live leak — §5 row 6 of the specification records that distinction, and it is worth
  keeping because "it gates a fake file" is otherwise a reasonable-sounding reason to delete the
  gate.
- The offline fallback has no administrator at all (`this.adminUsers = []`, no superadmin seed in
  `src/`), so every one of these routes fails closed there. Nothing in this matrix is
  reachable without a real account.

### 6.7 A suspension closes the instance that made it, and not the others

This is the one finding in this file that is about a *customer* bearer rather than an admin
permission, and it belongs here because it is the answer to "does the layer-2 decision survive
the next request" — the question the whole matrix rests on.

`POST /api/admin/customers/:id/status` does three things: it writes `users.account_status`
durably, it mirrors that status into the process's own directory copy, and it deletes every
session of the account (`revokeCustomerSessions`, store row first, memory second). On the
instance that served the call, all three hold. Measured here, across a live second process:

- **A bearer is checked against the account at request time on all seven customer routes that
  resolve one by hand**, not only on the middleware path. `refusedClosedCustomerAccount`
  (`server.js:733`) is awaited by `GET /api/auth/me`, `POST /api/auth/refresh-token`,
  `POST /api/rides/:id/cancel` + `POST /api/jobs/:id/cancel`, `GET /api/payments/session/:orderId`,
  `DELETE /api/media/*` and `POST /api/customer/profile/photo`. Each call sits before that
  handler's own 404 or ownership check. INP-10 fails the run if any is deleted; INP-19…INP-22
  prove both halves over HTTP — an open account is served normally, a closed one answers
  `403 ACCOUNT_SUSPENDED`.
- **A session another instance wrote is adopted here inside the reconcile tick** (INP-21) — *observed
  to work, not known to*. Three of four Phase 18 passes saw it green and one saw it red, on the same
  committed code and the same verified-fresh-process script, so the property is intermittent rather
  than guaranteed; `GEOFENCING_SECURITY_AUDIT.md` R8 item 4 and R9 carry the evidence, including the
  measurement that was the leading candidate — `reconcileSessions` issued an unbounded select, this
  store caps an unbounded read at 1000 rows, and `backend_sessions` held ~1459 unexpired rows, so both
  this bullet's adoption and the prune below it worked from a page that could not contain the table.
  **That read is now a complete keyset walk past the cap**, so neither half is built from a truncated
  page any more; the intermittency is left open, because the cap was never shown to cause it.
- **A revocation performed here does not reach another instance at all** (INP-24, INP-25).
  `reconcileSessions` prunes only entries whose key it can identify as locally minted, and its
  loop reads `if (isDevFixture || /^[0-9a-f]{64}$/.test(key)) continue;` — while
  `registerSession` stores every real login under `hashSessionToken(token)`, 64 hex characters.
  The `continue` therefore skips precisely the rows a remote revocation needs dropped.
- **And the bearer-time guard is no backstop for that case** (INP-26): an instance that hydrated
  the account while it was open answers from its own copy, because the store is consulted only
  when the account cannot be resolved locally.

So the durable store is authoritative for *signing in* and for *this process*, and the door a
suspension shuts is one process wide until that process restarts or the session expires. The
correction is a two-line predicate change, and it is deliberately not made here: it changes the
authorisation path of every process sharing the store, and its failure mode is customers signed
out of a working app. It is spec §11 decision 16 with §9 item 6 attached, and INP-25/INP-26 hold
the present behaviour in place so that a future change has to be a decision rather than a
side-effect of a prune refactor.

---

## 7. Verification — where each claim above is proven

| Claim | Proven by |
|---|---|
| Every gated route refuses a role that lacks its name, with a 403 that names the permission | `backend/admin_authorization_test.js` — 208 (route × non-super role) probes, generated from the same registration lines this file lists |
| The route table is what this file says it is | CAT-01 (counts), CAT-02 (no dead gate), CAT-03 (no stale bookkeeping), CAT-06 (no double registration) re-parse `src/server.js` from disk on every run |
| The 9 unenforced names and the 27 unreachable ones | CAT-03/CAT-05, and §2.2/§4.1 here |
| `customers.read`/`customers.suspend` behave end to end, including the half-failed write | `backend/admin_customers_test.js`, 83 assertions (CU-*/INP-*) |
| All seven hand-resolved customer routes refuse a closed account, and serve an open one normally | same file: INP-10 (source), INP-19…INP-22 (HTTP, both directions) |
| Cross-instance: adoption converges, revocation does not | same file: INP-23…INP-26, run against a live second process and a directly-invoked reconcile tick |
| The audit trail is written before a refusal, and a dropped write is visible | `backend/admin_audit_fail_closed_test.js`, `backend/audit_drop_visibility_test.js` |
| Session revocation cuts both stores, and a foreign instance's session is honoured | `admin_authorization_test.js` REV-01…REV-09, DIS-01…DIS-07 |
| Settings writes cannot name or carry a credential | `backend/admin_settings_surface_test.js` |
| Every screen is usable at 320/375/390/430 and 768px, and hides what its caller cannot do | measured in a browser on all eight routes; the layer-1 gates are the code in the files §6.3 names |

Not claimed by this file, because not run: §2.1's "Confirm" column describes the code path a
screen takes, and only the `/customers` and `/security` confirmations have been walked in a
browser — the other four gated controls are read, not driven; §6.2's two unaudited writes are
proven by reading, not by a new test; and §6.7's multi-instance result was measured with the
harness process standing in for the second instance, not with two servers deployed side by side.

---

## 8. Dependencies on open decisions

Nothing in §5 or §6.1 may be "fixed" by choosing a gate on the owner's behalf, and §2.2's nine
names cannot be made real without the routes they describe. See §9 (approval stops, now six with
the session-convergence one §6.7 adds) and §11 (decisions 11, 13, 14, 15 and 16 for this
surface; 3, 6 for the export and dispute domains) of `ADMIN_FEATURE_SPECIFICATION.md`.
