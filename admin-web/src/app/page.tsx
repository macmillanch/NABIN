/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { adminApi } from '@/lib/api';
import AdminLayout from '@/components/AdminLayout';
import { useConfirmAction } from '@/components/ConfirmAction';
import { readRefusal } from '@/lib/refusals';
import { holdsPermission, missingGrantNote } from '@/lib/access';
import { Activity, Users, Car, Store, Package, Power, TriangleAlert } from 'lucide-react';

interface Metrics {
  activeCustomers: number;
  activeDrivers: number;
  activeMerchants: number;
  activeJobs: number;
}

interface Service {
  id: string;
  name: string;
  status?: string;
  pausedReason?: string | null;
  resumeAt?: string | null;
  affectedRegions?: string[];
}

const isPaused = (service: Service) => service.status === 'PAUSED';

export default function Dashboard() {
  const { user } = useAuth();
  const confirm = useConfirmAction();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyService, setBusyService] = useState<string | null>(null);
  // Both names are super-only (§11 answer 10), so every other role lands on the note
  // below rather than on a button whose only answer is 403.
  const canPause = holdsPermission(user, 'services.pause');
  const canResume = holdsPermission(user, 'services.resume');

  const fetchData = useCallback(async () => {
    try {
      const [metricsRes, servicesRes] = await Promise.all([
        adminApi.getMetrics(),
        adminApi.getServiceStatus(),
      ]);
      if (metricsRes.data.success) setMetrics(metricsRes.data.metrics);
      if (servicesRes.data.success) setServices(servicesRes.data.services);
      setError(null);
    } catch {
      setError('Could not reach the platform API. Check that the backend is running.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  async function toggleService(service: Service) {
    setBusyService(service.id);
    try {
      if (isPaused(service)) {
        await adminApi.resumeService(service.id);
      } else {
        await adminApi.pauseService(service.id, 'Admin manually paused');
      }
      await fetchData();
      setError(null);
    } catch (err) {
      // The server's own words, because a 503 that carries `applied: true` means the
      // pause did land and only its audit record failed — "the change was not applied"
      // would be the one sentence that is definitely false.
      setError(readRefusal(err, `Could not update ${service.name}.`).message);
    } finally {
      setBusyService(null);
    }
  }

  // Pausing is the reversible one, but it stops a whole service for every customer in
  // range, so it is the case area 49 was written for: say what stops, and say how it
  // comes back.
  async function pauseService(service: Service) {
    const ok = await confirm({
      title: `Pause ${service.name}`,
      effect: `New ${service.name} bookings stop immediately for every customer on the platform.`,
      consequences: [
        'Bookings already accepted continue and are not cancelled.',
        'Customers see the service as unavailable until it is resumed.',
        'This is reversible: pressing Resume on this card brings the service back.',
      ],
      confirmLabel: 'Pause service',
      tone: 'danger',
    });
    if (ok) await toggleService(service);
  }

  return (
    <AdminLayout title="Operations overview">
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button onClick={fetchData} className="nabin-alert__action">
            Retry
          </button>
        </div>
      )}

      <section className="nabin-section" aria-labelledby="metrics-heading">
        <div className="nabin-page-head">
          <div>
            <h1 id="metrics-heading" className="nabin-visually-hidden">
              Key metrics
            </h1>
            <h2 className="nabin-section-title" style={{ margin: 0 }}>
              <Activity size={18} /> Key metrics
            </h2>
          </div>
        </div>

        <div className="nabin-grid">
          {loading
            ? Array.from({ length: 4 }, (_, i) => <SkeletonMetric key={i} />)
            : [
                { title: 'Active Customers', value: metrics?.activeCustomers ?? 0, icon: Users, tone: 'brand' },
                { title: 'Active Drivers', value: metrics?.activeDrivers ?? 0, icon: Car, tone: 'success' },
                { title: 'Active Merchants', value: metrics?.activeMerchants ?? 0, icon: Store, tone: 'warning' },
                { title: 'Active Jobs', value: metrics?.activeJobs ?? 0, icon: Package, tone: 'info' },
              ].map((m) => (
                <MetricCard key={m.title} {...m} />
              ))}
        </div>
      </section>

      <section className="nabin-section" aria-labelledby="services-heading">
        <div className="nabin-page-head">
          <h2 id="services-heading" className="nabin-section-title" style={{ margin: 0 }}>
            <Power size={18} /> Platform services
          </h2>
          <button onClick={fetchData} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 'var(--target-min)' }}>
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="nabin-grid">
            <div className="nabin-skeleton" style={{ height: 96 }} />
            <div className="nabin-skeleton" style={{ height: 96 }} />
          </div>
        ) : services.length === 0 ? (
          <div className="nabin-empty">
            <p className="nabin-empty__title">No services reported</p>
            <p>The platform has not returned any controllable services yet.</p>
          </div>
        ) : (
          <div className="nabin-grid">
            {services.map((svc) => (
              <div key={svc.id} className="nabin-card nabin-service">
                <div style={{ minWidth: 0 }}>
                  <h3 className="nabin-service__name">{svc.name}</h3>
                  <p className="nabin-service__reason">
                    {isPaused(svc) ? svc.pausedReason || 'Paused by admin' : 'Operating normally'}
                  </p>
                </div>
                <span
                  className={`nabin-badge ${isPaused(svc) ? 'nabin-badge--danger' : 'nabin-badge--success'}`}
                >
                  {isPaused(svc) ? 'Paused' : 'Live'}
                </span>
                {isPaused(svc) ? (
                  canResume ? (
                    <button
                      onClick={() => toggleService(svc)}
                      disabled={busyService === svc.id}
                      className="nabin-btn nabin-btn--primary"
                    >
                      {busyService === svc.id ? 'Working…' : 'Resume'}
                    </button>
                  ) : (
                    <span className="nabin-cell-meta">{missingGrantNote(user, 'services.resume')}</span>
                  )
                ) : canPause ? (
                  <button
                    onClick={() => pauseService(svc)}
                    disabled={busyService === svc.id}
                    className="nabin-btn nabin-btn--ghost"
                  >
                    {busyService === svc.id ? 'Working…' : 'Pause'}
                  </button>
                ) : (
                  <span className="nabin-cell-meta">{missingGrantNote(user, 'services.pause')}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminLayout>
  );
}

const TONE_CLASS: Record<string, string> = {
  brand: 'nabin-metric__icon--brand',
  success: 'nabin-metric__icon--success',
  warning: 'nabin-metric__icon--warning',
  info: 'nabin-metric__icon--info',
};

function MetricCard({
  title,
  value,
  icon: Icon,
  tone,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number }>;
  tone: string;
}) {
  return (
    <div className="nabin-card nabin-metric">
      <span className={`nabin-metric__icon ${TONE_CLASS[tone]}`}>
        <Icon size={22} />
      </span>
      <div>
        <p className="nabin-stat__label">{title}</p>
        <p className="nabin-stat__value">{value}</p>
      </div>
    </div>
  );
}

function SkeletonMetric() {
  return (
    <div className="nabin-card nabin-metric">
      <div className="nabin-skeleton" style={{ width: 44, height: 44, borderRadius: 12 }} />
      <div className="nabin-stack" style={{ gap: 8, flex: 1 }}>
        <div className="nabin-skeleton" style={{ height: 12, width: '60%' }} />
        <div className="nabin-skeleton" style={{ height: 24, width: '40%' }} />
      </div>
    </div>
  );
}
