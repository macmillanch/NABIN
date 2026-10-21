# NABIN — Per-Service Backend Evidence (directive §6)

Run date: 2026-10-12. Repository HEAD: `a48c079` (branch `main`). Work item: `#277`.
Scope: the backend at `backend/`. This document answers one question for every service: **is the
behaviour a caller sees produced by the real Express route and the real PostgreSQL store, or by an
in-memory mirror or a mocked external boundary — and where it is mocked, what does that mock still
prove?**

---

## 0 · How this was measured, and what it is not

**Method.**

1. Every claim below cites `file:line`, and each cited line was re-opened and read on 2026-10-12 at
   the working-tree state above. No claim in this file is carried over from an older audit without
   being re-read — two claims in the working notes *were* wrong when re-checked, and both are
   corrected here (§2.1 and §2.13). The pass then caught nine further defects **in this report's own
   draft** — a wrong chain-link attribution, a miscounted write path, an overstated mock field among
   them; §7 lists all nine with their corrections.
2. Runtime evidence comes from the completed chain run
   `backend/.chain-logs/runs/chain_20261012_100741_13644_a9cc2b/` (`metadata.json`: 68 links, 68
   clean, 0 problems, 2782 checks reported, 2 skipped lines, exit 0, 848858 ms), which ran against
   the local Docker stack at `127.0.0.1:4000` under `scripts/with_local_target.js`.
3. Nothing here was produced by a hosted project. **Zero hosted reads, zero hosted writes, zero
   deployments.** No credential value was read or printed; §0.3 of the environment matrix in
   `NABIN_SUPABASE_ENVIRONMENT_MATRIX.md` remains the reference for which env var names exist.

**Label vocabulary used throughout.**

| Label | Meaning |
|---|---|
| **DURABLE** | The response a caller gets is produced by a write PostgreSQL accepted (`.insert` / `.update` / `.rpc`). If the store refuses, the caller is told. |
| **MIRROR** | The value lives in `src/database.js` process memory (`this.jobs`, `this.groceryProducts`, …) and its persistence is `save()` to a local file, not the database. A restart loses it. |
| **MOCKED BOUNDARY** | An external system (SMS, push, payment gateway, Cloudinary) is stood in for by an adapter, per directive §2. The logic around it is real. |
| **FAIL-CLOSED** | When the boundary is unavailable the code refuses and reports a refusal, rather than answering success. |
| **UNVERIFIED** | Source says it should work; nothing in this session or the chain run proves it end-to-end. |

**What this report is not.** It is not a production-readiness declaration. Directive §10 forbids
declaring readiness from passing local tests, and §6 forbids claiming a device or hosted test that
was not performed. Section 5 states precisely what the green chain run does and does not prove, and
section 8 gives the one truthful status line.

---

## 1 · The one switch that decides whether a service is "real"

Three gates, in order of blast radius:

| Gate | Line | Behaviour |
|---|---|---|
| Is a Supabase target configured? | `src/supabase.js:21-26` | `isConfigured` = URL + anon key present and not the placeholder strings. |
| Is the PostgreSQL book live? | `src/supabase.js:28` | `isLivePostgres = isConfigured && (SUPABASE_POSTGRES_LIVE === 'true' \|\| NODE_ENV === 'production')`. |
| Production with no database | `src/supabase.js:31-35` | **Throws at module load.** A production process cannot boot into the memory mirror. |

Every repository then gates its durable branch on `isLivePostgres && supabaseAdmin`. That pattern is
not incidental: all 19 files in `backend/src/repositories/` use it, so a service is durable *for that
call* exactly when the flag is true, and the same code path answers from the mirror when it is not.

Two consequences worth stating plainly:

- `src/supabase.js:86` returns `connected: true, ready: true, mode: 'DEVELOPMENT_LOCAL_MODE'` when a
  **dev** process has no database at all. That is a readiness report for a developer laptop, not
  evidence of a live store; the production sibling at `:84` returns
  `PRODUCTION_UNCONFIGURED_ERROR` with `connected: false`.
- `src/services/RuntimeMode.js:22-30` is the single gate for every developer convenience that weakens
  a security rule (fixed OTP, unauthenticated uploads, echoed codes). It is `NODE_ENV`-only, and the
  header comment at `:5-11` records why: six call sites previously wrote
  `NODE_ENV !== 'production' || NABIN_TEST_MODE === 'true'`, so a production environment carrying a
  leftover `NABIN_TEST_MODE=true` let anyone who typed `7729` log in as whoever they named. In
  production the flag is now ignored with a `console.error` and the convenience is refused.

---

## 2 · Service by service

### 2.1 Identity — OTP challenge, session, and the KYC documents question

| Step | Verdict | Evidence |
|---|---|---|
| OTP generation | **DURABLE-adjacent, correct** | `src/database.js:6512` generates the code; `:6504-6514` stores the challenge (attempts, lockout, 5-minute TTL) in the process-local `otpStore` Map declared at `:159`. A challenge is deliberately not durable — it is a short-lived secret, and the DB has no OTP table. |
| Fixed test code | **Gated** | `src/database.js:6509-6511` issues `7729` only to four known test numbers **and** only when `allowsTestConvenience('issuing a fixed OTP to a known test number')` is true, i.e. never in production (`src/services/RuntimeMode.js:23`). |
| Audit of the challenge | **DURABLE, fail-closed, worded as a request** | `src/database.js:6526-6550`: an `AUTH_OTP_REQUESTED` row is written before the SMS is sent and says so in its own reason line ("dispatch not yet attempted"); if that write is refused the in-memory challenge is **deleted** and the request throws (`:6538-6539`). No orphan challenge. |
| Audit of the outcome | **DURABLE, one row per outcome** | `src/database.js:6597-6625` writes `AUTH_OTP_DISPATCHED` only **after** the gateway has taken the send, and carries which gateway that was (`metadata.provider`, `metadata.providerMessageId`) — authoritative, so an unwritable record refuses the request and drops the challenge (`:6612-6614`). `:6549-6585` is the other half: a refused send writes `AUTH_OTP_DISPATCH_FAILED` with `success = false` and the refusal code first in `failure_reason`, best-effort so the gateway's own 502/503 still reaches the caller rather than being replaced by an audit error. Both outcome rows keep `new_state = OTP_PENDING`, because the code is still awaiting verification either way. Before this, one row named `AUTH_OTP_DISPATCHED` was written **before** the send, so every refused send left a success-shaped security record and no failure record — see F-10. |
| SMS dispatch failure | **Reported, not swallowed** | `src/database.js:6562-6595`: a dispatch failure propagates as the provider's own code (or `SMS_DISPATCH_FAILED`) with the provider's status, the comment at `:6543-6548` states the chosen trade-off (the code stays valid for its window) rather than hiding it, and the failure is now **recorded** as well as returned. |
| Session store | **DURABLE + revocation** | `backend/session_reconcile_pagination_test.js` is chain link 2 (38 checks) and `auth_failclosed_test.js` is link 8 (22 checks, exit 0) — the AUTH-10 case at link 8 is the one fixed under `#284`: a production `verifyAuthOtp` will not synthesise a session from a memorised code for a number nobody requested an OTP for. |
| **KYC document upload** | **FAIL-CLOSED (feature does not exist)** | `src/server.js:3674-3680` returns `400 IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED` whenever `aadhaarDocUrl` or `voterIdDocUrl` is present. |
| Document *preview* | **HONEST EMPTY, permission-gated** | `src/server.js:6946` serves `/docs/:filename` behind `authenticateAdmin` + `requirePermission('identity_documents.view')`, and the body it serves is a `NO DOCUMENT ON FILE` card (`:6948-6953`) that names no identity field and never echoes the requested filename. The comment at `:6937-6945` records what it replaced: a printed forgery — a name, a DOB, a Delhi address, `XXXX XXXX 4892` / `EPIC NO: DLH1948201` under a "✓ GOVERNMENT WATERMARK" line — which an examiner could approve against. |

**Correction #1 to the working notes, and it matters.** The notes carried "`identity_documents` has no
table". There **is** a table: `migrations/001_central_schema.sql:30-38`, with RLS enabled at `:273`
and SELECT/INSERT policies at `:289`/`:293`, and it is even permission-gated for admins
(`src/server.js:3786`, `:3813` read `identity_documents.view`). What is true is that **no code in
`src/` ever reads or writes it** — a grep for the relation across `src/*.js`, `src/repositories/`,
`src/services/` returns only permission identifiers and comments. The applications themselves live on
the mirror: seeded at `src/database.js:230`, updated at `:3703`, inserted at `:3735`, and reloaded
from the local file at `:1655`. So the correct statement is *table exists, zero writers, intake is
mirror-only, document upload is refused at the boundary* — which is a documented gap, not a silent
one, because the route says so in the error code.

### 2.2 Ride

| Path | Verdict | Evidence |
|---|---|---|
| Booking write | **DURABLE, propagation now honest** | `src/repositories/JobRepository.js:349-352` inserts the job under `isLivePostgres`. The `#279` fix (chain link 68) makes a rejected write propagate instead of returning a mirror copy. |
| Driver offer / accept | **DURABLE RPC** | `src/repositories/DispatchRepository.js:75`, `:176`, `:265`; assignment is the atomic RPC `accept_job_assignment_atomic` at `JobRepository.js:419-420`. |
| State transitions | **DURABLE RPC** | `JobRepository.js:438-452` update path; fan-out is bounded (the `#163` fix, 16 concurrent offer writes). |
| Fare/distance | **DERIVED, not defaulted** | `src/server.js:3529-3549` requires the caller to send `distanceKm` through `requiredLength` — the `#158` fix removed the `Number(distanceKm) || 4.0` completion. Distance itself comes from `geoPolicy.distanceKmBetween` at `src/server.js:91`, duration from `tripDurationMins` at `:102-103`. |
| Idempotency | **MIRROR read + NON-UNIQUE index** — see §4 F-5 | Route-level dedupe reads `db.jobs` at `src/server.js:3938`; the durable side is `migrations/005_jobs_domain.sql:13-16`, a plain **btree**, not unique. |

### 2.3 Parcel

Same repository and routes as ride (`src/server.js:4167-4173` is the parcel booking twin of the ride
route), so everything in §2.2 applies. One parcel-specific surface is the delivery-proof photo upload,
which is **not** on the same auth footing — see §4 F-8.

### 2.4 Food (restaurant)

| Path | Verdict | Evidence |
|---|---|---|
| Menu read/write | **DURABLE** | `src/repositories/RestaurantCatalogRepository.js:202-205`, `:246-248`, `:458-461`, `:691-694`, `:744-746`, `:785-787` all operate on `products` under `isLivePostgres`. |
| Order placement | **DURABLE, atomic** | `src/repositories/OrderRepository.js:521-536` calls `create_order_with_lines_atomic`; a store error is thrown, not caught into a success (`:536-539`). |
| Order state | **DURABLE RPC** | `OrderRepository.js:600` (`_transition_order_state_internal`), `:627` (`expire_stale_orders`). |
| Merchant dashboard | **REAL READ** | Chain links 21 (`merchant_operations_test.js`, 93 checks) and 44 (`merchant_tenant_isolation_test.js`, 30 checks) are green; the Flutter R04 work confirmed outage semantics answer `0/0/[]` rather than inventing numbers. |
| Dish **write** (create/edit/delete a dish) | **NOT PROVEN / limited** | The R10/R06 finding stands: the merchant app exposes no verified dish-intake write path, and the KDS advance is limited to states the real enum allows. |
### 2.5 Grocery

Grocery has the sharpest split in the codebase, because two price paths exist and they do not meet.

| Path | Verdict | Evidence |
|---|---|---|
| Customer catalogue read | **DURABLE** | `src/server.js:7043-7051` queries `merchant_grocery_inventory` joined to `master_grocery_catalog` and orders by the stored `store_price`. |
| Merchant single price update | **DURABLE** | `src/server.js:7122` → `db.updateMerchantListingPrice` (`src/database.js:5360-5461`), which reads the merchant-scoped listing (`:5383-5384`), updates `store_price` (`:5401-5402`), and inserts `grocery_price_history` (`:5422`). The route comment at `src/server.js:7113-7121` records the whole reason: it *used* to call the mirror method, so a real listing id (always a UUID) could never be priced while a mirror fixture id answered 200 and wrote a permanent `audit_logs` row about a change that touched nothing. |
| Merchant bulk price update | **DURABLE** | `src/server.js:7582-7589` → `bulkUpdateMerchantListingPrices`, and it labels its own source: `dataSource: 'postgres'` at `:7589`. |
| Degraded-mode pricing | **FAIL-CLOSED** | `src/database.js:5371-5376` refuses with `GROCERY_DEGRADED_READ_ONLY` when there is no durable store; the mirror path holds the same rule at `:5595-5600` (DECISION C1: refuse before anything, including the audit row, is written). |
| **Admin price review (FREEZE / UNFREEZE / CORRECT)** | **MIRROR** — see §4 F-4 | `src/server.js:7975-7985` → `db.adminReviewPrice` (`src/database.js:5764-5823`) sets `product.priceStatus` on the in-memory object (`:5795`, `:5797`, `:5806`) and writes an audit row (`:5809`). Nothing in that method touches `merchant_grocery_inventory`. **No branch of it reaches a durable write**: the `CORRECT` branch (`:5798-5807`) delegates to `updateGroceryProductPrice` at `:5799`, which is itself the mirror method (`:5615` `product.currentPrice`, `:5634` `this.groceryPriceHistory`, `:5637` `createAuditLog`), and the mirror method refuses outright when the store is not live (`:5595-5600`). So a freeze, an unfreeze and an admin price correction all answer success while the durable `store_price` the customer reads is unchanged. **`#274` closed the input half of this on 2026-10-13, not the durable half.** An `action` outside the three the method implements — or a `CORRECT` carrying no `newPrice` — used to fall through every branch, write `ADMIN_PRICE_<whatever the caller sent>` into the durable trail, and answer `{ success: true, product }`; it now refuses before the product lookup (`:5776-5788`, `GROCERY_PRICE_REVIEW_ACTION_INVALID` and `GROCERY_PRICE_REVIEW_CORRECT_PRICE_REQUIRED`, both 400), and the route's **pre-existing** catch puts that status and code on the wire (`src/server.js:7986-7994` — unchanged by this cycle; read from `git show HEAD`, it already propagated `err.status`/`err.code`). Durability remains D-4's decision, and the cost is now measured: **there is no `price_status` column in the store at all** — a read-only `information_schema.columns` query on the local Docker PostgreSQL names `store_price` on `merchant_grocery_inventory` and nothing else — so making a freeze durable is a migration, not an assignment. |

### 2.6 Payments

| Path | Verdict | Evidence |
|---|---|---|
| Session persistence | **DURABLE** | `src/repositories/PaymentRepository.js:110-128` inserts the `payment_sessions` row before anything else; `:104-109` states the invariant — the row *is* the checkout, and `payment_sessions.order_id` is UNIQUE, so a refusal means the session cannot be captured later. |
| Capture | **DURABLE RPC** | `capturePaymentAtomic` → `PaymentRepository.js:249-255` calls the migration-006 RPC with `p_signature_valid`. |
| Refund | **DURABLE RPC** | Both the repository (`:857-881`) and the admin route (`src/server.js:2392-2400`) call `refund_payment_atomic`; a repository error is thrown, and the offline case answers `{ success: false, error: 'Database unavailable' }` at `:882` rather than pretending. |
| **Checkout signature** | **REAL crypto, FAIL-CLOSED** | `PaymentRepository.js:468-499`: the HMAC key is read from `PAYMENT_KEY_SECRET` **and nowhere else** (`:474`); a missing secret is a `503 PAYMENT_VERIFIER_UNCONFIGURED` (`:475-483`) because answering `INVALID_SIGNATURE` would blame the customer for the operator's config; the comparison is `crypto.timingSafeEqual` with an explicit length check (`:491-494`). The comment at `:469-473` records that a file-resident fallback secret used to let any reader of the repository sign a paid trip. |
| Webhook authenticity | **REAL, FAIL-CLOSED** | `src/server.js:8896-8912`: `PAYMENT_WEBHOOK_SECRET` is required, a missing secret refuses with a logged line at `:8901`, and the expected value is an HMAC-SHA256 over the raw payload. |
| **Live mode** | **MOCKED BOUNDARY, and mislabelled** — see §4 F-1 | `PaymentRepository.js:76-83`: `PAYMENT_MODE=live` only requires keys to exist; the "gateway order id" is minted locally as `order_rzp_live_<ts>_<rand>`, and `:97` records `provider: 'RAZORPAY_LIVE'`. No HTTP request to a payment provider exists anywhere in this repository. |

### 2.7 Wallet and double-entry ledger

| Path | Verdict | Evidence |
|---|---|---|
| Wallet movement | **DURABLE RPC** | `src/repositories/LedgerRepository.js:268-272` calls `adjust_wallet_atomic`, which writes the balanced `journal_transactions` / `journal_lines` pair (migration 007, `migrations/007_wallets_domain.sql:28-29` for the key lookup, `:84-86` for the POSTED row). |
| Idempotency | **REAL conflict detection** | `LedgerRepository.js:249-266`: a reused key is compared field-by-field (`:259-262`) and a mismatch **throws** `idempotencyConflict` (`:263`) instead of being swallowed as "already done". The E2 comment at `:250-256` explains that the UNIQUE index guarantees no double movement, and the refusal is what tells the integration it is mis-keyed. |
| Offline fallback | **MIRROR, labelled as such** | `LedgerRepository.js:393-406` is commented "Fallback solely for offline local development without PostgreSQL" and only mutates `users`/`drivers` balances. |
| Cache vs book | **Honest split** | `src/database.js:4462-4469`: the driver's cached balance is only credited when `!earnings.posted`, because `adjust_wallet_atomic` already returned the authoritative balance — that guard is what stopped the double-count. |
| **Second book** | **UNRECONCILED** — see §6 | `capture_payment_atomic` writes `ledger_entries`; `recordDoubleEntry` writes `journal_transactions`/`journal_lines`. No job reconciles them. Chain link 34 (`finance_ledger_double_entry_authority_test.js`, 14 checks) pins each book's own invariants; nothing pins the two against each other. This is BLK-07's last open exit item and it is an owner ruling, not a code fix. |

### 2.8 Driver earnings and payouts

| Path | Verdict | Evidence |
|---|---|---|
| Earnings settlement | **DURABLE via the ledger** | `src/repositories/DriverRepository.js:348-361` routes the credit through `ledgerRepo.adjustWallet` with `CUSTOMER_WALLET_LIABILITY` → `DRIVER_EARNINGS_PAYABLE` and a business-derived idempotency key. `IDEMPOTENT_SKIPPED` returns `posted: false` (`:363-369`) so the caller does not stack a second posting; a successful posting returns `posted: true` (`:376`). |
| Non-durable driver identity | **FAIL-CLOSED** | `DriverRepository.js:386-392` throws `DRIVER_NOT_DURABLE`: an id that resolves to no `drivers` row cannot be credited by editing the mirror. The mirror credit at `:394-396` is reachable only with no PostgreSQL at all. |
| Payout | **DURABLE insert** | `src/database.js:4654-4663` inserts `driver_payouts` under `isLivePostgres`, and `:4657-4664` now **checks** the insert error: the ledger has already moved the money at that point, so a refused record is reported as `recordInconsistent: true` with the error named, not dropped. The `#280` fix sits one level up, in the ride settlement: `src/database.js:4411-4421` lets every throw out of `updateEarnings` (`DRIVER_NOT_FOUND`, `MONEY_OPERATION_IDENTITY_REQUIRED`, `DRIVER_NOT_DURABLE`, the idempotency conflict, the wallet store's own failure) abort, because read as a notice it left `earnings` at `{duplicate:false, posted:false}` — the offline-mirror answer — and the settlement went on to book a NET journal entry the refused RPC never made. |
| Payout authority | **DURABLE, proven** | Chain links 33/35 — `finance_driver_settlements_authority_test.js` (12 checks) and `finance_driver_payout_authority_test.js` (21 checks) — both exit 0 in the 68-link run. The `#280` abort itself is witnessed at link 26 (`driver_cache_miss_test.js`, 11 checks), which pins CMISS-03/04: a money call returns a posted result or fails loudly rather than returning `null`. No link asserts the multi-refusal list above end-to-end; that is a source reading, not a tested one. |

### 2.9 Support tickets

| Path | Verdict | Evidence |
|---|---|---|
| Ticket write | **DURABLE** | `src/repositories/SupportTicketRepository.js` has one ticket `.insert(` (`:345`) and four ticket `.update(` paths (`:623`, `:702`, `:796`, `:981`), all behind `isLivePostgres` (the `.update(` at `:937` is a driver-record write, not a ticket one); `backend/support_bounty_atomicity_test.js` is chain link 31 (29 checks, exit 0) and proves the ticket + bounty move together. |
| Refund through support | **DURABLE RPC** | `src/server.js:2392-2400` (see §2.6 refund row) threads `p_ticket_id` into the atomic refund. |
| Wallet refund, in-memory branch | **MIRROR** | `src/database.js:2931-2940` still has the mirror path that mutates `user.walletBalance` and unshifts a `TXN-…` row; it is the degraded-mode branch, and the durable branch is the one the chain exercises. |
| **Hard-coded ticket fallback** | **DEFECT** — see §4 F-7 | `SupportTicketRepository.js:931-933`: if no driver uuid was resolved, the ticket numbered `TCK-9479` is silently attributed to `drv_2`, and that attribution then drives a suspension at `:936-940`. |

### 2.10 Notifications (in-app) and delivery records

| Path | Verdict | Evidence |
|---|---|---|
| Notification write | **DURABLE** | `src/repositories/NotificationRepository.js:417` opens the live branch; four inserts and eight updates across the file, and chain link 59 (`notification_write_guard_test.js`, 60 checks, 81249 ms) pins that a rejected write cannot answer success — the `23505`-with-no-row case was a fake 200. |
| Enum clamping | **REAL validation at the boundary** | `NotificationRepository.js:412-414` clamps `userType`, `priority` and `channel` to their allowed vocabularies rather than persisting arbitrary strings. |
| Delivery record | **DURABLE, provider-labelled** | `NotificationRepository.js:805-830` inserts into the delivery table with `provider` defaulting to `MOCK_SANDBOX` (`:811`, `:826`) and `status` defaulting to `SENT` (`:817`); `delivered_at` is only stamped when the status actually is `DELIVERED` (`:830`). |
| Audience vocabulary | **OPEN** | The broadcast audience values are not backed by any column (owner decision `#242`); the write path persists what it is told. |

### 2.11 Push delivery (FCM)

This is the boundary the directive's §2 cares about most, and it now behaves.

| Path | Verdict | Evidence |
|---|---|---|
| Sandbox adapter in production | **FAIL-CLOSED** | `src/services/PushNotificationService.js:28-35`: the `MOCK_SANDBOX` provider returns `success: false` with `PUSH_GATEWAY_NOT_CONFIGURED` when `isProduction()`. The header at `:8-14` records the prior defect — production instances with no Firebase credentials recorded `DELIVERED` rows for notifications that were never sent. |
| Real FCM dispatch | **DOES NOT EXIST** | `:118-125` returns `PUSH_DELIVERY_NOT_IMPLEMENTED` — "this build has no FCM dispatch path, so no device was contacted". No credential in this session can change that; it is a code gap, not a config gap. |
| No device token | **HONEST SKIP** | `:253-262` lands a `SKIPPED` delivery row with `NO_ACTIVE_DEVICE_TOKEN` and returns `delivered: false`. |
| Regression | **PROVEN** | Chain link 66 (push-truthfulness suite) is green in the 68-link run; the `PDT-A0` tripwire pins that no `DELIVERED` row appears without a dispatch. |

### 2.12 SMS gateway

| Path | Verdict | Evidence |
|---|---|---|
| Real providers | **PRESENT, UNEXERCISED** | FAST2SMS (`:311-312`) and Twilio (`:313-314`) dispatch paths exist and their env-var requirements are declared at `:330-331`. No credential was used in this session, so neither path has been proven to deliver. |
| Production with no provider | **FAIL-CLOSED** | `src/services/SmsGatewayService.js:279-287`: an **unset** `SMS_PROVIDER` in production throws `SMS_GATEWAY_NOT_CONFIGURED` (503) before any dispatch. |
| Production with `SMS_PROVIDER=CONSOLE` | **FAIL-CLOSED — fixed 2026-10-12, was F-2** | `:259` still lists `CONSOLE` as a recognised declared value, but `:269-277` now throws `SMS_MOCK_PROVIDER_FORBIDDEN` (503) when `CONSOLE` is declared under `isProduction()`, before `:290` can return it and `:315-317` can reach `_dispatchConsole` — the adapter that returns `delivered: true` at `:92` having sent nothing. Pinned by `sms_gateway_test.js` SMS-026…SMS-031 (hermetic) and `auth_failclosed_test.js` AUTH-18 (chain link 8, end-to-end through `sendAuthOtp`). |
| Chain proof | **PROVEN, as far as it can go** | Link 12 (`test_phase7_security.js`, 48 checks) and link 8 (`auth_failclosed_test.js`, 22 checks since AUTH-19…AUTH-24 were added for F-10; 16 with AUTH-18, 15 at the `#284` pair) are the pair. The 48 → from 41 total movement was two added assertions **plus** modules 9 onward running for the first time after a fatal, and the printed line now names the legal outcome it measured (`Production sendAuthOtp refused to simulate delivery (SMS_GATEWAY_NOT_CONFIGURED), so nothing was echoed`) instead of claiming a property over a response that was never returned. |

### 2.13 Media and storage

**Correction #2 to the working notes.** The notes carried "media assets have no table and are
process-only". The *asset registry* is indeed process-only — `src/database.js:9340-9388` upserts into
`this.mediaAssets`, appends a `MEDIA_ASSET_SAVED` audit row, and calls `this.save()`; there is no
`media_assets` relation in any migration. But **stored bytes do have a real home**: Supabase Storage.

| Path | Verdict | Evidence |
|---|---|---|
| Supabase Storage upload | **DURABLE** | `src/services/supabaseStorageService.js:251-256` calls `client.storage.from(bucket).upload(...)` when configured, and `:290-297` rethrows the upload error on **both** branches — production at `:292-294` and local at `:296` — so a storage failure never answers success. |
| Supabase Storage, unconfigured | **MOCKED BOUNDARY** | `:300-322` returns a `supabase-mock.nabin.local` URL with `mock: true`; removal at `:355` answers `{ success: true, removed: [path], mock: true }`; health at `:361-368` reports `mode: 'MOCK_SANDBOX'`, `ready: false` — the honest one of the two adapters. |
| Cloudinary image upload | **MOCKED BOUNDARY, answers success** — see §4 F-3 | `src/services/cloudinaryService.js:140-157`: with no credentials (`:9` requires cloud name + key + secret) it returns `success: true` with `mock: true`, an **invented** `width: 800` (`:151`) and `height: 600` (`:152`), while the byte count keeps whatever the caller supplied and only falls back (`bytes: bytes \|\| 45000` at `:153`; video `bytes \|\| 1500000` at `:210`). Delete at `:244-246` returns `success: true, result: 'ok'`. |
| Cloudinary, unconfigured, *signed* uploads | **FAIL-CLOSED — the counter-example** | `:256-259`: `generateSignedUploadParams` **throws** when the credentials are missing, inside the same file whose `uploadImage`/`uploadVideo` answer `success: true`. The two behaviours are inconsistent, and the throwing one shows the refuse-and-report shape was already available to the upload paths. |
| Cloudinary URL minting | **COSMETIC** | `:84` falls back to the literal cloud name `nabin-media`, so `generateOptimizedUrl` (`:103`) will happily build `https://res.cloudinary.com/nabin-media/…` for a cloud that does not exist. The caller cannot tell that from the URL. |
| Asset registry | **MIRROR** | `src/database.js:9366-9372` upserts the in-memory array. |

### 2.14 Geocoding, maps, pricing

| Path | Verdict | Evidence |
|---|---|---|
| Address → coordinates | **DOES NOT EXIST, and says so** | `src/server.js:3512-3519` answers `resolved: false` with `reason: 'NO_GEOCODER'` and echoes the caller's own coordinates back. There is no geocoding provider env var anywhere in the inventory. |
| Distance | **DERIVED from coordinates** | `src/server.js:91` `geoPolicy.distanceKmBetween`. |
| Duration | **MODELLED, labelled** | `src/server.js:102-103` `Math.max(3, round(distanceKm / AVERAGE_CITY_SPEED_KMPH * 60))` — a flat-average-speed model, not traffic data. |
| Surge / geofence | **PRICING-ONLY** | No service-area enforcement exists; the fence only affects price (recorded in project memory `nabin-geofencing-is-pricing-only`). |
| Map tiles | **OSM by owner rule** | `flutter_map` / Leaflet everywhere; no key-based SDK. |

### 2.15 Admin surface, permissions and audit

| Path | Verdict | Evidence |
|---|---|---|
| Permission gate | **REAL, per-permission** | `src/server.js:3786`, `:3813` gate unmasked identity fields on `identity_documents.view`; `src/adminPermissions.js:61`, `:75` declare the identifiers. |
| Admin status route | **Strips the engine's words** | `src/server.js:8001-8009`: `const { error, ...safeStatus } = status` — the raw error is logged (`:8003`) and never reaches the client. |
| Audit write | **DURABLE, fail-closed** | Chain link 17 (`admin_audit_fail_closed_test.js`, 90 checks, exit 0) proves a refused audit record aborts the action; link 14 (`admin_authorization_test.js`, 114 checks) pins the matrix itself, and its own printed line reads `AUTHORISATION MATRIX: 114 PASSED, 0 FAILED (Total: 114)`. |
| Admin password reset | **REAL hash compare** | `src/database.js:5843-5848` uses `crypto.scryptSync` + `timingSafeEqual` with an explicit length guard before comparing. |
| Test login credential | **Known value, no seed** | `superadmin` / `AdminPassword123!` is the credential the **test suites** sign in with (`admin_authorization_test.js:81`, `admin_customers_test.js:53`, `admin_identity_gates_test.js:69`, `admin_settings_surface_test.js:49`, `admin_account_revocability_test.js:47`, `customer_ride_projection_test.js:72`, `bootstrap_test.js:117`) and the fallback in `backend/chaos_audit.js:109` and `:429` (`process.env.ADMIN_BOOTSTRAP_PASSWORD \|\| 'AdminPassword123!'`). Grepping it across `backend/src/` and `backend/migrations/` returns **zero** hits, so this document does **not** claim a seeded superadmin row exists — that would be a local/CI bootstrap effect, not a source fact. What is a source fact is the exposure: any hosted instance that carries this credential, however it got there, is reachable by anyone who has read this repository. |

---

## 3 · The mocked-boundary inventory, and what each mock still proves

Directive §2 permits mocking only what is genuinely unavailable, and requires the logic *around* the
mock to be real. There are exactly four such boundaries in this backend. Nothing else that has a real
implementation is mocked.

| Boundary | Adapter | Real logic that still runs around it | Production behaviour with no credentials |
|---|---|---|---|
| Payment gateway | No adapter exists at all — order ids are minted locally (`PaymentRepository.js:81-83`) | Order validation, session row, UNIQUE order id, HMAC signature check, atomic capture RPC, webhook signature check, ledger posting, idempotency conflict refusal | 503 `PAYMENT_VERIFIER_UNCONFIGURED` at `:475-483` — refuses rather than accepting an unverifiable payment |
| SMS | `CONSOLE` (`SmsGatewayService.js:89-93`) | OTP generation, lockout, TTL, the challenge-then-outcome audit order (`database.js:6526-6550` before the send, `:6587-6615` after it), the failure classification and its own audit row at `database.js:6562-6595` | Refuses an unset `SMS_PROVIDER` (`:279-287`) **and**, since 2026-10-12, a declared `CONSOLE` (`:269-277`); see F-2 |
| Push (FCM) | `MOCK_SANDBOX` (`PushNotificationService.js:16-21`) | Token lookup, preference check, delivery-row writing, retry classification | `PUSH_GATEWAY_NOT_CONFIGURED` (`:28-35`) and `PUSH_DELIVERY_NOT_IMPLEMENTED` (`:118-125`) |
| Media storage | Cloudinary unconfigured branch (`cloudinaryService.js:140-157`) and Supabase Storage unconfigured branch (`supabaseStorageService.js:300-322`) | Upload validation, folder sanitising, mime allowlist, tenant ownership, the menu-photo contract | **Answers success** with `mock: true`; see F-3 |

Two rules from the directive are worth checking against that table rather than assuming:

- *"A mock payment must still validate the order, enforce idempotency, persist state and preserve
  ledger correctness."* — **Met.** All four hold in §2.6 and §2.7, and each is pinned by a suite
  (`money_idempotency_test.js` 24 checks and `money_idempotency_conflict_test.js` 19 checks are chain
  links 22 and 29, both exit 0).
- *"Never allow mock payment or OTP adapters to run in production."* — **Met for push, met for the
  payment signature path, and met for SMS since 2026-10-12** (it was **not** met when the operator
  declared `SMS_PROVIDER=CONSOLE` explicitly; that gap was F-2 and is fixed at the root, with the
  measures recorded in §4 and §7). F-2 was the only item in this report that contradicted the directive
  on its own terms rather than describing an unfinished feature.

---

## 4 · Findings that contradict a rule — the directive's or the code's own

Severity here means distance from a stated rule, not estimated business impact.

**F-1 · `PAYMENT_MODE=live` mints provider claims with no gateway call. (High)**
`PaymentRepository.js:76-83` accepts live mode on the presence of two env vars and then builds
`order_rzp_live_<epoch>_<6 chars>` in-process; `:97` persists `provider: 'RAZORPAY_LIVE'` and `:87`
persists the production key id. Nothing in `src/` opens a socket to a payment provider. A row written
in this mode is indistinguishable, in the table and in every read model, from one the gateway created.
Directive §2 says *"Clearly label simulated payments; never represent them as real captured funds"* —
this represents them as exactly that. Owner decision required (provider selection is explicitly the
owner's under §7, so this cannot be fixed by choosing a gateway on their behalf).

**F-2 · An explicit `SMS_PROVIDER=CONSOLE` ran a mock OTP adapter in production. (High — FIXED 2026-10-12, `#286`)**
`SmsGatewayService.js:259` admits `CONSOLE` as a valid declared value; before this cycle the production
refusal at `:279-287` fired only when `!declared`, `:290` returned the declared value, and `:315-317`
dispatched to the console adapter, which returns `delivered: true` at `:92` having sent nothing. The
file's own header states the opposite intent ("an incorrect OTP arriving silently … is a security
failure, not a graceful degradation"), and the directive says never allow mock OTP adapters in
production. The correction is the one the finding named: `:269-277` refuses `CONSOLE` when
`isProduction()` with `SMS_MOCK_PROVIDER_FORBIDDEN` (503) before any adapter is chosen, and the header
and `resolveProvider` docstring now say so ("Declaring the mock is not configuring a gateway — it only
looks like success."). Measures: `sms_gateway_test.js` **27 passed / 3 failed RED** — `SMS-026` (no throw), `SMS-028` (the
dispatch answering `delivered: true`) and `SMS-031` (`gatewayStatus().ready === true`) — **→ 32 / 0
GREEN**, its baseline before the new section being 26/0, so no pre-existing assertion moved and
`SMS-030` proves the development `CONSOLE` path still dispatches.
chain link 8 `auth_failclosed_test.js` **16 / 0** including the new end-to-end AUTH-18, which runs
`sendAuthOtp` in a `NODE_ENV=production` process and requires the refusal, `claimedSuccess === false`
and no echoed code; neighbours that read the same refusal path are unmoved (`test_phase7_security.js`
48/0, `push_delivery_truthfulness_test.js` 20/0 with PDT-F50 still green). Nothing was declared
`CONSOLE` in a production-mode process to manufacture a green, and the development CONSOLE path still
dispatches (SMS-030) — the guard is production-only. BLK-03 (real DLT/SMS credentials) stays open:
this closes the door a mock could be walked through, it does not deliver an SMS.
**Witness left by the fix's own regression check:** AUTH-18's child wrote one durable
`AUTH_OTP_DISPATCHED` audit row for `+919876500077` in the local Docker stack before the dispatch was
refused (`select … from audit_logs where target_entity_id='+919876500077'` → 1 row at
2026-10-12T06:46:20Z). That is the audit-before-dispatch ordering named in §2.9 and §3, now observed
rather than reasoned about: the row asserts a dispatch that did not happen. It is left in place —
audit rows are the record a delete guard exists to protect, and deleting one is an owner action, not a
cleanup. That row is what the code did **then**; F-10, closed later the same day, is why the same child
now lands `AUTH_OTP_REQUESTED` plus `AUTH_OTP_DISPATCH_FAILED` and no dispatch row at all.

**F-3 · Unconfigured storage answers 200 success. (Medium, already an owner decision: `#249`)**
`cloudinaryService.js:140-157` returns `success: true` with invented dimensions (`width: 800`,
`height: 600`) and a fallback byte count (`bytes: bytes \|\| 45000`); `:244-246` returns
`success: true, result: 'ok'` for a delete that deleted nothing; `:84` will mint a URL for a cloud named
`nabin-media` that does not exist. `supabaseStorageService.js:300-322` and `:355` do the same for the
storage bucket, though its health probe at `:361-368` at least reports
`ready: false, mode: 'MOCK_SANDBOX'`. Every mock result carries `mock: true`, so the caller *can* tell
— but no route forwards that field, so the client never sees it. The same file already knows the other
answer: `:256-259` **throws** when signed-upload params are requested without credentials (§2.13).

**F-4 · Admin grocery price review writes only the mirror. (Medium, tracked as `#274` — input half closed 2026-10-13, durable half still D-4)**
§2.5. The admin is told `{ success: true, product }` (`server.js:7985`) for a FREEZE that changed
process-local state and an audit row. A price freeze that does not survive the process is not a freeze,
and the `CORRECT` branch is not an escape hatch: it delegates to the mirror method
(`database.js:5799` → `:5615`/`:5634`/`:5637`), so the price the customer's catalogue read is served from
(`merchant_grocery_inventory.store_price`) is unchanged by all three actions. **What changed on 2026-10-13**
is the second, separable defect inside the same method: an unimplemented `action` (and a `CORRECT` with no
`newPrice`) reached the fall-through end of the branch chain, so the route reported a successful review and
`audit_logs` gained a durable `ADMIN_PRICE_<the caller's own word>` row for a review that changed nothing —
a trail that asserts an action it never performed, on the same boundary that D-4 is still deciding. That
now refuses at `database.js:5776-5788`, before the product lookup, with a code and a 400 the route passes through
rather than swallows. The refusal shape was measured over HTTP against the **local** store: six refusal
bodies (unknown action, absent action, lower-case `freeze`, `CORRECT` with no price, a 200-character
action, unknown action on an absent product) each answered **400** with the code, `audit_logs` moved by
**0** rows across the whole probe, and zero probe-named rows existed afterwards. **F-4's headline claim is
unchanged**: FREEZE, UNFREEZE and CORRECT still answer success from the mirror.

**F-5 · Booking idempotency has no durable uniqueness. (Medium)**
`server.js:3938` and `:4169` dedupe by scanning the in-memory `db.jobs`; the only durable trace is
`migrations/005_jobs_domain.sql:13-16`, a **non-unique** btree over `metadata->>'idempotencyKey'`.
Compare the ledger, where `migrations/002_finance_ledger_schema.sql:37`/`:66`/`:90` and
`009_promotions_domain.sql:47` make the key `UNIQUE` and the RPC reads it. Under two concurrent
bookings — or any two processes — the mirror check is not a guarantee. Single-process dev hides this.

**F-6 · Identity intake is mirror-only while the table sits empty. (Medium, documented)**
§2.1. Not a hidden defect: the route refuses documents with a named code, and the gap is recorded. It
does mean the KYC "application" a reviewer sees is not durable data. The mitigation that does exist is
the preview at `server.js:6946` — permission-gated and deliberately blank — which replaced a printed
forgery; the gap is now "no document can be held", not "a fake one is shown".

**F-7 · A hard-coded ticket number resolves to a hard-coded driver, and that drives a sanction. (Medium)**
`SupportTicketRepository.js:931-933` maps `TCK-9479` → `drv_2` when no driver was resolved, and
`:936-940` will suspend that driver on it. Fixture logic in a write path that can take someone's
livelihood offline.

**F-8 · Two media routes authenticate by hand-parsing the header, and dev skips auth entirely. (Low in
production, High in dev-shared stacks)**
`server.js:9042` (`POST /api/media/upload`) has no auth middleware at all. `server.js:9622-9638`
(`/api/parcel/:id/delivery-proof`) parses the bearer manually, requires DRIVER/ADMIN when a token is
present, and at `:9636` allows **no token** when `allowsTestConvenience` is true. In production both
close (`RuntimeMode.js:23`) — the upload route remains unauthenticated in production too, which is the
known open finding in project memory.

**F-9 · The two books are not reconciled. (High, owner ruling pending)**
§2.7. `ledger_entries` and `journal_transactions`/`journal_lines` are both written, by different code
paths, with no reconciliation job. This is BLK-07's remaining exit item.

**F-10 · `AUTH_OTP_DISPATCHED` was written before the send, so a refused send left a success-shaped security record. (High — FIXED 2026-10-12, `#288`)**
`sendAuthOtp` audited exactly one row, before calling the gateway, and named it `AUTH_OTP_DISPATCHED`
with the reason "Verification OTP dispatched … Expires in 5 minutes." The dispatch result was
discarded, and nothing was written on the failure path. So every refused send — no provider configured,
the mock refused in production (F-2), a 502 from a real gateway — left a durable `AUTH` row asserting a
delivery no handset ever received, with `success = true`, and left no record of the refusal. The whole
trail was measured rather than argued: **7,753** `AUTH_OTP%` rows, **one** action name, **every row
`success = true`**, and no dispatch-failure outcome anywhere in the table (§7). Directive §6 says a
client must not report success when the backend rejects; this is the same fault one layer down — the
*audit trail* reporting a security event that did not happen, on the login path, where an operator
reconciles OTP activity.

The correction is wording plus one row per outcome, not a reordering: the pre-dispatch write stays (so an
audit outage still spends no SMS and leaves no challenge, which AUTH-13 pins), it is renamed
`AUTH_OTP_REQUESTED` with a reason that says the dispatch has not been attempted, and the send's result
now lands `AUTH_OTP_DISPATCHED` (authoritative, carrying the provider and its `messageId` in `metadata`)
or `AUTH_OTP_DISPATCH_FAILED` (`success: false`, refusal code first in `failure_reason`, best-effort so
the gateway's 502/503 still reaches the caller). Rate limiting, lockout, the 5-minute retention of a
challenge after an SMS failure, and the delete-on-unwritable-record behaviour are untouched — no
control was weakened to make the trail accurate. Measures: `auth_failclosed_test.js` **18 PASSED /
4 FAILED RED** (AUTH-19/20/22/23) **→ 22 / 0 GREEN**, with the two new children driving the *real*
gateway boundary (a production process with no provider is refused for real; a development process with
`CONSOLE` dispatches for real) rather than a stubbed provider, and AUTH-24 requiring that no field of
either row carries the minted code. Neighbours re-run, not assumed: link 12 **48 / 0**,
`sms_gateway_test.js` **32 / 0**, link 66 **20 / 0**. The durable side was measured with a read-only
`pg` query: a development dispatch against the live local store now writes
`AUTH_OTP_REQUESTED` then `AUTH_OTP_DISPATCHED` with `metadata = {"provider":"CONSOLE",
"providerMessageId":"CONSOLE-…"}`, and a refused production send writes `AUTH_OTP_REQUESTED` then
`AUTH_OTP_DISPATCH_FAILED` with `success = false` — see §7.

What this does **not** change: the 7,753 rows written before it are still in the local store reading
"dispatched" for sends that were refused, and they are historical records, not a live defect — reading
that action name across 2026-10-12 and earlier therefore needs this finding as its caveat. And a
`success`-shaped claim surviving an outage is not unique to OTP: §2.10/§2.11 cover the notification and
push paths, where the equivalent fault (a fabricated `DELIVERED` row) was fixed under `#276` by writing
`PENDING` before dispatch and the real outcome after. This finding is that pattern applied to the one
security path that was still asserting before it acted.

**F-11 · The campaign console painted nothing, printed `₹NaN.00`, and reported a guaranteed 400 as "deployed live". (Medium — FIXED 2026-10-13, `#294`)**
Same fault as F-10 one layer further out — a *client* asserting a result the backend never confirmed — on
the admin surface an operator uses to run ads. Measured in the shipped file, not argued:

- The row template did `ad.bidRateCpm.toFixed(2)`, and `mapRowToDTO` answers `null` for that field by
  design (no bid-rate column exists; the route's own `monetization.reason` says so). A `TypeError` thrown
  inside `Array.map()` was swallowed by `loadPromotions`' own `catch (e) { console.warn(…) }`, so the
  campaign table painted **0 rows over the 3 durable campaigns** in the local store. Verified in a real
  browser against the HEAD snapshot: `tbody rows=0`, and the page logged
  `TypeError: Cannot read properties of null (reading 'toFixed')` at `old_dash.html:4224:93`, twice.
- The Revenue KPI read `m.adRevenueEstimate`, which `GET /api/admin/advertisements` **deliberately never
  sends**, and printed `₹NaN.00`.
- Both write payloads named 7 keys from the repository's own `UNSUPPORTED_FIELDS` list
  (`brand, tagline, industryCategory, sponsorBadge, service, ctaText, bidRateCpm`), so **every** create
  and edit was a guaranteed `400 ADVERTISEMENT_FIELD_UNSUPPORTED` — and the handler's success branch keys
  on `data.success` alone, so the operator was told it was "deployed live". Measured live against the
  real route: old body → `status=400 code=ADVERTISEMENT_FIELD_UNSUPPORTED`.
- `toInsert` additionally requires `imageUrl`, `startDate`, `endDate`, which the modals had no input for;
  2 of the 5 placement options (`GROCERY_CHECKOUT_CARD`, `RIDE_TRACKING_SPONSOR`) resolve to `null`; and
  `openEditAdModal` prefilled 7 invented defaults into fields the store cannot hold.

The correction is client-only: no route, no authorization, no contract was touched. The bid cell now
renders `—` for the by-design null (`:4190`); the revenue tile shows a figure **only if the route sends
one** and otherwise puts the route's own `monetization.reason` in the caption (`:4164-4169`); the invented
columns, the 7 unsupported payload keys and the 7 invented prefill defaults are gone; the modal inputs now
supply the three fields `toInsert` requires; and a shared `adStoreNotice(data, doneVerb, consequence)`
helper (`:4218`) derives every message — for the create, edit, toggle and delete handlers — from the
`persisted` / `dataSource` / `degraded` flags the backend had always sent. Measures: the new guard
`admin_campaign_contract_test.js` (CAMPAIGN-00…-10) is **RED 3/11 (exit 1, 8 named failure sites)**
against `git show HEAD:admin_dashboard.html` and **GREEN 11/11 (exit 0)** against the working tree;
`admin_console_xss_test.js` **12/12** unchanged (XSS-01 still counts 274 interpolated values across 80
templates); the live write contract against the local Docker target answers
`status=200 persisted=true dataSource=postgres` for both new bodies (§7); and the same browser harness
after the fix reads `tbody rows=3`, revenue `—` with the route's reason, `NaN anywhere false`,
**0 page exceptions**. Full chain after registration: **73 links, 73 clean, 0 problems, 2,911 checks,
exit 0** (§7).

What this does **not** fix, and was filed rather than silently patched: the three editorial captions under
the KPI tiles (`#297`), the master-catalogue SKU alert that claims success while ignoring `persisted`
(`#296`), and the grocery price-audit feed that calls a removed route and falls back to three invented rows
(`#295`). It also records a contract fact: `DELETE /api/admin/advertisements/:id` returns the deleted
**row object** in `deleted`, not a boolean — the client only tests `data.success`, so no incorrect claim
resulted, and my own probe's first assertion was the thing that was wrong.

---

## 5 · Passed vs unverified

**What the 2026-10-12 chain run proves.** `chain_20261012_100741_13644_a9cc2b` at HEAD `a48c079`
against `127.0.0.1:4000`: 68 links, **68 clean, 0 problems, 2782 checks reported, 2 skipped lines,
exit 0**, 848858 ms. Concretely, that buys: durable money invariants (link 22
`money_idempotency_test.js` — 24 checks; link 24 `financial_authority_test.js` — 62; link 29
`money_idempotency_conflict_test.js` — 19; links 31-37 — the support-bounty and finance-authority pair,
29/12/12/14/21/14/16 checks), the ledger write guard (**link 67**
`ledger_write_guard_test.js`, 32 checks — not link 34, which is `finance_ledger_double_entry_authority_test.js`
with 14 checks and pins each book's own invariants), booking-write propagation and the duplicate-mirror
fix (link 68 `booking_write_guard_test.js`, 20 checks), the `#280` no-silent-notice contract (link 26
`driver_cache_miss_test.js`, 11 checks — see §2.8 for what it does and does not cover), the split-target
refusals (links 14 and 23 both green **inside** a chain for the first time: cash ratchet prints
`Phase 14 cash audit ratchet totals: 22 passed, 0 failed, 0 skipped` with CR-05 reading a real
`jobs` row, and admin cleanup prints `CLN-03 provisioned=4 removed=4` with `admin_accounts 2402 →
2398`), the production OTP fail-closed pair (links 8 and 12), the no-substitution geo guarantee
(**link 54 only**, `place_substitution_test.js`, 19 checks and 1 skipped line — link 53 is this
document's own citation guard, 8 checks), the notification write guard (link 59, 60 checks) and the
push-truthfulness tripwire (link 66, 20 checks). The run's 2 skipped lines are link 25
(`driver_earnings_identity_audit_test.js`, 32 checks) and link 54.

**Superseded as the current chain record, 2026-10-13.** The numbers above stay as that run measured
them; the latest full execution is `chain_20261013_023614_76484_7e98e2`, wrapped
(`node scripts/with_local_target.js node scripts/test_chain.js`) against the local Docker store:
**72/72 links clean, 0 problems, 2877 explicit passing checks, 2 standing skips**, `teardown: pid
79164 reaped, :4000 free`. In that run link **67** `ledger_write_guard_test.js` reports **34 checks**
rather than 32 — `#264` added DEC-12 (a settled ride leaves the rider's reported wallet balance
untouched, measured `{"delta":0,"before":5000,"after":5000}`) and DEC-13 (every
`user.walletBalance` assignment inside the settlement slice must be `!isLivePostgres`-guarded,
measured `{"riderAssigns":1,"guardedRiderAssigns":1,"slice":3034}`), and de-pinned DEC-09, which had
been asserting `delta.userWallet === -500` and so had been *pinning the defect* rather than the
contract. See `docs/NABIN_RELEASE_BLOCKERS.md` §BLK-07's `#264` entry and the Sprint Log's Action 45
checkpoint for what that debit was and why no book contained it. Everything in "what it cannot prove"
below still applies unchanged to the newer run: it is local, it is not staging, and BLK-02/03/04 are
still open.

**What it cannot prove, and no local run can.**

1. **Any real external delivery.** No SMS was sent, no push reached a device, no payment was captured,
   no file landed in Cloudinary or a Supabase bucket. Links 8/12 measure the *refusal*; that is the
   honest ceiling without credentials. The `AUTH_OTP_DISPATCHED` row is no exception — F-10 moved it
   *after* the send and made it name the provider, but every one of them ever written still came from
   the `CONSOLE` adapter's `delivered: true`, which is
   a print statement, not a carrier receipt. The row is now honest about *which* provider answered; no
   row yet proves a provider delivered anything.
2. **Any hosted-project behaviour.** The hosted TEST project's grants, RLS and migration state
   (033-038) are a separate question from anything measured here, and directive §3 explicitly refuses
   to infer one from the other.
3. **Multi-process correctness.** A single harness on `:4000` cannot expose F-5, and the append-only
   drift counters are the run's own residue report, not a concurrency proof.
4. **Client truthfulness on a device.** No Flutter widget test substitutes for a device run; project
   memory records the UI cycle's remaining `#258`/`#260`/`#262` items as open.
5. **Suite totals are advisory.** The runner's own footnote warns that `passed=` is its parse of suite
   output while `exit=` is the authority; the cash suite reports 44 advisory against its own printed
   22 because both `PASSED` and `✅` marks are counted. This report quotes a suite's own printed line
   where one exists.

---

## 6 · Owner decisions this report needs

Nothing below is fixable by an agent without crossing a line the directive drew.

| # | Decision | Why it is the owner's |
|---|---|---|
| D-1 | Payment provider selection (§7 of the directive reserves this) and, until then, whether F-1 should stop labelling rows `RAZORPAY_LIVE` | Choosing a gateway is explicitly not the agent's call; relabelling is a contract change |
| D-2 | ~~F-2: should `SMS_PROVIDER=CONSOLE` be refused in production outright~~ **No decision needed — resolved in `#286`** | Directive §2 states it as an absolute ("never allow mock … OTP adapters to run in production"), so refusing it was the code's obligation, not an owner preference. Landed as `SMS_MOCK_PROVIDER_FORBIDDEN` (503) at `:269-277`; see F-2 and §7 |
| D-3 | `#249` / F-3: unconfigured storage answering 200 | Contract change on upload routes |
| D-4 | `#274` / F-4: **only the durable half remains** — admin price review → durable `store_price`, or the route removed. The refusal-shape half (an unimplemented `action` reporting success and minting `ADMIN_PRICE_<caller's word>` in the trail) was closed 2026-10-13 and needed no decision. Three options, with their measured costs: **(a)** add `price_status` to `merchant_grocery_inventory` and hydrate — a **migration** ("ask first"), and it also needs `groceryProducts` hydrated, since the mirror is the only place `priceStatus` lives today; **(b)** point the route at the durable listing the customer reads — FREEZE/UNFREEZE then have **no column to write**, so it degenerates to CORRECT-only, i.e. a feature cut on an admin surface; **(c)** delete the route — cheapest, and honest: **no client anywhere in the repository calls it** (grep for the review path across `admin-web/src`, `mobile/lib`, `admin_dashboard.html` returns only backend test fixtures), and the one place the admin console reads the field — `admin_dashboard.html:6727-6728` renders `p.priceStatus === 'FROZEN'` — is fed by `GET /api/grocery/products` (registered at `src/server.js:8615`, projection at `:7043`), which carries `currentPrice` from `store_price` and **no** `priceStatus` at all, so a freeze is invisible in the admin UI even today | Behaviour change on an admin surface |
| D-5 | F-5: add a UNIQUE durable idempotency constraint on `jobs` (a migration) | Migrations are an "ask first" action |
| D-6 | F-9: reconcile `ledger_entries` against `journal_*`, or collapse onto one book | BLK-07's last exit item |
| D-7 | Whether `test_chain.js` should drop-or-refuse a leaked `chain_scratch` schema at boot — **and, newly separable, whether a refused isolated link should abort the chain or let the remaining links continue** | Harness policy, raised under `#285`. The **isolation-refusal** defect filed in this family (`#293`) was closed 2026-10-13 without a decision, because a runner spawning a link outside the isolation it labels is a harness integrity fault, not a policy preference: the fix only converts a fabricated outcome into an honest refusal and can never turn a red into a green. The two questions above genuinely change what the chain *does*, so they stay here |
| D-8 | `#242` audience vocabulary, `#252` offer-fan-out cost, `#261` merchant-web CORS + token logging, `#266` matrix corrections, `#272`/`#273` route authorization — **inventory now derived and enumerated** (239 paths; of 88 `/api/admin` paths 69 role-keyed, 16 identity-only = 12 catalogue reads + 3 in-handler authorizers + `/api/admin/me` which is self-scoped, 3 unguarded = bootstrap + login + a route that authenticates in its handler; so the admin finding is **horizontal across five admin roles, not anonymous**), **the media half costed** (zero client callers; `resolveMediaCaller` `:8355` already exists), **and least-privilege now has a measured shape**: 24 of 38 admin GET registrations already carry a key, 9 of the 12 can reuse a key or role check the matrix grants, and only `/metrics`, `/jobs`, `/supabase-status` would need a new one — so the choice per surface is authenticate-and-scope or delete, BLK-02's unattributed hosted claims | Each already documented with its evidence |
| D-9 | `#294`'s delivery boundary: how the admin console is meant to be reached. Measured 2026-10-13 — the backend serves **no** static route (`express.static`/`sendFile`: zero hits across `backend/src/`), so `admin_dashboard.html` has no server; and the CORS allowlist is exact origins, so opening the file directly makes every call cross-origin from a `file://` page. Probed directly: `API_BASE` (`admin_dashboard.html:3241`) falls back to `http://localhost:4000`, the origin is `file://`, and health, admin login and a relative call all threw `TypeError: Failed to fetch` — the page loads and nothing on it can reach the backend. A non-listed origin is answered `500 {code:'INTERNAL_ERROR'}`; rendering the same file over the allowlisted `http://127.0.0.1:5000` is what made F-11's before/after measurable at all. 178 of the file's `fetch` calls are bare relative paths, so they resolve only when it is served from an http origin at all | Making it work is either a **new static route** or a **CORS allowlist change**, and §4 puts both in "ask first"; the F-11 fix changed no contract, so it is deliberately silent on this |

---

## 7 · Verification record (measured on 2026-10-12)

| Command (run from `backend/`) | Result |
|---|---|
| `node scripts/with_local_target.js node scripts/test_chain.js` | 68 links, 68 clean, 0 problems, 2782 checks reported, 2 skipped lines, exit 0 |
| `node scripts/with_local_target.js node scripts/test_chain.js` — **re-run after the F-10 correction** | `chain_20261012_134303_53804_ee8534`, HEAD `a48c079`, 13:43:03 → 13:55:39 IST (756,220 ms): **68 links, 68 clean, 0 problems, 2,789 checks, 2 skipped lines, exit 0**. Diffed per link against the 12:40 run above: the only difference in the whole chain is **link 8 `auth_failclosed_test.js` 16 → 22**, which is AUTH-19…AUTH-24, and the total moved by exactly **+6** — the six added checks, with no test counted twice. Links 12 (48), 53 (8), 57 (44) and 66 (20) unmoved; the same two suites account for both skipped lines; 0 contamination flags, 0 non-zero exits. **One flag moved that is not a pass:** link 8 now prints `OTP_THROTTLED` (link 57 carries it in both runs) — the next four rows show it is the runner's substring heuristic meeting the new action name, not a rate limit. **The cost the change bought is in the drift lines:** link 8's `public.audit_logs` drift went from `237885 → 237887 (+2)` to `239206 → 239212 (+6)` for the same suite, because a request now writes a challenge row **and** an outcome row. Afterwards: **0** `chain_scratch` schemas, **0** listeners on `:4000`, teardown `pid 31708 reaped`. This is the no-regression evidence the product-file change needed |
| `node scripts/with_local_target.js node scripts/test_chain.js` — **re-run after the F-2 correction** | `chain_20261012_124047_53036_afa4a8`, HEAD `a48c079`, 12:40:47 → 12:53:21 IST (754,144 ms): **68 links, 68 clean, 0 problems, 2,783 checks, 2 skipped lines, exit 0**. Diffed per link against the run above: the only difference in the whole chain is **link 8 `auth_failclosed_test.js` 15 → 16**, which is AUTH-18. Link 12 (48), link 53 (8), link 66 (20) unmoved; the same two suites account for both skipped lines (25 `driver_earnings_identity_audit_test.js`, 54 `place_substitution_test.js`); the one `otpThrottled` link (57 `customer_order_read_reliability_test.js`) is flagged in **both** runs, so it is not caused by this change; 0 contamination flags, 0 non-zero exits. Afterwards: **0** `chain_scratch` schemas, **0** listeners on `:4000`. This is the no-regression evidence the product-file change needed |
| `select action, count(*) from public.audit_logs where action like 'AUTH_OTP%' group by action` (read-only, local Docker stack) | **7,753** rows, and they are **all one action**: `AUTH_OTP_DISPATCHED`, `module = AUTH`, every row `success = true`, `new_state = OTP_PENDING`. There is no `AUTH_OTP_DISPATCH_FAILED` — or any other dispatch outcome — anywhere in the durable trail. The two rows for `+919876500077` (`06:46:20Z`, `07:13:15Z` — one per chain run's link 8, which is why Action 34's "1 row" is not a total) both read "Verification OTP dispatched for CUSTOMER LOGIN flow" for requests that answered **503 `SMS_MOCK_PROVIDER_FORBIDDEN`** having sent nothing. The audit-before-dispatch ordering described in §2.12 is therefore **measured, not reasoned**: a refused send still lands a successful dispatch record, and the `success` column that could carry the failure is already written and already `true` on every row. **This is the pre-F-10 measurement and it is what F-10 was opened on** |
| `node scripts/with_local_target.js node auth_failclosed_test.js` — **F-10 RED, before the fix** | **18 PASSED / 4 FAILED**, exit 1. The four reds were exactly the claims the defect made: `AUTH-19` (`a send the gateway refused is audited as refused … actions=["AUTH_OTP_DISPATCHED"]`), `AUTH-20` (no `AUTH_OTP_DISPATCH_FAILED` row exists at all, `row=null`), `AUTH-22` and `AUTH-23` (a *refused* send still produced a row claiming `action: AUTH_OTP_DISPATCHED`, `success: true`, reason "Verification OTP dispatched for CUSTOMER LOGIN flow. Expires in 5 minutes."). `AUTH-21` and `AUTH-24` were green before the fix, because the caller-facing refusal and the no-code-in-the-trail property were already correct — the defect was only what the trail asserted. AUTH-00…AUTH-18 all still passed, including AUTH-13 (`code=AUTH_AUDIT_STORE_UNAVAILABLE, status=503, left=false`), so the fix's RED did not come from a broken neighbour |
| `node scripts/with_local_target.js node auth_failclosed_test.js` (chain link 8) — **F-10 GREEN, after the fix** | **22 PASSED / 0 FAILED**, exit 0. The two new children run the **real** gateway boundary, not a stub: a `NODE_ENV=production` process with no `SMS_PROVIDER` is refused for real (`SMS_GATEWAY_NOT_CONFIGURED` / 503 → `AUTH_OTP_REQUESTED` + `AUTH_OTP_DISPATCH_FAILED`, no dispatch row, challenge retained), and a development process with `CONSOLE` dispatches for real (`AUTH_OTP_REQUESTED` then `AUTH_OTP_DISPATCHED`, in that order, the dispatch row naming `CONSOLE`). AUTH-24 now serialises each whole entry and requires the minted code to appear in **no** field of it, matched as a JSON string value so a millisecond receipt id cannot trip it |
| Durable rows after the fix (read-only `pg` select on `127.0.0.1:54322`) | A refused production send lands **two** rows: `AUTH_OTP_REQUESTED` `UNAUTHENTICATED → OTP_PENDING success=true`, then `AUTH_OTP_DISPATCH_FAILED` `OTP_PENDING → OTP_PENDING success=false`, `failure_reason` beginning with the refusal code (`SMS_MOCK_PROVIDER_FORBIDDEN:` for AUTH-18's child, `SMS_GATEWAY_NOT_CONFIGURED:` for AUTH-19's). A development dispatch against the live local store lands `AUTH_OTP_REQUESTED` then `AUTH_OTP_DISPATCHED` `OTP_PENDING → OTP_PENDING success=true` with `metadata = {"provider":"CONSOLE","providerMessageId":"CONSOLE-1791791518465"}` and `details` naming the provider — so the receipt survives the column mapping, it is not only handed to the writer |
| `select action, count(*) … where action like 'AUTH_OTP%' group by action` — **after** the fix (read-only `pg` select on the local Docker store, post-`chain_20261012_134303`) | **`AUTH_OTP_DISPATCHED` 7,784 · `AUTH_OTP_REQUESTED` 36 · `AUTH_OTP_DISPATCH_FAILED` 8.** The dispatch-row growth is fully attributed by `previous_state`: **7,756** `AUTH_OTP_DISPATCHED` rows carry the old `UNAUTHENTICATED →` previous state (every one written before the fix — its last is `07:36:23Z`, before the first `AUTH_OTP_REQUESTED` at `07:48:50Z`), and **28** carry `OTP_PENDING →`, i.e. written after a challenge row by the fixed code. So the fixed write path never produced a `OTP_PENDING →` dispatch row without a preceding request, and the pre-fix `UNAUTHENTICATED →` dispatch rows stopped at the fix. **8 `AUTH_OTP_DISPATCH_FAILED` rows are the first non-`success=true` OTP outcome rows in the table's history** — the pre-fix table had literally none (the row above: 7,753 rows, all `success=true`). Pairing each `AUTH_OTP_REQUESTED` with the row that follows it for the same phone: **28 → `AUTH_OTP_DISPATCHED`, 8 → `AUTH_OTP_DISPATCH_FAILED`, 36 requests → 36 outcome rows, and 0 request that got both** — so the count of `AUTH_OTP_DISPATCHED` no longer grows on a refused send, which was the F-10 defect. |
| `select … where target_entity_id = any(…) order by created_at` for this cycle's fixture phones | Times are UTC; the `134303` chain run's window is `08:13:03Z`–`08:25:39Z`. `+919876500088` (production child, no provider): `AUTH_OTP_REQUESTED` `UNAUTHENTICATED → OTP_PENDING success=true` then `AUTH_OTP_DISPATCH_FAILED` `OTP_PENDING → OTP_PENDING success=false` twice (`07:49:13.0Z` and `08:15:36.8Z` — the second inside the chain run, the first from a standalone link-8 execution before it), **no** dispatch row. `+919876500077` (AUTH-18, refused `CONSOLE` in production): the same two-row refusal at `07:49:12.7Z` and `08:15:36.5Z`, plus three older `AUTH_OTP_DISPATCHED` rows (`06:46:20Z`, `07:13:15Z`, `07:36:23Z`) all written by the pre-fix code. `+919876500099` (development `CONSOLE`, from the durability probe): `AUTH_OTP_REQUESTED` `07:51:58.448Z` then `AUTH_OTP_DISPATCHED` `07:51:58.483Z` `OTP_PENDING → OTP_PENDING success=true` with `metadata = {"provider":"CONSOLE","providerMessageId":"CONSOLE-1791791518465"}` — the accepted path writes the receipt durably, the refused path writes no receipt. `+919876500066` has **0** durable rows: the link-8 dev `CONSOLE` child inherits `SUPABASE_POSTGRES_LIVE='false'` from the suite's `:43`, so its accepted-dispatch pair lands only in the in-memory mirror (AUTH-22/23 assert the entry handed to the **real** writer, so their green is about the row's content, not its durability — the durable accepted-dispatch proof is `099`'s probe row, which left the flag at the wrapper's value). |
| `select … where action like 'AUTH_OTP%' … group by target_entity_id having failed>0 and dispatched>0` | **1** phone matches (`+919810122910`, a suite that both accepts and refuses sends): 9 requests → 7 `OTP_PENDING →` dispatch rows + 2 dispatch-failure rows. That is a phone with **seven accepted and two refused requests**, one outcome row each — not a request that both failed and dispatched. The having-clause is deliberately the strict reading, and the pairing query above is what shows each individual request lands exactly one outcome. |
| The `OTP_THROTTLED` flag on link 8 in the `134303` run — checked, not assumed | The flag is a **substring collision, not a throttle**. `scripts/test_chain.js:740` sets it from `/Too many OTP requests\|OTP_DISPATCH_FAILED\|try again in/i.test(text)`, and the new audit action name **`AUTH_OTP_DISPATCH_FAILED`** contains the literal `OTP_DISPATCH_FAILED`, so the two ✅ PASS lines that print the action name (AUTH-19, AUTH-20) set the advisory flag. Measured on the log: `Too many OTP requests` / `try again in` appear **0** times; the flag fires on `OTP_DISPATCH_FAILED` only. It is advisory — the exit code still decides, and link 8 is `exit=0 passed=22 failed=0`, so the run is clean. The audit action name is the truthful one, so it was **not** renamed to silence the flag. **Closed by `#289` as a tool-only correction:** the runner's regex was narrowed at the collision, not at the action name — `scripts/test_chain.js:756` (the line cited above as `:740` before that edit, which added a 4-line comment block above it) now reads `/Too many OTP requests|\bOTP_DISPATCH_FAILED\b|try again in/i`, so the server's error code (`src/server.js:1221`) still flags and the audit identifier (`src/database.js:6580`) no longer does. Guarded by `chain_throttle_heuristic_test.js` (HTH-00…HTH-15, chain link 69): standalone RED **12/16** before the narrowing, GREEN **16/16** after. Measured blast radius, replaying both regexes over two independent runs' recorded logs (`134303`: 68 link logs, `222036`: 69) — **exactly one link flips in each**, `auth_failclosed_test.log`, whose 3 hits are all `AUTH_`-prefixed with **0** bare-code hits and **0** limiter phrases, so no true positive was lost. The second alternative was left alone **on measurement, not judgement**: `try again in` is redundant for the OTP limiter (whose own copy at `src/database.js:6495` has no retry clause), load-bearing only for account-lockout copy, and ambiguous with the outage sentence — so link 57 is still flagged, and HTH-12 **pins that false positive as `true`** rather than hiding it. |
| `#289` no-regression run | `chain_20261012_224909_88900_180736`, HEAD `a48c079`, 22:49:09 → 23:02:25 IST (795 s): **69 links, 69 clean, 0 problems, 2,805 checks, 2 skipped lines, exit 0**, teardown `pid 86324 reaped, :4000 free`, **0** `chain_scratch` schemas. Diffed per link (exit/passed/failed/skipped/throttle) against the `134303` 68-link baseline: **two lines differ in the whole chain** — link 8's flag goes `OTP_THROTTLED → (none)` with `exit=0 passed=22 failed=0` unchanged, and link 69 is added at `exit=0 passed=16 failed=0`. The total moved by exactly **+16** = link 69's checks, nothing double-counted, no neighbour moved. Link 8's log in this run reads `AUTH_OTP_DISPATCH_FAILED` **3** times, the bare code **0**, both limiter phrases **0** — the flag is absent because the collision is gone, not because the evidence stopped. Only link 57 carries `OTP_THROTTLED` (pinned by HTH-12). **Two honest caveats:** link 2's green here is due to a concurrent agent's cap in `session_reconcile_pagination_test.js:175`, not to this cycle, and that edit landed in the same tree between 22:47 and my 22:49 launch, so this run verified a tree that changed under it. And the launch itself reported "exit 1" through `powershell -Command "node … 2>&1 | Tee-Object …"` while the runner exited 0: a probe (`console.error` + `process.exit(0)` through the same pipeline → exit **1**, without the redirect → exit **0**) shows it is Windows PowerShell's `NativeCommandError` turning `with_local_target.js`'s startup stderr into error records. **Read `metadata.json`'s `exitCode`, never a shell pipeline's,** when judging a chain run. |
| Neighbours re-run after the F-10 fix (not assumed) | `node scripts/with_local_target.js node test_phase7_security.js` (link 12) **48 PASSED / 0 FAILED** exit 0; `node scripts/with_local_target.js node sms_gateway_test.js` **32 passed, 0 failed**; `node scripts/with_local_target.js node push_delivery_truthfulness_test.js` (link 66) **20/20 passed** with PDT-F50 still green; `node --check` clean on `src/database.js` and `auth_failclosed_test.js`. No assertion count moved in any of them — only link 8 grew, from 16 to 22, by the six added AUTH-19…AUTH-24 checks |
| `node scripts/with_local_target.js node doc_citation_guard_test.js` | 8 PASSED / 0 FAILED, exit 0 (DC-01 **25** documents, DC-02 0 stale, DC-03 0 dead routes, DC-04 37 citations matched, DC-05 25 documents with server.js citations). Run once after the nine corrections below (then DC-01/DC-05 = **24**) and again after §5 of `NABIN_RELEASE_BLOCKERS.md` was added — that section cites `server.js` lines, which makes the register itself a guarded document and moved the count to 25), and a third time after the F-2 correction rewrote §2.12, §3, §4, §6 and this section here and BLK-03's remediation steps there: **8 / 0** again, DC-01/DC-05 still **25**, DC-02 0 stale. The `SmsGatewayService.js` and `.env.production.example` anchors this cycle moved are not `server.js`-derived, so the guard cannot see them — each was re-read by hand at the line before it was written |
| chain scratch state after the run | `schema chain_scratch: absent`, `nabin_chain_rest: not running`, proxy `not running` |
| Port `:4000` listeners after the run | 0 |
| `node sms_gateway_test.js` (hermetic provider matrix, no DB, no network) | **27 PASSED / 3 FAILED** before the F-2 correction. The three reds were the added production-`CONSOLE` assertions and nothing else: `SMS-026` (`production CONSOLE throws — expected throw`), `SMS-028` (`production CONSOLE dispatch rejects`, which answered `delivered: true` instead) and `SMS-031` (`gatewayStatus reports ready:false with the refusal code`, which answered `ready: true`). `SMS-027`/`SMS-029` sit behind those two and did not execute; `SMS-030` (development `CONSOLE` still dispatches) passed before and after, which is the point. An intermediate **31/1** was measured and chased to a **harness** fault, not a product one — the `console.info` patch captured another block's dev-mode `CONSOLE` line for the same fixture number — fixed by giving SMS-029 its own recipient. Final: **32 PASSED / 0 FAILED**, the suite's pre-existing 26 assertions unmoved. Not a chain link. |
| `node scripts/with_local_target.js node auth_failclosed_test.js` (chain link 8) | **16 PASSED / 0 FAILED**, exit 0, including the new **AUTH-18**: a `NODE_ENV=production` child calling `sendAuthOtp` with `SMS_PROVIDER=CONSOLE` answers `SMS_MOCK_PROVIDER_FORBIDDEN` / 503, `claimedSuccess=false`, no echoed code. *(The F-2 cycle's measurement, kept as measured; link 8 stands at 22 checks since F-10 added AUTH-19…AUTH-24 — see the two F-10 rows above.)* |
| `node scripts/with_local_target.js node test_phase7_security.js` (chain link 12) | **48 PASSED / 0 FAILED**, exit 0 — unchanged by the correction, because it declares no provider |
| `node scripts/with_local_target.js node push_delivery_truthfulness_test.js` (chain link 66) | **20/20 passed, 0 failed**, exit 0, with PDT-F50 (`SMS_GATEWAY_NOT_CONFIGURED` on an unset provider) still green |
| `#274` live refusal probe (throwaway `backend/scratch/admin_price_review_http_probe.js`, wrapped, spawned its own server on a private `:4123`, deleted after measuring) | **6 refusal bodies → 6 × 400, `audit_logs` delta 0, 0 probe-named rows, exit 0.** Measured on the local Docker store (`supabase=http://127.0.0.1:54321`, `database=127.0.0.1:54322`, `ref=(empty)`) after a real `POST /api/admin/login`: unknown action / absent action / lower-case `freeze` / `CORRECT` with no `newPrice` / a 200-character action / unknown action on an **absent product** all answered `GROCERY_PRICE_REVIEW_ACTION_INVALID` (or `…_CORRECT_PRICE_REQUIRED` for the price-less `CORRECT`), and every one printed `echoedCallerString=false` — the refusal names the three allowed words rather than quoting the caller's, so a 200-character `action` cannot reach the wire. `audit_logs before=254480 after=254480 delta=0` and `probe-named ADMIN_PRICE rows=0`. **No successful action was sent**, because FREEZE/UNFREEZE/CORRECT-with-a-price would each write a real audit row and a price-history row; the probe is therefore refusal-only and left nothing to clean up. The last case is the one that shows the guard's *position*: an unknown action on a product id that does not exist returns the action code, not `Product not found`, because the check runs before `getGroceryProductById` (`src/database.js:5776-5788`, lookup at `:5790`). **Durable residue on the same store, read-only `psql`:** `audit_logs` holds **254,480** rows, **0** of them with `action like 'ADMIN_PRICE%'`, and the longest `action` value anywhere in the table is **32** characters — so the pre-fix fall-through left nothing to clean up, exactly as D-4's "no client anywhere calls the route" predicts. |
| `#274` neighbours, run standalone through the wrapper (all against the local Docker store) | `admin_audit_fail_closed_test.js` **99 PASSED / 0 FAILED** exit 0 (its AR-01…AR-08 + ST-07 group is this cycle's addition); `test_suite.js` **451 PASSED / 0 FAILED**; `admin_authorization_test.js` **114 passed**; `admin_identity_gates_test.js` **74/74**; `grocery_price_write_durability_test.js` **25/0** (chain link 65); `grocery_reference_and_degraded_pricing_test.js` **8/0 in live mode and 8/0 in degraded mode** — **not** a chain link, and the degraded half is the reason the wrapper cannot be used for it, since its own `SECTION B` block is authoritative for `SUPABASE_URL`. One harness precondition was learned the slow way: `grocery_price_write_durability_test.js` **drives** a backend rather than spawning one, so a bare first run was red `connect ECONNREFUSED 127.0.0.1:4000` — a missing target, not a defect; with a wrapped server on `:4000` it read 25/0 and the server was torn down afterwards so the chain's own runner would not be refused the port. |
| `#274` chain run and the one red it produced, root-caused before any edit | `chain_20261013_031424_85220_132dfb` ran **links 1…47 with 46 clean, 2,181 checks reported** and then stopped: link 48 `test_phase5_payments.js` printed `ISOLATION UNAVAILABLE: isolation setup failed: failed programming external connectivity on endpoint nabin_chain_rest` and the harness died, so links 49…72 **did not run and are not test failures**. Diffed against the 72/72 baseline `chain_20261013_023614_76484_7e98e2` by reading both `metadata.json` files: the baseline's link 48 carries `isolationPort: "4101"`, this one carries `isolationPort: null`, and in this one's link-48 log the suite's cold-restart step reads `Terminating backend process listening on port 4000` where the baseline reads `…port 4101`. So the sequence is measured, not guessed — the scratch PostgREST container could not bind its host port (`scripts/chain_scratch.js:39-40` assigns 54331/54332), the runner went on to execute an `isolated: true` link **without** isolation, and the suite then resolved the shared `:4000` harness and killed it. Link 48's own suite printed **62 PASSED / 0 FAILED** inside that same log, so its exit 1 is the isolation annotation, not a payment regression. Ports 54331/54332 read free afterwards and no `nabin_chain_rest` container (running or exited) exists, so nothing leaked from it. **The mechanism is in the runner's own ordering, not in Docker**: `scripts/test_chain.js:1166` calls `runLink(link, env)` **before** `:1167` inspects `isolationError`, and the isolation branch only *marks* the link failed (`:1168-1169`), tears the scratch down (`:1173`) and releases the port (`:1174`). An isolated link whose setup threw therefore still executes, with an env that has no `NABIN_RESTART_PORT`, i.e. against the **shared** harness the isolation exists to keep it away from. **This is a harness finding and it belongs to the D-7 family, not to `#274`**: the safe shape is to refuse an isolated link whose scratch never came up, the way `:618-636` refuses a leaked scratch *environment* at boot. Reported rather than silently patched, because runner policy is the owner's call under D-7. |
| `#274` no-regression chain run (the retry the row above called for) | `chain_20261013_034615_84608_cd6acd`, HEAD `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` on `main`, 03:46:15 → 03:58:28 IST (`durationMs 732,456`): **72 links, 72 clean, 0 problems, 2,886 checks reported, 2 skipped lines, `verdict.exitCode: 0`**. **`checksReported` is the runner's own per-link `max(markerCount, summaryCount)` and it repeats for three links this run measured directly** — `cash_ride_audit_test.js` 44 against its own `PHASE14_CASH_AUDIT_TEST_SUMMARY passed=22`, `financial_authority_test.js` 62 against `passed=31`, `driver_earnings_identity_audit_test.js` 32 against its own 16 — so **69 of the 2,886 are repeats and 2,817 is the floor on the suites' own summaries**; the other 69 links were each compared against their own printed total and agree (60 match `metadata.json` exactly, 9 had no machine-readable summary line and were read by hand: `74/74`, `87/87`, `12/12`, `50/50`, `40/40`, `27/27`, `16/16`, `Count: 24`). The count is reported because the runner printed it, never because it is a count of distinct assertions. Diffed per link **by file name** (not by index) against the 72/72 baseline `chain_20261013_023614_76484_7e98e2`: **one line differs in the whole chain** — link 17 `admin_audit_fail_closed_test.js` `passed 90 → 99`, `exit 0 → 0`, `skippedLines 0 → 0` — and the reported total moves by exactly **+9** (2,877 → 2,886), i.e. this cycle's eight AR checks plus ST-07, with no other suite moving and no check double-counted. **Link 48 is the point:** `isolationPort: "4101"` where the aborted run had `null`, and links 48 (`test_phase5_payments.js` 62), 49 (`test_phase4_orders.js` 66), 50 (`test_phase11_feature_control.js` 24) and 51 (`ad_click_rate_limit_test.js`) all carried that port, exited **0**, and reported `DRIFT public: CLEAN (hard guard enforced)` — so the earlier failure was the scratch PostgREST container not binding its host port, exactly as the isolation-port diff predicted, and the payment suite was never the problem. Across the run: **0** non-zero exits, **0** failure marks, **0** contamination flags, `harnessUnreachable: null`, `secondRunnerRefused: false`; only link 57 `customer_order_read_reliability_test.js` carries `otpThrottled` (the `try again in` heuristic, pinned true by HTH-12); the two skipped lines belong to links 25 `driver_earnings_identity_audit_test.js` and 54 `place_substitution_test.js`, the same two as the baseline. Post-run state, measured not inherited from the log's teardown line (`pid 60280 reaped, :4000 free`): **0** listeners on `:4000` (`netstat`), **0** `chain_scratch` schemas, **0** `nabin_db` connections and **no** `nabin_chain*` container in any state (`pg` / `docker ps -a`), durable `public.audit_logs` **255,786** rows of which **0** match `action like 'ADMIN_PRICE%'` — the AR group's green is therefore a mirror/writer-level proof, not evidence that a durable `ADMIN_PRICE_*` row exists anywhere. |
| `#293` the isolation refusal and its readability fix, proven by two forced-failure chains | **Trigger is deterministic, not awaited:** `DOCKER_HOST=tcp://127.0.0.1:1` makes `chain_scratch.js provision` fail at step `[1/4]` in **0.161 s**, status 1, **no container and no residue**, and it survives the wrapper because `scratchCli` inherits `process.env` and `scripts/with_local_target.js` spawns with `env: {...process.env}`. There is **no per-link filter**, so this is the cheapest way to exercise a runner path — one full run each. **Run 1** `chain_20261013_051226_55428_5fd073`: **72 links recorded, 68 clean, exactly 4 problems** (links 48 `test_phase5_payments.js`, 49 `test_phase4_orders.js`, 50 `test_phase11_feature_control.js`, 51 `ad_click_rate_limit_test.js`, each `exit 1 / passed 0 / error: "isolated link refused before execution"`), **`harnessUnreachable: null`**, `secondRunnerRefused: false`, 2,726 checks, 2 skipped lines, `exitCode: 1` **by design**, teardown `pid 105140 reaped, :4000 free` — against the pre-fix `chain_20261013_031424_85220_132dfb`, which recorded only **48** links with `{linksClean: 46, problems: 2, checksReported: 2,181, exitCode: 1}` and `harnessUnreachable {beforeLink: 49, reason: "harness process exited"}`. **That run is also what found the second defect,** because the refusal it produced was unreadable: `test_phase5_payments.log:1` ends `isolation setup failed: 0, 116,  97, 105, 110, 101,` and the teardown line read `TEARDOWN FAILED: ''` — the last 300 chars of a serialised error object's `stdout`/`stderr` **byte arrays** (`chain_scratch.js` throws out of `sh()`, so the `[n/4]` step header is on stdout and the cause on stderr, which the old tail-of-`stderr`-else-`stdout` slice discarded). **Run 2, after `isolationFailureSummary`** `chain_20261013_053001_35080_f39d57` (05:30:01 IST, `durationMs 468,384`): the same 68/72 shape, the same four refusals, **0 contamination**, `harnessUnreachable: null`, **link 72 exit 0 / 41 passed**, total **2,734 = 2,726 + 8** — exactly CRG-33…40 and nothing else — and its link-48 log now reads `ISOLATION UNAVAILABLE - LINK NOT EXECUTED: isolation setup failed: [1/4] dumping public schema (schema-only)… — Error: Command failed: docker exec supabase_db_nabin pg_dump -U postgres -d postgres --schema-only -n public — error during connect: … actively refused it.` naming step, command and cause. **No-regression between them:** `chain_20261013_045140_55340_6ffc58` on the same tree finished **72/72 clean, 0 problems, 2,892 checks, 2 skipped lines, exit 0** with links 48/49/50/51 isolated on `4101` passing **62/66/24/14** under `DRIFT public: CLEAN (hard guard enforced)`, and the 2,886 → 2,892 move is exactly CRG-27…32. **Guard:** `node chain_runner_guard_test.js` → **41 PASSED / 0 FAILED** standalone (`node --check` clean on it and on `scripts/test_chain.js`). **Residue after each run, measured not inherited:** `chain_scratch` schema absent, `nabin_chain_rest` not running, proxy not running, **0** listeners on `:4000`/`:4101`/`:54331`/`:54332`, no `harness-4000.lock`. **Cost of the change: zero product behaviour** — no route, source file, migration or client was touched, both runs exit 1 with four *honest* refusals rather than a manufactured green, and D-7's boot drop-or-refuse question plus "abort or continue after a refusal" stay with the owner. |
| Local stack at the start of the F-2 cycle | Down: 0 listeners on `:54321`/`:54322`, `docker version` → "failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine". Docker Desktop was started from `AppData\Local\Programs\DockerDesktop` (engine 29.7.2); the existing containers answered again on both ports without a `supabase start`. AUTH-15/16/18 had been red for that outage alone, not for the change. |
| `#272`/`#273` route-authorization inventory, derived from source (read-only; the throwaway parser lived in gitignored `backend/scratch/` and is deleted) | The earlier figures were partial, so the inventory was regenerated from the registrations themselves: `src/server.js` has **207** `app.<verb>(` registration lines, which expand to **239** reachable paths once the **32** array-path registrations (`app.get(['/api/x','/api/y'], …)`) are counted per path — each of the 32 was measured to bind exactly two paths, so 64 paths come from them and 175 from the single-path lines; counting quoted strings on those lines instead would give **79**, because 15 of them carry non-path literals after the array (e.g. `requireMerchantService('RESTAURANT')`). Of the **88** paths under `/api/admin`: **69** carry identity **and** a permission middleware, **16** carry identity only, **3** carry no middleware at all. No mount-level guard exists — `app.use` appears only for `cors` (`:291`), one inline middleware (`:324`), `express.json` (`:330`) and the error handler (`:10189`) — so the registration arguments are the whole authorization layer for these paths. **The 16 were not assumed to be gaps; three were read at source and all three authorize anyway:** `POST /api/admin/reset-password` (`:1808`) allows self-or-`admin_accounts.manage` via `adminHoldsPermission` (`:1818-1822`), and `POST /api/admin/features` (`:8052`) and `PUT /api/admin/features/:key` (`:8137`) both refuse any caller whose `role !== 'SUPER_ADMIN'` (`:8059`, `:8142`) — so the real admin read gap is the `authenticateAdmin`-only catalogue reads (`:1923 /drivers`, `:1932 /drivers/:id`, `:6909 /metrics`, `:6934 /jobs`, `:6935 /restaurants`, `:2995 /advertisements`, `:7411 /master-catalog`, `:7462 /master-catalog/:id/stores`, `:7969 /grocery/price-alerts`, `:8001 /supabase-status`, `:8039 /features`, `:1425 /services/status`), plus the media family. **Two of my own parse bugs were caught before publishing, and both would have produced a false number:** requiring an unindented registration silently dropped the 32 array-path forms (which is where `POST /api/admin/grocery/products/:id/photo` hides), and a brace-counting body extent reported `handlerLines=-1` for one-line registrations while silently making every in-handler evidence flag meaningless. The word-presence flags were therefore **not** used as a verdict — only the handlers quoted above were. **The 16 and the 3 are now enumerated and reconciled, because a bare count invited the wrong reading:** re-derived with `requireSuperAdmin` and `requireIdentityDecision` recognised as role middleware (the first classifier only looked for the literal `requirePermission(`), the split is unchanged at **69 / 16 / 3** over the 88 `/api/admin` paths, and the 16 resolve to **12 catalogue reads + 3 that authorize inside the handler (`:1808`, `:8052`, `:8137`) + 1 self-scoped by design** (`GET /api/admin/me` `:1851`, which returns `req.admin` and nothing else — the caller's own record). Of the 3 with no guard token in the registration, **none is an anonymous admin capability**: `POST /api/admin/bootstrap` (`:1577`) and `POST /api/admin/login` (`:1670`) are the public auth entry points, and bootstrap is refused once any account exists (`:1590-1592`), rate-limited per IP with an exponential lockout (`:1607-1611`), and compares its `ADMIN_BOOTSTRAP_SECRET` with `crypto.timingSafeEqual` behind a length check (`:1600-1603`) — with no secret in the env `isSecretValid` stays false, so it fails closed. The third, `POST /api/admin/grocery/products/:id/photo` (`:9503`), has no middleware argument but calls `resolveMediaCaller` in the handler. **So the finding is horizontal, not anonymous:** `authenticateAdmin` (`:1137-1186`) admits a valid, non-deactivated session of **any of the five admin roles**, and the twelve reads apply to all of them. **The convention these twelve deviate from is measured in the same file: of 38 admin GET registrations, 24 carry a permission key** (`audit.view` `:1885`, `support.view` `:2113`, `finance.view` `:2200`/`:2216`, `security.view` `:2505`, `customers.read` `:2669`/`:2691`, `merchant.manage`, `promotion.view`, `campaign.view`, `surge.view`, `geofence.view`, `identity_verification.view`, `admin_accounts.manage`, `pricing.edit`, `finance.settlement`), and two of those gated reads are direct analogues of an ungated one: `GET /api/admin/finance/metrics` requires `finance.view` while `GET /api/admin/metrics` (`:6909`) requires nothing, and `GET /api/admin/customers` requires `customers.read` while `GET /api/admin/drivers` (`:1923`) requires nothing. **What each ungated read actually returns was read at source, not assumed:** `/drivers` and `/drivers/:id` (`:1923`, `:1932`) return whole driver records with no field projection, and under live Postgres that mirror is hydrated from the durable table (`database.js:1795`) with `phone`, `dl` ← `license_number`, `verifiedUpiId`/`pendingUpiId` and `walletBalance` among its fields (`database.js:1806-1836`); `/jobs` (`:6934`) and `/restaurants` (`:6935`) are one-liners returning the entire `db.jobs` / `db.restaurants` arrays with no limit; `/metrics` (`:6909`) returns aggregate counts plus `totalGrossFare`; `/advertisements` (`:2995`) returns all ads with impression/click totals; `/master-catalog` and `/master-catalog/:id/stores` (`:7411`, `:7462`) return catalogue rows and the store matrix; `/grocery/price-alerts` (`:7969`) returns the anomaly list; `/supabase-status` (`:8001`) strips the `error` field before responding (`const { error, ...safeStatus }`) and returns environment, declared ref, configured/connected/ready/mode and the user count; `/features` (`:8039`) returns the flag list while its two writes require `SUPER_ADMIN`; `/services/status` (`:1425`) returns the status board while `/services/pause` requires `services.pause`. **Least-privilege is therefore pre-existing for most of them:** a same-prefix non-GET route already carries a key for 5 of the 12 (`fleet.manage`/`finance.settlement` for drivers at `:1934`, `merchant.manage` for restaurants, `advertisement.*` for advertisements, `catalog.manage` for master-catalog), 4 more have a key or role check on the same resource under a different sub-path (`grocery.review` `:7975`, `services.pause` `:1431`, `catalog.manage` for the stores matrix, `SUPER_ADMIN` for the feature writes), and only **3 have no key anywhere near them — `/metrics`, `/jobs`, `/supabase-status`** (each has no non-GET route on its prefix at all), so those three are the only ones needing a new matrix key or an explicit ruling that any admin role may read them. Whether a named key is the *right* key for a read is a policy call, not a measurement; what is measured is that the codebase already gates the same subject. |
| `#273` media surface, costed the way D-4 was (source + caller counts; no live anonymous request was made) | `POST /api/media/upload` (`:9042-9096`) calls **no authenticator at all** — it destructures `folder`, `publicId`, `ownerType`, `ownerId`, `replacePublicId` straight out of `req.body` (`:9044-9055`), uploads (`:9062-9064`), saves the asset row under the **caller-claimed** owner (`:9066-9080`), and then **deletes** whatever `replacePublicId` names (`:9083-9086`). So one unauthenticated request can both plant media attributed to any owner and destroy an existing asset by public id. The fix already exists in the same file and is already exercised by its sibling photo routes: `resolveMediaCaller` (`:8355-8377`) fails closed with `AUTH_REQUIRED` on no token and `INVALID_SESSION` on an unknown one, with **no** `allowsTestConvenience` skip. **Caller evidence: zero.** `mobile/lib/**` (paths are built as `'$baseUrl/media/…'`, so a literal `/api/` grep is a false negative — the pattern was corrected before the count was taken), `admin_dashboard.html` and `admin-web/src/**` contain no reference to `/api/media`, `media/upload` or `signed-params`; the only callers are `backend/cloudinary_test.js` (`:143-213`, **not a chain link**) and `merchant_operations_test.js:617` (`GET /api/media`, chain link **140**). Adding auth to the write surface therefore breaks no shipped client and no chain link; scoping `GET /api/media` would need link 140 to authenticate. **Severity qualifier, stated rather than inflated:** `GET /api/media` (`:9153-9160`) reads `db.mediaAssets`, the **process-local** mirror with no table behind it under live Postgres, so the anonymous disclosure is bounded to assets that process has saved since boot — real, but not "every asset ever". `GET /api/media/signed-params` (`:9141-9150`) hands signed upload params for a caller-chosen folder/publicId with no auth. `DELETE /api/media/*` (`:9099-9138`) does check ownership **when a token is present** (`:9115-9129`), but the whole block is skipped when `token` is empty and `allowsTestConvenience('skipping an authentication check')` is true (`:9108-9114`) — env-gated, not open in production. **No probe was run**, because a successful `POST /api/media/upload` writes a real asset to the account Cloudinary keys this environment points at; the surface is proven from source, not from a request. Patching it is an authorization behaviour change, which §4 reserves, so it is reported with its cost — the decision is D-8's. |
| `node admin_campaign_contract_test.js` — **#294 RED, before the fix** | **3 PASSED / 8 FAILED**, exit 1, run against the HEAD snapshot of the console (`git show HEAD:admin_dashboard.html` written to gitignored `backend/scratch/`), with the working file restored afterwards and its SHA256 re-measured identical (`1d20441ba079cd7f24ce583e0eda1c51f5acbe4a72def218874e233e9729bc9e`). Eight named failure sites, and they are the eight claims F-11 makes: the bare-`.toFixed` dereference on the by-design-null `bidRateCpm`, the `adRevenueEstimate` read, the 7 unsupported payload keys in each of the two write bodies, the invented edit-modal prefill values, the two placements that resolve `null`, and the handlers keying success on `data.success` alone. Non-vacuity is a check of its own (CAMPAIGN-06 requires `CAMPAIGN_FNS.length === 6` and both modal blocks located, so "found nothing to inspect" fails the guard rather than passing it), the storable-key set is measured with the repository module's **own** refusal filters (`pickUnsupported`/`pickUnknown`) rather than restated from an export list, and each failure prints its exact site. `node --check` clean on the suite. |
| `NODE_PATH=src node admin_campaign_contract_test.js` — **#294 GREEN, after the fix** | **11 PASSED / 0 FAILED**, exit 0 against the working tree, same command, same two files. Neighbour re-run, not assumed: `node admin_console_xss_test.js` **12 PASSED / 0 FAILED** (XSS-01 still counts 274 interpolated values across 80 templates; XSS-10 still lists `toggleAdStatus(adId)` and `deleteAdCampaign(adId)` among the 7 `requireId`-guarded handlers) — the new `—`/`Number(x).toFixed(2)` shapes pass both guards, which is why the bid cell was written as a formatter-chain rather than a dereference. |
| `#294` live write-contract verification (throwaway `backend/scratch/live_294_verify.js`, deleted after measuring; real backend booted through `node scripts/with_local_target.js node src/server.js`, log confirmed `label=local-docker`, `supabase=http://127.0.0.1:54321`, `database=127.0.0.1:54322`, `ref=(empty)`) | Ten assertions against the shipped routes, no stub: admin login `200`; read `200 rows=3` with **no** `adRevenueEstimate` anywhere in the payload; `monetization={"available":false,"reason":"No bid-rate or price column exists on advertisements, so revenue cannot be computed from stored data. Adding one requires a new migration."}`; `first.bidRateCpm=null first.brand=null` — the by-design nulls F-11 reads. **Old payload → `400 ADVERTISEMENT_FIELD_UNSUPPORTED`, error naming `brand, tagline, industryCategory, sponsorBadge, service, ctaText, bidRateCpm`**, which is the guaranteed rejection the console used to report as "deployed live". **New deploy body → `200 persisted=true dataSource=postgres`** (id `b9c05484-8dd8-4019-bafc-7ff3ce4c2745`), **new edit body → `200 persisted=true dataSource=postgres slot=CHECKOUT status=PAUSED`**, marker row then visible through the read route and deleted with `persisted=true`, **0 marker rows remaining** — prove-then-scoped-cleanup, and the store is back to the same 3 durable `HOME_BANNER` rows. **One contract fact this probe corrected in me, not in the code:** my own `marker row deleted` assertion went red on `deleted=[object Object]` — the route returns the deleted **row object**, not a boolean. The delete had succeeded (the next assertion, 0 residue, passed), and the client only tests `data.success`, so no fabricated claim resulted; the probe's expectation was the defect. |
| `#294` browser render verification (throwaway `backend/scratch/294_browser_verify.js` + `294_file_probe.js` + a static proxy on the allowlisted origin `http://127.0.0.1:5000`, headless Edge over CDP, all deleted after measuring; screenshots kept) | Same harness, same data, two trees. **BEFORE (HEAD snapshot):** `gatewayHidden=true session=true`, raw authenticated read `200`, **`tbody rows=0`**, revenue `₹NaN.00`, `revenueNote:null`, and the page's own swallowed warning printed twice — `Error loading promotions and ad campaigns: TypeError: Cannot read properties of null (reading 'toFixed')` at `old_dash.html:4224:93`, inside `Array.map`, inside `loadPromotions`. That is F-11's first bullet witnessed, not reasoned. **AFTER (working tree):** **`tbody rows=3`** — the three durable campaigns with real impressions/clicks/CTR (`350/2/0.57%`, `332/3/0.90%`, `1,196/0/0.00%`), BID CPM `—`, revenue **`—`** with the route's own `monetization.reason` as the caption, `NaN anywhere false`, **0 page exceptions**. Screenshots `qa_screenshots/admin_campaigns_before_294.png` / `_after_294.png` taken with the Promotions tab visible and read back. **file:// (clean single-navigation probe):** `{"apiBaseValue":"http://localhost:4000","origin":"file://","health":{"threw":"TypeError: Failed to fetch"},"login":{"threw":"TypeError: Failed to fetch"},"relative":{"threw":"TypeError: Failed to fetch"}}` — which is D-9. Two measurement traps were hit and fixed before publishing: a nested backtick template inside the injected CDP script threw `SyntaxError: Unexpected identifier '$'`, and making file:// the third navigation in one tab reported `API_BASE=(undefined)`; the honest number came from a probe where file:// was the only navigation and `Page.loadEventFired` was awaited. Both browser runs also logged `Price audit feed: SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, which was **classified rather than ignored** and is filed as `#295`. |
| `node scripts/with_local_target.js node scripts/test_chain.js` — **#294 no-regression run (link 73 registered)** | `chain_20261013_064512_81908_484b69`, HEAD `a48c0793e82eb5eb47ef779b84f63a0c285fc15d` on `main`, 01:15:12.828Z → 01:27:33.100Z (`durationMs 740,272`): **73 links, 73 clean, 0 problems, 2,911 checks reported, 2 skipped lines, `verdict.exitCode: 0`**, `harnessUnreachable: null`, `secondRunnerRefused: false`. Diffed per link **by file name** against the 72-link baseline `chain_20261013_045140_55340_6ffc58`: **two lines differ in the whole chain** — link 73 `admin_campaign_contract_test.js` is added at `exit=0 passed=11 failed=0 skippedLines=0 durationMs=124 contamination:false isolationPort:null`, with `DRIFT public: CLEAN (10 protected tables unchanged)`; and `chain_runner_guard_test.js` moves **33 → 41**, which is **the eight CRG-33…40 readability checks that Action 48's `#293` cycle added between that baseline and this run — not this cycle's work** (my only change there replaced the stale literal "71 of 72 links" in CRG-29's evidence string with a count derived from the shipped runner). The reported total moves by **+19 = 11 + 8**, so nothing of mine is counted twice and no neighbour moved. Across the run: **0** non-zero exits, **0** failure marks, **0** contamination flags; only link 57 `customer_order_read_reliability_test.js` carries `otpThrottled` (the pinned `try again in` heuristic, HTH-12); the two skipped lines are links 25 `driver_earnings_identity_audit_test.js` and 54 `place_substitution_test.js`, the same two as every recent baseline; isolated links 48/49/50/51 ran on `4101`. Post-run, measured: **0** listeners on `:4000`, teardown `pid 11532 reaped`, no `nabin_chain*` container, and a read-only `pg` probe returns **`chain_scratch: ABSENT`**, `public` 58 tables, `advertisements` **3 rows (all `HOME_BANNER`/`ACTIVE`)** with **0** rows carrying this cycle's verification marker. **Honest caveat, in the same words as the `#289` row:** the tree changed under this run — a concurrent agent wrote `docs/` files at 06:39/06:43/06:47 IST while it was in flight, and `backend/src/services/dbTls.js`, `reconcilerSecurity.js` and `reconciler_target_guard_test.js` at 06:58–07:01, i.e. after 06:57:33 when the run finished, so this is no-regression evidence for the campaign change on the tree as it stood at launch, not a claim about the tree as it stands now. |
| `git status --porcelain` — **counted again on 2026-10-13 in the `#294` cycle** | **343 entries** after the session's throwaway probes were deleted (`M` 121, `??` 222, 0 staged). Measured 340 at the point this cycle's own work finished, and re-measured 343 with no change of mine in between — the delta is a concurrent agent's in-flight files (`backend/src/services/dbTls.js`, `reconcilerSecurity.js`, `reconciler_target_guard_test.js`), which is why the count is reported with its attribution instead of as a total. Deleting the five `backend/scratch/` throwaways moved nothing, because `.gitignore:35` excludes that directory. This cycle's own writes: `admin_dashboard.html` (` M`), `backend/admin_campaign_contract_test.js` (new, `??`), `backend/scripts/test_chain.js` (link 73), `backend/chain_runner_guard_test.js` (CRG-29 derived count), `qa_screenshots/admin_campaigns_{before,after}_294.png`, and these registers. Nothing committed, pushed, stashed, reset or history-rewritten. |
| `git status --porcelain` | **339 entries** at the end of the `#274` cycle (`M` for the accumulated uncommitted sprint work across `backend/`, `admin-web/`, `mobile/`, `docs/`, plus untracked suites this project does not own the commit of). Nothing committed, pushed, stashed, reset or history-rewritten in any cycle this file records. This cycle's own writes were `backend/src/database.js` (the guard), `backend/admin_audit_fail_closed_test.js` (AR group + ST-07), and the three registers: this file, `docs/NABIN_AUTONOMOUS_SPRINT_LOG.md` (Action 46) and `docs/NABIN_RELEASE_BLOCKERS.md` (§5 bullets) |
| Hosted projects contacted | none, in either direction |

Every `file:line` in this document was re-read on 2026-10-12. Two claims inherited from earlier notes
were found to be wrong and are corrected in place: the `identity_documents` table **does** exist
(F-6 explains what is actually missing), and stored bytes **do** have a durable home in Supabase
Storage even though the asset registry does not (§2.13).

**A second re-read pass happened on 2026-10-13, in the `#274` cycle, and it found drift rather than
fault.** `src/database.js` has been edited since this document was written, so every `database.js:N`
anchor below an insertion moved; the two re-anchor tools only derive `server.js` lines, so the anchors were
re-read from the file. §2.5's merchant-single-price row was **already wrong before that cycle began** (it
pointed at `:5360-5430`/`:5372-5377`/`:5390-5396`/`:5412` where the method now runs `5360-5461` and the
write lines are `:5383-5384`, `:5401-5402`, `:5422`), as was the degraded-mode row's mirror anchor
(`:5586-5590` → `:5595-5600`, verified by there being exactly two `GROCERY_DEGRADED_READ_ONLY` literals in
the file). Recording that matters: an anchor that drifted by an earlier edit will **not** be repaired by
adding the current edit's delta, so each was matched back to the statement it supports instead of being
shifted arithmetically.

**Nine more corrections came out of this document's own verification pass, and they are all defects in
this report, not in the code.** Each was found by re-opening the cited lines rather than trusting the
draft: §2.5/F-4 claimed the admin `CORRECT` branch reached a durable write when it delegates to the
mirror method; §2.9 counted five ticket update paths where four exist (the fifth is a driver-record
write); §2.13/F-3 described `bytes: bytes \|\| 45000` as an invented byte count when only the fallback is
invented, while the dimensions are always invented; §5 attributed the ledger write guard to link 34
(it is link 67) and the no-substitution guarantee to links 53 and 54 (it is link 54 alone); §5 cited
link 35 as the witness for the `#280` settlement abort (it is link 26, and only for the
no-silent-notice contract — §2.8 now says so); §7's document count was one behind; §2.15 asserted a
*seeded* superadmin password the source does not contain. Each is fixed above rather than footnoted.

## 8 · Status

**IN PROGRESS — SAFE WORK CONTINUES.**

Not `READY FOR OWNER RELEASE REVIEW`: F-1 and F-9 are open (F-2 was found and fixed at the root in the
same day's work, `#286`, with the RED→GREEN measures in §7, and F-10 — the OTP trail asserting a dispatch
before one had been attempted — was found by that fix's own regression check and closed the same day,
`#288`), no external boundary has been
exercised with real credentials, and BLK-07's two-book ruling is unanswered. Not `BLOCKED`: the
services whose real implementations exist are durable, guarded and green in a full chain run; what
remains needs owner decisions, credentials, or a hosted window — none of which this cycle was
authorised to supply.
