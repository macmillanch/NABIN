# NABIN — Current Repository State

**Last Updated**: 2026-09-21
**Mode**: IMPLEMENTATION — verified work committed and pushed
**Status**: AUTHORITATIVE SNAPSHOT

> **Re-baseline note (2026-09-21):** the 2026-09-20 snapshot below-left stale.
> Verified live: HEAD = origin/main = `b13cdb3`, reached by a fast-forward
> `9b2804c..b13cdb3` carrying 8 commits — 7 made on 2026-09-21 (backend
> PostgreSQL-authority, mobile grocery/food live data, both merchant web consoles
> plus admin/customer-web token work, docs, web lint fix, two status notes) and
> `6494b25` which was already local on 2026-09-20. Working tree is clean apart
> from the
> 11 junk root artifacts and `.kilo/agents/`. `IMPLEMENTATION_PLAN.md` was
> deleted on 2026-09-21 after review: it was 0 bytes, had never been tracked
> (`git log --all --` returns nothing), shadowed nothing, and no code reads that
> path. The authoritative Phase 16 plan remains tracked at
> `docs/PHASE_16_IMPLEMENTATION_PLAN.md` (613 lines, frozen, PLAN-ONLY).
>
> **Milestone (2026-09-21):** `e463661` gives the Grocery Merchant App its
> master-catalogue stocking screen (`/catalogue`), closing the largest functional
> gap in `grocery_merchant_app_gap.md` — a store could previously only sell what
> had been seeded into `merchant_grocery_inventory` by hand. Verified against the
> live local PostgreSQL, not just compiled.
>
> **Follow-up (2026-09-21):** `1b128e7` + `239c134` close the two gaps that
> stocking exposed — an un-stock route for a line the store added, and merchant
> recipients in the notification bus with a socket push. Both were driven against
> the live database, including the refusal path for a line that has been sold. The
> app-side notification feed is still unbuilt on purpose; nothing was stubbed.

---

## 1. GIT STATE

| Field | Value |
|-------|-------|
| **Current HEAD** | `dc11941` (this §1 update lands on top of it as a docs commit) |
| **origin/main** | `9f0b4e9` before this push; parity is restored by it |
| **HEAD == origin/main** | After the push carrying this commit: YES |
| **Working tree** | CLEAN of tracked modifications; untracked: `.kilo/agents/` + 11 junk root files |
| **Branch** | main |

### Untracked files of record (re-verified 2026-09-21, `git status --porcelain`)

- `.kilo/agents/` — never commit (standing rule)
- Junk root artifacts, still unreleased pending USER approval: `mcp_out.txt`,
  `readme.txt`, and 9 pasted/truncated-filename files
  (`ersmacmiDocumentsnabin`, `pacing scale`, `ion 1.0.0`, `to Implement (38 total)`,
  `tomer-facing features`, `tomer App  Flutter  48 …`, `plan transitions NABIN …`,
  `e Stitch Design → Application Implementation`, `:`)
- `scratch/` (including `grocery_e2e.sh`, the live grocery E2E probe) is
  gitignored at `.gitignore:31`, so it never appears here
- The 2026-09-20 list — `nabin_repository_inventory.md`,
  `nabin_234_implementation_gap.md`, `admin-web/src/components/AdminLayout.tsx`,
  `customer-web/src/components/`, `mobile/.../driver_job_offer_card.dart` — is now
  committed (docs in `19c9041`, web in `7c1fe53`, mobile in `c35306d`)

### Recent Git History
```
dc11941 fix(backend): make a retired grocery master product disappear from customer browse
9f0b4e9 docs: record the un-stock route and merchant notification pass
239c134 feat(mobile): give the grocery inventory screen a remove action
1b128e7 feat(backend): let a grocery store un-stock a line and receive its own notifications
51ad0ea docs: record the master-catalogue stocking milestone
e463661 feat(mobile): let grocery merchants stock products from the NABIN master catalogue
55a1836 chore(records): delete empty IMPLEMENTATION_PLAN.md and re-baseline git state
b13cdb3 docs: mark session memory as pushed
a03a28c docs: record the pushed commit range
dac61ec fix(web): clear the react-hooks lint errors in the merchant consoles
19c9041 docs: record the PG-authoritative pass, gap audits and corrected git/supabase state
7c1fe53 feat(web): add merchant consoles and bring the web apps onto shared tokens
c35306d feat(mobile): wire grocery and food browsing to live data with real checkout
e7a7d31 feat(backend): make customer browse and grocery checkout PostgreSQL-authoritative
6494b25 fix(mobile): resolve Flutter analyzer errors
9b2804c docs(stitch): add design freeze reports and handover artifacts for 234-screen canonical set
1d404a6 Revert "feat(database): add migration 017 for menu modifiers, tax configs, and tax invoicing with composite tenant constraints"
4c3ba35 feat(database): add migration 017 for menu modifiers, tax configs, and tax invoicing with composite tenant constraints
66c0718 chore(recovery): revert unauthorized Phase 18 commits to restore authorized baseline 8eb4f662
d62963f test(phase18): expand test suite to 295 passing tests with full kds and tax invoice verification
0842574 feat(api): implement food checkout, kds transitions, modifier crud, and tax invoice endpoints
8f0e9c4 feat(menu-kds-tax): implement tax calculation service, menu repository, and invoice repository
faa777f feat(database): add migration 017 for menu customization, kds workflow, and tax invoicing
8eb4f66 feat(notifications): wire lifecycle events to notification engine
c2e42ad feat(notifications): add notification REST APIs
4e57620 feat(notifications): add push provider abstraction and event bus
6bb6c17 feat(notifications): add PostgreSQL notification repository
7591f01 docs(governance): codify permanent Git safety and loss-prevention protocol in AGENTS.md
c0cdf47 feat(phase-16): implement PostgreSQL-authoritative driver KYC, verified VPA payout, refund idempotency, and atomic cancellation
409e2e9 chore(governance): restore codebase to approved baseline 8eb4f21 preserving forensic audit records
d7ef7f5 feat(phase-16): implement postgres kyc, verified vpa, partial refund and atomic cancellation
8e18c21 feat: bridge geofences and pricing to postgres persistence
```

---

## 2. APPROVED BASELINE

| Item | Value |
|------|-------|
| **Approved Git Baseline** | `8eb4f662...` (notifications phase) |
| **Phase 16 Authorized Baseline** | `8e18c216...` (Phase 14: geofences and pricing) |
| **Migration Baseline** | 001–015 approved |
| **Migration 016** | EXISTS and IS IN AUTHORIZED GIT BASELINE via commit c0cdf47; formal user approval workflow not yet documented |
| **Migration 017** | ABSENT — deleted by revert commits 66c0718 and 1d404a6; NOT approved for future implementation |

**Note**: User-stated current approved baseline is `8eb4f662`. Actual repository HEAD is `1d404a6` (revert of Phase 18). The repo has been restored past Phase 16 to baseline `8eb4f66`, then proceeded with Phase 18 (`4c3ba35`) which was reverted via `1d404a6`.

**Note on Migration 016**: Migration 016 is present in `supabase/migrations/` and is part of the authorized Git baseline through commit `c0cdf47`. However, a formal user approval record documenting explicit authorization is not present in the repository. Governance distinguishes between "authorized Git baseline" and "formal approval record" (see DEC-017 in DECISIONS.md).

---

## 3. DATABASE STATE

### Migrations
| Migration | Status | Notes |
|-----------|--------|-------|
| 001–015 | APPROVED | Baseline migrations, do not modify |
| 016 | AUTHORIZED IN GIT / FORMAL APPROVAL PENDING | Present at `supabase/migrations/016_driver_kyc_payout_and_partial_refund.sql` only; added in authorized commit c0cdf47; does not exist in `backend/migrations/` |
| 017 | ABSENT / REVERTED | Deleted by revert commits 66c0718 and 1d404a6; does not exist in working tree or Git index; NOT approved for future implementation |

### Authoritative PostgreSQL Persistence
- Migrations 001–015 establish: `users`, `drivers`, `jobs`, `payments`, `ledger_accounts`, `journal_transactions`, `journal_lines`, `geo_fences`, `surge_zones`, `promotions`, `support_tickets`, `audit_logs`, `notifications`, `checkouts`, `dispatch_offers`, `merchants`, `products`, `grocery_catalog`, etc.
- Migration 016 adds: `verified_upi_id`, `payout_upi_verified`, `kyc_status`, `user_id` on `drivers` table (present in authorized Git baseline via c0cdf47)
- Migration 017 is absent; menu customization, kitchen workflow, tax configs are NOT in current schema

### Local data changes made this session (2026-09-21, local Docker only)
- `master_grocery_catalog`: 11 duplicate "Test Basmati Rice" rows set to `is_active = false` with the
  owner's approval; `6e617e3a-e377-4d7b-ae2c-0e8de0208a77` left active because `Test Supermarket M2`
  sells it. No row was deleted — `order_lines` is `ON DELETE RESTRICT` and orders are immutable.
  Previous ids/flags: `scratch/rice_master_backup_2026-09-21.txt` (gitignored).
- 4 grocery orders were placed against the local database to prove the notification and un-stock
  paths (`ORD-00000318`, `ORD-00000319` and the earlier pair); they are permanent records by design.
- A stocking/un-stocking round trip ran through `POST`/`DELETE /api/merchant/inventory` only, and
  the test listing was removed, so `Test Supermarket M2` is back to its single seeded row.

### Remote Supabase
- OFF LIMITS
- No `supabase link`, `supabase db push`, or `supabase db reset` executed
- All database operations confined to local Docker instance

---

## 4. APPLICATION STATE

### Backend (Node.js + Express)
| Component | Status |
|-----------|--------|
| `backend/src/server.js` | REST + WebSocket API |
| `backend/src/database.js` | In-memory + PostgreSQL bridge |
| Repositories | User, Driver, Job, Ledger, Payment (Phase 13+), Promotion, SchoolChild |
| Test Suite | 295 passing tests (Phase 18 claim; needs re-verification post-revert) |
| Cold Restart Tests | 34 passing |

### Flutter Mobile Apps
| App | Status |
|-----|--------|
| Customer App | Flutter 3.47, Stitch design system |
| Driver App | Flutter, GPS telemetry, dispatch |
| Merchant App | Flutter, restaurant/grocery operations |
| Widget Tests | 18/18 passing |
| Static Analysis | 0 issues |

### Admin Web
- HTML5 / Tailwind / Leaflet dashboard
- 7,000+ lines
- Live analytics, KYC queue, dispatch tracking, zone editors

---

## 5. PHASE STATE

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1–9 | COMPLETE | Persistence bridges for users, drivers, jobs, wallets, payments, geofences, surge, promotions, support, audit, notifications |
| Phase 10–12 | COMPLETE | Identity/KYC audit, domain readiness, payments/payouts/booking security |
| Phase 13 | COMPLETE | Security hardening, 288/288 tests passing |
| Phase 14 | COMPLETE | Financial integrity audit |
| Phase 15 | COMPLETE | Authorization payout cancellation audit |
| Phase 16 | REJECTED | Unauthorized implementation; forensic audit completed; restoration committed |
| Phase 17 | DOES NOT EXIST | No approved plan |
| Phase 18 | REJECTED | Unauthorized implementation; reverted via `1d404a6` |

---

## 6. KNOWN ISSUES

### Open from Phase 16 Forensic
1. **Hardcoded mock KYC** — `backend/src/database.js:440` seeds `kycStatus: 'VERIFIED'` for DRV-104 test fixture

### Open from Phase 13/14/15
2. **Mobile UI unwired** — Most mobile screens use local state rather than live API calls
3. **34 of 38 PostgreSQL tables unused** — Backend predominantly uses in-memory arrays
4. **Migration 016 formal approval workflow** — Present in authorized Git baseline via c0cdf47; explicit user approval record not yet documented (see DEC-017)
5. **Migration 017** — Absent; NOT approved for future implementation

---

## 7. CONTRADICTIONS DISCOVERED

| Source | Contradiction | Resolution |
|--------|---------------|------------|
| `docs/ARCHITECTURE.md:23` | States "10-Minute DarkStore Grocery Engine" | NABIN does NOT operate dark stores. Grocery is marketplace model. Document is outdated. |
| `docs/ARCHITECTURE.md:23` | States "DarkStore-linked ultra-fast grocery delivery" | Same contradiction. Must be corrected. |
| `docs/IMPLEMENTATION_GAP_AUDIT.md` | References "DarkStore" in quick-commerce section | Same contradiction. |
| `.agents/AGENTS.md` (pre-existing) | Missing governance rules for multi-agent conflict resolution, approval hierarchy, database safety | Updated in this governance setup. |
| User-stated baseline `8eb4f66` vs actual HEAD `1d404a6` | Phase 18 was implemented and reverted after user-stated baseline | Documented; actual HEAD is authoritative. |

---

## 8. REMOTE INFRASTRUCTURE

| System | Status | Access |
|--------|--------|--------|
| Remote Supabase (nabin-test) | OFF LIMITS | No access without explicit authorization |
| Remote Supabase (NABIN) | OFF LIMITS | No access without explicit authorization |
| GitHub (macmillanch/NABIN) | READ/WRITE | Push only with explicit approval |
| Docker (local Supabase) | ACTIVE | Local development only |

---

## 9. NEXT ACTIONS REQUIRED

1. **Fix hardcoded mock KYC** — `backend/src/database.js:440` seeds `kycStatus: 'VERIFIED'`; requires explicit approval for implementation.
2. **Formalize Migration 016 approval record** — Migration 016 is in authorized Git baseline via c0cdf47; formal user approval documentation is pending (see DEC-017).
3. **Conduct Phase 18 forensic audit** — Phase 18 was unauthorized and reverted; formal forensic audit has not yet been completed.
4. **Correct DarkStore references in legacy docs** — `docs/ARCHITECTURE.md`, `docs/API.md`, and `docs/BETA_CHECKLIST.md` still contain DarkStore terminology contradicting DEC-010. These are deferred documentation cleanup items.
5. **Proceed with PostgreSQL persistence bridge** — Migrate remaining in-memory arrays to PostgreSQL (no change to this planned work).
