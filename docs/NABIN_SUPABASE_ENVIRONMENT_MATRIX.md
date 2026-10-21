# NABIN — SUPABASE THREE-TIER ENVIRONMENT MATRIX

**Document Reference**: `docs/NABIN_SUPABASE_ENVIRONMENT_MATRIX.md`  
**Current Date**: 11 October 2026  
**Target Release**: 1 January 2027 (NABIN Ride & NABIN Food)  
**Governance Authority**: System Architect & Security Lead  

---

## 1. THREE-TIER ENVIRONMENT TOPOLOGY

To ensure strict operational safety and prevent accidental test data pollution or production outages, NABIN enforces a rigid three-tier environment architecture:

| Environment Tier | Project Name | Masked Project Ref | Full Project Ref | Authoritative Host / URL | Data Scope & Purpose |
|---|---|---|---|---|---|
| **Tier 1: Local Development** | `nabin` | `local-docker` | `(empty ref)` | `http://127.0.0.1:54321` (REST)<br>`127.0.0.1:54322` (PostgreSQL) | Isolated offline development, rapid test iterations, 36 applied migrations. |
| **Tier 2: Hosted Staging / Test** | `nabin-test` | `ywh***zlhv` | `ywhxkzmbwppkdemvzlhv` | `https://ywhxkzmbwppkdemvzlhv.supabase.co`<br>Session Pooler: `aws-0-ap-northeast-1.pooler.supabase.com:5432`<br>Direct Host: `db.ywhxkzmbwppkdemvzlhv.supabase.co:5432` (IPv6) | Dedicated cloud staging, synthetic test fixtures, automated regression verification. |
| **Tier 3: Live Production** | `NABIN` | `oux***vmxe` | `ouxvqmhuyueklnegvmxe` | `https://ouxvqmhuyueklnegvmxe.supabase.co`<br>`db.ouxvqmhuyueklnegvmxe.supabase.co:5432` | Real customer accounts, driver KYC, live ledger balances, real merchant menus. **STRICTLY UNMODIFIED.** |

---

## 2. VERIFIED CONNECTIVITY & STATUS AUDIT (12 OCTOBER 2026)

### 2.1 Tier 1: Local Development (`supabase_db_nabin`)
- **Gateway Status**: Online (`http://127.0.0.1:54321`)
- **Direct Database**: Online (`postgresql://127.0.0.1:54322/postgres`)
- **Schema Migration State**: 36 migrations applied (`001–016`, `018–027`, `029–038`).
- **Data Catalog**: 279 users, 1363 drivers, 201 jobs, 500 ledger entries, 2330 admin accounts, 385 promotions, 447 geofences, 445 surge zones.
- **Verification Result**: **100% OPERATIONAL**. All 1,056 backend tests across 26 suites pass. Flutter mobile tests pass with 0 analyze errors. All 4 web apps typecheck cleanly.

### 2.2 Tier 2: Hosted Staging (`ywhxkzmbwppkdemvzlhv`)
- **Gateway Status**: **LIVE & RESPONDING** (`https://ywhxkzmbwppkdemvzlhv.supabase.co`)
- **PostgREST Gateway**: HTTP 200 OK verified using `service_role` key. Title: `"NABIN public schema. Phase 10 (migration 024)"`.
- **Public Tables Active**:
  - `platform_settings`: Verified responding (17 rows on record).
  - `geo_fences`: Verified responding (3 rows on record).
  - `pricing_configurations`: Verified responding (6 rows on record).
- **Hosting Region Verified**: AWS **`ap-northeast-1`** (Tokyo), verified via multi-region pooler probe.
- **Database Connection Endpoints**:
  - **Session Pooler (IPv4/IPv6)**: `aws-0-ap-northeast-1.pooler.supabase.com:5432` (user `postgres.ywhxkzmbwppkdemvzlhv`). Recommended for DDL migrations.
  - **Transaction Pooler (IPv4/IPv6)**: `aws-0-ap-northeast-1.pooler.supabase.com:6543`. Unusable for migrations: `migrate.js` takes `pg_try_advisory_lock(hashtext('nabin_migrations'))`, which is session state, and a transaction pooler hands each statement a different backend session.
  - **Direct PostgreSQL Host (IPv6)**: `db.ywhxkzmbwppkdemvzlhv.supabase.co:5432` (AAAA `2406:da14:1772:ea00:fc47:493c:5f11:b93d`).
- **SSL Configuration**: `DATABASE_SSL=require` — full verification against the pinned root `backend/certs/supabase-root-2021-ca.pem` (`backend/src/services/dbTls.js`). `no-verify`, `insecure`, `allow`, `disable` and `false` are refused outright for a hosted host with `DATABASE_TLS_BYPASS_REFUSED`; an unrecognised value is refused with `DATABASE_TLS_MODE_UNKNOWN`; unset defaults to `require`. History: earlier probes recorded `SELF_SIGNED_CERT_IN_CHAIN`, because Node's bundled trust store does not contain Supabase's private "Supabase Root 2021 CA" — pinning that CA is the fix that replaced the bypass, so the bypass is no longer needed and is now blocked. `db_tls_policy_test.js` exercises this policy: 50/50.
- **Authentication Check**: Responds with `password authentication failed for user "postgres"`. The database password was rotated in the Supabase Dashboard and requires owner update in `backend/.env.staging`.
- **Configuration File**: `backend/.env.staging` (gitignored, never committed) holds the non-secret staging endpoints plus the real keys; the database password slot is still the template placeholder. Its template `backend/.env.staging.example` is measured to produce **0 problems / 0 notes** under `nabinEnv.audit()`.
- **Harness Security**: `with_staging_target.js` is fail-closed on production ref `ouxvqmhuyueklnegvmxe`, local loopback, an unfilled template password, and missing credentials — it exits 2 with the exact owner action instead of attempting the connection. Guarded by `staging_target_guard_test.js`: 40/40 (chain link 63).
- **Verification Result**: **REACHABLE — the placeholder password is the only gap blocking the DDL step**. "Ready" is bounded to that step and nothing beyond it: applying `025–038` makes the *schema* current, it does not make the relations readable by the backend. Action 19 of [`NABIN_AUTONOMOUS_SPRINT_LOG.md`](NABIN_AUTONOMOUS_SPRINT_LOG.md) measured on hosted staging that relations with no explicit `service_role` grant answer `42501 permission denied for table …` with the hint `GRANT SELECT … TO service_role`, and only migrations 027, 029 and 031 restate such grants. Whether the remaining relations should be granted to `service_role` is an open owner decision, not a migration the harness can apply.

### 2.3 Tier 3: Live Production (`ouxvqmhuyueklnegvmxe`)
- **Gateway Status**: **LIVE & HEALTHY BEHIND CLOUDFLARE** (`https://ouxvqmhuyueklnegvmxe.supabase.co`)
- **Gateway Verification**: Responds with `HTTP 401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`, `sb-project-ref: ouxvqmhuyueklnegvmxe`).
- **Local Credentials**: **NONE STORED ON LOCAL HOST**. Neither production keys nor database passwords exist in local configuration files or Git history.
- **Production Data Protection**: Zero mutations or writes executed. Completely untouched and preserved.

---

## 3. STRICT ENVIRONMENT SEPARATION GUARDS

The repository enforces multiple structural safeguards to prevent cross-environment contamination:

### 3.1 Structural Environment Binding (`backend/src/services/nabinEnv.js`)
- Requires exact pairing of `NABIN_ENV` and `NABIN_SUPABASE_REF`:
  - `NABIN_ENV=testing` MUST match `NABIN_SUPABASE_REF=ywhxkzmbwppkdemvzlhv`.
  - `NABIN_ENV=production` MUST match `NABIN_SUPABASE_REF=ouxvqmhuyueklnegvmxe`.
- Decodes JWT claims in `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`:
  - Rejects cross-environment keys (e.g. testing key used against production, or production key against testing).
  - Fails closed on any mismatch before opening network sockets.

### 3.2 Production Rejection in Test Harnesses
- [`with_local_target.js`](file:///C:/Users/macmi/Documents/nabin/backend/scripts/with_local_target.js): Explicitly defines `FORBIDDEN_PROD_REF = 'ouxvqmhuyueklnegvmxe'` and aborts with code 2 if detected.
- [`with_staging_target.js`](file:///C:/Users/macmi/Documents/nabin/backend/scripts/with_staging_target.js): Rejects `ouxvqmhuyueklnegvmxe` and refuses local loopback fallback.
- [`verify_hosted_test_env.js`](file:///C:/Users/macmi/Documents/nabin/backend/scripts/verify_hosted_test_env.js): Halts test execution on **any** `nabinEnv.audit()` problem, not only a production reference — a mismatched ref, a key whose `ref` claim names another project, or a hosted URL carrying no ref all exit 1 with `❌ FAIL: N environment configuration problem(s). Nothing was verified.` before any test runs. Since 2026-10-12 it also refuses to call an incomplete configuration verified: PASS requires all three of `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and a `DATABASE_URL` that names `ywhxkzmbwppkdemvzlhv`, and a gap exits 2 as `⚠️ PENDING CREDENTIALS … Nothing was verified.` naming the key. It previously printed `✅ PASS: Environment is safely and correctly configured for Hosted TEST` against `backend/.env`, which has the two REST keys and no `DATABASE_URL` — the DSN check was computed, shown with a ⚠️, and used in no condition. Under the staging harness it loads no env file, because `backend/.env.test.local` was read with `override: true` and could replace the target the harness had just audited. Guarded by `verify_hosted_test_env_guard_test.js`: 27/27 (chain link 64).

### 3.3 Zero Credential Leakage
- Privileged `SUPABASE_SERVICE_ROLE_KEY` is restricted strictly to backend server runtimes.
- Never exposed in HTML bundles, Next.js client props, Flutter assets, or public API responses.
- Startup logs output protocol and hostname only, masking all sensitive tokens.

---

## 4. APPLICATION RUNTIME TARGET MAPPING

All client applications interface with the shared backend engine, which acts as the single source of truth:

```text
┌─────────────────────────────┐
│ Customer Web / Mobile       │
│ Driver Mobile               │
│ Merchant Web / Mobile       │
│ Admin Web                   │
└──────────────┬──────────────┘
               │ HTTPS (Bearer Auth)
               ▼
┌─────────────────────────────┐
│ NABIN Shared Backend        │ ──► Determined by NABIN_ENV / NABIN_SUPABASE_REF
└──────────────┬──────────────┘
               │
      ┌────────┼────────┐
      ▼        ▼        ▼
    LOCAL   STAGING   PROD
   Docker  nabin-test NABIN
```

### 4.1 Client Connection Targets

| Application | Development Run | Staging Run | Production Target |
|---|---|---|---|
| **Backend API** | `npm run dev` (`:4000`) | Target: `ywhxkzmbwppkdemvzlhv` | Target: `ouxvqmhuyueklnegvmxe` |
| **Customer Web** | `http://localhost:3000` | Points to Staging Backend | `https://nabin.in` / `https://nabin.com` |
| **Admin Web** | `http://localhost:3001` | Points to Staging Backend | `https://admin.nabin.in` |
| **Restaurant Web** | `http://localhost:3002` | Points to Staging Backend | `https://kitchen.nabin.in` |
| **Grocery Web** | `http://localhost:3003` | Points to Staging Backend | `https://merchant.nabin.in` |
| **Flutter Apps** | Configured via `nabin_api_service.dart` | Staging API Host URL | Production API Host URL |

---

## 5. REQUIRED OWNER ACTIONS FOR STAGING DDL SYNCHRONIZATION

To execute direct database migrations against Staging (`nabin-test`):
1. **Provide Staging Database Password**: The owner must provide the active PostgreSQL password for `postgres` on project `ywhxkzmbwppkdemvzlhv` (set in Supabase Dashboard ➔ Project Settings ➔ Database ➔ Database Password).
2. **Configure Dedicated `.env.staging`**:
   ```env
   NABIN_ENV=testing
   NABIN_SUPABASE_REF=ywhxkzmbwppkdemvzlhv
   SUPABASE_URL=https://ywhxkzmbwppkdemvzlhv.supabase.co
   SUPABASE_ANON_KEY=<staging_anon_key>
   SUPABASE_SERVICE_ROLE_KEY=<staging_service_role_key>
   DATABASE_URL=postgresql://postgres:<password>@db.ywhxkzmbwppkdemvzlhv.supabase.co:5432/postgres
   DATABASE_SSL=require
   SUPABASE_POSTGRES_LIVE=true
   ```
3. **Authorise the hosted DDL run**: once the password lands, `node backend/scripts/with_staging_target.js node backend/scripts/migrate.js` is still a write to a shared hosted project and is not run without that instruction. The harness verifies credentials, TLS mode and target ref first and exits 2 with the owner action if any of them fails.
4. **Decide the read-grant question separately** (§2.2): migrating `025–038` makes the schema current but does not grant `service_role` SELECT on the relations that lack it. That is an owner decision about the hosted TEST project's privilege model, and until it is made the backend will keep answering `42501 permission denied` on those reads.
