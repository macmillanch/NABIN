# NABIN — PRODUCTION MIGRATION & SCHEMA ROLLOUT PLAN

**Document Reference**: `docs/NABIN_PRODUCTION_MIGRATION_PLAN.md`  
**Current Date**: 11 October 2026  
**Target Release**: 1 January 2027  
**Governance Authority**: Database Engineer & System Architect  

---

## 1. AUTHORITATIVE 36-MIGRATION MANIFEST

All schema evolution in NABIN is governed by strictly ordered, additive migrations located in `supabase/migrations/`. No manual schema alterations or wildcard scripts (`*.sql`) are permitted.

| Sequence | Migration File Name | Target Domain | Risk Level | Description & Schema Impact |
|---|---|---|---|---|
| **001** | `001_central_schema.sql` | Core Platform | Low | Baseline schema: `users`, `drivers`, `merchants`, `vehicles`. |
| **002** | `002_finance_ledger_schema.sql` | Accounting | Low | Double-entry ledger: `wallets`, `ledger_entries`, transactions. |
| **003** | `003_extended_schema.sql` | Core Extensions | Low | Session storage, rating reviews, device tokens. |
| **004** | `004_missing_entities_schema.sql` | Domain Entities | Low | Supporting platform entities, document attachments. |
| **005** | `005_jobs_domain.sql` | Mobility / Dispatch | Low | `jobs`, `rides`, ride requests, trip milestones. |
| **006** | `006_payments_domain.sql` | Financial Rails | Low | Payment sessions, payment orders, refund records. |
| **007** | `007_wallets_domain.sql` | Wallet Engine | Low | Wallet balance functions, atomic credit/debit RPCs. |
| **008** | `008_support_domain.sql` | Customer Care | Low | `support_tickets`, ticket messages, agent assignments. |
| **009** | `009_promotions_domain.sql` | Marketing | Low | `promotions`, discount vouchers, coupon redemption tracking. |
| **010** | `010_admin_audit_domain.sql` | Compliance / Audit | Low | Immutable `audit_logs` tracking admin and system mutations. |
| **011** | `011_geofences_surge_domain.sql` | Geospatial Pricing | Medium | PostGIS extension, `geo_fences`, `surge_zones`, spatial indexes. |
| **012** | `012_notifications_domain.sql` | Push / Event Bus | Low | `notifications`, notification templates, delivery channels. |
| **013** | `013_checkout_domain.sql` | Commerce Checkout | Low | `checkouts`, checkout sessions, line item reservations. |
| **014** | `014_dispatch_domain.sql` | Realtime Dispatch | Low | Dispatch radar, driver location pings, assignment queues. |
| **015** | `015_school_child_domain.sql` | School Mobility | Low | Child passenger records, school route linking. |
| **016** | `016_driver_kyc_payout_and_partial_refund.sql` | Driver Compliance | Medium | Driver KYC state machine, bank account verification, partial refund RPC. |
| *017* | *(SKIPPED / UNAPPROVED)* | N/A | N/A | **Omitted intentionally per DEC-009**. (Unauthorized attempt, permanently reverted). |
| **018** | `018_order_state_lines_and_checkout_linkage.sql` | Commerce Orders | Low | `order_lines`, checkout-to-order linkage, merchant status. |
| **019** | `019_order_creation_atomic.sql` | Atomic Transactions | Medium | Stored procedure `create_order_with_lines_atomic`. |
| **020** | `020_dispatch_security_atomic.sql` | Dispatch Security | Medium | Atomic job claiming, race condition prevention in driver matching. |
| **021** | `021_cross_domain_security_hardening.sql` | Platform Security | High | RLS security policies, cross-tenant isolation enforcement. |
| **022** | `022_notifications_support_dispute_security.sql` | Dispute Security | Low | Access control on support and dispute records. |
| **023** | `023_financial_ledger_security_hardening.sql` | Financial Security | High | Immutable ledger write restrictions; enforces RPC-only ledger mutations. |
| **024** | `024_application_surface_security_hardening.sql` | Surface Security | High | Revokes anon/authenticated permissions on sensitive tables; service_role only. |
| **025** | `025_feature_control_system.sql` | Governance Flags | Low | `platform_settings` feature flag keys and location overrides. |
| **026** | `026_backend_session_persistence.sql` | Auth Sessions | Low | Persistent `backend_sessions` table with auto-pruning. |
| **027** | `027_dynamic_campaigns_and_themes.sql` | UI Customization | Low | Dynamic brand campaign and marketing asset persistence. |
| *028* | *(MISSING GAP)* | N/A | N/A | Numbering sequence gap; no migration 028 exists in repository. |
| **029** | `029_geo_and_commerce_reads_service_role_only.sql` | Data Privacy | High | Drops public anon read policies on geofences, surge, and settings. |
| **030** | `030_merchant_inventory_integrity.sql` | Quick Commerce | Low | Master grocery catalog foreign key constraints and inventory bounds. |
| **031** | `031_dark_store_foundation.sql` | Catalog Structure | Low | Deprecated nomenclature retained for backward schema compatibility. |
| **032** | `032_operator_permissions_store.sql` | Admin RBAC | Low | Fine-grained admin permission storage and role matrices. |
| **033** | `033_privileged_delete_returns_old.sql` | Admin Integrity | Low | Stored procedure returning deleted row state for audit trails. |
| **034** | `034_restaurant_discovery_metadata.sql` | Food Delivery | Low | Restaurant opening hours, preparation times, cuisine tags. |
| **035** | `035_customer_profile_email_uniqueness.sql` | Customer Identity | Medium | Unique constraint on active customer profile emails. |
| **036** | `036_restaurant_catalog_persistence_and_variants.sql` | Food Catalog | Low | Menu items, dish variant options, and add-on price modifiers. |
| **037** | `037_order_creation_customization_snapshot_atomic.sql`| Atomic Orders | Medium | Snapshots variant prices atomically during checkout. |
| **038** | `038_order_creation_checkout_status_fix.sql` | Checkout Bugfix | Medium | Corrects SQLSTATE `42703` (`checkout_status` column reference). |

---

## 2. HIGH-RISK MIGRATION AUDIT & PRECAUTIONS

### Migrations 021, 023, 024, 029 (Privilege & RLS Hardening)
- **Nature of Change**: Revokes direct `INSERT`, `UPDATE`, `DELETE`, and `SELECT` permissions from `anon` and `authenticated` roles, granting access exclusively to `service_role`.
- **Precaution**: Backend services must run with valid `SUPABASE_SERVICE_ROLE_KEY`. If an application relies on client-side direct PostgREST mutations without backend proxying, requests will receive HTTP 401/403.
- **Verification**: Verified green locally across all 394 backend tests.

### Migration 035 (`customer_profile_email_uniqueness.sql`)
- **Nature of Change**: Creates unique constraint on `users(email)`.
- **Precaution**: Before applying to production, inspect production database for existing duplicate or null emails to prevent index creation failure.

### Migration 038 (`order_creation_checkout_status_fix.sql`)
- **Nature of Change**: Replaces function `create_order_with_lines_atomic` with corrected `checkouts.checkout_status` column mapping.
- **Precaution**: Idempotent replacement (`CREATE OR REPLACE FUNCTION`); safe to apply without table locking.

---

## 3. ROLLBACK & RECOVERY STRATEGY

In accordance with NABIN Architecture Decision **DEC-014**:
- **Forward-Only Recovery**: In production PostgreSQL databases, destructive rollbacks (`DOWN` migrations or table drops) risk catastrophic data loss and foreign key corruption.
- **Corrective Patches**: Any unexpected schema incompatibility must be resolved via a forward-only additive patch migration (e.g. migration `039`).
- **Backup Snapshot Requirement**: Before executing any migration on production:
  1. Trigger full database backup in Supabase Dashboard (or via `pg_dump`).
  2. Verify backup snapshot completion and record timestamp.
  3. Establish recovery objective: RTO < 15 minutes, RPO < 5 minutes.

---

## 4. STAGING APPLICATION PROCEDURE

To apply this 36-migration manifest to Staging (`nabin-test`):
1. Confirm Staging environment file (`backend/.env.staging`). It must hold a real database password; the shipped placeholder makes the harness refuse (see step 2 note).
2. Execute the migration runner through the staging harness, from the repository root:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/migrate.js
   ```
   Do **not** set `NABIN_STAGING_ENV_FILE=./.env.staging` from the repo root — measured 2026-10-12, that path does not exist there and the harness refuses with `Staging env file not found at "./.env.staging" and STAGING_SUPABASE_URL/STAGING_DATABASE_URL are unset.` (exit 2, nothing spawned). The variable is only needed to aim the harness at a *different* file; the default is already `backend/.env.staging`, resolved relative to the script, not the cwd. If you do set it, use `NABIN_STAGING_ENV_FILE=backend/.env.staging`.
   Note also that the `STAGING_*` parent-variable path is consulted only when no staging env file exists, so exporting `STAGING_SUPABASE_URL` alongside an existing `backend/.env.staging` changes nothing.
3. Run integration verification — **not** with `test_chain.js`:
   ```bash
   node backend/scripts/with_staging_target.js node backend/scripts/verify_hosted_test_env.js
   ```
   The previously documented `... with_staging_target.js node backend/scripts/test_chain.js` cannot work and was removed: `test_chain.js` is local-Docker-only. It provisions `chain_scratch` via `docker exec` (`scripts/chain_scratch.js`, `SCRATCH_SCRIPT` at `test_chain.js:658`) and refuses a non-loopback `DATABASE_URL`/`SUPABASE_URL` unless `NABIN_ALLOW_REMOTE_TESTS=1` (`test_chain.js:415-419`). Wrapping it in the staging harness pins a hosted target, so the two guards contradict each other — the chain would have to be pointed at production data or given an override that defeats its own safety check. Hosted verification is the read-only environment verifier above plus the synthetic staging suite; the 64-link regression chain stays on local Docker.
   Measured 2026-10-12, this command exits **2 before the verifier runs**, because the harness refuses while the staging password is the template literal — so it is a gate, not a check you can pass today. Run without the harness against `backend/.env` (hosted test REST keys, no `DATABASE_URL`), the verifier used to print `✅ PASS: Environment is safely and correctly configured for Hosted TEST` and exit 0; it now reports `⚠️ PENDING CREDENTIALS: … DATABASE_URL is missing or still a template. Nothing was verified.` and exits 2. That fail-open is closed and pinned by `backend/verify_hosted_test_env_guard_test.js`: **27/27** (chain link 64).
4. Blocking prerequisite, unchanged since it was first recorded: the owner must paste the `ywhxkzmbwppkdemvzlhv` database password into `backend/.env.staging`. Until then no step in this section can execute, and the harness says so locally rather than taking a `28P01` from the remote.
