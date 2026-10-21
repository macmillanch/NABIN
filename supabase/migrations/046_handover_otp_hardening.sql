-- =============================================================================
-- NABIN PLATFORM — HANDOVER / DELIVERY OTP SECURITY HARDENING
-- Migration: 046_handover_otp_hardening.sql
-- Status: LOCAL VERIFICATION ONLY.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION DATABASE.
-- =============================================================================
-- Why: `db.validateAuthoritativeJobOtp({ jobId, otp, otpType, driverId })` compares a
-- submitted 4-digit code against `jobs.start_otp` / `jobs.pickup_otp` / `jobs.delivery_otp`
-- and, on a match, advances the trip. The comparison had no attempt counter, no lockout,
-- no expiry, and no consumption: an attacker could guess forever, and any code ever given
-- out remained valid indefinitely and could be replayed unlimited times after a successful
-- match. The DELIVERY replay was incidentally blocked by the state machine (COMPLETED ->
-- COMPLETED refuses a second settlement), but START was free and the guard was an accident,
-- not an OTP policy. The audit trail also recorded the raw attempted code
-- (`Invalid START OTP attempt [7729] on Job …`), so a failed guess leaked a guess.
--
-- What this adds, and what it deliberately does not:
--   1. Additive per-type OTP state columns on `jobs`. One counter/lock pair plus one
--      expiry/consumed pair per verification type (START, PICKUP, DELIVERY), so a locked
--      START does not lock DELIVERY, and a code that has already proven the trip-start
--      cannot also prove delivery. The lockout is per-type (`{type}_otp_locked_until`) on
--      purpose: a shared lock would let an attacker who spams START guesses deny a
--      legitimate DELIVERY handover, so locking one transition would DoS another.
--   2. `verify_job_otp_atomic(p_job_id, p_otp, p_otp_type, p_max_attempts, p_lockout_minutes,
--      p_expiry_hours)`: one row-level SELECT ... FOR UPDATE followed by an attempt / lock /
--      expire / consume / compare decision, returning a JSONB verdict. Called from
--      `validateAuthoritativeJobOtp` in place of the JS string comparison; concurrency-safe
--      by row lock (mirrors `rms_record_takeaway_handover_atomic` at 043:1610).
--   3. Nothing else. The three OTP columns themselves, the state-machine transitions, and
--      the money settlement path are unchanged; a verification still advances the job via
--      `updateJobStatus` in JavaScript after the RPC reports success.
--
-- Deliberately not in this migration:
--   - The 4-digit code space is unchanged. Widening to 6 digits is a UX/product decision
--     (the customer has to read it off a screen and speak it), not a schema one.
--   - No per-driver lockout across jobs. A driver is already bound to the job via
--     `authenticateDriver` + the JOB_NOT_ASSIGNED_TO_DRIVER check in the route; cross-job
--     rate limiting is the identity-tier concern MI-4 already addresses.
--   - No migration of existing rows: `start_otp_attempts` defaults to 0, so already-booked
--     trips behave as if they had zero wrong guesses on the moment this file is applied.
--     Live rows created before this migration have no expiry column and are treated as
--     "never expires" until their own code is verified once and consumed. This is a
--     deliberate fail-open for existing trips so a schema change cannot strand a live ride;
--     new bookings always carry an expiry stamped by JobRepository.create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Per-type attempt counter (a count of wrong guesses; the lockout lives on
--    the shared otp_locked_until so a locked-out job cannot be re-opened by
--    guessing a different type).
-- -----------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_otp_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS pickup_otp_attempts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS delivery_otp_attempts SMALLINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.jobs.start_otp_attempts IS
  'Count of wrong START-code submissions on this job since the last successful verification. Reset on success.';
COMMENT ON COLUMN public.jobs.pickup_otp_attempts IS
  'Count of wrong PICKUP-code submissions on this job since the last successful verification. Reset on success.';
COMMENT ON COLUMN public.jobs.delivery_otp_attempts IS
  'Count of wrong DELIVERY-code submissions on this job since the last successful verification. Reset on success.';

-- -----------------------------------------------------------------------------
-- 2. Per-type lockout — when this column is set and in the future, that type's
--    verification is refused with OTP_LOCKED regardless of whether the guess is
--    right. It is per-type on purpose: a locked-out START must not also lock out
--    the DELIVERY proof, because an attacker who can spam START guesses would
--    otherwise deny a legitimate handover (a DoS on the one control the customer
--    needs most). The attempt counters above are per-type for the same reason.
-- -----------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_otp_locked_until TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS pickup_otp_locked_until TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS delivery_otp_locked_until TIMESTAMPTZ;

COMMENT ON COLUMN public.jobs.start_otp_locked_until IS
  'When set and in the future, START verification on this job is refused with OTP_LOCKED. Set after p_max_attempts wrong START guesses; cleared when the START code is proven.';
COMMENT ON COLUMN public.jobs.pickup_otp_locked_until IS
  'When set and in the future, PICKUP verification on this job is refused with OTP_LOCKED. Independent of the START/DELIVERY lockouts.';
COMMENT ON COLUMN public.jobs.delivery_otp_locked_until IS
  'When set and in the future, DELIVERY verification on this job is refused with OTP_LOCKED. Independent of the START/PICKUP lockouts.';

-- -----------------------------------------------------------------------------
-- 3. Per-type expiry — a code older than this column can never verify, even
--    when it matches. Bookings stamp NOW() + p_expiry_hours; existing rows
--    carry NULL and are treated as unbounded by the RPC (fail-open on legacy).
-- -----------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_otp_expires_at TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS pickup_otp_expires_at TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS delivery_otp_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.jobs.start_otp_expires_at IS
  'A START code older than this timestamp is refused with OTP_EXPIRED, even when it matches. NULL means the row predates migration 046 and is treated as unbounded.';
COMMENT ON COLUMN public.jobs.pickup_otp_expires_at IS
  'A PICKUP code older than this timestamp is refused with OTP_EXPIRED, even when it matches. NULL means no expiry is enforced.';
COMMENT ON COLUMN public.jobs.delivery_otp_expires_at IS
  'A DELIVERY code older than this timestamp is refused with OTP_EXPIRED, even when it matches. NULL means no expiry is enforced.';

-- -----------------------------------------------------------------------------
-- 4. Per-type consumption — the code is proven once and cannot be reused for
--    the same transition. Replays are refused with OTP_ALREADY_CONSUMED.
-- -----------------------------------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_otp_consumed_at TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS pickup_otp_consumed_at TIMESTAMPTZ;
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS delivery_otp_consumed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.jobs.start_otp_consumed_at IS
  'When set, the START code has already been proven once and cannot verify again.';
COMMENT ON COLUMN public.jobs.pickup_otp_consumed_at IS
  'When set, the PICKUP code has already been proven once and cannot verify again.';
COMMENT ON COLUMN public.jobs.delivery_otp_consumed_at IS
  'When set, the DELIVERY code has already been proven once and cannot verify again.';

-- -----------------------------------------------------------------------------
-- 5. The atomic verify-and-consume RPC.
--    Called from `validateAuthoritativeJobOtp`; the JS caller still advances
--    the job status via `updateJobStatus` after this returns success.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_job_otp_atomic(
    p_job_id            uuid,
    p_otp               text,
    p_otp_type          text,
    p_max_attempts      int DEFAULT 3,
    p_lockout_minutes   int DEFAULT 15,
    p_expiry_hours      int DEFAULT 24
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
    v_job         public.jobs%ROWTYPE;
    v_type        text;
    v_clean       text;
    v_expected    text;
    v_attempts    smallint;
    v_consumed    timestamptz;
    v_expires     timestamptz;
    v_locked      timestamptz;
    v_attempts_col text;
    v_consumed_col text;
    v_expires_col  text;
    v_locked_col   text;
    v_code_col     text;
BEGIN
    v_type := UPPER(TRIM(COALESCE(p_otp_type, 'START')));
    -- Alias RECIPIENT to DELIVERY and SENDER to PICKUP, matching the vocabulary the
    -- JS layer and the /api/driver/verify-otp route already accept.
    IF v_type = 'RECIPIENT' THEN v_type := 'DELIVERY'; END IF;
    IF v_type = 'SENDER'    THEN v_type := 'PICKUP';   END IF;
    IF v_type NOT IN ('START','PICKUP','DELIVERY') THEN
        RETURN jsonb_build_object('success', false, 'code', 'OTP_TYPE_INVALID',
                                  'message', 'Unknown OTP type.');
    END IF;

    v_clean := TRIM(COALESCE(p_otp, ''));
    IF v_clean = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'OTP_EMPTY',
                                  'message', 'A verification code is required.');
    END IF;

    -- Lock the row for the whole transaction so two concurrent submits serialise
    -- cleanly; the second one sees the first's consumed_at and is refused.
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'JOB_NOT_FOUND',
                                  'message', 'No such trip/order.');
    END IF;

    IF v_type = 'START' THEN
        v_attempts_col := 'start_otp_attempts';    v_consumed_col := 'start_otp_consumed_at';
        v_expires_col  := 'start_otp_expires_at';  v_locked_col   := 'start_otp_locked_until';
        v_code_col     := 'start_otp';
    ELSIF v_type = 'PICKUP' THEN
        v_attempts_col := 'pickup_otp_attempts';   v_consumed_col := 'pickup_otp_consumed_at';
        v_expires_col  := 'pickup_otp_expires_at'; v_locked_col   := 'pickup_otp_locked_until';
        v_code_col     := 'pickup_otp';
    ELSE
        v_attempts_col := 'delivery_otp_attempts'; v_consumed_col := 'delivery_otp_consumed_at';
        v_expires_col  := 'delivery_otp_expires_at'; v_locked_col := 'delivery_otp_locked_until';
        v_code_col     := 'delivery_otp';
    END IF;

    -- Per-type lockout: while THIS type's locked_until is in the future, this type is
    -- refused. The refusal is deliberately not a code-match signal, so a locked-out
    -- transition cannot be probed for correctness, and locking one type leaves the
    -- others independently verifiable.
    EXECUTE format('SELECT %I FROM public.jobs WHERE id=$1', v_locked_col) INTO v_locked USING p_job_id;
    IF v_locked IS NOT NULL AND v_locked > NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'OTP_LOCKED',
                                  'message', 'Too many incorrect attempts; ' || LOWER(v_type) || ' verification is temporarily disabled.',
                                  'locked_until', v_locked,
                                  'retry_after_ms', GREATEST(0, (EXTRACT(EPOCH FROM (v_locked - NOW())) * 1000)::bigint));
    END IF;

    EXECUTE format('SELECT %I FROM public.jobs WHERE id=$1', v_consumed_col) INTO v_consumed USING p_job_id;
    IF v_consumed IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'OTP_ALREADY_CONSUMED',
                                  'message', LOWER(v_type) || ' verification code has already been used for this trip.',
                                  'consumed_at', v_consumed);
    END IF;

    EXECUTE format('SELECT %I FROM public.jobs WHERE id=$1', v_expires_col) INTO v_expires USING p_job_id;
    IF v_expires IS NOT NULL AND v_expires < NOW() THEN
        RETURN jsonb_build_object('success', false, 'code', 'OTP_EXPIRED',
                                  'message', LOWER(v_type) || ' verification code has expired.',
                                  'expired_at', v_expires);
    END IF;

    EXECUTE format('SELECT %I FROM public.jobs WHERE id=$1', v_code_col) INTO v_expected USING p_job_id;
    IF v_expected IS NULL OR TRIM(v_expected) = '' THEN
        -- Fail closed: a job with no bound code can never verify. This mirrors the
        -- Phase 10 audit path in validateAuthoritativeJobOtp; kept here so the
        -- RPC is self-contained.
        RETURN jsonb_build_object('success', false,
                                  'code', 'OTP_VERIFICATION_REJECTED_NO_BOUND_CODE',
                                  'message', 'No ' || LOWER(v_type) || ' code is bound to this trip.');
    END IF;

    EXECUTE format('SELECT %I FROM public.jobs WHERE id=$1', v_attempts_col) INTO v_attempts USING p_job_id;

    IF v_clean <> TRIM(v_expected) THEN
        v_attempts := COALESCE(v_attempts, 0) + 1;
        IF v_attempts >= p_max_attempts THEN
            UPDATE public.jobs
               SET start_otp_attempts    = CASE WHEN v_type = 'START'    THEN v_attempts ELSE start_otp_attempts    END,
                   pickup_otp_attempts   = CASE WHEN v_type = 'PICKUP'   THEN v_attempts ELSE pickup_otp_attempts   END,
                   delivery_otp_attempts = CASE WHEN v_type = 'DELIVERY' THEN v_attempts ELSE delivery_otp_attempts END,
                   start_otp_locked_until    = CASE WHEN v_type = 'START'    THEN NOW() + make_interval(mins => p_lockout_minutes) ELSE start_otp_locked_until    END,
                   pickup_otp_locked_until   = CASE WHEN v_type = 'PICKUP'   THEN NOW() + make_interval(mins => p_lockout_minutes) ELSE pickup_otp_locked_until   END,
                   delivery_otp_locked_until = CASE WHEN v_type = 'DELIVERY' THEN NOW() + make_interval(mins => p_lockout_minutes) ELSE delivery_otp_locked_until END,
                   updated_at            = NOW()
             WHERE id = p_job_id;
            RETURN jsonb_build_object('success', false, 'code', 'OTP_LOCKED',
                                      'message', 'Too many incorrect attempts; verification is temporarily disabled.',
                                      'locked_until', NOW() + make_interval(mins => p_lockout_minutes),
                                      'retry_after_ms', (p_lockout_minutes * 60 * 1000));
        END IF;
        UPDATE public.jobs
           SET start_otp_attempts    = CASE WHEN v_type = 'START'    THEN v_attempts ELSE start_otp_attempts    END,
               pickup_otp_attempts   = CASE WHEN v_type = 'PICKUP'   THEN v_attempts ELSE pickup_otp_attempts   END,
               delivery_otp_attempts = CASE WHEN v_type = 'DELIVERY' THEN v_attempts ELSE delivery_otp_attempts END,
               updated_at            = NOW()
         WHERE id = p_job_id;
        RETURN jsonb_build_object('success', false, 'code', 'OTP_MISMATCH',
                                  'message', 'Invalid ' || LOWER(v_type) || ' verification code.',
                                  'attempts', v_attempts,
                                  'attempts_remaining', p_max_attempts - v_attempts);
    END IF;

    -- Correct code: consume it (and only it), reset the counter, clear this type's lock
    -- so a code proven on one type does not remain shadowed by an unrelated lock.
    EXECUTE format(
        'UPDATE public.jobs SET %I = NOW(), %I = 0, %I = NULL, updated_at = NOW() WHERE id = $1',
        v_consumed_col, v_attempts_col, v_locked_col
    ) USING p_job_id;

    RETURN jsonb_build_object('success', true, 'code', 'OTP_VERIFIED',
                              'message', LOWER(v_type) || ' verification code accepted.',
                              'otp_type', v_type,
                              'consumed_at', NOW(),
                              'expires_at', v_job.created_at + make_interval(hours => p_expiry_hours));
END;
$function$;

COMMENT ON FUNCTION public.verify_job_otp_atomic IS
  'Atomic check-and-consume of a job OTP: locks the row, enforces attempts / lockout / expiry / consumption per type, compares the submitted code, and marks it consumed on success. Returns JSONB {success, code, message, ...}. Advances no job status.';

GRANT EXECUTE ON FUNCTION public.verify_job_otp_atomic(uuid, text, text, int, int, int) TO service_role;
