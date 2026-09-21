# NABIN — Session Memory

**Updated**: 2026-09-21
**Mode**: Phase 1 + chaos audit complete, verified locally and **committed locally, NOT
pushed**. `origin/main` is still `c974fc9`, so `main` sits 2 commits ahead
(`904acd2` backend: app config + server-authoritative coupons; then this docs +
`backend/chaos_audit.js` commit). The earlier notes in this file about the
2026-09-21 push (`9b2804c..a03a28c`) describe the previous round.

## Durable facts

- ONE Flutter project (`mobile/`) with 5 role feature trees — NOT 5 apps. No Melos.
- Backend port is **4000** (`server.js`); both *customer/admin* web apps still
  hardcode `:3000/api` → their API calls fail. Proposed fix: `NEXT_PUBLIC_API_URL`
  (M0, unapproved). The two merchant web apps were built after this and share the
  same in-API-baseURL question.
- **Which backend store answers a request is now explicit**: the customer-facing
  read/write paths used by mobile run against **PostgreSQL** (`isLivePostgres` +
  service-role client) and label responses `dataSource: 'postgres'`. Fixture
  fallbacks must label `dataSource: 'fixture', degraded: true`. Advertising answers
  `dataSource: 'in_memory', persisted: false` — `advertising_campaigns` exists in
  migrations but no code reads it.
- Grocery orderability runs `merchant_grocery_inventory` → `master_grocery_catalog`.
  A GROCERY/HYBRID store can only sell what it has adopted into inventory; the
  14-row legacy fixture set all belonged to `mcht_darkstore_1`, which
  `checkout/validate` rejects with `DARK_STORE_NOT_SUPPORTED`.
- `orders` rows are immutable: `trg_orders_financial_record_guard` silently
  returns `DELETE 0`, so manual cleanup must go through the merchant state
  transition API — deleting child rows (`order_lines`) first leaves an
  orphaned order with 0 lines.
- There is **no photography in the database**: 0 non-null `products.image_url`
  and every `master_grocery_catalog.standard_image_url` is an `example.com`
  placeholder. The apps render letter/emoji tiles because that is the honest
  state; `PLACEHOLDER_IMAGE_HOSTS` exists in `server.js` to suppress them.
- PG has no vegetarian column for dishes, so `FoodMenuItem.isVeg` is
  deliberately `bool?` and the veg dot hides rather than guessing.
- Merchant web apps now **exist**: `restaurant-merchant-web/` (login, orders,
  menu) and `grocery-merchant-web/` (login, orders, inventory). Neither has
  CI, Docker or a deploy definition.
- Junk root artifacts exist (mcp_out.txt, readme.txt, pasted filenames) — delete
  only after approval. Never commit `.kilo/` or `backend/.env`.
- Supabase, 2026-09-21: the **local Docker** project is the live database for
  dev/bugfix. The earlier 2026-09-20 "BLOCKED — DNS FAILURE" note was about the
  **hosted** project; hosted test/production remain untouched and unverified.
  Keys were rotated 2026-09-20 (old ones compromised) — do not rotate again.
- Git: the 2026-09-20/21 work is committed on top of `6494b25` as 4 atomic commits
  (backend → mobile → web → docs, 134 files: 52 modified + 82 new). `backend/.env`
  and `.kilo/` are excluded; the ~11 mangled junk files at the repo root are left
  untracked on purpose. `origin/main` moved from `a03a28c` to `c974fc9` through the
  2026-09-21 follow-ups (master catalogue stocking, un-stock + merchant socket,
  rice fixture deactivation, notifications feed and their doc notes); the Phase 1 +
  chaos-audit work is committed locally on top of that and **not pushed**, so
  `main` is ahead of `origin/main` until you approve a push.
- `react-hooks/set-state-in-effect` in eslint-config-next cannot see through an
  `await`, so it flags every auth-gated "load on mount" effect even when all state
  updates are async. The repo's house answer is a narrow, explained
  `eslint-disable-next-line` at the call site (admin-web/src/app/page.tsx:1 does it
  file-wide). Do not restructure fetch-in-effect to chase this rule.

## Phase 1 (dynamic architecture) + chaos audit — durable facts (2026-09-21)

- Coupons at grocery checkout are server-authoritative: the server computes the
  discount through `validate_promotion_preview` (quote) and `redeem_promotion_atomic`
  (checkout, `FOR UPDATE`), and writes `checkouts.discount_amount`,
  `applied_promo_code`, `promotion_id`, `redemption_id`. A client-supplied
  `discount`/`finalTotal` is ignored, not trusted.
- `GET /api/app/config` (+ `/api/v1/app/config`) is the server-driven config feed:
  composed only from `platform_settings`, `promotions` and the service-state row,
  ETag/`If-None-Match` → 304, `serverTime` authoritative, and every section is
  validated to plain data (no code). Publishable keys live in the `APP_CONFIG_*`
  namespace; `FEATURE_*`, `PLATFORM_SERVICE_STATE`, `service_status` and
  `surge_multiplier` are reserved so the generic writer cannot clobber a killswitch.
  The `advertisements` section is a deliberate pointer that answers
  `durable: false` — that surface is still in-memory.
- Settlement is NOT idempotent: `POST /api/driver/complete-trip` under concurrency
  books one trip's earnings many times over while the job row stays correct. A
  clean job produces exactly 2 journal postings (₹2 × entitlement); 50 concurrent
  completions produced 98–100 postings and credited the driver wallet ~50× the
  entitlement. The double-entry stays internally balanced throughout, so
  header/line reconciliation cannot detect it — only a per-job entitlement
  invariant can (FI-08 in `backend/chaos_audit.js`).
- REST `/api/driver/location` accepts impossible fixes (lat 999, `lat:'abc'`,
  1899 timestamps, speed 1e9) that the WebSocket path rejects; the driver row is
  not poisoned, so it is a validation-parity gap, not corruption.
- Under a real database outage the backend stays up, health says
  `POSTGRES_DISCONNECTED`, `/api/app/config` serves `stale: true`, ads answer
  `persisted: false`, and the money path fails closed. Auth does not: OTP and
  admin login succeed from the in-memory fallback and hand out tokens that cannot
  be persisted, and outage-driven failures surface as business codes
  (`MERCHANT_NOT_FOUND`) rather than infrastructure codes.
- A hard `SIGKILL` mid-burst is clean: 97 issued checkouts, 33 HTTP 200s,
  and exactly 33 orders + 33 checkout rows + 33 `order_creation_tokens` rows.
  Idempotency for grocery checkout lives in `order_creation_tokens`, not in
  `checkouts.idempotency_key` (that column stays NULL on this path).
- Test-environment preconditions that are NOT defects: a full `test_suite.js` pass
  re-verifies the DRV-101/DRV-103 VPA, which sets a 24h payout cooling-off, so
  `chaos_audit.js` CH-06 can only run >24h after the suite; `globalSurgeMultiplier`
  persists across runs and must be reset to 1.0 through
  `POST /api/admin/pricing {"serviceType":"GLOBAL","globalSurgeMultiplier":1.0}`
  (resetting one service is not enough); the admin broadcast route allows
  1 per 15 minutes, so NOTIF-API-14/15 fail on rapid re-runs; OTP login allows a
  limited requests-per-phone window, so back-to-back harnesses on the same fixture
  phones produce spurious auth failures. Two more: the backend process must be
  started with `PAYMENT_WEBHOOK_SECRET=test_webhook_secret_not_for_deployment`
  (the value `test_suite.js:6` defaults to) or MODULE 18's two HMAC assertions fail
  with `INVALID_SIGNATURE` — keep it in the local process env, never in
  `backend/.env`; and never run two suites at once, they fight over the broadcast
  window and the fixture phones (a concurrent pair scored 305/3 where a solo clean
  run scores 307/1).
- Definitive local regression for this phase (2026-09-21, solo run with all
  preconditions above satisfied): `test_suite.js` **307 passed / 1 failed of 308**,
  exit 1; the single failure is the `gprod_5` data gap below. Baseline at `HEAD`
  with this phase's code removed: 269/11.
- `POST /api/grocery/cart/revalidate` + a cart containing `gprod_5` cannot pass
  while PostgreSQL is authoritative: PG stocks only `…0401` (Tomatoes) and
  `…0402` (Amul Taaza Milk); `gprod_1`/`gprod_3` are mapped in
  `LEGACY_GROCERY_PROD_MAP`, `gprod_5` is in-memory only — SQL confirms
  `master_grocery_catalog` has zero rows matching `%lays%`. This assertion already
  failed at `HEAD` (`269 passed / 11 failed`), so treat it as a known data gap,
  not a regression.

## Verification commands that actually passed (2026-09-21, final tree)

- `cd mobile && flutter analyze --no-pub` → 68 issues, **0 errors, 0 warnings**
  (55 `prefer_const_constructors`, 12 `deprecated_member_use`,
  1 `prefer_const_literals_to_create_immutables`)
- `cd mobile && flutter test` → **18/18 passed**
- `node --check backend/src/server.js`; live curl on `:4000` for
  `/api/restaurants` (`count: 27`), `/api/grocery/products`
  (`count: 3` since the rice duplicates were deactivated — Amul Taaza Milk, Farm
  Fresh Tomatoes, Test Basmati Rice — `dataSource: postgres`), `/api/app/config`
  (`HTTP 200`, `Cache-Control: public, max-age=30`, `ETag: W/"…"`, 15 feature flags)
- 2026-09-21 web pass: `npm run lint` clean in restaurant-merchant-web,
  grocery-merchant-web and customer-web; admin-web 0 errors / 1 warning
  (`window.location.href` logout redirect, left as-is deliberately).
  `tsc --noEmit` clean in all four. `npm run build` succeeds in both merchant apps.

## Tool lessons

- Editor rejects payloads >6000 chars — split edits.
- Two background agents editing `mobile/` at once cause Edit calls to fail on
  content that visibly matches — wait for writes to quiesce, then re-derive
  state from disk.
- `python3` is not on the PATH in this shell; a recursive `grep` over the repo
  times out in `node_modules`/`.next` — use the Grep tool.
- PowerShell quoting: avoid `$_`/`$_.Line`; prefer the Read and Grep tools over
  shell text processing.

## Continuation rule

Update TASKS.md + MEMORY.md before stopping. Ask before committing — a plan, a
recommendation, or a passing test is not approval.
