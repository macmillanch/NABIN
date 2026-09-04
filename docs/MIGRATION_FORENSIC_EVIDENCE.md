# NABIN — MIGRATION FORENSIC EVIDENCE LOG

**Date:** 2026-09-04  
**Investigator:** Antigravity Autonomous Pair Programmer  
**Audited Artifacts:** Git Repositories, Filesystems, PostgreSQL Database Catalogs  

---

## 1. Provenance & Evidence for Historical Migrations (001–014)

Every historical migration was verified with exact byte sizes, SHA-256 hashes, and historical commit references from the primary repository (`C:\Users\macmi\OneDrive\Documents\nabin`):

### Migration 001: Central Schema
- **File:** `backend/migrations/001_central_schema.sql` & `supabase/migrations/001_central_schema.sql`
- **Size:** 13,660 bytes
- **SHA-256:** `7853ec1ce6a2034997bcdd43b6476224290ef38f057c10d122d09c2b2339b3b4`
- **Primary Git Commit:** `ac205e4` ("feat(backend): add central schema migration 001")
- **Author Date:** Sat Aug 22 2026
- **Database Tables Created:** `users`, `identity_documents`, `drivers`, `merchants`, `master_grocery_catalog`, `merchant_grocery_inventory`, `grocery_price_history`, `jobs`, `admin_accounts`, `ledger_entries`, `payment_webhooks`, `audit_logs`, `geo_fences`, `promotions`
- **Integrity Status:** Verified authentic byte-for-byte between backend and supabase migration folders.

### Migration 002: Finance & Ledger
- **File:** `backend/migrations/002_finance_ledger_schema.sql` & `supabase/migrations/002_finance_ledger_schema.sql`
- **Size:** 5,465 bytes
- **SHA-256:** `f94a8606c412a728a6e789cb334ccfbb43843c83aa09c78c04819773a26c20b3`
- **Primary Git Commit:** `ef3d5c7` ("feat(backend): complete PostgreSQL ledger and finance persistence")
- **Author Date:** Sat Aug 22 2026
- **Database Tables Created:** `ledger_accounts`, `journal_transactions`, `journal_lines`, `payments`, `driver_payouts`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 003: Extended Schema
- **File:** `backend/migrations/003_extended_schema.sql` & `supabase/migrations/003_extended_schema.sql`
- **Size:** 5,004 bytes
- **SHA-256:** `23f8c60182eb34b3a6c113422175ab08d6152622a90c394ba3e4f637932dc22f`
- **Primary Git Commit:** `493b7ba` ("feat(backend): add extended schema migrations 003 and 004")
- **Author Date:** Tue Aug 25 2026
- **Database Tables Created:** `active_sessions`, `notifications`, `support_tickets`, `platform_settings`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 004: Missing Entities Schema
- **File:** `backend/migrations/004_missing_entities_schema.sql` & `supabase/migrations/004_missing_entities_schema.sql`
- **Size:** 4,740 bytes
- **SHA-256:** `6c4aeeed55c034899eae33864c82d579b451aba15e4043bf12a033d8328033f8`
- **Primary Git Commit:** `493b7ba` ("feat(backend): add extended schema migrations 003 and 004")
- **Author Date:** Tue Aug 25 2026
- **Database Tables Created:** `products`, `advertisements`, `user_saved_locations`, `user_delegates`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 005: Jobs Domain
- **File:** `backend/migrations/005_jobs_domain.sql` & `supabase/migrations/005_jobs_domain.sql`
- **Size:** 1,369 bytes
- **SHA-256:** `bff30867bed7c7d6ad9a1739162306524c575fcc22850093bf57d30f20c96728`
- **Primary Git Commit:** `d037331` ("feat(backend): complete PostgreSQL jobs domain integration")
- **Author Date:** Thu Aug 27 2026
- **Schema Alterations:** Enhances `jobs` table with lifecycle constraints and indexes.
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 006: Payments Domain
- **File:** `backend/migrations/006_payments_domain.sql` & `supabase/migrations/006_payments_domain.sql`
- **Size:** 17,106 bytes
- **SHA-256:** `2ae5035ddbc7602ba86e50a7135b67c21caf7c89527ee819d29e9d1f83024e51`
- **Primary Git Commit:** `4aa61d5` ("feat(backend): complete PostgreSQL payments and wallets domains")
- **Author Date:** Fri Aug 28 2026
- **Database Tables Created:** `payment_sessions` (and payment webhook idempotency indices)
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 007: Wallets Domain
- **File:** `backend/migrations/007_wallets_domain.sql` & `supabase/migrations/007_wallets_domain.sql`
- **Size:** 4,428 bytes
- **SHA-256:** `00ee2cb8851d401b546a41b4db725185c7b749eaab4068865d5df551c9c5c30d`
- **Primary Git Commit:** `4aa61d5` ("feat(backend): complete PostgreSQL payments and wallets domains")
- **Git Tag:** `domain-7-complete`
- **Author Date:** Fri Aug 28 2026
- **RPC Functions Created:** `adjust_wallet_atomic`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 008: Support & Disputes Domain
- **File:** `backend/migrations/008_support_domain.sql` & `supabase/migrations/008_support_domain.sql`
- **Size:** 1,375 bytes
- **SHA-256:** `7dd0609c330b8f7ff0fb6cd04d1888aeb16442daf203fff1565c272523e3c517`
- **Primary Git Commit:** `c9fb185` ("feat(backend): complete PostgreSQL support and dispute domain")
- **Author Date:** Sat Aug 29 2026
- **Schema Alterations:** Enhances `support_tickets` table with resolution triggers and escalation indices.
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 009: Promotions Domain
- **File:** `backend/migrations/009_promotions_domain.sql` & `supabase/migrations/009_promotions_domain.sql`
- **Size:** 16,988 bytes
- **SHA-256:** `5708022d2b652873c4f4621e6634ec1b270c9ed8d30c1d2bdaf7efcad1d6ce99`
- **Primary Git Commit:** `4e2aa07` ("feat(backend): complete PostgreSQL promotions domain")
- **Author Date:** Sat Aug 29 2026
- **Database Tables Created:** `promotion_redemptions`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 010: Admin Audit Domain
- **File:** `backend/migrations/010_admin_audit_domain.sql` & `supabase/migrations/010_admin_audit_domain.sql`
- **Size:** 3,421 bytes
- **SHA-256:** `c26b58228553482b39691108ecd4e728c1e080b4353480a0e98e5b0832cd1bba`
- **Primary Git Commit:** `676c371` ("feat(backend): complete PostgreSQL admin audit domain")
- **Author Date:** Sat Aug 29 2026
- **Schema Alterations:** Enhances `audit_logs` and `admin_accounts` with strict immutability rules.
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 011: Geofences & Surge Domain
- **File:** `backend/migrations/011_geofences_surge_domain.sql` & `supabase/migrations/011_geofences_surge_domain.sql`
- **Size:** 9,321 bytes
- **SHA-256:** `b58df2b7950ad9be09852d1484659f831c9bae1c4376d33a320ff59873bef254`
- **Primary Git Commit:** `810eec2` ("feat(backend): complete PostgreSQL geofencing and surge domain")
- **Author Date:** Sat Aug 29 2026
- **Database Tables Created:** `surge_zones`, `pricing_configurations`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 012: Notifications Domain
- **File:** `backend/migrations/012_notifications_domain.sql` & `supabase/migrations/012_notifications_domain.sql`
- **Size:** 14,300 bytes
- **SHA-256:** `77481e42906fab172fe93a751bf3b589ef0729a97cf6c25991b1ca626b1e2618`
- **Primary Git Commit:** `aa5f1d5` ("feat(backend): complete PostgreSQL notifications domain")
- **Author Date:** Sun Aug 30 2026
- **Database Tables Created:** `device_tokens`, `notification_preferences`, `notification_deliveries`, `notification_templates`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 013: Checkout Domain
- **File:** `backend/migrations/013_checkout_domain.sql` & `supabase/migrations/013_checkout_domain.sql`
- **Size:** 5,872 bytes
- **SHA-256:** `6b4cad59f0d5152f4a40ab0ebe0c8dea2b5598764cf876990459534577658636`
- **Primary Git Commit:** `25e8596` ("feat(backend): complete checkout orchestration domain")
- **Author Date:** Sun Aug 30 2026
- **Database Tables Created:** `checkouts`, `checkout_events`
- **Integrity Status:** Verified authentic byte-for-byte.

### Migration 014: Dispatch Domain
- **File:** `backend/migrations/014_dispatch_domain.sql` & `supabase/migrations/014_dispatch_domain.sql`
- **Size:** 3,121 bytes
- **SHA-256:** `bf67b31a59de3262baac4e86e31b6786e5c694b4aa34cdd934f9543760aed097`
- **Primary Git Commit:** `e673d6d` ("feat(backend): complete driver dispatch domain")
- **Author Date:** Sun Aug 30 2026 21:17:52 +0530
- **Database Tables Created:** `dispatch_offers`
- **Integrity Status:** Verified authentic byte-for-byte. **This is the final historical migration.**

---

## 2. Evidence Concerning Claims of Migrations 015+

### Claim 1: "Migrations 015+ existed in Git version control history"
- **Test Command:** `git rev-list --objects --all | git cat-file --batch-check='%(objectname) %(objecttype) %(rest)'` executed in `C:\Users\macmi\OneDrive\Documents\nabin`
- **Result:** ZERO blobs, trees, or tags match the patterns `015*`, `016*`, `017*`, `018*`, `019*`, `020*`.
- **Status:** **DISPROVEN / FALSE**.

### Claim 2: "Migrations 015+ existed as uncommitted or deleted files in OneDrive"
- **Test Commands:**
  - `git log --diff-filter=D --summary`
  - `Get-ChildItem -Path "C:\Users\macmi\OneDrive\Documents\nabin" -Recurse -Filter "*.sql"`
- **Result:** Exactly 14 SQL files in `backend/migrations/` and 0 deleted SQL files across all 43 commits.
- **Status:** **DISPROVEN / FALSE**.

### Claim 3: "Migrations 015+ exist as orphan database objects in local PostgreSQL"
- **Test Command:** Catalog queries against `information_schema.tables` and `pg_proc` on `127.0.0.1:54322`.
- **Result:** Total public tables = 38. All 38 tables are fully accounted for by migrations 001–014. Total custom RPC functions = 5 (`adjust_wallet_atomic`, `update_updated_at_column`, `set_updated_at`, `log_audit_action`, `check_rate_limit`). All 5 functions were created in migrations 001–014. Total orphan tables/functions = 0.
- **Status:** **DISPROVEN / FALSE**.

### Claim 4: "The codebase references tables requiring migrations beyond 014"
- **Test Command:** AST & regex inspection of `backend/src/` for `.from(...)` and database collections.
- **Result:** All collections referenced by application repositories (`users`, `drivers`, `jobs`, `ledger_accounts`, `journal_transactions`, `journal_lines`, `admin_accounts`, `support_tickets`, `promotions`, `geo_fences`, `surge_zones`, `notifications`, `checkouts`, `dispatch_offers`, `merchants`, `master_grocery_catalog`) already exist in PostgreSQL tables created by migrations 001–014.
- **Status:** **DISPROVEN / FALSE**.

### Claim 5: "Where did the '20+ migrations' impression originate?"
- **Evidence 1:** `backend/test_suite.js` contains **19 functional modules** (Rides, Food, Grocery, Parcel, Ledger, Dispatch, Escrow, etc.).
- **Evidence 2:** `backend/src/models/database.js` defines **29 in-memory collection arrays** (`users`, `drivers`, `jobs`, `merchants`, `products`, `orders`, `ledger`, `wallets`, `tickets`, `coupons`, `geofences`, `surge`, `notifications`, `checkouts`, `dispatchOffers`, etc.).
- **Deduction:** The 19 test modules and 29 database entity collections were organized by the author into **14 domain SQL migration files** (`001` through `014`).

---

## 3. Forensic Conclusion

1. **Category A (Verified Historical):** Exactly 14 files (`001_central_schema.sql` through `014_dispatch_domain.sql`).
2. **Category B (Historical Uncertain):** None.
3. **Category C (Current Required / New):** Any future migrations (015+) must be treated as new feature work for Phase 2+, not historical recovery.
4. **Category D (Duplicate / Derived):** `backend/migrations/*.sql` and `supabase/migrations/*.sql` are identical mirror copies.
