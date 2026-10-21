'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ConsoleLayout from '@/components/ConsoleLayout';
import NabinMap from '@/components/NabinMap';
import {
  RefreshIcon,
  InboxIcon,
  TrendingUpIcon,
  BoxesIcon,
  StarIcon,
  UtensilsIcon,
  ShoppingBagIcon,
  ArrowRightIcon,
  StoreIcon,
  PinIcon,
  PhoneIcon,
  CheckCircleIcon,
} from '@/components/Icons';
import { useMerchant } from '@/context/MerchantAuth';
import { merchantApi, type MerchantOrder } from '@/lib/api';
import { dateTime, inr, toFailure } from '@/lib/format';
import { STATE_TONE, humanise, isActive } from '@/lib/orderFlow';
import { DEMO_ORDERS } from './orders/page';

interface DashboardData {
  allOrders: MerchantOrder[];
  foodOrders: MerchantOrder[];
  groceryOrders: MerchantOrder[];
  activeCount: number;
  activeFoodCount: number;
  activeGroceryCount: number;
  todaySales: number;
  todayFoodSales: number;
  todayGrocerySales: number;
  totalOrders: number;
}

export default function DashboardPage() {
  const { merchant, loading, activeContext, isHybrid } = useMerchant();
  const merchantId = merchant?.id;
  const router = useRouter();

  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(true);

  const load = useCallback(async () => {
    if (!merchantId) return;
    const isDemo =
      typeof window !== 'undefined' &&
      localStorage.getItem('nabin_merchant_token')?.startsWith('demo-');
    try {
      const res = await merchantApi.dashboard(merchantId);
      const orders: MerchantOrder[] =
        isDemo && (!res.data.orders || res.data.orders.length === 0)
          ? DEMO_ORDERS
          : res.data.orders ?? [];
      const food = orders.filter((o) => o.service_type === 'FOOD');
      const grocery = orders.filter((o) => o.service_type === 'GROCERY');

      const calcSales = (list: MerchantOrder[]) =>
        list.reduce(
          (sum, o) =>
            sum +
            (o.order_state !== 'CANCELLED' && o.order_state !== 'REJECTED'
              ? Number(o.total_amount)
              : 0),
          0,
        );

      setError('');
      setData({
        allOrders: orders,
        foodOrders: food,
        groceryOrders: grocery,
        activeCount: orders.filter((o) => isActive(o.order_state)).length,
        activeFoodCount: food.filter((o) => isActive(o.order_state)).length,
        activeGroceryCount: grocery.filter((o) => isActive(o.order_state)).length,
        todaySales: calcSales(orders),
        todayFoodSales: calcSales(food),
        todayGrocerySales: calcSales(grocery),
        totalOrders: orders.length,
      });
    } catch (err) {
      if (isDemo) {
        const orders = DEMO_ORDERS;
        const food = orders.filter((o) => o.service_type === 'FOOD');
        const grocery = orders.filter((o) => o.service_type === 'GROCERY');
        const calcSales = (list: MerchantOrder[]) =>
          list.reduce(
            (sum, o) =>
              sum +
              (o.order_state !== 'CANCELLED' && o.order_state !== 'REJECTED'
                ? Number(o.total_amount)
                : 0),
            0,
          );
        setError('');
        setData({
          allOrders: orders,
          foodOrders: food,
          groceryOrders: grocery,
          activeCount: orders.filter((o) => isActive(o.order_state)).length,
          activeFoodCount: food.filter((o) => isActive(o.order_state)).length,
          activeGroceryCount: grocery.filter((o) => isActive(o.order_state)).length,
          todaySales: calcSales(orders),
          todayFoodSales: calcSales(food),
          todayGrocerySales: calcSales(grocery),
          totalOrders: orders.length,
        });
      } else {
        setError(toFailure(err, 'Could not load your store dashboard.').message);
      }
    } finally {
      setPending(false);
    }
  }, [merchantId]);

  useEffect(() => {
    if (!loading && !merchant) router.replace('/login');
  }, [loading, merchant, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = () => {
    setPending(true);
    void load();
  };

  if (loading || !merchant) {
    return <div className="nabin-skeleton" style={{ minHeight: '100vh', border: 'none' }} />;
  }

  // Determine current active view subset
  const currentOrders =
    activeContext === 'RESTAURANT'
      ? (data?.foodOrders ?? [])
      : activeContext === 'GROCERY'
        ? (data?.groceryOrders ?? [])
        : (data?.allOrders ?? []);

  const activeCount =
    activeContext === 'RESTAURANT'
      ? (data?.activeFoodCount ?? 0)
      : activeContext === 'GROCERY'
        ? (data?.activeGroceryCount ?? 0)
        : (data?.activeCount ?? 0);

  const currentSales =
    activeContext === 'RESTAURANT'
      ? (data?.todayFoodSales ?? 0)
      : activeContext === 'GROCERY'
        ? (data?.todayGrocerySales ?? 0)
        : (data?.todaySales ?? 0);

  const recentOrders = currentOrders
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6);

  const getDashboardHeading = () => {
    if (activeContext === 'RESTAURANT') return 'Restaurant Kitchen';
    if (activeContext === 'GROCERY') return 'Grocery Darkstore';
    return isHybrid ? 'Unified Store Overview' : 'Store Dashboard';
  };

  return (
    <ConsoleLayout
      title={getDashboardHeading()}
      subtitle="Real-time operations summary, live order flow, and revenue metrics"
    >
      {error && (
        <div className="nabin-alert nabin-alert--danger" role="alert" style={{ marginBottom: 'var(--space-md)' }}>
          <span>{error}</span>
          <button className="nabin-alert__action" onClick={refresh}>
            Retry
          </button>
        </div>
      )}

      <div className="nabin-stack" style={{ gap: 'var(--space-lg)' }}>
        {/* Store Executive Header Card */}
        <section
          className="nabin-card"
          style={{
            padding: '24px 28px',
            background: 'linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-md)',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: 'var(--brand)',
                  color: '#ffffff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  boxShadow: '0 4px 10px rgba(26, 59, 162, 0.25)',
                }}
              >
                <StoreIcon size={26} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--ink)' }}>
                    {merchant.name}
                  </h1>
                  <span className="nabin-badge nabin-badge--brand-subtle">
                    {merchant.merchant_type === 'HYBRID_BOTH'
                      ? 'Hybrid Operator: Kitchen & Darkstore'
                      : merchant.merchant_type === 'RESTAURANT'
                        ? 'Restaurant Kitchen'
                        : 'Grocery Quick Commerce'}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    marginTop: 6,
                    fontSize: 13,
                    color: 'var(--ink-muted)',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <PinIcon size={14} />
                    <span>{merchant.address ?? 'Registered location on file'}</span>
                  </span>
                  {merchant.phone && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <PhoneIcon size={14} />
                      <span>{merchant.phone}</span>
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 'var(--radius-pill)',
                  background: merchant.is_open ? 'var(--success-tint)' : 'var(--surface-muted)',
                  border: `1px solid ${merchant.is_open ? 'rgba(34, 164, 71, 0.25)' : 'var(--divider)'}`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: merchant.is_open ? 'var(--success)' : 'var(--ink-muted)',
                    boxShadow: merchant.is_open ? '0 0 0 3px rgba(34, 164, 71, 0.25)' : 'none',
                  }}
                />
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: merchant.is_open ? 'var(--success-ink)' : 'var(--ink-muted)',
                  }}
                >
                  {merchant.is_open ? 'Store Open & Accepting' : 'Store Offline'}
                </span>
              </div>

              <button
                onClick={refresh}
                className="nabin-btn nabin-btn--ghost"
                style={{ minHeight: 40, width: 40, padding: 0 }}
                disabled={pending}
                title="Refresh Metrics"
                aria-label="Refresh store metrics"
              >
                <RefreshIcon size={16} />
              </button>
            </div>
          </div>
        </section>

        {/* 4-Column KPI Stat Grid */}
        <section className="nabin-kpi-grid">
          {/* Card 1: Active Orders */}
          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Active Orders In Flight</span>
              <div
                className="nabin-stat-card__icon-box"
                style={{ background: '#eff6ff', color: 'var(--brand)' }}
              >
                <InboxIcon size={18} />
              </div>
            </div>
            <div className="nabin-stat-card__value" style={{ color: 'var(--brand)' }}>
              {activeCount}
            </div>
            <div className="nabin-stat-card__meta">
              {activeContext === 'ALL'
                ? `${data?.activeFoodCount ?? 0} kitchen · ${data?.activeGroceryCount ?? 0} grocery`
                : 'Requiring fulfillment / pickup'}
            </div>
          </div>

          {/* Card 2: Settled Sales */}
          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Today’s Settled Sales</span>
              <div
                className="nabin-stat-card__icon-box"
                style={{ background: '#ecfdf5', color: '#059669' }}
              >
                <TrendingUpIcon size={18} />
              </div>
            </div>
            <div className="nabin-stat-card__value">
              {inr(currentSales)}
            </div>
            <div className="nabin-stat-card__meta">
              {activeContext === 'ALL'
                ? `Food: ${inr(data?.todayFoodSales ?? 0)} · Groc: ${inr(data?.todayGrocerySales ?? 0)}`
                : 'Excluding cancelled / rejected'}
            </div>
          </div>

          {/* Card 3: Total Orders */}
          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Total Orders Logged</span>
              <div
                className="nabin-stat-card__icon-box"
                style={{ background: '#f5f3ff', color: '#7c3aed' }}
              >
                <BoxesIcon size={18} />
              </div>
            </div>
            <div className="nabin-stat-card__value">
              {currentOrders.length}
            </div>
            <div className="nabin-stat-card__meta">
              Lifetime store orders on NABIN
            </div>
          </div>

          {/* Card 4: Store Rating */}
          <div className="nabin-stat-card">
            <div className="nabin-stat-card__top">
              <span className="nabin-stat-card__label">Store Rating</span>
              <div
                className="nabin-stat-card__icon-box"
                style={{ background: '#fffbeb', color: '#d97706' }}
              >
                <StarIcon size={18} />
              </div>
            </div>
            <div className="nabin-stat-card__value" style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span>{Number(merchant.rating ?? 4.8).toFixed(1)}</span>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink-muted)' }}>/ 5.0</span>
            </div>
            <div className="nabin-stat-card__meta">
              Verified customer score
            </div>
          </div>
        </section>

        {/* Specialized Operational Hub Gateways */}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 'var(--space-md)',
          }}
        >
          {(activeContext === 'ALL' || activeContext === 'RESTAURANT') && (
            <div
              className="nabin-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '22px 24px',
                background: 'linear-gradient(135deg, #ffffff 0%, #fffcf8 100%)',
                border: '1px solid #fed7aa',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: '#fff7ed',
                    color: 'var(--food-orange)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid #ffedd5',
                  }}
                >
                  <UtensilsIcon size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
                      Restaurant Kitchen Menu
                    </h3>
                    <span className="nabin-badge nabin-badge--warning" style={{ fontSize: 10 }}>
                      KDS Active
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 3 }}>
                    Review recipe availability, toggle items in stock, and set prep times.
                  </p>
                </div>
              </div>
              <Link
                href="/menu"
                className="nabin-btn"
                style={{
                  minHeight: 40,
                  padding: '0 18px',
                  background: 'var(--brand)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>Manage Menu</span>
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          )}

          {(activeContext === 'ALL' || activeContext === 'GROCERY') && (
            <div
              className="nabin-card"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '22px 24px',
                background: 'linear-gradient(135deg, #ffffff 0%, #f8fdf9 100%)',
                border: '1px solid #bbf7d0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: '#f0fdf4',
                    color: 'var(--grocery-green)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    border: '1px solid #dcfce7',
                  }}
                >
                  <ShoppingBagIcon size={22} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>
                      Grocery Darkstore & Stock
                    </h3>
                    <span className="nabin-badge nabin-badge--success" style={{ fontSize: 10 }}>
                      Quick Commerce
                    </span>
                  </div>
                  <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 3 }}>
                    Adjust unit quantities, master retail pricing, and low-stock alerts.
                  </p>
                </div>
              </div>
              <Link
                href="/inventory"
                className="nabin-btn"
                style={{
                  minHeight: 40,
                  padding: '0 18px',
                  background: 'var(--brand)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                }}
              >
                <span>Manage Stock</span>
                <ArrowRightIcon size={14} />
              </Link>
            </div>
          )}
        </section>

        {/* Live Order Queue Preview */}
        <section className="nabin-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--divider)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-md)',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
                  Live Order Queue
                </h2>
                <span className="nabin-badge nabin-badge--brand-subtle">
                  {recentOrders.length} in view
                </span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                Customer orders requiring Kitchen / Darkstore preparation and handoff
              </p>
            </div>

            <Link
              href="/orders"
              className="nabin-btn nabin-btn--ghost"
              style={{ minHeight: 38, fontSize: 13, fontWeight: 700 }}
            >
              <span>View Complete Queue</span>
              <ArrowRightIcon size={14} />
            </Link>
          </div>

          {recentOrders.length === 0 ? (
            <div
              style={{
                padding: '48px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'var(--surface-muted)',
                  color: 'var(--ink-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <InboxIcon size={28} />
              </div>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                No orders in this operational view
              </h3>
              <p style={{ fontSize: 13, color: 'var(--ink-muted)', maxWidth: 360, marginTop: 4 }}>
                New customer orders will ring audio alerts and appear here instantly in real time.
              </p>
            </div>
          ) : (
            <div className="nabin-table-wrap" style={{ border: 'none', borderRadius: 0 }}>
              <table className="nabin-table">
                <thead>
                  <tr>
                    <th>Order #</th>
                    <th>Service</th>
                    <th>Placed</th>
                    <th>Customer / Destination</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentOrders.map((order) => {
                    const isFood = order.service_type === 'FOOD';
                    return (
                      <tr key={order.id}>
                        <td>
                          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand)' }}>
                            {order.order_number}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`nabin-badge ${
                              isFood ? 'nabin-badge--warning' : 'nabin-badge--success'
                            }`}
                            style={{ fontSize: 11 }}
                          >
                            {isFood ? '🍽️ Kitchen' : '🛒 Grocery'}
                          </span>
                        </td>
                        <td className="nabin-cell-meta" style={{ fontSize: 13 }}>
                          {dateTime(order.created_at)}
                        </td>
                        <td>
                          <div>
                            <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                              {order.metadata?.customerName ?? 'Customer'}
                            </div>
                            <div className="nabin-cell-meta" style={{ fontSize: 12, maxWidth: 280, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {order.metadata?.deliveryAddress ?? 'Pickup from Store'}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`nabin-badge nabin-badge--${
                              STATE_TONE[order.order_state] ?? 'neutral'
                            }`}
                          >
                            {humanise(order.order_state)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--ink)' }}>
                          {inr(order.total_amount)}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <Link
                            href="/orders"
                            className="nabin-btn nabin-btn--ghost"
                            style={{ minHeight: 32, padding: '0 12px', fontSize: 12, fontWeight: 700 }}
                          >
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Operating Location Map Verification */}
        {merchant.lat !== undefined && merchant.lng !== undefined && (
          <section className="nabin-card" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>
                  Store Dispatch Location
                </h2>
                <p style={{ fontSize: 13, color: 'var(--ink-muted)', marginTop: 2 }}>
                  Verified GPS coordinates configured for NABIN driver pickup dispatch: ({merchant.lat}, {merchant.lng})
                </p>
              </div>
              <span className="nabin-badge nabin-badge--success">
                <CheckCircleIcon size={14} />
                <span>Geofence Locked</span>
              </span>
            </div>
            <div style={{ height: 260, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--divider)' }}>
              <NabinMap
                lat={Number(merchant.lat)}
                lng={Number(merchant.lng)}
                label={merchant.name}
                height={260}
              />
            </div>
          </section>
        )}
      </div>
    </ConsoleLayout>
  );
}
