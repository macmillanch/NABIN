# Spec: Customer Support Journey (NABIN Flutter Customer app)

Slice id: `customer-support`
Status: APPROVED 2026-10-02 — scope A, setState retained (see Decisions)
Date: 2026-10-02

## Objective

Replace the mock/incorrect data layer behind `customer_support_screen.dart` with the
real backend contract, so a logged-in customer can (a) see their **actual** support
tickets and (b) raise a ticket that **fails loudly when it fails** — and so the screen
shows honest edge states instead of fabricated content.

Why now: the coverage matrix §10 (Support) and the global edge states are all ⬜, and
this screen currently ships hardcoded mock tickets — the exact "no mock bypasses"
violation the gate calls acceptance-blocking. The backend already exposes all three
endpoints end-to-end, so no capability is invented.

User story: *As a customer, from Profile/Home → "24/7 NABIN Support", I can view my
real ticket history and submit a new issue; if the network or server fails, I am told
so and can retry — never shown a success I didn't get.*

Success (reframed from "close the §10 gap") as testable criteria:
- SC1: The ticket list is populated **only** from `GET /api/support/user/:userId` with
  the real `userId`; no mock/`Future.delayed` remains in the file.
- SC2: A submitted ticket that the server rejects (400/401/403/5xx/offline) shows an
  **error**, not the success snackbar. Only `success:true` inserts into the list.
- SC3: On load failure the list shows a distinct **error + Retry** state (not silent
  empty, not spinner-forever). Empty (`success:true, tickets:[]`) shows the empty state.
- SC4: `flutter analyze` reports no new issues; `flutter test` for this slice passes.
- SC5: The submitted body no longer hardcodes `userId:'usr_2'`; identity comes from the
  session token (backend derives caller from `req.caller`, ignores body `userId`).

## Tech Stack

- Flutter / Dart (existing `mobile/` project), Riverpod + go_router.
- HTTP via `NabinApiService` (raw `HttpClient`), bearer token via `_attachAuthHeader`.
- Session: `SessionManager.instance` → `currentUser` (Map with `id`), `token`.
- Theme tokens: `AppTheme` (the de facto mobile token source). No new deps.

## Backend contract (verified against server.js / SupportTicketRepository.js)

| Endpoint | Auth | Request | Response | Notes |
|---|---|---|---|---|
| `POST /api/support/ticket` | `requireSupportCallerAuth` | `{category, title, description, jobId?, priority?, evidenceUrls?}` | `{success:true, ticket}` / `{success:false, error, requestId}` | Identity = bearer token (`req.caller`); body `userId` is **ignored**. `title` & `description` required (400). `jobId` ownership enforced (403). |
| `GET /api/support/user/:userId` | `requireSupportCallerAuth` | path param | `{success:true, tickets:[…]}` / 403 if `:userId` ≠ caller | Non-admin may only read own. Path MUST carry the real current-user id. |
| `POST /api/support/ticket/:id/message` | `requireSupportCallerAuth` | message body (shape TBD in plan) | thread update | **Currently unused by any screen.** In scope only if owner picks scope option B. |

Real ticket object keys (`mapRowToTicket`): `id` (= ticket_number, e.g. `TKT-…`),
`ticketNumber`, `uuid`, `category`, `title`/`subject`, `description`, `status`
(`OPEN`/…/`RESOLVED`), `priority`, `messages[]` (`{senderRole,senderName,text,timestamp,metadata}`),
`resolutionNotes`, `resolvedAt`, `refundAmount`, `resolutionType`, `createdAt`, `updatedAt`.

The current mock uses keys `subject/date/resolution` that **do not match** this shape.

## Commands

```
Analyze:   flutter analyze                 (run from mobile/)
Test:      flutter test                    (run from mobile/)
Single:    flutter test test/support/…     (slice tests)
Run (dev): flutter run -d <device>          (needs an emulator/device — see Testing)
```

## Project Structure (touched files)

```
mobile/lib/core/network/nabin_api_service.dart      → add getSupportTickets(userId)
mobile/lib/features/support/presentation/screens/
       customer_support_screen.dart                 → wire real API + edge states
mobile/test/support/                                 → new widget tests for the slice
docs/SPEC_CUSTOMER_SUPPORT.md                      → this file
```

## Code Style

Match the file's existing style (StatefulWidget, `setState`, `AppTheme` tokens,
`ScaffoldMessenger` snackbars). Minimal, honest example of the state handling this
slice standardizes on:

```dart
enum _TicketsState { loading, ready, error, empty }

Future<void> _loadTickets() async {
  final userId = SessionManager.instance.currentUser?['id']?.toString();
  if (userId == null) {                 // not signed in → honest empty, no fake data
    setState(() { _tickets = []; _state = _TicketsState.empty; });
    return;
  }
  setState(() => _state = _TicketsState.loading);
  final res = await NabinApiService.getSupportTickets(userId: userId);
  if (res == null || res['success'] != true) {
    setState(() => _state = _TicketsState.error);   // SC3: distinct error, retry offered
    return;
  }
  final list = (res['tickets'] as List? ?? const [])
      .whereType<Map<String, dynamic>>().toList();
  setState(() {
    _tickets = list;
    _state = list.isEmpty ? _TicketsState.empty : _TicketsState.ready;  // SC1
  });
}
```

Service method returns the decoded map and must **not** swallow the error the way the
current `catch (_) { return null; }` does for callers that need status — prefer
surfacing `{'success': false, ...}` so the screen can honor SC2. Naming: `camelCase`
methods, `Snake_case` files, `UPPER_SNAKE` enum values, ticket ids displayed from
`ticket['id']`.

## Testing Strategy

- Framework: `flutter_test` (already the project's), tests under `mobile/test/support/`.
- Level: **widget tests** with a fake HTTP layer (inject `HttpOverrides`/a stubbed
  service) covering SC1–SC3: mock-list gone, error-not-success, error/empty/ready split.
- Reference the existing "render screens via a temp widget test" technique recorded in
  project memory (reset `HttpOverrides` in the test body; `pumpWidget` inside `runAsync`;
  no `pumpAndSettle` on infinite spinners).
- Coverage bar: the slice's state transitions (loading/ready/error/empty + submit
  success/failure) each have one asserting test.
- `flutter analyze` must add **zero** new issues (baseline ~68 exists repo-wide).
- **Runtime on device/emulator is NOT asserted available** here; anything needing a
  live backend or a real tap-through will be flagged as "needs device" rather than claimed done.

## Boundaries

- **Always:** bind to the real contract; keep the mock removal verifiable by test; run
  `flutter analyze` + `flutter test` before declaring the slice done; report verified vs.
  not-verified.
- **Ask first:** converting this screen to Riverpod (see Open Q1); adding a ticket-detail/
  thread screen that uses the 3rd endpoint (see Open Q2); touching `server.js` (line-cited
  permission matrix breaks on inserts near the top); any new dependency; any migration.
- **Never:** commit/push/deploy without approval; remove/weaken a test assertion to pass;
  reintroduce mock data; use `dataSource` to imply live Postgres where the local Docker
  store is being hit; run `sync-web-tokens.sh`.

## Open Questions

Resolved with the owner on 2026-10-02:

1. **State management → keep `StatefulWidget`+`setState`.** Riverpod conversion deferred
   to its own slice.
2. **Scope → A.** List + submit wired to the two read/write endpoints + edge states
   (SC1–SC5). The 3rd endpoint (`/ticket/:id/message`) and any thread view are **out of
   this slice**.
3. **Emergency SOS banner → out of scope** (decorative, no telephony dep added).
4. **Category labels → unchanged.** Static support categories; do not read the
   dark-store scope decision into them.


## Assumptions (correct me or I proceed with these)

1. The signed-in customer's id is available at `SessionManager.instance.currentUser['id']`
   on every path that reaches this screen (if not, SC1 falls back to an honest empty state).
2. "Verify" excludes live-device runs unless you tell me an emulator is available.
3. I stay inside the Customer app; the open `grocery_merchant_*` file is a different app and
   not touched by this slice.
