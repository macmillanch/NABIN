-- =============================================================================
-- NABIN PLATFORM — RMS DURABLE PERSISTENCE (SESSIONS, BILLS, PAYMENTS, RECEIPTS,
-- REFUNDS, KDS, HANDOVER, STAFF, REPORTS)
-- Migration: 043_rms_durable_persistence.sql
-- Status: LOCAL VERIFICATION ONLY.
-- SAFETY NOTICE: DO NOT APPLY THIS MIGRATION TO ANY REMOTE OR PRODUCTION DATABASE.
-- =============================================================================
-- Why: migration 041 created the seven `restaurant_*` tables and migration 042 closed
-- their access control, but `RestaurantManagementRepository` only ever wrote three of
-- them (merchants settings, restaurant_sections, restaurant_tables). Table sessions,
-- reservations, bills, receipts, payments, refunds, KDS tickets, takeaway handovers,
-- staff rows and both sales reports lived in nine in-process `Map` collections, so a
-- restart erased the restaurant's money records while the API kept answering 200 with
-- `dataSource` silently omitted. Measured on the local target before this file:
-- restaurant_table_sessions / restaurant_reservations / restaurant_bills /
-- restaurant_staff / restaurant_kds_tickets all held 0 rows.
--
-- What this adds, and what it deliberately does not:
--   1. Additive columns on the 041 tables for the facts the code generated in memory
--      and never had anywhere to put: durable invoice numbers, the item/merchant/
--      payment-instruction snapshots a bill must freeze, refunded totals, split shares,
--      session closure and transfer audit, KDS prep time and unique ticket numbers,
--      reservation and staff role-change timestamps.
--   2. Three genuinely missing entities, so no existing entity is duplicated and no
--      second financial ledger is created:
--        - `restaurant_bill_payments` — one row per tender. The 041
--          `restaurant_bills.payments` JSONB array stays in place (nothing is discarded)
--          and is backfilled into these rows below; from here it is legacy read-only.
--        - `restaurant_refunds` — one row per refund EVENT. `transfer_status` defaults
--          to 'RECORDED_ONLY' and 'BANK_CONFIRMED' is unreachable without a
--          `transfer_confirmed_at`, so a refund record can never read as a verified
--          movement of money.
--        - `restaurant_receipts` — the immutable document minted when a bill settles,
--          with reprint accounting (`print_count`, `last_printed_at`).
--   3. Sequences for the three numbers the code invented with `Math.random()`:
--      `INV-<year>-<6 digits>`, `KBD-<digits>`, `REC-<invoice>`. Each is UNIQUE-backed,
--      so two bills can no longer share an invoice number.
--   4. `rms_*_atomic` SECURITY DEFINER functions (the 039/019 house idiom) for every
--      operation that must lock a row, check a balance, validate a state transition or
--      write more than one record. Row locks are `SELECT ... FOR UPDATE`, so two
--      cashiers cannot both settle one bill or both open one table.
--   5. The 042/031 access-control block for the three new tables and every new function.
--
-- Historical truth: a bill snapshots the merchant settings, UPI identity and order-line
-- prices AT GENERATION TIME (`items_snapshot`, `merchant_snapshot`,
-- `payment_instructions`). Later edits to `merchants.upi_id`, `upi_qr_url`, tax or
-- service rates are writes to the merchant row only — no read path in this migration
-- recomputes a persisted bill from current prices or current settings.
--
-- Idempotent: every statement here is `IF NOT EXISTS`, `OR REPLACE`, or a guarded
-- backfill, so a re-run against a database that already has it changes nothing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SEQUENCES FOR SERVER-MINTED NUMBERS
-- -----------------------------------------------------------------------------
-- Replaces `Math.floor(100000 + Math.random()*900000)` (invoices),
-- `KBD-${Math.floor(1000 + Math.random()*9000)}` (KDS tickets) and the
-- `REC-${invoice.substring(0,12)}` display string a receipt used to synthesise.

CREATE SEQUENCE IF NOT EXISTS public.restaurant_invoice_number_seq START 100001 INCREMENT 1;
CREATE SEQUENCE IF NOT EXISTS public.restaurant_kds_ticket_number_seq START 1001 INCREMENT 1;

-- -----------------------------------------------------------------------------
-- 2. ADDITIVE COLUMNS: RESTAURANT TABLE SESSIONS
-- -----------------------------------------------------------------------------
-- `restaurant_tables.current_session_id` is deliberately FK-less in 041 (a session rows
-- points at a table and a table points back at a session), so it stays as it is and the
-- session row remains the authority for which table it owns.

ALTER TABLE public.restaurant_table_sessions
    ADD COLUMN IF NOT EXISTS closed_by VARCHAR(120),
    ADD COLUMN IF NOT EXISTS previous_table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS transfer_count INTEGER NOT NULL DEFAULT 0 CHECK (transfer_count >= 0),
    ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (balance_amount >= 0);

CREATE INDEX IF NOT EXISTS idx_rms_sessions_table_status
    ON public.restaurant_table_sessions (table_id, status);

-- -----------------------------------------------------------------------------
-- 3. ADDITIVE COLUMNS: RESTAURANT BILLS
-- -----------------------------------------------------------------------------

ALTER TABLE public.restaurant_bills
    ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(40) UNIQUE,
    ADD COLUMN IF NOT EXISTS table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS table_number VARCHAR(30),
    ADD COLUMN IF NOT EXISTS packaging_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (packaging_fee >= 0),
    ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0),
    ADD COLUMN IF NOT EXISTS items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS merchant_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS payment_instructions JSONB,
    ADD COLUMN IF NOT EXISTS splits JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS generated_by VARCHAR(120),
    ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

-- One bill per table session is what makes bill generation idempotent; the repository
-- used to answer a fresh random invoice number on every call for the same session. The
-- DO block means an environment that already holds two bills for one session gets an
-- error naming the constraint instead of losing either row.
DO $$
BEGIN
    CREATE UNIQUE INDEX restaurant_bills_one_per_session ON public.restaurant_bills (table_session_id);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Refusing 043: restaurant_bills holds two bills for one table_session_id; resolve them before applying.';
END $$;
CREATE INDEX IF NOT EXISTS idx_rms_bills_merchant_created
    ON public.restaurant_bills (merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rms_bills_status
    ON public.restaurant_bills (merchant_id, status);

-- -----------------------------------------------------------------------------
-- 4. NEW ENTITY: RESTAURANT BILL PAYMENTS (ONE ROW PER TENDER)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_bill_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES public.restaurant_bills(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    effective_credited NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (effective_credited >= 0),
    change_due NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (change_due >= 0),
    payment_method VARCHAR(20) NOT NULL
        CHECK (payment_method IN ('CASH', 'UPI', 'CARD', 'WALLET', 'OTHER')),
    transaction_ref VARCHAR(120),
    recorded_by VARCHAR(120),
    -- 'VERIFIED' would assert a bank confirmation this platform does not have, so the
    -- schema itself refuses the pairing: VERIFIED requires verified_at.
    verification_status VARCHAR(20) NOT NULL DEFAULT 'RECORDED'
        CHECK (verification_status IN ('RECORDED', 'VERIFIED')),
    verified_at TIMESTAMPTZ,
    note TEXT,
    idempotency_key VARCHAR(160) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((verification_status <> 'VERIFIED') OR verified_at IS NOT NULL),
    CHECK (effective_credited <= amount)
);

-- The duplicate-tender guard the repository only had inside a process-local array scan.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_bill_payments_bill_ref_key
    ON public.restaurant_bill_payments (bill_id, transaction_ref)
    WHERE transaction_ref IS NOT NULL AND transaction_ref <> '';
CREATE INDEX IF NOT EXISTS idx_rms_payments_bill ON public.restaurant_bill_payments (bill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rms_payments_merchant_created
    ON public.restaurant_bill_payments (merchant_id, created_at);

-- -----------------------------------------------------------------------------
-- 5. NEW ENTITY: RESTAURANT REFUNDS (RECORDED EVENT, NOT MONEY MOVED)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES public.restaurant_bills(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    payment_id UUID REFERENCES public.restaurant_bill_payments(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    refund_method VARCHAR(20) NOT NULL
        CHECK (refund_method IN ('CASH', 'UPI', 'CARD', 'WALLET', 'OTHER')),
    reason TEXT NOT NULL,
    recorded_by VARCHAR(120),
    transfer_reference VARCHAR(160),
    -- A row here is an audit event. Nothing in this migration talks to a bank, a UPI
    -- switch or a gateway, so 'BANK_CONFIRMED' is only reachable with a confirmation
    -- timestamp from an authorised verification mechanism — which does not exist yet.
    transfer_status VARCHAR(20) NOT NULL DEFAULT 'RECORDED_ONLY'
        CHECK (transfer_status IN ('RECORDED_ONLY', 'BANK_CONFIRMED')),
    transfer_confirmed_at TIMESTAMPTZ,
    idempotency_key VARCHAR(160) UNIQUE,
    payload_hash VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((transfer_status <> 'BANK_CONFIRMED') OR transfer_confirmed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_rms_refunds_bill ON public.restaurant_refunds (bill_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rms_refunds_merchant_created
    ON public.restaurant_refunds (merchant_id, created_at);

-- -----------------------------------------------------------------------------
-- 6. NEW ENTITY: RESTAURANT RECEIPTS (IMMUTABLE, WITH REPRINT ACCOUNTING)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.restaurant_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bill_id UUID NOT NULL REFERENCES public.restaurant_bills(id) ON DELETE CASCADE,
    merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
    receipt_number VARCHAR(60) NOT NULL UNIQUE,
    table_number VARCHAR(30),
    items_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    merchant_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    payment_instructions JSONB,
    subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    service_charge NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (service_charge >= 0),
    packaging_fee NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (packaging_fee >= 0),
    discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (paid_amount >= 0),
    refunded_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0),
    payment_status VARCHAR(30) NOT NULL,
    payments_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    print_count INTEGER NOT NULL DEFAULT 1 CHECK (print_count >= 1),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_printed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One canonical receipt per bill: the reprint path increments this row instead of
-- minting a second document with a different number.
CREATE UNIQUE INDEX IF NOT EXISTS restaurant_receipts_one_per_bill
    ON public.restaurant_receipts (bill_id);
CREATE INDEX IF NOT EXISTS idx_rms_receipts_merchant_issued
    ON public.restaurant_receipts (merchant_id, issued_at);

-- -----------------------------------------------------------------------------
-- 7. ADDITIVE COLUMNS: KDS TICKETS
-- -----------------------------------------------------------------------------

ALTER TABLE public.restaurant_kds_tickets
    ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER DEFAULT 20 CHECK (prep_time_minutes > 0),
    ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES public.restaurant_table_sessions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120);

-- One ticket per order: `createKdsTicket` used to mint a fresh random `KBD-####` on
-- every call, so a double-tap or a retry after a timeout produced two kitchen tickets
-- for one order.
DO $$
BEGIN
    CREATE UNIQUE INDEX restaurant_kds_tickets_one_per_order ON public.restaurant_kds_tickets (order_id);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Refusing 043: restaurant_kds_tickets holds two tickets for one order_id; resolve them before applying.';
END $$;
DO $$
BEGIN
    ALTER TABLE public.restaurant_kds_tickets ADD CONSTRAINT restaurant_kds_tickets_ticket_number_key UNIQUE (ticket_number);
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Refusing 043: restaurant_kds_tickets already holds duplicate ticket_number values; resolve them before applying.';
END $$;

-- -----------------------------------------------------------------------------
-- 8. ADDITIVE COLUMNS: RESERVATIONS AND STAFF
-- -----------------------------------------------------------------------------

ALTER TABLE public.restaurant_reservations
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_rms_reservations_table_time
    ON public.restaurant_reservations (merchant_id, table_id, reservation_time);

ALTER TABLE public.restaurant_staff
    ADD COLUMN IF NOT EXISTS role_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120);

-- -----------------------------------------------------------------------------
-- 9. ONE ACTIVE SESSION PER TABLE (DURABLE GUARD)
-- -----------------------------------------------------------------------------
-- `openTableSession` checked a process-local `currentSessionId` pointer, so two cashiers
-- tapping the same table at the same time created two sessions and only one of them was
-- ever findable again. The pointer is not the constraint; this index is.
DO $$
BEGIN
    CREATE UNIQUE INDEX restaurant_table_sessions_one_active_per_table
        ON public.restaurant_table_sessions (table_id)
        WHERE status IN ('ACTIVE', 'BILL_REQUESTED');
EXCEPTION
    WHEN duplicate_table THEN NULL;
    WHEN duplicate_object THEN NULL;
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Refusing 043: restaurant_table_sessions holds two un-closed sessions for one table; close or cancel them before applying.';
END $$;

-- -----------------------------------------------------------------------------
-- 10. LEGACY TENDER BACKFILL: restaurant_bills.payments JSONB -> ROWS
-- -----------------------------------------------------------------------------
-- The 041 JSONB column is left exactly as it is (nothing is discarded); this copy makes
-- the tenders queryable, unique-keyed and restart-proof. Entries that are not a positive
-- amount, or whose method is outside the allowed set, are mapped to 'OTHER' or skipped
-- rather than invented — the original array remains the legacy record either way.
INSERT INTO public.restaurant_bill_payments (
    id, bill_id, merchant_id, amount, effective_credited, change_due,
    payment_method, transaction_ref, recorded_by, verification_status, note, created_at
)
SELECT COALESCE(
           CASE WHEN p->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (p->>'id')::uuid END,
           gen_random_uuid()),
       b.id,
       b.merchant_id,
       ROUND((p->>'amount')::numeric, 2),
       ROUND(COALESCE((p->>'effectiveCredited')::numeric, (p->>'effective_credited')::numeric,
                      (p->>'amount')::numeric), 2),
       ROUND(COALESCE((p->>'change_due')::numeric, (p->>'changeDue')::numeric, 0), 2),
       CASE WHEN UPPER(COALESCE(p->>'paymentMethod', p->>'payment_method', 'CASH'))
                 IN ('CASH', 'UPI', 'CARD', 'WALLET', 'OTHER')
            THEN UPPER(COALESCE(p->>'paymentMethod', p->>'payment_method', 'CASH'))
            ELSE 'OTHER' END,
       NULLIF(COALESCE(p->>'transactionRef', p->>'transaction_ref', ''), ''),
       COALESCE(p->>'recordedBy', p->>'recorded_by'),
       'RECORDED',
       COALESCE(p->>'note', 'Backfilled from restaurant_bills.payments by migration 043'),
       COALESCE((p->>'recordedAt')::timestamptz, (p->>'recorded_at')::timestamptz, b.created_at, NOW())
  FROM public.restaurant_bills b,
       jsonb_array_elements(COALESCE(b.payments, '[]'::jsonb)) AS pe(p)
 WHERE jsonb_typeof(COALESCE(b.payments, '[]'::jsonb)) = 'array'
   AND (p->>'amount') ~ '^[0-9]+([.][0-9]{1,2})?$'
   AND (p->>'amount')::numeric > 0
   AND NOT EXISTS (SELECT 1 FROM public.restaurant_bill_payments rp WHERE rp.bill_id = b.id)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 11. BILL BASIS: PRICE/TAX/IDENTITY SNAPSHOT COMPUTED FROM DURABLE SOURCE ROWS
-- -----------------------------------------------------------------------------
-- One place decides what a dine-in bill is made of, and it reads only persisted rows:
-- line prices come from `order_lines` (018), rates and UPI identity come from the
-- `merchants` row AT THIS MOMENT. The bill then freezes the result, so this helper is
-- only ever called while a bill is being created — never when an old bill or receipt is
-- read back.
--
-- Two defects in the JavaScript this replaces are fixed here rather than copied:
--   - `settings.taxRatePercent || 5.0` turned a configured 0% GST into 5%. COALESCE keeps
--     an explicit 0 at 0.
--   - the merchant block fell back to 'NABIN Restaurant' / '124 Station Road'. A snapshot
--     of a merchant that has no address stores null, not an invented address.
-- Every object this function freezes carries both casings of a key (`unitPrice`/`unit_price`,
-- `upiId`/`upi_id`), because the bill and the receipt minted from it are read by camelCase API
-- consumers while the persisted columns are snake_case. A snapshot that carried only one casing
-- would silently drop the merchant's UPI identity from a reprint.
CREATE OR REPLACE FUNCTION public.rms_bill_basis(
    p_merchant_id uuid,
    p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_items        jsonb := '[]'::jsonb;
    v_subtotal     numeric(12, 2) := 0.00;
    v_tax          numeric(12, 2) := 0.00;
    v_service      numeric(12, 2) := 0.00;
    v_packaging    numeric(12, 2) := 0.00;
    v_total        numeric(12, 2) := 0.00;
    v_tax_rate     numeric(5, 2);
    v_service_rate numeric(5, 2);
    v_msnapshot    jsonb := '{}'::jsonb;
    v_pinstructions jsonb;
    v_session_total numeric(12, 2);
    v_found          boolean := false;
    m                merchants%ROWTYPE;
BEGIN
    WITH src AS (
        SELECT l.product_name_snapshot                AS name,
               l.quantity                             AS quantity,
               l.unit_snapshot                        AS unit,
               l.unit_price_snapshot                  AS unit_price,
               l.line_total                           AS line_total,
               l.order_id                             AS order_id,
               'ORDER_LINE'::text                     AS source,
               l.created_at                           AS occurred_at,
               l.id                                   AS src_id
          FROM public.order_lines l
          JOIN public.orders o ON o.id = l.order_id
         WHERE o.table_session_id = p_session_id
           AND o.merchant_id = p_merchant_id
        UNION ALL
        SELECT 'Dine-in order ' || COALESCE(o.order_number, o.id::text),
               1,
               'piece',
               o.total_amount,
               o.total_amount,
               o.id,
               'ORDER_TOTAL'::text,
               o.created_at,
               o.id
          FROM public.orders o
         WHERE o.table_session_id = p_session_id
           AND o.merchant_id = p_merchant_id
           AND NOT EXISTS (SELECT 1 FROM public.order_lines l WHERE l.order_id = o.id)
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'name', name, 'quantity', quantity, 'unit', unit,
                   'unitPrice', unit_price, 'unit_price', unit_price,
                   'lineTotal', line_total, 'line_total', line_total,
                   'orderId', order_id, 'order_id', order_id,
                   'source', source) ORDER BY occurred_at, src_id), '[]'::jsonb),
           ROUND(COALESCE(SUM(line_total), 0)::numeric, 2)
      INTO v_items, v_subtotal
      FROM src;

    -- A session opened before 043 (or one whose total was set directly) has no order rows
    -- but does carry a total; honour it instead of billing zero over the cashier's objection.
    IF v_items = '[]'::jsonb THEN
        SELECT COALESCE(s.total_amount, 0) INTO v_session_total
          FROM public.restaurant_table_sessions s
         WHERE s.id = p_session_id AND s.merchant_id = p_merchant_id;
        IF COALESCE(v_session_total, 0) > 0 THEN
            v_items := jsonb_build_array(jsonb_build_object(
                'name', 'Dine-in session total', 'quantity', 1, 'unit', 'piece',
                'unitPrice', v_session_total, 'unit_price', v_session_total,
                'lineTotal', v_session_total, 'line_total', v_session_total,
                'orderId', NULL, 'order_id', NULL, 'source', 'SESSION_TOTAL'));
            v_subtotal := ROUND(v_session_total, 2);
        END IF;
    END IF;

    SELECT * INTO m FROM public.merchants WHERE id = p_merchant_id;
    v_found := FOUND;
    v_tax_rate := COALESCE(m.tax_rate_percent, 5.00);
    v_service_rate := COALESCE(m.service_charge_percent, 0.00);

    IF v_found THEN
        v_msnapshot := jsonb_build_object(
            'name', m.name,
            'address', m.address,
            'phone', m.phone,
            'gstin', m.gstin,
            'upi_id', m.upi_id,
            'upiId', m.upi_id,
            'upi_qr_url', m.upi_qr_url,
            'upiQrUrl', m.upi_qr_url,
            'upi_merchant_name', m.upi_merchant_name,
            'tax_rate_percent', v_tax_rate,
            'service_charge_percent', v_service_rate);
        v_pinstructions := jsonb_build_object(
            'upiId', m.upi_id,
            'upi_id', m.upi_id,
            'upiQrUrl', m.upi_qr_url,
            'upi_qr_url', m.upi_qr_url,
            'instruction',
                CASE
                    WHEN COALESCE(m.upi_qr_url, '') <> ''
                        THEN 'Scan with your UPI app and enter the bill amount.'
                    WHEN COALESCE(m.upi_id, '') <> ''
                        THEN 'Pay via UPI to ' || m.upi_id
                    ELSE NULL
                END);
    END IF;

    v_tax := ROUND(v_subtotal * v_tax_rate / 100, 2);
    v_service := ROUND(v_subtotal * v_service_rate / 100, 2);
    -- Dine-in carries no packaging charge; the merchant's packaging_fee is a delivery
    -- order field and this basis only ever feeds a table bill.
    v_packaging := 0.00;
    v_total := ROUND(v_subtotal + v_tax + v_service + v_packaging, 2);

    RETURN jsonb_build_object(
        'items', v_items,
        'subtotal', v_subtotal,
        'tax_amount', v_tax,
        'service_charge', v_service,
        'packaging_fee', v_packaging,
        'discount_amount', 0.00,
        'total_amount', v_total,
        'tax_rate_percent', v_tax_rate,
        'service_charge_percent', v_service_rate,
        'merchant_snapshot', v_msnapshot,
        'payment_instructions', v_pinstructions);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 12. TABLE SESSION RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rms_open_table_session_atomic(
    p_merchant_id uuid,
    p_table_id uuid,
    p_guest_count integer DEFAULT NULL,
    p_opened_by text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_table   restaurant_tables%ROWTYPE;
    v_session restaurant_table_sessions%ROWTYPE;
BEGIN
    SELECT * INTO v_table FROM public.restaurant_tables
     WHERE id = p_table_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                  'message', 'Table not found.');
    END IF;

    SELECT * INTO v_session FROM public.restaurant_table_sessions
     WHERE table_id = v_table.id AND status IN ('ACTIVE', 'BILL_REQUESTED')
     ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
        IF v_table.current_session_id IS DISTINCT FROM v_session.id THEN
            UPDATE public.restaurant_tables
               SET current_session_id = v_session.id, status = 'OCCUPIED', updated_at = NOW()
             WHERE id = v_table.id;
        END IF;
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'data', to_jsonb(v_session));
    END IF;

    INSERT INTO public.restaurant_table_sessions
        (merchant_id, table_id, session_token, status, guest_count, opened_by, notes)
    VALUES (p_merchant_id, v_table.id,
            'sess_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
            'ACTIVE', GREATEST(1, COALESCE(p_guest_count, 2)),
            COALESCE(NULLIF(TRIM(p_opened_by), ''), 'Staff'), p_notes)
    RETURNING * INTO v_session;

    UPDATE public.restaurant_tables
       SET current_session_id = v_session.id, status = 'OCCUPIED', updated_at = NOW()
     WHERE id = v_table.id;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', to_jsonb(v_session));
END;
$function$;

-- Attaching an order is the step that used to live only in a Map: the session total moved,
-- the order row never learned which table it belonged to, and the pair diverged on restart.
-- Totals are recomputed from the durable `orders` rows instead of accumulated, so a replay
-- cannot double-count the same order.
CREATE OR REPLACE FUNCTION public.rms_attach_order_to_session_atomic(
    p_merchant_id uuid,
    p_session_id uuid,
    p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session restaurant_table_sessions%ROWTYPE;
    v_order   orders%ROWTYPE;
    v_total   numeric(12, 2);
    v_ids     jsonb;
BEGIN
    SELECT * INTO v_session FROM public.restaurant_table_sessions
     WHERE id = p_session_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND',
                                  'message', 'Session not found.');
    END IF;
    IF v_session.status NOT IN ('ACTIVE', 'BILL_REQUESTED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_ACTIVE',
                                  'message', 'Only an open session can take orders.',
                                  'status', v_session.status);
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurant_bills WHERE table_session_id = p_session_id
                 AND status <> 'VOIDED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_ALREADY_GENERATED',
                                  'message', 'A bill has already been generated for this session; '
                                  || 'settle or void it before adding more orders.');
    END IF;

    SELECT * INTO v_order FROM public.orders
     WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND',
                                  'message', 'Order not found.');
    END IF;
    IF v_order.table_session_id IS NOT NULL AND v_order.table_session_id <> p_session_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_ALREADY_ATTACHED',
                                  'message', 'Order is already attached to another table session.',
                                  'attachedTo', v_order.table_session_id);
    END IF;

    UPDATE public.orders
       SET table_session_id = p_session_id,
           table_id = v_session.table_id,
           order_channel = 'DINE_IN',
           updated_at = NOW()
     WHERE id = p_order_id;

    SELECT ROUND(COALESCE(SUM(total_amount), 0)::numeric, 2),
           COALESCE(jsonb_agg(id ORDER BY created_at), '[]'::jsonb)
      INTO v_total, v_ids
      FROM public.orders
     WHERE table_session_id = p_session_id;

    UPDATE public.restaurant_table_sessions
       SET total_amount = v_total,
           balance_amount = ROUND(GREATEST(v_total - paid_amount, 0), 2),
           updated_at = NOW()
     WHERE id = p_session_id
    RETURNING * INTO v_session;

    RETURN jsonb_build_object('success', true,
                              -- COALESCE: `v_order` was captured BEFORE the UPDATE, so on a first-time
                              -- attach the comparison is NULL = uuid and jsonb emits "duplicate": null
                              -- (measured on the live target). Every other rms_* RPC in this migration
                              -- answers a strict boolean here, and "not previously attached" IS false.
                              'duplicate', COALESCE(v_order.table_session_id = p_session_id, false),
                              'data', v_session,
                              'orderIds', v_ids);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rms_close_session_atomic(
    p_merchant_id uuid,
    p_session_id uuid,
    p_closed_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session  restaurant_table_sessions%ROWTYPE;
    v_table    restaurant_tables%ROWTYPE;
    v_refunded numeric(12, 2) := 0;
    v_balance  numeric(12, 2);
BEGIN
    SELECT * INTO v_session FROM public.restaurant_table_sessions
     WHERE id = p_session_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND',
                                  'message', 'Session not found.');
    END IF;

    IF v_session.status = 'CLOSED' THEN
        SELECT * INTO v_table FROM public.restaurant_tables WHERE id = v_session.table_id;
        RETURN jsonb_build_object('success', true, 'duplicate', true,
                                  'data', jsonb_build_object('session', to_jsonb(v_session),
                                                             'table', to_jsonb(v_table)));
    END IF;

    -- Balance = billed total - collected + refunded back. A refund reopens the bill, so it
    -- has to reopen the session too; closing over it would lose the money.
    SELECT ROUND(COALESCE(SUM(r.amount), 0)::numeric, 2) INTO v_refunded
      FROM public.restaurant_refunds r
      JOIN public.restaurant_bills b ON b.id = r.bill_id
     WHERE b.table_session_id = p_session_id;

    v_balance := ROUND(GREATEST(v_session.total_amount - v_session.paid_amount + v_refunded, 0), 2);
    IF v_balance > 0.01 THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNPAID_BALANCE',
                                  'message', 'Cannot close session with unpaid balance of ₹'
                                             || trim(to_char(v_balance, '9999999999D99')) || '.',
                                  'balanceAmount', v_balance);
    END IF;

    UPDATE public.restaurant_table_sessions
       SET status = 'CLOSED', closed_at = NOW(), balance_amount = 0.00,
           closed_by = COALESCE(NULLIF(TRIM(p_closed_by), ''), 'Staff'), updated_at = NOW()
     WHERE id = p_session_id
    RETURNING * INTO v_session;

    UPDATE public.restaurant_tables
       SET status = 'CLEANING', current_session_id = NULL, updated_at = NOW()
     WHERE id = v_session.table_id
    RETURNING * INTO v_table;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('session', to_jsonb(v_session),
                                                         'table', to_jsonb(v_table)));
END;
$function$;

-- Both tables are locked in id order, which is what makes a simultaneous A->B and B->A
-- transfer resolve into one winner and one clean refusal instead of a lost session.
CREATE OR REPLACE FUNCTION public.rms_transfer_session_atomic(
    p_merchant_id uuid,
    p_session_id uuid,
    p_target_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_lock    restaurant_tables%ROWTYPE;
    v_session restaurant_table_sessions%ROWTYPE;
    v_old     restaurant_tables%ROWTYPE;
    v_new     restaurant_tables%ROWTYPE;
    v_old_id  uuid;
    v_id      uuid;
BEGIN
    SELECT * INTO v_session FROM public.restaurant_table_sessions
     WHERE id = p_session_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND',
                                  'message', 'Session not found.');
    END IF;

    FOR v_id IN
        SELECT t.id FROM public.restaurant_tables t
         WHERE t.merchant_id = p_merchant_id
           AND t.id IN (v_session.table_id, p_target_table_id)
         ORDER BY t.id
    LOOP
        SELECT * INTO v_lock FROM public.restaurant_tables WHERE id = v_id FOR UPDATE;
    END LOOP;

    -- A bill freezes the table it was printed for (`restaurant_bills.table_id` /
    -- `table_number` are part of the snapshot), so moving the party after one exists would
    -- leave the printed bill naming a table the guests are no longer sitting at. The cashier
    -- must void and regenerate instead.
    IF v_session.status <> 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_ACTIVE',
                                  'message', 'Only active sessions can be transferred.');
    END IF;

    SELECT * INTO v_new FROM public.restaurant_tables
     WHERE id = p_target_table_id AND merchant_id = p_merchant_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                  'message', 'Target table not found.');
    END IF;
    IF v_new.id = v_session.table_id THEN
        RETURN jsonb_build_object('success', false, 'code', 'SAME_TABLE',
                                  'message', 'Target table must be different.');
    END IF;
    IF v_new.status NOT IN ('AVAILABLE', 'CLEANING') THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_AVAILABLE',
                                  'message', 'Target table ' || v_new.table_number
                                             || ' is currently ' || v_new.status || '.');
    END IF;

    v_old_id := v_session.table_id;

    UPDATE public.restaurant_table_sessions
       SET table_id = v_new.id,
           previous_table_id = v_old_id,
           transfer_count = transfer_count + 1,
           updated_at = NOW()
     WHERE id = p_session_id
    RETURNING * INTO v_session;

    UPDATE public.restaurant_tables
       SET status = 'CLEANING', current_session_id = NULL, updated_at = NOW()
     WHERE id = v_old_id
    RETURNING * INTO v_old;

    UPDATE public.restaurant_tables
       SET status = 'OCCUPIED', current_session_id = v_session.id, updated_at = NOW()
     WHERE id = v_new.id
    RETURNING * INTO v_new;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('session', to_jsonb(v_session),
                                                         'fromTable', to_jsonb(v_old),
                                                         'toTable', to_jsonb(v_new)));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 13. TABLE MAINTENANCE RPCs
-- -----------------------------------------------------------------------------
-- `updateTable`, `setTableStatus` and `regenerateTableQr` mutated the Map copy only, so a
-- renamed table, a cleared status or a reprinted QR sticker reverted on the next restart
-- while the floor plan kept showing the edit.

CREATE OR REPLACE FUNCTION public.rms_set_table_status_atomic(
    p_merchant_id uuid,
    p_table_id uuid,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_table   restaurant_tables%ROWTYPE;
    v_session restaurant_table_sessions%ROWTYPE;
BEGIN
    IF p_status NOT IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'ORDERING', 'BILL_REQUESTED', 'CLEANING') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TABLE_STATUS',
                                  'message', 'Invalid table status: ' || COALESCE(p_status, 'null')
                                             || '. Must be one of: AVAILABLE, OCCUPIED, RESERVED, '
                                             || 'ORDERING, BILL_REQUESTED, CLEANING');
    END IF;

    SELECT * INTO v_table FROM public.restaurant_tables
     WHERE id = p_table_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                  'message', 'Table not found.');
    END IF;

    IF p_status = 'AVAILABLE' AND v_table.current_session_id IS NOT NULL THEN
        SELECT * INTO v_session FROM public.restaurant_table_sessions
         WHERE id = v_table.current_session_id FOR UPDATE;
        IF FOUND AND v_session.status IN ('ACTIVE', 'BILL_REQUESTED')
           AND (v_session.total_amount > v_session.paid_amount OR v_session.balance_amount > 0.01) THEN
            RETURN jsonb_build_object('success', false, 'code', 'TABLE_SESSION_UNPAID',
                                      'message', 'Cannot set table AVAILABLE while active session '
                                              || 'has an unpaid balance. Settle bill or close session first.');
        END IF;
    END IF;

    UPDATE public.restaurant_tables
       SET status = p_status,
           current_session_id = CASE WHEN p_status = 'AVAILABLE' THEN NULL ELSE current_session_id END,
           updated_at = NOW()
     WHERE id = v_table.id
    RETURNING * INTO v_table;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_table));
END;
$function$;

CREATE OR REPLACE FUNCTION public.rms_update_table_atomic(
    p_merchant_id uuid,
    p_table_id uuid,
    p_table_number text DEFAULT NULL,
    p_name text DEFAULT NULL,
    p_capacity integer DEFAULT NULL,
    p_section_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_table restaurant_tables%ROWTYPE;
BEGIN
    SELECT * INTO v_table FROM public.restaurant_tables
     WHERE id = p_table_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                  'message', 'Table not found.');
    END IF;

    IF p_capacity IS NOT NULL AND p_capacity < 1 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_CAPACITY',
                                  'message', 'Table capacity must be at least 1.');
    END IF;

    IF p_table_number IS NOT NULL AND p_table_number <> v_table.table_number
       AND EXISTS (SELECT 1 FROM public.restaurant_tables t
                    WHERE t.merchant_id = p_merchant_id
                      AND t.table_number = p_table_number
                      AND t.id <> p_table_id) THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_ALREADY_EXISTS',
                                  'message', 'Table ' || p_table_number || ' already exists.');
    END IF;

    UPDATE public.restaurant_tables
       SET table_number = COALESCE(p_table_number, table_number),
           table_name   = COALESCE(p_name, table_name),
           capacity     = COALESCE(p_capacity, capacity),
           section_id   = COALESCE(p_section_id, section_id),
           updated_at   = NOW()
     WHERE id = v_table.id
    RETURNING * INTO v_table;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_table));
END;
$function$;

CREATE OR REPLACE FUNCTION public.rms_regenerate_table_qr_atomic(
    p_merchant_id uuid,
    p_table_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_table restaurant_tables%ROWTYPE;
    v_token text;
BEGIN
    SELECT * INTO v_table FROM public.restaurant_tables
     WHERE id = p_table_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                  'message', 'Table not found.');
    END IF;

    v_token := 'qr_' || substring(p_merchant_id::text from 1 for 8) || '_' || v_table.table_number
               || '_' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

    UPDATE public.restaurant_tables
       SET qr_code_token = v_token, updated_at = NOW()
     WHERE id = v_table.id
    RETURNING * INTO v_table;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('table', to_jsonb(v_table),
                                                         'qr_token', v_token));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 14. BILLING RPCs
-- -----------------------------------------------------------------------------
-- A bill is now created once, frozen once, and read back forever as it was written.
-- `getBillForSession` used to answer a NEW random invoice number on every call and to
-- rebuild `merchantDetails` / `paymentInstructions` from the merchant's CURRENT settings,
-- which is how a UPI ID changed last week silently repriced last week's reprint.

CREATE OR REPLACE FUNCTION public.rms_generate_bill_atomic(
    p_merchant_id uuid,
    p_session_id uuid,
    p_generated_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session restaurant_table_sessions%ROWTYPE;
    v_bill    restaurant_bills%ROWTYPE;
    v_basis   jsonb;
    v_invoice text;
BEGIN
    SELECT * INTO v_session FROM public.restaurant_table_sessions
     WHERE id = p_session_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND',
                                  'message', 'Session not found.');
    END IF;

    -- Idempotent: the session already has its bill, so hand that one back untouched.
    SELECT * INTO v_bill FROM public.restaurant_bills
     WHERE table_session_id = p_session_id FOR UPDATE;
    IF FOUND THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'data', to_jsonb(v_bill));
    END IF;

    IF v_session.status NOT IN ('ACTIVE', 'BILL_REQUESTED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_ACTIVE',
                                  'message', 'Only an open session can be billed.',
                                  'status', v_session.status);
    END IF;

    v_basis := public.rms_bill_basis(p_merchant_id, p_session_id);
    v_invoice := 'INV-' || EXTRACT(YEAR FROM NOW())::int || '-' ||
                 nextval('public.restaurant_invoice_number_seq');

    INSERT INTO public.restaurant_bills (
        merchant_id, table_session_id, table_id, table_number,
        subtotal, tax_amount, service_charge, packaging_fee, discount_amount, total_amount,
        paid_amount, refunded_amount, status, split_type, payments, splits,
        invoice_number, items_snapshot, merchant_snapshot, payment_instructions,
        generated_by, issued_at
    )
    SELECT p_merchant_id, v_session.id, v_session.table_id,
           (SELECT t.table_number FROM public.restaurant_tables t WHERE t.id = v_session.table_id),
           (v_basis->>'subtotal')::numeric, (v_basis->>'tax_amount')::numeric,
           (v_basis->>'service_charge')::numeric, (v_basis->>'packaging_fee')::numeric,
           (v_basis->>'discount_amount')::numeric, (v_basis->>'total_amount')::numeric,
           0.00, 0.00, 'UNPAID', 'NONE', '[]'::jsonb, '[]'::jsonb,
           v_invoice,
           COALESCE(v_basis->'items', '[]'::jsonb),
           COALESCE(v_basis->'merchant_snapshot', '{}'::jsonb),
           v_basis->'payment_instructions',
           COALESCE(NULLIF(TRIM(p_generated_by), ''), 'Staff'), NOW()
    RETURNING * INTO v_bill;

    UPDATE public.restaurant_table_sessions
       SET total_amount = v_bill.total_amount,
           balance_amount = v_bill.total_amount,
           status = 'BILL_REQUESTED',
           updated_at = NOW()
     WHERE id = p_session_id;

    UPDATE public.restaurant_tables
       SET status = 'BILL_REQUESTED', updated_at = NOW()
     WHERE id = v_session.table_id
       AND status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'ORDERING', 'CLEANING');

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_bill));
END;
$function$;

-- Splitting after money has arrived would silently forget which share was paid, so the
-- shares are only re-divisible while the bill is untouched.
CREATE OR REPLACE FUNCTION public.rms_split_bill_atomic(
    p_merchant_id uuid,
    p_bill_id uuid,
    p_ways integer DEFAULT 2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_bill      restaurant_bills%ROWTYPE;
    v_parts     integer;
    v_per_part  numeric(12, 2);
    v_remainder numeric(12, 2);
    v_splits    jsonb := '[]'::jsonb;
    v_share_count integer;
    i           integer;
BEGIN
    SELECT * INTO v_bill FROM public.restaurant_bills
     WHERE id = p_bill_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_NOT_FOUND',
                                  'message', 'Bill not found.');
    END IF;

    -- CASE, not AND/OR: expression order is unspecified in SQL, so a plain
    -- `jsonb_typeof(...) AND jsonb_array_length(...)` guard could still evaluate the
    -- length call on a non-array and raise 22P02 instead of answering BILL_HAS_PAYMENTS.
    v_share_count := CASE WHEN jsonb_typeof(v_bill.splits) = 'array'
                          THEN jsonb_array_length(v_bill.splits)
                          ELSE 0 END;
    IF v_bill.paid_amount > 0 OR v_bill.refunded_amount > 0 OR v_share_count > 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_HAS_PAYMENTS',
                                  'message', 'Cannot re-split a bill that already has payments or shares recorded.');
    END IF;

    v_parts := GREATEST(2, COALESCE(p_ways, 2));
    v_per_part := ROUND(v_bill.total_amount / v_parts, 2);
    v_remainder := ROUND(v_bill.total_amount - v_per_part * v_parts, 2);

    FOR i IN 1..v_parts LOOP
        v_splits := v_splits || jsonb_build_object(
            'partNumber', i, 'split_index', i,
            'amount', CASE WHEN i = 1 THEN ROUND(v_per_part + v_remainder, 2) ELSE v_per_part END,
            'isPaid', false, 'is_paid', false, 'paidAt', NULL, 'paid_at', NULL);
    END LOOP;

    UPDATE public.restaurant_bills
       SET splits = v_splits, split_type = 'EQUAL', updated_at = NOW()
     WHERE id = v_bill.id
    RETURNING * INTO v_bill;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('bill', to_jsonb(v_bill),
                                                         'splits', v_splits));
END;
$function$;

-- Each tender is a row, so the balance survives a restart and a re-run. Two rules the
-- in-memory version could not enforce are enforced here: a reference recorded twice on
-- the same bill is refused by a unique index, and only CASH tender may exceed the balance
-- (as change). A UPI/CARD over-credit would be money the restaurant holds but never billed.
CREATE OR REPLACE FUNCTION public.rms_record_bill_payment_atomic(
    p_merchant_id uuid,
    p_bill_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT 'CASH',
    p_transaction_ref text DEFAULT NULL,
    p_recorded_by text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_bill     restaurant_bills%ROWTYPE;
    v_existing restaurant_bill_payments%ROWTYPE;
    v_payment  restaurant_bill_payments%ROWTYPE;
    v_method   text;
    v_balance  numeric(12, 2);
    v_credited numeric(12, 2);
    v_change   numeric(12, 2) := 0.00;
    v_paid     numeric(12, 2);
    v_refunded numeric(12, 2);
    v_status   text;
BEGIN
    v_method := UPPER(TRIM(COALESCE(p_payment_method, 'CASH')));
    IF v_method NOT IN ('CASH', 'UPI', 'CARD', 'WALLET', 'OTHER') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_PAYMENT_METHOD',
                                  'message', 'Invalid payment method: ' || COALESCE(p_payment_method, 'null')
                                             || '. Must be one of: CASH, UPI, CARD, WALLET, OTHER');
    END IF;

    -- Replay of the same request: answer the recorded tender, do not credit it twice.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.restaurant_bill_payments
         WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            SELECT * INTO v_bill FROM public.restaurant_bills WHERE id = v_existing.bill_id;
            RETURN jsonb_build_object('success', true, 'duplicate', true,
                                      'data', jsonb_build_object('bill', to_jsonb(v_bill),
                                                                 'payment', to_jsonb(v_existing)));
        END IF;
    END IF;

    SELECT * INTO v_bill FROM public.restaurant_bills
     WHERE id = p_bill_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_NOT_FOUND',
                                  'message', 'Bill not found.');
    END IF;

    v_balance := ROUND(v_bill.total_amount - v_bill.paid_amount + v_bill.refunded_amount, 2);
    IF v_bill.status = 'PAID' OR v_balance <= 0.01 THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_ALREADY_PAID',
                                  'message', 'Bill is already fully settled.');
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT',
                                  'message', 'Payment amount must be greater than zero.');
    END IF;

    IF NULLIF(TRIM(COALESCE(p_transaction_ref, '')), '') IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.restaurant_bill_payments p
                    WHERE p.bill_id = v_bill.id
                      AND NULLIF(TRIM(COALESCE(p.transaction_ref, '')), '') = TRIM(p_transaction_ref)) THEN
        RETURN jsonb_build_object('success', false, 'code', 'DUPLICATE_PAYMENT',
                                  'message', 'Payment reference ''' || TRIM(p_transaction_ref)
                                             || ''' has already been recorded for this bill.');
    END IF;

    v_credited := ROUND(p_amount, 2);
    IF v_credited > v_balance THEN
        IF v_method = 'CASH' THEN
            v_change := ROUND(v_credited - v_balance, 2);
            v_credited := v_balance;
        ELSE
            RETURN jsonb_build_object('success', false, 'code', 'OVERPAYMENT_NOT_ALLOWED',
                                      'message', 'A ' || v_method || ' tender cannot exceed the outstanding '
                                              || 'balance of ₹' || trim(to_char(v_balance, '9999999999D99'))
                                              || '. Record cash for change, or settle the exact amount.',
                                      'balanceAmount', v_balance);
        END IF;
    END IF;

    INSERT INTO public.restaurant_bill_payments (
        bill_id, merchant_id, amount, effective_credited, change_due, payment_method,
        transaction_ref, recorded_by, verification_status, note, idempotency_key
    )
    VALUES (v_bill.id, p_merchant_id, ROUND(p_amount, 2), v_credited, v_change, v_method,
            NULLIF(TRIM(COALESCE(p_transaction_ref, '')), ''),
            COALESCE(NULLIF(TRIM(p_recorded_by), ''), 'Cashier'),
            'RECORDED',
            CASE WHEN v_method = 'UPI' THEN 'Staff recorded direct UPI payment (not bank verified)'
                 ELSE 'Staff recorded payment' END,
            p_idempotency_key)
    RETURNING * INTO v_payment;

    -- paid_amount is what the restaurant actually collected; refunds live in their own rows.
    v_paid := ROUND(v_bill.paid_amount + v_credited, 2);
    v_refunded := v_bill.refunded_amount;
    v_status := CASE WHEN ROUND(v_bill.total_amount - v_paid + v_refunded, 2) <= 0.01
                     THEN 'PAID' ELSE 'PARTIALLY_PAID' END;

    UPDATE public.restaurant_bills
       SET paid_amount = v_paid,
           status = v_status,
           updated_at = NOW()
     WHERE id = v_bill.id
    RETURNING * INTO v_bill;

    -- Derived from the post-update bill row, not from another increment: rms_generate_bill
    -- already pinned session.total_amount to the bill total, so this is what makes the
    -- UNPAID_BALANCE guard in rms_close_session_atomic agree with what the cashier saw.
    UPDATE public.restaurant_table_sessions
       SET paid_amount = v_bill.paid_amount,
           balance_amount = ROUND(GREATEST(v_bill.total_amount - v_bill.paid_amount
                                           + v_bill.refunded_amount, 0), 2),
           updated_at = NOW()
     WHERE id = v_bill.table_session_id;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('bill', to_jsonb(v_bill),
                                                         'payment', to_jsonb(v_payment)));
END;
$function$;

-- A refund is an audit event, not a payout: transfer_status stays 'RECORDED_ONLY' and the
-- response carries no gateway reference, because nothing here talks to a bank or a switch.
CREATE OR REPLACE FUNCTION public.rms_record_bill_refund_atomic(
    p_merchant_id uuid,
    p_bill_id uuid,
    p_amount numeric,
    p_reason text DEFAULT NULL,
    p_refund_method text DEFAULT 'CASH',
    p_recorded_by text DEFAULT NULL,
    p_transfer_reference text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_bill    restaurant_bills%ROWTYPE;
    v_refund  restaurant_refunds%ROWTYPE;
    v_existing restaurant_refunds%ROWTYPE;
    v_method  text;
    v_collected numeric(12, 2);
    v_hash    text;
BEGIN
    IF TRIM(COALESCE(p_reason, '')) = '' THEN
        RETURN jsonb_build_object('success', false, 'code', 'REFUND_REASON_REQUIRED',
                                  'message', 'A refund must state a reason.');
    END IF;

    v_method := UPPER(TRIM(COALESCE(p_refund_method, 'CASH')));
    IF v_method NOT IN ('CASH', 'UPI', 'CARD', 'WALLET', 'OTHER') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_REFUND_METHOD',
                                  'message', 'Invalid refund method: ' || COALESCE(p_refund_method, 'null'));
    END IF;

    v_hash := md5(jsonb_build_object('bill', p_bill_id, 'amount', p_amount,
                                     'method', v_method, 'reason', TRIM(p_reason))::text);

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.restaurant_refunds
         WHERE idempotency_key = p_idempotency_key;
        IF FOUND THEN
            IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN
                RETURN jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_CONFLICT',
                                          'message', 'This refund key was already used for a different refund.');
            END IF;
            SELECT * INTO v_bill FROM public.restaurant_bills WHERE id = v_existing.bill_id;
            RETURN jsonb_build_object('success', true, 'duplicate', true,
                                      'data', jsonb_build_object('bill', to_jsonb(v_bill),
                                                                 'refund', to_jsonb(v_existing)));
        END IF;
    END IF;

    SELECT * INTO v_bill FROM public.restaurant_bills
     WHERE id = p_bill_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'BILL_NOT_FOUND',
                                  'message', 'Bill not found.');
    END IF;

    v_collected := ROUND(v_bill.paid_amount - v_bill.refunded_amount, 2);
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_AMOUNT',
                                  'message', 'Refund amount must be greater than zero.');
    END IF;
    IF ROUND(p_amount, 2) > v_collected THEN
        RETURN jsonb_build_object('success', false, 'code', 'REFUND_EXCEEDS_PAID',
                                  'message', 'Refund amount ₹' || trim(to_char(ROUND(p_amount, 2), '9999999999D99'))
                                          || ' exceeds recorded paid amount ₹'
                                          || trim(to_char(v_collected, '9999999999D99')) || '.');
    END IF;

    INSERT INTO public.restaurant_refunds (
        bill_id, merchant_id, amount, refund_method, reason, recorded_by,
        transfer_reference, transfer_status, idempotency_key, payload_hash
    )
    VALUES (v_bill.id, p_merchant_id, ROUND(p_amount, 2), v_method, TRIM(p_reason),
            COALESCE(NULLIF(TRIM(p_recorded_by), ''), 'Manager'),
            NULLIF(TRIM(COALESCE(p_transfer_reference, '')), ''),
            'RECORDED_ONLY', p_idempotency_key, v_hash)
    RETURNING * INTO v_refund;

    -- The tender stays as it was collected; the refund accumulates beside it, so the bill
    -- keeps both facts instead of rewriting history. The status is recomputed from those
    -- same three facts: a refund that reopens a balance has to move the bill off 'PAID',
    -- or rms_record_bill_payment_atomic would refuse the tender that settles it. Only the
    -- four values the 041 CHECK allows are ever written — a refund is not a fifth status.
    UPDATE public.restaurant_bills
       SET refunded_amount = ROUND(refunded_amount + v_refund.amount, 2),
           status = CASE
               WHEN ROUND(total_amount - paid_amount + refunded_amount + v_refund.amount, 2) <= 0.01
                   THEN 'PAID'::text
               WHEN ROUND(paid_amount - (refunded_amount + v_refund.amount), 2) > 0
                   THEN 'PARTIALLY_PAID'::text
               ELSE 'UNPAID'::text
           END,
           updated_at = NOW()
     WHERE id = v_bill.id
    RETURNING * INTO v_bill;

    -- The session has no refunded_amount column of its own (measured on the local target:
    -- its money columns are total_amount / paid_amount / balance_amount), so the reopened
    -- balance is read off the just-updated bill row instead.
    UPDATE public.restaurant_table_sessions
       SET balance_amount = ROUND(GREATEST(v_bill.total_amount - v_bill.paid_amount
                                           + v_bill.refunded_amount, 0), 2),
           updated_at = NOW()
     WHERE id = v_bill.table_session_id;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object('bill', to_jsonb(v_bill),
                                                         'refund', to_jsonb(v_refund)));
END;
$function$;

-- The receipt document. First call on a settled bill mints the row with its real issue
-- time; every later call reprints THAT row and increments print_count, so a reprint of
-- last week's bill still shows last week's UPI ID, prices and issue timestamp. A bill that
-- is not settled produces a provisional preview and no row — no fake receipt record.
CREATE OR REPLACE FUNCTION public.rms_get_bill_receipt_atomic(
    p_merchant_id uuid,
    p_bill_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_bill    restaurant_bills%ROWTYPE;
    v_receipt restaurant_receipts%ROWTYPE;
    v_payments jsonb;
    v_refunds  jsonb;
    v_balance  numeric(12, 2);
    v_frozen   numeric(12, 2);
    v_settled  boolean;
    v_doc      jsonb;
BEGIN
    SELECT * INTO v_bill FROM public.restaurant_bills
     WHERE id = p_bill_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'RECEIPT_NOT_FOUND',
                                  'message', 'Bill not found.');
    END IF;

    v_balance := GREATEST(0.00,
                 ROUND(v_bill.total_amount - v_bill.paid_amount + v_bill.refunded_amount, 2));
    v_settled := v_bill.status = 'PAID' AND v_balance <= 0.01;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', p.id, 'amount', p.amount, 'effectiveCredited', p.effective_credited,
               'method', p.payment_method, 'reference', p.transaction_ref,
               'changeDue', p.change_due, 'recordedBy', p.recorded_by,
               'timestamp', p.created_at, 'note', p.note,
               'verificationStatus', p.verification_status) ORDER BY p.created_at), '[]'::jsonb)
      INTO v_payments
      FROM public.restaurant_bill_payments p
     WHERE p.bill_id = v_bill.id;

    -- The refund annex is built only after the document row is known (below), because a printed
    -- receipt must carry the refunds that existed when it was issued, not every refund that
    -- exists when it is reprinted.
    SELECT * INTO v_receipt FROM public.restaurant_receipts
     WHERE bill_id = v_bill.id FOR UPDATE;

    IF NOT FOUND AND v_settled THEN
        INSERT INTO public.restaurant_receipts (
            bill_id, merchant_id, receipt_number, table_number,
            items_snapshot, merchant_snapshot, payment_instructions,
            subtotal, tax_amount, service_charge, packaging_fee, discount_amount,
            total_amount, paid_amount, refunded_amount, payment_status, payments_snapshot,
            print_count, issued_at, last_printed_at
        )
        VALUES (v_bill.id, v_bill.merchant_id,
                'REC-' || COALESCE(v_bill.invoice_number, v_bill.id::text),
                v_bill.table_number,
                v_bill.items_snapshot, v_bill.merchant_snapshot, v_bill.payment_instructions,
                v_bill.subtotal, v_bill.tax_amount, v_bill.service_charge, v_bill.packaging_fee,
                v_bill.discount_amount, v_bill.total_amount, v_bill.paid_amount,
                v_bill.refunded_amount, v_bill.status, v_payments,
                1, NOW(), NOW())
        RETURNING * INTO v_receipt;
    ELSIF FOUND THEN
        UPDATE public.restaurant_receipts
           SET print_count = print_count + 1, last_printed_at = NOW(), updated_at = NOW()
         WHERE id = v_receipt.id
        RETURNING * INTO v_receipt;
    END IF;

    -- Refunds as at this document's issue time. A provisional preview has no row and no issue
    -- time, so it shows the live position — it is labelled provisional for exactly that reason.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', r.id, 'amount', r.amount, 'reason', r.reason, 'recordedBy', r.recorded_by,
               'method', r.refund_method, 'transferStatus', r.transfer_status,
               'disclaimer', 'RECORDED EVENT ONLY: This records the refund in RMS records and '
                             || 'does not initiate a banking or UPI transfer.',
               'recordedAt', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
      INTO v_refunds
      FROM public.restaurant_refunds r
     WHERE r.bill_id = v_bill.id
       AND (v_receipt.id IS NULL OR r.created_at <= v_receipt.issued_at);

    IF v_receipt.id IS NOT NULL THEN
        -- Every money figure below is read off the frozen row, never off the live bill and never
        -- written as a literal: a reprint has to say what was true when it was printed, including
        -- a bill that was later reopened or refunded.
        v_frozen := GREATEST(0.00, ROUND(v_receipt.total_amount - v_receipt.paid_amount
                                         + v_receipt.refunded_amount, 2));
        v_doc := jsonb_build_object(
            'receiptNumber', v_receipt.receipt_number,
            'billId', v_receipt.bill_id,
            'invoiceNumber', v_bill.invoice_number,
            'tableNumber', v_receipt.table_number,
            'orderChannel', 'DINE_IN',
            'merchantDetails', v_receipt.merchant_snapshot,
            'merchant_details', v_receipt.merchant_snapshot,
            'items', v_receipt.items_snapshot,
            'subtotal', v_receipt.subtotal,
            'taxAmount', v_receipt.tax_amount, 'tax_amount', v_receipt.tax_amount,
            'serviceCharge', v_receipt.service_charge, 'service_charge_amount', v_receipt.service_charge,
            'packagingFee', v_receipt.packaging_fee, 'packaging_fee_amount', v_receipt.packaging_fee,
            'discountAmount', v_receipt.discount_amount, 'discount_amount', v_receipt.discount_amount,
            'totalAmount', v_receipt.total_amount, 'total_amount', v_receipt.total_amount,
            'paidAmount', v_receipt.paid_amount, 'paid_amount', v_receipt.paid_amount,
            'refundedAmount', v_receipt.refunded_amount,
            'balanceAmount', v_frozen, 'balance_amount', v_frozen,
            'isFullyPaid', v_frozen <= 0.00,
            'paymentStatus', v_receipt.payment_status,
            'statusText', CASE WHEN v_frozen <= 0.00 THEN 'PAID IN FULL'
                              ELSE 'BALANCE DUE: ₹'
                                   || trim(to_char(v_frozen, '9999999999D99'))
                         END,
            'paymentInstructions', v_receipt.payment_instructions,
            'payment_instructions', v_receipt.payment_instructions,
            'payments', v_receipt.payments_snapshot,
            'refunds', v_refunds,
            'provisional', false,
            'reprinted', v_receipt.print_count > 1,
            'printCount', v_receipt.print_count,
            'issuedAt', v_receipt.issued_at,
            'lastPrintedAt', v_receipt.last_printed_at);
    ELSE
        v_doc := jsonb_build_object(
            'receiptNumber', 'REC-' || COALESCE(v_bill.invoice_number, v_bill.id::text),
            'billId', v_bill.id,
            'invoiceNumber', v_bill.invoice_number,
            'tableNumber', v_bill.table_number,
            'orderChannel', 'DINE_IN',
            'merchantDetails', v_bill.merchant_snapshot,
            'merchant_details', v_bill.merchant_snapshot,
            'items', v_bill.items_snapshot,
            'subtotal', v_bill.subtotal,
            'taxAmount', v_bill.tax_amount, 'tax_amount', v_bill.tax_amount,
            'serviceCharge', v_bill.service_charge, 'service_charge_amount', v_bill.service_charge,
            'packagingFee', v_bill.packaging_fee, 'packaging_fee_amount', v_bill.packaging_fee,
            'discountAmount', v_bill.discount_amount, 'discount_amount', v_bill.discount_amount,
            'totalAmount', v_bill.total_amount, 'total_amount', v_bill.total_amount,
            'paidAmount', v_bill.paid_amount, 'paid_amount', v_bill.paid_amount,
            'refundedAmount', v_bill.refunded_amount,
            'balanceAmount', v_balance, 'balance_amount', v_balance,
            'isFullyPaid', false,
            'paymentStatus', v_bill.status,
            'statusText', 'BALANCE DUE: ₹' || trim(to_char(v_balance, '9999999999D99')),
            'paymentInstructions', v_bill.payment_instructions,
            'payment_instructions', v_bill.payment_instructions,
            'payments', v_payments,
            'refunds', v_refunds,
            'provisional', true,
            'reprinted', false,
            'printCount', 0,
            'issuedAt', NOW());
    END IF;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', v_doc);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 15. STAFF: KEEP THE PUBLIC CONTRACT WHEN THE COLUMN CANNOT HOLD IT
-- -----------------------------------------------------------------------------
-- 041 made `restaurant_staff.phone` NOT NULL while `createStaff` accepted a name and a
-- role with no phone (`phone: phone || null`). Requiring the phone now would be an API
-- contract change nobody asked for, and inventing one would be a fabricated contact
-- number, so the column follows the code instead.
ALTER TABLE public.restaurant_staff ALTER COLUMN phone DROP NOT NULL;

-- -----------------------------------------------------------------------------
-- 16. KITCHEN DISPLAY RPCs
-- -----------------------------------------------------------------------------
-- `createKdsTicket` minted `KBD-${random 1000..9999}` per call and kept the ticket only in
-- a Map, so a retry produced a second kitchen ticket for the same order and a restart
-- emptied the board. Ticket numbers now come from a sequence, one ticket per order is a
-- unique index, and the item list is read from the durable `order_lines`.
CREATE OR REPLACE FUNCTION public.rms_create_kds_ticket_atomic(
    p_merchant_id uuid,
    p_order_id uuid,
    p_channel text DEFAULT NULL,
    p_table_number text DEFAULT NULL,
    p_prep_time_minutes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order  orders%ROWTYPE;
    v_ticket restaurant_kds_tickets%ROWTYPE;
    v_channel text;
    v_items  jsonb;
BEGIN
    SELECT * INTO v_order FROM public.orders
     WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND',
                                  'message', 'Order not found for this restaurant.');
    END IF;

    v_channel := UPPER(COALESCE(NULLIF(TRIM(p_channel), ''), v_order.order_channel, 'DELIVERY'));
    IF v_channel NOT IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY') THEN
        v_channel := 'DELIVERY';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'name', l.product_name_snapshot, 'dish_name', l.product_name_snapshot,
               'quantity', l.quantity, 'unit', l.unit_snapshot,
               'unitPrice', l.unit_price_snapshot, 'unit_price_snapshot', l.unit_price_snapshot,
               'lineTotal', l.line_total, 'line_total', l.line_total) ORDER BY l.created_at),
           '[]'::jsonb)
      INTO v_items
      FROM public.order_lines l
     WHERE l.order_id = v_order.id AND l.merchant_id = p_merchant_id;

    IF v_items = '[]'::jsonb THEN
        v_items := COALESCE(v_order.items_snapshot, '[]'::jsonb);
    END IF;

    INSERT INTO public.restaurant_kds_tickets (
        merchant_id, order_id, ticket_number, channel, table_number, table_session_id,
        status, items_snapshot, prep_time_minutes
    )
    VALUES (p_merchant_id, v_order.id,
            'KBD-' || nextval('public.restaurant_kds_ticket_number_seq'),
            v_channel,
            COALESCE(NULLIF(TRIM(p_table_number), ''),
                     (SELECT t.table_number FROM public.restaurant_tables t
                       WHERE t.id = v_order.table_id)),
            v_order.table_session_id,
            'NEW', v_items,
            GREATEST(1, COALESCE(p_prep_time_minutes, 20)))
    ON CONFLICT (order_id) DO NOTHING
    RETURNING * INTO v_ticket;

    IF v_ticket.id IS NULL THEN
        SELECT * INTO v_ticket FROM public.restaurant_kds_tickets WHERE order_id = v_order.id;
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'data', to_jsonb(v_ticket));
    END IF;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_ticket));
END;
$function$;

-- The kitchen board has one direction: NEW -> PREPARING -> READY -> SERVED, with
-- CANCELLED reachable from any live state. The Map version accepted any status string, so
-- a ticket could jump from NEW to SERVED or come back from CANCELLED.
CREATE OR REPLACE FUNCTION public.rms_update_kds_ticket_status_atomic(
    p_merchant_id uuid,
    p_ticket_id uuid,
    p_status text,
    p_updated_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_ticket restaurant_kds_tickets%ROWTYPE;
    v_next   text := UPPER(TRIM(COALESCE(p_status, '')));
BEGIN
    IF v_next NOT IN ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TICKET_STATUS',
                                  'message', 'Invalid KDS status: ' || COALESCE(p_status, 'null'));
    END IF;

    SELECT * INTO v_ticket FROM public.restaurant_kds_tickets
     WHERE id = p_ticket_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND',
                                  'message', 'Ticket not found.');
    END IF;

    IF v_ticket.status = v_next THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'data', to_jsonb(v_ticket));
    END IF;

    IF v_ticket.status = 'CANCELLED'
       OR (v_ticket.status = 'SERVED')
       OR (v_next = 'NEW')
       OR (v_next = 'PREPARING' AND v_ticket.status <> 'NEW')
       OR (v_next = 'READY' AND v_ticket.status <> 'PREPARING')
       OR (v_next = 'SERVED' AND v_ticket.status <> 'READY') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TICKET_TRANSITION',
                                  'message', 'Cannot move ticket from ' || v_ticket.status || ' to ' || v_next || '.',
                                  'status', v_ticket.status);
    END IF;

    UPDATE public.restaurant_kds_tickets
       SET status = v_next,
           status_changed_at = NOW(),
           updated_by = COALESCE(NULLIF(TRIM(p_updated_by), ''), 'Kitchen'),
           updated_at = NOW(),
           prep_started_at = CASE WHEN v_next = 'PREPARING' THEN COALESCE(prep_started_at, NOW()) ELSE prep_started_at END,
           ready_at        = CASE WHEN v_next = 'READY' THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
           served_at       = CASE WHEN v_next = 'SERVED' THEN COALESCE(served_at, NOW()) ELSE served_at END
     WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_ticket));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 17. TAKEAWAY HANDOVER
-- -----------------------------------------------------------------------------
-- Two fabrications removed: the Map path invented an order (`total_amount: 320`) when the
-- id was unknown so the route could answer 200, and it wrote `order_state = 'COLLECTED'`,
-- a value the 018 CHECK has never allowed. The durable version only marks a real order's
-- handover columns and reports 'COLLECTED' as a derived view of `handover_at`.
CREATE OR REPLACE FUNCTION public.rms_record_takeaway_handover_atomic(
    p_merchant_id uuid,
    p_order_id uuid,
    p_handover_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_order orders%ROWTYPE;
    v_by    text;
BEGIN
    SELECT * INTO v_order FROM public.orders
     WHERE id = p_order_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_FOUND',
                                  'message', 'Order not found for this restaurant.');
    END IF;

    IF v_order.handover_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'duplicate', true,
                                  'code', 'ALREADY_COLLECTED',
                                  'message', 'Order has already been collected.',
                                  'data', jsonb_build_object(
                                      'orderId', v_order.id, 'order_id', v_order.id,
                                      'handover_by', v_order.handover_by, 'handoverBy', v_order.handover_by,
                                      'handover_at', v_order.handover_at, 'handoverAt', v_order.handover_at,
                                      'order_state', v_order.order_state, 'status', 'COLLECTED'));
    END IF;

    IF v_order.order_state IN ('REJECTED', 'CANCELLED') THEN
        RETURN jsonb_build_object('success', false, 'code', 'ORDER_NOT_COLLECTABLE',
                                  'message', 'A ' || LOWER(v_order.order_state) || ' order cannot be handed over.',
                                  'orderState', v_order.order_state);
    END IF;

    v_by := COALESCE(NULLIF(TRIM(p_handover_by), ''), 'Counter Staff');

    UPDATE public.orders
       SET handover_by = v_by, handover_at = NOW(), updated_at = NOW()
     WHERE id = v_order.id;

    RETURN jsonb_build_object('success', true, 'duplicate', false,
                              'data', jsonb_build_object(
                                  'orderId', v_order.id, 'order_id', v_order.id,
                                  'handover_by', v_by, 'handoverBy', v_by,
                                  'handover_at', NOW(), 'handoverAt', NOW(),
                                  'order_state', v_order.order_state, 'status', 'COLLECTED',
                                  'order_channel', COALESCE(v_order.order_channel, 'DELIVERY')));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 18. RESERVATIONS
-- -----------------------------------------------------------------------------
-- The conflict scan ran over a process-local list, so a second process could book the same
-- table into the same window. An advisory lock on the table id serialises bookings for one
-- table, and the status write now follows a declared ladder.
CREATE OR REPLACE FUNCTION public.rms_create_reservation_atomic(
    p_merchant_id uuid,
    p_table_id uuid,
    p_customer_name text,
    p_customer_phone text,
    p_party_size integer,
    p_reservation_time timestamptz,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_table restaurant_tables%ROWTYPE;
    v_res   restaurant_reservations%ROWTYPE;
    v_size  integer;
BEGIN
    IF TRIM(COALESCE(p_customer_name, '')) = '' OR TRIM(COALESCE(p_customer_phone, '')) = ''
       OR p_reservation_time IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'REQUIRED_FIELDS',
                                  'message', 'customerName, customerPhone, and reservationTime are required.');
    END IF;

    v_size := GREATEST(1, COALESCE(p_party_size, 2));

    IF p_table_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('rms_reservation:' || p_table_id::text));

        SELECT * INTO v_table FROM public.restaurant_tables
         WHERE id = p_table_id AND merchant_id = p_merchant_id FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND',
                                      'message', 'Assigned table not found.');
        END IF;
        IF v_size > v_table.capacity THEN
            RETURN jsonb_build_object('success', false, 'code', 'PARTY_EXCEEDS_CAPACITY',
                                      'message', 'Party size ' || v_size || ' exceeds table capacity '
                                              || v_table.capacity || '.');
        END IF;

        IF EXISTS (SELECT 1 FROM public.restaurant_reservations r
                    WHERE r.merchant_id = p_merchant_id
                      AND r.table_id = p_table_id
                      AND r.status <> 'CANCELLED'
                      AND ABS(EXTRACT(EPOCH FROM (r.reservation_time - p_reservation_time))) < 7200) THEN
            RETURN jsonb_build_object('success', false, 'code', 'RESERVATION_CONFLICT',
                                      'message', 'Table ' || v_table.table_number
                                              || ' is already reserved around that time.');
        END IF;
    END IF;

    INSERT INTO public.restaurant_reservations (
        merchant_id, table_id, customer_name, customer_phone, party_size,
        reservation_time, status, notes, status_changed_at
    )
    VALUES (p_merchant_id, p_table_id, TRIM(p_customer_name), TRIM(p_customer_phone), v_size,
            p_reservation_time, 'CONFIRMED', p_notes, NOW())
    RETURNING * INTO v_res;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_res));
END;
$function$;

CREATE OR REPLACE FUNCTION public.rms_update_reservation_status_atomic(
    p_merchant_id uuid,
    p_reservation_id uuid,
    p_status text,
    p_updated_by text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_res  restaurant_reservations%ROWTYPE;
    v_next text := UPPER(TRIM(COALESCE(p_status, '')));
BEGIN
    IF v_next NOT IN ('PENDING', 'CONFIRMED', 'SEATED', 'CANCELLED', 'NO_SHOW') THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_RESERVATION_STATUS',
                                  'message', 'Invalid reservation status: ' || COALESCE(p_status, 'null'));
    END IF;

    SELECT * INTO v_res FROM public.restaurant_reservations
     WHERE id = p_reservation_id AND merchant_id = p_merchant_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'RESERVATION_NOT_FOUND',
                                  'message', 'Reservation not found.');
    END IF;

    IF v_res.status = v_next THEN
        RETURN jsonb_build_object('success', true, 'duplicate', true, 'data', to_jsonb(v_res));
    END IF;

    IF NOT ((v_res.status = 'PENDING'    AND v_next IN ('CONFIRMED', 'CANCELLED', 'NO_SHOW'))
         OR (v_res.status = 'CONFIRMED'  AND v_next IN ('SEATED', 'CANCELLED', 'NO_SHOW'))
         OR (v_res.status = 'SEATED'     AND v_next IN ('CANCELLED'))) THEN
        RETURN jsonb_build_object('success', false, 'code', 'INVALID_TRANSITION',
                                  'message', 'Cannot move reservation from ' || v_res.status
                                          || ' to ' || v_next || '.',
                                  'status', v_res.status);
    END IF;

    UPDATE public.restaurant_reservations
       SET status = v_next,
           status_changed_at = NOW(),
           updated_by = COALESCE(NULLIF(TRIM(p_updated_by), ''), 'Staff'),
           updated_at = NOW()
     WHERE id = v_res.id
    RETURNING * INTO v_res;

    IF v_next = 'SEATED' AND v_res.table_id IS NOT NULL THEN
        UPDATE public.restaurant_tables
           SET status = 'OCCUPIED', updated_at = NOW()
         WHERE id = v_res.table_id
           AND status IN ('AVAILABLE', 'RESERVED', 'CLEANING');
    END IF;

    RETURN jsonb_build_object('success', true, 'duplicate', false, 'data', to_jsonb(v_res));
END;
$function$;

-- -----------------------------------------------------------------------------
-- 19. SALES & CHANNEL REPORT (DURABLE SOURCE ONLY)
-- -----------------------------------------------------------------------------
-- One document is counted once, on the channel that actually carries its money:
--   DINE_IN           -> restaurant_bills (the frozen bill is the sale)
--   TAKEAWAY/DELIVERY -> orders          (no bill exists for those channels)
-- Collections come from restaurant_bill_payments.effective_credited, so cash tendered with
-- change is reported at what the drawer kept, not at what the customer handed over; split
-- tenders are separate rows and therefore separate amounts. Refunds come from
-- restaurant_refunds and are reported beside the gross instead of rewriting it.
CREATE OR REPLACE FUNCTION public.rms_sales_report(
    p_merchant_id uuid,
    p_from timestamptz DEFAULT NULL,
    p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_lo            timestamptz := COALESCE(p_from, TIMESTAMPTZ '1970-01-01T00:00:00+00');
    v_hi            timestamptz := COALESCE(p_to, NOW() + interval '36500 days');
    v_bill_count    bigint := 0;
    v_bill_gross    numeric(14, 2) := 0;
    v_bill_tax      numeric(14, 2) := 0;
    v_bill_service  numeric(14, 2) := 0;
    v_bill_pkg      numeric(14, 2) := 0;
    v_bill_paid     numeric(14, 2) := 0;
    v_outstanding   numeric(14, 2) := 0;
    v_paid_bills    bigint := 0;
    v_unpaid_bills  bigint := 0;
    v_part_bills    bigint := 0;
    v_ord_count     bigint := 0;
    v_ord_gross     numeric(14, 2) := 0;
    v_ord_tax       numeric(14, 2) := 0;
    v_ord_service   numeric(14, 2) := 0;
    v_ord_pkg       numeric(14, 2) := 0;
    v_dinein_orders bigint := 0;
    v_collections   numeric(14, 2) := 0;
    v_refunded      numeric(14, 2) := 0;
    v_gross         numeric(14, 2) := 0;
    v_total_orders  bigint := 0;
    v_methods       jsonb := '{}'::jsonb;
    v_items         jsonb := '[]'::jsonb;
    v_channel       jsonb := '{}'::jsonb;
    v_channels      jsonb := '{}'::jsonb;
    v_pym           jsonb := '{}'::jsonb;
BEGIN
    SELECT COUNT(*),
           ROUND(COALESCE(SUM(b.total_amount), 0), 2),
           ROUND(COALESCE(SUM(b.tax_amount), 0), 2),
           ROUND(COALESCE(SUM(b.service_charge), 0), 2),
           ROUND(COALESCE(SUM(b.packaging_fee), 0), 2),
           ROUND(COALESCE(SUM(b.paid_amount), 0), 2),
           ROUND(COALESCE(SUM(GREATEST(b.total_amount - b.paid_amount + b.refunded_amount, 0)), 0), 2),
           COUNT(*) FILTER (WHERE b.status = 'PAID'),
           COUNT(*) FILTER (WHERE b.status = 'UNPAID'),
           COUNT(*) FILTER (WHERE b.status = 'PARTIALLY_PAID')
      INTO v_bill_count, v_bill_gross, v_bill_tax, v_bill_service, v_bill_pkg, v_bill_paid,
           v_outstanding, v_paid_bills, v_unpaid_bills, v_part_bills
      FROM public.restaurant_bills b
     WHERE b.merchant_id = p_merchant_id
       AND b.status <> 'VOIDED'
       AND b.created_at >= v_lo AND b.created_at <= v_hi;

    SELECT COUNT(*),
           ROUND(COALESCE(SUM(o.total_amount), 0), 2),
           ROUND(COALESCE(SUM(COALESCE(o.tax_amount, 0)), 0), 2),
           ROUND(COALESCE(SUM(COALESCE(o.service_charge_amount, 0)), 0), 2),
           ROUND(COALESCE(SUM(COALESCE(o.packaging_fee_amount, 0)), 0), 2)
      INTO v_ord_count, v_ord_gross, v_ord_tax, v_ord_service, v_ord_pkg
      FROM public.orders o
     WHERE o.merchant_id = p_merchant_id
       AND COALESCE(o.order_channel, 'DELIVERY') <> 'DINE_IN'
       AND o.order_state NOT IN ('REJECTED', 'CANCELLED')
       AND o.created_at >= v_lo AND o.created_at <= v_hi;

    SELECT COUNT(*) INTO v_dinein_orders
      FROM public.orders o
     WHERE o.merchant_id = p_merchant_id
       AND o.order_channel = 'DINE_IN'
       AND o.order_state NOT IN ('REJECTED', 'CANCELLED')
       AND o.created_at >= v_lo AND o.created_at <= v_hi;

    SELECT ROUND(COALESCE(SUM(p.effective_credited), 0), 2) INTO v_collections
      FROM public.restaurant_bill_payments p
     WHERE p.merchant_id = p_merchant_id
       AND p.created_at >= v_lo AND p.created_at <= v_hi;

    SELECT ROUND(COALESCE(SUM(r.amount), 0), 2) INTO v_refunded
      FROM public.restaurant_refunds r
     WHERE r.merchant_id = p_merchant_id
       AND r.created_at >= v_lo AND r.created_at <= v_hi;

    v_gross := ROUND(v_bill_gross + v_ord_gross, 2);
    v_total_orders := v_dinein_orders + v_ord_count;

    SELECT COALESCE(jsonb_object_agg(s.m, jsonb_build_object('count', s.c, 'recordedAmount', s.amt)), '{}'::jsonb)
      INTO v_methods
      FROM (SELECT p.payment_method AS m, COUNT(*) AS c, ROUND(COALESCE(SUM(p.effective_credited), 0), 2) AS amt
              FROM public.restaurant_bill_payments p
             WHERE p.merchant_id = p_merchant_id
               AND p.created_at >= v_lo AND p.created_at <= v_hi
             GROUP BY p.payment_method) s;

    -- Per-method recorded money, as numbers rather than JSON strings: jsonb_object_agg over
    -- `->>'recordedAmount'` alone would serialize 280.00 as "280.00", and the same COALESCE with
    -- a numeric literal is a 42804 the plpgsql parser only raises on first execution.
    v_pym := COALESCE(
        (SELECT jsonb_object_agg(k, COALESCE(((v_methods->k)->>'recordedAmount')::numeric, 0::numeric))
           FROM unnest(ARRAY['CASH', 'UPI', 'CARD']) AS k), '{}'::jsonb)
      || COALESCE(
        (SELECT jsonb_object_agg(m, ((v_methods->m)->>'recordedAmount')::numeric)
           FROM jsonb_object_keys(v_methods) AS m
          WHERE m NOT IN ('CASH', 'UPI', 'CARD')), '{}'::jsonb);

    v_methods := jsonb_build_object(
        'CASH',  COALESCE(v_methods->'CASH',  jsonb_build_object('count', 0, 'recordedAmount', 0)),
        'UPI',   COALESCE(v_methods->'UPI',   jsonb_build_object('count', 0, 'recordedAmount', 0))
                   || jsonb_build_object('verificationNote',
                       'Staff recorded direct UPI payment; not bank verified'),
        'CARD',  COALESCE(v_methods->'CARD',  jsonb_build_object('count', 0, 'recordedAmount', 0))
    ) || COALESCE(
        (SELECT jsonb_object_agg(m, v_methods->m) FROM jsonb_object_keys(v_methods) AS m
          WHERE m NOT IN ('CASH', 'UPI', 'CARD')), '{}'::jsonb);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('name', nm, 'quantitySold', q, 'totalRevenue', rev)
                              ORDER BY rev DESC, nm), '[]'::jsonb)
      INTO v_items
      FROM (SELECT nm, SUM(q) AS q, ROUND(SUM(rev), 2) AS rev
              FROM (
                    SELECT COALESCE(NULLIF(l->>'name', ''), NULLIF(l->>'dish_name', ''), 'Dish') AS nm,
                           COALESCE((l->>'quantity')::numeric, 1) AS q,
                           COALESCE((l->>'lineTotal')::numeric, (l->>'line_total')::numeric, 0) AS rev
                      FROM public.restaurant_bills b, jsonb_array_elements(b.items_snapshot) AS l
                     WHERE b.merchant_id = p_merchant_id
                       AND b.status <> 'VOIDED'
                       AND b.created_at >= v_lo AND b.created_at <= v_hi
                    UNION ALL
                    SELECT ol.product_name_snapshot, ol.quantity, ol.line_total
                      FROM public.order_lines ol
                      JOIN public.orders o ON o.id = ol.order_id
                     WHERE ol.merchant_id = p_merchant_id
                       AND COALESCE(o.order_channel, 'DELIVERY') <> 'DINE_IN'
                       AND o.order_state NOT IN ('REJECTED', 'CANCELLED')
                       AND o.created_at >= v_lo AND o.created_at <= v_hi
                   ) u
             GROUP BY nm) agg;

    SELECT COALESCE(jsonb_object_agg(ch, jsonb_build_object('orders_count', c, 'total_amount', t)), '{}'::jsonb)
      INTO v_channel
      FROM (SELECT 'DINE_IN'::text AS ch, v_dinein_orders AS c, v_bill_gross AS t
            UNION ALL
            SELECT COALESCE(o.order_channel, 'DELIVERY'), COUNT(*), ROUND(COALESCE(SUM(o.total_amount), 0), 2)
              FROM public.orders o
             WHERE o.merchant_id = p_merchant_id
               AND COALESCE(o.order_channel, 'DELIVERY') <> 'DINE_IN'
               AND o.order_state NOT IN ('REJECTED', 'CANCELLED')
               AND o.created_at >= v_lo AND o.created_at <= v_hi
             GROUP BY COALESCE(o.order_channel, 'DELIVERY')) s;

    SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('count', (e.v->>'orders_count')::bigint,
                                                           'sales', (e.v->>'total_amount')::numeric)), '{}'::jsonb)
      INTO v_channels
      FROM jsonb_each(v_channel) AS e(k, v);

    RETURN jsonb_build_object(
        'summary', jsonb_build_object(
            'total_orders', v_total_orders,
            'gross_sales', v_gross,
            'net_sales', ROUND(GREATEST(v_gross - v_bill_tax - v_bill_service - v_ord_tax - v_ord_service, 0), 2),
            'total_tax', ROUND(v_bill_tax + v_ord_tax, 2),
            'total_service_charge', ROUND(v_bill_service + v_ord_service, 2),
            'total_packaging_fee', ROUND(v_bill_pkg + v_ord_pkg, 2),
            'average_order_value', CASE WHEN v_total_orders > 0
                                        THEN ROUND(v_gross / v_total_orders, 2) ELSE 0 END,
            'total_bills', v_bill_count,
            'paid_bills', v_paid_bills,
            'unpaid_bills', v_unpaid_bills,
            'partially_paid_bills', v_part_bills,
            'total_recorded_collections', v_collections,
            'total_outstanding_balance', v_outstanding,
            'total_refunds_recorded', v_refunded),
        'by_channel', jsonb_build_object(
            'DINE_IN',   COALESCE(v_channel->'DINE_IN',   jsonb_build_object('orders_count', 0, 'total_amount', 0)),
            'TAKEAWAY',  COALESCE(v_channel->'TAKEAWAY',  jsonb_build_object('orders_count', 0, 'total_amount', 0)),
            'DELIVERY',  COALESCE(v_channel->'DELIVERY',  jsonb_build_object('orders_count', 0, 'total_amount', 0)))
            || COALESCE((SELECT jsonb_object_agg(k, v_channel->k)
                           FROM jsonb_object_keys(v_channel) AS k
                          WHERE k NOT IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY')), '{}'::jsonb),
        'channels', jsonb_build_object(
            'DINE_IN',  COALESCE(v_channels->'DINE_IN',  jsonb_build_object('count', 0, 'sales', 0)),
            'TAKEAWAY', COALESCE(v_channels->'TAKEAWAY', jsonb_build_object('count', 0, 'sales', 0)),
            'DELIVERY', COALESCE(v_channels->'DELIVERY', jsonb_build_object('count', 0, 'sales', 0)))
            || COALESCE((SELECT jsonb_object_agg(k, v_channels->k)
                           FROM jsonb_object_keys(v_channels) AS k
                          WHERE k NOT IN ('DINE_IN', 'TAKEAWAY', 'DELIVERY')), '{}'::jsonb),
        'payments_by_method', v_pym,
        'payment_methods', v_methods,
        'item_sales', v_items);
END;
$function$;

-- -----------------------------------------------------------------------------
-- 20. ACCESS CONTROL (the 042 / 031 block for everything added above)
-- -----------------------------------------------------------------------------
ALTER TABLE public.restaurant_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_refunds       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_receipts      ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_bill_payments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_refunds       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.restaurant_receipts      FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_bill_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_refunds       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_receipts      TO service_role;

GRANT USAGE, SELECT ON SEQUENCE public.restaurant_invoice_number_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.restaurant_kds_ticket_number_seq TO service_role;

-- The rms_* functions take a merchant id from the caller and are the only way the backend
-- writes these tables, so they are as private as the financial functions in 039: a
-- browser-facing role can neither call them nor discover them.
REVOKE ALL ON FUNCTION public.rms_bill_basis(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_open_table_session_atomic(uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_attach_order_to_session_atomic(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_close_session_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_transfer_session_atomic(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_set_table_status_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_update_table_atomic(uuid, uuid, text, text, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_regenerate_table_qr_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_generate_bill_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_split_bill_atomic(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_record_bill_payment_atomic(uuid, uuid, numeric, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_record_bill_refund_atomic(uuid, uuid, numeric, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_get_bill_receipt_atomic(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_create_kds_ticket_atomic(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_update_kds_ticket_status_atomic(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_record_takeaway_handover_atomic(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_create_reservation_atomic(uuid, uuid, text, text, integer, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_update_reservation_status_atomic(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_sales_report(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.rms_bill_basis(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_open_table_session_atomic(uuid, uuid, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_attach_order_to_session_atomic(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_close_session_atomic(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_transfer_session_atomic(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_set_table_status_atomic(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_update_table_atomic(uuid, uuid, text, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_regenerate_table_qr_atomic(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_generate_bill_atomic(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_split_bill_atomic(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_record_bill_payment_atomic(uuid, uuid, numeric, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_record_bill_refund_atomic(uuid, uuid, numeric, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_get_bill_receipt_atomic(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_create_kds_ticket_atomic(uuid, uuid, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_update_kds_ticket_status_atomic(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_record_takeaway_handover_atomic(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_create_reservation_atomic(uuid, uuid, text, text, integer, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_update_reservation_status_atomic(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.rms_sales_report(uuid, timestamptz, timestamptz) TO service_role;
