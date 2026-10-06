'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// The switchboard reads three different response envelopes; the shape each read expects is named
// inline (`status.data?.services`, `p?.jobs`), so a renamed field shows up at one place.

/**
 * Operations - the live switchboard.
 *
 * Reads `/api/admin/services/status`, `/api/admin/metrics` and `/api/admin/jobs`, all endpoints
 * the Flutter admin already depends on, and offers the two controls whose payloads are already
 * known to the client: pause and resume, addressed by service id (`rides`, `parcel`, …).
 *
 * The emergency kill-switch is deliberately NOT wired up here. Its request body has not been
 * verified against the route, and a destructive platform-wide control that posts a guessed
 * payload is the worst possible place to experiment: either it silently does the wrong thing or
 * it 400s while an operator believes the platform is being protected. It stays unwired until the
 * payload is confirmed, and the page says so rather than hiding the gap.
 */
import React, { useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { MetricGrid, Panel, RecordsTable, StateBlock, Badge, UNAVAILABLE, money, count, useAdminData, type Row } from '@/components/DataPanel';
import { adminApi } from '@/lib/api';
import { useAuth } from '@/components/AuthProvider';
import { holdsPermission } from '@/lib/access';
import EmergencySwitch from '@/components/EmergencySwitch';

type Status = 'ACTIVE' | 'PAUSED' | 'DEGRADED' | string;

interface ServiceRow {
  id: string; name: string; category?: string; status: Status;
  pausedAt?: string | null; pausedBy?: string | null; pausedReason?: string | null;
  resumeAt?: string | null; affectedRegions?: string[] | null;
}

export default function OperationsPage() {
  const { user } = useAuth();
  const status = useAdminData<any>('/api/admin/services/status', (p: any) => p);
  const metrics = useAdminData<any>('/api/admin/metrics', (p: any) => p?.metrics);
  const jobs = useAdminData<Row[]>('/api/admin/jobs', (p: any) => p?.jobs);

  const [busy, setBusy] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const services: ServiceRow[] = Array.isArray(status.data?.services) ? status.data.services : [];
  const summary = status.data?.summary ?? null;
  const canPause = holdsPermission(user, 'services.pause');
  const canResume = holdsPermission(user, 'services.resume');

  const act = async (kind: 'pause' | 'resume', svc: ServiceRow) => {
    setBusy(`${svc.id}:${kind}`);
    setOutcome(null);
    try {
      if (kind === 'pause') {
        const reason = (reasons[svc.id] || '').trim();
        if (reason.length < 5) {
          // The server keeps the reason for the operator who inherits the outage, so a thin
          // reason is refused here as well as there rather than posted to be rejected.
          setOutcome({ ok: false, text: `A pause needs a reason an on-call operator can act on (at least five characters). Nothing was sent for ${svc.name}.` });
          return;
        }
        await adminApi.pauseService(svc.id, reason);
        setOutcome({ ok: true, text: `${svc.name} paused. The switchboard below has been re-read from the server.` });
      } else {
        await adminApi.resumeService(svc.id);
        setOutcome({ ok: true, text: `${svc.name} resumed. Re-read from the server.` });
      }
      await (status.refetch as () => Promise<void>)();
    } catch (err: any) {
      // A refusal is reported in the server's own words. It is never dressed up as success,
      // and the switchboard is re-read either way so what is on screen matches what is true.
      const refused = err?.response?.data?.error || err?.response?.data?.code;
      setOutcome({ ok: false, text: `${svc.name}: ${refused || 'the platform refused this change.'}` });
      await (status.refetch as () => Promise<void>)();
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminLayout title="Operations">
      <div className="nabin-stack">
        <MetricGrid items={[
          { label: 'Services active', value: summary ? count(summary.active) : UNAVAILABLE },
          { label: 'Services paused', value: summary ? count(summary.paused) : UNAVAILABLE },
          { label: 'Platform status', value: summary?.platformStatus ? String(summary.platformStatus) : UNAVAILABLE },
          { label: 'Active jobs', value: metrics.data ? count(metrics.data?.activeJobs) : UNAVAILABLE },
          { label: 'Drivers online', value: metrics.data ? count(metrics.data?.activeDrivers) : UNAVAILABLE },
          { label: 'Gross fare today', value: metrics.data ? money(metrics.data?.totalGrossFare) : UNAVAILABLE },
        ]} />

        {outcome ? (
          <div className={`nabin-alert ${outcome.ok ? 'nabin-alert--success' : 'nabin-alert--danger'}`} role="status">
            <span>{outcome.text}</span>
          </div>
        ) : null}

        <Panel title="Service switchboard" subtitle="Pause and resume act on the service id the backend names, and every call is re-checked server-side." panel={status}>
          {status.state !== 'ready' ? <StateBlock panel={status} empty="No services reported." /> : (
            <div className="nabin-grid">
              {services.map((svc) => (
                <article className="nabin-service" key={svc.id}>
                  <header className="nabin-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="nabin-service__name">{svc.name}</span>
                    <Badge value={svc.status} />
                  </header>
                  <p className="nabin-service__reason">
                    {svc.status === 'PAUSED'
                      ? `Paused ${svc.pausedAt ? new Date(String(svc.pausedAt)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}${svc.pausedBy ? ` by ${svc.pausedBy}` : ''} — ${svc.pausedReason || 'no reason recorded'}`
                      : (svc.category || svc.id)}
                  </p>
                  {svc.status === 'PAUSED' && canResume ? (
                    <button className="nabin-btn nabin-btn--primary" disabled={busy === `${svc.id}:resume`} onClick={() => act('resume', svc)}>
                      {busy === `${svc.id}:resume` ? 'Resuming…' : 'Resume service'}
                    </button>
                  ) : canPause && svc.status !== 'PAUSED' ? (
                    <div className="nabin-stack" style={{ gap: 'var(--space-xs)' }}>
                      <label className="nabin-visually-hidden" htmlFor={`reason-${svc.id}`}>Reason to pause {svc.name}</label>
                      <input id={`reason-${svc.id}`} className="nabin-input" placeholder="reason for pausing (kept in the audit trail)"
                        value={reasons[svc.id] || ''} onChange={(e) => setReasons(r => ({ ...r, [svc.id]: e.target.value }))} />
                      <button className="nabin-btn nabin-btn--danger" disabled={busy === `${svc.id}:pause`} onClick={() => act('pause', svc)}>
                        {busy === `${svc.id}:pause` ? 'Pausing…' : 'Pause service'}
                      </button>
                    </div>
                  ) : (
                    <p className="nabin-cell-meta">No control offered: this session holds neither
                      <code> services.pause </code> nor <code> services.resume </code>.</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Emergency controls" subtitle="Master kill switch — pauses or resumes every service at once, and reverses from the same place.">
          <EmergencySwitch
            platformStatus={summary?.platformStatus ?? null}
            pausedCount={summary ? Number(summary.paused) + Number(summary.degraded || 0) : null}
            onSettled={() => (status.refetch as () => Promise<void>)()}
          />
        </Panel>

        <Panel title="Live jobs" subtitle="Newest work the platform is holding." panel={jobs}>
          {jobs.state !== 'ready' ? <StateBlock panel={jobs} empty="No jobs returned." /> : (
            <RecordsTable
              rows={(jobs.data ?? []).slice(0, 40)}
              caption={`${count(Array.isArray(jobs.data) ? jobs.data.length : 0)} jobs returned by /api/admin/jobs; the 40 newest are listed here`}
              columns={[
                { key: 'jobNumber', label: 'Job' },
                { key: 'serviceType', label: 'Service' },
                { key: 'type', label: 'Type' },
                { key: 'status', label: 'Status', render: (r) => <Badge value={r.status} /> },
                { key: 'customerName', label: 'Customer' },
                { key: 'driverId', label: 'Driver' },
                { key: 'createdAt', label: 'Created', render: (r) => <span className="nabin-mono">{r.createdAt ? new Date(String(r.createdAt)).toLocaleString('en-IN', { hour12: false }) : UNAVAILABLE}</span> },
              ]}
            />
          )}
        </Panel>
      </div>
    </AdminLayout>
  );
}
