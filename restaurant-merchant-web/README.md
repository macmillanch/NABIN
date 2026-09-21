# NABIN Restaurant Merchant Web

Kitchen console for NABIN restaurant partners. Interface 5 of 9 in the NABIN
surface set; it shares one token layer with the other web apps
(`customer-web/src/app/globals.css`, redistributed by
`scripts/sync-web-tokens.sh`) and is themed with `<body data-role="restaurant">`.

## Run

```bash
npm install
npm run dev        # http://localhost:3002
```

The app talks to `http://localhost:4000/api` by default. Override with
`NEXT_PUBLIC_API_URL` if the backend runs elsewhere; the backend CORS
allowlist must contain this app's origin.

Sign in with a registered partner phone number and the OTP that
`POST /api/auth/verify-otp` accepts for `role: "MERCHANT"`. While the backend
runs outside `NODE_ENV=production` it returns the code as `testOtp`, and the
login screen surfaces it in a clearly-labelled development notice.

## Screens

| Route | What it does |
| --- | --- |
| `/login` | Phone + OTP partner sign in |
| `/` | Store profile, open-order and value metrics, latest orders, OpenStreetMap location |
| `/orders` | Status-filtered queue with legal transitions and rejection reasons |
| `/menu` | Read-only dish catalogue straight from PostgreSQL |

## Backend contract

Only endpoints that exist today are called:

- `POST /api/auth/send-otp`, `POST /api/auth/verify-otp`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/merchant/{id}/dashboard`
- `GET /api/merchant/orders?status=`
- `POST /api/merchant/orders/{id}/status`
- `GET /api/merchant/catalog`

Order status buttons are generated from `src/lib/orderFlow.ts`, which mirrors
`is_valid_order_transition` from `supabase/migrations/018_...sql` intersected
with the KDS allow-list in `backend/src/server.js`. The UI therefore never
offers CANCELLED or PICKED_UP to a kitchen, and an illegal write is refused by
the database rather than faked in the browser.

## Deliberate limitations

- **Polling, not push.** The queue refreshes every 15 seconds. The merchant
  WebSocket channel keys on the legacy `rest_1` id while sessions now carry the
  merchant's PostgreSQL UUID, so live events do not reach this client.
- **Menu is read-only.** `POST /api/merchant/{id}/menu/{itemId}/toggle` mutates
  the backend's in-memory restaurant, not the `products` table the order path
  reads, so editing here would silently not persist. It is left out on purpose.
- **Metrics are all-time.** The dashboard endpoint returns every stored order
  for the merchant with no date filter; the page labels the figures accordingly
  instead of calling them "today".
- Maps use OpenStreetMap data through Leaflet with CARTO tiles and
  `tile.openstreetmap.org` as fallback. No map API key is required.
