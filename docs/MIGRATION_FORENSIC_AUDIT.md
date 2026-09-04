# NABIN — COMPLETE MIGRATION FORENSIC AUDIT REPORT

**Date:** 2026-09-04  
**Investigator:** Antigravity Autonomous Pair Programmer  
**Audited Repositories:**  
1. `C:\Users\macmi\Documents\nabin` (Active Git worktree & local Docker Supabase environment)  
2. `C:\Users\macmi\OneDrive\Documents\nabin` (Historical Git repository & backup tree)  
**Database Target:** Local Docker PostgreSQL (`127.0.0.1:54322` / `127.0.0.1:54321`)  
**Status:** COMPLETED & VERIFIED FACTUALLY

---

## 1. Executive Summary

This forensic audit was conducted to determine the complete historical migration state of the NABIN platform, evaluate whether migrations `015+` ever existed historically, and cross-check the current application dependencies against the verified schema.

### Core Audit Findings:
1. **Total Historical Migrations:** Exactly **14 migrations** (`001` through `014`) existed historically.
2. **Migrations 015+ Did NOT Exist Historically:** Exhaustive Git archaeology across the entire 43-commit history of the original repository (`C:\Users\macmi\OneDrive\Documents\nabin`), commit reflogs, tree objects, and local archives confirms that the sequential domain implementation concluded at **Domain 14** (`014_dispatch_domain.sql`, commit `e673d6d`, Sun Aug 30, 2026, 21:17:52 +0530). No commit, branch, tag, unreferenced blob, or documentation file ever created or referenced a migration numbered 015 or higher.
3. **Domain Naming Pattern:** Each migration in the chain maps 1-to-1 with a numbered architectural domain:
   - Domain 1–4: Core Schema, Ledger, Extended & Missing Entities (`001`–`004`)
   - Domain 5: Jobs & Bookings (`005`)
   - Domain 6–7: Payments & Wallets (`006`–`007`, tagged `domain-7-complete`)
   - Domain 8–10: Support, Promotions & Admin Audit (`008`–`010`)
   - Domain 11–14: Geofencing, Notifications, Checkout & Driver Dispatch (`011`–`014`)
4. **Current Schema Coverage:** The 14 authentic historical migrations declare **38 unique public tables**, **516 columns**, **140 indexes**, **52 RLS policies**, and **5 database functions/RPCs**, all of which are 100% applied and healthy in local PostgreSQL.
5. **Future Migration Candidates (Class C — Current Required / New):** Any migrations numbered 015 or higher are **NEW** requirements for future phases (e.g., PostGIS driver spatial dispatch, normalized restaurant menu catalog, automated bank settlement cron) and must be clearly designated as new architectural extensions rather than manufactured historical artifacts.

---

## 2. Verified Historical Migration Chain (001–014)

Every file in the migration sequence was verified for byte-for-byte identity between `backend/migrations/` and `supabase/migrations/`:

| Num | Filename | Size (Bytes) | SHA-256 Checksum | Domain Covered | Historical Commit |
|:---:|:---|:---:|:---|:---|:---:|
| **001** | `001_central_schema.sql` | 13,660 | `7853ec1ce6a2034997bcdd43b6476224290ef38f057c10d122d09c2b2339b3b4` | Users, Drivers, Central Schema, RLS | `ac205e4` |
| **002** | `002_finance_ledger_schema.sql` | 5,465 | `f94a8606c412a728a6e789cb334ccfbb43843c83aa09c78c04819773a26c20b3` | Double-entry ledger, Chart of accounts | `ef3d5c7` |
| **003** | `003_extended_schema.sql` | 5,004 | `23f8c60182eb34b3a6c113422175ab08d6152622a90c394ba3e4f637932dc22f` | KYC, Sessions, Tickets, Platform settings | `493b7ba` |
| **004** | `004_missing_entities_schema.sql` | 4,740 | `6c4aeeed55c034899eae33864c82d579b451aba15e4043bf12a033d8328033f8` | Ads, Saved locations, Products | `493b7ba` |
| **005** | `005_jobs_domain.sql` | 1,369 | `bff30867bed7c7d6ad9a1739162306524c575fcc22850093bf57d30f20c96728` | Job domain extensions, status checks | `d037331` |
| **006** | `006_payments_domain.sql` | 17,106 | `2ae5035ddbc7602ba86e50a7135b67c21caf7c89527ee819d29e9d1f83024e51` | Payment sessions, atomic capture/refund | `4aa61d5` |
| **007** | `007_wallets_domain.sql` | 4,428 | `00ee2cb8851d401b546a41b4db725185c7b749eaab4068865d5df551c9c5c30d` | `adjust_wallet_atomic` RPC, Overdraft guards | `4aa61d5` |
| **008** | `008_support_domain.sql` | 1,375 | `7dd0609c330b8f7ff0fb6cd04d1888aeb16442daf203fff1565c272523e3c517` | Dispute resolution, Support triggers | `c9fb185` |
| **009** | `009_promotions_domain.sql` | 16,988 | `5708022d2b652873c4f4621e6634ec1b270c9ed8d30c1d2bdaf7efcad1d6ce99` | Coupons, Redemptions, Atomic validate | `4e2aa07` |
| **010** | `010_admin_audit_domain.sql` | 3,421 | `c26b58228553482b39691108ecd4e728c1e080b4353480a0e98e5b0832cd1bba` | Immutable audit trail, RBAC triggers | `676c371` |
| **011** | `011_geofences_surge_domain.sql` | 9,321 | `b58df2b7950ad9be09852d1484659f831c9bae1c4376d33a320ff59873bef254` | Surge zones, Pricing rules, Geofences | `810eec2` |
| **012** | `012_notifications_domain.sql` | 14,300 | `77481e42906fab172fe93a751bf3b589ef0729a97cf6c25991b1ca626b1e2618` | Notifications, Device tokens, Templates | `aa5f1d5` |
| **013** | `013_checkout_domain.sql` | 5,872 | `6b4cad59f0d5152f4a40ab0ebe0c8dea2b5598764cf876990459534577658636` | Carts, Checkout orders, Order events | `25e8596` |
| **014** | `014_dispatch_domain.sql` | 3,121 | `bf67b31a59de3262baac4e86e31b6786e5c694b4aa34cdd934f9543760aed097` | Dispatch offers, Driver telemetry | `e673d6d` |

---

## 3. Forensic Evidence Concerning Migrations 015+

### A. Git Archaeology Evidence
1. **Latest Historical Commit**: In `C:\Users\macmi\OneDrive\Documents\nabin`, the absolute latest commit in Git history is `e673d6d95a9979f304bd9e013fa60f63cccf33c2` ("feat(backend): complete driver dispatch domain"), committed on August 30, 2026 at 21:17:52 +0530.
2. **Commit Content**: This final commit added `backend/migrations/014_dispatch_domain.sql`, `backend/dispatch_persistence_test.js`, and `backend/src/services/DispatchService.js`.
3. **Reflog Verification**: The Git reflog in the original repository confirms `HEAD@{0}` is `e673d6d`. There are zero dangling, orphaned, or subsequent commits.
4. **Object Tree Search**: Running `git rev-list --objects --all` across the Git object store produced zero matches for filenames containing `015`, `016`, `017`, `018`, `019`, or `020`.
5. **Deleted Files Scan**: Running `git log --diff-filter=D --summary` revealed that no SQL file was ever deleted from version control.

### B. Filesystem & Archive Evidence
1. **OneDrive Tree Scan**: Recursive search of `C:\Users\macmi\OneDrive\Documents\nabin` for `*.sql` returned exactly 14 files, concluding at `014_dispatch_domain.sql`.
2. **User Downloads Scan**: Searching `C:\Users\macmi\Downloads` identified only the Flutter SDK and emulator archives; zero additional migration ZIPs exist.
3. **Codebase Pattern Search**: Full-text regex search across all documentation, source code, and comments for `015_`, `016_`, `migration 15`, `migration 20` returned zero references. The only prior documentation mentioning 015/016 was `docs/FORENSIC_MIGRATION_RECOVERY_REPORT.md` which explicitly recorded:
   > *"Migrations 015 & 016: Do not exist in either Git history or OneDrive storage; the pre-reinstallation migration sequence concluded at 014."*

---

## 4. Search Locations & Methodology Examined

| Search Location | Tool / Command Used | Scope & Results |
|---|---|---|
| **OneDrive Git Log** | `git log --oneline --reverse` | 43 historical commits; tracked domain progression from Domain 1 to Domain 14. |
| **OneDrive Git Reflog** | `git reflog -n 15` | Confirmed `HEAD@{0}` is `e673d6d` (Domain 14). No stashes or lost commits. |
| **Git Object Store** | `git rev-list --objects --all` | Scanned all blobs/trees; zero matches for 015+. |
| **Deleted Files Audit** | `git log --diff-filter=D` | Zero deleted migration files in repository history. |
| **OneDrive Filesystem** | `Get-ChildItem -Recurse -Filter "*.sql"` | 14 SQL files in `backend/migrations/`. |
| **Local Working Copy** | Directory listing of `backend/` and `supabase/` | 14 SQL files in each directory with identical hashes. |
| **Downloads Folder** | `Get-ChildItem -Path "C:\Users\macmi\Downloads"` | No unextracted migration archives found. |
| **PostgreSQL Catalog** | `supabaseAdmin.from(...)` system audit | 38 tables, 516 columns, 5 RPCs cataloged and verified. |
| **Backend Codebase** | Regex scanner (`.from()`, `.rpc()`, `this.* = []`) | Traced all table and RPC dependencies in Node.js backend. |

---

## 5. Historical Migration Provenance Table

```text
Commit 506c376 ──→ Initial Multi-App Platform Base (Aug 22)
Commit 94d5b6e ──→ Beta Launch Hardening (Aug 22)
Commit ac205e4 ──→ Central Schema Migration 001 (Aug 22)
Commit ef3d5c7 ──→ Finance Ledger Migration 002 (Aug 22)
Commit 493b7ba ──→ Extended & Missing Entities Migrations 003 & 004 (Aug 25)
Commit d037331 ──→ Domain 5 Jobs Migration 005 (Aug 26-27)
Commit 4aa61d5 ──→ Domain 6 Payments (006) & Domain 7 Wallets (007) (Aug 28)
                   [TAG: domain-7-complete]
Commit c9fb185 ──→ Domain 8 Support & Disputes Migration 008 (Aug 28-29)
Commit 4e2aa07 ──→ Domain 9 Promotions & Coupons Migration 009 (Aug 29)
Commit 676c371 ──→ Domain 10 Admin Audit Migration 010 (Aug 29)
Commit 810eec2 ──→ Domain 11 Geofences & Surge Migration 011 (Aug 29-30)
Commit aa5f1d5 ──→ Domain 12 Notifications Migration 012 (Aug 30)
Commit 25e8596 ──→ Domain 13 Checkout Orchestration Migration 013 (Aug 30)
Commit e673d6d ──→ Domain 14 Driver Dispatch Migration 014 (Aug 30 21:17:52)
                   [FINAL HISTORICAL COMMIT]
```

---

## 6. Current Schema vs. Migration Chain Comparison

All 38 public tables currently resident in local PostgreSQL map directly to migrations 001–014:

| Public Table Name | Created By Migration | Domain | Verification in Local DB |
|---|---|---|:---:|
| `users` | `001_central_schema.sql` | Identity & Auth | Present |
| `identity_documents` | `001_central_schema.sql` | KYC | Present |
| `drivers` | `001_central_schema.sql` | Fleet | Present |
| `merchants` | `001_central_schema.sql` | Food/Grocery | Present |
| `master_grocery_catalog` | `001_central_schema.sql` | Grocery | Present |
| `merchant_grocery_inventory` | `001_central_schema.sql` | Inventory | Present |
| `grocery_price_history` | `001_central_schema.sql` | Pricing | Present |
| `jobs` | `001_central_schema.sql` (enhanced by `005`) | Dispatch/Trips | Present |
| `admin_accounts` | `001_central_schema.sql` | RBAC | Present |
| `ledger_entries` | `001_central_schema.sql` | Financial | Present |
| `payment_webhooks` | `001_central_schema.sql` | Payments | Present |
| `audit_logs` | `001_central_schema.sql` (enhanced by `010`) | Compliance | Present |
| `geo_fences` | `001_central_schema.sql` (enhanced by `011`) | Geofences | Present |
| `promotions` | `001_central_schema.sql` (enhanced by `009`) | Marketing | Present |
| `ledger_accounts` | `002_finance_ledger_schema.sql` | Chart of Accounts | Present |
| `journal_transactions` | `002_finance_ledger_schema.sql` | Double-Entry | Present |
| `journal_lines` | `002_finance_ledger_schema.sql` | Double-Entry | Present |
| `payments` | `002_finance_ledger_schema.sql` | Settlements | Present |
| `driver_payouts` | `002_finance_ledger_schema.sql` | Settlements | Present |
| `active_sessions` | `003_extended_schema.sql` | Auth | Present |
| `notifications` | `003_extended_schema.sql` (enhanced by `012`) | Messaging | Present |
| `support_tickets` | `003_extended_schema.sql` (enhanced by `008`) | Customer Care | Present |
| `platform_settings` | `003_extended_schema.sql` | Configuration | Present |
| `products` | `004_missing_entities_schema.sql` | Catalog | Present |
| `advertisements` | `004_missing_entities_schema.sql` | Monetization | Present |
| `user_saved_locations` | `004_missing_entities_schema.sql` | Customer | Present |
| `user_delegates` | `004_missing_entities_schema.sql` | Security | Present |
| `payment_sessions` | `006_payments_domain.sql` | Checkout | Present |
| `promotion_redemptions` | `009_promotions_domain.sql` | Marketing | Present |
| `surge_zones` | `011_geofences_surge_domain.sql` | Pricing | Present |
| `pricing_configurations` | `011_geofences_surge_domain.sql` | Dynamic Fare | Present |
| `device_tokens` | `012_notifications_domain.sql` | Push Notifications | Present |
| `notification_preferences` | `012_notifications_domain.sql` | User Settings | Present |
| `notification_deliveries` | `012_notifications_domain.sql` | Audit Trail | Present |
| `notification_templates` | `012_notifications_domain.sql` | Content | Present |
| `checkouts` | `013_checkout_domain.sql` | Cart/Order Lock | Present |
| `checkout_events` | `013_checkout_domain.sql` | Funnel Analytics | Present |
| `dispatch_offers` | `014_dispatch_domain.sql` | Driver Matchmaking | Present |

**Conclusion**: There are **zero orphan tables** in local PostgreSQL. Every table in the database was created by migrations 001–014.

---

## 7. Application Dependency vs. Migration Chain Comparison

Scanning the backend and mobile code revealed how the application interacts with the database:

1. **Phase 1 Authoritative Tables (Actively queried via PostgreSQL Repositories)**:
   - `users` (via `UserRepository`)
   - `drivers` (via `DriverRepository`)
   - `jobs` (via `JobRepository`)
   - `ledger_accounts`, `journal_transactions`, `journal_lines` (via `LedgerRepository` & `adjust_wallet_atomic`)
   - `admin_accounts` (via `initPostgres()` hydration)
2. **Pre-Seeded Tables with Ready Schema (Currently in transient memory arrays in `database.js`)**:
   - `support_tickets` (Schema ready in `003` & `008`)
   - `promotions` / `promotion_redemptions` (Schema ready in `001` & `009`)
   - `geo_fences` / `surge_zones` (Schema ready in `001` & `011`)
   - `notifications` / `device_tokens` (Schema ready in `012`)
   - `checkouts` (Schema ready in `013`)
   - `dispatch_offers` (Schema ready in `014`)
   - `advertisements` (Schema ready in `004`)
   - `merchants` / `master_grocery_catalog` / `merchant_grocery_inventory` (Schema ready in `001` & `004`)

**Conclusion**: The existing schema in migrations 001–014 is already prepared to support the migration of the remaining backend domains into PostgreSQL without requiring any new schema tables for these existing features.

---

## 8. Classification Taxonomy

### Category A: VERIFIED HISTORICAL (Exact provenance & authentic content)
- `001_central_schema.sql`
- `002_finance_ledger_schema.sql`
- `003_extended_schema.sql`
- `004_missing_entities_schema.sql`
- `005_jobs_domain.sql`
- `006_payments_domain.sql`
- `007_wallets_domain.sql`
- `008_support_domain.sql`
- `009_promotions_domain.sql`
- `010_admin_audit_domain.sql`
- `011_geofences_surge_domain.sql`
- `012_notifications_domain.sql`
- `013_checkout_domain.sql`
- `014_dispatch_domain.sql`

### Category B: HISTORICAL BUT UNCERTAIN
- **None**: Every historical migration that was created has been recovered and verified byte-for-byte.

### Category C: CURRENT REQUIRED / NEW (Forward-looking requirements for future phases)
- **015 (Spatial Telemetry & PostGIS Matchmaking)**: Forward-looking domain for PostGIS-backed driver spatial proximity queries (`ST_DWithin`) to replace JavaScript distance approximations.
- **016 (Restaurant Menu Catalog)**: Forward-looking domain for normalized multi-restaurant food menu items and variant pricing (currently stored in JSON arrays).
- **017 (Automated Bank Settlement Batch Engine)**: Forward-looking stored procedures for automated batch payouts to drivers and merchants.

### Category D: DUPLICATE / DERIVED
- `backend/migrations/*.sql` vs `supabase/migrations/*.sql`: Identical byte-for-byte copies kept in sync for compatibility between Node backend and Supabase CLI.

---

## 9. Risks and Uncertainties

1. **Memory Confusion vs. Database Reality**: A belief that there were "20+ migrations" may stem from the fact that there are **19 functional QA modules** in `test_suite.js` or **29 in-memory collections** in `database.js`. Historically, the developer bundled those functional modules into **14 domain SQL migrations**.
2. **Safety Boundary**: Under no circumstances should synthetic migrations 015–020 be invented to satisfy an assumption of a 20+ migration count. Doing so would corrupt the authentic provenance of the codebase.

---

## 10. Recommended Next Migration Sequence (Phase 2+)

When future phases require additional PostgreSQL schema, migrations should advance chronologically from `015`:
1. `015_postgis_spatial_dispatch.sql`: Enables `postgis` extension and spatial indexing on driver coordinates.
2. `016_restaurant_menu_catalog.sql`: Normalizes food items, categories, and customization options.
3. `017_settlements_batch_engine.sql`: Adds stored procedures for scheduled banking payout batches.

---

## 11. Explicit Statement of What Was NOT Proven

1. **NOT Proven**: There is **zero evidence** that migrations `015` through `020` ever existed in any repository, backup, or machine.
2. **Proven**: The authentic, historical NABIN migration sequence concluded at migration **`014_dispatch_domain.sql`** on August 30, 2026.
3. **Proven**: Migrations 001–014 provide complete coverage of all 38 public tables currently applied in local PostgreSQL.
