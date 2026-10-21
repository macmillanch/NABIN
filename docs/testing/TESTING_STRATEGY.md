# NABIN — Automated QA Testing Strategy

**Author**: QA Engineer Agent ([`qa_engineer`](file:///c:/Users/Macmillan/OneDrive/Documents/nabin/.agents/skills/qa_engineer/SKILL.md))  
**Source Agency Agent**: `msitarzewski/agency-agents`

## 1. Test Suite Architecture (`backend/test_suite.js`)
The test suite validates 20 automated checks across 7 core categories:
1. **Health & Platform Status**: Verification of service availability and active metric reporting.
2. **Admin Authentication & RBAC**: Token generation, role-permission verification, team provisioning.
3. **Audit Log Trail**: Retrieval and verification of structured action logs.
4. **Support & Disputes**: Customer ticket creation, message threading, dispute resolution with automated wallet refund crediting.
5. **Finance & Ledger**: GTV metrics calculation, transaction ledger audit, manual credit adjustment processing.
6. **Promotions & Coupons**: Server-side coupon discount calculation and usage enforcement.
7. **Geofencing & Surge**: Zone deployment, surge multiplier calculation, fare estimation.

## 2. Test Execution Command
```bash
node backend/test_suite.js
```
- Benchmark: **20/20 PASSED (100% Pass Rate)**.

## 3. Harness boundaries — who may kill a backend

Most suites start their own backend (`spawn … src/server.js`, detached) when nothing answers
`:4000`. Two rules govern what happens to it afterwards, and both live in **one**
implementation so a suite cannot get them wrong by copy-pasting an old idiom:

| Rule | Implementation | A suite gets it by |
|---|---|---|
| Reap the backend **this run** started, on every exit path including `process.exit(1)` | `backend/scripts/spawned_server.js` — registers `process.once('exit', …)` at require time | `require('./scripts/spawned_server')` and wrapping the spawn in `trackServer(…)` |
| Never evict a port owner by pid alone | `backend/scripts/port_release.js#releasePrivatePort` — kills only a listener whose command line is a NABIN `src/server.js`, and prints `skipped:foreign` for anything else | calling `releasePrivatePort(port)` instead of parsing `netstat` |

A suite may kill only what it started. Nothing resolves a port to *find* a victim, and a
backend the operator started by hand is never in a run's tracked list, so it is never reaped.
The leak this replaced was the reason a green chain had silently come to depend on an orphan
process on `:4000` blocking the next run.

**Two residuals, deliberately not fixed here:**

1. `test_phase6_dispatch.js`, `test_phase7_security.js` and `test_phase10_security.js` still
   hard-code `:4000` rather than honouring `NABIN_RESTART_PORT`. Their *sweep* sits behind the
   health guard (`if /api/health answers 200, return null`), so an in-chain shared harness is
   left alone — which is what the chain proves (54/54, zero `skipped:foreign`). Phase 6's
   `restartServer()` has **no** health guard and would take the shared harness down. It is
   standalone-only today; registering it in the chain requires moving it to a private port
   first, the way `test_phase4_orders.js`, `test_phase5_payments.js` and
   `test_phase11_feature_control.js` already were.
2. On a **standalone** run, `releasePrivatePort` will kill a hand-started dev backend that owns
   the port — the command line matches, and the guard cannot tell an operator's process from a
   suite's. Start the backend through the chain, or expect it to be stopped.

**Verification for a changed suite** (`docs/AUTONOMOUS_BUILD_PROGRESS.md` holds the run log):
each suite must leave no listener behind.

```bash
node backend/<suite>.js
netstat -ano | awk '/:4000/ && /LISTENING/ {print $NF}' | sort -u   # must print nothing
```

## 4. Test-data isolation — which lane a suite runs in

A suite that writes to the durable store has to say *where* it writes, or the store keeps every run's
fixtures. Three lanes exist and a link declares one of them in `backend/scripts/test_chain.js`:

| Lane | What it writes | Declared as |
|---|---|---|
| shared store | rows in `public`, and only the fixtures it can name as its own | `{ file: 'x.js' }` |
| disposable clone | `chain_scratch` only; `public` is watched and a link that touches it fails | `{ file: 'x.js', isolated: true }` |
| no store | source text, a faked wire, or the in-memory Map | any link whose suite opens no socket |

### What makes the clone lane honest

`scripts/chain_scratch.js` dumps `public` schema-only into `chain_scratch`, rewrites every `public.`
reference and every `SET search_path TO 'public'`, copies the reference rows, and starts a throwaway
PostgREST behind a prefix/profile proxy on `127.0.0.1:54331`. The link is then handed
`SUPABASE_URL=http://127.0.0.1:54331` and a `DATABASE_URL` carrying
`options=-c search_path=chain_scratch`. That is only complete isolation when **both** halves follow the
search_path the link was given:

1. the suite's own `pg` handle must be built from `process.env.DATABASE_URL` — a hard-coded DSN asserts
   against `public` while the RPCs write the clone, which is issue #283;
2. every statement must name its tables **unqualified** — a `public.` prefix ignores search_path and puts
   the write and assert targets back on different schemas. This failed first in the direction you would
   not expect: the durability suite wrote `chain_scratch.merchants` through the route and then reported
   `takeaway_enabled` unchanged, because its read still said `FROM public.merchants`. Its restore was
   `UPDATE public.merchants` too, so it silently dirtied the seed merchant's tax/service/packaging rates
   in `public`, and a *different* suite went red on the bill maths that reads them;
3. catalog assertions must ask `current_schema()` instead of pinning `'public'`, and read relation labels
   from `pg_class.relname`, not `conrelid::regclass::text` — regclass shortens by search_path, so one
   constraint prints `restaurant_tables` in `public` and `public.restaurant_tables` from a clone.

Measured 2026-10-15 on `test_rms_postgres_durability.js` (27 checks) and
`test_rms_upi_billing_sales_complete.js` (17): each is green standalone on the guarded local store and
green as an isolated link on a freshly provisioned clone, with `verify` reporting
`CLEAN: 10 protected public tables unchanged` (11 names were watched **at that time** — the list is
`scripts/protected_tables.js` now and the bullets below give its current size and proof; `wallets` does
not exist in `public`)
and a 22-line `public` census unchanged before and after (22 was that run's line count; re-measured
2026-10-15 the census emits **76 lines** for `public` — 69 base tables plus 7 named-row probes) —
including `T-101`'s QR token. What that does
NOT cover, stated here because the sentence above can be misread: **both guards compare row COUNTS**
(plus the census's named-row probes), so an `UPDATE` that adds and removes no row — a merchant's tax,
service or packaging rate, a flag, a status — is invisible to `verify`, to `diff`, and to the census.
No harness step reads those rate columns; the reason the isolated links are trusted on them is that they
write the clone at all, not that a value-level check confirmed it. That limit is a rule for the next
section, not an implication.

**Two limits closed on 2026-10-15, one still open:**

- ~~`PROTECTED` watched the money and append-only tables only, then 26 names~~ — the list now lives in
  one file, `scripts/protected_tables.js:27`, and `scripts/chain_scratch.js:279` imports it. The hard
  guard counts **35 names exactly** plus **`dispatch_offers` by an append probe**; 34 of the 35 exist in
  `public` today, and `wallets` is watched in advance (no such relation exists — balances are columns),
  which is why a real `verify` prints `CLEAN: 35 protected public tables unchanged (1 protected name(s)
  not in public: wallets)`: 34 exact counts + the append-probed name, with the phantom named rather than
  hidden. The whole-run census imports the same object, so the two guards cannot disagree about what is
  watched (`chain_runner_guard_test.js` CRG-71/72/73 pin that). The additions are the tables the census
  saw move in a real run and the guard could not see: `admin_accounts`, `backend_sessions`, `drivers`,
  `notifications`, `notification_deliveries`, `payment_refund_authorizations`, `promotions`,
  `promotion_redemptions`, `grocery_price_history`, and `dispatch_offers`.
- **Why `dispatch_offers` is append-probed rather than counted.** It held 3,084,895 rows and a
  `SELECT count(*)` on them measured **1,121 ms**. (Re-measured later the same day: **3,095,401** rows —
  the table grows ~60 rows per chain run, which is #252 below.) The per-link guard runs a snapshot and a verify, so
  an exact count would have added roughly 170 s to every chain run — and 278 of those counts would have
  been measuring a table only two links can write. The probe instead counts rows whose `created_at` is
  after a baseline taken from `SELECT now()` (the database clock, not the local one, so a clock skew
  cannot hide or invent drift), which `idx_dispatch_offers_created_at` answers in milliseconds.
  Measured on a full 35-name + probe snapshot: **668 ms and 1,048 ms** wall (re-measured against
  `public`: 769 ms snapshot, 623 ms compare). The limit is documented and
  *measured* rather than asserted — `node scripts/with_local_target.js node scripts/guard_detection_probe.js`
  inserts a row carrying a pre-baseline `created_at` and reports `diff` says **NO drift** for it, then
  deletes it and reports **NO drift** again, while an exact `COUNT` would see both. That is the case the
  whole-run census (which counts every table exactly) exists to catch: the two guards are complementary,
  not redundant.
- **A guard that measures nothing must not look green.** Four refusals, all proved by the same probe:
  `NABIN_GUARD_SCHEMA` aimed at a schema containing none of the protected names throws
  `guard REFUSED: no protected table exists in … the guard would have measured nothing` (before this, a
  missing schema produced an empty baseline and **exit 0** — a passing isolation check that checked
  nothing); a baseline written for one schema cannot be compared by a guard aimed at another
  (`refusing to compare counts from two different schemas`); and `readSnapshot()` now validates the
  baseline file's own **shape** — empty/absent `counts`, a count that is not a non-negative integer, or
  no usable `appendBaseline`/`at` timestamp each throw `guard REFUSED: …` (measured before that check:
  `"counts": {}` printed `CLEAN: 0 protected … tables unchanged` at **exit 0**, and a timestamp-stripped
  baseline printed `CLEAN: 2 …` at **exit 0** while the append-probed table really held one row more,
  because losing the timestamp re-baselines the probe at verification time). The fourth is the runner
  side of the same rule: an ordinary link's attribution snapshot is now status-checked, and a failed
  snapshot is reported as `DRIFT public: BASELINE UNAVAILABLE (<cause>)` instead of silently diffing
  against the previous link's baseline — a stale baseline merges two links' writes under one link's
  number. `chain_scratch.js` also wraps `main()` so any throw prints `GUARD ERROR: <reason>` and exits 1,
  and `scripts/test_chain.js:1811` captures that marker into the link's failure lines instead of
  reddening an isolated link with an empty list.
- **The whole-run census is fail-closed, and "nothing moved" is not the same sentence as "nothing was
  measured".** That gap was the last silently-green path in this file: a failed baseline snapshot wrote
  `census.error` into `metadata.json` and nothing read it, and a compare that crashed was not recorded
  anywhere, so a run could print `77/77 links clean` and **exit 0** while its independent whole-public
  guard had never read the store. `scripts/test_chain.js` now classifies both census halves through
  `scripts/census_verdict.js` — a module rather than inline code because the only line worth pinning is
  one the regression suite must be able to call — and the outcomes are three, not two:
  `clean` and `drift` mean the census MEASURED `public`; `drift` stays report-on purpose, because a
  non-isolated link is allowed to write shared state and the per-link guard already judges it, and the
  runner says so in the line it prints (`measured; report-only`). `unavailable` means it never measured,
  and that is a **run-level problem**, not a link result: it is pushed into `censusProblems`, and
  `const problems = failures + censusProblems.length;` / `const exitCode = problems ? 1 : 0;` make it
  impossible for an unmeasured census to sit next to `0 problem(s)`. The same value reaches all four
  evidence channels — console (`CENSUS UNAVAILABLE — …`), `chain-summary.txt`, `metadata.json`
  (`censusProblems` plus `census.state`), and the `=== CHAIN RESULT … N problem(s)` marker — and a
  failed baseline deliberately leaves `census.ref` null, because a compare against a baseline that was
  never written would print `0 public line(s) moved` and read as the strongest possible result.
  `--no-census` is the one census mode that stays **report-only by operator choice**, so it is labelled
  rather than counted: `census.state: 'skipped'`, `census: SKIPPED (--no-census)` in the summary and
  `ISOLATION EVIDENCE INCOMPLETE — --no-census` on the console, and it does NOT enter `censusProblems`,
  because an opt-out is not a measurement failure and must not be counted as one. What both cases share
  is the verdict wording: neither run may be read as full isolation verification, and neither prints it.
  Executed evidence, both halves, with the link itself green:
  `chain_20261016_000026_25608_a9bec3` (baseline — `CENSUS SNAPSHOT FAILED ECONNREFUSED`,
  `census: BASELINE FAILED`, `1/1 links clean, 1 problem(s)`, exit **1**, `census.ref: null`) and
  `chain_20261015_235549_9612_3d975d` (compare — `compare exited 1 and produced no verdict line`, same
  `1 problem(s)`, exit **1**), while two runs with a valid baseline printed
  `census: CLEAN against the run's snapshot` and `0 problem(s)` at exit 0. `chain_runner_guard_test.js`
  CRG-83…CRG-96 pin the classification, the four channels, the `--no-census` label, the null-`ref`
  rule, and — with a pre-fix fixture — that the fail-closed predicate is not vacuously satisfied.
  Those `--no-census` pins are **source-pattern** pins, and a source pattern cannot see the CLI: the
  flag was unreachable. `parseCliArgs` accepted only `--list` and `--only=`, so every other token
  returned `unrecognised argument`, and the documented opt-out died in the parser before the code at
  `flagSet(argv, 'no-census')` could read it (measured 2026-10-16: `node scripts/test_chain.js
  --no-census --only=54` → `CHAIN REFUSED: unrecognised argument --no-census`, evidence in
  `backend/scratch/review_20261016/f10_no_census_subset.log`). The parser now carries `--no-census`
  into `noCensus`, the refusal help names it, `flagSet` is exported so the pin can pair the token the
  parser accepts with the literal the census step reads, and `chain_runner_guard_test.js`
  **CRG-104/CRG-105** execute both halves — `--no-census` alone, `--no-census` beside `--only=54`,
  `--no-census=1` still refused by name (so the token is matched exactly, not prefixed), and the real
  `node scripts/test_chain.js --no-census --list` exiting 0 with the help line in its output.
  A run that never reaches the census and a run that skips it on purpose look identical until
  something executes the flag.

- **A runner-owned server must not write to the store on a timer nobody owns (F-13).** Every
  `src/server.js` boot armed `setInterval(() => db.reconcileSessions(), 15000)`, and the reconciler's
  only store mutation is
  `store.from('backend_sessions').delete().lte('expires_at', nowIso)` against whatever `liveStore()`
  serves — the schema the process targets, which for the shared harness is `public`. So an isolated
  link could find `public` rows deleted by a timer it neither started nor could see, and the whole-run
  census would report the drift with no link to attribute it to. Reproduced against a **disposable
  clone** (never `public`): six expired rows were gone **15,053 ms** after that instance answered
  `/api/health` (`backend/scratch/review_20261016/f13_prune_repro_15000.json`; the same clone with
  `NABIN_SESSION_RECONCILE_MS=0` retained all six).
  The fix is a boot gate, not a behaviour change in production: `NABIN_SESSION_RECONCILE_MS` unset keeps
  the shipped 15000 ms interval, `0`/`off` never arms the timer and logs that plainly, and any other
  value must be a positive integer or it is **warned about and defaulted** to 15000 rather than trusted.
  Both runner-owned spawns (harness and lane) pass `'0'`. Because a suite may legitimately need
  cross-instance convergence, the write half is separable: `reconcileSessions({ prune })` defaults to
  `true` (an ordinary tick still prunes), and `NABIN_SESSION_PRUNE=off|0` makes the tick read-only —
  the opt-in is the read-only half, never the default.
  Why two links went red first: `getSessionByToken` reads **this process's map only**, so adopting a
  row another instance wrote *is* the reconcile tick, and there is no other bridge.
  `admin_authorization_test.js` (RX) and `admin_customers_test.js` (INP-21/22) now boot their own
  short-interval, prune-off instance via `scripts/spawned_server.js:spawnConvergingInstance` and prove
  adoption over HTTP against *that* base. Two ordering facts there are load-bearing, not stylistic: the
  converging instance boots **after** the account is suspended (its boot hydration must copy
  `SUSPENDED`, and `INP-26` deliberately measures the opposite stale-copy exposure), and the foreign
  session row is inserted **after** that boot has answered health, so hydration is ruled out and the
  only path from the row to a 200 is a tick. Measured on the two-link subset
  `chain_20261016_013633_21396_56969e`: 2/2 links clean, RX-01 honoured after 1528 ms of polling on
  `:57579`, INP-21 `403 ACCOUNT_SUSPENDED` on `:57657`, and `backend_sessions` drift in that run was
  **append-only** (+2, +1 — the suites' own rows), i.e. no DELETE happened.
  `chain_runner_guard_test.js` **CRG-97…CRG-103** pin both ends: the two spawns disable the timer, the
  pre-fix spawn env is rejected by the same predicate, the interval is armed only behind the gate on the
  parsed value with the write named at the call site, `prune = true` stays the default with the DELETE
  inside `if (prune)`, and `NABIN_SESSION_PRUNE` is decided before the timer is armed. The hazard is
  also counted rather than merely avoided — `backend_sessions` is an **exact-count** protected table
  (CRG-101), so a prune inside an isolated window would surface as `1 -> 0`, which is the one shape the
  guard cannot miss, and `guard_detection_probe.js` case 6 plants exactly that delete.

- Because a curated list still cannot answer "what else moved?", the independent guard is a
  **full-schema census** — every base table in the schema, discovered from `pg_tables`, plus per-marker
  order counts and each floor table's stored QR token (76 lines for `public` today: 69 base tables + 7
  named-row probes). It lives
  at `scripts/test_store_census.js` (promoted from gitignored `scratch/` on 2026-10-15) and is wired
  into the chain: `scripts/test_chain.js` snapshots it before link 1 and compares it after the last
  link, printing the drift lines into the run evidence. Its detection ability is proven, not assumed —
  `selftest` seeds a disposable `nabin_census_guardprobe` schema with a copy of **every table the guard
  claims to cover** (plus one synthetic table that is deliberately *not* covered), writes one row into
  each, and requires both that every covered name moved 0 → 1 **and** that the uncovered one is
  classified UNPROTECTED. Measured 2026-10-15:
  `SELFTEST PASS: every one of 11 obligation table(s) counted 0 -> 1 [products, dispatch_offers, admin_accounts, backend_sessions, drivers, notifications, notification_deliveries, payment_refund_authorizations, promotions, promotion_redemptions, grocery_price_history], and nabin_guard_probe_uncovered counted 0 -> 1 while classifying as UNPROTECTED; 12 census line(s) compared, 0 unchanged`,
  then `teardown: DROP SCHEMA nabin_census_guardprobe CASCADE, confirmed absent`. Shared `public` is
  read-only to that probe: `public.orders` and `public.products` were re-counted after the run and
  matched their pre-run values.
- **The hard guard's own detection is proved the same way**, because `selftest` only exercises the
  census: `node scripts/with_local_target.js node scripts/guard_detection_probe.js` builds two
  disposable schemas holding the 35 protected definitions, points the *real* `chain_scratch.js` guard at
  one of them through `NABIN_GUARD_SCHEMA`, and measures five things — a row in each newly protected name
  reddens `verify` (exit 1, `CONTAMINATION`, one `DRIFT` line per table), a back-dated `dispatch_offers`
  row does not (the append probe's documented blind spot, and the case the census covers), rows written
  only to the stand-in **clone** schema leave `verify` CLEAN at exit 0, both silently-blind schema
  configurations refuse, and three malformed-baseline shapes (empty `counts`, no timestamp, a null count)
  refuse instead of printing CLEAN — each planted against a database state whose *valid* baseline
  reddens `verify`, so a refusal can only mean the baseline itself was rejected. Measured 2026-10-15:
  `PROBE PASS: 10 newly protected table(s) reddened the hard guard, writes to the stand-in clone stayed
  CLEAN, the cross-schema and empty-schema guards refuse, and 3 malformed-baseline shapes refuse instead
  of reporting CLEAN`, exit 0, with both probe schemas dropped and confirmed absent and
  `.chain-scratch/snapshot.json` restored to the state it was found in (absent on a clean tree, because
  the guard has one state file and the probe necessarily overwrites it). `public` was re-counted after
  the probe and no table moved; the probe refuses to run at all if that file holds a live `public`
  baseline, so it cannot interleave with a chain run.
- ~~`test_fixtures.js` resolves its handle from `NABIN_PG_NOTIFY || <fixed DSN>`, never `DATABASE_URL`~~
  — it now resolves options > `DATABASE_URL` > `NABIN_PG_NOTIFY` > loopback DSN, keeps the clone's
  `search_path` option, prints the source it used on the handle (`fx.target`), refuses a non-loopback
  or unparsable target **by naming the variable** instead of falling back, and discovers child FKs
  against `current_schema()` rather than a hard-coded `public`. So a clone link can no longer verify
  one schema while writing another.
- **Still open:** a suite that authenticates by injecting its tokens into `db.activeSessions` **of its
  own process** cannot join the chain at all — it only answers on the server it spawns itself. That is
  why `test_rms_e2e_integration.js` is not a link.

### Why residue is contained rather than deleted

Deletion was investigated and is **not implemented**, because it cannot be demonstrated safe. Measured
from the live catalog on 2026-10-15 by reading `pg_constraint` for every FK whose `confrelid` is
`public.orders` (an earlier pass left its raw output in the gitignored `backend/scratch/`, which is only
a local artifact — that catalog read is the reproducible source):
exactly five relations carry an enforced FK to `public.orders`, all five columns are `uuid` —
`order_lines`, `order_transitions`, `order_creation_tokens` and `restaurant_kds_tickets` `ON DELETE CASCADE`,
`checkouts` `ON DELETE SET NULL` — while `payments.payment_id`,
`payment_sessions.order_id`, `ledger_entries.reference_id` and `journal_transactions.reference_id` are
`varchar` **soft** references with no enforced FK. Deleting an order row therefore drops its lines and
tickets, nulls the checkout that named it, and silently orphans any money row that names it. The DB does
permit the delete for a privileged role (migration 033 made `prevent_client_financial_record_mutation()`
return `OLD` for roles outside `anon`/`authenticated`, so the rows really go); what makes it unsafe is the
orphaning above plus the absence of any order-deletion route and the project rule that orders are
immutable. The safe path — and the one already taken — is
ownership-scoped cleanup: delete only rows the run can name as its own, and prove it with a before/after
snapshot of every table it could have touched.

The RMS suites now accumulate zero, measured **in** the chain: run `chain_20261015_144952_5972_98640b`
(77 links, 77/77 clean, 3,043 checks, 2 skipped lines, exit 0) reported links 76 and 77 as
`exit 0, 27 passed` and `exit 0, 17 passed` with `DRIFT public: CLEAN (hard guard enforced)`, and the
whole `restaurant_*` family, `T-101` and both fixture-marker counts were unchanged in `public` across all
77 links (`public.orders[RMSSPEC-*]` and `[E2E-*]` still 0). 2,999 + 27 + 17 = 3,043 — the two new links
added exactly their own checks and nothing else moved.

The order residue that used to grow with every run is **closed**, measured in-chain. Before the three
booking suites were given a lane backend, they wrote 8 durable orders to `public` per full run
(`test_suite.js` `1342 -> 1343`, `geo_adversarial_test.js` `1343 -> 1349`,
`place_substitution_test.js` `1349 -> 1350`). Run `chain_20261015_170317_21760_9af0a5` (77 links,
77/77 clean, 3,067 explicit passing checks, 2 skipped lines, exit 0, `subset: null`, 739 s) contains
**no `public.orders` drift from any link**: `orders 1350 -> 1350`, `order_lines 1451`, `checkouts 339`,
`merchants 80`, `products 61` unchanged, and links 1, 5 and 54 each reported
`DRIFT public: CLEAN (hard guard enforced)` with their own lane backend on `:4200` started and reaped.
Re-running link 54 twice outside the chain (`chain_20261015_172409_7408_a577d9`,
`chain_20261015_172755_23076_27b330`, both `1/1 links clean`, exit 0) left the whole-run census CLEAN
both times, which is the repeated-run proof that the lane holds rather than a one-off.

What still moves in `public` per full run is identity, audit and money rows — never order rows. Run
`chain_20261015_214806_26112_471075` (77 links, 77/77 clean, 3,081 explicit passing checks, 2 skipped
lines, exit 0, 768 s) is the run that reconciles the two guards table by table: its census has 74
baseline lines and 20 that changed, **every one tagged `[protected]` and none `UNPROTECTED`**, and the
runner's per-link `drift[]` contains 133 mover lines over those same 20 names whose per-link sums equal
the census deltas exactly. 38 links printed CLEAN (9 isolated `hard guard enforced`, 29 ordinary
`35 protected tables unchanged`); the remaining 39 named their own writes.

| mover (delta) | owner links, with rows added |
| --- | --- |
| `dispatch_offers` +10,506 | [7] +1,751, [12] +3,502, [20] +3,502, [23] +1,751 |
| `audit_logs` +1,201 | 36 links; largest [14] `admin_authorization_test.js` +935, then [15] +34, [7] +33, [13] +18, [12] +17 |
| `backend_sessions` +61 | 26 links; largest [59] +10, [7] +8, [58] +5 |
| `journal_lines` +86 | 13 links; largest [22] +16, [35] +12, [36] +10, [37] +10 |
| `journal_transactions` +43 | 13 links; largest [22] +8, [35] +6, [36] +5, [37] +5 |
| `notifications` / `notification_deliveries` +20 each | the same 5 links: [20] +5, [36] +5, [7] +4, [12] +4, [23] +2 |
| `drivers` +10 | 9 links, +1 or +2 each ([26], [29] +2, [31]–[35], [37], [70]) |
| `driver_payouts` +9 | [35] +4, [37] +5 |
| `admin_accounts` +7 | [13] +4, [15] +3 |
| `ledger_entries` / `payments` +7 each | [36] +5, [70] +2 |
| `jobs` +6 | [7] +1, [12] +2, [20] +2, [23] +1 |
| `payment_refund_authorizations` +6 | [36] +5, [70] +1 |
| `payment_webhooks` +2 | [7] +1, [70] +1 |
| `users` +2 | [35] +1, [37] +1 |
| `promotions` / `promotion_redemptions` +1 each, `grocery_price_history` +1, `payment_sessions` +1 | [7], [7], [65], [70] |

`dispatch_offers` is now composed arithmetic, not an estimate: 10,506 = **6 bookings × 1,751 drivers**.
The four links above are the only ones that book a ride or parcel against the shared harness — [7] and
[23] make one booking each, [12] and [20] two each — and each booking writes one offer row per
non-suspended driver of the boot-hydrated fleet (`src/server.js:4248` ride, `:4453` parcel, both through
`DispatchRepository.createOffersForDrivers`). No retry loop and no duplicate offer: the per-link count
divides by 1,751 with remainder 0 for all four links. The growth the census reports per run is therefore
*expected fan-out* times a *growing fixture fleet* — `drivers 1751 -> 1761` (+10, attributed above) makes
the next run's fan-out ~+60 offers larger. Removing the residue would mean weakening production dispatch,
so #252 stays an open owner decision; the volume is attributed, not swept. These are financial and audit
rows: the project rule is that orders, payments and ledger entries are immutable, so the correct action is
to attribute them and report them, not to sweep them.

**The 20 movers above are now all inside the per-link hard guard** (was 14 of 20). `scripts/protected_tables.js`
is the single list `chain_scratch.js` and `test_store_census.js` both read, so a table that moved in a
run cannot sit outside the guard the way `backend_sessions`, `drivers`, `notifications`, `promotions`
and `dispatch_offers` did when this paragraph was written.

The narrow, documented write exception is a **division of enforcement, not a whitelist of tables**:

- an **isolated** link (1, 5, 48, 49, 50, 51, 54, 76, 77) may move **no** protected name in `public`.
  `verify` compares the pre-suite baseline and a drift makes the link fail, so for these nine links
  there is no exception at all — they write the clone.
- a **non-isolated** link is expected to write `public`, and that is what the lists above attribute.
  `diff` reports the movement per link and does not fail it, because a link that books a job, settles a
  payout, mints a session or audits an admin action is doing the thing the suite exists to test.
  The exception is therefore per *link class*, named by the runner's own `isolated` flag, and the
  per-link `drift[]` in `metadata.json` is what pins each intent to the link that performs it.
- a mover in **neither** the exact-count list nor the append-probe list is printed by the census as
  `[UNPROTECTED - add it to scripts/protected_tables.js]` and summarized on one
  `UNPROTECTED MOVERS:` line, so an intentional write that nobody documented becomes visible instead
  of silently absent.

### Checking a suite's lane before registering it

One committed command does the whole sequence — provision the clone, hand the suite the link env,
snapshot `public`, boot a **lane backend** on its own port with that env, run the suite against the
lane, stop the lane, `verify` the clone, compare the census, and tear the clone down:

```bash
cd backend
node scripts/with_local_target.js node <suite>.js                        # green with the gate open
node scripts/with_local_target.js node scripts/lane_check.js <suite>.js --lane-server
```

`scripts/lane_check.js` (promoted from gitignored `scratch/tmp_isolated_suite_runner.js` on
2026-10-15) prints one verdict line and its exit code is the AND of three independent measurements:

```
=== LANE VERDICT <suite> suiteExit=N failMarkers=N verifyExit=N census=CLEAN|DRIFT(n)|SKIPPED lane=PORT|none green=BOOL ===
```

`exit 0` means: the suite was green **and** `chain_scratch verify` found no protected-table drift
**and** the full `public` census is byte-equal before/after. Read all three, not just the suite:
a suite can be green while its HTTP writes land in `public`, which is exactly what `--lane-server`
prevents (without it, `link.env` reaches only the suite's own `pg` handle and every write that
travels over HTTP goes to whichever backend is answering `:4000`). Options: `--keep` leaves the clone
up for a follow-up read, `--no-census` skips the census and then prints that isolation is **not**
proven. The suite's raw output is teed to `.chain-logs/lane/<utc-stamp>/<suite>.raw.log` — read the
file from *this* run; a stale log from a previous attempt produced a false pass report on 2026-10-15.
The census is also usable directly (`node scripts/test_store_census.js snapshot public --out f.json`,
`compare public --ref f.json`), and `selftest` proves the comparison detects a deliberate write in a
disposable schema without touching `public`.

Two mechanics that have bitten: `link-env` must be run under `with_local_target.js` — it refuses to
guess a connection target otherwise — and if a previous proxy still holds `:54331`, `provision` fails
loudly at step 4; run `node scripts/chain_scratch.js teardown` first.

### Running part of the chain

```bash
cd backend
node scripts/test_chain.js --list                       # every registered link, with its lane options
node scripts/test_chain.js --only 54                    # by registration number (space form)
node scripts/test_chain.js --only=54                    # same selection, `=` form
node scripts/test_chain.js --only place_substitution    # exact basename, with or without .js, or a fragment
node scripts/with_local_target.js node scripts/test_chain.js --only 54   # the lane-aware form
```

`--only` is the subset filter the lane recipe used to lack; the runner names the selection, refuses an
unknown or ambiguous token before creating a run directory, and marks `metadata.json` with the subset
so a partial run is never mistaken for full-chain evidence (the `chain_runner_guard_test.js` link,
CRG-41…CRG-70, pins all of that).

Two argument-accounting defects closed on 2026-10-15, both found by running the documented command
rather than reading the code. `main()` used to look only for `--only=<value>`, so the space form this
file documented parsed as "no subset requested" and booted **all 77 links** while the operator believed
they had asked for one — an ignored flag is the dangerous direction, because the run is bigger than
requested and nothing on screen says so. `scripts/test_chain.js` now routes every argument through
`parseCliArgs`, accepts `--list`, `--only=<v>` and `--only <v>`, and exits 1 naming any other argument
(`--onlyy 54`, a bare filename, a valueless `--only`, a doubled `--only`). And a fragment was refused
even though the recipe promised it, so `selectLinks` now honours one **only when exactly one registered
link matches**: `--only geo` selects nothing and prints `4:geo_policy_test.js, 5:geo_adversarial_test.js,
6:geo_anon_access_test.js` before exiting 1. The link number printed in `[N/77]` is the registered
number from `--list` and `metadata.json` — it used to be the loop position, which showed `test_suite.js`
as `[2/77]` and `place_substitution_test.js` as `[55/77]`, and `HARNESS_UNREACHABLE` named the *next*
link instead of the dead one.

The three booking suites (`test_suite.js` 1, `geo_adversarial_test.js` 5,
`place_substitution_test.js` 54) are registered `{ isolated: true, laneServer: true }`. `isolated` alone
is the trap it guarded against: it repoints the suite's own `pg` handle at `chain_scratch` while every
HTTP write still lands in `public`. Moving link 1 onto the lane raised the question of whether later
links read rows it used to leave in `public`; the empirical answer is the 77/77 clean run above, with
every other link unmodified in the same run.
