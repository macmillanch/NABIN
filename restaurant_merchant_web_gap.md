# NABIN Restaurant Merchant Web — gap audit

Audited from the code in `restaurant-merchant-web/` against `backend/src/server.js` and the
local PostgreSQL schema on 2026-09-21. Nothing here is inferred from file names.

Surface: Next.js + TypeScript, 14 source files, routes `/` (dashboard), `/login`, `/orders`,
`/menu`. Dev API base `http://localhost:4000/api`; production base `/api`.

## IMPLEMENTED (real data, real writes)

| Area | Evidence |
| --- | --- |
| Merchant sign-in | `POST /auth/send-otp` with `role: MERCHANT` then `POST /auth/verify-otp`; token stored under `nabin_restaurant_merchant_token`; `/auth/me` re-validates on load; `/auth/logout` revokes server-side. |
| Store dashboard | `GET /merchant/:id/dashboard`. Stats are recomputed client-side from the returned `orders` and filtered to `service_type === 'FOOD'`, so a hybrid store does not report grocery revenue as restaurant revenue (`app/page.tsx:33-46`). |
| Honest stat labels | "Open food orders", "Order value on record", "Food orders, all time" — no "today" claim, because the server's `todaySales` field actually sums all orders. |
| Order queue | `GET /merchant/orders` (token-scoped, no id guessing). |
| Order lifecycle | `POST /merchant/orders/:orderId/status`. `src/lib/orderFlow.ts` mirrors the PostgreSQL transition matrix and the server's `APPROVED_KDS_STATES` allow-list, so CANCELLED and PICKED_UP are deliberately absent from merchant buttons. |
| Rejection reasons | Reason is collected and forwarded; matches the server's approved reason list. |
| Menu read | `GET /merchant/catalog` → PostgreSQL `products` for the signed-in merchant. |
| Tenant isolation | Every route runs `authenticateMerchant` + `requireMerchantTenant`; the dashboard 403s when the path id is another store's. |

## PARTIAL

- **Menu page is read-only by design.** `app/menu/page.tsx:72` states in the UI that stock
  toggling "is not wired to a persistent endpoint yet". That is accurate:
  `POST /api/merchant/:restaurantId/menu/:itemId/toggle` mutates the in-memory store only, so a
  toggle would be lost on restart while `/merchant/catalog` reads PostgreSQL. Showing it would be
  a fake workflow, so it is disclosed instead.
- **Session survives reload but not expiry cleanly** — token is in `localStorage`; a 401 from
  `/auth/me` returns to `/login`, but there is no refresh path.

## MISSING

1. **Order detail route.** `/orders` is a flat list; there is no `/orders/[id]`, so line-level
   actions (fulfilled / unfulfilled / packed quantities) cannot be taken from the web.
2. **Menu item create / edit / price change.** No backend route exists for a merchant to write
   `products` at all — only `/api/admin/master-catalog` (admin-only) and the grocery inventory
   path. This is a backend gap as much as a UI gap.
3. **Store operating status toggle.** `merchants.is_open` exists in PostgreSQL; no merchant-facing
   write route exists, so the console shows the state read-only.
4. **Media upload UI.** `POST /api/merchant/media` and
   `POST /api/merchant/menu/:itemId/photo` exist server-side; no web screen calls them.
5. **Notifications, support, settings screens.** None exist.
6. **Profile edit.** `merchants` has no cuisines or delivery-time column, and no merchant profile
   update route, so the profile block is read-only.

## BLOCKED

- **Never built or deployed.** No CI workflow, Render/Vercel config, or Docker service references
  this app; it appears only in `.dockerignore:9` and `scripts/sync-tokens` style scripts. Until it
  has a build pipeline, "working locally" is the strongest true statement about it.
- **Production API base** is the relative `/api`, which needs a reverse proxy in front of the web
  app or an explicit `NEXT_PUBLIC_API_URL`. Not configured anywhere yet.

## Recommended next work, in order

1. `/orders/[id]` detail route reusing `src/lib/orderFlow.ts` (highest value, no backend change).
2. Decide the menu write path: either add `PUT /api/merchant/catalog/:id` writing PostgreSQL, or
   keep the menu read-only and remove the toggle promise from the copy.
3. Give the app a build/deploy definition, or state plainly that it is internal-only.
