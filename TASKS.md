# NABIN — Task Tracker

**Updated**: 2026-09-21
**Base**: `6494b25` (was 1 ahead of `origin/main` `9b2804c`, 0 behind). The 2026-09-21
work is committed as 4 atomic commits on top of it: backend, mobile, web, docs. **Not
pushed.**

## DONE (2026-09-20/21 sessions — grocery/food customer path + merchant apps)

- [x] `restaurant_merchant_web_gap.md` + `grocery_merchant_app_gap.md` — audits
      classified IMPLEMENTED / PARTIAL / MISSING / BLOCKED from actual code.
- [x] Backend made PostgreSQL-authoritative for the customer browse + cart paths:
      `/api/restaurants`, `/api/restaurants/:id`, `/api/restaurants/:id/menu`
      (27 real restaurants, was 1 fixture), `/api/grocery/products` (14 orderable
      rows from `merchant_grocery_inventory`, was 5 dark-store fixtures that
      `checkout/validate` rejects), `POST /api/grocery/cart/revalidate` (PG branch,
      echoes `productId`/`unit` back), `/api/advertisements` now labelled
      `dataSource: 'in_memory', persisted: false`.
- [x] Grocery checkout is store-scoped for real: `merchantId` threaded through
      cart lines → `grocery_checkout_screen.dart` payload (it previously sent
      none, so the server defaulted to `mcht_1` and no order could ever be
      placed). Multi-store baskets are blocked with an honest message.
- [x] Removed the fabricated demo basket + invented fees from the
      `/grocery-checkout` route; it now reads the live `groceryCartProvider`.
- [x] Zomato-style menu sections (grouped by real PG `category`) on
      `restaurant_menu_screen.dart`; Blinkit-style product grids + promo carousel
      on grocery. Veg markers hidden when PG has no veg column instead of
      defaulting every dish to non-veg; placeholder artwork (`example.com`,
      `placehold.co`, …) nulled out so no dead image frames.
- [x] Grocery Merchant dashboard was reading dashboard-only keys out of the
      orders endpoint → permanently `₹0`/`0`. Now calls
      `getMerchantDashboard()` and shows grocery-scoped, honestly labelled
      "Sales on record".
- [x] Live end-to-end proof against local PG: shelf → revalidate
      (`singleMerchant: true`, `dataSource: postgres`) → `CHECKOUT_SUCCESS`
      order `ORD-00000317` → closed through the merchant API
      (`RECEIVED → REJECTED`, reason `OTHER`, transition id returned).
- [x] Verification on the final tree: `flutter analyze --no-pub` → **68 issues,
      0 errors, 0 warnings** (all `prefer_const_constructors` /
      `deprecated_member_use` infos). `flutter test` → **18/18 passed**.

## DONE (2026-09-20 session)

- [x] Tool-verified repo inspection (git, routes, endpoints, manifests)
- [x] `nabin_repository_inventory.md` — 11 sections, evidence-based
- [x] `scratch/restaurant_merchant_web_manifest.json` — 20 screens, JSON-valid
- [x] `scratch/grocery_merchant_web_manifest.json` — 23 screens, JSON-valid
- [x] `nabin_234_implementation_gap.md` — COMPLETE (§0–§14), all 46 Customer IDs
      classified, 6 projects domain-classified, B1–B11 blocked register, M0 proposal

## PENDING USER APPROVAL (nothing below may start without explicit USER approval)

- [x] Commit the 2026-09-20/21 work in 4 atomic commits (approved 2026-09-21):
      backend → mobile → web (both merchant consoles + admin-web/customer-web) →
      docs. `backend/.env` and `.kilo/` were excluded; the 11 mangled/junk files at
      the repo root were deliberately left unstaged.
- [x] Fix the lint errors in the committed web apps (approved 2026-09-21): the 5
      `react-hooks/*` errors per merchant console, plus the same 3 in admin-web's new
      resource pages. Two were genuine code fixes (the session-restore effect set
      state synchronously; `useCallback` deps on `merchant?.id` made React Compiler
      bail on the whole component); the rest are explained narrow disables, because
      the rule cannot see through an `await`.
- [x] **Push** — done 2026-09-21: `9b2804c..dac61ec` fast-forwarded to
      `origin/main`, 5 commits (`e7a7d31` backend, `c35306d` mobile, `7c1fe53` web,
      `19c9041` docs, `dac61ec` lint fixes).
- [ ] admin-web logout still uses `window.location.href = '/'` (lint warning) — a
      hard redirect instead of `router.push`, left alone as out of scope.
- [ ] M0: web→backend port fix (`NEXT_PUBLIC_API_URL`, both merchant web apps) — §13.2 of gap report
- [ ] Junk root artifact deletion (mcp_out.txt, readme.txt, pasted-filename files)
- [ ] Dark-store/legacy fixture cleanup in `backend/src/database.js`
- [ ] Empty file `IMPLEMENTATION_PLAN.md` (0 bytes, untracked) — delete or fill in

## BACKLOG (ranked, each needs its own approval — gap report §13.4)

1. Grocery Merchant App: "add products from the master catalogue" UI
   (`getMerchantMasterCatalog` + `POST /api/merchant/inventory`) — largest
   remaining functional gap; a store cannot list what it has not adopted.
2. Durable advertising: `advertising_campaigns` is migrated but unused;
   `/api/advertisements` still serves non-persisted in-memory rows.
3. `grocery_price_history` read endpoint (data is written, never exposed).
4. Merchant notifications: `merchants.id` → `users.id` resolution.
5. Restaurant Merchant Web: `/orders/[id]` detail route + a persistent menu
   write path; no CI/Docker/deploy definition exists for either merchant web app.
6. Redis/table backing for OTP + rate limits (both in-memory, lost on restart).
7. Driver App phase plan (38 screens, largest surface gap).
8. Phase 16 remediation (mock KYC, VPA, atomic cancellation).
9. Per-screen manifest records for 186 screens (restores 234 auditability).
10. Real product/dish photography: `products.image_url` has 0 non-null rows and
    every `master_grocery_catalog.standard_image_url` is an `example.com`
    placeholder — the apps render letter tiles because there is nothing else.

## SUPABASE CONNECTION RECOVERY (2026-09-20)

- [x] Security: prior anon + service_role keys treated as compromised; user
      rotated keys via Dashboard → `backend/.env` directly. No secrets in
      chat/logs. `backend/.env` confirmed gitignored, untracked, no diff.
- [x] Masked probe: URL configured, anon set, service_role set (all
      non-placeholder). `SUPABASE_POSTGRES_LIVE=true`.
- [x] Network: DNS FAILURE (`ENOTFOUND`) → TCP 443 + HTTPS inherit failure.
      Case A (reachability), NOT auth. See
      `supabase_connection_recovery_report.md`.
- [x] Live check `backend/scripts/verify_supabase.js`: `configured: true,
      connected: false, error: 'TypeError: fetch failed',
      mode: 'POSTGRES_DISCONNECTED'` — consistent with DNS failure.
- Status: **BLOCKED — DNS FAILURE**. Do NOT rotate keys again yet.
- Next: user confirms project active/unpaused in Dashboard + Reference ID
  matches configured hostname; then re-run masked DNS → TCP → HTTPS → live
  check. Only after CONNECTED may Customer App work resume.
- Git note (corrected 2026-09-21): HEAD `6494b25` is **1 ahead / 0 behind**
  `origin/main` `9b2804c` — a normal fast-forward situation, not a divergence.
  Working tree has tracked modifications + many untracked files. No
  commit/push done (PLAN-ONLY).

## SUPABASE STATUS CORRECTION (2026-09-21)

The 2026-09-20 BLOCKED note above referred to the **hosted** Supabase project's
DNS. The **local Docker** stack (Supabase `:54321`, Postgres `:54322`) was
recovered that evening at the user's instruction and is now the working
database: backend `isLivePostgres` is true and `/api/restaurants`,
`/api/grocery/products`, `/api/grocery/cart/revalidate` all respond with
`dataSource: "postgres"`. The hosted test/production projects remain **not
touched** — per standing rule, never migrate or modify remote infrastructure
without explicit authorization.
