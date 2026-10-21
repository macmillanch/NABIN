# RMS hosted-migration readiness audit (041 → 042 → 043)

Date: 2026-10-15. Scope: read-only. Nothing in this document was executed against a
hosted database, and nothing here deploys, migrates, writes or deletes remote data.
Owner decision required before any of §7–§9 is acted on.

---

## 1. What was measured, and how

Three kinds of evidence, all from this working tree:

| Axis | Method | Target |
|---|---|---|
| Migration contents | Read the three `.sql` files and counted statements | local repo |
| Local schema state | Direct PostgreSQL catalog reads (`information_schema`, `pg_class.relrowsecurity`, `pg_proc`) | `postgres://…@127.0.0.1:54322/postgres` |
| Hosted dev/test state | PostgREST OpenAPI document + GET-only relation/RPC probes with the service-role and anon keys | ref `ywhxkzmbwppkdemvzlhv` (`NABIN_ENV=testing`) |

The hosted read is deliberately key-shaped rather than SQL-shaped: a PostgREST role's
OpenAPI `paths` list is exactly the set of relations and `/rpc/*` functions that role can
see in its schema cache, so absence is evidence about access control and schema, not
about the probe. Every request was a `GET`. Keys were read from `.env` SECTION A and
never printed.

Command shapes used (safe, repeatable):

```
node scripts/with_local_target.js node scratch/rms_ledger_probe.js       # local catalog read
node scratch/hosted_rms_readonly_audit.js                               # hosted GET-only audit
```

---

## 2. Verdict

**Hosted dev/test is not ready, and the blocker is not a missing object — it is that the
entire RMS migration chain has never been applied there, and this machine currently has
no working direct-Postgres path to it.**

Measured against the local target, where 041/042/043 are all applied, hosted test has:

| What | Local (applied) | Hosted test (measured 2026-10-15) |
|---|---|---|
| `restaurant_*` relations visible to service_role | 10 | **0 of 10** — each `GET` returns `404 / PGRST205 "Could not find the table 'public.<name>' in the schema cache"` |
| `rms_*` RPCs visible to service_role | 19 | **0 of 19** |
| 041 columns on `merchants` | 6 of 6 present | **0 of 6** — `GET /rest/v1/merchants?select=dine_in_enabled,…` → `400 / 42703 column merchants.dine_in_enabled does not exist` (each column individually 42703) |
| 041 columns on `orders` | 6 of 6 present | **0 of 6** — same `42703` per column |
| Migration ledger | 41 versions recorded, highest `043`; 041/042/043 all recorded | **unreadable over PostgREST** (`404 / PGRST125 Invalid path`) — the ledger lives in the `supabase_migrations` schema, which PostgREST does not expose by design |
| Root document | n/a | service_role `HTTP 200`, 59 tables / 23 rpcs; anon `HTTP 401`, 0/0 |

Consequences:

1. The reported missing objects (`restaurant_bills`, `restaurant_staff`,
   `rms_sales_report`) are confirmed, **and the gap is far wider than those three**: no
   part of 041/042/043 exists on hosted test. Note that `rms_sales_report` is a
   **function**, not a table — a table-shaped check would have reported it as missing for
   the wrong reason.
2. Hosted test is at a **pre-041** state on every axis measured. So the readiness
   question is not "which of 041/042/043 are safe to apply" but "041 has never run there".
3. Anon's `HTTP 401` on the root document means hosted test has anon REST access disabled
   at the gateway, which is a different posture from the local Docker stack. Do not
   transfer local anon/grant observations to hosted conclusions without re-measuring.

---

## 3. Required migrations and their true dependency order

Order is **041 → 042 → 043**, and it is not interchangeable:

- **041_restaurant_management_system_core.sql** (184 lines) creates the 7 `restaurant_*`
  tables (`CREATE TABLE IF NOT EXISTS` ×7), 6 indexes, and adds 6 columns to `merchants`
  and 6 to `orders`. Contains **no** RLS or GRANT statement at all.
- **042_restaurant_management_rls.sql** (45 lines) hardens exactly the 7 tables 041
  creates: 7 × `ENABLE ROW LEVEL SECURITY`, 7 × `REVOKE ALL … FROM PUBLIC, anon,
  authenticated`, 7 × `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`. It
  references no object that 043 creates, so it must sit between them.
- **043_rms_durable_persistence.sql** (2058 lines) depends on both: it adds columns to
  041's tables, creates 3 new tables (`restaurant_bill_payments`, `restaurant_refunds`,
  `restaurant_receipts`), 2 sequences, 19 `rms_*` functions, and applies the 042/031
  access-control idiom to its own new objects (3 × `ENABLE ROW LEVEL SECURITY`, plus the
  function `REVOKE`/`GRANT EXECUTE` blocks).

Running 043 without 042 applied leaves 041's seven tables anon-writable; running 042
before 041 fails outright (the relations do not exist). No file depends on anything
newer than itself, so a straight version-order run is correct.

Apply mechanism in this repo is `backend/scripts/migrate.js` — note its behaviour before
anyone reaches for it:

- It discovers **every** `NNN_*.sql` and applies all versions not in the ledger, not a
  chosen three. If hosted test is missing any version below 041, that run applies those
  too. **The pending set on hosted is unknown until the ledger is read directly**, which
  is one of the outstanding approvals in §9.
- One transaction per file with `ROLLBACK` on failure, so a failing migration leaves no
  partial schema from that file.
- It refuses to connect unless `src/services/nabinEnv.audit()` passes (the
  `NABIN_ENV` / `NABIN_SUPABASE_REF` pin) and unless `dbTls` yields a verifying TLS
  config; a `no-verify` bypass is a hard refusal, not a warning.

---

## 4. Expected schema and RPC changes on hosted test

If the chain is applied, hosted test gains, in one step:

- **10 tables** (7 from 041, 3 from 043) — 0 exist today.
- **12 columns** — 6 on `merchants` (`dine_in_enabled`, `takeaway_enabled`,
  `delivery_enabled`, `tax_rate_percent`, `service_charge_percent`, `packaging_fee`),
  6 on `orders` (`order_channel`, `table_id`, `table_session_id`, `pickup_time`,
  `handover_by`, `handover_at`). None exist today.
- **2 sequences** (`restaurant_invoice_number_seq` START 100001,
  `restaurant_kds_ticket_number_seq` START 1001) replacing the `Math.random()` invoice
  and KDS-number minting, plus `USAGE, SELECT` to `service_role`.
- **19 functions**, all `SECURITY DEFINER` with `SET search_path` pinned, `REVOKE ALL`
  from `PUBLIC, anon, authenticated` and `GRANT EXECUTE` to `service_role`
  (measured statement counts in 043: 20 `SECURITY DEFINER` clauses, 46 GRANT/REVOKE
  lines):

```
rms_bill_basis                    rms_create_kds_ticket_atomic
rms_open_table_session_atomic     rms_update_kds_ticket_status_atomic
rms_attach_order_to_session_atomic rms_record_takeaway_handover_atomic
rms_close_session_atomic          rms_create_reservation_atomic
rms_transfer_session_atomic       rms_update_reservation_status_atomic
rms_set_table_status_atomic       rms_sales_report
rms_update_table_atomic           rms_generate_bill_atomic
rms_regenerate_table_qr_atomic    rms_split_bill_atomic
rms_record_bill_payment_atomic    rms_record_bill_refund_atomic
rms_get_bill_receipt_atomic
```

- **One apply-time data write**: 043 §10 backfills `restaurant_bills.payments` (a JSONB
  array 041 created) into `restaurant_bill_payments` rows. It is guarded and maps
  out-of-set or non-positive entries to `'OTHER'` or skips them rather than inventing
  values. On hosted test this currently has nothing to backfill (no bills exist), but it
  is still the only place in the chain where applying a migration mutates rows, so it
  belongs in the rollback plan rather than being treated as pure DDL.
- **One apply-time refusal**: 043 §9 creates
  `restaurant_table_sessions_one_active_per_table` as a **partial unique index**
  (`WHERE status IN ('ACTIVE','BILL_REQUESTED')`) inside a `DO $$` block that
  `RAISE EXCEPTION 'Refusing 043: …'` on `unique_violation`. If the target ever holds two
  un-closed sessions for one table, 043 fails by design. Harmless on a pre-041 database
  (no such rows), but it must be re-checked on any target that already has data.

### Backward compatibility

Every object in the chain is additive on the read path: `IF NOT EXISTS`, `OR REPLACE`,
`ADD COLUMN` without `NOT NULL` on populated tables. No column is dropped, renamed or
tightened, and nothing rewrites an existing row except the §10 backfill. The application
side already tolerates absence — `db.rmsRepo` is nil-guarded and the RMS routes answer
their storage-unavailable channel rather than 500 — so applying the chain cannot break a
route that works today. What changes behaviour is that 31 RMS merchant routes and the
public table-QR resolver move from "not durable" to durable.

### The RMS surface these migrations serve (derived from source, not from a brief)

- **31** merchant-scoped route registrations under `/api/merchant/:restaurantId/rms/…`
  and `/api/merchant/rms/…` (settings, payment settings incl. UPI QR upload/delete,
  tables CRUD + status + QR regenerate, session open/get/transfer/close, bill get/split/
  pay/refund/receipt/search, reservations list/create/status, KDS tickets list/status,
  takeaway handover, staff list/create/delete, sales report). Each is guarded by
  `authenticateMerchant → requireMerchantTenant → requireMerchantService('RESTAURANT')`.
- **1** public resolver: `GET /api/food/table-qr/:qrToken`, unauthenticated by design
  (it resolves a scanned QR to a table and the merchant's active menu).
- `db.rmsRepo` has **80** references in `backend/src/server.js`; the repository is
  constructed at `src/database.js:1715`.

---

## 5. Security and RLS validation checklist

Run each item **on the target, after apply**, and record the measured answer. Items 1–7
are catalog reads; 8–11 are GET-only HTTP probes.

- [ ] 1. All 10 `restaurant_*` relations have `relrowsecurity = true`. (Local baseline:
      10/10 `on`; indexes and sequences legitimately show `off`.)
- [ ] 2. Zero `CREATE POLICY` exists for the RMS tables — deny-by-default is the intent
      (measured: 042 has 0 policies, 043 has 0 policies). An accidentally permissive
      policy here is a vulnerability, not a fix.
- [ ] 3. `anon` and `authenticated` hold **no** grant on any of the 10 relations
      (`information_schema.table_privileges` returns 0 rows for both roles).
- [ ] 4. `service_role` holds `SELECT, INSERT, UPDATE, DELETE` on all 10, and `USAGE,
      SELECT` on both sequences.
- [ ] 5. All 19 `rms_*` functions are `SECURITY DEFINER`, have
      `SET search_path = 'public'` (or an explicit equivalent) in their definition, and
      grant `EXECUTE` to `service_role` only.
- [ ] 6. `PUBLIC` holds no function execute grant on any `rms_*` function.
- [ ] 7. `pg_proc.proconfig` contains the pinned `search_path` for each function — a
      `SECURITY DEFINER` without it is a search-path hijack, and this is the one check
      that a "route works" test cannot catch.
- [ ] 8. Anon `GET /rest/v1/restaurant_bills` is refused (401 or 403/404, not 200 with
      rows).
- [ ] 9. Service-role `GET /rest/v1/restaurant_bills` is `200` with `[]` — presence,
      not emptiness-by-accident.
- [ ] 10. `GET /rest/v1/rpc/rms_sales_report` appears in the service-role OpenAPI
      document and is absent from anon's.
- [ ] 11. `GET /rest/v1/merchants?select=dine_in_enabled` and
      `/orders?select=order_channel` both return 200 (the 42703 → 200 transition is the
      cheapest proof 041 landed).

Note that item 1–7 cannot currently be performed on hosted test from this machine,
because there is no working direct-Postgres connection — see §9.

---

## 6. Backup and rollback strategy

Not performed; proposed for approval.

**Before apply**

1. Take a hosted backup the supported way (Supabase dashboard PITR / a
   `pg_dump -Fc` of the `public` schema and `supabase_migrations` schema to a location
   outside the project). Record its size and a checksum so the restore target is provable.
2. Snapshot the ledger: `SELECT version FROM supabase_migrations.schema_migrations ORDER
   BY version;` — this is the only way to know the pending set, and after a rollback you
   need the original list to restore it.
3. Snapshot the counts the chain touches: `merchants`, `orders`, `restaurant_bills`,
   `restaurant_table_sessions`. 043's §10 backfill and §9 guard both read rows that
   exist at apply time.

**Rollback, in the right order**

The chain is one-way in practice, so plan for "forward-fix" rather than revert:

- Ledger rows for 041/042/043 must be **deleted** if the objects are removed, or the next
  `migrate.js` run will skip them and leave the schema permanently inconsistent.
- 043 is revertible only by dropping its 19 functions, 2 sequences, 3 tables and its
  added columns. `restaurant_bill_payments`, `restaurant_refunds`, `restaurant_receipts`
  hold **financial** rows once the app writes through them — dropping them destroys
  money records, so a rollback after any real use is a restore-from-backup, not a
  `DROP`.
- 042 has no DDL to undo beyond `DISABLE ROW LEVEL SECURITY` + restoring the pre-042
  grants, and **that restoration is the vulnerability 042 exists to close**. Rolling 042
  back should be treated as a security incident, not a revert.
- 041's 12 added columns are nullable and unused elsewhere; dropping the 7 tables would
  discard any session/bill/KDS data written after apply.

Practical recommendation: the safe rollback for a bad apply on **dev/test** is restore
the project from the pre-apply backup. Do not hand-`DROP` on a project that has taken
traffic.

---

## 7. Pre- and post-migration verification steps

Preconditions that must hold before the apply is attempted:

1. A working, direct, TLS-verifying Postgres connection to the intended ref (§9 blocks
   this today).
2. The pending-version list from the ledger, reviewed and approved — because
   `migrate.js` applies **all** pending versions.
3. Confirmation that the target has no two un-closed sessions for one table (043 §9).
4. `NABIN_ENV` + `NABIN_SUPABASE_REF` + `DATABASE_URL` all naming the **same** ref, so
   `nabinEnv.audit()` passes and cannot point a dev migration at production.

Apply and verify:

```
# read-only: is the environment pin self-consistent?
node scripts/with_local_target.js node scripts/verify_hosted_test_env.js   # or the staging wrapper

# the apply itself — NOT RUN, approval required
node scripts/migrate.js

# post: does the schema now look like local?
node scripts/with_local_target.js node scratch/rms_ledger_probe.js     # rerun pointed at hosted
node scratch/hosted_rms_readonly_audit.js                              # must show 10 relations / 19 rpcs / 12 columns
```

Then, and only then, the behaviour suites, **against a guarded local target first** and
hosted second, each through the wrapper so the suite's DB target is the one it claims:

```
node scripts/with_local_target.js node rms_write_honesty_test.js
node scripts/with_local_target.js node rms_read_channel_test.js
node scripts/with_local_target.js node test_rms_postgres_durability.js
node scripts/with_local_target.js node test_rms_upi_billing_sales_complete.js
node scripts/with_local_target.js node test_rms_e2e_integration.js
```

Post-apply acceptance is not "200 OK": it is that a bill, session, payment, refund,
receipt and KDS ticket **survive a server restart** on the target, and that each read
route reports `dataSource` naming PostgreSQL. A restart-erased money record is exactly
the defect 043 closed locally.

---

## 8. What is still unverified

- The hosted **pending-version list**. `PGRST125` is expected (the ledger is not in
  `public`), so absence of evidence here is not evidence of a clean slate — hosted could
  be missing versions below 041 as well.
- Hosted grants and RLS as `information_schema` rows (needs the direct connection).
- Whether the hosted Supabase-managed roles (`anon`, `authenticated`, `service_role`)
  have the same membership shape as the local Docker stack. `SUPABASE_POSTGRES_LIVE=true`
  and the anon 401 both suggest they differ.
- Whether `service_role` on hosted test still holds the broad SELECT grants flagged
  separately as task #251 (that finding was measured on a different axis and is not
  settled by anything here).
- Nothing in this audit exercised a write path, so no claim is made that RMS writes work
  on hosted — only that the objects they need are absent there.

---

## 9. Outstanding owner approvals and risks

Approvals needed before anything in §3–§7 moves:

1. **A usable hosted `DATABASE_URL`.** `.env` SECTION A has it commented out, and the
   stored credential, when tried, was refused by the server:
   `FATAL XX000 — tenant/user postgres.<redacted-ref> not found`. TLS itself is fine
   once the project's own `dbTls` policy is used (the earlier `SELF_SIGNED_CERT_IN_CHAIN`
   was my probe hand-rolling `{rejectUnauthorized:true}` instead of calling it). Until
   this is fixed, no migration, no ledger read and none of the §5 catalog checks can be
   performed on hosted at all. **This is the blocking item.**
2. **Permission to run the chain at all**, and against which ref. Production
   (`ouxvqmhuyueklnegvmxe`) is out of scope for this audit and must not receive 041–043
   before dev/test has carried them through §7.
3. **Approval of the pending set.** `migrate.js` applies every unapplied version; if
   hosted is behind on 034–040 too, those are a separate risk and need their own review.
4. **Backup before apply** (§6) — including who takes it and where it lands.
5. **The 043 §10 backfill** being accepted as a row-mutating step, and the §9 unique
   index being accepted as an apply-time refusal.
6. **Migration files' own safety notice.** All three headers currently read "LOCAL
   VERIFICATION ONLY / DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION
   DATABASE". Those notices have to be deliberately retired by the owner as part of
   approving the hosted apply — not quietly edited beforehand.

Risks, ranked:

- **Hosted apply from an unreviewed pending set** (item 3) — highest: it can execute
  migrations nobody scoped for this change.
- **No restore point** (item 4) — a financial table (`restaurant_bill_payments`) is
  created by the chain; a bad apply without a backup is unrecoverable by DROP.
- **Rolling back 042** to "fix" a data-access problem, which re-opens the anon-writable
  RMS tables 041 shipped with.
- **Confusing function-shaped and table-shaped checks**, as the original "missing
  objects" report did with `rms_sales_report`; the §5 checklist is worded to prevent the
  repeat.
- **Treating a hosted `200` as readiness.** The real acceptance test is durability across
  a restart, plus the `dataSource` label, per §7.
