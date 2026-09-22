# FI-08 — Settlement Over-Posting Evidence (local database only)

**Status: DOCUMENTED, NOT CORRECTED.** Applying any correction here writes new
financial records against historical ones. That requires explicit approval (see
[Decision required](#decision-required)).

**Where it comes from.** `backend/chaos_audit.js` scenario FI-08 asks a single
question of the local ledger: did any completed trip book more against the
customer wallet than that driver's entitlement allows? It reports **FAIL
(CRITICAL)** with three offenders — `JOB-92412647-611`, `JOB-92768166-552`,
`JOB-93587159-696`. Every other financial scenario passes on the same run: FI-02
(books balance on every header and on the whole ledger), FI-03 (no over-refund, no
reused refund key), FI-04, FI-05, FI-06 (no negative balances), FI-07 (no promotion
past a cap or a per-user limit). The row counts in those messages grow with every
suite pass; what matters is that each reports **0** violations.

All figures below were read from the local Docker PostgreSQL. No hosted
environment was queried. No row was changed.

## What FI-08 measures

```sql
with posted as (
  select (regexp_match(description, 'JOB-[0-9]+-[0-9]+'))[1] job_no, sum(total_debit) booked
  from journal_transactions where description ~ 'JOB-[0-9]+-[0-9]+'
  group by 1
)
select ... having p.booked > j.driver_earnings * 2 + 0.005
```

`driver_earnings * 2` is a deliberate over-generous ceiling: net earnings are
roughly 85% of the fare, so twice that already exceeds the fare. Anything above
it booked the customer more than once.

## The three jobs

| Job number | Fare | Driver earns | Commission | Postings | Window (UTC) | Booked | Credited |
|---|---|---|---|---|---|---|---|
| `JOB-92412647-611` | ₹125.00 | ₹106.00 | ₹19.00 | 98 | 12:06:55.121 → .563 (442 ms) | ₹10,388.00 | ₹10,388.00 |
| `JOB-92768166-552` | ₹125.00 | ₹106.00 | ₹19.00 | 98 | 12:12:51.001 → .428 (427 ms) | ₹10,388.00 | ₹10,388.00 |
| `JOB-93587159-696` | ₹125.00 | ₹106.00 | ₹19.00 | 100 | 12:26:29.765 → .305 (540 ms) | ₹10,600.00 | ₹10,600.00 |

All three: service `RIDE`, status `COMPLETED`, created 2026-09-21, driver
`00000000-0000-0000-0000-000000000101`, every posting category
`RIDE_SETTLEMENT` and status `POSTED`, every posting with
**`idempotency_key = NULL`** and **`job_id = NULL`**, and 98/98/100 *distinct*
`transaction_id` values.

The shape is unambiguous: about a hundred concurrent completion calls on one
trip, each writing its own ledger document, in well under half a second.

### What was posted, and what is missing

Each offender's postings carry two lines only:

```
CUSTOMER_WALLET_LIABILITY   DEBIT   ₹106.00   (×98 or ×100)
DRIVER_EARNINGS_PAYABLE     CREDIT  ₹106.00   (×98 or ×100)
```

- Driver payable credited: **₹31,376.00** against an entitlement of **₹318.00** —
  an overstatement of **₹31,058.00**.
- The matching `CUSTOMER_WALLET_LIABILITY` debit is overstated by the same
  ₹31,058.00. That is why FI-02 still passes: the mistake is symmetric, so the
  books balance while both liability balances are wrong.
- `PLATFORM_COMMISSION_REVENUE` was never credited for these three trips: **₹57.00**
  of commission is unrecognised, so for these jobs
  `DRIVER_EARNINGS + PLATFORM_COMMISSION = FARE` does not hold.
- The driver's `wallet_balance` is ₹1,111.00, i.e. the inflated payable did **not**
  leak into a wallet balance. The damage is confined to the ledger accounts, not
  to a balance anyone can spend.

### A settlement that looks right, for comparison

`JOB-22971176-463` (fare ₹105.00) produced exactly two `journal_transactions`,
four lines, and deterministic keys:

```
RIDE_SETTLEMENT:JOB-22971176-463:DRIVER_EARNINGS     CUSTOMER_WALLET_LIABILITY DEBIT 89.00 | DRIVER_EARNINGS_PAYABLE   CREDIT 89.00
RIDE_SETTLEMENT:JOB-22971176-463:PLATFORM_COMMISSION CUSTOMER_WALLET_LIABILITY DEBIT 16.00 | PLATFORM_COMMISSION_REVENUE CREDIT 16.00
```

`89 + 16 = 105 = fare`, one movement each. That is the invariant FI-08 asserts,
met everywhere except these three pre-fix trips.

## Why this is history, not a live defect

`80940c2 fix(backend): make a trip settle exactly once in PostgreSQL` landed
2026-09-21 **20:38:56 UTC**. All three offenders were posted between 12:06 and
12:26 UTC the same day — eight to nine hours earlier. The rows are the recorded
behaviour of the bug that commit fixed, which is exactly why they must not be
deleted.

Current code is covered by `backend/test_suite.js` MODULE 32, which re-runs the
burst on every suite pass and is green (366/367 as of 2026-09-22):

```
CONC-01 Exactly 1 of 50 concurrent completions books the settlement
CONC-02 The other 49 are refused as already settled, never as success
CONC-03 The trip produced exactly two settlement postings, one per movement
CONC-04 Each movement was credited once — earnings and commission, nothing duplicated
CONC-05 Total booked equals the trip fare, not fare x attempts
CONC-06 The driver wallet moved by exactly one net earning
CONC-07 Every posting stays internally balanced (debits == credits)
CONC-09 A later replay of the same completion is refused with no new money
```

A repeat of the 2026-09-21 burst today cannot produce a second posting, because
each movement carries a unique `idempotency_key` and the settlement itself is one
atomic PostgreSQL stored procedure.

## Related structural finding (same scan, worth its own line)

`journal_transactions.job_id` is populated on **35 of 2,238 rows**. The link
between a settlement and the trip it settles exists only as a job number inside
free-text `description` — which is why FI-08 has to regular-expression the
description to find anything. Any reconciliation written against these rows
inherits that fragility.

## Is there already a reconciliation mechanism?

No. Searched `backend/src` for ledger reversal, adjustment and reconciliation
paths: the only `reconcile*` in the codebase is `reconcileSessions()`, which is
about auth sessions. `LedgerRepository` exposes posting, not reversal. There is
no compensating-entry routine to reuse, so a correction is new work, not a
button that already exists.

## Proposed reconciliation (NOT applied)

Append-only, so the original bad postings stay exactly as they are:

1. For each of the three jobs, write one `RIDE_SETTLEMENT_RECONCILIATION`
   `journal_transaction` that reverses the surplus:
   `DRIVER_EARNINGS_PAYABLE DEBIT 10,282.00 / 10,282.00 / 10,494.00` against
   `CUSTOMER_WALLET_LIABILITY CREDIT` the same, and one credit of ₹19.00 to
   `PLATFORM_COMMISSION_REVENUE` per job with the offsetting debit.
2. Give every reconciling row a deterministic idempotency key
   (`RECONCILIATION:JOB-…:DRIVER_EARNINGS`) so the correction is itself
   exactly-once.
3. Populate `journal_transactions.job_id` for the new rows only — never rewrite
   history to satisfy a report.
4. Re-run FI-08 and FI-02: offenders must fall to 0 and the books must still
   balance.

Steps 1–2 require either a migration or a hand-written SQL batch, and either way
they **modify the financial record**.

## Decision required

Stopped here deliberately. Needed before any of the above is applied:

- **Approval to post compensating journal entries** (they change reported
  financials; nothing else can fix the balances without deleting history, which
  is refused).
- A ruling on whether these three trips are **real transactions or test
  artefacts**. The burst pattern and the timestamps say test fixture, and the
  driver is the seeded one — but that is an inference, not evidence, and it is
  exactly the kind of inference that must not be used to authorise a financial
  correction.
- If they are test artefacts: whether to *annotate* rather than correct — a
  documented exclusion in the audit so FI-08 stops reporting a CRITICAL for
  history that will never recur, with the three job IDs named in the annotation.

Nothing in this document has been executed against the database.
