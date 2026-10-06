# GEO ADVERSARIAL + RESTART ROOT-CAUSE INVESTIGATION

Date: 2026-09-28. Local Docker Supabase only (`127.0.0.1:54321` / `:54322`), verified before every
database operation by each script's own loopback guard. No commit, no push, no staging, no deploy.

## 1. Starting HEAD

`9924138b1d19a3e9e176e1e7883b3c44b23762e6` — unchanged throughout, and unchanged at the end.

## 2. Working tree at start

```
 M backend/scripts/test_chain.js
 M backend/src/database.js
 M backend/src/server.js
?? backend/merchant_auth_failclosed_test.js
?? backend/operator_permissions_migration_test.js
?? backend/reports/  backend/snapshot_phase21.js  .kilo/agents/  graphify-out/
?? docs/proposed/OPERATOR_PERMISSIONS_PROGRAM.md
?? mobile/devtools_options.yaml
?? supabase/migrations/030_merchant_inventory_integrity.sql
?? supabase/migrations/032_operator_permissions_store.sql
```

Ports 4000 and 4100 were both free at the start. No unrelated process was killed; the only
processes terminated were the local test servers started during this investigation (PIDs recorded
in the session: 31940, 14584, plus each harness's own child).

## 3. OP-1 status: verified intact, not re-done

`supabase/migrations/032_operator_permissions_store.sql` and
`backend/operator_permissions_migration_test.js` both present; OP-1 was not modified for this
investigation. Equivalence re-measured during this task: **1,709 / 1,709, 0 mismatches** (in the
focused gate and again as chain link 40).

## 4. Geo adversarial — original reported failure

Chain link **[5] `geo_adversarial_test.js`**: 55 passed, **7 failed**. Standalone immediately
after: **exit 3, no output**.

## 5. Geo standalone behaviour — ROOT CAUSE: PROVEN

`geo_adversarial_test.js` **never starts a server**: `BASE = process.env.GEO_TEST_BASE ||
'http://127.0.0.1:4000'` (line 47). `main()` logs in at line 973, and line 980 does:

```js
const adminHeaders = { Authorization: `Bearer ${relogin.data.token}` };
```

With nothing on :4000 the request helper yields no body, so `relogin.data.token` throws a
TypeError, caught by the top-level `main().catch()` at line 1034 which prints
`GEO ADVERSARIAL ABORTED:` and calls `process.exit(3)` (line 1036).

**"No output" was my own filter, not the test's silence.** The previous session's run piped
through `Where-Object { $_ -match 'PASSED|FAILED|SUMMARY' }`, which excludes the ABORTED line.
The abort was then re-run with full capture and the message is present.

Classification: **test-precondition / environment problem — the suite requires a backend it does
not start.** Not a product defect, not OP-1. It also explains the `[0s]` duration: it died on the
first login attempt.

## 6. Geo chain behaviour — the 7 failures

The chain log is the evidence, and it points one direction:

| id | chain (FAILED) | warm standalone (PASS) |
|---|---|---|
| MTX-R04 | `₹105, ₹105, ₹NaN` | `₹105, ₹105, ₹105` |
| MTX-R05 | matched `Connaught Place CBD Boundary`, m=1.4, ₹144 | same, passes |
| MTX-R06 | `inside ₹NaN vs outside ₹105` | `inside ₹144 vs outside ₹105` |
| MTX-R07 | `₹NaN / ₹NaN` | `₹105 / ₹105` |
| MTX-R09 | failed | passes |
| INV-07 | `job fare ₹NaN = server quote ₹144` | `job fare ₹144 = server quote ₹144` |
| SEC-05 | `₹NaN then ₹144, duplicate=true` | `₹144 then ₹144, duplicate=true` |

The invariant across all seven: **the server's own quote was correct (₹144) while the persisted
booking/job fare arrived undefined → NaN.** Arithmetic on `undefined`, not on a NULL column
(`surge_zones.surge_multiplier` has **0 NULLs** across 445 rows).

Reproduction attempts, all against the current code and database:

| condition | result |
|---|---|
| warm server, health + `/api/ready` 200, single run | **62 PASSED, 0 FAILED** |
| `geo_policy_test.js` → `geo_adversarial_test.js` (the immediate chain predecessor) | policy 55/0, adversarial **62/0** |
| full chain prefix links 1→5 (`test_suite`, `session_reconcile_pagination`, `boot_mirror_read`, `geo_policy`, `geo_adversarial`) | 446/0, 26/0, 20/0, 55/0, **62/0** |
| `geo_adversarial_test.js` ×5 on one warm server | **62/0, 62/0, 62/0, 62/0, 62/0** |

**ROOT CAUSE OF THE 7 CHAIN FAILURES: NOT PROVEN.** The mechanism is identified (booking fare
resolves to `undefined` in the chain context only) but the four controlled conditions above did
not reproduce it, so no explanation is offered that the evidence does not support.

### Prime suspect, recorded with the measurement behind it

`geo_fences` holds **447 rows for only 6 distinct `zone_name` values**:

```
Noida IT Sector 62 Boundary      188
South Delhi Hospital Corridor    185
Restart Test Aero City Zone       71
IGI Airport Terminal 3 Zone        1
Connaught Place CBD Boundary       1
Cyber City DLF Phase 2 Corridor    1
```

and `surge_zones` holds 445 rows, all `ACTIVE`, 257 distinct `zone_id`s. These are **duplicate
ACTIVE boundaries accumulated across many historical runs** — 71 of them named for
`restart_test.js`, whose own comments (lines 148-150) say that until recently "one run left 1
`geo_fences` row and 1 `surge_zones` row behind, permanently". With hundreds of overlapping ACTIVE
boundaries, "which boundary matches this point" is decided by the order rows arrive in, and the
observed signature (quote right, booking fare undefined) is what a match resolving to a row the
pricing path cannot read would produce.

`geo_adversarial_test.js` cannot clean this itself: `sweepGeoAdv` (line 699) filters
`f.name.startsWith('GeoAdv ')`, but **`geo_fences` has no `name` column** — its label column is
`zone_name`. Its own probe fences are therefore matched only if the admin route maps `name` from
something else; duplicates created by *other* suites (188/185/71) are outside its sweep by design
either way. Querying `GeoAdv%` directly returns **0 rows**, so its probes do not persist; the
373 duplicates belong to other suites.

This is a **fixture-accumulation / database-state problem in the local test store**, and it is the
first thing to attack if the chain failure reappears. It is NOT classified as fixed, and no
cleanup was performed as part of "making it green" — deleting 373 rows that some suite created
without first proving which suite owns them is exactly the kind of unattributed mutation this
project forbids.

## 7. OP-1 interaction — measured, §6/§8

OP-1 added exactly one durable step to boot: `loadAuthorizationStore()`, 4 paged reads.

```
loadAuthorizationStore() per call: 71.0, 43.5, 11.0, 8.7, 10.8 ms
average 29.0 ms, max 71.0 ms
against a measured boot-to-health of ~13,000 ms  →  ≤ 0.55%
```

Boot-to-health measured at 13s (first two runs tonight) and 7s (later, warm). Neither geo result
nor restart result changed with the store's presence: the same 13s boot passed 40/0 standalone
before the fix and 62/0 for geo. **OP-1 caused neither failure. OP-1 REGRESSION: NO** — supported
by the measurement above, not by assumption. No OP-1 file was modified during this investigation.

## 8. Restart test — ROOT CAUSE: PROVEN

Facts, each measured:

* What listens on 4100: only the backend **that this suite itself spawns**. The chain allocates a
  private port (`restart_test.js` is marked `privatePort: true`; `RESTART_PORT =
  Number(process.env.NABIN_RESTART_PORT || 4000)`), and the suite spawns
  `src/server.js` with `PORT: String(RESTART_PORT)`.
* Readiness condition: `GET /api/health`, polled every 250 ms.
* Old timeout: `for (let i = 0; i < 40; i++)` → **10,000 ms**.
* Actual readiness: **~13,000 ms** cold, ~7,000 ms warm.

**The window was shorter than the thing it waited for.** Worse, on expiry
`ensureServerRunning()` executed `return proc;` — reporting success without readiness — so the
suite continued and died several assertions later as a bare
`Fatal Restart Test Exception: Error: connect ECONNREFUSED 127.0.0.1:4100`, which names the
symptom and hides the cause. In-chain the shared backend is already serving and the second one
boots slower, which is why it failed at link [7] and passed standalone.

Classification: **test-harness defect — incorrect readiness detection** (the second example in
§12). Not a product defect, not a resource leak, not OP-1: ports were verified free, the suite
reaps its own children (4000 free after every run), and no connection pool limit was reached.

## 9. Fix applied (evidence-based, minimal)

`backend/restart_test.js`, `ensureServerRunning()` only:

* the fixed 40-iteration count became a **deadline-bounded condition poll**
  (`READY_DEADLINE_MS = 60000`, still returning the instant health answers — no added sleep);
* expiry now **throws with what was observed** (port, whether the process was alive or had exited)
  instead of returning as if ready.

60s was chosen as a margin above the measured 13s cold boot, not as an arbitrary number; the
behaviour it prevents is the silent "ready" that produced the misleading ECONNREFUSED. No
assertion, expected value, or security check was changed anywhere, and no product file was touched.

## 10. Results after the fix

`restart_test.js` standalone: **exit 0, 40 PASSED, 0 FAILED** ×3 recorded explicitly (a preceding
×5 run also exited 0; its summary lines did not render in the console capture, so those five are
reported as exit-code evidence only, not as counted results).

`geo_adversarial_test.js` on a warm server: **62 PASSED, 0 FAILED ×5**.

Full chain after the fix (`node scripts/test_chain.js`, 40 links, shared backend on a port the
harness owns and reaps):

```
=== CHAIN RESULT: 38/40 links clean, 2 problem(s) ===
1664 explicit passing checks reported, 0 skipped line(s) across the chain
teardown: pid 15296 reaped, :4000 free

[ 5/40] geo_adversarial_test.js ................ exit 0, 62 passed, 77s
[ 7/40] restart_test.js ......... private port 4100 ... exit 0, 40 passed, 29s
[24/40] financial_authority_test.js ............ EXIT 1  (FIN15B-20 — baseline)
[25/40] driver_earnings_identity_audit_test.js . EXIT 1  (IDENT-09/10 — baseline)
[40/40] operator_permissions_migration_test.js . exit 0, 65 passed, 1s
```

**Both investigated links now pass in the genuine chain condition**, not merely standalone: link
[5] 62/0 and link [7] 40/0 with `restart_test.js` owning private port 4100 as designed. The two
remaining problems are the documented human-authority baseline items, unchanged.

## 11. Known baseline failures preserved

`FIN15B-20` (`financial_authority_test.js`) and `IDENT-09`/`IDENT-10`
(`driver_earnings_identity_audit_test.js`) were not modified, not skipped, and not reclassified.
`MTI-25` (`merchant_tenant_isolation_test.js`) was not touched. No authorization test was altered.

## 12. Remaining failures

* `[24] financial_authority_test.js` — FIN15B-20: probe wallet residue across 246 drivers;
  pre-existing, human authority required to settle it, deliberately not modified.
* `[25] driver_earnings_identity_audit_test.js` — IDENT-09 / IDENT-10: pre-existing measurement,
  human authority, deliberately not modified.
* **Geo link [5]'s seven chain failures did not recur in the post-fix chain run, and the root
  cause of that occurrence is still NOT PROVEN.** What is established: the exit-3 half of the
  original report is fully explained (§5, proven); the ₹NaN half has a named prime suspect with
  measurements behind it (§6, 373 duplicate ACTIVE boundary rows in a local test store) and did
  not reproduce across four controlled conditions plus one genuine chain run. It is recorded as an
  open mechanism, not closed as fixed and not called flaky.
* **Recommended next step if it recurs:** capture, at the moment of failure, which `geo_fences` row
  the booking path matched and what that row's `surge_multiplier` / `surcharge_amount` resolved to
  — and separately decide which suite owns the 188 / 185 / 71 duplicate rows, since a sweep that
  matches on a column the table does not have (`f.name` vs `zone_name`) cannot clean any of them.

## 13. Production safety

Local only: every script used here refuses a non-loopback `SUPABASE_DB_URL` before connecting, and
the chain harness refuses `NODE_ENV=production`. No secrets printed — `SUPABASE_SERVICE_ROLE_KEY`,
tokens, and payment secrets were never echoed. No production host contacted, no deployment.

## 14. Files changed by this investigation

* `backend/restart_test.js` — readiness detection (the fix above).
* `backend/scratch/geo_state.js`, `geo_state2.js`, `op1_bootcost.js` — read-only probes
  (diagnostic directory).
* this report.

**Deliberately untouched:** `supabase/migrations/032_operator_permissions_store.sql`,
`backend/operator_permissions_migration_test.js`, `backend/src/database.js`,
`backend/src/server.js`, `backend/src/adminPermissions.js`, `geo_adversarial_test.js`
(its precondition gap is documented in §5, not "fixed" by editing assertions),
`financial_authority_test.js`, `driver_earnings_identity_audit_test.js`,
`merchant_tenant_isolation_test.js` (MTI-25), and the 373 duplicate geo/surge rows.
