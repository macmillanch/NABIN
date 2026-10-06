# Operator Permissions Program — decisions and execution plan

Status: **approved direction, not yet implemented.** Recorded here because it changes the
security architecture and must not survive only in a chat transcript.

Context: NABIN must support one SUPER_ADMIN plus many operators with custom roles,
granular permissions, data scopes, audit, and session control. Backend is the final
authority; UI hiding is for usability only.

## What already exists (verified, not assumed)

- `backend/src/adminPermissions.js` (186 lines) is the single source of truth:
  5 roles (`SUPER_ADMIN`, `KYC_SPECIALIST`, `OPERATIONS`, `FINANCE_AUDITOR`,
  `SUPPORT_AGENT`), ~60 `resource.action` grant keys, `grantsForRole` (returns `null`
  for an unknown role, deliberately not `[]`), `adminHoldsPermission`,
  `requirePermission` (401 unauthenticated vs 403 unauthorised, carries `requestId`),
  `requireIdentityDecision`.
- **68** `requirePermission(...)` server-side guards in `backend/src/server.js` — action-level
  API enforcement already exists; this program does not need to build it, only to keep it.
- Operator lifecycle: `GET/POST /api/admin/accounts`, `POST /api/admin/accounts/:id/status`
  gated by `admin_accounts.create` / `admin_accounts.manage`.
- Sessions: `listAdminSessions`, `revokeAdminSession`, `revokeAdminSessionsForAccount`
  (routes ~2276 / 2329 / 2336), gated by `security.session.revoke`.
- Last-super-admin lockout guard `database.js:7649`; oversized-directory exact lookup `database.js:7557` (PHASE 41).
- Tests that must stay green: `admin_authorization_test.js` (114), `admin_settings_surface_test.js` (64),
  `admin_identity_gates_test.js`, `owner_minimization_test.js`.

## Corrections — claims that are NOT true of this repo

Searched and rejected; do not carry these forward:

- `ADMIN_AUTHORIZATION_SURFACE_FROZEN` and `ADMIN_SELF_AUTHORIZATION_FORBIDDEN`: **0 occurrences repo-wide** (`git grep`).
  There is no "frozen authorization surface". Per-operator grants are simply **unimplemented**.
- `admin_rbac_roles`, `admin_role_grants`, `admin_operator_roles`: **do not exist** in the local schema.
- `security_policy` table and `zone_operator_scope` / `city_scope` columns: **do not exist locally**
  (`relation "public.security_policy" does not exist`). Memory entries describing them are stale.

## Constraints that shape every step

- `admin_accounts` has **15 columns and no `permissions` column** — grants are derived from role in code only.
- `admin_accounts.role` is closed by a database **CHECK** (per `adminPermissions.js` header, from
  `backend/migrations/001_central_schema.sql`).
- Local data: **1,709 accounts** — SUPER_ADMIN 1, OPERATIONS 549, KYC_SPECIALIST 419,
  FINANCE_AUDITOR 370, SUPPORT_AGENT 370. A migration that silently re-grants anything to those
  549 OPERATIONS rows is a mass privilege escalation.
- Local Docker Supabase only. No production. `max_rows = 1000`, so any enumeration of this
  directory must page (`readAllRows`) or use a count.
- No migration-history table exists, so numbering follows the numbered-sql convention; next free is `032`.
  (Pre-existing conflict: `supabase/migrations/030_merchant_inventory_integrity.sql` is untracked and
  duplicates applied content in `backend/migrations/030_harden_merchant_service_type.sql` — deliberately left alone.)

## Approved decisions

1. **Grants model** — dynamic tables: `operator_roles`, permission-key catalogue, `role_grants`,
   plus per-operator `operator_grants` overrides (additive). Enforcement stays in the single
   `adminPermissions` predicate so all 68 guards inherit the change without edit.
2. **Roles** — data-driven. Seed the 5 existing roles with **byte-identical** grants, add the 13
   requested operator roles as rows. Replace the CHECK-bound name list with an FK to the table so
   a new role is a row, not a migration (the spec requires the architecture not depend on exact role names).
3. **Data scope** — in this program, after grants land (OP-3). Scope must be enforced on read
   paths, not stored as decoration.
4. **Finance request→review→approve→execute** — deferred to its own gated phase. The existing
   refund/adjust paths are already atomic, idempotent, durably audited and surrounded by ~1,599
   checks; they are not destabilised to build the auth model.

## Phases

- **OP-1** — migration `032` authorization store + RED proving current grants are role-derived only.
  Gate: a test asserting **no existing account's effective grant set changes**, across all 1,709 rows.
- **OP-2** — role catalogue as data; 5 migrated + 13 predefined roles; `grantsForRole` reads the store,
  keeping `null` (not `[]`) for an unresolvable role.
- **OP-3** — scope model (`GLOBAL`, `REGION`, `CITY`, `ZONE`, `SERVICE`, `MERCHANT`, `ASSIGNED_CASES`,
  `OWN_TEAM`, `OWN_OPERATIONS`) + scope filtering on list endpoints, proven with an allow/deny matrix
  in the shape of `merchant_tenant_isolation_test.js` (real requests, not skipped).
- **OP-4** — assign/revoke endpoints under `admin_accounts.manage`, append-only `grant_changes`
  audit (actor, operator affected, before, after, timestamp, reason), and revocation effective
  immediately (no stale client-side permissions).
- **OP-5** — sensitive-data inventory + masking decisions per field (phone, address, GPS, documents,
  KYC, payment, wallet, financial reports, security logs). Masking support was **not found** and is
  still unverified — inventory first.
- **OP-6** — deferred: high-risk finance approval workflow.

## Rules for execution

- Never weaken/skip/delete an existing authorization test to make a phase pass.
- No passwords, hashes, salts, OTPs or tokens in any response or audit record.
- No hidden backdoor, no master password, no permanent emergency account. Emergency elevation,
  if built, must be explicit, strongly authenticated, reasoned, time-limited, audited, self-expiring.
- SUPER_ADMIN actions stay authenticated, authorized, audited, and confirmation-protected.
- Do not build on a remembered schema — read `information_schema` first (this program has already
  had to retract four such memories).

---

# OP-1 — executed 2026-09-28 (local only, not committed)

Starting HEAD `9924138b1d19a3e9e176e1e7883b3c44b23762e6` (unchanged; no commit, no push, no staging).
Working tree before and after: `backend/src/database.js` (Task 3 fix, +13/−4, preserved), plus OP-1 files.

## Delivered

- **Migration `supabase/migrations/032_operator_permissions_store.sql`** — additive; generated from
  `src/adminPermissions.js` by `backend/scratch/op1_gen.js` (never hand-typed).
  Tables: `permission_keys` (55 rows), `operator_roles` (5), `role_grants` (80),
  `operator_grants` (0 — deliberately empty).
- `admin_accounts_role_check` (the fixed 5-name CHECK) **replaced** by
  `admin_accounts_role_fkey` → `operator_roles(role_key)`. A role can now only be a value that
  exists as a row, a role in use cannot be deleted, and an unknown role is refused by the database.
  Replaced, not removed (§11).
- RLS on all four tables, the 029/031 convention: enabled, zero policies, revoked from
  `public/anon/authenticated`, granted to `service_role`. Proven with `SET LOCAL ROLE` observing
  error `42501`, including that anon cannot **read** the privilege boundary.
- `backend/src/database.js`: `loadAuthorizationStore`, `effectivePermissionsFor`,
  `operatorGrantsFor`, `refreshAuthorizationFor`, `resolveOperatorAccount`,
  `applyOperatorGrant` / `revokeOperatorGrant` (`mutateOperatorGrant`). Union semantics:
  `effective = role grants ∪ operator grants`. Store unreadable-incomplete ⇒ index dropped, so an
  account falls back to exactly its role grants — additive grants fail **closed**.
- Compatibility preserved (§13/§14): `adminPermissions.js` untouched as the source of the code
  grants, `adminHoldsPermission` remains the single predicate, and **none of the 68
  `requirePermission` guards were rewritten**.
- Sign-in refresh wired at `POST /api/admin/login` and the admin OTP resolution path.
- **No HTTP mutation endpoint exists** — §20 was honoured; `applyOperatorGrant` is server-side only,
  unreachable from the API (asserted by RLS-05). OP-4 owns the endpoint, its authorization and its
  audit row.
- New gate: `backend/operator_permissions_migration_test.js`, chain link **40**.

## The gate

RED before the migration: **14 passed / 6 failed / 0 skipped**, baseline digest
`050f0a94bd10d18e`. GREEN after: **65 passed / 0 failed / 0 skipped, ×5, exit 0.**

**Primary security gate (§16): 1,709 / 1,709 exact matches, 0 mismatches**, digest derived two
different ways (code-mapping vs store-mapping) and identical. The directory is read through direct
`pg`, not PostgREST, because `max_rows = 1000` would have silently truncated the gate itself.
Census: SUPER_ADMIN 1 (active), OPERATIONS 175 active / 374 inactive, KYC_SPECIALIST 175/244,
FINANCE_AUDITOR 0/370, SUPPORT_AGENT 0/370 — 1,358 inactive accounts gained nothing (EQ-03).
SUPER_ADMIN before == after (55 = 55), wildcard preserved, no wildcard row invented.

Privilege-escalation (§17/§18): a provisioned `SUPPORT_AGENT` gets **403 with
`Missing required permission [finance.refund]`** over real HTTP; granting A a durable `finance.refund`
row and re-authenticating yields 6 permissions and the gate passes (domain answer 400), while B —
same role, no row — stays 403; deleting the row returns A to 403. A cannot mint itself a
SUPER_ADMIN (403). Unknown permission key → `PERMISSION_KEY_UNKNOWN`; unknown operator →
`OPERATOR_IDENTITY_AMBIGUOUS`/`OPERATOR_NOT_FOUND` with **no fallback row**; a non-uuid actor →
`AUTHORIZATION_ACTOR_UNRESOLVED`, because an unattributable grant must not exist.

## Defects found while building OP-1

1. **Revocation could not take effect** (found by HT-10, mine): `refreshAuthorizationFor` used the
   mirror's current `permissions` as the base, so a previously-applied additive grant was re-unioned
   forever. Fixed: the base is always the role's grants, recomputed from current rows.
2. **`granted_by` was forwarded unchecked** — a non-uuid actor reached Postgres as a driver error.
   Fixed by validating the actor uuid (HT-11b).
3. **`role_grants`/`operator_grants` initially had no `id`**, which made them unreadable by the
   repository's `readAllRows` keyset pager — the same truncation class as F3/F5. Fixed with surrogate
   ids plus the natural uniqueness constraint. Local-only teardown and re-apply; no data table touched.
4. **Reported, not fixed:** `createAdminAccount` gives the in-memory copy `id: adm_<digits>` while the
   table generates a uuid. It did not bite (grants resolve against the durable row), but two
   identities for one operator is a latent defect worth its own task.
5. **Test-design flaw caught in review:** asserting `status !== 403` conflates an authorization
   refusal with a domain refusal. Assertions now match the refusal's own text.

## Regression

Adjacent: `admin_settings_surface_test` 31/0, `admin_identity_gates_test` 64/64,
`auth_failclosed_test` 15/0, `merchant_auth_failclosed_test` 19/19 (Task 3 still green),
`admin_authorization_test` 114/0, `test_suite` 446/0.

Chain (40 links): **36 clean, 1,617 checks, 0 skipped.** `admin_accounts` 1,709 and
journal 7,497/14,961, payouts 948, ledger 2,138, merchants 39, dark_stores 2 — all unchanged by
the migration.

Problems, classified honestly:

| link | state | classification |
|---|---|---|
| `[24] financial_authority_test` | FIN15B-20 wallet/payout spread | **pre-existing baseline** — probe residue, human authority; untouched |
| `[25] driver_earnings_identity_audit_test` | IDENT-09/IDENT-10 | **pre-existing baseline** — human authority; untouched |
| `[?] restart_test.js` | chain log: `ECONNREFUSED 127.0.0.1:4100` | **load-dependent, not root-caused.** Passes standalone 40/0. Boot now performs 4 extra durable reads, which *may* contribute to a tight readiness window — unproven, recorded as a question for OP-2 |
| `[?] geo_adversarial_test.js` | chain: **55 passed, 7 FAILED**; standalone immediately after: exit 3, no output | **OPEN — unresolved, not dismissed.** Not attributable to OP-1 by inspection, and not proven unrelated either. Must be root-caused before OP-2 |

## Corrections to the analysis above

- **`owner_minimization_test.js` does not exist** — it was listed in "tests that must stay green" and
  is not a file in this repository. Retracted.
- The "13 roles = OP-2" sequencing stands: OP-1 added **no** new roles (ST-06 asserts exactly 5).
- Scope, finance approval, masking, deny-semantics: **not started**, as instructed. Additive-only
  grant semantics are documented in the migration; explicit deny/revoke semantics remain deferred.

## Deferred

OP-2 (13 roles as data), OP-3 (scopes + read-path filtering), OP-4 (grant mutation endpoint +
`grant_changes` audit + cross-process immediacy), OP-5 (sensitive-data inventory/masking),
OP-6 (finance request→review→approve→execute). Root-causing the two unresolved chain links above
comes before OP-2.
