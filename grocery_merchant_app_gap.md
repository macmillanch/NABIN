# NABIN Grocery Merchant App — gap audit

Audited from `mobile/lib/features/grocery_merchant/` against `backend/src/server.js` and the local
PostgreSQL schema on 2026-09-21. Each IMPLEMENTED line below was exercised against the running
stack in this session, not read off a screen name.

Surface: Flutter app `main_grocery_merchant.dart`, 9 screens — splash, login, OTP, dashboard,
orders, order detail, inventory, master catalogue, price management.

## IMPLEMENTED (verified end to end this session)

| Area | Evidence |
| --- | --- |
| Sign-in | Real `POST /auth/send-otp` / `verify-otp` with `role: MERCHANT`; no demo token, no assumed merchant id. |
| Stock and price editing | `GET`/`POST /api/merchant/inventory` → `merchant_grocery_inventory`. Verified: read `Test Basmati Rice ₹120 / 50 kg / AVAILABLE`, write `{masterProductId, currentPrice: 127}`, re-read shows 127, `grocery_price_history` gains `120.00 → 127.00` attributed to `merchant:<id>`, restored to 120. |
| Price screen contract | Cards read `masterProductId`, `masterName`, `currentPrice`, `stockQty`, `unit`, `isAvailable` — the keys the API actually returns. The old screen read `price`/`quantity`/`productName`, so every field was blank and every write went nowhere. |
| Availability switch | No longer invents `quantity: 10` when switched on; sends `isAvailable` only. |
| Order queue | `GET /api/merchant/orders` (token-scoped). Filters use the real state set; `NEW` and `PICKING` do not exist and are gone. |
| Order actions | Accept / start packing / ready for handover come from `presentation/utils/grocery_order_flow.dart`, a Dart mirror of the PostgreSQL transition matrix and `APPROVED_KDS_STATES`. Verified live: `RECEIVED → REJECTED` with reason `OTHER` returned a `transitionId` and `order_state: REJECTED`. |
| Rejection reasons | Collected **and forwarded**; matches the server's approved list, so `INVALID_REJECTION_REASON` no longer fires. |
| Packed weight | `POST /api/grocery/orders/:id/packed-weight`, offered only for `g`/`kg`/`ml`/`litre` lines. |
| Failure reporting | Every write path now surfaces the server's `error` string; the previous `if (success) …` with no `else` silently swallowed rejections. |
| Dashboard | Now calls `GET /api/merchant/:id/dashboard`. It previously called the orders endpoint and read `todaySales`/`activeOrdersCount` from it — fields that response never contains — so both KPI tiles were permanently `₹0` / `0`. Figures are computed from GROCERY lines only and labelled "Sales on record", because the server field named `todaySales` actually sums all orders. |
| Session hygiene | Expired session shows "Your session has expired. Please sign in again." instead of falling back to a hard-coded `mcht_1`. Logout confirms and clears to `/login`. |
| Stocking a new product | `/catalogue` (`grocery_merchant_catalog_screen.dart`) diffs `GET /api/merchant/master-catalog` against `GET /api/merchant/inventory`, and a bottom sheet posts `{masterProductId, currentPrice, stockQty, isAvailable}` to `POST /api/merchant/inventory`. Verified live as `Test Supermarket M2`: the store held 1 of 14 master rows, "Amul Taaza Milk" was adopted at ₹42.50 / 25 and re-read as `status: AVAILABLE`, then removed so the seed state is unchanged. Reached from the inventory app bar and its empty state, which is now a real action rather than advice. The price field is required because `updateMerchantInventoryItem` lands an omitted `currentPrice` at 0. |

## PARTIAL

- **Order customer reference.** An order row carries only `customer_id`; there is no name, phone or
  address on it. The app shows the last 6 characters of the id as `#xxxxxx` rather than inventing a
  name. Resolving the real name needs a merchant-facing customer read route, which does not exist.
- **Dashboard refresh** is 30-second polling. No merchant WebSocket scope is wired into this app.

## MISSING

1. **Un-stocking a product.** `POST /api/merchant/inventory` upserts; there is no delete route. The
   catalogue screen's "List in my store" switch and a zero quantity get a row out of the customer's
   way (`INACTIVE` / `OUT_OF_STOCK`), but the row stays in the store. Nothing was lost while building
   this — it is the reason the live test row had to be removed directly from the local database.
2. **Price history view.** `grocery_price_history` is written on every price change but has no read
   endpoint, so the app cannot show it. (Note: `GET /api/grocery/products/:id/history` reads the
   in-memory fixture store, not that table.)
3. **Notification feed.** No merchant-facing route resolves: notifications are keyed by `users.id`
   while a merchant session entity is a `merchants.id`.
4. **Store settings / operating status.** No endpoint to read or write a grocery store profile or
   its open/closed state, so the dashboard exposes three destinations that all work instead of a
   dead Settings tab.
5. **Support ticket screen** for merchants. Absent.

## NOTES FOR THE NEXT READER

- Merchant catalogue reads hand back placeholder artwork: `GET /api/merchant/inventory` returned
  `imageUrl: https://example.com/milk.jpg`, while the customer browse path nulls exactly those
  `example.com` hosts. Nothing renders it today, so it is invisible — but any future tile must not
  trust these URLs. The catalogue screen ignores `standard_image_url` for this reason.
- 12 of the 14 active master rows are duplicate "Test Basmati Rice" fixtures from earlier test
  runs, so a fresh store's "Not stocked" list is mostly noise until the seed data is cleaned up.

## BLOCKED

- **Dark-store and warehouse flows** are intentionally absent; `POST /api/grocery/checkout/validate`
  rejects any store id containing `darkstore` with `DARK_STORE_NOT_SUPPORTED`.
- **Bulk price adjustment** deliberately does *not* use
  `POST /api/grocery/products/bulk-price-update` — that endpoint mutates the in-memory fixture
  store. The price screen applies a percentage change as individual PostgreSQL-backed inventory
  writes instead, so the change persists and is audited.

## Recommended next work, in order

1. Add a read endpoint for `grocery_price_history` scoped to the signed-in store.
2. Resolve merchant notifications by joining `merchants` to its owning `users` row.
3. Give the store a way to remove an stocked line, and clean the duplicate "Test Basmati Rice"
   master rows out of the seed data.

Previously item 1 — "build add products on top of `/api/merchant/master-catalog` +
`POST /api/merchant/inventory`" — shipped on 2026-09-21 as the `/catalogue` screen.
