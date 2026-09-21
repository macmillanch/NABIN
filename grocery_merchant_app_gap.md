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
| Un-stocking a product | `DELETE /api/merchant/inventory/:masterProductId` → `db.deleteMerchantInventoryItem`. The store comes from the bearer token, so a URL id can only address the caller's own shelf. Verified live as `Test Supermarket M2`: stocked "Amul Taaza Milk" then removed it (`success`, re-read back to 1 row); removing the sold "Test Basmati Rice" row returns `400 · 2 orders already bought this product, so its listing stays on the record. Switch its availability off to stop selling it.` and the row survives; removing a product only another store stocks returns `400 · That product is not stocked in your store.` without leaking that store's order counts; an unknown id returns `400 · That product is not in the NABIN master grocery catalogue.`; no token returns `401`. The inventory screen's trash icon asks first and shows the refusal verbatim. |
| Merchant notifications | The event bus resolves a merchant recipient from `event.merchantId` (`merchants.id`, which `notifications.user_type` already allows for `MERCHANT` — no migration needed), the subscriber forwards `relatedEntityType`/`relatedEntityId` so a feed row can deep-link, and a non-duplicate insert is pushed to that store's sockets as `{type: 'NOTIFICATION', notification}`. Grocery checkout publishes `MERCHANT_NEW_GROCERY_ORDER`. Verified live: a raw `ws` client registered as `MERCHANT` received the frame for a real order `ORD-00000319` with `relatedEntityId` equal to the order id, and `GET /api/notifications` with a merchant token listed it (`userType: MERCHANT`, `unreadCount: 2`) and accepted `PUT /api/notifications/:id/read`. |

## PARTIAL

- **Order customer reference.** An order row carries only `customer_id`; there is no name, phone or
  address on it. The app shows the last 6 characters of the id as `#xxxxxx` rather than inventing a
  name. Resolving the real name needs a merchant-facing customer read route, which does not exist.
- **Dashboard refresh** is 30-second polling. No merchant WebSocket scope is wired into this app.

## MISSING

1. **Notification feed screen.** The backend now persists merchant-keyed notifications and pushes
   them over the socket (see IMPLEMENTED), but this app has no feed screen and `NabinWsService` has
   no `NOTIFICATION` case, so nothing consumes them. `GET /api/notifications` with a merchant token
   is ready to be read.
2. **Price history view.** `grocery_price_history` is written on every price change but has no read
   endpoint, so the app cannot show it. (Note: `GET /api/grocery/products/:id/history` reads the
   in-memory fixture store, not that table.)
3. **Store settings / operating status.** No endpoint to read or write a grocery store profile or
   its open/closed state, so the dashboard exposes three destinations that all work instead of a
   dead Settings tab.
4. **Support ticket screen** for merchants. Absent.

## NOTES FOR THE NEXT READER

- Merchant catalogue reads hand back placeholder artwork: `GET /api/merchant/inventory` returned
  `imageUrl: https://example.com/milk.jpg`, while the customer browse path nulls exactly those
  `example.com` hosts. Nothing renders it today, so it is invisible — but any future tile must not
  trust these URLs. The catalogue screen ignores `standard_image_url` for this reason.
- 11 of the 14 active master rows are duplicate "Test Basmati Rice" fixtures from earlier test
  runs, so a fresh store's "Not stocked" list is mostly noise until the seed data is cleaned up.
  They cannot simply be deleted: each is the only listing of its own `Test Supermarket M2` store, and
  `order_lines.grocery_inventory_id` is `ON DELETE RESTRICT` while `merchant_grocery_inventory.product_id`
  is `ON DELETE CASCADE` — 22 order lines sit behind those rows, so a `DELETE` on the master row is
  refused, and if it were not it would empty 11 stores and orphan order history. The owner has not
  yet chosen between `is_active = false` (reversible, but hides those stores' only product) and
  re-pointing the fixtures at one canonical rice row.

## BLOCKED

- **Dark-store and warehouse flows** are intentionally absent; `POST /api/grocery/checkout/validate`
  rejects any store id containing `darkstore` with `DARK_STORE_NOT_SUPPORTED`.
- **Bulk price adjustment** deliberately does *not* use
  `POST /api/grocery/products/bulk-price-update` — that endpoint mutates the in-memory fixture
  store. The price screen applies a percentage change as individual PostgreSQL-backed inventory
  writes instead, so the change persists and is audited.

## Recommended next work, in order

1. Add a read endpoint for `grocery_price_history` scoped to the signed-in store.
2. Build the merchant notifications screen on `GET /api/notifications`, and give `NabinWsService` a
   `NOTIFICATION` case so a live order can update the badge without polling.
3. Decide what to do with the duplicate "Test Basmati Rice" master rows (see NOTES) — deletion is
   blocked by `order_lines`' `ON DELETE RESTRICT`, so this needs an owner's call, not an improvisation.

Previously item 3 — "give the store a way to remove a stocked line" — shipped on 2026-09-21 as
`DELETE /api/merchant/inventory/:masterProductId`, and item 2 — resolving merchant notification
recipients — shipped as the event-bus merchant branch plus the socket push. Item 1 in the previous
list ("build add products on top of `/api/merchant/master-catalog` + `POST /api/merchant/inventory`")
shipped the same day as the `/catalogue` screen.
