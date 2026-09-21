'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import ResourceTable, { StatusBadge, inr, type Column } from '@/components/ResourceTable';
import { adminApi } from '@/lib/api';

interface Merchant {
  id: string;
  name?: string;
  address?: string;
  phone?: string;
  rating?: number;
  isOpen?: boolean;
  operationalStatus?: string;
  cuisines?: string[];
  payableBalance?: number;
  commissionRate?: number;
}

export default function MerchantsPage() {
  const [rows, setRows] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getRestaurants();
      setRows(res.data.restaurants ?? []);
      setError(null);
    } catch {
      setError('Could not load merchants.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(merchant: Merchant, status: string) {
    setBusyId(merchant.id);
    try {
      await adminApi.updateRestaurantStatus(merchant.id, status);
      await load();
      setError(null);
    } catch {
      setError(`Could not set ${merchant.name ?? merchant.id} to ${status}.`);
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Merchant>[] = [
    {
      key: 'name',
      label: 'Merchant',
      render: (m) => (
        <div className="nabin-cell-stack">
          <span className="nabin-cell-title">{m.name ?? m.id}</span>
          <span className="nabin-cell-meta">{m.address ?? 'No address'}</span>
        </div>
      ),
    },
    {
      key: 'cuisines',
      label: 'Cuisines',
      hideBelow: 'lg',
      render: (m) => <span>{m.cuisines?.join(', ') ?? '—'}</span>,
    },
    {
      key: 'rating',
      label: 'Rating',
      align: 'end',
      hideBelow: 'sm',
      render: (m) => <span className="nabin-num">{m.rating?.toFixed(1) ?? '—'}</span>,
    },
    {
      key: 'payableBalance',
      label: 'Payable',
      align: 'end',
      hideBelow: 'md',
      render: (m) => <span className="nabin-num">{inr(m.payableBalance)}</span>,
    },
    {
      key: 'commissionRate',
      label: 'Commission',
      align: 'end',
      hideBelow: 'lg',
      render: (m) => <span className="nabin-num">{m.commissionRate != null ? `${m.commissionRate}%` : '—'}</span>,
    },
    {
      key: 'operationalStatus',
      label: 'Status',
      render: (m) => <StatusBadge value={m.operationalStatus} />,
    },
    {
      key: 'action',
      label: '',
      align: 'end',
      render: (m) =>
        m.operationalStatus === 'SUSPENDED' ? (
          <button
            onClick={() => setStatus(m, 'APPROVED')}
            disabled={busyId === m.id}
            className="nabin-btn nabin-btn--primary"
            style={{ minHeight: 40 }}
          >
            {busyId === m.id ? 'Working…' : 'Approve'}
          </button>
        ) : (
          <button
            onClick={() => setStatus(m, 'SUSPENDED')}
            disabled={busyId === m.id}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 40 }}
          >
            Suspend
          </button>
        ),
    },
  ];

  return (
    <AdminLayout title="Merchants">
      <div className="nabin-page-head">
        <div>
          <h1>Merchant directory</h1>
          <p>{loading ? 'Loading…' : `${rows.length} merchants registered`}</p>
        </div>
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 40 }}>
          Refresh
        </button>
      </div>
      <ResourceTable
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        loading={loading}
        error={error}
        onRetry={load}
        emptyTitle="No merchants yet"
        emptyBody="Restaurants appear here once they complete merchant registration."
      />
    </AdminLayout>
  );
}
