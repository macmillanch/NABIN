'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// One file-level allowance, the convention already used by the sibling command-centre screens:
// the KYC payload is an untyped envelope, and every read names the field it expects.
/**
 * KYC review queue with the three decision actions.
 *
 * What this screen deliberately does NOT do is decide that an applicant is verified. The three
 * checklist boxes are operator-controlled, start unchecked, are never pre-filled from the
 * application's current status or from any API field, and their real values are sent to the
 * server on every APPROVE - even though the button is disabled until all three are ticked. The
 * backend is what refuses an approval with no evidence (TASK 4G's
 * `IDENTITY_APPROVAL_CHECKLIST_REQUIRED`); the disabled button is only comfort, and a client that
 * quietly supplied `true` for the boxes would be fabricating the verification record.
 *
 * PII: this screen renders only what the queue already serves for display -
 * `aadhaarNumberMasked` and a last-four phone. `aadhaarNumberRaw`, `voterIdNumberRaw` and document
 * URLs are never rendered and never placed into a confirmation dialog or a status message.
 * No refund, wallet, or other financial control appears here.
 */
import React, { useMemo, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { Panel, RecordsTable, StateBlock, Badge, UNAVAILABLE, count, useAdminData, type Row } from '@/components/DataPanel';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';

type QueuePayload = { applications?: Row[]; total?: number; metrics?: Record<string, number> };

const pickQueue = (p: any): Row[] => (Array.isArray(p?.applications) ? p.applications : []);
const last4 = (v: unknown) => { const s = String(v ?? ''); return s.length > 4 ? `…${s.slice(-4)}` : (s || UNAVAILABLE); };

type Decision = 'APPROVE' | 'REJECT' | 'REQUEST_RESUBMISSION';

export default function KycPage() {
  const { user } = useAuth();
  const queue = useAdminData<Row[]>('/api/admin/identity-verifications', pickQueue);
  const payload = useMemo(() => (queue.data ? { applications: queue.data } : null) as QueuePayload | null, [queue.data]);

  const [selected, setSelected] = useState<Row | null>(null);
  const [checks, setChecks] = useState({ infoMatches: false, aadhaarValid: false, voterIdValid: false });
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<Decision | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const canReview = holdsPermission(user, 'identity_verification.review');
  const canApprove = canReview && holdsPermission(user, 'identity_verification.approve');
  const canReject = canReview && holdsPermission(user, 'identity_verification.reject');
  const canResubmit = canReview && holdsPermission(user, 'identity_verification.request_resubmission');

  const rows: Row[] = Array.isArray(queue.data) ? queue.data : [];
  const active = selected ? rows.find(r => String(r.id) === String(selected.id)) ?? selected : null;
  const allChecked = checks.infoMatches && checks.aadhaarValid && checks.voterIdValid;
  const reasonTrimmed = reason.trim();

  const reset = () => { setChecks({ infoMatches: false, aadhaarValid: false, voterIdValid: false }); setReason(''); };

  const submit = async (decision: Decision) => {
    const id = String(active?.id ?? '');
    const summary = decision === 'APPROVE'
      ? `Approve ${active?.userName ?? id}?\n\nReviewer checks confirmed: personal details match, Aadhaar valid, Voter ID valid.`
      : `${decision === 'REJECT' ? 'Reject' : 'Request resubmission from'} ${active?.userName ?? id}?\n\nReason sent to the applicant: ${reasonTrimmed}`;
    if (!window.confirm(`${summary}\n\nThis records a decision on a real identity application.`)) return;

    setPending(decision);
    setOutcome(null);
    try {
      // Exactly the three fields the route reads. The live checkbox state is sent as-is; it is
      // never defaulted, and `reason` is omitted only for an approval, where the backend treats it
      // as optional and supplies its own wording.
      const body: { decision: string; reason?: string; checklist?: Record<string, boolean> } = { decision };
      if (decision === 'APPROVE') body.checklist = { ...checks };
      else body.reason = reasonTrimmed;
      const res = await adminApi.reviewIdentity(id, body);
      const data = res.data;
      // HTTP 200 is not the verdict: the endpoint can answer 200-shaped refusals, and the
      // `success` flag is the platform's own answer.
      if (!data || data.success === false) {
        setOutcome({ ok: false, text: `${data?.code ? `${data.code} — ` : ''}${data?.error || 'the platform did not accept this decision.'}` });
      } else {
        const status = String(data?.application?.status ?? 'the new status');
        setOutcome({ ok: true, text: `${decision} recorded. Server reports status: ${status}.` });
        reset();
      }
    } catch (err) {
      const r = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response;
      setOutcome({ ok: false, text: `${r?.data?.code ? `${r.data.code} — ` : ''}${r?.data?.error || `the request failed (${r?.status ?? 'network'}).`}` });
    } finally {
      setPending(null);
      // Re-read the queue so the status on screen is the server's, never a local guess.
      await queue.refetch?.();
    }
  };

  return (
    <AdminLayout title="KYC verification queue">
      <div className="nabin-stack">
        <Panel title="Queue" subtitle={`${count(payload?.total ?? rows.length)} applications reported; ${rows.length} in this page`} panel={queue}>
          {queue.state !== 'ready' ? <StateBlock panel={queue} empty="No applications in the queue." /> : (
            <RecordsTable
              rows={rows}
              caption="Select an application to review it. Document numbers are shown masked by design."
              columns={[
                { key: 'userName', label: 'Applicant' },
                { key: 'phone', label: 'Phone', render: (r) => <span className="nabin-mono">{last4(r.phone)}</span> },
                { key: 'aadhaarNumberMasked', label: 'Aadhaar (masked)' },
                { key: 'aadhaarDocStatus', label: 'Aadhaar doc', render: (r) => <Badge value={r.aadhaarDocStatus} /> },
                { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                { key: 'open', label: '', render: (r) => <button className="nabin-btn nabin-btn--ghost" onClick={() => { setSelected(r); setOutcome(null); reset(); }}>Review</button> },
              ]}
            />
          )}
        </Panel>

        {active ? (
          <Panel title={`Review — ${String(active.userName ?? '')}`} subtitle={`Application ${String(active.id ?? UNAVAILABLE)} · server status ${String(active.status ?? UNAVAILABLE)}`}>
            <div className="nabin-grid nabin-grid--split">
              <dl className="nabin-stack">
                <p><span className="nabin-cell-meta">Phone (last 4)</span><br /><span className="nabin-mono">{last4(active.phone)}</span></p>
                <p><span className="nabin-cell-meta">Aadhaar (masked)</span><br /><span className="nabin-mono">{active.aadhaarNumberMasked ? String(active.aadhaarNumberMasked) : UNAVAILABLE}</span></p>
                <p><span className="nabin-cell-meta">Document status</span><br /><Badge value={active.aadhaarDocStatus} /> <Badge value={active.voterIdDocStatus} /></p>
                <p><span className="nabin-cell-meta">DOB on file</span><br />{active.dob ? String(active.dob) : UNAVAILABLE}</p>
              </dl>
              <div className="nabin-stack">
                <p className="nabin-label">Reviewer checks — all three must be confirmed by you, and are sent exactly as ticked</p>
                {([['infoMatches', 'Personal information matches'], ['aadhaarValid', 'Aadhaar document is valid'], ['voterIdValid', 'Voter ID document is valid']] as const).map(([k, label]) => (
                  <label key={k} className="nabin-row" style={{ gap: 8, alignItems: 'center', minHeight: 'var(--target-min)' }}>
                    <input type="checkbox" checked={checks[k]} disabled={pending !== null || !canApprove}
                      onChange={(e) => setChecks(c => ({ ...c, [k]: e.target.checked }))} />
                    <span>{label}</span>
                  </label>
                ))}
                <label className="nabin-label" htmlFor="kyc-reason">Reason / instruction (required to reject or request resubmission)</label>
                <textarea id="kyc-reason" className="nabin-input" rows={3} value={reason} disabled={pending !== null}
                  onChange={(e) => setReason(e.target.value)} placeholder="Shown to the applicant when rejecting or requesting resubmission" />
              </div>
            </div>

            {outcome ? (
              <div className={`nabin-alert ${outcome.ok ? 'nabin-alert--success' : 'nabin-alert--danger'}`} role="status">
                <span>{outcome.text}</span>
              </div>
            ) : null}

            <div className="nabin-row" style={{ gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
              {canApprove ? (
                <button className="nabin-btn nabin-btn--primary" disabled={!allChecked || pending !== null}
                  title={allChecked ? 'Record the approval' : 'Tick all three reviewer checks first; the server refuses an approval without them'}
                  onClick={() => void submit('APPROVE')}>
                  {pending === 'APPROVE' ? 'Recording…' : 'Approve'}
                </button>
              ) : null}
              {canReject ? (
                <button className="nabin-btn nabin-btn--danger" disabled={reasonTrimmed.length === 0 || pending !== null}
                  onClick={() => void submit('REJECT')}>{pending === 'REJECT' ? 'Recording…' : 'Reject'}</button>
              ) : null}
              {canResubmit ? (
                <button className="nabin-btn nabin-btn--ghost" disabled={reasonTrimmed.length === 0 || pending !== null}
                  onClick={() => void submit('REQUEST_RESUBMISSION')}>
                  {pending === 'REQUEST_RESUBMISSION' ? 'Recording…' : 'Request resubmission'}
                </button>
              ) : null}
              <button className="nabin-btn nabin-btn--ghost" disabled={pending !== null} onClick={() => { reset(); setOutcome(null); }}>Reset</button>
            </div>

            {!canApprove || !canReject || !canResubmit ? (
              <p className="nabin-cell-meta" style={{ margin: 0 }}>
                Controls are omitted where this session lacks the decision-specific grant
                {canReview ? ' (it holds identity_verification.review, so the queue stays usable)' : ''}.
                The server checks the grant on every call regardless of what is rendered here.
              </p>
            ) : null}
            {!canReview ? (
              <p className="nabin-cell-meta" style={{ margin: 0 }}>This session holds no
                <code> identity_verification.review</code> grant, so no decision can be recorded.</p>
            ) : null}
          </Panel>
        ) : rows.length ? (
          <p className="nabin-cell-meta">Select an application above to open the review panel.</p>
        ) : null}
      </div>
    </AdminLayout>
  );
}
