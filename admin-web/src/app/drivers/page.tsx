'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import ResourceTable, { StatusBadge, inr, type Column } from '@/components/ResourceTable';
import { adminApi } from '@/lib/api';

interface Driver {
  id: string;
  name?: string;
  phone?: string;
  category?: string;
  categoryName?: string;
  vehicle?: string;
  rating?: number;
  status?: string;
  kycStatus?: string;
  operationalStatus?: string;
  isOnline?: boolean;
  todayTrips?: number;
  todayEarnings?: number;
}

export default function DriversPage() {
  const [rows, setRows] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getDrivers();
      setRows(res.data.drivers ?? []);
      setError(null);
    } catch {
      setError('Could not load the driver roster.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Every state update in this loader lands after an await, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setStatus(driver: Driver, status: string) {
    setBusyId(driver.id);
    try {
      await adminApi.updateDriverStatus(driver.id, status);
      await load();
      setError(null);
    } catch {
      setError(`Could not set ${driver.name ?? driver.id} to ${status}.`);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Driver>[] = [
    {
      key: 'name',
      label: 'Driver',
      render: (d) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{d.name ?? d.id}</span>
          <span className="nabin-cell-meta">
            {d.id} · {d.phone ?? 'No phone'}
          </span>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      hideBelow: 'md',
      render: (d) => <span>{d.categoryName ?? d.category ?? '—'}</span>,
    },
    { key: 'vehicle', label: 'Vehicle', hideBelow: 'lg', render: (d) => <span>{d.vehicle ?? '—'}</span> },
    {
      key: 'rating',
      label: 'Rating',
      align: 'end',
      hideBelow: 'sm',
      render: (d) => <span className="nabin-num">{d.rating?.toFixed(2) ?? '—'}</span>,
    },
    {
      key: 'todayTrips',
      label: 'Today',
      align: 'end',
      hideBelow: 'lg',
      render: (d) => (
        <span className="nabin-num">
          {d.todayTrips ?? 0} · {inr(d.todayEarnings)}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'KYC',
      hideBelow: 'md',
      render: (d) => <StatusBadge value={d.kycStatus} />,
    },
    { key: 'operationalStatus', label: 'Status', render: (d) => <StatusBadge value={d.operationalStatus ?? d.status} /> },
    {
      key: 'action',
      label: '',
      align: 'end',
      render: (d) =>
        d.operationalStatus === 'SUSPENDED' ? (
          <button
            onClick={() => setStatus(d, 'ACTIVE')}
            disabled={busyId === d.id}
            className="nabin-btn nabin-btn--primary"
            style={{ minHeight: 40 }}
          >
            {busyId === d.id ? 'Working…' : 'Activate'}
          </button>
        ) : (
          <button
            onClick={() => setStatus(d, 'SUSPENDED')}
            disabled={busyId === d.id}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 40 }}
          >
            Suspend
          </button>
        ),
    },
  ];

  return (
    <AdminLayout title="Drivers">
      <div className="nabin-page-head">
        <div>
          <h1>Driver roster</h1>
          <p>{loading ? 'Loading…' : `${rows.length} drivers on the platform`}</p>
        </div>
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
          Refresh
        </button>
      </div>
      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No drivers yet"
        emptyBody="Drivers appear here once they complete registration and KYC submission."
      />
    </AdminLayout>
  );
}
