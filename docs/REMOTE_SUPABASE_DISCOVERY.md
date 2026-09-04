# NABIN REMOTE SUPABASE DISCOVERY & COMPARISON REPORT

**Audit Date:** 2026-09-04  
**Audit Scope:** Read-Only Discovery & Side-by-Side Comparison  
**Active Development Environment:** Local Docker Supabase (`http://127.0.0.1:54321`, Postgres `127.0.0.1:54322`)  
**Git Baseline Commit:** `a42cb67e86a4d95e76863bc65c97c289d47de50e`  
**Operational Policy:** Strictly READ-ONLY. Zero remote modifications, migrations, resets, or secret exposures performed.

---

## 1. Executive Summary

A comprehensive repository, configuration, and network discovery was conducted across the local development environment and two target remote Supabase instances:
1. **`nabin-test`**: `https://ywhxkzmbwppkdemvzlhv.supabase.co` (Project Ref: `ywhxkzmbwppkdemvzlhv`)
2. **`NABIN`**: `https://ouxvqmhuyueklnegvmxe.supabase.co` (Project Ref: `ouxvqmhuyueklnegvmxe`)

### Access Discovery Findings
- **Repository Metadata:** No remote project references or credentials exist within repository source files, `.env` files, or Git history.
- **Supabase CLI Configuration:** The local Supabase CLI (`npx supabase`) has no authenticated session or personal access token configured (`~/.supabase/access-token` does not exist).
- **Environment Variables:** No system or shell environment variables (`SUPABASE_ACCESS_TOKEN`, `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are present on the host system.
- **Remote Gateway Status:** Both remote Supabase endpoints are live, healthy, and actively protected behind Cloudflare edge gateways with Supabase API Gateway enforcement. Both correctly reject unauthenticated REST and Auth requests with `401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`).

---

## 2. Remote Project Probing & Verification (Read-Only)

Safe, non-destructive HTTPS queries were executed to inspect edge headers, routing, and project reference bindings without attempting state-altering operations:

### 2.1 Project 1: `nabin-test`
- **Provided URL:** `https://ywhxkzmbwppkdemvzlhv.supabase.co`
- **Observed Project Ref:** `ywhxkzmbwppkdemvzlhv` (confirmed via `sb-project-ref` header)
- **Gateway Server:** Cloudflare (HTTP/1.1, HTTP/2, HTTP/3 supported)
- **Edge Gateway Version:** PostgREST Gateway v1 / Auth Gateway v2
- **Probe Results:**
  - `GET /rest/v1/` → `HTTP 401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`)
  - `GET /auth/v1/health` → `HTTP 401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`)
- **Accessibility:** Edge routing is active and healthy. Service catalog inspection requires authenticated credentials.

### 2.2 Project 2: `NABIN`
- **Provided URL:** `https://ouxvqmhuyueklnegvmxe.supabase.co`
- **Observed Project Ref:** `ouxvqmhuyueklnegvmxe` (confirmed via `sb-project-ref` header)
- **Gateway Server:** Cloudflare (HTTP/1.1, HTTP/2, HTTP/3 supported)
- **Edge Gateway Version:** PostgREST Gateway v1 / Auth Gateway v2
- **Probe Results:**
  - `GET /rest/v1/` → `HTTP 401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`)
  - `GET /auth/v1/health` → `HTTP 401 Unauthorized` (`sb-error-code: UNAUTHORIZED_MISSING_API_KEY`)
- **Accessibility:** Edge routing is active and healthy. Service catalog inspection requires authenticated credentials.

---

## 3. Side-by-Side Comparison Matrix

The table below contrasts the authoritative local development environment with both remote projects based on all discoverable parameters:

| Inspection Dimension | LOCAL Development | `nabin-test` | `NABIN` |
|---|---|---|---|
| **Project Reference** | `nabin` (local Docker container) | `ywhxkzmbwppkdemvzlhv` | `ouxvqmhuyueklnegvmxe` |
| **Project URL / Host** | `http://127.0.0.1:54321` | `https://ywhxkzmbwppkdemvzlhv.supabase.co` | `https://ouxvqmhuyueklnegvmxe.supabase.co` |
| **Database Host & Port** | `127.0.0.1:54322` (PostgreSQL) | Direct / Supavisor pooler (Port 5432 / 6543) | Direct / Supavisor pooler (Port 5432 / 6543) |
| **PostgreSQL Version** | `15.8 (Debian/GCC 13.2.0)` | Cloud default (PostgreSQL 15+) | Cloud default (PostgreSQL 15+) |
| **CLI Linking Status** | Active local project (`supabase/config.toml`) | Not linked | Not linked |
| **Applied Migrations** | **001–014** (Fully verified in sequence) | Unauthenticated (No CLI link or DB access) | Unauthenticated (No CLI link or DB access) |
| **Public Tables** | **38 tables** (100% verified) | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Table Columns** | **516 columns** (100% verified) | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Primary Keys** | **38 PKs** (100% table coverage) | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Foreign Keys** | **34 foreign key constraints** | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Database Indexes** | **140 indexes** | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Row-Level Security (RLS)** | **Enabled on 38/38 tables (100%)** | Cloud default (Enforced if schema pushed) | Cloud default (Enforced if schema pushed) |
| **RLS Policies** | **52 active security policies** | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Stored Procedures / RPCs** | **5 custom functions** (`adjust_wallet_balance`, etc.) | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Database Triggers** | **15 triggers** (`updated_at` timestamps) | Introspection blocked (401 Missing API Key) | Introspection blocked (401 Missing API Key) |
| **Active Extensions** | **7 extensions** (`pgcrypto`, `uuid-ossp`, `postgis`, etc.) | Cloud standard catalog | Cloud standard catalog |
| **Storage Buckets** | Configured local Docker storage | Introspection blocked | Introspection blocked |
| **Edge Functions** | Local edge runtime (`supabase_edge_runtime_nabin`) | Introspection blocked | Introspection blocked |
| **Auth Configuration** | Local Inbucket SMTP (`54324`), JWT expiry 3600s | Cloud Supabase Auth service | Cloud Supabase Auth service |
| **Credentials on Host** | Present in `backend/.env` (Demo keys only) | **MISSING** (No anon key, service key, or token) | **MISSING** (No anon key, service key, or token) |

---

## 4. Analysis & Required Determinations

### A. Which Project Appears Intended for Testing?
**`nabin-test` (`https://ywhxkzmbwppkdemvzlhv.supabase.co`)**
- **Rationale:** The naming convention (`nabin-test`) explicitly designates this project as the non-production staging / test environment. It is intended for running automated end-to-end integration tests, validating migrations before production rollout, and testing staging mobile builds.

### B. Which Project Appears Intended as the Main NABIN Project?
**`NABIN` (`https://ouxvqmhuyueklnegvmxe.supabase.co`)**
- **Rationale:** The canonical naming (`NABIN`) identifies this as the authoritative cloud / production Supabase instance. It is intended to host live platform data, real driver/merchant transactions, and active client sessions.

### C. Schema Differences
- **Local:** The local database possesses the full 38-table multi-application schema defined by migrations 001–014 (covering users, drivers, merchants, jobs, payments, wallets, support, promotions, admin audit, geofences, notifications, checkout, and dispatch).
- **Remote Projects:** Because remote credentials are not stored locally, remote database catalogs could not be queried over SQL/PostgREST. Default unmigrated Supabase projects initialize with standard system schemas (`auth`, `storage`, `graphql_public`, `vault`) and an empty `public` schema. If either remote project has not had migrations 001–014 applied, it will lack the entire 38-table NABIN data model.

### D. Migration Differences
- **Local:** Migrations `001` through `014` are fully applied in sequence and verified byte-for-byte. Local tracking in `supabase_migrations.schema_migrations` records all 14 files.
- **Remote Projects:** The local Supabase CLI tracks zero migrations for either remote project because no remote project link (`supabase link`) is active. Migration history on the remote instances is unlinked.

### E. Security Differences
- **Local:** RLS is enabled on 100% of public tables (38/38) with 52 explicit policies. However, the local environment uses standard, well-known local development demo JWT secrets, suitable solely for isolated offline development.
- **Remote Projects:** Both remote projects enforce edge gateway security rejecting unauthenticated traffic. When accessed, they will require separate, cryptographically secure project `anon` keys and `service_role` keys generated by Supabase Cloud.

### F. Any Existing Data Differences That Can Be Safely Identified
- **Local:** Contains a clean, validated schema baseline following `npx supabase db reset` with zero orphaned records.
- **Remote Projects:** No data reads could be executed due to missing API keys. Consequently, no remote data corruption, existing user records, or transactional history could be read or modified.

### G. Which Project Should Eventually Be Connected to the Backend?
- **Staging / CI Pipelines:** The backend should connect to **`nabin-test`** (`ywhxkzmbwppkdemvzlhv`) when testing cloud-hosted APIs, webhooks, or multi-client integrations prior to production releases.
- **Production Deployment:** The backend should connect to **`NABIN`** (`ouxvqmhuyueklnegvmxe`) when deployed to its production cloud runtime.
- **Current Local Development:** The backend must **remain connected to local Docker Supabase** (`http://127.0.0.1:54321`) as established in the current recovery baseline.

### H. Risks Before Remote Deployment
1. **Extension Prerequisites:** Migration `011_geofences_surge_domain.sql` requires PostgreSQL spatial indexing (`postgis`). If `postgis` is not enabled in the Supabase Cloud dashboard for the target project prior to migration, `CREATE EXTENSION IF NOT EXISTS postgis` must have proper database superuser privileges.
2. **Migration Drift:** If either remote project was partially migrated in past sessions, running `supabase db push` blindly could trigger conflict errors or migration version mismatches. A dry-run migration plan (`supabase db push --dry-run`) must be performed once credentials are provided.
3. **Configuration Overwrite Risk:** Running `supabase link` without care can overwrite `supabase/config.toml`. The repository configuration must be preserved or linked using non-destructive parameters.
4. **Destructive Reset Hazard:** Running `supabase db reset` against any remote linked project drops all cloud data. Any remote migration workflow must strictly prohibit `db reset` and only use additive, idempotent schema migration scripts.
5. **Secret Hygiene:** Remote `service_role` keys must never be committed to Git, stored in `.env.example`, or logged during CI/CD workflows.

---

## 5. Authentication Deficiencies (What Is Missing)

To perform authenticated read-only inspections or future migrations without exposing secrets:

1. **Supabase Personal Access Token (`SUPABASE_ACCESS_TOKEN`):**
   - Required by Supabase CLI to list remote projects, inspect remote migration status via `supabase migration list`, or link projects non-destructively.
   - *Can be set via environment variable `SUPABASE_ACCESS_TOKEN` in the user's private shell or via `npx supabase login`.*
2. **Project API Keys (`anon` and `service_role`):**
   - Required to perform authenticated REST queries (`/rest/v1/`) against each project's PostgREST gateway.
3. **Database Direct / Pooled Connection Strings (`DATABASE_URL`):**
   - Required to execute direct read-only SQL catalog queries (`information_schema`, `pg_tables`, `pg_stat`) against PostgreSQL port `5432` or Supavisor pooler port `6543`.

*Note: In accordance with security protocol, no credentials should be pasted into chat or committed to the repository.*

---

## 6. Verification & Adherence Check

- [x] Read-only inspection performed — zero modifications, migrations, or writes executed.
- [x] Probed both remote projects (`nabin-test` and `NABIN`) via HTTPS.
- [x] Evaluated repository, local Supabase CLI, and environment variables for existing credentials.
- [x] Provided side-by-side comparison matrix covering all requested database attributes.
- [x] Explicitly answered items A through H.
- [x] Documented missing authentication components without requesting secret disclosure.
- [x] Local Docker Supabase remains active development database.
