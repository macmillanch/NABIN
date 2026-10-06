# Supabase environments: development/test and production

NABIN runs against two separate hosted Supabase projects, plus the local Docker
instance used for day-to-day work. This document is the authority on which name
maps to which project, what each environment is allowed to touch, how the
environment is selected, and what refuses to start when the selection is wrong.

Nothing in this file is aspirational: every control named here exists in code,
and everything that does *not* exist is listed under "Not enforced".

## The matrix

| `NABIN_ENV` | Supabase project | Ref | Host | Purpose |
|---|---|---|---|---|
| `development` | local Docker Supabase | none (loopback) | `http://127.0.0.1:54321` | Daily coding, bugfixing, running the suites |
| `testing` | `nabin-test` | `ywhxkzmbwppkdemvzlhv` | `https://ywhxkzmbwppkdemvzlhv.supabase.co` | UI/UX integration, schema/auth/OTP/realtime/storage testing, automated tests against a hosted store |
| `production` | production project | `ouxvqmhuyueklnegvmxe` | `https://ouxvqmhuyueklnegvmxe.supabase.co` | Real users, real orders, real money, real OTP delivery |

One deployment serves exactly one row. A process never holds two refs, and a ref
never appears in two environments.

The rule the guards enforce: **the environment name, the database URL, the REST
URL, and every Supabase key must all name the same project.** If any one of them
disagrees, the process stops before it can read or write.

## What each environment may touch

| Concern | development | testing | production |
|---|---|---|---|
| Rows | throwaway local data | test customers, drivers, merchants, orders, rides, wallets, transactions | real user data only |
| Auth / OTP | fixed test OTPs allowed | fixed test OTPs allowed | real Supabase Auth, real SMS |
| Payments | `PAYMENT_MODE=sandbox` | `PAYMENT_MODE=sandbox` | `PAYMENT_MODE=sandbox` today — live payment capture is **not** enabled and needs an explicit owner decision |
| Media | shared Cloudinary account, `nabin/public` folder | same | same (see "Not enforced") |
| Realtime | backend's own `ws` server on :4000 | same | same |
| Push | `MockSandboxPushProvider` | `MockSandboxPushProvider` | `FcmV1PushProvider` only when `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` are set |
| Migrations | yes, against the local DB | yes, via the CLI link (verify it first) | **never run from a workstation** |

Production data is never copied into development. Test data is never copied into
production. The seed fixtures in `backend/` are development/test artifacts and
are not evidence that anything exists in the production project.

## Resetting data

Only the **development** database is ever reset, and only by the local script:

```
node backend/scripts/reset_local_test_data.js                # dry run — prints the counts
node backend/scripts/reset_local_test_data.js --apply        # truncate the transactional tier
```

The suites write straight into `public` by design (F-3(b) in
`docs/AUTONOMOUS_BUILD_PROGRESS.md` classifies the Phase 6/9 reads as public-attaching),
so a few months of runs leave millions of rows behind — the 2026-10-05 baseline was
2,051,865 rows, 1.9M of them in `dispatch_offers`. That residue makes a fresh run's reads
ambiguous: `SELECT id FROM users LIMIT 1` answers with somebody else's old row, so a green
suite may be passing off stale data.

What it clears is an allowlist of 37 transactional tables, never a pattern. `users`,
`drivers` and `admin_accounts` are a separate opt-in tier (`--include-identity`) because some
probes read an existing row instead of creating one. Config and fixture tables
(`merchants`, `products`, `master_grocery_catalog`, `dark_stores`, `geo_fences`,
`surge_zones`, `pricing_configurations`, `ledger_accounts`, `permission_keys`,
`operator_roles`, `role_grants`, `notification_templates`, `platform_settings`) are absent
from the list — the dark-store, merchant-tenant-isolation and grocery-price-history suites
resolve against specific rows in them, and a wholesale `supabase db reset` FATALs those links.
`audit_logs` is never truncated. The wipe is one multi-table `TRUNCATE`, and it first proves
no table outside the set holds a foreign key into it; `CASCADE` is therefore never needed, and
using it would reach data the script never declared.

The script refuses a non-loopback `DATABASE_URL` **with no override flag**, and refuses
`NODE_ENV=production`. Take a `pg_dump` first: the 2026-10-05 wipe was preceded by
`nabin-db-backups/nabin-local-20261005.dump` (147 MB, verified restorable).

## Migrations against a database that is already migrated

`supabase_migrations.schema_migrations` records versions; it is not a proof of schema state,
and it can fall behind. On 2026-10-05 the local ledger stopped at `030` while 031/032 were
already applied to it — an earlier hand-run of `backend/scripts/apply_local_migration.js`
applied the file without recording the version. Re-running `scripts/migrate.js` against such a
database applies 031 as a no-op (both files are written with `IF NOT EXISTS`, drop-then-add and
`on conflict do nothing`) and then fails 032 on:

```
cannot drop constraint operator_roles_role_key_key on table operator_roles
because other objects depend on it
```

That is a replay artifact, not damage: the whole file runs in one transaction, so a failed
migration leaves no partial schema. Verify the effects before touching the ledger — for 032 the
project's own gate is `node backend/operator_permissions_migration_test.js` (65 checks, and it
is link 40 of the regression chain). Recording a version the runner would have written is
correct once that gate is green; editing or re-sequencing a committed migration to make a
already-migrated database accept a replay is not.

## How the environment is selected

### Backend (Node)

Two variables declare it, and both are read by `src/services/nabinEnv.js`:

```
NABIN_ENV=production
NABIN_SUPABASE_REF=ouxvqmhuyueklnegvmxe
SUPABASE_URL=https://ouxvqmhuyueklnegvmxe.supabase.co
SUPABASE_ANON_KEY=<publishable key for that project only>
SUPABASE_SERVICE_ROLE_KEY=<service key for that project only>
DATABASE_URL=<direct/pooler URL for that project only>
NODE_ENV=production
```

Templates, with every value blank:

- `backend/.env.example` — local Docker development
- `backend/.env.testing.example` — pinned to `ywhxkzmbwppkdemvzlhv`
- `backend/.env.production.example` — pinned to `ouxvqmhuyueklnegvmxe`

Only variables that `src/` actually reads appear in them. `render.yaml` carries
`NABIN_ENV` and `NABIN_SUPABASE_REF` for `nabin-beta-api` (testing) and
`nabin-backend-prod` (production); the secrets themselves stay in the Render
dashboard.

### Flutter (`mobile/`)

The app talks to the Node backend, never to Supabase directly, so it carries no
Supabase credential. It declares its target with two `--dart-define` values that
`lib/core/config/nabin_build_env.dart` validates:

```
flutter build apk --release \
  --dart-define=NABIN_ENV=production \
  --dart-define=NABIN_API_URL=https://api.nabin.in/api \
  --dart-define=NABIN_WS_URL=wss://api.nabin.in
```

A release build that omits `NABIN_ENV` throws. A release build that names
`production` and points at anything other than the production API hosts throws,
and must use TLS. `development` must point at loopback.

There are no build *flavors* configured in `pubspec.yaml` — selection is by
`--dart-define` only. That is a real gap in convenience, not in safety: the
validation runs whatever the define says, so a mislabelled build fails loudly.

### Next.js (four web apps)

Same shape: they call the backend over HTTP and hold no Supabase key. Per
deployment env vars are `.env.beta.example` (testing, `api-beta.nabin.in`) and
`.env.production.example` (production, `api.nabin.in`), set in the Vercel
project's environment tab, never committed.

## The guards

Four independent gates. A mismatch has to get past all four to cause damage.

1. **Server boot** — `backend/src/supabase.js` calls
   `nabinEnv.assertConfigured()` at module scope, before any Supabase client is
   constructed. Failure throws `NABIN_ENV_MISMATCH`.
2. **Migrations** — `backend/scripts/migrate.js` runs the same audit after
   reading `DATABASE_URL` and **before** opening a socket, prints every problem,
   and exits 1. It also prints the target it is about to write to.
3. **Test suite** — `backend/scripts/test_chain.js` refuses `NODE_ENV=production`
   and refuses a non-loopback `DATABASE_URL`/`SUPABASE_URL` unless
   `NABIN_ALLOW_REMOTE_TESTS=1`.
4. **Flutter release build** — `NabinBuildEnv.validate()` in the API and WS URL
   getters.

### What a refusal says, and how to read it

```
NABIN_ENV_MISMATCH: this process refused to start.
  - SUPABASE_URL points at project abcdef12345678901234 but NABIN_SUPABASE_REF declares ouxvqmhuyueklnegvmxe.
  - SUPABASE_SERVICE_ROLE_KEY is a key for project ywhxkzmbwppkdemvzlhv but this environment uses ouxvqmhuyueklnegvmxe. Cross-environment credential — refusing to start.
```

The last line is the important one: the key's own `iss: "supabase:<ref>"` claim
is decoded and compared. A production service key pasted into a testing config —
or the reverse — is caught from the credential side, not just the URL side.

The message names variables and refs. **It never prints a key value, and it
never prints the `DATABASE_URL` string**, because the password lives inside it.

Local development needs no declaration: a loopback `SUPABASE_URL` with no
`NABIN_ENV` passes, which is why the daily workflow is unchanged.

Verify the guard yourself:

```
cd backend && node nabin_env_guard_test.js    # 29 checks, covers all four gates' logic
```

## Explicit non-actions

This change touched configuration and guards only.

- No migration was run, written, or applied. `supabase/migrations/*` are unmodified.
- Neither database was reset, seeded, or written to.
- No table, user, bucket, function, or policy was deleted or altered in either project.
- No production configuration was overwritten. `PAYMENT_MODE` stayed `sandbox` on
  both Render services after an accidental edit was reverted.
- No credential was committed, pasted into a file, or printed in this document.
  The templates ship blank values.
- No Supabase project was created, and no client code gained a service-role key —
  verified by inspection: Flutter and all four Next.js apps hold no Supabase
  credential at all.

## Deployer checklist (before the next deploy)

These are dashboard actions; they cannot be done from this repository.

1. `nabin-beta-api`: set `NABIN_ENV=testing` and
   `NABIN_SUPABASE_REF=ywhxkzmbwppkdemvzlhv`, plus that project's anon/service keys
   and `DATABASE_URL`.
2. `nabin-backend-prod`: set `NABIN_ENV=production` and
   `NABIN_SUPABASE_REF=ouxvqmhuyueklnegvmxe`, plus that project's own keys and
   `DATABASE_URL`.
3. Confirm the deployment boots and the log line reads
   `✅ Supabase client initialized — environment: production (project ouxvqmhuyueklnegvmxe), target: …`.
   If it does not boot, read the `NABIN_ENV_MISMATCH` list — that is the guard
   working, not a regression to route around.

Until step 1 and 2 are done, the hosted services will refuse to boot on the next
deploy of this branch. The failure is safe and the health check surfaces it.

## Not enforced (known gaps, stated plainly)

- **Supabase CLI link.** `supabase/.temp/linked-project.json` currently points at
  `ywhxkzmbwppkdemvzlhv` (`nabin-test`). CLI writes follow that link, and the
  boot guard cannot see it. Read that file (or the ref in the
  Supabase dashboard) before
  any `db push`, and never link the production project from a workstation that
  also runs tests.
- **Media storage.** Images go to Cloudinary, not Supabase Storage; no code in
  `backend/src` uses `supabase.storage`. The folder is caller-supplied with a
  default of `nabin/public`, so development and production uploads land in the
  same account and folder unless the two deployments are given different
  `CLOUDINARY_*` credentials. There is no `CLOUDINARY_FOLDER` variable to set —
  separating them is either a credentials change or a code change, not config.
- **Realtime.** Supabase Realtime is not subscribed to by any client; the app's
  live updates come from the backend's own WebSocket server. The dev/prod realtime
  split therefore has nothing to enforce yet.
- **Edge Functions.** `supabase/` contains `config.toml` and `migrations/` only —
  there are no Edge Functions to deploy per environment.
- **Push.** The provider is chosen by the *presence* of Firebase credentials, not
  by `NABIN_ENV`. A development server that is given production Firebase
  credentials will send real notifications to whoever is registered there. Keep
  Firebase credentials out of development and testing deployments.
- **Feature flags and test OTPs** come from `RuntimeMode.allowsTestConvenience()`
  and the `settings` table, not from `NABIN_ENV`. The fixed OTPs (7729 / 4892 /
  3184) and the `testOtp` echo are gated by runtime mode; a production process
  that sets `NODE_ENV=production` cannot serve them.
