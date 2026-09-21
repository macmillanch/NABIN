'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConsoleLayout, { GROCERY_NAV } from '@/components/ConsoleLayout';
import NabinMap from '@/components/NabinMap';
import { RefreshIcon } from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type MerchantOrder } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import { STATE_TONE, humanise, isActive } from '@/lib/orderFlow';

interface Dashboard {
  activeOrders: number;
  orderValue: number;
  totalOrders: number;
  recent: MerchantOrder[];
}

export default function DashboardPage() {
  const { merchant, loading } = useMerchant();
  const merchantId = merchant?.id;
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);

  const load = useCallback(async () => {
    if (!merchantId) return;
    try {
      const res = await merchantApi.dashboard(merchantId);
      const all: MerchantOrder[] = res.data.orders ?? [];
      const grocery = all.filter((order) => order.service_type === 'GROCERY');
      setError('');
      setData({
        activeOrders: grocery.filter((order) => isActive(order.order_state)).length,
        orderValue: grocery.reduce(
          (sum, order) =>
            sum +
            (order.order_state !== 'CANCELLED' && order.order_state !== 'REJECTED'
              ? Number(order.total_amount)
              : 0),
          0,
        ),
        totalOrders: grocery.length,
        recent: grocery.slice(0, 6),
      });
    } catch (err) {
      setError(toFailure(err, 'Could not load your store dashboard.').message);
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    // Every state update in `load` lands after an `await`, so this is not the
    // cascading render the rule warns about.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = () => {
    setPending(true);
    void load();
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  return (
    <ConsoleLayout title="Dashboard" roleLabel="Grocery" nav={GROCERY_NAV}>
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert">
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={refresh}>
            Retry
          </button>
        </div>
      )}

      <div className="nabin-stack">
        <section className="nabin-card">
          <div className="nabin-card__header">
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 900, letterSpacing: '-0.03em' }}>
                {merchant.name}
              </h1>
              <p className="nabin-cell-meta">
                {humanise(merchant.merchant_type) || 'Grocery store'} &middot;{' '}
                {merchant.address ?? 'Address on file'}
              </p>
            </div>
            <span
              className={`nabin-badge ${merchant.is_open ? 'nabin-badge--success' : 'nabin-badge--neutral'}`}
            >
              {merchant.is_open ? 'Store open' : 'Store closed'}
            </span>
          </div>
          <div className="nabin-row" style={{ flexWrap: 'wrap' }}>
            <span className="nabin-chip">Rating {merchant.rating?.toFixed(1) ?? '—'}</span>
            <span className="nabin-chip">Commission {((merchant.commission_rate ?? 0) * 100).toFixed(0)}%</span>
            <span className="nabin-chip">Wallet {inr(merchant.wallet_balance)}</span>
          </div>
        </section>

        <div className="nabin-grid">
          <div className="nabin-card">
            <p className="nabin-stat__label">Open grocery orders</p>
            <p className="nabin-stat__value nabin-num">{data?.activeOrders ?? '—'}</p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Grocery order value on record</p>
            <p className="nabin-stat__value nabin-num">{inr(data?.orderValue)}</p>
          </div>
          <div className="nabin-card">
            <p className="nabin-stat__label">Grocery orders, all time</p>
            <p className="nabin-stat__value nabin-num">{data?.totalOrders ?? '—'}</p>
          </div>
        </div>

        <p className="nabin-notice">
          The dashboard endpoint returns this merchant&rsquo;s stored orders without a date filter, so
          these figures are all-time rather than today-only. Stock levels are on the Inventory page.
        </p>

        <div className="nabin-grid nabin-grid--split">
          <section className="nabin-card">
            <div className="nabin-card__header">
              <h2 style={{ fontSize: 17, fontWeight: 800 }}>Latest orders</h2>
              <Link href="/orders" className="nabin-btn nabin-btn--ghost" style={{ minHeight: 36 }}>
                Open order queue
              </Link>
            </div>
            {pending && !data ? (
              <>
                <div className="nabin-skeleton" style={{ height: 44, marginBottom: 12 }} />
                <div className="nabin-skeleton" style={{ height: 44, marginBottom: 12 }} />
                <div className="nabin-skeleton" style={{ height: 44 }} />
              </>
            ) : data?.recent.length ? (
              data.recent.map((order) => (
                <div key={order.id} className="nabin-list-row">
                  <div className="nabin-cell-stack">
                    <span className="nabin-cell-title">{order.order_number}</span>
                    <span className="nabin-cell-meta">{dateTime(order.created_at)}</span>
                  </div>
                  <div className="nabin-row">
                    <span className={`nabin-badge nabin-badge--${STATE_TONE[order.order_state] ?? 'neutral'}`}>
                      {humanise(order.order_state)}
                    </span>
                    <span className="nabin-num" style={{ fontWeight: 800 }}>
                      {inr(order.total_amount)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <p className="nabin-cell-meta">No grocery orders recorded for this store yet.</p>
            )}
          </section>

          <section className="nabin-card">
            <div className="nabin-card__header">
              <h2 style={{ fontSize: 17, fontWeight: 800 }}>Store location</h2>
              <button
                onClick={refresh}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 36 }}
                aria-label="Refresh dashboard"
              >
                <RefreshIcon />
              </button>
            </div>
            <NabinMap lat={merchant.lat} lng={merchant.lng} label={merchant.name} height={220} />
          </section>
        </div>
      </div>
    </ConsoleLayout>
  );
}
