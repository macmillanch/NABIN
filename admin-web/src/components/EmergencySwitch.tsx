'use client';

/**
 * The master emergency switch, wired to the route as it is actually written.
 *
 * `/api/admin/services/emergency-killswitch` takes `{ activate: boolean, reason?: string }`
 * and refuses anything where `activate` is not a real boolean - the code comment there records
 * what that guard replaced, a client that dropped the parameter and pulled the lockdown *up*
 * while the console was told 200. So this control never sends an ambiguous body: it names the
 * direction, and the same panel that arms the switch is what takes it off again.
 *
 * Arming is refused unless the operator states a reason and ticks an acknowledgement. That is
 * not theatre - the value goes into the service state the next operator inherits, and "no
 * reason" is the message that makes an outage last longer.
 */
import React, { useState } from 'react';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';
import { PowerOff, Power } from 'lucide-react';

interface Props {
  platformStatus?: string | null;
  pausedCount?: number | null;
  onSettled: () => Promise<void> | void;
}

export default function EmergencySwitch({ platformStatus, pausedCount, onSettled }: Props) {
  const { user } = useAuth();
  const allowed = holdsPermission(user, 'services.emergency_killswitch');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<'activate' | 'deactivate' | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const armed = String(platformStatus || '').toUpperCase().includes('PAUSED')
    || String(platformStatus || '').toUpperCase().includes('KILLSWITCH')
    || Number(pausedCount ?? 0) > 0;

  if (!allowed) {
    return (
      <p className="nabin-cell-meta">
        The emergency switch is not offered to this session: it requires
        <code> services.emergency_killswitch</code>, and the server refuses it regardless of what
        this screen shows.
      </p>
    );
  }

  const fire = async (activate: boolean) => {
    setBusy(activate ? 'activate' : 'deactivate');
    setOutcome(null);
    try {
      const res = await adminApi.emergencyKillswitch(activate, reason.trim());
      setOutcome({
        ok: true,
        text: `${activate ? 'Emergency lockdown engaged' : 'Emergency lockdown lifted'}. ${res.data?.message || ''} `
          + `Services active: ${res.data?.summary?.active ?? 'reported on refresh'}.`,
      });
      setReason('');
      setAck(false);
    } catch (err) {
      // The server's own words, always: a 503 here means the switch may not have stuck, and an
      // operator who is told "failed" and goes to check is the outcome this endpoint protects.
      const res = (err as { response?: { status?: number; data?: { error?: string; code?: string } } })?.response;
      const detail = res?.data?.error || res?.data?.code || 'the request did not complete.';
      setOutcome({ ok: false, text: `Refused or failed (${res?.status ?? 'network'}): ${detail}` });
    } finally {
      setBusy(null);
      // Re-read whatever happened, including a refusal, so the panel cannot show a stale state.
      await Promise.resolve(onSettled());
    }
  };

  return (
    <div className="nabin-stack">
      <p className="nabin-cell-meta" style={{ margin: 0 }}>
        Current platform status: <strong>{platformStatus || 'Data unavailable'}</strong>
        {typeof pausedCount === 'number' ? ` — ${pausedCount} service(s) not ACTIVE` : ''}.
        Engaging this pauses every service at once; it is reversible from this same panel.
      </p>

      {outcome ? (
        <div className={`nabin-alert ${outcome.ok ? 'nabin-alert--success' : 'nabin-alert--danger'}`} role="status">
          <span>{outcome.text}</span>
        </div>
      ) : null}

      <div className="nabin-row" style={{ gap: 'var(--space-xs)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: 260, flexGrow: 1 }}>
          <label className="nabin-label" htmlFor="ks-reason">Reason (kept in the audit trail and shown to the next operator)</label>
          <input id="ks-reason" className="nabin-input" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. payment webhook failing platform-wide" />
        </div>
        <label className="nabin-row" style={{ gap: 6, alignItems: 'center', minHeight: 'var(--target-min)' }}>
          <input type="checkbox" id="ks-ack" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <span className="nabin-label" style={{ margin: 0 }}>
            {armed ? 'I understand this lifts the lockdown platform-wide.' : 'I understand this stops every service for every customer.'}
          </span>
        </label>
      </div>

      <div className="nabin-row" style={{ gap: 'var(--space-xs)' }}>
        <button
          className="nabin-btn nabin-btn--danger"
          disabled={busy !== null || !ack || reason.trim().length < 5}
          onClick={() => void fire(true)}
        >
          <PowerOff size={16} aria-hidden="true" />
          <span>{busy === 'activate' ? 'Engaging…' : 'Engage kill switch'}</span>
        </button>
        <button
          className="nabin-btn nabin-btn--primary"
          disabled={busy !== null || !ack || reason.trim().length < 5}
          onClick={() => void fire(false)}
        >
          <Power size={16} aria-hidden="true" />
          <span>{busy === 'deactivate' ? 'Lifting…' : 'Lift kill switch'}</span>
        </button>
      </div>
      <p className="nabin-cell-meta" style={{ margin: 0 }}>
        Both buttons stay disabled until a reason of at least five characters is given and the
        acknowledgement is ticked, because the direction is the dangerous half of this call.
      </p>
    </div>
  );
}
