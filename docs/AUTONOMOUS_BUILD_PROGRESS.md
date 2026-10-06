# Autonomous Build Progress — checkpoint log

Local working log for the sprint. Not committed. Times are Singapore time (UTC+8).

---

## 2026-09-29 ~21:40 — Super Admin Command Center: first slice

**STATUS: implemented and verified (lint + production build).** Backend untouched.

### Built

Admin Web (`admin-web/`, Next.js 16 / React 19), extending the existing shell rather than
replacing it:

- **Shell** — `components/AdminLayout.tsx`: nine command-centre sections (Overview, Operations,
  Finance, Support, KYC, Marketing, Security, Audit Logs, Settings) plus a `Records` group keeping
  the screens that already existed (Customers, Drivers, Merchants, Jobs/Orders) so nobody loses a
  page they use. Nav entries carry the permission the server actually guards the route with; the
  existing `holdsPermission` helper from `lib/access.ts` decides visibility, and its documented
  invariant — hide for usability, never as authorisation — is unchanged.
- **Header** — operator identity (name + role), sign-out, and two **deliberately inert**
  placeholders: global search and the alerts area. No `/api/admin/search` and no alert feed
  exist, so both are labelled as not wired rather than rendering empty results an operator would
  misread as "no matches".
- **New shared primitives** — `components/DataPanel.tsx`: `useAdminData` (loading / ready / error
  / unavailable / empty as five distinct states, per-panel source endpoint, last-read timestamp,
  refresh), `Panel`, `MetricGrid`, `RecordsTable`, `StateBlock`, `Badge`, `money`, `count`,
  `UNAVAILABLE`. Reads go through the existing `lib/api` axios client, so the token/base-URL
  handling is not duplicated.
- **Five config-driven screens** — `components/modules.tsx` + thin routes:
  `/finance` (`/api/admin/finance/metrics`), `/support` (`/api/admin/support`),
  `/kyc` (`/api/admin/identity-verifications`), `/audit` (`/api/admin/audit-logs`),
  `/settings` (`/api/admin/platform-settings`).
- **`/operations`** — service switchboard from `/api/admin/services/status` + `/api/admin/metrics`
  + `/api/admin/jobs`, with **working pause and resume** through the existing `adminApi` wrappers
  (addressed by `serviceId`, the payload the client already documents), a required reason of five
  characters or more, the server's own refusal words shown on a 403, and the switchboard re-read
  after every attempt so the screen matches the server either way.

### Evidence first, not guessed

A read-only survey (`backend/scratch/admin_shape_survey.js`, GET only, local server it spawned and
killed) captured every response shape before any component was written. It changed three
assumptions I would otherwise have coded blind:

- `/api/admin/support` returns **1,000 ticket rows** — a page, so the screen shows `total`
  separately from rows rendered instead of implying it is the whole queue.
- `/api/admin/finance/ledger-double-entry` returns **7,642 entries** — not put on screen.
- `/api/admin/identity-verifications` carries **both** `aadhaarNumberRaw` and
  `aadhaarNumberMasked`. The KYC screen renders the **masked** field and phone last-four only.

### Deliberately not done

- **Kill-switch not wired.** Its request body is unverified against the route, and a guessed
  payload behind a platform-wide stop is the worst place to experiment. The page states the gap;
  the speculative client wrapper was removed again. Next slice: read the route, then wire it with
  confirmation.
- No support assign/resolve, no settings writes — the read surface ships before the write controls.
- **No fabricated numbers anywhere.** Every metric renders `Data unavailable` unless an endpoint
  returned it; `0` is only ever shown when a `0` came back.

### Tests run (freshly executed)

| check | result |
|---|---|
| `eslint src` (admin-web) | **exit 0** — 0 errors, 2 warnings (1 pre-existing in `lib/api.ts`, 1 `useMemo` advisory in `modules.tsx`) |
| `npm run build` (admin-web) | **exit 0** — TypeScript clean, **15 routes** generated incl. `/operations` `/finance` `/support` `/kyc` `/audit` `/settings` |
| backend suites | **not run** — no backend file was modified in this slice (git diff confirms: `admin-web/**` only, plus scratch/docs) |

Not claimed: any end-to-end/behavioural test of these screens. There is no Admin Web test harness
in this repo (`package.json` exposes `dev/build/start/lint` only), so a browser-level verification
pass is still outstanding and should not be described as done.

### Files

Added: `admin-web/src/components/DataPanel.tsx`, `admin-web/src/components/modules.tsx`,
`admin-web/src/app/{operations,finance,support,kyc,audit,settings}/page.tsx`.
Modified: `admin-web/src/components/AdminLayout.tsx`, `admin-web/src/lib/api.ts` (read-only
wrappers for endpoints that already exist).
Scratch/docs: `backend/scratch/admin_shape_survey.js`, this file.

Unchanged: everything under `backend/src/`, all migrations, `adminPermissions.js`, OP-1 store and
gate, `geo_adversarial_test.js` (its new failure-only diagnostics are preserved), geo/surge data.

### Baseline failures (untouched, per instructions)

`FIN15B-20`, `IDENT-09`, `IDENT-10`, `MTI-25`.

### Next task

Operations slice 2: verify the `services/emergency-killswitch` request body against the route and
wire it with confirmation step; then Support assign/resolve controls; then the Admin Web
behavioural pass against a running local backend.

---

## 2026-09-29 — TASK 4F: KYC approval-validation investigation

**STATUS: complete as an investigation. KYC UI NOT built — a backend validation defect blocks it.**

Theme editor: ESLint **exit 0** (0 errors, 2 warnings, both pre-existing/advisory); production build
**exit 0**. `APP_CONFIG_THEME` final state `{}` (restored and verified in 4D; nothing written since).

Audit verification (read-only, `public.audit_logs`, 153,568 rows): the theme probe's write and its
restore BOTH produced records — `PLATFORM_SETTINGS_UPDATED`, `admin_name "System Administrator"`,
`role SUPER_ADMIN`, `target_entity_id APP_CONFIG_THEME`, `new_state PUBLISHED`, at
`2026-09-28T18:38:43.687Z` and `.717Z`. The table also carries `request_id`, `correlation_id`,
`success`, `failure_reason`, so write-side correlation exists even if this probe did not capture it.

### KYC review contract (read from `reviewIdentityApplication`, database.js:3682-3775)

Chain: `authenticateAdmin` → `requirePermission('identity_verification.review')` →
`requireIdentityDecision` (decision → `identity_verification.approve` / `.reject` /
`.request_resubmission`; an unknown decision passes through and the method returns 400).
Body: `{ decision, reason, checklist }`. All branches call `auditAppliedChange`
(module `IDENTITY_VERIFICATION`, action `APPROVED`/`REJECTED`/`RESUBMISSION_REQUESTED`,
previous/new state). No transaction wrapper — mirror mutation and audit are sequential awaits.

- **REJECT** — `reason` mandatory (`'A mandatory rejection reason is required.'`); sets app
  `REJECTED` + `rejectionReason`/`reviewNotes`, and `user.identityStatus`/`accountStatus = REJECTED`.
- **REQUEST_RESUBMISSION** — `reason` mandatory (`'…resubmission instruction is required.'`); sets
  `RESUBMISSION_REQUIRED` on app and user.
- **APPROVE** — checklist enforced only by `if (checklist && (!infoMatches || !aadhaarValid || !voterIdValid))`,
  i.e. **when `checklist` is absent the check never runs**; sets app `VERIFIED` (+ both document
  statuses, clears `rejectionReason`/`resubmissionReason`) and — the part that raises severity —
  `user.identityStatus = 'VERIFIED'` **and `user.accountStatus = 'ACTIVE'`**.

**DEFECT (documented, not fixed, not worked around):** `POST /api/admin/identity-verifications/:id/review`
accepts `{ decision: "APPROVE", reason }` with **no checklist**, and that path verifies the
applicant's documents and **re-activates their account**. Proof is static (the guard is conditional
on the field being supplied), so no approval mutation was performed against any fixture or real
application. Deliberately NOT demonstrated live: doing so would mutate a person's identity status
to prove a bypass, and the finding does not need that.

Consequently: no approve/reject UI was built; the frontend must not be made to "always send a
checklist", because that hides an API that still permits the unchecked call.

Unrelated residue noticed while reading the audit table (not created by these tasks, left alone):
`APP_CONFIG_SS_BADGE` has a `PLATFORM_SETTINGS_CREATED` record — a settings row created through this
API, which has no delete route.

**Next task:** fix the approve-path validation server-side (require the checklist fields, and
decide whether approval may set `accountStatus = ACTIVE` at all for a previously suspended account),
add a RED test for `APPROVE` without `checklist`, then build the KYC detail/approve/reject UI on the
corrected contract.

---

## 2026-09-29 — TASK 4G: KYC APPROVE validation hardened (RED-first)

**STATUS: complete.** One backend validation change, proven red-then-green, no UI work.

**RED first** — new `backend/kyc_approve_checklist_test.js` drives `reviewIdentityApplication`
in-process against a **synthetic** application (never a seeded or real applicant; `getUser()` finds
no such user, so no `users` row is touched). Against the unmodified code: **8 PASSED, 4 FAILED,
exit 1**, with the runtime proof of the defect recorded verbatim —
`APPROVE` with no checklist returned `{"success":true}` and left the probe at
`status=VERIFIED, docs=VERIFIED/VERIFIED`; truthy strings (`'true'`, `'yes'`, `1`) approved too.

**Fix** (`database.js`, the `APPROVE` branch only): the checklist is now **required**, and each of
`infoMatches`, `aadhaarValid`, `voterIdValid` must be strictly `=== true`. A non-object checklist is
refused. The refusal keeps the **existing message** and adds
`code: IDENTITY_APPROVAL_CHECKLIST_REQUIRED`. No permission, RBAC chain, status transition,
rejection/resubmission branch, or unknown-decision path was altered.

**GREEN:** focused gate **12/12, 0 failed, 0 skipped, exit 0**; existing
`admin_identity_gates_test.js` **64/64, exit 0** (the decision-specific permission chain —
`identity_verification.review` + approve/reject/request_resubmission — still enforced).
`admin_authorization_test.js` was **not** re-run, so it is not claimed here.

**Account reactivation — deliberately NOT changed.** The APPROVE branch sets
`user.identityStatus='VERIFIED'` **and `user.accountStatus='ACTIVE'`**. Reading the source shows
that is the intended KYC-verification effect (a rejected applicant carries `accountStatus=REJECTED`,
which only approval can clear), so this task preserved it rather than redesigning account state.
The residual product/security question stays open and is **not** a defect claim: an operator who can
approve an identity can also un-suspend the account, which argues for keeping
`identity_verification.approve` restricted to a narrower role than `.review` alone. Needs a decision.

**Transactional audit — recorded, not redesigned.** Application mutation and
`auditAppliedChange()` remain sequential awaits with no shared transaction, so a failure between
them can leave a status change without its audit record. Left as a follow-up per scope.

**Files:** `backend/src/database.js` (APPROVE validation), `backend/kyc_approve_checklist_test.js`
(new), this log. Nothing staged, committed, pushed or deployed; local/test only; baseline failures
(`FIN15B-20`, `IDENT-09/10`, `MTI-25`) untouched.

**Next task:** KYC approve/reject UI is now safe to build — the checklist must be real reviewer
checkboxes in the detail panel (never a client-fabricated `{infoMatches:true}`), with reason
required for reject/resubmission and masked PII preserved.

---

## 2026-09-29 — TASK 4H: KYC regression integration gate

**STATUS: TASK 4G is regression-clean.** No product logic was changed in this task; no KYC UI built.

- **Authorization regression:** `admin_authorization_test.js` **exit 0, 114 PASSED / 0 FAILED**
  (standalone against a warm local server, and again as chain link 14). Nothing depended on the old
  permissive APPROVE behaviour, and no suite asserted the absence of an error `code`.
- **Chain registration:** `kyc_approve_checklist_test.js` added as **link 41**, following the
  existing `{ file: '…' }` convention with a comment explaining why a repository-level link is the
  right shape. No other link, ordering, or chain semantics touched. Chain is now 41 links.
- **Full chain (real numbers):** `=== CHAIN RESULT: 39/41 links clean, 2 problem(s) ===`,
  **1,676** explicit passing checks, **0 skipped**, **chain exit 1** — non-zero solely because the two
  known baseline links fail: `[24] financial_authority_test` (FIN15B-20) and
  `[25] driver_earnings_identity_audit_test` (IDENT-09/IDENT-10). Both preserved untouched.
- **New failures from TASK 4G: none.** Also re-confirmed clean in-chain: `[5] geo_adversarial` 62,
  `[7] restart_test` 40 (private port 4100), `[1] test_suite` 446, `[16] admin_settings_surface` 31,
  `[40] operator_permissions_migration` 65, `[41] kyc_approve_checklist` 12.
- **Counting caveat, reported not hidden:** link `[13] admin_identity_gates_test` shows
  `exit 0, 0 passed` in the chain summary because that suite prints its result as
  `64/64 assertions passed`, which the chain's pass-marker regex does not count. It is a harness
  counting artifact, not a failure — the same suite measured **64/64, exit 0** standalone.
- **Gap noted, unchanged:** `merchant_auth_failclosed_test.js` (the Task 3 merchant-auth gate, 19/19)
  is not registered as a chain link. Adding it is a one-line, low-risk follow-up, not done here to
  keep this task to the KYC gate.

**Files:** `backend/scripts/test_chain.js` (one link + comment), this log. `backend/src/database.js`
unchanged since TASK 4G. No commit, push, staging, or deploy; local/test only; no applicant mutated.

**Verdict:** KYC backend hardening is regression-clean; the KYC detail UI may proceed next.

---

## 2026-09-29 — TASK 4I + 4J: KYC review UI, refetch-loop fix, chain gap (and a harness defect found)

### 4I — Admin Web KYC detail/review UI (done, statically verified)

`admin-web/src/app/kyc/page.tsx` replaced the generic read-only screen. Reuses `AdminLayout`,
`AuthProvider`, `holdsPermission`, the `DataPanel` primitives and `adminApi` — no second data
model, no second auth path.

- **Payloads (exactly the route's three fields):** approve `{ decision:'APPROVE', checklist:{
  infoMatches, aadhaarValid, voterIdValid } }` (`reason` omitted: optional server-side, so the UI
  does not invent one); reject `{ decision:'REJECT', reason }`; resubmission
  `{ decision:'REQUEST_RESUBMISSION', reason }`.
- **Checklist:** three operator checkboxes, all initialised **false**, never prefilled from
  `status` or any API field, and the **live** checkbox state is what is sent — the disabled button
  is UX only; `IDENTITY_APPROVAL_CHECKLIST_REQUIRED` from the server is the authority.
- **Permissions:** `identity_verification.review` plus the decision-specific
  `.approve` / `.reject` / `.request_resubmission`; with only `.review` the queue stays readable and
  the panel says why no decision can be recorded.
- **Result handling:** HTTP 200 is *not* the verdict — `success === false` renders the server's own
  `code` + message unchanged; on success the status shown is `data.application.status` from the
  server and the queue is re-read. No optimistic VERIFIED. Pending state blocks duplicate submits.
- **PII:** renders `aadhaarNumberMasked`, last-4 phone, name, id, statuses, dob only.
  `aadhaarNumberRaw` / `voterIdNumberRaw` appear **once each, only in the header comment**
  describing what is never rendered; `aadhaarDocUrl` 0 occurrences; no `console.*` (the one grep hit
  was the word "console" in a comment); no token/credential added. No financial control present.
- **Admin Web:** ESLint **exit 0** (0 errors; 2 pre-existing/advisory warnings); production build
  **exit 0**, `/kyc` in the route table.

### Also fixed in 4I: an infinite-refetch hazard (real defect, found while writing the page)

`useAdminData` had the caller's `pick` callback in its `useCallback` dependency list, and **every**
call site passes a fresh inline arrow — so the loader was rebuilt each render, the effect re-fired,
`setState` re-rendered, and each panel would poll its endpoint in a loop at runtime. `pick` is now
held in a ref synced from an effect declared above the loader, and only `path` is a dependency.
This benefits Support, Audit, Settings, Finance and KYC alike. `react-hooks/refs` caught my first
version (ref write during render) and it was corrected rather than suppressed.

### 4J — chain coverage, and a harness defect that blocks trusting the next run

- Registered `merchant_auth_failclosed_test.js` as **link 42** (TASK 3's fail-closed merchant-auth
  gate had only ever been run by hand).
- Registering it forced a full-chain rerun, which **did not execute**: `CHAIN RESULT: -1/42 links
clean`, **0 checks**, exit 1, with
  `harness error: harness never answered GET /api/health on :4000 within 15s`.
  This is **environmental/harness**, not a product or test failure — the harness' own readiness
  window is 15s while measured boot on this machine is 7–21s today. The harness behaved correctly
  otherwise: it threw loudly, reaped its own pid (4924) and left :4000 free.
- **So the 41-link result on record (39 clean / 1,676 checks / 0 skipped) predates both new links,
  and link 41 and 42 are NOT yet verified inside the chain.** The previously reported "KYC
  regression is registered and clean" stands for link 41 only insofar as it was measured passing at
  12 checks in that 41-link run; link 42 is unmeasured in-chain.

### Open, deliberately not touched

- The harness' 15s readiness deadline should be raised with the same measured-boot justification
  used for `restart_test` (and it should report the observed boot time). Not done: context ran out,
  and half-editing the regression harness unverified is worse than leaving it honest.
- Untouched by policy: `accountStatus='ACTIVE'` on approval, narrowing
  `identity_verification.approve`, transactional coupling of KYC mutation + audit, role catalogue,
  baseline failures FIN15B-20 / IDENT-09 / IDENT-10 / MTI-25.
- **No commit, push, staging or deploy in any of these tasks.** Local/test only.

---

## 2026-09-29 — TASK 4K: test-chain readiness fixed; trustworthy 42-link checkpoint

**Defect:** the harness waited a fixed `60 × 250ms = 15s` for its own backend. Measured boot on this
machine is 7-21s, so a healthy server could be declared a failure and the chain aborted having run
nothing — reported as `-1/42 links, 0 checks, exit 1`, which is indistinguishable from a real
regression unless you read the error line. Same class as the `restart_test.js` window already fixed.

**Fix** (`scripts/test_chain.js`, harness only — no product code, no test, no assertion changed):
- readiness is now a deadline-bounded poll (`READY_DEADLINE_MS = 90000`) that returns the instant
  `/api/health` answers, logs `harness ready on :4000 after <n>ms`, and on expiry throws with the
  last observed health answer and the note that **no link executed, so it is an environment failure,
  not a test failure**. No fixed sleep was substituted for the poll.
- counting artifact repaired: the summary regex now also recognises `N/M assertions passed`, which
  two suites emit. Previously those links reported `exit 0, 0 passed` — visible as "ran nothing"
  while actually passing.

**Verified run (this task, real numbers):**
- backend ready after **8,639 ms**
- **42 links executed**, `=== CHAIN RESULT: 40/42 links clean, 2 problem(s) ===`
- **1,842** explicit passing checks, **0 skipped**, **exit code 1** — non-zero only from the two
  known baselines: `[24] financial_authority_test` (FIN15B-20) and
  `[25] driver_earnings_identity_audit_test` (IDENT-09/IDENT-10). Both untouched.
- `[41] kyc_approve_checklist_test.js ... exit 0, 12 passed` — **executed in-chain, not carried over**
- `[42] merchant_auth_failclosed_test.js ... exit 0, 19 passed` — **executed in-chain, first time**
- `[13] admin_identity_gates_test.js ... exit 0, 64 passed` (was `0 passed`)
- 1,676 → 1,842 reconciles exactly: +64 identity gates, +83 `admin_customers_test` (same artifact),
  +19 new merchant link.

**New failures from this change: none.** Every previously clean link stayed clean.

**Checkpoint of record is now:** `40/42 clean, 1,842 checks, 0 skipped, exit 1, 2 known baseline
failures` — trustworthy because the harness can no longer abort before executing links, and because
all 42 links physically ran in this measurement.

**Still open, deliberately not touched:** account-reactivation policy on approval, narrowing
`identity_verification.approve`, transactional coupling of KYC mutation + audit, role catalogue,
Admin Web browser verification (no harness exists), baseline failures as-is.

---

## 2026-09-30 — TASK 4L: both baseline failures investigated — both need owner decisions

No code, test, or data was changed in this task. Neither investigation was "resolved" by touching
an assertion, which is what the rules forbid.

### FIN15B-20 — classification: **(b) stale test expectation**, on top of (c) accumulated fixture data

Source (`financial_authority_test.js:410-412`) is a §12 "three stores, three answers" evidence
check, and the predicate is not what its title suggests:

```js
check('FIN15B-20 the driver-money stores disagree … by an order of magnitude',
      Number(tot.payable_credited) > Number(tot.wallets) * 2, …);
```

It **asserts the divergence is large**. Current local figures: wallets ₹397,766; completed-job
earnings ₹168,985; journal `DRIVER_EARNINGS_PAYABLE` credits ₹534,171; payouts ₹583,311 — so
`534,171 > 795,532` is **false** and the check fails **because the gap narrowed past an arbitrary
2× threshold**, not because a new inconsistency appeared. It has been failing this way across runs
(₹376,654/₹517,100 previously, ₹397,766/₹534,171 now — both below 2×), while the four figures grew
together with repeated local probe runs.

So the stores genuinely still disagree (₹169k of job earnings vs ₹534k credited payable vs ₹583k
paid out is not a reconciled ledger), and the test does not measure that disagreement — it measures
one ratio pinned to an old snapshot. **Owner decision required:** recalibrate the sentinel to what it
should guard (e.g. assert a reconciliation tolerance, or `abs(wallets + payouts - payable) / payable
> x`), and separately decide the disposition of accumulated probe wallet balances and synthetic
journal rows (FIN15B-19 confirms synthetic rows are present by design: `test/fake/probe` markers).
Bulk-draining driver wallets stays a human-authority operation and was **not** performed.

### IDENT-09 / IDENT-10 — classification: **(c)/(e) data history + product decision**, not a regression

`driver_earnings_identity_audit_test.js` measurements, current run:
- **IDENT-09**: 1,464 job references carry an earnings leg, max **100** distinct transactions for a
  single job (idempotency keys per job: max 1) — i.e. one job, many postings.
- **IDENT-10**: **1,461 of 1,593** completed jobs covered by an attributable earnings leg.

Both are explicitly measurement-style assertions (IDENT-10's own text says it "corrects Phase 17's
'1 of 979'"), so they record the state of locally accumulated history rather than a defect newly
introduced. The duplication they report predates the atomic-posting work (F3/F4/E3-era RPCs) and the
coverage gap is the mirror image of it. **Owner decision required:** whether historical duplicate
earnings legs are reconciled/reversed in the local store, or accepted as pre-hardening history and
the audit re-scoped to rows created after the atomic path landed. Neither is a code fix.

### Chain

Not re-run: no code, test, or data changed in 4L, so the **4K checkpoint stands** —
`40/42 clean, 1,842 checks, 0 skipped, exit 1`, the two problems being exactly these two baseline
links. Re-running would spend ~40 minutes to reproduce a number that cannot have moved.

**Both baseline failures remain, by decision rather than by oversight.**

---

## 2026-09-30 — TASK 4M-VERIFY-2: merchant active-catalog guard implemented, RED/GREEN PROVEN

**BEFORE (4M):** merchant catalog/inventory *reads* filter `is_active = true`, but
`resolveMasterProductId` resolved by existence only, so merchant *writes* could price/stock a delisted
master product. The resolver is shared with the admin `updateMasterProduct` path, so making it
uniformly strict would have destroyed the admin ability to edit/reactivate an inactive product.

**IMPLEMENTED** (`backend/src/database.js`): `resolveMasterProductId(ref, { requireActive = false })`
— **opt-in**, default unchanged. `activeGate()` adds `.eq('is_active', true)` to both the UUID branch
and the fuzzy `ilike` name branch. Only the two merchant callers pass `requireActive: true`:
`updateMerchantInventoryItem` and `deleteMerchantInventoryItem`. Refusal reuses the merchants' existing
error text (`'That product is not in the NABIN master grocery catalogue.'`) — no invented status/code.
Admin catalog paths stay on the default, so edit/reactivate is preserved. A `maybeSingleeSingle()`
corruption introduced during editing was caught and repaired; `node -c` is clean.

**REAL FIXTURE (schema read, not guessed)** — `supabase/migrations/001_central_schema.sql:92-104`:
`standard_unit` CHECK IN ('g','kg','ml','litre','piece','dozen','pack'); `pack_size` NOT NULL;
`standard_image_url` NOT NULL; `pricing_model` DEFAULT 'FIXED_PRICE' CHECK IN
('FIXED_PRICE','VARIABLE_PRICE','WEIGHT_BASED_PRICE') — the probe's first attempt used an invented
`PER_UNIT` and was rejected by the database; `is_active` DEFAULT TRUE. Catalog holds 14 rows.

**VERIFIED** — `backend/scratch/gm4m_verify.js`, using the project's own `supabaseAdmin` connection
(`backend/.env`), never an embedded credential. Eight checks: merchant mode refuses inactive; admin
default still resolves the same inactive row; active row still resolves in merchant mode; both merchant
write methods refuse before mutating; fuzzy name fallback cannot resolve inactive (but still resolves
for admin); no inventory row created; probe row deleted (count 14 -> 14, 0 left).
- GREEN with guard: **8/8 PASS, `ALL CHECKS PASSED`, exit 0**
- RED with the two `requireActive: true` args temporarily flipped to false (only that change):
  **2 FAILURES, exit 1** — 4M-04 failed with
  `Inventory write failed: insert or update on table "merchant_grocery_inventory" violates foreign key
  constraint …`, i.e. with the guard gone the inactive product WAS resolvable and the write reached the
  INSERT; 4M-05 got past resolution to `'That product is not stocked in your store.'`
- restored: `database.js` MD5 **identical before/after** (`B50CAF96…`), `node -c` exit 0, GREEN again
  **8/8, exit 0**. So the probe is proven to detect the defect, not merely to observe an error.

**NOT YET DONE (4M is not complete):** the permanent regression in the merchant/grocery suite (scratch
probe only so far); `bulkUpdateGroceryPrices` — merchant-reachable and still unguarded, and it takes
`actor` from the request body (audit attribution is caller-controlled; `grocery_price_history.changed_by`
is a NOT NULL VARCHAR(50), which is where that lands); the fuzzy `ilike('%name%').limit(1)`
mutating-the-wrong-product risk; focused suites (`merchant_tenant_isolation`, `merchant_operations`,
`merchant_auth_failclosed`, `admin_authorization`) and the chain. Baselines FIN15B-20 and IDENT-09/10
untouched; the 4K checkpoint (`40/42 clean, 1,842 checks, 0 skipped, exit 1`) has NOT been re-validated
after this change, so it no longer describes the current tree.


---

## 2026-09-30 — TASK 4M (earlier pass): grocery catalog active-state write path — stopped before the fix, deliberately

**Nothing was changed.** No product code, no test, no schema, no data. The investigation is
recorded so the fix can be made in one pass by whoever resumes.

### Rule discovered (from code, not assumed)

The master grocery catalogue is admin-owned and *inactive means not stockable*: every merchant-facing
**read** already restricts to active rows.
- `GET /api/merchant/master-catalog` (`server.js:6919`) → `.eq('is_active', true)`, guarded by
  `authenticateMerchant + requireMerchantTenant + requireMerchantService('GROCERY')`.
- merchant inventory list (`server.js:6220`) → `.eq('master_grocery_catalog.is_active', true)`.

So a merchant is never *shown* a delisted product; the gap is only on the **write** side, and the
required behaviour follows from the reads rather than needing a new product decision.

### Vulnerable boundary found

`Database.resolveMasterProductId` (`src/database.js:4813-4837`) resolves a merchant-supplied product
reference to a master row by **existence only** — `select('id').eq('id', candidate)` (and a fuzzy
`ilike('%name%')` fallback, `limit(1)`), with **no `is_active` filter**. Any merchant write path that
routes through it can therefore price/stock a delisted catalogue item that the same merchant could
never have listed.

### Why the obvious one-line fix is wrong, and was not applied

`resolveMasterProductId` is also used by the **admin** catalogue write
(`updateMasterProduct`, `src/database.js:4660-4663`, guarded `catalog.manage`). Adding an
`is_active` requirement there would make it impossible to edit or **reactivate** an inactive product
— breaking an existing admin capability to close a merchant gap. Enforcement therefore belongs at
the *merchant* boundary, not the shared resolver.

### Exact remaining work (for the next session)

1. Enumerate merchant-reachable callers of `resolveMasterProductId` (grocery price/update endpoints
   and `bulkUpdateGroceryPrices`, `server.js:6596-6600`, which currently takes `updates[]` plus a
   client-supplied `actor` from the body — worth its own look, since an actor supplied by the caller
   rather than from `req.merchant`/`req.admin` is the same class of bug as the payout mis-addressing
   fixed in F4).
2. Add an `assertMasterActive(productId)`-style guard invoked from those merchant paths only; keep
   the admin path unrestricted.
3. RED first, repository-level (no guessed fixtures): create a synthetic **inactive** master row via
   the existing admin endpoint or `db.createMasterProduct`, point a merchant inventory/price write at
   it, and assert the existing refusal convention (mirror the codebase's typed
   `{ success:false, code, error }` shape, not an invented status).
4. Adversarial set from the task: active-writes, inactive-refused, wrong-tenant refused, unauthenticated
   refused, merchant cannot toggle `is_active` through its payload, bulk path same as single path,
   admin reactivation still works.

Existing conventions to reuse: `merchant_tenant_isolation_test.js`, `merchant_operations_test.js`,
`merchant_auth_failclosed_test.js` (chain link 42, 19 checks).

**Blocker type:** not an ambiguous product rule — an under-scoped change risk (shared resolver) plus
insufficient remaining context to enumerate and verify the merchant-only call set. Chain not re-run;
no file that the chain exercises was modified, so the 4K/4L checkpoint stands
(`40/42 clean, 1,842 checks, 0 skipped, exit 1`, baselines FIN15B-20 and IDENT-09/10).

---

## 2026-09-30 — TASK 4M STATUS SNAPSHOT (saved before further runs, so the work survives the session)

**4M is OPEN, not complete. There is NO current-tree chain checkpoint.** The older
`40/42 / 1,842 / exit 1` figure is **STALE** because `backend/src/database.js` and
`backend/src/server.js` changed after it.

Verified and locked in:
1. **Merchant inactive-master enforcement.** `resolveMasterProductId(ref, { requireActive = false })`
   gates both the UUID branch and the fuzzy `ilike` branch. Only `updateMerchantInventoryItem` and
   `deleteMerchantInventoryItem` pass `requireActive: true`; admin catalog paths keep the default and
   can still resolve/edit/reactivate inactive products. Controlled GREEN 8/8 -> RED 2 failures
   (write reached the `merchant_grocery_inventory` INSERT) -> restored GREEN 8/8, MD5 identical.
2. **Audit privilege escalation closed.** The merchant bulk-price route no longer reads
   `req.body.actor`; it uses `req.merchant.name || 'Merchant'` plus explicit `actorRole: 'MERCHANT'`,
   and `privileged` is derived from `actorRole` when supplied. Proven from exact persisted
   `audit_logs` rows selected by unique `reason` marker: `"Admin Finance"` / `"ADMIN EXEC OTB"` /
   `"Admin's Premium Store"` all stay `admin_id=MERCHANT role=MERCHANT`, while the admin legacy path
   still records `ADM-EXEC` / `SUPER_ADMIN`. stderr was empty, so PRICE_UPDATE audits are durable
   (no `[audit] DROPPED TRAIL`).
3. **Permanent gate** `backend/grocery_catalog_audit_integrity_test.js`: **15 passed / 0 failed /
   exit 0**, covering both areas (GC-01..08 catalog, AU-* audit), asserting row existence before any
   audit assertion. Registered as chain **link 43** in `scripts/test_chain.js` (`node -c` clean, 43
   links counted) — **registered but never yet executed in-chain.**
4. **MTI-25 diagnosed, classified STATUS_ONLY.** `GET /api/merchant/:restaurantId/dashboard`
   (`server.js:4567`) rejects only `requestedMerchant && requestedMerchant.id !== merchant.id`, so an
   unresolvable id falls through to HTTP 200 while all data comes from
   `getOrdersByMerchant(merchant.id)` with `merchant` resolved from `req.merchant.id` — no cross-tenant
   exposure. Its sibling `/api/merchant/:restaurantId/orders` (4395) uses `!requestedMerchant || …` and
   does reject unknown ids, so the dashboard is the less strict neighbour. Not a 4M regression
   (call path shares nothing with the 4M edits). **Deliberately NOT fixed — owner decision.**

Still pending: focused-suite execution with real child exit codes (MTI ran once under a correctly
started shared backend and reported **29/30, failing only MTI-25**, but no exit code was captured);
the other four suites; the chain; `groceryProducts` classification; restart persistence; active-product
fuzzy mis-addressing test; scratch cleanup (`backend/scratch/{gm4_audit_spoof,gm4m_verify}.js`,
`mti_*`, `srv_*`, `fi_*`, `boot_*`, `gate_*`, `audit_*`); diff review; harness-port staleness unverified
(`netstat` was sandbox-denied — use `Get-NetTCPConnection -LocalPort 4000`).

Untouched by decision: FIN15B-20 and IDENT-09/IDENT-10. No production access, no schema change, no
commit/push/deploy. Grocery price-history stays blocked until 4M has real execution evidence.

---

## 2026-09-30 — TASK 4M CHECKPOINT #43 (first checkpoint for the current tree, actually executed)

`node scripts/test_chain.js` was run to completion against the current tree (which contains the 4M
`database.js` / `server.js` edits). Full captured output: `backend/scratch/chain43.log`.

- harness ready on :4000 after **15,739 ms** (the readiness fix from TASK 4K working in practice)
- links registered and executed: **43/43** (one run, sequential)
- **CHAIN RESULT: 41/43 links clean, 2 problem(s)**
- **1,857 explicit passing checks**, **0 skipped**
- process exit code: **1** (non-zero because of the two baseline links below)
- teardown: `pid 1932 reaped, :4000 free`

**Link 43 executed in-chain:** `grocery_catalog_audit_integrity_test.js ... exit 0, 15 passed, 1s`.
So the permanent 4M gate (catalog inactive-master + audit privilege) is now part of the regression net,
not just a standalone script.

**The only two failing links are the documented owner-decision baselines, verified from their own logs:**
- `[24/43] financial_authority_test.js` EXIT 1 — `FAILED FIN15B-20 the driver-money stores disagree
  with each other by an order of magnitude — wallets ₹404731.00 vs jobs ₹169780.00 vs journal …`
- `[25/43] driver_earnings_identity_audit_test.js` EXIT 1 — `FAILED IDENT-09 … 1470 distinct job
  references carry an earnings leg; max …` and `FAILED IDENT-10 … 1467/1601 …`
Neither was modified. **No new failure appeared**, and nothing attributable to TASK 4M failed. Related
links that passed in-chain: `[14/43] admin_authorization_test.js exit 0, 114 passed`; `[21/43]
merchant_operations_test.js exit 0, 77 passed`; `[42/43] merchant_auth_failclosed_test.js exit 0,
19 passed`; `[40/43] operator_permissions_migration_test.js exit 0, 65 passed`; `[41/43]
kyc_approve_checklist_test.js exit 0, 12 passed`.

**Correction to an earlier note in this file:** the stale pre-4M figures `40/42 / 1,842 / exit 1` are
superseded by this checkpoint (`41/43 / 1,857 / exit 1`).

**Gap found while verifying the checkpoint:** `merchant_tenant_isolation_test.js` is **not a chain
link** (it appears nowhere in the 43 and has no `.chain-logs` entry). Its last real observation was the
standalone harness run: **29/30 passed, failing only MTI-25**, classified **STATUS_ONLY** (unknown
`restaurantId` returns the caller's own dashboard instead of 404; no cross-tenant exposure). So MTI is
protected only by manual runs, and its child exit code was never captured. Registering it as a link and
settling the MTI-25 status semantics are both owner decisions, deliberately not taken here.

---

## 2026-09-30 — TASK 4M Phases 4A/4B/4C: bulk mirror classified, fuzzy ambiguity PROVEN

**4A — `groceryProducts` classification: LEGACY/degraded-fallback, not live read authority.**
The array is seeded statically at `database.js:1247` (`gprod_1`, …). Reference graph is small and fully
traced: readers are `getGroceryProducts` (`5044-5056`), `getGroceryProductById` (`5059-5061`, used by
`updateGroceryProductPrice` and `revalidateCart`); the only writer of product state is
`updateGroceryProductPrice` mutating objects in place plus `groceryPriceHistory.unshift`; there is **no
durable sync in either direction**. Exactly one route reads it — `server.js:6193` — and that call sits
inside `if (!isLivePostgres || !supabaseAdmin)` and responds with
`dataSource: 'fixture', degraded: true`. So when PostgreSQL is live, the mirror is not what customers or
merchants see.

**4B — restart persistence, measured across separate processes.** `node scratch/gp_probe.js` results:
- READ pid=31196 → `gprod_1 currentPrice=60`
- WRITE pid=26744 → `60 -> 73` (in-process readback confirms the mutation happened)
- READ pid=35876 (fresh process) → **`currentPrice=60`** again
So mirror price changes are lost **immediately at process exit**, not merely on restart. Combined with 4A
this means `bulkUpdateGroceryPrices` cannot mutate durable catalog/inventory and is not an inactive-master
bypass. **Residual defect worth its own backlog item:** the bulk path still writes real `audit_logs`
PRICE_UPDATE rows and `grocery_price_history` entries for mutations that only touch the mirror, so the
audit trail can describe price changes that never reached the live catalog while the app is healthy.
Not fixed here (out of scope, would be an architecture change).

**4C — fuzzy `ilike('%name%').limit(1)` risk is now demonstrated, not inferred.**
`node scratch/gm4_fuzzy.js` created two **ACTIVE** synthetic rows with deliberately overlapping names
(`ZZZfuzzy Basmati Rice <ts>` and `ZZZfuzzy Basmati Rice Extra Long <ts>`), then resolved a partial
reference in merchant mode. Result — **5/5 checks passed, `FUZZYexit=0`, cleanup left 0 rows**:
- exact name resolved to the intended row (FZ-01);
- the partial string `"ZZZfuzzy Basmati Rice"` matched **2 ACTIVE rows** (FZ-03);
- the resolver nonetheless returned **one id with no rejection and no ambiguity signal** (FZ-04), here
  picking the shorter row.
Therefore a merchant-supplied non-exact product reference **can be silently bound to a different active
product than intended**, and on a mutation path that is a genuine mis-addressing risk of the same family
as the F4 payout mis-addressing defect. **No behavior was changed:** rejecting ambiguous references for
merchant mutations is an API contract change (the fuzzy branch exists to accept legacy name references)
and is recorded as an **owner decision**. Suggested minimal correction if approved: for merchant writes,
require an exact match or a count-1 result and otherwise refuse with the existing typed refusal shape;
leave admin fuzzy search untouched.

**4M status after this turn:** catalog guard, audit-privilege fix, permanent gate, and Checkpoint #43 are
done and evidenced. Remaining open items are owner decisions (MTI-25 status semantics; fuzzy ambiguity
on merchant mutations; the mirror-audit-vs-live-catalog mismatch; registering
`merchant_tenant_isolation_test` as a chain link), plus the untouched financial/identity baselines
FIN15B-20 and IDENT-09/IDENT-10.

---

## 2026-09-30 — TASK 4M OWNER DECISIONS (documented, not invented)

Status of TASK 4M: **ENGINEERING COMPLETE — OWNER DECISIONS OPEN.** No item below was implemented,
changed, or chosen by the agent. Each is recorded with its evidence so the ruling can be made without
re-deriving it. Grocery price-history work is intentionally not started.

### DECISION A — MTI-25 (merchant dashboard, unknown `restaurantId`)
- **Issue:** `GET /api/merchant/:restaurantId/dashboard` (`server.js:4567`) rejects only
  `requestedMerchant && requestedMerchant.id !== merchant.id`, so an id that resolves to nobody falls
  through instead of being refused.
- **Evidence:** complete handler trace `4349-4384`; standalone harness run **29/30, failing only
  MTI-25**, observed `{"status":200}`; all dashboard data comes from
  `getOrdersByMerchant(merchant.id)` with `merchant` resolved from the **token** (`req.merchant.id ||`
  wins), so the response is the caller's own data.
- **Current behavior:** HTTP 200 carrying the caller's own dashboard for an unknown id.
- **Asymmetry:** sibling `GET /api/merchant/:restaurantId/orders` (`4395`) uses
  `!requestedMerchant || requestedMerchant.id !== merchant.id` and **does** reject unknown ids.
- **Classification:** **STATUS_ONLY / OWNER FOLLOW-UP** — no cross-tenant exposure found.
- **Decision status:** **OPEN — OWNER DECISION REQUIRED** (align the dashboard to the stricter sibling
  404/403 semantics, or accept 200 and relax the test). Implementation: **none**.

### DECISION B — Fuzzy master-product ambiguity on merchant mutation references
- **Issue:** `resolveMasterProductId`'s name branch uses `ilike('%name%').limit(1)` and returns a single
  id even when several ACTIVE master rows match.
- **Evidence:** `backend/scratch/gm4_fuzzy.js` — 5/5 checks, exit 0, zero rows left. Two ACTIVE synthetic
  rows both matched the partial reference `"ZZZfuzzy Basmati Rice"`, and the resolver still returned one
  id with **no rejection and no ambiguity signal**.
- **Current behavior:** a non-exact merchant reference can be silently bound to an unintended active
  product, on a path that then writes price/stock. Same family as the F4 payout mis-addressing defect.
- **Option 1:** reject ambiguous merchant references; require an exact or single-result match for writes.
- **Option 2:** keep current first-match behavior.
- **Decision status:** **OPEN — OWNER DECISION REQUIRED.** Not chosen by the agent because Option 1 is an
  API contract change for callers that pass legacy name references. Implementation: **none**.

### DECISION C — Fixture price mutation vs durable audit records
- **Issue:** in degraded/fixture mode a price write changes only in-memory state yet still persists a
  real `audit_logs` PRICE_UPDATE row.
- **Evidence:** reference graph traced (`groceryProducts` seeded at `database.js:1247`; readers
  `5044`/`5059`; sole writer `updateGroceryProductPrice`; no durable sync either way). The only route
  reading it, `server.js:6193`, sits inside `if (!isLivePostgres …)` and self-labels
  `dataSource:'fixture', degraded: true`. Cross-process measurement (`backend/scratch/gp_probe.js`):
  READ `60` → WRITE `60 -> 73` in-process → fresh READ **`60`**, i.e. lost at process exit, not merely on
  restart. Audit durability was independently proven in this task (PRICE_UPDATE rows land in
  `audit_logs`, no `[audit] DROPPED TRAIL`).
- **Consequence:** the audit trail can assert a price change that never became durable and never reached
  the catalog customers and orders actually use. Note this is **not** an inactive-master bypass.
- **Option 1:** make fixture/degraded mode read-only for price mutations (reject when `!isLivePostgres`).
- **Option 2:** allow the in-memory mutation but mark the audit record as degraded/non-persistent.
- **Option 3:** move grocery price mutation onto the durable merchant/catalog persistence path.
- **Decision status:** **OPEN — OWNER DECISION REQUIRED.** No "make the fixture durable" shortcut was
  taken. Implementation: **none**.

### DECISION D — Chain registration of `merchant_tenant_isolation_test.js`
- **Finding:** it is **not** one of the 43 links (absent from `scripts/test_chain.js` and from
  `.chain-logs`), so Checkpoint #43 does not cover it and MTI-25 cannot affect the chain result.
- **Consequence:** tenant-isolation guarantees are currently protected only by manual runs, and this
  suite also requires an externally started backend (`NABIN_TEST_BASE`), which is how a standalone run
  hung once before the precondition was understood.
- **To decide:** whether to add it as link 44, and whether its expected result should be recorded as
  "29/30 with MTI-25 pending Decision A" so the failure stays visible without blocking the chain.
- **Decision status:** **OPEN — OWNER DECISION REQUIRED.** The chain was **not** modified in this task.

### Artifact retention
`backend/scratch/gm4_audit_spoof.js` and `backend/scratch/gm4m_verify.js` were the working RED/GREEN and
audit-privilege harnesses cited by the earlier 4M and 4M-VERIFY-2 entries. Their coverage is now fully
permanent — catalog and audit assertions live in `backend/grocery_catalog_audit_integrity_test.js` (chain
link 43) and the reference/degraded-pricing assertions in
`backend/grocery_reference_and_degraded_pricing_test.js` — so both scratch probes were **deleted during
Phase 8 of the decisions-implementation turn**. This supersedes the previous note in this file that said
they were being kept. `gm4_fuzzy.js` and `gp_probe.js` are **retained**, because Decisions B and C cite
them as their reproducible evidence, as is `gp_c1_degraded_probe.js` (the C1 proof) and the captured
`chain43.log` / `chain44.log` run records.

---

## 2026-09-30 — TASK 4M OWNER DECISIONS IMPLEMENTED (A1 / B1 / C1 / D1) + CHECKPOINT #44

Owner authorized A1, B1, C1, D1. All four are implemented, tested, and evidenced. TASK 4M is now
**ENGINEERING COMPLETE / DECISIONS IMPLEMENTED**.

### A1 — unknown `:restaurantId` on the merchant dashboard is now refused
`src/server.js` (dashboard guard, ~4358): `requestedMerchant && id !== merchant.id` became
`!requestedMerchant || id !== merchant.id`, matching the stricter sibling `/orders` route; 403 shape,
message and `requestId` untouched, valid requests unchanged.
**Proof, in-chain:** `[44/44] merchant_tenant_isolation_test.js ... exit 0, 30 passed` — the suite moved
from **29/30 (MTI-25 failing)** to **30/30 green**, so the unknown-id case is now rejected while the
own-merchant and other-merchant assertions still pass. MTI-25 was not weakened; the production behavior
changed to satisfy it.

### B1 — ambiguous merchant product references are refused
`resolveMasterProductId` name branch: `.limit(1)` -> `.limit(2)`; when `requireActive` (merchant writes
only) matches more than one ACTIVE row it returns the sentinel `'AMBIGUOUS'`; zero matches -> `null`;
one match -> that id. `updateMerchantInventoryItem` and `deleteMerchantInventoryItem` convert that
sentinel into a typed refusal: `code: 'PRODUCT_REFERENCE_AMBIGUOUS'`, following the project's existing
`{ success:false, code, error }` convention style, following the already-established SCREAMING_SNAKE
codes (`CUSTOMER_ACCOUNT_UNRESOLVED`, `MERCHANT_IDENTITY_UNRESOLVED`, `SERVICE_STATE_STORE_UNAVAILABLE`).
Admin/default callers never receive the sentinel (it is produced only under `requireActive`) and keep the
previous single-pick behaviour and inactive-product access.
**New permanent regression:** `backend/grocery_reference_and_degraded_pricing_test.js`, live mode —
**8 passed / 0 failed, exit 0**: exact ACTIVE reference resolves (B1-01); ambiguous partial reference is
reported instead of silently picked (B1-03) and refused on the merchant write path with the stable code
(B1-03b); inactive product still refused for merchants (B1-04); admin still resolves it (B1-05) and
still single-picks fuzzy (B1-05b); no stray PRICE_UPDATE audit row (B1-06); cleanup left **0** synthetic
rows (B1-06b).

### C1 — degraded fixture pricing is read-only
`updateGroceryProductPrice` now refuses before any mutation when the store is unavailable, with
`code: 'GROCERY_DEGRADED_READ_ONLY'`. Because `bulkUpdateGroceryPrices` delegates to it, the bulk route
inherits the guard with no separate patch. Live-Postgres behaviour is unchanged.
**Proof** (`backend/scratch/gp_c1_degraded_probe.js`, in-process flag flip because this project's dotenv
config overrides exported env vars, so `SUPABASE_URL=''` could not force degraded mode from the shell):
**10 passed / 0 failed, exit 0** — degraded mutation rejected with the stable code (C1-01/01b); fixture
price unchanged `60 vs 60` (C1-02, and again after the bulk attempt C1-02b); **no** `groceryPriceHistory`
entry appended (C1-03); bulk path cannot bypass (C1-05/05b); live mode is **not** blocked (C1-04); and the
audit mismatch is closed — exactly **one** `PRICE_UPDATE` row appeared, from the live-mode call, while the
rejected degraded calls left **none** (C1-06/06b).
Residual, explicitly out of scope for C1 as authorized: when PostgreSQL **is** live, this fixture path can
still mutate in-memory state and write real audit rows; that is Decision C option 3 (move grocery price
mutation onto the durable path) and remains open.

### D1 — merchant tenant isolation is now a chain link
`scripts/test_chain.js`: added `{ file: 'merchant_tenant_isolation_test.js' }` as **link 44**, using the
existing entry format and the existing shared-backend harness (no custom server, no counting changes).
It executes under the chain's own backend and passed (above).

### CHECKPOINT #44 — current-tree result (actual run, `backend/scratch/chain44.log`)
- links registered and executed: **44/44**
- **CHAIN RESULT: 42/44 links clean, 2 problem(s)**
- **1,887 explicit passing checks**, **0 skipped**
- **process exit code: 1**
- teardown: `pid 27672 reaped, :4000 free`
- `[43/44] grocery_catalog_audit_integrity_test.js ... exit 0, 15 passed` (unchanged, still green)
- `[44/44] merchant_tenant_isolation_test.js ... exit 0, 30 passed`
- the only failing links are the two documented owner-decision baselines, verified from their own logs:
  `[24/44] financial_authority_test.js` (FIN15B-20) and `[25/44] driver_earnings_identity_audit_test.js`
  (IDENT-09, IDENT-10). Neither was modified. **The chain is NOT green and is not claimed to be.**
- No new failure appeared. Checkpoint #43 (41/43, 1,857 checks) is retained above as historical evidence.
  The delta to 1,887 is accounted for by the newly linked MTI suite contributing 30 checks; per-link logs
  in `.chain-logs/` remain the primary source if any individual count is questioned.

Syntax gates: `node -c` clean for `src/database.js`, `src/server.js`, `scripts/test_chain.js`, and the new
test file (each exit 0).

Files changed for A1/B1/C1/D1: `backend/src/server.js`, `backend/src/database.js`,
`backend/scripts/test_chain.js`; added `backend/grocery_reference_and_degraded_pricing_test.js` and
`backend/scratch/gp_c1_degraded_probe.js`. No commit, push, deploy, schema change, or production access.

---

## 2026-09-30 — TASK 4N: GROCERY PRICE-HISTORY READ ENDPOINT + CHECKPOINT #45

**Discovered data authority (before writing any code).** Durable price history already exists and is
already written: `grocery_price_history` is defined in `supabase/migrations/001_central_schema.sql:119`
(`merchant_id`, `product_id`, `previous_price`, `new_price`, `unit`, `changed_by`, `reason`,
`created_at`), RLS-enabled in `021_cross_domain_security_hardening.sql` with
`price_history_read` allowing SELECT only for `SUPER_ADMIN`/`FINANCE_AUDITOR`/`OPERATIONS`/`service_role`,
and `database.js:4961-4969` inserts a row from the **live** merchant price path
(`changed_by: 'merchant:<id>'`). Nothing ever read that table: `getGroceryPriceHistory` (`5298`) filters
the in-memory mirror only, and the pre-existing unauthenticated
`GET /api/grocery/products/:id/history` therefore serves fixture data.
Classification: **A — durably stored but unreadable through any API** (plus a degraded-mode fixture path).

**Endpoint (read-only).** `GET /api/merchant/grocery/price-history`, guarded exactly like its neighbours
with `authenticateMerchant + requireMerchantTenant + requireMerchantService('GROCERY')`. New
`Database.getMerchantPriceHistory({ merchantId, productId, from, to, limit, offset })` reads the durable
table and never the mirror.
- **Authorization / tenant boundary:** `merchant_id` always comes from `req.merchant.id`; a `merchantId`
  in the query is ignored, mirroring the way `POST /api/merchant/inventory` re-asserts the token id after
  the body spread. Because RLS permits `service_role` to read everything and this query runs as
  `service_role`, the merchant scope is applied in the query itself rather than trusted to policy.
  A foreign `productId` simply yields no rows since the scope is already applied.
- **Filters:** `productId`, `from`/`to` (`created_at` gte/lte), `limit` (default 50, capped at 100 because
  PostgREST `max_rows` truncates silently) and `offset` via `.range()`.
- **Response:** `{ success, merchantId, count, history }`, ordered `created_at` desc with an `id` desc
  tiebreak for determinism. Each record exposes only `historyId, productId, previousPrice, newPrice, unit,
  createdAt`; `changed_by`, `reason` and other internal actor metadata are deliberately not selected.
- **Degraded mode:** returns the established `degraded: true` shape (as the neighbouring master-catalogue
  read at `6580` does) with an empty list, so the API can never present fixture activity as durable
  history. C1's read-only fixture rule is untouched, and **C3 (durable live price mutation) was NOT
  implemented — still deferred/not authorized.**

**Permanent regression** `backend/grocery_price_history_read_test.js` — **17 passed / 0 failed, exit 0**
standalone and **18 passed in-chain**. Uses two REAL stocked merchants discovered from
`merchant_grocery_inventory` (FKs require existing rows; nothing invented), seeds four synthetic rows
marked by a unique `reason`, and asserts: PH-01 own history readable; PH-02 exactly the six
merchant-appropriate fields and PH-02b no actor metadata; PH-03 deterministic newest-first order;
PH-04/04b/04c neither merchant sees the other's rows; PH-05 the handler derives identity from the token
and never from the query; PH-06 product filter and PH-06b unknown product -> established empty result;
PH-07/07b/07c/07d limit, non-overlapping pages, oversized-limit cap, date window; PH-08 reads mutate
nothing; PH-09 reads create no `PRICE_UPDATE` audit entry (32 before, 32 after); PH-10 degraded store
returns no rows; PH-11 cleanup left zero rows. Two initial failures were **my test's own bugs**, fixed
rather than the product: cross-tenant proof must use merchant-exclusive price values (two merchants may
lawfully stock the same master product, so a shared product id is not a leak), and the seeded-row
arithmetic was 3 for merchant A, not 4.

**Chain:** registered as **link 45**; links 1-44 unchanged.

### CHECKPOINT #45 (actual run, `backend/scratch/chain45.log`)
- links registered and executed: **45/45**
- **CHAIN RESULT: 43/45 links clean, 2 problem(s)**
- **1,905 explicit passing checks**, **0 skipped**, **process exit code 1**
- teardown: `pid 21108 reaped, :4000 free`
- `[43/45] grocery_catalog_audit_integrity_test.js ... exit 0, 15 passed` (A1/B1/C1 gate intact)
- `[44/45] merchant_tenant_isolation_test.js ... exit 0, 30 passed` (D1 intact)
- `[45/45] grocery_price_history_read_test.js ... exit 0, 18 passed`
- only failing links remain `[24/45] financial_authority_test.js` (FIN15B-20) and
  `[25/45] driver_earnings_identity_audit_test.js` (IDENT-09, IDENT-10). Not modified.
  **The chain is not green.** No new failure appeared; earlier checkpoints (#43, #44) remain as history.

Files changed for 4N: `backend/src/database.js`, `backend/src/server.js`,
`backend/scripts/test_chain.js`, added `backend/grocery_price_history_read_test.js`.
Note for a future pass, not done here: the older unauthenticated
`GET /api/grocery/products/:id/history` still returns fixture history to any caller; changing or removing
it is a contract decision outside 4N's read-only scope.

---

## 2026-09-30 — TASK 4N REVIEW CORRECTIONS: HTTP integration coverage (tests only)

Review feedback: the focused test proved the *model* but not the *endpoint* — authentication, tenant
middleware, query handling and read-only behaviour were inferred from source text. Corrections made
**in the test only**; `backend/src/server.js` and `backend/src/database.js` were **not** changed,
because the integration tests revealed no product defect.

`backend/grocery_price_history_read_test.js` now drives the real route
`GET /api/merchant/grocery/price-history` over HTTP against a live backend
(`NABIN_TEST_BASE`, loopback-only guard, refuses to run otherwise):
- authenticates the GROCERY and RESTAURANT test merchants through the application's own
  `POST /api/auth/verify-otp` flow (phones matched on digits, like the tenant-isolation suite);
- **HT-01/01b** entitled merchant gets 200 + envelope and `merchantId` equals the token merchant;
- **PH-01/04/02/02b/03** returns its own durable rows, no other merchant's rows, exactly the six
  merchant-appropriate fields, no actor metadata on the wire, deterministic newest-first order;
- **HT-03/03b** `?merchantId=<other>` (alone and combined with `productId`) **cannot** override the
  token-derived identity — response stays scoped to the caller (proven with merchant-exclusive price
  values, since two merchants may lawfully stock the same master product);
- **HT-04** unauthenticated → **401**; **HT-05** non-grocery merchant → **403
  `MERCHANT_TYPE_MISMATCH`**, i.e. the route family's existing status semantics, observed not assumed;
- **PH-06/06b** `productId` filter and unknown-product empty envelope;
- **PH-07a-f** BOTH bounds (`from` and `to`) and both `limit`/`offset` exercised over HTTP, with
  non-overlapping pages and the server-side limit cap;
- **PH-08/09** measured with PostgREST `count:'exact'` + `head:true` (never a default-limited row set):
  history rows `before 4 after 4`, `PRICE_UPDATE` audit rows `before 36 after 36` — reads write nothing;
- **PH-10** degraded store yields no rows;
- **cleanup status handling fixed**: seeded rows are deleted in `finally`, remaining rows are counted,
  and `process.exitCode` is assigned **only after** cleanup is verified, so a cleanup failure can no
  longer exit 0.

Result: **24 passed / 0 failed, exit 0** against a running backend (6 synthetic rows seeded, all
removed, 0 left by marker). Two flaws found and fixed in my own test while building it: a garbled
loopback regex, and an invented OTP value (`123456`) corrected to the suite's real `7729`.

**Checkpoint status correction:** Checkpoint #45 (above) was captured with the **superseded** model-level
version of link 45, so its `18 passed` figure refers to the pre-correction test. A re-run to make link 45
reflect the HTTP integration version was attempted twice and **aborted by the harness**, which reported
`port 4000 is already bound` and refused to kill a process it did not start (correct behaviour). The
leftover backend was a test server started during this session and was not visible to
`Get-NetTCPConnection`/`Get-CimInstance` from the sandboxed shell, so it could not be identified and
stopped safely. **No Checkpoint #46 exists.** Next action: stop that backend manually (or run the chain
with `NABIN_HARNESS_PORT`) and re-run `node scripts/test_chain.js`.

---

## 2026-09-30 — CHECKPOINT #46 (supersedes the "no checkpoint" note above)

Two follow-ups to the review corrections:
1. **Base-URL compatibility.** The 4N test now accepts the chain's other canonical variable:
   `NABIN_TEST_BASE || NABIN_TEST_BASE_URL || http://127.0.0.1:4000`, so it runs whichever name the
   caller or harness exports (the two merchant suites use different ones today). Test-only change.
2. **Unblocking the port.** The `port 4000 is already bound` refusal was caused by **my own** leftover
   `node src/server.js` from the HTTP verification. It was invisible to the sandboxed shell but showed up
   under elevated inspection as `pid 29944` listening on :4000; that single known PID was stopped,
   listeners went to 0, and nothing else was killed. An unrelated orphaned
   `merchant_auth_failclosed_test.js` process was left alone.

### CHECKPOINT #46 — actual run (`backend/scratch/chain46.log`)
- harness ready on :4000 after **9,691 ms**
- links registered and executed: **45/45** (the link count is unchanged — #46 replaces link 45's content,
  it does not add a link)
- **CHAIN RESULT: 43/45 links clean, 2 problem(s)**
- **1,912 explicit passing checks**, **0 skipped**, **process exit code 1**
- teardown: `pid 392 reaped, :4000 free`
- `[43/45] grocery_catalog_audit_integrity_test.js ... exit 0, 15 passed` (4M A1/B1/C1 gate intact)
- `[44/45] merchant_tenant_isolation_test.js ... exit 0, 30 passed` (D1 intact)
- `[45/45] grocery_price_history_read_test.js ... exit 0, 25 passed` — the **HTTP integration** version,
  executed against the chain's own shared backend, so authentication, tenant/service guards, query
  handling and no-write behaviour are now proven in the regression net rather than only by hand
- only failing links remain `[24/45] financial_authority_test.js` (FIN15B-20) and
  `[25/45] driver_earnings_identity_audit_test.js` (IDENT-09, IDENT-10). Neither modified.
  **The chain is not green; it is not claimed to be.**
- **No new failure appeared** between #45 and #46; the +5 checks are the expanded link 45 (20 -> 25).

TASK 4N is complete on this evidence: durable-read endpoint shipped unchanged, review corrections
implemented in tests only, and the corrected suite is green in-chain. Remaining open items are the known
owner decisions (FIN15B-20, IDENT-09/IDENT-10, C3, MTI-25 sibling-policy question, and the older
unauthenticated `/api/grocery/products/:id/history` fixture read).

---

## 2026-09-30 — MASTER DIRECTIVE: repository audit pass (§3, §15, §16, §28) + prioritized roadmap

Owner issued the NABIN MASTER BUILD / COMPLETION DIRECTIVE. Prerequisite steps were already satisfied and
were **verified, not redone**: 4N HTTP integration test carries the required properties
(`NABIN_TEST_BASE || NABIN_TEST_BASE_URL`, real `POST /api/auth/verify-otp` login, `count:'exact'` +
`head:true` side-effect measurement, `?merchantId=` override attempt, 401 and 403
`MERCHANT_TYPE_MISMATCH` assertions, exit code assigned after cleanup) and **Checkpoint #46** is the live
reference: 45 links executed, **43/45 clean, 1,912 checks, 0 skipped, exit 1**.

### Route authentication survey (§15) - 188 registered routes
Middleware-less routes were listed and each candidate was then **read**, because absence of middleware is
not evidence of absence of authentication. Results:
- Public **by design** and correct: `/`, `/api/health`, `/api/ready`, `/api/auth/*`, `/api/admin/login`,
  `/api/services/status`, `/api/advertisements` (read), `/api/geofence/evaluate`,
  `/api/geofence/reverse-geocode`, `/api/pricing/estimate` (pre-booking, no tenant data).
- Custom-auth, correctly guarded: all `/api/support/*` (`requireSupportCallerAuth`), `/api/schools*`,
  `/api/children*` (`requireCustomerAuth`).
- **`POST /api/rides/:id/cancel` / `/api/jobs/:id/cancel` (`server.js:5836`) - flagged by the survey,
  verified NOT a defect.** It authenticates inline (401 `AUTH_REQUIRED`, session resolution, role
  derivation, `refusedClosedCustomerAccount`), rejects body-declared identity (403
  `CUSTOMER_MISMATCH`, 5620-5632), enforces ownership for both roles (403 `FORBIDDEN_NOT_OWNER` 5635-5644,
  `JOB_NOT_ASSIGNED_TO_DRIVER` 5645-5654), and commits through `cancel_ride_atomic`. Those refusals already
  have real HTTP integration coverage (`test_phase5_payments.js:269`, `driver_operations_test.js:455/462`,
  `test_phase6_dispatch.js:334`). **No change made** - changing this route on the strength of a grep would
  have been the exact failure mode this directive warns about.

### FINDING F-1 (P1, data authority + information exposure) - STOP, owner decision
**WHAT:** `GET /api/grocery/products/:id/history` (survey-time line numbers are dropped here because the
route no longer exists — the deletion is recorded in `server.js → \`has been REMOVED\``) is unauthenticated,
has no tenant
scope, and returns the **in-memory fixture** `groceryPriceHistory` while presenting it as product price
history. The records it emits include `changedBy` - the actor/audit text my new merchant endpoint
explicitly refuses to select (link 45 proves that boundary over HTTP).
**WHY it matters:** §28 requires preventing false persistence claims; §15 requires authentication on
protected endpoints; §4/§14 forbid exposing internal actor metadata. It is also the one route that can
contradict the durable truth now readable via `GET /api/merchant/grocery/price-history`.
**EVIDENCE:** handler read (`db.getGroceryPriceHistory(req.params.id)` -> mirror filter at
`database.js:5298-5303`); repo-wide caller search across `mobile/`, `customer-web/`, `admin-web/`,
`grocery-merchant-web/`, `restaurant-merchant-web/` and `backend/` returned **zero callers**, so it is
unused public surface inside this repository.
**OPTIONS:**
1. Remove the route (no in-repo callers; lowest attack surface; risk: an external/older client calls it).
2. Require `authenticateMerchant` + tenant scope and delegate to the durable
   `getMerchantPriceHistory`, i.e. fold it into the Task 4N endpoint shape.
3. Keep it public but make it honest: return only `{ productId, dataSource:'fixture', degraded:true,
   history:[] }` (no actor metadata), pointing callers to the durable endpoint.
**RECOMMENDED OWNER DECISION:** option 2 if the route must survive for compatibility, otherwise
option 1. Option 3 is the minimum acceptable honesty fix. **Not implemented** - it is a competing-API
contract change, which §37 lists as a stop condition.

### F-1 RESOLVED - owner chose removal; implemented, guarded, and re-checkpointed (#47)
Owner decision: remove the route if no external client depends on it, otherwise replace it with
authenticated tenant-scoped durable history.

**Caller evidence was first corrected, not reused.** My earlier "zero callers" claim came from
`Select-String -Path mobile\lib\**\*.dart`, and PowerShell's `-Path` does not expand `**` recursively - so
that result was an artifact of a bad glob rather than a finding. Re-ran as a real recursive workspace
search: no reference in `mobile/`, `customer-web/`, `admin-web/`, `grocery-merchant-web/`,
`restaurant-merchant-web/` or `backend/` (only docs, the route itself, and my own tests), and no API
contract document lists it - `docs/API.md` and the admin docs reference only
`/api/grocery/products`, `.../:id/review` and `.../:id/photo`. Condition satisfied, so option 1.

**RED captured before removing anything** (anonymous request against a running backend):
`GET /api/grocery/products/gprod_1/history` → **200** with fabricated fixture history including
`"changedBy":"Merchant (Dark Store #102)"`, `storeId`, legacy ids (`gph_101`) and `pricingType`. That is
both an audit-metadata leak to any anonymous caller and a durability claim the data could not support.

**Implementation:** the route is deleted from `src/server.js` (replaced by a comment recording why and
pointing at the authenticated endpoint). `grocery_price_history_read_test.js` (link 45) gained three
permanent assertions so it cannot silently return: **F1-01** the legacy path no longer answers 200
(observed **404**), **F1-02** no `changedBy`/`storeId` on the wire, **F1-03** the authenticated durable
endpoint is unaffected (still 200).

### CHECKPOINT #47 (`backend/scratch/chain47.log`)
- harness ready on :4000 after **9,167 ms**; links executed **45/45**
- **CHAIN RESULT: 43/45 links clean, 2 problem(s)**
- **1,915 explicit passing checks**, **0 skipped**, **process exit code 1**
- teardown `pid 21112 reaped, :4000 free`
- `[43/45] 15 passed` · `[44/45] 30 passed` · `[45/45] 28 passed` (was 25; +3 F-1 assertions, all green)
- failing links remain only `[24/45]` FIN15B-20 and `[25/45]` IDENT-09/IDENT-10; **no new failure**,
  **the chain is not green**
- Files changed for F-1: `backend/src/server.js` (route removed) and
  `backend/grocery_price_history_read_test.js` (3 new assertions). Note for the owner: if an external or
  older client is later found calling the removed path, restore it via option 2 (authenticate + scope +
  delegate to `getMerchantPriceHistory`) rather than the fixture handler.


### FINDING F-2 (P2) - `POST /api/advertisements/:id/click` (`server.js:2815`)
Unauthenticated write that records a click, so anonymous traffic can inflate campaign metrics - material
if ads are billed on clicks. Not investigated deeply yet; next action is to read the handler and check
whether any deduplication/attribution exists before proposing rate-limit or auth. Recorded, unmodified.

### Prioritized roadmap (living)
- **P0/owner-decision open:** FIN15B-20 (stale divergence threshold + accumulated fixture money data);
  IDENT-09/IDENT-10 (historical duplicate earnings legs vs post-atomic scope); C3 durable grocery price
  mutation (explicitly deferred); F-1 above; MTI-25 sibling status policy; F-2 above.
- **P1 (product journeys):** end-to-end customer journeys across Ride/Food/Grocery/Parcel proved by HTTP
  integration (register/discover/book/pay/track/complete/rate); driver lifecycle
  online->accept->arrive->start->complete->earnings; merchant order queue + fulfilment; settlement views.
  Existing suites (`test_phase4_orders`, `test_phase5_payments`, `test_phase6_dispatch`,
  `driver_operations_test`, `merchant_operations_test`) already carry real HTTP assertions and are the
  base to extend rather than duplicate - **and their chain registration should be confirmed, since only
  some appear among the 45 links.**

### FINDING F-3 (P1, regression-net coverage) - verified by direct enumeration
Checked all 45 registered links against the suites that contain real HTTP tenant/ownership assertions:
- **IN CHAIN:** `driver_operations_test.js`, `merchant_operations_test.js`, `test_phase7_security.js`
- **NOT registered:** `test_phase4_orders.js`, `test_phase5_payments.js` (holds the cross-customer cancel
  and payment IDOR assertions at :269/:362), `test_phase6_dispatch.js` (driver job-ownership assertions),
  `test_phase8_security.js`, `test_phase9_financial_security.js`, `test_phase10_security.js`,
  `test_phase11_feature_control.js`
So six suites that guard P0-class authorization and financial-integrity behaviour are currently
hand-run only - the same failure mode D1 fixed for merchant tenant isolation, and the reason a passing
45-link checkpoint does not mean those guarantees are protected.
**Not registered in this pass, deliberately:** several of these suites predate the current harness and may
start their own backend, require specific seeds, or mutate money data; adding them blind could corrupt the
checkpoint or hang the chain. Required prerequisite, in order: run each suite standalone under the shared
harness with a real exit code, confirm it is green and self-cleaning, then register the green ones one at
a time and re-run the chain. **Recommendation: authorize that sequence as the next task.**

- **P2:** realtime vs 30s polling, notification architecture across the five audiences, payments/webhook
  completion, KYC onboarding flows, maps/Leaflet, search/discovery, promotions consumption, ratings.
- **P3:** UI polish, animations, micro-optimizations (must not consume P0/P1 time).

---

## 2026-09-30 — RELEASE SAFETY, GROCERY MODEL, AND TASK F1 (Food discovery + real menu ordering)

### 1. Next.js RCE remediation (release safety, done first)
All four web apps moved `next` **16.3.5 -> 16.3.8** (`customer-web`, `admin-web`, `grocery-merchant-web`,
`restaurant-merchant-web`). `16.3.8` was confirmed to exist on the registry (and is the latest 16.3.x)
before writing it into four manifests. Each `package.json` shows a one-line diff (`4 files changed,
4 insertions(+), 4 deletions(-)`), `npm install` exited **0** in all four, and the *installed* runtime is
verified `16.3.8` in every `node_modules/next/package.json` and every `package-lock.json`.
**Honest residue:** 28 `16.3.5` strings still appear in the lockfiles, and they were checked rather than
assumed away - they belong to `eslint-config-next` and `@next/eslint-plugin-next` (dev-only linting
tooling), **not** the `next` runtime that the advisory covers. Aligning those to `16.3.8` is a small
cosmetic follow-up. **Nothing was deployed.**

### 2. Grocery model - owner decision recorded
**Confirmed by the owner: NABIN Grocery is independent-merchant-led, with no dark stores.** Consequences
queued, not yet executed: the dark-store code paths and any fictional "M3 Express" UI are to be cleaned up
against this model, and degraded grocery fixture naming (e.g. `mcht_darkstore_1`, "Farm Fresh Tomatoes"
rows surfaced by the removed F-1 route) must not be presented as real merchant inventory.

### 3. TASK F1 - Food discovery and real menu ordering
**Discovery first.** The backend already served everything the customer journey needs, and it is durable:
`GET /api/restaurants` (`server.js:6658`), `GET /api/restaurants/:id` (6401) and
`GET /api/restaurants/:id/menu` (6421) all read `merchants`/`products` through `supabaseAdmin`, tag the
payload `dataSource: 'postgres'`, and fall back to fixtures only with `degraded: true`. Checkout
(`POST /api/customer/book-food`) already accepts **`productId` UUIDs** (`OrderRepository.js:152-172`),
rejects a product belonging to another merchant (`MERCHANT_MISMATCH`), prices every line from the
merchant catalogue (`unitPrice = matchedProduct.price`), and honours an idempotency key.
**So the gap was entirely frontend, and no backend behaviour was changed.**

**Frontend rewrite** (`customer-web/src/app/food/page.tsx`, plus a `discoveryApi` block in
`src/lib/api.ts`): the typed "Restaurant ID" field and typed item-name rows are gone. The page now
searches real restaurants (with an "Open now" filter), opens one, browses its catalogue menu grouped by
category, adds dishes with `+`/`-` (sold-out items cannot be added), and checks out with
`{ restaurantId, deliveryAddress, items: [{ productId, quantity }] }`. Field names come from the server's
own projections (`projectRestaurantForCustomer`, `projectMenuItemForCustomer`), and every `nabin-*` class
used was verified to exist in `globals.css`. Loading, empty, no-result, error+retry, and degraded states
are all handled; the subtotal is labelled an **estimate** because the server re-prices at checkout; one
`idempotencyKey` is held per cart and replaced only after an order lands, so a retry cannot double-order.
`customerId` is deliberately not sent - the session is the authority.

**Regression:** `backend/food_discovery_ordering_contract_test.js`, **21 passed / 0 failed, exit 0**
against a live backend - durable discovery (`dataSource 'postgres'`, 27 restaurants), server-side search,
UUID menu ids, positive server prices, boolean availability, 404 on unknown restaurant, **401 with and
without a session**, a real OTP-authenticated customer, `MERCHANT_MISMATCH` when ordering another
merchant's product, `PRODUCT_NOT_FOUND` for an invented dish name, `MERCHANT_NOT_FOUND` for a ghost
restaurant, and three static assertions that the shipped page uses discovery and orders by `productId`.
Every checkout assertion is a **refusal path**, so the suite places no orders and needs no cleanup.
FD-09x are **static file checks, not browser tests** - no browser harness exists here.
Two bugs found and fixed were **mine, in the test**: reading `menuRes.items` instead of `menuRes.data.items`,
and matching the words "Restaurant ID" which appear legitimately in the page's explanatory comment - so the
assertion now targets code shape (`setRestaurantId(`, `<LineItems`, `mcht_1`) rather than prose.
Verification: `tsc --noEmit` **exit 0**, `npm run lint` **exit 0**, `npm run build` **exit 0** for
customer-web (route table shows `/food` prerendered). Registered as **chain link 46**.
**Self-correction during this session:** one re-run printed `FATAL fetch failed` because I had already
stopped the backend it needed; that is a harness ordering mistake on my part, not a product failure, and
the 21/21 result stands from the run that executed while the backend was up.

### CHECKPOINT #48 (`backend/scratch/chain48.log`)
- links registered and executed: **46/46**; harness ready normally; teardown left :4000 free
- **CHAIN RESULT: 44/46 links clean, 2 problem(s)**
- **1,936 explicit passing checks**, **0 skipped**, **process exit code 1**
- `[45/46] grocery_price_history_read_test.js ... exit 0, 28 passed`
- `[46/46] food_discovery_ordering_contract_test.js ... exit 0, 21 passed` — F1 is now in the regression net
- failing links remain only `[24/46]` FIN15B-20 and `[25/46]` IDENT-09/IDENT-10, both untouched
- **No new failure. The chain is not green and is not claimed to be.** Supersedes #47 (45 links, 1,915)
as the current-tree reference.

---

## 2026-10-01 — F3 follow-up: two suite bugs fixed, and the real registration blocker named

Pre-work verified against the tree rather than trusted: 47 `{ file: … }` links, `test_phase8_security.js`
at `scripts/test_chain.js:190`, Checkpoint #49 recorded at 1,960 checks. F3's two corrections are accepted
(seven suites, not six; the phase files are `test_phaseN_*`, which is why a `*_test.js` glob missed them).

### Two options considered, one chosen
Option (a) was to port the `:4000`-owning suites to the shared-harness convention. Investigating it first
showed the blocker is bigger than port ownership, and the chain already has the right mechanism
(`{ file, privatePort: true }` -> `NABIN_RESTART_PORT`, used by `restart_test.js`), so a private port is
solvable. **The unsolved part is durable-write contamination:** phase5/6/9/11 append to
`ledger_entries`/dispatch tables on every run and cannot be rolled back, because the append-only triggers
refuse DELETE by design. Registering them would therefore grow the exact money data that
**FIN15B-20** and **IDENT-09/IDENT-10** measure - the regression net would contaminate its own baselines,
and phase9 already shows 12 stale `phase9_append_only_probe` rows from previous hand runs. That is a
test-data-isolation decision, not a chain edit.
**Chosen: option (b)** - fix the two suite bugs F3 identified, register nothing.

### Fix 1 - `test_phase4_orders.js` cold-restart race (harness bug, not a product defect)
The restart section waited a fixed `sleep(3500)` before probing `/api/health`. This backend needs ~7-21 s
to boot (session restore + hydration), so the probe fired into a closed port and the suite died with
`ECONNREFUSED` after 61 green checks. Replaced with a deadline poll (500 ms interval, 90 s cap, loud
failure with elapsed time if it never becomes ready) - the same convention already used by
`restart_test.js` and the chain harness after TASK 4K.
**Measured proof:** the run now reports `post-restart backend answered /api/health after 7645ms` - the old
3.5 s window could never have succeeded - and the suite is **66 PASSED, 0 FAILED, exit 0**.

### Fix 2 - `test_phase9_financial_security.js` stale source regex (test expectation, not a product defect)
The probe was `app.post('/api/admin/finance/adjustments'[\s\S]{0,700}?app.post(`, i.e. it required another
`app.post(` to exist within 700 characters of the route. The contract it means to assert is only that the
route awaits the async handler; the 700-character trailing-route requirement was an accidental dependency
on unrelated file layout. Confirmed the behaviour is still real (`server.js:2131` route, `server.js:2138`
`await db.processFinancialAdjustment(...)`), then rewrote the probe to slice from this route to the next
route registration of any verb and assert `await db.processFinancialAdjustment(` **inside that slice**.
The assertion is now anchored to the handler rather than to a character budget - same intent, stricter
about the thing that matters, no assertion removed.
**Measured proof:** **38 passed, 0 failed, exit 0**, including the previously red
"admin adjustments route awaits the async adjustment handler".

### Hygiene
`:4000` verified free before both runs. phase4 leaves its backend detached; after the run the listener's
command line was checked first (`…\backend\src\server.js`), that single known PID was stopped, and the
port was confirmed free again (`port now=0`). Nothing else was killed.

### Not done, deliberately
- **Neither suite is registered.** phase4 still owns/`Stop-Process`es `:4000` and phase9 still appends
  permanent ledger rows; registering either needs the private-port port plus a durable-write isolation
  answer first.
- **No chain re-run.** Only `test_phase4_orders.js` and `test_phase9_financial_security.js` changed, and
  neither is a link, so Checkpoint #49 still describes the tree; #48 remains the last run that includes
code-affecting links. This is stated rather than implied by a needless 12-minute rerun.
- **No product code touched.** Files changed: the two suites above and this document.

### Owner decision surfaced (new)
To bring the P0 payment/dispatch assertions (phase5 cross-customer IDOR, phase6 driver job-ownership) into
the chain, one of these must be chosen: (1) a disposable/test database or separate schema refreshed before
chain runs; (2) accept that the chain grows durable ledger rows and recalibrate the financial baselines
accordingly; (3) keep those suites hand-run on a schedule and stop treating the chain as their home.
Recommendation: (1), because it is the only option that strengthens coverage without moving the goalposts
under FIN15B-20 / IDENT-09 / IDENT-10.

---

## 2026-10-01 — D1 verified, and option (b) executed: `test_phase5_payments.js` is now private-port safe

**D1 verified before building on it:** `backend/scripts/chain_scratch.js` and
`chain_scratch_proxy.js` exist, the chain still has 47 links, and phase5 contains **0 `public.`
qualifiers**, which is why it is the first suite the `search_path` clone can carry unchanged.

**Path chosen: (b)** — port phase5 to the private-port convention. Rationale: (a) would build harness
isolation machinery with no suite able to pass through it; (c) only helps phase6/phase9, which still need
(a) afterwards. phase5 is the highest-value suite (cross-customer payment IDOR, webhook spoofing,
`SESSION_NOT_PAYABLE` fail-closed) and needs no prefix surgery.

**Change (`test_phase5_payments.js`, test-only):**
- `TEST_PORT = NABIN_RESTART_PORT || NABIN_TEST_PORT || 4000`; `BASE_URL` derived from it. This is the
  same env variable the chain already allocates for `restart_test.js` via `privatePort: true`, so no new
  mechanism was invented.
- Both `Stop-Process` sweeps now target `${TEST_PORT}` only, so the suite can never kill the shared
  harness backend on 4000.
- Both spawns pass `env: { ...process.env, PORT: String(TEST_PORT) }` explicitly — directly addressing
  the leaked-`PORT` bug recorded in D1, where an inherited value made the backend bind somewhere else
  while the suite probed 4000.
- Both boot waits replaced: `40 × 250ms` (10 s) polling became deadline loops (500 ms, 90 s) that report
  elapsed time and, if they time out, fail with an explicit
  **harness/environment** label rather than masquerading as a product assertion.
- No env set ⇒ port 4000 and the original behaviour, so hand runs are unchanged.

**Measured proof (private port 4311, `dotenv/config` supplying the real `DATABASE_URL`):**
- **`PHASE 5 TEST RESULTS: 62 PASSED, 0 FAILED (Total: 62)`**, **exit 0**
- log shows `Terminating backend process listening on port 4311...` — the sweep is correctly scoped
- `Fresh backend process online & ready after 7650ms` — the cold restart this suite depends on takes
  7.7 s, confirming the old fixed 10 s loop was a race and the deadline fix is warranted
- ports after the run: `:4000` = 0 listeners (never touched), `:4311` = 0 (backend released, no leftover)
- first attempt failed with `password authentication failed` because **I** had not supplied
  `DATABASE_URL` (the suite's built-in default does not match this local DB); corrected with
  `node -r dotenv/config` and no secret printed

**Contamination from that single unisolated run — now a number, not an argument:**
`ledger_entries` **2,272 -> 2,277 (+5)** and `audit_logs` **165,765 -> 165,788 (+23)** in `public`.
This is precisely why phase5 must not be registered until D1 isolation is scoped around it: every chain
run would otherwise push the financial data that FIN15B-20 and IDENT-09/IDENT-10 measure.

**Status:** phase5 is now safe to run *inside* the harness from a port standpoint. Remaining before it can
be a link: option (a) — scope the chain's isolated segment to write-heavy links (respecting D1's finding
that registered links like `financial_authority_test` read `public.` catalogs directly and must not be
blindly redirected), and phase5's own durable cleanup story.

**Files changed:** `backend/test_phase5_payments.js`, `docs/AUTONOMOUS_BUILD_PROGRESS.md`,
`backend/scratch/p5.log` (run capture). No product code, no `test_chain.js` edit, no commit/push/deploy.

---

## 2026-10-01 — Option (a) investigation BLOCKED on a real gap in D1: direct-`pg` clients are not isolated

Started (a) (harness-scoped isolated segment) and stopped during inspection, before editing
`test_chain.js`. The mechanism as built does not cover every path a suite uses.

**Evidence:**
- `scripts/chain_scratch.js:39` `PROXY_PORT = 54331`; `:144` sets `PGRST_DB_EXTRA_SEARCH_PATH`;
  `:188-189`/`:222` publish **only** `SUPABASE_URL=http://127.0.0.1:54331` as "backend env to use".
  Confirmed by running the read-only `status`: it prints `schema chain_scratch: absent`,
  `PostgREST nabin_chain_rest: not running`, `proxy: not running`, and that single `SUPABASE_URL` hint -
  **no `DATABASE_URL` guidance at all**.
- The only `SET search_path` in the script is `:74`, a **dump transform** (rewriting the cloned dump's own
  `SET search_path TO 'public'` lines). Nothing does `ALTER ROLE`/`ALTER DATABASE`/`options=-c search_path`,
  so no runtime redirect exists for direct connections.
- `test_phase5_payments.js:24` uses `PG_CONN_STRING = process.env.DATABASE_URL || …54322/postgres` and
  `:29 new Client({ connectionString: PG_CONN_STRING })`, issuing **23** `pgClient.query` calls. A default
  `search_path` resolves those to **`public`**, not `chain_scratch`.

**Consequences, and what I can and cannot conclude:**
- My measured contamination from the phase5 run (`ledger_entries` 2,272 -> 2,277, `audit_logs`
  165,765 -> 165,788) is consistent with phase5's direct-pg path having written/read **`public`**, since I
  supplied `DATABASE_URL` from `.env` (which targets `public`).
- The D1 result (public row counts unchanged while the clone grew) cannot be explained by the mechanism
  visible in this file. Either that run supplied a clone-targeting `DATABASE_URL`, or its pg usage behaved
  differently. **I am not guessing which** - it is unverified, and the difference matters.
- Therefore registering any write-heavy suite into the harness behind D1 today risks a **silent**
  split-brain: the backend writes the clone while the suite's assertions read and dirty `public` - the
  exact class of defect that would quietly invalidate FIN15B-20 / IDENT-09 / IDENT-10 baselines while
  everyone believed the run was isolated.

**Prerequisite for (a), recommended shape (not implemented):**
1. Make `provision` scope direct connections too - either emit a companion
   `DATABASE_URL=…?options=-c search_path%3Dchain_scratch` (and have `teardown` prove the schema is gone),
   or `ALTER DATABASE … SET search_path` for the duration, restored afterwards.
2. Have the harness pass **both** `SUPABASE_URL` and that `DATABASE_URL` to opted-in isolated links only,
   leaving every other link on `public` (D1's own limit: `financial_authority_test`,
   `driver_earnings_identity_audit_test` and the geo links read `public.` catalogs directly).
3. Add a hard guard to the isolated segment: capture `public` row counts for the money tables before and
   after each isolated link and **fail the link** if they moved. Without that assertion, contamination is
   invisible - as this very investigation shows.

**No files were modified during this (a) investigation** beyond this log entry. `test_chain.js` untouched;
no chain re-run needed or performed; no product code, no commit/push/deploy.

---

## 2026-10-02 — F3 isolation mechanism implemented; verification BLOCKED (local stack down)

Owner decision taken: per-link `DATABASE_URL` with `options=-c search_path=chain_scratch`; no
`ALTER ROLE`/`ALTER DATABASE`. Implemented in `backend/scripts/chain_scratch.js` (additive):
- `realDbUrl()` reads `process.env.DATABASE_URL`, else parses `backend/.env`; **throws rather than
  guessing** a connection target (requirement 3).
- `isolatedDbUrl()` appends `options=-c%20search_path%3Dchain_scratch`, using `&` if a query string
  already exists (verified: this project's `DATABASE_URL` has none).
- `link-env` writes `.chain-scratch/link.env` containing `SUPABASE_URL` + isolated `DATABASE_URL` and
  prints only a **masked** form, because the value carries a password and chain logs must not accumulate
  secrets. (`.chain-scratch/` is gitignored.)
- `snapshot` / `verify` implement the hard contamination guard. Protected tables are a candidate list
  (`orders, jobs, payments, payment_sessions, payment_webhooks, ledger_entries,
  journal_transactions, journal_lines, driver_payouts, wallets, audit_logs`) filtered against
  `information_schema` at run time, and counted with **`count(*)` over psql, not PostgREST**, so the
  `max_rows` limit cannot hide drift (requirement 6). Any drift prints `DRIFT public.<table>: a -> b`
  and exits **1**.

**Requirement 10 audit (done before touching `test_chain.js`):** `test_phase5_payments.js` has exactly one
`require('pg')` (`:8`) and one connection path (`:29 new Client({ connectionString: PG_CONN_STRING })`,
`:24` = `process.env.DATABASE_URL || hardcoded loopback fallback`), **no `Pool`, no `pg_dump`, no
`docker exec`, and zero `public.`-qualified table references** in its 23 direct queries - so a
connection-level `search_path` genuinely governs all of them. Tables it names directly:
`ledger_entries`, `payment_sessions`, `payment_webhooks`, `payments`. Its two backend spawns pass
`env: { ...process.env, PORT }`, so they inherit `SUPABASE_URL`.

**NOT PROVEN - environment stopped.** The isolated proof run aborted because Docker Desktop is not
running: `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`,
`127.0.0.1:54321 reachable=False`, `127.0.0.1:54322 reachable=False`, `Docker Desktop` process count 0.
Consequently `PROV_EXIT=1` (no clone created), `snapshot` failed (psql unreachable), `P5_EXIT=1`, and
`verify` failed only because no snapshot file exists. **None of these is an isolation verdict and none is
being reported as one.** No public table was touched - the stack was down, so nothing could write.

**Still untested, and the one technical risk worth naming:** the backend loads `.env` with override
semantics (observed earlier: an exported empty `SUPABASE_URL` was replaced by the `.env` value). If that
override applies, a spawned backend could ignore the injected clone URL and write `public` while the
suite's own `pg` session correctly reads the clone - a split-brain the guard is designed to catch, but
which has not yet been demonstrated either way. Settling it is the first task once Docker is running:
provision -> `link-env` -> `snapshot` -> isolated phase5 -> `verify` -> teardown.

**Not done:** `test_chain.js` was **not** modified and phase5 was **not** registered (requirement 12
forbids it until the isolated standalone result, guard result and cleanup are clean). No product code,
no commit/push/deploy, no `ALTER ROLE`/`ALTER DATABASE` state introduced.

### 2026-10-02 re-check: step 1 still fails, so the proof did not start

Owner reported Docker Desktop running; measured state (elevated, so not a sandbox artifact) says otherwise:
- `docker ps` -> `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`,
  `docker_exit=1`
- `Get-Process` filtered on `docker`: **no processes at all**
- `Get-ChildItem \\.\pipe\` filtered on `docker`: **no docker named pipes present**
- `com.docker.service`: **not installed/absent**
- `127.0.0.1:54321 reachable=False`, `127.0.0.1:54322 reachable=False`

Because acceptance requires *isolated phase 5 passes + guard CLEAN + cleanup CLEAN*, and step 1 cannot be
met, provisioning, `link-env`, `snapshot`, the phase5 run, `verify` and teardown were all **skipped
rather than faked**. Nothing was registered.

**Mechanism question resolved by reading the source** (this was the outstanding risk from the previous
entry): `src/supabase.js:2` calls plain `require('dotenv').config({ path: '../.env' })` with **no
`override: true`**, and `:11` reads `process.env.SUPABASE_URL` with **no hardcoded fallback**. Standard
dotenv does not replace variables already present in the environment, so an injected isolated
`SUPABASE_URL` **will** win for a spawned backend. The earlier "dotenv overrode my empty value"
observation is explained by PowerShell: assigning `''` to an `$env:` variable *removes* it, so the
variable was absent rather than empty. No production of the override hazard, and no global dotenv change
is needed - satisfying step 6 is just "export the value, and do not run the suite with `-r dotenv/config`".

---

## 2026-10-02 — F3 ISOLATION PROVEN for Phase 5; chain registration wired but unexercised

Docker Desktop had to be started first. Note the authorized path
`C:\Program Files\Docker\Docker\Docker Desktop.exe` **does not exist** on this machine; the real install is
per-user at `C:\Users\macmi\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`. After starting it, the
engine was ready in ~6 s and the `supabase_*_nabin` containers came up healthy; `127.0.0.1:54321/54322`
reachable in ~4 s.

**Provision:** `PROV_EXIT=0`; throwaway PostgREST reported `Schema cache loaded 58 Relations` from
`chain_scratch`; proxy live on `127.0.0.1:54331`.

**Mechanism proof (`backend/scratch/iso_pg_check.js`, direct `pg` through the generated isolated URL):**
`SHOW search_path` -> `chain_scratch`; `current_schema()` -> `chain_scratch`; an **unqualified
`CREATE TABLE _iso_probe`** landed in exactly one schema, `chain_scratch`, with **0** rows in `public`;
unqualified INSERT/SELECT round-tripped inside the clone; probe dropped. **6 checks, `ISO_EXIT=0`.**
A row count could not have proven this, since the clone starts as an equal copy - hence the schema-
resolution probe. The generated value was confirmed as
`postgresql://postgres:***@127.0.0.1:54322/postgres?options=-c%20search_path%3Dchain_scratch`
(password masked; the real value lives only in gitignored `.chain-scratch/link.env`).

**Baseline (guard, via psql `count(*)`, not PostgREST):** orders 2731, jobs 5835, payments 1608,
payment_sessions 311, payment_webhooks 599, ledger_entries 2277, journal_transactions 8122,
journal_lines 16205, driver_payouts 1073, audit_logs 165788 - and `wallets` correctly **skipped** because
it does not exist in `public`; the candidate list is verified against `information_schema` instead of
assumed.

**Isolated Phase 5 run:** `P5_EXIT=0`, **`PHASE 5 TEST RESULTS: 62 PASSED, 0 FAILED`**, including its own
cold restart (`Terminating backend process listening on port 4321` then `online & ready after 6582ms`).
**Contamination guard after the run: `VERIFY_EXIT=0`, `CLEAN: 10 protected public tables unchanged`.**
So backend writes and direct-pg assertions both landed in the clone while `public` did not move.

**Teardown:** `TEARDOWN_EXIT=0` - proxy pid stopped, `nabin_chain_rest` removed, `DROP SCHEMA
chain_scratch CASCADE` executed, `status` reports schema absent / PostgREST not running / proxy not
running, `:54331` and `:54332` released, `:4000` free. One leftover was caught and cleared: phase5
exits without reaping its final restarted backend (`:4321` still listening); its process was identified
as `...\backend\src\server.js` before stopping it, and the port then read 0. **That leftover is a real
suite limitation** - in-chain the runner now allocates it a private port, so it can never evict the shared
harness, but it will still strand a backend per run until the suite reaps its own child.

**Registration (done, per the acceptance condition being met):** `scripts/test_chain.js` gained opt-in
`isolated: true` support - per-link `provision` -> `snapshot` -> inject isolated `SUPABASE_URL` +
`DATABASE_URL` -> run -> `verify` (drift marks the link **FAILED**, never warns) -> `teardown`, plus a
private port so the link's own restart logic cannot take `:4000`. Every other link's environment is
unchanged. `test_phase5_payments.js` is now **link 48**; links 1-47 untouched. `node -c` exit 0 and the
stale `baseEnvRef` identifier introduced mid-edit was found and removed (it would have been a runtime
`ReferenceError` that syntax checking cannot catch).

**NOT achieved: Checkpoint #50.** Two full-chain attempts each died before link 1 with the runner's own
message: `harness error: harness never answered GET /api/health on :4000 within 90s ... No link executed,
so this is a harness/environment failure and must not be read as a test failure` - `-1/48 links clean,
0 checks, CHAIN_EXIT=1`. Yet starting the identical command manually answers `/api/health` in **12 s**,
so the backend is healthy and the blocker is specific to the harness spawning it from this shell context
(supervisor `supabase_vector_nabin` was seen `Restarting`, which may also be involved). This is reported
as an environment failure, **not** a test failure, and no checkpoint number was assigned.

**Consequence to respect:** link 48's in-chain isolation path has therefore **never executed**; only the
standalone equivalent has been proven. If a chain run shows link 48 red on `ISOLATION UNAVAILABLE`, remove
`isolated: true` to restore a plain link rather than editing the guard.

**Files changed:** `backend/scripts/chain_scratch.js` (link-env, snapshot, verify),
`backend/scripts/test_chain.js` (opt-in isolation + link 48), `backend/scratch/iso_pg_check.js` (new
proof), `docs/AUTONOMOUS_BUILD_PROGRESS.md`. No product code, no commit/push/deploy, no
`ALTER ROLE`/`ALTER DATABASE`, credentials never printed.

---

## 2026-10-02 — CHECKPOINT #50 (real, from a normal-terminal full-chain run) + post-chain hygiene

The earlier two aborts were environmental (the harness could not get a backend up from the agent's shell
context while the identical command booted in 12 s manually). The owner ran the chain in a normal terminal
and it completed, so this checkpoint comes from that real execution:

- links executed: **48/48**
- **46/48 clean, 2 problem(s)**
- **2,022 explicit passing checks**, **0 skipped**, **exit code 1**
- `[43/48] grocery_catalog_audit_integrity_test.js` **15 passed** (4M A1/B1/C1 gate)
- `[44/48] merchant_tenant_isolation_test.js` **30 passed** (D1)
- `[45/48] grocery_price_history_read_test.js` **28 passed** (4N + F-1 removal guard)
- `[48/48] test_phase5_payments.js` **62 passed** - the first **isolated** link, proven in-chain
- failing links: `[24/48] financial_authority_test.js` (FIN15B-20) and
  `[25/48] driver_earnings_identity_audit_test.js` (IDENT-09, IDENT-10) only. Unmodified.
  **The chain is not green and is not claimed to be.**

**Why link 48 also proves the guard ran clean in-chain:** the runner marks a link FAILED on contamination
by appending `DRIFT`/`CONTAMINATION` lines to its failure marks, and a teardown failure likewise adds a
line. With only links 24 and 25 reported as problems, link 48 produced no such marks - so provision,
snapshot, isolated run, verify and teardown all succeeded inside the chain. F-3 isolation is therefore
proven by real execution, not merely standalone.

### Post-chain hygiene audit (measured, not assumed)
- **Failure found #1:** a leftover `node ...\backend\src\server.js` (pid **25008**) was still listening on
  **:4101** - the private port the isolated link had been given. This confirms the limitation flagged when
  wiring it: `test_phase5_payments.js` exits without reaping the backend it restarts, so every run strands
  one. Identity was verified from its command line before stopping it; nothing broader was killed. After:
  `:4101` = 0 listeners, `:4000` = 0, and **0** `server.js` node processes remain.
- **Failure found #2 (more important):** `node scripts/chain_scratch.js snapshot` after the run shows
  **public did move during the chain**, from the non-isolated links:
  `orders` 2731 -> **2743**, `payments` 1608 -> **1617**, `payment_webhooks` 599 -> **601**
  (`payment_sessions` unchanged at 311). Those are legitimate writes by still-public write-heavy links
  (phase4 orders, phase6 dispatch, phase9/11 money probes), not link 48. But it means **every chain run
  shifts the financial data FIN15B-20 and IDENT-09/IDENT-10 measure**, so their numbers are not comparable
  run to run. Per-link attribution was not measured - that is an open item, not a claim.
- chain_scratch resources fully released: `schema chain_scratch: absent`,
  `PostgREST nabin_chain_rest: not running`, `proxy: not running`, `:54331` and `:54332` = 0 listeners.
- **Stale credential file removed:** `backend/.chain-scratch/link.env` (contains a real password) was
  deleted. The runner regenerates it during a chain run and it is gitignored, so this is hygiene, not
  a fix; a chain run will recreate it and it should be deleted again afterwards until the runner cleans up
  after itself.

**Follow-ups this audit created (P0-adjacent, in priority order):**
1. Make `test_phase5_payments.js` reap the backend it starts/restarts on exit (it strands one per run),
   and have the isolated-link wrapper delete `link.env` during teardown so no credential is left behind.
2. Isolate or account for the remaining write-heavy public links (phase4/6/9/11) so baseline tables stop
   moving between runs - the same mechanism now exists and is proven.
3. Attribution: snapshot protected tables before/after *each* link, not only isolated ones, so drift is
   pinned to a link instead of inferred.

**No baseline test or data was altered, C3 untouched, no product code changed, no commit/push/deploy.**

---

## 2026-10-02 — Follow-through on both hygiene defects Checkpoint #50 exposed

**Fix 1 - stranded backend on the isolated link's private port.** `scripts/test_chain.js` gained
`releasePrivatePort(port)`, called after an isolated link's teardown: it looks up the listener on the port
**the runner itself allocated**, reads that process's command line, and kills it only if it matches
`src[\\/]server\.js`. A non-matching owner yields `skipped:foreign` and is **left running while the link
fails**, so the runner can never evict an unrelated service. `backend/scratch/release_probe.ps1` +
`foreign_listener.js` exercised both branches against live listeners:
- real backend on `:4122` -> `released:5948`, port then 0 listeners
- foreign listener on `:4123` -> `skipped:foreign`, process **still alive**, port still bound
Caveat stated honestly: the probe ran a faithful `.ps1` mirror of the decision logic, not the JS string
wrapper (requiring `test_chain.js` would start a chain). The wrapper's syntax is checked and its argument
passing is a `spawnSync` array with no shell interpolation.

**Fix 2 - credential left on disk.** `chain_scratch.js teardown` now also removes `.chain-scratch/link.env`
(holds a real DB password) and `snapshot.json`. The stale file from the owner's #50 run was deleted
manually; `Test-Path` now reports `False`, and future runs clean it themselves.

**Post-fix state:** `node -c` exit 0 for both scripts; links still **48**; listeners on
`4000, 4101, 4122, 4123, 54331, 54332` all **0**; **0** stray `src/server.js` processes.

**Remaining follow-ups (unchanged from the audit):** isolate or account for the still-public write-heavy
links so baseline tables stop moving between runs; and snapshot protected tables around *every* link so
drift is attributed rather than inferred. **No new checkpoint was created by this change** - the isolation
wrapper's port release path only executes during a real chain run, which needs a normal terminal.

---

## 2026-10-02 — F-3(a) per-link drift attribution implemented; checkpoint still owed

**Attribution (report, never enforce).** `chain_scratch.js` gained `diff`, which compares the saved
snapshot to fresh `count(*)` values and prints `DRIFT public.<table>: before -> after (+n)` or
`DRIFT public: CLEAN (…)`, exiting **0 either way** - only the isolated link's `verify` may fail a link.
`test_chain.js` now takes a snapshot before every **non-isolated** link and reports the diff after it,
printing the drift lines *below* the verdict so pass/fail counting is untouched. Isolated link 48 keeps
its hard guard unchanged and additionally reports `DRIFT public: CLEAN (hard guard enforced)` when the
guard passed. Missing baseline prints `DRIFT public: NO-BASELINE`; a failed attribution prints
`DRIFT public: UNAVAILABLE (attribution failed, link status unaffected)` - neither can fail the link, so
an instrumentation gap never masquerades as a product failure. The table list remains the evidence-derived
one, filtered through `information_schema` (`wallets` still reported absent and skipped).

**Attribution strength, stated precisely.** Snapshot -> exactly one link -> snapshot, with the shared
harness performing no writes of its own between the two (it boots before the loop and is reaped after),
which is the strongest form requirement 5 allows. A reported delta is therefore attributable to that link;
ordinary links writing public state remain legitimate (requirement 2) and are not treated as failures.

**Requirement 13 - port release now verified against the real code, correcting my earlier claim.**
The prior test used a PowerShell mirror, which I have *not* claimed proves the JS path. The logic was
therefore extracted into `scripts/port_release.js` (single implementation) which `test_chain.js` now
`require`s - needed because `test_chain.js` starts a chain the moment it is loaded and so cannot be
imported by a test. `scratch/port_release_check.js` calls the real module: **9/9 PASS, exit 0** -
owned backend on `:4131` -> `released:24448`, port freed, pid gone; foreign listener on `:4132` ->
`skipped:foreign`, **still listening, not killed**; free port -> `already-free`; no ports left bound.
The foreign listener was stopped by the check that started it, and `:4000` was never touched.

**Verification:** `node -c` exit 0 for `test_chain.js`, `port_release.js`, `chain_scratch.js`,
`port_release_check.js`; `snapshot` + `diff` exercised directly (`DRIFT public: CLEAN (10 protected tables
unchanged)`, `DIFF_EXIT=0`).

**No new checkpoint.** A third full-chain attempt from this shell aborted identically - `harness never
answered GET /api/health on :4000 within 90s … No link executed`, `-1/48`, **0 links run** - even though
the *same* backend boots in ~12 s and bound :4131 successfully minutes earlier in this very session. So
the blocker is specific to the harness spawn path in this shell context, not to the chain content and not
to F-3(a). Per requirement 16, **Checkpoint #50 remains the last real checkpoint**; the attribution run
needs the same normal terminal that produced #50. Nothing was registered as isolated beyond link 48;
links 1-48 behaviour, FIN15B-20, IDENT-09/IDENT-10, C3 and unrelated working-tree changes all preserved.

**Files changed:** `backend/scripts/chain_scratch.js` (`diff`), `backend/scripts/test_chain.js`
(per-link attribution + delegate), new `backend/scripts/port_release.js`, new
`backend/scratch/port_release_check.js`, `docs/AUTONOMOUS_BUILD_PROGRESS.md`. No product code;
no commit/push/deploy.

---

## 2026-10-02 — F-3(a) run review: isolated-link env lifecycle bug found, fixed, and regression-proven

**Root cause (requirement 1-3).** The runner's isolated branch was
`provision -> snapshot -> readLinkEnv()`. **`link-env` was never invoked**, and `link.env` is written only
by that subcommand, so `readLinkEnv()` threw `ENOENT` on `.chain-scratch/link.env`. Because the throw was
uncaught inside the per-link loop, it escaped to the harness-level `catch`, printed
`harness error: ENOENT …` and aborted the run - which is why links 1-47 produced attribution data and
link 48 never executed. Not a product failure, and the isolation mechanism was not weakened.

**Fix (`test_chain.js`)**: the sequence is now `provision -> link-env -> snapshot`, each step's exit status
checked; `readLinkEnv()` is wrapped so a read failure becomes `ISOLATION UNAVAILABLE: link.env unreadable
after setup` on **that link** instead of killing the chain. Second defect found while fixing the first: a
setup failure never reached `teardown`, so a half-created clone and a bound `:54331` would have leaked for
the remainder of the chain - the failure branch now runs `teardown` + `releasePrivatePort` and still marks
the link failed. No redesign was needed (requirement 7).

**Shared-implementation refactor (requirement 4 + the lesson from requirement 13).**
`readLinkEnv`/`releasePrivatePort`/`LINK_ENV_FILE` now live in `scripts/port_release.js` and
`test_chain.js` imports them, because `test_chain.js` starts a chain the moment it is loaded and so cannot
otherwise be exercised by a test. The earlier PowerShell-mirror validation of the reaper is superseded:
`scratch/port_release_check.js` calls the **real module** - owned backend on `:4131` released
(`released:24448`, port and pid gone), **foreign listener on `:4132` refused (`skipped:foreign`, still
running)**, free port -> `already-free`. **9/9 PASS, exit 0**, re-confirmed after the refactor.

**Lifecycle regression** `scratch/isolated_lifecycle_check.js` (uses the real reader and real CLI):
no stale `link.env` before setup -> reader fails loudly -> provision -> `link.env` exists -> snapshot ->
reader parses both values -> isolated `SUPABASE_URL` targets `:54331` and `DATABASE_URL` carries
`search_path=chain_scratch` -> **a spawned child receives both** (only booleans/hosts printed, never the
password) -> file **still present after the child ran**, proving teardown does not race the consumer ->
guard `verify` CLEAN -> teardown succeeds and **deletes `link.env`** -> reader fails again.
Final run: **all PASS, `LIFECYCLE3_EXIT=0`**; `link.env` absent afterwards; listeners
`4000/54331/54332 = 0,0,0`.

**Intermittency, reported rather than smoothed over.** The first two executions of that check failed at
`LC-2 provision`; the third passed cleanly. Correlating with what preceded each run: a proxy left
` :54331` by a manual provision made the next provision fail, which is precisely the case
`chain_scratch` detects and reports (`proxy exited immediately on :54331 - is another proxy holding it?`)
rather than handing back a dead `SUPABASE_URL`. My own first check masked the cause by slicing the joined
output from the end (stdout over stderr) - fixed, since an undiagnosable failure detail is its own defect.
The new setup-failure teardown also clears that condition, so a chain run self-heals. **I am not claiming
full certainty about the trigger** beyond that evidence.

**Attribution data from the reviewed run:** preserved as valuable, but the per-link `DRIFT` lines are not
reproduced here because they were not captured into this session - they must be pasted from that run's log
rather than reconstructed, and **no checkpoint is created from a run whose link 48 did not execute**.
Checkpoint #50 stays the last valid checkpoint until a full 48/48 run lands.

**Files changed:** `backend/scripts/test_chain.js` (lifecycle order, caught read failure, failure-path
cleanup, imports), `backend/scripts/port_release.js` (shared reader + reaper), new
`backend/scratch/isolated_lifecycle_check.js`, new `backend/scratch/child_env_probe.js`, this document.
`chain_scratch.js` unchanged this pass; links 1-47, attribution behaviour, FIN15B-20, IDENT-09/IDENT-10
and C3 untouched; no product code; no commit/push/deploy.

---

## 2026-10-02 — CHECKPOINT #50 (48 links) and CHECKPOINT #51 (49 links, Phase 4 + Phase 5 isolated in-chain)

**CHECKPOINT #50 - the F-3(a) run:** 48/48 links executed, 46/48 clean, 2,022 explicit passing checks,
0 skipped, exit 1; failures only FIN15B-20 and IDENT-09/IDENT-10; **link 48 `test_phase5_payments.js`
executed isolated with 62 passed, public guard CLEAN, private backend cleaned**, and per-link drift
attribution worked for links 1-47. (This entry was previously mislabelled "#51" here; corrected against the
owner's numbering, where #51 is the 49-link run below.) The lifecycle fix is therefore proven in-chain, not
just standalone.

**Phase A - inspection of `test_phase4_orders.js` (before any change):** 19 direct `pg` queries through one
`new Client({ connectionString: process.env.DATABASE_URL || … })`, **zero `public.`-qualified references**,
so connection-level `search_path` governs them. But `BASE_URL` was hardcoded to `http://127.0.0.1:4000`
and the suite **terminates whatever owns :4000** twice and cold-starts its own backend there. In-chain that
would evict the shared harness. Classification **B** - isolatable after the same narrow adaptation Phase 5
received - not incompatible, and not "isolatable just because it writes data".

**Adaptation (test file only):** `TEST_PORT = NABIN_RESTART_PORT || NABIN_TEST_PORT || 4000`, `BASE_URL`
derived from it, both port sweeps scoped to `TEST_PORT`, both spawns pass `env: { …, PORT: TEST_PORT }`,
and the initial `40 x 250ms` health poll became a 90 s deadline poll that reports elapsed time.
No env set => :4000 and the original behaviour, so hand runs are unchanged.

**Phase B - standalone isolation proof, driven exactly as the runner would:**
`PROV_EXIT=0`, `LINKENV_EXIT=0`, baseline snapshot taken, then phase 4 run with the isolated
`SUPABASE_URL` + isolated `DATABASE_URL` + `NABIN_RESTART_PORT=4141`:
- **`PHASE 4 TEST RESULTS: 66 PASSED, 0 FAILED (Total: 66)`**, **`P4_EXIT=0`**
- `backend online on port 4141 after **26500ms**` - measured proof that the old fixed 10 s poll was a
  latent race, visible only once the suite had to start its own backend instead of reusing one
- `Terminating backend process listening on port 4141` - the sweep is correctly private-port scoped
- hard guard: **`CLEAN: 10 protected public tables unchanged`** (`VERIFY_EXIT=0`), with `diff` confirming
  no drift since the baseline - so backend writes *and* its 19 direct-pg queries all hit `chain_scratch`,
  including the cold-restart durability assertions
- teardown exit 0; `link.env` deleted (`exists=False`)
- strays found and reaped: phase 4 exits without killing its restarted backend, so `:4141` was still
  bound. Identity was checked first (`…\backend\src\server.js`) and released **through the real
  `scripts/port_release.js` module**; afterwards `:4141` = 0 and `src/server.js` processes = 0.

**Phase C verdict: A - safe to isolate** (after the B-step adaptation, now applied).

**Phase D - registration:** `test_phase4_orders.js` appended as **link 49** with `isolated: true`. Links
1-48 unchanged, nothing else converted, no candidate mass-converted. **The in-chain verification run is
still owed**: the agent shell cannot bring the harness backend up (three documented attempts), so the next
normal-terminal `node scripts/test_chain.js` must confirm 49/49 executed, link 49 green and guard CLEAN,
with only FIN15B-20 and IDENT-09/IDENT-10 failing, before any further candidate is isolated.

**Remaining candidates, not yet inspected:** `test_phase6_dispatch`, `test_phase9_financial_security`,
`test_phase10_security`, `test_phase11_feature_control`. Phase 8 and Phase 5 are already links and are not
duplicated. Note that phase6/9 qualify as the previously-measured public writers, and phase9 carries 44
`public.` references while phase6 carries 9 - those explicit qualifications defeat `search_path`, so each
will need its own Phase A finding rather than an assumption.

---

## 2026-10-02 — Link 49 in-chain validation NOT completed: agent-shell harness failure (4th occurrence)

`node scripts/test_chain.js` was run again from this shell to validate the newly registered isolated link 49.
Result (`backend/scratch/chain52.log`): **`-1/49 links clean, 1 problem(s)`, 0 checks, 0 skipped,
CHAIN_EXIT=1`**, aborting before link 1 with
`harness never answered GET /api/health on :4000 within 90s (last observed: timeout)`. The runner's own
teardown reported `pid 25804 reaped, :4000 free`. **No checkpoint was created** - the acceptance condition
requires link 49 to actually execute, which did not happen here.

**Evidence gathered, and two of my own hypotheses falsified rather than quietly dropped:**
- Port 4000 is genuinely free before/after: any-state `Get-NetTCPConnection -LocalPort 4000` returns
  nothing; post-run listeners 0.
- Starting the identical backend from PowerShell answers `/api/health` **200 in ~12 s**
  (`{"status":"ONLINE", … "environment":"local"}`).
- **No proxy environment variables exist** in this shell, and the runner probes with raw `http.request`
  (line 249), so a proxy explanation is impossible - disproved, not assumed.
- **`detached` is not the cause:** a node-spawned child using the harness's exact options
  (`stdio:'ignore'`, `windowsHide`, `env.PORT=4000`, non-detached) served health **200 in 9 s**.
- The runner would print `harness process exited early` if the child died; **that line is absent**, so the
  child stayed alive for the full window without becoming ready.

So the failure is real and repeatable in this execution context, and its mechanism is **not yet
identified**. It is not evidence about link 49, Phase 4, isolation, or the product: the same backend, the
same suite (66/66), the same guard (CLEAN) and the same reaper all pass outside this context. Per the
runner's own wording this is a harness/environment failure and must not be read as a test failure.

**Explicitly not done, as instructed:** no inspection or modification of Phase 6/9/10/11; no change to
FIN15B-20, IDENT-09/IDENT-10 or C3; no production code; `isolated: true` on link 49 **not reverted** (it has
not been shown to be at fault, and reverting would destroy a proven-improvement on a guess); the public
contamination guard was not weakened; no commit/push/deploy.

**SUPERSEDED - correction to the paragraph above.** The statement that link 49 "remains registered but
unexecuted" and "awaits a normal-terminal run" is now **out of date**: that run happened and is
**CHECKPOINT #51**, from the owner's normal terminal:

- **49/49 links executed**, **47/49 clean**, **2,088 explicit passing checks**, **0 skipped**,
  **exit code 1**
- **link 48 `test_phase5_payments.js` = 62 passed, isolated, public guard CLEAN**
- **link 49 `test_phase4_orders.js` = 66 passed, isolated, public guard CLEAN**
- failing links: only **FIN15B-20** (`financial_authority_test`) and **IDENT-09 / IDENT-10**
  (`driver_earnings_identity_audit_test`) - unchanged, unmodified
- **no new failures**, and Phase 4's first in-chain execution passed, so the F-3(b) isolation of
  Phase 4 is validated by real execution rather than only by the standalone proof.

**#51 is the current authoritative checkpoint.** The chain is still not green while the two baselines fail.

---

## 2026-10-02 — F-3(b) Phase A: `test_phase6_dispatch.js` inspection. Classification **C — remain on public**

Read-only inspection (615 lines). **No change was made to the suite, and it was not registered or isolated.**

**Correction to an inherited number:** Phase 6 has **11** `public.` references, not 9. Counting from
memory rather than the file has now produced this error twice (phase9's 44 came from a real count, phase6's
9 did not), so every figure below is from this read.

**1. Connection paths.** One and only one: `require('pg')` (`:7`), `new Client({ connectionString:
PG_CONN_STRING })` (`:17`) with `PG_CONN_STRING = process.env.DATABASE_URL || hardcoded loopback
fallback` (`:14`). No `Pool`, no Supabase client, so the isolated `DATABASE_URL` mechanism *would* reach
this suite's queries - except where defeated by (2).

**2. Schema-qualified references - and which ones `search_path` cannot redirect.**
- `:134` `SELECT public.create_dispatch_offer_atomic(...)` and `:140`
  `public.accept_dispatch_offer_atomic(...)` - explicit function calls that **write dispatch state**.
- `:486` `INSERT INTO public.dispatch_offers (...)` - a **direct write to `public`.**
- `:316, :321, :445, :645, :651` - reads of `public.jobs` / `public.dispatch_offers` by id.
- `:679, :691, :713` - RLS probes `SELECT … FROM public.dispatch_offers` under `SET ROLE`.
All eleven are explicit qualifications, so a connection-level `search_path` **cannot** redirect any of
them. Under isolation the three write sites (`134`, `140`, `486`) would keep writing to `public`, and the
contamination guard would correctly fail the link. Per instruction, these are **not** to be rewritten into
unqualified names just to make isolation pass.

**3/4. Ports, spawned processes, restart.** `BASE_URL = http://127.0.0.1:4000` (`:12`) and
`WS_URL = ws://127.0.0.1:4000/ws` (`:13`) are hardcoded; `ensureServer` and `restartServer()` each
`Stop-Process` whatever owns **:4000** (`:82`, `:107`) and cold-start a detached backend (`:86`, `:112`,
`stdio:'ignore'`, `detached:true`). This is the same lifecycle shape Phase 4/5 had, so the private-port
adaptation would be mechanical (`B`-grade work) - and the WebSocket base URL needs it too.

**5. Mutations.** Via (2): `dispatch_offers` inserts, `jobs` status transitions through the atomic dispatch
RPCs, plus ride bookings over HTTP. Cleanup is not the issue; the write targets are.

**6/7. Dependence on existing public state - the decisive finding.** The RLS group
(`:676`-`:716`) asserts *count* properties over `dispatch_offers`: under `SET ROLE authenticated` with a
customer claim, `SELECT count(*) FROM public.dispatch_offers` must be 0 (`:691`, `:693`), and driver 1 must
see 0 foreign offers (`:713`, `:716`). But `dispatch_offers` is in `chain_scratch`'s **`SKIP_COPY`** list
(803 MB / 1.67 M rows are deliberately not cloned). On an empty clone those counts are **0 no matter what
RLS does** - the assertions would go vacuously green, i.e. isolation would quietly *destroy the very
property this suite exists to prove*. A "passing" isolated Phase 6 would be a false signal, which this
project's no-vacuous-assertion rule forbids outright.

**8. Classification: C - depends on public state by design; keep it on `public`.**
Not A (writes bypass `search_path`), not merely B (a port fix cannot repair the vacuity), not D (no product
defect is evidenced - the explicit `public.` writes look like deliberate helper design, and the suite's
read/write targets are self-consistent), not E. Isolation *could* be forced by cloning `dispatch_offers`,
which contradicts the reason it was excluded, or by rewriting eleven qualifications, which would be done
only to make a green result appear. **Recommendation: leave Phase 6 on public and rely on the per-link
drift attribution (F-3(a)) to keep its writes visible and assigned.** Its public writes are already
measurable: the reviewed chain run showed `public.dispatch_offers`-adjacent tables (`jobs`) moving while
this suite ran.

**Consequences for the candidate list:** Phase 9 (44 `public.` refs, previously measured) almost certainly
lands the same way, so the remaining plausible isolation candidates are
`test_phase10_security` (only 2 checks - near-empty, likely not worth isolating at all) and
`test_phase11_feature_control` (24 checks; mints an admin user and toggles flags). Each still needs its own
Phase A read before any conclusion.

---

## 2026-10-02 — F-3(b) Phase A: `test_phase9_financial_security.js`. Classification **C — remain on public**

Read-only inspection of 479 lines. **No edits, no registration, no isolation.**

**Counting correction:** the file has **46** `public.` occurrences, not the "44" carried in earlier notes —
the third time this session an inherited figure proved wrong, so every number here was recounted from source.

**1-5. Connections and qualifications.** One DB path only: `require('pg')` (`:9`), `new Client({
connectionString: DB_URL })` (`:63`), `DB_URL = process.env.DATABASE_URL || 'postgresql://…54322/postgres'`
(`:12`). No `Pool`, no Supabase client, no HTTP client. The 46 explicit qualifications are:
- **writes** — `INSERT` into `public.ledger_entries` (`:163`), `public.journal_transactions` (`:185`,
  `:201`), `public.journal_lines` (`:208`), `public.driver_payouts` (`:223`),
  `public.payment_webhooks` (`:235`), `public.payment_refund_authorizations` (`:250`),
  `public.payments` (`:278`), `public.payment_sessions` (`:356`); `DELETE` at `:177`, `:241`, `:339`,
  `:393`; and `TRUNCATE public.ledger_entries` (`:132`).
- **refusal probes** (must be denied by triggers/constraints) — the `UPDATE … amount/wallet_balance` forms at
  `:119`, `:170`, `:192`, `:214`, `:228`, `:290`, `:297`, `:304`, `:312`, `:326`, `:365`, `:372`, `:380`,
  `:419`, `:427`, `:435`, plus the generated `public.${table}` at `:410`.
- **reads of seeded rows** — `SELECT id FROM public.drivers|users|merchants|payments … LIMIT 1` at `:220`,
  `:247`, `:273`, `:417`, `:425`, `:433`; read-backs at `:320`, `:334`, `:340`, `:388`, `:394`.

**6-8. Ports, spawned processes, restart — none.** No `BASE_URL`, no :4000, no `spawn`, no `Stop-Process`,
no restart; only `readFileSync` of `src/server.js` / `src/database.js` for static source probes. Lifecycle-wise
this is the *cleanest* of the five candidates: it could be registered without any port work.

**10. Cleanup.** Partly disciplined — several probes run inside `BEGIN` … `ROLLBACK` in a `finally`
(`:115`/`:123`, `:128`/`:136`) and it deletes its own payment (`:339`) and session (`:393`). **Not fully
self-cleaning by design:** the `phase9_append_only_probe` ledger insert is committed because the deletion
refusal *is* the assertion — the residue measured earlier (`public.ledger_entries` at 12 rows, then 13 after
one verification run).

**11-14. Why isolation fails here (differently from Phase 6).** Historical-row dependence is *not* the
problem: the clone copies `users`, `drivers`, `merchants`, `payments`, `journal_*`, and **`audit_logs` is
referenced 0 times**, so the excluded-table vacuity that sank Phase 6 doesn't arise. The blocker is that all
46 references are explicit, so an "isolated" run would keep writing **into `public`** — including
`TRUNCATE public.ledger_entries` and `DELETE FROM public.payments`. The contamination guard would correctly
fail the link, and the destructive statements would be executed by a test that was supposed to be contained.
`search_path` therefore cannot preserve this suite's meaning without rewriting all 46 qualifications, which is
prohibited here.

**Classification: C — intentionally public-attaching by design; leave on `public`.** Not B (the change is not
narrow: schema-parameterising 46 call sites), not D (no product defect evidenced), not E (owns no port).

**Recorded for a future decision, deliberately not attempted:** the only clean path to isolating Phase 9 is a
`SCHEMA` constant defaulting to `public`, substituted through those references, plus a ruling on the
committed append-only rows. That is a test-design change with real blast radius.

**Next, per instructions:** Phase 11 and Phase 10 each get their own Phase A read. **Nothing is implemented
until all three classifications are documented.**

---

## 2026-10-02 — F-3(b) Phase A: Phase 11 and Phase 10 inspected. Classifications **B** and **C**

Source-only. Neither file was modified, registered, or isolated. Counts below were recounted from source.

### `test_phase11_feature_control.js` (293 lines) — **B: isolatable after narrow test-only adaptation**
**1-5. Connections and qualifications:** **zero** `require('pg')`, zero `Pool`, zero `DATABASE_URL` use, and
**exactly 0** `public.` references. It reaches the database **only through the backend over HTTP**
(`BASE_URL = 'http://127.0.0.1:4000'`, `:7`).
**6. Financial/audit side effects:** none referenced - no `audit_logs`/history assertion, so the clone's
deliberate exclusion of `audit_logs` is irrelevant here.
**7-9. Ports and processes (the only blocker):** hardcoded `:4000` base URL; spawns its own server
(`spawn('node', ['src/server.js'])`, `:52`); and kills **by port** via `netstat -ano` + `taskkill /F /PID`
(`:80`-`:87`), called at `:100` and `:317`. It does keep direct handles too (`server.kill()` / `server2.kill()`
on exit paths), so it is a mixed model. Adapting it is the same narrow change Phases 4/5 received - derive
`TEST_PORT`/`BASE_URL` from `NABIN_RESTART_PORT` and scope the port kill to it - plus one caveat: it uses
`netstat`, which is sandbox-blocked for the agent shell, so a private port also removes that dependency.
**10-11. Cleanup and prior-state dependence:** it **restores what it toggles** - `FEATURE_RIDE_TAXI` is
re-enabled at `:252` after a comment at `:246` records that it previously was *not*, `FEATURE_RIDE` is
re-enabled at `:295`/`:309`, and `:321`/`:324` assert it is `enabled === true` at the end. So its end state
is deliberately restored, not abandoned. It bootstraps its own admin (`/api/admin/bootstrap`, `:108`) and
support user (`:114`), and its one dependence on pre-existing rows is the registered HYBRID_BOTH merchant
store checked at `:156`-`:160` - `merchants` is copied into the clone, so that survives isolation.
**12-14. Meaning under isolation:** every assertion is a request/response property through the redirected
backend, so `SUPABASE_URL` isolation preserves intent fully; nothing goes vacuous (25 `assert(` sites; 24
checks reported in Checkpoint #51). No broad redesign needed.

### `test_phase10_security.js` (233 lines) — **C: operates on `public` by design; remain public (and low value to isolate)**
**1-4. Connections:** `require('pg')` (`:11`), one `new Client({ connectionString: DB_URL })` (`:222`),
`DB_URL = process.env.DATABASE_URL || 'postgresql://…54322/postgres'` (`:16`). No Supabase client.
**5. `public.` references: exactly 3**, but they are **templates**, so they do not scale down: `:202`
`UPDATE public.${table} SET ${col} = … WHERE id = $1`, `:204` `disableRls: public.${table}`,
`:205` `regrant: GRANT UPDATE ON public.${table} TO authenticated`. One occurrence of each string covers
every protected table the loop walks.
**6. Schema/permission side effects - the decisive finding:** `attemptClientWrite` executes
**`ALTER TABLE <target> DISABLE ROW LEVEL SECURITY`** (`:150`) and **`GRANT UPDATE … TO authenticated`**
(`:151`) before attempting the write, then restores. Those are **DDL and privilege changes against
explicitly-qualified `public` tables**, i.e. the test temporarily removes real protections to prove the
application layer still refuses tampering. Because `chain_scratch` and `public` live in the **same**
database, an "isolated" run of this suite would still disable RLS and grant UPDATE on the **real** tables -
contamination the guard would catch, and, worse, a live security weakening that a crash between disable and
restore could leave behind.
**7-9. Ports/processes:** also hardcoded `:4000` (`:60`) with a PowerShell port kill (`:108`), its own spawn
(`:112`) and a `Backend server did not become healthy on port 4000` throw (`:125`) - so it would need the
same B-grade port adaptation *before* anything else.
**10-12. Cleanup / prior state:** it re-enables RLS and revokes, and authenticates seeded test phones
(`:229`-`:232`), all of which exist in the clone. Dependence on history is therefore not its problem.
**13-15. Verdict:** isolation cannot preserve this suite's meaning without rewriting its explicit
qualifications, and the owner instruction forbids doing that merely to enable isolation. Separately, the
cost/benefit is poor: the last run reported only **2 passing checks** for this file, so it would take the
most adaptation *and* carry the highest residual risk for the least coverage. Classify **C**; if it is ever
revived, the priority should be *why it asserts so little*, not where it runs.

### Decision set (all four candidates now classified, nothing implemented)
| suite | class | reason |
|---|---|---|
| Phase 4 `test_phase4_orders` | **isolated, in-chain green** (Checkpoint #51, 66 passed, guard CLEAN) | done |
| Phase 5 `test_phase5_payments` | **isolated, in-chain green** (#51, 62 passed, guard CLEAN) | done |
| Phase 6 `test_phase6_dispatch` | **C** | 11 explicit `public.` refs incl. writes; RLS counts go vacuous because `dispatch_offers` is excluded from the clone |
| Phase 9 `test_phase9_financial_security` | **C** | 46 explicit `public.` refs incl. `TRUNCATE`/`DELETE`; committed append-only probes by design |
| Phase 10 `test_phase10_security` | **C** | issues `ALTER TABLE public.x DISABLE ROW LEVEL SECURITY` + `GRANT` on real tables; only ~2 checks |
| Phase 11 `test_phase11_feature_control` | **B** | no DB/`public.` refs at all; purely HTTP; blocked only by hardcoded `:4000` + `netstat`/`taskkill` port kill |

**Consequence:** exactly **one** further candidate is worth doing - Phase 11, via the same narrow
private-port adaptation already applied to Phases 4 and 5. Phases 6, 9 and 10 should stay on `public` and
be watched through F-3(a) per-link drift attribution. Awaiting approval before any edit.

---

## 2026-10-02 — F-3(b) Phase 11: adaptation applied, but the standalone isolation proof FAILED (my proof harness, not the suite). Phase 11 NOT registered.

**Code change (test-only, as approved)** in `test_phase11_feature_control.js`:
- `TEST_PORT = NABIN_RESTART_PORT || NABIN_TEST_PORT || 4000`, `BASE_URL` derived from it (default
  behaviour with no env is identical to before);
- both `killProcessOnPort(4000)` calls now `killProcessOnPort(TEST_PORT)`, so the netstat/taskkill sweep can
  never target the shared harness port;
- the spawned backend now receives an explicit `env.PORT = TEST_PORT`;
- startup detection unchanged (the `Backend running` stdout line), but the 15 s deadline became 90 s, since
  measured cold boots are 7-26 s; the rejection message now names the port.
`node -c` exit 0. **No assertion was added, removed, or relaxed**; all 25 `assert(` sites stand.

**What the proof run showed.** Chaining `provision -> link-env -> snapshot -> run -> verify -> teardown` in
one PowerShell command produced `PROV=0 LINKENV=0 SNAP=0 P11_EXIT=0` yet **`VERIFY=1`** - and the truth is
worse than a green-with-caveats: `backend/.chain-scratch/state.json.failed` existed and
`chain_scratch status` reported *schema absent, PostgREST not running, proxy not running*. So `provision`
had failed (its own EADDRINUSE-on-`:54331` liveness guard, triggered by a **stale proxy left by an earlier
manual provision in this session**), no clone ever existed, and because the command did not abort on that
failure Phase 11 ran with **no isolated environment at all** - its backend loaded `backend/.env` and talked
to `public` through Kong. The suite passing (P11_EXIT=0) therefore proves **nothing about isolation**, and
`verify` exiting 1 is the guard correctly reporting real drift.

**Classified cause: (a) my proof harness, not Phase 11 and not the isolation mechanism.**
1. The proof command treated each step as independent and never stopped when `provision` failed - a
   sequential proof must abort on the first non-zero step, otherwise "all steps ran" is meaningless.
2. It also never confirmed the clone was live before running the suite; a `status`/`link.env exists` gate
   would have caught it immediately.
3. The underlying trigger was environmental: a leftover proxy on `:54331` from earlier manual work. The
   mechanism behaved exactly as designed - it refused to hand back a dead `SUPABASE_URL`.

**Contamination this caused (measured, not estimated):** `public.ledger_entries` 2,310 -> **2,321**,
`public.orders` 2,767 -> **2,779**, `public.payments` 1,635 -> **1,644** - produced by an unisolated Phase 11
run (it bootstraps an admin, creates a support user, books rides/identity rows and toggles flags). Flag
state itself was restored by the suite's own logic, so no feature is left disabled.

**Cleanup afterwards:** `teardown` exit 0 (removed `nabin_chain_rest`, confirmed schema absent, deleted
`link.env` + `snapshot.json`); the `state.json.failed` marker removed; listeners on `4000, 4151, 54331,
54332` all **0**; **0** stray `src/server.js` processes; no credential-bearing file on disk.

**Status: Phase 11 remains UNREGISTERED.** The adaptation stands, but acceptance requires a real isolated
run, which must be rebuilt with hard fail-fast gates: no stale proxy on `:54331`; provision succeeds; clone
confirmed live; `link.env` exists and is loaded *before* the suite starts; suite passes; `verify` CLEAN;
teardown + private-port release. Redoing that proof is the next action, and until it passes nothing is
registered. Checkpoint numbering is unchanged and #51 (49/49) stays authoritative; #52 can only come from a
real 50-link chain run.

---

## 2026-10-02 — F-3(b) Phase 11: corrected fail-fast proof PASSED standalone. Registered as link 50. Checkpoint numbering frozen.

**The rebuild, and why it is trustworthy where the first attempt was not.** The proof is now a single Node
script, `backend/scratch/p11_isolated_proof.js`, in which **every step is gated on its own exit code** and
the first failure aborts before the suite can run, with teardown and hygiene enforced in `finally`. That
design paid for itself immediately: the *first* corrected run reported `provision exit 0` and then
**STOP**ped at "status reports PostgREST running" - my matcher expected `nabin_chain_rest: running` while
`chain_scratch status` prints it **quoted** (`'running'`). The abort cost nothing (it tore down clean, all
9 hygiene checks OK, and Phase 11 never ran against `public`), and it proved the sequencing bug from the
invalid attempt could no longer recur. After the matcher was widened, the run is accepted as standalone
evidence:

```
PROOF_EXIT=0
STEP 1-3  docker 29.7.2; :54321 and :54322 reachable; :54331/:54332/:4151/:4000 ALL free;
          stale artifacts (failure marker, snapshot, link.env) removed
STEP 4-6  provision exit 0 (1037 refs renamed; clone 58 tables / 98 policies / 30 triggers)
          status: schema PRESENT, PostgREST 'running', proxy running   [3 checks OK]
STEP 7-9  link-env exit 0; link.env EXISTS; SUPABASE_URL=http://127.0.0.1:54331;
          DATABASE_URL carries search_path=chain_scratch
STEP 10   snapshot exit 0 - baseline for 10 protected tables
STEP 11-12 Phase 11 under isolation: exit=0  [PASS]=25  [FAIL]=0  (Count: 24 per the suite's own summary)
          flag-restoration evidence present: true
STEP 13   CLEAN: 10 protected public tables unchanged          (VERIFY_EXIT=0)
PROOF RESULT: ISOLATED PHASE 11 PASS + GUARD CLEAN
STEP 14-15 teardown exit 0; schema absent; :54331 free; :54332 free; private port free; :4000 free;
          link.env removed; snapshot.json removed; no failure marker; stray src/server.js = 0
```

**Why "public unchanged" plus "the suite passed" is the isolation evidence.** Phase 11 has **zero** `pg`
connections and **zero** `public.` references, so every effect it produces travels through the backend it
spawns. That backend was started with the injected isolated `SUPABASE_URL`, the suite's 25 assertions all
passed (admin bootstrap, support user, flag toggles, the parent/child override, persistence across its own
restart), and every protected `public` table was byte-for-byte unchanged afterwards. The writes therefore
landed in `chain_scratch`, and the guard - not an inference - is what says so. Acceptance items 1-10 are all
met by this run. No assertion was added, removed or relaxed, and `DATABASE_URL` is still injected even though
this suite does not use it, per the runner contract.

**Registration.** `test_phase11_feature_control.js` is now **link 50**, appended after link 49 so links
1-49 and the numbers of the proven isolated links 48/49 are unchanged. Phase 6, 9 and 10 stay on `public` as
classified; no production code, no C3, no baseline change.

### Checkpoint numbering - frozen and explicit
- **#50** = the 48-link run (48/48 executed, 46/48 clean, 2,022 checks, 0 skipped, exit 1)
- **#51** = the 49-link run (49/49 executed, 47/49 clean, 2,088 checks, 0 skipped, exit 1)
- **#52** = **only** a successful full 50-link chain run. The standalone proof above is *not* a checkpoint,
  and no checkpoint number may be assigned to a run that does not execute all 50 links.

### The earlier contamination stays as it was recorded
The invalid proof left `public.ledger_entries` 2,310 -> 2,321, `public.orders` 2,767 -> 2,779,
`public.payments` 1,635 -> 1,644. That remains documented as **harness contamination from a failed proof
attempt**, not a Phase 11 product defect, and per instruction **no cleanup is attempted here** - no rows
deleted or reversed. If a later baseline or test behaviour turns out to be affected by it, the correct action
is to stop and report the exact evidence and affected tables rather than invent a repair.

**Next:** the only remaining step for F-3(b) Phase 11 is in-chain validation - a full 50-link run from a
normal terminal, confirming link 50 executes isolated and green alongside links 48/49, that per-link drift
attribution still works, that only FIN15B-20 and IDENT-09/IDENT-10 still fail, and that all cleanup holds.
**Checkpoint #52 is established only by that run.**

---

## 2026-10-02 — F-3(b) Phase 11 count discrepancy reconciled: per-link subtotal rule. The 50-link run reported `1 passed` for link 50; the suite actually ran **24**.

### The parser finding, from the real log
`.chain-logs/test_phase11_feature_control.log` (the owner's 50-link run) shows the suite ran isolated on
private port **4101** (`Killing lingering process on port 4101 PID: 8332`), printed 23 `✅ [PASS] n.` check
lines plus one unprefixed `[PASS] TASK2 guard` line, then its own summary **`Count: 24`** / **`PASS`** and
exited **0**. So coverage was complete; only the *count* was wrong.
`scanOutput()` counted **1** because its marker pattern is anchored to the **start of a trimmed line**:
`/^(PASSED\b|\[PASS\]|✔|PASS[:\s])/`. `✅` (U+2705) is **not** `✔` (U+2714), and `✅ [PASS] 1. …` does not
*start* with `[PASS]`, so none of the 23 check lines matched - only the guard line did. Its `summaryCount`
patterns (`N checks PASSED`, `passed=N`, `N/M assertions passed`) do not know this suite's `Count: N` form
either. Classification: **parser/counting issue (A), aggravated by an output-format mismatch (B)**. It is
**not** a coverage change (C ruled out), and the suite itself is correct.

### Why the global `✅` fix was rejected - measured, not assumed
Adding `✅` to the generic marker pattern was tried and then measured against **all 50 real per-link logs**
(`scratch/p11_count_regression.js`). It changed the advisory count of **43 links**: e.g.
`admin_authorization_test` 0→115 (against its reported 35), `test_suite` 0→447, `restart_test` 0→41,
`geo_adversarial_test` 0→62 - because many suites print far more `✅` lines than they count as checks, and
the runner takes `max(markerCount, summaryCount)`. That would have **inflated** the chain total by hundreds,
far worse than the undercount it fixed. The change was **reverted byte-for-byte** and the finding recorded in
a comment at the pattern site.

### The per-link solution (as approved)
`scanOutput(text, subtotalPattern)` now accepts an **opt-in per-link** subtotal pattern; when present and it
matches, the suite's own subtotal replaces the generic count for **that link only**.
`test_phase11_feature_control.js` declares `subtotalPattern: /^Count:\s*(\d+)\s*$/m`. Every other link has
`subtotalPattern === undefined` and keeps `max(marker, summary)` semantics byte-for-byte. The count remains
advisory - the exit code still decides whether a link passed. No assertion, no output format, and no
production code was changed.

### Regression and reconciled arithmetic
`node scratch/p11_count_regression.js` -> **REGRESSION OK**, exit **0**: `link 50 phase 11: generic=1
withRule=24 ownCount=24 -> OK`; **exactly one** link changed across 50 logs; `total generic=2089
withRule=2112 delta=+23`. Those two totals are computed from the real logs, not estimated:
- **2,089** = what the un-reconciled 50-link run reports (Checkpoint #51's 2,088 + link 50's mis-counted 1),
- **2,112** = the true explicit-passing total once link 50 counts its own 24 (2,088 + 24).
`node -c scripts/test_chain.js` exit 0.

### Checkpoint #52 status: **not yet established**
Numbering stays frozen - **#50** = 48-link run, **#51** = 49-link run, **#52** = the corrected successful
**50-link** run. It requires a full-chain execution, and this agent's sandbox shell still aborts the runner
at harness boot (`harness never answered GET /api/health on :4000`, 5 consecutive zero-link failures, while
manual boots of the same server succeed in 7-26s), so **no checkpoint is claimed from it**. The preceding
50-link run already proved link 50 isolated + guard CLEAN + exit 0; the re-run is needed only so the
reported total reads 2,112 with link 50 = 24. Expected #52 shape: 50/50 executed, 48/50 clean, 2 known
problem links (FIN15B-20, IDENT-09/IDENT-10), 0 skipped, 2,112 checks, link 48 = 62 isolated/CLEAN, link 49
= 66 isolated/CLEAN, link 50 = 24 isolated/CLEAN, no new failures, and full hygiene (`:4000` free, private
ports free, no stray `src/server.js`, `chain_scratch`/proxy/container removed, no `link.env`).

The earlier harness contamination of `public` (ledger 2,321 / orders 2,779 / payments 1,644) remains
documented and **unrepaired** by instruction.

---

## 2026-10-02 — Checkpoint #52 (real run). **F-3 CLOSED.** F-1 verified already closed. F-2 inspected - it needs an owner decision

### Checkpoint #52 - real normal-terminal run, authoritative

| Metric | Value |
|---|---|
| Links executed | **50 / 50** |
| Fully green links | **48 / 50** |
| Explicit passing checks | **2,112** |
| Skipped | **0** |
| Exit code | **1** |
| Failing checks | **FIN15B-20, IDENT-09, IDENT-10** - known set only, no new failures |

Verified isolated links, all with the hard public guard: **48** Phase 5 = 62 passed, isolated, CLEAN;
**49** Phase 4 = 66 passed, isolated, CLEAN; **50** Phase 11 = **24** passed, isolated, CLEAN - which is the
count the per-link subtotal rule predicts, confirming the counting fix in production rather than only in the
regression. The total reconciles exactly: #51's 2,088 + 24 = **2,112**.

### F-3 is CLOSED
Mechanism (`chain_scratch` clone + throwaway PostgREST + prefix/profile-rewriting proxy + per-link
`search_path` + `SUPABASE_URL` redirection), the authoritative contamination guard, per-link drift
attribution, the private-port reaper, and 20 of the 24 lifecycle checks were all built in #48-#52.
**Final classification set:** Phase 4 isolated, Phase 5 isolated, Phase 11 isolated; Phase 6, Phase 9 and
Phase 10 remain on `public` (class C - explicit `public.`-qualified writes, and for Phase 10, `ALTER TABLE
public.x DISABLE ROW LEVEL SECURITY` plus `GRANT`s that must act on the real tables to mean anything).
Nothing was made to look green by cloning excluded tables or rewriting qualifications.

### F-1 is already closed - verified, not re-implemented
Re-checked against the tree rather than memory: the legacy `GET /api/grocery/products/:id/history` is **not**
anymounted (the only match in `server.js` is the explanatory removal comment at `:6250`); the durable
authenticated merchant endpoint `GET /api/merchant/grocery/price-history` is intact at `:6266`; and
`grocery_price_history_read_test.js` carries **F1-01** (`:198`, no 200 on the removed path), **F1-02**
(`:200`, no `changedBy`/`storeId` leak) and **F1-03** (`:203`, durable endpoint unaffected). The consumer
audit had already been repeated with the corrected search method (the first one was invalid because PowerShell
`-Path` does not expand `**`), found no consumer, and the removal has been chain-green since Checkpoint #47.
Re-implementing it would have been redoing finished work, so it was verified instead.

### F-2 investigated - `POST /api/advertisements/:id/click`. A legitimate consumer exists, so this is a policy decision
**Handler** (`server.js:2709`): no authentication middleware and no rate limit on the route; it calls
`db.recordAdClick(req.params.id)`, 404s when the ad is unknown, and returns `{ success, clicks, dataSource,
persisted }`.
**Implementation** (`database.js`, `recordAdClick`): the live path is `this.adRepo.bumpCounter(adId, 'clicks')`
- a durable in-row counter increment, which is what `bumpCounter` exists to do after the forensic repair - and
the fixture path increments an in-memory object with `persisted: false`.
**Repo-visible consumers:** **`backend/test_suite.js:744-748`** - **AD-07** asserts
`POST /api/advertisements/:id/click` persists the counter in PostgreSQL (`dataSource === 'postgres'` and
`persisted === true`), with the comment "Clicks are counted in the row, not in a map that dies on restart."
No frontend or mobile caller was found, which is expected for an endpoint exercised by the platform's own ad
client later or by the campaign reporting flow.
**Assessment:** the inflation concern is real - unauthenticated anyone can raise `clicks`, and clicks feed
campaign reporting and advertiser value - but the endpoint itself is **intentional and contract-tested**.
Removing or gating it would change the product's billing/analytics semantics and would break AD-07, so it is
**not** a mechanical fix and nothing was implemented. Options for the owner: (a) per-IP (or IP+ad) rate limit
keeping the public contract and AD-07 intact; (b) accept clicks but record them as deduplicated events so
reporting can exclude repeats; (c) treat clicks as billable only when derived from an impression token;
(d) accept the current behaviour as ad-analytics convention and document it. Recommendation: **(a)** as the
smallest change that preserves the tested contract, with a regression proving repeated unauthenticated clicks
cannot inflate without limit while a legitimate single click still persists.

**No files were changed for F-2.** Phases 4/5/6/9/10/11, FIN15B-20, IDENT-09/10 and C3 are untouched; the
earlier `public` contamination is left unrepaired; no commit, push, or deploy.

---

## 2026-10-02 — F-2 correction and stop: several rate-limiting claims in the earlier §15 audit were inherited, not verified. They are withdrawn.

### What is untrue
While starting F-2 option (a) I went to read the infrastructure I had previously described, and **these files
do not exist in this repository** (each `Test-Path` = False):
`src/security.js`, `src/rateLimitStore.js`, `src/config/settings.js`, `src/services/RateLimitService.js`.
They were first checked at the paths I had cited and then across all of `src/**/*.js`. Therefore the following
statements from the earlier §15 auth/isolation audit response are **withdrawn as unsupported**:
- "`trust proxy` is set to 1 hop (`server.js:225`)" and "`validateForwardedHeaders` (`security.js:170`) strips
  un-trusted forwarding headers, fail closed with 403 `FORWARDING_HEADER_NOT_TRUSTED`";
- "the `OTP_THROTHLE`/`OTP_THROTTLE` profiles declared at `server.js:90-94`" and "`enforceRateLimit(key, 'OTP_THROTTLE')`";
- "`AD_BOUNTY_CLAIM` is defined as `'5/hour'` in `settings.js:67`" and the whole named-profiles table;
- "the limiter is fail-closed (`rateLimitStore.js:54`)".
No `rate.?limit|trust.?proxy|RATE_LIMIT` match of any of those forms exists anywhere in `src`. These lines came
from the inherited session summary rather than from reading this tree, and I repeated them as citations. That
is exactly the failure mode this project has been guarding against all day, and it was mine. The IDENT-09/10
chain links are real (they are registered entries and have run in #48-#52), but my *description* of them as
forwarded-header spoofing defences is likewise unverified and should not be relied on until re-read from source.

### What actually exists (read from source)
Two **process-local in-memory** limiters, and no durable mechanism at all (no Redis, no limit table):
1. `server.js:1404-1416` - `const bootstrapAttempts = new Map()`; keyed on
   `req.ip || req.connection?.remoteAddress || 'unknown'`; progressive lockout via `lockedUntil`; replies
   **403** with a generic message (`GENERIC_ERROR`) so it leaks nothing.
2. `database.js:119` + `6029-6039` - `this.rateLimitRecords = new Map()`; comment
   `// Check Rate Limiting (max 5 requests per 10 minutes)`; rolling window reset when
   `now - windowStart > 10 * 60 * 1000`; throws when `count >= 5`. (Pre-existing quirk, not touched: the OTP
   store key is `${normPhone}_${role}_${purpose}` at `:6026` while the rate record keys on `normPhone` alone
   at `:6030`/`:6038`.)

### Why F-2 stops here
Rule 8 of the F-2 directive: take the limit and window from an existing project convention if one exists,
otherwise **stop for owner input rather than inventing a business-critical click threshold**. A *pattern*
exists - an in-memory Map, `req.ip` as requester identity, count/window or lockout semantics, generic error
body. A *threshold for ad clicks* does not: the only numeric convention in the tree is OTP's **5 per 10
minutes**, and OTP is an authentication flow, not a billing-adjacent engagement metric. Reusing that number
for clicks would be inventing a threshold by analogy on the very metric advertisers are valued on, so I am not
choosing it unilaterally.
**Owner input needed:** the count and window for `advertisement id + requester IP`, e.g. 1 per 60 seconds,
3 per 5 minutes, or 10 per hour. Given the existing convention set, I would also note that whatever is chosen
is **process-local** (it resets on restart and is per instance) and will be documented as such per rule 4 - a
durable limiter would be a larger change than F-2 authorises. On approval of a number I will do the standard
cycle: real-HTTP RED proving unbounded inflation -> smallest reuse of the existing Map pattern keyed on
ad id + `req.ip` -> permanent F2-01..F2-10 regression with AD-07 preserved -> focused suites -> owner's
full-chain run -> next checkpoint from real results.

**Nothing was implemented for F-2 and no file was changed by this correction except this document.**

---

## 2026-10-02 — F-2 implemented: 3 clicks / 10 min per `<advertisementId>:<req.ip>`. RED -> GREEN, 13/13

**Owner-selected threshold:** 3 permitted clicks per 10 minutes, keyed `<advertisementId>:<requester IP>`.

### RED, from real HTTP before the change
`ad_click_rate_limit_test.js` started its own backend and clicked the public
`POST /api/advertisements/:id/click` unauthenticated. The counter went **0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6**
with no limit: the 4th click returned **200 `clicks:4`**, the durable counter kept climbing to **5** and
**6**, and a request carrying a forged `X-Forwarded-For: 203.0.113.77` was simply counted as another click.
F2-02/03/05 failed by design; F2-06 (404) and F2-08 (contract shape) passed before and after.

### The fix - smallest possible, reusing what the repository already has
`server.js`, immediately above the click route: `const adClickBuckets = new Map()` with
`AD_CLICK_LIMIT = 3`, `AD_CLICK_WINDOW_MS = 10 * 60 * 1000`, requester key
```${req.params.id}:${req.ip || req.connection?.remoteAddress || 'unknown'}`` - the same `req.ip` expression
the existing `bootstrapAttempts` limiter uses. The bucket is checked **before** `db.recordAdClick` is reached,
so a throttled click cannot move the counter; the reply is **429** with
`{ success:false, code:'AD_CLICK_RATE_LIMITED', error, limit:3, windowMs:600000, retryAfterMs }`, and
`retryAfterMs` is the real remaining window. Unknown ids still 404 **and the budget is refunded**
(`bucket.count -= 1`), because guessing identifiers must not be a way to block a legitimate reader.
No Redis, no new table, no second rate-limit subsystem (`database.js` `rateLimitRecords` and
`bootstrapAttempts` remain the only other limiters, and this follows their pattern). No analytics semantics
changed beyond the throttling.

### GREEN
`node ad_click_rate_limit_test.js` -> **PASS: 13 passed, 0 failed**, exit **0**:
F2-01 first permitted click 200 with the existing contract; F2-02 2nd/3rd permitted, **4th = 429 with the
exact body**; F2-03 throttled clicks leave the durable counter **frozen at the 3rd permitted value**; F2-04 a
different advertisement returns 200 (independent bucket); **F2-05 a spoofed `X-Forwarded-For` does NOT buy a
fresh bucket**; F2-06 unknown advertisement still 404; F2-07 AD-07 semantics hold; F2-08 the response still
carries the store's own `dataSource`/`persisted`; F2-09 **no audit or financial side effects**
(`audit_logs` and `driver_payouts` counts unchanged); F2-10 permitted-click accounting stayed inside the
limit. `node -c src/server.js` exit 0.
One deliberate change to my own test: F2-01/04/07 originally hard-required `dataSource:'postgres'`, but this
boot came up in **fixture** mode (`persisted:false`) because PostgREST was unavailable, so they now assert
`persisted === (dataSource === 'postgres')` - durability must match what the store claims, never claim
persistence over fixture data. **AD-07 itself is untouched** and remains the postgres-specific guarantee in
`test_suite.js`, where the chain harness boots against the real store.

### Explicit limitations of this mechanism (per rules 4 and 11)
- **process-local** - a plain in-memory `Map` in the Node process;
- **resets on backend restart** - buckets do not survive a redeploy or crash;
- **per instance** - behind multiple instances each has its own counter, so the effective global allowance is
  3 x instances per window;
- **not a final distributed anti-abuse mechanism** - durable/shared limiting (Redis or a limit table) is out of
  F-2 scope and remains open work; the Map also grows with distinct keys until restart (no eviction yet),
  which is acceptable at this scale and noted rather than hidden.

### Not registered yet, on purpose
This suite advances `advertisements.clicks` durably whenever the backend is live, so registering it as a
**public** link would add new `public` contamination on every chain run - the same class of problem F-3 was
built to prevent. `advertisements` is copied into the `chain_scratch` clone, so `{ isolated: true }` would
keep the clicks in the clone and let the guard attest it. That is a one-line registration decision with a
contamination consequence, so I am flagging it instead of choosing it silently: recommend **link 51 with
`isolated: true`**, then the owner's full-chain run, then Checkpoint #53 from real results. Phases 4/5/11
isolation, Phases 6/9/10 on `public`, C3, FIN15B-20 and IDENT-09/10 are untouched.

---

## 2026-10-02 — F-2 link 51 isolated **live-PostgreSQL proof PASSED** (suite 19/19, guard CLEAN). Chain deliberately not run.

**Fixtures removed from the proof.** The suite no longer assumes `ads[1]` exists - that assumption is what
killed the first isolated attempt (`ads=1`, then a `TypeError` on `undefined.id`). It now authenticates as
admin and **publishes its own two ACTIVE campaigns** through `POST /api/admin/advertisements`, the same
authenticated route and payload shape AD-01 uses (`test_suite.js:669-690`), capturing both UUIDs explicitly.
Every write stays inside `chain_scratch` because the injected URLs point there.

**Strict live gate held.** `NABIN_F2_REQUIRE_LIVE=1` was mandatory; **F2-L00 passed**, proving the isolated
backend served `dataSource: 'postgres'` / `persisted: true` and that a SQL connection to the injected isolated
`DATABASE_URL` works - the fixture-mode gap from the focused run is closed. Durability is read from the row,
never from response text.

**Exact durable sequence, from SQL (all four live checks passed):**
```
F2-L01  row moved N -> N+1 on the first permitted click
F2-L02  sequence is exactly N+1, N+2, N+3 for the three permitted clicks
F2-L03  the 4th and 5th clicks left the row at N+3
F2-L04  throttle still in force for that ad+requester inside the window
```
The 4th click returned **429** with `code: 'AD_CLICK_RATE_LIMITED'`, `limit: 3`, `windowMs: 600000` and a
positive `retryAfterMs`, and carried **no** `clicks` field, so a throttled request cannot masquerade as a
recorded click. **Bucket isolation** was shown by campaign B's first click returning 200 while A was throttled.
**Unknown-ad** behaviour was tightened into a live SQL assertion: three bogus ids each 404, B's row unchanged
across all of them, B's next legitimate click permitted and moved the row by exactly **+1**, and
`audit_logs` / `driver_payouts` / `ledger_entries` SQL `COUNT(*)` values identical before and after (explicitly
not PostgREST counts, which `max_rows` can cap into a vacuous pass).

**Guard and totals.** `suite exit=0`, **19 passed / 0 failed** (20 `✅` glyphs because the driver also counts
the live-gate probe line), and the hard public guard returned **`CLEAN: 10 protected public tables unchanged`**.
Teardown exit 0; schema absent; `:54331`, `:54332`, private `4161` and `:4000` all free; `link.env`,
`snapshot.json`, `state.json` and any failure marker removed.

**One honest caveat - and what it turned out to be.** The hygiene check `no stray src/server.js` **FAILED** at
the 10-second settle deadline. Re-measuring immediately afterwards found **zero** such processes and port 4161
free, so this was the spawned backend outliving the settle window, not a leaked process. The settle was raised
from a single snapshot to poll-to-deadline (10 s) in this session, which already removed the earlier false
failure; the remaining lesson is that 10 s is shorter than a cold backend shutdown, and the proof driver should
be given a longer deadline rather than treating the first observation as a leak. Genuine leaks still fail - they
just get time to prove they are not one.

**Also noted, not faked:** a truly *different requester IP* cannot be synthesised from one loopback client, and
the server demonstrably does not honour `X-Forwarded-For` (F2-05 proves a forged header gains no fresh bucket,
which is the security-relevant direction). So independence across source IPs is asserted at the key level
(`adId + req.ip`) and by the B-bucket evidence, and the limitation is documented instead of being simulated.

**Status: link 51 is PROVEN in isolation** (live Postgres, durable SQL evidence, 429 contract, bucket
independence, unknown-ad budget refund, side-effect guard, contamination CLEAN, full teardown). The **51-link
chain was not run**, per instruction, so **Checkpoint #53 is not established** - #52 (50 links, 2,112 checks)
remains authoritative. The limiter is still **process-local**: it resets on backend restart, applies per
instance (effective global allowance 3 x instances per window), has no key eviction, and is not a distributed
anti-abuse mechanism.

---

## 2026-10-02 — Root cause of the chain boot failure, finally measured: **this agent's polluted shell**, not the sandbox.

The 51-link attempt aborted as before (`-1/51 links, 0 checks`, "harness never answered GET /api/health on
:4000 within 90s"). Because `startHarness()` spawns with **`stdio: 'ignore'`**, seven earlier attempts could not
show *why*. `scratch/harness_boot_probe.js` repeated the identical spawn with the child's streams piped to files
and polled health plus the real `:4000` listener every second:

```
before spawn: :4000 listeners = none
spawned child pid=28240
t+14s  listeners=pid=28240            <-- the backend DID bind :4000, in ~14s
t+17s .. t+127s  health=timeout        <-- it never became ready
child stdout: "Supabase PostgreSQL Client initialized successfully with URL: http://127.0.0.1:54331"
child stderr: "Supabase connection health check not connected: TypeError: fetch failed"
              "[health] database detail: TypeError: fetch failed"   (repeats the whole window)
result: NEVER ANSWERED within 130s ; after kill :4000 listeners = none
```

**Cause:** the harness was booted with `SUPABASE_URL = http://127.0.0.1:54331` - the **chain_scratch proxy**,
which no longer exists (the F-2 proof tore it down). Every request the backend makes fails, `/api/health`
correctly reports not-ready, and the runner's deadline expires. Not a slow boot, not a bind failure, not a
sandbox restriction.

**Why that URL was in the environment:** an earlier Phase 11 proof attempt loaded `.chain-scratch/link.env` into
the shell via `Set-Item env:…`. This tool **reuses the same PowerShell session**, so `SUPABASE_URL` and the
`search_path=chain_scratch` `DATABASE_URL` remained in that shell and were inherited by every later command -
including the chain runs. The isolation experiment leaked into the environment of the very thing that is supposed
to test the un-isolated baseline. The runner behaved correctly throughout: it refuses to call a link green
against a backend that reports its database unreachable (fail closed) and it reaped its own child
(`teardown: pid … reaped, :4000 free`).

**Consequences stated plainly:**
- that 51-link attempt was **invalid** (every link would have run against a dead proxy), so **Checkpoint #53 is
  NOT established** and none of its numbers are counted; #52 (50 links, 48/50 clean, 2,112 checks) remains
  authoritative;
- no link failed and no regression was discovered; the failure class is **harness/environment**, specifically my
  own shell hygiene;
- the F-2 isolated proof stands unaffected: `isolated_proof.js` passes `link.env` values to the child explicitly,
  asserts `SUPABASE_URL` ends at `:54331`, and snapshots/guards `public` separately - and that run's backend
  reported `dataSource: postgres`, i.e. a live store, not the dead proxy.

**Follow-ups worth doing; none applied (each changes runner behaviour, so proposed rather than slipped in):**
1. clear `SUPABASE_URL`/`DATABASE_URL` before any chain run, or launch it with a scrubbed environment;
2. a small self-guard in `startHarness()`: refuse to boot when the inherited `SUPABASE_URL` points at the scratch
   proxy (`:54331`) or `DATABASE_URL` carries `search_path=chain_scratch` - the same fail-closed spirit as the
   existing "port already bound" guard;
3. send the harness child's output to a log file instead of `stdio: 'ignore'`, which is precisely what made this
   invisible across seven attempts.

---

## 2026-10-02 — Chain run #4-after-fix: 51/51 executed. **Checkpoint #53 is NOT established** - link 51 is a new failure.

### Environment hygiene fixed first, and it worked
`SUPABASE_URL` and `DATABASE_URL` are now removed **in the same process that launches the runner** (an earlier
attempt cleared them in one shell and launched from another, where they were still set - which is exactly how
the leak survived seven failures). The runner also gained a defensive guard: `startHarness()` refuses to boot
when the inherited `SUPABASE_URL` contains `:54331` or `DATABASE_URL` contains `search_path=chain_scratch`, and
names the contamination in the error. That guard was exercised for real by the run it caught. Harness boot
output now goes to `backend/scratch/harness-boot.log` (masked) instead of `stdio: 'ignore'`, and is printed when
readiness fails; the 90 s deadline and all readiness semantics are unchanged. `backend/.env` was verified
clean - it contains no `chain_scratch`/`:54331` value, so the leak was purely process environment.

**Result of the fix, measured:** `harness ready on :4000 after 11759ms` - the first link-executing chain run from
this shell since the leak started.

### Observed outcome (`node scripts/test_chain.js`, run once)
| item | observed |
|---|---|
| Registered links | **51** (51 distinct files, no duplicates; 4 isolated: 48, 49, 50, 51) |
| Executed | **51 / 51** |
| Clean | **48 / 51** |
| Failed | **3** |
| Skipped lines | **0** |
| Explicit passing checks | **2,126** |
| Exit code | **1** |

Failing links: **[24] `financial_authority_test.js`** (EXIT 1, 0 failure marks, 13s), **[25]**
**`driver_earnings_identity_audit_test.js`** (EXIT 1, 0 failure marks, 6s), and **[51]**
**`ad_click_rate_limit_test.js`** (EXIT 1, **2 failure marks, 0s**). The chain also reported
`CONTAMINATION: 1 protected public table(s) changed during an isolated run - isolation FAILED`. Isolated links
48/49/50 ran; link 50 reported `exit 0, 24 passed`. Two links additionally logged
`(reaped stranded backend on :4141)` - the private-port reaper doing its job.

### Classification so far - and why no checkpoint was created
* 24 and 25 are the hosts of the pre-existing failures already carried by #52; their behaviour was not touched.
* **[51] is a NEW failure and it is mine, not a product regression.** It failed in **0 seconds**, which means it
  never booted a backend: the runner supplies `NABIN_TEST_BASE_URL` pointing at the **shared :4000 harness**, so
  the suite skipped spawning its own isolated child and sent its clicks to the **public** backend, while
  `NABIN_F2_REQUIRE_LIVE=1` made its SQL durability reads go to **`chain_scratch`** through the injected
  `DATABASE_URL`. Public writes vs clone reads cannot agree, hence two failed marks, and it is also the likely
  source of the contamination line. Phases 4/5 avoid this because they always bind their own private port; my
  F-2 suite only does so when `NABIN_TEST_BASE_URL` is absent.
* Per instruction 6, the chain was **not** re-run to chase green. The fix is a test-harness alignment (make the
  F-2 suite bind its own isolated backend like the other isolated links), not a product change, and it needs its
  own evidence.
* **Total not reconciled yet:** observed 2,126 vs the arithmetic baseline 2,131 (= #52's 2,112 + link 51's 19).
  The -5 gap means at least one other link reported fewer checks than in #52, which must be attributed per link
  before any checkpoint is written.

**Checkpoint #52 (50 links, 2,112 checks) remains the authoritative baseline. #53 is not established.**

---

## 2026-10-02 — Link 51 isolation defect fixed and re-proven. One residual shutdown-latency finding. Still no #53.

### The evidenced fix (test-harness only)
`ad_click_rate_limit_test.js` now follows the same isolation contract as the proven links 48/49/50: when the
runner allocates a private port it **always starts and drives its own backend**, so the process carries the
injected `chain_scratch` `SUPABASE_URL`/`DATABASE_URL`:
`const PRIVATE_PORT = NABIN_RESTART_PORT || NABIN_TEST_PORT || ''` and
`ownsServer = !NABIN_TEST_BASE_URL || !!PRIVATE_PORT`. Before this, `NABIN_TEST_BASE_URL` (which the runner
points at the shared `:4000` public harness) took priority, so the in-chain run wrote clicks to `public` while
reading durability from `chain_scratch` - the exact cause of its 0-second failure and of the contamination
line. No other behaviour changed: threshold, key, 429 body, 404 refund, AD-07 and the endpoint contract are
untouched, and standalone `node ad_click_rate_limit_test.js` still behaves as before on port 4161.

### Re-proved in isolation (`node scratch/isolated_proof.js ad_click_rate_limit_test.js 4161 NABIN_F2_REQUIRE_LIVE=1`)
All gates passed: provision -> status (schema/PostgREST/proxy) -> link-env -> `SUPABASE_URL` ends at `:54331` ->
`DATABASE_URL` carries `search_path=chain_scratch` -> snapshot (10 protected tables) -> suite -> guard.
* **F2-L00 ✅** live Postgres (`dataSource: 'postgres'`, `persisted: true`) - fixture mode refused;
* **F2-L01 ✅** row `N -> N+1`; **F2-L02 ✅** exactly `N+1, N+2, N+3`; **F2-L03 ✅** the 4th and 5th clicks left
  the row at `N+3`; **F2-L04 ✅** bucket still throttled in-window;
* 4th click **429** `AD_CLICK_RATE_LIMITED` with `limit=3`, `windowMs=600000`, positive `retryAfterMs` and no
  `clicks` field; campaign B independently clickable (200); three unknown ids 404 with B's row unmoved and the
  next legitimate B click still permitted at exactly **+1**; `audit_logs`/`driver_payouts`/`ledger_entries` SQL
  `COUNT(*)` identical before and after;
* **suite exit 0, `PASS: 19 passed, 0 failed`**; **`CLEAN: 10 protected public tables unchanged`**; teardown
  exit 0; schema absent; `:54331`, `:54332`, `4161`, `:4000` free; `link.env`/`snapshot.json`/state markers gone.

### The hygiene deadline change, and what it revealed
The stray check now classifies three ways instead of guessing: **clean** (gone before the first sample),
**slow-but-terminating** (exited within the 40 s window, with the elapsed time printed), and **LEAKED**
(still present at the deadline, with PIDs listed). This run reported `LEAKED after 40583ms (remaining=1)` -
but a later check found **zero** `src/server.js` processes and **no listener on 4161 or 4000**, so the real
conclusion is that the suite's `backend.kill()` leaves the child alive for **tens of seconds** rather than
instantly. That is not a permanent leak and nothing held a port, but it is *not* clean either: the fix is to
await the child's `exit` event in the suite's teardown rather than firing `kill()` and exiting immediately.
Not applied in this pass because the suite's shutdown path deserves its own verification, and the chain
already carries `releasePrivatePort` as a reaper for exactly this class of leftover.

**Remaining before #53:** (a) confirm the exact failing check IDs in links 24/25 from their own logs rather
than assuming FIN15B-20/IDENT-09/IDENT-10 from filenames; (b) attribute the subtotal movement - links 1-50 in
the last run sum to **2,126** against **#52's 2,112**, i.e. **+14** to explain (link 51 contributed 0 in that
run), so 2,131 was never a sound expectation; (c) then one 51-link run. No chain was run in this pass.

---

## 2026-10-02 — Reconciliation pass: links 24/25 exact IDs read from their logs (24 carries THREE failures, not one). Teardown awaited; one verdict conflict open. **No chain run, no #53.**

### Link 24 - `financial_authority_test.js` (read from `.chain-logs/financial_authority_test.log`)
Failing IDs, verbatim: **`FIN15B-14a`**, **`FIN15B-14b`**, **`FIN15B-20`**, plus **`SKIPPED FIN15B-22`**.
Own summary: `Phase 15B totals: 27 passed, 3 failed, 1 skipped`.
Observed: `FIN15B-14a` "no transaction posts detail lines that fail to sum to its own header (ratchet,
currently 11) - 26 headers disagree with their lines"; `FIN15B-14b` "transactions posted with no detail lines do
not increase (ratchet) - posted transactions with zero journal_lines = 1"; `FIN15B-20` "the driver-money stores
disagree with each other by an order of magnitude - wallets ₹502,164.00 vs jobs ₹181,066.00 vs journal …".
**This corrects the standing assumption.** "Only FIN15B-20" was wrong: two additional **ratchet** checks
(`14a`, `14b`) are failing, and both are explicitly written to fail when the offending row count grows. Nothing
was patched - these are the same data-integrity measurements, and the two new failures need their own triage
before they can be labelled "known".

### Link 25 - `driver_earnings_identity_audit_test.js`
Failing IDs: **`IDENT-09`** ("no job has more than one earnings transaction … 1555 distinct job references carry
an earnings leg") and **`IDENT-10`** ("completed jobs are covered by an attributable earnings leg - 1552/1714").
Own summary: `Phase 18 identity audit totals: 13 passed, 2 failed, 1 not measured`. This one **does** match the
previously recorded pair exactly.

### The +14 subtotal delta cannot be attributed yet - and the reason is a documentation gap, not a mystery
The last run's per-link table (links 1-50 summing to 2,126, link 51 contributing 0) exists only in
`backend/scratch/chain51c.txt`. **#52's per-link subtotals were never recorded anywhere in the repository** -
checkpoints logged only totals - so there is no baseline table to diff against. Evidence about the *kind* of
difference is available: several suites report a count that iterates real rows (`test_suite` 446,
`admin_authorization` 114, `geo_adversarial` 62, `cash_ride_audit` 44, and the `FIN15B`/`IDENT` families print
numbers like "26 headers", "1555 job references"), so their subtotals move with the data, which is exactly what
F-3 exists to control. Fix going forward: record the per-link subtotal table with each checkpoint, so a future
delta is attributable instead of inferred. No counter was touched and no test was edited to restore 2,112.

### Link 51 teardown: awaited now, with a three-way verdict - and one unresolved conflict
The suite's `finally` kills the child and then **awaits its real `exit`/`close` event against a bounded 25 s
deadline**; a genuine leak increments the failure count and flips the exit status (`process.exit(failed > 0 ||
cleanupFailures > 0 ? 1 : 0)`), so cleanup failure is no longer cosmetic. Re-run result:
**suite exit 0, `PASS: 19 passed, 0 failed`, guard `CLEAN: 10 protected public tables unchanged`** - meaning the
suite's own exit event arrived inside 25 s. Yet the independent driver still reports
`backend shutdown verdict = LEAKED after 40935ms (remaining=1)`, and a later check finds zero such processes with
`:4161` and `:4000` unbound. So the two observers disagree about the same interval: the child's `exit` event
fires while the OS process (or a second `src/server.js` instance) is still visible to `Get-CimInstance` for up
to ~40 s. **Not resolved, and deliberately not called clean.** No product code, runner lifecycle,
`releasePrivatePort`, threshold, key, 429 body, AD-07 or endpoint contract was changed for this.

### Chain status
Items 1-3 of the pre-chain gate are **not** all closed (teardown verdict conflict open; +14 unattributable
without a #52 table; link 24's `14a`/`14b` need triage), so **the 51-link chain was not run** and
**Checkpoint #53 does not exist**. #52 (50 links, 48/50 clean, 2,112 checks) remains the authoritative
baseline; 2,131 remains an arithmetic hypothesis only.

---

## 2026-10-02 — FIN15B measurement-scope correction VALIDATED. Suite: 29 passed / 1 failed / 1 skipped, exit 1 (FIN15B-20 only). Gate 2 still open.

**Root cause (accepted, not re-investigated):** the 26 rows that breached the `FIN15B-14a`/`14b` ratchets are
Phase 9 append-only probe residue, signature **`reference_id='phase9_probe'` AND
`description='Phase 9 append-only probe'`** - 13 zero-leg plus 13 one-leg headers. Nothing was deleted or
mutated; no threshold changed.

**Correction:** both measured populations in `financial_authority_test.js` now exclude that exact recorded pair
(`WHERE NOT (…)` before `GROUP BY` for the derived query; `AND NOT (…)` for the zero-leg query). Never matched on
`transaction_id` prefix, amount, date, category or inferred shape. Thresholds stay literally `<= 11`; all other
journal-balance assertions untouched.

**Three regression-harness defects, each fixed from evidence:**
1. Injecting the exclusion as `AND NOT (…)` into the derived query put it inside the **`LEFT JOIN … ON`** clause,
   which filters nothing - the harness then showed `derived=26` and looked like the product fix had failed. Using
   a real `WHERE NOT (…)` (as the suite does) yields `derived=0, lineless=0`.
2. Count expectations assumed a zero-leg header sits in only one population; it is in **both** (sums 0 differ from
   the header total). All count checks are now **deltas around a single insert**, plus a printed population
   diagnostic that explained the earlier off-by-one exactly (`real-0leg`, `real-1leg`, `half`).
3. `F15S-07`'s verdict contradicted its own printed evidence because **`COUNT(*)` returns a bigint-backed string
   from `pg`** (`"0" === 0` is false). Coerced with `Number(...)`.

**Regression result:** `node fin15b_probe_scope_regression.js` -> **PASS: 0 failure(s), exit 0**. Proves probe
rows excluded (01/02), the same rows detected once the exclusion is lifted (03 - scope is the only difference),
genuine zero-leg still counted by 14b and visible to 14a (04/04b), a further genuine bad header still moves 14a
(05), `reference_id` alone is not enough to exclude (06), rollback left no fixture rows and restored the baseline
(07), both ratchets pass on current data (08). Fixtures live inside one transaction that is always rolled back -
no rows committed, deleted or mutated.
**Coverage gap found and not hidden:** the fixture meant to be a *one-leg unbalanced* header (`real-1leg`) ended
up with zero legs, so F15S-05 currently re-proves the zero-leg case; the positive single-leg detection test needs
its `journal_lines` insert to actually attach.

**Actual suite run, exit captured without a pipeline:**
`node financial_authority_test.js *> scratch/fin_suite.txt` -> **SUITE_EXIT=1**,
`Phase 15B totals: 29 passed, 1 failed, 1 skipped` (`FINANCIAL_AUTHORITY_TEST_SUMMARY passed=29 failed=1
skipped=1`). Sole failure **FIN15B-20** (driver-money stores disagree by an order of magnitude, wallets ≈₹508k vs
jobs ≈₹181k); sole skip **FIN15B-22**. 14a and 14b pass, so link 24 is back to the historically known failure set.

> **FIN15B measurement-scope correction validated; overall FIN15B suite still has the known FIN15B-20 failure.**
> Gate 1 is closed for its scope purpose only - FIN15B is *not* green, and FIN15B-20 was neither skipped nor
> "fixed" here (it is a separate pre-existing financial-integrity finding).

Evidence retained: `scratch/fin15b_writer_trace.{js,txt}`, `scratch/fin15b_14_triage.js`,
`scratch/fin15b_triage.txt`, `scratch/scope_reg.txt`, `scratch/fin_suite.txt`,
`backend/fin15b_probe_scope_regression.js`, `scratch/CHAIN_CHECK_BASELINE.md`, `docs/REPOSITORY_CLEANUP.md`.

**Gate 2 - F-2 process identity - remains OPEN:** the PID/PPID/executable/command-line/creation-time/spawn,exit,
close timestamps/pre-and-post listening-port probe was not run in this pass, so there is still **no**
CLEAN / SLOW-BUT-TERMINATING / LEAKED verdict. **Gate 3 not run: no 51-link chain, and Checkpoint #53 is not
established.** No production change, no migration change, no threshold change, no assertion weakened, nothing
deleted, no commit, push or deploy.

---

## 2026-10-02 — Checkpoint #53 (real 51-link run). F-2 teardown probe = CLEAN. One NEW failure family discovered in link 1.

### Gate work that made this run legitimate
- **FIN15B fixture fixed honestly:** `journal_lines` are now inserted explicitly with `journal_id` and counted
  back, so the `real-1leg` fixture genuinely carries one leg (`F15S-05a legs=1`). Root cause of the earlier
  silent failure: the generic helper emitted only NOT-NULL columns and dropped `journal_id`, creating an orphan
  line. Regression `node fin15b_probe_scope_regression.js` -> **PASS: 0 failure(s), exit 0**, still inside one
  always-rolled-back transaction (no rows committed/deleted/mutated).
- **F-2 process identity probe** (`scratch/f2_process_identity_probe.js`) captured the exact child: pid 16872,
  ppid 27460 (the probe), exe `C:\Program Files\nodejs\node.exe`, created 2026-10-02T22:48:50+05:30,
  spawn->ready **26 294 ms**, `kill()` returned true, node `exit` and `close` events at **13 ms**, **OS process
  gone at 1 793 ms**, listeners `[4162]` before kill and port **free** after, `other src/server pids = none`.
  **Classification: CLEAN.** Therefore the isolated driver's earlier `LEAKED after 40.9 s` was **not this child**
  - it was an unidentified process counted by a bare `match 'src.server'` tally. The driver now prints pid/ppid/
  creation/command line for any leak verdict so identity, not elapsed time, decides (`strayDetail()`), with an
  explicit note that a LEAKED tally must be shown to be the suite's own child.

### Checkpoint #53 - real full-chain run (`node scripts/test_chain.js`, env scrubbed in the same process)

| Metric | Observed value |
|---|---|
| Registered links | **51** |
| Links executed | **51** (the run completed: per-link lines 1-51 all present, ending `teardown: pid 31152 reaped, :4000 free`) |
| Clean links | **48** |
| Problem links | **3** |
| Skipped lines | **0** |
| Explicit passing checks | **2,127** |
| Harness boot | `harness ready on :4000 after 9719ms` |
| Exit code | **not captured** - the polling call timed out before the runner's `CHAIN_EXIT` line was read; the file ends with `=== CHAIN RESULT: 48/51 links clean, 3 problem(s) ===`. Reported as unobserved rather than assumed to be 1. |

**Isolated links - all four green with the hard public guard:**

| link | suite | result | guard |
|---|---|---|---|
| 48 | `test_phase5_payments.js` | exit 0, **62 passed**, 34 s (reaped stranded backend on :4141) | **CLEAN (hard guard enforced)** |
| 49 | `test_phase4_orders.js` | exit 0, **66 passed**, 27 s (reaped stranded backend on :4141) | **CLEAN (hard guard enforced)** |
| 50 | `test_phase11_feature_control.js` | exit 0, **24 passed**, 17 s | **CLEAN (hard guard enforced)** |
| 51 | `ad_click_rate_limit_test.js` (F-2) | exit 0, **14 passed**, 9 s | **CLEAN (hard guard enforced)** |

**Link 51 note:** the runner counted **14** in-chain while the standalone proof reports **19** - a counting/parsing
difference for this suite's output shape, not a lost assertion (exit 0, zero failures, guard CLEAN). Flagged, not
reconciled by editing either side.

### Failing links
- **[24] `financial_authority_test.js`** - `FINANCIAL_AUTHORITY_TEST_SUMMARY passed=29 failed=1 skipped=1`;
  failure is **FIN15B-20** only. `14a`/`14b` pass with the validated scope correction, so this link is back to its
  known single failure.
- **[25] `driver_earnings_identity_audit_test.js`** - `passed=13 failed=2 skipped=1`; failures are **IDENT-09** and
  **IDENT-10**, as known.
- **[1] `test_suite.js` - NEW failure family, not previously present:** `EXIT 1, 3 failure mark(s)` at 82 s -
  **`NOTIF-API-14`** ("Authorized admin broadcast succeeds"), **`NOTIF-API-15`** ("Broadcast creates the expected
  immutable audit record in PostgreSQL"), **`NOTIF-API-16`** ("Administrative broadcast rate limit (1 per 15 mins)
  is strictly enforced with 429"). `NOTIF-API-13` passed. **Root cause NOT determined** - the captured detail
  strings were empty after the arrow, so triage needs the request/response bodies. Not classified as expected,
  not skipped, and not fixed by touching anything. Note the earlier chain run happened the same day, so state
  carried by the broadcast limiter or its audit trail is one hypothesis among several and is unproven.

### Public drift attribution (working as designed)
Per-link drift printed for non-isolated links (e.g. link 1 `audit_logs +112`, `ledger_entries +6`,
`journal_lines +34`, `journal_transactions +17`, `jobs +9`, `driver_payouts +2`; links 45/46 `audit_logs +2` each),
`CLEAN (10 protected tables unchanged)` on the read-only links, and `CLEAN (hard guard enforced)` on all four
isolated links. This is the first run where the attribution and the isolated guards can be read side by side.

### Baseline consequence
**#53 is the new authoritative full-chain checkpoint: 51 links, 48 clean, 2,127 checks, 0 skipped.** The known
failure set is now **FIN15B-20, IDENT-09, IDENT-10, plus NOTIF-API-14/15/16 (new, untriaged)**. 2,131 remains an
abandoned arithmetic guess; every number above is copied from the run log at `backend/scratch/chain53.txt`.














---

## 2026-10-01 - TASK F3: chain registration of the unregistered phase suites

**STATUS: measured; one link registered; six documented as blocked. No product code touched.**

F3's own claim of "six suites" was corrected to **seven**. Every unregistered phase suite was run
**standalone** with a real exit code, `:4000` confirmed free before each run and cleared after
(several own and respawn that port).

### Measured results (fresh, this session)

| suite | standalone | owns :4000? | self-cleaning? | registered? |
|---|---|---|---|---|
| `test_phase4_orders.js` | **EXIT 1** - 61 checks green, then Fatal `ECONNREFUSED` at its own cold restart | yes | no | no |
| `test_phase5_payments.js` | **EXIT 0** - 62 passed | yes | no (writes money) | no |
| `test_phase6_dispatch.js` | **EXIT 0** - 62 passed | yes | no (writes dispatch) | no |
| `test_phase8_security.js` | **EXIT 0** - 28 passed | **no (DB-only)** | **yes** (after fix) | **YES - link 47** |
| `test_phase9_financial_security.js` | **EXIT 1** - 37 passed, 1 failed | no (DB-only) | no | no |
| `test_phase10_security.js` | **EXIT 0** - 2 passed (near-empty) | yes | n/a | no |
| `test_phase11_feature_control.js` | **EXIT 0** - 24 checks | yes | no (creates an admin user, toggles flags) | no |

Blocker classes, precisely:
- **Own/kill :4000** (4, 5, 6, 10, 11): each `ensureServerRunning()` `Stop-Process`es the port owner
  and spawns its own `src/server.js`, and 4/5/6/11 kill+respawn midway to "prove cold restart". As a
  plain link that would kill the shared harness every later link rides on - the exact contamination
  F3 warned about. They need the D1 convention (read `NABIN_TEST_BASE`, never own the port) or a
  `privatePort` allocation they honour.
- **Red (4, 9)** - neither is a product defect: 4's restart waits a fixed `sleep(3500)` but this
  backend takes 7-21 s to boot; 9 carries a **stale source-regex** requiring
  `app.post('/api/admin/finance/adjustments'` followed within 700 chars by another `app.post(` - the
  route and its `await db.processFinancialAdjustment(` are still present (`server.js:2131/2138`),
  only the window moved.
- **Not self-cleaning** (5, 6, 8, 9, 11) - writes that survive the run.

### What was done
`test_phase8_security.js` was the one suite simultaneously **green and harness-safe** (pure `pg`, no
HTTP, no port). It was not self-cleaning: its three `audit_logs` probes `INSERT` and the append-only
trigger refuses `DELETE` for every role, so each run left a permanent `action='TEST_INSERT'` row (10
already present). Fixed **without weakening a single assertion** - each probe now inserts inside its
own transaction and `ROLLBACK`s in a `finally`, proving the same contract (INSERT permitted; UPDATE
and DELETE refused) while leaving the durable table untouched. Verified **28/0, exit 0**, and the
`phase8-test` row count is **10 before and 10 after** both a standalone run and the full chain.
Registered as **link 47**.

### Why the other six were not registered
Adding any of them would either kill the shared harness (4, 5, 6, 10, 11), add a red link (4, 9), or
grow a durable append-only table every run (5, 6, 9, 11). Observed cost of that last class:
`ledger_entries` already holds **12** `reference_id='phase9_append_only_probe'` rows left by prior
phase9 runs. Registering them is a source change (port + per-probe rollback), not a chain edit -
**the F3 premise that these are one-line additions is false**, which is itself the finding.

### CHECKPOINT #49 (`backend/scratch/f3_chain49.log`)
- links registered and executed: **47/47**; harness ready normally; teardown left `:4000` free
- **CHAIN RESULT: 45/47 links clean, 2 problem(s)**
- **1,960 explicit passing checks**, **0 skipped**, **process exit code 1**
- `[46/47] food_discovery_ordering_contract_test.js ... exit 0, 21 passed`
- `[47/47] test_phase8_security.js ... exit 0, 28 passed` - F3's one addition, green
- failing links remain only `[24/47]` FIN15B-20 and `[25/47]` IDENT-09/IDENT-10, both untouched
- **No new failure. The chain is not green and is not claimed to be.** Supersedes #48.

**Files changed:** `backend/test_phase8_security.js` (probes made transactional + self-cleaning),
`backend/scripts/test_chain.js` (one link + comment), this log. No product code, no commit, no push,
no deploy. Local Docker store only.

---

## 2026-10-01 — D1: disposable `chain_scratch` schema (owner's option 1, built and proved)

**STATUS: built, verified by measurement, reversible. Source schema never written. No product code
touched. `test_chain.js` deliberately NOT yet wired to it (see limits).**

### Why (the F3 follow-up blocker)
The write-heavy phase suites (4/5/6/9/11) append rows the append-only triggers refuse to delete, so
registering them would grow the very money data **FIN15B-20 / IDENT-09 / IDENT-10** measure. Owner
chose a disposable DB/schema over recalibrating those baselines.

### Architecture facts that decided the design (all measured, not assumed)
- The backend reaches the DB **only** through `supabaseAdmin` -> PostgREST (**150** usages, **0**
  direct `pg`/`Pool` in `src/`), pinned behind Kong at `SUPABASE_URL=http://127.0.0.1:54321`.
- Supabase-js builds `${SUPABASE_URL}/rest/v1/<t>` and **hardcodes `Accept-Profile: public`**.
- **67** RLS policies call `auth.uid()` -> a clone **must stay in the same database**, so D1 is a
  *schema*, not a database (a separate DB loses `auth`). Owner picked D1 for this reason.
- DB is 996 MB; `public` is 979 MB of it, of which `dispatch_offers` is **803 MB / 1.67M rows** and
  `audit_logs` 104 MB / 165k rows. Everything else is KB. The two bulk tables are left empty in the
  clone - suites create their own rows.

### What was built
- `backend/scripts/chain_scratch.js` — `provision | teardown | status`. Clones `public` ->
  `chain_scratch` (dump, rename, apply, replicate the schema ACL, copy data, advance sequences),
  starts a throwaway PostgREST + the proxy, records its own state. Refuses `NODE_ENV=production`.
- `backend/scripts/chain_scratch_proxy.js` — strips `/rest/v1` (what Kong does) and rewrites
  `Accept-Profile`/`Content-Profile` to the clone (what Kong would otherwise do), so **the backend
  needs no change** and still believes it is `public`.
- `.gitignore`: added `backend/.chain-scratch/` (state only).

### Clone fidelity (measured)
`tables/policies/triggers/sequences/functions = 58/98/30/1/35` — **identical to `public`**. Data copy
compared row-for-row across all 56 non-bulk tables: **0 mismatches** (`users` 231, `merchants` 39,
`products` 26, `orders` 2730, `ledger_entries` 2272). Schema ACL replicated role-for-role.

### The proof (end-to-end, not asserted)
| check | result |
|---|---|
| provision | clone `58/98/30`, `231/2730/2272` = source; PostgREST **loaded 58 relations** |
| backend through proxy | health **ONLINE in 6.6 s**, `/api/restaurants` `dataSource=postgres count=27`, **0 boot errors**, `4000` owner == spawned pid |
| **write isolation** | `phase5` **62 PASSED / 0 FAILED / exit 0**; **`public` 2730/1603/299/2272 unchanged before AND after**; `chain_scratch` -> **2731/1608/311/2277** |
| teardown | proxy stopped, container removed, schema dropped, **0 stray ports**; `public` still 231/2730/2272 |

So a write-heavy suite can run green while adding **zero** durable rows to the source.

### Three bugs that were mine, recorded not hidden
1. PowerShell `>` wrote `pg_dump` output as **UTF-16LE**, so the rename transform matched 0 times;
   re-dumped byte-exact via `cmd` redirection.
2. A leaked `PORT=4105` from my own earlier test made phase5's spawned backend bind 4105 while phase5
   probed 4000 -> `ECONNREFUSED`, which initially read as a suite bug. It was **my** env. Cleared ->
   62/0.
3. A leftover manual proxy held `:54331`, so provision's proxy died `EADDRINUSE` while provision
   still reported success; `provision` now **verifies the proxy survives ~3 s** and fails loudly.
Also fixed in-build: `42501 permission denied for schema` (pg_dump omits `public`'s own schema ACL)
and `PGRST106 Invalid schema: public` (the profile-header rewrite).

### Limits, stated because they are the point
- **`test_chain.js` is NOT wired to this.** Registered links such as `financial_authority_test`,
  `driver_earnings_identity_audit_test` and the geo suites read **`public.` catalogs directly**; they
  would read the source while the backend wrote the clone. Isolation must be scoped to specific
  write-heavy links, not blanket-applied to the chain.
- **phase6 (9 `public.` refs) and phase9 (44) are not redirected by `search_path`** — they qualify
  tables explicitly. They need the prefix removed (a suite edit) or D2 (a separate DB).
- **phase4/phase5 use unqualified table names (0 `public.` refs)**, so the `search_path` redirect
  works for them — which is what phase5's proof above relied on.
- **Registering phase5/6 still needs the `:4000` private-port port** (they spawn *and* kill `:4000`);
  that work is separate and not started.
- Copy excludes `dispatch_offers` and `audit_logs`; the clone starts with those empty.

**Files:** `backend/scripts/chain_scratch.js`, `backend/scripts/chain_scratch_proxy.js` (both new),
`.gitignore`. No product code, no `test_chain.js` edit, no commit, no push, no deploy. Local Docker
store only; the source `public` schema was read and never written.

---

## 2026-10-06 — the reap rule now has one implementation, and the Driver KYC form stopped lying

### Harness leak closed across every suite that spawned a detached backend

`admin_identity_gates_test.js` used to leave an orphan backend bound to `:4000`, and the next
chain run refused to start. The fix generalised rather than patched: `scripts/spawned_server.js`
registers the reap on `process.exit` at require time (so all seven of that suite's scattered
`process.exit(1)` aborts are covered), and every suite that spawns `src/server.js` detached now
`require`s it and wraps its spawn in `trackServer(…)` — 13 suites, 16 spawn sites.

The five unguarded kill-by-port-owner sites in `test_phase4_orders.js`, `test_phase5_payments.js`,
`test_phase6_dispatch.js`, `test_phase7_security.js` and `test_phase10_security.js`, plus
`test_phase11_feature_control.js`'s `netstat` sweep, now go through the repo's existing
`scripts/port_release.js#releasePrivatePort`, which kills only a listener whose command line is
unmistakably a NABIN `src/server.js` and prints `skipped:foreign` — loudly, leaving it running —
for anything else. `admin_identity_gates_test.js`'s 39-line inline reaper was deleted so the rule
lives in one place. The rule and its two residuals are written up in
`docs/testing/TESTING_STRATEGY.md` §3.

Measured, after the change:

| Run | Result | Port left |
|---|---|---|
| `admin_identity_gates_test.js` | 68/68, `teardown: backend pid 52736 … reaped` | free |
| `admin_customers_test.js` | 83/83, reaped | free |
| `admin_settings_surface_test.js` | 31/31, reaped | free |
| `admin_authorization_test.js` | 114/114 (kills its own child — predates the module) | free |
| `operator_permissions_migration_test.js` | 65 passed, 0 failed, 0 skipped | free |
| `smoke_test.js` | 5 passed, reaped | free |
| `test_phase6_dispatch.js` | 62 passed, 0 failed, reaped | free |
| `test_phase10_security.js` | 2 passed | free |
| `bootstrap_test.js` | 8 passed, 1 failed — the documented `VALID ADMIN BOOTSTRAP` red, not a new one | free |
| `scripts/test_chain.js` | **54/54 links clean, 0 problems, 2253 passing checks, 2 skipped**, `teardown: pid 46048 reaped, :4000 free` | free |

That chain line matches the pre-change baseline exactly — no drift in the check count, and the
same two skips (`IDENT-08`, `GAP-TRK-01`). Zero `skipped:foreign` warnings appeared anywhere, so
no suite met a foreign port owner during the run.

### Driver KYC intake form (#149)

`driver_kyc_registration_screen.dart` opened pre-filled with one invented applicant — a Delhi
driving licence, a Delhi registration plate, a UPI handle, and a settlement bank with an IFSC —
in a NABIN build that operates in Aizawl. It captioned an untouched photo circle
`Profile Photo (Verified)`, reported `Valid until Nov 2027` and `Verified by RTO` for documents
no one had read, and answered a button press with a green `KYC Document Review Complete` board of
four `APPROVED` chips and a jump into the driver console.

There is no driver-facing KYC route to submit to: `drivers` is written by the admin fleet routes,
and `drivers.kyc_status` — the column deciding whether a partner may drive — is only ever changed
by an administrator. So the form now opens empty, gates each step on what it actually asks for
(the vehicle category has no default), states plainly that document photos cannot be attached and
that no bank account is linked, and its send button says **nothing was sent** instead of producing
an approval that did not happen. Field length limits come from the real columns (`name` 100,
`license_number` 50, `vehicle_number` 30) and the three vehicle ids are three of the five values
`drivers.vehicle_type` accepts.

`mobile/test/driver_kyc_registration_screen_test.dart` — **14/14 passing** — holds it: every field
empty, no pre-selected vehicle, all nine invented values absent on all four steps, nothing ever
presented as approved, the refusal on send, and three tests that an incomplete step cannot advance.

**Not done, and it needs the owner:** whether NABIN should have a driver-side KYC intake at all.
It is a new PII collection (licence, registration, insurance, bank/UPI) and a privilege-changing
write — a `VERIFIED` status puts someone on the road — so it is an ask-first item, not a gap to
close silently. Separately found: `POST /api/driver/payout-destination/request` is a real route
that takes a `upiId`, and no NABIN app calls it anywhere.

**Files:** `backend/scripts/spawned_server.js` (new), 13 backend suites, `mobile/lib/features/auth/presentation/screens/driver_kyc_registration_screen.dart`, `mobile/test/driver_kyc_registration_screen_test.dart` (new), `docs/testing/TESTING_STRATEGY.md`. Nothing committed, pushed, or deployed. `flutter analyze lib test` reports 55 issues — the same 55 as before this change, none in either file touched here.



















### Partner-mode simulators reachable from the Customer app (#150)

The Customer app carries a Driver console and a Restaurant console so a partner journey can be
walked from one device. Both are painted from literals written into the widgets: `Rajesh Kumar`,
`+91 98765 43210`, `✓ KYC Approved • ⭐ 4.92 Rating`, `NET WEEKLY SETTLEMENT (PENDING) ₹28,450`,
`Direct Deposit to HDFC Bank **** 4892 on Monday`. Neither shell is imported by `main_driver.dart`
or the merchant entries — `grep -rn "DriverAppShell|RestaurantAppShell" lib/` returns only
`app_router.dart` — so they are Customer-app surfaces, and Customer Home and Customer Profile each
offered a one-tap route into them **in every build**, including the one a real customer installs.

They are now demo-only, on the gate the app already had:

- `app_router.dart` registers the two `GoRoute`s inside `if (NabinBuildEnv.allowsDemoConvenience)`.
  A production build does not answer `/driver-dashboard` or `/restaurant-dashboard` at all; the
  deep link lands on go_router's own "no route found" screen (`MaterialErrorScreen`, confirmed in
  `go_router-14.8.1/lib/src/builder.dart:335`), which is the truth rather than a lying simulator.
- The `Partner with NABIN` card in Home and the `Partner Ecosystem` tiles in Profile are hidden
  behind the same condition, each hidden as one unit so no build keeps an empty titled box, and
  both now say *Demo simulators of the partner apps. They show sample data, not a real partner
  account.* — a customer in a demo build is told what they are about to open.
- Both shells paint `NabinDemoSimulatorBanner` (new, `core/widgets/`) above their own tabs:
  `DEMO SIMULATOR` plus "Every name, rating, order and amount on screen is sample text written
  into this build — it is not a partner account, and nothing you do here reaches NABIN." It sits
  inside each shell's existing `SafeArea`/body so the status-bar inset is counted once.

`mobile/test/partner_mode_simulator_gate_test.dart` — **7/7 passing in both build configurations**,
because the gate is `String.fromEnvironment` and can only be proven by compiling twice:

```
flutter test test/partner_mode_simulator_gate_test.dart
flutter test --dart-define=NABIN_ENV=production test/partner_mode_simulator_gate_test.dart
```

Every assertion is written as an invariant of whichever build is running, so the same file proves
the demo build keeps both routes, both doors and the label, and the production build has neither
route (`containsAll` over the 31 real customer paths pins that nothing else rode the gate) nor
door. The label test additionally drives the Restaurant simulator at 834px onto its Earnings tab
and asserts `₹28,450` and `DEMO SIMULATOR` are on screen together — the disclaimer has to survive
tab switching, not just the first frame.

**Verified and not verified.** The Restaurant simulator is really mounted in that test. The Driver
simulator is not: its first tab is a live `flutter_map`, whose built-in tile cache asks the
`path_provider` (and then sqlite) plugin for a filesystem that a `flutter test` process does not
have; mounting it fails on the plugin, not on the screen. Its banner wiring is therefore pinned by
the structural test in the same file, and the strip's own render by the widget test above it.

**Found while sweeping, deliberately left for its own slice.** These demo shells still paint Delhi:
10 references in `driver_app_shell.dart` (Civil Lines / Connaught Place coordinates, `DL 1RA 4892`,
and a `Live GPS coordinates … are being broadcast to Delhi Police 112 and NABIN 24/7 Safety Command`
safety claim) and 1 in `restaurant_app_shell.dart`. NABIN operates in Aizawl, so even sample text
has no business naming Delhi; rewriting it is partner-app content work, not a Customer gate, so it
is recorded rather than silently done here.

Full mobile suite: **402/402** (395 before, +7). `flutter analyze lib test`: **55 issues** — the
same 55 as before this change, none of them in a file this ticket touched.



## 2026-10-06 — #147: the KYC examiner's workspace was drawing one demo applicant's card for every application

### What the screen actually did before this

#146 made `GET /docs/:filename` answer a "NO DOCUMENT ON FILE" placeholder instead of rendering a
forged Aadhaar card, which fixed what the *route* said. It did not fix what the *examiner* saw, and
the diff proves the route was never the whole lie: `admin_dashboard.html` had

```html
<img id="docViewerImage" src="/docs/mock_aadhaar_rahul.png" alt="Inspection Preview" …>   <!-- :2224 -->
```

in the markup, plus two document frames and a dead dispute modal pointing at Rahul's own
`/docs/mock_aadhaar_rahul.png` and `/docs/mock_voter_rahul.png` — six mock paths as code. So opening
`APP-9021` — a stranger's application — put Rahul's card on the zoomable
"High Resolution Inspection" viewer, and every per-applicant blank in the panel was filled
from a literal rather than left blank: `(Age 31)`, `XXXX-XXXX-4892`, `DLH***201`,
`Flat 402, Civil Lines, Delhi`. The checklist then asked the human to attest things the platform
cannot show: that the *Aadhaar photo is clear*, that the document is *unblurred*, that a
*watermark* is present. NABIN has no identity-document upload path — no bucket, no scan, no
retention, no deletion — so an examiner ticking those boxes is attesting to a file that does not
exist, in a workflow whose output is a decision about a real person.

The columns that carried the fiction are inert in the database: `aadhaar_doc_url` exists only as a
`001_central_schema.sql` column, and `grep -rn "aadhaar_doc_url" backend/src/` returns nothing. No
repository reads or writes it. The KYC applications live in the in-process array, which means the
only consumer of that URL was an examiner's browser.

### What this ticket changed

**The examiner's panel is drawn from the selected application** (`admin_dashboard.html`):

- `reviewDocuments` (:3243) holds the two documents *of the row under review*, and
  `renderDocumentPanel(key)` (:3790) paints each pane from it — badge, masked number, and either a
  real file or an honest absence. `closeIdentityReviewModal` clears it and strips the viewer's `src`
  so the next operator never sees the previous applicant's state.
- The `<img>` has no `src` in the markup (:2218). A viewer opens only for a document the record
  actually names, and `openDocumentViewer` refuses with "no document is stored for this application,
  so there is nothing to inspect" when the URL fails `^https?://` — the gate sits in the reader, not
  only in the writer.
- Every invented fallback became `Not supplied`: `NOT_SUPPLIED` / `notSuppliedText` (:3248) for the
  cells and `setText` for the plain ones, so an absent value renders as absent instead of as a
  plausible one. That is the same refusal-over-substitution rule #146 applied to the route.
- The checklist asks only for the comparisons that can genuinely be made: *declared details are
  consistent*, *Aadhaar number is usable*, *Voter ID (EPIC) number is usable*, plus an optional
  "nothing else in the record contradicts it". The APPROVE gate's own words changed with it (:3876):
  it now names the three confirmations it actually requires and no longer mentions photographs.
- The lock line stopped implying the reader is the reviewer: without your lock it says *Not held by
  you … Another reviewer may decide this application while you read it.*
- `escHtml` (:3258) is applied to the KYC row — `userName`, `phone`, `email` and the ids are
  applicant-supplied at `/api/identity/submit` and were being interpolated into `tbody.innerHTML`.
  A stored-XSS payload filed with a KYC application would have run in an authenticated admin
  session. (The same hazard exists in the support queue and is not this ticket; see #155.)

**The boundary refuses the claim** (`backend/src/server.js`): `/api/identity/submit` answers
400 `IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED` when a caller sends `aadhaarDocUrl` or `voterIdDocUrl`
(:3512), because accepting a URL the platform cannot fetch, store or retain means storing an
attacker-controlled address whose only reader is an admin's browser — IP/UA leak and a probe against
internal hosts. The writer therefore records `aadhaarDocUrl: null, voterIdDocUrl: null` (:3528), and
the success message (:3546) says *No documents were uploaded: NABIN does not accept identity
document uploads yet* instead of thanking the customer for documents they never sent.

**The seed stops narrating a review that cannot have happened** (`backend/src/database.js`):
APP-9019's `reviewNotes` (:236) now separates the two comparisons that were made — both supplied
numbers well-formed, the declared-name comparison failed — and states that no document was
submitted; APP-9018's (:266) says it was *Reviewed on the declared details only: NABIN holds no
document for this applicant*; AUD-1003's reason (:1042) and APP-9019's customer-facing
`resubmissionReason` (:238) lost the photograph too.

**The customer receipt matches the form behind it**
(`mobile/.../identity_verification_status_screen.dart:356`): the resubmit button said
`Update & Resubmit Documents` over a screen with no upload path. It is
`Update & Resubmit Your Details`.

### Measurements (all fresh, this session, against live local Postgres)

| Harness | Result | Before |
| --- | --- | --- |
| `backend/kyc_approve_checklist_test.js` | **19 PASSED, 0 FAILED, 0 SKIPPED** | 18/1 |
| `backend/admin_identity_gates_test.js` | **74/74** (`EXAM-01…06` green on the first run; `IG-END-3` confirms no orphan server) | 68/68 |
| `backend/test_phase7_security.js` | **46 PASSED, 0 FAILED** (MODULE 4 case 4: the 400 `IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED` refusal) | 45 |
| `mobile`: `flutter analyze lib test` | **55 issues** — the standing baseline, none in a file this ticket touched | 55 |
| `mobile`: `flutter test test/identity_verification_test.dart` | **14/14** | 14 |
| `mobile`: `flutter test` (full suite) | **402/402** | 402 |

The new assertions are `EXAM-01…06`: no retired literal survives as code in the dashboard
(`(Age 31)`, the Delhi address, `XXXX-XXXX-4892`, `DLH***201`, `/docs/mock`,
`High Resolution Inspection`); the viewer `<img>` carries no `src`; `openDocumentViewer` reads
`reviewDocuments` and contains the refusal; the queue builder uses `NOT_SUPPLIED` and keeps no
`|| 'XXXX` / `|| 'DLH` fallback; the checklist slice is free of the attestation words; and a live
KYC-token queue read shows no application carrying a document URL. SUB-07, which #146 wrote against
the two backend writers, was extended to sweep `../admin_dashboard.html` — and it is the assertion
that went red first, which is the point of writing it.

**A harness fact worth keeping:** `codeOnly` / `stripComments` only drop lines whose trimmed text
starts with `//`, so an HTML `<!-- -->` comment in `admin_dashboard.html` is *live source* to these
scans. Recording a retired literal inside HTML comment prose turns the suite red for documenting
itself. Two comments this session had to be reworded for exactly that reason.

### Deliberately left as tickets, not silently rewritten

- **#153** the support dispute modal still paints `/docs/toll_receipt.png` as "Verified Evidence
  Photo" over a fake "Attach Image" control, and the support seeds carry fabricated `evidenceUrls`.
- ~~**#154** the APPROVE decision still writes `overallDocumentStatus` / `aadhaarDocStatus` /
  `voterIdDocStatus = 'VERIFIED'` (`database.js:3734-3736`) when no document can exist.~~ Closed the
  same day by the #154 record below: the whole document lifecycle became one honest token.
- ~~**#155** the support queue's `${t.userName}` / `${t.userRole}` reach `tbody.innerHTML` unescaped
  (`admin_dashboard.html:4420`, `:4477`) — the same class #147 fixed for the KYC row.~~ Closed by the
  #155 record below: that row is escaped (`:4476`), and the sweep covers all 63 innerHTML sinks in
  the file instead of the two rows this list named.
- **#156** 18 Delhi references in the operator console, including `dummyTrips` (:3264) rendered at
  :6270 and duplicated at :6584.
- **#151** the owner decision on whether a driver-side KYC intake route should exist at all;
  building an upload path is new sensitive-PII storage and is an "ask first", so the absence this
  ticket documents stays an absence until that is answered.

### Documentation corrected in the same pass

`docs/CUSTOMER_SCREEN_CONTRACT_AUDIT.md` claimed the seed narration and the dashboard viewer were
still fabricating a review (with line citations into the old markup) — both bullets now describe
what shipped and name the guarding assertions, and the "there is still no upload" bullet records
that the boundary now refuses a document claim rather than merely ignoring it.
`docs/ADMIN_FEATURE_SPECIFICATION.md`'s harness catalogue row said `admin_identity_gates_test.js`
was 64 assertions; it is 74, and the row now lists the `DOC-07..09` placeholder and `EXAM-01..06`
examiner-screen groups and widens its trigger to "any edit to `admin_dashboard.html`'s examiner
panel". The dated D2 narrative and the 2026-09-23 chain snapshot keep their 64 — those were the
correct counts on the day they were measured.

## 2026-10-06 — #154: the record still certified a document nobody had filed

**The defect #147 left behind.** That ticket made the examiner's *panel* say "No document on file",
but the panel reads a record that still ran a document lifecycle. `reviewIdentityApplication` wrote
`overallDocumentStatus` / `aadhaarDocStatus` / `voterIdDocStatus` as `VERIFIED` on APPROVE, and as
`PENDING` on REJECT and REQUEST_RESUBMISSION, while the writer and the nine seed fields were `PENDING`
too. So an approved applicant's row claimed three documents had been verified — through an interface
that can only compare a declared name, a date of birth, an address, and two numbers against their
formats. And a customer who was told "resubmission required" was being asked for paperwork NABIN has
no path to receive. The approval note the platform writes when the officer types nothing said the
documents were validated.

**Checked before anything was chosen** (PROMPT 12 §1 — measure, don't assume). Nothing gates on
these fields: the only readers in `backend/src` are the two admin projections
(`server.js:3551`, `server.js:3594`), no other suite asserts their values (the sole assers were the
ones in `kyc_approve_checklist_test.js`, rewritten here), and the customer status screen only maps
them to words. The application-level `status` enum (`IDENTITY_VERIFICATION_PENDING` → `VERIFIED` /
`REJECTED` / `RESUBMISSION_REQUIRED`) is untouched — other flows read it, and it is a true statement
about the *application*, which is the thing that was actually decided.

**The change: one token, at every step.** `NO_DOCUMENT` replaces the whole document lifecycle,
because a lifecycle implies transitions this platform cannot perform.

| Place | Now |
|---|---|
| `database.js:3526-3528` (writer) | three `const … = 'NO_DOCUMENT'`, with the reason in the comment |
| `database.js:3737-3739`, `:3771-3773`, `:3803-3805` (APPROVE / REJECT / REQUEST_RESUBMISSION) | all three fields stay `NO_DOCUMENT`; only `status` moves |
| `database.js:195-261` (nine seed fields in three applications) | `NO_DOCUMENT`, matching what a live submission produces |
| `database.js:3726` (approval refusal) | "Cannot approve application without confirming that the declared details match and that both supplied identity numbers were checked." |
| `database.js:3740` (default approval note) | "The declared details and both supplied identity numbers were checked and match. No document is held for this applicant." |
| `database.js` writer signature | `aadhaarDocUrl` / `voterIdDocUrl` removed from the destructured payload, and the `prior` local with them — #147's route refuses those fields with 400 `IDENTITY_DOCUMENT_UPLOAD_UNSUPPORTED`, so a writer that still accepted them was a second, unrefused door |
| `server.js` submit call site | passes neither field |
| `identity_verification_status_screen.dart:_readableDoc` | five unreachable document branches (`SUBMITTED`, `UNDER_REVIEW`, `VERIFIED`, `RESUBMISSION_REQUIRED` → "Needs a new copy", `REJECTED`) deleted; the switch now maps `''` → `—`, `NO_DOCUMENT` → "No document on file", and shows an unknown token as it arrived |
| `admin_dashboard.html:3253` + `:3793` | new `docStatusText()` maps the token to "No document on file" — the same words the panel's own empty-state heading already used |

Red before green: `AP-02`, `AP-06`, `AP-09`, `AP-11`, `AP-13` and `SUB-02/04/05/06` were written
against `NO_DOCUMENT` and failed against the still-`PENDING`/`VERIFIED` writer before the source was
touched. `SUB-04…06` lost their old meaning (a partial upload reads as a partial upload) and were
replaced with what is now testable: a caller who hands the repository two URLs anyway records
neither, and no status in the record reads as a filed document.

| Suite / gate | Measured this run | Was |
|---|---|---|
| `backend/kyc_approve_checklist_test.js` | **20 PASSED, 0 FAILED, 0 SKIPPED** | 19/0/0 |
| `backend/admin_identity_gates_test.js` | **74/74** | 74/74 |
| `backend/test_phase7_security.js` | **46 PASSED, 0 FAILED** | 46/0 |
| `mobile/test/identity_verification_test.dart` | **14/14** | 14/14 |
| Full `flutter test` | **402/402** | 402/402 |
| `flutter analyze lib test` | **55 issues** | 55 issues (baseline) |

`AP-13` is the new one: it asserts that an approval with no officer-supplied reason notes the
comparison that was made, and never that a document passed. Its first draft forbade the word
"document" anywhere in the note, which the honest sentence legitimately contains ("No document is
held for this applicant") — the assertion is narrowed to the claim that matters: no
`documents were validated/verified/checked`.

**Left undone on purpose**

- `admin-web/src/components/DataPanel.tsx:230` `Badge` paints the raw uppercased token, so the Next.js
  admin console will show `NO_DOCUMENT`. That is the app's existing convention for *every* status
  (`ACTIVE`, `PENDING`, `UNDER_REVIEW`), and special-casing one field here would diverge from it;
  admin-web is also behind Customer closure in PROMPT 10's stage order. Recorded, not edited.
- **No upload path was built.** That is #151 and it is an "ask first" (new sensitive-PII storage,
  bucket, retention and deletion). Until it exists, `NO_DOCUMENT` is not a placeholder for a missing
  feature — it is the accurate state of the record.
- **New ticket #157**: the KYC demo rows still describe a Delhi applicant — `database.js:190` gives
  `APP-9021` the address "Flat 402, Civil Lines, North Delhi, 110054", and `usr_1`'s own address is
  the same (:79). NABIN operates in Aizawl, so seeded personal data naming Delhi is the same class
  as #156's Delhi fleet. Fixing it means rewriting demo identity rows that several suites read, so it
  goes to the queue rather than into this ticket's diff.

**Documentation corrected in the same pass.** `docs/CUSTOMER_SCREEN_CONTRACT_AUDIT.md` §3 described
the #146 derivation ("absent ⇒ `PENDING`, present ⇒ `SUBMITTED`") as current behaviour; it now states
the single token, keeps the #146/#147 history as history, and cites `AP-02/06/13` beside `SUB-01…07`.
The seed bullet's `PENDING` became `NO_DOCUMENT`, and the stale
`submitIdentityApplication (database.js:3454-3529)` citation was re-measured to `3469-3606`.

## 2026-10-06 — #155: the operator console could still be made to execute a customer's words

**The defect #147 named and deliberately left.** Its own leftovers list carries the sentence:
*the same hazard exists in the support queue and is not this ticket; see #155* — the support rows'
`${t.userName}` / `${t.userRole}` reaching `tbody.innerHTML` unescaped. #147 had escaped the KYC
row through one door; the console had sixty-three of them: `grep -o "innerHTML *=" admin_dashboard.html`
counts **63 innerHTML sinks**, **31** of which are handed a template literal on the same line.

**Checked before claiming the vector** (PROMPT 12 §1 — measure, don't assume). What the live
support queue paints is caller-controlled but not caller-forged:
`SupportTicketRepository.createTicket` stores the ticket's own `title` and `description` verbatim
(`:189-201` — trimmed, never escaped, no length named) and its first message's `senderName` comes
from the authenticated session (`:251`, `caller.name || 'User'`), which is the display name the
account holder set on their own profile. So a customer types a string into their profile, files a
ticket, and that string is interpolated into markup inside an **authenticated admin session** —
stored XSS with no admin action required beyond opening the queue. The other writer in the file,
`db.createSupportTicket(payload)` (`database.js:2641`), *does* take `userName`/`userRole` straight
from its payload, which would have made the queue's identity column forgeable; `grep -rn
createSupportTicket src/ *.js` returns no caller at all, so it is dead code, not a hole. Recorded
as dead, not defended, and not cited as a vulnerability.

**The scope choice: a rule and a scanner, not two patches.** Patching the two named rows would
leave the class in the other sixty-one sinks. So the pass is stated once — *every interpolated
value inside markup that reaches `innerHTML` must be escaped, gated by a shape check, an explicit
absence, a number, or a literal* — and enforced over the shipped file: **277 value slots across 80
markup templates**. The two doors escaping genuinely cannot close got their own guard, because
getting these wrong is invisible to a reviewer:

| Door | Why escaping is not the answer | Now |
|---|---|---|
| an inline `on*` handler's argument | the attribute parser **decodes entities before the JS runs**, so `&quot;` there is a working quote | all **18** such slots are `safeId(...)` shape checks |
| a `src` / `href` value | `javascript:` and `data:` are valid URLs no matter how well the text is escaped | the **1** such slot goes through `safeUrl` |

`XSS-04` asserts that **no door leans on `escHtml` where it is the wrong defence** — that is the
mistake this fix would most naturally have made, and it is asserted rather than promised.

**The helpers** (`admin_dashboard.html`, occurrence counts measured from the shipped file):

| Helper | Declared | Calls | Contract |
|---|---|---|---|
| `escHtml` | `:3262` | 182 | neutralises tag characters; an absent value prints empty, never the word `undefined` |
| `safeId` | `:3272` | 18 | keeps the two identifier shapes NABIN mints (`7f0d5b48-…`, `NAB-9824`); a quote-bearing or over-long one becomes `''` |
| `safeUrl` | `:3276` | 1 | admits an absolute `http(s)` URL only; `javascript:`, `data:`, a root-relative path and nothing all become `''` |
| `requireId` | `:3284` | 11 | refuses *aloud* before the request is made |

**An id can no longer widen a query.** Seven handlers put a caller's parameter into a request URL —
`openIdentityReviewModal(appId)`, `toggleAdStatus(adId)`, `deleteAdCampaign(adId)`,
`openDriverActivityPage(driverId)`, `openPriceHistoryModal(productId)`, `openStoreMatrixModal(masterId)`,
`deleteMasterSku(masterId)` — and each now shape-checks it first (`XSS-10`). `requireId` announces a
refusal rather than no-oping (`XSS-09`, 2 refusal messages proven) because at that door a silent
refusal reads to an operator as *"no results"* and to an attacker as *"that id was accepted"*.

**Two assertions exist to catch this ticket's own damage.** A 409-added/324-removed-line edit to a
single HTML file can clip a string boundary or leave a second declaration of a function: `XSS-11`
parses both inline scripts, and `XSS-12` proves all **124 functions are declared exactly once** —
a guard added to a handler is only the guard the browser runs if no later `function` of the same
name wins.

**The guard is chain link 55.** `backend/admin_console_xss_test.js`, 12 assertions, registered at
`backend/scripts/test_chain.js:239`. It reads the shipped `admin_dashboard.html` rather than a copy
of its rules, and two of its checks assert their own populations are non-empty, so a scanner that
finds nothing fails instead of passing vacuously. Row added to `docs/ADMIN_FEATURE_SPECIFICATION.md`
§8 (`:1076`), trigger: *any edit to `admin_dashboard.html`*.

### Measurements (all fresh, this session, against live local Postgres)

| Harness | Result |
|---|---|
| `backend/admin_console_xss_test.js` standalone | **12/12** |
| chain, run A (link 55 registered) | **53/55 clean, 2 problems** — link 5 (#159) and link 53 |
| link 53 `doc_citation_guard_test.js` in run A | **red, and correctly so**: 80 derivable `server.js:N` citations had drifted from earlier route insertions. Re-anchored with `node scripts/reanchor_audit_citations.js --write` from the repo root (the tool is in `scripts/`, not `backend/scripts/`), then 8/8 with `DC-02 0 stale`, `DC-04 37 citations matched`. The hunks are line numbers only. |
| chain, run B (final, tree unchanged since run A apart from the citation hunks) | **54/55 links clean, 1 problem, 2268 explicit passing checks, 2 skipped**, `teardown: pid 35308 reaped, :4000 free` |
| link 55 in run B | exit 0, **12 passed** |
| link 53 in run B | exit 0, **8 passed** |
| the two skips | the standing pair, unchanged: `IDENT-08` (no `drv_earn_<timestamp>` rows to attribute) and `GAP-TRK-01` (§14-6, a recorded non-guarantee) |

**Link 5's red is not this ticket's, and it is not a geometry fault.** Its per-link log shows the
RIDE matrix rows A and D as `0 not booked ₹NaN`; in that suite `status 0` is produced *only* by
`request()`'s `req.on('error')` handler (in `geo_adversarial_test.js`), i.e. the server was never
reached, and every fare read after that is NaN — so `MTX-R04/05/06` and `MTX-PARCEL-GEOM/-STORED`
are one transport failure reported as five. The pricing engine was demonstrably fine on the same
tree (the same row's quote returned `zone="Connaught Place CBD Boundary", m=1.4, ₹144`, and
`MTX-RIDE-GEOM` passed 2 / 6 / 14 km → ₹76 / ₹142 / ₹274). Filed as **#159** with the leading
hypothesis named (Windows ephemeral-port exhaustion — the suite opens a fresh socket per request
with no keep-alive agent, and link 5 starts after ~4 thousand connections in 3 minutes) and the
real blocker stated: a no-response booking leaves no trace, because `reportNonFiniteFare` fires
only when a job *was* created. The runner printed `EXIT 1, 0 failure mark(s)` against a suite whose
own summary said `5 FAILED` — `test_chain.js`'s `scanOutput` failure pattern matched `[FAIL]`, not
`❌ [ID] FAIL`. That under-report is **#160**; it changes no verdict, because the exit code still
marks the link. Both were closed the same day; see the record below.

**Found while tracing #159, filed as #158, not absorbed into this diff.**
`backend/src/server.js:3396-3397` — `distanceKm: Number(distanceKm) || 4.0`,
`durationMins: Number(durationMins) || 12`. The public quote route answers a confident fare for a
trip the caller never described, which is exactly what let a booking that never answered still
print as a plausible number. Nothing depends on the default (every suite passes explicit `4`/`12`;
the only client caller forwards nullable Dart params), so it is a clean fix later.

**Left as tickets, not silently rewritten.** Escaping is a security fix, not a truth fix —
`escHtml(d.rating || 4.9)` is XSS-safe and still fabricated. Recorded, not edited: `:6310`
`d.rating || 4.9`, `:6484` `t.rating || 5.0`, `:6752` `|| groceryCatalogList[0]`, and the Delhi
fleet `dummyTrips` / `dummyDrivers` → **#156**. #153 (the fabricated toll receipt) and #157 (the
Delhi KYC seeds) are untouched by this ticket.

**Documentation corrected in the same pass.** `docs/CUSTOMER_CLOSURE_REPORT.md`'s verify-command
table claimed the chain is "54 links"; it is a living claim about the harness, so it now says 55
with the date link 55 was added. Its §5 snapshot keeps `54 / 54 … 2252 checks` — that is what the
closure run measured on its day, and dated measurements stay as measured.

## 2026-10-06 — #160 and #159: the runner learned to read a ❌, and the suite learned to say *why* it got no answer

Both were left open by the #155 record. Neither is a product defect, and neither was fixed by
guessing at the other.

**#160 — the runner reported `0 failure mark(s)` for a suite that printed `5 FAILED`.**
`scripts/test_chain.js` counts failure markers as advisory context under the verdict, and its pattern
was `/\[FAIL\]|^Failed:|^not ok |WEBHOOK_NOT_CONFIGURED/` with the comment "`[FAIL]` is the marker
every suite in this chain uses". It isn't: the geo suites print `❌ [MTX-R04] FAIL  …`, where the
closing bracket sits *before* the word, so `[FAIL]` never matched and a link that failed five checks
summarised as if it had failed none. The pattern is now
`/\[FAIL\]|^Failed:|^not ok |^❌|WEBHOOK_NOT_CONFIGURED/` (`scripts/test_chain.js:450`), anchored at
the line start because a green suite's own summary also contains the word ("0 FAILED"). Verified
against every saved link log in `backend/.chain-logs/` (56 files: the 55 links plus one saved
ad-hoc citation-guard run): exactly one file's count changes —
`geo_adversarial_test.log` goes from 0 marks to 5, matching its own `5 FAILED` line — and no green
link gains a mark. The verdict logic was never affected; the exit code still decides. What changed is
that the report can no longer describe a red as unexplained.

**#159 — the evidence the attribution was waiting on.** A no-response booking left no trace: the
transport handler resolved `{status: 0, text: err.message}` and dropped `err.code`, and the one
diagnostic in the suite (`reportNonFiniteFare`) fires only when a job *was* created. That is the gap
between "we think it is port exhaustion" and "we know". Three test-only changes, no assertion touched:

- `request()` stamps `startedAt` and returns `elapsedMs` on both paths, and the error path now also
  carries `transportError: { code, message, syscall, port }` (`geo_adversarial_test.js:58`, `:92`).
  Purely additive fields — nothing else in the file reads them.
- `reportNoBooking(ctx)` (`:299`) prints route, service, status, error code, syscall/port, message,
  elapsed ms, idempotency key, the response's top/job/order key sets, and a redacted body. Request
  headers are never printed; the response body goes through the same `redactForLog` the fare
  diagnostic uses, which is an allowlist-shaped redactor, not a filter that trusts key names.
- `book()` fires it in the two shapes that carry no verdict at all — `status === 0`, or a 2xx with no
  job or order id (`:327`). A refusal is a 4xx with a reason code, so it fires on none of the
  deliberately-refused rows.

Measured, not assumed: `node --check geo_adversarial_test.js` is clean; the matrix rows' `created`/
`fare` expressions are unchanged byte for byte; and the branch was exercised through the real code
path by a throwaway copy of the suite that calls `book()` against a closed port — it printed
`error code : ECONNREFUSED`, `syscall / port : connect / 41999`, `elapsed ms : 5`, and `book()`
returned its usual shape. The copy is deleted. Its `call site` line printed `unknown call site`
because that regex matches `geo_adversarial_test.js` by name — expected in a renamed copy, not a
fault in the diagnostic.

**What this does NOT claim.** The port-exhaustion hypothesis is still a hypothesis. #158 landed in
the same window, so this record's edits were carried by the run described next to it rather than
measured by an earlier one.

## 2026-10-06 — #158: a quote stopped inventing the trip it prices, and the whole chain was re-run over all three edits

**#158 — `POST /api/pricing/estimate` completed a trip length from its own defaults.** The route
took `Number(distanceKm) || 4.0` and `Number(durationMins) || 12`. That is two defects sharing one
expression: a caller that described no trip at all received a confident fare for a 4 km / 12 min
ride it never asked for, and a caller that said `0` was treated as if it had said nothing, because
`Number('0') || 4.0` is `4.0` — so the one length that means exactly what it says, a pickup that is
also the drop, was priced as a ride. A quote is the platform offering to take money, so the length
has to come from the caller. `server.js:3394` now validates both fields at the boundary: missing,
unparseable or non-positive is a `400` with `MISSING_DISTANCE_KM` / `INVALID_DISTANCE_KM` /
`INVALID_DURATION_MINS`, `pricingAvailable: false` and no fare in the body. Zero is refused rather
than defaulted because the booking route already refuses a zero-length trip (`PLACE_REQUIRED`), and
a quote must never offer a fare no booking will accept. Numeric strings still pass: `'4'` prices
exactly as `4` does, so nothing that worked before broke — the change only removes the cases that
were silently invented.

Checked before shipping, because a refusal is only safe if no honest caller was relying on the
default: every caller of the route was read first. `test_suite.js`, `geo_policy_test.js`,
`restart_test.js` and `geo_adversarial_test.js` all send both lengths (the matrix rows go through
`ROUTE_INPUT`), and the Flutter request declares `required double distanceKm`
(`nabin_api_service.dart:182`), so the missing-length path was only ever reachable to a
hand-written request. One asymmetry is worth naming rather than burying: that same Dart method
defaults `durationMins = 12` for itself (`:183`), so the client-side invention survives — but nothing
calls it (the only other hits for `calculateFareEstimate` in `mobile/` are two comments), so it is
latent, not live, and it is the client's own choice rather than the platform quoting a trip nobody
described. Three assertions now pin the boundary — `CHK-15` (no distance → 400
`MISSING_DISTANCE_KM`, and `estimate` is absent from the response), `CHK-16` (zero distance and
zero duration → 400 `INVALID_*`, not a 4 km fare), `CHK-17` (`'4'`/`'12'` price identically to the
numeric case). All three ran against the live backend and passed: link 1 of the run below,
`.chain-logs/test_suite.log:249-251`, `451 passed`.

**The chain re-run, which is what #159 and #160 were waiting for.** Full 55-link chain against the
tree carrying all three edits (`backend/scratch/chain_20261006_run_c.log`):

| | |
|---|---|
| verdict | `=== CHAIN RESULT: 55/55 links clean, 0 problem(s) ===` |
| checks | 2276 explicit passing checks, 2 skipped |
| harness | `harness ready on :4000 after 14356ms`, `teardown: pid 48612 reaped, :4000 free` |
| link 1 | `test_suite.js … exit 0, 451 passed, 71s` (carries CHK-15/16/17) |
| link 5 | `geo_adversarial_test.js … exit 0, 73 passed, 127s` — the link that was intermittently red |
| links 53/54/55 | `doc_citation_guard_test.js` 8 passed, `place_substitution_test.js` 19 passed + 1 skipped, `admin_console_xss_test.js` 12 passed |
| the two skips | the standing pair, unchanged: `IDENT-08` (no `drv_earn_<timestamp>` rows to attribute) and `GAP-TRK-01` (§14-6, a recorded non-guarantee) |

`[NO-BOOKING]` appears **zero times** across the run's own log and all 56 saved per-link logs. On a
green link 5 that is the correct outcome and it is the second half of the #159 change being right: a
diagnostic that fired on healthy runs would be noise that buries the signal.

**What the green run does NOT establish.** Silence here does not attribute the earlier red. It
proves the new branches do not fire when nothing is wrong; it says nothing about which code a red
run will print. #159 therefore stays open with the same two-way fork: `EADDRINUSE` / `ENOBUFS` /
`ECONNREFUSED` puts the fix in this suite's own client (one keep-alive agent for the run), any other
code points back at the booking route. And the pricing engine still holds its own defaults
(`calculateFareEstimate` in `database.js`, plus `distanceKm || 1`) — unreachable from these routes
now, recorded as the next place to clean rather than cleaned.
