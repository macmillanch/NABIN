# REPOSITORY CLEANUP — audit framework, findings, and the deletions that are safe to make

Status: **NO FILES DELETED IN THIS PASS.** The audit did not reach the proof standard this task requires, and
the instructions are explicit that nothing may be removed on guesswork. The reasons are recorded below rather
than hidden behind a deletion count.

## Why nothing was deleted

1. **Untracked deletions are irreversible here.** `git status` shows branch `main` with **29 modified tracked
   files and 302 untracked files**, and this task forbids committing. A tracked file can be recovered with
   `git checkout --`; an untracked file cannot be recovered at all. Most of the clutter candidates are part of
   that untracked set, including evidence the F-2/FIN15B work depends on
   (`scratch/CHAIN_CHECK_BASELINE.md`, `scratch/fin15b_writer_trace.*`, `backend/scratch/*.log`).
2. **Open verification gates make a broken-tree risk unacceptable.** The FIN15B-14a/14b measurement-scope change
   is still RED under its own regression, link 51's teardown/process-identity probe is outstanding, and the
   51-link chain has not been re-run. Deleting anything now would confound any later failure: clean cannot tell
   a cleanup break from an in-flight change.
3. **The reference audit was not completed to a reliable standard.** My tracking/untracking counts came back
   implausibly uniform (`tracked=1 untracked=1` for every path, including directories known to hold many files),
   so the `git ls-files` pathspec evidence is inconclusive and must be redone. Phase 1 requires *proving* zero
   references via Dart imports, `go_router` routes, `require()`/ESM imports, `package.json` scripts, CI,
   Dockerfiles, migration references, and the test chain — none of which was done for any candidate.
4. **Phase 6 validation cannot be compressed.** `flutter analyze`, `flutter test`, four web lint/build/typecheck
   passes, backend test suites and reference re-searches are mandatory *after* deletion. Running deletion first
   and validation later is exactly what these rules forbid.

## Candidate inventory so far (CLASSIFIED, NOT ACTED ON)

| PATH | TYPE | CATEGORY | EVIDENCE / WHAT IS STILL NEEDED |
|---|---|---|---|
| `backend/test_output.txt`, `backend/test_results.txt` | captured test output | C/E - regenerable | must confirm nothing reads them (docs commands, CI) before removal |
| `backend/scratch/*.log`, `f3x/f4x/f4z/f5x/fin2/g1x/t3_x_test_suite.log`, `prov2.log` | run logs from earlier investigations | E | prove no doc/checkpoint cites them as evidence; keep `chain_scratch_*` artefacts the isolation mechanism uses |
| `backend/scratch/ext/**` (`agent-skills`, `graphify`) | **vendored third-party tool trees inside backend/scratch** | H - UNCERTAIN | these belong to IDE/agent tooling, not the product; must establish which tool owns them before touching |
| `graphify-out/**` (contains `*.tmp` cache) | generated output of that tooling | C/H | confirm it is regenerated and ignored by git |
| `mobile/.widget_preview/**` (`.iml`, controller) | tool-generated widget-preview scaffold | C/H | confirm no `pubspec`/route/test references and that the tool recreates it |
| `admin_dashboard.html` (repo root) | single-file HTML prototype | F/G candidate | must prove it is superseded by `admin-web/` (not referenced by scripts, CI, docs commands, or a `file://` workflow) |
| `nabin_234_*.{md,json}`, `nabin_stitch_*.{md,json}`, `nabin_targeted_fix_report.*`, `nabin_repository_inventory.md`, `grocery_merchant_app_gap.md`, `restaurant_merchant_web_gap.md`, `stitch_final_generation_report.*`, `supabase_connection_recovery_report.md` (repo root) | historical reports/QA output | D - keep by default | these are project history; the rule is "do not delete docs merely because they are old". If moved, move under `docs/history/` rather than delete |
| `task.md`, `TASKS.md`, `MEMORY.md` | working notes | H | may be actively used by agents; do not delete without owner confirmation |
| `backend/scripts/chain_scratch_proxy.js` | **live part of the F-3 isolation mechanism** | A - REQUIRED | keep; used by `chain_scratch.js` for isolated links |

Nothing above is marked "safe to delete" because that verdict needs a completed reference search.

## The safe procedure (for the pass that actually deletes)

1. Land the open work first: FIN15B scope fix green, F-2 teardown identity classified, one clean 51-link chain
   (checkpoint #53), then commit or stash the tree so every later deletion is recoverable.
2. Only then run the cleanup as its own change, so a build break is attributable.
3. Per candidate: grep imports/routes/require/`package.json` scripts/CI/Docker/migrations/test-chain/docs
   commands; require **zero** references from something that is itself retained.
4. Delete in one narrow batch, then immediately: `flutter analyze`; `flutter test --no-pub`; each web app's
   lint/build/typecheck; backend focused suites; re-search for references to deleted paths.
5. Any failure → restore that file and re-classify it as H (uncertain), not as a nuisance.
6. Never treat generated build output (`node_modules`, `.next`, `.dart_tool`, `build`) as source cleanup; verify
   `.gitignore` covers them instead.
7. Supabase migrations are out of scope for deletion entirely, per the standing rule that production migrations
   are never removed because application code does not import them. Note for a separate audit: the repository
   holds **15** files in `backend/migrations` (highest `015_school_child_domain.sql`) and **30** in
   `supabase/migrations`, while `docs/REMOTE_SUPABASE_DISCOVERY.md` records local as "001–014 applied" - that
   inventory discrepancy should be reconciled before any migration-file cleanup is even discussed.

## Explicitly preserved despite looking suspicious

- All four web apps (`admin-web`, `customer-web`, `grocery-merchant-web`, `restaurant-merchant-web`) - still part
  of the project; mobile does not replace them.
- All Flutter app implementations, `app_router.dart` and active routes, shared theme/token files
  (`nabin_palette.dart`, `nabin_tokens.dart`), API services/models, and the in-progress checkout work.
- Every backend route, repository/service, the test chain (`scripts/test_chain.js`, `scripts/chain_scratch.js`,
  `scripts/port_release.js`), all regression suites, and the F-2 rate limiter.
- `docs/**` including phase audit reports - historical documentation.
- Stitch projects/assets - design source material, independent of the Flutter implementations.
- `scratch/CHAIN_CHECK_BASELINE.md` and the FIN15B/F-2 trace scripts and outputs - active evidence for open gates.
