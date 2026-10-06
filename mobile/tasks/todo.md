# Todo: Customer Support slice (`customer-support`)

Ordered by dependency. Each ≤5 files. TDD: RED test written before the GREEN edit.

- [ ] T1 — Add `getSupportTickets({required String userId})` to `NabinApiService`
  - Acceptance: GETs `/support/user/$userId` with bearer auth; returns decoded map incl.
    `statusCode`; transport error → non-success result (not silent null the UI treats as empty).
  - Verify: `flutter analyze` (0 new issues); compiles.
  - Files: `lib/core/network/nabin_api_service.dart`

- [ ] T2 — RED: widget tests for the four list/submit outcomes
  - Acceptance: failing tests assert SC1 (no mock: list comes from endpoint), SC2 (submit
    4xx/5xx/null → error snackbar, list unchanged), SC3 (load error → Retry; empty vs ready).
  - Verify: `flutter test test/support` fails for the right reasons.
  - Files: `test/support/customer_support_screen_test.dart`

- [ ] T3 — GREEN: real load + state enum in the screen (SC1, SC3)
  - Acceptance: `_TicketsState{loading,ready,error,empty}`; `_loadTickets` reads
    `SessionManager…currentUser?['id']`, calls `getSupportTickets`, maps real keys; mock
    literal + `Future.delayed` deleted; Retry offered on error.
  - Verify: T2 list tests pass; `flutter analyze` 0 new.
  - Files: `lib/features/support/presentation/screens/customer_support_screen.dart`

- [ ] T4 — GREEN: submit correctness + real card fields (SC2, SC4 fields)
  - Acceptance: no `usr_2`; insert-on-`success:true` only, else error with server message;
    card binds `id/subject/status/createdAt/resolutionNotes`.
  - Verify: T2 submit tests pass; full `flutter test test/support` green; analyze 0 new.
  - Files: `lib/features/support/presentation/screens/customer_support_screen.dart`

- [ ] T5 — Gate: full analyze + test, evidence, spec/coverage update
  - Acceptance: `flutter analyze` new-issue count vs baseline recorded; `flutter test` for
    slice green; coverage matrix §10 Support + edge states updated for this screen; device
    verification explicitly listed as NOT done.
  - Verify: commands + their output captured in the report.
  - Files: `docs/SPEC_CUSTOMER_SUPPORT.md`, coverage matrix / `docs/AUTONOMOUS_BUILD_PROGRESS.md`

Do NOT commit/push/deploy. Do NOT touch `server.js`. No threshold/assertion weakening.
