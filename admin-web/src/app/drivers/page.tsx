'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { useAuth } from '@/components/AuthProvider';
import ResourceTable, { StatusBadge, inr, type Column } from '@/components/ResourceTable';
import { useConfirmAction } from '@/components/ConfirmAction';
import { readRefusal } from '@/lib/refusals';
import { adminApi } from '@/lib/api';
import { holdsPermission, missingGrantNote } from '@/lib/access';

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
  const { user } = useAuth();
  const confirm = useConfirmAction();
  // One name covers both directions: suspend and activate are the same route
  // (`POST /api/admin/drivers/:id/status`, `fleet.manage`), held by OPERATIONS.
  const canManage = holdsPermission(user, 'fleet.manage');
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
    } catch (err) {
      // The server distinguishes a refusal from a change that landed without its audit
      // record; the previous copy insisted the second case could not happen.
      setError(readRefusal(err, `Could not set ${driver.name ?? driver.id} to ${status}.`).message);
    } finally {
      setBusyId(null);
    }
  }

  async function suspend(driver: Driver) {
    const ok = await confirm({
      title: `Suspend ${driver.name ?? driver.id}`,
      effect: 'Every request this driver app makes is refused, so they cannot go online or be shown a job.',
      consequences: [
        'They drop out of the dispatch candidate pool, so new pickups go to other drivers.',
        'A trip already accepted is not taken away, and earnings already made stay payable.',
        "This screen sends no reason, so the driver is told 'Compliance review'.",
        'Reversible: the Activate button on this row returns them to service.',
        'Recorded in the audit log against your account.',
      ],
      confirmLabel: 'Suspend driver',
      tone: 'danger',
    });
    if (ok) await setStatus(driver, 'SUSPENDED');
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
        !canManage ? (
          <span className="nabin-cell-meta">{missingGrantNote(user, 'fleet.manage')}</span>
        ) : d.operationalStatus === 'SUSPENDED' ? (
          <button
            onClick={() => setStatus(d, 'ACTIVE')}
            disabled={busyId === d.id}
            className="nabin-btn nabin-btn--primary"
            style={{ minHeight: 'var(--target-min)' }}
          >
            {busyId === d.id ? 'Working…' : 'Activate'}
          </button>
        ) : (
          <button
            onClick={() => suspend(d)}
            disabled={busyId === d.id}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 'var(--target-min)' }}
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
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 'var(--target-min)' }}>
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
