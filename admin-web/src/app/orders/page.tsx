'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import ResourceTable, { StatusBadge, inr, type Column } from '@/components/ResourceTable';
import { adminApi } from '@/lib/api';

interface Job {
  id: string;
  type?: string;
  status?: string;
  customerName?: string;
  customerId?: string;
  driverId?: string | null;
  vehicleType?: string;
  fare?: number;
  platformFee?: number;
  createdAt?: string;
  pickup?: { address?: string };
  drop?: { address?: string };
}

const FILTERS = ['ALL', 'RIDE', 'FOOD', 'GROCERY', 'PARCEL'] as const;

export default function OrdersPage() {
  const [rows, setRows] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('ALL');

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getJobs();
      setRows(res.data.jobs ?? []);
      setError(null);
    } catch {
      setError('Could not load jobs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = filter === 'ALL' ? rows : rows.filter((j) => j.type === filter);

  const columns: Column<Job>[] = [
    {
      key: 'id',
      label: 'Job',
      render: (j) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{j.id}</span>
          <span className="nabin-cell-meta">
            {j.type ?? '—'} · {j.vehicleType ?? 'no vehicle'}
          </span>
        </div>
      ),
    },
    {
      key: 'customerName',
      label: 'Customer',
      render: (c) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{c.customerName ?? c.customerId ?? '—'}</span>
          <span className="nabin-cell-meta">{c.driverId ? `Driver ${c.driverId}` : 'Unassigned'}</span>
        </div>
      ),
    },
    {
      key: 'route',
      label: 'Route',
      hideBelow: 'lg',
      render: (j) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-meta">{j.pickup?.address ?? '—'}</span>
          <span className="nabin-cell-meta">{j.drop?.address ?? '—'}</span>
        </div>
      ),
    },
    {
      key: 'fare',
      label: 'Fare',
      align: 'end',
      hideBelow: 'sm',
      render: (j) => <span className="nabin-num">{inr(j.fare)}</span>,
    },
    { key: 'status', label: 'Status', render: (j) => <StatusBadge value={j.status} /> },
    {
      key: 'createdAt',
      label: 'Created',
      align: 'end',
      hideBelow: 'md',
      render: (j) => (
        <span className="nabin-cell-meta">
          {j.createdAt ? new Date(j.createdAt).toLocaleString('en-IN') : '—'}
        </span>
      ),
    },
  ];

  return (
    <AdminLayout title="Jobs & orders">
      <div className="nabin-page-head">
        <div>
          <h1>Live jobs</h1>
          <p>{loading ? 'Loading…' : `${visible.length} of ${rows.length} jobs`}</p>
        </div>
        <div className="nabin-row" role="group" aria-label="Filter by service">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`nabin-chip ${filter === f ? 'is-active' : ''}`}
              aria-pressed={filter === f}
            >
              {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      <ResourceTable
        columns={columns}
        rows={visible}
        rowKey={(j) => j.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No jobs in this view"
        emptyBody="Switch the service filter or refresh to load newer jobs."
      />
    </AdminLayout>
  );
}
