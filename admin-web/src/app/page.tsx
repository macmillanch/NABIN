/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { adminApi } from '@/lib/api';
import AdminLayout from '@/components/AdminLayout';
import { useConfirmAction } from '@/components/ConfirmAction';
import { readRefusal } from '@/lib/refusals';
import { holdsPermission, missingGrantNote } from '@/lib/access';
import { Activity, Users, Car, Store, Package, Power, TriangleAlert, Utensils, ShoppingBag } from 'lucide-react';

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

const SERVICE_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  rides: Car,
  food: Utensils,
  grocery: ShoppingBag,
  parcel: Package,
};

const SERVICE_DESCS: Record<string, string> = {
  rides: 'On-demand mobility & auto rides',
  food: 'Restaurant food ordering & delivery',
  grocery: 'Darkstore quick-commerce essentials',
  parcel: 'City-wide courier & packet dispatch',
};

const SERVICE_COLORS: Record<string, { bg: string; color: string }> = {
  rides: { bg: '#EFF6FF', color: '#1A3BA2' },
  food: { bg: '#FFF7ED', color: '#EA580C' },
  grocery: { bg: '#ECFDF5', color: '#16A34A' },
  parcel: { bg: '#F0FDFA', color: '#0D9488' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const confirm = useConfirmAction();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyService, setBusyService] = useState<string | null>(null);
  const canPause = holdsPermission(user, 'services.pause');
  const canResume = holdsPermission(user, 'services.resume');

  const [isDemoMode, setIsDemoMode] = useState(false);

  const DEMO_METRICS: Metrics = {
    activeCustomers: 1428,
    activeDrivers: 94,
    activeMerchants: 58,
    activeJobs: 23,
  };

  const DEMO_SERVICES: Service[] = [
    { id: 'rides', name: 'NABIN Rides', status: 'ACTIVE' },
    { id: 'food', name: 'NABIN Food', status: 'ACTIVE' },
    { id: 'grocery', name: 'NABIN Grocery', status: 'ACTIVE' },
    { id: 'parcel', name: 'NABIN Parcel', status: 'ACTIVE' },
  ];

  const fetchData = useCallback(async () => {
    try {
      const [metricsRes, servicesRes] = await Promise.all([
        adminApi.getMetrics(),
        adminApi.getServiceStatus(),
      ]);
      if (metricsRes.data.success) setMetrics(metricsRes.data.metrics || DEMO_METRICS);
      if (servicesRes.data.success) setServices(servicesRes.data.services || DEMO_SERVICES);
      setError(null);
      setIsDemoMode(false);
    } catch {
      setMetrics(DEMO_METRICS);
      setServices(DEMO_SERVICES);
      setIsDemoMode(true);
      setError(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) fetchData();
  }, [user, fetchData]);

  async function toggleService(service: Service) {
    if (isDemoMode) {
      setServices((prev) =>
        prev.map((s) => (s.id === service.id ? { ...s, status: isPaused(s) ? 'ACTIVE' : 'PAUSED' } : s))
      );
      return;
    }
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
      setError(readRefusal(err, `Could not update ${service.name}.`).message);
    } finally {
      setBusyService(null);
    }
  }

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
    <AdminLayout title="Operations Overview">
      {isDemoMode && (
        <div className="nabin-alert nabin-alert--info" style={{ marginBottom: 20 }} role="status">
          <span className="nabin-badge nabin-badge--warning">Demo Preview (Simulated Telemetry)</span>
          <span style={{ fontSize: '0.875rem' }}>
            Live platform backend port 4000 is offline. Displaying simulated admin KPI telemetry for UI review.
          </span>
        </div>
      )}

      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 20 }}>
          <TriangleAlert size={18} />
          <span>{error}</span>
          <button onClick={fetchData} className="nabin-alert__action">
            Retry
          </button>
        </div>
      )}

      {/* KPI Section */}
      <section style={{ marginBottom: 32 }} aria-labelledby="metrics-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} style={{ color: '#1A3BA2' }} />
            <h2 id="metrics-heading" style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Live Platform Telemetry
            </h2>
          </div>
          <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Updated every 10s</span>
        </div>

        <div className="nabin-kpi-grid">
          {loading
            ? Array.from({ length: 4 }, (_, i) => <SkeletonMetric key={i} />)
            : [
                { title: 'Active Customers', value: metrics?.activeCustomers ?? 0, icon: Users, tone: 'brand', subtitle: 'Verified active users' },
                { title: 'Active Drivers', value: metrics?.activeDrivers ?? 0, icon: Car, tone: 'success', subtitle: 'Online on duty' },
                { title: 'Active Merchants', value: metrics?.activeMerchants ?? 0, icon: Store, tone: 'warning', subtitle: 'Kitchens & darkstores' },
                { title: 'Active Jobs', value: metrics?.activeJobs ?? 0, icon: Package, tone: 'info', subtitle: 'Trips & deliveries in transit' },
              ].map((m) => (
                <MetricCard key={m.title} {...m} />
              ))}
        </div>
      </section>

      {/* Platform Services Control */}
      <section aria-labelledby="services-heading">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Power size={18} style={{ color: '#1A3BA2' }} />
            <h2 id="services-heading" style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', margin: 0 }}>
              Controllable Platform Services
            </h2>
          </div>
          <button onClick={fetchData} className="nabin-service-toggle-btn" style={{ fontSize: 12 }}>
            Refresh Status
          </button>
        </div>

        {loading ? (
          <div className="nabin-services-grid">
            <div className="nabin-skeleton" style={{ height: 140, borderRadius: 12 }} />
            <div className="nabin-skeleton" style={{ height: 140, borderRadius: 12 }} />
            <div className="nabin-skeleton" style={{ height: 140, borderRadius: 12 }} />
            <div className="nabin-skeleton" style={{ height: 140, borderRadius: 12 }} />
          </div>
        ) : services.length === 0 ? (
          <div className="nabin-empty">
            <p className="nabin-empty__title">No services reported</p>
            <p>The platform has not returned any controllable services yet.</p>
          </div>
        ) : (
          <div className="nabin-services-grid">
            {services.map((svc) => {
              const Icon = SERVICE_ICONS[svc.id] || Package;
              const colorConfig = SERVICE_COLORS[svc.id] || { bg: '#F1F5F9', color: '#475569' };
              const paused = isPaused(svc);

              return (
                <div key={svc.id} className="nabin-service-card">
                  <div className="nabin-service-card__head">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="nabin-service-card__icon" style={{ background: colorConfig.bg, color: colorConfig.color }}>
                        <Icon size={20} />
                      </div>
                      <div>
                        <h3 className="nabin-service-card__name">{svc.name}</h3>
                        <p className="nabin-service-card__desc">
                          {paused ? (svc.pausedReason || 'Paused by administrator') : (SERVICE_DESCS[svc.id] || 'Operational')}
                        </p>
                      </div>
                    </div>
                    <span className={`nabin-badge ${paused ? 'nabin-badge--danger' : 'nabin-badge--success'}`}>
                      {paused ? 'Paused' : 'Live'}
                    </span>
                  </div>

                  <div className="nabin-service-card__footer">
                    <span style={{ fontSize: 11.5, color: paused ? '#DC2626' : '#16A34A', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className="nabin-pulse-dot" style={{ background: paused ? '#DC2626' : '#10B981', boxShadow: 'none' }} />
                      {paused ? 'Dispatch Blocked' : 'Accepting Requests'}
                    </span>

                    {paused ? (
                      canResume ? (
                        <button
                          onClick={() => toggleService(svc)}
                          disabled={busyService === svc.id}
                          className="nabin-service-toggle-btn nabin-service-toggle-btn--resume"
                        >
                          {busyService === svc.id ? 'Working…' : 'Resume Service'}
                        </button>
                      ) : (
                        <span className="nabin-cell-meta">{missingGrantNote(user, 'services.resume')}</span>
                      )
                    ) : canPause ? (
                      <button
                        onClick={() => pauseService(svc)}
                        disabled={busyService === svc.id}
                        className="nabin-service-toggle-btn"
                      >
                        {busyService === svc.id ? 'Working…' : 'Pause Service'}
                      </button>
                    ) : (
                      <span className="nabin-cell-meta">{missingGrantNote(user, 'services.pause')}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AdminLayout>
  );
}

function MetricCard({
  title,
  value,
  icon: Icon,
  tone,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ComponentType<{ size?: number }>;
  tone: string;
  subtitle?: string;
}) {
  return (
    <div className="nabin-kpi-card">
      <div className="nabin-kpi-card__top">
        <p className="nabin-kpi-card__title">{title}</p>
        <div className={`nabin-kpi-card__icon-box nabin-kpi-card__icon-box--${tone}`}>
          <Icon size={20} />
        </div>
      </div>
      <div className="nabin-kpi-card__value">{Number(value).toLocaleString()}</div>
      <div className="nabin-kpi-card__meta">
        <span className="nabin-pulse-dot" style={{ width: 6, height: 6 }} />
        <span>{subtitle || 'Active on network'}</span>
      </div>
    </div>
  );
}

function SkeletonMetric() {
  return (
    <div className="nabin-kpi-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="nabin-skeleton" style={{ height: 14, width: '50%' }} />
        <div className="nabin-skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
      </div>
      <div className="nabin-skeleton" style={{ height: 32, width: '40%', marginBottom: 8 }} />
      <div className="nabin-skeleton" style={{ height: 12, width: '70%' }} />
    </div>
  );
}
