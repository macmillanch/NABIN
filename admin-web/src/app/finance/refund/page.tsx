'use client';

/**
 * A14 — Refund confirmation (Stitch admin project 13094802028721948005, UI intent only).
 *
 * Everything on this screen is bound to `POST /api/admin/finance/refund` as the route actually
 * is (`backend/src/server.js:2294`), not as the design drew it. The design's structure — a
 * target card, an amount card, a reason card, a deliberate confirm step, and a receipt that
 * names the ledger entry — is kept. Its data is not: the sample order (`ORD-MZ-9941`), the
 * named customer, the ₹420/₹120 figures, the node stamp, the `HTTP 504` failure card and the
 * "zero financial drift" trace are all design-only and appear nowhere here.
 *
 * Three contract facts drive the design of this form, and each is easy to get wrong:
 *
 *   1. **The console cannot see a payment.** There is no admin read route for `payments` —
 *      grepping `app.get('/api/admin` for a payment or refund read returns nothing, and the
 *      only `from('payments')` in the refund path (server.js:2346) fetches a `customer_id` for
 *      a notification. So no paid amount, no refundable balance and no customer name can be
 *      shown, and none is. The design's "Paid Amount ₹420.00 / Last Refund ₹0.00" panel is
 *      replaced by a card that states what is unavailable and why.
 *   2. **A blank amount is a real choice, not a missing one.** `refund_payment_atomic` sets
 *      `v_refundable_left = payments.amount - COALESCE(payments.refunded_amount, 0)` and, when
 *      `p_declared_amount` is NULL, refunds the remainder (migration 016:115-120) — proven as
 *      RAF-03 and RAF-05 in `backend/finance_refund_amount_authority_test.js`. So this screen
 *      offers the server's own semantic instead of the design's "Full fare" button, which would
 *      have had to guess a number the client cannot read.
 *   3. **The failure shapes are 400 / 401 / 403 / 409 / 503, never 504.** Refusals come back
 *      with the RPC's `code` (`PAYMENT_NOT_FOUND`, `ALREADY_FULLY_REFUNDED`,
 *      `INVALID_PAYMENT_STATE`, `INVALID_REFUND_AMOUNT`, `EXCEEDS_REFUNDABLE_BALANCE`,
 *      `TICKET_ALREADY_REFUNDED`, `IDEMPOTENCY_CONFLICT`); an unreachable store is answered by
 *      `replyStoreError` (server.js:343) as 503 with `{ code, error, requestId }`. Each refusal
 *      is shown with the server's own sentence, and no invented status is ever rendered.
 *
 * On money: this deployment has no payment-gateway SDK (see `backend/package.json`) and the RPC
 * records the provider as `RAZORPAY_SANDBOX` (server.js:2312). The screen says so rather than
 * implying a gateway was called. It also does not claim the order changed state —
 * `orders.order_state` has no `REFUNDED` value (migration 018:21-25); what moves is
 * `payments.status`/`refunded_amount`, plus `jobs.payment_status` when a full refund closes a
 * job (migration 016:225-231). And it does not claim the customer was told: the server publishes
 * a `REFUND_PROCESSED` event but never reports the recipient back, so delivery is not asserted.
 *
 * Duplicate-submission protection uses the backend's own idempotency key rather than a second
 * mechanism: the event id is minted client-side with the route's own `ref_adm_` prefix
 * (server.js:2308) and is regenerated **only when a submitted field changes**. An unchanged
 * retry therefore replays the same key — the server answers 200 with `duplicate: true` and
 * writes nothing new (RAF-09) — which is exactly the safe thing to do after an outcome this
 * console could not read. Reusing a spent key for *different* parameters is a genuine conflict
 * and is answered 409 (RAF-10/RAF-11), so that case is told apart on screen instead of retried.
 *
 * The missing-value label on this screen is the owner's `— Not available` rather than the shared
 * `DataPanel` marker, and it always carries its words: a bare dash next to a money field reads as
 * zero, which is the failure `DataPanel` rule 1 exists to prevent.
 *
 * The backend audit (`REFUND_PROCESSED`, server.js:2320) is authoritative and is not mirrored
 * here: this page logs nothing.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import AdminLayout from '@/components/AdminLayout';
import { MetricGrid, Panel } from '@/components/DataPanel';
import { useConfirmDetails } from '@/components/ConfirmAction';
import { adminApi } from '@/lib/api';
import { readRefusal, readTransportFailure, type Refusal } from '@/lib/refusals';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission, missingGrantNote } from '@/lib/access';

/** The owner's spelling of "we have no value for this", used for every absent field below. */
const NOT_AVAILABLE = '— Not available';

/**
 * The route enforces no minimum on `reason` (it defaults to 'Admin authorized refund',
 * server.js:2310). This console still requires one, because the audit row and
 * `payment_refund_authorizations.reason` are the only record of why money left the platform,
 * and a signed-in finance account should not be able to produce a blank justification by
 * accident. The stricter rule is stated on the field so it is never mistaken for a server rule.
 */
const MIN_REASON = 12;

/** Fields exactly as the route destructures them (server.js:2295). */
interface RefundBody {
  paymentId?: string;
  jobId?: string;
  amount?: number;
  reason?: string;
  ticketId?: string;
  idempotencyKey?: string;
}

/**
 * The success envelope, field by field, from the RPC's own `json_build_object`
 * (migration 016:231-240). A refund and an idempotent replay are **different** objects —
 * the replay carries `message` and no `totalRefunded`/`ledgerEntryId` — so nothing here may
 * assume a booked refund from a replay response.
 */
interface RefundReceipt {
  success?: boolean;
  duplicate?: boolean;
  paymentId?: string;
  refundAmount?: number | string;
  totalRefunded?: number | string;
  status?: string;
  eventId?: string;
  ledgerEntryId?: string;
  message?: string;
  /**
   * Only ever present when a 200 arrives with `success: false` — a refusal wearing a success
   * envelope, which `DataPanel` already refuses to render as an empty state. The route answers
   * its real refusals with 4xx/5xx, so these two fields exist to read that case honestly
   * instead of treating it as a receipt.
   */
  code?: string;
  error?: string;
  /**
   * Present on specific refusals only, straight from `refund_payment_atomic`:
   * `EXCEEDS_REFUNDABLE_BALANCE` carries `requested` and `remaining` (migration 016:181),
   * `INVALID_PAYMENT_STATE` carries `status`, `INVALID_REFUND_AMOUNT` carries `amount`.
   * They are shown when the server sent them and never inferred when it did not.
   */
  requested?: number | string;
  remaining?: number | string;
}

/** A number or state the server itself stated alongside a refusal. */
interface RefusalFact {
  label: string;
  value: string;
}

/**
 * Refusals answer with more than a code when the RPC has a figure to give, and an admin who is
 * told "that is more than the balance" without the balance has to go and look it up somewhere
 * this console cannot read. So the refusal panel prints exactly these keys when present, and
 * prints nothing that is absent.
 */
function refusalFacts(data: unknown): RefusalFact[] {
  const body = (data ?? {}) as Record<string, unknown>;
  const facts: RefusalFact[] = [];
  if (typeof body.remaining === 'number' || typeof body.remaining === 'string') {
    facts.push({ label: 'Still refundable (server-stated)', value: showMoney(body.remaining) });
  }
  if (typeof body.requested === 'number' || typeof body.requested === 'string') {
    facts.push({ label: 'Amount this request declared', value: showMoney(body.requested) });
  }
  if (typeof body.amount === 'number' || typeof body.amount === 'string') {
    facts.push({ label: 'Amount the server worked with', value: showMoney(body.amount) });
  }
  if (typeof body.status === 'string' && body.status.trim()) {
    facts.push({ label: 'Payment state the server found', value: body.status.trim() });
  }
  return facts;
}

type Outcome =
  | { kind: 'booked'; receipt: RefundReceipt }
  | { kind: 'replay'; receipt: RefundReceipt }
  | { kind: 'refused'; refusal: Refusal; facts: RefusalFact[] }
  | { kind: 'unknown'; message: string };

/**
 * `ref_adm_` is the prefix the route itself falls back to when no key is supplied
 * (server.js:2308: `ref_adm_${Date.now()}`), so this reuses the existing event-id convention.
 * The timestamp alone would collide across two refunds issued in the same millisecond, and a
 * colliding key that carries different parameters is refused as a conflict rather than booked.
 */
function mintRefundEventId(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `ref_adm_${Date.now().toString(36)}_${nonce}`;
}

/** Money is only ever rendered when the server returned it; `null`/`undefined` gets the marker. */
const showMoney = (value: unknown): string => {
  const n = Number(value);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : NOT_AVAILABLE;
};

const showText = (value: unknown): string => {
  if (value === null || value === undefined) return NOT_AVAILABLE;
  const s = String(value).trim();
  return s || NOT_AVAILABLE;
};

export default function RefundPage() {
  const { user } = useAuth();
  const openConfirmation = useConfirmDetails();

  const [paymentRef, setPaymentRef] = useState('');
  const [jobRef, setJobRef] = useState('');
  const [ticketRef, setTicketRef] = useState('');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => mintRefundEventId());
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const canRefund = holdsPermission(user, 'finance.refund');
  const canReadAudit = holdsPermission(user, 'audit.view');

  const payment = paymentRef.trim();
  const job = jobRef.trim();
  const ticket = ticketRef.trim();
  const amountBlank = amountText.trim() === '';
  const declaredAmount = amountBlank ? null : Number(amountText.trim());
  const amountUsable = amountBlank || (declaredAmount !== null && Number.isFinite(declaredAmount) && declaredAmount > 0);
  const target = payment || job;

  // Which column the server will actually match, in the route's own precedence.
  const targetKind = payment ? 'payment reference' : 'job reference';
  const paidLabel = amountBlank ? 'the remaining refundable balance' : showMoney(declaredAmount);

  const blockers: string[] = [];
  if (!target) blockers.push('Enter a payment reference or a job reference — the route refuses a refund with neither.');
  if (!amountUsable) blockers.push('Enter the amount as a positive number, or leave it blank to refund what is still refundable.');
  if (reason.trim().length < MIN_REASON) {
    blockers.push(`Write at least ${MIN_REASON} characters of reason. The server accepts less; this console does not submit it.`);
  }
  const canSubmit = canRefund && blockers.length === 0 && !submitting;
  const settled = outcome?.kind === 'booked' || outcome?.kind === 'replay';

  /**
   * Any edit to a submitted field mints a new event id. That is what keeps a *retry* replay-safe
   * (unchanged request, same key, server writes nothing new) while making sure an *edited*
   * request never arrives under a key the server has already spent — which would answer 409.
   */
  const edit = (apply: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (outcome && outcome.kind !== 'unknown') setOutcome(null);
    setIdempotencyKey(mintRefundEventId());
    apply(event.target.value);
  };

  const reviewAndSubmit = async () => {
    if (!canSubmit) return;

    const confirmed = await openConfirmation({
      title: `Refund ${paidLabel}`,
      effect: `A refund of ${paidLabel} will be booked against ${targetKind} ${target}. The server decides the final figure from the payment row itself, writes a double-entry reversal and an authorization record naming this account, and answers with what it did.`,
      tone: 'danger',
      confirmLabel: 'Confirm refund',
      cancelLabel: 'Cancel',
      consequences: [
        amountBlank
          ? 'No amount was given, so the server refunds what is still refundable on that payment — not necessarily the original charged amount.'
          : `You declared ${showMoney(declaredAmount)}. If it exceeds the refundable balance the server refuses the whole request and books nothing.`,
        `Reason on record: "${reason.trim()}"`,
        ticket
          ? `Ticket reference ${ticket}. The server refuses a second refund for the same payment under the same ticket.`
          : 'No ticket reference. This refund will not be tied to a support ticket.',
        `Request key: ${idempotencyKey}. Retrying this exact request replays it instead of refunding twice.`,
        'No payment gateway is called. This deployment has no live gateway SDK, and the provider recorded on the authorization row is RAZORPAY_SANDBOX.',
        'The order state does not change. What changes is the payment row, and a job\'s payment status only when a full refund closes it.',
        'This console cannot undo a booked refund. There is no reversal route; a correction is a second, separately authorized refund.',
      ],
    });
    if (!confirmed) return;
    // Re-read after the dialog: the guard is the server's, and a session can lose its grant
    // while a dialog is open.
    if (!canSubmit) return;

    const body: RefundBody = { idempotencyKey, reason: reason.trim() };
    if (payment) body.paymentId = payment;
    if (job) body.jobId = job;
    if (ticket) body.ticketId = ticket;
    if (!amountBlank && declaredAmount !== null) body.amount = declaredAmount;

    setSubmitting(true);
    setOutcome(null);
    try {
      const res = await adminApi.refundPayment(body);
      const receipt = (res.data ?? {}) as RefundReceipt;
      // `success: false` on a 200 is a refusal, not a receipt. The route answers 4xx/5xx for its
      // refusals today, so this is a belt-and-braces read of the same envelope.
      if (receipt.success === false) {
        setOutcome({
          kind: 'refused',
          refusal: {
            message: typeof receipt.error === 'string' && receipt.error.trim()
              ? receipt.error.trim()
              : 'The server refused this refund and stated no reason.',
            code: typeof receipt.code === 'string' ? receipt.code : null,
            applied: false,
            status: res.status,
            requestId: null,
          },
          facts: refusalFacts(receipt),
        });
        return;
      }
      setOutcome({ kind: receipt.duplicate === true ? 'replay' : 'booked', receipt });
    } catch (err) {
      const hadResponse = Boolean((err as { response?: unknown })?.response);
      setOutcome(hadResponse
        ? {
          kind: 'refused',
          refusal: readRefusal(err, 'The server refused this refund.'),
          facts: refusalFacts((err as { response?: { data?: unknown } })?.response?.data),
        }
        // Nothing was read back, so nothing may be claimed about the outcome. The key is kept,
        // which makes the next attempt of the same request a replay instead of a second refund.
        : { kind: 'unknown', message: readTransportFailure(err, 'No answer came back from the refund request.') });
    } finally {
      setSubmitting(false);
    }
  };

  const startNewRequest = () => {
    setPaymentRef('');
    setJobRef('');
    setTicketRef('');
    setAmountText('');
    setReason('');
    setOutcome(null);
    setIdempotencyKey(mintRefundEventId());
  };

  if (!canRefund) {
    return (
      <AdminLayout title="Refund confirmation">
        <div className="nabin-stack">
          <nav className="nabin-row" aria-label="Breadcrumb">
            <Link href="/finance" className="nabin-cell-meta">Finance</Link>
            <span className="nabin-cell-meta" aria-hidden="true">/</span>
            <span className="nabin-cell-meta">Refund</span>
          </nav>
          {/* The existing authorization state, in the words the server would have refused with. */}
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>{missingGrantNote(user, 'finance.refund')}</span>
          </div>
          <Panel title="Refund">
            <StateNote text="No form is offered. POST /api/admin/finance/refund is gated by finance.refund, so an attempt from this session would be refused by the server — which would still refuse it if this screen rendered the fields." />
          </Panel>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout title="Refund confirmation">
      <div className="nabin-stack">
        <nav className="nabin-row" aria-label="Breadcrumb">
          <Link href="/finance" className="nabin-cell-meta">Finance</Link>
          <span className="nabin-cell-meta" aria-hidden="true">/</span>
          <span className="nabin-cell-meta">Refund</span>
        </nav>

        <Panel
          title="Refund target"
          subtitle="POST /api/admin/finance/refund takes the target as paymentId or jobId, and prefers paymentId."
        >
          <div className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="refund-payment">
                Payment reference — <code>payment_id</code> or <code>gateway_order_id</code>
              </label>
              <input
                id="refund-payment"
                className="nabin-input"
                value={paymentRef}
                onChange={edit(setPaymentRef)}
                placeholder="the payment this refund belongs to"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting || settled}
              />
              <p className="nabin-cell-meta">
                The server matches either column of <code>payments</code> (migration 016:105). Anything
                that matches neither comes back as <code>PAYMENT_NOT_FOUND</code>, and books nothing.
              </p>
            </div>

            <div>
              <label className="nabin-label" htmlFor="refund-job">Job reference (optional)</label>
              <input
                id="refund-job"
                className="nabin-input"
                value={jobRef}
                onChange={edit(setJobRef)}
                placeholder="used only if no payment reference is given"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting || settled}
              />
              <p className="nabin-cell-meta">
                The route uses <code>paymentId || jobId</code> as the target, so this is a fallback and
                not a second search. It does not resolve a job to its payment for you.
              </p>
            </div>

            <div>
              <label className="nabin-label" htmlFor="refund-ticket">Support ticket reference (optional)</label>
              <input
                id="refund-ticket"
                className="nabin-input"
                value={ticketRef}
                onChange={edit(setTicketRef)}
                placeholder="the ticket this refund settles"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting || settled}
              />
              <p className="nabin-cell-meta">
                Recorded on the authorization row. The server refuses a second refund of the same
                payment under the same ticket (<code>TICKET_ALREADY_REFUNDED</code>), which is why it
                is worth filling in when a ticket exists.
              </p>
            </div>
          </div>
        </Panel>

        {/* Truth in place of the design's "Reference Blueprint" sample-order card. */}
        <Panel
          title="What this console can see about that payment"
          subtitle="Read before confirming: the gaps below are gaps in the API, not in the request."
        >
          <MetricGrid
            items={[
              { label: 'Target', value: target || NOT_AVAILABLE, tone: 'info' },
              { label: 'Paid amount', value: NOT_AVAILABLE, tone: 'info' },
              { label: 'Refundable balance', value: NOT_AVAILABLE, tone: 'info' },
              { label: 'Previously refunded', value: NOT_AVAILABLE, tone: 'info' },
            ]}
          />
          <div className="nabin-alert" role="note">
            <span>
              Nothing above is a refusal of your request. There is no admin endpoint that reads a
              payment row, so this screen cannot show what was paid, what has already gone back, or how
              much is refundable — and it will not print a number to fill the silence. The refundable
              balance is computed inside the database at the moment the refund is booked, which is the
              only version of that figure this platform can offer.
            </span>
          </div>
        </Panel>

        <Panel title="Amount" subtitle="The server owns this decision. This field is a declaration, not a calculation.">
          <div className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="refund-amount">Refund amount (INR)</label>
              <input
                id="refund-amount"
                className="nabin-input"
                value={amountText}
                onChange={edit(setAmountText)}
                inputMode="decimal"
                placeholder="blank = the remaining refundable balance"
                autoComplete="off"
                spellCheck={false}
                disabled={submitting || settled}
                aria-invalid={!amountUsable}
                aria-describedby="refund-amount-help"
              />
              <p className="nabin-cell-meta" id="refund-amount-help">
                Leave it blank to refund what is still refundable. The server reads
                <code> payments.amount − payments.refunded_amount</code> itself, so after a partial
                refund a blank amount gives you the remainder rather than the original figure. A
                declared amount is rounded to two decimals, and one above the balance refuses the
                whole request with <code>EXCEEDS_REFUNDABLE_BALANCE</code>.
              </p>
              {!amountUsable ? (
                <p className="nabin-field__error" role="alert">
                  That is not a positive number. Enter an amount like 350 or 350.50, or clear the field.
                </p>
              ) : null}
            </div>
          </div>
        </Panel>

        <Panel title="Reason" subtitle="Goes onto the authorization row and the audit record.">
          <div className="nabin-form">
            <div>
              <label className="nabin-label" htmlFor="refund-reason">Why is this money going back?</label>
              <textarea
                id="refund-reason"
                className="nabin-input"
                rows={3}
                value={reason}
                onChange={edit(setReason)}
                placeholder="what the customer was short, and what was checked first"
                disabled={submitting || settled}
                aria-describedby="refund-reason-help"
              />
              <p className="nabin-cell-meta" id="refund-reason-help">
                {reason.trim().length}/{MIN_REASON} characters minimum. The route defaults this to
                &ldquo;Admin authorized refund&rdquo; if it is sent empty — this console requires it
                instead, because an unexplained refund is a question an operator will be asked later
                with no record to answer from.
              </p>
            </div>
          </div>
        </Panel>

        <Panel title="Request key" subtitle="One request, one identity. This is the duplicate-submission guard.">
          <p className="nabin-mono" style={{ margin: 0, wordBreak: 'break-all' }}>{idempotencyKey}</p>
          <p className="nabin-cell-meta" style={{ marginTop: 'var(--space-xs)' }}>
            Minted here with the route&apos;s own <code>ref_adm_</code> convention and regenerated the
            moment any field above changes. Sending this request unchanged a second time is safe: the
            server recognises the key and answers that the refund was already authorized instead of
            booking another one. Sending it changed under a key that is already spent is a different
            thing, and comes back as a conflict.
          </p>
        </Panel>

        {blockers.length && !settled ? (
          <div className="nabin-alert" role="status">
            <span>
              <strong>Not ready to submit.</strong>{' '}
              {blockers.map((b) => <span key={b} style={{ display: 'block' }}>{b}</span>)}
            </span>
          </div>
        ) : null}

        {outcome ? <OutcomeBlock outcome={outcome} onNewRequest={startNewRequest} canReadAudit={canReadAudit} /> : null}

        <Panel title="Confirm">
          <div className="nabin-row" style={{ gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
            <Link href="/finance" className="nabin-btn nabin-btn--ghost">Cancel</Link>
            {settled ? (
              <button type="button" className="nabin-btn nabin-btn--ghost" onClick={startNewRequest}>
                New refund request
              </button>
            ) : null}
            <button
              type="button"
              className="nabin-btn nabin-btn--danger"
              onClick={reviewAndSubmit}
              disabled={!canSubmit || settled}
              aria-describedby="refund-confirm-help"
            >
              {submitting ? 'Refund in flight…' : settled ? 'This request is closed' : 'Review and confirm refund'}
            </button>
          </div>
          <p className="nabin-cell-meta" id="refund-confirm-help" style={{ marginTop: 'var(--space-xs)' }}>
            {submitting
              ? 'The request has been sent. Do not reload this page to check — reload loses the answer, not the refund.'
              : settled
                ? 'This request has been answered. Start a new one for a different movement; this key is spent.'
                : 'This opens a second screen that states exactly what will be booked. The refund is not sent until you confirm there, and the button is disabled while a request is in flight.'}
          </p>
        </Panel>
      </div>
    </AdminLayout>
  );
}

function StateNote({ text }: { text: string }) {
  return <div className="nabin-empty" role="status"><p className="nabin-empty__title">{text}</p></div>;
}

/**
 * The four answers this screen can receive, kept as four renders. A booked refund, a replayed
 * one, a refusal and an unread outcome are different operational facts, and the instruction an
 * operator acts on has to say which one happened.
 *
 * Built on `Panel` rather than a bare alert because `.nabin-alert` is a flex row meant for one
 * line of copy, and a receipt has a grid under it.
 */
function OutcomeBlock({
  outcome,
  onNewRequest,
  canReadAudit,
}: {
  outcome: Outcome;
  onNewRequest: () => void;
  canReadAudit: boolean;
}) {
  if (outcome.kind === 'unknown') {
    return (
      <Panel title="Outcome unknown" subtitle="No answer came back, so nothing here claims what happened.">
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>
            {outcome.message} The request may or may not have been booked, and this screen will not
            guess. The request key above has been kept, so sending the same request again replays it
            instead of refunding twice.
          </span>
        </div>
        <p className="nabin-cell-meta">
          {canReadAudit
            ? <>Check <Link href="/audit">Audit Logs</Link> for a <code>REFUND_PROCESSED</code> entry for this payment before trying anything else.</>
            : <>Ask someone whose session carries <code>audit.view</code> to look for a REFUND_PROCESSED entry for this payment before trying anything else.</>}
        </p>
        <button type="button" className="nabin-btn nabin-btn--ghost" onClick={onNewRequest}>
          Start a new request with a fresh key
        </button>
      </Panel>
    );
  }

  if (outcome.kind === 'refused') {
    const { refusal, facts } = outcome;
    return (
      <Panel
        title={`Refused${refusal.status ? ` — HTTP ${refusal.status}` : ''}`}
        subtitle={refusal.code ? `Server code: ${refusal.code}` : 'The server stated no code with this refusal.'}
      >
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{refusal.message}</span>
        </div>
        {facts.length ? <MetricGrid items={facts} /> : null}
        {refusal.code === 'IDEMPOTENCY_CONFLICT' ? (
          <div className="nabin-alert nabin-alert--danger" role="alert">
            <span>
              This is a spent key, not a bad form. That request identity has already authorized a
              <em> different</em> refund, so this console will not retry it and will not quietly mint
              over it. Change what is being asked for and submit again — the key regenerates on the
              first edit — or read what the earlier refund with that key covered before issuing a
              second one.
            </span>
          </div>
        ) : null}
        <p className="nabin-cell-meta">
          A refusal the server answered booked nothing: the refund is one atomic database function, so
          a request it rejected wrote no ledger entry and moved no balance. Do not resend it unchanged
          in the hope of a different answer — fix what the code and any figure above name.
          {refusal.requestId ? <> Request id: <code>{refusal.requestId}</code></> : null}
        </p>
      </Panel>
    );
  }

  const { receipt } = outcome;
  const replay = outcome.kind === 'replay';

  return (
    <Panel
      title={replay ? 'Already authorized — nothing new was booked' : 'Refund booked'}
      subtitle="Every value below is the server's own answer, read off the response."
    >
      <div className={replay ? 'nabin-alert' : 'nabin-alert nabin-alert--success'} role="status">
        <span>
          {replay
            ? 'The server recognised this request key from an earlier submission and reported the refund it had already authorized, rather than authorizing another one.'
            : 'The refund was booked. The references below are what it returned — this screen assembles no receipt of its own.'}
          {receipt.message ? <> The server said: {receipt.message}</> : null}
        </span>
      </div>
      <MetricGrid
        items={[
          { label: 'Payment', value: showText(receipt.paymentId) },
          { label: 'Refund amount', value: showMoney(receipt.refundAmount) },
          { label: 'Total refunded', value: showMoney(receipt.totalRefunded) },
          { label: 'Event id', value: showText(receipt.eventId) },
          { label: 'Ledger entry', value: showText(receipt.ledgerEntryId) },
          { label: 'Payment status now', value: showText(receipt.status) },
        ]}
      />
      <p className="nabin-cell-meta" style={{ marginTop: 'var(--space-sm)' }}>
        {replay
          ? 'A replay reports no new ledger entry and no new running total, because it created neither — those two cells are unavailable here rather than zero.'
          : 'The server wrote an append-only ledger entry and an authorization row naming this account as the authoriser. Its audit record is the trail; this screen writes none.'}
        {' '}No receipt number, gateway reference or notification reference is returned by the route, so none is shown.
      </p>
      <button type="button" className="nabin-btn nabin-btn--ghost" onClick={onNewRequest} style={{ marginTop: 'var(--space-xs)' }}>
        New refund request
      </button>
    </Panel>
  );
}
