'use strict';

/**
 * NABIN — RESTAURANT MANAGEMENT SYSTEM (RMS) REPOSITORY
 *
 * Implements authoritative multi-channel data operations for:
 * 1. Multi-channel settings (Dine-In, Takeaway, Food Delivery toggles, GST tax, Service charge, Packaging fees).
 * 2. Floor Table management (sections, capacities, QR generation & public resolution).
 * 3. Dining session lifecycle (guest seating, session transfers, multiple rounds of orders).
 * 4. Server-authoritative bill calculations (GST %, service charge %, split bills, payment recording).
 * 5. Takeaway channel operations (preparation estimation, staff handover verification).
 * 6. Kitchen Display System (KDS) tickets queue.
 * 7. Restaurant Staff Role-Based Access Control (RBAC).
 * 8. Channel sales and revenue performance reports.
 */

const crypto = require('crypto');
const { supabaseAdmin, isLivePostgres, nabinEnv } = require('../supabase');

// RMS Postgres I/O is only permitted against the local Docker target during development,
// or the production project when running in production. This prevents a test or dev run
// that happens to point at a hosted (staging) project from silently writing RMS rows there.
function rmsPgIoEnabled() {
  if (!(isLivePostgres && supabaseAdmin)) return false;
  if (process.env.NODE_ENV === 'production') return true;
  return Boolean(nabinEnv && nabinEnv.restLocal === true);
}

/**
 * A durable restaurant write the store refused, in the shape the routes already answer.
 *
 * Every write this file makes through `supabaseAdmin.from(table)` used to do the same thing with a
 * refusal: print `[RMS] … persistence failed …` with `console.warn` and return the row anyway.
 * supabase-js resolves `{data, error}` for a PostgreSQL refusal rather than rejecting, so the route's
 * own `catch` never ran and a merchant was told a table, a floor or a tax rate was saved when only
 * a Map in this process had changed. A refused write is not an opinion, so the refusal travels
 * in the vocabulary the rest of the money-adjacent repositories already use (LedgerRepository.js:57,
 * PaymentRepository.js:25): the `storeFailure` flag the routes test, the engine's own SQLSTATE on
 * `code` so `replyStoreError` (src/server.js:347) decides 503 / 409 / 500 from the code and not
 * from wording, and the engine's sentence on `details`, which is logged and never echoed.
 */
function storeFailure(what, error) {
  const err = new Error(`The ${what} could not be saved because the restaurant store refused it.`);
  err.storeFailure = true;
  err.code = (error && error.code) || 'STORE_ERROR';
  err.details = error ? String(error.message || error.code || error) : 'unknown store failure';
  if (error && error.hint) err.hint = String(error.hint);
  const wireStatus = error && (error.status || error.statusCode);
  if (wireStatus) err.status = Number(wireStatus);
  if (error && error.cause) err.cause = error.cause;
  return err;
}

/**
 * A read the durable store refused, in the same channel as a refused write.
 *
 * storeFailure() says the value "could not be saved", which is the wrong sentence for a list that
 * could not be fetched: nothing was lost, but the caller cannot be shown state it does not have.
 * The classification is identical (storeFailure flag, the engine's SQLSTATE on code, its sentence on
 * details) so replyStoreError still answers 503 for an outage and 500 SCHEMA_NOT_READY for a schema
 * that has not been migrated — only the wording differs.
 */
function storeReadFailure(what, error) {
  const err = storeFailure(what, error);
  err.message = `The ${what} could not be read from the restaurant store.`;
  return err;
}

const TABLE_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'ORDERING', 'BILL_REQUESTED', 'CLEANING'];
const KDS_STATUSES = ['NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
const STAFF_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN_STAFF', 'INVENTORY_STAFF'];

const ROLE_PERMISSIONS = {
  OWNER: ['all'],
  MANAGER: ['manage_tables', 'manage_menu', 'manage_orders', 'view_reports', 'manage_staff', 'manage_payments'],
  CASHIER: ['view_tables', 'request_bill', 'process_payment', 'bills.create', 'bills.pay', 'view_reports'],
  WAITER: ['view_tables', 'open_session', 'create_order', 'request_bill', 'tables.session.open', 'orders.dine_in.create'],
  KITCHEN_STAFF: ['view_kds', 'update_kds'],
  INVENTORY_STAFF: ['manage_inventory', 'view_menu']
};

/**
 * The public origin a diner's table QR link is built from.
 *
 * Four call sites used to interpolate the literal `http://localhost:3000` into a `qr_url` that was
 * handed to a merchant to print, so a deployed restaurant's sticker asked the diner's phone to open
 * the diner's own machine. The default stays that local origin, because a development checkout has
 * no public domain to name and inventing one would be worse; a deployment sets DINING_QR_BASE_URL.
 */
function diningQrUrl(token) {
  if (!token) return null;
  const base = String(process.env.DINING_QR_BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
  return `${base}/dining/qr/${token}`;
}

/**
 * A restaurant_tables row in the shape every RMS caller already reads.
 *
 * Both spellings of each key are kept because the routes, the merchant console and the Flutter
 * shell were written against the mixed shape this file used to build by hand, three times over,
 * with small differences between the copies. The row's own columns are the only source: a table's
 * status, token and capacity come from PostgreSQL rather than from whatever this process last set.
 */
function normTableRow(t, sectionName) {
  const name = t.table_name || `Table ${t.table_number}`;
  const qr = t.qr_code_token || null;
  const label = sectionName || 'Main Floor';
  return {
    id: t.id,
    merchantId: t.merchant_id,
    merchant_id: t.merchant_id,
    tableNumber: t.table_number,
    table_number: t.table_number,
    name,
    tableName: name,
    table_name: name,
    capacity: Number(t.capacity || 4),
    sectionId: t.section_id || null,
    section_id: t.section_id || null,
    sectionName: label,
    section_name: label,
    status: t.status,
    qrToken: qr,
    qr_token: qr,
    qr_code_token: qr,
    qrCodeToken: qr,
    qrUrl: diningQrUrl(qr),
    qr_url: diningQrUrl(qr),
    currentSessionId: t.current_session_id || null,
    current_session_id: t.current_session_id || null,
    activeOrdersCount: 0,
    unpaidBalance: 0,
    createdAt: t.created_at,
    updatedAt: t.updated_at
  };
}

/**
 * A restaurant_table_sessions row in the caller's shape, with the stored status left untouched.
 *
 * The durable status vocabulary is ACTIVE / BILL_REQUESTED / CLOSED / CANCELLED — that is the
 * column's own CHECK constraint. The in-memory copy of this file used to mint 'OPEN', a value that
 * cannot exist in the table, so a session that survived a restart changed the word a caller had to
 * compare against. Nothing here translates it back.
 */
function normSessionRow(s) {
  return {
    id: s.id,
    merchantId: s.merchant_id,
    merchant_id: s.merchant_id,
    tableId: s.table_id,
    table_id: s.table_id,
    tableNumber: s.table_number != null ? s.table_number : undefined,
    table_number: s.table_number != null ? s.table_number : undefined,
    sessionToken: s.session_token,
    session_token: s.session_token,
    status: s.status,
    guestCount: Number(s.guest_count || 1),
    guest_count: Number(s.guest_count || 1),
    openedBy: s.opened_by,
    opened_by: s.opened_by,
    openedAt: s.opened_at,
    opened_at: s.opened_at,
    closedAt: s.closed_at,
    closed_at: s.closed_at,
    closedBy: s.closed_by,
    closed_by: s.closed_by,
    previousTableId: s.previous_table_id,
    previous_table_id: s.previous_table_id,
    transferCount: Number(s.transfer_count || 0),
    transfer_count: Number(s.transfer_count || 0),
    totalAmount: Number(s.total_amount || 0),
    total_amount: Number(s.total_amount || 0),
    paidAmount: Number(s.paid_amount || 0),
    paid_amount: Number(s.paid_amount || 0),
    balanceAmount: Number(s.balance_amount || 0),
    balance_amount: Number(s.balance_amount || 0),
    notes: s.notes || null,
    createdAt: s.created_at
  };
}

// The columns every durable read of a session needs. Hoisted out of _decorateTables because the
// billing writes re-read a session row after an RPC has moved its money columns, and a second copy
// of a column list is how a read starts answering `undefined` for a column nobody selected.
const SESSION_COLS = 'id, merchant_id, table_id, session_token, status, guest_count, opened_by, opened_at, closed_at, closed_by, previous_table_id, transfer_count, total_amount, paid_amount, balance_amount, notes, created_at';

const BILL_COLS = 'id, merchant_id, table_session_id, table_id, table_number, invoice_number, subtotal, tax_amount, service_charge, packaging_fee, discount_amount, total_amount, paid_amount, refunded_amount, status, split_type, splits, items_snapshot, merchant_snapshot, payment_instructions, generated_by, issued_at, created_at, updated_at';
const BILL_PAYMENT_COLS = 'id, bill_id, merchant_id, amount, effective_credited, change_due, payment_method, transaction_ref, recorded_by, verification_status, verified_at, note, created_at';
const BILL_REFUND_COLS = 'id, bill_id, merchant_id, payment_id, amount, refund_method, reason, recorded_by, transfer_reference, transfer_status, created_at';
const KDS_COLS = 'id, merchant_id, order_id, ticket_number, channel, table_number, table_session_id, status, items_snapshot, prep_time_minutes, prep_started_at, ready_at, served_at, status_changed_at, updated_by, created_at, updated_at';
const RESERVATION_COLS = 'id, merchant_id, table_id, customer_name, customer_phone, party_size, reservation_time, status, notes, status_changed_at, updated_by, created_at, updated_at';
const STAFF_COLS = 'id, merchant_id, user_id, name, phone, role, is_active, role_changed_at, updated_by, created_at, updated_at';

/**
 * The sentence every refund answer carries.
 *
 * Nothing in this file moves money to a bank or a switch, so a recorded refund is a record. The
 * durable function puts the same words on its own annex rows; this is the copy for the bill's own
 * `refunds` list, which is read straight out of `restaurant_refunds` and has no sentence of its own.
 */
const REFUND_DISCLAIMER = 'RECORDED EVENT ONLY: This records the refund in RMS records and does not initiate a banking or UPI transfer.';

const SALES_DISCLAIMER = 'AUDIT NOTICE: Recorded payment entries represent local restaurant staff records. UPI collections reflect merchant-declared amounts without real-time banking verification. Direct restaurant payments do not commingle with NABIN platform financial ledgers.';

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

/**
 * The refusal every billing operation answers with when the id names no bill of this merchant's.
 *
 * The durable functions use the same code and the same sentence, so a caller gets one vocabulary
 * whichever store served them — and a code, because the routes and the tests branch on it.
 */
function billNotFound() {
  const err = new Error('Bill not found.');
  err.code = 'BILL_NOT_FOUND';
  err.statusCode = 400;
  return err;
}

/**
 * Whether a caller's id could name a row in a uuid-keyed table.
 *
 * A malformed id sent to the engine raises 22P02, which is the shape of a store failure: a typo in a
 * URL would be reported to a merchant as an outage. Not-a-uuid is answered as not-found instead.
 */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value == null ? '' : value));
}

/**
 * The window a sales report was asked for, as `rms_sales_report` wants it.
 *
 * The function takes `timestamptz`, so a value the engine cannot parse would raise 22007 — the shape
 * of a store failure — and a merchant's typo in a date box would be reported as an outage. Both
 * bounds are checked here and an inverted range refused before anything is asked of the store.
 * Dates are passed through as written: the schema carries no merchant timezone, so widening
 * `2026-10-14` to a local end-of-day would invent a rule the project has never decided. A bare date
 * is therefore the start of that day in UTC, which is how every timestamp in these tables is stored.
 */
function salesWindow(params = {}) {
  const bounds = [
    ['startDate', params.startDate],
    ['endDate', params.endDate]
  ];
  const problems = [];
  bounds.forEach(([name, value]) => {
    if (value == null || value === '') return;
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      problems.push(`${name}="${String(value).slice(0, 40)}" is not a date`);
    }
  });
  const [start, end] = bounds.map(([, v]) => (v == null || v === '' ? null : String(v).trim()));
  if (!problems.length && start && end && Date.parse(start) > Date.parse(end)) {
    problems.push(`startDate ${start} is after endDate ${end}`);
  }
  if (problems.length) {
    const err = new Error(`The sales report period is not usable: ${problems.join('; ')}.`);
    err.code = 'INVALID_DATE_RANGE';
    err.statusCode = 400;
    throw err;
  }
  return { p_from: start, p_to: end };
}

const SALES_CHANNEL_KEYS = ['DINE_IN', 'TAKEAWAY', 'DELIVERY'];
const SALES_METHOD_KEYS = ['CASH', 'UPI', 'CARD'];
const UPI_VERIFICATION_NOTE = 'Staff recorded direct UPI payment; not bank verified';

/**
 * The report document the durable function returns, in the envelope the memory aggregation used.
 *
 * `rms_sales_report` was written against this shape, so the projection is a check rather than a
 * translation: the keys the merchant screen indexes are filled in even if a future function version
 * omits one, and money stays the number the engine summed rather than a string the caller must parse.
 */
function durableSalesView(doc, params = {}) {
  const summary = (doc && doc.summary) || {};
  const byChannel = (doc && doc.by_channel) || {};
  const channels = (doc && doc.channels) || {};
  const methods = (doc && doc.payment_methods) || {};
  const byMethod = (doc && doc.payments_by_method) || {};
  return {
    period: params.period || 'ALL_TIME',
    startDate: params.startDate || null,
    endDate: params.endDate || null,
    summary: {
      total_orders: Number(summary.total_orders || 0),
      gross_sales: round2(summary.gross_sales),
      net_sales: round2(summary.net_sales),
      total_tax: round2(summary.total_tax),
      total_service_charge: round2(summary.total_service_charge),
      total_packaging_fee: round2(summary.total_packaging_fee),
      average_order_value: round2(summary.average_order_value),
      total_bills: Number(summary.total_bills || 0),
      paid_bills: Number(summary.paid_bills || 0),
      unpaid_bills: Number(summary.unpaid_bills || 0),
      partially_paid_bills: Number(summary.partially_paid_bills || 0),
      total_recorded_collections: round2(summary.total_recorded_collections),
      total_outstanding_balance: round2(summary.total_outstanding_balance),
      total_refunds_recorded: round2(summary.total_refunds_recorded)
    },
    by_channel: SALES_CHANNEL_KEYS.reduce((acc, ch) => {
      acc[ch] = {
        orders_count: Number((byChannel[ch] || {}).orders_count || 0),
        total_amount: round2((byChannel[ch] || {}).total_amount)
      };
      return acc;
    }, Object.entries(byChannel).reduce((acc, [ch, v]) => {
      if (!SALES_CHANNEL_KEYS.includes(ch)) acc[ch] = v;
      return acc;
    }, {})),
    channels: SALES_CHANNEL_KEYS.reduce((acc, ch) => {
      acc[ch] = { count: Number((channels[ch] || {}).count || 0), sales: round2((channels[ch] || {}).sales) };
      return acc;
    }, Object.entries(channels).reduce((acc, [ch, v]) => {
      if (!SALES_CHANNEL_KEYS.includes(ch)) acc[ch] = v;
      return acc;
    }, {})),
    payments_by_method: Object.entries(byMethod).reduce((acc, [m, v]) => {
      acc[m] = round2(v);
      return acc;
    }, SALES_METHOD_KEYS.reduce((acc, m) => { acc[m] = 0; return acc; }, {})),
    payment_methods: Object.entries(methods).reduce((acc, [m, v]) => {
      acc[m] = {
        count: Number((v || {}).count || 0),
        recordedAmount: round2((v || {}).recordedAmount),
        ...((v || {}).verificationNote ? { verificationNote: v.verificationNote } : {})
      };
      return acc;
    }, SALES_METHOD_KEYS.reduce((acc, m) => {
      acc[m] = m === 'UPI'
        ? { count: 0, recordedAmount: 0, verificationNote: UPI_VERIFICATION_NOTE }
        : { count: 0, recordedAmount: 0 };
      return acc;
    }, {})),
    item_sales: (Array.isArray(doc && doc.item_sales) ? doc.item_sales : []).map((it) => ({
      name: it.name,
      quantitySold: Number(it.quantitySold || 0),
      totalRevenue: round2(it.totalRevenue)
    })),
    disclaimer: SALES_DISCLAIMER
  };
}

/** The channel-only view, from the same document the full report is built from. */
function durableChannelView(doc) {
  const view = durableSalesView(doc);
  return {
    summary: view.summary,
    by_channel: view.by_channel,
    channels: view.channels,
    payments_by_method: view.payments_by_method
  };
}

/** A restaurant_bill_payments row — one tender, as the store recorded it. */
function normPaymentRow(p) {
  return {
    id: p.id,
    billId: p.bill_id,
    bill_id: p.bill_id,
    amount: round2(p.amount),
    effectiveCredited: round2(p.effective_credited),
    effective_credited: round2(p.effective_credited),
    changeDue: round2(p.change_due),
    change_due: round2(p.change_due),
    paymentMethod: p.payment_method,
    payment_method: p.payment_method,
    method: p.payment_method,
    transactionRef: p.transaction_ref || null,
    transaction_ref: p.transaction_ref || null,
    reference: p.transaction_ref || null,
    recordedBy: p.recorded_by,
    recorded_by: p.recorded_by,
    // 'RECORDED' until a bank says otherwise, which nothing in this repository can do.
    status: p.verification_status,
    verificationStatus: p.verification_status,
    verification_status: p.verification_status,
    verifiedAt: p.verified_at || null,
    note: p.note || null,
    recordedAt: p.created_at,
    recorded_at: p.created_at,
    timestamp: p.created_at
  };
}

/** A restaurant_refunds row — an audit event, never a payout. */
function normRefundRow(r) {
  return {
    id: r.id,
    billId: r.bill_id,
    bill_id: r.bill_id,
    paymentId: r.payment_id || null,
    amount: round2(r.amount),
    reason: r.reason,
    recordedBy: r.recorded_by,
    recorded_by: r.recorded_by,
    method: r.refund_method,
    refundMethod: r.refund_method,
    refund_method: r.refund_method,
    transferReference: r.transfer_reference || null,
    transfer_reference: r.transfer_reference || null,
    transferStatus: r.transfer_status,
    transfer_status: r.transfer_status,
    disclaimer: REFUND_DISCLAIMER,
    recordedAt: r.created_at,
    recorded_at: r.created_at,
    timestamp: r.created_at
  };
}

/**
 * A restaurant_bills row as the bill document every RMS caller already reads.
 *
 * The four money figures are the row's own columns, so `balanceAmount` is the same number
 * `rms_close_session_atomic` will weigh a closure against rather than a fifth opinion computed
 * here. `payments` and `refunds` are not the bill's legacy `payments` jsonb — 043 writes each tender
 * as its own row, and a bill that answered from the frozen column would show money the restaurant
 * has as an empty list. The item, merchant and UPI snapshots are the ones written when the bill was
 * minted, which is what makes a reprint of last week's bill say last week's prices.
 */
function normBillRow(b, tenders = {}) {
  const total = round2(b.total_amount);
  const paid = round2(b.paid_amount);
  const refunded = round2(b.refunded_amount);
  const balance = round2(Math.max(0, total - paid + refunded));
  const items = Array.isArray(b.items_snapshot) ? b.items_snapshot : [];
  const splits = Array.isArray(b.splits) ? b.splits : [];
  const payments = Array.isArray(tenders.payments) ? tenders.payments : [];
  const refunds = Array.isArray(tenders.refunds) ? tenders.refunds : [];
  const merchant = b.merchant_snapshot || {};
  const instructions = b.payment_instructions || null;
  const tax = round2(b.tax_amount);
  const service = round2(b.service_charge);
  const packaging = round2(b.packaging_fee);
  const discount = round2(b.discount_amount);
  return {
    id: b.id,
    invoiceNumber: b.invoice_number,
    invoice_number: b.invoice_number,
    merchantId: b.merchant_id,
    merchant_id: b.merchant_id,
    merchantDetails: merchant,
    merchant_details: merchant,
    paymentInstructions: instructions,
    payment_instructions: instructions,
    tableSessionId: b.table_session_id,
    session_id: b.table_session_id,
    table_session_id: b.table_session_id,
    tableId: b.table_id || null,
    table_id: b.table_id || null,
    tableNumber: b.table_number != null ? b.table_number : 'N/A',
    table_number: b.table_number,
    items,
    subtotal: round2(b.subtotal),
    taxAmount: tax,
    tax_amount: tax,
    gstAmount: tax,
    gst_amount: tax,
    serviceCharge: service,
    service_charge_amount: service,
    packagingFee: packaging,
    packaging_fee_amount: packaging,
    dineInPackagingFee: packaging,
    dine_in_packaging_fee: packaging,
    discountAmount: discount,
    discount_amount: discount,
    totalAmount: total,
    total_amount: total,
    paidAmount: paid,
    paid_amount: paid,
    refundedAmount: refunded,
    refunded_amount: refunded,
    balanceAmount: balance,
    balance_amount: balance,
    status: b.status,
    payment_status: b.status,
    splitType: b.split_type,
    split_type: b.split_type,
    splits,
    payments,
    refunds,
    generatedBy: b.generated_by || null,
    issuedAt: b.issued_at || null,
    createdAt: b.created_at,
    updatedAt: b.updated_at
  };
}

/**
 * The four columns a kitchen ticket adds to an order, and nothing else.
 *
 * `items` is the ticket's frozen `items_snapshot`, which `rms_create_kds_ticket_atomic` read from
 * `order_lines` at the moment the ticket was minted. The cook needs it to survive the order being
 * changed underneath, and a ticket that re-derived its items on every read would tell the kitchen to
 * cook a dish the customer has since removed.
 */
function normKdsRow(t) {
  const items = Array.isArray(t.items_snapshot) ? t.items_snapshot : [];
  return {
    id: t.id,
    merchantId: t.merchant_id,
    merchant_id: t.merchant_id,
    orderId: t.order_id,
    order_id: t.order_id,
    ticketNumber: t.ticket_number,
    ticket_number: t.ticket_number,
    channel: t.channel,
    order_channel: t.channel,
    tableNumber: t.table_number,
    table_number: t.table_number,
    tableSessionId: t.table_session_id || null,
    table_session_id: t.table_session_id || null,
    status: t.status,
    items,
    itemsSnapshot: items,
    items_snapshot: items,
    prepTimeMinutes: Number(t.prep_time_minutes || 20),
    prep_time_minutes: Number(t.prep_time_minutes || 20),
    updatedBy: t.updated_by || null,
    updated_by: t.updated_by || null,
    prepStartedAt: t.prep_started_at || null,
    readyAt: t.ready_at || null,
    servedAt: t.served_at || null,
    statusChangedAt: t.status_changed_at || null,
    createdAt: t.created_at,
    created_at: t.created_at,
    updatedAt: t.updated_at
  };
}

function normReservationRow(r) {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    merchant_id: r.merchant_id,
    tableId: r.table_id || null,
    table_id: r.table_id || null,
    customerName: r.customer_name,
    customer_name: r.customer_name,
    customerPhone: r.customer_phone,
    customer_phone: r.customer_phone,
    partySize: Number(r.party_size || 2),
    party_size: Number(r.party_size || 2),
    reservationTime: r.reservation_time,
    reservation_time: r.reservation_time,
    status: r.status,
    notes: r.notes || null,
    updatedBy: r.updated_by || null,
    statusChangedAt: r.status_changed_at || null,
    createdAt: r.created_at,
    created_at: r.created_at,
    updatedAt: r.updated_at
  };
}

/**
 * A restaurant_staff row, with the role's permissions derived from the role.
 *
 * `permissions` has no column: the role is what is stored, and ROLE_PERMISSIONS is the platform's
 * own map from a role to what it may do. Deriving it here is a read of a constant, not an invention —
 * but an unknown role would derive `[]`, which is what a stale or hand-edited row deserves.
 */
function normStaffRow(s) {
  return {
    id: s.id,
    merchantId: s.merchant_id,
    merchant_id: s.merchant_id,
    userId: s.user_id || null,
    user_id: s.user_id || null,
    name: s.name,
    phone: s.phone || null,
    role: s.role,
    permissions: ROLE_PERMISSIONS[s.role] || [],
    isActive: s.is_active !== false,
    is_active: s.is_active !== false,
    roleChangedAt: s.role_changed_at || null,
    updatedBy: s.updated_by || null,
    createdAt: s.created_at,
    created_at: s.created_at,
    updatedAt: s.updated_at
  };
}

/**
 * A column the table cannot hold is a bad request, not an outage.
 *
 * The RMS routes pass `req.body` straight through, so a 400-character customer name reaches
 * varchar(120) as a 22001 the Supabase driver hands back as an error object — which every write
 * path here classifies as `storeFailure` and answers 503. The merchant would be told their store is
 * down when their own payload was too long. Length is the only column constraint these domains can
 * trip: the ids are uuid, the enums are checked by the functions or by this file's own lists.
 */
function fieldTooLong(name, value, max) {
  if (value == null || String(value).length <= max) return;
  const err = new Error(`${name} must be ${max} characters or fewer.`);
  err.code = 'INVALID_INPUT';
  err.statusCode = 400;
  throw err;
}

function validateUpiIdFormat(upiId) {
  if (!upiId) return true;
  const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9.\-_]{2,64}$/;
  return upiRegex.test(String(upiId).trim());
}

function validateQrImage(dataUrlOrString, mimeType) {
  const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (mimeType && !allowed.includes(mimeType.toLowerCase())) {
    throw new Error('Unsupported image format. Accepted formats: PNG, JPEG, WebP.');
  }
  if (typeof dataUrlOrString === 'string' && dataUrlOrString.startsWith('data:')) {
    const match = dataUrlOrString.match(/^data:([^;]+);base64,/);
    if (match) {
      if (!allowed.includes(match[1].toLowerCase())) {
        throw new Error('Unsupported image format. Accepted formats: PNG, JPEG, WebP.');
      }
      const base64Len = dataUrlOrString.length - match[0].length;
      const sizeInBytes = (base64Len * 3) / 4;
      if (sizeInBytes > 5 * 1024 * 1024) {
        throw new Error('QR image exceeds maximum allowed size of 5MB.');
      }
    }
  }
  return true;
}

class RestaurantManagementRepository {
  constructor(db) {
    this.db = db;
    // In-memory backing stores for local offline development and unit tests
    this.pgEnabled = rmsPgIoEnabled();
    this._sections = new Map();
    this._tables = new Map();
    this._sessions = new Map();
    this._reservations = new Map();
    this._bills = new Map();
    this._staff = new Map();
    this._kdsTickets = new Map();
    this._settings = new Map();
    this._orders = new Map();
  }

  /**
   * The durable store's own answer to an RMS operation, passed through rather than re-decided.
   *
   * Three outcomes, and the whole point is that they are no longer collapsed into one. A call that
   * never reached PostgreSQL, or named a function or column the applied schema does not have, is
   * the server's condition and travels as `storeFailure`, so `replyStoreError` (src/server.js:347)
   * answers 503 for an outage and 500 SCHEMA_NOT_READY for an un-migrated deployment. A function
   * that ran and answered `{success: false, code: 'OVERPAYMENT_NOT_ALLOWED'}` refused *this
   * request*, so its own code and sentence come back at 400 — the same status the in-memory
   * implementation used for the same rule, which keeps the public contract intact. And a
   * `{success: true}` payload is returned whole, because the RPC carries truthfulness fields no
   * JavaScript could honestly recompute: `duplicate` distinguishes a replayed payment from a new
   * one, `provisional` distinguishes a preview from a minted receipt, `transfer_status` says a
   * refund was recorded rather than paid.
   */
  async _rpc(what, name, args) {
    const { data, error } = await supabaseAdmin.rpc(name, args || {});
    if (error) throw storeFailure(what, error);
    if (!data || typeof data !== 'object') {
      throw storeFailure(what, { code: 'RMS_RPC_EMPTY', message: `${name} returned no document.` });
    }
    if (data.success === false) {
      const err = new Error(data.message || `The ${what} was refused.`);
      err.code = data.code || 'RMS_RPC_REFUSED';
      err.statusCode = 400;
      throw err;
    }
    return data;
  }

  /**
   * A production process may not serve an RMS operation from its own memory.
   *
   * Called at each decision point that is about to fall back to the Maps. Development and tests
   * with the durability gate closed still fall back, because offline development needs them to, and
   * every such reply carries `dataSource: 'memory'` so the mode is visible to the caller. In
   * production a restaurant must not be told a bill, a payment or a session was written while the
   * only copy of it lives in this process, so the fallback becomes an honest 503.
   */
  _rejectMemoryFallback(what) {
    if (process.env.NODE_ENV !== 'production') return;
    const err = new Error(`The ${what} cannot be served because the restaurant store is unavailable.`);
    err.storeFailure = true;
    err.code = 'STORE_UNAVAILABLE';
    err.status = 503;
    err.details = 'RMS durable I/O is disabled while NODE_ENV=production.';
    throw err;
  }

  // Which table a durable record of each RMS domain lives in. `null` would be the honest answer for a
  // domain this file cannot persist, and after 043 no RMS domain is one: the reservation, KDS, staff
  // and takeaway-handover domains are now written by the RPCs and the staff builder below. The
  // `refunds` domain names restaurant_refunds rather than the bill: 043 keeps each tender and each
  // refund as its own row, so a refund record is a row in its own table, not a field on the bill.
  static RMS_DOMAIN_TABLES = {
    settings: 'merchants',
    sections: 'restaurant_sections',
    tables: 'restaurant_tables',
    sessions: 'restaurant_table_sessions',
    bills: 'restaurant_bills',
    refunds: 'restaurant_refunds',
    reservations: 'restaurant_reservations',
    kds: 'restaurant_kds_tickets',
    staff: 'restaurant_staff',
    orders: 'orders'
  };

  // Only a table this file actually writes may be reported as durable, so the list is the write
  // surface, not the schema's. Two channels reach a table: a `supabaseAdmin.from(table)` builder
  // followed by a write verb, and an `rms_*` function whose own body in migration 043 writes it —
  // every table/session/billing/reservation/KDS/handover mutation travels through that second
  // channel, and staff through the first because 043 defines no staff function. rms_write_honesty_test.js
  // RMSH-04 re-derives this list from the source and the migration, so a table added to either
  // channel has to appear here or the guard goes red rather than quietly mislabelling a record.
  static RMS_DURABLE_TABLES = ['merchants', 'orders', 'restaurant_bill_payments', 'restaurant_bills', 'restaurant_kds_tickets', 'restaurant_receipts', 'restaurant_refunds', 'restaurant_reservations', 'restaurant_sections', 'restaurant_staff', 'restaurant_table_sessions', 'restaurant_tables'];

  /**
   * The store a given RMS domain's rows are being served from, for the route's own reply.
   *
   * Per-domain rather than one label for the whole repository, because `pgEnabled` alone would be
   * a new lie: it is true against a migrated local store while a domain whose table this file never
   * writes is still served from this process's Maps. Every RMS domain names a written table today,
   * so the label is now a fact rather than a caveat — but it stays derived from the pair of lists
   * above so the next domain that lands in the Maps cannot claim a row. A route that names a domain
   * this repository has never heard of throws instead of silently claiming a store.
   */
  dataSourceFor(domain) {
    const map = RestaurantManagementRepository.RMS_DOMAIN_TABLES;
    if (!Object.prototype.hasOwnProperty.call(map, domain)) {
      throw new Error(`Unknown RMS domain: ${domain}`);
    }
    const table = map[domain];
    if (!table) return 'memory';
    return this.pgEnabled && RestaurantManagementRepository.RMS_DURABLE_TABLES.includes(table)
      ? 'postgres'
      : 'memory';
  }

  // --- 1. CHANNEL SETTINGS ---
  async getSettings(merchantId) {
    if (!merchantId) return null;

    // 1. PostgreSQL is the source of truth while the durability gate is open
    if (this.pgEnabled) {
      // Every read goes to the store, because this._settings remembers only what *this* process last
      // wrote: serving it first would keep answering a tax rate a second server, or a restart, had
      // already changed underneath it.
      const { data, error } = await supabaseAdmin
        .from('merchants')
        .select('id, dine_in_enabled, takeaway_enabled, delivery_enabled, tax_rate_percent, service_charge_percent, packaging_fee, upi_id, upi_qr_url, upi_merchant_name, gstin, rms_settings')
        .eq('id', merchantId)
        .maybeSingle();
      if (error) throw storeReadFailure('restaurant settings', error);
      if (data) {
        const s = data.rms_settings || {};
        const settings = {
          merchant_id: merchantId,
          merchantId,
          dine_in_enabled: data.dine_in_enabled !== false,
          dineInEnabled: data.dine_in_enabled !== false,
          takeaway_enabled: data.takeaway_enabled !== false,
          takeawayEnabled: data.takeaway_enabled !== false,
          delivery_enabled: data.delivery_enabled !== false,
          deliveryEnabled: data.delivery_enabled !== false,
          tax_rate_percent: Number(data.tax_rate_percent != null ? data.tax_rate_percent : (s.tax_rate_percent != null ? s.tax_rate_percent : 5.0)),
          taxRatePercent: Number(data.tax_rate_percent != null ? data.tax_rate_percent : (s.tax_rate_percent != null ? s.tax_rate_percent : 5.0)),
          service_charge_percent: Number(data.service_charge_percent != null ? data.service_charge_percent : (s.service_charge_percent != null ? s.service_charge_percent : 0.0)),
          serviceChargePercent: Number(data.service_charge_percent != null ? data.service_charge_percent : (s.service_charge_percent != null ? s.service_charge_percent : 0.0)),
          packaging_fee: Number(data.packaging_fee != null ? data.packaging_fee : (s.packaging_fee != null ? s.packaging_fee : 0.0)),
          packagingFee: Number(data.packaging_fee != null ? data.packaging_fee : (s.packaging_fee != null ? s.packaging_fee : 0.0)),
          prep_time_minutes: Number(s.prep_time_minutes || 20),
          prepTimeMinutes: Number(s.prep_time_minutes || 20),
          currency: 'INR',
          upi_id: data.upi_id || null,
          upiId: data.upi_id || null,
          upi_qr_url: data.upi_qr_url || null,
          upiQrUrl: data.upi_qr_url || null,
          upi_merchant_name: data.upi_merchant_name || null,
          upiMerchantName: data.upi_merchant_name || null,
          gstin: data.gstin || null,
          gst_number: data.gstin || null
        };
        this._settings.set(merchantId, settings);
        return settings;
      }
    } else {
      this._rejectMemoryFallback('restaurant settings');
      const cached = this._settings.get(merchantId);
      if (cached) return cached;
    }

    const merchant = this.db?.merchants?.find(m => m.id === merchantId || m.uuid === merchantId) || {};
    const defaultSettings = {
      merchant_id: merchantId,
      merchantId,
      dine_in_enabled: merchant.dine_in_enabled !== false,
      dineInEnabled: merchant.dine_in_enabled !== false,
      takeaway_enabled: merchant.takeaway_enabled !== false,
      takeawayEnabled: merchant.takeaway_enabled !== false,
      delivery_enabled: merchant.delivery_enabled !== false,
      deliveryEnabled: merchant.delivery_enabled !== false,
      tax_rate_percent: Number(merchant.tax_rate_percent || 5.0),
      taxRatePercent: Number(merchant.tax_rate_percent || 5.0),
      service_charge_percent: Number(merchant.service_charge_percent || 0.0),
      serviceChargePercent: Number(merchant.service_charge_percent || 0.0),
      packaging_fee: Number(merchant.packaging_fee || 0.0),
      packagingFee: Number(merchant.packaging_fee || 0.0),
      prep_time_minutes: 20,
      prepTimeMinutes: 20,
      currency: 'INR',
      upi_id: merchant.upi_id || null,
      upiId: merchant.upi_id || null,
      upi_qr_url: merchant.upi_qr_url || null,
      upiQrUrl: merchant.upi_qr_url || null,
      upi_merchant_name: merchant.upi_merchant_name || merchant.name || null,
      upiMerchantName: merchant.upi_merchant_name || merchant.name || null,
      gstin: merchant.gstin || null,
      gst_number: merchant.gstin || null
    };
    this._settings.set(merchantId, defaultSettings);
    return defaultSettings;
  }

  async updateSettings(merchantId, update) {
    const current = await this.getSettings(merchantId);
    const dineIn = update.dine_in_enabled !== undefined ? update.dine_in_enabled : update.dineInEnabled;
    const takeaway = update.takeaway_enabled !== undefined ? update.takeaway_enabled : update.takeawayEnabled;
    const delivery = update.delivery_enabled !== undefined ? update.delivery_enabled : update.deliveryEnabled;
    const tax = update.tax_rate_percent !== undefined ? update.tax_rate_percent : update.taxRatePercent;
    const sc = update.service_charge_percent !== undefined ? update.service_charge_percent : update.serviceChargePercent;
    const pkg = update.packaging_fee !== undefined ? update.packaging_fee : update.packagingFee;
    const prep = update.prep_time_minutes !== undefined ? update.prep_time_minutes : update.prepTimeMinutes;

    let upiId = update.upi_id !== undefined ? update.upi_id : update.upiId;
    let upiQrUrl = update.upi_qr_url !== undefined ? update.upi_qr_url : update.upiQrUrl;
    let upiMerchantName = update.upi_merchant_name !== undefined ? update.upi_merchant_name : update.upiMerchantName;
    let gstin = update.gstin !== undefined ? update.gstin : update.gst_number;

    if (upiId !== undefined) {
      if (upiId === null || String(upiId).trim() === '') {
        upiId = null;
      } else {
        const trimmed = String(upiId).trim();
        if (!validateUpiIdFormat(trimmed)) {
          const err = new Error("Invalid UPI ID format. Expected format: username@bank (e.g. 'rest@okhdfcbank').");
          err.code = 'INVALID_UPI_ID';
          err.statusCode = 400;
          throw err;
        }
        upiId = trimmed;
      }
    }

    if (upiQrUrl !== undefined && upiQrUrl !== null && String(upiQrUrl).trim() !== '') {
      validateQrImage(upiQrUrl, update.mimeType);
    } else if (upiQrUrl === '') {
      upiQrUrl = null;
    }

    const updated = {
      ...current,
      ...(dineIn !== undefined ? { dine_in_enabled: !!dineIn, dineInEnabled: !!dineIn } : {}),
      ...(takeaway !== undefined ? { takeaway_enabled: !!takeaway, takeawayEnabled: !!takeaway } : {}),
      ...(delivery !== undefined ? { delivery_enabled: !!delivery, deliveryEnabled: !!delivery } : {}),
      ...(tax !== undefined ? { tax_rate_percent: Number(tax), taxRatePercent: Number(tax) } : {}),
      ...(sc !== undefined ? { service_charge_percent: Number(sc), serviceChargePercent: Number(sc) } : {}),
      ...(pkg !== undefined ? { packaging_fee: Number(pkg), packagingFee: Number(pkg) } : {}),
      ...(prep !== undefined ? { prep_time_minutes: Number(prep), prepTimeMinutes: Number(prep) } : {}),
      ...(upiId !== undefined ? { upi_id: upiId, upiId } : {}),
      ...(upiQrUrl !== undefined ? { upi_qr_url: upiQrUrl, upiQrUrl } : {}),
      ...(upiMerchantName !== undefined ? { upi_merchant_name: upiMerchantName, upiMerchantName } : {}),
      ...(gstin !== undefined ? { gstin, gst_number: gstin } : {})
    };
    // Persist first, commit second. The set used to happen before the update was attempted, so a
    // refusal left this process serving a tax rate the database had rejected.
    await this._persistSettings(merchantId, updated);
    this._settings.set(merchantId, updated);
    return updated;
  }

  async _persistSettings(merchantId, settings) {
    if (!merchantId || !settings) return;
    if (!this.pgEnabled) return;
    let existing;
    try {
      existing = await supabaseAdmin
        .from('merchants')
        .select('rms_settings')
        .eq('id', merchantId)
        .maybeSingle();
    } catch (err) {
      throw storeFailure('channel settings update', err);
    }
    if (existing && existing.error) throw storeFailure('channel settings lookup', existing.error);
    const currentExtras = (existing && existing.data && existing.data.rms_settings) || {};
    const extras = {
      ...currentExtras,
      prep_time_minutes: Number(settings.prep_time_minutes != null ? settings.prep_time_minutes : (settings.prepTimeMinutes != null ? settings.prepTimeMinutes : 20))
    };
    let written;
    try {
      written = await supabaseAdmin
        .from('merchants')
        .update({
          dine_in_enabled: settings.dine_in_enabled !== false,
          takeaway_enabled: settings.takeaway_enabled !== false,
          delivery_enabled: settings.delivery_enabled !== false,
          tax_rate_percent: Number(settings.tax_rate_percent != null ? settings.tax_rate_percent : 5.0),
          service_charge_percent: Number(settings.service_charge_percent != null ? settings.service_charge_percent : 0.0),
          packaging_fee: Number(settings.packaging_fee != null ? settings.packaging_fee : 0.0),
          upi_id: settings.upi_id || null,
          upi_qr_url: settings.upi_qr_url || null,
          upi_merchant_name: settings.upi_merchant_name || null,
          gstin: settings.gstin || null,
          rms_settings: extras
        })
        .eq('id', merchantId);
    } catch (err) {
      throw storeFailure('channel settings update', err);
    }
    if (written && written.error) throw storeFailure('channel settings update', written.error);
  }

  async updatePaymentSettings(merchantId, data = {}, callerRole = 'OWNER') {
    if (!merchantId) throw new Error('merchantId is required.');
    const roleUpper = String(callerRole || 'OWNER').toUpperCase();
    const authorized = ['OWNER', 'MANAGER'].includes(roleUpper);
    if (!authorized) {
      const err = new Error('Unauthorized: Only restaurant owners and managers can update payment settings.');
      err.code = 'FORBIDDEN_PAYMENT_SETTINGS';
      err.statusCode = 403;
      throw err;
    }

    return this.updateSettings(merchantId, data);
  }

  // --- 2. FLOOR & TABLES ---

  /**
   * The restaurant_tables rows the store holds for one merchant, a table id, or a QR token.
   *
   * One place so the three read paths cannot each grow their own column list and their own idea of
   * what a refused read means. `merchant_id` is in the filter whenever the caller has it, so a
   * tenant's floor is scoped by the store rather than by this process choosing to honour it.
   */
  async _pgTableRows({ merchantId = null, tableId = null, qrToken = null } = {}) {
    let query = supabaseAdmin
      .from('restaurant_tables')
      .select('id, merchant_id, section_id, table_number, table_name, capacity, status, qr_code_token, current_session_id, created_at, updated_at');
    if (merchantId) query = query.eq('merchant_id', merchantId);
    if (tableId) query = query.eq('id', tableId);
    if (qrToken) query = query.eq('qr_code_token', qrToken);
    const { data, error } = await query.order('table_number', { ascending: true });
    if (error) throw storeReadFailure('floor tables', error);
    return Array.isArray(data) ? data : [];
  }

  /**
   * A table row plus the live state the floor plan claims for it, in three batched reads.
   *
   * The shape this file used to return carried `activeOrdersCount: 0` and `unpaidBalance: 0` as
   * literals on every durable table, so a full floor with a party's ₹1,240 outstanding displayed a
   * clean table to the cashier. Those are claims, and a claim has to be read from somewhere: section
   * names, the session (if any) sitting on each table, and the orders attached to that session. Each
   * is one query for the whole page rather than four per table.
   *
   * A read that fails throws. Half a decorated floor — names but no balances — would be the same
   * invention in a new place.
   */
  async _decorateTables(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { tables: [], sessionByTableId: new Map() };
    const tableIds = rows.map(r => r.id);

    const sectionIds = [...new Set(rows.map(r => r.section_id).filter(Boolean))];
    const sectionNameById = new Map();
    if (sectionIds.length > 0) {
      const res = await supabaseAdmin.from('restaurant_sections').select('id, name').in('id', sectionIds);
      if (res.error) throw storeReadFailure('floor sections', res.error);
      (res.data || []).forEach(s => sectionNameById.set(s.id, s.name));
    }

    const sessionByTableId = new Map();
    const sessRes = await supabaseAdmin
      .from('restaurant_table_sessions')
      .select(SESSION_COLS)
      .in('table_id', tableIds)
      .in('status', ['ACTIVE', 'BILL_REQUESTED']);
    if (sessRes.error) throw storeReadFailure('dining session', sessRes.error);
    (sessRes.data || []).forEach(s => sessionByTableId.set(s.table_id, normSessionRow(s)));

    const sessionIds = [...sessionByTableId.values()].map(s => s.id);
    const orderCountBySessionId = new Map();
    if (sessionIds.length > 0) {
      const ordRes = await supabaseAdmin.from('orders').select('id, table_session_id').in('table_session_id', sessionIds);
      if (ordRes.error) throw storeReadFailure('dine-in orders', ordRes.error);
      (ordRes.data || []).forEach(o => {
        orderCountBySessionId.set(o.table_session_id, (orderCountBySessionId.get(o.table_session_id) || 0) + 1);
      });
    }

    const tables = rows.map(r => {
      const t = normTableRow(r, r.section_id ? (sectionNameById.get(r.section_id) || null) : null);
      // Keyed off the table, not off `current_session_id`: if the two columns ever disagree, the
      // session the store actually holds on this table is the one the cashier is standing at.
      const s = sessionByTableId.get(r.id) || null;
      if (s) {
        t.activeOrdersCount = orderCountBySessionId.get(s.id) || 0;
        t.unpaidBalance = s.balanceAmount;
      }
      return t;
    });
    return { tables, sessionByTableId };
  }

  /** One row through the decoration, for the write paths that answer a single table. */
  async _decorateTable(row) {
    const { tables } = await this._decorateTables([row]);
    return tables[0] || null;
  }

  async getSections(merchantId) {
    if (!merchantId) return [];
    if (this.pgEnabled) {
      const { data, error } = await supabaseAdmin
        .from('restaurant_sections')
        .select('id, merchant_id, name, sort_order, created_at')
        .eq('merchant_id', merchantId)
        .order('sort_order', { ascending: true });
      // A floor the store could not answer used to be caught and dropped, and the caller received
      // whatever this process last remembered — including nothing at all after a restart.
      if (error) throw storeReadFailure('floor sections', error);
      const sections = (Array.isArray(data) ? data : []).map(s => ({
        id: s.id,
        merchantId: s.merchant_id,
        merchant_id: s.merchant_id,
        name: s.name,
        floor: Number(s.sort_order || 1),
        sort_order: Number(s.sort_order || 0),
        createdAt: s.created_at
      }));
      sections.forEach(s => this._sections.set(s.id, s));
      return sections;
    }
    this._rejectMemoryFallback('floor sections');
    return Array.from(this._sections.values()).filter(s => s.merchantId === merchantId || s.merchant_id === merchantId);
  }

  async _ensureSection(merchantId, name) {
    if (!name) return null;
    const existing = Array.from(this._sections.values()).find(
      s => (s.merchantId === merchantId || s.merchant_id === merchantId) && s.name === name
    );
    if (existing) return existing.id;
    if (this.pgEnabled) {
      let found;
      try {
        found = await supabaseAdmin
          .from('restaurant_sections')
          .select('id')
          .eq('merchant_id', merchantId)
          .eq('name', name)
          .maybeSingle();
      } catch (err) {
        throw storeFailure('floor section lookup', err);
      }
      if (found && found.error) throw storeFailure('floor section lookup', found.error);
      if (found && found.data) {
        this._sections.set(found.data.id, { id: found.data.id, merchantId, merchant_id: merchantId, name });
        return found.data.id;
      }
      const id = crypto.randomUUID();
      let ins;
      try {
        ins = await supabaseAdmin
          .from('restaurant_sections')
          .insert({ id, merchant_id: merchantId, name, sort_order: 1 });
      } catch (err) {
        throw storeFailure('floor section', err);
      }
      // Falling through to the memory path here was how a floor that was never written became a
      // table's home, and then the table's section_id a durable row points at nothing.
      if (ins && ins.error) throw storeFailure('floor section', ins.error);
      this._sections.set(id, { id, merchantId, merchant_id: merchantId, name, floor: 1, sort_order: 1 });
      return id;
    }
    const created = await this.createSection(merchantId, { name });
    return created.id;
  }

  async createSection(merchantId, { name, floor = 1 }) {
    if (!name) throw new Error('Section name is required.');
    const id = crypto.randomUUID();
    const section = {
      id,
      merchantId,
      merchant_id: merchantId,
      name,
      floor: Number(floor) || 1,
      sort_order: Number(floor) || 1,
      createdAt: new Date().toISOString()
    };
    if (this.pgEnabled) {
      let ins;
      try {
        ins = await supabaseAdmin
          .from('restaurant_sections')
          .insert({ id, merchant_id: merchantId, name, sort_order: section.sort_order });
      } catch (err) {
        throw storeFailure('floor section', err);
      }
      if (ins && ins.error) throw storeFailure('floor section', ins.error);
      this._sections.set(id, section);
      return section;
    }
    this._rejectMemoryFallback('floor section');
    this._sections.set(id, section);
    return section;
  }

  async getTables(merchantId) {
    if (!merchantId) return [];
    if (this.pgEnabled) {
      const rows = await this._pgTableRows({ merchantId });
      const { tables } = await this._decorateTables(rows);
      tables.forEach(t => this._tables.set(t.id, t));
      return tables;
    }
    this._rejectMemoryFallback('floor tables');
    return Array.from(this._tables.values()).filter(t => t.merchantId === merchantId || t.merchant_id === merchantId);
  }

  async getTableById(merchantId, tableId) {
    if (!tableId) return null;
    if (this.pgEnabled) {
      // The store answers this by id and tenant, so a table belongs to a restaurant because
      // PostgreSQL says it does rather than because this process happened to cache it.
      const rows = await this._pgTableRows({ merchantId, tableId });
      if (rows.length === 0) return null;
      const table = await this._decorateTable(rows[0]);
      if (table) this._tables.set(table.id, table);
      return table;
    }
    this._rejectMemoryFallback('floor table');
    const t = this._tables.get(tableId);
    if (!t || (t.merchantId !== merchantId && t.merchant_id !== merchantId)) return null;
    return t;
  }

  async createTable(merchantId, data = {}) {
    const tableNumber = data.table_number || data.tableNumber;
    const tableName = data.name || data.tableName || data.table_name || `Table ${tableNumber}`;
    const capacity = Number(data.capacity) || 4;
    const sectionName = data.section_name || data.sectionName || 'Main Floor';

    if (!tableNumber) throw new Error('tableNumber is required.');
    if (!this.pgEnabled) {
      this._rejectMemoryFallback('floor table');
      // Only the memory path needs this scan. While the durability gate is open the store owns the
      // rule: `restaurant_tables_merchant_id_table_number_key` is a UNIQUE on exactly this pair, and
      // a scan of this process's Map would let a table another server created slip through.
      const existing = Array.from(this._tables.values()).find(
        t => (t.merchantId === merchantId || t.merchant_id === merchantId) &&
             (t.tableNumber === String(tableNumber) || t.table_number === String(tableNumber))
      );
      if (existing) {
        const err = new Error(`Table ${tableNumber} already exists in this restaurant.`);
        err.code = 'TABLE_ALREADY_EXISTS';
        err.statusCode = 409;
        throw err;
      }
    }

    const id = crypto.randomUUID();
    const qrToken = `qr_${merchantId.substring(0, 8)}_${tableNumber}_${crypto.randomBytes(6).toString('hex')}`;
    const sectionId = await this._ensureSection(merchantId, sectionName);

    if (this.pgEnabled) {
      let ins;
      try {
        ins = await supabaseAdmin.from('restaurant_tables').insert({
          id,
          merchant_id: merchantId,
          table_number: String(tableNumber),
          table_name: tableName,
          capacity,
          section_id: sectionId || null,
          status: 'AVAILABLE',
          qr_code_token: qrToken
        }).select('id, merchant_id, section_id, table_number, table_name, capacity, status, qr_code_token, current_session_id, created_at, updated_at');
      } catch (err) {
        throw storeFailure('floor table', err);
      }
      if (ins && ins.error) {
        // The engine's own name for the constraint says which rule was broken; the merchant's
        // answer stays the code the in-memory path used for the same collision.
        if (String(ins.error.code) === '23505' && /merchant_id_table_number_key/.test(String(ins.error.message || ''))) {
          const err = new Error(`Table ${tableNumber} already exists in this restaurant.`);
          err.code = 'TABLE_ALREADY_EXISTS';
          err.statusCode = 409;
          throw err;
        }
        throw storeFailure('floor table', ins.error);
      }
      const stored = Array.isArray(ins.data) ? ins.data[0] : null;
      if (stored) {
        const table = normTableRow(stored, sectionName);
        this._tables.set(table.id, table);
        return table;
      }
    }

    const qrUrl = diningQrUrl(qrToken);
    const table = {
      id,
      merchantId,
      merchant_id: merchantId,
      tableNumber: String(tableNumber),
      table_number: String(tableNumber),
      tableName,
      name: tableName,
      table_name: tableName,
      capacity,
      sectionId: sectionId || null,
      section_id: sectionId || null,
      sectionName,
      section_name: sectionName,
      status: 'AVAILABLE',
      qrCodeToken: qrToken,
      qr_token: qrToken,
      qr_code_token: qrToken,
      qr_url: qrUrl,
      qrUrl,
      currentSessionId: null,
      current_session_id: null,
      activeOrdersCount: 0,
      unpaidBalance: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this._tables.set(id, table);
    return table;
  }

  async updateTable(merchantId, tableId, update) {
    if (this.pgEnabled) {
      const rows = await this._pgTableRows({ merchantId, tableId });
      if (rows.length === 0) return null;
      const sectionName = update.section_name !== undefined ? update.section_name : update.sectionName;
      const sectionId = sectionName ? await this._ensureSection(merchantId, sectionName) : null;
      const tableNumber = update.table_number !== undefined ? update.table_number : update.tableNumber;
      const name = update.name !== undefined ? update.name : update.tableName;
      // null means "leave that column alone" — every SET in rms_update_table_atomic is a COALESCE
      // against its argument, so an absent field must not arrive as an empty one.
      const payload = await this._rpc('floor table', 'rms_update_table_atomic', {
        p_merchant_id: merchantId,
        p_table_id: tableId,
        p_table_number: tableNumber != null && tableNumber !== '' ? String(tableNumber) : null,
        p_name: name != null && name !== '' ? String(name) : null,
        p_capacity: update.capacity != null ? Number(update.capacity) : null,
        p_section_id: sectionId
      });
      const table = await this._decorateTable(payload.data);
      if (table) this._tables.set(table.id, table);
      return table;
    }
    this._rejectMemoryFallback('floor table');
    const table = this._tables.get(tableId);
    if (!table || (table.merchantId !== merchantId && table.merchant_id !== merchantId)) return null;

    const tNum = update.table_number || update.tableNumber;
    if (tNum && tNum !== table.tableNumber) {
      const conflict = Array.from(this._tables.values()).find(
        t => (t.merchantId === merchantId || t.merchant_id === merchantId) &&
             (t.tableNumber === String(tNum) || t.table_number === String(tNum)) &&
             t.id !== tableId
      );
      if (conflict) {
        const err = new Error(`Table ${tNum} already exists.`);
        err.code = 'TABLE_ALREADY_EXISTS';
        err.statusCode = 409;
        throw err;
      }
      table.tableNumber = String(tNum);
      table.table_number = String(tNum);
    }
    if (update.name !== undefined || update.tableName !== undefined) {
      const name = update.name || update.tableName;
      table.tableName = name;
      table.name = name;
    }
    if (update.capacity !== undefined) table.capacity = Number(update.capacity);
    if (update.section_name !== undefined || update.sectionName !== undefined) {
      const s = update.section_name || update.sectionName;
      table.sectionName = s;
      table.section_name = s;
    }
    table.updatedAt = new Date().toISOString();
    return table;
  }

  async setTableStatus(merchantId, tableId, status) {
    if (!TABLE_STATUSES.includes(status)) {
      const err = new Error(`Invalid table status: ${status}. Must be one of: ${TABLE_STATUSES.join(', ')}`);
      // The same code the durable rule answers with, so a caller gets one vocabulary whichever store
      // served them rather than a code in one mode and a bare 400 in the other.
      err.code = 'INVALID_TABLE_STATUS';
      err.statusCode = 400;
      throw err;
    }
    if (this.pgEnabled) {
      const payload = await this._rpc('table status', 'rms_set_table_status_atomic', {
        p_merchant_id: merchantId,
        p_table_id: tableId,
        p_status: status
      });
      const table = await this._decorateTable(payload.data);
      if (table) this._tables.set(table.id, table);
      return table;
    }
    this._rejectMemoryFallback('table status');
    const table = this._tables.get(tableId);
    if (!table || (table.merchantId !== merchantId && table.merchant_id !== merchantId)) return null;

    // Safety guard: cannot mark AVAILABLE if an active session with unpaid balance remains
    const sessId = table.currentSessionId || table.current_session_id;
    if (status === 'AVAILABLE' && sessId) {
      const session = this._sessions.get(sessId);
      if (session && session.status === 'ACTIVE' && (session.totalAmount > session.paidAmount || (session.balanceAmount || session.balance_amount || 0) > 0.01)) {
        const err = new Error('Cannot set table AVAILABLE while active session has an unpaid balance. Settle bill or close session first.');
        err.code = 'TABLE_SESSION_UNPAID';
        err.statusCode = 400;
        throw err;
      }
    }

    table.status = status;
    if (status === 'AVAILABLE') {
      table.currentSessionId = null;
      table.current_session_id = null;
      table.activeOrdersCount = 0;
      table.unpaidBalance = 0;
    }
    table.updatedAt = new Date().toISOString();
    return table;
  }

  async regenerateTableQr(merchantId, tableId) {
    if (this.pgEnabled) {
      const payload = await this._rpc('table QR code', 'rms_regenerate_table_qr_atomic', {
        p_merchant_id: merchantId,
        p_table_id: tableId
      });
      const row = payload.data && payload.data.table ? payload.data.table : null;
      if (!row) throw storeFailure('table QR code', { code: 'RMS_QR_EMPTY', message: 'rms_regenerate_table_qr_atomic returned no table.' });
      const table = await this._decorateTable(row);
      if (table) this._tables.set(table.id, table);
      const qrToken = payload.data.qr_token;
      const qrUrl = diningQrUrl(qrToken);
      return {
        table: table || row,
        qrToken,
        qr_token: qrToken,
        qrUrl,
        qr_url: qrUrl
      };
    }
    this._rejectMemoryFallback('table QR code');
    const table = this._tables.get(tableId);
    if (!table || (table.merchantId !== merchantId && table.merchant_id !== merchantId)) return null;
    const qrToken = `qr_${merchantId.substring(0, 8)}_${table.tableNumber}_${crypto.randomBytes(6).toString('hex')}`;
    const qrUrl = diningQrUrl(qrToken);
    table.qrCodeToken = qrToken;
    table.qr_token = qrToken;
    table.qr_code_token = qrToken;
    table.qrUrl = qrUrl;
    table.qr_url = qrUrl;
    table.updatedAt = new Date().toISOString();
    return {
      table,
      qrToken,
      qr_token: qrToken,
      qrUrl,
      qr_url: qrUrl
    };
  }

  async resolveTableQr(qrToken) {
    return this.getTableByQrToken(qrToken);
  }

  async getTableByQrToken(qrToken) {
    if (!qrToken) return null;
    let table = null;
    let activeSession = null;
    if (this.pgEnabled) {
      // The token is the whole request, so the store is asked by token alone; which restaurant it
      // belongs to comes back with the row rather than being chosen by this process.
      const rows = await this._pgTableRows({ qrToken });
      if (rows.length > 0) {
        const decorated = await this._decorateTables(rows);
        table = decorated.tables[0];
        this._tables.set(table.id, table);
        const s = decorated.sessionByTableId.get(table.id) || null;
        if (s) {
          this._sessions.set(s.id, s);
          activeSession = s;
        }
      }
    } else {
      this._rejectMemoryFallback('floor table');
      table = Array.from(this._tables.values()).find(
        t => t.qrCodeToken === qrToken || t.qr_token === qrToken || t.qr_code_token === qrToken
      ) || null;
      if (table) {
        const sessId = table.currentSessionId || table.current_session_id;
        const s = sessId ? this._sessions.get(sessId) : null;
        if (s && s.status === 'ACTIVE') activeSession = s;
      }
    }
    if (!table) return null;
    const merchant = this.db?.merchants?.find(m => m.id === table.merchantId || m.uuid === table.merchantId) || { id: table.merchantId, name: 'Partner Restaurant' };
    const settings = await this.getSettings(table.merchantId);
    return {
      table,
      merchant,
      settings,
      // Five fields, and no more: this endpoint is unauthenticated, so a diner scanning a sticker
      // gets the table and the party size, never a customer name, phone or order history.
      activeSession: activeSession ? {
        id: activeSession.id,
        guestCount: activeSession.guestCount,
        guest_count: activeSession.guestCount,
        openedAt: activeSession.openedAt,
        opened_at: activeSession.openedAt
      } : null
    };
  }

  // --- 3. DINE-IN TABLE SESSIONS ---
  async openSession(merchantId, tableId, data = {}) {
    return this.openTableSession(merchantId, tableId, data);
  }

  async getOrCreateActiveSession(merchantId, tableId, data = {}) {
    return this.openTableSession(merchantId, tableId, data);
  }

  async openTableSession(merchantId, tableId, data = {}) {
    const guestCount = Math.max(1, Number(data.guest_count || data.guestCount || 2));
    const openedBy = data.opened_by || data.openedBy || 'Staff';
    const notes = data.notes || null;

    if (this.pgEnabled) {
      // One call, one row lock: the function looks the table's live session up under FOR UPDATE and
      // mints one only when there is none, so two cashiers seating the same table in the same second
      // get one session between them instead of one each and a lost party.
      const payload = await this._rpc('dining session', 'rms_open_table_session_atomic', {
        p_merchant_id: merchantId,
        p_table_id: tableId,
        p_guest_count: guestCount,
        p_opened_by: openedBy,
        p_notes: notes
      });
      const session = normSessionRow(payload.data);
      this._sessions.set(session.id, session);
      const cached = this._tables.get(tableId);
      if (cached) {
        cached.currentSessionId = session.id;
        cached.current_session_id = session.id;
        cached.status = 'OCCUPIED';
      }
      return session;
    }

    this._rejectMemoryFallback('dining session');
    const table = await this.getTableById(merchantId, tableId);
    if (!table) throw new Error('Table not found.');

    // If already active, return existing session
    const sessId = table.currentSessionId || table.current_session_id;
    if (sessId) {
      const existing = this._sessions.get(sessId);
      if (existing && existing.status === 'ACTIVE') {
        return existing;
      }
    }

    const sessionId = crypto.randomUUID();
    const sessionToken = `sess_${crypto.randomBytes(12).toString('hex')}`;
    const openedAt = new Date().toISOString();
    const session = {
      id: sessionId,
      merchantId,
      merchant_id: merchantId,
      tableId,
      table_id: tableId,
      tableNumber: table.tableNumber,
      table_number: table.tableNumber,
      sessionToken,
      session_token: sessionToken,
      // The column's own CHECK allows ACTIVE / BILL_REQUESTED / CLOSED / CANCELLED. 'OPEN' was a
      // value only this Map could hold, so the first durable session changed vocabulary on restart.
      status: 'ACTIVE',
      guestCount,
      guest_count: guestCount,
      openedBy,
      opened_by: openedBy,
      openedAt,
      opened_at: openedAt,
      closedAt: null,
      closed_at: null,
      totalAmount: 0.0,
      total_amount: 0.0,
      paidAmount: 0.0,
      paid_amount: 0.0,
      balanceAmount: 0.0,
      balance_amount: 0.0,
      orderIds: [],
      notes,
      orders: [],
      createdAt: openedAt
    };

    this._sessions.set(sessionId, session);
    table.currentSessionId = sessionId;
    table.current_session_id = sessionId;
    table.status = 'OCCUPIED';
    table.updatedAt = new Date().toISOString();

    return session;
  }

  async getActiveSession(merchantId, tableId) {
    if (this.pgEnabled) {
      const rows = await this._pgTableRows({ merchantId, tableId });
      if (rows.length === 0) return null;
      const { tables, sessionByTableId } = await this._decorateTables(rows);
      this._tables.set(tables[0].id, tables[0]);
      const session = sessionByTableId.get(tables[0].id) || null;
      if (session) this._sessions.set(session.id, session);
      return session;
    }
    this._rejectMemoryFallback('dining session');
    const table = await this.getTableById(merchantId, tableId);
    if (!table) return null;
    const sessId = table.currentSessionId || table.current_session_id;
    if (!sessId) return null;
    const session = this._sessions.get(sessId);
    if (!session || session.status !== 'ACTIVE') return null;
    return session;
  }

  /** Whose restaurant a session belongs to, read from the store when the caller did not say. */
  async _sessionMerchantId(sessionId) {
    const { data, error } = await supabaseAdmin
      .from('restaurant_table_sessions')
      .select('id, merchant_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw storeReadFailure('dining session', error);
    if (!data) {
      const err = new Error('Session not found.');
      err.code = 'SESSION_NOT_FOUND';
      err.statusCode = 400;
      throw err;
    }
    return data.merchant_id;
  }

  async recordSessionOrder(sessionId, order, merchantId = null) {
    if (this.pgEnabled) {
      const orderId = order && (order.id || order.orderId);
      if (!orderId) {
        const err = new Error('An order with a persisted id is required to attach it to a table session.');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      const pMerchantId = merchantId || await this._sessionMerchantId(sessionId);
      // The totals come back from the function, which recomputes them from the durable `orders`
      // rows. Accumulating them here is what let a replayed attach count the same order twice.
      const payload = await this._rpc('session order', 'rms_attach_order_to_session_atomic', {
        p_merchant_id: pMerchantId,
        p_session_id: sessionId,
        p_order_id: orderId
      });
      const session = normSessionRow(payload.data);
      session.orderIds = Array.isArray(payload.orderIds) ? payload.orderIds : [];
      this._sessions.set(session.id, session);
      const table = this._tables.get(session.tableId);
      if (table) {
        table.activeOrdersCount = session.orderIds.length;
        table.unpaidBalance = session.balanceAmount;
      }
      return session;
    }

    this._rejectMemoryFallback('session order');
    const session = this._sessions.get(sessionId);
    if (!session) throw new Error('Session not found.');
    session.orders.push(order);
    session.orderIds.push(order.id);
    this._orders.set(order.id, order);

    const amount = Number(order.total_amount || order.totalAmount || 0);
    session.totalAmount = Math.round((session.totalAmount + amount) * 100) / 100;
    session.total_amount = session.totalAmount;
    session.balanceAmount = Math.round((session.totalAmount - session.paidAmount) * 100) / 100;
    session.balance_amount = session.balanceAmount;

    const table = this._tables.get(session.tableId || session.table_id);
    if (table) {
      table.activeOrdersCount = (table.activeOrdersCount || 0) + 1;
      table.unpaidBalance = session.balanceAmount;
    }
    return session;
  }

  async attachOrderToSession(merchantId, sessionId, order) {
    return this.recordSessionOrder(sessionId, order, merchantId);
  }

  async transferSession(merchantId, sessionId, targetTableId) {
    if (this.pgEnabled) {
      const payload = await this._rpc('session transfer', 'rms_transfer_session_atomic', {
        p_merchant_id: merchantId,
        p_session_id: sessionId,
        p_target_table_id: targetTableId
      });
      const d = payload.data || {};
      const session = normSessionRow(d.session);
      this._sessions.set(session.id, session);
      const { tables } = await this._decorateTables([d.fromTable, d.toTable].filter(Boolean));
      tables.forEach(t => this._tables.set(t.id, t));
      const fromTable = tables.find(t => t.id === session.previousTableId) || null;
      const toTable = tables.find(t => t.id === session.tableId) || null;
      return { session, fromTable, toTable };
    }

    this._rejectMemoryFallback('session transfer');
    const session = this._sessions.get(sessionId);
    if (!session || (session.merchantId !== merchantId && session.merchant_id !== merchantId)) throw new Error('Session not found.');
    if (session.status !== 'ACTIVE') throw new Error('Only active sessions can be transferred.');

    const oldTable = this._tables.get(session.tableId || session.table_id);
    const targetTable = await this.getTableById(merchantId, targetTableId);
    if (!targetTable) throw new Error('Target table not found.');
    if (oldTable && targetTable.id === oldTable.id) throw new Error('Target table must be different.');
    if (targetTable.status !== 'AVAILABLE' && targetTable.status !== 'CLEANING') {
      throw new Error(`Target table ${targetTable.tableNumber} is currently ${targetTable.status}.`);
    }

    session.tableId = targetTable.id;
    session.table_id = targetTable.id;
    session.tableNumber = targetTable.tableNumber;
    session.table_number = targetTable.tableNumber;

    if (oldTable) {
      oldTable.status = 'CLEANING';
      oldTable.currentSessionId = null;
      oldTable.current_session_id = null;
      oldTable.activeOrdersCount = 0;
      oldTable.unpaidBalance = 0;
    }

    targetTable.status = 'OCCUPIED';
    targetTable.currentSessionId = session.id;
    targetTable.current_session_id = session.id;
    targetTable.activeOrdersCount = session.orderIds.length;
    targetTable.unpaidBalance = session.balanceAmount;

    return { session, fromTable: oldTable, toTable: targetTable };
  }

  async closeSession(merchantId, sessionId, data = {}) {
    const closedBy = typeof data === 'string'
      ? data
      : ((data && (data.closedBy || data.closed_by)) || null);

    if (this.pgEnabled) {
      // The closure rule is the function's now: rms_generate_bill_atomic pins total_amount to the bill
      // and rms_record_bill_payment/refund keep paid_amount and the balance from the same rows, so
      // rms_close_session_atomic computes total - paid + refunds off durable data and refuses
      // UNPAID_BALANCE inside the transaction that would have closed it. An in-process copy of that
      // arithmetic could only ever be staler than the row it was meant to protect.
      const payload = await this._rpc('session close', 'rms_close_session_atomic', {
        p_merchant_id: merchantId,
        p_session_id: sessionId,
        p_closed_by: closedBy
      });
      const d = payload.data || {};
      const session = normSessionRow(d.session);
      this._sessions.set(session.id, session);
      const table = d.table ? await this._decorateTable(d.table) : null;
      if (table) this._tables.set(table.id, table);
      return { session, table };
    }

    this._rejectMemoryFallback('session close');
    const session = this._sessions.get(sessionId);
    if (!session || (session.merchantId !== merchantId && session.merchant_id !== merchantId)) throw new Error('Session not found.');

    const remaining = Math.round((session.totalAmount - session.paidAmount) * 100) / 100;
    if (remaining > 0.01) {
      const err = new Error(`Cannot close session with unpaid balance of ₹${remaining.toFixed(2)}.`);
      err.code = 'UNPAID_BALANCE';
      err.statusCode = 400;
      throw err;
    }

    session.status = 'CLOSED';
    session.closedAt = new Date().toISOString();
    session.closed_at = session.closedAt;
    if (closedBy) {
      session.closedBy = closedBy;
      session.closed_by = closedBy;
    }

    const table = this._tables.get(session.tableId || session.table_id);
    if (table) {
      table.status = 'CLEANING';
      table.currentSessionId = null;
      table.current_session_id = null;
      table.activeOrdersCount = 0;
      table.unpaidBalance = 0;
      table.updatedAt = new Date().toISOString();
    }

    return { session, table };
  }

  // --- 4. RESERVATIONS ---
  async getReservations(merchantId, { date = null } = {}) {
    if (!merchantId) return [];
    if (this.pgEnabled) {
      let query = supabaseAdmin
        .from('restaurant_reservations')
        .select(RESERVATION_COLS)
        .eq('merchant_id', merchantId);
      // A day the restaurant means in IST. The Map compared `startsWith` against the UTC ISO string,
      // so a booking at 00:30 IST on the 21st was stamped 19:00Z on the 20th and vanished from the
      // list the host was reading for the 21st. Window arithmetic, in the one offset this platform
      // schedules around.
      if (date) {
        const day = String(date).substring(0, 10);
        const start = `${day}T00:00:00+05:30`;
        const end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
        query = query.gte('reservation_time', start).lt('reservation_time', end);
      }
      const { data, error } = await query.order('reservation_time', { ascending: true });
      if (error) throw storeReadFailure('reservations', error);
      return (Array.isArray(data) ? data : []).map(normReservationRow);
    }

    this._rejectMemoryFallback('reservations');
    let list = Array.from(this._reservations.values()).filter(r => r.merchantId === merchantId || r.merchant_id === merchantId);
    if (date) {
      const dateStr = String(date).substring(0, 10);
      list = list.filter(r => (r.reservationTime || r.reservation_time).startsWith(dateStr));
    }
    return list.sort((a, b) => new Date(a.reservationTime || a.reservation_time) - new Date(b.reservationTime || b.reservation_time));
  }

  async createReservation(merchantId, data = {}) {
    const customerName = data.customer_name || data.customerName;
    const customerPhone = data.customer_phone || data.customerPhone;
    const partySize = Number(data.party_size || data.partySize || 2);
    const reservationTime = data.reservation_time || data.reservationTime;
    const tableId = data.table_id || data.tableId || null;
    const notes = data.notes || null;

    if (!customerName || !customerPhone || !reservationTime) {
      throw new Error('customerName, customerPhone, and reservationTime are required.');
    }
    fieldTooLong('customerName', customerName, 120);
    fieldTooLong('customerPhone', customerPhone, 20);
    fieldTooLong('notes', notes, 2000);

    if (this.pgEnabled) {
      // The booking is the function's: it takes an advisory lock on the table and then looks for a
      // live reservation within two hours of the requested time, so two browsers pressing Book on
      // the same table at the same second cannot both be told yes. The Map scan could only ever see
      // this process's own list.
      const payload = await this._rpc('reservation', 'rms_create_reservation_atomic', {
        p_merchant_id: merchantId,
        p_table_id: tableId,
        p_customer_name: String(customerName).trim(),
        p_customer_phone: String(customerPhone).trim(),
        p_party_size: partySize,
        p_reservation_time: new Date(reservationTime).toISOString(),
        p_notes: notes
      });
      const reservation = normReservationRow(payload.data);
      this._reservations.set(reservation.id, reservation);
      return reservation;
    }

    this._rejectMemoryFallback('reservation');

    if (tableId) {
      const table = await this.getTableById(merchantId, tableId);
      if (!table) throw new Error('Assigned table not found.');
      if (partySize > table.capacity) {
        throw new Error(`Party size ${partySize} exceeds table capacity ${table.capacity}.`);
      }
      const targetTime = new Date(reservationTime).getTime();
      const conflict = Array.from(this._reservations.values()).find(r => {
        if ((r.merchantId !== merchantId && r.merchant_id !== merchantId) || (r.tableId !== tableId && r.table_id !== tableId) || r.status === 'CANCELLED') return false;
        const resTime = new Date(r.reservationTime || r.reservation_time).getTime();
        return Math.abs(resTime - targetTime) < 2 * 60 * 60 * 1000;
      });
      if (conflict) {
        const err = new Error(`Table ${table.tableNumber} is already reserved around that time.`);
        err.code = 'RESERVATION_CONFLICT';
        err.statusCode = 409;
        throw err;
      }
    }

    const id = crypto.randomUUID();
    const res = {
      id,
      merchantId,
      merchant_id: merchantId,
      tableId,
      table_id: tableId,
      customerName,
      customer_name: customerName,
      customerPhone,
      customer_phone: customerPhone,
      partySize,
      party_size: partySize,
      reservationTime: new Date(reservationTime).toISOString(),
      reservation_time: new Date(reservationTime).toISOString(),
      status: 'CONFIRMED',
      notes,
      createdAt: new Date().toISOString()
    };
    this._reservations.set(id, res);
    return res;
  }

  async updateReservationStatus(merchantId, reservationId, status) {
    if (this.pgEnabled) {
      if (!isUuid(reservationId)) {
        const err = new Error('Reservation not found.');
        err.code = 'RESERVATION_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      // The ladder is the function's: PENDING -> CONFIRMED -> SEATED, with CANCELLED/NO_SHOW
      // reachable from the live states. The Map accepted any string, so a reservation could be
      // moved from NO_SHOW back to CONFIRMED and the floor would believe the party was coming.
      const payload = await this._rpc('reservation', 'rms_update_reservation_status_atomic', {
        p_merchant_id: merchantId,
        p_reservation_id: reservationId,
        p_status: status,
        p_updated_by: null
      });
      const reservation = normReservationRow(payload.data);
      // The same-status call is the one case where the row did not move: a host tapping SEATED twice
      // on a slow connection gets the booking back unchanged, and `duplicate` is the only field that
      // says so. `status_changed_at` and `updated_by` stay where the first press left them.
      reservation.duplicate = Boolean(payload.duplicate);
      this._reservations.set(reservation.id, reservation);
      return reservation;
    }

    this._rejectMemoryFallback('reservation');
    const res = this._reservations.get(reservationId);
    if (!res || (res.merchantId !== merchantId && res.merchant_id !== merchantId)) throw new Error('Reservation not found.');
    res.status = status;
    const tId = res.tableId || res.table_id;
    if (status === 'SEATED' && tId) {
      await this.setTableStatus(merchantId, tId, 'OCCUPIED');
    }
    return res;
  }

  // --- 5. DINE-IN BILLING & BILL SPLITTING ---

  /**
   * The restaurant_bills row a bill id or a session id names, or null.
   *
   * Callers pass whichever of the two the cashier reached: the web client bills the table it is
   * standing at and hands a session id, while the split and payment routes resolve the session first
   * and hand over `bill.id`. Newest-first because a table that was billed, closed and re-opened must
   * not answer a bill that is already settled.
   */
  async _pgBillRow({ merchantId = null, billId = null, sessionId = null } = {}) {
    let query = supabaseAdmin.from('restaurant_bills').select(BILL_COLS);
    if (merchantId) query = query.eq('merchant_id', merchantId);
    if (billId) query = query.eq('id', billId);
    if (sessionId) query = query.eq('table_session_id', sessionId);
    const { data, error } = await query.order('created_at', { ascending: false }).limit(1);
    if (error) throw storeReadFailure('bill', error);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  }

  /**
   * The payment and refund rows for one bill, or for a whole page of bills, in two reads.
   *
   * A bill used to carry its tenders in the bill's own `payments` jsonb. 043 writes every tender as
   * its own row and stops touching that column, so a document read from the column would answer
   * `payments: []` for ₹472.50 the restaurant has actually collected. Batched because a twenty-row
   * search page must not cost forty queries.
   */
  async _pgBillTenders(billIds) {
    const ids = [...new Set((Array.isArray(billIds) ? billIds : [billIds]).filter(Boolean))];
    const paymentsByBill = new Map();
    const refundsByBill = new Map();
    if (ids.length === 0) return { paymentsByBill, refundsByBill };

    const payRes = await supabaseAdmin
      .from('restaurant_bill_payments')
      .select(BILL_PAYMENT_COLS)
      .in('bill_id', ids)
      .order('created_at', { ascending: true });
    if (payRes.error) throw storeReadFailure('bill payments', payRes.error);
    const refRes = await supabaseAdmin
      .from('restaurant_refunds')
      .select(BILL_REFUND_COLS)
      .in('bill_id', ids)
      .order('created_at', { ascending: true });
    if (refRes.error) throw storeReadFailure('bill refunds', refRes.error);

    (payRes.data || []).forEach(p => {
      const bucket = paymentsByBill.get(p.bill_id) || [];
      bucket.push(normPaymentRow(p));
      paymentsByBill.set(p.bill_id, bucket);
    });
    (refRes.data || []).forEach(r => {
      const bucket = refundsByBill.get(r.bill_id) || [];
      bucket.push(normRefundRow(r));
      refundsByBill.set(r.bill_id, bucket);
    });
    return { paymentsByBill, refundsByBill };
  }

  /** A bill row and its tenders, as the document every RMS caller reads, cached for this process. */
  async _billDocument(row) {
    if (!row) return null;
    const { paymentsByBill, refundsByBill } = await this._pgBillTenders(row.id);
    const doc = normBillRow(row, {
      payments: paymentsByBill.get(row.id) || [],
      refunds: refundsByBill.get(row.id) || []
    });
    this._bills.set(doc.id, doc);
    return doc;
  }

  /**
   * The store's bill for a session, minted when it does not exist yet.
   *
   * `rms_generate_bill_atomic` is idempotent under a row lock, so asking twice hands back the same
   * bill and touches nothing — which is why resolving "no bill for this id" into a generate is safe.
   * It is also the only thing that pins the session's total and the table's status to the bill, so
   * the session and table caches are re-read from the store afterwards rather than written here.
   */
  async _generateDurableBill(merchantId, sessionId, { generatedBy = null } = {}) {
    const payload = await this._rpc('bill generation', 'rms_generate_bill_atomic', {
      p_merchant_id: merchantId,
      p_session_id: sessionId,
      p_generated_by: generatedBy
    });
    await this._syncBillMoneyCache(sessionId);
    return this._billDocument(payload.data);
  }

  /**
   * The bill a caller's id names — a bill id, a session id, or a session that is not billed yet.
   *
   * `generate: false` is for the operations that must not mint a bill as a side effect: a refund
   * against a bill that was never issued is a mistake, not a request to issue one. An id that cannot
   * name a uuid column is answered as not-found rather than sent to the engine, where 22P02 would
   * reach the merchant as an outage.
   */
  async _durableBillFor(merchantId, billOrSessionId, { generate = true, generatedBy = null } = {}) {
    if (!isUuid(billOrSessionId)) return null;
    const row = await this._pgBillRow({ merchantId, billId: billOrSessionId })
      || await this._pgBillRow({ merchantId, sessionId: billOrSessionId });
    if (row) return this._billDocument(row);
    if (!generate) return null;
    return this._generateDurableBill(merchantId, billOrSessionId, { generatedBy });
  }

  /**
   * Put a session's and its table's money figures back from the store after a billing write.
   *
   * The billing functions move `restaurant_table_sessions.total_amount/paid_amount/balance_amount`
   * and the table's status in the same transaction as the bill, and the floor plan, the closure
   * guard and the cashier's screen all read this process's cache. A cache left at the pre-payment
   * figures is how a table shows ₹650 due after the customer settled it. Re-read rather than
   * recompute: this process is not the authority on its own money. `orderIds` is carried over
   * because it is this file's record of what was attached and no column holds it.
   */
  async _syncBillMoneyCache(sessionId) {
    if (!isUuid(sessionId)) return;
    const { data, error } = await supabaseAdmin
      .from('restaurant_table_sessions')
      .select(SESSION_COLS)
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw storeReadFailure('dining session', error);
    if (!data) return;
    const session = normSessionRow(data);
    const previous = this._sessions.get(session.id);
    if (previous && Array.isArray(previous.orderIds)) session.orderIds = previous.orderIds;
    this._sessions.set(session.id, session);
    if (!session.tableId) return;
    const rows = await this._pgTableRows({ merchantId: session.merchantId, tableId: session.tableId });
    if (rows.length === 0) return;
    const { tables } = await this._decorateTables(rows);
    tables.forEach(t => this._tables.set(t.id, t));
  }

  async generateSessionBill(merchantId, sessionId) {
    return this.getBillForSession(merchantId, sessionId);
  }

  async getBillForSession(merchantId, sessionId) {
    if (this.pgEnabled) {
      const bill = await this._durableBillFor(merchantId, sessionId);
      if (!bill) throw billNotFound();
      return bill;
    }

    // Outside the durability gate the bill is still this process's invention, and a production
    // process is not allowed to hand one out: see _rejectMemoryFallback.
    this._rejectMemoryFallback('dining bill');
    const session = this._sessions.get(sessionId);
    if (!session || (session.merchantId !== merchantId && session.merchant_id !== merchantId)) throw new Error('Session not found.');

    let bill = Array.from(this._bills.values()).find(b => b.tableSessionId === sessionId || b.session_id === sessionId);
    if (!bill) {
      const settings = await this.getSettings(merchantId);
      let subtotal = 0;
      if (session.orders && session.orders.length > 0) {
        for (const ord of session.orders) {
          if (ord.items && ord.items.length > 0) {
            for (const it of ord.items) {
              subtotal += Number(it.line_total || (it.unit_price_snapshot * it.quantity) || 0);
            }
          } else {
            subtotal += Number(ord.total_amount || 0);
          }
        }
      } else {
        subtotal = Number(session.totalAmount || 0);
      }

      const taxRate = (settings.taxRatePercent || settings.tax_rate_percent || 5.0) / 100;
      const serviceRate = (settings.serviceChargePercent || settings.service_charge_percent || 0.0) / 100;

      const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
      const serviceCharge = Math.round(subtotal * serviceRate * 100) / 100;
      const packagingFee = 0.0;
      const totalAmount = Math.round((subtotal + taxAmount + serviceCharge + packagingFee) * 100) / 100;

      const billId = crypto.randomUUID();
      const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

      const items = [];
      if (session.orders && session.orders.length > 0) {
        for (const ord of session.orders) {
          if (ord.items && ord.items.length > 0) {
            for (const it of ord.items) {
              items.push({
                name: it.dish_name || it.name || it.product_name || 'Dish',
                quantity: Number(it.quantity || 1),
                unitPrice: Number(it.unit_price_snapshot || it.price || 0),
                lineTotal: Number(it.line_total || ((it.unit_price_snapshot || it.price || 0) * (it.quantity || 1)))
              });
            }
          }
        }
      }

      const merchantObj = (this.db?.merchants || []).find(m => m.id === merchantId || m.uuid === merchantId) || {};
      const merchantDetails = {
        name: merchantObj.name || merchantObj.business_name || 'NABIN Restaurant',
        address: merchantObj.address || merchantObj.location || '124 Station Road',
        phone: merchantObj.phone || '',
        gstin: settings.gstin || settings.gst_number || merchantObj.gstin || null
      };

      const paymentInstructions = {
        upiId: settings.upiId || settings.upi_id || null,
        upiQrUrl: settings.upiQrUrl || settings.upi_qr_url || null,
        instruction: (settings.upiQrUrl || settings.upi_qr_url)
          ? 'Scan with your UPI app and enter the bill amount.'
          : (settings.upiId || settings.upi_id ? `Pay via UPI to ${settings.upiId || settings.upi_id}` : null)
      };

      bill = {
        id: billId,
        invoiceNumber,
        invoice_number: invoiceNumber,
        merchantId,
        merchant_id: merchantId,
        merchantDetails,
        merchant_details: merchantDetails,
        paymentInstructions,
        payment_instructions: paymentInstructions,
        tableSessionId: sessionId,
        session_id: sessionId,
        tableNumber: session.tableNumber || session.table_number,
        items,
        subtotal,
        taxAmount,
        tax_amount: taxAmount,
        gstAmount: taxAmount,
        gst_amount: taxAmount,
        serviceCharge,
        service_charge_amount: serviceCharge,
        packagingFee,
        packaging_fee_amount: packagingFee,
        dineInPackagingFee: packagingFee,
        dine_in_packaging_fee: packagingFee,
        discountAmount: 0.0,
        discount_amount: 0.0,
        totalAmount,
        total_amount: totalAmount,
        paidAmount: 0.0,
        paid_amount: 0.0,
        balanceAmount: totalAmount,
        balance_amount: totalAmount,
        status: 'UNPAID',
        payment_status: 'UNPAID',
        splitType: 'NONE',
        splits: [],
        payments: [],
        refunds: [],
        createdAt: new Date().toISOString()
      };
      this._bills.set(billId, bill);
      session.totalAmount = totalAmount;
      session.total_amount = totalAmount;
      session.balanceAmount = totalAmount;
      session.balance_amount = totalAmount;
    }
    return bill;
  }

  async splitBill(merchantId, billOrSessionId, splitArg) {
    if (this.pgEnabled) {
      const bill = await this._durableBillFor(merchantId, billOrSessionId);
      if (!bill) throw billNotFound();
      const ways = Number(typeof splitArg === 'number'
        ? splitArg
        : ((splitArg && (splitArg.ways || splitArg.splitWays || splitArg.parts || splitArg.splitCount)) || 2));
      const payload = await this._rpc('bill split', 'rms_split_bill_atomic', {
        p_merchant_id: merchantId,
        p_bill_id: bill.id,
        p_ways: ways
      });
      return this._billDocument(payload.data.bill);
    }

    this._rejectMemoryFallback('bill split');
    let bill = this._bills.get(billOrSessionId);
    if (!bill) {
      bill = Array.from(this._bills.values()).find(b => (b.tableSessionId === billOrSessionId || b.session_id === billOrSessionId) && (b.merchantId === merchantId || b.merchant_id === merchantId));
    }
    if (!bill) {
      bill = await this.getBillForSession(merchantId, billOrSessionId);
    }
    if (!bill) throw new Error('Bill not found.');

    const n = Math.max(2, Number(typeof splitArg === 'number' ? splitArg : (splitArg && (splitArg.ways || splitArg.splitWays || splitArg.parts || splitArg.splitCount)) || 2));
    const amountPerPart = Math.round((bill.totalAmount / n) * 100) / 100;
    const remainder = Math.round((bill.totalAmount - (amountPerPart * n)) * 100) / 100;

    bill.splits = [];
    for (let i = 0; i < n; i++) {
      const partAmount = i === 0 ? Math.round((amountPerPart + remainder) * 100) / 100 : amountPerPart;
      bill.splits.push({
        partNumber: i + 1,
        split_index: i + 1,
        amount: partAmount,
        isPaid: false,
        is_paid: false,
        paidAt: null
      });
    }
    return bill;
  }

  async recordBillPayment(merchantId, billOrSessionId, data = {}) {
    if (this.pgEnabled) {
      const bill = await this._durableBillFor(merchantId, billOrSessionId);
      if (!bill) throw billNotFound();
      // Every rule a tender has to satisfy — method allowlist, positive amount, a reference not
      // already on this bill, no non-cash overpayment, no payment on a settled bill — is the
      // function's, inside one transaction that moves the bill, the session and the table together.
      const payload = await this._rpc('bill payment', 'rms_record_bill_payment_atomic', {
        p_merchant_id: merchantId,
        p_bill_id: bill.id,
        p_amount: Number(data.amount),
        p_payment_method: String(data.paymentMethod || data.payment_method || data.method || 'CASH').toUpperCase(),
        p_transaction_ref: data.transactionRef || data.transaction_ref || data.reference || null,
        p_recorded_by: data.collectedBy || data.recordedBy || data.collected_by || data.recorded_by || null,
        p_idempotency_key: data.idempotencyKey || data.idempotency_key || null
      });
      const d = payload.data || {};
      await this._syncBillMoneyCache(d.bill && d.bill.table_session_id);
      const doc = await this._billDocument(d.bill);
      return {
        ...doc,
        bill: doc,
        payment: d.payment ? normPaymentRow(d.payment) : null,
        // A replay of the same idempotency key answers the tender already on file. Saying so is the
        // difference between "₹300 collected" and "₹300 collected twice".
        duplicate: Boolean(payload.duplicate)
      };
    }

    this._rejectMemoryFallback('bill payment');
    let bill = this._bills.get(billOrSessionId);
    if (!bill) {
      bill = Array.from(this._bills.values()).find(b => (b.tableSessionId === billOrSessionId || b.session_id === billOrSessionId) && (b.merchantId === merchantId || b.merchant_id === merchantId));
    }
    if (!bill) {
      bill = await this.getBillForSession(merchantId, billOrSessionId);
    }
    if (!bill) throw new Error('Bill not found.');

    if (bill.status === 'PAID' || (bill.balanceAmount <= 0.001 && bill.paidAmount >= bill.totalAmount)) {
      const err = new Error('Bill is already fully settled.');
      err.code = 'BILL_ALREADY_PAID';
      err.statusCode = 400;
      throw err;
    }

    const amount = Number(data.amount);
    const paymentMethod = String(data.paymentMethod || data.payment_method || data.method || 'CASH').toUpperCase();
    const transactionRef = data.transactionRef || data.transaction_ref || data.reference || null;

    if (!(amount > 0)) throw new Error('Payment amount must be greater than zero.');

    if (transactionRef) {
      const isDup = (bill.payments || []).some(p => (p.transactionRef && p.transactionRef === transactionRef) || (p.transaction_ref && p.transaction_ref === transactionRef));
      if (isDup) {
        const err = new Error(`Payment reference '${transactionRef}' has already been recorded for this bill.`);
        err.code = 'DUPLICATE_PAYMENT';
        err.statusCode = 400;
        throw err;
      }
    }

    let changeDue = 0.0;
    let effectiveCredited = amount;
    if (paymentMethod === 'CASH' && amount > bill.balanceAmount) {
      changeDue = Math.round((amount - bill.balanceAmount) * 100) / 100;
      effectiveCredited = bill.balanceAmount;
    }

    const paymentEntry = {
      id: crypto.randomUUID(),
      amount,
      effectiveCredited,
      changeDue,
      change_due: changeDue,
      paymentMethod,
      payment_method: paymentMethod,
      transactionRef,
      transaction_ref: transactionRef,
      recordedBy: data.collectedBy || data.recordedBy || 'Cashier',
      status: 'RECORDED',
      note: paymentMethod === 'UPI' ? 'Staff recorded direct UPI payment (not bank verified)' : 'Staff recorded payment',
      recordedAt: new Date().toISOString(),
      recorded_at: new Date().toISOString()
    };
    if (!bill.payments) bill.payments = [];
    bill.payments.push(paymentEntry);

    bill.paidAmount = Math.round((bill.paidAmount + effectiveCredited) * 100) / 100;
    bill.paid_amount = bill.paidAmount;
    bill.balanceAmount = Math.max(0, Math.round((bill.totalAmount - bill.paidAmount) * 100) / 100);
    bill.balance_amount = bill.balanceAmount;

    if (bill.balanceAmount <= 0.01) {
      bill.status = 'PAID';
      bill.payment_status = 'PAID';
    } else {
      bill.status = 'PARTIALLY_PAID';
      bill.payment_status = 'PARTIALLY_PAID';
    }

    const sessId = bill.tableSessionId || bill.session_id;
    const session = this._sessions.get(sessId);
    if (session) {
      session.paidAmount = bill.paidAmount;
      session.paid_amount = bill.paidAmount;
      session.balanceAmount = bill.balanceAmount;
      session.balance_amount = bill.balanceAmount;

      const table = this._tables.get(session.tableId || session.table_id);
      if (table) {
        table.unpaidBalance = bill.balanceAmount;
      }
    }

    return { ...bill, bill };
  }

  async getBillReceipt(merchantId, billId) {
    if (this.pgEnabled) {
      const bill = await this._durableBillFor(merchantId, billId, { generate: false });
      if (!bill) throw billNotFound();
      // The document comes back whole. It is minted from `restaurant_receipts`, whose row freezes
      // the items, the merchant, the UPI instructions and every money figure at issue time, so a
      // reprint of last week's bill still says last week's prices even after the merchant has
      // changed their UPI ID. Nothing here may recompute it from the live bill.
      const payload = await this._rpc('bill receipt', 'rms_get_bill_receipt_atomic', {
        p_merchant_id: merchantId,
        p_bill_id: bill.id
      });
      return payload.data;
    }

    this._rejectMemoryFallback('bill receipt');
    let bill = this._bills.get(billId);
    if (!bill) {
      bill = Array.from(this._bills.values()).find(b => (b.id === billId || b.tableSessionId === billId || b.session_id === billId) && (b.merchantId === merchantId || b.merchant_id === merchantId));
    }
    if (!bill) throw new Error('Bill not found.');

    const isPaid = bill.status === 'PAID' && bill.balanceAmount <= 0.01;
    return {
      receiptNumber: `REC-${(bill.invoiceNumber || bill.id).substring(0, 12)}`,
      billId: bill.id,
      invoiceNumber: bill.invoiceNumber || `INV-${bill.id.substring(0, 8)}`,
      tableNumber: bill.tableNumber || 'N/A',
      orderChannel: 'DINE_IN',
      merchantDetails: bill.merchantDetails || {
        name: 'NABIN Restaurant',
        address: '124 Station Road',
        phone: '',
        gstin: null
      },
      items: bill.items || [],
      subtotal: bill.subtotal,
      taxAmount: bill.taxAmount,
      serviceCharge: bill.serviceCharge,
      packagingFee: bill.packagingFee,
      discountAmount: bill.discountAmount || 0,
      totalAmount: bill.totalAmount,
      paidAmount: bill.paidAmount,
      balanceAmount: bill.balanceAmount,
      isFullyPaid: isPaid,
      paymentStatus: isPaid ? 'PAID' : (bill.paidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
      statusText: isPaid ? 'PAID IN FULL' : `BALANCE DUE: ₹${bill.balanceAmount.toFixed(2)}`,
      paymentInstructions: bill.paymentInstructions || null,
      payments: (bill.payments || []).map(p => ({
        id: p.id,
        amount: p.amount,
        effectiveCredited: p.effectiveCredited || p.amount,
        method: p.paymentMethod,
        reference: p.transactionRef,
        changeDue: p.changeDue || 0,
        recordedBy: p.recordedBy,
        timestamp: p.recordedAt,
        note: p.note
      })),
      refunds: bill.refunds || [],
      issuedAt: new Date().toISOString()
    };
  }

  async recordBillRefund(merchantId, billOrSessionId, data = {}) {
    if (this.pgEnabled) {
      const bill = await this._durableBillFor(merchantId, billOrSessionId, { generate: false });
      if (!bill) throw billNotFound();
      const payload = await this._rpc('bill refund', 'rms_record_bill_refund_atomic', {
        p_merchant_id: merchantId,
        p_bill_id: bill.id,
        p_amount: Number(data.amount),
        p_reason: data.reason || null,
        p_refund_method: String(data.method || data.refundMethod || data.refund_method || 'CASH').toUpperCase(),
        p_recorded_by: data.recordedBy || data.recorded_by || null,
        p_transfer_reference: data.transferReference || data.transfer_reference || null,
        p_idempotency_key: data.idempotencyKey || data.idempotency_key || null
      });
      const d = payload.data || {};
      await this._syncBillMoneyCache(d.bill && d.bill.table_session_id);
      return {
        bill: await this._billDocument(d.bill),
        refund: d.refund ? normRefundRow(d.refund) : null,
        duplicate: Boolean(payload.duplicate)
      };
    }

    this._rejectMemoryFallback('bill refund');
    let bill = this._bills.get(billOrSessionId);
    if (!bill) {
      bill = Array.from(this._bills.values()).find(b => (b.tableSessionId === billOrSessionId || b.session_id === billOrSessionId) && (b.merchantId === merchantId || b.merchant_id === merchantId));
    }
    if (!bill) {
      bill = await this.getBillForSession(merchantId, billOrSessionId);
    }
    if (!bill) throw new Error('Bill not found.');

    const refundAmount = Number(data.amount);
    if (!(refundAmount > 0)) throw new Error('Refund amount must be greater than zero.');
    if (refundAmount > bill.paidAmount) {
      const err = new Error(`Refund amount ₹${refundAmount} exceeds recorded paid amount ₹${bill.paidAmount}.`);
      err.code = 'REFUND_EXCEEDS_PAID';
      err.statusCode = 400;
      throw err;
    }

    if (!bill.refunds) bill.refunds = [];
    const refundEntry = {
      id: crypto.randomUUID(),
      amount: refundAmount,
      reason: data.reason || 'Customer refund',
      recordedBy: data.recordedBy || 'Manager',
      method: data.method || 'CASH',
      disclaimer: 'RECORDED EVENT ONLY: This records the refund in RMS records and does not initiate a banking or UPI transfer.',
      recordedAt: new Date().toISOString()
    };
    bill.refunds.push(refundEntry);
    bill.paidAmount = Math.max(0, Math.round((bill.paidAmount - refundAmount) * 100) / 100);
    bill.paid_amount = bill.paidAmount;
    bill.balanceAmount = Math.round((bill.totalAmount - bill.paidAmount) * 100) / 100;
    bill.balance_amount = bill.balanceAmount;
    if (bill.balanceAmount > 0) {
      bill.status = bill.paidAmount > 0 ? 'PARTIALLY_PAID' : 'REFUNDED';
      bill.payment_status = bill.status;
    }
    return { bill, refund: refundEntry };
  }

  async searchBills(merchantId, { invoiceNumber = null, tableNumber = null, status = null } = {}) {
    if (this.pgEnabled) {
      let query = supabaseAdmin.from('restaurant_bills').select(BILL_COLS).eq('merchant_id', merchantId);
      if (invoiceNumber) query = query.ilike('invoice_number', `%${String(invoiceNumber).replace(/[%,()]/g, '')}%`);
      if (tableNumber) query = query.eq('table_number', String(tableNumber));
      if (status) query = query.eq('status', String(status));
      const { data, error } = await query.order('created_at', { ascending: false }).limit(200);
      if (error) throw storeReadFailure('bill search', error);
      const rows = Array.isArray(data) ? data : [];
      // One pair of reads for the page, so a twenty-bill search does not become forty queries —
      // and so no row in the list answers `payments: []` over money the store holds.
      const { paymentsByBill, refundsByBill } = await this._pgBillTenders(rows.map(r => r.id));
      return rows.map(r => {
        const doc = normBillRow(r, {
          payments: paymentsByBill.get(r.id) || [],
          refunds: refundsByBill.get(r.id) || []
        });
        this._bills.set(doc.id, doc);
        return doc;
      });
    }
    this._rejectMemoryFallback('bill search');
    let list = Array.from(this._bills.values()).filter(b => b.merchantId === merchantId || b.merchant_id === merchantId);
    if (invoiceNumber) {
      list = list.filter(b => (b.invoiceNumber || '').toLowerCase().includes(invoiceNumber.toLowerCase()));
    }
    if (tableNumber) {
      list = list.filter(b => String(b.tableNumber) === String(tableNumber));
    }
    if (status) {
      list = list.filter(b => b.status === status);
    }
    return list;
  }

  // --- 6. KITCHEN DISPLAY SYSTEM (KDS) ---
  async getKdsTickets(merchantId, { channel = null, status = null } = {}) {
    if (!merchantId) return [];
    if (this.pgEnabled) {
      let query = supabaseAdmin
        .from('restaurant_kds_tickets')
        .select(KDS_COLS)
        .eq('merchant_id', merchantId);
      if (channel) query = query.eq('channel', channel);
      if (status) query = query.eq('status', status);
      const { data, error } = await query.order('created_at', { ascending: true });
      if (error) throw storeReadFailure('KDS tickets', error);
      return (Array.isArray(data) ? data : []).map(normKdsRow);
    }

    this._rejectMemoryFallback('KDS tickets');
    let list = Array.from(this._kdsTickets.values()).filter(t => t.merchantId === merchantId || t.merchant_id === merchantId);
    if (channel) list = list.filter(t => t.channel === channel || t.order_channel === channel);
    if (status) list = list.filter(t => t.status === status);
    return list.sort((a, b) => new Date(a.createdAt || a.created_at) - new Date(b.createdAt || b.created_at));
  }

  async createKdsTicket(data = {}) {
    const orderId = data.orderId || data.order_id;
    const merchantId = data.merchantId || data.restaurant_id || data.merchant_id;
    const channel = data.order_channel || data.channel || 'DELIVERY';
    const tableNumber = data.table_number || data.tableNumber || null;
    const prepTime = Number(data.prep_time_minutes || data.prepTimeMinutes || 20);

    if (this.pgEnabled) {
      // Two fabrications this call replaces. The ticket number was `KBD-${random 1000..9999}`, so a
      // retry could hand the kitchen a second ticket for the same order under a different number; the
      // sequence plus the unique index on `order_id` make a replay answer the ticket that exists. And
      // the item list came from whatever the caller had in hand; the function reads it from
      // `order_lines`, so the board shows what was actually ordered and priced.
      if (!isUuid(orderId)) {
        const err = new Error('Order not found for this restaurant.');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      fieldTooLong('tableNumber', tableNumber, 30);
      const payload = await this._rpc('KDS ticket', 'rms_create_kds_ticket_atomic', {
        p_merchant_id: merchantId,
        p_order_id: orderId,
        p_channel: channel,
        p_table_number: tableNumber,
        p_prep_time_minutes: prepTime
      });
      const ticket = normKdsRow(payload.data);
      // One ticket per order is a unique index, so a retry of the same order answers the row that
      // already exists rather than minting a second number. Only the function can say which of the
      // two happened, and a caller that cannot tell would read a replay as a new dish to cook.
      ticket.duplicate = Boolean(payload.duplicate);
      this._kdsTickets.set(ticket.id, ticket);
      return ticket;
    }

    this._rejectMemoryFallback('KDS ticket');
    const id = crypto.randomUUID();
    const orderNumber = data.orderNumber || data.order_number || `ORD-${orderId}`;
    const items = data.items || [];
    const ticketNumber = `KBD-${Math.floor(1000 + Math.random() * 9000)}`;
    const ticket = {
      id,
      merchantId,
      merchant_id: merchantId,
      orderId,
      order_id: orderId,
      orderNumber,
      order_number: orderNumber,
      ticketNumber,
      ticket_number: ticketNumber,
      channel,
      order_channel: channel,
      tableNumber,
      table_number: tableNumber,
      status: 'NEW',
      prep_time_minutes: prepTime,
      prepTimeMinutes: prepTime,
      items,
      itemsSnapshot: items,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    this._kdsTickets.set(id, ticket);
    return ticket;
  }

  async updateKdsTicketStatus(merchantId, ticketId, status) {
    if (this.pgEnabled) {
      if (!isUuid(ticketId)) {
        const err = new Error('Ticket not found.');
        err.code = 'TICKET_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      // NEW -> PREPARING -> READY -> SERVED, with CANCELLED reachable from a live state only. The
      // Map wrote whatever string arrived, so a ticket could go from NEW straight to SERVED and the
      // kitchen board would report a dish nobody cooked.
      const payload = await this._rpc('KDS ticket', 'rms_update_kds_ticket_status_atomic', {
        p_merchant_id: merchantId,
        p_ticket_id: ticketId,
        p_status: status,
        p_updated_by: null
      });
      const ticket = normKdsRow(payload.data);
      // Re-asserting the status a ticket already holds is a replay, not a move: no timestamp in the
      // function advances, and `duplicate` is what keeps the second READY from looking like a dish
      // that has just come up twice.
      ticket.duplicate = Boolean(payload.duplicate);
      this._kdsTickets.set(ticket.id, ticket);
      return ticket;
    }

    this._rejectMemoryFallback('KDS ticket');
    if (!KDS_STATUSES.includes(status)) throw new Error(`Invalid KDS status: ${status}`);
    const ticket = this._kdsTickets.get(ticketId);
    if (!ticket || (ticket.merchantId !== merchantId && ticket.merchant_id !== merchantId)) throw new Error('Ticket not found.');
    ticket.status = status;
    return ticket;
  }

  // --- 7. TAKEAWAY OPERATIONS ---
  async recordTakeawayHandover(merchantId, orderId, handoverBy = 'Staff') {
    const staffName = typeof handoverBy === 'string' ? handoverBy : handoverBy.handoverBy || 'Staff';

    if (this.pgEnabled) {
      if (!isUuid(orderId)) {
        const err = new Error('Order not found for this restaurant.');
        err.code = 'ORDER_NOT_FOUND';
        err.statusCode = 400;
        throw err;
      }
      fieldTooLong('handoverBy', staffName, 120);
      // The Map made up an order (`total_amount: 320`) when the id was unknown so the route could
      // answer 200, and it stamped `order_state = 'COLLECTED'`, a value the 018 CHECK has never
      // allowed. The function marks the handover columns on a real order and reports COLLECTED as a
      // derived view of `handover_at`, which is what it actually is.
      const payload = await this._rpc('takeaway handover', 'rms_record_takeaway_handover_atomic', {
        p_merchant_id: merchantId,
        p_order_id: orderId,
        p_handover_by: staffName
      });
      return payload.data;
    }

    this._rejectMemoryFallback('takeaway handover');
    let existingOrder = this._orders.get(orderId) || (this.db?.orderRepo ? await this.db.orderRepo.getOrderById(orderId) : null);
    if (!existingOrder) {
      existingOrder = { id: orderId, merchant_id: merchantId, restaurant_id: merchantId, order_channel: 'TAKEAWAY', total_amount: 320 };
    }

    if (existingOrder.handover_at || existingOrder.order_state === 'COLLECTED') {
      const err = new Error('Order has already been collected.');
      err.code = 'ALREADY_COLLECTED';
      err.statusCode = 400;
      throw err;
    }

    const now = new Date().toISOString();
    existingOrder.order_state = 'COLLECTED';
    existingOrder.handover_by = staffName;
    existingOrder.handover_at = now;
    this._orders.set(orderId, existingOrder);

    return {
      success: true,
      orderId,
      order_id: orderId,
      order_state: 'COLLECTED',
      status: 'COLLECTED',
      handover_by: staffName,
      handoverBy: staffName,
      handover_at: now,
      handoverAt: now
    };
  }

  // --- 8. STAFF & ROLES (RBAC) ---
  async getStaff(merchantId) {
    if (!merchantId) return [];
    if (this.pgEnabled) {
      // `is_active` has a DEFAULT of true but is nullable, so a row that never answered the question
      // is not a deactivated one. `.eq('is_active', true)` alone would drop it from the list, while
      // the memory path's rule is `isActive !== false` — the same reason 043 could relax NOT NULL on
      // `phone` without changing what a staff list means.
      const { data, error } = await supabaseAdmin
        .from('restaurant_staff')
        .select(STAFF_COLS)
        .eq('merchant_id', merchantId)
        .or('is_active.eq.true,is_active.is.null')
        .order('created_at', { ascending: true });
      if (error) throw storeReadFailure('staff records', error);
      return (Array.isArray(data) ? data : []).map(normStaffRow);
    }

    this._rejectMemoryFallback('staff records');
    return Array.from(this._staff.values()).filter(s => (s.merchantId === merchantId || s.merchant_id === merchantId) && s.isActive !== false);
  }

  /**
   * A staff row written through the service-role builder, because 043 defines no staff function.
   *
   * Migration 043 gave the kitchen, the handover, the reservations and the sales report an atomic
   * RPC each, and left staff alone — correctly, because nothing in the staff domain needs a row
   * lock: there is no balance to re-derive, no sequence to mint and no cross-table invariant to
   * hold. The rule that made the rest durable is that a write the store refuses must not be reported
   * as saved, and a single INSERT with a thrown `storeFailure` satisfies it. Inventing an RPC to keep
   * a uniform shape would be a migration for the guard's benefit, not the restaurant's.
   */
  async createStaff(merchantId, data = {}) {
    const name = data.name;
    const phone = data.phone;
    const role = data.role;

    if (!name || !role) throw new Error('name and role are required.');
    if (!STAFF_ROLES.includes(role)) throw new Error(`Invalid role: ${role}. Must be one of: ${STAFF_ROLES.join(', ')}`);
    fieldTooLong('name', name, 120);
    fieldTooLong('phone', phone, 20);

    if (this.pgEnabled) {
      const userId = data.user_id || data.userId || null;
      if (userId && !isUuid(userId)) {
        const err = new Error('user_id must be a valid user id.');
        err.code = 'INVALID_INPUT';
        err.statusCode = 400;
        throw err;
      }
      const { data: row, error } = await supabaseAdmin
        .from('restaurant_staff')
        .insert({
          merchant_id: merchantId,
          user_id: userId,
          name: String(name).trim(),
          phone: phone ? String(phone).trim() : null,
          role,
          is_active: true,
          role_changed_at: new Date().toISOString()
        })
        .select(STAFF_COLS)
        .single();
      if (error) {
        // Two of this table's own rules are about the caller's input, not the store's health: 041
        // made (merchant_id, phone) unique, and user_id references public.users. Left alone, both
        // would reach `storeFailure` and tell a restaurant their store is down because a form had a
        // duplicate phone or a stale user id.
        const sqlstate = String(error.code || '');
        const text = String(error.message || '');
        if (sqlstate === '23505' && /merchant_id_phone_key/.test(text)) {
          const err = new Error('A staff member with that phone already exists in this restaurant.');
          err.code = 'STAFF_PHONE_TAKEN';
          err.statusCode = 409;
          throw err;
        }
        if (sqlstate === '23503' && /restaurant_staff_user_id_fkey/.test(text)) {
          const err = new Error('The named user does not exist.');
          err.code = 'USER_NOT_FOUND';
          err.statusCode = 400;
          throw err;
        }
        throw storeFailure('staff record', error);
      }
      const staff = normStaffRow(row);
      this._staff.set(staff.id, staff);
      return staff;
    }

    this._rejectMemoryFallback('staff record');
    const id = crypto.randomUUID();
    const staff = {
      id,
      merchantId,
      merchant_id: merchantId,
      name,
      phone: phone || null,
      role,
      permissions: ROLE_PERMISSIONS[role] || [],
      isActive: true,
      is_active: true,
      createdAt: new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    this._staff.set(id, staff);
    return staff;
  }

  async deleteStaff(merchantId, staffId) {
    if (this.pgEnabled) {
      // An id that is not a uuid names no row, and the engine would answer it as a 22P02 cast error
      // classified as a store outage. The memory path's answer for an unknown id is `false`.
      if (!isUuid(staffId)) return false;
      // A deactivation, not a delete: the row stays so the shifts that person worked keep a readable
      // name. `updated_by` is left alone because no RMS route tells this file who pressed Remove —
      // writing a name here would be an accusation invented from a session nobody passed.
      const { data, error } = await supabaseAdmin
        .from('restaurant_staff')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', staffId)
        .eq('merchant_id', merchantId)
        .select('id');
      if (error) throw storeFailure('staff record', error);
      const matched = Array.isArray(data) && data.length > 0;
      if (matched && this._staff.has(staffId)) {
        this._staff.get(staffId).isActive = false;
        this._staff.get(staffId).is_active = false;
      }
      return matched;
    }

    this._rejectMemoryFallback('staff record');
    const staff = this._staff.get(staffId);
    if (!staff || (staff.merchantId !== merchantId && staff.merchant_id !== merchantId)) return false;
    staff.isActive = false;
    staff.is_active = false;
    return true;
  }

  // --- 9. SALES & CHANNEL ANALYTICS ---
  async getSalesReport(merchantId, params = {}) {
    if (!merchantId) return null;
    const window = salesWindow(params);
    if (this.pgEnabled) {
      // One read over the rows the write path already persists: bills, their tenders and refunds,
      // and the non-dine-in orders with their lines. Every figure is then a count of rows that
      // survived the process, not of objects this process happens to remember.
      const doc = await this._rpc('sales report', 'rms_sales_report', { p_merchant_id: merchantId, ...window });
      return durableSalesView(doc, params);
    }

    this._rejectMemoryFallback('sales report');

    const channelReport = await this.getChannelSalesReport(merchantId);
    const bills = Array.from(this._bills.values()).filter(b => b.merchantId === merchantId || b.merchant_id === merchantId);

    const paymentMethodsBreakdown = {
      CASH: { count: 0, recordedAmount: 0.0 },
      UPI: { count: 0, recordedAmount: 0.0, verificationNote: 'Staff recorded direct UPI payment; not bank verified' },
      CARD: { count: 0, recordedAmount: 0.0 }
    };

    let totalRecordedCollections = 0.0;
    let totalOutstandingBalance = 0.0;
    let totalRefundsRecorded = 0.0;
    let paidBillsCount = 0;
    let unpaidBillsCount = 0;
    let partialBillsCount = 0;

    for (const b of bills) {
      if (b.status === 'PAID') paidBillsCount++;
      else if (b.status === 'PARTIALLY_PAID') partialBillsCount++;
      else unpaidBillsCount++;

      totalOutstandingBalance += Number(b.balanceAmount || b.balance_amount || 0);

      if (b.payments && b.payments.length > 0) {
        for (const p of b.payments) {
          const m = String(p.paymentMethod || p.payment_method || 'CASH').toUpperCase();
          const amt = Number(p.effectiveCredited || p.amount || 0);
          if (!paymentMethodsBreakdown[m]) {
            paymentMethodsBreakdown[m] = { count: 0, recordedAmount: 0.0 };
          }
          paymentMethodsBreakdown[m].count++;
          paymentMethodsBreakdown[m].recordedAmount = Math.round((paymentMethodsBreakdown[m].recordedAmount + amt) * 100) / 100;
          totalRecordedCollections = Math.round((totalRecordedCollections + amt) * 100) / 100;
        }
      }

      if (b.refunds && b.refunds.length > 0) {
        for (const r of b.refunds) {
          totalRefundsRecorded = Math.round((totalRefundsRecorded + Number(r.amount || 0)) * 100) / 100;
        }
      }
    }

    // Item-level aggregation across bills and orders
    const itemSalesMap = new Map();
    for (const b of bills) {
      if (b.items && Array.isArray(b.items)) {
        for (const it of b.items) {
          const name = it.name || it.dish_name || it.product_name || 'Dish';
          const qty = Number(it.quantity || 1);
          const revenue = Number(it.lineTotal || it.line_total || ((it.unitPrice || it.unit_price_snapshot || it.price || 0) * qty));
          const existing = itemSalesMap.get(name) || { name, quantitySold: 0, totalRevenue: 0.0 };
          existing.quantitySold += qty;
          existing.totalRevenue = Math.round((existing.totalRevenue + revenue) * 100) / 100;
          itemSalesMap.set(name, existing);
        }
      }
    }
    for (const ord of Array.from(this._orders.values()).filter(o => o.restaurant_id === merchantId || o.merchant_id === merchantId)) {
      if (ord.items && Array.isArray(ord.items)) {
        for (const it of ord.items) {
          const name = it.dish_name || it.name || it.product_name || 'Dish';
          const qty = Number(it.quantity || 1);
          const revenue = Number(it.line_total || ((it.unit_price_snapshot || it.price || 0) * qty));
          const existing = itemSalesMap.get(name) || { name, quantitySold: 0, totalRevenue: 0.0 };
          existing.quantitySold += qty;
          existing.totalRevenue = Math.round((existing.totalRevenue + revenue) * 100) / 100;
          itemSalesMap.set(name, existing);
        }
      }
    }

    return {
      period: params.period || 'ALL_TIME',
      startDate: params.startDate || null,
      endDate: params.endDate || null,
      summary: {
        ...channelReport.summary,
        total_bills: bills.length,
        paid_bills: paidBillsCount,
        unpaid_bills: unpaidBillsCount,
        partially_paid_bills: partialBillsCount,
        total_recorded_collections: totalRecordedCollections,
        total_outstanding_balance: Math.round(totalOutstandingBalance * 100) / 100,
        total_refunds_recorded: totalRefundsRecorded
      },
      by_channel: channelReport.by_channel,
      channels: channelReport.channels,
      payment_methods: paymentMethodsBreakdown,
      payments_by_method: channelReport.payments_by_method,
      item_sales: Array.from(itemSalesMap.values()),
      disclaimer: 'AUDIT NOTICE: Recorded payment entries represent local restaurant staff records. UPI collections reflect merchant-declared amounts without real-time banking verification. Direct restaurant payments do not commingle with NABIN platform financial ledgers.'
    };
  }

  async getChannelSalesReport(merchantId) {
    if (!merchantId) return null;
    if (this.pgEnabled) {
      // The same document the full report reads, projected to its channel half. Splitting this
      // aggregate from `rms_sales_report` would mean a second, divergent definition of a sale.
      const doc = await this._rpc('channel sales report', 'rms_sales_report', { p_merchant_id: merchantId });
      return durableChannelView(doc);
    }

    this._rejectMemoryFallback('channel sales report');

    const orders = Array.from(this._orders.values()).filter(o => o.restaurant_id === merchantId || o.merchant_id === merchantId);

    const report = {
      summary: {
        total_orders: orders.length,
        gross_sales: 0.0,
        net_sales: 0.0,
        total_tax: 0.0,
        total_service_charge: 0.0,
        total_packaging_fee: 0.0,
        average_order_value: 0.0
      },
      by_channel: {
        DINE_IN: { orders_count: 0, total_amount: 0.0 },
        TAKEAWAY: { orders_count: 0, total_amount: 0.0 },
        DELIVERY: { orders_count: 0, total_amount: 0.0 }
      },
      channels: {
        DINE_IN: { count: 0, sales: 0.0 },
        TAKEAWAY: { count: 0, sales: 0.0 },
        DELIVERY: { count: 0, sales: 0.0 }
      },
      payments_by_method: {
        CASH: 0.0,
        UPI: 0.0,
        CARD: 0.0
      }
    };

    // Calculate totals from bills if available
    const bills = Array.from(this._bills.values()).filter(b => b.merchantId === merchantId || b.merchant_id === merchantId);
    for (const b of bills) {
      report.summary.total_tax += Number(b.taxAmount || b.tax_amount || 0);
      report.summary.total_service_charge += Number(b.serviceCharge || b.service_charge_amount || 0);
      report.summary.total_packaging_fee += Number(b.packagingFee || b.packaging_fee_amount || 0);
      if (b.payments && b.payments.length > 0) {
        for (const p of b.payments) {
          const m = String(p.paymentMethod || p.payment_method || 'CASH').toUpperCase();
          const amt = Number(p.effectiveCredited || p.amount || 0);
          report.payments_by_method[m] = Math.round(((report.payments_by_method[m] || 0) + amt) * 100) / 100;
        }
      }
    }

    for (const ord of orders) {
      const channel = ord.order_channel || ord.channel || 'DELIVERY';
      const amount = Number(ord.total_amount || ord.totalAmount || 0);

      const ch = report.by_channel[channel] || report.by_channel.DELIVERY;
      ch.orders_count += 1;
      ch.total_amount = Math.round((ch.total_amount + amount) * 100) / 100;

      report.channels[channel].count += 1;
      report.channels[channel].sales = Math.round((report.channels[channel].sales + amount) * 100) / 100;

      report.summary.gross_sales = Math.round((report.summary.gross_sales + amount) * 100) / 100;
    }

    report.summary.net_sales = Math.max(0, Math.round((report.summary.gross_sales - report.summary.total_tax - report.summary.total_service_charge) * 100) / 100);
    if (orders.length > 0) {
      report.summary.average_order_value = Math.round((report.summary.gross_sales / orders.length) * 100) / 100;
    }

    return report;
  }
}

module.exports = RestaurantManagementRepository;
