/*
 * JD-1 - a privileged DELETE on jobs / orders / order_transitions must actually delete (SURGICAL).
 *
 * What is wrong today. `prevent_client_financial_record_mutation()` is attached BEFORE DELETE OR
 * UPDATE, FOR EACH ROW, to `jobs`, `orders` and `order_transitions`. Its first statement is the
 * role bypass:
 *
 *   IF current_user NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
 *
 * A BEFORE DELETE row trigger has no NEW record — NEW is NULL, and returning NULL from that
 * trigger tells PostgreSQL to skip the row. So for every role the function exists to let
 * through, a DELETE on those three tables reports `DELETE 0`, removes nothing, and raises
 * nothing. Measured on a scratch table carrying this same function, as `postgres`:
 *
 *   INSERT 1 row -> DELETE -> rowCount=0, row still present, no error, ROLLBACK clean.
 *
 * The observable consequence is permanent residue. `test_suite.js` tears its Phase 22 job
 * fixture down with `from('jobs').delete().eq('id', …)` and `support_bounty_atomicity_test.js`
 * sweeps `DELETE FROM jobs WHERE job_number LIKE 'JOB-E3-%'`; both succeed, both report zero
 * rows, both leave the row. Fixture jobs therefore accumulate in `jobs` forever, each one a
 * COMPLETED job with no earnings leg behind it, and the only thing that ever cleared them was
 * a TRUNCATE — because TRUNCATE does not fire row triggers.
 *
 * What this migration changes. One control-flow branch. A privileged DELETE now returns OLD,
 * which is the record a DELETE trigger must return to let the row go. Nothing else moves:
 *
 *   - `anon` and `authenticated` are still refused a DELETE, by the same RAISE EXCEPTION with
 *     the same SQLSTATE (insufficient_privilege) and the same message.
 *   - The write-once financial/OTP column freeze for clients is byte-identical.
 *   - UPDATE behaviour is byte-identical — NEW is the correct return value for an UPDATE
 *     trigger, which is why only the DELETE path was broken.
 *   - The genuinely append-only stores (`journal_transactions`, `journal_lines`,
 *     `ledger_entries`, `driver_payouts`, `payment_webhooks`,
 *     `payment_refund_authorizations`, `audit_logs`) are guarded by
 *     `prevent_financial_row_mutation()` / `prevent_audit_log_mutation()`, which RAISE
 *     unconditionally on DELETE for every role including `postgres`. This migration does not
 *     touch them, so no journal, ledger or payout row becomes deletable.
 *
 * What it deliberately does NOT do. It does not make `jobs`/`orders` rows deletable by a
 * client, and it does not add any DELETE grant. It only stops a delete that was already
 * permitted from being silently unwritten. Application code that *wanted* the old behaviour
 * would have had to be relying on a DELETE that provably never happened.
 *
 * Safety: single CREATE OR REPLACE FUNCTION, no data touched, no trigger re-created, no
 * grants changed, idempotent. Re-running is a no-op. Applying it to a populated store deletes
 * nothing by itself — it only makes the deletes that repositories and teardowns already issue
 * take effect.
 */

CREATE OR REPLACE FUNCTION public.prevent_client_financial_record_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  frozen_columns text[];
  col            text;
  old_value      jsonb;
  new_value      jsonb;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    -- JD-1: NEW does not exist in a DELETE trigger, so `RETURN NEW` here was a NULL return and
    -- PostgreSQL skipped the row without saying so. OLD is what a DELETE trigger must return to
    -- allow it. Clients are refused further down and are unchanged.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Client role % may not delete from %.% : this record is append-only.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_TABLE_NAME = 'order_transitions' THEN
    RAISE EXCEPTION
      'Client role % may not modify %.% : order transition history is append-only.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  ELSIF TG_TABLE_NAME = 'jobs' THEN
    -- Write-once columns. Every entry is set by JobRepository.create() and is
    -- never reassigned by any later application path (verified by audit):
    --   identity  -> job_number, service_type, customer_id, driver_id, merchant_id
    --   money     -> final_total, fare_subtotal, driver_earnings,
    --                platform_commission, packaging_fee, tax_amount,
    --                surge_amount, surge_multiplier, discount_amount
    --   OTP proof -> start_otp, pickup_otp, delivery_otp
    -- Status/driver lifecycle, payment_status, refund_* and cancellation_* stay
    -- mutable: those are legitimate progressions, not committed financial facts.
    frozen_columns := ARRAY[
      'job_number', 'service_type', 'customer_id', 'driver_id', 'merchant_id',
      'final_total', 'fare_subtotal', 'driver_earnings', 'platform_commission',
      'packaging_fee', 'tax_amount', 'surge_amount', 'surge_multiplier',
      'discount_amount', 'start_otp', 'pickup_otp', 'delivery_otp'
    ];
  ELSIF TG_TABLE_NAME = 'orders' THEN
    frozen_columns := ARRAY[
      'order_number', 'job_id', 'checkout_id', 'customer_id', 'merchant_id',
      'total_amount', 'currency', 'items_snapshot'
    ];
  ELSE
    RAISE EXCEPTION
      'Client role % may not modify %.% : no column policy is registered for this table.',
      current_user, TG_TABLE_SCHEMA, TG_TABLE_NAME
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  old_value := to_jsonb(OLD);
  new_value := to_jsonb(NEW);

  FOREACH col IN ARRAY frozen_columns
  LOOP
    IF new_value -> col IS DISTINCT FROM old_value -> col THEN
      RAISE EXCEPTION
        'Financial/OTP column %.%.% is immutable after creation (attempted by role %).',
        TG_TABLE_SCHEMA, TG_TABLE_NAME, col, current_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;
