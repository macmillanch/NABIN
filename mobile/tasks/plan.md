# Plan: Customer Support slice (`customer-support`)

Spec: `docs/SPEC_CUSTOMER_SUPPORT.md` (approved 2026-10-02, scope A, setState retained).

## Approach

Wire `customer_support_screen.dart` to the two endpoints it already claims to use, remove
the mock, and give it honest edge states. No Riverpod, no thread view, no new dependency.

### Components & dependency order

1. **Service seam — `NabinApiService.getSupportTickets({required String userId})`**
   (new). Mirrors the existing static-call style and `_attachAuthHeader`. Must distinguish
   *transport failure* from *server `success:false`* — return the decoded map (with
   `statusCode`) rather than swallowing to `null`, so the screen can honor SC2/SC3.
   Depends on: nothing. → build first.

2. **Screen state — `_TicketsState { loading, ready, error, empty }`** replaces the boolean
   `_isLoadingTickets`/`_isEmpty` mix. `_loadTickets()` reads the real id from
   `SessionManager.instance.currentUser?['id']` (pattern: `driver_account_screen.dart:156`),
   calls `getSupportTickets`, maps real `mapRowToTicket` keys. No id → honest empty, no fake.
   Depends on: (1).

3. **Submit correctness —** `_submitTicket()` drops the `userId:'usr_2'` hardcode
   (backend ignores it anyway) and only inserts on `res['success'] == true`; every other
   outcome (null, success:false, 4xx/5xx) shows an **error** snackbar with the server
   `error` message and does NOT mutate the list. Depends on: (2 shape).

4. **Ticket card binds real fields** — `id`/`ticket_number`, `subject`, `status`,
   `createdAt` (formatted), `resolutionNotes`/`resolvedAt` for the resolved block. Delete
   the `TKT-9821` mock literal and the `Future.delayed`. Depends on: (2).

5. **Tests —** `mobile/test/support/customer_support_screen_test.dart` via `HttpOverrides`
   + `SessionManager.saveSession`, covering SC1–SC3: mock gone, load error→Retry,
   empty vs ready, submit-failure is not success. Depends on: (1)-(4) (test-first per task).

### Parallel vs sequential
(1) must precede (2). (3),(4) touch the same file as (2) → sequential edits on
`customer_support_screen.dart`. (5) written test-first per slice in TDD.

### Verification checkpoints
- After (1): `flutter analyze` clean for the service file.
- After (2)-(4): `flutter test test/support` red→green; `flutter analyze` adds 0 issues.
- Manual/device pass is **flagged, not claimed** (no emulator asserted).

### Risks & mitigations
- **R1: static `NabinApiService` not injectable** → fake the socket layer with
  `HttpOverrides.global`; per project memory reset it in the test body, never `pumpAndSettle`
  across the loading spinner.
- **R2: `getProfile`/session may lack `id` on some paths** → no-id → empty state + a
  "sign in to view tickets" line, not a crash and not fabricated rows.
- **R3: `flutter analyze` baseline drift** → count issues before/after; the bar is *zero new*,
  not zero total.
- **R4: touching `server.js`** → none required; all three endpoints already exist. Confirmed.

### Out of scope (this slice)
Thread/detail view (`POST /ticket/:id/message`), Riverpod conversion, Emergency SOS action,
category-label changes, accessibility (`Semantics`) sweep (candidate follow-up slice).
