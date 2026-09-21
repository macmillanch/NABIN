# NABIN Grocery Merchant Web

Store console for NABIN grocery partners. Interface 7 of 9 in the NABIN surface
set; it shares one token layer with the other web apps
(`customer-web/src/app/globals.css`, redistributed by
`scripts/sync-web-tokens.sh`) and is themed with `<body data-role="grocery">`.

## Run

```bash
npm install
npm run dev        # http://localhost:3003
```

The app talks to `http://localhost:4000/api` by default. Override with
`NEXT_PUBLIC_API_URL` if the backend runs elsewhere; the backend CORS
allowlist must contain this app's origin.

Sign in with a registered partner phone number and the OTP accepted for
`role: "MERCHANT"`. Merchants registered as `HYBRID_BOTH` appear in both this
console and the restaurant console; each app filters the shared order feed by
`service_type`, so this one only shows `GROCERY`.

## Screens

| Route | What it does |
| --- | --- |
| `/login` | Phone + OTP partner sign in |
| `/` | Store profile, open-order and value metrics, latest orders, OpenStreetMap location |
| `/orders` | Status-filtered queue with per-line packed-weight capture |
| `/inventory` | PostgreSQL-backed price, stock and listing editor plus stocking from the master catalogue |

## Backend contract

- `POST /api/auth/send-otp`, `POST /api/auth/verify-otp`, `GET /api/auth/me`, `POST /api/auth/logout`
- `GET /api/merchant/{id}/dashboard`
- `GET /api/merchant/orders?status=`
- `POST /api/merchant/orders/{id}/status`
- `GET /api/merchant/inventory`, `POST /api/merchant/inventory`
- `GET /api/merchant/master-catalog`
- `POST /api/grocery/orders/{id}/packed-weight`

Inventory writes go to `merchant_grocery_inventory` and are read back from
PostgreSQL, so the customer app sees them. A price change also appends to
`grocery_price_history`. `status` is derived server-side
(`INACTIVE` / `OUT_OF_STOCK` / `LOW_STOCK` at ≤20 / `AVAILABLE`).

Packed weight is capped in the form at the ordered quantity, which mirrors the
`packed_confirmed_quantity <= quantity` check that migration 018 enforces in
the database.

## Deliberate limitations

- **Polling, not push.** The queue refreshes every 15 seconds; the merchant
  WebSocket channel still keys on the legacy `rest_1` id while sessions carry
  the merchant's PostgreSQL UUID.
- **Metrics are all-time.** The dashboard endpoint has no date filter, and the
  page says so rather than labelling them "today".
- Maps use OpenStreetMap data through Leaflet with CARTO tiles and
  `tile.openstreetmap.org` as fallback. No map API key is required.
