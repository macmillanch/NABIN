# NABIN — Session Memory

**Updated**: 2026-09-21
**Mode**: Code written, verified, and committed locally as 4 atomic commits
(backend → mobile → web → docs). **Not pushed** — push needs its own approval.

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
- Git: HEAD `6494b25` is 1 ahead / 0 behind `origin/main` `9b2804c`. 40 tracked
  files modified, much untracked source, nothing committed this session.

## Verification commands that actually passed (2026-09-21, final tree)

- `cd mobile && flutter analyze --no-pub` → 68 issues, **0 errors, 0 warnings**
  (55 `prefer_const_constructors`, 12 `deprecated_member_use`,
  1 `prefer_const_literals_to_create_immutables`)
- `cd mobile && flutter test` → **18/18 passed**
- `node --check backend/src/server.js`; live curl on `:4000` for
  `/api/restaurants` (`count: 27`), `/api/grocery/products`
  (`count: 14`, `dataSource: postgres`)

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
