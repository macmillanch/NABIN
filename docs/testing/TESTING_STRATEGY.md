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
