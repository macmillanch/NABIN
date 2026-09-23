'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { useAuth } from '@/components/AuthProvider';
import ResourceTable, { StatusBadge, inr, type Column } from '@/components/ResourceTable';
import { useConfirmAction } from '@/components/ConfirmAction';
import { readRefusal } from '@/lib/refusals';
import { adminApi } from '@/lib/api';
import { holdsPermission, missingGrantNote } from '@/lib/access';

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
  const { user } = useAuth();
  const confirm = useConfirmAction();
  // `merchant.manage` covers both directions on `POST /api/admin/restaurants/:id/status`,
  // and OPERATIONS holds it — so this hides the control for FINANCE_AUDITOR,
  // KYC_SPECIALIST and SUPPORT_AGENT only.
  const canManage = holdsPermission(user, 'merchant.manage');
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
    // Every state update in this loader lands after an await, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function setStatus(merchant: Merchant, status: string) {
    setBusyId(merchant.id);
    try {
      await adminApi.updateRestaurantStatus(merchant.id, status);
      await load();
      setError(null);
    } catch (err) {
      // A suspension refused by the store is not the same event as one that landed
      // without its audit record, and the old copy claimed the second case never
      // happens. The server says which one it is; this repeats it.
      setError(readRefusal(err, `Could not set ${merchant.name ?? merchant.id} to ${status}.`).message);
    } finally {
      setBusyId(null);
    }
  }

  // Area 49: this button took a live merchant off the platform on a single click, and
  // the effect line is what the requirement actually asks for — not a yes/no box.
  async function suspend(merchant: Merchant) {
    const ok = await confirm({
      title: `Suspend ${merchant.name ?? merchant.id}`,
      effect: 'New food orders at this merchant are refused, and the store is shown as closed to customers.',
      consequences: [
        'Orders already accepted are not cancelled and stay as they are.',
        'The payout balance is untouched; suspending is not a financial action.',
        'Reversible: the Approve button on this row restores the merchant.',
        'Recorded in the audit log against your account.',
      ],
      confirmLabel: 'Suspend merchant',
      tone: 'danger',
    });
    if (ok) await setStatus(merchant, 'SUSPENDED');
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
        !canManage ? (
          <span className="nabin-cell-meta">{missingGrantNote(user, 'merchant.manage')}</span>
        ) : m.operationalStatus === 'SUSPENDED' ? (
          <button
            onClick={() => setStatus(m, 'APPROVED')}
            disabled={busyId === m.id}
            className="nabin-btn nabin-btn--primary"
            style={{ minHeight: 'var(--target-min)' }}
          >
            {busyId === m.id ? 'Working…' : 'Approve'}
          </button>
        ) : (
          <button
            onClick={() => suspend(m)}
            disabled={busyId === m.id}
            className="nabin-btn nabin-btn--ghost"
            style={{ minHeight: 'var(--target-min)' }}
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
        <button onClick={load} className="nabin-btn nabin-btn--ghost" style={{ minHeight: 'var(--target-min)' }}>
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
