# NABIN LOCAL SUPABASE AUDIT REPORT

**Date:** 2026-09-04  
**Environment:** Local Development (Docker Desktop + WSL2)  
**Database URL:** `postgresql://postgres:postgres@127.0.0.1:54322/postgres`  
**Supabase CLI Version:** `2.116.0`  
**Git Baseline Commit:** `3a2e89e0a37a9ca58b8466202a123cb31961fc52`  

---

## 1. Migration Application Sequence

All 14 authoritative migrations were applied in strict sequential order with zero manual alterations or invented SQL:

| # | Migration File | Status | Domain Covered |
|---|---|:---:|---|
| 001 | `001_central_schema.sql` | APPLIED | Central multi-app core, Users, Drivers, Merchants, Products, Jobs, RLS, Indexes |
| 002 | `002_finance_ledger_schema.sql` | APPLIED | Chart of accounts, immutable double-entry journal & ledger entries |
| 003 | `003_extended_schema.sql` | APPLIED | Auth sessions, push device tokens, support tickets, platform settings |
| 004 | `004_missing_entities_schema.sql` | APPLIED | Identity documents, user delegates, saved locations, advertisements |
| 005 | `005_jobs_domain.sql` | APPLIED | Extended jobs lifecycle, state tracking, driver assignment |
| 006 | `006_payments_domain.sql` | APPLIED | Payment transactions, gateway webhooks, payouts, refunds, atomic functions |
| 007 | `007_wallets_domain.sql` | APPLIED | Multi-user wallet balance management & atomic balance adjustment functions |
| 008 | `008_support_domain.sql` | APPLIED | Customer support threads, dispute escalation, driver freeze & safety resolution |
| 009 | `009_promotions_domain.sql` | APPLIED | Promotional campaigns, coupon redemptions, atomic validation & discount engine |
| 010 | `010_admin_audit_domain.sql` | APPLIED | Administrative access accounts, immutable audit logging & compliance trails |
| 011 | `011_geofences_surge_domain.sql` | APPLIED | Spatial geofencing boundaries, dynamic surge zones, polygon containment pricing |
| 012 | `012_notifications_domain.sql` | APPLIED | Templated multi-channel notifications, delivery tracking & user preferences |
| 013 | `013_checkout_domain.sql` | APPLIED | Unified checkout state machine, checkout events & order transitions |
| 014 | `014_dispatch_domain.sql` | APPLIED | Driver real-time dispatch offers, radius broadcasting & acceptance state |

*Note: Migrations 015 and 016 do not exist; the sequence is finalized and complete at 014.*

---

## 2. Database Schema Summary Metrics

| Metric | Count |
|---|:---:|
| **Public Tables** | **38** |
| **Total Columns** | **516** |
| **Primary Keys** | **38** (100% table coverage) |
| **Foreign Keys** | **34** |
| **Database Indexes** | **140** |
| **Row Level Security (RLS) Policies** | **52** |
| **Stored Procedures / RPC Functions** | **5** |
| **Active PostgreSQL Extensions** | **7** |

---

## 3. Public Table Breakdown & RLS Posture

| Table Name | Columns | Primary Key | Foreign Keys | RLS Status |
|---|:---:|:---:|:---:|:---:|
| `active_sessions` | 9 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `admin_accounts` | 15 | `id` | None | **ENABLED** |
| `advertisements` | 12 | `id` | None | **ENABLED** |
| `audit_logs` | 20 | `id` | None | **ENABLED** |
| `checkout_events` | 9 | `id` | `checkout_id` -> `checkouts.id` | **ENABLED** |
| `checkouts` | 31 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `device_tokens` | 10 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `dispatch_offers` | 15 | `id` | `job_id`, `driver_id` | **ENABLED** |
| `driver_payouts` | 10 | `id` | `driver_id` -> `drivers.id` | **ENABLED** |
| `drivers` | 14 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `geo_fences` | 19 | `id` | None | **ENABLED** |
| `grocery_price_history` | 9 | `id` | `product_id`, `merchant_id` | DISABLED (Public Catalog) |
| `identity_documents` | 14 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `jobs` | 32 | `id` | `customer_id`, `driver_id`, `merchant_id` | **ENABLED** |
| `journal_lines` | 9 | `id` | `transaction_id`, `account_id` | **ENABLED** |
| `journal_transactions` | 11 | `id` | None | **ENABLED** |
| `ledger_accounts` | 10 | `id` | None | **ENABLED** |
| `ledger_entries` | 12 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `master_grocery_catalog` | 12 | `id` | None | DISABLED (Public Catalog) |
| `merchant_grocery_inventory` | 8 | `id` | `merchant_id`, `product_id` | DISABLED (Public Catalog) |
| `merchants` | 13 | `id` | `owner_id` -> `users.id` | **ENABLED** |
| `notification_deliveries` | 14 | `id` | `notification_id` -> `notifications.id` | **ENABLED** |
| `notification_preferences` | 17 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `notification_templates` | 11 | `id` | None | **ENABLED** |
| `notifications` | 19 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `payment_sessions` | 14 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `payment_webhooks` | 12 | `id` | None | **ENABLED** |
| `payments` | 17 | `id` | `job_id`, `payer_id` | **ENABLED** |
| `platform_settings` | 5 | `key` | None | **ENABLED** |
| `pricing_configurations` | 13 | `id` | None | **ENABLED** |
| `products` | 13 | `id` | `merchant_id` -> `merchants.id` | **ENABLED** |
| `promotion_redemptions` | 8 | `id` | `promotion_id`, `user_id` | **ENABLED** |
| `promotions` | 22 | `id` | None | **ENABLED** |
| `support_tickets` | 16 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `surge_zones` | 15 | `id` | `geofence_id` -> `geo_fences.id` | **ENABLED** |
| `user_delegates` | 7 | `id` | `principal_user_id`, `delegate_user_id` | **ENABLED** |
| `user_saved_locations` | 7 | `id` | `user_id` -> `users.id` | **ENABLED** |
| `users` | 12 | `id` | None | **ENABLED** |

---

## 4. Stored Functions / Atomic RPCs

1. `adjust_wallet_atomic(p_user_id, p_amount, p_reference, p_metadata)` -> `json`
2. `capture_payment_atomic(p_session_id, p_payment_id, p_signature, p_amount)` -> `json`
3. `redeem_promotion_atomic(p_promotion_id, p_user_id, p_order_amount, p_context)` -> `jsonb`
4. `refund_payment_atomic(p_payment_id, p_amount, p_reason)` -> `json`
5. `validate_promotion_preview(p_code, p_user_id, p_order_amount)` -> `jsonb`

---

## 5. Active PostgreSQL Extensions

1. `pg_graphql` (1.5.11)
2. `pg_stat_statements` (1.10)
3. `pgcrypto` (1.3)
4. `pgjwt` (0.2.0)
5. `plpgsql` (1.0)
6. `supabase_vault` (0.3.1)
7. `uuid-ossp` (1.1)

---

## 6. QA Verification Matrix

| Test Suite | Test Type | Passed | Failed | Result |
|---|---|:---:|:---:|:---:|
| Backend QA Master Suite (`test_suite.js`) | End-to-End API / RBAC / Domain | 86 | 0 | **PASSED** |
| Backend Restart & Persistence (`restart_test.js`) | Cold Boot State Recovery | 12 | 0 | **PASSED** |
| Admin Bootstrap Suite (`bootstrap_test.js`) | Security & Rate-limiting | 8 | 0 | **PASSED** |
| Platform Smoke Suite (`smoke_test.js`) | Health & Readiness | 5 | 0 | **PASSED** |
| Payment Gateway Sandbox (`payment_sandbox_test.js`) | Order / Signature Verification | 9 | 0 | **PASSED** |
| Payment Production Audit (`payment_production_readiness_test.js`) | Tamper / Idempotency / Escrow | 11 | 0 | **PASSED** |
| Cloudinary Media Optimization (`cloudinary_test.js`) | Upload / KYC / Transformations | 17 | 0 | **PASSED** |
| Mobile Flutter Analysis (`flutter analyze`) | Static Analysis & Lint | 0 issues | 0 | **PASSED** |
| Mobile Flutter Unit & Screen Tests (`flutter test`) | Widget & App Flow Tests | 18 | 0 | **PASSED** |
| **Total Automated Tests** | | **166** | **0** | **100% PASS** |
